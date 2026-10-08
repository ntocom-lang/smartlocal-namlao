// PGlite only. No .env, project client, real accounts or network access.
// เลขไมล์เหมาเป็นวัน (20261008100000/100100/100200) — เจ้าของระบบสั่ง 2569-10-08:
// ออกรถใช้เลขล่าสุดเอง วันหนึ่งกี่รอบก็ได้ ใส่เลขไมล์ครั้งเดียวตอนรถกลับถึงกองทุนสิ้นวัน
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, id } = await import('./patient-booking-db.test.mjs')
const read = f => readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const before = ['20260927190000_patient_booking_move_into_trip.sql','20260928120000_patient_booking_multiwave.sql',
 '20260929100000_patient_booking_update_pickup.sql','20260929110000_patient_booking_change_hospital.sql',
 '20260926125325_patient_booking_staff_work_badge.sql','20260929130000_patient_booking_driver_cover.sql',
 '20260930110000_patient_booking_duplicate_shared_trip.sql','20261001100000_patient_booking_history.sql',
 '20261002090000_patient_booking_period_report.sql','20261002130000_patient_booking_letter_per_booking_columns.sql',
 '20261002130100_patient_booking_letter_per_booking_rpc.sql','20261003120000_patient_booking_community_rules_rpc.sql',
 '20261003130000_patient_booking_community_constraints_retention.sql','20261003130100_patient_booking_community_scheduler_rpc.sql',
 '20261003130200_patient_booking_community_projections_rpc.sql','20261003130300_patient_booking_community_reports_rpc.sql',
 '20261003130400_patient_booking_community_intake_rpc.sql','20261003150000_patient_booking_service_views_v2.sql',
 '20261003150100_patient_booking_legacy_client_gate.sql','20261007150000_patient_booking_destination_zone.sql',
 '20261007170000_patient_booking_other_place.sql']
const TABLE = '20261008100000_patient_booking_day_odometer_table.sql'
const BACKFILL = '20261008100100_patient_booking_day_odometer_backfill.sql'
const RPC = '20261008100200_patient_booking_day_odometer_rpc.sql'
const REPLACED = ['public.patient_booking_save_odometer(uuid,uuid,integer,integer,integer,boolean,text)', 'public.patient_booking_staff_work_badge(uuid)']
let checks = 0
const check = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const fails = async (job, pattern) => { await assert.rejects(job, pattern); checks++ }
// อ่านตารางตรงต้องใช้สิทธิ์เจ้าของ แล้วคืนบทบาทเดิมให้คำสั่งถัดไป
const asOwner = async job => {
  const who = (await db.query('SELECT current_user AS u')).rows[0].u
  await db.exec('RESET ROLE')
  try { return await job() } finally { if (['anon', 'authenticated'].includes(who)) await db.exec(`SET ROLE ${who}`) }
}
const row = async (sql, args = []) => asOwner(async () => (await db.query(sql, args)).rows[0])
const rows = async (sql, args = []) => asOwner(async () => (await db.query(sql, args)).rows)
const bangkok = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
const dayAt = n => bangkok.format(new Date(Date.now() + n * 86400000))
const today = dayAt(0)
const at = (day, time) => `${day}T${time}:00+07:00`
const fnState = async () => rows(`SELECT oid::regprocedure::text AS identity,proacl::text AS acl,prosecdef,proconfig,provolatile FROM pg_proc
 WHERE oid IN (${REPLACED.map(f => `'${f}'::regprocedure`).join(',')}) ORDER BY 1`)
const md5s = async () => Object.fromEntries((await rows(`SELECT oid::regprocedure::text AS f,md5(replace(prosrc,chr(13),'')) AS m FROM pg_proc
 WHERE oid IN (${REPLACED.map(f => `'${f}'::regprocedure`).join(',')})`)).map(r => [r.f, r.m]))
