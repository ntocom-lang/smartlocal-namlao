-- ย้อนเฟส 3 (20261201100000_data_center_staff_cancel_and_area_counts.sql) — คืนนโยบาย DELETE + 4 ฟังก์ชันเป็นรุ่นก่อนเฟส 3
-- ⚠️ ย้อนหน้าเว็บ (revert PR) ด้วยก็ได้แต่ไม่บังคับ: หน้าเว็บใหม่อ่านคีย์ areas/lines แบบไม่มีก็ได้ 0/ไม่แสดง
--    staff ที่กดยกเลิกชุดหลังย้อนจะได้ข้อความ "ไม่มีสิทธิ์" จากเซิร์ฟเวอร์ (ไม่พัง)
-- แถวที่ staff ยกเลิกไปแล้วระหว่างที่เฟส 3 เปิดอยู่ กู้ด้วยไฟล์นี้ไม่ได้ (ลบจริง) ต้องพึ่ง backup ของ Supabase
-- สร้างจากไฟล์ migration ต้นฉบับด้วยสคริปต์ (ไม่ได้พิมพ์เนื้อฟังก์ชันเอง) · เทสต์ test:datacenter-gis:db ตรวจว่า
-- ย้อนแล้ว md5 กลับเป็นรุ่นเดิมครบ 4 ตัว + นโยบายเดิม และรันเฟส 3 ซ้ำได้หลังย้อน
--   นโยบาย DELETE                ← 20260802071000_scope_department_operational_records.sql
--   data_center_cancel_import_batch ← 20261130100100_data_center_shape_batch_rpc.sql
--   data_center_summary           ← 20260829100000_data_center_summary_rpc.sql
--   data_center_health / public_stats ← 20261003200100_data_center_health_and_catalog.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "dce admin delete own municipality" ON public.data_center_entries;

CREATE POLICY "dce admin delete own municipality" ON public.data_center_entries
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
  );

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
  if v_role is null or v_role not in ('superadmin','admin','officer') then
    raise exception 'ยกเลิกการนำเข้าทั้งชุดได้เฉพาะผู้ดูแลระบบ หรือหัวหน้ากองของกองเจ้าของข้อมูล' using errcode = '42501';
  end if;
  if _batch_id is null then
    raise exception 'ต้องระบุเลขชุดการนำเข้า';
  end if;

  -- ขอบเขต อปท. (ดูหมายเหตุ "dce public read active" ด้านบน) — superadmin = ทุก อปท.
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
    raise exception 'สิทธิ์ลบได้ % จาก % รายการของชุดนี้ ยกเลิกทั้งหมดแล้ว ไม่ลบบางส่วน ให้ผู้ดูแลระบบเป็นผู้ยกเลิก', v_deleted, v_total
      using errcode = '42501';
  end if;

  return v_deleted;
end;
$$;

COMMENT ON FUNCTION public.data_center_cancel_import_batch(uuid) IS
  'ยกเลิกการนำเข้าไฟล์ทั้งชุด = ลบจริงทุกแถวที่ import_batch_id ตรงกัน แบบทั้งชุดหรือไม่ลบเลย SECURITY INVOKER สิทธิ์ตามนโยบาย DELETE เดิม (superadmin/admin/officer ของกองเจ้าของ) คืนจำนวนที่ลบ';

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
      (d.created_at >= now() - interval '30 days') AS is_recent
    FROM public.data_center_entries d
    WHERE d.municipality_id = _municipality_id
  ),
  cat AS (
    SELECT
      group_name,
      category,
      count(*)::int                                 AS total,
      count(*) FILTER (WHERE is_active)::int        AS active,
      count(*) FILTER (WHERE is_route)::int         AS routes,
      count(*) FILTER (WHERE NOT is_route)::int     AS points,
      count(*) FILTER (WHERE is_recent)::int        AS recent_30d
    FROM base
    GROUP BY group_name, category
  ),
  grp AS (
    SELECT
      group_name,
      sum(total)::int      AS total,
      sum(active)::int     AS active,
      sum(routes)::int     AS routes,
      sum(points)::int     AS points,
      sum(recent_30d)::int AS recent_30d,
      jsonb_agg(jsonb_build_object(
        'category',   category,
        'total',      total,
        'active',     active,
        'points',     points,
        'routes',     routes,
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

NOTIFY pgrst, 'reload schema';

COMMIT;
