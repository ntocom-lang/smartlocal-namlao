// ล็อกหมวดคำร้อง 'corruption' (แจ้งการทุจริต) — รัน migration จริง 20261207100000 ใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   ในเครื่อง: node tests/corruption-category-lock-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   CI: อ่าน path จาก env PATIENT_PGLITE_MODULE
// ล้มเมื่อ: หมวดอื่นแก้ไม่ได้ · corruption ปิด "แอดมินรับเรื่อง" ได้ · ย้ายเป็นเฉพาะกิจได้ · เปลี่ยนรหัสเข้า/ออกได้
//          · upsert ค่าเริ่มต้นล้ม · แถวเฉพาะกิจเดิมถูกย้ายกลับเงียบๆ · รัน migration ซ้ำไม่ได้
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const migration = await sqlFile('../supabase/migrations/20261207100000_lock_corruption_manual_intake.sql')

// trigger เดิมบนตาราง ตัดมาจาก migration ที่ production รันจริง (ไม่เขียนสำเนาเอง)
// ใช้พิสูจน์ว่า UPDATE ในไฟล์ใหม่ไม่ไปปลุกด่าน "หมวดเปิดใช้ต้องมีกอง" กับแถวที่ค้างแบบนั้นบนฐานจริง
function sliceFunction(source, startMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `missing ${startMarker}`)
  const bodyEnd = source.indexOf('$$;', source.indexOf('$$', start) + 2)
  assert.ok(bodyEnd > start, `missing end of ${startMarker}`)
  return source.slice(start, bodyEnd + 3)
}
const guardActiveRequiresDepartment = sliceFunction(
  await sqlFile('../supabase/migrations/20260901170000_manual_document_signatories.sql'),
  'CREATE OR REPLACE FUNCTION public.guard_active_category_requires_department',
)

const A = '00000000-0000-0000-0000-00000000000a' // แบบน้ำเลา: corruption ธงหลุดเป็น false
const B = '00000000-0000-0000-0000-00000000000b' // corruption เป็นเฉพาะกิจอยู่ก่อน migration
const C = '00000000-0000-0000-0000-00000000000c' // ยังไม่มีหมวด (กดโหลดค่าเริ่มต้นทีหลัง)
const D = '00000000-0000-0000-0000-00000000000d' // ไม่มีแถว corruption มีแต่หมวดเฉพาะกิจรหัสอื่น

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.complaint_categories (
  id bigserial PRIMARY KEY,
  municipality_id uuid NOT NULL,
  value text NOT NULL,
  label text NOT NULL,
  department_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_adhoc boolean NOT NULL DEFAULT false,
  requires_manual_intake boolean NOT NULL DEFAULT false,
  UNIQUE (municipality_id, value)
);
-- แถว B: เปิดใช้แต่ไม่มีกอง (สร้างก่อนติดด่าน) — UPDATE ของ migration ต้องไม่ล้มเพราะแถวนี้
INSERT INTO public.complaint_categories (municipality_id, value, label, department_id, is_active, is_adhoc, requires_manual_intake) VALUES
  ('${A}', 'corruption', 'แจ้งการทุจริต', NULL, false, false, false),
  ('${A}', 'light',      'ไฟฟ้าส่องสว่าง', '${A}', true, false, false),
  ('${B}', 'corruption', 'แจ้งการทุจริต', NULL, true,  true,  false),
  ('${D}', 'odor_x',     'เฉพาะกิจ',      '${D}', true, true,  false);
${guardActiveRequiresDepartment}
CREATE TRIGGER trg_active_category_requires_department
BEFORE INSERT OR UPDATE OF is_active, department_id
ON public.complaint_categories
FOR EACH ROW EXECUTE FUNCTION public.guard_active_category_requires_department();
GRANT SELECT, INSERT, UPDATE ON public.complaint_categories TO authenticated;
GRANT USAGE ON SEQUENCE public.complaint_categories_id_seq TO authenticated;
`)

const row = async (muni, value) =>
  (await db.query('SELECT * FROM public.complaint_categories WHERE municipality_id = $1 AND value = $2', [muni, value])).rows[0]

async function rejects(sql, params, label) {
  await db.exec('BEGIN')
  try {
    await db.query(sql, params)
    assert.fail(`${label}: ต้องถูกปฏิเสธ แต่ผ่าน`)
  } catch (err) {
    if (err?.code === 'ERR_ASSERTION') throw err
    assert.equal(err.code, '23514', `${label}: ได้ ${err.code} ${err.message}`)
  } finally {
    await db.exec('ROLLBACK')
  }
}

let passed = 0
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`) }

await db.exec(migration)

await check('migration แก้แถวที่ธงหลุด (แบบน้ำเลา) เป็นแอดมินรับเรื่อง ไม่แตะหมวดอื่น', async () => {
  assert.equal((await row(A, 'corruption')).requires_manual_intake, true)
  assert.equal((await row(A, 'light')).requires_manual_intake, false)
})

await check('แถวเฉพาะกิจเดิมไม่ถูกย้ายกลับเงียบๆ แต่ธงแอดมินรับเรื่องเป็น true', async () => {
  const b = await row(B, 'corruption')
  assert.equal(b.is_adhoc, true)
  assert.equal(b.requires_manual_intake, true)
})

await check('รัน migration ซ้ำได้', async () => {
  await db.exec(migration)
  assert.equal((await row(A, 'corruption')).requires_manual_intake, true)
})

