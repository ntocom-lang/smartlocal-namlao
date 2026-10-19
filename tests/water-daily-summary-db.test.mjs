// สรุปรายวันของสถานีน้ำ-ฝน (water_daily_summary_tick) — รัน migration จริง 2 ไฟล์ใน PostgreSQL จำลอง (PGlite)
// node tests/water-daily-summary-db.test.mjs --pglite <โฟลเดอร์>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง · จำลองเวลาด้วยพารามิเตอร์ _now / _days_back
//
// เรื่องที่ต้องไม่พลาด: (1) วันตามเวลาไทย — 23:59 ไทยยังเป็นวันเดิม 00:00 ไทยเป็นวันใหม่ ข้ามปีไม่เพี้ยน
// (2) ค่าว่างไม่เป็น 0 · ค่าติดลบ (ล้นตลิ่ง) ไม่ถูกตัดเป็น 0 (3) ไม่เขียนทับแถวที่ครบกว่าด้วยแถวที่ขาดกว่า (cleanup ลบข้อมูลดิบไปแล้ว)
// (4) ไม่ลบแถวสรุปเด็ดขาด แม้ข้อมูลดิบ/สถานีหาย (5) อปท. หนึ่งพังต้องไม่ลากอีกแห่งล้ม (6) ตารางปิดสนิทต่อ anon/authenticated
// (7) ไม่สรุปสถานีเตือนภัย (ews) / อปท. ที่ปิดโมดูล (8) apply แล้วย้อนเติมจากข้อมูลที่ยังไม่ถูกลบ
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sql = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const F_TABLE = '20261020150000_water_daily_summary_table.sql'
const F_TICK = '20261020150100_water_daily_summary_tick_cron.sql'
const PREREQ = [
  '20260918150000_water_station_config_table.sql',
  '20260918180000_water_station_type_dam.sql',
  '20260919100000_water_station_type_ews.sql',
  '20260918150100_water_readings_table.sql',
  '20260918180100_water_readings_dam_columns.sql',
  '20260928140000_job_heartbeats_table.sql',
  '20260928140100_job_heartbeats_rls.sql',
]

const SETUP = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- จำลองสภาพ Supabase: ตารางและฟังก์ชันใหม่ให้สิทธิ์ anon/authenticated อัตโนมัติ (ต้นเหตุของการต้องถอนสิทธิ์ในไฟล์ migration)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public.municipalities (
  id uuid PRIMARY KEY, slug text NOT NULL, name text, district text, province text,
  is_active boolean NOT NULL DEFAULT true, enabled_modules text[]
);
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql
  AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql
  AS $$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;
