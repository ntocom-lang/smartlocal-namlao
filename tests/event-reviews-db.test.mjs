// กิจกรรม: ให้ดาว + ความเห็น (ขั้น 1A) — รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/event-reviews-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: 20261220100000 (ตาราง) → 20261220100100 (RLS/RPC)
//   ตาราง events / get_my_role ไม่มี CREATE ใน migrations (drift) ⇒ สร้างโครงย่อเท่าที่ migration อ้าง
//   นิยาม can_manage_event_department คัดจาก 20260801220558 ตรงตัว
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv.includes('--pglite') ? process.argv[process.argv.indexOf('--pglite') + 1] : process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'Supply --pglite <local module path> หรือตั้ง PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261220100000_event_reviews_tables.sql')
const rlsSql = await readMigration('20261220100100_event_reviews_rls_rpc.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = id(1), B = id(2)
const D1 = id(11), D2 = id(12)
const U = {
  c1: id(101), c2: id(102), c3: id(103), c4: id(104), noname: id(105),
  creator: id(106), staffOther: id(107), head: id(108), headOther: id(109), admin: id(110), adminB: id(111), super1: id(112),
}
// [role, อปท., กอง, หัวหน้ากอง, ชื่อเต็ม] — ชื่อสมมติทั้งหมด
const P = {
  c1: ['citizen', A, null, false, 'นายสมชาย ใจดี'], c2: ['citizen', A, null, false, 'นางสาวสมหญิง เข็มทอง'],
  c3: ['citizen', B, null, false, 'Tom Example'], c4: ['citizen', A, null, false, 'มานี'], noname: ['citizen', A, null, false, null],
  creator: ['staff', A, D1, false, 'เจ้าหน้าที่ หนึ่ง'], staffOther: ['staff', A, D2, false, 'เจ้าหน้าที่ สอง'],
  head: ['officer', A, D1, true, 'หัวหน้า กองหนึ่ง'], headOther: ['officer', A, D2, true, 'หัวหน้า กองสอง'],
  admin: ['admin', A, null, false, 'แอดมิน เอ'], adminB: ['admin', B, null, false, 'แอดมิน บี'], super1: ['superadmin', null, null, false, 'ซุปเปอร์ แอดมิน'],
}
// E_PAST เริ่มเมื่อวาน (กอง D1 ผู้สร้าง creator) · E_TODAY วันนี้ · E_FUT อีก 3 วัน · E_INT ภายใน · E_B อปท. B · E_DEL ไว้ทดสอบลบกิจกรรม
const E_PAST = id(201), E_TODAY = id(202), E_FUT = id(203), E_INT = id(204), E_B = id(205), E_DEL = id(206)

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
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text UNIQUE);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid, department_id uuid, is_dept_head boolean, full_name text);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.can_manage_event_department(p_municipality_id uuid, p_department_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.id = auth.uid() AND p.municipality_id = p_municipality_id
    AND p.department_id = p_department_id AND p_department_id IS NOT NULL AND COALESCE(p.is_dept_head, false));
$$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.can_manage_event_department(uuid, uuid)
  TO anon, authenticated;
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE,
  department_id uuid, created_by uuid, title text NOT NULL, event_date date NOT NULL, end_date date, audiences text[] DEFAULT ARRAY['public']);
INSERT INTO public.municipalities VALUES ('${A}', 'demo'), ('${B}', 'other');
INSERT INTO public.departments VALUES ('${D1}', '${A}'), ('${D2}', '${A}');
`)
for (const [alias, [role, muni, dept, head, name]] of Object.entries(P)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [U[alias]])
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4,$5,$6)', [U[alias], role, muni, dept, head, name])
}
await db.exec(`
INSERT INTO public.events (id, municipality_id, department_id, created_by, title, event_date, end_date, audiences) VALUES
  ('${E_PAST}', '${A}', '${D1}', '${U.creator}', 'งานวัด', (now() AT TIME ZONE 'Asia/Bangkok')::date - 1, (now() AT TIME ZONE 'Asia/Bangkok')::date + 1, ARRAY['public']),
  ('${E_TODAY}', '${A}', '${D2}', '${U.staffOther}', 'ตลาดนัด', (now() AT TIME ZONE 'Asia/Bangkok')::date, NULL, ARRAY['public', 'staff']),
  ('${E_FUT}', '${A}', '${D1}', '${U.creator}', 'วิ่งการกุศล', (now() AT TIME ZONE 'Asia/Bangkok')::date + 3, NULL, ARRAY['public']),
  ('${E_INT}', '${A}', '${D1}', '${U.creator}', 'ประชุมภายใน', (now() AT TIME ZONE 'Asia/Bangkok')::date - 2, NULL, ARRAY['staff']),
  ('${E_B}', '${B}', NULL, NULL, 'งาน อปท. B', (now() AT TIME ZONE 'Asia/Bangkok')::date - 5, NULL, ARRAY['public']),
  ('${E_DEL}', '${A}', '${D1}', '${U.creator}', 'งานที่จะลบ', (now() AT TIME ZONE 'Asia/Bangkok')::date - 5, NULL, ARRAY['public']);
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
const submit = (event, rating, comment = null) =>
  db.query('SELECT public.event_review_submit($1, $2, $3) AS id', [event, rating, comment]).then(r => r.rows[0].id)
