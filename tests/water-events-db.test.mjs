// เหตุการณ์น้ำ-ฝนที่ระบบจดเอง (water_event_tick) — รัน migration จริง 2 ไฟล์ใน PostgreSQL จำลอง (PGlite)
// node tests/water-events-db.test.mjs --pglite <โฟลเดอร์>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง · จำลองเวลาด้วยพารามิเตอร์ _now (ไม่ต้องรอ cron จริง)
//
// เรื่องที่ต้องไม่พลาด: (1) ค่าว่าง/ค่าค้างห้ามเปิดเหตุการณ์ และห้ามนับเป็น "สงบ"
// (2) อ่างน้ำมากอยู่ได้เป็นเดือน ห้ามเปิดเหตุการณ์ (3) ปิดเมื่อสงบต่อเนื่อง 24 ชม. เท่านั้น ค่าขาดแล้วนับใหม่
// (4) อปท. หนึ่งพังต้องไม่ลากอีกแห่งล้ม (5) ตารางปิดสนิทต่อ anon/authenticated (6) สถานีที่ถูกลบไม่ลบบันทึกเหตุการณ์
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sql = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const F_TABLES = '20261016100000_water_events_tables.sql'
const F_TICK = '20261016100100_water_events_tick_cron.sql'
const PREREQ = [
  '20260918150000_water_station_config_table.sql',
  '20260918180000_water_station_type_dam.sql',
  '20260919100000_water_station_type_ews.sql',
  '20260918150100_water_readings_table.sql',
  '20260918180100_water_readings_dam_columns.sql',
  '20260919100200_water_warnings_table.sql',
  '20260928140000_job_heartbeats_table.sql',
  '20260928140100_job_heartbeats_rls.sql',
]

const SETUP = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- จำลองสภาพ Supabase: ตารางและฟังก์ชันใหม่ให้สิทธิ์ anon/authenticated อัตโนมัติ (ต้นเหตุของการต้อง REVOKE)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE TABLE public.municipalities (
  id uuid PRIMARY KEY, slug text NOT NULL, name text, district text, province text,
  is_active boolean NOT NULL DEFAULT true, enabled_modules text[]
);
-- pg_cron จำลอง: เก็บแค่ชื่องาน/ตาราง/คำสั่งไว้ตรวจ
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

const fails = async (target, label, statement, pattern) => {
  try { await target.exec(statement) } catch (e) {
    assert.match(String(e.message), pattern, `${label}: error ผิดชนิด → ${e.message}`)
    return
  }
  assert.fail(`${label}: ควรล้มเหลวแต่สำเร็จ`)
}

// ── 0) ลำดับ apply: ไฟล์ 2 ต้องปฏิเสธเมื่อยังไม่มีไฟล์ 1 · ไฟล์ 1 ต้องปฏิเสธเมื่อยังไม่มีตารางต้นทาง ──
{
  await fails(guardDb, 'ไฟล์ 1 ก่อนตารางต้นทาง', await sql(F_TABLES), /ต้อง apply 20260918150100/)
  await fails(guardDb, 'ไฟล์ 2 ก่อนไฟล์ 1', await sql(F_TICK), /ต้อง apply 20261016100000/)
  console.log('✓ ลำดับ apply: ไฟล์ที่มาก่อนเวลาถูกปฏิเสธพร้อมบอกว่าต้อง apply ไฟล์ไหนก่อน')
}

// ── 1) apply ตามลำดับ + apply ซ้ำได้ ──
for (const f of [...PREREQ, F_TABLES, F_TICK]) {
  const text = await sql(f)
  await db.exec(text)
  if (f === F_TABLES || f === F_TICK) {
    await db.exec(text)
    console.log('✓ apply ได้สองรอบ:', f)
  }
}
{
  const jobs = (await db.query(`SELECT jobname, schedule, command FROM cron.job`)).rows
  assert.equal(jobs.length, 1, 'apply ซ้ำแล้วต้องเหลืองานเดียว ไม่ซ้อน')
  assert.equal(jobs[0].jobname, 'water-event-tick-hourly')
  assert.equal(jobs[0].schedule, '20 * * * *', 'นาทีที่ 20 หลัง sync(10) และ notify(15)')
  assert.match(jobs[0].command, /water_event_tick\(\)/)
  console.log('✓ cron: 1 งาน นาทีที่ 20 เรียก water_event_tick()')
}

// ── ตัวช่วยจำลอง ──
const T0 = Date.parse('2026-10-20T01:20:00Z')
const HOUR = 3600_000
const at = (h) => new Date(T0 + h * HOUR).toISOString()                       // เวลารอบตรวจชั่วโมงที่ h
const seen = (h, minutesBefore = 5) => new Date(T0 + h * HOUR - minutesBefore * 60_000).toISOString() // เวลาที่สถานีวัด
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let seq = 1000

