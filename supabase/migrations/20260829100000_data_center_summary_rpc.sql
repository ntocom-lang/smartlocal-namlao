-- 20260829100000_data_center_summary_rpc.sql
--
-- หน้าศูนย์รวมข้อมูลดิจิทัลนับสถิติทุกอย่างด้วยการ "ดึงทั้งตารางมานับในเบราว์เซอร์" อยู่ 4 จุด
-- (DataCenterDashboard categoryTree / DataCenterOverview stats / DataCenterEntryForm datalist /
-- DataCenterCategoryManager) ซึ่งพังเงียบๆ เมื่อข้อมูลโต: PostgREST มี max_rows (ค่าปกติ 1000)
-- ตัดผลลัพธ์ให้เองโดยไม่มี error ใดๆ ตัวเลขบนการ์ดสถิติจะ "ต่ำกว่าความจริง" โดยไม่มีใครรู้ตัว
-- และยังเป็นการโหลดข้อมูลซ้ำ 4 รอบต่อการเข้าหน้า 1 ครั้ง
--
-- RPC นี้ย้ายการนับทั้งหมดไปทำที่ server แล้วคืน jsonb ก้อนเดียว ขนาด payload ผูกกับ "จำนวนหมวดหมู่"
-- (หลักสิบ) ไม่ใช่ "จำนวนแถว" (หลักพัน/หมื่น) จึงไม่โตตามข้อมูลอีกต่อไป
--
-- [ทำไมเป็น SECURITY INVOKER ไม่ใช่ DEFINER]
-- RLS ของ data_center_entries คุมขอบเขตเทศบาลอยู่แล้ว (staff เห็นเฉพาะเทศบาลตัวเอง, anon เห็นเฉพาะ
-- แถว active) ฟังก์ชันนี้จึงไม่ต้องมี role guard ของตัวเองและไม่เพิ่ม privilege surface ใหม่เลย
-- แม้แต่นิดเดียว — ตรงข้ามกับ data_center_unified_pins ที่เป็น DEFINER แล้วต้องเขียน guard เอง
-- จนพลาดเป็นช่องโหว่ (ดู 20260829090000_datacenter_public_rpc_hardening.sql)
-- ด้วยเหตุผลเดียวกัน _municipality_id จงใจ "ไม่มี DEFAULT" — บังคับให้ผู้เรียกระบุเสมอ ปิดกับดัก
-- "ส่ง NULL แล้วได้ทุกเทศบาล" ตั้งแต่ลายเซ็นฟังก์ชัน
--
-- [หมายเหตุการนับ ให้ตรงกับ logic เดิมฝั่ง client เป๊ะๆ]
--   active     = status <> 'archived'   (ไม่ใช่ status = 'active')
--   is_route   = route_points เป็น array และมีอย่างน้อย 1 จุด
--   points     = แถวที่ไม่ใช่เส้นทาง (latitude/longitude เป็น NOT NULL อยู่แล้วทุกแถว จึงไม่ต้องเช็ค null)
--   recent_30d = created_at ภายใน 30 วันล่าสุด
--   การเรียงลำดับ ปล่อยให้ client ทำเองด้วย localeCompare(...,'th') ตามเดิม (Postgres collate ไทยกับ
--   ICU ของเบราว์เซอร์ให้ผลไม่ตรงกันเสมอไป) ที่นี่เรียงตามชื่อไว้เฉยๆ ให้ผลลัพธ์ deterministic

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

-- staff-facing เท่านั้น — หน้าแผนที่สาธารณะ (/data-center/public) มีสถิติของตัวเองแยกอยู่แล้ว
-- ไม่ได้ใช้ RPC ตัวนี้ จึงไม่ต้อง grant ให้ anon
--
-- ต้อง REVOKE จาก anon ตรงๆ ด้วย ไม่ใช่แค่ FROM PUBLIC — Supabase ตั้ง
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role
-- ไว้ ฟังก์ชันใหม่ทุกตัวจึงเกิดมาพร้อม grant ที่ "ระบุชื่อ role" (anon=X/postgres) ซึ่ง REVOKE FROM PUBLIC
-- ไม่แตะให้ (ทดสอบแล้ว: revoke แค่ PUBLIC อย่างเดียว anon ยังเรียกฟังก์ชันนี้ได้อยู่)
REVOKE ALL ON FUNCTION public.data_center_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.data_center_summary(uuid) TO authenticated;
