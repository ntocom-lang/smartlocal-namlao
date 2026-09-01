-- เฟส 1/3 ของ "ยื่นคำขอใช้รถแทนผู้อื่น" — ไฟล์นี้เพิ่มคอลัมน์ + backfill เท่านั้น
-- ฟังก์ชัน/trigger ที่อ้างคอลัมน์นี้อยู่ใน 20260903140000 และ 20260903150000
-- (แยกไฟล์เพราะ ADD COLUMN แล้วอ้างในไฟล์เดียวกันเคยได้ error 42703)
--
-- ปัญหาหน้างาน: เจ้าหน้าที่อาวุโสบางท่านใช้ระบบไม่คล่อง ต้องฝากเพื่อนร่วมกองกรอกคำขอให้
-- แต่ใบขออนุญาตใช้รถ (แบบ 3) พิมพ์ชื่อจาก created_by ซึ่งถูก trigger บังคับเป็น auth.uid()
-- เสมอ (20260902170000) ชื่อบนเอกสารจึงเป็นคนพิมพ์ ไม่ใช่ผู้ขอตัวจริง
--
-- ทางแก้: แยกสองบทบาทออกจากกัน ห้ามปลดล็อก created_by เด็ดขาด
--   created_by   = ผู้บันทึกรายการ (คนกด) — ยังบังคับ auth.uid() ไว้เหมือนเดิม เป็นฐานตรวจสอบ
--                  ย้อนหลังว่าใครเป็นคนทำรายการ ถ้าปลดล็อกให้ชี้คนอื่นได้ = ปลอมตัวผู้ขอได้เงียบๆ
--   requested_by = ผู้ขอใช้รถตัวจริง — ชื่อที่ขึ้นบนแบบ 3 และเป็นผู้ลงนามในเอกสาร
--
-- ⚠️ การบันทึกแทนไม่ใช่การลงนามแทน ผู้ขอตัวจริงยังต้องลงนามในใบขออนุญาตด้วยตนเอง

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.fleet_trips.requested_by IS
  'ผู้ขอใช้รถตัวจริง (ชื่อบนใบขออนุญาตแบบ 3) — อาจต่างจาก created_by ที่เป็นผู้บันทึกรายการแทน';
COMMENT ON COLUMN public.fleet_trips.created_by IS
  'ผู้บันทึกรายการ (คนกดในระบบ) บังคับเป็น auth.uid() เสมอ ห้ามแก้ — ดู requested_by สำหรับผู้ขอตัวจริง';

-- ทริปเดิมทุกแถว ผู้บันทึก = ผู้ขอ อยู่แล้ว จึงชี้ทับกันได้ตรงๆ
-- ทำก่อนสร้าง trigger ในไฟล์ถัดไป เพื่อไม่ให้ trigger ยิงระหว่าง backfill
UPDATE public.fleet_trips
   SET requested_by = created_by
 WHERE requested_by IS NULL
   AND created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS fleet_trips_requested_by_idx
  ON public.fleet_trips (requested_by);
