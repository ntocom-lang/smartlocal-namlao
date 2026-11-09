-- เมนู "แผนพัฒนาท้องถิ่น" แท็บ "คลัง-แหล่งงบ" ไฟล์ 1/2 — DDL ล้วน (PR K-A · เจ้าของระบบอนุมัติแผน 4 ไฟล์ 2569-11-09)
--   ต้องรันหลังชุด R1-A (20261110100000/100100) · ไฟล์ 2/2 (20261112100100) ใส่ FK ฟังก์ชัน trigger policy
--   ⚠️ ตามกติกา "1 ไฟล์ = 1 เฟส" (docs/ai/NOTES.md ข้อ 3): ไฟล์นี้ไม่มี DML/ฟังก์ชันที่อ้างตารางที่เพิ่งสร้าง
--
-- ที่มา: นักวิเคราะห์ฯ ยื่น Thai Water Plan (TWP) ปี 71 ไม่ทัน เพราะความพร้อมของโครงการ (ที่ดิน/แบบ/ประมาณราคา) มาช้า
--   ⇒ คลังโครงการ = เตรียมความพร้อมไว้ก่อนรอบยื่นเปิด + นับถอยหลังจากวันปิดรอบให้แต่ละกองเห็นเอง
--
-- เจ้าของระบบตัดสิน 2569-11-09 ("ตามแนะนำ")
--   D1 ความพร้อม 4 ด้านผูกกับ "โครงการ" ไม่ใช่ผูกกับการยื่นแต่ละแหล่ง — ที่ดิน/แบบ/ประมาณราคาชุดเดียวใช้ยื่นได้ทุกแหล่ง กองช่างกรอกครั้งเดียว
--   D2 รอบยื่นปีถัดไป "คาดการณ์" จากกฎรอบปกติตอนเปิดดู (คำนวณในหน้าจอ ไม่เก็บแถว ไม่มี cron)
--      ตารางรอบเก็บเฉพาะรอบที่ยืนยันแล้ว ต้องมีเลขที่ + วันที่หนังสือแจ้งเสมอ (ระบบไม่เดาวันจริงแทนหนังสือ)
--   D3 แม่แบบ TWP อยู่ในโค้ด (ชื่อแหล่ง + 4 ด้าน ไม่มีวันที่) นักวิเคราะห์กดเพิ่มเอง — ไม่ใส่ข้อมูลตั้งต้นลงทุก อปท.
--   ขอบเขตที่ตัดออก (2569-11-08): ราคาต่อหน่วย · แม่แบบโซลาร์ · ลุ่มน้ำ · หลักฐานสภาพปัญหาจากคำร้อง
--
-- ตารางใหม่
--   local_funding_sources       แหล่งงบภายนอก ต่อ อปท. เก็บเป็น "กฎรอบปกติ" (เดือน/วันที่มักเปิด–ปิด · ขอสำหรับปีงบ +n · ระยะเผื่อ)
--   local_funding_rounds        รอบยื่นที่ยืนยันจากหนังสือแจ้งแล้ว (1 แถวต่อแหล่ง × ปีงบที่ขอ)
--   local_bank_candidates       โครงการ × แหล่ง × ปีงบที่ขอ + สถานะ เตรียม/ยื่นแล้ว/ได้รับ/ไม่ได้รับ/ถอน
--                               "ได้รับ/ไม่ได้รับ" = ข้อเท็จจริงจากหนังสือแจ้งผล คนบันทึกพร้อมเลขที่ ระบบไม่ตัดสินเอง
--   local_project_readiness     ความพร้อม 4 ด้านต่อโครงการ (ศึกษา / ที่ดิน / แบบรูปรายการ / ประมาณราคา) ระดับ 1–4 ตามคู่มือ TWP
--                               1 ไม่ต้องทำ · 2 ยังไม่ทำแต่ต้องทำ · 3 ระหว่างทำ · 4 เสร็จ (ต้องแนบ PDF)
--                               แต่ละด้านมีกองเจ้าของงาน — กองนั้นแก้ระดับ/ไฟล์/หมายเหตุของด้านตัวเองได้ (ไฟล์ 2)
--   local_bank_project_details  ช่องตามแบบฟอร์ม 001 ของ TWP ที่ทะเบียนยังไม่มี (ลักษณะงาน · ประเภทงบ · ช่วงเวลา · พิกัด · หมู่ที่ ·
--                               แผนแม่บทน้ำ · ตัวชี้วัด) แยกตาราง 1:1 ไม่เพิ่มคอลัมน์ใน local_dev_plan_projects
--                               เพราะ local_dev_plan_projects_guard ล็อกโครงการในแผนที่ประกาศแล้ว (แก้ได้แค่กอง/หมายเหตุ)
--                               แต่ข้อมูลเตรียมยื่นต้องแก้ได้ตลอด และช่องใหม่จะติดด่าน "แก้ช่อง … ไม่ได้" ทันที
--
--   - ไฟล์นี้มี FK ชี้เฉพาะตารางเดิม (municipalities / departments) — FK ไปตารางแผน/ตารางใหม่ด้วยกันใส่ไฟล์ 2
--   - created_by / updated_by ไม่ใส่ FK โดยตั้งใจ (แนวเดียวกับ R0-A — บทเรียน #658)
--   - แบบฟอร์ม 001 คัดจากคู่มือ TWP ของ สทนช.ภาค 4 (onwr4.onwr.go.th) ช่อง 4-A แผนแม่บทน้ำยังไม่เห็นรายการตัวเลือกจริง
--     จึงเก็บเป็นข้อความอิสระ · ไม่มีคอลัมน์ข้อมูลส่วนบุคคล (หมู่ที่ = ระดับหมู่บ้าน ไม่ใช่ที่อยู่บุคคล)
--   - ⚠️ PDPA: PDF หลักฐานด้านที่ดิน (หนังสือยินยอม/สำเนาเอกสารสิทธิ์) อาจมีข้อมูลเจ้าของที่ดิน — เปิดได้เฉพาะเจ้าหน้าที่ภายใน
--     ผ่าน drive-file (ขอบเขตเดิมของระบบ) · file_name / note / reason / kpi เป็นข้อความอิสระ หน้าจอต้องเตือนห้ามใส่ชื่อ/เลขบัตร
BEGIN;
-- มีงานเขียนค้างถือตาราง = รอไม่เกิน 5 วินาทีแล้วล้มทั้งก้อน (รันใหม่ได้)
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_n integer;
BEGIN
  IF to_regclass('public.local_op_item_progress') IS NULL
     OR to_regprocedure('public.local_op_item_progress_guard()') IS NULL
     OR to_regprocedure('public.local_plan_log_event()') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261110100100_local_plan_progress_rls.sql ก่อน (ไม่พบตาราง/ฟังก์ชันของแท็บติดตามผล)';
  END IF;
  -- ชุด R0-A + R1-A ต้องจดใน schema_migrations ตรงชื่อไฟล์ ไม่งั้น db push ภายหลังจะยิงไฟล์เก่าซ้ำ
  -- แล้วเขียน local_plan_log_event ฉบับเก่าทับ → ทุกการเขียนตารางคลังพัง (entity ว่าง ชน NOT NULL)
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM supabase_migrations.schema_migrations
               WHERE version IN ('20261109100000', '20261109100100', '20261109100200', '20261110100000', '20261110100100')$q$ INTO v_n;
    IF v_n <> 5 THEN
      RAISE EXCEPTION 'schema_migrations ยังไม่มีชุด R0-A + R1-A ครบ 5 ไฟล์ (พบ % แถว) — จดให้ตรงก่อน', v_n;
    END IF;
  END IF;
  -- ชื่อตารางใหม่ต้องยังไม่ถูกใช้ (CREATE TABLE IF NOT EXISTS ข้ามเงียบถ้ามีตารางชื่อเดียวกันแต่โครงต่าง)
  IF to_regclass('public.local_funding_sources') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                       AND table_name = 'local_funding_sources' AND column_name = 'buffer_days') THEN
    RAISE EXCEPTION 'Schema drift: มีตาราง local_funding_sources อยู่แล้วแต่โครงไม่ตรงไฟล์นี้ — ตรวจก่อน';
  END IF;
  IF to_regclass('public.local_project_readiness') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                       AND table_name = 'local_project_readiness' AND column_name = 'aspect') THEN
    RAISE EXCEPTION 'Schema drift: มีตาราง local_project_readiness อยู่แล้วแต่โครงไม่ตรงไฟล์นี้ — ตรวจก่อน';
  END IF;
