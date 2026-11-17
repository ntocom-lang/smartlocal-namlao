// ประเมินความพึงพอใจรายเรื่องของคำขอ E-Service (แผนเทียบคู่แข่ง ข้อ 1.2) — รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   ในเครื่อง: node tests/doc-request-rating-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   CI (patient-module-tests.yml): อ่าน path จาก env PATIENT_PGLITE_MODULE
// ลงไฟล์ E2 ตามลำดับเดียวกับฐานจริง แล้วลง 20261204100000 (คอลัมน์) + 20261204100100 (ฟังก์ชัน)
// กติกาที่เจ้าของระบบเลือก 2569-11-17: ใบเคาน์เตอร์ไม่ชวน · ใบไม่อนุมัติชวนแต่แยกรายงาน · ใบที่ผู้ยื่นถอนเองไม่ชวน · ข้อเดียว 5 ระดับ
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
const COLUMNS = '20261204100000_doc_request_rating_columns.sql'
const FUNCTIONS = '20261204100100_doc_request_rating_functions.sql'
const FIXES = '20261204100200_doc_request_rating_review_fixes.sql'   // แก้ตามผลตรวจ: M1 ถอนเอง = ผู้ยื่นกดเอง · L2 · H1

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1), MB = id(2)
const U = {
  viewerA: id(101), officerA: id(102), councilA: id(103), citizenA: id(104), citizenB: id(105), viewerB: id(106),
}
const R = {
  done: id(301), rejected: id(302), ptCancelled: id(303), borrowCancelled: id(304), counter: id(305),
  pending: id(306), staffCancelled: id(312), borrowStaffCancelled: id(313), noRequester: id(307), council: id(308), legacy: id(309), otherCitizen: id(310), otherMuni: id(311),
}
const PII = { name: 'สมหญิง ทดสอบปลอม', comment: 'เบอร์ 0899999999 บ้านเลขที่ 9' }

const db = new PGlite()
// ตารางจำลอง — ชุดเดียวกับ tests/exec-complaint-spike-db.test.mjs (ไฟล์ E2 ตรวจคอลัมน์ทุกตารางที่อ่านตอน apply)
// ต่างกันที่ document_requests / satisfaction_ratings มีคอลัมน์ครบตามที่ไฟล์ 1.2 ใช้ + ตารางลูกที่บอก "ผู้ยื่นถอนเอง"
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
  status text NOT NULL DEFAULT 'pending', created_at timestamptz DEFAULT now(), issued_at timestamptz, due_date date, department_id uuid,
  created_by_uid uuid, requester_name text, user_id uuid, permit_form_data jsonb, reject_reason text, updated_at timestamptz);
GRANT SELECT, INSERT, UPDATE ON public.document_requests TO authenticated;
CREATE TABLE public.patient_transport_requests (request_id uuid PRIMARY KEY, workflow_status text, cancelled_by uuid);
CREATE TABLE public.asset_borrow_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid, event_type text, actor_id uuid);
CREATE TABLE public.patient_transport_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid, event_type text, detail jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.satisfaction_ratings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, complaint_id uuid,
  rating smallint NOT NULL, is_verified boolean NOT NULL DEFAULT false, via_link boolean NOT NULL DEFAULT false,
  rated_by_proxy boolean NOT NULL DEFAULT false, created_by uuid, created_at timestamptz DEFAULT now(), comment text);
