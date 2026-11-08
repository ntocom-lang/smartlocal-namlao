// เมนู "แผนพัฒนาท้องถิ่น" (PR R0-A) — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   npm run test:local-plan:db -- --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน (ตามลำดับ): 20261109100000 (plan_role + ด่านกัน) → 20261109100100 (ตาราง) → 20261109100200 (FK/ฟังก์ชัน/trigger/RPC/policy)
//
// ตรวจ: (1) ด่านหัวไฟล์ + รันซ้ำได้ (2) plan_role ตั้งเองไม่ได้ / ตั้งผ่าน admin_update_user / ล้างเองเมื่อบทบาทถือไม่ได้
// (3) เมทริกซ์อ่าน-เขียนทุกบทบาท (4) อปท. ของแถวลูกคัดจากแม่ ข้าม อปท. ไม่ได้ (5) ช่วงปี (6) กองแก้ได้เฉพาะเดือน/หมายเหตุ
// (7) ชื่อรายการตรงทะเบียน (8) ประกาศ/ล็อก/ยกเลิกประกาศ (9) ประวัติ เขียนเพิ่มอย่างเดียว (10) ลบ/TRUNCATE/anon
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const roleSql = await readMigration('20261109100000_profiles_plan_role.sql')
const tablesSql = await readMigration('20261109100100_local_plan_tables.sql')
const rlsSql = await readMigration('20261109100200_local_plan_rls_triggers.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const MC = id(3) // อปท. ที่ไม่มีผู้ใช้ ไว้ทดสอบลบทั้งแถว
const D1 = id(11) // กองช่าง เอ
const D2 = id(12) // กองคลัง เอ
const DG = id(14) // สำนักปลัด เอ
const DB1 = id(13)
const U = {
  superadmin: id(101), adminA: id(102), adminB: id(103), planA: id(104), planB: id(105), officerD1: id(106), officerD2: id(107),
  staffD1: id(108), techD1: id(109), viewerA: id(110), viewerB: id(111), councilA: id(112), citizenA: id(113), staffTarget: id(114),
}
const ROLE = { superadmin: 'superadmin', adminA: 'admin', adminB: 'admin', planA: 'staff', planB: 'staff', officerD1: 'officer', officerD2: 'officer',
  staffD1: 'staff', techD1: 'technician', viewerA: 'viewer', viewerB: 'viewer', councilA: 'council', citizenA: 'citizen', staffTarget: 'staff' }
const MUNI = { superadmin: null, adminB: MB, planB: MB, viewerB: MB }
const DEPT = { planA: DG, planB: DB1, officerD1: D1, officerD2: D2, staffD1: D1, techD1: D1, staffTarget: D1 }

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;

CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id), name text);
CREATE TABLE public.positions (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id), department_id uuid REFERENCES public.departments(id),
  position_id uuid REFERENCES public.positions(id), is_dept_head boolean DEFAULT false,
  full_name text, phone text, id_card text, address text, address_province text, address_district text, address_subdistrict text,
  address_moo text, address_detail text, job_title text, fleet_role text, asset_role text, email text
);
CREATE TABLE public.audit_logs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text, resource_type text, resource_id text, resource_label text, metadata jsonb);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_my_department(p_municipality_id uuid, p_department_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT p_department_id IS NOT NULL AND p_municipality_id = public.get_my_municipality_id() AND p_department_id = public.get_my_department_id(); $$;
CREATE FUNCTION public.profile_linked_to_municipality(p_user uuid, p_muni uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id(),
  public.is_my_department(uuid, uuid) TO anon, authenticated;
-- ตัวแทนฟังก์ชันเดิมก่อน migration (ไฟล์ 1 แทนที่ทั้งตัว)
CREATE FUNCTION public.admin_update_user(p_user_id uuid, p_changes jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION public.guard_profile_privileged_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER guard_profile_privileged_update_trigger BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_update();
CREATE FUNCTION public.audit_managed_profile_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_audit_managed_profile_update AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_managed_profile_update();
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ'), ('${MB}', 'อปท. บี'), ('${MC}', 'อปท. ซี');
INSERT INTO public.departments VALUES ('${D1}', '${MA}', 'กองช่าง'), ('${D2}', '${MA}', 'กองคลัง'), ('${DG}', '${MA}', 'สำนักปลัด'), ('${DB1}', '${MB}', 'กองช่าง บี');
`)
for (const [alias, uid] of Object.entries(U)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [uid])
  await db.query('INSERT INTO public.profiles (id, role, municipality_id, department_id) VALUES ($1,$2,$3,$4)',
    [uid, ROLE[alias], alias in MUNI ? MUNI[alias] : MA, DEPT[alias] ?? null])
}

const actor = async alias => {
  await db.exec('RESET ROLE')
  const signedIn = alias && alias !== 'anon'
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [signedIn ? U[alias] : ''])
  await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [signedIn ? 'authenticated' : 'anon'])
  await db.exec(`SET ROLE ${signedIn ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)")
  await db.query("SELECT set_config('request.jwt.claim.role', '', false)")
}
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const affected = async (sql, params = []) => (await db.query(sql, params)).affectedRows
const rejects = (promise, expect = {}) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const DENIED = { code: '42501' }

let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }

// ── ด่านหัวไฟล์ ──
await test('ด่านหัวไฟล์: รันผิดลำดับ → พังพร้อมชื่อไฟล์ที่ต้องรันก่อน', async () => {
  await rejects(db.exec(tablesSql), { message: /20261109100000/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(roleSql)
  await rejects(db.exec(rlsSql), { message: /20261109100100/ })
  await db.exec('ROLLBACK').catch(() => {})
})

await db.exec(tablesSql)
await db.exec(rlsSql)
// รันซ้ำทั้งชุด ต้องไม่พัง
await db.exec(roleSql)
await db.exec(tablesSql)
await db.exec(rlsSql)
await db.query(`UPDATE public.profiles SET plan_role = 'plan_admin' WHERE id = ANY($1)`, [[U.planA, U.planB]])

// ตัวช่วยสร้างข้อมูล (ทำในบทบาทที่ส่งมา)
const newPlan = async (as, muni, from, to, extra = {}) => {
  await actor(as)
  const r = await rows(`INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to, is_current) VALUES ($1,$2,$3,$4) RETURNING *`,
    [muni, from, to, extra.is_current ?? false])
  await asRoot()
  return r[0]
}
const newProject = async (as, planId, name, dept = D1, extra = {}) => {
  await actor(as)
  const r = await rows(`INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, department_id, official_name, added_in_revision, revision_ref_no)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [MA, planId, dept, name, extra.rev ?? 0, extra.ref ?? null])
  await asRoot()
  return r[0]
}
const newOp = async (as, planId, fy, kind = 'main', rev = 0) => {
  await actor(as)
  const r = await rows(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [MA, planId, fy, kind, rev])
  await asRoot()
  return r[0]
}
const newItem = async (as, opId, name, dept = D1, extra = {}) => {
  await actor(as)
  const r = await rows(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, department_id, item_name, amount, month_from, month_to, dev_project_id, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [MA, opId, dept, name, extra.amount ?? 1000, extra.from ?? 1, extra.to ?? 3, extra.project ?? null, extra.sort ?? 0])
  await asRoot()
  return r[0]
}
const setOp = (opId, status, date = null, reason = null) =>
  db.query('SELECT public.local_op_plan_set_status($1,$2,$3,$4,$5)', [opId, status, date, null, reason])
const setDev = (planId, status, date = null, reason = null) =>
  db.query('SELECT public.local_dev_plan_set_status($1,$2,$3,$4,$5)', [planId, status, date, null, reason])
const eventsOf = async entityId => { await asRoot(); return rows('SELECT * FROM public.local_plan_events WHERE entity_id = $1 ORDER BY id', [entityId]) }

// ── plan_role ──
await test('plan_role: ตั้งให้ตัวเองผ่าน UPDATE ตรงไม่ได้ (ด่านกัน) แม้เป็นแอดมิน', async () => {
  for (const alias of ['staffD1', 'adminA', 'citizenA']) {
    await actor(alias)
    await rejects(db.query(`UPDATE public.profiles SET plan_role = 'plan_admin' WHERE id = $1`, [U[alias]]), { message: /admin_update_user/ })
  }
})

await test('plan_role: แอดมินตั้งผ่าน admin_update_user ได้ · ค่าอื่นถูกปฏิเสธ · แอดมินข้าม อปท. ไม่ได้', async () => {
  await actor('adminA')
  await db.query(`SELECT public.admin_update_user($1, '{"plan_role":"plan_admin"}'::jsonb)`, [U.staffTarget])
  await rejects(db.query(`SELECT public.admin_update_user($1, '{"plan_role":"boss"}'::jsonb)`, [U.staffTarget]), { message: /Invalid plan_role|profiles_plan_role_check/ })
  await actor('adminB')
  await rejects(db.query(`SELECT public.admin_update_user($1, '{"plan_role":null}'::jsonb)`, [U.staffTarget]), { message: /outside your municipality/ })
  await asRoot()
  assert.equal((await rows('SELECT plan_role FROM public.profiles WHERE id = $1', [U.staffTarget]))[0].plan_role, 'plan_admin')
})

await test('plan_role: การมอบ/ถอนสิทธิ์ลงบันทึกตรวจสอบ พร้อมผู้มอบ ค่าก่อน-หลัง', async () => {
  await db.query('UPDATE public.profiles SET plan_role = NULL WHERE id = $1', [U.staffTarget])
  await actor('adminA')
  await db.query(`SELECT public.admin_update_user($1, '{"plan_role":"plan_admin"}'::jsonb)`, [U.staffTarget])
  await asRoot()
  const log = (await rows(`SELECT * FROM public.audit_logs WHERE resource_id = $1 ORDER BY id DESC LIMIT 1`, [U.staffTarget]))[0]
  assert.equal(log.actor_id, U.adminA)
  assert.deepEqual(log.metadata.changed_fields, ['plan_role'])
  assert.equal(log.metadata.authorization_before.plan_role, null)
  assert.equal(log.metadata.authorization_after.plan_role, 'plan_admin')
})

await test('plan_role: เปลี่ยนเป็นบทบาทที่ถือไม่ได้ → ล้างเอง · ประชาชนคงสังกัด อปท. (กันบั๊กรอบ 3)', async () => {
  await actor('adminA')
  await db.query(`SELECT public.admin_update_user($1, '{"role":"viewer"}'::jsonb)`, [U.staffTarget])
  await asRoot()
  assert.equal((await rows('SELECT plan_role FROM public.profiles WHERE id = $1', [U.staffTarget]))[0].plan_role, null)
  await actor('adminA')
  await db.query(`SELECT public.admin_update_user($1, '{"role":"citizen"}'::jsonb)`, [U.staffTarget])
  await asRoot()
  const r = (await rows('SELECT role, municipality_id, plan_role FROM public.profiles WHERE id = $1', [U.staffTarget]))[0]
  assert.deepEqual([r.role, r.municipality_id, r.plan_role], ['citizen', MA, null])
  await db.query(`UPDATE public.profiles SET role = 'staff', department_id = $2 WHERE id = $1`, [U.staffTarget, D1])
})

await test('plan_role ค้างบนบทบาทที่ถือไม่ได้ (แก้ตรงในฐานข้อมูล) → ไม่ได้สิทธิ์จัดการ', async () => {
  await db.query(`UPDATE public.profiles SET plan_role = 'plan_admin' WHERE id = $1`, [U.techD1])
  await actor('techD1')
  assert.equal((await rows('SELECT public.local_plan_is_manager($1) AS m', [MA]))[0].m, false)
  await asRoot()
  await db.query('UPDATE public.profiles SET plan_role = NULL WHERE id = $1', [U.techD1])
})

// ── เมทริกซ์สิทธิ์ ──
const planA = await newPlan('planA', MA, 2566, 2570)
const projA = await newProject('planA', planA.id, 'ถนน คสล. สายทดสอบ')
const opA = await newOp('planA', planA.id, 2570)
const itemD1 = await newItem('planA', opA.id, 'รายการกองช่าง', D1)
const itemD2 = await newItem('planA', opA.id, 'รายการกองคลัง', D2, { amount: 5000 })
const planB = await newPlan('planB', MB, 2566, 2570)
await asRoot()
await db.query('INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year, amount) VALUES ($1,$2,2570,100000)', [projA.id, MA])

const READ_TABLES = ['local_dev_plans', 'local_dev_plan_projects', 'local_dev_plan_project_years', 'local_op_plans', 'local_op_plan_items', 'local_plan_events']

await test('อ่าน: ผู้จัดการแผน + เจ้าหน้าที่ + ผู้บริหารของ อปท. ตัวเอง เห็นทุกตาราง', async () => {
  for (const alias of ['superadmin', 'adminA', 'planA', 'officerD1', 'officerD2', 'staffD1', 'techD1', 'viewerA']) {
    await actor(alias)
    for (const t of READ_TABLES) {
      const n = (await rows(`SELECT count(*)::int AS n FROM public.${t} WHERE municipality_id = $1`, [MA]))[0].n
      assert.ok(n > 0, `${alias} ต้องอ่าน ${t} ได้`)
    }
  }
})

await test('อ่าน: อปท. อื่น / สภา / ประชาชน ไม่เห็น · anon ไม่มีสิทธิ์ตาราง', async () => {
  for (const alias of ['adminB', 'planB', 'viewerB', 'councilA', 'citizenA']) {
    await actor(alias)
    for (const t of READ_TABLES) {
      const n = (await rows(`SELECT count(*)::int AS n FROM public.${t} WHERE municipality_id = $1`, [MA]))[0].n
      assert.equal(n, 0, `${alias} ต้องไม่เห็น ${t}`)
    }
  }
  await actor('anon')
  for (const t of READ_TABLES) await rejects(db.query(`SELECT 1 FROM public.${t}`), DENIED)
})

await test('เขียนแผน: เฉพาะผู้จัดการแผนของ อปท. นั้น (หัวหน้ากอง/เจ้าหน้าที่/ผู้บริหาร/อปท. อื่น ไม่ได้)', async () => {
  for (const alias of ['officerD1', 'staffD1', 'techD1', 'viewerA', 'councilA', 'citizenA', 'adminB', 'planB']) {
    await actor(alias)
    await rejects(db.query('INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to) VALUES ($1, 2561, 2565)', [MA]), DENIED)
    assert.equal(await affected(`UPDATE public.local_dev_plans SET note = 'x' WHERE id = $1`, [planA.id]), 0, alias)
    assert.equal(await affected('DELETE FROM public.local_op_plans WHERE id = $1', [opA.id]), 0, alias)
    assert.equal(await affected('DELETE FROM public.local_op_plan_items WHERE id = $1', [itemD1.id]), 0, alias)
  }
  await actor('planA')
  assert.equal(await affected(`UPDATE public.local_dev_plans SET note = 'จากนักวิเคราะห์' WHERE id = $1`, [planA.id]), 1)
})

await test('อปท. ของแถวลูกคัดจากแม่: ส่ง อปท. อื่นมาก็ถูกทับ · ผู้จัดการ อปท. อื่นแทรกเข้าแผนของเขาไม่ได้', async () => {
  await actor('planA')
  const r = await rows(`INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, official_name) VALUES ($1,$2,'ส่ง อปท. ผิด') RETURNING municipality_id`, [MB, planA.id])
  assert.equal(r[0].municipality_id, MA)
  await actor('planB')
  await rejects(db.query(`INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, official_name) VALUES ($1,$2,'แทรกข้าม')`, [MB, planA.id]), DENIED)
  await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, revision_no, kind) VALUES ($1,$2,2569,0,'main')`, [MB, planA.id]), DENIED)
  await rejects(db.query(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, item_name) VALUES ($1,$2,'แทรกข้าม')`, [MB, opA.id]), DENIED)
  await actor('planA')
  await rejects(db.query(`UPDATE public.local_dev_plan_projects SET municipality_id = $1 WHERE id = $2`, [MB, projA.id]), { message: /ข้าม อปท/ })
  const otherOp = await newOp('planA', planA.id, 2569)
  await actor('planA')
  await rejects(db.query(`UPDATE public.local_op_plan_items SET op_plan_id = $1 WHERE id = $2`, [otherOp.id, itemD1.id]), { message: /ย้ายรายการ/ })
  await db.query('DELETE FROM public.local_op_plans WHERE id = $1', [otherOp.id])
})

await test('กองต้องเป็นของ อปท. เดียวกัน', async () => {
  await actor('planA')
  await rejects(db.query(`INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, department_id, official_name) VALUES ($1,$2,$3,'กองผิด')`, [MA, planA.id, DB1]), { message: /ไม่ใช่ของ อปท/ })
  await rejects(db.query('UPDATE public.local_op_plan_items SET department_id = $1 WHERE id = $2', [DB1, itemD1.id]), { message: /ไม่ใช่ของ อปท/ })
})

await test('ฉบับที่เมนูแสดง: 1 อปท. มีได้ฉบับเดียว ตั้งฉบับใหม่แล้วปลดฉบับเดิมเอง · ไม่กระทบ อปท. อื่น', async () => {
  const cur1 = await newPlan('planA', MA, 2571, 2575, { is_current: true })
  await actor('planB')
  await db.query('UPDATE public.local_dev_plans SET is_current = true WHERE id = $1', [planB.id])
  await actor('planA')
  await db.query('UPDATE public.local_dev_plans SET is_current = true WHERE id = $1', [planA.id])
  await asRoot()
  const list = await rows('SELECT id, is_current FROM public.local_dev_plans WHERE municipality_id = $1 AND is_current', [MA])
  assert.deepEqual(list.map(r => r.id), [planA.id])
  assert.equal((await rows('SELECT is_current FROM public.local_dev_plans WHERE id = $1', [planB.id]))[0].is_current, true)
  await db.query('DELETE FROM public.local_dev_plans WHERE id = $1', [cur1.id])
})

await test('ช่วงปี: วงเงินรายปี/แผนดำเนินงานนอกช่วงแผนไม่ได้ · หดช่วงจนข้อมูลตกขอบไม่ได้', async () => {
  await actor('planA')
  await rejects(db.query('INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year, amount) VALUES ($1,$2,2571,1)', [projA.id, MA]), { message: /นอกช่วง/ })
  await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no) VALUES ($1,$2,2571,'main',0)`, [MA, planA.id]), { message: /นอกช่วง/ })
  await rejects(db.query('UPDATE public.local_dev_plans SET year_to = 2569 WHERE id = $1', [planA.id]), { message: /เปลี่ยนช่วงปีไม่ได้/ })
  await rejects(db.query('INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to) VALUES ($1, 2575, 2571)', [MA]), { code: '23514' })
  const r = await rows('INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year, amount) VALUES ($1,$2,2569,50) RETURNING municipality_id', [projA.id, MB])
  assert.equal(r[0].municipality_id, MA, 'อปท. ของวงเงินคัดจากโครงการ')
})

