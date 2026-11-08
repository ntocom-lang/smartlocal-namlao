-- เมนู "แผนพัฒนาท้องถิ่น" แท็บ "ติดตามผล" ไฟล์ 1/3 — DDL ล้วน (PR R1-A · เจ้าของระบบอนุมัติแผน 6 ไฟล์ 2569-11-08)
--   ต้องรันหลัง 20261109100200 (ชุด R0-A) · ไฟล์ 2/3 (20261110100100) ใส่ FK ฟังก์ชัน trigger policy
--   ⚠️ ตามกติกา "1 ไฟล์ = 1 เฟส" (docs/ai/NOTES.md ข้อ 3): ไฟล์นี้ไม่มี DML/ฟังก์ชันที่อ้างคอลัมน์ที่เพิ่งเพิ่ม
--
-- ทำไมต้องมีตารางผลแยก (ข้อเท็จจริงที่ตรวจในโค้ด 2569-11-08)
--   1) แผนการดำเนินงานที่ประกาศแล้วแช่แข็งทุกแถว (local_op_plan_items_guard) แต่การติดตามผลต้องบันทึก "หลัง" ประกาศ
--      ⇒ เก็บผลในตารางของตัวเอง ไม่แก้แถวแผน (เอกสารที่ประกาศคงเดิมทุกตัวอักษร)
--   2) ฉบับแก้ไขคัดรายการเป็นแถวใหม่ (id ใหม่) — ถ้าผูกผลกับ id แถว ผลที่กองกดไว้จะหลุดเมื่อมีฉบับแก้ไข
--      ⇒ เพิ่ม origin_item_id = "รายการต้นสาย" (แถวแรกสุดที่ถูกคัดต่อๆ กันมา) ผลติดตาม 1 แถวต่อ 1 สาย
--         สาย (lineage) = coalesce(origin_item_id, id) · แถวต้นสายเองมี origin_item_id ว่าง
--      ⇒ เพิ่ม source_op_plan_id = ฉบับต้นทางที่คัดรายการมา (ใช้หาว่ารายการไหนถูกตัดออกในฉบับแก้ไข)
--
-- ตารางใหม่
--   local_op_item_progress  ผลดำเนินการรายรายการ (1 แถวต่อ 1 สาย) — ไม่มีแถว = ยังไม่ได้ดำเนินการ
--                           กำลังดำเนินการ / แล้วเสร็จ (ต้องมีวันที่ — ไตรมาสคิดจากวันที่) / ไม่ได้ดำเนินการ (ต้องมีเหตุผล)
--                           กองผู้รับผิดชอบกดเองครั้งเดียวตอนมีผล (ไม่ใช่รายงานรายเดือน — ห้ามเพิ่มงานเจ้าหน้าที่)
--   local_plan_evaluations  ข้อมูลรายงานติดตามและประเมินผลรายปีงบ (ข้อ 29(3) ฉบับที่ 3/2561 — ปีละครั้งภายใน ธ.ค.)
--                           ยอดเบิกจ่ายรวมทั้งปี "ช่องเดียว" จาก e-LAAS (เจ้าของระบบเลือก 2569-11-08: ไม่เก็บรายโครงการ)
--                           วันประชุม/รายงาน/เสนอ/ประกาศ = ข้อเท็จจริงที่คนทำแล้ว ระบบแค่นับวันให้ · ข้อสังเกต/ข้อเสนอแนะ = คณะกรรมการเขียน
--
--   - ไม่มีแบบรายงานกลางที่ระเบียบบังคับ (ข้อ 29(1) คณะกรรมการกำหนดวิธีเอง) — ช่องชุดนี้คัดจากรายงานจริงของ
--     ทน.นครศรีธรรมราช ปี 2568 (ตัวอย่าง ไม่ใช่ตัวบท) จึงเก็บแค่สิ่งที่ระบบนับไม่ได้เอง ตารางสรุปคำนวณตอนแสดง
--   - created_by / updated_by ไม่ใส่ FK โดยตั้งใจ (แนวเดียวกับ R0-A — บทเรียน #658)
BEGIN;
-- มีงานเขียนค้างถือตารางอยู่ = รอไม่เกิน 5 วินาทีแล้วล้มทั้งก้อน (ไม่ดึงคิวการอ่าน/เขียนเมนูแผนให้ค้างตาม) — รันใหม่ได้
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_n integer;
BEGIN
  IF to_regprocedure('public.local_op_plan_items_guard()') IS NULL
     OR to_regprocedure('public.local_plan_log_event()') IS NULL
     OR to_regclass('public.local_plan_events') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261109100200_local_plan_rls_triggers.sql ก่อน (ไม่พบฟังก์ชัน/ตารางของเมนูแผนพัฒนา)';
  END IF;
  -- ฟังก์ชัน R0 บนฐานจริงต้องตรงกับไฟล์ในรีโป (md5 ของเนื้อฟังก์ชันหลังตัด CR — ไฟล์ที่รันอาจเป็น CRLF หรือ LF)
  -- ไม่ตรง = มีคนแก้ตรงในฐาน/รันฉบับอื่น → หยุดหาสาเหตุก่อน (ไฟล์ 2 เขียนทับ local_plan_log_event และพึ่งพฤติกรรมของ 3 ตัวที่เหลือ)
  -- local_plan_log_event รับ 2 ค่า: ฉบับ R0 (รันครั้งแรก) และฉบับไฟล์ 2 นี้ (รันซ้ำ)
  IF md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_op_plan_items_guard()'::regprocedure), chr(13), '')) <> '280c40ab74f7d7460408ed014c6d87d8'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_op_plans_guard()'::regprocedure), chr(13), '')) <> 'ebfd6ffdd1a7421a6e42420363aa271a'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_op_plan_set_status(uuid,text,date,text,text)'::regprocedure), chr(13), '')) <> '9034ab0179028c3d4401faa7efed29e8'
     OR md5(replace((SELECT prosrc FROM pg_proc WHERE oid = 'public.local_plan_log_event()'::regprocedure), chr(13), ''))
          NOT IN ('8d65faa3b48f3449343b1ac13db11a32', '7bbb1c0328d1aab5b595fd026ccb5be0') THEN
    RAISE EXCEPTION 'Schema drift: ฟังก์ชันของเมนูแผนพัฒนาบนฐานไม่ตรงกับไฟล์ 20261109100200 ในรีโป — ตรวจก่อน';
  END IF;
  -- R0 ต้องจดใน schema_migrations ตรงชื่อไฟล์ ไม่งั้น db push ภายหลังจะยิงไฟล์ R0 ซ้ำ แล้วเขียน log_event ฉบับเก่าทับ (เขียนผลไม่ได้ทั้งเมนู)
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM supabase_migrations.schema_migrations
               WHERE version IN ('20261109100000', '20261109100100', '20261109100200')$q$ INTO v_n;
    IF v_n <> 3 THEN
      RAISE EXCEPTION 'schema_migrations ยังไม่มี 20261109100000/100100/100200 ครบ (พบ % แถว) — จดให้ตรงก่อน', v_n;
    END IF;
  END IF;
  -- ฉบับแก้ไขที่คัดรายการมาก่อนมีสายรายการ จะไม่มีต้นสาย (ผลที่บันทึกกับฉบับหลักไม่ตามไป) → หยุดให้ตัดสินก่อน (ตรวจเฉพาะรอบแรก)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'local_op_plan_items' AND column_name = 'origin_item_id') THEN
    SELECT count(DISTINCT o.id) INTO v_n FROM public.local_op_plans AS o
    WHERE o.kind = 'amendment' AND EXISTS (SELECT 1 FROM public.local_op_plan_items AS i WHERE i.op_plan_id = o.id);
    IF v_n > 0 THEN
      RAISE EXCEPTION 'มีแผนการดำเนินงานฉบับแก้ไขที่มีรายการแล้ว % ฉบับ — ต้องตัดสินเรื่องเติมต้นสายก่อนรัน (ฉบับเพิ่มเติมไม่เกี่ยว)', v_n;
    END IF;
  END IF;
  -- ช่องที่จะเพิ่มต้องยังไม่มีในชนิดอื่น (ADD COLUMN IF NOT EXISTS ข้ามเงียบถ้าชื่อซ้ำแต่ชนิดต่าง)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND ((table_name = 'local_op_plan_items' AND column_name = 'origin_item_id')
                 OR (table_name = 'local_op_plans' AND column_name = 'source_op_plan_id'))
               AND data_type <> 'uuid') THEN
    RAISE EXCEPTION 'Schema drift: origin_item_id / source_op_plan_id มีอยู่แล้วแต่ไม่ใช่ uuid — ตรวจก่อน';
  END IF;
