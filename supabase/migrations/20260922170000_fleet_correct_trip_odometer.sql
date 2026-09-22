-- แก้เลขไมล์ของทริปที่เสร็จสิ้นแล้ว + ปรับทริปถัดไปที่ใช้เลขต่อกันทั้งชุด (เฉพาะผู้ดูแลระบบยานพาหนะ)
--
-- เคสจริง (2026-09-22): เลขไมล์กลับของทริปหนึ่งพิมพ์สลับหลัก 278,715 → 287,715 (ระยะ 9,009 กม.)
-- แล้ว fleet_vehicle_last_odometer (#170) เติมเลขผิดนั้นเป็นเลขออกของทริปถัดไป ผิดต่อกันอีก 3 ทริป
-- หน้าจอไม่มีทางแก้ทริปที่เสร็จแล้วเลย ต้องให้ผู้พัฒนาแก้ด้วย SQL ตรง ซึ่งร่องรอยใน fleet_audit_log
-- ไม่มีชื่อผู้แก้ (changed_by ว่าง) — ฟังก์ชันนี้ให้ผู้ดูแลของ อปท. แก้เองได้ พร้อมเหตุผลและชื่อผู้แก้จริง
--
-- ทำไมต้องเป็น RPC (SECURITY DEFINER) ไม่ใช่ UPDATE จากหน้าจอ
--   · "ชุดที่ต่อกัน" ต้องไล่จากทริปทั้งหมดของรถคันนั้น — รถส่วนกลางมีทริปจากกองอื่นที่ RLS บังไว้
--     และประวัติบนหน้าจอแบ่งหน้า (เหตุผลเดียวกับ fleet_vehicle_last_odometer / #170)
--   · ต้องแก้ทั้งชุดใน transaction เดียว พังครึ่งทางแล้วเลขไม่ต่อกันจะแย่กว่าเดิม
--
-- นิยาม "ชุดที่ต่อกัน": เดินจากทริปเป้าหมายไปทีละทริปของรถคันเดียวกัน เรียงตามเวลาที่เกิดจริง
-- (เวลากลับ > เวลาออก > วันที่) แบบเดียวกับ fleet_vehicle_last_odometer รับทริปถัดไปเข้าชุดเมื่อ
-- เลขออกเท่ากับเลขกลับ "ค่าเดิม" ของทริปก่อนหน้าพอดี หยุดที่จุดแรกที่ไม่ต่อกัน — ทริปนั้นคนกรอกเลข
-- เองจากหน้าปัด ไม่ได้ลอกเลขผิดต่อมา ทุกทริปในชุดเลื่อนด้วยค่าเดียวกัน delta = เลขกลับใหม่ − เลขกลับเดิม
--
-- p_dry_run = true คืนรายการที่จะเปลี่ยนเฉยๆ ให้หน้าจอแสดงก่อนกดยืนยัน
-- ค่าเริ่มต้นเป็น dry run เพื่อให้การเรียกที่ลืมส่งพารามิเตอร์ไม่เขียนข้อมูล
--
-- ร่องรอย: trg_fleet_trips_audit เก็บค่าเดิม/ใหม่ทุกแถวลง fleet_audit_log (changed_by = ผู้เรียก)
-- และฟังก์ชันนี้เขียน audit_logs 1 แถวต่อการแก้ 1 ครั้ง พร้อมเหตุผลและรายการที่เปลี่ยนทั้งชุด

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fleet_is_manager') THEN
    RAISE EXCEPTION 'ไม่พบ fleet_is_manager — schema drift ต้องตรวจก่อน apply';
  END IF;
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง audit_logs — schema drift ต้องตรวจก่อน apply';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.fleet_correct_trip_odometer(
  p_trip uuid,
  p_start numeric,
  p_end numeric,
  p_reason text DEFAULT NULL,
  p_shift_following boolean DEFAULT true,
  p_dry_run boolean DEFAULT true
)
 RETURNS TABLE(
   trip_id uuid,
   trip_date date,
   trip_status text,
   old_start numeric,
   old_end numeric,
   new_start numeric,
   new_end numeric,
   is_target boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_target public.fleet_trips%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_delta numeric;
  v_prev_end numeric;
  v_row record;
  v_changes jsonb;
  v_vehicle_label text;
  v_actor_name text;
  v_actor_role text;
BEGIN
  -- ล็อกแถวเป้าหมายก่อน กันผู้ดูแลสองคนแก้ทริปเดียวกันพร้อมกัน
  SELECT t.* INTO v_target FROM public.fleet_trips t WHERE t.id = p_trip FOR UPDATE;
  -- error เดียวกันทั้ง "ไม่มีทริปนี้" และ "ไม่มีสิทธิ์" — กันใช้ RPC สืบ trip id ของ อปท. อื่น
  IF v_target.id IS NULL OR NOT public.fleet_is_manager(v_target.municipality_id) THEN
    RAISE EXCEPTION 'FLEET_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  -- ทริปที่กำลังเดินทางแก้เลขออกได้ที่หน้าบันทึกกลับอยู่แล้ว ที่นี่รับเฉพาะรายการที่ปิดแล้ว
  IF v_target.status <> 'completed' THEN
    RAISE EXCEPTION 'FLEET_ODOMETER_FIX_REQUIRES_COMPLETED' USING ERRCODE = '22023';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_start < 0 OR p_end < p_start THEN
    RAISE EXCEPTION 'FLEET_ODOMETER_FIX_INVALID_RANGE' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(p_dry_run, true) AND char_length(v_reason) NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'FLEET_ODOMETER_FIX_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- เลขกลับเดิมว่าง = ไม่มีเลขให้ทริปถัดไปลอกต่อ จึงไม่มีชุดให้ปรับตาม
  v_delta := p_end - v_target.odometer_end;

  trip_id     := v_target.id;
  trip_date   := v_target.trip_date;
  trip_status := v_target.status;
  old_start   := v_target.odometer_start;
  old_end     := v_target.odometer_end;
  new_start   := p_start;
  new_end     := p_end;
  is_target   := true;
  RETURN NEXT;
  v_changes := jsonb_build_array(jsonb_build_object(
    'id', v_target.id, 'trip_date', v_target.trip_date,
    'old', jsonb_build_array(v_target.odometer_start, v_target.odometer_end),
    'new', jsonb_build_array(p_start, p_end)
  ));

  IF NOT coalesce(p_dry_run, true) THEN
    UPDATE public.fleet_trips t
       SET odometer_start = p_start,
           odometer_end   = p_end
     WHERE t.id = v_target.id;
  END IF;

  IF coalesce(p_shift_following, true) AND v_delta IS NOT NULL AND v_delta <> 0 THEN
    v_prev_end := v_target.odometer_end;
    FOR v_row IN
      SELECT t.id, t.trip_date, t.status, t.odometer_start, t.odometer_end
        FROM public.fleet_trips t
       WHERE t.vehicle_id = v_target.vehicle_id
         AND t.municipality_id = v_target.municipality_id
         AND t.id <> v_target.id
         AND t.status IN ('completed', 'in_progress')
         AND t.odometer_start IS NOT NULL
         AND (COALESCE(t.returned_at, t.started_at, t.trip_date::timestamptz), t.created_at)
             > (COALESCE(v_target.returned_at, v_target.started_at, v_target.trip_date::timestamptz), v_target.created_at)
       ORDER BY COALESCE(t.returned_at, t.started_at, t.trip_date::timestamptz), t.created_at
       FOR UPDATE
    LOOP
      -- ทริปนี้ไม่ได้เริ่มจากเลขกลับ (เดิม) ของทริปก่อนหน้า = คนกรอกเลขเองจากหน้าปัด ชุดจบตรงนี้
      EXIT WHEN v_row.odometer_start IS DISTINCT FROM v_prev_end;
      IF v_row.odometer_start + v_delta < 0 THEN
        RAISE EXCEPTION 'FLEET_ODOMETER_FIX_NEGATIVE' USING ERRCODE = '22023';
      END IF;

      trip_id     := v_row.id;
      trip_date   := v_row.trip_date;
      trip_status := v_row.status;
      old_start   := v_row.odometer_start;
      old_end     := v_row.odometer_end;
      new_start   := v_row.odometer_start + v_delta;
      new_end     := v_row.odometer_end + v_delta;   -- ทริปที่ยังไม่กลับ end ว่าง = ว่างต่อไป
      is_target   := false;
      RETURN NEXT;
      v_changes := v_changes || jsonb_build_object(
        'id', v_row.id, 'trip_date', v_row.trip_date,
        'old', jsonb_build_array(v_row.odometer_start, v_row.odometer_end),
        'new', jsonb_build_array(v_row.odometer_start + v_delta, v_row.odometer_end + v_delta)
      );

      IF NOT coalesce(p_dry_run, true) THEN
        UPDATE public.fleet_trips t
           SET odometer_start = v_row.odometer_start + v_delta,
               odometer_end   = v_row.odometer_end + v_delta
         WHERE t.id = v_row.id;
      END IF;

      -- ทริปที่ยังไม่กลับเป็นทริปสุดท้ายของรถเสมอ ไม่มีเลขกลับให้ทริปถัดไปลอกต่อ
      EXIT WHEN v_row.odometer_end IS NULL;
      v_prev_end := v_row.odometer_end;
    END LOOP;
  END IF;

  IF NOT coalesce(p_dry_run, true) THEN
    SELECT v.name || ' ' || v.license_plate INTO v_vehicle_label
      FROM public.fleet_vehicles v WHERE v.id = v_target.vehicle_id;
    SELECT p.full_name, p.role INTO v_actor_name, v_actor_role
      FROM public.profiles p WHERE p.id = auth.uid();
    INSERT INTO public.audit_logs (
      municipality_id, actor_id, actor_name, actor_role, action,
      resource_type, resource_id, resource_label, metadata
    ) VALUES (
      v_target.municipality_id, auth.uid(), coalesce(v_actor_name, 'unknown'), coalesce(v_actor_role, 'unknown'),
      'update', 'fleet_trip', v_target.id::text,
      coalesce(v_vehicle_label, '') || ' — แก้เลขไมล์ย้อนหลัง',
      jsonb_build_object(
        'reason', v_reason,
        'delta_km', v_delta,
        'shift_following', coalesce(p_shift_following, true),
        'trips', v_changes
      )
    );
  END IF;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.fleet_correct_trip_odometer(uuid, numeric, numeric, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_correct_trip_odometer(uuid, numeric, numeric, text, boolean, boolean) TO authenticated;