const reviewOf = async (event, alias) => (await rows(
  'SELECT * FROM public.event_reviews WHERE event_id = $1 AND user_id = $2', [event, U[alias]]))[0]
const PUBLIC_COLS = 'id, event_id, municipality_id, rating, comment, reviewer_name, created_at, updated_at'

// ── migration ─────────────────────────────────────────────────────────────────────
await test('migration ไฟล์ 2 ปฏิเสธถ้ายังไม่รันไฟล์ 1', async () => {
  await rejects(db.exec(rlsSql), { message: /20261220100000/ })
  await db.exec('ROLLBACK')
})
await db.exec(tablesSql)
await db.exec(rlsSql)
await test('รันทั้ง 2 ไฟล์ซ้ำได้ + ด่านท้ายไฟล์ผ่าน', async () => {
  await db.exec(tablesSql)
  await db.exec(rlsSql)
})

// ── ชื่อที่แสดง ──────────────────────────────────────────────────────────────────────
await test('ชื่อที่แสดง = ชื่อ + อักษรแรกนามสกุล (ตัดคำนำหน้า · สระหน้าเอา 2 ตัว)', async () => {
  const cases = [
    ['นายสมชาย ใจดี', 'สมชาย ใจ.'], ['นางสาวสมหญิง เข็มทอง', 'สมหญิง เข.'], ['นางมาลี ศรีสุข', 'มาลี ศ.'],
    ['ด.ช. ก้อง ภพ', 'ก้อง ภ.'], ['  มานี  ', 'มานี'], ['', 'ผู้ใช้งาน'], [null, 'ผู้ใช้งาน'], ['นาย', 'ผู้ใช้งาน'],
    ['Tom Example', 'Tom E.'], ['สมศักดิ์   ทองดี  มีสุข', 'สมศักดิ์ ท.'],
    // ตั้งเบอร์โทร/อีเมลเป็นชื่อ = ห้ามขึ้นหน้าสาธารณะ (ผลตรวจ migration-reviewer)
    ['0812345678', 'ผู้ใช้งาน'], ['นายสมชาย 081-234-5678', 'ผู้ใช้งาน'], ['somchai@example.com', 'ผู้ใช้งาน'], ['๐๘๑๒๓๔๕๖๗๘', 'ผู้ใช้งาน'],
  ]
  for (const [input, expected] of cases) {
    const [r] = await rows('SELECT public.event_reviewer_display_name($1) AS n', [input])
    assert.equal(r.n, expected, `ชื่อ "${input}"`)
  }
})

// ── ให้ดาว ───────────────────────────────────────────────────────────────────────────
await test('ผู้ไม่ล็อกอินให้ดาวไม่ได้ · เขียนตารางตรงไม่ได้ทุกบทบาท', async () => {
  await actor('anon')
  await rejects(submit(E_PAST, 5), DENIED)
  await rejects(db.query(`INSERT INTO public.event_reviews (event_id, municipality_id, user_id, rating, reviewer_name)
    VALUES ($1, $2, $3, 5, 'x')`, [E_PAST, A, U.c1]), DENIED)
  await actor('c1')
  await rejects(db.query(`INSERT INTO public.event_reviews (event_id, municipality_id, user_id, rating, reviewer_name)
    VALUES ($1, $2, $3, 5, 'x')`, [E_PAST, A, U.c1]), DENIED)
  await actor('admin')
  await rejects(db.query('UPDATE public.event_reviews SET is_hidden = false'), DENIED)
  await rejects(db.query('DELETE FROM public.event_reviews'), DENIED)
  await rejects(db.query('INSERT INTO public.event_review_moderation_log (municipality_id, event_id, review_id, action) VALUES ($1,$2,$2,$3)',
    [A, E_PAST, 'hide']), DENIED)
})

