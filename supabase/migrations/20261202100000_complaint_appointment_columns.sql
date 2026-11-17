-- 20261202100000_complaint_appointment_columns.sql
-- งาน 1.1 แผนเทียบคู่แข่ง (แกน E1): คำร้องแบบนัดหมาย + ตารางอัตราค่าบริการ (แสดงอย่างเดียว) + ภาพก่อน-หลังในหน้า /t/
-- เฟส 1/2 ของ migration ชุดนี้ — เพิ่มคอลัมน์อย่างเดียว (NOTES.md ข้อ 3: ADD COLUMN แล้วอ้างในไฟล์เดียวกันพัง 42703)
-- เฟส 2 = 20261202100100_complaint_appointment_functions.sql (CHECK + trigger + RPC + แก้ get_complaint_by_track_token)
--
-- ไม่มีสแนปช็อตข้อมูลก่อนแก้: ไฟล์นี้เพิ่มคอลัมน์ว่าง/ค่าเริ่มต้นเท่านั้น ไม่แก้แถวเดิม
-- ค่าเริ่มต้นที่มีผลกับทุก อปท. ทันทีหลังรัน:
--   requires_appointment = false (ทุกหมวดยังไม่เปิดนัด — แอดมินเปิดเองรายหมวด)
--   fee_rates = [] (ไม่แสดงอัตราใดๆ — อัตราต้องมาจากข้อบัญญัติของ อปท. นั้น ระบบไม่ใส่ตัวเลขให้)
--   track_photos = 'after' (เจ้าของระบบเลือก 2026-11-17: /t/ แสดงรูปหลังดำเนินการเมื่อเรื่องเสร็จ
--                          หมวดเฉพาะกิจ/อ่อนไหวถูกบังคับเป็น none ในฟังก์ชัน ไม่ว่าตั้งค่าไว้อย่างไร)
--   วันที่ประชาชนสะดวก ไม่ได้เพิ่มคอลัมน์ — เก็บใน complaints.extra_data ->> 'preferred_date' ผ่าน
--   submit_citizen_complaint_v4 ตัวเดิม (รับ extra_data แบบ scalar อยู่แล้ว) จึงไม่ต้องแก้ RPC ยื่นคำร้อง
--
-- สิทธิ์: complaints / complaint_categories ใช้ GRANT ระดับตาราง (ตรวจ relacl ฐานจริง 2026-11-17 ไม่มี column ACL)
-- คอลัมน์ใหม่จึงได้สิทธิ์ตามตารางเดิมทันที ไม่ต้อง GRANT ราย column แบบ municipalities

-- ── ย้อนกลับ (ย้อนไฟล์ 20261202100100 ก่อนเสมอ ไม่งั้นหน้า /t/ พังเพราะฟังก์ชันอ้างคอลัมน์ที่หายไป) ──
--   ALTER TABLE public.complaints DROP COLUMN IF EXISTS appointment_date, DROP COLUMN IF EXISTS appointment_slot,
--     DROP COLUMN IF EXISTS appointment_note, DROP COLUMN IF EXISTS appointment_set_at, DROP COLUMN IF EXISTS appointment_set_by;
--   ALTER TABLE public.complaint_categories DROP COLUMN IF EXISTS requires_appointment, DROP COLUMN IF EXISTS fee_rates,
--     DROP COLUMN IF EXISTS fee_reference, DROP COLUMN IF EXISTS track_photos;
--   ⚠️ วันนัดและตารางอัตราที่แอดมินกรอกไว้จะหายถาวร
-- ควรรันไฟล์ 20261202100100 ต่อทันที (ระหว่างสองไฟล์ คอลัมน์วันนัดยังไม่มี trigger กันเขียนตรง)

BEGIN;
-- ADD COLUMN ถือ ACCESS EXCLUSIVE บน complaints — ถ้าต้องต่อคิวหลัง transaction ยาว ให้ล้มเองแทนการค้างทั้งระบบคำร้อง
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'complaint_categories' AND column_name = 'requires_manual_intake'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20260915100000_complaint_auto_receive_columns.sql ก่อน';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'complaints' AND column_name = 'track_token'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261020160000_complaint_track_token_column.sql ก่อน';
  END IF;
