-- 20261222100200_waste_fee_settings_table.sql
-- ขั้น 1B ทะเบียนค่าธรรมเนียมขยะ PR1 ไฟล์ 3/4 — ค่าตั้งราย อปท.: ใครยืนยันการคัดแยกได้ (RLS เปิด ยังไม่มี policy จนกว่าไฟล์ 4)
--   เจ้าของระบบสั่ง 2569-11-20:
--     ผู้ยืนยันคัดแยก = ตั้งค่าราย อปท. · ค่าเริ่มต้น admin + officer ของกองที่ถือเรื่อง · มีช่องอ้างอิงคำสั่งมอบหมาย (ไม่บังคับ)
--     ⚠️ อำนาจผู้รับรองการคัดแยกต้องยืนยันกับกฎกระทรวง/ข้อบัญญัติก่อน PR2 ออกยอดจริง (ตัวบทยังไม่ได้ระบุผู้รับรอง)
--     ประวัติ: เก็บชื่อผู้ชำระ ไม่เก็บหมู่/ที่อยู่ (แนวเดียวกับประวัติทะเบียนใบอนุญาต) — ไฟล์ 4 มาสก์ village เพิ่ม
--
--   waste_fee_settings  1 แถว/อปท. · ไม่มีแถว = ค่าเริ่มต้น (admin + officer)
--   waste_fee_events    ขยาย entity ให้รับ 'settings' (การเปลี่ยนผู้มีสิทธิ์ยืนยันต้องย้อนตรวจได้)
--
-- ย้อนกลับ (ไฟล์ 4 ต้องย้อนก่อน): DROP TABLE public.waste_fee_settings;
--   ALTER TABLE public.waste_fee_events DROP CONSTRAINT waste_fee_events_entity_check,
--     ADD CONSTRAINT waste_fee_events_entity_check CHECK (entity IN ('rate', 'account'));  (ต้องลบแถว entity='settings' ก่อน)
--   แล้วลบแถว 20261222100200 ใน supabase_migrations.schema_migrations
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.waste_fee_events') IS NULL OR to_regclass('public.waste_fee_accounts') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261222100000 และ 20261222100100 ก่อน';
  END IF;
  IF to_regclass('public.waste_fee_settings') IS NOT NULL THEN
    RAISE EXCEPTION 'มีตาราง waste_fee_settings อยู่แล้ว — อาจมี session อื่นรันไปก่อน ตรวจ npm run work:active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waste_fee_events_entity_check'
                   AND conrelid = 'public.waste_fee_events'::regclass) THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบ CHECK waste_fee_events_entity_check';
  END IF;
END $guard$;

CREATE TABLE public.waste_fee_settings (
  municipality_id          uuid PRIMARY KEY REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- บทบาทที่ยืนยัน/เลิกการลดค่ากำจัดได้ (officer/staff ต้องสังกัดกองเจ้าของงานขยะด้วย · superadmin ได้เสมอ)
  sorting_confirmer_roles  text[] NOT NULL DEFAULT ARRAY['admin', 'officer']::text[]
                             CHECK (cardinality(sorting_confirmer_roles) BETWEEN 1 AND 3
                                    AND sorting_confirmer_roles <@ ARRAY['admin', 'officer', 'staff']::text[]),
  -- เลขที่/วันที่คำสั่งมอบหมายผู้รับรองการคัดแยก (ไม่บังคับ) — ลงประวัติทุกครั้งที่ยืนยัน
  sorting_delegation_ref   text CHECK (sorting_delegation_ref IS NULL OR length(btrim(sorting_delegation_ref)) BETWEEN 1 AND 300),
  updated_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.waste_fee_events DROP CONSTRAINT waste_fee_events_entity_check;
ALTER TABLE public.waste_fee_events ADD CONSTRAINT waste_fee_events_entity_check
  CHECK (entity IN ('rate', 'account', 'settings'));

ALTER TABLE public.waste_fee_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waste_fee_settings FROM PUBLIC, anon, authenticated;

COMMIT;
