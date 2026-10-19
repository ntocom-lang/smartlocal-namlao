// ประกาศน้ำ-ฝนที่มีผู้ยืนยัน (เฟส 2 · PR 2.1) — รัน migration จริงใน PostgreSQL จำลอง (PGlite)
// node tests/water-announcements-db.test.mjs --pglite <โฟลเดอร์>/node_modules/@electric-sql/pglite/dist/index.js
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะข้อมูลจริง
//
// เรื่องที่ต้องไม่พลาด (เส้นที่ห้ามข้าม — ดุลพินิจของผู้บริหาร):
//  (1) ใครยืนยัน/ไม่ประกาศ/ยกเลิกได้ — เฉพาะบัญชีที่ตรงกับผู้ลงนามระดับหน่วยงาน (นายก/ปลัด) ที่ active วันนี้ของ อปท. นั้น
//      admin ทั่วไป · superadmin · หัวหน้ากอง · ผู้ลงนามที่ไม่มีบัญชี · ผู้ลงนามหมดอายุ/ปิดแล้ว/ต่าง อปท. = ไม่ได้
//  (2) ไม่มีคนกดยืนยัน = ไม่มีอะไรออกหน้าประชาชน (ร่างไม่โผล่ ไม่หมดอายุแล้วค้าง)
//  (3) ข้อความที่ยืนยันแก้ไม่ได้ ลบไม่ได้ ล้างตารางไม่ได้ · ตารางปิดสนิทต่อ anon/authenticated
//  (4) ร่างเฉพาะตอนมีค่าสดและสัญญาณยังเข้าเกณฑ์ · ค่าว่างไม่กลายเป็น 0 · ข้อความไม่มีคำสั่งอพยพ/คำรับรองความปลอดภัย
//  (5) ทุกการตัดสินของคนลง audit_logs · อปท. ที่ไม่ได้เปิดใช้ไม่ถูกร่าง/ไม่ขึ้นหน้าประชาชน
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const modulePath = process.argv[process.argv.indexOf('--pglite') + 1]
assert.ok(process.argv.includes('--pglite') && modulePath, 'Supply --pglite <local module path>')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const sql = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const F_TABLES = '20261020100000_water_announcements_tables.sql'
const F_FUNCS = '20261020100100_water_announcements_functions.sql'
const F_EV_TABLES = '20261016100000_water_events_tables.sql'
const F_EV_TICK = '20261016100100_water_events_tick_cron.sql'
const F_EV_RPC = '20261017100000_water_events_staff_rpc.sql'
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
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL, municipality_id uuid, full_name text);
-- ทะเบียนผู้ลงนามกลาง (เฉพาะคอลัมน์ที่ฟังก์ชันอ่าน)
CREATE TABLE public.document_signatories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL, document_type text NOT NULL DEFAULT 'complaint',
  signatory_role text NOT NULL, department_id uuid, profile_id uuid, manual_name text,
  is_active boolean NOT NULL DEFAULT true, effective_from date, effective_to date
);
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, municipality_id uuid, actor_id uuid, actor_name text, actor_role text,
  action text NOT NULL, resource_type text NOT NULL, resource_id text, resource_label text, metadata jsonb, created_at timestamptz DEFAULT now()
);
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

const tablesText = await sql(F_TABLES)
const funcsText = await sql(F_FUNCS)
const stripComments = (s) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
const code = stripComments(funcsText)

// ── 0) อ่านไฟล์: โครงสร้างความปลอดภัย + ถ้อยคำ ──
{
  // ฟังก์ชันที่เปลี่ยนสถานะ/อ่านข้อมูลต้องเป็น DEFINER ตั้ง search_path ทุกตัว
  const fnBlocks = code.split(/CREATE OR REPLACE FUNCTION /).slice(1)
  assert.ok(fnBlocks.length >= 12, `พบฟังก์ชัน ${fnBlocks.length}`)
  for (const b of fnBlocks) {
    const name = b.slice(0, b.indexOf('(')).trim()
    assert.ok(/SET search_path = pg_catalog, public/.test(b.split('$$')[0]), `${name}: ต้องตั้ง search_path`)
  }
  for (const name of ['water_announcement_tick', 'approve_water_announcement', 'decline_water_announcement', 'cancel_water_announcement',
    'list_water_announcements', 'get_public_water_announcement', 'can_approve_water_announcement']) {
    const b = fnBlocks.find(x => x.startsWith(`public.${name}(`))
    assert.ok(b && /SECURITY DEFINER/.test(b.split('$$')[0]), `${name}: ต้องเป็น SECURITY DEFINER`)
  }
  // ไม่มีทางเขียนข้ามฟังก์ชัน: ไม่เปิด policy/GRANT ตาราง
  assert.ok(!/CREATE POLICY/.test(code), 'ห้ามเปิด policy อ่านตรง')
  assert.ok(!/GRANT\s+(SELECT|ALL|INSERT|UPDATE|DELETE|TRUNCATE)[^;]*ON\s+(TABLE\s+)?public\.water_announcement/i.test(code), 'ห้ามเปิดสิทธิ์ตาราง')
  // ไม่ส่งข้อมูลภายในออกหน้าจอ
  const listFn = fnBlocks.find(x => x.startsWith('public.list_water_announcements('))
  assert.ok(!/\bfacts\b/.test(listFn.split('$$')[1]), 'หน้าเจ้าหน้าที่ไม่ส่ง facts')
  assert.ok(!/last_error\b(?!_at)/.test(listFn.split('$$')[1].replace(/last_error_at/g, '')), 'หน้าเจ้าหน้าที่ไม่ส่ง last_error (ข้อความ error ภายใน) ออกไป')
  const pubFn = fnBlocks.find(x => x.startsWith('public.get_public_water_announcement('))
  assert.ok(!/published_by|closed_by|profile/.test(pubFn.split('$$')[1]), 'หน้าประชาชนไม่ส่งตัวตนผู้ยืนยัน')
  // ข้อความร่างต้องไม่มีคำของผู้มีอำนาจ/คำสั่ง/คำรับรอง — ข้อความ "ควรทำอะไร" ต้องมาจากแผนของ อบต.
  const draftFn = fnBlocks.find(x => x.startsWith('public.water_announcement_draft_text('))
  const literals = [...draftFn.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1]).join(' ')
  for (const w of ['อพยพ', 'ปลอดภัย', 'รับรอง', 'ประกาศเขต', 'ภัยพิบัติ', 'ช่วยเหลือ', 'สั่งการ', 'มาตรา', 'ห้าม', 'ควรทำ', 'ขอให้ย้าย', 'ท่วมแน่', 'จะท่วม', 'น้ำจะถึง']) {
    assert.ok(!literals.includes(w), `ข้อความร่างห้ามมีคำว่า "${w}"`)
  }
  assert.ok(literals.includes('ไม่ใช่การพยากรณ์'), 'ข้อความร่างต้องบอกว่าไม่ใช่การพยากรณ์')
  // ผู้ยืนยัน: ต้องไม่รวม superadmin/admin ทั่วไป — อ่านจากทะเบียนผู้ลงนามเท่านั้น
  const apprFn = fnBlocks.find(x => x.startsWith('public.can_approve_water_announcement('))
  assert.ok(/document_signatories/.test(apprFn) && /department_id IS NULL/.test(apprFn) && /water_announcement_approver_roles\(\)/.test(apprFn))
  assert.ok(!/superadmin/.test(apprFn.split('$$')[1]), 'superadmin ไม่ใช่ผู้มีอำนาจประกาศโดยตำแหน่ง')
  assert.ok(/ARRAY\['mayor', 'clerk'\]/.test(code), 'ผู้ยืนยันตั้งต้น = นายก + ปลัด ที่ฟังก์ชันเดียว')
  // ตารางใหม่ต้อง REVOKE ก่อน (กับดัก default privileges) + RLS
  for (const t of ['water_announcement_settings', 'water_announcements']) {
    assert.ok(new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon, authenticated, PUBLIC`).test(code), `${t}: ต้อง REVOKE ALL`)
    assert.ok(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`).test(code), `${t}: ต้องเปิด RLS`)
  }
  // ตาราง: ไม่มีคอลัมน์ข้อมูลบุคคล
  const tcode = stripComments(tablesText)
  for (const bad of ['phone', 'tel', 'id_card', 'citizen', 'address', 'lat', 'lng', 'latitude', 'longitude', 'email']) {
    assert.ok(!new RegExp(`^\\s+${bad}\\b`, 'm').test(tcode), `ตารางห้ามมีคอลัมน์ ${bad}`)
  }
  console.log('✓ ไฟล์: ฟังก์ชัน DEFINER ตั้ง search_path · ไม่มี policy/GRANT ตาราง · ไม่ส่ง facts/ตัวตนผู้ยืนยันออกหน้าจอ · ข้อความร่างไม่มีคำสั่ง/คำรับรอง · ผู้ยืนยันมาจากทะเบียนผู้ลงนามเท่านั้น (ไม่รวม superadmin)')
}

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

