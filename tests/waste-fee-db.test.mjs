// ทะเบียนค่าธรรมเนียมขยะ (ขั้น 1B PR1) — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/waste-fee-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: 20261222100000 (ตาราง) → 20261222100100 (สิทธิ์/trigger/RPC/policy/demo)
//
// ตรวจ: (1) ด่านหัวไฟล์ + รันซ้ำล้มแบบปลอดภัย (2) demo ได้โมดูล + อัตราตัวอย่าง (3) เมทริกซ์สิทธิ์ทุกบทบาท
// (4) รูปแบบอัตรา + ป้ายตัวอย่างหลุดเอง (5) บัญชี: ปัดวันที่/ปัดหน่วยข้อ ๑๐ (6) wfee_compute ทุกขั้น + ตรงกับ computeMonthly ฝั่งจอ
// (7) wfee_account_month (8) wfee_set_sorting: ไม่ย้อนหลัง/ช่วงไม่หาย/กรณีผลตรวจ C1 (9) ประวัติ + มาสก์ (10) เขียนตรง/TRUNCATE/anon
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { computeMonthly } from '../src/lib/wasteFee.js'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261222100000_waste_fee_tables.sql')
const rlsSql = await readMigration('20261222100100_waste_fee_rls_rpc.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const MD = id(3) // demo
const DG = id(11) // สำนักปลัด เอ (มีคน)
const D1 = id(12) // กองช่าง เอ
const DH = id(13) // กองสาธารณสุข เอ (ยังไม่มีคน)
const DB1 = id(14) // สำนักปลัด บี
const U = {
  superadmin: id(101), adminA: id(102), adminB: id(103), staffDG: id(104), officerD1: id(105), techDG: id(106),
  viewerA: id(107), citizenA: id(108), staffB: id(109), councilA: id(110),
}
const ROLE = { superadmin: 'superadmin', adminA: 'admin', adminB: 'admin', staffDG: 'staff', officerD1: 'officer', techDG: 'technician',
  viewerA: 'viewer', citizenA: 'citizen', staffB: 'staff', councilA: 'council' }
const MUNI = { superadmin: null, adminB: MB, staffB: MB }
const DEPT = { staffDG: DG, officerD1: D1, techDG: DG, staffB: DB1 }

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text, slug text, enabled_modules text[]);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE, name text,
  code text, sort_order integer DEFAULT 0);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id) ON DELETE SET NULL, department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id() TO anon, authenticated;

-- สำเนาจาก 20260914100100_waste_schedule_rls_rpc.sql (ไฟล์ค่าขยะเรียกอ่านอย่างเดียว)
CREATE FUNCTION public.waste_owner_department_id(p_municipality_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT department.id FROM public.departments AS department
  WHERE department.municipality_id = p_municipality_id
    AND (lower(department.code) IN ('health', 'general') OR department.name ILIKE '%สาธารณสุข%' OR department.name ILIKE '%สำนักปลัด%')
  ORDER BY EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.department_id = department.id) DESC,
    (lower(department.code) = 'health' OR department.name ILIKE '%สาธารณสุข%') DESC, department.sort_order, department.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.waste_owner_department_id(uuid) FROM PUBLIC, anon, authenticated;

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ', 'a', ARRAY['waste']), ('${MB}', 'อปท. บี', 'b', ARRAY['waste']),
  ('${MD}', 'สาธิต', 'demo', ARRAY['waste', 'licence-registry']);
