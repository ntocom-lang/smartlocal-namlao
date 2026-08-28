-- ปิดช่องที่ officer/technician สามารถ UPDATE complaints.status = 'closed' ตรงผ่าน API
-- ได้เมื่อแถวนั้นอยู่ใน scope ของ RLS เดิม โดยไม่ผ่านการตรวจรับของ Admin
--
-- RLS WITH CHECK ตรวจได้เฉพาะค่า NEW และเปรียบเทียบ transition OLD -> NEW ไม่ได้
-- จึงใช้ BEFORE UPDATE trigger เป็น authorization gate อีกชั้น
-- `completed` คือสถานะปิดเรื่องแบบ legacy และต้องถูกคุมด้วยกติกาเดียวกัน

CREATE OR REPLACE FUNCTION public.guard_complaint_final_close_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('closed', 'completed')
  THEN
    -- SQL ภายในระบบและ service-role jobs ยังทำงานได้ ส่วน request ของผู้ใช้จริง
    -- ต้องมี application role เป็น Admin/Super Admin เท่านั้น
    IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' THEN
      v_role := public.get_my_role();
      IF COALESCE(v_role, '') NOT IN ('admin', 'superadmin') THEN
        RAISE EXCEPTION 'Only admin or superadmin may close a complaint'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_complaint_final_close_role()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_complaint_final_close_role ON public.complaints;
CREATE TRIGGER trg_guard_complaint_final_close_role
BEFORE UPDATE OF status ON public.complaints
FOR EACH ROW
EXECUTE FUNCTION public.guard_complaint_final_close_role();
