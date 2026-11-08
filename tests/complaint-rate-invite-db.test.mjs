// ชวนผู้ยื่นประเมินจากหน้าแรกเจ้าหน้าที่ — supabase/migrations/20261111100000_satisfaction_rated_by_proxy_column.sql
//                                          + 20261111100100_complaint_rate_invite_functions.sql
//   node tests/complaint-rate-invite-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// รัน migration จริง 2 ไฟล์ใน PostgreSQL จำลอง (PGlite 0.5.8) ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
// (ติดตั้ง PGlite: npm install --prefix <temp> @electric-sql/pglite@0.5.8)
// ฟังก์ชันที่ตัวใหม่พึ่ง (complaint_category_is_adhoc, rate_complaint) ถูกตัดมาจาก migration ที่ production รันจริง ไม่เขียนสำเนาเอง
//
// สิ่งที่ต้องไม่พัง: (1) บันทึกแทนได้เฉพาะ "เจ้าของเรื่องที่เป็น สท." ครั้งเดียวต่อเรื่อง (2) ช่องเดียวกับลิงก์ — ใครมาก่อนได้ช่อง
// (3) คะแนนบันทึกแทนไม่ลง complaints.rating (4) รายการชวนประเมินเห็นเฉพาะเรื่องที่ฉันยื่นเอง ภายใน 30 วัน ยังไม่มีคะแนนช่องใด
// (5) ปลอมแถว rated_by_proxy ผ่านตารางตรงๆ ไม่ได้ (6) anon เรียกไม่ได้
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const columnSql = await readMigration('20261111100000_satisfaction_rated_by_proxy_column.sql')
const functionsSql = await readMigration('20261111100100_complaint_rate_invite_functions.sql')
const rateComplaintSrc = await readMigration('20260830150000_rate_complaint_rpc.sql')
const adhocSrc = await readMigration('20260827120000_restrict_odor_adhoc_visibility.sql')

function sliceFunction(source, startPattern) {
  const found = startPattern.exec(source)
  assert.ok(found, `ไม่พบฟังก์ชันที่ขึ้นต้นด้วย ${startPattern}`)
  const rest = source.slice(found.index)
  const end = rest.search(/\n\$\$;/)
  assert.ok(end > 0, 'ไม่พบ $$; ปิดฟังก์ชัน')
  return rest.slice(0, end + 4)
}
const rateComplaintFn = sliceFunction(rateComplaintSrc, /create or replace function public\.rate_complaint\(/i)
const adhocFn = sliceFunction(adhocSrc, /CREATE OR REPLACE FUNCTION public\.complaint_category_is_adhoc/)

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const U = n => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const users = {
  council: U(1), council2: U(2), staff: U(3), admin: U(4), officer: U(5), viewer: U(6), technician: U(7),
  citizen: U(8), superadmin: U(9), councilB: U(10), adminB: U(11),
}
const roleOf = alias => (alias === 'council2' || alias === 'councilB' ? 'council' : alias === 'adminB' ? 'admin' : alias)
const muniOf = alias => (alias === 'councilB' || alias === 'adminB' ? B : alias === 'superadmin' ? null : A)

const schema = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- ตัวตนผู้เรียกกำหนดผ่านตัวแปร session (แทน JWT ของ Supabase)
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, role text, municipality_id uuid);
CREATE TABLE public.complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, value text, label text,
  is_active boolean DEFAULT true, sort_order int DEFAULT 0, is_adhoc boolean NOT NULL DEFAULT false
);
-- คอลัมน์เท่าที่ฟังก์ชันเหล่านี้แตะ (track_token/rating/closed_at ตรงกับฐานจริง)
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, user_id uuid, ref_no text,
  category text, category_id uuid, status text DEFAULT 'pending', village text, closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), rating smallint, rated_at timestamptz,
  track_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '')
);
-- ตารางคะแนนเหมือน 072 + คอลัมน์จาก 20260830150000 + via_link จาก 20261020160000 (rated_by_proxy มาจาก migration จริงที่กำลังทดสอบ)
CREATE TABLE public.satisfaction_ratings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, municipality_id uuid, rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text, created_at timestamptz DEFAULT now(),
  complaint_id uuid REFERENCES public.complaints(id) ON DELETE SET NULL,
  is_verified boolean NOT NULL DEFAULT false, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  via_link boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX satisfaction_ratings_complaint_once ON public.satisfaction_ratings (complaint_id, is_verified);
