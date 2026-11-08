// เมนู "แผนพัฒนาท้องถิ่น" แท็บติดตามผล (PR R1-A) — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   npm run test:local-plan:progress-db -- --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: ชุด R0-A (20261109100000/100100/100200) → 20261110100000 (DDL) → 20261110100100 (trigger/policy/RPC) → 20261110100200 (FK ก่อสร้าง)
//
// ตรวจ: (1) ด่านหัวไฟล์ + รันซ้ำได้ (2) ผลบันทึกได้เฉพาะฉบับประกาศแล้ว (3) เมทริกซ์สิทธิ์ทุกบทบาท (4) อปท./ปีงบ/กอง ระบบคัดเอง
// (5) กติกาวันที่/สถานะ (6) สายรายการข้ามฉบับแก้ไข + กติกา origin/source (7) ประกาศ/ยกเลิกประกาศย้ายกองของผลตาม + กันผลลอย
// (8) ประวัติ (รวมของเดิมยังลงครบหลังเขียนทับฟังก์ชัน) (9) ข้อมูลรายงานประจำปี (10) RPC ขั้นโครงการก่อสร้าง (11) FK ก่อสร้าง (12) สิทธิ์ตาราง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const r0 = [
  await readMigration('20261109100000_profiles_plan_role.sql'),
  await readMigration('20261109100100_local_plan_tables.sql'),
  await readMigration('20261109100200_local_plan_rls_triggers.sql'),
]
const tablesSql = await readMigration('20261110100000_local_plan_progress_tables.sql')
const rlsSql = await readMigration('20261110100100_local_plan_progress_rls.sql')
const fkSql = await readMigration('20261110100200_civil_registry_ref_fk.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const D1 = id(11) // กองช่าง เอ
const D2 = id(12) // กองการศึกษา เอ
const DG = id(14) // สำนักปลัด เอ
const DB1 = id(13)
const U = {
  superadmin: id(101), adminA: id(102), adminB: id(103), planA: id(104), officerD1: id(106), officerD2: id(107),
  staffD1: id(108), techD1: id(109), viewerA: id(110), councilA: id(112), citizenA: id(113),
}
const ROLE = { superadmin: 'superadmin', adminA: 'admin', adminB: 'admin', planA: 'staff', officerD1: 'officer', officerD2: 'officer',
  staffD1: 'staff', techD1: 'technician', viewerA: 'viewer', councilA: 'council', citizenA: 'citizen' }
const MUNI = { superadmin: null, adminB: MB }
const DEPT = { planA: DG, officerD1: D1, officerD2: D2, staffD1: D1, techD1: D1 }

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
CREATE FUNCTION public.admin_update_user(p_user_id uuid, p_changes jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION public.guard_profile_privileged_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER guard_profile_privileged_update_trigger BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_update();
CREATE FUNCTION public.audit_managed_profile_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_audit_managed_profile_update AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_managed_profile_update();
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- ตัวแทน civil_projects (เฉพาะช่องที่ไฟล์ 2–3 ใช้) · RLS เปิดไม่มี policy = เลียนแบบ #649 ที่สำนักปลัด/ผู้บริหารอ่านตรงไม่ได้
CREATE TABLE public.civil_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
  fiscal_year text NOT NULL, title text NOT NULL, stage text, stage_changed_at timestamptz, registry_ref uuid);
ALTER TABLE public.civil_projects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.civil_projects TO authenticated;

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ'), ('${MB}', 'อปท. บี');
INSERT INTO public.departments VALUES ('${D1}', '${MA}', 'กองช่าง'), ('${D2}', '${MA}', 'กองการศึกษา'), ('${DG}', '${MA}', 'สำนักปลัด'), ('${DB1}', '${MB}', 'กองช่าง บี');
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
await test('ด่านหัวไฟล์: รันก่อนชุด R0 / ข้ามไฟล์ 1 → พังพร้อมชื่อไฟล์ที่ต้องรันก่อน', async () => {
  await rejects(db.exec(tablesSql), { message: /20261109100200/ })
  await db.exec('ROLLBACK').catch(() => {})
  for (const sql of r0) await db.exec(sql)
  await rejects(db.exec(rlsSql), { message: /20261110100000/ })
  await db.exec('ROLLBACK').catch(() => {})
})

await db.exec(tablesSql)
await db.exec(rlsSql)
await db.exec(fkSql)
// รันซ้ำทั้งชุด (รวม R0 ซึ่งเขียน local_plan_log_event ฉบับเก่ากลับ) แล้วรันชุดนี้ทับอีกรอบ ต้องไม่พัง
for (const sql of r0) await db.exec(sql)
await db.exec(tablesSql)
await db.exec(rlsSql)
await db.exec(fkSql)
await db.query(`UPDATE public.profiles SET plan_role = 'plan_admin' WHERE id = $1`, [U.planA])

// ── ตัวช่วยสร้างข้อมูล ──
const one = async (as, sql, params) => { await actor(as); const r = await rows(sql, params); await asRoot(); return r[0] }
const newOp = (fy, rev, extra = {}) => one('planA',
  `INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no, source_op_plan_id)
   VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [MA, extra.plan ?? PLAN.id, fy, rev === 0 ? 'main' : (extra.kind ?? 'amendment'), rev, extra.source ?? null])
const newItem = (opId, name, dept = D1, extra = {}) => one('planA',
  `INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, department_id, item_name, amount, month_from, month_to, dev_project_id, origin_item_id)
   VALUES ($1,$2,$3,$4,1000,1,3,$5,$6) RETURNING *`, [MA, opId, dept, name, extra.project ?? null, extra.origin ?? null])
const setOp = async (as, opId, status, date = null, reason = null) => {
  await actor(as)
  await db.query('SELECT public.local_op_plan_set_status($1,$2,$3,$4,$5)', [opId, status, date, null, reason])
  await asRoot()
}
const progressOf = async lineage => (await rows('SELECT * FROM public.local_op_item_progress WHERE lineage_id = $1', [lineage]))[0]
const eventsOf = async entityId => rows('SELECT * FROM public.local_plan_events WHERE entity_id = $1 ORDER BY id', [entityId])
const TODAY = (await rows(`SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS d`))[0].d

const PLAN = await one('planA', `INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to, is_current) VALUES ($1, 2566, 2570, true) RETURNING *`, [MA])
const P1 = await one('planA', `INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, department_id, official_name) VALUES ($1,$2,$3,'ถนน คสล. หมู่ 5') RETURNING *`, [MA, PLAN.id, D1])
const P2 = await one('planA', `INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, department_id, official_name) VALUES ($1,$2,$3,'ฝายชะลอน้ำ หมู่ 7') RETURNING *`, [MA, PLAN.id, D1])
const MAIN = await newOp(2570, 0)
const I1 = await newItem(MAIN.id, 'ซ่อมถนนลูกรัง', D1)
const I2 = await newItem(MAIN.id, 'แข่งกีฬาต้านยาเสพติด', D2)
const I3 = await newItem(MAIN.id, 'x', D1, { project: P1.id })
const I4 = await newItem(MAIN.id, 'ลอกท่อระบายน้ำ', D1)
const ins = (lineage, status = 'in_progress', extra = {}) => db.query(
  `INSERT INTO public.local_op_item_progress (lineage_id, status, done_on, reason, started_on, municipality_id, fiscal_year, department_id)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [lineage, status, extra.done ?? null, extra.reason ?? null, extra.started ?? null, extra.muni ?? MA, extra.fy ?? 2570, extra.dept ?? null])

