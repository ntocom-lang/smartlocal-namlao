-- วงจรโครงการก่อสร้าง ไฟล์ 2/3 — ตารางใหม่ 6 ตาราง (ยังไม่มี policy = ปฏิเสธทุกคน จนกว่าไฟล์ 3 วางสิทธิ์)
--   ต้องรันหลัง 20261108100000 (คอลัมน์) · ไฟล์ 3/3 (20261108100200) ใส่ฟังก์ชัน trigger policy
--
-- ออกแบบ (ต่อจากหลักของ 20261106100000)
--   - ทุกตารางไม่มี municipality_id/department_id ของตัวเอง: สิทธิ์ถามจากโครงการเสมอ (civil_can_*_project)
--   - FK ชี้ civil_projects อย่างเดียว ไม่ชี้กันเองระหว่างตารางใหม่ (กันกับดัก "สร้างตารางแล้วอ้างในไฟล์เดียวกัน" NOTES ข้อ 3)
--     งวด/เอกสารอ้างกันด้วยเลขงวด (installment_no) แทน FK
--   - ระบบไม่ตัดสินแทนคน: ผลตรวจรับ ผลการขยายเวลา คืนหลักประกัน = "ข้อเท็จจริงที่ผู้มีอำนาจตัดสินแล้ว" + เลขที่/วันที่หนังสือ
--     ไฟล์ 3 จำกัดให้เฉพาะผู้จัดการโครงการ (หัวหน้ากอง/แอดมิน) บันทึกช่องเหล่านี้
--   - ยอดเงินทุกช่องคัดลอกจากเอกสารจริง (ฎีกา e-LAAS / e-GP) ไม่มีคอลัมน์คำนวณ เพราะยอดสุทธิจริงมีหักภาษี ณ ที่จ่าย ฯลฯ
--   - ON DELETE CASCADE ทุกตาราง: ลบโครงการ = admin เท่านั้น (policy 20260802060000) และลบไม่ได้อยู่แล้วเมื่อมีรายงานสัปดาห์ (RESTRICT)
--     การลบโครงการบันทึกฝั่งแอปด้วย logAction
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'civil_projects' AND column_name = 'stage'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261108100000_civil_lifecycle_columns.sql ก่อน (ไม่พบ civil_projects.stage)';
  END IF;
END $guard$;

-- ── 1) จุดตรวจวันเดียว (milestone): 1 แถวต่อ 1 จุดต่อโครงการ ─────────────────────────
-- key ตามแคตาล็อกใน src/lib/constructionLifecycle.js (PR-B) — ฐานข้อมูลตรวจแค่รูปแบบ ไม่ล็อกรายชื่อ
--   (เพิ่มจุดตรวจใหม่ตามระเบียบได้โดยไม่ต้องแก้ฐานข้อมูล) ยกเว้นคีย์ที่ไฟล์ 3 จำกัดสิทธิ์: guarantee_returned
CREATE TABLE IF NOT EXISTS public.civil_project_milestones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  done_on     date,                                   -- วันที่เกิดขึ้นจริง (ว่าง = ยังไม่ทำ/ยังไม่บันทึก)
  ref_no      text CHECK (ref_no IS NULL OR length(ref_no) <= 200),      -- เลขที่หนังสือ / เลขโครงการ e-GP
  ref_date    date,
  amount      numeric(15, 2),                         -- เช่น ราคากลางที่เห็นชอบ / ราคาผู้ที่จะจ้าง
  link        text CHECK (link IS NULL OR (link ~* '^https?://' AND length(link) <= 1000)),   -- ลิงก์ประกาศบนเว็บ
  note        text CHECK (note IS NULL OR length(note) <= 4000),
  created_by  uuid,                                   -- ไม่ใส่ FK โดยตั้งใจ (รอยตรวจสอบ บัญชีที่ลาออกต้องลบได้) ประทับโดย trigger
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

