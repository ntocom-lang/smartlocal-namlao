// PGlite only. No .env, project client, real accounts or network access.
// ช่อง "อื่นๆ" ในข้อ "สถานที่ชุมชน" (20261020150000) — เจ้าของระบบสั่ง 2569-10-19:
// ผู้ขอพิมพ์ชื่อสถานที่ที่ไม่อยู่ในรายการเอง แอดมินเปิดสวิตช์ครั้งเดียว ปิดไว้เป็นค่าเริ่มต้น
// ฐานข้อมูลชุมชนเดิมปิดทางนี้ไว้ 3 จุด (บันทึกกฎ / ตรวจคำขอ / ตัวจัดแผน) เทสต์นี้ยืนยันทั้งก่อนและหลัง migration
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
 '20261003150100_patient_booking_legacy_client_gate.sql','20261007150000_patient_booking_destination_zone.sql',
 '20261007170000_patient_booking_other_place.sql','20261008100000_patient_booking_day_odometer_table.sql',
 '20261008100100_patient_booking_day_odometer_backfill.sql','20261008100200_patient_booking_day_odometer_rpc.sql',
 '20261010100000_patient_booking_release_wait_gap.sql','20261010100100_patient_booking_release_wait_gap_backfill.sql',
 '20261011120000_patient_booking_manual_settings_rpc.sql','20261011120100_patient_booking_manual_scheduler_rpc.sql',
 '20261011120200_patient_booking_manual_workflow_rpc.sql']
const MIGRATION = '20261020150000_patient_booking_community_other_place.sql'
const REPLACED = ['public.ptb_plan(uuid,uuid[],text)', 'public.ptb_community_payload(uuid,jsonb)', 'public.patient_booking_save_community_rules(uuid,integer,jsonb)']
const OTHER_LABEL = 'อื่นๆ (พิมพ์ชื่อสถานที่เอง)'
let checks = 0
const check = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const fails = async (job, pattern) => { await assert.rejects(job, pattern); checks++ }
const asOwner = async job => {
  const who = (await db.query('SELECT current_user AS u')).rows[0].u
  await db.exec('RESET ROLE')
  try { return await job() } finally { if (['anon', 'authenticated'].includes(who)) await db.exec(`SET ROLE ${who}`) }
}
const row = async (sql, args = []) => asOwner(async () => (await db.query(sql, args)).rows[0])
const day = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
const at = time => `${day}T${time}:00+07:00`
const fnState = async () => asOwner(async () => (await db.query(`SELECT oid::regprocedure::text AS identity,proacl::text AS acl,prosecdef,proconfig,provolatile FROM pg_proc
 WHERE oid IN (${REPLACED.map(f => `'${f}'::regprocedure`).join(',')}) ORDER BY 1`)).rows)
const rulesRow = async () => row('SELECT * FROM public.patient_booking_community_rules WHERE municipality_id=$1', [tenant])
const rulesBody = (places, extra = {}) => ({ enabled: true, window_start: 360, window_end: 1200, places, activities: [{ code: 'meet', label: 'TEST กิจกรรม' }],
  rules_reference: 'TEST ข้อบังคับจำลองเท่านั้น', ...extra })
const listed = [{ id: 'temple', label: 'TEST วัด' }]
const saveRules = async (places, extra) => { await actor(admin); return rpc('patient_booking_save_community_rules', [tenant, (await rulesRow())?.revision ?? 1, rulesBody(places, extra)]) }
const phones = (() => { let n = 0; return () => `08006${String(++n).padStart(5, '0')}` })()
const dataFor = async patch => {
  await actor(citizen)
  const info = await rpc('patient_booking_info', [tenant])
  return { requester_name: 'TEST ผู้ติดต่อ', phone: phones(), pickup: 'TEST จุดรับชุมชน', in_area: true, route_id: 'temple', appointment_at: at('10:00'),
    return_at: null, return_mode: 'one_way', group_label: 'TEST กลุ่ม', party_size: 3, purpose_code: 'meet', rules_version: info.community.rules_version,
    consent: true, consent_version: 'community-booking-v1', privacy_notice: info.community.privacy_notice, owner_name: info.owner_name, ...patch }
}
const submit = async (patch, { staff = false, who = citizen, bid = randomUUID() } = {}) => {
  const data = await dataFor(patch)
  await actor(who)
  await rpc('patient_booking_submit_community', [tenant, bid, data, staff])
  return bid
}
const booking = async bid => row('SELECT id,status,route_id,route_label,revision,trip_id FROM public.patient_bookings WHERE id=$1', [bid])
const preview = async bid => { await actor(coordinator); return rpc('patient_booking_preview', [tenant, [bid], '']) }

