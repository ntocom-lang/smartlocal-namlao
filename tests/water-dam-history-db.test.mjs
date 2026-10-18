// ฤดูแล้ง (เฟส 5 · PR 5.1) — เก็บค่าอ่างในรัศมี 10 กม. ไว้ 400 วัน + ฟังก์ชันอ่านประวัติ + ปิดอ่าง 2 แห่งของตำหนักธรรม
// รัน migration จริงบน PGlite (Postgres ในหน่วยความจำ):
//   node tests/water-dam-history-db.test.mjs --pglite <โฟลเดอร์>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง (มือ ไม่อยู่ CI เหมือน water-events-db)
//
// เรื่องที่ต้องไม่พลาด:
//  (1) เก็บยาวเฉพาะ "อ่าง + มีระยะ + ไม่เกิน 10 กม." — ไม่มีระยะ (NULL) ต้องตกไปลบที่ 7 วัน (NOT NULL = NULL ทำให้แถวไม่ถูกลบเลย)
//  (2) ฝน/ระดับน้ำ/อ่างนอกรัศมียังลบที่ 7 วัน · ข้อความเตือนยังลบที่ 7 วัน · ค่าคืนยังเป็น integer รวมสองตาราง
//  (3) ฟังก์ชันอ่านประวัติ: เฉพาะ อปท. ที่ถาม · เฉพาะอ่างที่เปิดใช้ในรัศมี · ค่าว่างไม่เป็น 0 (ค่า 0 จริงยังเป็น 0) · ครอบวัน 1..120
//  (4) ใครเรียกได้ — anon/authenticated เรียกฟังก์ชันอ่านได้ แต่เรียก cleanup/ค่านโยบายไม่ได้
//  (5) ปิดอ่างตำหนักธรรม: เฉพาะ 304/305 ของตำหนักธรรม · น้ำเลา/demo/สถานีอื่นไม่ถูกแตะ · รันซ้ำไม่ขยับอะไร
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sql = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const F_OFF = '20261018100200_water_station_tamnaktham_dams_off.sql'
const F_KEEP = '20261018100100_water_dam_history_retention.sql'
const PREREQ = [
  '20260918150000_water_station_config_table.sql',
  '20260918180000_water_station_type_dam.sql',
  '20260919100000_water_station_type_ews.sql',
  '20260918150100_water_readings_table.sql',
  '20260918180100_water_readings_dam_columns.sql',
  '20260919100200_water_warnings_table.sql',
]

const SETUP = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- จำลองสภาพ Supabase: ฟังก์ชันใหม่ให้สิทธิ์ anon/authenticated อัตโนมัติ (ต้นเหตุที่ไฟล์ต้อง REVOKE เอง)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public.municipalities (
  id uuid PRIMARY KEY, slug text NOT NULL, name text, district text, province text,
  is_active boolean NOT NULL DEFAULT true, enabled_modules text[]
);
`

const N = '00000000-0000-4000-8000-00000000000a' // น้ำเลา
const T = '00000000-0000-4000-8000-00000000000b' // ตำหนักธรรม
const D = '00000000-0000-4000-8000-00000000000c' // demo
const X = '00000000-0000-4000-8000-00000000000d' // อปท. ที่ปิดใช้งาน
const MUNIS = `
INSERT INTO public.municipalities (id, slug, name, district, province, is_active) VALUES
  ('${N}', 'namlao', 'น้ำเลา', 'ร้องกวาง', 'แพร่', true),
  ('${T}', 'tamnaktham', 'ตำหนักธรรม', 'หนองม่วงไข่', 'แพร่', true),
  ('${D}', 'demo', 'สาธิต', 'ร้องกวาง', 'แพร่', true),
  ('${X}', 'closed', 'ปิดใช้งาน', 'ร้องกวาง', 'แพร่', false);
