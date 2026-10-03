-- Community transport backend. Full latest definitions; no production writes or flag changes.
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.purge_expired_patient_booking_contacts(interval,boolean)','6f3ff8ae0445c17a5b17c42bbd3e4666'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

-- Existing name/relation checks permit NULL; explicit service checks prevent SQL UNKNOWN from bypassing patient requirements.
ALTER TABLE public.patient_bookings ALTER COLUMN patient_name DROP NOT NULL, ALTER COLUMN relation DROP NOT NULL;
ALTER TABLE public.patient_bookings ADD CONSTRAINT patient_bookings_service_shape CHECK (
 (service_type='patient' AND patient_name IS NOT NULL AND relation IS NOT NULL
  AND party_size IS NULL AND group_label IS NULL AND purpose_code IS NULL AND rules_version IS NULL)
 OR (service_type='community' AND patient_name IS NULL AND relation IS NULL AND mobility='walk'
  AND companions=0 AND share=false AND requested_trip_id IS NULL AND party_size IS NOT NULL AND party_size BETWEEN 1 AND 15
  AND rules_version IS NOT NULL AND rules_version>0 AND purpose_code IS NOT NULL AND purpose_code ~ '^[A-Za-z0-9_-]{1,60}$'
  AND ((contact_purged_at IS NULL AND group_label IS NOT NULL AND char_length(btrim(group_label)) BETWEEN 1 AND 200)
   OR (contact_purged_at IS NOT NULL AND group_label IS NULL))));
CREATE OR REPLACE FUNCTION public.purge_expired_patient_booking_contacts(
  p_retention interval DEFAULT '5 years',
  p_dry_run   boolean  DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cutoff  timestamptz := now() - p_retention;
  v_purged  int := 0;
  v_holding int := 0;
  v_open    int := 0;
BEGIN
  -- คำขอที่ครบกำหนดแล้วแต่ยังไม่ปิด (ยังรอจัดคิว/ยังไม่จบเที่ยว) ไม่ลบ และต้องรายงานให้คนเห็น
  -- ไม่ใช่เงียบ — เพราะแถวพวกนี้ยังค้างอยู่ในคิวของเจ้าหน้าที่ ลบชื่อทิ้งแล้วงานจะกลายเป็นผี
  SELECT count(*) INTO v_open
  FROM public.patient_bookings b
  WHERE b.contact_purged_at IS NULL
    AND b.status NOT IN ('completed', 'cancelled')
    AND public.patient_booking_retention_anchor(b) < v_cutoff;

  SELECT count(*) INTO v_holding
  FROM public.patient_bookings b
  WHERE b.contact_purged_at IS NULL;

  IF p_dry_run THEN
    SELECT count(*) INTO v_purged
    FROM public.patient_bookings b
    WHERE b.contact_purged_at IS NULL
      AND b.status IN ('completed', 'cancelled')
      AND public.patient_booking_retention_anchor(b) < v_cutoff;

    RETURN jsonb_build_object(
      'dry_run', true, 'cutoff', to_jsonb(v_cutoff),
      'would_purge', v_purged, 'skipped_still_open', v_open, 'holding_contacts', v_holding
    );
  END IF;

  -- audit กับการลบอยู่ใน CTE ชุดเดียวกัน ทำงานบน snapshot เดียวกันเสมอ บันทึกจึงตรงกับของจริง
  WITH targets AS (
    SELECT b.id, b.municipality_id
    FROM public.patient_bookings b
    WHERE b.contact_purged_at IS NULL
      AND b.status IN ('completed', 'cancelled')
      AND public.patient_booking_retention_anchor(b) < v_cutoff
  ), logged AS (
    INSERT INTO public.audit_logs (
      municipality_id, actor_id, actor_name, actor_role, action,
      resource_type, resource_id, resource_label, metadata
    )
    SELECT t.municipality_id, NULL, 'ระบบ (งานลบข้อมูลตามระยะเวลาเก็บรักษา)', 'system',
           'purge_contact_pii', 'patient_booking', NULL,
           'ลบข้อมูลระบุตัวบุคคลของคำขอจองรถที่ครบกำหนดเก็บรักษา',
           jsonb_build_object(
             'retention', p_retention::text,
             'cutoff', to_jsonb(v_cutoff),
             'bookings', count(*),
             'fields', jsonb_build_array('requester_name', 'patient_name', 'group_label', 'phone', 'pickup', 'pickup_lat', 'pickup_lng')
           )
    FROM targets t
    GROUP BY t.municipality_id
    RETURNING 1
  ), updated AS (
    UPDATE public.patient_bookings b
       SET requester_name    = 'ลบตามระยะเวลาเก็บรักษา',
           patient_name      = CASE WHEN b.service_type='patient' THEN 'ลบตามระยะเวลาเก็บรักษา' ELSE NULL END,
           group_label       = NULL,
           phone             = '',
           pickup            = 'ลบตามระยะเวลาเก็บรักษา',
           pickup_lat        = NULL,
           pickup_lng        = NULL,
           contact_purged_at = now()
      FROM targets t
     WHERE b.id = t.id
    RETURNING b.id
  )
  SELECT count(*) INTO v_purged FROM updated;

  RETURN jsonb_build_object(
    'dry_run', false, 'cutoff', to_jsonb(v_cutoff),
    'purged', v_purged, 'skipped_still_open', v_open, 'holding_contacts', v_holding - v_purged
  );
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