async function mkTenant(slug, { district = 'หนองม่วงไข่', province = 'แพร่', modules = null, active = true } = {}) {
  const id = uuid(++seq)
  await db.query(
    `INSERT INTO public.municipalities (id, slug, name, district, province, is_active, enabled_modules)
     VALUES ($1, $2, $2, $3, $4, $5, $6::text[])`,
    [id, slug, district, province, active, modules],
  )
  const st = {}
  for (const [code, type] of [['R1', 'rain'], ['L1', 'waterlevel'], ['D1', 'dam']]) {
    const sid = uuid(++seq)
    await db.query(
      `INSERT INTO public.water_station_config (id, municipality_id, station_type, station_code, station_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [sid, id, type, code, `${slug}-${code}`],
    )
    st[code] = sid
  }
  return { id, slug, st }
}

async function addStation(t, code, type, { active = true } = {}) {
  const sid = uuid(++seq)
  await db.query(
    `INSERT INTO public.water_station_config (id, municipality_id, station_type, station_code, station_name, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sid, t.id, type, code, `${t.slug}-${code}`, active],
  )
  t.st[code] = sid
  return sid
}

// vals: { rain, bank, pct, level } — ไม่ส่ง = ค่าว่าง (NULL)
async function feed(t, code, iso, vals = {}) {
  await db.query(
    `INSERT INTO public.water_readings (station_config_id, recorded_at, rain_24h_mm, bank_diff_m, storage_percent, situation_level)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (station_config_id, recorded_at) DO UPDATE
       SET rain_24h_mm = EXCLUDED.rain_24h_mm, bank_diff_m = EXCLUDED.bank_diff_m,
           storage_percent = EXCLUDED.storage_percent, situation_level = EXCLUDED.situation_level`,
    [t.st[code], iso, vals.rain ?? null, vals.bank ?? null, vals.pct ?? null, vals.level ?? null],
  )
}

// ชั่วโมงที่สงบ: ฝนน้อย ระดับน้ำต่ำกว่าตลิ่งมาก และอ่างอยู่ชั้น "น้ำมาก" 95% (ต้องไม่ทำให้เปิดเหตุการณ์/ค้างไม่ปิด)
const calm = async (t, h) => {
  await feed(t, 'R1', seen(h), { rain: 5 })
  await feed(t, 'L1', seen(h), { bank: 4 })
  await feed(t, 'D1', seen(h), { pct: 95 })
}
const hot = async (t, h, mm = 95) => {
  await feed(t, 'R1', seen(h), { rain: mm })
  await feed(t, 'L1', seen(h), { bank: 4 })
  await feed(t, 'D1', seen(h), { pct: 95 })
}

const tick = async (h) => (await db.query(`SELECT public.water_event_tick($1::timestamptz) AS r`, [at(h)])).rows[0].r
const eventsOf = async (t) => (await db.query(
  `SELECT * FROM public.water_events WHERE municipality_id = $1 ORDER BY opened_at`, [t.id])).rows
const iso = (d) => (d === null ? null : new Date(d).toISOString())
const readingCount = async (eventId) => (await db.query(
  `SELECT count(*)::int AS n FROM public.water_event_readings WHERE event_id = $1`, [eventId])).rows[0].n
const heartbeat = async () => (await db.query(
  `SELECT * FROM public.job_heartbeats WHERE job_name = 'water-event-tick'`)).rows[0]

// ── 2) วงจรเหตุการณ์ของ อปท. A: เปิด → ต่ออายุ → ปิดเมื่อสงบ 24 ชม. → เปิดใหม่ → ค่ากระโดดไปมา ──
const A = await mkTenant('a')                                   // enabled_modules = NULL (เปิดทุกโมดูล)
const B = await mkTenant('b', { modules: '{water-situation}' })  // เปิดโมดูลน้ำอย่างชัดเจน
{
  // สถานีที่ปิดใช้งาน ค่าสูงมาก — ห้ามเป็นตัวเปิดเหตุการณ์และห้ามถูกคัดลอก
  await addStation(A, 'X1', 'rain', { active: false })
  await feed(A, 'X1', seen(0), { rain: 99 })
  await calm(A, 0); await calm(B, 0)
  const r0 = await tick(0)
  assert.equal(r0.ok, true)
  assert.equal(r0.opened, 0, 'ทุกอย่างสงบ (อ่าง 95% และสถานีที่ปิดไม่นับ) ต้องไม่เปิดเหตุการณ์')
  assert.equal((await eventsOf(A)).length, 0)
  const hb = await heartbeat()
  assert.ok(hb?.last_ok_at, 'ลงสมุดลงเวลาเมื่อรอบสำเร็จ')
  console.log('✓ สงบ: อ่าง 95% + สถานีที่ปิดใช้งานค่า 99 มม. ไม่เปิดเหตุการณ์ · ลงสมุดลงเวลาแล้ว')

  // ค่าย้อนหลัง: 30 ชม. ก่อนเปิด = นอกหน้าต่าง 24 ชม. · 20 ชม. ก่อนเปิด = ในหน้าต่าง
  await feed(A, 'R1', new Date(Date.parse(at(1)) - 30 * HOUR).toISOString(), { rain: 1 })
  await feed(A, 'R1', new Date(Date.parse(at(1)) - 20 * HOUR).toISOString(), { rain: 2 })
  await hot(A, 1); await calm(B, 1)
  const r1 = await tick(1)
  assert.equal(r1.opened, 1)
  const evs = await eventsOf(A)
  assert.equal(evs.length, 1)
  assert.equal((await eventsOf(B)).length, 0, 'อปท. อื่นไม่ถูกลากเปิดตาม')
  const ev = evs[0]
  assert.equal(iso(ev.opened_at), at(1))
  assert.equal(ev.closed_at, null)
  assert.equal(ev.open_reason.rule_version, 1)
  assert.equal(ev.open_reason.triggers.length, 1, 'ฝนอย่างเดียว (อ่างไม่นับ)')
  assert.deepEqual(
    { kind: ev.open_reason.triggers[0].kind, code: ev.open_reason.triggers[0].station_code, value: ev.open_reason.triggers[0].value },
    { kind: 'rain', code: 'R1', value: 95 },
    'จดว่าสถานีไหน ค่าเท่าไร',
  )
  assert.equal(ev.open_reason.triggers[0].recorded_at.replace('+00:00', 'Z').slice(0, 16), seen(1).slice(0, 16), 'จดเวลาที่สถานีวัด')
  console.log('✓ เปิดเหตุการณ์เมื่อฝน 95 มม. · จดเหตุผลครบ · อปท. อื่นไม่ถูกเปิดตาม')

  const rows = (await db.query(
    `SELECT station_code, recorded_at, rain_24h_mm FROM public.water_event_readings WHERE event_id = $1 ORDER BY recorded_at, station_code`, [ev.id])).rows
  const codes = rows.map(r => `${r.station_code}@${iso(r.recorded_at)}`)
  assert.ok(codes.includes(`R1@${new Date(Date.parse(at(1)) - 20 * HOUR).toISOString()}`), 'คัดลอกค่าย้อนหลัง 20 ชม. (เห็นช่วงน้ำกำลังขึ้น)')
  assert.ok(!codes.some(c => c.endsWith(new Date(Date.parse(at(1)) - 30 * HOUR).toISOString())), 'ค่าเก่ากว่า 24 ชม. ไม่คัดลอก')
  assert.ok(!rows.some(r => r.station_code === 'X1'), 'สถานีที่ปิดใช้งานไม่ถูกคัดลอก')
  assert.equal(rows.length, 7, '1 ค่าย้อนหลัง + 3 สถานี × 2 ชั่วโมง (ชั่วโมงที่ 0 และ 1)')
  const stationTypes = (await db.query(
    `SELECT DISTINCT station_type FROM public.water_event_readings WHERE event_id = $1 ORDER BY 1`, [ev.id])).rows.map(r => r.station_type)
  assert.deepEqual(stationTypes, ['dam', 'rain', 'waterlevel'], 'เก็บทุกชนิดสถานี')
  console.log('✓ คัดลอกค่าย้อนหลัง 24 ชม. ก่อนเปิด · ไม่คัดลอกของเก่ากว่านั้น/ของสถานีที่ปิด/ของ อปท. อื่น')

  // รอบต่อมายังเข้าเกณฑ์: เหตุการณ์เดิม ไม่เปิดซ้ำ ค่าไม่ซ้ำแม้ตรวจรอบเดิมสองครั้ง
  await hot(A, 2, 96); await calm(B, 2)
  const r2 = await tick(2)
  const r2b = await tick(2)
  assert.equal(r2.opened, 0); assert.equal(r2b.opened, 0)
  const ev2 = await eventsOf(A)
  assert.equal(ev2.length, 1, 'ยังเป็นเหตุการณ์เดียว')
  assert.equal(ev2[0].id, ev.id)
  assert.equal(iso(ev2[0].last_hot_at), at(2))
  assert.equal(ev2[0].calm_since, null)
  assert.equal(await readingCount(ev.id), 10, 'เพิ่ม 3 ค่าของชั่วโมงที่ 2 ตรวจซ้ำรอบเดิมไม่ได้ค่าซ้ำ')
  console.log('✓ เข้าเกณฑ์ต่อเนื่อง: เหตุการณ์เดิม · last_hot_at ขยับ · ตรวจซ้ำรอบเดิมไม่ได้ค่าซ้ำ')

  // สงบ: นับ 24 ชม. จากรอบแรกที่ค่าสดไม่เข้าเกณฑ์ (ชั่วโมงที่ 3) → ปิดที่ชั่วโมงที่ 27 พอดี ไม่ก่อน
  for (let h = 3; h <= 26; h += 1) {
    await calm(A, h); await calm(B, h)
    await tick(h)
    if (h === 3) assert.equal(iso((await eventsOf(A))[0].calm_since), at(3), 'เริ่มนับสงบจากรอบแรกที่ค่าสดไม่เข้าเกณฑ์')
  }
  {
    const e = (await eventsOf(A))[0]
    assert.equal(e.closed_at, null, 'สงบ 23 ชม. ยังไม่ปิด')
    assert.equal(iso(e.calm_since), at(3))
    assert.equal(iso(e.last_fresh_at), at(26))
  }
  await calm(A, 27); await calm(B, 27)
  const r27 = await tick(27)
  assert.equal(r27.closed, 1)
  const closed = (await eventsOf(A))[0]
  assert.equal(closed.close_reason, 'calm')
  assert.equal(iso(closed.ended_at), at(2), 'ended_at = เวลาที่เห็นสัญญาณล่าสุด')
  assert.equal(iso(closed.closed_at), at(27))
  const lastCopied = (await db.query(
    `SELECT max(recorded_at) AS m FROM public.water_event_readings WHERE event_id = $1`, [ev.id])).rows[0].m
  assert.equal(iso(lastCopied), seen(27), 'คัดลอกค่ารอบท้ายก่อนปิด')
  assert.equal((await eventsOf(B)).length, 0)
  console.log('✓ ปิดเมื่อสงบต่อเนื่อง 24 ชม. พอดี (23 ชม. ยังไม่ปิด) แม้อ่างยังอยู่ 95%')

  // เข้าเกณฑ์อีกครั้งหลังปิด = เหตุการณ์ใหม่ เหตุการณ์เก่าไม่ถูกแตะ
  await hot(A, 28, 120); await calm(B, 28)
  const r28 = await tick(28)
  assert.equal(r28.opened, 1)
  const two = await eventsOf(A)
  assert.equal(two.length, 2)
  assert.equal(two[0].close_reason, 'calm'); assert.equal(iso(two[0].closed_at), at(27))
  assert.equal(two[1].closed_at, null)
  console.log('✓ เข้าเกณฑ์หลังปิด: เปิดเหตุการณ์ใหม่ เหตุการณ์เก่าไม่ถูกแตะ')

  // ค่ากระโดดไปมา: สงบ 10 ชม. แล้วเข้าเกณฑ์อีก → ยังเป็นเหตุการณ์เดียว และเริ่มนับสงบใหม่
  for (let h = 29; h <= 38; h += 1) { await calm(A, h); await calm(B, h); await tick(h) }
  assert.equal(iso((await eventsOf(A))[1].calm_since), at(29))
  await hot(A, 39, 91); await calm(B, 39)
  await tick(39)
  {
    const e = (await eventsOf(A))[1]
    assert.equal(e.calm_since, null, 'เข้าเกณฑ์อีก = ล้างตัวนับสงบ')
    assert.equal((await eventsOf(A)).length, 2, 'ไม่เปิดเหตุการณ์ที่สาม')
  }
  for (let h = 40; h <= 63; h += 1) { await calm(A, h); await calm(B, h); await tick(h) }
  assert.equal((await eventsOf(A))[1].closed_at, null, 'ถ้านับจากชั่วโมงที่ 29 จะปิดที่ 53 แต่ต้องนับใหม่จาก 40')
  assert.equal(iso((await eventsOf(A))[1].calm_since), at(40))
  await calm(A, 64); await calm(B, 64)
  await tick(64)
  assert.equal(iso((await eventsOf(A))[1].closed_at), at(64))
  assert.equal((await eventsOf(A))[1].close_reason, 'calm')
  console.log('✓ ค่ากระโดดไปมา: เหตุการณ์เดียว · เริ่มนับสงบใหม่ทุกครั้งที่เข้าเกณฑ์ · ปิดที่ 24 ชม. หลังรอบสุดท้าย')
}

// ── 3) ค่าขาดไม่ใช่ความสงบ: ช่องว่างของข้อมูลล้างตัวนับ 24 ชม. ──
{
  const D = await mkTenant('d')
  await hot(D, 100)
  await tick(100)
  for (let h = 101; h <= 120; h += 1) { await calm(D, h); await tick(h) }
  assert.equal(iso((await eventsOf(D))[0].calm_since), at(101))
  // ไม่มีค่าใหม่ตั้งแต่ชั่วโมงที่ 121: ค่าเดิมยังสด (≤ 3 ชม.) ถึงรอบที่ 122
  await tick(121); await tick(122)
  assert.equal(iso((await eventsOf(D))[0].calm_since), at(101), 'ค่าล่าสุดยังสดอยู่ ยังนับสงบต่อได้')
  await tick(123)
  assert.equal((await eventsOf(D))[0].calm_since, null, 'ค่าเก่าเกิน 3 ชม. = ตัดสินไม่ได้ ไม่นับว่าสงบ และล้างตัวนับ')
  for (let h = 124; h <= 147; h += 1) { await calm(D, h); await tick(h) }
  assert.equal((await eventsOf(D))[0].closed_at, null, 'ถ้านับต่อจากเดิมจะปิดที่ 125 แต่ต้องนับใหม่จาก 124')
  await calm(D, 148); await tick(148)
  assert.equal((await eventsOf(D))[0].close_reason, 'calm')
  assert.equal(iso((await eventsOf(D))[0].closed_at), at(148))
  console.log('✓ ค่าขาด ≥ 3 ชม. ไม่นับว่าสงบ ตัวนับ 24 ชม. เริ่มใหม่เมื่อค่ากลับมา')
}

// สถานีส่งแถวใหม่แต่ "ค่าว่าง" (ต้นทางไม่ส่งตัวเลข) ≠ ค่าสด: ห้ามนับเป็นหลักฐานว่าสงบ และห้ามกลายเป็น 0
{
  const N = await mkTenant('n-null-values')
  await hot(N, 900)
  await tick(900)
  for (let h = 901; h <= 930; h += 1) {
    await feed(N, 'R1', seen(h), {})       // ฝน = NULL
    await feed(N, 'L1', seen(h), {})       // ระดับน้ำ = NULL
    await tick(h)
  }
  const e = (await eventsOf(N))[0]
  assert.equal(e.closed_at, null, 'ค่าว่าง 30 ชม. ไม่ใช่ความสงบ ห้ามปิดแบบ calm')
  assert.equal(e.calm_since, null, 'ค่าว่างไม่เริ่มนับสงบ')
  assert.equal(iso(e.last_fresh_at), at(900), 'ค่าว่างไม่นับเป็นค่าสด')
  await tick(948)
  assert.equal((await eventsOf(N))[0].close_reason, 'data_lost', 'ค่าว่างต่อเนื่อง = ไม่มีค่าสด → ปิดแบบ data_lost')
  console.log('✓ ค่าว่างจากต้นทาง: ไม่นับว่าสงบ ไม่กลายเป็น 0 · ปิดเป็น data_lost เมื่อครบ 48 ชม.')
}

// ── 4) ค่าหายหมด 48 ชม. = ปิดพร้อมเหตุผล data_lost (ไม่ค้างตลอดไป) ──
{
  const E = await mkTenant('e')
  await hot(E, 200)
  await tick(200)
  await tick(201); await tick(202); await tick(203)
  assert.equal((await eventsOf(E))[0].calm_since, null)
  assert.equal(iso((await eventsOf(E))[0].last_fresh_at), at(202), 'รอบสุดท้ายที่ยังเห็นค่าสด')
  await tick(249)
  assert.equal((await eventsOf(E))[0].closed_at, null, 'ขาด 47 ชม. ยังไม่ปิด')
  const r = await tick(250)
  assert.equal(r.closed, 1)
  const e = (await eventsOf(E))[0]
  assert.equal(e.close_reason, 'data_lost')
  assert.equal(iso(e.ended_at), at(202))
  assert.equal(iso(e.closed_at), at(250))
  console.log('✓ ไม่มีค่าสดเลย 48 ชม. → ปิดด้วยเหตุผล data_lost')
}

// ── 5) ข้อความเตือนของ สสน.: ต้องตรงอำเภอ+จังหวัด และไม่เก่าเกิน 6 ชม. ──
{
  const F = await mkTenant('f', { district: 'อำเภอทดสอบเอฟ' })   // อำเภอเฉพาะ: ข้อความเตือนของอำเภอเดียวกันทำให้ อปท. ทุกแห่งในอำเภอนั้นเข้าเกณฑ์ (ตั้งใจ)
  await calm(F, 300)
  const warn = (issued, message, amphoe = 'อำเภอทดสอบเอฟ', province = 'แพร่') => db.query(
    `INSERT INTO public.water_warnings (issued_at, message, station_name, tambon_name, amphoe_name, province_name)
     VALUES ($1, $2, 'สถานีทดสอบ', 'ต.ทดสอบ', $3, $4)`, [issued, message, amphoe, province])
  const mins = (h, m) => new Date(T0 + h * HOUR - m * 60_000).toISOString()
  await warn(mins(300, 60), 'ข้อความอำเภออื่น', 'เมืองแพร่')
  await warn(mins(300, 60), 'ข้อความจังหวัดอื่น', 'อำเภอทดสอบเอฟ', 'น่าน')
  await warn(mins(300, 7 * 60), 'ข้อความเก่าเกิน 6 ชม.')
  const r300 = await tick(300)
  assert.equal(r300.opened, 0, 'อำเภออื่น/จังหวัดอื่น/เก่าเกิน 6 ชม. ไม่เปิดเหตุการณ์')
  await calm(F, 301)
  await warn(mins(301, 30), 'ล้นตลิ่งแล้ว 10 ซม.')
  const r301 = await tick(301)
  assert.equal(r301.opened, 1)
  const e = (await eventsOf(F))[0]
  assert.deepEqual(e.open_reason.triggers.map(t => t.kind), ['warning'])
  const msgs = (await db.query(
    `SELECT message FROM public.water_event_warnings WHERE event_id = $1 ORDER BY issued_at`, [e.id])).rows.map(r => r.message)
  assert.deepEqual(msgs, ['ข้อความเก่าเกิน 6 ชม.', 'ล้นตลิ่งแล้ว 10 ซม.'],
    'เก็บข้อความของอำเภอ/จังหวัดนี้ในหน้าต่างย้อนหลัง 24 ชม. ตามต้นฉบับ ไม่เก็บของอื่น')
  await tick(301)
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.water_event_warnings WHERE event_id = $1`, [e.id])).rows[0].n, 2, 'ตรวจซ้ำไม่ได้ข้อความซ้ำ')
  console.log('✓ ข้อความ สสน.: ตรงอำเภอ+จังหวัด ≤ 6 ชม. จึงเปิดเหตุการณ์ · เก็บต้นฉบับครบ ไม่ซ้ำ')
}

// ── 6) ขอบเกณฑ์: ฝน 90.1 · ระดับน้ำ 1.00 ม. · ค่าว่าง · ค่าค้าง · สถานีเตือนภัย ──
{
  const cases = [
    ['g-rain-90-0',  async (t) => feed(t, 'R1', seen(400), { rain: 90.0 }), false],
    ['g-rain-90-1',  async (t) => feed(t, 'R1', seen(400), { rain: 90.1 }), true],
    ['g-rain-null',  async (t) => feed(t, 'R1', seen(400), {}), false],
    ['g-rain-zero',  async (t) => feed(t, 'R1', seen(400), { rain: 0 }), false],
    ['g-rain-stale', async (t) => feed(t, 'R1', seen(400, 190), { rain: 95 }), false],   // วัดเมื่อ 3 ชม. 10 นาทีก่อน
    ['g-rain-fresh', async (t) => feed(t, 'R1', seen(400, 170), { rain: 95 }), true],    // วัดเมื่อ 2 ชม. 50 นาทีก่อน
    ['g-lvl-1-00',   async (t) => feed(t, 'L1', seen(400), { bank: 1.0 }), true],
    ['g-lvl-1-01',   async (t) => feed(t, 'L1', seen(400), { bank: 1.01 }), false],
    ['g-lvl-null',   async (t) => feed(t, 'L1', seen(400), {}), false],                  // ค่าว่างห้ามกลายเป็น 0 = เสมอตลิ่ง
    ['g-lvl-0',      async (t) => feed(t, 'L1', seen(400), { bank: 0 }), true],
    ['g-lvl-over',   async (t) => feed(t, 'L1', seen(400), { bank: -0.5 }), true],
    ['g-lvl-stale',  async (t) => feed(t, 'L1', seen(400, 190), { bank: -0.5 }), false],
    ['g-dam-over',   async (t) => feed(t, 'D1', seen(400), { pct: 130 }), false],        // อ่างล้นความจุ ไม่ใช่เหตุเปิดเหตุการณ์
    ['g-ews-2',      async (t) => { await addStation(t, 'E1', 'ews'); await feed(t, 'E1', seen(400, 600), { level: 2 }) }, true],
    ['g-ews-1',      async (t) => { await addStation(t, 'E1', 'ews'); await feed(t, 'E1', seen(400), { level: 1 }) }, false],
    ['g-ews-stale',  async (t) => { await addStation(t, 'E1', 'ews'); await feed(t, 'E1', seen(400, 13 * 60), { level: 3 }) }, false],
  ]
  const made = []
  for (const [slug, setup, expected] of cases) {
    const t = await mkTenant(slug)
    await setup(t)
    made.push([t, expected, slug])
  }
  await tick(400)
  for (const [t, expected, slug] of made) {
    assert.equal((await eventsOf(t)).length > 0, expected, `${slug}: ${expected ? 'ต้องเปิดเหตุการณ์' : 'ต้องไม่เปิดเหตุการณ์'}`)
  }
  console.log(`✓ ขอบเกณฑ์ ${cases.length} กรณี: ฝน 90.1 · ระดับน้ำ 1.00 ม. · ค่าว่าง/0 · ค่าค้าง 3 ชม. · ews 12 ชม. · อ่างล้นไม่ใช่เหตุ`)
}

// ── 7) โมดูลปิด / อปท. ถูกปิดใช้งาน ──
{
  const C = await mkTenant('c-no-module', { modules: '{waste}' })
  const I = await mkTenant('i-inactive', { active: false })
  await hot(C, 500); await hot(I, 500)
  const r = await tick(500)
  assert.equal((await eventsOf(C)).length, 0, 'ไม่ได้เปิดโมดูลน้ำ-ฝน ไม่มีเหตุการณ์')
  assert.equal((await eventsOf(I)).length, 0, 'อปท. ที่ปิดใช้งาน ไม่มีเหตุการณ์')
  assert.ok(r.checked >= 1)

  const H = await mkTenant('h-switch')
  const H2 = await mkTenant('h2-deactivate')
  await hot(H, 501); await hot(H2, 501)
  await tick(501)
  assert.equal((await eventsOf(H)).length, 1); assert.equal((await eventsOf(H2)).length, 1)
  await db.query(`UPDATE public.municipalities SET enabled_modules = '{waste}' WHERE id = $1`, [H.id])
  await db.query(`UPDATE public.municipalities SET is_active = false WHERE id = $1`, [H2.id])
  const r2 = await tick(502)
  assert.ok(r2.closed >= 2)
  for (const t of [H, H2]) {
    const e = (await eventsOf(t))[0]
    assert.equal(e.close_reason, 'module_off')
    assert.equal(iso(e.ended_at), at(501), 'ended_at = รอบสุดท้ายที่เห็นค่าสด')
    assert.equal(iso(e.closed_at), at(502))
  }
  console.log('✓ ไม่เปิดโมดูล/ปิดใช้งาน: ไม่เปิดเหตุการณ์ · เหตุการณ์ที่เปิดอยู่ถูกปิดด้วย module_off')
}

// ── 8) สถานีถูกลบ/ปิดทีหลัง: บันทึกเหตุการณ์ไม่หาย ──
{
  const S = await mkTenant('s-station-change')
  await hot(S, 600)
  await tick(600)
  const ev = (await eventsOf(S))[0]
  const before = await readingCount(ev.id)
  assert.ok(before >= 3)
  await db.query(`DELETE FROM public.water_station_config WHERE id = $1`, [S.st.R1])      // ลบสถานีฝน
  await db.query(`UPDATE public.water_station_config SET is_active = false WHERE id = $1`, [S.st.L1])  // ปิดสถานีระดับน้ำ
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.water_readings WHERE station_config_id = $1`, [S.st.R1])).rows[0].n, 0, 'ค่าต้นทางถูกลบตามสถานี (CASCADE ของ water_readings)')
  assert.equal(await readingCount(ev.id), before, 'สำเนาในเหตุการณ์ยังอยู่ครบ')
  const rainRows = (await db.query(
    `SELECT station_name FROM public.water_event_readings WHERE event_id = $1 AND station_code = 'R1'`, [ev.id])).rows
  assert.ok(rainRows.length > 0 && rainRows.every(r => r.station_name === 's-station-change-R1'), 'ชื่อสถานีเก็บในสำเนา อ่านได้แม้สถานีถูกลบ')
  await feed(S, 'L1', seen(601), { bank: 3 }); await feed(S, 'D1', seen(601), { pct: 50 })
  const r = await tick(601)
  assert.equal(r.ok, true, 'รอบตรวจไม่พังเมื่อสถานีหาย')
  const l1 = (await db.query(
    `SELECT count(*)::int AS n FROM public.water_event_readings WHERE event_id = $1 AND station_code = 'L1' AND recorded_at = $2`, [ev.id, seen(601)])).rows[0].n
  assert.equal(l1, 0, 'สถานีที่ปิดใช้งานแล้วไม่ถูกคัดลอกค่าใหม่')
  console.log('✓ สถานีถูกลบ/ปิด: สำเนาค่าในเหตุการณ์ยังครบพร้อมชื่อสถานี · รอบตรวจไม่พัง')
}

