-- ปล่อยรถว่างช่วงรอ (ต่อจาก 20261010100000): คำนวณช่วงกันรถของเที่ยว "รอรับกลับ" ที่ยืนยันไว้แล้วและยังไม่ถึงวัน ด้วยกติกาใหม่
--
-- เที่ยวที่ยืนยันก่อนหน้านี้เก็บช่วงกันรถเป็นช่วงเดียวต่อเนื่อง (plan.blocks) ปฏิทินและด่านจองอ่านจากค่านี้
-- ถ้าไม่คำนวณใหม่ วันที่มีเที่ยวเหล่านี้ยังถูกกันทั้งวันจนกว่าจะมีคนจัดแผนใหม่ (ฐานจริง 2569-10-10: ทุ่งแค้ว 3 เที่ยว 12/15/20 ต.ค.)
--
-- ขอบเขต: เฉพาะงานผู้ป่วย state='confirmed' return_mode='wait' ปลายทางเดียว (ไม่ multiwave) ที่แผนมีช่วงเดียว และวันเดินทางยังไม่ผ่าน
--   คำนวณจาก outbound_waves/return_waves ที่เก็บในแผนด้วย ptb_merge_blocks (ตัวเดียวกับ ptb_plan) · เขียนเฉพาะเมื่อได้ ≥ 2 ช่วง
--   และช่วงใหม่อยู่ในช่วงเดิมทั้งหมด (ไม่ขยาย) · ซ้ำได้ผลเดิม (หลังเขียนแผนมี 2 ช่วง จึงไม่ถูกเลือกอีก)
-- ไม่แตะ: เที่ยวที่ออกรถ/จบแล้ว · งานชุมชน · revision ของเที่ยว (ไม่กวนหน้าที่เปิดค้าง)
-- ไม่ลง ptb_audit (actor_id ห้ามว่าง ไม่มีผู้ทำรายการ) — เหตุผลอยู่ที่ไฟล์นี้
-- ⚠️ trigger ptb_schedule_replan จะล้างเวลาประมาณการ/ป้ายแจ้งสาธารณะเมื่อแผนเปลี่ยน แต่การคำนวณนี้ไม่ได้เปลี่ยนเวลารับ-ส่งของใคร
--    จึงปิด trigger ระหว่างอัปเดตแล้วเปิดคืนใน transaction เดียวกัน (ไม่ให้ประมาณการที่เจ้าหน้าที่ตั้งไว้หาย)
BEGIN;
DO $guard$ BEGIN
 IF to_regprocedure('public.ptb_merge_blocks(jsonb)') IS NULL THEN RAISE EXCEPTION 'ต้อง apply 20261010100000 ก่อน'; END IF;
END $guard$;

ALTER TABLE public.patient_booking_trips DISABLE TRIGGER ptb_schedule_replan;

WITH calc AS (
 SELECT t.id,
  public.ptb_merge_blocks(
   coalesce((SELECT jsonb_agg(jsonb_build_object('start',w->>'pickup_at','end',w->>'end_at')) FROM jsonb_array_elements(t.plan->'outbound_waves') w),'[]'::jsonb)
   ||coalesce((SELECT jsonb_agg(jsonb_build_object('start',w->>'depart_at','end',w->>'end_at')) FROM jsonb_array_elements(t.plan->'return_waves') w),'[]'::jsonb)) AS merged,
  t.plan->'blocks' AS old_blocks
 FROM public.patient_booking_trips t
 WHERE t.state='confirmed' AND t.plan->>'return_mode'='wait'
  AND coalesce(t.plan->>'service_type','patient')='patient'
  AND coalesce((t.plan->>'multiwave')::boolean,false)=false
  AND CASE WHEN jsonb_typeof(t.plan->'outbound_waves')='array' THEN jsonb_array_length(t.plan->'outbound_waves') END=1
  AND CASE WHEN jsonb_typeof(t.plan->'return_waves')='array' THEN jsonb_array_length(t.plan->'return_waves') END>=1
  AND CASE WHEN jsonb_typeof(t.plan->'blocks')='array' THEN jsonb_array_length(t.plan->'blocks') END=1
  AND (t.plan->>'date')::date>=(now() AT TIME ZONE 'Asia/Bangkok')::date)
UPDATE public.patient_booking_trips t SET plan=jsonb_set(t.plan,'{blocks}',c.merged)
FROM calc c
WHERE t.id=c.id AND jsonb_array_length(c.merged)>1
 AND (c.merged->0->>'start')::timestamptz>=(c.old_blocks->0->>'start')::timestamptz
 AND (c.merged->-1->>'end')::timestamptz<=(c.old_blocks->0->>'end')::timestamptz;

ALTER TABLE public.patient_booking_trips ENABLE TRIGGER ptb_schedule_replan;
COMMIT;