-- ── 2) งวดงาน: ส่งมอบ → ตรวจรับ → เบิกจ่าย ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.civil_project_installments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  installment_no        integer NOT NULL CHECK (installment_no >= 1),
  amount                numeric(15, 2) CHECK (amount IS NULL OR amount >= 0),           -- เงินงวดตามสัญญา
  work_pct              numeric(6, 3) CHECK (work_pct IS NULL OR (work_pct >= 0 AND work_pct <= 100)),
  description           text CHECK (description IS NULL OR length(description) <= 4000),
  due_on                date,                         -- กำหนดส่งมอบงวดตามสัญญา (ฐานของรายงาน ณ วันครบกำหนด ข้อ 178(4))
  due_report_on         date,                         -- วันที่ผู้ควบคุมงานรายงาน ณ วันครบกำหนดงวด
  due_report_ref        text,
  delivered_on          date,                         -- วันที่ผู้รับจ้างส่งมอบ
  delivery_ref_no       text,                         -- เลขรับหนังสือส่งมอบ
  chair_acknowledged_on date,                         -- วันที่ประธานกรรมการทราบการส่งมอบ (ฐานนับ 3 วันทำการ ข้อ 176(5))
  inspected_on          date,                         -- วันที่ตรวจรับ
  -- ↓ ผลตรวจรับ: บันทึกได้เฉพาะผู้จัดการโครงการ (ไฟล์ 3) — คณะกรรมการเป็นผู้ตัดสิน ระบบแค่เก็บ
  inspection_result     text CHECK (inspection_result IS NULL OR inspection_result IN ('accepted', 'rejected')),
  inspection_reason     text CHECK (inspection_reason IS NULL OR length(inspection_reason) <= 4000),
  inspection_dissent    text CHECK (inspection_dissent IS NULL OR length(inspection_dissent) <= 4000),   -- ความเห็นแย้งของกรรมการ
  egp_inspection_no     text,                         -- เลขคุมใบตรวจรับใน e-GP
  -- ↓ ค่าปรับ (ข้อ 181): หนังสือแจ้งสิทธิเรียกค่าปรับ + สงวนสิทธิ์ขณะรับมอบ — ยอดทางการคำนวณใน e-GP
  fine_notice_no        text,
  fine_notice_date      date,
  fine_reserved         boolean NOT NULL DEFAULT false,
  -- ↓ เบิกจ่าย: คัดลอกจากฎีกา e-LAAS ตามจริง
  voucher_no            text,
  paid_on               date,
  paid_gross            numeric(15, 2) CHECK (paid_gross IS NULL OR paid_gross >= 0),
  deduct_advance        numeric(15, 2) CHECK (deduct_advance IS NULL OR deduct_advance >= 0),
  deduct_retention      numeric(15, 2) CHECK (deduct_retention IS NULL OR deduct_retention >= 0),
  deduct_fine           numeric(15, 2) CHECK (deduct_fine IS NULL OR deduct_fine >= 0),
  deduct_other          numeric(15, 2) CHECK (deduct_other IS NULL OR deduct_other >= 0),
  paid_net              numeric(15, 2) CHECK (paid_net IS NULL OR paid_net >= 0),
  note                  text CHECK (note IS NULL OR length(note) <= 4000),
  created_by            uuid,
  updated_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, installment_no),
  CHECK (inspection_result IS NULL OR inspected_on IS NOT NULL)
);

-- ── 3) ขยายเวลา / งดหรือลดค่าปรับ / แก้ไขสัญญา (พ.ร.บ.จัดซื้อฯ ม.97, 102 · ระเบียบ กค. ข้อ 182) ──────
CREATE TABLE IF NOT EXISTS public.civil_project_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('extend_time', 'waive_fine', 'reduce_fine', 'amend_contract')),
  cause               text CHECK (cause IS NULL OR length(cause) <= 4000),
  cause_ended_on      date,                           -- วันที่เหตุสิ้นสุด (ฐานเช็ก "แจ้งภายใน 15 วัน" ข้อ 182)
  request_received_on date,                           -- วันที่รับหนังสือขอของผู้รับจ้าง
  requested_days      integer CHECK (requested_days IS NULL OR requested_days >= 0),
  -- ↓ ผลการพิจารณาของผู้มีอำนาจ: บันทึกได้เฉพาะผู้จัดการโครงการ (ไฟล์ 3)
  decision            text CHECK (decision IS NULL OR decision IN ('approved', 'rejected')),
  approved_on         date,
  approved_days       integer CHECK (approved_days IS NULL OR approved_days >= 0),
  new_end_date        date,
  amount_change       numeric(15, 2),                 -- แก้ไขสัญญาที่เปลี่ยนวงเงิน (ติดลบได้)
  ref_no              text,
  ref_date            date,
  egp_published_on    date,                           -- วันที่เผยแพร่การแก้ไขสัญญาใน e-GP (ม.98)
  note                text CHECK (note IS NULL OR length(note) <= 4000),
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (decision IS NULL OR approved_on IS NOT NULL)
);

