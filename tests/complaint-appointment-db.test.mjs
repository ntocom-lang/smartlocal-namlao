// งาน 1.1 (E1) คำร้องแบบนัดหมาย + ภาพก่อน-หลังในหน้า /t/ —
//   supabase/migrations/20261202100000_complaint_appointment_columns.sql + 20261202100100_complaint_appointment_functions.sql
//   ในเครื่อง: node tests/complaint-appointment-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   CI: อ่าน path จาก env PATIENT_PGLITE_MODULE (workflow patient-module-tests ติดตั้ง PGlite 0.5.8 ไว้แล้ว)
// รัน migration จริงใน PostgreSQL จำลอง (PGlite) ต่อจาก migration ลิงก์ติดตามเรื่องตัวจริง ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//
// สิ่งที่ต้องไม่พัง: (1) วันนัดเขียนตรงไม่ได้ ต้องผ่าน set_complaint_appointment เท่านั้น (2) คนนอกกอง/อปท. อื่น/ประชาชนนัดไม่ได้
// (3) วันหยุดต้องถามยืนยันก่อน · ย้อนหลัง/เกิน 180 วันไม่ได้ · ไม่แตะ status/due_date (4) ทุกการเปลี่ยนวันนัดมีแถวไทม์ไลน์
// (5) ผู้ถือลิงก์ไม่เห็นข้อมูลส่วนบุคคล และคีย์เดิมของ get_complaint_by_track_token อยู่ครบ
// (6) รูปใน /t/: หมวดอ่อนไหว/เฉพาะกิจ/ทุจริต/ถูกปฏิเสธ = ไม่มีรูปเสมอ · รูปหลังเฉพาะเมื่อเสร็จ
// (7) สิทธิ์: RPC นัด = authenticated · ตัวช่วยภายในไม่เปิดให้ anon/authenticated
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const extractFunction = (source, startPattern) => {
  const found = startPattern.exec(source)
  assert.ok(found, `ไม่พบฟังก์ชันที่ขึ้นต้นด้วย ${startPattern}`)
  const rest = source.slice(found.index)
  const end = rest.search(/\n\$\$;/)
  assert.ok(end > 0, 'ไม่พบ $$; ปิดฟังก์ชัน')
  return rest.slice(0, end + 4)
}

const rateLimitSql = await readMigration('20260905170000_rpc_rate_limit.sql')
const rateComplaintSrc = await readMigration('20260830150000_rate_complaint_rpc.sql')
const finishSrc = await readMigration('20260915110100_complaint_finish_by_assignee.sql')
const trackColumnSql = await readMigration('20261020160000_complaint_track_token_column.sql')
const trackFunctionsSql = await readMigration('20261020160100_complaint_track_token_functions.sql')
const columnsSql = await readMigration('20261202100000_complaint_appointment_columns.sql')
const functionsSql = await readMigration('20261202100100_complaint_appointment_functions.sql')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const DRIVE = id => `https://umxssfahtuprnztlytdd.supabase.co/functions/v1/drive-file?id=${id}`
const GDRIVE = id => `https://drive.google.com/uc?id=${id}`
const fid = n => `FILEID${String(n).padStart(6, '0')}abc`

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
-- เหมือน Supabase: มี JWT = 'authenticated' · ไม่มี = 'anon' · test.authrole = 'none' จำลองงานหลังบ้าน (auth.role() IS NULL)
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN current_setting('test.authrole', true) = 'none' THEN NULL
              WHEN NULLIF(current_setting('test.uid', true), '') IS NULL THEN 'anon' ELSE 'authenticated' END