END $guard$;

-- ── สายของรายการ ─────────────────────────────────────────────────────────────────
ALTER TABLE public.local_op_plan_items ADD COLUMN IF NOT EXISTS origin_item_id uuid;   -- FK + กติกา: ไฟล์ 2
ALTER TABLE public.local_op_plans ADD COLUMN IF NOT EXISTS source_op_plan_id uuid;    -- FK + กติกา: ไฟล์ 2
CREATE INDEX IF NOT EXISTS local_op_plan_items_origin_idx ON public.local_op_plan_items (origin_item_id) WHERE origin_item_id IS NOT NULL;

COMMENT ON COLUMN public.local_op_plan_items.origin_item_id IS
  'รายการต้นสาย (แถวแรกสุดที่ถูกคัดต่อกันมาในฉบับแก้ไข) — ว่าง = แถวนี้คือต้นสาย · สาย = coalesce(origin_item_id, id) · ตั้งได้ตอนเพิ่มแถวเท่านั้น';
COMMENT ON COLUMN public.local_op_plans.source_op_plan_id IS
  'ฉบับต้นทางที่คัดรายการมา (ฉบับแก้ไข) — ว่าง = เริ่มจากฉบับว่าง · ตั้งได้ตอนสร้างฉบับเท่านั้น';

