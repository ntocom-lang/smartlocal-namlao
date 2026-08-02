-- Server-side delivery log and idempotency guard for outbound notifications.
-- Client roles may read permitted rows but cannot insert/update/delete them.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram')),
  notification_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_message_id text,
  last_error text,
  claim_token uuid,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_idempotency_unique
    UNIQUE (municipality_id, channel, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_municipality_created
  ON public.notification_deliveries (municipality_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_updated
  ON public.notification_deliveries (status, updated_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification deliveries admin read" ON public.notification_deliveries;
CREATE POLICY "notification deliveries admin read"
  ON public.notification_deliveries
  FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() = 'admin'
      AND municipality_id = public.get_my_municipality_id()
    )
  );

REVOKE ALL ON TABLE public.notification_deliveries FROM anon, authenticated;
GRANT SELECT ON TABLE public.notification_deliveries TO authenticated;

COMMENT ON TABLE public.notification_deliveries IS
  'Audit log, retry state and idempotency guard for server-side outbound notifications.';
COMMENT ON COLUMN public.notification_deliveries.last_error IS
  'Technical provider error only; must not contain citizen or event personal data.';

COMMIT;
