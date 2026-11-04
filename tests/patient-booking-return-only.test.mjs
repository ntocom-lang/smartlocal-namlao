// PGlite only. No .env, project client, real accounts or network access.
// รถรับ-ส่งผู้ป่วย "รับกลับอย่างเดียว" (20261104100000/100100) — เจ้าของระบบสั่ง 2569-11-04:
// ผู้ป่วยนอนโรงพยาบาลอยู่ ต้องการรถเฉพาะขากลับ (ก) ร่วมกลับกับรถที่ออกไปส่งผู้ป่วยวันนั้น (ข) ให้รถไปรับโดยเฉพาะ
// เทสต์นี้ยืนยัน: ① เที่ยวที่ไม่มี return_only ได้แผนเหมือนเดิมทุกค่า ② เวลานัด = เวลารับกลับเสมอ ③ เที่ยวเดี่ยว/ร่วมเที่ยวไป-กลับ/ร่วมเที่ยวไปอย่างเดียว
// ④ คนขับกดจบแล้วทุกคำขอจบ ⑤ ชุมชนไม่รับค่านี้ ⑥ ด่านตรวจ md5 ทำงานและไม่เขียนข้อมูลเดิมทับ
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, id, baseBooking } = await import('./patient-booking-db.test.mjs')
const citizen2 = id(14)
const read = f => readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const CHAIN = ['20260927190000_patient_booking_move_into_trip.sql','20260928120000_patient_booking_multiwave.sql',
 '20260929100000_patient_booking_update_pickup.sql','20260929110000_patient_booking_change_hospital.sql',
 '20260926125325_patient_booking_staff_work_badge.sql','20260929130000_patient_booking_driver_cover.sql',
 '20260930110000_patient_booking_duplicate_shared_trip.sql','20261001100000_patient_booking_history.sql',
 '20261002090000_patient_booking_period_report.sql','20261002130000_patient_booking_letter_per_booking_columns.sql',
 '20261002130100_patient_booking_letter_per_booking_rpc.sql','20261003120000_patient_booking_community_rules_rpc.sql',
 '20261003130000_patient_booking_community_constraints_retention.sql','20261003130100_patient_booking_community_scheduler_rpc.sql',
 '20261003130200_patient_booking_community_projections_rpc.sql','20261003130300_patient_booking_community_reports_rpc.sql',
 '20261003130400_patient_booking_community_intake_rpc.sql','20261003150000_patient_booking_service_views_v2.sql',
 '20261003150100_patient_booking_legacy_client_gate.sql','20261007150000_patient_booking_destination_zone.sql',
 '20261007170000_patient_booking_other_place.sql','20261008100000_patient_booking_day_odometer_table.sql',
 '20261008100100_patient_booking_day_odometer_backfill.sql','20261008100200_patient_booking_day_odometer_rpc.sql',
 '20261010100000_patient_booking_release_wait_gap.sql','20261010100100_patient_booking_release_wait_gap_backfill.sql',
 '20261011120000_patient_booking_manual_settings_rpc.sql','20261011120100_patient_booking_manual_scheduler_rpc.sql',
 '20261011120200_patient_booking_manual_workflow_rpc.sql','20261020150000_patient_booking_community_other_place.sql']
const CONSTRAINT = '20261104100000_patient_booking_return_only_constraint.sql'
const PLAN = '20261104100100_patient_booking_return_only_plan.sql'
let checks = 0
const check = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const ok = (value, label) => { assert.ok(value, label); checks++ }
const fails = async (job, pattern) => { await assert.rejects(job, pattern); checks++ }
const asOwner = async job => {
  const who = (await db.query('SELECT current_user AS u')).rows[0].u
  await db.exec('RESET ROLE')
  try { return await job() } finally { if (['anon', 'authenticated'].includes(who)) await db.exec(`SET ROLE ${who}`) }
}
const row = async (sql, args = []) => asOwner(async () => (await db.query(sql, args)).rows[0])
const booking = bid => row('SELECT * FROM public.patient_bookings WHERE id=$1', [bid])
const trip = tid => row('SELECT * FROM public.patient_booking_trips WHERE id=$1', [tid])
const ms = value => Date.parse(value)
const dayAt = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const at = (time, d) => `${d}T${time}:00+07:00`
const phones = (() => { let n = 0; return () => `08006${String(++n).padStart(5, '0')}` })()
const snapshot = async () => asOwner(async () => (await db.query(`SELECT jsonb_build_object(
 'bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.patient_bookings b),
 'trips',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.patient_booking_trips t)) AS v`)).rows[0].v)
