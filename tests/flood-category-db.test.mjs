// หมวดคำร้องมาตรฐาน "น้ำท่วม/ระบายน้ำ" (flood) — รัน migration จริงใน PostgreSQL จำลอง (PGlite) ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//   node tests/flood-category-db.test.mjs --pglite <โฟลเดอร์>/node_modules/@electric-sql/pglite/dist/index.js
// ฟังก์ชัน resolve_work_department กับ trigger "หมวดที่เปิดอยู่ต้องมีกอง" ตัดจากไฟล์ที่ production รันอยู่ ไม่เขียนมือ
//
// ล็อก: สร้าง flood ให้ทุก อปท. ที่ยังไม่มี · กองช่าง · นโยบายเปิด/ผู้ยื่นคัดลอกจาก water_supply ของ อปท. นั้น (ไม่เปิดช่องทางใหม่ให้ อปท. ที่ปิดไว้)
//       · ไม่มีกอง = ปิด (ไม่ชน trigger) · ไม่แตะ flood ที่มีอยู่ · รันซ้ำไม่เปลี่ยนอะไร
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const sqlFile = relative => readFile(new URL(relative, import.meta.url), 'utf8')

const resolverSource = await sqlFile('../supabase/migrations/20260802071000_scope_department_operational_records.sql')
const resolverStart = resolverSource.indexOf('CREATE OR REPLACE FUNCTION public.resolve_work_department(')
const resolverFunction = resolverSource.slice(resolverStart, resolverSource.indexOf('$$;', resolverStart) + 3)
assert.ok(resolverStart >= 0 && resolverFunction.includes('LIMIT 1'), 'ตัดนิยาม resolve_work_department ไม่ได้')
const guardSource = await sqlFile('../supabase/migrations/20260901170000_manual_document_signatories.sql')
const guardStart = guardSource.indexOf('CREATE OR REPLACE FUNCTION public.guard_active_category_requires_department()')
const guardFunction = guardSource.slice(guardStart, guardSource.indexOf('$$;', guardStart) + 3)
assert.ok(guardStart >= 0 && guardFunction.includes('RAISE EXCEPTION'), 'ตัดนิยาม trigger กองไม่ได้')
const migration = await sqlFile('../supabase/migrations/20261024120000_flood_standard_category.sql')

const id = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const M = { open: id(1), closed: id(2), noSupply: id(3), noDept: id(4), hasFlood: id(5), nameOnly: id(6), openNoDept: id(7), empty: id(8) }

const db = new PGlite()
await db.exec(`
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text);
CREATE TABLE public.departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, code text, name text, sort_order int DEFAULT 0);
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid);
CREATE TABLE public.complaint_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id),
  value text NOT NULL, label text NOT NULL, emoji text NOT NULL DEFAULT '📝', color text NOT NULL DEFAULT '#F3F4F6', text_color text NOT NULL DEFAULT '#374151',
  sort_order int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, is_adhoc boolean NOT NULL DEFAULT false,
  submit_audience text NOT NULL DEFAULT 'public' CHECK (submit_audience IN ('public', 'officials')),
  requires_manual_intake boolean NOT NULL DEFAULT false, requires_resolved_location boolean NOT NULL DEFAULT true,
  department_id uuid,
  CONSTRAINT complaint_categories_unique_value UNIQUE (municipality_id, value)
);
${resolverFunction}
${guardFunction}
CREATE TRIGGER trg_active_category_requires_department BEFORE INSERT OR UPDATE OF is_active, department_id
ON public.complaint_categories FOR EACH ROW EXECUTE FUNCTION public.guard_active_category_requires_department();
`)

const insertMuni = (muni, slug) => db.query('INSERT INTO public.municipalities (id, slug) VALUES ($1, $2)', [muni, slug])
const insertDept = async (muni, code, name, sort = 0) => (await db.query('INSERT INTO public.departments (municipality_id, code, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id', [muni, code, name, sort])).rows[0].id
const insertCat = (muni, value, extra = {}) => db.query(
  'INSERT INTO public.complaint_categories (municipality_id, value, label, sort_order, is_active, submit_audience, department_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
  [muni, value, extra.label ?? value, extra.sort ?? 0, extra.active ?? true, extra.audience ?? 'public', extra.dept ?? null])
