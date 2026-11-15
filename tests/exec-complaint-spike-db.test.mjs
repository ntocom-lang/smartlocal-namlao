// ห้องผู้บริหาร — exec_summary_complaint_spike() "เรื่องร้องเรียนพุ่งผิดปกติ" · รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   ในเครื่อง: node tests/exec-complaint-spike-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   CI (patient-module-tests.yml): อ่าน path จาก env PATIENT_PGLITE_MODULE
// ลงไฟล์ E2 + E2.1 ตามลำดับเดียวกับฐานจริง แล้วลงไฟล์ใหม่ · ตัวเลขคาดหวังคิดมือจากข้อมูลด้านล่าง (T = วันนี้เวลาไทย, ts(d) = 10:00 น. ของ T−d)
// กฎ: 7 วันล่าสุด [T−6, T+1) ≥ 5 เรื่อง และ recent × 2 ≥ base (base = [T−34, T−6)) · หมวดต้องอยู่ในทะเบียน
//     ข้อมูลพอ = มีคำร้องก่อน T−34 และช่วงฐานรวมทุกหมวด ≥ 4 · หมู่มากสุด = ≥ 2 เรื่องและไม่เสมออันดับสอง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const migration = (f) => readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const BEFORE = [
  '20261115100000_exec_access_overview.sql',
  '20261115100100_exec_summary_service.sql',
  '20261115100200_exec_summary_operations.sql',
  '20261116100000_exec_review_fixes.sql',
  '20261116100100_list_events_for_staff_between.sql',
]
const SPIKE = '20261127100000_exec_summary_complaint_spike.sql'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1), MB = id(2), MC = id(3)
const U = { viewerA: id(101), citizenA: id(104), viewerB: id(105), officerA: id(103), viewerC: id(106) }
const P_HEAD = id(202)
const PII = { name: 'สมชาย ทดสอบปลอม', phone: '0812345678' }

const db = new PGlite()
// ตารางจำลอง — ชุดเดียวกับ tests/executive-summary-db.test.mjs (ไฟล์ E2 ตรวจคอลัมน์ทุกตารางที่อ่านตอน apply)
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.positions (id uuid PRIMARY KEY, category text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, municipality_id uuid, position_id uuid, department_id uuid, full_name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text, short_name text, code text, sort_order int, is_active boolean);
CREATE TABLE public.locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, name text);
CREATE TABLE public.complaint_categories (municipality_id uuid, value text, label text, is_adhoc boolean NOT NULL DEFAULT false,
  requires_manual_intake boolean NOT NULL DEFAULT false);
CREATE TABLE public.complaints (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, status text, created_at timestamptz, closed_at timestamptz,
  due_date date, assigned_to uuid, resolved_by uuid, department_id uuid, channel text DEFAULT 'citizen_online', village text,
  category text, parked_reason text, rating smallint, user_id uuid, reporter_name text, phone text, department text);
CREATE TABLE public.complaint_timeline (complaint_id uuid, status text, created_at timestamptz);
CREATE TABLE public.document_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, document_type text,
  status text, created_at timestamptz, issued_at timestamptz, due_date date, department_id uuid, created_by_uid uuid, requester_name text);
CREATE TABLE public.satisfaction_ratings (municipality_id uuid, complaint_id uuid, rating smallint, is_verified boolean DEFAULT false,
  via_link boolean DEFAULT false, rated_by_proxy boolean DEFAULT false, created_at timestamptz, comment text);
CREATE TABLE public.patient_booking_trips (id uuid PRIMARY KEY, municipality_id uuid, state text, booking_ids uuid[] NOT NULL);
CREATE TABLE public.patient_bookings (id uuid PRIMARY KEY, municipality_id uuid, service_type text, status text, appointment_at timestamptz, trip_id uuid, patient_name text);
CREATE TABLE public.fleet_vehicles (id uuid PRIMARY KEY, municipality_id uuid, status text);
CREATE TABLE public.fleet_maintenance (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, vehicle_id uuid,
  service_date date, maintenance_type text NOT NULL DEFAULT 'routine', next_service_date date, created_at timestamptz DEFAULT now());