const fnState = async () => asOwner(async () => (await db.query(`SELECT oid::regprocedure::text AS identity,proacl::text AS acl,prosecdef,proconfig,provolatile
 FROM pg_proc WHERE oid='public.ptb_plan(uuid,uuid[],text)'::regprocedure`)).rows)
const planMd5 = async () => asOwner(async () => (await db.query(`SELECT md5(replace(prosrc,chr(13),'')) AS m FROM pg_proc WHERE oid='public.ptb_plan(uuid,uuid[],text)'::regprocedure`)).rows[0].m)

await db.exec('RESET ROLE')
for (const f of CHAIN) await db.exec(await read(f))

// ── ตั้งค่า: รถ 4 ที่นั่ง · โรงพยาบาล A/B กลุ่มปลายทางเดียวกัน · เปิดกฎชุมชน (ใช้ทดสอบว่าชุมชนไม่รับค่าใหม่) ──
await actor(admin)
const currentSettings = await row('SELECT * FROM public.patient_booking_settings WHERE municipality_id=$1', [tenant])
await rpc('patient_booking_save_settings', [tenant, currentSettings.revision, { ...settings, seats: 4, wheelchairs: 1, stretchers: 1,
  routes: [{ id: 'a', label: 'TEST โรงพยาบาล A', zone: 'TEST เมือง' }, { id: 'b', label: 'TEST โรงพยาบาล B', zone: 'TEST เมือง' }, { id: '__other__', label: 'อื่นๆ' }] }])
const communityRules = await row('SELECT revision FROM public.patient_booking_community_rules WHERE municipality_id=$1', [tenant])
await rpc('patient_booking_save_community_rules', [tenant, communityRules?.revision ?? 1, { enabled: true, window_start: 360, window_end: 1200,
  places: [{ id: 'temple', label: 'TEST วัด' }], activities: [{ code: 'meet', label: 'TEST กิจกรรม' }], rules_reference: 'TEST ข้อบังคับสมมติ' }])

const [day1, day2, day3] = [dayAt(75), dayAt(76), dayAt(77)]
const submit = async (who, name, d, patch = {}) => {
  const bid = randomUUID()
  await actor(who)
  await rpc('patient_booking_submit', [tenant, bid, { ...baseBooking, patient_name: `TEST ${name}`, phone: phones(), companions: 0,
    appointment_at: at('12:00', d), return_at: at('15:30', d), ...patch }])
  return bid
}
const submitJoin = async (who, name, d, tripId, patch = {}) => {
  const bid = randomUUID()
  await actor(who)
  await rpc('patient_booking_submit_join', [tenant, bid, tripId, { ...baseBooking, patient_name: `TEST ${name}`, phone: phones(), companions: 0,
    appointment_at: at('12:00', d), return_at: at('15:30', d), ...patch }, false])
  return bid
}
const returnOnly = (time, d) => ({ return_mode: 'return_only', appointment_at: at(time, d), return_at: at(time, d) })
const confirm = async bid => {
  await actor(coordinator)
  const plan = await rpc('patient_booking_preview', [tenant, [bid], ''])
  assert.deepEqual(plan.errors, [])
  const tid = randomUUID()
  await rpc('patient_booking_confirm', [tenant, tid, [bid], plan, ''])
  return tid
}
const step = async (tid, action) => {
  const t = await trip(tid)
  await actor(driver)
  await rpc('patient_booking_action', [tenant, randomUUID(), tid, t.revision, action, ''])
  return trip(tid)
}
const previewOf = async idsOf => { await actor(coordinator); return rpc('patient_booking_preview', [tenant, idsOf, '']) }

