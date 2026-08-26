-- ตรวจจับข้อมูลเติมเชื้อเพลิงที่ผิดปกติ + คำนวณอัตราสิ้นเปลืองอัตโนมัติ
--
-- ปัญหาเดิม: ตาราง fleet_fuel_records มีคอลัมน์ efficiency_kml / is_anomaly / anomaly_reason
-- มาตั้งแต่ migration 090 และหน้าจอ FleetFuelLog ก็แสดงป้าย "ผิดปกติ" กับตัวเลข กม./ล. ไว้แล้ว
-- แต่ไม่มีโค้ดหรือ trigger ที่ไหนเขียนค่าลงคอลัมน์เหล่านี้เลย → ป้ายไม่เคยขึ้น ตัวเลขไม่เคยแสดง
-- และไม่มีการตรวจว่าเลขไมล์ถอยหลังหรือไม่ กรอกเลขไมล์ผิดหลักเดียว
-- อัตราสิ้นเปลืองของรถทั้งคันเพี้ยนโดยไม่มีสัญญาณเตือน ซึ่งตัวเลขนี้ถูกใช้ประกอบรายงาน
--
-- แนวทาง: ไม่ "บล็อก" การบันทึก แต่ "ตั้งธงให้คนตรวจ"
--   เลขไมล์ถอยหลังมีกรณีที่ถูกต้องจริง (เปลี่ยนมิเตอร์/เรือนไมล์ใหม่) ถ้าบล็อกแข็ง
--   เจ้าหน้าที่จะเลี่ยงด้วยการกรอกตัวเลขมั่วให้ผ่าน ซึ่งแย่กว่าการปล่อยผ่านแล้วติดธงไว้
--
-- ข้อจำกัดที่ยอมรับไว้: ค่าถูกคำนวณ ณ ตอนบันทึกจาก "ระเบียนก่อนหน้า" เท่านั้น
--   ถ้ามีการแก้ไขหรือลบระเบียนเก่าย้อนหลัง ระเบียนถัดไปจะไม่ถูกคำนวณใหม่ให้อัตโนมัติ
--   (จงใจไม่ทำ cascade เพราะการไล่ UPDATE ต่อกันจะไปกระตุ้น trg_fleet_fuel_records_updated_at
--    ทำให้ระเบียนที่ไม่มีใครแตะถูกประทับว่า "ถูกแก้ไข" — เสียร่องรอยการตรวจสอบมากกว่าที่ได้)
--   ถ้าต้องคำนวณใหม่ทั้งชุด ให้รันบล็อก backfill ท้ายไฟล์นี้ซ้ำ

-- ── 1. ฟังก์ชันคำนวณ ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_fuel_compute_efficiency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meter_unit text;
  v_tank       numeric;
  v_prev_meter numeric;
  v_prev_full  boolean;
  v_distance   numeric;
  v_eff        numeric;
  v_reasons    text[] := ARRAY[]::text[];
BEGIN
  SELECT meter_unit, tank_capacity
    INTO v_meter_unit, v_tank
    FROM public.fleet_vehicles
   WHERE id = NEW.vehicle_id;

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
      IF v_eff < 1 OR v_eff > 40 THEN
        v_reasons := v_reasons || format('อัตราสิ้นเปลือง %s กม./ล. อยู่นอกช่วงที่เป็นไปได้', v_eff);
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

REVOKE ALL ON FUNCTION public.fleet_fuel_compute_efficiency() FROM PUBLIC;

-- ── 2. ผูก trigger ──────────────────────────────────────────
-- ชื่อขึ้นต้น trg_fleet_fuel_a... เพื่อให้ทำงานก่อน trg_fleet_fuel_records_updated_at
-- (PostgreSQL เรียง BEFORE row trigger ตามชื่อ) แม้ทั้งสองตัวจะแตะคนละคอลัมน์ก็ตาม
DROP TRIGGER IF EXISTS trg_fleet_fuel_anomaly ON public.fleet_fuel_records;
CREATE TRIGGER trg_fleet_fuel_anomaly
  BEFORE INSERT OR UPDATE ON public.fleet_fuel_records
  FOR EACH ROW EXECUTE FUNCTION public.fleet_fuel_compute_efficiency();

-- ── 3. Backfill ระเบียนเดิม ─────────────────────────────────
-- ปิด trigger updated_at ชั่วคราว ไม่งั้นระเบียนเก่าทุกแถวจะถูกประทับว่า "ถูกแก้ไข"
-- ทั้งที่เป็นแค่การคำนวณย้อนหลังของระบบ (ใช้วิธีเดียวกับ migration 20260816182000)
ALTER TABLE public.fleet_fuel_records DISABLE TRIGGER trg_fleet_fuel_records_updated_at;
UPDATE public.fleet_fuel_records SET odometer = odometer;
ALTER TABLE public.fleet_fuel_records ENABLE TRIGGER trg_fleet_fuel_records_updated_at;

COMMENT ON COLUMN public.fleet_fuel_records.efficiency_kml IS
  'กม./ลิตร คำนวณอัตโนมัติจากระเบียนก่อนหน้าแบบ full-to-full (ต้องเต็มถังทั้งสองครั้ง) — ตั้งค่าโดย trg_fleet_fuel_anomaly';
COMMENT ON COLUMN public.fleet_fuel_records.is_anomaly IS
  'ธงข้อมูลผิดปกติ ตั้งอัตโนมัติโดย trg_fleet_fuel_anomaly (มิเตอร์ถอยหลัง/ระยะทางผิดปกติ/ลิตรเกินความจุถัง/อัตราสิ้นเปลืองนอกช่วง)';
COMMENT ON COLUMN public.fleet_fuel_records.anomaly_reason IS
  'เหตุผลที่ถูกตั้งธงผิดปกติ ตั้งอัตโนมัติโดย trg_fleet_fuel_anomaly';
