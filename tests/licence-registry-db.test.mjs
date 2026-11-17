// ทะเบียนใบอนุญาต (ขั้น 1B / E3) — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/licence-registry-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: 20261208100000 (ตาราง) → 20261208100100 (สิทธิ์/trigger/RPC/policy)
//
// ตรวจ: (1) ด่านหัวไฟล์ + รันซ้ำได้ (2) กองที่ถือเรื่อง: เดาเอง/ตั้งค่า + เมทริกซ์สิทธิ์ทุกบทบาท (3) ชนิดเอกสารตามหมวด
// (4) รูปแบบวันที่ใบอนุญาต/หนังสือรับรอง (5) ต่ออายุโดยชำระค่าธรรมเนียม (พ.ร.ฎ. ๒๕๖๔) (6) ค่าธรรมเนียมรายปี (ม.๖๕)
// (7) ยกเลิกรายการรับเงิน (8) เปลี่ยนสถานะ (ม.๕๙ พักใช้ ≤ 15 วัน) (9) ประวัติ (10) ลบ/TRUNCATE/anon
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261208100000_licence_registry_tables.sql')
const rlsSql = await readMigration('20261208100100_licence_registry_rls_rpc.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
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

CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id), name text,
  code text, sort_order integer DEFAULT 0);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id), department_id uuid REFERENCES public.departments(id));
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id() TO anon, authenticated;

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ'), ('${MB}', 'อปท. บี');
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
const affected = async (sql, params = []) => (await db.query(sql, params)).affectedRows
const rejects = (promise, expect = {}) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const DENIED = { code: '42501' }

let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }

await test('ด่านหัวไฟล์: รันไฟล์ 2 ก่อนไฟล์ 1 → พังพร้อมชื่อไฟล์ที่ต้องรันก่อน', async () => {
  await rejects(db.exec(rlsSql), { message: /20261208100000/ })
  await db.exec('ROLLBACK').catch(() => {})
})

await db.exec(tablesSql)
await db.exec(rlsSql)
await db.exec(tablesSql) // รันซ้ำทั้งชุดต้องไม่พัง
await db.exec(rlsSql)

const today = (await rows('SELECT public.licence_today()::text AS d'))[0].d
const day = async n => (await rows('SELECT ($1::date + $2::int)::text AS d', [today, n]))[0].d
const addMonths = async (d, m) => (await rows("SELECT ($1::date + make_interval(months => $2))::date::text AS d", [d, m]))[0].d

const asUser = async (alias, sql, params = []) => { await actor(alias); try { return await rows(sql, params) } finally { await asRoot() } }
const newType = async (alias, muni, category, name, extra = {}) =>
  (await asUser(alias, `INSERT INTO public.licence_types (municipality_id, category, name, renewal_window_days)
    VALUES ($1,$2,$3,$4) RETURNING *`, [muni, category, name, extra.window ?? null]))[0]