END $guard$;

-- ── 1) แหล่งงบ (กฎรอบปกติ) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_funding_sources (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),       -- เช่น แผนงานด้านทรัพยากรน้ำ (Thai Water Plan)
  agency              text CHECK (agency IS NULL OR length(agency) <= 300),              -- หน่วยงานเจ้าของแหล่ง เช่น สทนช.
  -- แม่แบบในโค้ดที่ใช้สร้างแถวนี้ (เช่น 'twp' → หน้าจอแสดงการ์ดแบบฟอร์ม 001) · ว่าง = แหล่งที่นักวิเคราะห์ตั้งเอง
  template_key        text CHECK (template_key IS NULL OR template_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- ด้านความพร้อมที่แหล่งนี้ต้องใช้ (ว่าง = ไม่บังคับด้านใด) · ชื่อด้านตรงกับ local_project_readiness.aspect
  required_aspects    text[] NOT NULL DEFAULT '{}'::text[]
                        CHECK (required_aspects <@ ARRAY['study', 'land', 'design', 'estimate']::text[]),
  -- กฎรอบปกติ: วันเปิด/ปิดที่ "มักจะเป็น" (เดือนปฏิทิน 1–12) — ใช้คาดการณ์รอบที่ยังไม่มีหนังสือแจ้งเท่านั้น
  usual_open_month    smallint CHECK (usual_open_month IS NULL OR usual_open_month BETWEEN 1 AND 12),
  usual_open_day      smallint CHECK (usual_open_day IS NULL OR usual_open_day BETWEEN 1 AND 31),
  usual_close_month   smallint CHECK (usual_close_month IS NULL OR usual_close_month BETWEEN 1 AND 12),
  usual_close_day     smallint CHECK (usual_close_day IS NULL OR usual_close_day BETWEEN 1 AND 31),
  -- ปีงบที่ขอ = ปี พ.ศ. ของวันปิดรอบ + n (TWP: ปิด 30 ก.ย. 2569 ขอปีงบ 2571 → n = 2)
  target_year_offset  smallint NOT NULL DEFAULT 1 CHECK (target_year_offset BETWEEN 0 AND 3),
  -- ความพร้อมต้องเสร็จก่อนวันปิดรอบกี่วัน (เผื่อรวบรวม/ตรวจ/ขอลงนาม) — วันต้องเสร็จ = วันปิด − ระยะเผื่อ
  buffer_days         smallint NOT NULL DEFAULT 14 CHECK (buffer_days BETWEEN 0 AND 180),
  source_url          text CHECK (source_url IS NULL OR (length(source_url) <= 1000 AND source_url ~* '^https://')),
  is_active           boolean NOT NULL DEFAULT true,         -- เลิกใช้แหล่งนี้ = ปิด (ลบไม่ได้ถ้ามีรอบ/โครงการอ้างอยู่)
  note                text CHECK (note IS NULL OR length(note) <= 4000),
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_funding_sources_open_pair CHECK ((usual_open_month IS NULL) = (usual_open_day IS NULL)),
  CONSTRAINT local_funding_sources_close_pair CHECK ((usual_close_month IS NULL) = (usual_close_day IS NULL)),
  -- วันที่ต้องมีจริงในเดือนนั้น (ก.พ. ให้ถึง 29 — หน้าจอเลื่อนเป็นวันสุดท้ายของเดือนในปีที่ไม่มี 29 ก.พ.)
  CONSTRAINT local_funding_sources_open_day_valid CHECK (usual_open_day IS NULL OR usual_open_day <=
    CASE WHEN usual_open_month = 2 THEN 29 WHEN usual_open_month IN (4, 6, 9, 11) THEN 30 ELSE 31 END),
  CONSTRAINT local_funding_sources_close_day_valid CHECK (usual_close_day IS NULL OR usual_close_day <=
    CASE WHEN usual_close_month = 2 THEN 29 WHEN usual_close_month IN (4, 6, 9, 11) THEN 30 ELSE 31 END),
  UNIQUE (municipality_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS local_funding_sources_one_template
  ON public.local_funding_sources (municipality_id, template_key) WHERE template_key IS NOT NULL;

-- ── 2) รอบยื่นที่ยืนยันแล้ว ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_funding_rounds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ระบบคัดจากแหล่ง (trigger)
  source_id           uuid NOT NULL,                          -- FK → local_funding_sources (ไฟล์ 2) · ย้ายแหล่งไม่ได้
  target_fiscal_year  integer NOT NULL CHECK (target_fiscal_year BETWEEN 2500 AND 2700),        -- ปีงบที่ขอ (พ.ศ.)
  opens_on            date,                                   -- วันเปิดรับ (บางหนังสือไม่ระบุ)
  closes_on           date NOT NULL,                          -- วันสุดท้ายที่ต้องกรอก/แนบในระบบของแหล่ง
  ref_no              text NOT NULL CHECK (length(btrim(ref_no)) BETWEEN 1 AND 200),   -- เลขที่หนังสือแจ้ง (บังคับ — D2)
  ref_date            date NOT NULL,                          -- วันที่หนังสือแจ้ง
  note                text CHECK (note IS NULL OR length(note) <= 4000),
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_funding_rounds_date_order CHECK (opens_on IS NULL OR opens_on <= closes_on),
  UNIQUE (source_id, target_fiscal_year)
);
CREATE INDEX IF NOT EXISTS local_funding_rounds_muni_idx ON public.local_funding_rounds (municipality_id, closes_on);