// ── 9) อปท. หนึ่งพัง ไม่ลาก อปท. อื่นล้ม · ลงสมุดลงเวลาเป็น error ไม่ทับ last_ok_at ──
{
  const J = await mkTenant('j-broken')
  const K = await mkTenant('k-healthy')
  await hot(J, 700); await hot(K, 700)
  await db.exec(`
    CREATE FUNCTION public.test_break_events() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.municipality_id = '${J.id}' THEN RAISE EXCEPTION 'ทดสอบ: เขียนเหตุการณ์ไม่ได้'; END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER test_break BEFORE INSERT ON public.water_events FOR EACH ROW EXECUTE FUNCTION public.test_break_events();
  `)
  const okBefore = (await heartbeat()).last_ok_at
  const r = await tick(700)
  assert.equal(r.ok, false)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /^j-broken: .*เขียนเหตุการณ์ไม่ได้/)
  assert.equal((await eventsOf(J)).length, 0)
  assert.equal((await eventsOf(K)).length, 1, 'อปท. ที่ปกติยังเปิดเหตุการณ์ได้ในรอบเดียวกัน')
  const hb = await heartbeat()
  assert.ok(hb.last_error_at); assert.match(hb.last_error, /j-broken/)
  assert.equal(iso(hb.last_ok_at), iso(okBefore), 'รอบที่มี error ไม่ทับ last_ok_at เดิม')
  await db.exec(`DROP TRIGGER test_break ON public.water_events; DROP FUNCTION public.test_break_events();`)
  await tick(701)
  assert.equal((await eventsOf(J)).length, 1, 'แก้แล้วรอบถัดไปเปิดได้เอง')
  assert.ok(new Date((await heartbeat()).last_ok_at) > new Date(okBefore), 'รอบสำเร็จขยับ last_ok_at')
  console.log('✓ อปท. หนึ่งพัง: อีกแห่งยังทำงาน · ลงสมุดเป็น error ไม่ทับ last_ok_at · รอบถัดไปหายเอง')
}

