// Execute the staff performance RPC migration in local PostgreSQL (PGlite 0.5.8).
// Install PGlite in a temporary folder, then:
// node tests/staff-performance-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// No network calls, login sessions, or production data are used by this test.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const migration = await sqlFile('../supabase/migrations/20260927150000_staff_performance_rows_rpc.sql')
const viewerMigration = await sqlFile('../supabase/migrations/20260927200000_staff_performance_rows_viewer.sql')

// Real helper definitions are sliced out of the migrations that production runs, so the test
// exercises the same department matching and ad-hoc rules instead of a hand-written copy.
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

const schema = ({ withResolvedBy = true } = {}) => `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TABLE public.departments (
  id uuid PRIMARY KEY, municipality_id uuid, name text, short_name text, code text
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, role text, municipality_id uuid, department_id uuid, full_name text
);
CREATE TABLE public.complaint_categories (
  municipality_id uuid, value text, label text,
  is_adhoc boolean NOT NULL DEFAULT false,
  requires_manual_intake boolean NOT NULL DEFAULT false,
  UNIQUE (municipality_id, value)
);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY, municipality_id uuid, category text, status text,
  assigned_to uuid, ${withResolvedBy ? 'resolved_by uuid,' : ''}
  department_id uuid, department text,
  created_at timestamptz, closed_at timestamptz, due_date date, rating smallint,
  extra_data jsonb, ref_no text, issue_type text, village text,
  channel text DEFAULT 'citizen_online',
  detail text, phone text, reporter_name text, location_name text,
  latitude double precision, longitude double precision
);
CREATE TABLE public.complaint_timeline (
  id bigserial PRIMARY KEY, complaint_id uuid, status text, note text, actor_name text,
  created_at timestamptz
);
${categoryIsAdhoc}
${matchesMyDepartment}
`

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const tenant = id(1)
const otherTenant = id(2)
const works = id(3)
const office = id(4)
const tech = id(10)
const staff = id(11)
const officer = id(12)
const otherOfficer = id(13)
const admin = id(14)
const otherAdmin = id(15)
const viewer = id(16)
const council = id(17)
const citizen = id(18)
const superadmin = id(19)
const officerNoDept = id(20)
const otherViewer = id(21)
const nobody = id(99)
const ROUND_2 = ['2026-04-01', '2026-09-30']

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const guardDb = new PGlite()
await guardDb.exec(schema({ withResolvedBy: false }))
await test('guard stops both migrations when a required column is missing', async () => {
  await assert.rejects(() => guardDb.exec(migration), /ไม่พบคอลัมน์ complaints\.resolved_by/)
  await assert.rejects(() => guardDb.exec(viewerMigration), /ไม่พบคอลัมน์ complaints\.resolved_by/)
})
await guardDb.close()

const db = new PGlite()
await db.exec(schema())
await db.exec(migration)
await db.exec(viewerMigration)
await test('migrations are repeatable', async () => {
  await db.exec(migration)
  await db.exec(viewerMigration)
})

await db.query(`INSERT INTO public.departments VALUES
  ($1, $3, 'กองช่าง', 'ช่าง', 'works'),
  ($2, $3, 'สำนักปลัด', 'สป.', 'office')`, [works, office, tenant])
await db.query(`INSERT INTO public.profiles VALUES
  ($1, 'technician', $12, $13, '[TEST] ช่างไฟฟ้า'),
  ($2, 'staff', $12, $13, '[TEST] เจ้าหน้าที่กองช่าง'),
  ($3, 'officer', $12, $13, '[TEST] หัวหน้ากองช่าง'),
  ($4, 'officer', $12, $14, '[TEST] หัวหน้าสำนักปลัด'),
  ($5, 'admin', $12, $14, '[TEST] แอดมิน'),
  ($6, 'admin', $15, NULL, '[TEST] แอดมิน อปท. อื่น'),
  ($7, 'viewer', $12, NULL, '[TEST] ผู้บริหาร'),
  ($8, 'council', $12, NULL, '[TEST] สมาชิกสภา'),
  ($9, 'citizen', $12, NULL, '[TEST] ประชาชน'),
  ($10, 'superadmin', NULL, NULL, '[TEST] superadmin'),
  ($11, 'officer', $12, NULL, '[TEST] หัวหน้าไม่มีกอง')`,
[tech, staff, officer, otherOfficer, admin, otherAdmin, viewer, council, citizen, superadmin, officerNoDept,
  tenant, works, office, otherTenant])
