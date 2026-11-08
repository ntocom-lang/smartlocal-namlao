-- วงจรโครงการก่อสร้าง (ตั้งงบ → ปิดโครงการ) ไฟล์ 1/3 — เพิ่มคอลัมน์ล้วน (เจ้าของระบบอนุมัติ 2569-11-07/08 "เริ่ม PR-A")
--   ไฟล์ 2/3 (20261108100100) สร้างตารางใหม่ 6 ตาราง · ไฟล์ 3/3 (20261108100200) เติมค่า ฟังก์ชัน trigger policy
-- ⚠️ ตามกติกา "1 ไฟล์ = 1 เฟส" (docs/ai/NOTES.md ข้อ 3): ไม่มี DML/ฟังก์ชันใดอ้างคอลัมน์ที่เพิ่งเพิ่ม
--    (มีแค่ COMMENT ON COLUMN ซึ่งเป็น utility statement — แบบเดียวกับที่ #647 ใช้แล้วผ่านบนฐานจริง)
--
-- ออกแบบ
--   - "ขั้นของโครงการ" (stage) 12 ค่า แทนสถานะเดิม 6 ค่า แต่ "ไม่ลบ status" — หมุดศูนย์ข้อมูล (data_center_unified_pins)
--     หน้าช่าง และเมนูเดิมยังอ่าน status อยู่ ไฟล์ 3 ทำ trigger ให้ status ตาม stage เสมอ
--       เส้นหลัก 9 ขั้น : budgeted ตั้งงบ · designing ออกแบบ/ราคากลาง · procuring จัดซื้อจัดจ้าง · contracted ลงนามสัญญา ·
--                        started เริ่มงาน · construction ก่อสร้าง · final_inspection ตรวจรับงวดสุดท้าย · warranty ประกันผลงาน · closed ปิดโครงการ
--       นอกเส้นหลัก   : suspended ระงับชั่วคราว (จำขั้นเดิมใน stage_before_hold) · cancelled ยกเลิกก่อนทำสัญญา ·
--                        terminated บอกเลิกสัญญา (พ.ร.บ.จัดซื้อฯ ม.103 — แยกจาก cancelled เพราะผลทางสัญญาต่างกัน)
--   - stage เพิ่มแบบยอมให้ว่างก่อน (แถวเดิมยังไม่มีค่า) ไฟล์ 3 เติมค่าจาก status แล้วค่อย SET NOT NULL
--   - registry_ref = ช่องผูก "ทะเบียนโครงการกลาง" (เจ้าของอนุมัติแนวทาง 2569-11-07) ยังไม่ใส่ FK โดยตั้งใจ
--     เพราะตารางทะเบียนกลางรอไฟล์จากนักวิเคราะห์ (หนังสือ สถ. แนวทางแผน 2571–2575) — ใส่ FK ตอนสร้างตารางจริง
--   - กฎกำหนดเวลา/เงื่อนไขตามระเบียบอยู่ในโค้ดที่เดียว (src/lib/constructionLifecycle.js — PR-B) ฐานข้อมูลเก็บแค่ข้อเท็จจริง
--   - ไม่มีคอลัมน์ชื่อบุคคลใน civil_projects (ชื่อกรรมการ/ผู้ควบคุมงานอยู่ civil_project_people เท่านั้น — PDPA)
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.civil_projects') IS NULL
     OR to_regclass('public.civil_project_contracts') IS NULL
     OR to_regclass('public.civil_project_people') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261106100000_civil_reports_tables.sql ก่อน (ไม่พบ civil_projects / civil_project_contracts / civil_project_people)';
  END IF;
  IF to_regprocedure('public.civil_is_listed_on_project(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261107100000_civil_projects_restrict_select.sql (#649) ก่อน — ไม่พบ civil_is_listed_on_project';
  END IF;
  -- status เดิมต้องเป็น 6 ค่าตาม 046 (trigger ในไฟล์ 3 แปลง stage → status ด้วยค่าชุดนี้ ถ้าฐานจริงเปลี่ยนไปแล้วต้องหยุดดูก่อน)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.civil_projects'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
      AND pg_get_constraintdef(oid) LIKE '%planned%' AND pg_get_constraintdef(oid) LIKE '%approved%'
      AND pg_get_constraintdef(oid) LIKE '%in_progress%' AND pg_get_constraintdef(oid) LIKE '%completed%'
      AND pg_get_constraintdef(oid) LIKE '%cancelled%' AND pg_get_constraintdef(oid) LIKE '%suspended%'
  ) THEN
    RAISE EXCEPTION 'Schema drift: CHECK ของ civil_projects.status ไม่ใช่ 6 ค่าเดิม (planned/approved/in_progress/completed/cancelled/suspended) — ตรวจก่อน';
  END IF;
  -- ถ้ามีคอลัมน์ชื่อซ้ำอยู่แล้วแต่ชนิดต่าง ADD COLUMN IF NOT EXISTS จะข้ามเงียบ → พังดังๆ แทน
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'civil_projects'
      AND ((column_name IN ('stage', 'stage_before_hold', 'work_group') AND data_type <> 'text')
        OR (column_name = 'registry_ref' AND data_type <> 'uuid')
        OR (column_name = 'operator_eval_required' AND data_type <> 'boolean'))
  ) THEN
    RAISE EXCEPTION 'Schema drift: civil_projects มีคอลัมน์ชื่อเดียวกันอยู่แล้วแต่ชนิดไม่ตรง — ตรวจก่อน';
  END IF;