await test('ประชาชนให้ดาวกิจกรรมสาธารณะที่เริ่มแล้ว — ระบบตั้งชื่อ/อปท./ผู้รีวิวเอง', async () => {
  await actor('c1')
  const rid = await submit(E_PAST, 4, '  สนุกมาก  ')
  await asRoot()
  const r = await reviewOf(E_PAST, 'c1')
  assert.equal(r.id, rid)
  assert.equal(r.municipality_id, A)
  assert.equal(r.reviewer_name, 'สมชาย ใจ.')
  assert.equal(r.comment, 'สนุกมาก')
  assert.equal(r.is_hidden, false)
})

await test('ให้ดาวซ้ำ = แก้แถวเดิม (1 คน 1 รีวิว) · ความเห็นช่องว่าง = ไม่มีความเห็น', async () => {
  await actor('c1')
  const rid = await submit(E_PAST, 2, '   ')
  await asRoot()
  const all = await rows('SELECT id, rating, comment FROM public.event_reviews WHERE event_id = $1 AND user_id = $2', [E_PAST, U.c1])
  assert.equal(all.length, 1)
  assert.deepEqual(all[0], { id: rid, rating: 2, comment: null })
})

await test('วันเริ่มกิจกรรม (วันนี้) ให้ดาวได้ · ยังไม่ถึงวัน / กิจกรรมภายใน / ไม่มีกิจกรรม ให้ไม่ได้', async () => {
  await actor('c2')
  await submit(E_TODAY, 5)
  await rejects(submit(E_FUT, 5), { message: /ตั้งแต่วันที่กิจกรรมเริ่ม/ })
  await rejects(submit(E_INT, 5), { message: /ไม่พบกิจกรรมนี้/ })
  await rejects(submit(id(999), 5), { message: /ไม่พบกิจกรรมนี้/ })
  // กิจกรรมเก่าที่ไม่มี อปท. = ไม่รับ (ข้อความไทย ไม่ใช่ 23502 ภาษาอังกฤษ)
  await asRoot()
  await db.query(`INSERT INTO public.events (id, municipality_id, title, event_date, audiences)
    VALUES ($1, NULL, 'ไม่มี อปท.', (now() AT TIME ZONE 'Asia/Bangkok')::date - 1, ARRAY['public'])`, [id(207)])
  await actor('c2')
  await rejects(submit(id(207), 5), { message: /ไม่พบกิจกรรมนี้/ })
  // บุคลากรภายในอ่านกิจกรรมภายในได้ แต่ก็ให้ดาวไม่ได้
  await actor('creator')
  await rejects(submit(E_INT, 5), { message: /ไม่พบกิจกรรมนี้/ })
})

await test('ผู้ดูแลกิจกรรมให้ดาวงานตัวเองไม่ได้ (กันผลประโยชน์ทับซ้อน) · เจ้าหน้าที่ที่ไม่ได้ดูแลกิจกรรมนั้นให้ได้', async () => {
  for (const who of ['creator', 'head', 'admin', 'super1']) {
    await actor(who)
    await rejects(submit(E_PAST, 5), { message: /ผู้ดูแลกิจกรรมนี้ให้ดาว/ })
  }
  await actor('staffOther') // ผู้สร้าง E_TODAY
  await rejects(submit(E_TODAY, 5), { message: /ผู้ดูแลกิจกรรมนี้ให้ดาว/ })
  await actor('adminB')
  await rejects(submit(E_B, 5), { message: /ผู้ดูแลกิจกรรมนี้ให้ดาว/ })
  await actor('staffOther') // ไม่ได้ดูแล E_B (คนละ อปท.) = ให้ได้เหมือนประชาชน
  await submit(E_B, 4)
  await asRoot()
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.event_reviews WHERE event_id = $1', [E_B]))[0].n, 1)
})

await test('ดาวต้อง 1–5 · ความเห็นเกิน 300 ตัวอักษรไม่รับ (ภาษาไทยนับตามตัวอักษร)', async () => {
  await actor('c2')
  await rejects(submit(E_PAST, 0), { message: /1–5/ })
  await rejects(submit(E_PAST, 6), { message: /1–5/ })
  await rejects(submit(E_PAST, null), { message: /1–5/ })
  await rejects(submit(E_PAST, 3, 'ก'.repeat(301)), { message: /300/ })
  await submit(E_PAST, 3, 'ก'.repeat(300))
})

