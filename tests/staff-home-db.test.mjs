// รัน migration จริง 2 ไฟล์ของหน้าแรกเจ้าหน้าที่ใน PostgreSQL จำลอง (PGlite 0.5.8)
//   20261012130000_staff_home_summary_rpc.sql   — งานของฉัน (กำหนดเสร็จ + กิจกรรมที่มอบหมาย)
//   20261012130100_staff_dept_workload_rpc.sql  — ภาระงานรายคนของหัวหน้ากอง
// node tests/staff-home-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//
// ฟังก์ชันตรวจกอง/หมวดเฉพาะกิจถูกตัดมาจาก migration ที่ production รันจริง (ไม่เขียนสำเนาเอง)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const summaryMigration = await sqlFile('../supabase/migrations/20261012130000_staff_home_summary_rpc.sql')
const workloadMigration = await sqlFile('../supabase/migrations/20261012130100_staff_dept_workload_rpc.sql')

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
const categoryIsAdhoc = sliceFunction(
  await sqlFile('../supabase/migrations/20260827120000_restrict_odor_adhoc_visibility.sql'),
  'CREATE OR REPLACE FUNCTION public.complaint_category_is_adhoc',
)

const schema = ({ withAssignments = true } = {}) => `
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
  municipality_id uuid, value text, is_adhoc boolean NOT NULL DEFAULT false, UNIQUE (municipality_id, value)
);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY, municipality_id uuid, category text, status text, assigned_to uuid,
  department_id uuid, department text, due_date date,
  -- คอลัมน์ผู้ร้อง: ใส่ค่าที่ต้องไม่หลุดออกไปกับผลลัพธ์ทั้งสองฟังก์ชัน
  reporter_name text, phone text, ref_no text
);
CREATE TABLE public.events (
  id uuid PRIMARY KEY, municipality_id uuid, title text, event_date date, event_time time, end_date date, location text
);
${withAssignments ? 'CREATE TABLE public.event_assignments (event_id uuid, profile_id uuid, task text);' : ''}
${categoryIsAdhoc}
${matchesMyDepartment}
`

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const T1 = id(1), T2 = id(2)
const WORKS = id(3), OFFICE = id(4)
const U = {
  tech: id(10), staff: id(11), head: id(12), otherHead: id(13), admin: id(14), viewer: id(15),
  council: id(16), citizen: id(17), superadmin: id(18), headNoDept: id(19), staff2: id(20),
  otherMuniStaff: id(21), noName: id(22), adminInDept: id(23), viewerInDept: id(24), councilInDept: id(25),
}

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

// ── ด่านตรวจคอลัมน์: ไม่มีตาราง event_assignments ต้องหยุด (ไม่ใช่พังตอนเรียก) ──
const guardDb = new PGlite()
await guardDb.exec(schema({ withAssignments: false }))
await test('migration 1 หยุดเมื่อยังไม่มี event_assignments (ต้อง apply ไฟล์มอบหมายก่อน)', async () => {
  await assert.rejects(() => guardDb.exec(summaryMigration), /ไม่พบคอลัมน์ .*event_assignments\./)
})
await guardDb.close()

const db = new PGlite()
await db.exec(schema())
await db.exec(summaryMigration)
await db.exec(workloadMigration)
await test('migration รันซ้ำได้ (CREATE OR REPLACE)', async () => {
  await db.exec(summaryMigration)
  await db.exec(workloadMigration)
})

