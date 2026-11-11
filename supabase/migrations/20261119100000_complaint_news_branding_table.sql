-- ภาพข่าวประชาสัมพันธ์คำร้อง (PR 2) — ไฟล์ 1/2: ตารางเก็บรูปผู้บริหารที่ใช้บนภาพข่าว (DDL เท่านั้น)
--
-- ทำไมเป็นตารางแยก ไม่เพิ่มคอลัมน์ใน municipalities:
--   municipalities ใช้ column-level SELECT grant — ADD COLUMN แล้วลืม GRANT ทำทุกเว็บขึ้น "ไม่พบหน่วยงาน" (42501)
--   ตารางนี้ปิดสิทธิ์ตรงทั้งหมด เข้าได้ผ่าน RPC ในไฟล์ 2/2 เท่านั้น จึงไม่แตะ grant ของ municipalities เลย
--
-- ทำไมเก็บ photo_identity (ไม่ใช่ FK ไป profiles):
--   รูปผูกกับ "ตัวคน" ที่เป็นผู้ลงนามช่องนายกตอนอัปโหลด — เปลี่ยนนายกแล้วลืมเปลี่ยนรูป ภาพข่าวต้องไม่ขึ้นรูปคนเก่า
--   คู่กับชื่อคนใหม่ (RPC คืนรูปเฉพาะเมื่อ identity ตรงกับผู้ลงนามช่องนายกที่มีผลวันนี้)
--   identity = 'p:<profile_id>' (มีบัญชี) หรือ 'm:<ชื่อที่พิมพ์ ตัดช่องว่างทั้งหมด>' (ผู้ลงนามพิมพ์ชื่อเอง)
--   — กติกา "คนเดียวกัน" ชุดเดียวกับ set_document_signatory (20261007120000) · ไม่มี FK จึงไม่ขวางการลบ/รวมโปรไฟล์
--   ชื่อ/ตำแหน่งไม่เก็บซ้ำที่นี่ — อ่านจากทะเบียนผู้ลงนามกลาง (document_signatories) แหล่งเดียว
--
-- ทำไมเก็บ file id ไม่ใช่ URL: URL ของ drive-file มีโดเมนโปรเจกต์ — ไม่ฝังลง repo · หน้าเว็บประกอบ URL เอง
--   RPC ตั้งรูปตรวจกับ drive_files ว่าเป็นรูปสาธารณะของ อปท. นั้นจริง
--
-- updated_by: ON DELETE SET NULL = ลบโปรไฟล์ผู้อัปโหลดแล้วเสียร่องรอยในแถวนี้ (ร่องรอยหลักอยู่ใน audit_logs)
--   ⚠️ merge_duplicate_profile ยังไม่ย้ายคอลัมน์นี้ — จดในงานค้างของฟังก์ชันนั้นแล้ว
--
-- ย้อนกลับ: DROP TABLE public.municipality_pr_branding;  (ต้อง DROP ฟังก์ชันในไฟล์ 2/2 ก่อน)

CREATE TABLE IF NOT EXISTS public.municipality_pr_branding (
  municipality_id          uuid PRIMARY KEY REFERENCES public.municipalities(id) ON DELETE CASCADE,
  executive_photo_file_id  text
    CHECK (executive_photo_file_id IS NULL OR executive_photo_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  photo_identity           text
    CHECK (photo_identity IS NULL OR (length(photo_identity) BETWEEN 3 AND 300 AND photo_identity ~ '^[pm]:')),
  updated_by               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (executive_photo_file_id IS NULL OR photo_identity IS NOT NULL)
);

COMMENT ON TABLE public.municipality_pr_branding IS
  'รูปผู้บริหารบนภาพข่าวประชาสัมพันธ์คำร้อง — เข้าผ่าน RPC complaint_news_branding / set_complaint_news_executive_photo เท่านั้น';

-- ไม่มี policy ใดๆ = ตรงๆ อ่าน/เขียนไม่ได้ทุก role (RPC เป็น SECURITY DEFINER)
ALTER TABLE public.municipality_pr_branding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.municipality_pr_branding FROM PUBLIC, anon, authenticated;

-- ── ด่านท้ายไฟล์ (ล้ม = ย้อนกลับทั้งไฟล์) ── REVOKE ที่ grantor ไม่ตรงผ่านเงียบๆ แต่สิทธิ์ยังอยู่
DO $$
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_class AS c WHERE c.oid = 'public.municipality_pr_branding'::regclass) THEN
    RAISE EXCEPTION 'complaint_news_branding_table: RLS ไม่ได้เปิด';
  END IF;
  IF has_table_privilege('anon', 'public.municipality_pr_branding', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.municipality_pr_branding', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'complaint_news_branding_table: anon/authenticated ยังมีสิทธิ์บนตาราง';
  END IF;
END $$;
