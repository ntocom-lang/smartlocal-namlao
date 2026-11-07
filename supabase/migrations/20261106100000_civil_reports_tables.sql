-- โมดูล "โครงการก่อสร้าง + รายงานผลการก่อสร้างประจำสัปดาห์" (เมนูกองช่าง ฝั่งเจ้าหน้าที่) ไฟล์ 1/2 — ตารางล้วน
-- (เจ้าของระบบสั่ง 2569-11-06 จากไฟล์ต้นแบบรายงาน คสล./ลาดยาง) ไฟล์ 2/2 (20261106100100) ใส่ฟังก์ชันสิทธิ์ ตัวกระตุ้น policy
--
-- ออกแบบ
--   - ผูกกับทะเบียนโครงการเดิม civil_projects (ชื่อ/สัญญา/ผู้รับจ้าง/วงเงิน/วันเริ่ม–สิ้นสุด/พิกัด) ไม่สร้างทะเบียนซ้ำ
--   - ตารางใหม่ทั้งหมดไม่มี municipality_id/department_id ของตัวเอง: สิทธิ์ถามจากโครงการเสมอ (ฟังก์ชัน civil_can_*_project ในไฟล์ 2)
--     กันข้อมูลสองที่เพี้ยนจากกันเมื่อย้ายโครงการข้ามกอง
--   - ⚠️ ชื่อบุคคล (กรรมการ/ผู้ควบคุมงาน/ตัวแทนผู้รับจ้าง) อยู่ในตารางใหม่นี้เท่านั้น ห้ามย้ายไปใส่ civil_projects
--     เพราะ policy SELECT ของ civil_projects เดิมเป็น USING (true) (migration 046) — ดู "ขั้นที่ 0" ในแผน
--   - civil_weekly_reports.project_id เป็น ON DELETE RESTRICT: รายงานคือบันทึกทางราชการ ห้ามหายตามการลบโครงการ/ลบ อปท.
--     (ลบโครงการที่มีรายงานไม่ได้ ต้องให้ผู้ดูแลลบรายงานก่อนโดยตั้งใจ) ตารางอื่นเป็น CASCADE
--   - ไม่มีคอลัมน์ค่าปรับสะสม/สถานะงวด/ผลตรวจรับ: ระบบไม่ตัดสินเรื่องเงินหรือดุลพินิจ (fine_per_day เก็บตามสัญญาไว้ดูเฉยๆ)
--   - วันที่ทุกช่องเป็นชนิด date (ไม่ใช่ข้อความอิสระแบบต้นฉบับ) · ช่วงรายงานยาวไม่เกิน 7 วันตามพื้นที่ตารางรายวันบนใบพิมพ์
-- ⚠️ ตามกติกา "1 ไฟล์ = 1 เฟส" (docs/ai/NOTES.md ข้อ 3): ไฟล์นี้มีแต่ตาราง/ดัชนี/RLS เปิดเฉยๆ (ยังไม่มี policy = ปฏิเสธทุกคน)
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.civil_projects') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบตาราง civil_projects';
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.departments') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบตาราง profiles หรือ departments';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'civil_projects'
      AND column_name IN ('id', 'municipality_id', 'department_id', 'created_by', 'start_date', 'end_date')
  ) <> 6 THEN
    RAISE EXCEPTION 'Schema drift: civil_projects ขาดคอลัมน์ที่โมดูลนี้ใช้ (id, municipality_id, department_id, created_by, start_date, end_date)';
  END IF;
END $guard$;

-- ── 1) ข้อมูลสัญญาเพิ่มเติม (1:1 กับโครงการ) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.civil_project_contracts (
  project_id         uuid PRIMARY KEY REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  contract_date      date,                                   -- สัญญาลงวันที่
  extended_until     date,                                   -- ต่อสัญญาถึง (ข้อเท็จจริงที่คนบันทึกจากการอนุมัติ ระบบไม่ตัดสิน)
  fine_per_day       numeric(12, 2) CHECK (fine_per_day IS NULL OR fine_per_day >= 0),   -- เก็บตามสัญญา ไม่คำนวณค่าปรับ
  installments_total integer CHECK (installments_total IS NULL OR installments_total >= 0),
  designer_name      text,
  attach_no          text,                                   -- บันทึกแนบท้ายที่
  attach_date        date,
  spec               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(spec) = 'object'),  -- ลักษณะงาน: ยาว/กว้าง/ช่วงถนน
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── 2) บุคคลของโครงการ ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.civil_project_people (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  grp            text NOT NULL CHECK (grp IN ('committee', 'supervisor', 'contractor_rep')),
  sort_order     integer NOT NULL DEFAULT 0,
  name           text NOT NULL DEFAULT '',
  position_title text NOT NULL DEFAULT '',                  -- ตำแหน่ง (ตัวแทนผู้รับจ้างใช้ช่องนี้เป็น "วุฒิ")
  duty           text NOT NULL DEFAULT '',                  -- หน้าที่ เช่น ประธานกรรมการ / หัวหน้าผู้ควบคุมงาน
  profile_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,   -- ผู้ควบคุมงานที่มีบัญชีในระบบ (ได้สิทธิ์เขียนรายงานของโครงการนี้)
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (profile_id IS NULL OR grp IN ('committee', 'supervisor'))   -- ตัวแทนผู้รับจ้างไม่มีบัญชีเจ้าหน้าที่
);

