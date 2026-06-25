-- 081_attach_complaint_photos_rpc.sql
-- ประชาชนไม่มีสิทธิ์ UPDATE complaints โดยตรง (RLS block)
-- แก้ด้วย SECURITY DEFINER function ที่ตรวจสอบ ownership แทน

CREATE OR REPLACE FUNCTION public.attach_complaint_photos(
  p_complaint_id uuid,
  p_urls       text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE complaints
  SET attachments = p_urls
  WHERE id = p_complaint_id
    AND (
      -- ผู้ใช้ที่ login และเป็นเจ้าของคำร้อง
      (user_id = auth.uid() AND auth.uid() IS NOT NULL)
      -- คำร้อง anon (user_id = null) สร้างภายใน 2 ชั่วโมง
      OR (user_id IS NULL AND created_at > now() - interval '2 hours')
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- อนุญาตทั้ง anon และ authenticated เรียกใช้
GRANT EXECUTE ON FUNCTION public.attach_complaint_photos TO anon, authenticated;