-- policy INSERT สาธารณะรุ่นก่อน (20260830150000 ข้อ 2) — migration ฟังก์ชันจะแทนด้วยรุ่นที่มีด่าน rated_by_proxy = false
ALTER TABLE public.satisfaction_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can insert general satisfaction" ON public.satisfaction_ratings
  FOR INSERT TO anon, authenticated
  WITH CHECK (complaint_id IS NULL AND is_verified = false AND (created_by IS NULL OR created_by = auth.uid()));
GRANT INSERT ON public.satisfaction_ratings TO anon, authenticated;
INSERT INTO public.municipalities VALUES ('${A}', 'อปท. เอ'), ('${B}', 'อปท. บี');
INSERT INTO public.complaint_categories (municipality_id, value, label, is_adhoc) VALUES
  ('${A}', 'light', 'ไฟฟ้าสาธารณะ', false), ('${A}', 'odor', 'กลิ่นเหม็นรบกวน', true), ('${B}', 'light', 'ไฟฟ้าสาธารณะ (บี)', false);
${adhocFn}
`

const db = new PGlite()
await db.exec(schema)

// ด่านตรวจ: ฟังก์ชันต้องหยุดเมื่อยังไม่ได้ apply ไฟล์คอลัมน์ (ไม่ใช่พังตอนเรียกใช้)
let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}
await test('ไฟล์ฟังก์ชันหยุดพร้อมข้อความชัดเจนเมื่อยังไม่มีคอลัมน์ rated_by_proxy (ต้อง apply ไฟล์คอลัมน์ก่อน)', async () => {
  await assert.rejects(() => db.exec(functionsSql), /ไม่พบคอลัมน์ satisfaction_ratings\.rated_by_proxy/)
})

await db.exec(rateComplaintFn)
await db.exec(columnSql)
await db.exec(functionsSql)
await test('migration รันซ้ำได้ (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE)', async () => {
  await db.exec(columnSql)
  await db.exec(functionsSql)
})

for (const [alias, id] of Object.entries(users)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [id])
  await db.query('INSERT INTO public.profiles VALUES ($1, $2, $3, $4)', [id, `ผู้ใช้ ${alias}`, roleOf(alias), muniOf(alias)])
}
const as = async alias => {
  await db.query("SELECT set_config('test.uid', $1, false)", [alias === 'anon' ? '' : users[alias]])
}

let seq = 0
// สร้างคำร้องหนึ่งใบ — closedAgo = ข้อความ interval ('1 day') หรือ null (ไม่มีวันปิด)
const make = async ({ muni = A, owner = 'council', status = 'closed', category = 'light', closedAgo = '1 day', rating = null } = {}) => {
  seq++
  const { rows } = await db.query(
    `INSERT INTO public.complaints (municipality_id, user_id, ref_no, category, status, village, closed_at, rating)
     VALUES ($1, $2, $3, $4, $5, 'หมู่ 3', ${closedAgo === null ? 'NULL' : `now() - interval '${closedAgo}'`}, $6)
     RETURNING id, track_token`,
    [muni, owner ? users[owner] : null, `ES-69-${String(seq).padStart(4, '0')}`, category, status, rating])
  return rows[0]
}
const onBehalf = (id, rating, comment = null) => db.query('SELECT public.rate_complaint_on_behalf($1, $2, $3) AS r', [id, rating, comment]).then(r => r.rows[0].r)
const rateSelf = (id, rating, comment = null) => db.query('SELECT public.rate_complaint($1, $2, $3) AS r', [id, rating, comment]).then(r => r.rows[0].r)
const toRate = (muni = A) => db.query('SELECT public.my_complaints_to_rate($1) AS r', [muni]).then(r => r.rows[0].r)
const ratingsOf = async id => (await db.query('SELECT * FROM public.satisfaction_ratings WHERE complaint_id = $1 ORDER BY is_verified', [id])).rows
const complaintRow = async id => (await db.query('SELECT * FROM public.complaints WHERE id = $1', [id])).rows[0]
const expectError = async (promise, code) => {
  await assert.rejects(promise, error => { assert.equal(error.code, code, `รหัสผิด: ${error.code} / ${error.message}`); return true })
}

await test('สท. เจ้าของเรื่องบันทึกแทนได้ 1 ครั้ง: แถว unverified + rated_by_proxy + created_by = สท. · ไม่ลง complaints.rating', async () => {
  const c = await make()
  await as('council')
  assert.deepEqual(await onBehalf(c.id, 4, '  ชาวบ้านบอกว่าดี  '), { ok: true, verified: false, proxy: true })
  const rows = await ratingsOf(c.id)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].rating, 4)
  assert.equal(rows[0].comment, 'ชาวบ้านบอกว่าดี')
  assert.equal(rows[0].is_verified, false)
  assert.equal(rows[0].rated_by_proxy, true)
  assert.equal(rows[0].via_link, false)
  assert.equal(rows[0].created_by, users.council)
  assert.equal(rows[0].municipality_id, A)
  const after = await complaintRow(c.id)
  assert.equal(after.rating, null, 'คะแนนทางการยังเป็นของเจ้าของเรื่องที่ยืนยันตัวตนเท่านั้น')
  assert.equal(after.rated_at, null)
})

await test('บันทึกซ้ำ = already_rated และไม่เพิ่มแถว · สถานะ completed (ค่า legacy) บันทึกได้', async () => {
  const c = await make()
  await as('council')
  assert.equal((await onBehalf(c.id, 5)).ok, true)
  assert.deepEqual(await onBehalf(c.id, 1), { ok: false, code: 'already_rated' })
  assert.deepEqual((await ratingsOf(c.id)).map(r => r.rating), [5], 'ไม่ทับคะแนนแรก')
  const legacy = await make({ status: 'completed' })
  assert.equal((await onBehalf(legacy.id, 3)).ok, true)
})

await test('ชาวบ้านประเมินผ่านลิงก์ก่อนแล้ว (แถว unverified via_link) → สท. บันทึกแทนซ้ำไม่ได้ และไม่ทับคะแนนของชาวบ้าน', async () => {
  const c = await make()
  await db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, comment, complaint_id, is_verified, created_by, via_link)
                  VALUES ($1, 2, 'ชาวบ้านให้เอง', $2, false, NULL, true)`, [A, c.id])
  await as('council')
  assert.deepEqual(await onBehalf(c.id, 5), { ok: false, code: 'already_rated' })
  const rows = await ratingsOf(c.id)
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].rating, rows[0].via_link, rows[0].rated_by_proxy], [2, true, false])
})

