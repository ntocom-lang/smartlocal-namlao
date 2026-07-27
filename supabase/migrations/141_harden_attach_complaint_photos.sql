-- 141_harden_attach_complaint_photos.sql
-- attach_complaint_photos รองรับ flow ยื่นคำร้องแบบไม่ login (anon) โดยใช้
-- "user_id IS NULL AND created_at > now() - 2 ชม." เป็นตัวพิสูจน์ตัวตนแทน auth.uid()
-- ปัญหา: ใครก็ได้ที่รู้/เดา complaint_id ของคำร้อง anon ที่สร้างใน 2 ชม.ล่าสุด
-- (เช่น จาก get_complaint_by_ref ที่ยัง return id เสมอ) เรียกแทนที่ attachments
-- ด้วย URL อะไรก็ได้ ไม่ต้องเป็นไฟล์จริงในโฟลเดอร์คำร้องนั้นเลย
-- แก้: (1) ลดหน้าต่างเวลาเหลือ 15 นาที (พอสำหรับ retry ตอน submit จริง)
--     (2) บังคับทุก url ต้องมี complaint_id เป็น path segment จริงตาม convention
--         ที่ client ใช้ (`${complaintId}/${filename}`) กัน inject url ภายนอก

CREATE OR REPLACE FUNCTION public.attach_complaint_photos(p_complaint_id uuid, p_urls text[])
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(p_urls) u
    WHERE u !~* ('/complaint-attachments/' || p_complaint_id::text || '/')
  ) THEN
    RETURN false;
  END IF;

  UPDATE complaints SET attachments = p_urls WHERE id = p_complaint_id
    AND ((user_id = auth.uid() AND auth.uid() IS NOT NULL)
      OR (user_id IS NULL AND created_at > now() - interval '15 minutes'));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