$$;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, role text, municipality_id uuid, department text);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.role', true), '') $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.muni', true), '')::uuid $$;
-- ตัวแทน complaint_matches_my_department(): กองของผู้เรียกตรงกับข้อความ department ของคำร้อง
CREATE FUNCTION public.complaint_matches_my_department(p_department text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(p_department, '') <> '' AND p_department = NULLIF(current_setting('test.dept', true), '')
$$;
CREATE TABLE public.complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, value text, label text,
  is_active boolean DEFAULT true, sort_order int DEFAULT 0, is_adhoc boolean NOT NULL DEFAULT false,
  requires_manual_intake boolean NOT NULL DEFAULT false
);
CREATE FUNCTION public.complaint_category_is_adhoc(p_municipality_id uuid, p_category text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT cc.is_adhoc FROM public.complaint_categories cc WHERE cc.municipality_id = p_municipality_id AND cc.value = p_category), false)
$$;
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, user_id uuid, ref_no text,
  category text, category_id uuid, status text DEFAULT 'pending', village text, detail text, phone text, reporter_name text,
  latitude double precision, longitude double precision, assigned_to uuid, department text, due_date date, closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), technician_note text, rejection_reason text,
  extra_data jsonb, resolved_latitude double precision, resolved_longitude double precision, resolved_by uuid,
  rating smallint, rated_at timestamptz, work_photos jsonb, attachments text[]
);
CREATE TABLE public.complaint_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  status text NOT NULL, note text, actor_name text, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.satisfaction_ratings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, municipality_id uuid, rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text, created_at timestamptz DEFAULT now(),
  complaint_id uuid REFERENCES public.complaints(id) ON DELETE SET NULL,
  is_verified boolean NOT NULL DEFAULT false, created_by uuid
);
CREATE UNIQUE INDEX satisfaction_ratings_complaint_once ON public.satisfaction_ratings (complaint_id, is_verified);
CREATE TABLE public.public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, holiday_date date NOT NULL,
  name text NOT NULL, is_working_day boolean NOT NULL DEFAULT false
);
INSERT INTO public.municipalities VALUES ('${A}', 'อปท. เอ'), ('${B}', 'อปท. บี');
INSERT INTO public.complaint_categories (municipality_id, value, label, is_adhoc, requires_manual_intake) VALUES
  ('${A}', 'suction', '🚽 ดูดสิ่งปฏิกูล', false, false),
  ('${A}', 'tree', '🌳 ตัดต้นไม้', false, false),
  ('${A}', 'odor', 'กลิ่นเหม็นรบกวน', true, false),
  ('${A}', 'nuisance', 'เหตุรำคาญ', false, true),
  ('${A}', 'corruption', 'ทุจริต', false, false),
  ('${B}', 'suction', 'ดูดสิ่งปฏิกูล (บี)', false, false);
