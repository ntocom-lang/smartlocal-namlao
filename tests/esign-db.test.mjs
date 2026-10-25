// ลงนามออนไลน์รายเรื่อง (ชุด A) — supabase/migrations/20261022100000_esign_columns.sql, ..100100_esign_tables.sql, ..100200_esign_functions.sql, ชุด B1.5: ..110000_esign_policy_optional.sql, ..110100_esign_gate_relax_functions.sql
//   node tests/esign-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// รัน migration จริงสามไฟล์ใน PostgreSQL จำลอง (PGlite + pgcrypto) พร้อมฟังก์ชันจริงที่ตัวใหม่พึ่ง (rpc_rate_limit_hit,
// fleet_can_read, fleet_is_manager) ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
// (ติดตั้ง PGlite: npm install --prefix <temp> @electric-sql/pglite@0.5.8)
//
// สิ่งที่ต้องไม่พัง:
//  (1) ก่อนมีใครเปิดสวิตช์ ทริปทุกใบ (เก่า/ใหม่) เป็นเซ็นสด — trigger ใหม่ไม่ทำให้สร้าง/แก้ทริปพัง แม้ระบบลงนามเสีย
//  (2) ไม่มีทางลงนามแทนคนอื่น/ข้ามลำดับ/ข้ามรหัสลงนาม และไม่มีทางปลอมให้ทริปเป็นโหมดออนไลน์
//  (3) ลายเซ็นกับการถอนแก้/ลบ/TRUNCATE ไม่ได้ · เนื้อหาคำขอที่ลงนามแล้วล็อก แต่ฟิลด์ที่เปลี่ยนตามการเดินทางไม่ล็อก
//  (4) หน้าตรวจสอบสาธารณะไม่เห็นปลายทาง/วัตถุประสงค์/id และจับได้เมื่อเนื้อหาถูกแก้ข้ามด่าน
//  (5) ประตู (ประกาศ/ทดลอง/ผูกบัญชีผู้ลงนาม) ปิดสวิตช์ไว้จนครบ · ไม่แตะ approved_by/approval_method ของคิวรถอัตโนมัติ
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const pgliteUrl = pathToFileURL(modulePath)
const { PGlite } = await import(pgliteUrl.href)
const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js', pgliteUrl).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const rateLimitSql = await readMigration('20260905170000_rpc_rate_limit.sql')
const fleetHelpersSrc = await readMigration('20260816130000_harden_fleet_assets_and_documents.sql')
const columnsSql = await readMigration('20261022100000_esign_columns.sql')
const tablesSql = await readMigration('20261022100100_esign_tables.sql')
const functionsSql = await readMigration('20261022100200_esign_functions.sql')
// ชุด B1.5: ประกาศ/หนังสือให้ความเห็นชอบไม่เป็นเงื่อนไขเปิดใช้ (รันต่อจากชุด A ตามลำดับเดียวกับบนฐานจริง)
const policyOptionalSql = await readMigration('20261022110000_esign_policy_optional.sql')
const gateRelaxSql = await readMigration('20261022110100_esign_gate_relax_functions.sql')
// ชุด S1: ภาพลายเซ็น (ตาราง → ฟังก์ชัน ตามลำดับเดียวกับที่ apply บนฐานจริง)
const imageTablesSql = await readMigration('20261023100000_esign_image_tables.sql')
const imageFunctionsSql = await readMigration('20261023100100_esign_image_functions.sql')
// ชุด S3a: ข้อมูลแผงลงนามในหน้าทริป (แก้ esign_trip_status + เพิ่ม esign_my_pending)
const tripPanelSql = await readMigration('20261023110000_esign_trip_panel_functions.sql')
// แอดมินลบทริปที่มีลายเซ็นได้ (2569-10-25) — แทน esign_fleet_trip_guard ทั้งตัว (CREATE OR REPLACE)
const adminDeleteSql = await readMigration('20261025120000_esign_trip_admin_delete.sql')

// ดึงฟังก์ชันตัวจริงออกจาก migration เดิมทั้งตัว (ไม่พิมพ์ซ้ำเอง)
const extractFunction = (source, startPattern) => {
  const found = startPattern.exec(source)
  assert.ok(found, `ไม่พบฟังก์ชันที่ขึ้นต้นด้วย ${startPattern}`)
  const rest = source.slice(found.index)
  const end = rest.search(/\n\$\$;/)
  assert.ok(end > 0, 'ไม่พบ $$; ปิดฟังก์ชัน')
  return rest.slice(0, end + 4)
}
const fleetCanReadFn = extractFunction(fleetHelpersSrc, /CREATE OR REPLACE FUNCTION public\.fleet_can_read\(p_municipality_id uuid\)/)
const fleetIsManagerFn = extractFunction(fleetHelpersSrc, /CREATE OR REPLACE FUNCTION public\.fleet_is_manager\(p_municipality_id uuid\)/)

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const D1 = '00000000-0000-4000-8000-0000000000d1'
const D2 = '00000000-0000-4000-8000-0000000000d2'
const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.positions (id uuid PRIMARY KEY, name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text);
CREATE TABLE public.fleet_vehicles (id uuid PRIMARY KEY, name text);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, full_name text, role text, municipality_id uuid, fleet_role text, job_title text, position_id uuid
);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.role', true), '') $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.muni', true), '')::uuid $$;
-- เหมือน 068_audit_logs.sql
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text, metadata jsonb, created_at timestamptz DEFAULT now()
);
-- คอลัมน์เท่าที่ฟังก์ชันแตะ + ข้อบังคับที่ migration ทะเบียนผู้ลงนามเดิมตั้งไว้
CREATE TABLE public.document_signatories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL, document_type text NOT NULL DEFAULT 'complaint',
  signatory_role text NOT NULL, department_id uuid, profile_id uuid, manual_name text, custom_label text, title_override text,
  effective_from date NOT NULL DEFAULT (timezone('Asia/Bangkok', now())::date), effective_to date,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((profile_id IS NOT NULL AND manual_name IS NULL) OR (profile_id IS NULL AND NULLIF(btrim(manual_name), '') IS NOT NULL))
);
-- ทริปเท่าที่แบบ 3 และ trigger แตะ: ฟิลด์คำขอ + ฟิลด์ที่เปลี่ยนตามการเดินทาง + ฟิลด์อนุมัติ
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
INSERT INTO public.positions VALUES ('00000000-0000-4000-8000-0000000000f1', 'วิศวกรโยธา');
`)

// ทริปเดิมที่มีอยู่ก่อน migration — ต้องไม่ถูกแตะ (esign_* เป็น NULL)
for (let i = 1; i <= 3; i++) {
  await db.query(`INSERT INTO public.fleet_trips (municipality_id, destination) VALUES ($1, $2)`, [A, `LEGACY-${i}`])
}
await db.exec(rateLimitSql)
await db.exec(fleetCanReadFn)
await db.exec(fleetIsManagerFn)
await db.exec(columnsSql)
await db.exec(tablesSql)
await db.exec(functionsSql)
await db.exec(policyOptionalSql)
await db.exec(gateRelaxSql)
await db.exec(imageTablesSql)
await db.exec(imageFunctionsSql)
await db.exec(tripPanelSql)
await db.exec(adminDeleteSql)

const users = {
  adminA: { id: U(1), role: 'admin', muni: A, name: 'แอดมิน เอ' },
  adminB: { id: U(2), role: 'admin', muni: B, name: 'แอดมิน บี' },
  superadmin: { id: U(3), role: 'superadmin', muni: null, name: 'ซูเปอร์แอดมิน' },
  requester: { id: U(4), role: 'staff', muni: A, name: 'สมหญิง ผู้ขอ', fleetRole: 'fleet_staff', job: 'นักวิชาการศึกษา' },
  head: { id: U(5), role: 'staff', muni: A, name: 'สมชาย หัวหน้ากอง', fleetRole: 'fleet_staff', job: 'ผู้อำนวยการกองช่าง' },
  mayor: { id: U(6), role: 'admin', muni: A, name: 'สมศักดิ์ นายก', fleetRole: null, job: 'นายกองค์การบริหารส่วนตำบลทดสอบเอ' },
  clerk: { id: U(7), role: 'staff', muni: A, name: 'สมใจ ปลัด', fleetRole: null, job: 'ปลัดองค์การบริหารส่วนตำบล' },
  fleetAdmin: { id: U(8), role: 'staff', muni: A, name: 'สมบัติ ผู้ดูแลรถ', fleetRole: 'fleet_admin' },
  outsider: { id: U(9), role: 'staff', muni: A, name: 'สมปอง คนนอกกอง', fleetRole: null },
  citizen: { id: U(10), role: 'citizen', muni: A, name: 'ประชาชน หนึ่ง' },
  staffB: { id: U(11), role: 'staff', muni: B, name: 'สมคิด บี', fleetRole: 'fleet_staff' },
  headB: { id: U(12), role: 'staff', muni: A, name: 'สมหมาย รักษาการ', fleetRole: 'fleet_staff', job: 'หัวหน้าฝ่าย' },
}
for (const u of Object.values(users)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [u.id])
  await db.query('INSERT INTO public.profiles (id, full_name, role, municipality_id, fleet_role, job_title) VALUES ($1,$2,$3,$4,$5,$6)',
    [u.id, u.name, u.role, u.muni, u.fleetRole ?? null, u.job ?? null])
}
const as = async alias => {
  const u = alias === 'anon' ? null : users[alias]
  // ล้างตัวนับอัตราเรียกทุกครั้งที่สลับผู้ใช้ — เทสต์เรียกซ้ำเยอะกว่าโควตาจริง (ด่านนี้มีเทสต์ของตัวเองด้านล่าง)
  await db.query('DELETE FROM public.rpc_rate_limit')
  await db.query("SELECT set_config('test.uid', $1, false), set_config('test.role', $2, false), set_config('test.muni', $3, false), set_config('request.headers', $4, false)",
    [u ? u.id : '', u ? u.role : '', u ? (u.muni ?? '') : '', alias === 'anon' ? '{"cf-connecting-ip":"203.0.113.9"}' : ''])
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
const trip = async id => (await db.query('SELECT * FROM public.fleet_trips WHERE id = $1', [id])).rows[0]
const makeTrip = async (extra = {}) => {
  const f = {
    muni: A, status: 'pending', requester: 'requester', position: 'นักวิชาการศึกษา', dept: D1, authority: null, label: null,
    destination: 'สำนักงานจังหวัดแพร่ ห้องประชุม 2', purpose: 'อบรมเชิงปฏิบัติการลับ-วัตถุประสงค์', passengers: 3, ...extra,
  }
  const { rows } = await db.query(
    `INSERT INTO public.fleet_trips (municipality_id, status, requested_by, created_by, requester_position, department_id,
        order_authority_role, order_authority_label, destination, destination_locality, destination_province, purpose, passengers,
        planned_departure, planned_return, document_date)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,'อำเภอเมือง','แพร่',$9,$10,'2026-11-03 09:00+07','2026-11-03 16:00+07','2026-10-30') RETURNING *`,
    [f.muni, f.status, users[f.requester].id, f.position, f.dept, f.authority, f.label, f.destination, f.purpose, f.passengers])
  return rows[0]
}
const addRegistry = (role, alias, { dept = null, title = null, label = null, manual = null, muni = A } = {}) =>
  db.query(`INSERT INTO public.document_signatories (municipality_id, signatory_role, department_id, profile_id, manual_name, custom_label, title_override)
            VALUES ($1,$2,$3,$4,$5,$6,$7)`, [muni, role, dept, alias ? users[alias].id : null, manual, label, title])

// ── (1) ก่อนเปิดสวิตช์ ────────────────────────────────────────────────────────────────────────
await test('ทริปเดิมก่อน migration: คอลัมน์ใหม่เป็น NULL ทุกแถว · ไม่มีแถวตั้งค่า = ทริปใหม่เซ็นสด', async () => {
  const { rows } = await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE esign_slots IS NOT NULL OR esign_verify_code IS NOT NULL)::int AS stamped
                                   FROM public.fleet_trips WHERE destination LIKE 'LEGACY-%'`)
  assert.deepEqual(rows[0], { n: 3, stamped: 0 })
  await as('requester')
  const t = await makeTrip()
  assert.equal(t.esign_slots, null)
  assert.equal(t.esign_verify_code, null)
})

await test('client ส่ง esign_slots/esign_verify_code มาเองตอน INSERT ไม่รับ · UPDATE แก้ไม่ได้ (ปลอมว่าทริปเป็นโหมดออนไลน์ไม่ได้)', async () => {
  const code = 'a'.repeat(32)
  const { rows } = await db.query(
    `INSERT INTO public.fleet_trips (municipality_id, esign_slots, esign_verify_code) VALUES ($1, '{"requester":"online"}'::jsonb, $2) RETURNING *`, [A, code])
  assert.equal(rows[0].esign_slots, null)
  assert.equal(rows[0].esign_verify_code, null)
  await db.query(`UPDATE public.fleet_trips SET esign_slots = '{"requester":"online"}'::jsonb, esign_verify_code = $1 WHERE id = $2`, [code, rows[0].id])
  const after = await trip(rows[0].id)
  assert.equal(after.esign_slots, null)
  assert.equal(after.esign_verify_code, null)
})