-- ── 3) รายการงาน + สัดส่วน + แผน ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.civil_project_work_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  name       text NOT NULL,
  weight_pct numeric(7, 3) NOT NULL DEFAULT 0 CHECK (weight_pct >= 0 AND weight_pct <= 100),   -- สัดส่วนงาน % (รวมต้อง 100 — ตรวจที่ฝั่งแอปตอนแก้ทีละแถว)
  plan_start date,                                          -- แผนเชิงเส้น: วันเริ่ม–สิ้นสุดของรายการ (ระบบคำนวณแผนสะสมรายสัปดาห์เอง)
  plan_end   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (plan_start IS NULL OR plan_end IS NULL OR plan_end >= plan_start)
);

-- ── 4) รายงานรายสัปดาห์ ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.civil_weekly_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE RESTRICT,
  week_no       integer NOT NULL CHECK (week_no >= 1),
  report_no     integer,                                    -- รายงานครั้งที่ (ว่าง = เท่าเลขสัปดาห์)
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  memo_no       text,                                       -- ที่ (เลขหนังสือ กรอกมือ ยังไม่ผูกระบบสารบรรณ)
  memo_date     date,
  memo_to       text,                                       -- เรียน
  -- ข้อมูลที่ผู้ควบคุมงานบันทึก (รูปแบบอยู่ใน src/lib/constructionReport.js)
  progress      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(progress) = 'object'),   -- { itemId: { week, plan, base } }
  crew          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(crew) = 'array'),        -- [{ name, days: [n…] }]
  machinery     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(machinery) = 'array'),
  weather       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(weather) = 'object'),    -- { 'YYYY-MM-DD': ['clear'|'light'|'moderate'|'heavy'] } คนยืนยันเอง
  daily_log     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(daily_log) = 'array'),   -- [{ date, detail, note }]
  issues        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(issues) = 'object'),     -- { problems, solution, other } ว่าง = ไม่มี
  finance       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(finance) = 'object'),    -- { advance_amount, advance_pct, budget_rows[] } ข้อเท็จจริงที่คนกรอก
  -- ตัวเลขที่แช่แข็งตอนล็อก: ใบที่ลงนามแล้วต้องพิมพ์ย้อนหลังได้ตัวเลขเดิม แม้ภายหลังแก้รายการงาน/สัปดาห์ก่อนหน้า
  frozen        jsonb CHECK (frozen IS NULL OR jsonb_typeof(frozen) = 'object'),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  finalized_by  uuid,                                       -- ไม่ใส่ FK โดยตั้งใจ: เป็นรอยตรวจสอบ บัญชีที่ลาออกต้องลบได้
  finalized_at  timestamptz,
  UNIQUE (project_id, week_no),
  CHECK (period_end >= period_start AND period_end - period_start <= 6),
  CHECK ((status = 'final') = (frozen IS NOT NULL AND finalized_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS civil_project_people_project_idx
  ON public.civil_project_people (project_id, grp, sort_order);
CREATE INDEX IF NOT EXISTS civil_project_people_profile_idx
  ON public.civil_project_people (profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS civil_project_work_items_project_idx
  ON public.civil_project_work_items (project_id, sort_order);
CREATE INDEX IF NOT EXISTS civil_weekly_reports_project_idx
  ON public.civil_weekly_reports (project_id, week_no);

-- เปิด RLS ตั้งแต่สร้าง (ยังไม่มี policy = ปฏิเสธทุกคนจนกว่าไฟล์ 2 จะวางสิทธิ์)
ALTER TABLE public.civil_project_contracts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_project_people      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_project_work_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_weekly_reports      ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.civil_project_contracts  IS 'ข้อมูลสัญญาเพิ่มเติมของ civil_projects (1:1) — โมดูลรายงานผลการก่อสร้าง';
COMMENT ON TABLE public.civil_project_people     IS 'กรรมการตรวจการจ้าง / ผู้ควบคุมงาน / ตัวแทนผู้รับจ้าง ของโครงการ — มีชื่อบุคคล RLS แคบ ห้ามเปิดสาธารณะ';
COMMENT ON TABLE public.civil_project_work_items IS 'รายการงาน สัดส่วน และวันแผนของโครงการ (ตั้งครั้งเดียว ระบบคำนวณแผนสะสมเอง)';
COMMENT ON TABLE public.civil_weekly_reports     IS 'รายงานผลการก่อสร้างประจำสัปดาห์ (draft แก้ได้ / final ล็อกพร้อมตัวเลขแช่แข็งใน frozen)';

COMMIT;