// เที่ยวจำลองใส่ตรงเพื่อคุมวันที่/สถานะ/เลขไมล์รายเที่ยวเดิม (ไม่ผ่าน ptb_plan) — ไม่มีคำขอผูก ไม่กระทบเทสต์อื่น
const trip = async ({ day, time = '09:00', state = 'completed', who = driver, start = null, end = null, issue = false, note = '', service }) => {
  const tripId = randomUUID()
  const plan = { date: day, pickup_at: at(day, time), route_label: 'TEST เลขไมล์รายวัน', route_id: 'a', return_mode: 'one_way', blocks: [], ...(service ? { service_type: service } : {}) }
  await asOwner(() => db.query(`INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,state,confirmed_by,odometer_start,odometer_end,odometer_issue,odometer_note)
   VALUES($1,$2,$3,'{}',$4,$5,$6,$7,$8,$9,$10)`, [tripId, tenant, who, JSON.stringify(plan), state, coordinator, start, end, issue, note]))
  return tripId
}
const dayRow = async day => row('SELECT * FROM public.patient_booking_odometer_days WHERE municipality_id=$1 AND service_date=$2', [tenant, day])
const events = async () => (await row("SELECT count(*)::int n FROM public.patient_booking_events WHERE action='day_odometer_recorded'")).n
const badge = async user => { await actor(user); return (await rpc('patient_booking_staff_work_badge', [tenant])).driver }