const newLicence = async (alias, muni, typeId, cols = {}) =>
  (await asUser(alias, `INSERT INTO public.licences (municipality_id, licence_type_id, business_name, holder_name, licence_no,
      issued_on, expires_on, next_fee_due_on, fee_amount)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [muni, typeId, cols.business ?? 'ร้านทดสอบ', cols.holder ?? 'ผู้ประกอบการ', cols.no ?? null,
     cols.issued ?? null, cols.expires ?? null, cols.due ?? null, cols.fee ?? 500]))[0]
const fee = (alias, licenceId, kind, paidOn, receipt, extra = {}) =>
  asUser(alias, 'SELECT public.licence_record_fee($1,$2,$3,$4,$5,$6,$7) AS r',
    [licenceId, kind, paidOn, extra.amount ?? 500, receipt, extra.surcharge ?? 0, extra.cert ?? true])

// ── สิทธิ์ ──
let hazard
await test('กองที่ถือเรื่องเดาเอง: กองสาธารณสุขยังไม่มีคน → สำนักปลัด · เมทริกซ์สิทธิ์', async () => {
  hazard = await newType('staffDG', MA, 'health_hazard', 'กิจการที่เป็นอันตรายต่อสุขภาพ')
  assert.equal(hazard.doc_kind, 'licence')
  assert.equal(hazard.validity_months, 12)
  for (const who of ['adminA', 'superadmin', 'staffDG']) {
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.licence_types')).at(0).n >= 1, true, who)
  }
  for (const who of ['officerD1', 'techDG', 'viewerA', 'citizenA', 'councilA', 'adminB', 'staffB']) {
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.licence_types WHERE municipality_id = $1', [MA]))[0].n, 0, who)
    await rejects(asUser(who, `INSERT INTO public.licence_types (municipality_id, category, name) VALUES ($1,'market','ตลาด ${who}')`, [MA]))
  }
  await rejects(asUser('anon', 'SELECT * FROM public.licence_types'), DENIED)
})

await test('ค่าตั้ง: admin เลือกกองที่ถือเรื่อง → สิทธิ์ย้ายตาม · คนอื่นตั้งไม่ได้ · กองต่าง อปท. ไม่ได้', async () => {
  await rejects(asUser('staffDG', 'INSERT INTO public.licence_settings (municipality_id, owner_department_id) VALUES ($1,$2)', [MA, D1]))
  await rejects(asUser('adminA', 'INSERT INTO public.licence_settings (municipality_id, owner_department_id) VALUES ($1,$2)', [MA, DB1]),
    { code: '23514' })
  await asUser('adminA', 'INSERT INTO public.licence_settings (municipality_id, owner_department_id, remind_days) VALUES ($1,$2,$3)',
    [MA, D1, [7, 30, 30, 60]])
  assert.deepEqual((await rows('SELECT remind_days FROM public.licence_settings WHERE municipality_id = $1', [MA]))[0].remind_days, [60, 30, 7])
  assert.equal((await asUser('officerD1', 'SELECT count(*)::int AS n FROM public.licence_types'))[0].n, 1)
  assert.equal((await asUser('staffDG', 'SELECT count(*)::int AS n FROM public.licence_types'))[0].n, 0)
  // คืนค่า: ให้สำนักปลัดถือเรื่องต่อ (ใช้ในเคสถัดไป)
  await asUser('adminA', 'UPDATE public.licence_settings SET owner_department_id = $2 WHERE municipality_id = $1', [MA, DG])
  await rejects(asUser('staffDG', 'UPDATE public.licence_settings SET remind_days = $2 WHERE municipality_id = $1 RETURNING 1', [MA, [1]])
    .then(r => { if (r.length === 0) throw Object.assign(new Error('no rows'), { code: '42501' }) }), DENIED)
  await rejects(asUser('adminA', 'DELETE FROM public.licence_settings WHERE municipality_id = $1', [MA]), DENIED)
})

// ── ประเภท ──
let notice
await test('หมวดอาหาร ≤ 200 ตร.ม. = หนังสือรับรองการแจ้งเสมอ (ไม่มีอายุ ไม่ต่ออายุโดยชำระ) · ส่งค่าอื่นมาก็ถูกทับ', async () => {
  notice = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name, doc_kind, validity_months, renewal_by_fee)
    VALUES ($1,'food_notice','สถานที่จำหน่ายอาหาร ไม่เกิน 200 ตร.ม.','licence',24,true) RETURNING *`, [MA]))[0]
  assert.equal(notice.doc_kind, 'notice_certificate')
  assert.equal(notice.validity_months, null)
  assert.equal(notice.renewal_by_fee, false)
  const other = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name, validity_months)
    VALUES ($1,'other','อื่นๆ 2 ปี',24) RETURNING *`, [MA]))[0]
  assert.equal(other.validity_months, 24)
  const market = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name, validity_months)
    VALUES ($1,'market','ตลาด',36) RETURNING *`, [MA]))[0]
  assert.equal(market.validity_months, 12, 'ม.55 ใบอนุญาตหมวดตามตัวบทอายุ 1 ปีเสมอ')
  await rejects(asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name, external_url)
    VALUES ($1,'market','ตลาด 2','javascript:alert(1)')`, [MA]), { code: '23514' })
})

// ── ใบ ──
let lic
await test('ใบอนุญาตต้องมีวันหมดอายุ · หนังสือรับรองห้ามมี · ใบใหม่ต้อง active · ข้าม อปท. ไม่ได้', async () => {
  await rejects(newLicence('staffDG', MA, hazard.id, {}), { code: '23514' })
  await rejects(newLicence('staffDG', MA, notice.id, { expires: await day(30) }), { code: '23514' })
  await rejects(asUser('staffDG', `INSERT INTO public.licences (municipality_id, licence_type_id, business_name, holder_name, expires_on, status, status_reason)
    VALUES ($1,$2,'ร้าน','คน',$3,'suspended','x')`, [MA, hazard.id, await day(30)]), DENIED)
  const typeB = (await newType('staffB', MB, 'market', 'ตลาด บี'))
  await rejects(newLicence('superadmin', MA, typeB.id, { expires: await day(30) }))
  lic = await newLicence('staffDG', MA, hazard.id, { no: ' 12/2569 ', issued: await day(-355), expires: await day(10) })
  assert.equal(lic.licence_no, '12/2569')
  await rejects(newLicence('staffDG', MA, hazard.id, { no: '12/2569', expires: await day(10) }), { code: '23505' })
  await rejects(asUser('staffDG', `UPDATE public.licences SET status = 'revoked', status_reason = 'x' WHERE id = $1`, [lic.id]), DENIED)
})

await test('ต่ออายุโดยชำระค่าธรรมเนียม: ต้องรับรองไม่เปลี่ยนสาระสำคัญ · หลังสิ้นอายุไม่ได้ · ได้วันหมดอายุ +12 เดือน', async () => {
  await rejects(fee('staffDG', lic.id, 'renewal', today, 'R-1', { cert: false }), { message: /สาระสำคัญ/ })
  await rejects(fee('staffDG', lic.id, 'renewal', await day(1), 'R-1'), { message: /วันนี้/ })
  await rejects(fee('officerD1', lic.id, 'renewal', today, 'R-1'), DENIED)
  await rejects(fee('staffDG', lic.id, 'annual', today, 'R-1'), { message: /หนังสือรับรองการแจ้ง/ })
  const r = (await fee('staffDG', lic.id, 'renewal', today, 'R-1'))[0].r
  const expected = (await rows("SELECT ((($1::date + 1) + interval '12 months')::date - 1)::text AS d", [await day(10)]))[0].d
  assert.equal(r.expires_on, expected)
  assert.equal((await rows('SELECT expires_on::text AS e FROM public.licences WHERE id = $1', [lic.id]))[0].e, expected)
  await rejects(fee('staffDG', lic.id, 'renewal', today, 'R-1'), { code: '23505' })
  // ใบที่มีรายการรับเงินแล้ว แก้วันหมดอายุตรงๆ ไม่ได้
  await rejects(asUser('staffDG', 'UPDATE public.licences SET expires_on = expires_on + 365 WHERE id = $1', [lic.id]), DENIED)
  // แก้ช่องอื่นได้
  await asUser('staffDG', "UPDATE public.licences SET holder_phone = '081-234-5678' WHERE id = $1", [lic.id])
})

await test('ชำระหลังวันสุดท้ายของใบ → ปฏิเสธ (ต้องยื่นใหม่) · ช่วงต่ออายุตามข้อบัญญัติ', async () => {
  const late = await newLicence('staffDG', MA, hazard.id, { expires: await day(-1) })
  await rejects(fee('staffDG', late.id, 'renewal', today, 'R-late'), { message: /สิ้นอายุ/ })
  const onDay = await newLicence('staffDG', MA, hazard.id, { expires: today })
  await fee('staffDG', onDay.id, 'renewal', today, 'R-onday')
  const windowed = await newType('staffDG', MA, 'street_vending', 'จำหน่ายสินค้าในที่สาธารณะ', { window: 30 })
  const far = await newLicence('staffDG', MA, windowed.id, { expires: await day(60) })
  await rejects(fee('staffDG', far.id, 'renewal', today, 'R-far'), { message: /ช่วงต่ออายุ/ })
})

await test('ค่าธรรมเนียมรายปี (หนังสือรับรองการแจ้ง ม.65): วันครบกำหนดถัดไป +12 เดือน · ต้องตั้งวันครบกำหนดก่อน', async () => {
  const noDue = await newLicence('staffDG', MA, notice.id, {})
  await rejects(fee('staffDG', noDue.id, 'annual', today, 'A-0'), { message: /วันครบกำหนด/ })
  const cert = await newLicence('staffDG', MA, notice.id, { due: await day(-5) })
  await rejects(fee('staffDG', cert.id, 'renewal', today, 'A-1'), { message: /ไม่ได้ตั้งให้ต่ออายุ/ })
  const r = (await fee('staffDG', cert.id, 'annual', today, 'A-1', { amount: 100, surcharge: 20 }))[0].r
  assert.equal(r.next_fee_due_on, await addMonths(await day(-5), 12))
  const pay = (await rows('SELECT surcharge::text AS s, period_from::text AS f FROM public.licence_fee_payments WHERE receipt_no = $1', ['A-1']))[0]
  assert.equal(pay.s, '20.00')
  assert.equal(pay.f, await day(-5))
})

await test('ต่อซ้อนเกิน 1 รอบไม่ได้ (ใบอนุญาต + ค่าธรรมเนียมรายปี) · กันบันทึกซ้ำคนละเลขใบเสร็จ', async () => {
  await rejects(fee('staffDG', lic.id, 'renewal', today, 'R-dup'), { message: /ต่อซ้อน/ })
  const cert = await newLicence('staffDG', MA, notice.id, { due: await day(30) })
  await fee('staffDG', cert.id, 'annual', today, 'A-ahead')          // ชำระรอบที่จะถึงล่วงหน้า 1 รอบ ได้
  await rejects(fee('staffDG', cert.id, 'annual', today, 'A-ahead2'), { message: /ชำระซ้อน/ })
})

await test('วันหมดอายุชนปลายเดือน/ปีอธิกสุรทินไม่เพี้ยนสะสม (เริ่มรอบ 1 มี.ค. → จบ 28/29 ก.พ.)', async () => {
  // วันสิ้นเดือน ก.พ. ถัดไปที่ยังไม่ผ่าน (ต้องอยู่ในช่วงที่ RPC รับได้: ชำระวันนี้ ≤ วันสุดท้าย และอยู่ในรอบปัจจุบัน)
  const y = Number(today.slice(0, 4))
  const leap = yy => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0
  const febEnd = yy => `${yy}-02-${leap(yy) ? '29' : '28'}`
  const exp = febEnd(y) >= today ? febEnd(y) : febEnd(y + 1)
  const feb = await newLicence('staffDG', MA, hazard.id, { expires: exp })
  const r = (await fee('staffDG', feb.id, 'renewal', today, 'R-feb'))[0].r
  assert.equal(r.expires_on, febEnd(Number(exp.slice(0, 4)) + 1))
  assert.equal(r.period_from, `${exp.slice(0, 4)}-03-01`)
})

await test('ยกเลิกรายการรับเงิน: เฉพาะรายการล่าสุด · ต้องมีเหตุผล · ย้อนวันเอง · เลขใบเสร็จที่ยกเลิกใช้ใหม่ได้', async () => {
  const cert = await newLicence('staffDG', MA, notice.id, { due: await day(-3) })
  const due0 = await day(-3)
  await fee('staffDG', cert.id, 'annual', today, 'V-1')   // รอบที่ค้าง
  await fee('staffDG', cert.id, 'annual', today, 'V-2')   // รอบถัดไป (ล่วงหน้า 1 รอบ)
  const [p1, p2] = await rows("SELECT id FROM public.licence_fee_payments WHERE receipt_no IN ('V-1','V-2') ORDER BY created_at, id")
  await rejects(asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [p1.id, 'บันทึกผิด']), { message: /ล่าสุด/ })
  await rejects(asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [p2.id, '']), { message: /เหตุผล/ })
  await rejects(asUser('officerD1', 'SELECT public.licence_void_fee($1,$2)', [p2.id, 'บันทึกผิด']), DENIED)
  await asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [p2.id, 'กดบันทึกซ้ำ'])
  await asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [p1.id, 'บันทึกผิดใบ'])
  assert.equal((await rows('SELECT next_fee_due_on::text AS d FROM public.licences WHERE id = $1', [cert.id]))[0].d, due0)
  await rejects(asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [p2.id, 'ซ้ำ']), { message: /ยกเลิกไปแล้ว/ })
  await fee('staffDG', cert.id, 'annual', today, 'V-1')
  // ใบอนุญาต: ยกเลิกรายการต่ออายุแล้ววันหมดอายุกลับค่าเดิม
  const l2 = await newLicence('staffDG', MA, hazard.id, { expires: await day(20) })
  await fee('staffDG', l2.id, 'renewal', today, 'V-3')
  const p3 = (await rows("SELECT id FROM public.licence_fee_payments WHERE receipt_no = 'V-3'"))[0]
  await asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [p3.id, 'ผิดใบ'])
  assert.equal((await rows('SELECT expires_on::text AS e FROM public.licences WHERE id = $1', [l2.id]))[0].e, await day(20))
})

await test('ข้าม อปท.: บี อ่าน/แก้/ลบ/เรียก RPC กับใบของ เอ ไม่ได้ · admin บี แก้ค่าตั้งของ เอ ไม่ได้', async () => {
  for (const who of ['staffB', 'adminB']) {
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.licences WHERE municipality_id = $1', [MA]))[0].n, 0)
    await actor(who)
    assert.equal(await affected("UPDATE public.licences SET note = 'x' WHERE id = $1", [lic.id]), 0)
    assert.equal(await affected('DELETE FROM public.licences WHERE municipality_id = $1', [MA]), 0)
    assert.equal(await affected('UPDATE public.licence_settings SET remind_days = ARRAY[1] WHERE municipality_id = $1', [MA]), 0)
    await asRoot()
    await rejects(fee(who, lic.id, 'renewal', today, 'X-B'), DENIED)
    await rejects(asUser(who, 'SELECT public.licence_set_status($1,$2,$3,$4,$5,$6)', [lic.id, 'closed', 'ลองข้าม', null, null, null]), DENIED)
    const p = (await rows("SELECT id FROM public.licence_fee_payments WHERE receipt_no = 'R-1'"))[0]
    await rejects(asUser(who, 'SELECT public.licence_void_fee($1,$2)', [p.id, 'ลองข้าม']), DENIED)
  }
})

await test('ค่าผิดรูป: สถานะ NULL · วันเตือนมี NULL · แก้รหัสใบ/ประเภท → ปฏิเสธเป็นข้อความไทย', async () => {
  await rejects(asUser('staffDG', 'SELECT public.licence_set_status($1,$2,$3,$4,$5,$6)', [lic.id, null, 'ทดสอบ', null, null, null]), { code: '22023' })
  await rejects(asUser('adminA', "UPDATE public.licence_settings SET remind_days = '{30,NULL}' WHERE municipality_id = $1", [MA]), { code: '23514' })
  await rejects(asUser('staffDG', 'UPDATE public.licences SET id = $2 WHERE id = $1', [lic.id, id(999)]), DENIED)
  await rejects(asUser('staffDG', 'UPDATE public.licence_types SET id = $2 WHERE id = $1', [hazard.id, id(998)]), DENIED)
})

await test('นำเข้าหลายแถวในคำสั่งเดียว (ชุดนำเข้า) · ลบทั้งชุดได้เมื่อยังไม่มีการรับเงิน · มีแล้วลบไม่ได้ทั้งชุด', async () => {
  const batch = id(777)
  await actor('staffDG')
  const n = await affected(`INSERT INTO public.licences (municipality_id, licence_type_id, business_name, holder_name, expires_on, import_batch)
    SELECT $1, $2, 'ร้านนำเข้า ' || g, 'ผู้ถือ ' || g, $3::date + g, $4 FROM generate_series(1, 50) AS g`, [MA, hazard.id, today, batch])
  await asRoot()
  assert.equal(n, 50)
  const one = (await rows('SELECT id FROM public.licences WHERE import_batch = $1 LIMIT 1', [batch]))[0]
  await fee('staffDG', one.id, 'renewal', today, 'IMP-1')
  await rejects(asUser('staffDG', 'DELETE FROM public.licences WHERE import_batch = $1', [batch]))
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.licences WHERE import_batch = $1', [batch]))[0].n, 50, 'ทั้งชุดต้องอยู่ครบ')
  const p = (await rows("SELECT id FROM public.licence_fee_payments WHERE receipt_no = 'IMP-1'"))[0]
  await asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [p.id, 'นำเข้าผิดชุด'])
  // รายการที่ยกเลิกแล้วยังอยู่ (หลักฐาน) ⇒ ใบนั้นยังลบไม่ได้ ต้องเปลี่ยนสถานะเป็นเลิกกิจการแทน
  await rejects(asUser('staffDG', 'DELETE FROM public.licences WHERE import_batch = $1', [batch]))
  await actor('staffDG')
  assert.equal(await affected('DELETE FROM public.licences WHERE import_batch = $1 AND id <> $2', [batch, one.id]), 49)
  await asRoot()
})

await test('PDPA: ประวัติไม่เก็บค่าเบอร์โทร/ที่อยู่ (บอกแค่ว่าเปลี่ยน) ทั้งตอนเพิ่ม แก้ และลบ', async () => {
  const l = (await asUser('staffDG', `INSERT INTO public.licences (municipality_id, licence_type_id, business_name, holder_name, holder_phone, address, expires_on)
    VALUES ($1,$2,'ร้านเบอร์','คนมีเบอร์','089-111-2222','บ้านเลขที่ 9',$3) RETURNING id`, [MA, hazard.id, await day(40)]))[0]
  await asUser('staffDG', "UPDATE public.licences SET holder_phone = '089-333-4444', address = 'บ้านเลขที่ 10' WHERE id = $1", [l.id])
  await asUser('staffDG', 'DELETE FROM public.licences WHERE id = $1', [l.id])
  const dump = JSON.stringify(await rows('SELECT changes FROM public.licence_events WHERE entity_id = $1', [l.id]))
  for (const secret of ['089-111-2222', '089-333-4444', 'บ้านเลขที่ 9', 'บ้านเลขที่ 10']) assert.ok(!dump.includes(secret), `ค้าง: ${secret}`)
  assert.match(dump, /"holder_phone":"changed"/)
})

await test('ลบ อปท. ที่มีใบ + รายการรับเงิน: ลบได้ทั้งหมด ไม่ชน FK และไม่ลงประวัติค้าง', async () => {
  const MZ = id(3)
  await db.query(`INSERT INTO public.municipalities VALUES ($1, 'อปท. ซี')`, [MZ])
  await db.query(`INSERT INTO public.departments (id, municipality_id, name, code) VALUES ($1, $2, 'สำนักปลัด', 'general')`, [id(15), MZ])
  const t = (await rows(`INSERT INTO public.licence_types (municipality_id, category, name) VALUES ($1,'market','ตลาด ซี') RETURNING id`, [MZ]))[0]
  const l = (await rows(`INSERT INTO public.licences (municipality_id, licence_type_id, business_name, holder_name, expires_on)
    VALUES ($1,$2,'ตลาด','เจ้าของ',$3) RETURNING id`, [MZ, t.id, await day(10)]))[0]
  await db.query(`INSERT INTO public.licence_fee_payments (municipality_id, licence_id, kind, paid_on, amount, receipt_no, period_from, period_to, no_material_change)
    VALUES ($1,$2,'renewal',$3,1,'Z-1',$3,$3,true)`, [MZ, l.id, today])
  await db.query('DELETE FROM public.departments WHERE municipality_id = $1', [MZ])
  await db.query('DELETE FROM public.municipalities WHERE id = $1', [MZ])
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.licence_events WHERE municipality_id = $1', [MZ]))[0].n, 0)
})

await test('เปลี่ยนสถานะ: พักใช้ ≤ 15 วัน + เลขคำสั่ง · เพิกถอนต้องมีเลขคำสั่ง · ใบเพิกถอนรับเงินไม่ได้', async () => {
  const s = await newLicence('staffDG', MA, hazard.id, { expires: await day(100) })
  const set = (who, ...a) => asUser(who, 'SELECT public.licence_set_status($1,$2,$3,$4,$5,$6)', [s.id, ...a])
  await rejects(set('staffDG', 'suspended', 'ไม่ปฏิบัติตามเงื่อนไข', 'คำสั่ง 1/2569', today, await day(15)), { message: /15 วัน/ })
  await rejects(set('staffDG', 'suspended', 'ไม่ปฏิบัติตามเงื่อนไข', null, today, await day(14)), { message: /เลขที่คำสั่ง/ })
  await rejects(set('officerD1', 'suspended', 'ไม่ปฏิบัติตามเงื่อนไข', 'คำสั่ง 1/2569', today, await day(14)), DENIED)
  await set('staffDG', 'suspended', 'ไม่ปฏิบัติตามเงื่อนไข', 'คำสั่ง 1/2569', today, await day(14))
  assert.equal((await rows('SELECT status FROM public.licences WHERE id = $1', [s.id]))[0].status, 'suspended')
  await set('staffDG', 'active', 'ครบกำหนดพักใช้ ปรับปรุงแล้ว', null, null, null)
  await rejects(set('staffDG', 'revoked', 'ฝ่าฝืนซ้ำ', null, null, null), { message: /เลขที่คำสั่ง/ })
  await set('staffDG', 'revoked', 'ฝ่าฝืนซ้ำ', 'คำสั่ง 2/2569', null, null)
  await rejects(fee('staffDG', s.id, 'renewal', today, 'R-rev'), { message: /เพิกถอน/ })
  await rejects(set('staffDG', 'active', 'บันทึกผิด', null, null, null), { message: /เลขที่คำสั่ง/ })
  await set('staffDG', 'active', 'บันทึกผิดใบ', 'บันทึกข้อความ 3/2569', null, null)
  await rejects(set('staffDG', 'closed', '', null, null, null), { message: /เหตุผล/ })
})

await test('ประวัติ: ทุกการกระทำลงบันทึก พร้อมชนิด renew/fee/void/status · เขียน/แก้เองไม่ได้', async () => {
  const actions = (await rows('SELECT DISTINCT action FROM public.licence_events')).map(r => r.action).sort()
  for (const a of ['fee', 'insert', 'renew', 'status', 'update', 'void']) assert.ok(actions.includes(a), `ไม่มี action ${a}`)
  const renew = (await rows("SELECT reason, actor FROM public.licence_events WHERE action = 'renew' LIMIT 1"))[0]
  assert.match(renew.reason, /ใบเสร็จ/)
  assert.equal(renew.actor, U.staffDG)
  await rejects(asUser('staffDG', `INSERT INTO public.licence_events (municipality_id, entity, entity_id, action) VALUES ($1,'licence',$2,'insert')`,
    [MA, lic.id]), DENIED)
  await rejects(asUser('staffDG', 'DELETE FROM public.licence_events'), DENIED)
  await rejects(asUser('staffDG', `INSERT INTO public.licence_fee_payments (municipality_id, licence_id, kind, paid_on, amount, receipt_no, period_from, period_to, no_material_change)
    VALUES ($1,$2,'renewal',$3,1,'X',$3,$3,true)`, [MA, lic.id, today]), DENIED)
  assert.equal((await asUser('officerD1', 'SELECT count(*)::int AS n FROM public.licence_events'))[0].n, 0)
})

await test('ลบ: ใบที่มีรายการรับเงินลบไม่ได้ · ใบเปล่าลบได้ · ประเภทที่มีใบลบไม่ได้ · เปลี่ยนชนิดเอกสารไม่ได้ · TRUNCATE ไม่ได้', async () => {
  await rejects(asUser('staffDG', 'DELETE FROM public.licences WHERE id = $1', [lic.id]), { code: '23001' })
  const empty = await newLicence('staffDG', MA, hazard.id, { expires: await day(5) })
  assert.equal(await (async () => { await actor('staffDG'); try { return await affected('DELETE FROM public.licences WHERE id = $1', [empty.id]) } finally { await asRoot() } })(), 1)
  await rejects(asUser('staffDG', 'DELETE FROM public.licence_types WHERE id = $1', [hazard.id]), { code: '23001' })
  await rejects(asUser('staffDG', "UPDATE public.licence_types SET category = 'food_notice' WHERE id = $1", [hazard.id]), { code: '23514' })
  await rejects(asUser('staffDG', 'TRUNCATE public.licences'), DENIED)
  await rejects(asUser('anon', 'SELECT public.licence_record_fee($1,$2,$3,$4,$5,$6,$7)', [lic.id, 'renewal', today, 1, 'Z', 0, true]), DENIED)
})

console.log(`\nผ่าน ${cases} กรณี`)
