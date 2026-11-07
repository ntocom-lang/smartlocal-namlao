// ปิดช่องอ่านสาธารณะของ civil_projects — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/civil-projects-restrict-select.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   supabase/migrations/20261107100000_civil_projects_restrict_select.sql (ต้องมี 20261106100000 + 20261106100100 มาก่อน)
//
// ตรวจ: (1) ก่อนแก้ anon อ่านได้จริง (จำลองสภาพฐานจริงที่ตรวจพบ) (2) หลังแก้ anon/ประชาชน/ผู้บริหารอ่านไม่ได้
// (3) ผู้มีสิทธิ์ยังอ่านได้ตามเมทริกซ์เดียวกับโมดูล (4) insert ... returning / update ... where ของผู้สร้างยังทำงาน
// (5) ด่านตรวจ: policy อ่านตัวอื่นที่หลุดมา / ไม่มีฟังก์ชันสิทธิ์ → ไฟล์พังดังๆ ย้อนกลับทั้งก้อน (6) รันซ้ำได้
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261106100000_civil_reports_tables.sql')
const rlsSql = await readMigration('20261106100100_civil_reports_rls_triggers.sql')
const fixSql = await readMigration('20261107100000_civil_projects_restrict_select.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const D1 = id(11) // กองช่าง อปท. เอ
const D2 = id(12) // อีกกองของ อปท. เอ
const DB1 = id(13)
const P1 = id(21) // โครงการกองช่าง อปท. เอ สร้างโดย techCreator
const P2 = id(22) // โครงการของ อปท. บี
const P0 = id(23) // โครงการเก่า ไม่ได้ระบุกอง สร้างโดย adminA (เห็นเฉพาะ admin/ผู้สร้าง)
const P3 = id(24) // โครงการเก่า ไม่ได้ระบุกอง สร้างโดยช่าง techOther — ผู้สร้างเห็นได้ทั้งที่ไม่ใช่กองเดียวกัน (ตัวจับสาขา created_by)
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
-- ตัวแทน civil_projects: เฉพาะคอลัมน์ที่ policy ใช้ (ของจริงอยู่ที่ migration 046 + 20260730173506)
CREATE TABLE public.civil_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, department_id uuid REFERENCES public.departments(id),
  title text NOT NULL, note text, status text NOT NULL DEFAULT 'planned', start_date date, end_date date
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

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ'), ('${MB}', 'อปท. บี');
INSERT INTO public.departments VALUES ('${D1}', '${MA}', 'กองช่าง'), ('${D2}', '${MA}', 'กองคลัง'), ('${DB1}', '${MB}', 'กองช่าง บี');
`)
for (const [alias, uid] of Object.entries(U)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [uid])
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4)', [uid, ROLE[alias], alias in MUNI ? MUNI[alias] : MA, DEPT[alias] ?? null])
}
await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, note) VALUES ($1,$2,$3,$4,$5,$6)', [P1, MA, U.techCreator, D1, 'ถนน คสล. สายทดสอบ', 'โน้ตภายใน'])
await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, note) VALUES ($1,$2,$3,$4,$5,$6)', [P2, MB, U.adminB, DB1, 'โครงการ อปท. บี', 'โน้ตภายใน บี'])
await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, note) VALUES ($1,$2,$3,$4,$5,$6)', [P0, MA, U.adminA, null, 'โครงการเก่า ไม่มีกอง', null])
await db.query('INSERT INTO public.civil_projects (id, municipality_id, created_by, department_id, title, note) VALUES ($1,$2,$3,$4,$5,$6)', [P3, MA, U.techOther, null, 'โครงการเก่า ช่างสร้าง', null])

// สภาพฐานจริงที่ตรวจพบ 2569-11-07: RLS เปิด + SELECT USING (true) + anon มีสิทธิ์อ่าน (ไฟล์ 046)
// policy เขียนด้านล่างเป็นรูปย่อของ 20260802060000 (ผู้สร้างเขียนได้ในกองตน · officer กองตน · admin) เพื่อทดสอบว่ายังใช้ได้หลังแก้
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
GRANT SELECT ON public.civil_projects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.civil_projects TO authenticated;
`)

