// รายการส่วนตัวในปฏิทิน ("เฉพาะฉัน") — รัน migration จริง 2 ไฟล์ใน PostgreSQL จำลอง (PGlite 0.5.8)
// node tests/personal-events-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//
// ตรวจ 4 เรื่อง: ใครใช้ได้/ไม่ได้ (ผู้มีตำแหน่งทุกบทบาท ยกเว้นประชาชน) · เห็นเฉพาะเจ้าของ แม้แอดมินก็ไม่เห็น
// · เต็ม 100 แล้วทับรายการที่ผ่านไปแล้วและเก่าที่สุด (ไม่ทับรายการล่วงหน้าและรายการ "ทุกปี") · ลงล่วงหน้าไม่เกิน 1 ปี
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const tableMigration = await sqlFile('../supabase/migrations/20261001150000_personal_events_table.sql')
const guardMigration = await sqlFile('../supabase/migrations/20261001150100_personal_events_guard.sql')

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1)   // อปท. ที่ทดสอบ
const MB = id(2)   // อปท. อื่น

const U = {
  admin: id(101), staff: id(102), staff2: id(103), officer: id(104), viewer: id(105), council: id(106),
  tech: id(107), citizen: id(108), demoted: id(109), bStaff: id(110), superadmin: id(111),
  heavy: id(112), full: id(113), leaver: id(114),
}

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.municipalities (id uuid PRIMARY KEY, org_type text);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, full_name text, role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid REFERENCES public.municipalities(id)
);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id() TO anon, authenticated;

INSERT INTO public.municipalities VALUES ('${MA}', 'เทศบาลตำบล'), ('${MB}', 'อบต.');
INSERT INTO public.profiles (id, full_name, role, municipality_id) VALUES
  ('${U.admin}',      'TEST แอดมิน',            'admin',      '${MA}'),
  ('${U.staff}',      'TEST เจ้าหน้าที่',        'staff',      '${MA}'),
  ('${U.staff2}',     'TEST เจ้าหน้าที่อีกคน',   'staff',      '${MA}'),
  ('${U.officer}',    'TEST หัวหน้าฝ่าย',        'officer',    '${MA}'),
  ('${U.viewer}',     'TEST ผู้บริหาร',          'viewer',     '${MA}'),
  ('${U.council}',    'TEST สมาชิกสภา',         'council',    '${MA}'),
  ('${U.tech}',       'TEST ช่าง',              'technician', '${MA}'),
  ('${U.citizen}',    'TEST ประชาชน',           'citizen',    '${MA}'),
  ('${U.demoted}',    'TEST จะถูกลดเป็นประชาชน', 'staff',      '${MA}'),
  ('${U.bStaff}',     'TEST เจ้าหน้าที่ อปท.อื่น', 'staff',      '${MB}'),
  ('${U.superadmin}', 'TEST superadmin',        'superadmin', NULL),
  ('${U.heavy}',      'TEST จดเยอะ',            'staff',      '${MA}'),
  ('${U.full}',       'TEST เต็มด้วยรายการล่วงหน้า', 'viewer',   '${MA}'),
  ('${U.leaver}',     'TEST จะถูกลบบัญชี',       'staff',      '${MA}');
