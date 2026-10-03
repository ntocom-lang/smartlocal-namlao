-- Community transport foundation, phase 2/3: separate tenant rules, no seed.
-- This migration does not create an intake RPC or enable a service.
BEGIN;
DO $guard$
BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_attribute
  WHERE attrelid=to_regclass('public.patient_bookings') AND NOT attisdropped
   AND attname IN ('service_type','party_size','group_label','purpose_code','rules_version')) <> 5 THEN
  RAISE EXCEPTION 'Apply 20261003110000_patient_booking_community_columns first';
 END IF;
 IF to_regclass('public.patient_booking_community_rules') IS NOT NULL THEN
  RAISE EXCEPTION 'Community rules table already exists; check migration history before proceeding';
 END IF;
END $guard$;

CREATE TABLE public.patient_booking_community_rules (
 municipality_id uuid PRIMARY KEY REFERENCES public.municipalities(id),
 enabled boolean NOT NULL DEFAULT false,
 window_start integer,
 window_end integer,
 places jsonb NOT NULL DEFAULT '[]',
 activities jsonb NOT NULL DEFAULT '[]',
 rules_reference text NOT NULL DEFAULT '',
 rules_version integer NOT NULL DEFAULT 1,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- Deny access in the same transaction as CREATE TABLE, including when the next
-- phase has not been applied. Dynamic SQL resolves the new table after creation
-- rather than relying on eager statement parsing (docs/ai/NOTES.md section 3).
-- Validation/helper statements that depend on new columns remain in phase 3.
DO $security$
BEGIN
 EXECUTE 'ALTER TABLE public.patient_booking_community_rules ENABLE ROW LEVEL SECURITY';
 EXECUTE 'REVOKE ALL ON TABLE public.patient_booking_community_rules FROM PUBLIC, anon, authenticated';
END $security$;
COMMIT;
