-- 20261025100000_complaint_parked_columns.sql
--
-- [เฟส DDL] สถานะ "ขึ้นทะเบียนรอดำเนินการ" (parked) — เรื่องที่รับไว้แล้วแต่ อปท. ยังไม่พร้อมดำเนินการ
-- ฟังก์ชัน/trigger/CHECK ที่อ้างคอลัมน์ใหม่อยู่ไฟล์ถัดไป 20261025100100 (แยกไฟล์ตามกติกา NOTES ข้อ 3)
--
-- [ทำไมมี] เจ้าของระบบ 2569-10-24: คำร้อง "ซ่อมแซมถนนทางการเกษตร" ส่งมาจำนวนมากแต่ยังไม่พร้อมซ่อม
-- ลบก็เสียดาย (รูป/พิกัดคือข้อมูลความต้องการไว้ใช้ตอนวางแผน) สถานะเดิมใช้ไม่ได้:
--   ค้าง received → ขึ้นเกินกำหนดและฉุดผลงานเจ้าหน้าที่ · ปิด closed → บันทึกเท็จ ("ดำเนินการแล้ว")
--   ปฏิเสธ rejected → ผู้ร้องเห็นว่าถูกปฏิเสธ ทั้งที่แค่ยังไม่พร้อม
--
-- [การเก็บข้อมูลติดต่อ] ไม่แก้ complaint_contact_retention_anchor โดยเจตนา: ฟังก์ชันนั้นนับ 5 ปีเฉพาะเรื่องที่
-- status IN ('closed','done','completed','rejected') — 'parked' ไม่อยู่ในรายการ จึงไม่มีหมุดเวลา = ไม่ถูกลบ
-- ตามที่เจ้าของระบบกำหนด (ไม่มีกำหนดระหว่างรอดำเนินการ พอซ่อมเสร็จและปิดเรื่องจึงเริ่มนับ 5 ปีตามเดิม)
-- ⚠️ ห้ามเพิ่ม 'parked' เข้ารายการนั้นโดยไม่ถามเจ้าของระบบ/DPO

-- ── 1) ธงรายหมวด: อนุญาตให้ "ขึ้นทะเบียนรอดำเนินการ" ได้หรือไม่ ─────────────────────
-- ค่าตั้งต้น false ทุกหมวด — เปิดรายหมวดเองในหน้า "ประเภทคำร้อง" (หมวดเร่งด่วน เช่น น้ำท่วม ต้องไม่ถูกพักโดยพลาด)
ALTER TABLE public.complaint_categories
  ADD COLUMN IF NOT EXISTS allow_parking boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.complaint_categories.allow_parking IS
  'true = หัวหน้ากอง/แอดมินกด "ขึ้นทะเบียนรอดำเนินการ" ได้ (park_complaints) — เรื่องจะไม่นับเป็นงานค้างหรือเกินกำหนด';

-- ── 2) ข้อมูลการขึ้นทะเบียนของแต่ละเรื่อง ─────────────────────────────────────────
-- ล้างเองโดย trigger เมื่อสถานะออกจาก 'parked' (guard_complaint_parked ไฟล์ถัดไป)
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS parked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS parked_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parked_reason text;

COMMENT ON COLUMN public.complaints.parked_at IS 'เวลาที่ขึ้นทะเบียนรอดำเนินการ (NULL = ไม่ได้อยู่สถานะนี้)';
COMMENT ON COLUMN public.complaints.parked_by IS 'ผู้กดขึ้นทะเบียนรอดำเนินการ';
COMMENT ON COLUMN public.complaints.parked_reason IS 'รหัสเหตุผล: plan | budget | authority | season | other (รายละเอียดอยู่ใน complaint_timeline)';

-- ── 3) เพิ่มค่า 'parked' ใน CHECK ของสถานะ ────────────────────────────────────────
-- ⚠️ คัดค่าเดิมจาก production (pg_get_constraintdef 2026-10-24) ครบทั้ง 8 ค่า แล้วเพิ่ม 'parked' ท้ายสุด
-- ค่าใหม่ทำให้ client รุ่นเก่าที่ยังเปิดค้างอ่านไม่เป็น (แสดงเป็น "คำร้องใหม่") — ยังไม่มีเรื่องไหนเป็น 'parked'
-- จนกว่าจะเปิดธงรายหมวดและมีคนกดจริง ซึ่งเกิดหลัง deploy หน้าเว็บที่รู้จักสถานะนี้แล้วเท่านั้น (NOTES ข้อ 1)
ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_status_check;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_status_check
  CHECK (status IN (
    'new', 'in_progress', 'done', 'closed', 'rejected',
    'pending', 'received', 'completed',
    'parked'
  ));

-- ตรวจหลัง apply:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'complaints_status_check';
--   select column_name from information_schema.columns
--    where table_name = 'complaints' and column_name like 'parked_%';          → 3 แถว
--   select value, allow_parking from public.complaint_categories where allow_parking;  → ว่าง (ยังไม่เปิดหมวดไหน)