await test('ฉบับร่าง: บันทึกผลไม่ได้ทุกคน (ยังไม่ใช่แผน)', async () => {
  await actor('planA')
  await rejects(ins(I1.id), { code: '42501', message: /ประกาศแล้ว/ })
  await actor('officerD1')
  await rejects(ins(I1.id), DENIED)
})

await setOp('planA', MAIN.id, 'published', '2026-10-15')

await test('สิทธิ์: กองบันทึกได้เฉพาะรายการของกองตัวเอง · ช่าง/ผู้บริหาร/สภา/ประชาชน/อปท.อื่น/anon ไม่ได้', async () => {
  await actor('officerD1')
  await ins(I1.id)
  await rejects(ins(I2.id), DENIED)                       // รายการของกองการศึกษา
  await actor('officerD2')
  await ins(I2.id)
  for (const alias of ['techD1', 'viewerA', 'councilA', 'citizenA', 'adminB']) {
    await actor(alias)
    await rejects(ins(I4.id), DENIED)
  }
  await actor('anon')
  await rejects(ins(I4.id), DENIED)
  await actor('staffD1')
  assert.equal(await affected(`UPDATE public.local_op_item_progress SET note = 'staff กองเดียวกัน' WHERE lineage_id = $1`, [I1.id]), 1)
  assert.equal(await affected(`UPDATE public.local_op_item_progress SET note = 'ข้ามกอง' WHERE lineage_id = $1`, [I2.id]), 0)
  await actor('adminA')
  await ins(I4.id)
  await actor('superadmin')
  assert.equal(await affected(`DELETE FROM public.local_op_item_progress WHERE lineage_id = $1`, [I4.id]), 1)
})

