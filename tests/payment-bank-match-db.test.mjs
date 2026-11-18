// รับชำระเงิน · นำเข้าไฟล์ธนาคาร + จับคู่ยอด + คิวแจ้งเปลี่ยนบัญชี + exec_summary_payment (ขั้น 1C / E4 PR2)
// รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/payment-bank-match-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: ทะเบียนใบอนุญาต 20261208100000 → 100100 · รับชำระ PR1 20261211100000 → 100100 · PR2 20261212100000 → 100100
//   (ไฟล์ 3 cron ใช้ pg_cron/vault — ไม่รันในเทสต์นี้)
//
// ตรวจ: (1) ด่านหัวไฟล์ + รันซ้ำได้ (2) สิทธิ์ทุกฟังก์ชัน (3) Bill Payment จับคู่เองเฉพาะ Ref1+ยอดตรง (4) กันนำเข้าซ้ำ + แถวเหมือนกันสองแถว
// (5) แถวผิดรูปแบบ = ไม่รับทั้งไฟล์ (6) พร้อมเพย์: เสนอคู่ คนยืนยัน (7) ยอดที่มีเงินเข้า: ระบบไม่ lapse/ไม่เปลี่ยนยอด/คนยกเลิกไม่ได้
// (8) เลขใบเสร็จ → receipted · ยกเลิกรายการรับเงิน → matched (9) ยกเลิกคู่/ไม่ใช่เงินของระบบ ต้องมีเหตุผล (10) ลบใบ → คืนเงินเข้า
// (11) คิวแจ้งเปลี่ยนบัญชี: ปิดเลข ผู้รับถูกคน service_role เท่านั้น (12) exec_summary_payment ตัวเลขถูก + ด่านผู้บริหาร
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
const bankTablesSql = await readMigration('20261212100000_payment_bank_match_tables.sql')
const bankRpcSql = await readMigration('20261212100100_payment_bank_match_rpc.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)
const MB = id(2)
const MDEMO = id(3)
const DG = id(11) // สำนักปลัด เอ (กองที่ถือเรื่องใบอนุญาต)
const D1 = id(12) // กองช่าง เอ
const DF = id(13) // กองคลัง เอ
const DB1 = id(14) // สำนักปลัด บี
const POS_TOP = id(21) // ตำแหน่งหมวด top_admin (ปลัด)
const U = {
  superadmin: id(101), adminA: id(102), adminB: id(103), staffDG: id(104), officerD1: id(105), financeA: id(106),
  viewerA: id(107), citizenA: id(108), staffB: id(109), techDG: id(110), clerkA: id(111), financeHeadA: id(112),
}
const ROLE = { superadmin: 'superadmin', adminA: 'admin', adminB: 'admin', staffDG: 'staff', officerD1: 'officer', financeA: 'officer',
  viewerA: 'viewer', citizenA: 'citizen', staffB: 'staff', techDG: 'technician', clerkA: 'officer', financeHeadA: 'officer' }
const MUNI = { superadmin: null, adminB: MB, staffB: MB }
const DEPT = { staffDG: DG, officerD1: D1, financeA: DF, staffB: DB1, techDG: DG, clerkA: DG, financeHeadA: DF }
const NAME = { adminA: 'แอดมิน เอ', staffDG: 'เจ้าหน้าที่ สำนักปลัด' }
const HEAD = { financeHeadA: true, officerD1: true }
const POS = { clerkA: POS_TOP }
// ผูก Telegram ส่วนตัว: ผู้บริหาร 2 + หัวหน้ากองคลัง + คนที่ไม่ควรได้รับ (ประชาชน/หัวหน้ากองช่าง/แอดมิน/บุคลากร อปท. อื่น)
const CHAT = { viewerA: 9001, clerkA: 9002, financeHeadA: 9003, citizenA: 9004, officerD1: 9005, adminA: 9006, staffB: 9007, financeA: 9008 }

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text, slug text, enabled_modules text[], telegram_group_id bigint);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id), name text,
  code text, sort_order integer DEFAULT 0);
CREATE TABLE public.positions (id uuid PRIMARY KEY, category text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id), department_id uuid REFERENCES public.departments(id),
  full_name text, job_title text, is_dept_head boolean DEFAULT false, position_id uuid REFERENCES public.positions(id));
CREATE TABLE public.telegram_user_links (user_id uuid PRIMARY KEY REFERENCES auth.users(id), chat_id bigint NOT NULL UNIQUE,
  dm_muted text[] DEFAULT '{}');
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id() TO anon, authenticated;