// ── ① เตรียมคำขอเดิมหลายแบบ แล้วเก็บแผนก่อน apply (เที่ยวที่ไม่มี return_only ต้องได้แผนเหมือนเดิมทุกค่า) ──
const n1 = await submit(citizen, 'N1 รอรับกลับ', day1, { return_mode: 'wait', appointment_at: at('12:00', day1), return_at: at('15:30', day1) })
const n2 = await submit(citizen, 'N2 ไปอย่างเดียว', day1, { return_mode: 'one_way', return_at: null, appointment_at: at('12:10', day1) })
const n3 = await submit(citizen, 'N3 คู่ ก', day1, { return_mode: 'later', appointment_at: at('11:00', day1), return_at: at('15:00', day1) })
const n4 = await submit(citizen2, 'N4 คู่ ข ต่างโรงพยาบาล', day1, { return_mode: 'later', route_id: 'b', appointment_at: at('11:20', day1), return_at: at('15:10', day1) })
const n5 = await submit(citizen2, 'N5 ห่างหนึ่งชั่วโมง', day1, { return_mode: 'later', appointment_at: at('09:30', day1), return_at: at('13:00', day1) })
const combos = [[n1], [n2], [n3, n4], [n1, n2], [n3, n1], [n3, n5], [n1, n3, n4]]
const plansBefore = []
for (const combo of combos) plansBefore.push(await previewOf(combo))
ok(plansBefore.some(plan => plan.errors.length > 0) && plansBefore.some(plan => plan.errors.length === 0), 'ชุดตัวอย่างต้องมีทั้งแผนที่ผ่านและไม่ผ่าน')
const functionBefore = await fnState()
const dataBefore = await snapshot()

// ── ② ด่านตรวจ: ไฟล์ 2 ต้อง apply หลังไฟล์ 1 · ค่า md5 ในไฟล์ตรงกับฟังก์ชันจริงของสายการ apply ──
const planSql = await read(PLAN)
const guardMd5 = planSql.match(/DISTINCT FROM '([0-9a-f]{32})'/)?.[1]
check(await planMd5(), guardMd5, 'md5 ใน migration ต้องตรงกับ ptb_plan ที่เจ้าของระบบใช้อยู่ (นิยามล่าสุด 20261020150000)')
await asOwner(async () => {
  await db.exec('BEGIN')
  await assert.rejects(() => db.exec(planSql), /ต้อง apply 20261104100000 ก่อน/); checks++
  await db.exec('ROLLBACK')
})
// ไฟล์ 1 ใช้จริงก่อน (ไฟล์มี COMMIT ในตัว จึงทดลองในธุรกรรมครอบไม่ได้) แล้วค่อยทดลองฟังก์ชันที่เพี้ยนกับไฟล์ 2
await asOwner(async () => { await db.exec(await read(CONSTRAINT)) })
await asOwner(async () => {
  await db.exec('BEGIN')
  await db.exec("CREATE OR REPLACE FUNCTION public.ptb_plan(p_muni uuid,p_ids uuid[],p_helper text DEFAULT '') RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;")
  await assert.rejects(() => db.exec(planSql), /Function drift: ptb_plan/); checks++
  await db.exec('ROLLBACK')
})
check(await planMd5(), guardMd5, 'ทดลองแล้วย้อนกลับ ต้องไม่ค้างอะไร')

await asOwner(async () => { await db.exec(planSql) })
check(await snapshot(), dataBefore, 'migration ต้องไม่เขียนคำขอหรือเที่ยวเดิมทับ')
const functionAfter = await fnState()
check(functionAfter.map(f => [f.identity, f.acl, f.prosecdef, f.proconfig, f.provolatile]), functionBefore.map(f => [f.identity, f.acl, f.prosecdef, f.proconfig, f.provolatile]), 'สิทธิ์และคุณสมบัติของ ptb_plan ต้องคงเดิม')
const plansAfter = []
for (const combo of combos) plansAfter.push(await previewOf(combo))
check(plansAfter, plansBefore, 'เที่ยวที่ไม่มี return_only ต้องได้แผนเหมือนเดิมทุกค่า')
ok(!(await row("SELECT has_function_privilege('authenticated','public.ptb_return_only_time()','EXECUTE') AS v")).v, 'ฟังก์ชันตัวกระตุ้นต้องไม่เปิดให้ผู้ใช้เรียกตรง')
// apply ซ้ำ = ถูกปฏิเสธ (ไฟล์มี BEGIN ในตัว ปฏิเสธแล้วธุรกรรมค้างสถานะผิดพลาด ต้อง ROLLBACK เอง)
await asOwner(async () => {
  try { await assert.rejects(() => db.exec(planSql), /Function drift: ptb_plan/); checks++ }
  finally { await db.exec('ROLLBACK') }
})