try {
 await db.exec('RESET ROLE')
 for (const f of before) await db.exec(await read(f))
 console.log('MD5', JSON.stringify(await md5s()))

 // 1) ข้อมูลเลขไมล์รายเที่ยวเดิมก่อนเปลี่ยน — ใช้ตรวจการย้ายเป็นรายวัน
 const single = dayAt(-12), clean = dayAt(-11), overlap = dayAt(-10), flagged = dayAt(-9)
 await trip({ day: single, start: 1000, end: 1050, note: 'ตรวจเลขจากมาตรวัดแล้ว' })
 await trip({ day: clean, time: '13:00', start: 2030, end: 2070 })
 await trip({ day: clean, time: '08:00', start: 2000, end: 2030 })
 await trip({ day: clean, time: '15:00', state: 'cancelled', start: 9000, end: 9100 })
 // เคสที่เจ้าของระบบยกมา: 08:00–16:00 กับ 10:00–17:00 ซ้อนกัน เลขไมล์รายเที่ยวจึงเหลื่อมกัน
 await trip({ day: overlap, time: '08:00', start: 3000, end: 3100 })
 await trip({ day: overlap, time: '10:00', start: 3020, end: 3080 })
 await trip({ day: flagged, start: 4000, end: 10, issue: true, note: 'มาตรวัดมีปัญหา' })

 // 2) ตาราง + ย้ายข้อมูล
 await db.exec(await read(TABLE))
 await db.exec(await read(BACKFILL))
 const migrated = async day => { const r = await dayRow(day); return r && [r.odometer_start, r.odometer_end, r.odometer_issue, r.odometer_note, r.revision, r.recorded_by] }
 check(await migrated(single), [1000, 1050, false, 'ตรวจเลขจากมาตรวัดแล้ว', 1, null], 'วันละ 1 เที่ยว = คัดลอกตรง')
 check(await migrated(clean), [2000, 2070, false, 'ย้ายจากเลขไมล์รายเที่ยว 2 เที่ยว', 1, null], 'หลายเที่ยวต่อเนื่อง = ออกเที่ยวแรก กลับเที่ยวสุดท้าย ไม่นับเที่ยวที่ยกเลิก')
 check(await migrated(overlap), [3000, 3080, true, 'ย้ายจากเลขไมล์รายเที่ยว 2 เที่ยว · ตัวเลขเหลื่อมกันหรือไม่ครบ กรุณาตรวจ', 1, null], 'ตัวเลขเหลื่อมกัน = รอตรวจสอบ ไม่เดา')
 check(await migrated(flagged), [4000, 10, true, 'มาตรวัดมีปัญหา', 1, null], 'เที่ยวที่รอตรวจสอบอยู่แล้ว คงสถานะรอตรวจสอบ')
 const migratedCount = (await row('SELECT count(*)::int n FROM public.patient_booking_odometer_days')).n
 await db.exec(await read(BACKFILL))
 check((await row('SELECT count(*)::int n FROM public.patient_booking_odometer_days')).n, migratedCount, 'รันย้ายซ้ำไม่เพิ่ม/ไม่ทับแถว')
 check((await row("SELECT count(*)::int n FROM public.patient_booking_trips WHERE odometer_start=3020 AND odometer_end=3080")).n, 1, 'คอลัมน์รายเที่ยวเดิมไม่ถูกแก้')
 check((await row(`SELECT relrowsecurity AS rls, has_table_privilege('authenticated','public.patient_booking_odometer_days','SELECT') AS auth_select,
  has_table_privilege('anon','public.patient_booking_odometer_days','SELECT') AS anon_select FROM pg_class WHERE oid='public.patient_booking_odometer_days'::regclass`)),
  { rls: true, auth_select: false, anon_select: false }, 'ตารางเปิด RLS และไม่มีสิทธิ์อ่านตรง')
 console.log('PASS table + backfill: one trip copied, continuous trips merged, overlapping/flagged kept for review, rerun idempotent, trip columns untouched, RPC-only table')

 // 3) ตัวกัน drift ของ 2 ฟังก์ชันที่ถูกแทน แล้ว apply จริง · สิทธิ์และคุณสมบัติฟังก์ชันคงเดิม
 const stateBefore = await fnState()
 for (const identity of REPLACED) {
  const definition = (await row('SELECT pg_get_functiondef($1::regprocedure) AS d', [identity])).d
  await db.exec(definition.replace(/AS (\$\w*\$)/, 'AS $1\n-- deliberate local drift'))
  await fails(async () => db.exec(await read(RPC)), /Function drift/)
  await db.exec('ROLLBACK')
  await db.exec(definition)
 }
 await db.exec(await read(RPC))
 check(await fnState(), stateBefore, 'ACL / SECURITY DEFINER / search_path / volatility ของฟังก์ชันที่ถูกแทนคงเดิม')
 await fails(async () => db.exec(await read(RPC)), /Function drift|already exists/)
 await db.exec('ROLLBACK')
 check((await row(`SELECT has_function_privilege('anon','public.patient_booking_save_day_odometer(uuid,date,integer,integer,integer,boolean,text)','EXECUTE') AS save_anon,
  has_function_privilege('anon','public.patient_booking_odometer_days(uuid,date,date)','EXECUTE') AS read_anon,
  has_function_privilege('authenticated','public.patient_booking_odometer_days(uuid,date,date)','EXECUTE') AS read_auth`)),
  { save_anon: false, read_anon: false, read_auth: true }, 'RPC ใหม่เรียกได้เฉพาะผู้ที่เข้าสู่ระบบ')
 console.log('PASS drift guard on both replaced functions, attributes and grants kept, new RPCs authenticated-only')

 // 4) บันทึกรายวัน: วันละครั้งตอนรถกลับ · กี่เที่ยวก็ได้ (2 เที่ยวซ้อนเวลาวันเดียว)
 const yesterday = dayAt(-1), tomorrow = dayAt(1), empty = dayAt(-2)
 await trip({ day: yesterday, time: '08:00' })
 await trip({ day: yesterday, time: '10:00' })
 await trip({ day: tomorrow, state: 'confirmed' })
 await actor(citizen); await fails(() => rpc('patient_booking_save_day_odometer', [tenant, yesterday, 0, 5000, 5080, false, '']), /เฉพาะคนขับ/)
 await actor(driver)
 await fails(() => rpc('patient_booking_save_day_odometer', [tenant, tomorrow, 0, 5000, 5080, false, '']), /มีเที่ยวรถจบแล้ว/)
 await fails(() => rpc('patient_booking_save_day_odometer', [tenant, empty, 0, 5000, 5080, false, '']), /มีเที่ยวรถจบแล้ว/)
 await fails(() => rpc('patient_booking_save_day_odometer', [tenant, yesterday, 0, 5000, 4999, false, '']), /ไม่น้อยกว่า/)
 await fails(() => rpc('patient_booking_save_day_odometer', [tenant, yesterday, 0, 5000, 7001, false, '']), /2,000/)
 await fails(() => rpc('patient_booking_save_day_odometer', [tenant, yesterday, 0, 5000, null, false, '']), /กรุณาระบุเลขไมล์/)
 await fails(() => rpc('patient_booking_save_day_odometer', [tenant, yesterday, 0, -1, 10, false, '']), /ติดลบ/)
 const eventsBefore = await events()
 let rev = await rpc('patient_booking_save_day_odometer', [tenant, yesterday, 0, 5000, 5080, false, ''])
 check(rev, 1)
 check(await rpc('patient_booking_save_day_odometer', [tenant, yesterday, 0, 5000, 5080, false, '']), 1, 'ยิงซ้ำค่าเดิม = สำเร็จ ได้ revision เดิม')
 check(await events(), eventsBefore + 1, 'ยิงซ้ำไม่ลงประวัติซ้ำ')
 const saved = await dayRow(yesterday)
 check([saved.odometer_start, saved.odometer_end, saved.odometer_issue, saved.recorded_by], [5000, 5080, false, driver], 'คนขับของวันนั้นบันทึกเองได้')
 await fails(() => rpc('patient_booking_save_day_odometer', [tenant, yesterday, 0, 5000, 5090, false, 'กรอกผิด']), /เปลี่ยนแล้ว/)
 await actor(coordinator)
 rev = await rpc('patient_booking_save_day_odometer', [tenant, yesterday, rev, 5000, 5090, false, '  กรอกผิด  '])
 check(rev, 2, 'ผู้จัดคิวแก้แทนได้ revision เพิ่ม')
 const audit = await row("SELECT actor_id, detail FROM public.patient_booking_events WHERE action='day_odometer_recorded' AND detail->>'previous_end'='5080'")
 check([audit.actor_id, audit.detail.date, audit.detail.previous_end, audit.detail.end, audit.detail.note], [coordinator, yesterday, 5080, 5090, 'กรอกผิด'], 'ประวัติเก็บค่าก่อน/หลังและผู้แก้')
 rev = await rpc('patient_booking_save_day_odometer', [tenant, yesterday, rev, null, null, true, 'มาตรวัดมีปัญหา'])
 check([(await dayRow(yesterday)).odometer_issue, rev], [true, 3], 'มาตรวัดมีปัญหา บันทึกได้แม้ไม่มีตัวเลข')
 rev = await rpc('patient_booking_save_day_odometer', [tenant, yesterday, rev, 5000, 5090, false, null])
 check(rev, 4)
 // คนขับที่ถูกลดเป็นประชาชน / เจ้าหน้าที่ที่ไม่ได้ขับวันนั้น แก้ไม่ได้
 await asOwner(() => db.query("UPDATE public.profiles SET role='citizen' WHERE id=$1", [driver]))
 await actor(driver); await fails(() => rpc('patient_booking_save_day_odometer', [tenant, yesterday, rev, 5000, 5100, false, '']), /เฉพาะคนขับ/)
 await asOwner(() => db.query("UPDATE public.profiles SET role='staff' WHERE id=$1", [driver]))
 const coordDay = dayAt(-3)
 await trip({ day: coordDay, who: coordinator })
 await actor(driver); await fails(() => rpc('patient_booking_save_day_odometer', [tenant, coordDay, 0, 5100, 5150, false, '']), /เฉพาะคนขับ/)
 console.log('PASS day odometer writes: driver of the day or coordinator only, only days with a completed trip, bounds, CAS + idempotent retry, issue without numbers, audited before/after')

 // 5) อ่านรายวัน: ผู้จัดคิวเห็นทุกวัน · คนขับเห็นเฉพาะวันที่ตัวเองขับ · เลขกลับล่าสุดก่อนช่วงไว้เติมเลขออก
 await actor(coordinator)
 const all = await rpc('patient_booking_odometer_days', [tenant, dayAt(-12), today])
 const byDate = Object.fromEntries(all.days.map(d => [d.date, d]))
 check([byDate[yesterday].trips, byDate[yesterday].completed, byDate[yesterday].open, byDate[yesterday].odometer_end, byDate[yesterday].revision, byDate[yesterday].recorded_by_name],
  [2, 2, 0, 5090, 4, 'Coordinator TEST'], 'สรุปเที่ยวของวัน + เลขไมล์ + ผู้บันทึก')
 check([byDate[clean].trips, byDate[clean].completed], [2, 2], 'ไม่นับเที่ยวที่ยกเลิก')
 check([byDate[coordDay].odometer_end, byDate[coordDay].revision, byDate[coordDay].mine], [null, 0, true], 'วันที่ยังไม่บันทึก revision = 0 · ผู้จัดคิวขับเองวันนั้น = mine')
 check(Object.keys(byDate).includes(empty), false, 'วันที่ไม่มีเที่ยวและไม่มีบันทึกไม่ขึ้น')
 check((await rpc('patient_booking_odometer_days', [tenant, yesterday, today])).previous, { date: clean, odometer_end: 2070 }, 'เลขก่อนช่วงข้ามวันที่รอตรวจสอบ')
 await actor(driver)
 const mine = (await rpc('patient_booking_odometer_days', [tenant, dayAt(-12), today])).days.map(d => d.date)
 check([mine.includes(yesterday), mine.includes(coordDay)], [true, false], 'คนขับเห็นเฉพาะวันที่ตัวเองขับ')
 await fails(() => rpc('patient_booking_odometer_days', [tenant, '2000-01-01', today]), /10 ปี/)
 await actor(citizen); await fails(() => rpc('patient_booking_odometer_days', [tenant, yesterday, today]), /ไม่มีสิทธิ์/)
 await actor(null); await fails(() => rpc('patient_booking_odometer_days', [tenant, yesterday, today]), /permission denied/)
 console.log('PASS day odometer reads: coordinator all days with trip counts, driver own days only, previous reading skips flagged days, range bound, citizens/anon denied')

 // 6) บันทึกเลขไมล์รายเที่ยวปิดแล้ว (ทั้ง RPC ใหม่และตัวห่อเดิม) — แท็บเก่าได้ข้อความให้โหลดหน้าใหม่
 const anyTrip = (await row("SELECT id, docs_revision FROM public.patient_booking_trips WHERE municipality_id=$1 AND state='completed' ORDER BY created_at LIMIT 1", [tenant]))
 await actor(driver)
 await fails(() => rpc('patient_booking_save_odometer', [tenant, anyTrip.id, anyTrip.docs_revision, 1, 2, false, '']), /บันทึกเลขไมล์รายวันแล้ว/)
 await fails(() => rpc('patient_booking_record_odometer', [tenant, anyTrip.id, anyTrip.docs_revision, 1, 2]), /บันทึกเลขไมล์รายวันแล้ว/)
 console.log('PASS per-trip odometer writes refused with a reload message (new and legacy wrapper)')

 // 7) ป้ายงานคนขับนับ "วันที่รอเลขไมล์ปิดวัน" วันละ 1 ไม่ใช่เที่ยวละ 1
 const pendingDay = dayAt(-4)
 await trip({ day: pendingDay, time: '08:00' })
 await trip({ day: pendingDay, time: '10:00' })
 const withPending = await badge(driver)
 await actor(driver); await rpc('patient_booking_save_day_odometer', [tenant, pendingDay, 0, 5090, 5150, false, ''])
 check(await badge(driver), withPending - 1, 'วันที่มี 2 เที่ยว นับเป็นงานค้าง 1 และหายเมื่อใส่เลขไมล์')
 const issueDay = dayAt(-6)
 await trip({ day: issueDay })
 const beforeIssue = await badge(driver)
 await actor(driver); await rpc('patient_booking_save_day_odometer', [tenant, issueDay, 0, null, null, true, 'มาตรวัดมีปัญหา'])
 check(await badge(driver), beforeIssue, 'วันที่รอตรวจสอบยังนับเป็นงานค้าง')
 const busyDay = dayAt(-5)
 await trip({ day: busyDay, time: '08:00' })
 const beforeOpen = await badge(driver)
 await trip({ day: busyDay, time: '13:00', state: 'outbound' })
 check(await badge(driver), beforeOpen, 'วันที่ยังมีเที่ยววิ่งอยู่ ยังไม่นับเป็นวันรอเลขไมล์ (นับเป็นเที่ยวค้างแทน)')
 console.log(`All day-odometer checks passed (${checks} checks).`)
} finally {
 await db.close()
}
