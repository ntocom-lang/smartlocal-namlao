-- New booking workflow: fund-owned single vehicle; municipality coordinates.
-- Legacy referral/document records are deliberately untouched. Starts disabled.
BEGIN;
CREATE TABLE public.patient_booking_settings (
 municipality_id uuid PRIMARY KEY REFERENCES public.municipalities(id),
 enabled boolean NOT NULL DEFAULT false,
 partner_id uuid REFERENCES public.referral_partners(id),
 driver_id uuid REFERENCES public.profiles(id),
 coordinator_ids uuid[] NOT NULL DEFAULT '{}',
 office_start integer NOT NULL DEFAULT 510 CHECK (office_start BETWEEN 0 AND 1439),
 office_end integer NOT NULL DEFAULT 990 CHECK (office_end BETWEEN 1 AND 1440 AND office_end > office_start),
 seats integer CHECK (seats BETWEEN 1 AND 15),
 wheelchairs integer CHECK (wheelchairs BETWEEN 0 AND 4),
 stretchers integer CHECK (stretchers BETWEEN 0 AND 2),
 buffer_minutes integer NOT NULL DEFAULT 15 CHECK (buffer_minutes BETWEEN 5 AND 90),
 boarding_minutes integer NOT NULL DEFAULT 15 CHECK (boarding_minutes BETWEEN 5 AND 60),
 routes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(routes)='array'),
 holidays date[] NOT NULL DEFAULT '{}',
 calendar_checked_through date,
 unavailable boolean NOT NULL DEFAULT false,
 delegation_reference text NOT NULL DEFAULT '',
 privacy_notice text NOT NULL DEFAULT '',
 contact_phone text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.patient_bookings (
 id uuid PRIMARY KEY,
 municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 requester_name text NOT NULL CHECK (char_length(requester_name) BETWEEN 1 AND 200),
 phone text NOT NULL CHECK (phone ~ '^0[0-9]{8,9}$'),
 patient_name text NOT NULL CHECK (char_length(patient_name) BETWEEN 1 AND 200),
 relation text NOT NULL CHECK (relation IN ('self','relative','caregiver')),
 pickup text NOT NULL CHECK (char_length(pickup) BETWEEN 1 AND 500),
 in_area boolean NOT NULL,
 route_id text NOT NULL,
 route_label text NOT NULL,
 appointment_at timestamptz NOT NULL,
 mobility text NOT NULL CHECK (mobility IN ('walk','wheelchair','stretcher')),
 companions integer NOT NULL CHECK (companions BETWEEN 0 AND 5),
 share boolean NOT NULL DEFAULT false,
 return_mode text NOT NULL CHECK (return_mode IN ('wait','later','one_way')),
 return_at timestamptz,
 status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','confirmed','completed','cancelled')),
 cancel_requested boolean NOT NULL DEFAULT false,
 return_ready boolean NOT NULL DEFAULT false,
 passenger_step integer NOT NULL DEFAULT 0 CHECK (passenger_step BETWEEN 0 AND 4),
 consent_text text NOT NULL,
 consent_version text NOT NULL DEFAULT 'patient-booking-v1',
 consent_at timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_bookings_queue ON public.patient_bookings(municipality_id,status,appointment_at);
CREATE INDEX patient_bookings_creator ON public.patient_bookings(created_by,created_at DESC);
CREATE TABLE public.patient_booking_trips (
 id uuid PRIMARY KEY,
 municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
 driver_id uuid NOT NULL REFERENCES public.profiles(id),
 booking_ids uuid[] NOT NULL,
 plan jsonb NOT NULL,
 state text NOT NULL DEFAULT 'confirmed' CHECK (state IN ('confirmed','outbound','hospital','returning','completed','issue','cancelled')),
 state_before_issue text,
 issue_note text,
 helper_name text,
 confirmed_by uuid NOT NULL REFERENCES public.profiles(id),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_booking_trips_queue ON public.patient_booking_trips(municipality_id,state);
ALTER TABLE public.patient_bookings ADD COLUMN trip_id uuid REFERENCES public.patient_booking_trips(id);
CREATE TABLE public.patient_booking_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 entity_id uuid NOT NULL,
 action text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_booking_events_tenant ON public.patient_booking_events(municipality_id,created_at DESC);
-- Minimal in-app notifications, written in the same transaction. No health data.
CREATE TABLE public.patient_booking_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
 recipient_id uuid NOT NULL REFERENCES public.profiles(id),
 entity_id uuid NOT NULL,
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_booking_notices_recipient ON public.patient_booking_notices(recipient_id,created_at DESC);
CREATE TABLE public.patient_booking_operations (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Deny direct access, including before the API migration is applied.
ALTER TABLE public.patient_booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_booking_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_booking_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_booking_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_booking_settings, public.patient_bookings, public.patient_booking_trips,
 public.patient_booking_events, public.patient_booking_notices, public.patient_booking_operations FROM PUBLIC, anon, authenticated;
COMMIT;
