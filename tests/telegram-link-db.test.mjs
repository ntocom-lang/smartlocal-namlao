// migration ผูก Telegram รายคน (ข้อ 3b ตั้งค่าแจ้งเตือน) — รันบน PostgreSQL จำลอง (PGlite) ไม่ต่อ Supabase จริง
// รันด้วย: PATIENT_PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js node tests/telegram-link-db.test.mjs
//   (PowerShell: $env:PATIENT_PGLITE_MODULE='D:/tmp/patient-booking-dbtest-20260918/node_modules/@electric-sql/pglite/dist/index.js')
//
// สิทธิ์ตั้งต้นจำลองค่าเริ่มต้นของ Supabase: ตารางใหม่ใน public ได้ ALL ให้ anon/authenticated/service_role
// (ALTER DEFAULT PRIVILEGES) — migration ต้องถอนเองให้เหลือเท่าที่ใช้

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

if (!process.env.PATIENT_PGLITE_MODULE) {
  console.error('ต้องตั้ง PATIENT_PGLITE_MODULE ชี้ไปที่ @electric-sql/pglite/dist/index.js (ดู docs/ai/PATIENT_BOOKING_HANDOFF.md)')
  process.exit(1)
}
const { PGlite } = await import(pathToFileURL(process.env.PATIENT_PGLITE_MODULE).href)
const migration = (await readFile(new URL('../supabase/migrations/20261029120000_telegram_personal_link.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const USER_A = id(11)
const USER_B = id(12)
const sha = (value) => createHash('sha256').update(value).digest('hex')

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
`)

await db.exec(migration)
await db.exec(migration) // รันซ้ำได้

async function as(role, user, fn) {
  await db.exec(`SET ROLE ${role}`)
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  try {
    return await fn()
  } finally {
    await db.exec('RESET ROLE')
  }
}
const consume = (hash, chat, display = null) => as('service_role', null, async () =>
  (await db.query('SELECT public.telegram_link_consume($1, $2, $3) AS r', [hash, chat, display])).rows[0].r)
const addToken = (user, token, minutes = 15) => db.query(
  `INSERT INTO public.telegram_link_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
  [sha(token), user, minutes],
)

// ── สิทธิ์: anon ไม่มีอะไรเลย · authenticated อ่านได้แค่ 3 ช่อง (ไม่เห็น chat_id) + ลบของตัวเอง ───────────
const tablePriv = async (role, table, privilege) => (await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, privilege])).rows[0].ok
const colPriv = async (role, column) => (await db.query(`SELECT has_column_privilege($1, 'public.telegram_user_links', $2, 'SELECT') AS ok`, [role, column])).rows[0].ok
for (const table of ['telegram_user_links', 'telegram_link_tokens', 'telegram_seen_chats']) {
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
    assert.equal(await tablePriv('anon', table, privilege), false, `anon ${privilege} ${table}`)
  }
}
for (const table of ['telegram_link_tokens', 'telegram_seen_chats']) {
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
    assert.equal(await tablePriv('authenticated', table, privilege), false, `authenticated ${privilege} ${table}`)
  }
}
for (const privilege of ['INSERT', 'UPDATE', 'TRUNCATE']) {
  assert.equal(await tablePriv('authenticated', 'telegram_user_links', privilege), false, `authenticated ${privilege}`)
}
assert.equal(await tablePriv('authenticated', 'telegram_user_links', 'DELETE'), true)
assert.equal(await colPriv('authenticated', 'chat_id'), false, 'ผู้ใช้ต้องไม่เห็น chat_id')
for (const column of ['user_id', 'tg_display', 'linked_at']) assert.equal(await colPriv('authenticated', column), true, column)
const execPriv = async (role) => (await db.query(`SELECT has_function_privilege($1, 'public.telegram_link_consume(text, bigint, text)', 'EXECUTE') AS ok`, [role])).rows[0].ok
assert.equal(await execPriv('anon'), false)
assert.equal(await execPriv('authenticated'), false, 'ผู้ใช้เรียก consume เองไม่ได้ (ไม่งั้นผูก chat ใครก็ได้)')
assert.equal(await execPriv('service_role'), true)