-- ── ผลดำเนินการรายรายการ ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_op_item_progress (
  lineage_id       uuid PRIMARY KEY,                     -- = id ของรายการต้นสาย (FK ไฟล์ 2) · ส่ง id แถวไหนในสายมา ระบบแปลงเป็นต้นสายเอง
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ระบบคัดจากรายการ (trigger)
  fiscal_year      integer NOT NULL CHECK (fiscal_year BETWEEN 2500 AND 2700),            -- ระบบคัดจากฉบับ (trigger)
  -- กองของฉบับล่าสุดที่ประกาศแล้วในสายนี้ (ระบบคัดเอง) — policy ใช้ตัดสินว่ากองไหนกดผลได้
  department_id    uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  status           text NOT NULL CHECK (status IN ('in_progress', 'done', 'not_done')),
  started_on       date,                                 -- วันเริ่มจริง (ไม่บังคับ)
  done_on          date,                                 -- วันแล้วเสร็จจริง → ไตรมาสคิดจากวันนี้
  reason           text CHECK (reason IS NULL OR length(reason) <= 2000),               -- เหตุที่ไม่ได้ดำเนินการ
  note             text CHECK (note IS NULL OR length(note) <= 2000),
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_op_item_progress_done_date CHECK ((status = 'done') = (done_on IS NOT NULL)),
  CONSTRAINT local_op_item_progress_not_done_reason CHECK (status <> 'not_done' OR length(btrim(coalesce(reason, ''))) > 0),
  CONSTRAINT local_op_item_progress_date_order CHECK (started_on IS NULL OR done_on IS NULL OR done_on >= started_on)
);
CREATE INDEX IF NOT EXISTS local_op_item_progress_year_idx ON public.local_op_item_progress (municipality_id, fiscal_year);
CREATE INDEX IF NOT EXISTS local_op_item_progress_dept_idx ON public.local_op_item_progress (municipality_id, department_id);

