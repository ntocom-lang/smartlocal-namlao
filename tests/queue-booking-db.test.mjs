// จองคิวรับบริการ (ขั้น 1D · E2) — รัน migration จริงใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/queue-booking-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   ไฟล์ที่รัน: 20261210100000 (ตาราง) → 20261210100100 (RLS/RPC) → 20261215100000 (ปิดจองวันหยุดราชการ)
//   ⚠️ PGlite มี connection เดียว ทดสอบการแย่งจองพร้อมกันจริงไม่ได้ — ด่านนั้นคือ SELECT … FOR UPDATE ในฟังก์ชัน
//   วันที่ในเทสต์ใช้ "พรุ่งนี้เป็นต้นไป" เสมอ กันล้มตามเวลาของวัน (บทเรียน #538/#629)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// CI (patient-module-tests.yml) ส่งผ่าน PATIENT_PGLITE_MODULE · ในเครื่องส่ง --pglite <path>
const modulePath = process.argv.includes('--pglite') ? process.argv[process.argv.indexOf('--pglite') + 1] : process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'Supply --pglite <local module path> หรือตั้ง PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)

const readMigration = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const tablesSql = await readMigration('20261210100000_queue_booking_tables.sql')
const rlsSql = await readMigration('20261210100100_queue_booking_rls_rpc.sql')
const holidaySql = await readMigration('20261215100000_queue_booking_holidays.sql')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = id(1), B = id(2), OFF = id(3)
const D1 = id(11), D2 = id(12), DB = id(13)
const U = {
  citizen: id(101), citizen2: id(102), citizen3: id(103), citizenB: id(104),
  staff: id(105), staffOther: id(106), viewer: id(107), admin: id(108), adminB: id(109), super1: id(110), offCitizen: id(111),
}
const P = {
  citizen:    ['citizen', A, null, 'นาย ก', '081-234-5678'],
  citizen2:   ['citizen', A, null, 'นาง ข', null],
  citizen3:   ['citizen', A, null, 'น.ส. ค', '12'],
  citizenB:   ['citizen', B, null, 'นาย ง', null],
  staff:      ['staff', A, D1, 'จนท. กอง 1', null],
  staffOther: ['staff', A, D2, 'จนท. กอง 2', null],
  viewer:     ['viewer', A, null, 'นายก', null],
  admin:      ['admin', A, null, 'แอดมิน A', null],
  adminB:     ['admin', B, null, 'แอดมิน B', null],
  super1:     ['superadmin', null, null, 'Super', null],
  offCitizen: ['citizen', OFF, null, 'ปิดโมดูล', null],
}

