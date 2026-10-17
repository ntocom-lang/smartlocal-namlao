// เหตุการณ์น้ำ-ฝน (เฟส 3 · PR 3.2) — ฟังก์ชันอ่านของหน้าเจ้าหน้าที่ รัน migration จริงใน PostgreSQL จำลอง (PGlite)
// node tests/water-events-rpc-db.test.mjs --pglite <โฟลเดอร์>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//
// เรื่องที่ต้องไม่พลาด: (1) ใครเรียกได้ — admin/officer/staff ของ อปท. นั้น + superadmin เท่านั้น ช่าง/สภา/ประชาชน/คนไม่ล็อกอิน/ต่าง อปท. ไม่ได้
// (2) ตารางยังปิดสนิท ฟังก์ชันไม่เปิดช่องเขียน (3) ค่าว่างไม่กลายเป็น 0 (4) เหตุการณ์ ~1,000+ แถวมาครบ ไม่โดนเพดาน
// (5) เหตุการณ์ของ อปท. อื่นถามด้วย id ตรงๆ ได้ NULL ไม่ใช่ข้อมูล (6) ไม่ส่งข้อความ error ภายในของตัวจดออกไป
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sql = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const F_TABLES = '20261016100000_water_events_tables.sql'
const F_TICK = '20261016100100_water_events_tick_cron.sql' // ไฟล์นี้เป็นตัว REVOKE สิทธิ์ตาราง
const F_RPC = '20261017100000_water_events_staff_rpc.sql'
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
-- จำลอง profiles + auth.uid() (อ่านจากตัวแปรเซสชัน test.uid)
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL, municipality_id uuid);
-- pg_cron จำลอง (F_TICK เรียก cron.schedule)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql
  AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql
  AS $$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
`

const text = await sql(F_RPC)

// ── 0) อ่านไฟล์: ไม่มีทางเขียน/เปิดสิทธิ์ตาราง ──
{
  const code = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  for (const word of ['INSERT INTO', 'UPDATE public', 'DELETE FROM', 'TRUNCATE', 'CREATE POLICY', 'DROP ', 'ALTER TABLE', 'CREATE TABLE']) {
    assert.ok(!code.includes(word), `ไฟล์นี้อ่านอย่างเดียว ห้ามมี ${word}`)
  }
  assert.ok(!/GRANT\s+(SELECT|ALL|INSERT|UPDATE|DELETE)[^;]*ON\s+(TABLE\s+)?public\.water_event/i.test(code), 'ห้ามเปิดสิทธิ์ตารางเหตุการณ์')
  assert.equal((code.match(/SECURITY DEFINER/g) || []).length, 3, 'ฟังก์ชันทั้ง 3 ตัวเป็น SECURITY DEFINER')
  assert.equal((code.match(/SET search_path = pg_catalog, public/g) || []).length, 3, 'ทุกตัวตั้ง search_path')
  assert.ok(!/last_error\b(?!_at)/.test(code.replace(/last_error_at/g, '')), 'ห้ามส่ง last_error (ข้อความภายใน) ออกไป')
  console.log('✓ ไฟล์: อ่านอย่างเดียว ไม่มี INSERT/UPDATE/DELETE/POLICY · 3 ฟังก์ชัน DEFINER ตั้ง search_path · ไม่ส่ง last_error')
}

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

// ── 1) ลำดับ apply + apply ซ้ำได้ ──
{
  await fails(guardDb, 'ไฟล์นี้ก่อนตารางเหตุการณ์', text, /ต้อง apply 20261016100000/)
  for (const f of [...PREREQ, F_TABLES]) await guardDb.exec(await sql(f))
  await fails(guardDb, 'ไฟล์นี้ก่อนไฟล์ที่ปิดสิทธิ์ตาราง', text, /ต้อง apply 20261016100100/)
  for (const f of [...PREREQ, F_TABLES, F_TICK, F_RPC]) {
    const t = await sql(f)
    await db.exec(t)
    if (f === F_RPC) await db.exec(t)
  }
  console.log('✓ apply: ไฟล์ที่มาก่อนตาราง/ก่อนการปิดสิทธิ์ตารางถูกปฏิเสธพร้อมบอกว่าต้อง apply ไฟล์ไหนก่อน · apply ซ้ำได้')
}

// ── ข้อมูลทดสอบ ──
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = uuid(1), B = uuid(2)
const U = { citizen: uuid(11), technician: uuid(12), council: uuid(13), staffA: uuid(14), officerA: uuid(15), adminA: uuid(16), staffB: uuid(17), superadmin: uuid(18), none: uuid(19) }
await db.exec(`
  INSERT INTO public.municipalities (id, slug, name, district, province) VALUES
    ('${A}', 'aa', 'A', 'หนองม่วงไข่', 'แพร่'), ('${B}', 'bb', 'B', 'ร้องกวาง', 'แพร่');
  INSERT INTO public.profiles (id, role, municipality_id) VALUES
    ('${U.citizen}', 'citizen', '${A}'), ('${U.technician}', 'technician', '${A}'), ('${U.council}', 'council', '${A}'),
    ('${U.staffA}', 'staff', '${A}'), ('${U.officerA}', 'officer', '${A}'), ('${U.adminA}', 'admin', '${A}'),
    ('${U.staffB}', 'staff', '${B}'), ('${U.superadmin}', 'superadmin', NULL);