const flood = async muni => (await db.query('SELECT * FROM public.complaint_categories WHERE municipality_id = $1 AND value = $2', [muni, 'flood'])).rows

// ── ข้อมูลตั้งต้นเหมือนสถานการณ์จริง ──
// open: เปิดน้ำอุปโภคให้ทุกคน (ตำหนักธรรม/ทุ่งแค้ว) · closed: ปิด+เฉพาะผู้มีตำแหน่ง (น้ำเลา) · noSupply: ไม่มีหมวดน้ำอุปโภคเลย
for (const [key, slug] of Object.entries({ open: 'open', closed: 'closed', noSupply: 'no-supply', noDept: 'no-dept', hasFlood: 'has-flood', nameOnly: 'name-only', openNoDept: 'open-no-dept', empty: 'empty' })) await insertMuni(M[key], slug)
const eng = {}
for (const key of ['open', 'closed', 'noSupply', 'hasFlood']) eng[key] = await insertDept(M[key], 'engineering', 'กองช่าง')
await insertDept(M.open, 'general', 'สำนักปลัด', 5)
// กองช่างที่รหัสไม่ใช่ engineering แต่ชื่อ "กองช่าง" (ข้อมูลเก่า) ต้องหาเจอเหมือนเส้นทางคำขออื่น
eng.nameOnly = await insertDept(M.nameOnly, 'tech', 'กองช่าง')
await insertDept(M.noDept, 'general', 'สำนักปลัด')
await insertDept(M.openNoDept, 'general', 'สำนักปลัด')
await insertCat(M.open, 'light', { sort: 0, active: false }); await insertCat(M.open, 'water_supply', { sort: 7, active: true, audience: 'public', dept: eng.open })
await insertCat(M.closed, 'light', { sort: 0, active: false }); await insertCat(M.closed, 'water_supply', { sort: 12, active: false, audience: 'officials', dept: eng.closed })
await insertCat(M.noSupply, 'light', { sort: 3, active: false })
await insertCat(M.noDept, 'light', { sort: 2, active: false }); await insertCat(M.noDept, 'water_supply', { sort: 4, active: true, audience: 'public', dept: await insertDept(M.noDept, 'health', 'สาธารณสุข') })
await insertCat(M.hasFlood, 'flood', { label: 'ชื่อที่ อบต. ตั้งเอง', sort: 9, active: false, audience: 'officials', dept: eng.hasFlood })
await insertCat(M.nameOnly, 'water_supply', { sort: 1, active: true, audience: 'public', dept: eng.nameOnly })
await insertCat(M.openNoDept, 'water_supply', { sort: 1, active: true, audience: 'public', dept: await insertDept(M.openNoDept, 'health', 'สาธารณสุข') })

const before = (await db.query('SELECT count(*)::int AS n FROM public.complaint_categories')).rows[0].n
await db.exec(migration)