CREATE UNIQUE INDEX satisfaction_ratings_complaint_once ON public.satisfaction_ratings (complaint_id, is_verified);
ALTER TABLE public.satisfaction_ratings ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.satisfaction_ratings TO anon, authenticated;
-- policy ตัวล่าสุดก่อนไฟล์นี้ (20261111100100)
CREATE POLICY "anyone can insert general satisfaction" ON public.satisfaction_ratings FOR INSERT TO anon, authenticated
  WITH CHECK (complaint_id IS NULL AND is_verified = false AND rated_by_proxy = false AND (created_by IS NULL OR created_by = auth.uid()));
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
`)
for (const f of BEFORE) await db.exec(await migration(f))

async function as(alias) {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias === 'anon' ? '' : U[alias]])
  await db.exec(`SET ROLE ${alias === 'anon' ? 'anon' : 'authenticated'}`)
}
async function run(alias, sql, params = []) {
  await as(alias)
  try { return (await db.query(sql, params)).rows } finally { await db.exec('RESET ROLE') }
}
const rate = async (alias, req, rating, comment = null) =>
  (await run(alias, 'SELECT public.rate_document_request($1, $2, $3) AS r', [req, rating, comment]))[0].r
async function rejects(fn, code, label) {
  await assert.rejects(fn, (e) => { assert.equal(e.code, code, `${label}: ได้ ${e.code} ${e.message}`); return true })
}
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`) }

await test('ด่านหัวไฟล์: exec_summary_satisfaction ถูกแก้นอก repo (md5 ไม่ตรง) → หยุดทั้งไฟล์ ไม่สร้างอะไรเลย', async () => {
  await db.exec(await migration(COLUMNS))
  const { rows: [orig] } = await db.query(`SELECT pg_get_functiondef('public.exec_summary_satisfaction(uuid,date,date)'::regprocedure) AS d`)
  await db.exec(orig.d.replace("'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)'", "'แก้นอก repo'"))
  await assert.rejects(async () => db.exec(await migration(FUNCTIONS)), /Function drift: exec_summary_satisfaction/)
  await db.exec('ROLLBACK')
  await db.exec(orig.d)
  const { rows: [x] } = await db.query("SELECT to_regprocedure('public.rate_document_request(uuid,integer,text)') AS f")
  assert.equal(x.f, null)
})

await db.exec(await migration(FUNCTIONS))

await test('ลงไฟล์ซ้ำทั้งสองไฟล์ได้ (md5 รุ่นใหม่อยู่ในรายการที่ยอมรับ)', async () => {
  await db.exec(await migration(COLUMNS))
  await db.exec(await migration(FUNCTIONS))
})

await db.exec(await migration(FIXES))

await test('ไฟล์แก้ (3): รันซ้ำได้ · ด่านเจ้าของ/สิทธิ์ท้ายไฟล์ผ่าน · ไฟล์ 2 รันทับรุ่นใหม่ไม่ได้ (ด่าน md5 กันถอยรุ่นเงียบๆ)', async () => {
  await db.exec(await migration(FIXES))
  await assert.rejects(async () => db.exec(await migration(FUNCTIONS)), /Function drift: exec_summary_satisfaction/)
  await db.exec('ROLLBACK')
})

await test('สิทธิ์: rate/my_ เรียกได้เฉพาะ authenticated · ฟังก์ชันภายในไม่มีใครเรียกตรงได้ · SECURITY DEFINER + search_path ว่าง', async () => {
  const { rows } = await db.query(`SELECT p.proname, p.prosecdef, p.proconfig,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('rate_document_request', 'my_document_request_ratings', 'document_request_withdrawn',
      'document_request_rating_block', 'exec_satisfaction_eservice', 'exec_summary_satisfaction', 'stamp_document_request_finished_at')
    ORDER BY 1`)
  const got = Object.fromEntries(rows.map(r => [r.proname, r]))
  assert.equal(rows.length, 7)
  for (const r of rows) {
    assert.equal(r.prosecdef, true, r.proname)
    assert.deepEqual(r.proconfig, ['search_path=""'], r.proname)
    assert.equal(r.anon, false, `${r.proname} anon`)
  }
  assert.equal(got.rate_document_request.auth, true)
  assert.equal(got.my_document_request_ratings.auth, true)
  for (const k of ['document_request_withdrawn', 'document_request_rating_block', 'exec_satisfaction_eservice',
    'exec_summary_satisfaction', 'stamp_document_request_finished_at']) assert.equal(got[k].auth, false, k)
})