await test('ผู้ใช้ อปท. อื่นให้ดาวกิจกรรมสาธารณะได้ — แถวผูก อปท. ของกิจกรรม ไม่ใช่ของผู้รีวิว · ไม่มีชื่อ = "ผู้ใช้งาน"', async () => {
  await actor('c3')
  await submit(E_PAST, 5, 'มาเที่ยว')
  await actor('noname')
  await submit(E_PAST, 1)
  await asRoot()
  assert.equal((await reviewOf(E_PAST, 'c3')).municipality_id, A)
  assert.equal((await reviewOf(E_PAST, 'noname')).reviewer_name, 'ผู้ใช้งาน')
})

// ── อ่าน ────────────────────────────────────────────────────────────────────────────
await test('anon / ผู้ล็อกอินอ่านรีวิวได้เฉพาะคอลัมน์สาธารณะ — user_id อ่านไม่ได้ทุกบทบาท', async () => {
  for (const who of ['anon', 'c1', 'admin', 'super1']) {
    await actor(who)
    const r = await rows(`SELECT ${PUBLIC_COLS} FROM public.event_reviews WHERE event_id = $1`, [E_PAST])
    assert.equal(r.length, 4, who)
    await rejects(db.query('SELECT user_id FROM public.event_reviews'), DENIED)
    await rejects(db.query('SELECT * FROM public.event_reviews'), DENIED)
  }
  await actor('anon')
  await rejects(db.query('SELECT is_hidden FROM public.event_reviews'), DENIED)
  await rejects(db.query('SELECT hidden_reason FROM public.event_reviews'), DENIED)
  await rejects(db.query('SELECT * FROM public.event_review_moderation_log'), DENIED)
})

await test('event_my_review คืนเฉพาะของตัวเอง · anon เรียกไม่ได้', async () => {
  await actor('c1')
  const mine = await rows('SELECT * FROM public.event_my_review($1)', [E_PAST])
  assert.equal(mine.length, 1)
  assert.equal(mine[0].rating, 2)
  assert.equal('user_id' in mine[0], false)
  assert.equal((await rows('SELECT * FROM public.event_my_review($1)', [E_TODAY])).length, 0)
  await actor('anon')
  await rejects(db.query('SELECT * FROM public.event_my_review($1)', [E_PAST]), DENIED)
})

await test('สรุปดาว: ค่าเฉลี่ยขึ้นเมื่อ ≥3 คน · anon เรียกได้ · กิจกรรมภายในไม่คืน · เกิน 500 ไม่รับ', async () => {
  await actor('anon')
  const s = await rows('SELECT * FROM public.event_review_summary($1) ORDER BY event_id', [[E_PAST, E_TODAY, E_INT, E_FUT]])
  // E_PAST: c1=2, c2=3, c3=5, noname=1 → 4 คน เฉลี่ย 2.75 → 2.8 · E_TODAY: 1 คน → ไม่มีค่าเฉลี่ย
  assert.deepEqual(s.map(x => [x.event_id, x.review_count, x.avg_rating === null ? null : Number(x.avg_rating)]),
    [[E_PAST, 4, 2.8], [E_TODAY, 1, null]])
  assert.equal((await rows('SELECT * FROM public.event_review_summary($1)', [[]])).length, 0)
  const many = Array.from({ length: 501 }, (_, i) => id(5000 + i))
  await rejects(db.query('SELECT * FROM public.event_review_summary($1)', [many]), { message: /500/ })
})

// ── ซ่อน ────────────────────────────────────────────────────────────────────────────
const c1Review = async () => (await asRoot(), (await reviewOf(E_PAST, 'c1')).id)

await test('ผู้ไม่มีสิทธิ์ซ่อนไม่ได้: ประชาชน · เจ้าหน้าที่กองอื่น · หัวหน้ากองอื่น · แอดมิน อปท. อื่น · anon', async () => {
  const rid = await c1Review()
  for (const who of ['c1', 'c2', 'staffOther', 'headOther', 'adminB']) {
    await actor(who)
    await rejects(db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, 'ไม่เหมาะสม']), DENIED)
  }
  await actor('anon')
  await rejects(db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, 'ไม่เหมาะสม']), DENIED)
  await asRoot()
  assert.equal((await reviewOf(E_PAST, 'c1')).is_hidden, false)
})