await test('อ่าน: เจ้าหน้าที่ทุกกอง + ผู้บริหารเห็นทุกแถวของ อปท. ตัวเอง · สภา/ประชาชน/อปท.อื่น ไม่เห็น', async () => {
  for (const alias of ['officerD2', 'techD1', 'viewerA', 'planA']) {
    await actor(alias)
    assert.equal((await rows('SELECT 1 FROM public.local_op_item_progress')).length, 2, alias)
  }
  for (const alias of ['councilA', 'citizenA', 'adminB']) {
    await actor(alias)
    assert.equal((await rows('SELECT 1 FROM public.local_op_item_progress')).length, 0, alias)
  }
  await actor('anon')
  await rejects(db.query('SELECT 1 FROM public.local_op_item_progress'), DENIED)
})

await test('อปท./ปีงบ/กอง: ระบบคัดจากฉบับประกาศ ส่งค่าปลอมมาก็ถูกทับ', async () => {
  await actor('planA')
  await ins(I4.id, 'in_progress', { muni: MB, fy: 2599, dept: D2 })
  await asRoot()
  const p = await progressOf(I4.id)
  assert.equal(p.municipality_id, MA)
  assert.equal(p.fiscal_year, 2570)
  assert.equal(p.department_id, D1)
  await actor('officerD1')                                // กองช่างย้ายผลไปกองอื่นเองไม่ได้ (ถูกทับกลับ D1)
  await db.query(`UPDATE public.local_op_item_progress SET department_id = $2 WHERE lineage_id = $1`, [I4.id, D2])
  await asRoot()
  assert.equal((await progressOf(I4.id)).department_id, D1)
  await actor('officerD1')
  await rejects(db.query(`UPDATE public.local_op_item_progress SET lineage_id = $2 WHERE lineage_id = $1`, [I4.id, I3.id]), { message: /ย้ายผล/ })
})

await test('สถานะ/วันที่: เสร็จต้องมีวันที่ · ไม่ได้ทำต้องมีเหตุผล · ไม่เกินวันนี้ · ไม่ก่อนเริ่มปีงบ · วันเริ่ม ≤ วันเสร็จ', async () => {
  await actor('officerD1')
  const upd = (set, params = []) => db.query(`UPDATE public.local_op_item_progress SET ${set} WHERE lineage_id = $1`, [I1.id, ...params])
  await rejects(upd(`status = 'done'`), { code: '23514' })
  await rejects(upd(`status = 'in_progress', done_on = '2026-10-20'`), { code: '23514' })   // กำลังทำแต่มีวันเสร็จ
  await rejects(upd(`status = 'not_done', reason = '   '`), { code: '23514' })
  await rejects(upd(`status = 'done', done_on = (now() AT TIME ZONE 'Asia/Bangkok')::date + 1`), { code: '22023' })
  await rejects(upd(`status = 'done', done_on = '2026-09-30'`), { code: '22023', message: /ก่อนเริ่มปีงบ/ })
  await rejects(upd(`started_on = (now() AT TIME ZONE 'Asia/Bangkok')::date + 1`), { code: '22023' })
  await rejects(upd(`status = 'done', done_on = '2026-10-05', started_on = '2026-10-10'`), { code: '23514' })
  await upd(`status = 'done', done_on = '2026-10-01', started_on = '2026-10-01'`)
  await upd(`status = 'not_done', done_on = NULL, reason = '  งบโอนไปโครงการอื่น  '`)
  await asRoot()
  assert.equal((await progressOf(I1.id)).reason, 'งบโอนไปโครงการอื่น')
  await actor('officerD1')
  await upd(`status = 'done', done_on = $2, reason = NULL`, [TODAY])
})