await db.query(`INSERT INTO public.departments VALUES ($1, $3, 'กองช่าง', 'ช่าง', 'works'), ($2, $3, 'สำนักปลัด', 'สป.', 'office')`, [WORKS, OFFICE, T1])
await db.query(`INSERT INTO public.profiles VALUES
  ($1,  'technician', $14, $15, '[TEST] ช่างไฟฟ้า'),
  ($2,  'staff',      $14, $15, '[TEST] เจ้าหน้าที่กองช่าง'),
  ($3,  'officer',    $14, $15, '[TEST] หัวหน้ากองช่าง'),
  ($4,  'officer',    $14, $16, '[TEST] หัวหน้าสำนักปลัด'),
  ($5,  'admin',      $14, NULL, '[TEST] แอดมิน'),
  ($6,  'viewer',     $14, NULL, '[TEST] ผู้บริหาร'),
  ($7,  'council',    $14, NULL, '[TEST] สมาชิกสภา'),
  ($8,  'citizen',    $14, NULL, '[TEST] ประชาชน'),
  ($9,  'superadmin', NULL, NULL, '[TEST] superadmin'),
  ($10, 'officer',    $14, NULL, '[TEST] หัวหน้าไม่มีกอง'),
  ($11, 'staff',      $14, $15, '[TEST] เจ้าหน้าที่ว่างงาน'),
  ($12, 'staff',      $17, NULL, '[TEST] เจ้าหน้าที่ อปท.อื่น'),
  ($13, 'staff',      $14, $15, '   '),
  ($18, 'admin',      $14, $15, '[TEST] แอดมินที่สังกัดกองช่าง'),
  ($19, 'viewer',     $14, $15, '[TEST] ผู้บริหารที่สังกัดกองช่าง'),
  ($20, 'council',    $14, $15, '[TEST] สภาที่สังกัดกองช่าง')`,
[U.tech, U.staff, U.head, U.otherHead, U.admin, U.viewer, U.council, U.citizen, U.superadmin, U.headNoDept, U.staff2, U.otherMuniStaff, U.noName,
  T1, WORKS, OFFICE, T2, U.adminInDept, U.viewerInDept, U.councilInDept])
await db.query(`INSERT INTO public.complaint_categories VALUES ($1, 'road', false), ($1, 'odor', true)`, [T1])

let seq = 100
const complaint = async ({ muni = T1, category = 'road', status, to = null, dept = WORKS, deptText = null, due = null }) => {
  await db.query(
    `INSERT INTO public.complaints VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'นายลับ ผู้ร้อง', '0812345678', 'REF-SECRET')`,
    [id(seq++), muni, category, status, to, dept, deptText, due])
}
// ชุดข้อมูล: staff ถือ 4 ใบ (ใบเลยกำหนด 1, ครบวันนี้ 1, พรุ่งนี้ 1, ไม่มีกำหนด 1) + 1 ใบเสร็จแล้ว + 1 ใบ pending
const today = (await db.query("SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS d")).rows[0].d.toISOString().slice(0, 10)
const shift = async (days) => (await db.query(`SELECT ($1::date + $2::int)::text AS d`, [today, days])).rows[0].d
const yesterday = await shift(-1), tomorrow = await shift(1), nextWeek = await shift(7)

await complaint({ status: 'received', to: U.staff, due: yesterday })
await complaint({ status: 'in_progress', to: U.staff, due: today })
await complaint({ status: 'received', to: U.staff, due: tomorrow })
await complaint({ status: 'in_progress', to: U.staff, due: null })
await complaint({ status: 'closed', to: U.staff, due: yesterday })           // เสร็จแล้ว ต้องไม่นับ
await complaint({ status: 'pending', to: U.staff, due: yesterday })          // ยังกดเริ่มไม่ได้ ต้องไม่นับในงานของฉัน
await complaint({ status: 'received', to: U.tech, due: nextWeek })           // ของคนอื่น
await complaint({ status: 'received', to: U.tech, due: yesterday })
await complaint({ status: 'received', to: null, due: tomorrow })             // ยังไม่มอบหมาย (กองช่าง)
await complaint({ status: 'pending', to: null, due: tomorrow })              // ยังไม่มอบหมาย + pending
await complaint({ status: 'in_progress', to: null, due: tomorrow })          // มีคนทำแต่ assigned ว่าง → ไม่นับว่ารอมอบหมาย
await complaint({ status: 'received', to: null, dept: null, deptText: 'กองช่าง', due: tomorrow }) // department_id ว่าง ตรงด้วยข้อความ
await complaint({ status: 'received', to: null, dept: OFFICE, due: tomorrow }) // กองอื่น
await complaint({ category: 'odor', status: 'received', to: null, due: tomorrow }) // หมวดเฉพาะกิจ ต้องไม่ปน
await complaint({ muni: T2, status: 'received', to: U.staff, due: yesterday })     // คนละ อปท. ต้องไม่ปน

