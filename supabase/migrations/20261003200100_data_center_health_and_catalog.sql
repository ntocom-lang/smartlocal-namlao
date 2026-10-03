-- 20261003200100_data_center_health_and_catalog.sql
--
-- เฟส 2 (ฟังก์ชัน + trigger) ของงาน "ศูนย์รวมข้อมูลดิจิทัล: ทะเบียนชุดข้อมูล + สุขภาพข้อมูล + ข้อมูลเปิด"
-- ต้องรันหลัง 20261003200000_data_center_verified_columns.sql (อ้างคอลัมน์ verified_at)
--
-- มี 4 อย่าง ทุกฟังก์ชันเป็น SECURITY INVOKER ให้ RLS คุมขอบเขตเอง (ไม่เพิ่ม privilege surface — บทเรียนจาก
-- 20260829090000_datacenter_public_rpc_hardening.sql ที่ DEFINER + เชื่อ tenant id จากผู้เรียกจนรั่ว)
--   1) trigger data_center_touch_updated_at   — ทำให้ updated_at "เชื่อได้" (เดิมไม่มีอะไรอัปเดตให้เลย)
--   2) data_center_health(uuid, int)          — ตรวจสุขภาพข้อมูลด้วยกฎตรงไปตรงมา 6 ข้อ (ไม่ใช้ AI)
--   3) data_center_catalog(uuid)              — ทะเบียนชุดข้อมูลของระบบ: จำนวนแถว / ใหม่ 30 วัน / อัปเดตล่าสุด
--   4) data_center_public_stats(uuid)         — สถิติหน้าแผนที่สาธารณะ แทนการดึงทั้งตารางไปนับในเบราว์เซอร์
--
-- ค่าที่ต้องตรงกับฝั่งหน้าเว็บ มีเทสต์เฝ้า (tests/data-center-hub.test.mjs):
--   รหัสปัญหา 6 ตัว (stale/duplicate/no_owner/pii_id/no_description/no_photo) · ค่าเริ่มต้น 365 วัน
--   รายชื่อชุดข้อมูลในทะเบียน · รายการคอลัมน์ "เนื้อหา" ที่ทำให้ updated_at ขยับ

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'data_center_entries' AND column_name = 'verified_at'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261003200000_data_center_verified_columns.sql ก่อน (ยังไม่มีคอลัมน์ verified_at)';
  END IF;
END $$;

-- ═══ 1) updated_at ที่เชื่อได้ ═══════════════════════════════════════════════════════════════
-- เดิมไม่มี trigger ใดๆ อัปเดต updated_at: ฟอร์มแก้ไขตั้งเองฝั่ง client แต่ปุ่มเปิด/ปิดใช้งาน, การนำเข้า KML ซ้ำ
-- และการรวมชื่อหมวดหมู่ไม่แตะเลย → นำไปคำนวณ "ข้อมูลไม่ได้ตรวจทานนาน" ไม่ได้
--
-- ขยับเฉพาะเมื่อ "เนื้อหา" เปลี่ยนจริง ไม่ขยับเมื่อ: เปลี่ยนสถานะ (active/archived), รวม/เปลี่ยนชื่อกลุ่ม-ประเภท,
-- ย้ายกองเจ้าของ, กดยืนยัน (verified_*) — ไม่งั้นการรวมชื่อหมวดหมู่ครั้งเดียวจะทำให้ทุกรายการดู "เพิ่งอัปเดต"
-- ทั้งที่ไม่มีใครตรวจ ซึ่งจะบังตาป้ายเตือนทั้งระบบ
-- ฟังก์ชันนี้ไม่ใช่ SECURITY DEFINER และ RETURN NEW ทุกเส้นทาง (NOTES.md ข้อ 5)
CREATE OR REPLACE FUNCTION public.data_center_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.name, NEW.description, NEW.latitude, NEW.longitude, NEW.photo_urls, NEW.external_url, NEW.route_points, NEW.route_color)
     IS DISTINCT FROM
     (OLD.name, OLD.description, OLD.latitude, OLD.longitude, OLD.photo_urls, OLD.external_url, OLD.route_points, OLD.route_color)
  THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dce_touch_updated_at ON public.data_center_entries;