// ── กองผู้รับผิดชอบ ──
await test('กองผู้รับผิดชอบ: แก้เดือน/หมายเหตุของแถวกองตัวเองได้ · งบ/ชื่อ/ลำดับ/กอง ไม่ได้', async () => {
  for (const alias of ['officerD1', 'staffD1']) {
    await actor(alias)
    assert.equal(await affected(`UPDATE public.local_op_plan_items SET month_from = 2, month_to = 4, note = $2 WHERE id = $1`, [itemD1.id, alias]), 1, alias)
    await rejects(db.query('UPDATE public.local_op_plan_items SET amount = 1 WHERE id = $1', [itemD1.id]), { code: '42501', message: /amount/ })
    await rejects(db.query(`UPDATE public.local_op_plan_items SET item_name = 'แก้ชื่อ' WHERE id = $1`, [itemD1.id]), { code: '42501', message: /item_name/ })
    await rejects(db.query('UPDATE public.local_op_plan_items SET seq_no = 9 WHERE id = $1', [itemD1.id]), { code: '42501', message: /seq_no/ })
    await rejects(db.query('UPDATE public.local_op_plan_items SET department_id = $2 WHERE id = $1', [itemD1.id, D2]), { code: '42501' })
  }
})

await test('กองผู้รับผิดชอบ: แถวกองอื่นแก้ไม่ได้ · ช่าง/ผู้บริหารแก้ไม่ได้ · เพิ่ม/ลบแถวไม่ได้ · เดือนกลับหัวไม่ได้', async () => {
  await actor('officerD1')
  assert.equal(await affected('UPDATE public.local_op_plan_items SET month_from = 5, month_to = 6 WHERE id = $1', [itemD2.id]), 0)
  await rejects(db.query(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, department_id, item_name) VALUES ($1,$2,$3,'เพิ่มเอง')`, [MA, opA.id, D1]), DENIED)
  assert.equal(await affected('DELETE FROM public.local_op_plan_items WHERE id = $1', [itemD1.id]), 0)
  await rejects(db.query('UPDATE public.local_op_plan_items SET month_from = 6, month_to = 2 WHERE id = $1', [itemD1.id]), { code: '23514' })
  for (const alias of ['techD1', 'viewerA']) {
    await actor(alias)
    assert.equal(await affected('UPDATE public.local_op_plan_items SET month_from = 5, month_to = 6 WHERE id = $1', [itemD1.id]), 0, alias)
  }
  await actor('planA')
  assert.equal(await affected('UPDATE public.local_op_plan_items SET amount = 2500 WHERE id = $1', [itemD1.id]), 1, 'นักวิเคราะห์แก้งบได้')
})

// ── ชื่อตรงทะเบียน ──
await test('รายการที่ผูกทะเบียน: ชื่อ = ชื่อทางการเสมอ · ทะเบียนเปลี่ยนชื่อแล้วฉบับร่างตาม · ผูกข้ามแผนไม่ได้ · โครงการที่ใช้อยู่ลบไม่ได้', async () => {
  const item = await newItem('planA', opA.id, 'พิมพ์ชื่ออื่น', D1, { project: projA.id })
  assert.equal(item.item_name, projA.official_name)
  await actor('planA')
  await db.query(`UPDATE public.local_dev_plan_projects SET official_name = 'ถนน คสล. สายทดสอบ (แก้ชื่อ)' WHERE id = $1`, [projA.id])
  assert.equal((await rows('SELECT item_name FROM public.local_op_plan_items WHERE id = $1', [item.id]))[0].item_name, 'ถนน คสล. สายทดสอบ (แก้ชื่อ)')
  const other = await newPlan('planA', MA, 2561, 2565)
  const otherProj = await newProject('planA', other.id, 'โครงการแผนอื่น')
  await actor('planA')
  await rejects(db.query('UPDATE public.local_op_plan_items SET dev_project_id = $1 WHERE id = $2', [otherProj.id, itemD1.id]), { message: /ฉบับเดียวกับ/ })
  await rejects(db.query('DELETE FROM public.local_dev_plan_projects WHERE id = $1', [projA.id]), { message: /foreign key/ })
  await db.query('DELETE FROM public.local_op_plan_items WHERE id = $1', [item.id])
  await asRoot()
  await db.query('DELETE FROM public.local_dev_plans WHERE id = $1', [other.id])
})

// ── ประกาศ/ล็อก ──
await test('แก้สถานะตรงไม่ได้ (ต้องผ่าน RPC) · สร้างแถวเป็นประกาศแล้วตรงๆ ไม่ได้', async () => {
  await actor('adminA')
  await rejects(db.query(`UPDATE public.local_op_plans SET status = 'published', published_on = '2569-01-01' WHERE id = $1`, [opA.id]), { code: '42501', message: /ปุ่มประกาศ/ })
  await rejects(db.query(`UPDATE public.local_dev_plans SET status = 'published', published_on = '2569-01-01' WHERE id = $1`, [planA.id]), { code: '42501', message: /ปุ่มประกาศ/ })
  await rejects(db.query(`INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to, status, published_on) VALUES ($1, 2556, 2560, 'published', '2559-01-01')`, [MA]), { code: '42501' })
  await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no, status, published_on) VALUES ($1,$2,2568,'main',0,'published','2568-01-01')`, [MA, planA.id]), { code: '42501' })
})