`)

const E1 = uuid(101) // A · เปิดอยู่
const E2 = uuid(102) // A · ปิดเพราะสงบ
const E3 = uuid(103) // A · ปิดเพราะข้อมูลขาด
const EB = uuid(201) // B
await db.exec(`
  INSERT INTO public.water_events (id, municipality_id, opened_at, last_hot_at, last_fresh_at, open_reason)
    VALUES ('${E1}', '${A}', '2026-10-20T03:20:00Z', '2026-10-20T08:20:00Z', '2026-10-20T08:20:00Z',
            '{"rule_version":1,"triggers":[{"kind":"rain","station_code":"R1","station_name":"สถานี ก","value":95.5,"recorded_at":"2026-10-20T03:10:00Z"}]}');
  INSERT INTO public.water_events (id, municipality_id, opened_at, last_hot_at, last_fresh_at, ended_at, closed_at, close_reason, open_reason)
    VALUES ('${E2}', '${A}', '2026-10-10T03:20:00Z', '2026-10-10T06:20:00Z', '2026-10-11T08:20:00Z', '2026-10-11T08:20:00Z', '2026-10-11T09:20:00Z', 'calm', '{"rule_version":1,"triggers":[]}');
  INSERT INTO public.water_events (id, municipality_id, opened_at, last_hot_at, last_fresh_at, ended_at, closed_at, close_reason, open_reason)
    VALUES ('${E3}', '${A}', '2026-09-30T03:20:00Z', '2026-09-30T03:20:00Z', '2026-09-30T03:20:00Z', '2026-09-30T03:20:00Z', '2026-10-02T03:20:00Z', 'data_lost', '{"rule_version":1,"triggers":[]}');
  INSERT INTO public.water_events (id, municipality_id, opened_at, last_fresh_at, open_reason)
    VALUES ('${EB}', '${B}', '2026-10-19T03:20:00Z', '2026-10-19T03:20:00Z', '{"rule_version":1,"triggers":[]}');

  -- E1: สถานี ก (ฝน) 3 ค่า · สถานี ข (ระดับน้ำ) ค่าว่างบางตัว · ชื่อสถานีเปลี่ยนกลางเหตุการณ์ → ใช้ชื่อล่าสุด
  INSERT INTO public.water_event_readings (event_id, station_type, station_code, station_name, recorded_at, rain_24h_mm, rain_1h_mm, waterlevel_msl, bank_diff_m, storage_percent) VALUES
    ('${E1}', 'rain', 'R1', 'สถานี ก (ชื่อเก่า)', '2026-10-20T03:10:00Z', 95.5, 12, NULL, NULL, NULL),
    ('${E1}', 'rain', 'R1', 'สถานี ก', '2026-10-20T04:10:00Z', 110, NULL, NULL, NULL, NULL),
    ('${E1}', 'rain', 'R1', 'สถานี ก', '2026-10-20T05:10:00Z', 0, NULL, NULL, NULL, NULL),
    ('${E1}', 'waterlevel', 'L1', 'สถานี ข', '2026-10-20T03:10:00Z', NULL, NULL, 150.5, 2.5, NULL),
    ('${E1}', 'waterlevel', 'L1', 'สถานี ข', '2026-10-20T04:10:00Z', NULL, NULL, NULL, 0.8, NULL),
    ('${E1}', 'dam', 'D1', 'อ่าง ค', '2026-10-20T00:00:00Z', NULL, NULL, NULL, NULL, 99.9);
  INSERT INTO public.water_event_readings (event_id, station_type, station_code, station_name, recorded_at, rain_24h_mm) VALUES
    ('${E2}', 'rain', 'R1', 'สถานี ก', '2026-10-10T03:10:00Z', 91),
    ('${EB}', 'rain', 'R9', 'สถานีของ B', '2026-10-19T03:10:00Z', 200);
  INSERT INTO public.water_event_warnings (event_id, issued_at, message, station_name, tambon_name) VALUES
    ('${E1}', '2026-10-20T02:00:00Z', 'ข้อความต้นฉบับ <b>ไม่ตัดแต่ง</b>', 'สถานี ก', 'ต.หนึ่ง'),
    ('${E1}', '2026-10-20T01:00:00Z', 'ข้อความก่อนหน้า', NULL, NULL);