// ── ข้อมูล ──
await db.exec(`
INSERT INTO public.profiles VALUES
  ('${U.viewerA}', 'viewer', '${MA}', NULL, NULL, 'นายกปลอม'),
  ('${U.officerA}', 'officer', '${MA}', NULL, NULL, 'เจ้าหน้าที่ปลอม'),
  ('${U.councilA}', 'council', '${MA}', NULL, NULL, 'สท.ปลอม'),
  ('${U.citizenA}', 'citizen', '${MA}', NULL, NULL, '${PII.name}'),
  ('${U.citizenB}', 'citizen', '${MA}', NULL, NULL, 'ประชาชนอีกคน'),
  ('${U.viewerB}', 'viewer', '${MB}', NULL, NULL, 'นายก B');
INSERT INTO public.document_requests (id, municipality_id, document_type, status, user_id, requester_name, permit_form_data) VALUES
  ('${R.done}',            '${MA}', 'residence_cert',            'completed', '${U.citizenA}', '${PII.name}', '{"signed_by":{"channel":"online"}}'),
  ('${R.rejected}',        '${MA}', 'residence_cert',            'rejected',  '${U.citizenA}', '${PII.name}', NULL),
  ('${R.ptCancelled}',     '${MA}', 'patient_transport_request', 'rejected',  '${U.citizenA}', '${PII.name}', NULL),
  ('${R.borrowCancelled}', '${MA}', 'asset_borrow_request',      'rejected',  '${U.citizenA}', '${PII.name}', NULL),
  ('${R.staffCancelled}',  '${MA}', 'patient_transport_request', 'rejected',  '${U.citizenA}', '${PII.name}', NULL),
  ('${R.borrowStaffCancelled}', '${MA}', 'asset_borrow_request',  'rejected',  '${U.citizenA}', '${PII.name}', NULL),
  ('${R.counter}',         '${MA}', 'water_supply_request',      'completed', '${U.officerA}', 'ชาวบ้านที่เคาน์เตอร์', '{"signed_by":{"channel":"counter"}}'),
  ('${R.pending}',         '${MA}', 'residence_cert',            'pending',   '${U.citizenA}', '${PII.name}', NULL),
  ('${R.noRequester}',     '${MA}', 'residence_cert',            'completed', NULL,            'ไม่ล็อกอิน', NULL),
  ('${R.council}',         '${MA}', 'residence_cert',            'completed', '${U.councilA}', 'สท.ปลอม', '{"signed_by":{"channel":"online"}}'),
  ('${R.otherCitizen}',    '${MA}', 'residence_cert',            'completed', '${U.citizenB}', 'ประชาชนอีกคน', NULL),
  ('${R.otherMuni}',       '${MB}', 'residence_cert',            'completed', '${U.citizenA}', '${PII.name}', NULL);
INSERT INTO public.patient_transport_requests VALUES ('${R.ptCancelled}', 'cancelled', '${U.citizenA}'),
  ('${R.staffCancelled}', 'cancelled', '${U.officerA}');   -- เจ้าหน้าที่กดยกเลิก = ปฏิบัติแบบใบไม่อนุมัติ (M1)
-- ธงที่ cancel_patient_transport_request บันทึกตอนกด — ตัวที่ฟังก์ชันใช้ตัดสินจริง (cancelled_by เปลี่ยนเป็น NULL ได้เมื่อรวมบัญชี)
INSERT INTO public.patient_transport_events (request_id, event_type, detail) VALUES
  ('${R.ptCancelled}', 'cancelled', '{"by_owner": true, "after_forward": false}'),
  ('${R.staffCancelled}', 'cancelled', '{"by_owner": false, "after_forward": true}');
INSERT INTO public.asset_borrow_events (request_id, event_type, actor_id) VALUES ('${R.borrowStaffCancelled}', 'cancelled', '${U.officerA}');
INSERT INTO public.asset_borrow_events (request_id, event_type, actor_id) VALUES ('${R.borrowCancelled}', 'cancelled', '${U.citizenA}');
-- คำขอที่ปิดก่อนมีคอลัมน์ finished_at (ไม่ย้อนเติม) — ปิด trigger ชั่วคราวเพื่อจำลองแถวเก่า
ALTER TABLE public.document_requests DISABLE TRIGGER stamp_document_request_finished_at_trigger;
INSERT INTO public.document_requests (id, municipality_id, document_type, status, user_id, requester_name)
  VALUES ('${R.legacy}', '${MA}', 'residence_cert', 'completed', '${U.citizenA}', '${PII.name}');
ALTER TABLE public.document_requests ENABLE TRIGGER stamp_document_request_finished_at_trigger;
`)
const finishedAt = async (req) => (await db.query('SELECT finished_at FROM public.document_requests WHERE id = $1', [req])).rows[0].finished_at

