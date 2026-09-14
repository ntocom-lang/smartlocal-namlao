-- ตารางรอบเก็บขยะ เฟส 1/3 — สร้างตาราง (RLS/RPC อยู่ 20260914100100, คีย์โมดูลอยู่ 20260914100200)
--
-- หลักการออกแบบ (เจ้าของระบบกำหนด 2569-09-14): "เจ้าหน้าที่ตั้งค่าครั้งเดียว ที่เหลือระบบคิดเอง"
-- จึงเก็บเป็น "กฎ" ไม่ใช่ "รายการวันที่" — ไม่มีอะไรต้องกรอกใหม่ทุกเดือนหรือทุกปี
--   - waste_schedules            กฎรอบเก็บ เช่น ทุกวันพฤหัส / พุธที่ 2 ของทุกเดือน
--   - waste_schedule_exceptions  ใช้เฉพาะตอนมีเหตุเปลี่ยนแปลงจริง (รถเสีย เลื่อนวัน)
--   - waste_villages             ทะเบียนหมู่ ตั้งครั้งเดียว
-- วันหยุดราชการไม่ต้องกรอกเป็นข้อยกเว้น — แต่ละกฎมี holiday_policy ที่ตั้งครั้งเดียว
-- แล้วหน้าเว็บคำนวณจากตาราง public_holidays ที่ระบบมีอยู่แล้ว (src/lib/wasteSchedule.js)
--
-- ไฟล์นี้เพิ่มของใหม่ล้วน apply ก่อน deploy ได้ปลอดภัย

BEGIN;

-- ===========================================================================
-- ทะเบียนหมู่ — ตอนนี้ระบบยังไม่มีทะเบียนหมู่บ้านต่อ อปท. เลย
-- (profiles.address_moo เป็นข้อความอิสระ และแทบไม่มีใครกรอก)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.waste_villages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  moo_no          smallint NOT NULL CHECK (moo_no BETWEEN 1 AND 99),
  -- ชื่อบ้านไม่บังคับ — ใส่แค่จำนวนหมู่ก็ใช้งานได้ ไม่เพิ่มงานให้เจ้าหน้าที่
  name            text CHECK (name IS NULL OR char_length(name) <= 120),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipality_id, moo_no)
);

-- ===========================================================================
-- กฎรอบเก็บ
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.waste_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  waste_type      text NOT NULL CHECK (waste_type IN ('general', 'hazardous')),
  -- ว่าง = ทุกหมู่ในพื้นที่
  moo_nos         smallint[] NOT NULL DEFAULT '{}',
  -- weekly  : ทุก interval_weeks สัปดาห์ ในวัน weekdays (นับรอบจาก starts_on)
  -- monthly : วัน weekdays[1] ลำดับที่ nth ของทุกเดือน (nth = -1 คือสัปดาห์สุดท้าย)
  rule            text NOT NULL CHECK (rule IN ('weekly', 'monthly')),
  interval_weeks  smallint NOT NULL DEFAULT 1 CHECK (interval_weeks IN (1, 2)),
  -- 0 = อาทิตย์ ... 6 = เสาร์ (ตรงกับ Date.getDay())
  weekdays        smallint[] NOT NULL,
  nth             smallint CHECK (nth IS NULL OR nth IN (1, 2, 3, 4, -1)),
  time_from       time,
  time_to         time,
  -- ไม่มีค่า default โดยตั้งใจ — อปท. แต่ละแห่งทำไม่เหมือนกัน ถ้าระบบเดาแทนแล้วผิด
  -- ประชาชนจะเอาขยะออกมาวางรอทั้งที่รถไม่มา ต้องให้เจ้าหน้าที่เลือกเอง 1 ครั้ง
  --   collect          เก็บตามปกติแม้ตรงวันหยุด
  --   skip             งดเก็บรอบนั้น
  --   next_working_day เลื่อนไปวันทำการถัดไป
  holiday_policy  text NOT NULL CHECK (holiday_policy IN ('collect', 'skip', 'next_working_day')),
  starts_on       date NOT NULL DEFAULT current_date,
  ends_on         date,
  note            text CHECK (note IS NULL OR char_length(note) <= 300),
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT waste_schedules_weekdays_valid CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  -- CHECK ใช้ซับคิวรีไม่ได้ จึงเขียนเป็น ALL แทน (อาร์เรย์ว่างผ่านเสมอ = ทุกหมู่)
  CONSTRAINT waste_schedules_moo_valid CHECK (1 <= ALL (moo_nos) AND 99 >= ALL (moo_nos)),
  CONSTRAINT waste_schedules_rule_shape CHECK (
    (rule = 'weekly'  AND nth IS NULL)
    OR (rule = 'monthly' AND nth IS NOT NULL AND cardinality(weekdays) = 1 AND interval_weeks = 1)
  ),
  CONSTRAINT waste_schedules_time_order CHECK (
    time_from IS NULL OR time_to IS NULL OR time_to > time_from
  ),
  CONSTRAINT waste_schedules_date_order CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS waste_schedules_municipality_idx
  ON public.waste_schedules (municipality_id, is_active);

-- ===========================================================================
-- ข้อยกเว้น — กดเฉพาะตอนมีเหตุจริง ครอบทุกกฎที่ตรงวันนั้นในคราวเดียว
-- (เจ้าหน้าที่ไม่ต้องไล่เลือกว่ากฎไหน แค่บอกว่า "วันที่ 15 งดเก็บ")
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.waste_schedule_exceptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  on_date         date NOT NULL,
  -- NULL = ทุกประเภทขยะ
  waste_type      text CHECK (waste_type IS NULL OR waste_type IN ('general', 'hazardous')),
  -- ว่าง = ทุกหมู่
  moo_nos         smallint[] NOT NULL DEFAULT '{}',
  action          text NOT NULL CHECK (action IN ('cancel', 'move')),
  new_date        date,
  reason          text CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT waste_exceptions_move_shape CHECK (
    (action = 'cancel' AND new_date IS NULL)
    OR (action = 'move' AND new_date IS NOT NULL AND new_date <> on_date)
  ),
  CONSTRAINT waste_exceptions_moo_valid CHECK (1 <= ALL (moo_nos) AND 99 >= ALL (moo_nos))
);

CREATE INDEX IF NOT EXISTS waste_schedule_exceptions_municipality_idx
  ON public.waste_schedule_exceptions (municipality_id, on_date);

COMMIT;
