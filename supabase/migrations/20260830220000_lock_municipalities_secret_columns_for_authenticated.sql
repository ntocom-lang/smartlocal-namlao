-- ปิดช่องอ่าน "ข้ามหน่วยงาน" ของคอลัมน์ลับใน municipalities สำหรับผู้ใช้ที่ล็อกอินแล้ว
--
-- 20260816191000 ปิดฝั่ง anon ไปแล้ว (REVOKE ระดับตาราง แล้ว GRANT กลับเฉพาะคอลัมน์ปลอดภัย)
-- แต่จงใจไม่แตะ role `authenticated` ไว้ โดยเขียนกำกับไว้เองว่า "ยังอ่านได้ทุกคอลัมน์เหมือนเดิม"
-- ผลคือ **ผู้ใช้ที่ล็อกอินคนไหนก็ได้ รวมถึง role citizen ที่ประชาชนสมัครเอง** ยิง REST ตรงๆ
-- อ่าน calendar_token / google_cloud_email / google_project_id ของ *ทุก* อปท. ในระบบได้
-- (ยืนยันด้วยการทดสอบจริง 2026-08-28: บัญชี admin ของน้ำเลาอ่าน calendar_token ได้ครบทั้ง 4 แถว)
--
-- ความรุนแรงไม่สูง — calendar_token เปิดได้แค่ฟีด ICS ที่ Edge Function กรอง
-- audiences @> ['public'] อยู่แล้ว คือชุดเดียวกับที่เว็บสาธารณะแสดง ส่วน google_cloud_email/
-- google_project_id เป็น information disclosure — แต่ทั้งสามตัวไม่มีเหตุผลให้ผู้ใช้ต่างหน่วยงาน
-- อ่านได้เลย จึงปิดให้เรียบร้อยตามหลัก least privilege
--
-- ⚠️ ลำดับการ deploy สำคัญ: ต้อง merge + deploy PR #38 (ถอดปุ่ม subscribe .ics ออกจาก
-- EventsManager.jsx) ให้ขึ้น production ก่อน แล้วค่อย apply migration นี้ เพราะโค้ดที่ยังรันอยู่
-- ตอนนี้อ่าน municipalities.calendar_token ตอนเปิดหน้าจัดการกิจกรรม ถ้า apply สลับลำดับ
-- เจ้าหน้าที่จะเห็น error ในคอนโซลระหว่างรอ deploy (ไม่ถึงขั้นหน้าพัง แต่ไม่มีเหตุให้ต้องเจอ)

-- ---------------------------------------------------------------------------
-- 1) ตัดสิทธิ์ระดับตารางออกก่อน แล้ว GRANT กลับเฉพาะคอลัมน์ที่ไม่ใช่ความลับ
-- ---------------------------------------------------------------------------
-- Postgres รวมสิทธิ์แบบ UNION — column-level REVOKE ไม่ตัดสิทธิ์ที่มาจาก table-level GRANT
-- ที่กว้างกว่า ต้อง REVOKE ระดับตารางทิ้งก่อนเสมอ (บทเรียนเดียวกับ 20260816191000)
--
-- REVOKE เฉพาะ SELECT — UPDATE ของ authenticated คงไว้ตามเดิม หน้าตั้งค่าแอดมินที่เขียนค่า
-- google_cloud_email/google_project_id/google_maps_api_key จึงยังบันทึกได้ปกติ และคำสั่ง
-- .update(...).select('id') ใน GoogleMapsSettings.jsx ก็ยังผ่าน เพราะ id อยู่ในรายการที่ GRANT กลับ
REVOKE SELECT ON public.municipalities FROM authenticated;

-- ใช้ blocklist แทน allowlist ที่พิมพ์มือ: 20260821061600 กับอีก 3 migration หลังจากนั้นต้องตามมา
-- "แปะ GRANT ที่ลืม" ทีละคอลัมน์ เพราะ allowlist แบบพิมพ์ชื่อครบทุกตัวพลาดง่ายและพลาดแบบเงียบ
-- (คอลัมน์ใหม่จะอ่านไม่ได้ทันทีโดยไม่มี error ให้เห็นตอน migrate)
--
-- ⚠️ ยังต้องดูแลต่อ: คอลัมน์ที่เพิ่มเข้ามา *หลัง* migration นี้ยังไม่ถูก GRANT อัตโนมัติอยู่ดี
-- migration ที่เพิ่มคอลัมน์ใหม่ในตารางนี้ต้องแปะ GRANT SELECT (คอลัมน์ใหม่) ให้ anon, authenticated
-- ต่อท้ายทุกครั้ง
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'municipalities'
     AND column_name NOT IN (
       'calendar_token',      -- bearer secret ของฟีด ICS (calendar-ics?token=...)
       'google_cloud_email',  -- ข้อมูลอ้างอิงบัญชี Google Cloud ของแต่ละ อปท.
       'google_project_id'
     );

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'ไม่พบคอลัมน์ของ public.municipalities — ยกเลิกเพื่อไม่ให้ GRANT ว่างเปล่า';
  END IF;

  EXECUTE format('GRANT SELECT (%s) ON public.municipalities TO authenticated', v_cols);
END $$;

-- ---------------------------------------------------------------------------
-- 2) ทางเข้าที่ถูกต้องสำหรับหน้าตั้งค่า Google Maps ของแอดมิน
-- ---------------------------------------------------------------------------
-- column-level GRANT เป็นสิทธิ์ระดับ "role" ไม่ใช่ระดับ "แถว" จึงแยกไม่ได้ว่าแอดมินอ่าน
-- คอลัมน์นี้ได้เฉพาะแถวของหน่วยงานตัวเอง ต้องใช้ SECURITY DEFINER function ครอบแทน
-- โดยยึด pattern เดียวกับ doc_requests_public (20260830160000)
CREATE OR REPLACE FUNCTION public.get_google_cloud_settings(_municipality_id uuid)
RETURNS TABLE (google_cloud_email text, google_project_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.google_cloud_email, m.google_project_id
    FROM public.municipalities m
   WHERE m.id = _municipality_id
     AND auth.uid() IS NOT NULL
     AND (
       -- superadmin ดูแลข้ามหน่วยงานได้ตามการออกแบบเดิมของระบบ
       get_my_role() = 'superadmin'
       -- แอดมินของหน่วยงานนั้นเท่านั้น — role อื่น (officer/staff/technician/viewer/council/citizen)
       -- ไม่มีหน้าตั้งค่านี้ให้เข้าอยู่แล้ว จึงไม่เปิดให้
       OR (get_my_role() = 'admin' AND get_my_municipality_id() = _municipality_id)
     );
$$;

COMMENT ON FUNCTION public.get_google_cloud_settings(uuid) IS
  'อ่าน google_cloud_email/google_project_id ของหน่วยงานที่ระบุ เฉพาะ admin ของหน่วยงานนั้นหรือ superadmin — ใช้แทนการ SELECT ตรงจาก municipalities ที่ถูกตัดสิทธิ์ไปแล้ว';

REVOKE ALL   ON FUNCTION public.get_google_cloud_settings(uuid) FROM public;
REVOKE ALL   ON FUNCTION public.get_google_cloud_settings(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_google_cloud_settings(uuid) TO authenticated;