await test('สิทธิ์เรียกฟังก์ชัน/ตาราง: anon เรียกได้เฉพาะ esign_verify · ผู้ใช้อ่าน esign_signers ไม่ได้ · ไม่มี DML ตรงบนตารางลายเซ็น', async () => {
  const can = async (role, fn) => (await db.query(`SELECT has_function_privilege($1, $2, 'execute') AS ok`, [role, fn])).rows[0].ok
  assert.equal(await can('anon', 'public.esign_verify(text)'), true)
  for (const fn of ['public.esign_sign_fleet_trip(uuid,text,text,text)', 'public.esign_revoke_fleet_trip(uuid,text,text)', 'public.esign_trip_status(uuid)',
    'public.set_esign_policy(uuid,text,date,text,text)', 'public.set_esign_doc_type(uuid,text,jsonb)', 'public.set_esign_pin(text,text,boolean)',
    'public.esign_my_signer_state()', 'public.esign_suspend_me(text)', 'public.esign_reinstate_signer(uuid)', 'public.esign_gate_status(uuid)']) {
    assert.equal(await can('anon', fn), false, `anon ต้องเรียก ${fn} ไม่ได้`)
    assert.equal(await can('authenticated', fn), true, `authenticated ต้องเรียก ${fn} ได้`)
  }
  for (const fn of ['public.esign_expected_signer(public.fleet_trips,text)', 'public.esign_audit(uuid,text,text,text,text,jsonb)',
    'public.esign_fleet_trip_payload(public.fleet_trips)', 'public.esign_is_tenant_admin(uuid)', 'public.esign_registry_linked_count(uuid,text[])',
    'public.esign_fleet_trip_guard()', 'public.esign_block_mutation()']) {
    assert.equal(await can('anon', fn), false, `anon ต้องเรียก ${fn} ไม่ได้`)
    assert.equal(await can('authenticated', fn), false, `authenticated ต้องเรียก ${fn} ไม่ได้`)
  }
  const tp = async (role, table, priv) => (await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, table, priv])).rows[0].ok
  assert.equal(await tp('authenticated', 'public.esign_signers', 'select'), false)
  for (const table of ['esign_signatures', 'esign_revocations', 'esign_tenant_policy', 'esign_doc_type_settings', 'esign_signers']) {
    for (const priv of ['insert', 'update', 'delete', 'truncate']) {
      assert.equal(await tp('authenticated', `public.${table}`, priv), false, `${table} ${priv}`)
      assert.equal(await tp('anon', `public.${table}`, priv), false, `${table} ${priv} (anon)`)
    }
  }
  assert.equal(await tp('anon', 'public.esign_signatures', 'select'), false)
})

// ── (5) ประตู ─────────────────────────────────────────────────────────────────────────────────
await test('ประกาศ (เดิม G1): เฉพาะแอดมินของ อปท. นั้น (หรือ superadmin) บันทึกได้ · ไม่บังคับกรอก แต่กรอกแล้วต้องถูกรูปแบบ', async () => {
  const set = (no = 'ประกาศ อบต.ทดสอบเอ ที่ 5/2569', date = '2026-10-20', ref = 'หนังสือท้องถิ่นจังหวัด ที่ มท 0810/123', url = null) =>
    rpc('public.set_esign_policy($1, $2, $3::date, $4, $5)', [A, no, date, ref, url])
  for (const alias of ['anon', 'citizen', 'requester', 'fleetAdmin', 'adminB', 'staffB']) {
    await as(alias)
    assert.deepEqual(await set(), { ok: false, code: 'forbidden' }, alias)
  }
  await as('adminA')
  assert.deepEqual(await set('x'.repeat(201)), { ok: false, code: 'invalid_announcement_no' })
  assert.deepEqual(await set(undefined, '2099-01-01'), { ok: false, code: 'invalid_announcement_date' })
  assert.deepEqual(await set(undefined, undefined, 'ab'), { ok: false, code: 'invalid_approval_ref' })
  assert.deepEqual(await set(undefined, undefined, undefined, 'javascript:alert(1)'), { ok: false, code: 'invalid_announcement_url' })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_tenant_policy')).rows[0].n, 0, 'ข้อมูลผิดรูปแบบต้องไม่สร้างแถว')

  // เว้นว่างได้ทุกช่อง (ช่องว่าง/ช่องว่างล้วนถือเป็นไม่กรอก) และกรอกบางช่องได้
  assert.deepEqual(await set('', null, '   ', ''), { ok: true })
  const empty = (await db.query('SELECT announcement_no, announcement_date, approval_ref, announcement_url FROM public.esign_tenant_policy')).rows
  assert.deepEqual(empty, [{ announcement_no: null, announcement_date: null, approval_ref: null, announcement_url: null }])
  assert.deepEqual(await set('ประกาศ อบต.ทดสอบเอ ที่ 5/2569', null, null, null), { ok: true })
  assert.equal((await db.query('SELECT announcement_no FROM public.esign_tenant_policy')).rows[0].announcement_no, 'ประกาศ อบต.ทดสอบเอ ที่ 5/2569')
  await db.query('DELETE FROM public.esign_tenant_policy')
})

await test('ประตูเปิดสวิตช์: ไม่ต้องมีประกาศ · ต้องยืนยันทดลอง → ผู้ลงนามผูกบัญชี ตามลำดับ · ช่อง/ค่าผิดถูกปฏิเสธ · ปิดสวิตช์ลบแถว', async () => {
  const enable = modes => rpc('public.set_esign_doc_type($1, $2, $3::jsonb)', [A, 'fleet_trip_request', modes === null ? null : JSON.stringify(modes)])
  const all = { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'online' }
  await as('adminA')
  // ยังไม่มีแถวนโยบายเลย: ไม่ใช่ gate_policy_missing แล้ว — ติดที่ยังไม่ยืนยันทดลองอย่างเดียว
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_tenant_policy')).rows[0].n, 0)
  assert.deepEqual(await enable(all), { ok: false, code: 'gate_trial_missing' })
  // ยืนยันทดลองได้เลยโดยไม่ต้องบันทึกประกาศก่อน (สร้างแถวให้เอง)
  assert.deepEqual(await rpc('public.esign_confirm_trial($1)', [A]), { ok: true })
  const created = (await db.query('SELECT announcement_no, approval_ref, trial_confirmed_at IS NOT NULL AS trial FROM public.esign_tenant_policy')).rows
  assert.deepEqual(created, [{ announcement_no: null, approval_ref: null, trial: true }])

  // บันทึกประกาศทีหลัง (ไม่บังคับ) ต้องไม่ล้างคำยืนยันทดลอง · ล้างประกาศทั้งหมดก็ไม่ล้างคำยืนยัน
  assert.deepEqual(await rpc(`public.set_esign_policy($1, 'ประกาศ อบต.ทดสอบเอ ที่ 5/2569', '2026-10-20'::date, 'หนังสือท้องถิ่นจังหวัด ที่ มท 0810/123', 'https://example.go.th/p.pdf')`, [A]), { ok: true })
  assert.equal((await db.query('SELECT trial_confirmed_at IS NOT NULL AS trial FROM public.esign_tenant_policy')).rows[0].trial, true)
  assert.deepEqual(await rpc(`public.set_esign_policy($1, NULL, NULL::date, NULL, NULL)`, [A]), { ok: true })
  assert.deepEqual((await db.query('SELECT announcement_no, trial_confirmed_at IS NOT NULL AS trial FROM public.esign_tenant_policy')).rows, [{ announcement_no: null, trial: true }])
  assert.deepEqual(await rpc(`public.set_esign_policy($1, 'ประกาศ อบต.ทดสอบเอ ที่ 5/2569', '2026-10-20'::date, 'หนังสือท้องถิ่นจังหวัด ที่ มท 0810/123', 'https://example.go.th/p.pdf')`, [A]), { ok: true })

  assert.deepEqual(await enable(all), { ok: false, code: 'gate_authority_unlinked' })
  // ทะเบียนที่เป็นชื่อพิมพ์เอง (ไม่ผูกบัญชี) ไม่นับ
  await addRegistry('mayor', null, { manual: 'นายสมศักดิ์ พิมพ์เอง' })
  assert.deepEqual(await enable(all), { ok: false, code: 'gate_authority_unlinked' })
  await db.query(`UPDATE public.document_signatories SET is_active = false WHERE manual_name IS NOT NULL`)
  await addRegistry('mayor', 'mayor', { title: null })
  assert.deepEqual(await enable(all), { ok: false, code: 'gate_dept_head_unlinked' })
  await addRegistry('department_head', 'head', { dept: D1 })

  for (const bad of [{ requester: 'maybe' }, { driver: 'online' }, { requester: true }, ['online']]) {
    assert.deepEqual(await enable(bad), { ok: false, code: 'invalid_slot_modes' }, JSON.stringify(bad))
  }
  assert.deepEqual(await rpc(`public.set_esign_doc_type($1, 'complaint', '{"requester":"online"}'::jsonb)`, [A]), { ok: false, code: 'unknown_doc_type' })

  // ปิดทั้งหมด/NULL = ไม่มีแถว
  assert.deepEqual(await enable({ requester: 'wet', dept_head: 'wet' }), { ok: true, enabled: false })
  assert.deepEqual(await enable(null), { ok: true, enabled: false })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_doc_type_settings')).rows[0].n, 0)

  // เปิดจริง: ช่องที่ไม่ระบุ = เซ็นสด
  assert.deepEqual(await enable({ requester: 'online', dept_head: 'online', authority: 'online' }),
    { ok: true, enabled: true, slot_modes: { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'wet' } })

  // คนอื่นเปิด/ปิดไม่ได้
  for (const alias of ['requester', 'fleetAdmin', 'adminB', 'anon']) {
    await as(alias)
    assert.deepEqual(await enable(all), { ok: false, code: 'forbidden' }, alias)
    assert.deepEqual(await enable(null), { ok: false, code: 'forbidden' }, alias)
  }
  await as('adminA')
  const { rows } = await db.query(`SELECT action FROM public.audit_logs WHERE action LIKE 'esign_%' ORDER BY created_at`)
  const actions = rows.map(r => r.action)
  for (const a of ['esign_set_policy', 'esign_confirm_trial', 'esign_disable', 'esign_enable']) assert.ok(actions.includes(a), `audit ต้องมี ${a}`)
})

await test('esign_gate_status: แอดมิน/ผู้ดูแลรถอ่านได้ · คนนอกกอง/ประชาชน/อปท.อื่นอ่านไม่ได้', async () => {
  await as('adminA')
  const s = await rpc('public.esign_gate_status($1)', [A])
  assert.equal(s.ok, true)
  assert.equal(s.policy.announcement_no, 'ประกาศ อบต.ทดสอบเอ ที่ 5/2569')
  assert.ok(s.policy.trial_confirmed_at)
  assert.equal(s.slot_modes.requester, 'online')
  assert.equal(s.authority_linked, 1)
  assert.equal(s.dept_head_linked, 1)
  await as('fleetAdmin')
  assert.equal((await rpc('public.esign_gate_status($1)', [A])).ok, true)
  for (const alias of ['outsider', 'citizen', 'adminB', 'anon']) {
    await as(alias)
    assert.deepEqual(await rpc('public.esign_gate_status($1)', [A]), { ok: false, code: 'forbidden' }, alias)
  }
})

// ── (1) ตรึงโหมดตอนสร้าง ──────────────────────────────────────────────────────────────────────
let T = null // ทริปหลักของเทสต์ลงนาม (สร้างหลังเปิดสวิตช์)
await test('เปิดสวิตช์แล้ว ทริปใหม่ได้โหมดตรึง + รหัสตรวจสอบ · บันทึกย้อนหลัง/อปท.อื่น/ทริปเก่า ยังเซ็นสด · สลับสวิตช์ทีหลังไม่กระทบ', async () => {
  await as('requester')
  T = await makeTrip()
  assert.deepEqual(T.esign_slots, { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'wet' })
  assert.match(T.esign_verify_code, /^[0-9a-f]{32}$/)

  const backdated = await makeTrip({ status: 'completed' })
  assert.equal(backdated.esign_slots, null, 'บันทึกย้อนหลังไม่เข้าระบบลงนามออนไลน์')
  const other = await makeTrip({ muni: B, requester: 'staffB', dept: null })
  assert.equal(other.esign_slots, null, 'อปท. ที่ยังไม่เปิดต้องเซ็นสด')
  const legacy = (await db.query(`SELECT * FROM public.fleet_trips WHERE destination = 'LEGACY-1'`)).rows[0]
  assert.equal(legacy.esign_slots, null)
  assert.deepEqual(await rpc('public.esign_sign_fleet_trip($1, $2, $3, NULL)', [legacy.id, 'requester', '246810']), { ok: false, code: 'not_online' })

  // สลับสวิตช์ทีหลัง ทริปที่สร้างไปแล้วคงโหมดเดิม
  await as('adminA')
  await rpc(`public.set_esign_doc_type($1, 'fleet_trip_request', '{"requester":"wet"}'::jsonb)`, [A])
  assert.deepEqual((await trip(T.id)).esign_slots, { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'wet' })
  await as('requester')
  assert.equal((await makeTrip()).esign_slots, null, 'ปิดสวิตช์แล้วทริปใหม่เซ็นสด')
  await as('adminA')
  await rpc(`public.set_esign_doc_type($1, 'fleet_trip_request', '{"requester":"online","dept_head":"online","authority":"online","sk1":"online"}'::jsonb)`, [A])
  await as('requester')
  const withSk1 = await makeTrip()
  assert.deepEqual(withSk1.esign_slots, { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'online' })
})