`

const guardDb = new PGlite()
await guardDb.exec(SETUP)
const db = new PGlite()
await db.exec(SETUP)

const fails = async (target, label, statement, pattern, params) => {
  try { params ? await target.query(statement, params) : await target.exec(statement) } catch (e) {
    assert.match(String(e.message), pattern, `${label}: error ผิดชนิด → ${e.message}`)
    return
  }
  assert.fail(`${label}: ควรล้มเหลวแต่สำเร็จ`)
}

// ── 0) ลำดับ apply ──
{
  await fails(guardDb, 'ไฟล์ตารางก่อนตารางต้นทาง', await sql(F_TABLE), /ต้อง apply 20260918150100/)
  await fails(guardDb, 'ไฟล์ฟังก์ชันก่อนไฟล์ตาราง', await sql(F_TICK), /ต้อง apply 20261020150000/)
  console.log('✓ ลำดับ apply: ไฟล์ที่มาก่อนเวลาถูกปฏิเสธพร้อมบอกว่าต้อง apply ไฟล์ไหนก่อน')
}

// ── 1) apply ตามลำดับ + apply ซ้ำได้ ──
for (const f of [...PREREQ, F_TABLE, F_TICK]) {
  const text = await sql(f)
  await db.exec(text)
  if (f === F_TABLE || f === F_TICK) { await db.exec(text); console.log('✓ apply ได้สองรอบ:', f) }
}
{
  const jobs = (await db.query(`SELECT jobname, schedule, command FROM cron.job`)).rows
  assert.equal(jobs.length, 1, 'apply ซ้ำแล้วต้องเหลืองานเดียว ไม่ซ้อน')
  assert.equal(jobs[0].jobname, 'water-daily-summary-tick-hourly')
  assert.equal(jobs[0].schedule, '30 * * * *', 'นาทีที่ 30 หลัง sync(10) notify(15) event(20) announce(25)')
  assert.match(jobs[0].command, /water_daily_summary_tick\(\)/)
  console.log('✓ cron: 1 งาน นาทีที่ 30 เรียก water_daily_summary_tick()')
}

// ── ตัวช่วยจำลอง ──
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let seq = 2000
const U = (d, h = 0, m = 0) => new Date(Date.UTC(2026, 9, d, h, m)).toISOString()   // 2026-10-dd hh:mm UTC
const NOW = U(20, 5, 30)                                                              // 12:30 น. ไทย วันที่ 20 ต.ค.
const tick = async (now = NOW, back = 0) => (await db.query(`SELECT public.water_daily_summary_tick($1::timestamptz, $2::int) AS r`, [now, back])).rows[0].r
const heartbeat = async () => (await db.query(`SELECT * FROM public.job_heartbeats WHERE job_name = 'water-daily-summary-tick'`)).rows[0]

async function mkTenant(slug, { modules = null, active = true } = {}) {
  const id = uuid(++seq)
  await db.query(
    `INSERT INTO public.municipalities (id, slug, name, district, province, is_active, enabled_modules) VALUES ($1, $2, $2, 'ร้องกวาง', 'แพร่', $3, $4::text[])`,
    [id, slug, active, modules])
  const t = { id, slug, st: {} }
  for (const [code, type] of [['R1', 'rain'], ['L1', 'waterlevel'], ['D1', 'dam']]) await addStation(t, code, type)
  return t
}
async function addStation(t, code, type, { active = true, distance = null, primary = false } = {}) {
  const sid = uuid(++seq)
  await db.query(
    `INSERT INTO public.water_station_config (id, municipality_id, station_type, station_code, station_name, is_active, distance_km, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [sid, t.id, type, code, `${t.slug}-${code}`, active, distance, primary])
  t.st[code] = sid
  return sid
}
// v: { r24, r1, lvl, bank, pct, mcm, cap } — ไม่ส่ง = ค่าว่าง (NULL)
async function feed(t, code, iso, v = {}) {
  await db.query(
    `INSERT INTO public.water_readings (station_config_id, recorded_at, rain_24h_mm, rain_1h_mm, waterlevel_msl, bank_diff_m, storage_percent, dam_storage_mcm, dam_capacity_mcm)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (station_config_id, recorded_at) DO UPDATE SET rain_24h_mm = EXCLUDED.rain_24h_mm, rain_1h_mm = EXCLUDED.rain_1h_mm,
       waterlevel_msl = EXCLUDED.waterlevel_msl, bank_diff_m = EXCLUDED.bank_diff_m, storage_percent = EXCLUDED.storage_percent,
       dam_storage_mcm = EXCLUDED.dam_storage_mcm, dam_capacity_mcm = EXCLUDED.dam_capacity_mcm`,
    [t.st[code], iso, v.r24 ?? null, v.r1 ?? null, v.lvl ?? null, v.bank ?? null, v.pct ?? null, v.mcm ?? null, v.cap ?? null])
}
const rows = async (t, code) => (await db.query(
  `SELECT to_jsonb(s) AS j FROM public.water_daily_summary s WHERE municipality_id = $1 AND station_code = $2 ORDER BY day`, [t.id, code])).rows.map(r => r.j)
const ms = (v) => (v ? new Date(v).getTime() : null)

// ── 2) สถานีฝน: ค่าสูงสุด พร้อมเวลา · ค่าว่างไม่เป็น 0 · ค่าเท่ากันเอาเวลาแรก ──
const A = await mkTenant('a-rain')
{
  await feed(A, 'R1', U(19, 17, 0), { r24: 2, r1: 0 })      // 00:00 ไทย 20 ต.ค. → วันที่ 20
  await feed(A, 'R1', U(19, 23, 0), { r24: 14.5, r1: 3 })   // 06:00 ไทย
  await feed(A, 'R1', U(20, 3, 0), { r24: 9, r1: 7.5 })     // 10:00 ไทย
  await feed(A, 'R1', U(20, 4, 0), {})                       // สถานีส่งแต่ค่าว่าง
  await feed(A, 'R1', U(20, 5, 0), { r24: 14.5, r1: 1 })    // ค่าเท่ากับสูงสุดเดิม (ภายหลัง) → ต้องคงเวลาแรก
  await feed(A, 'R1', U(19, 16, 59), { r24: 4 })            // 23:59 ไทย 19 ต.ค. → ต้องเป็นวันที่ 19
  const r = await tick(NOW, 1)
  assert.equal(r.ok, true); assert.equal(r.from_day, '2026-10-19'); assert.equal(r.to_day, '2026-10-20')
  const days = await rows(A, 'R1')
  assert.deepEqual(days.map(d => d.day), ['2026-10-19', '2026-10-20'], '23:59 ไทยเป็นวันเดิม 00:00 ไทยเป็นวันใหม่')
  const d19 = days[0], d20 = days[1]
  assert.equal(d19.readings_count, 1); assert.equal(d19.rain_24h_max_mm, 4)
  assert.equal(d20.readings_count, 5)
  assert.equal(d20.rain_24h_max_mm, 14.5)
  assert.equal(ms(d20.rain_24h_max_at), ms(U(19, 23, 0)), 'ค่าสูงสุดเท่ากัน เอาเวลาที่พบก่อน')
  assert.equal(d20.rain_1h_max_mm, 7.5); assert.equal(ms(d20.rain_1h_max_at), ms(U(20, 3, 0)))
  assert.equal(ms(d20.first_recorded_at), ms(U(19, 17, 0))); assert.equal(ms(d20.last_recorded_at), ms(U(20, 5, 0)))
  for (const k of ['bank_diff_min_m', 'waterlevel_max_msl', 'waterlevel_min_msl', 'dam_storage_last_mcm', 'dam_capacity_last_mcm', 'dam_storage_percent_last']) {
    assert.equal(d20[k], null, `สถานีฝนไม่มีค่า ${k} (ต้องเป็น NULL ไม่ใช่ 0)`)
  }
  assert.equal(d20.station_name, 'a-rain-R1'); assert.equal(d20.station_type, 'rain')
  console.log('✓ สถานีฝน: สูงสุด 24 ชม./1 ชม. พร้อมเวลา · เท่ากันเอาเวลาแรก · 23:59 ไทยยังเป็นวันเดิม · ช่องของสถานีชนิดอื่นเป็น NULL')
}

