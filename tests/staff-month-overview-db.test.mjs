// หน้าแรกเจ้าหน้าที่ เฟส 2 — staff_month_overview() "ภาพรวมเดือนนี้" · รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   ในเครื่อง: node tests/staff-month-overview-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   CI: อ่าน path จาก env PATIENT_PGLITE_MODULE
// ฟังก์ชันตรวจกองของคำร้องตัดมาจาก migration ที่ production รันจริง (ไม่เขียนสำเนาเอง)
// ตัวเลขคาดหวังคิดมือจากข้อมูลด้านล่าง · M = วันที่ 1 ของเดือนนี้ (เวลาไทย) · T = วันนี้ (เวลาไทย)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const migration = await sqlFile('../supabase/migrations/20261129100000_staff_month_overview_rpc.sql')

function sliceFunction(source, startMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `missing ${startMarker}`)
  const bodyEnd = source.indexOf('$$;', source.indexOf('$$', start) + 2)
  assert.ok(bodyEnd > start, `missing end of ${startMarker}`)
  return source.slice(start, bodyEnd + 3)
}
const matchesMyDepartment = sliceFunction(
  await sqlFile('../supabase/migrations/150_complaint_pii_role_access.sql'),
  'create or replace function public.complaint_matches_my_department',
)
// ตัวเทียบ "สูตรเดียวกับห้องผู้บริหาร": ตัดฟังก์ชัน exec_summary_complaints ตัวจริงมาลงฐานเดียวกัน
// (ด่านสิทธิ์ exec_assert_viewer / ชื่อหมู่ exec_village_label เป็นตัวแทนเปล่า — ไม่ได้ทดสอบสองตัวนั้นที่นี่ มีเทสต์ของมันเองแล้ว)
const execSummaryComplaints = sliceFunction(
  await sqlFile('../supabase/migrations/20261115100100_exec_summary_service.sql'),
  'CREATE OR REPLACE FUNCTION public.exec_summary_complaints',
)

const schema = ({ withTimeline = true } = {}) => `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text, short_name text, code text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, municipality_id uuid, department_id uuid, full_name text);
CREATE TABLE public.complaint_categories (
  municipality_id uuid, value text, label text, is_adhoc boolean NOT NULL DEFAULT false,
  requires_manual_intake boolean NOT NULL DEFAULT false, UNIQUE (municipality_id, value)
);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY, municipality_id uuid, category text, status text, assigned_to uuid,
  department_id uuid, department text, due_date date, created_at timestamptz, closed_at timestamptz, resolved_by uuid,
  channel text, village text, parked_reason text,
  reporter_name text, phone text, ref_no text
);
${withTimeline ? 'CREATE TABLE public.complaint_timeline (complaint_id uuid, status text, created_at timestamptz);' : ''}
${matchesMyDepartment}
-- ค่าเริ่มต้นของ Supabase: ฟังก์ชันใหม่ใน public ได้ EXECUTE ให้ anon/authenticated อัตโนมัติ
-- ไม่ใส่บรรทัดนี้ เทสต์ "anon เรียกไม่ได้" จะผ่านลวง แม้ migration ลืม REVOKE จาก anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
`

const execStubs = `
CREATE FUNCTION public.exec_assert_viewer(_municipality_id uuid) RETURNS void LANGUAGE sql STABLE AS $$ SELECT $$;
CREATE FUNCTION public.exec_village_label(_municipality_id uuid, _village text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT '' $$;
${execSummaryComplaints}
`

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const T1 = id(1), T2 = id(2)
const WORKS = id(3), OFFICE = id(4)
const U = {
  head: id(10), otherHead: id(11), headNoDept: id(12), admin: id(13), adminOther: id(14), superadmin: id(15),
  staff: id(16), tech: id(17), viewer: id(18), council: id(19), citizen: id(20), headOtherMuni: id(21),
}

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

// ── ด่านตรวจคอลัมน์ ──
const guardDb = new PGlite()
await guardDb.exec(schema({ withTimeline: false }))
await test('migration หยุดเมื่อไม่มีตาราง complaint_timeline', async () => {
  await assert.rejects(() => guardDb.exec(migration), /ไม่พบคอลัมน์ .*complaint_timeline\./)
})
await guardDb.close()

