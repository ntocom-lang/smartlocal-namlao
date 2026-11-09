// เมนู "แผนพัฒนาท้องถิ่น" แท็บคลัง-แหล่งงบ (PR K-A) — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   npm run test:local-plan:bank-db -- --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: ชุด R0-A (20261109100000/100100/100200) → R1-A (20261110100000/100100/100200) → 20261112100000 (DDL) → 20261112100100
//
// ตรวจ: (1) ด่านหัวไฟล์ + รันซ้ำได้ (รวมรัน R1-A ซ้ำแล้วรันไฟล์นี้ตาม) (2) เมทริกซ์สิทธิ์อ่าน/เขียนทุกบทบาท
// (3) อปท. ระบบคัดจากแม่ + ห้ามย้ายแม่ + แหล่งข้าม อปท. (4) กติกาสถานะ/วันที่ของคลังและรอบ
// (5) ความพร้อม: ระดับ 4 ต้องมีไฟล์ วันเสร็จอัตโนมัติ กองเจ้าของงานแก้ได้เฉพาะช่องของตัวเอง
// (6) ช่องแบบฟอร์ม 001 (7) ประวัติ (รวมของเดิมยังลงครบหลังเขียนทับฟังก์ชัน) (8) FK ลบแม่ (9) สิทธิ์ตาราง/ฟังก์ชัน
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
const r1 = [
  await readMigration('20261110100000_local_plan_progress_tables.sql'),
  await readMigration('20261110100100_local_plan_progress_rls.sql'),
  await readMigration('20261110100200_civil_registry_ref_fk.sql'),
]
const tablesSql = await readMigration('20261112100000_local_plan_bank_tables.sql')
const rlsSql = await readMigration('20261112100100_local_plan_bank_rls.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const MC = id(3) // อปท. ที่จะถูกลบทั้งแถว (ตรวจ FK ตอน cascade)
const D1 = id(11) // กองช่าง เอ
const D2 = id(12) // กองการศึกษา เอ
const DG = id(14) // สำนักปลัด เอ
const DB1 = id(13)
const U = {
  superadmin: id(101), adminA: id(102), adminB: id(103), planA: id(104), officerD1: id(106), officerD2: id(107),
  staffD1: id(108), techD1: id(109), viewerA: id(110), councilA: id(112), citizenA: id(113), adminC: id(114),
}
const ROLE = { superadmin: 'superadmin', adminA: 'admin', adminB: 'admin', planA: 'staff', officerD1: 'officer', officerD2: 'officer',
  staffD1: 'staff', techD1: 'technician', viewerA: 'viewer', councilA: 'council', citizenA: 'citizen', adminC: 'admin' }
const MUNI = { superadmin: null, adminB: MB, adminC: MC }
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
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE, name text);
CREATE TABLE public.positions (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id) ON DELETE SET NULL, department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
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

-- ตัวแทน civil_projects (เฉพาะช่องที่ชุด R1-A ใช้)
CREATE TABLE public.civil_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  fiscal_year text NOT NULL, title text NOT NULL, stage text, stage_changed_at timestamptz, registry_ref uuid);
ALTER TABLE public.civil_projects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.civil_projects TO authenticated;

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ'), ('${MB}', 'อปท. บี'), ('${MC}', 'อปท. ซี');
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
await test('ด่านหัวไฟล์: รันก่อนชุด R1-A / ข้ามไฟล์ 1 → พังพร้อมชื่อไฟล์ที่ต้องรันก่อน', async () => {
  for (const sql of r0) await db.exec(sql)
  await rejects(db.exec(tablesSql), { message: /20261110100100/ })
  await db.exec('ROLLBACK').catch(() => {})
  for (const sql of r1) await db.exec(sql)
  await rejects(db.exec(rlsSql), { message: /20261112100000/ })
  await db.exec('ROLLBACK').catch(() => {})
})