const asUser = async (uid) => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('test.uid', $1, false)", [uid ?? ''])
  await db.exec(`SET ROLE ${uid ? 'authenticated' : 'anon'}`)
}
const summary = async (uid, muni = T1) => { await asUser(uid); return (await db.query('SELECT public.staff_home_summary($1) AS v', [muni])).rows[0].v }
const workload = async (uid, muni = T1) => { await asUser(uid); return (await db.query('SELECT public.staff_dept_workload($1) AS v', [muni])).rows[0].v }
const rejects = async (p, re, label) => { await assert.rejects(p, re, label); await db.exec('RESET ROLE') }

// ───────────────────────────── staff_home_summary ─────────────────────────────
await test('งานของฉัน: นับเฉพาะ received/in_progress ที่มอบหมายให้ตัวเอง จัดกลุ่มตามกำหนดเสร็จ', async () => {
  const v = await summary(U.staff)
  const byDue = Object.fromEntries(v.complaint_due.map(r => [r.due ?? 'none', r.n]))
  assert.deepEqual(byDue, { [yesterday]: 1, [today]: 1, [tomorrow]: 1, none: 1 })
  assert.equal(v.complaint_due.reduce((s, r) => s + r.n, 0), 4, 'closed/pending/ของอปท.อื่นต้องไม่ถูกนับ')
  assert.equal(v.today, today, 'วันนี้ต้องมาจากเวลาไทยของฐานข้อมูล')
})

await test('งานของฉัน: ไม่เห็นงานของคนอื่น (ช่างเห็นแค่ 2 ใบของตัวเอง)', async () => {
  const v = await summary(U.tech)
  assert.equal(v.complaint_due.reduce((s, r) => s + r.n, 0), 2)
})

await test('งานของฉัน: คนที่ไม่มีงานได้ลิสต์ว่าง ไม่ใช่ error', async () => {
  const v = await summary(U.staff2)
  assert.deepEqual(v.complaint_due, [])
  assert.deepEqual(v.my_events, [])
})

await db.exec('RESET ROLE')
const ev = (n) => id(900 + n)
await db.query(`INSERT INTO public.events VALUES
  ($1, $9, 'TEST ประชุมวันนี้',   $2::date, '09:00', NULL,        'ห้องประชุม'),
  ($3, $9, 'TEST ประชุมพรุ่งนี้', $4::date, NULL,    NULL,        NULL),
  ($5, $9, 'TEST งานเมื่อวานจบแล้ว', $6::date, '10:00', NULL,     NULL),
  ($7, $9, 'TEST งานหลายวันที่ยังจัดอยู่', $6::date, '08:00', $2::date, NULL),
  ($8, $9, 'TEST งานอีกสัปดาห์', $10::date, NULL, NULL, NULL)`,
[ev(1), today, ev(2), tomorrow, ev(3), yesterday, ev(4), ev(5), T1, nextWeek])
await db.query(`INSERT INTO public.events VALUES ($1, $2, 'TEST กิจกรรม อปท.อื่น', $3::date, NULL, NULL, NULL)`, [ev(6), T2, today])
await db.query(`INSERT INTO public.event_assignments VALUES
  ($1, $7, 'attend'), ($2, $7, 'preside'), ($3, $7, 'join'), ($4, $7, 'attend'), ($5, $7, 'join'), ($6, $7, 'attend'),
  ($1, $8, 'join')`,
[ev(1), ev(2), ev(3), ev(4), ev(5), ev(6), U.staff, U.tech])

await test('กิจกรรมที่มอบหมาย: วันนี้-พรุ่งนี้ + งานหลายวันที่คาบเกี่ยว · ตัดงานจบไปแล้ว/อีกสัปดาห์/อปท.อื่น', async () => {
  const v = await summary(U.staff)
  assert.deepEqual(v.my_events.map(e => e.title), ['TEST งานหลายวันที่ยังจัดอยู่', 'TEST ประชุมวันนี้', 'TEST ประชุมพรุ่งนี้'])
  const first = v.my_events.find(e => e.title === 'TEST ประชุมวันนี้')
  assert.equal(first.task, 'attend')
  assert.equal(first.location, 'ห้องประชุม')
})

