-- ============================================================================
-- SmartLocal: สร้างบัญชีทดสอบครบทุกสิทธิ์ใน อปท. ทดสอบ 'demo'
-- ============================================================================
-- แทนที่ seed_test_accounts.sql เดิม (ลบทิ้งแล้ว) ซึ่งยิงบัญชีลง 'namlao'
-- และมี fallback "อปท. แรกในระบบ" ที่ทำให้บัญชีปลอมไปโผล่ที่ อปท. ที่ขายแล้วได้
--
-- ⚠️ ก่อนรัน: กรอก v_password และ v_su_password ข้างล่าง
--    แล้ว **ห้าม commit ค่านั้นกลับเข้า repo**
--    สคริปต์จะปฏิเสธการรันถ้ายังว่างหรือสั้นกว่า 12 ตัวอักษร
--
-- รันซ้ำได้ — ใช้ uuid ตายตัว ทุกขั้นตอนเป็น upsert (ใช้รีเซ็ตรหัสผ่านทั้งชุดได้ด้วย)
-- ล้างทิ้งทั้งชุด: delete from auth.users where email like 'demo-%@smartlocal.test';
--
-- ── ⚠️ บัญชี superadmin: อ่านก่อนใช้ ────────────────────────────────────────
-- demo-superadmin ไม่ได้อยู่ใน อปท. ไหนเลย (municipality_id = NULL) เพราะ superadmin
-- ตัวจริงเป็นแบบนั้น และ **ต้องเป็นแบบนั้นเท่านั้น** ถึงจะใช้ทดสอบบั๊กที่ policy
-- เทียบ c.municipality_id = get_my_municipality_id() แล้วได้ NULL ได้ (ดู
-- 20260829124748_fix_complaint_timeline_superadmin.sql)
--
-- ผลที่ตามมาซึ่งเลี่ยงไม่ได้: บัญชีนี้ **เข้าถึงข้อมูลของทุก อปท. รวมคำร้องจริงของ
-- ประชาชนน้ำเลา** เพราะ get_my_role() = 'superadmin' เป็น OR branch แรกในแทบทุก policy
-- และ AuthContext.jsx คืน role superadmin ก่อนเช็ค municipality เสมอ — ไม่มีทางจำกัด
-- ขอบเขตให้อยู่แค่สนามซ้อมได้
--
-- จึงต้อง: ใช้รหัสผ่านคนละตัวกับบัญชีอื่น · ห้ามเขียนรหัสลงเอกสารหรือ repo ·
-- **ลบทิ้งทันทีที่ทดสอบเสร็จ**
--   delete from auth.users where email = 'demo-superadmin@smartlocal.test';
--
-- ── สิ่งที่ตรวจจาก schema จริงก่อนเขียนไฟล์นี้ (2026-08-29) ────────────────────
-- 1. trigger on_auth_user_created (AFTER INSERT auth.users) สร้าง profile ให้เอง
--    เป็น role='citizen' และอ่าน municipality_id จาก raw_user_meta_data
-- 2. trigger trg_auto_fleet_role ยิง **เฉพาะ BEFORE INSERT** ของ profiles และ
--    เขียนทับ fleet_role ตาม role เสมอ จึงต้องตั้ง fleet_role ตอน UPDATE ไม่ใช่ INSERT
--    (ไม่งั้นสร้างบัญชี staff ที่ fleet_role = NULL หรือ fleet_viewer ไม่ได้เลย)
-- 3. trigger trg_guard_profile_privileged_update บล็อกการแก้ role/สังกัด/fleet_role/
--    position_id ยกเว้นตอน auth.role() เป็น NULL (SQL editor) หรือมี
--    app.user_management_rpc='1' — สคริปต์ตั้งค่าที่สองไว้ให้
-- 4. auth.identities.email เป็น GENERATED ALWAYS ห้าม insert · id เป็น uuid มี default
-- 5. ช่อง token ของ auth.users ตั้งเป็น '' ทุกช่อง ไม่ปล่อย NULL
--    (GoTrue บางรุ่นอ่าน NULL เป็น string ไม่ได้ แล้วพังทั้งระบบล็อกอิน)
-- 6. public.positions เป็นตารางกลาง ไม่ผูก municipality — จับคู่ด้วยชื่อตำแหน่ง
-- ============================================================================