await test('trigger finished_at: สร้างมาปิดแล้ว = มีเวลา · ค้าง = ว่าง · ถอยกลับ = ว่าง · ส่งค่าปลอมมาเอง = ไม่มีผล', async () => {
  assert.ok(await finishedAt(R.done))
  assert.ok(await finishedAt(R.rejected))
  assert.equal(await finishedAt(R.pending), null)
  assert.equal(await finishedAt(R.legacy), null)
  // เจ้าหน้าที่ (client) ส่ง finished_at มาเองโดยสถานะไม่เปลี่ยน → คงค่าเดิม (ว่าง)
  await run('officerA', `UPDATE public.document_requests SET finished_at = '2020-01-01' WHERE id = $1`, [R.pending])
  assert.equal(await finishedAt(R.pending), null)
  await db.query(`UPDATE public.document_requests SET status = 'processing' WHERE id = $1`, [R.pending])
  assert.equal(await finishedAt(R.pending), null)
  await db.query(`UPDATE public.document_requests SET status = 'completed', finished_at = '2020-01-01' WHERE id = $1`, [R.pending])
  const t = await finishedAt(R.pending)
  assert.ok(t && t.getFullYear() > 2020, 'ต้องเป็น now() ไม่ใช่ค่าที่ส่งมา')
  await db.query(`UPDATE public.document_requests SET requester_name = 'แก้ชื่อ', finished_at = NULL WHERE id = $1`, [R.pending])
  assert.equal((await finishedAt(R.pending)).getTime(), t.getTime(), 'แก้คอลัมน์อื่น → เวลาปิดคงเดิม')
  await db.query(`UPDATE public.document_requests SET status = 'processing' WHERE id = $1`, [R.pending])
  assert.equal(await finishedAt(R.pending), null)
  await db.query(`UPDATE public.document_requests SET status = 'pending' WHERE id = $1`, [R.pending])
})

await test('policy INSERT: ยิงคะแนนผูกคำขอตรงๆ ไม่ได้ทั้ง anon และผู้ล็อกอิน · แบบประเมินรวมยังส่งได้', async () => {
  await rejects(() => run('anon', `INSERT INTO public.satisfaction_ratings (municipality_id, rating, document_request_id) VALUES ($1, 5, $2)`, [MA, R.done]), '42501', 'anon ผูกคำขอ')
  await rejects(() => run('citizenA', `INSERT INTO public.satisfaction_ratings (municipality_id, rating, document_request_id, created_by) VALUES ($1, 5, $2, $3)`, [MA, R.done, U.citizenA]), '42501', 'เจ้าของผูกคำขอตรง')
  await run('anon', `INSERT INTO public.satisfaction_ratings (municipality_id, rating) VALUES ($1, 4)`, [MA])
})