-- ── 4) ตรวจความชำรุดบกพร่อง (ข้อ 184–186 · หนังสือ กค (กวจ) ว 117) ─────────────────────
CREATE TABLE IF NOT EXISTS public.civil_project_defects (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  inspected_on          date NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('during_warranty', 'final_before_expiry')),
  result                text NOT NULL CHECK (result IN ('ok', 'defect')),
  detail                text CHECK (detail IS NULL OR length(detail) <= 4000),
  notice_no             text,                         -- หนังสือแจ้งผู้รับจ้างให้แก้ไข
  notice_date           date,
  guarantor_notified_on date,                         -- แจ้งผู้ค้ำประกัน
  fix_due_on            date,                         -- กำหนดเข้าแก้ไขตามสัญญา
  fixed_on              date,
  note                  text CHECK (note IS NULL OR length(note) <= 4000),
  created_by            uuid,
  updated_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── 5) ประวัติโครงการ (เขียนเพิ่มอย่างเดียว) ──────────────────────────────────────
-- ระบบเขียนเองทุกครั้งที่ขั้นเปลี่ยน (ไฟล์ 3) · ผู้ใช้เขียนได้เฉพาะ kind = 'note' · แก้/ลบไม่ได้
CREATE TABLE IF NOT EXISTS public.civil_project_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind ~ '^[a-z][a-z_]{1,39}$'),
  from_stage  text,
  to_stage    text,
  reason      text CHECK (reason IS NULL OR length(reason) <= 4000),
  ref_no      text CHECK (ref_no IS NULL OR length(ref_no) <= 200),
  ref_date    date,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  actor       uuid DEFAULT auth.uid(),                -- ไม่ใส่ FK โดยตั้งใจ (รอยตรวจสอบ) · ไฟล์ 3 บังคับเป็นผู้ล็อกอินจริง
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 6) ไฟล์แนบ (สำเนาเอกสารจาก e-GP / e-LAAS / ใบที่พิมพ์จากระบบแล้วลงนาม) ─────────────────
-- file_ref = รหัส/ลิงก์ไฟล์บน Drive ส่วนตัวของระบบ (โฟลเดอร์ไม่มีชื่อคน — PDPA) ไม่เก็บตัวไฟล์ในฐานข้อมูล
CREATE TABLE IF NOT EXISTS public.civil_project_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.civil_projects(id) ON DELETE CASCADE,
  stage          text CHECK (stage IS NULL OR stage IN (
                   'budgeted', 'designing', 'procuring', 'contracted', 'started', 'construction',
                   'final_inspection', 'warranty', 'closed', 'suspended', 'cancelled', 'terminated')),
  doc_kind       text NOT NULL CHECK (doc_kind ~ '^[a-z][a-z0-9_]{1,62}$'),   -- แคตาล็อกอยู่ใน lib
  source         text NOT NULL DEFAULT 'other' CHECK (source IN ('egp', 'elaas', 'system', 'other')),
  installment_no integer CHECK (installment_no IS NULL OR installment_no >= 1),
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  ref_no         text CHECK (ref_no IS NULL OR length(ref_no) <= 200),
  ref_date       date,
  -- รับ 3 แบบ: 'drive:<id>' (ไฟล์ private จาก drive-upload — isPrivateDriveRef ใน driveStorage.js) · URL http(s) ·
  -- รหัสเปล่าที่ไม่มี ':' และ '/' — กันลิงก์ javascript:/data: และ //โดเมนอื่น ถ้าหน้าจอเอาไปทำเป็นลิงก์
  file_ref       text CHECK (file_ref IS NULL OR (length(file_ref) <= 1000 AND (
                   file_ref ~ '^drive:[A-Za-z0-9_-]+$' OR file_ref ~* '^https?://' OR file_ref !~ '[:/]'))),
  mime_type      text CHECK (mime_type IS NULL OR length(mime_type) <= 100),
  size_bytes     bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS civil_projects_stage_idx ON public.civil_projects (municipality_id, stage);
