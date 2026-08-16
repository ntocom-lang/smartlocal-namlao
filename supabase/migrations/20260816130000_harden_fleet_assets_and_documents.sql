-- ============================================================
-- Production hardening: ระบบยานพาหนะ/เครื่องยนต์และเชื้อเพลิง
-- - รองรับยานพาหนะ เครื่องยนต์ และครุภัณฑ์ที่ไม่มีทะเบียนรถ
-- - ตรวจสอบค่าตัวเลขและลำดับเลขไมล์ที่ฐานข้อมูล
-- - จำกัด fleet_staff ตามกอง/ทรัพย์สินที่ได้รับอนุญาต
-- - เพิ่ม audit trigger และ private storage สำหรับเอกสารประกอบ
-- ============================================================

BEGIN;

-- ── 1. Asset model (ย้อนหลังเข้ากันได้กับ fleet_vehicles) ────────────────
ALTER TABLE public.fleet_vehicles
  ADD COLUMN IF NOT EXISTS asset_kind text NOT NULL DEFAULT 'vehicle',
  ADD COLUMN IF NOT EXISTS asset_code text,
  ADD COLUMN IF NOT EXISTS meter_unit text NOT NULL DEFAULT 'km',
  ADD COLUMN IF NOT EXISTS legacy_source text,
  ADD COLUMN IF NOT EXISTS legacy_key text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- เครื่องยนต์/ครุภัณฑ์ไม่มีทะเบียนรถได้ แต่ต้องมีรหัสครุภัณฑ์
ALTER TABLE public.fleet_vehicles
  ALTER COLUMN license_plate DROP NOT NULL;

UPDATE public.fleet_vehicles
SET asset_kind = CASE
  WHEN vehicle_type IN ('pump', 'generator') THEN 'engine'
  ELSE 'vehicle'
END
WHERE asset_kind IS NULL OR asset_kind NOT IN ('vehicle', 'engine', 'equipment');

UPDATE public.fleet_vehicles
SET meter_unit = CASE
  WHEN asset_kind IN ('engine', 'equipment') THEN 'hour'
  ELSE 'km'
END
WHERE meter_unit IS NULL OR meter_unit NOT IN ('km', 'hour');

UPDATE public.fleet_vehicles
SET license_plate = NULL
WHERE license_plate IS NOT NULL AND btrim(license_plate) = '';

ALTER TABLE public.fleet_vehicles
  DROP CONSTRAINT IF EXISTS fleet_vehicles_asset_kind_check,
  DROP CONSTRAINT IF EXISTS fleet_vehicles_meter_unit_check,
  DROP CONSTRAINT IF EXISTS fleet_vehicles_identifier_check,
  DROP CONSTRAINT IF EXISTS fleet_vehicles_meter_initial_nonnegative,
  DROP CONSTRAINT IF EXISTS fleet_vehicles_tank_capacity_positive;