// ── 3) วันที่สถานีส่งแต่ค่าว่าง = มีแถว แต่ค่าเป็น NULL ไม่ใช่ 0 · วันที่ไม่มีค่าเลย = ไม่มีแถว ──
{
  await addStation(A, 'R2', 'rain')
  await feed(A, 'R2', U(20, 2, 0), {}); await feed(A, 'R2', U(20, 3, 0), {})
  await tick(NOW, 1)
  const d = await rows(A, 'R2')
  assert.equal(d.length, 1, 'วันที่ 19 ไม่มีค่าเลย = ไม่มีแถว')
  assert.equal(d[0].readings_count, 2)
  for (const k of ['rain_24h_max_mm', 'rain_24h_max_at', 'rain_1h_max_mm', 'rain_1h_max_at']) assert.equal(d[0][k], null, `${k} ต้องเป็น NULL (ค่าว่างไม่เป็น 0)`)
  console.log('✓ ค่าว่างทั้งวัน: มีแถวบอกว่าสถานีส่งมา แต่ค่าเป็น NULL ไม่ใช่ 0 · วันที่ไม่มีค่าเลยไม่มีแถว')
}

// ── 4) สถานีระดับน้ำ: ใกล้ตลิ่งสุด (รวมค่าติดลบ = ล้นตลิ่ง) · ระดับสูงสุด/ต่ำสุด ──
{
  // pct = % ความจุลำน้ำที่ต้นทางส่งมากับสถานีระดับน้ำ — ต้องไม่ถูกเก็บเป็นค่าอ่าง (dam_storage_percent_last)
  await feed(A, 'L1', U(20, 1, 0), { bank: 3.2, lvl: 150.4, pct: 12 })
  await feed(A, 'L1', U(20, 2, 0), { bank: -0.5, lvl: 151.9, pct: 18 })   // ล้นตลิ่ง — ห้ามถูกตัดเป็น 0 หรือหายไป
  await feed(A, 'L1', U(20, 3, 0), { bank: 1.5, lvl: 151.1, pct: 16 })
  await feed(A, 'L1', U(20, 4, 0), { pct: 20 })   // รายงานล่าสุดมีแต่ % ความจุลำน้ำ (ระดับน้ำ/ตลิ่งว่าง) — ต้องไม่ปนเป็นค่าอ่าง ไม่ทับค่าสูงสุด/ต่ำสุดเป็น 0
  await tick(NOW, 0)
  const [d] = await rows(A, 'L1')
  assert.equal(d.readings_count, 4)
  assert.equal(d.bank_diff_min_m, -0.5, 'ค่าติดลบ (ล้นตลิ่ง) ต้องคงเป็นค่าต่ำสุด')
  assert.equal(ms(d.bank_diff_min_at), ms(U(20, 2, 0)))
  assert.equal(d.waterlevel_max_msl, 151.9); assert.equal(ms(d.waterlevel_max_at), ms(U(20, 2, 0)))
  assert.equal(d.waterlevel_min_msl, 150.4)
  assert.equal(d.rain_24h_max_mm, null)
  assert.equal(d.dam_storage_percent_last, null, 'storage_percent ของสถานีระดับน้ำเป็น % ความจุลำน้ำ ห้ามเก็บเป็นค่าอ่าง')
  console.log('✓ สถานีระดับน้ำ: ใกล้ตลิ่งสุดรวมค่าติดลบ · ระดับสูงสุด/ต่ำสุด · % ความจุลำน้ำไม่ปนเป็นค่าอ่าง')
}