`)

// migration จริง — ไฟล์ตารางก่อน แล้วไฟล์ trigger (ไฟล์ 2 มีด่านตรวจว่าไฟล์ 1 รันแล้ว)
await assert.rejects(db.exec(guardMigration), /20261001150000_personal_events_table\.sql/, 'รันไฟล์ 2 ก่อนไฟล์ 1 ต้องถูกด่านหัวไฟล์หยุด')
await db.exec(tableMigration)
await db.exec(guardMigration)

// ตั้งผู้ใช้ก่อนทุกคำสั่งเสมอ — ไม่พึ่งบทบาทที่ค้างจากคำสั่งก่อนหน้า (เคยเกือบปล่อย TRUNCATE ผ่านเพราะรันเป็น superuser)
const actor = async (user) => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user || ''])
  await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const as = async (user, sql, params = []) => { await actor(user); return db.query(sql, params) }
const root = async (sql, params = []) => { await asRoot(); return db.query(sql, params) }

const today = (await root("SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS d")).rows[0].d
const horizon = (await root("SELECT ((now() AT TIME ZONE 'Asia/Bangkok')::date + interval '1 year')::date::text AS d")).rows[0].d
const day = (offset) => {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

// เพิ่มรายการแบบที่หน้าเว็บทำ: ไม่ส่ง owner_id (ค่าเริ่มต้น auth.uid()) เว้นแต่จงใจทดสอบการปลอม
const add = async (user, row) => {
  const cols = ['municipality_id', 'title', 'event_date']
  const vals = [row.muni ?? MA, row.title ?? 'TEST รายการ', row.date ?? day(1)]
  for (const [col, key] of [['end_date', 'end'], ['repeat_yearly', 'yearly'], ['description', 'description'],
    ['location', 'location'], ['category', 'category'], ['owner_id', 'owner']]) {
    if (row[key] !== undefined) { cols.push(col); vals.push(row[key]) }
  }
  const res = await as(user, `INSERT INTO public.personal_events (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals)
  return res.rows[0].id
}
const visibleTo = async (user) => (await as(user, 'SELECT id, owner_id, title FROM public.personal_events ORDER BY title')).rows
const countOf = async (owner, muni = MA) =>
  Number((await root('SELECT count(*)::int AS n FROM public.personal_events WHERE owner_id = $1 AND municipality_id = $2', [owner, muni])).rows[0].n)
const exists = async (rowId) => (await root('SELECT 1 FROM public.personal_events WHERE id = $1', [rowId])).rows.length === 1
const rejectsCode = (promise, code, label) => assert.rejects(promise, (err) => {
  assert.equal(err.code, code, `${label} — คาดรหัส ${code} แต่ได้ ${err.code}: ${err.message}`)
  return true
})
const RLS_DENIED = '42501'
const CHECK_VIOLATION = '23514'

// ── ผู้มีตำแหน่งทุกบทบาทใช้ได้ ประชาชนและผู้ไม่ล็อกอินใช้ไม่ได้ ───────────────────────────────
const mine = {}
for (const who of ['admin', 'staff', 'staff2', 'officer', 'viewer', 'council', 'tech']) {
  mine[who] = await add(U[who], { title: `TEST ของ ${who}` })
  assert.ok(mine[who], `${who} ต้องเพิ่มรายการของตัวเองได้`)
}
mine.superadmin = await add(U.superadmin, { title: 'TEST ของ superadmin' })
assert.ok(mine.superadmin, 'superadmin (ไม่มีสังกัด) ต้องเพิ่มใน อปท. ที่เปิดอยู่ได้')

await rejectsCode(add(U.citizen, { title: 'TEST ประชาชนแอบเพิ่ม' }), RLS_DENIED, 'ประชาชนเพิ่มไม่ได้')
await rejectsCode(add(null, { title: 'TEST ไม่ล็อกอิน', owner: U.staff }), RLS_DENIED, 'ผู้ไม่ล็อกอินเพิ่มไม่ได้')
await rejectsCode(as(null, 'SELECT 1 FROM public.personal_events'), RLS_DENIED, 'ผู้ไม่ล็อกอินอ่านไม่ได้')

// ปลอมเจ้าของ / ข้าม อปท.
await rejectsCode(add(U.staff, { title: 'TEST ใส่ชื่อคนอื่น', owner: U.staff2 }), RLS_DENIED, 'ใส่ owner เป็นคนอื่นไม่ได้')
await rejectsCode(add(U.staff, { title: 'TEST ข้าม อปท.', muni: MB }), RLS_DENIED, 'เจ้าหน้าที่เพิ่มใน อปท. อื่นไม่ได้')
await rejectsCode(add(U.bStaff, { title: 'TEST คนนอกเข้ามาเพิ่ม', muni: MA }), RLS_DENIED, 'เจ้าหน้าที่ อปท. อื่นเพิ่มใน อปท. นี้ไม่ได้')

