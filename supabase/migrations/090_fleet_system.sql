-- ============================================================
-- 090_fleet_system.sql
-- ระบบบันทึกการใช้รถและเชื้อเพลิงเครื่องยนต์
-- ============================================================

-- ── 1. กอง/ส่วน ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_departments (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid          NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  code            text          NOT NULL,
  name            text          NOT NULL,
  short_name      text,
  sort_order      smallint      NOT NULL DEFAULT 0,
  is_active       boolean       NOT NULL DEFAULT true,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (municipality_id, code)
);

-- ── 2. ยานพาหนะ/เครื่องยนต์ ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_vehicles (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid          NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  department_id       uuid          REFERENCES public.fleet_departments(id),
  license_plate       text          NOT NULL,
  name                text          NOT NULL,
  vehicle_type        text          NOT NULL DEFAULT 'car',
  -- car | pickup | truck | van | excavator | backhoe | pump | generator | motorcycle | other
  brand               text,
  model               text,
  manufacture_year    smallint,
  fuel_type           text          NOT NULL DEFAULT 'diesel',
  -- gasoline | diesel | gas_lpg | electric | other
  tank_capacity       numeric(6,2),
  odometer_initial    numeric(10,2) NOT NULL DEFAULT 0,
  is_pool             boolean       NOT NULL DEFAULT false,
  status              text          NOT NULL DEFAULT 'active',
  -- active | inactive | under_repair | retired
  image_url           text,
  notes               text,
  -- เอกสารสำคัญ + วันหมดอายุ
  insurance_expiry    date,
  act_expiry          date,
  registration_expiry date,
  inspection_expiry   date,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

-- ── 3. ขยาย profiles ──────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fleet_department_id uuid REFERENCES public.fleet_departments(id),
  ADD COLUMN IF NOT EXISTS fleet_role text
    CHECK (fleet_role IN ('fleet_admin','fleet_staff','fleet_viewer'));

-- ── 4. บันทึกการเติมน้ำมัน ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_fuel_records (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid          NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  vehicle_id      uuid          NOT NULL REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
  driver_id       uuid          REFERENCES public.profiles(id),
  filled_at       date          NOT NULL DEFAULT CURRENT_DATE,
  odometer        numeric(10,2) NOT NULL,
  liters          numeric(8,3)  NOT NULL,
  price_per_liter numeric(6,2)  NOT NULL,
  total_cost      numeric(10,2) GENERATED ALWAYS AS (ROUND(liters * price_per_liter, 2)) STORED,
  full_tank       boolean       NOT NULL DEFAULT true,
  fuel_station    text,
  receipt_no      text,
  receipt_url     text,
  efficiency_kml  numeric(6,2), -- กม./ลิตร คำนวณจาก 2 full_tank ติดกัน
  is_anomaly      boolean       NOT NULL DEFAULT false,
  anomaly_reason  text,
  notes           text,
  created_by      uuid          REFERENCES public.profiles(id),
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- ── 5. บันทึกการเดินทาง/ออกรถ ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_trips (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid          NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  vehicle_id      uuid          NOT NULL REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
  driver_id       uuid          REFERENCES public.profiles(id),
  department_id   uuid          REFERENCES public.fleet_departments(id),
  trip_date       date          NOT NULL DEFAULT CURRENT_DATE,
  depart_time     time,
  return_time     time,
  odometer_start  numeric(10,2) NOT NULL,
  odometer_end    numeric(10,2),
  distance_km     numeric(8,2)  GENERATED ALWAYS AS
    (CASE WHEN odometer_end IS NOT NULL THEN GREATEST(odometer_end - odometer_start, 0) ELSE NULL END) STORED,
  destination     text          NOT NULL,
  purpose         text          NOT NULL,
  passengers      smallint      NOT NULL DEFAULT 1,
  status          text          NOT NULL DEFAULT 'draft',
  -- draft | pending | approved | rejected | completed
  approved_by     uuid          REFERENCES public.profiles(id),
  approved_at     timestamptz,
  reject_reason   text,
  notes           text,
  created_by      uuid          REFERENCES public.profiles(id),
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- ── 6. บันทึกซ่อมบำรุง ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_maintenance (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid          NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  vehicle_id          uuid          NOT NULL REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
  service_date        date          NOT NULL DEFAULT CURRENT_DATE,
  maintenance_type    text          NOT NULL DEFAULT 'routine',
  -- routine | oil_change | repair | inspection | tire | battery | other
  description         text          NOT NULL,
  cost                numeric(10,2) NOT NULL DEFAULT 0,
  vendor              text,
  odometer            numeric(10,2),
  next_service_km     numeric(10,2),
  next_service_date   date,
  receipt_url         text,
  created_by          uuid          REFERENCES public.profiles(id),
  created_at          timestamptz   NOT NULL DEFAULT now()
);

-- ── 7. จองรถ/ขอใช้รถ ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_bookings (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid          NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  vehicle_id      uuid          NOT NULL REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
  requester_id    uuid          NOT NULL REFERENCES public.profiles(id),
  department_id   uuid          REFERENCES public.fleet_departments(id),
  booking_date    date          NOT NULL,
  depart_time     time,
  return_time_est time,
  destination     text          NOT NULL,
  purpose         text          NOT NULL,
  passengers      smallint      NOT NULL DEFAULT 1,
  status          text          NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | cancelled | completed
  approved_by     uuid          REFERENCES public.profiles(id),
  approved_at     timestamptz,
  reject_reason   text,
  trip_id         uuid          REFERENCES public.fleet_trips(id),
  notes           text,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- ── 8. งบประมาณน้ำมันต่อกอง ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_budgets (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid          NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  department_id   uuid          NOT NULL REFERENCES public.fleet_departments(id) ON DELETE CASCADE,
  fiscal_year     smallint      NOT NULL,
  month           smallint      CHECK (month BETWEEN 1 AND 12),
  budget_amount   numeric(12,2) NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (department_id, fiscal_year, month)
);

-- ── 9. Audit Log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fleet_audit_log (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid          NOT NULL,
  table_name      text          NOT NULL,
  record_id       uuid          NOT NULL,
  action          text          NOT NULL,
  old_data        jsonb,
  new_data        jsonb,
  changed_by      uuid          REFERENCES public.profiles(id),
  changed_at      timestamptz   NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fveh_mun    ON public.fleet_vehicles(municipality_id, status);
CREATE INDEX IF NOT EXISTS idx_fveh_dept   ON public.fleet_vehicles(department_id);
CREATE INDEX IF NOT EXISTS idx_ffuel_veh   ON public.fleet_fuel_records(vehicle_id, filled_at DESC);
CREATE INDEX IF NOT EXISTS idx_ffuel_mun   ON public.fleet_fuel_records(municipality_id, filled_at DESC);
CREATE INDEX IF NOT EXISTS idx_ftrip_veh   ON public.fleet_trips(vehicle_id, trip_date DESC);
CREATE INDEX IF NOT EXISTS idx_ftrip_mun   ON public.fleet_trips(municipality_id, status);
CREATE INDEX IF NOT EXISTS idx_fmaint_veh  ON public.fleet_maintenance(vehicle_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_fbooking    ON public.fleet_bookings(municipality_id, booking_date, status);

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.fleet_departments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_vehicles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_fuel_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_trips        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_maintenance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_bookings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_budgets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_audit_log    ENABLE ROW LEVEL SECURITY;

-- Helper: ดึง fleet info ของ user ปัจจุบัน
CREATE OR REPLACE FUNCTION public.my_fleet()
RETURNS TABLE(mun_id uuid, frole text, fdept_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT municipality_id, fleet_role, fleet_department_id
  FROM public.profiles WHERE id = auth.uid()
$$;

-- fleet_departments: อ่านได้ทุก fleet user
CREATE POLICY "fdept_read" ON public.fleet_departments FOR SELECT
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) IS NOT NULL);
CREATE POLICY "fdept_write" ON public.fleet_departments FOR ALL
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin','superadmin'));

-- fleet_vehicles
CREATE POLICY "fveh_read" ON public.fleet_vehicles FOR SELECT
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) IS NOT NULL);
CREATE POLICY "fveh_write" ON public.fleet_vehicles FOR ALL
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) = 'fleet_admin');

-- fleet_fuel_records
CREATE POLICY "ffuel_read" ON public.fleet_fuel_records FOR SELECT
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (
       (SELECT frole FROM public.my_fleet()) IN ('fleet_admin','fleet_viewer')
       OR vehicle_id IN (
           SELECT id FROM public.fleet_vehicles
           WHERE department_id = (SELECT fdept_id FROM public.my_fleet()) OR is_pool
       )
     ));