CREATE TABLE public.fleet_incidents (municipality_id uuid, incident_kind text, incident_date date, report_date date);
CREATE TABLE public.asset_borrow_requests (municipality_id uuid, workflow_status text, created_at timestamptz, return_due_date date);
CREATE TABLE public.civil_projects (id uuid PRIMARY KEY, municipality_id uuid, stage text, end_date date);
CREATE TABLE public.civil_project_contracts (project_id uuid PRIMARY KEY, extended_until date, notice_to_proceed_date date, finish_within_days int);
CREATE TABLE public.civil_project_changes (project_id uuid, kind text, decision text, new_end_date date, created_at timestamptz);
CREATE TABLE public.civil_weekly_reports (project_id uuid, status text, frozen jsonb, period_end date, week_no int);
CREATE TABLE public.local_op_plans (municipality_id uuid, status text, kind text, fiscal_year smallint, published_on date);
CREATE TABLE public.local_dev_plans (municipality_id uuid, status text);
CREATE TABLE public.water_announcements (municipality_id uuid, status text, drafted_at timestamptz, event_id uuid);
CREATE TABLE public.water_events (id uuid PRIMARY KEY, municipality_id uuid, opened_at timestamptz, closed_at timestamptz);
CREATE TABLE public.water_announcement_settings (municipality_id uuid PRIMARY KEY, enabled boolean NOT NULL DEFAULT false);
CREATE TABLE public.events (id uuid PRIMARY KEY, municipality_id uuid, title text, description text, event_date date NOT NULL,
  end_date date, event_time time, attachment_urls text[] NOT NULL DEFAULT '{}');