`)
await db.exec(rateLimitSql)
await db.exec(extractFunction(rateComplaintSrc, /create or replace function public\.rate_complaint\(/i))
await db.exec(extractFunction(finishSrc, /CREATE OR REPLACE FUNCTION public\.reopen_complaint\(/))
await db.exec(extractFunction(finishSrc, /CREATE OR REPLACE FUNCTION public\.complaint_worker_can_act\(/))
await db.exec(trackColumnSql)
await db.exec(trackFunctionsSql)

// คีย์ของ get_complaint_by_track_token ก่อน migration นี้ — หลังรันต้องอยู่ครบ (เขียนทับทั้งฟังก์ชัน NOTES.md ข้อ 5)
const users = { admin: U(1), officer: U(2), officerOther: U(3), staff: U(4), citizen: U(5), adminB: U(6), superadmin: U(7), assignee: U(8) }
const roleOf = { admin: 'admin', officer: 'officer', officerOther: 'officer', staff: 'staff', citizen: 'citizen', adminB: 'admin', superadmin: 'superadmin', assignee: 'technician' }
const muniOf = alias => (alias === 'adminB' ? B : alias === 'superadmin' ? null : A)
const deptOf = { officer: 'กองช่าง', officerOther: 'กองคลัง', staff: 'กองช่าง' }
for (const [alias, id] of Object.entries(users)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [id])
  await db.query('INSERT INTO public.profiles VALUES ($1, $2, $3, $4, $5)', [id, `ผู้ใช้ ${alias}`, roleOf[alias], muniOf(alias), deptOf[alias] ?? null])
}
const as = async alias => {
  const anon = alias === 'anon'
  const backend = alias === 'backend'
  await db.query(`SELECT set_config('test.uid', $1, false), set_config('test.role', $2, false), set_config('test.muni', $3, false),
                         set_config('test.dept', $4, false), set_config('test.authrole', $5, false), set_config('request.headers', '', false)`,
    [anon || backend ? '' : users[alias], anon || backend ? '' : roleOf[alias], anon || backend ? '' : (muniOf(alias) ?? ''),
      deptOf[alias] ?? '', backend ? 'none' : ''])
}

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}
const expectError = async (promise, code) => {
  await assert.rejects(promise, error => { assert.equal(error.code, code, `รหัสผิด: ${error.code} / ${error.message}`); return true })
}

const MARK_DETAIL = 'ลับ-รายละเอียด-บ้านเลขที่-99/9'
const MARK_PHONE = '0812345678'
const MARK_NAME = 'นายลับ ใจดี'
const MARK_ACTOR = 'ผู้ใช้ officer'

let refSeq = 0
const make = async ({ muni = A, owner = null, status = 'received', category = 'suction', department = 'กองช่าง', due = 5, extra = null, work = null, attach = null } = {}) => {
  await as('backend')
  const { rows } = await db.query(
    `INSERT INTO public.complaints (municipality_id, user_id, ref_no, category, status, village, detail, phone, reporter_name,
        latitude, longitude, department, due_date, extra_data, work_photos, attachments)
     VALUES ($1, $2, $3, $4, $5, 'หมู่ 3', $6, $7, $8, 18.25, 100.34, $9, (now() AT TIME ZONE 'Asia/Bangkok')::date + $10::int, $11, $12, $13)
     RETURNING id, track_token`,
    [muni, owner ? users[owner] : null, `ES-69-${String(++refSeq).padStart(4, '0')}`, category, status, MARK_DETAIL, MARK_PHONE, MARK_NAME,
      department, due, extra ? JSON.stringify(extra) : null, work ? JSON.stringify(work) : null, attach])
  return { id: rows[0].id, token: rows[0].track_token }
}
const setAppt = (id, date, slot = 'morning', note = null, allowOff = false) =>
  db.query('SELECT public.set_complaint_appointment($1, $2::date, $3, $4, $5) AS r', [id, date, slot, note, allowOff]).then(r => r.rows[0].r)
const view = (token, muni = A) => db.query('SELECT public.get_complaint_by_track_token($1, $2) AS r', [token, muni]).then(r => r.rows[0].r)
const row = async id => (await db.query('SELECT * FROM public.complaints WHERE id = $1', [id])).rows[0]
const timeline = async id => (await db.query(`SELECT status, note, actor_name FROM public.complaint_timeline WHERE complaint_id = $1 AND status LIKE 'appointment%' ORDER BY created_at`, [id])).rows

// วันอ้างอิงตามเวลาไทย (ฟังก์ชันใช้ now() AT TIME ZONE 'Asia/Bangkok')
const today = (await db.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS d`)).rows[0].d
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dow = iso => new Date(iso + 'T00:00:00Z').getUTCDay() // 0 = อาทิตย์
const nextWeekday = (from, skip = 0) => { let d = from; let found = -1; while (true) { d = addDays(d, 1); if (dow(d) !== 0 && dow(d) !== 6 && ++found >= skip) return d } }
const nextSaturday = from => { let d = addDays(from, 1); while (dow(d) !== 6) d = addDays(d, 1); return d }
const W1 = nextWeekday(today, 0)
const W2 = nextWeekday(today, 1)
const W3 = nextWeekday(today, 2)
const HOL = nextWeekday(today, 3)
const SAT = nextSaturday(today)

// คีย์เดิมก่อน migration นี้ (สร้างตัวอย่างก่อนรัน migration ใหม่)
const legacy = await make()
await as('anon')
const legacyKeys = Object.keys(await view(legacy.token)).sort()

await as('backend')
await db.exec(columnsSql)
await db.exec(functionsSql)
await db.query(`INSERT INTO public.public_holidays (municipality_id, holiday_date, name, is_working_day) VALUES (NULL, $1, 'วันหยุดทดสอบ', false)`, [HOL])

await test('คีย์เดิมของ get_complaint_by_track_token อยู่ครบทุกตัว + คีย์ใหม่ครบ', async () => {
  await as('anon')
  const keys = Object.keys(await view(legacy.token))
  for (const k of legacyKeys) assert.ok(keys.includes(k), `คีย์เดิมหาย: ${k}`)
  for (const k of ['requires_appointment', 'appointment', 'preferred_date', 'fee', 'photos']) assert.ok(keys.includes(k), `ไม่มีคีย์ใหม่: ${k}`)
})

