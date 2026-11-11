// ห้องผู้บริหาร E3-2 — เรื่องเลยกำหนด / ติดตาม / เร่งรัด · รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   ไฟล์ที่รัน: E2 20261115100000 + 20261115100100 (exec_assert_viewer, exec_complaint_dept) แล้ว E3-2 20261117100000/100100
//   ในเครื่อง: node tests/exec-follow-nudge-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   CI: อ่าน path จาก env PATIENT_PGLITE_MODULE (PGlite 0.5.8 ติดตั้งนอก repo) ไม่ต้องส่ง --pglite
// ตารางจำลองมีเฉพาะคอลัมน์ที่ฟังก์ชันอ่าน + คอลัมน์ข้อมูลส่วนบุคคลปลอม เพื่อตรวจว่า "ไม่หลุดออกมา"
// ตรวจคู่กับ Edge Function: เงื่อนไขจองแถว (pending→sending เฉพาะผู้กดล่าสุด) จำลองด้วย SQL เดียวกับที่ PostgREST สร้าง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const files = [
  '20261115100000_exec_access_overview.sql',
  '20261115100100_exec_summary_service.sql',
  '20261117100000_exec_follow_nudge_tables.sql',
  '20261117100100_exec_follow_nudge_functions.sql',
]
const migration = (f) => readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1), MB = id(2), MDEMO = id(3)
const U = {
  viewerA: id(101), paladA: id(102), headA: id(103), adminA: id(104), viewerB: id(105), superadmin: id(106),
  citizenA: id(107), headPaladA: id(108), officerNoPos: id(109),
}
const P_TOP = id(201), P_HEAD = id(202)
const D1 = id(301), D2 = id(302)
const PII = { name: 'สมชาย ทดสอบปลอม', phone: '0812345678' }
const C = n => id(1000 + n)
const R = n => id(2000 + n)

const db = new PGlite()
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text);
CREATE TABLE public.positions (id uuid PRIMARY KEY, category text, name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, municipality_id uuid, position_id uuid, department_id uuid,
  is_dept_head boolean NOT NULL DEFAULT false, full_name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text, short_name text, code text, sort_order int, is_active boolean);
CREATE TABLE public.locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, name text);
CREATE TABLE public.complaint_categories (municipality_id uuid, value text, label text, is_adhoc boolean NOT NULL DEFAULT false,
  requires_manual_intake boolean NOT NULL DEFAULT false);
CREATE TABLE public.complaints (id uuid PRIMARY KEY, municipality_id uuid, ref_no text, status text, created_at timestamptz, closed_at timestamptz,
  due_date date, assigned_to uuid, resolved_by uuid, department_id uuid, channel text DEFAULT 'citizen_online', village text,
  category text, parked_reason text, rating smallint, user_id uuid, reporter_name text, phone text, department text);
CREATE TABLE public.complaint_timeline (complaint_id uuid, status text, created_at timestamptz);
CREATE TABLE public.document_requests (id uuid PRIMARY KEY, municipality_id uuid, document_type text,
  status text, created_at timestamptz, issued_at timestamptz, due_date date, department_id uuid, created_by_uid uuid, requester_name text);
CREATE TABLE public.satisfaction_ratings (municipality_id uuid, complaint_id uuid, rating smallint, is_verified boolean DEFAULT false,
  via_link boolean DEFAULT false, rated_by_proxy boolean DEFAULT false, created_at timestamptz, comment text);
CREATE TABLE public.patient_booking_trips (id uuid PRIMARY KEY, municipality_id uuid, state text, booking_ids uuid[] NOT NULL);
CREATE TABLE public.patient_bookings (id uuid PRIMARY KEY, municipality_id uuid, service_type text, status text, appointment_at timestamptz, trip_id uuid, patient_name text);

