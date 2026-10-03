// PGlite only. No .env, project client, real accounts or network access.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, id, baseBooking } = await import('./patient-booking-db.test.mjs')
const read = f => readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const existing = ['20260927190000_patient_booking_move_into_trip.sql','20260928120000_patient_booking_multiwave.sql',
 '20260929100000_patient_booking_update_pickup.sql','20260929110000_patient_booking_change_hospital.sql',
 '20260926125325_patient_booking_staff_work_badge.sql','20260929130000_patient_booking_driver_cover.sql',
 '20260930110000_patient_booking_duplicate_shared_trip.sql','20261001100000_patient_booking_history.sql',
 '20261002090000_patient_booking_period_report.sql','20261002130000_patient_booking_letter_per_booking_columns.sql',
 '20261002130100_patient_booking_letter_per_booking_rpc.sql','20261003120000_patient_booking_community_rules_rpc.sql']
const migrations = ['20261003130000_patient_booking_community_constraints_retention.sql','20261003130100_patient_booking_community_scheduler_rpc.sql',
 '20261003130200_patient_booking_community_projections_rpc.sql','20261003130300_patient_booking_community_reports_rpc.sql','20261003130400_patient_booking_community_intake_rpc.sql']
let checks = 0
const check = (a,b) => { assert.deepEqual(a,b); checks++ }
const ok = (v,label) => { assert.ok(v,label); checks++ }
const fails = async (job,pattern) => { await assert.rejects(job,pattern); checks++ }
const row = async (sql,args=[]) => (await db.query(sql,args)).rows[0]
const workspace = () => rpc('patient_booking_workspace',[tenant])
const submitted = (booking, data, staff=false, muni=tenant) => rpc('patient_booking_submit_community',[muni,booking,data,staff])
const preview = ids => rpc('patient_booking_preview',[tenant,ids,''])
const rules = { enabled:true,window_start:360,window_end:1200,places:[{id:'test-temple',label:'TEST วัด',minutes:60}],
 activities:[{code:'test-activity',label:'TEST กิจกรรมชุมชน'}],rules_reference:'TEST ข้อบังคับจำลองเท่านั้น' }
