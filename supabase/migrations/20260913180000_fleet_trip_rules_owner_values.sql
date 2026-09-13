-- ค่ากติกาคิวรถตามที่เจ้าของระบบกำหนด (2026-09-13) แทนค่าสมมติฐานเดิมใน 20260913150100
--   queue_buffer      30 นาที  (เท่าเดิม)
--   max_auto_duration 72 ชม.  → 30 วัน
--   past_grace        15 นาที → 1 วัน
--     (เจ้าของระบบเลือก 1 วันแทน 30 วัน: บันทึกย้อนหลังเป็นสิทธิ์ผู้ดูแลเท่านั้น ถ้าให้ 30 วัน
--      เจ้าหน้าที่ทั่วไปจะได้คิวย้อนหลังเองโดยผู้ดูแลไม่เห็น ย้อนหลังนานกว่า 1 วันยังอนุมัติได้ แต่ผู้ดูแลต้องกดเอง)
--
-- ผลต่อการใช้งาน: คำขอที่เวลาออกย้อนหลังไม่เกิน 1 วัน หรือขอใช้ยาวไม่เกิน 30 วัน
-- ได้คิวอัตโนมัติถ้ารถ/คนขับว่าง (เดิมตกไป "รอจัดสรรรถ" ให้ผู้ดูแลพิจารณา)
-- เกณฑ์คิวทับ/รถซ่อม/เอกสารหมดอายุ/รถยังไม่คืน ไม่เปลี่ยน
--
-- ตัวเลขในข้อความเหตุผล (หน้าจอ + Telegram) อ่านจาก fleet_trip_rule_settings() ด้านล่าง
-- แก้ค่าที่ fleet_trip_rules() จุดเดียว ข้อความเปลี่ยนตามเอง ไม่ต้องแก้โค้ดหรือ deploy ซ้ำ

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fleet_trip_rules'::regproc)) <> 'df9bf7b5726e9b1317da25beb4b138ca' THEN
    RAISE EXCEPTION 'fleet_trip_rules() บน DB ไม่ตรงกับที่ 20260913150100 สร้างไว้ — schema drift ต้องตรวจก่อน apply';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.fleet_trip_rules()
 RETURNS TABLE(queue_buffer interval, max_auto_duration interval, past_grace interval)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- queue_buffer: คิวรถ/คนขับต้องห่างกันอย่างน้อยเท่านี้ ถึงจะอนุมัติอัตโนมัติ (เผื่อกลับช้า/ส่งกุญแจ)
  -- max_auto_duration: ขอนานกว่านี้ให้ผู้ดูแลพิจารณา
  -- past_grace: เวลาออกย้อนหลังได้ไม่เกินนี้ ถึงจะอนุมัติอัตโนมัติ
  -- ค่าทั้ง 3 เจ้าของระบบกำหนดเอง 2026-09-13
  SELECT interval '30 minutes', interval '30 days', interval '1 day'
$function$;

-- ค่ากติกาเป็นนาที ให้หน้าจอ/Telegram เติมตัวเลขในข้อความเหตุผลเอง
-- (interval เป็นข้อความรูปแบบ "1 day"/"00:30:00" parse ฝั่ง JS ไม่คงเส้นคงวา จึงแปลงเป็นนาทีที่นี่)
-- SECURITY DEFINER เพราะ fleet_trip_rules() ไม่ได้ GRANT ให้ authenticated — คืนแค่ค่าคงที่ ไม่มีข้อมูลราย อปท.
CREATE OR REPLACE FUNCTION public.fleet_trip_rule_settings()
 RETURNS TABLE(queue_buffer_minutes integer, max_auto_duration_minutes integer, past_grace_minutes integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT (extract(epoch FROM r.queue_buffer) / 60)::integer,
         (extract(epoch FROM r.max_auto_duration) / 60)::integer,
         (extract(epoch FROM r.past_grace) / 60)::integer
    FROM public.fleet_trip_rules() r
$function$;

REVOKE ALL ON FUNCTION public.fleet_trip_rule_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_trip_rule_settings() TO authenticated, service_role;
