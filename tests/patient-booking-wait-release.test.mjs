// PGlite only. No .env, project client, real accounts or network access.
// ปล่อยรถว่างช่วงรอ (20261010100000/100100) — เจ้าของระบบเลือกเฟส 1 วันที่ 2569-10-10:
// "ให้รถรอรับกลับ" กันรถต่อเนื่องเฉพาะเมื่ออยู่สั้นกว่ารถวิ่งไปกลับ · อยู่นานกว่านั้นกันเฉพาะช่วงไปกับช่วงกลับ
// เคสที่เป็นต้นเรื่อง: ทุ่งแค้ว เที่ยวฟอกไตรอรับกลับ 2 คน กันรถ 10:30–19:00 (นัด 12:00 รับกลับ 17:30 ขา 45 นาที)
// ตัวเลขเวลาในเทสต์ตั้งจากสูตรของ ptb_plan: ก่อนนัด = ขา + เผื่อ + ขึ้นรถ·คน · หลังนัด = ขึ้นรถ + ขา · ก่อนรับกลับ = ขา + เผื่อ · หลังรับกลับ = ขึ้นรถ·คน + ขา + เผื่อ
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, id, baseBooking } = await import('./patient-booking-db.test.mjs')
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
const FUNCTIONS = '20261010100000_patient_booking_release_wait_gap.sql'
const BACKFILL = '20261010100100_patient_booking_release_wait_gap_backfill.sql'
const REPLACED = ['public.ptb_plan(uuid,uuid[],text)', 'public.patient_booking_action(uuid,uuid,uuid,integer,text,text)']
const OVERLAP = 'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว'
let checks = 0
const check = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const fails = async (job, pattern) => { await assert.rejects(job, pattern); checks++ }
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const asOwner = async job => {
  const who = (await db.query('SELECT current_user AS u')).rows[0].u
  await db.exec('RESET ROLE')
  try { return await job() } finally { if (['anon', 'authenticated'].includes(who)) await db.exec(`SET ROLE ${who}`) }
}
const ms = value => Date.parse(value)
// วันทำการถัดไปเรื่อย ๆ (ไม่ซ้ำกัน) เริ่มที่ +320 วัน อยู่ในช่วง 12 เดือนที่จองได้ — แต่ละฉากใช้คนละวัน เที่ยวของฉากหนึ่งจะไม่ชนอีกฉาก
const weekday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 320); return () => { do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay())); return d.toISOString().slice(0, 10) } })()
const dayAt = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const at = (time, day) => `${day}T${time}:00+07:00`
const span = (from, to, day) => [ms(at(from, day)), ms(at(to, day))]
const blocksOf = plan => plan.blocks.map(b => [ms(b.start), ms(b.end)])
const settingsRevision = async () => asOwner(async () => (await row('SELECT revision FROM public.patient_booking_settings WHERE municipality_id=$1', [tenant])).revision)
const fnState = async () => (await db.query(`SELECT oid::regprocedure::text AS identity,proacl::text AS acl,prosecdef,proconfig,provolatile FROM pg_proc
 WHERE oid IN (${REPLACED.map(f => `'${f}'::regprocedure`).join(',')}) ORDER BY 1`)).rows
const phones = (() => { let n = 0; return () => `08005${String(++n).padStart(5, '0')}` })()
const submit = async (who, name, patch) => {
  const bid = randomUUID()
  await actor(who)
  await rpc('patient_booking_submit', [tenant, bid, { ...baseBooking, patient_name: `TEST รอรับกลับ ${name}`, phone: phones(), companions: 0, ...patch }])
  return bid
}
// เที่ยวจำลองใส่ตรง (ไม่ผ่าน ptb_plan) ใช้ทดสอบการคำนวณช่วงกันรถใหม่และด่านคนขับ
const insertTrip = async ({ day, state = 'confirmed', mode = 'wait', blocks, out, back, service, multiwave = false, who = driver }) => {
  const tid = randomUUID()
  const plan = { date: day, route_id: 'a', route_label: 'TEST เที่ยวจำลอง', return_mode: mode, pickup_at: blocks[0].start, multiwave, blocks,
    ...(out ? { outbound_waves: out } : {}), ...(back ? { return_waves: back } : {}), ...(service ? { service_type: service } : {}) }
  await asOwner(() => db.query(`INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,state,confirmed_by) VALUES($1,$2,$3,'{}',$4,$5,$6)`,
    [tid, tenant, who, JSON.stringify(plan), state, coordinator]))
  return tid
}
const tripRow = async tid => asOwner(async () => row('SELECT state,revision,schedule_revision,plan,estimated_pickup_at FROM public.patient_booking_trips WHERE id=$1', [tid]))