// ── เห็นเฉพาะเจ้าของ แม้แอดมินและ superadmin ก็ไม่เห็นของคนอื่น ─────────────────────────────
for (const who of ['admin', 'staff', 'staff2', 'officer', 'viewer', 'council', 'tech', 'superadmin']) {
  const rows = await visibleTo(U[who])
  assert.deepEqual(rows.map((r) => r.id), [mine[who]], `${who} ต้องเห็นเฉพาะรายการของตัวเอง 1 รายการ`)
}
assert.deepEqual(await visibleTo(U.citizen), [], 'ประชาชนไม่เห็นรายการของใครเลย')

// คนอื่นแก้/ลบของเราไม่ได้ (ไม่ error แต่ไม่กระทบแถว)
for (const who of ['admin', 'staff2', 'superadmin', 'citizen']) {
  const upd = await as(U[who], "UPDATE public.personal_events SET title = 'ถูกแก้' WHERE id = $1 RETURNING id", [mine.staff])
  assert.equal(upd.rows.length, 0, `${who} แก้รายการของคนอื่นไม่ได้`)
  const del = await as(U[who], 'DELETE FROM public.personal_events WHERE id = $1 RETURNING id', [mine.staff])
  assert.equal(del.rows.length, 0, `${who} ลบรายการของคนอื่นไม่ได้`)
}
assert.equal((await root('SELECT title FROM public.personal_events WHERE id = $1', [mine.staff])).rows[0].title, 'TEST ของ staff')

// ── เจ้าของแก้ได้ · owner กับเวลาที่สร้างถูกตรึง · updated_at ถูกประทับ ──────────────────────
const before = (await root('SELECT created_at, updated_at FROM public.personal_events WHERE id = $1', [mine.staff])).rows[0]
const edited = await as(U.staff,
  "UPDATE public.personal_events SET title = 'TEST แก้แล้ว', owner_id = $2, created_at = '2000-01-01' WHERE id = $1 RETURNING owner_id, created_at, updated_at, title",
  [mine.staff, U.staff2])
assert.equal(edited.rows.length, 1, 'เจ้าของแก้รายการของตัวเองได้')
assert.equal(edited.rows[0].title, 'TEST แก้แล้ว')
assert.equal(edited.rows[0].owner_id, U.staff, 'โอนรายการให้คนอื่นไม่ได้ owner ถูกตรึง')
assert.equal(new Date(edited.rows[0].created_at).getTime(), new Date(before.created_at).getTime(), 'created_at ถูกตรึง')
assert.ok(new Date(edited.rows[0].updated_at).getTime() >= new Date(before.updated_at).getTime(), 'updated_at ถูกประทับใหม่')
assert.deepEqual((await visibleTo(U.staff2)).map((r) => r.id), [mine.staff2], 'คนที่ถูกใส่ชื่อเป็น owner ไม่ได้รายการเพิ่ม')
await rejectsCode(as(U.staff, 'UPDATE public.personal_events SET municipality_id = $2 WHERE id = $1', [mine.staff, MB]), RLS_DENIED, 'ย้ายรายการไป อปท. อื่นไม่ได้')

// ── ข้อมูลที่ไม่ถูกรูปแบบ ─────────────────────────────────────────────────────────────────
await rejectsCode(add(U.staff, { title: 'ก'.repeat(201) }), CHECK_VIOLATION, 'ชื่อยาวเกิน 200')
await rejectsCode(add(U.staff, { title: '   ' }), CHECK_VIOLATION, 'ชื่อว่าง')
await rejectsCode(add(U.staff, { description: 'ก'.repeat(2001) }), CHECK_VIOLATION, 'รายละเอียดยาวเกิน 2000')
await rejectsCode(add(U.staff, { location: 'ก'.repeat(201) }), CHECK_VIOLATION, 'สถานที่ยาวเกิน 200')
await rejectsCode(add(U.staff, { category: 'ก'.repeat(61) }), CHECK_VIOLATION, 'ประเภทยาวเกิน 60')
await rejectsCode(add(U.staff, { date: day(5), end: day(4) }), CHECK_VIOLATION, 'วันสิ้นสุดก่อนวันเริ่ม')
await rejectsCode(add(U.staff, { date: day(5), end: day(6), yearly: true }), CHECK_VIOLATION, '"ทุกปี" พร้อมวันสิ้นสุด')
assert.ok(await add(U.staff, { title: 'ก'.repeat(200), description: 'ข'.repeat(2000), location: 'ค'.repeat(200), category: 'ง'.repeat(60) }), 'ความยาวเท่าเพดานพอดีต้องผ่าน')