`)

// ผู้เรียก: ตั้ง role ของ Postgres + uid ของเซสชัน
const as = async (role, uid, fn) => {
  await db.exec(`SET ROLE ${role}`)
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ''])
  try { return await fn() } finally {
    await db.exec('RESET ROLE')
    await db.query(`SELECT set_config('test.uid', '', false)`)
  }
}
const list = (muni, limit) => limit === undefined
  ? db.query('SELECT public.list_water_events($1) AS r', [muni])
  : db.query('SELECT public.list_water_events($1, $2) AS r', [muni, limit])
const detail = (muni, id) => db.query('SELECT public.get_water_event($1, $2) AS r', [muni, id])
const denied = async (label, run) => {
  try { await run() } catch (e) {
    assert.match(String(e.message), /ไม่มีสิทธิ์ดูเหตุการณ์น้ำ-ฝน|permission denied/, `${label}: error ผิดชนิด → ${e.message}`)
    return
  }
  assert.fail(`${label}: ควรถูกปฏิเสธแต่สำเร็จ`)
}

// ── 2) สิทธิ์ ──
{
  for (const [who, uid] of [['staffA', U.staffA], ['officerA', U.officerA], ['adminA', U.adminA], ['superadmin', U.superadmin]]) {
    const r = await as('authenticated', uid, () => list(A))
    assert.equal(r.rows[0].r.events.length, 3, `${who} ต้องอ่านเหตุการณ์ของ A ได้`)
  }
  for (const [who, uid] of [['citizen', U.citizen], ['technician', U.technician], ['council', U.council], ['staffB (ต่าง อปท.)', U.staffB], ['ไม่ล็อกอิน (uid ว่าง)', null], ['uid ที่ไม่มีใน profiles', U.none]]) {
    await as('authenticated', uid, () => denied(`${who} list`, () => list(A)))
    await as('authenticated', uid, () => denied(`${who} detail`, () => detail(A, E1)))
  }
  // superadmin ดูของ B ได้ · staff ของ B ดูของ B ได้ แต่ดูของ A ไม่ได้ (ครอบด้านบนแล้ว)
  assert.equal((await as('authenticated', U.superadmin, () => list(B))).rows[0].r.events.length, 1)
  assert.equal((await as('authenticated', U.staffB, () => list(B))).rows[0].r.events.length, 1)
  await as('authenticated', U.staffA, () => denied('ส่ง municipality ว่าง', () => list(null)))
  // anon เรียกฟังก์ชันไม่ได้เลย (ไม่ถึงตรวจบทบาท)
  for (const fn of ['public.list_water_events(uuid, integer)', 'public.get_water_event(uuid, uuid)', 'public.can_view_water_events(uuid)']) {
    assert.equal((await db.query(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE') AS ok`)).rows[0].ok, false, `anon ต้องเรียก ${fn} ไม่ได้`)
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE') AS ok`)).rows[0].ok, true, `authenticated เรียก ${fn} ได้`)
  }
  console.log('✓ สิทธิ์: admin/officer/staff ของ อปท. + superadmin เท่านั้น · ช่าง/สภา/ประชาชน/ต่าง อปท./ไม่ล็อกอิน/municipality ว่าง ถูกปฏิเสธ · anon เรียกไม่ได้')
}

