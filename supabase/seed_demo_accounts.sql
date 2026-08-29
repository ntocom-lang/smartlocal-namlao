-- ============================================================================
-- SmartLocal: สร้างบัญชีทดสอบครบทุกสิทธิ์ใน อปท. ทดสอบ 'demo'
-- ============================================================================
-- แทนที่ seed_test_accounts.sql เดิม (ลบทิ้งแล้ว) ซึ่งยิงบัญชีลง 'namlao'
-- และมี fallback "อปท. แรกในระบบ" ที่ทำให้บัญชีปลอมไปโผล่ที่ อปท. ที่ขายแล้วได้
--
-- ⚠️ ก่อนรัน: กรอก v_password ข้างล่าง แล้ว **ห้าม commit ค่านั้นกลับเข้า repo**
--    สคริปต์จะปฏิเสธการรันถ้ายังว่างหรือสั้นกว่า 12 ตัวอักษร
--
-- รันซ้ำได้ — ใช้ uuid ตายตัว ทุกขั้นตอนเป็น upsert
-- ล้างทิ้งทั้งชุด: delete from auth.users where email like 'demo-%@smartlocal.test';
--
-- ── สิ่งที่ตรวจจาก schema จริงก่อนเขียนไฟล์นี้ (2026-08-29) ────────────────────
-- 1. trigger on_auth_user_created (AFTER INSERT auth.users) สร้าง profile ให้เอง
--    เป็น role='citizen' และอ่าน municipality_id จาก raw_user_meta_data
-- 2. trigger trg_auto_fleet_role ยิง **เฉพาะ BEFORE INSERT** ของ profiles และ
--    เขียนทับ fleet_role ตาม role เสมอ จึงต้องตั้ง fleet_role ตอน UPDATE ไม่ใช่ INSERT
--    (ไม่งั้นสร้างบัญชี staff ที่ fleet_role = NULL หรือ fleet_viewer ไม่ได้เลย)
-- 3. trigger trg_guard_profile_privileged_update บล็อกการแก้ role/สังกัด/fleet_role
--    ยกเว้นตอน auth.role() เป็น NULL (รันจาก SQL editor) หรือมี app.user_management_rpc='1'
--    สคริปต์ตั้งค่าที่สองไว้ให้ เพื่อให้รันผ่าน psql/service_role ได้ด้วย
-- 4. auth.identities.email เป็น GENERATED ALWAYS ห้าม insert · id เป็น uuid มี default
-- 5. ช่อง token ของ auth.users ตั้งเป็น '' ทุกช่อง ไม่ปล่อย NULL
--    (GoTrue บางรุ่นอ่าน NULL เป็น string ไม่ได้ แล้วพังทั้งระบบล็อกอิน)
-- ============================================================================

DO $seed$
DECLARE
  -- ⚠️ กรอกรหัสผ่านตรงนี้ก่อนรัน แล้วลบออกก่อน commit
  v_password text := '';

  v_target_slug text := 'demo';
  v_muni_id  uuid;
  v_enc_pw   text;
  v_created  int := 0;
  r          record;
  v_uid      uuid;
  v_email    text;
  v_dept_id  uuid;
  v_dept_nm  text;