// ── ลงล่วงหน้าได้ไม่เกิน 1 ปี (ย้อนหลังได้) ───────────────────────────────────────────────
const atHorizon = await add(U.staff, { title: 'TEST ครบ 1 ปีพอดี', date: horizon })
assert.ok(atHorizon, 'วันที่ครบ 1 ปีพอดีต้องผ่าน')
const beyond = (await root('SELECT ($1::date + 1)::text AS d', [horizon])).rows[0].d
await rejectsCode(add(U.staff, { title: 'TEST เกิน 1 ปี', date: beyond }), 'PE002', 'เกิน 1 ปี 1 วัน')
await rejectsCode(add(U.staff, { title: 'TEST วันสิ้นสุดเกิน 1 ปี', date: horizon, end: beyond }), 'PE002', 'วันสิ้นสุดเกิน 1 ปี')
await rejectsCode(add(U.staff, { title: 'TEST ทุกปีก็เกินไม่ได้', date: beyond, yearly: true }), 'PE002', '"ทุกปี" ก็ลงเกิน 1 ปีไม่ได้')
await rejectsCode(as(U.staff, 'UPDATE public.personal_events SET event_date = $2 WHERE id = $1', [atHorizon, beyond]), 'PE002', 'แก้วันที่ให้เกิน 1 ปีไม่ได้')
assert.ok(await add(U.staff, { title: 'TEST บันทึกย้อนหลัง', date: day(-900) }), 'ลงย้อนหลังได้ไม่จำกัด')
assert.ok(await add(U.staff, { title: 'TEST วันเกิด', date: day(-4000), yearly: true }), '"ทุกปี" ตั้งต้นจากวันในอดีตได้')

// ── เต็ม 100 แล้วทับรายการที่ผ่านไปแล้วและเก่าที่สุด ───────────────────────────────────────
// เตรียม 100 รายการของ heavy: ทุกปี 1 (วันเก่าที่สุดของทั้งหมด) + หลายวันที่เพิ่งจบเมื่อวาน 1 + ผ่านแล้ว 59 + ล่วงหน้า 39
// (ใน UNION ต้อง cast ชนิดเอง ไม่งั้นค่าคงที่ถูกตีเป็น text แล้วใส่คอลัมน์ uuid/date ไม่ได้)
await root(`
  INSERT INTO public.personal_events (owner_id, municipality_id, title, event_date, end_date, repeat_yearly)
  SELECT '${U.heavy}'::uuid, '${MA}'::uuid, 'TEST วันเกิดเก่าที่สุด', $1::date - 400, NULL::date, true
  UNION ALL SELECT '${U.heavy}'::uuid, '${MA}'::uuid, 'TEST หลายวันจบเมื่อวาน', $1::date - 350, $1::date - 1, false
  UNION ALL SELECT '${U.heavy}'::uuid, '${MA}'::uuid, 'TEST ผ่านแล้ว ' || g, $1::date - (300 - g), NULL::date, false FROM generate_series(1, 59) g
  UNION ALL SELECT '${U.heavy}'::uuid, '${MA}'::uuid, 'TEST ล่วงหน้า ' || g, $1::date + g, NULL::date, false FROM generate_series(1, 39) g
`, [today])
assert.equal(await countOf(U.heavy), 100)
const idByTitle = async (title) => (await root('SELECT id FROM public.personal_events WHERE owner_id = $1 AND title = $2', [U.heavy, title])).rows[0]?.id
const oldestPast = await idByTitle('TEST ผ่านแล้ว 1')       // วันที่ today-299 = เก่าที่สุดในกลุ่มที่ทับได้
const secondPast = await idByTitle('TEST ผ่านแล้ว 2')
const yearlyOld = await idByTitle('TEST วันเกิดเก่าที่สุด')
const multiDay = await idByTitle('TEST หลายวันจบเมื่อวาน')
// ของคนอื่นและของ อปท. อื่นต้องไม่ถูกแตะ
const otherOwnerOld = await add(U.staff2, { title: 'TEST ของคนอื่น เก่ามาก', date: day(-5000) })
const superOtherMuni = await add(U.superadmin, { title: 'TEST superadmin อปท.อื่น เก่ามาก', date: day(-5000), muni: MB })

