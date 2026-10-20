// ขอภาพจากกล้องวงจรปิด — supabase/migrations/20261021100000_cctv_footage_request_guard.sql
//   node tests/cctv-request-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//
// สิ่งที่ต้องไม่พัง: (1) ไม่ล็อกอิน/ไม่สังกัด/ยื่นแทนคนอื่น/อปท. ยังไม่เปิดบริการ = ยื่นไม่ได้ แม้ยิงตรงเข้าตาราง
// (2) ข้อมูลเหตุการณ์ผิดรูปแบบถูกปฏิเสธที่ฐานข้อมูล (3) กรอกผิดไม่เสียโควตา แต่ยื่นเกิน 5 ครั้ง/วันไม่ได้
// (4) ประเภทคำขออื่นไม่ถูกแตะเลย (5) ทุก อปท. ที่มีอยู่และที่สร้างใหม่ปิดบริการนี้เป็นค่าเริ่มต้น
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const rateLimitSql = await readMigration('20260905170000_rpc_rate_limit.sql')
const guardSql = await readMigration('20261021100000_cctv_footage_request_guard.sql')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const users = { citizen: U(1), citizen2: U(2), citizenB: U(3), staff: U(4), superadmin: U(5), nomuni: U(6) }
const roleOf = alias => ({ citizen2: 'citizen', citizenB: 'citizen', nomuni: 'citizen' }[alias] ?? alias)
const muniOf = alias => (alias === 'citizenB' ? B : ['superadmin', 'nomuni'].includes(alias) ? null : A)

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.jwt_role', true), '') $$;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text, fee_schedule jsonb);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, municipality_id uuid);
CREATE TABLE public.document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, document_type text NOT NULL,
  requester_name text, purpose text, status text, user_id uuid, permit_form_data jsonb
);
-- ตัวแทน trigger เดิมของตาราง ไว้เทียบลำดับชื่อ (ตัวจริงต้องมี route_document_request_department ซึ่งพึ่งของอื่นอีกมาก)
CREATE FUNCTION public.noop_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER protect_document_request_scope_trigger BEFORE INSERT ON public.document_requests FOR EACH ROW EXECUTE FUNCTION public.noop_trigger();
CREATE TRIGGER route_document_request_department_trigger BEFORE INSERT ON public.document_requests FOR EACH ROW EXECUTE FUNCTION public.noop_trigger();
-- อปท. ที่มีอยู่ก่อน apply: ไม่มี fee_schedule / มีรายการปิดอื่น / มีคีย์อื่นปนอยู่
INSERT INTO public.municipalities VALUES
  ('${A}', 'อปท. เอ', NULL),
  ('${B}', 'อปท. บี', '{"_removed_types":["tax_notice"],"_custom_types":[{"value":"x","label":"เอ็กซ์"}],"waste_collection":0}'),
  ('${C}', 'อปท. ซี', '{"_removed_types":"พัง-ไม่ใช่ array"}');
