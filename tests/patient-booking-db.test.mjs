// Isolated PostgreSQL (PGlite); never loads .env or connects to a project.
// PATIENT_PGLITE_MODULE points to an independently installed Apache-2.0 PGlite 0.5.8.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
const { PGlite } = await import(pathToFileURL(process.env.PATIENT_PGLITE_MODULE).href)
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const tenant = id(1), otherTenant = id(2), admin = id(10), coordinator = id(11), driver = id(12), citizen = id(13), citizen2 = id(14), outsider = id(15), partner = id(20)
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
CREATE TABLE public.municipalities(id uuid PRIMARY KEY);
CREATE TABLE public.profiles(id uuid PRIMARY KEY, municipality_id uuid,role text,full_name text);
CREATE TABLE public.referral_partners(id uuid PRIMARY KEY,municipality_id uuid,name text,is_active boolean,document_types text[],min_lead_days integer);
CREATE TABLE public.patient_transport_requests(request_id uuid PRIMARY KEY,municipality_id uuid);
INSERT INTO public.municipalities VALUES('${tenant}'),('${otherTenant}');
INSERT INTO public.profiles VALUES
 ('${admin}','${tenant}','admin','Admin TEST'),('${coordinator}','${tenant}','staff','Coordinator TEST'),
 ('${driver}','${tenant}','staff','Driver TEST'),('${citizen}','${tenant}','citizen','Citizen TEST'),
 ('${citizen2}','${tenant}','citizen','Citizen2 TEST'),('${outsider}','${otherTenant}','admin','Outside TEST');