// ── 3) ตารางยังปิดสนิท ฟังก์ชันไม่ทำให้เกิดสิทธิ์ใหม่ ──
{
  for (const role of ['anon', 'authenticated']) {
    for (const tbl of ['water_events', 'water_event_readings', 'water_event_warnings']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        assert.equal((await db.query(`SELECT has_table_privilege('${role}', 'public.${tbl}', '${p}') AS ok`)).rows[0].ok, false, `${role} ต้องไม่มี ${p} บน ${tbl}`)
      }
    }
  }
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename LIKE 'water_event%'`)).rows[0].n, 0, 'ไม่มี policy อ่านตรง')
  await as('authenticated', U.staffA, () => fails(db, 'staff อ่านตารางตรง', 'SELECT * FROM public.water_events', /permission denied/))
  console.log('✓ ตารางยังปิดสนิท (ไม่มีสิทธิ์ใดต่อ anon/authenticated ไม่มี policy) — อ่านได้ผ่านฟังก์ชันเท่านั้น')
}

// ── 4) รายการเหตุการณ์ ──
let listing
{
  listing = (await as('authenticated', U.staffA, () => list(A))).rows[0].r
  assert.equal(listing.total, 3)
  assert.deepEqual(listing.events.map(e => e.id), [E1, E2, E3], 'เรียงใหม่ → เก่า')
  assert.ok(!listing.events.some(e => e.id === EB), 'ไม่มีเหตุการณ์ของ B ปนมา')
  const [e1, e2, e3] = listing.events
  assert.equal(e1.closed_at, null); assert.equal(e1.close_reason, null); assert.equal(e1.ended_at, null)
  assert.equal(e2.close_reason, 'calm'); assert.equal(e3.close_reason, 'data_lost')
  assert.equal(e1.stations_count, 3); assert.equal(e1.readings_count, 6)
  assert.equal(Number(e1.peak_rain_24h_mm), 110, 'ฝนสูงสุดนับเฉพาะค่าที่วัดได้ (ค่า 0 ไม่ทำให้ต่ำกว่าจริง)')
  assert.equal(Number(e1.min_bank_diff_m), 0.8, 'ใกล้ตลิ่งสุด = ค่าน้อยสุดที่วัดได้ (ค่าว่างไม่นับเป็น 0)')
  assert.equal(e1.warnings_count, 2)
  assert.equal(e1.open_reason.triggers[0].station_name, 'สถานี ก')
  // เหตุการณ์ที่ไม่มีค่าที่วัดได้ → peak เป็น null ไม่ใช่ 0
  assert.equal(e3.readings_count, 0); assert.equal(e3.peak_rain_24h_mm, null); assert.equal(e3.min_bank_diff_m, null); assert.equal(e3.stations_count, 0)
  console.log('✓ รายการ: เรียงใหม่→เก่า · ไม่ปนของ อปท. อื่น · ค่าสูงสุด/ใกล้ตลิ่งสุดนับเฉพาะค่าที่วัดได้ · ไม่มีค่า = null ไม่ใช่ 0')
}

// ── 5) ตัวจำกัดจำนวน + ตัวจด ──
{
  const one = (await as('authenticated', U.staffA, () => list(A, 1))).rows[0].r
  assert.equal(one.events.length, 1); assert.equal(one.events[0].id, E1); assert.equal(one.total, 3, 'total นับทั้งหมด ไม่ใช่เฉพาะที่ส่งมา')
  assert.equal((await as('authenticated', U.staffA, () => list(A, 0))).rows[0].r.events.length, 1, 'limit 0 → ขั้นต่ำ 1')
  assert.equal((await as('authenticated', U.staffA, () => list(A, -5))).rows[0].r.events.length, 1, 'limit ติดลบ → ขั้นต่ำ 1')
  assert.equal((await as('authenticated', U.staffA, () => list(A, 100000))).rows[0].r.events.length, 3, 'limit ใหญ่เกิน → เพดาน 100 ไม่ error')
  assert.equal((await as('authenticated', U.staffA, () => list(A, null))).rows[0].r.events.length, 3, 'limit null → ค่าเริ่มต้น')

  assert.equal(listing.recorder, null, 'ยังไม่มี heartbeat → recorder เป็น null (หน้าเว็บบอกว่ายังไม่มีบันทึกการตรวจ)')
  await db.exec(`INSERT INTO public.job_heartbeats (job_name, last_ok_at, last_error_at, last_error)
                 VALUES ('water-event-tick', '2026-10-20T08:20:03Z', '2026-10-19T01:20:00Z', 'ข้อความภายใน: password=secret host=10.0.0.5')`)
  const rec = (await as('authenticated', U.staffA, () => list(A))).rows[0].r.recorder
  assert.deepEqual(Object.keys(rec).sort(), ['last_error_at', 'last_ok_at'], 'ส่งแค่เวลา ไม่ส่ง last_error')
  assert.equal(new Date(rec.last_ok_at).toISOString(), '2026-10-20T08:20:03.000Z')
  assert.ok(!JSON.stringify((await as('authenticated', U.staffA, () => list(A))).rows[0].r).includes('password'), 'ข้อความ error ภายในต้องไม่หลุด')
  console.log('✓ limit: 1..100 · total นับทั้งหมด · recorder: ไม่มี heartbeat = null, มี = ส่งแค่เวลา ไม่ส่งข้อความ error ภายใน')
}

// ── 6) รายละเอียด ──
{
  const d = (await as('authenticated', U.officerA, () => detail(A, E1))).rows[0].r
  assert.equal(d.event.id, E1); assert.equal(d.event.close_reason, null)
  assert.deepEqual(d.stations.map(s => `${s.station_type}:${s.station_code}`), ['dam:D1', 'rain:R1', 'waterlevel:L1'])
  const rain = d.stations.find(s => s.station_code === 'R1')
  assert.equal(rain.station_name, 'สถานี ก', 'ใช้ชื่อสถานีล่าสุด')
  assert.deepEqual(rain.readings.map(r => r.t), ['2026-10-20T03:10:00+00:00', '2026-10-20T04:10:00+00:00', '2026-10-20T05:10:00+00:00'], 'เรียงเวลา')
  assert.equal(Number(rain.readings[2].rain_24h), 0, 'ฝน 0 มม. ที่วัดได้ยังเป็น 0')
  assert.ok(!('level_msl' in rain.readings[0]) && !('bank_diff' in rain.readings[0]), 'ค่าว่างถูกตัดออก ไม่กลายเป็น 0')
  const lvl = d.stations.find(s => s.station_code === 'L1')
  assert.ok(!('level_msl' in lvl.readings[1]), 'ระดับน้ำที่ไม่มีค่า = ไม่มีคีย์ ไม่ใช่ 0')
  assert.equal(Number(lvl.readings[1].bank_diff), 0.8)
  assert.ok(lvl.readings.every(r => !('rain_24h' in r) && !('rain_1h' in r) && !('storage_pct' in r)), 'ตัวชี้วัดที่สถานีนี้ไม่มี = ไม่มีคีย์ ไม่ใช่ 0')
  assert.equal(d.warnings.length, 2)
  assert.equal(d.warnings[0].message, 'ข้อความก่อนหน้า'); assert.equal(d.warnings[1].message, 'ข้อความต้นฉบับ <b>ไม่ตัดแต่ง</b>', 'ข้อความ สสน. ตามต้นฉบับ (หน้าเว็บเป็นคน escape)')
  assert.ok(!('station_name' in d.warnings[0]), 'ค่าว่างของข้อความถูกตัดออก')
  console.log('✓ รายละเอียด: เรียงเวลา · ใช้ชื่อสถานีล่าสุด · ค่าว่างไม่มีคีย์ (ไม่ใช่ 0) · ข้อความ สสน. ตามต้นฉบับ')
}

// ── 7) ข้าม อปท. ──
{
  const cross = (await as('authenticated', U.staffA, () => detail(A, EB))).rows[0].r
  assert.equal(cross, null, 'ถามเหตุการณ์ของ B ด้วยสิทธิ์ของ A (ส่ง id ของ A) ต้องได้ NULL ไม่ใช่ข้อมูล')
  await as('authenticated', U.staffA, () => denied('staff ของ A ส่ง id ของ B', () => detail(B, EB)))
  assert.equal((await as('authenticated', U.staffB, () => detail(B, EB))).rows[0].r.event.id, EB)
  assert.equal((await as('authenticated', U.superadmin, () => detail(B, EB))).rows[0].r.event.id, EB)
  assert.equal((await as('authenticated', U.superadmin, () => detail(A, EB))).rows[0].r, null, 'superadmin ส่ง อปท. ผิดคู่กับ id ก็ได้ NULL')
  assert.equal((await as('authenticated', U.staffA, () => detail(A, uuid(999)))).rows[0].r, null, 'ไม่พบ = NULL')
  console.log('✓ ข้าม อปท.: id ของ อปท. อื่นได้ NULL · ส่ง อปท. อื่นถูกปฏิเสธ · superadmin ส่งผิดคู่ได้ NULL')
}

// ── 8) เหตุการณ์ใหญ่: เกิน 1,000 แถวต้องมาครบ (เพดานของ API ตารางตรงจะตัดเงียบ) ──
{
  const BIG = uuid(301)
  await db.exec(`
    INSERT INTO public.water_events (id, municipality_id, opened_at, last_fresh_at, ended_at, closed_at, close_reason, open_reason)
      VALUES ('${BIG}', '${A}', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z', '2026-08-05T00:00:00Z', '2026-08-06T00:00:00Z', 'calm', '{"rule_version":1,"triggers":[]}');
    INSERT INTO public.water_event_readings (event_id, station_type, station_code, station_name, recorded_at, rain_24h_mm)
    SELECT '${BIG}', 'rain', 'S' || (i % 12), 'สถานี ' || (i % 12), '2026-08-01T00:00:00Z'::timestamptz + (i / 12) * interval '1 hour', (i % 50)::numeric
    FROM generate_series(0, 1199) AS i;
  `)
  const d = (await as('authenticated', U.staffA, () => detail(A, BIG))).rows[0].r
  const total = d.stations.reduce((n, s) => n + s.readings.length, 0)
  assert.equal(d.stations.length, 12); assert.equal(total, 1200, 'ต้องได้ครบ 1,200 แถว ไม่โดนตัดที่ 1,000')
  const l = (await as('authenticated', U.staffA, () => list(A))).rows[0].r.events.find(e => e.id === BIG)
  assert.equal(l.readings_count, 1200); assert.equal(l.stations_count, 12)
  console.log('✓ เหตุการณ์ใหญ่: 1,200 แถว 12 สถานี มาครบ ไม่โดนเพดาน 1,000')
}

// ── 9) ไม่เขียนอะไร: ทำงานได้ในธุรกรรมอ่านอย่างเดียว + เป็นฟังก์ชัน STABLE ──
{
  const vol = (await db.query(`SELECT proname, provolatile FROM pg_proc WHERE proname IN ('list_water_events','get_water_event','can_view_water_events') ORDER BY proname`)).rows
  assert.equal(vol.length, 3); assert.ok(vol.every(v => v.provolatile === 's'), 'ทุกตัวต้อง STABLE')
  await db.exec(`SELECT set_config('test.uid', '${U.staffA}', false)`)
  await db.exec('BEGIN READ ONLY')
  try {
    await db.query('SELECT public.list_water_events($1)', [A])
    await db.query('SELECT public.get_water_event($1, $2)', [A, E1])
  } finally { await db.exec('ROLLBACK') }
  const before = (await db.query(`SELECT (SELECT count(*) FROM public.water_events) AS e, (SELECT count(*) FROM public.water_event_readings) AS r, (SELECT count(*) FROM public.water_event_warnings) AS w`)).rows[0]
  await db.query('SELECT public.list_water_events($1)', [A])
  await db.query('SELECT public.get_water_event($1, $2)', [A, E1])
  const after = (await db.query(`SELECT (SELECT count(*) FROM public.water_events) AS e, (SELECT count(*) FROM public.water_event_readings) AS r, (SELECT count(*) FROM public.water_event_warnings) AS w`)).rows[0]
  assert.deepEqual(after, before, 'เรียกแล้วไม่มีแถวเพิ่ม/ลด')
  console.log('✓ อ่านอย่างเดียว: ทุกฟังก์ชัน STABLE · ทำงานในธุรกรรม READ ONLY ได้ · ไม่มีแถวเปลี่ยน')
}

console.log('\n✅ water-events-rpc-db: ผ่านทุกข้อ')