CREATE FUNCTION public.list_events_for_staff(p_municipality_id uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$ SELECT to_jsonb(e) FROM public.events AS e WHERE e.municipality_id = p_municipality_id $$;
REVOKE ALL ON FUNCTION public.list_events_for_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_events_for_staff(uuid) TO authenticated;

CREATE FUNCTION public.t0() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;
CREATE FUNCTION public.ts(d int) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT ((public.t0() - d)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Bangkok' $$;
-- เวลาไทยระบุนาทีของวัน (ขอบช่วง) — ถ้าโค้ดคิดขอบเป็น UTC (คลาด 7 ชม.) แถวพวกนี้จะตกผิดช่วงและเทสต์ล้ม
CREATE FUNCTION public.tsm(d int, m int) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT ((public.t0() - d)::timestamp + make_interval(mins => m)) AT TIME ZONE 'Asia/Bangkok' $$;
`)
for (const f of BEFORE) await db.exec(await migration(f))

// เพิ่มแถวคำร้อง n แถว: หมวด/หมู่/วันย้อนหลัง/สถานะ/เวลา (ข้อมูลส่วนบุคคลปลอมทุกแถว — ตรวจว่าไม่หลุดออกมา)
const rows = []
const add = (muni, category, village, d, n = 1, status = 'pending', at = null) => {
  for (let i = 0; i < n; i++) rows.push(`('${muni}', '${status}', ${at ?? `ts(${d})`}, '${village}', '${category}', '${PII.name}', '${PII.phone}')`)
}
// ── อปท. A (มีประวัติเก่ากว่า 35 วัน) ──
add(MA, 'road', 'หมู่ 1', 60)                         // ประวัติ (ไม่อยู่ในช่วงใดเลย)
add(MA, 'water', 'หมู่ 1', 35)                        // T−35 10:00 นอกฐาน → ไม่นับ
// water: recent 6 (หมู่ 1 ×4, บ้านดอน ×2) + base 4 → 12 ≥ 4 พุ่ง · rejected 3 ไม่นับ (ถ้านับจะเป็น 9)
add(MA, 'water', 'หมู่ 1', 0, 2); add(MA, 'water', 'หมู่ 1', 6, 2); add(MA, 'water', 'บ้านดอน', 3, 2)
add(MA, 'water', 'หมู่ 1', 7, 2); add(MA, 'water', 'หมู่ 1', 34, 2)
add(MA, 'water', 'หมู่ 1', 1, 3, 'rejected')
// road: recent 5 + base 12 → 10 < 12 ไม่พุ่ง (ฐานสูงอยู่แล้ว)
add(MA, 'road', 'หมู่ 1', 2, 5); add(MA, 'road', 'หมู่ 1', 20, 12)
// tree: recent 5 พอดี + base 10 → 10 ≥ 10 พุ่ง (เท่ากับเกณฑ์) · หมู่บ้านพิมพ์เองนอกทะเบียน → village null
add(MA, 'tree', `หน้าบ้าน${PII.name}`, 4, 5); add(MA, 'tree', 'หมู่ 1', 15, 10)
// drain: recent 6 แต่หมู่เสมอกัน 2/2/2 → ไม่ระบุหมู่ (ไม่ใช่ "มากสุด" จริง)
add(MA, 'drain', 'หมู่ 1', 1, 2); add(MA, 'drain', 'บ้านดอน', 1, 2); add(MA, 'drain', 'หมู่ 2', 2, 2)
// lamp: recent 5 กระจาย 5 หมู่ หมู่ละ 1 → ไม่ระบุหมู่ (ไม่ส่งยอด 1 เรื่องต่อหมู่ออกไป)
for (const v of ['หมู่ 1', 'หมู่ 2', 'หมู่ 3', 'หมู่ 4', 'หมู่ 5']) add(MA, 'lamp', v, 3)
// edge: ขอบเวลาไทย — T−6 00:30 ×5 = recent · T−7 23:30 ×3 + T−34 00:30 ×2 = base 5 · T−35 23:30 ×6 ไม่นับ (ถ้านับ base = 11 > 10 ไม่พุ่ง)
add(MA, 'edge', 'หมู่ 3', 6, 5, 'pending', 'tsm(6, 30)')
add(MA, 'edge', 'หมู่ 3', 7, 3, 'pending', 'tsm(7, 1410)'); add(MA, 'edge', 'หมู่ 3', 34, 2, 'pending', 'tsm(34, 30)')
add(MA, 'edge', 'หมู่ 3', 35, 6, 'pending', 'tsm(35, 1410)')
// gone: หมวดที่แอดมินลบจากทะเบียนแล้ว (ไม่รู้ว่าเคยอ่อนไหวไหม) → ไม่นับ
add(MA, 'gone', 'หมู่ 1', 1, 6)
// light: recent 4 + base 0 → ไม่ถึง 5
add(MA, 'light', 'หมู่ 1', 1, 4)
// หมวดอ่อนไหว / เฉพาะกิจ → ไม่นับแม้พุ่ง
add(MA, 'corrupt', 'หมู่ 1', 1, 7); add(MA, 'odor', 'หมู่ 1', 1, 6)
// ── อปท. B (เพิ่งเริ่มใช้ระบบ: ไม่มีคำร้องเก่ากว่า 35 วัน) → ไม่ตัดสิน ──
add(MB, 'water', 'หมู่ 1', 1, 6)
// ── อปท. C: ข้อมูลทดสอบเก่าค้าง 1 แถว แต่ช่วงฐานบาง (3 เรื่อง < 4) → ไม่ตัดสิน ──
add(MC, 'water', 'หมู่ 1', 90); add(MC, 'water', 'หมู่ 1', 20, 3); add(MC, 'water', 'หมู่ 1', 1, 8)

await db.exec(`
INSERT INTO public.positions VALUES ('${P_HEAD}', 'dept_head');
INSERT INTO public.profiles VALUES
  ('${U.viewerA}', 'viewer', '${MA}', NULL, NULL, 'นายกปลอม'),
  ('${U.officerA}', 'officer', '${MA}', '${P_HEAD}', NULL, 'ผอ.ปลอม'),
  ('${U.citizenA}', 'citizen', '${MA}', NULL, NULL, '${PII.name}'),
  ('${U.viewerB}', 'viewer', '${MB}', NULL, NULL, 'นายก B'),
  ('${U.viewerC}', 'viewer', '${MC}', NULL, NULL, 'นายก C');
INSERT INTO public.locations (municipality_id, name) VALUES ('${MA}', 'บ้านดอน'), ('${MB}', 'หมู่ 1');
INSERT INTO public.complaint_categories (municipality_id, value, label, is_adhoc, requires_manual_intake) VALUES
  ('${MA}', 'road', 'ถนนชำรุด', false, false), ('${MA}', 'water', 'น้ำประปาไม่ไหล', false, false),
  ('${MA}', 'light', 'ไฟฟ้าดับ', false, false), ('${MA}', 'odor', 'กลิ่นเหม็น', true, false),
  ('${MA}', 'corrupt', 'ร้องเรียนเจ้าหน้าที่', false, true), ('${MA}', 'tree', 'ต้นไม้ล้ม', false, false),
  ('${MA}', 'drain', 'ท่อระบายน้ำอุดตัน', false, false), ('${MA}', 'lamp', 'ไฟทางดับ', false, false),
  ('${MA}', 'edge', 'ทดสอบขอบเวลา', false, false), ('${MB}', 'water', 'น้ำประปาไม่ไหล', false, false),
  ('${MC}', 'water', 'น้ำประปาไม่ไหล', false, false);
INSERT INTO public.complaints (municipality_id, status, created_at, village, category, reporter_name, phone) VALUES ${rows.join(',\n')};
INSERT INTO public.complaints (municipality_id, status, created_at, village, category) VALUES ('${MA}', 'pending', ts(1), 'หมู่ 1', NULL);
`)

async function as(alias) {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias === 'anon' ? '' : U[alias]])
  await db.exec(`SET ROLE ${alias === 'anon' ? 'anon' : 'authenticated'}`)
}
async function overview(alias, muni, keys) {
  await as(alias)
  try {
    const { rows: r } = await db.query('SELECT public.executive_overview($1, (t0() - 30), t0(), $2::text[]) AS r', [muni, keys])
    return r[0].r
  } finally { await db.exec('RESET ROLE') }
}
async function rejects(fn, code, label) {
  await assert.rejects(fn, (e) => { assert.equal(e.code, code, `${label}: ได้ ${e.code} ${e.message}`); return true })
}
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`) }

