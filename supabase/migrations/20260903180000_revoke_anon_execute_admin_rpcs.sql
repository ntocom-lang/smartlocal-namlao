-- ถอนสิทธิ์ EXECUTE ของ anon ออกจาก RPC ที่ต้องล็อกอินเท่านั้น
--
-- ที่มา: Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ฟังก์ชันใหม่ทุกตัวใน schema public
-- ได้ anon=X ติดมาเอง และคำสั่ง REVOKE ALL ... FROM PUBLIC ที่หลาย migration เขียนไว้
-- "ไม่ได้" ถอด grant ตัวนี้ออก เพราะเป็น grant ตรงไปที่ role ไม่ได้ผ่าน PUBLIC
-- (ดูกติกาเดิมจาก audit 2026-08-26) ผลคือ REVOKE ... FROM PUBLIC ให้ความรู้สึกว่าปิดแล้ว
-- ทั้งที่ยังไม่ปิด ถ้าวันหนึ่งมีคนเขียน RPC ใหม่แล้วพึ่งบรรทัดนั้นอย่างเดียวโดยลืมด่านใน
-- ตัวฟังก์ชัน จะกลายเป็นช่องโหว่จริง
--
-- ต้อง REVOKE ทั้ง PUBLIC และ anon เสมอ: get_users_with_email_sorted ถูก grant ตรงที่ anon
-- ส่วน insert_org_project_update ได้สิทธิ์ผ่าน PUBLIC (ACL ขึ้นต้นด้วย =X/postgres)
-- ถอนอย่างใดอย่างหนึ่งจะเหลืออีกทางเสมอ
--
-- ตรวจจากฐานจริงแล้วพบฟังก์ชันที่ anon เรียกได้ 54 ตัว (ไม่รวมของ extension) แต่ส่วนใหญ่
-- "ต้องคงไว้" — ไฟล์นี้จึงถอนเฉพาะ 2 ตัวที่ปลอดภัยและได้ประโยชน์จริง:
--
--   1. get_users_with_email_sorted — SECURITY DEFINER คืน email/id_card/phone/address
--      ของบุคลากรทั้ง อปท. (ข้อมูลส่วนบุคคลตาม PDPA) ตัวฟังก์ชันกัน anon อยู่แล้วด้วย
--      "Authentication required" แต่ไม่มีเหตุผลใดที่ anon ต้องเรียกได้ตั้งแต่แรก
--   2. insert_org_project_update ทั้ง 2 overload — ขึ้นต้นด้วย
--      IF auth.uid() IS NULL THEN RAISE 'ต้องเข้าสู่ระบบก่อน' grant ให้ anon จึงไร้ผลอยู่แล้ว
--
-- ⚠️ ที่ "ห้าม" ถอน และเหตุผล (บันทึกไว้กันคนมากวาดทีหลังแล้วทำระบบพัง):
--   - ตัวช่วยที่ถูกอ้างใน RLS policy — anon ต้องมี EXECUTE เพื่อให้ policy ประเมินผลได้
--     ถ้าถอน anon จะได้ "permission denied for function" แทนผลลัพธ์ว่าง:
--     fleet_can_read, fleet_can_read_asset, fleet_can_read_document_path,
--     fleet_can_write_asset, fleet_is_manager, get_my_fleet_role, get_my_municipality_id,
--     get_my_role, is_municipality_admin, my_fleet
--     (is_org_staff เป็นตัวช่วยลักษณะเดียวกัน ไม่ถอนด้วยเหตุผลเดียวกัน)
--   - RPC ที่ตั้งใจเปิดให้ประชาชนใช้โดยไม่ต้องล็อกอิน:
--     submit_citizen_complaint (v2/v3/v4), attach_complaint_photos, rate_complaint,
--     get_complaint_by_ref, complaints_public, complaint_stats, doc_requests_public,
--     doc_request_stats, get_public_complaint_map_pins, get_public_official_directory,
--     get_public_personnel_directory, get_event_dots, data_center_unified_pins,
--     adhoc_pin_answers
--   - trigger function (fleet_guard_trip_write, handle_new_user ฯลฯ) — เรียกตรงไม่ได้อยู่แล้ว
--     PostgreSQL ตรวจสิทธิ์ตอน CREATE TRIGGER ไม่ใช่ตอน trigger ทำงาน ถอนไปก็ไม่ได้อะไรเพิ่ม
--     จึงไม่แตะเพื่อลดพื้นที่ผลกระทบ

REVOKE ALL ON FUNCTION public.get_users_with_email_sorted(
  uuid, text[], text, integer, integer, text, text
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.insert_org_project_update(
  uuid, text, text, text, date, text[], text
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.insert_org_project_update(
  uuid, uuid, text, text, text, date, text[], text
) FROM PUBLIC, anon;
