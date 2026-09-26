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
INSERT INTO public.referral_partners VALUES('${partner}','${tenant}','Fund TEST',true,ARRAY['patient_transport_request'],3);
CREATE TABLE public.audit_logs(id bigserial PRIMARY KEY,municipality_id uuid,actor_id uuid,actor_name text,actor_role text,action text,resource_type text,resource_id uuid,resource_label text,metadata jsonb,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.profiles ADD COLUMN phone text;
`)
for (const file of ['20260918110000_patient_booking_tables.sql','20260918110100_patient_booking_rules.sql','20260918110200_patient_booking_api.sql','20260918110300_patient_booking_amend.sql','20260918113759_patient_booking_calendar.sql','20260918170100_patient_booking_day_guards.sql','20260919120000_patient_booking_pickup_point.sql','20260919120100_patient_booking_pickup_rpc.sql','20260919130000_patient_booking_trip_documents_columns.sql','20260919130100_patient_booking_trip_documents_rpc.sql','20260919140000_patient_booking_trip_docs_revision.sql','20260919140100_patient_booking_trip_docs_guards.sql','20260919150000_patient_booking_flexible_odometer.sql','20260919150100_patient_booking_flexible_odometer_rpc.sql','20260919160000_patient_booking_schedule_columns.sql','20260919160100_patient_booking_schedule_rpc.sql','20260919170000_patient_booking_dual_role.sql','20260919180000_patient_booking_minimal_setup.sql','20260919190000_patient_booking_entry_channel.sql','20260919190100_patient_booking_entry_channel_rpc.sql','20260919200000_patient_booking_mine.sql','20260920120000_patient_booking_retention.sql','20260920120100_patient_booking_retention_fn.sql','20260921120000_patient_booking_staff_join.sql','20260922120000_patient_booking_staff_entry_owner.sql','20260922130000_patient_booking_cancel_reason.sql','20260923114252_patient_booking_admin_delete.sql','20260924154340_patient_booking_exact_appointment_hours.sql','20260924232558_patient_booking_month_calendar.sql','20260926114444_patient_booking_all_days_public_pending.sql']) {
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
await actor(null); const info = await rpc('patient_booking_info',[tenant]); assert.equal(info.owner_name,'Fund TEST'); assert.equal(info.min_lead_days,0); assert(!('driver_id' in info)); await fails(()=>rpc('patient_booking_workspace',[tenant]),/permission denied/)
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
await actor(null); let pendingDay=(await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay])).days[0]
assert.equal(pendingDay.pending_count,1)
assert(!JSON.stringify(pendingDay).includes('TEST calendar existing'))
assert(!JSON.stringify(pendingDay).includes(calendarBase.pickup))
await actor(coordinator); const cp=await rpc('patient_booking_preview',[tenant,[id(400)],'']);assert.deepEqual(cp.errors,[])
await rpc('patient_booking_confirm',[tenant,id(410),[id(400)],cp,''])
await actor(null); let cal=await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay]); let cd=cal.days[0]
assert.equal(cd.pending_count,0);assert.equal(cd.trips[0].remaining,3);assert.equal(cd.trips[0].people,1);assert.equal(cd.trips[0].joinable,true);assert.equal(cd.free.length,3)
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
await actor(null);cal=await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay]);assert.equal(cal.days[0].trips[0].people,null);assert.equal(cal.days[0].trips[0].route_id,null);assert.equal(cal.days[0].trips[0].appointment_at,null);assert.equal(cal.days[0].trips[0].joinable,false)
await db.exec('RESET ROLE');await db.query('UPDATE public.patient_bookings SET share=true WHERE id=$1',[id(400)])
await actor(admin);await rpc('patient_booking_save_settings',[tenant,4,{...settings,holidays:[calendarDay]}]);await actor(null);cal=await rpc('patient_booking_calendar',[tenant,calendarDay,calendarDay]);assert.equal(cal.days[0].status,'open');assert.equal(cal.days[0].trips[0].joinable,true)
await actor(admin);await rpc('patient_booking_save_settings',[tenant,5,settings])
console.log('PASS public calendar pending count and confirmed trips without personal data; holiday dates remain open')
// Intake still rejects an unavailable vehicle, but weekends and configured holiday dates remain bookable.
await actor(null);const svc=await rpc('patient_booking_info',[tenant]);assert.equal(svc.buffer_minutes,15);assert.equal(svc.boarding_minutes,15)
const weekend=new Date();weekend.setUTCDate(weekend.getUTCDate()+1);while(weekend.getUTCDay()!==6)weekend.setUTCDate(weekend.getUTCDate()+1)
const satDay=weekend.toISOString().slice(0,10),satAt=time=>`${satDay}T${time}:00+07:00`
const weekendBooking={...base,patient_name:'TEST weekend',phone:'0800000500',appointment_at:satAt('10:00'),return_at:satAt('12:00')}
await actor(citizen);assert.equal(await rpc('patient_booking_submit',[tenant,id(505),weekendBooking]),id(505))
await actor(coordinator);assert.deepEqual((await rpc('patient_booking_preview',[tenant,[id(505)],''])).errors,[])
assert.equal(await rpc('patient_booking_submit',[tenant,id(500),{...weekendBooking,patient_name:'TEST staff weekend',phone:'0800000590'},true]),id(500))
await actor(null);pendingDay=(await rpc('patient_booking_calendar',[tenant,satDay,satDay])).days[0]
assert.equal(pendingDay.status,'open');assert.equal(pendingDay.pending_count,2)
assert(!JSON.stringify(pendingDay).includes('TEST weekend'));assert(!JSON.stringify(pendingDay).includes(weekendBooking.phone))
const holiday=new Date();holiday.setUTCDate(holiday.getUTCDate()+20);while([0,6].includes(holiday.getUTCDay()))holiday.setUTCDate(holiday.getUTCDate()+1)
const holidayDay=holiday.toISOString().slice(0,10),holidayAt=time=>`${holidayDay}T${time}:00+07:00`
await actor(admin);await rpc('patient_booking_save_settings',[tenant,6,{...settings,holidays:[holidayDay]}])
await actor(citizen);assert.equal(await rpc('patient_booking_submit',[tenant,id(501),{...base,patient_name:'TEST holiday',phone:'0800000501',appointment_at:holidayAt('10:00'),return_at:holidayAt('12:00')}]),id(501))
const checked=new Date();checked.setUTCDate(checked.getUTCDate()+5);
await actor(admin);await rpc('patient_booking_save_settings',[tenant,7,{...settings,calendar_checked_through:checked.toISOString().slice(0,10)}])
await actor(citizen);assert.equal(await rpc('patient_booking_submit',[tenant,id(502),{...base,patient_name:'TEST unchecked',phone:'0800000502',appointment_at:holidayAt('10:00'),return_at:holidayAt('12:00')}]),id(502))
await actor(coordinator);assert(!(await rpc('patient_booking_preview',[tenant,[id(502)],''])).errors.some(e=>e.includes('ปฏิทิน')))
await actor(null);pendingDay=(await rpc('patient_booking_calendar',[tenant,holidayDay,holidayDay])).days[0]
assert.equal(pendingDay.status,'open');assert.equal(pendingDay.pending_count,2)
await actor(admin);await rpc('patient_booking_save_settings',[tenant,8,{...settings,unavailable:true}])
await actor(citizen);await fails(()=>rpc('patient_booking_submit',[tenant,id(503),{...base,patient_name:'TEST unavailable',phone:'0800000503'}]),/งดรับจอง/)
await actor(coordinator);await fails(()=>rpc('patient_booking_submit',[tenant,id(503),{...base,patient_name:'TEST unavailable',phone:'0800000503'}]),/งดรับจอง/)
assert.equal(await rpc('patient_booking_submit',[tenant,id(503),{...base,patient_name:'TEST unavailable',phone:'0800000503'},true]),id(503))
await actor(admin);await rpc('patient_booking_save_settings',[tenant,9,settings])
const todayLocal=(await db.query("SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS day")).rows[0].day
await actor(citizen);await fails(()=>rpc('patient_booking_submit',[tenant,id(506),{...base,patient_name:'TEST past hour',phone:'0800000506',appointment_at:`${todayLocal}T00:01:00+07:00`,return_at:null,return_mode:'one_way'}]),/เวลานัดผ่านมาแล้ว/)
const tomorrow=(await db.query("SELECT ((now() AT TIME ZONE 'Asia/Bangkok')::date+1)::text AS day")).rows[0].day
await actor(citizen);assert.equal(await rpc('patient_booking_submit',[tenant,id(504),{...base,patient_name:'TEST tomorrow',phone:'0800000504',appointment_at:`${tomorrow}T10:00:00+07:00`,return_at:`${tomorrow}T12:00:00+07:00`}]),id(504))
await actor(null);pendingDay=(await rpc('patient_booking_calendar',[tenant,tomorrow,tomorrow])).days[0]
assert.equal(pendingDay.status,'open');assert.equal(pendingDay.pending_count,1)
assert.deepEqual((await rpc('patient_booking_calendar',[otherTenant,tomorrow,tomorrow])).days,[])
console.log('PASS weekend, holiday and next-day intake despite old 3-day setting; unavailable vehicle still blocked; public pending counts are tenant-scoped')
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
// ธงรับจองแทนเป็นคำสั่งของหน้าทำงาน ไม่ใช่สิทธิ์ที่ติดมากับบัญชี และต้องเหลือร่องรอยไว้ตรวจ
await actor(citizen)
await fails(()=>rpc('patient_booking_submit',[tenant,id(510),{...base,patient_name:'TEST channel',phone:'0800000510'},true]),/ไม่มีสิทธิ์รับจองแทน/)
await db.exec('RESET ROLE')
const channels=Object.fromEntries((await db.query('SELECT id,entry_channel FROM public.patient_bookings WHERE id IN ($1,$2)',[booking1,id(500)])).rows.map(r=>[r.id,r.entry_channel]))
assert.equal(channels[booking1],'online')
assert.equal(channels[id(500)],'staff')
const staffEvent=(await db.query("SELECT detail FROM public.patient_booking_events WHERE entity_id=$1 AND action='submitted'",[id(500)])).rows[0]
assert.equal(staffEvent.detail.entry_channel,'staff')
console.log('PASS staff intake is an explicit command, citizens cannot claim it, and the channel is recorded')

// หน้าประชาชนใช้ patient_booking_mine ซึ่งคืนเฉพาะของตัวเองไม่ว่าบทบาทจะเป็นอะไร
await actor(coordinator)
const coordinatorMine = await rpc('patient_booking_mine',[tenant])
const coordinatorQueue = await rpc('patient_booking_workspace',[tenant])
assert.equal(coordinatorMine.role,'coordinator')
assert(coordinatorQueue.bookings.length>coordinatorMine.bookings.length,'ผู้จัดคิวต้องเห็นคิวทั้งหน่วยงานเฉพาะในหน้าทำงาน')
assert(coordinatorMine.bookings.every(b=>b.created_by===coordinator),'patient_booking_mine ต้องคืนเฉพาะคำขอของผู้เรียก')
for (const key of ['settings','events','partners','people']) assert(!(key in coordinatorMine),`patient_booking_mine ต้องไม่ส่ง ${key} มาที่หน้าประชาชน`)
assert(coordinatorMine.trips.every(t=>!('driver_id' in t) && !('booking_ids' in (t.plan||{}))),'เที่ยวในหน้าประชาชนต้องไม่มีข้อมูลภายใน')
await actor(citizen)
const citizenMine = await rpc('patient_booking_mine',[tenant])
assert(citizenMine.bookings.every(b=>b.created_by===citizen))
await actor(outsider); await fails(()=>rpc('patient_booking_mine',[tenant]),/ไม่มีสิทธิ์/)
await actor(null); await fails(()=>rpc('patient_booking_mine',[tenant]),/permission denied/)
console.log('PASS citizen-page projection: own bookings only, no staff data, tenant and anonymous denied')

// ระยะเวลาเก็บข้อมูล: ลบเฉพาะคำขอที่ปิดแล้วและครบกำหนด ไม่แตะงานที่ยังค้างในคิว และเรียกผ่าน API ไม่ได้
await db.exec('RESET ROLE')
const retentionRow = async (n, status, monthsAgo) => {
 await db.query(`INSERT INTO public.patient_bookings(id,municipality_id,created_by,requester_name,phone,patient_name,relation,pickup,in_area,route_id,route_label,appointment_at,mobility,companions,share,return_mode,return_at,status,consent_text,pickup_lat,pickup_lng)
  VALUES($1,$2,$3,'TEST เก็บรักษา','0800000777','TEST ผู้ป่วยเก็บรักษา','self','TEST จุดรับเก็บรักษา',true,'a','TEST route',now()-($4||' months')::interval,'walk',0,false,'wait',now()-($4||' months')::interval + interval '3 hours',$5,'TEST consent',18.1,99.9)`,
  [id(n), tenant, citizen, String(monthsAgo), status])
 return id(n)
}
const doneOld = await retentionRow(900, 'completed', 72)      // ปิดแล้ว 6 ปี → ต้องลบ
const cancelledOld = await retentionRow(901, 'cancelled', 70) // ยกเลิกแล้ว ~5 ปีครึ่ง → ต้องลบ
const doneRecent = await retentionRow(902, 'completed', 6)    // ปิดแล้วแต่ยังไม่ครบ → ห้ามแตะ
const openOld = await retentionRow(903, 'submitted', 80)      // ครบกำหนดแต่ยังค้างในคิว → ห้ามแตะ แต่ต้องรายงาน
const preview = (await db.query("SELECT public.purge_expired_patient_booking_contacts('5 years',true) AS v")).rows[0].v
assert.equal(preview.dry_run, true)
assert.equal(preview.would_purge, 2, 'ต้องนับเฉพาะคำขอที่ปิดแล้วและครบกำหนด')
assert.equal(preview.skipped_still_open, 1, 'คำขอที่ยังค้างในคิวต้องถูกรายงาน ไม่ใช่ลบเงียบ')
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.patient_bookings WHERE contact_purged_at IS NOT NULL')).rows[0].n, 0, 'dry run ต้องไม่แก้ข้อมูล')
const purged = (await db.query("SELECT public.purge_expired_patient_booking_contacts('5 years') AS v")).rows[0].v
assert.equal(purged.purged, 2)
const cleaned = (await db.query('SELECT patient_name,requester_name,phone,pickup,pickup_lat,mobility,status,contact_purged_at FROM public.patient_bookings WHERE id=$1', [doneOld])).rows[0]
assert.equal(cleaned.patient_name, 'ลบตามระยะเวลาเก็บรักษา'); assert.equal(cleaned.requester_name, 'ลบตามระยะเวลาเก็บรักษา')
assert.equal(cleaned.phone, ''); assert.equal(cleaned.pickup, 'ลบตามระยะเวลาเก็บรักษา'); assert.equal(cleaned.pickup_lat, null)
assert.equal(cleaned.mobility, 'walk', 'ข้อมูลเชิงสถิติที่ไม่ระบุตัวบุคคลต้องอยู่ครบ'); assert.equal(cleaned.status, 'completed')
assert(cleaned.contact_purged_at, 'ต้องบันทึกว่าลบเมื่อไร')
for (const [key, keep] of [[doneRecent, 'TEST ผู้ป่วยเก็บรักษา'], [openOld, 'TEST ผู้ป่วยเก็บรักษา']]) {
 assert.equal((await db.query('SELECT patient_name FROM public.patient_bookings WHERE id=$1', [key])).rows[0].patient_name, keep, 'ยังไม่ครบกำหนดหรือยังไม่ปิดงาน ต้องไม่ถูกลบ')
}
const logged = (await db.query("SELECT actor_role,resource_type,metadata FROM public.audit_logs WHERE action='purge_contact_pii'")).rows
assert.equal(logged.length, 1); assert.equal(logged[0].resource_type, 'patient_booking'); assert.equal(logged[0].metadata.bookings, 2)
assert.equal((await db.query("SELECT public.purge_expired_patient_booking_contacts('5 years') AS v")).rows[0].v.purged, 0, 'รันซ้ำต้องไม่ลบซ้ำ')
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.patient_bookings WHERE id=$1', [cancelledOld])).rows[0].n, 1, 'ลบข้อมูลติดต่อ ไม่ใช่ลบทั้งแถว')
await assert.rejects(db.query("UPDATE public.patient_bookings SET phone='12345' WHERE id=$1", [doneRecent]), /patient_bookings_phone_check/, 'ยังต้องกันเบอร์รูปแบบผิดเหมือนเดิม')
for (const user of [citizen, coordinator, admin, null]) {
 await actor(user)
 await fails(() => rpc('purge_expired_patient_booking_contacts', []), /permission denied/)
}
await db.exec('RESET ROLE')
console.log('PASS retention: closed and expired bookings lose identifying fields only, open queue untouched, audited, idempotent, API-denied')

// เจ้าหน้าที่ให้คำขอที่ชนคิวไปคันเดียวกับเที่ยวที่ยืนยันแล้ว (20260921120000_patient_booking_staff_join)
const joinDate = new Date(nextDay); joinDate.setUTCDate(joinDate.getUTCDate()+30); while ([0,6].includes(joinDate.getUTCDay())) joinDate.setUTCDate(joinDate.getUTCDate()+1)
const joinDay = joinDate.toISOString().slice(0,10), joinAt = t => `${joinDay}T${t}:00+07:00`
const joinBase = {...base, appointment_at: joinAt('10:00'), return_at: joinAt('12:00'), return_mode: 'wait', companions: 0, share: true}
await actor(citizen); await rpc('patient_booking_submit',[tenant,id(700),{...joinBase,patient_name:'TEST ไปคันเดิม A',phone:'0800000600'}])
await actor(coordinator); const soloPlan = await rpc('patient_booking_preview',[tenant,[id(700)],'']); assert.deepEqual(soloPlan.errors,[])
await rpc('patient_booking_confirm',[tenant,id(710),[id(700)],soloPlan,''])
await actor(citizen2); await rpc('patient_booking_submit',[tenant,id(701),{...joinBase,patient_name:'TEST ไปคันเดิม B',phone:'0800000601',appointment_at:joinAt('10:15')}])
await actor(coordinator); assert((await rpc('patient_booking_preview',[tenant,[id(701)],''])).errors.includes('ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว'), 'ต้องชนคิวก่อน ถึงจะมีเหตุให้รวมเที่ยว')
// เฉพาะผู้ดูแล/ผู้จัดคิว · anon เรียกไม่ได้เลย · ตัวคำนวณภายในเรียกตรงไม่ได้
await actor(citizen2)
await fails(()=>rpc('patient_booking_preview_into_trip',[tenant,id(701),id(710)]),/ไม่มีสิทธิ์/)
await fails(()=>rpc('patient_booking_confirm_into_trip',[tenant,randomUUID(),id(701),id(710),{}]),/ไม่มีสิทธิ์/)
await actor(driver); await fails(()=>rpc('patient_booking_preview_into_trip',[tenant,id(701),id(710)]),/ไม่มีสิทธิ์/)
await actor(outsider); await fails(()=>rpc('patient_booking_preview_into_trip',[tenant,id(701),id(710)]),/ไม่มีสิทธิ์/)
await actor(null); await fails(()=>rpc('patient_booking_preview_into_trip',[tenant,id(701),id(710)]),/permission denied/)
await actor(coordinator); await fails(()=>rpc('ptb_join_plan_to',[tenant,id(701),id(710)]),/permission denied/)
const into = await rpc('patient_booking_preview_into_trip',[tenant,id(701),id(710)])
assert.deepEqual(into.errors,[]); assert.equal(into.join_trip_id,id(710)); assert.equal(into.join_booking_id,id(701))
assert.deepEqual([...into.booking_ids].sort(),[id(700),id(701)].sort())
assert(Date.parse(into.pickup_at) < Date.parse(soloPlan.pickup_at), 'ขึ้นรถเพิ่ม 1 คน รถต้องออกรับเร็วขึ้น — หน้าจอต้องบอกเวลาใหม่ก่อนกด')
// แผนที่ส่งมาไม่ตรงของจริง/ไม่ใช่เที่ยวนี้ = ปฏิเสธ และต้องไม่มีอะไรค้าง (requested_trip_id ต้องไม่ถูกตั้ง)
await fails(()=>rpc('patient_booking_confirm_into_trip',[tenant,randomUUID(),id(701),id(710),{...into,join_trip_revision:99}]),/เปลี่ยนแล้ว/)
await fails(()=>rpc('patient_booking_confirm_into_trip',[tenant,randomUUID(),id(701),id(711),into]),/เปลี่ยนแล้ว/)
await fails(()=>rpc('patient_booking_confirm_into_trip',[tenant,randomUUID(),id(700),id(710),into]),/เปลี่ยนแล้ว/)
await db.exec('RESET ROLE'); assert.equal((await db.query('SELECT requested_trip_id FROM public.patient_bookings WHERE id=$1',[id(701)])).rows[0].requested_trip_id,null,'ยืนยันไม่ผ่านต้องย้อนกลับทั้งก้อน')
await actor(coordinator); const intoOp = randomUUID()
assert.equal(await rpc('patient_booking_confirm_into_trip',[tenant,intoOp,id(701),id(710),into]),id(710))
assert.equal(await rpc('patient_booking_confirm_into_trip',[tenant,intoOp,id(701),id(710),into]),id(710),'กดซ้ำด้วยรายการเดิมต้องได้ผลเดิม')
await actor(admin); await fails(()=>rpc('patient_booking_confirm_into_trip',[tenant,intoOp,id(701),id(710),into]),/รหัสการทำรายการ/)
await db.exec('RESET ROLE')
const joinedTrip = (await db.query('SELECT booking_ids,plan FROM public.patient_booking_trips WHERE id=$1',[id(710)])).rows[0]
assert.deepEqual([...joinedTrip.booking_ids].sort(),[id(700),id(701)].sort())
assert.equal(Date.parse(joinedTrip.plan.pickup_at),Date.parse(into.pickup_at)); assert(!('join_trip_id' in joinedTrip.plan))
const joinedRow = (await db.query('SELECT status,trip_id,requested_trip_id FROM public.patient_bookings WHERE id=$1',[id(701)])).rows[0]
assert.equal(joinedRow.status,'confirmed'); assert.equal(joinedRow.trip_id,id(710)); assert.equal(joinedRow.requested_trip_id,id(710))
assert.equal((await db.query("SELECT count(*)::int AS n FROM public.patient_booking_events WHERE entity_id=$1 AND action='staff_join' AND actor_id=$2",[id(701),coordinator])).rows[0].n,1,'บันทึกว่าเจ้าหน้าที่คนไหนรวมเที่ยว ครั้งเดียวแม้กดซ้ำ')
assert.equal((await db.query("SELECT count(*)::int AS n FROM public.patient_booking_events WHERE entity_id=$1 AND action='confirmed_join'",[id(710)])).rows[0].n,1)
const toldNewTime = (await db.query("SELECT recipient_id FROM public.patient_booking_notices WHERE entity_id=$1 AND message LIKE 'เพิ่มผู้ร่วมเที่ยว%'",[id(710)])).rows.map(r=>r.recipient_id)
assert(toldNewTime.includes(citizen) && toldNewTime.includes(citizen2) && toldNewTime.includes(driver), 'ผู้เดินทางเดิม ผู้เดินทางใหม่ และคนขับต้องได้รับแจ้งเวลาใหม่')
// ไม่ยินยอมนั่งร่วมกับผู้ป่วยอื่น = รวมไม่ได้ แม้เจ้าหน้าที่สั่ง (ความยินยอมของเจ้าของข้อมูล)
await actor(citizen2); await rpc('patient_booking_submit',[tenant,id(702),{...joinBase,patient_name:'TEST ไม่นั่งร่วม',phone:'0800000602',appointment_at:joinAt('10:20'),share:false}])
await actor(coordinator); const privateJoin = await rpc('patient_booking_preview_into_trip',[tenant,id(702),id(710)])
assert(privateJoin.errors.includes('ร่วมเที่ยวได้เฉพาะผู้เดินได้และยินดีร่วมเที่ยว'))
await fails(()=>rpc('patient_booking_confirm_into_trip',[tenant,randomUUID(),id(702),id(710),privateJoin]),/ร่วมเที่ยว/)
await db.exec('RESET ROLE'); assert.equal((await db.query('SELECT requested_trip_id,status FROM public.patient_bookings WHERE id=$1',[id(702)])).rows[0].status,'submitted')
// ของเดิม (ประชาชนขอร่วมเองจากปฏิทิน) ไม่เปลี่ยน: ไม่ได้ขอร่วมเที่ยวใด = ปฏิเสธด้วยข้อความเดิม
await actor(coordinator); await fails(()=>rpc('patient_booking_preview_join',[tenant,id(702)]),/เที่ยวนี้ไม่เปิดร่วมแล้ว/)
await fails(()=>rpc('patient_booking_preview_into_trip',[tenant,id(702),null]),/เที่ยวนี้ไม่เปิดร่วมแล้ว/)
await db.exec('RESET ROLE')
console.log('PASS staff join into a confirmed trip: coordinator-only, earlier pickup previewed, stale plan rolls back, retry once, consent to share enforced, citizen join unchanged')

// คำขอที่เจ้าหน้าที่รับแทน = งานของสำนักงาน ไม่ใช่ "ของฉัน" ของคนที่กรอก (20260922120000_patient_booking_staff_entry_owner)
// created_by ของคำขอกลุ่มนี้เป็นเจ้าหน้าที่ — เดิมสิทธิ์แบบผู้จองติดตัวเจ้าหน้าที่คนนั้นไป แม้ถูกถอดจากผู้จัดคิวแล้ว
const ownerDate = new Date(nextDay); ownerDate.setUTCDate(ownerDate.getUTCDate()+37); while ([0,6].includes(ownerDate.getUTCDay())) ownerDate.setUTCDate(ownerDate.getUTCDate()+1)
const ownerAt = t => `${ownerDate.toISOString().slice(0,10)}T${t}:00+07:00`
const phoneBooking = id(800), ownBooking = id(801)
const revisionOf = async bookingId => { await db.exec('RESET ROLE'); return (await db.query('SELECT revision FROM public.patient_bookings WHERE id=$1',[bookingId])).rows[0].revision }
await actor(coordinator)
await rpc('patient_booking_submit',[tenant,phoneBooking,{...base,patient_name:'TEST โทรมาจอง',phone:'0800000800',appointment_at:ownerAt('10:00'),return_at:ownerAt('12:00')},true])
await rpc('patient_booking_submit',[tenant,ownBooking,{...base,patient_name:'TEST จองเองผ่านหน้าประชาชน',phone:'0800000801',appointment_at:ownerAt('13:00'),return_at:ownerAt('15:00')}])
let ownerMine = await rpc('patient_booking_mine',[tenant])
assert(ownerMine.bookings.some(b=>b.id===ownBooking),'คำขอที่เจ้าหน้าที่จองเองผ่านหน้าประชาชนยังเป็น "ของฉัน"')
assert(!ownerMine.bookings.some(b=>b.id===phoneBooking),'คำขอที่รับแทนต้องไม่อยู่ใน "คำขอของฉัน" ของคนที่กรอก')
assert((await rpc('patient_booking_workspace',[tenant])).bookings.some(b=>b.id===phoneBooking),'ผู้จัดคิวยังเห็นในหน้าทำงานตามบทบาท')
// ยกเลิกคำขอที่รับแทนต้องมีเหตุผลเสมอ แม้เป็นคนกรอกเอง (การไม่ให้บริการต้องตรวจย้อนได้)
let ownerRev = await revisionOf(phoneBooking); await actor(coordinator)
await fails(()=>rpc('patient_booking_action',[tenant,randomUUID(),phoneBooking,ownerRev,'cancel','']),/กรุณาระบุเหตุผล/)
// ถอดจากผู้จัดคิว (บทบาทกลายเป็น citizen) = หมดสิทธิ์กับคำขอที่เคยรับแทนทันที ทั้งอ่านและสั่ง
await db.exec('RESET ROLE'); await db.query("UPDATE public.profiles SET role='citizen' WHERE id=$1",[coordinator]); await actor(coordinator)
ownerMine = await rpc('patient_booking_mine',[tenant]); const formerQueue = await rpc('patient_booking_workspace',[tenant])
assert.equal(ownerMine.role,'citizen'); assert.equal(formerQueue.role,'citizen')
assert(!ownerMine.bookings.some(b=>b.id===phoneBooking) && !formerQueue.bookings.some(b=>b.id===phoneBooking),'ถอดสิทธิ์แล้วต้องไม่เห็นข้อมูลของคนที่โทรมาจองอีก (PDPA)')
assert(ownerMine.bookings.some(b=>b.id===ownBooking),'คำขอที่จองเองยังเห็นตามปกติ')
await fails(()=>rpc('patient_booking_action',[tenant,randomUUID(),phoneBooking,ownerRev,'cancel','TEST อ้างเป็นผู้จอง']),/ไม่มีสิทธิ์/)
await fails(()=>rpc('patient_booking_action',[tenant,randomUUID(),phoneBooking,ownerRev,'ready_return','']),/ไม่มีสิทธิ์/)
ownerRev = await revisionOf(ownBooking); await actor(coordinator)
await rpc('patient_booking_action',[tenant,randomUUID(),ownBooking,ownerRev,'cancel',''])
await db.exec('RESET ROLE'); assert.equal((await db.query('SELECT status FROM public.patient_bookings WHERE id=$1',[ownBooking])).rows[0].status,'cancelled','คำขอที่จองเองยกเลิกได้แบบผู้จองทั่วไป ไม่ต้องมีเหตุผล')
await db.query("UPDATE public.profiles SET role='staff' WHERE id=$1",[coordinator])
ownerRev = await revisionOf(phoneBooking); await actor(coordinator)
await rpc('patient_booking_action',[tenant,randomUUID(),phoneBooking,ownerRev,'cancel','TEST ผู้จองโทรแจ้งยกเลิก'])
await db.exec('RESET ROLE')
assert.equal((await db.query('SELECT status FROM public.patient_bookings WHERE id=$1',[phoneBooking])).rows[0].status,'cancelled')
const phoneCancel = (await db.query("SELECT detail->>'note' AS note,actor_id FROM public.patient_booking_events WHERE entity_id=$1 AND action='cancel'",[phoneBooking])).rows[0]
assert.equal(phoneCancel.note,'TEST ผู้จองโทรแจ้งยกเลิก'); assert.equal(phoneCancel.actor_id,coordinator,'ประวัติต้องบอกเหตุผลและคนที่กด')
// เก็บกวาด: เทสต์เบราว์เซอร์ใช้ฐานข้อมูลนี้ต่อ และถือว่าผู้จัดคิวยังไม่เคยจองเองผ่านหน้าประชาชน (ไม่มี FK อ้างถึงคำขอ)
await db.query('DELETE FROM public.patient_bookings WHERE id=$1',[ownBooking])
// ด่านกันเขียนทับ: นิยามปัจจุบันไม่ใช่ของที่ไฟล์คาดไว้ (apply ซ้ำ หรือมีคนแก้ไปก่อน) = หยุดทั้งก้อน ไม่แตะอะไร
const ownerMigration = await readFile(new URL('../supabase/migrations/20260922120000_patient_booking_staff_entry_owner.sql', import.meta.url), 'utf8')
const actionBefore = (await db.query("SELECT md5(prosrc) AS m FROM pg_proc WHERE proname='patient_booking_action'")).rows[0].m
await assert.rejects(db.exec(ownerMigration), /ไม่ตรงกับที่ไฟล์นี้คาดไว้/)
await db.exec('ROLLBACK')
assert.equal((await db.query("SELECT md5(prosrc) AS m FROM pg_proc WHERE proname='patient_booking_action'")).rows[0].m,actionBefore,'ด่านไม่ผ่านต้องไม่เขียนทับอะไร')
console.log('PASS phone bookings belong to the office: not in the taker\'s "mine", reason always required, access ends with the role, overwrite guard refuses drifted definitions')

// ผู้จองเห็นเหตุผลที่เจ้าหน้าที่ยกเลิก (20260922130000_patient_booking_cancel_reason)
// เหตุผลถูกบังคับให้พิมพ์และลงประวัติอยู่แล้ว แต่หน้าประชาชนขึ้นแค่ป้าย "ยกเลิกแล้ว" คนที่รอรถต้องโทรถามเองว่าทำไมไม่ได้รถ
const reasonDate = new Date(ownerDate); reasonDate.setUTCDate(reasonDate.getUTCDate()+37); while ([0,6].includes(reasonDate.getUTCDay())) reasonDate.setUTCDate(reasonDate.getUTCDate()+1)
const reasonAt = t => `${reasonDate.toISOString().slice(0,10)}T${t}:00+07:00`
const declined=id(810), selfCancel=id(811), removed=id(812), stillOpen=id(813)
await actor(citizen2)
for (const [bookingId,go,back] of [[declined,'09:00','11:00'],[selfCancel,'10:00','12:00'],[removed,'11:00','13:00'],[stillOpen,'13:00','15:00']])
 await rpc('patient_booking_submit',[tenant,bookingId,{...base,patient_name:`TEST เหตุผลยกเลิก ${go}`,appointment_at:reasonAt(go),return_at:reasonAt(back)}])
// เจ้าหน้าที่ยกเลิกคำขอที่ยังไม่ได้จัดรถ (เช่น รถไม่ว่าง) — ต้องมีเหตุผลเสมอ
let reasonRev = await revisionOf(declined); await actor(coordinator)
await advance(declined,reasonRev,'cancel','TEST รถไม่ว่างในช่วงเวลาที่ขอ')
// ผู้จองกดยกเลิกเอง — หน้าประชาชนไม่มีช่องให้พิมพ์เหตุผล
reasonRev = await revisionOf(selfCancel); await actor(citizen2); await advance(selfCancel,reasonRev,'cancel','')
// ยืนยันรถแล้วเจ้าหน้าที่นำรายนี้ออกจากเที่ยว (cancel_passenger) ก็ต้องบอกเหตุผลให้ผู้จองเห็นเหมือนกัน
await actor(coordinator); const removedPlan = await rpc('patient_booking_preview',[tenant,[removed],'']); assert.deepEqual(removedPlan.errors,[])
await rpc('patient_booking_confirm',[tenant,id(814),[removed],removedPlan,''])
reasonRev = await revisionOf(removed); await actor(coordinator)
await advance(removed,reasonRev,'cancel_passenger','TEST ผู้ป่วยแจ้งเลื่อนนัด โรงพยาบาลนัดใหม่')
await actor(citizen2); const reasonMine = await rpc('patient_booking_mine',[tenant])
const mineRow = bookingId => reasonMine.bookings.find(b=>b.id===bookingId)
assert.equal(mineRow(declined).cancel_note,'TEST รถไม่ว่างในช่วงเวลาที่ขอ','ผู้จองต้องเห็นเหตุผลที่เจ้าหน้าที่ไม่ให้บริการ')
assert.equal(mineRow(removed).cancel_note,'TEST ผู้ป่วยแจ้งเลื่อนนัด โรงพยาบาลนัดใหม่','นำออกจากเที่ยวก็ต้องบอกเหตุผล')
assert.equal(mineRow(selfCancel).cancel_note,null,'ผู้จองยกเลิกเอง ไม่มีเหตุผลของเจ้าหน้าที่ให้แสดง')
assert(!('cancel_note' in mineRow(stillOpen)),'คำขอที่ยังไม่ถูกยกเลิกต้องไม่มีคีย์นี้เลย')
assert(!('consent_text' in mineRow(declined)),'ข้อความยินยอมยังไม่ถูกส่งกลับมาเหมือนเดิม')
await actor(citizen); assert(!(await rpc('patient_booking_mine',[tenant])).bookings.some(b=>b.id===declined),'เหตุผลไปกับคำขอของเจ้าของเท่านั้น')
// ด่านกันเขียนทับของไฟล์นี้เอง: นิยามปัจจุบันไม่ใช่ของที่คาดไว้ (apply ซ้ำ) = หยุดทั้งก้อน
await db.exec('RESET ROLE')
const reasonMigration = await readFile(new URL('../supabase/migrations/20260922130000_patient_booking_cancel_reason.sql', import.meta.url), 'utf8')
const mineBefore = (await db.query("SELECT md5(prosrc) AS m FROM pg_proc WHERE proname='patient_booking_mine'")).rows[0].m
await assert.rejects(db.exec(reasonMigration), /ไม่ตรงกับที่ไฟล์นี้คาดไว้/)
await db.exec('ROLLBACK')
assert.equal((await db.query("SELECT md5(prosrc) AS m FROM pg_proc WHERE proname='patient_booking_mine'")).rows[0].m,mineBefore,'ด่านไม่ผ่านต้องไม่เขียนทับอะไร')
// เก็บกวาด: เทสต์เบราว์เซอร์ใช้ฐานข้อมูลนี้ต่อ ไม่ควรเจอคำขอค้างของฉากนี้ในกล่องงาน
await db.query('DELETE FROM public.patient_bookings WHERE id=ANY($1)',[[declined,selfCancel,removed,stillOpen]])
await db.query('DELETE FROM public.patient_booking_trips WHERE id=$1',[id(814)])
console.log('PASS cancelled bookings carry the reason staff typed: staff cancel and passenger removal both reach the traveller, self-cancel and open bookings carry none')
// Permanent removal uses only this in-memory database, never retained Demo samples.
await db.exec('RESET ROLE')
const deletionBooking = id(950), deletionOther = id(951), deletionTrip = id(952), deletionOp = id(953)
await db.query(`INSERT INTO public.patient_booking_trips SELECT (jsonb_populate_record(NULL::public.patient_booking_trips,to_jsonb(t)||jsonb_build_object('id',$1::text,'state','confirmed','booking_ids',jsonb_build_array($2::text,$3::text)))).* FROM public.patient_booking_trips t LIMIT 1`,[deletionTrip,deletionBooking,deletionOther])
for (const bid of [deletionBooking,deletionOther]) await db.query(`INSERT INTO public.patient_bookings SELECT (jsonb_populate_record(NULL::public.patient_bookings,to_jsonb(b)||jsonb_build_object('id',$1::text,'trip_id',$2::text,'status','confirmed','patient_name',$1::text))).* FROM public.patient_bookings b LIMIT 1`,[bid,deletionTrip])
const deleteRow = (await db.query('SELECT * FROM public.patient_bookings WHERE id=$1',[deletionBooking])).rows[0]
const deleteTrip = (await db.query('SELECT * FROM public.patient_booking_trips WHERE id=$1',[deletionTrip])).rows[0]
const deleteArgs=[tenant,deletionOp,deletionBooking,deleteRow.revision,deleteTrip.revision,deleteTrip.docs_revision,'TEST duplicate']
for (const who of [null,citizen,coordinator,driver,outsider]) { await actor(who); await fails(()=>rpc('patient_booking_delete',deleteArgs),/permission denied|เฉพาะแอดมิน/) }
await actor(admin)
await fails(()=>rpc('patient_booking_delete',[...deleteArgs.slice(0,6),' ']),/ระบุเหตุผล/)
await fails(()=>rpc('patient_booking_delete',deleteArgs.map((v,i)=>i===3?v+1:v)),/เปลี่ยนแล้ว/)
await fails(()=>rpc('patient_booking_delete',deleteArgs.map((v,i)=>i===5?v+1:v)),/เปลี่ยนแล้ว/)
await db.exec('RESET ROLE'); await db.query("UPDATE public.patient_booking_trips SET state='outbound' WHERE id=$1",[deletionTrip]); await actor(admin)
await fails(()=>rpc('patient_booking_delete',deleteArgs),/ระหว่างรับ/)
await db.exec('RESET ROLE'); await db.query("UPDATE public.patient_booking_trips SET state='confirmed' WHERE id=$1",[deletionTrip]); await actor(admin)
await rpc('patient_booking_delete',deleteArgs); await rpc('patient_booking_delete',deleteArgs)
await fails(()=>rpc('patient_booking_delete',[...deleteArgs.slice(0,6),'changed']),/ไม่ตรง/)
await db.exec('RESET ROLE')
assert.equal((await db.query('SELECT * FROM public.patient_bookings WHERE id=$1',[deletionBooking])).rows.length,0)
const remainingTrip=(await db.query('SELECT * FROM public.patient_booking_trips WHERE id=$1',[deletionTrip])).rows[0]
assert.equal(remainingTrip.state,'confirmed'); assert.deepEqual(remainingTrip.booking_ids,[deletionOther]); assert.deepEqual(remainingTrip.plan.blocks,deleteTrip.plan.blocks)
assert.equal((await db.query("SELECT * FROM public.patient_booking_events WHERE entity_id=$1 AND action='delete_booking'",[deletionBooking])).rows.length,1)
// Completed trips may be corrected, but their report must no longer count removed riders.
await db.query("UPDATE public.patient_booking_trips SET state='completed' WHERE id=$1",[deletionTrip])
await db.query("UPDATE public.patient_bookings SET status='completed' WHERE id=$1",[deletionOther])
const lastRow=(await db.query('SELECT * FROM public.patient_bookings WHERE id=$1',[deletionOther])).rows[0]
await actor(admin); await rpc('patient_booking_delete',[tenant,id(954),deletionOther,lastRow.revision,remainingTrip.revision,remainingTrip.docs_revision,'TEST last rider'])
await db.exec('RESET ROLE'); assert.equal((await db.query('SELECT state FROM public.patient_booking_trips WHERE id=$1',[deletionTrip])).rows[0].state,'cancelled')
console.log('PASS admin deletion: authorization, reason, stale booking/doc guards, active trip block, idempotency, shared riders and last-rider queue release')
// Configured bounds are appointment times. The vehicle may operate before/after them, but cannot overlap another trip.
const boundaryDate = new Date(nextDay); boundaryDate.setUTCDate(boundaryDate.getUTCDate()+45)
while ([0,6].includes(boundaryDate.getUTCDay())) boundaryDate.setUTCDate(boundaryDate.getUTCDate()+1)
const boundaryDay = boundaryDate.toISOString().slice(0,10)
const boundaryAt = time => `${boundaryDay}T${time}:00+07:00`
await actor(admin)
const boundaryRevision = (await rpc('patient_booking_workspace',[tenant])).settings.revision
await rpc('patient_booking_save_settings',[tenant,boundaryRevision,{...settings,office_start:450,office_end:1050}])
const earlyBooking = randomUUID(), lateBooking = randomUUID(), outsideBooking = randomUUID()
await actor(citizen)
await rpc('patient_booking_submit',[tenant,earlyBooking,{...base,patient_name:'TEST early boundary',phone:'0800000990',appointment_at:boundaryAt('07:30'),return_mode:'one_way',return_at:null}])
await rpc('patient_booking_submit',[tenant,lateBooking,{...base,patient_name:'TEST late boundary',phone:'0800000991',appointment_at:boundaryAt('17:30'),return_at:boundaryAt('18:30')}])
await rpc('patient_booking_submit',[tenant,outsideBooking,{...base,patient_name:'TEST outside boundary',phone:'0800000992',appointment_at:boundaryAt('07:15'),return_mode:'one_way',return_at:null}])
await actor(coordinator)
const earlyPlan = await rpc('patient_booking_preview',[tenant,[earlyBooking],''])
assert.deepEqual(earlyPlan.errors,[])
assert(new Date(earlyPlan.pickup_at)<new Date(boundaryAt('07:30')))
await rpc('patient_booking_confirm',[tenant,randomUUID(),[earlyBooking],earlyPlan,''])
const latePlan = await rpc('patient_booking_preview',[tenant,[lateBooking],''])
assert.deepEqual(latePlan.errors,[])
assert(new Date(latePlan.blocks.at(-1).end)>new Date(boundaryAt('17:30')))
await rpc('patient_booking_confirm',[tenant,randomUUID(),[lateBooking],latePlan,''])
const outsidePlan = await rpc('patient_booking_preview',[tenant,[outsideBooking],''])
assert(outsidePlan.errors.includes('เวลานัดแพทย์อยู่นอกช่วงที่เปิดรับจอง'))
await actor(null)
const boundaryCalendar = (await rpc('patient_booking_calendar',[tenant,boundaryDay,boundaryDay])).days[0]
assert.equal(boundaryCalendar.trips.length,2)
assert(new Date(boundaryCalendar.free[0].start)<new Date(boundaryAt('07:30')))
console.log('PASS exact configured appointment bounds: early/late confirmation, vehicle travel beyond appointment hours, out-of-range rejection, public calendar')
// Nine months ahead must support submission, amendment, public visibility and joining.
const distantDate = new Date(nextDay); distantDate.setUTCDate(distantDate.getUTCDate()+250)
while ([0,6].includes(distantDate.getUTCDay())) distantDate.setUTCDate(distantDate.getUTCDate()+1)
const distantDay = distantDate.toISOString().slice(0,10), distantAt = time => `${distantDay}T${time}:00+07:00`
const distantBooking = randomUUID(), distantTrip = randomUUID()
await actor(citizen)
await rpc('patient_booking_submit',[tenant,distantBooking,{...base,patient_name:'TEST distant calendar',appointment_at:distantAt('10:00'),return_at:distantAt('12:00')}])
await actor(coordinator)
await rpc('patient_booking_amend',[tenant,randomUUID(),distantBooking,1,{appointment_at:distantAt('10:15'),return_at:distantAt('12:00'),return_mode:'wait',route_id:'a',pickup:'TEST distant pickup',in_area:true},'TEST rescheduled appointment'])
const distantPlan=await rpc('patient_booking_preview',[tenant,[distantBooking],''])
assert.deepEqual(distantPlan.errors,[])
await rpc('patient_booking_confirm',[tenant,distantTrip,[distantBooking],distantPlan,''])
await actor(null)
const distantCalendar=(await rpc('patient_booking_calendar',[tenant,distantDay,distantDay])).days[0]
assert.equal(distantCalendar.trips[0].joinable,true)
assert.equal(new Date(distantCalendar.trips[0].appointment_at).getTime(),new Date(distantAt('10:15')).getTime())
assert(!JSON.stringify(distantCalendar).includes('TEST distant calendar'))
await actor(citizen2)
await rpc('patient_booking_submit_join',[tenant,randomUUID(),distantTrip,{...base,patient_name:'TEST distant join',phone:'0800000987',companions:0,appointment_at:distantAt('10:15'),return_at:distantAt('12:00')}])
await db.exec('RESET ROLE')
const horizon=(await db.query("select ((now() at time zone 'Asia/Bangkok')::date+interval '12 months')::date::text as last, ((now() at time zone 'Asia/Bangkok')::date+interval '12 months'+interval '1 day')::date::text as outside")).rows[0]
await actor(null)
assert.equal((await rpc('patient_booking_calendar',[tenant,horizon.last,horizon.last])).days.length,1)
await fails(()=>rpc('patient_booking_calendar',[tenant,horizon.outside,horizon.outside]),/12 เดือน/)
await actor(coordinator)
await fails(()=>rpc('patient_booking_submit',[tenant,randomUUID(),{...base,appointment_at:`${horizon.outside}T10:00:00+07:00`,return_at:null,return_mode:'one_way'},true]),/วันนัดอยู่นอกช่วง/)
console.log('PASS monthly calendar: nine-month submission/amendment/join, public privacy, exact 12-month limit')
if (!process.env.PATIENT_UI_QA) await db.close()
console.log('All isolated PostgreSQL checks passed.')
export { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, id, day, calendarDay, base as baseBooking }
