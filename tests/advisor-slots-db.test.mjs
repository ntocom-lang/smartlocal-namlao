// ที่ปรึกษา AI รอบ 2 — ช่องผู้ให้บริการ 3 ช่อง + key ใน Vault · รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/advisor-slots-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: 20261109120000 → 20261109120100 (รอบ 1) → 20261109130000 → 20261109130100 (รอบ 2)
//   Vault จำลอง: PGlite ไม่มี supabase_vault จึงสร้าง vault.secrets / decrypted_secrets / create_secret / update_secret
//   ให้หน้าตาเดียวกับของจริง (ชื่อ + ลายเซ็นฟังก์ชัน) และปิดสิทธิ์ anon/authenticated แบบของจริง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const r1Tables = await readMigration('20261109120000_superadmin_advisor_tables.sql')
const r1Rls = await readMigration('20261109120100_superadmin_advisor_rls.sql')
const slotsTables = await readMigration('20261109130000_advisor_provider_slots_tables.sql')
const slotsRls = await readMigration('20261109130100_advisor_provider_slots_rls_vault.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const M = id(1)
const U = { super1: id(101), admin: id(103), staff: id(104), citizen: id(105) }
const ROLE = { super1: 'superadmin', admin: 'admin', staff: 'staff', citizen: 'citizen' }
const CLAUDE_KEY = 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ'
const GEMINI_KEY = 'AIza' + 'b'.repeat(30) + 'G123'

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen', municipality_id uuid);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
INSERT INTO public.municipalities VALUES ('${M}');

-- Vault จำลอง (ของจริงเข้ารหัสด้วย pgsodium/libsodium — ที่นี่เก็บตรงๆ เพราะเทสต์แค่สิทธิ์และลำดับการทำงาน)
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text, secret text NOT NULL);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret AS decrypted_secret FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
  RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets (name, description, secret) VALUES (new_name, new_description, new_secret) RETURNING id $$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description) WHERE id = secret_id $$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vault FROM PUBLIC;
`)
for (const [alias, uid] of Object.entries(U)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [uid])
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3)', [uid, ROLE[alias], ROLE[alias] === 'superadmin' ? null : M])
}

const actor = async alias => {
  await db.exec('RESET ROLE')
  const sub = alias && alias !== 'anon' && alias !== 'service' ? U[alias] : ''
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [sub])
  await db.exec(`SET ROLE ${alias === 'service' ? 'service_role' : alias && alias !== 'anon' ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const rejects = (promise, expect = {}) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const DENIED = { code: '42501' }
let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }
const setKey = (slot, key) => db.query('SELECT public.advisor_set_slot_key($1::smallint, $2) AS r', [slot, key])

await db.exec(r1Tables)
await db.exec(r1Rls)

await test('ไฟล์ 2 รอบ 2 รันก่อนไฟล์ 1 ไม่ได้', async () => {
  await rejects(db.exec(slotsRls), { message: /ต้องรัน 20261109130000/ })
  await db.exec('ROLLBACK')
}).catch(async e => { await db.exec('ROLLBACK').catch(() => {}); throw e })

await db.exec(slotsTables)

await test('หลังไฟล์ 1 อย่างเดียว: anon แตะไม่ได้ · authenticated เห็น 0 แถว เพิ่มแถวไม่ได้', async () => {
  await actor('anon')
  await rejects(db.query('SELECT * FROM public.advisor_provider_slots'), DENIED)
  await actor('super1')
  assert.equal((await rows('SELECT * FROM public.advisor_provider_slots')).length, 0)
  await rejects(db.query("INSERT INTO public.advisor_provider_slots (slot, provider, tier, model) VALUES (1, 'claude', 'paid', 'x1')"), { code: '42501' })
})

