// migration Telegram ส่วนตัว ส่วนที่ 2 (20261030100000 + 20261030100100) — รันบน PostgreSQL จำลอง (PGlite)
// รันด้วย: PATIENT_PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js node tests/telegram-dm-db.test.mjs
//
// ฟังก์ชันลงนามตัวจริง (esign_expected_signer ฯลฯ) พึ่งตารางทะเบียนผู้ลงนามทั้งชุด — เทสต์นี้แทนด้วย stub
// ที่คืนผู้ลงนามจากตาราง test_signers เพื่อตรวจ "ลำดับคิว" ของ esign_trip_turns อย่างเดียว
// ⚠️ ลำดับคิวต้องตรงกับ can_sign ใน esign_trip_status() — ถ้าแก้ฝั่งนั้น ต้องแก้ทั้งฟังก์ชันและเทสต์นี้

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

if (!process.env.PATIENT_PGLITE_MODULE) {
  console.error('ต้องตั้ง PATIENT_PGLITE_MODULE ชี้ไปที่ @electric-sql/pglite/dist/index.js (ดู docs/ai/PATIENT_BOOKING_HANDOFF.md)')
  process.exit(1)
}
const { PGlite } = await import(pathToFileURL(process.env.PATIENT_PGLITE_MODULE).href)
const sql = async (name) => (await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const linkMigration = await sql('20261029120000_telegram_personal_link.sql')
const columns = await sql('20261030100000_telegram_dm_columns.sql')
const functions = await sql('20261030100100_telegram_dm_functions.sql')

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const USER_A = id(11)
const USER_B = id(12)
const HEAD = id(21)
const BOSS = id(22)
const MAYOR = id(23)
const TRIP = id(31)

const db = new PGlite()
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO auth.users VALUES ('${USER_A}'), ('${USER_B}');

-- notification_deliveries ตามโครงเดิม (เฉพาะคอลัมน์ที่ migration แตะ)
CREATE TABLE public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'telegram',
  idempotency_key text NOT NULL,
  CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('telegram', 'push'))
);

-- stub ของระบบลงนาม
CREATE TABLE public.fleet_trips (
  id uuid PRIMARY KEY, municipality_id uuid, status text NOT NULL, esign_slots jsonb,
  requested_by uuid, created_by uuid
);
CREATE TABLE public.esign_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doc_type text, doc_id uuid, slot text, signed_at timestamptz DEFAULT now()
);
CREATE TABLE public.esign_revocations (signature_id uuid);
CREATE TABLE public.test_signers (slot text PRIMARY KEY, user_id uuid, position text);
CREATE FUNCTION public.esign_expected_signer(p_trip public.fleet_trips, p_slot text) RETURNS jsonb
  LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_slot = 'requester'
      THEN jsonb_build_object('user_id', COALESCE(p_trip.requested_by, p_trip.created_by), 'position', (SELECT position FROM public.test_signers WHERE slot = 'requester'))
      ELSE (SELECT jsonb_build_object('user_id', user_id) FROM public.test_signers WHERE slot = p_slot)
    END $$;