// ── ③ เวลานัดเท่าเวลารับกลับ · ต้องมีเวลารับกลับ ──
const ro1 = await submit(citizen, 'RO1 รถไปรับ', day2, { ...returnOnly('14:00', day2), appointment_at: at('09:00', day2) })
const stored = await booking(ro1)
check(stored.return_mode, 'return_only'); check(ms(stored.return_at), ms(at('14:00', day2)))
check(ms(stored.appointment_at), ms(at('14:00', day2)), 'ฟอร์มส่งเวลานัดอะไรมาก็ตาม เวลานัดต้องเท่าเวลารับกลับ')
await fails(() => submit(citizen, 'RO0 ไม่มีเวลา', day2, { return_mode: 'return_only', return_at: null }), /รับกลับอย่างเดียวต้องระบุเวลารับกลับ/)
await fails(() => asOwner(() => db.query('UPDATE public.patient_bookings SET return_at=NULL WHERE id=$1', [ro1])), /รับกลับอย่างเดียวต้องระบุเวลารับกลับ/)
await asOwner(async () => {
  await db.query('UPDATE public.patient_bookings SET return_at=$2 WHERE id=$1', [ro1, at('14:30', day2)])
  await db.query('UPDATE public.patient_bookings SET return_at=$2 WHERE id=$1', [ro1, at('14:00', day2)])
})
check(ms((await booking(ro1)).appointment_at), ms(at('14:00', day2)), 'แก้เวลารับกลับ เวลานัดต้องตามทุกครั้ง')
// CHECK เป็นด่านที่สอง (ตัวกระตุ้นปิดอยู่ก็ยังบันทึกไม่ได้)
await asOwner(async () => {
  await db.exec('ALTER TABLE public.patient_bookings DISABLE TRIGGER ptb_return_only_time')
  try { await assert.rejects(() => db.query('UPDATE public.patient_bookings SET return_at=NULL WHERE id=$1', [ro1]), /patient_bookings_return_only_has_time/); checks++ }
  finally { await db.exec('ALTER TABLE public.patient_bookings ENABLE TRIGGER ptb_return_only_time') }
})
const oneWayStored = await booking(n2)
check(oneWayStored.return_at, null, 'ไปอย่างเดียวยังไม่มีเวลารับกลับเหมือนเดิม')

// ── ④ เที่ยวเดี่ยว: รถไปรับที่โรงพยาบาลโดยเฉพาะ ──
const p1 = await previewOf([ro1])
check(p1.errors, []); check(p1.return_mode, 'later'); check(p1.outbound_waves, [], 'ไม่มีขาไป ต้องไม่มีรอบไป')
check(p1.return_waves.length, 1); check(p1.return_waves[0].passengers, 1); check(p1.multiwave, false); check(p1.seats, 1)
check(ms(p1.appointment_at), ms(at('14:00', day2)))
await actor(coordinator)
const t1 = randomUUID()
await rpc('patient_booking_confirm', [tenant, t1, [ro1], p1, ''])
await rpc('patient_booking_confirm', [tenant, t1, [ro1], p1, ''])
check((await booking(ro1)).status, 'confirmed'); check((await booking(ro1)).trip_id, t1)
check((await trip(t1)).plan.return_mode, 'later')
await actor(null)
const calendar = await rpc('patient_booking_calendar', [tenant, day2, day2])
const calTrip = calendar.days[0].trips.find(t => t.id === t1)
ok(calTrip, 'ปฏิทินสาธารณะต้องเห็นเที่ยวของรับกลับอย่างเดียว'); check(calTrip.return_mode, 'later'); ok(calTrip.joinable, 'เที่ยวเดี่ยวที่นั่งว่างร่วมกลับได้')
check(JSON.stringify(calendar).includes('RO1'), false, 'ปฏิทินสาธารณะต้องไม่มีชื่อผู้ป่วย')
await actor(citizen)
const mine = await rpc('patient_booking_mine_v2', [tenant])
check(mine.bookings.find(b => b.id === ro1)?.return_mode, 'return_only')
await actor(coordinator)
check((await rpc('patient_booking_workspace_v2', [tenant])).bookings.find(b => b.id === ro1)?.return_mode, 'return_only')
// คนขับ 2 ปุ่ม: ออกรถ → กลับแล้ว (จบเที่ยว) แล้วคำขอจบทั้งคู่
check((await step(t1, 'trip_next')).state, 'outbound')
check((await step(t1, 'trip_finish')).state, 'completed')
check([(await booking(ro1)).status, (await booking(ro1)).passenger_step], ['completed', 4])