await test('ผูกทั้งคำร้องและคำขอในแถวเดียวไม่ได้ (CHECK)', async () => {
  await rejects(() => db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, complaint_id, document_request_id) VALUES ($1, 3, $2, $3)`,
    [MA, id(999), R.done]), '23514', 'สองเรื่อง')
})

await test('rate_document_request: เหตุที่ประเมินไม่ได้ครบทุกแบบ (ไม่ RAISE คืน code)', async () => {
  await rejects(() => run('anon', 'SELECT public.rate_document_request($1, 5, NULL)', [R.done]), '42501', 'anon')
  assert.deepEqual(await rate('citizenA', R.done, 0), { ok: false, code: 'invalid_rating' })
  assert.deepEqual(await rate('citizenA', R.done, 6), { ok: false, code: 'invalid_rating' })
  assert.deepEqual(await rate('citizenA', id(998), 5), { ok: false, code: 'not_found' })
  assert.deepEqual(await rate('citizenB', R.done, 5), { ok: false, code: 'not_owner' })
  assert.deepEqual(await rate('officerA', R.done, 5), { ok: false, code: 'not_owner' }, 'เจ้าหน้าที่ให้คะแนนแทนไม่ได้')
  assert.deepEqual(await rate('citizenA', R.pending, 5), { ok: false, code: 'not_finished' })
  assert.deepEqual(await rate('citizenA', R.ptCancelled, 5), { ok: false, code: 'withdrawn' })
  assert.deepEqual(await rate('citizenA', R.borrowCancelled, 5), { ok: false, code: 'withdrawn' })
  assert.deepEqual(await rate('officerA', R.counter, 5), { ok: false, code: 'counter' }, 'ใบเคาน์เตอร์ (เจ้าหน้าที่เป็นเจ้าของแถว)')
  assert.deepEqual(await rate('councilA', R.council, 5), { ok: false, code: 'not_citizen' })
  // ใบเคาน์เตอร์ที่ช่อง channel หายไป ยังโดนด่าน role
  await db.query(`UPDATE public.document_requests SET permit_form_data = NULL WHERE id = $1`, [R.counter])
  assert.deepEqual(await rate('officerA', R.counter, 5), { ok: false, code: 'not_citizen' })
  const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM public.satisfaction_ratings WHERE document_request_id IS NOT NULL')
  assert.equal(n.n, 0)
})

await test('rate_document_request: เสร็จสิ้น + ไม่อนุมัติ ประเมินได้ ครั้งเดียว · แถว verified ผูกคำขอ · ความเห็นตัด 500 ตัว', async () => {
  assert.deepEqual(await rate('citizenA', R.done, 5, `  ${'ก'.repeat(600)}  `), { ok: true })
  assert.deepEqual(await rate('citizenA', R.done, 1), { ok: false, code: 'already_rated' })
  assert.deepEqual(await rate('citizenA', R.rejected, 2, '   '), { ok: true })
  assert.deepEqual(await rate('citizenA', R.legacy, 4), { ok: true }, 'ใบเก่าไม่มีเวลาปิด ยังกดประเมินได้')
  assert.deepEqual(await rate('citizenB', R.otherCitizen, 1, PII.comment), { ok: true })
  const { rows } = await db.query(`SELECT document_request_id, complaint_id, municipality_id, rating, is_verified, via_link, rated_by_proxy,
      created_by, length(comment) AS len FROM public.satisfaction_ratings WHERE document_request_id IN ($1, $2) ORDER BY rating DESC`, [R.done, R.rejected])
  assert.deepEqual(rows[0], { document_request_id: R.done, complaint_id: null, municipality_id: MA, rating: 5, is_verified: true,
    via_link: false, rated_by_proxy: false, created_by: U.citizenA, len: 500 })
  assert.equal(rows[1].len, null, 'ช่องว่างล้วน = ไม่มีความเห็น')
})

await test('my_document_request_ratings: เฉพาะคำขอที่ปิดแล้วของฉันใน อปท. นี้ · can_rate ถูกต้อง · ไม่คืนความเห็น', async () => {
  await rejects(() => run('anon', 'SELECT public.my_document_request_ratings($1)', [MA]), '42501', 'anon')
  const [{ r }] = await run('citizenA', 'SELECT public.my_document_request_ratings($1) AS r', [MA])
  const byId = Object.fromEntries(r.items.map(x => [x.id, x]))
  assert.deepEqual(Object.keys(byId).sort(), [R.done, R.rejected, R.ptCancelled, R.borrowCancelled, R.staffCancelled, R.borrowStaffCancelled, R.legacy].sort())
  assert.equal(byId[R.staffCancelled].can_rate, true, 'เจ้าหน้าที่ยกเลิก ≠ ผู้ยื่นถอนเอง → ชวนประเมินเหมือนใบไม่อนุมัติ')
  assert.equal(byId[R.borrowStaffCancelled].can_rate, true, 'ยืมพัสดุ: เจ้าหน้าที่ยกเลิก → ชวนประเมิน')
  // รวมบัญชีซ้ำแล้ว cancelled_by กลายเป็น NULL (FK SET NULL) → ยังนับเป็นถอนเองจากธง by_owner
  await db.query(`UPDATE public.patient_transport_requests SET cancelled_by = NULL WHERE request_id = $1`, [R.ptCancelled])
  const [{ r: r3 }] = await run('citizenA', 'SELECT public.my_document_request_ratings($1) AS r', [MA])
  assert.equal(r3.items.find(x => x.id === R.ptCancelled).can_rate, false, 'ถอนเองยังเป็นถอนเองหลังรวมบัญชี')
  assert.deepEqual([byId[R.done].rating, byId[R.done].can_rate], [5, false])
  assert.deepEqual([byId[R.rejected].rating, byId[R.rejected].can_rate], [2, false])
  assert.equal(byId[R.ptCancelled].can_rate, false)
  assert.equal(byId[R.borrowCancelled].can_rate, false)
  assert.equal(byId[R.legacy].finished_at, null)
  assert.ok(r.server_now)
  assert.ok(!JSON.stringify(r).includes('ก'.repeat(10)), 'ห้ามคืนความเห็น')
  // ยังไม่ได้ประเมิน → can_rate true
  await db.query(`UPDATE public.document_requests SET status = 'completed' WHERE id = $1`, [R.pending])
  const [{ r: r2 }] = await run('citizenA', 'SELECT public.my_document_request_ratings($1) AS r', [MA])
  const p = r2.items.find(x => x.id === R.pending)
  assert.deepEqual([p.rating, p.can_rate, typeof p.finished_at], [null, true, 'string'])
  await db.query(`UPDATE public.document_requests SET status = 'pending' WHERE id = $1`, [R.pending])
})

const overview = async (alias, muni) =>
  (await run(alias, 'SELECT public.executive_overview($1, (t0() - 30), t0(), $2::text[]) AS r', [muni, ['satisfaction']]))[0].r

await test('ห้องผู้บริหาร: eservice แยกเสร็จสิ้น/ไม่อนุมัติ · ไม่นับใบถอนเอง · นับใบที่ประเมินไม่ได้แยกกลุ่ม · ไม่ปนแบบประเมินรวม', async () => {
  const r = await overview('viewerA', MA)
  assert.equal(r.summaries.satisfaction.ok, true, JSON.stringify(r.summaries.satisfaction))
  const s = r.summaries.satisfaction.data
  const e = s.eservice
  // ปิดในช่วง (ไม่รวมถอนเอง 2 ใบ แต่รวมใบที่เจ้าหน้าที่ยกเลิก, ใบ legacy ไม่มีเวลาปิด, ใบ อปท. B): done, rejected, counter, noRequester, council, otherCitizen
  assert.equal(e.finished, 8)
  assert.equal(e.completed, 5)
  assert.equal(e.rejected, 3)
  assert.deepEqual(e.submitters, { citizen: 5, staff: 2, anonymous: 1 })   // counter ถูกล้าง channel ในเทสต์ก่อน → staff
  assert.equal(e.rateable, 5)
  assert.deepEqual(e.rated, { completed: { cnt: 2, sum: 6 }, rejected: { cnt: 1, sum: 2 } })
  assert.equal(e.low, 2)
  assert.equal(e.undated, 1)
  const res = e.by_type.find(x => x.t === 'residence_cert')
  assert.deepEqual(res, { t: 'residence_cert', finished: 5, rateable: 3, cnt: 3, sum: 8 })
  // แบบประเมินรวม: แถว anon 4 คะแนนแถวเดียว — คะแนนคำขอไม่ถูกนับรวม
  assert.deepEqual(s.general, { n: 1, sum: 4 })
  assert.equal(s.low.eservice, 2)
  assert.equal(s.low.general, undefined)
  // PDPA: ไม่มีชื่อผู้ยื่น/ความเห็น/id รายเรื่อง
  const txt = JSON.stringify(e)
  for (const bad of [PII.name, '0899999999', R.done, R.rejected]) assert.ok(!txt.includes(bad), `หลุด: ${bad}`)
})

await test('L2: ส่วน E-Service ล้มด้วย error อื่น → eservice = null แต่ส่วนคำร้อง/ภาพรวมยังมา · ล้มเพราะสิทธิ์ (42501) → ล้มทั้งก้อนเหมือนเดิม', async () => {
  const { rows: [orig] } = await db.query(`SELECT pg_get_functiondef('public.exec_satisfaction_eservice(uuid,date,date)'::regprocedure) AS d`)
  try {
    await db.exec(`CREATE OR REPLACE FUNCTION public.exec_satisfaction_eservice(_municipality_id uuid, _from date, _to date) RETURNS jsonb
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN (1 / 0)::text::jsonb; END $$`)
    const r = await overview('viewerA', MA)
    assert.equal(r.summaries.satisfaction.ok, true)
    assert.equal(r.summaries.satisfaction.data.eservice, null)
    assert.deepEqual(r.summaries.satisfaction.data.general, { n: 1, sum: 4 })
    await db.exec(`CREATE OR REPLACE FUNCTION public.exec_satisfaction_eservice(_municipality_id uuid, _from date, _to date) RETURNS jsonb
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$ BEGIN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END $$`)
    await rejects(() => overview('viewerA', MA), '42501', 'สิทธิ์ต้องปิดตาย')
  } finally {
    await db.exec(orig.d)
    await db.exec('REVOKE ALL ON FUNCTION public.exec_satisfaction_eservice(uuid, date, date) FROM PUBLIC, anon, authenticated')
  }
})

await test('ห้องผู้บริหาร: ประชาชนเรียกไม่ได้ · ข้าม อปท. ไม่ได้ · เรียกฟังก์ชันย่อยตรงไม่ได้', async () => {
  await rejects(() => overview('citizenA', MA), '42501', 'ประชาชน')
  await rejects(() => overview('viewerB', MA), '42501', 'ข้าม อปท.')
  await rejects(() => run('viewerA', 'SELECT public.exec_satisfaction_eservice($1, t0() - 30, t0())', [MA]), '42501', 'เรียกตรง')
})

await test('admin ลบคำขอ: คะแนนยังอยู่ (ลบเพื่อซ่อนคะแนนต่ำไม่ได้) และไม่กลายเป็น "แบบประเมินรวม"', async () => {
  await db.query('DELETE FROM public.document_requests WHERE id = $1', [R.otherCitizen])
  const { rows: [x] } = await db.query(`SELECT count(*)::int AS n FROM public.satisfaction_ratings
    WHERE document_request_id IS NULL AND complaint_id IS NULL AND is_verified AND rating = 1`)
  assert.equal(x.n, 1)
  const s = (await overview('viewerA', MA)).summaries.satisfaction.data
  assert.deepEqual(s.general, { n: 1, sum: 4 })
  assert.equal(s.low.general, undefined)
})

console.log(`\n${passed} กรณีผ่าน`)
