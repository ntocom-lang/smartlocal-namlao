// In-memory PostgreSQL only. No .env, production client, network, or real citizen data.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, id, baseBooking } = await import('./patient-booking-db.test.mjs')
const files = ['20260927190000_patient_booking_move_into_trip.sql','20260928120000_patient_booking_multiwave.sql',
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
 '20261010100000_patient_booking_release_wait_gap.sql','20261010100100_patient_booking_release_wait_gap_backfill.sql']
await db.exec('RESET ROLE')
for (const f of files) await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'))
const snapshot = async () => (await db.query("SELECT jsonb_build_object('bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.patient_bookings b),'trips',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.patient_booking_trips t)) v")).rows[0].v
const before = await snapshot()
for (const f of ['20261011120000_patient_booking_manual_settings_rpc.sql','20261011120100_patient_booking_manual_scheduler_rpc.sql','20261011120200_patient_booking_manual_workflow_rpc.sql']) {
 await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'))
 if (!f.includes('workflow_rpc')) {
  await actor(null)
  const interim=await rpc('patient_booking_info',[tenant])
  assert.notEqual(interim?.scheduling_mode,'manual','client contract must not open before the final migration')
  await db.exec('RESET ROLE')
 }
}
assert.deepEqual(await snapshot(),before,'migrations must not rewrite existing bookings or trips')
const owner = async fn => { await db.exec('RESET ROLE'); try { return await fn() } finally { await actor(admin) } }
const row = (sql,args=[]) => owner(async () => (await db.query(sql,args)).rows[0])
const trip = tid => row('SELECT * FROM public.patient_booking_trips WHERE id=$1',[tid])
const booking = bid => row('SELECT * FROM public.patient_bookings WHERE id=$1',[bid])
const rejects = (fn, message) => assert.rejects(fn,message)
const day = new Date(Date.now()+70*86400000).toISOString().slice(0,10)
const at = (time,d=day) => `${d}T${time}:00+07:00`
const currentSettings=await row('SELECT * FROM public.patient_booking_settings WHERE municipality_id=$1',[tenant])
await rpc('patient_booking_save_settings',[tenant,currentSettings.revision,{...settings,seats:4,wheelchairs:1,stretchers:1,
 routes:[{id:'a',label:'TEST โรงพยาบาล A',zone:'TEST เมือง'},{id:'b',label:'TEST โรงพยาบาล B',zone:'TEST เมือง'},{id:'__other__',label:'อื่นๆ'}]}])
const saved = await row('SELECT * FROM public.patient_booking_settings WHERE municipality_id=$1',[tenant])
assert.equal(saved.routes[0].minutes,currentSettings.routes.find(r=>r.id==='a')?.minutes ?? null,'legacy minutes retained as unused metadata')
assert.equal(saved.routes[2].minutes,null,'new destination needs no duration')
await actor(null)
const info=await rpc('patient_booking_info',[tenant])
assert.equal(info.scheduling_mode,'manual')
// Already-open clients require numeric fields to offer appointment slots until refreshed.
// Return zero compatibility values, never stored travel estimates or calculated reservations.
assert.equal(info.buffer_minutes,0); assert.equal(info.boarding_minutes,0)
assert.ok(info.routes.every(r=>r.minutes===0)); assert.ok(info.community.places.every(r=>r.minutes===0))
await actor(admin)
const cr=await row('SELECT revision FROM public.patient_booking_community_rules WHERE municipality_id=$1',[tenant])
await rpc('patient_booking_save_community_rules',[tenant,cr?.revision??1,{enabled:true,window_start:360,window_end:1200,
 places:[{id:'temple',label:'TEST วัด'}],activities:[{code:'meet',label:'TEST กิจกรรม'}],rules_reference:'TEST ข้อบังคับสมมติ'}])