await test('ระบบลงนามเสียต้องไม่ทำให้สร้างทริปไม่ได้ (stamp ผิดพลาด → ถือว่าเซ็นสด)', async () => {
  await db.exec('ALTER TABLE public.esign_doc_type_settings RENAME TO esign_doc_type_settings_broken')
  try {
    const t = await makeTrip()
    assert.equal(t.esign_slots, null)
    assert.equal(t.esign_verify_code, null)
  } finally {
    await db.exec('ALTER TABLE public.esign_doc_type_settings_broken RENAME TO esign_doc_type_settings')
  }
})

// ── รหัสลงนาม ─────────────────────────────────────────────────────────────────────────────────
await test('รหัสลงนาม: ต้อง 6 หลัก ไม่เดาง่าย · ครั้งแรกต้องรับทราบหน้าที่ · เปลี่ยนต้องใส่รหัสเดิม · เก็บเป็น bcrypt ไม่ใช่ข้อความ', async () => {
  await as('citizen')
  assert.deepEqual(await rpc(`public.set_esign_pin('246810', NULL, true)`), { ok: false, code: 'forbidden' })
  await as('anon')
  assert.deepEqual(await rpc(`public.set_esign_pin('246810', NULL, true)`), { ok: false, code: 'not_authenticated' })

  await as('requester')
  for (const bad of ['12345', '1234567', 'abcdef', '12 456', '']) assert.deepEqual(await rpc('public.set_esign_pin($1, NULL, true)', [bad]), { ok: false, code: 'invalid_pin' }, bad)
  await as('requester') // ล้างตัวนับ (โควตาตั้งรหัส 10 ครั้ง/5 นาที)
  for (const weak of ['111111', '123456', '654321', '000000']) assert.deepEqual(await rpc('public.set_esign_pin($1, NULL, true)', [weak]), { ok: false, code: 'weak_pin' }, weak)
  assert.deepEqual(await rpc(`public.set_esign_pin('246810', NULL, false)`), { ok: false, code: 'duty_ack_required' })
  assert.deepEqual(await rpc('public.esign_my_signer_state()'), { pin_set: false, duty_acked: false, suspended: false, locked_until: null })
  assert.deepEqual(await rpc(`public.set_esign_pin('246810', NULL, true)`), { ok: true })
  assert.deepEqual(await rpc('public.esign_my_signer_state()'), { pin_set: true, duty_acked: true, suspended: false, locked_until: null })
  const { rows } = await db.query('SELECT pin_hash FROM public.esign_signers WHERE user_id = $1', [users.requester.id])
  assert.match(rows[0].pin_hash, /^\$2[aby]\$/, 'ต้องเป็น bcrypt')
  assert.ok(!rows[0].pin_hash.includes('246810'))

  // เปลี่ยนรหัส: ต้องมีรหัสเดิม · รหัสเดิมผิดนับครั้งผิด
  assert.deepEqual(await rpc(`public.set_esign_pin('135790', NULL, false)`), { ok: false, code: 'bad_pin' })
  assert.deepEqual(await rpc(`public.set_esign_pin('135790', '000001', false)`), { ok: false, code: 'bad_pin' })
  assert.deepEqual(await rpc(`public.set_esign_pin('135790', '246810', false)`), { ok: true })
  assert.deepEqual(await rpc(`public.set_esign_pin('246810', '135790', false)`), { ok: true })
})

// ── ลงนาม ─────────────────────────────────────────────────────────────────────────────────────
const sign = (id, slot, pin, decision = null) => rpc('public.esign_sign_fleet_trip($1, $2, $3, $4)', [id, slot, pin, decision])
const status = id => rpc('public.esign_trip_status($1)', [id])
const slotOf = (st, name) => st.slots.find(s => s.slot === name)

await test('ลงนามผิดตัว/ข้ามลำดับ/ไม่มีรหัส/รหัสผิด ถูกปฏิเสธ และไม่เกิดแถวลายเซ็น', async () => {
  const countSigs = async () => (await db.query('SELECT count(*)::int AS n FROM public.esign_signatures WHERE doc_id = $1', [T.id])).rows[0].n
  await as('anon')
  assert.deepEqual(await sign(T.id, 'requester', '246810'), { ok: false, code: 'not_authenticated' })
  await as('head')
  // ผอ.กองลงช่องของผู้ขอไม่ได้ · ข้ามลำดับก่อนผู้ขอ
  assert.deepEqual(await sign(T.id, 'requester', '246810'), { ok: false, code: 'not_your_slot' })
  assert.deepEqual(await sign(T.id, 'dept_head', '246810'), { ok: false, code: 'wait_previous', waiting: ['requester'] })
  await as('mayor')
  assert.deepEqual(await sign(T.id, 'authority', '246810'), { ok: false, code: 'wait_previous', waiting: ['requester', 'dept_head'] })
  // ช่องที่ไม่ใช่ออนไลน์ / ช่องผิด / ไม่เข้าเงื่อนไข
  await as('requester')
  assert.deepEqual(await sign(T.id, 'sk1', '246810'), { ok: false, code: 'slot_not_online' })
  assert.deepEqual(await sign(T.id, 'driver', '246810'), { ok: false, code: 'bad_slot' })
  assert.deepEqual(await sign('00000000-0000-4000-8000-0000000000ff', 'requester', '246810'), { ok: false, code: 'not_found' })
  // ผู้ลงนามที่ยังไม่ตั้งรหัส (หัวหน้ากอง) — ผู้ขอต้องลงก่อนจึงจะถึงตา
  // รหัสผิด: นับครั้ง คืน remaining · 5 ครั้งล็อก
  assert.deepEqual(await sign(T.id, 'requester', '000001'), { ok: false, code: 'bad_pin', remaining: 4 })
  assert.deepEqual(await sign(T.id, 'requester', null), { ok: false, code: 'bad_pin', remaining: 3 })
  assert.equal(await countSigs(), 0)
})

await test('ผู้ขอลงนามสำเร็จ: เก็บชื่อ/ตำแหน่ง/hash/สำเนาเนื้อหา · กดซ้ำตอบ already (ไม่ต้องใส่รหัส) · ตัวนับผิดถูกล้าง', async () => {
  await as('requester')
  const first = await sign(T.id, 'requester', '246810')
  assert.equal(first.ok, true)
  assert.equal(first.already, false)
  assert.equal(first.complete, false)
  const { rows } = await db.query('SELECT * FROM public.esign_signatures WHERE doc_id = $1', [T.id])
  assert.equal(rows.length, 1)
  const s = rows[0]
  assert.equal(s.signer_id, users.requester.id)
  assert.equal(s.signer_name, 'สมหญิง ผู้ขอ')
  assert.equal(s.signer_position, 'นักวิชาการศึกษา')
  assert.equal(s.slot, 'requester')
  assert.equal(s.decision, 'sign')
  assert.match(s.content_hash, /^[0-9a-f]{64}$/)
  assert.equal(s.template_version, 'fleet-form3-v1')
  assert.equal(s.content_snapshot.destination, 'สำนักงานจังหวัดแพร่ ห้องประชุม 2')
  assert.equal(s.content_snapshot.passengers, 3)
  assert.equal(s.content_snapshot.planned_departure, '2026-11-03T02:00:00Z')
  // snapshot ต้องสร้าง hash เดียวกับที่ฟังก์ชันคำนวณจากแถวปัจจุบัน
  const recomputed = (await db.query('SELECT public.esign_content_hash(public.esign_fleet_trip_payload(t)) AS h FROM public.fleet_trips t WHERE t.id = $1', [T.id])).rows[0].h
  assert.equal(recomputed, s.content_hash)
  const state = (await db.query('SELECT failed_count FROM public.esign_signers WHERE user_id = $1', [users.requester.id])).rows[0]
  assert.equal(state.failed_count, 0, 'ลงนามสำเร็จต้องล้างตัวนับครั้งที่ผิด')

  const again = await sign(T.id, 'requester', 'ผิด-ไม่ต้องใช้')
  assert.deepEqual({ ok: again.ok, already: again.already, id: again.signature_id }, { ok: true, already: true, id: first.signature_id })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signatures WHERE doc_id = $1', [T.id])).rows[0].n, 1)
})

await test('รหัสผิด 5 ครั้งล็อก 15 นาที: ล็อกแล้วรหัสถูกก็ลงไม่ได้ · พ้นเวลาล็อกลงได้ · ผู้ลงนามยังไม่ตั้งรหัส/ไม่รับทราบหน้าที่ = pin_not_set', async () => {
  await as('head')
  assert.deepEqual(await sign(T.id, 'dept_head', '111222'), { ok: false, code: 'pin_not_set' })
  await rpc(`public.set_esign_pin('482916', NULL, true)`)
  for (let i = 0; i < 5; i++) {
    const r = await sign(T.id, 'dept_head', '000009')
    assert.equal(r.code, 'bad_pin', `ครั้งที่ ${i + 1}`)
    assert.equal(r.remaining, Math.max(0, 4 - i))
  }
  const locked = await sign(T.id, 'dept_head', '482916')
  assert.equal(locked.code, 'pin_locked')
  assert.ok(locked.locked_until)
  assert.equal((await rpc('public.esign_my_signer_state()')).locked_until !== null, true)
  // เปลี่ยนรหัสระหว่างล็อกก็ไม่ได้
  assert.equal((await rpc(`public.set_esign_pin('135791', '482916', false)`)).code, 'pin_locked')
  await db.query(`UPDATE public.esign_signers SET locked_until = now() - interval '1 minute' WHERE user_id = $1`, [users.head.id])
  const ok = await sign(T.id, 'dept_head', '482916')
  assert.equal(ok.ok, true)
  assert.equal(ok.complete, false)
})

await test('ผู้มีอำนาจลงนาม: decision = approve · ครบทุกช่องออนไลน์ → complete · ไม่แตะ approved_by/approval_method', async () => {
  await as('mayor')
  await rpc(`public.set_esign_pin('369258', NULL, true)`)
  assert.deepEqual(await sign(T.id, 'authority', '369258', 'reject'), { ok: false, code: 'bad_decision' })
  const done = await sign(T.id, 'authority', '369258', 'approve')
  assert.equal(done.ok, true)
  assert.equal(done.complete, true)
  const { rows } = await db.query(`SELECT decision, signer_position, signed_as, registry_signatory_id FROM public.esign_signatures WHERE doc_id = $1 AND slot = 'authority'`, [T.id])
  assert.equal(rows[0].decision, 'approve')
  assert.equal(rows[0].signer_position, 'นายกองค์การบริหารส่วนตำบลทดสอบเอ')
  assert.ok(rows[0].registry_signatory_id)
  const t = await trip(T.id)
  assert.equal(t.approved_by, null, 'ลงนามออนไลน์ต้องไม่เติม approved_by')
  assert.equal(t.approval_method, null, 'ลงนามออนไลน์ต้องไม่เปลี่ยน approval_method')
  assert.equal(t.status, 'pending')
})

await test('esign_trip_status: ผู้ลงนาม/ผู้ขอ/ผู้ดูแลรถเห็น · คนนอกกอง/ประชาชน/อปท.อื่น/anon เห็นเป็นไม่พบ · can_sign ตรงกับลำดับ', async () => {
  await as('requester')
  const st = await status(T.id)
  assert.equal(st.found, true)
  assert.equal(st.mode, 'online')
  assert.equal(st.complete, true)
  assert.equal(st.integrity, 'ok')
  assert.deepEqual(st.slots.map(s => [s.slot, s.mode, s.signed]), [['requester', 'online', true], ['dept_head', 'online', true], ['authority', 'online', true], ['sk1', 'wet', false]])
  assert.equal(slotOf(st, 'authority').signature.signer_name, 'สมศักดิ์ นายก')
  assert.equal(st.slots.some(s => s.can_sign), false)
  for (const alias of ['head', 'mayor', 'fleetAdmin', 'adminA']) { await as(alias); assert.equal((await status(T.id)).found, true, alias) }
  for (const alias of ['outsider', 'citizen', 'staffB', 'anon', 'adminB']) { await as(alias); assert.deepEqual(await status(T.id), { found: false }, alias) }

  // ทริปใหม่: เห็นว่าใครถึงตา
  await as('requester')
  const t2 = await makeTrip()
  const s2 = await status(t2.id)
  assert.equal(slotOf(s2, 'requester').can_sign, true)
  assert.equal(slotOf(s2, 'dept_head').can_sign, false)
  assert.equal(slotOf(s2, 'dept_head').waiting_for_previous, true)
  assert.equal(slotOf(s2, 'dept_head').expected_name, 'สมชาย หัวหน้ากอง')
  assert.equal(slotOf(s2, 'authority').expected_name, 'สมศักดิ์ นายก')
  await as('head')
  assert.equal(slotOf(await status(t2.id), 'dept_head').can_sign, false, 'ยังไม่ถึงตาเพราะผู้ขอยังไม่ลง')
})

