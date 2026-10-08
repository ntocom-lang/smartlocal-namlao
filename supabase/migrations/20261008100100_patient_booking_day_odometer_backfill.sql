-- เลขไมล์เหมาเป็นวัน — เฟส 2/3: ย้ายเลขไมล์รายเที่ยวที่บันทึกไว้แล้วเป็นรายวัน (ครั้งเดียว · รันซ้ำได้ ไม่ทับแถวที่มีแล้ว)
--
-- วันละ 1 เที่ยว  = คัดลอกเลขออก/กลับ/รอตรวจสอบ/เหตุผลของเที่ยวนั้นตรงๆ
-- วันละหลายเที่ยว = เลขออกของเที่ยวแรก + เลขกลับของเที่ยวสุดท้าย (เรียงตามเวลารับ)
--   ถ้าตัวเลขเหลื่อมกัน (เที่ยวหลังออกก่อนเที่ยวก่อนกลับ) ไม่ครบ หรือเกินเกณฑ์ → ติด "รอตรวจสอบ" ให้คนตรวจ ไม่เดาแทน
-- คอลัมน์รายเที่ยวเดิมไม่แก้ไม่ลบ · ไม่ลง ptb_audit เพราะ patient_booking_events.actor_id ห้ามว่าง
-- และ migration ไม่มีผู้ใช้ — ที่มาของแถวบันทึกไว้ใน odometer_note แทน (recorded_by ว่าง = ย้ายจากรายเที่ยว)
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.patient_booking_odometer_days') IS NULL THEN
  RAISE EXCEPTION 'ต้อง apply 20261008100000_patient_booking_day_odometer_table.sql ก่อน';
 END IF;
END $$;

WITH trip AS (
 SELECT t.municipality_id, (t.plan->>'date')::date AS d, t.odometer_start, t.odometer_end, t.odometer_issue, t.odometer_note, t.updated_at,
  row_number() OVER (PARTITION BY t.municipality_id, t.plan->>'date' ORDER BY (t.plan->>'pickup_at')::timestamptz, t.id) AS first_rank,
  row_number() OVER (PARTITION BY t.municipality_id, t.plan->>'date' ORDER BY (t.plan->>'pickup_at')::timestamptz DESC, t.id DESC) AS last_rank,
  count(*) OVER (PARTITION BY t.municipality_id, t.plan->>'date') AS n,
  lag(t.odometer_end) OVER (PARTITION BY t.municipality_id, t.plan->>'date' ORDER BY (t.plan->>'pickup_at')::timestamptz, t.id) AS prev_end
 FROM public.patient_booking_trips t
 WHERE t.state = 'completed' AND t.plan->>'date' IS NOT NULL
  AND (t.odometer_start IS NOT NULL OR t.odometer_end IS NOT NULL OR t.odometer_issue)
), day AS (
 SELECT municipality_id, d, max(n) AS n,
  max(odometer_start) FILTER (WHERE first_rank = 1) AS s,
  max(odometer_end) FILTER (WHERE last_rank = 1) AS e,
  bool_or(odometer_issue) AS any_issue,
  bool_or(odometer_start IS NULL OR odometer_end IS NULL) AS any_missing,
  bool_or(prev_end IS NOT NULL AND odometer_start IS NOT NULL AND odometer_start < prev_end) AS overlap,
  max(odometer_note) FILTER (WHERE first_rank = 1) AS first_note,
  max(updated_at) AS at
 FROM trip GROUP BY municipality_id, d
), checked AS (
 SELECT *, n > 1 AND (any_issue OR any_missing OR overlap OR s IS NULL OR e IS NULL OR e < s OR e::bigint - s::bigint > 2000) AS doubtful
 FROM day
)
INSERT INTO public.patient_booking_odometer_days(municipality_id, service_date, odometer_start, odometer_end, odometer_issue, odometer_note, recorded_at)
SELECT municipality_id, d, s, e,
 CASE WHEN n = 1 THEN any_issue ELSE doubtful END,
 CASE WHEN n = 1 THEN left(coalesce(first_note, ''), 300)
  ELSE format('ย้ายจากเลขไมล์รายเที่ยว %s เที่ยว%s', n, CASE WHEN doubtful THEN ' · ตัวเลขเหลื่อมกันหรือไม่ครบ กรุณาตรวจ' ELSE '' END) END,
 at
FROM checked
ON CONFLICT (municipality_id, service_date) DO NOTHING;
COMMIT;