await test('RPC ประกาศ: เฉพาะผู้จัดการแผน · ต้องมีวันที่ · วันที่อนาคตไม่ได้ · ลงผู้ประกาศจากผู้ล็อกอิน', async () => {
  for (const alias of ['officerD1', 'viewerA']) {
    await actor(alias)
    await rejects(setOp(opA.id, 'published', '2020-01-01'), DENIED)
  }
  await actor('planB')
  await rejects(setOp(opA.id, 'published', '2020-01-01'), { code: 'P0002' })
  await actor('anon')
  await rejects(setOp(opA.id, 'published', '2020-01-01'), DENIED)
  await actor('planA')
  await rejects(setOp(opA.id, 'published', null), { message: /วันที่ลงนาม/ })
  await rejects(setOp(opA.id, 'published', '2999-01-01'), { message: /ไม่เกินวันนี้/ })
  await setOp(opA.id, 'published', '2026-10-15')
  await asRoot()
  const r = (await rows('SELECT status, published_on::text, published_by FROM public.local_op_plans WHERE id = $1', [opA.id]))[0]
  assert.deepEqual([r.status, r.published_on, r.published_by], ['published', '2026-10-15', U.planA])
  await actor('planA')
  await rejects(setOp(opA.id, 'published', '2026-10-15'), { message: /สถานะปลายทาง/ })
})