END $guard$;

-- ── 1) civil_projects: ขั้นของโครงการ + ช่องผูกทะเบียนกลาง ─────────────────────
ALTER TABLE public.civil_projects
  ADD COLUMN IF NOT EXISTS stage text
    CONSTRAINT civil_projects_stage_check CHECK (stage IS NULL OR stage IN (
      'budgeted', 'designing', 'procuring', 'contracted', 'started', 'construction',
      'final_inspection', 'warranty', 'closed', 'suspended', 'cancelled', 'terminated')),
  ADD COLUMN IF NOT EXISTS stage_before_hold text
    CONSTRAINT civil_projects_stage_before_hold_check CHECK (stage_before_hold IS NULL OR stage_before_hold IN (
      'budgeted', 'designing', 'procuring', 'contracted', 'started', 'construction',
      'final_inspection', 'warranty')),
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz,
  -- กลุ่มงานตามหลักเกณฑ์ราคากลาง 2569 (อาคาร / ทาง-สะพาน-ท่อเหลี่ยม / ชลประทาน) ใช้เลือกแบบสรุปราคากลาง
  ADD COLUMN IF NOT EXISTS work_group text
    CONSTRAINT civil_projects_work_group_check CHECK (work_group IS NULL OR work_group IN ('building', 'road_bridge', 'irrigation')),
  -- เข้าเกณฑ์ประเมินผู้ประกอบการงานก่อสร้าง (ระเบียบ กค. ฉบับที่ 3 พ.ศ. 2569 หมวด 7) — คนตัดสินแล้วติ๊ก ระบบไม่ตัดสินเอง
  ADD COLUMN IF NOT EXISTS operator_eval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registry_ref uuid;

-- ── 2) civil_project_contracts: ข้อเท็จจริงตามสัญญา (กรอกตามสัญญาที่ลงนามแล้ว ระบบไม่ตั้งค่าเริ่มต้นแทน) ──
ALTER TABLE public.civil_project_contracts
  ADD COLUMN IF NOT EXISTS price_kind text
    CONSTRAINT civil_contracts_price_kind_check CHECK (price_kind IS NULL OR price_kind IN ('lump_sum', 'unit_price')),
  -- ชนิดหลักประกัน: รายการตามระเบียบ กค. ข้อ 167 "ต้องยืนยันกับฉบับปัจจุบัน" — 'other' + guarantee_ref รองรับชนิดที่ไม่อยู่ในลิสต์
  --   'none' = สัญญานี้ไม่มีหลักประกัน (ไฟล์ 3 ใช้ตัดสินว่าปิดโครงการได้โดยไม่ต้องมีจุดตรวจ "คืนหลักประกัน")
  ADD COLUMN IF NOT EXISTS guarantee_type text
    CONSTRAINT civil_contracts_guarantee_type_check CHECK (guarantee_type IS NULL OR guarantee_type IN (
      'cash', 'cheque_draft', 'bank_guarantee', 'e_guarantee', 'gov_bond', 'other', 'none')),
  ADD COLUMN IF NOT EXISTS guarantee_amount numeric(15, 2)
    CONSTRAINT civil_contracts_guarantee_amount_check CHECK (guarantee_amount IS NULL OR guarantee_amount >= 0),
  ADD COLUMN IF NOT EXISTS guarantee_ref text,
  ADD COLUMN IF NOT EXISTS guarantee_expires_on date,
  ADD COLUMN IF NOT EXISTS advance_pct numeric(5, 2)
    CONSTRAINT civil_contracts_advance_pct_check CHECK (advance_pct IS NULL OR (advance_pct >= 0 AND advance_pct <= 100)),
  ADD COLUMN IF NOT EXISTS advance_amount numeric(15, 2)
    CONSTRAINT civil_contracts_advance_amount_check CHECK (advance_amount IS NULL OR advance_amount >= 0),
  ADD COLUMN IF NOT EXISTS retention_pct numeric(5, 2)
    CONSTRAINT civil_contracts_retention_pct_check CHECK (retention_pct IS NULL OR (retention_pct >= 0 AND retention_pct <= 100)),
  ADD COLUMN IF NOT EXISTS supervision_fee_per_day numeric(12, 2)
    CONSTRAINT civil_contracts_supervision_fee_check CHECK (supervision_fee_per_day IS NULL OR supervision_fee_per_day >= 0),
  -- ระยะประกันความชำรุดบกพร่อง: ไม่มีค่าเริ่มต้นโดยตั้งใจ (ไม่พบหนังสือสั่งการปัจจุบันที่ยืนยันได้) กรอกตามสัญญา
  ADD COLUMN IF NOT EXISTS warranty_months integer
    CONSTRAINT civil_contracts_warranty_months_check CHECK (warranty_months IS NULL OR (warranty_months >= 0 AND warranty_months <= 600)),
  ADD COLUMN IF NOT EXISTS warranty_starts_on date,
  ADD COLUMN IF NOT EXISTS warranty_ends_on date,
  -- หนังสือแจ้งให้เริ่มทำงาน (ออกจาก e-GP — บันทึกเลขที่/วันที่) + กำหนดเริ่ม/แล้วเสร็จนับจากหนังสือ (แบบสัญญาจ้างก่อสร้าง)
  ADD COLUMN IF NOT EXISTS notice_to_proceed_no text,
  ADD COLUMN IF NOT EXISTS notice_to_proceed_date date,
  ADD COLUMN IF NOT EXISTS start_within_days integer
    CONSTRAINT civil_contracts_start_within_check CHECK (start_within_days IS NULL OR start_within_days >= 0),
  ADD COLUMN IF NOT EXISTS finish_within_days integer
    CONSTRAINT civil_contracts_finish_within_check CHECK (finish_within_days IS NULL OR finish_within_days > 0);

