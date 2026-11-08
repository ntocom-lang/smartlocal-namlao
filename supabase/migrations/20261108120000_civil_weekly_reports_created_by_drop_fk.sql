-- 20261108120000_civil_weekly_reports_created_by_drop_fk.sql
--
-- [บั๊กที่แก้] (มาตั้งแต่ #647 / 20261106100000 + 20261106100100)
-- civil_weekly_reports.created_by มี FK ไป auth.users แบบ ON DELETE SET NULL
-- แต่ตัวกระตุ้น civil_weekly_reports_guard ห้ามเปลี่ยน created_by ทุกกรณี
-- ⇒ ลบบัญชีที่เคยสร้างรายงานรายสัปดาห์ (delete_user_by_id / delete_my_account)
--   หรือรวมบัญชีซ้ำ (merge_duplicate_profile ลบ auth.users ของบัญชีซ้ำตอนท้าย)
--   → FK สั่ง UPDATE created_by = NULL → ตัวกระตุ้นโยน "โครงการ เลขสัปดาห์ และผู้สร้างของรายงานเปลี่ยนไม่ได้"
--   → ยกเลิกทั้งคำสั่ง ลบ/รวมบัญชีไม่ได้เลย (รายงานที่ล็อกแล้วชนอีกชั้น: แก้ฉบับ final ไม่ได้)
--
-- [ทางแก้] ถอด FK ของ created_by — ให้เป็น "รอยตรวจสอบ" แบบเดียวกับ finalized_by ในตารางเดียวกัน
-- และ created_by/updated_by ของตารางวงจรโครงการ (20261108100100) ที่ตั้งใจไม่ใส่ FK มาแต่แรก
--   - ลบ/รวมบัญชีได้ รายงานยังอยู่ครบ และยังเก็บรหัสผู้สร้างเดิมไว้ (ไม่ถูกล้างเป็น NULL)
--   - รวมบัญชี: audit_logs ของ merge_duplicate_profile เก็บคู่ merged_id → kept_id ไว้แล้ว ย้อนตรวจได้
--   - ไม่แตะตัวกระตุ้น: กติกา "ผู้สร้างเปลี่ยนไม่ได้" ยังกันการแก้จากเบราว์เซอร์ครบเหมือนเดิม
--   - ไม่กระทบสิทธิ์: RLS และหน้าจอไม่ได้ใช้ created_by ของรายงาน (สิทธิ์ดูจาก civil_projects.created_by
--     และ civil_project_people.profile_id) และ FK นี้ชี้ auth.users ซึ่ง PostgREST ไม่ใช้ embed อยู่แล้ว
--   - ค่า created_by ใหม่จากแอป (authenticated) ยังประทับจาก auth.uid() โดยตัวกระตุ้นเหมือนเดิม
--     (service_role / SQL Editor ที่ auth.uid() เป็น NULL ใส่ uuid ที่ไม่มีจริงได้แล้ว — เป็นข้อมูลประกอบ ไม่ใช่สิทธิ์)
--
-- ⚠️ ชื่อ constraint หาจาก pg_constraint (ปกติ civil_weekly_reports_created_by_fkey แต่ไม่เดา)
-- รันซ้ำได้: รอบสองไม่เจอ FK ก็ไม่ทำอะไร

BEGIN;

-- DROP FK ต้องลบ RI trigger ฝั่ง auth.users ด้วย = ขอ ACCESS EXCLUSIVE บน auth.users ชั่วครู่
-- ถ้ามี session ถือล็อกค้าง ห้ามรอคิว (ไม่งั้น login/refresh token ทุก อปท. ต่อคิวท้ายคำสั่งนี้)
-- เกิน 5 วินาที = error 55P03 ย้อนกลับทั้งก้อน ข้อมูลไม่เปลี่ยน รันใหม่ได้
SET LOCAL lock_timeout = '5s';

DO $fix$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF to_regclass('public.civil_weekly_reports') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง public.civil_weekly_reports — ต้องรัน 20261106100000_civil_reports_tables.sql ก่อน';
  END IF;

  FOR r IN
    SELECT c.conname
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.civil_weekly_reports'::regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[(
        SELECT a.attnum FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = 'public.civil_weekly_reports'::regclass AND a.attname = 'created_by' AND NOT a.attisdropped
      )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.civil_weekly_reports DROP CONSTRAINT %I', r.conname);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'civil_weekly_reports.created_by: ถอด FK % ตัว', n;
END
$fix$;

COMMENT ON COLUMN public.civil_weekly_reports.created_by IS
  'ผู้สร้างรายงาน (ประทับจาก auth.uid() โดย civil_weekly_reports_guard) — ไม่มี FK โดยตั้งใจ: เป็นรอยตรวจสอบ บัญชีที่ลาออก/ถูกรวมต้องลบได้ (20261108120000)';

-- ตรวจหลังแก้: ต้องไม่เหลือ FK บน created_by และตัวกระตุ้นต้องยังอยู่
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.civil_weekly_reports'::regclass AND c.contype = 'f' AND a.attname = 'created_by'
  ) THEN
    RAISE EXCEPTION 'ยังมี FK บน civil_weekly_reports.created_by เหลืออยู่';
  END IF;
  -- FK project_id → civil_projects (RESTRICT: ลบโครงการที่มีรายงานไม่ได้) ต้องอยู่ครบ
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.civil_weekly_reports'::regclass AND c.contype = 'f' AND a.attname = 'project_id'
      AND c.confrelid = 'public.civil_projects'::regclass AND c.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'FK civil_weekly_reports.project_id → civil_projects (ON DELETE RESTRICT) หายไป — ฐานข้อมูลไม่ตรงกับ 20261106100000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.civil_weekly_reports'::regclass AND tgname = 'civil_weekly_reports_guard_trigger' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ไม่พบ civil_weekly_reports_guard_trigger — ฐานข้อมูลไม่ตรงกับ 20261106100100';
  END IF;
END
$verify$;

COMMIT;