-- ── ข้อมูลรายงานติดตามและประเมินผลรายปี ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_plan_evaluations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id      uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  fiscal_year          integer NOT NULL CHECK (fiscal_year BETWEEN 2500 AND 2700),    -- ปีงบที่ประเมิน
  -- ยอดเบิกจ่ายรวมทั้งปี — ตัวเลขจากระบบบัญชี e-LAAS (ระบบนี้ไม่มีข้อมูลการเงิน) ต้องระบุ "ณ วันที่" เสมอ
  disbursed_total      numeric(15, 2) CHECK (disbursed_total IS NULL OR disbursed_total >= 0),
  disbursed_as_of      date,
  disbursed_source     text CHECK (disbursed_source IS NULL OR length(disbursed_source) <= 300),
  -- ขั้นตอนตามข้อ 29 (ข้อเท็จจริงที่ทำแล้ว — ระบบนับ 15 วัน / 30 วันให้ ไม่ตัดสินเอง)
  committee_met_on     date,                             -- คณะกรรมการติดตามและประเมินผลประชุม
  reported_to_exec_on  date,                             -- คณะกรรมการรายงานผู้บริหารท้องถิ่น
  presented_on         date,                             -- ผู้บริหารเสนอสภาท้องถิ่น + คณะกรรมการพัฒนาท้องถิ่น
  announced_on         date,                             -- ประกาศผลให้ประชาชนทราบ (ภายใน 15 วันนับแต่วันเสนอ)
  announce_ref_no      text CHECK (announce_ref_no IS NULL OR length(announce_ref_no) <= 200),
  observations         text CHECK (observations IS NULL OR length(observations) <= 8000),        -- ข้อสังเกต (คณะกรรมการ)
  recommendations      text CHECK (recommendations IS NULL OR length(recommendations) <= 8000),  -- ข้อเสนอแนะ (คณะกรรมการ)
  note                 text CHECK (note IS NULL OR length(note) <= 4000),
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_plan_evaluations_disbursed_pair CHECK (disbursed_total IS NULL OR disbursed_as_of IS NOT NULL),
  UNIQUE (municipality_id, fiscal_year)
);

-- ── ประวัติ: รับ entity ใหม่ 2 ชนิด ───────────────────────────────────────────────
DO $entity$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.local_plan_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%entity%' AND pg_get_constraintdef(oid) LIKE '%op_item%'
  LOOP
    EXECUTE format('ALTER TABLE public.local_plan_events DROP CONSTRAINT %I', v_name);
  END LOOP;
END $entity$;
ALTER TABLE public.local_plan_events ADD CONSTRAINT local_plan_events_entity_check
  CHECK (entity IN ('dev_plan', 'dev_project', 'dev_project_year', 'op_plan', 'op_item', 'op_progress', 'evaluation'));

-- ปิดไว้ก่อนจนกว่าไฟล์ 2 วางสิทธิ์
ALTER TABLE public.local_op_item_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_plan_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_op_item_progress, public.local_plan_evaluations FROM PUBLIC, anon;

COMMENT ON TABLE public.local_op_item_progress IS
  'ผลดำเนินการตามแผนการดำเนินงาน 1 แถวต่อ 1 สายรายการ — ไม่มีแถว = ยังไม่ได้ดำเนินการ · บันทึกได้เฉพาะสายที่มีฉบับประกาศแล้ว';
COMMENT ON TABLE public.local_plan_evaluations IS
  'ข้อมูลรายงานติดตามและประเมินผลรายปีงบ (ข้อ 29) — ตารางสรุปคำนวณจากแผน+ผลตอนแสดง ไม่เก็บซ้ำ';

COMMIT;