BEGIN
  -- ── ด่านที่ 1: ห้ามยิงลง อปท. ที่ใช้งานจริงเด็ดขาด ──────────────────────────
  IF v_target_slug IN ('namlao', 'tamnaktham', 'thungkaew', 'muangphrae') THEN
    RAISE EXCEPTION 'ปฏิเสธ: % เป็น อปท. ที่ใช้งานจริง ห้ามสร้างบัญชีทดสอบลงไป', v_target_slug;
  END IF;

  -- ── ด่านที่ 2: บังคับให้ตั้งรหัสผ่านเอง ห้าม hardcode ไว้ใน repo ────────────
  IF v_password IS NULL OR length(v_password) < 12 THEN
    RAISE EXCEPTION 'ต้องกรอก v_password อย่างน้อย 12 ตัวอักษรก่อนรัน (และห้าม commit ค่านั้น)';
  END IF;

  -- ── ด่านที่ 3: หา อปท. ทดสอบไม่เจอ = หยุด ห้ามเดา อปท. ให้ ─────────────────
  SELECT id INTO v_muni_id FROM public.municipalities WHERE slug = v_target_slug;
  IF v_muni_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ อปท. ทดสอบ slug=% — ต้องรัน migration 20260829113107_seed_demo_tenant.sql ก่อน', v_target_slug;
  END IF;

  -- ปลดล็อก guard ให้แก้ role/สังกัด/fleet_role ได้ (local เฉพาะ transaction นี้)
  PERFORM set_config('app.user_management_rpc', '1', true);

  BEGIN
    v_enc_pw := extensions.crypt(v_password, extensions.gen_salt('bf', 10));
  EXCEPTION WHEN OTHERS THEN
    v_enc_pw := crypt(v_password, gen_salt('bf', 10));
  END;

  -- ── รายชื่อบัญชี: ครบทั้ง 7 role (ยกเว้น superadmin) + ครบ 3 fleet_role ─────
  -- มี 2 กอง (กองช่าง/กองคลัง) เพื่อทดสอบว่าหัวหน้ากองหนึ่งไม่เห็นงานของอีกกอง
  -- และมี staff ที่ fleet_role = NULL ไว้ทดสอบเคส "ไม่มีสิทธิ์โมดูลยานพาหนะ"
  FOR r IN
    SELECT * FROM (VALUES
      ('0de00000-0000-4000-8000-000000000001','demo-admin',        '[TEST] แอดมินระบบ',        'admin',      'fleet_admin',  'general',       'นักวิชาการคอมพิวเตอร์'),
      ('0de00000-0000-4000-8000-000000000002','demo-officer-eng',  '[TEST] ผอ.กองช่าง',        'officer',    'fleet_staff',  'engineering',   'ผู้อำนวยการกองช่าง'),
      ('0de00000-0000-4000-8000-000000000003','demo-officer-fin',  '[TEST] ผอ.กองคลัง',        'officer',    'fleet_staff',  'finance',       'ผู้อำนวยการกองคลัง'),
      ('0de00000-0000-4000-8000-000000000004','demo-staff',        '[TEST] เจ้าหน้าที่กองช่าง',  'staff',      NULL,           'engineering',   'เจ้าพนักงานธุรการ'),
      ('0de00000-0000-4000-8000-000000000005','demo-technician',   '[TEST] นายช่างโยธา',       'technician', NULL,           'engineering',   'นายช่างโยธาปฏิบัติงาน'),
      ('0de00000-0000-4000-8000-000000000006','demo-technician-2', '[TEST] นายช่างสำนักปลัด',   'technician', NULL,           'general',       'นายช่างปฏิบัติงาน'),
      ('0de00000-0000-4000-8000-000000000007','demo-viewer',       '[TEST] นายกเทศมนตรี',      'viewer',     'fleet_viewer', 'exec',          'นายกเทศมนตรี'),
      ('0de00000-0000-4000-8000-000000000008','demo-council',      '[TEST] สมาชิกสภา',         'council',    'fleet_viewer', 'dept_mrri8ora', 'สมาชิกสภาเทศบาลตำบล'),
      ('0de00000-0000-4000-8000-000000000009','demo-citizen',      '[TEST] ประชาชนทดสอบ',      'citizen',    NULL,           NULL,            NULL),
      ('0de00000-0000-4000-8000-000000000010','demo-fleet-admin',  '[TEST] ผู้ดูแลยานพาหนะ',    'staff',      'fleet_admin',  'engineering',   'ผู้ดูแลระบบยานพาหนะ'),
      ('0de00000-0000-4000-8000-000000000011','demo-fleet-staff',  '[TEST] พนักงานขับรถ',      'staff',      'fleet_staff',  'engineering',   'พนักงานขับรถยนต์'),
      ('0de00000-0000-4000-8000-000000000012','demo-fleet-viewer', '[TEST] ผู้ตรวจการยานพาหนะ', 'staff',      'fleet_viewer', 'engineering',   'ผู้ตรวจการ')
    ) AS t(uid, local_part, full_name, role, fleet_role, dept_code, job_title)
  LOOP
    v_uid   := r.uid::uuid;
    v_email := r.local_part || '@smartlocal.test';
    v_dept_id := NULL;
    v_dept_nm := NULL;

    IF r.dept_code IS NOT NULL THEN
      SELECT d.id, d.name INTO v_dept_id, v_dept_nm
      FROM public.departments d
      WHERE d.municipality_id = v_muni_id AND d.code = r.dept_code;
      IF v_dept_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบกอง code=% ใน อปท. % — โครงสร้างกองไม่ตรงกับที่ seed ไว้', r.dept_code, v_target_slug;
      END IF;
    END IF;

    -- 1) auth.users — ช่อง token ตั้ง '' ทุกช่อง ไม่ปล่อย NULL
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_email, v_enc_pw, now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', r.full_name, 'municipality_id', v_muni_id::text),
      now(), now(), false,
      '', '', '', '', '', '', '', ''
    )
    ON CONFLICT (id) DO UPDATE SET
      email              = EXCLUDED.email,
      encrypted_password = EXCLUDED.encrypted_password,
      email_confirmed_at = now(),
      raw_user_meta_data = EXCLUDED.raw_user_meta_data,
      updated_at         = now();

    -- 2) auth.identities — จำเป็นสำหรับล็อกอินด้วยอีเมล/รหัสผ่าน
    --    ห้ามใส่คอลัมน์ email (GENERATED ALWAYS) และปล่อย id ใช้ default
    DELETE FROM auth.identities WHERE user_id = v_uid AND provider = 'email';
    INSERT INTO auth.identities (user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
      'email', v_uid::text, now(), now(), now()
    );

    -- 3) profiles — INSERT ขั้นต่ำก่อน (เลี่ยง trg_auto_fleet_role ที่เขียนทับ fleet_role)
    INSERT INTO public.profiles (id, email, full_name, role, municipality_id)
    VALUES (v_uid, v_email, r.full_name, 'citizen', v_muni_id)
    ON CONFLICT (id) DO NOTHING;

    -- 4) ตั้งค่าจริงด้วย UPDATE — trg_auto_fleet_role ไม่ยิงตอน UPDATE
    UPDATE public.profiles SET
      email           = v_email,
      full_name       = r.full_name,
      role            = r.role,
      fleet_role      = r.fleet_role,
      municipality_id = v_muni_id,
      department_id   = v_dept_id,
      department      = v_dept_nm,
      job_title       = r.job_title,
      is_dept_head    = (r.role = 'officer')
    WHERE id = v_uid;

    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE '✅ สร้าง/อัปเดตบัญชีทดสอบ % บัญชี ใน อปท. % (id=%)', v_created, v_target_slug, v_muni_id;
END $seed$;