// ── ผูก: โทเคนถูก → linked · ใช้ซ้ำไม่ได้ · หมดอายุ · รูปแบบผิด ──────────────────────────────────
await addToken(USER_A, 'token-a-1')
await addToken(USER_A, 'token-a-2') // ลิงก์ที่สองที่ยังไม่ใช้ ต้องถูกปิดเมื่อผูกสำเร็จ
assert.equal(await consume(sha('token-a-1'), 111, '@somchai'), 'linked')
assert.equal(await consume(sha('token-a-1'), 111), 'invalid', 'ใช้ซ้ำไม่ได้')
assert.equal(await consume(sha('token-a-2'), 111), 'invalid', 'ลิงก์อื่นของคนเดิมถูกปิดแล้ว')
assert.equal(await consume(sha('ไม่มีโทเคนนี้'), 111), 'invalid')
assert.equal(await consume('ABC', 111), 'invalid')
await addToken(USER_B, 'token-b-old', -1)
assert.equal(await consume(sha('token-b-old'), 222), 'expired')
await addToken(USER_B, 'token-b-neg')
assert.equal(await consume(sha('token-b-neg'), -5), 'invalid', 'แชทกลุ่ม (รหัสติดลบ) ผูกเป็นของคนไม่ได้')

let links = (await db.query('SELECT user_id, chat_id::int AS chat_id, tg_display FROM public.telegram_user_links ORDER BY user_id')).rows
assert.deepEqual(links, [{ user_id: USER_A, chat_id: 111, tg_display: '@somchai' }])

// ── 1 แชทรับงานได้บัญชีเดียว: แชทเดิมผูกกับบัญชีใหม่ → ย้าย · บัญชีเดิมผูกแชทใหม่ → แทนที่ ────────────
await addToken(USER_B, 'token-b-1')
assert.equal(await consume(sha('token-b-1'), 111, 'x'.repeat(80)), 'linked')
links = (await db.query('SELECT user_id, chat_id::int AS chat_id, char_length(tg_display) AS len FROM public.telegram_user_links ORDER BY user_id')).rows
assert.deepEqual(links, [{ user_id: USER_B, chat_id: 111, len: 64 }], 'ย้ายแชทมาบัญชีใหม่ + ตัดชื่อไม่เกิน 64')
await addToken(USER_B, 'token-b-2')
assert.equal(await consume(sha('token-b-2'), 333), 'linked')
links = (await db.query('SELECT user_id, chat_id::int AS chat_id FROM public.telegram_user_links')).rows
assert.deepEqual(links, [{ user_id: USER_B, chat_id: 333 }])

// ── RLS: อ่าน/ลบได้เฉพาะของตัวเอง ─────────────────────────────────────────────────────
await addToken(USER_A, 'token-a-3')
assert.equal(await consume(sha('token-a-3'), 444), 'linked')
const seen = await as('authenticated', USER_A, async () => (await db.query('SELECT user_id, tg_display FROM public.telegram_user_links')).rows)
assert.deepEqual(seen, [{ user_id: USER_A, tg_display: null }])
await assert.rejects(as('authenticated', USER_A, () => db.query('SELECT chat_id FROM public.telegram_user_links')), /permission denied/)
await as('authenticated', USER_A, () => db.query('DELETE FROM public.telegram_user_links WHERE user_id = $1', [USER_B]))
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.telegram_user_links')).rows[0].n, 2, 'ลบของคนอื่นไม่ได้')
await as('authenticated', USER_A, () => db.query('DELETE FROM public.telegram_user_links WHERE user_id = $1', [USER_A]))
assert.deepEqual((await db.query('SELECT user_id FROM public.telegram_user_links')).rows, [{ user_id: USER_B }])
await assert.rejects(as('authenticated', USER_A, () => db.query(`INSERT INTO public.telegram_user_links (user_id, chat_id) VALUES ($1, 555)`, [USER_A])), /permission denied/)

// ── ตารางกลุ่มที่บอตเห็น: รับแค่รหัสติดลบ (กลุ่ม/แชนเนล) ไม่รับแชทส่วนตัว ───────────────────────────
await db.query(`INSERT INTO public.telegram_seen_chats (chat_id, chat_type, title) VALUES (-1001, 'supergroup', 'กลุ่มงาน')`)
await assert.rejects(db.query(`INSERT INTO public.telegram_seen_chats (chat_id, chat_type) VALUES (777, 'group')`), /check/i)
await assert.rejects(db.query(`INSERT INTO public.telegram_seen_chats (chat_id, chat_type) VALUES (-2, 'private')`), /check/i)

// ── ลบบัญชี → ลิงก์และโทเคนหายตาม ───────────────────────────────────────────────────
await addToken(USER_B, 'token-b-3')
await db.query('DELETE FROM auth.users WHERE id = $1', [USER_B])
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.telegram_user_links')).rows[0].n, 0)
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.telegram_link_tokens WHERE user_id = $1', [USER_B])).rows[0].n, 0)

console.log('telegram-link-db: ผ่านทั้งหมด')