-- ── 3) โครงการในคลัง × แหล่งงบ ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_bank_candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ระบบคัดจากโครงการ (trigger)
  project_id          uuid NOT NULL,                          -- FK → local_dev_plan_projects (ไฟล์ 2) · ย้ายโครงการไม่ได้
  source_id           uuid NOT NULL,                          -- FK → local_funding_sources (ไฟล์ 2) · ต้องเป็นของ อปท. เดียวกัน
  target_fiscal_year  integer NOT NULL CHECK (target_fiscal_year BETWEEN 2500 AND 2700),
  requested_amount    numeric(15, 2) CHECK (requested_amount IS NULL OR requested_amount >= 0),   -- วงเงินที่ขอ (บาท)
  status              text NOT NULL DEFAULT 'preparing'
                        CHECK (status IN ('preparing', 'submitted', 'approved', 'rejected', 'withdrawn')),
  submitted_on        date,                                   -- วันที่ยื่น/ยืนยันในระบบของแหล่ง
  result_on           date,                                   -- วันที่หนังสือแจ้งผล
  result_ref_no       text CHECK (result_ref_no IS NULL OR length(result_ref_no) <= 200),
  result_amount       numeric(15, 2) CHECK (result_amount IS NULL OR result_amount >= 0),         -- วงเงินที่ได้รับจริง
  reason              text CHECK (reason IS NULL OR length(reason) <= 2000),                      -- เหตุที่ถอน / ไม่ได้รับ
  note                text CHECK (note IS NULL OR length(note) <= 4000),
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_bank_candidates_submitted_date CHECK (
    status NOT IN ('submitted', 'approved', 'rejected') OR submitted_on IS NOT NULL),
  -- ผลมาจากหนังสือแจ้ง: ได้รับ/ไม่ได้รับ ต้องมีวันที่และเลขที่หนังสือ
  CONSTRAINT local_bank_candidates_result_ref CHECK (
    status NOT IN ('approved', 'rejected') OR (result_on IS NOT NULL AND length(btrim(coalesce(result_ref_no, ''))) > 0)),
  CONSTRAINT local_bank_candidates_result_amount CHECK (result_amount IS NULL OR status = 'approved'),
  CONSTRAINT local_bank_candidates_withdrawn_reason CHECK (status <> 'withdrawn' OR length(btrim(coalesce(reason, ''))) > 0),
  CONSTRAINT local_bank_candidates_date_order CHECK (submitted_on IS NULL OR result_on IS NULL OR result_on >= submitted_on),
  UNIQUE (project_id, source_id, target_fiscal_year)
);
CREATE INDEX IF NOT EXISTS local_bank_candidates_muni_year_idx ON public.local_bank_candidates (municipality_id, target_fiscal_year);
CREATE INDEX IF NOT EXISTS local_bank_candidates_source_idx ON public.local_bank_candidates (source_id, target_fiscal_year);

