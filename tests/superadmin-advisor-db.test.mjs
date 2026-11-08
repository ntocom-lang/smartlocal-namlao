// ที่ปรึกษา AI เฉพาะ Super Admin — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/superadmin-advisor-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: 20261109120000 (ตาราง) → 20261109120100 (RLS/GRANT/trigger/แถวตั้งค่า)
//
// ตรวจ: (1) ด่านลำดับไฟล์ (2) superadmin อ่าน/แก้ตั้งค่าได้เฉพาะ 3 ช่อง · ประทับผู้แก้เอง (3) admin/staff/citizen/anon เห็น 0 แถว แก้ไม่ได้
// (4) ข้อความ: superadmin อ่าน/ลบได้เฉพาะของตัวเอง · เพิ่ม/แก้ไม่ได้ทุกบทบาท (Edge Function เขียนด้วย service_role)
// (5) CHECK ของ model/daily_cap/role (6) TRUNCATE ไม่ได้ (7) รันซ้ำได้
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261109120000_superadmin_advisor_tables.sql')
const rlsSql = await readMigration('20261109120100_superadmin_advisor_rls.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const M = id(1)
const U = { super1: id(101), super2: id(102), admin: id(103), staff: id(104), citizen: id(105) }
const ROLE = { super1: 'superadmin', super2: 'superadmin', admin: 'admin', staff: 'staff', citizen: 'citizen' }
const C1 = id(201)
const C2 = id(202)

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
-- จำลอง default privileges ของ Supabase: ตารางใหม่ใน public ได้สิทธิ์ทุกอย่างกับทุกบทบาท (migration ต้องถอนเอง)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
INSERT INTO public.municipalities VALUES ('${M}');
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

await test('ไฟล์ 2 รันก่อนไฟล์ 1 ไม่ได้ (ด่านหัวไฟล์)', async () => {
  await rejects(db.exec(rlsSql), { message: /ต้องรัน 20261109120000/ })
  await db.exec('ROLLBACK') // ไฟล์เปิด BEGIN ไว้ ด่านล้มกลาง transaction
}).catch(async e => { await db.exec('ROLLBACK').catch(() => {}); throw e })

await db.exec(tablesSql)

await test('หลังไฟล์ 1 อย่างเดียว: anon แตะไม่ได้ · authenticated เห็น 0 แถว เขียนไม่ได้ (ช่วงก่อนไฟล์ 2 ไม่เปิดโล่ง)', async () => {
  await actor('anon')
  await rejects(db.query('SELECT * FROM public.advisor_settings'), DENIED)
  await rejects(db.query('INSERT INTO public.advisor_settings (id, daily_cap) VALUES (1, 1000)'), DENIED)
  await rejects(db.query("INSERT INTO public.advisor_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'model', 'ปลอม')", [C1, U.super1]), DENIED)
  await actor('super1')
  assert.equal((await rows('SELECT * FROM public.advisor_settings')).length, 0)
  await rejects(db.query('INSERT INTO public.advisor_settings (id, daily_cap) VALUES (1, 1000)'), { code: '42501' })
  await rejects(db.query('TRUNCATE public.advisor_messages'), DENIED)
})

await db.exec(rlsSql)

// ข้อความตั้งต้น: Edge Function เขียนด้วย service_role (ข้าม RLS)
await actor('service')
await db.query(`INSERT INTO public.advisor_messages (conversation_id, user_id, role, content) VALUES
  ($1, $3, 'user', 'คำถามของ super1'), ($1, $3, 'model', 'คำตอบ'), ($2, $4, 'user', 'คำถามของ super2')`, [C1, C2, U.super1, U.super2])

await test('มีแถวตั้งค่าเริ่มต้นแถวเดียว: เปิด · gemini-3.5-flash · 100/วัน', async () => {
  const r = await rows('SELECT id, enabled, model, daily_cap FROM public.advisor_settings')
  assert.deepEqual(r, [{ id: 1, enabled: true, model: 'gemini-3.5-flash', daily_cap: 100 }])
})

await test('superadmin อ่านและแก้ตั้งค่าได้ · ระบบประทับผู้แก้/เวลาเอง (ส่งค่าปลอมมาไม่มีผล)', async () => {
  await actor('super1')
  assert.equal((await rows('SELECT * FROM public.advisor_settings')).length, 1)
  await db.query("UPDATE public.advisor_settings SET enabled = false, daily_cap = 50, model = 'gemini-2.5-pro' WHERE id = 1")
  await asRoot()
  const r = (await rows('SELECT enabled, daily_cap, model, updated_by FROM public.advisor_settings'))[0]
  assert.deepEqual(r, { enabled: false, daily_cap: 50, model: 'gemini-2.5-pro', updated_by: U.super1 })
})

await test('superadmin แก้ช่องอื่น (updated_by / id) ตรงๆ ไม่ได้ · เพิ่ม/ลบแถวตั้งค่าไม่ได้', async () => {
  await actor('super1')
  await rejects(db.query('UPDATE public.advisor_settings SET updated_by = $1 WHERE id = 1', [U.super2]), DENIED)
  await rejects(db.query('UPDATE public.advisor_settings SET id = 2'), DENIED)
  await rejects(db.query('INSERT INTO public.advisor_settings (id) VALUES (1)'), DENIED)
  await rejects(db.query('DELETE FROM public.advisor_settings'), DENIED)
})

await test('CHECK: ชื่อโมเดลแปลก / เพดานนอกช่วง ถูกปฏิเสธ', async () => {
  await actor('super1')
  for (const bad of ['../evil', 'Gemini Pro', 'x:generateContent?key=1', '']) {
    await rejects(db.query('UPDATE public.advisor_settings SET model = $1 WHERE id = 1', [bad]), { code: '23514' })
  }
  await rejects(db.query('UPDATE public.advisor_settings SET daily_cap = 0 WHERE id = 1'), { code: '23514' })
  await rejects(db.query('UPDATE public.advisor_settings SET daily_cap = 1001 WHERE id = 1'), { code: '23514' })
})

for (const who of ['admin', 'staff', 'citizen']) {
  await test(`${who}: เห็นตั้งค่า/ข้อความ 0 แถว · แก้/ลบไม่มีผล · เพิ่มข้อความไม่ได้`, async () => {
    await actor(who)
    assert.equal((await rows('SELECT * FROM public.advisor_settings')).length, 0)
    assert.equal((await rows('SELECT * FROM public.advisor_messages')).length, 0)
    const upd = await db.query('UPDATE public.advisor_settings SET enabled = true WHERE id = 1')
    assert.equal(upd.affectedRows, 0)
    const del = await db.query('DELETE FROM public.advisor_messages')
    assert.equal(del.affectedRows, 0)
    await rejects(db.query("INSERT INTO public.advisor_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'model', 'ปลอม')", [C1, U[who]]), DENIED)
  })
}

await test('anon: ไม่มีสิทธิ์อะไรเลยทั้ง 2 ตาราง', async () => {
  await actor('anon')
  await rejects(db.query('SELECT * FROM public.advisor_settings'), DENIED)
  await rejects(db.query('SELECT * FROM public.advisor_messages'), DENIED)
})

await test('superadmin เห็น/ลบได้เฉพาะข้อความของตัวเอง · เพิ่ม/แก้ไม่ได้ (ปลอมคำตอบ AI ไม่ได้)', async () => {
  await actor('super1')
  const mine = await rows('SELECT content FROM public.advisor_messages ORDER BY id')
  assert.deepEqual(mine.map(r => r.content), ['คำถามของ super1', 'คำตอบ'])
  await rejects(db.query("INSERT INTO public.advisor_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'model', 'ปลอม')", [C1, U.super1]), DENIED)
  await rejects(db.query("UPDATE public.advisor_messages SET content = 'แก้คำตอบ'"), DENIED)
  const delOther = await db.query('DELETE FROM public.advisor_messages WHERE conversation_id = $1', [C2])
  assert.equal(delOther.affectedRows, 0)
  const delMine = await db.query('DELETE FROM public.advisor_messages WHERE conversation_id = $1', [C1])
  assert.equal(delMine.affectedRows, 2)
  await asRoot()
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.advisor_messages'))[0].n, 1)
})

await test('CHECK: role ต้องเป็น user/model · ข้อความว่างไม่ได้', async () => {
  await actor('service')
  await rejects(db.query("INSERT INTO public.advisor_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'system', 'x')", [C1, U.super1]), { code: '23514' })
  await rejects(db.query("INSERT INTO public.advisor_messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'user', '')", [C1, U.super1]), { code: '23514' })
})

await test('authenticated TRUNCATE ไม่ได้ทั้ง 2 ตาราง (RLS กัน TRUNCATE ไม่ได้ — #657)', async () => {
  await actor('super1')
  await rejects(db.query('TRUNCATE public.advisor_messages'), DENIED)
  await rejects(db.query('TRUNCATE public.advisor_settings'), DENIED)
})

await test('รันทั้ง 2 ไฟล์ซ้ำได้ ไม่ทับตั้งค่าที่แก้ไว้ ไม่ทำข้อมูลหาย', async () => {
  await db.exec(tablesSql)
  await db.exec(rlsSql)
  const s = (await rows('SELECT daily_cap, model FROM public.advisor_settings'))[0]
  assert.deepEqual(s, { daily_cap: 50, model: 'gemini-2.5-pro' })
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.advisor_messages'))[0].n, 1)
})

await test('ลบบัญชีแล้วประวัติแชตหายตาม (CASCADE) · ลบบัญชีที่เคยแก้ตั้งค่าได้ และรอยผู้แก้ไม่ถูก trigger เขียนทับ (#658)', async () => {
  await db.query('DELETE FROM public.profiles WHERE id = $1', [U.super2])
  await db.query('DELETE FROM auth.users WHERE id = $1', [U.super2])
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.advisor_messages'))[0].n, 0)
  const before = (await rows('SELECT updated_by, updated_at FROM public.advisor_settings'))[0]
  assert.equal(before.updated_by, U.super1)
  // ลบในนามผู้ใช้อื่น (เหมือน delete_user_by_id) — ไม่มี FK จึงไม่มี UPDATE แฝงไปกระตุ้น trigger
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [U.admin])
  await db.query('DELETE FROM public.profiles WHERE id = $1', [U.super1])
  await db.query('DELETE FROM auth.users WHERE id = $1', [U.super1])
  const after = (await rows('SELECT updated_by, updated_at FROM public.advisor_settings'))[0]
  assert.deepEqual(after, before)
})

console.log(`\nsuperadmin-advisor-db: ผ่าน ${cases} กรณี`)
