// โหมดขั้นตอนขอใช้รถราย อปท. (P1) — supabase/migrations/20261121100000_fleet_permit_tables.sql + ..100100_fleet_permit_functions.sql
//   node tests/fleet-permit-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// รัน migration จริงของชุดลงนามออนไลน์ทั้งหมด (ตามลำดับเดียวกับฐานจริง) แล้วต่อด้วยสองไฟล์ใหม่ ใน PostgreSQL จำลอง
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง (ติดตั้ง PGlite: npm install --prefix <temp> @electric-sql/pglite@0.5.8)
//
// สิ่งที่ต้องไม่พัง:
//  (1) อปท. ที่ไม่ได้ตั้งค่า / ตั้ง queue = ทำงานเหมือนเดิม: ใบเดิมและใบใหม่เป็น queue ออกรถได้ทันที
//  (2) regulation: บันทึกออกรถไม่ได้จนได้รับอนุญาต (ลายเซ็นออนไลน์ผู้มีอำนาจ / สก.๑ ของนายก / บันทึกใบกระดาษ)
//  (3) โหมดตรึงต่อใบ: client ปลอมไม่ได้ สลับโหมด อปท. แล้วใบเดิมไม่เปลี่ยน · บันทึกย้อนหลังเป็น queue
//  (4) มอบ ผอ.กอง (ข้อ ๑๒ ว.๔): ผอ.ของกองเป็นผู้อนุญาต · ผอ.ขอเอง / ไม่มีผู้ลงนามกอง / ผู้ขอเป็นนายก → กลับไปที่ผู้มีอำนาจ
//  (5) สิทธิ์: ตั้งค่า = แอดมิน อปท. · บันทึก/ยกเลิก = ผู้ดูแลรถ อปท. นั้น · ข้าม อปท. ไม่ได้ · บันทึกแก้/ลบไม่ได้
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const pgliteUrl = pathToFileURL(modulePath)
const { PGlite } = await import(pgliteUrl.href)
const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js', pgliteUrl).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const fleetHelpersSrc = await readMigration('20260816130000_harden_fleet_assets_and_documents.sql')
const ESIGN_CHAIN = [
  '20260905170000_rpc_rate_limit.sql',
  '20261022100000_esign_columns.sql',
  '20261022100100_esign_tables.sql',
  '20261022100200_esign_functions.sql',
  '20261022110000_esign_policy_optional.sql',
  '20261022110100_esign_gate_relax_functions.sql',
  '20261023100000_esign_image_tables.sql',
  '20261023100100_esign_image_functions.sql',
  '20261023110000_esign_trip_panel_functions.sql',
  '20261025120000_esign_trip_admin_delete.sql',
  '20261031100000_esign_fallback_column.sql',
  '20261031100100_esign_fallback_functions.sql',
  '20261101120000_esign_trip_returns_table.sql',
  '20261101120100_esign_trip_return_functions.sql',
]
const permitTablesSql = await readMigration('20261121100000_fleet_permit_tables.sql')
const permitFunctionsSql = await readMigration('20261121100100_fleet_permit_functions.sql')
// P2 (ผอ.ที่ได้รับมอบลงนามอนุญาตออนไลน์) โหลดต่อท้าย ⇒ ทุกกรณีของ P1 รันบนฟังก์ชันฉบับ P2 ด้วย
// --no-p2 = รันเฉพาะ P1 (red-check: กรณี P2 ต้องล้ม)
const WITH_P2 = !process.argv.includes('--no-p2')
const permitP2Sql = await readMigration('20261122100000_fleet_permit_delegated_esign.sql')
// P3 (ข้อ ๑๒ ว.๕) รันต่อท้าย P2 — approver ของ P3 ตั้งต้นจากรุ่น P2 ⇒ --no-p2 ข้าม P3 ด้วย (ด่าน md5 ของ P3 ต้องการรุ่น P2)
// --no-p3 = P1+P2 (red-check: กรณี P3 ต้องล้ม) · กรณี P1/P2 ทั้งหมดจึงเป็นตัวตรวจว่า P3 ไม่ทำให้ของเดิมถอยหลัง
const WITH_P3 = WITH_P2 && !process.argv.includes('--no-p3')
const positionCarColumnsSql = await readMigration('20261123100000_fleet_position_car_columns.sql')
const positionCarFunctionsSql = await readMigration('20261123100100_fleet_position_car_functions.sql')

const extractFunction = (source, startPattern) => {
  const found = startPattern.exec(source)
  assert.ok(found, `ไม่พบฟังก์ชันที่ขึ้นต้นด้วย ${startPattern}`)
  const rest = source.slice(found.index)
  const end = rest.search(/\n\$\$;/)
  assert.ok(end > 0, 'ไม่พบ $$; ปิดฟังก์ชัน')
  return rest.slice(0, end + 4)
}
const fleetFns = [
  /CREATE OR REPLACE FUNCTION public\.fleet_can_read\(p_municipality_id uuid\)/,
  /CREATE OR REPLACE FUNCTION public\.fleet_is_manager\(p_municipality_id uuid\)/,
  /CREATE OR REPLACE FUNCTION public\.fleet_can_read_asset\(/,
].map(p => extractFunction(fleetHelpersSrc, p))

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const D1 = '00000000-0000-4000-8000-0000000000d1'
const D2 = '00000000-0000-4000-8000-0000000000d2'
const V1 = '00000000-0000-4000-8000-0000000000e1'
const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.positions (id uuid PRIMARY KEY, name text, municipality_id uuid);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text);
CREATE TABLE public.fleet_vehicles (id uuid PRIMARY KEY, name text, municipality_id uuid, department_id uuid, is_pool boolean DEFAULT true,
  license_plate text NOT NULL DEFAULT 'กข 1234', status text NOT NULL DEFAULT 'active', regulation_category text NOT NULL DEFAULT 'central', disposed_date date);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, full_name text, role text, municipality_id uuid, fleet_role text, job_title text, position_id uuid, department_id uuid
);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.role', true), '') $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.muni', true), '')::uuid $$;
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text, metadata jsonb, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.document_signatories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL, document_type text NOT NULL DEFAULT 'complaint',
  signatory_role text NOT NULL, department_id uuid, profile_id uuid, manual_name text, custom_label text, title_override text,
  effective_from date NOT NULL DEFAULT (timezone('Asia/Bangkok', now())::date), effective_to date,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((profile_id IS NOT NULL AND manual_name IS NULL) OR (profile_id IS NULL AND NULLIF(btrim(manual_name), '') IS NOT NULL))
);
CREATE TABLE public.fleet_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
  vehicle_id uuid, department_id uuid, driver_id uuid, status text NOT NULL DEFAULT 'pending',
  requested_by uuid, created_by uuid, requester_position text,
  destination text NOT NULL DEFAULT 'ที่ทำการปกครองอำเภอ', destination_locality text, destination_province text,
  purpose text NOT NULL DEFAULT 'ประชุมประจำเดือน', passengers smallint NOT NULL DEFAULT 1,
  planned_departure timestamptz, planned_return timestamptz, document_date date,
  dept_head_department_id uuid, order_authority_role text, order_authority_label text,
  started_at timestamptz, returned_at timestamptz, odometer_start numeric, odometer_end numeric,
  approved_by uuid, approved_at timestamptz, approval_method text, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.municipalities VALUES ('${A}', 'อบต.ทดสอบเอ'), ('${B}', 'อบต.ทดสอบบี');
