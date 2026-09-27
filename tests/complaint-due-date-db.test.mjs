// วันกำหนดเสร็จของคำร้องนับเป็นวันทำการ — รัน migration จริง 2 ไฟล์ใน PostgreSQL จำลอง (PGlite 0.5.8)
// node tests/complaint-due-date-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

process.env.TZ = 'America/Los_Angeles'
const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const { addWorkingDays, setHolidayRows } = await import('../src/lib/workingDays.js')

const sqlFile = (relative) => readFile(new URL(relative, import.meta.url), 'utf8')
const fnMigration = await sqlFile('../supabase/migrations/20260927220000_add_working_days_fn.sql')
const triggerMigration = await sqlFile('../supabase/migrations/20260927220100_complaint_due_date_working_days.sql')
// นิยามเดิม (วันปฏิทิน) ตัดจากไฟล์ที่ production รันอยู่ ไม่เขียนมือ
const oldSource = await sqlFile('../supabase/migrations/20260828160000_fix_auto_assign_null_sla.sql')
const oldStart = oldSource.indexOf('CREATE OR REPLACE FUNCTION public.auto_assign_complaint()')
const oldFunction = oldSource.slice(oldStart, oldSource.indexOf('$$;', oldSource.indexOf('$$', oldStart) + 2) + 3)
assert.ok(oldStart >= 0 && oldFunction.includes('::date + COALESCE(v_sla, 3)'), 'ตัดนิยามเดิมไม่ได้')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const TECH = '00000000-0000-4000-8000-0000000000c1'

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY);
INSERT INTO public.municipalities VALUES ('${A}'), ('${B}');
CREATE TABLE public.public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE,
  holiday_date date NOT NULL, name text NOT NULL,
  is_working_day boolean NOT NULL DEFAULT false, note text,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_public_holidays_global_date ON public.public_holidays (holiday_date) WHERE municipality_id IS NULL;
CREATE UNIQUE INDEX idx_public_holidays_tenant_date ON public.public_holidays (municipality_id, holiday_date) WHERE municipality_id IS NOT NULL;
CREATE TABLE public.category_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL, category text NOT NULL, technician_id uuid,
  sla_days int DEFAULT 3, UNIQUE (municipality_id, category)
);
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid, category text, assigned_to uuid, due_date date, status text DEFAULT 'new'
);
${oldFunction}
CREATE TRIGGER complaints_auto_assign BEFORE INSERT ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_complaint();
-- แอดมินกรอกวันเดียวกับชั้น static ไว้ก่อน — ของเดิมต้องชนะ ไม่ถูกเขียนทับ
INSERT INTO public.public_holidays (municipality_id, holiday_date, name) VALUES (NULL, '2026-10-13', 'กรอกเองก่อน');
-- ตัวเลขแบบ production ณ 2026-09-27 + แถวที่ไม่ได้ตั้งตัวเลข
INSERT INTO public.category_assignments (municipality_id, category, technician_id, sla_days) VALUES
  ('${A}', 'light', '${TECH}', 10), ('${A}', 'water_repair', NULL, 3), ('${A}', 'odd', NULL, NULL),
  ('${B}', 'light', NULL, 10);
