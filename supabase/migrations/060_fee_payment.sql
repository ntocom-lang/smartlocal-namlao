-- 060_fee_payment.sql
-- ระบบชำระค่าธรรมเนียมออนไลน์ (LPA ๑.๖)

-- ── municipalities: PromptPay + fee schedule ──────────────────────────────────
alter table municipalities
  add column if not exists promptpay_id   text,        -- เบอร์/เลขบัตร/เลขนิติบุคคล
  add column if not exists fee_schedule   jsonb default '{"residence_cert":0,"personal_cert":0,"conduct_cert":0,"tax_notice":0,"other":0}';

-- ── document_requests: payment columns ───────────────────────────────────────
alter table document_requests
  add column if not exists fee_amount          decimal(10,2) default 0,
  add column if not exists payment_status      text default 'not_required'
    check (payment_status in ('not_required','pending','uploaded','verified','waived')),
  add column if not exists payment_slip_url    text,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by uuid references profiles(id);

-- ── Storage bucket: payment-slips ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do nothing;

-- authenticated users upload their own slips
drop policy if exists "citizen upload payment slip" on storage.objects;
create policy "citizen upload payment slip"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'payment-slips');

-- staff/admin read slips
drop policy if exists "staff read payment slips" on storage.objects;
create policy "staff read payment slips"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'payment-slips');

-- staff/admin delete slips
drop policy if exists "staff delete payment slips" on storage.objects;
create policy "staff delete payment slips"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'payment-slips');
