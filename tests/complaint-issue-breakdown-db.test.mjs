// ฟังก์ชัน public.complaint_issue_breakdown_fy — รัน migration จริงใน PostgreSQL จำลอง (PGlite)
//   node tests/complaint-issue-breakdown-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง (ติดตั้ง PGlite: npm install --prefix <temp> @electric-sql/pglite@0.5.8)
//
// ข้อกำหนดหลัก: ข้อความดิบที่ผู้ส่งพิมพ์เองต้องไม่ออกจากฟังก์ชันสาธารณะไม่ว่ากรณีใด — ค่านอกรายการอนุญาตนับเป็น NULL
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const migration = await readFile(new URL('../supabase/migrations/20261018140000_complaint_issue_breakdown_fy.sql', import.meta.url), 'utf8')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid, category text, issue_type text, status text DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
`)
await db.exec(migration)

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

let seq = 0
const add = (muni, category, issueType, createdAt = '2026-04-15T03:00:00Z', status = 'new') =>
  db.query('INSERT INTO public.complaints (municipality_id, category, issue_type, status, created_at) VALUES ($1,$2,$3,$4,$5)', [muni, category, issueType, status, createdAt]).then(() => { seq++ })
const call = async (muni, category, from = '2026-04-01', to = '2026-04-30') => {
  const { rows } = await db.query('SELECT issue_label, total FROM public.complaint_issue_breakdown_fy($1,$2,$3,$4)', [muni, category, from, to])
  return rows.map(row => [row.issue_label, Number(row.total)])
}

// เรื่องไฟฟ้า อปท. A เดือนเมษายน: ครบทุกแบบ + ข้อความดิบที่ไม่อยู่ในรายการ
for (let i = 0; i < 5; i++) await add(A, 'light', 'ไฟดับทั้งดวง')
for (let i = 0; i < 2; i++) await add(A, 'light', 'ไฟกระพริบ')
await add(A, 'light', 'อื่นๆ')
await add(A, 'light', null)
await add(A, 'light', 'โทร 081-234-5678 นายสมชาย ใจดี บ้านเลขที่ 12')
await add(A, 'light', '<script>alert(1)</script>')
await add(A, 'light', ' ไฟดับทั้งดวง') // เว้นวรรคนำหน้า — ไม่ตรงเป๊ะ ต้องไม่ถูกเดาเป็นค่าที่อนุญาต
await add(A, 'light', 'ไฟดับทั้งดวง', '2026-04-30T16:59:00Z') // 30 เม.ย. 23:59 เวลาไทย — อยู่ในเดือน
await add(A, 'light', 'ไฟดับทั้งดวง', '2026-04-30T17:00:00Z') // 1 พ.ค. 00:00 เวลาไทย — นอกเดือน
await add(A, 'light', 'ไฟดับทั้งดวง', '2026-03-31T17:00:00Z') // 1 เม.ย. 00:00 เวลาไทย — ขอบแรกของเดือน อยู่ในเดือน
await add(A, 'light', 'ไฟดับทั้งดวง', '2026-03-31T16:59:00Z') // 31 มี.ค. 23:59 เวลาไทย — นอกเดือน
await add(A, 'trash', 'ไฟดับทั้งดวง') // หมวดอื่นแม้ใส่ค่าที่ตรงรายการ ต้องไม่ถูกนับในหมวดไฟฟ้า
await add(A, 'light', 'ไฟดับทั้งดวง', '2026-04-15T03:00:00Z', 'rejected') // นับทุกสถานะ เท่ากับยอดหมวดในรายงานหลัก
await add(B, 'light', 'เสาเอียง/ชำรุด') // อปท. อื่น

await test('นับเฉพาะค่าในรายการอนุญาต เรียงมาก→น้อย ค่านอกรายการและว่างรวมเป็น NULL ท้ายสุด', async () => {
  // ไฟดับทั้งดวง: 5 + 1 (30 เม.ย. 23:59) + 1 (1 เม.ย. 00:00) + 1 (rejected) = 8 · ไฟกระพริบ 2 · อื่นๆ 1
  // NULL: ว่าง 1 + ข้อความดิบ 3 (เบอร์/สคริปต์/มีเว้นวรรคนำ) = 4
  assert.deepEqual(await call(A, 'light'), [['ไฟดับทั้งดวง', 8], ['ไฟกระพริบ', 2], ['อื่นๆ', 1], [null, 4]])
})

await test('ข้อความดิบที่ผู้ส่งพิมพ์ไม่ออกจากฟังก์ชันเลย (ตรวจทั้งผลลัพธ์ที่เป็นสตริง)', async () => {
  const text = JSON.stringify(await call(A, 'light'))
  for (const leaked of ['081-234-5678', 'สมชาย', '<script>', 'บ้านเลขที่']) assert.ok(!text.includes(leaked), `หลุด: ${leaked}`)
})

await test('ยอดรวมของทุกแถว = จำนวนเรื่องหมวดนั้นในช่วง (ไม่มีเรื่องหายหรือซ้ำ)', async () => {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.complaints WHERE municipality_id=$1 AND category='light'
    AND created_at >= '2026-03-31T17:00:00Z' AND created_at < '2026-04-30T17:00:00Z'`, [A])
  const sum = (await call(A, 'light')).reduce((total, [, count]) => total + count, 0)
  assert.equal(sum, rows[0].n)
})

