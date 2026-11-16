-- 20261201100000_data_center_staff_cancel_and_area_counts.sql
--
-- ศูนย์รวมข้อมูลดิจิทัล — นำเข้า GIS เฟส 3 ต้องรันหลัง 20261130100000 + 20261130100100 (เฟส 2)
-- ไม่มี DDL ของคอลัมน์ (ใช้ shape/import_batch_id/verified_by ที่มีอยู่แล้ว) จึงอยู่ไฟล์เดียวได้ (NOTES.md ข้อ 3)
--
-- มี 2 เรื่อง (เจ้าของระบบเลือก "ตามแนะนำ" 2026-11-16)
--   ก) staff/technician ยกเลิกชุดนำเข้าของตัวเองได้
--      1) นโยบาย DELETE "dce admin delete own municipality" เพิ่มเงื่อนไขของ staff/technician 1 ข้อ
--      2) data_center_cancel_import_batch(uuid) เปิดให้ staff/technician เรียก + ข้อความเมื่อยกเลิกเองไม่ได้
--   ข) นับ "พื้นที่" (shape='polygon') แยกจาก "เส้นทาง" — เดิมพื้นที่ถูกนับเป็นเส้นทางเพราะมี route_points เหมือนกัน
--      3) data_center_summary(uuid)        เพิ่ม areas · routes ไม่รวมพื้นที่แล้ว (points + routes + areas = total)
--      4) data_center_health(uuid, int)    เพิ่ม totals.lines / totals.areas + items[].shape (กฎตรวจ 6 ข้อคงเดิม)
--      5) data_center_public_stats(uuid)   เพิ่ม areas · routes ไม่รวมพื้นที่แล้ว
--      shape NULL (รายการก่อนเฟส 2) = ไม่ใช่พื้นที่ → นับแบบเดิมทุกประการ
--
-- ═══ ก) เงื่อนไขของ staff/technician (ต้องครบทุกข้อ ทีละแถว) ════════════════════════════════════
--   อปท. ตัวเอง · created_by = ตัวเอง · มาจากการนำเข้าไฟล์ (import_batch_id ไม่ว่าง)
--   · ยังไม่มีคนอื่นกดยืนยันข้อมูล (verified_by ว่าง หรือเป็นตัวเอง) · สร้างไม่เกิน 7 วัน
--   ฟังก์ชันยกเลิกยังเป็น "ทั้งชุดหรือไม่ลบเลย" (เฟส 2) → แถวเดียวไม่เข้าเงื่อนไข = ย้อนทั้งชุด ไม่ลบอะไร
--   ⚠️ เงื่อนไขนี้ "กันพลาด" ไม่ใช่ด่านความปลอดภัย: นโยบาย UPDATE เดิมให้ staff แก้แถวของตัวเองได้ทุกคอลัมน์
--      (รวม created_at/import_batch_id/verified_by) ⇒ staff ลบแถว "ของตัวเอง" ได้ทุกแถวถ้าตั้งใจเลี่ยง
--      และหลุดได้โดยสุจริตด้วย: ปุ่ม "ยืนยัน" ของ staff บนแถวตัวเองเขียนทับ verified_by ของหัวหน้าเป็นตัวเอง
--      ต่างจากการแก้ทับตรงที่แถวหายทั้งแถว (ตารางนี้ไม่มี audit trigger) — ทั้งหมดนี้ไม่เปิดสิทธิ์ต่อแถวของคนอื่น
--      /อปท. อื่นเพิ่ม (staff เปลี่ยน created_by เป็นคนอื่นไม่ได้: WITH CHECK ของนโยบาย UPDATE บังคับ created_by = auth.uid())
--      ทางปิดที่เสนอไว้ทำใน PR ถัดไป: trigger ห้าม staff/technician เปลี่ยน created_at/import_batch_id และ
--      เขียนทับ verified_by ของคนอื่น (migration-reviewer 2026-11-16 ข้อ 1–2)
--   ไม่ผูกกอง (ไม่มี is_my_department) โดยตั้งใจ: staff ที่ย้ายกองแล้วยังยกเลิกชุดที่ตัวเองเพิ่งนำเข้าได้
--   การลบโดยตรงผ่าน REST (ไม่ผ่านฟังก์ชัน) ได้สิทธิ์เดียวกันทีละแถว — ตั้งใจ ไม่มีช่องที่กว้างกว่าฟังก์ชัน
--   ยังเป็น SECURITY INVOKER ทั้งหมด ไม่เพิ่ม DEFINER
--
-- ═══ ด่านตรวจหัวไฟล์ ═══════════════════════════════════════════════════════════════════════════
-- ฟังก์ชัน 4 ตัวเป็น CREATE OR REPLACE ยก body ทั้งก้อนจากรุ่นล่าสุดในรีโป (NOTES.md ข้อ 5) จึงต้องแน่ใจว่า
-- ฐานจริงยังเป็นรุ่นนั้น: ตัดคอมเมนต์ "--" + ช่องว่าง ASCII ออกจาก prosrc แล้วเทียบ md5 (วิธีเดียวกับเฟส 2)
--   ค่าแรกของแต่ละบรรทัดในด่าน = body ในไฟล์ต้นทาง · ค่าที่สอง = body ของไฟล์นี้ (รันซ้ำได้)
--   data_center_summary             2aff342c… = 20260829100000
--   data_center_health              4edda5b2… = 20261003200100
--   data_center_public_stats        94d955c2… = 20261003200100
--   data_center_cancel_import_batch a326ea98… = 20261130100100 (เฟส 2)
-- นโยบาย DELETE: เทียบนิพจน์ที่ฐานแปลงกลับ (pg_get_expr) หลังตัดวงเล็บ/ช่องว่าง/::text/public. ทิ้ง
--   เพราะ PostgreSQL ต่างรุ่นใส่วงเล็บ/cast ไม่เหมือนกัน — ไม่ตรงทั้งรุ่นเดิมและรุ่นใหม่ = หยุดทั้งก้อน
--   e265a736… = 20260802071000 · 06943aa4… = ไฟล์นี้ (คำนวณใน PGlite รุ่น PostgreSQL 18 — ถ้าฐานจริงแปลงกลับ
--   ต่างไปจากนี้ ด่านจะหยุดทั้งก้อนโดยไม่เขียนอะไร = ปลอดภัย แล้วค่อยเทียบ pg_policies ใหม่)
-- ทุกค่าในด่าน: เทสต์ test:datacenter-gis:db คำนวณจากไฟล์จริงแล้วเทียบ (แก้ body แล้วลืมแก้ค่า = เทสต์ล้ม)
-- ในโค้ดใช้ chr() แทนขีดสองตัว/อักขระควบคุม (SQL Editor อาจตัดคอมเมนต์ในสตริง · Bash ยุบ backslash)