// ── 1) ลำดับ apply + apply ซ้ำได้ ──
{
  await fails(guardDb, 'ไฟล์ตารางก่อนตารางเหตุการณ์', tablesText, /ต้อง apply 20261016100000/)
  for (const f of [...PREREQ, F_EV_TABLES]) await guardDb.exec(await sql(f))
  await fails(guardDb, 'ไฟล์ฟังก์ชันก่อนไฟล์ตาราง', funcsText, /ต้อง apply 20261020100000/)
  await guardDb.exec(tablesText)
  await fails(guardDb, 'ไฟล์ฟังก์ชันก่อนฟังก์ชันอ่านของเหตุการณ์', funcsText, /ต้อง apply 20261017100000/)
  for (const f of [...PREREQ, F_EV_TABLES, F_EV_TICK, F_EV_RPC]) await db.exec(await sql(f))
  await db.exec(tablesText)
  await db.exec(tablesText) // ซ้ำได้
  await db.exec(funcsText)
  await db.exec(funcsText) // ซ้ำได้
  console.log('✓ apply: ไฟล์ที่มาก่อนของที่ต้องพึ่งถูกปฏิเสธพร้อมบอกไฟล์ที่ต้อง apply ก่อน · apply ซ้ำได้ทั้งสองไฟล์')
}

// ── ข้อมูลทดสอบ ──
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = uuid(1), B = uuid(2), C = uuid(3)
const DEPT = uuid(50)
const U = {
  mayorA: uuid(11), clerkA: uuid(12), staffA: uuid(13), adminA: uuid(14), deptHeadA: uuid(15), customA: uuid(16),
  mayorB: uuid(17), superadmin: uuid(18), citizenA: uuid(19), expiredA: uuid(20), futureA: uuid(21), inactiveA: uuid(22),
  technicianA: uuid(23), councilA: uuid(24), mayorAtoB: uuid(25), none: uuid(29),
}
const day = (offset) => new Date(Date.now() + offset * 86400000 + 7 * 3600000).toISOString().slice(0, 10)
await db.exec(`
  INSERT INTO public.municipalities (id, slug, name, district, province, enabled_modules) VALUES
    ('${A}', 'aa', 'อบต.ตัวอย่าง ก', 'หนองม่วงไข่', 'แพร่', NULL),
    ('${B}', 'bb', 'อบต.ตัวอย่าง ข', 'ร้องกวาง', 'แพร่', NULL),
    ('${C}', 'cc', 'อบต.ปิดโมดูล', 'เด่นชัย', 'แพร่', ARRAY['events']);
  INSERT INTO public.profiles (id, role, municipality_id, full_name) VALUES
    ('${U.mayorA}', 'admin', '${A}', 'ผู้ลงนาม นายก'), ('${U.clerkA}', 'staff', '${A}', 'ผู้ลงนาม ปลัด'),
    ('${U.staffA}', 'staff', '${A}', 'เจ้าหน้าที่ทั่วไป'), ('${U.adminA}', 'admin', '${A}', 'ผู้ดูแลระบบ'),
    ('${U.deptHeadA}', 'officer', '${A}', 'หัวหน้ากอง'), ('${U.customA}', 'officer', '${A}', 'ผู้ลงนามกำหนดเอง'),
    ('${U.mayorB}', 'admin', '${B}', 'นายก ข'), ('${U.superadmin}', 'superadmin', NULL, 'ซูเปอร์แอดมิน'),
    ('${U.citizenA}', 'citizen', '${A}', 'ประชาชน'), ('${U.expiredA}', 'admin', '${A}', 'นายกคนเก่า'),
    ('${U.futureA}', 'admin', '${A}', 'นายกคนใหม่ยังไม่เริ่ม'), ('${U.inactiveA}', 'admin', '${A}', 'นายกที่ถูกปิดแถว'),
    ('${U.technicianA}', 'technician', '${A}', 'ช่าง'), ('${U.councilA}', 'council', '${A}', 'สภา'),
    ('${U.mayorAtoB}', 'admin', '${A}', 'ผู้ลงนามของ ข แต่บัญชีอยู่ ก');
  INSERT INTO public.document_signatories (municipality_id, signatory_role, department_id, profile_id, is_active, effective_from, effective_to) VALUES
    ('${A}', 'mayor', NULL, '${U.mayorA}', true, '${day(-30)}', NULL),
    ('${A}', 'clerk', NULL, '${U.clerkA}', true, '${day(-30)}', NULL),
    ('${A}', 'department_head', '${DEPT}', '${U.deptHeadA}', true, '${day(-30)}', NULL),
    ('${A}', 'custom', NULL, '${U.customA}', true, '${day(-30)}', NULL),
    ('${A}', 'mayor', NULL, '${U.expiredA}', true, '${day(-90)}', '${day(-2)}'),
    ('${A}', 'mayor', NULL, '${U.futureA}', true, '${day(5)}', NULL),
    ('${A}', 'clerk', NULL, '${U.inactiveA}', false, '${day(-90)}', NULL),
    ('${B}', 'mayor', NULL, '${U.mayorB}', true, '${day(-30)}', NULL),
    ('${B}', 'clerk', NULL, '${U.mayorAtoB}', true, '${day(-30)}', NULL),
    -- แถวทะเบียนของบัญชีที่ไม่ใช่เจ้าหน้าที่ (ประชาชน/ช่าง/สภา) — แม้มีแถว บทบาทบัญชีก็ต้องไม่ผ่าน
    ('${A}', 'clerk', NULL, '${U.citizenA}', true, '${day(-30)}', NULL),
    ('${A}', 'clerk', NULL, '${U.technicianA}', true, '${day(-30)}', NULL),
    ('${A}', 'clerk', NULL, '${U.councilA}', true, '${day(-30)}', NULL);
  INSERT INTO public.document_signatories (municipality_id, signatory_role, department_id, profile_id, manual_name, is_active, effective_from) VALUES
    ('${A}', 'mayor', NULL, NULL, 'ชื่อกรอกเอง ไม่มีบัญชี', false, '${day(-400)}');
`)

const as = async (role, uid, fn) => {
  await db.exec(`SET ROLE ${role}`)
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ''])
  try { return await fn() } finally {
    await db.exec('RESET ROLE')
    await db.query(`SELECT set_config('test.uid', '', false)`)
  }
}
const asUser = (uid, fn) => as('authenticated', uid, fn)
const approve = (id, hours) => hours === undefined
  ? db.query('SELECT public.approve_water_announcement($1) AS r', [id])
  : db.query('SELECT public.approve_water_announcement($1, $2) AS r', [id, hours])
const decline = (id) => db.query('SELECT public.decline_water_announcement($1) AS r', [id])
const cancel = (id) => db.query('SELECT public.cancel_water_announcement($1) AS r', [id])
const list = (muni, limit) => limit === undefined
  ? db.query('SELECT public.list_water_announcements($1) AS r', [muni])
  : db.query('SELECT public.list_water_announcements($1, $2) AS r', [muni, limit])