// ── ⑤ ร่วมกลับกับเที่ยวไป–กลับ (ผู้ขอกดขอร่วมเอง → เจ้าหน้าที่ยืนยัน) ──
const a = await submit(citizen, 'A ไปกลับ', day3, { return_mode: 'wait', appointment_at: at('11:00', day3), return_at: at('15:30', day3) })
const tA = await confirm(a)
const r2 = await submitJoin(citizen2, 'R2 ร่วมกลับ', day3, tA, returnOnly('15:30', day3))
check((await booking(r2)).requested_trip_id, tA)
await actor(coordinator)
const joinPlan = await rpc('patient_booking_preview_join', [tenant, r2])
check(joinPlan.errors, []); check(joinPlan.return_mode, 'wait'); check(joinPlan.outbound_waves.length, 1, 'รอบไปมีแต่คนที่ไปด้วย')
check(joinPlan.return_waves.length, 1); check(joinPlan.return_waves[0].passengers, 2)
await rpc('patient_booking_confirm_join', [tenant, randomUUID(), r2, joinPlan])
check((await booking(r2)).trip_id, tA); check((await trip(tA)).booking_ids.includes(r2), true)

// ── ⑥ ร่วมกลับกับเที่ยวไปอย่างเดียว (รถไปส่งคนไปนอน แล้วรับผู้ป่วยอีกรายกลับมา) ──
const b = await submit(citizen, 'B ไปนอน', day3, { return_mode: 'one_way', return_at: null, appointment_at: at('09:30', day3) })
const tB = await confirm(b)
check((await trip(tB)).plan.return_mode, 'one_way')
const r3 = await submitJoin(citizen2, 'R3 กลับจากนอน', day3, tB, returnOnly('11:00', day3))
await actor(coordinator)
const oneWayJoin = await rpc('patient_booking_preview_join', [tenant, r3])
check(oneWayJoin.errors, []); check(oneWayJoin.return_mode, 'later', 'ไปอย่างเดียว + มีคนรับกลับ = รถต้องกลับมารับ')
check(oneWayJoin.outbound_waves.length, 1); check(oneWayJoin.return_waves.length, 1); check(oneWayJoin.return_waves[0].passengers, 1)
await rpc('patient_booking_confirm_join', [tenant, randomUUID(), r3, oneWayJoin])
check((await trip(tB)).plan.return_mode, 'later')
// เจ้าหน้าที่ย้ายคำขอรอยืนยันของคนที่สองเข้าเที่ยวเดียวกันเอง (ไม่ผ่านการขอร่วม)
const r4 = await submit(citizen2, 'R4 อีกคน', day3, returnOnly('11:30', day3))
await actor(coordinator)
const intoPlan = await rpc('patient_booking_preview_into_trip', [tenant, r4, tB])
check(intoPlan.errors, []); check(intoPlan.return_waves.length, 1); check(intoPlan.return_waves[0].passengers, 2, 'กลับห่างกัน 30 นาทีรวมเป็นรอบเดียว')
await rpc('patient_booking_confirm_into_trip', [tenant, randomUUID(), r4, tB, intoPlan])
check((await booking(r4)).trip_id, tB)
check((await step(tB, 'trip_next')).state, 'outbound')
check((await step(tB, 'trip_finish')).state, 'completed')
const finished = await asOwner(async () => (await db.query('SELECT id,status,passenger_step FROM public.patient_bookings WHERE trip_id=$1 ORDER BY id', [tB])).rows)
check(finished.length, 3); ok(finished.every(x => x.status === 'completed'), 'ทุกคำขอในเที่ยวจบพร้อมกัน')
check(finished.find(x => x.id === b).passenger_step, 2, 'ไปอย่างเดียวจบที่ขั้น 2 เหมือนเดิม')
check(finished.filter(x => x.id !== b).map(x => x.passenger_step), [4, 4])

