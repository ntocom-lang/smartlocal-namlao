-- ถอดเกณฑ์ "อัตราสิ้นเปลืองผิดปกติ" ออกจากค่าที่ อปท. แก้เองได้
--
-- ปัญหาของ migration 20260830180000: เกณฑ์ผูกกับ fleet_vehicles.vehicle_type ด้วย
-- CASE WHEN 'truck' / 'excavator' / 'backhoe' แต่ค่าเหล่านี้ไม่ใช่ค่าคงที่ของระบบ —
-- มาจากตาราง fleet_vehicle_types ซึ่งแต่ละ อปท. เพิ่ม/ลบเองได้จากหน้าจอ
--
-- สองเคสที่ทำให้เกณฑ์เงียบหายไปโดยไม่มีสัญญาณเตือน (พบจริงตอนตรวจ):
--   1. อปท. ลบประเภทมาตรฐานทิ้ง — เทศบาลตำบลน้ำเลาลบ 'truck' ออกไปแล้ว
--      รถบรรทุกน้ำจึงถูกตั้งเป็น 'car' และใช้เกณฑ์รถเก๋ง
--   2. ปุ่ม "เพิ่มประเภท" ในหน้าจอสร้าง value เป็น 'vt_' + timestamp (ค่าสุ่ม)
--      ประเภทที่ อปท. เพิ่มเองจึงไม่มีทางตรงกับ CASE ได้เลย
--      อปท. ที่เพิ่ม "รถขยะ" หรือ "รถดับเพลิง" เองจะได้เกณฑ์ 3–30 กม./ล.
--      ทั้งที่รถพวกนี้วิ่งจริง 2–4 → ติดธง "ผิดปกติ" ทุกครั้งที่เติมน้ำมัน
--      จนเจ้าหน้าที่ชินแล้วเลิกสนใจธง ซึ่งทำให้ธงที่ผิดปกติจริงถูกมองข้ามไปด้วย
--
-- แนวทาง: ให้ตั้งช่วงที่ยอมรับได้ "ต่อคัน" ได้โดยตรง (efficiency_min/max)
--   - ตั้งค่าไว้  → ใช้ค่านั้น ไม่สนใจว่า vehicle_type จะเป็นอะไร
--   - ปล่อยว่าง  → ใช้ค่าเริ่มต้นตามประเภทเหมือนเดิม (ของเดิมยังทำงานต่อ ไม่ต้องไล่ตั้งใหม่ทุกคัน)
-- ค่าต่อคันเป็นข้อมูลของ อปท. เอง ไม่ใช่ค่าที่ hardcode ในโค้ด จึงไม่พังเมื่อมีการแก้ประเภทรถ

ALTER TABLE public.fleet_vehicles
  ADD COLUMN IF NOT EXISTS efficiency_min numeric(6,2),
  ADD COLUMN IF NOT EXISTS efficiency_max numeric(6,2);

COMMENT ON COLUMN public.fleet_vehicles.efficiency_min IS
  'ขอบล่างอัตราสิ้นเปลืองที่ยอมรับได้ (กม./ล.) ปล่อยว่าง = ใช้ค่าเริ่มต้นตามประเภทรถ';
COMMENT ON COLUMN public.fleet_vehicles.efficiency_max IS
  'ขอบบนอัตราสิ้นเปลืองที่ยอมรับได้ (กม./ล.) ปล่อยว่าง = ใช้ค่าเริ่มต้นตามประเภทรถ';

-- กันค่าที่กรอกกลับหัวหรือติดลบตั้งแต่ระดับฐานข้อมูล ไม่ต้องพึ่ง validation ฝั่งหน้าจออย่างเดียว
ALTER TABLE public.fleet_vehicles
  DROP CONSTRAINT IF EXISTS fleet_vehicles_efficiency_range_check;
ALTER TABLE public.fleet_vehicles
  ADD CONSTRAINT fleet_vehicles_efficiency_range_check CHECK (
    (efficiency_min IS NULL OR efficiency_min > 0)
    AND (efficiency_max IS NULL OR efficiency_max > 0)
    AND (efficiency_min IS NULL OR efficiency_max IS NULL OR efficiency_max > efficiency_min)
  );

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
  v_min_override numeric;
  v_max_override numeric;
  v_prev_meter   numeric;
  v_prev_full    boolean;
  v_distance     numeric;
  v_eff          numeric;
  v_eff_min      numeric;
  v_eff_max      numeric;
  v_reasons      text[] := ARRAY[]::text[];
BEGIN
  SELECT meter_unit, vehicle_type, tank_capacity, efficiency_min, efficiency_max
    INTO v_meter_unit, v_vehicle_type, v_tank, v_min_override, v_max_override
    FROM public.fleet_vehicles
   WHERE id = NEW.vehicle_id;

  -- ค่าเริ่มต้นตามประเภทรถ ใช้เมื่อ อปท. ไม่ได้ตั้งค่าต่อคันไว้
  CASE v_vehicle_type
    WHEN 'motorcycle' THEN v_eff_min := 15;  v_eff_max := 90;   -- จยย. 40–60 เป็นเรื่องปกติ
    WHEN 'truck'      THEN v_eff_min := 0.5; v_eff_max := 15;   -- รถบรรทุก/รถบรรทุกน้ำ/รถขยะ
    WHEN 'excavator'  THEN v_eff_min := 0.5; v_eff_max := 15;
    WHEN 'backhoe'    THEN v_eff_min := 0.5; v_eff_max := 15;
    ELSE                   v_eff_min := 3;   v_eff_max := 30;   -- รถเก๋ง/กระบะ/ตู้/ประเภทที่ตั้งเอง
  END CASE;

  -- ค่าที่ตั้งไว้ต่อคันชนะเสมอ ตั้งแยกข้างเดียวก็ได้
  v_eff_min := COALESCE(v_min_override, v_eff_min);
  v_eff_max := COALESCE(v_max_override, v_eff_max);

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
        v_reasons := v_reasons || format('อัตราสิ้นเปลือง %s กม./ล. อยู่นอกช่วงที่ยอมรับได้ของรถคันนี้ (%s–%s)',
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

-- คำนวณธงใหม่ทั้งชุด (ปิด trigger updated_at ชั่วคราวเหมือน migration ก่อนหน้า
-- ไม่งั้นระเบียนเก่าทุกแถวจะถูกประทับว่า "ถูกแก้ไข" ทั้งที่เป็นการคำนวณของระบบ)
ALTER TABLE public.fleet_fuel_records DISABLE TRIGGER trg_fleet_fuel_records_updated_at;
UPDATE public.fleet_fuel_records SET odometer = odometer;
ALTER TABLE public.fleet_fuel_records ENABLE TRIGGER trg_fleet_fuel_records_updated_at;