await test('ค่าเริ่มต้นหลังรัน: ทุกหมวดยังไม่เปิดนัด · ไม่มีอัตรา · รูปแบบ after', async () => {
  const { rows } = await db.query(`SELECT bool_or(requires_appointment) AS appt, max(jsonb_array_length(fee_rates)) AS fee, array_agg(DISTINCT track_photos) AS mode FROM public.complaint_categories`)
  assert.deepEqual(rows[0], { appt: false, fee: 0, mode: ['after'] })
})

await test('เขียนวันนัดตรงไม่ได้ ทั้งตอนยื่นและตอนแก้ (ต้องผ่าน set_complaint_appointment)', async () => {
  const c = await make({ owner: 'citizen' })
  for (const alias of ['citizen', 'officer', 'admin', 'anon']) {
    await as(alias)
    await expectError(db.query(`UPDATE public.complaints SET appointment_date = $2, appointment_slot = 'morning' WHERE id = $1`, [c.id, W1]), '42501')
    await expectError(db.query(`UPDATE public.complaints SET appointment_note = 'x' WHERE id = $1`, [c.id]), '42501')
    await expectError(db.query(`INSERT INTO public.complaints (municipality_id, category, appointment_date, appointment_slot) VALUES ($1, 'suction', $2, 'morning')`, [A, W1]), '42501')
  }
  await as('officer')
  await db.query(`UPDATE public.complaints SET status = 'in_progress' WHERE id = $1`, [c.id]) // คอลัมน์อื่นแก้ได้ตามเดิม
  assert.equal((await row(c.id)).status, 'in_progress')
})

await test('ใครนัดได้: แอดมิน/กองที่ถือเรื่อง/ผู้รับมอบ/superadmin ได้ · ประชาชน/กองอื่น/อปท. อื่น/ไม่ล็อกอินไม่ได้', async () => {
  for (const [alias, ok] of [['admin', true], ['officer', true], ['superadmin', true],
    ['citizen', false], ['officerOther', false], ['adminB', false], ['staff', false]]) {
    const c = await make()
    await as(alias)
    if (ok) assert.equal((await setAppt(c.id, W1)).ok, true, alias)
    else await expectError(setAppt(c.id, W1), '42501')
  }
  const c = await make()
  await as('backend')
  await db.query('UPDATE public.complaints SET assigned_to = $2 WHERE id = $1', [c.id, users.assignee])
  await as('assignee')
  assert.equal((await setAppt(c.id, W1)).ok, true, 'ผู้รับมอบหมาย')
  await as('anon')
  await expectError(setAppt(c.id, W1), '42501')
})

await test('ตรวจวันที่: ย้อนหลัง/เกิน 180 วัน/ช่วงเวลาผิด = ปฏิเสธ · วันนี้ได้', async () => {
  const c = await make()
  await as('officer')
  await expectError(setAppt(c.id, addDays(today, -1)), '22023')
  await expectError(setAppt(c.id, addDays(today, 181)), '22023')
  await expectError(setAppt(c.id, W1, 'evening'), '22023')
  await expectError(setAppt(c.id, W1, 'morning', 'ก'.repeat(301)), '22023')
  // วันนี้อาจเป็นวันหยุด — อนุญาตวันหยุดไว้เพื่อทดสอบเฉพาะขอบล่าง
  assert.equal((await setAppt(c.id, today, 'allday', null, true)).ok, true)
})

await test('วันหยุด (เสาร์-อาทิตย์ / public_holidays) ต้องยืนยันก่อน · แถวของ อปท. ทับแถวทั่วประเทศ', async () => {
  const c = await make()
  await as('officer')
  assert.deepEqual(await setAppt(c.id, SAT), { ok: false, code: 'off_day' })
  assert.deepEqual(await setAppt(c.id, HOL), { ok: false, code: 'off_day' })
  assert.equal((await row(c.id)).appointment_date, null, 'off_day ต้องไม่บันทึก')
  assert.equal((await setAppt(c.id, SAT, 'morning', null, true)).ok, true)
  await as('backend')
  await db.query(`INSERT INTO public.public_holidays (municipality_id, holiday_date, name, is_working_day) VALUES ($1, $2, 'เปิดทำการ', true)`, [A, HOL])
  const d = await make()
  await as('officer')
  assert.equal((await setAppt(d.id, HOL)).ok, true, 'อปท. ตั้งเป็นวันทำงานแล้ว')
  await as('backend')
  await db.query(`DELETE FROM public.public_holidays WHERE municipality_id = $1`, [A])
})