BEGIN;
-- DROP POLICY ล็อกตารางแบบ ACCESS EXCLUSIVE จนถึง COMMIT — รอเกิน 5 วินาที = ยกเลิกทั้งก้อน ดีกว่าให้แผนที่สาธารณะต่อคิว
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_rec record;
  v_policy text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'data_center_entries' AND column_name = 'import_batch_id'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261130100000_data_center_shape_batch_columns.sql ก่อน (ยังไม่มีคอลัมน์ import_batch_id)';
  END IF;

  FOR v_rec IN
    SELECT t.sig, t.old_md5, t.new_md5,
           (SELECT md5(regexp_replace(regexp_replace(p.prosrc, chr(45) || chr(45) || '[^' || chr(10) || ']*', '', 'g'),
                                      '[ ' || chr(9) || chr(13) || chr(10) || ']+', '', 'g'))
              FROM pg_proc p WHERE p.oid = to_regprocedure(t.sig)::oid) AS cur_md5
      FROM (VALUES
        ('public.data_center_summary(uuid)',             '2aff342c58d8e640827e983fafc5e48d', '9961d23a348b2f8cd4c819a2eb374425'),
        ('public.data_center_health(uuid,integer)',      '4edda5b282e5ceab38e1aef76d110c29',  'f0faa3eb7af8f227964a6cd341d67189'),
        ('public.data_center_public_stats(uuid)',        '94d955c2bdb749bc667790ec08f7735b',   '033097d1ac0e3c0d6e11d950bea45888'),
        ('public.data_center_cancel_import_batch(uuid)', 'a326ea9880abfb238126095553b47131', 'edd5682d7cf4303164685f7bd4d5bafa')
      ) AS t(sig, old_md5, new_md5)
  LOOP
    IF v_rec.cur_md5 IS NULL THEN
      RAISE EXCEPTION 'ไม่พบ % บนฐานนี้ หยุดทั้งก้อน', v_rec.sig;
    END IF;
    IF v_rec.cur_md5 NOT IN (v_rec.old_md5, v_rec.new_md5) THEN
      RAISE EXCEPTION 'นิยาม % บนฐานไม่ตรงกับรุ่นในรีโป (md5 %) หยุดทั้งก้อน ห้ามเขียนทับ ให้เทียบ pg_get_functiondef กับไฟล์ก่อน', v_rec.sig, v_rec.cur_md5;
    END IF;
  END LOOP;

  SELECT md5(regexp_replace(lower(pg_get_expr(pol.polqual, pol.polrelid)),
                            '[ ()' || chr(9) || chr(10) || chr(13) || ']+|::text|public[.]', '', 'g'))
    INTO v_policy
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.data_center_entries'::regclass
     AND pol.polname = 'dce admin delete own municipality'
     AND pol.polcmd = 'd';

  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'ไม่พบนโยบาย DELETE "dce admin delete own municipality" บน data_center_entries หยุดทั้งก้อน';
  END IF;
  IF v_policy NOT IN ('e265a7362b2d53d41fcd5b3d00be3257', '06943aa45d47ada4f623fff9edceba8b') THEN
    RAISE EXCEPTION 'นโยบาย DELETE บนฐานไม่ตรงกับ 20260802071000 (md5 %) หยุดทั้งก้อน ห้ามเขียนทับ ให้ดู pg_policies ก่อน', v_policy;
  END IF;
