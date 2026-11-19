-- ซ่อน uuid ผู้ใช้ (created_by / updated_by / verified_by / user_id) จากผู้ไม่ล็อกอิน (anon) — 11 ตาราง
--
-- ⚠️ ประวัติ: ฉบับแรกของไฟล์นี้ (ใช้ temp table) ถูกรันใน SQL Editor บนฐานจริง 2026-11-19 ก่อน deploy หน้าเว็บ
--    ⇒ ถอนสิทธิ์สำเร็จทั้ง 11 ตาราง (ทั้งที่จอขึ้น 42P01 _anon_cols) และหน้ากิจกรรม/รีวิวร้านของผู้ไม่ล็อกอินว่าง
--    ทางแก้ชั่วคราว: GRANT SELECT ON public.events, public.tourism_reviews TO anon (คืน 2 ตารางที่หน้าเว็บเดิมยัง select *)
--    ฉบับนี้เขียนใหม่เป็น DO block เดียว ไม่ใช้ temp table และรันซ้ำได้ (idempotent) — รันอีกรอบหลัง deploy เพื่อปิด 2 ตารางนั้น
--    schema_migrations ยังไม่มีเลขนี้ (SQL Editor ไม่บันทึก) — รันผ่าน CLI แล้วบันทึกเลข version ตามขั้นตอนเดิม
--
-- ⛔ รันหลัง deploy หน้าเว็บที่เลิก select('*') แล้วเท่านั้น (PR เดียวกับไฟล์นี้: src/lib/anonColumns.js)
--    PostgreSQL ซ่อนคอลัมน์ด้วย RLS ไม่ได้ ⇒ ถอน SELECT ทั้งตารางของ anon แล้วให้รายคอลัมน์
--    anon ที่ยังยิง select=* / อ้างคอลัมน์ที่ซ่อน (select, filter, order, embed ผ่าน FK) จะได้ 42501 ทั้งคำสั่ง
--    ตรวจก่อนรัน: chunk production ของ EventsSection / EventsPage / TourismDetailPage ไม่มี select=* ของตารางเหล่านี้
--
-- เหตุผล: วัดจริง 2026-11-19 (GET แบบ anon) เห็น uuid ผู้ใช้ 7 ตาราง — data_center_entries 546 แถว, posts 116,
--   events 37, tourism_places 18, tourism_reviews 2 (ประชาชน), org_projects 1, org_project_updates 1
--   + 4 ตารางที่ policy เปิดอ่านแล้วแต่คอลัมน์ยังว่าง (public_holidays, service_faqs, service_forms, infrastructure_works)
--   uuid เป็นวัตถุดิบของการปลอมตัวตนในช่องถัดไป และ user_id ในรีวิวผูกความเห็นกับบัญชีประชาชน (PDPA)
--   ผู้ล็อกอินแล้ว (authenticated) ไม่เปลี่ยน — หน้าเจ้าหน้าที่ใช้ select('*') และ policy หลายตัวอ้างคอลัมน์เหล่านี้
--   (PostgreSQL ไม่ตรวจสิทธิ์รายคอลัมน์ในนิพจน์ policy) · แทนร่าง docs/database/parked-tourism-places-anon-column-grant.sql
--
-- ตรวจแล้ว 2026-11-19: ฟังก์ชัน SECURITY INVOKER ที่ anon เรียกได้และอ่านตารางเหล่านี้มีตัวเดียว
--   data_center_public_stats — count(*) + group_name/route_points/shape/updated_at/municipality_id/status ไม่กระทบ
--
-- ⚠️ กับดักแบบ municipalities (docs/ai/NOTES.md ข้อ 4): ADD COLUMN ใน 11 ตารางนี้ทีหลัง anon จะไม่ได้สิทธิ์อัตโนมัติ
--    คอลัมน์สาธารณะใหม่ = migration GRANT SELECT (<col>) ON <table> TO anon + เพิ่มชื่อใน src/lib/anonColumns.js
--    ไม่งั้นหน้าสาธารณะที่ select คอลัมน์นั้นว่างทั้งหน้า (42501) · เขียนเป็นไฟล์ใหม่ ห้ามแก้ไฟล์นี้หลังรันแล้ว
--
-- ย้อนกลับ (ถ้าหน้าสาธารณะว่างหลังรัน — ย้อนได้ครบ ไม่มีข้อมูลหาย):
--   GRANT SELECT ON public.<table> TO anon;  (เฉพาะตารางที่มีปัญหา หรือทั้ง 11)  แล้ว NOTIFY pgrst, 'reload schema';
-- smoke หลังรัน (ทุกตาราง): anon GET /rest/v1/<table>?select=id&limit=1 = 200 · ?select=created_by = 401
--   + เปิดหน้าแรก /events /tourism /tourism/<id> /data-center/public /service-search แบบไม่ล็อกอิน ทุก tenant ที่ใช้งานจริง
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $sweep$
DECLARE
  -- ต้องตรงกับ src/lib/anonColumns.js (ANON_COLUMN_LIST / ANON_HIDDEN_COLUMNS) — tests/anon-columns.test.mjs เทียบให้
  -- ANON_SPEC_BEGIN
  v_spec jsonb := $spec$
  {
    "data_center_entries": {"hidden": ["created_by","verified_by"], "visible": ["id","municipality_id","group_name","category","name","description","latitude","longitude","photo_urls","external_url","status","created_at","updated_at","location","route_points","route_color","department_id","verified_at","shape","import_batch_id"]},
    "events": {"hidden": ["created_by"], "visible": ["id","municipality_id","title","description","event_date","event_time","end_date","location","category","is_all_day","created_at","updated_at","attachment_url","end_time","attachment_urls","audiences","department_id"]},
    "infrastructure_works": {"hidden": ["created_by"], "visible": ["id","municipality_id","title","category","description","budget","work_year","work_date","latitude","longitude","location_name","photos","status","complaint_id","created_at","work_type","contractor","contract_no","location","department_id"]},
    "org_project_updates": {"hidden": ["created_by"], "visible": ["id","project_id","municipality_id","update_type","title","body","update_date","photos","created_at","links","note"]},
    "org_projects": {"hidden": ["created_by"], "visible": ["id","municipality_id","title","subtitle","category","description","status","start_date","end_date","cover_image_url","is_public","tags","sort_order","created_at","updated_at","department_id"]},
    "posts": {"hidden": ["created_by"], "visible": ["id","municipality_id","type","title","excerpt","image_url","event_date","is_published","created_at","updated_at","image_position","department_id"]},
    "public_holidays": {"hidden": ["updated_by"], "visible": ["id","municipality_id","holiday_date","name","is_working_day","note","updated_at","created_at"]},
    "service_faqs": {"hidden": ["created_by","updated_by"], "visible": ["id","municipality_id","department_id","question","answer","keywords","link_url","link_label","is_published","sort_order","created_at","updated_at"]},
    "service_forms": {"hidden": ["created_by","updated_by"], "visible": ["id","municipality_id","department_id","title","description","file_url","drive_file_id","file_name","content_type","keywords","is_published","sort_order","created_at","updated_at"]},
    "tourism_places": {"hidden": ["created_by"], "visible": ["id","municipality_id","name","category","image_url","description","is_active","display_order","created_at","address","maps_url","gallery","phone","service_type","online_service","online_url","has_delivery","department_id","latitude","longitude","opening_hours","hours_note","facebook_url","line_id","is_featured","village_no","price_range","updated_at"]},
    "tourism_reviews": {"hidden": ["user_id"], "visible": ["id","place_id","municipality_id","rating","comment","created_at","reviewer_name"]}
  }
  $spec$;
  -- ANON_SPEC_END
  v_tbl text;
  v_rel regclass;
  v_visible text[];
  v_hidden text[];
  v_actual text[];
  v_expected text[];
  c text;
