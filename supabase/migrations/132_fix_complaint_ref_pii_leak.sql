-- 132_fix_complaint_ref_pii_leak.sql
-- ปัญหา: get_complaint_by_ref (107) mask เบอร์โทรเฉพาะตอน auth.uid() IS NULL
-- ทำให้ authenticated user คนไหนก็ได้ (ไม่ต้องเป็นเจ้าของ/เจ้าหน้าที่) เห็นเบอร์เต็ม +
-- ชื่อผู้แจ้ง + รายละเอียด + พิกัด + รูปแนบ ของทุกคำร้อง ถ้ารู้ ref_no (เดาได้ เพราะเป็นเลขรัน)
-- แก้: mask ให้ทุกคนที่ไม่ใช่เจ้าของคำร้องหรือเจ้าหน้าที่ municipality นั้น ไม่ว่าจะ login หรือไม่

DROP FUNCTION IF EXISTS get_complaint_by_ref(text, uuid);

CREATE OR REPLACE FUNCTION get_complaint_by_ref(_ref_no text, _municipality_id uuid)
RETURNS TABLE (
  id uuid, ref_no text, category text, subject text, detail text,
  status text, created_at timestamptz, due_date date,
  village text, latitude double precision, longitude double precision,
  phone text, reporter_name text,
  attachments jsonb, work_photos jsonb, technician_note text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row complaints%ROWTYPE;
  v_privileged boolean;
BEGIN
  SELECT * INTO v_row
  FROM complaints
  WHERE complaints.ref_no = upper(trim(_ref_no))
    AND complaints.municipality_id = _municipality_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- privileged = เจ้าของคำร้อง หรือ เจ้าหน้าที่ municipality เดียวกัน
  v_privileged := (
    auth.uid() IS NOT NULL AND (
      v_row.user_id = auth.uid()
      OR (
        get_my_role() IN ('superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council')
        AND get_my_municipality_id() = v_row.municipality_id
      )
    )
  );

  RETURN QUERY
  SELECT
    v_row.id, v_row.ref_no, v_row.category, v_row.subject,
    CASE WHEN v_privileged THEN v_row.detail ELSE NULL END,
    v_row.status, v_row.created_at, v_row.due_date,
    CASE WHEN v_privileged THEN v_row.village ELSE NULL END,
    CASE WHEN v_privileged THEN v_row.latitude  ELSE NULL END,
    CASE WHEN v_privileged THEN v_row.longitude ELSE NULL END,
    CASE
      WHEN v_privileged  THEN v_row.phone
      WHEN v_row.phone IS NULL THEN NULL
      ELSE LEFT(v_row.phone, 3) || REPEAT('x', GREATEST(0, LENGTH(v_row.phone) - 6)) || RIGHT(v_row.phone, 3)
    END,
    CASE WHEN v_privileged THEN v_row.reporter_name ELSE NULL END,
    CASE WHEN v_privileged THEN to_jsonb(v_row.attachments) ELSE NULL END,
    CASE WHEN v_privileged THEN v_row.work_photos ELSE NULL END,
    CASE WHEN v_privileged THEN v_row.technician_note ELSE NULL END;
END;
$$;

GRANT EXECUTE ON FUNCTION get_complaint_by_ref(text, uuid) TO anon, authenticated;
