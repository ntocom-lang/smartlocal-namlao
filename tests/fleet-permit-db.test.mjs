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
CREATE TABLE public.positions (id uuid PRIMARY KEY, name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text);
CREATE TABLE public.fleet_vehicles (id uuid PRIMARY KEY, name text, municipality_id uuid, department_id uuid, is_pool boolean DEFAULT true);
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

const users = {
  adminA: { id: U(1), role: 'admin', muni: A, name: 'แอดมิน เอ' },
  adminB: { id: U(2), role: 'admin', muni: B, name: 'แอดมิน บี' },
  superadmin: { id: U(3), role: 'superadmin', muni: null, name: 'ซูเปอร์แอดมิน' },
  requester: { id: U(4), role: 'staff', muni: A, name: 'สมหญิง ผู้ขอ', fleetRole: 'fleet_staff', job: 'นักวิชาการศึกษา' },
  head: { id: U(5), role: 'staff', muni: A, name: 'สมชาย หัวหน้ากอง', fleetRole: 'fleet_staff', job: 'ผู้อำนวยการกองช่าง' },
  mayor: { id: U(6), role: 'viewer', muni: A, name: 'สมศักดิ์ นายก', job: 'นายกองค์การบริหารส่วนตำบลทดสอบเอ' },
  fleetAdmin: { id: U(8), role: 'staff', muni: A, name: 'สมบัติ ผู้ดูแลรถ', fleetRole: 'fleet_admin' },
  outsider: { id: U(9), role: 'staff', muni: A, name: 'สมปอง ไม่มีสิทธิ์รถ' },
  fleetAdminB: { id: U(11), role: 'staff', muni: B, name: 'สมคิด ผู้ดูแลรถ บี', fleetRole: 'fleet_admin' },
}
for (const u of Object.values(users)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [u.id])
  await db.query('INSERT INTO public.profiles (id, full_name, role, municipality_id, fleet_role, job_title) VALUES ($1,$2,$3,$4,$5,$6)',
    [u.id, u.name, u.role, u.muni, u.fleetRole ?? null, u.job ?? null])
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
    `INSERT INTO public.esign_signatures (municipality_id, doc_type, doc_id, slot, signer_id, signer_name, signed_as, decision,
       content_hash, content_snapshot, template_version)
     VALUES ($1, 'fleet_trip_request', $2, $3, $4, $5, '', $6, $7, '{}'::jsonb, 'fleet-form3-v1') RETURNING id`,
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

  await as('requester')
  const noHead = await makeTrip({ dept: D2 })
  i = await info(noHead.id, 'fleetAdmin')
  assert.equal(i.approver.fallback_reason, 'no_dept_head')

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

console.log(`\nfleet-permit-db: ผ่าน ${cases} กรณี`)