CREATE POLICY "ffuel_insert" ON public.fleet_fuel_records FOR INSERT
  WITH CHECK (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) IN ('fleet_admin','fleet_staff'));
CREATE POLICY "ffuel_update" ON public.fleet_fuel_records FOR UPDATE
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (created_by = auth.uid()
          OR (SELECT frole FROM public.my_fleet()) = 'fleet_admin'));

-- fleet_trips
CREATE POLICY "ftrip_read" ON public.fleet_trips FOR SELECT
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (
       (SELECT frole FROM public.my_fleet()) IN ('fleet_admin','fleet_viewer')
       OR department_id = (SELECT fdept_id FROM public.my_fleet())
       OR created_by = auth.uid()
     ));
CREATE POLICY "ftrip_insert" ON public.fleet_trips FOR INSERT
  WITH CHECK (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) IN ('fleet_admin','fleet_staff'));
CREATE POLICY "ftrip_update" ON public.fleet_trips FOR UPDATE
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (created_by = auth.uid()
          OR (SELECT frole FROM public.my_fleet()) = 'fleet_admin'));

-- fleet_maintenance
CREATE POLICY "fmaint_read" ON public.fleet_maintenance FOR SELECT
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) IS NOT NULL);
CREATE POLICY "fmaint_write" ON public.fleet_maintenance FOR ALL
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) IN ('fleet_admin','fleet_staff'));