// ── หน้าตรวจสอบสาธารณะ ───────────────────────────────────────────────────────────────────────
await test('esign_verify (anon): เห็นผู้ลงนามกับสถานะ · ไม่เห็นปลายทาง/วัตถุประสงค์/id/จำนวนคน · รหัสผิดรูป/ไม่มี ตอบ found:false เหมือนกัน', async () => {
  await as('anon')
  const v = await rpc('public.esign_verify($1)', [T.esign_verify_code])
  assert.equal(v.found, true)
  assert.equal(v.state, 'complete')
  assert.equal(v.trip_status, 'active')
  assert.equal(v.municipality_name, 'อบต.ทดสอบเอ')
  assert.equal(v.signed_count, 3)
  assert.equal(v.required, 3)
  assert.deepEqual(v.slots.map(s => s.slot), ['requester', 'dept_head', 'authority'])
  assert.deepEqual(v.slots.map(s => s.signer_name), ['สมหญิง ผู้ขอ', 'สมชาย หัวหน้ากอง', 'สมศักดิ์ นายก'])
  assert.equal(v.document_date, '2026-10-30')
  const dump = JSON.stringify(v)
  for (const leak of ['สำนักงานจังหวัดแพร่', 'อบรมเชิงปฏิบัติการลับ', 'อำเภอเมือง', T.id, '"passengers"', 'content_hash', 'content_snapshot', users.requester.id]) {
    assert.ok(!dump.includes(leak), `หน้าสาธารณะต้องไม่มี ${leak}`)
  }
  const notFound = { found: false }
  for (const bad of ['x', '', null, T.esign_verify_code.toUpperCase(), 'f'.repeat(32), T.esign_verify_code + '0']) {
    assert.deepEqual(await rpc('public.esign_verify($1)', [bad]), notFound, String(bad))
  }
})

await test('esign_verify: จำกัดการยิงรัว (30 ครั้ง/5 นาที ต่อผู้เรียก) ตอบ PT429', async () => {
  await as('anon')
  await db.query(`SELECT set_config('request.headers', '{"cf-connecting-ip":"198.51.100.77"}', false)`)
  let tripped = null
  for (let i = 0; i < 40 && !tripped; i++) {
    try { await rpc('public.esign_verify($1)', ['0'.repeat(32)]) } catch (error) { tripped = error }
  }
  assert.ok(tripped, 'ต้องถูกจำกัดภายใน 40 ครั้ง')
  assert.equal(tripped.code, 'PT429')
})

await test('ลงนาม/ตั้งรหัส จำกัดการเรียกรัว (30 และ 10 ครั้ง/5 นาที ต่อผู้ใช้) ตอบ PT429', async () => {
  await as('requester')
  let tripped = null
  for (let i = 0; i < 40 && !tripped; i++) {
    try { await sign('00000000-0000-4000-8000-0000000000ee', 'requester', '000000') } catch (error) { tripped = error }
  }
  assert.ok(tripped && tripped.code === 'PT429', 'ลงนามต้องถูกจำกัด')
  await as('requester')
  tripped = null
  for (let i = 0; i < 20 && !tripped; i++) {
    try { await rpc(`public.set_esign_pin('13579x', NULL, true)`) } catch (error) { tripped = error }
  }
  assert.ok(tripped && tripped.code === 'PT429', 'ตั้งรหัสต้องถูกจำกัด')
})

// ── ล็อกเนื้อหา ───────────────────────────────────────────────────────────────────────────────
await test('เนื้อหาคำขอที่ลงนามแล้วแก้ไม่ได้ · ฟิลด์ที่เปลี่ยนตามการเดินทาง/อนุมัติ/ยกเลิก แก้ได้ · เขียนค่าเดิมซ้ำไม่นับว่าแก้', async () => {
  await as('requester')
  for (const [col, value] of [['destination', 'ที่อื่น'], ['purpose', 'เรื่องอื่น'], ['passengers', 9], ['destination_province', 'น่าน'],
    ['planned_departure', '2026-11-04 09:00+07'], ['requester_position', 'ผู้ช่วย'], ['dept_head_department_id', D2], ['order_authority_role', 'clerk'], ['document_date', '2026-10-31']]) {
    await expectError(db.query(`UPDATE public.fleet_trips SET ${col} = $1 WHERE id = $2`, [value, T.id]), /ESIGN_TRIP_LOCKED/)
  }
  // ค่าเดิม ไม่ใช่การแก้
  await db.query('UPDATE public.fleet_trips SET destination = destination, passengers = 3 WHERE id = $1', [T.id])
  // ฟิลด์ปฏิบัติการ/สถานะ ผ่านปกติ — เริ่มทริปแล้วลายเซ็นต้องไม่พัง
  await db.query(`UPDATE public.fleet_trips SET driver_id = $2, vehicle_id = $3, started_at = now(), odometer_start = 12000, odometer_end = 12040,
    returned_at = now(), notes = 'เดินทางแล้ว', status = 'completed', approved_by = $2, approval_method = 'manual' WHERE id = $1`,
  [T.id, users.fleetAdmin.id, '00000000-0000-4000-8000-0000000000c1'])
  assert.equal((await status(T.id)).integrity, 'ok', 'ฟิลด์ปฏิบัติการเปลี่ยนต้องไม่ทำให้ hash เพี้ยน')
  await db.query(`UPDATE public.fleet_trips SET status = 'cancelled' WHERE id = $1`, [T.id])
  await db.query(`UPDATE public.fleet_trips SET status = 'completed' WHERE id = $1`, [T.id])
  // ลบไม่ได้ (ยกเลิกแทน)
  await expectError(db.query('DELETE FROM public.fleet_trips WHERE id = $1', [T.id]), /ESIGN_TRIP_HAS_SIGNATURES/)
  // ทริปที่ไม่มีลายเซ็นลบได้ปกติ
  const plain = await makeTrip({ status: 'draft' })
  await db.query('DELETE FROM public.fleet_trips WHERE id = $1', [plain.id])
})

await test('ลายเซ็นกับการถอนแก้/ลบ/TRUNCATE ไม่ได้ แม้เป็นเจ้าของตาราง', async () => {
  const sigId = (await db.query('SELECT id FROM public.esign_signatures WHERE doc_id = $1 LIMIT 1', [T.id])).rows[0].id
  await expectError(db.query(`UPDATE public.esign_signatures SET signer_name = 'ปลอม' WHERE id = $1`, [sigId]), /ESIGN_APPEND_ONLY/)
  await expectError(db.query('DELETE FROM public.esign_signatures WHERE id = $1', [sigId]), /ESIGN_APPEND_ONLY/)
  // ตารางลายเซ็นมี FK จากตารางถอน → TRUNCATE เฉยๆ ถูก PostgreSQL ปัดก่อนถึง trigger; แบบ CASCADE ต้องถูก trigger ปัด
  await expectError(db.query('TRUNCATE public.esign_signatures'), /ESIGN_APPEND_ONLY|cannot truncate a table referenced/)
  await expectError(db.query('TRUNCATE public.esign_signatures CASCADE'), /ESIGN_APPEND_ONLY/)
  await expectError(db.query('TRUNCATE public.esign_revocations'), /ESIGN_APPEND_ONLY/)
  // เก็บแถวถอนไว้ทดสอบ: สร้างทริปเฉพาะกิจ ลงนาม แล้วถอน
  await as('requester')
  const t = await makeTrip()
  await sign(t.id, 'requester', '246810')
  assert.equal((await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'ทดสอบถอน', 'requester'])).revoked, 1)
  const rev = (await db.query('SELECT id FROM public.esign_revocations LIMIT 1')).rows[0]
  await expectError(db.query(`UPDATE public.esign_revocations SET reason = 'แก้ย้อนหลัง' WHERE id = $1`, [rev.id]), /ESIGN_APPEND_ONLY/)
  await expectError(db.query('DELETE FROM public.esign_revocations WHERE id = $1', [rev.id]), /ESIGN_APPEND_ONLY/)
})

await test('จับได้เมื่อเนื้อหาถูกแก้ข้ามด่าน (ปิด trigger): สถานะ modified ทั้งหน้าตรวจสอบและสถานะทริป · แก้กลับแล้วหาย', async () => {
  await db.exec('ALTER TABLE public.fleet_trips DISABLE TRIGGER trg_fleet_trips_esign_guard')
  await db.query(`UPDATE public.fleet_trips SET destination = 'ถูกแก้ข้ามด่าน' WHERE id = $1`, [T.id])
  await db.exec('ALTER TABLE public.fleet_trips ENABLE TRIGGER trg_fleet_trips_esign_guard')
  await as('anon')
  const v = await rpc('public.esign_verify($1)', [T.esign_verify_code])
  assert.equal(v.state, 'modified')
  await as('requester')
  const st = await status(T.id)
  assert.equal(st.integrity, 'modified')
  assert.equal(slotOf(st, 'requester').signature.content_matches, false)
  // สำเนาเนื้อหาเดิมยังอยู่ในลายเซ็น ใช้เทียบ/กู้ได้
  const snap = (await db.query(`SELECT content_snapshot FROM public.esign_signatures WHERE doc_id = $1 AND slot = 'requester'`, [T.id])).rows[0].content_snapshot
  assert.equal(snap.destination, 'สำนักงานจังหวัดแพร่ ห้องประชุม 2')
  await db.exec('ALTER TABLE public.fleet_trips DISABLE TRIGGER trg_fleet_trips_esign_guard')
  await db.query('UPDATE public.fleet_trips SET destination = $1 WHERE id = $2', [snap.destination, T.id])
  await db.exec('ALTER TABLE public.fleet_trips ENABLE TRIGGER trg_fleet_trips_esign_guard')
  await as('anon')
  assert.equal((await rpc('public.esign_verify($1)', [T.esign_verify_code])).state, 'complete')
})

await test('hash ไม่เพี้ยนตาม timezone ของ session', async () => {
  const hashUnder = async tz => {
    await db.query(`SET TIME ZONE '${tz}'`)
    return (await db.query('SELECT public.esign_content_hash(public.esign_fleet_trip_payload(t)) AS h FROM public.fleet_trips t WHERE t.id = $1', [T.id])).rows[0].h
  }
  const h1 = await hashUnder('UTC')
  const h2 = await hashUnder('Asia/Bangkok')
  const h3 = await hashUnder('America/Los_Angeles')
  await db.query('SET TIME ZONE DEFAULT')
  assert.equal(h1, h2)
  assert.equal(h1, h3)
})