CREATE FUNCTION public.esign_is_mayor_position(p_text text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p_text LIKE 'นายก%' $$;
CREATE FUNCTION public.esign_slot_label(p_slot text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'ป้าย:' || p_slot $$;
`)

await db.exec(linkMigration)
await db.exec(columns)
await db.exec(functions)
await db.exec(columns) // รันซ้ำได้
await db.exec(functions)

async function as(role, user, fn) {
  await db.exec(`SET ROLE ${role}`)
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  try {
    return await fn()
  } finally {
    await db.exec('RESET ROLE')
  }
}
const rejects = async (promise, pattern, label) => {
  await assert.rejects(promise, pattern, label)
}

// ── dm_muted: ค่าเริ่มต้นรับครบ · CHECK กันค่าแปลก · ผู้ใช้อ่านได้ (ยังไม่เห็น chat_id) ─────────────────────
await db.query(`INSERT INTO public.telegram_user_links (user_id, chat_id, tg_display) VALUES ($1, 5001, 'A')`, [USER_A])
assert.deepEqual((await db.query(`SELECT dm_muted FROM public.telegram_user_links WHERE user_id = $1`, [USER_A])).rows[0].dm_muted, [])
await rejects(db.query(`UPDATE public.telegram_user_links SET dm_muted = '{complaint,oops}' WHERE user_id = $1`, [USER_A]), /dm_muted_check/)

const colPriv = async (column) => (await db.query(`SELECT has_column_privilege('authenticated', 'public.telegram_user_links', $1, 'SELECT') AS ok`, [column])).rows[0].ok
assert.equal(await colPriv('dm_muted'), true)
assert.equal(await colPriv('chat_id'), false, 'ยังห้ามอ่าน chat_id')
assert.equal((await db.query(`SELECT has_table_privilege('authenticated', 'public.telegram_user_links', 'UPDATE') AS ok`)).rows[0].ok, false,
  'แก้ dm_muted ผ่าน RPC เท่านั้น ไม่ให้ UPDATE ตรง')

// ── set_my_telegram_dm_muted ─────────────────────────────────────────────────────────────────
const setMuted = (user, muted) => as('authenticated', user, async () =>
  (await db.query('SELECT public.set_my_telegram_dm_muted($1) AS r', [muted])).rows[0].r)
assert.deepEqual(await setMuted(USER_A, ['event', 'oops', 'event', 'complaint']), ['complaint', 'event'], 'ทิ้งคีย์แปลก + ตัดซ้ำ + เรียง')
assert.deepEqual(await setMuted(USER_A, []), [])
assert.deepEqual(await setMuted(USER_A, null), [])
await rejects(setMuted(USER_B, ['event']), /not linked/, 'ยังไม่ผูก')
await rejects(as('anon', null, () => db.query(`SELECT public.set_my_telegram_dm_muted('{event}')`)), /permission denied/)
// แก้ได้แค่แถวตัวเอง — B เรียกไม่กระทบ A
await setMuted(USER_A, ['esign'])
await rejects(setMuted(USER_B, []), /not linked/)
assert.deepEqual((await db.query(`SELECT dm_muted FROM public.telegram_user_links WHERE user_id = $1`, [USER_A])).rows[0].dm_muted, ['esign'])

// ผูกใหม่ (แชทเดิมย้ายบัญชี/ผูกซ้ำ) ไม่ล้างค่าที่ตั้งไว้ของบัญชีนั้น — telegram_link_consume ไม่แตะคอลัมน์นี้
assert.equal(/dm_muted/.test(linkMigration), false)

// ── ช่องทาง telegram_dm ────────────────────────────────────────────────────────────────────
await db.query(`INSERT INTO public.notification_deliveries (municipality_id, channel, idempotency_key) VALUES ($1, 'telegram_dm', 'k1')`, [id(1)])
await rejects(db.query(`INSERT INTO public.notification_deliveries (municipality_id, channel, idempotency_key) VALUES ($1, 'sms', 'k2')`, [id(1)]), /channel_check/)

// ── esign_trip_turns: สิทธิ์ ───────────────────────────────────────────────────────────────
const fnPriv = async (role) => (await db.query(`SELECT has_function_privilege($1, 'public.esign_trip_turns(uuid)', 'EXECUTE') AS ok`, [role])).rows[0].ok
assert.equal(await fnPriv('service_role'), true)
assert.equal(await fnPriv('authenticated'), false, 'ผู้ใช้ทั่วไปห้ามรู้ว่าใบไหนถึงคิวใคร')
assert.equal(await fnPriv('anon'), false)

// ── esign_trip_turns: ลำดับคิว ──────────────────────────────────────────────────────────────
await db.query(`INSERT INTO public.test_signers VALUES ('requester', NULL, 'นักจัดการงานทั่วไป'), ('dept_head', $1, NULL), ('authority', $2, NULL), ('sk1', $3, NULL)`, [HEAD, BOSS, MAYOR])
const turns = async () => as('service_role', null, async () =>
  (await db.query('SELECT public.esign_trip_turns($1) AS r', [TRIP])).rows[0].r.map((t) => `${t.slot}:${t.user_id}`))
const setTrip = (status, slots) => db.query(
  `INSERT INTO public.fleet_trips (id, status, esign_slots, created_by) VALUES ($1, $2, $3, $4)
   ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, esign_slots = EXCLUDED.esign_slots`,
  [TRIP, status, slots == null ? null : JSON.stringify(slots), USER_A])
const sign = async (slot) => (await db.query(
  `INSERT INTO public.esign_signatures (doc_type, doc_id, slot) VALUES ('fleet_trip_request', $1, $2) RETURNING id`, [TRIP, slot])).rows[0].id
const ALL_ONLINE = { requester: 'online', dept_head: 'online', authority: 'online' }

await setTrip('approved', ALL_ONLINE)
assert.deepEqual(await turns(), [`requester:${USER_A}`], 'เริ่มที่ผู้ขอ')
const requesterSig = await sign('requester')
assert.deepEqual(await turns(), [`dept_head:${HEAD}`], 'ผู้ขอลงแล้ว → หัวหน้าส่วนราชการ')
await sign('dept_head')
assert.deepEqual(await turns(), [`authority:${BOSS}`])
await sign('authority')
assert.deepEqual(await turns(), [], 'ลงครบแล้ว')

// ถอนลายเซ็นผู้ขอ → คิวกลับไปที่ผู้ขอ (ช่องหลังยังไม่ถึงคิวเพราะช่องก่อนหน้าว่าง)
await db.exec('DELETE FROM public.esign_signatures WHERE slot IN (\'dept_head\', \'authority\')')
await db.query('INSERT INTO public.esign_revocations VALUES ($1)', [requesterSig])
assert.deepEqual(await turns(), [`requester:${USER_A}`])
await db.exec('DELETE FROM public.esign_signatures; DELETE FROM public.esign_revocations')

// ช่องผู้ขอเซ็นสด → ข้ามไปหัวหน้าเลย
await setTrip('pending', { requester: 'wet', dept_head: 'online', authority: 'online' })
assert.deepEqual(await turns(), [`dept_head:${HEAD}`])
// หัวหน้าเซ็นสด → ผู้มีอำนาจถึงคิวทันทีที่ผู้ขอลง
await setTrip('waitlisted', { requester: 'online', dept_head: 'wet', authority: 'online' })
await sign('requester')
assert.deepEqual(await turns(), [`authority:${BOSS}`])
await db.exec('DELETE FROM public.esign_signatures')

// สก.๑ เฉพาะผู้ขอเป็นนายก และไม่รอลำดับ (ตรงกับ esign_trip_status)
await setTrip('approved', { requester: 'online', sk1: 'online' })
assert.deepEqual(await turns(), [`requester:${USER_A}`], 'ผู้ขอไม่ใช่นายก → ไม่มีช่อง สก.๑')
await db.exec(`UPDATE public.test_signers SET position = 'นายกเทศมนตรีตำบลน้ำเลา' WHERE slot = 'requester'`)
assert.deepEqual(await turns(), [`requester:${USER_A}`, `sk1:${MAYOR}`])
await db.exec(`UPDATE public.test_signers SET position = 'นักจัดการงานทั่วไป' WHERE slot = 'requester'`)

// ไม่มีผู้ลงนามในทะเบียน → ไม่มีใครให้แจ้ง (หน้าเว็บแสดง "ยังไม่ได้ตั้ง" เอง)
await db.exec(`UPDATE public.test_signers SET user_id = NULL WHERE slot = 'dept_head'`)
await setTrip('approved', { requester: 'wet', dept_head: 'online' })
assert.deepEqual(await turns(), [])
await db.query(`UPDATE public.test_signers SET user_id = $1 WHERE slot = 'dept_head'`, [HEAD])

// ใบปิดแล้ว / ไม่ใช่โหมดออนไลน์ / ไม่มีใบ → ว่าง
for (const status of ['rejected', 'cancelled', 'completed']) {
  await setTrip(status, ALL_ONLINE)
  assert.deepEqual(await turns(), [], status)
}
await setTrip('approved', null)
assert.deepEqual(await turns(), [], 'ใบเซ็นสดทั้งใบ')
assert.deepEqual(await as('service_role', null, async () =>
  (await db.query('SELECT public.esign_trip_turns($1) AS r', [id(999)])).rows[0].r), [])

// ป้ายช่องมาจาก esign_slot_label() ไม่ได้พิมพ์เอง
await setTrip('approved', ALL_ONLINE)
assert.equal((await as('service_role', null, async () =>
  (await db.query('SELECT public.esign_trip_turns($1) AS r', [TRIP])).rows[0].r))[0].label, 'ป้าย:requester')

console.log('telegram-dm-db: ผ่านทั้งหมด')
