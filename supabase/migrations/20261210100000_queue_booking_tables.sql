-- จองคิวรับบริการ (แผนเทียบคู่แข่ง ขั้น 1D · E2) ไฟล์ 1/2 — สร้างตาราง + ปิดประตูทันที
--   ไฟล์ 2 (20261210100100) ใส่ RLS / GRANT / RPC / เปิดโมดูลให้ demo — แยกไฟล์ตามกติกา "1 ไฟล์ = 1 เฟส"
--
-- queue_services  บริการที่เปิดให้จองคิว ราย อปท. (แอดมินตั้งครั้งเดียว: วันเปิด ช่วงเวลา ความยาวช่อง โควตาต่อช่อง)
--                 department_id = กองที่ถือเรื่อง ⇒ เจ้าหน้าที่กองนั้นเห็นคิว (ว่าง = แอดมินเห็นอย่างเดียว)
-- queue_bookings  ใบจองของประชาชน 1 แถว = 1 คิว · เขียนผ่าน RPC เท่านั้น (book/cancel/mark) ไม่มี INSERT/UPDATE ตรง
--                 เก็บชื่อ/เบอร์ "ณ ตอนจอง" ไว้ในแถว เพราะเจ้าหน้าที่อ่าน profiles ของประชาชนตรงๆ ไม่ได้ (RLS)
--
-- ทำทีหลัง (จดไว้ ไม่ทำในรอบนี้): ปิดวันหยุดเอง · เตือนก่อนวัน · ประเมินหลังรับบริการ · ห้องประชุม/รถสุขา · ใบคิวพิมพ์
BEGIN;
SET LOCAL lock_timeout = '5s'; -- FK ไป auth.users ถือ lock จน COMMIT — มี session ค้างให้ล้มเร็ว ไม่ขวางการล็อกอินทุก อปท.

CREATE TABLE IF NOT EXISTS public.queue_services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  department_id    uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description      text CHECK (description IS NULL OR length(description) <= 1000),
  location         text CHECK (location IS NULL OR length(location) <= 200),
  -- ISO weekday 1 = จันทร์ … 7 = อาทิตย์
  open_weekdays    smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'
                   CHECK (cardinality(open_weekdays) BETWEEN 1 AND 7 AND open_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_time       time NOT NULL DEFAULT '08:30',
  end_time         time NOT NULL DEFAULT '16:30',
  slot_minutes     smallint NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  per_slot_quota   smallint NOT NULL DEFAULT 3 CHECK (per_slot_quota BETWEEN 1 AND 100),
  book_ahead_days  smallint NOT NULL DEFAULT 30 CHECK (book_ahead_days BETWEEN 0 AND 180),
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid, -- รอยตรวจสอบ ไม่ใส่ FK (บทเรียน #658: trigger คืนค่าเดิม → FK SET NULL เสียเงียบ)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS public.queue_bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  service_id       uuid NOT NULL REFERENCES public.queue_services(id) ON DELETE CASCADE,
  citizen_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  citizen_name     text NOT NULL CHECK (length(citizen_name) <= 200),
  contact_phone    text CHECK (contact_phone IS NULL OR contact_phone ~ '^[0-9]{9,10}$'),
  note             text CHECK (note IS NULL OR length(note) <= 500),
  booking_date     date NOT NULL,
  slot_time        time NOT NULL,
  queue_no         integer NOT NULL CHECK (queue_no > 0),
  status           text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'arrived', 'no_show')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz,
  checked_at       timestamptz,
  checked_by       uuid -- รอยตรวจสอบ ไม่ใส่ FK (แนวเดียวกับ local_plan/licence)
);

-- 1 คน 1 คิวต่อบริการต่อวัน (ยกเลิกแล้วจองใหม่ได้)
CREATE UNIQUE INDEX IF NOT EXISTS queue_bookings_one_active_per_day
  ON public.queue_bookings (service_id, booking_date, citizen_id) WHERE status <> 'cancelled';
-- เลขคิวไม่ซ้ำภายในบริการ+วัน (RPC ออกเลขภายใต้ lock อยู่แล้ว ดัชนีนี้เป็นด่านสุดท้าย)
CREATE UNIQUE INDEX IF NOT EXISTS queue_bookings_queue_no_unique
  ON public.queue_bookings (service_id, booking_date, queue_no);
CREATE INDEX IF NOT EXISTS queue_bookings_citizen_idx ON public.queue_bookings (citizen_id, booking_date DESC);
CREATE INDEX IF NOT EXISTS queue_bookings_muni_date_idx ON public.queue_bookings (municipality_id, booking_date);
CREATE INDEX IF NOT EXISTS queue_services_muni_idx ON public.queue_services (municipality_id);

-- ปิดประตูทันที — ไฟล์ 2 เปิดเฉพาะที่ต้องใช้
ALTER TABLE public.queue_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.queue_services, public.queue_bookings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.queue_services, public.queue_bookings TO service_role;

COMMIT;
