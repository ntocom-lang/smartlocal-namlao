// ลิงก์ติดตามเรื่องของผู้แจ้ง — supabase/migrations/20261020160000_complaint_track_token_column.sql + 20261020160100_..._functions.sql
//   node tests/complaint-track-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// รัน migration จริงใน PostgreSQL จำลอง (PGlite) พร้อมฟังก์ชันจริงที่ตัวใหม่พึ่ง/ต้องเหมือน (rate_complaint, reopen_complaint,
// rpc_rate_limit_hit) ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง (ติดตั้ง PGlite: npm install --prefix <temp> @electric-sql/pglite@0.5.8)
//
// สิ่งที่ต้องไม่พัง: (1) โทเคนทุกแถวไม่ซ้ำ รูปแบบถูก และคำร้องเดิมได้โทเคนตอน ADD COLUMN (2) ผู้ถือลิงก์ไม่เห็นข้อมูลส่วนบุคคลเด็ดขาด
// — ชื่อ เบอร์ พิกัด รายละเอียด id ชื่อเจ้าหน้าที่ หมายเหตุในไทม์ไลน์ (3) ผู้มีตำแหน่งให้คะแนน/แจ้งกลับแทนผู้แจ้งไม่ได้
// (4) แจ้งกลับผ่านลิงก์ให้ผลเหมือน reopen_complaint() ตัวจริงทุกจุด (5) โทเคนผิด/ผิด อปท. ตอบเหมือนกันหมด ไม่ใบ้อะไร
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const rateLimitSql = await readMigration('20260905170000_rpc_rate_limit.sql')
const rateComplaintSrc = await readMigration('20260830150000_rate_complaint_rpc.sql')
const finishSrc = await readMigration('20260915110100_complaint_finish_by_assignee.sql')
const columnSql = await readMigration('20261020160000_complaint_track_token_column.sql')
const functionsSql = await readMigration('20261020160100_complaint_track_token_functions.sql')

// ดึงฟังก์ชันตัวจริงออกจาก migration เดิมทั้งตัว (ไม่พิมพ์ซ้ำเอง) — ถ้าตัวจริงเปลี่ยน เทสต์นี้เปลี่ยนตามและเทียบพฤติกรรมให้
const extractFunction = (source, startPattern) => {
  const found = startPattern.exec(source)
  assert.ok(found, `ไม่พบฟังก์ชันที่ขึ้นต้นด้วย ${startPattern}`)
  const rest = source.slice(found.index)
  const end = rest.search(/\n\$\$;/)
  assert.ok(end > 0, 'ไม่พบ $$; ปิดฟังก์ชัน')
  return rest.slice(0, end + 4)
}
const rateComplaintFn = extractFunction(rateComplaintSrc, /create or replace function public\.rate_complaint\(/i)
const reopenFn = extractFunction(finishSrc, /CREATE OR REPLACE FUNCTION public\.reopen_complaint\(/)

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- ตัวตนผู้เรียกกำหนดผ่านตัวแปร session (แทน JWT ของ Supabase)
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, role text, municipality_id uuid);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.role', true), '') $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.muni', true), '')::uuid $$;
CREATE TABLE public.complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, value text, label text,
  is_active boolean DEFAULT true, sort_order int DEFAULT 0, is_adhoc boolean NOT NULL DEFAULT false
);
-- เหมือน 20260827120000_restrict_odor_adhoc_visibility.sql ทุกบรรทัด (ฟังก์ชัน SQL ตัวเดียวที่ไม่คุ้มดึงทั้งไฟล์)
CREATE FUNCTION public.complaint_category_is_adhoc(p_municipality_id uuid, p_category text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT cc.is_adhoc FROM public.complaint_categories cc WHERE cc.municipality_id = p_municipality_id AND cc.value = p_category), false)
$$;
-- คอลัมน์เท่าที่ฟังก์ชันเหล่านี้แตะ (ไม่มี track_token: ใช้ทดสอบ ADD COLUMN ที่ต้องเติมโทเคนให้แถวเดิมด้วย)
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, user_id uuid, ref_no text,
  category text, category_id uuid, status text DEFAULT 'pending', village text, detail text, phone text, reporter_name text,
  latitude double precision, longitude double precision, assigned_to uuid, due_date date, closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), technician_note text, rejection_reason text,
  extra_data jsonb, resolved_latitude double precision, resolved_longitude double precision, resolved_by uuid,
  rating smallint, rated_at timestamptz
);
CREATE TABLE public.complaint_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  status text NOT NULL, note text, actor_name text, created_at timestamptz NOT NULL DEFAULT now()
);
-- ตารางคะแนนเหมือน 072 + คอลัมน์จาก 20260830150000 (ส่วน policy/trigger ไม่เกี่ยว: ฟังก์ชันทุกตัวเป็น SECURITY DEFINER)
CREATE TABLE public.satisfaction_ratings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, municipality_id uuid, rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text, created_at timestamptz DEFAULT now(),
  complaint_id uuid REFERENCES public.complaints(id) ON DELETE SET NULL,
  is_verified boolean NOT NULL DEFAULT false, created_by uuid
);
CREATE UNIQUE INDEX satisfaction_ratings_complaint_once ON public.satisfaction_ratings (complaint_id, is_verified);
INSERT INTO public.municipalities VALUES ('${A}', 'อปท. เอ'), ('${B}', 'อปท. บี');
INSERT INTO public.complaint_categories (municipality_id, value, label, is_adhoc) VALUES
  ('${A}', 'light', 'ไฟฟ้าสาธารณะ', false), ('${A}', 'odor', 'กลิ่นเหม็นรบกวน', true), ('${B}', 'light', 'ไฟฟ้าสาธารณะ (บี)', false);