await test('กลับเป็นยังไม่ดำเนินการ = ลบแถว (กองลบของตัวเองได้ ลบของกองอื่นไม่ได้)', async () => {
  await actor('officerD2')
  assert.equal(await affected('DELETE FROM public.local_op_item_progress WHERE lineage_id = $1', [I4.id]), 0)
  await actor('officerD1')
  assert.equal(await affected('DELETE FROM public.local_op_item_progress WHERE lineage_id = $1', [I4.id]), 1)
})

// ── ฉบับแก้ไข ──
const AMEND = await newOp(2570, 1, { source: MAIN.id })
const A1 = await newItem(AMEND.id, 'ซ่อมถนนลูกรัง', D2, { origin: I1.id })     // ฉบับแก้ไขย้ายไปกองการศึกษา
const A2 = await newItem(AMEND.id, 'แข่งกีฬาต้านยาเสพติด', D2, { origin: I2.id })
const A4 = await newItem(AMEND.id, 'ลอกท่อระบายน้ำ', D1, { origin: I4.id })

await test('สายรายการ: ต้นทางต้องเป็นฉบับครั้งก่อน ปีเดียวกัน · ตั้งได้ตอนเพิ่มเท่านั้น · ฉบับเดียวมีสายซ้ำไม่ได้', async () => {
  assert.equal(A1.origin_item_id, I1.id)
  await actor('planA')
  await rejects(db.query(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, item_name, origin_item_id) VALUES ($1,$2,'ซ้ำ',$3)`,
    [MA, AMEND.id, I1.id]), { code: '23505' })
  await rejects(db.query(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, item_name, origin_item_id) VALUES ($1,$2,'ต้นทางฉบับเดียวกัน',$3)`,
    [MA, AMEND.id, A2.id]), { code: '23514' })
  const y69 = await newOp(2569, 0)
  await actor('planA')
  await rejects(db.query(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, item_name, origin_item_id) VALUES ($1,$2,'ข้ามปี',$3)`,
    [MA, y69.id, I3.id]), { code: '23514' })
  await rejects(db.query(`UPDATE public.local_op_plan_items SET origin_item_id = $2 WHERE id = $1`, [A4.id, I3.id]), { message: /ตอนเพิ่มแถว/ })
  await rejects(db.query(`UPDATE public.local_op_plan_items SET origin_item_id = NULL WHERE id = $1`, [A4.id]), { message: /ตอนเพิ่มแถว/ })
  await asRoot()
  await db.query('DELETE FROM public.local_op_plans WHERE id = $1', [y69.id])
})

await test('ฉบับต้นทาง: ต้องเป็นฉบับครั้งก่อนของปีเดียวกัน · แก้ภายหลังไม่ได้', async () => {
  await actor('planA')
  await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no, source_op_plan_id)
    VALUES ($1,$2,2570,'amendment',2,$3)`, [MA, PLAN.id, id(999)]), { code: '23503' })
  await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no, source_op_plan_id)
    VALUES ($1,$2,2569,'main',0,$3)`, [MA, PLAN.id, MAIN.id]), { code: '23514' })
  await rejects(db.query(`UPDATE public.local_op_plans SET source_op_plan_id = NULL WHERE id = $1`, [AMEND.id]), { message: /ตอนสร้างฉบับ/ })
})

await test('ผ่านแถวในฉบับแก้ไข (ร่าง) ก็ผูกที่ต้นสาย · กองยังตามฉบับประกาศล่าสุด (ฉบับหลัก)', async () => {
  await actor('officerD1')
  await ins(A4.id)                                         // ส่ง id แถวฉบับแก้ไข
  await asRoot()
  const p = await progressOf(I4.id)
  assert.ok(p, 'ต้องผูกที่ต้นสาย I4')
  assert.equal((await rows('SELECT 1 FROM public.local_op_item_progress WHERE lineage_id = $1', [A4.id])).length, 0)
  // ฉบับแก้ไขยังเป็นร่าง → กองช่างยังแก้ผล I1 ได้ (ฉบับประกาศล่าสุดยังให้ I1 อยู่กองช่าง)
  await actor('officerD1')
  assert.equal(await affected(`UPDATE public.local_op_item_progress SET note = 'ก่อนประกาศฉบับแก้ไข' WHERE lineage_id = $1`, [I1.id]), 1)
})

await test('ประกาศฉบับแก้ไข → ผล I1 ย้ายไปกองการศึกษาเอง · กองช่างแก้ต่อไม่ได้ · กองการศึกษาแก้ได้', async () => {
  await setOp('planA', AMEND.id, 'published', '2026-11-01')
  assert.equal((await progressOf(I1.id)).department_id, D2)
  await actor('officerD1')
  assert.equal(await affected(`UPDATE public.local_op_item_progress SET note = 'กองเดิม' WHERE lineage_id = $1`, [I1.id]), 0)
  await actor('officerD2')
  assert.equal(await affected(`UPDATE public.local_op_item_progress SET note = 'กองใหม่' WHERE lineage_id = $1`, [I1.id]), 1)
})

await test('ยกเลิกประกาศฉบับแก้ไข → กองกลับตามฉบับหลัก · ยกเลิกประกาศฉบับหลักที่มีผลไม่มีที่รองรับ = ไม่ได้', async () => {
  await setOp('planA', AMEND.id, 'draft', null, 'กดพลาด')
  assert.equal((await progressOf(I1.id)).department_id, D1)
  await rejects(setOp('planA', MAIN.id, 'draft', null, 'ทดสอบ'), { code: '42501', message: /ผลดำเนินการบันทึกแล้ว/ })
  await asRoot()
  assert.equal((await rows('SELECT status FROM public.local_op_plans WHERE id = $1', [MAIN.id]))[0].status, 'published')
  await setOp('planA', AMEND.id, 'published', '2026-11-02')
})

await test('ต้นสายลบไม่ได้ขณะมีฉบับอื่นคัดไป (RESTRICT) · ลบฉบับปลายก่อนแล้วลบต้นได้', async () => {
  const d0 = await newOp(2569, 0)
  const x = await newItem(d0.id, 'งานร่าง', D1)
  const d1 = await newOp(2569, 1, { source: d0.id })
  await newItem(d1.id, 'งานร่าง', D1, { origin: x.id })
  await actor('planA')
  await rejects(db.query('DELETE FROM public.local_op_plans WHERE id = $1', [d0.id]), { code: '23001' })
  await db.query('DELETE FROM public.local_op_plans WHERE id = $1', [d1.id])
  await db.query('DELETE FROM public.local_op_plans WHERE id = $1', [d0.id])
})

await test('ประวัติ: ผลลง op_progress (entity_id = ต้นสาย) ครบ เพิ่ม/แก้/ลบ · ผู้ใช้เขียนประวัติเองไม่ได้', async () => {
  await asRoot()
  const ev = await eventsOf(I4.id)
  const progressEvents = ev.filter(e => e.entity === 'op_progress')
  assert.deepEqual(progressEvents.map(e => e.action), ['insert', 'delete', 'insert', 'delete', 'insert'])
  assert.equal(progressEvents.at(-1).actor, U.officerD1)
  assert.deepEqual(progressEvents.map(e => e.actor), [U.adminA, U.superadmin, U.planA, U.officerD1, U.officerD1])
  // อัปเดตที่ trigger ทับกลับเป็นค่าเดิม (กองช่างพยายามย้ายกอง) ต้องไม่ลงประวัติปลอม
  assert.equal(progressEvents.filter(e => e.action === 'update').length, 0)
  const sync = (await eventsOf(I1.id)).filter(e => e.entity === 'op_progress' && e.changes.department_id)
  assert.ok(sync.length >= 2, 'การย้ายกองตอนประกาศ/ยกเลิกต้องลงประวัติ')
  await actor('officerD1')
  await rejects(db.query(`INSERT INTO public.local_plan_events (municipality_id, entity, entity_id, action) VALUES ($1,'op_progress',$2,'update')`, [MA, I1.id]), DENIED)
})

await test('ประวัติเดิมยังลงครบหลังเขียนทับฟังก์ชัน: op_item (มี origin_item_id) / op_plan publish / dev_project_year', async () => {
  await asRoot()
  const a1 = await eventsOf(A1.id)
  assert.equal(a1[0].entity, 'op_item')
  assert.equal(a1[0].changes.origin_item_id, I1.id)
  assert.ok((await eventsOf(AMEND.id)).some(e => e.action === 'unpublish' && e.reason === 'กดพลาด'))
  await actor('planA')
  await db.query('INSERT INTO public.local_dev_plan_project_years (project_id, municipality_id, fiscal_year, amount) VALUES ($1,$2,2570,500000)', [P2.id, MA])
  await asRoot()
  const y = (await eventsOf(P2.id)).filter(e => e.entity === 'dev_project_year')
  assert.equal(y.length, 1)
})

// ── ข้อมูลรายงานประจำปี ──
await test('รายงานประจำปี: นักวิเคราะห์เขียน · กอง/ผู้บริหารอ่านได้อย่างเดียว · ยอดเบิกจ่ายต้องมี ณ วันที่ · วันที่ไม่เกินวันนี้', async () => {
  await actor('planA')
  await rejects(db.query(`INSERT INTO public.local_plan_evaluations (municipality_id, fiscal_year, disbursed_total) VALUES ($1, 2570, 100)`, [MA]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.local_plan_evaluations (municipality_id, fiscal_year, committee_met_on)
    VALUES ($1, 2570, (now() AT TIME ZONE 'Asia/Bangkok')::date + 1)`, [MA]), { code: '22023' })
  const ev = (await rows(`INSERT INTO public.local_plan_evaluations (municipality_id, fiscal_year, disbursed_total, disbursed_as_of, disbursed_source)
    VALUES ($1, 2570, 214699491, '2026-10-31', 'รายงาน e-LAAS') RETURNING *`, [MA]))[0]
  await rejects(db.query(`UPDATE public.local_plan_evaluations SET fiscal_year = 2569 WHERE id = $1`, [ev.id]), DENIED)
  await actor('officerD1')
  await rejects(db.query(`INSERT INTO public.local_plan_evaluations (municipality_id, fiscal_year) VALUES ($1, 2569)`, [MA]), DENIED)
  assert.equal(await affected(`UPDATE public.local_plan_evaluations SET observations = 'แอบแก้' WHERE id = $1`, [ev.id]), 0)
  await actor('viewerA')
  assert.equal((await rows('SELECT 1 FROM public.local_plan_evaluations')).length, 1)
  await actor('councilA')
  assert.equal((await rows('SELECT 1 FROM public.local_plan_evaluations')).length, 0)
  await asRoot()
  assert.equal((await eventsOf(ev.id))[0].entity, 'evaluation')
})