const db = new PGlite()
await db.exec(schema())
await db.exec(migration)
await test('migration รันซ้ำแล้วหยุด (ไม่เขียนทับฟังก์ชันที่มีอยู่)', async () => {
  await assert.rejects(() => db.exec(migration), /มีฟังก์ชันชื่อนี้อยู่แล้ว/)
  await db.exec('ROLLBACK') // ไฟล์ห่อ BEGIN/COMMIT — ล้มกลางทางแล้วธุรกรรมค้าง (เหมือน SQL Editor ที่ต้องกดเริ่มใหม่)
})
await test('guard หยุดเมื่อมีชื่อเดียวกันคนละพารามิเตอร์ (overload)', async () => {
  const other = new PGlite()
  await other.exec(schema())
  await other.exec('CREATE FUNCTION public.staff_month_overview(p_x text) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$')
  await assert.rejects(() => other.exec(migration), /มีฟังก์ชันชื่อนี้อยู่แล้ว/)
  await other.close()
})
await db.exec(execStubs)

await test('สิทธิ์: anon เรียกไม่ได้ · authenticated เรียกได้ · SECURITY DEFINER + search_path ว่าง', async () => {
  const { rows } = await db.query(`SELECT
      has_function_privilege('anon', 'public.staff_month_overview(uuid)', 'EXECUTE') AS anon_x,
      has_function_privilege('authenticated', 'public.staff_month_overview(uuid)', 'EXECUTE') AS auth_x,
      p.prosecdef, p.proconfig
    FROM pg_proc p WHERE p.oid = 'public.staff_month_overview(uuid)'::regprocedure`)
  assert.equal(rows[0].anon_x, false)
  assert.equal(rows[0].auth_x, true)
  assert.equal(rows[0].prosecdef, true)
  assert.deepEqual(rows[0].proconfig, ['search_path=""'])
})

await db.query(`INSERT INTO public.departments VALUES ($1, $3, 'กองช่าง', 'ช่าง', 'works'), ($2, $3, 'สำนักปลัด', 'สป.', 'office')`, [WORKS, OFFICE, T1])
await db.query(`INSERT INTO public.profiles VALUES
  ($1,  'officer',    $13, $14, 'หัวหน้ากองช่าง'),
  ($2,  'officer',    $13, $15, 'หัวหน้าสำนักปลัด'),
  ($3,  'officer',    $13, NULL, 'หัวหน้าไม่มีกอง'),
  ($4,  'admin',      $13, NULL, 'แอดมิน'),
  ($5,  'admin',      $16, NULL, 'แอดมิน อปท.อื่น'),
  ($6,  'superadmin', NULL, NULL, 'superadmin'),
  ($7,  'staff',      $13, $14, 'เจ้าหน้าที่'),
  ($8,  'technician', $13, $14, 'ช่าง'),
  ($9,  'viewer',     $13, NULL, 'ผู้บริหาร'),
  ($10, 'council',    $13, $14, 'สภา'),
  ($11, 'citizen',    $13, NULL, 'ประชาชน'),
  ($12, 'officer',    $16, $14, 'หัวหน้า อปท.อื่นที่ชี้กองช่าง')`,
[U.head, U.otherHead, U.headNoDept, U.admin, U.adminOther, U.superadmin, U.staff, U.tech, U.viewer, U.council, U.citizen, U.headOtherMuni,
  T1, WORKS, OFFICE, T2])
await db.query(`INSERT INTO public.complaint_categories (municipality_id, value, label, is_adhoc, requires_manual_intake) VALUES
  ($1, 'road', 'ถนน', false, false), ($1, 'odor', 'กลิ่น', true, false), ($1, 'secret', 'ร้องเรียนเจ้าหน้าที่', false, true)`, [T1])

// เวลาอ้างอิงเวลาไทย: M = วันที่ 1 ของเดือน · T = วันนี้
const { rows: [ref] } = await db.query(`SELECT
  (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS t,
  date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')::date::text AS m`)
const T = ref.t, M = ref.m
// hour รับทศนิยม (0.5 = 00:30 น.) — แปลงเป็นนาทีก่อน ไม่ให้ ::int ปัดทิ้ง
const at = async (date, hour = 10) => (await db.query(`SELECT ($1::date + make_interval(mins => $2::int))::timestamp AT TIME ZONE 'Asia/Bangkok' AS ts`, [date, Math.round(hour * 60)])).rows[0].ts
const shift = async (date, days) => (await db.query(`SELECT ($1::date + $2::int)::text AS d`, [date, days])).rows[0].d
const beforeMonth = await shift(M, -5)    // เดือนก่อน
const beforeMonth2 = await shift(M, -20)
const pastDue = await shift(T, -1)        // เลยกำหนดแล้ว (อาจตกเดือนก่อนถ้าวันนี้วันที่ 1 — ไม่มีผลกับตัวเลข เพราะนับ due < T อย่างเดียว)
const future = await shift(T, 3)