// ── ลบทริปที่มีลายเซ็น (เจ้าของสั่ง 2569-10-25: แอดมินลบได้) ─────────────────────────────────
await test('ลบทริปที่มีลายเซ็น: เฉพาะแอดมิน อปท. นั้น/superadmin · คนอื่นลบไม่ได้ · หลักฐานลายเซ็นไม่หาย · audit บอกว่าใครลบ · ลบ audit ไม่ได้ = ลบไม่ผ่าน', async () => {
  // ทริปหนึ่งใบ: ผู้ขอลงนามแล้ว (ใช้ได้) + ผอ.กองลงนามแล้วถอน (ถอนแล้ว) → ลายเซ็น 2 แถว ใช้ได้ 1 ถอน 1
  await as('requester')
  const t = await makeTrip()
  await sign(t.id, 'requester', '246810')
  await as('head')
  await sign(t.id, 'dept_head', '482916')
  assert.equal((await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'ทดสอบถอนก่อนลบ', 'dept_head'])).revoked, 1)

  // คนอื่นลบไม่ได้ ทุกแบบ (รวมผู้ดูแลรถที่ไม่ใช่แอดมิน และแอดมินของ อปท. อื่น และผู้ไม่ล็อกอิน)
  for (const who of ['requester', 'head', 'clerk', 'fleetAdmin', 'outsider', 'citizen', 'adminB', 'anon']) {
    await as(who)
    await expectError(db.query('DELETE FROM public.fleet_trips WHERE id = $1', [t.id]), /ESIGN_TRIP_HAS_SIGNATURES/)
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.fleet_trips WHERE id = $1', [t.id])).rows[0].n, 1, 'ลบผิดคนแล้วทริปต้องยังอยู่')

  const countOf = async table => (await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n
  const before = {
    signatures: (await db.query(`SELECT count(*)::int AS n FROM public.esign_signatures WHERE doc_id = $1`, [t.id])).rows[0].n,
    allSignatures: await countOf('esign_signatures'),
    revocations: await countOf('esign_revocations'),
    stamps: await countOf('esign_signature_stamps'),
    blobs: await countOf('esign_image_blobs'),
  }
  assert.equal(before.signatures, 2)

  // audit เขียนไม่ได้ = ลบไม่ผ่านด้วย (ไม่มีทางลบโดยไม่มีร่องรอย) แล้วทริปต้องยังอยู่
  await as('adminA')
  await db.exec('ALTER TABLE public.audit_logs RENAME TO audit_logs_broken')
  try {
    await expectError(db.query('DELETE FROM public.fleet_trips WHERE id = $1', [t.id]), /audit_logs/)
  } finally {
    await db.exec('ALTER TABLE public.audit_logs_broken RENAME TO audit_logs')
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.fleet_trips WHERE id = $1', [t.id])).rows[0].n, 1)

  // แอดมินของ อปท. เดียวกันลบได้
  await db.query('DELETE FROM public.fleet_trips WHERE id = $1', [t.id])
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.fleet_trips WHERE id = $1', [t.id])).rows[0].n, 0)

  // หลักฐานไม่หายสักแถว: ลายเซ็น/การถอน/ภาพ/คลังภาพ + สำเนาเนื้อหาที่ลงนามยังอยู่ในแถวลายเซ็น
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.esign_signatures WHERE doc_id = $1`, [t.id])).rows[0].n, 2)
  assert.equal(await countOf('esign_signatures'), before.allSignatures)
  assert.equal(await countOf('esign_revocations'), before.revocations)
  assert.equal(await countOf('esign_signature_stamps'), before.stamps)
  assert.equal(await countOf('esign_image_blobs'), before.blobs)
  const snap = (await db.query(`SELECT content_snapshot, content_hash FROM public.esign_signatures WHERE doc_id = $1 AND slot = 'requester'`, [t.id])).rows[0]
  assert.equal(snap.content_snapshot.destination, 'สำนักงานจังหวัดแพร่ ห้องประชุม 2')
  assert.match(snap.content_hash, /^[0-9a-f]{64}$/)

  // audit: ใครลบ/อปท./id ทริป/จำนวนลายเซ็น — ไม่มีปลายทาง วัตถุประสงค์ หรือรหัสตรวจสอบ
  const audit = (await db.query(`SELECT actor_id, actor_role, municipality_id, resource_type, resource_id, metadata, metadata::text AS m
    FROM public.audit_logs WHERE action = 'esign_trip_deleted' AND resource_id = $1`, [t.id])).rows
  assert.equal(audit.length, 1)
  assert.equal(audit[0].actor_id, users.adminA.id)
  assert.equal(audit[0].municipality_id, A)
  assert.equal(audit[0].resource_type, 'fleet_trip')
  assert.deepEqual({ signatures: audit[0].metadata.signatures, valid: audit[0].metadata.valid, revoked: audit[0].metadata.revoked },
    { signatures: 2, valid: 1, revoked: 1 })
  assert.equal(audit[0].metadata.signature_ids.length, 2)
  for (const secret of ['สำนักงานจังหวัดแพร่', 'อบรมเชิงปฏิบัติการลับ', t.esign_verify_code, '246810', '482916']) {
    assert.ok(!audit[0].m.includes(secret), `audit ต้องไม่มี ${secret}`)
  }

  // หลังลบ: หน้าตรวจสอบสาธารณะไม่พบ (รหัสอยู่ที่แถวทริป) · รายการ "รอลงนามของฉัน" ไม่มีทริปนี้
  await as('anon')
  assert.equal((await rpc('public.esign_verify($1)', [t.esign_verify_code])).found, false)
  await as('mayor')
  const pending = await rpc('public.esign_my_pending()')
  assert.ok(!(pending.items ?? []).some(item => item.trip_id === t.id), 'ทริปที่ลบแล้วต้องไม่อยู่ในรายการรอลงนาม')

  // superadmin ลบทริปของ อปท. ใดก็ได้ · ทริปที่ไม่มีลายเซ็นยังลบได้โดยไม่ผ่านด่าน/ไม่เขียน audit ลบ
  await as('requester')
  const t2 = await makeTrip()
  await sign(t2.id, 'requester', '246810')
  await as('superadmin')
  await db.query('DELETE FROM public.fleet_trips WHERE id = $1', [t2.id])
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.audit_logs WHERE action = 'esign_trip_deleted' AND resource_id = $1`, [t2.id])).rows[0].n, 1)
  await as('requester')
  const plain = await makeTrip({ status: 'draft' })
  await db.query('DELETE FROM public.fleet_trips WHERE id = $1', [plain.id])
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.audit_logs WHERE action = 'esign_trip_deleted' AND resource_id = $1`, [plain.id])).rows[0].n, 0)
})

// ── ถอนลายเซ็น ────────────────────────────────────────────────────────────────────────────────
await test('ถอนลายเซ็น: ผู้ดูแลรถ/ผู้ขอ/เจ้าของลายเซ็นเท่านั้น · ต้องมีเหตุผล · ถอนช่องต้นสายถอนช่องท้ายสายด้วย · ถอนแล้วแก้เนื้อหาได้และเซ็นใหม่ได้', async () => {
  await as('requester')
  const t = await makeTrip()
  await sign(t.id, 'requester', '246810')
  await as('head')
  await sign(t.id, 'dept_head', '482916')
  await as('mayor')
  await sign(t.id, 'authority', '369258', 'approve')

  await as('outsider')
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, NULL)', [t.id, 'ขอแก้']), { ok: false, code: 'forbidden' })
  await as('head')
  // เจ้าของลายเซ็นถอนช่องตัวเองได้ แต่ถอนช่องของคนอื่น (requester) ไม่ได้
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'ขอแก้', 'requester']), { ok: false, code: 'forbidden' })
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'ก', 'dept_head']), { ok: false, code: 'invalid_reason' })
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'x', 'driver']).catch(() => null), { ok: false, code: 'invalid_reason' })
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'เนื้อหาไม่ถูกต้อง', 'dept_head']), { ok: true, revoked: 2 }, 'ถอน dept_head ต้องถอน authority ด้วย')
  let st = await status(t.id)
  assert.deepEqual(st.slots.map(s => s.signed), [true, false, false, false])
  assert.equal(st.complete, false)

  // ผู้ขอถอนทั้งหมดเพื่อแก้คำขอ → แก้เนื้อหาได้ → ลงนามใหม่
  await as('requester')
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, NULL)', [t.id, 'แก้ปลายทาง']), { ok: true, revoked: 1 })
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, NULL)', [t.id, 'ซ้ำ']), { ok: true, revoked: 0 })
  await db.query(`UPDATE public.fleet_trips SET destination = 'ปลายทางใหม่' WHERE id = $1`, [t.id])
  const resign = await sign(t.id, 'requester', '246810')
  assert.equal(resign.ok, true)
  assert.equal(resign.already, false)
  const snaps = (await db.query(`SELECT content_snapshot->>'destination' AS d FROM public.esign_signatures WHERE doc_id = $1 AND slot = 'requester' ORDER BY signed_at`, [t.id])).rows.map(r => r.d)
  assert.deepEqual(snaps, ['สำนักงานจังหวัดแพร่ ห้องประชุม 2', 'ปลายทางใหม่'], 'ลายเซ็นเก่าคงสำเนาเดิมไว้ ไม่ถูกเขียนทับ')
  await as('anon')
  const v = await rpc('public.esign_verify($1)', [t.esign_verify_code])
  assert.equal(v.revoked_count, 3)
  assert.equal(v.state, 'partial')
  assert.ok(!JSON.stringify(v).includes('แก้ปลายทาง'), 'เหตุผลการถอนไม่ออกหน้าสาธารณะ')

  // ผู้ดูแลระบบยานพาหนะถอนได้
  await as('fleetAdmin')
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, NULL)', [t.id, 'ผู้ดูแลสั่งถอน']), { ok: true, revoked: 1 })
  await as('anon')
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, NULL)', [t.id, 'ไม่ล็อกอิน']), { ok: false, code: 'not_authenticated' })
})

// ── ระงับการลงนาม ─────────────────────────────────────────────────────────────────────────────
await test('ระงับการลงนามของฉัน: ลงนามไม่ได้ทันที · เปิดคืนได้เฉพาะแอดมิน อปท. ของผู้นั้น · เปลี่ยนรหัสไม่ปลดระงับ', async () => {
  await as('requester')
  const t = await makeTrip()
  assert.deepEqual(await rpc(`public.esign_suspend_me('สงสัยรหัสรั่ว')`), { ok: true })
  assert.equal((await rpc('public.esign_my_signer_state()')).suspended, true)
  assert.deepEqual(await sign(t.id, 'requester', '246810'), { ok: false, code: 'suspended' })
  assert.deepEqual(await rpc(`public.set_esign_pin('246810', '246810', false)`), { ok: true })
  assert.deepEqual(await sign(t.id, 'requester', '246810'), { ok: false, code: 'suspended' })

  for (const alias of ['requester', 'adminB', 'fleetAdmin', 'citizen', 'anon']) {
    await as(alias)
    assert.deepEqual(await rpc('public.esign_reinstate_signer($1)', [users.requester.id]), { ok: false, code: 'forbidden' }, alias)
  }
  await as('adminA')
  assert.deepEqual(await rpc('public.esign_reinstate_signer($1)', [users.requester.id]), { ok: true })
  await as('requester')
  assert.equal((await sign(t.id, 'requester', '246810')).ok, true)
  // ผู้ที่ยังไม่เคยมีแถวผู้ลงนามระงับได้ (ไม่ต้องมีรหัสก่อน)
  await as('clerk')
  assert.deepEqual(await rpc(`public.esign_suspend_me(NULL)`), { ok: true })
  assert.equal((await rpc('public.esign_my_signer_state()')).suspended, true)
})

// ── ช่องที่ผู้ลงนามยังไม่พร้อม ────────────────────────────────────────────────────────────────
await test('ผู้ลงนามในทะเบียนเป็นชื่อพิมพ์เอง/ไม่มีในทะเบียน/ผู้ลงนามตัวจริงคนละกอง → ลงนามไม่ได้ พร้อมเหตุผลที่แก้ได้', async () => {
  await as('requester')
  // กอง D2 ไม่มีหัวหน้าในทะเบียน
  const t = await makeTrip({ dept: D2 })
  await sign(t.id, 'requester', '246810')
  await as('head')
  assert.deepEqual(await sign(t.id, 'dept_head', '482916'), { ok: false, code: 'signatory_missing' })
  assert.equal(slotOf(await status(t.id), 'dept_head').blocked, 'signatory_missing')
  // กอง D2 มีหัวหน้าแบบชื่อพิมพ์เอง
  await addRegistry('department_head', null, { dept: D2, manual: 'นายพิมพ์เอง หัวหน้ากองคลัง' })
  assert.deepEqual(await sign(t.id, 'dept_head', '482916'), { ok: false, code: 'signatory_not_linked' })
  assert.equal(slotOf(await status(t.id), 'dept_head').blocked, 'signatory_not_linked')
  // หัวหน้ากอง D1 ลงช่องของกอง D2 ไม่ได้ เมื่อกอง D2 ผูกกับอีกคน
  await db.query(`UPDATE public.document_signatories SET is_active = false WHERE department_id = $1`, [D2])
  await addRegistry('department_head', 'headB', { dept: D2, title: 'รักษาราชการแทนผู้อำนวยการกองคลัง' })
  assert.deepEqual(await sign(t.id, 'dept_head', '482916'), { ok: false, code: 'not_your_slot' })
  // ผู้แทนตัวจริงลงได้ และ "ฐานะ" มาจากทะเบียน ไม่ใช่ที่ผู้ลงนามพิมพ์
  await as('headB')
  await rpc(`public.set_esign_pin('715384', NULL, true)`)
  assert.equal((await sign(t.id, 'dept_head', '715384')).ok, true)
  const row = (await db.query(`SELECT signer_name, signer_position, signed_as FROM public.esign_signatures WHERE doc_id = $1 AND slot = 'dept_head'`, [t.id])).rows[0]
  assert.deepEqual(row, { signer_name: 'สมหมาย รักษาการ', signer_position: 'หัวหน้าฝ่าย', signed_as: 'รักษาราชการแทนผู้อำนวยการกองคลัง' })
})

await test('ผู้มีอำนาจเลือกเป็นปลัด/ตำแหน่งที่สร้างเอง: ผูกตามทริป · ปลัดลงช่องที่ระบุนายกไม่ได้', async () => {
  await addRegistry('clerk', 'clerk')
  await addRegistry('custom', 'fleetAdmin', { label: 'รองนายกรักษาการ', title: 'รองนายกองค์การบริหารส่วนตำบล' })
  await as('requester')
  const byClerk = await makeTrip({ authority: 'clerk' })
  const byCustom = await makeTrip({ authority: 'custom', label: 'รองนายกรักษาการ' })
  const byMayor = await makeTrip()
  for (const id of [byClerk.id, byCustom.id, byMayor.id]) {
    await sign(id, 'requester', '246810')
    await as('head'); await sign(id, 'dept_head', '482916'); await as('requester')
  }
  // ปลัดถูกระงับไว้จากเทสต์ก่อนหน้า — แอดมินเปิดคืน
  await as('adminA')
  await rpc('public.esign_reinstate_signer($1)', [users.clerk.id])
  await as('clerk')
  await rpc(`public.set_esign_pin('579135', NULL, true)`)
  assert.deepEqual(await sign(byMayor.id, 'authority', '579135', 'approve'), { ok: false, code: 'not_your_slot' })
  assert.equal((await sign(byClerk.id, 'authority', '579135', 'approve')).ok, true)
  await as('fleetAdmin')
  await rpc(`public.set_esign_pin('864209', NULL, true)`)
  assert.equal((await sign(byCustom.id, 'authority', '864209', 'approve')).ok, true)
  const sig = (await db.query(`SELECT signed_as FROM public.esign_signatures WHERE doc_id = $1 AND slot = 'authority'`, [byCustom.id])).rows[0]
  assert.equal(sig.signed_as, 'รองนายกองค์การบริหารส่วนตำบล')
})

await test('สก.๑: ช่อง sk1 ใช้ได้เฉพาะผู้ขอที่ตำแหน่งขึ้นต้น "นายก" (ไม่ใช่รองนายก/นายกรัฐมนตรี) และไม่ติดลำดับ', async () => {
  const check = async (position, expectApplicable) => {
    await as('mayor')
    // ผู้ขอเป็นนายก: ใช้บัญชี mayor เป็นผู้ขอ
    const t = await makeTrip({ requester: 'mayor', position })
    const st = await status(t.id)
    assert.equal(slotOf(st, 'sk1').applicable, expectApplicable, position)
    assert.equal(st.required, expectApplicable ? 4 : 3, position)
    return t
  }
  await as('mayor')
  await rpc(`public.set_esign_pin('928374', '369258', false)`)
  const mayorTrip = await check('นายกองค์การบริหารส่วนตำบลทดสอบเอ', true)
  await check('รองนายกองค์การบริหารส่วนตำบล', false)
  await check('นายกรัฐมนตรี', false)
  const notMayor = await check('ผู้ช่วยเลขานุการนายก', false)
  assert.deepEqual(await sign(notMayor.id, 'sk1', '928374'), { ok: false, code: 'not_applicable' })
  // sk1 ลงก่อนช่องอื่นได้ และตัวผู้ขอเท่านั้นที่ลงได้
  assert.equal((await sign(mayorTrip.id, 'sk1', '928374')).ok, true)
  await as('requester')
  assert.deepEqual(await sign(mayorTrip.id, 'sk1', '246810'), { ok: false, code: 'not_your_slot' })
})

await test('ทริปที่ปฏิเสธ/ยกเลิกแล้วลงนามไม่ได้ · หน้าตรวจสอบแสดงสถานะยกเลิก/ปฏิเสธ', async () => {
  await as('requester')
  const t = await makeTrip()
  await sign(t.id, 'requester', '246810')
  await db.query(`UPDATE public.fleet_trips SET status = 'cancelled' WHERE id = $1`, [t.id])
  await as('head')
  assert.deepEqual(await sign(t.id, 'dept_head', '482916'), { ok: false, code: 'trip_closed' })
  await as('anon')
  assert.equal((await rpc('public.esign_verify($1)', [t.esign_verify_code])).trip_status, 'cancelled')
  const r = await (async () => { await as('requester'); const x = await makeTrip(); await db.query(`UPDATE public.fleet_trips SET status = 'rejected' WHERE id = $1`, [x.id]); return x })()
  await as('anon')
  assert.equal((await rpc('public.esign_verify($1)', [r.esign_verify_code])).trip_status, 'rejected')
})

// ── ภาพลายเซ็น (ชุด S1) ───────────────────────────────────────────────────────────────────────
// PNG จริงที่สร้างในเทสต์ (zlib + CRC) — ตัวตรวจฝั่ง DB ดูโครงสร้างจริง ไม่ใช่แค่นามสกุล
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}
const makePng = ({ w = 40, h = 16, seed = 1, noisy = false } = {}) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const rows = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4)
    for (let x = 0; x < w; x++) {
      const at = 1 + x * 4
      if (noisy) randomBytes(4).copy(row, at)
      else row.set([(x * 7 + seed * 31) & 255, (y * 13 + seed * 17) & 255, seed & 255, 255], at)
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: noisy ? 0 : 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
const b64 = buffer => buffer.toString('base64')
const png = n => b64(makePng({ seed: n }))
const addImage = (label, data, makeDefault = false) => rpc('public.esign_my_signature_add($1, $2, $3)', [label, data, makeDefault])
const myImages = async () => (await rpc('public.esign_my_signatures()')).items
let imageTrip = null // ทริปที่ใช้ทดสอบลงนามพร้อมภาพ (ส่งต่อให้เคสถัดไป)

await test('ภาพลายเซ็น: ตรวจโครงสร้างจริง — ไม่ใช่ PNG/ตัดท้าย/base64 เสีย/ใหญ่เกิน/กว้างเกิน ถูกปฏิเสธ · ไม่มีแถวเกิด', async () => {
  const good = makePng()
  await as('requester')
  const cases = {
    'ข้อความธรรมดา': b64(Buffer.from('hello')),
    'SVG ฝังสคริปต์': b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
    'JPEG (หัวไฟล์ JFIF)': b64(Buffer.concat([Buffer.from('ffd8ffe000104a46494600', 'hex'), Buffer.alloc(80)])),
    'PNG หัวไฟล์ผิดไบต์เดียว (ส่วนที่เหลือครบ)': b64(Buffer.concat([Buffer.from('88504e470d0a1a0a', 'hex'), good.subarray(8)])),
    'PNG ตัดท้าย (ไม่มี IEND)': b64(good.subarray(0, good.length - 12)),
    'PNG ต่อท้ายขยะหลัง IEND': b64(Buffer.concat([good, Buffer.from('trailing')])),
    'base64 มีช่องว่าง': b64(good).slice(0, 20) + ' ' + b64(good).slice(20),
    'base64 ยาวไม่ลงตัว 4': b64(good).slice(0, -1),
    'ข้อความว่าง': '',
  }
  for (const [name, data] of Object.entries(cases)) {
    const r = await addImage('ทดสอบ', data)
    assert.equal(r.ok, false, name)
    assert.equal(r.code, 'invalid_image', name)
  }
  assert.deepEqual(await addImage('ทดสอบ', null), { ok: false, code: 'invalid_image' })
  assert.deepEqual(await addImage('ทดสอบ', b64(makePng({ w: 200, h: 100, noisy: true }))), { ok: false, code: 'image_too_large' })
  assert.deepEqual(await addImage('ทดสอบ', 'A'.repeat(70000)), { ok: false, code: 'image_too_large' })
  assert.deepEqual(await addImage('ทดสอบ', b64(makePng({ w: 641, h: 10 }))), { ok: false, code: 'invalid_image_size' })
  assert.deepEqual(await addImage('ทดสอบ', b64(makePng({ w: 20, h: 321 }))), { ok: false, code: 'invalid_image_size' })
  assert.deepEqual(await addImage('ทดสอบ', b64(makePng({ w: 70000, h: 1 }))), { ok: false, code: 'invalid_image_size' })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signature_images')).rows[0].n, 0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_image_blobs')).rows[0].n, 0)
})

await test('ภาพลายเซ็น: คลังของฉัน — แบบแรกเป็นค่าเริ่มต้นเอง · เปลี่ยนค่าเริ่มต้น · ภาพซ้ำไม่เพิ่มแถว · เกิน 5 แบบไม่ได้ · base64 ไม่มีขึ้นบรรทัดใหม่', async () => {
  await as('requester')
  const first = await addImage('ลายเซ็นของฉัน', png(1))
  assert.equal(first.ok, true)
  assert.equal(first.is_default, true, 'แบบแรกต้องเป็นค่าเริ่มต้นเอง ผู้ใช้ไม่ต้องไปตั้ง')
  const second = await addImage('  แบบสั้น  ', png(2))
  assert.equal(second.is_default, false)
  assert.deepEqual(await addImage('ซ้ำ', png(2)), { ok: true, id: second.id, already: true })
  assert.equal((await myImages()).length, 2, 'ภาพเดียวกันต้องไม่เพิ่มแถว')
  assert.equal((await myImages()).find(i => i.id === second.id).label, 'แบบสั้น', 'ตัดช่องว่างหัวท้ายชื่อ')

  assert.deepEqual(await rpc('public.esign_my_signature_set_default($1)', [second.id]), { ok: true })
  const list = await myImages()
  assert.deepEqual(list.map(i => [i.id, i.is_default]), [[second.id, true], [first.id, false]], 'ค่าเริ่มต้นขึ้นก่อน และมีตัวเดียว')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signature_images WHERE user_id = $1 AND is_default', [users.requester.id])).rows[0].n, 1)

  // ภาพที่อ่านกลับมาต้องเป็นไบต์เดิมเป๊ะ และไม่มีขึ้นบรรทัดใหม่ (นำไปใช้เป็น data URL ตรงๆ ได้)
  for (const item of list) {
    assert.ok(!item.png_base64.includes('\n'))
    assert.deepEqual([item.width, item.height], [40, 16])
  }
  assert.equal(list[0].png_base64, png(2))

  // ชื่อว่าง = ใช้ชื่อมาตรฐาน · make_default กับภาพที่ซ้ำ = ย้ายค่าเริ่มต้นให้
  const third = await addImage('', png(3), true)
  assert.equal((await myImages()).find(i => i.id === third.id).label, 'ลายเซ็นของฉัน')
  assert.equal((await myImages()).find(i => i.is_default).id, third.id)
  assert.deepEqual(await addImage('ซ้ำ', png(1), true), { ok: true, id: first.id, already: true })
  assert.equal((await myImages()).find(i => i.is_default).id, first.id)

  await addImage('ที่ 4', png(4))
  await addImage('ที่ 5', png(5))
  assert.deepEqual(await addImage('ที่ 6', png(6)), { ok: false, code: 'too_many_images', max: 5 })
  assert.equal((await myImages()).length, 5)
})

await test('ภาพลายเซ็น: เห็นเฉพาะเจ้าของ · ตารางอ่าน/เขียนตรงไม่ได้ · anon/ประชาชนใช้ไม่ได้ · ลบ/ตั้งค่าเริ่มต้นของคนอื่นไม่ได้', async () => {
  const can = async (role, fn) => (await db.query(`SELECT has_function_privilege($1, $2, 'execute') AS ok`, [role, fn])).rows[0].ok
  for (const fn of ['public.esign_my_signatures()', 'public.esign_my_signature_add(text,text,boolean)', 'public.esign_my_signature_set_default(uuid)',
    'public.esign_my_signature_delete(uuid)', 'public.esign_my_signer_overview()', 'public.esign_my_signature_history(integer)',
    'public.esign_sign_fleet_trip_stamped(uuid,text,text,text,uuid,text)', 'public.esign_trip_stamps(uuid)']) {
    assert.equal(await can('anon', fn), false, `anon ต้องเรียก ${fn} ไม่ได้`)
    assert.equal(await can('authenticated', fn), true, `authenticated ต้องเรียก ${fn} ได้`)
  }
  for (const fn of ['public.esign_png_decode(text)', 'public.esign_is_staff_user()']) {
    assert.equal(await can('anon', fn), false, fn)
    assert.equal(await can('authenticated', fn), false, fn)
  }
  const tp = async (role, table, priv) => (await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, table, priv])).rows[0].ok
  for (const table of ['esign_image_blobs', 'esign_signature_images', 'esign_signature_stamps']) {
    for (const priv of ['select', 'insert', 'update', 'delete', 'truncate']) {
      assert.equal(await tp('authenticated', `public.${table}`, priv), false, `${table} ${priv}`)
      assert.equal(await tp('anon', `public.${table}`, priv), false, `${table} ${priv} (anon)`)
    }
  }
  const rls = await db.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('esign_image_blobs','esign_signature_images','esign_signature_stamps')`)
  assert.equal(rls.rows.length, 3)
  assert.ok(rls.rows.every(r => r.relrowsecurity), 'ทั้งสามตารางต้องเปิด RLS')

  await as('anon')
  assert.deepEqual(await rpc('public.esign_my_signatures()'), { ok: false, code: 'not_authenticated' })
  assert.deepEqual(await addImage('x', png(9)), { ok: false, code: 'not_authenticated' })
  await as('citizen')
  assert.deepEqual(await rpc('public.esign_my_signatures()'), { ok: false, code: 'forbidden' })
  assert.deepEqual(await addImage('x', png(9)), { ok: false, code: 'forbidden' })
  assert.deepEqual(await rpc('public.esign_my_signer_overview()'), { ok: false, code: 'forbidden' })

  await as('requester')
  const mine = (await myImages())[0]
  await as('head')
  assert.deepEqual(await myImages(), [], 'คนอื่นต้องไม่เห็นคลังของฉัน (แม้อยู่กองเดียวกัน)')
  assert.deepEqual(await rpc('public.esign_my_signature_delete($1)', [mine.id]), { ok: false, code: 'image_not_found' })
  assert.deepEqual(await rpc('public.esign_my_signature_set_default($1)', [mine.id]), { ok: false, code: 'image_not_found' })
  await as('adminA')
  assert.deepEqual(await myImages(), [], 'แอดมินก็ไม่เห็นคลังของคนอื่น')
  await as('requester')
  assert.equal((await myImages()).length, 5, 'ของฉันยังอยู่ครบ')
})

