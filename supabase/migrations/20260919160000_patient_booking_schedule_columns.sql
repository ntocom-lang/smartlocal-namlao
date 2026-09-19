BEGIN;
ALTER TABLE public.patient_booking_trips
 ADD COLUMN schedule_revision integer NOT NULL DEFAULT 1,
 ADD COLUMN public_notice text NOT NULL DEFAULT 'normal' CHECK (public_notice IN ('normal','delayed','contact')),
 ADD COLUMN estimated_pickup_at timestamptz,
 ADD COLUMN estimated_return_at timestamptz;
COMMIT;
