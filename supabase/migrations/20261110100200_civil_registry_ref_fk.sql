-- ผูกโครงการก่อสร้างกับทะเบียนโครงการกลาง ไฟล์ 3/3 (PR R1-A) — ใส่ FK อย่างเดียว ไม่แตะข้อมูล/trigger/policy ของโมดูลก่อสร้าง
--   เจ้าของระบบยืนยันให้แตะ civil_projects 2569-11-08 (เพื่อให้แท็บ "ติดตามผล" ดึงขั้นโครงการก่อสร้างเองได้ กองช่างไม่ต้องกดซ้ำ)
--   แยกไฟล์โดยตั้งใจ: ไม่รันไฟล์นี้ ไฟล์ 1–2 ยังใช้ได้ (RPC local_plan_civil_stages จับคู่ด้วย JOIN อยู่แล้ว)
--
--   ON DELETE RESTRICT (ไม่ใช่ SET NULL): SET NULL จะเป็น UPDATE บน civil_projects ซึ่งไปกระตุ้น trigger ด่านกันของโมดูลก่อสร้าง
--   ด้วยผู้ใช้ของเมนูแผน (อาจถูกปฏิเสธหรือลงประวัติผิดเมนู) · RESTRICT = โครงการในทะเบียนที่ก่อสร้างใช้อยู่ลบไม่ได้
--   (แนวเดียวกับรายการแผนดำเนินงานที่อ้างทะเบียน) — จะลบต้องให้กองช่างเลิกผูกก่อน
--   ⚠️ FK ไม่บังคับว่าเป็น อปท. เดียวกัน — RPC local_plan_civil_stages กรอง อปท. ซ้ำทั้งสองฝั่งแล้ว ตอนทำหน้าจอเลือกผูก (R1-B)
--      ต้องเสนอเฉพาะโครงการของ อปท. ตัวเอง
--
-- ย้อนกลับ: ALTER TABLE public.civil_projects DROP CONSTRAINT civil_projects_registry_ref_fk;
--           DROP INDEX public.civil_projects_registry_ref_idx;
BEGIN;
-- ADD FK ถือ SHARE ROW EXCLUSIVE บน civil_projects (บล็อกการเขียนของกองช่าง ไม่บล็อกการอ่าน) — มีงานค้างเกิน 5 วินาที = ล้มทั้งก้อน รันใหม่ได้
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_bad integer;
BEGIN
  IF to_regclass('public.local_dev_plan_projects') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261109100100_local_plan_tables.sql ก่อน (ไม่พบ local_dev_plan_projects)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'civil_projects'
                   AND column_name = 'registry_ref' AND data_type = 'uuid') THEN
    RAISE EXCEPTION 'ต้องรัน 20261108100000_civil_lifecycle_columns.sql ก่อน (ไม่พบ civil_projects.registry_ref แบบ uuid)';
  END IF;
  -- ค่าค้างที่ชี้ไปไม่เจอ = หยุด ไม่ล้างให้เอง (ข้อมูลของโมดูลก่อสร้าง ต้องดูก่อนว่ามาจากไหน)
  SELECT count(*) INTO v_bad FROM public.civil_projects AS c
  WHERE c.registry_ref IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.local_dev_plan_projects AS p WHERE p.id = c.registry_ref);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'civil_projects มี registry_ref ที่ไม่พบในทะเบียน % แถว — ตรวจก่อนใส่ FK', v_bad;
  END IF;
  -- ผูกข้าม อปท. = ผิดแน่นอน (FK ไม่ตรวจให้ และ RPC จะซ่อนเงียบ) → หยุดดูก่อน
  SELECT count(*) INTO v_bad FROM public.civil_projects AS c
  JOIN public.local_dev_plan_projects AS p ON p.id = c.registry_ref
  WHERE p.municipality_id <> c.municipality_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'civil_projects ผูกทะเบียนของ อปท. อื่น % แถว — ตรวจก่อนใส่ FK', v_bad;
  END IF;
END $guard$;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_projects_registry_ref_fk') THEN
    ALTER TABLE public.civil_projects ADD CONSTRAINT civil_projects_registry_ref_fk
      FOREIGN KEY (registry_ref) REFERENCES public.local_dev_plan_projects(id) ON DELETE RESTRICT;
  END IF;
END $fk$;
CREATE INDEX IF NOT EXISTS civil_projects_registry_ref_idx ON public.civil_projects (registry_ref) WHERE registry_ref IS NOT NULL;

COMMENT ON COLUMN public.civil_projects.registry_ref IS
  'ผูกทะเบียนโครงการกลาง (local_dev_plan_projects.id) — FK ON DELETE RESTRICT · แท็บติดตามผลอ่านขั้นผ่าน RPC local_plan_civil_stages';

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'civil_projects_registry_ref_fk' AND confdeltype = 'r') THEN
    RAISE EXCEPTION 'FK civil_projects_registry_ref_fk ไม่ได้สร้างแบบ RESTRICT';
  END IF;
END $check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