CREATE TRIGGER trg_dce_touch_updated_at
  BEFORE UPDATE ON public.data_center_entries
  FOR EACH ROW EXECUTE FUNCTION public.data_center_touch_updated_at();

-- ═══ 2) สุขภาพข้อมูล ═════════════════════════════════════════════════════════════════════════
-- ตรวจเฉพาะรายการที่ยังใช้งาน (status <> 'archived') ด้วยกฎ 6 ข้อที่อธิบายและตรวจย้อนได้ทุกข้อ:
--   ต้องแก้ (must_fix — นับเป็น "ไม่พร้อมใช้" 4 ข้อ)
--     stale          ไม่ได้ตรวจทานเกิน _stale_days วัน นับจากวันที่ใหม่กว่าระหว่าง updated_at กับ verified_at
--     duplicate      จุดพิกัดที่ชื่อเดียวกัน (ไม่สนช่องว่าง/ตัวพิมพ์) กลุ่มและประเภทเดียวกัน มีมากกว่า 1 รายการ
--                    ไม่ตรวจ "เส้นทาง" เพราะเส้นถนนจากไฟล์ KML ถูกซอยเป็นหลายท่อนชื่อเดียวกันโดยปกติ
--     no_owner       ไม่มีกองเจ้าของ (department_id ว่าง) — มักเกิดจากการนำเข้าไฟล์โดยแอดมิน
--     pii_id         ชื่อ/รายละเอียดมีเลข 13 หลักที่หน้าตาเหมือนเลขบัตรประชาชน — ข้อความนี้ถูกเผยแพร่เป็นข้อมูลเปิดบน
--                    หน้าแผนที่สาธารณะ จึงต้องมีด่านกันเลขบัตรหลุด หายไปเมื่อแก้ข้อความ หรือเมื่อเจ้าหน้าที่กดยืนยันหลัง
--                    การแก้ไขล่าสุด (verified_at >= updated_at) เผื่อเป็นเลขอื่นที่ยาว 13 หลักเช่นเลขผู้เสียภาษีนิติบุคคล
--   ควรเติม (ไม่กระทบคะแนน แต่แสดงเป็นความครบถ้วน)
--     no_description ไม่มีรายละเอียด
--     no_photo       ไม่มีรูป (เฉพาะจุดพิกัด เส้นทางถนนไม่ต้องมีรูป)
-- คะแนน = รายการที่ไม่ติด "ต้องแก้" (4 ข้อแรก) ÷ รายการที่ใช้งานอยู่ (NULL เมื่อไม่มีรายการ)
--
-- _municipality_id ไม่มี DEFAULT โดยตั้งใจ (บังคับระบุ ปิดกับดัก "ส่ง NULL แล้วได้ทุกเทศบาล")
-- _stale_days ต่ำกว่า 30 ถูกยกเป็น 30 กันค่าแปลกๆ ทำให้ทุกรายการกลายเป็น "ไม่ตรวจทาน"
-- รายการที่ส่งกลับตัดที่ 300 แถว (เรียงต้องแก้ก่อน → ปัญหาเยอะก่อน → เก่าก่อน) items_total บอกจำนวนจริง
CREATE OR REPLACE FUNCTION public.data_center_health(_municipality_id uuid, _stale_days int DEFAULT 365)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT greatest(coalesce(_stale_days, 365), 30) AS stale_days
  ),
  base AS (
    SELECT
      d.id, d.name, d.group_name, d.category, d.department_id, d.verified_at,
      d.latitude, d.longitude,   -- เส้นทางเก็บจุดกึ่งกลางไว้ที่นี่ ใช้โฟกัสแผนที่ได้เลย
      d.updated_at,
      d.created_by,              -- ให้หน้าจอรู้ว่า staff/technician แก้รายการนี้ได้ไหม (ตรงกับนโยบาย UPDATE)
      -- CASE ไม่ใช่ AND: route_points เป็น SQL NULL ทำให้ jsonb_typeof() เป็น NULL แล้วนิพจน์ทั้งก้อนเป็น NULL
      -- (บทเรียนเดียวกับ data_center_summary)
      CASE WHEN jsonb_typeof(d.route_points) = 'array'
           THEN jsonb_array_length(d.route_points) > 0
           ELSE false END AS is_route,
      (d.description IS NULL OR btrim(d.description) = '')       AS no_description,
      (d.photo_urls IS NULL OR cardinality(d.photo_urls) = 0)    AS no_photo_raw,
      greatest(d.updated_at, d.verified_at)                      AS last_touch,  -- greatest() ข้าม NULL
      lower(btrim(d.name))                                       AS name_key,
      concat_ws(' ', d.name, d.description)                      AS pii_text
    FROM public.data_center_entries d
    WHERE d.municipality_id = _municipality_id
      AND d.status <> 'archived'
  ),
  flagged AS (
    SELECT
      b.*,
      (b.last_touch < now() - make_interval(days => (SELECT stale_days FROM params))) AS is_stale,
      (NOT b.is_route AND b.name_key <> ''
        AND count(*) FILTER (WHERE NOT b.is_route)
              OVER (PARTITION BY b.group_name, b.category, b.name_key) > 1)             AS is_duplicate,
      (b.department_id IS NULL)                                                         AS no_owner,
      -- เลข 13 หลัก (คั่นด้วย - หรือเว้นวรรคได้ตามรูปแบบเลขบัตร) ที่ไม่ได้เป็นส่วนของตัวเลขที่ยาวกว่านั้น
      (b.pii_text ~ '(^|[^0-9])[0-9][- ]?[0-9]{4}[- ]?[0-9]{5}[- ]?[0-9]{2}[- ]?[0-9]($|[^0-9])'
        AND NOT (b.verified_at IS NOT NULL AND b.verified_at >= b.updated_at))          AS is_pii_id,
      (NOT b.is_route AND b.no_photo_raw)                                               AS no_photo
    FROM base b
  ),
  scored AS (
    SELECT f.*, (f.is_stale OR f.is_duplicate OR f.no_owner OR f.is_pii_id) AS must_fix
    FROM flagged f
  ),
  items AS (
    SELECT
      s.*,
      array_remove(ARRAY[
        CASE WHEN s.is_stale       THEN 'stale'          END,
        CASE WHEN s.is_duplicate   THEN 'duplicate'      END,
        CASE WHEN s.no_owner       THEN 'no_owner'       END,
        CASE WHEN s.is_pii_id      THEN 'pii_id'         END,
        CASE WHEN s.no_description THEN 'no_description' END,
        CASE WHEN s.no_photo       THEN 'no_photo'       END
      ], NULL) AS issues
    FROM scored s
  ),
  listed AS (
    SELECT
      i.*,
      row_number() OVER (ORDER BY i.must_fix DESC, cardinality(i.issues) DESC, i.last_touch ASC, i.id) AS rk
    FROM items i
    WHERE cardinality(i.issues) > 0
  ),
  tot AS (
    SELECT
      count(*)::int                                                  AS active,
      count(*) FILTER (WHERE NOT must_fix)::int                      AS ok,
      count(*) FILTER (WHERE is_stale)::int                          AS stale,
      count(*) FILTER (WHERE is_duplicate)::int                      AS duplicate,
      count(*) FILTER (WHERE no_owner)::int                          AS no_owner,
      count(*) FILTER (WHERE is_pii_id)::int                         AS pii_id,
      count(*) FILTER (WHERE no_description)::int                    AS no_description,
      count(*) FILTER (WHERE no_photo)::int                          AS no_photo,
      count(*) FILTER (WHERE NOT is_route)::int                      AS points,
      count(*) FILTER (WHERE NOT is_route AND NOT no_photo)::int     AS points_with_photo,
      max(last_touch)                                                AS latest_update
    FROM scored
  ),
  dep AS (
    SELECT
      s.department_id, dp.name,
      count(*)::int                                AS active,
      count(*) FILTER (WHERE NOT s.must_fix)::int  AS ok
    FROM scored s
    LEFT JOIN public.departments dp ON dp.id = s.department_id
    GROUP BY s.department_id, dp.name
  )
  SELECT jsonb_build_object(
    'stale_days', (SELECT stale_days FROM params),
    'checked_at', now(),
    'totals', (
      SELECT jsonb_build_object(
        'active',            active,
        'ok',                ok,
        'score',             CASE WHEN active = 0 THEN NULL ELSE round(100.0 * ok / active)::int END,
        'stale',             stale,
        'duplicate',         duplicate,
        'no_owner',          no_owner,
        'pii_id',            pii_id,
        'no_description',    no_description,
        'no_photo',          no_photo,
        'points',            points,
        'points_with_photo', points_with_photo,
        'latest_update',     latest_update
      ) FROM tot
    ),
    'departments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'department_id', department_id,
        'name',          name,
        'active',        active,
        'ok',            ok
      ) ORDER BY (active - ok) DESC, active DESC, name)
      FROM dep
    ), '[]'::jsonb),
    'items_total', (SELECT count(*)::int FROM listed),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',            l.id,
        'name',          l.name,
        'group_name',    l.group_name,
        'category',      l.category,
        'department_id', l.department_id,
        'created_by',    l.created_by,
        'latitude',      l.latitude,
        'longitude',     l.longitude,
        'is_route',      l.is_route,
        'must_fix',      l.must_fix,
        'last_touch',    l.last_touch,
        'verified_at',   l.verified_at,
        'issues',        to_jsonb(l.issues)
      ) ORDER BY l.rk)
      FROM listed l
      WHERE l.rk <= 300
    ), '[]'::jsonb)
  )