DO $seed$
DECLARE
  -- ⚠️ กรอกรหัสผ่านตรงนี้ก่อนรัน แล้วลบออกก่อน commit
  v_password    text := '';   -- ใช้กับบัญชีทั่วไป 16 บัญชี
  v_su_password text := '';   -- ใช้กับ demo-superadmin เท่านั้น ต้องคนละตัว

  v_target_slug text := 'demo';
  v_muni_id  uuid;
  v_enc_pw   text;
  v_enc_su   text;
  v_created  int := 0;
  r          record;
  v_uid      uuid;
  v_email    text;
  v_dept_id  uuid;
  v_dept_nm  text;
  v_pos_id   uuid;
  v_use_muni uuid;
  v_pw       text;
BEGIN
  -- ── ด่านที่ 1: ห้ามยิงลง อปท. ที่ใช้งานจริงเด็ดขาด ──────────────────────────
  IF v_target_slug IN ('namlao', 'tamnaktham', 'thungkaew', 'muangphrae') THEN
    RAISE EXCEPTION 'ปฏิเสธ: % เป็น อปท. ที่ใช้งานจริง ห้ามสร้างบัญชีทดสอบลงไป', v_target_slug;
  END IF;

  -- ── ด่านที่ 2: บังคับตั้งรหัสผ่านเอง และ superadmin ต้องคนละตัว ─────────────
  IF v_password IS NULL OR length(v_password) < 12 THEN
    RAISE EXCEPTION 'ต้องกรอก v_password อย่างน้อย 12 ตัวอักษรก่อนรัน (และห้าม commit ค่านั้น)';
  END IF;
  IF v_su_password IS NULL OR length(v_su_password) < 12 THEN
    RAISE EXCEPTION 'ต้องกรอก v_su_password อย่างน้อย 12 ตัวอักษรก่อนรัน';
  END IF;
  IF v_su_password = v_password THEN
    RAISE EXCEPTION 'รหัสผ่าน superadmin ต้องไม่ซ้ำกับบัญชีอื่น — บัญชีนี้เข้าถึงข้อมูลทุก อปท.';
  END IF;

  -- ── ด่านที่ 3: หา อปท. ทดสอบไม่เจอ = หยุด ห้ามเดา อปท. ให้ ─────────────────
  SELECT id INTO v_muni_id FROM public.municipalities WHERE slug = v_target_slug;
  IF v_muni_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ อปท. ทดสอบ slug=% — ต้องรัน migration 20260829113107_seed_demo_tenant.sql ก่อน', v_target_slug;
  END IF;

  -- ปลดล็อก guard ให้แก้ role/สังกัด/fleet_role/position ได้ (local เฉพาะ transaction นี้)
  PERFORM set_config('app.user_management_rpc', '1', true);

  BEGIN
    v_enc_pw := extensions.crypt(v_password,    extensions.gen_salt('bf', 10));
    v_enc_su := extensions.crypt(v_su_password, extensions.gen_salt('bf', 10));
  EXCEPTION WHEN OTHERS THEN
    v_enc_pw := crypt(v_password,    gen_salt('bf', 10));
    v_enc_su := crypt(v_su_password, gen_salt('bf', 10));
  END;

  -- ── รายชื่อบัญชี ────────────────────────────────────────────────────────────
  -- ครบทั้ง 8 role · ครบ 3 fleet_role · ครบทั้ง 7 กองของสนามซ้อม (ไม่มีกองไหนเหลือ 0)
  -- คอลัมน์ pos_name จับคู่กับ public.positions ด้วยชื่อเป๊ะ เพื่อให้คอลัมน์
  -- "สังกัดและตำแหน่ง" ในหน้าจัดการผู้ใช้มีข้อมูลให้เรียงจริง
  FOR r IN
    SELECT * FROM (VALUES
      -- สำนักปลัด
      ('0de00000-0000-4000-8000-000000000001','demo-admin',        '[TEST] ปลัด อบต. (แอดมินระบบ)', 'admin',      'fleet_admin',  'general',       'ปลัดองค์การบริหารส่วนตำบล',  'ปลัดเทศบาล / ปลัดองค์การบริหารส่วนตำบล'),
      ('0de00000-0000-4000-8000-000000000006','demo-technician-2', '[TEST] ช่างไฟฟ้า สำนักปลัด',    'technician', NULL,           'general',       'ช่างไฟฟ้า',                  'ช่างไฟฟ้า'),
      -- กองช่าง
      ('0de00000-0000-4000-8000-000000000002','demo-officer-eng',  '[TEST] ผอ.กองช่าง',            'officer',    'fleet_staff',  'engineering',   'ผู้อำนวยการกองช่าง',         'ผู้อำนวยการกองช่าง'),
      ('0de00000-0000-4000-8000-000000000004','demo-staff',        '[TEST] เจ้าพนักงานกองช่าง',     'staff',      NULL,           'engineering',   'เจ้าพนักงานธุรการ',          'เจ้าพนักงาน'),
      ('0de00000-0000-4000-8000-000000000005','demo-technician',   '[TEST] นายช่างโยธา',           'technician', NULL,           'engineering',   'นายช่างโยธาปฏิบัติงาน',      'นายช่างโยธา'),
      ('0de00000-0000-4000-8000-000000000010','demo-fleet-admin',  '[TEST] ผู้ดูแลยานพาหนะ',        'staff',      'fleet_admin',  'engineering',   'ผู้ดูแลระบบยานพาหนะ',        'นักวิชาการ'),
      ('0de00000-0000-4000-8000-000000000011','demo-fleet-staff',  '[TEST] พนักงานขับรถ',          'staff',      'fleet_staff',  'engineering',   'พนักงานขับรถยนต์',           'พนักงานขับเครื่องจักรกล'),
      ('0de00000-0000-4000-8000-000000000012','demo-fleet-viewer', '[TEST] ผู้ตรวจการยานพาหนะ',     'staff',      'fleet_viewer', 'engineering',   'ผู้ตรวจการ',                 'พนักงานจ้างทั่วไป/ผู้ช่วยเจ้าหน้าที่'),
      -- กองคลัง
      ('0de00000-0000-4000-8000-000000000003','demo-officer-fin',  '[TEST] ผอ.กองคลัง',            'officer',    'fleet_staff',  'finance',       'ผู้อำนวยการกองคลัง',         'ผู้อำนวยการกองคลัง'),
      -- กองการศึกษา
      ('0de00000-0000-4000-8000-000000000013','demo-officer-edu',  '[TEST] ผอ.กองการศึกษา',        'officer',    'fleet_staff',  'education',     'ผู้อำนวยการกองการศึกษา',     'ผู้อำนวยการกองการศึกษา ศาสนาและวัฒนธรรม'),
      ('0de00000-0000-4000-8000-000000000014','demo-staff-edu',    '[TEST] ครูผู้ดูแลเด็ก',          'staff',      NULL,           'education',     'ครูผู้ดูแลเด็ก',              'ครู/ผู้ดูแลเด็ก'),
      -- ตรวจสอบภายใน
      ('0de00000-0000-4000-8000-000000000015','demo-officer-audit','[TEST] หัวหน้าหน่วยตรวจสอบภายใน','officer',   'fleet_viewer', 'dept_mrrhejo0', 'หัวหน้าหน่วยตรวจสอบภายใน',   'หัวหน้าหน่วยตรวจสอบภายใน'),
      ('0de00000-0000-4000-8000-000000000016','demo-staff-audit',  '[TEST] นักวิชาการตรวจสอบภายใน', 'staff',      NULL,           'dept_mrrhejo0', 'นักวิชาการตรวจสอบภายใน',     'นักวิชาการตรวจสอบภายใน'),
      -- ผู้บริหาร
      ('0de00000-0000-4000-8000-000000000007','demo-viewer',       '[TEST] นายก อบต.',             'viewer',     'fleet_viewer', 'exec',          'นายกองค์การบริหารส่วนตำบล',  'นายกเทศมนตรี / นายกองค์การบริหารส่วนตำบล'),
      -- สมาชิกสภา
      ('0de00000-0000-4000-8000-000000000008','demo-council',      '[TEST] สมาชิกสภา',             'council',    'fleet_viewer', 'dept_mrri8ora', 'สมาชิกสภา',                  'สมาชิกสภา'),
      -- ประชาชน (ไม่มีสังกัด)
      ('0de00000-0000-4000-8000-000000000009','demo-citizen',      '[TEST] ประชาชนทดสอบ',          'citizen',    NULL,           NULL,            NULL,                         NULL),
      -- superadmin: municipality_id = NULL โดยเจตนา (ดูคำเตือนหัวไฟล์)
      ('0de00000-0000-4000-8000-000000000099','demo-superadmin',   '[TEST] Super Admin',           'superadmin', 'fleet_admin',  NULL,            'ผู้ดูแลระบบส่วนกลาง',        NULL)
    ) AS t(uid, local_part, full_name, role, fleet_role, dept_code, job_title, pos_name)
  LOOP
    v_uid   := r.uid::uuid;
    v_email := r.local_part || '@smartlocal.test';
    v_dept_id := NULL;
    v_dept_nm := NULL;
    v_pos_id  := NULL;

    -- superadmin ไม่สังกัด อปท. ใดเลย และใช้รหัสผ่านคนละตัว
    v_use_muni := CASE WHEN r.role = 'superadmin' THEN NULL ELSE v_muni_id END;
    v_pw       := CASE WHEN r.role = 'superadmin' THEN v_enc_su ELSE v_enc_pw END;

    IF r.dept_code IS NOT NULL THEN
      SELECT d.id, d.name INTO v_dept_id, v_dept_nm
      FROM public.departments d
      WHERE d.municipality_id = v_muni_id AND d.code = r.dept_code;
      IF v_dept_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบกอง code=% ใน อปท. % — โครงสร้างกองไม่ตรงกับที่ seed ไว้', r.dept_code, v_target_slug;
      END IF;
    END IF;

    IF r.pos_name IS NOT NULL THEN
      SELECT p.id INTO v_pos_id FROM public.positions p WHERE p.name = r.pos_name;
      IF v_pos_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบตำแหน่ง "%" ในทำเนียบ public.positions', r.pos_name;
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
      v_email, v_pw, now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', r.full_name, 'municipality_id', COALESCE(v_use_muni::text, '')),
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
    VALUES (v_uid, v_email, r.full_name, 'citizen', v_use_muni)
    ON CONFLICT (id) DO NOTHING;

    -- 4) ตั้งค่าจริงด้วย UPDATE — trg_auto_fleet_role ไม่ยิงตอน UPDATE
    UPDATE public.profiles SET
      email           = v_email,
      full_name       = r.full_name,
      role            = r.role,
      fleet_role      = r.fleet_role,
      municipality_id = v_use_muni,
      department_id   = v_dept_id,
      department      = v_dept_nm,
      job_title       = r.job_title,
      position_id     = v_pos_id,
      is_dept_head    = (r.role = 'officer')
    WHERE id = v_uid;

    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE '✅ สร้าง/อัปเดตบัญชีทดสอบ % บัญชี ใน อปท. % (id=%)', v_created, v_target_slug, v_muni_id;
END $seed$;