INSERT INTO public.departments VALUES ('${D1}', '${A}', 'กองช่าง'), ('${D2}', '${A}', 'กองคลัง');
INSERT INTO public.fleet_vehicles VALUES ('${V1}', 'รถกระบะ', '${A}', NULL, true);
`)

// ใบเดิมที่มีอยู่ก่อน migration (รวมใบที่กำลังเดินทาง) — ต้องไม่ถูกแตะ
for (const status of ['approved', 'in_progress', 'completed']) {
  await db.query(`INSERT INTO public.fleet_trips (municipality_id, status, destination) VALUES ($1, $2, $3)`, [A, status, `LEGACY-${status}`])
}
for (const fn of fleetFns) await db.exec(fn)
for (const name of ESIGN_CHAIN) await db.exec(await readMigration(name))
await db.exec(permitTablesSql)
await db.exec(permitFunctionsSql)
if (WITH_P2) {
  await db.exec(permitP2Sql)
  await db.exec(permitP2Sql) // รันซ้ำได้ (ด่าน md5 ยอมรับฉบับที่ไฟล์นี้ลงไปแล้ว)
}
if (WITH_P3) {
  await db.exec(positionCarColumnsSql)
  await db.exec(positionCarFunctionsSql)
}

const users = {
  adminA: { id: U(1), role: 'admin', muni: A, name: 'แอดมิน เอ' },
  adminB: { id: U(2), role: 'admin', muni: B, name: 'แอดมิน บี' },
  superadmin: { id: U(3), role: 'superadmin', muni: null, name: 'ซูเปอร์แอดมิน' },
  // dept = กองในโปรไฟล์ (P2: ผู้อนุมัติที่ได้รับมอบ = ผอ.ของกองผู้ขอตามโปรไฟล์ ไม่ใช่กองที่เลือกในใบ)
  requester: { id: U(4), role: 'staff', muni: A, name: 'สมหญิง ผู้ขอ', fleetRole: 'fleet_staff', job: 'นักวิชาการศึกษา', dept: D1 },
  head: { id: U(5), role: 'staff', muni: A, name: 'สมชาย หัวหน้ากอง', fleetRole: 'fleet_staff', job: 'ผู้อำนวยการกองช่าง', dept: D1 },
  mayor: { id: U(6), role: 'viewer', muni: A, name: 'สมศักดิ์ นายก', job: 'นายกองค์การบริหารส่วนตำบลทดสอบเอ' },
  fleetAdmin: { id: U(8), role: 'staff', muni: A, name: 'สมบัติ ผู้ดูแลรถ', fleetRole: 'fleet_admin' },
  outsider: { id: U(9), role: 'staff', muni: A, name: 'สมปอง ไม่มีสิทธิ์รถ' },
  fleetAdminB: { id: U(11), role: 'staff', muni: B, name: 'สมคิด ผู้ดูแลรถ บี', fleetRole: 'fleet_admin' },
}
for (const u of Object.values(users)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [u.id])
  await db.query('INSERT INTO public.profiles (id, full_name, role, municipality_id, fleet_role, job_title, department_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [u.id, u.name, u.role, u.muni, u.fleetRole ?? null, u.job ?? null, u.dept ?? null])
}
const as = async alias => {
  const u = users[alias]
  await db.query("SELECT set_config('test.uid', $1, false), set_config('test.role', $2, false), set_config('test.muni', $3, false)",
    [u ? u.id : '', u ? u.role : '', u ? (u.muni ?? '') : ''])
}

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}
const rpc = async (sql, params = []) => (await db.query(`SELECT ${sql} AS r`, params)).rows[0].r
const expectError = async (promise, pattern) => {
  await assert.rejects(promise, error => { assert.match(String(error.message), pattern, `ข้อความ error ผิด: ${error.message}`); return true })
}
const today = (await db.query(`SELECT (timezone('Asia/Bangkok', now()))::date::text AS d`)).rows[0].d
const trip = async id => (await db.query('SELECT * FROM public.fleet_trips WHERE id = $1', [id])).rows[0]
const makeTrip = async (extra = {}) => {
  const f = { muni: A, status: 'approved', requester: 'requester', position: 'นักวิชาการศึกษา', dept: D1, permit: undefined, ...extra }
  const cols = ['municipality_id', 'status', 'requested_by', 'created_by', 'requester_position', 'department_id', 'vehicle_id',
    'planned_departure', 'planned_return', 'document_date']
  const vals = [f.muni, f.status, users[f.requester].id, users[f.requester].id, f.position, f.dept, V1,
    '2026-11-03 09:00+07', '2026-11-03 16:00+07', '2026-10-30']
  if (f.permit !== undefined) { cols.push('permit_mode'); vals.push(f.permit) }
  const { rows } = await db.query(
    `INSERT INTO public.fleet_trips (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals)
  return rows[0]
}
const depart = id => db.query(`UPDATE public.fleet_trips SET status = 'in_progress', started_at = now() WHERE id = $1`, [id])
const setMode = async (mode, { delegate = false, ref = null, date = null, muni = A, alias = 'adminA' } = {}) => {
  await as(alias)
  return rpc('public.fleet_permit_settings_set($1, $2, $3, $4, $5)', [muni, mode, delegate, ref, date])
}
const addRegistry = (role, alias, { dept = null, manual = null, muni = A, title = null } = {}) =>
  db.query(`INSERT INTO public.document_signatories (municipality_id, signatory_role, department_id, profile_id, manual_name, title_override)
            VALUES ($1,$2,$3,$4,$5,$6)`, [muni, role, dept, alias ? users[alias].id : null, manual, title])
const addSignature = async (tripId, slot, decision, alias) => {
  const { rows } = await db.query(
    // registry_signatory_id = แถวทะเบียนล่าสุดของผู้ลงนาม เหมือนที่ esign_sign_fleet_trip บันทึกจาก esign_expected_signer
    // (P3 ใช้ตัดสินว่าลายเซ็นช่องอนุญาตมาจากนายกจริงไหม)
    `INSERT INTO public.esign_signatures (municipality_id, doc_type, doc_id, slot, signer_id, signer_name, signed_as, decision,
       content_hash, content_snapshot, template_version, registry_signatory_id)
     VALUES ($1, 'fleet_trip_request', $2, $3, $4, $5, '', $6, $7, '{}'::jsonb, 'fleet-form3-v1',
       (SELECT ds.id FROM public.document_signatories ds WHERE ds.municipality_id = $1 AND ds.profile_id = $4
        ORDER BY ds.created_at DESC LIMIT 1)) RETURNING id`,
    [A, tripId, slot, users[alias].id, users[alias].name, decision, 'a'.repeat(64)])
  return rows[0].id
}
const info = async (tripId, alias) => {
  await as(alias)
  const r = await rpc('public.fleet_trip_permit_info($1::uuid[])', [[tripId]])
  assert.equal(r.ok, true, JSON.stringify(r))
  return r.items.find(i => i.trip_id === tripId)
}

await addRegistry('mayor', 'mayor')

// ── (1) ไม่มีใครตั้งค่า = แบบเดิมทุกอย่าง ────────────────────────────────────────────────────────
await test('ใบเดิมก่อน migration เป็น queue ทุกใบ · ไม่มีแถวตั้งค่า', async () => {
  const { rows } = await db.query(`SELECT permit_mode, count(*)::int AS n FROM public.fleet_trips GROUP BY 1`)
  assert.deepEqual(rows, [{ permit_mode: 'queue', n: 3 }])
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.fleet_permit_settings')).rows[0].n, 0)
})

await test('ไม่ตั้งค่า: ใบใหม่เป็น queue ออกรถได้ทันที · info ตอบ not_required', async () => {
  await as('requester')
  const t = await makeTrip()
  assert.equal(t.permit_mode, 'queue')
  await depart(t.id)
  assert.equal((await trip(t.id)).status, 'in_progress')
  assert.equal((await info(t.id, 'requester')).state, 'not_required')
})

await test('ไม่ตั้งค่า: settings_get ได้ค่าเริ่มต้น queue · คนที่ไม่มีสิทธิ์รถ/นอก อปท. อ่านไม่ได้', async () => {
  await as('requester')
  const r = await rpc('public.fleet_permit_settings_get($1)', [A])
  assert.equal(r.ok, true)
  assert.equal(r.permit_mode, 'queue')
  assert.equal(r.can_edit, false)
  await as('outsider')
  assert.equal((await rpc('public.fleet_permit_settings_get($1)', [A])).code, 'forbidden')
  await as('fleetAdminB')
  assert.equal((await rpc('public.fleet_permit_settings_get($1)', [A])).code, 'forbidden')
})

// ── (5) ตั้งค่า: แอดมิน อปท. เท่านั้น ──────────────────────────────────────────────────────────
await test('ตั้งค่า: ผู้ดูแลรถ/แอดมิน อปท. อื่น ตั้งไม่ได้ · แอดมิน อปท. ตั้งได้ + บันทึก audit', async () => {
  assert.equal((await setMode('regulation', { alias: 'fleetAdmin' })).code, 'forbidden')
  assert.equal((await setMode('regulation', { alias: 'adminB' })).code, 'forbidden')
  assert.equal((await setMode('bogus')).code, 'bad_mode')
  assert.equal((await setMode('regulation', { delegate: true })).code, 'delegation_evidence_required')
  assert.equal((await setMode('regulation', { delegate: true, ref: 'ที่ 123/2569', date: '2999-01-01' })).code, 'bad_delegation_date')
  // ด่าน: อปท. บียังไม่มีนายกในทะเบียน = เปิด regulation ไม่ได้ (ไม่งั้นทุกใบออกรถไม่ได้) · queue ตั้งได้
  assert.equal((await setMode('regulation', { alias: 'adminB', muni: B })).code, 'gate_authority_missing')
  assert.equal((await setMode('queue', { alias: 'adminB', muni: B })).ok, true)
  const r = await setMode('regulation')
  assert.equal(r.ok, true)
  assert.equal(r.permit_mode, 'regulation')
  assert.equal(r.can_edit, true)
  const { rows } = await db.query(`SELECT metadata FROM public.audit_logs WHERE action = 'fleet_permit_settings_updated' AND municipality_id = $1`, [A])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].metadata.new.permit_mode, 'regulation')
  assert.equal(rows[0].metadata.old, null)
})

await test('ตั้งค่า: ตาราง/ฟังก์ชันภายในไม่เปิดให้ authenticated/anon', async () => {
  for (const [obj, priv] of [
    ['public.fleet_permit_settings', 'SELECT'], ['public.fleet_trip_permits', 'SELECT'], ['public.fleet_trip_permits', 'INSERT'],
  ]) {
    for (const role of ['authenticated', 'anon']) {
      assert.equal((await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, obj, priv])).rows[0].ok, false, `${role} ${priv} ${obj}`)
    }
  }
  for (const fn of ['public.fleet_trip_permit_state(public.fleet_trips)', 'public.fleet_trip_permit_approver(public.fleet_trips, date)',
    'public.fleet_permit_registry(uuid, text, uuid, text, date)']) {
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated', $1, 'execute') AS ok`, [fn])).rows[0].ok, false, fn)
  }
  for (const fn of ['public.fleet_trip_permit_info(uuid[])', 'public.fleet_record_paper_permit(uuid, text, date)']) {
    assert.equal((await db.query(`SELECT has_function_privilege('anon', $1, 'execute') AS ok`, [fn])).rows[0].ok, false, fn)
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated', $1, 'execute') AS ok`, [fn])).rows[0].ok, true, fn)
  }
})

// ── (2)(3) regulation ──────────────────────────────────────────────────────────────────────────
await test('regulation: ใบใหม่ตรึง regulation · ออกรถไม่ได้ (FLEET_PERMIT_REQUIRED) · info = waiting ผู้อนุญาต = นายก', async () => {
  await as('requester')
  const t = await makeTrip()
  assert.equal(t.permit_mode, 'regulation')
  await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
  assert.equal((await trip(t.id)).status, 'approved')
  const i = await info(t.id, 'requester')
  assert.equal(i.state, 'waiting')
  assert.equal(i.approver.kind, 'authority')
  assert.equal(i.approver.name, users.mayor.name)
  assert.equal(i.can_record, false, 'ผู้ขอทั่วไปบันทึกการอนุญาตไม่ได้')
  assert.equal((await info(t.id, 'fleetAdmin')).can_record, true)
})

await test('regulation: client ปลอม permit_mode ไม่ได้ทั้ง INSERT และ UPDATE', async () => {
  await as('requester')
  const t = await makeTrip({ permit: 'queue' })
  assert.equal(t.permit_mode, 'regulation')
  await db.query(`UPDATE public.fleet_trips SET permit_mode = 'queue' WHERE id = $1`, [t.id])
  assert.equal((await trip(t.id)).permit_mode, 'regulation')
  await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
})

