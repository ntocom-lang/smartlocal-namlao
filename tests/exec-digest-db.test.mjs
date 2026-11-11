// ห้องผู้บริหาร E3-3 — สรุปเช้า / แจ้งคะแนนต่ำ / รอลงนามเกิน 2 วันทำการ · รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   ไฟล์ที่รัน: E2 20261115100000/100100 + E3-2 20261117100000/100100 + working_days 20260927220000
//               แล้ว E3-3 20261118100000 (หมวด dm_muted) + 20261118100100 (ฟังก์ชันสรุปเช้า) — ไฟล์ cron 100200 ไม่รัน (ไม่มี pg_cron/vault ใน PGlite)
//   ในเครื่อง: node tests/exec-digest-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   หรือ npm run test:exec-digest:db (ต้องมี env PATIENT_PGLITE_MODULE หรือแก้ path ด้านบน) · ไม่อยู่ใน CI
// ตารางจำลองมีเฉพาะคอลัมน์ที่ฟังก์ชันอ่าน + คอลัมน์ข้อมูลส่วนบุคคลปลอม เพื่อตรวจว่า "ไม่หลุดออกมา"
// ตรวจ: ผู้รับ (viewer/ปลัด ไม่รวม admin/superadmin/ข้าม อปท.) · คำนวณในนามผู้รับแล้วคืน claims เดิม · ผู้ใช้เรียกตรง = 42501
//       ack จดสถานะที่แจ้งไป ไม่แจ้งซ้ำ · คะแนนต่ำไม่คืนความเห็น/เลขที่ของหมวดอ่อนไหว · set_my_telegram_dm_muted รับหมวดใหม่
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
  '20261120100000_exec_overdue_items_owner.sql',
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
CREATE TABLE public.positions (id uuid PRIMARY KEY, category text, name text, municipality_id uuid);
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
  status text, created_at timestamptz, issued_at timestamptz, due_date date, department_id uuid, created_by_uid uuid, requester_name text, assigned_to uuid);
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
INSERT INTO public.positions VALUES ('${P_TOP}', 'top_admin', 'ปลัดเทศบาล', '${MA}'), ('${P_HEAD}', 'dept_head', 'ผู้อำนวยการกองช่าง', '${MA}');
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

// ───────── E3-3 smoke ─────────
const T1 = id(3001), T2 = id(3002), SIG = id(3101)
await db.exec(`
ALTER TABLE public.municipalities ADD COLUMN name text, ADD COLUMN is_active boolean DEFAULT true;
UPDATE public.municipalities SET name = slug || ' (ทดสอบ)', is_active = true;
ALTER TABLE public.satisfaction_ratings ADD COLUMN id uuid DEFAULT gen_random_uuid();
CREATE TABLE public.telegram_user_links (user_id uuid PRIMARY KEY, chat_id bigint NOT NULL, dm_muted text[] NOT NULL DEFAULT '{}');
ALTER TABLE public.telegram_user_links ADD CONSTRAINT telegram_user_links_dm_muted_check CHECK (dm_muted <@ ARRAY['complaint','event','esign']::text[]);
CREATE FUNCTION public.set_my_telegram_dm_muted(p_muted text[]) RETURNS text[] LANGUAGE sql AS $$ SELECT p_muted $$;
CREATE TABLE public.fleet_trips (id uuid PRIMARY KEY, municipality_id uuid, created_at timestamptz, updated_at timestamptz);
CREATE TABLE public.esign_signatures (id uuid PRIMARY KEY, doc_type text, doc_id uuid, signed_at timestamptz);
CREATE TABLE public.esign_revocations (signature_id uuid, revoked_at timestamptz);
CREATE TABLE public.esign_trip_returns (doc_type text, doc_id uuid, created_at timestamptz);
CREATE TABLE public.public_holidays (id uuid DEFAULT gen_random_uuid(), municipality_id uuid, holiday_date date, name text, is_working_day boolean DEFAULT false, note text);
CREATE UNIQUE INDEX ON public.public_holidays (holiday_date) WHERE municipality_id IS NULL;
CREATE TABLE public.esign_queue_stub (user_id uuid, trip_id uuid, slot text);
CREATE FUNCTION public.esign_my_pending() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN jsonb_build_object('ok', false) ELSE
    jsonb_build_object('ok', true, 'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('trip_id', q.trip_id, 'slot', q.slot,
      'requester_name', 'ชื่อผู้ขอปลอม', 'destination', 'ปลายทางลับ')) FROM public.esign_queue_stub q WHERE q.user_id = auth.uid()), '[]')) END $$;
CREATE FUNCTION public.list_events_for_staff(uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb WHERE false $$;
CREATE TABLE public.events_stub (user_id uuid, title text, event_time text);
CREATE FUNCTION public.list_events_for_staff_between(p_municipality_id uuid, p_from date, p_to date) RETURNS SETOF jsonb
  LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('title', e.title, 'event_date', p_from, 'end_date', NULL, 'event_time', e.event_time)
  FROM public.events_stub e WHERE e.user_id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.list_events_for_staff_between(uuid,date,date) TO authenticated;
`)
await db.exec(await migration('20260927220000_add_working_days_fn.sql'))
for (const f of ['20261118100000_exec_digest_dm_categories.sql', '20261118100100_exec_digest_functions.sql']) {
  try { await db.exec(await migration(f)) } catch (e) { throw new Error(`apply ${f} ไม่ผ่าน: ${e.message}`) }
}
console.log('apply ผ่านทั้ง 2 ไฟล์')