INSERT INTO public.departments (id, municipality_id, name, code, sort_order) VALUES
  ('${DG}', '${MA}', 'สำนักปลัด', 'general', 1), ('${D1}', '${MA}', 'กองช่าง', 'civil', 2),
  ('${DH}', '${MA}', 'กองสาธารณสุขและสิ่งแวดล้อม', 'health', 3), ('${DB1}', '${MB}', 'สำนักปลัด', 'general', 1);
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
  await db.exec(`SET ROLE ${signedIn ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)")
}
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const rejects = (promise, expect = {}) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const DENIED = { code: '42501' }
const asUser = async (alias, sql, params = []) => { await actor(alias); try { return await rows(sql, params) } finally { await asRoot() } }

let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }

// ── 1) ด่านหัวไฟล์ + รันซ้ำ ──
await test('ด่านหัวไฟล์: รันไฟล์ 2 ก่อนไฟล์ 1 → พังพร้อมชื่อไฟล์ที่ต้องรันก่อน', async () => {
  await rejects(db.exec(rlsSql), { message: /20261222100000/ })
  await db.exec('ROLLBACK').catch(() => {})
})

await db.exec(tablesSql)
await db.exec(rlsSql)

await test('รันซ้ำ: ไฟล์ 1 ล้มที่ด่าน (มีตารางแล้ว) · ไฟล์ 2 ล้มเพราะ CREATE FUNCTION ชื่อซ้ำ — ไม่ทับของเดิม ข้อมูลไม่เสีย', async () => {
  await rejects(db.exec(tablesSql), { message: /มีตาราง waste_fee_\* อยู่แล้ว/ })
  await db.exec('ROLLBACK').catch(() => {})
  await rejects(db.exec(rlsSql), { code: '42723' })
  await db.exec('ROLLBACK').catch(() => {})
  assert.equal((await rows("SELECT count(*)::int AS n FROM public.waste_fee_rates WHERE municipality_id = $1", [MD]))[0].n, 1)
})

const cur = (await rows('SELECT public.wfee_month_start(public.wfee_today())::text AS d'))[0].d
const month = async n => (await rows('SELECT ($1::date + make_interval(months => $2))::date::text AS d', [cur, n]))[0].d

// ── 2) demo ──
await test('demo: เปิดโมดูล waste-fee + อัตราตัวอย่าง 1 แถว (is_example มีผล 2026-12-01) · อปท. อื่นไม่ได้อะไรเลย', async () => {
  const m = await rows('SELECT slug, enabled_modules FROM public.municipalities ORDER BY slug')
  assert.deepEqual(m.map(r => [r.slug, r.enabled_modules.includes('waste-fee')]), [['a', false], ['b', false], ['demo', true]])
  const r = await rows('SELECT municipality_id, effective_from::text AS f, is_example, sorting_discount FROM public.waste_fee_rates')
  assert.deepEqual(r, [{ municipality_id: MD, f: '2026-12-01', is_example: true, sorting_discount: true }])
})

// ── 3) สิทธิ์ ──
const RATE_A = `INSERT INTO public.waste_fee_rates (municipality_id, effective_from, ordinance_ref, basis, base_collect, base_dispose,
  unit_collect, unit_dispose, big_unit_collect, big_unit_dispose, sorting_discount) VALUES ($1,$2,$3,'units',30,20,51,52,66,62,$4) RETURNING *`
let rateNow
await test('สิทธิ์: กองสาธารณสุขยังไม่มีคน → สำนักปลัดเป็นเจ้าของงาน · admin/superadmin ได้ · บทบาท/กอง/อปท. อื่นไม่เห็นและเขียนไม่ได้ · anon ถูกปฏิเสธ', async () => {
  rateNow = (await asUser('staffDG', RATE_A, [MA, await month(-12), 'เทศบัญญัติทดสอบ ข้อ ๖–๗', true]))[0]
  assert.equal(rateNow.created_by, U.staffDG)
  for (const who of ['adminA', 'superadmin', 'staffDG']) {
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.waste_fee_rates WHERE municipality_id = $1', [MA]))[0].n, 1, who)
    assert.equal((await asUser(who, 'SELECT public.wfee_is_manager($1) AS ok', [MA]))[0].ok, true, who)
  }
  for (const who of ['officerD1', 'techDG', 'viewerA', 'citizenA', 'councilA', 'adminB', 'staffB']) {
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.waste_fee_rates WHERE municipality_id = $1', [MA]))[0].n, 0, who)
    assert.equal((await asUser(who, 'SELECT public.wfee_is_manager($1) AS ok', [MA]))[0].ok, false, who)
    await rejects(asUser(who, `INSERT INTO public.waste_fee_accounts (municipality_id, payer_name, service_from) VALUES ($1,'x',$2)`, [MA, cur]))
  }
  // อปท. บี เห็นของตัวเองได้ แต่ไม่เห็นของ เอ
  assert.equal((await asUser('staffB', 'SELECT public.wfee_is_manager($1) AS ok', [MB]))[0].ok, true)
  await rejects(asUser('anon', 'SELECT * FROM public.waste_fee_rates'), DENIED)
  await rejects(asUser('anon', 'SELECT public.wfee_is_manager($1)', [MA]), DENIED)
})

// ── 4) อัตรา ──
await test('อัตรา: units ต้องมีอัตราเหมาครบ · ส่วนเกินกรอกคู่ · place_type ห้ามมีคีย์แปลก/ค่าติดลบ/ว่าง/คู่กับหมวดลด · effective_from ซ้ำไม่ได้ · เปลี่ยน id/อปท. ไม่ได้', async () => {
  const ins = (cols, vals) => asUser('staffDG', `INSERT INTO public.waste_fee_rates (municipality_id, ordinance_ref, ${cols}) VALUES ($1,'อ้างอิง',${vals})`, [MA])
  await rejects(ins('effective_from, basis, base_collect', `'2020-01-01','units',30`), { code: '23514' })
  await rejects(ins('effective_from, basis, base_collect, base_dispose, unit_collect', `'2020-01-01','units',30,20,51`), { code: '23514' })
  await rejects(ins('effective_from, basis, place_type_rates', `'2020-01-01','place_type','{"villa":20}'`), { code: '22023' })
  await rejects(ins('effective_from, basis, place_type_rates', `'2020-01-01','place_type','{"house":-1}'`), { code: '22023' })
  await rejects(ins('effective_from, basis, place_type_rates', `'2020-01-01','place_type','{}'`), { code: '22023' })
  await rejects(ins('effective_from, basis, place_type_rates, sorting_discount', `'2020-01-01','place_type','{"house":20}',true`), { code: '23514' })
  await rejects(asUser('staffDG', RATE_A, [MA, await month(-12), 'ซ้ำ', false]), { code: '23505' })
  await rejects(asUser('staffDG', 'UPDATE public.waste_fee_rates SET municipality_id = $2 WHERE id = $1', [rateNow.id, MB]))
  await rejects(asUser('superadmin', 'UPDATE public.waste_fee_rates SET id = gen_random_uuid() WHERE id = $1', [rateNow.id]), DENIED)
})

await test('อัตราตัวอย่าง: แก้ตัวเลข → ป้าย is_example หลุดเอง · แก้แค่หมายเหตุ → ยังเป็นตัวอย่าง', async () => {
  const demoRate = (await rows('SELECT id FROM public.waste_fee_rates WHERE municipality_id = $1', [MD]))[0].id
  await rows("UPDATE public.waste_fee_rates SET note = 'ปรับหมายเหตุ' WHERE id = $1", [demoRate])
  assert.equal((await rows('SELECT is_example FROM public.waste_fee_rates WHERE id = $1', [demoRate]))[0].is_example, true)
  await rows('UPDATE public.waste_fee_rates SET base_collect = 35 WHERE id = $1', [demoRate])
  assert.equal((await rows('SELECT is_example FROM public.waste_fee_rates WHERE id = $1', [demoRate]))[0].is_example, false)
})

// ── 5) บัญชี ──
const newAccount = async (cols = {}) => (await asUser('staffDG', `INSERT INTO public.waste_fee_accounts
    (municipality_id, payer_name, payer_phone, house_no, village, address, place_type, monthly_units, service_from, account_no)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *, monthly_units::text AS units_text`,
  [MA, cols.name ?? '  ผู้ชำระทดสอบ ', cols.phone ?? '0812345678', cols.house ?? ' 12/3 ', cols.village ?? 'หมู่ 1', cols.address ?? 'ซอยทดสอบ',
   cols.place ?? 'house', cols.units ?? 1, cols.from ?? await month(-3), cols.no ?? null]))[0]

let acc
await test('บัญชี: ตัดช่องว่าง · วันเริ่มเก็บปัดเป็นวันที่ 1 · หน่วยปัดขึ้นทีละกึ่ง (1.04→1.5, 1.3→1.5, 2→2.0) ไม่มีทศนิยมยาว · เลขทะเบียนซ้ำไม่ได้', async () => {
  const from = await month(-3)
  acc = await newAccount({ from: from.slice(0, 8) + '15', no: 'WF-001' })
  assert.equal(acc.payer_name, 'ผู้ชำระทดสอบ')
  assert.equal(acc.house_no, '12/3')
  assert.equal(acc.service_from.toISOString?.().slice(0, 10) ?? String(acc.service_from), from)
  assert.equal(acc.created_by, U.staffDG)
  for (const [input, want] of [[1.04, '1.5'], [1.3, '1.5'], [2, '2.0'], [0.2, '0.5'], [30.6, '31.0']]) {
    const a = await newAccount({ units: input })
    assert.equal(a.units_text, want, `units ${input}`)
    await rows('DELETE FROM public.waste_fee_accounts WHERE id = $1', [a.id])
  }
  await rejects(newAccount({ no: 'WF-001' }), { code: '23505' })
  await rejects(newAccount({ units: 0 }), { code: '23514' })
  await rejects(newAccount({ place: 'villa' }), { code: '23514' })
  await rejects(newAccount({ phone: 'abc' }), { code: '23514' })
})

await test('บัญชี: เลิกเก็บต้องมีเหตุผล + หลังเดือนเริ่ม · ปัดเป็นวันที่ 1 · เปลี่ยน อปท./ชุดนำเข้าไม่ได้', async () => {
  const a = await newAccount()
  await rejects(asUser('staffDG', "UPDATE public.waste_fee_accounts SET status = 'closed', closed_from = $2 WHERE id = $1", [a.id, cur]), { code: '23514' })
  await rejects(asUser('staffDG', "UPDATE public.waste_fee_accounts SET status = 'closed', closed_from = $2, closed_reason = 'ย้ายออก' WHERE id = $1",
    [a.id, await month(-3)]), { code: '23514' })
  await asUser('staffDG', "UPDATE public.waste_fee_accounts SET status = 'closed', closed_from = $2, closed_reason = 'ย้ายออก' WHERE id = $1",
    [a.id, cur.slice(0, 8) + '20'])
  assert.equal((await rows('SELECT closed_from::text AS d FROM public.waste_fee_accounts WHERE id = $1', [a.id]))[0].d, cur)
  await rejects(asUser('superadmin', 'UPDATE public.waste_fee_accounts SET municipality_id = $2 WHERE id = $1', [a.id, MB]), DENIED)
  await rejects(asUser('staffDG', 'UPDATE public.waste_fee_accounts SET import_batch = gen_random_uuid() WHERE id = $1', [a.id]), DENIED)
})

// ── 6) ตัวคำนวณ ──
const compute = async (rate, units, place, sorting, who = 'staffDG') =>
  (await asUser(who, 'SELECT public.wfee_compute($1,$2,$3,$4) AS r', [rate, units, place, sorting]))[0].r
await test('wfee_compute: ≤1 หน่วย = เหมา · ส่วนเกินถึง 30 = unit · เกิน 30 = big_unit · คัดแยก = ค่ากำจัดกึ่งหนึ่ง · รายการย่อยบวกได้เท่ายอดรวม', async () => {
  const cases = [
    [0.5, false, 30, 20, 0, 50], [1, false, 30, 20, 0, 50], [1.5, false, 55.5, 46, 0, 101.5], [5, false, 234, 228, 0, 462],
    [30, false, 1509, 1528, 0, 3037], [31, false, 1575, 1590, 0, 3165], [1, true, 30, 20, 10, 40], [1.5, true, 55.5, 46, 23, 78.5],
  ]
  for (const [u, s, col, dis, disc, total] of cases) {
    const r = await compute(rateNow.id, u, 'house', s)
    assert.equal(r.ok, true)
    assert.deepEqual([r.collect, r.dispose, r.discount, r.total].map(Number), [col, dis, disc, total], `units ${u} sorting ${s}`)
    assert.equal(Number(r.collect) + Number(r.dispose) - Number(r.discount), Number(r.total))
  }
  assert.equal((await compute(rateNow.id, 1.3, 'house', false)).error, 'bad_units')
  // ผู้ที่ไม่ใช่ผู้จัดการ = ไม่พบอัตรา (INVOKER + RLS)
  assert.equal((await compute(rateNow.id, 1, 'house', false, 'officerD1')).error, 'rate_not_found')
})

await test('wfee_compute: place_type เหมาตามประเภท · ประเภทไม่มีอัตรา = error · ไม่มีขั้นส่วนเกิน = error · ผลตรงกับ computeMonthly ฝั่งจอทุกกรณี', async () => {
  const flat = (await asUser('staffDG', `INSERT INTO public.waste_fee_rates (municipality_id, effective_from, ordinance_ref, basis, place_type_rates)
    VALUES ($1,'2015-01-01','ข้อบัญญัติเดิม','place_type','{"house":20,"shop":45.5}') RETURNING *`, [MA]))[0]
  const baseOnly = (await asUser('staffDG', `INSERT INTO public.waste_fee_rates (municipality_id, effective_from, ordinance_ref, basis, base_collect, base_dispose)
    VALUES ($1,'2016-01-01','เหมาอย่างเดียว','units',25,15) RETURNING *`, [MA]))[0]
  assert.equal(Number((await compute(flat.id, 3, 'shop', true)).total), 45.5)
  assert.equal((await compute(flat.id, 1, 'agency', false)).error, 'no_rate_for_place_type')
  assert.equal((await compute(baseOnly.id, 1.5, 'house', false)).error, 'no_unit_rate')
  const twoTier = (await asUser('staffDG', `INSERT INTO public.waste_fee_rates (municipality_id, effective_from, ordinance_ref, basis, base_collect, base_dispose,
    unit_collect, unit_dispose) VALUES ($1,'2017-01-01','สองขั้น','units',30,20,51.25,52.75) RETURNING *`, [MA]))[0]
  assert.equal((await compute(twoTier.id, 31, 'house', false)).error, 'no_big_unit_rate')

  const num = v => (v === null || v === undefined ? v : Number(v))
  for (const rate of [rateNow, flat, baseOnly, twoTier]) {
    for (const u of [0.5, 1, 1.5, 2.5, 7, 29.5, 30, 30.5, 44]) {
      for (const place of ['house', 'shop', 'agency']) {
        for (const s of [false, true]) {
          const db = await compute(rate.id, u, place, s)
          const js = computeMonthly({ ...rate, place_type_rates: rate.place_type_rates }, u, place, s)
          assert.equal(Boolean(js.ok), Boolean(db.ok), `${rate.ordinance_ref} u=${u} ${place} ${s}: ok`)
          if (db.ok) {
            assert.deepEqual([js.collect, js.dispose, js.discount, js.total].map(num), [db.collect, db.dispose, db.discount, db.total].map(num),
              `${rate.ordinance_ref} u=${u} ${place} ${s}`)
          } else {
            assert.equal(js.error, db.error, `${rate.ordinance_ref} u=${u} ${place} ${s}: error`)
          }
        }
      }
    }
  }
  for (const r of [flat, baseOnly, twoTier]) await rows('DELETE FROM public.waste_fee_rates WHERE id = $1', [r.id])
})

// ── 7) ยอดรายเดือนของบัญชี ──
const monthOf = async (accountId, m, who = 'staffDG') => (await asUser(who, 'SELECT public.wfee_account_month($1,$2) AS r', [accountId, m]))[0].r
await test('wfee_account_month: ก่อนเริ่มเก็บ/หลังเลิกเก็บ = ไม่เก็บ · เลือกรุ่นอัตราตามวันที่ 1 ของเดือน · ไม่มีอัตรา = error · อปท. อื่นไม่เห็น · เดือนว่าง = bad_month', async () => {
  const a = await newAccount({ from: await month(-14) })
  assert.equal((await monthOf(a.id, await month(-15))).reason, 'before_service')
  assert.equal((await monthOf(a.id, await month(-13))).error, 'no_rate_for_month')
  const r1 = await monthOf(a.id, (await month(-1)).slice(0, 8) + '20')
  assert.deepEqual([r1.billable, r1.month, Number(r1.total), r1.rate_id], [true, await month(-1), 50, rateNow.id])
  // รุ่นใหม่มีผลกลางเดือนหน้า → เดือนหน้ายังใช้รุ่นเดิม · เดือนถัดไปใช้รุ่นใหม่
  const next = (await asUser('staffDG', RATE_A.replace('30,20,51,52,66,62', '51,52,51,52,66,62'),
    [MA, (await month(1)).slice(0, 8) + '17', 'เทศบัญญัติทดสอบ ขั้นที่ 2', true]))[0]
  assert.equal((await monthOf(a.id, await month(1))).rate_id, rateNow.id)
  assert.equal((await monthOf(a.id, await month(2))).rate_id, next.id)
  assert.equal(Number((await monthOf(a.id, await month(2))).total), 103)
  await asUser('staffDG', "UPDATE public.waste_fee_accounts SET status = 'closed', closed_from = $2, closed_reason = 'รื้อถอน' WHERE id = $1", [a.id, await month(1)])
  assert.equal((await monthOf(a.id, await month(1))).reason, 'closed')
  assert.equal((await monthOf(a.id, null)).error, 'bad_month')
  assert.equal((await monthOf(a.id, cur, 'staffB')).error, 'account_not_found')
  await rows('DELETE FROM public.waste_fee_rates WHERE id = $1', [next.id])
})

// ── 8) ยืนยันการคัดแยก ──
const sorting = (who, accountId, on, from, note = 'ตรวจถังแยก 5 ประเภทแล้ว') =>
  asUser(who, 'SELECT public.wfee_set_sorting($1,$2,$3,$4) AS r', [accountId, on, from, note]).then(r => r[0].r)
const periods = async accountId => rows(`SELECT starts_on::text AS s, ends_on::text AS e FROM public.waste_fee_sorting_periods
  WHERE account_id = $1 ORDER BY starts_on`, [accountId])
const discountIn = async (accountId, m) => Number((await monthOf(accountId, m)).discount)

await test('คัดแยก: ต้องเป็นผู้จัดการ · เหตุผลบังคับ · ย้อนหลังไม่ได้ · ล่วงหน้าเกิน 12 เดือนไม่ได้ · บัญชีเลิกเก็บเปิดลดไม่ได้', async () => {
  const a = await newAccount()
  await rejects(sorting('officerD1', a.id, true, cur), DENIED)
  await rejects(sorting('staffB', a.id, true, cur), DENIED)
  await rejects(sorting('anon', a.id, true, cur), DENIED)
  await rejects(sorting('staffDG', a.id, true, cur, ' ab '), { code: '22023' })
  await rejects(sorting('staffDG', a.id, true, await month(-1)), { message: /ไม่ย้อนหลัง/ })
  await rejects(sorting('staffDG', a.id, true, await month(13)), { code: '22023' })
  await rejects(sorting('staffDG', a.id, null, cur), { code: '22023' })
  await rejects(sorting('staffDG', a.id, false, await month(1)), { message: /ไม่ได้รับการลดอยู่/ })
  await asUser('staffDG', "UPDATE public.waste_fee_accounts SET status = 'closed', closed_from = $2, closed_reason = 'ย้ายออก' WHERE id = $1", [a.id, await month(1)])
  await rejects(sorting('staffDG', a.id, true, cur), { message: /เลิกเก็บแล้ว/ })
})

await test('คัดแยก: เปิดเดือนนี้ → ลดเดือนนี้ · เปิดซ้ำขณะลดอยู่ = ปฏิเสธ · เลิกเดือนนี้ไม่ได้ · เลิกเดือนหน้า = เดือนนี้ยังลด เดือนหน้าเต็ม · ช่วงเดิมไม่หาย', async () => {
  const a = await newAccount()
  assert.equal(await discountIn(a.id, cur), 0)
  const r = await sorting('staffDG', a.id, true, cur.slice(0, 8) + '28')
  assert.deepEqual([r.op, r.starts_on, r.ends_on, r.rate_has_discount], ['start', cur, null, true])
  assert.equal(await discountIn(a.id, cur), 10)
  assert.equal(await discountIn(a.id, await month(-1)), 0) // ไม่ย้อนหลัง
  await rejects(sorting('staffDG', a.id, true, await month(1)), { message: /ได้รับการลดอยู่แล้ว/ })
  await rejects(sorting('staffDG', a.id, false, cur), { message: /เดือนถัดไป/ })
  const stop = await sorting('staffDG', a.id, false, await month(2), 'ตรวจซ้ำแล้วไม่แยกขยะ')
  assert.deepEqual([stop.op, stop.ends_on, stop.rate_has_discount], ['stop', await month(2), null])
  assert.equal(await discountIn(a.id, await month(1)), 10)
  assert.equal(await discountIn(a.id, await month(2)), 0)
  assert.deepEqual(await periods(a.id), [{ s: cur, e: await month(2) }])
})

await test('คัดแยก (ผลตรวจ C1): มีกำหนดเลิกล่วงหน้า แล้วเปิดใหม่เลยวันเลิก = ปฏิเสธ (ไม่ให้เดือนช่องว่างได้ลด) · เปิดไม่เกินวันเลิก = ยกเลิกกำหนดเลิก', async () => {
  const a = await newAccount()
  await sorting('staffDG', a.id, true, cur)
  await sorting('staffDG', a.id, false, await month(2))
  await rejects(sorting('staffDG', a.id, true, await month(4)), { message: /กำหนดเลิก/ })
  assert.deepEqual(await periods(a.id), [{ s: cur, e: await month(2) }])
  const r = await sorting('staffDG', a.id, true, await month(2), 'ตรวจใหม่ ยังแยกอยู่')
  assert.deepEqual([r.op, r.starts_on, r.ends_on], ['cancel_stop', cur, null])
  assert.deepEqual(await periods(a.id), [{ s: cur, e: null }])
  assert.equal(await discountIn(a.id, await month(3)), 10)
})

await test('คัดแยก: ตั้งล่วงหน้า → เลื่อนวันเริ่มได้ · เลิกก่อนเริ่ม = ลบช่วงที่ไม่เคยมีผล · หลังช่วงเดิมจบ เปิดช่วงใหม่ได้โดยช่วงเก่ายังอยู่', async () => {
  const a = await newAccount()
  let r = await sorting('staffDG', a.id, true, await month(3))
  assert.equal(r.op, 'start')
  r = await sorting('staffDG', a.id, true, await month(2))
  assert.deepEqual([r.op, r.starts_on], ['reschedule', await month(2)])
  r = await sorting('staffDG', a.id, false, await month(2))
  assert.equal(r.op, 'drop_unstarted')
  assert.deepEqual(await periods(a.id), [])
  // ช่วงเก่าที่จบไปแล้ว (จำลองด้วย root ตามที่ระบบจะเห็นในอนาคต) + เปิดช่วงใหม่
  await rows(`INSERT INTO public.waste_fee_sorting_periods (municipality_id, account_id, starts_on, ends_on, note, ended_at)
    VALUES ($1,$2,$3,$4,'ช่วงเก่า', now())`, [MA, a.id, await month(-3), await month(-1)])
  r = await sorting('staffDG', a.id, true, cur)
  assert.equal(r.op, 'start')
  assert.deepEqual(await periods(a.id), [{ s: await month(-3), e: await month(-1) }, { s: cur, e: null }])
  assert.equal(await discountIn(a.id, await month(-2)), 10)
  assert.equal(await discountIn(a.id, await month(-1)), 0)
})

await test('คัดแยก: รุ่นอัตราไม่มีหมวดลด → rate_has_discount=false และยอดไม่ลด (ระบบบันทึกการยืนยันไว้)', async () => {
  await rows('UPDATE public.waste_fee_rates SET sorting_discount = false WHERE id = $1', [rateNow.id])
  const a = await newAccount()
  const r = await sorting('staffDG', a.id, true, cur)
  assert.equal(r.rate_has_discount, false)
  assert.equal(await discountIn(a.id, cur), 0)
  await rows('UPDATE public.waste_fee_rates SET sorting_discount = true WHERE id = $1', [rateNow.id])
  assert.equal(await discountIn(a.id, cur), 10)
})

await test('ตารางช่วงลด: ผู้จัดการอ่านได้ แต่เขียน/แก้/ลบตรงไม่ได้ · คนนอกอ่านไม่ได้', async () => {
  assert.ok((await asUser('staffDG', 'SELECT count(*)::int AS n FROM public.waste_fee_sorting_periods'))[0].n > 0)
  assert.equal((await asUser('officerD1', 'SELECT count(*)::int AS n FROM public.waste_fee_sorting_periods'))[0].n, 0)
  await rejects(asUser('staffDG', `INSERT INTO public.waste_fee_sorting_periods (municipality_id, account_id, starts_on, note) VALUES ($1,$2,$3,'แอบเปิด')`,
    [MA, acc.id, await month(-6)]), DENIED)
  await rejects(asUser('adminA', 'UPDATE public.waste_fee_sorting_periods SET starts_on = $1', [await month(-6)]), DENIED)
  await rejects(asUser('superadmin', 'DELETE FROM public.waste_fee_sorting_periods'), DENIED)
})

// ── 9) ประวัติ ──
await test('ประวัติ: เพิ่ม/แก้/ลบ ลงเอง · เบอร์/ที่อยู่/บ้านเลขที่ = changed ไม่เก็บค่า · คัดแยกลง action sorting + เหตุผล · เขียนประวัติตรงไม่ได้', async () => {
  const a = await newAccount({ phone: '0899999999', house: '99' })
  const ins = (await rows("SELECT changes FROM public.waste_fee_events WHERE entity_id = $1 AND action = 'insert'", [a.id]))[0].changes
  assert.equal(ins.payer_name, 'ผู้ชำระทดสอบ')
  for (const k of ['payer_phone', 'house_no', 'address']) assert.equal(k in ins, false, k)
  await asUser('staffDG', "UPDATE public.waste_fee_accounts SET payer_phone = '0811111111', house_no = '100', address = 'ใหม่', monthly_units = 2 WHERE id = $1", [a.id])
  const upd = (await rows("SELECT changes, actor FROM public.waste_fee_events WHERE entity_id = $1 AND action = 'update'", [a.id]))[0]
  assert.deepEqual([upd.changes.payer_phone, upd.changes.house_no, upd.changes.address], ['changed', 'changed', 'changed'])
  assert.deepEqual(upd.changes.monthly_units, [1.0, 2.0])
  assert.equal(upd.actor, U.staffDG)
  assert.ok(!JSON.stringify(await rows('SELECT changes FROM public.waste_fee_events WHERE entity_id = $1', [a.id])).includes('0811111111'))
  await sorting('staffDG', a.id, true, cur, 'ถ่ายภาพถังแยกไว้แล้ว')
  const s = (await rows("SELECT changes, reason FROM public.waste_fee_events WHERE entity_id = $1 AND action = 'sorting'", [a.id]))[0]
  assert.deepEqual([s.changes.op, s.reason], ['start', 'ถ่ายภาพถังแยกไว้แล้ว'])
  await asUser('staffDG', 'DELETE FROM public.waste_fee_accounts WHERE id = $1', [a.id])
  const del = (await rows("SELECT changes FROM public.waste_fee_events WHERE entity_id = $1 AND action = 'delete'", [a.id]))[0].changes
  assert.equal('payer_phone' in del || 'house_no' in del, false)
  assert.deepEqual(await periods(a.id), []) // ช่วงลดของบัญชีที่ลบหายตาม (ประวัติยังอยู่)
  await rejects(asUser('staffDG', "INSERT INTO public.waste_fee_events (municipality_id, entity, entity_id, action) VALUES ($1,'account',$2,'update')", [MA, a.id]), DENIED)
  await rejects(asUser('adminA', 'DELETE FROM public.waste_fee_events'), DENIED)
  await rejects(asUser('superadmin', 'UPDATE public.waste_fee_events SET reason = null'), DENIED)
})

// ── 10) TRUNCATE / anon / ลบ อปท. ──
await test('TRUNCATE ไม่ได้ทุกตาราง · anon เรียก RPC ไม่ได้ · ลบ อปท. ทั้งแถวได้ (ประวัติไม่ขวาง cascade)', async () => {
  for (const t of ['waste_fee_rates', 'waste_fee_accounts', 'waste_fee_sorting_periods', 'waste_fee_events']) {
    await rejects(asUser('superadmin', `TRUNCATE public.${t}`), DENIED)
  }
  await rejects(asUser('anon', 'SELECT public.wfee_account_month($1,$2)', [acc.id, cur]), DENIED)
  await rejects(asUser('anon', 'SELECT public.wfee_set_sorting($1,true,$2,$3)', [acc.id, cur, 'xxxx']), DENIED)
  await rejects(asUser('staffDG', 'SELECT public.wfee_log_event()'))
  await rows('DELETE FROM public.municipalities WHERE id = $1', [MD])
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.waste_fee_rates WHERE municipality_id = $1', [MD]))[0].n, 0)
})

console.log(`\nผ่าน ${cases} กรณี`)
