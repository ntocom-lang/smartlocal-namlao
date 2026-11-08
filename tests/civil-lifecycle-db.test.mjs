// วงจรโครงการก่อสร้าง (PR-A) — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/civil-lifecycle-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน (ตามลำดับฐานจริง): 20261106100000 → 20261106100100 → 20261107100000 (#647–#649)
//                                 → 20261108100000 (คอลัมน์) → 20261108100100 (ตาราง) → 20261108100200 (ฟังก์ชัน/trigger/policy)
//                                 → 20261108160000 (ปิดทางเมนูเดิมแก้ status ตรง — รันก่อนหมวด 9 เพราะหมวด 9 รันไฟล์ 3 ซ้ำ)
//
// ตรวจ: (1) เติม stage จาก status เดิมถูกทุกค่า + status ตาม stage เสมอ (2) เปลี่ยนขั้นได้ทางเดียวผ่าน RPC ตามกติกาสิทธิ์/เหตุผล/เลขหนังสือ
// (3) เมนูเดิมที่แก้ status ตรงยังทำงาน + ลงประวัติ (4) เลื่อนเองเมื่อล็อกรายงานสัปดาห์ (5) ประวัติเขียนเพิ่มอย่างเดียว ปลอมไม่ได้
// (6) viewer อ่านได้เฉพาะ อปท. ตัวเอง · council/citizen/anon ไม่ได้ · policy ตรงกับ civil_can_read_project ทุกคู่
// (7) ช่องผลการตัดสินบันทึกได้เฉพาะผู้จัดการ (8) ลบ/สิทธิ์ตาราง (9) ด่านตรวจหัว/ท้ายไฟล์ + รันซ้ำได้
// (10) หลังปิดทางเมนูเดิม: ผู้ใช้แก้ status ตรงไม่ได้ทุกบทบาท · RPC / ผู้ดูแลฐานข้อมูล / INSERT แบบส่งแค่ status ยังใช้ได้
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const reportsTablesSql = await readMigration('20261106100000_civil_reports_tables.sql')
const reportsRlsSql = await readMigration('20261106100100_civil_reports_rls_triggers.sql')
const restrictSql = await readMigration('20261107100000_civil_projects_restrict_select.sql')
const colsSql = await readMigration('20261108100000_civil_lifecycle_columns.sql')
const tablesSql = await readMigration('20261108100100_civil_lifecycle_tables.sql')
const lifeSql = await readMigration('20261108100200_civil_lifecycle_rls_triggers.sql')
const closeLegacySql = await readMigration('20261108160000_civil_projects_close_legacy_status.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const D1 = id(11) // กองช่าง อปท. เอ
const D2 = id(12) // กองคลัง อปท. เอ
const DB1 = id(13)
// โครงการตั้งต้น (สร้างก่อน migration ใหม่ — ใช้ตรวจการเติมค่า)
const P1 = id(21) // กองช่าง เอ · in_progress · สร้างโดย techCreator
const P2 = id(22) // อปท. บี · planned
const P0 = id(23) // เอ ไม่มีกอง · completed
const PA = id(24) // เอ กองช่าง · approved
const PS = id(25) // เอ กองช่าง · suspended
const PC = id(26) // เอ กองช่าง · cancelled
const U = {
  superadmin: id(101), adminA: id(102), adminB: id(103), officerD1: id(104), officerD2: id(105), staffD1: id(106),
  techCreator: id(107), techSup: id(108), techOther: id(109), techCommittee: id(110), viewerA: id(111), citizenA: id(112),
  viewerB: id(113), councilA: id(114),
}
const ROLE = { adminA: 'admin', adminB: 'admin', officerD1: 'officer', officerD2: 'officer', staffD1: 'staff', techCreator: 'technician',
  techSup: 'technician', techOther: 'technician', techCommittee: 'technician', viewerA: 'viewer', citizenA: 'citizen', superadmin: 'superadmin',
  viewerB: 'viewer', councilA: 'council' }
const MUNI = { superadmin: null, adminB: MB, viewerB: MB }
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
-- ตัวแทน civil_projects: คอลัมน์ที่ migration ใช้ + status CHECK 6 ค่าตาม 046 (ของจริง 046 + 20260730173506)
CREATE TABLE public.civil_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, department_id uuid REFERENCES public.departments(id),
  title text NOT NULL, note text, contract_no text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','approved','in_progress','completed','cancelled','suspended')),
  start_date date, end_date date, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
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

-- ของจริง 20260802060000: ห้ามคนที่ไม่ใช่แอดมินย้ายเจ้าของ/อปท./กอง (RPC เปลี่ยนขั้นต้องผ่าน trigger นี้ได้)
CREATE FUNCTION public.protect_department_record_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.get_my_role() NOT IN ('admin', 'superadmin')
     AND (NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.municipality_id IS DISTINCT FROM OLD.municipality_id
          OR NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
    RAISE EXCEPTION 'Record owner, municipality and department cannot be changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_civil_projects_scope_trigger BEFORE UPDATE ON public.civil_projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_department_record_scope();

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ'), ('${MB}', 'อปท. บี');
INSERT INTO public.departments VALUES ('${D1}', '${MA}', 'กองช่าง'), ('${D2}', '${MA}', 'กองคลัง'), ('${DB1}', '${MB}', 'กองช่าง บี');
`)
for (const [alias, uid] of Object.entries(U)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [uid])
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4)', [uid, ROLE[alias], alias in MUNI ? MUNI[alias] : MA, DEPT[alias] ?? null])
}
const seedProject = (pid, muni, creator, dept, title, status) => db.query(
  'INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, status) VALUES ($1,$2,$3,$4,$5,$6)',
  [pid, muni, creator, dept, title, status])
await seedProject(P1, MA, U.techCreator, D1, 'ถนน คสล. สายทดสอบ', 'in_progress')
await seedProject(P2, MB, U.adminB, DB1, 'โครงการ อปท. บี', 'planned')
await seedProject(P0, MA, U.adminA, null, 'โครงการเก่า ไม่มีกอง', 'completed')
await seedProject(PA, MA, U.techCreator, D1, 'โครงการอนุมัติแล้ว', 'approved')
await seedProject(PS, MA, U.techCreator, D1, 'โครงการระงับ', 'suspended')
await seedProject(PC, MA, U.techCreator, D1, 'โครงการยกเลิก', 'cancelled')

// policy เขียนของ civil_projects = รูปย่อของ 20260802060000 (เหมือนเทสต์ #649)
await db.exec(`
ALTER TABLE public.civil_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "civil_projects_select" ON public.civil_projects FOR SELECT USING (true);
CREATE POLICY "civil_projects_insert" ON public.civil_projects FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (
    get_my_role() = 'superadmin' OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (get_my_role() IN ('staff','technician') AND municipality_id = get_my_municipality_id() AND department_id IS NOT DISTINCT FROM get_my_department_id())));
CREATE POLICY "civil_projects_update" ON public.civil_projects FOR UPDATE TO authenticated
  USING (get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
    OR (get_my_role() IN ('staff','technician') AND municipality_id = get_my_municipality_id() AND created_by = auth.uid()));
CREATE POLICY "civil_projects_delete" ON public.civil_projects FOR DELETE TO authenticated
  USING (get_my_role() = 'superadmin' OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id()));
