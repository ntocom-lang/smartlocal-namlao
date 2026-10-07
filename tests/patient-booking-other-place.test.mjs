// PGlite only. No .env, project client, real accounts or network access.
// สถานที่อื่น (20261007170000): ช่อง "อื่นๆ" ที่ผู้จองพิมพ์ชื่อสถานที่เองได้ · แอดมินตั้งเวลาเดินทางมาตรฐานครั้งเดียว
// เจ้าของระบบเลือกแบบ "ค่ามาตรฐานที่แอดมินตั้งครั้งเดียว" 2569-10-07 — ptb_plan ไม่ถูกแก้ แค่หาเส้นทาง '__other__' จาก routes เหมือนเดิม
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
 '20261003150100_patient_booking_legacy_client_gate.sql','20261007150000_patient_booking_destination_zone.sql']
const migration = '20261007170000_patient_booking_other_place.sql'
const FUNCTIONS = ['public.patient_booking_submit(uuid,uuid,jsonb,boolean)', 'public.patient_booking_amend(uuid,uuid,uuid,integer,jsonb,text)',
 'public.patient_booking_change_hospital(uuid,uuid,uuid,jsonb,text,text)']
let checks = 0
const check = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const fails = async (job, pattern) => { await assert.rejects(job, pattern); checks++ }
// ตัวช่วยอ่านตารางตรงๆ ต้องทำในสิทธิ์เจ้าของ (ผู้จัดคิว/ประชาชนอ่านตารางตรงไม่ได้) แล้วคืนสิทธิ์เดิมให้คำสั่งถัดไป
const asOwner = async job => {
  const who = (await db.query('SELECT current_user AS u')).rows[0].u
  await db.exec('RESET ROLE')
  try { return await job() } finally { if (['anon', 'authenticated'].includes(who)) await db.exec(`SET ROLE ${who}`) }
}
const row = async (sql, args = []) => asOwner(async () => (await db.query(sql, args)).rows[0])
const dayAt = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const day1 = dayAt(320), day2 = dayAt(321), day3 = dayAt(322)
const at = (time, day = day1) => `${day}T${time}:00+07:00`
const ms = value => Date.parse(value)
let serial = 0
// ทุกใบใช้เบอร์/ชื่อไม่ซ้ำ เพื่อไม่ชนด่านกันคำขอซ้ำ (เบอร์+ชื่อ+เวลานัด+ปลายทาง)
const booking = (name, patch = {}) => { serial++; return { ...baseBooking, patient_name: `TEST other ${name}`, phone: `08100${String(serial).padStart(5, '0')}`, companions: 0, return_mode: 'one_way', return_at: null, ...patch } }
const fnState = async () => (await db.query(`SELECT oid::regprocedure::text AS identity,proacl::text AS acl,prosecdef,proconfig,provolatile FROM pg_proc
 WHERE oid IN (${FUNCTIONS.map(f => `'${f}'::regprocedure`).join(',')}) ORDER BY 1`)).rows
const md5s = async () => Object.fromEntries((await db.query(`SELECT oid::regprocedure::text AS f,md5(replace(prosrc,chr(13),'')) AS m FROM pg_proc
 WHERE oid IN (${FUNCTIONS.map(f => `'${f}'::regprocedure`).join(',')})`)).rows.map(r => [r.f, r.m]))
const bookingRow = async bid => row('SELECT route_id,route_label,share,revision,status,trip_id,entry_channel FROM public.patient_bookings WHERE id=$1', [bid])
const revisionOfSettings = async () => (await row('SELECT revision FROM public.patient_booking_settings WHERE municipality_id=$1', [tenant])).revision
const expectedFor = async tripId => {
  const t = await row('SELECT revision,docs_revision,schedule_revision FROM public.patient_booking_trips WHERE id=$1', [tripId])
  const riders = await asOwner(async () => (await db.query("SELECT id,revision FROM public.patient_bookings WHERE trip_id=$1 AND status<>'cancelled'", [tripId])).rows)
  return { trip: tripId, revision: t.revision, docs_revision: t.docs_revision, schedule_revision: t.schedule_revision,
    settings_revision: await revisionOfSettings(), bookings: Object.fromEntries(riders.map(r => [r.id, r.revision])) }
}