await test('บันทึกแทนแล้ว (ช่อง unverified เต็ม) แถวหายจากรายการชวน และ สท. ยังประเมินเองผ่าน rate_complaint() ตามเดิม (ช่อง verified แยก)', async () => {
  const c = await make()
  await as('council')
  assert.ok((await toRate()).items.some(i => i.id === c.id))
  await onBehalf(c.id, 4)
  assert.ok(!(await toRate()).items.some(i => i.id === c.id), 'มีคะแนนช่องใดช่องหนึ่งแล้วไม่ทวงซ้ำ')
  assert.deepEqual(await rateSelf(c.id, 5), { ok: true, verified: true })
  assert.equal((await complaintRow(c.id)).rating, 5)
  assert.deepEqual((await ratingsOf(c.id)).map(r => [r.is_verified, r.rated_by_proxy]), [[false, true], [true, false]])
})

await test('ไม่ใช่เจ้าของเรื่อง = not_owner: admin / เจ้าหน้าที่ / หัวหน้ากอง / ผู้บริหาร / สท. คนอื่น / ไม่ล็อกอิน / superadmin / อปท. อื่น', async () => {
  const c = await make({ owner: 'council' })
  for (const alias of ['admin', 'staff', 'officer', 'viewer', 'technician', 'citizen', 'council2', 'superadmin', 'councilB', 'adminB', 'anon']) {
    await as(alias)
    assert.deepEqual(await onBehalf(c.id, 5), { ok: false, code: 'not_owner' }, alias)
  }
  assert.equal((await ratingsOf(c.id)).length, 0)
})