GRANT SELECT ON public.civil_projects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.civil_projects TO authenticated;
`)

const actor = async alias => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias && alias !== 'anon' ? U[alias] : ''])
  await db.exec(`SET ROLE ${alias && alias !== 'anon' ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const stageOf = async pid => { await asRoot(); return (await rows('SELECT stage, status, stage_before_hold FROM public.civil_projects WHERE id = $1', [pid]))[0] }
const setStageRoot = async (pid, stage) => { await asRoot(); await db.query('UPDATE public.civil_projects SET stage = $2 WHERE id = $1', [pid, stage]) }
const rpc = (pid, stage, reason = null, ref = null, refDate = null) =>
  db.query('SELECT public.civil_set_project_stage($1, $2, $3, $4, $5) AS s', [pid, stage, reason, ref, refDate])
const lastEvent = async pid => (await rows('SELECT * FROM public.civil_project_events WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [pid]))[0]
const rejects = (promise, expect = {}) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const DENIED = { code: '42501' }

let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }

// ── ด่านตรวจหัวไฟล์: รันผิดลำดับต้องพังพร้อมบอกไฟล์ที่ต้องรันก่อน ──
await test('ด่านตรวจหัวไฟล์: รันไฟล์ใหม่ก่อน #647–#649 / ตารางก่อนคอลัมน์ / ฟังก์ชันก่อนตาราง → พังพร้อมชื่อไฟล์ที่ต้องรันก่อน', async () => {
  await rejects(db.exec(colsSql), { message: /20261106100000/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(reportsTablesSql)
  await db.exec(reportsRlsSql)
  await rejects(db.exec(colsSql), { message: /20261107100000/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(restrictSql)
  await rejects(db.exec(tablesSql), { message: /20261108100000/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(colsSql)
  await rejects(db.exec(lifeSql), { message: /20261108100100/ })
  await db.exec('ROLLBACK').catch(() => {})
})

// ── ลงมือ: ไฟล์จริงตามลำดับ แล้วรันซ้ำทั้งชุด (ต้องไม่พังและผลคงเดิม) ──
await db.exec(tablesSql)
await db.exec(lifeSql)
await db.exec(colsSql)
await db.exec(tablesSql)
await db.exec(lifeSql)

// ── 1) เติมค่า + sync ──
await test('เติม stage ให้โครงการเดิมจาก status ครบทุกค่า และ status ไม่เปลี่ยน · ไม่ลงประวัติให้แถวเดิม', async () => {
  const expected = { [P1]: 'construction', [P2]: 'budgeted', [P0]: 'warranty', [PA]: 'procuring', [PS]: 'suspended', [PC]: 'cancelled' }
  const before = { [P1]: 'in_progress', [P2]: 'planned', [P0]: 'completed', [PA]: 'approved', [PS]: 'suspended', [PC]: 'cancelled' }
  for (const [pid, stage] of Object.entries(expected)) {
    const r = await stageOf(pid)
    assert.equal(r.stage, stage, pid)
    assert.equal(r.status, before[pid], `status ของ ${pid} ต้องคงเดิม`)
  }
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.civil_project_events'))[0].n, 0)
  const nn = await rows(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'civil_projects' AND column_name = 'stage'`)
  assert.equal(nn[0].is_nullable, 'NO')
})

await test('สร้างโครงการ: ส่ง stage → status ตาม · ไม่ส่ง stage (เมนูเดิม) → stage จาก status · insert … returning ของผู้สร้างผ่าน (กับดัก #649)', async () => {
  await actor('techCreator')
  const a = await db.query(`INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title, stage, status)
    VALUES ($1,$2,$3,'ใหม่ ส่ง stage','contracted','planned') RETURNING id, stage, status`, [MA, U.techCreator, D1])
  assert.deepEqual([a.rows[0].stage, a.rows[0].status], ['contracted', 'approved'])
  const b = await db.query(`INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title, status)
    VALUES ($1,$2,$3,'ใหม่ เมนูเดิม','in_progress') RETURNING id, stage, status`, [MA, U.techCreator, D1])
  assert.deepEqual([b.rows[0].stage, b.rows[0].status], ['construction', 'in_progress'])
  const ev = await lastEvent(a.rows[0].id)
  assert.deepEqual([ev.kind, ev.from_stage, ev.to_stage, ev.actor], ['created', null, 'contracted', U.techCreator])
  for (const bad of ['suspended', 'cancelled', 'terminated']) {
    await rejects(db.query(`INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title, stage)
      VALUES ($1,$2,$3,'x',$4)`, [MA, U.techCreator, D1, bad]), { message: /เส้นหลัก/ })
  }
  await rejects(db.query(`INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title, stage)
    VALUES ($1,$2,$3,'x','nonsense')`, [MA, U.techCreator, D1]), { code: '23514' })
  // ลงทะเบียนโครงการที่ตรวจรับแล้ว/ปิดแล้ว (ทั้งส่ง stage และส่ง status แบบเมนูเดิม) = ผู้จัดการเท่านั้น
  await rejects(db.query(`INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title, stage)
    VALUES ($1,$2,$3,'x','closed')`, [MA, U.techCreator, D1]), DENIED)
  await rejects(db.query(`INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title, status)
    VALUES ($1,$2,$3,'x','completed')`, [MA, U.techCreator, D1]), DENIED)
  await actor('officerD1')
  const c = await db.query(`INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title, stage)
    VALUES ($1,$2,$3,'ย้อนหลัง ประกันผลงาน','warranty') RETURNING id, status`, [MA, U.officerD1, D1])
  assert.equal(c.rows[0].status, 'completed')
  await asRoot()
  await db.query('DELETE FROM public.civil_projects WHERE id IN ($1, $2, $3)', [a.rows[0].id, b.rows[0].id, c.rows[0].id])
})

// ── 2) เปลี่ยนขั้นผ่าน RPC ──
await test('UPDATE stage ตรงจากเบราว์เซอร์ถูกปฏิเสธ (แม้หัวหน้ากอง) · ช่อง stage_before_hold/stage_changed_at ถูกคืนค่าเดิม · ผู้ดูแลฐานข้อมูลแก้ตรงได้', async () => {
  await actor('officerD1')
  await rejects(db.query(`UPDATE public.civil_projects SET stage = 'final_inspection' WHERE id = $1`, [P1]), { message: /ปุ่มเปลี่ยนขั้น/ })
  await db.query(`UPDATE public.civil_projects SET stage_before_hold = 'budgeted', stage_changed_at = '2000-01-01', note = 'แก้โน้ต' WHERE id = $1`, [P1])
  const r = await stageOf(P1)
  assert.equal(r.stage_before_hold, null)
  assert.equal((await rows('SELECT note FROM public.civil_projects WHERE id = $1', [P1]))[0].note, 'แก้โน้ต')
  await setStageRoot(PA, 'contracted')
  assert.deepEqual(Object.values(await stageOf(PA)).slice(0, 2), ['contracted', 'approved'])
  assert.equal((await lastEvent(PA)).kind, 'stage_change')
  await setStageRoot(PA, 'procuring')
})

await test('ขั้นถัดไป 1 ขั้น: ผู้สร้าง/ผู้ควบคุมงานที่ถูกระบุ/หัวหน้ากองทำได้ไม่ต้องใส่เหตุผล · คนกองเดียวกันที่ไม่ได้ถูกระบุ/กรรมการ/viewer/กองอื่น/อปท.อื่น ทำไม่ได้', async () => {
  await db.query(`INSERT INTO public.civil_project_people (project_id, grp, name, profile_id) VALUES
    ($1,'supervisor','ช่างหนึ่ง',$2), ($1,'committee','กรรมการหนึ่ง',$3)`, [P1, U.techSup, U.techCommittee])
  await setStageRoot(P1, 'budgeted')
  const chain = [['techCreator', 'designing'], ['techSup', 'procuring'], ['officerD1', 'contracted'], ['techSup', 'started']]
  for (const [alias, next] of chain) {
    await actor(alias)
    assert.equal((await rpc(P1, next)).rows[0].s, next)
    const ev = await lastEvent(P1)
    assert.deepEqual([ev.kind, ev.to_stage, ev.actor], ['stage_change', next, U[alias]])
  }
  assert.equal((await stageOf(P1)).status, 'in_progress')
  for (const alias of ['staffD1', 'techCommittee', 'viewerA', 'officerD2', 'techOther', 'adminB', 'citizenA', 'councilA']) {
    await actor(alias)
    await rejects(rpc(P1, 'construction'), DENIED)
  }
  await actor('anon')
  await rejects(rpc(P1, 'construction'), DENIED)
  assert.equal((await stageOf(P1)).stage, 'started')
})

await test('→ warranty (ตรวจรับงวดสุดท้ายแล้ว) และ → closed ต้องเป็นผู้จัดการ · closed ต้องมีเหตุผลถ้ายังไม่คืนหลักประกัน', async () => {
  await setStageRoot(P1, 'final_inspection')
  await actor('techSup')
  await rejects(rpc(P1, 'warranty'), { code: '42501', message: /หัวหน้ากอง/ })
  await actor('officerD1')
  await rpc(P1, 'warranty')
  await actor('techCreator')
  await rejects(rpc(P1, 'closed'), DENIED)
  await actor('officerD1')
  await rejects(rpc(P1, 'closed'), { message: /เหตุผล/ })
  await rpc(P1, 'closed', 'สัญญาเก่า ไม่พบหลักฐานคืนหลักประกันในระบบ แต่คืนแล้วตามหนังสือกองคลัง')
  assert.match((await lastEvent(P1)).reason, /กองคลัง/)
  // บันทึกคืนหลักประกันแล้ว → ปิดได้โดยไม่ต้องใส่เหตุผล
  await rpc(P1, 'warranty', 'ทดสอบถอยขั้น')
  await db.query(`INSERT INTO public.civil_project_milestones (project_id, key, done_on, ref_no) VALUES ($1,'guarantee_returned','2026-11-01','ชท 123/2569')`, [P1])
  await rpc(P1, 'closed')
  assert.equal((await stageOf(P1)).status, 'completed')
  // สัญญาไม่มีหลักประกัน → ปิดได้โดยไม่ต้องใส่เหตุผล
  await asRoot()
  await db.query(`DELETE FROM public.civil_project_milestones WHERE project_id = $1`, [P1])
  await db.query(`INSERT INTO public.civil_project_contracts (project_id, guarantee_type) VALUES ($1,'none')`, [P1])
  await setStageRoot(P1, 'warranty')
  await actor('officerD1')
  await rpc(P1, 'closed')
  await asRoot()
  await db.query('DELETE FROM public.civil_project_contracts WHERE project_id = $1', [P1])
})

await test('ข้ามขั้น/ถอยขั้น/เปิดใหม่: ผู้จัดการ + เหตุผลบังคับ · ผู้มีสิทธิ์เขียนทำไม่ได้', async () => {
  await setStageRoot(P1, 'contracted')
  await actor('techCreator')
  await rejects(rpc(P1, 'construction', 'ข้าม'), DENIED)
  await rejects(rpc(P1, 'procuring', 'ถอย'), DENIED)
  await actor('officerD1')
  await rejects(rpc(P1, 'construction'), { message: /เหตุผล/ })
  await rejects(rpc(P1, 'construction', '   '), { message: /เหตุผล/ })
  await rpc(P1, 'construction', 'ลงทะเบียนโครงการย้อนหลัง เริ่มงานแล้ว')
  await rpc(P1, 'contracted', 'กดผิด')
  await rejects(rpc(P1, 'contracted', 'ซ้ำ'), { message: /อยู่ขั้นนี้อยู่แล้ว/ })
  await rejects(rpc(P1, 'unknown_stage', 'x'), { message: /ไม่รู้จักขั้น/ })
  await actor('adminA')
  await rpc(P1, 'started', 'แอดมินเลื่อน')
})

await test('ระงับ → จำขั้นเดิม → กลับมาดำเนินการ: ผู้จัดการ + เหตุผล + เลขหนังสือ (ตอนระงับ) · ระงับโครงการที่ปิดแล้วไม่ได้', async () => {
  await setStageRoot(P1, 'construction')
  await actor('officerD1')
  await rejects(rpc(P1, 'suspended', 'น้ำท่วมพื้นที่'), { message: /เลขที่หนังสือ/ })
  await rpc(P1, 'suspended', 'น้ำท่วมพื้นที่', 'ชท 0001/2569', '2026-11-08')
  let r = await stageOf(P1)
  assert.deepEqual([r.stage, r.status, r.stage_before_hold], ['suspended', 'suspended', 'construction'])
  const ev = await lastEvent(P1)
  assert.deepEqual([ev.ref_no, ev.ref_date?.toISOString?.().slice(0, 10) ?? ev.ref_date], ['ชท 0001/2569', '2026-11-08'])
  await actor('techSup')
  await rejects(rpc(P1, 'construction', 'น้ำลดแล้ว'), DENIED)
  await actor('officerD1')
  await rejects(rpc(P1, 'construction'), { message: /เหตุผล/ })
  await rpc(P1, 'construction', 'น้ำลดแล้ว')
  r = await stageOf(P1)
  assert.deepEqual([r.stage, r.stage_before_hold], ['construction', null])
  await setStageRoot(P1, 'closed')
  await actor('officerD1')
  await rejects(rpc(P1, 'suspended', 'x', 'y'), { message: /ยังดำเนินอยู่/ })
})

await test('ยกเลิกได้เฉพาะก่อนลงนามสัญญา · บอกเลิกได้เฉพาะลงนามแล้วถึงก่อนตรวจรับงวดสุดท้ายเสร็จ · ทั้งคู่ต้องมีเลขหนังสือ · ระงับแล้วดูขั้นที่จำไว้', async () => {
  await setStageRoot(P1, 'construction')
  await actor('officerD1')
  await rejects(rpc(P1, 'cancelled', 'ไม่มีงบ', 'ชท 1'), { message: /บอกเลิกสัญญา/ })
  await rejects(rpc(P1, 'terminated', 'ผู้รับจ้างทิ้งงาน'), { message: /เลขที่หนังสือ/ })
  await rpc(P1, 'terminated', 'ผู้รับจ้างทิ้งงาน ค่าปรับเกิน 10%', 'e-GP 6911000123')
  let r = await stageOf(P1)
  assert.deepEqual([r.stage, r.status], ['terminated', 'cancelled'])
  await actor('officerD1')
  await rejects(rpc(P1, 'suspended', 'x', 'y'), { message: /ยังดำเนินอยู่/ })
  await rpc(P1, 'construction', 'บันทึกผิดโครงการ เปิดใหม่')
  await setStageRoot(P1, 'designing')
  await actor('officerD1')
  await rejects(rpc(P1, 'terminated', 'x', 'y'), { message: /หลังลงนามสัญญา/ })
  await rpc(P1, 'suspended', 'รอผลอุทธรณ์', 'ชท 2')
  await rejects(rpc(P1, 'terminated', 'x', 'y'), { message: /หลังลงนามสัญญา/ }) // ขั้นที่จำไว้ = ออกแบบ
  await rpc(P1, 'cancelled', 'สภาไม่อนุมัติโอนงบ', 'ชท 3')
  r = await stageOf(P1)
  assert.deepEqual([r.stage, r.status, r.stage_before_hold], ['cancelled', 'cancelled', null])
  await setStageRoot(P1, 'warranty')
  await actor('officerD1')
  await rejects(rpc(P1, 'terminated', 'x', 'y'), { message: /หลังลงนามสัญญา/ })
  await actor('techCreator')
  await rejects(rpc(P1, 'suspended', 'x', 'y'), DENIED)
})

// ── 3) เมนูเดิม ──
await test('เมนูเดิมแก้ status ตรง (ก่อน PR-C) ยังใช้ได้: stage ตาม + ลงประวัติ legacy_status · กลับจากระงับไป status เดิม = กลับขั้นที่จำไว้', async () => {
  await setStageRoot(P1, 'started')
  await actor('techCreator')
  await db.query(`UPDATE public.civil_projects SET status = 'suspended' WHERE id = $1`, [P1])
  let r = await stageOf(P1)
  assert.deepEqual([r.stage, r.stage_before_hold], ['suspended', 'started'])
  let ev = await lastEvent(P1)
  assert.deepEqual([ev.kind, ev.from_stage, ev.to_stage, ev.actor, ev.detail.status_to], ['legacy_status', 'started', 'suspended', U.techCreator, 'suspended'])
  await actor('techCreator')
  await db.query(`UPDATE public.civil_projects SET status = 'in_progress' WHERE id = $1`, [P1])
  r = await stageOf(P1)
  assert.deepEqual([r.stage, r.status, r.stage_before_hold], ['started', 'in_progress', null], 'กลับขั้นที่จำไว้ ไม่ใช่ construction')
  // "แล้วเสร็จ" จากเมนูเดิม = ตรวจรับงวดสุดท้ายแล้ว → ช่างที่ไม่ใช่หัวหน้ากองทำไม่ได้ (กติกาเดียวกับ RPC)
  await actor('techCreator')
  await rejects(db.query(`UPDATE public.civil_projects SET status = 'completed' WHERE id = $1`, [P1]), DENIED)
  assert.equal((await stageOf(P1)).stage, 'started')
  await actor('officerD1')
  await db.query(`UPDATE public.civil_projects SET status = 'completed' WHERE id = $1`, [P1])
  assert.equal((await stageOf(P1)).stage, 'warranty')
  await actor('officerD1')
  await db.query(`UPDATE public.civil_projects SET status = 'cancelled' WHERE id = $1`, [P1])
  assert.equal((await stageOf(P1)).stage, 'cancelled', 'เมนูเดิม "ยกเลิก" ไม่ถูกตีความเป็นบอกเลิกสัญญา')
  // เปิดโครงการที่ปิด/บอกเลิกแล้วกลับมาผ่านเมนูเดิม = ผู้จัดการเท่านั้น
  // ถอยออกจาก warranty (= ลบข้อเท็จจริง "ตรวจรับงวดสุดท้ายแล้ว") ก็เช่นกัน ทุก status ปลายทาง
  for (const done of ['warranty', 'closed', 'terminated']) {
    await setStageRoot(P1, done)
    await actor('techCreator')
    for (const to of ['in_progress', 'approved', 'planned', 'cancelled', 'suspended']) {
      if (done === 'terminated' && to === 'cancelled') continue   // status เท่าเดิม = ไม่ใช่การเปลี่ยน
      await rejects(db.query(`UPDATE public.civil_projects SET status = $2 WHERE id = $1`, [P1, to]), DENIED)
    }
  }
  await setStageRoot(P1, 'cancelled')
  await actor('officerD1')
  // แก้ช่องอื่นโดยไม่แตะ status → ขั้นไม่เปลี่ยน ไม่ลงประวัติ
  const n = (await rows('SELECT count(*)::int AS n FROM public.civil_project_events WHERE project_id = $1', [P1]))[0].n
  await actor('officerD1')
  await db.query(`UPDATE public.civil_projects SET title = 'ถนน คสล. สายทดสอบ (แก้ชื่อ)', status = 'cancelled' WHERE id = $1`, [P1])
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.civil_project_events WHERE project_id = $1', [P1]))[0].n, n)
})

// ── 4) เลื่อนเองจากการล็อกรายงาน ──
const FROZEN = JSON.stringify({ version: 1, items: [], overall: { actual: 0 } })
const lockReport = async (alias, pid, week) => {
  await actor(alias)
  const day = n => new Date(Date.parse('2026-10-01T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
  const { rows: [r] } = await db.query(`INSERT INTO public.civil_weekly_reports (project_id, week_no, period_start, period_end)
    VALUES ($1,$2,$3,$4) RETURNING id`, [pid, week, day((week - 1) * 7), day((week - 1) * 7 + 6)])
  await db.query(`UPDATE public.civil_weekly_reports SET status = 'final', frozen = $2::jsonb WHERE id = $1`, [r.id, FROZEN])
}
await test('ล็อกรายงานประจำสัปดาห์ขณะอยู่ขั้น "เริ่มงาน" → เลื่อนเป็น "ก่อสร้าง" เอง + ประวัติ auto_stage · ขั้นอื่นไม่เลื่อน', async () => {
  await setStageRoot(P1, 'started')
  await lockReport('techSup', P1, 1)
  const r = await stageOf(P1)
  assert.deepEqual([r.stage, r.status], ['construction', 'in_progress'])
  const ev = await lastEvent(P1)
  assert.deepEqual([ev.kind, ev.from_stage, ev.to_stage, ev.actor], ['auto_stage', 'started', 'construction', U.techSup])
  assert.match(ev.reason, /สัปดาห์ที่ 1/)
  await setStageRoot(P1, 'contracted')
  await lockReport('techSup', P1, 2)
  assert.equal((await stageOf(P1)).stage, 'contracted', 'ไม่ได้อยู่ขั้นเริ่มงาน = ไม่เลื่อนเอง')
  await asRoot()
  await db.exec('DELETE FROM public.civil_weekly_reports')
})

// ── 5) ประวัติ ──
await test('ประวัติ: ผู้มีสิทธิ์เขียนเพิ่ม note ได้ (ผู้บันทึก/เวลาประทับโดยฐานข้อมูล) · ปลอมการเปลี่ยนขั้นไม่ได้ · แก้/ลบไม่ได้ · viewer เพิ่มไม่ได้', async () => {
  await actor('techSup')
  const { rows: [n] } = await db.query(`INSERT INTO public.civil_project_events (project_id, kind, reason, actor, created_at, detail)
    VALUES ($1,'note','กรรมการออกตรวจงาน',$2,'2000-01-01','{"status_to":"completed"}') RETURNING actor, created_at, detail`, [P1, U.adminA])
  assert.equal(n.actor, U.techSup)
  assert.deepEqual(n.detail, {}, 'detail สงวนให้ระบบ')
  assert.ok(Date.parse(n.created_at) > Date.parse('2026-01-01'))
  await rejects(db.query(`INSERT INTO public.civil_project_events (project_id, kind, to_stage, reason) VALUES ($1,'stage_change','closed','ปลอม')`, [P1]), DENIED)
  await rejects(db.query(`INSERT INTO public.civil_project_events (project_id, kind, reason) VALUES ($1,'note',' ')`, [P1]), { message: /เนื้อหา/ })
  await rejects(db.query(`UPDATE public.civil_project_events SET reason = 'แก้' WHERE project_id = $1`, [P1]), DENIED)
  await rejects(db.query(`DELETE FROM public.civil_project_events WHERE project_id = $1`, [P1]), DENIED)
  await actor('officerD1')
  await rejects(db.query(`UPDATE public.civil_project_events SET reason = 'แก้'`), DENIED)
  await actor('viewerA')
  await rejects(db.query(`INSERT INTO public.civil_project_events (project_id, kind, reason) VALUES ($1,'note','ผู้บริหารเขียน')`, [P1]), DENIED)
  await asRoot()
  await rejects(db.query(`UPDATE public.civil_project_events SET reason = 'แก้'`), { message: /แก้ไขไม่ได้/ })
})

// ── 6) สิทธิ์อ่าน ──
const ALL_PIDS = [P0, P1, P2, PA, PS, PC]
const CHILD = ['civil_project_milestones', 'civil_project_installments', 'civil_project_changes', 'civil_project_defects',
  'civil_project_events', 'civil_project_documents', 'civil_weekly_reports', 'civil_project_people', 'civil_project_work_items', 'civil_project_contracts']
await test('viewer (ผู้บริหาร) อ่านได้ทุกโครงการ + ทุกตารางลูกของ อปท. ตัวเอง · อปท. อื่นไม่เห็น · council/citizen เห็น 0 · anon ถูกปฏิเสธ', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.civil_project_milestones (project_id, key, done_on) VALUES ($1,'egp_project','2026-10-01'), ($2,'egp_project','2026-10-01')`, [P1, P2])
  await db.query(`INSERT INTO public.civil_project_installments (project_id, installment_no, amount) VALUES ($1,1,100000), ($2,1,5)`, [P1, P2])
  await db.query(`INSERT INTO public.civil_project_changes (project_id, kind) VALUES ($1,'extend_time'), ($2,'extend_time')`, [P1, P2])
  await db.query(`INSERT INTO public.civil_project_defects (project_id, inspected_on, kind, result) VALUES ($1,'2026-11-01','during_warranty','ok'), ($2,'2026-11-01','during_warranty','ok')`, [P1, P2])
  await db.query(`INSERT INTO public.civil_project_documents (project_id, doc_kind, title) VALUES ($1,'contract','สัญญาจ้าง'), ($2,'contract','สัญญาบี')`, [P1, P2])
  await db.query(`INSERT INTO public.civil_project_work_items (project_id, name, weight_pct) VALUES ($1,'งานดิน',100)`, [P1])
  await db.query(`INSERT INTO public.civil_project_contracts (project_id, fine_per_day) VALUES ($1,1000)`, [P1])
  await db.query(`INSERT INTO public.civil_weekly_reports (project_id, week_no, period_start, period_end) VALUES ($1,1,'2026-10-01','2026-10-07')`, [P1])
  await actor('viewerA')
  assert.equal((await rows('SELECT id FROM public.civil_projects')).length, 5, 'viewer เห็นทุกโครงการของ อปท. เอ รวมโครงการไม่มีกอง')
  for (const t of CHILD) {
    const got = await rows(`SELECT DISTINCT project_id FROM public.${t}`)
    assert.ok(got.length > 0 && got.every(x => x.project_id !== P2), `viewerA ต้องอ่าน ${t} ของ อปท. ตัวเองได้และไม่เห็น อปท. บี`)
  }
  await actor('viewerB')
  assert.deepEqual((await rows('SELECT id FROM public.civil_projects')).map(x => x.id), [P2])
  for (const alias of ['councilA', 'citizenA']) {
    await actor(alias)
    assert.equal((await rows('SELECT id FROM public.civil_projects')).length, 0, alias)
    for (const t of CHILD) assert.equal((await rows(`SELECT 1 FROM public.${t}`)).length, 0, `${alias} x ${t}`)
  }
  await actor('anon')
  for (const t of ['civil_projects', ...CHILD]) await rejects(db.query(`SELECT 1 FROM public.${t}`), DENIED)
})

await test('policy ของ civil_projects ตรงกับ civil_can_read_project ทุกคู่ ผู้ใช้ × โครงการ (รวม viewer/council) — ตรรกะสองที่ไม่เพี้ยนกัน', async () => {
  let pairs = 0
  for (const alias of Object.keys(U)) {
    await actor(alias)
    const seen = new Set((await rows('SELECT id FROM public.civil_projects')).map(x => x.id))
    for (const pid of ALL_PIDS) {
      const byFn = (await rows('SELECT public.civil_can_read_project($1) AS ok', [pid]))[0].ok
      assert.equal(seen.has(pid), byFn, `${alias} x ${pid}: policy=${seen.has(pid)} แต่ฟังก์ชัน=${byFn}`)
      pairs++
    }
  }
  assert.equal(pairs, Object.keys(U).length * ALL_PIDS.length)
})

await test('viewer เขียนอะไรไม่ได้: โครงการ/ตารางลูก/เปลี่ยนขั้น', async () => {
  await actor('viewerA')
  assert.equal((await db.query(`UPDATE public.civil_projects SET note = 'x' WHERE id = $1`, [P1])).affectedRows, 0)
  await rejects(db.query(`INSERT INTO public.civil_project_milestones (project_id, key) VALUES ($1,'viewer_try')`, [P1]), DENIED)
  assert.equal((await db.query(`UPDATE public.civil_project_installments SET amount = 1 WHERE project_id = $1`, [P1])).affectedRows, 0)
  assert.equal((await db.query(`DELETE FROM public.civil_project_documents WHERE project_id = $1`, [P1])).affectedRows, 0)
  await rejects(rpc(P1, 'cancelled', 'x', 'y'), DENIED)
})

// ── 7) ช่องผลการตัดสิน ──
await test('ผลตรวจรับงวด: ผู้ควบคุมงานบันทึกส่งมอบ/เบิกจ่ายได้ แต่ผลตรวจรับไม่ได้ · หัวหน้ากองบันทึกได้ · ผลต้องมีวันตรวจรับ', async () => {
  await actor('techSup')
  const inst = (await rows(`SELECT id FROM public.civil_project_installments WHERE project_id = $1`, [P1]))[0].id
  await db.query(`UPDATE public.civil_project_installments SET delivered_on = '2026-11-01', delivery_ref_no = 'รับ 55', paid_gross = 100000, paid_net = 99000 WHERE id = $1`, [inst])
  await rejects(db.query(`UPDATE public.civil_project_installments SET inspected_on = '2026-11-03', inspection_result = 'accepted' WHERE id = $1`, [inst]),
    { code: '42501', message: /inspection_result/ })
  await rejects(db.query(`INSERT INTO public.civil_project_installments (project_id, installment_no, inspected_on, inspection_result) VALUES ($1,2,'2026-11-03','accepted')`, [P1]), DENIED)
  await db.query(`INSERT INTO public.civil_project_installments (project_id, installment_no, amount) VALUES ($1,2,50000)`, [P1])
  await actor('officerD1')
  await rejects(db.query(`UPDATE public.civil_project_installments SET inspection_result = 'accepted' WHERE id = $1`, [inst]), { code: '23514' })
  await db.query(`UPDATE public.civil_project_installments SET inspected_on = '2026-11-03', inspection_result = 'accepted', egp_inspection_no = 'IR-1' WHERE id = $1`, [inst])
  // ผู้ควบคุมงานแก้ช่องอื่นของแถวที่มีผลแล้วได้ (ไม่ได้แตะผล)
  await actor('techSup')
  await db.query(`UPDATE public.civil_project_installments SET voucher_no = 'ฎ 10/2570' WHERE id = $1`, [inst])
  const r = (await rows(`SELECT inspection_result, voucher_no, created_by, updated_by FROM public.civil_project_installments WHERE id = $1`, [inst]))[0]
  assert.deepEqual([r.inspection_result, r.voucher_no, r.updated_by], ['accepted', 'ฎ 10/2570', U.techSup])
  // มีผลแล้ว: ข้อเท็จจริงที่ผลอ้างถึงแก้ย้อนหลังไม่ได้ (ยกเว้นผู้จัดการ) · งวดที่ยังไม่มีผลแก้ได้ตามปกติ
  for (const set of [`delivered_on = '2026-10-30'`, `inspected_on = '2026-11-04'`, `installment_no = 9`, `amount = 1`]) {
    await rejects(db.query(`UPDATE public.civil_project_installments SET ${set} WHERE id = $1`, [inst]), { code: '42501', message: /บันทึกผลการพิจารณาแล้ว/ })
  }
  await db.query(`UPDATE public.civil_project_installments SET delivered_on = '2026-12-01' WHERE project_id = $1 AND installment_no = 2`, [P1])
  await actor('officerD1')
  await db.query(`UPDATE public.civil_project_installments SET delivered_on = '2026-10-31' WHERE id = $1`, [inst])
})

await test('ขยายเวลา/แก้สัญญา: ผู้ควบคุมงานบันทึกคำขอได้ ผลพิจารณาไม่ได้ · หัวหน้ากองได้ · คืนหลักประกัน = ผู้จัดการเท่านั้น · คีย์จุดตรวจเปลี่ยนไม่ได้', async () => {
  await actor('techSup')
  const { rows: [c] } = await db.query(`INSERT INTO public.civil_project_changes (project_id, kind, cause, cause_ended_on, request_received_on, requested_days)
    VALUES ($1,'extend_time','ฝนตกหนัก','2026-10-20','2026-10-30',15) RETURNING id, created_by`, [P1])
  assert.equal(c.created_by, U.techSup)
  await rejects(db.query(`UPDATE public.civil_project_changes SET decision = 'approved', approved_on = '2026-11-02' WHERE id = $1`, [c.id]), DENIED)
  await actor('officerD1')
  await db.query(`UPDATE public.civil_project_changes SET decision = 'approved', approved_on = '2026-11-02', approved_days = 10, new_end_date = '2027-01-10' WHERE id = $1`, [c.id])
  await actor('techSup')
  await rejects(db.query(`UPDATE public.civil_project_changes SET kind = 'waive_fine' WHERE id = $1`, [c.id]), { message: /บันทึกผลการพิจารณาแล้ว/ })
  await rejects(db.query(`UPDATE public.civil_project_changes SET requested_days = 60 WHERE id = $1`, [c.id]), DENIED)
  await db.query(`UPDATE public.civil_project_changes SET egp_published_on = '2026-11-03', note = 'เผยแพร่แล้ว' WHERE id = $1`, [c.id])
  await rejects(db.query(`INSERT INTO public.civil_project_milestones (project_id, key, done_on) VALUES ($1,'guarantee_returned','2026-11-05')`, [P1]), DENIED)
  const { rows: [m] } = await db.query(`INSERT INTO public.civil_project_milestones (project_id, key, done_on) VALUES ($1,'notice_to_proceed','2026-10-01') RETURNING id`, [P1])
  await rejects(db.query(`UPDATE public.civil_project_milestones SET key = 'guarantee_returned' WHERE id = $1`, [m.id]), { message: /เปลี่ยนชนิดจุดตรวจ/ })
  await rejects(db.query(`INSERT INTO public.civil_project_milestones (project_id, key) VALUES ($1,'Bad Key!')`, [P1]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.civil_project_milestones (project_id, key) VALUES ($1,'notice_to_proceed')`, [P1]), { code: '23505' })
  await actor('officerD1')
  await db.query(`INSERT INTO public.civil_project_milestones (project_id, key, done_on) VALUES ($1,'guarantee_returned','2026-11-05')`, [P1])
  await actor('techSup')
  assert.equal((await db.query(`DELETE FROM public.civil_project_milestones WHERE key = 'notice_to_proceed' AND project_id = $1`, [P1])).affectedRows, 1)
  await rejects(db.query(`DELETE FROM public.civil_project_milestones WHERE key = 'guarantee_returned' AND project_id = $1`, [P1]), DENIED)
})

// ── 8) ลบ / ย้าย / ข้อมูลผิดรูปแบบ / สิทธิ์ตาราง ──
await test('ลบงวด/ขยายเวลา/ตรวจชำรุด = ผู้จัดการเท่านั้น · ไฟล์แนบลบได้โดยผู้แนบหรือผู้จัดการ · ย้ายข้อมูลข้ามโครงการไม่ได้ · ผู้สร้างประทับจากบัญชีจริง', async () => {
  for (const t of ['civil_project_installments', 'civil_project_changes', 'civil_project_defects']) {
    await actor('techSup')
    assert.equal((await db.query(`DELETE FROM public.${t} WHERE project_id = $1`, [P1])).affectedRows, 0, `ผู้ควบคุมงานลบ ${t} ไม่ได้`)
  }
  await actor('techSup')
  const { rows: [d] } = await db.query(`INSERT INTO public.civil_project_documents (project_id, doc_kind, title, source, created_by)
    VALUES ($1,'site_handover','บันทึกส่งมอบพื้นที่','system',$2) RETURNING id, created_by`, [P1, U.adminA])
  assert.equal(d.created_by, U.techSup)
  await rejects(db.query(`UPDATE public.civil_project_documents SET project_id = $2 WHERE id = $1`, [d.id, PA]), { message: /ย้ายข้อมูล/ })
  await actor('techCreator')
  assert.equal((await db.query(`DELETE FROM public.civil_project_documents WHERE id = $1`, [d.id])).affectedRows, 0, 'คนอื่นที่มีสิทธิ์เขียนลบไฟล์ของผู้อื่นไม่ได้')
  await actor('techSup')
  assert.equal((await db.query(`DELETE FROM public.civil_project_documents WHERE id = $1`, [d.id])).affectedRows, 1)
  await actor('officerD1')
  assert.equal((await db.query(`DELETE FROM public.civil_project_documents WHERE project_id = $1`, [P1])).affectedRows, 1)
  for (const t of ['civil_project_installments', 'civil_project_changes', 'civil_project_defects']) {
    assert.ok((await db.query(`DELETE FROM public.${t} WHERE project_id = $1`, [P1])).affectedRows > 0, `หัวหน้ากองลบ ${t} ได้`)
  }
})

await test('ข้อมูลผิดรูปแบบถูกปฏิเสธ: กลุ่มบุคคล price_committee ใช้ได้ (มีบัญชีได้) · ค่า grp แปลก · ตัวแทนผู้รับจ้างมีบัญชี · เปอร์เซ็นต์เกิน · ลิงก์ไม่ใช่ http', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.civil_project_people (project_id, grp, name, profile_id) VALUES ($1,'price_committee','ประธาน กก.ราคากลาง',$2)`, [P1, U.staffD1])
  await rejects(db.query(`INSERT INTO public.civil_project_people (project_id, grp, name) VALUES ($1,'mystery','x')`, [P1]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.civil_project_people (project_id, grp, name, profile_id) VALUES ($1,'contractor_rep','x',$2)`, [P1, U.techOther]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.civil_project_contracts (project_id, retention_pct) VALUES ($1, 120)`, [PA]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.civil_project_contracts (project_id, guarantee_type) VALUES ($1, 'gold')`, [PA]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.civil_project_milestones (project_id, key, link) VALUES ($1,'median_price_published','javascript:alert(1)')`, [PA]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.civil_project_changes (project_id, kind, decision) VALUES ($1,'extend_time','approved')`, [PA]), { code: '23514' })
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.com/x', 'drive:../x']) {
    await rejects(db.query(`INSERT INTO public.civil_project_documents (project_id, doc_kind, title, file_ref) VALUES ($1,'scan','x',$2)`, [PA, bad]), { code: '23514', message: /file_ref/ })
  }
  await db.query(`INSERT INTO public.civil_project_documents (project_id, doc_kind, title, file_ref) VALUES ($1,'scan','x','1AbC-dEf_123'), ($1,'scan','z','drive:1AbC_x-9'), ($1,'scan','y','https://drive.google.com/file/d/1/view')`, [PA])
  await db.query(`DELETE FROM public.civil_project_documents WHERE project_id = $1`, [PA])
  // ผู้ถูกระบุเป็นกรรมการราคากลางเห็นโครงการ (เหมือนกลุ่มอื่น) แต่เขียนไม่ได้ (ไม่ใช่ผู้ควบคุมงาน)
  await actor('staffD1')
  assert.equal((await rows('SELECT public.civil_can_write_project($1) AS ok', [P1]))[0].ok, false)
  await asRoot()
  await db.query(`DELETE FROM public.civil_project_people WHERE grp = 'price_committee'`)
})

await test('สิทธิ์ตาราง/ฟังก์ชัน: anon ไม่มีสิทธิ์ใดๆ · ไม่มี TRUNCATE · events ไม่มี UPDATE/DELETE · ฟังก์ชันตั้งบริบทเรียกตรงไม่ได้', async () => {
  const grants = await rows(`SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name LIKE 'civil_project_%' AND grantee IN ('anon','authenticated')`)
  assert.ok(!grants.some(g => g.grantee === 'anon'), 'anon ต้องไม่มีสิทธิ์ใดๆ')
  assert.ok(!grants.some(g => g.privilege_type === 'TRUNCATE'))
  assert.deepEqual(grants.filter(g => g.table_name === 'civil_project_events').map(g => g.privilege_type).sort(), ['INSERT', 'SELECT'])
  await actor('officerD1')
  await rejects(db.query(`SELECT public.civil_stage_context(true, 'stage_change', null, null, null)`), DENIED)
  await rejects(db.query(`SELECT public.civil_projects_stage_guard()`), DENIED)
  await actor('anon')
  await rejects(db.query(`SELECT public.civil_set_project_stage($1, 'closed')`, [P1]), DENIED)
})

await test('โครงการที่ระงับไว้ก่อนมีระบบ (ไม่รู้ขั้นเดิม) ยกเลิก/บอกเลิกตรงๆ ไม่ได้ พร้อมข้อความบอกทางแก้ · กลับมาดำเนินการได้', async () => {
  assert.deepEqual([(await stageOf(PS)).stage, (await stageOf(PS)).stage_before_hold], ['suspended', null])
  await actor('officerD1')
  await rejects(rpc(PS, 'cancelled', 'x', 'y'), { message: /กลับมาดำเนินการ/ })
  await rejects(rpc(PS, 'terminated', 'x', 'y'), { message: /กลับมาดำเนินการ/ })
  await rpc(PS, 'procuring', 'ตรวจเอกสารแล้ว อยู่ระหว่างจัดซื้อจัดจ้าง')
  await rpc(PS, 'cancelled', 'สภาไม่อนุมัติ', 'ชท 9')
})

await test('ลบโครงการที่ยังไม่ลงนามสัญญา (แอดมิน/superadmin) → ตารางลูกหายตาม (CASCADE) — แม้มีจุดตรวจคืนหลักประกัน', async () => {
  await asRoot()
  await db.exec('DELETE FROM public.civil_weekly_reports')
  const PX = id(31)
  await seedProject(PX, MA, U.adminA, D1, 'ยังไม่ลงนาม', 'planned')
  await db.query(`INSERT INTO public.civil_project_milestones (project_id, key) VALUES ($1,'x_test'), ($1,'guarantee_returned')`, [PX])
  await actor('superadmin')
  assert.equal((await db.query('DELETE FROM public.civil_projects WHERE id = $1', [PX])).affectedRows, 1)
  await actor('adminA')
  assert.equal((await db.query('DELETE FROM public.civil_projects WHERE id = $1', [PC])).affectedRows, 1, 'ยกเลิกก่อนลงนาม ลบได้')
  await asRoot()
  for (const t of ['civil_project_milestones', 'civil_project_events']) {
    assert.equal((await rows(`SELECT 1 FROM public.${t} WHERE project_id = $1`, [PX])).length, 0, t)
  }
})

await test('โครงการที่ลงนามสัญญาแล้ว = บันทึกทางราชการ ลบไม่ได้แม้ superadmin (ขั้น / เลขสัญญา / วันลงนาม / ประวัติ) · ผู้ดูแลฐานข้อมูลลบตรงได้ · TRUNCATE ไม่ได้', async () => {
  await asRoot()
  const [PY, PZ, PW] = [id(32), id(33), id(34)]
  await seedProject(PY, MA, U.adminA, D1, 'มีเลขสัญญาแต่ขั้นยังไม่ถึง', 'planned')
  await db.query(`UPDATE public.civil_projects SET contract_no = '12/2570' WHERE id = $1`, [PY])
  await seedProject(PW, MA, U.adminA, D1, 'มีวันลงนามในข้อมูลสัญญา', 'planned')
  await db.query(`INSERT INTO public.civil_project_contracts (project_id, contract_date) VALUES ($1,'2026-10-01')`, [PW])
  // ช่องเมนูเดิม: เคยถึงขั้นก่อสร้าง แล้วถูกตั้ง "ยกเลิก" — ประวัติยังเป็นหลักฐานว่าลงนามแล้ว
  await db.query(`INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, stage) VALUES ($1,$2,$3,$4,'ยกเลิกหลังลงนาม','construction')`,
    [PZ, MA, U.adminA, D1])
  await actor('officerD1')
  await db.query(`UPDATE public.civil_projects SET status = 'cancelled' WHERE id = $1`, [PZ])
  assert.equal((await stageOf(PZ)).stage, 'cancelled')
  for (const alias of ['adminA', 'superadmin']) {
    await actor(alias)
    for (const pid of [P1, PA, PY, PZ, PW]) {
      await rejects(db.query('DELETE FROM public.civil_projects WHERE id = $1', [pid]), { code: '42501', message: /บันทึกทางราชการ/ })
    }
  }
  await actor('adminA')
  await rejects(db.query('TRUNCATE public.civil_projects CASCADE'), DENIED)
  await asRoot()
  assert.equal((await db.query('DELETE FROM public.civil_projects WHERE id IN ($1, $2, $3)', [PY, PZ, PW])).affectedRows, 3)
})

// ── 10) ปิดทางเมนูเดิมแก้ status ตรง (20261108160000) ──
// วางก่อนหมวด 9: หมวด 9 รันไฟล์ 3 ซ้ำ ซึ่งคืนฟังก์ชันรุ่นเปิดทางเดิม (ไฟล์นี้บันทึกไว้แล้วว่าต้องรันตามซ้ำ)
const stageGuardDef = (() => {
  const i = lifeSql.indexOf('CREATE OR REPLACE FUNCTION public.civil_projects_stage_guard()')
  const j = lifeSql.indexOf('$;', lifeSql.indexOf('AS $', i) + 5)
  return lifeSql.slice(i, j + 3)
})()
await test('ไฟล์ปิดทางเมนูเดิม: ด่านหัวไฟล์ไม่เขียนทับฟังก์ชันรุ่นที่ไม่รู้จัก · รันซ้ำได้ · ตัดคอมเมนต์/ขึ้นบรรทัดต่างกันยังนับเป็นรุ่นเดิม', async () => {
  // มีคนแก้ stage_guard ไปเป็นรุ่นอื่นแล้ว → ไฟล์ต้องหยุดทั้งก้อน
  const tampered = stageGuardDef.replace(/BEGIN(\r?\n)  IF TG_OP = 'INSERT' THEN/, "BEGIN$1  PERFORM 1;$1  IF TG_OP = 'INSERT' THEN")
  assert.notEqual(tampered, stageGuardDef)
  await db.exec(tampered)
  await rejects(db.exec(closeLegacySql), { message: /ไม่ตรงกับรุ่นที่รู้จัก/ })
  await db.exec('ROLLBACK').catch(() => {})
  // รุ่นเดิมที่ถูกตัดคอมเมนต์ + เปลี่ยน CRLF/LF (เช่น SQL Editor ตัดคอมเมนต์ให้) ยังต้องผ่าน
  const stripped = stageGuardDef.replace(/\r\n/g, '\n').replace(/^[ ]*--.*$/gm, '')
  await db.exec(stripped)
  await db.exec(closeLegacySql)
  await db.exec(closeLegacySql)   // รันซ้ำ = รุ่นของไฟล์นี้ ผ่าน
  const { rows: [p] } = await db.query(`SELECT position('ปุ่มเปลี่ยนขั้นในหน้าโครงการ' IN prosrc) > 0 AS closed, prosecdef
    FROM pg_proc WHERE oid = 'public.civil_projects_stage_guard()'::regprocedure`)
  assert.deepEqual([p.closed, p.prosecdef], [true, true])
})

await test('หลังปิดทางเมนูเดิม: ทุกบทบาท (รวมหัวหน้ากอง/แอดมิน/superadmin) แก้ status ตรงไม่ได้ ไม่ลงประวัติ · ส่ง status ค่าเดิมพร้อมช่องอื่นผ่าน · RPC/ผู้ดูแลฐานข้อมูล/INSERT แบบส่งแค่ status ยังใช้ได้', async () => {
  await setStageRoot(P1, 'started')
  const countEvents = async () => { await asRoot(); return (await rows('SELECT count(*)::int AS n FROM public.civil_project_events WHERE project_id = $1', [P1]))[0].n }
  const n0 = await countEvents()
  for (const alias of ['techCreator', 'officerD1', 'adminA', 'superadmin']) {
    for (const to of ['planned', 'approved', 'completed', 'suspended', 'cancelled']) {
      await actor(alias)
      await rejects(db.query('UPDATE public.civil_projects SET status = $2 WHERE id = $1', [P1, to]),
        { code: '42501', message: /ปุ่มเปลี่ยนขั้นในหน้าโครงการ/ })
    }
  }
  let r = await stageOf(P1)
  assert.deepEqual([r.stage, r.status], ['started', 'in_progress'])
  assert.equal(await countEvents(), n0, 'ถูกปฏิเสธแล้วต้องไม่มีประวัติค้าง')
  // ฟอร์มที่ส่งทั้งแถวพร้อม status ค่าเดิม → ไม่ใช่การเปลี่ยนสถานะ ต้องผ่าน
  await actor('techCreator')
  await db.query(`UPDATE public.civil_projects SET note = 'หลังปิดทางเมนูเดิม', status = 'in_progress' WHERE id = $1`, [P1])
  await asRoot()
  assert.equal((await rows('SELECT note FROM public.civil_projects WHERE id = $1', [P1]))[0].note, 'หลังปิดทางเมนูเดิม')
  assert.equal(await countEvents(), n0)
  // RPC ยังเปลี่ยนขั้นได้ตามกติกาเดิม
  await actor('techCreator')
  await rpc(P1, 'construction')
  r = await stageOf(P1)
  assert.deepEqual([r.stage, r.status], ['construction', 'in_progress'])
  assert.equal((await lastEvent(P1)).kind, 'stage_change')
  await actor('officerD1')
  await rpc(P1, 'suspended', 'รอผลตรวจสอบแบบ', 'ชท 9')
  assert.deepEqual(Object.values(await stageOf(P1)), ['suspended', 'suspended', 'construction'])
  // ผู้ดูแลฐานข้อมูล (ไม่มีผู้ล็อกอิน) แก้ status ตรงได้ · กลับจากระงับ = กลับขั้นที่จำไว้ · ประวัติไม่ใช่ legacy_status
  await asRoot()
  await db.query(`UPDATE public.civil_projects SET status = 'in_progress' WHERE id = $1`, [P1])
  assert.deepEqual(Object.values(await stageOf(P1)), ['construction', 'in_progress', null])
  const ev = await lastEvent(P1)
  assert.deepEqual([ev.kind, ev.actor], ['stage_change', null])
  // INSERT ที่ส่งแค่ status (งาน GPS ของช่าง) ไม่เปลี่ยน
  await actor('techCreator')
  const { rows: [g] } = await db.query(`INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title, status)
    VALUES ($1,$2,$3,'งาน GPS ช่าง','in_progress') RETURNING id, stage, status`, [MA, U.techCreator, D1])
  assert.deepEqual([g.stage, g.status], ['construction', 'in_progress'])
  await asRoot()
  await db.query('DELETE FROM public.civil_projects WHERE id = $1', [g.id])
})

// ── 9) ด่านตรวจท้ายไฟล์ ──
await test('ด่านตรวจท้ายไฟล์: policy อ่านที่หลุดมาบน civil_projects / anon ได้สิทธิ์ผ่าน PUBLIC → ไฟล์ 3 พังและย้อนกลับทั้งก้อน', async () => {
  await db.exec('CREATE POLICY "leaked_read" ON public.civil_projects FOR SELECT USING (true)')
  await rejects(db.exec(lifeSql), { message: /leaked_read/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec('DROP POLICY "leaked_read" ON public.civil_projects')
  await db.exec('GRANT SELECT ON public.civil_project_events TO PUBLIC')
  await rejects(db.exec(lifeSql.replace(/REVOKE ALL ON TABLE public\.civil_project_milestones[\s\S]*?FROM PUBLIC, anon, authenticated;\nGRANT SELECT, INSERT, UPDATE, DELETE/, 'GRANT SELECT, INSERT, UPDATE, DELETE')),
    { message: /anon ยังมีสิทธิ์/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(lifeSql) // ไฟล์จริงถอน PUBLIC ให้เองแล้วผ่าน
  assert.equal((await rows(`SELECT has_table_privilege('anon', 'public.civil_project_events', 'SELECT') AS p`))[0].p, false)
})

await test('รันไฟล์ 2 ซ้ำเดี่ยวๆ หลังไฟล์ 3 (เช่น db push ยิงซ้ำ) สิทธิ์ของ authenticated ไม่หาย', async () => {
  await db.exec(tablesSql)
  await actor('techSup')
  assert.ok((await rows('SELECT 1 FROM public.civil_project_milestones')).length >= 0)
  await db.query(`INSERT INTO public.civil_project_events (project_id, kind, reason) VALUES ($1,'note','หลังรันไฟล์ 2 ซ้ำ')`, [P1])
  await asRoot()
  const grants = await rows(`SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
    WHERE table_name = 'civil_project_installments' AND grantee = 'authenticated'`)
  assert.deepEqual(grants.map(g => g.privilege_type).sort(), ['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
})

await test('ด่านตรวจท้ายไฟล์: trigger ช่องผลการตัดสินอ้างชื่อคอลัมน์ผิด → ไฟล์ 3 พังพร้อมชื่อคอลัมน์ (ไม่ผ่านเงียบ)', async () => {
  await db.exec(`CREATE TRIGGER zz_typo_guard BEFORE UPDATE ON public.civil_project_defects
    FOR EACH ROW EXECUTE FUNCTION public.civil_manage_columns_guard('result', '--', 'no_such_col')`)
  await rejects(db.exec(lifeSql), { message: /no_such_col/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec('DROP TRIGGER zz_typo_guard ON public.civil_project_defects')
  await db.exec(lifeSql)
})

console.log(`\n${cases} cases passed`)
await db.close()
