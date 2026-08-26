-- ตรวจว่า migration 40 ไฟล์ที่ supabase_migrations.schema_migrations ยังไม่บันทึกว่า applied
-- นั้น "ผลของมันมีอยู่ใน DB จริงหรือยัง" เพื่อตัดสินว่าตัวไหน migration repair --status applied
-- ได้ปลอดภัย และตัวไหนต้องรันจริงก่อน
--
-- ที่มาของ drift: migration ถูก apply ผ่าน Supabase MCP (apply_migration) ซึ่งบันทึกด้วย
-- timestamp ที่ server สร้างเอง ไม่ตรงกับชื่อไฟล์ local — ผลคือ 40 ไฟล์ถูกมองว่ายังไม่ applied
-- ทั้งที่ส่วนใหญ่รันไปแล้ว และมี 25 รายการฝั่ง remote ที่ไม่มีไฟล์ local คู่กัน
--
-- วิธีอ่านผล:
--   present = true   → ผลอยู่ใน DB แล้ว repair --status applied ได้
--   present = false  → ยังไม่ถูกรันจริง ต้องรันไฟล์นั้นก่อน (อย่า repair)
--   present = null   → ตรวจอัตโนมัติไม่ได้ ดูหมายเหตุท้ายไฟล์
--
-- รันได้ซ้ำ ไม่แก้ไขข้อมูลใดๆ (SELECT ล้วน)

