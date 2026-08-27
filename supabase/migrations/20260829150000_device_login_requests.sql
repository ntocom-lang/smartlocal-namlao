-- ล็อกอินด้วย QR จากมือถือ (Device QR Login) — ตารางคำขอจับคู่เครื่อง
-- เอกสารออกแบบเต็ม: docs/device-qr-login-design.md
--
-- ปัญหาที่แก้: เจ้าหน้าที่ไปใช้ PC เครื่องอื่นแล้วกดปุ่ม Google/LINE เบราว์เซอร์เครื่องนั้นจำ
-- session ของเจ้าของเครื่องไว้ จึงเข้าเป็นบัญชีคนอื่นโดยไม่รู้ตัว ทำให้ audit_logs บันทึก
-- ผู้กระทำผิดตัว (ประเด็น สตง.) และเป็นการเข้าถึงข้อมูลส่วนบุคคลด้วยสิทธิ์ของผู้อื่น (PDPA)
--
-- flow: PC ขอ code → แสดง QR + เลข 2 หลัก → มือถือที่ล็อกอินอยู่แล้วสแกน → แตะเลขที่ตรงกับ
-- จอ PC → PC เอา verifier ที่เก็บไว้ในแรมตัวเองมาแลก magic-link token → ได้ session
--
-- ทุกการเข้าถึงตารางนี้ผ่าน edge function device-login (service_role) เท่านั้น

CREATE TABLE public.device_login_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- อยู่ใน QR = ถือว่าสาธารณะ ใครถ่ายรูปจอไปก็เห็น จึงต้องมี verifier คู่กันเสมอ
  code text NOT NULL UNIQUE,
  -- sha256 ของค่าลับที่อยู่แต่ในแรมของ PC เครื่องที่ขอ ไม่เคยอยู่ใน QR และไม่เคยถูกส่งให้มือถือ
  -- (แนวคิดเดียวกับ PKCE) — กันคนร้ายที่ได้ code ไปแล้วมาแลก session แทนเครื่องจริง
  verifier_hash text NOT NULL,
  -- เลข 2 หลักที่แสดงบนจอ PC เท่านั้น มือถือต้องแตะให้ตรง = ตัวกัน QRLJacking
  match_number smallint NOT NULL CHECK (match_number BETWEEN 10 AND 99),
  -- เลขหลอก 2 ตัว ส่งให้มือถือแสดงเป็นตัวเลือกคู่กับเลขจริง
  decoy_numbers smallint[] NOT NULL CHECK (array_length(decoy_numbers, 1) = 2),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'claimed', 'denied', 'expired')),
  approved_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  municipality_id uuid REFERENCES public.municipalities(id) ON DELETE SET NULL,
  -- ข้อมูลเครื่องที่ขอ แสดงบนหน้าอนุมัติให้เจ้าหน้าที่ตัดสินใจ และเก็บลง audit log
  requester_ip inet,
  requester_user_agent text,
  -- แตะเลขผิด/ยิง verifier ผิด นับตรงนี้ ครบเพดานแล้วปิดคำขอทิ้ง
  attempt_count smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  approved_at timestamptz,
  claimed_at timestamptz
);

CREATE INDEX idx_device_login_requests_code ON public.device_login_requests (code);
CREATE INDEX idx_device_login_requests_expires ON public.device_login_requests (expires_at);

ALTER TABLE public.device_login_requests ENABLE ROW LEVEL SECURITY;

-- ไม่สร้าง policy ให้ anon/authenticated เลยแม้แต่ข้อเดียว และถอน grant ที่ default privileges
-- ของ Supabase แจกไว้ให้ตารางใหม่ออกทั้งหมด — ตารางนี้ถือ verifier_hash กับ match_number
-- ซึ่งถ้าอ่านได้จากฝั่ง client (PostgREST หรือ payload ของ Realtime) มาตรการกัน QRLJacking
-- และ PKCE จะไร้ผลทันที
REVOKE ALL ON public.device_login_requests FROM anon, authenticated;

-- ล้างคำขอที่หมดอายุ/ใช้แล้วทิ้ง — เก็บ 1 วันไว้ให้ตรวจสอบย้อนหลังได้ก่อน (audit_logs เก็บ
-- รายการอนุมัติจริงไว้ถาวรอยู่แล้ว ตารางนี้เป็นแค่สถานะระหว่างทาง)
CREATE OR REPLACE FUNCTION public.cleanup_device_login_requests()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.device_login_requests
  WHERE created_at < now() - interval '1 day';
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_device_login_requests() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('device-login-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'device-login-cleanup');

-- ทุกชั่วโมง ตรง :05
SELECT cron.schedule(
  'device-login-cleanup',
  '5 * * * *',
  $$ SELECT public.cleanup_device_login_requests(); $$
);
