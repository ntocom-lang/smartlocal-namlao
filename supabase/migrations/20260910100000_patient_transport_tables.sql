-- คำขอ "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย" เฟส 1/4 — ตาราง + ข้อบังคับ (ยังไม่มี RLS/ฟังก์ชัน)
-- ไฟล์ถัดไป 20260910100100 จึงจะสร้าง RLS ที่อ้างตารางเหล่านี้ได้ (กติกาแยกไฟล์ตามเฟส)
--
-- ที่มา: อปท. รับคำขอจากประชาชน แล้วออกหนังสือนำส่งไปให้หน่วยงานภายนอกที่มีรถ/อาสาขับ
-- (ตัวอย่างแรกคือกองทุนสวัสดิการชุมชนตำบล) เป็นผู้พิจารณาและจัดรถเอง อปท. เป็นเพียงช่องทางรับเรื่อง
-- ข่าวที่ สถ. ชี้แจง (27 ธ.ค. 2561) ระบุว่า อปท. ที่ไม่มีรถเหมาะสมให้ประสานมูลนิธิหรือองค์กรอื่นได้
-- — ยังไม่ได้เปิดหนังสือสั่งการฉบับจริงยืนยันเลขที่ ห้ามอ้างเลขหนังสือจากไฟล์นี้
--
-- ⚠️ PDPA: วันนัด/ประเภทนัด/ระดับการเคลื่อนไหวของผู้ป่วยเป็นข้อมูลสุขภาพ = ข้อมูลอ่อนไหว
-- (ต้องยืนยันเลขมาตรากับ พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคลฉบับปัจจุบัน) และผู้รับปลายทางไม่ใช่
-- ส่วนราชการ การส่งต่อจึงต้องมีความยินยอมโดยชัดแจ้งที่ระบุชื่อผู้รับ — consent_at/consent_version
-- จึงเป็น NOT NULL และตั้งใจไม่มีช่องอาการ/โรคแบบพิมพ์อิสระเลย (เก็บเท่าที่ต้องใช้จัดรถ)
--
-- ⚠️ ยังไม่มีกลไก retention — document_requests ทั้งตารางไม่มีเลย ต้องตัดสินใจระยะเวลาเก็บ
-- ข้อมูลสุขภาพก่อนเปิดใช้กับ อปท. จริง

BEGIN;

-- ===========================================================================
-- 1. ทะเบียนหน่วยงานรับเรื่องต่อ (ราย อปท.)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.referral_partners (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- ชื่อที่ประชาชนเห็นในข้อความขอความยินยอม เช่น "กองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว"
  name             text NOT NULL,
  -- บรรทัด "เรียน" ของหนังสือนำส่งและใบคำขอ เช่น "ประธานคณะกรรมการกองทุนสวัสดิการชุมชนตำบล..."
  recipient_title  text NOT NULL,
  address          text,
  phone            text,
  -- ประเภทคำขอที่หน่วยงานนี้รับ — เผื่อวันหนึ่งส่งต่อเรื่องอื่นได้โดยไม่ต้อง migrate ใหม่
  document_types   text[] NOT NULL DEFAULT ARRAY['patient_transport_request']::text[],
  -- ต้องยื่นล่วงหน้ากี่วันก่อนวันนัด — แต่ละกองทุนมีระเบียบเอง จึงเก็บรายหน่วยงาน
  -- ค่า 3 เป็นสมมติฐานของระบบ ยังไม่ได้มาจากระเบียบกองทุนใด
  min_lead_days    integer NOT NULL DEFAULT 3,
  -- เลิกส่งต่อแล้วให้ปิด is_active ห้ามลบ คำขอเก่ายังอ้าง partner_id อยู่
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.referral_partners IS
  'หน่วยงานภายนอกที่ อปท. ส่งต่อคำขอให้ (เช่น กองทุนสวัสดิการชุมชนตำบล) — ไม่ใช่กองภายใน อปท.';
COMMENT ON COLUMN public.referral_partners.min_lead_days IS
  'จำนวนวันขั้นต่ำที่ต้องยื่นก่อนวันนัด (เจ้าหน้าที่รับเรื่องแทนหน้าเคาน์เตอร์ได้รับยกเว้น)';

ALTER TABLE public.referral_partners
  DROP CONSTRAINT IF EXISTS referral_partners_name_length_check;
ALTER TABLE public.referral_partners
  ADD CONSTRAINT referral_partners_name_length_check
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);

