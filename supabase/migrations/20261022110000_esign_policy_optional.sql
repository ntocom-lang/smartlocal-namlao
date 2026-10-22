-- ลงนามออนไลน์รายเรื่อง — ชุด B1.5 (1/2): ประกาศ/หนังสือให้ความเห็นชอบ เปลี่ยนจาก "บังคับกรอก" เป็น "กรอกเมื่อมี"
-- เจ้าของระบบสั่ง 2026-10-22: ไม่ให้ประกาศของ อปท. เป็นเงื่อนไขขวางการเปิดใช้ (ลดภาระหน่วยงาน)
-- ข้อกำหนดตาม พ.ร.ฎ.ธุรกรรมอิเล็กทรอนิกส์ภาครัฐ ๒๕๔๙ มาตรา ๗ ไม่ได้หายไป — เป็นหน้าที่ของ อปท. ที่ระบบไม่บังคับแทน
--
-- ไฟล์นี้แก้โครงสร้างอย่างเดียว (ข้อ 2/2 คือฟังก์ชัน) ตามกติกาแยกไฟล์ตามเฟส (docs/ai/NOTES.md ข้อ 3)
-- CHECK เดิมของ 3 คอลัมน์ยังอยู่ — ค่า NULL ผ่าน CHECK ส่วนค่าที่กรอกแล้วยังต้องถูกรูปแบบ
-- ตาราง esign_tenant_policy ยังว่าง (0 แถว ตรวจบนฐานจริงหลังชุด A) จึงไม่มีข้อมูลเดิมให้กระทบ

DO $guard$
BEGIN
  IF to_regclass('public.esign_tenant_policy') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261022100100_esign_tables.sql ก่อน';
  END IF;
END;
$guard$;

ALTER TABLE public.esign_tenant_policy ALTER COLUMN announcement_no DROP NOT NULL;
ALTER TABLE public.esign_tenant_policy ALTER COLUMN announcement_date DROP NOT NULL;
ALTER TABLE public.esign_tenant_policy ALTER COLUMN approval_ref DROP NOT NULL;

COMMENT ON COLUMN public.esign_tenant_policy.announcement_no IS
  'เลขที่ประกาศของ อปท. (ไม่บังคับ — บันทึกเมื่อมี) ตาม พ.ร.ฎ.ธุรกรรมอิเล็กทรอนิกส์ภาครัฐ ๒๕๔๙ มาตรา ๗';
COMMENT ON COLUMN public.esign_tenant_policy.approval_ref IS
  'หนังสือให้ความเห็นชอบ หรือคำชี้แจงว่าไม่ต้องขอ (ไม่บังคับ — บันทึกเมื่อมี)';