const submit = async (name,time='12:00',extras={}) => {
 const bid=randomUUID(); await actor(citizen)
 await rpc('patient_booking_submit',[tenant,bid,{...baseBooking,patient_name:`TEST ${name}`,phone:'0800000099',companions:0,appointment_at:at(time),return_at:at('17:30'),...extras}])
 await actor(coordinator); return bid
}
const confirm = async bid => {
 await actor(coordinator); const plan=await rpc('patient_booking_preview',[tenant,[bid],''])
 assert.deepEqual(plan.errors,[]); assert.equal(plan.pickup_at,null); assert.deepEqual(plan.blocks,[])
 const tid=randomUUID(); await rpc('patient_booking_confirm',[tenant,tid,[bid],plan,'']);
 await rpc('patient_booking_confirm',[tenant,tid,[bid],plan,'']); return tid
}
const a=await submit('A'), ta=await confirm(a), b=await submit('B')
let tb=await confirm(b)
const cal=await rpc('patient_booking_calendar',[tenant,day,day])
assert.equal(cal.days[0].status,'open'); assert.equal(cal.days[0].free.length,1)
assert.equal(Date.parse(cal.days[0].free[0].start),Date.parse(at('08:30')))
assert.ok(cal.days[0].trips.some(t=>t.id===ta&&t.joinable&&t.pickup_at===null))
const pending=await submit('ร่วมเที่ยว','12:00',{route_id:'b'})
// Old multiwave confirmations copied a computed pickup into estimated_pickup_at at revision 1.
await owner(()=>db.query('UPDATE public.patient_booking_trips SET estimated_pickup_at=$2 WHERE id=$1',[ta,at('06:00')]))
await actor(coordinator)
const join=await rpc('patient_booking_preview_into_trip',[tenant,pending,ta]); assert.deepEqual(join.errors,[])
const joinOp=randomUUID(); await rpc('patient_booking_confirm_into_trip',[tenant,joinOp,pending,ta,join])
await rpc('patient_booking_confirm_into_trip',[tenant,joinOp,pending,ta,join])
assert.equal((await booking(pending)).trip_id,ta)
await actor(citizen)
assert.equal((await rpc('patient_booking_mine_v2',[tenant])).trips.find(t=>t.id===ta).estimated_pickup_at,null,'replanning cannot expose an old computed estimate')
await actor(coordinator)
const full=await submit('เกินที่นั่ง','12:00',{companions:3})
const fullPlan=await rpc('patient_booking_preview_into_trip',[tenant,full,ta]); assert.ok(fullPlan.errors.includes('ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว'))
await rejects(()=>rpc('patient_booking_confirm_into_trip',[tenant,randomUUID(),full,ta,fullPlan]),/ที่นั่งไม่พอ/)
assert.equal((await booking(full)).status,'submitted')
const snapshotOf=async tid=>{
 const t=await trip(tid), s=await row('SELECT revision FROM public.patient_booking_settings WHERE municipality_id=$1',[tenant])
 const riders=await owner(async()=>(await db.query("SELECT id,revision FROM public.patient_bookings WHERE trip_id=$1 AND status<>'cancelled' ORDER BY id",[tid])).rows)
 return {trip:tid,revision:t.revision,docs_revision:t.docs_revision,schedule_revision:t.schedule_revision,settings_revision:s.revision,bookings:Object.fromEntries(riders.map(b=>[b.id,b.revision]))}
}
// A legacy computed pickup already in the past must not prevent staff moving a confirmed rider.
const mover=await submit('ย้ายเวลา','11:30'), source=await confirm(mover)
await owner(()=>db.query("UPDATE public.patient_booking_trips SET plan=plan||jsonb_build_object('pickup_at',now()-interval '1 hour','blocks',jsonb_build_array(jsonb_build_object('start',$2::timestamptz,'end',$3::timestamptz))) WHERE id=$1",[source,at('06:00'),at('22:00')]))
const target=await trip(ta), targetRider=await booking(a), moveExpected=await snapshotOf(source)
await actor(coordinator)
const moveArgs=[tenant,randomUUID(),mover,moveExpected,ta,target.revision,a,targetRider.revision]
assert.equal((await rpc('patient_booking_move_into_trip',moveArgs)).saved,true)
assert.equal((await rpc('patient_booking_move_into_trip',moveArgs)).saved,true)
assert.equal(Date.parse((await booking(mover)).appointment_at),Date.parse(at('12:00')))
assert.equal((await trip(source)).state,'cancelled')
const hospitalExpected=await snapshotOf(tb)
await actor(coordinator)
assert.equal((await rpc('patient_booking_change_hospital',[tenant,randomUUID(),b,hospitalExpected,'b','single'])).saved,true)
assert.equal((await booking(b)).route_id,'b')
const rescheduleExpected=await snapshotOf(tb)
await actor(coordinator)
assert.equal((await rpc('patient_booking_reschedule',[tenant,randomUUID(),b,'single',rescheduleExpected,at('12:00'),at('18:00'),false])).saved,true)
await actor(coordinator)
await rejects(()=>rpc('patient_booking_reschedule',[tenant,randomUUID(),b,'single',rescheduleExpected,at('13:00'),at('18:00'),false]),/เปลี่ยนแล้ว/)
tb=(await booking(b)).trip_id
const reassigned=await trip(tb)
await actor(admin)
assert.equal((await rpc('patient_booking_reassign_driver',[tenant,randomUUID(),tb,null,driver,admin,{[tb]:{revision:reassigned.revision,docs_revision:reassigned.docs_revision,driver_id:driver}},false])).saved,true)
const covered=await trip(tb)
await actor(admin)
await rpc('patient_booking_reassign_driver',[tenant,randomUUID(),tb,null,admin,driver,{[tb]:{revision:covered.revision,docs_revision:covered.docs_revision,driver_id:admin}},false])
await actor(coordinator)
const earlyRound=await submit('รับแยกรอบ','09:00',{return_at:at('12:00')})
const multi=await rpc('patient_booking_preview_multiwave',[tenant,[earlyRound],ta])
assert.deepEqual(multi.errors,[]);assert.equal(multi.outbound_waves.length,2);assert.equal(multi.return_waves.length,2);assert.deepEqual(multi.blocks,[])
await rpc('patient_booking_confirm_multiwave',[tenant,randomUUID(),[earlyRound],ta,multi])
assert.equal((await booking(earlyRound)).trip_id,ta,'overlapping old outbound/return formulas cannot reject staff-arranged multiple runs')
const announced=await trip(ta)
await rpc('patient_booking_update_schedule',[tenant,ta,announced.schedule_revision,'normal',at('11:15'),at('17:45')])
const mine = async () => { await actor(citizen); return rpc('patient_booking_mine_v2',[tenant]) }
const view=await mine(); assert.equal(Date.parse(view.trips.find(t=>t.id===ta).estimated_pickup_at),Date.parse(at('11:15')))
await actor(null)
const announcedCalendar=await rpc('patient_booking_calendar',[tenant,day,day])
assert.equal(Date.parse(announcedCalendar.days[0].trips.find(t=>t.id===ta).estimated_pickup_at),Date.parse(at('11:15')))
assert.equal(announcedCalendar.days[0].trips.find(t=>t.id===ta).schedule_revision,announced.schedule_revision+1)
await actor(coordinator)
// Hospital correction may split simultaneous riders into separate trips, without computed overlaps.
const splitResult=await rpc('patient_booking_change_hospital',[tenant,randomUUID(),a,await snapshotOf(ta),'b','single'])
assert.equal(splitResult.saved,true);assert.notEqual(splitResult.trip_id,ta)
assert.equal(Date.parse((await booking(a)).appointment_at),Date.parse(at('12:00')))
assert.equal((await booking(pending)).trip_id,ta)
await actor(coordinator)
const next = async (tid,action='trip_next') => { const t=await trip(tid); await actor(driver); await rpc('patient_booking_action',[tenant,randomUUID(),tid,t.revision,action,'']); return trip(tid) }
assert.equal((await next(ta)).state,'outbound')
const beforeSecondDeparture=await trip(tb)
await actor(driver); await rejects(()=>rpc('patient_booking_action',[tenant,randomUUID(),tb,beforeSecondDeparture.revision,'trip_next','']),/กำลังปฏิบัติงาน/)
// Synthetic drop-off data, then a second run can depart while first passengers await return.
await owner(()=>db.query("UPDATE public.patient_bookings SET passenger_step=2 WHERE trip_id=$1",[ta]))
assert.equal((await next(ta)).state,'hospital'); assert.equal((await next(tb)).state,'outbound')
await owner(()=>db.query("UPDATE public.patient_bookings SET passenger_step=2 WHERE trip_id=$1",[tb]))
assert.equal((await next(tb)).state,'hospital')
assert.equal((await next(ta)).state,'returning')
await owner(()=>db.query("UPDATE public.patient_bookings SET passenger_step=4 WHERE trip_id=$1",[ta]))
assert.equal((await next(ta)).state,'completed')
// Community and patient requests may be scheduled at the same time; capacities still apply.
await actor(null); const publicInfo=await rpc('patient_booking_info',[tenant]); await actor(citizen)
const community=randomUUID(); await rpc('patient_booking_submit_community',[tenant,community,{requester_name:'TEST ผู้ติดต่อ',phone:'0800000088',group_label:'TEST กลุ่ม',party_size:3,
 purpose_code:'meet',route_id:'temple',appointment_at:at('12:00'),return_mode:'wait',return_at:at('17:30'),pickup:'TEST จุดรับ',in_area:true,
 consent:true,consent_version:'community-booking-v1',privacy_notice:publicInfo.community.privacy_notice,owner_name:publicInfo.owner_name,rules_version:publicInfo.community.rules_version},false])
