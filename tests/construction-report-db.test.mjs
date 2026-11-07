// โมดูลรายงานผลการก่อสร้างประจำสัปดาห์ — รัน migration จริง 2 ไฟล์ใน PostgreSQL จำลอง (PGlite)
//   node tests/construction-report-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   supabase/migrations/20261106100000_civil_reports_tables.sql + 20261106100100_civil_reports_rls_triggers.sql
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//
// ตรวจ: (1) ใครอ่าน/เขียนได้ (บทบาท+กองเดิม ไม่มีสิทธิ์พิเศษ) (2) anon / ประชาชน / ผู้บริหาร เข้าไม่ได้
// (3) ตัวกระตุ้นล็อกรายงาน: ล็อกต้องมีตัวเลขแช่แข็ง + ต่อเนื่อง · ล็อกแล้วแก้ไม่ได้ · ปลดล็อกได้เฉพาะหัวหน้ากอง/แอดมินและเฉพาะฉบับล่าสุด
// (4) รหัสผู้สร้าง/ผู้ล็อก/เวลาล็อก ประทับโดยฐานข้อมูล ไม่เชื่อค่าจากเบราว์เซอร์ (5) ลบรายงาน = แอดมินเท่านั้น และลบโครงการที่มีรายงานไม่ได้
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261106100000_civil_reports_tables.sql')
const rlsSql = await readMigration('20261106100100_civil_reports_rls_triggers.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const D1 = id(11) // กองช่าง อปท. เอ
const D2 = id(12) // อีกกองของ อปท. เอ
const DB1 = id(13)
const P1 = id(21) // โครงการกองช่าง อปท. เอ สร้างโดย techCreator
const P2 = id(22) // โครงการของ อปท. บี
const P0 = id(23) // โครงการเก่า ไม่ได้ระบุกอง
const U = {
  superadmin: id(101), adminA: id(102), adminB: id(103), officerD1: id(104), officerD2: id(105), staffD1: id(106),
  techCreator: id(107), techSup: id(108), techOther: id(109), techCommittee: id(110), viewerA: id(111), citizenA: id(112),
}
const ROLE = { adminA: 'admin', adminB: 'admin', officerD1: 'officer', officerD2: 'officer', staffD1: 'staff', techCreator: 'technician',
  techSup: 'technician', techOther: 'technician', techCommittee: 'technician', viewerA: 'viewer', citizenA: 'citizen', superadmin: 'superadmin' }
const MUNI = { superadmin: null, adminB: MB }
const DEPT = { officerD1: D1, officerD2: D2, staffD1: D1, techCreator: D1, techSup: D1, techOther: D2, techCommittee: D2 }

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id), name text);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id), department_id uuid REFERENCES public.departments(id)
);
-- ตัวแทน civil_projects: เฉพาะคอลัมน์ที่โมดูลนี้และ policy ใช้ (ของจริงอยู่ที่ migration 046 + department_id ภายหลัง)
CREATE TABLE public.civil_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, department_id uuid REFERENCES public.departments(id),
  title text NOT NULL, start_date date, end_date date
);
-- ฟังก์ชันสิทธิ์พื้นฐานของจริง (005_create_profiles / allow_staff_read_own_management_events / scope_department_clerk_permissions)
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_my_department(p_municipality_id uuid, p_department_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT p_department_id IS NOT NULL AND p_municipality_id = public.get_my_municipality_id() AND p_department_id = public.get_my_department_id(); $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id(),
  public.is_my_department(uuid, uuid) TO anon, authenticated;

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ'), ('${MB}', 'อปท. บี');
INSERT INTO public.departments VALUES ('${D1}', '${MA}', 'กองช่าง'), ('${D2}', '${MA}', 'กองคลัง'), ('${DB1}', '${MB}', 'กองช่าง บี');
`)
for (const [alias, uid] of Object.entries(U)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [uid])
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4)', [uid, ROLE[alias], alias in MUNI ? MUNI[alias] : MA, DEPT[alias] ?? null])
}
await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
  [P1, MA, U.techCreator, D1, 'ถนน คสล. สายทดสอบ', '2026-10-01', '2026-12-29'])
await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title) VALUES ($1,$2,$3,$4,$5)', [P2, MB, U.adminB, DB1, 'โครงการ อปท. บี'])
await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title) VALUES ($1,$2,$3,$4,$5)', [P0, MA, U.adminA, null, 'โครงการเก่าไม่ระบุกอง'])

// migration จริง — ไฟล์ตารางก่อน แล้วไฟล์สิทธิ์/ตัวกระตุ้น (ไฟล์ 2 มีด่านตรวจว่าไฟล์ 1 รันแล้ว)
await db.exec(tablesSql)
await db.exec(rlsSql)
// รันซ้ำต้องไม่พัง (CREATE OR REPLACE / DROP POLICY IF EXISTS / IF NOT EXISTS)
await db.exec(tablesSql)
await db.exec(rlsSql)

const actor = async alias => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias && alias !== 'anon' ? U[alias] : ''])
  await db.exec(`SET ROLE ${alias && alias !== 'anon' ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }

const FROZEN = JSON.stringify({ version: 1, items: [], overall: { actual: 0 } })
const insertReport = (week, { project = P1, start, end, over = {} } = {}) => {
  const day = n => new Date(Date.parse('2026-10-01T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
  const s = start ?? day((week - 1) * 7)
  const e = end ?? day((week - 1) * 7 + 6)
  const cols = { project_id: project, week_no: week, period_start: s, period_end: e, ...over }
  const keys = Object.keys(cols)
  return db.query(`INSERT INTO public.civil_weekly_reports (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id, created_by, status`,
    keys.map(k => cols[k]))
}
const finalize = (reportId, over = {}) => db.query(
  `UPDATE public.civil_weekly_reports SET status = 'final', frozen = $2::jsonb, finalized_by = $3, finalized_at = '2000-01-01'
   WHERE id = $1 RETURNING finalized_by, finalized_at`,
  [reportId, FROZEN, over.finalized_by ?? U.superadmin])
const rows = async sql => (await db.query(sql)).rows

let cases = 0
const reset = async () => {
  await asRoot()
  await db.exec('DELETE FROM public.civil_weekly_reports; DELETE FROM public.civil_project_work_items; DELETE FROM public.civil_project_people; DELETE FROM public.civil_project_contracts;')
}
const test = async (label, run) => { await reset(); await run(); cases++; console.log('PASS ' + label) }
const rejects = (promise, expect) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const RLS_DENIED = { code: '42501' }

// ── ข้อมูลตั้งต้นต่อเทสต์: โครงการ P1 มีผู้ควบคุมงาน techSup + กรรมการ techCommittee + ตัวแทนผู้รับจ้าง ──
const seedP1 = async () => {
  await asRoot()
  await db.query(`INSERT INTO public.civil_project_people (project_id, grp, sort_order, name, position_title, duty, profile_id) VALUES
    ($1,'supervisor',1,'ช่างหนึ่ง','วิศวกรโยธา','หัวหน้าผู้ควบคุมงาน',$2),
    ($1,'committee',1,'กรรมการหนึ่ง','นักวิชาการ','ประธานกรรมการ',$3),
    ($1,'contractor_rep',1,'ตัวแทนหนึ่ง','วิศวกรโยธา','ผู้จัดการโครงการ',NULL)`, [P1, U.techSup, U.techCommittee])
  await db.query(`INSERT INTO public.civil_project_work_items (project_id, sort_order, name, weight_pct, plan_start, plan_end)
    VALUES ($1,1,'งานดิน',40,'2026-10-01','2026-10-31'), ($1,2,'งานผิวทาง',60,'2026-10-15','2026-12-15')`, [P1])
  await db.query(`INSERT INTO public.civil_project_contracts (project_id, contract_date, fine_per_day) VALUES ($1,'2026-09-25',1000)`, [P1])
}

// ── สิทธิ์อ่าน ───────────────────────────────────────────────────────────
await test('อ่านข้อมูลโครงการ: ผู้จัดการ · คนกองเดียวกัน · ผู้สร้าง · ผู้ถูกระบุชื่อ เห็น — กองอื่น/อปท.อื่น/ผู้บริหาร/ประชาชน/anon ไม่เห็น', async () => {
  await seedP1()
  await asRoot()
  await insertReport(1)
  const allowed = ['superadmin', 'adminA', 'officerD1', 'staffD1', 'techCreator', 'techSup', 'techCommittee']
  const denied = ['adminB', 'officerD2', 'techOther', 'viewerA', 'citizenA']
  for (const table of ['civil_weekly_reports', 'civil_project_people', 'civil_project_work_items', 'civil_project_contracts']) {
    for (const alias of allowed) {
      await actor(alias)
      assert.ok((await rows(`SELECT 1 FROM public.${table}`)).length > 0, `${alias} ต้องอ่าน ${table} ได้`)
    }
    for (const alias of denied) {
      await actor(alias)
      assert.equal((await rows(`SELECT 1 FROM public.${table}`)).length, 0, `${alias} ต้องไม่เห็น ${table}`)
    }
    await actor('anon')
    await rejects(db.query(`SELECT 1 FROM public.${table}`), RLS_DENIED)
  }
})

await test('โครงการเก่าที่ไม่ได้ระบุกอง: เห็นเฉพาะแอดมิน (หัวหน้ากอง/เจ้าหน้าที่ไม่เห็น จนกว่าแอดมินระบุกอง)', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.civil_project_work_items (project_id, name, weight_pct) VALUES ($1,'งานเก่า',100)`, [P0])
  for (const [alias, expected] of [['adminA', 1], ['superadmin', 1], ['officerD1', 0], ['staffD1', 0], ['techCreator', 0], ['adminB', 0]]) {
    await actor(alias)
    assert.equal((await rows('SELECT 1 FROM public.civil_project_work_items')).length, expected, alias)
  }
})

// ── สิทธิ์เขียน ──────────────────────────────────────────────────────────
await test('เขียนรายงาน: ผู้จัดการ · ผู้สร้างโครงการ · ผู้ควบคุมงานที่ถูกระบุ ทำได้ — คนกองเดียวกันที่ไม่ได้ถูกระบุ/กรรมการ/กองอื่น/ผู้บริหาร/ประชาชน/anon ทำไม่ได้', async () => {
  await seedP1()
  let week = 1
  for (const alias of ['superadmin', 'adminA', 'officerD1', 'techCreator', 'techSup']) {
    await actor(alias)
    await insertReport(week++)
  }
  for (const alias of ['staffD1', 'techCommittee', 'officerD2', 'techOther', 'adminB', 'viewerA', 'citizenA']) {
    await actor(alias)
    await rejects(insertReport(week++), RLS_DENIED)
  }
  await actor('anon')
  await rejects(insertReport(99), RLS_DENIED)
})

await test('ตั้งค่าโครงการ (รายการงาน/บุคคล/สัญญา): เขียนด้วยสิทธิ์เดียวกับรายงาน · ลบสัญญาตรงๆ เฉพาะผู้จัดการ', async () => {
  await seedP1()
  await actor('techSup')
  await db.query(`INSERT INTO public.civil_project_work_items (project_id, name, weight_pct) VALUES ($1,'งานเพิ่ม',0)`, [P1])
  await db.query(`UPDATE public.civil_project_contracts SET fine_per_day = 1500 WHERE project_id = $1`, [P1])
  assert.equal((await rows('SELECT fine_per_day FROM public.civil_project_contracts'))[0].fine_per_day, '1500.00')
  assert.ok(Date.parse((await rows('SELECT updated_at FROM public.civil_project_contracts'))[0].updated_at) > 0)
  assert.equal((await db.query(`DELETE FROM public.civil_project_contracts WHERE project_id = $1`, [P1])).affectedRows, 0, 'ผู้ควบคุมงานลบสัญญาไม่ได้')
  await actor('staffD1')
  await rejects(db.query(`INSERT INTO public.civil_project_work_items (project_id, name, weight_pct) VALUES ($1,'แทรก',10)`, [P1]), RLS_DENIED)
  assert.equal((await db.query(`UPDATE public.civil_project_contracts SET fine_per_day = 1 WHERE project_id = $1`, [P1])).affectedRows, 0)
  await actor('officerD1')
  assert.equal((await db.query(`DELETE FROM public.civil_project_contracts WHERE project_id = $1`, [P1])).affectedRows, 1)
})

await test('ย้ายรายงานไปโครงการอื่นไม่ได้ (ตัวกระตุ้นดักก่อน RLS)', async () => {
  await seedP1()
  await actor('techSup')
  const { rows: [r] } = await insertReport(1)
  await rejects(db.query('UPDATE public.civil_weekly_reports SET project_id = $2 WHERE id = $1', [r.id, P2]), { message: /เปลี่ยนไม่ได้/ })
})

// ── ข้อมูลผิดรูปแบบ ─────────────────────────────────────────────────────
await test('ข้อมูลผิดรูปแบบถูกปฏิเสธที่ฐานข้อมูล: ช่วงเกิน 7 วัน · ซ้ำสัปดาห์ · ย้อนกลับ · ตัวแทนผู้รับจ้างมีบัญชี · สัดส่วนเกิน 100', async () => {
  await seedP1()
  await actor('techSup')
  await rejects(insertReport(1, { start: '2026-10-01', end: '2026-10-08' }), { code: '23514' })
  await rejects(insertReport(1, { start: '2026-10-08', end: '2026-10-01' }), { code: '23514' })
  await insertReport(1)
  await rejects(insertReport(1), { code: '23505' })
  await rejects(insertReport(2, { over: { progress: '[]' } }), { code: '23514' })
  await asRoot()
  await rejects(db.query(`INSERT INTO public.civil_project_people (project_id, grp, name, profile_id) VALUES ($1,'contractor_rep','ก',$2)`, [P1, U.techSup]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.civil_project_work_items (project_id, name, weight_pct) VALUES ($1,'ก',100.5)`, [P1]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.civil_project_work_items (project_id, name, weight_pct, plan_start, plan_end) VALUES ($1,'ก',10,'2026-10-10','2026-10-01')`, [P1]), { code: '23514' })
})

// ── ตัวกระตุ้นล็อกรายงาน ────────────────────────────────────────────────
await test('ฉบับใหม่ต้องเป็นร่าง · รหัสผู้สร้างประทับจากผู้ล็อกอินจริง ไม่เชื่อค่าที่ส่งมา', async () => {
  await seedP1()
  await actor('techSup')
  const { rows: [r] } = await insertReport(1, { over: { created_by: U.adminA } })
  assert.equal(r.created_by, U.techSup)
  await rejects(insertReport(2, { over: { status: 'final', frozen: FROZEN, finalized_at: '2026-10-01' } }), { message: /ฉบับร่าง/ })
})

await test('ล็อกรายงาน: ต้องมีตัวเลขแช่แข็ง · ต้องล็อกสัปดาห์ก่อนหน้าก่อน · ผู้ล็อก/เวลาประทับโดยฐานข้อมูล', async () => {
  await seedP1()
  await actor('techSup')
  const { rows: [w1] } = await insertReport(1)
  const { rows: [w2] } = await insertReport(2)
  await rejects(db.query(`UPDATE public.civil_weekly_reports SET status = 'final' WHERE id = $1`, [w1.id]), { message: /frozen.items/ })
  await rejects(db.query(`UPDATE public.civil_weekly_reports SET status = 'final', frozen = '{}'::jsonb, finalized_at = now() WHERE id = $1`, [w1.id]), { message: /frozen\.items/ })
  await rejects(finalize(w2.id), { message: /สัปดาห์ก่อนหน้า/ })
  const { rows: [done] } = await finalize(w1.id, { finalized_by: U.adminA })
  assert.equal(done.finalized_by, U.techSup, 'ผู้ล็อกคือบัญชีจริง ไม่ใช่ค่าที่ส่งมา')
  assert.ok(Date.parse(done.finalized_at) > Date.parse('2026-01-01'), 'เวลาล็อกเป็นเวลาฐานข้อมูล ไม่ใช่ค่าที่ส่งมา')
  await finalize(w2.id)
  const { rows: [chk] } = await db.query('SELECT status, frozen IS NOT NULL AS has_frozen FROM public.civil_weekly_reports WHERE id = $1', [w2.id])
  assert.deepEqual([chk.status, chk.has_frozen], ['final', true])
})

await test('ฉบับที่ล็อกแล้วแก้ไม่ได้ ยกเว้นเลขที่/วันที่/เรียนของบันทึกข้อความ', async () => {
  await seedP1()
  await actor('techSup')
  const { rows: [w1] } = await insertReport(1, { over: { progress: JSON.stringify({ a: { week: 5 } }) } })
  await finalize(w1.id)
  await rejects(db.query(`UPDATE public.civil_weekly_reports SET progress = '{"a":{"week":99}}'::jsonb WHERE id = $1`, [w1.id]), { message: /ล็อกแล้วแก้ไม่ได้/ })
  await rejects(db.query(`UPDATE public.civil_weekly_reports SET frozen = '{"items":[]}'::jsonb WHERE id = $1`, [w1.id]), { message: /ล็อกแล้วแก้ไม่ได้/ })
  await rejects(db.query(`UPDATE public.civil_weekly_reports SET period_end = '2026-10-06' WHERE id = $1`, [w1.id]), { message: /ล็อกแล้วแก้ไม่ได้/ })
  await db.query(`UPDATE public.civil_weekly_reports SET memo_no = 'มท 0123/45', memo_date = '2026-10-09', memo_to = 'หัวหน้ากองช่าง' WHERE id = $1`, [w1.id])
  assert.equal((await rows('SELECT memo_no FROM public.civil_weekly_reports'))[0].memo_no, 'มท 0123/45')
})

await test('เลขสัปดาห์ โครงการ และผู้สร้างเปลี่ยนไม่ได้ (แม้ยังเป็นร่าง)', async () => {
  await seedP1()
  await actor('techSup')
  const { rows: [w1] } = await insertReport(1)
  await rejects(db.query('UPDATE public.civil_weekly_reports SET week_no = 5 WHERE id = $1', [w1.id]), { message: /เปลี่ยนไม่ได้/ })
  await rejects(db.query('UPDATE public.civil_weekly_reports SET created_by = $2 WHERE id = $1', [w1.id, U.adminA]), { message: /เปลี่ยนไม่ได้/ })
})

await test('ปลดล็อก: ผู้ควบคุมงานทำเองไม่ได้ · หัวหน้ากอง/แอดมินทำได้เฉพาะฉบับล่าสุด · ปลดแล้วตัวเลขแช่แข็งหาย', async () => {
  await seedP1()
  await actor('techSup')
  const { rows: [w1] } = await insertReport(1)
  const { rows: [w2] } = await insertReport(2)
  await finalize(w1.id)
  await finalize(w2.id)
  await rejects(db.query(`UPDATE public.civil_weekly_reports SET status = 'draft' WHERE id = $1`, [w2.id]), { message: /หัวหน้ากอง/ })
  await actor('officerD2')
  assert.equal((await db.query(`UPDATE public.civil_weekly_reports SET status = 'draft' WHERE id = $1`, [w2.id])).affectedRows, 0, 'หัวหน้ากองอื่นมองไม่เห็นแถว')
  await actor('officerD1')
  await rejects(db.query(`UPDATE public.civil_weekly_reports SET status = 'draft' WHERE id = $1`, [w1.id]), { message: /สัปดาห์หลังจากนี้/ })
  await db.query(`UPDATE public.civil_weekly_reports SET status = 'draft' WHERE id = $1`, [w2.id])
  const { rows: [after] } = await db.query('SELECT status, frozen, finalized_at, finalized_by FROM public.civil_weekly_reports WHERE id = $1', [w2.id])
  assert.deepEqual([after.status, after.frozen, after.finalized_at, after.finalized_by], ['draft', null, null, null])
  await actor('adminA')
  await db.query(`UPDATE public.civil_weekly_reports SET status = 'draft' WHERE id = $1`, [w1.id])
  assert.equal((await rows(`SELECT count(*)::int AS n FROM public.civil_weekly_reports WHERE status = 'draft'`))[0].n, 2)
})

await test('ร่างที่แอบส่ง frozen มาก็ถูกล้างทิ้ง (ร่างต้องไม่มีตัวเลขแช่แข็ง)', async () => {
  await seedP1()
  await actor('techSup')
  const { rows: [w1] } = await insertReport(1)
  await asRoot()
  await db.query(`UPDATE public.civil_weekly_reports SET frozen = $2::jsonb WHERE id = $1`, [w1.id, FROZEN])
  assert.equal((await rows('SELECT frozen FROM public.civil_weekly_reports'))[0].frozen, null)
})

// ── ลบ ───────────────────────────────────────────────────────────────────
await test('ลบรายงาน: แอดมิน/superadmin เท่านั้น · หัวหน้ากองและผู้ควบคุมงานลบไม่ได้', async () => {
  await seedP1()
  await asRoot()
  await insertReport(1)
  for (const alias of ['techSup', 'techCreator', 'officerD1', 'staffD1', 'adminB']) {
    await actor(alias)
    assert.equal((await db.query('DELETE FROM public.civil_weekly_reports')).affectedRows, 0, alias)
  }
  await actor('adminA')
  assert.equal((await db.query('DELETE FROM public.civil_weekly_reports')).affectedRows, 1)
})

await test('ลบรายการงานไม่ได้เมื่อมีรายงานที่ล็อกแล้ว · ลบโครงการที่มีรายงานไม่ได้ (RESTRICT)', async () => {
  await seedP1()
  await actor('techSup')
  const { rows: [w1] } = await insertReport(1)
  const item = (await rows('SELECT id FROM public.civil_project_work_items ORDER BY sort_order'))[0].id
  await finalize(w1.id)
  await rejects(db.query('DELETE FROM public.civil_project_work_items WHERE id = $1', [item]), { message: /รายงานที่ล็อกแล้ว/ })
  await asRoot()
  await assert.rejects(db.query('DELETE FROM public.civil_projects WHERE id = $1', [P1]), 'ลบโครงการที่มีรายงานที่ล็อกแล้วต้องไม่ได้')
  await db.query(`UPDATE public.civil_weekly_reports SET status = 'draft' WHERE id = $1`, [w1.id])
  await rejects(db.query('DELETE FROM public.civil_projects WHERE id = $1', [P1]), { code: '23001' })
  await db.exec('DELETE FROM public.civil_weekly_reports')
  await db.query('DELETE FROM public.civil_project_work_items WHERE id = $1', [item])
})

await test('ลบโครงการที่ไม่มีรายงาน = รายการงาน/บุคคล/สัญญาหายตาม (CASCADE)', async () => {
  await seedP1()
  await asRoot()
  await db.query('DELETE FROM public.civil_projects WHERE id = $1', [P1])
  for (const table of ['civil_project_work_items', 'civil_project_people', 'civil_project_contracts']) {
    assert.equal((await rows(`SELECT 1 FROM public.${table}`)).length, 0, table)
  }
  await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [P1, MA, U.techCreator, D1, 'ถนน คสล. สายทดสอบ', '2026-10-01', '2026-12-29'])
})

await test('anon / authenticated ไม่มีสิทธิ์ TRUNCATE และ anon ไม่มีสิทธิ์ใดๆ บนตารางและฟังก์ชันสิทธิ์', async () => {
  const grants = await rows(`SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name LIKE 'civil_%' AND table_name <> 'civil_projects' AND grantee IN ('anon','authenticated')`)
  assert.ok(!grants.some(g => g.grantee === 'anon'), 'anon ต้องไม่มีสิทธิ์ใดๆ')
  assert.ok(!grants.some(g => g.privilege_type === 'TRUNCATE'), 'ไม่ให้ TRUNCATE')
  assert.deepEqual([...new Set(grants.filter(g => g.grantee === 'authenticated').map(g => g.privilege_type))].sort(), ['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
  await actor('anon')
  await rejects(db.query('SELECT public.civil_can_read_project($1)', [P1]), RLS_DENIED)
  await actor('citizenA')
  assert.equal((await rows(`SELECT public.civil_can_read_project('${P1}') AS ok`))[0].ok, false)
  await rejects(db.query('SELECT public.civil_weekly_reports_guard()'), RLS_DENIED)
})

console.log(`\n${cases} cases passed`)