// ── RPC ขั้นโครงการก่อสร้าง ──
await test('RPC ขั้นก่อสร้าง: คืนเฉพาะโครงการที่ผูกทะเบียนของ อปท. ตัวเอง 4 ช่อง · สภา/อปท.อื่น/anon ไม่ได้', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.civil_projects (municipality_id, fiscal_year, title, stage, stage_changed_at, registry_ref) VALUES
    ($1, '2570', 'ถนน คสล. หมู่ 5', 'contracted', now(), $2),
    ($1, '2570', 'ไม่ผูกทะเบียน', 'budgeted', now(), NULL),
    ($1, '2569', 'ปีอื่น', 'closed', now(), $3),
    ($4, '2570', 'อปท. บี ผูกข้ามมา', 'closed', now(), $2)`, [MA, P1.id, P2.id, MB])
  await actor('viewerA')
  assert.equal((await rows('SELECT 1 FROM public.civil_projects')).length, 0, 'ผู้บริหารอ่านตารางตรงไม่ได้ (#649)')
  const r = await rows('SELECT * FROM public.local_plan_civil_stages($1, 2570)', [MA])
  assert.equal(r.length, 1)
  assert.deepEqual(Object.keys(r[0]).sort(), ['fiscal_year', 'registry_ref', 'stage', 'stage_changed_at'])
  assert.equal(r[0].stage, 'contracted')
  assert.equal((await rows('SELECT * FROM public.local_plan_civil_stages($1)', [MA])).length, 2)
  for (const alias of ['councilA', 'adminB']) {
    await actor(alias)
    await rejects(db.query('SELECT * FROM public.local_plan_civil_stages($1, 2570)', [MA]), DENIED)
  }
  await actor('anon')
  await rejects(db.query('SELECT * FROM public.local_plan_civil_stages($1, 2570)', [MA]), DENIED)
})

await test('FK ก่อสร้าง: ค่าค้างที่ชี้ไม่เจอ → ไฟล์ 3 หยุด · โครงการที่ก่อสร้างผูกอยู่ลบไม่ได้', async () => {
  await asRoot()
  await rejects(db.query('UPDATE public.civil_projects SET registry_ref = $1 WHERE title = $2', [id(888), 'ไม่ผูกทะเบียน']), { code: '23503' })
  await db.exec('ALTER TABLE public.civil_projects DROP CONSTRAINT civil_projects_registry_ref_fk')
  await db.query('UPDATE public.civil_projects SET registry_ref = $1 WHERE title = $2', [id(888), 'ไม่ผูกทะเบียน'])
  await rejects(db.exec(fkSql), { message: /ไม่พบในทะเบียน 1 แถว/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.query('UPDATE public.civil_projects SET registry_ref = NULL WHERE title = $1', ['ไม่ผูกทะเบียน'])
  await rejects(db.exec(fkSql), { message: /อปท\. อื่น 1 แถว/ })     // แถว อปท. บี ที่ผูกทะเบียนของ อปท. เอ
  await db.exec('ROLLBACK').catch(() => {})
  await db.query('UPDATE public.civil_projects SET registry_ref = NULL WHERE municipality_id = $1', [MB])
  await db.exec(fkSql)
  await actor('planA')
  await rejects(db.query('DELETE FROM public.local_dev_plan_projects WHERE id = $1', [P2.id]), { code: '23001' })
})

await test('สิทธิ์ตาราง: anon ไม่มีสิทธิ์ · authenticated ไม่มี TRUNCATE · policy ครบ 8 + ของเดิม 21', async () => {
  await asRoot()
  for (const t of ['local_op_item_progress', 'local_plan_evaluations']) {
    const p = (await rows(`SELECT has_table_privilege('anon', $1, 'SELECT') AS a, has_table_privilege('authenticated', $1, 'TRUNCATE') AS t`, ['public.' + t]))[0]
    assert.equal(p.a, false)
    assert.equal(p.t, false)
  }
  const n = Number((await rows(`SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'local\\_%'`))[0].n)
  assert.equal(n, 29)
})

// ── ด่านก่อนรันบนฐานจริง + ข้อที่แก้ตามผล migration-reviewer ──
const guardOf = sql => sql.match(/DO \$guard\$[\s\S]*?END \$guard\$;/)[0]

await test('ทุกไฟล์ตั้ง lock_timeout · ตัวกัน race มีจริงเฉพาะตอน INSERT (concurrency ทดสอบบน PGlite ไม่ได้)', async () => {
  for (const sql of [tablesSql, rlsSql, fkSql]) assert.match(sql, /SET LOCAL lock_timeout = '5s';/)
  assert.match(rlsSql, /IF TG_OP = 'INSERT' THEN\s+PERFORM 1 FROM public\.local_op_plans AS o[\s\S]*?FOR SHARE OF o;/)
})

await test('ด่านไฟล์ 1: ฟังก์ชัน R0 บนฐานถูกแก้ → หยุด · คืนค่าแล้วผ่าน', async () => {
  const def = (await rows(`SELECT pg_get_functiondef('public.local_op_plans_guard()'::regprocedure) AS d`))[0].d
  await db.exec(guardOf(tablesSql))
  await db.exec(def.replace('DECLARE', 'DECLARE\n  -- แก้ตรงในฐาน'))
  await rejects(db.exec(guardOf(tablesSql)), { message: /Schema drift/ })
  await db.exec(def)
  await db.exec(guardOf(tablesSql))
})

await test('ด่านไฟล์ 1: R0 จดใน schema_migrations ไม่ครบ → หยุด · ครบแล้วผ่าน', async () => {
  await db.exec(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
    INSERT INTO supabase_migrations.schema_migrations VALUES ('20261109100000'), ('20261109100100');`)
  await rejects(db.exec(guardOf(tablesSql)), { message: /schema_migrations/ })
  await db.exec(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261109100200');`)
  await db.exec(guardOf(tablesSql))
  await db.exec('DROP SCHEMA supabase_migrations CASCADE')
})