END;
$$;

-- ═══ 1) นโยบาย DELETE ═════════════════════════════════════════════════════════════════════════
-- 3 บรรทัดแรกคงเดิมจาก 20260802071000 ทุกตัวอักษร เพิ่มเฉพาะเงื่อนไขของ staff/technician ท้ายสุด

DROP POLICY IF EXISTS "dce admin delete own municipality" ON public.data_center_entries;

CREATE POLICY "dce admin delete own municipality" ON public.data_center_entries
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (
      public.get_my_role() IN ('staff', 'technician')
      AND municipality_id = public.get_my_municipality_id()
      AND created_by = auth.uid()
      AND import_batch_id IS NOT NULL
      AND (verified_by IS NULL OR verified_by = auth.uid())
      AND created_at > now() - interval '7 days'
    )
  );

-- ═══ 2) data_center_cancel_import_batch ═══════════════════════════════════════════════════════
-- ลายเซ็น/ชื่อพารามิเตอร์/ชนิดผลเดิมทุกอย่าง (_batch_id uuid → int) จึง CREATE OR REPLACE ได้ และ grant เดิมคงอยู่
-- เปลี่ยน 2 จุด: ด่าน role รับ staff/technician · ลบได้ไม่ครบแล้วผู้เรียกเป็น staff/technician = ข้อความบอกเหตุ 3 ข้อ

CREATE OR REPLACE FUNCTION public.data_center_cancel_import_batch(_batch_id uuid)
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
declare
  v_role text := public.get_my_role();
  v_muni uuid;
  v_total int;
  v_deleted int;
begin
  -- ด่านนี้แค่ให้ข้อความที่อ่านรู้เรื่อง สิทธิ์จริงคือนโยบาย DELETE ของตาราง (ลบไม่ครบ = ย้อนทั้งหมดด้านล่าง)
  if v_role is null or v_role not in ('superadmin','admin','officer','staff','technician') then
    raise exception 'ไม่มีสิทธิ์ยกเลิกการนำเข้าไฟล์' using errcode = '42501';
  end if;
  if _batch_id is null then
    raise exception 'ต้องระบุเลขชุดการนำเข้า';
  end if;

  -- ขอบเขต อปท. (นโยบาย "dce public read active" ให้ authenticated อ่าน active ข้าม อปท. ได้) — superadmin = ทุก อปท.
  v_muni := case when v_role = 'superadmin' then null else public.get_my_municipality_id() end;
  if v_role <> 'superadmin' and v_muni is null then
    raise exception 'ไม่พบสังกัดเทศบาลของผู้ใช้รายนี้';
  end if;

  select count(*) into v_total
    from public.data_center_entries
   where import_batch_id = _batch_id
     and (v_muni is null or municipality_id = v_muni);

  if v_total = 0 then
    raise exception 'ไม่พบชุดการนำเข้านี้ (อาจถูกยกเลิกไปแล้ว)' using errcode = 'P0002';
  end if;

  delete from public.data_center_entries
   where import_batch_id = _batch_id
     and (v_muni is null or municipality_id = v_muni);
  get diagnostics v_deleted = row_count;

  if v_deleted > v_total then
    -- มีแถวเข้ามาในชุดระหว่างนับกับลบ = ชุดนี้ยังนำเข้าไม่เสร็จ (insert ไหลเป็นก้อนละ 50 แถว) ย้อนทั้งหมด ลองใหม่ทีหลัง
    raise exception 'ชุดนี้ยังนำเข้าไม่เสร็จ (มีรายการเพิ่มเข้ามาระหว่างยกเลิก) ยังไม่ลบอะไร กรุณารอให้นำเข้าเสร็จแล้วลองใหม่'
      using errcode = '55000';
  elsif v_deleted < v_total then
    if v_role in ('staff','technician') then
      raise exception 'ยกเลิกเองไม่ได้ ยังไม่ลบอะไร: ชุดนี้มีรายการที่ไม่ได้นำเข้าเอง นำเข้าเกิน 7 วัน หรือมีผู้อื่นกดยืนยันข้อมูลแล้ว ให้หัวหน้ากองหรือผู้ดูแลระบบยกเลิกให้'
        using errcode = '42501';
    end if;
    raise exception 'สิทธิ์ลบได้ % จาก % รายการของชุดนี้ ยกเลิกทั้งหมดแล้ว ไม่ลบบางส่วน ให้ผู้ดูแลระบบเป็นผู้ยกเลิก', v_deleted, v_total
      using errcode = '42501';
  end if;

  return v_deleted;