try {
 await db.exec('RESET ROLE')
 for (const f of before) await db.exec(await read(f))
 await actor(admin)
 await rpc('patient_booking_save_settings', [tenant, (await row('SELECT revision FROM public.patient_booking_settings WHERE municipality_id=$1', [tenant])).revision,
  { ...settings, seats: 10, routes: [{ id: 'a', label: 'TEST โรงพยาบาล A' }] }])
 await saveRules(listed)

 // ── 1) พฤติกรรมเดิมก่อน migration ────────────────────────────────────────────────────────────
 await fails(() => saveRules([...listed, { id: '__other__', label: OTHER_LABEL }]), /กรุณาระบุรหัสและชื่อของทุกสถานที่ชุมชน/)
 await fails(() => submit({ route_id: '__other__', other_place: 'TEST วัดบ้านนา' }), /ยังไม่ตั้งสถานที่ชุมชน|ไม่รองรับ/)
 const baseCommunity = await submit({})
 const basePatient = await (async () => { const bid = randomUUID(); await actor(citizen); await rpc('patient_booking_submit', [tenant, bid, { ...baseBooking, patient_name: 'TEST ผู้ป่วยฐาน', phone: phones(), companions: 0, appointment_at: at('12:00'), return_at: at('16:00') }]); return bid })()
 const baselinePlans = { community: await preview(baseCommunity), patient: await preview(basePatient) }
 check(baselinePlans.community.errors, [], 'สถานที่ปกติของงานชุมชนจัดแผนได้ก่อนแก้')
 const rulesBefore = await rulesRow()
 console.log('PASS old behaviour captured: rules refuse __other__, intake refuses __other__, baseline community and patient plans')

 // ── 2) ตัวกัน drift (ทั้ง 3 ฟังก์ชัน) + ติดตั้ง + คุณสมบัติฟังก์ชันคงเดิม ─────────────────────────
 await db.exec('RESET ROLE')
 const stateBefore = await fnState()
 for (const identity of REPLACED) {
  const definition = (await row('SELECT pg_get_functiondef($1::regprocedure) AS d', [identity])).d
  await db.exec(definition.replace(/AS (\$\w*\$)/, 'AS $1\n-- deliberate local drift'))
  await fails(async () => db.exec(await read(MIGRATION)), /Function drift/)
  await db.exec('ROLLBACK')
  await db.exec(definition)
 }
 await db.exec(await read(MIGRATION))
 check(await fnState(), stateBefore, 'SECURITY DEFINER search_path สิทธิ์ และ volatility ของ 3 ฟังก์ชันคงเดิม')
 await fails(async () => db.exec(await read(MIGRATION)), /Function drift/)
 await db.exec('ROLLBACK')
 console.log('PASS drift guards on all three replaced functions, attributes and grants kept')

 // ── 3) งานเดิมต้องเหมือนเดิมทุกค่า ──────────────────────────────────────────────────────────
 check(await preview(baseCommunity), baselinePlans.community, 'แผนงานชุมชนสถานที่ปกติเหมือนเดิมทุกค่า')
 check(await preview(basePatient), baselinePlans.patient, 'แผนงานผู้ป่วยเหมือนเดิมทุกค่า')
 check(await rulesRow(), rulesBefore, 'กฎชุมชนไม่ถูกแตะโดย migration')
 await fails(() => submit({ route_id: '__other__', other_place: 'TEST วัดบ้านนา' }), /ยังไม่ตั้งสถานที่ชุมชน/)
 await fails(() => submit({ other_place: 'TEST วัดบ้านนา' }), /ไม่รองรับ/)
 console.log('PASS existing community/patient plans and rules unchanged; switch closed = __other__ still refused')

 // ── 4) บันทึกกฎ: เปิดช่อง "อื่นๆ" ────────────────────────────────────────────────────────────
 const versionBefore = (await rulesRow()).rules_version
 await saveRules([...listed, { id: '__other__', label: 'ป้ายที่ client ส่งมาไม่สำคัญ' }])
 const afterOn = await rulesRow()
 check(afterOn.places, [{ id: 'temple', label: 'TEST วัด', minutes: null }, { id: '__other__', label: OTHER_LABEL, minutes: null }], 'บังคับป้ายคงที่ และไม่มีเวลาเดินทาง')
 check(afterOn.rules_version, versionBefore + 1, 'เปิด/ปิดช่องเปลี่ยนกฎ ฟอร์มที่เปิดค้างต้องโหลดใหม่')
 await fails(() => saveRules([...listed, { id: '__other__', label: OTHER_LABEL }, { id: '__other__', label: OTHER_LABEL }]), /รหัสสถานที่ชุมชนซ้ำ/)
 await fails(() => saveRules([{ id: '__other__', label: OTHER_LABEL }]), /ก่อนเปิดบริการชุมชน/)
 await fails(() => saveRules([...listed, { id: '__other__', label: OTHER_LABEL, extra: 1 }]), /กรุณาระบุรหัสและชื่อของทุกสถานที่ชุมชน/)
 await fails(() => saveRules([...listed, { id: '__other__', label: '   ' }]), /กรุณาระบุรหัสและชื่อของทุกสถานที่ชุมชน/)
 await saveRules([{ id: '__other__', label: OTHER_LABEL }], { enabled: false })
 check((await rulesRow()).enabled, false, 'ปิดบริการแล้วมีแค่ "อื่นๆ" ได้ (ไม่ได้เปิดรับคำขอ)')
 await saveRules([...listed, { id: '__other__', label: OTHER_LABEL }])
 await actor(null)
 check((await rpc('patient_booking_info', [tenant])).community.places.map(p => p.id), ['temple', '__other__'], 'ฟอร์มเห็นตัวเลือก "อื่นๆ" ต่อท้ายรายการ')
 console.log('PASS rules: other accepted with fixed label, duplicate/only-other-when-open/extra-key/blank-label refused, rules_version bumps')

 // ── 5) ส่งคำขอไป "อื่นๆ" ─────────────────────────────────────────────────────────────────────
 for (const [other, pattern] of [[undefined, /กรุณาพิมพ์ชื่อสถานที่ที่จะไป/], ['', /กรุณาพิมพ์ชื่อสถานที่ที่จะไป/], ['   ', /กรุณาพิมพ์ชื่อสถานที่ที่จะไป/],
  ['ก', /กรุณาพิมพ์ชื่อสถานที่ที่จะไป/], ['\n\t \u0007', /กรุณาพิมพ์ชื่อสถานที่ที่จะไป/], ['ก'.repeat(201), /กรุณาพิมพ์ชื่อสถานที่ที่จะไป/]]) {
  await fails(() => submit({ route_id: '__other__', ...(other === undefined ? {} : { other_place: other }) }), pattern)
 }
 await fails(() => submit({ route_id: '__other__', other_place: 5 }), /ชนิดข้อมูล/)
 await fails(() => submit({ route_id: 'temple', other_place: 'TEST วัดบ้านนา' }), /ไม่รองรับ/)
 const otherBooking = await submit({ route_id: '__other__', other_place: '  TEST วัด\n  บ้านนา\t' })
 check(await booking(otherBooking), { id: otherBooking, status: 'submitted', route_id: '__other__', route_label: 'TEST วัด บ้านนา', revision: 1, trip_id: null }, 'ชื่อที่พิมพ์ยุบช่องว่างแล้วเป็น route_label')
 const longest = await submit({ route_id: '__other__', other_place: 'ก'.repeat(200) })
 check((await booking(longest)).route_label.length, 200, 'ยาวได้ 200 ตัวอักษร')
 const retryId = randomUUID(), retryData = await dataFor({ route_id: '__other__', other_place: 'TEST ซ้ำ' })
 await actor(citizen); await rpc('patient_booking_submit_community', [tenant, retryId, retryData, false]); await rpc('patient_booking_submit_community', [tenant, retryId, retryData, false])
 check((await row('SELECT count(*)::int n FROM public.patient_bookings WHERE id=$1', [retryId])).n, 1, 'ส่งซ้ำด้วยรหัสเดิมได้คำขอเดียว')
 const staffId = await submit({ route_id: '__other__', other_place: 'TEST รับจองแทน' }, { staff: true, who: coordinator })
 check((await booking(staffId)).route_label, 'TEST รับจองแทน', 'เจ้าหน้าที่รับจองแทนไป "อื่นๆ" ได้')
 await actor(citizen)
 await fails(() => rpc('patient_booking_submit_community', [tenant, randomUUID(), { ...retryData, route_id: 'unknown-place', other_place: undefined }, false]), /ยังไม่ตั้งสถานที่ชุมชน/)
 console.log('PASS submit: name required 2–200, whitespace collapsed, name with a listed place refused, retry once, staff entry works')

 // ── 6) จัดแผน + ยืนยันรถ ─────────────────────────────────────────────────────────────────────
 const plan = await preview(otherBooking)
 check(plan.errors, [], 'ptb_plan ไม่ปฏิเสธ "อื่นๆ" แล้ว')
 check([plan.route_label, plan.route_id, plan.scheduling_mode, plan.blocks], ['TEST วัด บ้านนา', '__other__', 'manual', []], 'แผนใช้ชื่อที่พิมพ์ ไม่มีช่วงกันรถ')
 const tripId = randomUUID()
 await rpc('patient_booking_confirm', [tenant, tripId, [otherBooking], plan, ''])
 await rpc('patient_booking_confirm', [tenant, tripId, [otherBooking], plan, ''])
 const confirmed = await row('SELECT t.plan->>\'route_label\' AS label, t.state, b.status FROM public.patient_booking_trips t JOIN public.patient_bookings b ON b.trip_id=t.id WHERE t.id=$1', [tripId])
 check(confirmed, { label: 'TEST วัด บ้านนา', state: 'confirmed', status: 'confirmed' }, 'เที่ยวที่ยืนยันแล้วใช้ชื่อสถานที่ที่พิมพ์')
 console.log('PASS plan and confirm: no error, typed name in plan and trip, retry safe')

 // ── 7) แก้ข้อมูลหลังประสาน (amend) ───────────────────────────────────────────────────────────
 const amendable = await submit({ route_id: '__other__', other_place: 'TEST ก่อนแก้' })
 const amend = async (bidValue, patch) => {
  const current = await booking(bidValue); const data = await dataFor(patch)
  await actor(coordinator)
  return rpc('patient_booking_amend_community', [tenant, randomUUID(), bidValue, current.revision, data, 'TEST ประสานผู้จองแล้ว'])
 }
 await amend(amendable, { route_id: '__other__', other_place: 'TEST หลังแก้' })
 check(await booking(amendable), { id: amendable, status: 'submitted', route_id: '__other__', route_label: 'TEST หลังแก้', revision: 2, trip_id: null }, 'แก้ชื่อสถานที่อื่นได้')
 await fails(() => amend(amendable, { route_id: '__other__' }), /กรุณาพิมพ์ชื่อสถานที่ที่จะไป/)
 await amend(amendable, { route_id: 'temple' })
 check((await booking(amendable)).route_label, 'TEST วัด', 'เปลี่ยนจาก "อื่นๆ" เป็นสถานที่ในรายการ ชื่อที่พิมพ์ไม่ค้าง')
 await amend(amendable, { route_id: '__other__', other_place: 'TEST กลับไปอื่นๆ' })
 check((await booking(amendable)).route_label, 'TEST กลับไปอื่นๆ')
 console.log('PASS amend: rename, name required, other ↔ listed place both directions')

 // ── 8) ปิดช่อง "อื่นๆ" ภายหลัง = ทำงานเหมือนลบสถานที่ออกจากรายการ ─────────────────────────────
 await saveRules(listed)
 const orphan = await preview(amendable)
 check(orphan.errors, ['ยังไม่ตั้งสถานที่ชุมชน'], 'คำขอที่รอยืนยันยืนยันไม่ได้จนกว่าจะแก้เป็นสถานที่ในรายการ')
 check((await booking(otherBooking)).status, 'confirmed', 'เที่ยวที่ยืนยันไปแล้วไม่ถูกแตะ')
 await fails(() => submit({ route_id: '__other__', other_place: 'TEST หลังปิดช่อง' }), /ยังไม่ตั้งสถานที่ชุมชน/)
 await amend(amendable, { route_id: 'temple' })
 check((await preview(amendable)).errors, [], 'แก้เป็นสถานที่ในรายการแล้วจัดแผนได้')
 console.log('PASS switch off later: pending other request must be re-pointed, confirmed trip untouched, new other requests refused')

 console.log(`All community other-place checks passed (${checks} checks).`)
} finally {
 await db.close()
}
