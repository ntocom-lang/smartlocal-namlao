-- Community transport foundation, phase 1/3: additive columns only.
-- Existing requests and the unchanged patient submit RPC default to 'patient'.
-- Keep patient_name/relation NOT NULL until the RPC/projection/purge phase.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.patient_bookings') IS NULL THEN
  RAISE EXCEPTION 'Community columns: patient_bookings is missing';
 END IF;
 IF EXISTS (
  SELECT 1 FROM pg_catalog.pg_attribute
  WHERE attrelid=to_regclass('public.patient_bookings') AND NOT attisdropped
   AND attname IN ('service_type','party_size','group_label','purpose_code','rules_version')
 ) THEN
  RAISE EXCEPTION 'Community columns already exist; check migration history before proceeding';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_attribute
  WHERE attrelid=to_regclass('public.patient_bookings') AND NOT attisdropped
   AND attname IN ('patient_name','relation') AND attnotnull) <> 2 THEN
  RAISE EXCEPTION 'Community foundation requires the original patient_name/relation NOT NULL constraints';
 END IF;
END $guard$;

ALTER TABLE public.patient_bookings
 ADD COLUMN service_type text NOT NULL DEFAULT 'patient',
 ADD COLUMN party_size integer,
 ADD COLUMN group_label text,
 ADD COLUMN purpose_code text,
 ADD COLUMN rules_version integer;
COMMIT;