ALTER TABLE public.referral_partners
  DROP CONSTRAINT IF EXISTS referral_partners_recipient_length_check;
ALTER TABLE public.referral_partners
  ADD CONSTRAINT referral_partners_recipient_length_check
  CHECK (char_length(btrim(recipient_title)) BETWEEN 1 AND 300);

ALTER TABLE public.referral_partners
  DROP CONSTRAINT IF EXISTS referral_partners_address_length_check;
ALTER TABLE public.referral_partners
  ADD CONSTRAINT referral_partners_address_length_check
  CHECK (address IS NULL OR char_length(address) <= 500);

ALTER TABLE public.referral_partners
  DROP CONSTRAINT IF EXISTS referral_partners_phone_length_check;
ALTER TABLE public.referral_partners
  ADD CONSTRAINT referral_partners_phone_length_check
  CHECK (phone IS NULL OR char_length(phone) <= 60);

ALTER TABLE public.referral_partners
  DROP CONSTRAINT IF EXISTS referral_partners_document_types_check;
ALTER TABLE public.referral_partners
  ADD CONSTRAINT referral_partners_document_types_check
  CHECK (cardinality(document_types) BETWEEN 1 AND 20);

-- เพดาน 30 วัน กันพิมพ์ผิดหลักแล้วประชาชนยื่นไม่ได้ทั้ง อปท.
ALTER TABLE public.referral_partners
  DROP CONSTRAINT IF EXISTS referral_partners_min_lead_days_check;
ALTER TABLE public.referral_partners
  ADD CONSTRAINT referral_partners_min_lead_days_check
  CHECK (min_lead_days BETWEEN 0 AND 30);

CREATE UNIQUE INDEX IF NOT EXISTS referral_partners_tenant_name_key
  ON public.referral_partners (municipality_id, btrim(name));

CREATE INDEX IF NOT EXISTS referral_partners_tenant_active_idx
  ON public.referral_partners (municipality_id, is_active);

