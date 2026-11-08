-- เมนู "แผนพัฒนาท้องถิ่น" ไฟล์ 2/3 — ตารางใหม่ 6 ตาราง (ยังไม่มี policy = ปฏิเสธทุกคน จนกว่าไฟล์ 3 วางสิทธิ์)
--   ต้องรันหลัง 20261109100000 (profiles.plan_role) · ไฟล์ 3/3 (20261109100200) ใส่ FK ระหว่างตารางใหม่ ฟังก์ชัน trigger policy
--
-- ออกแบบ (เจ้าของระบบตัดสิน 2569-11-08: เมนูแยกจากโครงการก่อสร้าง · ข้อมูลเล่มเดียว · ช่วงปีอ่านจากข้อมูลแผน)
--   local_dev_plans              แผนพัฒนาท้องถิ่นแต่ละฉบับ (ช่วงปี สถานะ วันประกาศ ฉบับที่เมนูแสดง)
--   local_dev_plan_projects      ทะเบียนโครงการ = "ข้อมูลเล่มเดียว" ที่แผนดำเนินงาน/คลังโครงการ/โครงการก่อสร้างอ้างถึง
--   local_dev_plan_project_years วงเงินรายปีของโครงการในแผน (1 แถว/ปีงบ)
--   local_op_plans               แผนการดำเนินงานรายปี: ฉบับหลัก / เพิ่มเติม / แก้ไข ครั้งที่ n
--   local_op_plan_items          รายการในแผนการดำเนินงาน (งบ เดือนดำเนินการ กองผู้รับผิดชอบ ลำดับ)
--   local_plan_events            ประวัติ: ระบบเขียนเอง เขียนเพิ่มอย่างเดียว (ใครแก้อะไร ค่าเดิม → ค่าใหม่)
--
--   - ไฟล์นี้มี FK ชี้เฉพาะตารางเดิม (municipalities / departments) — FK ระหว่างตารางใหม่ด้วยกันไปใส่ไฟล์ 3
--     (ตามแนวเดียวกับ 20261108100100: กันกับดัก "สร้างตารางแล้วอ้างในไฟล์เดียวกัน" NOTES ข้อ 3)
--   - ทุกตารางหลักมี municipality_id ของตัวเอง (ตารางลูกถูกบังคับให้ตรงกับแม่โดย trigger ไฟล์ 3) ให้ policy ตัดสินจากแถวตรงๆ
--     ไม่ต้องไล่ถามแม่ → ไม่ชนกับดัก INSERT … RETURNING ของ #649
--   - เดือนดำเนินการเก็บเป็น "เดือนที่ของปีงบประมาณ" 1–12 (1 = ต.ค. … 12 = ก.ย.) ไม่ใช่เลขเดือนปฏิทิน
--     ช่วงข้ามปีปฏิทิน (พ.ย.–ก.พ.) จะได้เทียบมากน้อยได้ตรงๆ · ตรงกับตาราง 12 ช่องของฉบับกระดาษ (ไตรมาส 1–4)
--     สมมติฐาน: 1 รายการ = ช่วงต่อเนื่องช่วงเดียว (ฉบับร่างแผนดำเนินงาน ปี 2570 ของน้ำเลาที่เจ้าของส่งภาพมาเป็นลูกศรช่วงเดียวทุกแถว)
--   - created_by / updated_by / actor ไม่ใส่ FK โดยตั้งใจ (รอยตรวจสอบ บัญชีที่ลาออก/ถูกรวมต้องลบได้ — บทเรียน #658)
--   - ระบบไม่ตัดสินแทนคน: วันประกาศ เลขที่หนังสือขยายเวลา = ข้อเท็จจริงที่ผู้มีอำนาจทำแล้ว ระบบแค่เก็บและนับวันให้
--   - ยังไม่มีตาราง/ช่องตามแบบ ผด.01/ผด.02 และบัญชีโครงการแผน 2571–2575 ตามหนังสือ สถ. (เฟส R1 — รอไฟล์จากนักวิเคราะห์)
--     ช่อง strategy / project_code จึงเป็นข้อความอิสระไปก่อน
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'plan_role') THEN
    RAISE EXCEPTION 'ต้องรัน 20261109100000_profiles_plan_role.sql ก่อน (ไม่พบ profiles.plan_role)';
  END IF;
END $guard$;