await db.exec(`
INSERT INTO public.telegram_user_links VALUES ('${U.viewerA}', 11, '{}'), ('${U.paladA}', 12, '{}'), ('${U.adminA}', 13, '{}'),
  ('${U.headA}', 14, '{}'), ('${U.superadmin}', 15, '{}'), ('${U.viewerB}', 16, '{}');
INSERT INTO public.fleet_trips VALUES ('${T1}', '${MA}', ts(20), ts(20)), ('${T2}', '${MA}', ts(0), ts(0));
INSERT INTO public.esign_signatures VALUES ('${SIG}', 'fleet_trip_request', '${T1}', ts(10));
INSERT INTO public.esign_queue_stub VALUES ('${U.viewerA}', '${T1}', 'authority'), ('${U.viewerA}', '${T2}', 'authority');
INSERT INTO public.events_stub VALUES ('${U.viewerA}', 'ประชุมสภา', '09:00'), ('${U.paladA}', 'รายการปลัด', '10:00');
INSERT INTO public.complaints (id, municipality_id, ref_no, status, created_at, due_date, department_id, category)
  VALUES ('${C(20)}', '${MA}', 'CR-0020', 'received', ts(30), dt(20), '${D1}', 'road');
INSERT INTO public.satisfaction_ratings (municipality_id, complaint_id, rating, is_verified, created_at, comment) VALUES
  ('${MA}', '${C(5)}', 1, true, now() - interval '1 hour', 'ความเห็นลับ'),
  ('${MA}', '${C(4)}', 2, false, now() - interval '2 hour', 'ร้องเรียนลับ'),
  ('${MA}', NULL, 1, false, now(), 'ภาพรวม'),
  ('${MA}', '${C(5)}', 1, true, now() - interval '9 days', 'เก่าเกิน');
`)

async function rows(alias, sql, params = []) {
  await as(alias)
  try { return (await db.query(sql, params)).rows } finally { await db.exec('RESET ROLE') }
}
async function rejects2(fn, code, label) {
  try { await fn() } catch (e) { assert.equal(e.code, code, `${label}: ได้ ${e.code} ${e.message}`); return }
  assert.fail(`${label}: ต้องล้ม`)
}

const r1 = await call('viewerA', `SELECT public.exec_my_esign_waiting('${MA}') AS r`)
console.log('esign waiting (นายก):', JSON.stringify(r1))
assert.equal(r1.count, 2); assert.equal(r1.over_2wd, 1)
assert.ok(!JSON.stringify(r1).includes('ปลอม') && !JSON.stringify(r1).includes('ลับ'))

const rec = await rows('service_role', `SELECT * FROM public.exec_digest_recipients('exec_digest')`)
console.log('ผู้รับ:', rec.map((r) => `${r.slug}:${Object.keys(U).find((k) => U[k] === r.user_id)}:${r.is_working_day}`).join(', '))
assert.deepEqual(rec.map((r) => r.user_id).sort(), [U.viewerA, U.paladA, U.viewerB].sort())

await call('viewerA', `SELECT public.exec_follow('${MA}', 'complaint', '${C(1)}') AS r`)
await call('viewerA', `SELECT public.exec_follow('${MA}', 'complaint', '${C(7)}') AS r`)
await call('viewerA', `SELECT public.exec_follow('${MA}', 'complaint', '${C(20)}') AS r`)
await db.exec(`UPDATE public.complaints SET category = 'corrupt', status = 'closed' WHERE id = '${C(20)}'`)
await db.exec(`UPDATE public.complaints SET status = 'completed' WHERE id = '${C(1)}'; UPDATE public.complaints SET status = 'received' WHERE id = '${C(7)}';`)