BEGIN
  IF (SELECT count(*) FROM jsonb_object_keys(v_spec)) <> 11 THEN
    RAISE EXCEPTION 'รายการตารางไม่ครบ 11';
  END IF;

  -- ด่านก่อนรัน (ครบทุกตารางก่อนแตะสิทธิ์ใดๆ): โครงตารางจริงต้องเท่ากับ visible ∪ hidden พอดี
  -- มีคอลัมน์ที่ไม่รู้จัก = หยุด ให้คนตัดสินว่าสาธารณะไหม แทนที่จะซ่อนเงียบ (หน้าเว็บว่าง) หรือเปิดเงียบ (ข้อมูลหลุด)
  FOR v_tbl IN SELECT k FROM jsonb_object_keys(v_spec) k ORDER BY k LOOP
    v_rel := to_regclass(format('public.%I', v_tbl));
    IF v_rel IS NULL THEN
      RAISE EXCEPTION 'ไม่พบตาราง public.%', v_tbl;
    END IF;
    SELECT array_agg(x) INTO v_visible FROM jsonb_array_elements_text(v_spec -> v_tbl -> 'visible') x;
    SELECT array_agg(x) INTO v_hidden FROM jsonb_array_elements_text(v_spec -> v_tbl -> 'hidden') x;
    IF v_visible IS NULL OR v_hidden IS NULL THEN
      RAISE EXCEPTION '%: visible/hidden ว่าง', v_tbl;
    END IF;
    IF v_visible && v_hidden THEN
      RAISE EXCEPTION '%: คอลัมน์อยู่ทั้ง visible และ hidden', v_tbl;
    END IF;
    SELECT array_agg(attname::text ORDER BY attname) INTO v_actual
      FROM pg_attribute WHERE attrelid = v_rel AND attnum > 0 AND NOT attisdropped;
    SELECT array_agg(x ORDER BY x) INTO v_expected FROM unnest(v_visible || v_hidden) x;
    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION '% คอลัมน์ไม่ตรงรายชื่อที่คาด — เกิน: % / ขาด: %', v_tbl,
        (SELECT array_agg(x) FROM unnest(v_actual) x WHERE x <> ALL (v_expected)),
        (SELECT array_agg(x) FROM unnest(v_expected) x WHERE x <> ALL (v_actual));
    END IF;
  END LOOP;

  FOR v_tbl IN SELECT k FROM jsonb_object_keys(v_spec) k ORDER BY k LOOP
    SELECT array_agg(x) INTO v_visible FROM jsonb_array_elements_text(v_spec -> v_tbl -> 'visible') x;
    SELECT array_agg(x) INTO v_hidden FROM jsonb_array_elements_text(v_spec -> v_tbl -> 'hidden') x;
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v_tbl);
    -- REVOKE ระดับตารางไม่ลบ column grant ⇒ ถอนรายคอลัมน์ที่ซ่อนด้วย เผื่อเคยให้ไว้
    EXECUTE format('REVOKE SELECT (%s) ON public.%I FROM anon',
                   (SELECT string_agg(quote_ident(x), ', ') FROM unnest(v_hidden) x), v_tbl);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon',
                   (SELECT string_agg(quote_ident(x), ', ') FROM unnest(v_visible) x), v_tbl);
  END LOOP;

  -- ด่านหลังรัน: anon ไม่มีสิทธิ์ทั้งตาราง (รวมที่มาจาก PUBLIC) · อ่านคอลัมน์ที่ซ่อนไม่ได้ · อ่านคอลัมน์สาธารณะได้ครบ
  -- · authenticated ยังมีสิทธิ์ทั้งตาราง
  FOR v_tbl IN SELECT k FROM jsonb_object_keys(v_spec) k ORDER BY k LOOP
    v_rel := to_regclass(format('public.%I', v_tbl));
    IF has_table_privilege('anon', v_rel, 'SELECT') THEN
      RAISE EXCEPTION 'anon ยังมี SELECT ทั้งตาราง %', v_tbl;
    END IF;
    FOR c IN SELECT x FROM jsonb_array_elements_text(v_spec -> v_tbl -> 'hidden') x LOOP
      IF has_column_privilege('anon', v_rel, c, 'SELECT') THEN
        RAISE EXCEPTION 'anon ยังอ่าน %.% ได้', v_tbl, c;
      END IF;
    END LOOP;
    FOR c IN SELECT x FROM jsonb_array_elements_text(v_spec -> v_tbl -> 'visible') x LOOP
      IF NOT has_column_privilege('anon', v_rel, c, 'SELECT') THEN
        RAISE EXCEPTION 'anon อ่านคอลัมน์สาธารณะ %.% ไม่ได้', v_tbl, c;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('authenticated', v_rel, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated เสียสิทธิ์ SELECT % (ไม่ควรเกิด)', v_tbl;
    END IF;
  END LOOP;
END
$sweep$;

NOTIFY pgrst, 'reload schema';

COMMIT;
