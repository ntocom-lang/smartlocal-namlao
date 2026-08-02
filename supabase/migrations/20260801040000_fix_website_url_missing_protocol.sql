-- website_url ที่กรอกไว้ก่อนหน้าไม่มี https:// นำหน้า ทำให้ <a href> ในหน้า "เมนูทั้งหมด"/"ติดต่อเรา"
-- ตีความเป็น relative path ต่อท้าย URL แอปเอง (เช่น localhost:5173/www.namlao.go.th) แทนที่จะออกเว็บจริง
-- ต้นเหตุ (ฟอร์มแอดมินไม่เติม protocol ให้อัตโนมัติ) แก้แล้วใน SystemSettingsAdmin.jsx — ที่นี่แก้ข้อมูลเก่า
update municipalities
set website_url = 'https://' || website_url
where website_url is not null
  and website_url !~* '^https?://';
