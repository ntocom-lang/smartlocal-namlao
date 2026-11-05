-- ประทับ "บัญชีที่สร้างแถวจริง" ลงคำขอบริการ/เอกสาร ไฟล์ 1/2 (เจ้าของระบบสั่ง 2569-11-05, ต่อจาก #645)
--
-- ที่มา: หน้ากล่องงานแสดง "กรอกแทนโดย ..." ของคำขอที่เจ้าหน้าที่กรอกที่เคาน์เตอร์ แต่รหัสผู้กรอกมาจาก
-- permit_form_data.signed_by.entered_by_staff_id ซึ่งเบราว์เซอร์ของเจ้าหน้าที่เขียนมาเอง ฐานข้อมูลไม่ได้ตรวจ
-- จึงใช้เป็นหลักฐานเมื่อมีข้อพิพาทไม่ได้ (ใครแก้ฟอร์มก่อนส่งก็ใส่ชื่อคนอื่นได้)
--
-- ไฟล์นี้: เพิ่มคอลัมน์ created_by_uid — ค่าจริงของ auth.uid() ตอน INSERT ที่ตัวกระตุ้นในไฟล์ 2/2 (20261105110100) ประทับให้
--   - ไม่ใส่ FOREIGN KEY โดยตั้งใจ: นี่คือรอยตรวจสอบ ไม่ใช่ความสัมพันธ์ — ถ้าผูก FK แล้วบัญชีเจ้าหน้าที่ที่ลาออกจะลบไม่ได้
--     (หรือถ้าตั้ง ON DELETE SET NULL รอยก็หายตอนลบบัญชี ซึ่งตรงข้ามกับเหตุผลที่มี) บัญชีที่ลบแล้วจะแสดงเป็น "ไม่พบชื่อ (รหัส …)"
--   - แถวเดิมก่อนไฟล์นี้เป็น NULL ไม่ย้อนเติมจากค่าที่เบราว์เซอร์อ้างไว้ — จะกลายเป็นของปลอมที่ดูเหมือนฐานข้อมูลยืนยันแล้ว
--     (หน้าจอแสดงแถวเก่าด้วยค่าที่อ้างไว้เดิม พร้อมป้ายว่ายังไม่ได้ยืนยัน)
--   - NULL ในแถวใหม่ = ไม่มีผู้ล็อกอินตอนบันทึก (ยื่นแบบไม่ล็อกอิน หรือเส้นทางที่ใช้ service role)
-- ⚠️ ตามกติกา "1 ไฟล์ = 1 เฟส" (docs/ai/NOTES.md ข้อ 3): คอลัมน์ต้องอยู่คนละไฟล์กับตัวกระตุ้นที่อ้างมัน
BEGIN;

ALTER TABLE public.document_requests ADD COLUMN IF NOT EXISTS created_by_uid uuid;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'document_requests'
      AND column_name = 'created_by_uid' AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Column drift: document_requests.created_by_uid มีอยู่แล้วแต่ไม่ใช่ uuid';
  END IF;
END $guard$;

COMMENT ON COLUMN public.document_requests.created_by_uid IS
  'auth.uid() จริงของผู้ล็อกอินตอน INSERT ประทับโดยตัวกระตุ้น stamp_document_request_creator ไม่เชื่อค่าจากเบราว์เซอร์ และแก้ภายหลังไม่ได้ NULL = ไม่มีผู้ล็อกอินหรือแถวเก่าก่อนมีคอลัมน์นี้';

COMMIT;