const pub = (muni) => db.query('SELECT public.get_public_water_announcement($1) AS r', [muni])
const tick = async (at) => (await db.query('SELECT public.water_announcement_tick($1::timestamptz) AS r', [at])).rows[0].r
const rows = async (where = 'true', params = []) =>
  (await db.query(`SELECT id, status, body, event_id, drafted_at, published_at, expires_at, closed_at, published_by, closed_by FROM public.water_announcements WHERE ${where} ORDER BY drafted_at, id`, params)).rows
const iso = (ms) => new Date(ms).toISOString()
// ล้างข้อมูลทดสอบ: ตัวล็อกห้ามลบ จึงปิดชั่วคราวเฉพาะตรงนี้ (เทสต์ข้อ 11 ตรวจว่าลบจริงไม่ได้)
const wipe = async () => {
  await db.exec(`ALTER TABLE public.water_announcements DISABLE TRIGGER water_announcements_guard_row`)
  await db.exec(`DELETE FROM public.water_announcements`)
  await db.exec(`ALTER TABLE public.water_announcements ENABLE TRIGGER water_announcements_guard_row`)
}
const NOW = Date.now()
const HOUR = 3600000
const nowIso = iso(NOW)

// เหตุการณ์ของ A (เปิดอยู่ เข้าเกณฑ์ตอนนี้) + ค่าที่วัดได้
const EV1 = uuid(101)
const resetEvent = async (sqlExtra = '') => {
  await db.exec(`
    DELETE FROM public.water_event_readings; DELETE FROM public.water_event_warnings;
    DELETE FROM public.water_events WHERE municipality_id = '${A}';
    INSERT INTO public.water_events (id, municipality_id, opened_at, last_hot_at, last_fresh_at, calm_since, open_reason)
      VALUES ('${EV1}', '${A}', '${iso(NOW - 5 * HOUR)}', '${iso(NOW - 20 * 60000)}', '${iso(NOW - 20 * 60000)}', NULL,
        '{"rule_version":1,"triggers":[{"kind":"rain","station_code":"R1","station_name":"บ้านบุญแจ่ม","value":95.55,"recorded_at":"${iso(NOW - 5 * HOUR)}"},{"kind":"waterlevel","station_code":"L1","station_name":"Y.38","value":0.4,"recorded_at":"${iso(NOW - 5 * HOUR)}"}]}');
    INSERT INTO public.water_event_readings (event_id, station_type, station_code, station_name, recorded_at, rain_24h_mm, bank_diff_m) VALUES
      ('${EV1}', 'rain', 'R1', 'บ้านบุญแจ่ม', '${iso(NOW - 4 * HOUR)}', 80, NULL),
      ('${EV1}', 'rain', 'R1', 'บ้านบุญแจ่ม', '${iso(NOW - 40 * 60000)}', 95.55, NULL),
      ('${EV1}', 'waterlevel', 'L1', 'Y.38', '${iso(NOW - 50 * 60000)}', NULL, 0.4);
    ${sqlExtra}
  `)
}

// ── 2) ตารางปิดสนิท ──
{
  for (const role of ['anon', 'authenticated']) {
    for (const tbl of ['water_announcements', 'water_announcement_settings']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        assert.equal((await db.query(`SELECT has_table_privilege('${role}', 'public.${tbl}', '${p}') AS ok`)).rows[0].ok, false, `${role} ต้องไม่มี ${p} บน ${tbl}`)
      }
    }
  }
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename LIKE 'water_announcement%'`)).rows[0].n, 0, 'ไม่มี policy อ่านตรง')
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('water_announcements','water_announcement_settings') AND relrowsecurity`)).rows[0].n, 2, 'RLS เปิดทั้งสองตาราง')
  await asUser(U.mayorA, () => fails(db, 'ผู้ยืนยันอ่านตารางตรง', 'SELECT * FROM public.water_announcements', /permission denied/))
  await as('anon', null, () => fails(db, 'anon อ่านตารางตรง', 'SELECT * FROM public.water_announcements', /permission denied/))
  for (const fn of ['public.water_announcement_tick(timestamptz)', 'public.water_announcement_draft_text(text, uuid, timestamptz, jsonb, timestamptz)',
    'public.water_announcement_audit(uuid, text, uuid, jsonb)', 'public.water_announcement_approver_roles()', 'public.water_announcement_thai_time(timestamptz)',
    'public.water_announcements_guard()']) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS ok`)).rows[0].ok, false, `${role} ต้องเรียก ${fn} ไม่ได้`)
    }
  }
  for (const fn of ['public.approve_water_announcement(uuid, integer)', 'public.decline_water_announcement(uuid)', 'public.cancel_water_announcement(uuid)',
    'public.list_water_announcements(uuid, integer)', 'public.can_approve_water_announcement(uuid)']) {
    assert.equal((await db.query(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE') AS ok`)).rows[0].ok, false, `anon ต้องเรียก ${fn} ไม่ได้`)
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE') AS ok`)).rows[0].ok, true, `authenticated เรียก ${fn} ได้`)
  }
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`SELECT has_function_privilege('${role}', 'public.get_public_water_announcement(uuid)', 'EXECUTE') AS ok`)).rows[0].ok, true, `${role} อ่านประกาศสาธารณะได้`)
  }
  console.log('✓ ตารางปิดสนิท (ไม่มีสิทธิ์/ไม่มี policy/RLS เปิด) · ตัวร่าง/ตัวช่วยเรียกจากเว็บไม่ได้ · anon เรียกได้เฉพาะ get_public_water_announcement')
}

// ── 3) cron ──
{
  const j = (await db.query(`SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'water-announce-tick-hourly'`)).rows
  assert.equal(j.length, 1)
  assert.equal(j[0].schedule, '25 * * * *', 'หลัง water_event_tick (นาทีที่ 20)')
  assert.match(j[0].command, /water_announcement_tick/)
  console.log('✓ cron: ทุกชั่วโมงนาทีที่ 25 (หลังตัวจดเหตุการณ์นาทีที่ 20) · ไม่ซ้ำหลัง apply สองรอบ')
}

// ── 4) ตัวร่าง ──
await resetEvent()
{
  // ไม่มีแถวตั้งค่า = ปิด
  let r = await tick(nowIso)
  assert.equal(r.drafted, 0); assert.equal(r.checked, 0); assert.equal((await rows()).length, 0, 'ไม่มีแถวตั้งค่า → ไม่ร่าง')
  // ปิดสวิตช์ = ไม่ร่าง
  await db.exec(`INSERT INTO public.water_announcement_settings (municipality_id, enabled) VALUES ('${A}', false)`)
  r = await tick(nowIso)
  assert.equal(r.drafted, 0); assert.equal((await rows()).length, 0, 'enabled=false → ไม่ร่าง')
  // เปิดใช้ แต่ อปท. ปิดโมดูลน้ำ-ฝน (C) → ไม่ร่าง/ไม่ตรวจ
  await db.exec(`INSERT INTO public.water_announcement_settings (municipality_id, enabled) VALUES ('${C}', true)`)
  await db.exec(`INSERT INTO public.water_events (municipality_id, opened_at, last_hot_at, last_fresh_at, open_reason) VALUES ('${C}', '${nowIso}', '${nowIso}', '${nowIso}', '{"rule_version":1,"triggers":[]}')`)
  r = await tick(nowIso)
  assert.equal(r.checked, 0, 'อปท. ที่ปิดโมดูลน้ำ-ฝนไม่ถูกตรวจ')
  await db.exec(`DELETE FROM public.water_events WHERE municipality_id = '${C}'`)
  // ค่าเริ่มต้นของสวิตช์ = ปิด (อปท. ที่ถูกเพิ่มแถวตั้งค่าโดยไม่ระบุ enabled ต้องไม่ถูกร่างประกาศ)
  await db.exec(`INSERT INTO public.water_announcement_settings (municipality_id) VALUES ('${B}')`)
  const dflt = (await db.query(`SELECT enabled, default_expiry_hours FROM public.water_announcement_settings WHERE municipality_id = $1`, [B])).rows[0]
  assert.equal(dflt.enabled, false, 'ค่าเริ่มต้น enabled ต้องเป็น false'); assert.equal(dflt.default_expiry_hours, 24)
  await db.exec(`DELETE FROM public.water_announcement_settings WHERE municipality_id = '${B}'`)
  // เปิดใช้ + ไม่มีเหตุการณ์ → ไม่ร่าง
  await db.exec(`UPDATE public.water_announcement_settings SET enabled = true WHERE municipality_id = '${A}'`)
  await db.exec(`DELETE FROM public.water_events WHERE municipality_id = '${A}'`)
  r = await tick(nowIso)
  assert.equal(r.checked, 1); assert.equal(r.drafted, 0, 'ไม่มีเหตุการณ์เปิดอยู่ → ไม่ร่าง')
  console.log('✓ ตัวร่าง: ไม่มีแถวตั้งค่า/ปิดสวิตช์/ปิดโมดูล/ไม่มีเหตุการณ์ = ไม่ร่างอะไรเลย')
}