`

async function newDb(files) {
  const db = new PGlite()
  await db.exec(SETUP)
  for (const f of PREREQ) await db.exec(await sql(f))
  await db.exec(MUNIS)
  for (const f of files) await db.exec(await sql(f))
  return db
}
const rows = async (db, statement, params = []) => (await db.query(statement, params)).rows

const fails = async (db, label, statement, pattern) => {
  try { await db.exec(statement) } catch (e) {
    assert.match(String(e.message), pattern, `${label}: error ผิดชนิด → ${e.message}`)
    return
  }
  assert.fail(`${label}: ควรล้มเหลวแต่สำเร็จ`)
}

const code = (text) => text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

const offText = await sql(F_OFF)
const keepText = await sql(F_KEEP)

// ── 0) อ่านไฟล์ ──
{
  const off = code(offText)
  assert.equal((off.match(/\bUPDATE\b/g) || []).length, 1, 'ไฟล์ปิดอ่างมี UPDATE เดียว')
  for (const word of ['DELETE', 'DROP', 'TRUNCATE', 'INSERT', 'ALTER TABLE', 'CREATE POLICY']) {
    assert.ok(!off.includes(word), `ไฟล์ปิดอ่างห้ามมี ${word}`)
  }
  assert.match(off, /m\.slug = 'tamnaktham'/, 'ปิดเฉพาะตำหนักธรรม')
  assert.match(off, /c\.station_code IN \('304', '305'\)/, 'เฉพาะอ่าง 304 กับ 305')
  assert.match(off, /c\.station_type = 'dam'/)
  assert.match(off, /AND c\.is_active;/, 'รันซ้ำไม่แตะแถวที่ปิดแล้ว')
  assert.match(off, /SET is_active = false/)

  const keep = code(keepText)
  assert.equal((keep.match(/SECURITY DEFINER/g) || []).length, 2, 'cleanup + ฟังก์ชันอ่านเป็น SECURITY DEFINER')
  assert.equal((keep.match(/SET search_path = pg_catalog/g) || []).length, 4, 'ทั้ง 4 ฟังก์ชันตั้ง search_path')
  assert.equal((keep.match(/10::numeric/g) || []).length, 1, 'รัศมี 10 อยู่ที่ฟังก์ชันค่านโยบายที่เดียว')
  assert.equal((keep.match(/SELECT 400\b/g) || []).length, 1, 'จำนวนวันเก็บ 400 อยู่ที่ฟังก์ชันค่านโยบายที่เดียว')
  assert.ok((keep.match(/water_dam_history_radius_km\(\)/g) || []).length >= 4, 'cleanup + ฟังก์ชันอ่านใช้ค่ารัศมีจากฟังก์ชันค่านโยบาย')
  assert.match(keep, /DELETE FROM public\.water_warnings WHERE issued_at < now\(\) - interval '7 days'/, 'ยังลบข้อความเตือนที่ 7 วัน')
  assert.match(keep, /ELSE r\.recorded_at < now\(\) - interval '7 days'/, 'ทุกอย่างอื่นยังลบที่ 7 วัน')
  assert.ok(!/NOT\s*\(/.test(keep.replace(/NOT NULL/g, '')), 'ห้ามใช้ NOT (...) กับเงื่อนไขที่อาจเป็น NULL')
  for (const word of ['CREATE POLICY', 'DROP ', 'TRUNCATE', 'ALTER TABLE', 'INSERT INTO', 'UPDATE public']) {
    assert.ok(!keep.includes(word), `ไฟล์เก็บประวัติห้ามมี ${word}`)
  }
  assert.ok(!/GRANT[^;]*(cleanup_old_water_readings|water_dam_history_(radius|keep))/i.test(keep), 'ห้ามเปิดสิทธิ์ cleanup/ค่านโยบาย')
  console.log('✓ ไฟล์: ปิดอ่างเฉพาะ 304/305 ของตำหนักธรรมด้วย UPDATE เดียว · ค่านโยบาย 10 กม./400 วันอยู่ที่เดียว · cleanup คงลบ 7 วันของทุกอย่างอื่น+ข้อความเตือน · ไม่มี NOT(...)')
}

// ── 1) ปิดอ่างตำหนักธรรม ──
{
  const db = await newDb([])
  await db.exec(`
    INSERT INTO public.water_station_config (municipality_id, station_type, station_code, station_name, distance_km, is_active) VALUES
      ('${N}', 'dam', '305', 'แม่คำปอง', 3.6, true), ('${N}', 'dam', '304', 'แม่ถาง', 4.3, true),
      ('${D}', 'dam', '305', 'แม่คำปอง', 3.6, true), ('${D}', 'dam', '304', 'แม่ถาง', 4.3, true),
      ('${T}', 'dam', '305', 'แม่คำปอง', 11.2, true), ('${T}', 'dam', '304', 'แม่ถาง', 10.2, true),
      ('${T}', 'dam', '999', 'อ่างอื่น', 5.0, true),
      ('${T}', 'rain', '305', 'สถานีฝนรหัสซ้ำ', 2.0, true),
      ('${T}', 'waterlevel', 'Y.38', 'Y.38', 0.7, true);
    UPDATE public.water_station_config SET updated_at = '2000-01-01T00:00:00Z';
  `)
  await db.exec(offText)
  const state = async () => Object.fromEntries((await rows(db,
    `SELECT m.slug||'/'||c.station_type||'/'||c.station_code AS k, c.is_active AS a, c.updated_at < '2001-01-01' AS untouched
       FROM public.water_station_config c JOIN public.municipalities m ON m.id = c.municipality_id`)).map(r => [r.k, r]))
  const s = await state()
  for (const key of ['tamnaktham/dam/305', 'tamnaktham/dam/304']) {
    assert.equal(s[key].a, false, `${key} ต้องปิด`)
    assert.equal(s[key].untouched, false, `${key} ต้องบันทึกเวลาแก้`)
  }
  for (const key of ['namlao/dam/305', 'namlao/dam/304', 'demo/dam/305', 'demo/dam/304', 'tamnaktham/dam/999', 'tamnaktham/rain/305', 'tamnaktham/waterlevel/Y.38']) {
    assert.equal(s[key].a, true, `${key} ต้องยังเปิด`)
    assert.equal(s[key].untouched, true, `${key} ต้องไม่ถูกแตะ`)
  }
  await db.exec(`UPDATE public.water_station_config SET updated_at = '2000-01-01T00:00:00Z'`)
  await db.exec(offText) // รันซ้ำ
  const again = await state()
  for (const [k, v] of Object.entries(again)) assert.equal(v.untouched, true, `รันซ้ำแล้ว ${k} ต้องไม่ขยับ`)
  assert.equal(again['tamnaktham/dam/305'].a, false)
  console.log('✓ ปิดอ่าง: เฉพาะ 304/305 ของตำหนักธรรม · น้ำเลา/demo/อ่างรหัสอื่น/ฝน-ระดับน้ำรหัสซ้ำ ไม่ถูกแตะ · รันซ้ำไม่ขยับอะไร')
}

// ── 2) เก็บค่าอ่างในรัศมี ──
const db = await newDb([F_KEEP])
const cfg = {}
{
  const ins = async (key, muni, type, code_, dist, active = true) => {
    const r = await rows(db,
      `INSERT INTO public.water_station_config (municipality_id, station_type, station_code, station_name, distance_km, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [muni, type, code_, key, dist, active])
    cfg[key] = r[0].id
  }
  await ins('305', N, 'dam', '305', 3.6)
  await ins('304', N, 'dam', '304', 4.3)
  await ins('E1', N, 'dam', 'E1', 10.0)       // พอดี 10.0 = อยู่ในรัศมี
  await ins('F1', N, 'dam', 'F1', 10.2)       // เกินรัศมี
  await ins('N0', N, 'dam', 'N0', null)       // ไม่มีระยะ
  await ins('I0', N, 'dam', 'I0', 3.0, false) // ปิดใช้งาน (แต่ยังอยู่ในรัศมี)
  await ins('R1', N, 'rain', 'R1', 2.0)
  await ins('L1', N, 'waterlevel', 'L1', 5.0)
  await ins('T1', T, 'dam', 'T1', 2.0)        // อปท. อื่น
  const ages = [0.5, 8, 100, 399, 401]
  for (const [key, id] of Object.entries(cfg)) {
    for (const age of ages) {
      await db.query(
        `INSERT INTO public.water_readings (station_config_id, recorded_at, storage_percent, dam_storage_mcm, dam_capacity_mcm)
         VALUES ($1, now() - make_interval(secs => $2), $3, $4, 6.76)`, [id, age * 86400, 50 + age / 100, 3 + age / 1000])
    }
  }
  await db.exec(`
    INSERT INTO public.water_warnings (issued_at, message) VALUES (now() - interval '6 days', 'เก่า 6 วัน'), (now() - interval '8 days', 'เก่า 8 วัน');
  `)
  const kind = (await rows(db, `SELECT prorettype::regtype::text AS t FROM pg_proc WHERE oid = 'public.cleanup_old_water_readings()'::regprocedure`))[0].t // ห้ามเรียกฟังก์ชันตรงนี้ — จะล้างข้อมูลก่อนเทสต์
  assert.equal(kind, 'integer', 'cleanup คืน integer เหมือนเดิม (cron เรียกแบบไม่อ่านค่า)')
}
{
  const left = async () => {
    const r = await rows(db,
      `SELECT c.station_name AS k, count(*)::int AS n, floor(max(extract(epoch FROM now() - r.recorded_at) / 86400))::int AS oldest_days
         FROM public.water_readings r JOIN public.water_station_config c ON c.id = r.station_config_id GROUP BY c.station_name`)
    return Object.fromEntries(r.map(x => [x.k, x]))
  }
  const before = await left()
  assert.equal(Object.values(before).every(x => x.n === 5), true, 'ก่อนล้าง ทุกสถานีมี 5 แถว')
  // ตัวเลขคืนค่า: อ่างในรัศมี 5 สถานี (305 304 E1 I0 T1) ลบแถว 401 วันสถานีละ 1 = 5
  //   สถานีอื่น 4 สถานี (F1 N0 R1 L1) ลบแถว 8/100/399/401 วัน สถานีละ 4 = 16 · ข้อความเตือน 1 → รวม 22
  const deleted = (await rows(db, `SELECT public.cleanup_old_water_readings() AS d`))[0].d
  assert.equal(deleted, 22, `ลบรวม 22 (readings 21 + warnings 1) ได้ ${deleted}`)
  const after = await left()
  for (const k of ['305', '304', 'E1', 'I0', 'T1']) {
    assert.equal(after[k].n, 4, `${k} (อ่างในรัศมี) เหลือ 4 แถว: 0.5/8/100/399 วัน`)
    assert.ok(after[k].oldest_days >= 398 && after[k].oldest_days <= 399, `${k} แถวเก่าสุดต้องราว 399 วัน`)
  }
  for (const k of ['F1', 'N0', 'R1', 'L1']) {
    assert.equal(after[k].n, 1, `${k} (นอกรัศมี/ไม่มีระยะ/ฝน/ระดับน้ำ) เหลือแถวเดียว: ภายใน 7 วัน`)
    assert.equal(after[k].oldest_days, 0, `${k} เหลือเฉพาะแถว 0.5 วัน`)
  }
  assert.deepEqual((await rows(db, `SELECT message FROM public.water_warnings`)).map(r => r.message), ['เก่า 6 วัน'], 'ข้อความเตือนลบที่ 7 วันเหมือนเดิม')
  assert.equal((await rows(db, `SELECT public.cleanup_old_water_readings() AS d`))[0].d, 0, 'รันซ้ำไม่ลบอะไรเพิ่ม')
  console.log('✓ cleanup: อ่างในรัศมี (รวม 10.0 พอดี + ที่ปิดใช้งาน) เก็บ 400 วัน · เกิน 10.2 / ไม่มีระยะ / ฝน / ระดับน้ำ ลบที่ 7 วัน · ข้อความเตือน 7 วัน · คืน 22 · รันซ้ำ 0')
}