let seq = 100
const complaint = async ({ muni = T1, category = 'road', status, dept = WORKS, deptText = null, due = null, created, closed = null, resolvedBy = null, timelineDone = null }) => {
  const cid = id(seq++)
  await db.query(
    `INSERT INTO public.complaints (id, municipality_id, category, status, assigned_to, department_id, department, due_date,
       created_at, closed_at, resolved_by, channel, village, reporter_name, phone, ref_no)
     VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, 'citizen_online', 'หมู่ 1', 'นายลับ ผู้ร้อง', '0812345678', 'REF-SECRET')`,
    [cid, muni, category, status, dept, deptText, due, created, closed, resolvedBy])
  if (timelineDone) await db.query(`INSERT INTO public.complaint_timeline VALUES ($1, 'done', $2)`, [cid, timelineDone])
  return cid
}

// กองช่าง (WORKS) — ขอบเขตของหัวหน้ากองช่าง
// 1) แจ้งเดือนนี้ เสร็จเดือนนี้ ทันกำหนด (กดปุ่มดำเนินการ = closed_at)
await complaint({ status: 'closed', due: future, created: await at(M, 9), closed: await at(M, 15), resolvedBy: U.staff })
// 2) แจ้งเดือนก่อน เสร็จเดือนนี้ เลยกำหนด (timeline done ก่อน closed_at → ใช้วัน timeline)
await complaint({ status: 'completed', due: beforeMonth, created: await at(beforeMonth2), closed: await at(T, 16), timelineDone: await at(M, 11) })
// 3) แจ้งเดือนนี้ เสร็จเดือนนี้ ไม่มีกำหนด
await complaint({ status: 'done', due: null, created: await at(M, 8), closed: await at(M, 12), resolvedBy: U.tech })
// 4) ค้าง received เลยกำหนด (แจ้งเดือนก่อน)
await complaint({ status: 'received', due: pastDue, created: await at(beforeMonth2) })
// 5) ค้าง in_progress ยังไม่ถึงกำหนด (แจ้งเดือนนี้) — department_id ว่าง ตรงด้วยข้อความ "ช่าง"
await complaint({ status: 'in_progress', dept: null, deptText: 'ช่าง', due: future, created: await at(M, 10) })
// 6) pending แจ้งเดือนนี้ เลยกำหนด → นับ open_now แต่ไม่นับ open_past_due (ยังไม่รับเรื่อง)
await complaint({ status: 'pending', due: pastDue, created: await at(M, 7) })
// 7) rejected แจ้งเดือนนี้ → นับ received อย่างเดียว
await complaint({ status: 'rejected', due: null, created: await at(M, 6) })
// 8) parked → ไม่นับค้าง/เลยกำหนด (แจ้งเดือนก่อน)
await complaint({ status: 'parked', due: pastDue, created: await at(beforeMonth2) })
// 9) ปิดไปตั้งแต่เดือนก่อน → ไม่นับอะไรเลย
await complaint({ status: 'closed', due: beforeMonth, created: await at(beforeMonth2), closed: await at(beforeMonth), resolvedBy: U.staff })
// 10) หมวดเฉพาะกิจ + 11) หมวดอ่อนไหว → ไม่ปน
await complaint({ category: 'odor', status: 'received', due: pastDue, created: await at(M, 9) })
await complaint({ category: 'secret', status: 'received', due: pastDue, created: await at(M, 9) })
// ขอบเวลาไทย (session TimeZone ไม่ใช่เวลาไทยก็ต้องได้ผลเดียวกัน — ดูเทสต์วนเขตเวลาด้านล่าง)
//   12) แจ้งวันที่ M 00:30 น. (= 17:30 UTC ของวันก่อน) → ต้องนับ received
await complaint({ status: 'rejected', due: null, created: await at(M, 0.5) })
//   13) แจ้ง M−1 23:30 น. → ไม่นับ received
await complaint({ status: 'rejected', due: null, created: await at(await shift(M, -1), 23.5) })
//   14) ปิด M 00:30 น. → นับ completed (ไม่มีกำหนด) · 15) ปิด M−1 23:30 น. → ไม่นับ
await complaint({ status: 'closed', due: null, created: await at(beforeMonth2), closed: await at(M, 0.5), resolvedBy: U.staff })
await complaint({ status: 'closed', due: null, created: await at(beforeMonth2), closed: await at(await shift(M, -1), 23.5), resolvedBy: U.staff })

