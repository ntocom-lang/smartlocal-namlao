// PGlite only. No .env, project client, real accounts or network access.
// กลุ่มปลายทาง (20261007150000): ผู้ป่วยต่างปลายทางนั่งรถเที่ยวเดียวกันได้เมื่อปลายทางอยู่กลุ่มเดียวกัน
// เคสจริงที่เป็นต้นเรื่อง: ทุ่งแค้ว 2569-10-09 เที่ยวฟอกไตรอรับกลับกันรถ 10:30–19:00 คนไปคลินิกในเมืองเดียวกันจองไม่ได้ทั้งวัน
// ตัวเลขเวลาในเทสต์นี้ตั้งให้ตรงกับเคสนั้น (ฟอกไต 45 นาที นัด 12:00 รับกลับ 17:30)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, citizen, settings, id, baseBooking } = await import('./patient-booking-db.test.mjs')
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
 '20261003150100_patient_booking_legacy_client_gate.sql']
const zoneFile = '20261007150000_patient_booking_destination_zone.sql'
let checks = 0
const check = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const fails = async (job, pattern) => { await assert.rejects(job, pattern); checks++ }
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const dayAt = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const day1 = dayAt(300), day2 = dayAt(301)
const at = (time, day = day1) => `${day}T${time}:00+07:00`
const ms = value => Date.parse(value)
const citizen2 = id(14)
const booking = (name, patch) => ({ ...baseBooking, patient_name: `TEST zone ${name}`, companions: 0, ...patch })
const fnState = async () => (await db.query(`SELECT oid::regprocedure::text AS identity,proacl::text AS acl,prosecdef,proconfig,provolatile FROM pg_proc
 WHERE oid IN ('public.ptb_plan(uuid,uuid[],text)'::regprocedure,'public.patient_booking_save_settings(uuid,integer,jsonb)'::regprocedure) ORDER BY 1`)).rows
const revision = async () => (await row('SELECT revision FROM public.patient_booking_settings WHERE municipality_id=$1', [tenant])).revision