await test('เจ้าของเรื่องที่ไม่ใช่ สท. = not_council (ประชาชน/เจ้าหน้าที่/admin ยื่นเอง ต้องให้ลิงก์หรือประเมินเอง ไม่ใช่บันทึกแทน)', async () => {
  for (const alias of ['staff', 'admin', 'officer', 'viewer', 'technician', 'citizen', 'superadmin']) {
    const c = await make({ owner: alias })
    await as(alias)
    assert.deepEqual(await onBehalf(c.id, 5), { ok: false, code: 'not_council' }, alias)
    assert.equal((await ratingsOf(c.id)).length, 0, alias)
  }
})

await test('ยังไม่ปิด = not_closed · หมวดเฉพาะกิจ = not_rateable · คะแนนนอก 1–5 = invalid_rating · ไม่พบ = not_found', async () => {
  await as('council')
  for (const status of ['pending', 'received', 'in_progress', 'rejected', 'parked']) {
    const c = await make({ status, closedAgo: null })
    assert.deepEqual(await onBehalf(c.id, 5), { ok: false, code: 'not_closed' }, status)
  }
  const odor = await make({ category: 'odor' })
  assert.deepEqual(await onBehalf(odor.id, 5), { ok: false, code: 'not_rateable' })
  const c = await make()
  for (const bad of [0, 6, -1, null]) assert.deepEqual(await onBehalf(c.id, bad), { ok: false, code: 'invalid_rating' }, String(bad))
  assert.deepEqual(await onBehalf('00000000-0000-4000-8000-0000000000ff', 5), { ok: false, code: 'not_found' })
  assert.equal((await ratingsOf(c.id)).length, 0)
})

await test('ปิดเกิน 30 วัน = expired (ยิง RPC ตรงเติมคะแนนย้อนหลังไม่ได้) · ไม่มีวันปิด = expired · เช็กหลัง not_closed/not_rateable', async () => {
  await as('council')
  for (const closedAgo of ['31 days', '90 days', '400 days']) {
    const c = await make({ closedAgo })
    assert.deepEqual(await onBehalf(c.id, 5), { ok: false, code: 'expired' }, closedAgo)
    assert.equal((await ratingsOf(c.id)).length, 0)
  }
  const noDate = await make({ closedAgo: null })
  assert.deepEqual(await onBehalf(noDate.id, 5), { ok: false, code: 'expired' })
  const recent = await make({ closedAgo: '29 days' })
  assert.equal((await onBehalf(recent.id, 5)).ok, true, '29 วันยังบันทึกได้')
  // ลำดับการตรวจ: ยังไม่ปิดต้องได้ not_closed (ไม่ใช่ expired) และหมวดเฉพาะกิจได้ not_rateable
  const open = await make({ status: 'in_progress', closedAgo: '90 days' })
  assert.deepEqual(await onBehalf(open.id, 5), { ok: false, code: 'not_closed' })
  const odor = await make({ category: 'odor', closedAgo: '90 days' })
  assert.deepEqual(await onBehalf(odor.id, 5), { ok: false, code: 'not_rateable' })
})

await test('สท. ประเมินเองไปแล้ว = self_rated (ไม่ใช่ already_rated) ทั้งกรณี complaints.rating ไม่ว่าง และมีแถว verified อย่างเดียว · ไม่เพิ่มแถวบันทึกแทน', async () => {
  await as('council')
  const viaRpc = await make()
  assert.deepEqual(await rateSelf(viaRpc.id, 5), { ok: true, verified: true })
  assert.deepEqual(await onBehalf(viaRpc.id, 3), { ok: false, code: 'self_rated' })
  assert.deepEqual((await ratingsOf(viaRpc.id)).map(r => [r.is_verified, r.rated_by_proxy]), [[true, false]])

  const legacyRating = await make({ rating: 4 })
  assert.deepEqual(await onBehalf(legacyRating.id, 3), { ok: false, code: 'self_rated' })
  assert.equal((await ratingsOf(legacyRating.id)).length, 0)

  const verifiedRowOnly = await make()
  await db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, complaint_id, is_verified, created_by) VALUES ($1, 4, $2, true, $3)`, [A, verifiedRowOnly.id, users.council])
  assert.deepEqual(await onBehalf(verifiedRowOnly.id, 3), { ok: false, code: 'self_rated' })

  // ช่องชาวบ้านถูกใช้ไปแล้ว (ลิงก์/ค้นด้วยเลขอ้างอิง) แต่ สท. ยังไม่ได้ประเมินเอง = already_rated ตามเดิม
  const refLookup = await make()
  await db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, complaint_id, is_verified, created_by) VALUES ($1, 2, $2, false, NULL)`, [A, refLookup.id])
  assert.deepEqual(await onBehalf(refLookup.id, 5), { ok: false, code: 'already_rated' })
  assert.deepEqual((await ratingsOf(refLookup.id)).map(r => [r.rating, r.rated_by_proxy]), [[2, false]])
})