//   16) ไม่ได้กดปุ่มดำเนินการ (resolved_by ว่าง) · timeline "done" เดือนก่อน แต่ closed_at เดือนนี้
//       → วันเสร็จ = วันใน timeline (เดือนก่อน) ต้องไม่นับ completed — ถ้าสูตรใช้ closed_at ตรงๆ จะนับเกิน 1
await complaint({ status: 'completed', due: beforeMonth, created: await at(beforeMonth2), closed: await at(M, 10), timelineDone: await at(beforeMonth, 9) })

// สำนักปลัด (OFFICE) — นับเฉพาะขอบเขตทั้ง อปท.
await complaint({ status: 'received', dept: OFFICE, due: pastDue, created: await at(M, 9) })
await complaint({ status: 'closed', dept: OFFICE, due: future, created: await at(M, 9), closed: await at(M, 13), resolvedBy: U.staff })
// ข้อความกองไม่ตรงกับ department_id: department_id ชนะเสมอ (หัวหน้ากองช่างต้องไม่เห็นแม้ข้อความเขียนว่า "ช่าง")
await complaint({ status: 'received', dept: OFFICE, deptText: 'ช่าง', due: pastDue, created: await at(M, 9) })
// department_id ว่าง + ข้อความเป็นชื่อย่อ "สป." → หัวหน้าสำนักปลัดเห็นผ่าน short_name
await complaint({ status: 'in_progress', dept: null, deptText: 'สป.', due: future, created: await at(M, 9) })
// คนละ อปท. → ไม่ปน
await complaint({ muni: T2, status: 'received', due: pastDue, created: await at(M, 9) })

const call = async (uid, muni = T1) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${uid ?? ''}', false);`)
  try {
    const { rows } = await db.query('SELECT public.staff_month_overview($1) AS r', [muni])
    return rows[0].r
  } finally {
    await db.exec('RESET ROLE;')
  }
}

// ใบ 1–3 + 5–7 แจ้งเดือนนี้ = 6 · ถ้าวันนี้เป็นวันที่ 1 ใบ 2/4/8/9 ก็ยังเป็นเดือนก่อน (สร้างที่ M−20) ตัวเลขจึงคงที่ทุกวัน
const DEPT_EXPECT = {
  received: 6, // 1, 3, 5, 6, 7, 12
  completed: 4, on_time: 1, late: 1, no_due: 2, // 1 ทัน · 2 เลย (timeline วันที่ M > due เดือนก่อน) · 3, 14 ไม่มีกำหนด
  open_past_due: 1, // 4
  open_now: 3, // 4, 5, 6
}
const OFFICE_EXPECT = { received: 4, completed: 1, on_time: 1, late: 0, no_due: 0, open_past_due: 2, open_now: 3 }
const ON_TIME_KEYS = ['completed', 'on_time', 'late', 'no_due', 'open_past_due']

await test('หัวหน้ากอง: เห็นเฉพาะกองตัวเอง (รวมคำร้องที่ตรงกองด้วยข้อความ) ตัวเลขตรงที่คิดมือ', async () => {
  const r = await call(U.head)
  assert.equal(r.scope, 'department')
  assert.equal(r.department_name, 'กองช่าง')
  assert.equal(r.month_start, M)
  assert.equal(r.today, T)
  for (const [k, v] of Object.entries(DEPT_EXPECT)) assert.equal(r[k], v, k)
})

await test('หัวหน้ากองอื่น: เห็นแค่กองตัวเอง (สำนักปลัด) รวมข้อความ "ช่าง" ที่ department_id เป็นสำนักปลัด และ "สป." ที่ไม่มี department_id', async () => {
  const r = await call(U.otherHead)
  assert.equal(r.department_name, 'สำนักปลัด')
  for (const [k, v] of Object.entries(OFFICE_EXPECT)) assert.equal(r[k], v, k)
})