const newest = await add(U.heavy, { title: 'TEST รายการที่ 101' })
assert.ok(newest, 'เต็ม 100 แล้วยังเพิ่มได้ (เขียนทับ)')
assert.equal(await countOf(U.heavy), 100, 'ยอดคงที่ 100 หลังเขียนทับ')
assert.equal(await exists(oldestPast), false, 'แถวที่หายคือแถวที่ผ่านไปแล้วและเก่าที่สุด')
assert.equal(await exists(secondPast), true, 'ทับทีละ 1 แถวต่อการเพิ่ม 1 ครั้ง')
assert.equal(await exists(yearlyOld), true, 'แถว "ทุกปี" ไม่ถูกทับ แม้วันจะเก่าที่สุด')
assert.equal(await exists(multiDay), true, 'รายการหลายวันนับจากวันสิ้นสุด — เพิ่งจบเมื่อวานจึงยังไม่ใช่แถวเก่าที่สุด')
assert.equal(await exists(otherOwnerOld), true, 'การทับไม่ข้ามไปลบของคนอื่น')
assert.equal(await exists(superOtherMuni), true, 'การทับไม่ข้าม อปท.')

await add(U.heavy, { title: 'TEST รายการที่ 102' })
assert.equal(await exists(secondPast), false, 'ครั้งถัดไปทับแถวเก่าที่สุดตัวถัดไป')
assert.equal(await countOf(U.heavy), 100)

// วันเดียวกัน → แถวที่สร้างก่อนถูกทับก่อน (ล้างรายการที่ผ่านแล้วให้เหลือ 2 แถววันเดียวกัน แล้วเติมล่วงหน้าให้ครบ 100)
await root("DELETE FROM public.personal_events WHERE owner_id = $1 AND NOT repeat_yearly AND COALESCE(end_date, event_date) < $2::date", [U.heavy, today])
const tieFirst = await add(U.heavy, { title: 'TEST วันเดียวกัน สร้างก่อน', date: day(-10) })
const tieSecond = await add(U.heavy, { title: 'TEST วันเดียวกัน สร้างทีหลัง', date: day(-10) })
const missing = 100 - await countOf(U.heavy)
await root(`INSERT INTO public.personal_events (owner_id, municipality_id, title, event_date)
  SELECT '${U.heavy}', '${MA}', 'TEST เติมให้ครบ ' || g, $1::date + 100 + g FROM generate_series(1, ${missing}) g`, [today])
assert.equal(await countOf(U.heavy), 100)
await add(U.heavy, { title: 'TEST ทดสอบลำดับวันเดียวกัน' })
assert.equal(await exists(tieFirst), false, 'วันเดียวกัน แถวที่สร้างก่อนถูกทับก่อน')
assert.equal(await exists(tieSecond), true)

// แก้ไขตอนเต็ม ไม่ลบอะไร
await as(U.heavy, "UPDATE public.personal_events SET title = 'TEST แก้ตอนเต็ม' WHERE id = $1", [tieSecond])
assert.equal(await countOf(U.heavy), 100, 'การแก้ไขไม่ทำให้มีแถวหาย')
assert.equal(await exists(tieSecond), true)