-- ===========================================================================
-- 2. หัวคำขอ — 1:1 กับ document_requests (parent ที่ Inbox/สถิติ/ประวัติใช้อยู่แล้ว)
-- ===========================================================================
-- รายละเอียดการเดินทางที่ประชาชนกรอก (จุดรับ ปลายทาง ประเภทนัด ผู้ติดตาม ฯลฯ) อยู่ใน
-- document_requests.permit_form_data ซึ่งเป็น snapshot ตอนยื่นที่ห้ามแก้ ตารางนี้เก็บเฉพาะ
-- ค่าที่ต้อง index/กรอง และผลการดำเนินงานที่เปลี่ยนไปตามขั้นตอน
CREATE TABLE IF NOT EXISTS public.patient_transport_requests (
  request_id               uuid PRIMARY KEY REFERENCES public.document_requests(id) ON DELETE CASCADE,
  municipality_id          uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  department_id            uuid REFERENCES public.departments(id) ON DELETE SET NULL,

  -- ON DELETE RESTRICT: ห้ามลบหน่วยงานที่มีคำขออ้างอยู่ ต้องปิด is_active แทน
  partner_id               uuid NOT NULL REFERENCES public.referral_partners(id) ON DELETE RESTRICT,
  -- snapshot ณ วันยื่น — ทะเบียนแก้ชื่อได้ตลอด แต่หนังสือที่พิมพ์ไปแล้วต้องพิมพ์ซ้ำได้เหมือนเดิม
  -- และข้อความยินยอมที่ประชาชนติ๊กระบุชื่อผู้รับ ณ ตอนนั้น
  partner_name_snapshot    text NOT NULL,
  recipient_title_snapshot text NOT NULL,

  appointment_at           timestamptz NOT NULL,
  -- เดินได้เอง / ใช้วีลแชร์ / ต้องนอนเปล — กองทุนใช้ตัดสินว่าจัดรถแบบไหน (นอนเปลอาจต้องใช้รถพยาบาล)
  mobility                 text NOT NULL,

  workflow_status          text NOT NULL DEFAULT 'submitted',

  consent_at               timestamptz NOT NULL,
  consent_version          text NOT NULL,

  -- เลขหนังสือนำส่ง "ที่ ....../......" พิมพ์เองตามทะเบียนหนังสือส่งของ อปท.
  -- (ระบบไม่ออกเลขให้ ตามแบบเดิมของทุกใบในระบบ)
  forward_letter_no        text,
  forward_letter_date      date,
  forwarded_at             timestamptz,
  forwarded_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  fund_responded_at        timestamptz,
  fund_recorded_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  fund_result_note         text,
  -- ช่องทางติดต่อที่หน่วยงานปลายทางให้แจ้งประชาชน — ควรเป็นเบอร์ของหน่วยงาน ไม่ใช่เบอร์ส่วนตัวอาสา
  fund_contact             text,

  completed_at             timestamptz,
  completed_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at             timestamptz,
  cancelled_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reject_reason            text,
  staff_note               text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.patient_transport_requests IS
  'หัวคำขออนุเคราะห์รถรับ-ส่งผู้ป่วย 1:1 กับ document_requests (document_type = patient_transport_request)';
COMMENT ON COLUMN public.patient_transport_requests.appointment_at IS
  'วันเวลานัดที่สถานพยาบาล — คนละเรื่องกับ document_requests.due_date ซึ่งเป็น SLA การรับเรื่อง';

-- 7 สถานะ ทุกตัวมีปุ่มจริงบนหน้าจอเจ้าหน้าที่
--   submitted      ยื่นแล้ว รอ อปท. ตรวจสอบ
--   forwarded      ออกหนังสือนำส่งแล้ว รอผลจากหน่วยงานปลายทาง
--   fund_accepted  หน่วยงานปลายทางรับจัดรถ
--   fund_declined  หน่วยงานปลายทางไม่รับ (ต้องมีเหตุผล)
--   completed      เดินทางเรียบร้อย ปิดเรื่อง
--   rejected       อปท. ไม่ส่งต่อ (ข้อมูลไม่ครบ/นอกพื้นที่/เป็นเหตุฉุกเฉิน ฯลฯ)
--   cancelled      ผู้ยื่นขอยกเลิก หรือเจ้าหน้าที่ยกเลิกตามคำขอ (= ถอนความยินยอม)
ALTER TABLE public.patient_transport_requests
  DROP CONSTRAINT IF EXISTS patient_transport_requests_workflow_status_check;
ALTER TABLE public.patient_transport_requests
  ADD CONSTRAINT patient_transport_requests_workflow_status_check
  CHECK (workflow_status IN (
    'submitted', 'forwarded', 'fund_accepted', 'fund_declined', 'completed', 'rejected', 'cancelled'
  ));

ALTER TABLE public.patient_transport_requests
  DROP CONSTRAINT IF EXISTS patient_transport_requests_mobility_check;
ALTER TABLE public.patient_transport_requests
  ADD CONSTRAINT patient_transport_requests_mobility_check
  CHECK (mobility IN ('walk', 'wheelchair', 'stretcher'));

ALTER TABLE public.patient_transport_requests
  DROP CONSTRAINT IF EXISTS patient_transport_requests_consent_version_check;
ALTER TABLE public.patient_transport_requests
  ADD CONSTRAINT patient_transport_requests_consent_version_check
  CHECK (char_length(btrim(consent_version)) BETWEEN 1 AND 40);

ALTER TABLE public.patient_transport_requests
  DROP CONSTRAINT IF EXISTS patient_transport_requests_letter_no_length_check;
ALTER TABLE public.patient_transport_requests
  ADD CONSTRAINT patient_transport_requests_letter_no_length_check
  CHECK (forward_letter_no IS NULL OR char_length(btrim(forward_letter_no)) BETWEEN 1 AND 40);

ALTER TABLE public.patient_transport_requests
  DROP CONSTRAINT IF EXISTS patient_transport_requests_text_length_check;
ALTER TABLE public.patient_transport_requests
  ADD CONSTRAINT patient_transport_requests_text_length_check
  CHECK (
    (fund_result_note IS NULL OR char_length(fund_result_note) <= 500)
    AND (fund_contact IS NULL OR char_length(fund_contact) <= 200)
    AND (reject_reason IS NULL OR char_length(reject_reason) <= 500)
    AND (staff_note IS NULL OR char_length(staff_note) <= 1000)
  );

-- ทุกสถานะที่ผ่านขั้นส่งต่อมาแล้วต้องมีเลขหนังสือนำส่ง — ไม่งั้นตรวจย้อนหลังไม่ได้ว่า
-- ข้อมูลผู้ป่วยออกจาก อปท. ไปด้วยหนังสือฉบับไหน (ประเด็น PDPA/สตง.)
ALTER TABLE public.patient_transport_requests
  DROP CONSTRAINT IF EXISTS patient_transport_requests_forwarded_letter_check;
ALTER TABLE public.patient_transport_requests
  ADD CONSTRAINT patient_transport_requests_forwarded_letter_check
  CHECK (
    workflow_status NOT IN ('forwarded', 'fund_accepted', 'fund_declined', 'completed')
    OR (forward_letter_no IS NOT NULL AND forwarded_at IS NOT NULL)
  );

-- หน่วยงานปลายทางไม่รับ ต้องบอกประชาชนได้ว่าเพราะอะไร
ALTER TABLE public.patient_transport_requests
  DROP CONSTRAINT IF EXISTS patient_transport_requests_declined_note_check;
ALTER TABLE public.patient_transport_requests
  ADD CONSTRAINT patient_transport_requests_declined_note_check
  CHECK (workflow_status <> 'fund_declined' OR COALESCE(btrim(fund_result_note), '') <> '');

CREATE INDEX IF NOT EXISTS patient_transport_requests_tenant_status_idx
  ON public.patient_transport_requests (municipality_id, department_id, workflow_status);

-- ไล่เที่ยวที่ใกล้ถึงวันนัด: เฉพาะใบที่ยังไม่ปิด
CREATE INDEX IF NOT EXISTS patient_transport_requests_upcoming_idx
  ON public.patient_transport_requests (municipality_id, appointment_at)
  WHERE workflow_status IN ('submitted', 'forwarded', 'fund_accepted');

CREATE INDEX IF NOT EXISTS patient_transport_requests_partner_idx
  ON public.patient_transport_requests (partner_id);

-- ===========================================================================
-- 3. Audit trail — เขียนใน transaction เดียวกับทุก action ห้ามพึ่ง log ฝั่ง client
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.patient_transport_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES public.patient_transport_requests(request_id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  actor_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- ชื่อผู้ทำ ณ ขณะนั้น — actor_id เป็น NULL ได้เมื่อลบบัญชี แต่ประวัติต้องยังอ่านออก
  actor_name      text,
  event_type      text NOT NULL,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.patient_transport_events
  DROP CONSTRAINT IF EXISTS patient_transport_events_type_check;
ALTER TABLE public.patient_transport_events
  ADD CONSTRAINT patient_transport_events_type_check
  CHECK (event_type IN (
    'created', 'rejected', 'forwarded', 'fund_accepted', 'fund_declined', 'completed', 'cancelled'
  ));

CREATE INDEX IF NOT EXISTS patient_transport_events_request_idx
  ON public.patient_transport_events (request_id, created_at DESC);

COMMIT;