CREATE FUNCTION public.t0() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;
CREATE FUNCTION public.ts(d int) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT ((public.t0() - d)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Bangkok' $$;
CREATE FUNCTION public.dt(d int) RETURNS date LANGUAGE sql STABLE AS $$ SELECT public.t0() - d $$;
`)

for (const f of files) {
  try {
    await db.exec(await migration(f))
  } catch (e) {
    throw new Error(`apply ${f} ไม่ผ่าน: ${e.message}`)
  }
}
// จำลองค่าตั้งต้นของ Supabase: service_role ข้าม RLS และได้สิทธิ์ตารางใหม่ใน public ผ่าน default privileges
// (migration ถอนเฉพาะ PUBLIC/anon/authenticated — Edge Function ต้องเขียน exec_nudges ได้)
await db.exec(`
ALTER ROLE service_role BYPASSRLS;
GRANT SELECT, UPDATE ON public.exec_nudges TO service_role;
`)

await db.exec(`
INSERT INTO public.municipalities VALUES ('${MA}', 'namlao'), ('${MB}', 'other'), ('${MDEMO}', 'demo');
INSERT INTO auth.users SELECT unnest(ARRAY['${Object.values(U).join("','")}']::uuid[]);
INSERT INTO public.positions VALUES ('${P_TOP}', 'top_admin', 'ปลัดเทศบาล'), ('${P_HEAD}', 'dept_head', 'ผู้อำนวยการกองช่าง');
INSERT INTO public.profiles (id, role, municipality_id, position_id, department_id, is_dept_head, full_name) VALUES
  ('${U.viewerA}', 'viewer', '${MA}', NULL, NULL, false, 'นายกปลอม'),
  ('${U.paladA}', 'officer', '${MA}', '${P_TOP}', NULL, false, 'ปลัดปลอม'),
  ('${U.headA}', 'officer', '${MA}', '${P_HEAD}', '${D1}', true, 'ผอ.กองช่างปลอม'),
  ('${U.adminA}', 'admin', '${MA}', NULL, NULL, false, 'แอดมินไอที'),
  ('${U.viewerB}', 'viewer', '${MB}', NULL, NULL, false, 'นายก B'),
  ('${U.superadmin}', 'superadmin', NULL, NULL, NULL, false, 'เจ้าของระบบ'),
  ('${U.citizenA}', 'citizen', '${MA}', NULL, NULL, false, '${PII.name}'),
  -- ปลัดที่ถูกตั้งเป็นหัวหน้าสำนักปลัดด้วย (requester_is_head)
  ('${U.headPaladA}', 'officer', '${MA}', '${P_TOP}', '${D2}', true, 'ปลัดคุมสำนักปลัด'),
  ('${U.officerNoPos}', 'officer', '${MA}', NULL, '${D1}', false, 'เจ้าหน้าที่ไม่มีตำแหน่ง');
INSERT INTO public.departments VALUES
  ('${D1}', '${MA}', 'กองช่าง', 'ช่าง', 'engineering', 1, true), ('${D2}', '${MA}', 'สำนักปลัด', 'ปลัด', 'palad', 2, true);
INSERT INTO public.complaint_categories (municipality_id, value, label, is_adhoc, requires_manual_intake) VALUES
  ('${MA}', 'road', 'ถนนชำรุด', false, false), ('${MA}', 'odor', 'กลิ่นเหม็น', true, false),
  ('${MA}', 'corrupt', 'ร้องเรียนเจ้าหน้าที่', false, true);
INSERT INTO public.complaints (id, municipality_id, ref_no, status, created_at, due_date, department_id, category, reporter_name, phone, user_id) VALUES
  ('${C(1)}', '${MA}', 'CR-0001', 'in_progress', ts(10), dt(3), '${D1}', 'road', '${PII.name}', '${PII.phone}', '${U.citizenA}'),   -- เลยกำหนด ✔
  ('${C(2)}', '${MA}', 'CR-0002', 'received',    ts(5),  dt(-2), '${D1}', 'road', '${PII.name}', '${PII.phone}', '${U.citizenA}'),  -- ยังไม่ถึงกำหนด
  ('${C(3)}', '${MA}', 'CR-0003', 'pending',     ts(20), dt(9), '${D1}', 'odor', '${PII.name}', '${PII.phone}', '${U.citizenA}'),   -- หมวดเฉพาะกิจ ไม่นับ
  ('${C(4)}', '${MA}', 'CR-0004', 'received',    ts(15), dt(4), '${D2}', 'corrupt', '${PII.name}', '${PII.phone}', '${U.citizenA}'), -- อ่อนไหว = ยอดรวม
  ('${C(5)}', '${MA}', 'CR-0005', 'closed',      ts(15), dt(4), '${D1}', 'road', '${PII.name}', '${PII.phone}', '${U.citizenA}'),   -- ปิดแล้ว
  ('${C(6)}', '${MA}', 'CR-0006', 'parked',      ts(30), dt(10), '${D1}', 'road', '${PII.name}', '${PII.phone}', '${U.citizenA}'),  -- parked ไม่อยู่ในรายการ
  ('${C(7)}', '${MA}', 'CR-0007', 'new',         ts(6),  dt(1), '${D2}', 'road', '${PII.name}', '${PII.phone}', '${U.citizenA}'),   -- เลยกำหนด สำนักปลัด
  ('${C(8)}', '${MB}', 'CR-B001', 'received',    ts(6),  dt(2), NULL,    'road', '${PII.name}', '${PII.phone}', '${U.citizenA}');   -- อปท. อื่น
INSERT INTO public.document_requests (id, municipality_id, document_type, status, created_at, due_date, department_id, requester_name) VALUES
  ('${R(1)}', '${MA}', 'water_supply_request', 'processing', ts(12), dt(2), '${D1}', '${PII.name}'),   -- เลยกำหนด ✔ (เลขที่ = 8 ตัวแรกของ id)
  ('${R(2)}', '${MA}', 'tax_notice', 'completed', ts(12), dt(2), '${D1}', '${PII.name}');
`)

async function as(alias) {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias === 'anon' || alias === 'service_role' ? '' : U[alias]])
  await db.exec(`SET ROLE ${alias === 'anon' ? 'anon' : alias === 'service_role' ? 'service_role' : 'authenticated'}`)
}
async function call(alias, sql, params = []) {
  await as(alias)
  try {
    const { rows } = await db.query(sql, params)
    return rows[0]?.r
  } finally {
    await db.exec('RESET ROLE')
  }
}
async function rejects(fn, code, label) {
  await assert.rejects(fn, (e) => {
    assert.equal(e.code, code, `${label}: ได้ ${e.code} ${e.message}`)
    return true
  })
}
const overdue = (alias, m = MA) => call(alias, 'SELECT public.exec_overdue_items($1) AS r', [m])
const follow = (alias, kind, item, m = MA) => call(alias, 'SELECT public.exec_follow($1, $2, $3) AS r', [m, kind, item])
const unfollow = (alias, kind, item, m = MA) => call(alias, 'SELECT public.exec_unfollow($1, $2, $3) AS r', [m, kind, item])
const myFollows = (alias, m = MA) => call(alias, 'SELECT public.exec_my_follows($1) AS r', [m])
const nudge = (alias, kind, item, m = MA) => call(alias, 'SELECT public.exec_nudge($1, $2, $3) AS r', [m, kind, item])
const payload = nid => call('service_role', 'SELECT public.exec_nudge_payload($1) AS r', [nid])
// จำลองตัวกรองจองแถวของ exec-nudge-notify (.eq delivery pending + .or ผู้กดล่าสุด) ในนาม service_role
const claim = async (nid, uid) => {
  await as('service_role')
  try {
    const { rows } = await db.query(
      `UPDATE public.exec_nudges SET delivery = 'sending'
        WHERE id = $1 AND delivery = 'pending' AND (last_retry_by = $2 OR (last_retry_by IS NULL AND nudged_by = $2))
        RETURNING id`, [nid, uid])
    return rows.length
  } finally {
    await db.exec('RESET ROLE')
  }
}
const setDelivery = async (nid, delivery) => {
  await db.exec('RESET ROLE')
  await db.query('UPDATE public.exec_nudges SET delivery = $2 WHERE id = $1', [nid, delivery])
}

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`) }