await test('ภาพลายเซ็น: ลบแบบที่เป็นค่าเริ่มต้นแล้วแบบล่าสุดขึ้นแทน · ภาพที่ไม่มีใครอ้างถูกลบจริง · จำกัดการยิงรัว (20 ครั้ง/5 นาที)', async () => {
  await as('requester')
  const before = await myImages()
  const def = before.find(i => i.is_default)
  const del = await rpc('public.esign_my_signature_delete($1)', [def.id])
  assert.deepEqual(del, { ok: true, kept_as_evidence: false })
  const after = await myImages()
  assert.equal(after.length, 4)
  assert.equal(after.filter(i => i.is_default).length, 1, 'ต้องมีค่าเริ่มต้นเหลือ 1 แบบเสมอเมื่อยังมีภาพ')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_image_blobs WHERE sha256 = $1', [
    (await db.query(`SELECT encode(sha256(decode($1, 'base64')), 'hex') AS h`, [def.png_base64])).rows[0].h])).rows[0].n, 0, 'ภาพที่ไม่มีใครอ้างต้องถูกลบจากฐาน')
  assert.deepEqual(await rpc('public.esign_my_signature_delete($1)', [def.id]), { ok: false, code: 'image_not_found' })
  for (const i of after) await rpc('public.esign_my_signature_delete($1)', [i.id])
  assert.deepEqual(await myImages(), [])
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_image_blobs')).rows[0].n, 0)

  await as('requester') // ล้างตัวนับ
  let limited = 0
  for (let i = 0; i < 25; i++) {
    try { await addImage('รัว', png(100 + (i % 3))) } catch (e) { assert.match(String(e.message), /ลองถี่เกินไป/); limited++ }
  }
  assert.ok(limited >= 5, `ต้องโดนจำกัดหลัง 20 ครั้ง (โดน ${limited})`)
  await as('requester')
  for (const i of await myImages()) await rpc('public.esign_my_signature_delete($1)', [i.id])
})