await resetEvent()
let DRAFT
{
  const r = await tick(nowIso)
  assert.equal(r.ok, true); assert.equal(r.drafted, 1); assert.deepEqual(r.errors, [])
  const [d] = await rows()
  DRAFT = d
  assert.equal(d.status, 'draft'); assert.equal(d.event_id, EV1)
  assert.equal(d.published_at, null); assert.equal(d.expires_at, null)
  // ข้อความ: ค่าที่วัดล่าสุดของสถานีที่เปิดเหตุการณ์ + เวลาไทย พ.ศ. + ไม่ใช่การพยากรณ์ + ไม่มีคำสั่ง
  assert.match(d.body, /^ประกาศจาก อบต\.ตัวอย่าง ก/)
  assert.match(d.body, /สถานีฝน บ้านบุญแจ่ม วัดฝนสะสม 24 ชั่วโมงได้ 95\.[56] มม\./)
  assert.match(d.body, /สถานีระดับน้ำ Y\.38 ระดับน้ำต่ำกว่าตลิ่ง 40 ซม\./)
  assert.ok(!d.body.includes('80'), 'ใช้ค่าล่าสุด ไม่ใช่ค่าเก่าของสถานีเดียวกัน')
  assert.match(d.body, /256[0-9] เวลา \d\d:\d\d น\./, 'เวลาเป็นเวลาไทย พ.ศ.')
  assert.ok(d.body.includes('ไม่ใช่การพยากรณ์'))
  for (const w of ['อพยพ', 'ปลอดภัย', 'รับรอง', 'ประกาศเขต', 'ภัยพิบัติ', 'ช่วยเหลือ', 'สั่งการ', 'มาตรา', 'NaN', 'null', 'undefined']) assert.ok(!d.body.includes(w), `ข้อความห้ามมี ${w}`)
  assert.ok(d.body.length <= 1500)
  assert.equal(JSON.parse(JSON.stringify((await db.query(`SELECT facts FROM public.water_announcements WHERE id = $1`, [d.id])).rows[0].facts)).rule_version, 1)
  // ซ้ำรอบเดียวกัน/รอบถัดไป ไม่ร่างซ้อน
  const r2 = await tick(iso(NOW + 5 * 60000)); assert.equal(r2.drafted, 0)
  // ต้องไม่ชนตัวกันซ้อนของฐานข้อมูลด้วย (รอบที่ "พยายามร่างซ้อนแล้วถูก index ปฏิเสธ" นับเป็นความผิดพลาดของตัวร่าง ไม่ใช่เรื่องปกติ)
  assert.equal(r2.ok, true, `รอบถัดไปต้องไม่มี error: ${JSON.stringify(r2.errors)}`)
  assert.deepEqual(r2.errors, [])
  assert.equal((await rows()).length, 1)
  // ลงสมุดงาน
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.job_heartbeats WHERE job_name = 'water-announce-tick' AND last_ok_at IS NOT NULL`)).rows[0].n, 1)
  console.log('✓ ร่าง: ใช้ค่าล่าสุดของสถานีที่เปิดเหตุการณ์ · เวลาไทย พ.ศ. · ไม่ใช่การพยากรณ์ · ไม่มีคำสั่ง/คำรับรอง · ไม่ร่างซ้อน · ลงสมุดงาน')
}

// ไม่ร่างเมื่อค่าเก่า / ค่าว่าง / เหตุการณ์สงบ
{
  await wipe()
  await resetEvent(`UPDATE public.water_event_readings SET recorded_at = recorded_at - interval '4 hours'`) // ทุกค่าเก่ากว่า 3 ชม.
  assert.equal((await tick(nowIso)).drafted, 0, 'ค่าเก่ากว่า 3 ชม. = ไม่ร่าง')
  await resetEvent(`UPDATE public.water_event_readings SET rain_24h_mm = NULL, bank_diff_m = NULL`)
  assert.equal((await tick(nowIso)).drafted, 0, 'ค่าว่าง = ไม่ร่าง (ไม่กลายเป็น 0)')
  await resetEvent(`UPDATE public.water_events SET calm_since = '${iso(NOW - HOUR)}'`)
  assert.equal((await tick(nowIso)).drafted, 0, 'เหตุการณ์กำลังสงบ = ไม่ร่าง')
  await resetEvent(`UPDATE public.water_events SET last_hot_at = '${iso(NOW - 5 * HOUR)}'`)
  assert.equal((await tick(nowIso)).drafted, 0, 'รอบตรวจเหตุการณ์ล่าสุดไม่เข้าเกณฑ์/ตัวจดหยุด = ไม่ร่าง')
  // ค่า 0 ที่วัดได้จริง ต้องพูดว่า 0 ไม่ใช่ข้ามไป
  await resetEvent(`UPDATE public.water_event_readings SET rain_24h_mm = 0 WHERE station_type = 'rain'`)
  assert.equal((await tick(nowIso)).drafted, 1)
  assert.match((await rows())[0].body, /ได้ 0 มม\./, 'ค่า 0 ที่วัดได้ต้องแสดงเป็น 0')
  await wipe()
  // น้ำเสมอตลิ่ง / สูงกว่าตลิ่ง
  await resetEvent(`UPDATE public.water_event_readings SET bank_diff_m = 0 WHERE station_type = 'waterlevel'`)
  await tick(nowIso); assert.match((await rows())[0].body, /ระดับน้ำเสมอตลิ่ง/)
  await wipe()
  await resetEvent(`UPDATE public.water_event_readings SET bank_diff_m = -0.37 WHERE station_type = 'waterlevel'`)
  await tick(nowIso); assert.match((await rows())[0].body, /ระดับน้ำสูงกว่าตลิ่ง 37 ซม\./)
  await wipe()
  console.log('✓ ไม่ร่างเมื่อ: ค่าเก่า > 3 ชม. · ค่าว่าง · เหตุการณ์กำลังสงบ · รอบตรวจเหตุการณ์เก่า — ค่า 0 ที่วัดได้ยังพูดว่า 0 · เสมอ/สูงกว่าตลิ่งใช้ถ้อยคำถูก')
}

// สถานีเกิน 6 แห่ง → ตัดเป็น "และสถานีอื่นอีก N แห่ง"
{
  let trig = '', rd = ''
  for (let i = 1; i <= 9; i++) {
    trig += `${i > 1 ? ',' : ''}{"kind":"rain","station_code":"M${i}","station_name":"สถานี${i}","value":100,"recorded_at":"${nowIso}"}`
    rd += `${i > 1 ? ',' : ''}('${EV1}','rain','M${i}','สถานี${i}','${iso(NOW - 30 * 60000)}',100 + ${i})`
  }
  await resetEvent(`
    UPDATE public.water_events SET open_reason = '{"rule_version":1,"triggers":[${trig}]}'::jsonb WHERE id = '${EV1}';
    INSERT INTO public.water_event_readings (event_id, station_type, station_code, station_name, recorded_at, rain_24h_mm) VALUES ${rd};`)
  assert.equal((await tick(nowIso)).drafted, 1)
  const [d] = await rows()
  assert.equal((d.body.match(/^• /gm) || []).length, 6, 'รายการไม่เกิน 6 บรรทัด')
  assert.match(d.body, /และสถานีอื่นอีก 4 แห่ง/, '9 สถานี = แสดง 5 + บรรทัดสรุปอีก 4')
  assert.equal((d.body.match(/สถานีฝน สถานี\d/g) || []).length, 5)
  await wipe()
  console.log('✓ สถานีเกิน 6 แห่ง: ตัดเหลือ 6 บรรทัด + "และสถานีอื่นอีก N แห่ง" (ไม่ตัดกลางประโยค)')
}

// ข้อความ สสน. ในเหตุการณ์ → บอกว่ามี ไม่คัดลอกข้อความดิบ
{
  await resetEvent(`INSERT INTO public.water_event_warnings (event_id, issued_at, message, station_name) VALUES ('${EV1}', '${iso(NOW - 2 * HOUR)}', '<b>ข้อความดิบของ สสน.</b> ให้ย้ายของขึ้นที่สูง', 'x');`)
  await tick(nowIso)
  const [d] = await rows()
  assert.match(d.body, /ข้อความเตือนของ สสน\./)
  assert.ok(!d.body.includes('ข้อความดิบ') && !d.body.includes('ย้ายของ') && !d.body.includes('<b>'), 'ไม่คัดลอกข้อความเตือนของหน่วยงานอื่นเข้าประกาศ')
  await wipe()
  console.log('✓ ข้อความ สสน.: บอกว่ามีและให้ดูฉบับเต็ม — ไม่คัดลอกข้อความดิบเข้าประกาศของ อปท.')
}

// ── 5) สิทธิ์ผู้ยืนยัน ──
await resetEvent()
await tick(nowIso)
const [D1] = await rows()
{
  const denyRe = /ไม่มีสิทธิ์ยืนยันประกาศ|ต้องเข้าสู่ระบบ/
  const nobody = [
    ['admin ทั่วไป', U.adminA], ['เจ้าหน้าที่ทั่วไป', U.staffA], ['superadmin', U.superadmin],
    ['หัวหน้ากอง (department_head)', U.deptHeadA], ['ผู้ลงนามกำหนดเอง (custom)', U.customA], ['นายกต่าง อปท.', U.mayorB],
    ['ผู้ลงนามที่หมดอายุแล้ว', U.expiredA], ['ผู้ลงนามที่ยังไม่ถึงวันเริ่ม', U.futureA], ['ผู้ลงนามที่ถูกปิดแถว', U.inactiveA],
    ['ประชาชน', U.citizenA], ['ช่าง', U.technicianA], ['สภา', U.councilA],
    ['บัญชี อปท. ก ที่เป็นผู้ลงนามของ ข', U.mayorAtoB], ['uid ที่ไม่มีใน profiles', U.none],
  ]
  for (const [who, uid] of nobody) {
    await asUser(uid, () => fails(db, `${who} approve`, 'SELECT public.approve_water_announcement($1) AS r', denyRe, [D1.id]))
    await asUser(uid, () => fails(db, `${who} decline`, 'SELECT public.decline_water_announcement($1) AS r', /ไม่มีสิทธิ์ตัดสินประกาศ|ต้องเข้าสู่ระบบ/, [D1.id]))
    await asUser(uid, () => fails(db, `${who} cancel`, 'SELECT public.cancel_water_announcement($1) AS r', /ไม่มีสิทธิ์ยกเลิกประกาศ|ต้องเข้าสู่ระบบ/, [D1.id]))
    assert.equal((await asUser(uid, () => db.query('SELECT public.can_approve_water_announcement($1) AS ok', [A]))).rows[0].ok, false, `${who}: can_approve ต้องเป็น false`)
  }
  await as('authenticated', null, () => fails(db, 'ไม่ล็อกอิน approve', 'SELECT public.approve_water_announcement($1) AS r', /ต้องเข้าสู่ระบบ/, [D1.id]))
  await as('anon', null, () => fails(db, 'anon approve', 'SELECT public.approve_water_announcement($1) AS r', /permission denied/, [D1.id]))
  assert.equal((await rows('id = $1', [D1.id]))[0].status, 'draft', 'ไม่มีใครมีสิทธิ์ = ร่างยังเป็นร่าง ไม่มีอะไรออก')
  assert.equal((await pub(A)).rows[0].r, null, 'ร่างไม่ขึ้นหน้าประชาชน')
  for (const uid of [U.mayorA, U.clerkA]) {
    assert.equal((await asUser(uid, () => db.query('SELECT public.can_approve_water_announcement($1) AS ok', [A]))).rows[0].ok, true)
  }
  assert.equal((await asUser(U.mayorA, () => db.query('SELECT public.can_approve_water_announcement($1) AS ok', [B]))).rows[0].ok, false, 'นายก ก ไม่ใช่ผู้ยืนยันของ ข')
  assert.equal((await asUser(U.mayorA, () => db.query('SELECT public.can_approve_water_announcement(NULL) AS ok'))).rows[0].ok, false)
  // บัญชีที่สังกัด อปท. ก แต่ไปอยู่ในทะเบียนผู้ลงนามของ ข → ไม่ใช่ผู้ยืนยันของ ข (สังกัดต้องตรงกันทั้งสองฝั่ง)
  assert.equal((await asUser(U.mayorAtoB, () => db.query('SELECT public.can_approve_water_announcement($1) AS ok', [B]))).rows[0].ok, false)
  console.log(`✓ สิทธิ์: ${nobody.length} กลุ่มที่ไม่ใช่นายก/ปลัดที่ active ของ อปท. นั้น ถูกปฏิเสธทั้งยืนยัน/ไม่ประกาศ/ยกเลิก · ร่างไม่ขึ้นหน้าประชาชน · นายก/ปลัดผ่าน`)
}

// ── 6) ยืนยัน ──
let PUBLISHED
{
  // อายุผิดช่วง
  await asUser(U.mayorA, () => fails(db, 'อายุ 0', 'SELECT public.approve_water_announcement($1, 0) AS r', /1–72/, [D1.id]))
  await asUser(U.mayorA, () => fails(db, 'อายุ 73', 'SELECT public.approve_water_announcement($1, 73) AS r', /1–72/, [D1.id]))
  await asUser(U.mayorA, () => fails(db, 'อายุติดลบ', 'SELECT public.approve_water_announcement($1, -5) AS r', /1–72/, [D1.id]))
  assert.equal((await rows('id = $1', [D1.id]))[0].status, 'draft')
  // ปิดสวิตช์ระหว่างรอ
  await db.exec(`UPDATE public.water_announcement_settings SET enabled = false WHERE municipality_id = '${A}'`)
  assert.deepEqual((await asUser(U.mayorA, () => approve(D1.id))).rows[0].r, { ok: false, reason: 'disabled' })
  await db.exec(`UPDATE public.water_announcement_settings SET enabled = true WHERE municipality_id = '${A}'`)
  // ยืนยันปกติ (ปลัด) — ค่าเริ่มต้น 24 ชม.
  const res = (await asUser(U.clerkA, () => approve(D1.id))).rows[0].r
  assert.equal(res.ok, true); assert.equal(res.status, 'published')
  const [p] = await rows('id = $1', [D1.id])
  PUBLISHED = p
  assert.equal(p.status, 'published'); assert.equal(p.published_by, U.clerkA)
  assert.equal(Math.round((new Date(p.expires_at) - new Date(p.published_at)) / HOUR), 24, 'ค่าเริ่มต้น 24 ชม.')
  assert.equal(p.body, D1.body, 'ข้อความที่ยืนยัน = ข้อความที่ระบบร่าง ไม่เปลี่ยน')
  // ซ้ำ = จัดการแล้ว
  assert.deepEqual((await asUser(U.mayorA, () => approve(D1.id))).rows[0].r, { ok: false, reason: 'already_handled', status: 'published' })
  assert.deepEqual((await asUser(U.mayorA, () => decline(D1.id))).rows[0].r, { ok: false, reason: 'already_handled', status: 'published' })
  // หน้าประชาชนเห็น
  const open = (await as('anon', null, () => pub(A))).rows[0].r
  assert.deepEqual(Object.keys(open).sort(), ['body', 'expires_at', 'id', 'issuer', 'published_at'])
  assert.equal(open.body, D1.body); assert.equal(open.issuer, 'อบต.ตัวอย่าง ก')
  assert.equal((await as('anon', null, () => pub(B))).rows[0].r, null, 'ประกาศของ ก ไม่ขึ้นที่ ข')
  // audit
  const audit = (await db.query(`SELECT action, actor_id, actor_role, resource_type, resource_id, municipality_id, metadata FROM public.audit_logs ORDER BY created_at`)).rows
  assert.equal(audit.length, 1); assert.equal(audit[0].action, 'approve'); assert.equal(audit[0].actor_id, U.clerkA)
  assert.equal(audit[0].resource_type, 'water_announcement'); assert.equal(audit[0].resource_id, D1.id); assert.equal(audit[0].municipality_id, A)
  assert.equal(audit[0].metadata.hours, 24)
  console.log('✓ ยืนยัน: นายก/ปลัดยืนยันได้ · ค่าเริ่มต้น 24 ชม. · ข้อความไม่เปลี่ยน · ยืนยันซ้ำ/ตัดสินซ้ำไม่ได้ · หน้าประชาชนเห็นเฉพาะ 5 ฟิลด์ · audit_logs มีผู้ยืนยัน')
}

// ── 7) หมดอายุ / ต่ออายุ / ยกเลิก ──
{
  // หน้าประชาชนตัดสินจากเวลา ไม่ต้องรอ cron
  await db.exec(`ALTER TABLE public.water_announcements DISABLE TRIGGER water_announcements_guard_row`)
  await db.exec(`UPDATE public.water_announcements SET published_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' WHERE id = '${PUBLISHED.id}'`)
  await db.exec(`ALTER TABLE public.water_announcements ENABLE TRIGGER water_announcements_guard_row`)
  assert.equal((await as('anon', null, () => pub(A))).rows[0].r, null, 'ครบอายุ = หายจากหน้าประชาชนทันที แม้ cron ยังไม่ทำงาน')
  assert.equal((await rows('id = $1', [PUBLISHED.id]))[0].status, 'published', 'สถานะยังไม่ถูกเก็บกวาด')
  assert.deepEqual((await asUser(U.mayorA, () => cancel(PUBLISHED.id))).rows[0].r.reason, 'not_active', 'ยกเลิกฉบับที่ครบอายุไม่ได้')
  // cron เก็บกวาดสถานะ → expired + ร่างฉบับใหม่ (เหตุการณ์ยังเปิดอยู่และยังเข้าเกณฑ์)
  const r = await tick(nowIso)
  assert.equal(r.drafted, 1, 'ฉบับครบอายุและเหตุการณ์ยังร้อน → ร่างฉบับใหม่ให้ยืนยัน')
  const all = await rows()
  assert.equal(all.find(x => x.id === PUBLISHED.id).status, 'expired')
  assert.ok(all.find(x => x.id === PUBLISHED.id).closed_at, 'expired มี closed_at')
  const D2 = all.find(x => x.status === 'draft')
  assert.ok(D2)
  assert.equal((await as('anon', null, () => pub(A))).rows[0].r, null, 'ร่างฉบับใหม่ไม่ขึ้นหน้าประชาชนจนกว่าจะมีคนยืนยัน')
  // ยืนยันฉบับใหม่ 72 ชม. (สูงสุด)
  const r2 = (await asUser(U.mayorA, () => approve(D2.id, 72))).rows[0].r
  assert.equal(r2.ok, true)
  assert.equal(Math.round((new Date((await rows('id = $1', [D2.id]))[0].expires_at) - new Date((await rows('id = $1', [D2.id]))[0].published_at)) / HOUR), 72)
  // ยกเลิก → หายทันที + audit
  assert.deepEqual((await asUser(U.clerkA, () => cancel(D2.id))).rows[0].r.status, 'cancelled')
  assert.equal((await as('anon', null, () => pub(A))).rows[0].r, null, 'ยกเลิกแล้วหายจากหน้าประชาชนทันที')
  assert.deepEqual((await asUser(U.mayorA, () => cancel(D2.id))).rows[0].r, { ok: false, reason: 'not_active', status: 'cancelled' })
  const actions = (await db.query(`SELECT action FROM public.audit_logs ORDER BY created_at`)).rows.map(x => x.action)
  assert.deepEqual(actions, ['approve', 'approve', 'cancel'])
  console.log('✓ หมดอายุ: หายจากหน้าประชาชนตามเวลาทันที · cron เก็บเป็น expired + ร่างฉบับต่ออายุ · อายุสูงสุด 72 ชม. · ยกเลิกแล้วหายทันที · ตัดสินซ้ำไม่ได้ · audit ครบ')
}

