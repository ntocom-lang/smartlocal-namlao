// รับชำระเงิน · ยอดค้าง (ขั้น 1C / E4 PR1) — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/payment-dues-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: ทะเบียนใบอนุญาต 20261208100000 → 100100 แล้ว 20261211100000 (ตาราง) → 20261211100100 (สิทธิ์/RPC/trigger)
//
// ตรวจ: (1) ด่านหัวไฟล์ + รันซ้ำได้ + ด่าน md5 ของ licence_record_fee (2) ค่าตั้ง: แอดมินเท่านั้น ตรวจค่า ประทับเปลี่ยนบัญชี
// (3) เมทริกซ์สิทธิ์อ่าน (4) สร้างยอดตามกฎ + Ref1 Luhn + ไม่สร้างซ้ำ (5) บันทึกเลขใบเสร็จ → ต่ออายุ + ปิดยอด
// (6) บันทึกจากหน้าทะเบียนเดิมก็ปิดยอด (7) ยกเลิกรายการรับเงิน → เปิดยอดกลับ (8) กองคลัง (ตัวเลือก)
// (9) lapsed ตามกฎ + อัตราเปลี่ยน (10) ยกเลิกยอด (คน) ไม่เด้งกลับ (11) ยอดไม่ตรงรอบ → ย้อนทั้งหมด (12) anon/เขียนตรง/demo
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const licTablesSql = await readMigration('20261208100000_licence_registry_tables.sql')
const licRlsSql = await readMigration('20261208100100_licence_registry_rls_rpc.sql')
const payTablesSql = await readMigration('20261211100000_payment_dues_tables.sql')
const payRlsSql = await readMigration('20261211100100_payment_dues_rls_rpc.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const MDEMO = id(3)
const DG = id(11) // สำนักปลัด เอ (กองที่ถือเรื่องใบอนุญาต — เดาเอง)
const D1 = id(12) // กองช่าง เอ
const DF = id(13) // กองคลัง เอ
const DB1 = id(14) // สำนักปลัด บี
const U = {
  superadmin: id(101), adminA: id(102), adminB: id(103), staffDG: id(104), officerD1: id(105), financeA: id(106),
  viewerA: id(107), citizenA: id(108), staffB: id(109), techDG: id(110),
}
const ROLE = { superadmin: 'superadmin', adminA: 'admin', adminB: 'admin', staffDG: 'staff', officerD1: 'officer', financeA: 'officer',
  viewerA: 'viewer', citizenA: 'citizen', staffB: 'staff', techDG: 'technician' }
const MUNI = { superadmin: null, adminB: MB, staffB: MB }
const DEPT = { staffDG: DG, officerD1: D1, financeA: DF, staffB: DB1, techDG: DG }

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

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ', 'a', ARRAY['complaints']), ('${MB}', 'อปท. บี', 'b', NULL),
  ('${MDEMO}', 'สาธิต', 'demo', ARRAY['complaints']);
INSERT INTO public.departments (id, municipality_id, name, code, sort_order) VALUES
  ('${DG}', '${MA}', 'สำนักปลัด', 'general', 1), ('${D1}', '${MA}', 'กองช่าง', 'civil', 2),
  ('${DF}', '${MA}', 'กองคลัง', 'finance', 3), ('${DB1}', '${MB}', 'สำนักปลัด', 'general', 1);
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

await db.exec(licTablesSql)
await db.exec(licRlsSql)

await test('ด่านหัวไฟล์: รันไฟล์ 2 ก่อนไฟล์ 1 → พังพร้อมชื่อไฟล์ที่ต้องรันก่อน', async () => {
  await rejects(db.exec(payRlsSql), { message: /20261211100000/ })
  await db.exec('ROLLBACK').catch(() => {})
})

await db.exec(payTablesSql)

await test('ด่าน md5: licence_record_fee บนฐานถูกแก้ไปแล้ว → หยุดทั้งไฟล์ ไม่เขียนทับ', async () => {
  await db.exec(`CREATE OR REPLACE FUNCTION public.licence_record_fee(
    p_licence_id uuid, p_kind text, p_paid_on date, p_amount numeric, p_receipt_no text,
    p_surcharge numeric DEFAULT 0, p_no_material_change boolean DEFAULT false)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN '{}'::jsonb; END; $$`)
  await rejects(db.exec(payRlsSql), { message: /Function drift: licence_record_fee/ })
  await db.exec('ROLLBACK').catch(() => {})
  await db.exec(licRlsSql) // คืนรุ่นเดิม
})

await db.exec(payRlsSql)
await db.exec(payTablesSql) // รันซ้ำทั้งชุดต้องไม่พัง (ด่าน md5 รับรุ่นที่แก้แล้ว)
await db.exec(payRlsSql)

const today = (await rows('SELECT public.licence_today()::text AS d'))[0].d
const day = async n => (await rows('SELECT ($1::date + $2::int)::text AS d', [today, n]))[0].d
const addMonths = async (d, m) => (await rows("SELECT (($1::date + make_interval(months => $2))::date - 1)::text AS d", [d, m]))[0].d
const luhnOk = ref => {
  let sum = 0
  for (let i = 0; i < ref.length; i++) {
    let d = Number(ref[ref.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

const saveSettings = (alias, muni, s = {}) => asUser(alias,
  'SELECT * FROM public.payment_save_settings($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
  [muni, s.counter ?? true, s.promptpay ?? false, s.bill ?? false, s.promptpayId ?? null, s.billerId ?? null,
   s.bank ?? null, s.payee ?? null, JSON.stringify(s.channels ?? { licence: ['counter'] }), s.elaas ?? [], s.lead ?? 60,
   s.financeDept ?? null, s.financeCan ?? false])
const sync = (alias, muni = MA) => asUser(alias, 'SELECT public.payment_sync_licence_dues($1) AS r', [muni]).then(r => r[0].r)
const listRaw = (alias, status = 'open', muni = MA) =>
  asUser(alias, 'SELECT public.payment_list_dues($1,$2) AS r', [muni, status]).then(r => r[0].r)
const list = (alias, status, muni) => listRaw(alias, status, muni).then(r => r.rows)
const receipt = (alias, dueId, receiptNo, extra = {}) => asUser(alias,
  'SELECT public.payment_record_receipt($1,$2,$3,$4,$5,$6,$7) AS r',
  [dueId, extra.paidOn ?? today, extra.amount ?? 500, receiptNo, extra.channel ?? 'counter', extra.surcharge ?? 0, extra.cert ?? true])
const dueOf = async licenceId => (await rows("SELECT * FROM public.payment_dues WHERE licence_id = $1 ORDER BY created_at DESC, id", [licenceId]))
const events = async entityId => (await rows('SELECT action, reason, changes FROM public.payment_events WHERE entity_id = $1 ORDER BY id', [entityId]))

// ── ข้อมูลทะเบียน ──
const hazard = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name, default_fee)
  VALUES ($1,'health_hazard','กิจการที่เป็นอันตรายต่อสุขภาพ', 500) RETURNING *`, [MA]))[0]
const foodNotice = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name)
  VALUES ($1,'food_notice','หนังสือรับรองการแจ้ง') RETURNING *`, [MA]))[0]
const market = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name)
  VALUES ($1,'market','ตลาด') RETURNING *`, [MA]))[0]
const newLicence = async (typeId, cols = {}) => (await asUser('staffDG',
  `INSERT INTO public.licences (municipality_id, licence_type_id, business_name, holder_name, address, licence_no, expires_on, next_fee_due_on, fee_amount)
   VALUES ($1,$2,$3,'ผู้ประกอบการ','99 หมู่ 1',$4,$5,$6,$7) RETURNING *`,
  [MA, typeId, cols.business ?? 'ร้านทดสอบ', cols.no ?? null, cols.expires ?? null, cols.due ?? null,
   cols.fee === undefined ? 500 : cols.fee]))[0]

const L30 = await newLicence(hazard.id, { business: 'ร้านใกล้หมด', no: 'H-1', expires: await day(30) })
const L90 = await newLicence(hazard.id, { business: 'ร้านยังไกล', no: 'H-2', expires: await day(90) })
const LNOFEE = await newLicence(market.id, { business: 'ตลาดไม่มีอัตรา', no: 'M-1', expires: await day(20), fee: null })
const N10 = await newLicence(foodNotice.id, { business: 'ร้านอาหารเล็ก', no: 'N-1', due: await day(10), fee: 300 })

// ── ค่าตั้ง ──
await test('ค่าตั้ง: แอดมิน อปท. เท่านั้น · ตรวจค่า · เขียนตรงไม่ได้', async () => {
  for (const who of ['staffDG', 'officerD1', 'financeA', 'viewerA', 'citizenA', 'adminB', 'staffB']) {
    await rejects(saveSettings(who, MA), DENIED)
  }
  await rejects(saveSettings('anon', MA), DENIED)
  await rejects(saveSettings('adminA', MA, { promptpay: true }), { message: /เลขพร้อมเพย์/ })
  await rejects(saveSettings('adminA', MA, { promptpayId: '12345' }), { message: /13 หลัก/ })
  // ผลตรวจ M4: เบอร์มือถือ/เลขบัตรประชาชน = พร้อมเพย์ของบุคคล ห้ามเป็นบัญชีรับเงินของ อปท.
  await rejects(saveSettings('adminA', MA, { promptpayId: '0812345678' }), { message: /เบอร์มือถือหรือเลขบัตรประชาชน/ })
  await rejects(saveSettings('adminA', MA, { promptpayId: '1100700123456' }), { message: /เบอร์มือถือหรือเลขบัตรประชาชน/ })
  await rejects(saveSettings('adminA', MA, { bill: true }), { message: /Biller ID/ })
  await rejects(saveSettings('adminA', MA, { billerId: '0994000123456' }), { message: /15 หลัก/ })
  await rejects(saveSettings('adminA', MA, { channels: { tax: ['counter'] } }), { message: /ไม่รู้จักบริการ/ })
  await rejects(saveSettings('adminA', MA, { channels: { licence: ['slip'] } }), { message: /ช่องทางของบริการ/ })
  await rejects(saveSettings('adminA', MA, { financeCan: true }), { message: /เลือกกองคลัง/ })
  await rejects(saveSettings('adminA', MA, { financeDept: DB1, financeCan: true }), { code: '23514' })
  await rejects(saveSettings('adminA', MA, { lead: 0 }), { message: /1–180/ })
  const s = (await saveSettings('adminA', MA, {
    promptpay: true, promptpayId: '0994000-123456', bank: 'กรุงไทย', payee: 'เทศบาลตำบลเอ',
    channels: { licence: ['promptpay', 'counter', 'counter'] },
  }))[0]
  assert.equal(s.promptpay_id, '0994000123456')
  assert.deepEqual(s.source_channels, { licence: ['counter', 'promptpay'] })
  assert.ok(s.account_changed_at, 'ตั้งบัญชีครั้งแรก = ประทับเวลา')
  await rejects(asUser('adminA', 'UPDATE public.payment_settings SET promptpay_id = $2 WHERE municipality_id = $1', [MA, '0994000999999']), DENIED)
  await rejects(asUser('adminA', 'INSERT INTO public.payment_settings (municipality_id) VALUES ($1)', [MB]), DENIED)
})

await test('ค่าตั้ง: เปลี่ยนบัญชีปลายทาง = ลงประวัติ account_change ค่าเดิม→ใหม่ · แก้อย่างอื่นไม่ประทับใหม่', async () => {
  const before = (await rows('SELECT account_changed_at FROM public.payment_settings WHERE municipality_id = $1', [MA]))[0].account_changed_at
  await saveSettings('adminA', MA, { promptpay: true, promptpayId: '0994000123456', bank: 'กรุงไทย', payee: 'เทศบาลตำบลเอ',
    channels: { licence: ['counter', 'promptpay'] }, lead: 45 })
  const mid = (await rows('SELECT account_changed_at, due_lead_days FROM public.payment_settings WHERE municipality_id = $1', [MA]))[0]
  assert.equal(mid.account_changed_at.getTime(), before.getTime())
  assert.equal(mid.due_lead_days, 45)
  await saveSettings('adminA', MA, { promptpay: true, promptpayId: '0994000999999', bank: 'กรุงไทย', payee: 'เทศบาลตำบลเอ',
    channels: { licence: ['counter', 'promptpay'] }, lead: 60 })
  const ev = await rows("SELECT action, changes FROM public.payment_events WHERE entity = 'settings' AND municipality_id = $1 ORDER BY id", [MA])
  assert.deepEqual(ev.map(e => e.action), ['account_change', 'update', 'account_change']) // ตั้งบัญชีครั้งแรกนับเป็นการเปลี่ยนบัญชีด้วย
  assert.deepEqual(ev[2].changes.promptpay_id, ['0994000123456', '0994000999999'])
  const after = (await rows('SELECT account_changed_at, account_changed_by FROM public.payment_settings WHERE municipality_id = $1', [MA]))[0]
  assert.ok(after.account_changed_at.getTime() > before.getTime())
  assert.equal(after.account_changed_by, U.adminA)
})

// ── ยอดค้าง ──
await test('ปรับยอด: โมดูลยังไม่เปิด → ปฏิเสธ · คนไม่มีสิทธิ์ → ปฏิเสธ', async () => {
  await rejects(sync('staffDG'), { message: /ยังไม่เปิด/ })
  await db.query("UPDATE public.municipalities SET enabled_modules = array_append(enabled_modules, 'payment-dues') WHERE id = $1", [MA])
  for (const who of ['officerD1', 'financeA', 'viewerA', 'citizenA', 'techDG', 'adminB', 'staffB']) await rejects(sync(who), DENIED)
  await rejects(sync('anon'), DENIED)
})

let due30
await test('ปรับยอด: สร้างเฉพาะใบที่เข้าช่วง 60 วัน · ไม่มีอัตรา = ข้าม (นับให้) · Ref1 12 หลัก Luhn · รันซ้ำไม่สร้างซ้ำ', async () => {
  const r = await sync('staffDG')
  assert.equal(r.created, 2, JSON.stringify(r))
  assert.equal(r.skipped_no_fee, 1)
  ;[due30] = await dueOf(L30.id)
  assert.equal(due30.kind, 'renewal')
  assert.equal(String(due30.amount), '500.00')
  assert.equal(due30.due_on.toISOString().slice(0, 10), await day(30))
  assert.match(due30.ref1, /^[0-9]{12}$/)
  assert.ok(luhnOk(due30.ref1), 'Ref1 ต้องผ่าน Luhn')
  assert.equal((await rows('SELECT public.payment_luhn_digit(substr($1, 1, 11)) AS d', [due30.ref1]))[0].d, due30.ref1.slice(-1))
  assert.equal((await dueOf(L90.id)).length, 0)
  const [dueN] = await dueOf(N10.id)
  assert.equal(dueN.kind, 'annual')
  assert.equal(String(dueN.amount), '300.00')
  assert.equal((await events(due30.id))[0].action, 'insert')
  const again = await sync('staffDG')
  assert.equal(again.created, 0)
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.payment_dues')).at(0).n, 2)
})

await test('อ่าน: ผู้จัดการ/แอดมินเห็น · กอง/บทบาทอื่น/ต่าง อปท. ไม่เห็น · anon ปฏิเสธ', async () => {
  for (const who of ['adminA', 'staffDG', 'superadmin']) {
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.payment_dues')).at(0).n, 2, who)
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.payment_settings WHERE municipality_id = $1', [MA])).at(0).n, 1, who)
  }
  for (const who of ['officerD1', 'financeA', 'viewerA', 'citizenA', 'techDG', 'adminB', 'staffB']) {
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.payment_dues')).at(0).n, 0, who)
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.payment_settings')).at(0).n, 0, who)
    assert.equal((await asUser(who, 'SELECT count(*)::int AS n FROM public.payment_events')).at(0).n, 0, who)
    await rejects(list(who), DENIED)
  }
  await rejects(asUser('anon', 'SELECT * FROM public.payment_dues'), DENIED)
  const raw = await listRaw('staffDG')
  assert.equal(raw.total, 2)
  assert.equal(raw.truncated, false)
  const l = raw.rows
  assert.equal(l.length, 2)
  assert.equal(l[0].business_name, 'ร้านอาหารเล็ก') // เรียงตามวันครบกำหนด
  assert.equal(l[0].address, '99 หมู่ 1')
})

await test('บันทึกเลขใบเสร็จของยอด → ใบต่ออายุ + ยอดปิด (ช่องทางพร้อมเพย์) + ลงประวัติ · ซ้ำไม่ได้', async () => {
  await rejects(receipt('staffDG', due30.id, 'R-001', { channel: 'slip' }), { message: /ช่องทาง/ })
  await rejects(receipt('officerD1', due30.id, 'R-001'), DENIED)
  // ผลตรวจ M3: รับไม่ครบแล้วปิดยอด = ลดยอดเองโดยไม่มีเหตุผล
  await rejects(receipt('staffDG', due30.id, 'R-001', { amount: 1 }), { message: /ไม่เท่ายอดค้าง/ })
  const r = (await receipt('staffDG', due30.id, 'R-001', { channel: 'promptpay' }))[0].r
  assert.equal(r.due_id, due30.id)
  const lic = (await rows('SELECT expires_on::text AS e FROM public.licences WHERE id = $1', [L30.id]))[0]
  assert.equal(lic.e, await addMonths(await day(31), 12))
  const [d] = await dueOf(L30.id)
  assert.equal(d.status, 'paid')
  assert.equal(d.paid_channel, 'promptpay')
  assert.equal(d.closed_by, U.staffDG)
  assert.equal(d.payment_id, r.payment_id)
  assert.deepEqual((await events(due30.id)).map(e => e.action), ['insert', 'paid'])
  await rejects(receipt('staffDG', due30.id, 'R-002'), { message: /ไม่ได้อยู่ในสถานะรอชำระ/ })
  // รอบถัดไปยังไม่เข้าช่วง 60 วัน (ใบเพิ่งต่อไปอีกปี) — ปรับยอดไม่สร้างใหม่
  assert.equal((await sync('staffDG')).created, 0)
})

await test('บันทึกรับเงินจากหน้าทะเบียนเดิม (licence_record_fee ตรง) → ยอดปิดเอง ช่องทางว่าง', async () => {
  const [dueN] = await dueOf(N10.id)
  await asUser('staffDG', 'SELECT public.licence_record_fee($1,$2,$3,$4,$5,$6,$7)', [N10.id, 'annual', today, 300, 'R-100', 0, false])
  const [d] = await dueOf(N10.id)
  assert.equal(d.id, dueN.id)
  assert.equal(d.status, 'paid')
  assert.equal(d.paid_channel, null)
})

await test('ยกเลิกรายการรับเงิน (licence_void_fee) → ยอดกลับเป็นรอชำระ + ลงประวัติ reopen', async () => {
  const pay = (await rows("SELECT id FROM public.licence_fee_payments WHERE receipt_no = 'R-001'"))[0]
  await asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [pay.id, 'กรอกเลขใบเสร็จผิด'])
  const [d] = await dueOf(L30.id)
  assert.equal(d.status, 'open')
  assert.equal(d.payment_id, null)
  assert.equal(d.closed_at, null)
  const ev = await events(d.id)
  assert.equal(ev.at(-1).action, 'reopen')
  assert.equal(ev.at(-1).reason, 'กรอกเลขใบเสร็จผิด')
  // วันหมดอายุย้อนกลับ ⇒ ยอดเดิมใช้ต่อได้ บันทึกใหม่ด้วยเลขที่ถูก
  await receipt('staffDG', d.id, 'R-001A', { channel: 'counter' })
  assert.equal((await dueOf(L30.id))[0].status, 'paid')
})

await test('กองคลัง: ปิดอยู่ = ทำอะไรไม่ได้ · เปิดแล้ว = เห็นยอด (ไม่เห็นที่อยู่) + บันทึกใบเสร็จได้ · เรียก licence_record_fee ตรง/ยกเลิกยอดไม่ได้', async () => {
  const L25 = await newLicence(hazard.id, { business: 'ร้านกองคลัง', no: 'H-3', expires: await day(25) })
  await sync('staffDG')
  const [d] = await dueOf(L25.id)
  await rejects(list('financeA'), DENIED)
  await rejects(receipt('financeA', d.id, 'R-200'), DENIED)
  await saveSettings('adminA', MA, { promptpay: true, promptpayId: '0994000999999', bank: 'กรุงไทย', payee: 'เทศบาลตำบลเอ',
    channels: { licence: ['counter', 'promptpay'] }, financeDept: DF, financeCan: true })
  const l = await list('financeA')
  assert.ok(l.some(x => x.id === d.id))
  assert.ok(l.every(x => x.address === null && x.village === null), 'กองคลังไม่เห็นที่อยู่')
  assert.equal((await asUser('financeA', 'SELECT count(*)::int AS n FROM public.payment_dues')).at(0).n >= 1, true)
  await rejects(asUser('financeA', 'SELECT public.licence_record_fee($1,$2,$3,$4,$5,$6,$7)', [L25.id, 'renewal', today, 500, 'R-201', 0, true]), DENIED)
  // อ่านทะเบียนตรง = ได้ 0 แถว (RLS ของทะเบียนให้เฉพาะผู้จัดการ) — ชื่อร้านมาทาง payment_list_dues เท่านั้น
  assert.equal((await asUser('financeA', 'SELECT count(*)::int AS n FROM public.licences')).at(0).n, 0)
  await rejects(asUser('financeA', 'SELECT public.payment_cancel_due($1,$2)', [d.id, 'ทดสอบยกเลิก']), DENIED)
  await receipt('financeA', d.id, 'R-200', { channel: 'bill_payment' })
  const [after] = await dueOf(L25.id)
  assert.equal(after.status, 'paid')
  assert.equal(after.closed_by, U.financeA)
  // ปิดตัวเลือกกลับ = สิทธิ์หายทันที
  await saveSettings('adminA', MA, { promptpay: true, promptpayId: '0994000999999', bank: 'กรุงไทย', payee: 'เทศบาลตำบลเอ',
    channels: { licence: ['counter', 'promptpay'] }, financeDept: DF, financeCan: false })
  await rejects(list('financeA'), DENIED)
})

await test('lapsed ตามกฎ: วันของใบเปลี่ยน → ยอดเก่า lapsed + ยอดใหม่ · ใบเพิกถอน → lapsed · พ้นวันหมดอายุ → lapsed · อัตราเปลี่ยน → ยอดตาม', async () => {
  const LX = await newLicence(hazard.id, { business: 'ร้านเปลี่ยนวัน', no: 'H-4', expires: await day(15) })
  const LR = await newLicence(hazard.id, { business: 'ร้านถูกเพิกถอน', no: 'H-5', expires: await day(12) })
  const LF = await newLicence(hazard.id, { business: 'ร้านเปลี่ยนอัตรา', no: 'H-6', expires: await day(18) })
  await sync('staffDG')
  const [oldX] = await dueOf(LX.id)
  await asUser('staffDG', 'UPDATE public.licences SET expires_on = $2 WHERE id = $1', [LX.id, await day(20)])
  await asUser('staffDG', "SELECT public.licence_set_status($1,'revoked','ฝ่าฝืนคำสั่ง','คำสั่งที่ 1/2569')", [LR.id])
  await asUser('staffDG', 'UPDATE public.licences SET fee_amount = 750 WHERE id = $1', [LF.id])
  // ใบที่หมดอายุไปแล้วเมื่อวาน โดยยอดของรอบนั้นยังค้าง (สร้างตรงด้วยสิทธิ์ระบบ — จำลองว่าไม่มีใครเปิดเมนูช่วงนั้น)
  const LE = await newLicence(hazard.id, { business: 'ร้านหมดอายุ', no: 'H-7', expires: await day(5) })
  await db.query('UPDATE public.licences SET expires_on = $2 WHERE id = $1', [LE.id, await day(-1)])
  await db.query(`INSERT INTO public.payment_dues (municipality_id, source, kind, licence_id, period_from, due_on, amount, ref1)
    VALUES ($1,'licence','renewal',$2,$3,$4,500,'000000000000')`, [MA, LE.id, today, await day(-1)])
  const r = await sync('staffDG')
  assert.equal(r.lapsed, 3, JSON.stringify(r))
  assert.equal(r.updated, 1)
  const [newX, oldX2] = await dueOf(LX.id)
  assert.equal(oldX2.id, oldX.id)
  assert.equal(oldX2.status, 'lapsed')
  assert.match(oldX2.close_reason, /วันหมดอายุของใบเปลี่ยน/)
  assert.equal(newX.status, 'open')
  assert.equal(newX.due_on.toISOString().slice(0, 10), await day(20))
  assert.match((await dueOf(LR.id))[0].close_reason, /เพิกถอน/)
  assert.match((await dueOf(LE.id))[0].close_reason, /พ.ร.ฎ. 2564/)
  const [f] = await dueOf(LF.id)
  assert.equal(String(f.amount), '750.00')
  assert.deepEqual((await events(f.id)).at(-1).changes.amount.map(Number), [500, 750])
})

await test('ยกเลิกยอด: ผู้จัดการ + เหตุผลเท่านั้น · ปรับยอดอีกรอบไม่สร้างกลับ', async () => {
  const LC = await newLicence(hazard.id, { business: 'ร้านจะไม่ต่อ', no: 'H-8', expires: await day(40) })
  await sync('staffDG')
  const [d] = await dueOf(LC.id)
  await rejects(asUser('staffDG', 'SELECT public.payment_cancel_due($1,$2)', [d.id, 'ab']), { message: /เหตุผล/ })
  await rejects(asUser('officerD1', 'SELECT public.payment_cancel_due($1,$2)', [d.id, 'ไม่ต่ออายุ']), DENIED)
  await asUser('staffDG', 'SELECT public.payment_cancel_due($1,$2)', [d.id, 'ผู้ประกอบการแจ้งเลิกกิจการ'])
  const [c] = await dueOf(LC.id)
  assert.equal(c.status, 'cancelled')
  assert.equal(c.closed_by, U.staffDG)
  assert.equal((await sync('staffDG')).created, 0)
  assert.equal((await dueOf(LC.id)).length, 1)
  await rejects(asUser('staffDG', 'SELECT public.payment_cancel_due($1,$2)', [d.id, 'ซ้ำ']), { message: /เฉพาะยอดที่รอชำระ/ })
})

await test('ยอดไม่ตรงรอบของใบ (แก้วันหลังสร้างยอด แต่ยังไม่ได้ปรับยอด) → บันทึกใบเสร็จถูกย้อนทั้งหมด ไม่มีเงินค้างผิดรอบ', async () => {
  const LS = await newLicence(hazard.id, { business: 'ร้านยอดเก่า', no: 'H-9', expires: await day(35) })
  await sync('staffDG')
  const [d] = await dueOf(LS.id)
  await asUser('staffDG', 'UPDATE public.licences SET expires_on = $2 WHERE id = $1', [LS.id, await day(36)])
  const before = (await rows('SELECT count(*)::int AS n FROM public.licence_fee_payments')).at(0).n
  await rejects(receipt('staffDG', d.id, 'R-300'), { message: /ไม่ตรงกับรอบปัจจุบัน/ })
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.licence_fee_payments')).at(0).n, before)
  assert.equal((await rows('SELECT expires_on::text AS e FROM public.licences WHERE id = $1', [LS.id]))[0].e, await day(36))
})

await test('ลบใบที่มียอดรอชำระ (เช่น ยกเลิกชุดนำเข้า) → ลบได้ ยอดหายตาม + ลงประวัติ cancel · ใบที่รับเงินแล้วยังลบไม่ได้', async () => {
  const LD = await newLicence(hazard.id, { business: 'ร้านนำเข้าผิด', no: 'H-10', expires: await day(22) })
  await sync('staffDG')
  const [d] = await dueOf(LD.id)
  await asUser('staffDG', 'DELETE FROM public.licences WHERE id = $1', [LD.id])
  assert.equal((await dueOf(LD.id)).length, 0)
  const ev = await events(d.id)
  assert.equal(ev.at(-1).action, 'cancel')
  assert.equal(ev.at(-1).reason, 'ใบถูกลบจากทะเบียน')
  await rejects(asUser('staffDG', 'DELETE FROM public.licences WHERE id = $1', [L30.id]), { code: '23001' }) // RESTRICT = 23001 (ไม่ใช่ 23503)
})

await test('ประเภทเปลี่ยนเป็นต่ออายุโดยยื่นคำขอ → ยอดต่ออายุที่ค้าง lapsed พร้อมเหตุผล (ผลตรวจ L3)', async () => {
  const otherType = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name, default_fee)
    VALUES ($1,'street_vending','จำหน่ายสินค้าในที่สาธารณะ', 200) RETURNING *`, [MA]))[0]
  const LV = await newLicence(otherType.id, { business: 'แผงลอย', no: 'S-1', expires: await day(28), fee: 200 })
  await sync('staffDG')
  assert.equal((await dueOf(LV.id))[0].status, 'open')
  await asUser('staffDG', 'UPDATE public.licence_types SET renewal_by_fee = false WHERE id = $1', [otherType.id])
  await sync('staffDG')
  const [d] = await dueOf(LV.id)
  assert.equal(d.status, 'lapsed')
  assert.match(d.close_reason, /ยื่นคำขอ/)
})

