-- google_cloud_email / google_project_id เป็นข้อมูลอ้างอิงสำหรับแอดมินเท่านั้น (ดู GoogleMapsSettings.jsx)
-- ก่อนหน้านี้ TenantContext.jsx ดึงมาด้วยในทุกครั้งที่มีคนเปิดเว็บ (ไม่ว่าจะล็อกอินหรือไม่) ทำให้ทุกคน
-- เห็นอีเมล/project id ของ Google Cloud ผ่าน Network tab — แก้โค้ดฝั่งแอปแล้ว แต่ RLS policy
-- "public can read active municipalities" ยังอนุญาต SELECT ทั้งแถว (ไม่ได้จำกัดคอลัมน์) จึงยังเรียก
-- REST API ตรงๆ ข้าม UI ได้อยู่ดี ต้องปิดที่ระดับ column grant ด้วย
--
-- ลองใช้ column-level REVOKE เฉยๆ ก่อน แต่ไม่พอ เพราะยังมี table-level GRANT SELECT ให้ anon/public
-- ครอบคลุมทุกคอลัมน์อยู่ก่อนแล้ว (Postgres รวมสิทธิ์แบบ UNION, column-level REVOKE ไม่ตัดสิทธิ์ที่มาจาก
-- table-level GRANT ที่กว้างกว่า) ต้อง REVOKE ระดับตารางออกก่อน แล้ว GRANT SELECT เฉพาะคอลัมน์ที่
-- ปลอดภัยจริงกลับเข้าไปแทน (allowlist)
--
-- นอกจาก google_cloud_email/google_project_id เจอเพิ่มว่า calendar_token ก็เป็น bearer secret
-- (ใช้เป็น query param ยืนยันตัวตนเข้าถึงฟีด ICS ปฏิทิน ดู EventsManager.jsx บรรทัด calendar-ics?token=)
-- ควรกันไม่ให้ anon SELECT ตรงๆ ได้เหมือนกัน จึงเพิ่มเข้า blocklist ด้วย

REVOKE SELECT ON public.municipalities FROM anon;
REVOKE SELECT ON public.municipalities FROM public;

GRANT SELECT (
  id, slug, name, org_type, province, district, theme_color, layout_theme, ui_style,
  theme_presets, show_posts_highlight, logo_url, header_image_url, developer_name,
  website_url, facebook_url, line_oa_url, phone, address, email, latitude, longitude,
  location, system_name, system_subtitle, pwa_short_name, enabled_modules, telegram_group_id,
  promptpay_id, fee_schedule, qr_code_url, qr_label, bank_name, bank_account_no,
  bank_account_name, google_maps_api_key, is_active, created_at
) ON public.municipalities TO anon;

GRANT SELECT (
  id, slug, name, org_type, province, district, theme_color, layout_theme, ui_style,
  theme_presets, show_posts_highlight, logo_url, header_image_url, developer_name,
  website_url, facebook_url, line_oa_url, phone, address, email, latitude, longitude,
  location, system_name, system_subtitle, pwa_short_name, enabled_modules, telegram_group_id,
  promptpay_id, fee_schedule, qr_code_url, qr_label, bank_name, bank_account_no,
  bank_account_name, google_maps_api_key, is_active, created_at
) ON public.municipalities TO public;

-- authenticated ยังคง SELECT ได้ทุกคอลัมน์เหมือนเดิม (ไม่แตะ) — ผู้ใช้ที่ล็อกอินแล้ว (ทุก role รวม citizen)
-- จะยังอ่าน google_cloud_email/google_project_id/calendar_token ได้ถ้ารู้ query ตรงๆ แต่แคบกว่า
-- "ใครก็ได้ไม่ต้องล็อกอิน" มาก และ RLS policy ที่มีอยู่ยังกรอง UPDATE/DELETE ตาม municipality_id อยู่แล้ว