`)
await db.exec(rateLimitSql)
await db.exec(guardSql)

for (const [alias, id] of Object.entries(users)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [id])
  await db.query('INSERT INTO public.profiles VALUES ($1, $2, $3)', [id, roleOf(alias), muniOf(alias)])
}

const as = async (alias, jwtRole = 'authenticated') => {
  const anon = alias === 'anon'
  await db.query("SELECT set_config('test.uid', $1, false), set_config('test.jwt_role', $2, false), set_config('request.headers', '', false)",
    [anon ? '' : users[alias], alias === 'none' ? '' : anon ? 'anon' : jwtRole])
}
const asNoJwt = () => db.query("SELECT set_config('test.uid', '', false), set_config('test.jwt_role', '', false), set_config('request.headers', '', false)")

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
const shift = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)

const form = (over = {}) => ({
  form_type: 'cctv_footage_request', form_version: 1,
  incident_type: 'property_lost', incident_date: shift(-3), time_from: '18:30', time_to: '19:30',
  camera_id: null, camera_label: 'CCTV สี่แยกตลาด', description: 'รถจักรยานยนต์หาย', requester_role: 'victim', police_ref: '',
  ...over,
})
const insert = (alias, { muni = A, uid, type = 'cctv_footage_request', status = 'pending', data = form(), purpose = 'ขอภาพกล้องวงจรปิด' } = {}) =>
  db.query(
    'INSERT INTO public.document_requests (municipality_id, document_type, requester_name, purpose, status, user_id, permit_form_data) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [muni, type, 'ทดสอบ', purpose, status, uid === undefined ? (alias === 'anon' ? null : users[alias]) : uid, data === null ? null : JSON.stringify(data)])
const enable = muni => db.query(`UPDATE public.municipalities SET fee_schedule = jsonb_set(fee_schedule, '{_removed_types}', (fee_schedule -> '_removed_types') - 'cctv_footage_request') WHERE id = $1`, [muni])
const count = async () => (await db.query(`SELECT count(*)::int AS n FROM public.document_requests`)).rows[0].n

let cases = 0
const reset = async () => {
  await db.exec('DELETE FROM public.document_requests; DELETE FROM public.rpc_rate_limit;')
  await db.exec(`UPDATE public.municipalities SET fee_schedule = jsonb_set(COALESCE(fee_schedule, '{}'::jsonb), '{_removed_types}', COALESCE(fee_schedule -> '_removed_types', '[]'::jsonb) - 'cctv_footage_request') WHERE id = '${A}'`)
}
const test = async (label, run, { keep = false } = {}) => { if (!keep) await reset(); await as('citizen'); await run(); cases++; console.log('PASS ' + label) }
const rejects = (promise, code, message) => assert.rejects(promise, error => {
  assert.equal(error.code, code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (message) assert.match(error.message, message)
  return true
})

// ── ปิดเป็นค่าเริ่มต้น ─────────────────────────────────────────────────────────────────────────────
await test('อปท. ที่มีอยู่ถูกเติมค่าปิดบริการครั้งเดียว ค่าเดิมไม่หาย', async () => {
  const { rows } = await db.query(`SELECT id, fee_schedule FROM public.municipalities ORDER BY name`)
  const by = Object.fromEntries(rows.map(r => [r.id, r.fee_schedule]))
  assert.deepEqual(by[A]._removed_types, ['cctv_footage_request'])
  assert.deepEqual(by[B]._removed_types, ['tax_notice', 'cctv_footage_request'])
  assert.deepEqual(by[B]._custom_types, [{ value: 'x', label: 'เอ็กซ์' }])
  assert.equal(by[B].waste_collection, 0)
  assert.deepEqual(by[C]._removed_types, ['cctv_footage_request'])
}, { keep: true })

await test('apply ซ้ำไม่เติมซ้ำสองครั้ง', async () => {
  await db.exec(guardSql)
  const { rows } = await db.query(`SELECT fee_schedule -> '_removed_types' AS r FROM public.municipalities WHERE id = $1`, [B])
  assert.deepEqual(rows[0].r, ['tax_notice', 'cctv_footage_request'])
}, { keep: true })

await test('อปท. ที่สร้างใหม่ปิดบริการไว้เองทุกรูปแบบของ fee_schedule', async () => {
  const D = '00000000-0000-4000-8000-0000000000d1', E = '00000000-0000-4000-8000-0000000000d2', F = '00000000-0000-4000-8000-0000000000d3'
  await db.query(`INSERT INTO public.municipalities VALUES ($1, 'ใหม่ 1', NULL), ($2, 'ใหม่ 2', '{"_removed_types":["tax_notice"]}'), ($3, 'ใหม่ 3', '{"_removed_types":["cctv_footage_request"]}')`, [D, E, F])
  const { rows } = await db.query(`SELECT id, fee_schedule -> '_removed_types' AS r FROM public.municipalities WHERE id IN ($1,$2,$3)`, [D, E, F])
  const by = Object.fromEntries(rows.map(r => [r.id, r.r]))
  assert.deepEqual(by[D], ['cctv_footage_request'])
  assert.deepEqual(by[E], ['tax_notice', 'cctv_footage_request'])
  assert.deepEqual(by[F], ['cctv_footage_request'])
  await db.query('DELETE FROM public.municipalities WHERE id IN ($1,$2,$3)', [D, E, F])
}, { keep: true })

// ── ด่านตัวตน/สิทธิ์ ───────────────────────────────────────────────────────────────────────────────
await test('ตอนนี้ปิดบริการอยู่ → ผู้ล็อกอินที่สังกัดถูกก็ยื่นไม่ได้ · เปิดสวิตช์แล้วยื่นได้', async () => {
  // reset() เปิดบริการของ A ไว้ให้ข้ออื่นแล้ว — ใส่ค่าปิดกลับเพื่อทดสอบด่านปิด
  await db.query(`UPDATE public.municipalities SET fee_schedule = jsonb_set(fee_schedule, '{_removed_types}', '["cctv_footage_request"]') WHERE id = $1`, [A])
  await rejects(insert('citizen'), '42501', /ยังไม่เปิดบริการ/)
  assert.equal(await count(), 0)
  await enable(A)
  await insert('citizen')
  assert.equal(await count(), 1)
})

await test('ไม่ล็อกอิน (anon) ยื่นตรงเข้าตารางไม่ได้', async () => {
  await as('anon')
  await rejects(insert('anon'), '42501', /เข้าสู่ระบบ/)
  assert.equal(await count(), 0)
})

await test('ล็อกอินแต่สังกัด อปท. อื่น หรือไม่มีสังกัด ยื่นไม่ได้ · superadmin ผ่านได้', async () => {
  await as('citizenB'); await rejects(insert('citizenB'), '42501', /ไม่ได้สังกัด/)
  await as('nomuni'); await rejects(insert('nomuni'), '42501', /ไม่ได้สังกัด/)
  await as('superadmin'); await insert('superadmin')
  assert.equal(await count(), 1)
})

await test('ยื่นในชื่อคนอื่น หรือไม่ใส่ user_id ไม่ได้', async () => {
  await rejects(insert('citizen', { uid: users.citizen2 }), '42501', /ชื่อบัญชีของผู้ขอเอง/)
  await rejects(insert('citizen', { uid: null }), '42501', /ชื่อบัญชีของผู้ขอเอง/)
  assert.equal(await count(), 0)
})

await test('คำขอใหม่ต้องเริ่มที่ pending', async () => {
  await rejects(insert('citizen', { status: 'completed' }), '22023', /รอดำเนินการ/)
})

await test('ไม่มี JWT (psql/migration) และ service_role ข้ามด่านได้ · ประเภทอื่นไม่ถูกแตะแม้เป็น anon', async () => {
  await asNoJwt(); await insert('citizen', { data: null, uid: null })
  await as('citizen', 'service_role'); await insert('citizen', { data: null, uid: null })
  assert.equal(await count(), 2)
  await as('anon')
  await insert('anon', { type: 'tax_notice', data: null })
  await insert('anon', { type: 'building_permit', data: { whatever: 1 } })
  assert.equal(await count(), 4)
})

// ── ด่านรูปแบบข้อมูล ───────────────────────────────────────────────────────────────────────────────
await test('ข้อมูลถูกต้องผ่านและเก็บครบ · ช่องที่ไม่บังคับว่างได้', async () => {
  await insert('citizen')
  await insert('citizen', { data: form({ description: '', police_ref: undefined, camera_id: '3f2a0c1e-0000-4000-8000-000000000001', incident_date: today, incident_type: 'road_accident' }) })
  const { rows } = await db.query(`SELECT permit_form_data FROM public.document_requests ORDER BY id`)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(r => r.permit_form_data.form_type === 'cctv_footage_request'))
})

const bad = [
  ['permit_form_data ว่าง', { data: null }, /ไม่ครบ/],
  ['form_type ผิด', { data: form({ form_type: 'อื่น' }) }, /ไม่ครบ/],
  ['ไม่ใช่ object', { data: [1, 2] }, /ไม่ครบ/],
  ['มีคีย์นอกรายการ', { data: form({ ติดมา: 'x' }) }, /ไม่รู้จัก/],
  ['ประเภทเหตุนอกรายการ', { data: form({ incident_type: 'robbery' }) }, /ประเภทเหตุ/],
  ['ประเภทเหตุไม่ใช่ข้อความ', { data: form({ incident_type: 5 }) }, /ประเภทเหตุ/],
  ['ฐานะผู้ขอนอกรายการ', { data: form({ requester_role: 'ใครก็ได้' }) }, /ฐานะ/],
  ['วันที่รูปแบบผิด', { data: form({ incident_date: '12/10/2026' }) }, /วันที่เกิดเหตุไม่ถูกต้อง/],
  ['วันที่ไม่มีจริง', { data: form({ incident_date: '2026-02-31' }) }, /วันที่เกิดเหตุไม่ถูกต้อง/],
  ['วันที่ในอนาคต', { data: form({ incident_date: shift(1) }) }, /ไม่เกินวันนี้/],
  ['เหตุเกิดนานเกิน 1 ปี', { data: form({ incident_date: shift(-366) }) }, /เกิน 1 ปี/],
  ['เวลารูปแบบผิด (24:00)', { data: form({ time_to: '24:00' }) }, /เวลาที่ขอภาพไม่ถูกต้อง/],
  ['เวลาเป็นข้อความอื่น', { data: form({ time_from: '6 โมงเย็น' }) }, /เวลาที่ขอภาพไม่ถูกต้อง/],
  ['เวลาสิ้นสุดไม่หลังเริ่ม', { data: form({ time_from: '19:30', time_to: '19:30' }) }, /หลังเวลาเริ่มต้น/],
  ['ข้ามคืน (สิ้นสุดก่อนเริ่ม)', { data: form({ time_from: '23:30', time_to: '00:30' }) }, /หลังเวลาเริ่มต้น/],
  ['ช่วงเวลาเกิน 3 ชั่วโมง (181 นาที)', { data: form({ time_from: '10:00', time_to: '13:01' }) }, /ไม่เกิน 3 ชั่วโมง/],
  ['จุดกล้องว่าง', { data: form({ camera_label: '   ' }) }, /จุดกล้อง/],
  ['จุดกล้องยาวเกิน 120', { data: form({ camera_label: 'ก'.repeat(121) }) }, /1–120/],
  ['จุดกล้องไม่ใช่ข้อความ', { data: form({ camera_label: 7 }) }, /จุดกล้อง/],
  ['รหัสจุดกล้องเป็นตัวเลข', { data: form({ camera_id: 12 }) }, /รหัสจุดกล้อง/],
  ['รายละเอียดเกิน 300', { data: form({ description: 'ก'.repeat(301) }) }, /300/],
  ['เลือกอื่นๆ แต่ไม่อธิบาย', { data: form({ incident_type: 'other', description: '  ' }) }, /อธิบายเหตุการณ์/],
  ['เลขใบแจ้งความเกิน 50', { data: form({ police_ref: '1'.repeat(51) }) }, /50/],
  ['วัตถุประสงค์ (purpose) ยาวเกิน 200', { purpose: 'ก'.repeat(201) }, /วัตถุประสงค์/],
  ['ก้อนข้อมูลใหญ่เกิน 4 KB', { data: form({ description: 'ก'.repeat(300), police_ref: 'x'.repeat(50), camera_label: 'ข'.repeat(120), ซ้ำ: 'ก'.repeat(5000) }) }, /ไม่ครบ/],
]
for (const [label, opts, message] of bad) {
  await test('ปฏิเสธที่ฐานข้อมูล: ' + label, async () => {
    await rejects(insert('citizen', opts), '22023', message)
    assert.equal(await count(), 0)
  })
}

await test('ขอบเขตที่ต้องผ่าน: 180 นาทีพอดี · เหตุเมื่อ 365 วันก่อน · เหตุเมื่อกี้ (วันนี้)', async () => {
  await insert('citizen', { data: form({ time_from: '10:00', time_to: '13:00' }) })
  await insert('citizen', { data: form({ incident_date: shift(-365) }) })
  await insert('citizen', { data: form({ incident_date: today }) })
  assert.equal(await count(), 3)
})

// ── โควตา ───────────────────────────────────────────────────────────────────────────────────────
await test('ยื่นเกิน 5 คำขอ/วัน → PT429 · คนอื่นไม่ถูกนับรวม · กรอกผิดไม่เสียโควตา', async () => {
  for (let i = 0; i < 4; i++) await rejects(insert('citizen', { data: form({ incident_type: 'nope' }) }), '22023')
  for (let i = 0; i < 5; i++) await insert('citizen')
  await rejects(insert('citizen'), 'PT429', /ครบจำนวนต่อวัน/)
  assert.equal(await count(), 5)
  await as('superadmin'); await insert('superadmin')
  assert.equal(await count(), 6)
})

// ── โครงสร้าง ───────────────────────────────────────────────────────────────────────────────────
await test('trigger เรียงก่อน protect/route ตามชื่อ · ทำงานเฉพาะประเภทนี้ · ฟังก์ชันไม่เปิดให้ API เรียกตรง', async () => {
  const { rows } = await db.query(`SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = 'public.document_requests'::regclass AND NOT tgisinternal ORDER BY tgname`)
  assert.deepEqual(rows.map(r => r.tgname), ['guard_cctv_footage_request_trigger', 'protect_document_request_scope_trigger', 'route_document_request_department_trigger'])
  assert.match(rows[0].def, /BEFORE INSERT/)
  assert.match(rows[0].def, /cctv_footage_request/)
  for (const role of ['anon', 'authenticated', 'public']) {
    for (const fn of ['guard_cctv_footage_request', 'municipality_default_cctv_off']) {
      const ok = await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, `public.${fn}()`])
      assert.equal(ok.rows[0].ok, false, `${role} เรียกฟังก์ชัน ${fn} ได้`)
    }
  }
  // ไม่แตะฟังก์ชัน route ตัวจริง (กับดัก CREATE OR REPLACE ทับทั้งตัว)
  assert.doesNotMatch(guardSql, /CREATE OR REPLACE FUNCTION public\.route_document_request_department/i)
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