await test('regulation: INSERT เป็น in_progress ตรงๆ ไม่ได้ · บันทึกย้อนหลัง (completed) เป็น queue', async () => {
  await as('fleetAdmin')
  await expectError(makeTrip({ status: 'in_progress' }), /FLEET_PERMIT_REQUIRED/)
  const t = await makeTrip({ status: 'completed' })
  assert.equal(t.permit_mode, 'queue')
})

await test('regulation: แก้ฟิลด์อื่น / ยกเลิกใบที่ยังไม่อนุญาตได้ตามปกติ (ด่านจับเฉพาะการออกรถ)', async () => {
  await as('requester')
  const t = await makeTrip()
  await db.query(`UPDATE public.fleet_trips SET notes = 'แก้ได้' WHERE id = $1`, [t.id])
  await db.query(`UPDATE public.fleet_trips SET status = 'cancelled' WHERE id = $1`, [t.id])
  assert.equal((await trip(t.id)).status, 'cancelled')
})

await test('ปลดล็อกด้วยลายเซ็นออนไลน์ช่องผู้มีอำนาจ (approve) · ถอนลายเซ็นแล้วกลับเป็น waiting', async () => {
  await as('requester')
  const t = await makeTrip()
  const sig = await addSignature(t.id, 'authority', 'approve', 'mayor')
  let i = await info(t.id, 'requester')
  assert.equal(i.state, 'authorized')
  assert.equal(i.via, 'esign')
  await db.query(`INSERT INTO public.esign_revocations (signature_id, municipality_id, reason) VALUES ($1, $2, 'ทดสอบถอน')`, [sig, A])
  i = await info(t.id, 'requester')
  assert.equal(i.state, 'waiting')
  await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
  await addSignature(t.id, 'authority', 'approve', 'mayor')
  await depart(t.id)
  assert.equal((await trip(t.id)).status, 'in_progress')
})

await test('ลายเซ็นช่องผู้ขอ/ผอ.กอง ไม่นับเป็นการอนุญาต', async () => {
  await as('requester')
  const t = await makeTrip()
  await addSignature(t.id, 'requester', 'sign', 'requester')
  await addSignature(t.id, 'dept_head', 'sign', 'head')
  assert.equal((await info(t.id, 'requester')).state, 'waiting')
  await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
})

await test('ผู้ขอเป็นนายก: ลงนาม สก.๑ = อนุญาต (ข้อ ๑๒ ว.๖) · ผู้ขอทั่วไปลงนาม สก.๑ ไม่นับ', async () => {
  await as('mayor')
  const t = await makeTrip({ requester: 'mayor', position: 'นายกองค์การบริหารส่วนตำบลทดสอบเอ' })
  await addSignature(t.id, 'sk1', 'sign', 'mayor')
  assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
  await as('requester')
  const t2 = await makeTrip()
  await addSignature(t2.id, 'sk1', 'sign', 'requester')
  assert.equal((await info(t2.id, 'fleetAdmin')).state, 'waiting')
})

await test('ใบออนไลน์ถูกส่งคืนผู้ขอ = returned (ยังออกรถไม่ได้)', async () => {
  await as('requester')
  const t = await makeTrip()
  await db.query(`INSERT INTO public.esign_trip_returns (municipality_id, doc_type, doc_id, kind, slot, actor_id, actor_name, reason)
                  VALUES ($1, 'fleet_trip_request', $2, 'returned', 'authority', $3, 'นายก', 'ขอข้อมูลเพิ่ม')`, [A, t.id, users.mayor.id])
  assert.equal((await info(t.id, 'requester')).state, 'returned')
  await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
})

await test('บันทึกใบกระดาษ: ผู้ดูแลรถบันทึกได้ ชื่อมาจากทะเบียน · ออกรถได้ · บันทึกซ้ำไม่ได้', async () => {
  await as('requester')
  const t = await makeTrip()
  await as('fleetAdmin')
  const r = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])
  assert.equal(r.ok, true, JSON.stringify(r))
  const i = await info(t.id, 'fleetAdmin')
  assert.equal(i.state, 'authorized')
  assert.equal(i.via, 'paper')
  assert.equal(i.signer_name, users.mayor.name)
  assert.equal(i.recorded_by_name, users.fleetAdmin.name)
  assert.equal(i.can_void, true)
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).code, 'already_authorized')
  await as('requester')
  await depart(t.id)
  assert.equal((await trip(t.id)).status, 'in_progress')
  assert.equal((await info(t.id, 'fleetAdmin')).can_void, false, 'ออกรถแล้วยกเลิกไม่ได้')
})

await test('บันทึกใบกระดาษ: ผู้ขอ/ผู้ดูแลรถ อปท. อื่น บันทึกไม่ได้ · วันที่อนาคต/เกิน 60 วัน/basis ผิด ไม่รับ', async () => {
  await as('requester')
  const t = await makeTrip()
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).code, 'forbidden')
  await as('fleetAdminB')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).code, 'forbidden')
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', '2999-01-01'])).code, 'bad_date')
  assert.equal((await rpc(`public.fleet_record_paper_permit($1, $2, ($3::date - 61))`, [t.id, 'authority', today])).code, 'bad_date')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'whoever', today])).code, 'bad_basis')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'delegated_dept_head', today])).code, 'delegation_not_applicable')
})

await test('บันทึกใบกระดาษ: ใบ queue ไม่ต้องบันทึก · ใบที่ออกรถ/ยกเลิกแล้วบันทึกไม่ได้', async () => {
  const legacy = (await db.query(`SELECT id FROM public.fleet_trips WHERE destination = 'LEGACY-approved'`)).rows[0].id
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [legacy, 'authority', today])).code, 'not_required')
  await as('requester')
  const t = await makeTrip()
  await db.query(`UPDATE public.fleet_trips SET status = 'cancelled' WHERE id = $1`, [t.id])
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).code, 'bad_status')
})

await test('ยกเลิกบันทึกที่ผิด: ต้องมีเหตุผล · กลับเป็น waiting · ยกเลิกซ้ำไม่ได้ · แถวเดิมแก้/ลบไม่ได้', async () => {
  await as('requester')
  const t = await makeTrip()
  await as('fleetAdmin')
  const { permit_id: pid } = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])
  assert.equal((await rpc('public.fleet_void_paper_permit($1, $2)', [pid, 'x'])).code, 'bad_reason')
  await as('fleetAdminB')
  assert.equal((await rpc('public.fleet_void_paper_permit($1, $2)', [pid, 'บันทึกผิดใบ'])).code, 'forbidden')
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_void_paper_permit($1, $2)', [pid, 'บันทึกผิดใบ'])).ok, true)
  assert.equal((await rpc('public.fleet_void_paper_permit($1, $2)', [pid, 'บันทึกผิดใบ'])).code, 'already_voided')
  assert.equal((await info(t.id, 'fleetAdmin')).state, 'waiting')
  await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
  await expectError(db.query(`UPDATE public.fleet_trip_permits SET signer_name = 'ปลอม' WHERE id = $1`, [pid]), /FLEET_PERMIT_APPEND_ONLY/)
  await expectError(db.query(`DELETE FROM public.fleet_trip_permits WHERE id = $1`, [pid]), /FLEET_PERMIT_APPEND_ONLY/)
  await expectError(db.query(`TRUNCATE public.fleet_trip_permits`), /FLEET_PERMIT_APPEND_ONLY/)
})

await test('ทะเบียนยังไม่มีนายก = บันทึกไม่ได้ (signatory_missing) ไม่ใช่ชื่อว่าง', async () => {
  await as('fleetAdmin')
  const { rows } = await db.query(`INSERT INTO public.fleet_trips (municipality_id, status, requested_by, created_by, department_id, order_authority_role)
                                   VALUES ($1, 'approved', $2, $2, $3, 'clerk') RETURNING id`, [A, users.requester.id, D1])
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [rows[0].id, 'authority', today])).code, 'signatory_missing')
})

await test('แก้เนื้อหาคำขอหลังบันทึกใบกระดาษ = modified ออกรถไม่ได้ · แก้กลับเหมือนเดิมนับได้อีก · บันทึกใหม่ได้', async () => {
  await as('requester')
  const t = await makeTrip()
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).ok, true)
  await db.query(`UPDATE public.fleet_trips SET destination = 'เปลี่ยนปลายทางไกลกว่าเดิม' WHERE id = $1`, [t.id])
  let i = await info(t.id, 'fleetAdmin')
  assert.equal(i.state, 'modified')
  assert.equal(i.can_record, true)
  assert.equal(i.can_void, true)
  await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
  // แก้ฟิลด์ที่ไม่ใช่เนื้อหาคำขอ (หมายเหตุ/รถ/ผู้ขับ) ไม่กระทบการอนุญาต
  await db.query(`UPDATE public.fleet_trips SET destination = 'ที่ทำการปกครองอำเภอ' WHERE id = $1`, [t.id])
  await db.query(`UPDATE public.fleet_trips SET notes = 'แก้หมายเหตุ', driver_id = $2 WHERE id = $1`, [t.id, users.fleetAdmin.id])
  assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
  await db.query(`UPDATE public.fleet_trips SET planned_return = planned_return + interval '1 day' WHERE id = $1`, [t.id])
  assert.equal((await info(t.id, 'fleetAdmin')).state, 'modified')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).ok, true)
  i = await info(t.id, 'fleetAdmin')
  assert.equal(i.state, 'authorized')
  await as('requester')
  await depart(t.id)
})

