-- ปิดช่องโหว่: ผู้ใช้ที่ล็อกอินคนใดก็ได้แก้เบอร์สายด่วนฉุกเฉินของทุก อปท. ได้
--
-- ต้นเหตุ: policy 2 อันด้านล่างเป็น PERMISSIVE FOR ALL, USING (auth.role() = 'authenticated')
-- และไม่ได้กำหนด WITH CHECK (Postgres จะใช้ USING เป็น WITH CHECK แทน)
-- policy แบบ permissive รวมกันด้วย OR ทำให้ "admin manage own emergency contacts"
-- ที่เขียนไว้ถูกต้องแล้วไม่มีผลบังคับใดๆ ประชาชนที่สมัครสมาชิกยิง PostgREST ตรงๆ
-- แก้เบอร์ 191 เป็นเบอร์ปลอมได้ทุก อปท.
--
-- ปลอดภัยที่จะ DROP: หน้า /admin เข้าได้เฉพาะ admin/superadmin/viewer (App.jsx RequireAuth
-- adminOnly) ซึ่ง policy "admin manage own emergency contacts" ครอบ admin/superadmin ไว้แล้ว
-- ส่วน viewer เป็น read-only ตามดีไซน์อยู่แล้ว (canManageContent = role !== 'viewer')

drop policy if exists "allow all for authenticated" on public.emergency_contacts;
drop policy if exists "authenticated can write"     on public.emergency_contacts;

-- policy อ่านสาธารณะซ้ำกัน 2 อัน เงื่อนไขเหมือนกันเป๊ะ (is_active = true) เหลือไว้อันเดียว
drop policy if exists "public can read active emergency contacts" on public.emergency_contacts;