await actor(coordinator); const ct=await confirm(community)
assert.equal((await trip(ct)).plan.service_type,'community')
await actor(citizen); await rejects(()=>rpc('patient_booking_preview',[tenant,[community],'']),/ไม่มีสิทธิ์/)
await actor(coordinator); await rejects(()=>rpc('patient_booking_preview',[id(2),[community],'']),/ไม่มีสิทธิ์|ไม่พบ/)
// Migration guards are deliberate: attempting to replace a drifted body fails.
const awaitMigrationSettings=await readFile(new URL('../supabase/migrations/20261011120000_patient_booking_manual_settings_rpc.sql',import.meta.url),'utf8')
await owner(async()=>{
 await db.exec('BEGIN');
 await db.exec("CREATE OR REPLACE FUNCTION public.patient_booking_info(p_muni uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;")
 await assert.rejects(()=>db.exec(awaitMigrationSettings),/Function drift/)
 await db.exec('ROLLBACK')
})
console.log('PASS manual dispatch: durations optional, same-time confirmations, shared destinations, capacity rollback, retries, staff pickup, role/tenant isolation, actual-state multiple runs and no data rewrite')
if (!process.env.MANUAL_UI_QA) await db.close()
export {db,actor,rpc,tenant,admin,coordinator,driver,citizen,settings,day,at,owner,row,trip,booking,submit,confirm,info}