// ── 10) ข้อจำกัดของตาราง ──
{
  const A2 = await mkTenant('constraint-check')
  await hot(A2, 800)
  await tick(800)
  const open = (await eventsOf(A2))[0]
  await fails(db, 'เปิดซ้อน อปท. เดียวกัน',
    `INSERT INTO public.water_events (municipality_id, open_reason) VALUES ('${A2.id}', '{}')`, /water_events_one_open_idx|duplicate key/)
  await fails(db, 'closed_at ไม่มี close_reason',
    `UPDATE public.water_events SET closed_at = now() WHERE id = '${open.id}'`, /water_events_closed_together|check constraint/)
  await fails(db, 'close_reason ผิดชนิด',
    `UPDATE public.water_events SET closed_at = now(), ended_at = now(), close_reason = 'manual' WHERE id = '${open.id}'`, /check constraint/)
  await fails(db, 'station_type ผิดชนิด',
    `INSERT INTO public.water_event_readings (event_id, station_type, station_code, station_name, recorded_at) VALUES ('${open.id}', 'pump', 'x', 'x', now())`, /check constraint/)
  // ลบ อปท. = ลบเหตุการณ์และค่าที่เก็บตาม (ไม่ทิ้งแถวลอย)
  const Z = await mkTenant('z-delete')
  await hot(Z, 801); await tick(801)
  const zEv = (await eventsOf(Z))[0]
  await db.query(`DELETE FROM public.water_station_config WHERE municipality_id = $1`, [Z.id])
  await db.query(`DELETE FROM public.municipalities WHERE id = $1`, [Z.id])
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.water_event_readings WHERE event_id = $1`, [zEv.id])).rows[0].n, 0)
  console.log('✓ ข้อจำกัด: เปิดซ้อนไม่ได้ · ฟิลด์ปิดต้องมาครบชุด · ชนิด/เหตุผลผิดถูกปฏิเสธ · ลบ อปท. ลบเหตุการณ์ตาม')
}

// ── 11) สิทธิ์: ตาราง+ฟังก์ชันปิดสนิทต่อ anon/authenticated (แม้ default privileges ให้ ALL) ──
{
  const tables = ['water_events', 'water_event_readings', 'water_event_warnings']
  for (const role of ['anon', 'authenticated']) {
    for (const tbl of tables) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const r = await db.query(`SELECT has_table_privilege('${role}', 'public.${tbl}', '${p}') AS ok`)
        assert.equal(r.rows[0].ok, false, `${role} ต้องไม่มี ${p} บน ${tbl}`)
      }
    }
    const fn = await db.query(`SELECT has_function_privilege('${role}', 'public.water_event_tick(timestamptz)', 'EXECUTE') AS ok`)
    assert.equal(fn.rows[0].ok, false, `${role} ต้องเรียก water_event_tick ไม่ได้`)
  }
  const rls = (await db.query(
    `SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`, [`{${tables.join(',')}}`])).rows
  assert.equal(rls.length, 3)
  assert.ok(rls.every(r => r.relrowsecurity === true), 'เปิด RLS ทุกตาราง')
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = ANY($1::text[])`, [`{${tables.join(',')}}`])).rows[0].n, 0,
    'ยังไม่มี policy เปิดอ่าน (หน้าจอเจ้าหน้าที่เพิ่มใน PR 3.2)')
  await db.exec('SET ROLE authenticated')
  try {
    await fails(db, 'authenticated อ่านตาราง', 'SELECT * FROM public.water_events', /permission denied/)
    await fails(db, 'authenticated เรียกฟังก์ชัน', 'SELECT public.water_event_tick()', /permission denied/)
  } finally { await db.exec('RESET ROLE') }
  await db.exec('SET ROLE anon')
  try {
    await fails(db, 'anon อ่านตาราง', 'SELECT * FROM public.water_event_readings', /permission denied/)
    await fails(db, 'anon เรียกฟังก์ชัน', 'SELECT public.water_event_tick()', /permission denied/)
  } finally { await db.exec('RESET ROLE') }
  console.log('✓ สิทธิ์: anon/authenticated ไม่มีสิทธิ์ใดบน 3 ตาราง · เรียกฟังก์ชันไม่ได้ · RLS เปิดทุกตาราง')
}

console.log('\n✅ water-events-db: ผ่านทุกข้อ')