await test('กิจกรรมที่มอบหมาย: เห็นเฉพาะที่มอบหมายให้ตัวเอง', async () => {
  const v = await summary(U.tech)
  assert.deepEqual(v.my_events.map(e => e.title), ['TEST ประชุมวันนี้'])
})

await test('สิทธิ์: ประชาชน/ไม่ล็อกอิน/คนละ อปท./id ว่าง ถูกปฏิเสธ · superadmin ผ่าน', async () => {
  await rejects(summary(U.citizen), /42501|ไม่มีสิทธิ์/, 'citizen')
  await rejects(summary(null), /permission denied|42501/, 'anon ไม่มี EXECUTE')
  await rejects(summary(U.otherMuniStaff, T1), /ไม่มีสิทธิ์/, 'คนละ อปท.')
  await rejects(summary(U.staff, T2), /ไม่มีสิทธิ์/, 'ขอ อปท. ที่ไม่ใช่ของตัวเอง')
  await rejects(summary(U.staff, null), /ไม่มีสิทธิ์/, 'p_muni ว่าง')
  await rejects(summary(id(777)), /ไม่มีสิทธิ์/, 'ไม่มีโปรไฟล์')
  assert.ok((await summary(U.superadmin)).complaint_due, 'superadmin ข้าม อปท. ได้')
  for (const role of ['admin', 'viewer', 'council', 'officer']) {
    const uid = { admin: U.admin, viewer: U.viewer, council: U.council, officer: U.head }[role]
    assert.ok((await summary(uid)).complaint_due, `${role} ต้องเรียกได้`)
  }
})

await test('PDPA: ผลลัพธ์ไม่มีชื่อผู้ร้อง เบอร์ หรือเลขคำร้องหลุดออกไป', async () => {
  const text = JSON.stringify(await summary(U.staff)) + JSON.stringify(await workload(U.head))
  for (const secret of ['นายลับ', '0812345678', 'REF-SECRET']) assert.ok(!text.includes(secret), `หลุด ${secret}`)
})

// ───────────────────────────── staff_dept_workload ─────────────────────────────
await test('ภาระรายคน: นับถูกต่อคน (ถือ/ยังไม่เริ่ม/เลยกำหนด) และเรียงตามชื่อ', async () => {
  const v = await workload(U.head)
  assert.equal(v.department_name, 'กองช่าง')
  assert.equal(v.today, today)
  const by = Object.fromEntries(v.members.map(m => [m.name ?? '(ไม่มีชื่อ)', m]))
  // staff: received(เลยกำหนด) + in_progress(วันนี้) + received(พรุ่งนี้) + in_progress(ไม่มีกำหนด) = ถือ 4, ยังไม่เริ่ม 2, เลยกำหนด 1
  assert.deepEqual({ open: by['[TEST] เจ้าหน้าที่กองช่าง'].open, unstarted: by['[TEST] เจ้าหน้าที่กองช่าง'].unstarted, overdue: by['[TEST] เจ้าหน้าที่กองช่าง'].overdue }, { open: 4, unstarted: 2, overdue: 1 })
  assert.deepEqual({ open: by['[TEST] ช่างไฟฟ้า'].open, unstarted: by['[TEST] ช่างไฟฟ้า'].unstarted, overdue: by['[TEST] ช่างไฟฟ้า'].overdue }, { open: 2, unstarted: 2, overdue: 1 })
  assert.deepEqual({ open: by['[TEST] หัวหน้ากองช่าง'].open, overdue: by['[TEST] หัวหน้ากองช่าง'].overdue }, { open: 0, overdue: 0 })
  const again = await workload(U.head)
  assert.deepEqual(again.members.map(m => m.id), v.members.map(m => m.id), 'ลำดับต้องคงที่ทุกครั้งที่เรียก (ไม่เรียงตามภาระ)')
})

await test('ภาระรายคน: คนที่ว่างงานต้องโผล่ (เป็น 0) และคนไม่มีชื่อไม่ทำให้พัง', async () => {
  const v = await workload(U.head)
  const idle = v.members.find(m => m.id === U.staff2)
  assert.deepEqual({ open: idle.open, unstarted: idle.unstarted, overdue: idle.overdue }, { open: 0, unstarted: 0, overdue: 0 })
  const nameless = v.members.find(m => m.id === U.noName)
  assert.equal(nameless.name, null, 'ชื่อว่างต้องเป็น null ให้หน้าจอใส่คำแทน')
})