await test('ลงนามพร้อมภาพ: ภาพเสียไม่เผารหัส · ภาพคนอื่น/ส่งซ้อนสองแบบไม่ได้ · ลงนามแล้วเก็บสำเนาภาพ ณ วันนั้น · กดซ้ำไม่เพิ่ม', async () => {
  const signStamped = (id, slot, pin, imageId, data, decision = null) =>
    rpc('public.esign_sign_fleet_trip_stamped($1, $2, $3, $4, $5, $6)', [id, slot, pin, decision, imageId, data])
  const failedCount = async alias => (await db.query('SELECT failed_count FROM public.esign_signers WHERE user_id = $1', [users[alias].id])).rows[0]?.failed_count ?? 0

  await as('requester')
  const t = await makeTrip()
  imageTrip = t
  const mine = await addImage('ลายเซ็นของฉัน', png(11))
  await as('head')
  const theirs = await addImage('ของหัวหน้า', png(12))

  await as('requester')
  const failedBefore = await failedCount('requester')
  // ภาพเสีย + รหัสผิด → ตอบเรื่องภาพ ไม่แตะรหัส (ไม่เพิ่มตัวนับครั้งผิด)
  assert.deepEqual(await signStamped(t.id, 'requester', '000001', null, b64(Buffer.from('not a png'))), { ok: false, code: 'invalid_image' })
  assert.deepEqual(await signStamped(t.id, 'requester', '000001', null, b64(makePng({ w: 641, h: 5 }))), { ok: false, code: 'invalid_image_size' })
  assert.deepEqual(await signStamped(t.id, 'requester', '246810', mine.id, png(11)), { ok: false, code: 'invalid_image' }, 'ส่งสองแบบพร้อมกันกำกวม')
  assert.deepEqual(await signStamped(t.id, 'requester', '000001', theirs.id, null), { ok: false, code: 'image_not_found' }, 'ภาพของคนอื่นใช้ไม่ได้')
  assert.deepEqual(await signStamped(t.id, 'requester', '000001', '00000000-0000-4000-8000-0000000000ee', null), { ok: false, code: 'image_not_found' })
  assert.equal(await failedCount('requester'), failedBefore, 'ภาพเสียต้องไม่นับเป็นรหัสผิด')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signatures WHERE doc_id = $1', [t.id])).rows[0].n, 0)

  // รหัสผิด + ภาพดี → ผลของฟังก์ชันเดิมทุกประการ (ตัวนับรหัสผิดขึ้นและ commit)
  const wrong = await signStamped(t.id, 'requester', '000001', mine.id, null)
  assert.equal(wrong.ok, false)
  assert.equal(wrong.code, 'bad_pin')
  assert.equal(await failedCount('requester'), failedBefore + 1)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signature_stamps')).rows[0].n, 0)

  const ok = await signStamped(t.id, 'requester', '246810', mine.id, null)
  assert.equal(ok.ok, true)
  assert.equal(ok.stamped, true)
  assert.equal(ok.already, false)
  const stamps = (await db.query('SELECT * FROM public.esign_signature_stamps WHERE signature_id = $1', [ok.signature_id])).rows
  assert.equal(stamps.length, 1)
  assert.equal(stamps[0].municipality_id, A)
  assert.equal(stamps[0].sha256, (await db.query(`SELECT encode(sha256(decode($1, 'base64')), 'hex') AS h`, [png(11)])).rows[0].h)

  // กดซ้ำ = already ไม่เพิ่มสำเนา
  const again = await signStamped(t.id, 'requester', 'ไม่ต้องใช้', mine.id, null)
  assert.deepEqual({ ok: again.ok, already: again.already, stamped: again.stamped }, { ok: true, already: true, stamped: false })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signature_stamps')).rows[0].n, 1)

  // ผู้ลงนามช่องถัดไปวาดตอนลงนาม (ไม่บันทึกลงคลัง) และอีกคนลงโดยไม่แนบภาพ
  await as('head')
  const oneOff = await signStamped(t.id, 'dept_head', '482916', null, png(13))
  assert.equal(oneOff.ok, true)
  assert.equal(oneOff.stamped, true)
  assert.equal((await myImages()).length, 1, 'ภาพที่วาดตอนลงนามต้องไม่เข้าคลังเอง (ผู้ใช้ติ๊ก "บันทึกไว้" เองผ่าน add)')
  await as('mayor')
  const noImage = await signStamped(t.id, 'authority', '928374', null, null, 'approve')
  assert.equal(noImage.ok, true, JSON.stringify(noImage))
  assert.equal(noImage.stamped, false)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signature_stamps')).rows[0].n, 2)
  assert.equal(noImage.complete, true)
})

await test('ภาพบนใบพิมพ์ (esign_trip_stamps): ผู้เกี่ยวข้องเห็นเฉพาะลายเซ็นที่ยังไม่ถูกถอน · คนนอก/ประชาชน/อปท.อื่น/anon ไม่เห็น · ภาพ ณ วันลงนามไม่เปลี่ยนตามคลัง', async () => {
  await as('requester')
  const t = imageTrip
  assert.ok(t, 'ต้องรันเคสลงนามพร้อมภาพก่อน')
  const sigs = (await db.query('SELECT slot FROM public.esign_signatures WHERE doc_id = $1 ORDER BY signed_at', [t.id])).rows.map(r => r.slot)
  assert.deepEqual(sigs, ['requester', 'dept_head', 'authority'])
  const stampsOf = async alias => { await as(alias); return rpc('public.esign_trip_stamps($1)', [t.id]) }

  const seen = await stampsOf('requester')
  assert.equal(seen.ok, true)
  assert.deepEqual(seen.items.map(i => i.slot), ['requester', 'dept_head'], 'authority ลงโดยไม่แนบภาพ ต้องไม่มีรายการ')
  assert.equal(seen.items[0].png_base64, png(11))
  assert.equal(seen.items[1].png_base64, png(13))
  assert.ok(seen.items.every(i => !i.png_base64.includes('\n') && i.signature_id))
  for (const alias of ['head', 'mayor', 'fleetAdmin', 'adminA']) assert.equal((await stampsOf(alias)).ok, true, alias)
  for (const alias of ['outsider', 'citizen', 'adminB', 'staffB']) assert.deepEqual(await stampsOf(alias), { ok: false, code: 'not_found' }, alias)
  assert.deepEqual(await stampsOf('anon'), { ok: false, code: 'not_authenticated' })
  await as('requester')
  assert.deepEqual(await rpc('public.esign_trip_stamps($1)', ['00000000-0000-4000-8000-0000000000ff']), { ok: false, code: 'not_found' })

  // ผู้ขอลบภาพออกจากคลัง → ใบเดิมยังเห็นภาพเดิม (หลักฐาน) และแจ้งว่าเก็บไว้
  const lib = (await myImages()).find(i => i.png_base64 === png(11))
  assert.deepEqual(await rpc('public.esign_my_signature_delete($1)', [lib.id]), { ok: true, kept_as_evidence: true })
  assert.equal((await stampsOf('requester')).items.find(i => i.slot === 'requester').png_base64, png(11))
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_image_blobs WHERE sha256 = $1', [
    (await db.query(`SELECT encode(sha256(decode($1, 'base64')), 'hex') AS h`, [png(11)])).rows[0].h])).rows[0].n, 1, 'สำเนาที่ใบอ้างอยู่ต้องไม่ถูกลบ')

  // สำเนาภาพแก้/ลบไม่ได้ (ทั้งโดยตรงและผ่าน FK)
  await expectError(db.query(`UPDATE public.esign_signature_stamps SET sha256 = sha256 WHERE signature_id = (SELECT signature_id FROM public.esign_signature_stamps LIMIT 1)`), /ESIGN_APPEND_ONLY/)
  await expectError(db.query('DELETE FROM public.esign_signature_stamps'), /ESIGN_APPEND_ONLY/)
  await expectError(db.query('TRUNCATE public.esign_signature_stamps CASCADE'), /ESIGN_APPEND_ONLY/)
  await expectError(db.query('DELETE FROM public.esign_image_blobs'), /violates (RESTRICT setting of )?foreign key/)
  await expectError(db.query(`UPDATE public.esign_image_blobs SET width = 1`), /ESIGN_APPEND_ONLY/)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signature_stamps')).rows[0].n, 2)

  // ถอนลายเซ็นผู้ขอ (ถอนช่องท้ายสายตาม) → ภาพของใบที่ถูกถอนไม่ขึ้นบนใบพิมพ์
  assert.equal((await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'ขอแก้ไขข้อมูล', 'requester'])).ok, true)
  assert.deepEqual((await stampsOf('requester')).items, [])
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.esign_signature_stamps')).rows[0].n, 2, 'สำเนาเดิมยังอยู่เป็นหลักฐาน ถอนแค่ไม่แสดงบนใบ')

  // เซ็นใหม่ด้วยภาพใหม่ → ใบใหม่ใช้ภาพใหม่ ไม่ปนกับของเดิม
  await as('requester')
  const fresh = await addImage('แบบใหม่', png(21))
  const re = await rpc('public.esign_sign_fleet_trip_stamped($1, $2, $3, NULL, $4, NULL)', [t.id, 'requester', '246810', fresh.id])
  assert.equal(re.ok, true)
  assert.deepEqual((await stampsOf('requester')).items.map(i => [i.slot, i.png_base64]), [['requester', png(21)]])
})

await test('ศูนย์ลายมือชื่อของฉัน: ภาพรวม/ประวัติเป็นของตัวเองเท่านั้น · ประวัติไม่มีปลายทางหรือวัตถุประสงค์ · หน้าตรวจสอบสาธารณะไม่มีภาพ', async () => {
  await as('requester')
  const ov = await rpc('public.esign_my_signer_overview()')
  assert.equal(ov.ok, true)
  assert.equal(ov.pin_set, true)
  assert.equal(ov.duty_acked, true)
  assert.equal(ov.suspended, false)
  assert.equal(ov.failed_count, 0)
  assert.equal(ov.image_count, 1)
  assert.ok(ov.pin_set_at)
  const mineValid = (await db.query(`SELECT count(*)::int AS n FROM public.esign_signatures s WHERE s.signer_id = $1
                                     AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)`, [users.requester.id])).rows[0].n
  assert.equal(ov.signature_count, mineValid)
  assert.ok(ov.signature_count_month <= ov.signature_count)

  const hist = await rpc('public.esign_my_signature_history(50)')
  assert.equal(hist.ok, true)
  assert.ok(hist.items.length >= 2)
  assert.ok(hist.items.every(i => i.slot && i.slot_label && i.signed_at && typeof i.revoked === 'boolean' && typeof i.with_image === 'boolean'))
  assert.ok(hist.items.some(i => i.revoked === true), 'ใบที่ถูกถอนต้องขึ้นสถานะถอน')
  assert.ok(hist.items.some(i => i.with_image === true))
  const text = JSON.stringify(hist)
  for (const secret of ['สำนักงานจังหวัดแพร่', 'อบรมเชิงปฏิบัติการลับ', 'png_base64']) assert.ok(!text.includes(secret), `ประวัติต้องไม่มี ${secret}`)
  assert.equal((await rpc('public.esign_my_signature_history(1)')).items.length, 1)
  assert.equal((await rpc('public.esign_my_signature_history(NULL)')).ok, true)

  await as('outsider')
  assert.equal((await rpc('public.esign_my_signature_history(50)')).items.length, 0, 'คนที่ไม่เคยลงนามต้องไม่เห็นของคนอื่น')
  assert.equal((await rpc('public.esign_my_signer_overview()')).signature_count, 0)

  // หน้าตรวจสอบสาธารณะ (anon) ต้องไม่มีภาพและไม่เผยว่าใบไหนแนบภาพ
  await as('anon')
  const pub = JSON.stringify(await rpc('public.esign_verify($1)', [imageTrip.esign_verify_code]))
  assert.ok(!/png|base64|image|stamp/i.test(pub), 'หน้าสาธารณะต้องไม่มีภาพ')
  const stampRows = (await db.query('SELECT count(*)::int AS n FROM public.esign_signature_stamps')).rows[0].n
  assert.ok(stampRows >= 2)
})