// ── 5) อ่าง: ค่าสุดท้ายที่ "ไม่ว่าง" ของวัน (ค่าว่างท้ายวันไม่ทับค่าจริง) ──
{
  await feed(A, 'D1', U(19, 17, 0), { mcm: 6.5, cap: 6.76, pct: 96.2 })
  await feed(A, 'D1', U(20, 3, 0), {})                              // รายงานท้ายวันแต่ค่าว่าง
  await tick(NOW, 0)
  let [d] = await rows(A, 'D1')
  assert.equal(d.readings_count, 2)
  assert.equal(d.dam_storage_last_mcm, 6.5); assert.equal(d.dam_capacity_last_mcm, 6.76); assert.equal(d.dam_storage_percent_last, 96.2)
  await feed(A, 'D1', U(20, 4, 0), { mcm: 6.4, cap: 6.8, pct: 94.7 })   // ความจุเปลี่ยนเล็กน้อย: ต้องเอาค่าของแถวสุดท้าย ไม่ใช่แถวแรก
  await tick(NOW, 0)
  ;[d] = await rows(A, 'D1')
  assert.equal(d.readings_count, 3); assert.equal(d.dam_storage_last_mcm, 6.4); assert.equal(d.dam_storage_percent_last, 94.7)
  assert.equal(d.dam_capacity_last_mcm, 6.8, 'ความจุต้องมาจากแถวสุดท้ายที่มีปริมาตร (แถวเดียวกับปริมาตร)')
  assert.equal(d.rain_24h_max_mm, null)
  console.log('✓ อ่าง: ค่าว่างท้ายวันไม่ทับค่าจริง · มีค่าใหม่กว่าก็ใช้ค่าใหม่ · ความจุ/% มาจากแถวเดียวกับปริมาตร')
}