// ── 3) ฟังก์ชันอ่านประวัติ ──
const hist = async (muni, days) => {
  const r = days === undefined
    ? await rows(db, `SELECT public.get_public_dam_history($1) AS j`, [muni])
    : await rows(db, `SELECT public.get_public_dam_history($1, $2) AS j`, [muni, days])
  return r[0].j
}
{
  const j = await hist(N)
  assert.equal(j.days, 30); assert.equal(Number(j.radius_km), 10)
  assert.deepEqual(j.dams.map(d => d.station_code), ['305', '304', 'E1'], 'เฉพาะอ่างที่เปิดใช้ในรัศมี เรียงใกล้→ไกล (ไม่มี F1 เกินรัศมี · N0 ไม่มีระยะ · I0 ปิดใช้งาน · ฝน/ระดับน้ำ · T1 ของ อปท. อื่น)')
  assert.deepEqual(j.dams[0].readings.map(r => Math.floor((Date.now() - Date.parse(r.recorded_at)) / 86400000)), [8, 0], 'ค่า 30 วัน: 8 วันก่อน แล้วค่าใหม่ — เรียงเก่า→ใหม่')
  assert.equal(Number(j.dams[0].readings[1].capacity_mcm), 6.76); assert.ok(j.dams[0].readings[1].storage_percent !== undefined)
  assert.equal(Number(j.dams[0].distance_km), 3.6)
  assert.equal(JSON.stringify(j).includes('"is_active"'), false, 'ไม่ส่งสถานะภายใน')
  assert.equal(JSON.stringify(j).includes(cfg['305']), false, 'ไม่ส่ง id ภายใน')

  const jt = await hist(T)
  assert.deepEqual(jt.dams.map(d => d.station_code), ['T1'], 'อปท. อื่นเห็นเฉพาะอ่างของตัวเอง')
  const jd = await hist(D)
  assert.deepEqual(jd.dams, [], 'อปท. ที่ไม่มีอ่าง ได้ [] ไม่ใช่ NULL')
  assert.equal((await hist(null)), null, 'NULL → NULL')
  assert.equal((await hist('00000000-0000-4000-8000-0000000000ff')), null, 'ไม่รู้จัก อปท. → NULL')
  assert.equal((await hist(X)), null, 'อปท. ที่ปิดใช้งาน → NULL')
  console.log('✓ อ่านประวัติ: เฉพาะ อปท. ที่ถาม · อ่างเปิดใช้ในรัศมี เรียงใกล้→ไกล · ไม่มี id/สถานะภายใน · NULL/ไม่รู้จัก/ปิดใช้งาน → NULL · ไม่มีอ่าง → []')
}
{
  const count = async (days) => (await hist(N, days)).dams[0].readings.length
  assert.equal(await count(), 2, 'ค่าเริ่มต้น 30 วัน')
  assert.equal(await count(120), 3, '120 วัน = 0.5/8/100')
  assert.equal(await count(9999), 3, 'เกิน 120 ครอบที่ 120 (ไม่ดึง 399 วัน)'); assert.equal((await hist(N, 9999)).days, 120)
  assert.equal(await count(0), 1, '0 วัน ครอบเป็น 1'); assert.equal((await hist(N, 0)).days, 1)
  assert.equal((await hist(N, -5)).days, 1); assert.equal((await hist(N, null)).days, 30, 'NULL วัน → 30')
  assert.equal(await count(7), 1, '7 วัน เห็นเฉพาะแถว 0.5 วัน (แถว 8 วันอยู่นอก)')
  console.log('✓ จำนวนวัน: ค่าเริ่มต้น 30 · ครอบ 1..120 · NULL → 30 · ไม่ดึงเกินที่หน้าเว็บต้องใช้')
}
{
  // ค่าว่างไม่เป็น 0 / ค่า 0 จริงยังเป็น 0
  await db.exec(`
    DELETE FROM public.water_readings WHERE station_config_id = '${cfg['304']}';
    INSERT INTO public.water_readings (station_config_id, recorded_at, storage_percent, dam_storage_mcm, dam_inflow_mcm, dam_released_mcm)
    VALUES ('${cfg['304']}', now() - interval '2 days', NULL, 5.5, 0, NULL),
           ('${cfg['304']}', now() - interval '1 days', 0, NULL, NULL, NULL);
  `)
  const r = (await hist(N)).dams.find(d => d.station_code === '304').readings
  assert.equal('storage_percent' in r[0], false, 'storage_percent ว่าง → ไม่ปรากฏ (ไม่เป็น 0)')
  assert.equal(Number(r[0].storage_mcm), 5.5)
  assert.equal(Number(r[0].inflow_mcm), 0, 'ไหลเข้า 0 จริง ยังเป็น 0')
  assert.equal('released_mcm' in r[0], false, 'ระบายว่าง → ไม่ปรากฏ')
  assert.equal(Number(r[1].storage_percent), 0, 'ค่า 0% จริง ยังเป็น 0')
  assert.equal('storage_mcm' in r[1], false)
  const empty = (await hist(N)).dams.find(d => d.station_code === '305')
  await db.exec(`DELETE FROM public.water_readings WHERE station_config_id = '${cfg['305']}'`)
  const none = (await hist(N)).dams.find(d => d.station_code === '305')
  assert.deepEqual(none.readings, [], 'อ่างที่ไม่มีแถวในช่วง ได้ readings = [] ไม่ใช่ key หาย'); assert.ok(empty.readings.length > 0)
  console.log('✓ ค่าว่างไม่เป็น 0: ช่องว่างไม่ปรากฏ · 0 จริงยังเป็น 0 · อ่างไม่มีแถวได้ readings []')
}

// ── 4) ใครเรียกได้ ──
{
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`)
    try {
      const r = await db.query(`SELECT public.get_public_dam_history('${N}') AS j`)
      assert.ok(r.rows[0].j.dams.length >= 1, `${role} เรียกฟังก์ชันอ่านได้`)
    } finally { await db.exec('RESET ROLE') }
    for (const call of ['public.cleanup_old_water_readings()', 'public.water_dam_history_radius_km()', 'public.water_dam_history_keep_days()']) {
      await db.exec(`SET ROLE ${role}`)
      try { await fails(db, `${role} เรียก ${call}`, `SELECT ${call}`, /permission denied/i) } finally { await db.exec('RESET ROLE') }
    }
  }
  console.log('✓ สิทธิ์: anon/authenticated เรียกฟังก์ชันอ่านได้ · เรียก cleanup และค่านโยบายไม่ได้')
}

console.log('\n✅ water-dam-history-db: ผ่านทุกข้อ')