await test('ผู้ลงนามที่ถูกเปลี่ยนแล้ว: บันทึกใบที่ลงนามก่อนวันเปลี่ยนได้ชื่อคนเดิม · วันนี้ได้คนใหม่ · แถวปิดไม่นับเป็นปัจจุบัน', async () => {
  const oldClerk = { id: U(20), role: 'staff', muni: A, name: 'สมพร ปลัดคนเดิม' }
  const newClerk = { id: U(21), role: 'staff', muni: A, name: 'สมฤดี ปลัดคนใหม่' }
  for (const u of [oldClerk, newClerk]) {
    await db.query('INSERT INTO auth.users VALUES ($1)', [u.id])
    await db.query('INSERT INTO public.profiles (id, full_name, role, municipality_id) VALUES ($1,$2,$3,$4)', [u.id, u.name, u.role, u.muni])
  }
  // ปลัดคนเดิมมีผลตั้งแต่ 30 วันก่อน ถูกปิดเมื่อวาน (is_active=false, updated_at=เมื่อวาน) คนใหม่มีผลตั้งแต่เมื่อวาน
  await db.query(`INSERT INTO public.document_signatories (municipality_id, signatory_role, profile_id, effective_from, is_active, created_at, updated_at)
                  VALUES ($1, 'clerk', $2, $3::date - 30, false, now() - interval '30 days', now() - interval '1 day')`, [A, oldClerk.id, today])
  await db.query(`INSERT INTO public.document_signatories (municipality_id, signatory_role, profile_id, effective_from, created_at)
                  VALUES ($1, 'clerk', $2, $3::date - 1, now() - interval '1 day')`, [A, newClerk.id, today])
  await as('fleetAdmin')
  const mk = async () => (await db.query(`INSERT INTO public.fleet_trips (municipality_id, status, requested_by, created_by, department_id, order_authority_role)
                                          VALUES ($1, 'approved', $2, $2, $3, 'clerk') RETURNING id`, [A, users.requester.id, D1])).rows[0].id
  const t1 = await mk()
  assert.equal((await rpc(`public.fleet_record_paper_permit($1, 'authority', ($2::date - 3))`, [t1, today])).ok, true)
  const t2 = await mk()
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t2, 'authority', today])).ok, true)
  const names = (await db.query(`SELECT trip_id, signer_name FROM public.fleet_trip_permits WHERE trip_id = ANY($1::uuid[])`, [[t1, t2]])).rows
  assert.equal(names.find(r => r.trip_id === t1).signer_name, oldClerk.name)
  assert.equal(names.find(r => r.trip_id === t2).signer_name, newClerk.name)
  // เกินช่วงที่ทั้งสองแถวมีผล (ก่อนแถวเก่าเริ่ม) = ไม่มีผู้ลงนาม
  const t3 = await mk()
  assert.equal((await rpc(`public.fleet_record_paper_permit($1, 'authority', ($2::date - 40))`, [t3, today])).code, 'signatory_missing')
})

await test('ผู้ขอที่ช่องตำแหน่งในคำขอว่างแต่โปรไฟล์เป็นนายก: สก.๑ นับเป็นการอนุญาต (ตำแหน่งเดียวกับระบบลงนาม)', async () => {
  await as('mayor')
  const t = await makeTrip({ requester: 'mayor', position: '' })
  await addSignature(t.id, 'sk1', 'sign', 'mayor')
  assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
})

// ── (4) มอบ ผอ.กอง ─────────────────────────────────────────────────────────────────────────────
await test('มอบ ผอ.กอง: ผู้อนุญาต = ผอ.ของกองในทะเบียน · บันทึก delegated พร้อมเลขที่คำสั่ง · ออกรถได้', async () => {
  await addRegistry('department_head', 'head', { dept: D1 })
  assert.equal((await setMode('regulation', { delegate: true, ref: 'คำสั่ง อบต. ที่ 45/2569', date: '2026-10-01' })).ok, true)
  await as('requester')
  const t = await makeTrip()
  const i = await info(t.id, 'fleetAdmin')
  assert.equal(i.approver.kind, 'delegated_dept_head')
  assert.equal(i.approver.name, users.head.name)
  assert.equal(i.approver.delegation_ref, 'คำสั่ง อบต. ที่ 45/2569')
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'delegated_dept_head', today])).ok, true)
  const { rows } = await db.query(`SELECT basis, signer_name, delegation_ref, delegation_date::text FROM public.fleet_trip_permits WHERE trip_id = $1`, [t.id])
  assert.deepEqual(rows[0], { basis: 'delegated_dept_head', signer_name: users.head.name, delegation_ref: 'คำสั่ง อบต. ที่ 45/2569', delegation_date: '2026-10-01' })
  await as('requester')
  await depart(t.id)
})

await test('มอบ ผอ.กอง: นายกยังอนุญาตได้เสมอ (basis authority)', async () => {
  await as('requester')
  const t = await makeTrip()
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).ok, true)
})

await test('มอบ ผอ.กอง: ผอ.ขอเอง / กองไม่มีผู้ลงนาม / ผู้ขอเป็นนายก → กลับไปที่ผู้มีอำนาจ', async () => {
  await as('head')
  const self = await makeTrip({ requester: 'head', position: 'ผู้อำนวยการกองช่าง' })
  let i = await info(self.id, 'fleetAdmin')
  assert.equal(i.approver.kind, 'authority')
  assert.equal(i.approver.fallback_reason, 'self_request')
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [self.id, 'delegated_dept_head', today])).code, 'delegation_not_applicable')

  // ผู้ขอสังกัดกองคลัง (ยังไม่มี ผอ. ในทะเบียน) — P2 ยึดกองในโปรไฟล์ P1 ยึดกองของใบ ทั้งคู่ได้ no_dept_head
  await db.query('UPDATE public.profiles SET department_id = $2 WHERE id = $1', [users.outsider.id, D2])
  await as('outsider')
  const noHead = await makeTrip({ requester: 'outsider', position: 'เจ้าพนักงานการเงิน', dept: D2 })
  i = await info(noHead.id, 'fleetAdmin')
  assert.equal(i.approver.fallback_reason, 'no_dept_head')
  await db.query('UPDATE public.profiles SET department_id = NULL WHERE id = $1', [users.outsider.id])

  await as('mayor')
  const exec = await makeTrip({ requester: 'mayor', position: 'นายกองค์การบริหารส่วนตำบลทดสอบเอ' })
  i = await info(exec.id, 'fleetAdmin')
  assert.equal(i.approver.fallback_reason, 'requester_is_executive')
})

await test('มอบ ผอ.กอง: ลงนามก่อนวันที่คำสั่งมอบหมาย = ผอ. ยังไม่มีอำนาจ (delegation_not_in_effect)', async () => {
  // คำสั่งมอบหมายลงวันที่ 5 วันก่อน (คิดจากวันนี้ ไม่ผูกปฏิทิน) — ลงนามเมื่อ 10 วันก่อนใช้การมอบไม่ได้
  const orderDate = (await db.query(`SELECT ($1::date - 5)::text AS d`, [today])).rows[0].d
  assert.equal((await setMode('regulation', { delegate: true, ref: 'คำสั่ง อบต. ที่ 46/2569', date: orderDate })).ok, true)
  await as('requester')
  const t = await makeTrip()
  await as('fleetAdmin')
  const r = await rpc(`public.fleet_record_paper_permit($1, 'delegated_dept_head', ($2::date - 10))`, [t.id, today])
  assert.equal(r.code, 'delegation_not_applicable')
  assert.equal(r.fallback_reason, 'delegation_not_in_effect')
  // แถว ผอ. ในทะเบียนจำลองมีผลตั้งแต่วันนี้ (ย้อนไป 5 วันจะได้ no_dept_head ซึ่งถูกต้อง) ⇒ บันทึกด้วยวันนี้
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'delegated_dept_head', today])).ok, true)
})

// ── (3) สลับโหมดกลับ ───────────────────────────────────────────────────────────────────────────
await test('สลับกลับ queue: ใบ regulation ที่ค้างยังต้องได้รับอนุญาต · ใบใหม่เป็น queue ออกรถได้ทันที', async () => {
  await as('requester')
  const pending = await makeTrip()
  assert.equal((await setMode('queue')).ok, true)
  assert.equal((await trip(pending.id)).permit_mode, 'regulation')
  await expectError(depart(pending.id), /FLEET_PERMIT_REQUIRED/)
  await as('requester')
  const fresh = await makeTrip()
  assert.equal(fresh.permit_mode, 'queue')
  await depart(fresh.id)
})

await test('info: คนที่อ่านทริปไม่ได้ไม่เห็นใบ · ผู้ดูแล อปท. อื่นไม่เห็น · ส่งเกิน 300 ใบไม่รับ', async () => {
  await as('requester')
  const t = await makeTrip()
  await as('outsider')
  assert.deepEqual((await rpc('public.fleet_trip_permit_info($1::uuid[])', [[t.id]])).items, [])
  await as('fleetAdminB')
  assert.deepEqual((await rpc('public.fleet_trip_permit_info($1::uuid[])', [[t.id]])).items, [])
  const many = Array.from({ length: 301 }, () => t.id)
  await as('fleetAdmin')
  assert.equal((await rpc('public.fleet_trip_permit_info($1::uuid[])', [many])).code, 'too_many')
})

await test('superadmin (municipality_id ว่าง) ใช้ได้ทุก RPC — ไม่ติดกับดัก my_fleet()', async () => {
  assert.equal((await setMode('regulation', { alias: 'superadmin' })).ok, true)
  await as('requester')
  const t = await makeTrip()
  await as('superadmin')
  assert.equal((await rpc('public.fleet_permit_settings_get($1)', [A])).ok, true)
  assert.equal((await info(t.id, 'superadmin')).state, 'waiting')
  assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).ok, true)
})

