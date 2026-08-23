-- บั๊ก: trigger trg_auto_fleet_role (handle_new_profile_fleet) ทำงานทั้ง INSERT และ UPDATE
-- ของ profiles ทำให้ทุกครั้งที่แอดมินแก้ fleet_role ผ่านหน้า "ตั้งค่าระบบยานพาหนะ" → "สิทธิ์ผู้ใช้"
-- (ผ่าน RPC admin_update_user) ค่าที่แอดมินเลือกจะถูก trigger เขียนทับกลับเป็นค่า default
-- ตาม role หลักขององค์กรทันทีในทรานแซกชันเดียวกัน (staff/officer → fleet_staff เสมอ ฯลฯ)
-- ดูเหมือนบันทึกสำเร็จตอนกด แต่พอโหลดใหม่ค่ากลับไปเป็นเดิม แก้ไขอะไรไม่ได้เลย
--
-- แก้โดยให้ trigger นี้ auto-derive ค่าเริ่มต้นเฉพาะตอนสร้างโปรไฟล์ใหม่ (INSERT) เท่านั้น
-- ไม่ยุ่งกับ UPDATE อีกต่อไป ปล่อยให้ admin_update_user (ที่ validate fleet_role เองอยู่แล้ว)
-- เป็นผู้กำหนดค่าตอนแก้ไขแทน — ฟังก์ชันเดิมไม่ต้องแก้ เปลี่ยนแค่ event ที่ trigger ทำงาน
DROP TRIGGER IF EXISTS trg_auto_fleet_role ON public.profiles;

CREATE TRIGGER trg_auto_fleet_role
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile_fleet();