await test('ไทม์ไลน์: ตั้ง 1 แถว · ซ้ำเดิมไม่เพิ่ม · แก้แค่ข้อความไม่เพิ่ม · เลื่อน = แถวใหม่ "เลื่อนจาก" · ยกเลิก = appointment_cleared', async () => {
  const c = await make()
  await as('officer')
  const first = await setAppt(c.id, W1, 'morning', 'โปรดเปิดประตูรั้ว')
  assert.equal(first.changed, true)
  assert.equal(first.rescheduled, false)
  assert.equal((await setAppt(c.id, W1, 'morning', 'โปรดเปิดประตูรั้ว')).changed, false)
  assert.equal((await setAppt(c.id, W1, 'morning', 'เจ้าหน้าที่จะโทรก่อนเข้า')).changed, true)
  assert.equal((await row(c.id)).appointment_note, 'เจ้าหน้าที่จะโทรก่อนเข้า')
  const moved = await setAppt(c.id, W2, 'afternoon')
  assert.equal(moved.rescheduled, true)
  assert.equal((await setAppt(c.id, null, null, 'ผู้แจ้งขอยกเลิก')).cleared, true)
  assert.equal((await setAppt(c.id, null)).changed, false, 'ยกเลิกซ้ำไม่เพิ่มแถว')
  const t = await timeline(c.id)
  assert.deepEqual(t.map(r => r.status), ['appointment', 'appointment', 'appointment_cleared'])
  assert.match(t[0].note, /^นัดเข้าดำเนินการ \d{1,2} \S+ 25\d\d ช่วงเช้า$/)
  assert.match(t[1].note, /ช่วงบ่าย \(เลื่อนจาก \d{1,2} \S+ 25\d\d\)$/)
  assert.match(t[2].note, /^ยกเลิกนัด .+ — ผู้แจ้งขอยกเลิก$/)
  assert.ok(t.every(r => r.actor_name === MARK_ACTOR))
  const r = await row(c.id)
  assert.equal(r.appointment_date, null)
  assert.equal(r.appointment_slot, null)
  assert.equal(r.appointment_set_by, users.officer)
})

await test('ไม่แตะ status/due_date · นัดหลังกำหนดคืน after_due · เรื่องจบแล้ว/หมวดเฉพาะกิจนัดไม่ได้', async () => {
  const c = await make({ due: 1 })
  const before = await row(c.id)
  await as('officer')
  const res = await setAppt(c.id, W3)
  assert.equal(res.after_due, W3 > addDays(today, 1))
  const after = await row(c.id)
  assert.equal(after.status, before.status)
  assert.equal(String(after.due_date), String(before.due_date))
  for (const status of ['closed', 'completed', 'rejected', 'parked']) {
    const d = await make({ status })
    await as('officer')
    await expectError(setAppt(d.id, W1), '22023')
  }
  const odor = await make({ category: 'odor' })
  await as('admin')
  await expectError(setAppt(odor.id, W1), '22023')
})