$$;

-- ═══ 3) ทะเบียนชุดข้อมูล ═════════════════════════════════════════════════════════════════════
-- คืนเฉพาะ "ตัวเลข" (จำนวนแถว / ใหม่ใน 30 วัน / เวลาอัปเดตล่าสุด) ของแต่ละชุดข้อมูล ไม่คืนเนื้อหาแถวใดๆ เลย
-- ส่วนที่เป็นการตัดสินใจ (ระดับความอ่อนไหว, การเผยแพร่) อยู่ที่ src/lib/dataCatalog.js เพราะเป็นเรื่องที่
-- เจ้าของระบบต้องยืนยัน ไม่ใช่สิ่งที่ฐานข้อมูลควรเดาเอง
--
-- เป็น SECURITY INVOKER → จำนวนที่ได้คือ "เท่าที่บัญชีผู้เรียกมีสิทธิ์เห็นตาม RLS" (แอดมินเห็นทั้ง อปท.)
--
-- patient_bookings และ water_station_config: role authenticated "ไม่มี" SELECT ระดับตาราง (เข้าถึงผ่านฟังก์ชันเฉพาะ
-- เท่านั้น ตรวจแล้ว 2026-10-03) ถ้านับตรงๆ ฟังก์ชันนี้จะล้มทั้งตัวด้วย 42501 → คืน NULL แทน ไม่แตะตารางเลย
-- แล้วให้หน้าจอแสดงว่า "จำกัดสิทธิ์ระดับตาราง" (เป็นข้อมูลธรรมาภิบาลที่ควรโชว์อยู่แล้ว ไม่ใช่ข้อบกพร่อง)
-- เพิ่มชุดข้อมูลใหม่: ต้องเพิ่มทั้งที่นี่และใน DATASETS ของ src/lib/dataCatalog.js (เทสต์เทียบ 2 ฝั่งให้)
CREATE OR REPLACE FUNCTION public.data_center_catalog(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ds AS (
    SELECT 'data_center_entries'::text AS key, count(*)::int AS total,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS recent_30d,
           max(updated_at) AS last_activity
      FROM public.data_center_entries WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'tourism_places', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.tourism_places WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'events', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.events WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'emergency_contacts', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(created_at)
      FROM public.emergency_contacts WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'public_holidays', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.public_holidays WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'posts', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.posts WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'waste_villages', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(created_at)
      FROM public.waste_villages WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'departments', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(created_at)
      FROM public.departments WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'water_station_config', NULL::int, NULL::int, NULL::timestamptz
    UNION ALL
    SELECT 'complaints', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.complaints WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'document_requests', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.document_requests WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'patient_bookings', NULL::int, NULL::int, NULL::timestamptz
    UNION ALL
    SELECT 'business_registrations', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.business_registrations WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'fleet_trips', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.fleet_trips WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'fleet_vehicles', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.fleet_vehicles WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'asset_borrow_requests', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(coalesce(updated_at, created_at))
      FROM public.asset_borrow_requests WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'satisfaction_ratings', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(created_at)
      FROM public.satisfaction_ratings WHERE municipality_id = _municipality_id
    UNION ALL
    SELECT 'drive_files', count(*)::int,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int,
           max(created_at)
      FROM public.drive_files WHERE municipality_id = _municipality_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'key',           key,
    'total',         total,
    'recent_30d',    recent_30d,
    'last_activity', last_activity
  ) ORDER BY key), '[]'::jsonb)
  FROM ds