await test('apply ผ่านด่านท้ายไฟล์ · anon เรียกอะไรไม่ได้ · authenticated เรียก payload/snapshot/actor ไม่ได้', async () => {
  await rejects(() => overdue('anon'), '42501', 'anon overdue')
  await rejects(() => call('viewerA', 'SELECT public.exec_nudge_payload($1) AS r', [id(9)]), '42501', 'viewer payload')
  await rejects(() => call('viewerA', 'SELECT public.exec_assert_actor($1) AS r', [MA]), '42501', 'viewer assert_actor')
  await rejects(() => call('viewerA', 'SELECT * FROM public.exec_item_snapshot($1, $2, $3)', [MA, 'complaint', C(1)]), '42501', 'snapshot')
  await rejects(() => call('viewerA', 'SELECT count(*) AS r FROM public.exec_nudges'), '42501', 'อ่านตารางตรง')
})

await test('รายการเลยกำหนด: คำร้อง+คำขอที่เลยกำหนด เก่าสุดก่อน · ไม่รวมเฉพาะกิจ/ยังไม่ถึง/ปิด/parked/อปท.อื่น · อ่อนไหว = ยอดรวมรายกอง', async () => {
  const r = await overdue('viewerA')
  assert.deepEqual(r.items.map(i => i.ref), ['CR-0001', R(1).slice(0, 8).toUpperCase(), 'CR-0007'])
  assert.equal(r.total, 3)
  assert.equal(r.truncated, false)
  assert.deepEqual(r.sensitive, [{ dept_id: D2, dept: 'ปลัด', n: 1 }])
  const doc = r.items.find(i => i.k === 'document_request')
  assert.equal(doc.cat, 'water_supply_request')
  assert.equal(r.items[0].dept, 'ช่าง')
  assert.equal(r.items[0].followed, false)
  assert.equal(r.items[0].nudge, null)
})