// ── 8) ฉบับใหม่แทนฉบับเดิมที่ยังเผยแพร่อยู่ (ต่ออายุ) ──
{
  await db.exec(`DELETE FROM public.audit_logs`)
  await wipe()
  await resetEvent()
  await tick(nowIso)
  const [d] = await rows()
  await asUser(U.mayorA, () => approve(d.id, 2)) // เหลือ 2 ชม. < 3 ชม. → ควรมีร่างต่ออายุ
  const r = await tick(nowIso)
  assert.equal(r.drafted, 1, 'ฉบับใกล้หมดอายุ (< 3 ชม.) และเหตุการณ์ยังร้อน → ร่างฉบับต่ออายุ')
  const renew = (await rows("status = 'draft'"))[0]
  assert.equal((await asUser(U.mayorA, () => approve(renew.id, 12))).rows[0].r.ok, true)
  const after = await rows()
  assert.equal(after.find(x => x.id === d.id).status, 'superseded', 'ฉบับเดิมถูกแทนที่')
  assert.equal(after.find(x => x.id === d.id).closed_by, U.mayorA)
  assert.equal(after.filter(x => x.status === 'published').length, 1, 'มีฉบับเผยแพร่ได้ทีละฉบับ')
  assert.equal((await as('anon', null, () => pub(A))).rows[0].r.id, renew.id)
  // ฉบับที่ยังเหลือเวลา > 3 ชม. ไม่ร่างซ้อน
  assert.equal((await tick(nowIso)).drafted, 0)
  console.log('✓ ต่ออายุ: เหลือ < 3 ชม. → ร่างฉบับใหม่ · ยืนยัน = ฉบับเดิมถูกแทน (superseded) · เผยแพร่ได้ทีละฉบับ · เหลือเวลามากไม่ร่างซ้อน')
}