`)

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const addDb = async (start, n, muni) =>
  (await one('SELECT public.add_working_days($1::date, $2, $3::uuid)::text AS d', [start, n, muni])).d

await test('ก่อน migration: วันกำหนดเสร็จยังเป็นวันปฏิทิน (วันแจ้ง + 10 วันตรงๆ)', async () => {
  const r = await db.transaction(async (tx) => ({
    due: (await tx.query(`INSERT INTO public.complaints (municipality_id, category) VALUES ($1, 'light') RETURNING due_date::text AS d`, [A])).rows[0].d,
    calendar: (await tx.query(`SELECT ((now() AT TIME ZONE 'Asia/Bangkok')::date + 10)::text AS d`)).rows[0].d,
  }))
  assert.equal(r.due, r.calendar)
  assert.equal((await one(`SELECT to_regprocedure('public.add_working_days(date,integer,uuid)') AS f`)).f, null)
})

await db.exec(fnMigration)

await test('ขั้น 1: คัดวันหยุด static 47 วัน — วันที่มีคนกรอกไว้แล้วไม่ถูกเขียนทับ', async () => {
  assert.equal(Number((await one('SELECT count(*) AS n FROM public.public_holidays WHERE municipality_id IS NULL')).n), 47)
  assert.equal((await one(`SELECT name FROM public.public_holidays WHERE holiday_date = '2026-10-13'`)).name, 'กรอกเองก่อน')
  await db.exec(fnMigration) // รันซ้ำได้ ไม่เพิ่มแถว
  assert.equal(Number((await one('SELECT count(*) AS n FROM public.public_holidays WHERE municipality_id IS NULL')).n), 47)
})

await test('บวกวันทำการ: ข้ามเสาร์-อาทิตย์ ไม่นับวันตั้งต้น', async () => {
  assert.equal(await addDb('2026-10-02', 3, A), '2026-10-07') // ศุกร์ + 3 = พุธ
  assert.equal(await addDb('2026-10-05', 3, A), '2026-10-08') // จันทร์ + 3 = พฤหัส
  assert.equal(await addDb('2026-10-03', 3, A), '2026-10-07') // เสาร์ + 3 = พุธ
  assert.equal(await addDb('2026-10-04', 1, A), '2026-10-05') // อาทิตย์ + 1 = จันทร์
  assert.equal(await addDb('2026-10-02', 0, A), '2026-10-02')
  assert.equal(await addDb(null, 3, A), null)
})

await test('ข้ามวันหยุด: 13 ต.ค. และชดเชย 7 ธ.ค. 2569', async () => {
  assert.equal(await addDb('2026-10-12', 1, A), '2026-10-14')
  assert.equal(await addDb('2026-12-04', 1, A), '2026-12-08') // ศุกร์ → ข้ามเสาร์ อาทิตย์ และชดเชยวันจันทร์
})

await test('วันหยุดของ อปท. ใช้กับ อปท. นั้นเท่านั้น และยกเลิกวันหยุดกลางได้', async () => {
  await db.exec(`INSERT INTO public.public_holidays (municipality_id, holiday_date, name, is_working_day) VALUES
    ('${A}', '2026-11-02', 'วันหยุดท้องถิ่น A', false),
    ('${A}', '2026-10-23', 'A เปิดทำการวันปิยมหาราช', true)`)
  assert.equal(await addDb('2026-10-30', 1, A), '2026-11-03')
  assert.equal(await addDb('2026-10-30', 1, B), '2026-11-02')
  assert.equal(await addDb('2026-10-22', 1, A), '2026-10-23')
  assert.equal(await addDb('2026-10-22', 1, B), '2026-10-26')
})

await test('ข้ามปี: 31 ธ.ค. 2569 หยุด · ปี 2570 ยังไม่มีข้อมูลจึงตัดแค่เสาร์-อาทิตย์', async () => {
  assert.equal(await addDb('2026-12-30', 3, A), '2027-01-05')
})

await test('ผลตรงกับตัวนับฝั่งหน้าเว็บ (addWorkingDays) ทุกวัน ต.ค. 2569 – ม.ค. 2570', async () => {
  const warn = console.warn
  console.warn = () => {} // ปี 2570 ไม่มีข้อมูล ฝั่งเว็บเตือนทุกครั้ง
  try {
    let compared = 0
    for (const muni of [A, B]) {
      const rows = (await db.query(
        `SELECT municipality_id, holiday_date::text AS holiday_date, name, is_working_day
         FROM public.public_holidays WHERE municipality_id IS NULL OR municipality_id = $1 ORDER BY holiday_date`, [muni])).rows
      setHolidayRows(rows)
      for (let day = Date.UTC(2026, 9, 1); day <= Date.UTC(2027, 0, 31); day += 86400000) {
        const start = new Date(day).toISOString().slice(0, 10)
        for (const n of [1, 2, 3, 5, 7, 10]) {
          assert.equal(await addDb(start, n, muni), addWorkingDays(start, n), `${muni === A ? 'A' : 'B'} ${start} + ${n}`)
          compared++
        }
      }
    }
    assert.ok(compared > 1400)
  } finally {
    console.warn = warn
  }
})

await test('client เรียกฟังก์ชันตรงไม่ได้ (ใช้ผ่าน trigger เท่านั้น)', async () => {
  for (const role of ['anon', 'authenticated']) {
    const r = await one(`SELECT has_function_privilege('${role}', 'public.add_working_days(date,integer,uuid)', 'EXECUTE') AS ok`)
    assert.equal(r.ok, false, role)
  }
})

await db.exec(triggerMigration)

await test('ขั้น 2: แปลงตัวเลขเป็นวันทำการ 10 → 7, 3 → 2 · ค่าว่างคงว่าง · ค่าเริ่มต้นใหม่ = 2', async () => {
  const rows = (await db.query(`SELECT municipality_id, category, sla_days FROM public.category_assignments ORDER BY 1, 2`)).rows
  assert.deepEqual(rows.map(r => [r.municipality_id === A ? 'A' : 'B', r.category, r.sla_days]), [
    ['A', 'light', 7], ['A', 'odd', null], ['A', 'water_repair', 2], ['B', 'light', 7],
  ])
  await db.exec(`INSERT INTO public.category_assignments (municipality_id, category) VALUES ('${B}', 'fresh')`)
  assert.equal((await one(`SELECT sla_days FROM public.category_assignments WHERE category = 'fresh'`)).sla_days, 2)
})

await test('trigger: วันกำหนดเสร็จ = วันแจ้ง + วันทำการของหมวด · ยังมอบหมายช่างเหมือนเดิม', async () => {
  const r = await db.transaction(async (tx) => {
    const ins = (await tx.query(`INSERT INTO public.complaints (municipality_id, category) VALUES
      ($1, 'light'), ($1, 'odd'), ($1, 'no_rule'), ($2, 'light') RETURNING category, municipality_id, assigned_to, due_date::text AS due`, [A, B])).rows
    const today = (await tx.query(`SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS d`)).rows[0].d
    const expect = async (n, muni) => (await tx.query('SELECT public.add_working_days($1::date, $2, $3::uuid)::text AS d', [today, n, muni])).rows[0].d
    return { ins, e7A: await expect(7, A), e2A: await expect(2, A), e7B: await expect(7, B) }
  })
  const [light, odd, noRule, lightB] = r.ins
  assert.equal(light.due, r.e7A)
  assert.equal(light.assigned_to, TECH)
  assert.equal(odd.due, r.e2A, 'แถวที่ไม่ได้ตั้งตัวเลขใช้ค่าเริ่มต้น 2 วันทำการ')
  assert.equal(noRule.due, r.e2A, 'หมวดที่ไม่มีผังใช้ค่าเริ่มต้น 2 วันทำการ')
  assert.equal(lightB.due, r.e7B)
})

await test('trigger: ถ้าส่ง due_date มาเองจะไม่ถูกคำนวณทับ', async () => {
  const r = await one(`INSERT INTO public.complaints (municipality_id, category, due_date) VALUES ('${A}', 'light', '2030-01-01') RETURNING due_date::text AS due`)
  assert.equal(r.due, '2030-01-01')
})

await test('ด่านกันรันซ้ำ: รันขั้น 2 อีกรอบต้องหยุด และตัวเลขไม่ถูกแปลงซ้ำ (7 ไม่กลายเป็น 5)', async () => {
  await assert.rejects(db.exec(triggerMigration), /ไม่ใช่เวอร์ชันนับวันปฏิทิน/)
  await db.exec('ROLLBACK')
  assert.equal((await one(`SELECT sla_days FROM public.category_assignments WHERE municipality_id = '${A}' AND category = 'light'`)).sla_days, 7)
})

await db.close()
console.log(`\n${cases} cases passed`)