// ── 6) รันซ้ำได้ผลเดิม · วันที่ยังไม่จบค่อยๆ ครบขึ้น ──
{
  const before = JSON.stringify((await rows(A, 'R1')).map(({ updated_at, ...rest }) => rest))
  await tick(NOW, 1); await tick(NOW, 1)
  assert.equal(JSON.stringify((await rows(A, 'R1')).map(({ updated_at, ...rest }) => rest)), before, 'รันซ้ำแล้วผลต้องเท่าเดิม')
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.water_daily_summary WHERE municipality_id = $1 AND station_code = 'R1'`, [A.id])).rows[0].n, 2, 'ไม่เพิ่มแถวซ้ำ')
  await feed(A, 'R1', U(20, 5, 20), { r24: 21, r1: 9 })
  await tick(U(20, 5, 30), 0)
  const d20 = (await rows(A, 'R1'))[1]
  assert.equal(d20.readings_count, 6); assert.equal(d20.rain_24h_max_mm, 21); assert.equal(ms(d20.rain_24h_max_at), ms(U(20, 5, 20)))
  assert.equal((await rows(A, 'R1'))[0].rain_24h_max_mm, 4, 'รอบเดียวกันไม่แตะวันอื่น')
  console.log('✓ รันซ้ำผลเท่าเดิม ไม่เพิ่มแถว · ค่าใหม่ของวันนี้ถูกรวมเข้าไปรอบถัดไป')
}

// ── 7) ค่าที่เวลาวัดอยู่หลังเวลาของรอบไม่ถูกนับ ──
{
  const F = await mkTenant('f-future')
  await feed(F, 'R1', U(20, 4, 0), { r24: 5 }); await feed(F, 'R1', U(20, 6, 0), { r24: 99 })   // 06:00Z อยู่หลัง NOW (05:30Z)
  await tick(NOW, 0)
  const [d] = await rows(F, 'R1')
  assert.equal(d.readings_count, 1); assert.equal(d.rain_24h_max_mm, 5, 'ค่าในอนาคตต้องไม่ถูกนับ')
  console.log('✓ ค่าที่เวลาวัดอยู่หลังเวลาของรอบไม่ถูกนับ')
}

// ── 8) ไม่สรุปสถานีเตือนภัย (ews) · ไม่สรุป อปท. ที่ปิดโมดูล/ปิดใช้งาน · สรุป อปท. ที่เปิดโมดูลน้ำ-ฝนเท่านั้น ──
{
  const G = await mkTenant('g-ews', { modules: ['water-situation', 'complaints'] })
  await addStation(G, 'E1', 'ews')
  await feed(G, 'E1', U(20, 4, 0), { r24: 50 }); await feed(G, 'R1', U(20, 4, 0), { r24: 1 })
  const H = await mkTenant('h-no-module', { modules: ['complaints'] })
  await feed(H, 'R1', U(20, 4, 0), { r24: 1 })
  const I = await mkTenant('i-inactive', { active: false })
  await feed(I, 'R1', U(20, 4, 0), { r24: 1 })
  const r = await tick(NOW, 0)
  assert.equal((await rows(G, 'E1')).length, 0, 'สถานีเตือนภัย (ews) ไม่ถูกสรุป')
  assert.equal((await rows(G, 'R1')).length, 1, 'อปท. ที่เปิดโมดูลน้ำ-ฝน (มีหลายโมดูล) ถูกสรุป')
  assert.equal((await rows(H, 'R1')).length, 0, 'อปท. ที่ไม่ได้เปิดโมดูลน้ำ-ฝนไม่ถูกสรุป')
  assert.equal((await rows(I, 'R1')).length, 0, 'อปท. ที่ปิดใช้งานไม่ถูกสรุป')
  assert.equal(r.ok, true)
  console.log('✓ ไม่สรุป ews · ไม่สรุป อปท. ที่ปิดโมดูล/ปิดใช้งาน · สรุป อปท. ที่เปิดโมดูลน้ำ-ฝน (รวมที่เปิดหลายโมดูล)')
}

// ── 9) ไม่เขียนทับแถวที่ครบกว่าด้วยแถวที่ขาดกว่า · ไม่ลบแถวสรุปแม้ข้อมูลดิบถูกลบหมด ──
{
  const J = await mkTenant('j-cleanup')
  for (const [h, v] of [[17, 3], [20, 12], [23, 7]]) await feed(J, 'R1', U(18, h, 0), { r24: v })   // วันที่ 19 (ไทย) 00:00/03:00/06:00
  await tick(NOW, 2)
  const full = await rows(J, 'R1')
  const d19 = full.find(d => d.day === '2026-10-19')
  assert.equal(d19.readings_count, 3); assert.equal(d19.rain_24h_max_mm, 12)
  // จำลอง cleanup_old_water_readings: ลบข้อมูลดิบของวันที่ 19 ไปบางส่วน (เหลือ 1 ค่า) แล้วสั่งย้อนหลังอีกรอบ
  await db.query(`DELETE FROM public.water_readings WHERE station_config_id = $1 AND recorded_at < $2`, [J.st.R1, U(18, 23, 0)])
  await tick(NOW, 2)
  const again = (await rows(J, 'R1')).find(d => d.day === '2026-10-19')
  assert.equal(again.readings_count, 3, 'ข้อมูลดิบถูกลบบางส่วนแล้ว ห้ามเขียนทับสรุปที่ครบกว่าด้วยสรุปที่ขาดกว่า')
  assert.equal(again.rain_24h_max_mm, 12, 'ค่าสูงสุดที่เคยพบต้องไม่หาย')
  // ลบข้อมูลดิบหมด → แถวสรุปยังอยู่ครบ
  await db.query(`DELETE FROM public.water_readings WHERE station_config_id = $1`, [J.st.R1])
  const r = await tick(NOW, 10)
  assert.equal(r.ok, true)
  assert.equal((await rows(J, 'R1')).length, full.length, 'ข้อมูลดิบหาย แถวสรุปต้องอยู่ครบ')
  console.log('✓ ข้อมูลดิบถูก cleanup บางส่วน/ทั้งหมด: สรุปเดิมไม่ถูกเขียนทับ ไม่ถูกลบ')
}

// ── 10) แถวที่มีค่าครบกว่า/เท่ากันแทนได้ (ต้นทางแก้ค่าย้อนหลังด้วยจำนวนเท่าเดิม) ──
{
  const K = await mkTenant('k-revise')
  await feed(K, 'R1', U(20, 3, 0), { r24: 5 })
  await tick(NOW, 0)
  await feed(K, 'R1', U(20, 3, 0), { r24: 8 })      // ต้นทางแก้ค่าที่เวลาเดิม (upsert ทับ) จำนวนแถวเท่าเดิม
  await tick(NOW, 0)
  assert.equal((await rows(K, 'R1'))[0].rain_24h_max_mm, 8, 'จำนวนค่าเท่าเดิมแต่ค่าถูกแก้ ต้องได้ค่าที่แก้แล้ว')
  console.log('✓ ต้นทางแก้ค่าที่เวลาเดิม (จำนวนเท่าเดิม): สรุปตามค่าที่แก้')
}

// ── 11) ขอบเขตย้อนหลัง: ครอบ 0–10 วัน · NULL = 2 ──
{
  assert.equal((await tick(NOW, -5)).from_day, '2026-10-20', 'ค่าติดลบครอบเป็น 0')
  assert.equal((await tick(NOW, 99)).from_day, '2026-10-10', 'เกิน 10 ครอบเป็น 10')
  const rr = (await db.query(`SELECT public.water_daily_summary_tick($1::timestamptz, NULL) AS r`, [NOW])).rows[0].r
  assert.equal(rr.from_day, '2026-10-18', 'NULL = ค่าเริ่มต้น 2 วัน')
  assert.equal((await db.query(`SELECT public.water_daily_summary_tick($1::timestamptz) AS r`, [NOW])).rows[0].r.from_day, '2026-10-18', 'ไม่ส่งพารามิเตอร์ = 2 วัน')
  console.log('✓ ย้อนหลังครอบ 0–10 วัน · ไม่ส่ง/NULL = 2 วัน')
}

// ── 12) ข้ามปีตามเวลาไทย: 31 ธ.ค. 17:00 UTC = 1 ม.ค. 00:00 ไทย ──
{
  const Y = await mkTenant('y-newyear')
  const iso = (m, d, h, mi = 0) => new Date(Date.UTC(2026, m, d, h, mi)).toISOString()
  await feed(Y, 'R1', iso(11, 31, 16, 59), { r24: 1 })
  await feed(Y, 'R1', iso(11, 31, 17, 0), { r24: 2 })
  const r = await tick(new Date(Date.UTC(2027, 0, 1, 5, 0)).toISOString(), 1)
  assert.equal(r.to_day, '2027-01-01'); assert.equal(r.from_day, '2026-12-31')
  assert.deepEqual((await rows(Y, 'R1')).map(d => [d.day, d.rain_24h_max_mm]), [['2026-12-31', 1], ['2027-01-01', 2]])
  console.log('✓ ข้ามปีตามเวลาไทย: 16:59 UTC 31 ธ.ค. = 31 ธ.ค. · 17:00 UTC = 1 ม.ค.')
}

// ── 12b) รอบที่รันหลังเที่ยงคืนไทย (17:00–24:00 UTC): "วันนี้" ของไทยเป็นวันถัดจากวันที่ของ UTC ──
{
  const W = await mkTenant('w-late')
  await feed(W, 'R1', U(20, 16, 30), { r24: 2 })    // 23:30 ไทย 20 ต.ค.
  await feed(W, 'R1', U(20, 17, 30), { r24: 6 })    // 00:30 ไทย 21 ต.ค.
  const r = await tick(U(20, 18, 0), 1)              // 01:00 ไทย 21 ต.ค. (UTC ยังเป็น 20 ต.ค.)
  assert.equal(r.to_day, '2026-10-21', 'วันนี้ของรอบ = วันไทย ไม่ใช่วันของ UTC'); assert.equal(r.from_day, '2026-10-20')
  assert.deepEqual((await rows(W, 'R1')).map(d => [d.day, d.rain_24h_max_mm]), [['2026-10-20', 2], ['2026-10-21', 6]])
  console.log('✓ รอบหลังเที่ยงคืนไทย (UTC ยังเป็นวันก่อน): วันนี้ = วันไทย · ค่าหลังเที่ยงคืนไทยเข้าวันใหม่')
}

// ── 13) สำเนาชื่อ/ระยะ/is_primary อัปเดตตามรอบล่าสุด · ลบสถานีแล้วสรุปเดิมยังอยู่ ──
{
  const L = await mkTenant('l-meta')
  await feed(L, 'R1', U(20, 3, 0), { r24: 3 })
  await tick(NOW, 0)
  await db.query(`UPDATE public.water_station_config SET station_name = 'ชื่อใหม่', distance_km = 4.2, is_primary = true WHERE id = $1`, [L.st.R1])
  await tick(NOW, 0)
  const d = (await rows(L, 'R1'))
  assert.equal(d.length, 1, 'เปลี่ยนชื่อสถานีแล้วต้องไม่เกิดแถวซ้ำ')
  assert.equal(d[0].station_name, 'ชื่อใหม่'); assert.equal(d[0].distance_km, 4.2); assert.equal(d[0].is_primary, true)
  await db.query(`DELETE FROM public.water_station_config WHERE id = $1`, [L.st.R1])
  assert.equal((await rows(L, 'R1')).length, 1, 'ลบสถานี (ข้อมูลดิบถูกลบตาม FK) สรุปเดิมต้องอยู่')
  console.log('✓ ชื่อ/ระยะ/is_primary อัปเดตตามรอบล่าสุดไม่เกิดแถวซ้ำ · ลบสถานีแล้วสรุปเดิมยังอยู่')
}

// ── 14) อปท. หนึ่งพัง ไม่ลาก อปท. อื่นล้ม · ลงสมุดลงเวลาเป็น error ไม่ทับ last_ok_at ──
{
  const M = await mkTenant('m-broken'); const N = await mkTenant('n-healthy')
  await feed(M, 'R1', U(20, 4, 0), { r24: 1 }); await feed(N, 'R1', U(20, 4, 0), { r24: 1 })
  assert.ok((await tick(NOW, 0)).ok)
  const okBefore = (await heartbeat()).last_ok_at
  assert.ok(okBefore, 'รอบสำเร็จลง last_ok_at')
  await db.exec(`DELETE FROM public.water_daily_summary WHERE municipality_id IN ('${M.id}', '${N.id}')`)
  await db.exec(`
    CREATE FUNCTION public.test_break_summary() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.municipality_id = '${M.id}' THEN RAISE EXCEPTION 'ทดสอบ: เขียนสรุปไม่ได้'; END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER test_break BEFORE INSERT ON public.water_daily_summary FOR EACH ROW EXECUTE FUNCTION public.test_break_summary();
  `)
  const r = await tick(NOW, 0)
  assert.equal(r.ok, false); assert.equal(r.errors.length, 1); assert.match(r.errors[0], /^m-broken: .*เขียนสรุปไม่ได้/)
  assert.equal((await rows(M, 'R1')).length, 0)
  assert.equal((await rows(N, 'R1')).length, 1, 'อปท. ที่ปกติยังถูกสรุปในรอบเดียวกัน')
  const hb = await heartbeat()
  assert.ok(hb.last_error_at); assert.match(hb.last_error, /m-broken/)
  assert.equal(new Date(hb.last_ok_at).getTime(), new Date(okBefore).getTime(), 'รอบที่มี error ไม่ทับ last_ok_at เดิม')
  await db.exec(`DROP TRIGGER test_break ON public.water_daily_summary; DROP FUNCTION public.test_break_summary();`)
  assert.ok((await tick(NOW, 0)).ok)
  assert.equal((await rows(M, 'R1')).length, 1, 'แก้แล้วรอบถัดไปสรุปได้เอง')
  console.log('✓ อปท. หนึ่งพัง: อีกแห่งยังทำงาน · ลงสมุดเป็น error ไม่ทับ last_ok_at · รอบถัดไปหายเอง')
}

// ── 15) ข้อจำกัดของตาราง ──
{
  const base = `INSERT INTO public.water_daily_summary (municipality_id, day, station_type, station_code, station_name, readings_count, first_recorded_at, last_recorded_at)`
  await fails(db, 'ชนิดสถานี ews', `${base} VALUES ('${A.id}', '2026-10-20', 'ews', 'x', 'x', 1, now(), now())`, /check constraint/)
  await fails(db, 'readings_count = 0', `${base} VALUES ('${A.id}', '2026-10-20', 'rain', 'x', 'x', 0, now(), now())`, /check constraint/)
  await fails(db, 'แถวซ้ำ (อปท./ชนิด/รหัส/วัน)', `${base} VALUES ('${A.id}', '2026-10-20', 'rain', 'R1', 'x', 1, now(), now())`, /duplicate key|primary key/)
  await fails(db, 'ไม่มี อปท.', `${base} VALUES ('${uuid(999999)}', '2026-10-20', 'rain', 'x', 'x', 1, now(), now())`, /foreign key/)
  const Z = await mkTenant('z-delete')
  await feed(Z, 'R1', U(20, 4, 0), { r24: 1 }); await tick(NOW, 0)
  await db.query(`DELETE FROM public.water_station_config WHERE municipality_id = $1`, [Z.id])
  await db.query(`DELETE FROM public.municipalities WHERE id = $1`, [Z.id])
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.water_daily_summary WHERE municipality_id = $1`, [Z.id])).rows[0].n, 0, 'ลบ อปท. ลบสรุปตาม ไม่ทิ้งแถวลอย')
  console.log('✓ ข้อจำกัด: ชนิด ews/จำนวน 0/แถวซ้ำ/ไม่มี อปท. ถูกปฏิเสธ · ลบ อปท. ลบสรุปตาม')
}