try {
 await db.exec('RESET ROLE')
 for (const f of before) await db.exec(await read(f))
 await actor(admin)
 await rpc('patient_booking_save_settings', [tenant, await settingsRevision(), { ...settings, seats: 10, office_start: 450, office_end: 1170,
  routes: [{ id: 'a', label: 'TEST โรงพยาบาล ก (45 นาที)', minutes: 45 }, { id: 'b', label: 'TEST โรงพยาบาล ข (20 นาที)', minutes: 20 }] }])

 // ── 1) แผนเดิมก่อน migration (ฐานเก่า) — ใช้เทียบหลังแก้ ─────────────────────────────────────
 const P = weekday()
 const ids = {}
 const plans = [
  ['waitShort', 'a', 'wait', '11:45'], ['waitEdge', 'a', 'wait', '12:00'], ['waitGap', 'a', 'wait', '12:15'], ['waitLong', 'a', 'wait', '16:00'],
  ['laterLong', 'a', 'later', '16:00'], ['laterShort', 'a', 'later', '11:00'], ['oneWay', 'a', 'one_way', null], ['waitLongB', 'b', 'wait', '16:00'],
 ]
 for (const [key, route, mode, back] of plans) ids[key] = [await submit(citizen, key, { route_id: route, return_mode: mode, appointment_at: at('10:00', P), return_at: back ? at(back, P) : null })]
 // ผู้ร่วมเที่ยว 2 คน: คนหนึ่งกลับ 11:30 (ขากลับทับช่วงขาไป) อีกคนกลับ 16:00 — ใต้ช่วงต่อเนื่องเดิมไม่เคยถูกปฏิเสธ
 ids.pairEarly = [await submit(citizen, 'pair1', { route_id: 'a', return_mode: 'wait', appointment_at: at('10:00', P), return_at: at('16:00', P) }),
  await submit(id(14), 'pair2', { route_id: 'a', return_mode: 'wait', appointment_at: at('10:00', P), return_at: at('11:30', P) })]
 await actor(coordinator)
 const old = {}
 for (const [key, list] of Object.entries(ids)) { old[key] = await rpc('patient_booking_preview', [tenant, list, '']); check(old[key].errors, [], `${key} ก่อนแก้ไม่มีข้อผิดพลาด`) }
 check(blocksOf(old.waitShort), [span('08:45', '13:00', P)], 'อยู่สั้น: ช่วงต่อเนื่อง')
 check(blocksOf(old.waitLong), [span('08:45', '17:15', P)], 'ฐานเก่า: อยู่นานก็กันต่อเนื่องทั้งช่วง')
 check(blocksOf(old.waitLongB), [span('09:10', '16:50', P)])
 check(blocksOf(old.laterLong), [span('08:45', '11:00', P), span('15:00', '17:15', P)], 'มารับภายหลังแยกช่วงอยู่แล้ว')
 check(blocksOf(old.pairEarly), [span('08:30', '17:15', P)])

 // ── 2) ฐานเก่ากับเที่ยวยืนยันแล้ว: เที่ยวที่ 2 ชนช่วงต่อเนื่อง ──────────────────────────────────
 const Q = weekday()
 const tripX = id(72001)
 const x = await submit(citizen, 'X', { route_id: 'a', return_mode: 'wait', appointment_at: at('10:00', Q), return_at: at('16:00', Q) })
 await actor(coordinator)
 await rpc('patient_booking_confirm', [tenant, tripX, [x], await rpc('patient_booking_preview', [tenant, [x], '']), ''])
 const y = await submit(id(14), 'Y', { route_id: 'b', return_mode: 'wait', appointment_at: at('12:30', Q), return_at: at('13:00', Q) })
 const z = await submit(citizen, 'Z', { route_id: 'b', return_mode: 'wait', appointment_at: at('10:30', Q), return_at: at('11:00', Q) })
 await actor(coordinator)
 check((await rpc('patient_booking_preview', [tenant, [y], ''])).errors, [OVERLAP], 'ฐานเก่า: จองรอบที่ 2 กลางวันไม่ได้')
 // เคสจริงฟอกไต 2 คน (zone test): รถ 10:30–19:00
 const R = weekday()
 const tripDialysis = id(72002)
 const dialysis = [await submit(citizen, 'ฟอกไต1', { route_id: 'a', return_mode: 'wait', appointment_at: at('12:00', R), return_at: at('17:30', R) }),
  await submit(id(14), 'ฟอกไต2', { route_id: 'a', return_mode: 'wait', appointment_at: at('12:00', R), return_at: at('17:30', R) })]
 await actor(coordinator)
 const dialysisPlan = await rpc('patient_booking_preview', [tenant, dialysis, ''])
 check(blocksOf(dialysisPlan), [span('10:30', '19:00', R)], 'เคสจริง: ฐานเก่ากันรถ 10:30–19:00')
 await rpc('patient_booking_confirm', [tenant, tripDialysis, dialysis, dialysisPlan, ''])

 // ── 3) เที่ยวจำลองสำหรับทดสอบย้ายข้อมูล ────────────────────────────────────────────────────
 const S = weekday(), past = dayAt(-3)
 const wave = (day, out, back) => ({
  out: [{ appointment_start: at('10:00', day), appointment_end: at('10:00', day), pickup_at: at(out[0], day), end_at: at(out[1], day), passengers: 1 }],
  back: [{ return_start: at(back[2], day), return_end: at(back[2], day), depart_at: at(back[0], day), end_at: at(back[1], day), passengers: 1 }] })
 const longWait = day => ({ ...wave(day, ['08:45', '11:00'], ['15:00', '17:15', '16:00']), blocks: [{ start: at('08:45', day), end: at('17:15', day) }] })
 const shortWait = day => ({ ...wave(day, ['08:45', '11:00'], ['10:45', '13:00', '11:45']), blocks: [{ start: at('08:45', day), end: at('13:00', day) }] })
 const m = {}
 m.long = await insertTrip({ day: S, ...longWait(S) })
 m.short = await insertTrip({ day: S, ...shortWait(S) })
 m.later = await insertTrip({ day: S, mode: 'later', ...shortWait(S) })
 m.outbound = await insertTrip({ day: S, state: 'outbound', ...longWait(S) })
 m.past = await insertTrip({ day: past, ...longWait(past) })
 m.community = await insertTrip({ day: S, service: 'community', ...longWait(S) })
 m.multiwave = await insertTrip({ day: S, multiwave: true, ...longWait(S) })
 m.narrow = await insertTrip({ day: S, ...wave(S, ['08:45', '11:00'], ['15:00', '17:15', '16:00']), blocks: [{ start: at('09:00', S), end: at('17:00', S) }] })
 m.split = await insertTrip({ day: S, ...wave(S, ['08:45', '11:00'], ['15:00', '17:15', '16:00']), blocks: [{ start: at('08:45', S), end: at('11:00', S) }, { start: at('15:00', S), end: at('17:15', S) }] })
 await asOwner(() => db.query("UPDATE public.patient_booking_trips SET estimated_pickup_at=$2::timestamptz WHERE id=$1", [m.long, at('09:00', S)]))
 const snapshot = {}
 for (const [key, tid] of Object.entries({ ...m, X: tripX, dialysis: tripDialysis })) snapshot[key] = await tripRow(tid)
 // community: แผน "รอรับกลับ" ของงานชุมชนต้องเหมือนเดิมทุกค่า (นโยบายแยกจากงานผู้ป่วย)
 const C = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 330); while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
 await actor(admin)
 await rpc('patient_booking_save_community_rules', [tenant, 1, { enabled: true, window_start: 360, window_end: 1200, places: [{ id: 'test-temple', label: 'TEST วัด', minutes: 60 }],
  activities: [{ code: 'test-activity', label: 'TEST กิจกรรมชุมชน' }], rules_reference: 'TEST ข้อบังคับจำลองเท่านั้น' }])
 const info = await rpc('patient_booking_info', [tenant])
 const communityId = randomUUID()
 await actor(citizen)
 await rpc('patient_booking_submit_community', [tenant, communityId, { requester_name: 'TEST ผู้ติดต่อ', phone: '0800099000', pickup: 'TEST จุดรับชุมชน', in_area: true, route_id: 'test-temple',
  appointment_at: at('10:00', C), return_at: at('19:00', C), return_mode: 'wait', group_label: 'TEST กลุ่มชุมชน', party_size: 3, purpose_code: 'test-activity',
  rules_version: info.community.rules_version, consent: true, consent_version: 'community-booking-v1', privacy_notice: info.community.privacy_notice, owner_name: info.owner_name }, false])
 await actor(coordinator)
 const communityOld = await rpc('patient_booking_preview', [tenant, [communityId], ''])
 check(communityOld.errors, [], 'งานชุมชนก่อนแก้ไม่มีข้อผิดพลาด')
 check(communityOld.blocks.length, 1, 'งานชุมชนรอรับกลับ = ช่วงต่อเนื่อง')
 console.log('PASS old behaviour captured: continuous wait blocks, second round refused, real dialysis case 10:30–19:00')

 // ── 4) ตัวกัน drift ก่อนเขียนทับ (ทั้งสองฟังก์ชัน) + ติดตั้งฟังก์ชัน ───────────────────────────
 await db.exec('RESET ROLE')
 const stateBefore = await fnState()
 for (const identity of REPLACED) {
  const definition = (await row('SELECT pg_get_functiondef($1::regprocedure) AS d', [identity])).d
  await db.exec(definition.replace(/AS (\$\w*\$)/, 'AS $1\n-- deliberate local drift'))
  await fails(async () => db.exec(await read(FUNCTIONS)), /Function drift/)
  await db.exec('ROLLBACK')
  await db.exec(definition)
 }
 await fails(async () => db.exec(await read(BACKFILL)), /ต้อง apply 20261010100000 ก่อน/)
 await db.exec('ROLLBACK')
 await db.exec(await read(FUNCTIONS))
 const stateAfter = await fnState()
 check(stateAfter, stateBefore, 'สิทธิ์ SECURITY DEFINER search_path และ volatility ของ 2 ฟังก์ชันคงเดิม')
 await fails(async () => db.exec(await read(FUNCTIONS)), /Function drift/)
 await db.exec('ROLLBACK')
 const helper = await row(`SELECT prosecdef,proconfig,provolatile,has_function_privilege('anon','public.ptb_merge_blocks(jsonb)','execute') AS anon_exec,
  has_function_privilege('authenticated','public.ptb_merge_blocks(jsonb)','execute') AS auth_exec FROM pg_proc WHERE oid='public.ptb_merge_blocks(jsonb)'::regprocedure`)
 check([helper.anon_exec, helper.auth_exec, helper.proconfig, helper.provolatile], [false, false, ['search_path=""'], 's'], 'ฟังก์ชันช่วยเรียกจากฝั่งผู้ใช้ไม่ได้')
 for (const who of [citizen, coordinator]) { await actor(who); await fails(() => rpc('ptb_merge_blocks', [JSON.stringify([])]), /permission denied/) }
 await actor(null); await fails(() => rpc('ptb_merge_blocks', [JSON.stringify([])]), /permission denied/)
 console.log('PASS drift guards on both replaced functions, helper locked from users, function attributes kept')

 // ── 5) ptb_merge_blocks ───────────────────────────────────────────────────────────────────
 await db.exec('RESET ROLE')
 const t = (h, mnt = 0) => new Date(Date.UTC(2030, 0, 1, h, mnt)).toISOString()
 const blk = (a, b) => ({ start: t(...a), end: t(...b) })
 const merge = async list => (await row('SELECT public.ptb_merge_blocks($1::jsonb) AS v', [JSON.stringify(list)])).v.map(b => [ms(b.start), ms(b.end)])
 const pair = (a, b) => [ms(t(...a)), ms(t(...b))]
 check(await merge([]), [])
 check((await row('SELECT public.ptb_merge_blocks(NULL) AS v')).v, [])
 check((await row(`SELECT public.ptb_merge_blocks('{"a":1}'::jsonb) AS v`)).v, [])
 check(await merge([blk([8], [9])]), [pair([8], [9])], 'ช่วงเดียว')
 check(await merge([blk([8], [9]), blk([10], [11])]), [pair([8], [9]), pair([10], [11])], 'ห่างกัน = แยก')
 check(await merge([blk([8], [9]), blk([9], [10])]), [pair([8], [10])], 'ติดกันพอดี = รวม (รถไม่มีเวลากลับฐาน)')
 check(await merge([blk([8], [10]), blk([9], [11])]), [pair([8], [11])], 'ทับกัน = รวม')
 check(await merge([blk([8], [12]), blk([9], [10])]), [pair([8], [12])], 'ช่วงที่อยู่ในช่วงอื่น = ไม่ขยาย')
 check(await merge([blk([15], [16]), blk([8], [9]), blk([8, 30], [10])]), [pair([8], [10]), pair([15], [16])], 'สลับลำดับ = เรียงก่อนรวม')
 check(await merge([blk([8], [9]), blk([8], [9, 30]), blk([8], [8, 45])]), [pair([8], [9, 30])], 'เริ่มเท่ากัน')
 console.log('PASS ptb_merge_blocks: empty, null, single, apart, touching, overlap, nested, unsorted, same start')

 // ── 6) migration ฟังก์ชัน: แผนใหม่ต้องเหมือนเดิมทุกค่า ยกเว้น "รอรับกลับที่อยู่นาน" ──────────────
 await actor(coordinator)
 const sameAsOld = ['waitShort', 'waitEdge', 'laterLong', 'laterShort', 'oneWay']
 for (const key of sameAsOld) check(await rpc('patient_booking_preview', [tenant, ids[key], '']), old[key], `${key} ต้องเหมือนเดิมทุกค่า`)
 const released = { waitGap: [span('08:45', '11:00', P), span('11:15', '13:30', P)], waitLong: [span('08:45', '11:00', P), span('15:00', '17:15', P)],
  waitLongB: [span('09:10', '10:35', P), span('15:25', '16:50', P)], pairEarly: [span('08:30', '12:45', P), span('15:00', '17:15', P)] }
 for (const [key, expected] of Object.entries(released)) {
  const after = await rpc('patient_booking_preview', [tenant, ids[key], ''])
  check(after.errors, [], `${key} ไม่เกิดข้อผิดพลาดใหม่`)
  check(blocksOf(after), expected, `${key}: ช่วงกันรถใหม่`)
  check({ ...after, blocks: old[key].blocks }, old[key], `${key}: เปลี่ยนเฉพาะช่วงกันรถ`)
  assert.ok(blocksOf(after).every(([s, e]) => blocksOf(old[key]).some(([os, oe]) => s >= os && e <= oe)), `${key}: ช่วงใหม่ต้องอยู่ในช่วงเดิม`); checks++
 }
 const communityNew = await rpc('patient_booking_preview', [tenant, [communityId], ''])
 check(communityNew, communityOld, 'งานชุมชนรอรับกลับไม่เปลี่ยนทุกค่า')
 // เคสจริงฟอกไต: ยังเป็นเที่ยวเก่า (ยืนยันก่อน migration) จึงยังไม่ถูกคำนวณ จนกว่าจะรันไฟล์ย้ายข้อมูล
 check(blocksOf((await tripRow(tripDialysis)).plan), [span('10:30', '19:00', R)], 'เที่ยวที่ยืนยันแล้วยังเป็นช่วงเดิมจนกว่าจะย้ายข้อมูล')
 await actor(coordinator)
 check((await rpc('patient_booking_preview', [tenant, [y], ''])).errors, [OVERLAP], 'ยังชนช่วงต่อเนื่องเดิมของเที่ยวที่ยืนยันแล้วจนกว่าจะย้ายข้อมูล')
 console.log('PASS new plans: short/edge/later/one-way/community unchanged, long wait releases the gap, no new errors, only blocks differ')

 // ── 7) ย้ายข้อมูลเที่ยวที่ยืนยันแล้ว ────────────────────────────────────────────────────────
 await db.exec('RESET ROLE')
 await db.exec(await read(BACKFILL))
 const noBlocks = plan => { const { blocks, ...rest } = plan; return rest }
 const now = {}
 for (const key of Object.keys(snapshot)) now[key] = await tripRow({ ...m, X: tripX, dialysis: tripDialysis }[key])
 check(blocksOf(now.long.plan), [span('08:45', '11:00', S), span('15:00', '17:15', S)], 'ย้าย: เที่ยวรอรับกลับที่อยู่นาน = 2 ช่วง')
 check(blocksOf(now.X.plan), [span('08:45', '11:00', Q), span('15:00', '17:15', Q)], 'ย้าย: เที่ยวที่ยืนยันผ่านระบบจริง')
 check(blocksOf(now.dialysis.plan), [span('10:30', '13:00', R), span('16:30', '19:00', R)], 'ย้าย: เคสจริงฟอกไต 10:30–19:00 → 10:30–13:00 + 16:30–19:00')
 for (const key of ['short', 'later', 'outbound', 'past', 'community', 'multiwave', 'narrow', 'split']) check(now[key].plan, snapshot[key].plan, `ย้าย: ${key} ต้องไม่ถูกแตะ`)
 for (const key of ['long', 'X', 'dialysis']) {
  check(noBlocks(now[key].plan), noBlocks(snapshot[key].plan), `ย้าย: ${key} เปลี่ยนเฉพาะ blocks`)
  check([now[key].revision, now[key].schedule_revision, now[key].state], [snapshot[key].revision, snapshot[key].schedule_revision, snapshot[key].state], `ย้าย: ${key} ไม่บวก revision`)
 }
 check(new Date(now.long.estimated_pickup_at).toISOString(), new Date(at('09:00', S)).toISOString(), 'ประมาณการเวลาที่เจ้าหน้าที่ตั้งไว้ไม่หาย')
 check((await row("SELECT tgenabled FROM pg_trigger WHERE tgname='ptb_schedule_replan'")).tgenabled, 'O', 'เปิด trigger คืนแล้ว')
 await db.exec(await read(BACKFILL))
 for (const key of Object.keys(snapshot)) check((await tripRow({ ...m, X: tripX, dialysis: tripDialysis }[key])).plan, now[key].plan, `รันซ้ำ: ${key} ผลเดิม`)
 console.log('PASS backfill: long wait trips released, short/later/started/past/community/multiwave/narrow/split untouched, revisions and estimates kept, rerun safe')

 // ── 8) จองรอบที่ 2 ในช่วงที่ปล่อยว่าง ───────────────────────────────────────────────────────
 await actor(null)
 const free = (await rpc('patient_booking_calendar', [tenant, Q, Q])).days[0].free.map(w => [ms(w.start), ms(w.end)])
 assert.ok(free.some(([s, e]) => s <= ms(at('11:00', Q)) && e >= ms(at('15:00', Q))), `ปฏิทินต้องมีช่องว่าง 11:00–15:00: ${JSON.stringify(free)}`); checks++
 await actor(coordinator)
 const yPlan = await rpc('patient_booking_preview', [tenant, [y], ''])
 check(yPlan.errors, [], 'รอบที่ 2 กลางวันจองได้แล้ว')
 check(blocksOf(yPlan), [span('11:40', '13:50', Q)])
 const tripY = id(72003)
 await rpc('patient_booking_confirm', [tenant, tripY, [y], yPlan, ''])
 check((await rpc('patient_booking_preview', [tenant, [z], ''])).errors, [OVERLAP], 'เที่ยวที่ทับช่วงวิ่งจริงยังถูกปฏิเสธ')
 await actor(null)
 const free2 = (await rpc('patient_booking_calendar', [tenant, Q, Q])).days[0].free.map(w => [ms(w.start), ms(w.end)])
 assert.ok(free2.some(([s, e]) => s <= ms(at('11:00', Q)) && e >= ms(at('11:40', Q))) && free2.some(([s, e]) => s <= ms(at('13:50', Q)) && e >= ms(at('15:00', Q))), 'ช่องว่างที่เหลือหลังจองรอบที่ 2'); checks++
 // ช่องว่างที่เหลือ (11:00–11:40 กับ 13:50–15:00) ไม่พอรอบไปแพร่ (45 นาที ต้องใช้ 2 ชม. 15) ยังถูกปฏิเสธ
 const tooBig = await submit(citizen, 'tooBig', { route_id: 'a', return_mode: 'one_way', appointment_at: at('14:30', Q), return_at: null })
 await actor(coordinator)
 check((await rpc('patient_booking_preview', [tenant, [tooBig], ''])).errors, [OVERLAP], 'รอบไปแพร่ที่ไม่พอดีช่องว่างที่เหลือยังชนจริง')
 console.log('PASS second round in the gap: calendar shows the gap, confirm succeeds, real overlap and too-big run still refused')

 // ── 9) ด่าน "ออกรถ" ของคนขับ ─────────────────────────────────────────────────────────────────
 await db.exec('RESET ROLE')
 await db.query("UPDATE public.patient_booking_trips SET state='cancelled' WHERE state NOT IN ('completed','cancelled')")
 const G = weekday()
 const gap = [{ start: at('08:45', G), end: at('11:00', G) }, { start: at('15:00', G), end: at('17:15', G) }]
 const one = [{ start: at('08:45', G), end: at('17:15', G) }]
 const g1 = await insertTrip({ day: G, state: 'outbound', mode: 'later', blocks: gap })
 const [g2, g3, g4] = [await insertTrip({ day: G, blocks: one }), await insertTrip({ day: G, blocks: one }), await insertTrip({ day: G, blocks: one })]
 const act = async (who, tid, action) => { const { revision } = await tripRow(tid); await actor(who); return rpc('patient_booking_action', [tenant, randomUUID(), tid, revision, action, '']) }
 const owner = sql => asOwner(() => db.query(sql[0], sql[1]))
 await act(driver, g2, 'trip_next')
 check((await tripRow(g2)).state, 'outbound', 'เที่ยวอื่นที่แยกช่วง (รถว่างช่วงกลางตามแผน) ไม่บล็อกออกรถ')
 await fails(() => act(driver, g3, 'trip_next'), /กำลังปฏิบัติงานเที่ยวอื่น/)
 check((await tripRow(g3)).state, 'confirmed', 'เที่ยวช่วงเดียวที่ออกรถอยู่ยังบล็อก')
 await act(driver, g2, 'trip_finish')
 await act(driver, g3, 'trip_next')
 check((await tripRow(g3)).state, 'outbound', 'จบเที่ยวช่วงเดียวแล้วออกรถเที่ยวถัดไปได้ (เที่ยวแยกช่วงที่ยังค้างไม่บล็อก)')
 await act(driver, g3, 'trip_finish')
 // เหตุขัดข้องบล็อกเสมอ แม้เที่ยวนั้นแยกช่วง
 await owner(["UPDATE public.patient_booking_trips SET state='issue',state_before_issue='outbound' WHERE id=$1", [g1]])
 await fails(() => act(driver, g4, 'trip_next'), /กำลังปฏิบัติงานเที่ยวอื่น/)
 await owner(["UPDATE public.patient_booking_trips SET state='completed' WHERE id=$1", [g1]])
 // รอรับกลับที่ปลายทาง (hospital + wait): ช่วงเดียวบล็อก · แยกช่วงไม่บล็อก
 const h1 = await insertTrip({ day: G, state: 'hospital', mode: 'wait', blocks: one })
 await fails(() => act(driver, g4, 'trip_next'), /กำลังปฏิบัติงานเที่ยวอื่น/)
 await owner(["UPDATE public.patient_booking_trips SET plan=jsonb_set(plan,'{blocks}',$2::jsonb) WHERE id=$1", [h1, JSON.stringify(gap)]])
 await act(driver, g4, 'trip_next')
 check((await tripRow(g4)).state, 'outbound', 'hospital+wait แผนแยกช่วงไม่บล็อก')
 console.log('PASS driver start guard: split trips do not block, continuous trips and incidents still do, hospital+wait follows the same rule')

 console.log(`All wait-release checks passed (${checks} checks).`)
} finally {
 await db.close()
}
