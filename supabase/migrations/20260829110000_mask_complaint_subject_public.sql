-- 20260829110000_mask_complaint_subject_public.sql
--
-- get_complaint_by_ref() เป็นหน้า "ติดตามคำร้องด้วยเลขอ้างอิง" ที่เปิดให้คนไม่ล็อกอินใช้ได้
-- (src/pages/MyComplaints.jsx: handleRefSearch) ตัวฟังก์ชัน mask ข้อมูลอ่อนไหวไว้ดีอยู่แล้ว —
-- detail / village / latitude / longitude / reporter_name / attachments / work_photos /
-- technician_note คืน NULL ทั้งหมดถ้าผู้เรียกไม่ใช่เจ้าของคำร้องหรือเจ้าหน้าที่ในเทศบาลนั้น
-- แต่ "subject" ถูกคืนแบบดิบเสมอ ทั้งที่เป็นข้อความที่ประชาชนพิมพ์เองเหมือน detail
--
-- ทำไมถึงสำคัญ: ref_no เป็นเลขเรียงคาดเดาได้ (รูปแบบจริงในระบบตอนนี้คือ ES-69-0106 ถึง ES-69-0147
-- และ NAML-2569-0094 ถึง 0101) และไม่มี rate limit ใดๆ — ทดสอบจริงด้วยสิทธิ์ anon ยิง 200 ครั้ง
-- เจอคำร้องครบ 21/21 รายการที่มีอยู่ ใครก็ตามที่หยิบ anon key จาก JS bundle เขียนสคริปต์วนเลข
-- ก็กวาดคำร้องทั้งเทศบาลได้
--
-- วันนี้ยังไม่มีข้อมูลหลุดจริง เพราะเทศบาลที่มี ref_no (26 คำร้อง) บันทึก subject เป็น NULL ทั้งหมด
-- ส่วนเทศบาลที่มี subject จริง 5 รายการกลับไม่มี ref_no เลยจึง enumerate ไม่ได้ — นี่คือ "ความเสี่ยงแฝง"
-- ที่จะกลายเป็นการรั่วจริงทันทีที่ฟอร์มไหนเริ่มบันทึก subject โดยไม่มีใครกลับมาดูฟังก์ชันนี้อีก
-- จึงปิดตั้งแต่ตอนนี้ ให้ subject ถูก mask ด้วยกฎเดียวกับ detail
--
-- ผลต่อ UI: MyComplaints.jsx บรรทัด 692 เรนเดอร์ด้วย {searchResult.subject && ...} อยู่แล้ว
-- ค่า NULL จึงทำให้บรรทัดหัวเรื่องหายไปเฉยๆ ไม่พัง — ผู้ที่แจ้งเองก็ยังเห็นหมวด/สถานะ/วันครบกำหนด
-- และเบอร์โทรแบบปิดกลางไว้ยืนยันว่าเป็นคำร้องของตัวเอง (คงพฤติกรรมเดิมไว้ ไม่แตะ)

CREATE OR REPLACE FUNCTION public.get_complaint_by_ref(_ref_no text, _municipality_id uuid)
RETURNS TABLE(
  id uuid, ref_no text, category text, subject text, detail text, status text,
  created_at timestamp with time zone, due_date date, village text,
  latitude double precision, longitude double precision, phone text,
  reporter_name text, attachments jsonb, work_photos jsonb, technician_note text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    v_row.id, v_row.ref_no, v_row.category,
    -- เปลี่ยนจุดเดียวของ migration นี้: subject เป็นข้อความที่ประชาชนพิมพ์เอง ต้อง mask เหมือน detail
    CASE WHEN v_privileged THEN v_row.subject ELSE NULL END,
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
$function$;
