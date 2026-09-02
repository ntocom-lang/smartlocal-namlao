-- 20260905140000_emergency_contacts_revoke_public_read.sql
--
-- ⚠️ ไฟล์นี้ต้อง apply **หลัง** deploy โค้ดที่เรียก get_public_emergency_contacts แล้วเท่านั้น
-- migration รันก่อน deploy เสมอ ถ้า apply พร้อมกับ 20260905130000 หน้าเว็บที่ยังรันโค้ดเก่า
-- จะเบอร์หายทันทีทุก อปท. (เคยเกิดจริงกับ set_document_signatory เมื่อ 2026-09-02
-- จนต้อง GRANT คืนฉุกเฉิน — ดู 20260904160000/20260904170000)
--
-- ถอนช่องทางอ่านตรงบนตาราง ให้ผู้ไม่ล็อกอินและประชาชนที่ล็อกอินเหลือทางเดียวคือ RPC
-- ที่บังคับระบุ อปท. เสมอ
--
-- policy เดิม "public read active emergency contacts" ให้สิทธิ์ role `public` ซึ่งครอบทั้ง
-- anon และ authenticated การถอนจึงต้องคืนสิทธิ์อ่านให้เจ้าหน้าที่แยกต่างหาก ไม่งั้น
-- officer/viewer/technician/council/staff จะเปิดเมนู "สมุดเบอร์โทร" หลังบ้านแล้วว่างเปล่า
-- (policy "admin manage own emergency contacts" ครอบแค่ admin กับ superadmin)
--
-- เจ้าหน้าที่ต้องเห็นแถวที่ is_active = false ด้วย เพราะเป็นหน้าจัดการ ไม่ใช่หน้าแสดงผล
-- ส่วน citizen ไม่ได้อยู่ในลิสต์นี้โดยตั้งใจ — ประชาชนที่ล็อกอินอ่านผ่าน RPC เหมือนคนทั่วไป
-- ไม่มีเหตุให้เห็นแถวที่แอดมินปิดไว้
--
-- ไม่แตะ policy ฝั่งเขียน การเพิ่ม/แก้/ลบยังเป็นของ admin/superadmin ตามเดิม

begin;

drop policy if exists "public read active emergency contacts" on public.emergency_contacts;

create policy "staff read own emergency contacts"
  on public.emergency_contacts for select
  using (
    get_my_role() = 'superadmin'
    or (
      get_my_role() in ('admin', 'officer', 'technician', 'viewer', 'council', 'staff')
      and municipality_id = get_my_municipality_id()
    )
  );

-- ชั้นที่สอง: ถึงจะไม่มี policy ไหนคืนแถวให้ anon แล้ว ก็ถอน GRANT ระดับตารางออกด้วย
-- RPC เป็น SECURITY DEFINER จึงไม่ได้พึ่งสิทธิ์ของผู้เรียก การถอนนี้ไม่กระทบมัน
revoke select on public.emergency_contacts from anon;

commit;