await test('ผู้รันที่ใช้ Vault ไม่ครบสิทธิ์ → ด่านหยุดก่อน COMMIT (ไม่ใช่ COMMIT ผ่านแล้วกดบันทึก key ได้ 42501)', async () => {
  await db.exec(`CREATE ROLE weak_owner; GRANT USAGE ON SCHEMA vault TO weak_owner;
    GRANT SELECT ON vault.secrets, vault.decrypted_secrets TO weak_owner;
    GRANT EXECUTE ON FUNCTION vault.create_secret(text,text,text,uuid), vault.update_secret(uuid,text,text,text,uuid) TO weak_owner;`)
  await db.exec('SET ROLE weak_owner') // มีทุกอย่างยกเว้น DELETE vault.secrets
  await rejects(db.exec(slotsRls), { message: /weak_owner ใช้ Vault ไม่ครบสิทธิ์/ })
  await db.exec('ROLLBACK')
}).catch(async e => { await db.exec('ROLLBACK').catch(() => {}); throw e })

await db.exec(slotsRls)

await test('แถวเริ่มต้น 3 ช่องตามลำดับ Claude → Gemini จ่าย → Gemini ฟรี · ช่อง 3 รับค่าจากรอบ 1', async () => {
  await actor('super1')
  const r = await rows('SELECT slot, provider, tier, model, daily_cap, key_last4 FROM public.advisor_provider_slots ORDER BY slot')
  assert.deepEqual(r.map(x => [x.slot, x.provider, x.tier]), [[1, 'claude', 'paid'], [2, 'gemini', 'paid'], [3, 'gemini', 'free']])
  assert.equal(r[0].model, 'claude-opus-5-5')
  assert.equal(r[0].daily_cap, 50) // ช่องจ่ายเงินเริ่มที่ 50/วัน กันเครดิตไหล
  assert.equal(r[1].daily_cap, 50)
  assert.equal(r[2].model, 'gemini-3.5-flash')
  assert.equal(r[2].daily_cap, 100)
  assert.ok(r.every(x => x.key_last4 === null))
})

await test('admin / staff / citizen เห็น 0 แถว แก้ไม่ได้ · anon ไม่มีสิทธิ์', async () => {
  for (const who of ['admin', 'staff', 'citizen']) {
    await actor(who)
    assert.equal((await rows('SELECT * FROM public.advisor_provider_slots')).length, 0, who)
    assert.equal((await db.query('UPDATE public.advisor_provider_slots SET enabled = false')).affectedRows, 0, who)
  }
  await actor('anon')
  await rejects(db.query('UPDATE public.advisor_provider_slots SET enabled = false'), DENIED)
})

await test('superadmin แก้ enabled/model/daily_cap ได้ (ว่าง = ไม่จำกัด) · ประทับผู้แก้เอง · แก้ provider/key ตรงไม่ได้', async () => {
  await actor('super1')
  await db.query("UPDATE public.advisor_provider_slots SET model = 'claude-sonnet-5-5', daily_cap = 50 WHERE slot = 1")
  await db.query('UPDATE public.advisor_provider_slots SET daily_cap = NULL WHERE slot = 3')
  const r = await rows('SELECT slot, model, daily_cap, updated_by FROM public.advisor_provider_slots WHERE slot IN (1, 3) ORDER BY slot')
  assert.equal(r[0].model, 'claude-sonnet-5-5')
  assert.equal(r[0].daily_cap, 50)
  assert.equal(r[1].daily_cap, null)
  assert.ok(r.every(x => x.updated_by === U.super1))
  await rejects(db.query("UPDATE public.advisor_provider_slots SET provider = 'gemini' WHERE slot = 1"), DENIED)
  await rejects(db.query("UPDATE public.advisor_provider_slots SET key_last4 = 'abcd' WHERE slot = 1"), DENIED)
  await rejects(db.query('UPDATE public.advisor_provider_slots SET key_invalid_at = NULL WHERE slot = 1'), DENIED)
  await rejects(db.query("UPDATE public.advisor_provider_slots SET model = 'BAD MODEL/../x' WHERE slot = 1"), { code: '23514' })
  await rejects(db.query('UPDATE public.advisor_provider_slots SET daily_cap = 0 WHERE slot = 1'), { code: '23514' })
})

