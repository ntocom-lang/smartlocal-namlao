-- เฟส 1: คุมสิทธิ์ "มอบหมายผู้รับผิดชอบ" ของคำขอบริการ/เอกสาร
--
-- ปัญหาที่แก้: policy "read document_requests" (migration 20260802071000) ให้ role 'staff'
-- เห็นเฉพาะแถวที่ assigned_to = auth.uid() แต่ไม่มีอะไรในระบบเขียน assigned_to ตอนสร้าง
-- และหน้าเจ้าหน้าที่ยัด assigned_to = ตัวเองลงไปในทุกครั้งที่กดเปลี่ยนสถานะ ผลคือ
--   1) staff เปิดเมนูคำขอเอกสารแล้วเจอหน้าว่างตลอดกาล (แยกไม่ออกจาก "ไม่มีงาน")
--   2) ใครกดสถานะคนสุดท้ายกลายเป็นเจ้าของงาน แย่งจากคนเดิมเงียบๆ ไม่มี log ไม่มีคนรู้
-- ไฟล์นี้ปิดข้อ 2 ที่ระดับฐานข้อมูล (ฝั่ง UI แก้คู่กันที่ StaffDashboard.jsx)
-- ส่วนข้อ 1 ปิดด้วยการมอบหมายจริงในเฟส 2 (document_type_assignments)
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน ตัวบทด้านล่างจึงคัดเงื่อนไขเดิมจาก
-- 20260802071000 มาครบทุกบรรทัดก่อนต่อของใหม่ ห้ามตัดทิ้งเพราะคิดว่าไม่เกี่ยว

BEGIN;

CREATE OR REPLACE FUNCTION public.protect_document_request_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- (เดิม) ผู้ยื่น หน่วยงาน และกองที่รับผิดชอบ ห้ามถูกย้ายโดยคนที่ไม่ใช่แอดมิน
  IF auth.uid() IS NOT NULL
     AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND (
       NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
       OR NEW.department_id IS DISTINCT FROM OLD.department_id
     )
  THEN
    RAISE EXCEPTION 'Requester, municipality and department cannot be changed';
  END IF;

  -- (ใหม่) เปลี่ยนตัวผู้รับผิดชอบได้เฉพาะแอดมิน หรือหัวหน้ากองของกองที่ถือเรื่องนั้นอยู่
  -- เจ้าหน้าที่ปฏิบัติงานโยนงานให้คนอื่นเองไม่ได้ และโยนเข้าตัวเองก็ไม่ได้ (ป้องกันการแย่งงาน
  -- และการดึงข้อมูลส่วนบุคคลของผู้ยื่นเข้ามาในสายตาตัวเองโดยไม่มีคนอนุมัติ — PDPA)
  IF auth.uid() IS NOT NULL
     AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND NOT (
       public.get_my_role() = 'officer'
       AND public.is_my_department(OLD.municipality_id, OLD.department_id)
     )
  THEN
    RAISE EXCEPTION 'Only an admin or the responsible department head may reassign this request';
  END IF;

  -- ผู้รับผิดชอบต้องเป็นบุคลากรของ อปท. เดียวกันเสมอ กัน UUID ข้ามหน่วยงานหลุดเข้ามา
  -- (คอลัมน์เป็น FK ไป profiles เฉยๆ ไม่ได้ผูกกับ municipality_id)
  IF NEW.assigned_to IS NOT NULL
     AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles AS profile
       WHERE profile.id = NEW.assigned_to
         AND profile.municipality_id = NEW.municipality_id
     )
  THEN
    RAISE EXCEPTION 'Assignee must belong to the same municipality as the request';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_document_request_scope() FROM PUBLIC, anon, authenticated;

-- trigger เดิมชี้ฟังก์ชันชื่อเดียวกันอยู่แล้ว สร้างซ้ำเพื่อความชัวร์กรณีเคยถูกลบมือ
DROP TRIGGER IF EXISTS protect_document_request_scope_trigger ON public.document_requests;
CREATE TRIGGER protect_document_request_scope_trigger
  BEFORE UPDATE ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_request_scope();

COMMIT;