const actor = async alias => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias && alias !== 'anon' ? U[alias] : ''])
  await db.exec(`SET ROLE ${alias && alias !== 'anon' ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const visible = async alias => { await actor(alias); const r = (await db.query('SELECT id FROM public.civil_projects ORDER BY title')).rows.map(x => x.id); await asRoot(); return r }
const titleOf = { [P1]: 'P1', [P2]: 'P2', [P0]: 'P0', [P3]: 'P3' }
const names = ids => ids.map(x => titleOf[x] ?? x).sort()

let cases = 0
const test = async (label, run) => { await asRoot(); await run(); cases++; console.log('PASS ' + label) }

// ── ก่อนแก้: ยืนยันว่าช่องโหว่ที่ตรวจพบในฐานจริงถูกจำลองถูก (ไม่งั้นเทสต์หลังแก้ไม่มีความหมาย) ──
await test('ก่อนแก้ (สภาพฐานจริง): anon ไม่ต้องล็อกอินอ่านโครงการของทุก อปท. ได้ รวมช่อง note', async () => {
  await actor('anon')
  const r = await db.query('SELECT id, note FROM public.civil_projects')
  assert.equal(r.rows.length, 4)
  assert.ok(r.rows.some(x => x.note === 'โน้ตภายใน'))
  await asRoot()
  assert.deepEqual(names(await visible('citizenA')), ['P0', 'P1', 'P2', 'P3'])
})

// ── ลงมือ: ไฟล์ migration จริง ──
await asRoot()
await db.exec(tablesSql)
await db.exec(rlsSql)
await db.exec(fixSql)

await test('หลังแก้: anon อ่านไม่ได้เลย (ถอนสิทธิ์ทั้งตาราง) — ทั้ง select และนับแถว', async () => {
  await actor('anon')
  await assert.rejects(db.query('SELECT id FROM public.civil_projects'), e => e.code === '42501')
  await assert.rejects(db.query('SELECT count(*) FROM public.civil_projects'), e => e.code === '42501')
})

await test('หลังแก้: ประชาชน / ผู้บริหาร(viewer) อ่านได้ 0 แถว ไม่ว่าโครงการจะอยู่ อปท. ไหน', async () => {
  assert.deepEqual(await visible('citizenA'), [])
  assert.deepEqual(await visible('viewerA'), [])
})

await test('หลังแก้: admin เห็นทั้ง อปท. ตัวเอง (รวมโครงการเก่าไม่มีกอง) แต่ไม่เห็นของ อปท. อื่น · superadmin เห็นหมด', async () => {
  assert.deepEqual(names(await visible('adminA')), ['P0', 'P1', 'P3'])
  assert.deepEqual(names(await visible('adminB')), ['P2'])
  assert.deepEqual(names(await visible('superadmin')), ['P0', 'P1', 'P2', 'P3'])
})

await test('หลังแก้: officer เห็นเฉพาะกองตน · กองอื่นเห็น 0', async () => {
  assert.deepEqual(names(await visible('officerD1')), ['P1'])
  assert.deepEqual(await visible('officerD2'), [])
})

await test('หลังแก้: staff/technician เห็นเมื่อกองเดียวกัน หรือเป็นผู้สร้าง หรือถูกระบุชื่อในโครงการ · คนอื่นเห็น 0', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.civil_project_people (project_id, grp, sort_order, name, profile_id) VALUES
    ($1,'supervisor',1,'ช่างหนึ่ง',$2), ($1,'committee',1,'กรรมการหนึ่ง',$3)`, [P1, U.techSup, U.techCommittee])
  assert.deepEqual(names(await visible('staffD1')), ['P1'])
  assert.deepEqual(names(await visible('techCreator')), ['P1'])
  assert.deepEqual(names(await visible('techSup')), ['P1'])
  assert.deepEqual(names(await visible('techCommittee')), ['P1']) // ต่างกอง แต่ถูกระบุเป็นกรรมการ
  assert.deepEqual(names(await visible('techOther')), ['P3']) // ต่างกอง ไม่ถูกระบุใน P1 — เห็นเฉพาะโครงการเก่าที่ตัวเองสร้าง (P3)
  await db.query('DELETE FROM public.civil_project_people')
  assert.deepEqual(await visible('techCommittee'), [])
  assert.deepEqual(await visible('officerD2'), []) // P3 ไม่มีกอง officer เห็นไม่ได้
})

