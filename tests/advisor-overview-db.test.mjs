// ที่ปรึกษา AI รอบ 2 — RPC ภาพรวมระบบ (D1) · รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/advisor-overview-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ตารางจำลองมีเฉพาะคอลัมน์ที่ฟังก์ชันอ่าน + คอลัมน์ข้อมูลส่วนบุคคลปลอม (ชื่อ/เบอร์/รายละเอียด) เพื่อตรวจว่า "ไม่หลุดออกมา"
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const sql = await readFile(new URL('../supabase/migrations/20261109130200_advisor_system_overview.sql', import.meta.url), 'utf8')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const NL = id(1), TK = id(2), DEMO = id(3), OFF = id(4)
const VEH = id(11), GEN = id(12)
const PII = { name: 'สมชาย ทดสอบปลอม', phone: '0812345678', detail: 'บ้านเลขที่ 99 หมู่ 3 ข้อความอิสระ' }

const db = new PGlite()
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text, name text, org_type text, is_active boolean);
CREATE TABLE public.complaint_categories (municipality_id uuid, value text, label text, is_adhoc boolean DEFAULT false);
CREATE FUNCTION public.complaint_category_is_adhoc(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce((SELECT is_adhoc FROM public.complaint_categories WHERE municipality_id = $1 AND value = $2 LIMIT 1), false) $$;
CREATE TABLE public.complaints (municipality_id uuid, status text, category text, created_at timestamptz, closed_at timestamptz,
  due_date date, channel text, detail text, phone text, subject text);
CREATE TABLE public.document_requests (municipality_id uuid, document_type text, status text, created_at timestamptz, requester_name text, requester_phone text);
CREATE TABLE public.fleet_vehicles (id uuid PRIMARY KEY, meter_unit text, asset_kind text);
CREATE TABLE public.fleet_trips (municipality_id uuid, status text, trip_date date, distance_km numeric, vehicle_id uuid, destination text);
CREATE TABLE public.fleet_fuel_records (municipality_id uuid, filled_at date, liters numeric, total_cost numeric, invoice_total numeric);
CREATE TABLE public.patient_bookings (municipality_id uuid, status text, created_at timestamptz, patient_name text, phone text, mobility text, service_type text DEFAULT 'patient');
CREATE TABLE public.patient_transport_requests (municipality_id uuid, workflow_status text, created_at timestamptz, staff_note text);
CREATE TABLE public.profiles (id uuid, municipality_id uuid, role text, full_name text);
INSERT INTO public.municipalities VALUES
  ('${NL}', 'namlao', 'เทศบาลตำบลน้ำเลา', 'municipality', true),
  ('${TK}', 'tk', 'อบต.ทดสอบ', 'sao', true),
  ('${DEMO}', 'demo', 'เทศบาลตำบลสาธิต', 'municipality', true),
  ('${OFF}', 'off', 'ปิดใช้งาน', 'sao', false);
INSERT INTO public.complaint_categories VALUES ('${NL}', 'odor', 'กลิ่นเหม็น', true), ('${NL}', 'road', 'ถนนชำรุด', false);
INSERT INTO public.fleet_vehicles VALUES ('${VEH}', 'km', 'vehicle'), ('${GEN}', 'hour', 'engine');
`)

const now = "now()"
await db.exec(`
-- น้ำเลา: คำร้อง 6 เรื่องในช่วง + 1 เรื่องเก่า 200 วันที่ยังค้างเกินกำหนด
INSERT INTO public.complaints VALUES
  ('${NL}', 'new',         'road', ${now} - interval '2 days',  NULL, current_date - 1, 'citizen_online', '${PII.detail}', '${PII.phone}', '${PII.name}'),
  ('${NL}', 'in_progress', 'road', ${now} - interval '3 days',  NULL, current_date + 5, 'oss_counter',    '${PII.detail}', '${PII.phone}', '${PII.name}'),
  ('${NL}', 'done',        'road', ${now} - interval '10 days', ${now} - interval '8 days', current_date - 9, 'citizen_online', 'x', 'x', 'x'),
  ('${NL}', 'completed',   'road', ${now} - interval '6 days',  NULL, NULL, 'citizen_online', 'x', 'x', 'x'),
  ('${NL}', 'parked',      'road', ${now} - interval '4 days',  NULL, current_date - 2, 'citizen_online', 'x', 'x', 'x'),
  ('${NL}', 'new',         'odor', ${now} - interval '1 days',  NULL, current_date - 3, 'citizen_online', 'x', 'x', 'x'),
  ('${NL}', 'pending',     'road', ${now} - interval '200 days', NULL, current_date - 150, 'citizen_online', 'x', 'x', 'x');
INSERT INTO public.complaints VALUES ('${DEMO}', 'new', 'road', ${now}, NULL, current_date - 1, 'citizen_online', 'demo', 'demo', 'demo');
INSERT INTO public.document_requests VALUES
  ('${NL}', 'waste_collection', 'pending', ${now} - interval '1 day', '${PII.name}', '${PII.phone}'),
  ('${NL}', 'waste_collection', 'completed', ${now} - interval '2 day', 'x', 'x'),
  ('${NL}', 'public_assistance_request', 'pending', ${now} - interval '2 day', 'x', 'x'),
  ('${NL}', 'tax_notice', 'weird_status', ${now} - interval '40 day', 'x', 'x');
INSERT INTO public.fleet_trips VALUES
  ('${NL}', 'completed', current_date - 3, 42.5, '${VEH}', '${PII.detail}'),
  ('${NL}', 'completed', current_date - 3, 7, '${GEN}', 'x'),
  ('${NL}', 'pending',   current_date - 1, 99, '${VEH}', 'x');
INSERT INTO public.fleet_fuel_records VALUES ('${NL}', current_date - 2, 30.5, 1000.10, 1000.00), ('${NL}', current_date - 5, 10, 300.25, NULL);
INSERT INTO public.patient_bookings VALUES
  ('${NL}', 'completed', ${now} - interval '5 day', '${PII.name}', '${PII.phone}', 'wheelchair'),
  ('${NL}', 'completed', ${now} - interval '6 day', 'x', 'x', 'stretcher');
-- รถรับ-ส่งชุมชน 10 แถว ต้องไม่ถูกนับเป็นรถผู้ป่วย
INSERT INTO public.patient_bookings SELECT '${NL}', 'completed', ${now} - interval '2 day', 'x', 'x', 'walk', 'community' FROM generate_series(1, 10);
-- อปท. อื่น: ค่าที่คนนอกยิง API ใส่เองเป็นประเภท/สถานะ/หมวด ต้องไม่ออกเป็น key
INSERT INTO public.document_requests VALUES ('${TK}', '${PII.name} ${PII.phone}', '${PII.detail}', ${now} - interval '1 day', 'x', 'x');
INSERT INTO public.complaints VALUES ('${TK}', 'new', '${PII.name} ${PII.phone}', ${now} - interval '1 day', NULL, NULL, 'citizen_online', 'x', 'x', 'x');
INSERT INTO public.fleet_trips VALUES ('${TK}', '${PII.phone}', current_date - 1, 1, '${VEH}', 'x');
INSERT INTO public.patient_transport_requests SELECT '${NL}', 'completed', ${now} - interval '3 day', 'บันทึกเจ้าหน้าที่ลับ' FROM generate_series(1, 6);
INSERT INTO public.profiles VALUES
  (gen_random_uuid(), '${NL}', 'citizen', '${PII.name}'), (gen_random_uuid(), '${NL}', 'citizen', 'x'),
  (gen_random_uuid(), '${NL}', 'admin', 'x'), (gen_random_uuid(), '${NL}', 'superadmin', 'x'), (gen_random_uuid(), NULL, 'superadmin', 'x');
`)

const asRoot = () => db.exec('RESET ROLE')
const as = role => db.exec(`SET ROLE ${role}`)
let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }
const rejects = (p, code) => assert.rejects(p, e => { assert.equal(e.code, code, e.message); return true })

await db.exec(sql)

const overview = async (days = 30) => { await as('service_role'); const r = (await db.query('SELECT public.advisor_system_overview($1) AS o', [days])).rows[0].o; await asRoot(); return r }

await test('เรียกได้เฉพาะ service_role · anon/authenticated ถูกปฏิเสธ · p_days ต้องเป็น 30/90', async () => {
  for (const role of ['anon', 'authenticated']) {
    await as(role)
    await rejects(db.query('SELECT public.advisor_system_overview(30)'), '42501')
    await rejects(db.query('SELECT public.advisor_small_cell(3)'), '42501')
    await asRoot()
  }
  await as('service_role')
  await rejects(db.query('SELECT public.advisor_system_overview(7)'), '22023')
  await rejects(db.query('SELECT public.advisor_system_overview(NULL)'), '22023')
})

await test('ไม่รวมสนามซ้อม demo และ อปท. ที่ปิดใช้งาน', async () => {
  const o = await overview()
  assert.deepEqual(o.municipalities.map(m => m.slug).sort(), ['namlao', 'tk'])
  assert.equal(o.period_days, 30)
})

await test('คำร้อง: กลุ่มสถานะ · เวลาปิดเฉลี่ย · ค้างเกินกำหนดนับเรื่องเก่าด้วย แต่ไม่นับเฉพาะกิจ/parked', async () => {
  const c = (await overview()).municipalities.find(m => m.slug === 'namlao').complaints
  assert.equal(c.created, 6)
  assert.deepEqual([c.open, c.in_progress, c.resolved, c.rejected, c.parked], [2, 1, 2, 0, 1])
  assert.equal(Number(c.avg_close_days), 2)
  assert.equal(c.overdue_open_approx, 2, 'new ที่เลยกำหนด 1 + pending เก่า 200 วัน 1 (odor เฉพาะกิจ/parked/in_progress ยังไม่ถึงกำหนด ไม่นับ)')
  assert.deepEqual(c.by_channel, { citizen_online: 5, oss_counter: 1 })
  assert.deepEqual(c.top_categories, { 'ถนนชำรุด': 5, 'กลิ่นเหม็น': 1 })
})

await test('E-Service: ประเภท/สถานะผ่าน whitelist · กลุ่มอ่อนไหวแยกออกและปิดเลข · หักลบหาเลขที่ปิดไม่ได้ · 30/90 วันต่างกัน', async () => {
  const n30 = (await overview(30)).municipalities.find(m => m.slug === 'namlao')
  assert.equal(n30.doc_requests.created, 2, 'ไม่รวมกลุ่มอ่อนไหว')
  assert.deepEqual(n30.doc_requests.by_type, { waste_collection: 2 })
  assert.deepEqual(n30.doc_requests.by_status, { pending: 1, completed: 1 })
  assert.deepEqual(n30.sensitive_types, { public_assistance_request: '<5', patient_transport_request: 0 })
  const n90 = (await overview(90)).municipalities.find(m => m.slug === 'namlao')
  assert.equal(n90.doc_requests.created, 3)
  assert.equal(n90.doc_requests.by_status.other, 1, 'สถานะนอกชุดรวมเป็น other')
  assert.equal(n90.doc_requests.by_type.tax_notice, 1)
})

await test('ค่าที่คนนอกกรอกเอง (ประเภทคำขอ/สถานะ/หมวดคำร้อง/สถานะเที่ยว) ไม่ออกเป็น key', async () => {
  const tk = (await overview()).municipalities.find(m => m.slug === 'tk')
  assert.deepEqual(tk.doc_requests.by_type, { custom_or_unrecognized: 1 })
  assert.deepEqual(tk.doc_requests.by_status, { other: 1 })
  assert.deepEqual(tk.complaints.top_categories, { unrecognized: 1 })
  assert.deepEqual(tk.fleet.trips_by_status, { other: 1 })
})

await test('ยานพาหนะ: ระยะทางเฉพาะรถที่วัด กม. · ยอดน้ำมันใช้ยอดตามบิลก่อน', async () => {
  const f = (await overview()).municipalities.find(m => m.slug === 'namlao').fleet
  assert.equal(f.trips, 3)
  assert.deepEqual(f.trips_by_status, { completed: 2, pending: 1 })
  assert.equal(Number(f.distance_km), 42.5, 'ชั่วโมงเครื่องยนต์ 7 และเที่ยวที่ยังไม่จบ 99 ต้องไม่ถูกรวม')
  assert.equal(Number(f.fuel_liters), 40.5)
  assert.equal(Number(f.fuel_baht), 1300.25)
})

await test('รถผู้ป่วย: 1–4 เป็น "<5" · ≥5 แสดงจริง · ไม่นับรถชุมชน · ไม่แตกตามสถานะ · ไม่มี mobility', async () => {
  const p = (await overview()).municipalities.find(m => m.slug === 'namlao').patient_transport
  assert.deepEqual(p, { bookings: '<5', referrals: 6 })
  const tk = (await overview()).municipalities.find(m => m.slug === 'tk').patient_transport
  assert.equal(tk.bookings, 0, '0 คงเป็น 0')
})

await test('ผู้ใช้ตาม role ไม่นับ superadmin', async () => {
  const u = (await overview()).municipalities.find(m => m.slug === 'namlao').users_by_role
  assert.deepEqual(u, { citizen: 2, admin: 1 })
})

await test('PDPA: ไม่มีชื่อ/เบอร์/ข้อความอิสระ/uuid/mobility หลุดออกมา', async () => {
  const text = JSON.stringify(await overview(90))
  for (const bad of [PII.name, PII.phone, PII.detail, 'wheelchair', 'stretcher', 'mobility', NL, TK, VEH, 'บันทึกเจ้าหน้าที่ลับ']) {
    assert.ok(!text.includes(bad), `หลุด: ${bad}`)
  }
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), 'ห้ามมี uuid')
  assert.ok(text.length < 200000, 'ต้องเล็กกว่า CHECK ของ context_snapshot')
})

await test('รันซ้ำได้', async () => {
  await db.exec(sql)
  assert.equal((await overview()).municipalities.length, 2)
})

console.log(`\n${cases} cases passed`)
