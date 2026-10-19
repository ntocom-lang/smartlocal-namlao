// ล็อกตัวเลขสรุปเรื่องร้องเรียนรายเดือน — supabase/migrations/20261019140000_complaint_monthly_snapshots.sql
//   node tests/complaint-monthly-snapshots-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// รัน migration จริง (พร้อม complaint_stats_fy และ complaint_issue_breakdown_fy ตัวจริงที่ฟังก์ชันนี้เรียก) ใน PostgreSQL จำลอง (PGlite)
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง (ติดตั้ง PGlite: npm install --prefix <temp> @electric-sql/pglite@0.5.8)
//
// สิ่งที่ต้องไม่พัง: (1) ตัวเลขที่ล็อกต้องนิ่งแม้สถานะเรื่องเปลี่ยนทีหลัง (นี่คือเหตุผลที่มีฟังก์ชันนี้)
// (2) ไม่รับตัวเลขจากหน้าจอ — คำนวณฝั่งฐานข้อมูลเอง (3) สิทธิ์: เฉพาะ admin/officer/staff ของ อปท. นั้น + superadmin
// (4) ข้อความดิบของผู้ร้องไม่หลุดเข้าชุดที่ล็อก (5) append-only + audit_logs ทุกครั้ง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const statsFn = await readMigration('20260906100000_public_stats_fiscal_year_rpc.sql')
const breakdownFn = await readMigration('20261018140000_complaint_issue_breakdown_fy.sql')
const migration = await readMigration('20261019140000_complaint_monthly_snapshots.sql')

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
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text, metadata jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid, category text NOT NULL, issue_type text, status text DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
CREATE TABLE public.document_requests (id uuid PRIMARY KEY);
INSERT INTO public.municipalities VALUES ('${A}', 'อปท. เอ'), ('${B}', 'อปท. บี');
`)
await db.exec(statsFn)
await db.exec(breakdownFn)
await db.exec(migration)

const users = { admin: U(1), officer: U(2), staff: U(3), viewer: U(4), council: U(5), technician: U(6), citizen: U(7), adminB: U(8), superadmin: U(9) }
for (const [alias, id] of Object.entries(users)) {
  const role = alias === 'adminB' ? 'admin' : alias
  const muni = alias === 'adminB' ? B : alias === 'superadmin' ? null : A
  await db.query('INSERT INTO auth.users VALUES ($1)', [id])
  await db.query('INSERT INTO public.profiles VALUES ($1, $2, $3, $4)', [id, `ผู้ใช้ ${alias}`, role, muni])
}
const as = async alias => {
  const role = alias === 'adminB' ? 'admin' : alias
  const muni = alias === 'adminB' ? B : alias === 'superadmin' ? '' : A
  await db.query("SELECT set_config('test.uid', $1, false), set_config('test.role', $2, false), set_config('test.muni', $3, false)",
    [alias === 'anon' ? '' : users[alias], alias === 'anon' ? '' : role, alias === 'anon' ? '' : muni])
}

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}
const expectError = async (promise, code, includes) => {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code, `รหัสผิด: ${error.code} / ${error.message}`)
    if (includes) assert.ok(String(error.message).includes(includes), `ข้อความไม่มี "${includes}": ${error.message}`)
    return true
  })
}

// เดือนที่แล้ว/เดือนนี้ตามเวลาไทยของเครื่องที่รันเทสต์ (ไม่ผูกวันที่ตายตัว — กฎ "ไม่เกิน 24 เดือน" จะทำให้เทสต์เน่าตามเวลา)
const monthStart = async offset => (await db.query(
  `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') + ($1 || ' months')::interval, 'YYYY-MM-DD') AS d`, [String(offset)])).rows[0].d