await test('สิทธิ์อ่านใน policy ตรงกับ civil_can_read_project (ที่โมดูลใช้กับตารางลูก) ทุกคู่ ผู้ใช้ x โครงการ — กันตรรกะสองที่เพี้ยนจากกัน', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.civil_project_people (project_id, grp, sort_order, name, profile_id) VALUES
    ($1,'supervisor',1,'ช่างหนึ่ง',$2), ($1,'committee',1,'กรรมการหนึ่ง',$3), ($4,'supervisor',1,'ช่างบี',$5)`, [P1, U.techSup, U.techCommittee, P0, U.techOther])
  let pairs = 0
  for (const alias of Object.keys(U)) {
    const seen = new Set(await visible(alias))
    await actor(alias)
    for (const pid of [P0, P1, P2, P3]) {
      const byFn = (await db.query('SELECT public.civil_can_read_project($1) AS ok', [pid])).rows[0].ok
      assert.equal(seen.has(pid), byFn, `${alias} x ${titleOf[pid]}: policy=${seen.has(pid)} แต่ civil_can_read_project=${byFn}`)
      pairs++
    }
    await asRoot()
  }
  assert.equal(pairs, Object.keys(U).length * 4)
  await db.query('DELETE FROM public.civil_project_people')
})

await test('หลังแก้: ผู้สร้าง insert ... returning ได้ (แถวใหม่ผ่านสิทธิ์อ่าน) และ update ... where ของตัวเองยังทำงาน', async () => {
  await actor('techCreator')
  const ins = await db.query(
    `INSERT INTO public.civil_projects (municipality_id, created_by, department_id, title) VALUES ($1,$2,$3,'โครงการใหม่ของช่าง') RETURNING id, title`,
    [MA, U.techCreator, D1])
  assert.equal(ins.rows.length, 1)
  const upd = await db.query(`UPDATE public.civil_projects SET status = 'in_progress' WHERE id = $1 RETURNING status`, [ins.rows[0].id])
  assert.equal(upd.rows[0].status, 'in_progress')
  // ของโครงการที่ตัวเองไม่มีสิทธิ์: update ไม่โดนแถวใดเลย (ไม่ error แต่ไม่เปลี่ยน)
  const other = await db.query(`UPDATE public.civil_projects SET status = 'completed' WHERE id = $1 RETURNING id`, [P2])
  assert.equal(other.rows.length, 0)
  await asRoot()
  await db.query('DELETE FROM public.civil_projects WHERE id = $1', [ins.rows[0].id])
})

await test('หลังแก้: officer แก้สถานะโครงการกองตนได้ (หน้าแผนที่ศูนย์ข้อมูลทำแบบนี้) · กองอื่นแก้ไม่ได้', async () => {
  await actor('officerD1')
  assert.equal((await db.query(`UPDATE public.civil_projects SET status = 'in_progress' WHERE id = $1 RETURNING id`, [P1])).rows.length, 1)
  await actor('officerD2')
  assert.equal((await db.query(`UPDATE public.civil_projects SET status = 'completed' WHERE id = $1 RETURNING id`, [P1])).rows.length, 0)
})

await test('รันซ้ำได้ (DROP POLICY IF EXISTS + REVOKE ซ้ำไม่พัง) และผลคงเดิม', async () => {
  await db.exec(fixSql)
  assert.deepEqual(names(await visible('adminA')), ['P0', 'P1', 'P3'])
  assert.deepEqual(await visible('citizenA'), [])
  const pol = (await db.query(`SELECT policyname FROM pg_policies WHERE tablename = 'civil_projects' AND cmd = 'SELECT'`)).rows
  assert.deepEqual(pol.map(x => x.policyname), ['civil_projects_select'])
})

await test('ด่านตรวจ: ถ้าฐานจริงมี policy อ่านตัวอื่นที่หลุดมา (USING true) ไฟล์ต้องพังดังๆ และย้อนกลับทั้งก้อน — ไม่ปล่อยให้ผ่านเงียบ', async () => {
  await asRoot()
  await db.exec('CREATE POLICY "leaked_read" ON public.civil_projects FOR SELECT USING (true)')
  await db.exec('GRANT SELECT ON public.civil_projects TO anon') // เปิดช่องคืน เพื่อพิสูจน์ว่า REVOKE ในไฟล์ถูกย้อนกลับด้วย
  await assert.rejects(db.exec(fixSql), e => /leaked_read/.test(e.message) && /policy อ่านตัวอื่น/.test(e.message))
  await db.exec('ROLLBACK').catch(() => {})
  const stillOpen = (await db.query("SELECT has_table_privilege('anon', 'public.civil_projects', 'SELECT') AS p")).rows[0].p
  assert.equal(stillOpen, true, 'ไฟล์พังกลางทางแต่ REVOKE ค้างอยู่ — ไม่ได้ย้อนกลับทั้งก้อน')
  await db.exec('DROP POLICY "leaked_read" ON public.civil_projects')
  await db.exec(fixSql)
  const closed = (await db.query("SELECT has_table_privilege('anon', 'public.civil_projects', 'SELECT') AS p")).rows[0].p
  assert.equal(closed, false)
})

await test('ด่านตรวจ: ไม่มีฟังก์ชันสิทธิ์ civil_can_read_project (ยังไม่ได้รันไฟล์ 20261106100100) → ไฟล์พังพร้อมบอกให้รันไฟล์ก่อนหน้า', async () => {
  await asRoot()
  await db.exec('DROP FUNCTION public.civil_can_read_project(uuid) CASCADE') // ลบ policy ที่พึ่งมันตามไปด้วย = เหมือนฐานที่ยังไม่เคยรันไฟล์ 2
  await assert.rejects(db.exec(fixSql), e => /20261106100100/.test(e.message))
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(rlsSql) // สร้างฟังก์ชัน+policy ของโมดูลกลับ (รันซ้ำได้)
  await db.exec(fixSql)
  assert.deepEqual(names(await visible('adminA')), ['P0', 'P1', 'P3'])
  assert.deepEqual(await visible('citizenA'), [])
})



console.log(`
${cases} cases passed`)
await db.close()