await test('ความเห็น: ว่าง/เว้นวรรค = NULL · ยาวเกิน 500 ถูกตัดที่ฐานข้อมูล', async () => {
  await as('council')
  const c1 = await make()
  await onBehalf(c1.id, 3, '   ')
  assert.equal((await ratingsOf(c1.id))[0].comment, null)
  const c2 = await make()
  await onBehalf(c2.id, 3, 'ก'.repeat(800))
  assert.equal((await ratingsOf(c2.id))[0].comment.length, 500)
})

await test('my_complaints_to_rate: เฉพาะเรื่องที่ฉันยื่นเอง ปิดแล้วใน 30 วัน ไม่มีคะแนนช่องใด · ไม่เห็นของคนอื่น/อปท.อื่น/หมวดเฉพาะกิจ', async () => {
  await db.exec('DELETE FROM public.satisfaction_ratings; DELETE FROM public.complaints')
  const mine = await make({ owner: 'council', closedAgo: '1 day' })
  const mineOlder = await make({ owner: 'council', closedAgo: '29 days' })
  const completed = await make({ owner: 'council', status: 'completed', closedAgo: '2 days' })
  const tooOld = await make({ owner: 'council', closedAgo: '31 days' })
  const others = await make({ owner: 'council2' })
  const otherMuni = await make({ owner: 'council', muni: B })
  const adhoc = await make({ owner: 'council', category: 'odor' })
  const open = await make({ owner: 'council', status: 'in_progress', closedAgo: null })
  const noCloseDate = await make({ owner: 'council', status: 'closed', closedAgo: null })
  const officialRated = await make({ owner: 'council', rating: 5 })
  const proxyRated = await make({ owner: 'council' })
  const linkRated = await make({ owner: 'council' })
  const verifiedRowOnly = await make({ owner: 'council' })
  await db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, complaint_id, is_verified, via_link) VALUES ($1, 3, $2, false, true)`, [A, linkRated.id])
  await db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, complaint_id, is_verified, created_by) VALUES ($1, 4, $2, true, $3)`, [A, verifiedRowOnly.id, users.council])
  await as('council')
  await onBehalf(proxyRated.id, 4)

  const result = await toRate()
  assert.deepEqual(result.items.map(i => i.id), [mine.id, completed.id, mineOlder.id], 'เรียงใหม่ → เก่า')
  const excluded = [tooOld, others, otherMuni, adhoc, open, noCloseDate, officialRated, proxyRated, linkRated, verifiedRowOnly]
  for (const c of excluded) assert.ok(!result.items.some(i => i.id === c.id), `ไม่ควรมี ${c.id}`)
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['category_label', 'closed_at', 'id', 'ref_no', 'track_token', 'village'])
  assert.equal(result.items[0].category_label, 'ไฟฟ้าสาธารณะ')
  assert.equal(result.items[0].village, 'หมู่ 3')
  assert.equal(result.items[0].track_token, mine.track_token)
  assert.match(result.items[0].track_token, /^[0-9a-f]{32}$/)
  assert.equal(result.can_proxy, true)
  assert.ok(Number.isFinite(Date.parse(result.server_now)))
  assert.deepEqual(Object.keys(result).sort(), ['can_proxy', 'items', 'server_now'])
})

await test('my_complaints_to_rate: ไม่รั่วข้อมูลส่วนบุคคล — ผลลัพธ์ไม่มีรหัสผู้ยื่น/อปท./ชื่อ', async () => {
  await as('council')
  const dump = JSON.stringify(await toRate())
  assert.ok(!dump.includes(users.council) && !dump.includes(A), 'ห้ามมี user_id / municipality_id')
})