await test('ด่านหัวไฟล์: ฟังก์ชันสิทธิ์บนฐานไม่ตรงรีโป → หยุด (schema drift)', async () => {
  await db.exec(tablesSql)
  await db.exec(`CREATE OR REPLACE FUNCTION public.local_plan_dept_can_edit(p_municipality_id uuid, p_department_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT true $$`)
  await rejects(db.exec(rlsSql), { message: /Schema drift/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(r0[2])                                   // คืนฉบับรีโป (เขียน log_event ฉบับ R0 ทับด้วย)
  await db.exec(r1[1])                                   // แล้วคืน log_event ฉบับ R1-A
})

await test('ด่านหัวไฟล์: trigger แปลกปลอมบนตารางคลัง → หยุด', async () => {
  await db.exec(`CREATE FUNCTION public.zz_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER aa_extra BEFORE INSERT ON public.local_bank_candidates FOR EACH ROW EXECUTE FUNCTION public.zz_noop();`)
  await rejects(db.exec(rlsSql), { message: /aa_extra/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec('DROP TRIGGER aa_extra ON public.local_bank_candidates; DROP FUNCTION public.zz_noop();')
})

await db.exec(rlsSql)
await db.exec(tablesSql)
await db.exec(rlsSql)
await test('รันซ้ำ: R1-A ไฟล์ 1 หลังชุดนี้ถูกด่าน md5 หยุด (กันคืน CHECK entity เดิม) · R1-A ไฟล์ 2 รันซ้ำได้แล้วรันชุดนี้ตามกลับมาครบ', async () => {
  await rejects(db.exec(r1[0]), { message: /Schema drift/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(r1[1])                                   // เขียน log_event ฉบับที่ไม่รู้จักตารางคลังกลับ
  await db.exec(tablesSql)
  await db.exec(rlsSql)
})
await db.query(`UPDATE public.profiles SET plan_role = 'plan_admin' WHERE id = $1`, [U.planA])

// ── ตัวช่วยสร้างข้อมูล ──
const one = async (as, sql, params) => { await actor(as); const r = await rows(sql, params); await asRoot(); return r[0] }
const TODAY = (await rows(`SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS d`))[0].d
const TOMORROW = (await rows(`SELECT ((now() AT TIME ZONE 'Asia/Bangkok')::date + 1)::text AS d`))[0].d

const PLAN = await one('planA', `INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to, is_current) VALUES ($1, 2571, 2575, true) RETURNING *`, [MA])
const newProject = (name, dept = D1, plan = PLAN.id) => one('planA',
  `INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, department_id, official_name) VALUES ($1,$2,$3,$4) RETURNING *`, [MA, plan, dept, name])
const P1 = await newProject('ฝายชะลอน้ำ หมู่ 7')
const P2 = await newProject('ขุดลอกหนองสาธารณะ หมู่ 3')
const PLAN_B = await one('adminB', `INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to) VALUES ($1, 2571, 2575) RETURNING *`, [MB])
const PB = await one('adminB', `INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, department_id, official_name)
  VALUES ($1,$2,$3,'ถนน บี') RETURNING *`, [MB, PLAN_B.id, DB1])

const insSource = (name, extra = {}) => db.query(
  `INSERT INTO public.local_funding_sources (municipality_id, name, template_key, required_aspects, usual_open_month, usual_open_day,
     usual_close_month, usual_close_day, target_year_offset, buffer_days)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [extra.muni ?? MA, name, extra.template ?? null, extra.aspects ?? ['land', 'design', 'estimate', 'study'],
   extra.openM ?? 7, extra.openD ?? 11, extra.closeM ?? 9, extra.closeD ?? 30, extra.offset ?? 2, extra.buffer ?? 21])
const insRound = (source, fy, extra = {}) => db.query(
  `INSERT INTO public.local_funding_rounds (municipality_id, source_id, target_fiscal_year, opens_on, closes_on, ref_no, ref_date)
   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
  [extra.muni ?? MB, source, fy, extra.opens ?? '2027-07-11', extra.closes ?? '2027-09-30', extra.ref ?? 'ทส 0000/ว 1', extra.refDate ?? TODAY])
const insCand = (project, source, fy = 2572, extra = {}) => db.query(
  `INSERT INTO public.local_bank_candidates (municipality_id, project_id, source_id, target_fiscal_year, requested_amount, status,
     submitted_on, result_on, result_ref_no, result_amount, reason)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
  [extra.muni ?? MB, project, source, fy, extra.amount ?? 2500000, extra.status ?? 'preparing', extra.submitted ?? null,
   extra.resultOn ?? null, extra.resultRef ?? null, extra.resultAmount ?? null, extra.reason ?? null])
const insReady = (project, aspect, extra = {}) => db.query(
  `INSERT INTO public.local_project_readiness (municipality_id, project_id, aspect, department_id, level, file_ref, file_name, done_on)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [extra.muni ?? MB, project, aspect, extra.dept === undefined ? D1 : extra.dept, extra.level ?? 2, extra.file ?? null,
   extra.fileName ?? null, extra.done ?? null])
const readiness = async (project, aspect) =>
  (await rows('SELECT * FROM public.local_project_readiness WHERE project_id = $1 AND aspect = $2', [project, aspect]))[0]
const eventsOf = async (entity, entityId) =>
  rows('SELECT * FROM public.local_plan_events WHERE entity = $1 AND entity_id = $2 ORDER BY id', [entity, entityId])

let TWP
await test('แหล่งงบ: ผู้จัดการแผน/แอดมิน/superadmin เพิ่มได้ · กอง/ช่าง/ผู้บริหาร/สภา/ประชาชน/อปท.อื่น/anon ไม่ได้ · อปท.ถูกทับไม่ได้', async () => {
  await actor('planA')
  TWP = (await insSource('Thai Water Plan', { template: 'twp' })).rows[0]
  assert.equal(TWP.municipality_id, MA)
  assert.deepEqual(TWP.required_aspects, ['study', 'land', 'design', 'estimate'])   // เรียงตามแบบฟอร์ม
  await actor('adminA')
  await insSource('เงินอุดหนุนเฉพาะกิจ สถ.', { aspects: ['estimate', 'design', 'design'] })
  assert.deepEqual((await rows(`SELECT required_aspects FROM public.local_funding_sources WHERE name = 'เงินอุดหนุนเฉพาะกิจ สถ.'`))[0]
    .required_aspects, ['design', 'estimate'])                                    // ตัดซ้ำ
  await rejects(insSource('ซ้ำแม่แบบ', { template: 'twp' }), { code: '23505' })   // 1 อปท. มีแม่แบบเดียวกันได้แหล่งเดียว
  await actor('superadmin')
  await insSource('อบจ. แพร่')
  for (const alias of ['officerD1', 'staffD1', 'techD1', 'viewerA', 'councilA', 'citizenA', 'adminB', 'anon']) {
    await actor(alias)
    await rejects(insSource('ห้าม ' + alias), DENIED)
  }
  await actor('adminB')
  await insSource('แหล่งของ บี', { muni: MB })
  await rejects(db.query(`UPDATE public.local_funding_sources SET municipality_id = $1 WHERE name = 'แหล่งของ บี'`, [MA]), DENIED)
})

await test('แหล่งงบ: วันที่ในกฎรอบปกติต้องมีจริง · เดือน/วันต้องมาคู่ · ลิงก์ต้อง https', async () => {
  await actor('planA')
  await rejects(insSource('31 เม.ย.', { closeM: 4, closeD: 31 }), { code: '23514' })
  await rejects(insSource('30 ก.พ.', { closeM: 2, closeD: 30 }), { code: '23514' })
  await insSource('29 ก.พ.', { closeM: 2, closeD: 29 })
  await rejects(db.query(`INSERT INTO public.local_funding_sources (municipality_id, name, usual_close_month) VALUES ($1, 'ไม่มีวัน', 9)`, [MA]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.local_funding_sources (municipality_id, name, source_url) VALUES ($1, 'ลิงก์', 'javascript:alert(1)')`, [MA]), { code: '23514' })
  await rejects(db.query(`INSERT INTO public.local_funding_sources (municipality_id, name, required_aspects) VALUES ($1, 'ด้านแปลก', '{budget}')`, [MA]), { code: '23514' })
})

await test('แหล่งงบ: อ่านได้ทุกคนที่อ่านแผนได้ · สภา/ประชาชน/อปท.อื่น/anon อ่านไม่ได้', async () => {
  for (const alias of ['officerD1', 'staffD1', 'techD1', 'viewerA']) {
    await actor(alias)
    assert.ok((await rows(`SELECT 1 FROM public.local_funding_sources WHERE id = $1`, [TWP.id])).length === 1, alias)
  }
  for (const alias of ['councilA', 'citizenA', 'adminB']) {
    await actor(alias)
    assert.equal((await rows(`SELECT 1 FROM public.local_funding_sources WHERE id = $1`, [TWP.id])).length, 0, alias)
  }
  await actor('anon')
  await rejects(rows(`SELECT 1 FROM public.local_funding_sources`), DENIED)
})

let ROUND
await test('รอบยื่น: ต้องมีเลขที่+วันที่หนังสือ · วันที่หนังสือไม่เกินวันนี้ · อปท.คัดจากแหล่ง · 1 แหล่ง×ปีงบ มีรอบเดียว', async () => {
  await actor('planA')
  ROUND = (await insRound(TWP.id, 2572)).rows[0]
  assert.equal(ROUND.municipality_id, MA)                                  // ส่ง MB มาก็ถูกทับ
  await rejects(insRound(TWP.id, 2572), { code: '23505' })
  await rejects(insRound(TWP.id, 2573, { ref: '   ' }), { code: '23514' })
  await rejects(insRound(TWP.id, 2573, { refDate: TOMORROW }), { code: '22023' })
  await rejects(insRound(TWP.id, 2573, { opens: '2027-10-01', closes: '2027-09-30' }), { code: '23514' })
  await insRound(TWP.id, 2573, { opens: null, closes: '2028-09-30' })    // หนังสือไม่ระบุวันเปิด = ได้
  await actor('officerD1')
  await rejects(insRound(TWP.id, 2574), DENIED)
  await actor('adminB')
  await rejects(insRound(TWP.id, 2574), DENIED)                             // แหล่งของ อปท. อื่น → อปท. ถูกคัดเป็น เอ → policy ไม่ผ่าน
  await actor('planA')
  const other = (await rows(`SELECT id FROM public.local_funding_sources WHERE name = 'อบจ. แพร่'`))[0]
  await rejects(db.query(`UPDATE public.local_funding_rounds SET source_id = $1 WHERE id = $2`, [other.id, ROUND.id]), DENIED)
})

let C1
await test('คลัง: อปท.คัดจากโครงการ · แหล่งต้อง อปท. เดียวกัน · โครงการ×แหล่ง×ปีงบซ้ำไม่ได้ · ย้ายโครงการ/แหล่งไม่ได้', async () => {
  await actor('planA')
  C1 = (await insCand(P1.id, TWP.id)).rows[0]
  assert.equal(C1.municipality_id, MA)
  assert.equal(C1.status, 'preparing')
  await rejects(insCand(P1.id, TWP.id), { code: '23505' })
  await insCand(P1.id, TWP.id, 2573)                                         // ปีงบอื่นของแหล่งเดียวกัน = ได้
  await asRoot()                                                            // ผู้จัดการแผนของ เอ มองไม่เห็นแหล่งของ บี อยู่แล้ว
  const srcB = (await rows(`SELECT id FROM public.local_funding_sources WHERE name = 'แหล่งของ บี'`))[0]
  await rejects(insCand(P1.id, srcB.id), { code: '23514', message: /อปท. เดียวกับโครงการ/ })
  await actor('planA')
  await rejects(db.query(`UPDATE public.local_bank_candidates SET project_id = $1 WHERE id = $2`, [P2.id, C1.id]), DENIED)
  for (const alias of ['officerD1', 'viewerA', 'adminB']) {
    await actor(alias)
    await rejects(insCand(P2.id, TWP.id), DENIED)
  }
  await actor('adminB')
  assert.equal(await affected(`UPDATE public.local_bank_candidates SET note = 'ข้าม อปท.' WHERE id = $1`, [C1.id]), 0)
  assert.equal(await affected(`DELETE FROM public.local_bank_candidates WHERE id = $1`, [C1.id]), 0)
})

await test('คลัง: ยื่นแล้วต้องมีวันยื่น · ได้รับ/ไม่ได้รับต้องมีวันที่+เลขที่หนังสือ · ถอนต้องมีเหตุผล · วันไม่เกินวันนี้ · วงเงินที่ได้เฉพาะได้รับ', async () => {
  await actor('planA')
  const upd = (set, params = []) => db.query(`UPDATE public.local_bank_candidates SET ${set} WHERE id = $1`, [C1.id, ...params])
  await rejects(upd(`status = 'submitted'`), { code: '23514' })
  await rejects(upd(`status = 'submitted', submitted_on = $2`, [TOMORROW]), { code: '22023' })
  await upd(`status = 'submitted', submitted_on = $2`, [TODAY])
  await rejects(upd(`status = 'approved', result_on = $2`, [TODAY]), { code: '23514' })              // ไม่มีเลขที่หนังสือ
  await rejects(upd(`status = 'approved', result_on = $2, result_ref_no = '  '`, [TODAY]), { code: '23514' })
  await rejects(upd(`result_amount = 100`), { code: '23514' })                                          // ยังไม่ได้รับ
  await rejects(upd(`status = 'approved', result_on = '2020-01-01', result_ref_no = 'ทส 1/2563'`), { code: '23514' })  // ก่อนวันยื่น
  await upd(`status = 'approved', result_on = $2, result_ref_no = ' ทส 1/2570 ', result_amount = 2400000`, [TODAY])
  assert.equal((await rows(`SELECT result_ref_no FROM public.local_bank_candidates WHERE id = $1`, [C1.id]))[0].result_ref_no, 'ทส 1/2570')
  await rejects(upd(`status = 'withdrawn', result_amount = NULL, reason = '  '`), { code: '23514' })
  await upd(`status = 'withdrawn', result_amount = NULL, reason = 'ได้งบจากแหล่งอื่นแล้ว'`)
  await upd(`status = 'preparing', reason = NULL, submitted_on = NULL, result_on = NULL, result_ref_no = NULL`)   // แก้ที่บันทึกผิดคืนได้ (ลงประวัติ)
})

await test('ความพร้อม: ผู้จัดการแผนเพิ่ม/มอบกอง · กองของ อปท. อื่นไม่ได้ · กอง/ช่าง/ผู้บริหารเพิ่มเองไม่ได้', async () => {
  await actor('planA')
  const r = (await insReady(P1.id, 'land', { dept: D2 })).rows[0]
  assert.equal(r.municipality_id, MA)
  await insReady(P1.id, 'design')
  await insReady(P1.id, 'estimate')
  const study = (await insReady(P1.id, 'study', { level: 1, dept: null })).rows[0]
  assert.equal(study.department_id, D1)                                     // ไม่ระบุ = ระบบเติมกองของโครงการ
  await rejects(insReady(P1.id, 'design'), { code: '23505' })
  await rejects(insReady(P2.id, 'design', { dept: DB1 }), { code: '23514', message: /อปท. นี้/ })
  await rejects(insReady(P2.id, 'budget'), { code: '23514' })
  for (const alias of ['officerD1', 'staffD1', 'techD1', 'viewerA', 'adminB', 'anon']) {
    await actor(alias)
    await rejects(insReady(P2.id, 'design'), DENIED)
  }
})

await test('ความพร้อม: ระดับ 4 ต้องมีไฟล์ · วันเสร็จระบบใส่วันนี้ · ลดระดับล้างวันเสร็จ · ถอดไฟล์ล้างข้อมูลไฟล์ · ลิงก์อันตรายไม่ได้', async () => {
  await actor('planA')
  const upd = (set, params = []) => db.query(`UPDATE public.local_project_readiness SET ${set} WHERE project_id = $1 AND aspect = 'design'`, [P1.id, ...params])
  await rejects(upd(`level = 4`), { code: '23514' })
  await rejects(upd(`level = 4, file_ref = 'javascript:alert(1)'`), { code: '23514' })
  await rejects(upd(`level = 4, file_ref = '//evil.example/x.pdf'`), { code: '23514' })
  await rejects(upd(`level = 4, file_ref = 'x'`), { code: '23514' })                       // สตริงเปล่าไม่ใช่ไฟล์
  await rejects(upd(`level = 4, file_ref = 'http://example.com/a.pdf'`), { code: '23514' })  // ต้อง https
  await upd(`level = 4, file_ref = 'drive:abc_123-XYZ', file_name = 'แบบ.pdf', mime_type = 'application/pdf', size_bytes = 1024`)
  let r = await readiness(P1.id, 'design')
  assert.equal(r.done_on.toISOString?.().slice(0, 10) ?? String(r.done_on), TODAY)
  await rejects(upd(`done_on = $2`, [TOMORROW]), { code: '22023' })
  await upd(`done_on = '2026-01-15'`)
  await upd(`level = 3`)
  r = await readiness(P1.id, 'design')
  assert.equal(r.done_on, null)
  assert.equal(r.file_ref, 'drive:abc_123-XYZ')                            // ไฟล์เก็บไว้
  await upd(`file_ref = NULL`)
  r = await readiness(P1.id, 'design')
  assert.equal(r.file_name, null)
  assert.equal(r.size_bytes, null)
})

await test('ความพร้อม: กองเจ้าของงานแก้ระดับ/ไฟล์/หมายเหตุของด้านตัวเองได้ · ย้ายกอง/แก้ด้านกองอื่น/เพิ่ม/ลบไม่ได้', async () => {
  await actor('officerD1')
  assert.equal(await affected(`UPDATE public.local_project_readiness SET level = 4, file_ref = 'drive:est1', note = 'ประมาณราคาเสร็จ'
    WHERE project_id = $1 AND aspect = 'estimate'`, [P1.id]), 1)
  await actor('staffD1')
  assert.equal(await affected(`UPDATE public.local_project_readiness SET note = 'staff กองเดียวกัน' WHERE project_id = $1 AND aspect = 'estimate'`, [P1.id]), 1)
  await rejects(db.query(`UPDATE public.local_project_readiness SET department_id = $2 WHERE project_id = $1 AND aspect = 'estimate'`, [P1.id, D2]),
    { code: '42501' })                                                     // ย้ายกองเอง (WITH CHECK หรือ trigger ก็ปฏิเสธ)
  await rejects(db.query(`UPDATE public.local_project_readiness SET department_id = NULL WHERE project_id = $1 AND aspect = 'estimate'`, [P1.id]),
    { code: '42501' })
  await rejects(db.query(`UPDATE public.local_project_readiness SET created_by = $2 WHERE project_id = $1 AND aspect = 'estimate'`, [P1.id, U.superadmin]),
    { code: '42501', message: /created_by/ })
  assert.equal(await affected(`UPDATE public.local_project_readiness SET note = 'ข้ามกอง' WHERE project_id = $1 AND aspect = 'land'`, [P1.id]), 0)
  assert.equal(await affected(`DELETE FROM public.local_project_readiness WHERE project_id = $1 AND aspect = 'estimate'`, [P1.id]), 0)
  await actor('officerD2')
  assert.equal(await affected(`UPDATE public.local_project_readiness SET level = 3 WHERE project_id = $1 AND aspect = 'land'`, [P1.id]), 1)
  assert.equal(await affected(`UPDATE public.local_project_readiness SET level = 3 WHERE project_id = $1 AND aspect = 'estimate'`, [P1.id]), 0)
  for (const alias of ['techD1', 'viewerA']) {
    await actor(alias)
    assert.equal(await affected(`UPDATE public.local_project_readiness SET level = 1 WHERE project_id = $1`, [P1.id]), 0, alias)
  }
  await actor('planA')                                                      // ผู้จัดการแผนย้ายกองได้
  assert.equal(await affected(`UPDATE public.local_project_readiness SET department_id = $2 WHERE project_id = $1 AND aspect = 'land'`, [P1.id, D1]), 1)
  await actor('officerD2')
  assert.equal(await affected(`UPDATE public.local_project_readiness SET level = 2 WHERE project_id = $1 AND aspect = 'land'`, [P1.id]), 0)
})

await test('ความพร้อม: แผนพัฒนาประกาศแล้ว ยังแก้ความพร้อม/ช่อง 001 ได้ (ข้อมูลเตรียมยื่น ไม่ใช่เอกสารแผน)', async () => {
  await actor('planA')
  await db.query('SELECT public.local_dev_plan_set_status($1, $2, $3, $4, $5)', [PLAN.id, 'published', TODAY, 'ประกาศ 1/2570', null])
  await actor('officerD1')
  assert.equal(await affected(`UPDATE public.local_project_readiness SET level = 3, note = 'หลังประกาศแผน' WHERE project_id = $1 AND aspect = 'design'`, [P1.id]), 1)
  await actor('planA')
  await db.query(`INSERT INTO public.local_bank_project_details (municipality_id, project_id, activity) VALUES ($1, $2, 'ก่อสร้างฝาย')`, [MB, P1.id])
})

await test('ช่องแบบฟอร์ม 001: ผู้จัดการแผนเขียน · อปท.คัดจากโครงการ · พิกัดต้องมาคู่และอยู่ในไทย · ช่วงเวลาไม่กลับหัว', async () => {
  const d = (await rows(`SELECT * FROM public.local_bank_project_details WHERE project_id = $1`, [P1.id]))[0]
  assert.equal(d.municipality_id, MA)
  await actor('planA')
  const upd = (set) => db.query(`UPDATE public.local_bank_project_details SET ${set} WHERE project_id = $1`, [P1.id])
  await rejects(upd(`latitude = 18.2`), { code: '23514' })
  await rejects(upd(`latitude = 100.1, longitude = 18.2`), { code: '23514' })                  // สลับ lat/long
  await upd(`latitude = 18.1234567, longitude = 100.1234567, village_no = ' 5, 7 ', budget_type = 'single_year', duration_days = 120`)
  await rejects(upd(`planned_start = '2028-03-01', planned_end = '2028-01-01'`), { code: '23514' })
  await rejects(upd(`budget_type = 'forever'`), { code: '23514' })
  assert.equal((await rows(`SELECT village_no FROM public.local_bank_project_details WHERE project_id = $1`, [P1.id]))[0].village_no, '5, 7')
  await rejects(upd(`project_id = '${P2.id}'`), DENIED)
  for (const alias of ['officerD1', 'viewerA', 'adminB']) {
    await actor(alias)
    assert.equal(await affected(`UPDATE public.local_bank_project_details SET kpi = 'x' WHERE project_id = $1`, [P1.id]), 0, alias)
    await rejects(db.query(`INSERT INTO public.local_bank_project_details (municipality_id, project_id) VALUES ($1, $2)`, [MA, P2.id]), DENIED)
  }
  await actor('viewerA')
  assert.equal((await rows(`SELECT 1 FROM public.local_bank_project_details WHERE project_id = $1`, [P1.id])).length, 1)
})

await test('ประวัติ: ทุกตารางคลังลงเพิ่ม/แก้/ลบ (ผู้แก้ + ค่าเดิม→ใหม่) · ความพร้อมบอกด้านเสมอ · ของเดิม (โครงการ) ยังลงครบ', async () => {
  const src = await eventsOf('funding_source', TWP.id)
  assert.equal(src[0].action, 'insert')
  assert.equal(src[0].actor, U.planA)
  const rnd = await eventsOf('funding_round', ROUND.id)
  assert.equal(rnd[0].parent_id, TWP.id)
  const cand = await eventsOf('bank_candidate', C1.id)
  assert.equal(cand[0].parent_id, P1.id)
  const approved = cand.find(e => e.changes.status?.[1] === 'approved')
  assert.deepEqual(approved.changes.status, ['submitted', 'approved'])
  const ready = await eventsOf('readiness', P1.id)
  const byOfficer = ready.find(e => e.actor === U.officerD1 && e.action === 'update')
  assert.ok(byOfficer, 'การแก้ของกองต้องลงประวัติ')
  assert.ok(byOfficer.changes.aspect, 'แก้ความพร้อมต้องบอกว่าเป็นด้านไหน')
  assert.ok((await eventsOf('bank_detail', P1.id)).some(e => e.action === 'update' && e.changes.latitude))
  assert.ok((await eventsOf('dev_project', P1.id)).some(e => e.action === 'insert'), 'ประวัติทะเบียนโครงการ (R0) ต้องยังลง')
  await actor('officerD1')
  assert.ok((await rows(`SELECT 1 FROM public.local_plan_events WHERE entity = 'readiness'`)).length > 0, 'กองอ่านประวัติได้')
  await actor('officerD1')
  await rejects(db.query(`DELETE FROM public.local_plan_events`), DENIED)
})

await test('FK: ลบโครงการที่อยู่ในคลัง/ลบแหล่งที่มีรอบ = ไม่ได้ (23503) · ลบโครงการที่ไม่อยู่ในคลัง → ความพร้อม/ช่อง 001 ลบตาม', async () => {
  // แผน P1 ประกาศแล้ว — ใช้แผนร่างแยกเพื่อทดสอบการลบ
  const draft = await one('planA', `INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to) VALUES ($1, 2576, 2580) RETURNING *`, [MA])
  const P3 = await newProject('ทดสอบลบ', D1, draft.id)
  await actor('planA')
  await insReady(P3.id, 'design')
  await db.query(`INSERT INTO public.local_bank_project_details (municipality_id, project_id) VALUES ($1, $2)`, [MA, P3.id])
  const c = (await insCand(P3.id, TWP.id)).rows[0]
  await rejects(db.query(`DELETE FROM public.local_dev_plan_projects WHERE id = $1`, [P3.id]), { code: '23503' })
  await rejects(db.query(`DELETE FROM public.local_dev_plans WHERE id = $1`, [draft.id]), { code: '23503' })   // แผนร่างที่มีโครงการในคลัง
  await rejects(db.query(`DELETE FROM public.local_funding_sources WHERE id = $1`, [TWP.id]), { code: '23503' })
  await db.query(`DELETE FROM public.local_bank_candidates WHERE id = $1`, [c.id])
  assert.equal(await affected(`DELETE FROM public.local_dev_plan_projects WHERE id = $1`, [P3.id]), 1)
  await asRoot()
  assert.equal((await rows(`SELECT 1 FROM public.local_project_readiness WHERE project_id = $1`, [P3.id])).length, 0)
  assert.equal((await rows(`SELECT 1 FROM public.local_bank_project_details WHERE project_id = $1`, [P3.id])).length, 0)
  assert.ok((await eventsOf('readiness', P3.id)).some(e => e.action === 'delete'), 'ลบตามโครงการยังลงประวัติ')
})

await test('FK: ลบ อปท. ทั้งแถว (cascade ทุกตารางในคำสั่งเดียว) ไม่ติด NO ACTION', async () => {
  const planC = await one('adminC', `INSERT INTO public.local_dev_plans (municipality_id, year_from, year_to) VALUES ($1, 2571, 2575) RETURNING *`, [MC])
  const pc = await one('adminC', `INSERT INTO public.local_dev_plan_projects (municipality_id, dev_plan_id, official_name) VALUES ($1,$2,'ซี') RETURNING *`, [MC, planC.id])
  await actor('adminC')
  const sc = (await insSource('แหล่ง ซี', { muni: MC })).rows[0]
  await insRound(sc.id, 2572)
  await insCand(pc.id, sc.id)
  await insReady(pc.id, 'land', { dept: null })
  await asRoot()
  assert.equal(await affected(`DELETE FROM public.municipalities WHERE id = $1`, [MC]), 1)
  for (const t of ['local_funding_sources', 'local_funding_rounds', 'local_bank_candidates', 'local_project_readiness', 'local_plan_events']) {
    assert.equal((await rows(`SELECT 1 FROM public.${t} WHERE municipality_id = $1`, [MC])).length, 0, t)
  }
})

await test('FK: คนที่ไม่ใช่ผู้จัดการแผนลบกองได้ (เช่น fleet_admin) → ความพร้อมไม่มีกองเจ้าของงาน แถวยังอยู่', async () => {
  await asRoot()
  const DX = id(15)
  await db.query(`INSERT INTO public.departments VALUES ($1, $2, 'กองชั่วคราว')`, [DX, MA])
  await db.exec('GRANT SELECT, DELETE ON public.departments TO authenticated')   // เลียนแบบ policy fdept_write ของฐานจริง
  await actor('planA')
  await insReady(P2.id, 'land', { dept: DX })
  await actor('officerD2')                                                  // ไม่ใช่ผู้จัดการแผน ไม่ใช่กองเจ้าของงาน
  assert.equal(await affected(`DELETE FROM public.departments WHERE id = $1`, [DX]), 1)
  await asRoot()
  await db.exec('REVOKE SELECT, DELETE ON public.departments FROM authenticated')
  const r = await readiness(P2.id, 'land')
  assert.equal(r.department_id, null)
  // ข้อยกเว้นนี้ใช้ไม่ได้ขณะกองยังอยู่: กองเจ้าของงานตั้งกองตัวเองเป็นว่างไม่ได้ (ทดสอบไว้ในหมวดสิทธิ์กองแล้ว)
})

await test('สิทธิ์ตาราง/ฟังก์ชัน: anon ไม่มีสิทธิ์ · authenticated ไม่มี TRUNCATE · ฟังก์ชัน guard เรียกตรงไม่ได้', async () => {
  for (const t of ['local_funding_sources', 'local_funding_rounds', 'local_bank_candidates', 'local_project_readiness', 'local_bank_project_details']) {
    const p = (await rows(`SELECT has_table_privilege('anon', 'public.${t}', 'SELECT') AS a, has_table_privilege('authenticated', 'public.${t}', 'TRUNCATE') AS t`))[0]
    assert.equal(p.a, false, t)
    assert.equal(p.t, false, t)
  }
  const fns = await rows(`SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('local_funding_sources_guard', 'local_funding_rounds_guard', 'local_bank_candidates_guard',
                    'local_project_readiness_guard', 'local_bank_project_details_guard')
    AND (has_function_privilege('authenticated', oid, 'EXECUTE') OR has_function_privilege('anon', oid, 'EXECUTE'))`)
  assert.deepEqual(fns, [])
  const md5 = (await rows(`SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = 'public.local_plan_log_event()'::regprocedure`))[0].h
  assert.ok(rlsSql.includes(md5), 'md5 ของ local_plan_log_event ฉบับนี้ต้องอยู่ในด่านหัวไฟล์ 2 (รันซ้ำได้)')
})

console.log(`\nlocal-plan-bank-db: ผ่าน ${cases} หมวด`)