-- ── 4) ความพร้อม 4 ด้านต่อโครงการ ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_project_readiness (
  project_id          uuid NOT NULL,                          -- FK → local_dev_plan_projects ON DELETE CASCADE (ไฟล์ 2)
  aspect              text NOT NULL CHECK (aspect IN ('study', 'land', 'design', 'estimate')),
  municipality_id     uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ระบบคัดจากโครงการ (trigger)
  -- กองเจ้าของงานของด้านนี้ (เช่น แบบ/ประมาณราคา = กองช่าง) — ผู้จัดการแผนมอบ กองแก้ระดับ/ไฟล์/หมายเหตุเองได้
  department_id       uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  level               smallint NOT NULL DEFAULT 2 CHECK (level BETWEEN 1 AND 4),
  done_on             date,                                   -- วันที่เสร็จ (ระดับ 4) — ไม่กรอก ระบบใส่วันนี้ให้ (trigger)
  -- ไฟล์หลักฐาน: 'drive:<id>' จาก drive-upload ใน org-documents (ไฟล์ไม่แชร์ อ่านผ่าน drive-file เท่านั้น — ผู้บริหาร viewer
  --   เปิดไม่ได้ เพราะ drive-file รับเฉพาะ INTERNAL_ROLES หน้าจอต้องบอก) หรือ https:// เท่านั้น
  --   เข้มกว่า civil_project_documents โดยตั้งใจ: ระดับ 4 "ต้องแนบ PDF" — สตริงเปล่า/http:// ผ่านไม่ได้ (migration-reviewer ข้อ 4)
  file_ref            text CHECK (file_ref IS NULL OR (length(file_ref) <= 1000 AND (
                        file_ref ~ '^drive:[A-Za-z0-9_-]+$' OR file_ref ~* '^https://'))),
  file_name           text CHECK (file_name IS NULL OR length(file_name) <= 300),
  mime_type           text CHECK (mime_type IS NULL OR length(mime_type) <= 100),
  size_bytes          bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  note                text CHECK (note IS NULL OR length(note) <= 2000),
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- ระดับ 4 "เสร็จ" ตามคู่มือ TWP ต้องแนบ PDF — ไม่มีไฟล์ = ยังไม่ใช่ระดับ 4
  CONSTRAINT local_project_readiness_done_has_file CHECK (level <> 4 OR file_ref IS NOT NULL),
  CONSTRAINT local_project_readiness_done_date CHECK ((level = 4) = (done_on IS NOT NULL)),
  PRIMARY KEY (project_id, aspect)
);
CREATE INDEX IF NOT EXISTS local_project_readiness_muni_dept_idx ON public.local_project_readiness (municipality_id, department_id);