await test('ใส่ key: เฉพาะ superadmin · ตรวจรูปแบบ · Claude ต้อง sk-ant- · คืนแค่ 4 ตัวท้าย', async () => {
  await actor('anon')
  await rejects(setKey(1, CLAUDE_KEY), DENIED)
  for (const who of ['admin', 'staff', 'citizen']) {
    await actor(who)
    await rejects(setKey(1, CLAUDE_KEY), DENIED)
  }
  await actor('super1')
  await rejects(setKey(1, 'short'), { code: '22023' })
  await rejects(setKey(1, 'sk-ant-has space ' + 'a'.repeat(30)), { code: '22023' })
  await rejects(setKey(1, GEMINI_KEY), { code: '22023', message: /sk-ant-/ })
  await rejects(setKey(9, CLAUDE_KEY), { code: '22023' })
  const r = (await setKey(1, CLAUDE_KEY)).rows[0].r
  assert.deepEqual(r, { slot: 1, key_last4: 'WXYZ' })
  assert.equal((await setKey(2, GEMINI_KEY)).rows[0].r.key_last4, 'G123')
  const s = await rows('SELECT slot, key_last4, key_set_at, updated_by FROM public.advisor_provider_slots WHERE slot IN (1, 2) ORDER BY slot')
  assert.deepEqual(s.map(x => x.key_last4), ['WXYZ', 'G123'])
  assert.ok(s.every(x => x.key_set_at && x.updated_by === U.super1))
  await rejects(db.query('SELECT * FROM vault.decrypted_secrets'), DENIED)
  await asRoot()
  assert.equal((await rows("SELECT count(*)::int AS n FROM vault.secrets WHERE name LIKE 'advisor_slot_%'"))[0].n, 2)
})

await test('อ่าน key จริงได้เฉพาะ service_role — superadmin เองก็อ่านกลับไม่ได้', async () => {
  for (const who of ['anon', 'super1', 'admin']) {
    await actor(who)
    await rejects(db.query('SELECT public.advisor_slot_key(1::smallint)'), DENIED)
  }
  await actor('service')
  assert.equal((await rows('SELECT public.advisor_slot_key(1::smallint) AS k'))[0].k, CLAUDE_KEY)
  assert.equal((await rows('SELECT public.advisor_slot_key(3::smallint) AS k'))[0].k, null) // ช่อง 3 ไม่มี key → Edge Function ใช้ GEMINI_API_KEY
})

await test('Edge Function ประทับพัก/key ผิด → updated_by ไม่ถูกทับ · ใส่ key ใหม่ล้างป้ายและปลดพัก · ไม่สร้าง secret ซ้ำ', async () => {
  await asRoot()
  const before = (await rows('SELECT updated_at FROM public.advisor_provider_slots WHERE slot = 1'))[0].updated_at
  await actor('service')
  await db.query("UPDATE public.advisor_provider_slots SET paused_until = now() + interval '1 hour', pause_reason = 'billing', key_invalid_at = now() WHERE slot = 1")
  await asRoot()
  const after = (await rows('SELECT updated_by, updated_at FROM public.advisor_provider_slots WHERE slot = 1'))[0]
  assert.equal(after.updated_by, U.super1)
  assert.equal(after.updated_at.getTime(), before.getTime())
  await actor('super1')
  const newKey = 'sk-ant-api03-' + 'c'.repeat(40) + 'NEW9'
  assert.equal((await setKey(1, newKey)).rows[0].r.key_last4, 'NEW9')
  const s = (await rows('SELECT paused_until, pause_reason, key_invalid_at FROM public.advisor_provider_slots WHERE slot = 1'))[0]
  assert.deepEqual([s.paused_until, s.pause_reason, s.key_invalid_at], [null, null, null])
  await asRoot()
  assert.equal((await rows("SELECT count(*)::int AS n FROM vault.secrets WHERE name = 'advisor_slot_1_key'"))[0].n, 1)
  await actor('service')
  assert.equal((await rows('SELECT public.advisor_slot_key(1::smallint) AS k'))[0].k, newKey)
})

