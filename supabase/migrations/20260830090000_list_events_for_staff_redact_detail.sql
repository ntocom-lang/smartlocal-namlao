-- ปิดช่องโหว่: เจ้าหน้าที่ทุกบทบาทอ่านรายละเอียดกิจกรรมของทุกกลุ่มเป้าหมายได้
--
-- policy "events select by audience" ที่ใช้อยู่ให้ admin/officer/viewer/council/staff/technician
-- อ่านทุกแถวในเทศบาลตัวเองโดยไม่ดู audiences เลย ผลคือช่างหรือเจ้าหน้าที่ทั่วไปยิง query เองก็ได้
-- description และ URL ไฟล์แนบของกำหนดการผู้บริหารและวาระสภาครบทุกรายการ (วัดจริงบน production
-- 2026-08-27: technician อ่านกิจกรรมกลุ่ม management ได้ 78 รายการ กลุ่ม council 10 รายการ)
--
-- ทำไมไม่แก้ policy ให้กรอง audiences ตรงๆ: เจ้าหน้าที่ต้อง "เห็นว่ามีกิจกรรมวันไหนบ้าง" เพื่อ
-- เช็คว่าจองห้อง/นัดงานชนกันไหม ถ้ากรองที่ policy แถวจะหายไปเลย ใช้งานไม่ได้
--
-- วิธีที่เลือก: RPC ตัวเดียวที่คืนทุกแถวแต่ "ลบเนื้อหาที่อ่อนไหวออก" สำหรับคนที่ไม่มีสิทธิ์
-- (description, attachment_url, attachment_urls) แล้วแนบ can_view_detail กับ has_attachment
-- มาให้ฝั่งหน้าจอใช้ตัดสินใจแสดงผล — ชื่อ/วันเวลา/สถานที่/กลุ่มเป้าหมาย/ผู้เพิ่ม ยังเห็นครบ
--
-- ใช้ SETOF jsonb ตาม pattern เดียวกับ list_complaints_for_staff เพื่อไม่ต้องผูกกับชนิดคอลัมน์
-- ของ events (เพิ่มคอลัมน์ใหม่ทีหลังแล้ว RPC ไม่พัง)
--
-- หมายเหตุ: RLS ของตาราง events ยังเปิดกว้างเหมือนเดิม ไฟล์นี้ไม่ได้แตะ policy เพราะยังมีที่อื่น
-- ที่ query ตาราง events ตรงๆ อยู่ (EventsPage, EventsSection, MiniEventCalendar ฝั่งประชาชน)
-- การรัดกุมขั้นถัดไปคือย้ายที่เหลือมาใช้ RPC แล้วค่อยปิด policy ให้แคบลง

CREATE OR REPLACE FUNCTION public.list_events_for_staff(p_municipality_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH actor AS (
    SELECT
      p.id,
      p.role,
      p.municipality_id,
      p.department_id,
      COALESCE(p.is_dept_head, false) AS is_dept_head
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ), scoped AS (
    SELECT
      e.*,
      (
        -- ประกาศเป็นสาธารณะ ประชาชนก็เห็นอยู่แล้ว ไม่มีเหตุให้ปิดจากเจ้าหน้าที่
        'public' = ANY(COALESCE(e.audiences, ARRAY[]::text[]))
        -- ผู้ดูแลระบบ
        OR a.role IN ('admin', 'superadmin')
        -- คนสร้างเอง
        OR e.created_by = a.id
        -- หัวหน้ากอง ดูของกองตัวเองได้ (กติกาเดียวกับสิทธิ์แก้ไข/ลบในหน้าจอ)
        OR (a.is_dept_head AND a.department_id IS NOT NULL AND e.department_id = a.department_id)
        -- บทบาทตรงกับกลุ่มเป้าหมายของกิจกรรม
        OR (a.role = 'viewer'  AND 'management' = ANY(COALESCE(e.audiences, ARRAY[]::text[])))
        OR (a.role = 'council' AND 'council'    = ANY(COALESCE(e.audiences, ARRAY[]::text[])))
        OR (a.role IN ('officer', 'staff', 'technician')
            AND 'staff' = ANY(COALESCE(e.audiences, ARRAY[]::text[])))
      ) AS can_view_detail
    FROM public.events e
    CROSS JOIN actor a
    WHERE e.municipality_id = p_municipality_id
      -- superadmin ข้ามเทศบาลได้ตามการออกแบบ ที่เหลือต้องอยู่เทศบาลเดียวกันเท่านั้น
      AND (a.role = 'superadmin' OR a.municipality_id = p_municipality_id)
  )
  SELECT
    (
      CASE
        WHEN s.can_view_detail THEN to_jsonb(s)
        ELSE
          (to_jsonb(s) - ARRAY['description', 'attachment_url', 'attachment_urls']::text[])
          || jsonb_build_object(
               'description',     NULL,
               'attachment_url',  NULL,
               'attachment_urls', ARRAY[]::text[]
             )
      END
    )
    -- has_attachment: ให้หน้าจอยังโชว์ไอคอนคลิปหนีบแบบกดไม่ได้ ผู้ใช้จะได้รู้ว่ามีไฟล์อยู่
    -- และไปขอจากคนที่มีสิทธิ์ได้ โดยไม่ต้องส่ง URL จริงมาให้
    || jsonb_build_object(
         'has_attachment', (
           COALESCE(array_length(s.attachment_urls, 1), 0) > 0
           OR s.attachment_url IS NOT NULL
         ),
         'creator', CASE
           WHEN cp.id IS NULL THEN NULL
           ELSE jsonb_build_object('full_name', cp.full_name)
         END
       )
  FROM scoped s
  LEFT JOIN public.profiles cp ON cp.id = s.created_by
  ORDER BY s.event_date ASC NULLS LAST, s.event_time ASC NULLS LAST, s.created_at ASC
$$;

REVOKE ALL ON FUNCTION public.list_events_for_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_events_for_staff(uuid) TO authenticated;

COMMENT ON FUNCTION public.list_events_for_staff(uuid) IS
  'รายการกิจกรรมสำหรับหน้าเจ้าหน้าที่ — คืนทุกแถวของเทศบาลแต่ตัด description/ไฟล์แนบออก '
  'สำหรับคนที่ไม่มีสิทธิ์ดูรายละเอียด แนบ can_view_detail และ has_attachment มาให้หน้าจอใช้';