-- ── 5) ช่องแบบฟอร์ม 001 ที่ทะเบียนยังไม่มี (1:1 กับโครงการ) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.local_bank_project_details (
  project_id          uuid PRIMARY KEY,                       -- FK → local_dev_plan_projects ON DELETE CASCADE (ไฟล์ 2)
  municipality_id     uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ระบบคัดจากโครงการ (trigger)
  activity            text CHECK (activity IS NULL OR length(activity) <= 1000),             -- 1-D กิจกรรม/ลักษณะงาน
  budget_type         text CHECK (budget_type IS NULL OR budget_type IN ('single_year', 'continuing', 'multi_year')),  -- 1-E ปีเดียว/ต่อเนื่อง/ผูกพัน
  planned_start       date,                                   -- 1-E เดือน-ปีที่เริ่ม (หน้าจอใช้เดือน/ปี วันที่ = 1)
  planned_end         date,                                   -- 1-E เดือน-ปีที่สิ้นสุด
  duration_days       integer CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 3650),   -- 1-E ระยะเวลา (วัน)
  -- 2-A พิกัด (WGS84) — กรอบประเทศไทยหลวมๆ กันสลับ lat/long หรือพิมพ์ทศนิยมผิดหลัก
  latitude            numeric(10, 7) CHECK (latitude IS NULL OR latitude BETWEEN 5 AND 21),
  longitude           numeric(10, 7) CHECK (longitude IS NULL OR longitude BETWEEN 97 AND 106),
  village_no          text CHECK (village_no IS NULL OR length(village_no) <= 100),           -- 2-B หมู่ที่ (หลายหมู่ได้ เช่น "5, 7")
  water_master_plan   text CHECK (water_master_plan IS NULL OR length(water_master_plan) <= 500),  -- 4-A แผนแม่บทน้ำ 20 ปี (ข้อความอิสระ)
  kpi                 text CHECK (kpi IS NULL OR length(kpi) <= 2000),                         -- 4-B ตัวชี้วัด/ผลที่คาดว่าจะได้รับ
  note                text CHECK (note IS NULL OR length(note) <= 4000),
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_bank_project_details_latlng_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT local_bank_project_details_period CHECK (planned_start IS NULL OR planned_end IS NULL OR planned_end >= planned_start)
);

