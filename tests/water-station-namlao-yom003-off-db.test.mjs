// ปิดสถานีระดับน้ำ YOM003 เฉพาะน้ำเลา (migration 20261018120000) — รันจริงบน PGlite (Postgres ในหน่วยความจำ)
//   node tests/water-station-namlao-yom003-off-db.test.mjs --pglite <โฟลเดอร์>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง (มือ ไม่อยู่ CI เหมือน water-dam-history-db)
//
// เรื่องที่ต้องไม่พลาด:
//  (1) ปิดเฉพาะ "น้ำเลา + ระดับน้ำ + YOM003" แถวเดียว — สถานีฝนรหัส YOM003 ของน้ำเลา (ถ้ามี) ไม่ถูกแตะ
//  (2) ทุ่งแค้ว/ตำหนักธรรม/demo ยังเปิด YOM003 ของตัวเองครบ · อ่าง/ฝน/ระดับน้ำรหัสอื่นของน้ำเลาไม่ถูกแตะ
//  (3) Y.38 ของน้ำเลาที่ปิดอยู่แล้วต้องไม่ถูกบันทึกเวลาแก้ซ้ำ · รันซ้ำไม่ขยับอะไร
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sql = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const F_OFF = '20261018120000_water_station_namlao_yom003_off.sql'
const PREREQ = [
  '20260918150000_water_station_config_table.sql',
  '20260918180000_water_station_type_dam.sql',
  '20260919100000_water_station_type_ews.sql',
]

const SETUP = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.municipalities (
  id uuid PRIMARY KEY, slug text NOT NULL, name text, district text, province text,
  is_active boolean NOT NULL DEFAULT true, enabled_modules text[]
);
`
const N = '00000000-0000-4000-8000-00000000000a' // น้ำเลา
const T = '00000000-0000-4000-8000-00000000000b' // ตำหนักธรรม
const D = '00000000-0000-4000-8000-00000000000c' // demo
const K = '00000000-0000-4000-8000-00000000000d' // ทุ่งแค้ว
const MUNIS = `
INSERT INTO public.municipalities (id, slug, name, district, province, is_active) VALUES
  ('${N}', 'namlao', 'น้ำเลา', 'ร้องกวาง', 'แพร่', true),
  ('${T}', 'tamnaktham', 'ตำหนักธรรม', 'หนองม่วงไข่', 'แพร่', true),
  ('${D}', 'demo', 'สาธิต', 'ร้องกวาง', 'แพร่', true),
  ('${K}', 'thungkaew', 'ทุ่งแค้ว', 'สอง', 'แพร่', true);