// ผู้รับผิดชอบ (20261120100000) อยู่ในหน้าเว็บเท่านั้น — สรุปเช้าเลือกคีย์เอง ชื่อเจ้าหน้าที่ต้องไม่ไหลไป Telegram
await db.exec(`INSERT INTO public.complaints (id, municipality_id, ref_no, status, created_at, due_date, department_id, category)
  VALUES ('${C(21)}', '${MA}', 'CR-0021', 'in_progress', ts(40), dt(20), '${D1}', 'road');`)  // เลยมาเกิน 5 วันทำการ = อยู่ใน top
await db.exec(`UPDATE public.complaints SET assigned_to = '${U.headA}' WHERE municipality_id = '${MA}'; UPDATE public.document_requests SET assigned_to = '${U.headA}' WHERE municipality_id = '${MA}';`)
const d = await call('service_role', `SELECT public.exec_digest_for('${U.viewerA}', '${MA}') AS r`)
console.log('digest:', JSON.stringify(d, null, 1))
const after = await db.query(`SELECT current_setting('request.jwt.claim.sub', true) AS s, current_setting('request.jwt.claims', true) AS c`)
console.log('claims หลังเรียก (ต้องว่าง):', JSON.stringify(after.rows[0]))
assert.equal(d.ok, true)
assert.equal(d.esign.over_2wd, 1)
assert.equal(d.events.items.length, 1, 'เห็นเฉพาะกิจกรรมของผู้รับ')
assert.ok(!JSON.stringify(d).includes('สมชาย') && !JSON.stringify(d).includes('0812345678'))
assert.ok(d.overdue.top.length > 0, 'ต้องมีเรื่องเลยกำหนดในสรุป ไม่งั้นด่านชื่อผู้รับผิดชอบข้างล่างผ่านลวง')
assert.ok(!/ผอ\.กองช่างปลอม|"owner/.test(JSON.stringify(d)), 'ชื่อ/คีย์ผู้รับผิดชอบต้องไม่อยู่ในสรุปเช้า')
assert.equal(d.follows.items.length, 2)

const na = await call('service_role', `SELECT public.exec_digest_for('${U.adminA}', '${MA}') AS r`)
assert.equal(na.reason, 'not_eligible')
const nb = await call('service_role', `SELECT public.exec_digest_for('${U.viewerB}', '${MA}') AS r`)
assert.equal(nb.reason, 'not_eligible')
await rejects2(() => call('viewerA', `SELECT public.exec_digest_for('${U.viewerA}', '${MA}') AS r`), '42501', 'ผู้ใช้เรียกตรง')

const n = await call('service_role', `SELECT public.exec_digest_ack('${U.viewerA}', '${MA}', $1::jsonb) AS r`, [JSON.stringify(d.ack)])
assert.equal(n, 3, 'ack รวม hidden_done')
assert.ok(!JSON.stringify(d.follows).includes('CR-0020'), 'hidden ไม่ขึ้นข้อความ')
const fl = await db.query(`SELECT item_id, last_seen_status, ended_reason FROM public.exec_follows ORDER BY item_id`)
console.log('follows หลัง ack:', JSON.stringify(fl.rows))
const d2 = await call('service_role', `SELECT public.exec_digest_for('${U.viewerA}', '${MA}') AS r`)
assert.equal(d2.follows.items.length, 0, 'แจ้งแล้วไม่แจ้งซ้ำ')

const low = await rows('service_role', `SELECT * FROM public.exec_low_ratings_pending(now() - interval '30 days')`)
console.log('คะแนนต่ำ:', JSON.stringify(low))
assert.equal(low.length, 2)
assert.ok(low.some((r) => r.sensitive && r.ref === null && r.cat_label === null))
assert.ok(!JSON.stringify(low).includes('ลับ'))

await call('viewerA', `SELECT public.set_my_telegram_dm_muted(ARRAY['exec_digest','bogus']) AS r`)
const rec2 = await rows('service_role', `SELECT user_id FROM public.exec_digest_recipients('exec_digest')`)
assert.ok(!rec2.some((r) => r.user_id === U.viewerA), 'ปิดหมวดแล้วไม่ได้รับ')
console.log('exec-digest-db: ผ่านทั้งหมด')
