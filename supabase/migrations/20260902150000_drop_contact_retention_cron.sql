-- 20260902150000_drop_contact_retention_cron.sql
--
-- ถอดงานอัตโนมัติ complaint-contact-retention-daily ที่ตั้งไว้ใน 20260902120000 ออก
-- ตามการตัดสินใจของเจ้าของระบบ: การจัดการเรื่องเมื่อครบกำหนดให้เป็นการกระทำของแอดมินที่ตั้งใจ
-- ไม่ใช่ให้ระบบลบข้อมูลของประชาชนเองตอนตีหนึ่งครึ่งโดยไม่มีใครเห็น
--
-- สิ่งที่ถอด: เฉพาะตัวตั้งเวลา (cron job) เท่านั้น
-- สิ่งที่คงไว้ทั้งหมด:
--   - purge_expired_complaint_contacts()  ยังอยู่ และยัง REVOKE จากทุก role ที่เรียกผ่าน API ได้
--     เรียกได้จาก SQL editor ของผู้ดูแลฐานข้อมูลเท่านั้น (มี p_dry_run ให้ตรวจก่อนเสมอ)
--   - complaint_contact_retention_preview()  แอดมินยังเรียกดูได้ว่ามีกี่เรื่องที่ถึงกำหนดแล้ว
--   - complaint_contact_retention_anchor()   กติกาหมุดเวลายังเป็นตัวเดียวกัน
--   - complaints.contact_purged_at           ยังบันทึกว่าเรื่องไหนถูกลบข้อมูลติดต่อไปแล้ว
-- กลไกทั้งชุดจึงยังพร้อมใช้ ถ้าวันหลังตัดสินใจเปิดงานอัตโนมัติอีกครั้งให้รันคำสั่งท้ายไฟล์นี้
--
-- ⚠️ ผลที่ตามมาที่ต้องรับรู้: ตราบใดที่ไม่มีใครสั่งลบ ข้อมูลติดต่อของผู้แจ้ง (ชื่อ-นามสกุล เบอร์โทร)
-- จะถูกเก็บไว้ตลอดไป ขณะที่หน้าฟอร์มและนโยบายความเป็นส่วนตัวประกาศกับประชาชนว่าเก็บ 5 ปี
-- นับจากวันปิดเรื่อง — ต้องปิดช่องว่างนี้ทางใดทางหนึ่ง (แก้ข้อความให้ตรงกับที่ทำได้จริง,
-- ทำปุ่มให้แอดมินสั่งลบเมื่อครบกำหนด, หรือเปิด cron กลับ) ไม่ควรปล่อยค้างไว้

SELECT cron.unschedule('complaint-contact-retention-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'complaint-contact-retention-daily');

-- ตรวจหลัง apply — ต้องได้ 0 แถว:
--   SELECT jobname, schedule, active FROM cron.job
--    WHERE jobname = 'complaint-contact-retention-daily';
--
-- เปิดงานอัตโนมัติกลับ (18:30 UTC = 01:30 น. เวลาไทย):
--   SELECT cron.schedule('complaint-contact-retention-daily', '30 18 * * *',
--     $job$ SELECT public.purge_expired_complaint_contacts(); $job$);
--
-- สั่งลบด้วยมือเมื่อแอดมินตัดสินใจแล้ว (ตรวจก่อนเสมอ):
--   SELECT public.purge_expired_complaint_contacts('5 years', true);   -- ดูจำนวน ไม่ลบ
--   SELECT public.purge_expired_complaint_contacts('5 years');         -- ลบจริง + ลง audit_logs
