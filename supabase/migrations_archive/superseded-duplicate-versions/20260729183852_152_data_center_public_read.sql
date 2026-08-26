-- 152_data_center_public_read.sql
-- เปิดให้ประชาชน (anon) และผู้ใช้ล็อกอินทั่วไปอ่านศูนย์ข้อมูลดิจิทัลที่ status='active' ได้
-- (สถานะ 'archived' ยังเห็นได้เฉพาะเจ้าหน้าที่ผ่านนโยบาย "dce staff read own municipality")

CREATE POLICY "dce public read active" ON public.data_center_entries FOR SELECT
  TO anon, authenticated
  USING (status = 'active');