await test('เขียนตาราง/เรียกฟังก์ชันภายในตรงไม่ได้ · anon เรียก RPC ไม่ได้', async () => {
  for (const who of ['adminA', 'staffDG']) {
    await rejects(asUser(who, "UPDATE public.payment_dues SET status = 'cancelled', close_reason = 'x', closed_at = now()"), DENIED)
    await rejects(asUser(who, 'DELETE FROM public.payment_dues'), DENIED)
    await rejects(asUser(who, 'TRUNCATE public.payment_dues'), DENIED)
    await rejects(asUser(who, "INSERT INTO public.payment_events (municipality_id, entity, entity_id, action) VALUES ($1,'due',$1,'paid')", [MA]), DENIED)
    await rejects(asUser(who, "SELECT public.payment_log($1,'due',$1,'paid','{}'::jsonb,NULL)", [MA]), DENIED)
    await rejects(asUser(who, 'SELECT public.payment_new_ref1()'), DENIED)
  }
  await rejects(asUser('anon', "SELECT public.payment_record_receipt($1, CURRENT_DATE, 1, 'x', 'counter')", [due30.id]), DENIED)
  await rejects(asUser('anon', 'SELECT public.payment_list_dues($1)', [MA]), DENIED)
})

await test('ประวัติ: ทุกยอดมีบันทึกการสร้าง ผู้ใช้ไม่มีสิทธิ์เห็นประวัติต่าง อปท.', async () => {
  const missing = await rows(`SELECT d.id FROM public.payment_dues AS d
    WHERE d.ref1 <> '000000000000' AND NOT EXISTS (SELECT 1 FROM public.payment_events e WHERE e.entity_id = d.id AND e.action = 'insert')`)
  assert.equal(missing.length, 0)
  assert.equal((await asUser('adminB', 'SELECT count(*)::int AS n FROM public.payment_events')).at(0).n, 0)
})

await test('demo เปิดโมดูลให้เอง · อปท. อื่นไม่ถูกเปิด', async () => {
  const m = await rows('SELECT slug, enabled_modules FROM public.municipalities ORDER BY slug')
  assert.ok(m.find(x => x.slug === 'demo').enabled_modules.includes('payment-dues'))
  assert.equal(m.find(x => x.slug === 'demo').enabled_modules.filter(k => k === 'payment-dues').length, 1, 'รันซ้ำไม่เติมซ้ำ')
  assert.equal(m.find(x => x.slug === 'b').enabled_modules, null)
})

console.log(`\n${cases} กรณีผ่านทั้งหมด`)