end;
$$;

COMMENT ON FUNCTION public.data_center_cancel_import_batch(uuid) IS
  'ยกเลิกการนำเข้าไฟล์ทั้งชุด = ลบจริงทุกแถวที่ import_batch_id ตรงกัน แบบทั้งชุดหรือไม่ลบเลย SECURITY INVOKER สิทธิ์ตามนโยบาย DELETE (superadmin/admin/officer ของกองเจ้าของ/staff-technician เฉพาะชุดที่ตัวเองนำเข้าไม่เกิน 7 วันและไม่มีผู้อื่นยืนยัน) คืนจำนวนที่ลบ';

-- ═══ 3) data_center_summary ═══════════════════════════════════════════════════════════════════
-- ยกจาก 20260829100000 ทั้งก้อน เปลี่ยนเฉพาะ: base เพิ่ม is_area · cat/grp/totals เพิ่ม areas · routes ไม่รวมพื้นที่
--   is_area ต้องคู่กับ is_route เสมอ (พื้นที่ที่ไม่มี route_points = นับเป็นจุดตามเดิม) ⇒ points + routes + areas = total
--   shape IS NOT DISTINCT FROM: shape NULL ให้ false ไม่ใช่ NULL (บทเรียน FILTER ตัดแถว NULL ทิ้งด้านล่าง)

