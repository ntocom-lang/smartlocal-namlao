-- HOTFIX: trg_guard_profile_privileged_update บน production เป็นโค้ดค้างที่ไม่มี RETURN
--
-- body ที่ deploy อยู่จริง (ไม่ตรงกับ migration ไฟล์ไหนเลย = ถูก apply มือผ่าน execute_sql
-- ไม่ผ่าน schema_migrations) เหลือแค่ branch "ประชาชนผูก อปท. ครั้งแรก" แล้วปิดท้ายด้วย
-- comment placeholder "-- ...เงื่อนไขเดิมทั้งหมดคงไว้..." โดยไม่มี RETURN NEW
--
-- ผลคือ trigger function ที่ควบคุมทุก UPDATE บน profiles ตกท้ายฟังก์ชันโดยไม่ return
-- → PostgreSQL raise 2F005 "control reached end of trigger procedure without RETURN"
-- ทดสอบยิงจริงบน prod (rollback แล้ว): UPDATE profiles SET job_title=job_title → 2F005
--
-- กระทบทั้งระบบ: admin ตั้ง role/แต่งตั้งตำแหน่งไม่ได้ (admin_update_user ก็ UPDATE profiles
-- เหมือนกัน trigger ยิงก่อนเสมอ), ผู้ใช้แก้ชื่อ/เบอร์/ที่อยู่ตัวเองไม่ได้,
-- FleetSetup ตั้ง fleet_role ไม่ได้ — ทั้งหมด error เงียบๆ ที่ชั้น DB
--
-- แก้: คืนเงื่อนไขจริงจาก 20260730180100_158_harden_user_role_management.sql กลับมาครบ
-- พร้อมคง branch ข้อยกเว้น self-link ที่ตั้งใจเพิ่มไว้ (ประชาชนผูก อปท. ของตัวเองครั้งแรก
-- จาก null → ค่าแรกเท่านั้น ไม่เปิดให้ย้าย อปท. และไม่แตะ role/สิทธิ์ใดๆ) และปิดท้ายด้วย
-- RETURN NEW เสมอ

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ข้อยกเว้น: ประชาชนผูกตัวเองกับ อปท. ครั้งแรกได้ (null → ค่าแรกเท่านั้น)
  -- ใช้โดย checkAndFixProfile() ใน App.jsx หลังสมัคร/ล็อกอินด้วย Google/LINE ซึ่ง
  -- handle_new_user() ตั้ง municipality_id ให้ไม่ได้ (OAuth ไม่มี municipality_id ใน metadata)
  IF auth.uid() = NEW.id
     AND OLD.municipality_id IS NULL AND NEW.municipality_id IS NOT NULL
     AND OLD.role = 'citizen' AND NEW.role = 'citizen'
     AND NEW.fleet_role    IS NOT DISTINCT FROM OLD.fleet_role
     AND NEW.department_id IS NOT DISTINCT FROM OLD.department_id
     AND NEW.position_id   IS NOT DISTINCT FROM OLD.position_id
     AND NEW.is_dept_head  IS NOT DISTINCT FROM OLD.is_dept_head
  THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
     OR NEW.fleet_role IS DISTINCT FROM OLD.fleet_role
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.position_id IS DISTINCT FROM OLD.position_id
     OR NEW.is_dept_head IS DISTINCT FROM OLD.is_dept_head
  THEN
    IF auth.role() IS NOT NULL
       AND auth.role() <> 'service_role'
       AND COALESCE(current_setting('app.user_management_rpc', true), '') <> '1'
    THEN
      RAISE EXCEPTION 'Privileged profile fields must be changed through admin_update_user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_profile_privileged_update()
  FROM PUBLIC, anon, authenticated;