await test('แผนดำเนินงานที่ประกาศแล้วแช่แข็ง: ทุกคนรวม superadmin แก้/เพิ่ม/ลบรายการไม่ได้ · ฉบับแก้ได้แค่หมายเหตุ · ลบไม่ได้', async () => {
  for (const alias of ['planA', 'adminA', 'superadmin', 'officerD1']) {
    await actor(alias)
    await rejects(db.query('UPDATE public.local_op_plan_items SET month_from = 1, month_to = 1 WHERE id = $1', [itemD1.id]), { code: '42501', message: /ประกาศแล้ว/ })
  }
  await actor('planA')
  await rejects(db.query(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, item_name) VALUES ($1,$2,'เพิ่มหลังประกาศ')`, [MA, opA.id]), { message: /ประกาศแล้ว/ })
  await rejects(db.query('DELETE FROM public.local_op_plan_items WHERE id = $1', [itemD1.id]), { message: /ประกาศแล้ว/ })
  await rejects(db.query('UPDATE public.local_op_plans SET fiscal_year = 2569 WHERE id = $1', [opA.id]), { code: '42501', message: /fiscal_year/ })
  assert.equal(await affected(`UPDATE public.local_op_plans SET note = 'หมายเหตุหลังประกาศ' WHERE id = $1`, [opA.id]), 1)
  await rejects(db.query('DELETE FROM public.local_op_plans WHERE id = $1', [opA.id]), { message: /ลบไม่ได้/ })
})

await test('ยกเลิกประกาศ: ต้องมีเหตุผล · ลงประวัติพร้อมเหตุผล · ฉบับถัดไปประกาศแล้วยกเลิกฉบับก่อนไม่ได้', async () => {
  await actor('planA')
  await rejects(setOp(opA.id, 'draft', null, '   '), { message: /เหตุผล/ })
  await setOp(opA.id, 'draft', null, 'กดประกาศผิดฉบับ')
  await asRoot()
  const r = (await rows('SELECT status, published_on, published_by FROM public.local_op_plans WHERE id = $1', [opA.id]))[0]
  assert.deepEqual([r.status, r.published_on, r.published_by], ['draft', null, null])
  const ev = (await eventsOf(opA.id)).filter(e => e.action === 'unpublish')
  assert.equal(ev.length, 1)
  assert.equal(ev[0].reason, 'กดประกาศผิดฉบับ')
  assert.equal(ev[0].actor, U.planA)

  const supp = await newOp('planA', planA.id, 2570, 'supplement', 1)
  await actor('planA')
  await setOp(opA.id, 'published', '2026-10-15')
  await setOp(supp.id, 'published', '2026-10-20')
  await rejects(setOp(opA.id, 'draft', null, 'ลองยกเลิกฉบับหลัก'), { message: /ครั้งถัดไป/ })
  await setOp(supp.id, 'draft', null, 'แก้เอกสาร')
  await setOp(opA.id, 'draft', null, 'กลับไปแก้')
  await asRoot()
  await db.query('DELETE FROM public.local_op_plans WHERE id = $1', [supp.id])
  const ctx = await rows(`SELECT current_setting('local_plan.status_rpc', true) AS rpc`)
  assert.ok(!ctx[0].rpc, 'ธงต้องถูกล้างหลัง RPC')
})

await test('หมวดเลขครั้ง: ฉบับหลัก = 0 เท่านั้น · ฉบับเพิ่มเติมต้อง ≥ 1 · เลขซ้ำในปีเดียวกันไม่ได้', async () => {
  await actor('planA')
  await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no) VALUES ($1,$2,2569,'main',1)`, [MA, planA.id]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no) VALUES ($1,$2,2569,'supplement',0)`, [MA, planA.id]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no) VALUES ($1,$2,2570,'main',0)`, [MA, planA.id]), { code: '23505' })
  await rejects(db.query('UPDATE public.local_op_plans SET extended_due_on = $2 WHERE id = $1', [opA.id, '2026-12-31']), { code: '23514' })
  assert.equal(await affected(`UPDATE public.local_op_plans SET basis = 'annual_budget', basis_on = '2026-09-20', extended_due_on = '2026-12-31', extension_ref_no = 'พร 0001/2569' WHERE id = $1`, [opA.id]), 1)
})