// ── (P2) ผอ.กองที่ได้รับมอบลงนามอนุญาตออนไลน์ (ข้อ ๑๒ ว.๔) ──────────────────────────────────────────
// เจ้าของตัดสิน 2026-11-12: ผอ. ลงทั้งช่อง ผอ. และช่องอนุญาต (2 ลายเซ็น) · ฐานะ "… ปฏิบัติราชการแทน…" ไม่มีเลขคำสั่ง
if (WITH_P2) {
  const MAYOR_TITLE = 'นายกองค์การบริหารส่วนตำบลทดสอบเอ'
  const ACTING = `ผู้อำนวยการกองช่าง ปฏิบัติราชการแทน${MAYOR_TITLE}`
  users.head2 = { id: U(12), role: 'staff', muni: A, name: 'สมใจ ผอ.กองคลัง', fleetRole: 'fleet_staff', job: 'ผู้อำนวยการกองคลัง', dept: D2 }
  users.staff2 = { id: U(13), role: 'staff', muni: A, name: 'สมพร กองคลัง', fleetRole: 'fleet_staff', job: 'นักวิชาการเงินและบัญชี', dept: D2 }
  for (const alias of ['head2', 'staff2']) {
    const u = users[alias]
    await db.query('INSERT INTO auth.users VALUES ($1)', [u.id])
    await db.query('INSERT INTO public.profiles (id, full_name, role, municipality_id, fleet_role, job_title, department_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [u.id, u.name, u.role, A, u.fleetRole, u.job, u.dept])
  }
  const sign = async (alias, tripId, slot) => {
    await as(alias)
    return rpc('public.esign_sign_fleet_trip($1, $2, $3, NULL)', [tripId, slot, '246810'])
  }
  const status = async (alias, tripId) => {
    await as(alias)
    const s = await rpc('public.esign_trip_status($1)', [tripId])
    return Object.fromEntries(s.slots.map(x => [x.slot, x]))
  }

  // เปิดลงนามออนไลน์ 3 ช่อง (ตั้งตรงในตาราง — ประตูเปิดสวิตช์มีเทสต์ของตัวเองใน esign-db) + ตั้งรหัสให้ผู้ลงนาม
  await db.query(`INSERT INTO public.esign_doc_type_settings (municipality_id, doc_type, slot_modes)
    VALUES ($1, 'fleet_trip_request', '{"requester":"online","dept_head":"online","authority":"online","sk1":"wet"}'::jsonb)
    ON CONFLICT (municipality_id, doc_type) DO UPDATE SET slot_modes = EXCLUDED.slot_modes`, [A])
  for (const alias of ['requester', 'head', 'mayor', 'staff2']) {
    await as(alias)
    assert.deepEqual(await rpc(`public.set_esign_pin('246810', NULL, true)`), { ok: true }, alias)
  }
  await addRegistry('department_head', 'head2', { dept: D2 }) // head2 ยังไม่ตั้งรหัสลงนาม
  await db.query(`UPDATE public.document_signatories SET title_override = $1 WHERE signatory_role = 'mayor' AND is_active`, [MAYOR_TITLE])
  assert.equal((await setMode('regulation', { delegate: true, ref: 'คำสั่ง อบต. ที่ 45/2569', date: '2026-10-01' })).ok, true)

  await test('P2 มอบ ผอ.: ช่องอนุญาตคาดหวัง ผอ. · ผอ. ลงสองช่องต่อกัน · ฐานะปฏิบัติราชการแทน · นายกลงไม่ได้ · ออกรถได้', async () => {
    await as('requester')
    const t = await makeTrip()
    assert.equal(t.permit_mode, 'regulation')
    assert.deepEqual(t.esign_slots, { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'wet' })
    assert.equal(t.esign_fallback, null)
    let s = await status('head', t.id)
    assert.equal(s.authority.expected_name, users.head.name)
    assert.equal(s.dept_head.expected_name, users.head.name)
    assert.equal(s.authority.waiting_for_previous, true)
    assert.equal((await sign('mayor', t.id, 'authority')).code, 'not_your_slot')
    assert.equal((await sign('requester', t.id, 'requester')).ok, true)
    assert.equal((await sign('head', t.id, 'dept_head')).ok, true)
    s = await status('head', t.id)
    assert.equal(s.authority.can_sign, true, 'ลงช่อง ผอ. แล้ว ช่องอนุญาตต้องถึงคิว ผอ. คนเดิมทันที')
    await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
    const r = await sign('head', t.id, 'authority')
    assert.equal(r.ok, true)
    assert.equal(r.complete, true)
    const { rows } = await db.query(`SELECT slot, signer_id, signed_as, decision FROM public.esign_signatures WHERE doc_id = $1`, [t.id])
    assert.deepEqual(rows.find(x => x.slot === 'authority'), { slot: 'authority', signer_id: users.head.id, signed_as: ACTING, decision: 'approve' })
    assert.equal(rows.find(x => x.slot === 'dept_head').signed_as, 'ผู้อำนวยการกองช่าง', 'ช่อง ผอ. ยังเป็นฐานะเดิม')
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.state, 'authorized')
    assert.equal(i.via, 'esign')
    assert.equal(i.signer_title, ACTING)
    await as('requester')
    await depart(t.id)
  })

  await test('P2 info: approver ของใบที่มอบมี acting_title · ใบที่กลับไปหานายกไม่มี', async () => {
    await as('requester')
    const t = await makeTrip()
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.approver.kind, 'delegated_dept_head')
    assert.equal(i.approver.acting_title, ACTING)
    await as('head')
    const self = await makeTrip({ requester: 'head', position: 'ผู้อำนวยการกองช่าง' })
    const j = await info(self.id, 'fleetAdmin')
    assert.equal(j.approver.kind, 'authority')
    assert.equal(j.approver.acting_title, undefined)
  })

  await test('P2 ผอ.ขอเอง: ช่องอนุญาตกลับไปที่นายก (ไม่ใช้ฐานะปฏิบัติราชการแทน)', async () => {
    await as('head')
    const t = await makeTrip({ requester: 'head', position: 'ผู้อำนวยการกองช่าง' })
    const s = await status('mayor', t.id)
    assert.equal(s.authority.expected_name, users.mayor.name)
    assert.equal((await sign('head', t.id, 'requester')).ok, true)
    assert.equal((await sign('head', t.id, 'dept_head')).ok, true)
    assert.equal((await sign('head', t.id, 'authority')).code, 'not_your_slot')
    assert.equal((await sign('mayor', t.id, 'authority')).ok, true)
    const { rows } = await db.query(`SELECT signed_as FROM public.esign_signatures WHERE doc_id = $1 AND slot = 'authority'`, [t.id])
    assert.equal(rows[0].signed_as, MAYOR_TITLE)
  })

  await test('P2 ตรึงช่องตอนยื่น ตรวจความพร้อมของ ผอ. ที่ได้รับมอบ (ไม่ใช่นายก) — trigger ตั้งโหมดก่อน esign guard', async () => {
    // ผู้ขอสังกัดกองคลัง: ผอ. (head2) ยังไม่ตั้งรหัส นายกตั้งแล้ว ⇒ ช่องอนุญาตต้องตกเป็นเซ็นสด เหตุผล pin_not_set
    await as('staff2')
    const t = await makeTrip({ requester: 'staff2', position: 'นักวิชาการเงินและบัญชี', dept: D2 })
    assert.equal(t.permit_mode, 'regulation')
    assert.deepEqual(t.esign_fallback, { dept_head: 'pin_not_set', authority: 'pin_not_set' })
    assert.equal(t.esign_slots.authority, 'wet')
    // client ส่งโหมดมาเองไม่มีผล (ค่าของ อปท. ชนะ)
    const forged = await makeTrip({ requester: 'staff2', position: 'นักวิชาการเงินและบัญชี', dept: D2, permit: 'queue' })
    assert.equal(forged.permit_mode, 'regulation')
    assert.deepEqual(forged.esign_fallback, { dept_head: 'pin_not_set', authority: 'pin_not_set' })
  })


  await test('P2 ผู้อนุมัติ = ผอ.ของกองผู้ขอตามโปรไฟล์: เลือก ผอ.กองอื่นในช่อง ผอ. / แก้กองของใบ ไม่ทำให้ ผอ.กองอื่นอนุมัติได้', async () => {
    // (ก) เจ้าหน้าที่กองช่างเลือก ผอ.กองคลังในช่อง ผอ. และใส่กองของใบเป็นกองคลัง
    await as('requester')
    const t = await makeTrip({ dept: D2 })
    await db.query('UPDATE public.fleet_trips SET dept_head_department_id = $2 WHERE id = $1', [t.id, D2])
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.approver.kind, 'delegated_dept_head')
    assert.equal(i.approver.name, users.head.name, 'ผู้อนุมัติต้องเป็น ผอ.กองช่าง (กองของผู้ขอ) ไม่ใช่ ผอ.กองคลัง')
    assert.equal(i.approver.department_id, D1)
    const s = await status('head', t.id)
    assert.equal(s.authority.expected_name, users.head.name)
    assert.equal(s.dept_head.expected_name, users.head2.name, 'ช่อง ผอ. (เสนอความเห็น) ยังเป็นกองที่เลือก')
    assert.equal((await sign('head2', t.id, 'authority')).code, 'not_your_slot')
  })

  await test('P2 ผอ.ขอเองแต่เลือกกองอื่น ยังเป็น self_request → นายก (ปิดทาง ผอ. สองกองอนุมัติให้กัน)', async () => {
    await as('head')
    const t = await makeTrip({ requester: 'head', position: 'ผู้อำนวยการกองช่าง', dept: D2 })
    await db.query('UPDATE public.fleet_trips SET dept_head_department_id = $2 WHERE id = $1', [t.id, D2])
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.approver.kind, 'authority')
    assert.equal(i.approver.fallback_reason, 'self_request')
    assert.equal((await status('mayor', t.id)).authority.expected_name, users.mayor.name)
  })

  await test('P2 ผอ. กรอกใบแทนลูกน้อง (created_by = ผอ.) = self_request → นายก', async () => {
    await as('head')
    const { rows } = await db.query(
      `INSERT INTO public.fleet_trips (municipality_id, status, requested_by, created_by, requester_position, department_id, vehicle_id,
         planned_departure, planned_return, document_date)
       VALUES ($1, 'approved', $2, $3, 'นักวิชาการศึกษา', $4, $5, '2026-11-03 09:00+07', '2026-11-03 16:00+07', '2026-10-30') RETURNING *`,
      [A, users.requester.id, users.head.id, D1, V1])
    const i = await info(rows[0].id, 'fleetAdmin')
    assert.equal(i.approver.kind, 'authority')
    assert.equal(i.approver.fallback_reason, 'self_request')
  })

  await test('P2 ผู้ขอไม่มีกองในโปรไฟล์ → no_department → นายก', async () => {
    await as('fleetAdmin')
    const t = await makeTrip({ requester: 'fleetAdmin', position: 'เจ้าพนักงานธุรการ' })
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.approver.kind, 'authority')
    assert.equal(i.approver.fallback_reason, 'no_department')
  })

  await test('P2 ฐานะสำรอง: แถวนายกไม่มีตำแหน่ง → สร้างจากชื่อ อปท. (อบต./เทศบาล)', async () => {
    const r = await db.query(`UPDATE public.document_signatories SET title_override = NULL WHERE signatory_role = 'mayor' AND is_active RETURNING id`)
    await db.query('UPDATE public.profiles SET job_title = NULL WHERE id = $1', [users.mayor.id])
    try {
      // ชื่อเต็มแบบฐานจริง (ตรวจ 2026-11-12 ทุก อปท. ใช้ชื่อเต็ม ไม่ใช่ตัวย่อ อบต.)
      await db.query(`UPDATE public.municipalities SET name = 'องค์การบริหารส่วนตำบลทดสอบเอ' WHERE id = $1`, [A])
      const t1 = (await db.query(`SELECT public.fleet_permit_acting_title($1, 'ผู้อำนวยการกองช่าง') AS t`, [A])).rows[0].t
      assert.equal(t1, 'ผู้อำนวยการกองช่าง ปฏิบัติราชการแทนนายกองค์การบริหารส่วนตำบลทดสอบเอ')
      await db.query(`UPDATE public.municipalities SET name = 'เทศบาลตำบลทดสอบเอ' WHERE id = $1`, [A])
      const t2 = (await db.query(`SELECT public.fleet_permit_acting_title($1, '') AS t`, [A])).rows[0].t
      assert.equal(t2, 'ผู้อำนวยการสำนัก/กอง ปฏิบัติราชการแทนนายกเทศมนตรีตำบลทดสอบเอ')
    } finally {
      await db.query(`UPDATE public.municipalities SET name = 'อบต.ทดสอบเอ' WHERE id = $1`, [A])
      await db.query('UPDATE public.profiles SET job_title = $2 WHERE id = $1', [users.mayor.id, users.mayor.job])
      await db.query('UPDATE public.document_signatories SET title_override = $2 WHERE id = $1', [r.rows[0].id, MAYOR_TITLE])
    }
  })

  await test('P2 trigger ตั้งโหมดตอนสร้างได้ค่าเดียวกับ guard ของ P1 (completed → queue)', async () => {
    await as('requester')
    const done = await makeTrip({ status: 'completed' })
    assert.equal(done.permit_mode, 'queue')
    assert.equal(done.esign_slots, null)
  })

  await test('P2 ใบโหมด queue: เปิดการมอบไว้ก็ยังเป็นนายก (น้ำเลาไม่เปลี่ยน)', async () => {
    assert.equal((await setMode('queue', { delegate: true, ref: 'คำสั่ง อบต. ที่ 45/2569', date: '2026-10-01' })).ok, true)
    await as('requester')
    const t = await makeTrip({ permit: 'regulation' })
    assert.equal(t.permit_mode, 'queue')
    const s = await status('mayor', t.id)
    assert.equal(s.authority.expected_name, users.mayor.name)
    assert.equal((await sign('requester', t.id, 'requester')).ok, true)
    assert.equal((await sign('head', t.id, 'dept_head')).ok, true)
    assert.equal((await sign('head', t.id, 'authority')).code, 'not_your_slot')
    assert.equal((await sign('mayor', t.id, 'authority')).ok, true)
    const { rows } = await db.query(`SELECT signed_as FROM public.esign_signatures WHERE doc_id = $1 AND slot = 'authority'`, [t.id])
    assert.equal(rows[0].signed_as, MAYOR_TITLE)
    assert.equal((await setMode('regulation', { delegate: true, ref: 'คำสั่ง อบต. ที่ 45/2569', date: '2026-10-01' })).ok, true)
  })

  await test('P2 ปิดการมอบทีหลัง: ใบที่ยังไม่ลงช่องอนุญาตกลับไปรอนายก · ลายเซ็น ผอ. ที่ลงไปแล้วยังมีผล', async () => {
    await as('requester')
    const pending = await makeTrip()
    const done = await makeTrip()
    for (const id of [pending.id, done.id]) {
      assert.equal((await sign('requester', id, 'requester')).ok, true)
      assert.equal((await sign('head', id, 'dept_head')).ok, true)
    }
    assert.equal((await sign('head', done.id, 'authority')).ok, true)
    assert.equal((await setMode('regulation', { delegate: false })).ok, true)
    const s = await status('mayor', pending.id)
    assert.equal(s.authority.expected_name, users.mayor.name)
    assert.equal(s.authority.can_sign, true)
    assert.equal((await sign('head', pending.id, 'authority')).code, 'not_your_slot')
    assert.equal((await info(done.id, 'fleetAdmin')).state, 'authorized')
    await as('requester')
    await depart(done.id)
  })

  await test('P2 สิทธิ์: ฟังก์ชันใหม่/ที่แก้ไม่เปิดให้ API · trigger ใหม่อยู่ก่อน esign guard', async () => {
    const { rows } = await db.query(`SELECT
      has_function_privilege('authenticated', 'public.fleet_permit_acting_title(uuid,text)', 'execute') AS a,
      has_function_privilege('anon', 'public.fleet_permit_acting_title(uuid,text)', 'execute') AS b,
      has_function_privilege('authenticated', 'public.esign_expected_signer(public.fleet_trips,text)', 'execute') AS c,
      has_function_privilege('authenticated', 'public.fleet_trip_permit_approver(public.fleet_trips,date)', 'execute') AS d`)
    assert.deepEqual(rows[0], { a: false, b: false, c: false, d: false })
    const names = (await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.fleet_trips'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows.map(r => r.tgname)
    const early = names.indexOf('trg_fleet_trips_early_permit_mode')
    assert.ok(early >= 0 && early < names.indexOf('trg_fleet_trips_esign_guard'), names.join(','))
  })
}