INSERT INTO public.referral_partners VALUES('${partner}','${tenant}','Fund TEST',true,ARRAY['patient_transport_request'],0);
ALTER TABLE public.profiles ADD COLUMN phone text;
`)
for (const file of ['20260918110000_patient_booking_tables.sql','20260918110100_patient_booking_rules.sql','20260918110200_patient_booking_api.sql','20260918110300_patient_booking_amend.sql','20260918113759_patient_booking_calendar.sql','20260918170100_patient_booking_day_guards.sql','20260919120000_patient_booking_pickup_point.sql','20260919120100_patient_booking_pickup_rpc.sql','20260919130000_patient_booking_trip_documents_columns.sql','20260919130100_patient_booking_trip_documents_rpc.sql','20260919140000_patient_booking_trip_docs_revision.sql','20260919140100_patient_booking_trip_docs_guards.sql','20260919150000_patient_booking_flexible_odometer.sql','20260919150100_patient_booking_flexible_odometer_rpc.sql','20260919160000_patient_booking_schedule_columns.sql','20260919160100_patient_booking_schedule_rpc.sql','20260919170000_patient_booking_dual_role.sql','20260919180000_patient_booking_minimal_setup.sql']) {
 await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
}
const actor = async user => { await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user || '']); await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`) }
const rpc = async (name, args) => (await db.query(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) AS value`, args)).rows[0].value
const fails = async (fn, pattern) => { await assert.rejects(fn, pattern) }
const nextDay = new Date(); nextDay.setUTCDate(nextDay.getUTCDate()+10); while ([0,6].includes(nextDay.getUTCDay())) nextDay.setUTCDate(nextDay.getUTCDate()+1)
const day = nextDay.toISOString().slice(0,10), at = time => `${day}T${time}:00+07:00`
const settings = { enabled:true,partner_id:partner,driver_id:driver,coordinator_ids:[coordinator],office_start:510,office_end:990,seats:4,wheelchairs:1,stretchers:1,
 buffer_minutes:15,boarding_minutes:15,routes:[{id:'a',label:'Hospital A / Zone A TEST',minutes:30}],holidays:[],calendar_checked_through:'2099-12-31',unavailable:false,
 delegation_reference:'TEST authorization',privacy_notice:'TEST privacy notice',contact_phone:'0800000000' }
const base = {requester_name:'TEST requester',patient_name:'TEST patient',phone:'0800000001',relation:'self',pickup:'TEST pickup',in_area:true,route_id:'a',appointment_at:at('10:00'),mobility:'walk',companions:1,share:true,return_mode:'wait',return_at:at('12:00'),is_emergency:false,consent:true,consent_version:'patient-booking-v1',privacy_notice:settings.privacy_notice,owner_name:'Fund TEST'}
await actor(admin); await rpc('patient_booking_save_settings',[tenant,1,settings])
await db.exec('RESET ROLE')
await fails(()=>db.query('INSERT INTO public.patient_transport_requests VALUES($1,$2)',[id(98),tenant]),/ระบบจองรถใหม่/)
await actor(admin)
await fails(()=>rpc('patient_booking_save_settings',[tenant,1,settings]),/เปลี่ยนแล้ว/)
await actor(outsider); await fails(()=>rpc('patient_booking_workspace',[tenant]),/ไม่มีสิทธิ์/)
await actor(citizen); await fails(()=>rpc('patient_booking_save_settings',[tenant,2,settings]),/เฉพาะผู้ดูแล/)
await fails(()=>db.query('SELECT * FROM public.patient_bookings'),/permission denied/)
await fails(()=>rpc('ptb_plan',[tenant,[id(50)],'']),/permission denied/)
await actor(null); const info = await rpc('patient_booking_info',[tenant]); assert.equal(info.owner_name,'Fund TEST'); assert(!('driver_id' in info)); await fails(()=>rpc('patient_booking_workspace',[tenant]),/permission denied/)
console.log('PASS default-deny table/helper permissions, tenant isolation, public projection, settings revision')

await actor(citizen); const booking1=id(100), booking2=id(101)
await rpc('patient_booking_submit',[tenant,booking1,base]); await rpc('patient_booking_submit',[tenant,booking1,base])
await fails(()=>rpc('patient_booking_submit',[tenant,id(199),base]),/มีคำขอนี้แล้ว/)
await fails(()=>rpc('patient_booking_submit',[tenant,id(198),{...base,patient_name:'another',consent:false}]),/ต้องยืนยัน/)
await fails(()=>rpc('patient_booking_submit',[tenant,id(197),{...base,patient_name:'another',relation:'relative'}]),/ผู้จองแทน/)
await fails(()=>rpc('patient_booking_submit',[tenant,id(196),{...base,patient_name:'another',privacy_notice:'outdated'}]),/ข้อความใช้ข้อมูลเปลี่ยน/)
await actor(citizen2); await fails(()=>rpc('patient_booking_submit',[tenant,booking1,base]),/รหัสคำขอ/)
await rpc('patient_booking_submit',[tenant,booking2,{...base,patient_name:'TEST patient2',appointment_at:at('10:15'),phone:'0800000002'}])
let ws=await rpc('patient_booking_workspace',[tenant]); assert.equal(ws.bookings.length,1)
await fails(()=>rpc('patient_booking_action',[tenant,randomUUID(),booking1,1,'cancel','']),/ไม่มีสิทธิ์/)
console.log('PASS consent, representation, duplicate and idempotency ownership, per-citizen visibility')

await actor(coordinator); const plan=await rpc('patient_booking_preview',[tenant,[booking1,booking2],'']); assert.deepEqual(plan.errors,[]); assert.equal(plan.seats,4)
await fails(()=>rpc('patient_booking_confirm',[tenant,id(299),[booking1,booking2],{...plan,pickup_at:at('00:00')},'']),/แผนหรือข้อมูลเปลี่ยน/)
const trip1=id(200); await rpc('patient_booking_confirm',[tenant,trip1,[booking1,booking2],plan,'']); await rpc('patient_booking_confirm',[tenant,trip1,[booking1,booking2],plan,''])
await fails(()=>rpc('patient_booking_confirm',[tenant,id(201),[booking1],plan,'']),/ถูกจัดคิว/)
await actor(citizen); ws=await rpc('patient_booking_workspace',[tenant]); assert.equal(ws.bookings.length,1); assert(!('booking_ids' in ws.trips[0])); assert(!('booking_ids' in ws.trips[0].plan)); assert(!('helper_name' in ws.trips[0])); assert(ws.notices.length>0)
await rpc('patient_booking_submit',[tenant,id(102),{...base,patient_name:'TEST conflict',phone:'0800000003'}])
await actor(coordinator); const conflict=await rpc('patient_booking_preview',[tenant,[id(102)],'']); assert(conflict.errors.some(x=>x.includes('ทับช่วง')))
await fails(()=>rpc('patient_booking_confirm',[tenant,id(202),[id(102)],conflict,'']),/ทับช่วง/)
console.log('PASS shared capacity, authoritative conflict prevention, confirmation retry, no co-passenger disclosure')

await actor(driver); ws=await rpc('patient_booking_workspace',[tenant]); assert.equal(ws.bookings.length,2); assert(!('consent_text' in ws.bookings[0])); assert(!('created_by' in ws.bookings[0]));
await db.exec('RESET ROLE'); await db.query("UPDATE public.profiles SET role='citizen' WHERE id=$1",[driver]); await actor(driver)
assert.equal((await rpc('patient_booking_workspace',[tenant])).bookings.length,0)
await fails(()=>rpc('patient_booking_action',[tenant,randomUUID(),trip1,1,'trip_next','']),/ไม่มีสิทธิ์/)
await db.exec('RESET ROLE'); await db.query("UPDATE public.profiles SET role='staff' WHERE id=$1",[driver]); await actor(driver)
await fails(()=>rpc('patient_booking_preview',[tenant,[booking1],'']),/ไม่มีสิทธิ์/)
await fails(()=>rpc('patient_booking_action',[tenant,randomUUID(),booking1,2,'cancel','']),/เฉพาะผู้จอง/)
const advance = async (entity,revision,action,note='') => rpc('patient_booking_action',[tenant,randomUUID(),entity,revision,action,note])
const op=randomUUID(); await rpc('patient_booking_action',[tenant,op,trip1,1,'trip_next','']); await rpc('patient_booking_action',[tenant,op,trip1,1,'trip_next','']);
await fails(()=>advance(trip1,1,'trip_next'),/เปลี่ยนแล้ว/)
await fails(()=>advance(trip1,2,'trip_next'),/ครบทุกคน/)
for (const b of [booking1,booking2]) {
 await advance(b,2,'passenger_next')
 await actor(coordinator); await fails(()=>advance(b,3,'cancel_passenger','TEST cannot remove while travelling'),/ระหว่างเดินทาง/)
 await actor(driver); await advance(b,3,'passenger_next')
}
await advance(trip1,2,'trip_next')
await actor(citizen); await advance(booking1,4,'ready_return')
await actor(driver); await advance(trip1,3,'trip_next')
await advance(booking1,5,'passenger_next'); await advance(booking1,6,'passenger_next')
await fails(()=>advance(trip1,4,'trip_next'),/ครบทุกคน/)
await advance(booking2,4,'passenger_next'); await advance(booking2,5,'passenger_next'); await advance(trip1,4,'trip_next')
await actor(citizen); ws=await rpc('patient_booking_workspace',[tenant]); assert.equal(ws.bookings.find(b=>b.id===booking1).status,'completed')
console.log('PASS per-passenger outbound/return progression, revision guard, retry exactly once, complete only after all passengers')

const laterDay = new Date(nextDay); laterDay.setUTCDate(laterDay.getUTCDate()+7); const later=laterDay.toISOString().slice(0,10)
await rpc('patient_booking_submit',[tenant,id(103),{...base,patient_name:'TEST later',appointment_at:`${later}T10:00:00+07:00`,return_at:`${later}T15:00:00+07:00`,return_mode:'later'}])
await actor(coordinator); const laterPlan=await rpc('patient_booking_preview',[tenant,[id(103)],'']); assert.equal(laterPlan.blocks.length,2); assert.deepEqual(laterPlan.errors,[])
await rpc('patient_booking_confirm',[tenant,id(203),[id(103)],laterPlan,''])
await actor(citizen); await advance(id(103),2,'cancel'); ws=await rpc('patient_booking_workspace',[tenant]); assert.equal(ws.bookings.find(b=>b.id===id(103)).status,'confirmed'); assert(ws.bookings.find(b=>b.id===id(103)).cancel_requested)
await actor(driver); await advance(id(203),1,'issue','TEST broken vehicle')
await fails(()=>advance(id(203),2,'trip_next'),/ไม่พร้อม/)
await actor(coordinator); await advance(id(203),2,'release','TEST caller agreed cancellation')
await actor(citizen); ws=await rpc('patient_booking_workspace',[tenant]); assert.equal(ws.bookings.find(b=>b.id===id(103)).status,'cancelled')
console.log('PASS separate return blocks, confirmed cancellation request, incident and coordinator release with reason')

await rpc('patient_booking_submit',[tenant,id(104),{...base,patient_name:'TEST wheelchair',mobility:'wheelchair',appointment_at:`${later}T10:00:00+07:00`,return_at:null}])
await actor(coordinator); const guarded=await rpc('patient_booking_preview',[tenant,[id(104)],'']); assert(guarded.errors.some(x=>x.includes('ผู้ช่วย'))); assert(guarded.errors.some(x=>x.includes('เวลาขากลับ')))
await actor(admin); await rpc('patient_booking_save_settings',[tenant,2,{...settings,unavailable:true}]);
await actor(coordinator); const blocked=await rpc('patient_booking_preview',[tenant,[id(102)],'']); assert(blocked.errors.some(x=>x.includes('ไม่พร้อม')))
console.log('PASS unknown return, helper requirement, unavailable resource')
await actor(coordinator)
await rpc('patient_booking_amend',[tenant,randomUUID(),id(104),1,{appointment_at:`${later}T11:00:00+07:00`,return_at:`${later}T13:00:00+07:00`,return_mode:'later',route_id:'a',pickup:'TEST corrected pickup',in_area:true},'TEST requester confirmed new details'])
await fails(()=>rpc('patient_booking_amend',[tenant,randomUUID(),id(104),1,{},'TEST stale revision']),/ข้อมูลเปลี่ยนแล้ว/)
await actor(citizen); const amended=await rpc('patient_booking_workspace',[tenant]); assert.equal(amended.bookings.find(b=>b.id===id(104)).pickup,'TEST corrected pickup')
await fails(()=>rpc('patient_booking_amend',[tenant,randomUUID(),id(104),2,{},'not authorized']),/เฉพาะผู้ประสานงาน/)
console.log('PASS coordinator amendment, updated citizen view, citizen cannot bypass staff review')

// Public calendar and attaching a request to an already confirmed trip.
await actor(admin); await rpc('patient_booking_save_settings',[tenant,3,settings])
const calendarDate = new Date(nextDay); calendarDate.setUTCDate(calendarDate.getUTCDate()+14)
const calendarDay=calendarDate.toISOString().slice(0,10), calendarAt=t=>`${calendarDay}T${t}:00+07:00`
const calendarBase={...base,patient_name:'TEST calendar existing',appointment_at:calendarAt('10:30'),return_at:calendarAt('14:00'),return_mode:'later',companions:0}
await actor(citizen); await rpc('patient_booking_submit',[tenant,id(400),calendarBase])
await actor(coordinator); const cp=await rpc('patient_booking_preview',[tenant,[id(400)],'']);assert.deepEqual(cp.errors,[])
await rpc('patient_booking_confirm',[tenant,id(410),[id(400)],cp,''])
await actor(null); let cal=await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay]); let cd=cal.days[0]
assert.equal(cd.trips[0].remaining,3);assert.equal(cd.trips[0].people,1);assert.equal(cd.trips[0].joinable,true);assert.equal(cd.free.length,3)
assert(!JSON.stringify(cal).includes('TEST calendar existing'));assert(!JSON.stringify(cal).includes(base.phone));assert(!JSON.stringify(cal).includes('booking_ids'));assert(!JSON.stringify(cal).includes('helper_name'))
await fails(()=>rpc('ptb_join_plan',[tenant,id(400)]),/permission denied/)
await fails(()=>rpc('patient_booking_calendar',[tenant,calendarDay,'2099-01-01']),/62/)
assert.deepEqual((await rpc('patient_booking_calendar',[otherTenant,calendarDay,calendarDay])).days,[])
await actor(citizen2)
await fails(()=>rpc('patient_booking_submit_join',[tenant,id(401),id(410),{...calendarBase,patient_name:'TEST bad join',share:false}]),/ร่วมเที่ยว/)
await fails(()=>rpc('patient_booking_submit_join',[tenant,id(401),id(410),{...calendarBase,patient_name:'TEST bad join',companions:4}]),/ที่นั่ง/)
assert(!(await rpc('patient_booking_workspace',[tenant])).bookings.some(b=>b.id===id(401)), 'Failed join must roll back insert')
await rpc('patient_booking_submit_join',[tenant,id(401),id(410),{...calendarBase,patient_name:'TEST joiner',phone:'0800000401',companions:1}])
await rpc('patient_booking_submit_join',[tenant,id(401),id(410),{}])
await fails(()=>rpc('patient_booking_preview_join',[tenant,id(401)]),/ไม่มีสิทธิ์/)
await actor(outsider);await fails(()=>rpc('patient_booking_submit_join',[tenant,id(402),id(410),calendarBase]),/หน่วยงานนี้/)
await actor(citizen);await rpc('patient_booking_submit_join',[tenant,id(403),id(410),{...calendarBase,patient_name:'TEST competing join',phone:'0800000403',companions:1}]);
await actor(coordinator);const competing=await rpc('patient_booking_preview_join',[tenant,id(403)]);assert.deepEqual(competing.errors,[]);const jp=await rpc('patient_booking_preview_join',[tenant,id(401)]);assert.deepEqual(jp.errors,[])
await fails(()=>rpc('patient_booking_confirm_join',[tenant,randomUUID(),id(401),{...jp,join_trip_revision:99}]),/เปลี่ยนแล้ว/)
const joinOp=randomUUID();assert.equal(await rpc('patient_booking_confirm_join',[tenant,joinOp,id(401),jp]),id(410));await rpc('patient_booking_confirm_join',[tenant,joinOp,id(401),jp])
await fails(()=>rpc('patient_booking_confirm_join',[tenant,randomUUID(),id(403),competing]),/เปลี่ยนแล้ว/);const noRoom=await rpc('patient_booking_preview_join',[tenant,id(403)]);assert(noRoom.errors.some(e=>e.includes('ที่นั่ง')));await fails(()=>rpc('patient_booking_confirm_join',[tenant,randomUUID(),id(403),noRoom]),/ที่นั่ง/);await actor(citizen);await rpc('patient_booking_action',[tenant,randomUUID(),id(403),1,'cancel','']);
await actor(null);cal=await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay]);assert.equal(cal.days[0].trips.length,1);assert.equal(cal.days[0].trips[0].people,3);assert.equal(cal.days[0].trips[0].remaining,1)
await actor(citizen);await fails(()=>rpc('patient_booking_submit_join',[tenant,id(401),id(410),{}]),/รหัสคำขอ/)
await fails(()=>rpc('patient_booking_submit_join',[tenant,id(402),id(410),{...calendarBase,patient_name:'TEST full join',companions:1}]),/ที่นั่ง/)
await db.exec('RESET ROLE');await db.query('UPDATE public.patient_bookings SET share=false WHERE id=$1',[id(400)])
await actor(null);cal=await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay]);assert.equal(cal.days[0].trips[0].people,null);assert.equal(cal.days[0].trips[0].route_id,null);assert.equal(cal.days[0].trips[0].joinable,false)
await db.exec('RESET ROLE');await db.query('UPDATE public.patient_bookings SET share=true WHERE id=$1',[id(400)])
await actor(admin);await rpc('patient_booking_save_settings',[tenant,4,{...settings,holidays:[calendarDay]}]);await actor(null);cal=await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay]);assert.equal(cal.days[0].status,'closed');assert.deepEqual(cal.days[0].free,[]);assert.equal(cal.days[0].trips[0].joinable,false)
await actor(admin);await rpc('patient_booking_save_settings',[tenant,5,settings])
console.log('PASS public calendar free intervals, privacy, bounds, holidays; join validation, atomic rollback, existing-trip confirmation and retry')
// Day guards at intake: requests the queue could never confirm are refused here, staff intake is not.
await actor(null);const svc=await rpc('patient_booking_info',[tenant]);assert.equal(svc.buffer_minutes,15);assert.equal(svc.boarding_minutes,15)
const weekend=new Date();weekend.setUTCDate(weekend.getUTCDate()+1);while(weekend.getUTCDay()!==6)weekend.setUTCDate(weekend.getUTCDate()+1)
const satDay=weekend.toISOString().slice(0,10),satAt=time=>`${satDay}T${time}:00+07:00`
const weekendBooking={...base,patient_name:'TEST weekend',phone:'0800000500',appointment_at:satAt('10:00'),return_at:satAt('12:00')}
await actor(citizen);await fails(()=>rpc('patient_booking_submit',[tenant,id(500),weekendBooking]),/วันหยุด/)
await actor(coordinator);assert.equal(await rpc('patient_booking_submit',[tenant,id(500),weekendBooking]),id(500))
const holiday=new Date();holiday.setUTCDate(holiday.getUTCDate()+20);while([0,6].includes(holiday.getUTCDay()))holiday.setUTCDate(holiday.getUTCDate()+1)
const holidayDay=holiday.toISOString().slice(0,10),holidayAt=time=>`${holidayDay}T${time}:00+07:00`
await actor(admin);await rpc('patient_booking_save_settings',[tenant,6,{...settings,holidays:[holidayDay]}])
await actor(citizen);await fails(()=>rpc('patient_booking_submit',[tenant,id(501),{...base,patient_name:'TEST holiday',phone:'0800000501',appointment_at:holidayAt('10:00'),return_at:holidayAt('12:00')}]),/วันหยุด/)
const checked=new Date();checked.setUTCDate(checked.getUTCDate()+5);
await actor(admin);await rpc('patient_booking_save_settings',[tenant,7,{...settings,calendar_checked_through:checked.toISOString().slice(0,10)}])
await actor(citizen);assert.equal(await rpc('patient_booking_submit',[tenant,id(502),{...base,patient_name:'TEST unchecked',phone:'0800000502',appointment_at:holidayAt('10:00'),return_at:holidayAt('12:00')}]),id(502))
await actor(coordinator);assert(!(await rpc('patient_booking_preview',[tenant,[id(502)],''])).errors.some(e=>e.includes('ปฏิทิน')))
await actor(null);assert.notEqual((await rpc('patient_booking_calendar',[tenant,holidayDay,holidayDay])).days[0].status,'unverified')
await actor(admin);await rpc('patient_booking_save_settings',[tenant,8,{...settings,unavailable:true}])
await actor(citizen);await fails(()=>rpc('patient_booking_submit',[tenant,id(503),{...base,patient_name:'TEST unavailable',phone:'0800000503'}]),/งดรับจอง/)
await actor(coordinator);assert.equal(await rpc('patient_booking_submit',[tenant,id(503),{...base,patient_name:'TEST unavailable',phone:'0800000503'}]),id(503))
await actor(admin);await rpc('patient_booking_save_settings',[tenant,9,settings])
console.log('PASS intake guards for weekends, holidays and unavailable vehicle; expired calendar does not block intake or planning; staff intake still accepted')
// หมุดจุดรับ: เป็นทางเลือก แต่ถ้าส่งมาต้องครบคู่ อยู่ในพื้นที่ และห้ามหลุดไปหน้าสาธารณะ
const pinned={...base,patient_name:'TEST pinned',phone:'0800000600',pickup_lat:18.1234,pickup_lng:100.1234}
await actor(citizen);await rpc('patient_booking_submit',[tenant,id(600),pinned])
const mine=(await rpc('patient_booking_workspace',[tenant])).bookings.find(b=>b.id===id(600))
assert.equal(Number(mine.pickup_lat),18.1234);assert.equal(Number(mine.pickup_lng),100.1234)
await fails(()=>rpc('patient_booking_submit',[tenant,id(601),{...base,patient_name:'TEST half pin',phone:'0800000601',pickup_lat:18.1}]),/หมุดจุดรับไม่สมบูรณ์/)
await fails(()=>rpc('patient_booking_submit',[tenant,id(602),{...base,patient_name:'TEST far pin',phone:'0800000602',pickup_lat:48.85,pickup_lng:2.35}]),/นอกพื้นที่/)
assert.equal(await rpc('patient_booking_submit',[tenant,id(603),{...base,patient_name:'TEST no pin',phone:'0800000603'}]),id(603))
const noPin=(await rpc('patient_booking_workspace',[tenant])).bookings.find(b=>b.id===id(603))
assert.equal(noPin.pickup_lat,null,'ไม่ปักหมุดต้องจองได้และค่าว่าง')
await actor(coordinator);const queue=(await rpc('patient_booking_workspace',[tenant])).bookings.find(b=>b.id===id(600))
assert.equal(Number(queue.pickup_lat),18.1234,'เจ้าหน้าที่จัดคิวต้องเห็นหมุด')
await actor(null);const publicCal=await rpc('patient_booking_calendar',[tenant,day,day])
assert(!JSON.stringify(publicCal).includes('pickup_lat'),'ตารางรถสาธารณะห้ามมีพิกัดจุดรับ')
assert(!JSON.stringify(publicCal).includes('18.1234'),'ตารางรถสาธารณะห้ามมีพิกัดจุดรับ')
await actor(citizen);for(const gone of [id(600),id(603)]){await rpc('patient_booking_action',[tenant,randomUUID(),gone,1,'cancel',''])}
console.log('PASS optional pickup pin: stored for staff/driver, pair+bounds validated, never in the public calendar')

// เอกสารถึงกองทุน: เลขหนังสือนำส่งต่อเที่ยว + เลขไมล์ + สรุปรายเดือน (ไม่มีชื่อผู้ป่วย)
await actor(coordinator)
const liveTrip=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.state!=='cancelled')
assert(liveTrip,'ต้องมีเที่ยวที่ยังไม่ยกเลิกให้ทดสอบ')
const tripRevision=liveTrip.revision
const today=new Date().toISOString().slice(0,10)
let docRev=liveTrip.docs_revision
docRev=await rpc('patient_booking_record_letter',[tenant,liveTrip.id,docRev,' พร 72301/55 ',today])
// ยิงคำสั่งเดิมซ้ำ (revision เก่า ค่าเดิม) = เน็ตหลุดแล้วลองใหม่ ต้องสำเร็จโดยไม่เขียนซ้ำ
assert.equal(await rpc('patient_booking_record_letter',[tenant,liveTrip.id,docRev-1,'พร 72301/55',today]),docRev,'คำสั่งซ้ำต้องตอบ revision ปัจจุบัน')
// คำสั่งเก่าที่ค่าต่างจากปัจจุบัน = ข้อมูลเก่าจะทับข้อมูลใหม่ ต้องถูกปฏิเสธ (ผลตรวจ #227 ข้อ 2)
await fails(()=>rpc('patient_booking_record_letter',[tenant,liveTrip.id,docRev-1,'พร 72301/54',today]),/เปลี่ยนแล้ว/)
await fails(()=>rpc('patient_booking_record_letter',[tenant,liveTrip.id,docRev,'',today]),/เลขที่หนังสือ/)
await fails(()=>rpc('patient_booking_record_letter',[tenant,liveTrip.id,docRev,'x','2600-01-01']),/วันที่หนังสือ/)
await actor(driver);await fails(()=>rpc('patient_booking_record_letter',[tenant,liveTrip.id,docRev,'y',today]),/เจ้าหน้าที่จัดคิว/)
await actor(citizen);await fails(()=>rpc('patient_booking_record_letter',[tenant,liveTrip.id,docRev,'y',today]),/เจ้าหน้าที่จัดคิว/)
await actor(outsider);await fails(()=>rpc('patient_booking_record_letter',[tenant,liveTrip.id,docRev,'y',today]),/เจ้าหน้าที่จัดคิว/)
await actor(driver);docRev=await rpc('patient_booking_record_odometer',[tenant,liveTrip.id,docRev,12000,12042])
await fails(()=>rpc('patient_booking_record_odometer',[tenant,liveTrip.id,docRev,12000,11999]),/ไม่น้อยกว่า/)
await fails(()=>rpc('patient_booking_record_odometer',[tenant,liveTrip.id,docRev,12000,15000]),/2,000/)
await actor(citizen);await fails(()=>rpc('patient_booking_record_odometer',[tenant,liveTrip.id,docRev,1,2]),/คนขับของเที่ยวนี้/)
// คนขับที่ถูกลดสิทธิ์เป็นประชาชนแล้วต้องแก้เลขไมล์เที่ยวเดิมไม่ได้ (ผลตรวจ #227 ข้อ 1)
await db.exec('RESET ROLE');await db.query("UPDATE public.profiles SET role='citizen' WHERE id=$1",[driver])
await actor(driver);await fails(()=>rpc('patient_booking_record_odometer',[tenant,liveTrip.id,docRev,12000,12050]),/ยังเป็นเจ้าหน้าที่/)
await db.exec('RESET ROLE');await db.query("UPDATE public.profiles SET role='staff' WHERE id=$1",[driver])
await actor(coordinator);await fails(()=>rpc('patient_booking_record_odometer',[tenant,liveTrip.id,docRev-1,11000,11010]),/เปลี่ยนแล้ว/)
const after=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===liveTrip.id)
assert.equal(after.forward_letter_no,'พร 72301/55','ตัดช่องว่างหัวท้ายเลขหนังสือ');assert.equal(after.odometer_end,12042,'ค่าเก่าต้องไม่ทับค่าใหม่')
assert.equal(after.revision,tripRevision,'เลขหนังสือ/เลขไมล์ต้องไม่เพิ่ม revision สถานะของเที่ยว');assert.equal(after.docs_revision,docRev)
const events=(await rpc('patient_booking_workspace',[tenant])).events.map(e=>e.action)
assert(events.includes('letter_recorded')&&events.includes('odometer_recorded'),'ต้องมีบันทึกย้อนตรวจ')
const report=await rpc('patient_booking_month_report',[tenant,liveTrip.plan.date])
const row=report.trips.find(r=>r.trip_id===liveTrip.id)
assert.equal(row.distance,42);assert.equal(row.letter_no,'พร 72301/55');assert(row.passengers>=1);assert.equal(row.state,after.state,'รายงานต้องส่งสถานะเที่ยวให้ใบพิมพ์แยกยอด')
assert(!/"(patient_name|requester_name|phone|pickup|pickup_lat|pickup_lng)":/.test(JSON.stringify(report)),'สรุปรายเดือนห้ามมีชื่อ เบอร์ หรือจุดรับ (pickup_at คือเวลาเริ่มรับของเที่ยว ไม่ใช่ข้อมูลส่วนบุคคล)')
await actor(driver);await fails(()=>rpc('patient_booking_month_report',[tenant,today]),/เจ้าหน้าที่จัดคิว/)
console.log('PASS fund documents: letter no per trip, odometer by current staff driver only, stale writes rejected, retries idempotent, month report without personal data, audit')

await actor(coordinator)
let flexTrip=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===liveTrip.id)
await fails(()=>rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexTrip.docs_revision,13000,13033,false,'']),/เหตุผล/)
let flexRev=await rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexTrip.docs_revision,13000,13033,false,'กรอกผิด'])
assert.equal(await rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexTrip.docs_revision,13000,13033,false,'กรอกผิด']),flexRev)
await fails(()=>rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexRev-1,12000,12042,false,'กรอกผิด']),/เปลี่ยนแล้ว/)
await fails(()=>rpc('patient_booking_record_odometer',[tenant,liveTrip.id,flexRev,14000,14033]),/เหตุผล/)
flexRev=await rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexRev,13000,50,true,'เปลี่ยนมาตรวัด'])
let flexReport=await rpc('patient_booking_month_report',[tenant,liveTrip.plan.date]);assert.equal(flexReport.trips.find(t=>t.trip_id===liveTrip.id).distance,null)
flexRev=await rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexRev,null,null,true,'มาตรวัดมีปัญหา'])
await fails(()=>rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexRev,13000,13044,false,'']),/เหตุผล/)
await rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexRev,13000,13044,false,'ตรวจสอบแก้ไขแล้ว'])
await actor(citizen);await fails(()=>rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexRev,1,2,true,'กรอกผิด']),/คนขับ/)
await db.exec('RESET ROLE');await db.query("UPDATE public.profiles SET role='citizen' WHERE id=$1",[driver]);await actor(driver)
await fails(()=>rpc('patient_booking_save_odometer',[tenant,liveTrip.id,flexRev,1,2,true,'กรอกผิด']),/ยังเป็นเจ้าหน้าที่/)
await db.exec('RESET ROLE');await db.query("UPDATE public.profiles SET role='staff' WHERE id=$1",[driver])
console.log('PASS flexible odometer corrections require reason, revoked driver denied, stale and legacy writes guarded, anomaly excluded from report, repair restored')
// Schedule communication: isolated CAS, strict public projection, authorized roles only.
await actor(coordinator)
const scheduleBefore=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===id(410))
const scheduleArgs=[tenant,id(410),scheduleBefore.schedule_revision,'delayed',calendarAt('10:00'),calendarAt('14:30')]
const scheduleRevision=await rpc('patient_booking_update_schedule',scheduleArgs)
assert.equal(await rpc('patient_booking_update_schedule',scheduleArgs),scheduleRevision)
await fails(()=>rpc('patient_booking_update_schedule',[...scheduleArgs.slice(0,3),'contact',null,null]),/เปลี่ยนแล้ว/)
await fails(()=>rpc('patient_booking_update_schedule',[tenant,id(410),scheduleRevision,'TEST private note',null,null]),/ข้อความ/)
await fails(()=>rpc('patient_booking_update_schedule',[tenant,id(410),scheduleRevision,'normal',at('10:00'),null]),/วันเดินทาง/)
await fails(()=>rpc('patient_booking_update_schedule',[tenant,id(410),scheduleRevision,'normal',calendarAt('15:00'),null]),/ไม่เกินเวลารับกลับ/)
const scheduleAfter=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===id(410))
assert.deepEqual(scheduleAfter.plan,scheduleBefore.plan);assert.equal(scheduleAfter.revision,scheduleBefore.revision);assert.equal(scheduleAfter.docs_revision,scheduleBefore.docs_revision)
assert.equal(scheduleAfter.driver_name,'Driver TEST')
await actor(null);let published=(await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay])).days[0].trips[0]
assert.equal(published.public_notice,'delayed');assert.equal(published.state,'confirmed');assert(published.estimated_pickup_at)
assert(!('driver_name' in published));assert(!('issue_note' in published))
for(const user of [null,citizen,driver,outsider]) { await actor(user);await fails(()=>rpc('patient_booking_update_schedule',[tenant,id(410),scheduleRevision,'normal',null,null]),/permission denied|เจ้าหน้าที่จัดคิว/) }
await actor(coordinator);await fails(()=>rpc('patient_booking_update_schedule',[otherTenant,id(410),scheduleRevision,'normal',null,null]),/เจ้าหน้าที่จัดคิว/)
await fails(()=>rpc('patient_booking_update_schedule',[tenant,trip1,1,'normal',null,null]),/จบหรือยกเลิก/)
await db.exec('RESET ROLE');await db.query('UPDATE public.patient_bookings SET share=false WHERE id=$1',[id(400)])
await actor(null);published=(await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay])).days[0].trips[0]
for(const key of ['route_id','people','state','public_notice','estimated_pickup_at','estimated_return_at']) assert.equal(published[key],null,`private trip leaked ${key}`)
await actor(citizen);const myTrip=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===id(410));assert.equal(myTrip.public_notice,'delayed');assert(myTrip.estimated_pickup_at);assert(!('driver_name' in myTrip))
await db.exec('RESET ROLE');await db.query('UPDATE public.patient_bookings SET share=true WHERE id=$1',[id(400)])
await db.query("UPDATE public.patient_booking_trips SET plan=plan||'{\"test_replan\":true}'::jsonb WHERE id=$1",[id(410)])
await actor(coordinator);const replanned=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===id(410));assert.equal(replanned.estimated_pickup_at,null);assert.equal(replanned.public_notice,'normal');assert.equal(replanned.schedule_revision,scheduleRevision+1)
await fails(()=>rpc('patient_booking_update_schedule',[tenant,id(410),scheduleRevision,'contact',null,null]),/เปลี่ยนแล้ว/)
await rpc('patient_booking_update_schedule',[tenant,id(410),replanned.schedule_revision,'delayed',calendarAt('10:10'),null])
await db.exec('RESET ROLE');await db.query("UPDATE public.patient_booking_trips SET state='completed' WHERE id=$1",[id(410)])
await actor(coordinator);const closedSchedule=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===id(410));assert.equal(closedSchedule.public_notice,'normal');assert.equal(closedSchedule.estimated_pickup_at,null)
await db.exec('RESET ROLE');await db.query("UPDATE public.patient_booking_trips SET state='confirmed' WHERE id=$1",[id(410)])
console.log('PASS schedule role/tenant guards, stale edits, retry, estimated time validation, private-trip secrecy, own-booking updates, reserved blocks unchanged and estimates cleared on replan')

await actor(admin);const dualRevision=(await rpc('patient_booking_workspace',[tenant])).settings.revision
await fails(()=>rpc('patient_booking_save_settings',[tenant,dualRevision,{...settings,coordinator_ids:[citizen]}]),/เจ้าหน้าที่หน่วยงานนี้/)
await fails(()=>rpc('patient_booking_save_settings',[tenant,dualRevision,{...settings,coordinator_ids:[outsider]}]),/เจ้าหน้าที่หน่วยงานนี้/)
await rpc('patient_booking_save_settings',[tenant,dualRevision,{...settings,coordinator_ids:[driver]}])
await actor(driver);assert.equal((await rpc('patient_booking_workspace',[tenant])).role,'coordinator')
await fails(()=>rpc('patient_booking_save_settings',[tenant,dualRevision+1,settings]),/เฉพาะผู้ดูแล/)
await fails(()=>rpc('patient_booking_workspace',[otherTenant]),/ไม่มีสิทธิ์/)
await db.exec('RESET ROLE');await db.query("UPDATE public.profiles SET role='citizen' WHERE id=$1",[driver]);await actor(driver)
assert.equal((await rpc('patient_booking_workspace',[tenant])).role,'citizen')
await fails(()=>rpc('patient_booking_preview',[tenant,[id(400)],'']),/ไม่มีสิทธิ์/)
await db.exec('RESET ROLE');await db.query("UPDATE public.profiles SET role='staff' WHERE id=$1",[driver]);await actor(admin)
await rpc('patient_booking_save_settings',[tenant,dualRevision+1,settings])
await actor(driver);assert.equal((await rpc('patient_booking_workspace',[tenant])).role,'driver')
console.log('PASS explicit dual assignment, admin-only changes, tenant/staff checks and removal of coordinator permission')
if (!process.env.PATIENT_UI_QA) await db.close()
console.log('All isolated PostgreSQL checks passed.')
export { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, id, day, calendarDay }