-- ── 1) แผนพัฒนาท้องถิ่นแต่ละฉบับ ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_dev_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  title            text NOT NULL DEFAULT 'แผนพัฒนาท้องถิ่น' CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  year_from        integer NOT NULL CHECK (year_from BETWEEN 2500 AND 2700),        -- ปีงบประมาณ พ.ศ.
  year_to          integer NOT NULL CHECK (year_to BETWEEN 2500 AND 2700),
  -- แผนที่เมนูแสดง (ชื่อเมนูอ่านช่วงปีจากแถวนี้) — อาจเป็นฉบับร่างก็ได้ เช่น 2571–2575 ที่กำลังจัดทำ · 1 อปท. มีได้ 1 แถว
  is_current       boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),   -- เปลี่ยนได้ทาง RPC เท่านั้น (ไฟล์ 3)
  published_on     date,                                                             -- วันที่ผู้บริหารท้องถิ่นลงนามประกาศใช้
  published_by     uuid,
  announce_ref_no  text CHECK (announce_ref_no IS NULL OR length(announce_ref_no) <= 200),   -- เลขที่ประกาศ
  note             text CHECK (note IS NULL OR length(note) <= 4000),
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_dev_plans_year_range CHECK (year_to >= year_from AND year_to - year_from <= 9),
  CONSTRAINT local_dev_plans_published_has_date CHECK (status <> 'published' OR published_on IS NOT NULL),
  UNIQUE (municipality_id, year_from, year_to)
);
CREATE UNIQUE INDEX IF NOT EXISTS local_dev_plans_one_current
  ON public.local_dev_plans (municipality_id) WHERE is_current;

-- ── 2) ทะเบียนโครงการ (ข้อมูลเล่มเดียว) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_dev_plan_projects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id    uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ต้องตรงกับแผน (trigger)
  dev_plan_id        uuid NOT NULL,                       -- FK → local_dev_plans (ไฟล์ 3) · ย้ายแผนไม่ได้
  department_id      uuid REFERENCES public.departments(id) ON DELETE SET NULL,  -- กองผู้รับผิดชอบ (ว่างได้ตอนนำเข้า แล้วระบบเตือน)
  -- ชื่อทางการ: ล็อกเมื่อแผนประกาศใช้แล้ว · แผนดำเนินงานที่ผูกโครงการนี้คัดชื่อนี้ไปเสมอ (ชื่อตรงกันทุกเอกสาร)
  official_name      text NOT NULL CHECK (length(btrim(official_name)) BETWEEN 1 AND 1000),
  project_code       text CHECK (project_code IS NULL OR length(project_code) <= 50),     -- ลำดับในบัญชีโครงการของเล่มแผน
  strategy           text CHECK (strategy IS NULL OR length(strategy) <= 500),            -- ยุทธศาสตร์/ประเด็นการพัฒนา (ข้อความอิสระจนกว่าจะเห็นแบบ สถ.)
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dropped')),
  -- 0 = อยู่ในแผนฉบับที่ประกาศ · n ≥ 1 = เพิ่มเข้ามาในการเพิ่มเติม/เปลี่ยนแปลงแผนครั้งที่ n (ข้อ 22) ต้องมีเลขที่ประกาศ
  added_in_revision  smallint NOT NULL DEFAULT 0 CHECK (added_in_revision BETWEEN 0 AND 99),
  revision_ref_no    text CHECK (revision_ref_no IS NULL OR length(revision_ref_no) <= 200),
  note               text CHECK (note IS NULL OR length(note) <= 4000),
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS local_dev_plan_projects_plan_idx ON public.local_dev_plan_projects (dev_plan_id);
CREATE INDEX IF NOT EXISTS local_dev_plan_projects_muni_dept_idx ON public.local_dev_plan_projects (municipality_id, department_id);

-- ── 3) วงเงินรายปีในแผน ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_dev_plan_project_years (
  project_id       uuid NOT NULL,                         -- FK → local_dev_plan_projects (ไฟล์ 3)
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ระบบคัดจากโครงการ (trigger)
  fiscal_year      integer NOT NULL CHECK (fiscal_year BETWEEN 2500 AND 2700),           -- ต้องอยู่ในช่วงปีของแผน (trigger)
  amount           numeric(15, 2) CHECK (amount IS NULL OR amount >= 0),                -- ว่าง = มีในปีนี้แต่ยังไม่ระบุวงเงิน
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, fiscal_year)
);