ALTER TABLE public.fleet_vehicles
  ADD CONSTRAINT fleet_vehicles_asset_kind_check
    CHECK (asset_kind IN ('vehicle', 'engine', 'equipment')),
  ADD CONSTRAINT fleet_vehicles_meter_unit_check
    CHECK (meter_unit IN ('km', 'hour')),
  ADD CONSTRAINT fleet_vehicles_identifier_check
    CHECK (
      (asset_kind = 'vehicle' AND NULLIF(btrim(license_plate), '') IS NOT NULL)
      OR
      (asset_kind IN ('engine', 'equipment') AND NULLIF(btrim(asset_code), '') IS NOT NULL)
    ) NOT VALID,
  ADD CONSTRAINT fleet_vehicles_meter_initial_nonnegative
    CHECK (odometer_initial >= 0) NOT VALID,
  ADD CONSTRAINT fleet_vehicles_tank_capacity_positive
    CHECK (tank_capacity IS NULL OR tank_capacity > 0) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_vehicle_plate_normalized
  ON public.fleet_vehicles (
    municipality_id,
    lower(regexp_replace(license_plate, '\s+', '', 'g'))
  )
  WHERE asset_kind = 'vehicle' AND NULLIF(btrim(license_plate), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_asset_code_normalized
  ON public.fleet_vehicles (
    municipality_id,
    lower(regexp_replace(asset_code, '\s+', '', 'g'))
  )
  WHERE NULLIF(btrim(asset_code), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_vehicle_legacy_key
  ON public.fleet_vehicles (municipality_id, legacy_source, legacy_key)
  WHERE NULLIF(btrim(legacy_source), '') IS NOT NULL
    AND NULLIF(btrim(legacy_key), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_asset_kind
  ON public.fleet_vehicles (municipality_id, asset_kind, status);

COMMENT ON COLUMN public.fleet_vehicles.asset_kind IS
  'ชนิดทรัพย์สิน: vehicle=ยานพาหนะ, engine=เครื่องยนต์, equipment=ครุภัณฑ์';
COMMENT ON COLUMN public.fleet_vehicles.asset_code IS
  'รหัสครุภัณฑ์/รหัสทรัพย์สิน ใช้เป็นตัวระบุเมื่อไม่มีทะเบียนรถ';
COMMENT ON COLUMN public.fleet_vehicles.meter_unit IS
  'หน่วยมิเตอร์สะสม: km หรือ hour; odometer_* คงชื่อเดิมเพื่อ compatibility';

-- ── 2. Fuel / trip / maintenance validation ─────────────────────────────
ALTER TABLE public.fleet_fuel_records
  ADD COLUMN IF NOT EXISTS fuel_type text,
  ADD COLUMN IF NOT EXISTS fuel_other_name text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.fleet_fuel_records AS f
SET fuel_type = v.fuel_type
FROM public.fleet_vehicles AS v
WHERE v.id = f.vehicle_id AND f.fuel_type IS NULL;

ALTER TABLE public.fleet_fuel_records
  ALTER COLUMN price_per_liter DROP NOT NULL;

ALTER TABLE public.fleet_fuel_records
  DROP CONSTRAINT IF EXISTS fleet_fuel_liters_positive,
  DROP CONSTRAINT IF EXISTS fleet_fuel_price_nonnegative,
  DROP CONSTRAINT IF EXISTS fleet_fuel_meter_nonnegative,
  DROP CONSTRAINT IF EXISTS fleet_fuel_type_check;

ALTER TABLE public.fleet_fuel_records
  ADD CONSTRAINT fleet_fuel_liters_positive CHECK (liters > 0) NOT VALID,
  ADD CONSTRAINT fleet_fuel_price_nonnegative
    CHECK (price_per_liter IS NULL OR price_per_liter >= 0) NOT VALID,
  ADD CONSTRAINT fleet_fuel_meter_nonnegative CHECK (odometer >= 0) NOT VALID,
  ADD CONSTRAINT fleet_fuel_type_check
    CHECK (fuel_type IS NULL OR fuel_type IN ('diesel', 'gasoline', 'gas_lpg', 'electric', 'lubricant', 'other')) NOT VALID;

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_meter_start_nonnegative,
  DROP CONSTRAINT IF EXISTS fleet_trips_meter_end_nonnegative,
  DROP CONSTRAINT IF EXISTS fleet_trips_meter_sequence,
  DROP CONSTRAINT IF EXISTS fleet_trips_actual_time_sequence,
  DROP CONSTRAINT IF EXISTS fleet_trips_planned_time_sequence,
  DROP CONSTRAINT IF EXISTS fleet_trips_passengers_positive;

ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_meter_start_nonnegative
    CHECK (odometer_start IS NULL OR odometer_start >= 0) NOT VALID,
  ADD CONSTRAINT fleet_trips_meter_end_nonnegative
    CHECK (odometer_end IS NULL OR odometer_end >= 0) NOT VALID,
  ADD CONSTRAINT fleet_trips_meter_sequence
    CHECK (odometer_start IS NULL OR odometer_end IS NULL OR odometer_end >= odometer_start) NOT VALID,
  ADD CONSTRAINT fleet_trips_actual_time_sequence
    CHECK (started_at IS NULL OR returned_at IS NULL OR returned_at >= started_at) NOT VALID,
  ADD CONSTRAINT fleet_trips_planned_time_sequence
    CHECK (planned_departure IS NULL OR planned_return IS NULL OR planned_return > planned_departure) NOT VALID,
  ADD CONSTRAINT fleet_trips_passengers_positive CHECK (passengers > 0) NOT VALID;

ALTER TABLE public.fleet_maintenance
  ADD COLUMN IF NOT EXISTS next_service_meter numeric(10,2),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.fleet_maintenance
SET next_service_meter = next_service_km
WHERE next_service_meter IS NULL AND next_service_km IS NOT NULL;

ALTER TABLE public.fleet_maintenance
  DROP CONSTRAINT IF EXISTS fleet_maintenance_cost_nonnegative,
  DROP CONSTRAINT IF EXISTS fleet_maintenance_meter_nonnegative,
  DROP CONSTRAINT IF EXISTS fleet_maintenance_next_meter_nonnegative;

ALTER TABLE public.fleet_maintenance
  ADD CONSTRAINT fleet_maintenance_cost_nonnegative CHECK (cost >= 0) NOT VALID,
  ADD CONSTRAINT fleet_maintenance_meter_nonnegative
    CHECK (odometer IS NULL OR odometer >= 0) NOT VALID,
  ADD CONSTRAINT fleet_maintenance_next_meter_nonnegative
    CHECK (next_service_meter IS NULL OR next_service_meter >= 0) NOT VALID;

-- ── 3. Permission helpers ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_can_read(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'superadmin'
        OR (
          p.municipality_id = p_municipality_id
          AND (p.role = 'admin' OR p.fleet_role IS NOT NULL)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.fleet_is_manager(p_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'superadmin'
        OR (
          p.municipality_id = p_municipality_id
          AND (p.role = 'admin' OR p.fleet_role = 'fleet_admin')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.fleet_can_write_asset(
  p_municipality_id uuid,
  p_vehicle_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.fleet_is_manager(p_municipality_id)
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.fleet_vehicles v ON v.id = p_vehicle_id
      WHERE p.id = auth.uid()
        AND p.municipality_id = p_municipality_id
        AND p.fleet_role = 'fleet_staff'
        AND v.municipality_id = p_municipality_id
        AND (v.department_id = p.department_id OR v.is_pool)
    );
$$;

CREATE OR REPLACE FUNCTION public.fleet_can_read_asset(
  p_municipality_id uuid,
  p_vehicle_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.fleet_is_manager(p_municipality_id)
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.fleet_vehicles v ON v.id = p_vehicle_id
      WHERE p.id = auth.uid()
        AND p.municipality_id = p_municipality_id
        AND v.municipality_id = p_municipality_id
        AND (
          p.fleet_role = 'fleet_viewer'
          OR (
            p.fleet_role = 'fleet_staff'
            AND (v.department_id = p.department_id OR v.is_pool)
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.fleet_can_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fleet_is_manager(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fleet_can_write_asset(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fleet_can_read_asset(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleet_can_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_is_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_can_write_asset(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_can_read_asset(uuid, uuid) TO authenticated;

-- ── 4. Replace broad Fleet RLS policies ─────────────────────────────────
-- ลบ policy ทุกชื่อที่เคยสร้างไว้ เพื่อไม่ให้ OR กันจนกว้างเกินขอบเขต
DROP POLICY IF EXISTS "fveh_read" ON public.fleet_vehicles;
DROP POLICY IF EXISTS "fveh_write" ON public.fleet_vehicles;
DROP POLICY IF EXISTS "fleet_vehicles_select" ON public.fleet_vehicles;
DROP POLICY IF EXISTS "fleet_vehicles_insert" ON public.fleet_vehicles;
DROP POLICY IF EXISTS "fleet_vehicles_update" ON public.fleet_vehicles;
DROP POLICY IF EXISTS "fleet_vehicles_delete" ON public.fleet_vehicles;

CREATE POLICY "fleet_vehicles_select" ON public.fleet_vehicles
  FOR SELECT USING (public.fleet_can_read_asset(municipality_id, id));
CREATE POLICY "fleet_vehicles_insert" ON public.fleet_vehicles
  FOR INSERT WITH CHECK (public.fleet_is_manager(municipality_id));
CREATE POLICY "fleet_vehicles_update" ON public.fleet_vehicles
  FOR UPDATE USING (public.fleet_is_manager(municipality_id))
  WITH CHECK (public.fleet_is_manager(municipality_id));
CREATE POLICY "fleet_vehicles_delete" ON public.fleet_vehicles
  FOR DELETE USING (public.fleet_is_manager(municipality_id));

DROP POLICY IF EXISTS "ffuel_read" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "ffuel_insert" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "ffuel_update" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "ffuel_delete" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "ffuel_write" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "fleet_fuel_select" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "fleet_fuel_insert" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "fleet_fuel_update" ON public.fleet_fuel_records;
DROP POLICY IF EXISTS "fleet_fuel_delete" ON public.fleet_fuel_records;

CREATE POLICY "fleet_fuel_select" ON public.fleet_fuel_records
  FOR SELECT USING (public.fleet_can_read_asset(municipality_id, vehicle_id));
CREATE POLICY "fleet_fuel_insert" ON public.fleet_fuel_records
  FOR INSERT WITH CHECK (public.fleet_can_write_asset(municipality_id, vehicle_id));
CREATE POLICY "fleet_fuel_update" ON public.fleet_fuel_records
  FOR UPDATE USING (public.fleet_can_write_asset(municipality_id, vehicle_id))
  WITH CHECK (public.fleet_can_write_asset(municipality_id, vehicle_id));
CREATE POLICY "fleet_fuel_delete" ON public.fleet_fuel_records
  FOR DELETE USING (public.fleet_is_manager(municipality_id));

DROP POLICY IF EXISTS "ftrip_read" ON public.fleet_trips;
DROP POLICY IF EXISTS "ftrip_insert" ON public.fleet_trips;
DROP POLICY IF EXISTS "ftrip_update" ON public.fleet_trips;
DROP POLICY IF EXISTS "ftrip_delete" ON public.fleet_trips;
DROP POLICY IF EXISTS "ftrip_write" ON public.fleet_trips;
DROP POLICY IF EXISTS "fleet_trips_select" ON public.fleet_trips;
DROP POLICY IF EXISTS "fleet_trips_insert" ON public.fleet_trips;
DROP POLICY IF EXISTS "fleet_trips_update" ON public.fleet_trips;
DROP POLICY IF EXISTS "fleet_trips_delete" ON public.fleet_trips;

CREATE POLICY "fleet_trips_select" ON public.fleet_trips
  FOR SELECT USING (public.fleet_can_read_asset(municipality_id, vehicle_id));
CREATE POLICY "fleet_trips_insert" ON public.fleet_trips
  FOR INSERT WITH CHECK (
    public.fleet_is_manager(municipality_id)
    OR (
      public.fleet_can_write_asset(municipality_id, vehicle_id)
      AND department_id = (SELECT fdept_id FROM public.my_fleet())
    )
  );
CREATE POLICY "fleet_trips_update" ON public.fleet_trips
  FOR UPDATE USING (
    public.fleet_is_manager(municipality_id)
    OR (
      public.fleet_can_write_asset(municipality_id, vehicle_id)
      AND department_id = (SELECT fdept_id FROM public.my_fleet())
    )
  )
  WITH CHECK (
    public.fleet_is_manager(municipality_id)
    OR (
      public.fleet_can_write_asset(municipality_id, vehicle_id)
      AND department_id = (SELECT fdept_id FROM public.my_fleet())
    )
  );
CREATE POLICY "fleet_trips_delete" ON public.fleet_trips
  FOR DELETE USING (public.fleet_is_manager(municipality_id));

DROP POLICY IF EXISTS "fmaint_read" ON public.fleet_maintenance;
DROP POLICY IF EXISTS "fmaint_write" ON public.fleet_maintenance;
DROP POLICY IF EXISTS "fleet_maintenance_select" ON public.fleet_maintenance;
DROP POLICY IF EXISTS "fleet_maintenance_insert" ON public.fleet_maintenance;
DROP POLICY IF EXISTS "fleet_maintenance_update" ON public.fleet_maintenance;
DROP POLICY IF EXISTS "fleet_maintenance_delete" ON public.fleet_maintenance;

CREATE POLICY "fleet_maintenance_select" ON public.fleet_maintenance
  FOR SELECT USING (public.fleet_can_read_asset(municipality_id, vehicle_id));
CREATE POLICY "fleet_maintenance_insert" ON public.fleet_maintenance
  FOR INSERT WITH CHECK (public.fleet_can_write_asset(municipality_id, vehicle_id));
CREATE POLICY "fleet_maintenance_update" ON public.fleet_maintenance
  FOR UPDATE USING (public.fleet_can_write_asset(municipality_id, vehicle_id))
  WITH CHECK (public.fleet_can_write_asset(municipality_id, vehicle_id));
CREATE POLICY "fleet_maintenance_delete" ON public.fleet_maintenance
  FOR DELETE USING (public.fleet_is_manager(municipality_id));

-- การจองรถ: staff จัดการได้เฉพาะกองตนเอง ผู้ดูแลจัดการได้ทั้งหน่วยงาน
DROP POLICY IF EXISTS fbook_read ON public.fleet_bookings;
DROP POLICY IF EXISTS fbook_insert ON public.fleet_bookings;
DROP POLICY IF EXISTS fbook_update ON public.fleet_bookings;
DROP POLICY IF EXISTS fbook_delete ON public.fleet_bookings;
DROP POLICY IF EXISTS fbook_write ON public.fleet_bookings;
DROP POLICY IF EXISTS fleet_bookings_select ON public.fleet_bookings;
DROP POLICY IF EXISTS fleet_bookings_insert ON public.fleet_bookings;
DROP POLICY IF EXISTS fleet_bookings_update ON public.fleet_bookings;
DROP POLICY IF EXISTS fleet_bookings_delete ON public.fleet_bookings;

CREATE POLICY fleet_bookings_select ON public.fleet_bookings
  FOR SELECT USING (public.fleet_can_read_asset(municipality_id, vehicle_id));
CREATE POLICY fleet_bookings_insert ON public.fleet_bookings
  FOR INSERT WITH CHECK (
    public.fleet_is_manager(municipality_id)
    OR (
      public.fleet_can_write_asset(municipality_id, vehicle_id)
      AND department_id = (SELECT fdept_id FROM public.my_fleet())
      AND requester_id = auth.uid()
    )
  );
CREATE POLICY fleet_bookings_update ON public.fleet_bookings
  FOR UPDATE USING (
    public.fleet_is_manager(municipality_id)
    OR (
      public.fleet_can_write_asset(municipality_id, vehicle_id)
      AND department_id = (SELECT fdept_id FROM public.my_fleet())
      AND requester_id = auth.uid()
    )
  )
  WITH CHECK (
    public.fleet_is_manager(municipality_id)
    OR (
      public.fleet_can_write_asset(municipality_id, vehicle_id)
      AND department_id = (SELECT fdept_id FROM public.my_fleet())
      AND requester_id = auth.uid()
    )
  );
CREATE POLICY fleet_bookings_delete ON public.fleet_bookings
  FOR DELETE USING (public.fleet_is_manager(municipality_id));

-- ประเภทยานพาหนะ/ทรัพย์สินเป็น master data แก้ได้เฉพาะผู้ดูแล
DROP POLICY IF EXISTS fvtype_read ON public.fleet_vehicle_types;
DROP POLICY IF EXISTS fvtype_write ON public.fleet_vehicle_types;
DROP POLICY IF EXISTS fleet_vehicle_types_select ON public.fleet_vehicle_types;
DROP POLICY IF EXISTS fleet_vehicle_types_insert ON public.fleet_vehicle_types;
DROP POLICY IF EXISTS fleet_vehicle_types_update ON public.fleet_vehicle_types;
DROP POLICY IF EXISTS fleet_vehicle_types_delete ON public.fleet_vehicle_types;

CREATE POLICY fleet_vehicle_types_select ON public.fleet_vehicle_types
  FOR SELECT USING (public.fleet_can_read(municipality_id));
CREATE POLICY fleet_vehicle_types_insert ON public.fleet_vehicle_types
  FOR INSERT WITH CHECK (public.fleet_is_manager(municipality_id));
CREATE POLICY fleet_vehicle_types_update ON public.fleet_vehicle_types
  FOR UPDATE USING (public.fleet_is_manager(municipality_id))
  WITH CHECK (public.fleet_is_manager(municipality_id));
CREATE POLICY fleet_vehicle_types_delete ON public.fleet_vehicle_types
  FOR DELETE USING (public.fleet_is_manager(municipality_id));

-- ── 5. Guard trip workflow and asset type ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_guard_trip_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_kind text;
  v_asset_municipality uuid;
  v_is_manager boolean;
BEGIN
  SELECT asset_kind, municipality_id
    INTO v_asset_kind, v_asset_municipality
  FROM public.fleet_vehicles
  WHERE id = NEW.vehicle_id;

  IF v_asset_municipality IS NULL OR v_asset_municipality <> NEW.municipality_id THEN
    RAISE EXCEPTION 'FLEET_ASSET_TENANT_MISMATCH';
  END IF;

  IF v_asset_kind <> 'vehicle' THEN
    RAISE EXCEPTION 'FLEET_TRIP_REQUIRES_VEHICLE';
  END IF;

  -- service_role/import ไม่มี auth.uid(); ฝั่งผู้ใช้จริงห้ามปลอม created_by
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('pending', 'cancelled'))
      OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
      OR (OLD.status = 'approved' AND NEW.status IN ('in_progress', 'cancelled'))
      OR (OLD.status = 'in_progress' AND NEW.status = 'completed')
    ) THEN
      RAISE EXCEPTION 'FLEET_TRIP_INVALID_STATUS_TRANSITION: % -> %', OLD.status, NEW.status;
    END IF;

    -- service_role ไม่มี auth.uid() แต่ยังต้องผ่าน tenant/asset guard ด้านบน
    v_is_manager := auth.uid() IS NULL OR public.fleet_is_manager(NEW.municipality_id);

    IF NEW.status IN ('approved', 'rejected') AND NOT v_is_manager THEN
      RAISE EXCEPTION 'FLEET_TRIP_APPROVAL_REQUIRES_MANAGER';
    END IF;

    IF NEW.status IN ('in_progress', 'completed')
       AND NOT v_is_manager
       AND auth.uid() IS DISTINCT FROM NEW.driver_id
       AND auth.uid() IS DISTINCT FROM NEW.created_by THEN
      RAISE EXCEPTION 'FLEET_TRIP_PROGRESS_REQUIRES_OWNER';
    END IF;
  END IF;

  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    NEW.approved_at := now();
    NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fleet_guard_trip_write ON public.fleet_trips;
CREATE TRIGGER trg_fleet_guard_trip_write
  BEFORE INSERT OR UPDATE ON public.fleet_trips
  FOR EACH ROW EXECUTE FUNCTION public.fleet_guard_trip_write();

-- Fuel/Maintenance ต้องอ้างทรัพย์สินใน tenant เดียวกัน และห้ามปลอมผู้บันทึก
CREATE OR REPLACE FUNCTION public.fleet_guard_asset_record_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_municipality uuid;
BEGIN
  SELECT municipality_id INTO v_asset_municipality
  FROM public.fleet_vehicles
  WHERE id = NEW.vehicle_id;

  IF v_asset_municipality IS NULL OR v_asset_municipality <> NEW.municipality_id THEN
    RAISE EXCEPTION 'FLEET_ASSET_TENANT_MISMATCH';
  END IF;

  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  ELSIF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    NEW.created_by := OLD.created_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fleet_fuel_guard_asset ON public.fleet_fuel_records;
CREATE TRIGGER trg_fleet_fuel_guard_asset
  BEFORE INSERT OR UPDATE ON public.fleet_fuel_records
  FOR EACH ROW EXECUTE FUNCTION public.fleet_guard_asset_record_write();

DROP TRIGGER IF EXISTS trg_fleet_maintenance_guard_asset ON public.fleet_maintenance;
CREATE TRIGGER trg_fleet_maintenance_guard_asset
  BEFORE INSERT OR UPDATE ON public.fleet_maintenance
  FOR EACH ROW EXECUTE FUNCTION public.fleet_guard_asset_record_write();

-- ── 6. Updated-at + immutable audit trail ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fleet_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_municipality_id uuid;
  v_record_id uuid;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_municipality_id := (v_row ->> 'municipality_id')::uuid;
  v_record_id := (v_row ->> 'id')::uuid;

  INSERT INTO public.fleet_audit_log (
    municipality_id, table_name, record_id, action,
    old_data, new_data, changed_by, changed_at
  ) VALUES (
    v_municipality_id,
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth.uid(),
    now()
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'fleet_vehicles', 'fleet_fuel_records', 'fleet_trips', 'fleet_maintenance'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || v_table || '_updated_at', v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fleet_set_updated_at()',
      'trg_' || v_table || '_updated_at', v_table
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || v_table || '_audit', v_table);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fleet_audit_row()',
      'trg_' || v_table || '_audit', v_table
    );
  END LOOP;
END;
$$;

-- Audit log อ่านได้เฉพาะผู้ดูแล และไม่มี policy UPDATE/DELETE
DROP POLICY IF EXISTS "faudit_read" ON public.fleet_audit_log;
DROP POLICY IF EXISTS "faudit_insert" ON public.fleet_audit_log;
DROP POLICY IF EXISTS "faudit_write" ON public.fleet_audit_log;
DROP POLICY IF EXISTS "fleet_audit_select" ON public.fleet_audit_log;
CREATE POLICY "fleet_audit_select" ON public.fleet_audit_log
  FOR SELECT USING (public.fleet_is_manager(municipality_id));

-- ── 7. Private Storage: ใบเสร็จ/เอกสาร Fleet ───────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fleet-documents',
  'fleet-documents',
  false,
  10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.fleet_can_read_document_path(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_parts text[];
  v_municipality_id uuid;
  v_record_id uuid;
  v_vehicle_id uuid;
BEGIN
  v_parts := storage.foldername(p_name);
  v_municipality_id := v_parts[1]::uuid;
  v_record_id := v_parts[3]::uuid;

  IF public.fleet_is_manager(v_municipality_id) THEN
    RETURN true;
  END IF;

  -- fleet_viewer ดูรายงานได้ แต่เอกสารใบเสร็จจำกัดเฉพาะผู้ปฏิบัติงานในขอบเขต
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.municipality_id = v_municipality_id
      AND p.fleet_role = 'fleet_staff'
  ) THEN
    RETURN false;
  END IF;

  IF v_parts[2] = 'fuel' THEN
    SELECT vehicle_id INTO v_vehicle_id
    FROM public.fleet_fuel_records
    WHERE id = v_record_id AND municipality_id = v_municipality_id;
  ELSIF v_parts[2] = 'maintenance' THEN
    SELECT vehicle_id INTO v_vehicle_id
    FROM public.fleet_maintenance
    WHERE id = v_record_id AND municipality_id = v_municipality_id;
  ELSE
    RETURN false;
  END IF;

  RETURN v_vehicle_id IS NOT NULL
    AND public.fleet_can_write_asset(v_municipality_id, v_vehicle_id);
EXCEPTION WHEN invalid_text_representation OR array_subscript_error THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.fleet_can_read_document_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fleet_can_read_document_path(text) TO authenticated;

DROP POLICY IF EXISTS "fleet_documents_select" ON storage.objects;
DROP POLICY IF EXISTS "fleet_documents_insert" ON storage.objects;
DROP POLICY IF EXISTS "fleet_documents_update" ON storage.objects;
DROP POLICY IF EXISTS "fleet_documents_delete" ON storage.objects;

CREATE POLICY "fleet_documents_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'fleet-documents'
    AND public.fleet_can_read_document_path(name)
  );

CREATE POLICY "fleet_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fleet-documents'
    AND public.fleet_can_read_document_path(name)
  );

CREATE POLICY "fleet_documents_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fleet-documents'
    AND public.fleet_can_read_document_path(name)
  )
  WITH CHECK (
    bucket_id = 'fleet-documents'
    AND public.fleet_can_read_document_path(name)
  );

CREATE POLICY "fleet_documents_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'fleet-documents'
    AND (
      public.get_my_role() = 'superadmin'
      OR (
        (storage.foldername(name))[1] = public.get_my_municipality_id()::text
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.municipality_id = public.get_my_municipality_id()
            AND (p.role = 'admin' OR p.fleet_role = 'fleet_admin')
        )
      )
    )
  );

COMMIT;
