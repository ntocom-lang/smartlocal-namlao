-- Backfill ครั้งเดียว: บัญชีประชาชนที่ municipality_id ค้างเป็น NULL
--
-- ที่มา: บัญชีที่สมัคร/ล็อกอินด้วย Google หรือ LINE ไม่เคยได้ municipality_id เลย เพราะ
-- handle_new_user() อ่านค่าจาก raw_user_meta_data ซึ่งมีเฉพาะการสมัครด้วยอีเมล และตัวเติมค่า
-- ฝั่ง client (checkAndFixProfile ใน App.jsx) ก็ถูก trg_guard_profile_privileged_update
-- เวอร์ชันที่พังอยู่บน prod บล็อกไว้อีกชั้น (ดู 20260829120000)
--
-- ผลคือบัญชีเหล่านี้มองไม่เห็นจากหน้า "จัดการผู้ใช้และการแต่งตั้ง" (get_users_with_email()
-- กรองด้วย municipality_id หรือการเคยแจ้งคำร้อง) admin จึงแต่งตั้งตำแหน่งให้ไม่ได้
--
-- ทุกรายเป็นของเทศบาลตำบลน้ำเลา — ยืนยันโดยผู้ดูแลระบบ 2026-08-27 (ระบุจากข้อมูลใน DB
-- เองไม่ได้ เพราะไม่มีรายไหนเคยแจ้งคำร้องเลยสักรายการ จึงไม่มีร่องรอย อปท. ให้อ้างอิง)
--
-- แตะเฉพาะ role = 'citizen' เท่านั้น บัญชี superadmin ต้องคง municipality_id เป็น NULL
-- ตามการออกแบบ cross-tenant

DO $$
DECLARE
  v_muni uuid;
  v_count integer;
BEGIN
  -- ต้องเจอพอดี 1 แถวเท่านั้น ถ้าชื่อไปตรงกับ อปท. อื่นด้วยแล้วเงียบๆ เลือกแถวแรก
  -- จะกลายเป็นการย้ายประชาชนไปผิด อปท. แบบไม่มีใครรู้
  SELECT count(*) INTO v_count FROM public.municipalities WHERE name LIKE '%น้ำเลา%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'คาดว่าจะเจอเทศบาลตำบลน้ำเลา 1 แห่ง แต่เจอ % แห่ง', v_count;
  END IF;

  SELECT id INTO v_muni FROM public.municipalities WHERE name LIKE '%น้ำเลา%';

  -- ผ่าน guard trigger ได้เฉพาะช่องทางที่ตั้งใจ (เทียบเท่าการแก้ผ่าน admin_update_user)
  PERFORM set_config('app.user_management_rpc', '1', true);

  UPDATE public.profiles
  SET municipality_id = v_muni
  WHERE municipality_id IS NULL
    AND role = 'citizen';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'backfill municipality_id ให้ประชาชน % ราย', v_count;
END $$;