await test('PDPA: ไม่มีชื่อ/เบอร์ผู้ร้อง และไม่มีเลขที่หรือ id ของเรื่องอ่อนไหวในผลลัพธ์', async () => {
  const s = JSON.stringify(await overdue('viewerA'))
  assert.doesNotMatch(s, new RegExp(`${PII.name}|${PII.phone}|CR-0004|${C(4)}`))
})

await test('สิทธิ์ดู: ปลัด/admin ดูได้ · นายก อปท. อื่น/ประชาชน/เจ้าหน้าที่ไม่มีตำแหน่ง = 42501', async () => {
  assert.equal((await overdue('paladA')).total, 3)
  assert.equal((await overdue('adminA')).total, 3)
  await rejects(() => overdue('viewerB'), '42501', 'นายก อปท. อื่น')
  await rejects(() => overdue('citizenA'), '42501', 'ประชาชน')
  await rejects(() => overdue('officerNoPos'), '42501', 'ไม่มีตำแหน่ง')
})

await test('ติดตาม: กดซ้ำ = already · ขึ้น followed ในรายการ · เลิกแล้วกดใหม่ได้ · เรื่องอ่อนไหว/ปิดแล้ว/อปท.อื่น ไม่ได้', async () => {
  const a = await follow('viewerA', 'complaint', C(1))
  assert.equal(a.already, false)
  assert.equal((await follow('viewerA', 'complaint', C(1))).already, true)
  assert.equal((await overdue('viewerA')).items.find(i => i.id === C(1)).followed, true)
  assert.equal((await overdue('paladA')).items.find(i => i.id === C(1)).followed, false, 'ติดตามเป็นของรายคน')
  // parked ติดตามได้ (เร่งไม่ได้)
  assert.equal((await follow('viewerA', 'complaint', C(6))).already, false)
  const mine = await myFollows('viewerA')
  assert.deepEqual(mine.follows.map(f => f.ref).sort(), ['CR-0001', 'CR-0006'])
  assert.equal((await unfollow('viewerA', 'complaint', C(6))).ended, true)
  assert.equal((await unfollow('viewerA', 'complaint', C(6))).ended, false)
  await rejects(() => follow('viewerA', 'complaint', C(4)), '22023', 'อ่อนไหว')
  await rejects(() => follow('viewerA', 'complaint', C(5)), '22023', 'ปิดแล้ว')
  await rejects(() => follow('viewerA', 'complaint', C(8)), 'P0002', 'อปท. อื่น (ไม่บอกว่ามีอยู่)')
  await rejects(() => follow('viewerA', 'nonsense', C(1)), '22023', 'ประเภทผิด')
})