await test('ผู้สร้างกิจกรรมซ่อนได้ · ต้องมีเหตุผล · ลงสมุดพร้อมสำเนา · กดซ้ำไม่ลงซ้ำ', async () => {
  const rid = await c1Review()
  await actor('creator')
  await rejects(db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, '  ']), { message: /เหตุผล/ })
  await rejects(db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, 'ก'.repeat(301)]), { message: /300/ })
  await db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, 'ถ้อยคำไม่สุภาพ'])
  await db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, 'ถ้อยคำไม่สุภาพ'])
  await asRoot()
  const r = await reviewOf(E_PAST, 'c1')
  assert.deepEqual([r.is_hidden, r.hidden_reason], [true, 'ถ้อยคำไม่สุภาพ'])
  const log = await rows('SELECT action, rating_snapshot, comment_snapshot, reason, actor_id FROM public.event_review_moderation_log WHERE review_id = $1', [rid])
  assert.deepEqual(log, [{ action: 'hide', rating_snapshot: 2, comment_snapshot: null, reason: 'ถ้อยคำไม่สุภาพ', actor_id: U.creator }])
})

await test('รีวิวที่ซ่อน: หายจากหน้าสาธารณะ + สรุปดาว · ผู้ดูแลยังเห็น · เจ้าหน้าที่อื่นไม่เห็น', async () => {
  await actor('anon')
  assert.equal((await rows(`SELECT ${PUBLIC_COLS} FROM public.event_reviews WHERE event_id = $1`, [E_PAST])).length, 3)
  const [s] = await rows('SELECT * FROM public.event_review_summary($1)', [[E_PAST]])
  assert.equal(s.review_count, 3)
  for (const who of ['creator', 'head', 'admin', 'super1']) {
    await actor(who)
    const r = await rows(`SELECT ${PUBLIC_COLS}, is_hidden, hidden_reason FROM public.event_reviews WHERE event_id = $1 AND is_hidden`, [E_PAST])
    assert.equal(r.length, 1, who)
    assert.equal(r[0].hidden_reason, 'ถ้อยคำไม่สุภาพ')
  }
  for (const who of ['staffOther', 'headOther', 'adminB', 'c2']) {
    await actor(who)
    assert.equal((await rows('SELECT id FROM public.event_reviews WHERE event_id = $1 AND is_hidden', [E_PAST])).length, 0, who)
  }
})

await test('ผู้เขียนเห็นว่าถูกซ่อน + เหตุผล · แก้ข้อความแล้วยังซ่อนอยู่', async () => {
  await actor('c1')
  const [mine] = await rows('SELECT is_hidden, hidden_reason FROM public.event_my_review($1)', [E_PAST])
  assert.deepEqual(mine, { is_hidden: true, hidden_reason: 'ถ้อยคำไม่สุภาพ' })
  await submit(E_PAST, 3, 'ขอโทษครับ')
  await asRoot()
  const r = await reviewOf(E_PAST, 'c1')
  assert.deepEqual([r.is_hidden, r.rating, r.comment], [true, 3, 'ขอโทษครับ'])
})

await test('หัวหน้ากองที่ถือกิจกรรม / แอดมิน / superadmin ซ่อน-เลิกซ่อนได้ · เลิกซ่อนล้างเหตุผล + ลงสมุด', async () => {
  const rid = await c1Review()
  await actor('head')
  await db.query('SELECT public.event_set_review_hidden($1, false)', [rid])
  await asRoot()
  assert.deepEqual(await reviewOf(E_PAST, 'c1').then(r => [r.is_hidden, r.hidden_reason]), [false, null])
  await actor('admin')
  await db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, 'สแปม'])
  await actor('super1')
  await db.query('SELECT public.event_set_review_hidden($1, false, NULL)', [rid])
  await asRoot()
  const log = await rows('SELECT action, actor_id, comment_snapshot FROM public.event_review_moderation_log WHERE review_id = $1 ORDER BY id', [rid])
  assert.deepEqual(log.map(x => [x.action, x.actor_id]),
    [['hide', U.creator], ['unhide', U.head], ['hide', U.admin], ['unhide', U.super1]])
  assert.equal(log[1].comment_snapshot, 'ขอโทษครับ') // สำเนา ณ ตอนเลิกซ่อน = ข้อความที่แก้แล้ว
})

