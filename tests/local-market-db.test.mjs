// ตลาดชาวบ้าน (ขั้น 1A) — รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/local-market-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: 20261214100000 (ตาราง) → 20261214100100 (RLS/RPC/ผูกย้อนหลัง)
//   ⚠️ PGlite มี connection เดียว ทดสอบเพิ่มสินค้าพร้อมกันจริงไม่ได้ — ด่านนั้นคือ pg_advisory_xact_lock ใน trigger
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv.includes('--pglite') ? process.argv[process.argv.indexOf('--pglite') + 1] : process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'Supply --pglite <local module path> หรือตั้ง PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261214100000_local_market_tables.sql')
const rlsSql = await readMigration('20261214100100_local_market_rls_rpc.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = id(1), B = id(2), OFF = id(3)
const D1 = id(11), D2 = id(12)
const U = {
  owner: id(101), owner2: id(102), citizen: id(103), staff: id(104), staffOther: id(105),
  officer: id(106), admin: id(107), adminB: id(108), super1: id(109), gone: id(110), viewer: id(111), staffSame: id(112),
}
const P = {
  owner: ['citizen', A, null], owner2: ['citizen', A, null], citizen: ['citizen', A, null],
  staff: ['staff', A, D1], staffOther: ['staff', A, D2], officer: ['officer', A, D1],
  admin: ['admin', A, null], adminB: ['admin', B, null], super1: ['superadmin', null, null],
  gone: ['citizen', A, null], viewer: ['viewer', A, null], staffSame: ['staff', A, D1],
}
// ร้าน: S1 ร้านเจ้าของ owner (ผูกย้อนหลังได้) · S2 ชื่อซ้ำ 2 ร้าน (กำกวม ไม่ผูก) · S4 ปิดใช้งาน · SB อปท. B · SOFF อปท. ปิดโมดูล
const S1 = id(201), S2a = id(202), S2b = id(203), S4 = id(204), SB = id(205), SOFF = id(206), S5 = id(207)
const R1 = id(301), R2 = id(302), R4 = id(304), RP = id(305), RGONE = id(306), R5 = id(307), R6 = id(308), RSELF = id(309)
const S6 = id(208), S7 = id(209), S8 = id(210), S9 = id(211), S10 = id(212)
const RALT = id(310), RSTAFF = id(311), R7 = id(312)
const IMG = 'https://umxssfahtuprnztlytdd.supabase.co/functions/v1/drive-file?id=1AbC_d-9'

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text UNIQUE, enabled_modules text[]);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid, department_id uuid);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_my_department(p_municipality_id uuid, p_department_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT p_department_id IS NOT NULL AND p_municipality_id = public.get_my_municipality_id() AND p_department_id = public.get_my_department_id() $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id(),
  public.is_my_department(uuid, uuid) TO anon, authenticated;
-- โครงย่อของตารางจริง (เฉพาะคอลัมน์ที่ migration อ้าง)
CREATE TABLE public.tourism_places (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE,
  department_id uuid, name text NOT NULL, is_active boolean DEFAULT true, created_by uuid);
CREATE TABLE public.business_registrations (id uuid PRIMARY KEY, municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, business_name text NOT NULL, status text DEFAULT 'pending', approved_by uuid);
ALTER TABLE public.tourism_places ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.tourism_places TO anon, authenticated;
CREATE POLICY "public read" ON public.tourism_places FOR SELECT USING (true);
INSERT INTO public.municipalities VALUES ('${A}', 'demo', ARRAY['tourism']), ('${B}', 'other', NULL), ('${OFF}', 'off', ARRAY['tourism']);
INSERT INTO public.departments VALUES ('${D1}', '${A}'), ('${D2}', '${A}');
`)
for (const [alias, [role, muni, dept]] of Object.entries(P)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [U[alias]])
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4)', [U[alias], role, muni, dept])
}
await db.exec(`
-- created_by = staff: staff (D1) ดูแลได้เฉพาะร้านที่ตัวเองสร้าง เหมือน policy เดิมของ tourism_places · staffSame (D1) ไม่ได้สร้าง
INSERT INTO public.tourism_places (id, municipality_id, department_id, name, is_active, created_by) VALUES
  ('${S1}', '${A}', '${D1}', ' ร้านป้าแดง ', true, '${U.staff}'),
  ('${S2a}', '${A}', '${D1}', 'ร้านซ้ำ', true, '${U.staff}'), ('${S2b}', '${A}', '${D1}', 'ร้านซ้ำ', true, '${U.staff}'),
  ('${S4}', '${A}', '${D1}', 'ร้านปิด', false, '${U.staff}'),
  ('${SB}', '${B}', null, 'ร้าน B', true, null),
  ('${SOFF}', '${OFF}', null, 'ร้านปิดโมดูล', true, null),
  ('${S5}', '${A}', '${D1}', 'ร้านใหม่', true, '${U.staff}'),
  ('${S6}', '${A}', '${D1}', 'ร้านตั้งเอง', true, '${U.staff}'),
  ('${S9}', '${A}', '${D1}', 'ร้านบัญชีสอง', true, '${U.staff}'),
  ('${S10}', '${A}', '${D1}', 'ร้านจนท.อนุมัติ', true, '${U.staff}');
INSERT INTO public.business_registrations VALUES
  ('${R1}', '${A}', '${U.owner}', 'ร้านป้าแดง', 'approved', '${U.admin}'),
  ('${R2}', '${A}', '${U.owner2}', 'ร้านซ้ำ', 'approved', '${U.admin}'),
  ('${R4}', '${A}', '${U.owner2}', 'ร้านปิด', 'approved', '${U.admin}'),
  ('${RP}', '${A}', '${U.owner2}', 'ร้านใหม่', 'pending', null),
  ('${RGONE}', '${A}', null, 'ร้าน B', 'approved', '${U.admin}'),
  ('${R5}', '${A}', '${U.owner2}', 'ร้านใหม่ อนุมัติ', 'approved', '${U.admin}'),
  ('${R6}', '${A}', '${U.citizen}', 'ร้านอื่นของ citizen', 'approved', '${U.officer}'),
  -- บัญชีที่สองของประชาชนตั้งตัวเองเป็นผู้อนุมัติ (approved_by ≠ user_id แต่ไม่ใช่ admin/officer/superadmin) ต้องไม่ถูกเชื่อ
  ('${RALT}', '${A}', '${U.owner2}', 'ร้านบัญชีสอง', 'approved', '${U.citizen}'),
  -- staff ไม่มีสิทธิ์ UPDATE คำขอ (policy 20260802060000) ⇒ approved_by = staff ไม่นับ
  ('${RSTAFF}', '${A}', '${U.owner2}', 'ร้านจนท.อนุมัติ', 'approved', '${U.staff}'),
  -- ช่องเดิม (043): ประชาชน INSERT status='approved' ให้ตัวเองได้ — approved_by ว่าง/เป็นตัวเอง ต้องไม่ถูกเชื่อ
  ('${RSELF}', '${A}', '${U.owner2}', 'ร้านตั้งเอง', 'approved', '${U.owner2}');
`)

const actor = async alias => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias && alias !== 'anon' ? U[alias] : ''])
  await db.exec(`SET ROLE ${alias && alias !== 'anon' ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const rejects = (promise, expect = {}) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const DENIED = { code: '42501' }
let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }
const addProduct = (place, name, extra = {}) => db.query(
  `INSERT INTO public.market_products (place_id, name, price, unit, image_url, attest_lawful) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, municipality_id, is_hidden`,
  [place, name, extra.price ?? 50, extra.unit ?? 'ถุง', extra.image_url ?? null, extra.attest ?? true]).then(r => r.rows[0])

// ── migration ─────────────────────────────────────────────────────────────────────
await test('migration ไฟล์ 2 ปฏิเสธถ้ายังไม่รันไฟล์ 1', async () => {
  await rejects(db.exec(rlsSql), { message: /20261214100000/ })
  await db.exec('ROLLBACK')
})
await db.exec(tablesSql)
await db.exec(rlsSql)
await test('รันทั้ง 2 ไฟล์ซ้ำได้ + ด่านท้ายไฟล์ผ่าน', async () => {
  await db.exec(tablesSql)
  await db.exec(rlsSql)
})
await test('เปิดโมดูลให้ demo เท่านั้น (NULL ไม่แตะ · off ไม่ถูกเปิด)', async () => {
  const r = await rows('SELECT slug, enabled_modules FROM public.municipalities ORDER BY slug')
  assert.deepEqual(r.map(x => [x.slug, x.enabled_modules]), [['demo', ['tourism', 'local-market']], ['off', ['tourism']], ['other', null]])
  // enabled_modules = NULL ไม่นับว่าเปิดตลาด (ต่างจากโมดูลอื่นโดยตั้งใจ — ค่าเริ่มต้นต้องปิดจริง)
  const m = await rows('SELECT public.market_module_enabled($1) AS a, public.market_module_enabled($2) AS b, public.market_module_enabled($3) AS off', [A, B, OFF])
  assert.deepEqual(m[0], { a: true, b: false, off: false })
})
await test('ผูกเจ้าของย้อนหลังเฉพาะคู่ไม่กำกวม (ชื่อตัดช่องว่าง · ชื่อซ้ำ/ไม่มีผู้ยื่น/pending/อนุมัติตัวเอง ไม่ผูก) · รันซ้ำไม่ซ้อน', async () => {
  const r = await rows('SELECT place_id, user_id, registration_id, linked_by FROM public.market_shop_owners ORDER BY place_id')
  assert.deepEqual(r.map(x => [x.place_id, x.user_id, x.registration_id, x.linked_by]),
    [[S1, U.owner, R1, null], [S4, U.owner2, R4, null]])
})

// ── สินค้า: เจ้าของร้าน ────────────────────────────────────────────────────────────────
let P1
await test('เจ้าของเพิ่มสินค้าร้านตัวเองได้ · ระบบตั้ง อปท./ไม่ซ่อน เอง · ตัดช่องว่างชื่อ', async () => {
  await actor('owner')
  const r = await addProduct(S1, '  น้ำพริกตาแดง  ')
  assert.equal(r.municipality_id, A)
  assert.equal(r.is_hidden, false)
  P1 = r.id
  assert.equal((await rows('SELECT name FROM public.market_products WHERE id = $1', [P1]))[0].name, 'น้ำพริกตาแดง')
})
await test('เพิ่มสินค้าร้านคนอื่น / ร้านที่ไม่มีเจ้าของ / ร้านปิดใช้งาน ไม่ได้ · ไม่ติ๊กรับรองไม่ได้', async () => {
  await actor('owner')
  await rejects(addProduct(S2a, 'x'), DENIED)
  await actor('owner2')
  await rejects(addProduct(S1, 'x'), DENIED)
  await rejects(addProduct(S4, 'x'), DENIED) // owner2 เป็นเจ้าของ S4 แต่ร้านปิดใช้งาน
  await actor('owner')
  await rejects(addProduct(S1, 'x', { attest: false }), { code: '23514' })
})
await test('ใส่ municipality_id / is_hidden เองไม่ได้ (column grant)', async () => {
  await actor('owner')
  await rejects(db.query(`INSERT INTO public.market_products (place_id, name, attest_lawful, municipality_id) VALUES ($1, 'x', true, $2)`, [S1, B]), DENIED)
  await rejects(db.query(`INSERT INTO public.market_products (place_id, name, attest_lawful, is_hidden) VALUES ($1, 'x', true, true)`, [S1]), DENIED)
})
await test('รูปรับเฉพาะไฟล์ที่อัปโหลดผ่านระบบ (drive-file / storage สาธารณะ) · ราคาติดลบไม่ได้ · ราคาว่าง = สอบถามราคา ได้', async () => {
  await actor('owner')
  await rejects(addProduct(S1, 'x', { image_url: 'javascript:alert(1)' }), { code: '23514' })
  await rejects(addProduct(S1, 'x', { image_url: 'https://a.b/x" onerror="y' }), { code: '23514' })
  await rejects(addProduct(S1, 'x', { image_url: 'https://example.com/a.jpg' }), { code: '23514' })
  await rejects(addProduct(S1, 'x', { image_url: IMG + '&x=https://evil' }), { code: '23514' })
  await rejects(addProduct(S1, 'x', { image_url: 'https://umxssfahtuprnztlytdd.supabase.co.evil.com/functions/v1/drive-file?id=1' }), { code: '23514' })
  await rejects(addProduct(S1, 'x', { image_url: 'https://umxssfahtuprnztlytdd.supabase.co/storage/v1/object/public/../../../functions/v1/x' }), { code: '23514' })
  await rejects(addProduct(S1, 'x', { image_url: 'https://umxssfahtuprnztlytdd.supabase.co/storage/v1/object/public/a/.hidden' }), { code: '23514' })
  for (const ok of [IMG, 'https://umxssfahtuprnztlytdd.supabase.co/storage/v1/object/public/complaint-attachments/business/a.jpg']) {
    const r = await addProduct(S1, 'รูปถูก', { image_url: ok })
    await db.query('DELETE FROM public.market_products WHERE id = $1', [r.id])
  }
  await rejects(addProduct(S1, 'x', { price: -1 }), { code: '23514' })
  const r = await db.query(`INSERT INTO public.market_products (place_id, name, attest_lawful) VALUES ($1, 'สอบถามราคา', true) RETURNING id`, [S1])
  await db.query('DELETE FROM public.market_products WHERE id = $1', [r.rows[0].id])
})
await test('เจ้าของแก้สินค้าตัวเองได้ · ย้ายร้าน/แก้สถานะซ่อนเองไม่ได้ · คนอื่นแก้ไม่ได้', async () => {
  await actor('owner')
  assert.equal((await db.query('UPDATE public.market_products SET price = 60, is_available = false WHERE id = $1', [P1])).affectedRows, 1)
  await rejects(db.query('UPDATE public.market_products SET place_id = $2 WHERE id = $1', [P1, S2a]), DENIED)
  await rejects(db.query('UPDATE public.market_products SET is_hidden = true WHERE id = $1', [P1]), DENIED)
  for (const who of ['owner2', 'citizen', 'staff', 'admin']) {
    await actor(who)
    assert.equal((await db.query('UPDATE public.market_products SET price = 1 WHERE id = $1', [P1])).affectedRows, 0, who)
  }
  await asRoot()
  assert.equal((await rows('SELECT price FROM public.market_products WHERE id = $1', [P1]))[0].price, '60.00')
})
await test('เพดาน 30 รายการต่อร้าน', async () => {
  await actor('owner')
  for (let i = 2; i <= 30; i++) await addProduct(S1, 'สินค้า ' + i)
  await rejects(addProduct(S1, 'ตัวที่ 31'), { message: /30 รายการ/ })
  await asRoot()
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.market_products WHERE place_id = $1', [S1]))[0].n, 30)
  await db.query(`DELETE FROM public.market_products WHERE place_id = $1 AND name LIKE 'สินค้า %'`, [S1])
})

// ── การอ่าน ────────────────────────────────────────────────────────────────────────
await test('anon/ประชาชน อ่านสินค้าไม่ซ่อนของร้านเปิด อปท. เปิดโมดูล · anon อ่าน hidden_reason ไม่ได้', async () => {
  for (const who of ['anon', 'citizen']) {
    await actor(who)
    assert.deepEqual((await rows('SELECT id FROM public.market_products')).map(x => x.id), [P1], who)
  }
  await actor('anon')
  await rejects(db.query('SELECT hidden_reason FROM public.market_products'), DENIED)
  await rejects(db.query('SELECT * FROM public.market_shop_owners'), DENIED)
})
await test('ปิดโมดูล/ปิดร้าน = สาธารณะไม่เห็น แต่เจ้าของยังเห็นของตัวเอง', async () => {
  await db.query(`UPDATE public.municipalities SET enabled_modules = ARRAY['tourism'] WHERE id = $1`, [A])
  await actor('anon')
  assert.equal((await rows('SELECT id FROM public.market_products')).length, 0)
  await actor('owner')
  assert.equal((await rows('SELECT id FROM public.market_products')).length, 1)
  await rejects(addProduct(S1, 'ระหว่างปิดโมดูล'), DENIED)
  await asRoot()
  await db.query(`UPDATE public.municipalities SET enabled_modules = ARRAY['tourism','local-market'] WHERE id = $1`, [A])
})
await test('เจ้าของร้าน: เห็นแถวผูกของตัวเองเท่านั้น · ประชาชนอื่นไม่เห็น · เจ้าหน้าที่กองที่ถือร้านเห็น', async () => {
  await actor('owner')
  assert.deepEqual((await rows('SELECT place_id FROM public.market_shop_owners')).map(x => x.place_id), [S1])
  await actor('citizen')
  assert.equal((await rows('SELECT * FROM public.market_shop_owners')).length, 0)
  await actor('staff')
  assert.equal((await rows('SELECT * FROM public.market_shop_owners')).length, 2)
  await actor('staffOther')
  assert.equal((await rows('SELECT * FROM public.market_shop_owners')).length, 0)
  await actor('staffSame') // กองเดียวกันแต่ไม่ได้สร้างร้าน — ขอบเขตเท่า policy เดิมของ tourism_places
  assert.equal((await rows('SELECT * FROM public.market_shop_owners')).length, 0)
  await actor('viewer')
  assert.equal((await rows('SELECT * FROM public.market_shop_owners')).length, 0)
  await actor('adminB')
  assert.equal((await rows('SELECT * FROM public.market_shop_owners')).length, 0)
  await actor('owner')
  await rejects(db.query('INSERT INTO public.market_shop_owners (place_id, municipality_id, user_id) VALUES ($1, $2, $3)', [S2a, A, U.owner]), DENIED)
})

// ── ซ่อนสินค้า (เจ้าหน้าที่) ─────────────────────────────────────────────────────────
const hide = (pid, h, reason) => db.query('SELECT public.market_set_product_hidden($1, $2, $3)', [pid, h, reason])
await test('ซ่อนต้องมีเหตุผล · เจ้าหน้าที่กองอื่น/แอดมิน อปท. อื่น/เจ้าของ/viewer ซ่อนไม่ได้', async () => {
  await actor('staff')
  await rejects(hide(P1, true, '  '), { message: /เหตุผล/ })
  for (const who of ['staffOther', 'staffSame', 'adminB', 'owner', 'viewer', 'citizen']) {
    await actor(who)
    await rejects(hide(P1, true, 'x'), DENIED)
  }
  await actor('anon')
  await rejects(hide(P1, true, 'x'), DENIED)
})
await test('เจ้าหน้าที่กองที่ถือร้านซ่อนได้ → สาธารณะไม่เห็น · เจ้าของเห็นพร้อมเหตุผล · ลงสมุดครั้งเดียว (กดซ้ำไม่ลง)', async () => {
  await actor('staff')
  await hide(P1, true, 'รูปไม่ตรงสินค้า')
  await hide(P1, true, 'กดซ้ำ')
  await actor('anon')
  assert.equal((await rows('SELECT id FROM public.market_products')).length, 0)
  await actor('owner')
  const r = await rows('SELECT is_hidden, hidden_reason FROM public.market_products WHERE id = $1', [P1])
  assert.deepEqual(r[0], { is_hidden: true, hidden_reason: 'รูปไม่ตรงสินค้า' })
  // เจ้าของแก้เนื้อหาได้ แต่ยังซ่อนอยู่จนเจ้าหน้าที่เลิกซ่อน
  await db.query(`UPDATE public.market_products SET image_url = $2 WHERE id = $1`, [P1, IMG])
  assert.equal((await rows('SELECT is_hidden FROM public.market_products WHERE id = $1', [P1]))[0].is_hidden, true)
  await actor('admin')
  const log = await rows('SELECT action, reason, actor_id, product_name FROM public.market_product_moderation_log')
  assert.deepEqual(log, [{ action: 'hide', reason: 'รูปไม่ตรงสินค้า', actor_id: U.staff, product_name: 'น้ำพริกตาแดง' }])
})
await test('เลิกซ่อนล้างเหตุผล + ลงสมุด · ประชาชน/เจ้าของอ่านสมุดไม่ได้', async () => {
  await actor('officer')
  await hide(P1, false, null)
  await actor('anon')
  assert.equal((await rows('SELECT id FROM public.market_products')).length, 1)
  await rejects(db.query('SELECT * FROM public.market_product_moderation_log'), DENIED)
  await actor('owner')
  assert.equal((await rows('SELECT hidden_reason FROM public.market_products WHERE id = $1', [P1]))[0].hidden_reason, null)
  assert.equal((await rows('SELECT * FROM public.market_product_moderation_log')).length, 0)
  await actor('adminB')
  assert.equal((await rows('SELECT * FROM public.market_product_moderation_log')).length, 0)
  await actor('super1')
  assert.deepEqual((await rows('SELECT action FROM public.market_product_moderation_log ORDER BY id')).map(x => x.action), ['hide', 'unhide'])
})

// ── ลบ ────────────────────────────────────────────────────────────────────────────
await test('เจ้าของลบสินค้าปกติไม่ลงสมุด · ลบสินค้าที่ถูกซ่อน = ลงสมุด · เจ้าหน้าที่ลบ = ลงสมุด · ประชาชนอื่นลบไม่ได้', async () => {
  await actor('owner')
  const tmp = (await addProduct(S1, 'ลบเอง')).id
  const tmp2 = (await addProduct(S1, 'จนท.ลบ')).id
  assert.equal((await db.query('DELETE FROM public.market_products WHERE id = $1', [tmp])).affectedRows, 1)
  await actor('citizen')
  assert.equal((await db.query('DELETE FROM public.market_products WHERE id = $1', [tmp2])).affectedRows, 0)
  await actor('staffOther')
  assert.equal((await db.query('DELETE FROM public.market_products WHERE id = $1', [tmp2])).affectedRows, 0)
  await actor('staff')
  assert.equal((await db.query('DELETE FROM public.market_products WHERE id = $1', [tmp2])).affectedRows, 1)
  await actor('owner')
  const tmp3 = (await addProduct(S1, 'ถูกซ่อนแล้วลบ')).id
  await actor('staff')
  await hide(tmp3, true, 'ภาพไม่เหมาะสม')
  await actor('owner')
  assert.equal((await db.query('DELETE FROM public.market_products WHERE id = $1', [tmp3])).affectedRows, 1)
  await asRoot()
  assert.deepEqual((await rows('SELECT action, product_name, reason FROM public.market_product_moderation_log ORDER BY id')).map(x => [x.action, x.product_name, x.reason]),
    [['hide', 'น้ำพริกตาแดง', 'รูปไม่ตรงสินค้า'], ['unhide', 'น้ำพริกตาแดง', null], ['delete', 'จนท.ลบ', null],
     ['hide', 'ถูกซ่อนแล้วลบ', 'ภาพไม่เหมาะสม'], ['owner_delete_hidden', 'ถูกซ่อนแล้วลบ', 'ภาพไม่เหมาะสม']])
})

// ── ผูก/ถอดเจ้าของ ──────────────────────────────────────────────────────────────────
const link = (place, reg, replace = false) => db.query('SELECT public.market_link_owner_from_registration($1, $2, $3)', [place, reg, replace])
const ownerLog = () => rows(`SELECT action, place_id, subject_user_id, actor_id FROM public.market_product_moderation_log
  WHERE action IN ('link_owner', 'replace_owner', 'unlink_owner') ORDER BY id`).then(r => r.map(x => [x.action, x.place_id, x.subject_user_id, x.actor_id]))
await test('ผูกเจ้าของ: ต้องดูแลร้านได้ · คำขอต้องอนุมัติโดยคนอื่น อปท. เดียวกัน มีผู้ยื่น · คำขอ 1 ใบ = ร้านเดียว', async () => {
  for (const who of ['citizen', 'owner2', 'staffOther', 'staffSame', 'adminB', 'viewer']) {
    await actor(who)
    await rejects(link(S5, R5), DENIED)
  }
  await actor('staff')
  await rejects(link(S5, RP), { message: /ยังไม่ได้รับอนุมัติ/ })
  await rejects(link(S6, RSELF), { message: /ยังไม่ได้รับอนุมัติ/ }) // ประชาชนตั้ง approved ให้ตัวเอง
  await rejects(link(S9, RALT), { message: /ไม่ใช่ผู้มีสิทธิ์อนุมัติ/ })   // ผู้อนุมัติ = บัญชีประชาชนอีกบัญชี
  await rejects(link(S10, RSTAFF), { message: /ไม่ใช่ผู้มีสิทธิ์อนุมัติ/ }) // staff อนุมัติคำขอไม่ได้ตาม policy
  await rejects(link(S5, RGONE), { message: /ไม่มีบัญชีผู้ยื่น/ })
  await rejects(link(S5, R1), { message: /ผูกกับร้านอื่นอยู่แล้ว/ })
  await actor('super1')
  await rejects(link(SB, R1), { message: /อปท. เดียวกับร้าน/ })
  await actor('staff')
  await link(S5, R5)
  await link(S5, R5) // คู่เดิมซ้ำ ไม่ลงสมุดซ้ำ
  await asRoot()
  const r = await rows('SELECT user_id, registration_id, linked_by FROM public.market_shop_owners WHERE place_id = $1', [S5])
  assert.deepEqual(r[0], { user_id: U.owner2, registration_id: R5, linked_by: U.staff })
  assert.deepEqual(await ownerLog(), [['link_owner', S5, U.owner2, U.staff]])
  await actor('owner2')
  await addProduct(S5, 'ของร้านใหม่')
})
await test('เปลี่ยนเจ้าของต้องยืนยัน (p_replace) + ลงสมุด · ถอดเจ้าของลงสมุด · ถอดแล้วเพิ่มสินค้าไม่ได้ แต่สินค้าเดิมอยู่', async () => {
  await actor('admin')
  await rejects(link(S5, R6), { message: /เจ้าของร้านคนอื่นอยู่แล้ว/ })
  await link(S5, R6, true)
  await actor('owner2')
  await rejects(addProduct(S5, 'หลังถูกเปลี่ยน'), DENIED)
  await actor('admin')
  await db.query('SELECT public.market_unlink_owner($1)', [S5])
  await db.query('SELECT public.market_unlink_owner($1)', [S5]) // ไม่มีเจ้าของแล้ว ไม่ลงซ้ำ
  await actor('citizen')
  await rejects(addProduct(S5, 'หลังถอด'), DENIED)
  await asRoot()
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.market_products WHERE place_id = $1', [S5]))[0].n, 1)
  assert.deepEqual(await ownerLog(), [['link_owner', S5, U.owner2, U.staff], ['replace_owner', S5, U.citizen, U.admin], ['unlink_owner', S5, U.citizen, U.admin]])
  await actor('citizen')
  await rejects(db.query('SELECT public.market_unlink_owner($1)', [S1]), DENIED)
})
await test('รันไฟล์ 2 ซ้ำ: ไม่ผูกเจ้าของที่เจ้าหน้าที่ถอดไปกลับคืน · คำขอที่ผูกร้านอื่นแล้วไม่ทำให้ล้ม (23505)', async () => {
  await actor('staff')
  await db.query('SELECT public.market_unlink_owner($1)', [S4])
  // R7 ชื่อตรงกับ S7 (ไม่กำกวม ไม่มีประวัติ) แต่เจ้าหน้าที่ผูก R7 กับ S8 ไปก่อนแล้ว ⇒ backfill ต้องข้าม ไม่ล้ม
  await asRoot()
  await db.exec(`INSERT INTO public.tourism_places (id, municipality_id, department_id, name, is_active, created_by) VALUES
    ('${S7}', '${A}', '${D1}', 'ร้านเจ็ด', true, '${U.staff}'), ('${S8}', '${A}', '${D1}', 'ร้านแปด', true, '${U.staff}');
    INSERT INTO public.business_registrations VALUES ('${R7}', '${A}', '${U.owner2}', 'ร้านเจ็ด', 'approved', '${U.admin}');`)
  await actor('staff')
  await link(S8, R7)
  await asRoot()
  await db.exec(rlsSql)
  assert.deepEqual((await rows('SELECT place_id FROM public.market_shop_owners ORDER BY place_id')).map(x => x.place_id), [S1, S8])
})

// ── รายการโปรด ──────────────────────────────────────────────────────────────────────
await test('รายการโปรด: บันทึกเอง ระบบตั้ง user/อปท. · เห็นของตัวเองเท่านั้น (เจ้าหน้าที่ไม่เห็น) · ลบเอง', async () => {
  await actor('citizen')
  await db.query('INSERT INTO public.tourism_favorites (place_id) VALUES ($1), ($2)', [S1, SB])
  await rejects(db.query('INSERT INTO public.tourism_favorites (place_id) VALUES ($1)', [S1]), { code: '23505' })
  await rejects(db.query('INSERT INTO public.tourism_favorites (place_id) VALUES ($1)', [S4]), { message: /ไม่พบสถานที่/ })
  await rejects(db.query('INSERT INTO public.tourism_favorites (place_id, user_id) VALUES ($1, $2)', [S2a, U.owner]), DENIED)
  const mine = await rows('SELECT place_id, user_id, municipality_id FROM public.tourism_favorites ORDER BY place_id')
  assert.deepEqual(mine.map(x => [x.place_id, x.user_id, x.municipality_id]), [[S1, U.citizen, A], [SB, U.citizen, B]])
  for (const who of ['owner', 'staff', 'admin', 'super1']) {
    await actor(who)
    assert.equal((await rows('SELECT * FROM public.tourism_favorites')).length, 0, who)
    assert.equal((await db.query('DELETE FROM public.tourism_favorites')).affectedRows, 0, who)
  }
  await actor('citizen')
  await rejects(db.query('UPDATE public.tourism_favorites SET place_id = $1', [S2a]), DENIED)
  assert.equal((await db.query('DELETE FROM public.tourism_favorites WHERE place_id = $1', [SB])).affectedRows, 1)
  await actor('anon')
  await rejects(db.query('INSERT INTO public.tourism_favorites (place_id) VALUES ($1)', [S1]), DENIED)
})
await test('รายการโปรดเพดาน 200', async () => {
  await asRoot()
  const ids = []
  for (let i = 0; i < 200; i++) ids.push(id(1000 + i))
  await db.query(`INSERT INTO public.tourism_places (id, municipality_id, name) SELECT unnest($1::uuid[]), $2, 'p'`, [ids, A])
  await actor('owner')
  await db.query('INSERT INTO public.tourism_favorites (place_id) SELECT unnest($1::uuid[])', [ids])
  await rejects(db.query('INSERT INTO public.tourism_favorites (place_id) VALUES ($1)', [S1]), { message: /200/ })
})

// ── ลบต้นทาง ──────────────────────────────────────────────────────────────────────
await test('ลบบัญชีเจ้าของร้าน = ถอดเจ้าของ (ร้าน/สินค้าอยู่ต่อ) · ลบร้าน = สินค้า/รายการโปรดหายตาม · ลบ อปท. ไม่ล้มเพราะสมุด', async () => {
  await asRoot()
  await db.query('DELETE FROM public.profiles WHERE id = $1', [U.owner])
  await db.query('DELETE FROM auth.users WHERE id = $1', [U.owner])
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.market_shop_owners WHERE place_id = $1', [S1]))[0].n, 0)
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.market_products WHERE place_id = $1', [S1]))[0].n, 1)
  await db.query('DELETE FROM public.tourism_places WHERE id = $1', [S1])
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.market_products WHERE place_id = $1', [S1]))[0].n, 0)
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.tourism_favorites WHERE place_id = $1', [S1]))[0].n, 0)
  // เจ้าหน้าที่ลบ อปท. (มีผู้ใช้ใน session) — สินค้าหายตาม CASCADE ต้องไม่ล้มเพราะสมุดบันทึกอ้าง อปท. ที่กำลังถูกลบ
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [U.super1])
  await db.query('DELETE FROM public.municipalities WHERE id = $1', [A])
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.market_products'))[0].n, 0)
})

console.log(`\n${cases} กรณีผ่าน`)