END $$;

-- ── คำร้อง: วันนัดที่เจ้าหน้าที่ยืนยันแล้ว ─────────────────────────────────────────────────────────────
-- เขียนได้ทางเดียวคือ set_complaint_appointment() (trigger ในเฟส 2 กันการเขียนตรง)
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS appointment_date   date,
  ADD COLUMN IF NOT EXISTS appointment_slot   text,
  ADD COLUMN IF NOT EXISTS appointment_note   text,
  ADD COLUMN IF NOT EXISTS appointment_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS appointment_set_by uuid;

COMMENT ON COLUMN public.complaints.appointment_date IS
  'วันนัดเข้าดำเนินการที่เจ้าหน้าที่ยืนยัน (E1) — ไม่เลื่อน due_date: นัดหลังกำหนดแสดงเป็นป้าย "นัดหลังกำหนด" (เจ้าของเลือก 2026-11-17)';
COMMENT ON COLUMN public.complaints.appointment_slot IS 'ช่วงเวลานัด: morning / afternoon / allday';
COMMENT ON COLUMN public.complaints.appointment_note IS 'ข้อความถึงผู้แจ้ง (แสดงในหน้า /t/) — ห้ามใส่ชื่อ/เบอร์บุคคลอื่น';
-- ⚠️ ไม่ผูก FK กับ auth.users โดยตั้งใจ (migration-reviewer 2026-11-17): ON DELETE SET NULL จะ UPDATE คอลัมน์นี้
-- ตอนแอดมินลบบัญชี (delete_user_by_id รันในนาม authenticated) แล้วชน trg_guard_complaint_appointment → ลบบัญชีไม่ได้ตลอดไป
-- ผู้ทำรายการดูได้จาก complaint_timeline.actor_name อยู่แล้ว · ผลพลอยได้: apply ไม่ต้องล็อก auth.users
COMMENT ON COLUMN public.complaints.appointment_set_by IS
  'ผู้ตั้ง/เลื่อน/ยกเลิกนัดล่าสุด — ไม่มี FK โดยตั้งใจ (บัญชีที่ถูกลบแล้วค่าคงอยู่) ดูชื่อจาก complaint_timeline.actor_name';

-- ── หมวดคำร้อง: ตั้งค่าครั้งเดียวรายหมวด ────────────────────────────────────────────────────────────────
ALTER TABLE public.complaint_categories
  ADD COLUMN IF NOT EXISTS requires_appointment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fee_rates            jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fee_reference        text,
  ADD COLUMN IF NOT EXISTS track_photos         text    NOT NULL DEFAULT 'after';

COMMENT ON COLUMN public.complaint_categories.requires_appointment IS
  'หมวดนี้ใช้นัดวันเข้าดำเนินการ: ฟอร์มถามวันที่สะดวก + กล่องงานมีช่องยืนยันวันนัด';
COMMENT ON COLUMN public.complaint_categories.fee_rates IS
  'ตารางอัตราค่าบริการ [{item, unit, rate, note?}] แสดงอย่างเดียว ไม่รับเงิน — ต้องตรงข้อบัญญัติของ อปท. นั้น';
COMMENT ON COLUMN public.complaint_categories.fee_reference IS 'อ้างอิงข้อบัญญัติ/ประกาศที่กำหนดอัตรา (แสดงใต้ตาราง)';
COMMENT ON COLUMN public.complaint_categories.track_photos IS
  'รูปในหน้า /t/: none / after (รูปหลังดำเนินการเมื่อเสร็จ) / both (+ รูปที่ผู้แจ้งส่งมา) — หมวดเฉพาะกิจ/อ่อนไหวบังคับ none';

NOTIFY pgrst, 'reload schema';

COMMIT;