// ── เต็ม 100 และไม่มีแถวให้ทับ (ล่วงหน้า + ทุกปี) → ปฏิเสธ ไม่มีแถวไหนหาย ──────────────────────
await root(`
  INSERT INTO public.personal_events (owner_id, municipality_id, title, event_date, repeat_yearly)
  SELECT '${U.full}'::uuid, '${MA}'::uuid, 'TEST วันเกิด ' || g, $1::date - 1000 - g, true FROM generate_series(1, 50) g
  UNION ALL SELECT '${U.full}'::uuid, '${MA}'::uuid, 'TEST ล่วงหน้า ' || g, $1::date + g - 1, false FROM generate_series(1, 50) g
`, [today])
assert.equal(await countOf(U.full), 100)
await rejectsCode(add(U.full, { title: 'TEST เพิ่มตอนไม่มีอะไรให้ทับ' }), 'PE001', 'ทุกแถวเป็นรายการล่วงหน้าหรือ "ทุกปี"')
assert.equal(await countOf(U.full), 100, 'ถูกปฏิเสธแล้วต้องไม่มีแถวไหนหาย')
assert.equal(Number((await root("SELECT count(*)::int AS n FROM public.personal_events WHERE owner_id = $1 AND event_date = $2::date", [U.full, today])).rows[0].n), 1,
  'รายการของ "วันนี้" ยังไม่ผ่านไป จึงไม่ถูกทับ')
// เจ้าของลบเอง 1 แถว แล้วเพิ่มได้
await as(U.full, "DELETE FROM public.personal_events WHERE title = 'TEST ล่วงหน้า 50'")
assert.ok(await add(U.full, { title: 'TEST เพิ่มได้หลังลบเอง' }), 'ลบเองแล้วเพิ่มได้อีก')
assert.equal(await countOf(U.full), 100)

// ── TRUNCATE / เรียกฟังก์ชัน trigger ตรง ───────────────────────────────────────────────────
await rejectsCode(as(U.admin, 'TRUNCATE public.personal_events'), RLS_DENIED, 'TRUNCATE ต้องถูกปฏิเสธ (RLS ไม่กัน TRUNCATE ต้องถอนสิทธิ์)')
assert.ok(await countOf(U.heavy) === 100, 'หลัง TRUNCATE ถูกปฏิเสธ ข้อมูลต้องอยู่ครบ')
await assert.rejects(as(U.staff, 'SELECT public.personal_events_guard()'), 'ฟังก์ชัน trigger เรียกตรงไม่ได้')

// ── คนที่ถูกลดเป็นประชาชน: อ่านและลบของตัวเองได้ แต่เพิ่ม/แก้ไม่ได้ ───────────────────────────
const demotedRow = await add(U.demoted, { title: 'TEST ก่อนถูกลด' })
await root("UPDATE public.profiles SET role = 'citizen' WHERE id = $1", [U.demoted])
assert.deepEqual((await visibleTo(U.demoted)).map((r) => r.id), [demotedRow], 'ถูกลดเป็นประชาชนแล้วยังอ่านของตัวเองได้')
await rejectsCode(add(U.demoted, { title: 'TEST หลังถูกลด' }), RLS_DENIED, 'ถูกลดแล้วเพิ่มไม่ได้')
await rejectsCode(as(U.demoted, "UPDATE public.personal_events SET title = 'แก้' WHERE id = $1", [demotedRow]), RLS_DENIED, 'ถูกลดแล้วแก้ไม่ได้')
assert.equal((await as(U.demoted, 'DELETE FROM public.personal_events WHERE id = $1 RETURNING id', [demotedRow])).rows.length, 1, 'ถูกลดแล้วยังลบของตัวเองได้')

// ── ลบบัญชีแล้วรายการหายตาม ────────────────────────────────────────────────────────────────
await add(U.leaver, { title: 'TEST ของคนที่จะถูกลบบัญชี' })
assert.equal(await countOf(U.leaver), 1)
await root('DELETE FROM public.profiles WHERE id = $1', [U.leaver])
assert.equal(await countOf(U.leaver), 0, 'ลบบัญชีแล้วรายการส่วนตัวหายตาม (ON DELETE CASCADE)')

await db.close()
console.log('personal-events-db: ผ่านทุกข้อ')
