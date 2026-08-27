-- ปรับเกณฑ์ "อัตราสิ้นเปลืองผิดปกติ" ให้แยกตามประเภทรถ
--
-- ปัญหาของเกณฑ์เดิม (1–40 กม./ล. ใช้กับรถทุกประเภท) ที่พบตอนทดสอบ:
--   - มอเตอร์ไซค์วิ่งจริง 40–60 กม./ล. → จะถูกติดธง "ผิดปกติ" แทบทุกรายการ
--     เทศบาลตำบลน้ำเลามีรถจักรยานยนต์ 2 คัน จะเจอทันทีที่เริ่มบันทึกน้ำมัน
--   - รถบรรทุกน้ำ/รถกระเช้า/แบคโฮ วิ่งจริง 2–4 กม./ล. ซึ่งขอบล่าง 1 หลวมเกินไป
--     ค่าที่ผิดจริงจะรอดสายตา
--
-- ธงที่ขึ้นพร่ำเพรื่อมีต้นทุนสูงกว่าที่คิด: พอเจ้าหน้าที่ชินว่า "ขึ้นแดงตลอด ไม่เป็นไร"
-- ธงที่ผิดปกติจริงก็จะถูกมองข้ามไปด้วย เกณฑ์จึงต้องแคบพอที่จะมีความหมาย
--
-- ค่าที่ตั้งเป็นช่วงกว้างเชิงวิศวกรรม (ความเห็นเชิงวิชาชีพ ไม่ใช่ค่ามาตรฐานตามระเบียบ)
-- เจตนาให้จับ "กรอกผิดหลัก/สลับตัวเลข" ไม่ใช่จับรถที่กินน้ำมันมากกว่าปกติเล็กน้อย
-- ถ้า อปท. ไหนมีรถที่ค่าจริงหลุดช่วง ปรับที่ CASE ด้านล่างได้เลย

CREATE OR REPLACE FUNCTION public.fleet_fuel_compute_efficiency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meter_unit   text;
  v_vehicle_type text;
  v_tank         numeric;
  v_prev_meter   numeric;
  v_prev_full    boolean;
  v_distance     numeric;
  v_eff          numeric;
  v_eff_min      numeric;
  v_eff_max      numeric;
  v_reasons      text[] := ARRAY[]::text[];