await test('my_complaints_to_rate: คืนไม่เกิน 20 เรื่อง เรียงปิดล่าสุดก่อน', async () => {
  await db.exec('DELETE FROM public.satisfaction_ratings; DELETE FROM public.complaints')
  for (let i = 0; i < 25; i++) await make({ owner: 'council', closedAgo: `${i + 1} hours` })
  await as('council')
  const { items } = await toRate()
  assert.equal(items.length, 20)
  const times = items.map(i => Date.parse(i.closed_at))
  assert.deepEqual([...times].sort((a, b) => b - a), times)
})

await test('my_complaints_to_rate: บทบาทเจ้าหน้าที่ที่ไม่ใช่ สท. ได้รายการของตัวเอง แต่ can_proxy = false', async () => {
  await db.exec('DELETE FROM public.satisfaction_ratings; DELETE FROM public.complaints')
  for (const alias of ['staff', 'admin', 'officer', 'viewer', 'technician']) {
    const c = await make({ owner: alias })
    await make({ owner: 'council' }) // ของ สท. ต้องไม่โผล่ให้คนอื่น
    await as(alias)
    const result = await toRate()
    assert.deepEqual(result.items.map(i => i.id), [c.id], alias)
    assert.equal(result.can_proxy, false, alias)
  }
})

await test('my_complaints_to_rate: ประชาชน/ไม่ล็อกอิน/p_muni ว่างหรือผิด อปท. = 42501 · superadmin ดูข้าม อปท. ได้ (เฉพาะเรื่องของตัวเอง)', async () => {
  await as('citizen')
  await expectError(toRate(), '42501')
  await as('anon')
  await expectError(toRate(), '42501')
  await as('council')
  await expectError(toRate(B), '42501')
  await expectError(db.query('SELECT public.my_complaints_to_rate(NULL)'), '42501')
  await as('adminB')
  await expectError(toRate(A), '42501')
  await db.exec('DELETE FROM public.satisfaction_ratings; DELETE FROM public.complaints')
  const own = await make({ owner: 'superadmin', muni: B })
  await as('superadmin')
  assert.deepEqual((await toRate(B)).items.map(i => i.id), [own.id])
})

await test('CHECK satisfaction_ratings_proxy_shape: แถว rated_by_proxy=true ต้องอยู่ช่อง unverified และไม่ใช่แถวผ่านลิงก์ (ไม่บังคับ complaint_id/created_by เพราะ FK เป็น SET NULL)', async () => {
  const c = await make()
  const insert = (complaint, verified, viaLink, createdBy) => db.query(
    `INSERT INTO public.satisfaction_ratings (municipality_id, rating, complaint_id, is_verified, via_link, created_by, rated_by_proxy)
     VALUES ($1, 5, $2, $3, $4, $5, true)`, [A, complaint, verified, viaLink, createdBy])
  await expectError(insert(c.id, true, false, users.council), '23514')
  await expectError(insert(c.id, false, true, users.council), '23514')
  await expectError(insert(c.id, true, true, users.council), '23514')
  await insert(c.id, false, false, users.council) // รูปแบบที่ถูกต้องผ่านได้
  assert.equal((await ratingsOf(c.id)).length, 1)
  // แถวทั่วไป (ไม่ใช่บันทึกแทน) ไม่ถูกกระทบ: ประเมินรวมไม่ผูกคำร้อง + แถวเดิมได้ false จาก DEFAULT
  await db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating) VALUES ($1, 5)`, [A])
  assert.equal((await db.query(`SELECT bool_and(NOT rated_by_proxy) AS ok FROM public.satisfaction_ratings WHERE complaint_id IS NULL`)).rows[0].ok, true)
})

await test('ลบคำร้อง / ลบบัญชี สท. ที่มีแถวบันทึกแทนแล้วไม่พัง (FK SET NULL ชน CHECK ไม่ได้) และแถวยังอยู่พร้อมป้าย rated_by_proxy', async () => {
  // ลบคำร้อง → complaint_id เป็น NULL
  const c = await make()
  await as('council')
  assert.equal((await onBehalf(c.id, 4)).ok, true)
  await db.query('DELETE FROM public.complaints WHERE id = $1', [c.id])
  const orphan = (await db.query(`SELECT complaint_id, created_by, rated_by_proxy, is_verified FROM public.satisfaction_ratings WHERE rated_by_proxy AND created_by = $1 AND complaint_id IS NULL AND rating = 4`, [users.council])).rows
  assert.equal(orphan.length, 1)
  assert.deepEqual([orphan[0].rated_by_proxy, orphan[0].is_verified], [true, false])
  // ลบบัญชีผู้บันทึก → created_by เป็น NULL
  const gone = U(90)
  await db.query('INSERT INTO auth.users VALUES ($1)', [gone])
  const c2 = await make()
  await db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, complaint_id, is_verified, created_by, rated_by_proxy) VALUES ($1, 5, $2, false, $3, true)`, [A, c2.id, gone])
  await db.query('DELETE FROM auth.users WHERE id = $1', [gone])
  const rows = await ratingsOf(c2.id)
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].created_by, rows[0].rated_by_proxy], [null, true])
})