await test('ด่านไฟล์ 1 (รอบแรก): มีฉบับแก้ไขที่มีรายการ → หยุดให้ตัดสิน · ฉบับเพิ่มเติมไม่เกี่ยว', async () => {
  await db.exec('ALTER TABLE public.local_op_plan_items RENAME COLUMN origin_item_id TO origin_item_id_x')   // จำลองรอบแรกที่ยังไม่มีคอลัมน์
  try {
    await rejects(db.exec(guardOf(tablesSql)), { message: /ฉบับแก้ไขที่มีรายการแล้ว 1 ฉบับ/ })
    await db.query(`UPDATE public.local_op_plans SET kind = 'supplement' WHERE id = $1`, [AMEND.id])
    await db.exec(guardOf(tablesSql))
    await db.query(`UPDATE public.local_op_plans SET kind = 'amendment' WHERE id = $1`, [AMEND.id])
  } finally {
    await db.exec('ALTER TABLE public.local_op_plan_items RENAME COLUMN origin_item_id_x TO origin_item_id')
  }
})

await test('ด่านไฟล์ 2: trigger นอกรีโปบนตารางแผน → หยุด · FORCE RLS → หยุด', async () => {
  await db.exec('CREATE TRIGGER zz_extra AFTER INSERT ON public.local_op_plans FOR EACH ROW EXECUTE FUNCTION public.local_plan_log_event()')
  await rejects(db.exec(guardOf(rlsSql)), { message: /trigger ที่ไม่รู้จัก.*zz_extra/ })
  await db.exec('DROP TRIGGER zz_extra ON public.local_op_plans')
  await db.exec('ALTER TABLE public.local_op_item_progress FORCE ROW LEVEL SECURITY')
  await rejects(db.exec(guardOf(rlsSql)), { message: /FORCE RLS/ })
  await db.exec('ALTER TABLE public.local_op_item_progress NO FORCE ROW LEVEL SECURITY')
  await db.exec(guardOf(rlsSql))
})