-- ── ประวัติ: รับ entity ใหม่ 5 ชนิด ───────────────────────────────────────────────
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
  CHECK (entity IN ('dev_plan', 'dev_project', 'dev_project_year', 'op_plan', 'op_item', 'op_progress', 'evaluation',
                    'funding_source', 'funding_round', 'bank_candidate', 'readiness', 'bank_detail'));

-- ปิดไว้ก่อนจนกว่าไฟล์ 2 วางสิทธิ์ (RLS เปิด + ไม่มี policy = ไม่มีใครอ่าน/เขียนได้)
ALTER TABLE public.local_funding_sources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_funding_rounds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_bank_candidates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_project_readiness    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_bank_project_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_funding_sources, public.local_funding_rounds, public.local_bank_candidates,
              public.local_project_readiness, public.local_bank_project_details FROM PUBLIC, anon;

COMMENT ON TABLE public.local_funding_sources IS
  'แหล่งงบภายนอก ต่อ อปท. — กฎรอบปกติใช้คาดการณ์รอบที่ยังไม่มีหนังสือ (หน้าจอคำนวณ ไม่เก็บแถว) · template_key = แม่แบบในโค้ด';
COMMENT ON TABLE public.local_funding_rounds IS
  'รอบยื่นที่ยืนยันจากหนังสือแจ้งแล้ว (ต้องมีเลขที่+วันที่หนังสือ) — 1 แถวต่อแหล่ง × ปีงบที่ขอ';
COMMENT ON TABLE public.local_bank_candidates IS
  'คลังโครงการ: โครงการ × แหล่ง × ปีงบที่ขอ — ผลได้รับ/ไม่ได้รับ คนบันทึกจากหนังสือแจ้งผล ระบบไม่ตัดสิน';
COMMENT ON TABLE public.local_project_readiness IS
  'ความพร้อม 4 ด้านต่อโครงการ (ระดับ 1–4 ตามคู่มือ TWP · ระดับ 4 ต้องมีไฟล์) — กองเจ้าของงานแก้ระดับ/ไฟล์/หมายเหตุของด้านตัวเอง';
COMMENT ON TABLE public.local_bank_project_details IS
  'ช่องแบบฟอร์ม 001 (TWP) ที่ทะเบียนโครงการไม่มี — แยก 1:1 เพื่อไม่ติดด่านล็อกโครงการในแผนที่ประกาศแล้ว';

COMMIT;