const P = await monthStart(-1)
const CURRENT = await monthStart(0)
const NEXT = await monthStart(1)
const at = (minuteOffsetFromStart, base = P) => `(${`'${base}'`}::timestamp AT TIME ZONE 'Asia/Bangkok') + interval '${minuteOffsetFromStart} minutes'`
const add = (muni, category, issueType, whenSql, status = 'new', closedDays = null) => db.query(
  `INSERT INTO public.complaints (municipality_id, category, issue_type, status, created_at, closed_at)
   VALUES ($1, $2, $3, $4, ${whenSql}, ${closedDays === null ? 'NULL' : `${whenSql} + interval '${closedDays} days'`})`,
  [muni, category, issueType, status])

const DAY = 24 * 60
for (let i = 0; i < 5; i++) await add(A, 'light', 'ไฟดับทั้งดวง', at(10 * DAY))
for (let i = 0; i < 2; i++) await add(A, 'light', 'ไฟกระพริบ', at(11 * DAY), 'done', 2)
await add(A, 'light', null, at(12 * DAY))
await add(A, 'light', 'โทร 081-234-5678 นายสมชาย ใจดี', at(12 * DAY)) // ข้อความดิบที่ผู้ส่งพิมพ์เอง ต้องไม่หลุดเข้าชุดที่ล็อก
for (let i = 0; i < 3; i++) await add(A, 'water', null, at(13 * DAY), 'in_progress')
for (let i = 0; i < 2; i++) await add(A, 'trash', null, at(14 * DAY), 'rejected')
await add(A, 'water', null, at(0))                 // 00:00 วันที่ 1 เวลาไทย — อยู่ในเดือน
await add(A, 'trash', null, at(-1, CURRENT))       // 23:59 วันสุดท้ายของเดือนที่แล้ว (1 นาทีก่อนเที่ยงคืนวันที่ 1 ของเดือนนี้) — อยู่ในเดือน
await add(A, 'water', null, at(-1))                // 23:59 ของเดือนก่อน — นอกเดือน
await add(A, 'trash', null, at(0, CURRENT))        // 00:00 วันที่ 1 ของเดือนนี้ — นอกเดือน
await add(B, 'light', 'เสาเอียง/ชำรุด', at(5 * DAY)) // อปท. อื่น

const call = (muni, month, note) => db.query('SELECT public.publish_complaint_monthly_snapshot($1, $2, $3) AS r', [muni, month, note ?? null]).then(r => r.rows[0].r)
const get = (muni, month) => db.query('SELECT public.complaint_monthly_snapshot_get($1, $2) AS r', [muni, month]).then(r => r.rows[0].r)
const count = async sql => Number((await db.query(sql)).rows[0].n)

const EXPECTED_STATS = { total: 16, open: 9, in_progress: 3, resolved: 2, rejected: 2, avg_days: 2 }
const EXPECTED_CATEGORIES = [{ category: 'light', total: 9 }, { category: 'water', total: 4 }, { category: 'trash', total: 3 }]
const EXPECTED_BREAKDOWN = [{
  category: 'light',
  rows: [{ issue_label: 'ไฟดับทั้งดวง', total: 5 }, { issue_label: 'ไฟกระพริบ', total: 2 }, { issue_label: null, total: 2 }],
}]

await test('ยังไม่เคยล็อก = ไม่มีชุดตัวเลข (หน้าเว็บใช้ตัวเลขสดตามเดิม) · พารามิเตอร์ผิดรูปคืนว่างไม่ error', async () => {
  await as('anon')
  assert.equal(await get(A, P), null)
  assert.equal(await get(null, P), null)
  assert.equal(await get(A, null), null)
  assert.equal(await get(A, '2026-04-15'), null)
})

await test('admin ของ อปท. ล็อกเดือนที่แล้ว: ตัวเลขคำนวณฝั่งฐานข้อมูลถูกต้อง รวมขอบเขตเวลาไทย (00:00 วันแรก/23:59 วันสุดท้ายอยู่ใน · ก่อนหน้า/ถัดไปอยู่นอก)', async () => {
  await as('admin')
  const result = await call(A, P)
  assert.equal(result.unchanged, false)
  assert.equal(result.revision, 1)
  assert.deepEqual(result.stats, EXPECTED_STATS)
  assert.deepEqual(result.categories, EXPECTED_CATEGORIES)
  assert.deepEqual(result.issue_breakdown, EXPECTED_BREAKDOWN)
  assert.ok(!('this_month' in result.stats), 'this_month ขึ้นกับวันที่เปิดดู ห้ามเก็บ')
  assert.equal(result.categories.reduce((sum, c) => sum + c.total, 0), result.stats.total, 'ยอดรายหมวดรวมต้องเท่ายอดรวม')
})