await test('แผนพัฒนาที่ประกาศแล้ว: ชื่อ/ช่วงปี/โครงการเดิม/วงเงินแช่แข็ง · แก้กอง-หมายเหตุได้ · เพิ่มโครงการต้องระบุครั้งที่+เลขประกาศ', async () => {
  await actor('planA')
  await setDev(planA.id, 'published', '2021-10-01')
  await rejects(db.query(`UPDATE public.local_dev_plans SET title = 'ชื่อใหม่' WHERE id = $1`, [planA.id]), { code: '42501', message: /title/ })
  await rejects(db.query('UPDATE public.local_dev_plans SET year_to = 2571 WHERE id = $1', [planA.id]), { code: '42501', message: /year_to/ })
  await rejects(db.query(`UPDATE public.local_dev_plan_projects SET official_name = 'แก้หลังประกาศ' WHERE id = $1`, [projA.id]), { code: '42501', message: /official_name/ })
  assert.equal(await affected('UPDATE public.local_dev_plan_projects SET department_id = $2, note = $3 WHERE id = $1', [projA.id, D2, 'ย้ายกอง']), 1)
  await rejects(db.query('UPDATE public.local_dev_plan_project_years SET amount = 1 WHERE project_id = $1 AND fiscal_year = 2570', [projA.id]), { code: '42501', message: /วงเงินรายปี/ })
  await rejects(db.query('DELETE FROM public.local_dev_plan_projects WHERE id = $1', [projA.id]), { code: '42501' })
  await rejects(db.query('DELETE FROM public.local_dev_plans WHERE id = $1', [planA.id]), { code: '42501' })
  await rejects(db.query(`INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, official_name) VALUES ($1,$2,'เพิ่มตรงๆ')`, [MA, planA.id]), { code: '42501', message: /เพิ่มเติม/ })
})