await test('ก่อนลงไฟล์: ตัวรวบไม่รู้จักคีย์ complaint_spike → ok:false รายคีย์ (หน้าไม่พังทั้งหน้า)', async () => {
  const r = await overview('viewerA', MA, ['complaint_spike', 'complaints'])
  assert.equal(r.summaries.complaint_spike.ok, false)
  assert.equal(r.summaries.complaints.ok, true)
})

await test('ด่านหัวไฟล์: exec_village_label ถูกแก้นอก repo (md5 ไม่ตรง) → หยุด ไม่สร้างฟังก์ชัน (ไฟล์อยู่ใน transaction เดียว)', async () => {
  const { rows: [orig] } = await db.query(`SELECT pg_get_functiondef(p.oid) AS d, pg_get_function_arguments(p.oid) AS args
    FROM pg_proc p WHERE p.oid = 'public.exec_village_label(uuid,text)'::regprocedure`)
  // รุ่นที่ "ถูกแก้นอก repo": คืนข้อความที่ผู้แจ้งพิมพ์ตรงๆ (ชื่อพารามิเตอร์ต้องเหมือนเดิม ไม่งั้น CREATE OR REPLACE ไม่ยอม)
  const textArg = orig.args.split(',')[1].trim().split(/\s+/)[0]
  await db.exec(`CREATE OR REPLACE FUNCTION public.exec_village_label(${orig.args}) RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(${textArg}, '') $$`)
  await assert.rejects(async () => db.exec(await migration(SPIKE)), /md5 ไม่ตรง/)
  await db.exec('ROLLBACK')
  await db.exec(orig.d)
  const { rows: [x] } = await db.query("SELECT to_regprocedure('public.exec_summary_complaint_spike(uuid,date,date)') AS f")
  assert.equal(x.f, null)
})

await db.exec(await migration(SPIKE))

await test('ลงไฟล์ซ้ำ = ล้มที่ด่านหัวไฟล์ (สร้างใหม่เท่านั้น ห้ามทับ)', async () => {
  await assert.rejects(async () => db.exec(await migration(SPIKE)), /มีฟังก์ชันชื่อนี้อยู่แล้ว/)
  await db.exec('ROLLBACK')
})