await test('สมุดบันทึก: ผู้ดูแล + แอดมิน อปท. อ่านได้ · ประชาชน / อปท. อื่น / กองอื่นไม่เห็น', async () => {
  for (const [who, n] of [['creator', 4], ['head', 4], ['admin', 4], ['super1', 4], ['c1', 0], ['adminB', 0], ['staffOther', 0]]) {
    await actor(who)
    assert.equal((await rows('SELECT id FROM public.event_review_moderation_log')).length, n, who)
  }
  // actor_id ไม่เปิดให้ผู้ล็อกอินทุกบทบาท — แถว author_delete_hidden เก็บ uuid ของผู้รีวิว (PDPA · ผลตรวจ migration-reviewer)
  for (const who of ['creator', 'admin', 'super1', 'c1']) {
    await actor(who)
    await rejects(db.query('SELECT actor_id FROM public.event_review_moderation_log'), DENIED)
    await rejects(db.query('SELECT * FROM public.event_review_moderation_log'), DENIED)
  }
})

// ── ลบ ──────────────────────────────────────────────────────────────────────────────
await test('ลบรีวิวตัวเอง: ปกติไม่ลงสมุด · ที่ถูกซ่อนลงสมุด author_delete_hidden · ลบของคนอื่นไม่ได้', async () => {
  await actor('c2')
  await db.query('SELECT public.event_review_delete_mine($1)', [E_TODAY])
  await asRoot()
  assert.equal(await reviewOf(E_TODAY, 'c2'), undefined)
  assert.equal((await rows("SELECT id FROM public.event_review_moderation_log WHERE event_id = $1", [E_TODAY])).length, 0)

  const rid = (await reviewOf(E_PAST, 'c3')).id
  await actor('admin')
  await db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, 'ข้อมูลเท็จ'])
  await actor('c1') // ลบได้เฉพาะของตัวเอง — แถวของ c3 ต้องอยู่
  await db.query('SELECT public.event_review_delete_mine($1)', [id(999)])
  await actor('c3')
  await db.query('SELECT public.event_review_delete_mine($1)', [E_PAST])
  await asRoot()
  assert.equal(await reviewOf(E_PAST, 'c3'), undefined)
  const [lg] = await rows("SELECT action, rating_snapshot, comment_snapshot, reason, actor_id FROM public.event_review_moderation_log WHERE review_id = $1 AND action = 'author_delete_hidden'", [rid])
  assert.deepEqual(lg, { action: 'author_delete_hidden', rating_snapshot: 5, comment_snapshot: 'มาเที่ยว', reason: 'ข้อมูลเท็จ', actor_id: U.c3 })
  await actor('anon')
  await rejects(db.query('SELECT public.event_review_delete_mine($1)', [E_PAST]), DENIED)
})

await test('ลบกิจกรรม = รีวิวหายตาม · สมุดบันทึกอยู่ต่อ (แอดมินยังอ่านได้)', async () => {
  await actor('c4')
  const rid = await submit(E_DEL, 4, 'ดี')
  await actor('creator')
  await db.query('SELECT public.event_set_review_hidden($1, true, $2)', [rid, 'ทดสอบ'])
  await asRoot()
  await db.query('DELETE FROM public.events WHERE id = $1', [E_DEL])
  assert.equal((await rows('SELECT id FROM public.event_reviews WHERE event_id = $1', [E_DEL])).length, 0)
  await actor('admin')
  assert.equal((await rows('SELECT id FROM public.event_review_moderation_log WHERE event_id = $1', [E_DEL])).length, 1)
  await actor('creator') // กิจกรรมหายแล้ว ผู้สร้างไม่ใช่ผู้ดูแลอีก
  assert.equal((await rows('SELECT id FROM public.event_review_moderation_log WHERE event_id = $1', [E_DEL])).length, 0)
})

await test('ฟังก์ชันภายในเรียกตรงไม่ได้ (anon: can_moderate · ผู้ล็อกอิน: display_name)', async () => {
  await actor('anon')
  await rejects(db.query('SELECT public.event_can_moderate($1)', [E_PAST]), DENIED)
  assert.equal((await rows('SELECT public.event_is_public($1) AS p', [E_INT]))[0].p, false)
  await actor('c1')
  await rejects(db.query("SELECT public.event_reviewer_display_name('ก ข')"), DENIED)
})

console.log(`\nevent-reviews-db: ผ่าน ${cases} กรณี`)