// ── 1) อปท. ที่เปิดน้ำอุปโภคให้ทุกคน: flood เปิดให้ทุกคน · กองช่าง · ต่อท้ายลำดับ ──
{
  const [row] = await flood(M.open)
  assert.equal(row.is_active, true); assert.equal(row.submit_audience, 'public'); assert.equal(row.department_id, eng.open, 'ต้องเป็นกองช่าง ไม่ใช่สำนักปลัด')
  assert.equal(row.label, 'น้ำท่วม/ระบายน้ำ'); assert.equal(row.emoji, '🌊'); assert.equal(row.is_adhoc, false)
  assert.equal(row.sort_order, 8, 'ต่อท้ายลำดับสูงสุดเดิม (7) + 1')
  assert.equal(row.requires_manual_intake, false); assert.equal(row.requires_resolved_location, true, 'ค่าตั้งต้นของหมวดทั่วไป')
}
// ── 2) น้ำเลา (ปิด + เฉพาะผู้มีตำแหน่ง): flood ปิด + เฉพาะผู้มีตำแหน่ง — ไม่เปิดช่องทางใหม่ให้ประชาชนของ อปท. ที่ใช้งานจริง ──
{
  const [row] = await flood(M.closed)
  assert.equal(row.is_active, false, 'ห้ามเปิดช่องทางใหม่ให้ประชาชนเอง'); assert.equal(row.submit_audience, 'officials'); assert.equal(row.department_id, eng.closed)
  assert.equal(row.sort_order, 13)
}
// ── 3) ไม่มีหมวดน้ำอุปโภคเลย: ปิด + เฉพาะผู้มีตำแหน่ง (ค่าปลอดภัย) แต่ผูกกองช่างไว้ให้ ──
{
  const [row] = await flood(M.noSupply)
  assert.equal(row.is_active, false); assert.equal(row.submit_audience, 'officials'); assert.equal(row.department_id, eng.noSupply); assert.equal(row.sort_order, 4)
}
// ── 4) ไม่มีกองช่าง: ปิดแม้นโยบายเปิด (trigger ห้ามเปิดโดยไม่มีกอง) · กองว่าง · ไม่ทำให้ migration ล้ม ──
for (const key of ['noDept', 'openNoDept']) {
  const [row] = await flood(M[key])
  assert.equal(row.is_active, false, `${key}: ไม่มีกองช่าง ต้องสร้างแบบปิด`); assert.equal(row.department_id, null)
}
assert.equal((await flood(M.openNoDept))[0].submit_audience, 'public', 'นโยบายผู้ยื่นยังคัดลอกมา แอดมินเลือกกองแล้วเปิดเองได้')
await assert.rejects(() => db.query('UPDATE public.complaint_categories SET is_active = true WHERE municipality_id = $1 AND value = $2', [M.noDept, 'flood']), /กอง|department|ระบุ/i, 'trigger เดิมยังกันการเปิดโดยไม่มีกอง')
// ── 5) กองช่างที่รหัสไม่ใช่ engineering แต่ชื่อ "กองช่าง" ──
assert.equal((await flood(M.nameOnly))[0].department_id, eng.nameOnly)
// ── 6) อปท. ที่มี flood อยู่แล้ว: ไม่แตะอะไรเลย ──
{
  const rows = await flood(M.hasFlood)
  assert.equal(rows.length, 1); assert.equal(rows[0].label, 'ชื่อที่ อบต. ตั้งเอง'); assert.equal(rows[0].is_active, false); assert.equal(rows[0].submit_audience, 'officials'); assert.equal(rows[0].sort_order, 9)
}
// ── 7) อปท. ที่ยังไม่มีหมวดใดเลย: sort_order เริ่ม 0 · ปิด (ไม่มีกอง) ──
{
  const [row] = await flood(M.empty)
  assert.equal(row.sort_order, 0); assert.equal(row.is_active, false)
}
// ── 8) ทุก อปท. มี flood ครบ 1 แถว · จำนวนแถวเพิ่มเท่ากับ อปท. ที่ยังไม่มี (7 จาก 8) ──
{
  const counts = (await db.query("SELECT municipality_id, count(*)::int AS n FROM public.complaint_categories WHERE value = 'flood' GROUP BY 1")).rows
  assert.equal(counts.length, 8); assert.ok(counts.every(r => r.n === 1))
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.complaint_categories')).rows[0].n, before + 7)
}
// ── 9) รันซ้ำ: ไม่เปลี่ยนอะไร ──
{
  const snapshot = async () => JSON.stringify((await db.query('SELECT municipality_id, value, label, is_active, submit_audience, sort_order, department_id FROM public.complaint_categories ORDER BY municipality_id, value')).rows)
  const first = await snapshot()
  await db.exec(migration)
  assert.equal(await snapshot(), first, 'รันซ้ำต้องไม่มีอะไรเปลี่ยน')
}
// ── 10) เปลี่ยนกองภายหลัง/เปิดเอง: แอดมินทำได้ตามปกติ (เปิดน้ำเลาให้ประชาชนด้วยการแก้แถวเดียว) ──
{
  await db.query("UPDATE public.complaint_categories SET is_active = true, submit_audience = 'public' WHERE municipality_id = $1 AND value = 'flood'", [M.closed])
  const [row] = await flood(M.closed)
  assert.equal(row.is_active, true); assert.equal(row.submit_audience, 'public')
}

console.log('✓ flood: ทุก อปท. ได้หมวดมาตรฐานครบ · กองช่าง · นโยบายเปิด/ผู้ยื่นตาม water_supply ของ อปท. นั้น · น้ำเลาปิดไว้ · ไม่มีกอง = ปิด · ของเดิมไม่ถูกแตะ · รันซ้ำปลอดภัย')
console.log('\n✅ flood-category-db: ผ่านทุกข้อ')