const db = new PGlite()
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.municipalities (id uuid PRIMARY KEY, slug text UNIQUE, enabled_modules text[]);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid REFERENCES public.municipalities(id));
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), role text NOT NULL DEFAULT 'citizen',
  municipality_id uuid, department_id uuid, full_name text, phone text);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_department_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT department_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_my_department(p_municipality_id uuid, p_department_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT p_department_id IS NOT NULL AND p_municipality_id = public.get_my_municipality_id() AND p_department_id = public.get_my_department_id() $$;
CREATE FUNCTION public.department_belongs_to_municipality(p_department_id uuid, p_municipality_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT p_department_id IS NULL OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = p_department_id AND d.municipality_id = p_municipality_id) $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.get_my_department_id(),
  public.is_my_department(uuid, uuid), public.department_belongs_to_municipality(uuid, uuid) TO authenticated;
-- โครงเดียวกับ 20260831100000_public_holidays.sql (เฉพาะคอลัมน์ที่ฟังก์ชันใช้)
CREATE TABLE public.public_holidays (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid REFERENCES public.municipalities(id),
  holiday_date date NOT NULL, name text NOT NULL, is_working_day boolean NOT NULL DEFAULT false);
INSERT INTO public.municipalities VALUES ('${A}', 'demo', ARRAY['complaints']), ('${B}', 'other', NULL), ('${OFF}', 'off', ARRAY['complaints']);
INSERT INTO public.departments VALUES ('${D1}', '${A}'), ('${D2}', '${A}'), ('${DB}', '${B}');
`)
for (const [alias, [role, muni, dept, name, phone]] of Object.entries(P)) {
  await db.query('INSERT INTO auth.users VALUES ($1)', [U[alias]])
  await db.query('INSERT INTO public.profiles VALUES ($1,$2,$3,$4,$5,$6)', [U[alias], role, muni, dept, name, phone])
}

const actor = async alias => {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias && alias !== 'anon' ? U[alias] : ''])
  await db.exec(`SET ROLE ${alias && alias !== 'anon' ? 'authenticated' : 'anon'}`)
}
const asRoot = async () => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', '', false)") }
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const rejects = (promise, expect = {}) => assert.rejects(promise, error => {
  if (expect.code) assert.equal(error.code, expect.code, `รหัสผิด: ${error.code} / ${error.message}`)
  if (expect.message) assert.match(error.message, expect.message)
  return true
})
const DENIED = { code: '42501' }
let cases = 0
const test = async (label, run) => { await asRoot(); await run(); await asRoot(); cases++; console.log('PASS ' + label) }

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
const shift = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
const isoDow = d => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w }
const day1 = shift(1), day2 = shift(2), day3 = shift(3)
const book = (svc, date, time, phone = null, note = null) =>
  db.query('SELECT public.book_queue_slot($1, $2::date, $3::time, $4, $5) AS r', [svc, date, time, phone, note]).then(r => r.rows[0].r)

// ── migration ─────────────────────────────────────────────────────────────────────
await test('migration ไฟล์ 2 ปฏิเสธถ้ายังไม่รันไฟล์ 1', async () => {
  await rejects(db.exec(rlsSql), { message: /20261210100000/ })
  await db.exec('ROLLBACK') // ไฟล์เปิด BEGIN เอง — ด่านโยน error แล้วธุรกรรมค้าง
})
await test('ไฟล์วันหยุดปฏิเสธถ้ายังไม่รันไฟล์จองคิว', async () => {
  await rejects(db.exec(holidaySql), { message: /20261210100100/ })
  await db.exec('ROLLBACK')
})
await db.exec(tablesSql)
await db.exec(rlsSql)
await db.exec(holidaySql) // เทสต์ทุกข้อด้านล่างรันกับฟังก์ชันฉบับวันหยุด (ของเดิมต้องไม่พัง)
await test('รันทั้ง 3 ไฟล์ผ่าน + ด่านตรวจท้ายไฟล์ผ่าน + รันซ้ำได้', async () => {
  await db.exec(rlsSql)
  await db.exec(holidaySql)
})
await test('เปิดโมดูลให้ demo เท่านั้น (แถว NULL = เปิดทุกโมดูลอยู่แล้ว ไม่แตะ · off ไม่ถูกเปิด)', async () => {
  const r = await rows('SELECT slug, enabled_modules FROM public.municipalities ORDER BY slug')
  assert.deepEqual(r.map(x => [x.slug, x.enabled_modules]), [['demo', ['complaints', 'queue-booking']], ['off', ['complaints']], ['other', null]])
})

// ── ตั้งค่าบริการ ───────────────────────────────────────────────────────────────────
let SVC, SVC_CLOSED, SVC_NODEPT, SVC_B, SVC_OFF
await test('แอดมินสร้างบริการของ อปท. ตัวเองได้ + created_by ตั้งเอง', async () => {
  await actor('admin')
  SVC = (await rows(`INSERT INTO public.queue_services (municipality_id, department_id, name, open_weekdays, start_time, end_time, slot_minutes, per_slot_quota, book_ahead_days)
    VALUES ($1, $2, 'ขึ้นทะเบียน', '{1,2,3,4,5,6,7}', '09:00', '11:00', 30, 2, 14) RETURNING id, created_by`, [A, D1]))[0]
  assert.equal(SVC.created_by, U.admin)
  SVC = SVC.id
  SVC_CLOSED = (await rows(`INSERT INTO public.queue_services (municipality_id, department_id, name, open_weekdays, is_active)
    VALUES ($1, $2, 'ปิดอยู่', '{1,2,3,4,5,6,7}', false) RETURNING id`, [A, D1]))[0].id
  SVC_NODEPT = (await rows(`INSERT INTO public.queue_services (municipality_id, name, open_weekdays)
    VALUES ($1, 'ไม่มีกอง', $2::smallint[]) RETURNING id`, [A, `{${isoDow(day1)}}`]))[0].id
})
await test('แอดมินสร้างบริการให้ อปท. อื่น / ใส่กองของ อปท. อื่น ไม่ได้', async () => {
  await actor('admin')
  await rejects(db.query(`INSERT INTO public.queue_services (municipality_id, name) VALUES ($1, 'x')`, [B]), DENIED)
  await rejects(db.query(`INSERT INTO public.queue_services (municipality_id, department_id, name) VALUES ($1, $2, 'x')`, [A, DB]), DENIED)
  await rejects(db.query(`INSERT INTO public.queue_services (municipality_id, name, created_by) VALUES ($1, 'x', $2)`, [A, U.citizen]), DENIED)
  await actor('adminB')
  SVC_B = (await rows(`INSERT INTO public.queue_services (municipality_id, name, open_weekdays) VALUES ($1, 'ของ B', '{1,2,3,4,5,6,7}') RETURNING id`, [B]))[0].id
  await asRoot()
  SVC_OFF = (await rows(`INSERT INTO public.queue_services (municipality_id, name, open_weekdays) VALUES ($1, 'ปิดโมดูล', '{1,2,3,4,5,6,7}') RETURNING id`, [OFF]))[0].id
})
await test('ประชาชน/เจ้าหน้าที่ สร้าง-แก้บริการไม่ได้ · แอดมินย้าย อปท. ไม่ได้ · แอดมินลบไม่ได้ (ใช้ปิดแทน)', async () => {
  for (const who of ['citizen', 'staff']) {
    await actor(who)
    await rejects(db.query(`INSERT INTO public.queue_services (municipality_id, name) VALUES ($1, 'x')`, [A]), DENIED)
    assert.equal((await db.query(`UPDATE public.queue_services SET per_slot_quota = 99 WHERE id = $1`, [SVC])).affectedRows, 0)
  }
  await actor('admin')
  await rejects(db.query(`UPDATE public.queue_services SET municipality_id = $1 WHERE id = $2`, [B, SVC]), DENIED)
  assert.equal((await db.query(`DELETE FROM public.queue_services WHERE id = $1`, [SVC_NODEPT])).affectedRows, 0)
  assert.equal((await db.query(`UPDATE public.queue_services SET location = 'ชั้น 1' WHERE id = $1`, [SVC])).affectedRows, 1)
})
await test('ประชาชนเห็นเฉพาะบริการที่เปิดของ อปท. ตัวเอง · เจ้าหน้าที่เห็นที่ปิดด้วย · anon ไม่เห็นอะไร', async () => {
  await actor('citizen')
  assert.deepEqual((await rows('SELECT name FROM public.queue_services ORDER BY name')).map(r => r.name), ['ขึ้นทะเบียน', 'ไม่มีกอง'])
  await actor('staffOther')
  assert.equal((await rows('SELECT 1 FROM public.queue_services')).length, 3)
  await actor('citizenB')
  assert.deepEqual((await rows('SELECT name FROM public.queue_services')).map(r => r.name), ['ของ B'])
  await actor('anon')
  await rejects(db.query('SELECT 1 FROM public.queue_services'), DENIED)
})

// ── ช่องว่าง + จอง ──────────────────────────────────────────────────────────────────
await test('ช่องว่างของวัน: 4 ช่อง (09:00–11:00 ช่องละ 30 นาที) ไม่มีชื่อผู้จอง', async () => {
  await actor('citizen')
  const r = await rows('SELECT * FROM public.queue_slot_availability($1, $2::date)', [SVC, day1])
  assert.deepEqual(r.map(x => x.slot_time), ['09:00:00', '09:30:00', '10:00:00', '10:30:00'])
  assert.ok(r.every(x => x.quota === 2 && x.taken === 0 && x.bookable === true))
  assert.deepEqual(Object.keys(r[0]).sort(), ['bookable', 'quota', 'slot_time', 'taken'])
})
let BK1
await test('จองได้ + เลขคิวเรียง + เก็บชื่อ/เบอร์จากโปรไฟล์ (ตัดขีด)', async () => {
  await actor('citizen')
  BK1 = await book(SVC, day1, '09:00', null, '  ขอแบบฟอร์ม  ')
  assert.equal(BK1.queue_no, 1)
  const mine = await rows('SELECT citizen_name, contact_phone, note, status FROM public.queue_bookings WHERE id = $1', [BK1.id])
  assert.deepEqual(mine[0], { citizen_name: 'นาย ก', contact_phone: '0812345678', note: 'ขอแบบฟอร์ม', status: 'booked' })
  await actor('citizen2')
  const b2 = await book(SVC, day1, '09:00', '089 999 9999')
  assert.equal(b2.queue_no, 2)
  await actor('citizen3') // เบอร์ในโปรไฟล์ผิดรูปแบบ → เก็บว่าง ไม่ทำให้จองล้ม
  const b3 = await book(SVC, day1, '09:30')
  assert.equal(b3.queue_no, 3)
  assert.equal((await rows('SELECT contact_phone FROM public.queue_bookings WHERE id = $1', [b3.id]))[0].contact_phone, null)
})
await test('ช่องเต็มตามโควตา → จองไม่ได้ · ช่องว่างแสดง taken/bookable ถูก', async () => {
  await actor('citizen3')
  await rejects(book(SVC, day2, '09:00', '12345'), { code: '22023', message: /เบอร์โทร/ })
  await actor('citizenB')
  await rejects(book(SVC, day1, '09:00'), { code: 'P0002' }) // คนละ อปท.
  await asRoot()
  await db.query(`UPDATE public.profiles SET municipality_id = $1 WHERE id = $2`, [A, U.citizenB])
  await actor('citizenB')
  await rejects(book(SVC, day1, '09:00'), { message: /เต็มแล้ว/ })
  const r = await rows('SELECT * FROM public.queue_slot_availability($1, $2::date)', [SVC, day1])
  assert.equal(r[0].taken, 2); assert.equal(r[0].bookable, false); assert.equal(r[1].taken, 1); assert.equal(r[1].bookable, true)
  await asRoot()
  await db.query(`UPDATE public.profiles SET municipality_id = $1 WHERE id = $2`, [B, U.citizenB])
})
await test('จองซ้ำบริการเดิมวันเดิมไม่ได้ · วันอื่นได้', async () => {
  await actor('citizen')
  await rejects(book(SVC, day1, '10:00'), { code: '23505' })
  assert.equal((await book(SVC, day2, '10:00')).queue_no, 1)
})
await test('เวลาไม่ตรงตาราง / เกินช่วงล่วงหน้า / วันที่ผ่านมา / วันที่ไม่เปิด / บริการปิด / โมดูลปิด → ไม่ได้', async () => {
  await actor('citizen2')
  await rejects(book(SVC, day3, '09:15'), { code: '22023' })
  await rejects(book(SVC, day3, '11:00'), { code: '22023' })
  await rejects(book(SVC, day3, '08:30'), { code: '22023' })
  await rejects(book(SVC, day3, '09:00:00.4'), { code: '22023' }) // เศษวินาทีต้องไม่ถูกปัดจนหลุดด่าน (reviewer F1)
  await rejects(book(SVC, shift(15), '09:00'), { message: /ล่วงหน้า/ })
  await rejects(book(SVC, shift(-1), '09:00'), { message: /ล่วงหน้า/ })
  await rejects(book(SVC_NODEPT, day2, '09:00'), { message: /ไม่เปิดในวันที่เลือก/ })
  await rejects(book(SVC_CLOSED, day1, '09:00'), { message: /ปิดรับจอง/ })
  assert.ok((await rows('SELECT * FROM public.queue_slot_availability($1, $2::date)', [SVC_CLOSED, day1])).every(x => !x.bookable))
  await actor('offCitizen')
  await rejects(book(SVC_OFF, day1, '09:00'), { message: /ปิดรับจอง/ })
})
await test('ผู้ใช้ไม่มีสังกัด ดูช่องว่างของบริการ อปท. ใดไม่ได้ (reviewer S1)', async () => {
  await asRoot()
  await db.query('INSERT INTO auth.users VALUES ($1)', [id(120)])
  await db.query(`INSERT INTO public.profiles (id, role) VALUES ($1, 'citizen')`, [id(120)])
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id(120)])
  await db.exec('SET ROLE authenticated')
  await rejects(db.query('SELECT * FROM public.queue_slot_availability($1, $2::date)', [SVC, day1]), { code: 'P0002' })
  await rejects(book(SVC, day1, '10:00'), { code: 'P0002' })
})
await test('anon เรียก RPC ไม่ได้เลย', async () => {
  await actor('anon')
  await rejects(book(SVC, day1, '10:00'), DENIED)
  await rejects(db.query('SELECT * FROM public.queue_slot_availability($1, $2::date)', [SVC, day1]), DENIED)
  await rejects(db.query('SELECT public.mark_queue_booking($1, $2)', [BK1.id, 'arrived']), DENIED)
})
await test('คิวรอรับบริการได้ไม่เกิน 5 คิวต่อคน', async () => {
  await asRoot()
  const extra = []
  for (let i = 0; i < 4; i++) {
    extra.push((await rows(`INSERT INTO public.queue_services (municipality_id, name, open_weekdays) VALUES ($1, $2, '{1,2,3,4,5,6,7}') RETURNING id`, [A, 'เสริม' + i]))[0].id)
  }
  await actor('citizen') // มีอยู่แล้ว 2 คิว (day1, day2)
  await book(extra[0], day1, '09:00'); await book(extra[1], day1, '09:00'); await book(extra[2], day1, '09:00')
  await rejects(book(extra[3], day1, '09:00'), { message: /5 คิว/ })
  await asRoot()
  await db.query('DELETE FROM public.queue_bookings WHERE service_id = ANY($1::uuid[])', [extra])
  await db.query('DELETE FROM public.queue_services WHERE id = ANY($1::uuid[])', [extra])
})

// ── ใครเห็นคิว ──────────────────────────────────────────────────────────────────────
await test('ประชาชนเห็นเฉพาะของตัวเอง · เจ้าหน้าที่กองที่ถือเรื่องเห็น · กองอื่น/ผู้บริหาร/อปท.อื่น ไม่เห็น · แอดมินเห็นทั้งหมด', async () => {
  const count = async who => { await actor(who); return (await rows('SELECT 1 FROM public.queue_bookings')).length }
  assert.equal(await count('citizen'), 2)
  assert.equal(await count('citizen2'), 1)
  assert.equal(await count('staff'), 4)
  assert.equal(await count('staffOther'), 0)
  assert.equal(await count('viewer'), 0)
  assert.equal(await count('adminB'), 0)
  assert.equal(await count('admin'), 4)
  assert.equal(await count('super1'), 4)
})
await test('เขียนตาราง queue_bookings ตรงไม่ได้ (ต้องผ่าน RPC)', async () => {
  await actor('citizen')
  await rejects(db.query(`UPDATE public.queue_bookings SET status = 'arrived' WHERE id = $1`, [BK1.id]), DENIED)
  await rejects(db.query(`INSERT INTO public.queue_bookings (municipality_id, service_id, citizen_id, citizen_name, booking_date, slot_time, queue_no)
    VALUES ($1, $2, $3, 'x', $4, '09:00', 99)`, [A, SVC, U.citizen, day3]), DENIED)
  await actor('admin')
  await rejects(db.query(`UPDATE public.queue_bookings SET status = 'arrived' WHERE id = $1`, [BK1.id]), DENIED)
  assert.equal((await db.query('DELETE FROM public.queue_bookings WHERE id = $1', [BK1.id])).affectedRows, 0)
})

// ── ยกเลิก ──────────────────────────────────────────────────────────────────────────
await test('ยกเลิกของตัวเองได้ → ช่องว่างคืน · ยกเลิกของคนอื่นไม่ได้ · ยกเลิกซ้ำไม่ได้ · จองใหม่ได้เลขคิวใหม่', async () => {
  await actor('citizen2')
  await rejects(db.query('SELECT public.cancel_queue_booking($1)', [BK1.id]), { message: /ยกเลิกคิวนี้ไม่ได้/ })
  await actor('citizen')
  await db.query('SELECT public.cancel_queue_booking($1)', [BK1.id])
  await rejects(db.query('SELECT public.cancel_queue_booking($1)', [BK1.id]), { message: /ยกเลิกคิวนี้ไม่ได้/ })
  const r = await rows('SELECT taken FROM public.queue_slot_availability($1, $2::date) WHERE slot_time = $3', [SVC, day1, '09:00'])
  assert.equal(r[0].taken, 1)
  assert.equal((await book(SVC, day1, '10:30')).queue_no, 4)
})

// ── เจ้าหน้าที่บันทึกมา/ไม่มา ──────────────────────────────────────────────────────────────
await test('มาแล้ว/ไม่มา: ก่อนวันนัดไม่ได้ · กองอื่น/ประชาชน/ผู้บริหารไม่ได้ · วันนี้ได้ + ย้อนได้ · ยกเลิกแล้วไม่ได้', async () => {
  await asRoot()
  const todayBk = (await rows(`INSERT INTO public.queue_bookings (municipality_id, service_id, citizen_id, citizen_name, booking_date, slot_time, queue_no)
    VALUES ($1, $2, $3, 'นาง ข', $4, '09:00', 1) RETURNING id`, [A, SVC, U.citizen2, today]))[0].id
  await actor('staff')
  const future = (await rows(`SELECT id FROM public.queue_bookings WHERE booking_date = $1 AND status = 'booked' LIMIT 1`, [day1]))[0].id
  await rejects(db.query('SELECT public.mark_queue_booking($1, $2)', [future, 'arrived']), { message: /ยังไม่ถึงวันนัด/ })
  await rejects(db.query('SELECT public.mark_queue_booking($1, $2)', [todayBk, 'done']), { code: '22023' })
  for (const who of ['staffOther', 'citizen2', 'viewer', 'adminB']) {
    await actor(who)
    await rejects(db.query('SELECT public.mark_queue_booking($1, $2)', [todayBk, 'arrived']), DENIED)
  }
  await actor('staff')
  await db.query('SELECT public.mark_queue_booking($1, $2)', [todayBk, 'arrived'])
  let r = (await rows('SELECT status, checked_by FROM public.queue_bookings WHERE id = $1', [todayBk]))[0]
  assert.deepEqual(r, { status: 'arrived', checked_by: U.staff })
  await actor('citizen2')
  await rejects(db.query('SELECT public.cancel_queue_booking($1)', [todayBk]), { message: /ยกเลิกคิวนี้ไม่ได้/ })
  await actor('admin')
  await db.query('SELECT public.mark_queue_booking($1, $2)', [todayBk, 'booked'])
  r = (await rows('SELECT status, checked_by, checked_at FROM public.queue_bookings WHERE id = $1', [todayBk]))[0]
  assert.deepEqual(r, { status: 'booked', checked_by: null, checked_at: null })
  await db.query('SELECT public.mark_queue_booking($1, $2)', [todayBk, 'no_show'])
  await actor('staff')
  await rejects(db.query('SELECT public.mark_queue_booking($1, $2)', [BK1.id, 'arrived']), { message: /ยกเลิกแล้ว/ })
})
await test('บริการไม่มีกอง: แอดมินเห็นคิว เจ้าหน้าที่ไม่เห็น (ตั้งใจ — หน้าแอดมินเตือนให้เลือกกอง)', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.queue_bookings (municipality_id, service_id, citizen_id, citizen_name, booking_date, slot_time, queue_no)
    VALUES ($1, $2, $3, 'x', $4, '09:00', 1)`, [A, SVC_NODEPT, U.citizen3, day1])
  await actor('staff')
  assert.equal((await rows('SELECT 1 FROM public.queue_bookings WHERE service_id = $1', [SVC_NODEPT])).length, 0)
  await actor('admin')
  assert.equal((await rows('SELECT 1 FROM public.queue_bookings WHERE service_id = $1', [SVC_NODEPT])).length, 1)
})
await test('แก้ตารางเวลาตอนมีคิวค้างที่หลุดตารางใหม่ไม่ได้ · แก้ที่ไม่กระทบคิว/แก้ชื่อได้ (reviewer S4)', async () => {
  await actor('admin')
  await rejects(db.query(`UPDATE public.queue_services SET slot_minutes = 45 WHERE id = $1`, [SVC]), { message: /ไม่ตรงกับตารางเวลาใหม่/ })
  await rejects(db.query(`UPDATE public.queue_services SET start_time = '09:30' WHERE id = $1`, [SVC]), { message: /ไม่ตรงกับตารางเวลาใหม่/ })
  await rejects(db.query(`UPDATE public.queue_services SET open_weekdays = $2::smallint[] WHERE id = $1`, [SVC, `{${isoDow(shift(5))}}`]), { message: /ไม่ตรงกับตารางเวลาใหม่/ })
  assert.equal((await db.query(`UPDATE public.queue_services SET end_time = '12:00', name = 'ขึ้นทะเบียน (ใหม่)' WHERE id = $1`, [SVC])).affectedRows, 1)
  assert.equal((await rows('SELECT count(*)::int AS n FROM public.queue_slot_availability($1, $2::date)', [SVC, day1]))[0].n, 6)
})
await test('ลบบัญชีแอดมินผู้สร้าง/ผู้บันทึกได้ ไม่ติด FK (reviewer F2 — created_by/checked_by เป็นรอยตรวจสอบ)', async () => {
  await asRoot()
  await db.query('DELETE FROM public.profiles WHERE id = $1', [U.admin])
  await db.query('DELETE FROM auth.users WHERE id = $1', [U.admin])
  assert.equal((await rows('SELECT created_by FROM public.queue_services WHERE id = $1', [SVC]))[0].created_by, U.admin)
})
await test('superadmin ลบบริการได้ (ลบคิวตาม)', async () => {
  await actor('super1')
  assert.equal((await db.query('DELETE FROM public.queue_services WHERE id = $1', [SVC_NODEPT])).affectedRows, 1)
  await asRoot()
  assert.equal((await rows('SELECT 1 FROM public.queue_bookings WHERE service_id = $1', [SVC_NODEPT])).length, 0)
})