await test('อ่านชุดที่ล็อกได้แบบสาธารณะ (anon) · มีเฉพาะ 5 คีย์ ไม่มี published_by/note', async () => {
  await as('anon')
  const snapshot = await get(A, P)
  assert.deepEqual(Object.keys(snapshot).sort(), ['categories', 'issue_breakdown', 'published_at', 'revision', 'stats'])
  assert.deepEqual(snapshot.stats, EXPECTED_STATS)
  assert.equal(snapshot.revision, 1)
})

await test('⚠️ ข้อความดิบที่ผู้ส่งพิมพ์เอง (เบอร์/ชื่อ) ไม่หลุดเข้าชุดที่ล็อก — นับรวมเป็น "ไม่ระบุ" (NULL)', async () => {
  const text = JSON.stringify(await get(A, P)) + JSON.stringify((await db.query('SELECT * FROM public.complaint_monthly_snapshots')).rows)
  for (const leaked of ['081-234-5678', 'สมชาย', 'ใจดี']) assert.ok(!text.includes(leaked), `หลุด: ${leaked}`)
})

await test('ตัวเลขที่ล็อกนิ่ง: เรื่องปิดเพิ่ม/มีเรื่องใหม่ทีหลัง ตัวเลขสดขยับ แต่ชุดที่ล็อกไม่ขยับ (เหตุผลที่มีฟังก์ชันนี้)', async () => {
  await db.query(`UPDATE public.complaints SET status = 'done', closed_at = created_at + interval '5 days'
                  WHERE municipality_id = '${A}' AND category = 'light' AND issue_type = 'ไฟดับทั้งดวง'`)
  await add(A, 'water', null, at(20 * DAY))
  const live = (await db.query(`SELECT public.complaint_stats_fy('${A}', '${P}', (('${CURRENT}'::date) - 1)) AS s`)).rows[0].s
  assert.equal(live.resolved, 7, 'ตัวเลขสดต้องขยับ (ไม่งั้นเทสต์นี้ไม่ได้พิสูจน์อะไร)')
  assert.equal(live.total, 17)
  await as('anon')
  const locked = await get(A, P)
  assert.deepEqual(locked.stats, EXPECTED_STATS)
  assert.equal(locked.revision, 1)
})

await test('ล็อกซ้ำเมื่อตัวเลขต่างจากที่ล็อก ต้องระบุเหตุผล (ไม่ระบุ/ว่าง/ช่องว่างล้วน = ปฏิเสธ 22023) · ไม่เพิ่มแถว', async () => {
  await as('admin')
  await expectError(call(A, P), '22023', 'ต้องระบุเหตุผล')
  await expectError(call(A, P, '   '), '22023', 'ต้องระบุเหตุผล')
  await expectError(call(A, P, 'ก'.repeat(501)), '22023', '500')
  assert.equal(await count(`SELECT count(*) AS n FROM public.complaint_monthly_snapshots WHERE municipality_id = '${A}'`), 1)
})