// ── 9) ไม่ประกาศ ──
{
  await wipe()
  await db.exec(`DELETE FROM public.audit_logs`)
  await resetEvent()
  await tick(nowIso)
  const [d] = await rows()
  assert.deepEqual((await asUser(U.mayorA, () => decline(d.id))).rows[0].r.status, 'declined')
  const [x] = await rows('id = $1', [d.id])
  assert.equal(x.status, 'declined'); assert.equal(x.closed_by, U.mayorA); assert.ok(x.closed_at)
  assert.equal((await as('anon', null, () => pub(A))).rows[0].r, null)
  assert.equal((await tick(nowIso)).drafted, 0, 'ตัดสินไม่ประกาศแล้ว ไม่ร่างซ้ำเรื่องเดิมใน 12 ชม.')
  assert.equal((await tick(iso(NOW + 13 * HOUR))).drafted, 0, 'ค่าที่วัดเก่าเกิน 3 ชม. ที่เวลานั้น = ไม่ร่าง (ไม่ใช่เพราะเงื่อนไข 12 ชม.)')
  // เติมค่าใหม่ที่ +13 ชม. → ร่างใหม่ได้
  const T13 = NOW + 13 * HOUR
  await db.exec(`UPDATE public.water_events SET last_hot_at = '${iso(T13 - 10 * 60000)}' WHERE id = '${EV1}'`)
  await db.exec(`INSERT INTO public.water_event_readings (event_id, station_type, station_code, station_name, recorded_at, rain_24h_mm) VALUES ('${EV1}', 'rain', 'R1', 'บ้านบุญแจ่ม', '${iso(T13 - 20 * 60000)}', 120)`)
  await db.exec(`UPDATE public.water_announcements SET closed_at = closed_at WHERE false`)
  assert.equal((await tick(iso(T13))).drafted, 1, 'พ้น 12 ชม. และยังเข้าเกณฑ์ → ร่างใหม่')
  assert.equal((await db.query(`SELECT action FROM public.audit_logs`)).rows[0].action, 'reject')
  console.log('✓ ไม่ประกาศ: บันทึกผู้ตัดสิน · ไม่ร่างซ้ำใน 12 ชม. · พ้นช่วงและยังเข้าเกณฑ์จึงร่างใหม่ · audit = reject')
}

