-- 20261115100000_exec_access_overview.sql
--
-- ห้องผู้บริหาร เฟส E2 — ไฟล์ 1/3: ด่านสิทธิ์กลาง + ตัวรวบสรุป executive_overview()
--
-- ทำไมต้องมี: นายก/รองนายก (role viewer) อ่านตาราง complaints/document_requests ตรงๆ ไม่ได้ (RLS) และปลัด (officer)
-- เห็นแค่กองตัวเอง ⇒ ตัวเลขที่ผู้บริหารต้องเห็นทั้ง อปท. (เลยกำหนด / % ทันกำหนด / คะแนน / คอขวด / รายกอง)
-- ต้องมาจาก RPC แบบ SECURITY DEFINER ที่ตรวจสิทธิ์เองข้างใน และคืน "ตัวเลขรวม" เท่านั้น
--
-- ใครเรียกได้ (ต้องตรงกับ src/lib/executiveAccess.js — canOpenExecutiveHome):
--   - viewer (นายก/รองนายก/ที่ปรึกษา/เลขาฯ ตามตำแหน่งมาตรฐาน)
--   - ตำแหน่งหมวด top_admin (ปลัด/รองปลัด) ไม่ว่า role ในกลุ่มเจ้าหน้าที่จะเป็นอะไร
--   - admin / superadmin (admin เห็นคำร้อง/คำขอทั้ง อปท. ผ่าน RLS อยู่แล้ว ไม่ใช่สิทธิ์ใหม่)
--   - ต้องเป็น อปท. เดียวกับ _municipality_id (superadmin ข้ามได้ ตามสิทธิ์เจ้าของระบบเดิม)
--   ประชาชน/เจ้าหน้าที่ทั่วไป/ผู้ไม่ล็อกอิน → 42501 ทั้งก้อน
--
-- โครง: executive_overview() เรียก exec_summary_<key>(uuid,date,date) ทีละตัวแบบ dynamic
--   - เพิ่มโมดูลใหม่ = เขียน exec_summary_<key>() ใหม่ 1 ตัว ไม่ต้อง CREATE OR REPLACE ตัวรวบ (กันเขียนทับ ข้อ 5 NOTES.md)
--   - เรียกได้เฉพาะฟังก์ชันใน schema public ชื่อขึ้นต้น exec_summary_ ที่ "เจ้าของเดียวกับตัวรวบ" เท่านั้น
--     คีย์ผ่าน regex [a-z0-9_] + format(%I) ⇒ ฉีดชื่อฟังก์ชัน/SQL ไม่ได้
--   - ฟังก์ชันย่อยตัวไหนพัง ได้ {ok:false} เฉพาะคีย์นั้น การ์ดอื่นไม่กระทบ · แต่ 42501 (ไม่มีสิทธิ์) โยนขึ้นทั้งก้อนเสมอ
--   - _keys = null → ทุกฟังก์ชัน exec_summary_* ที่มี · หน้าเว็บส่งเฉพาะคีย์ของโมดูลที่ อปท. เปิดอยู่
--
-- ไม่มี ADD COLUMN / CREATE TABLE (ข้อ 3 NOTES.md) — ฟังก์ชันใหม่ทั้งหมด ไม่ทับของเดิม
-- ย้อนกลับ: DROP FUNCTION public.executive_overview(uuid,date,date,text[]); DROP FUNCTION public.exec_assert_viewer(uuid);
--   (ต้อง DROP ไฟล์ 2–3 ก่อน เพราะเรียก exec_assert_viewer)
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT has_function_privilege('anon', 'public.executive_overview(uuid,date,date,text[])', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.executive_overview(uuid,date,date,text[])', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_assert_viewer(uuid)', 'EXECUTE');
--     → false, true, false

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('profiles', 'role'), ('profiles', 'municipality_id'), ('profiles', 'position_id'),
    ('positions', 'id'), ('positions', 'category')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exec_access_overview: ไม่พบคอลัมน์ %', v_missing;
  END IF;
END $$;

