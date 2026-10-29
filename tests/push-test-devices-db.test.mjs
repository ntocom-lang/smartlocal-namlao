// migration ข้อ 2 ตั้งค่าแจ้งเตือน — รันบน PostgreSQL จำลอง (PGlite) ไม่ต่อ Supabase จริง
// รันด้วย: PATIENT_PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js node tests/push-test-devices-db.test.mjs
//   (PowerShell: $env:PATIENT_PGLITE_MODULE='D:/tmp/patient-booking-dbtest-20260918/node_modules/@electric-sql/pglite/dist/index.js')
//
// โครงตาราง/สิทธิ์ตั้งต้นคัดจากที่อ่านจากระบบจริง 2569-10-29 (pg_policies / information_schema / pg_constraint):
// push_subscriptions มี policy "user manage own subscription" + anon SELECT + authenticated ALL (รวม TRUNCATE)
// notification_deliveries CHECK channel = 'telegram' อย่างเดียว

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

if (!process.env.PATIENT_PGLITE_MODULE) {
  console.error('ต้องตั้ง PATIENT_PGLITE_MODULE ชี้ไปที่ @electric-sql/pglite/dist/index.js (ดู docs/ai/PATIENT_BOOKING_HANDOFF.md)')
  process.exit(1)
}
const { PGlite } = await import(pathToFileURL(process.env.PATIENT_PGLITE_MODULE).href)
const migration = (await readFile(new URL('../supabase/migrations/20261029100000_push_device_label_and_push_channel.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MUNI = id(1)
const USER_A = id(11)
const USER_B = id(12)

const db = new PGlite()
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY);
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE,
  endpoint text NOT NULL, p256dh text NOT NULL, auth_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint)
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manage own subscription" ON public.push_subscriptions FOR ALL TO public
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT ON public.push_subscriptions TO anon;
GRANT ALL ON public.push_subscriptions TO authenticated;
CREATE TABLE public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'telegram',
  notification_type text NOT NULL, resource_type text NOT NULL, resource_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_channel_check CHECK (channel = 'telegram'),
  CONSTRAINT notification_deliveries_status_check CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT notification_deliveries_idempotency_unique UNIQUE (municipality_id, channel, idempotency_key)
);
INSERT INTO public.municipalities VALUES ('${MUNI}');
INSERT INTO auth.users VALUES ('${USER_A}'), ('${USER_B}');
`)

// ก่อน migration: ช่องทาง push ถูกปฏิเสธจริง (ยืนยันว่าเทสต์จำลองสภาพเดิมถูก)
await assert.rejects(db.query(`INSERT INTO public.notification_deliveries (municipality_id, channel, notification_type, resource_type, resource_id, idempotency_key) VALUES ($1, 'push', 'self_test', 'user', $2, 'before')`, [MUNI, USER_A]), /notification_deliveries_channel_check/)

await db.exec(migration)
await db.exec(migration) // รันซ้ำได้ (IF NOT EXISTS / DROP ... IF EXISTS)

const insertDevice = (user, endpoint, label) => db.query(
  `INSERT INTO public.push_subscriptions (user_id, municipality_id, endpoint, p256dh, auth_key, device_label) VALUES ($1, $2, $3, 'k', 'a', $4) RETURNING id`,
  [user, MUNI, endpoint, label],
)

// ── ชื่อเครื่อง: 1–60 ตัวอักษร หรือว่างได้ (แถวเดิม) ───────────────────────────
await insertDevice(USER_A, 'https://push.example/a1', 'Chrome · Windows')
await insertDevice(USER_A, 'https://push.example/a2', null)
await insertDevice(USER_B, 'https://push.example/b1', 'Safari · iPhone · แอป')
for (const bad of ['', '   ', 'x'.repeat(61)]) {
  await assert.rejects(insertDevice(USER_A, `https://push.example/bad-${bad.length}`, bad), /push_subscriptions_device_label_len/, JSON.stringify(bad))
}

// ── ช่องทาง push + กันซ้ำด้วย idempotency_key เดิม ─────────────────────────────
const delivery = (channel, key) => db.query(
  `INSERT INTO public.notification_deliveries (municipality_id, channel, notification_type, resource_type, resource_id, idempotency_key) VALUES ($1, $2, 'complaint_created', 'complaint', $3, $4)`,
  [MUNI, channel, USER_A, key],
)
await delivery('push', 'complaint_created:x')
await delivery('telegram', 'complaint_created:x') // คนละช่องทาง ไม่ชนกัน
await assert.rejects(delivery('push', 'complaint_created:x'), (e) => e.code === '23505', 'ส่งซ้ำต้องชน unique')
await assert.rejects(delivery('sms', 'other'), /notification_deliveries_channel_check/)

// ── สิทธิ์: anon อ่านไม่ได้ · authenticated ไม่มี TRUNCATE แต่จัดการแถวตัวเองได้ ──────────────
const priv = async (role, privilege) => (await db.query(`SELECT has_table_privilege($1, 'public.push_subscriptions', $2) AS ok`, [role, privilege])).rows[0].ok
assert.equal(await priv('anon', 'SELECT'), false)
assert.equal(await priv('authenticated', 'TRUNCATE'), false)
for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal(await priv('authenticated', p), true, p)

async function as(user, sql, params = []) {
  await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`)
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec('RESET ROLE')
  }
}
const mine = await as(USER_A, 'SELECT endpoint, device_label FROM public.push_subscriptions ORDER BY endpoint')
assert.deepEqual(mine.rows.map((r) => r.endpoint), ['https://push.example/a1', 'https://push.example/a2'], 'เห็นเฉพาะเครื่องของตัวเอง')
await assert.rejects(as(null, 'SELECT 1 FROM public.push_subscriptions'), /permission denied/)
const removedOther = await as(USER_A, `DELETE FROM public.push_subscriptions WHERE endpoint = 'https://push.example/b1' RETURNING id`)
assert.equal(removedOther.rows.length, 0, 'ลบเครื่องของคนอื่นไม่ได้')
const removedOwn = await as(USER_A, `DELETE FROM public.push_subscriptions WHERE endpoint = 'https://push.example/a2' RETURNING id`)
assert.equal(removedOwn.rows.length, 1, 'ลบเครื่องของตัวเองได้')
await assert.rejects(as(USER_A, 'TRUNCATE public.push_subscriptions'), /permission denied/)
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.push_subscriptions')).rows[0].n, 2)

console.log('✓ push-test-devices-db: ผ่านทุกข้อ')