try {
 await db.exec('RESET ROLE')
 for (const f of before) await db.exec(await read(f))

 // 1) เที่ยวปลายทางเดียว: แผนก่อน/หลัง migration ต้องเท่ากันทุกค่า (ยกเว้นขากลับทับกันในแบบรอรับกลับ ที่ตั้งใจให้ตรวจเพิ่ม)
 await actor(citizen)
 const singles = {
  wait: [['s1', { return_mode: 'wait', appointment_at: at('10:00'), return_at: at('12:00') }]],
  later: [['s2', { return_mode: 'later', appointment_at: at('10:00'), return_at: at('15:00') }]],
  oneWay: [['s3', { return_mode: 'one_way', appointment_at: at('10:00'), return_at: null }]],
  waitPair: [['s4', { return_mode: 'wait', appointment_at: at('10:00'), return_at: at('12:00') }], ['s5', { return_mode: 'wait', appointment_at: at('10:20'), return_at: at('12:00') }]],
  laterTwoReturns: [['s6', { return_mode: 'later', appointment_at: at('10:00'), return_at: at('12:00') }], ['s7', { return_mode: 'later', appointment_at: at('10:00'), return_at: at('14:00') }]],
  waitCloseReturns: [['s8', { return_mode: 'wait', appointment_at: at('10:00'), return_at: at('12:00') }], ['s9', { return_mode: 'wait', appointment_at: at('10:00'), return_at: at('12:45') }]],
 }
 const ids = {}
 for (const [key, rows] of Object.entries(singles)) {
  ids[key] = []
  for (const [name, patch] of rows) { const bid = randomUUID(); await rpc('patient_booking_submit', [tenant, bid, booking(name, patch)]); ids[key].push(bid) }
 }
 await actor(coordinator)
 const baseline = {}
 for (const [key, list] of Object.entries(ids)) baseline[key] = await rpc('patient_booking_preview', [tenant, list, ''])
 check(baseline.waitCloseReturns.errors, [], 'ก่อนแก้: รอรับกลับไม่ตรวจขากลับทับกัน')
 check(baseline.waitCloseReturns.return_waves.length, 2)

 // 2) ตัวกัน drift: ฟังก์ชันบนฐานถูกแก้นอกรีโป = migration หยุดก่อนเขียนทับ
 await db.exec('RESET ROLE')
 const stateBefore = await fnState()
 for (const identity of ['public.ptb_plan(uuid,uuid[],text)', 'public.patient_booking_save_settings(uuid,integer,jsonb)']) {
  const definition = (await row('SELECT pg_get_functiondef($1::regprocedure) AS d', [identity])).d
  await db.exec(definition.replace(/AS (\$\w*\$)/, 'AS $1\n-- deliberate local drift'))
  await fails(async () => db.exec(await read(zoneFile)), /Function drift/)
  await db.exec('ROLLBACK')
  await db.exec(definition)
 }
 await db.exec(await read(zoneFile))
 check(await fnState(), stateBefore, 'สิทธิ์ SECURITY DEFINER search_path และ volatility คงเดิม')
 await fails(async () => db.exec(await read(zoneFile)), /Function drift/)
 await db.exec('ROLLBACK')

 await actor(coordinator)
 for (const [key, list] of Object.entries(ids)) {
  const after = await rpc('patient_booking_preview', [tenant, list, ''])
  if (key === 'waitCloseReturns') {
   check(after.errors, ['รอบรับ–ส่งทับกันภายในแผนเดียว'], 'หลังแก้: รอรับกลับที่ขากลับทับกันถูกปฏิเสธ')
   check({ ...after, errors: [] }, baseline[key])
  } else check(after, baseline[key], `แผนปลายทางเดียว ${key} ต้องเหมือนเดิมทุกค่า`)
 }
 console.log('PASS single-destination plans unchanged, wait-mode return overlap now refused, drift guard, function attributes kept')

 // 3) ตั้งกลุ่มปลายทาง: เก็บเฉพาะกลุ่มที่ไม่ว่าง ตัดช่องว่าง และจำกัด 60 ตัวอักษร
 await db.exec('RESET ROLE')
 const settingsRevision = await revision()
 await actor(admin)
 const zoned = { ...settings, seats: 10, office_start: 480, office_end: 1170, routes: [
  { id: 'a', label: 'TEST คลินิกในเมือง', minutes: 30, zone: 'TEST ในเมือง' },
  { id: 'b', label: 'TEST ศูนย์ฟอกไต', minutes: 45, zone: '  TEST ในเมือง  ' },
  { id: 'c', label: 'TEST รพ.อำเภอ', minutes: 20, zone: '   ' },
  { id: 'd', label: 'TEST รพ.ต่างเมือง', minutes: 45, zone: 'TEST ต่างเมือง' },
 ] }
 await fails(() => rpc('patient_booking_save_settings', [tenant, settingsRevision, { ...zoned, routes: [{ ...zoned.routes[0], zone: 'ก'.repeat(61) }] }]), /กลุ่มปลายทาง/)
 await rpc('patient_booking_save_settings', [tenant, settingsRevision, zoned])
 await actor(null)
 const info = await rpc('patient_booking_info', [tenant])
 check(info.routes, [
  { id: 'a', label: 'TEST คลินิกในเมือง', minutes: 30, zone: 'TEST ในเมือง' },
  { id: 'b', label: 'TEST ศูนย์ฟอกไต', minutes: 45, zone: 'TEST ในเมือง' },
  { id: 'c', label: 'TEST รพ.อำเภอ', minutes: 20 },
  { id: 'd', label: 'TEST รพ.ต่างเมือง', minutes: 45, zone: 'TEST ต่างเมือง' },
 ])

 // 4) เที่ยวฟอกไตรอรับกลับ 2 คน: รถออก 10:30 กันรถถึง 19:00 (ตรงกับเคสจริง)
 await actor(citizen)
 const dialysis = [randomUUID(), randomUUID()]
 for (const [i, bid] of dialysis.entries()) await rpc('patient_booking_submit', [tenant, bid, booking(`ฟอกไต ${i}`, { route_id: 'b', return_mode: 'wait', appointment_at: at('12:00', day2), return_at: at('17:30', day2) })])
 await actor(coordinator)
 const dialysisPlan = await rpc('patient_booking_preview', [tenant, dialysis, ''])
 check(dialysisPlan.errors, [])
 check([ms(dialysisPlan.pickup_at), dialysisPlan.blocks.map(b => [ms(b.start), ms(b.end)])], [ms(at('10:30', day2)), [[ms(at('10:30', day2)), ms(at('19:00', day2))]]])
 check(dialysisPlan.route_label, 'TEST ศูนย์ฟอกไต')
 const trip = id(70001)
 await rpc('patient_booking_confirm', [tenant, trip, dialysis, dialysisPlan, ''])

 // 5) คนไปคลินิก (กลุ่มเดียวกัน) ขอร่วม นัด 12:00 กลับเอง 13:00 → รถออก 10:00 · ขากลับ 2 รอบไม่ทับกัน
 await actor(citizen2)
 const joiner = randomUUID()
 const joinData = booking('คลินิก', { phone: '0800000077', route_id: 'a', return_mode: 'wait', appointment_at: at('12:00', day2), return_at: at('13:00', day2) })
 check(await rpc('patient_booking_submit_join', [tenant, joiner, trip, joinData, false]), joiner)
 await actor(coordinator)
 const joinPlan = await rpc('patient_booking_preview_join', [tenant, joiner])
 check(joinPlan.errors, [])
 // รอบขาไปแวะ 2 จุด: ไกลสุด 45 + เวลาเผื่อ 15 = 60 นาที · ขึ้นรถ 3 คน 45 นาที · เผื่อก่อนนัด 15 → 12:00-120 นาที
 check(ms(joinPlan.pickup_at), ms(at('10:00', day2)))
 check(joinPlan.outbound_waves.map(w => [ms(w.pickup_at), ms(w.end_at), w.passengers]), [[ms(at('10:00', day2)), ms(at('13:15', day2)), 3]])
 // ขากลับแยกรอบตามปลายทางของรอบ: คลินิก 30 นาที, ฟอกไต 45 นาที
 check(joinPlan.return_waves.map(w => [ms(w.depart_at), ms(w.return_start), ms(w.end_at), w.passengers]), [
  [ms(at('12:15', day2)), ms(at('13:00', day2)), ms(at('14:00', day2)), 1],
  [ms(at('16:30', day2)), ms(at('17:30', day2)), ms(at('19:00', day2)), 2],
 ])
 check(joinPlan.blocks.map(b => [ms(b.start), ms(b.end)]), [[ms(at('10:00', day2)), ms(at('19:00', day2))]])
 check(joinPlan.route_label, 'TEST คลินิกในเมือง + TEST ศูนย์ฟอกไต')
 check(joinPlan.seats, 3)
 check(await rpc('patient_booking_confirm_join', [tenant, randomUUID(), joiner, joinPlan]), trip)
 await db.exec('RESET ROLE')
 const stored = await row('SELECT plan FROM public.patient_booking_trips WHERE id=$1', [trip])
 check(stored.plan.route_label, 'TEST คลินิกในเมือง + TEST ศูนย์ฟอกไต')
 await actor(null)
 const publicTrip = (await rpc('patient_booking_calendar', [tenant, day2, day2])).days[0].trips[0]
 check([publicTrip.route_label, publicTrip.joinable], ['TEST คลินิกในเมือง + TEST ศูนย์ฟอกไต', true])
 console.log('PASS same-zone join: earlier shared pickup, per-wave travel, own return time, composite label')

 // 6) ต่างกลุ่ม / ไม่มีกลุ่ม → ปฏิเสธด้วยข้อความเดิม · ขากลับทับรอบฟอกไต → ปฏิเสธ · ไม่เหลือคำขอค้าง
 await actor(citizen2)
 for (const [route, name] of [['d', 'ต่างกลุ่ม'], ['c', 'ไม่มีกลุ่ม']]) {
  await fails(() => rpc('patient_booking_submit_join', [tenant, randomUUID(), trip,
   booking(name, { phone: '0800000078', route_id: route, return_mode: 'wait', appointment_at: at('12:00', day2), return_at: at('13:00', day2) }), false]), /เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน/)
 }
 await fails(() => rpc('patient_booking_submit_join', [tenant, randomUUID(), trip,
  booking('กลับชนรอบฟอกไต', { phone: '0800000079', route_id: 'a', return_mode: 'wait', appointment_at: at('12:00', day2), return_at: at('16:45', day2) }), false]), /รอบรับ–ส่งทับกันภายในแผนเดียว/)
 await db.exec('RESET ROLE')
 check((await row("SELECT count(*)::int n FROM public.patient_bookings WHERE phone IN ('0800000078','0800000079')")).n, 0, 'คำขอที่ร่วมไม่ได้ต้องไม่ค้างในระบบ')
 console.log('PASS other zone, no zone and overlapping return refused without leftovers')
 console.log(`All destination-zone checks passed (${checks} checks).`)
} finally {
 await db.close()
}