await test('ล็อกซ้ำพร้อมเหตุผล: revision 2 ตัวเลขใหม่ · อ่านได้ชุดล่าสุด · ชุดเดิมยังอยู่ครบ (append-only) · เหตุผลถูกตัดช่องว่างหัวท้าย', async () => {
  await as('officer')
  const result = await call(A, P, '  มีเรื่องปิดหลังเผยแพร่รอบแรก  ')
  assert.equal(result.revision, 2)
  assert.equal(result.stats.total, 17)
  assert.equal(result.stats.resolved, 7)
  assert.equal((await get(A, P)).revision, 2)
  const rows = (await db.query(`SELECT revision, note, (stats->>'total')::int AS total, published_by FROM public.complaint_monthly_snapshots
                                WHERE municipality_id = '${A}' ORDER BY revision`)).rows
  assert.deepEqual(rows.map(r => [r.revision, r.note, r.total]), [[1, null, 16], [2, 'มีเรื่องปิดหลังเผยแพร่รอบแรก', 17]])
  assert.deepEqual(rows.map(r => r.published_by), [users.admin, users.officer], 'ผู้ล็อกต้องมาจาก auth.uid() ไม่ใช่ค่าที่ส่งมา')
})

await test('กดซ้ำตอนตัวเลขเท่าเดิม = ไม่เพิ่มแถว ไม่เขียน audit ซ้ำ (ดับเบิลคลิก/สองแท็บ) แม้ไม่ใส่เหตุผล', async () => {
  const before = [
    await count('SELECT count(*) AS n FROM public.complaint_monthly_snapshots'),
    await count('SELECT count(*) AS n FROM public.audit_logs'),
  ]
  await as('staff')
  const result = await call(A, P)
  assert.equal(result.unchanged, true)
  assert.equal(result.revision, 2)
  const after = [
    await count('SELECT count(*) AS n FROM public.complaint_monthly_snapshots'),
    await count('SELECT count(*) AS n FROM public.audit_logs'),
  ]
  assert.deepEqual(after, before)
})

await test('audit_logs: ทุกการล็อกมี 1 แถว (รอบแรก publish · รอบถัดไป republish) มีผู้ทำ/บทบาท/เดือน/รอบ/ยอดรวม/เหตุผล', async () => {
  const rows = (await db.query(`SELECT action, actor_id, actor_name, actor_role, resource_type, resource_label, municipality_id, metadata
                                FROM public.audit_logs WHERE resource_type = 'complaint_monthly_snapshot' ORDER BY created_at, action DESC`)).rows
  assert.equal(rows.length, 2)
  const byAction = Object.fromEntries(rows.map(r => [r.action, r]))
  assert.equal(byAction.publish.actor_id, users.admin)
  assert.equal(byAction.publish.actor_role, 'admin')
  assert.equal(byAction.publish.metadata.revision, 1)
  assert.equal(byAction.publish.metadata.total, 16)
  assert.equal(byAction.republish.actor_id, users.officer)
  assert.equal(byAction.republish.metadata.note, 'มีเรื่องปิดหลังเผยแพร่รอบแรก')
  assert.equal(byAction.republish.municipality_id, A)
  const beYear = Number(P.slice(0, 4)) + 543
  assert.equal(byAction.publish.resource_label, `สรุปเรื่องร้องเรียน ${beYear}-${P.slice(5, 7)}`)
})

await test('สิทธิ์: ไม่ล็อกอิน/ประชาชน/viewer/council/technician/admin ของ อปท. อื่น = 42501 · officer/staff/admin ของ อปท. นั้นและ superadmin ทำได้', async () => {
  for (const alias of ['anon', 'citizen', 'viewer', 'council', 'technician', 'adminB']) {
    await as(alias)
    await expectError(call(A, P, 'ลองสิทธิ์'), '42501')
  }
  for (const alias of ['admin', 'officer', 'staff']) {
    await as(alias)
    assert.equal((await call(A, P)).unchanged, true, alias)
  }
  await as('superadmin')
  const result = await call(B, P)
  assert.equal(result.revision, 1)
  assert.equal(result.stats.total, 1)
  assert.deepEqual(result.issue_breakdown, [{ category: 'light', rows: [{ issue_label: 'เสาเอียง/ชำรุด', total: 1 }] }])
  assert.equal(await count(`SELECT count(*) AS n FROM public.complaint_monthly_snapshots WHERE municipality_id = '${B}'`), 1)
})

