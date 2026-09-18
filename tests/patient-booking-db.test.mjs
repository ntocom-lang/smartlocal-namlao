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
for (const file of ['20260918110000_patient_booking_tables.sql','20260918110100_patient_booking_rules.sql','20260918110200_patient_booking_api.sql','20260918110300_patient_booking_amend.sql','20260918113759_patient_booking_calendar.sql']) {
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
if (!process.env.PATIENT_UI_QA) await db.close()
console.log('All isolated PostgreSQL checks passed.')
export { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, id, day, calendarDay }