$$;

-- ═══ 4) สถิติหน้าแผนที่สาธารณะ ═══════════════════════════════════════════════════════════════
-- เดิม DataCenterPublicMap ดึง group_name + latitude + route_points (jsonb หนัก) "ทุกแถว" มานับในเบราว์เซอร์
-- ชนเพดาน 1,000 แถวของ PostgREST แล้วตัวเลขต่ำกว่าจริงโดยไม่มี error (NOTES.md ข้อ 14) — ฝั่งเจ้าหน้าที่แก้ไปแล้วด้วย
-- data_center_summary แต่ฝั่งสาธารณะยังไม่ได้แก้
-- เรียกโดย anon ได้ แต่เป็น INVOKER: นโยบาย "dce public read active" ให้อ่านเฉพาะ status='active' อยู่แล้ว
-- และฟังก์ชันนี้คืนแค่ตัวเลขรวม ไม่เปิดข้อมูลที่หน้าแผนที่สาธารณะไม่ได้โชว์อยู่แล้ว
CREATE OR REPLACE FUNCTION public.data_center_public_stats(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',         count(*)::int,
    'groups',        count(DISTINCT d.group_name)::int,
    'routes',        count(*) FILTER (
                       WHERE jsonb_typeof(d.route_points) = 'array' AND jsonb_array_length(d.route_points) > 0
                     )::int,
    'latest_update', max(d.updated_at)
  )
  FROM public.data_center_entries d
  WHERE d.municipality_id = _municipality_id
    AND d.status = 'active'
$$;

-- ═══ สิทธิ์ ═══════════════════════════════════════════════════════════════════════════════════
-- Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ฟังก์ชันใหม่ติด grant ระบุชื่อ anon มาตั้งแต่เกิด
-- REVOKE FROM PUBLIC อย่างเดียวไม่พอ ต้อง FROM PUBLIC, anon (บทเรียนจาก data_center_summary)
REVOKE ALL ON FUNCTION public.data_center_touch_updated_at()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_center_health(uuid, int)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.data_center_catalog(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.data_center_public_stats(uuid)          FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.data_center_health(uuid, int)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.data_center_catalog(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.data_center_public_stats(uuid)       TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