await test('/t/: เห็นวันนัด/วันที่เสนอ/อัตรา แต่ไม่เห็นข้อมูลส่วนบุคคล · วันที่เสนอรูปแบบผิดถูกทิ้ง', async () => {
  await as('backend')
  await db.query(`UPDATE public.complaint_categories SET requires_appointment = true,
                    fee_rates = '[{"item":"ดูดสิ่งปฏิกูล","unit":"ลูกบาศก์เมตร","rate":250},{"item":"ค่าเดินทางนอกเขต","unit":"เที่ยว","rate":0,"note":"ตามระยะทาง"}]',
                    fee_reference = 'ข้อบัญญัติทดสอบ' WHERE municipality_id = $1 AND value = 'suction'`, [A])
  const c = await make({ extra: { preferred_date: W2 } })
  await as('anon')
  let v = await view(c.token)
  assert.equal(v.requires_appointment, true)
  assert.equal(v.appointment, null)
  assert.equal(v.preferred_date, W2)
  assert.equal(v.fee.rates.length, 2)
  assert.equal(v.fee.reference, 'ข้อบัญญัติทดสอบ')

  await as('officer')
  await setAppt(c.id, W1, 'allday', 'โปรดเปิดประตูรั้ว')
  await as('anon')
  v = await view(c.token)
  assert.deepEqual({ ...v.appointment, date: String(v.appointment.date) }, { date: W1, slot: 'allday', note: 'โปรดเปิดประตูรั้ว', after_due: false, past: false })
  assert.equal(v.preferred_date, null, 'มีวันนัดจริงแล้วไม่ต้องโชว์วันที่เสนอ')
  const text = JSON.stringify(v)
  for (const mark of [MARK_DETAIL, MARK_PHONE, MARK_NAME, MARK_ACTOR, c.id, users.officer]) assert.ok(!text.includes(mark), `หลุด: ${mark}`)

  await as('backend')
  await db.query(`UPDATE public.complaints SET status = 'closed', closed_at = now() WHERE id = $1`, [c.id])
  await as('anon')
  assert.equal((await view(c.token)).appointment, null, 'เรื่องจบแล้วไม่โชว์วันนัด')

  const bad = await make({ extra: { preferred_date: 'พรุ่งนี้<script>' } })
  await as('anon')
  assert.equal((await view(bad.token)).preferred_date, null)
  const impossible = await make({ extra: { preferred_date: '2026-13-45' } })
  await as('anon')
  assert.equal((await view(impossible.token)).preferred_date, null, 'วันที่ไม่มีจริงต้องถูกทิ้ง ไม่ทำให้ฟังก์ชันล้ม')
  const tree = await make({ category: 'tree' })
  await as('anon')
  const t = await view(tree.token)
  assert.equal(t.requires_appointment, false)
  assert.equal(t.fee, null)
})

await test('รูป /t/ แบบ after: ยังไม่เสร็จ = ไม่มี · เสร็จ = รูปผลงาน ≤4 ไม่ซ้ำ เรียงตามที่แนบ · รูปผู้แจ้งไม่มา · URL Storage รุ่นเก่าถูกข้าม', async () => {
  const work = [DRIVE(fid(1)), GDRIVE(fid(2)), DRIVE(fid(1)), 'https://x.supabase.co/storage/v1/object/public/complaint-attachments/a/b.jpg', DRIVE(fid(3)), DRIVE(fid(4)), DRIVE(fid(5))]
  const c = await make({ work, attach: [DRIVE(fid(9))] })
  await as('anon')
  assert.deepEqual((await view(c.token)).photos, { after: [], before: [] })
  await as('backend')
  await db.query(`UPDATE public.complaints SET status = 'completed', closed_at = now() WHERE id = $1`, [c.id])
  await as('anon')
  assert.deepEqual((await view(c.token)).photos, { after: [fid(1), fid(2), fid(3), fid(4)], before: [] })
  await as('backend')
  // เปิดเรื่องใหม่ = รูปหลังหายจากหน้า /t/ ทันที
  await db.query(`UPDATE public.complaints SET status = 'in_progress', closed_at = NULL WHERE id = $1`, [c.id])
  await as('anon')
  assert.deepEqual((await view(c.token)).photos, { after: [], before: [] })
})

await test('รูป /t/ แบบ both: รูปผู้แจ้งมาด้วยแม้ยังไม่เสร็จ · none = ไม่มีเลย', async () => {
  await as('backend')
  await db.query(`UPDATE public.complaint_categories SET track_photos = 'both' WHERE municipality_id = $1 AND value = 'tree'`, [A])
  const c = await make({ category: 'tree', work: [DRIVE(fid(11))], attach: [DRIVE(fid(12)), GDRIVE(fid(13))] })
  await as('anon')
  assert.deepEqual((await view(c.token)).photos, { after: [], before: [fid(12), fid(13)] })
  await as('backend')
  await db.query(`UPDATE public.complaints SET status = 'closed', closed_at = now() WHERE id = $1`, [c.id])
  await as('anon')
  assert.deepEqual((await view(c.token)).photos, { after: [fid(11)], before: [fid(12), fid(13)] })
  await as('backend')
  await db.query(`UPDATE public.complaint_categories SET track_photos = 'none' WHERE municipality_id = $1 AND value = 'tree'`, [A])
  await as('anon')
  assert.deepEqual((await view(c.token)).photos, { after: [], before: [] })
  await as('backend')
})