CREATE OR REPLACE FUNCTION public.data_center_summary(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      d.group_name,
      d.category,
      d.department_id,
      (d.status <> 'archived') AS is_active,
      -- ต้องเป็น CASE ไม่ใช่ AND ธรรมดา: route_points ที่เป็น SQL NULL ทำให้ jsonb_typeof() คืน NULL
      -- → นิพจน์ทั้งก้อนเป็น NULL (ไม่ใช่ false) → "FILTER (WHERE NOT is_route)" ตัดแถวนั้นทิ้ง
      -- ทำให้ยอด points เป็น 0 ทั้งที่ควรได้ 8 (เจอตอนเทียบกับวิธีนับเดิมของ client)
      -- CASE ยังการันตีว่า jsonb_array_length() จะไม่ถูกเรียกกับค่าที่ไม่ใช่ array ด้วย
      CASE WHEN jsonb_typeof(d.route_points) = 'array'
           THEN jsonb_array_length(d.route_points) > 0
           ELSE false END AS is_route,
      (d.shape IS NOT DISTINCT FROM 'polygon') AS is_area,
      (d.created_at >= now() - interval '30 days') AS is_recent
    FROM public.data_center_entries d
    WHERE d.municipality_id = _municipality_id
  ),
  cat AS (
    SELECT
      group_name,
      category,
      count(*)::int                                          AS total,
      count(*) FILTER (WHERE is_active)::int                 AS active,
      count(*) FILTER (WHERE is_route AND NOT is_area)::int  AS routes,
      count(*) FILTER (WHERE is_route AND is_area)::int      AS areas,
      count(*) FILTER (WHERE NOT is_route)::int              AS points,
      count(*) FILTER (WHERE is_recent)::int                 AS recent_30d
    FROM base
    GROUP BY group_name, category
  ),
  grp AS (
    SELECT
      group_name,
      sum(total)::int      AS total,
      sum(active)::int     AS active,
      sum(routes)::int     AS routes,
      sum(areas)::int      AS areas,
      sum(points)::int     AS points,
      sum(recent_30d)::int AS recent_30d,
      jsonb_agg(jsonb_build_object(
        'category',   category,
        'total',      total,
        'active',     active,
        'points',     points,
        'routes',     routes,
        'areas',      areas,
        'recent_30d', recent_30d
      ) ORDER BY category) AS categories
    FROM cat
    GROUP BY group_name
  ),
  dep AS (
    SELECT b.department_id, dp.name, count(*)::int AS total
    FROM base b
    LEFT JOIN public.departments dp ON dp.id = b.department_id
    GROUP BY b.department_id, dp.name
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'total',      coalesce(sum(total), 0)::int,
        'active',     coalesce(sum(active), 0)::int,
        'points',     coalesce(sum(points), 0)::int,
        'routes',     coalesce(sum(routes), 0)::int,
        'areas',      coalesce(sum(areas), 0)::int,
        'recent_30d', coalesce(sum(recent_30d), 0)::int
      ) FROM grp
    ),
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'group_name', group_name,
        'total',      total,
        'active',     active,
        'points',     points,
        'routes',     routes,
        'areas',      areas,
        'recent_30d', recent_30d,
        'categories', categories
      ) ORDER BY group_name) FROM grp
    ), '[]'::jsonb),
    'departments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'department_id', department_id,
        'name',          name,
        'total',         total
      ) ORDER BY total DESC, department_id) FROM dep
    ), '[]'::jsonb)
  )
$$;

-- ═══ 4) data_center_health ════════════════════════════════════════════════════════════════════
-- ยกจาก 20261003200100 ทั้งก้อน เปลี่ยนเฉพาะ: base เพิ่ม is_area · tot เพิ่ม lines/areas · items เพิ่ม shape
-- กฎตรวจ 6 ข้อและคะแนนไม่เปลี่ยน: พื้นที่ยังอยู่ฝั่ง is_route (ไม่ต้องมีรูป · ไม่ตรวจชื่อซ้ำ เพราะ MultiPolygon
-- จากไฟล์ KML ถูกซอยเป็นหลายก้อนชื่อเดียวกันโดยปกติ เหมือนเส้นถนน)

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
      (d.shape IS NOT DISTINCT FROM 'polygon')                   AS is_area,
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
      count(*) FILTER (WHERE is_route AND NOT is_area)::int          AS lines,
      count(*) FILTER (WHERE is_route AND is_area)::int              AS areas,
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
        'lines',             lines,
        'areas',             areas,
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
        'shape',         CASE WHEN NOT l.is_route THEN 'point' WHEN l.is_area THEN 'polygon' ELSE 'line' END,
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

-- ═══ 5) data_center_public_stats ══════════════════════════════════════════════════════════════
-- ยกจาก 20261003200100 ทั้งก้อน เปลี่ยนเฉพาะ: routes ไม่รวมพื้นที่ · เพิ่ม areas (ตัวเลขรวมเท่านั้น เหมือนเดิม)

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
                         AND d.shape IS DISTINCT FROM 'polygon'
                     )::int,
    'areas',         count(*) FILTER (
                       WHERE jsonb_typeof(d.route_points) = 'array' AND jsonb_array_length(d.route_points) > 0
                         AND d.shape IS NOT DISTINCT FROM 'polygon'
                     )::int,
    'latest_update', max(d.updated_at)
  )
  FROM public.data_center_entries d
  WHERE d.municipality_id = _municipality_id
    AND d.status = 'active'
$$;

-- ═══ สิทธิ์ ═══════════════════════════════════════════════════════════════════════════════════
-- CREATE OR REPLACE คง grant เดิมไว้อยู่แล้ว ประกาศซ้ำให้ชัด (ค่าเดียวกับไฟล์ต้นทางทุกตัว)
REVOKE ALL ON FUNCTION public.data_center_summary(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.data_center_health(uuid, int)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.data_center_public_stats(uuid)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.data_center_cancel_import_batch(uuid)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.data_center_summary(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.data_center_health(uuid, int)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.data_center_public_stats(uuid)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_center_cancel_import_batch(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