await test('ภาระรายคน: ขอบเขตกอง — ยังไม่มอบหมายนับเฉพาะ pending/received ของกองตัวเอง ไม่ปนกองอื่น/หมวดเฉพาะกิจ/อปท.อื่น', async () => {
  const v = await workload(U.head)
  // received(null,department_id) + pending(null) + received(null, ตรงด้วยข้อความ) = 3 · in_progress ไม่นับ · กองอื่น/odor ไม่นับ
  assert.equal(v.unassigned, 3)
  const other = await workload(U.otherHead)
  assert.equal(other.department_name, 'สำนักปลัด')
  assert.equal(other.unassigned, 1, 'สำนักปลัดมี 1 ใบที่ยังไม่มอบหมาย')
  assert.ok(!other.members.some(m => m.id === U.staff), 'คนกองช่างต้องไม่โผล่ในรายชื่อสำนักปลัด')
})

await test('ภาระรายคน: รายชื่อมีเฉพาะคนในกองและ อปท. เดียวกัน ไม่รวมผู้บริหาร/แอดมิน/ประชาชน', async () => {
  const v = await workload(U.head)
  const ids = new Set(v.members.map(m => m.id))
  assert.deepEqual([...ids].sort(), [U.tech, U.staff, U.head, U.staff2, U.noName].sort())
  assert.ok(!ids.has(U.otherMuniStaff))
})

await test('สิทธิ์: เฉพาะหัวหน้ากอง (officer ที่สังกัดกอง) ของ อปท. ตัวเอง — คนอื่นทุกบทบาทถูกปฏิเสธ', async () => {
  for (const [label, uid] of Object.entries({
    staff: U.staff, technician: U.tech, admin: U.admin, viewer: U.viewer, council: U.council, citizen: U.citizen,
    superadmin: U.superadmin, 'หัวหน้าไม่มีกอง': U.headNoDept,
    // บทบาทอื่นที่ "สังกัดกอง" ด้วย — ถ้าตรวจแค่ว่ามีกองจะหลุดเข้ามา ต้องตรวจบทบาทด้วย
    'แอดมินที่สังกัดกอง': U.adminInDept, 'ผู้บริหารที่สังกัดกอง': U.viewerInDept, 'สภาที่สังกัดกอง': U.councilInDept,
  })) await rejects(workload(uid), /ไม่มีสิทธิ์/, label)
  await rejects(workload(U.head, T2), /ไม่มีสิทธิ์/, 'ขอ อปท. อื่น')
  await rejects(workload(U.head, null), /ไม่มีสิทธิ์/, 'p_muni ว่าง')
  await rejects(workload(null), /permission denied|42501/, 'anon ไม่มี EXECUTE')
})

await test('การตั้งสิทธิ์ฟังก์ชัน: anon ไม่มี EXECUTE · authenticated มี', async () => {
  await db.exec('RESET ROLE')
  for (const fn of ['staff_home_summary', 'staff_dept_workload']) {
    const r = (await db.query(`SELECT has_function_privilege('anon', 'public.${fn}(uuid)', 'EXECUTE') AS a,
                                      has_function_privilege('authenticated', 'public.${fn}(uuid)', 'EXECUTE') AS u`)).rows[0]
    assert.deepEqual(r, { a: false, u: true }, fn)
  }
})

await test('เป็นฟังก์ชัน STABLE ที่อ่านอย่างเดียว (ไม่เขียนข้อมูล)', async () => {
  await db.exec('RESET ROLE')
  const rows = (await db.query(`SELECT proname, provolatile FROM pg_proc WHERE proname IN ('staff_home_summary','staff_dept_workload') ORDER BY proname`)).rows
  assert.deepEqual(rows, [{ proname: 'staff_dept_workload', provolatile: 's' }, { proname: 'staff_home_summary', provolatile: 's' }])
})

console.log(`\n${cases} cases passed`)