await test('ปุ่ม "ปลดพัก": superadmin ล้างได้ทั้งคู่ · ล้างครึ่งเดียวผิด CHECK', async () => {
  await actor('service')
  await db.query("UPDATE public.advisor_provider_slots SET paused_until = now() + interval '15 minutes', pause_reason = 'rate_limit' WHERE slot = 2")
  await actor('super1')
  await rejects(db.query('UPDATE public.advisor_provider_slots SET paused_until = NULL WHERE slot = 2'), { code: '23514' })
  await db.query('UPDATE public.advisor_provider_slots SET paused_until = NULL, pause_reason = NULL WHERE slot = 2')
  const s = (await rows('SELECT paused_until, updated_by FROM public.advisor_provider_slots WHERE slot = 2'))[0]
  assert.equal(s.paused_until, null)
  assert.equal(s.updated_by, U.super1) // มีบันทึกว่าใครปลดพัก
  await rejects(db.query("UPDATE public.advisor_provider_slots SET paused_until = now(), pause_reason = 'whatever' WHERE slot = 2"), { code: '23514' })
})

await test('ลบ key (ส่งค่าว่าง): secret หาย · เลขท้ายหาย', async () => {
  await actor('super1')
  assert.equal((await setKey(2, '  ')).rows[0].r.key_last4, null)
  assert.equal((await rows('SELECT key_last4, key_secret_id FROM public.advisor_provider_slots WHERE slot = 2'))[0].key_last4, null)
  await asRoot()
  assert.equal((await rows("SELECT count(*)::int AS n FROM vault.secrets WHERE name = 'advisor_slot_2_key'"))[0].n, 0)
})

await test('advisor_messages คอลัมน์ใหม่: service_role เขียนช่อง/เหตุผล/ภาพรวมได้ · superadmin อ่านได้ · CHECK ทำงาน', async () => {
  const conv = id(301)
  await actor('service')
  await db.query(`INSERT INTO public.advisor_messages (conversation_id, user_id, role, content, model, slot, provider, route_note, context_snapshot)
    VALUES ($1, $2, 'model', 'คำตอบ', 'gemini-3.5-flash', 2, 'gemini', 'Claude: เครดิตหมด', '{"complaints":{"total":3}}')`, [conv, U.super1])
  await rejects(db.query("INSERT INTO public.advisor_messages (conversation_id, user_id, role, content, slot) VALUES ($1, $2, 'model', 'x', 4)", [conv, U.super1]), { code: '23514' })
  await rejects(db.query("INSERT INTO public.advisor_messages (conversation_id, user_id, role, content, provider) VALUES ($1, $2, 'model', 'x', 'openai')", [conv, U.super1]), { code: '23514' })
  await actor('super1')
  const r = await rows('SELECT slot, provider, route_note, context_snapshot FROM public.advisor_messages WHERE conversation_id = $1', [conv])
  assert.equal(r.length, 1)
  assert.equal(r[0].provider, 'gemini')
  assert.deepEqual(r[0].context_snapshot, { complaints: { total: 3 } })
})

await test('รันซ้ำทั้ง 2 ไฟล์ได้ · ค่าที่ตั้งไว้และ key คงอยู่', async () => {
  await db.exec(slotsTables)
  await db.exec(slotsRls)
  const r = await rows('SELECT slot, model, key_last4 FROM public.advisor_provider_slots ORDER BY slot')
  assert.equal(r.length, 3)
  assert.equal(r[0].model, 'claude-sonnet-5-5')
  assert.equal(r[0].key_last4, 'NEW9')
  await actor('service')
  assert.ok((await rows('SELECT public.advisor_slot_key(1::smallint) AS k'))[0].k.endsWith('NEW9'))
})

await test('TRUNCATE ไม่ได้ทุกบทบาทหน้าเว็บ', async () => {
  for (const who of ['anon', 'super1']) {
    await actor(who)
    await rejects(db.query('TRUNCATE public.advisor_provider_slots'), DENIED)
  }
})

console.log(`\n${cases} cases passed`)