const ADMIN_EXPECT = Object.fromEntries(Object.keys(DEPT_EXPECT).map(k => [k, DEPT_EXPECT[k] + OFFICE_EXPECT[k]]))
await test('admin: ทั้ง อปท. (กองช่าง + สำนักปลัด) ไม่ปนหมวดเฉพาะกิจ/อ่อนไหว/อปท.อื่น', async () => {
  const r = await call(U.admin)
  assert.equal(r.scope, 'municipality')
  assert.equal(r.department_name, null)
  for (const [k, v] of Object.entries(ADMIN_EXPECT)) assert.equal(r[k], v, k)
})

await test('สูตรเดียวกับห้องผู้บริหาร: ตัวเลขตรงเวลาของ admin = exec_summary_complaints(อปท., M, T).on_time', async () => {
  const r = await call(U.admin)
  await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${U.admin}', false);`)
  try {
    const { rows } = await db.query(`SELECT public.exec_summary_complaints($1, $2::date, $3::date) -> 'on_time' AS e`, [T1, M, T])
    for (const k of ON_TIME_KEYS) assert.equal(r[k], rows[0].e[k], k)
  } finally {
    await db.exec('RESET ROLE;')
  }
})

await test('ผลไม่ขึ้นกับ TimeZone ของ session (UTC / เวลาไทย / ลอสแอนเจลิส)', async () => {
  const results = []
  for (const tz of ['UTC', 'Asia/Bangkok', 'America/Los_Angeles']) {
    await db.query(`SET TIME ZONE '${tz}'`)
    results.push(await call(U.head), await call(U.admin))
  }
  await db.query('SET TIME ZONE DEFAULT')
  for (const r of results.filter((_, i) => i % 2 === 0)) assert.deepEqual(r, results[0])
  for (const r of results.filter((_, i) => i % 2 === 1)) assert.deepEqual(r, results[1])
  for (const [k, v] of Object.entries(DEPT_EXPECT)) assert.equal(results[0][k], v, k)
})

await test('superadmin: ดู อปท. ใดก็ได้', async () => {
  const r1 = await call(U.superadmin, T1)
  assert.equal(r1.received, ADMIN_EXPECT.received)
  const r2 = await call(U.superadmin, T2)
  assert.equal(r2.open_now, 1)
  assert.equal(r2.open_past_due, 1)
})

const denied = async (label, uid, muni = T1) => test(label, async () => {
  await assert.rejects(() => call(uid, muni), (e) => e.code === '42501' && /ไม่มีสิทธิ์ดูภาพรวมเดือนนี้/.test(e.message))
})
await denied('ปฏิเสธ: staff', U.staff)
await denied('ปฏิเสธ: technician', U.tech)
await denied('ปฏิเสธ: viewer (มีห้องผู้บริหารแล้ว)', U.viewer)
await denied('ปฏิเสธ: council ที่สังกัดกอง', U.council)
await denied('ปฏิเสธ: citizen', U.citizen)
await denied('ปฏิเสธ: หัวหน้าที่ไม่มีกอง', U.headNoDept)
await denied('ปฏิเสธ: admin ข้าม อปท.', U.adminOther, T1)
await denied('ปฏิเสธ: หัวหน้ากอง อปท.อื่นขอข้อมูล อปท.นี้', U.headOtherMuni, T1)
await denied('ปฏิเสธ: ไม่ได้ล็อกอิน (uid ว่าง)', null)
await test('ปฏิเสธ: p_muni เป็น NULL', async () => {
  await assert.rejects(() => call(U.admin, null), (e) => e.code === '42501')
})

await test('ไม่มีข้อมูลผู้ร้องหลุดในผลลัพธ์', async () => {
  for (const uid of [U.head, U.admin, U.superadmin]) {
    const text = JSON.stringify(await call(uid))
    for (const secret of ['นายลับ', '0812345678', 'REF-SECRET']) assert.ok(!text.includes(secret), `${secret} หลุด`)
    assert.deepEqual(Object.keys(await call(uid)).sort(),
      ['completed', 'department_name', 'late', 'month_start', 'no_due', 'on_time', 'open_now', 'open_past_due', 'received', 'scope', 'today'])
  }
})

await db.close()
console.log(`\nstaff-month-overview-db: ผ่าน ${cases} ข้อ`)