await test('policy INSERT สาธารณะมีด่าน rated_by_proxy = false · ปลอมแถวบันทึกแทนผ่านตารางตรงๆ ไม่ได้ (anon/authenticated ได้ 42501) · ประเมินรวมปกติยังส่งได้', async () => {
  const { rows } = await db.query(`SELECT with_check FROM pg_policies WHERE tablename = 'satisfaction_ratings' AND policyname = 'anyone can insert general satisfaction'`)
  assert.equal(rows.length, 1)
  assert.match(rows[0].with_check, /rated_by_proxy = false/)
  const c = await make()
  const before = (await db.query('SELECT count(*)::int AS n FROM public.satisfaction_ratings')).rows[0].n
  for (const role of ['authenticated', 'anon']) {
    await as('council')
    await db.exec(`SET ROLE ${role}`)
    try {
      // ผูกคำร้อง / ไม่ผูกคำร้อง / ไม่ระบุผู้บันทึก — ทุกรูปแบบต้องถูกปฏิเสธ
      for (const [complaint, createdBy] of [[c.id, users.council], [null, users.council], [null, null], [c.id, null]]) {
        await expectError(
          db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, complaint_id, created_by, rated_by_proxy) VALUES ($1, 5, $2, $3, true)`,
            [A, complaint, role === 'anon' ? null : createdBy]),
          '42501')
      }
      // แบบประเมินรวมหน้า /satisfaction (ไม่ส่งคอลัมน์ rated_by_proxy) ต้องยังส่งได้
      await db.query(`INSERT INTO public.satisfaction_ratings (municipality_id, rating, comment) VALUES ($1, 5, 'ภาพรวม')`, [A])
    } finally {
      await db.exec('RESET ROLE')
    }
  }
  const after = (await db.query('SELECT count(*)::int AS n FROM public.satisfaction_ratings')).rows[0].n
  assert.equal(after - before, 2, 'เพิ่มเฉพาะแบบประเมินรวม 2 แถว (หนึ่งแถวต่อบทบาท) ไม่มีแถวบันทึกแทนหลุดเข้ามา')
  assert.equal((await ratingsOf(c.id)).length, 0)
})

await test('สิทธิ์เรียกฟังก์ชัน: anon เรียกไม่ได้ทั้งสองตัว · authenticated เรียกได้', async () => {
  const can = async (role, sig) => (await db.query(`SELECT has_function_privilege($1, $2, 'execute') AS ok`, [role, sig])).rows[0].ok
  for (const sig of ['public.my_complaints_to_rate(uuid)', 'public.rate_complaint_on_behalf(uuid, integer, text)']) {
    assert.equal(await can('anon', sig), false, `anon ${sig}`)
    assert.equal(await can('authenticated', sig), true, `authenticated ${sig}`)
  }
})

await test('ฟังก์ชันเป็น SECURITY DEFINER ที่ล็อก search_path ว่าง (กันแอบสลับตารางด้วย search_path)', async () => {
  const { rows } = await db.query(`
    SELECT proname, prosecdef, proconfig FROM pg_proc
    WHERE proname IN ('my_complaints_to_rate', 'rate_complaint_on_behalf') ORDER BY proname`)
  assert.equal(rows.length, 2)
  for (const row of rows) {
    assert.equal(row.prosecdef, true, row.proname)
    assert.ok(row.proconfig.some(c => /^search_path=("")?$/.test(c)), `${row.proname}: ${row.proconfig}`)
  }
})

console.log(`\nครบ ${cases} กลุ่ม`)
await db.close()