-- fleet_bookings
CREATE POLICY "fbook_read" ON public.fleet_bookings FOR SELECT
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (
       requester_id = auth.uid()
       OR (SELECT frole FROM public.my_fleet()) IN ('fleet_admin','fleet_viewer')
       OR department_id = (SELECT fdept_id FROM public.my_fleet())
     ));
CREATE POLICY "fbook_insert" ON public.fleet_bookings FOR INSERT
  WITH CHECK (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) IS NOT NULL);
CREATE POLICY "fbook_update" ON public.fleet_bookings FOR UPDATE
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (requester_id = auth.uid()
          OR (SELECT frole FROM public.my_fleet()) = 'fleet_admin'));

-- fleet_budgets
CREATE POLICY "fbudget_read" ON public.fleet_budgets FOR SELECT
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) IS NOT NULL);
CREATE POLICY "fbudget_write" ON public.fleet_budgets FOR ALL
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) = 'fleet_admin');

-- fleet_audit_log
CREATE POLICY "faudit_read" ON public.fleet_audit_log FOR SELECT
  USING (municipality_id = (SELECT mun_id FROM public.my_fleet())
     AND (SELECT frole FROM public.my_fleet()) = 'fleet_admin');
CREATE POLICY "faudit_insert" ON public.fleet_audit_log FOR INSERT
  WITH CHECK (municipality_id = (SELECT mun_id FROM public.my_fleet()));

-- ── ข้อมูลตั้งต้น: ฟังก์ชัน seed กอง ──────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_seed_departments(p_municipality_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.fleet_departments(municipality_id, code, name, short_name, sort_order)
  VALUES
    (p_municipality_id, 'exec',        'ผู้บริหาร',           'ผบ.',   0),
    (p_municipality_id, 'general',     'สำนักปลัด',           'สป.',   1),
    (p_municipality_id, 'finance',     'กองคลัง',             'กค.',   2),
    (p_municipality_id, 'engineering', 'กองช่าง',             'กช.',   3),
    (p_municipality_id, 'education',   'กองการศึกษา',          'กศ.',   4)
  ON CONFLICT (municipality_id, code) DO NOTHING;
END;
$$;