-- ── 4) แผนการดำเนินงานรายปี ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_op_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ต้องตรงกับแผนพัฒนา (trigger)
  dev_plan_id         uuid NOT NULL,                      -- FK → local_dev_plans (ไฟล์ 3) · ปีงบต้องอยู่ในช่วงของแผนนั้น
  fiscal_year         integer NOT NULL CHECK (fiscal_year BETWEEN 2500 AND 2700),
  kind                text NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'supplement', 'amendment')),  -- หลัก / เพิ่มเติม / แก้ไข
  revision_no         smallint NOT NULL DEFAULT 0 CHECK (revision_no BETWEEN 0 AND 99),               -- ครั้งที่ (หลัก = 0)
  -- ฐานนับ 30 วัน (ข้อ 27): ประกาศใช้งบประมาณรายจ่ายประจำปี / เพิ่มเติม / จ่ายขาดเงินสะสม / ได้รับแจ้งโครงการจากหน่วยงานอื่น
  basis               text CHECK (basis IS NULL OR basis IN ('annual_budget', 'supplementary_budget', 'accumulated_fund', 'external_notice')),
  basis_on            date,                               -- วันประกาศใช้ / วันได้รับแจ้ง
  basis_ref_no        text CHECK (basis_ref_no IS NULL OR length(basis_ref_no) <= 200),
  -- ขยายเวลา = อำนาจผู้บริหารท้องถิ่น (ข้อ 27) ระบบเก็บเลขที่/วันที่หนังสือและกำหนดใหม่ ไม่ตัดสินเอง
  extension_ref_no    text CHECK (extension_ref_no IS NULL OR length(extension_ref_no) <= 200),
  extension_ref_date  date,
  extended_due_on     date,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),  -- เปลี่ยนได้ทาง RPC เท่านั้น (ไฟล์ 3)
  published_on        date,                               -- วันที่ผู้บริหารท้องถิ่นลงนามประกาศ
  published_by        uuid,
  announce_ref_no     text CHECK (announce_ref_no IS NULL OR length(announce_ref_no) <= 200),
  note                text CHECK (note IS NULL OR length(note) <= 4000),
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_op_plans_kind_revision CHECK ((kind = 'main') = (revision_no = 0)),
  CONSTRAINT local_op_plans_basis_pair CHECK ((basis IS NULL) = (basis_on IS NULL)),
  CONSTRAINT local_op_plans_extension_needs_ref CHECK (extended_due_on IS NULL OR extension_ref_no IS NOT NULL),
  CONSTRAINT local_op_plans_published_has_date CHECK (status <> 'published' OR published_on IS NOT NULL),
  UNIQUE (municipality_id, fiscal_year, revision_no)
);
CREATE INDEX IF NOT EXISTS local_op_plans_plan_idx ON public.local_op_plans (dev_plan_id);