await test('แยกรายอปท.: ชุดของ B ไม่โผล่ใน A และกลับกัน', async () => {
  await as('anon')
  assert.equal((await get(B, P)).stats.total, 1)
  assert.equal((await get(A, P)).stats.total, 17)
})

await test('เดือนที่ล็อกได้: เดือนนี้/อนาคต/ไม่ใช่วันที่ 1/เกิน 24 เดือน/พารามิเตอร์ว่าง = ปฏิเสธ · ขอบ 24 เดือนพอดีล็อกได้ (เดือนว่างได้ยอด 0)', async () => {
  await as('admin')
  await expectError(call(A, CURRENT), '22023', 'สิ้นสุดแล้ว')
  await expectError(call(A, NEXT), '22023', 'สิ้นสุดแล้ว')
  await expectError(call(A, `${P.slice(0, 8)}15`), '22023', 'วันที่ 1')
  await expectError(call(A, await monthStart(-25)), '22023', '24 เดือน')
  await expectError(call(null, P), '22023')
  await expectError(call(A, null), '22023')
  const edge = await call(A, await monthStart(-24))
  assert.equal(edge.revision, 1)
  assert.deepEqual([edge.stats.total, edge.categories, edge.issue_breakdown], [0, [], []])
})

await test('ตารางปิดสนิท: anon/authenticated ไม่มีสิทธิ์ใดๆ กับตารางตรงๆ (รวม TRUNCATE) · เปิด RLS · เรียกฟังก์ชันล็อกต้องเป็น authenticated เท่านั้น', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const { rows } = await db.query(`SELECT has_table_privilege($1, 'public.complaint_monthly_snapshots', $2) AS ok`, [role, privilege])
      assert.equal(rows[0].ok, false, `${role} ไม่ควรมี ${privilege}`)
    }
  }
  assert.equal((await db.query(`SELECT relrowsecurity AS on FROM pg_class WHERE relname = 'complaint_monthly_snapshots'`)).rows[0].on, true)
  const { rows } = await db.query(`
    SELECT p.proname, p.prosecdef AS definer, p.provolatile AS volatility,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ok,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
           array_to_string(p.proconfig, ',') AS config
    FROM pg_proc p WHERE p.proname IN ('publish_complaint_monthly_snapshot', 'complaint_monthly_snapshot_get') ORDER BY p.proname`)
  assert.equal(rows.length, 2, 'ต้องมีฟังก์ชันตัวละ 1 (ไม่มี overload ซ้อน)')
  const [get_, publish] = rows
  assert.deepEqual([get_.definer, get_.volatility, get_.anon_ok, get_.auth_ok], [true, 's', true, true])
  assert.deepEqual([publish.definer, publish.volatility, publish.anon_ok, publish.auth_ok], [true, 'v', false, true])
  for (const row of rows) assert.ok(row.config.includes('search_path=pg_catalog, public'), row.proname)
})

await test('append-only ที่ระดับโค้ด: migration ไม่มีคำสั่ง UPDATE/DELETE/TRUNCATE ตารางนี้ (นอกจาก REVOKE)', () => {
  const code = migration.replace(/^\s*--.*$/gm, '')
  assert.ok(!/\bUPDATE\s+public\.complaint_monthly_snapshots/i.test(code))
  assert.ok(!/\bDELETE\s+FROM\s+public\.complaint_monthly_snapshots/i.test(code))
  assert.ok(!/\bTRUNCATE\b/i.test(code))
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(code), 'ห้ามมี JWT/secret ฝังในไฟล์')
})

await test('รัน migration ซ้ำได้ (CREATE OR REPLACE / IF NOT EXISTS) ข้อมูลและผลไม่เปลี่ยน', async () => {
  const before = await count('SELECT count(*) AS n FROM public.complaint_monthly_snapshots')
  await db.exec(migration)
  assert.equal(await count('SELECT count(*) AS n FROM public.complaint_monthly_snapshots'), before)
  await as('anon')
  assert.equal((await get(A, P)).revision, 2)
})

console.log(`\n${cases} cases passed`)
