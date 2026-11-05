-- ประทับ "บัญชีที่สร้างแถวจริง" ลงคำขอบริการ/เอกสาร ไฟล์ 2/2 (ต่อจาก 20261105110000) — ต้อง apply ไฟล์ 1 ก่อน
--
-- 1) stamp_document_request_creator (BEFORE INSERT): ตั้ง created_by_uid = auth.uid() ทับค่าที่ client ส่งมาทุกกรณี
--    ครอบคลุมทุกทางที่ INSERT ลงตารางนี้ — วิซาร์ดที่ insert ตรง และ RPC (ยืมพัสดุ/รถรับ-ส่ง) ซึ่ง auth.uid() ยังเป็นผู้เรียกจริง
-- 2) keep_document_request_creator (BEFORE UPDATE OF created_by_uid): สั่งแก้คอลัมน์นี้ให้เงียบๆ คงค่าเดิม
--    ไม่ RAISE เพราะเส้นทางเดิมที่ UPDATE ทั้งแถวด้วยค่าที่อ่านมา (ถ้ามี) จะได้ไม่พังทั้งก้อน — ผลคือค่าเปลี่ยนไม่ได้เลย แม้แอดมิน
--    (ตั้งใจ: รอยตรวจสอบต้องไม่มีใครแก้ได้จากหน้าระบบ ผู้ดูแลฐานข้อมูลที่ปิดตัวกระตุ้นเองเท่านั้นที่ทำได้)
--
-- ไม่แก้ฟังก์ชัน/ตัวกระตุ้นเดิมของตารางนี้สักตัว (route_document_request_department, protect_document_request_scope,
-- guard_cctv_footage_request) — สร้างของใหม่ชื่อใหม่ล้วน จึงไม่มีความเสี่ยงเรื่อง CREATE OR REPLACE ทับทั้งฟังก์ชัน
-- (docs/ai/NOTES.md ข้อ 5) · ตัวกระตุ้นทุกตัวมี RETURN NEW ทุกเส้นทาง
--
-- ⚠️ สิ่งที่ไม่ได้ทำ: ไม่ได้ทำให้ "ผู้กรอกแทน" ถูกต้องเสมอ — แค่บันทึกว่าบัญชีไหนกดบันทึกจริง ถ้าเจ้าหน้าที่ยืมบัญชีกันกรอก
--   รอยจะชี้คนเจ้าของบัญชี (ปัญหาระดับการใช้บัญชีร่วม ไม่ใช่ปัญหาของตัวกระตุ้น)
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'document_requests'
      AND column_name = 'created_by_uid' AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'ต้อง apply 20261105110000 ก่อน (ไม่มี document_requests.created_by_uid)';
  END IF;
  -- ชื่อฟังก์ชันของเราห้ามชนกับของใครที่มีอยู่ก่อนและไม่ใช่ของเรา (รันซ้ำไฟล์นี้ได้ — ของเรามีคำว่า created_by_uid ในตัวบท)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
             WHERE p.oid IN (to_regprocedure('public.stamp_document_request_creator()'),
                             to_regprocedure('public.keep_document_request_creator()'))
               AND p.prosrc NOT LIKE '%created_by_uid%') THEN
    RAISE EXCEPTION 'Function drift: มีฟังก์ชันชื่อ stamp/keep_document_request_creator ที่ไม่ใช่ของไฟล์นี้';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.stamp_document_request_creator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.created_by_uid := auth.uid();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_document_request_creator() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.keep_document_request_creator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.created_by_uid := OLD.created_by_uid;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_document_request_creator() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_document_request_creator_trigger ON public.document_requests;
CREATE TRIGGER stamp_document_request_creator_trigger
  BEFORE INSERT ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.stamp_document_request_creator();

DROP TRIGGER IF EXISTS keep_document_request_creator_trigger ON public.document_requests;
CREATE TRIGGER keep_document_request_creator_trigger
  BEFORE UPDATE OF created_by_uid ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.keep_document_request_creator();

COMMIT;