await test('สายรายการข้าม อปท. ไม่ได้ แม้ guard เดิมไม่ทำงาน (ไม่พึ่งลำดับชื่อ trigger)', async () => {
  const planB = (await rows(`INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to) VALUES ($1, 2566, 2570) RETURNING id`, [MB]))[0]
  const opB = (await rows(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no)
    VALUES ($1,$2,2570,'amendment',5) RETURNING id`, [MB, planB.id]))[0]
  await db.exec('ALTER TABLE public.local_op_plan_items DISABLE TRIGGER local_op_plan_items_guard_trigger')
  try {
    await rejects(db.query(`INSERT INTO public.local_op_plan_items (municipality_id, op_plan_id, item_name, origin_item_id) VALUES ($1,$2,'ปลอมว่าอยู่ อปท. เอ',$3)`,
      [MA, opB.id, I1.id]), { code: '23514' })
  } finally {
    await db.exec('ALTER TABLE public.local_op_plan_items ENABLE TRIGGER local_op_plan_items_guard_trigger')
  }
  await db.exec('ALTER TABLE public.local_op_plans DISABLE TRIGGER local_op_plans_guard_trigger')
  try {
    await rejects(db.query(`INSERT INTO public.local_op_plans (municipality_id, dev_plan_id, fiscal_year, kind, revision_no, source_op_plan_id)
      VALUES ($1,$2,2570,'amendment',6,$3)`, [MA, planB.id, MAIN.id]), { code: '23514' })
  } finally {
    await db.exec('ALTER TABLE public.local_op_plans ENABLE TRIGGER local_op_plans_guard_trigger')
  }
})

await test('ลบกอง: แถวผลกลายเป็นไม่มีกอง ไม่คัดกองที่ถูกลบกลับมา', async () => {
  const D3 = id(15)
  await db.query(`INSERT INTO public.departments VALUES ($1,$2,'กองชั่วคราว')`, [D3, MA])
  const op = await newOp(2569, 0)
  const item = await newItem(op.id, 'งานของกองชั่วคราว', D3)
  await setOp('planA', op.id, 'published', '2026-10-15')
  await actor('planA')
  await db.query(`INSERT INTO public.local_op_item_progress (lineage_id, status) VALUES ($1, 'in_progress')`, [item.id])
  await asRoot()
  assert.equal((await progressOf(item.id)).department_id, D3)
  await db.query('DELETE FROM public.departments WHERE id = $1', [D3])
  assert.equal((await progressOf(item.id)).department_id, null)
})

console.log(`\nlocal-plan-progress-db: ผ่านทั้งหมด ${cases} หมวด`)
await db.close()