`

const offText = await sql(F_OFF)
const code = offText.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

// ── 0) อ่านไฟล์ ──
{
  assert.equal((code.match(/\bUPDATE\b/gi) || []).length, 1, 'ต้องมี UPDATE เดียว')
  assert.ok(!/\b(DELETE|DROP|TRUNCATE|INSERT|ALTER)\b/i.test(code), 'ห้ามมีคำสั่งอื่นนอกจาก UPDATE')
  for (const need of ["m.slug = 'namlao'", "c.station_type = 'waterlevel'", "c.station_code = 'YOM003'", 'AND c.is_active'])
    assert.ok(code.includes(need), `เงื่อนไขขาด: ${need}`)
  console.log('✓ ไฟล์: UPDATE เดียว · เงื่อนไข slug+ชนิด+รหัส+is_active ครบ · ไม่มีคำสั่งทำลายข้อมูล')
}

// ── 1) ผลจริงบนฐานข้อมูลจำลอง ──
{
  const db = new PGlite()
  await db.exec(SETUP)
  for (const f of PREREQ) await db.exec(await sql(f))
  await db.exec(MUNIS)
  await db.exec(`
    INSERT INTO public.water_station_config (municipality_id, station_type, station_code, station_name, distance_km, is_active) VALUES
      ('${N}', 'waterlevel', 'YOM003', 'หนองม่วงไข่', 14.1, true),
      ('${N}', 'waterlevel', 'Y.38', 'บ้านแม่คำมีตำหนักธรรม', 7.7, false),
      ('${N}', 'rain', 'YOM003', 'สถานีฝนรหัสซ้ำ', 14.1, true),
      ('${N}', 'rain', 'STN0911', 'บ้านบุญแจ่ม', 2.0, true),
      ('${N}', 'dam', '305', 'แม่คำปอง', 3.6, true),
      ('${N}', 'dam', '304', 'แม่ถาง', 4.3, true),
      ('${D}', 'waterlevel', 'YOM003', 'หนองม่วงไข่', 14.1, true),
      ('${D}', 'waterlevel', 'Y.38', 'บ้านแม่คำมีตำหนักธรรม', 7.7, true),
      ('${T}', 'waterlevel', 'YOM003', 'หนองม่วงไข่', 6.6, true),
      ('${T}', 'waterlevel', 'Y.38', 'บ้านแม่คำมีตำหนักธรรม', 0.7, true),
      ('${T}', 'rain', 'YOM003', 'หนองม่วงไข่', 6.6, true),
      ('${K}', 'waterlevel', 'YOM003', 'หนองม่วงไข่', 4.8, true),
      ('${K}', 'rain', 'YOM003', 'หนองม่วงไข่', 4.8, true);
    UPDATE public.water_station_config SET updated_at = '2000-01-01T00:00:00Z';
  `)
  await db.exec(offText)
  const state = async () => Object.fromEntries((await db.query(
    `SELECT m.slug||'/'||c.station_type||'/'||c.station_code AS k, c.is_active AS a, c.updated_at < '2001-01-01' AS untouched
       FROM public.water_station_config c JOIN public.municipalities m ON m.id = c.municipality_id`)).rows.map(r => [r.k, r]))
  const s = await state()
  assert.equal(s['namlao/waterlevel/YOM003'].a, false, 'YOM003 ระดับน้ำของน้ำเลาต้องปิด')
  assert.equal(s['namlao/waterlevel/YOM003'].untouched, false, 'ต้องบันทึกเวลาแก้')
  for (const key of ['namlao/rain/YOM003', 'namlao/rain/STN0911', 'namlao/dam/305', 'namlao/dam/304',
    'demo/waterlevel/YOM003', 'demo/waterlevel/Y.38', 'tamnaktham/waterlevel/YOM003', 'tamnaktham/waterlevel/Y.38',
    'tamnaktham/rain/YOM003', 'thungkaew/waterlevel/YOM003', 'thungkaew/rain/YOM003']) {
    assert.equal(s[key].a, true, `${key} ต้องยังเปิด`)
    assert.equal(s[key].untouched, true, `${key} ต้องไม่ถูกแตะ`)
  }
  assert.equal(s['namlao/waterlevel/Y.38'].a, false, 'Y.38 ของน้ำเลายังปิดอยู่')
  assert.equal(s['namlao/waterlevel/Y.38'].untouched, true, 'Y.38 ที่ปิดอยู่แล้วต้องไม่ถูกบันทึกเวลาแก้ซ้ำ')
  console.log('✓ ผล: ปิดเฉพาะ namlao/waterlevel/YOM003 · ฝนรหัสซ้ำ/อ่าง/สถานีฝนของน้ำเลา · ทุ่งแค้ว ตำหนักธรรม demo ไม่ถูกแตะ')

  await db.exec(`UPDATE public.water_station_config SET updated_at = '2000-01-01T00:00:00Z'`)
  await db.exec(offText) // รันซ้ำ
  const again = await state()
  for (const [k, v] of Object.entries(again)) assert.equal(v.untouched, true, `รันซ้ำแล้ว ${k} ต้องไม่ขยับ`)
  assert.equal(again['namlao/waterlevel/YOM003'].a, false)
  console.log('✓ รันซ้ำไม่ขยับอะไร')
}
console.log('\nผ่านทั้งหมด')
