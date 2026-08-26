-- กู้คืนจาก supabase_migrations.schema_migrations ของ production (umxssfahtuprnztlytdd)
-- เมื่อ 2026-08-28 — migration นี้ถูก apply ผ่าน Supabase MCP โดยไม่เคยมีไฟล์ต้นทางใน repo
-- ตั้งชื่อไฟล์ด้วย version เดิมของ remote เพื่อให้จับคู่กับประวัติที่บันทึกไว้แล้วพอดี
-- (อย่าเปลี่ยน version — จะทำให้ drift กลับมา)

-- google_cloud_email / google_project_id เป็นข้อมูลอ้างอิงสำหรับแอดมินเท่านั้น (ดู GoogleMapsSettings.jsx)
-- แม้แก้โค้ดฝั่งแอปไม่ให้ TenantContext ดึงมาแล้ว แต่ RLS policy "public can read active municipalities"
-- ยังอนุญาต SELECT ทั้งแถว (ไม่ได้จำกัดคอลัมน์) ทำให้ยังเรียก REST API ตรงๆ ข้าม UI ได้อยู่ดี
-- ปิดช่องนี้เพิ่มด้วยการ REVOKE สิทธิ์อ่านเฉพาะ 2 คอลัมน์นี้จาก anon/public — คอลัมน์อื่น (รวม
-- google_maps_api_key ซึ่งตั้งใจให้ browser เข้าถึงได้) ไม่กระทบ

REVOKE SELECT (google_cloud_email, google_project_id) ON public.municipalities FROM anon;
REVOKE SELECT (google_cloud_email, google_project_id) ON public.municipalities FROM public;
