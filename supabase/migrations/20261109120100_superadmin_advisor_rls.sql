-- ผู้ช่วย/ที่ปรึกษา AI เฉพาะ Super Admin ไฟล์ 2/2 — RLS · GRANT · trigger · แถวตั้งค่าเริ่มต้น
--   ต้องรัน 20261109120000_superadmin_advisor_tables.sql ก่อน
--
-- สิทธิ์ (เจ้าของระบบอนุมัติ 2569-11-08: "ใช้เฉพาะ SuperAdmin เท่านั้น")
--   advisor_settings : superadmin อ่าน + แก้ได้เฉพาะ enabled / model / daily_cap · เพิ่ม/ลบแถวไม่ได้ (มีแถวเดียว id = 1)
--   advisor_messages : superadmin อ่าน + ลบได้เฉพาะแถวของตัวเอง · เพิ่ม/แก้ไม่ได้
--                      แถวใหม่เขียนโดย Edge Function superadmin-advisor ด้วย service_role เท่านั้น
--                      (จึงปลอมประวัติว่า "AI ตอบแบบนี้" ไม่ได้) · ลบเรื่องของวันนี้แล้วยอดนับต่อวันลดลง — ยอมรับได้
--                      เพราะ superadmin ปรับเพดานเองได้อยู่แล้ว (ประวัติส่วนตัว ไม่ใช่บันทึกย้อนตรวจ — สมมติฐานที่เสนอเจ้าของระบบ 2569-11-08)
--   anon            : ไม่มีสิทธิ์อะไรเลยทั้ง 2 ตาราง
--   admin / เจ้าหน้าที่ / ประชาชน : RLS ไม่ผ่าน (get_my_role() ไม่ใช่ superadmin) → ได้ 0 แถว
--   ไม่ให้ TRUNCATE / REFERENCES / TRIGGER กับ authenticated (RLS กัน TRUNCATE ไม่ได้ — #657)
--
-- ย้อนกลับ: BEGIN; SET LOCAL lock_timeout = '5s'; DROP TABLE public.advisor_messages, public.advisor_settings;
--           DROP FUNCTION IF EXISTS public.advisor_settings_touch(); COMMIT;  (DROP advisor_messages ต้องล็อก auth.users)
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.advisor_settings') IS NULL OR to_regclass('public.advisor_messages') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261109120000_superadmin_advisor_tables.sql ก่อน (ไม่พบตาราง advisor_*)';
  END IF;
  IF to_regprocedure('public.get_my_role()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบฟังก์ชัน public.get_my_role()';
  END IF;
END $guard$;

-- ── แถวตั้งค่าเริ่มต้น ─────────────────────────────────────────────────────────────
INSERT INTO public.advisor_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── ประทับเวลา/ผู้แก้ตั้งค่า (ผู้ใช้ส่งค่าเองไม่ได้ ถูกทับเสมอ) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.advisor_settings_touch() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.advisor_settings_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS advisor_settings_touch_trigger ON public.advisor_settings;
CREATE TRIGGER advisor_settings_touch_trigger BEFORE UPDATE ON public.advisor_settings
  FOR EACH ROW EXECUTE FUNCTION public.advisor_settings_touch();

-- ── สิทธิ์ตาราง ────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.advisor_settings, public.advisor_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.advisor_settings TO authenticated;
GRANT UPDATE (enabled, model, daily_cap) ON public.advisor_settings TO authenticated;
GRANT SELECT, DELETE ON public.advisor_messages TO authenticated;
GRANT ALL ON public.advisor_settings, public.advisor_messages TO service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.advisor_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisor_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advisor_settings_select ON public.advisor_settings;
CREATE POLICY advisor_settings_select ON public.advisor_settings FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin');

DROP POLICY IF EXISTS advisor_settings_update ON public.advisor_settings;
CREATE POLICY advisor_settings_update ON public.advisor_settings FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin')
  WITH CHECK ((SELECT public.get_my_role()) = 'superadmin');

DROP POLICY IF EXISTS advisor_messages_select ON public.advisor_messages;
CREATE POLICY advisor_messages_select ON public.advisor_messages FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.get_my_role()) = 'superadmin');

DROP POLICY IF EXISTS advisor_messages_delete ON public.advisor_messages;
CREATE POLICY advisor_messages_delete ON public.advisor_messages FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.get_my_role()) = 'superadmin');

-- ── ด่านท้ายไฟล์: ผู้รันไม่ใช่เจ้าของตาราง REVOKE จะไม่ error แต่ไม่มีผล (บทเรียน 2026-09-03 / #657) ──
DO $verify$
DECLARE s regclass := 'public.advisor_settings'; m regclass := 'public.advisor_messages';
BEGIN
  IF (SELECT bool_or(NOT relrowsecurity) FROM pg_class WHERE oid IN (s, m))
     OR has_any_column_privilege('anon', s, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_any_column_privilege('anon', m, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_table_privilege('anon', s, 'DELETE,TRUNCATE,TRIGGER') OR has_table_privilege('anon', m, 'DELETE,TRUNCATE,TRIGGER')
     OR has_table_privilege('authenticated', s, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_column_privilege('authenticated', s, 'updated_by', 'UPDATE') OR has_column_privilege('authenticated', s, 'updated_at', 'UPDATE')
     OR has_column_privilege('authenticated', s, 'id', 'UPDATE') OR NOT has_column_privilege('authenticated', s, 'daily_cap', 'UPDATE')
     OR has_any_column_privilege('authenticated', m, 'INSERT,UPDATE') OR has_table_privilege('authenticated', m, 'TRUNCATE,REFERENCES,TRIGGER')
     OR NOT has_table_privilege('authenticated', m, 'SELECT') OR NOT has_table_privilege('authenticated', m, 'DELETE')
     OR has_function_privilege('authenticated', 'public.advisor_settings_touch()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_my_role()', 'EXECUTE')
     OR (SELECT count(*) FROM pg_policy WHERE polrelid IN (s, m)) <> 4
     OR (SELECT count(*) FROM public.advisor_settings) <> 1 THEN
    RAISE EXCEPTION 'advisor_*: RLS/สิทธิ์ไม่ตรงตามที่ออกแบบ (ผู้รันต้องเป็นเจ้าของตาราง เช่น postgres)';
  END IF;
END $verify$;

COMMIT;