// ── ⑦ ที่นั่ง: ขากลับว่างเมื่อรถไปส่งคนไปนอน (นับต่อรอบ) · เกินที่นั่งต้องถูกปฏิเสธ ──
const b2 = await submit(citizen, 'B2 ไปนอน 3 คน', dayAt(78), { return_mode: 'one_way', return_at: null, companions: 3, appointment_at: at('09:30', dayAt(78)) })
const tB2 = await confirm(b2)
const r5 = await submit(citizen2, 'R5 กลับ 4 คน', dayAt(78), { ...returnOnly('11:00', dayAt(78)), companions: 3 })
await actor(coordinator)
const seatPlan = await rpc('patient_booking_preview_into_trip', [tenant, r5, tB2])
check(seatPlan.errors, [], 'ขาไป 4 ที่นั่ง ขากลับอีก 4 ที่นั่ง ไม่ซ้อนกัน'); check(seatPlan.seats, 4)
const r6 = await submit(citizen2, 'R6 กลับ 3 คน', dayAt(78), { ...returnOnly('11:10', dayAt(78)), companions: 2 })
await actor(coordinator)
await rpc('patient_booking_confirm_into_trip', [tenant, randomUUID(), r5, tB2, seatPlan])
const fullPlan = await rpc('patient_booking_preview_into_trip', [tenant, r6, tB2])
ok(fullPlan.errors.includes('ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว'), 'รอบกลับเกินที่นั่งต้องถูกปฏิเสธ')

// ── ⑦b คำขอรับกลับที่เวลาเรียงก่อนคำขอไปของเที่ยว: โหมด/เส้นทางของเที่ยวต้องยังมาจากคำขอที่ไปด้วย ──
const day4 = dayAt(80)
const a3 = await submit(citizen, 'A3 ไปกลับ', day4, { return_mode: 'wait', appointment_at: at('09:30', day4), return_at: at('12:00', day4) })
const tA3 = await confirm(a3)
const r7 = await submitJoin(citizen2, 'R7 พร้อมก่อน', day4, tA3, returnOnly('09:00', day4))
await actor(coordinator)
const earlyJoin = await rpc('patient_booking_preview_join', [tenant, r7])
check(earlyJoin.errors, []); check(earlyJoin.return_mode, 'wait', 'โหมดเที่ยวมาจากคำขอที่ไปด้วย ไม่ใช่คำขอรับกลับที่เรียงมาก่อน')
check(ms(earlyJoin.appointment_at), ms(at('09:30', day4)), 'เวลานัดของเที่ยวคือเวลานัดของคำขอที่ไปด้วย')
check(earlyJoin.outbound_waves.length, 1); check(earlyJoin.return_waves.length, 2, 'รับกลับ 09:00 กับ 12:00 ห่างกันเกิน 30 นาที = 2 รอบกลับ')

// ── ⑧ ชุมชนไม่รับค่าใหม่ · รายงานรายเดือนยังคำนวณได้ ──
await actor(null)
const publicInfo = await rpc('patient_booking_info', [tenant])
await actor(citizen)
const communityPayload = patch => ({ requester_name: 'TEST ผู้ติดต่อ', phone: '0800000077', group_label: 'TEST กลุ่ม', party_size: 3, purpose_code: 'meet', route_id: 'temple',
  appointment_at: at('12:00', dayAt(79)), return_mode: 'wait', return_at: at('15:30', dayAt(79)), pickup: 'TEST จุดรับ', in_area: true, consent: true,
  consent_version: 'community-booking-v1', privacy_notice: publicInfo.community.privacy_notice, owner_name: publicInfo.owner_name, rules_version: publicInfo.community.rules_version, ...patch })
await fails(() => rpc('patient_booking_submit_community', [tenant, randomUUID(), communityPayload({ return_mode: 'return_only' }), false]), /รูปแบบรับกลับไม่ถูกต้อง/)
await rpc('patient_booking_submit_community', [tenant, randomUUID(), communityPayload({}), false])
await actor(admin)
const report = await rpc('patient_booking_period_report_v2', [tenant, day2, day3, null])
ok(Array.isArray(report.trips) && report.trips.some(t => t.trip_id === t1), 'รายงานต้องนับเที่ยวรับกลับอย่างเดียว')

console.log(`PASS return-only: ${checks} checks (แผนเดิมเท่าเดิม, เวลานัด=เวลารับกลับ, เที่ยวเดี่ยว, ร่วมเที่ยวไป–กลับ/ไปอย่างเดียว, ที่นั่งต่อรอบ, ชุมชนปฏิเสธ, ด่าน md5, ไม่เขียนข้อมูลเดิมทับ)`)
if (!process.env.PATIENT_UI_QA_KEEP) await db.close()