CREATE INDEX IF NOT EXISTS civil_project_installments_project_idx ON public.civil_project_installments (project_id, installment_no);
CREATE INDEX IF NOT EXISTS civil_project_changes_project_idx ON public.civil_project_changes (project_id, created_at);
CREATE INDEX IF NOT EXISTS civil_project_defects_project_idx ON public.civil_project_defects (project_id, inspected_on);
CREATE INDEX IF NOT EXISTS civil_project_events_project_idx ON public.civil_project_events (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS civil_project_documents_project_idx ON public.civil_project_documents (project_id, stage);

ALTER TABLE public.civil_project_milestones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_project_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_project_changes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_project_defects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_project_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_project_documents    ENABLE ROW LEVEL SECURITY;

-- ถอน anon/PUBLIC ทั้งหมด (ค่าเริ่มต้นของ Supabase อาจ GRANT ALL ให้อัตโนมัติ) + ถอนสิทธิ์ที่ authenticated ไม่ควรมี
-- ⚠️ ไม่ถอน SELECT/INSERT/UPDATE/DELETE ของ authenticated ที่นี่โดยตั้งใจ: ถ้าไฟล์นี้ถูกรันซ้ำหลังไฟล์ 3 (เช่น db push ยิงซ้ำ
--    NOTES ข้อ 10) สิทธิ์ที่ไฟล์ 3 ให้ไว้จะหายทั้ง 6 ตาราง · ระหว่างยังไม่มี policy RLS ก็ปฏิเสธทุกคนอยู่แล้ว
REVOKE ALL ON TABLE public.civil_project_milestones, public.civil_project_installments, public.civil_project_changes,
  public.civil_project_defects, public.civil_project_events, public.civil_project_documents FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.civil_project_milestones, public.civil_project_installments,
  public.civil_project_changes, public.civil_project_defects, public.civil_project_events, public.civil_project_documents FROM authenticated;

COMMENT ON TABLE public.civil_project_milestones   IS 'จุดตรวจตามระเบียบของโครงการ (ข้อเท็จจริง: วันที่ เลขที่หนังสือ/e-GP ยอดเงิน) — กฎกำหนดเวลาอยู่ใน constructionLifecycle.js';
COMMENT ON TABLE public.civil_project_installments IS 'งวดงาน: ส่งมอบ ตรวจรับ (ผลบันทึกโดยผู้จัดการโครงการ) หนังสือค่าปรับ เบิกจ่าย (คัดจากฎีกา)';
COMMENT ON TABLE public.civil_project_changes      IS 'ขยายเวลา / งดหรือลดค่าปรับ / แก้ไขสัญญา — ผลพิจารณาบันทึกโดยผู้จัดการโครงการ';
COMMENT ON TABLE public.civil_project_defects      IS 'ผลตรวจความชำรุดบกพร่องระหว่าง/ก่อนครบระยะประกัน';
COMMENT ON TABLE public.civil_project_events       IS 'ประวัติโครงการ เขียนเพิ่มอย่างเดียว (ระบบบันทึกการเปลี่ยนขั้นเอง ผู้ใช้เพิ่มได้เฉพาะ note)';
COMMENT ON TABLE public.civil_project_documents    IS 'ไฟล์แนบของโครงการ (อ้างไฟล์บน Drive ส่วนตัว ไม่เก็บตัวไฟล์)';

COMMIT;