// ── 10) ร่างเก่า/เหตุการณ์ปิด ──
{
  await wipe()
  await resetEvent()
  // ร่างเก่า > 3 ชม. → กดยืนยันไม่ได้ + ถูกทิ้ง
  await db.exec(`INSERT INTO public.water_announcements (municipality_id, event_id, status, body, facts, drafted_at)
                 VALUES ('${A}', '${EV1}', 'draft', 'ร่างเก่า', '{}', now() - interval '4 hours')`)
  const [old] = await rows()
  assert.deepEqual((await asUser(U.mayorA, () => approve(old.id))).rows[0].r, { ok: false, reason: 'draft_too_old' })
  assert.equal((await rows('id = $1', [old.id]))[0].status, 'lapsed', 'ร่างเก่าถูกทิ้ง ไม่ถูก rollback')
  assert.equal((await as('anon', null, () => pub(A))).rows[0].r, null)
  // เหตุการณ์ปิดระหว่างรอ → กดยืนยันไม่ได้
  await db.exec(`INSERT INTO public.water_announcements (municipality_id, event_id, status, body, facts, drafted_at)
                 VALUES ('${A}', '${EV1}', 'draft', 'ร่างของเหตุการณ์ที่ปิดแล้ว', '{}', now())`)
  const dr = (await rows("status = 'draft'"))[0]
  await db.exec(`UPDATE public.water_events SET closed_at = now(), ended_at = now(), close_reason = 'calm' WHERE id = '${EV1}'`)
  assert.deepEqual((await asUser(U.mayorA, () => approve(dr.id))).rows[0].r, { ok: false, reason: 'event_closed' })
  assert.equal((await rows('id = $1', [dr.id]))[0].status, 'lapsed')
  // cron: เหตุการณ์ปิดแล้ว → ร่างที่ค้างหมดความหมาย
  await db.exec(`INSERT INTO public.water_announcements (municipality_id, event_id, status, body, facts, drafted_at)
                 VALUES ('${A}', NULL, 'draft', 'ร่างค้าง', '{}', now())`)
  const r = await tick(nowIso)
  assert.equal(r.lapsed, 1); assert.equal((await rows("status = 'draft'")).length, 0)
  console.log('✓ ร่างเก่า > 3 ชม./เหตุการณ์ปิดแล้ว: กดยืนยันไม่ได้และร่างถูกทิ้ง · cron เก็บร่างค้างเมื่อไม่มีเหตุการณ์เปิด')
}

// ── 11) ตัวล็อกข้อมูล ──
{
  await wipe()
  await resetEvent()
  await tick(nowIso)
  const [d] = await rows()
  // แก้ข้อความ/ที่มา/เวลาร่าง/หน่วยงาน — ไม่ได้ (แม้เป็นเจ้าของฐานข้อมูล)
  await fails(db, 'แก้ body', `UPDATE public.water_announcements SET body = 'แก้' WHERE id = '${d.id}'`, /แก้ข้อความหรือที่มา/)
  await fails(db, 'แก้ facts', `UPDATE public.water_announcements SET facts = '{}' WHERE id = '${d.id}'`, /แก้ข้อความหรือที่มา/)
  await fails(db, 'แก้ municipality', `UPDATE public.water_announcements SET municipality_id = '${B}' WHERE id = '${d.id}'`, /แก้ข้อความหรือที่มา/)
  await fails(db, 'แก้ drafted_at', `UPDATE public.water_announcements SET drafted_at = now() WHERE id = '${d.id}'`, /แก้ข้อความหรือที่มา/)
  await fails(db, 'ลบแถว', `DELETE FROM public.water_announcements WHERE id = '${d.id}'`, /ลบประกาศไม่ได้/)
  await fails(db, 'ล้างตาราง', `TRUNCATE public.water_announcements`, /ล้างตารางประกาศไม่ได้/)
  await fails(db, 'ร่าง → ยกเลิก', `UPDATE public.water_announcements SET status = 'cancelled', closed_at = now() WHERE id = '${d.id}'`, /เปลี่ยนสถานะ draft → cancelled ไม่ได้/)
  await fails(db, 'ร่าง → ถูกแทนที่', `UPDATE public.water_announcements SET status = 'superseded', closed_at = now() WHERE id = '${d.id}'`, /เปลี่ยนสถานะ draft → superseded ไม่ได้/)
  // รูปแบบข้อมูล: เผยแพร่ต้องมีเวลา + ไม่เกิน 72 ชม.
  await fails(db, 'เผยแพร่ไม่มีเวลา', `UPDATE public.water_announcements SET status = 'published' WHERE id = '${d.id}'`, /water_announcements_shape/)
  await fails(db, 'เผยแพร่ 73 ชม.', `UPDATE public.water_announcements SET status = 'published', published_at = now(), expires_at = now() + interval '73 hours' WHERE id = '${d.id}'`, /water_announcements_shape/)
  await fails(db, 'หมดอายุก่อนเผยแพร่', `UPDATE public.water_announcements SET status = 'published', published_at = now(), expires_at = now() - interval '1 hour' WHERE id = '${d.id}'`, /water_announcements_shape/)
  // ร่างเดียว/ฉบับเดียวต่อ อปท.
  await fails(db, 'ร่างซ้อน', `INSERT INTO public.water_announcements (municipality_id, status, body, facts) VALUES ('${A}', 'draft', 'x', '{}')`, /water_announcements_one_draft_idx/)
  // เส้นทางปกติผ่าน แล้วฉบับที่ปิดแล้วแก้ไม่ได้
  await asUser(U.mayorA, () => approve(d.id))
  await fails(db, 'ต่ออายุตรงๆ', `UPDATE public.water_announcements SET expires_at = expires_at + interval '1 hour' WHERE id = '${d.id}'`, /แก้เวลาเผยแพร่\/หมดอายุ/)
  await fails(db, 'เปลี่ยนผู้ยืนยัน', `UPDATE public.water_announcements SET published_by = '${U.staffA}' WHERE id = '${d.id}'`, /เปลี่ยนผู้ดำเนินการ/)
  await fails(db, 'เผยแพร่ → ร่าง', `UPDATE public.water_announcements SET status = 'draft', published_at = NULL, expires_at = NULL WHERE id = '${d.id}'`, /เปลี่ยนสถานะ published → draft ไม่ได้/)
  await asUser(U.mayorA, () => cancel(d.id))
  await fails(db, 'ฟื้นฉบับที่ยกเลิก', `UPDATE public.water_announcements SET status = 'published', closed_at = NULL WHERE id = '${d.id}'`, /ประกาศที่ปิดแล้วแก้ไม่ได้/)
  await fails(db, 'เปลี่ยนเวลาปิด', `UPDATE public.water_announcements SET closed_at = now() WHERE id = '${d.id}'`, /ประกาศที่ปิดแล้วแก้ไม่ได้/)
  // FK: ลบเหตุการณ์ → event_id เป็น NULL ได้ ประกาศยังอยู่ · ลบบัญชีผู้ยืนยัน → published_by เป็น NULL ได้
  await db.exec(`DELETE FROM public.water_events WHERE id = '${EV1}'`)
  const orphan = (await rows('id = $1', [d.id]))[0]
  assert.equal(orphan.event_id, null, 'ลบเหตุการณ์ → ประกาศยังอยู่ (event_id เป็น NULL ตาม FK) ไม่ถูกลบตาม')
  assert.equal(orphan.status, 'cancelled', 'สถานะไม่เปลี่ยน')
  console.log('✓ ตัวล็อก: แก้ข้อความ/ที่มา/เวลา/หน่วยงานไม่ได้ · ลบ/ล้างตารางไม่ได้ · เปลี่ยนสถานะผิดเส้นทางไม่ได้ · ต่ออายุตรงๆ ไม่ได้ · ฉบับที่ปิดแล้วฟื้นไม่ได้ · เผยแพร่ ≤ 72 ชม. · ร่าง/ฉบับเผยแพร่ซ้อนไม่ได้')
}