await test('การเพิ่มเติมแผน: โครงการครั้งที่ ≥ 1 เพิ่ม/แก้วงเงินได้ · หลังมีโครงการเพิ่มเติม ยกเลิกประกาศแผนไม่ได้ · มีแผนดำเนินงานประกาศแล้วก็ไม่ได้', async () => {
  const added = await newProject('planA', planA.id, 'โครงการเพิ่มเติม', D1, { rev: 1, ref: 'ประกาศเพิ่มเติม 1/2568' })
  await actor('planA')
  await db.query('INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year, amount) VALUES ($1,$2,2570,9)', [added.id, MA])
  await rejects(db.query('UPDATE public.local_dev_plan_projects SET revision_ref_no = NULL WHERE id = $1', [added.id]), { code: '42501' })
  await rejects(setDev(planA.id, 'draft', null, 'ยกเลิก'), { message: /เพิ่มเติม/ })
  await db.query('DELETE FROM public.local_dev_plan_projects WHERE id = $1', [added.id])
  await setOp(opA.id, 'published', '2026-10-15')
  await rejects(setDev(planA.id, 'draft', null, 'ยกเลิก'), { message: /แผนการดำเนินงาน/ })
  await setOp(opA.id, 'draft', null, 'เพื่อทดสอบ')
  await setDev(planA.id, 'draft', null, 'ลงวันที่ผิด')
  await asRoot()
  const ev = (await eventsOf(planA.id)).map(e => e.action)
  assert.deepEqual(ev.filter(a => a === 'publish' || a === 'unpublish'), ['publish', 'unpublish'])
})

// ── ประวัติ ──
await test('ประวัติ: เก็บค่าเดิม→ใหม่เฉพาะช่องที่เปลี่ยน + ผู้แก้จากผู้ล็อกอิน · ลากเรียงไม่ลง', async () => {
  const before = (await eventsOf(itemD2.id)).length
  await actor('planA')
  await db.query('UPDATE public.local_op_plan_items SET amount = 7000 WHERE id = $1', [itemD2.id])
  await db.query('UPDATE public.local_op_plan_items SET sort_order = 99 WHERE id = $1', [itemD2.id])
  const ev = await eventsOf(itemD2.id)
  assert.equal(ev.length, before + 1, 'ลากเรียงต้องไม่ลงประวัติ')
  const last = ev.at(-1)
  assert.equal(last.action, 'update')
  assert.equal(last.actor, U.planA)
  assert.equal(last.parent_id, opA.id)
  assert.deepEqual(Object.keys(last.changes), ['amount'])
  assert.equal(Number(last.changes.amount[0]), 5000)
  assert.equal(Number(last.changes.amount[1]), 7000)
  const insertEv = ev[0]
  assert.equal(insertEv.action, 'insert')
  assert.equal(insertEv.changes.item_name, 'รายการกองคลัง')
})

await test('ประวัติ: ผู้ใช้เพิ่ม/แก้/ลบไม่ได้แม้เป็น superadmin · วงเงินรายปีบอกปีเสมอ', async () => {
  for (const alias of ['superadmin', 'adminA', 'planA']) {
    await actor(alias)
    await rejects(db.query(`INSERT INTO public.local_plan_events (municipality_id, entity, entity_id, action) VALUES ($1,'op_item',$2,'update')`, [MA, itemD1.id]), DENIED)
    await rejects(db.query(`UPDATE public.local_plan_events SET reason = 'ปลอม'`), DENIED)
    await rejects(db.query('DELETE FROM public.local_plan_events'), DENIED)
  }
  await actor('planA')
  await db.query('UPDATE public.local_dev_plan_project_years SET amount = 200000 WHERE project_id = $1 AND fiscal_year = 2570', [projA.id])
  const last = (await eventsOf(projA.id)).filter(e => e.entity === 'dev_project_year').at(-1)
  assert.deepEqual(last.changes.fiscal_year, [2570, 2570])
  assert.equal(Number(last.changes.amount[1]), 200000)
})

