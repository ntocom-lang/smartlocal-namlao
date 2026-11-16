-- 20261130100000_data_center_shape_batch_columns.sql
--
-- ศูนย์รวมข้อมูลดิจิทัล — นำเข้า GIS เฟส 2 (DDL เท่านั้น)
-- ตามกติกา docs/ai/NOTES.md ข้อ 3: ADD COLUMN แยกไฟล์จากฟังก์ชันที่อ้างคอลัมน์นั้น
-- ฟังก์ชันอยู่ใน 20261130100100_data_center_shape_batch_rpc.sql (ต้องรันไฟล์นี้ก่อน)
--
-- shape = ชนิดรูปทรงของรายการ ('point' จุด / 'line' เส้น / 'polygon' พื้นที่)
--   เหตุที่ต้องเก็บแยก ไม่เดาจาก route_points: เส้นที่ปิดวง (จุดแรก = จุดสุดท้าย) เป็นได้ทั้งพื้นที่และถนนวงแหวน
--   เดาผิดเมื่อไรถนนจะถูกระบายสีเป็นพื้นที่ทึบ
--   NULL = รายการเดิมก่อนมีคอลัมน์นี้ — ไม่ backfill ข้อมูลจริงโดยตั้งใจ (เจ้าของระบบเลือก 2026-11-16)
--   ฟังก์ชันหมุดแผนที่อนุมานให้เอง: route_points >= 2 จุด = 'line' นอกนั้น = 'point' (ตรงกับพฤติกรรมหน้าเว็บเดิม)
--   ⚠️ ห้ามเพิ่ม shape เข้ารายการคอลัมน์ "เนื้อหา" ของ trigger data_center_touch_updated_at
--      ถ้าวันหน้ามีคน backfill จะดัน updated_at ทุกแถว แล้วสัญญาณ "ไม่ได้ตรวจทานนาน" หายทั้งระบบ
--      (shape เปลี่ยนพร้อม route_points เสมอ ซึ่งอยู่ในรายการนั้นแล้ว)
--
-- import_batch_id = เลขชุดการนำเข้าไฟล์ 1 ครั้ง (หน้าเว็บสร้าง uuid ครั้งเดียวต่อการกดนำเข้า)
--   ใช้กับปุ่ม "ยกเลิกการนำเข้าทั้งชุด" — NULL = รายการที่กรอกเองหรือนำเข้าก่อนมีคอลัมน์นี้
--   ไม่มี FK/ตารางชุด: ข้อมูลของชุด (จำนวน/เวลา/ผู้นำเข้า) คำนวณจากแถวเองใน data_center_import_batches()
--   ไม่ใช่ข้อมูลส่วนบุคคล (เป็นป้ายจัดกลุ่ม ระดับเดียวกับ created_by ที่ตารางนี้มีอยู่แล้ว)
--
-- RLS: ไม่แก้ นโยบาย INSERT/UPDATE/DELETE เดิม (20260802071000) คุมคอลัมน์ใหม่ด้วยสิทธิ์ระดับตารางเดิม
-- ตารางนี้ไม่ได้ใช้ column-level GRANT (ต่างจาก municipalities) ไม่ต้อง GRANT คอลัมน์เพิ่ม
-- ไม่มีการเขียนข้อมูลแถวเดิมในไฟล์นี้ (ADD COLUMN ที่ไม่มี DEFAULT ไม่ rewrite ตาราง)

ALTER TABLE public.data_center_entries
  ADD COLUMN IF NOT EXISTS shape text
    CONSTRAINT data_center_entries_shape_check CHECK (shape IN ('point', 'line', 'polygon')),
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

-- ใช้ตอนรวมชุด/ยกเลิกชุด — มีค่าเฉพาะรายการที่นำเข้าจากไฟล์ จึงเป็น partial index
CREATE INDEX IF NOT EXISTS idx_dce_import_batch
  ON public.data_center_entries (municipality_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;

COMMENT ON COLUMN public.data_center_entries.shape IS
  'ชนิดรูปทรง point/line/polygon — NULL = รายการเดิมก่อนเฟส 2 (อนุมานจาก route_points: >=2 จุด = line)';
COMMENT ON COLUMN public.data_center_entries.import_batch_id IS
  'เลขชุดการนำเข้าไฟล์ (1 ค่าต่อการกดนำเข้า 1 ครั้ง) ใช้ยกเลิกทั้งชุด — NULL = กรอกเอง/นำเข้าก่อนมีคอลัมน์นี้';

NOTIFY pgrst, 'reload schema';
