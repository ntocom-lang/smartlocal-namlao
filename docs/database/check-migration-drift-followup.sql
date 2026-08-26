-- ตรวจซ้ำเฉพาะ 2 แถวที่ได้ present = false รอบแรก เพื่อแยกให้ชัดว่า "ขาดอะไรจริง"
-- (รอบแรกเช็ค 20260826090000 ผิดตาราง — odor_source_options อยู่บน municipalities
--  ไม่ใช่ complaint_categories)
--
-- รันได้ซ้ำ ไม่แก้ไขข้อมูลใดๆ

SELECT 'complaints.extra_data' AS object,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='complaints'
                  AND column_name='extra_data') AS present
UNION ALL SELECT 'municipalities.odor_source_options',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='municipalities'
                  AND column_name='odor_source_options')
UNION ALL SELECT 'complaint_categories.is_active',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='complaint_categories'
                  AND column_name='is_active')
UNION ALL SELECT 'function get_public_personnel_directory()',
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.prokind='f'
                  AND p.proname='get_public_personnel_directory')
UNION ALL SELECT 'function get_personnel_signatories()',
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.prokind='f'
                  AND p.proname='get_personnel_signatories')
UNION ALL SELECT 'table public.staff (ตัวที่ fallback ใช้อยู่)',
       (to_regclass('public.staff') IS NOT NULL);