// ── 16) สิทธิ์: ตาราง+ฟังก์ชันปิดสนิทต่อ anon/authenticated (แม้ default privileges ให้ ALL) ──
{
  for (const role of ['anon', 'authenticated']) {
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      assert.equal((await db.query(`SELECT has_table_privilege('${role}', 'public.water_daily_summary', '${p}') AS ok`)).rows[0].ok, false, `${role} ต้องไม่มี ${p}`)
    }
    assert.equal((await db.query(`SELECT has_function_privilege('${role}', 'public.water_daily_summary_tick(timestamptz, integer)', 'EXECUTE') AS ok`)).rows[0].ok, false, `${role} ต้องเรียกฟังก์ชันไม่ได้`)
  }
  assert.equal((await db.query(`SELECT relrowsecurity AS ok FROM pg_class WHERE relname = 'water_daily_summary'`)).rows[0].ok, true, 'เปิด RLS')
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'water_daily_summary'`)).rows[0].n, 0, 'ไม่มี policy เปิดอ่านตรง')
  await db.exec('SET ROLE authenticated')
  try {
    await fails(db, 'authenticated อ่านตาราง', 'SELECT * FROM public.water_daily_summary', /permission denied/)
    await fails(db, 'authenticated เรียกฟังก์ชัน', 'SELECT public.water_daily_summary_tick()', /permission denied/)
  } finally { await db.exec('RESET ROLE') }
  await db.exec('SET ROLE anon')
  try {
    await fails(db, 'anon อ่านตาราง', 'SELECT * FROM public.water_daily_summary', /permission denied/)
    await fails(db, 'anon ลบตาราง', 'TRUNCATE public.water_daily_summary', /permission denied/)
    await fails(db, 'anon เรียกฟังก์ชัน', 'SELECT public.water_daily_summary_tick()', /permission denied/)
  } finally { await db.exec('RESET ROLE') }
  console.log('✓ สิทธิ์: anon/authenticated ไม่มีสิทธิ์ใดบนตาราง (รวม TRUNCATE) · เรียกฟังก์ชันไม่ได้ · RLS เปิด ไม่มี policy')
}

// ── 17) ตอน apply ไฟล์ฟังก์ชัน: ย้อนเติมจากข้อมูลดิบที่ยังมี (ราว 8 วัน) · เก่ากว่านั้นไม่เติม ──
{
  const b = new PGlite()
  await b.exec(SETUP)
  for (const f of [...PREREQ, F_TABLE]) await b.exec(await sql(f))
  const mid = uuid(5000); const sid = uuid(5001)
  await b.query(`INSERT INTO public.municipalities (id, slug, name, district, province) VALUES ($1, 'backfill', 'backfill', 'x', 'x')`, [mid])
  await b.query(`INSERT INTO public.water_station_config (id, municipality_id, station_type, station_code, station_name) VALUES ($1, $2, 'rain', 'R1', 'r1')`, [sid, mid])
  await b.exec(`INSERT INTO public.water_readings (station_config_id, recorded_at, rain_24h_mm) VALUES
    ('${sid}', now() - interval '3 days', 7), ('${sid}', now() - interval '3 days' - interval '1 hour', 9), ('${sid}', now() - interval '9 days', 50)`)
  await b.exec(await sql(F_TICK))
  const got = (await b.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, rain_24h_max_mm AS mx, readings_count AS n FROM public.water_daily_summary ORDER BY day`)).rows
  assert.ok(got.length >= 1 && got.length <= 2, `ย้อนเติมเฉพาะวันที่มีข้อมูลในช่วง 8 วัน (ได้ ${got.length} แถว)`)
  assert.equal(got.reduce((s, r) => s + r.n, 0), 2, 'ได้ 2 ค่าของ 3 วันก่อน (คร่อมเที่ยงคืนไทยได้ 2 วัน) ส่วนค่าเก่า 9 วันไม่ถูกเติม')
  assert.equal(Math.max(...got.map(r => Number(r.mx))), 9)
  assert.ok(!got.some(r => Number(r.mx) === 50), 'ข้อมูลเก่ากว่า 8 วันไม่ถูกเติม')
  assert.ok((await b.query(`SELECT 1 FROM public.job_heartbeats WHERE job_name = 'water-daily-summary-tick' AND last_ok_at IS NOT NULL`)).rows.length === 1, 'ย้อนเติมแล้วลงสมุด')
  await b.exec(await sql(F_TICK))   // apply ซ้ำ ต้องไม่เพิ่ม/ไม่พัง
  assert.equal((await b.query(`SELECT count(*)::int AS n FROM public.water_daily_summary`)).rows[0].n, got.length)
  console.log('✓ apply ไฟล์ฟังก์ชัน: ย้อนเติมจากข้อมูลดิบ 8 วันล่าสุด · เก่ากว่านั้นไม่เติม · apply ซ้ำไม่เพิ่มแถว')
}