await check('หมวดอื่นแก้ได้ตามปกติทุกสวิตช์', async () => {
  await db.query(`UPDATE public.complaint_categories SET label = 'ไฟฟ้า', is_adhoc = true, requires_manual_intake = true
                   WHERE municipality_id = $1 AND value = 'light'`, [A])
  await db.query(`UPDATE public.complaint_categories SET is_adhoc = false, requires_manual_intake = false
                   WHERE municipality_id = $1 AND value = 'light'`, [A])
  const light = await row(A, 'light')
  assert.equal(light.label, 'ไฟฟ้า')
  assert.equal(light.requires_manual_intake, false)
})

await check('corruption: ปิด "แอดมินรับเรื่อง" ไม่มีผล (ค่าคงเป็น true) และแก้ชื่อได้', async () => {
  const res = await db.query(`UPDATE public.complaint_categories SET requires_manual_intake = false, label = 'ทุจริต'
                               WHERE municipality_id = $1 AND value = 'corruption' RETURNING requires_manual_intake, label`, [A])
  assert.deepEqual(res.rows[0], { requires_manual_intake: true, label: 'ทุจริต' })
})

await check('corruption: ย้ายจากปกติเป็นเฉพาะกิจ = ปฏิเสธ', () =>
  rejects(`UPDATE public.complaint_categories SET is_adhoc = true WHERE municipality_id = $1 AND value = 'corruption'`, [A], 'UPDATE is_adhoc'))

await check('corruption: เปลี่ยนรหัสออก = ปฏิเสธ', () =>
  rejects(`UPDATE public.complaint_categories SET value = 'corruption_old' WHERE municipality_id = $1 AND value = 'corruption'`, [A], 'rename out'))

await check('เปลี่ยนรหัสหมวดเฉพาะกิจเข้าเป็น corruption = ปฏิเสธ', () =>
  rejects(`UPDATE public.complaint_categories SET value = 'corruption' WHERE municipality_id = $1 AND value = 'odor_x'`, [D], 'rename in'))

await check('INSERT corruption แบบเฉพาะกิจ = ปฏิเสธ', () =>
  rejects(`INSERT INTO public.complaint_categories (municipality_id, value, label, department_id, is_adhoc) VALUES ($1, 'corruption', 'x', $1, true)`, [C], 'INSERT adhoc'))

await check('upsert ค่าเริ่มต้น (หน้าเว็บรุ่นเก่าส่ง false) ผ่าน และได้ true ทั้งแถวใหม่และแถวที่ชน', async () => {
  // แบบเดียวกับ seedDefaults: upsert onConflict municipality_id,value ไม่ส่ง is_adhoc
  // seedDefaults ส่ง department_id ทุกแถว (departmentFor) ไม่งั้นด่านหมวดเปิดใช้ต้องมีกองตีกลับ
  const upsert = `INSERT INTO public.complaint_categories (municipality_id, value, label, department_id, requires_manual_intake)
                  VALUES ($1, 'corruption', 'แจ้งการทุจริต', $1, false), ($1, 'road', 'ถนน', $1, false)
                  ON CONFLICT (municipality_id, value) DO UPDATE
                  SET label = EXCLUDED.label, requires_manual_intake = EXCLUDED.requires_manual_intake`
  await db.query(upsert, [C])
  await db.query(upsert, [A])
  for (const muni of [A, C]) {
    const c = await row(muni, 'corruption')
    assert.equal(c.requires_manual_intake, true, `corruption ของ ${muni}`)
    assert.equal(c.is_adhoc, false)
  }
  assert.equal((await row(C, 'road')).requires_manual_intake, false)
})

await check('upsert ที่ส่ง is_adhoc = true มาชนแถวเฉพาะกิจเดิม = ปฏิเสธ (ไม่ย้ายกลับเงียบๆ)', () =>
  rejects(`INSERT INTO public.complaint_categories (municipality_id, value, label, department_id, is_adhoc)
           VALUES ($1, 'corruption', 'x', $1, true)
           ON CONFLICT (municipality_id, value) DO UPDATE SET is_adhoc = EXCLUDED.is_adhoc`, [B], 'upsert adhoc'))

await check('แถวเฉพาะกิจเดิมย้ายกลับเป็นปกติได้ (ทิศที่ปลอดภัยกว่า)', async () => {
  await db.query(`UPDATE public.complaint_categories SET is_adhoc = false WHERE municipality_id = $1 AND value = 'corruption'`, [B])
  assert.equal((await row(B, 'corruption')).is_adhoc, false)
})

await check('trigger ยังทำงานเมื่อผู้แก้เป็น authenticated ที่ไม่มีสิทธิ์ EXECUTE ฟังก์ชัน', async () => {
  await db.exec('SET ROLE authenticated')
  try {
    const res = await db.query(`UPDATE public.complaint_categories SET requires_manual_intake = false
                                 WHERE municipality_id = $1 AND value = 'corruption' RETURNING requires_manual_intake`, [A])
    assert.equal(res.rows[0].requires_manual_intake, true)
  } finally {
    await db.exec('RESET ROLE')
  }
  await db.exec('SET ROLE authenticated')
  try {
    await rejects(`UPDATE public.complaint_categories SET is_adhoc = true WHERE municipality_id = $1 AND value = 'corruption'`, [A], 'authenticated UPDATE is_adhoc')
  } finally {
    await db.exec('RESET ROLE')
  }
})

await check('ผู้ใช้ทั่วไปเรียก trigger function ตรงไม่ได้', async () => {
  const res = await db.query(`SELECT has_function_privilege('authenticated', 'public.lock_corruption_category_flags()', 'EXECUTE') AS a,
                                     has_function_privilege('anon', 'public.lock_corruption_category_flags()', 'EXECUTE') AS b`)
  assert.deepEqual(res.rows[0], { a: false, b: false })
})

console.log(`ผ่าน ${passed} ข้อ`)
await db.close()