await test('สิทธิ์: anon/authenticated เรียกตรงไม่ได้ · SECURITY DEFINER · search_path ว่าง', async () => {
  const { rows: r } = await db.query(`SELECT p.prosecdef, p.proconfig,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
    FROM pg_proc p WHERE p.oid = 'public.exec_summary_complaint_spike(uuid,date,date)'::regprocedure`)
  assert.deepEqual(r[0], { prosecdef: true, proconfig: ['search_path=""'], auth: false, anon: false })
  await as('viewerA')
  try {
    await rejects(() => db.query('SELECT public.exec_summary_complaint_spike($1, t0(), t0())', [MA]), '42501', 'viewer เรียกตรง')
  } finally { await db.exec('RESET ROLE') }
})

await test('ผ่านตัวรวบ: ประชาชนเรียกไม่ได้ · นายก อปท. B ขอของ A ไม่ได้', async () => {
  await rejects(() => overview('citizenA', MA, ['complaint_spike']), '42501', 'ประชาชน')
  await rejects(() => overview('viewerB', MA, ['complaint_spike']), '42501', 'ข้าม อปท.')
})

await test('กฎพุ่ง: drain/water/edge/lamp/tree พุ่ง · road ฐานสูง/light ไม่ถึง 5/อ่อนไหว-เฉพาะกิจ-ปฏิเสธ-ไม่ระบุหมวด-หมวดที่ลบ ไม่นับ · ขอบเวลาไทย · หมู่เสมอ/1 เรื่อง ไม่ระบุ', async () => {
  const r = await overview('viewerA', MA, ['complaint_spike'])
  assert.equal(r.summaries.complaint_spike.ok, true)
  const d = r.summaries.complaint_spike.data
  assert.deepEqual({ ...d, groups: undefined }, { recent_days: 7, base_days: 28, min: 5, ratio: 2, insufficient_history: false, groups: undefined })
  assert.deepEqual(d.groups, [
    { category: 'drain', label: 'ท่อระบายน้ำอุดตัน', recent: 6, base: 0, village: null, village_n: null },
    { category: 'water', label: 'น้ำประปาไม่ไหล', recent: 6, base: 4, village: 'หมู่ 1', village_n: 4 },
    { category: 'edge', label: 'ทดสอบขอบเวลา', recent: 5, base: 5, village: 'หมู่ 3', village_n: 5 },
    { category: 'lamp', label: 'ไฟทางดับ', recent: 5, base: 0, village: null, village_n: null },
    // recent 5 × 2 = base 10 พอดีเกณฑ์ · หมู่บ้านพิมพ์เองนอกทะเบียนไม่คืนข้อความ
    { category: 'tree', label: 'ต้นไม้ล้ม', recent: 5, base: 10, village: null, village_n: null },
  ])
})

await test('ไม่หลุดข้อมูลส่วนบุคคล: ไม่มีชื่อ/เบอร์/ข้อความหมู่บ้านที่พิมพ์เองในผลลัพธ์', async () => {
  const s = JSON.stringify(await overview('viewerA', MA, ['complaint_spike']))
  assert.ok(!s.includes(PII.name) && !s.includes(PII.phone), s)
})

await test('อปท. ที่เพิ่งเริ่มใช้ระบบ (ไม่มีคำร้องเก่ากว่า 35 วัน) → ไม่ตัดสิน groups ว่าง', async () => {
  const d = (await overview('viewerB', MB, ['complaint_spike'])).summaries.complaint_spike.data
  assert.equal(d.insufficient_history, true)
  assert.deepEqual(d.groups, [])
})

await test('ข้อมูลเก่าค้าง 1 แถว แต่ช่วงฐาน 28 วันบาง (< 4 เรื่อง) → ไม่ตัดสิน (กันเตือนลวงตอนเพิ่งใช้จริง)', async () => {
  const d = (await overview('viewerC', MC, ['complaint_spike'])).summaries.complaint_spike.data
  assert.equal(d.insufficient_history, true)
  assert.deepEqual(d.groups, [])
})

await test('ไม่มีหมวดพุ่ง → groups = [] (ไม่ใช่ null) และ insufficient_history = false', async () => {
  await db.exec(`UPDATE public.complaints SET status = 'rejected' WHERE municipality_id = '${MA}' AND created_at >= tsm(6, 0)`)
  const d = (await overview('viewerA', MA, ['complaint_spike'])).summaries.complaint_spike.data
  assert.equal(d.insufficient_history, false)
  assert.deepEqual(d.groups, [])
})

console.log(`\n${passed} passed`)
