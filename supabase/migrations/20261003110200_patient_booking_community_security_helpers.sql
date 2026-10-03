-- Community transport foundation, phase 3/3: bounds and private seat helper.
-- No existing function is replaced or wired to community intake in this phase.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.patient_booking_community_rules') IS NULL THEN
  RAISE EXCEPTION 'Apply 20261003110100_patient_booking_community_rules_table first';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_attribute
  WHERE attrelid=to_regclass('public.patient_bookings') AND NOT attisdropped
   AND attname IN ('service_type','party_size','group_label','purpose_code','rules_version')) <> 5 THEN
  RAISE EXCEPTION 'Apply 20261003110000_patient_booking_community_columns first';
 END IF;
END $guard$;

ALTER TABLE public.patient_bookings
 ADD CONSTRAINT patient_bookings_service_type_check CHECK (service_type IN ('patient','community')),
 ADD CONSTRAINT patient_bookings_party_size_check CHECK (party_size BETWEEN 1 AND 15),
 ADD CONSTRAINT patient_bookings_group_label_check CHECK (char_length(group_label) <= 200),
 ADD CONSTRAINT patient_bookings_rules_version_check CHECK (rules_version > 0);

ALTER TABLE public.patient_booking_community_rules
 ADD CONSTRAINT ptb_community_places_array CHECK (jsonb_typeof(places)='array'),
 ADD CONSTRAINT ptb_community_activities_array CHECK (jsonb_typeof(activities)='array'),
 ADD CONSTRAINT ptb_community_window_check CHECK (
  (window_start IS NULL AND window_end IS NULL) OR
  (window_start IS NOT NULL AND window_end IS NOT NULL
   AND window_start BETWEEN 0 AND 1439 AND window_end BETWEEN 1 AND 1440
   AND window_end > window_start)),
 ADD CONSTRAINT ptb_community_rules_version_check CHECK (rules_version > 0),
 ADD CONSTRAINT ptb_community_revision_check CHECK (revision > 0),
 ADD CONSTRAINT ptb_community_enabled_prerequisites CHECK (NOT enabled OR (
  window_start IS NOT NULL AND window_end IS NOT NULL AND char_length(btrim(rules_reference)) > 0
  AND CASE WHEN jsonb_typeof(places)='array' THEN jsonb_array_length(places) > 0 ELSE false END
  AND CASE WHEN jsonb_typeof(activities)='array' THEN jsonb_array_length(activities) > 0 ELSE false END));

ALTER TABLE public.patient_booking_community_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.patient_booking_community_rules FROM PUBLIC, anon, authenticated;

-- Pure row calculation; validation belongs to constraints/intake in the next
-- phase. Missing/unknown input stays NULL rather than silently reserving 0 seats.
CREATE FUNCTION public.ptb_seats(b public.patient_bookings) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT CASE b.service_type
  WHEN 'patient' THEN b.companions + CASE WHEN b.mobility='walk' THEN 1 ELSE 0 END
  WHEN 'community' THEN b.party_size
 END
$$;
REVOKE ALL ON FUNCTION public.ptb_seats(public.patient_bookings) FROM PUBLIC, anon, authenticated;
COMMIT;