// ── ชุด S3a: ข้อมูลของแผงลงนามในหน้าทริป (..20261023110000_esign_trip_panel_functions.sql) ──────────────────
await test('esign_trip_status (S3a): mine / can_revoke / locked / can_revoke_all / with_image ตรงกับกติกาถอนของ esign_revoke_fleet_trip', async () => {
  const signStamped = (id, slot, pin, imageId) => rpc('public.esign_sign_fleet_trip_stamped($1, $2, $3, NULL, $4, NULL)', [id, slot, pin, imageId])
  await as('requester')
  const t = await makeTrip()
  let st = await status(t.id)
  assert.equal(st.locked, false)
  assert.equal(st.can_revoke_all, false, 'ยังไม่มีลายเซ็นให้ถอน')
  assert.ok(st.slots.every(s => s.can_revoke === false && s.signature === null))

  const image = (await myImages())[0]
  assert.ok(image, 'ผู้ขอต้องมีภาพในคลังจากเคสก่อนหน้า')
  assert.equal((await signStamped(t.id, 'requester', '246810', image.id)).ok, true)
  st = await status(t.id)
  assert.equal(st.locked, true)
  assert.equal(st.can_revoke_all, true)
  assert.deepEqual([slotOf(st, 'requester').can_revoke, slotOf(st, 'requester').signature.mine, slotOf(st, 'requester').signature.with_image], [true, true, true])
  assert.equal(slotOf(st, 'dept_head').can_revoke, false, 'ช่องที่ยังไม่มีลายเซ็นถอนไม่ได้')
  // ส่งได้เฉพาะ "มีภาพไหม" ไม่ส่งตัวภาพ/รหัส hash ของภาพออกไปกับสถานะ
  assert.ok(!/png|base64|sha256/i.test(JSON.stringify(st)), 'สถานะต้องไม่มีตัวภาพ')

  await as('head')
  st = await status(t.id)
  assert.equal(st.locked, true, 'คนอื่นก็เห็นว่าทริปล็อกอยู่')
  assert.deepEqual([slotOf(st, 'requester').can_revoke, slotOf(st, 'requester').signature.mine], [false, false], 'หัวหน้ากองถอนช่องของผู้ขอไม่ได้')
  assert.equal(st.can_revoke_all, false)
  assert.equal((await sign(t.id, 'dept_head', '482916')).ok, true)
  st = await status(t.id)
  assert.deepEqual([slotOf(st, 'dept_head').can_revoke, slotOf(st, 'dept_head').signature.mine, slotOf(st, 'dept_head').signature.with_image], [true, true, false])
  assert.equal(slotOf(st, 'requester').can_revoke, false)

  // นายกในเทสต์นี้มี role admin = fleet_is_manager ของ อปท. จึงถอนได้ทุกช่องตามกติกาเดิมของ esign_revoke_fleet_trip (ไม่ใช่เพราะเป็นผู้มีอำนาจลงนาม)
  await as('mayor')
  st = await status(t.id)
  assert.equal(slotOf(st, 'authority').can_sign, true)
  assert.deepEqual(st.slots.filter(s => s.signed).map(s => s.can_revoke), [true, true])

  // ผู้ดูแลรถ และแอดมิน (fleet_is_manager) ถอนได้ทุกช่อง
  for (const alias of ['fleetAdmin', 'adminA', 'mayor']) {
    await as(alias)
    st = await status(t.id)
    assert.deepEqual(st.slots.filter(s => s.signed).map(s => s.can_revoke), [true, true], alias)
    assert.equal(st.can_revoke_all, true, alias)
  }
  await as('outsider')
  assert.deepEqual(await status(t.id), { found: false })

  // สิ่งที่แผงโชว์ต้องตรงกับสิ่งที่ฟังก์ชันถอนยอมจริง: can_revoke = false ⇒ ฟังก์ชันถอนตอบ forbidden
  await as('head')
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'ทดสอบ', 'requester']), { ok: false, code: 'forbidden' })
  await as('outsider')
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'ทดสอบ', 'dept_head']), { ok: false, code: 'forbidden' })
  // can_revoke = true ⇒ ถอนได้จริง และสถานะหลังถอนอัปเดตตาม (ถอน dept_head ไม่แตะ requester)
  await as('head')
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, $3)', [t.id, 'ทดสอบถอนของตัวเอง', 'dept_head']), { ok: true, revoked: 1 })
  st = await status(t.id)
  assert.deepEqual(st.slots.map(s => s.signed), [true, false, false, false])
  assert.equal(st.locked, true, 'ผู้ขอยังมีลายเซ็นอยู่')
  await as('requester')
  assert.deepEqual(await rpc('public.esign_revoke_fleet_trip($1, $2, NULL)', [t.id, 'แก้คำขอ']), { ok: true, revoked: 1 })
  st = await status(t.id)
  assert.deepEqual([st.locked, st.can_revoke_all, st.signed_count], [false, false, 0], 'ถอนหมดแล้วทริปแก้เนื้อหาได้อีก')
})

await test('esign_my_pending (S3a): ใบที่ถึงคิวฉันเท่านั้น · ตามลำดับสาย · ไม่รวมใบที่ปิด/เซ็นสด/อปท.อื่น · ไม่เผยข้อมูลเกินที่ผู้ลงนามต้องเห็น', async () => {
  const pending = async alias => { await as(alias); return rpc('public.esign_my_pending()') }
  const mine = async (alias, id) => (await pending(alias)).items.filter(i => i.trip_id === id)
  await db.query(`INSERT INTO public.fleet_vehicles (id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', 'รถตู้ทดสอบ')`)

  await as('requester')
  const t = await makeTrip()
  await db.query(`UPDATE public.fleet_trips SET vehicle_id = '00000000-0000-4000-8000-0000000000c1' WHERE id = $1`, [t.id])
  // ตาแรก: เฉพาะผู้ขอ · หัวหน้ากอง/ผู้มีอำนาจยังไม่ถึงตา
  const first = await mine('requester', t.id)
  assert.equal(first.length, 1)
  assert.deepEqual(
    { slot: first[0].slot, slot_label: first[0].slot_label, decision: first[0].decision, trip_status: first[0].trip_status, requester_name: first[0].requester_name,
      vehicle_name: first[0].vehicle_name, destination: first[0].destination, purpose: first[0].purpose },
    { slot: 'requester', slot_label: 'ผู้ขออนุญาต', decision: 'sign', trip_status: 'pending', requester_name: 'สมหญิง ผู้ขอ',
      vehicle_name: 'รถตู้ทดสอบ', destination: 'สำนักงานจังหวัดแพร่ ห้องประชุม 2', purpose: 'อบรมเชิงปฏิบัติการลับ-วัตถุประสงค์' })
  assert.ok(first[0].planned_departure, 'ต้องมีวันเดินทาง')
  assert.deepEqual(Object.keys(first[0]).sort(), ['decision', 'destination', 'planned_departure', 'purpose', 'requester_name', 'slot', 'slot_label', 'trip_id', 'trip_status', 'vehicle_name'])
  assert.equal((await mine('head', t.id)).length, 0)
  assert.equal((await mine('mayor', t.id)).length, 0)

  await as('requester') // mine() สลับผู้ใช้ไปมา — ตั้งผู้ลงนามให้ชัดก่อนลงนามทุกครั้ง
  assert.equal((await sign(t.id, 'requester', '246810')).ok, true)
  assert.equal((await mine('requester', t.id)).length, 0, 'ลงแล้วต้องหายจากกล่อง')
  assert.deepEqual((await mine('head', t.id)).map(i => [i.slot, i.decision]), [['dept_head', 'sign']])
  assert.equal((await mine('mayor', t.id)).length, 0, 'ผู้มีอำนาจรอหัวหน้ากองลงก่อน')
  await as('head')
  assert.equal((await sign(t.id, 'dept_head', '482916')).ok, true)
  assert.deepEqual((await mine('mayor', t.id)).map(i => [i.slot, i.slot_label, i.decision]), [['authority', 'ผู้มีอำนาจสั่งใช้ยานพาหนะ', 'approve']])
  assert.equal((await mine('head', t.id)).length, 0)
  await as('mayor')
  assert.equal((await sign(t.id, 'authority', '928374', 'approve')).ok, true)
  for (const alias of ['requester', 'head', 'mayor']) assert.equal((await mine(alias, t.id)).length, 0, `${alias} ลงครบแล้วต้องไม่ค้าง`)

  // ถอนแล้วกลับมาถึงคิวอีกครั้ง
  await as('requester')
  await rpc('public.esign_revoke_fleet_trip($1, $2, NULL)', [t.id, 'แก้คำขอ'])
  assert.equal((await mine('requester', t.id)).length, 1)
  assert.equal((await mine('head', t.id)).length, 0, 'ต้นสายถูกถอน ต้องรอผู้ขอลงใหม่ก่อน')

  // ใบของ อปท. อื่นต้องไม่แย่งโควตา 100 ใบของเรา: กรองตาม อปท. ก่อน LIMIT (ไม่ใช่หลัง) — ไม่งั้นใบของเราหลุดจากกล่องเมื่อ อปท. อื่นมีใบค้างเยอะ
  await db.query('ALTER TABLE public.fleet_trips DISABLE TRIGGER trg_fleet_trips_esign_guard')
  await db.query(`INSERT INTO public.fleet_trips (municipality_id, status, requested_by, created_by, planned_departure, esign_slots, esign_verify_code, destination)
                  SELECT $1, 'approved', $2, $2, '2026-01-01'::timestamptz + (g || ' minutes')::interval, '{"requester":"online"}'::jsonb, md5('crowd' || g), 'CROWD-' || g
                  FROM generate_series(1, 105) g`, [B, users.staffB.id])
  await db.query('ALTER TABLE public.fleet_trips ENABLE TRIGGER trg_fleet_trips_esign_guard')
  assert.equal((await mine('requester', t.id)).length, 1, 'ใบของ อปท. อื่น 105 ใบต้องไม่ดันใบของเราออกจากกล่อง')
  assert.equal((await pending('staffB')).items.length, 100, 'กล่องคืนไม่เกิน 100 ใบ')
  assert.ok((await pending('staffB')).items.every(i => i.destination.startsWith('CROWD-')), 'อปท. B เห็นเฉพาะใบของตัวเอง')
  await db.query('ALTER TABLE public.fleet_trips DISABLE TRIGGER trg_fleet_trips_esign_guard')
  await db.query("DELETE FROM public.fleet_trips WHERE destination LIKE 'CROWD-%'")
  await db.query('ALTER TABLE public.fleet_trips ENABLE TRIGGER trg_fleet_trips_esign_guard')

  // ใบที่ปิดแล้ว (ปฏิเสธ/ยกเลิก/เสร็จสิ้น) ไม่เข้ากล่อง · เซ็นสด/ทริปเก่าไม่เข้า
  for (const closed of ['rejected', 'cancelled', 'completed']) {
    await as('requester')
    const c = await makeTrip()
    assert.equal((await mine('requester', c.id)).length, 1, closed)
    await db.query('UPDATE public.fleet_trips SET status = $1 WHERE id = $2', [closed, c.id])
    assert.equal((await mine('requester', c.id)).length, 0, `${closed} ต้องไม่เข้ากล่อง`)
  }
  const all = (await pending('requester')).items
  const wetIds = (await db.query('SELECT id FROM public.fleet_trips WHERE esign_slots IS NULL')).rows.map(r => r.id)
  assert.ok(all.every(i => !wetIds.includes(i.trip_id)), 'ทริปเซ็นสดต้องไม่เข้ากล่อง')

  // คนอื่นไม่เห็นใบที่ไม่ใช่ตา: ผู้ดูแลรถ/แอดมินอ่านทริปได้แต่ไม่ใช่ผู้ลงนาม · คนนอกกอง/ประชาชน/อปท.อื่น/superadmin ไม่เห็นเลย
  for (const alias of ['fleetAdmin', 'adminA']) assert.equal((await mine(alias, t.id)).length, 0, alias)
  for (const alias of ['outsider', 'citizen', 'staffB', 'adminB', 'superadmin']) {
    const res = await pending(alias)
    assert.equal(res.ok, true, alias)
    assert.deepEqual(res.items, [], `${alias} ต้องไม่เห็นใบของ อปท. นี้`)
    assert.equal(res.count, 0, alias)
  }
  await as('anon')
  assert.deepEqual(await rpc('public.esign_my_pending()'), { ok: false, code: 'not_authenticated' })
  const can = async role => (await db.query(`SELECT has_function_privilege($1, 'public.esign_my_pending()', 'execute') AS ok`, [role])).rows[0].ok
  assert.equal(await can('anon'), false)
  assert.equal(await can('authenticated'), true)
})

await test('ภาพลายเซ็น: audit มีบรรทัดเพิ่ม/ลบ แต่ไม่มีตัวภาพ', async () => {
  const { rows } = await db.query(`SELECT action, metadata::text AS m, resource_label AS l FROM public.audit_logs WHERE action LIKE 'esign_image_%'`)
  const actions = new Set(rows.map(r => r.action))
  assert.ok(actions.has('esign_image_add') && actions.has('esign_image_delete'))
  const all = rows.map(r => r.m + (r.l ?? '')).join('\n')
  for (const sample of [png(11), png(13), png(21), 'iVBOR']) assert.ok(!all.includes(sample), 'audit ต้องไม่มีตัวภาพ')
  assert.ok(rows.filter(r => r.action === 'esign_image_delete').some(r => r.m.includes('"kept_as_evidence": true')), 'audit ต้องบอกว่าภาพที่ลบถูกเก็บเป็นหลักฐาน')
})

await test('หลักฐานตรวจย้อนได้: ทุกการลงนาม/ถอน/ตั้งค่า มีบรรทัดใน audit_logs · ไม่มีรหัสลงนามหรือเนื้อหาคำขอใน audit', async () => {
  const { rows } = await db.query(`SELECT action, metadata::text AS m FROM public.audit_logs WHERE action LIKE 'esign_%'`)
  const actions = new Set(rows.map(r => r.action))
  for (const a of ['esign_sign', 'esign_revoke', 'esign_set_pin', 'esign_suspend', 'esign_reinstate', 'esign_set_policy', 'esign_enable', 'esign_disable', 'esign_confirm_trial', 'esign_trip_deleted']) {
    assert.ok(actions.has(a), `audit ต้องมี ${a}`)
  }
  const all = rows.map(r => r.m).join('\n')
  for (const secret of ['246810', '482916', '369258', 'สำนักงานจังหวัดแพร่', 'อบรมเชิงปฏิบัติการลับ']) assert.ok(!all.includes(secret), `audit ต้องไม่มี ${secret}`)
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
await db.close()