await db.query("INSERT INTO public.profiles VALUES ($1, 'viewer', $2, NULL, '[TEST] ผู้บริหาร อปท. อื่น')", [otherViewer, otherTenant])
await db.query(`INSERT INTO public.complaint_categories (municipality_id, value, label, is_adhoc, requires_manual_intake) VALUES
  ($1, 'light', 'ไฟฟ้าสาธารณะ', false, false),
  ($1, 'odor', 'กลิ่นเหม็น', true, false),
  ($1, 'corruption', 'แจ้งการทุจริต', false, true)`, [tenant])

const complaint = async (n, fields) => {
  const row = {
    municipality_id: tenant, category: 'light', status: 'closed', assigned_to: tech, resolved_by: null,
    department_id: works, department: 'กองช่าง', created_at: '2026-05-01T09:00:00+07:00', closed_at: null,
    due_date: null, rating: null, extra_data: null, ref_no: `ES-69-${String(n).padStart(4, '0')}`,
    issue_type: 'ไฟดับทั้งดวง', village: 'หมู่ 1', channel: 'citizen_online',
    detail: '[TEST] secret detail', phone: '[TEST] secret phone', reporter_name: '[TEST] secret reporter',
    location_name: '[TEST] secret location', latitude: 18.1, longitude: 100.1,
    ...fields,
  }
  const cols = Object.keys(row)
  await db.query(
    `INSERT INTO public.complaints (id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => '$' + (i + 2)).join(', ')})`,
    [id(n), ...cols.map((c) => (c === 'extra_data' && row[c] != null ? JSON.stringify(row[c]) : row[c]))],
  )
}
const timeline = (n, status, at) => db.query(
  'INSERT INTO public.complaint_timeline (complaint_id, status, actor_name, created_at) VALUES ($1, $2, $3, $4)',
  [id(n), status, '[TEST] actor', at],
)

await complaint(101, { resolved_by: tech, created_at: '2026-09-20T10:00:00+07:00', closed_at: '2026-09-24T09:00:00+07:00', due_date: '2026-09-30', rating: 5 })
await timeline(101, 'received', '2026-09-20T10:00:05+07:00')
await timeline(101, 'closed', '2026-09-24T09:00:00+07:00')
await complaint(102, { created_at: '2026-06-01T09:00:00+07:00', closed_at: '2026-06-10T15:00:00+07:00' })
await timeline(102, 'done', '2026-06-08T10:00:00+07:00')
await timeline(102, 'closed', '2026-06-10T15:00:00+07:00')
await complaint(103, { status: 'done', created_at: '2026-05-01T09:00:00+07:00' })
await timeline(103, 'done', '2026-05-02T10:00:00+07:00')
await complaint(104, { created_at: '2026-04-10T09:00:00+07:00' })
await complaint(105, { status: 'received', created_at: '2026-03-30T09:00:00+07:00' })
await timeline(105, 'received', '2026-03-30T09:05:00+07:00')
await complaint(106, { status: 'received', created_at: '2026-09-01T09:00:00+07:00', extra_data: { reopen_count: 1, reopen_reason: '[TEST] secret reason' } })
await timeline(106, 'closed', '2026-09-05T09:00:00+07:00')
await complaint(107, { status: 'pending' })
await complaint(108, { category: 'odor', resolved_by: tech, closed_at: '2026-09-10T09:00:00+07:00' })
await complaint(109, { category: 'corruption', resolved_by: tech, closed_at: '2026-09-11T09:00:00+07:00' })
await complaint(110, { department_id: office, department: 'สำนักปลัด', resolved_by: tech, closed_at: '2026-09-10T09:00:00+07:00' })
await complaint(111, { resolved_by: tech, created_at: '2026-03-20T09:00:00+07:00', closed_at: '2026-03-31T17:00:00Z' })
await complaint(112, { resolved_by: tech, created_at: '2026-03-15T09:00:00+07:00', closed_at: '2026-03-31T16:59:59Z' })
await complaint(113, { status: 'rejected', created_at: '2026-05-05T09:00:00+07:00' })
await complaint(114, { status: 'rejected', created_at: '2026-03-05T09:00:00+07:00' })
await complaint(115, { resolved_by: tech, closed_at: '2026-07-01T09:00:00+07:00', extra_data: { reopen_count: 'abc' } })
await complaint(116, { status: 'received', created_at: '2026-10-01T00:00:00+07:00' })
await complaint(117, { resolved_by: officer, closed_at: '2026-09-15T09:00:00+07:00' })
await complaint(118, { municipality_id: otherTenant, resolved_by: tech, closed_at: '2026-09-15T09:00:00+07:00' })
await complaint(119, { department_id: null, department: 'กองช่าง', resolved_by: tech, closed_at: '2026-08-01T09:00:00+07:00' })
await complaint(120, { department_id: null, department: 'สำนักปลัด', resolved_by: tech, closed_at: '2026-08-01T09:00:00+07:00' })
await complaint(121, { status: 'received', assigned_to: staff, created_at: '2026-09-01T09:00:00+07:00' })
await complaint(122, { assigned_to: officer, department_id: office, department: 'สำนักปลัด', resolved_by: officer, closed_at: '2026-09-12T09:00:00+07:00' })