-- ── ด่านสิทธิ์กลาง ─────────────────────────────────────────────────────────────────
-- ใช้ภายในเท่านั้น (ฟังก์ชัน exec_* ทุกตัวเรียกเป็นบรรทัดแรก) — ไม่ให้ authenticated เรียกตรง
-- ข้อความเดียวกันทุกกรณี ไม่บอกว่าติดเพราะ role หรือเพราะคนละ อปท.
CREATE OR REPLACE FUNCTION public.exec_assert_viewer(_municipality_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_muni uuid;
  v_cat  text;
  v_ok   boolean;
BEGIN
  SELECT p.role, p.municipality_id, pos.category
    INTO v_role, v_muni, v_cat
  FROM public.profiles AS p
  LEFT JOIN public.positions AS pos ON pos.id = p.position_id
  WHERE p.id = v_uid;

  -- ⚠️ ปิดตายเมื่อไม่แน่ใจ: ตัดสินด้วย "IS NOT TRUE" ไม่ใช่ "IF NOT (...)"
  -- เคยพังในเทสต์: officer ที่ไม่มีตำแหน่ง (v_cat NULL) ทำให้ NOT (false OR NULL) = NULL → IF ไม่ทำงาน → ผ่านด่าน
  v_ok := v_uid IS NOT NULL
          AND _municipality_id IS NOT NULL
          AND v_role IS NOT NULL
          AND (
            v_role IN ('viewer', 'admin', 'superadmin')
            OR (v_cat IS NOT DISTINCT FROM 'top_admin' AND v_role IN ('officer', 'staff', 'council', 'technician'))
          )
          AND (v_role = 'superadmin' OR v_muni IS NOT DISTINCT FROM _municipality_id);

  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูข้อมูลห้องผู้บริหารของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_assert_viewer(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.exec_assert_viewer(uuid) IS
  'ด่านสิทธิ์ห้องผู้บริหาร: viewer / ตำแหน่ง top_admin / admin / superadmin ของ อปท. เดียวกัน — ไม่ผ่าน = 42501 · ใช้ภายในฟังก์ชัน exec_* เท่านั้น';

-- ── ตัวรวบสรุป ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.executive_overview(
  _municipality_id uuid,
  _from            date,
  _to              date,
  _keys            text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner oid;
  v_keys  text[];
  v_key   text;
  v_fn    oid;
  v_part  jsonb;
  v_out   jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);

  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;
  IF _keys IS NOT NULL AND cardinality(_keys) > 40 THEN
    RAISE EXCEPTION 'ขอคีย์สรุปได้ไม่เกิน 40 รายการต่อครั้ง' USING ERRCODE = '22023';
  END IF;

  -- เจ้าของของตัวรวบเอง — ฟังก์ชันย่อยต้องเจ้าของเดียวกัน (ผู้ใช้ทั่วไปสร้างฟังก์ชันที่เจ้าของเป็น postgres ไม่ได้)
  SELECT p.proowner INTO v_owner
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = 'public.executive_overview(uuid,date,date,text[])'::pg_catalog.regprocedure;

  v_keys := COALESCE(_keys, ARRAY(
    SELECT substr(p.proname, length('exec_summary_') + 1)
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'exec\_summary\_%'
      AND p.proowner = v_owner
    ORDER BY p.proname
  ));

  FOREACH v_key IN ARRAY v_keys LOOP
    CONTINUE WHEN v_key IS NULL OR v_out ? v_key;

    IF v_key !~ '^[a-z][a-z0-9_]{0,40}$' THEN
      CONTINUE;  -- คีย์รูปแบบผิด: ไม่ใส่ในผลเลย (ไม่สะท้อนข้อความของผู้เรียกกลับ)
    END IF;

    v_fn := pg_catalog.to_regprocedure(format('public.%I(uuid,date,date)', 'exec_summary_' || v_key));
    IF v_fn IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = v_fn AND p.proowner = v_owner
    ) THEN
      v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('ok', false, 'error', 'unknown_key'));
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('SELECT public.%I($1, $2, $3)', 'exec_summary_' || v_key)
        INTO v_part
        USING _municipality_id, _from, _to;
      v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('ok', true, 'data', v_part));
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE;  -- สิทธิ์ไม่ผ่าน ห้ามกลืนเป็น "การ์ดโหลดไม่ได้"
      WHEN OTHERS THEN
        -- เก็บแค่ SQLSTATE: SQLERRM อาจพาค่าข้อมูลจริง (เช่น ค่าที่แปลงชนิดไม่ได้) ลง log ของ Postgres
        RAISE WARNING 'executive_overview: % ล้ม (SQLSTATE %)', v_key, SQLSTATE;
        v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('ok', false, 'error', SQLSTATE));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'today', (now() AT TIME ZONE 'Asia/Bangkok')::date,
    'from', _from,
    'to', _to,
    'summaries', v_out
  );
END;
$$;

-- Supabase แจก EXECUTE ให้ anon/authenticated อัตโนมัติกับฟังก์ชันใหม่ใน public — ถอน PUBLIC + anon เอง (ข้อ 5 NOTES.md)
REVOKE ALL ON FUNCTION public.executive_overview(uuid, date, date, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.executive_overview(uuid, date, date, text[]) TO authenticated;

COMMENT ON FUNCTION public.executive_overview(uuid, date, date, text[]) IS
  'ห้องผู้บริหาร: รวบผล exec_summary_<key>() ทุกตัว (หรือเฉพาะ _keys) คืนตัวเลขรวมเท่านั้น ไม่คืนชื่อคน · '
  'ฟังก์ชันย่อยพัง = {ok:false} เฉพาะคีย์นั้น · ไม่มีสิทธิ์ = 42501 ทั้งก้อน';

NOTIFY pgrst, 'reload schema';