let nid1
await test('เร่งรัด: นายกเร่งได้ · วันเดียวกันคนอื่นเร่งซ้ำ = already_today พร้อมตำแหน่งผู้เร่ง (ไม่ใช่ชื่อ)', async () => {
  const r = await nudge('viewerA', 'complaint', C(1))
  assert.equal(r.ok, true)
  assert.equal(r.retry, false)
  nid1 = r.nudge_id
  const again = await nudge('paladA', 'complaint', C(1))
  assert.equal(again.ok, false)
  assert.equal(again.reason, 'already_today')
  assert.equal(again.nudge.by, 'ผู้บริหาร')  // viewer ไม่มีตำแหน่ง → ป้ายสำรอง
  assert.equal(again.nudge.delivery, 'pending')
  const item = (await overdue('viewerA')).items.find(i => i.id === C(1))
  assert.equal(item.nudged_today, true)
  assert.equal(item.nudge.delivery, 'pending')
})

await test('เร่งรัดไม่ได้: admin ไอที / อปท. อื่น / superadmin นอกสนามซ้อม = 42501 · ยังไม่ถึงกำหนด/อ่อนไหว/parked/ปิด/เฉพาะกิจ = 22023', async () => {
  await rejects(() => nudge('adminA', 'complaint', C(7)), '42501', 'admin')
  await rejects(() => nudge('viewerB', 'complaint', C(7)), '42501', 'นายก อปท. อื่น')
  await rejects(() => nudge('superadmin', 'complaint', C(7)), '42501', 'superadmin ใน อปท. จริง')
  await rejects(() => nudge('viewerA', 'complaint', C(2)), '22023', 'ยังไม่ถึงกำหนด')
  await rejects(() => nudge('viewerA', 'complaint', C(4)), '22023', 'อ่อนไหว')
  await rejects(() => nudge('viewerA', 'complaint', C(6)), '22023', 'parked')
  await rejects(() => nudge('viewerA', 'complaint', C(5)), '22023', 'ปิดแล้ว')
  await rejects(() => nudge('viewerA', 'complaint', C(3)), '22023', 'เฉพาะกิจ')
})

await test('payload (service_role): sendable · เลขที่/หมวด/กอง · heads = ผอ.กองที่ถือเรื่อง · ไม่มีชื่อ/เบอร์ผู้ร้อง', async () => {
  const p = await payload(nid1)
  assert.equal(p.sendable, true)
  assert.equal(p.item.ref, 'CR-0001')
  assert.equal(p.item.cat_label, 'ถนนชำรุด')
  assert.equal(p.department.id, D1)
  assert.deepEqual(p.heads, [U.headA])
  assert.equal(p.requester_is_head, false)
  assert.equal(p.nudge.requested_by, U.viewerA)
  assert.doesNotMatch(JSON.stringify(p), new RegExp(`${PII.name}|${PII.phone}`))
})

await test('จองแถวแบบ Edge Function: คนอื่นจองไม่ได้ · ผู้กดจองได้ครั้งเดียว (ดับเบิลคลิก = 0 แถว)', async () => {
  assert.equal(await claim(nid1, U.paladA), 0)
  assert.equal(await claim(nid1, U.viewerA), 1)
  assert.equal(await claim(nid1, U.viewerA), 0)
})