// ── วันหยุดราชการ (20261215100000) ───────────────────────────────────────────────────────
// ใช้บริการใหม่ที่เปิดทุกวัน + วันที่ห่างจากเทสต์ด้านบน (วันที่ 6–8) กันชนกับคิวเดิม
let SVC_H
const hol1 = shift(6), hol2 = shift(7)
await test('วันหยุดทั่วประเทศ: ช่องว่างปิดทั้งวัน + จองไม่ได้ (ทั้ง A และ B) · วันถัดไปจองได้ตามปกติ', async () => {
  await asRoot()
  SVC_H = (await rows(`INSERT INTO public.queue_services (municipality_id, department_id, name, open_weekdays, per_slot_quota, book_ahead_days)
    VALUES ($1, $2, 'วันหยุด', '{1,2,3,4,5,6,7}', 5, 14) RETURNING id`, [A, D1]))[0].id
  await db.query(`INSERT INTO public.public_holidays (municipality_id, holiday_date, name) VALUES (NULL, $1, 'วันหยุดทดสอบ')`, [hol1])
  await actor('citizen3')
  assert.ok((await rows('SELECT * FROM public.queue_slot_availability($1, $2::date)', [SVC_H, hol1])).every(x => !x.bookable))
  await rejects(book(SVC_H, hol1, '09:00'), { code: 'P0001', message: /วันหยุดราชการ/ })
  assert.equal((await book(SVC_H, shift(8), '09:00')).queue_no, 1)
  await actor('citizenB')
  assert.ok((await rows('SELECT * FROM public.queue_slot_availability($1, $2::date)', [SVC_B, hol1])).every(x => !x.bookable))
  await rejects(book(SVC_B, hol1, '09:00'), { message: /วันหยุดราชการ/ })
})
await test('A ยกเลิกวันหยุด (is_working_day) → A จองได้ · B ยังปิด (แถวของ อปท. ไม่ลาม)', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.public_holidays (municipality_id, holiday_date, name, is_working_day) VALUES ($1, $2, 'มาทำงาน', true)`, [A, hol1])
  await actor('citizen3')
  assert.ok((await rows('SELECT * FROM public.queue_slot_availability($1, $2::date)', [SVC_H, hol1])).every(x => x.bookable))
  assert.equal((await book(SVC_H, hol1, '09:00')).queue_no, 1)
  await actor('citizenB')
  await rejects(book(SVC_B, hol1, '09:00'), { message: /วันหยุดราชการ/ })
})
await test('วันหยุดเฉพาะ A → A ปิด · B จองได้', async () => {
  await asRoot()
  await db.query(`INSERT INTO public.public_holidays (municipality_id, holiday_date, name) VALUES ($1, $2, 'ประเพณีท้องถิ่น')`, [A, hol2])
  await actor('citizen3')
  await rejects(book(SVC_H, hol2, '09:00'), { message: /วันหยุดราชการ/ })
  await actor('citizenB')
  assert.equal((await book(SVC_B, hol2, '09:00')).queue_no, 1)
})
await test('queue_is_holiday เรียกตรงไม่ได้ (ทั้ง authenticated และ anon)', async () => {
  for (const who of ['citizen3', 'anon']) {
    await actor(who)
    await rejects(db.query('SELECT public.queue_is_holiday($1::date, $2)', [hol1, A]), DENIED)
  }
})

console.log(`\nqueue-booking-db: ผ่าน ${cases} กรณี`)