WITH fn AS (
  -- ต้องกรอง prokind = 'f' (ฟังก์ชันธรรมดา) เพราะ pg_get_functiondef() ใช้กับ aggregate
  -- ไม่ได้ (ERROR 42809) — PostGIS ติดตั้งอยู่ใน schema public จึงมี aggregate อย่าง
  -- st_extent ปนอยู่ด้วย และจำกัดรายชื่อไว้เท่าที่ใช้จริง เพื่อไม่ต้องไล่ dump นิยาม
  -- ฟังก์ชันของ PostGIS ทั้งหมดโดยเปล่าประโยชน์
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.proname IN (
      'get_users_with_email', 'data_center_unified_pins', 'get_public_personnel_directory',
      'admin_update_user', 'merge_duplicate_profile', 'submit_citizen_complaint_v2',
      'submit_citizen_complaint_v3', 'complaint_is_open', 'delete_user_by_id',
      'reassign_staff_workload', 'complaint_category_is_adhoc',
      'fleet_set_updated_at', 'fleet_set_updated_meta', 'fleet_override_booking'
    )
),
col AS (
  SELECT table_name, column_name
  FROM information_schema.columns WHERE table_schema = 'public'
),
checks(version, migration, expect, present) AS (
VALUES
  ('20260729171006', '153_positions_personnel',
   'table public.positions',
   (to_regclass('public.positions') IS NOT NULL)),

  ('20260729171553', '154_get_users_with_email_add_position',
   'get_users_with_email() คืน position_name',
   (EXISTS (SELECT 1 FROM fn WHERE proname = 'get_users_with_email' AND def LIKE '%position_name%'))),

  ('20260729182248', '151_data_center_entries',
   'table public.data_center_entries',
   (to_regclass('public.data_center_entries') IS NOT NULL)),

  ('20260729183852', '152_data_center_public_read',
   'policy "dce public read active"',
   (EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename='data_center_entries' AND policyname='dce public read active'))),

  ('20260730145925', '155_data_center_unified_pins_add_description',
   'function data_center_unified_pins()',
   (EXISTS (SELECT 1 FROM fn WHERE proname = 'data_center_unified_pins'))),

  ('20260730154948', '156_data_center_entries_route',
   'data_center_entries.route_points',
   (EXISTS (SELECT 1 FROM col WHERE table_name='data_center_entries' AND column_name='route_points'))),

  ('20260730173506', '159_add_department_id_civil_infra_business',
   'civil_projects.department_id',
   (EXISTS (SELECT 1 FROM col WHERE table_name='civil_projects' AND column_name='department_id'))),

  ('20260816170000', 'unify_personnel_directory',
   'function get_public_personnel_directory()',
   (EXISTS (SELECT 1 FROM fn WHERE proname = 'get_public_personnel_directory'))),

  ('20260816180000', 'fleet_records_edit_audit',
   'fleet_fuel_records.updated_by',
   (EXISTS (SELECT 1 FROM col WHERE table_name='fleet_fuel_records' AND column_name='updated_by'))),

  ('20260816181000', 'fix_duplicate_fleet_updated_meta_trigger',
   'ถูก 20260827130000 เขียนทับแล้ว — ดูหมายเหตุ [A]',
   (NULL::boolean)),

  ('20260816182000', 'reset_false_positive_fleet_edit_marks',
   'DML ล้วน ตรวจไม่ได้ — ดูหมายเหตุ [B]',
   (NULL::boolean)),

  ('20260816190000', 'enable_rls_municipalities_banners',
   'RLS เปิดบน municipalities + banners',
   ((SELECT bool_and(relrowsecurity) FROM pg_class
      WHERE oid IN ('public.municipalities'::regclass, 'public.banners'::regclass)))),

  ('20260816191000', 'fix_municipalities_column_grants_properly',
   'anon มีสิทธิ์ SELECT เฉพาะคอลัมน์ (ไม่ใช่ทั้งตาราง)',
   (EXISTS (SELECT 1 FROM information_schema.column_privileges
             WHERE table_schema='public' AND table_name='municipalities'
               AND grantee='anon' AND privilege_type='SELECT' AND column_name='slug')
    AND NOT EXISTS (SELECT 1 FROM information_schema.table_privileges
             WHERE table_schema='public' AND table_name='municipalities'
               AND grantee='anon' AND privilege_type='SELECT'))),

  ('20260819120000', 'fleet_doc_expiry_cron',
   'extension pg_cron (ดูหมายเหตุ [C] เรื่อง job)',
   (EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'))),

  ('20260819130000', 'admin_update_user_fleet_role',
   'admin_update_user() รองรับ fleet_role',
   (EXISTS (SELECT 1 FROM fn WHERE proname = 'admin_update_user' AND def LIKE '%fleet_role%'))),

  ('20260819140000', 'get_users_with_email_sort_by_name',
   'get_users_with_email() เรียงชื่อไทยก่อน',
   (EXISTS (SELECT 1 FROM fn WHERE proname = 'get_users_with_email' AND def LIKE '%ก-๙%'))),

  ('20260819150000', 'merge_duplicate_profile',
   'function merge_duplicate_profile()',
   (EXISTS (SELECT 1 FROM fn WHERE proname = 'merge_duplicate_profile'))),

  ('20260819160000', 'merge_duplicate_profile_move_identities',
   'merge_duplicate_profile() ย้าย auth.identities ด้วย',
   (EXISTS (SELECT 1 FROM fn WHERE proname = 'merge_duplicate_profile' AND def LIKE '%auth.identities%'))),

  ('20260819170000', 'position_holders',
   'table public.position_holders',
   (to_regclass('public.position_holders') IS NOT NULL)),

  ('20260820220000', 'header_image_mode',
   'municipalities.header_image_mode',
   (EXISTS (SELECT 1 FROM col WHERE table_name='municipalities' AND column_name='header_image_mode'))),

  ('20260820235200', 'category_icon_style',
   'municipalities.category_icon_style',
   (EXISTS (SELECT 1 FROM col WHERE table_name='municipalities' AND column_name='category_icon_style'))),

  ('20260821061600', 'fix_missing_column_grants',
   'anon SELECT ได้บน header_image_mode + category_icon_style',
   ((SELECT count(*) = 2 FROM information_schema.column_privileges
      WHERE table_schema='public' AND table_name='municipalities' AND grantee='anon'
        AND privilege_type='SELECT'
        AND column_name IN ('header_image_mode','category_icon_style')))),

  ('20260821064400', 'smart_city_image',
   'municipalities.smart_city_image_url',
   (EXISTS (SELECT 1 FROM col WHERE table_name='municipalities' AND column_name='smart_city_image_url'))),

  ('20260823090000', 'fix_fleet_role_trigger_overwrite',
   'trigger trg_auto_fleet_role บน profiles',
   (EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
             WHERE c.relname='profiles' AND t.tgname='trg_auto_fleet_role' AND NOT t.tgisinternal))),

  ('20260823110000', 'remove_fleet_equipment_asset_kind',
   'ถูก 20260823113000 เขียนทับแล้ว — ดูหมายเหตุ [D]',
   (NULL::boolean)),

  ('20260823113000', 'fleet_vehicle_only',
   'constraint asset_kind = ''vehicle'' (ไม่ใช่ IN (...))',
   (EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname='fleet_vehicles_asset_kind_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%engine%'))),

  ('20260824100000', 'add_fax_and_internal_extensions',
   'municipalities.fax + internal_extensions',
   ((SELECT count(*) = 2 FROM col WHERE table_name='municipalities'
       AND column_name IN ('fax','internal_extensions')))),

  ('20260824120000', 'add_complaint_issue_type',
   'complaints.issue_type + submit_citizen_complaint_v2()',
   (EXISTS (SELECT 1 FROM col WHERE table_name='complaints' AND column_name='issue_type')
    AND EXISTS (SELECT 1 FROM fn WHERE proname='submit_citizen_complaint_v2'))),

  -- odor_source_options อยู่บน municipalities ไม่ใช่ complaint_categories (เคยเช็คผิดตารางมาก่อน)
  ('20260826090000', 'add_odor_category_fields',
   'complaints.extra_data + municipalities.odor_source_options + complaint_categories.is_active',
   (EXISTS (SELECT 1 FROM col WHERE table_name='complaints' AND column_name='extra_data')
    AND EXISTS (SELECT 1 FROM col WHERE table_name='municipalities' AND column_name='odor_source_options')
    AND EXISTS (SELECT 1 FROM col WHERE table_name='complaint_categories' AND column_name='is_active'))),

  ('20260826091000', 'add_complaint_submit_v3',
   'function submit_citizen_complaint_v3()',
   (EXISTS (SELECT 1 FROM fn WHERE proname='submit_citizen_complaint_v3'))),

  ('20260827090000', 'add_complaint_category_is_adhoc',
   'complaint_categories.is_adhoc',
   (EXISTS (SELECT 1 FROM col WHERE table_name='complaint_categories' AND column_name='is_adhoc'))),

  ('20260827100000', 'guard_delete_user_with_open_work',
   'complaint_is_open() + delete_user_by_id() มี guard',
   (EXISTS (SELECT 1 FROM fn WHERE proname='complaint_is_open')
    AND EXISTS (SELECT 1 FROM fn WHERE proname='delete_user_by_id' AND def LIKE '%complaint_is_open%'))),

  ('20260827110000', 'reassign_staff_workload',
   'function reassign_staff_workload()',
   (EXISTS (SELECT 1 FROM fn WHERE proname='reassign_staff_workload'))),

  ('20260827120000', 'restrict_odor_adhoc_visibility',
   'function complaint_category_is_adhoc()',
   (EXISTS (SELECT 1 FROM fn WHERE proname='complaint_category_is_adhoc'))),

  ('20260827130000', 'fix_fleet_shared_trigger_updated_by',
   'fleet_set_updated_meta() มี + fleet_set_updated_at() ไม่มี updated_by',
   (EXISTS (SELECT 1 FROM fn WHERE proname='fleet_set_updated_meta')
    AND EXISTS (SELECT 1 FROM fn WHERE proname='fleet_set_updated_at' AND def NOT LIKE '%updated_by%'))),

  ('20260828090000', 'data_center_group_icons',
   'table public.data_center_group_icons',
   (to_regclass('public.data_center_group_icons') IS NOT NULL)),

  ('20260828100000', 'data_center_category_icons',
   'data_center_group_icons.category',
   (EXISTS (SELECT 1 FROM col WHERE table_name='data_center_group_icons' AND column_name='category'))),

  ('20260828110000', 'odor_adhoc_namlao_only',
   'หมวด odor ปิดในทุก อปท. ยกเว้น namlao',
   (NOT EXISTS (SELECT 1 FROM public.complaint_categories cc
                  JOIN public.municipalities m ON m.id = cc.municipality_id
                 WHERE cc.value='odor' AND m.slug <> 'namlao' AND cc.is_active))),

  ('20260828120000', 'enable_realtime_complaints',
   'complaints อยู่ใน publication supabase_realtime',
   (EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='complaints'))),

  ('20260828130000', 'fleet_trip_overlap_guard_and_atomic_override',
   'trigger trg_fleet_trips_guard_overlap + fleet_override_booking()',
   (EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
             WHERE c.relname='fleet_trips' AND t.tgname='trg_fleet_trips_guard_overlap' AND NOT t.tgisinternal)
    AND EXISTS (SELECT 1 FROM fn WHERE proname='fleet_override_booking')))
)
SELECT
  version,
  migration,
  expect,
  present,
  CASE
    WHEN present IS NULL  THEN 'ตรวจมือ'
    WHEN present          THEN 'repair applied ได้'
    ELSE                       'ยังไม่รัน — ต้องรันไฟล์ก่อน'
  END AS action
