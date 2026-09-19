-- Ordered after the already numbered 20260919140100 dependency (CLI clock is earlier).
BEGIN;
ALTER TABLE public.patient_booking_trips ADD COLUMN odometer_issue boolean NOT NULL DEFAULT false,
 ADD COLUMN odometer_note text NOT NULL DEFAULT '' CHECK (char_length(odometer_note)<=300);
ALTER TABLE public.patient_booking_trips DROP CONSTRAINT patient_booking_trips_odometer_order;
ALTER TABLE public.patient_booking_trips ADD CONSTRAINT patient_booking_trips_odometer_order CHECK (
 (odometer_issue AND char_length(btrim(odometer_note))>0) OR
 (NOT odometer_issue AND (odometer_start IS NULL OR odometer_end IS NULL OR
 (odometer_end>=odometer_start AND odometer_end-odometer_start<=2000))));
COMMIT;