if (WITH_P3) {
  // ══ P3 — ข้อ ๑๒ ว.๕ ผู้มีรถประจำตำแหน่งขอใช้ยานพาหนะส่วนกลาง (20261123100000/100100) ══════════════════
  const POS_CLERK = '00000000-0000-4000-8000-0000000000f1'
  const POS_MAYOR = '00000000-0000-4000-8000-0000000000f2'
  const POS_B = '00000000-0000-4000-8000-0000000000f3'
  const VP = '00000000-0000-4000-8000-0000000000e2'   // รถประจำตำแหน่งปลัด อปท. เอ
  const VM = '00000000-0000-4000-8000-0000000000e3'   // รถประจำตำแหน่งนายก อปท. เอ
  await db.query(`INSERT INTO public.positions (id, name, municipality_id) VALUES ($1,'ปลัด อบต.',$4), ($2,'นายก อบต.',$4), ($3,'ปลัด อบต. บี',$5)`,
    [POS_CLERK, POS_MAYOR, POS_B, A, B])
  // requester = ผู้ถือรถประจำตำแหน่ง (ปลัด) · mayor = นายกที่มีรถประจำตำแหน่ง
  await db.query(`UPDATE public.profiles SET position_id = $1 WHERE id = $2`, [POS_CLERK, users.requester.id])
  await db.query(`UPDATE public.profiles SET position_id = $1 WHERE id = $2`, [POS_MAYOR, users.mayor.id])
  await setMode('regulation')
  const REASON = 'รถประจำตำแหน่งเข้าศูนย์ซ่อมตามนัด ต้องไปประชุมที่จังหวัด'
  const reasonOf = async id => (await trip(id)).position_car_reason

  await test('P3 ผูกผู้ถือรถ: ตำแหน่ง อปท. อื่นไม่ได้ · รถส่วนกลางผูกไม่ได้ · ก่อนผูก = ไม่ใช่ผู้มีรถประจำตำแหน่ง', async () => {
    await db.query(`INSERT INTO public.fleet_vehicles (id, name, municipality_id, regulation_category, license_plate) VALUES ($1,'รถปลัด',$2,'position','กข 1')`, [VP, A])
    await as('requester')
    const before = await makeTrip()
    assert.equal((await info(before.id, 'fleetAdmin')).position_car, null)
    await expectError(db.query(`UPDATE public.fleet_vehicles SET holder_position_id = $1 WHERE id = $2`, [POS_B, VP]), /FLEET_HOLDER_POSITION_TENANT/)
    await expectError(db.query(`UPDATE public.fleet_vehicles SET holder_position_id = $1 WHERE id = $2`, [POS_CLERK, V1]), /fleet_vehicles_holder_only_position_car/)
    await db.query(`UPDATE public.fleet_vehicles SET holder_position_id = $1 WHERE id = $2`, [POS_CLERK, VP])
    // ผูกทีหลัง = ใบที่ยังไม่ออกรถถูกตรวจตามกติกาใหม่ทันที (เลือกเข้มไว้ก่อน)
    const i = await info(before.id, 'fleetAdmin')
    assert.equal(i.state, 'reason_required')
    assert.deepEqual(i.position_car, { vehicle_id: VP, license_plate: 'กข 1', name: 'รถปลัด', position_name: 'ปลัด อบต.' })
  })

  await test('P3 queue: ผู้ถือรถประจำตำแหน่งในโหมด queue ไม่เปลี่ยนอะไร (not_required ออกรถได้ทันที)', async () => {
    await setMode('queue')
    await as('requester')
    const t = await makeTrip()
    assert.equal(t.permit_mode, 'queue')
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.state, 'not_required')
    assert.equal(i.position_car, undefined)
    await depart(t.id)
    await setMode('regulation')
  })

  await test('P3 ยังไม่กรอกเหตุผล: reason_required · ออกรถไม่ได้ · ลายเซ็นนายกยังไม่นับ · บันทึกใบกระดาษไม่ได้', async () => {
    await as('requester')
    const t = await makeTrip()
    await addSignature(t.id, 'authority', 'approve', 'mayor')
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'reason_required')
    await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
    const t2 = await makeTrip()
    await as('fleetAdmin')
    assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t2.id, 'authority', today])).code, 'reason_required')
  })

  await test('P3 เหตุผล: เว้นวรรคล้วน = ว่าง · สั้นกว่า 5 ตัวอักษรไม่รับ · ตัดช่องว่างหัวท้าย', async () => {
    await as('requester')
    const t = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = '   ' WHERE id = $1`, [t.id])
    assert.equal(await reasonOf(t.id), null)
    await expectError(db.query(`UPDATE public.fleet_trips SET position_car_reason = 'สั้น' WHERE id = $1`, [t.id]), /fleet_trips_position_car_reason_len/)
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, `  ${REASON}  `])
    assert.equal(await reasonOf(t.id), REASON)
  })

  await test('P3 ผู้มีอำนาจไม่ใช่นายก: mayor_required · บันทึกไม่ได้ · เปลี่ยนเป็นนายกแล้วบันทึกได้ ออกรถได้', async () => {
    await as('requester')
    const t = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2, order_authority_role = 'clerk' WHERE id = $1`, [t.id, REASON])
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'mayor_required')
    await as('fleetAdmin')
    assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).code, 'mayor_required')
    await db.query(`UPDATE public.fleet_trips SET order_authority_role = 'mayor' WHERE id = $1`, [t.id])
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.state, 'waiting')
    assert.equal(i.approver.role, 'mayor')
    assert.equal(i.approver.fallback_reason, 'position_car_holder')
    assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).ok, true)
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
    await depart(t.id)
  })

  await test('P3 มอบ ผอ.กอง: ผู้มีรถประจำตำแหน่งไม่ใช้การมอบ (position_car_holder) · ผู้อนุญาต = นายก · ลายเซ็นนายก = ออกรถได้', async () => {
    assert.equal((await setMode('regulation', { delegate: true, ref: 'คำสั่ง อบต. ที่ 45/2569', date: '2026-10-01' })).ok, true)
    await as('requester')
    const t = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON])
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.approver.kind, 'authority')
    assert.equal(i.approver.role, 'mayor')
    assert.equal(i.approver.fallback_reason, 'position_car_holder')
    await as('fleetAdmin')
    const r = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'delegated_dept_head', today])
    assert.equal(r.code, 'delegation_not_applicable')
    assert.equal(r.fallback_reason, 'position_car_holder')
    await addSignature(t.id, 'authority', 'approve', 'mayor')
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
    await depart(t.id)
    // ผู้ขอทั่วไป (ไม่มีรถประจำตำแหน่ง) ยังใช้การมอบได้ตามเดิม
    await db.query(`UPDATE public.profiles SET position_id = NULL WHERE id = $1`, [users.requester.id])
    await as('requester')
    const plain = await makeTrip()
    assert.equal((await info(plain.id, 'fleetAdmin')).approver.kind, 'delegated_dept_head')
    await db.query(`UPDATE public.profiles SET position_id = $1 WHERE id = $2`, [POS_CLERK, users.requester.id])
    await setMode('regulation')
  })

  // reviewer รอบ 3 ข้อ 1: vehicle_id ไม่อยู่ใน payload ลายเซ็น ⇒ ขอรถประจำตำแหน่งของตัวเอง (ไม่เข้า ว.๕) ให้ ผอ.ที่ได้รับมอบอนุญาต
  // แล้วสลับกลับเป็นรถส่วนกลาง ⇒ การอนุญาตของ ผอ. ต้องไม่นับ (ทั้งลายเซ็นออนไลน์และใบกระดาษ)
  await test('P3 สลับรถหลัง ผอ.ที่ได้รับมอบอนุญาต: ลายเซ็น ผอ. ไม่นับ (mayor_required) · ออกรถไม่ได้ · ถอนแล้วนายกลง = ออกรถได้', async () => {
    assert.equal((await setMode('regulation', { delegate: true, ref: 'คำสั่ง อบต. ที่ 45/2569', date: '2026-10-01' })).ok, true)
    await as('requester')
    const t = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET vehicle_id = $2, position_car_reason = $3 WHERE id = $1`, [t.id, VP, REASON])
    assert.equal((await info(t.id, 'fleetAdmin')).approver.kind, 'delegated_dept_head', 'ขอรถประจำตำแหน่งตัวเอง = ไม่ใช่กรณี ว.๕')
    const headSig = await addSignature(t.id, 'authority', 'approve', 'head')
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
    await db.query(`UPDATE public.fleet_trips SET vehicle_id = $2 WHERE id = $1`, [t.id, V1])
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.state, 'mayor_required')
    assert.equal(i.non_mayor_permit, true)
    await as('requester')
    await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
    await db.query(`INSERT INTO public.esign_revocations (signature_id, municipality_id, reason) VALUES ($1, $2, 'ต้องให้นายกอนุญาต')`, [headSig, A])
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'waiting')
    await addSignature(t.id, 'authority', 'approve', 'mayor')
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
    await as('requester')
    await depart(t.id)
    await setMode('regulation')
  })

  await test('P3 สลับรถหลังบันทึกใบกระดาษแบบ ผอ.ที่ได้รับมอบ: ไม่นับ · ปุ่มยกเลิกบันทึกยังอยู่ · ยกเลิกแล้วบันทึกแบบนายกได้', async () => {
    assert.equal((await setMode('regulation', { delegate: true, ref: 'คำสั่ง อบต. ที่ 45/2569', date: '2026-10-01' })).ok, true)
    await as('requester')
    const t = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET vehicle_id = $2, position_car_reason = $3 WHERE id = $1`, [t.id, VP, REASON])
    await as('fleetAdmin')
    const rec = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'delegated_dept_head', today])
    assert.equal(rec.ok, true, JSON.stringify(rec))
    await db.query(`UPDATE public.fleet_trips SET vehicle_id = $2 WHERE id = $1`, [t.id, V1])
    const i = await info(t.id, 'fleetAdmin')
    assert.equal(i.state, 'mayor_required')
    assert.equal(i.non_mayor_permit, true)
    assert.equal(i.permit_id, rec.permit_id)
    assert.equal(i.can_void, true)
    await as('requester')
    await expectError(depart(t.id), /FLEET_PERMIT_REQUIRED/)
    await as('fleetAdmin')
    assert.equal((await rpc('public.fleet_void_paper_permit($1, $2)', [rec.permit_id, 'ต้องให้นายกอนุญาต'])).ok, true)
    assert.equal((await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])).ok, true)
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
    await setMode('regulation')
  })

  await test('P3 ล็อกเหตุผล: แก้ไม่ได้หลังมีลายเซ็น/บันทึกใบกระดาษ · ถอน/ยกเลิกแล้วแก้ได้', async () => {
    await as('requester')
    const t = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON])
    const sig = await addSignature(t.id, 'requester', 'sign', 'requester')
    await expectError(db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON + ' แก้']), /FLEET_POSITION_REASON_LOCKED/)
    await db.query(`UPDATE public.fleet_trips SET notes = 'แก้ช่องอื่นได้' WHERE id = $1`, [t.id])
    await db.query(`INSERT INTO public.esign_revocations (signature_id, municipality_id, reason) VALUES ($1, $2, 'แก้เหตุผล')`, [sig, A])
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON + ' แก้'])
    await as('fleetAdmin')
    const { permit_id: pid } = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])
    await expectError(db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON]), /FLEET_POSITION_REASON_LOCKED/)
    assert.equal((await rpc('public.fleet_void_paper_permit($1, $2)', [pid, 'บันทึกก่อนแก้เหตุผล'])).ok, true)
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON])
    assert.equal(await reasonOf(t.id), REASON)
  })

  await test('P3 ไม่ใช่กรณี ว.๕: ขอรถประจำตำแหน่งคันอื่น · รถของตนจำหน่าย/ปลดระวางแล้ว · ผู้ไม่มีตำแหน่งผูกรถ', async () => {
    await as('requester')
    const own = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET vehicle_id = $2 WHERE id = $1`, [own.id, VP])
    assert.equal((await info(own.id, 'fleetAdmin')).position_car, null)
    await db.query(`UPDATE public.fleet_vehicles SET disposed_date = '2026-01-01' WHERE id = $1`, [VP])
    await as('requester')
    const t = await makeTrip()
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'waiting')
    await db.query(`UPDATE public.fleet_vehicles SET disposed_date = NULL, status = 'retired' WHERE id = $1`, [VP])
    assert.equal((await info(t.id, 'fleetAdmin')).position_car, null)
    await db.query(`UPDATE public.fleet_vehicles SET status = 'under_repair' WHERE id = $1`, [VP])
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'reason_required', 'รถเข้าซ่อมยังนับว่ามีรถประจำตำแหน่ง')
    await db.query(`UPDATE public.fleet_vehicles SET status = 'active' WHERE id = $1`, [VP])
    await as('head')
    const other = await makeTrip({ requester: 'head', position: 'ผู้อำนวยการกองช่าง' })
    assert.equal((await info(other.id, 'fleetAdmin')).position_car, null)
  })

  await test('P3 นายกมีรถประจำตำแหน่ง: ต้องกรอกเหตุผล · แล้ว สก.๑ = อนุญาต (ไม่ติด mayor_required)', async () => {
    await db.query(`INSERT INTO public.fleet_vehicles (id, name, municipality_id, regulation_category, license_plate, holder_position_id)
                    VALUES ($1,'รถนายก',$2,'position','กข 2',$3)`, [VM, A, POS_MAYOR])
    await as('mayor')
    const t = await makeTrip({ requester: 'mayor', position: 'นายกองค์การบริหารส่วนตำบลทดสอบเอ' })
    await db.query(`UPDATE public.fleet_trips SET order_authority_role = 'clerk' WHERE id = $1`, [t.id])
    await addSignature(t.id, 'sk1', 'sign', 'mayor')
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'reason_required')
    // ลายเซ็น สก.๑ ล็อกเหตุผลแล้ว → ต้องถอนก่อนกรอก (ผู้อนุญาตต้องเห็นเหตุผล)
    await expectError(db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON]), /FLEET_POSITION_REASON_LOCKED/)
    await as('mayor')
    const t2 = await makeTrip({ requester: 'mayor', position: 'นายกองค์การบริหารส่วนตำบลทดสอบเอ' })
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2, order_authority_role = 'clerk' WHERE id = $1`, [t2.id, REASON])
    await addSignature(t2.id, 'sk1', 'sign', 'mayor')
    assert.equal((await info(t2.id, 'fleetAdmin')).state, 'authorized')
  })

  await test('P3 RPC ฟอร์ม fleet_position_car_check: ผู้ใช้โมดูลรถได้รถของผู้ขอ · ไม่มีสิทธิ์/ต่าง อปท. ไม่ได้ · anon เรียกไม่ได้', async () => {
    await as('requester')
    const own = await rpc('public.fleet_position_car_check($1, NULL, $2)', [A, V1])
    assert.equal(own.ok, true)
    assert.equal(own.permit_mode, 'regulation')
    assert.equal(own.position_car.license_plate, 'กข 1')
    assert.equal((await rpc('public.fleet_position_car_check($1, NULL, $2)', [A, VP])).position_car, null)
    await as('fleetAdmin')
    assert.equal((await rpc('public.fleet_position_car_check($1, $2, $3)', [A, users.requester.id, V1])).position_car.vehicle_id, VP)
    assert.equal((await rpc('public.fleet_position_car_check($1, $2, $3)', [A, users.head.id, V1])).position_car, null)
    await as('outsider')
    assert.equal((await rpc('public.fleet_position_car_check($1, NULL, $2)', [A, V1])).code, 'forbidden')
    await as('fleetAdminB')
    assert.equal((await rpc('public.fleet_position_car_check($1, $2, $3)', [A, users.requester.id, V1])).code, 'forbidden')
    assert.equal((await db.query(`SELECT has_function_privilege('anon', 'public.fleet_position_car_check(uuid,uuid,uuid)', 'execute') AS ok`)).rows[0].ok, false)
  })

  await test('P3 RPC แจ้งเตือน fleet_trip_authorized_notice: service_role เท่านั้น · key = ลายเซ็น/บันทึกที่อนุญาต · ยกเลิกแล้วอนุญาตใหม่ได้ key ใหม่', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`SELECT has_function_privilege($1, 'public.fleet_trip_authorized_notice(uuid)', 'execute') AS ok`, [role])).rows[0].ok, false, role)
    }
    assert.equal((await db.query(`SELECT has_function_privilege('service_role', 'public.fleet_trip_authorized_notice(uuid)', 'execute') AS ok`)).rows[0].ok, true)
    await as('requester')
    const t = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON])
    const waiting = await rpc('public.fleet_trip_authorized_notice($1)', [t.id])
    assert.equal(waiting.state, 'waiting')
    assert.equal(waiting.key, null)
    // ใบที่ยังไม่ครบ ว.๕ แต่มีใบกระดาษค้าง (มี permit_id) ต้องไม่มี key — ไม่งั้น Telegram บอก "ออกรถได้" ผิด
    const noReason = await makeTrip()
    await as('fleetAdmin')
    await db.query(`UPDATE public.profiles SET position_id = NULL WHERE id = $1`, [users.requester.id])
    const { permit_id: held } = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [noReason.id, 'authority', today])
    await db.query(`UPDATE public.profiles SET position_id = $1 WHERE id = $2`, [POS_CLERK, users.requester.id])
    const heldNotice = await rpc('public.fleet_trip_authorized_notice($1)', [noReason.id])
    assert.equal(heldNotice.state, 'reason_required')
    assert.equal(heldNotice.permit_id, held)
    assert.equal(heldNotice.key, null)
    await as('requester')
    await as('fleetAdmin')
    const { permit_id: p1 } = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])
    const n1 = await rpc('public.fleet_trip_authorized_notice($1)', [t.id])
    assert.equal(n1.state, 'authorized')
    assert.equal(n1.status, 'approved')
    assert.equal(n1.key, p1)
    await rpc('public.fleet_void_paper_permit($1, $2)', [p1, 'ทดสอบบันทึกใหม่'])
    const { permit_id: p2 } = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])
    assert.equal((await rpc('public.fleet_trip_authorized_notice($1)', [t.id])).key, p2)
    assert.notEqual(p2, p1)
    await as('head')
    const sigTrip = await makeTrip({ requester: 'head', position: 'ผู้อำนวยการกองช่าง' })
    const sig = await addSignature(sigTrip.id, 'authority', 'approve', 'mayor')
    assert.equal((await rpc('public.fleet_trip_authorized_notice($1)', [sigTrip.id])).key, sig)
    const legacy = (await db.query(`SELECT id FROM public.fleet_trips WHERE destination = 'LEGACY-approved'`)).rows[0].id
    assert.equal((await rpc('public.fleet_trip_authorized_notice($1)', [legacy])).state, 'not_required')
    assert.equal((await rpc('public.fleet_trip_authorized_notice($1)', ['00000000-0000-4000-8000-000000000999'])).found, false)
  })

  await test('P3 ผูกผู้ถือรถหลังบันทึกใบกระดาษ: ใบไม่ติดตาย — info มี via/permit_id · can_void · ยกเลิกแล้วกรอกเหตุผลได้', async () => {
    await db.query(`UPDATE public.profiles SET position_id = NULL WHERE id = $1`, [users.requester.id])
    await as('requester')
    const t = await makeTrip()
    await as('fleetAdmin')
    const { permit_id: pid } = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])
    assert.equal((await info(t.id, 'fleetAdmin')).state, 'authorized')
    await db.query(`UPDATE public.profiles SET position_id = $1 WHERE id = $2`, [POS_CLERK, users.requester.id])
    const stuck = await info(t.id, 'fleetAdmin')
    assert.equal(stuck.state, 'reason_required')
    assert.equal(stuck.via, 'paper')
    assert.equal(stuck.permit_id, pid)
    assert.equal(stuck.can_void, true)
    await expectError(db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON]), /FLEET_POSITION_REASON_LOCKED/)
    await as('fleetAdmin')
    assert.equal((await rpc('public.fleet_void_paper_permit($1, $2)', [pid, 'ผู้ขอมีรถประจำตำแหน่ง ต้องกรอกเหตุผลก่อน'])).ok, true)
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON])
    const ready = await info(t.id, 'fleetAdmin')
    assert.equal(ready.state, 'waiting')
    assert.equal(ready.via, undefined)
    // ใบที่อนุญาตทางลายเซ็นแล้ว via ต้องยังเป็น esign (position_car ไม่ทับ)
    await addSignature(t.id, 'authority', 'approve', 'mayor')
    const signed = await info(t.id, 'fleetAdmin')
    assert.equal(signed.state, 'authorized')
    assert.equal(signed.via, 'esign')
    assert.equal(signed.position_car.vehicle_id, VP)
  })

  await test('P3 บันทึกใบกระดาษ: audit มี position_car (ทะเบียน/ตำแหน่ง) ไม่มีข้อความเหตุผล', async () => {
    await as('requester')
    const t = await makeTrip()
    await db.query(`UPDATE public.fleet_trips SET position_car_reason = $2 WHERE id = $1`, [t.id, REASON])
    await as('fleetAdmin')
    const { permit_id: pid } = await rpc('public.fleet_record_paper_permit($1, $2, $3)', [t.id, 'authority', today])
    const { rows } = await db.query(`SELECT metadata FROM public.audit_logs WHERE action = 'fleet_permit_recorded' AND metadata->>'permit_id' = $1`, [pid])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].metadata.position_car.license_plate, 'กข 1')
    assert.ok(!JSON.stringify(rows[0].metadata).includes(REASON), 'ห้ามคัดลอกเหตุผลลง audit metadata')
  })

  await test('P3 esign_my_pending: ต่างจากรุ่น 20261101120100 เฉพาะจุดที่ตั้งใจ · เรียกได้ · สิทธิ์เดิม', async () => {
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.esign_my_pending()'::regprocedure`)).rows[0].prosrc
    assert.match(src, /'position_car_reason', v_trip\.position_car_reason/)
    assert.match(src, /'position_car_required', \(/)
    // ตัดส่วนที่ P3 เพิ่มออก แล้วเนื้อที่เหลือต้องเท่ากับรุ่นเดิมทุกตัวอักษร (หลังยุบช่องว่าง) — กันยกมาจากรุ่นเก่า/ทำของเดิมหาย
    const oldFile = await readMigration('20261101120100_esign_trip_return_functions.sql')
    const oldBody = extractFunction(oldFile, /CREATE OR REPLACE FUNCTION public\.esign_my_pending\(\)/)
    const newBody = extractFunction(positionCarFunctionsSql, /CREATE OR REPLACE FUNCTION public\.esign_my_pending\(\)/)
    const squash = text => text.replace(/\s+/g, ' ').trim()
    const stripped = squash(newBody
      .replace(', t.position_car_reason, t.permit_mode,', ',')
      .replace(/,\s*-- P3 ข้อ ๑๒ ว\.๕[\s\S]*?'position_car_required', \([\s\S]*?IS NOT NULL\s*\)/, ''))
    assert.equal(stripped, squash(oldBody))
    await as('mayor')
    assert.equal((await rpc('public.esign_my_pending()')).ok, true)
    assert.equal((await db.query(`SELECT has_function_privilege('anon', 'public.esign_my_pending()', 'execute') AS ok`)).rows[0].ok, false)
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated', 'public.esign_my_pending()', 'execute') AS ok`)).rows[0].ok, true)
  })
}

console.log(`\nfleet-permit-db: ผ่าน ${cases} กรณี`)