// ── 18) สแกนไฟล์: ฟังก์ชันไม่มีทางลบแถวสรุป · ตั้ง search_path · ไม่สรุป ews · ตัวป้องกันเขียนทับ ──
{
  const fn = (await sql(F_TICK)).split('CREATE OR REPLACE FUNCTION public.water_daily_summary_tick')[1].split('$$;')[0]
  assert.ok(!/\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i.test(fn), 'ฟังก์ชันสรุปต้องไม่มีทางลบ/ล้างแถวสรุป')
  assert.match(fn, /SECURITY DEFINER/, 'ต้องเป็น SECURITY DEFINER (cron/ผู้เรียกไม่ต้องมีสิทธิ์ตารางโดยตรง)')
  assert.match(fn, /SET search_path = pg_catalog, public/)
  assert.match(fn, /station_type IN \('rain', 'waterlevel', 'dam'\)/, 'ต้องไม่สรุป ews')
  assert.match(fn, /WHERE EXCLUDED\.readings_count >= s\.readings_count/, 'ต้องมีตัวป้องกันเขียนทับแถวที่ครบกว่า')
  assert.match(fn, /r\.recorded_at <= _now/, 'ต้องไม่นับค่าที่เวลาวัดอยู่หลังเวลารอบ')
  assert.match(fn, /enabled_modules IS NULL OR 'water-situation' = ANY/, 'เฉพาะ อปท. ที่เปิดโมดูลน้ำ-ฝน')
  const tableSql = await sql(F_TABLE)
  assert.ok(!/ALL\s+PRIVILEGES|GRANT\s/i.test(tableSql + await sql(F_TICK)), 'ไม่ให้สิทธิ์ใดกับ anon/authenticated ในไฟล์เหล่านี้')
  for (const bad of ['name', 'phone', 'email', 'citizen', 'latitude', 'longitude']) {
    assert.ok(!new RegExp(`^\\s+${bad}\\b`, 'm').test(tableSql.split('CREATE TABLE IF NOT EXISTS public.water_daily_summary')[1].split(');')[0]), `ตารางห้ามมีคอลัมน์ ${bad} (ไม่เก็บข้อมูลบุคคล/พิกัด)`)
  }
  console.log('✓ สแกนไฟล์: ไม่มีทางลบแถวสรุป · search_path · ไม่สรุป ews · ตัวป้องกันเขียนทับ · ไม่มีข้อมูลบุคคล')
}

console.log('\n✅ water-daily-summary-db: ผ่านทุกข้อ')
