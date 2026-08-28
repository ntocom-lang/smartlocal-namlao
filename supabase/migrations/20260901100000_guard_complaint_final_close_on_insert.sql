-- ปิดช่อง INSERT ที่เหลือจาก 20260901090000_guard_complaint_final_close_role.sql
--
-- ทริกเกอร์เดิมเป็น BEFORE UPDATE OF status เท่านั้น ส่วน RLS ฝั่ง INSERT
-- (policy "anyone can submit complaint") ตรวจแค่ `user_id IS NULL OR user_id = auth.uid()`
-- ไม่ได้คุมคอลัมน์ status เลย ประชาชนหรือ officer/technician จึงยิง POST /rest/v1/complaints
-- พร้อม {"status":"closed"} สร้างคำร้องที่ "ปิดเรื่องแล้ว" มาตั้งแต่แรกได้
--
-- ไม่ใช่การปิดเรื่องของคนอื่น จึงไม่รุนแรงเท่าช่อง UPDATE แต่ข้าม workflow ที่ต้องผ่าน
-- การตรวจรับของ Admin และทำให้ตัวเลขในรายงาน SLA (เวลาเฉลี่ยปิดเรื่อง / อัตราการปิดงาน)
-- เพี้ยนโดยไม่มีร่องรอยใน complaint_timeline
--
-- ค่าปกติของคอลัมน์คือ 'pending' และคำร้องที่ประชาชนส่งเข้ามาทางแอปไม่เคยตั้ง status เอง
-- การเพิ่มด่านนี้จึงไม่กระทบเส้นทางส่งคำร้องปกติ
-- Admin/Super Admin ยังบันทึกคำร้องที่ปิดจบไปแล้วย้อนหลังได้ (เช่นเรื่องที่รับแจ้งหน้าเคาน์เตอร์
-- และแก้ไขเสร็จในวันเดียว) เพราะใช้กติกา role เดียวกับตอน UPDATE

CREATE OR REPLACE FUNCTION public.guard_complaint_final_close_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role      text;
  v_is_close  boolean;
BEGIN
  -- INSERT: ถือว่าเป็นการปิดเรื่องถ้าเกิดมาพร้อมสถานะปิด
  -- UPDATE: ถือว่าเป็นการปิดเรื่องเฉพาะเมื่อสถานะ "เปลี่ยน" เข้าสู่สถานะปิด
  --         (ไม่ดักการแก้คอลัมน์อื่นของคำร้องที่ปิดไปแล้ว เช่น แนบเอกสารเพิ่ม)
  v_is_close := NEW.status IN ('closed', 'completed')
                AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status);

  IF v_is_close THEN
    -- SQL ภายในระบบและ service-role jobs ยังทำงานได้ ส่วน request ของผู้ใช้จริง
    -- ต้องมี application role เป็น Admin/Super Admin เท่านั้น
    -- auth.role() คืน NULL เมื่อไม่มี JWT (psql / migration) จึงลอดผ่านโดยตั้งใจ
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

-- ต้องสร้างทริกเกอร์ใหม่ ไม่ใช่แค่ REPLACE ฟังก์ชัน เพราะของเดิมผูกไว้กับ UPDATE OF status
-- อย่างเดียว ตัว INSERT จะไม่ยิงเลยถ้าไม่ประกาศเพิ่ม
DROP TRIGGER IF EXISTS trg_guard_complaint_final_close_role ON public.complaints;
CREATE TRIGGER trg_guard_complaint_final_close_role
BEFORE INSERT OR UPDATE OF status ON public.complaints
FOR EACH ROW
EXECUTE FUNCTION public.guard_complaint_final_close_role();