await test('ส่งพลาด (failed) → คนอื่นกดซ้ำได้ คงผู้เร่งคนแรก จด last_retry_by · ผู้กดล่าสุดเท่านั้นที่จองได้', async () => {
  // ระหว่าง sending ยังไม่ครบ 10 นาที กดซ้ำไม่ได้
  assert.equal((await nudge('paladA', 'complaint', C(1))).reason, 'already_today')
  await setDelivery(nid1, 'failed')
  const r = await nudge('paladA', 'complaint', C(1))
  assert.equal(r.ok, true)
  assert.equal(r.retry, true)
  assert.equal(r.nudge_id, nid1)
  const p = await payload(nid1)
  assert.equal(p.nudge.nudged_by, U.viewerA)
  assert.equal(p.nudge.requested_by, U.paladA)
  assert.equal(p.nudge.nudged_by_position, 'ผู้บริหาร')
  assert.equal(p.nudge.attempt_count, 2)
  assert.equal(await claim(nid1, U.viewerA), 0, 'ผู้เร่งคนแรกจองรอบกดซ้ำของคนอื่นไม่ได้')
  assert.equal(await claim(nid1, U.paladA), 1)
})

await test('กดซ้ำหลังส่งพลาดได้ไม่เกิน 5 ครั้ง/วัน/เรื่อง', async () => {
  for (let n = 3; n <= 5; n += 1) {
    await setDelivery(nid1, 'failed')
    assert.equal((await nudge('viewerA', 'complaint', C(1))).ok, true, `ครั้งที่ ${n}`)
  }
  await setDelivery(nid1, 'failed')
  assert.equal((await nudge('viewerA', 'complaint', C(1))).reason, 'already_today')
})

await test('ผู้สั่งเป็นหัวหน้ากองที่ถือเรื่องเอง → requester_is_head และ heads ไม่มีตัวเอง (Edge Function ลง none)', async () => {
  const r = await nudge('headPaladA', 'complaint', C(7))
  assert.equal(r.ok, true)
  const p = await payload(r.nudge_id)
  assert.equal(p.sendable, true)
  assert.equal(p.requester_is_head, true)
  assert.deepEqual(p.heads, [])
  assert.equal(p.nudge.nudged_by_position, 'ปลัดเทศบาล')
})

await test('เรื่องเปลี่ยนเป็นปิดหลังสั่งเร่ง → payload sendable=false ไม่คืน item/เลขที่/กอง/heads (ด่านชั้นที่สอง)', async () => {
  const r = await nudge('viewerA', 'document_request', R(1))
  assert.equal(r.ok, true)
  await db.exec('RESET ROLE')
  await db.query("UPDATE public.document_requests SET status = 'completed' WHERE id = $1", [R(1)])
  const p = await payload(r.nudge_id)
  assert.equal(p.sendable, false)
  assert.equal(p.item, null)
  assert.equal(p.department, null)
  assert.equal(p.nudge.item_ref, null)
  assert.deepEqual(p.heads, [])
  assert.equal(await payload(id(9999)), null)
})

await test('superadmin เร่งได้เฉพาะสนามซ้อม demo และป้ายผู้เร่งเป็น "ผู้ดูแลระบบ (ทดสอบ)" เสมอ', async () => {
  await db.exec('RESET ROLE')
  await db.exec(`
    INSERT INTO public.departments VALUES ('${id(399)}', '${MDEMO}', 'กองช่างสาธิต', NULL, 'eng', 1, true);
    INSERT INTO public.complaint_categories (municipality_id, value, label) VALUES ('${MDEMO}', 'road', 'ถนน');
    INSERT INTO public.complaints (id, municipality_id, ref_no, status, created_at, due_date, department_id, category)
      VALUES ('${C(50)}', '${MDEMO}', 'DM-1', 'received', ts(9), dt(2), '${id(399)}', 'road');`)
  const r = await nudge('superadmin', 'complaint', C(50), MDEMO)
  assert.equal(r.ok, true)
  assert.equal((await payload(r.nudge_id)).nudge.nudged_by_position, 'ผู้ดูแลระบบ (ทดสอบ)')
})

console.log(`\n${passed} cases passed`)