await test('หมวดอ่อนไหว/เฉพาะกิจ/ทุจริต และเรื่องที่ถูกปฏิเสธ ไม่มีรูปเสมอ แม้ตั้ง both', async () => {
  await as('backend')
  await db.query(`UPDATE public.complaint_categories SET track_photos = 'both' WHERE municipality_id = $1`, [A])
  for (const [category, status] of [['nuisance', 'closed'], ['odor', 'closed'], ['corruption', 'closed'], ['suction', 'rejected']]) {
    const c = await make({ category, status, work: [DRIVE(fid(21))], attach: [DRIVE(fid(22))] })
    await as('anon')
    assert.deepEqual((await view(c.token)).photos, { after: [], before: [] }, category + '/' + status)
    await as('backend')
  }
})

await test('ตารางอัตราผิดรูปแบบ / track_photos ผิดค่า ถูก CHECK ปฏิเสธ', async () => {
  await as('backend')
  const set = rates => db.query(`UPDATE public.complaint_categories SET fee_rates = $2::jsonb WHERE municipality_id = $1 AND value = 'tree'`, [A, rates])
  for (const bad of [
    '{"item":"x"}',
    '[{"item":"ดูด","unit":"เที่ยว","rate":"250"}]',
    '[{"item":"ดูด","unit":"เที่ยว","rate":-1}]',
    '[{"item":"","unit":"เที่ยว","rate":1}]',
    '[{"item":"ดูด","unit":"เที่ยว","rate":1,"extra":true}]',
    '[{"item":"ดูด","unit":"เที่ยว","rate":1,"note":5}]',
    JSON.stringify(Array.from({ length: 21 }, () => ({ item: 'ก', unit: 'ข', rate: 1 }))),
  ]) await expectError(set(bad), '23514')
  await set('[{"item":"ตัดกิ่งไม้","unit":"ต้น","rate":0,"note":null}]')
  await expectError(db.query(`UPDATE public.complaint_categories SET track_photos = 'all' WHERE municipality_id = $1`, [A]), '23514')
})

await test('สิทธิ์ฟังก์ชัน: RPC นัด = authenticated · ตัวช่วยภายในปิด', async () => {
  const can = (role, sig) => db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig]).then(r => r.rows[0].ok)
  assert.equal(await can('authenticated', 'public.set_complaint_appointment(uuid, date, text, text, boolean)'), true)
  assert.equal(await can('anon', 'public.set_complaint_appointment(uuid, date, text, text, boolean)'), false)
  assert.equal(await can('anon', 'public.get_complaint_by_track_token(text, uuid)'), true)
  for (const sig of ['public.complaint_track_photos(public.complaints)', 'public.complaint_is_off_day(date, uuid)',
    'public.complaint_thai_date(date)', 'public.complaint_photo_drive_id(text)', 'public.guard_complaint_appointment()']) {
    assert.equal(await can('anon', sig), false, sig)
    assert.equal(await can('authenticated', sig), false, sig)
  }
})

await test('สถานะ new นัดได้ · พักเรื่อง (parked) แล้วหน้า /t/ ไม่โชว์วันนัดเดิม', async () => {
  const c = await make({ status: 'new' })
  await as('officer')
  assert.equal((await setAppt(c.id, W1)).ok, true)
  await as('anon')
  assert.equal(String((await view(c.token)).appointment.date), W1)
  await as('backend')
  await db.query(`UPDATE public.complaints SET status = 'parked' WHERE id = $1`, [c.id])
  await as('anon')
  assert.equal((await view(c.token)).appointment, null)
})

await test('ลบบัญชีเจ้าหน้าที่ที่เคยตั้งนัดได้ (appointment_set_by ไม่ผูก FK — กันชน trigger กันเขียนตรง)', async () => {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.complaints'::regclass AND contype = 'f'
    AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.complaints'::regclass AND attname = 'appointment_set_by')]`)
  assert.equal(rows[0].n, 0)
  const c = await make()
  await as('officer')
  await setAppt(c.id, W1)
  await as('admin')
  await db.query('DELETE FROM public.profiles WHERE id = $1', [users.officer])
  await db.query('DELETE FROM auth.users WHERE id = $1', [users.officer])
  const { rows: kept } = await db.query(`SELECT to_char(appointment_date, 'YYYY-MM-DD') AS d FROM public.complaints WHERE id = $1`, [c.id])
  assert.equal(kept[0].d, W1, 'วันนัดยังอยู่')
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