-- ── 5) รายการในแผนการดำเนินงาน ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_op_plan_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  op_plan_id       uuid NOT NULL,                         -- FK → local_op_plans (ไฟล์ 3) · ย้ายฉบับไม่ได้
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,   -- ระบบคัดจากฉบับ (trigger)
  department_id    uuid REFERENCES public.departments(id) ON DELETE SET NULL,   -- ผู้รับผิดชอบ = กอง (กองนี้แก้เดือน/หมายเหตุของแถวได้)
  -- ผูกทะเบียนโครงการ (ว่างได้: นำเข้าฉบับเดิมที่ยังไม่ได้จับคู่ / โครงการที่หน่วยงานอื่นแจ้ง) — ข้อ 25 ระบบเตือน ไม่บล็อก
  dev_project_id   uuid,                                  -- FK → local_dev_plan_projects ON DELETE RESTRICT (ไฟล์ 3)
  source           text NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'external')),
  external_agency  text CHECK (external_agency IS NULL OR length(external_agency) <= 300),
  seq_no           integer CHECK (seq_no IS NULL OR seq_no BETWEEN 1 AND 9999),   -- ลำดับที่พิมพ์ (ว่างได้ ตามฉบับกระดาษที่มีแถวไม่มีเลข)
  sort_order       integer NOT NULL DEFAULT 0,            -- ลำดับแสดงผล (ลากเรียงเองได้ ไม่ลงประวัติ)
  item_name        text NOT NULL CHECK (length(btrim(item_name)) BETWEEN 1 AND 1000),  -- ผูกทะเบียนแล้ว = ชื่อทางการเสมอ (trigger)
  amount           numeric(15, 2) CHECK (amount IS NULL OR amount >= 0),          -- งบประมาณ (บาท) — แก้ได้เฉพาะนักวิเคราะห์/แอดมิน
  month_from       smallint CHECK (month_from IS NULL OR month_from BETWEEN 1 AND 12),   -- เดือนที่ของปีงบ 1 = ต.ค.
  month_to         smallint CHECK (month_to IS NULL OR month_to BETWEEN 1 AND 12),
  note             text CHECK (note IS NULL OR length(note) <= 2000),
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_op_plan_items_month_range CHECK (
    (month_from IS NULL AND month_to IS NULL) OR (month_from IS NOT NULL AND month_to IS NOT NULL AND month_to >= month_from)),
  CONSTRAINT local_op_plan_items_external_agency CHECK (source <> 'external' OR length(btrim(coalesce(external_agency, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS local_op_plan_items_plan_idx ON public.local_op_plan_items (op_plan_id, sort_order);
CREATE INDEX IF NOT EXISTS local_op_plan_items_project_idx ON public.local_op_plan_items (dev_project_id) WHERE dev_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS local_op_plan_items_muni_dept_idx ON public.local_op_plan_items (municipality_id, department_id);

-- ── 6) ประวัติ (ระบบเขียนเอง เขียนเพิ่มอย่างเดียว) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.local_plan_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  entity           text NOT NULL CHECK (entity IN ('dev_plan', 'dev_project', 'dev_project_year', 'op_plan', 'op_item')),
  entity_id        uuid NOT NULL,                         -- ไม่ใส่ FK: ประวัติต้องอยู่ต่อแม้แถวถูกลบ
  parent_id        uuid,                                  -- แผนพัฒนา (ของโครงการ) / ฉบับแผนดำเนินงาน (ของรายการ) ไว้กรองดูทั้งฉบับ
  action           text NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'publish', 'unpublish')),
  changes          jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {"ชื่อช่อง": [ค่าเดิม, ค่าใหม่]} เฉพาะช่องที่เปลี่ยน
  reason           text CHECK (reason IS NULL OR length(reason) <= 2000),
  actor            uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS local_plan_events_entity_idx ON public.local_plan_events (entity_id, created_at);
CREATE INDEX IF NOT EXISTS local_plan_events_parent_idx ON public.local_plan_events (parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS local_plan_events_muni_idx ON public.local_plan_events (municipality_id, created_at);

-- ปิดทุกตารางไว้ก่อน (RLS เปิด + ไม่มี policy = ไม่มีใครอ่าน/เขียนได้) จนกว่าไฟล์ 3 วางสิทธิ์
ALTER TABLE public.local_dev_plans              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_dev_plan_projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_dev_plan_project_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_op_plans               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_op_plan_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_plan_events            ENABLE ROW LEVEL SECURITY;

-- anon ไม่มีสิทธิ์ใดๆ (แผนที่ประกาศแล้วเป็นเอกสารเปิดเผย แต่หน้าประชาชนเป็นงานเฟสหลัง ต้องออกแบบช่องที่เปิดได้แยก)
REVOKE ALL ON public.local_dev_plans, public.local_dev_plan_projects, public.local_dev_plan_project_years,
              public.local_op_plans, public.local_op_plan_items, public.local_plan_events FROM PUBLIC, anon;

COMMENT ON TABLE public.local_dev_plans IS 'แผนพัฒนาท้องถิ่นแต่ละฉบับ — is_current = ฉบับที่เมนูแสดง (ชื่อเมนูอ่านช่วงปีจากแถวนี้)';
COMMENT ON TABLE public.local_dev_plan_projects IS 'ทะเบียนโครงการ (ข้อมูลเล่มเดียว) — civil_projects.registry_ref จะชี้ id ตารางนี้ (FK ยังไม่ใส่ รออนุญาตแตะโมดูลก่อสร้าง)';
COMMENT ON TABLE public.local_op_plans IS 'แผนการดำเนินงานรายปี ฉบับหลัก/เพิ่มเติม/แก้ไข — ประกาศแล้วแช่แข็ง แก้ต้องทำฉบับครั้งถัดไป';
COMMENT ON TABLE public.local_op_plan_items IS 'รายการในแผนการดำเนินงาน — month_from/month_to = เดือนที่ของปีงบ (1 = ต.ค. … 12 = ก.ย.)';
COMMENT ON TABLE public.local_plan_events IS 'ประวัติเมนูแผนพัฒนาท้องถิ่น — trigger เขียนเอง ผู้ใช้อ่านได้อย่างเดียว';

COMMIT;
