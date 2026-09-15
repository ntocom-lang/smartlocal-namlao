-- 20260915110000_complaint_finish_columns.sql
--
-- [เฟส DDL] ผู้รับผิดชอบปิดงานเอง + ปักหมุดจุดแก้ไข + ประวัติการแก้ข้อความ
-- ฟังก์ชัน/trigger/RPC อยู่ไฟล์ถัดไป 20260915110100 (แยกไฟล์ตามกติกา ADD COLUMN/CREATE TABLE แล้วอ้างในไฟล์เดียวกันไม่ได้)
--
-- เจ้าของระบบตัดสินใจ 2569-09-15:
--   1) ตัดขั้น "ปิดเรื่องแล้ว" ที่แอดมินตรวจรับออก สถานะสุดท้ายคือ "ดำเนินการแล้ว" ซึ่งผู้รับผิดชอบกดเอง
--      (ทุก role รวม staff) — ใช้ค่า 'closed' เดิมในฐานข้อมูลเป็นสถานะสุดท้าย เพราะฟังก์ชันที่นับ
--      "เรื่องจบแล้ว" (ให้คะแนน, หน้าติดตามสาธารณะ, สถิติ, ระยะเวลาเก็บข้อมูลติดต่อ, งานค้าง)
--      อ่าน 'closed' อยู่แล้วทั้งหมด ไม่ต้องเขียนฟังก์ชันเหล่านั้นใหม่
--   2) ก่อนปิดต้องมีหมุดจุดที่ดำเนินการ รูปไม่บังคับ — หมวดที่ไม่มีสถานที่ยกเว้นรายหมวดได้
--   3) ผู้ร้องเปิดเรื่องกลับได้ภายใน 7 วัน 1 ครั้ง กลับไปผู้รับผิดชอบเดิมทันที
--   4) ผู้รับผิดชอบแก้ข้อความของคำร้องที่ตนรับผิดชอบได้ รวมข้อความที่ผู้ร้องพิมพ์มา
--      ⚠️ ข้อความของผู้ร้องคือหลักฐาน จึงเก็บค่าเดิมทุกรุ่นไว้ใน complaint_text_revisions ซึ่งไม่มีใคร
--      แก้/ลบได้ผ่าน API (เขียนได้ทาง trigger เท่านั้น) แอดมินและผู้ร้องเปิดดูเทียบได้

-- ── 1) ธงรายหมวด: ต้องปักหมุดก่อนปิดงานหรือไม่ ─────────────────────────────────
ALTER TABLE public.complaint_categories
  ADD COLUMN IF NOT EXISTS requires_resolved_location boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.complaint_categories.requires_resolved_location IS
  'true = ก่อนเปลี่ยนเป็น "ดำเนินการแล้ว" ต้องปักหมุดจุดที่ดำเนินการ (resolved_latitude/longitude)';

-- หมวดที่เรื่องไม่มีจุดดำเนินการบนแผนที่ — ค่าตั้งต้น แอดมินสลับเองได้ในหน้า "ประเภทคำร้อง"
UPDATE public.complaint_categories
SET requires_resolved_location = false
WHERE value IN ('corruption', 'grievance', 'tax', 'borrow_equipment', 'other')
  AND requires_resolved_location = true;

-- ── 2) หมุดจุดที่ดำเนินการ ─────────────────────────────────────────────────────
-- แยกจาก latitude/longitude ของผู้ร้อง (จุดที่แจ้ง) — ผู้แจ้งอาจปักหน้าบ้าน แต่เสาไฟที่ซ่อมอยู่ปากซอย
-- ใครปิด/เมื่อไร: resolved_by + closed_at (closed_at มีอยู่แล้วและทุกฟังก์ชันนับจากคอลัมน์นี้)
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS resolved_latitude  double precision,
  ADD COLUMN IF NOT EXISTS resolved_longitude double precision,
  ADD COLUMN IF NOT EXISTS resolved_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.complaints
  DROP CONSTRAINT IF EXISTS complaints_resolved_location_check;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_resolved_location_check CHECK (
    (resolved_latitude IS NULL AND resolved_longitude IS NULL)
    OR (
      resolved_latitude BETWEEN -90 AND 90
      AND resolved_longitude BETWEEN -180 AND 180
      AND NOT (resolved_latitude = 0 AND resolved_longitude = 0)
    )
  );

COMMENT ON COLUMN public.complaints.resolved_latitude IS 'หมุดจุดที่ผู้รับผิดชอบดำเนินการ (ปักตอนกด "ดำเนินการแล้ว")';
COMMENT ON COLUMN public.complaints.resolved_by IS 'ผู้กด "ดำเนินการแล้ว" — เวลาอยู่ที่ closed_at';

-- ── 3) ประวัติการแก้ข้อความ ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.complaint_text_revisions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  complaint_id    uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  field           text NOT NULL CHECK (field IN ('subject', 'detail', 'technician_note')),
  old_value       text,
  new_value       text,
  edited_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  edited_by_name  text,
  edited_role     text,
  edited_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS complaint_text_revisions_complaint_idx
  ON public.complaint_text_revisions (complaint_id, edited_at);

ALTER TABLE public.complaint_text_revisions ENABLE ROW LEVEL SECURITY;

-- อ่านได้: ผู้ร้องเจ้าของเรื่อง, ผู้รับผิดชอบ, แอดมินของ อปท. นั้น, superadmin
-- ไม่เปิดให้เจ้าหน้าที่คนอื่นในกอง — ข้อความเดิมอาจมีข้อมูลส่วนบุคคลที่ผู้แก้ตั้งใจเอาออก
DROP POLICY IF EXISTS "scoped read complaint text revisions" ON public.complaint_text_revisions;
CREATE POLICY "scoped read complaint text revisions"
ON public.complaint_text_revisions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.complaints AS c
    WHERE c.id = complaint_text_revisions.complaint_id
      AND (
        c.user_id = auth.uid()
        OR c.assigned_to = auth.uid()
        OR public.get_my_role() = 'superadmin'
        OR (public.get_my_role() = 'admin' AND c.municipality_id = public.get_my_municipality_id())
      )
  )
);

-- เขียนได้ทาง trigger (SECURITY DEFINER) เท่านั้น — ไม่มีใครแก้/ลบประวัติผ่าน API
REVOKE ALL ON TABLE public.complaint_text_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.complaint_text_revisions TO authenticated;

COMMENT ON TABLE public.complaint_text_revisions IS
  'ประวัติการแก้ข้อความคำร้อง (เรื่อง/รายละเอียด/บันทึกผล) ทุกรุ่น เขียนโดย trigger เท่านั้น แก้/ลบผ่าน API ไม่ได้';

-- ตรวจหลัง apply:
--   select value, requires_resolved_location from public.complaint_categories
--    where not requires_resolved_location group by 1,2;
--   → corruption, grievance, tax, borrow_equipment, other (เท่าที่มีในแต่ละ อปท.)