BEGIN
  SELECT meter_unit, vehicle_type, tank_capacity
    INTO v_meter_unit, v_vehicle_type, v_tank
    FROM public.fleet_vehicles
   WHERE id = NEW.vehicle_id;

  -- ช่วงอัตราสิ้นเปลืองที่ถือว่า "เป็นไปได้" ต่อประเภทรถ
  CASE v_vehicle_type
    WHEN 'motorcycle' THEN v_eff_min := 15;  v_eff_max := 90;   -- จยย. 40–60 เป็นเรื่องปกติ
    WHEN 'truck'      THEN v_eff_min := 0.5; v_eff_max := 15;   -- รถบรรทุก/รถบรรทุกน้ำ/รถขยะ
    WHEN 'excavator'  THEN v_eff_min := 0.5; v_eff_max := 15;
    WHEN 'backhoe'    THEN v_eff_min := 0.5; v_eff_max := 15;
    ELSE                   v_eff_min := 3;   v_eff_max := 30;   -- รถเก๋ง/กระบะ/ตู้/อื่นๆ
  END CASE;

  -- ระเบียนก่อนหน้าของรถคันเดียวกันในหน่วยงานเดียวกัน
  -- เรียงด้วย (filled_at, created_at) เพื่อให้ชี้ขาดแม้เติมหลายครั้งในวันเดียวกัน
  SELECT odometer, full_tank
    INTO v_prev_meter, v_prev_full
    FROM public.fleet_fuel_records
   WHERE vehicle_id = NEW.vehicle_id
     AND municipality_id = NEW.municipality_id
     AND id <> NEW.id
     AND (filled_at, created_at) < (NEW.filled_at, COALESCE(NEW.created_at, now()))
   ORDER BY filled_at DESC, created_at DESC
   LIMIT 1;

  NEW.efficiency_kml := NULL;

  IF v_prev_meter IS NOT NULL THEN
    v_distance := NEW.odometer - v_prev_meter;

    IF v_distance < 0 THEN
      v_reasons := v_reasons || format('มิเตอร์ถอยหลัง (ครั้งก่อน %s → ครั้งนี้ %s)',
                                       round(v_prev_meter), round(NEW.odometer));
    ELSIF v_distance = 0 THEN
      v_reasons := v_reasons || 'มิเตอร์เท่าเดิมกับการเติมครั้งก่อน';
    ELSIF COALESCE(v_meter_unit, 'km') = 'km' AND v_distance > 5000 THEN
      v_reasons := v_reasons || format('ระยะทางจากการเติมครั้งก่อนสูงผิดปกติ (%s กม.)', round(v_distance));
    ELSIF COALESCE(v_meter_unit, 'km') = 'hour' AND v_distance > 500 THEN
      v_reasons := v_reasons || format('ชั่วโมงทำงานจากการเติมครั้งก่อนสูงผิดปกติ (%s ชม.)', round(v_distance));
    END IF;

    -- อัตราสิ้นเปลืองแบบ full-to-full: ใช้ได้ต่อเมื่อเติมเต็มถังทั้งครั้งก่อนและครั้งนี้
    -- (ถ้าครั้งใดครั้งหนึ่งเติมไม่เต็ม ระยะทางกับลิตรจะไม่สอดคล้องกัน คำนวณแล้วได้ค่าหลอก)
    IF COALESCE(v_meter_unit, 'km') = 'km'
       AND COALESCE(v_prev_full, false) AND COALESCE(NEW.full_tank, false)
       AND v_distance > 0 AND NEW.liters > 0 THEN
      v_eff := round(v_distance / NEW.liters, 2);
      IF v_eff <= 9999.99 THEN               -- efficiency_kml เป็น numeric(6,2)
        NEW.efficiency_kml := v_eff;
      END IF;
      IF v_eff < v_eff_min OR v_eff > v_eff_max THEN
        v_reasons := v_reasons || format('อัตราสิ้นเปลือง %s กม./ล. อยู่นอกช่วงที่เป็นไปได้ของรถประเภทนี้ (%s–%s)',
                                         v_eff, v_eff_min, v_eff_max);
      END IF;
    END IF;
  END IF;

  -- เติมเกินความจุถัง (เผื่อ 10% สำหรับถังสำรอง/ความคลาดเคลื่อนของหัวจ่าย)
  -- = กรอกผิด หรือเติมลงภาชนะอื่น ซึ่งเป็นประเด็นที่ผู้ตรวจสอบต้องเห็น
  IF v_tank IS NOT NULL AND v_tank > 0 AND NEW.liters > v_tank * 1.1 THEN
    v_reasons := v_reasons || format('ปริมาณ %s ล. เกินความจุถัง %s ล.', round(NEW.liters, 2), round(v_tank, 2));
  END IF;

  IF array_length(v_reasons, 1) IS NULL THEN
    NEW.is_anomaly     := false;
    NEW.anomaly_reason := NULL;
  ELSE
    NEW.is_anomaly     := true;
    NEW.anomaly_reason := array_to_string(v_reasons, ' · ');
  END IF;

  RETURN NEW;
END;
$$;

-- คำนวณธงใหม่ทั้งชุดด้วยเกณฑ์ใหม่ (ปิด trigger updated_at ชั่วคราวเหมือน migration ก่อนหน้า
-- ไม่งั้นระเบียนเก่าทุกแถวจะถูกประทับว่า "ถูกแก้ไข" ทั้งที่เป็นการคำนวณของระบบ)
ALTER TABLE public.fleet_fuel_records DISABLE TRIGGER trg_fleet_fuel_records_updated_at;
UPDATE public.fleet_fuel_records SET odometer = odometer;
ALTER TABLE public.fleet_fuel_records ENABLE TRIGGER trg_fleet_fuel_records_updated_at;