-- ห้องผู้บริหาร: ยกนิยามจริงของด่านสิทธิ์ (20261115100000 / 20261118100100) · ตัวรวบเป็นตัวแทน (ต้องมีเพื่อเทียบเจ้าของ)
CREATE FUNCTION public.exec_assert_viewer(_municipality_id uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_uid uuid := auth.uid(); v_role text; v_muni uuid; v_cat text; v_ok boolean;
BEGIN
  SELECT p.role, p.municipality_id, pos.category INTO v_role, v_muni, v_cat
    FROM public.profiles AS p LEFT JOIN public.positions AS pos ON pos.id = p.position_id WHERE p.id = v_uid;
  v_ok := v_uid IS NOT NULL AND _municipality_id IS NOT NULL AND v_role IS NOT NULL
          AND (v_role IN ('viewer', 'admin', 'superadmin')
               OR (v_cat IS NOT DISTINCT FROM 'top_admin' AND v_role IN ('officer', 'staff', 'council', 'technician')))
          AND (v_role = 'superadmin' OR v_muni IS NOT DISTINCT FROM _municipality_id);
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ดูข้อมูลห้องผู้บริหารของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.exec_assert_viewer(uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.executive_overview(_municipality_id uuid, _from date, _to date, _keys text[] DEFAULT NULL)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.exec_digest_eligible(_user_id uuid, _municipality_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE((SELECT (_municipality_id IS NOT NULL AND p.municipality_id IS NOT DISTINCT FROM _municipality_id
      AND (p.role = 'viewer' OR (pos.category IS NOT DISTINCT FROM 'top_admin' AND p.role IN ('officer', 'staff', 'council', 'technician', 'admin')))
    ) IS TRUE FROM public.profiles AS p LEFT JOIN public.positions AS pos ON pos.id = p.position_id WHERE p.id = _user_id), false)
$$;

INSERT INTO public.municipalities VALUES ('${MA}', 'อปท. เอ', 'a', ARRAY['complaints'], -100123),
  ('${MB}', 'อปท. บี', 'b', NULL, NULL), ('${MDEMO}', 'สาธิต', 'demo', ARRAY['complaints'], NULL);
INSERT INTO public.departments (id, municipality_id, name, code, sort_order) VALUES
  ('${DG}', '${MA}', 'สำนักปลัด', 'general', 1), ('${D1}', '${MA}', 'กองช่าง', 'civil', 2),
  ('${DF}', '${MA}', 'กองคลัง', 'finance', 3), ('${DB1}', '${MB}', 'สำนักปลัด', 'general', 1);
INSERT INTO public.positions VALUES ('${POS_TOP}', 'top_admin');
`)
for (const [alias, uid] of Object.entries(U)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [uid])
  await db.query(`INSERT INTO public.profiles (id, role, municipality_id, department_id, full_name, is_dept_head, position_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uid, ROLE[alias], alias in MUNI ? MUNI[alias] : MA, DEPT[alias] ?? null, NAME[alias] ?? null, HEAD[alias] ?? false, POS[alias] ?? null])
  if (CHAT[alias]) await db.query('INSERT INTO public.telegram_user_links (user_id, chat_id) VALUES ($1,$2)', [uid, CHAT[alias]])
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
await db.exec(payTablesSql)
await db.exec(payRlsSql)

await test('ด่านหัวไฟล์: รันไฟล์ 2 ก่อนไฟล์ 1 → พังพร้อมชื่อไฟล์ที่ต้องรันก่อน', async () => {
  await rejects(db.exec(bankRpcSql), { message: /20261212100000/ })
  await db.exec('ROLLBACK').catch(() => {})
})

await db.exec(bankTablesSql)
await db.exec(bankRpcSql)
await db.exec(bankTablesSql) // รันซ้ำทั้งชุดต้องไม่พัง
await db.exec(bankRpcSql)

const today = (await rows('SELECT public.licence_today()::text AS d'))[0].d
const day = async n => (await rows('SELECT ($1::date + $2::int)::text AS d', [today, n]))[0].d

const saveSettings = (alias, muni, s = {}) => asUser(alias,
  'SELECT * FROM public.payment_save_settings($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
  [muni, s.counter ?? true, s.promptpay ?? false, s.bill ?? false, s.promptpayId ?? null, s.billerId ?? null,
   s.bank ?? null, s.payee ?? null, JSON.stringify(s.channels ?? { licence: ['counter'] }), s.elaas ?? [], s.lead ?? 60,
   s.financeDept ?? null, s.financeCan ?? false])
const sync = (alias, muni = MA) => asUser(alias, 'SELECT public.payment_sync_licence_dues($1) AS r', [muni]).then(r => r[0].r)
const importRows = (alias, kind, list, name = 'statement.csv', muni = MA) => asUser(alias,
  'SELECT public.payment_import_bank_rows($1,$2,$3,$4) AS r', [muni, kind, name, JSON.stringify(list)]).then(r => r[0].r)
const listTxns = (alias, status = 'unmatched', muni = MA) =>
  asUser(alias, 'SELECT public.payment_list_bank_txns($1,$2) AS r', [muni, status]).then(r => r[0].r)
const match = (alias, txnId, dueId) => asUser(alias, 'SELECT public.payment_match_bank_txn($1,$2) AS r', [txnId, dueId]).then(r => r[0].r)
const resetTxn = (alias, txnId, reason) => asUser(alias, 'SELECT public.payment_reset_bank_txn($1,$2)', [txnId, reason])
const notOurs = (alias, txnId, reason) => asUser(alias, 'SELECT public.payment_mark_bank_txn_not_ours($1,$2)', [txnId, reason])
const receipt = (alias, dueId, receiptNo, extra = {}) => asUser(alias,
  'SELECT public.payment_record_receipt($1,$2,$3,$4,$5,$6,$7) AS r',
  [dueId, extra.paidOn ?? today, extra.amount ?? 500, receiptNo, extra.channel ?? 'bill_payment', extra.surcharge ?? 0, true])
const dueOf = async licenceId => (await rows("SELECT * FROM public.payment_dues WHERE licence_id = $1 ORDER BY created_at DESC, id", [licenceId]))
const txn = async txnId => (await rows('SELECT * FROM public.payment_bank_txns WHERE id = $1', [txnId]))[0]
const txnEvents = async txnId => (await rows('SELECT action, reason, actor FROM public.payment_events WHERE entity_id = $1 ORDER BY id', [txnId]))
const bangkokNoon = d => `${d} 12:00`

// ── ทะเบียน + ค่าตั้ง + ยอดค้าง ──
await db.query("UPDATE public.municipalities SET enabled_modules = array_append(enabled_modules, 'payment-dues') WHERE id = $1", [MA])
const hazard = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name, default_fee)
  VALUES ($1,'health_hazard','กิจการที่เป็นอันตรายต่อสุขภาพ', 500) RETURNING *`, [MA]))[0]
const foodNotice = (await asUser('staffDG', `INSERT INTO public.licence_types (municipality_id, category, name)
  VALUES ($1,'food_notice','หนังสือรับรองการแจ้ง') RETURNING *`, [MA]))[0]
const newLicence = async (typeId, cols = {}) => (await asUser('staffDG',
  `INSERT INTO public.licences (municipality_id, licence_type_id, business_name, holder_name, address, licence_no, expires_on, next_fee_due_on, fee_amount)
   VALUES ($1,$2,$3,'ผู้ประกอบการ','99 หมู่ 1',$4,$5,$6,$7) RETURNING *`,
  [MA, typeId, cols.business ?? 'ร้านทดสอบ', cols.no ?? null, cols.expires ?? null, cols.due ?? null,
   cols.fee === undefined ? 500 : cols.fee]))[0]

const L1 = await newLicence(hazard.id, { business: 'ร้านหนึ่ง', no: 'H-1', expires: await day(30) })
const L2 = await newLicence(hazard.id, { business: 'ร้านสอง', no: 'H-2', expires: await day(40) })
const L3 = await newLicence(hazard.id, { business: 'ร้านสาม', no: 'H-3', expires: await day(45) })
const N1 = await newLicence(foodNotice.id, { business: 'ร้านอาหาร', no: 'N-1', due: await day(10), fee: 300 })
const LDEL = await newLicence(hazard.id, { business: 'ร้านจะถูกลบ', no: 'H-9', expires: await day(50), fee: 777 })

await test('คิวแจ้งเปลี่ยนบัญชี: ตั้งบัญชีครั้งแรก/เปลี่ยนบัญชี = เข้าคิว · แก้อย่างอื่น = ไม่เข้าคิว', async () => {
  await saveSettings('adminA', MA, { bill: true, billerId: '099400012345601', promptpay: true, promptpayId: '0994000123456',
    bank: 'กรุงไทย', payee: 'เทศบาลตำบลเอ', channels: { licence: ['bill_payment', 'counter', 'promptpay'] },
    financeDept: DF, financeCan: true })
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.payment_account_alerts')).at(0).n, 1)
  await saveSettings('adminA', MA, { bill: true, billerId: '099400012345601', promptpay: true, promptpayId: '0994000123456',
    bank: 'กรุงไทย', payee: 'เทศบาลตำบลเอ', channels: { licence: ['bill_payment', 'counter', 'promptpay'] },
    financeDept: DF, financeCan: true, lead: 50 })
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.payment_account_alerts')).at(0).n, 1, 'แก้วันล่วงหน้าไม่ใช่การเปลี่ยนบัญชี')
  await saveSettings('adminA', MA, { bill: true, billerId: '099400012345601', promptpay: true, promptpayId: '0994000999999',
    bank: 'กรุงไทย', payee: 'เทศบาลตำบลเอ', channels: { licence: ['bill_payment', 'counter', 'promptpay'] },
    financeDept: DF, financeCan: true, lead: 60 })
  assert.deepEqual((await rows('SELECT status FROM public.payment_account_alerts ORDER BY event_id')).map(r => r.status), ['pending', 'pending'])
})

await test('คิวแจ้ง: บัญชีผู้ใช้เรียก claim/finish ไม่ได้ · service_role จองได้ · เลขปิดเหลือ 4 ตัว · ผู้รับ = ผู้บริหาร + หัวหน้ากองคลัง', async () => {
  for (const who of ['adminA', 'viewerA', 'superadmin']) {
    await rejects(asUser(who, 'SELECT public.payment_alert_claim(10)'), DENIED)
    await rejects(asUser(who, "SELECT public.payment_alert_finish(1, 'sent', NULL, NULL)"), DENIED)
  }
  await rejects(asUser('anon', 'SELECT public.payment_alert_claim(10)'), DENIED)
  await db.exec('SET ROLE service_role')
  const claimed = (await rows('SELECT public.payment_alert_claim(10) AS r'))[0].r
  await db.exec('RESET ROLE')
  assert.equal(claimed.length, 2)
  const [first, second] = claimed
  assert.equal(first.first_setup, true)
  assert.equal(second.first_setup, false)
  assert.equal(first.telegram_group_id, '-100123')
  assert.equal(first.municipality_name, 'อปท. เอ')
  assert.equal(first.actor_name, 'แอดมิน เอ')
  const pp = second.fields.find(f => f.field === 'promptpay_id')
  assert.deepEqual(pp, { field: 'promptpay_id', old: '••••3456', new: '••••9999' })
  assert.deepEqual(second.fields.map(f => f.field), ['promptpay_id'], 'เฉพาะช่องบัญชีที่เปลี่ยน')
  assert.deepEqual(first.fields.map(f => f.field), ['promptpay_id', 'biller_id', 'bank_name', 'payee_name'])
  assert.equal(first.fields.find(f => f.field === 'biller_id').new, '••••5601')
  assert.equal(first.fields.find(f => f.field === 'bank_name').new, 'กรุงไทย')
  assert.ok(!JSON.stringify(claimed).includes('0994000999999'), 'ห้ามมีเลขเต็มในเนื้อหาที่ส่ง')
  // viewer + ปลัด (top_admin) + หัวหน้ากองคลัง — ไม่รวมประชาชน/หัวหน้ากองช่าง/แอดมิน/เจ้าหน้าที่กองคลังที่ไม่ใช่หัวหน้า/คน อปท. อื่น
  assert.deepEqual([...first.dm_chat_ids].sort(), ['9001', '9002', '9003'])
  // จองซ้ำทันที = ไม่ได้ (กำลังส่ง ยังไม่เกิน 10 นาที)
  await db.exec('SET ROLE service_role')
  assert.deepEqual((await rows('SELECT public.payment_alert_claim(10) AS r'))[0].r, [])
  assert.equal((await rows("SELECT public.payment_alert_finish($1, 'sent', 'กลุ่ม ✓ · ส่วนตัว 3/3', NULL) AS ok", [first.event_id]))[0].ok, true)
  assert.equal((await rows("SELECT public.payment_alert_finish($1, 'failed', NULL, 'Telegram 500') AS ok", [second.event_id]))[0].ok, true)
  assert.equal((await rows("SELECT public.payment_alert_finish($1, 'sent', NULL, NULL) AS ok", [first.event_id]))[0].ok, false, 'ปิดซ้ำไม่ได้')
  await db.exec('RESET ROLE')
  // ส่งไม่สำเร็จ → ครบ 10 นาทีลองใหม่ (ไม่เกิน 6 ครั้ง)
  await db.query("UPDATE public.payment_account_alerts SET claimed_at = now() - interval '11 minutes' WHERE event_id = $1", [second.event_id])
  await db.exec('SET ROLE service_role')
  const retry = (await rows('SELECT public.payment_alert_claim(10) AS r'))[0].r
  await db.exec('RESET ROLE')
  assert.deepEqual(retry.map(r => [r.event_id, r.attempt]), [[second.event_id, 2]])
  await db.query("UPDATE public.payment_account_alerts SET status = 'failed', attempts = 6, claimed_at = now() - interval '1 day' WHERE event_id = $1", [second.event_id])
  await db.exec('SET ROLE service_role')
  assert.deepEqual((await rows('SELECT public.payment_alert_claim(10) AS r'))[0].r, [], 'ลองครบ 6 ครั้งแล้วหยุด')
  await db.exec('RESET ROLE')
  // ผู้ดูแลยอดเห็นผลส่ง (ไม่มี chat id ในตาราง) · ประชาชน/viewer ไม่เห็น
  assert.equal((await asUser('staffDG', 'SELECT count(*)::int AS n FROM public.payment_account_alerts')).at(0).n, 2)
  assert.equal((await asUser('viewerA', 'SELECT count(*)::int AS n FROM public.payment_account_alerts')).at(0).n, 0)
})

const syncResult = await sync('staffDG')
assert.equal(syncResult.created, 5, JSON.stringify(syncResult))
const [d1] = await dueOf(L1.id)
const [d2] = await dueOf(L2.id)
const [d3] = await dueOf(L3.id)
const [dn] = await dueOf(N1.id)
const [ddel] = await dueOf(LDEL.id)

// ── สิทธิ์ ──
await test('สิทธิ์: นำเข้า/ดู/จับคู่/ตั้งคอลัมน์ — เฉพาะผู้ดูแลยอด (กองที่ถือเรื่อง + กองคลังที่เปิดตัวเลือก)', async () => {
  for (const who of ['officerD1', 'viewerA', 'citizenA', 'techDG', 'adminB', 'staffB']) {
    await rejects(importRows(who, 'bill_payment', [{ txn_at: today, amount: 1 }]), DENIED)
    await rejects(listTxns(who), DENIED)
    await rejects(asUser(who, "SELECT public.payment_save_bank_mapping($1, 'account', '{}'::jsonb)", [MA]), DENIED)
  }
  await rejects(importRows('anon', 'bill_payment', [{ txn_at: today, amount: 1 }]), DENIED)
  await rejects(importRows('staffDG', 'bill_payment', [{ txn_at: today, amount: 1 }], 'x.csv', MDEMO), DENIED)
  // เขียนตารางตรงไม่ได้
  await rejects(asUser('staffDG', `INSERT INTO public.payment_bank_imports (municipality_id, file_kind, file_name, row_count)
    VALUES ($1, 'account', 'x', 0)`, [MA]), DENIED)
  await rejects(asUser('staffDG', "UPDATE public.payment_bank_txns SET status = 'not_ours', note = 'x'"), DENIED)
  await rejects(asUser('anon', 'SELECT count(*) FROM public.payment_bank_txns'), DENIED)
  // ผู้บริหารเรียกฟังก์ชันสรุปตรงไม่ได้ (ผ่าน executive_overview เท่านั้น)
  await rejects(asUser('viewerA', 'SELECT public.exec_summary_payment($1, CURRENT_DATE, CURRENT_DATE)', [MA]), DENIED)
})

await test('ตั้งการจับคู่คอลัมน์: เก็บรายชนิดไฟล์ · ตรวจรูปแบบ · ลงประวัติค่าตั้ง', async () => {
  const m = (await asUser('financeA', 'SELECT public.payment_save_bank_mapping($1,$2,$3) AS r',
    [MA, 'bill_payment', JSON.stringify({ header_row: 1, date_col: 'วันที่', amount_col: 'จำนวนเงิน', ref1_col: 'Ref1' })]))[0].r
  assert.equal(m.bill_payment.ref1_col, 'Ref1')
  await asUser('staffDG', 'SELECT public.payment_save_bank_mapping($1,$2,$3)', [MA, 'account', JSON.stringify({ date_col: 'Date' })])
  const s = (await rows('SELECT bank_file_mapping FROM public.payment_settings WHERE municipality_id = $1', [MA]))[0].bank_file_mapping
  assert.deepEqual(Object.keys(s).sort(), ['account', 'bill_payment'])
  await rejects(asUser('staffDG', 'SELECT public.payment_save_bank_mapping($1,$2,$3)', [MA, 'slip', '{}']), { code: '22023' })
  await rejects(asUser('staffDG', 'SELECT public.payment_save_bank_mapping($1,$2,$3)', [MA, 'account', '[]']), { code: '22023' })
  await rejects(asUser('staffDG', 'SELECT public.payment_save_bank_mapping($1,$2,$3)',
    [MA, 'account', JSON.stringify({ date_col: { nested: 1 } })]), { code: '22023' })
  await rejects(asUser('staffDG', 'SELECT public.payment_save_bank_mapping($1,$2,$3)',
    [MA, 'account', JSON.stringify({ 'Bad Key': 'x' })]), { code: '22023' })
  const ev = await rows("SELECT action FROM public.payment_events WHERE entity = 'settings' ORDER BY id DESC LIMIT 1")
  assert.equal(ev[0].action, 'update')
})

// ── นำเข้า Bill Payment ──
const UNKNOWN_REF = '12345678901' + (await rows("SELECT public.payment_luhn_digit('12345678901') AS d"))[0].d  // รูปแบบถูก แต่ไม่มีในระบบ
const FOREIGN_REF = '1100700123456'  // 13 หลัก (หน้าตาเลขบัตรประชาชน) — ไม่ใช่รูปแบบของระบบ ห้ามเก็บ
let billImport
await test('Bill Payment: Ref1+ยอดตรง = จับคู่เอง · ยอดไม่เท่า/ไม่พบ Ref1 = ค้างพร้อมเหตุผล · ศูนย์นำหน้าใน Ref1 ไม่ทำให้พลาด', async () => {
  billImport = await importRows('staffDG', 'bill_payment', [
    { txn_at: bangkokNoon(today), amount: '500.00', ref1: d1.ref1, ref2: 'X1', bank_ref: 'BP-0001' },
    { txn_at: bangkokNoon(today), amount: 499, ref1: d2.ref1, bank_ref: 'BP-0002' },             // ยอดไม่เท่า
    { txn_at: bangkokNoon(today), amount: '1,000', ref1: UNKNOWN_REF, bank_ref: 'BP-0003' },    // Ref1 ไม่มีในระบบ
    { txn_at: `${today}T09:30:00+07:00`, amount: 300, ref1: '00' + dn.ref1, bank_ref: 'BP-0004' },  // ธนาคารเติมศูนย์
    { txn_at: bangkokNoon(today), amount: 50, ref1: FOREIGN_REF, bank_ref: 'BP-0005' },            // Ref1 ของรายได้อื่น
  ], 'ktb-billpay.csv')
  assert.equal(billImport.rows, 5)
  assert.equal(billImport.inserted, 5)
  assert.equal(billImport.auto_matched, 2)
  assert.equal(billImport.unmatched, 3)
  // PDPA (ผลตรวจ M-3): Ref1 ที่ไม่ใช่รูปแบบของระบบไม่ถูกเก็บ · Ref2 ไม่ถูกเก็บเลย
  const foreign = (await rows('SELECT * FROM public.payment_bank_txns WHERE bank_ref = $1', ['BP-0005']))[0]
  assert.deepEqual([foreign.ref1, foreign.ref1_foreign], [null, true])
  assert.ok(!('ref2' in foreign), 'ไม่มีคอลัมน์ ref2')
  assert.ok(!JSON.stringify(await rows('SELECT * FROM public.payment_bank_txns')).includes(FOREIGN_REF))
  const matched = (await listTxns('staffDG', 'matched')).rows
  assert.deepEqual(matched.map(r => r.due.ref1).sort(), [d1.ref1, dn.ref1].sort())
  assert.ok(matched.every(r => r.match_method === 'auto_ref1'))
  const unmatched = (await listTxns('financeA', 'unmatched')).rows
  const wrongAmount = unmatched.find(r => r.ref1 === d2.ref1)
  assert.match(wrongAmount.hint, /ยอดเงินไม่เท่ายอดค้าง \(500\.00 บาท\)/)
  // ผลตรวจรอบ 2 L-4: Ref1 รูปแบบถูกแต่ไม่มียอดใน อปท. นี้ (เช่นเบอร์โทรที่บังเอิญผ่าน Luhn) ก็ไม่เก็บ
  const unknown = unmatched.find(r => Number(r.amount) === 1000)
  assert.deepEqual([unknown.ref1, unknown.ref1_foreign], [null, true])
  assert.match(unknown.hint, /ไม่ใช่ Ref1 ของยอดในระบบนี้/)
  assert.ok(!JSON.stringify(await rows('SELECT * FROM public.payment_bank_txns')).includes(UNKNOWN_REF))
  assert.equal(unmatched.filter(r => r.ref1_foreign).length, 2)
  const m1 = matched.find(r => r.due.ref1 === d1.ref1)
  const t1 = await txn(m1.id)
  assert.equal(t1.txn_date.toISOString().slice(0, 10), today)
  assert.equal(String(t1.amount), '500.00')
  const ev = await txnEvents(m1.id)
  assert.deepEqual(ev.map(e => e.action), ['match'])
  assert.equal(ev[0].actor, U.staffDG, 'ระบบจับคู่ระหว่างการนำเข้าของคนนี้ (actor = ผู้นำเข้า, method auto_ref1)')
  // ยอดยังรอชำระ — ระบบไม่ปิดยอดเอง (รอเลขใบเสร็จ)
  assert.equal((await dueOf(L1.id))[0].status, 'open')
})

await test('กันนำเข้าซ้ำ: ไฟล์เดิมซ้ำ = 0 แถวใหม่ · แถวเหมือนกันทุกช่องสองแถวในไฟล์ = ได้ 2 แถว (คนละรายการจริง)', async () => {
  const again = await importRows('staffDG', 'bill_payment', [
    { txn_at: bangkokNoon(today), amount: '500.00', ref1: d1.ref1, ref2: 'X1', bank_ref: 'BP-0001' },
    { txn_at: bangkokNoon(today), amount: 499, ref1: d2.ref1, bank_ref: 'BP-0002' },
    { txn_at: bangkokNoon(today), amount: '1,000', ref1: UNKNOWN_REF, bank_ref: 'BP-0003' },
    { txn_at: `${today}T09:30:00+07:00`, amount: 300, ref1: '00' + dn.ref1, bank_ref: 'BP-0004' },
    { txn_at: bangkokNoon(today), amount: 50, ref1: FOREIGN_REF, bank_ref: 'BP-0005' },
  ], 'ktb-billpay.csv')
  assert.deepEqual([again.inserted, again.duplicates, again.auto_matched], [0, 5, 0])
  const twin = { txn_at: `${today} 10:15`, amount: 250 }
  const r = await importRows('staffDG', 'account', [twin, twin], 'acct-1.csv')
  assert.equal(r.inserted, 2)
  const r2 = await importRows('staffDG', 'account', [twin, twin, { txn_at: `${today} 10:16`, amount: 250 }], 'acct-2.csv')
  assert.deepEqual([r2.inserted, r2.duplicates], [1, 2])
  const imports = await rows('SELECT file_name, row_count, inserted_count, duplicate_count FROM public.payment_bank_imports ORDER BY created_at, file_name')
  assert.equal(imports.length, 4)
})

await test('แถวผิดรูปแบบแถวเดียว = ไม่รับทั้งไฟล์ พร้อมเลขแถว · วันอนาคต/ปี พ.ศ./ยอดติดลบ/เกิน 5,000 แถว', async () => {
  const before = (await rows('SELECT count(*)::int AS n FROM public.payment_bank_txns')).at(0).n
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: 10 }, { txn_at: '18/11/2569', amount: 10 }]),
    { message: /แถวที่ 2 : วันเวลาไม่ถูกต้อง/ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: 'สิบบาท' }]), { message: /แถวที่ 1 : ยอดเงิน/ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: '-5' }]), { message: /ยอดเงิน/ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: 0 }]), { message: /มากกว่า 0/ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: await day(1), amount: 10 }]), { message: /อนาคต/ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: '2569-11-18', amount: 10 }]), { message: /อนาคต.*พ\.ศ\./ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: 10, ref1: '1'.repeat(21) }]), { message: /Ref1 ต้องเป็นตัวเลข/ })
  // ผลตรวจ M-3: คอลัมน์จับคู่ผิด = ปฏิเสธ ไม่ตัดทิ้งให้ดูถูก · ผลตรวจ L-2: วันที่ผิดปฏิทินบอกเลขแถว
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: 10, ref1: 'AB12' }]), { message: /แถวที่ 1 : Ref1 ต้องเป็นตัวเลข/ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: 10, bank_ref: 'นายสมชาย ใจดี' }]), { message: /เลขอ้างอิงธนาคาร/ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: 10 }, { txn_at: '2026-02-30', amount: 10 }]),
    { message: /แถวที่ 2 : วันเวลาไม่ถูกต้อง/ })
  await rejects(importRows('staffDG', 'account', Array.from({ length: 5001 }, () => ({ txn_at: today, amount: 1 }))), { message: /5,000/ })
  await rejects(importRows('staffDG', 'account', [{ txn_at: today, amount: 1 }], '   '), { message: /ชื่อไฟล์/ })
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.payment_bank_txns')).at(0).n, before, 'ไม่มีแถวหลุดเข้าไป')
})

// ── พร้อมเพย์: เสนอคู่ คนยืนยัน ──
let ppSingle, ppMulti
await test('พร้อมเพย์: ยอดเท่ากันยอดเดียว = เสนอคู่ (suggested) · หลายยอด = ให้คนเลือก · ระบบไม่ผูกเอง', async () => {
  const r = await importRows('staffDG', 'account', [
    { txn_at: `${today} 08:00`, amount: 777 },    // ตรงกับ LDEL ยอดเดียว
    { txn_at: `${today} 08:05`, amount: 500 },    // ตรงกับ d2, d3 (d1 จับคู่แล้ว)
  ], 'promptpay-1.csv')
  assert.equal(r.auto_matched, 0, 'ไฟล์บัญชี (ไม่มี Ref) ระบบไม่จับคู่เอง')
  const list = (await listTxns('staffDG')).rows
  ppSingle = list.find(t => Number(t.amount) === 777)
  ppMulti = list.find(t => Number(t.amount) === 500 && t.file_kind === 'account')
  assert.equal(ppSingle.suggested_due_id, ddel.id)
  assert.equal(ppSingle.candidates.length, 1)
  assert.equal(ppMulti.suggested_due_id, null)
  assert.deepEqual(ppMulti.candidates.map(c => c.id).sort(), [d2.id, d3.id].sort())
  assert.equal((await txn(ppSingle.id)).status, 'unmatched')
})

await test('ยืนยันคู่: ยอดไม่เท่า/ยอดมีคู่แล้ว/ยอดปิดแล้ว/คนละ อปท. = ปฏิเสธ · สำเร็จคืนค่าที่ใช้กรอกใบเสร็จ', async () => {
  await rejects(match('staffDG', ppMulti.id, ddel.id), { message: /ไม่เท่ายอดค้าง/ })
  await rejects(match('staffDG', ppMulti.id, d1.id), { message: /จับคู่กับเงินเข้ารายการอื่นแล้ว/ })
  await rejects(match('officerD1', ppMulti.id, d2.id), DENIED)
  await rejects(match('adminB', ppMulti.id, d2.id), DENIED)
  const r = await match('financeA', ppMulti.id, d2.id)
  assert.deepEqual([r.due_id, r.channel, r.paid_on], [d2.id, 'promptpay', today])
  const t = await txn(ppMulti.id)
  assert.deepEqual([t.status, t.match_method, t.matched_by], ['matched', 'confirmed', U.financeA])
  await rejects(match('staffDG', ppMulti.id, d3.id), { message: /ไม่ได้อยู่ในสถานะ/ })
})

await test('ต่ออายุ: เงินเข้าหลังวันหมดอายุของใบ = จับคู่ไม่ได้ (พ.ร.ฎ. 2564)', async () => {
  const late = await importRows('staffDG', 'account', [{ txn_at: `${today} 07:00`, amount: 500 }], 'late.csv')
  assert.equal(late.inserted, 1)
  const t = (await listTxns('staffDG')).rows.find(x => Number(x.amount) === 500 && x.file_kind === 'account')
  await db.query('UPDATE public.payment_dues SET due_on = $2 WHERE id = $1', [d3.id, await day(-1)])
  await rejects(match('staffDG', t.id, d3.id), { message: /หลังวันหมดอายุ/ })
  const listed = (await listTxns('staffDG')).rows.find(x => x.id === t.id)
  assert.ok(!listed.candidates.some(c => c.id === d3.id), 'ไม่เสนอยอดที่เงินเข้าหลังหมดอายุ')
  await db.query('UPDATE public.payment_dues SET due_on = $2 WHERE id = $1', [d3.id, await day(45)])
  await notOurs('staffDG', t.id, 'ทดสอบ: เงินเข้าคนละรายการ')
})

// ── ยอดที่มีเงินเข้า: ระบบไม่ปิด/ไม่เปลี่ยนยอดเอง ──
await test('ยอดที่มีเงินเข้าจับคู่ไว้: พ้นวันหมดอายุ → ระบบไม่ lapse · อัตราเปลี่ยน → ไม่เปลี่ยนยอด · คนยกเลิกยอดไม่ได้', async () => {
  // d1 จับคู่จาก Bill Payment (เงินเข้าวันนี้) — สมมติใบหมดอายุไปแล้วเมื่อวานก่อนมีคนกรอกเลขใบเสร็จ
  await db.query('UPDATE public.licences SET expires_on = $2 WHERE id = $1', [L1.id, await day(-1)])
  await db.query('UPDATE public.payment_dues SET due_on = $2, period_from = $3 WHERE id = $1', [d1.id, await day(-1), today])
  await asUser('staffDG', 'UPDATE public.licences SET fee_amount = 650 WHERE id = $1', [L2.id])
  const r = await sync('staffDG')
  assert.equal(r.lapsed, 0, JSON.stringify(r))
  assert.equal(r.updated, 0, 'ยอดที่มีเงินเข้าไม่ถูกปรับตามอัตราใหม่')
  assert.equal((await dueOf(L1.id))[0].status, 'open')
  assert.equal(String((await dueOf(L2.id))[0].amount), '500.00')
  await rejects(asUser('staffDG', 'SELECT public.payment_cancel_due($1, $2)', [d2.id, 'ทดสอบยกเลิก']), { message: /มีเงินเข้าจับคู่ไว้แล้ว/ })
  assert.equal((await dueOf(L2.id))[0].status, 'open')
  // ยอดที่ไม่มีเงินเข้ายังทำงานตามเดิม (อัตราใหม่ → ปรับยอด)
  await asUser('staffDG', 'UPDATE public.licences SET fee_amount = 550 WHERE id = $1', [L3.id])
  assert.equal((await sync('staffDG')).updated, 1)
  await asUser('staffDG', 'UPDATE public.licences SET fee_amount = 500 WHERE id = $1', [L3.id])
  await sync('staffDG')
  await asUser('staffDG', 'UPDATE public.licences SET fee_amount = 500 WHERE id = $1', [L2.id])
  await db.query('UPDATE public.licences SET expires_on = $2 WHERE id = $1', [L1.id, await day(30)])
  await db.query('UPDATE public.payment_dues SET due_on = $2, period_from = $3 WHERE id = $1', [d1.id, await day(30), await day(31)])
})

// ── เลขใบเสร็จ → receipted · ยกเลิกรายการรับเงิน → matched ──
await test('บันทึกเลขใบเสร็จของยอดที่จับคู่ → เงินเข้าเป็น receipted · ยกเลิกรายการรับเงิน → กลับเป็น matched (เงินยังเข้าจริง)', async () => {
  const t1 = (await rows('SELECT id FROM public.payment_bank_txns WHERE due_id = $1', [d1.id]))[0]
  const r = (await receipt('financeA', d1.id, 'e-LAAS 001/2570', { channel: 'bill_payment' }))[0].r
  let t = await txn(t1.id)
  assert.deepEqual([t.status, t.payment_id], ['receipted', r.payment_id])
  await rejects(resetTxn('staffDG', t1.id, 'จับคู่ผิด'), { message: /บันทึกเลขใบเสร็จแล้ว/ })
  await asUser('staffDG', 'SELECT public.licence_void_fee($1,$2)', [r.payment_id, 'กรอกเลขใบเสร็จผิด'])
  t = await txn(t1.id)
  assert.deepEqual([t.status, t.payment_id], ['matched', null])
  assert.deepEqual((await txnEvents(t1.id)).map(e => e.action), ['match', 'receipted', 'unreceipted'])
  await receipt('staffDG', d1.id, 'e-LAAS 002/2570', { channel: 'bill_payment' })
  assert.equal((await txn(t1.id)).status, 'receipted')
  // บันทึกจากหน้าทะเบียนเดิม (ไม่ผ่าน payment_record_receipt) ก็ปิดเงินเข้าให้
  const tn = (await rows('SELECT id FROM public.payment_bank_txns WHERE due_id = $1', [dn.id]))[0]
  await asUser('staffDG', 'SELECT public.licence_record_fee($1,$2,$3,$4,$5,$6,$7)', [N1.id, 'annual', today, 300, 'e-LAAS 003/2570', 0, false])
  assert.equal((await txn(tn.id)).status, 'receipted')
})

// ── ยกเลิกคู่ / ไม่ใช่เงินของระบบนี้ ──
await test('ยกเลิกคู่ + ระบุ "ไม่ใช่เงินของระบบนี้" ต้องมีเหตุผล · ย้อนได้ · ลงประวัติทุกครั้ง', async () => {
  await rejects(resetTxn('staffDG', ppMulti.id, ''), { message: /เหตุผล/ })
  await rejects(resetTxn('officerD1', ppMulti.id, 'ผิดคน'), DENIED)
  await resetTxn('staffDG', ppMulti.id, 'ผู้โอนแจ้งว่าจ่ายให้ร้านสาม')
  let t = await txn(ppMulti.id)
  assert.deepEqual([t.status, t.due_id, t.match_method], ['unmatched', null, null])
  await rejects(notOurs('staffDG', ppMulti.id, 'xx'), { message: /เหตุผล/ })
  await notOurs('financeA', ppMulti.id, 'ค่าเช่าอาคาร ไม่ใช่ค่าธรรมเนียม')
  t = await txn(ppMulti.id)
  assert.deepEqual([t.status, t.note], ['not_ours', 'ค่าเช่าอาคาร ไม่ใช่ค่าธรรมเนียม'])
  await rejects(match('staffDG', ppMulti.id, d3.id), { message: /ไม่ได้อยู่ในสถานะ/ })
  await rejects(notOurs('staffDG', ppMulti.id, 'ซ้ำอีกรอบ'), { message: /ยังไม่ได้จับคู่/ })
  await resetTxn('staffDG', ppMulti.id, 'ระบุผิด')
  assert.equal((await txn(ppMulti.id)).status, 'unmatched')
  assert.deepEqual((await txnEvents(ppMulti.id)).map(e => e.action), ['match', 'unmatch', 'not_ours', 'unmatch'])
  // ยอดที่ไม่มีคู่แล้ว ยกเลิกได้ตามปกติ (กติกา PR1)
  await match('staffDG', ppMulti.id, d3.id)
})

await test('ลบใบจากทะเบียน → ยอดหายตาม → เงินเข้าที่จับคู่ไว้กลับเป็น "ยังระบุไม่ได้" + ลงประวัติ', async () => {
  await match('staffDG', ppSingle.id, ddel.id)
  await asUser('staffDG', 'DELETE FROM public.licences WHERE id = $1', [LDEL.id])
  const t = await txn(ppSingle.id)
  assert.deepEqual([t.status, t.due_id], ['unmatched', null])
  const ev = await txnEvents(ppSingle.id)
  assert.equal(ev.at(-1).action, 'unmatch')
  assert.match(ev.at(-1).reason, /ใบถูกลบจากทะเบียน/)
})

// ── ห้องผู้บริหาร ──
await test('exec_summary_payment: ตัวเลขรวมถูกต้อง · ไม่มีชื่อร้าน/Ref1 · ประชาชน/คนละ อปท. = 42501', async () => {
  const call = async (alias, from = today, to = today) => {
    await db.exec('RESET ROLE')
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [U[alias]])
    try { return (await rows('SELECT public.exec_summary_payment($1,$2,$3) AS r', [MA, from, to]))[0].r } finally { await asRoot() }
  }
  const s = await call('viewerA')
  assert.equal(s.configured, true)
  // รอชำระ: d2 (500), d3 (500) · ชำระแล้ววันนี้: d1 (500), dn (300)
  assert.deepEqual([s.open.n, Number(s.open.amount)], [2, 1000])
  assert.deepEqual([s.paid.n, Number(s.paid.amount)], [2, 800])
  assert.equal(s.overdue.n, 0)
  // เงินเข้าที่ยังระบุไม่ได้: 499 (Ref1 ยอดไม่เท่า) + 1,000 (Ref1 ไม่พบ) + 50 (Ref1 รายได้อื่น) + 250 ×3 + 777 (ใบถูกลบ)
  assert.deepEqual([s.bank_unmatched.n, Number(s.bank_unmatched.amount)], [7, 499 + 1000 + 50 + 750 + 777])
  assert.deepEqual([s.not_ours.n, Number(s.not_ours.amount)], [1, 500], 'ระบุว่าไม่ใช่ของระบบในช่วง (เงินเข้าหลังหมดอายุ)')
  // รอเลขใบเสร็จ: ppMulti → d3 (เงินเข้าวันนี้ = ยังไม่สาย)
  assert.deepEqual([s.awaiting_receipt.n, s.awaiting_receipt.late], [1, 0])
  assert.ok(s.account_changed_at, 'บัญชีเปลี่ยนภายใน 30 วัน')
  const text = JSON.stringify(s)
  for (const leak of ['ร้าน', d2.ref1, 'ผู้ประกอบการ', 'H-2']) assert.ok(!text.includes(leak), `ห้ามมี ${leak}`)
  assert.equal((await call('clerkA')).open.n, 2, 'ปลัด (top_admin) เห็นได้')
  for (const who of ['citizenA', 'staffDG', 'adminB']) await rejects(call(who), DENIED)
  // ช่วงที่ไม่มีการรับเงิน = 0 แต่ยอดค้างยังขึ้น (ไม่ขึ้นกับช่วง)
  const past = await call('viewerA', await day(-60), await day(-30))
  assert.deepEqual([past.paid.n, past.open.n], [0, 2])
})

await test('ด่านสิทธิ์ฟังก์ชัน: ภายใน/งานเบื้องหลังเรียกจากบัญชีผู้ใช้ไม่ได้', async () => {
  for (const sig of ['public.payment_alert_claim(integer)', 'public.payment_alert_finish(bigint, text, text, text)',
    'public.exec_summary_payment(uuid, date, date)', 'public.payment_mask_account(text)', 'public.payment_dues_guard_matched()']) {
    const r = (await rows("SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS a, has_function_privilege('anon', $1, 'EXECUTE') AS b", [sig]))[0]
    assert.deepEqual([r.a, r.b], [false, false], sig)
  }
  const sr = (await rows("SELECT has_function_privilege('service_role', 'public.payment_alert_claim(integer)', 'EXECUTE') AS s"))[0].s
  assert.equal(sr, true)
})

// ── ผลตรวจ migration-reviewer รอบ 1 ──
await test('H-1: ยอดต่ออายุเพิ่งพ้นวันหมดอายุ — ระบบรอไฟล์ธนาคาร 7 วัน · พ้นแล้ว lapse · เงินเข้าก่อนหมดอายุ → คนกดยืนยันเปิดยอดกลับ', async () => {
  const LG = await newLicence(hazard.id, { business: 'ร้านจ่ายวันสุดท้าย', no: 'H-7', expires: await day(20), fee: 610 })
  await sync('staffDG')
  const [dg] = await dueOf(LG.id)
  // ใบหมดอายุเมื่อวาน ยังไม่มีไฟล์ธนาคาร → sync ไม่ปิดยอด
  await db.query('UPDATE public.licences SET expires_on = $2 WHERE id = $1', [LG.id, await day(-1)])
  await db.query('UPDATE public.payment_dues SET due_on = $2, period_from = $3 WHERE id = $1', [dg.id, await day(-1), today])
  assert.equal((await sync('staffDG')).lapsed, 0)
  assert.equal((await dueOf(LG.id))[0].status, 'open')
  // พ้น 7 วัน → ปิดตามกฎเดิม
  await db.query('UPDATE public.licences SET expires_on = $2 WHERE id = $1', [LG.id, await day(-8)])
  await db.query('UPDATE public.payment_dues SET due_on = $2, period_from = $3 WHERE id = $1', [dg.id, await day(-8), await day(-7)])
  assert.equal((await sync('staffDG')).lapsed, 1)
  assert.equal((await dueOf(LG.id))[0].status, 'lapsed')
  // ไฟล์มาช้า: เงินเข้าวันหมดอายุพอดี → เสนอคู่แบบ reopen · ระบบไม่เปิดเอง
  await importRows('staffDG', 'account', [{ txn_at: `${await day(-8)} 16:30`, amount: 610 }], 'late-file.csv')
  const row = (await listTxns('staffDG')).rows.find(t => Number(t.amount) === 610)
  assert.deepEqual(row.candidates.map(c => [c.id, c.mode]), [[dg.id, 'reopen']])
  assert.equal((await dueOf(LG.id))[0].status, 'lapsed')
  const r = await match('staffDG', row.id, dg.id)
  assert.deepEqual([r.mode, r.status], ['reopen', 'matched'])
  const [after] = await dueOf(LG.id)
  assert.deepEqual([after.status, after.close_reason], ['open', null])
  const ev = await rows('SELECT action, reason FROM public.payment_events WHERE entity_id = $1 ORDER BY id', [dg.id])
  assert.equal(ev.at(-1).action, 'reopen')
  assert.match(ev.at(-1).reason, /ไม่เกินวันหมดอายุ/)
  // ยอดเปิดกลับแล้วไม่ถูก sync ปิดซ้ำ (มีเงินเข้าผูก) · บันทึกเลขใบเสร็จด้วยวันที่เงินเข้าได้ → ต่ออายุสำเร็จ
  assert.equal((await sync('staffDG')).lapsed, 0)
  await receipt('staffDG', dg.id, 'e-LAAS 010/2570', { paidOn: await day(-8), amount: 610, channel: 'promptpay' })
  assert.equal((await txn(row.id)).status, 'receipted')
  // เงินเข้าหลังหมดอายุ ไม่เสนอ reopen
  const LH = await newLicence(hazard.id, { business: 'ร้านจ่ายช้า', no: 'H-8', expires: await day(20), fee: 620 })
  await sync('staffDG')
  const [dh] = await dueOf(LH.id)
  await db.query('UPDATE public.licences SET expires_on = $2 WHERE id = $1', [LH.id, await day(-10)])
  await db.query('UPDATE public.payment_dues SET due_on = $2, period_from = $3 WHERE id = $1', [dh.id, await day(-10), await day(-9)])
  await sync('staffDG')
  await importRows('staffDG', 'account', [{ txn_at: `${await day(-9)} 09:00`, amount: 620 }], 'too-late.csv')
  const late = (await listTxns('staffDG')).rows.find(t => Number(t.amount) === 620)
  assert.deepEqual(late.candidates, [])
  await rejects(match('staffDG', late.id, dh.id), { message: /หลังวันหมดอายุ/ })
})

await test('M-1: บันทึกเลขใบเสร็จก่อนนำเข้าไฟล์ → Bill Payment ผูกหลักฐานเอง (receipted) ไม่ค้างเป็น "อาจจ่ายซ้ำ" · M-4 ป้ายอาจซ้ำ', async () => {
  const LV = await newLicence(hazard.id, { business: 'ร้านจ่ายแล้ว', no: 'H-10', expires: await day(35), fee: 640 })
  await sync('staffDG')
  const [dv] = await dueOf(LV.id)
  const paid = (await receipt('financeA', dv.id, 'e-LAAS 020/2570', { amount: 640, channel: 'bill_payment' }))[0].r
  const r = await importRows('staffDG', 'bill_payment', [{ txn_at: `${today} 11:11`, amount: 640, ref1: dv.ref1, bank_ref: 'BP-0640' }], 'bp-2.csv')
  assert.deepEqual([r.auto_matched, r.auto_evidence, r.unmatched], [0, 1, 0])
  const t = (await rows('SELECT * FROM public.payment_bank_txns WHERE bank_ref = $1', ['BP-0640']))[0]
  assert.deepEqual([t.status, t.due_id, t.payment_id, t.match_method], ['receipted', dv.id, paid.payment_id, 'auto_ref1'])
  // รายการเดินบัญชีที่มีเงินก้อนเดียวกัน → ไม่มีคู่ (ผูกแล้ว) + ป้ายอาจซ้ำกับ Bill Payment
  await importRows('staffDG', 'account', [{ txn_at: `${today} 11:12`, amount: 640 }], 'acct-640.csv')
  const dup = (await listTxns('staffDG')).rows.find(x => Number(x.amount) === 640)
  assert.equal(dup.maybe_duplicate, true)
  assert.deepEqual(dup.candidates, [])
  await notOurs('staffDG', dup.id, 'ซ้ำกับรายงาน Bill Payment')
  // ยอดที่บันทึกรับแล้ว (ยังไม่มีหลักฐาน) เป็นคู่เสนอของเงินเข้าจากบัญชีได้ (mode evidence)
  const LW = await newLicence(hazard.id, { business: 'ร้านโอนเอง', no: 'H-11', expires: await day(36), fee: 655 })
  await sync('staffDG')
  const [dw] = await dueOf(LW.id)
  await receipt('staffDG', dw.id, 'e-LAAS 021/2570', { amount: 655, channel: 'promptpay' })
  await importRows('staffDG', 'account', [{ txn_at: `${today} 13:00`, amount: 655 }], 'acct-655.csv')
  const ev = (await listTxns('staffDG')).rows.find(x => Number(x.amount) === 655)
  assert.deepEqual(ev.candidates.map(c => c.mode), ['evidence'])
  assert.equal(ev.suggested_due_id, dw.id)
  const m = await match('financeA', ev.id, dw.id)
  assert.deepEqual([m.mode, m.status], ['evidence', 'receipted'])
})

await test('รอบ 2 H-1: Ref1 ใบแจ้งเก่าสแกนซ้ำ / จ่ายเงินสดแล้วจ่ายซ้ำทางแอป → ไม่ถูกซ่อนเป็นหลักฐาน ค้างให้คนเห็น', async () => {
  // (ก) ยอดรับทาง Bill Payment เมื่อนานแล้ว (นอกช่วง grace) แล้วมีคนสแกน QR ใบแจ้งเดิมจ่ายอีก
  const LO = await newLicence(hazard.id, { business: 'ร้านใบแจ้งเก่า', no: 'H-12', expires: await day(37), fee: 670 })
  await sync('staffDG')
  const [dold] = await dueOf(LO.id)
  const paidOld = (await receipt('staffDG', dold.id, 'e-LAAS 030/2569', { amount: 670, channel: 'bill_payment' }))[0].r
  await db.query('UPDATE public.licence_fee_payments SET paid_on = $2 WHERE id = $1', [paidOld.payment_id, await day(-30)])
  const r1 = await importRows('staffDG', 'bill_payment', [{ txn_at: `${today} 14:00`, amount: 670, ref1: dold.ref1, bank_ref: 'BP-OLD1' }], 'bp-old.csv')
  assert.deepEqual([r1.auto_matched, r1.auto_evidence, r1.unmatched], [0, 0, 1])
  const old = (await listTxns('staffDG')).rows.find(x => x.bank_ref === 'BP-OLD1')
  assert.match(old.hint, /อาจสแกนใบแจ้งเก่าหรือจ่ายซ้ำ/)
  assert.ok(!old.candidates.some(c => c.id === dold.id), 'ไม่เสนอผูกเป็นหลักฐานของรายการเก่า')
  // (ข) รับเงินสดที่เคาน์เตอร์ แล้วญาติจ่ายซ้ำผ่านแอปวันเดียวกัน
  const LC = await newLicence(hazard.id, { business: 'ร้านจ่ายสองทาง', no: 'H-13', expires: await day(38), fee: 680 })
  await sync('staffDG')
  const [dc] = await dueOf(LC.id)
  await receipt('staffDG', dc.id, 'e-LAAS 031/2570', { amount: 680, channel: 'counter' })
  const r2 = await importRows('staffDG', 'bill_payment', [{ txn_at: `${today} 15:00`, amount: 680, ref1: dc.ref1, bank_ref: 'BP-DUP1' }], 'bp-dup.csv')
  assert.deepEqual([r2.auto_evidence, r2.unmatched], [0, 1])
  const dup = (await listTxns('staffDG')).rows.find(x => x.bank_ref === 'BP-DUP1')
  assert.match(dup.hint, /อาจสแกนใบแจ้งเก่าหรือจ่ายซ้ำ/)
  assert.deepEqual(dup.candidates, [])
  await rejects(match('staffDG', dup.id, dc.id), { code: '22023' })
  // ยอดในห้องผู้บริหารยังนับเป็นเงินที่ยังระบุไม่ได้ (ไม่ถูกซ่อน)
  assert.ok((await txn(dup.id)).status === 'unmatched')
})

await test('รอบ 2 M-1: เปิดยอดที่ปิดแล้วกลับ (reopen) — กองคลังทำไม่ได้ · กองที่ถือเรื่องทำได้', async () => {
  const LR = await newLicence(hazard.id, { business: 'ร้านกองคลังห้ามเปิด', no: 'H-14', expires: await day(20), fee: 690 })
  await sync('staffDG')
  const [dr] = await dueOf(LR.id)
  await db.query('UPDATE public.licences SET expires_on = $2 WHERE id = $1', [LR.id, await day(-9)])
  await db.query('UPDATE public.payment_dues SET due_on = $2, period_from = $3 WHERE id = $1', [dr.id, await day(-9), await day(-8)])
  await sync('staffDG')
  assert.equal((await dueOf(LR.id))[0].status, 'lapsed')
  await importRows('staffDG', 'account', [{ txn_at: `${await day(-9)} 10:00`, amount: 690 }], 'reopen-finance.csv')
  const t = (await listTxns('financeA')).rows.find(x => Number(x.amount) === 690)
  assert.deepEqual(t.candidates.map(c => c.mode), ['reopen'])
  await rejects(match('financeA', t.id, dr.id), { code: '42501', message: /เฉพาะกองที่ถือเรื่อง/ })
  assert.equal((await dueOf(LR.id))[0].status, 'lapsed')
  const r = await match('staffDG', t.id, dr.id)
  assert.equal(r.mode, 'reopen')
})

await test('M-2: ยอดที่จับคู่ไว้แต่ใบถูกเพิกถอน → รายการบอกเหตุผลให้ยกเลิกคู่ (ไม่ค้างเงียบ)', async () => {
  const t = (await listTxns('staffDG', 'matched')).rows.find(x => x.due?.id === d3.id)
  assert.equal(t.blocked_reason, null)
  await db.query("UPDATE public.licences SET status = 'revoked', status_reason = 'คำสั่งที่ 1/2570' WHERE id = $1", [L3.id])
  const blocked = (await listTxns('staffDG', 'matched')).rows.find(x => x.due?.id === d3.id)
  assert.match(blocked.blocked_reason, /เพิกถอน.*ยกเลิกคู่/)
  await db.query("UPDATE public.licences SET status = 'active', status_reason = NULL WHERE id = $1", [L3.id])
})

console.log(`\n${cases} กรณีผ่านทั้งหมด`)
await db.close()