// ── 12) ลบ อปท. ทั้งก้อนยังทำได้ (cascade) ──
{
  await db.exec(`INSERT INTO public.municipalities (id, slug, name) VALUES ('${uuid(9)}', 'zz', 'ทดสอบลบ')`)
  await db.exec(`INSERT INTO public.water_announcement_settings (municipality_id, enabled) VALUES ('${uuid(9)}', true)`)
  await db.exec(`INSERT INTO public.water_announcements (municipality_id, status, body, facts) VALUES ('${uuid(9)}', 'draft', 'x', '{}')`)
  await db.exec(`DELETE FROM public.municipalities WHERE id = '${uuid(9)}'`)
  assert.equal((await rows('municipality_id = $1', [uuid(9)])).length, 0, 'ลบ อปท. แล้วประกาศของ อปท. นั้นถูกลบตาม (ลบแถวตรงๆ ยังห้าม)')
  console.log('✓ ลบ อปท. ทั้งก้อน (FK cascade) ทำได้ — ลบแถวตรงๆ ยังห้าม')
}

// ── 13) หน้าเจ้าหน้าที่อ่าน ──
{
  await wipe()
  await db.exec(`INSERT INTO public.water_events (id, municipality_id, opened_at, last_hot_at, last_fresh_at, open_reason) SELECT '${EV1}', '${A}', now(), now(), now(), '{"rule_version":1,"triggers":[]}' WHERE NOT EXISTS (SELECT 1 FROM public.water_events WHERE id = '${EV1}')`)
  await db.exec(`UPDATE public.water_events SET closed_at = NULL, ended_at = NULL, close_reason = NULL WHERE id = '${EV1}'`)
  await db.exec(`INSERT INTO public.water_announcements (municipality_id, event_id, status, body, facts, drafted_at) VALUES ('${A}', '${EV1}', 'draft', 'ร่างรอยืนยัน', '{"secret":"ภายใน"}', now())`)
  await db.exec(`INSERT INTO public.water_announcements (municipality_id, event_id, status, body, facts, drafted_at, published_at, expires_at)
                 VALUES ('${A}', '${EV1}', 'published', 'ฉบับที่ใช้อยู่', '{}', now() - interval '1 hour', now() - interval '1 hour', now() + interval '23 hours')`)
  for (const [who, uid] of [['staff', U.staffA], ['admin', U.adminA], ['officer(deptHead)', U.deptHeadA], ['mayor', U.mayorA], ['superadmin', U.superadmin]]) {
    const r = (await asUser(uid, () => list(A))).rows[0].r
    assert.equal(r.pending.body, 'ร่างรอยืนยัน', `${who} เห็นร่าง`)
    assert.equal(r.current.body, 'ฉบับที่ใช้อยู่')
    assert.equal(r.enabled, true)
    assert.equal(r.can_approve, uid === U.mayorA, `${who}: can_approve`)
    assert.ok(!JSON.stringify(r).includes('ภายใน'), 'ไม่ส่ง facts')
    assert.deepEqual(Object.keys(r.history[0]).sort(), ['body', 'closed_at', 'drafted_at', 'expires_at', 'id', 'published_at', 'status'])
  }
  for (const [who, uid] of [['citizen', U.citizenA], ['technician', U.technicianA], ['council', U.councilA], ['staff ต่าง อปท.', U.mayorB], ['ไม่ล็อกอิน', null]]) {
    await asUser(uid, () => fails(db, `${who} list`, 'SELECT public.list_water_announcements($1) AS r', /ไม่มีสิทธิ์ดูประกาศน้ำ-ฝน|permission denied/, [A]))
  }
  await as('anon', null, () => fails(db, 'anon list', 'SELECT public.list_water_announcements($1) AS r', /permission denied/, [A]))
  const lim = (await asUser(U.staffA, () => list(A, 1))).rows[0].r
  assert.equal(lim.history.length, 1)
  assert.equal(lim.history[0].status, 'draft', 'ใหม่ → เก่า')
  const lim2 = (await asUser(U.staffA, () => list(A, 9999))).rows[0].r
  assert.ok(lim2.history.length <= 100)
  console.log('✓ หน้าเจ้าหน้าที่อ่าน: admin/officer/staff + superadmin เห็น · ช่าง/สภา/ประชาชน/ต่าง อปท./ไม่ล็อกอิน/anon ไม่เห็น · can_approve ตรงกับผู้ยืนยันจริง · ไม่ส่ง facts · เรียงใหม่→เก่า · limit ครอบ 100')
}

// ── 14) หน้าประชาชน: สวิตช์ปิด/อปท.ปิด = หายทันที ──
{
  assert.ok((await as('anon', null, () => pub(A))).rows[0].r, 'ฉบับที่ใช้อยู่ขึ้นหน้าประชาชน')
  await db.exec(`UPDATE public.water_announcement_settings SET enabled = false WHERE municipality_id = '${A}'`)
  assert.equal((await as('anon', null, () => pub(A))).rows[0].r, null, 'ปิดสวิตช์ = หายทันที')
  await db.exec(`UPDATE public.water_announcement_settings SET enabled = true WHERE municipality_id = '${A}'`)
  await db.exec(`UPDATE public.municipalities SET is_active = false WHERE id = '${A}'`)
  assert.equal((await as('anon', null, () => pub(A))).rows[0].r, null, 'อปท. ถูกปิดใช้งาน = ไม่ขึ้น')
  await db.exec(`UPDATE public.municipalities SET is_active = true WHERE id = '${A}'`)
  assert.equal((await as('anon', null, () => pub(null))).rows[0].r, null)
  assert.equal((await as('anon', null, () => pub(uuid(777)))).rows[0].r, null)
  console.log('✓ หน้าประชาชน: ปิดสวิตช์/ปิด อปท./id ว่าง/id ไม่มี = ไม่ขึ้นอะไรเลย')
}

// ── 15) เวลาไทย ──
{
  const t = (await db.query(`SELECT public.water_announcement_thai_time('2026-10-19T07:20:00Z'::timestamptz) AS s`)).rows[0].s
  assert.equal(t, '19 ต.ค. 2569 เวลา 14:20 น.')
  const nye = (await db.query(`SELECT public.water_announcement_thai_time('2026-12-31T17:30:00Z'::timestamptz) AS s`)).rows[0].s
  assert.equal(nye, '1 ม.ค. 2570 เวลา 00:30 น.', 'ข้ามปีตามเวลาไทย')
  assert.equal((await db.query(`SELECT public.water_announcement_thai_time(NULL) AS s`)).rows[0].s, null)
  console.log('✓ เวลา: UTC → ไทย พ.ศ. ถูกต้อง รวมข้ามปี')
}

console.log('\n✅ water-announcements-db: ผ่านทุกข้อ')
