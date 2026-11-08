-- ที่ปรึกษา AI เฉพาะ Super Admin รอบ 2 ไฟล์ 2/2 — RLS · GRANT · trigger · แถวเริ่มต้น 3 ช่อง · ฟังก์ชัน key ใน Vault
--   ต้องรัน 20261109130000_advisor_provider_slots_tables.sql ก่อน
--
-- สิทธิ์ (เจ้าของระบบ: "ใช้เฉพาะ SuperAdmin เท่านั้น")
--   advisor_provider_slots : superadmin อ่าน + แก้ได้เฉพาะ enabled / model / daily_cap / paused_until+pause_reason (ปุ่ม "ปลดพัก")
--                            เพิ่ม/ลบแถวไม่ได้ · provider/tier ตายตัวตามลำดับที่เจ้าของกำหนด
--                            key_* แก้ตรงไม่ได้ ต้องผ่าน advisor_set_slot_key() เท่านั้น
--   anon / admin / เจ้าหน้าที่ / ประชาชน : RLS ไม่ผ่าน → 0 แถว · เรียกฟังก์ชันใส่ key ได้แต่ถูกปฏิเสธด้วย 42501
--
-- key ใน Vault — "ใส่ได้อย่างเดียว อ่านกลับไม่ได้"
--   advisor_set_slot_key(slot, key)  superadmin เรียก · เก็บลง vault.secrets (เข้ารหัส) · คืนแค่ 4 ตัวท้าย
--                                    ส่ง key ว่าง = ลบ key ของช่องนั้น
--   advisor_slot_key(slot)           คืน key จริง — EXECUTE ได้เฉพาะ service_role (Edge Function superadmin-advisor)
--                                    superadmin เองก็เรียกไม่ได้: หน้าเว็บไม่มีทางดึง key กลับมาแสดง
--   ⚠️ ข้อจำกัดที่ยอมรับ: key เดินทางเป็นพารามิเตอร์ของ RPC ผ่าน HTTPS → ถ้าตั้ง log_statement = 'all' หรือคำสั่งช้าจนติด
--      log_min_duration_statement ค่าพารามิเตอร์อาจไปอยู่ใน Postgres log
--      ตรวจฐานจริงแล้ว 2569-11-08: log_statement=ddl · log_min_duration_statement=-1 · pgaudit.log=none · log_parameter=off
--      ถ้าใครเปลี่ยนค่าเหล่านี้ภายหลัง ความเสี่ยงนี้กลับมา · ไม่ใช้วิธีวาง key ใน SQL Editor เพราะประวัติคำสั่งเก็บไว้ถาวร
--      หน้าเว็บต้องเรียก supabase.rpc แบบ POST (ค่าเริ่มต้น) ห้าม { get: true } ไม่งั้น key ไปอยู่ใน URL ของ edge log
--   ⚠️ ความเสี่ยงที่ยอมรับ: ผู้ถือ service_role key อ่าน key ของ AI แบบจ่ายเงินได้ด้วย (/rpc/advisor_slot_key)
--      — service_role ข้าม RLS ทุกตารางอยู่แล้ว ระดับความเสียหายเท่าเดิม
--   ⚠️ ย้อนกลับ: deploy Edge Function รุ่นรอบ 1 คืนก่อน แล้วค่อยรันชุดคำสั่งข้างล่าง (key ทั้งหมดหาย ต้องใส่ใหม่)
--
-- ย้อนกลับ: BEGIN; SET LOCAL lock_timeout = '5s';
--   DELETE FROM vault.secrets WHERE name LIKE 'advisor\_slot\_%\_key';
--   DROP FUNCTION IF EXISTS public.advisor_set_slot_key(smallint, text), public.advisor_slot_key(smallint);
--   DROP TABLE public.advisor_provider_slots;  DROP FUNCTION IF EXISTS public.advisor_slots_touch();
--   ALTER TABLE public.advisor_messages DROP COLUMN slot, DROP COLUMN provider, DROP COLUMN route_note, DROP COLUMN context_snapshot;
--   COMMIT;
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.advisor_provider_slots') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261109130000_advisor_provider_slots_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('public.get_my_role()') IS NULL OR to_regprocedure('public.advisor_settings_touch()') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบ public.get_my_role() หรือ public.advisor_settings_touch()';
  END IF;
  -- pg_attribute ไม่ขึ้นกับสิทธิ์ของผู้รัน (information_schema ซ่อนคอลัมน์ที่ผู้รันไม่มีสิทธิ์)
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.advisor_messages'::regclass AND attname = 'slot' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ต้องรัน 20261109130000_advisor_provider_slots_tables.sql ก่อน (ไม่พบ advisor_messages.slot)';
  END IF;
  -- ตรวจลายเซ็นเต็ม (to_regproc ตรวจแค่ชื่อ) — แยก IF เพราะ has_*_privilege error ถ้าไม่มีของ และ OR ไม่การันตีลำดับ
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ Supabase Vault หรือลายเซ็นฟังก์ชันไม่ตรง (extension supabase_vault)';
  END IF;
  -- ผู้รัน = เจ้าของฟังก์ชัน SECURITY DEFINER ด้านล่าง → ต้องใช้ Vault ได้ครบ ไม่งั้น COMMIT ผ่านแต่กด "บันทึก key" แล้ว 42501
  -- (ตรวจทีละสิทธิ์ — 'SELECT,DELETE' ในสตริงเดียวคืน true ถ้ามีสิทธิ์ใดสิทธิ์หนึ่ง)
  IF NOT has_table_privilege(current_user, 'vault.secrets', 'SELECT')
     OR NOT has_table_privilege(current_user, 'vault.secrets', 'DELETE')
     OR NOT has_table_privilege(current_user, 'vault.decrypted_secrets', 'SELECT')
     OR NOT has_function_privilege(current_user, 'vault.create_secret(text,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege(current_user, 'vault.update_secret(uuid,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ผู้รัน % ใช้ Vault ไม่ครบสิทธิ์ (ต้องการ SELECT/DELETE vault.secrets, SELECT decrypted_secrets, EXECUTE create/update_secret)', current_user;
  END IF;
END $guard$;

-- Edge Function นับคำถามของวันนี้ "รายช่อง" เพื่อเทียบ daily_cap ของช่องนั้น
--   ⚠️ ข้อตกลงกับ Edge Function: ต้องเขียน slot/provider ลงแถว role = 'user' ด้วย ไม่ใช่แค่แถวคำตอบ ไม่งั้นนับได้ 0 ตลอด
CREATE INDEX IF NOT EXISTS advisor_messages_slot_daily_idx
  ON public.advisor_messages (slot, created_at) WHERE role = 'user';

-- ── แถวเริ่มต้น 3 ช่อง ตามลำดับที่เจ้าของกำหนด: Claude → Gemini จ่ายเงิน → Gemini ฟรี ─────────────────
--   ช่อง 3 รับชื่อโมเดล + เพดานจากการตั้งค่ารอบ 1 (ค่าที่เจ้าของใช้อยู่)
--   ช่อง 1–2 (จ่ายเงิน) เริ่มที่ 50 คำถาม/วัน กันเครดิตไหลถ้า session หลุดหรือมีบั๊กวนเรียก — ลบค่าทิ้ง = ไม่จำกัด (เจ้าของตั้งเอง)
--   ช่องที่ยังไม่มี key: ช่อง 1–2 ถูกข้าม · ช่อง 3 ใช้ GEMINI_API_KEY ใน Secrets ของ Edge Function แทน
INSERT INTO public.advisor_provider_slots (slot, provider, tier, model, daily_cap)
SELECT v.slot, v.provider, v.tier, COALESCE(v.model, s.model), CASE WHEN v.slot = 3 THEN s.daily_cap ELSE 50 END
FROM (VALUES
  (1::smallint, 'claude', 'paid', 'claude-opus-5-5'),
  (2::smallint, 'gemini', 'paid', NULL),
  (3::smallint, 'gemini', 'free', NULL)
) AS v(slot, provider, tier, model)
CROSS JOIN (SELECT model, daily_cap FROM public.advisor_settings WHERE id = 1) s
ON CONFLICT (slot) DO NOTHING;

-- ── ประทับเวลา/ผู้แก้ เฉพาะตอน "คน" แก้ (มี auth.uid()) — รวมปุ่มปลดพัก ────────────────────────
--   Edge Function ประทับ paused_until / key_invalid_at ด้วย service_role (auth.uid() ว่าง) → ไม่ทับ updated_by เป็น NULL
--   ผู้ใช้ส่ง updated_at / updated_by เองไม่ได้อยู่แล้ว (ไม่มี GRANT UPDATE คอลัมน์นั้น)
CREATE OR REPLACE FUNCTION public.advisor_slots_touch() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.advisor_slots_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS advisor_provider_slots_touch_trigger ON public.advisor_provider_slots;
CREATE TRIGGER advisor_provider_slots_touch_trigger BEFORE UPDATE ON public.advisor_provider_slots
  FOR EACH ROW EXECUTE FUNCTION public.advisor_slots_touch();

-- ── ใส่/เปลี่ยน/ลบ key (superadmin) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.advisor_set_slot_key(p_slot smallint, p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_row public.advisor_provider_slots%ROWTYPE;
  v_key text := btrim(coalesce(p_key, ''));
  v_name text;
  v_secret uuid;
BEGIN
  IF (SELECT public.get_my_role()) IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'เฉพาะ Super Admin' USING ERRCODE = '42501';
  END IF;

  -- ล็อกแถวช่อง กันกด "บันทึก key" สองแท็บพร้อมกันแล้วได้ secret ซ้ำ
  SELECT * INTO v_row FROM public.advisor_provider_slots WHERE slot = p_slot FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบช่องที่ %', p_slot USING ERRCODE = '22023';
  END IF;
  v_name := format('advisor_slot_%s_key', p_slot);

  -- key ว่าง = ลบ key ของช่องนี้
  IF v_key = '' THEN
    DELETE FROM vault.secrets WHERE id = v_row.key_secret_id OR name = v_name;
    UPDATE public.advisor_provider_slots
       SET key_secret_id = NULL, key_last4 = NULL, key_set_at = NULL, key_invalid_at = NULL
     WHERE slot = p_slot;
    RETURN jsonb_build_object('slot', p_slot, 'key_last4', NULL);
  END IF;

  -- ตรวจรูปแบบ — ข้อความ error ห้ามมีค่า key
  IF length(v_key) NOT BETWEEN 20 AND 400 OR v_key !~ '^[A-Za-z0-9._~+/=-]+$' THEN
    RAISE EXCEPTION 'รูปแบบ API key ไม่ถูกต้อง (ต้องยาว 20–400 ตัว ไม่มีช่องว่าง)' USING ERRCODE = '22023';
  END IF;
  IF v_row.provider = 'claude' AND left(v_key, 7) <> 'sk-ant-' THEN
    RAISE EXCEPTION 'API key ของ Claude ต้องขึ้นต้นด้วย sk-ant-' USING ERRCODE = '22023';
  END IF;

  -- ใช้ secret เดิมของช่อง (หรือตัวชื่อเดียวกันที่ค้างจากการย้อนกลับ) ไม่สร้างซ้ำ
  SELECT id INTO v_secret FROM vault.secrets WHERE id = v_row.key_secret_id OR name = v_name
   ORDER BY (id = v_row.key_secret_id) DESC NULLS LAST LIMIT 1;
  IF v_secret IS NULL THEN
    v_secret := vault.create_secret(v_key, v_name, format('ที่ปรึกษา AI ช่อง %s (%s %s)', p_slot, v_row.provider, v_row.tier));
  ELSE
    PERFORM vault.update_secret(v_secret, v_key, v_name);
  END IF;

  -- key ใหม่ = ล้างป้าย "key ผิด" และปลดพัก ให้ลองช่องนี้ทันที
  UPDATE public.advisor_provider_slots
     SET key_secret_id = v_secret, key_last4 = right(v_key, 4), key_set_at = now(),
         key_invalid_at = NULL, paused_until = NULL, pause_reason = NULL
   WHERE slot = p_slot;

  RETURN jsonb_build_object('slot', p_slot, 'key_last4', right(v_key, 4));
END $$;

-- ── อ่าน key จริง (Edge Function เท่านั้น) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.advisor_slot_key(p_slot smallint)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT ds.decrypted_secret
    FROM public.advisor_provider_slots s
    JOIN vault.decrypted_secrets ds ON ds.id = s.key_secret_id
   WHERE s.slot = p_slot;
$$;

REVOKE ALL ON FUNCTION public.advisor_set_slot_key(smallint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advisor_set_slot_key(smallint, text) TO authenticated;
REVOKE ALL ON FUNCTION public.advisor_slot_key(smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advisor_slot_key(smallint) TO service_role;

-- ── สิทธิ์ตาราง ────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.advisor_provider_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.advisor_provider_slots TO authenticated;
GRANT UPDATE (enabled, model, daily_cap, paused_until, pause_reason) ON public.advisor_provider_slots TO authenticated;
GRANT ALL ON public.advisor_provider_slots TO service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.advisor_provider_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advisor_provider_slots_select ON public.advisor_provider_slots;
CREATE POLICY advisor_provider_slots_select ON public.advisor_provider_slots FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin');

DROP POLICY IF EXISTS advisor_provider_slots_update ON public.advisor_provider_slots;
CREATE POLICY advisor_provider_slots_update ON public.advisor_provider_slots FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) = 'superadmin')
  WITH CHECK ((SELECT public.get_my_role()) = 'superadmin');

-- ── ด่านท้ายไฟล์: ผู้รันไม่ใช่เจ้าของ REVOKE จะไม่ error แต่ไม่มีผล (บทเรียน 2026-09-03 / #657) ──
DO $verify$
DECLARE t regclass := 'public.advisor_provider_slots';
BEGIN
  IF (SELECT NOT relrowsecurity FROM pg_class WHERE oid = t)
     OR has_any_column_privilege('anon', t, 'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_table_privilege('anon', t, 'DELETE,TRUNCATE,TRIGGER')
     OR has_table_privilege('authenticated', t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_column_privilege('authenticated', t, 'provider', 'UPDATE') OR has_column_privilege('authenticated', t, 'tier', 'UPDATE')
     OR has_column_privilege('authenticated', t, 'slot', 'UPDATE')
     OR has_column_privilege('authenticated', t, 'key_secret_id', 'UPDATE') OR has_column_privilege('authenticated', t, 'key_last4', 'UPDATE')
     OR has_column_privilege('authenticated', t, 'key_invalid_at', 'UPDATE') OR has_column_privilege('authenticated', t, 'key_set_at', 'UPDATE')
     OR has_column_privilege('authenticated', t, 'updated_by', 'UPDATE') OR has_column_privilege('authenticated', t, 'updated_at', 'UPDATE')
     OR NOT has_column_privilege('authenticated', t, 'daily_cap', 'UPDATE')
     OR NOT has_table_privilege('authenticated', t, 'SELECT')
     OR has_function_privilege('anon', 'public.advisor_set_slot_key(smallint, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.advisor_set_slot_key(smallint, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.advisor_slot_key(smallint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.advisor_slot_key(smallint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.advisor_slot_key(smallint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.advisor_slots_touch()', 'EXECUTE')
     OR (SELECT count(*) FROM pg_proc WHERE oid IN ('public.advisor_set_slot_key(smallint,text)'::regprocedure,
                                                    'public.advisor_slot_key(smallint)'::regprocedure)
           AND prosecdef AND proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
           AND proconfig @> ARRAY['search_path=pg_catalog, public']) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = t AND tgname = 'advisor_provider_slots_touch_trigger' AND NOT tgisinternal)
     OR to_regclass('public.advisor_messages_slot_daily_idx') IS NULL
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = t) <> 2
     OR (SELECT count(*) FROM public.advisor_provider_slots) <> 3 THEN
    RAISE EXCEPTION 'advisor_provider_slots: RLS/สิทธิ์ไม่ตรงตามที่ออกแบบ (ผู้รันต้องเป็นเจ้าของตาราง เช่น postgres)';
  END IF;
END $verify$;

COMMIT;