-- ── 3) civil_project_people: เพิ่มกลุ่ม "คณะกรรมการกำหนดราคากลาง" ──────────────────
-- เดิม 'committee' = คณะกรรมการตรวจรับพัสดุ (คงความหมายเดิม ไม่เปลี่ยนชื่อค่า — ข้อมูลจริงใช้อยู่)
-- CHECK เดิมตั้งชื่ออัตโนมัติ (ไฟล์ 20261106100000 ไม่ได้ตั้งชื่อ) → หาจากนิยามแทนการเดาชื่อ แล้วสร้างใหม่แบบมีชื่อ
DO $people$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.civil_project_people'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%grp%'
      AND conname NOT IN ('civil_people_grp_check', 'civil_people_profile_grp_check')
  LOOP
    EXECUTE format('ALTER TABLE public.civil_project_people DROP CONSTRAINT %I', v_con.conname);
  END LOOP;
END $people$;

ALTER TABLE public.civil_project_people DROP CONSTRAINT IF EXISTS civil_people_grp_check;
ALTER TABLE public.civil_project_people DROP CONSTRAINT IF EXISTS civil_people_profile_grp_check;
ALTER TABLE public.civil_project_people
  ADD CONSTRAINT civil_people_grp_check
    CHECK (grp IN ('committee', 'supervisor', 'contractor_rep', 'price_committee')),
  ADD CONSTRAINT civil_people_profile_grp_check
    CHECK (profile_id IS NULL OR grp IN ('committee', 'supervisor', 'price_committee'));   -- ตัวแทนผู้รับจ้างไม่มีบัญชีเจ้าหน้าที่

COMMENT ON COLUMN public.civil_projects.stage IS 'ขั้นของโครงการ 12 ค่า (เปลี่ยนผ่าน civil_set_project_stage เท่านั้น) — status เดิมตามค่านี้โดย trigger';
COMMENT ON COLUMN public.civil_projects.registry_ref IS 'ผูกทะเบียนโครงการกลาง (ตารางยังไม่สร้าง รอไฟล์จากนักวิเคราะห์) — ยังไม่มี FK โดยตั้งใจ';
COMMENT ON COLUMN public.civil_project_people.grp IS 'committee = คณะกรรมการตรวจรับพัสดุ · price_committee = คณะกรรมการกำหนดราคากลาง · supervisor = ผู้ควบคุมงาน · contractor_rep = ผู้แทนผู้รับจ้าง';

-- ด่านตรวจท้ายไฟล์: CHECK ของ grp ต้องเหลือชุดใหม่ชุดเดียว (ถ้าตัวเก่าค้าง ค่า price_committee จะถูกปฏิเสธเงียบๆ ตอนใช้งาน)
DO $verify$
BEGIN
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'public.civil_project_people'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%grp%') <> 2 THEN
    RAISE EXCEPTION 'civil_project_people ต้องมี CHECK ที่อ้าง grp 2 ตัวพอดี (civil_people_grp_check, civil_people_profile_grp_check)';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'civil_projects'
        AND column_name IN ('stage', 'stage_before_hold', 'stage_changed_at', 'work_group', 'operator_eval_required', 'registry_ref')) <> 6 THEN
    RAISE EXCEPTION 'civil_projects ได้คอลัมน์ใหม่ไม่ครบ 6 คอลัมน์';
  END IF;
END $verify$;

COMMIT;
