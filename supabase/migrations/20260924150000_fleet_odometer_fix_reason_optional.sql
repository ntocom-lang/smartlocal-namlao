-- ช่อง "เหตุผลที่แก้" ของปุ่มแก้เลขไมล์ย้อนหลัง (ผู้ดูแล) ไม่บังคับแล้ว — เจ้าของระบบสั่ง 2026-09-24
-- ระหว่างตามแก้เลขไมล์ของรถ กค 9700 (น้ำเลา) ที่โซ่เลขไมล์ขาด (#288)
--
-- ร่องรอยที่ยังครบโดยไม่ต้องมีเหตุผล: trg_fleet_trips_audit เก็บค่าเดิม/ค่าใหม่ทุกแถวลง fleet_audit_log
-- (changed_by = ผู้แก้จริง) และฟังก์ชันนี้เขียน audit_logs 1 แถว มีชื่อผู้แก้ + รายการที่เปลี่ยนทั้งชุด
-- ถ้ากรอกเหตุผลมา ยังเก็บและจำกัด 300 ตัวอักษรเหมือนเดิม ไม่กรอกเก็บเป็น null (ไม่ใช่สตริงว่าง)
--
-- CREATE OR REPLACE ทั้งตัว คัดจาก 20260922170000 ทุกบรรทัด แก้เฉพาะด่านเหตุผลกับค่าที่เก็บ
-- ตรวจ hash ก่อน ถ้าบน production ไม่ตรงกับตัวที่คัดมา = มีคนแก้ไปแล้ว ต้องหยุดไล่ drift ก่อน

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fleet_correct_trip_odometer(uuid,numeric,numeric,text,boolean,boolean)'::regprocedure))
     <> '3d5c6018916b6d35e9c4b2806c2ff52f' THEN
    RAISE EXCEPTION 'fleet_correct_trip_odometer บน DB ไม่ตรงกับ 20260922170000 — schema drift ต้องตรวจก่อน apply';
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
  -- เหตุผลไม่บังคับแล้ว (เจ้าของระบบสั่ง 2026-09-24) — ร่องรอยหลักคือค่าเดิม/ค่าใหม่/ผู้แก้/เวลา
  -- ซึ่ง fleet_audit_log กับ audit_logs เก็บให้เองทุกครั้ง ถ้ากรอกมาจำกัดความยาวไว้เท่าเดิม
  IF char_length(v_reason) > 300 THEN
    RAISE EXCEPTION 'FLEET_ODOMETER_FIX_REASON_TOO_LONG' USING ERRCODE = '22023';
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
        'reason', nullif(v_reason, ''),
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