const call = async (uid, person, [from, to] = ROUND_2) => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('test.uid', $1, false)", [uid ?? ''])
  await db.exec(uid ? 'SET ROLE authenticated' : 'SET ROLE anon')
  try {
    const { rows } = await db.query('SELECT * FROM public.staff_performance_rows($1, $2, $3)', [person, from, to])
    return rows
  } finally {
    await db.exec('RESET ROLE')
  }
}
const numbers = (rows) => rows.map((r) => Number(r.id.slice(-3))).sort((a, b) => a - b)
const denied = (uid, person, range) => assert.rejects(
  () => call(uid, person, range),
  (err) => err.code === '42501' && /ไม่มีสิทธิ์ดูผลการปฏิบัติงาน/.test(err.message),
)
const badRange = (range) => assert.rejects(
  () => call(tech, tech, range),
  (err) => err.code === '22023',
)

const FULL = [101, 102, 103, 104, 105, 106, 109, 110, 111, 113, 115, 117, 119, 120]
const OFFICER_VIEW = FULL.filter((n) => n !== 110 && n !== 120)

await test('self sees every complaint of the round, by status rather than by close date', async () => {
  assert.deepEqual(numbers(await call(tech, tech)), FULL)
})
await test('admin and superadmin see the same full set as the person', async () => {
  assert.deepEqual(numbers(await call(admin, tech)), FULL)
  assert.deepEqual(numbers(await call(superadmin, tech)), FULL)
})
await test('executives (viewer) see everyone in their municipality, without village', async () => {
  const rows = await call(viewer, tech)
  assert.deepEqual(numbers(rows), FULL)
  assert.ok(rows.every((r) => r.village === null), 'ผู้บริหารต้องไม่เห็นหมู่บ้าน')
  assert.ok(rows.some((r) => r.ref_no !== null), 'เลขที่คำร้องยังต้องอยู่ ไว้ตรวจย้อน')
  assert.ok((await call(admin, tech)).some((r) => r.village !== null), 'แอดมินยังเห็นหมู่บ้านตามเดิม')
})
await test('department head sees only complaints of their own department (no new permission)', async () => {
  assert.deepEqual(numbers(await call(officer, tech)), OFFICER_VIEW)
})
await test('department head sees all of their own work when viewing themselves', async () => {
  assert.deepEqual(numbers(await call(officer, officer)), [122])
  assert.deepEqual(numbers(await call(admin, officer)), [122])
})
await test('staff and technician can open their own report', async () => {
  assert.deepEqual(numbers(await call(staff, staff)), [121])
})
await test('everyone else is refused with one message', async () => {
  await denied(staff, tech)
  await denied(tech, staff)
  await denied(otherOfficer, tech)
  await denied(officerNoDept, tech)
  await denied(otherAdmin, tech)
  await denied(otherViewer, tech)
  await denied(council, tech)
  await denied(citizen, citizen)
  await denied(admin, nobody)
})
await test('anon cannot execute the function at all', async () => {
  await assert.rejects(() => call(null, tech), (err) => err.code === '42501')
})
await test('ranges must be ordered and at most 400 days', async () => {
  await badRange(['2026-09-30', '2026-04-01'])
  await badRange(['2025-01-01', '2026-02-06'])
  await badRange([null, '2026-09-30'])
  assert.ok(Array.isArray(await call(tech, tech, ['2025-09-01', '2026-10-06'])))
})
await test('Bangkok day boundary decides which round a close belongs to', async () => {
  assert.ok(numbers(await call(tech, tech, ['2026-04-01', '2026-04-30'])).includes(111))
  assert.ok(!numbers(await call(tech, tech, ['2026-04-02', '2026-04-30'])).includes(111))
  assert.ok(!numbers(await call(tech, tech, ['2026-04-01', '2026-04-30'])).includes(112))
  assert.ok(numbers(await call(tech, tech, ['2025-10-01', '2026-03-31'])).includes(112))
})
await test('complaints created after the end date are not returned', async () => {
  assert.ok(numbers(await call(tech, tech, ['2026-04-01', '2026-10-01'])).includes(116))
  assert.ok(!numbers(await call(tech, tech)).includes(116))
})
await test('legacy rows expose the earliest done date and are not marked as finish-recorded', async () => {
  const rows = await call(tech, tech)
  const legacy = rows.find((r) => r.id === id(102))
  assert.equal(legacy.finish_recorded, false)
  assert.equal(legacy.first_done_at.toISOString(), '2026-06-08T03:00:00.000Z')
  assert.equal(legacy.closed_at.toISOString(), '2026-06-10T08:00:00.000Z')
  const exact = rows.find((r) => r.id === id(101))
  assert.equal(exact.finish_recorded, true)
  assert.equal(exact.received_at.toISOString(), '2026-09-20T03:00:05.000Z')
  const undated = rows.find((r) => r.id === id(104))
  assert.equal(undated.closed_at, null)
  assert.equal(undated.first_done_at, null)
})
await test('legacy done date decides the period, not the later admin close', async () => {
  assert.ok(!numbers(await call(tech, tech, ['2026-06-09', '2026-06-30'])).includes(102))
  assert.ok(numbers(await call(tech, tech, ['2026-06-08', '2026-06-08'])).includes(102))
})
await test('confidential categories are returned masked', async () => {
  const row = (await call(tech, tech)).find((r) => r.id === id(109))
  assert.equal(row.is_confidential, true)
  assert.equal(row.ref_no, null)
  assert.equal(row.village, null)
  assert.equal(row.issue_type, null)
  assert.equal(row.category, 'corruption')
})
await test('closed-on-behalf shows the closer name, own close shows nothing', async () => {
  const rows = await call(tech, tech)
  assert.equal(rows.find((r) => r.id === id(117)).resolved_by_name, '[TEST] หัวหน้ากองช่าง')
  assert.equal(rows.find((r) => r.id === id(101)).resolved_by_name, null)
  assert.equal(rows.find((r) => r.id === id(102)).resolved_by_name, null)
})
await test('reopen_count survives malformed data', async () => {
  const rows = await call(tech, tech)
  assert.equal(rows.find((r) => r.id === id(106)).reopen_count, 1)
  assert.equal(rows.find((r) => r.id === id(115)).reopen_count, 0)
})
await test('no complainant personal data or free text is returned', async () => {
  const rows = await call(admin, tech)
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'category', 'channel', 'closed_at', 'created_at', 'due_date', 'finish_recorded', 'first_done_at',
    'id', 'is_confidential', 'issue_type', 'rating', 'received_at', 'ref_no', 'reopen_count',
    'resolved_by_name', 'status', 'village',
  ])
  assert.ok(!JSON.stringify(rows).includes('secret'))
})

await test('rollback to the first version removes executive access again', async () => {
  await db.exec(migration)
  await denied(viewer, tech)
  await db.exec(viewerMigration)
  assert.deepEqual(numbers(await call(viewer, tech)), FULL)
})

await db.close()
console.log(`All ${cases} staff performance DB checks passed`)