try {
 await db.exec('RESET ROLE')
 for (const f of before) await db.exec(await read(f))
 // ไฟล์ migration ต้องตรงกับ md5 ของนิยามที่รีโปมีอยู่ ณ ตอนนี้ (ตัวกัน drift ทำงานจริงด้านล่าง)
 console.log('MD5', JSON.stringify(await md5s()))

 // 1) ตัวกัน drift: ฟังก์ชันบนฐานถูกแก้นอกรีโป = migration หยุดก่อนเขียนทับ ทั้ง 3 ตัว
 const stateBefore = await fnState()
 for (const identity of FUNCTIONS) {
  const definition = (await row('SELECT pg_get_functiondef($1::regprocedure) AS d', [identity])).d
  await db.exec(definition.replace(/AS (\$\w*\$)/, 'AS $1\n-- deliberate local drift'))
  await fails(async () => db.exec(await read(migration)), /Function drift/)
  await db.exec('ROLLBACK')
  await db.exec(definition)
 }
 await db.exec(await read(migration))
 check(await fnState(), stateBefore, 'สิทธิ์ SECURITY DEFINER search_path และ volatility ของทั้ง 3 ฟังก์ชันคงเดิม')
 await fails(async () => db.exec(await read(migration)), /Function drift/)
 await db.exec('ROLLBACK')
 console.log('PASS drift guard on all three functions, attributes kept')

 // 2) แอดมินเปิดช่อง "อื่นๆ" ครั้งเดียว: เก็บเป็นเส้นทาง '__other__' มีแค่ minutes ที่เป็นค่ามาตรฐาน
 await actor(admin)
 const configured = { ...settings, seats: 10, office_start: 420, office_end: 1170, routes: [
  { id: 'a', label: 'TEST รพ.แพร่', minutes: 30 },
  { id: '__other__', label: 'อื่นๆ (พิมพ์ชื่อสถานที่เอง)', minutes: 60 },
 ] }
 await rpc('patient_booking_save_settings', [tenant, await revisionOfSettings(), configured])
 await actor(null)
 const info = await rpc('patient_booking_info', [tenant])
 check(info.routes.map(r => [r.id, r.minutes]), [['a', 30], ['__other__', 60]], 'ช่องอื่นๆ ขึ้นใน info เป็นเส้นทางที่มีเวลาเดินทางมาตรฐาน')

 // 3) ผู้จองพิมพ์ชื่อสถานที่เอง: เก็บเป็น route_label ของคำขอ · ยุบช่องว่าง/ขึ้นบรรทัดใหม่ · บังคับ share=false
 await actor(citizen)
 const typed = randomUUID()
 await rpc('patient_booking_submit', [tenant, typed, booking('typed', { route_id: '__other__', other_place: '  วัดพระธาตุ\n\tช่อแฮ   ', share: true,
  appointment_at: at('12:00'), return_mode: 'one_way', return_at: null })])
 const typedRow = await bookingRow(typed)
 check([typedRow.route_id, typedRow.route_label, typedRow.share], ['__other__', 'วัดพระธาตุ ช่อแฮ', false], 'ชื่อที่พิมพ์เป็นปลายทางของคำขอ และไม่ร่วมเที่ยวแม้ส่ง share=true')
 await rpc('patient_booking_submit', [tenant, typed, booking('typed-retry', { route_id: '__other__', other_place: 'ชื่ออื่น', appointment_at: at('12:00') })])
 check((await row('SELECT count(*)::int n FROM public.patient_bookings WHERE id=$1', [typed])).n, 1, 'ส่งซ้ำด้วยรหัสเดิมได้ใบเดิม ไม่เขียนทับชื่อ')
 check((await bookingRow(typed)).route_label, 'วัดพระธาตุ ช่อแฮ')
 const listed = randomUUID()
 await rpc('patient_booking_submit', [tenant, listed, booking('listed', { route_id: 'a', other_place: 'ต้องไม่ถูกใช้', share: true, appointment_at: at('09:00', day2) })])
 const listedRow = await bookingRow(listed)
 check([listedRow.route_label, listedRow.share], ['TEST รพ.แพร่', true], 'เส้นทางในรายการไม่รับ other_place และคง share ตามที่เลือก')
 for (const [label, patch] of [['ไม่ส่งชื่อ', {}], ['ว่าง', { other_place: '   ' }], ['อักษรเดียว', { other_place: 'ก' }],
  ['ตัวควบคุมล้วน', { other_place: '\n\t\r' }], ['ยาวเกิน 200', { other_place: 'ก'.repeat(201) }]]) {
  await fails(() => rpc('patient_booking_submit', [tenant, randomUUID(), booking(`bad ${label}`, { route_id: '__other__', appointment_at: at('13:00'), ...patch })]), /ชื่อสถานที่/)
 }
 await rpc('patient_booking_submit', [tenant, randomUUID(), booking('max', { route_id: '__other__', other_place: 'ก'.repeat(200), appointment_at: at('15:00'), return_mode: 'one_way', return_at: null })])
 await fails(() => rpc('patient_booking_submit', [tenant, randomUUID(), booking('unknown', { route_id: 'zzz' })]), /กรุณาเลือกโรงพยาบาลและพื้นที่/)
 await actor(coordinator)
 const phone = randomUUID()
 await rpc('patient_booking_submit', [tenant, phone, booking('phone', { route_id: '__other__', other_place: 'คลินิกหมอทดสอบ', appointment_at: at('09:00', day3), return_mode: 'one_way', return_at: null }), true])
 const phoneRow = await bookingRow(phone)
 check([phoneRow.route_label, phoneRow.share, phoneRow.entry_channel], ['คลินิกหมอทดสอบ', false, 'staff'], 'เจ้าหน้าที่รับแทนก็พิมพ์ชื่อสถานที่ได้')
 console.log('PASS typed place stored as the booking destination, whitespace folded, no sharing, bad names and unknown ids refused')

 // 4) แผนรถ: เวลาเดินทางมาตรฐาน 60 นาที (ptb_plan ไม่ถูกแก้) · นัด 12:00 ขาไปอย่างเดียว → ออก 10:30 ถึง 13:15
 const plan = await rpc('patient_booking_preview', [tenant, [typed], ''])
 check(plan.errors, [], 'สถานที่อื่นยืนยันรถได้เมื่อมีเวลาเดินทางมาตรฐาน')
 check(plan.route_label, 'วัดพระธาตุ ช่อแฮ')
 check(plan.blocks.map(b => [ms(b.start), ms(b.end)]), [[ms(at('10:30')), ms(at('13:15'))]], 'กันรถตามเวลาเดินทางมาตรฐาน 60 นาที')

 // 5) สถานที่อื่นไม่ร่วมเที่ยวกับใคร (ทั้งอื่นๆ ด้วยกัน และกับโรงพยาบาลในรายการ)
 await actor(citizen)
 const twin = randomUUID(), friend = randomUUID()
 await rpc('patient_booking_submit', [tenant, twin, booking('twin', { route_id: '__other__', other_place: 'วัดคนละแห่ง', appointment_at: at('12:10'), return_mode: 'one_way', return_at: null })])
 await rpc('patient_booking_submit', [tenant, friend, booking('friend', { route_id: 'a', share: true, appointment_at: at('12:00'), return_mode: 'one_way', return_at: null })])
 await actor(coordinator)
 for (const pair of [[typed, twin], [typed, friend]]) {
  const together = await rpc('patient_booking_preview', [tenant, pair, ''])
  assert(together.errors.includes('ร่วมเที่ยวได้เฉพาะผู้เดินได้และยินดีร่วมเที่ยว'), `ห้ามรวมเที่ยว: ${JSON.stringify(together.errors)}`); checks++
 }

 // 6) ยืนยันแล้วกันรถจริง: ใบอื่นที่ชนช่วงเวลาถูกปฏิเสธ · ปฏิทินสาธารณะไม่เปิดชื่อสถานที่ที่พิมพ์ ไม่ให้ขอร่วม
 const tripOther = id(70101)
 await rpc('patient_booking_confirm', [tenant, tripOther, [typed], plan, ''])
 const clash = await rpc('patient_booking_preview', [tenant, [friend], ''])
 assert(clash.errors.includes('ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว'), `ต้องชนเที่ยวสถานที่อื่น: ${JSON.stringify(clash.errors)}`); checks++
 await actor(null)
 const publicDay = (await rpc('patient_booking_calendar', [tenant, day1, day1])).days[0]
 const publicTrip = publicDay.trips.find(t => t.id === tripOther)
 check([publicTrip.route_label, publicTrip.joinable, publicTrip.status], ['รถติดภารกิจ ไม่เปิดร่วมเที่ยว', false, 'busy'])
 assert(!JSON.stringify(publicDay).includes('วัดพระธาตุ'), 'ปฏิทินสาธารณะต้องไม่มีชื่อสถานที่ที่ผู้จองพิมพ์'); checks++
 console.log('PASS standard travel time blocks the car, no shared trips, public calendar hides typed place')

 // 7) เจ้าหน้าที่แก้ข้อมูลตามที่ประสาน (คำขอที่ยังไม่ยืนยัน): คงชื่อเดิม · แก้ชื่อ · เปลี่ยนเป็นโรงพยาบาลในรายการ · เปลี่ยนมาเป็นอื่นๆ ต้องระบุชื่อ
 await actor(coordinator)
 const amendData = (patch = {}) => ({ appointment_at: at('12:30', day2), return_at: null, return_mode: 'one_way', route_id: '__other__', pickup: 'TEST pickup', in_area: true, ...patch })
 const amend = async (bid, patch) => rpc('patient_booking_amend', [tenant, randomUUID(), bid, (await bookingRow(bid)).revision, amendData(patch), 'ประสานแล้ว'])
 await amend(twin, {})
 check((await bookingRow(twin)).route_label, 'วัดคนละแห่ง', 'แก้เวลาโดยไม่ส่งชื่อ = คงชื่อเดิม ไม่ถูกเขียนทับด้วยป้ายอื่นๆ')
 await amend(twin, { other_place: ' วัดที่แก้ไขแล้ว ' })
 check((await bookingRow(twin)).route_label, 'วัดที่แก้ไขแล้ว')
 await amend(twin, { route_id: 'a' })
 check([(await bookingRow(twin)).route_id, (await bookingRow(twin)).route_label], ['a', 'TEST รพ.แพร่'], 'เปลี่ยนเป็นโรงพยาบาลในรายการ ใช้ชื่อจากตั้งค่า')
 await fails(() => amend(twin, { route_id: '__other__' }), /ชื่อสถานที่/)
 await amend(twin, { route_id: '__other__', other_place: 'ศาลาประชาคมทดสอบ' })
 check([(await bookingRow(twin)).route_label, (await bookingRow(twin)).share], ['ศาลาประชาคมทดสอบ', false], 'เปลี่ยนมาเป็นอื่นๆ ต้องระบุชื่อ และไม่ร่วมเที่ยว')
 await fails(() => amend(listed, { route_id: '__other__', other_place: 'x' }), /ชื่อสถานที่/)
 await fails(() => amend(twin, { other_place: 'ข'.repeat(201) }), /ชื่อสถานที่/)

 // 8) เปลี่ยนโรงพยาบาลหลังยืนยัน: ปลายทาง '__other__' ไม่รับ (ไม่มีที่พิมพ์ชื่อ) · ต้นทางเป็นอื่นๆ แก้เป็นโรงพยาบาลในรายการได้
 await fails(async () => rpc('patient_booking_change_hospital', [tenant, randomUUID(), typed, await expectedFor(tripOther), '__other__', 'single']), /กรุณาเลือกโรงพยาบาลที่ตั้งไว้/)
 const hospitalChange = await rpc('patient_booking_change_hospital', [tenant, randomUUID(), typed, await expectedFor(tripOther), 'a', 'single'])
 check(hospitalChange.saved, true)
 check([(await bookingRow(typed)).route_id, (await bookingRow(typed)).route_label], ['a', 'TEST รพ.แพร่'], 'จากสถานที่อื่นแก้เป็นโรงพยาบาลในรายการได้')
 console.log('PASS staff amendment keeps/edits/changes the place, change-hospital refuses the placeholder target')

 // 9) ปิดช่องอื่นๆ ในตั้งค่า = ไม่รับคำขอใหม่ที่ใช้ช่องนี้ (คำขอเดิมไม่ถูกลบ)
 await actor(admin)
 await rpc('patient_booking_save_settings', [tenant, await revisionOfSettings(), { ...configured, routes: [configured.routes[0]] }])
 await actor(citizen)
 await fails(() => rpc('patient_booking_submit', [tenant, randomUUID(), booking('closed', { route_id: '__other__', other_place: 'วัดหลังปิดช่อง', appointment_at: at('14:00', day2) })]), /กรุณาเลือกโรงพยาบาลและพื้นที่/)
 await db.exec('RESET ROLE')
 check((await row("SELECT count(*)::int n FROM public.patient_bookings WHERE route_id='__other__' OR route_label='อื่นๆ (พิมพ์ชื่อสถานที่เอง)'")).n >= 3, true, 'ปิดช่องแล้วคำขอเดิมยังอยู่')
 console.log(`All other-place checks passed (${checks} checks).`)
} finally {
 await db.close()
}