FROM checks
ORDER BY version;

-- ── หมายเหตุสำหรับแถวที่ present = null ────────────────────────────────────
--
-- [A] 20260816181000_fix_duplicate_fleet_updated_meta_trigger
--     ทำให้ fleet_set_updated_at() เซ็ต updated_by ซึ่งเป็นต้นเหตุของ error
--     'record "new" has no field "updated_by"' ที่เจอจริงบนหน้าจอเมื่อ 26 ส.ค.
--     = หลักฐานว่ามันเคยรันจริงบน production แล้ว ต่อมา 20260827130000 เขียนทับไป
--     → repair --status applied ได้ (มันรันไปแล้ว แค่ถูก supersede)
--     ห้ามรันซ้ำเด็ดขาด เพราะจะพาบั๊กเดิมกลับมา
--
-- [B] 20260816182000_reset_false_positive_fleet_edit_marks
--     เป็น UPDATE ล้วน (fleet_fuel_records/fleet_maintenance SET updated_at = created_at)
--     ตรวจย้อนหลังไม่ได้ว่ารันไปหรือยัง และ "รันซ้ำ" จะเขียนทับร่องรอยการแก้ไข
--     ที่เกิดขึ้นหลังจากนั้น ซึ่งเป็นข้อมูลที่ สตง. ใช้ตรวจ
--     → repair --status applied ไปเลย (กันไม่ให้ db push ไปรันซ้ำ) อย่ารันไฟล์นี้อีก
--     ถ้าอยากรู้สถานะจริง ดูว่ามีแถวที่ updated_by IS NULL AND updated_at <> created_at ไหม:
--       SELECT count(*) FROM public.fleet_fuel_records
--        WHERE updated_by IS NULL AND updated_at IS DISTINCT FROM created_at;
--     ถ้าเป็น 0 แปลว่าเคยรันแล้ว (หรือยังไม่มีใครแก้ไขบันทึกเลย)
--
-- [C] 20260819120000_fleet_doc_expiry_cron
--     แถวนี้เช็คแค่ว่า extension pg_cron ติดตั้งแล้ว ไม่ได้เช็คว่า job ถูกตั้งจริง
--     ตรวจ job แยกด้วย (ต้องมีสิทธิ์อ่าน schema cron):
--       SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'fleet-doc-expiry-daily';
--
-- [D] 20260823110000_remove_fleet_equipment_asset_kind
--     ตั้ง constraint เป็น asset_kind IN ('vehicle','engine') แล้วถูก 20260823113000
--     เปลี่ยนเป็น = 'vehicle' ทับในวันเดียวกัน ตรวจแยกจากกันไม่ได้
--     → ถ้าแถว 20260823113000 เป็น true ให้ repair ทั้งคู่ (113000 ทับ 110000 อยู่แล้ว)