`)

// คำร้องเดิมที่มีอยู่ก่อน migration — ต้องได้โทเคนตอน ADD COLUMN
for (let i = 1; i <= 5; i++) {
  await db.query(`INSERT INTO public.complaints (municipality_id, category, ref_no, status) VALUES ($1, 'light', $2, 'closed')`, [A, `LEGACY-${i}`])
}
await db.exec(rateLimitSql)
await db.exec(rateComplaintFn)
await db.exec(reopenFn)
await db.exec(columnSql)
await db.exec(functionsSql)

const users = { admin: U(1), officer: U(2), staff: U(3), viewer: U(4), council: U(5), technician: U(6), citizen: U(7), citizen2: U(8), adminB: U(9), superadmin: U(10), assignee: U(11) }
const roleOf = alias => (alias === 'adminB' ? 'admin' : alias === 'citizen2' ? 'citizen' : alias === 'assignee' ? 'officer' : alias)
const muniOf = alias => (alias === 'adminB' ? B : alias === 'superadmin' ? null : A)
for (const [alias, id] of Object.entries(users)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [id])
  await db.query('INSERT INTO public.profiles VALUES ($1, $2, $3, $4)', [id, `ผู้ใช้ ${alias}`, roleOf(alias), muniOf(alias)])
}
const as = async alias => {
  const anon = alias === 'anon'
  await db.query("SELECT set_config('test.uid', $1, false), set_config('test.role', $2, false), set_config('test.muni', $3, false), set_config('request.headers', '', false)",
    [anon ? '' : users[alias], anon ? '' : roleOf(alias), anon ? '' : (muniOf(alias) ?? '')])
}

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const MARK_DETAIL = 'ลับ-รายละเอียด-บ้านเลขที่-99/9'
const MARK_PHONE = '0812345678'
const MARK_NAME = 'นายลับ ใจดี'
const MARK_NOTE = 'ลับ-หมายเหตุภายใน-คุณสมชาย'
const MARK_ACTOR = 'เจ้าหน้าที่ลับ'

// สร้างคำร้องหนึ่งใบ คืน { id, token }
const make = async ({ muni = A, owner = null, status = 'pending', category = 'light', closedAgo = null, assignee = null, note = null, extra = null, rejection = null } = {}) => {
  const { rows } = await db.query(
    `INSERT INTO public.complaints (municipality_id, user_id, ref_no, category, status, village, detail, phone, reporter_name,
        latitude, longitude, assigned_to, due_date, closed_at, technician_note, rejection_reason, extra_data)
     VALUES ($1, $2, 'ES-69-' || lpad((floor(random()*9000)+1000)::int::text, 4, '0'), $3, $4, 'หมู่ 3', $5, $6, $7, 18.25, 100.34, $8,
        current_date + 2, ${closedAgo === null ? 'NULL' : `now() - interval '${closedAgo}'`}, $9, $10, $11)
     RETURNING id, track_token`,
    [muni, owner ? users[owner] : null, category, status, MARK_DETAIL, MARK_PHONE, MARK_NAME, assignee ? users[assignee] : null, note, rejection, extra ? JSON.stringify(extra) : null])
  const { id, track_token: token } = rows[0]
  await db.query(`INSERT INTO public.complaint_timeline (complaint_id, status, note, actor_name) VALUES ($1, 'received', $2, $3)`, [id, MARK_NOTE, MARK_ACTOR])
  return { id, token }
}
const view = (token, muni = A) => db.query('SELECT public.get_complaint_by_track_token($1, $2) AS r', [token, muni]).then(r => r.rows[0].r)
const rate = (token, rating, comment = null, muni = A) => db.query('SELECT public.rate_complaint_by_track_token($1, $2, $3, $4) AS r', [token, muni, rating, comment]).then(r => r.rows[0].r)
const reopen = (token, reason, muni = A) => db.query('SELECT public.reopen_complaint_by_track_token($1, $2, $3) AS r', [token, muni, reason]).then(r => r.rows[0].r)
const getToken = id => db.query('SELECT public.get_complaint_track_token($1) AS t', [id]).then(r => r.rows[0].t)
const row = async id => (await db.query('SELECT * FROM public.complaints WHERE id = $1', [id])).rows[0]
const expectError = async (promise, code) => {
  await assert.rejects(promise, error => { assert.equal(error.code, code, `รหัสผิด: ${error.code} / ${error.message}`); return true })
}

await test('ADD COLUMN เติมโทเคนให้คำร้องเดิมทุกแถว ไม่ซ้ำ และรูปแบบถูก', async () => {
  const { rows } = await db.query(`SELECT count(*)::int AS n, count(DISTINCT track_token)::int AS d, bool_and(track_token ~ '^[0-9a-f]{32}$') AS ok FROM public.complaints WHERE ref_no LIKE 'LEGACY-%'`)
  assert.deepEqual(rows[0], { n: 5, d: 5, ok: true })
})

await test('คำร้องใหม่ที่ไม่ระบุโทเคนได้โทเคนเอง (ฟังก์ชันยื่นคำร้องเดิมไม่ต้องแก้) · รูปแบบเสีย/ซ้ำถูกปฏิเสธ', async () => {
  const a = await make()
  const b = await make()
  assert.match(a.token, /^[0-9a-f]{32}$/)
  assert.notEqual(a.token, b.token)
  await assert.rejects(db.query(`UPDATE public.complaints SET track_token = 'ABC' WHERE id = $1`, [a.id]), error => error.code === '23514')
  await assert.rejects(db.query(`UPDATE public.complaints SET track_token = $1 WHERE id = $2`, [b.token, a.id]), error => error.code === '23505')
})

await test('get_complaint_track_token: ผู้ยื่นและผู้มีตำแหน่ง อปท. เดียวกันได้ · ที่เหลือ/ไม่ล็อกอินได้ NULL', async () => {
  const c = await make({ owner: 'citizen' })
  const expected = (await row(c.id)).track_token
  for (const [alias, ok] of [['citizen', true], ['staff', true], ['officer', true], ['admin', true], ['viewer', true], ['council', true], ['technician', true],
    ['citizen2', false], ['adminB', false], ['superadmin', false], ['anon', false]]) {
    await as(alias)
    assert.equal(await getToken(c.id), ok ? expected : null, `${alias}`)
  }
  await as('staff')
  assert.equal(await getToken('00000000-0000-4000-8000-0000000000ff'), null, 'ไม่พบเรื่อง = NULL ไม่ raise')
  await as('anon')
})

await test('โทเคนผิดรูป / ไม่มี / ผิด อปท. / null ตอบ {found:false} เหมือนกันทุกกรณี (ไม่ใบ้)', async () => {
  const c = await make()
  const notFound = { found: false }
  assert.deepEqual(await view('x'), notFound)
  assert.deepEqual(await view(c.token.toUpperCase()), notFound)
  assert.deepEqual(await view('0'.repeat(32)), notFound)
  assert.deepEqual(await view(c.token, B), notFound)
  assert.deepEqual(await view(c.token, null), notFound)
  assert.deepEqual(await view(null), notFound)
  assert.equal((await view(c.token)).found, true)
})

await test('ผู้ถือลิงก์ไม่เห็นข้อมูลส่วนบุคคล: เทียบรายการคีย์ + ค้นข้อความลับทั้งก้อน', async () => {
  const c = await make({ owner: 'council', assignee: 'assignee', status: 'closed', closedAgo: '1 day', note: 'เปลี่ยนหลอดไฟแล้ว' })
  const result = await view(c.token)
  assert.deepEqual(Object.keys(result).sort(), [
    'can_reopen', 'can_rate', 'category', 'category_label', 'closed_at', 'created_at', 'due_date', 'found', 'is_adhoc', 'rated',
    'ref_no', 'reject_reason', 'reopen_days_left', 'reopened', 'result_note', 'server_now', 'status', 'timeline', 'village', 'viewer',
  ].sort())
  const dump = JSON.stringify(result)
  for (const secret of [MARK_DETAIL, MARK_PHONE, MARK_NAME, MARK_NOTE, MARK_ACTOR, users.council, users.assignee, c.id, '18.25', '100.34'])
    assert.ok(!dump.includes(secret), `ข้อมูลลับหลุดออกมา: ${secret}`)
  assert.deepEqual(Object.keys(result.timeline[0]).sort(), ['at', 'status'])
  assert.equal(result.category_label, 'ไฟฟ้าสาธารณะ')
  assert.equal(result.village, 'หมู่ 3')
  assert.equal(result.result_note, 'เปลี่ยนหลอดไฟแล้ว')
})

await test('บันทึกผลของเจ้าหน้าที่แสดงเฉพาะเมื่อดำเนินการแล้ว · เหตุผลปฏิเสธแสดงเฉพาะเรื่องที่ถูกปฏิเสธ', async () => {
  const working = await make({ status: 'in_progress', note: 'ร่างบันทึกระหว่างทำ', rejection: 'ไม่เกี่ยว' })
  const r1 = await view(working.token)
  assert.equal(r1.result_note, null)
  assert.equal(r1.reject_reason, null)
  const rejected = await make({ status: 'rejected', rejection: 'อยู่นอกเขตพื้นที่' })
  assert.equal((await view(rejected.token)).reject_reason, 'อยู่นอกเขตพื้นที่')
})

await test('can_rate / can_reopen: เฉพาะเรื่องที่ดำเนินการแล้ว · เกิน 7 วัน · เคยแจ้งกลับแล้ว · หมวดเฉพาะกิจ · ขั้นเก่า done', async () => {
  const pending = await view((await make()).token)
  assert.equal(pending.can_rate, false); assert.equal(pending.can_reopen, false)
  const fresh = await view((await make({ status: 'closed', closedAgo: '1 hour' })).token)
  assert.equal(fresh.can_rate, true); assert.equal(fresh.can_reopen, true); assert.equal(fresh.reopen_days_left, 7)
  const day6 = await view((await make({ status: 'closed', closedAgo: '6 days 12 hours' })).token)
  assert.equal(day6.can_reopen, true); assert.equal(day6.reopen_days_left, 1)
  const old = await view((await make({ status: 'closed', closedAgo: '8 days' })).token)
  assert.equal(old.can_rate, true); assert.equal(old.can_reopen, false); assert.equal(old.reopen_days_left, 0)
  const again = await view((await make({ status: 'closed', closedAgo: '1 day', extra: { reopen_count: 1 } })).token)
  assert.equal(again.can_reopen, false); assert.equal(again.reopened, true)
  const adhoc = await view((await make({ status: 'closed', closedAgo: '1 day', category: 'odor' })).token)
  assert.equal(adhoc.can_rate, false); assert.equal(adhoc.can_reopen, false); assert.equal(adhoc.is_adhoc, true)
  const legacyDone = await view((await make({ status: 'done', closedAgo: '1 day', note: 'บันทึกขั้นเก่า' })).token)
  assert.equal(legacyDone.can_rate, false); assert.equal(legacyDone.can_reopen, false); assert.equal(legacyDone.result_note, 'บันทึกขั้นเก่า')
})

await test('viewer: ไม่ล็อกอิน=link · เจ้าของ=owner · ผู้มีตำแหน่ง=staff และผู้มีตำแหน่งทำอะไรไม่ได้นอกจากดู', async () => {
  const c = await make({ owner: 'citizen', status: 'closed', closedAgo: '1 hour' })
  await as('anon');    assert.equal((await view(c.token)).viewer, 'link')
  await as('citizen2'); assert.equal((await view(c.token)).viewer, 'link')
  await as('citizen'); assert.equal((await view(c.token)).viewer, 'owner')
  for (const alias of ['admin', 'officer', 'staff', 'viewer', 'council', 'technician', 'superadmin', 'adminB']) {
    await as(alias)
    const r = await view(c.token)
    assert.equal(r.viewer, 'staff', alias)
    assert.equal(r.can_rate, false, alias)
    assert.equal(r.can_reopen, false, alias)
  }
  await as('anon')
})

await test('ให้คะแนนผ่านลิงก์: ไม่ล็อกอิน → unverified + via_link ไม่แตะ complaints.rating · ซ้ำไม่ได้ · ข้อความยาวถูกตัด', async () => {
  const c = await make({ owner: 'council', status: 'closed', closedAgo: '1 hour' })
  const ok = await rate(c.token, 5, '  ขอบคุณครับ  ')
  assert.deepEqual(ok, { ok: true, verified: false })
  const saved = (await db.query('SELECT rating, comment, is_verified, via_link, created_by FROM public.satisfaction_ratings WHERE complaint_id = $1', [c.id])).rows
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0], { rating: 5, comment: 'ขอบคุณครับ', is_verified: false, via_link: true, created_by: null })
  assert.equal((await row(c.id)).rating, null, 'คะแนนผ่านลิงก์ไม่ลงคะแนนทางการของคำร้อง')
  assert.deepEqual(await rate(c.token, 4), { ok: false, code: 'already_rated' })
  assert.equal((await view(c.token)).rated, true)
  assert.equal((await view(c.token)).can_rate, false)

  const long = await make({ status: 'closed', closedAgo: '1 hour' })
  await rate(long.token, 3, 'ก'.repeat(900))
  assert.equal((await db.query('SELECT char_length(comment)::int AS n FROM public.satisfaction_ratings WHERE complaint_id = $1', [long.id])).rows[0].n, 500)
})

await test('ให้คะแนนผ่านลิงก์: คะแนนผิด/ยังไม่เสร็จ/หมวดเฉพาะกิจ/ผิด อปท./ผู้มีตำแหน่ง → ไม่บันทึก', async () => {
  const closed = await make({ status: 'closed', closedAgo: '1 hour' })
  for (const bad of [0, 6, -1, null]) assert.deepEqual(await rate(closed.token, bad), { ok: false, code: 'invalid_rating' })
  assert.deepEqual(await rate(closed.token, 5, null, B), { ok: false, code: 'not_found' })
  assert.deepEqual(await rate('nope', 5), { ok: false, code: 'not_found' })
  const open = await make({ status: 'in_progress' })
  assert.deepEqual(await rate(open.token, 5), { ok: false, code: 'not_closed' })
  const adhoc = await make({ status: 'closed', closedAgo: '1 hour', category: 'odor' })
  assert.deepEqual(await rate(adhoc.token, 5), { ok: false, code: 'not_closed' })
  for (const alias of ['admin', 'officer', 'staff', 'viewer', 'council', 'technician', 'superadmin']) {
    await as(alias)
    assert.deepEqual(await rate(closed.token, 5), { ok: false, code: 'staff_cannot_rate' }, alias)
  }
  await as('anon')
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM public.satisfaction_ratings WHERE complaint_id = $1', [closed.id])).rows[0].n), 0)
})

await test('ให้คะแนนผ่านลิงก์: เจ้าของที่ล็อกอิน → verified ผ่าน rate_complaint() ตัวจริง (ลง complaints.rating) · ประชาชนคนอื่นที่ล็อกอิน → unverified+via_link', async () => {
  const mine = await make({ owner: 'citizen', status: 'closed', closedAgo: '1 hour' })
  await as('citizen')
  assert.deepEqual(await rate(mine.token, 4), { ok: true, verified: true })
  const saved = (await db.query('SELECT is_verified, via_link FROM public.satisfaction_ratings WHERE complaint_id = $1', [mine.id])).rows[0]
  assert.deepEqual(saved, { is_verified: true, via_link: false })
  assert.equal((await row(mine.id)).rating, 4)
  assert.deepEqual(await rate(mine.token, 5), { ok: false, code: 'already_rated' })

  const other = await make({ owner: 'council', status: 'closed', closedAgo: '1 hour' })
  await as('citizen2')
  assert.deepEqual(await rate(other.token, 5), { ok: true, verified: false })
  const s2 = (await db.query('SELECT is_verified, via_link, created_by FROM public.satisfaction_ratings WHERE complaint_id = $1', [other.id])).rows[0]
  assert.deepEqual(s2, { is_verified: false, via_link: true, created_by: users.citizen2 })
  await as('anon')
})

await test('แจ้งกลับผ่านลิงก์: เรื่องกลับผู้รับผิดชอบเดิม · เคลียร์หมุด/วันปิด · นับครั้ง · ไทม์ไลน์ระบุผ่านลิงก์', async () => {
  const c = await make({ owner: 'council', status: 'closed', closedAgo: '2 days', assignee: 'assignee' })
  await db.query('UPDATE public.complaints SET resolved_latitude = 1, resolved_longitude = 2, resolved_by = $2 WHERE id = $1', [c.id, users.assignee])
  const result = await reopen(c.token, '  ไฟยังไม่ติด  ')
  assert.deepEqual(result, { ok: true, status: 'received' })
  const after = await row(c.id)
  assert.equal(after.status, 'received')
  assert.equal(after.assigned_to, users.assignee)
  assert.equal(after.closed_at, null)
  assert.equal(after.resolved_latitude, null); assert.equal(after.resolved_longitude, null); assert.equal(after.resolved_by, null)
  assert.equal(after.extra_data.reopen_count, 1)
  assert.equal(after.extra_data.reopen_reason, 'ไฟยังไม่ติด')
  assert.ok(after.extra_data.reopened_at)
  assert.deepEqual(Object.keys(after.extra_data).sort(), ['reopen_count', 'reopen_reason', 'reopened_at'], 'ไม่เพิ่มคีย์ใหม่ใน extra_data')
  const tl = (await db.query(`SELECT status, note, actor_name FROM public.complaint_timeline WHERE complaint_id = $1 ORDER BY created_at DESC, id LIMIT 1`, [c.id])).rows[0]
  assert.equal(tl.status, 'received')
  assert.equal(tl.note, 'ผู้ร้องแจ้งว่ายังไม่เรียบร้อย (ผ่านลิงก์ติดตาม): ไฟยังไม่ติด')
  assert.equal(tl.actor_name, 'ผู้ร้อง (ผ่านลิงก์)')
  const v = await view(c.token)
  assert.equal(v.status, 'received'); assert.equal(v.reopened, true); assert.equal(v.can_reopen, false)
  assert.ok(!JSON.stringify(v).includes('ไฟยังไม่ติด'), 'เหตุผลที่แจ้งกลับไม่ย้อนกลับมาในหน้าลิงก์')
})

await test('แจ้งกลับผ่านลิงก์: ไม่มีผู้รับผิดชอบ/ผู้รับผิดชอบอยู่ อปท. อื่น → กลับคิวแอดมิน (pending)', async () => {
  const none = await make({ status: 'closed', closedAgo: '1 day' })
  assert.deepEqual(await reopen(none.token, 'ยังไม่เรียบร้อย'), { ok: true, status: 'pending' })
  assert.equal((await row(none.id)).assigned_to, null)
  const foreign = await make({ status: 'closed', closedAgo: '1 day', assignee: 'adminB' })
  assert.deepEqual(await reopen(foreign.token, 'ยังไม่เรียบร้อย'), { ok: true, status: 'pending' })
  assert.equal((await row(foreign.id)).assigned_to, null)
})

await test('แจ้งกลับผ่านลิงก์: ครั้งที่ 2 / เกิน 7 วัน / ยังไม่เสร็จ / เฉพาะกิจ / เหตุผลสั้นยาวเกิน / ผิด อปท. / ผู้มีตำแหน่ง → ไม่ทำอะไร', async () => {
  const c = await make({ status: 'closed', closedAgo: '1 day' })
  assert.equal((await reopen(c.token, 'ครั้งแรก')).ok, true)
  await db.query(`UPDATE public.complaints SET status = 'closed', closed_at = now() WHERE id = $1`, [c.id])
  assert.deepEqual(await reopen(c.token, 'ครั้งสอง'), { ok: false, code: 'already_reopened' })

  const old = await make({ status: 'closed', closedAgo: '8 days' })
  assert.deepEqual(await reopen(old.token, 'เกินเวลา'), { ok: false, code: 'expired' })
  assert.equal((await row(old.id)).status, 'closed')

  const open = await make({ status: 'in_progress' })
  assert.deepEqual(await reopen(open.token, 'ยังไม่เสร็จ'), { ok: false, code: 'not_finished' })
  const adhoc = await make({ status: 'closed', closedAgo: '1 day', category: 'odor' })
  assert.deepEqual(await reopen(adhoc.token, 'เฉพาะกิจ'), { ok: false, code: 'not_finished' })

  const fresh = await make({ status: 'closed', closedAgo: '1 day' })
  for (const bad of ['', '    ', 'abcd', null, 'ก'.repeat(501)]) assert.deepEqual(await reopen(fresh.token, bad), { ok: false, code: 'invalid_reason' })
  assert.deepEqual(await reopen(fresh.token, 'เหตุผลพอดี', B), { ok: false, code: 'not_found' })
  assert.deepEqual(await reopen('0'.repeat(32), 'เหตุผลพอดี'), { ok: false, code: 'not_found' })
  for (const alias of ['admin', 'officer', 'staff', 'viewer', 'council', 'technician', 'superadmin']) {
    await as(alias)
    assert.deepEqual(await reopen(fresh.token, 'เหตุผลพอดี'), { ok: false, code: 'staff_cannot_reopen' }, alias)
  }
  await as('anon')
  assert.equal((await row(fresh.id)).status, 'closed', 'ไม่มีการเปลี่ยนแปลงเมื่อถูกปฏิเสธ')
})

await test('ผลเหมือน reopen_complaint() ตัวจริงทุกจุด (กันสองฟังก์ชันเพี้ยนจากกัน)', async () => {
  const mk = () => make({ owner: 'citizen', status: 'closed', closedAgo: '3 days', assignee: 'assignee' })
  const viaOwner = await mk()
  const viaLink = await mk()
  await as('citizen')
  const original = (await db.query('SELECT public.reopen_complaint($1, $2) AS r', [viaOwner.id, 'ยังไม่เรียบร้อย'])).rows[0].r
  await as('anon')
  const linked = await reopen(viaLink.token, 'ยังไม่เรียบร้อย')
  assert.equal(original, linked.status)
  const pick = async id => {
    const r = await row(id)
    const { reopened_at, ...extra } = r.extra_data
    assert.ok(reopened_at)
    return { status: r.status, assigned_to: r.assigned_to, closed_at: r.closed_at, resolved: [r.resolved_latitude, r.resolved_longitude, r.resolved_by], extra }
  }
  assert.deepEqual(await pick(viaLink.id), await pick(viaOwner.id))
  // ตัวจริงปฏิเสธเรื่องที่ปิดเกิน 7 วัน/ครั้งที่ 2 ผ่านลิงก์ต้องปฏิเสธเหมือนกัน
  const old = await make({ owner: 'citizen', status: 'closed', closedAgo: '8 days' })
  await as('citizen')
  await assert.rejects(db.query('SELECT public.reopen_complaint($1, $2)', [old.id, 'เกินเวลา']))
  await as('anon')
  assert.equal((await reopen(old.token, 'เกินเวลา')).ok, false)
})

await test('กันยิงรัว: ผู้ไม่ล็อกอินที่ IP เดียวกันดูเกิน 30 ครั้ง/5 นาทีถูกหน่วง (PT429) · IP อื่นยังดูได้ · คนล็อกอินนับรายบัญชี', async () => {
  const c = await make()
  const headers = ip => db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify({ 'cf-connecting-ip': ip })])
  await headers('203.0.113.9')
  for (let i = 0; i < 30; i++) assert.equal((await view(c.token)).found, true)
  await expectError(view(c.token), 'PT429')
  // ถังให้คะแนน/แจ้งกลับแยกจากถังดู: ดูเต็มโควตาแล้วยังให้คะแนนได้ (ตอบ not_closed เพราะเรื่องยังไม่เสร็จ แต่ไม่ใช่ PT429)
  assert.deepEqual(await rate(c.token, 5), { ok: false, code: 'not_closed' })
  for (let i = 0; i < 19; i++) await reopen(c.token, 'เหตุผลทดสอบ')
  await expectError(reopen(c.token, 'เหตุผลทดสอบ'), 'PT429') // โควตาให้คะแนน+แจ้งกลับรวมกัน 20 ครั้ง
  await headers('203.0.113.10')
  assert.equal((await view(c.token)).found, true)
  await db.query('DELETE FROM public.rpc_rate_limit')
  await as('anon')
})

await test('สิทธิ์เรียกฟังก์ชัน: ผู้ไม่ล็อกอินเรียกได้เฉพาะ 3 ตัวสำหรับผู้ถือลิงก์ · ขอโทเคนและตัวช่วยภายในเรียกไม่ได้', async () => {
  const can = async (role, sig) => (await db.query(`SELECT has_function_privilege($1, $2, 'execute') AS ok`, [role, sig])).rows[0].ok
  const viewSig = 'public.get_complaint_by_track_token(text, uuid)'
  const rateSig = 'public.rate_complaint_by_track_token(text, uuid, int, text)'
  const reopenSig = 'public.reopen_complaint_by_track_token(text, uuid, text)'
  for (const role of ['anon', 'authenticated']) for (const sig of [viewSig, rateSig, reopenSig]) assert.equal(await can(role, sig), true, `${role} ${sig}`)
  assert.equal(await can('anon', 'public.get_complaint_track_token(uuid)'), false)
  assert.equal(await can('authenticated', 'public.get_complaint_track_token(uuid)'), true)
  for (const role of ['anon', 'authenticated']) assert.equal(await can(role, 'public.complaint_track_caller_is_staff()'), false)
})

console.log(`\nครบ ${cases} กลุ่ม`)
await db.close()