await test('ผู้สร้าง/ผู้แก้/เวลา ปลอมไม่ได้', async () => {
  await actor('planA')
  const r = await rows(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, item_name, created_by, updated_by, created_at)
    VALUES ($1,$2,'ปลอมผู้สร้าง',$3,$3,'2000-01-01') RETURNING *`, [MA, opA.id, U.adminA])
  assert.equal(r[0].created_by, U.planA)
  assert.equal(r[0].updated_by, U.planA)
  assert.ok(new Date(r[0].created_at).getFullYear() > 2000)
  await actor('officerD1')
  await rejects(db.query('UPDATE public.local_op_plan_items SET created_by = $2 WHERE id = $1 AND department_id IS NOT NULL', [itemD1.id, U.officerD1]), { code: '42501', message: /created_by/ })
  await actor('planA')
  await db.query('UPDATE public.local_op_plan_items SET created_by = $2, note = $3 WHERE id = $1', [r[0].id, U.adminA, 'x'])
  assert.equal((await rows('SELECT created_by FROM public.local_op_plan_items WHERE id = $1', [r[0].id]))[0].created_by, U.planA)
  await db.query('DELETE FROM public.local_op_plan_items WHERE id = $1', [r[0].id])
})

// ── ลบ / TRUNCATE ──
await test('ลบแผนฉบับร่าง: โครงการ/วงเงินหายตาม · มีแผนดำเนินงานอ้างอยู่ลบไม่ได้', async () => {
  const p = await newPlan('planA', MA, 2551, 2555)
  const pr = await newProject('planA', p.id, 'โครงการในร่าง')
  await actor('planA')
  await db.query('INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year) VALUES ($1,$2,2552)', [pr.id, MA])
  assert.equal(await affected('DELETE FROM public.local_dev_plans WHERE id = $1', [p.id]), 1)
  await asRoot()
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.local_dev_plan_projects WHERE id = $1', [pr.id]))[0].n, 0)
  await actor('planA')
  await rejects(db.query('DELETE FROM public.local_dev_plans WHERE id = $1', [planA.id]), { message: /foreign key/ })
})

await test('ลบ อปท. ทั้งแถวได้ (ประวัติไม่ทำให้ FK พัง) · ฉบับร่างลบแล้วรายการหายตาม', async () => {
  await db.exec(`
    INSERT INTO public.local_dev_plans (id, municipality_id, year_from, year_to) VALUES ('${id(901)}', '${MC}', 2566, 2570);
    INSERT INTO public.local_dev_plan_projects (id, municipality_id, dev_plan_id, official_name) VALUES ('${id(902)}', '${MC}', '${id(901)}', 'โครงการ ซี');
    INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year) VALUES ('${id(902)}', '${MC}', 2570);
    INSERT INTO public.local_op_plans (id, municipality_id, dev_plan_id, fiscal_year) VALUES ('${id(903)}', '${MC}', '${id(901)}', 2570);
    INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, item_name) VALUES ('${MC}', '${id(903)}', 'รายการ ซี');
  `)
  await db.query('DELETE FROM public.municipalities WHERE id = $1', [MC])
  for (const t of READ_TABLES) {
    assert.equal((await rows(`SELECT count(*)::int AS n FROM public.${t} WHERE municipality_id = $1`, [MC]))[0].n, 0, t)
  }
})

await test('TRUNCATE ไม่ได้ · RPC ของ anon ไม่ได้ · ฟังก์ชันภายใน trigger เรียกตรงไม่ได้', async () => {
  await actor('adminA')
  for (const t of READ_TABLES) await rejects(db.exec(`TRUNCATE public.${t}`), DENIED)
  await rejects(db.query(`SELECT public.local_plan_changed_outside('{}'::jsonb, '{}'::jsonb, ARRAY['x'])`), DENIED)
  await actor('anon')
  await rejects(db.query('SELECT public.local_plan_is_manager($1)', [MA]), DENIED)
  await rejects(setDev(planA.id, 'published', '2020-01-01'), DENIED)
})

await test('ผลตรวจ ก1: ฉบับร่างมีโครงการตั้งครั้งที่ ≥ 1 → ประกาศไม่ได้ (กันหลบล็อกหลังประกาศ) · ตั้งกลับเป็น 0 แล้วประกาศได้', async () => {
  const p = await newPlan('planA', MA, 2546, 2550)
  const pr = await newProject('planA', p.id, 'ตั้งครั้งที่หลอก', D1, { rev: 1, ref: 'x' })
  await actor('planA')
  await rejects(setDev(p.id, 'published', '2020-01-01'), { code: '22023', message: /ต้องเป็น 0 ก่อนประกาศ/ })
  await db.query('UPDATE public.local_dev_plan_projects SET added_in_revision = 0, revision_ref_no = NULL WHERE id = $1', [pr.id])
  await setDev(p.id, 'published', '2020-01-01')
  await rejects(db.query(`UPDATE public.local_dev_plan_projects SET official_name = 'แก้หลังประกาศ' WHERE id = $1`, [pr.id]), { code: '42501' })
  await asRoot()
  await db.query('DELETE FROM public.local_dev_plans WHERE id = $1', [p.id])
})

await test('plan_role: ย้ายข้าม อปท. → ล้างเอง · บัญชีที่ยังไม่มีสังกัด ตั้งสังกัดกับสิทธิ์พร้อมกันได้', async () => {
  await db.query(`UPDATE public.profiles SET plan_role = 'plan_admin' WHERE id = $1`, [U.staffTarget])
  await actor('superadmin')
  await db.query(`SELECT public.admin_update_user($1, jsonb_build_object('municipality_id', $2::text, 'department_id', NULL))`, [U.staffTarget, MB])
  await asRoot()
  assert.equal((await rows('SELECT plan_role FROM public.profiles WHERE id = $1', [U.staffTarget]))[0].plan_role, null)
  await db.query('UPDATE public.profiles SET municipality_id = NULL WHERE id = $1', [U.staffTarget])
  await actor('superadmin')
  await db.query(`SELECT public.admin_update_user($1, jsonb_build_object('municipality_id', $2::text, 'plan_role', 'plan_admin'))`, [U.staffTarget, MA])
  await asRoot()
  assert.equal((await rows('SELECT plan_role FROM public.profiles WHERE id = $1', [U.staffTarget]))[0].plan_role, 'plan_admin')
  await db.query('UPDATE public.profiles SET plan_role = NULL, department_id = $2 WHERE id = $1', [U.staffTarget, D1])
})

await test('ลบกอง: ผู้ลบที่ไม่ใช่ผู้จัดการแผนลบได้เมื่อรายการอยู่ในฉบับร่าง (กองหายจริงเท่านั้น) · ตั้งกองว่างเองยังไม่ได้', async () => {
  const DX = id(15)
  await db.query(`INSERT INTO public.departments VALUES ($1, $2, 'กองทดลอง')`, [DX, MA])
  await db.exec('GRANT SELECT, DELETE ON public.departments TO authenticated')
  const it = await newItem('planA', opA.id, 'รายการของกองที่จะถูกลบ', DX)
  await db.query('UPDATE public.profiles SET department_id = $2 WHERE id = $1', [U.staffTarget, DX])
  await actor('staffTarget')
  await rejects(db.query('UPDATE public.local_op_plan_items SET department_id = NULL WHERE id = $1', [it.id]), { code: '42501', message: /department_id/ })
  await asRoot()
  await db.query('UPDATE public.profiles SET department_id = $2 WHERE id = $1', [U.staffTarget, D1])
  await actor('staffD1')
  assert.equal(await affected('DELETE FROM public.departments WHERE id = $1', [DX]), 1)
  await asRoot()
  const r = await rows('SELECT department_id FROM public.local_op_plan_items WHERE id = $1', [it.id])
  assert.deepEqual(r, [{ department_id: null }])
  await db.query('DELETE FROM public.local_op_plan_items WHERE id = $1', [it.id])
  await db.exec('REVOKE SELECT, DELETE ON public.departments FROM authenticated')
})

await test('โครงการที่ฉบับประกาศอ้างถึง: โครงการเพิ่มเติมแก้ชื่อ/วงเงิน/ลบไม่ได้ · แก้กอง-หมายเหตุได้ · ยกเลิกประกาศแล้วแก้ได้อีก', async () => {
  const p = await newPlan('planA', MA, 2541, 2545)
  await actor('planA')
  await setDev(p.id, 'published', '2020-01-01')
  await asRoot()
  const added = await newProject('planA', p.id, 'โครงการเพิ่มเติมที่ถูกใช้', D1, { rev: 1, ref: 'ประกาศเพิ่มเติม 1/2544' })
  await actor('planA')
  await db.query('INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year, amount) VALUES ($1,$2,2545,10)', [added.id, MA])
  await asRoot()
  const op = await newOp('planA', p.id, 2545)
  await newItem('planA', op.id, 'ชื่อใดก็ได้', D1, { project: added.id })
  await actor('planA')
  assert.equal(await affected(`UPDATE public.local_dev_plan_projects SET official_name = 'แก้ก่อนประกาศได้' WHERE id = $1`, [added.id]), 1)
  await setOp(op.id, 'published', '2020-02-01')
  await rejects(db.query(`UPDATE public.local_dev_plan_projects SET official_name = 'แก้หลังถูกใช้' WHERE id = $1`, [added.id]), { code: '42501', message: /official_name/ })
  await rejects(db.query('UPDATE public.local_dev_plan_project_years SET amount = 99 WHERE project_id = $1', [added.id]), { code: '42501', message: /วงเงินรายปี/ })
  await rejects(db.query('INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year, amount) VALUES ($1,$2,2544,1)', [added.id, MA]), { code: '42501', message: /วงเงินรายปี/ })
  await rejects(db.query('DELETE FROM public.local_dev_plan_projects WHERE id = $1', [added.id]), { code: '42501', message: /ลบไม่ได้/ })
  assert.equal(await affected('UPDATE public.local_dev_plan_projects SET department_id = $2, note = $3 WHERE id = $1', [added.id, D2, 'ย้ายกอง']), 1)
  await setOp(op.id, 'draft', null, 'ทดสอบปลดล็อก')
  assert.equal(await affected(`UPDATE public.local_dev_plan_projects SET official_name = 'แก้หลังยกเลิกประกาศ' WHERE id = $1`, [added.id]), 1)
  await asRoot()
  await db.query('DELETE FROM public.local_op_plans WHERE id = $1', [op.id])
  await db.query('DELETE FROM public.local_dev_plans WHERE id = $1', [p.id])
})

await test('โครงการเดิมของแผนพัฒนาฉบับร่าง ที่ฉบับประกาศอ้างถึง: แก้ชื่อไม่ได้เช่นกัน', async () => {
  const p = await newPlan('planA', MA, 2536, 2540)
  const pr = await newProject('planA', p.id, 'โครงการในแผนร่าง')
  const op = await newOp('planA', p.id, 2540)
  await newItem('planA', op.id, 'x', D1, { project: pr.id })
  await actor('planA')
  await setOp(op.id, 'published', '2020-02-01')
  await rejects(db.query(`UPDATE public.local_dev_plan_projects SET official_name = 'แก้' WHERE id = $1`, [pr.id]), { code: '42501', message: /ถูกอ้าง/ })
  await asRoot()
  await db.query('DELETE FROM public.local_op_plans WHERE id = $1', [op.id])
  await db.query('DELETE FROM public.local_dev_plans WHERE id = $1', [p.id])
})

await test('ด่านท้ายไฟล์ของไฟล์ 3: มีครบ 21 policy', async () => {
  const n = (await rows(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)`, [READ_TABLES]))[0].n
  assert.equal(n, 21)
})

console.log(`\nlocal-plan-db: ผ่านทั้งหมด ${cases} หมวด`)
await db.close()