await test('ขอบเขตเวลาตามปฏิทินไทย: 30 เม.ย. 23:59 อยู่ในเดือน · 1 พ.ค. 00:00 และ 31 มี.ค. 23:59 อยู่นอก', async () => {
  assert.deepEqual(await call(A, 'light', '2026-05-01', '2026-05-01'), [['ไฟดับทั้งดวง', 1]])
  assert.deepEqual(await call(A, 'light', '2026-03-31', '2026-03-31'), [['ไฟดับทั้งดวง', 1]])
})

await test('แยกรายอปท.: B เห็นเฉพาะของตัวเอง', async () => {
  assert.deepEqual(await call(B, 'light'), [['เสาเอียง/ชำรุด', 1]])
})

await test('หมวดที่ไม่มีรายการอนุญาต (trash/อื่นๆ/รหัสแปลก) ไม่คืนอะไรเลย แม้มีเรื่องอยู่จริง', async () => {
  for (const category of ['trash', 'other', "light'; DROP TABLE complaints;--", 'cat_custom_1']) {
    assert.deepEqual(await call(A, category), [], category)
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.complaints')).rows[0].n, seq, 'ตารางต้องไม่เสียหาย')
})

await test('พารามิเตอร์ว่าง/ช่วงกลับด้านคืนผลว่าง ไม่ error', async () => {
  assert.deepEqual(await call(null, 'light'), [])
  assert.deepEqual(await call(A, null), [])
  assert.deepEqual(await call(A, 'light', null, '2026-04-30'), [])
  assert.deepEqual(await call(A, 'light', '2026-04-30', '2026-04-01'), [])
})

await test('เดือนที่ไม่มีเรื่องคืนผลว่าง', async () => {
  assert.deepEqual(await call(A, 'light', '2026-01-01', '2026-01-31'), [])
})

await test('สิทธิ์: anon/authenticated เรียกได้ · PUBLIC เรียกตรงไม่ได้นอกจากที่ GRANT · เป็น SECURITY DEFINER', async () => {
  const { rows } = await db.query(`
    SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ok,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
           p.prosecdef AS definer,
           p.provolatile AS volatility,
           (SELECT array_to_string(p.proconfig, ',')) AS config
    FROM pg_proc p WHERE p.proname = 'complaint_issue_breakdown_fy'`)
  assert.equal(rows.length, 1, 'ต้องมีฟังก์ชันเดียว ไม่มี overload ซ้อน')
  assert.deepEqual([rows[0].anon_ok, rows[0].auth_ok, rows[0].definer, rows[0].volatility], [true, true, true, 's'])
  assert.ok(rows[0].config.includes('search_path=public'))
})

await test('รันซ้ำได้ (CREATE OR REPLACE) ผลไม่เปลี่ยน', async () => {
  await db.exec(migration)
  assert.deepEqual(await call(A, 'light'), [['ไฟดับทั้งดวง', 8], ['ไฟกระพริบ', 2], ['อื่นๆ', 1], [null, 4]])
})

console.log(`\n${cases} cases passed`)