const date = new Date(); date.setUTCDate(date.getUTCDate()+250); while(date.getUTCDay()!==0) date.setUTCDate(date.getUTCDate()+1)
const day = date.toISOString().slice(0,10)
const at = time => `${day}T${time}:00+07:00`
const next = new Date(date); next.setUTCDate(next.getUTCDate()+1); const nextDay=next.toISOString().slice(0,10)
const bid=id(50001), patient=id(50002), second=id(50003), trip=id(50101)
let data
try {
 await db.exec('RESET ROLE')
 for(const f of existing) await db.exec(await read(f))
 const before=(await db.query("SELECT oid::regprocedure::text AS identity,proacl::text AS acl,prosecdef,proconfig,provolatile,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1")).rows
 // Each replacement refuses drift before changing any definition/constraint.
 for(const [file,identity] of [[migrations[0],'purge_expired_patient_booking_contacts(interval,boolean)'],[migrations[1],'ptb_plan(uuid,uuid[],text)'],
  [migrations[2],'patient_booking_workspace(uuid)'],[migrations[3],'patient_booking_period_report(uuid,date,date)'],[migrations[4],'patient_booking_amend(uuid,uuid,uuid,integer,jsonb,text)']]) {
  const definition=before.find(f=>f.identity===identity).definition
  await db.exec(definition.replace(/AS (\$\w*\$)/,'AS $1\n-- deliberate local drift'))
  await fails(async()=>db.exec(await read(file)), /Function drift/)
  await db.exec('ROLLBACK')
  await db.exec(definition)
 }
 for(const f of migrations) await db.exec(await read(f))
 const after=(await db.query("SELECT oid::regprocedure::text AS identity,proacl::text AS acl,prosecdef,proconfig,provolatile FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1")).rows
 for(const f of before) { const now=after.find(n=>n.identity===f.identity); check([now.acl,now.prosecdef,now.proconfig,now.provolatile],[f.acl,f.prosecdef,f.proconfig,f.provolatile]) }
 for(const name of ['ptb_community_payload','patient_booking_submit_community','patient_booking_amend_community','patient_booking_month_report_v2','patient_booking_period_report_v2']) {
  const f=after.find(f=>f.identity.startsWith(`${name}(`));check(f.prosecdef,true);check(f.proconfig,['search_path=""'])
  ok(!/[{,]=X\//.test(f.acl),'PUBLIC cannot execute')
 }
 for(const f of migrations) { await fails(async()=>db.exec(await read(f)), /Function drift/); await db.exec('ROLLBACK') }
 await actor(admin)
 await rpc('patient_booking_save_settings',[tenant,(await workspace()).settings.revision,settings])
 await db.exec('RESET ROLE')
 await db.query("UPDATE public.patient_booking_settings SET holidays=ARRAY[$1::date],calendar_checked_through=current_date-1 WHERE municipality_id=$2",[day,tenant])
 await actor(admin)
 const initialInfo=await rpc('patient_booking_info',[tenant])
 check(initialInfo.community.enabled,false)
 await fails(()=>submitted(bid,{}),/ปิดรับคำขอใหม่/)
 const calBefore=await rpc('patient_booking_calendar',[tenant,day,day])
 check(calBefore.days[0].community_free,[])
 await rpc('patient_booking_save_community_rules',[tenant,1,rules])
 const currentInfo=await rpc('patient_booking_info',[tenant])
 data={requester_name:'TEST ผู้ติดต่อ',phone:'0800099000',pickup:'TEST จุดรับชุมชน',in_area:true,route_id:'test-temple',
  appointment_at:at('07:00'),return_at:at('19:00'),return_mode:'later',group_label:'TEST กลุ่มชุมชน',party_size:3,purpose_code:'test-activity',
  rules_version:currentInfo.community.rules_version,consent:true,consent_version:'community-booking-v1',privacy_notice:currentInfo.community.privacy_notice,owner_name:currentInfo.owner_name}
 const calConfigured=await rpc('patient_booking_calendar',[tenant,day,day])
 check(calConfigured.days[0].free,calBefore.days[0].free)
 ok(calConfigured.days[0].community_free.length===1)
 // Wider community travel padding does not widen patient free intervals.
 check(Date.parse(calConfigured.days[0].community_free[0].start),Date.parse(at('06:00'))-(60+settings.buffer_minutes+15*settings.boarding_minutes)*60000)
 await actor(null); await fails(()=>submitted(bid,data),/permission denied/)
 await actor(id(15)); await fails(()=>submitted(bid,data),/เข้าสู่ระบบ/)
 await actor(citizen); await fails(()=>submitted(bid,data,true),/รับจองแทน/)
 await fails(()=>submitted(randomUUID(),data,false,id(2)),/เข้าสู่ระบบ/)
 for(const malformed of [null,[],{...data,group_label:'x'.repeat(16000)}]) await fails(()=>submitted(randomUUID(),malformed),/ข้อมูลคำขอชุมชนไม่ถูกต้อง/)
 for(const [patch,error] of [
  [{patient_name:'health'},/ไม่รองรับ/],[{relation:'self'},/ไม่รองรับ/],[{mobility:'wheelchair'},/ไม่รองรับ/],
  [{companions:1},/ไม่รองรับ/],[{share:true},/ไม่รองรับ/],[{party_size:0},/1 ถึง 15/],[{party_size:16},/1 ถึง 15/],
  [{party_size:'3'},/ชนิดข้อมูล/],[{party_size:1.5},/1 ถึง 15/],[{consent:false},/ต้องยืนยัน/],
  [{consent_version:'patient-booking-v1'},/ข้อความใช้ข้อมูล/],[{privacy_notice:'stale'},/ข้อความใช้ข้อมูล/],
  [{owner_name:'wrong'},/ข้อความใช้ข้อมูล/],[{rules_version:0},/กฎบริการ/],[{rules_version:999},/กฎบริการ/],
  [{purpose_code:'no-such-activity'},/กิจกรรมชุมชน/],[{route_id:'a'},/สถานที่ชุมชน/],[{route_id:'__other__'},/สถานที่ชุมชน/],
  [{appointment_at:at('05:59')},/ช่วงบริการชุมชน/],[{appointment_at:at('20:01')},/ช่วงบริการชุมชน/],
  [{appointment_at:'infinity'},/ช่วงรับจอง/],[{appointment_at:'bad'},/วันเวลา/],
  [{return_at:at('06:59')},/รับกลับ/],[{return_at:`${nextDay}T19:00:00+07:00`},/รับกลับ/],
  [{return_mode:'one_way'},/ขาเดียว/],[{return_mode:'bad'},/รูปแบบรับกลับ/],
  [{pickup_lat:10},/พิกัด/],[{pickup_lat:91,pickup_lng:100},/พิกัด/],[{pickup_lat:'10',pickup_lng:100},/ชนิดข้อมูล/],
  [{phone:'garbage'},/ชื่อผู้ติดต่อ/],[{group_label:' '},/ชื่อผู้ติดต่อ/],[{pickup:'x'.repeat(501)},/ชื่อผู้ติดต่อ/],
 ]) await fails(()=>submitted(randomUUID(),{...data,...patch}),error)
 await fails(()=>rpc('ptb_community_payload',[tenant,data]),/permission denied/)
 // Community arrival bounds include their endpoints, even on an old configured holiday/Sunday.
 for(const time of ['06:00','20:00']) {
  const boundary=randomUUID()
  check(await submitted(boundary,{...data,appointment_at:at(time),return_mode:'one_way',return_at:null,party_size:15}),boundary)
  await actor(coordinator)
  const boundaryPlan=await preview([boundary]);check(boundaryPlan.seats,15);check(boundaryPlan.helper_required,false)
  ok(!boundaryPlan.errors.some(e=>e.includes('เวลา')||e.includes('วันหยุด')))
  await actor(citizen)
 }
 check(await submitted(bid,data),bid); check(await submitted(bid,data),bid)
 await fails(()=>submitted(bid,{...data,party_size:2}),/รหัสคำขอ/)
 await fails(()=>submitted(randomUUID(),data),/มีคำขอชุมชนนี้แล้ว/)
 await actor(id(14)); await fails(()=>submitted(bid,data),/รหัสคำขอ/)
 await actor(citizen)
 const mine=await rpc('patient_booking_mine',[tenant]); const own=mine.bookings.find(b=>b.id===bid)
 check([own.patient_name,own.relation,own.mobility,own.companions,own.share,own.party_size,own.service_type,own.consent_version],[null,null,'walk',0,false,3,'community','community-booking-v1'])
 ok(!('consent_text' in own))
 await fails(()=>rpc('patient_booking_amend_community',[tenant,randomUUID(),bid,1,data,'TEST']),/เฉพาะผู้ประสานงาน/)
 await actor(coordinator)
 const initialPlan=await preview([bid]); check(initialPlan.errors,[]); check(initialPlan.service_type,'community'); check(initialPlan.seats,3)
 check(initialPlan.outbound_waves[0].passengers,3); check(initialPlan.return_waves[0].passengers,3)
 check(Date.parse(initialPlan.pickup_at),Date.parse(data.appointment_at)-(60+settings.buffer_minutes+settings.boarding_minutes*3)*60000)
 check(Date.parse(initialPlan.blocks[0].end),Date.parse(data.appointment_at)+(60+settings.boarding_minutes*3)*60000)
 await fails(()=>rpc('patient_booking_amend',[tenant,randomUUID(),bid,1,{},'TEST']),/คำขอชุมชนต้องใช้/)
 await fails(()=>rpc('patient_booking_change_hospital',[tenant,randomUUID(),bid,{},'a','single']),/ชุมชนเปลี่ยนโรงพยาบาลไม่ได้/)
 check((await rpc('patient_booking_preview',[tenant,[bid],'TEST helper'])).errors.includes('งานชุมชนไม่ใช้ผู้ช่วยเคลื่อนย้าย'),true)
 // The service-specific shape is enforced even for SQL writes, not merely via the new RPC.
 await db.exec('RESET ROLE')
 for(const change of ["patient_name='TEST'","relation='self'","mobility='wheelchair'","companions=1","share=true","party_size=NULL","party_size=0","group_label=NULL","rules_version=NULL","requested_trip_id='00000000-0000-4000-8000-000000000200'"]) {
  await fails(()=>db.query(`UPDATE public.patient_bookings SET ${change} WHERE id=$1`,[bid]),/check constraint/)
 }
 await fails(()=>db.query('UPDATE public.patient_bookings SET patient_name=NULL WHERE id=$1',[id(100)]),/check constraint/)
 // Unknown/missing route or hours produces a visible plan blocker, not a guessed travel time.
 await db.query("UPDATE public.patient_bookings SET route_id='__other__' WHERE id=$1",[bid]); await actor(coordinator)
 ok((await preview([bid])).errors.includes('ยังไม่ตั้งสถานที่ชุมชนและเวลาเดินทาง'))
 await db.exec('RESET ROLE'); await db.query("UPDATE public.patient_bookings SET route_id='test-temple' WHERE id=$1",[bid])
 await db.query('UPDATE public.patient_bookings SET appointment_at=$1 WHERE id=$2',[at('05:59'),bid]); await actor(coordinator)
 ok((await preview([bid])).errors.includes('เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน'))
 await db.exec('RESET ROLE'); await db.query('UPDATE public.patient_bookings SET appointment_at=$1 WHERE id=$2',[data.appointment_at,bid]); await actor(coordinator)
 const amendOp=randomUUID(), changed={...data,group_label:'TEST กลุ่มแก้ไข',party_size:4}
 await rpc('patient_booking_amend_community',[tenant,amendOp,bid,1,changed,'TEST ติดต่อยืนยันแล้ว'])
 await rpc('patient_booking_amend_community',[tenant,amendOp,bid,1,changed,'TEST ติดต่อยืนยันแล้ว'])
 await fails(()=>rpc('patient_booking_amend_community',[tenant,randomUUID(),bid,1,changed,'TEST stale']),/ข้อมูลเปลี่ยนแล้ว/)
 await fails(()=>rpc('patient_booking_amend_community',[tenant,amendOp,bid,1,data,'TEST changed']),/รหัสการแก้/)
 await actor(citizen)
 await submitted(second,{...data,group_label:'TEST กลุ่มสอง',party_size:1,phone:'0800099001'})
 await rpc('patient_booking_submit',[tenant,patient,{...baseBooking,patient_name:'TEST patient conflict',companions:0,appointment_at:at('09:00'),return_at:at('14:00'),return_mode:'wait'}])
 await actor(coordinator)
 ok((await preview([bid,second])).errors.includes('งานชุมชนไม่เปิดร่วมเที่ยว'))
 ok((await preview([bid,patient])).errors.includes('ห้ามรวมงานผู้ป่วยกับงานชุมชน'))
 const patientPlan=await preview([patient]); check(patientPlan.errors,[])
 await rpc('patient_booking_confirm',[tenant,id(50102),[patient],patientPlan,''])
 const blocked=await preview([bid]); ok(blocked.errors.includes('ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว'))
 await fails(()=>rpc('patient_booking_confirm',[tenant,trip,[bid],blocked,'']),/ทับช่วงรถ/)
 await db.exec('RESET ROLE')
 check((await row('SELECT status,trip_id FROM public.patient_bookings WHERE id=$1',[bid])),{status:'submitted',trip_id:null})
 check(await row('SELECT count(*)::integer AS n FROM public.patient_booking_trips WHERE id=$1',[trip]),{n:0})
 await actor(coordinator)
 const pt=(await workspace()).trips.find(t=>t.id===id(50102))
 await rpc('patient_booking_action',[tenant,randomUUID(),pt.id,pt.revision,'release','TEST free slot agreed'])
 // Capacity uses members, not request count; amendment rollback preserves revision and party size.
 await fails(()=>rpc('patient_booking_amend_community',[tenant,randomUUID(),bid,2,{...changed,party_size:16},'TEST']),/1 ถึง 15/)
 await rpc('patient_booking_amend_community',[tenant,randomUUID(),second,1,{...data,group_label:'TEST กลุ่มสอง',party_size:5,phone:'0800099001'},'TEST five members'])
 ok((await preview([second])).errors.includes('ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว'))
 await actor(admin)
 const current=(await workspace()).community_rules
 await rpc('patient_booking_save_community_rules',[tenant,current.revision,{...rules,enabled:false}])
 await actor(citizen); await fails(()=>submitted(randomUUID(),data),/ปิดรับคำขอใหม่/)
 check(await submitted(bid,data),bid) // lost response retry survives closure and later amendment
 await actor(coordinator)
 let closedPlan=await preview([bid]); check(closedPlan.errors,[])
 check(closedPlan.seats,4)
 // One shared tenant resource lock covers policy changes as well as confirmation.
 await db.exec('RESET ROLE')
 for(const name of ['patient_booking_save_community_rules','patient_booking_submit_community','patient_booking_amend_community','patient_booking_confirm']) {
  const f=await row('SELECT prosrc FROM pg_proc WHERE pronamespace=\'public\'::regnamespace AND proname=$1',[name])
  ok(/patient_booking_settings WHERE municipality_id=p_muni FOR UPDATE/.test(f.prosrc),name)
 }
 await actor(admin)
 const closedRules=(await workspace()).community_rules
 await rpc('patient_booking_save_community_rules',[tenant,closedRules.revision,{...rules,enabled:false,rules_reference:'TEST policy revision after preview'}])
 await actor(coordinator)
 await fails(()=>rpc('patient_booking_confirm',[tenant,trip,[bid],closedPlan,'']),/แผนหรือข้อมูลเปลี่ยนแล้ว/)
 await db.exec('RESET ROLE')
 check((await row('SELECT status,trip_id FROM public.patient_bookings WHERE id=$1',[bid])),{status:'submitted',trip_id:null})
 await actor(coordinator)
 closedPlan=await preview([bid]);check(closedPlan.errors,[])
 await rpc('patient_booking_confirm',[tenant,trip,[bid],closedPlan,''])
 await rpc('patient_booking_confirm',[tenant,trip,[bid],closedPlan,''])
 await fails(()=>rpc('patient_booking_preview_into_trip',[tenant,second,trip]),/ไม่พร้อมรับผู้ร่วมเพิ่ม/)
 await fails(()=>rpc('patient_booking_amend_community',[tenant,randomUUID(),bid,3,changed,'TEST']),/ยังไม่ยืนยันเที่ยว/)
 await rpc('patient_booking_amend_community',[tenant,randomUUID(),second,2,{...data,rules_version:closedPlan.community_rules_version,group_label:'TEST กลุ่มสอง',party_size:2,phone:'0800099001'},'TEST correction while closed'])
 ok((await preview([patient])).errors.includes('ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว'))
 await actor(null)
 const calendar=await rpc('patient_booking_calendar',[tenant,day,day]); const publicTrip=calendar.days[0].trips.find(t=>t.id===trip)
 check([publicTrip.joinable,publicTrip.people,publicTrip.route_id,publicTrip.route_label],[false,null,null,'รถติดภารกิจ ไม่เปิดร่วมเที่ยว'])
 for(const secret of [data.requester_name,data.phone,data.pickup,changed.group_label,'booking_ids','party_size','group_label','pickup_lat']) ok(!JSON.stringify(calendar).includes(secret),secret)
 for(const key of ['free','community_free']) for(const free of calendar.days[0][key]) for(const block of closedPlan.blocks) ok(!(Date.parse(free.start)<Date.parse(block.end)&&Date.parse(block.start)<Date.parse(free.end)))
 await actor(driver)
 const dw=await workspace(), driverBooking=dw.bookings.find(b=>b.id===bid)
 check(driverBooking.service_type,'community'); check(driverBooking.party_size,4); check(driverBooking.patient_name,'กลุ่ม TEST กลุ่มแก้ไข (4 คน)')
 check(dw.community_rules,null); ok(!dw.bookings.some(b=>b.id===second)); ok(!JSON.stringify(driverBooking).includes('consent_text'))
 await actor(id(14)); ok(!(await rpc('patient_booking_mine',[tenant])).bookings.some(b=>b.id===bid))
 await actor(citizen); const ownAfter=await rpc('patient_booking_mine',[tenant]); const ownTrip=ownAfter.trips.find(t=>t.id===trip)
 ok(ownTrip); ok(!JSON.stringify(ownTrip).includes('booking_ids')); ok(!ownAfter.bookings.some(b=>b.id===second&&b.created_by!==citizen))
 for(const who of [citizen,driver,id(15)]) { await actor(who); await fails(()=>rpc('patient_booking_period_report_v2',[tenant,day,day,null]),/เฉพาะเจ้าหน้าที่/); await fails(()=>rpc('patient_booking_month_report_v2',[tenant,day,day,null]),/เฉพาะเจ้าหน้าที่/) }
 await actor(coordinator)
 const legacy=await rpc('patient_booking_period_report',[tenant,day,day]); ok(!legacy.trips.some(t=>t.trip_id===trip))
 ok(!(await rpc('patient_booking_month_report',[tenant,day])).trips.some(t=>t.trip_id===trip))
 const v2=await rpc('patient_booking_period_report_v2',[tenant,day,day,null]); check(v2.trips.filter(t=>t.trip_id===trip).length,1)
 check(v2.trips.find(t=>t.trip_id===trip).people,4); check(v2.trips.find(t=>t.trip_id===trip).distance,null)
 check(v2.trips.find(t=>t.trip_id===trip).request_count,1)
 check((await rpc('patient_booking_period_report_v2',[tenant,day,day,'patient'])).trips.some(t=>t.trip_id===trip),false)
 check((await rpc('patient_booking_month_report_v2',[tenant,day,day,'community'])).trips.map(t=>t.trip_id),[trip])
 await fails(()=>rpc('patient_booking_period_report_v2',[tenant,day,day,'bad']),/ประเภทบริการ/)
 await fails(()=>rpc('patient_booking_period_report_v2',[tenant,day,'infinity',null]),/วันที่เริ่ม/)
 // Existing two driver actions finish community work even while its intake flag is closed.
 await db.exec('RESET ROLE')
 await db.exec("UPDATE public.patient_booking_trips SET state='completed' WHERE id<>'"+trip+"' AND state IN ('outbound','hospital','returning','issue')")
 await actor(driver)
 const live=(await workspace()).trips.find(t=>t.id===trip)
 await rpc('patient_booking_action',[tenant,randomUUID(),trip,live.revision,'trip_next',''])
 const running=(await workspace()).trips.find(t=>t.id===trip)
 await rpc('patient_booking_action',[tenant,randomUUID(),trip,running.revision,'trip_finish',''])
 await actor(coordinator)
 const finished=(await workspace()).bookings.find(b=>b.id===bid); check(finished.status,'completed')
 await db.exec('RESET ROLE')
 await db.query('UPDATE public.patient_booking_trips SET odometer_start=100,odometer_end=120 WHERE id=$1',[trip])
 await actor(coordinator); check((await rpc('patient_booking_period_report_v2',[tenant,day,day,'community'])).trips[0].distance,20)
 await db.exec('RESET ROLE'); await db.query('UPDATE public.patient_booking_trips SET odometer_issue=true WHERE id=$1',[trip])
 await actor(coordinator); check((await rpc('patient_booking_period_report_v2',[tenant,day,day,'community'])).trips[0].distance,null)
 // Owner-only retention: local aged copies preserve statistics, never restore a community patient name.
 await db.exec('RESET ROLE')
 await db.query("UPDATE public.patient_bookings SET appointment_at=now()-interval '6 years',return_at=now()-interval '6 years' WHERE id=$1",[bid])
 const patientAged=id(50901)
 await db.query("INSERT INTO public.patient_bookings SELECT (jsonb_populate_record(NULL::public.patient_bookings,to_jsonb(b)||jsonb_build_object('id',$1::text,'status','completed','appointment_at',now()-interval '6 years','return_at',NULL,'trip_id',NULL,'patient_name','TEST aged patient'))).* FROM public.patient_bookings b WHERE id=$2",[patientAged,patient])
 const dry=await rpc('purge_expired_patient_booking_contacts',['5 years',true]); ok(dry.would_purge>=2)
 check((await row('SELECT group_label FROM public.patient_bookings WHERE id=$1',[bid])).group_label,changed.group_label)
 await rpc('purge_expired_patient_booking_contacts',['5 years',false])
 const purged=await row('SELECT patient_name,relation,group_label,phone,pickup_lat,pickup_lng,party_size,purpose_code,rules_version,consent_version FROM public.patient_bookings WHERE id=$1',[bid])
 check([purged.patient_name,purged.relation,purged.group_label,purged.phone,purged.pickup_lat,purged.pickup_lng],[null,null,null,'',null,null])
 check([purged.party_size,purged.purpose_code,purged.rules_version,purged.consent_version],[4,'test-activity',data.rules_version,'community-booking-v1'])
 check((await row('SELECT patient_name FROM public.patient_bookings WHERE id=$1',[patientAged])).patient_name,'ลบตามระยะเวลาเก็บรักษา')
 const operations=(await db.query('SELECT payload FROM public.patient_booking_operations WHERE id=$1 OR id=$2',[bid,amendOp])).rows
 for(const secret of [data.requester_name,data.phone,data.pickup,changed.group_label]) ok(!JSON.stringify(operations).includes(secret),'idempotency does not retain contact PII')
 check((await row('SELECT metadata FROM public.audit_logs WHERE metadata->\'fields\' ? \'group_label\' LIMIT 1')).metadata.fields.includes('group_label'),true)
 for(const who of [admin,coordinator,driver,citizen,null]) { await actor(who); await fails(()=>rpc('purge_expired_patient_booking_contacts',['5 years',false]),/permission denied/); await fails(()=>db.query('SELECT * FROM public.patient_booking_community_rules'),/permission denied/) }
 console.log(`PASS community backend: ${checks} acceptance checks; shared scheduler, closure, role/tenant/privacy, reports, retention and rollback.`)
} finally { await db.close() }
