// Actual React screens + isolated PostgreSQL RPCs. All non-loopback requests blocked.
// หน้าจอชุดใหม่ (เจ้าของระบบสั่ง 2569-09-21 ให้ง่ายแบบ "คำร้อง/คำขอบริการ" ทั้ง 3 ฝั่ง)
// ทุกปุ่มที่ย้าย/รวมต้องถูกกดบนของจริงจนถึงฐานข้อมูล (บทเรียน #244: ปุ่มดูปกติแต่ยิงคำสั่งไม่ครบ)
// และนับจำนวนคลิกของแต่ละงาน เพื่อมีตัวเลขยืนยันว่าง่ายขึ้นจริง
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import { REPORT_MODES } from '../src/lib/patientReportPeriod.js'
import { previousOdometer, thaiDay, pickupForBooking, returnForBooking, staffNextAction, bookingStage, reportEvent, monthReportSummary } from '../src/lib/patientBooking.js'
// หน่วยนับต้องไม่ทำให้เจ้าหน้าที่ตีความจำนวนเหตุการณ์เป็นจำนวนผู้ใช้บริการ
assert.deepEqual(monthReportSummary([
 {state:'completed',passengers:2,companions:1,distance:15},
 {state:'completed',passengers:1,companions:0,distance:null},
 {state:'completed',passengers:1,companions:0,distance:90,odometer_issue:true},
 {state:'confirmed',passengers:9,distance:40},
 {state:'cancelled',passengers:9,distance:40},
]),{completed:3,pending:1,passengers:4,companions:1,distance:15,missingDistance:2})
assert.equal(reportEvent({action:'cancel',entity_id:'abcdef00',detail:{note:'รอประสาน'}}).label,'ดำเนินการยกเลิกคำขอ')
assert.equal(reportEvent({action:'unrecognized_internal_action',entity_id:'abcdef00'}).label,'บันทึกการเปลี่ยนแปลง')
assert.deepEqual(reportEvent({action:'moved_into_trip',entity_id:'trip0000',detail:{booking_id:'book0000'}},{bookings:[{id:'book0000',patient_name:'TEST ผู้เดินทาง'}]}),{label:'ย้ายไปร่วมเที่ยวอื่น',subject:'TEST ผู้เดินทาง',reference:'คำขอเลขที่ BOOK0000',note:''})
assert.equal(reportEvent({action:'submitted',entity_id:'book0000'},{bookings:[{id:'book0000',entry_channel:'staff'}]}).label,'รับคำขอแทน (โทรศัพท์/เคาน์เตอร์)')
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, baseBooking } = await import('./patient-booking-db.test.mjs')
await db.exec(await readFile(new URL('../supabase/migrations/20260927180000_patient_booking_events_page.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260927190000_patient_booking_move_into_trip.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260928120000_patient_booking_multiwave.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260929100000_patient_booking_update_pickup.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260929110000_patient_booking_change_hospital.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260926125325_patient_booking_staff_work_badge.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260929130000_patient_booking_driver_cover.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20260930110000_patient_booking_duplicate_shared_trip.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20261001100000_patient_booking_history.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20261002090000_patient_booking_period_report.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20261002130000_patient_booking_letter_per_booking_columns.sql', import.meta.url), 'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20261002130100_patient_booking_letter_per_booking_rpc.sql', import.meta.url), 'utf8'))
await actor(admin)
await rpc('patient_booking_save_settings', [tenant, (await rpc('patient_booking_workspace', [tenant])).settings.revision,
  { ...settings, office_start: 450, office_end: 1050, routes: [{ ...settings.routes[0], minutes: 45 }] }])
// One car: two outbound waves, one shared return. The old wait request must switch
// to return-later only after a coordinator has reviewed and confirmed the entire plan.
const waveDay = new Date(); waveDay.setUTCDate(waveDay.getUTCDate() + 70)
const waveDate = waveDay.toISOString().slice(0, 10)
const waveAt = (day, time) => `${day}T${time}:00+07:00`
const waveTrip = randomUUID(), early = randomUUID(), lateA = randomUUID(), lateB = randomUUID()
await actor(citizen)
await rpc('patient_booking_submit', [tenant, early, { ...baseBooking, patient_name: 'TEST รอบแรก', phone: '0800000101', appointment_at: waveAt(waveDate, '08:00'), return_at: waveAt(waveDate, '17:30') }])
await rpc('patient_booking_submit', [tenant, lateA, { ...baseBooking, patient_name: 'TEST รอบสอง A', phone: '0800000102', companions: 0, appointment_at: waveAt(waveDate, '11:00'), return_at: waveAt(waveDate, '17:30') }])
await actor(coordinator)
await rpc('patient_booking_confirm', [tenant, waveTrip, [early], await rpc('patient_booking_preview', [tenant, [early], '']), ''])
const lateBPayload = { ...baseBooking, patient_name: 'TEST รอบสอง B', phone: '0800000103', companions: 0, appointment_at: waveAt(waveDate, '11:00'), return_at: waveAt(waveDate, '17:30') }
await actor(admin); await rpc('patient_booking_submit', [tenant, lateB, lateBPayload, true])
await actor(coordinator)
assert((await rpc('patient_booking_preview', [tenant, [lateA, lateB], ''])).errors.includes('ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว'))
let multi = await rpc('patient_booking_preview_multiwave', [tenant, [lateA, lateB], waveTrip])
assert.deepEqual(multi.errors, [])
assert.equal(multi.outbound_waves.length, 2)
assert.equal(multi.return_waves.length, 1)
assert.equal(multi.seats, 4)
assert.notEqual(multi.outbound_waves[0].pickup_at, multi.outbound_waves[1].pickup_at)
assert.equal(new Date(multi.outbound_waves[0].pickup_at).toISOString(), new Date(waveAt(waveDate, '06:45')).toISOString())
assert.equal(new Date(multi.outbound_waves[1].pickup_at).toISOString(), new Date(waveAt(waveDate, '09:30')).toISOString())
await actor(citizen); await assert.rejects(() => rpc('patient_booking_preview_multiwave', [tenant, [lateA, lateB], waveTrip]), /ไม่มีสิทธิ์/)
await actor(coordinator)
await assert.rejects(() => rpc('patient_booking_confirm_multiwave', [tenant, randomUUID(), [lateA, lateB], waveTrip, { ...multi, seats: 1 }]), /แผนหรือข้อมูลเปลี่ยน/)
const multiOp = randomUUID()
await rpc('patient_booking_confirm_multiwave', [tenant, multiOp, [lateA, lateB], waveTrip, multi])
await rpc('patient_booking_confirm_multiwave', [tenant, multiOp, [lateA, lateB], waveTrip, multi])
let waveWs = await rpc('patient_booking_workspace', [tenant])
const savedWaveTrip = waveWs.trips.find(t => t.id === waveTrip)
assert.equal(savedWaveTrip.plan.outbound_waves.length, 2)
assert.equal(savedWaveTrip.plan.return_waves.length, 1)
for (const bookingId of [early, lateA, lateB]) assert.equal(waveWs.bookings.find(b => b.id === bookingId).return_mode, 'later')
assert.notEqual(pickupForBooking(savedWaveTrip, waveWs.bookings.find(b => b.id === early)), pickupForBooking(savedWaveTrip, waveWs.bookings.find(b => b.id === lateA)))
assert.equal(returnForBooking(savedWaveTrip, waveWs.bookings.find(b => b.id === early)), returnForBooking(savedWaveTrip, waveWs.bookings.find(b => b.id === lateA)))
await actor(citizen)
const mineWave = await rpc('patient_booking_mine', [tenant])
assert(!JSON.stringify(mineWave).includes('TEST รอบสอง B'))
await actor(driver)
await rpc('patient_booking_action', [tenant, randomUUID(), waveTrip, savedWaveTrip.revision, 'trip_next', ''])
await rpc('patient_booking_action', [tenant, randomUUID(), waveTrip, savedWaveTrip.revision + 1, 'trip_finish', ''])
await actor(coordinator)
waveWs = await rpc('patient_booking_workspace', [tenant])
assert([early, lateA, lateB].every(bookingId => waveWs.bookings.find(b => b.id === bookingId).status === 'completed'))
console.log('PASS two outbound waves, shared return, coordinator approval, atomic conversion, retry, private view and two driver actions')

// A second itinerary may have two independent return runs. Overlapping proposed runs
// still fail before any booking or document is changed.
const separateDay = new Date(waveDay); separateDay.setUTCDate(separateDay.getUTCDate() + 1)
const separateDate = separateDay.toISOString().slice(0, 10)
const firstSeparate = randomUUID(), secondSeparate = randomUUID(), separateTrip = randomUUID()
await actor(citizen)
await rpc('patient_booking_submit', [tenant, firstSeparate, { ...baseBooking, patient_name: 'TEST กลับรอบแรก', phone: '0800000111', companions: 0, appointment_at: waveAt(separateDate, '09:00'), return_at: waveAt(separateDate, '14:00') }])
await rpc('patient_booking_submit', [tenant, secondSeparate, { ...baseBooking, patient_name: 'TEST กลับรอบสอง', phone: '0800000112', companions: 0, appointment_at: waveAt(separateDate, '12:00'), return_at: waveAt(separateDate, '16:30') }])
await actor(coordinator)
await rpc('patient_booking_confirm', [tenant, separateTrip, [firstSeparate], await rpc('patient_booking_preview', [tenant, [firstSeparate], '']), ''])
multi = await rpc('patient_booking_preview_multiwave', [tenant, [secondSeparate], separateTrip])
assert.deepEqual(multi.errors, [])
assert.equal(multi.return_waves.length, 2)
await rpc('patient_booking_confirm_multiwave', [tenant, randomUUID(), [secondSeparate], separateTrip, multi])
await actor(null)
const publishedWaves = (await rpc('patient_booking_calendar', [tenant, separateDate, separateDate])).days[0].trips.find(t => t.id === separateTrip)
assert.equal(publishedWaves.joinable, false, 'legacy self-join must not bypass staff approval for a multi-run plan')
assert.equal(publishedWaves.outbound_waves.length, 2)
assert.equal(publishedWaves.return_waves.length, 2)
assert(!JSON.stringify(publishedWaves).includes('TEST กลับรอบแรก'))
console.log('PASS separate return waves are reserved without overlapping the same vehicle')
const collisionDay = new Date(separateDay); collisionDay.setUTCDate(collisionDay.getUTCDate() + 1)
const collisionDate = collisionDay.toISOString().slice(0, 10)
const collisionFirst = randomUUID(), collisionSecond = randomUUID(), collisionTrip = randomUUID()
await actor(citizen)
await rpc('patient_booking_submit', [tenant, collisionFirst, { ...baseBooking, patient_name: 'TEST ชนรอบกลับ', phone: '0800000121', companions: 0, appointment_at: waveAt(collisionDate, '09:00'), return_at: waveAt(collisionDate, '13:00') }])
await rpc('patient_booking_submit', [tenant, collisionSecond, { ...baseBooking, patient_name: 'TEST ชนรอบรับ', phone: '0800000122', companions: 0, appointment_at: waveAt(collisionDate, '12:00'), return_at: waveAt(collisionDate, '16:30') }])
await actor(coordinator)
await rpc('patient_booking_confirm', [tenant, collisionTrip, [collisionFirst], await rpc('patient_booking_preview', [tenant, [collisionFirst], '']), ''])
const collision = await rpc('patient_booking_preview_multiwave', [tenant, [collisionSecond], collisionTrip])
assert(collision.errors.includes('รอบรับ–ส่งทับกันภายในแผนเดียว'))
await assert.rejects(() => rpc('patient_booking_confirm_multiwave', [tenant, randomUUID(), [collisionSecond], collisionTrip, collision]), /รอบรับ–ส่งทับกัน/)
assert.equal((await rpc('patient_booking_workspace', [tenant])).bookings.find(b => b.id === collisionSecond).status, 'submitted')
console.log('PASS overlapping outbound and return runs are rejected without changing the pending booking')
await actor(admin); await rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings])
const setupTenant='00000000-0000-4000-8000-000000009001',setupAdmin='00000000-0000-4000-8000-000000009002',setupPartner='00000000-0000-4000-8000-000000009003'
// ผู้ใช้ใหม่ที่ยังไม่เคยจอง — ใช้วัด "จองครั้งแรก" กับ "จองครั้งต่อไป" (เติมข้อมูลจากครั้งก่อน)
const newcomer='00000000-0000-4000-8000-000000000016'
const coverStaff='00000000-0000-4000-8000-000000000017'
await db.exec('RESET ROLE')
await db.query('INSERT INTO public.municipalities(id) VALUES($1)',[setupTenant])
await db.query("INSERT INTO public.profiles(id,municipality_id,role,full_name) VALUES($1,$2,'admin','TEST ผู้รับผิดชอบรถ')",[setupAdmin,setupTenant])
await db.query("INSERT INTO public.profiles(id,municipality_id,role,full_name) VALUES($1,$2,'citizen','TEST ผู้ใช้ใหม่')",[newcomer,tenant])
await db.query("INSERT INTO public.profiles(id,municipality_id,role,full_name) VALUES($1,$2,'staff','TEST คนขับแทน')",[coverStaff,tenant])
await db.query("INSERT INTO public.referral_partners(id,municipality_id,name,is_active,document_types,min_lead_days) VALUES($1,$2,'TEST กองทุนรถรับส่ง',true,ARRAY['patient_transport_request'],0)",[setupPartner,setupTenant])
// ทะเบียนสถานที่ของ อปท. (ตารางเดียวกับที่หน้าคำร้องใช้) — ฟอร์มจองให้กดเลือกหมู่บ้านแทนพิมพ์เอง
await db.exec('CREATE TABLE public.locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),municipality_id uuid,name text,sort_order integer)')
await db.query("INSERT INTO public.locations(municipality_id,name,sort_order) VALUES($1,'TEST บ้านเหนือ',1),($1,'TEST บ้านใต้',2)",[tenant])
let chain = Promise.resolve()
const users = { setupadmin:setupAdmin, citizen, newcomer, coordinator, driver, admin, coverdriver:coverStaff, anonymous: null }
const order = {
 patient_booking_update_pickup:['p_muni','p_op','p_id','p_revision','p_pickup','p_lat','p_lng','p_verified'],
 patient_booking_change_hospital:['p_muni','p_op','p_booking','p_expected','p_route','p_scope'],
 patient_booking_reassign_driver:['p_muni','p_op','p_trip','p_day','p_from_driver','p_driver','p_expected','p_midtrip'],
 patient_booking_reschedule:['p_muni','p_op','p_booking','p_scope','p_expected','p_appointment','p_return','p_not_departed'],
 patient_booking_move_into_trip:['p_muni','p_op','p_booking','p_expected','p_target','p_target_revision','p_target_booking','p_target_booking_revision'],
 patient_booking_delete:['p_muni','p_op','p_booking','p_revision','p_trip_revision','p_docs_revision','p_reason'],
 patient_booking_update_schedule:['p_muni','p_trip','p_revision','p_notice','p_pickup','p_return'],
 patient_booking_info:['p_muni'],patient_booking_workspace:['p_muni'],patient_booking_mine:['p_muni'],patient_booking_submit:['p_muni','p_id','p_data','p_staff_entry'],
 patient_booking_save_settings:['p_muni','p_revision','p_data'],patient_booking_preview:['p_muni','p_ids','p_helper'],
 patient_booking_confirm:['p_muni','p_id','p_ids','p_expected','p_helper'],patient_booking_action:['p_muni','p_op','p_entity','p_revision','p_action','p_note'],
 patient_booking_calendar:['p_muni','p_from','p_to'],patient_booking_submit_join:['p_muni','p_id','p_trip','p_data','p_staff_entry'],patient_booking_preview_join:['p_muni','p_booking'],patient_booking_confirm_join:['p_muni','p_op','p_booking','p_expected'],
 patient_booking_preview_into_trip:['p_muni','p_booking','p_trip'],patient_booking_confirm_into_trip:['p_muni','p_op','p_booking','p_trip','p_expected'],
 patient_booking_preview_multiwave:['p_muni','p_ids','p_trip'],patient_booking_confirm_multiwave:['p_muni','p_op','p_ids','p_trip','p_expected'],
 patient_booking_amend:['p_muni','p_op','p_id','p_revision','p_data','p_note'],
 patient_booking_save_odometer:['p_muni','p_trip','p_docs_revision','p_start','p_end','p_issue','p_note'],patient_booking_record_letter:['p_muni','p_trip','p_docs_revision','p_letter_no','p_letter_date'],patient_booking_record_odometer:['p_muni','p_trip','p_docs_revision','p_start','p_end'],patient_booking_month_report:['p_muni','p_month'],
 patient_booking_events_page:['p_muni','p_page'],
 patient_booking_period_report:['p_muni','p_from','p_to'],
 patient_booking_history:['p_muni','p_booking'],
 patient_booking_record_booking_letter:['p_muni','p_booking','p_letter_revision','p_letter_no','p_letter_date'],
}
const plugin = {
 name:'isolated-patient-booking-browser',enforce:'pre',
 resolveId(id){ if(id==='/__patient_entry.js')return '\0patient-entry.js' },
 load(id){
  const normalized=id.replaceAll('\\','/')
  if(id==='\0patient-entry.js')return `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import Citizen from '/src/pages/PatientTransportBooking.jsx';import Staff from '/src/pages/PatientTransportStaff.jsx';const Page=new URLSearchParams(location.search).get('page')==='staff'?Staff:Citizen;import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Page)));`
  if(normalized.endsWith('/contexts/TenantContext.jsx'))return `export const useTenant=()=>({tenant:{id:new URLSearchParams(location.search).get('as')==='setupadmin'?'${setupTenant}':'${tenant}',name:'อบต. TEST'},isModuleEnabled:()=>true})`
  if(normalized.endsWith('/contexts/AuthContext.jsx'))return `const role=new URLSearchParams(location.search).get('as')||'citizen';const ids=${JSON.stringify(users)};export const useAuth=()=>({session:{user:{id:ids[role]}},profileName:'TEST Browser Requester'});`
  if(normalized.endsWith('/lib/supabase.js'))return `export const supabase={rpc:async(name,args)=>{const user=new URLSearchParams(location.search).get('as')||'citizen';return (await fetch('/__patient_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,user})})).json()},
   from:table=>{const query={table,filters:[]};const api={select:()=>api,order:()=>api,maybeSingle:()=>{query.single=true;return api},eq:(column,value)=>{query.filters.push([column,value]);return api},
    then:(resolve,reject)=>fetch('/__patient_table',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(query)}).then(response=>response.json()).then(resolve,reject)};return api}};`
 },
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url.startsWith('/__patient?')){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__patient_entry.js"></script></body></html>'));return}
  if(req.url==='/__patient_table'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const query=JSON.parse(Buffer.concat(chunks).toString())
   const task=async()=>{try{
    await db.exec('RESET ROLE')
    const filter=column=>(query.filters||[]).find(([name])=>name===column)?.[1]
    let rows
    if(query.table==='locations')rows=(await db.query('SELECT id,name FROM public.locations WHERE municipality_id=$1 ORDER BY sort_order',[filter('municipality_id')])).rows
    // หนังสือนำส่งอ่านผู้รับจากทะเบียนหน่วยงานรับเรื่องต่อ · ฐานทดสอบไม่มีทะเบียนผู้ลงนาม = ว่าง (หนังสือใช้ตำแหน่งตั้งต้น)
    else if(query.table==='referral_partners')rows=(await db.query('SELECT name FROM public.referral_partners WHERE id=$1',[filter('id')])).rows
    else if(query.table==='document_signatories')rows=[]
    else throw Error('Test API denied')
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:query.single?(rows[0]??null):rows,error:null}))
   }catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:e.message}}))}}
   chain=chain.then(task,task);return}
  if(req.url!=='/__patient_rpc')return next()
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const request=JSON.parse(Buffer.concat(chunks).toString());
  const task=async()=>{try{if(!order[request.name]||!Object.hasOwn(users,request.user))throw Error('Test API denied');await actor(users[request.user]);const data=await rpc(request.name,order[request.name].map(k=>request.args[k]));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data,error:null}))}catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:e.message,code:e.code}}))}}
  chain=chain.then(task,task)
 })},
}
const server=await createServer({configFile:false,plugins:[plugin,react(),tailwind()],server:{host:'127.0.0.1',port:0},logLevel:'error'})
await server.listen();const address=server.httpServer.address();const base=`http://127.0.0.1:${address.port}`
const browser=await chromium.launch({channel:'msedge',headless:true})
const page=await browser.newPage({viewport:{width:390,height:900}});const errors=[]
page.setDefaultTimeout(20000)
page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message)})
const vehiclePrompts=[];let dismissNextVehiclePrompt=false
// กล่องทวนออกรถ/จบงานจากตารางงานคนขับบนจอ PC — ค่าเริ่มคือกด "ยกเลิก" ฉากที่ต้องบันทึกจริงตั้ง acceptNextTripPrompt เอง
const tripPrompts=[];let acceptNextTripPrompt=false
page.on('dialog',async dialog=>{
 if(dialog.type()==='confirm'&&dialog.message().startsWith('บันทึก “')){
  tripPrompts.push(dialog.message())
  if(acceptNextTripPrompt){acceptNextTripPrompt=false;await dialog.accept()}else await dialog.dismiss()
  return
 }
 if(dialog.type()!=='confirm'||!dialog.message().includes('ยืนยันรถให้')){await dialog.dismiss();return}
 vehiclePrompts.push(dialog.message())
 if(dismissNextVehiclePrompt){dismissNextVehiclePrompt=false;await dialog.dismiss()}else await dialog.accept()
})
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())

// คำสั่งตรงถึงฐานข้อมูลต่อคิวเดียวกับคำขอจากเบราว์เซอร์ บทบาทจะได้ไม่สลับกันกลางทาง
const queue=job=>{let out;const run=async()=>{out=await job()};const p=chain.then(run,run);chain=p.catch(()=>{});return p.then(()=>out)}
const runAs=(user,fn)=>queue(async()=>{await actor(user);return fn()})
const runSql=fn=>queue(async()=>{await db.exec('RESET ROLE');return fn()})
const tripOf=id=>runSql(async()=>(await db.query('SELECT trip_id FROM public.patient_bookings WHERE id=$1',[id])).rows[0].trip_id)
const bookingRow=id=>runSql(async()=>(await db.query('SELECT status,trip_id,passenger_step,cancel_requested,return_ready,entry_channel,in_area FROM public.patient_bookings WHERE id=$1',[id])).rows[0])
const STAFF_ROLES=['setupadmin','coordinator','driver','admin','coverdriver']
const visit=async as=>{
 if(STAFF_ROLES.includes(as)){await page.goto(`${base}/__patient?as=${as}&page=staff`);await page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'}).waitFor();return}
 await page.goto(`${base}/__patient?as=${as}`);await page.getByRole('region',{name:'บริการรถรับส่งผู้ป่วย'}).waitFor()}
const staffDesk=async(as='coordinator')=>{await page.setViewportSize({width:1280,height:900});await visit(as)}
const row=id=>page.locator(`tr[data-booking="${id}"]`)
// ส่วน "เสร็จแล้ว / ยกเลิก" พับไว้ตอนเปิดหน้า (เจ้าของระบบเลือก 2569-10-01) — ฉากที่ต้องดูแถวที่จบแล้วกดแสดงก่อน แบบเจ้าหน้าที่
const doneToggle=()=>page.getByRole('button',{name:/^(แสดง|ซ่อน)รายการ$/})
const openDone=async()=>{if(await doneToggle().getAttribute('aria-expanded')==='false')await doneToggle().click();assert.equal(await doneToggle().getAttribute('aria-expanded'),'true')}
const toast=text=>page.getByRole('status').filter({hasText:text})
const problem=page.getByRole('region',{name:'ยืนยันรถไม่ได้'})
const sheet=page.getByRole('dialog')
const card=trip=>page.locator(`article[data-trip="${trip}"]`).first()
const setDay=async value=>{await page.locator('summary').filter({hasText:'เลือกวันอื่น'}).first().evaluate(node=>{node.parentElement.open=true});await page.getByLabel('วันที่นัดแพทย์',{exact:true}).fill(value)}
const clicks={}
const click=async(key,locator)=>{await locator.click();clicks[key]=(clicks[key]||0)+1}
// หน้าต่างพิมพ์: แผ่นหนังสือนำส่ง + ใบคำขอของคำขอที่ระบุ + แถบเตือนบนจอ · note = บรรทัดกำกับใต้ชื่อผู้ยื่น ซึ่งต้องว่างทุกช่องทาง (ตัด 2569-10-02)
// ใช้ยืนยันว่า entry_channel จากฐานข้อมูลไปถึงใบพิมพ์จริง ไม่ใช่ถูกแค่ในข้อมูลสมมติของเทสต์เลย์เอาต์
// ⚠️ หาแผ่นจากชนิด (.letter-sign / .form-title) ไม่ใช่เลขลำดับ · kinds = ลำดับที่ออกจากเครื่องพิมพ์
const printedDoc=(win,id)=>win.evaluate(ref=>{
 const sheets=[...document.querySelectorAll('.sheet')],letter=sheets.find(s=>s.querySelector('.letter-sign')),form=sheets.find(s=>s.querySelector('.form-title')&&s.innerText.includes(ref)),notice=document.querySelector('.screen-note')
 return{sheets:sheets.length,kinds:sheets.map(s=>s.querySelector('.letter-sign')?'letter':s.querySelector('.form-title')?'form':'other'),
  all:document.body.innerText,letter:letter?.innerText??'',form:form?.innerText??'',
  note:form?.querySelector('.signed-note')?.textContent.replace(/\s+/g,' ').trim()??'',
  origin:form?.querySelector('.origin')?.textContent.replace(/\s+/g,' ').trim()??'',originCount:form?form.querySelectorAll('.origin').length:-1,
  mayorSigned:letter?letter.querySelectorAll('.sign-signed').length:-1,
  notice:notice&&{text:notice.textContent,display:getComputedStyle(notice).display}}},id.slice(0,8).toUpperCase())
// วันทำการที่รถว่างทั้งวัน (ไม่มีเที่ยวเลย) ไว้ให้แต่ละฉากใช้คนละวัน ไม่ชนกันเองและไม่ชนข้อมูลของเทสต์ฐานข้อมูล
const freeDays=async(count,skip=[])=>{
 const from=thaiDay(Date.now()+3*86400000),to=thaiDay(Date.now()+44*86400000)
 const cal=await runAs(null,()=>rpc('patient_booking_calendar',[tenant,from,to]))
 const days=cal.days.filter(d=>d.status==='open'&&!d.trips.length&&!skip.includes(d.date)).map(d=>d.date)
 assert(days.length>=count,'ต้องมีวันว่างพอให้ทดสอบ');return days.slice(0,count)
}
const submitAs=(user,id,data)=>runAs(user,()=>rpc('patient_booking_submit',[tenant,id,{...JSON.parse(JSON.stringify(baseBooking)),...data},false]))
try{
 // ── ตั้งค่าครั้งแรกผ่านหน้าจอจริง แล้วหน้าประชาชนเปิดปุ่มขอรถ ──
 await visit('setupadmin');await page.getByRole('button',{name:'ตั้งค่า',exact:true}).click()
 await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await toast('บันทึกค่าตั้งต้นแล้ว').waitFor()
 await actor(setupAdmin);assert.equal((await rpc('patient_booking_workspace',[setupTenant])).settings.enabled,false)
 console.log('PASS first-time empty draft settings saved without enabling booking')
 await page.locator('select').filter({has:page.locator(`option[value="${setupPartner}"]`)}).selectOption(setupPartner)
 await page.getByLabel('บัญชีคนขับ',{exact:true}).selectOption(setupAdmin)
 await page.locator('summary').filter({hasText:'เจ้าหน้าที่ผู้ยืนยันคิว'}).click()
 await page.getByRole('group',{name:'เจ้าหน้าที่ผู้ยืนยันคิว',exact:true}).getByRole('checkbox').check()
 await page.getByLabel('ที่นั่งผู้โดยสาร ไม่รวมคนขับ',{exact:true}).fill('4');await page.getByLabel('ที่ยึดรถเข็น',{exact:true}).fill('1');await page.getByLabel('ที่ยึดเปล',{exact:true}).fill('1');await page.getByLabel('เบอร์ติดต่อหน่วยงาน',{exact:true}).fill('0800000000')
 await page.getByRole('button',{name:'เพิ่มเส้นทาง',exact:true}).click();await page.getByLabel('ชื่อโรงพยาบาล — พื้นที่รับ',{exact:true}).fill('TEST โรงพยาบาลใกล้เคียง');await page.getByLabel('นาทีต่อขา',{exact:true}).fill('30')
 await page.getByRole('checkbox',{name:'เปิดรับจองรถออนไลน์',exact:true}).check();await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await toast('บันทึกค่าตั้งต้นแล้ว').waitFor()
 await actor(setupAdmin);const initialSettings=(await rpc('patient_booking_workspace',[setupTenant])).settings;assert.equal(initialSettings.enabled,true);assert.equal(initialSettings.calendar_checked_through,null);assert(initialSettings.privacy_notice.includes('บริการรถรับส่งผู้ป่วย'));assert.equal(initialSettings.driver_id,setupAdmin);assert.deepEqual(initialSettings.coordinator_ids,[setupAdmin]);assert.equal((await rpc('patient_booking_info',[setupTenant])).enabled,true)
 await page.goto(`${base}/__patient?as=setupadmin`);await page.getByRole('button',{name:'🚐 ขอรถไปโรงพยาบาล',exact:true}).waitFor()
 console.log('PASS first-time setup completed through actual UI and booking opens; one account serves both duties')

 // ── บัญชีเดียวสองหน้าที่ (ผู้จัดคิว + คนขับ) เห็นทั้ง "คำขอรถ" และ "งานคนขับ" แม้ยังไม่มีเที่ยว ──
 await visit('admin');await page.getByRole('button',{name:'ตั้งค่า',exact:true}).click()
 await page.locator('summary').filter({hasText:'เจ้าหน้าที่ผู้ยืนยันคิว'}).click()
 const dualCheckbox=page.getByRole('group',{name:'เจ้าหน้าที่ผู้ยืนยันคิว',exact:true}).getByRole('checkbox',{name:'Driver TEST',exact:true})
 await dualCheckbox.check();await page.getByLabel('บัญชีคนขับ',{exact:true}).selectOption(coordinator);await page.getByLabel('บัญชีคนขับ',{exact:true}).selectOption(driver);assert.equal(await dualCheckbox.isChecked(),true)
 await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await toast('บันทึกค่าตั้งต้นแล้ว').waitFor()
 await actor(driver);const dualWorkspace=await rpc('patient_booking_workspace',[tenant]);assert.equal(dualWorkspace.role,'coordinator');assert.equal(dualWorkspace.settings.driver_id,driver)
 await page.route('**/__patient_rpc',async route=>{const request=route.request().postDataJSON();if(request.name==='patient_booking_workspace'&&request.user==='driver'){const response=await route.fetch();const body=await response.json();body.data.trips=[];await route.fulfill({response,json:body})}else await route.fallback()})
 await visit('driver');await page.getByRole('button',{name:'คำขอรถ',exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'งานคนขับรอดำเนินการ'}).count(),0,'ไม่มีงานต้องไม่แสดงปุ่มแจ้งเตือน');await page.getByRole('button',{name:'งานคนขับ',exact:true}).click();await page.getByText('วันนี้ไม่มีเที่ยวที่ต้องออก').waitFor();await page.unroute('**/__patient_rpc')
 await actor(admin);await rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings])
 console.log('PASS dual-duty account keeps both tabs, including an empty driver tab')

 // ── ประชาชนจองครั้งแรก: ปุ่มตัวเลือก → ทวนก่อนส่ง → จอสำเร็จ + เลขที่คำขอ ──
 await page.setViewportSize({width:390,height:900});await visit('newcomer')
 await click('citizenFirst',page.getByRole('button',{name:'🚐 ขอรถไปโรงพยาบาล',exact:true}))
 const timeChips=page.getByRole('group',{name:'เวลานัดแพทย์'}).getByRole('button');await timeChips.first().waitFor()
 // เปิดฟอร์มแล้วระบบเลือกวันแรกที่ยังจองได้ไว้ให้ (มีเวลาว่างขึ้นทันทีตามบรรทัดบน) แต่ช่วงบ่ายวันนั้นคือ "วันนี้" ที่อาจเหลือเวลาว่าง
 // ช่องเดียว — 2569-10-01 ราว 15:00–15:30 เหลือ 16:30 ช่องเดียว การจองครั้งต่อไปที่กดเวลาสุดท้ายจึงได้เวลาเดียวกับครั้งแรก
 // แล้วส่งไม่สำเร็จ ฉากนี้จึงใช้วันว่างทั้งวันที่เลือกเอง ผลไม่ขึ้นกับเวลาที่รันเทสต์ · ไม่นับคลิก เพราะผู้ใช้จริงไม่ต้องกดวัน
 const [citizenDay]=await freeDays(1)
 const pickCitizenDay=async()=>{
  await page.getByLabel('ปี พ.ศ.',{exact:true}).selectOption(citizenDay.slice(0,4))
  await page.getByLabel('เดือน',{exact:true}).selectOption(citizenDay.slice(5,7))
  await page.locator(`[data-calendar-date="${citizenDay}"]`).click()
  assert.equal(await page.locator(`[data-calendar-date="${citizenDay}"]`).getAttribute('aria-pressed'),'true')
  await timeChips.first().waitFor()}
 await pickCitizenDay()
 const firstTimes=await timeChips.allInnerTexts();assert(firstTimes.length>1,'วันว่างทั้งวันต้องมีเวลาให้เลือกหลายช่อง การจองครั้งต่อไปจะได้เวลาไม่ซ้ำครั้งแรก')
 await click('citizenFirst',timeChips.first())
 assert.equal(await page.getByLabel('ชื่อ–สกุลผู้จอง',{exact:true}).inputValue(),'TEST Browser Requester','ชื่อผู้จองต้องเติมจากบัญชีให้แล้ว')
 await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).fill('0800000099')
 await click('citizenFirst',page.getByRole('group',{name:'หมู่บ้าน/สถานที่'}).getByRole('button',{name:'TEST บ้านเหนือ'}))
 await page.getByLabel('บ้านเลขที่ / จุดสังเกต',{exact:true}).fill('บ้านเลขที่ 99 ข้างวัด')
 // "นั่งรถคันเดียวกับผู้ป่วยคนอื่นได้" ติ๊กไว้ก่อน (เจ้าของระบบตัดสิน 2569-09-22)
 const shareBox=page.getByRole('checkbox',{name:/นั่งรถคันเดียวกับผู้ป่วยคนอื่น/})
 assert.equal(await shareBox.isChecked(),true,'จองครั้งแรกต้องติ๊กนั่งร่วมไว้ก่อน')
 // ฉากชนคิวด้านล่างต้องมีผู้จองที่ไม่นั่งร่วม จึงเอาติ๊กออก — ไม่นับเป็นคลิกของเส้นทางปกติ
 await shareBox.uncheck()
 await click('citizenFirst',page.getByRole('button',{name:'ส่งคำขอ',exact:true}))
 await page.getByText('ตรวจทานก่อนส่ง',{exact:true}).waitFor()
 await click('citizenFirst',page.getByRole('checkbox',{name:'ยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น'}))
 await click('citizenFirst',page.getByRole('button',{name:'ยืนยันส่งคำขอ',exact:true}))
 await page.getByText('ส่งคำขอสำเร็จ',{exact:true}).waitFor()
 let mine=(await runAs(newcomer,()=>rpc('patient_booking_mine',[tenant]))).bookings
 assert.equal(mine.length,1);const b1=mine[0].id,b1Day=thaiDay(mine[0].appointment_at)
 await page.getByText(b1.slice(0,8).toUpperCase(),{exact:true}).waitFor()
 assert.equal(mine[0].pickup,'TEST บ้านเหนือ · บ้านเลขที่ 99 ข้างวัด');assert.equal(mine[0].in_area,true);assert.equal(mine[0].share,false,'เอาติ๊กออกแล้วต้องบันทึกตามที่ผู้จองเลือก')
 await page.getByRole('button',{name:'ดูคำขอของฉัน',exact:true}).click()
 await page.getByRole('article').filter({hasText:b1.slice(0,8).toUpperCase()}).getByText('รอเจ้าหน้าที่ยืนยันรถ',{exact:false}).waitFor()
 assert.equal(clicks.citizenFirst,6,'จองครั้งแรก 6 คลิก + พิมพ์เบอร์และจุดสังเกต')
 // ── จองครั้งต่อไป: ระบบเติมโรงพยาบาล เบอร์ จุดรับ จากครั้งก่อน เหลือแค่เลือกเวลาแล้วส่ง ──
 await click('citizenRepeat',page.getByRole('button',{name:'🚐 ขอรถไปโรงพยาบาล',exact:true}))
 await page.getByText('เติมข้อมูลจากการจองครั้งก่อนให้แล้ว',{exact:false}).waitFor()
 assert.equal(await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).inputValue(),'0800000099')
 assert.equal(await page.getByRole('group',{name:'หมู่บ้าน/สถานที่'}).getByRole('button',{name:'TEST บ้านเหนือ'}).getAttribute('aria-pressed'),'true')
 assert.equal(await page.getByLabel('บ้านเลขที่ / จุดสังเกต',{exact:true}).inputValue(),'บ้านเลขที่ 99 ข้างวัด')
 assert.equal(await shareBox.isChecked(),false,'จองครั้งต่อไปต้องคงค่าที่เจ้าตัวเลือกไว้ ไม่ติ๊กกลับให้เอง')
 await pickCitizenDay()
 assert.equal(await shareBox.isChecked(),false,'เปลี่ยนวันแล้วต้องไม่ล้างค่าที่เติมจากครั้งก่อน')
 await click('citizenRepeat',timeChips.last())
 await click('citizenRepeat',page.getByRole('button',{name:'ส่งคำขอ',exact:true}))
 await click('citizenRepeat',page.getByRole('checkbox',{name:'ยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น'}))
 await click('citizenRepeat',page.getByRole('button',{name:'ยืนยันส่งคำขอ',exact:true}))
 await page.getByText('ส่งคำขอสำเร็จ',{exact:true}).waitFor()
 assert.equal(clicks.citizenRepeat,5,'จองครั้งต่อไป 5 คลิก ไม่ต้องพิมพ์')
 mine=(await runAs(newcomer,()=>rpc('patient_booking_mine',[tenant]))).bookings;const b2=mine.find(b=>b.id!==b1).id
 console.log('PASS citizen booking: tap-only form, review + one consent, success screen with ref no, repeat booking prefilled (first 6 clicks, repeat 5)')

 // ── ฉากของเจ้าหน้าที่ใช้คนละวัน ไม่ชนกันเอง ──
 const [joinDay,areaDay,helperDay,intakeDay,groupDay]=await freeDays(5,[b1Day])
 const at=(dayValue,time)=>`${dayValue}T${time}:00+07:00`
 const joinA=randomUUID(),joinB=randomUUID(),areaC=randomUUID(),chairD=randomUUID(),groupE=randomUUID(),groupF=randomUUID()
 await submitAs(citizen,joinA,{patient_name:'[TEST] นางเอ นั่งร่วมได้',phone:'0810000004',share:true,appointment_at:at(joinDay,'10:00'),return_at:at(joinDay,'12:00')})
 await submitAs(citizen,areaC,{patient_name:'[TEST] ยังไม่ตรวจเขต',phone:'0810000006',in_area:false,appointment_at:at(areaDay,'10:00'),return_at:at(areaDay,'12:00')})
 await submitAs(citizen,chairD,{patient_name:'[TEST] นางรถเข็น นั่งไป',phone:'0810000007',mobility:'wheelchair',companions:0,share:false,return_mode:'one_way',return_at:null,appointment_at:at(helperDay,'10:00')})
 await submitAs(citizen,groupE,{patient_name:'[TEST] ไปด้วยกัน อี',phone:'0810000008',share:true,companions:0,appointment_at:at(groupDay,'10:00'),return_at:at(groupDay,'12:00')})
 await submitAs(citizen,groupF,{patient_name:'[TEST] ไปด้วยกัน เอฟ',phone:'0810000009',share:true,companions:0,appointment_at:at(groupDay,'10:15'),return_at:at(groupDay,'12:00')})

 // ── กดยืนยันรถแล้วต้องทวนก่อน ยกเลิกแล้วข้อมูลไม่เปลี่ยน ──
 await staffDesk()
 await row(b1).waitFor()
 dismissNextVehiclePrompt=true
 await row(b1).getByRole('button',{name:'ยืนยันรถ',exact:true}).click()
 assert.equal((await bookingRow(b1)).status,'submitted','ยกเลิกหน้าต่างทวนแล้วต้องไม่ยืนยันรถ')
 assert(vehiclePrompts.at(-1).includes(mine.find(b=>b.id===b1).patient_name),'หน้าต่างทวนต้องแสดงชื่อผู้เดินทาง')
 await click('confirm',row(b1).getByRole('button',{name:'ยืนยันรถ',exact:true}))
 await toast('ยืนยันรถแล้ว').waitFor()
 assert.equal((await bookingRow(b1)).status,'confirmed');assert.equal(clicks.confirm,1)
 assert.equal(vehiclePrompts.length,2,'กดซ้ำแล้วต้องทวนอีกครั้งก่อนบันทึก')
 await row(b1).getByRole('button',{name:'ดูขั้นตอนต่อไป',exact:true}).click()
 const afterConfirm=sheet.getByRole('region',{name:'ขั้นตอนหลังยืนยันรถ'})
 await afterConfirm.getByText('ยืนยันรถแล้ว · ขั้นต่อไป').waitFor()
 const printAfterConfirm=afterConfirm.getByRole('button',{name:'พิมพ์ใบคำขอถึงนายก + หนังสือนำส่งกองทุน'})
 await printAfterConfirm.waitFor()
 assert.equal(await afterConfirm.getByRole('button',{name:'ไปงานคนขับ'}).count(),0,'ผู้ยืนยันคิวที่ไม่ใช่คนขับต้องไม่ถูกส่งไปงานคนขับ')
 assert.equal(await page.getByRole('region',{name:'งานคนขับรอดำเนินการ'}).count(),0,'บัญชีผู้จัดคิวที่ไม่ใช่คนขับต้องไม่เห็นงานคนขับ')
 await page.setViewportSize({width:320,height:800})
 const printBox=await printAfterConfirm.boundingBox()
 assert(printBox && printBox.width>=44 && printBox.x>=0 && printBox.x+printBox.width<=320,'ปุ่มพิมพ์หลังยืนยันต้องกดได้และอยู่ในจอมือถือ 320px')
 await page.setViewportSize({width:1280,height:900})
 await sheet.getByRole('button',{name:'ปิด',exact:true}).click()
 // หากบัญชีคนขับเป็นผู้ยืนยันคิวด้วย ปุ่มในรายละเอียดต้องพาไปงานคนขับของเที่ยวเดียวกัน
 await runAs(admin,async()=>rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,{...settings,coordinator_ids:[coordinator,driver]}]))
 const driverWorkCount=await runAs(driver,async()=>{
  const w=await rpc('patient_booking_workspace',[tenant])
  return w.trips.filter(t=>t.driver_id===driver && (t.state!=='cancelled' && t.state!=='completed' || t.state==='completed' && (!Number.isFinite(t.odometer_end) || t.odometer_issue))).length
 })
 assert(driverWorkCount>0)
 await visit('driver')
 let driverJump=page.getByRole('region',{name:'งานคนขับรอดำเนินการ'})
 await driverJump.getByText(`มีงานคนขับ ${driverWorkCount} รายการ`,{exact:true}).waitFor()
 if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/driver-jump-desktop.png`,fullPage:false})}
 await driverJump.getByRole('button',{name:'ไปแท็บงานคนขับ →'}).click()
 await page.getByRole('heading',{name:'งานคนขับ',exact:true}).waitFor()
 assert.equal(await driverJump.count(),0,'อยู่ในแท็บงานคนขับแล้วไม่ต้องแสดงปุ่มซ้ำ')
 await page.setViewportSize({width:320,height:800});await visit('driver')
 driverJump=page.getByRole('region',{name:'งานคนขับรอดำเนินการ'})
 await driverJump.getByText(`มีงานคนขับ ${driverWorkCount} รายการ`,{exact:true}).waitFor()
 if(process.env.PATIENT_PREVIEW_SHOTS)await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/driver-jump-mobile.png`,fullPage:false})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'ปุ่มงานคนขับต้องไม่ล้นจอ 320px')
 const driverJumpBox=await driverJump.getByRole('button',{name:'ไปแท็บงานคนขับ →'}).boundingBox()
 assert(driverJumpBox && driverJumpBox.width>=44 && driverJumpBox.x>=0 && driverJumpBox.x+driverJumpBox.width<=320,'ปุ่มงานคนขับต้องกดได้เต็มที่บนมือถือ')
 await driverJump.getByRole('button',{name:'ไปแท็บงานคนขับ →'}).click();await page.getByRole('heading',{name:'งานคนขับ',exact:true}).waitFor()
 await page.setViewportSize({width:1280,height:900});await visit('driver')
 await row(b1).getByRole('button',{name:'ดูขั้นตอนต่อไป',exact:true}).click()
 await sheet.getByRole('region',{name:'ขั้นตอนหลังยืนยันรถ'}).getByRole('button',{name:'ไปงานคนขับ'}).click()
 await page.getByRole('heading',{name:'งานคนขับ',exact:true}).waitFor()
 await runAs(admin,async()=>rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings]))
 await staffDesk()
 // ── ชนคิว: ระบบลองรวมเที่ยวให้ก่อน (ผู้เดินทางเดิมไม่นั่งร่วม = รวมไม่ได้ บอกเหตุ) → แจ้งว่ารถไม่ว่าง ──
 await click('conflictDecline',row(b2).getByRole('button',{name:'ยืนยันรถ',exact:true}))
 await problem.waitFor();await problem.getByText('รถไม่ว่าง ช่วงเวลานี้ชนกับเที่ยวที่ยืนยันแล้ว').waitFor()
 await problem.getByText(/ไม่ได้: ผู้เดินทางเดิมในเที่ยวนั้นไม่ได้เลือกนั่งร่วม/).waitFor()
 // ยังไม่ยืนยันรถ = ยังไม่มีเที่ยว จึงยังไม่มีหนังสือนำส่ง แต่ใบคำขอถึงนายกพิมพ์ได้แล้ว (เจ้าของระบบสั่ง 2569-10-02 แบบ ก)
 // ปุ่ม "พิมพ์" บนหัวแผ่นพิมพ์เฉพาะใบคำขอของคำขอนี้ 1 แผ่น · แถบบนจอบอกว่าหนังสือนำส่งพิมพ์ได้หลังยืนยันรถและใบนี้จะออกอีกครั้ง
 // ในชุดนั้น · พิมพ์แล้วสถานะคำขอต้องไม่เปลี่ยน และแผ่นยังอยู่ให้ทำงานต่อ
 assert.equal(await sheet.getByRole('button',{name:'พิมพ์เอกสาร 2 ประเภท',exact:true}).count(),0,'ยังไม่ยืนยันรถ = ยังไม่มีหนังสือนำส่ง ปุ่มพิมพ์ชุดเอกสารของเที่ยวต้องไม่ขึ้น')
 {
  const [pendingWin]=await Promise.all([page.waitForEvent('popup'),sheet.getByRole('button',{name:'พิมพ์ใบคำขอถึงนายก',exact:true}).click()])
  await pendingWin.waitForFunction(()=>document.querySelector('.form-title')?.innerText.includes('ใบคำขอรถรับ-ส่งผู้ป่วย'))
  const doc=await printedDoc(pendingWin,b2)
  assert.deepEqual(doc.kinds,['form'],'รอยืนยันรถต้องพิมพ์ได้เฉพาะใบคำขอ 1 แผ่น ไม่มีหนังสือนำส่ง')
  assert.ok(doc.form.includes(mine.find(b=>b.id===b2).patient_name),'ใบคำขอต้องเป็นของคำขอที่เปิดอยู่')
  assert.equal(doc.note,'',`คำขอที่ผู้จองยื่นเอง ต้องไม่มีบรรทัดกำกับใต้ชื่อ (สั่งตัด 2569-10-02): "${doc.note}"`)
  assert.equal(doc.originCount,0,`ท้ายใบต้องไม่มีบรรทัดที่มา (เก็บที่เดียวใต้ชื่อแบบ — สั่งลบ 2569-10-02): "${doc.origin}"`)
  assert.match(doc.form,/ผ่านระบบ E-Service/,'ใต้ชื่อแบบต้องมี "ผ่านระบบ E-Service <อปท.>" เหมือนใบในชุดหลังยืนยัน')
  assert.ok(doc.notice&&doc.notice.display==='block'&&doc.notice.text.includes('หนังสือนำส่งกองทุนพิมพ์ได้หลังยืนยันรถ')&&doc.notice.text.includes('จะออกอีกครั้งในชุดเอกสารหลังยืนยันรถ'),`แถบบนจอของใบที่พิมพ์ตอนรอยืนยันรถ: ${JSON.stringify(doc.notice)}`)
  await Promise.all([pendingWin.waitForEvent('close'),pendingWin.getByRole('button',{name:'ปิดหน้าต่าง',exact:true}).click()])
  assert.equal((await bookingRow(b2)).status,'submitted','พิมพ์ใบคำขอแล้วสถานะคำขอต้องไม่เปลี่ยน')
  await problem.waitFor()
 }
 console.log('PASS pending request prints the request form only: header print button before vehicle confirmation, one sheet without the forwarding letter, on-screen note says the letter comes after confirmation, booking stays pending')
 assert.equal(await problem.getByLabel('เหตุผล: รถไม่ว่าง ให้บริการตามเวลานี้ไม่ได้').inputValue(),'รถไม่ว่างในช่วงเวลาที่ขอ')
 await click('conflictDecline',problem.getByRole('button',{name:'แจ้งว่ารถไม่ว่าง และยกเลิกคำขอ',exact:true}))
 // ยกเลิกแล้วย้ายไปส่วน "เสร็จแล้ว / ยกเลิก" ที่พับไว้ — หายจากจอทันที กดแสดงรายการแล้วเห็นป้ายยกเลิก
 await sheet.waitFor({state:'detached'});await row(b2).waitFor({state:'detached'})
 await openDone();await row(b2).getByText('ยกเลิกแล้ว').waitFor()
 assert.equal((await bookingRow(b2)).status,'cancelled');assert.equal(clicks.conflictDecline,2)
 assert.equal((await runSql(async()=>(await db.query("SELECT detail->>'note' AS note FROM public.patient_booking_events WHERE entity_id=$1 AND action='cancel'",[b2])).rows[0])).note,'รถไม่ว่างในช่วงเวลาที่ขอ','เหตุผลที่ไม่ให้บริการต้องอยู่ในประวัติ')
 // ── ชนคิวแต่ไปคันเดียวกันได้: บอกเวลาใหม่ก่อนกด แล้วทวนก่อนรวมเที่ยว ──
 await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click()
 await row(joinA).getByRole('button',{name:'ยืนยันรถ',exact:true}).click();await toast('ยืนยันรถแล้ว').waitFor()
 await submitAs(citizen,joinB,{patient_name:'[TEST] นายบี ขอไปด้วย',phone:'0810000005',share:true,appointment_at:at(joinDay,'10:15'),return_at:at(joinDay,'12:00')})
 await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click()
 await click('join',row(joinB).getByRole('button',{name:'ยืนยันรถ',exact:true}))
 const joinButton=problem.getByRole('button',{name:/^ให้ไปคันเดียวกัน · รถออกรับ \d\d:\d\d น\.$/});await joinButton.waitFor()
 await problem.getByText(/เวลารถออกรับใหม่ \d\d:\d\d น\. \(เดิม \d\d:\d\d น\.\)/).waitFor()
 await problem.getByRole('link',{name:'📞 [TEST] นางเอ นั่งร่วมได้'}).waitFor()
 dismissNextVehiclePrompt=true
 await joinButton.click()
 assert.equal((await bookingRow(joinB)).status,'submitted','ยกเลิกหน้าต่างทวนร่วมเที่ยวแล้วต้องยังไม่ยืนยันรถ')
 assert(vehiclePrompts.at(-1).includes('[TEST] นายบี ขอไปด้วย'),'หน้าต่างทวนร่วมเที่ยวต้องแสดงชื่อผู้ร่วมเที่ยว')
 await click('join',joinButton)
 await toast('ไปคันเดียวกับเที่ยวเดิม').waitFor()
 assert.equal(await tripOf(joinB),await tripOf(joinA),'ต้องอยู่เที่ยวเดียวกัน');assert.equal(clicks.join,2)
 // ── ยังไม่ได้ตรวจเขตพื้นที่ → "ตรวจแล้ว · ยืนยันรถ" ทวนก่อนบันทึก ──
 await click('area',row(areaC).getByRole('button',{name:'ยืนยันรถ',exact:true}))
 await problem.getByText('ยังไม่ได้ตรวจว่าจุดรับอยู่ในเขตพื้นที่ให้บริการ').waitFor()
 await click('area',problem.getByRole('button',{name:'ตรวจแล้ว จุดรับอยู่ในเขต · ยืนยันรถ',exact:true}))
 await toast('ยืนยันรถแล้ว').waitFor()
 const areaAfter=await bookingRow(areaC);assert.equal(areaAfter.status,'confirmed');assert.equal(areaAfter.in_area,true);assert.equal(clicks.area,2)
 // ── รถเข็น → ใส่ชื่อผู้ช่วยเคลื่อนย้ายแล้วยืนยัน ──
 await click('helper',row(chairD).getByRole('button',{name:'ยืนยันรถ',exact:true}))
 await problem.getByText('ผู้ป่วยใช้รถเข็นหรือเปล ต้องมีผู้ช่วยเคลื่อนย้ายไปด้วย').waitFor()
 await problem.getByLabel('ชื่อผู้ช่วยเคลื่อนย้ายที่ไปด้วย').fill('[TEST] นายผู้ช่วย ยกได้')
 await click('helper',problem.getByRole('button',{name:'ยืนยันรถ',exact:true}))
 await toast('ยืนยันรถแล้ว').waitFor();assert.equal((await bookingRow(chairD)).status,'confirmed');assert.equal(clicks.helper,2)
 // ── ระบบเสนอให้ไปด้วยกัน (นั่งร่วมได้ทั้งคู่ เวลาใกล้กัน) → ทวนชื่อทั้งกลุ่มก่อนยืนยัน ──
 await row(groupE).getByRole('button',{name:'ยืนยันรถ · ไปด้วยกัน 2 คน',exact:true}).click();await toast('ยืนยันรถแล้ว').waitFor()
 assert.equal(await tripOf(groupE),await tripOf(groupF))
 assert(vehiclePrompts.at(-1).includes('[TEST] ไปด้วยกัน อี')&&vehiclePrompts.at(-1).includes('[TEST] ไปด้วยกัน เอฟ'),'หน้าต่างทวนการยืนยันทั้งกลุ่มต้องแสดงชื่อครบทุกคน')
 console.log('PASS coordinator inbox: vehicle confirmation reviewed before saving, cancellation leaves booking pending; conflict, shared vehicle, area check, mover helper and suggested group through the real UI')
 // ── เอกสารแยกรายคน (เจ้าของระบบสั่ง 2569-10-02 เลือกแบบ ข: ใบคำขอ + หนังสือนำส่งของใครของมัน เลขที่หนังสือคนละเลข) ──
 // เดิม #368/#371 พิมพ์ทั้งเที่ยวชุดเดียว (กรอบ "เอกสารชุดเดียวกัน · พิมพ์ครั้งเดียว") — เลิกแล้ว · กรอบกลุ่มเที่ยว #370 ยังอยู่ แต่บอกแค่ว่าไปรถคันเดียวกัน
 // ตรวจกับหน้าต่างพิมพ์และฐานข้อมูลจริง: ปุ่มพิมพ์ของแถวไหนต้องได้เฉพาะเอกสารของคนนั้น และเลขที่หนังสือแยกกันจริง
 {
  const groupTrip=await tripOf(groupE),tripFrame=page.locator(`tr[data-trip-group="${groupTrip}"]`)
  await tripFrame.waitFor();await page.mouse.move(0,0)
  // หัวกรอบ: จำนวนคน วัน เวลารถ — ไม่มีคำว่าเอกสาร และไม่มีปุ่มพิมพ์ทั้งเที่ยว
  assert.match((await tripFrame.innerText()).replace(/\s+/g,' ').trim(),/^เที่ยวเดียวกัน 2 คน · \S.* (รถมารับ|รถเริ่มรับ) \d\d:\d\d น\.$/,'หัวกรอบต้องบอกจำนวนคน วัน เวลารถมารับ เท่านั้น')
  assert.equal(await tripFrame.locator('button').count(),0,'หัวกรอบต้องไม่มีปุ่มพิมพ์ทั้งเที่ยวแล้ว (เอกสารแยกรายคน)')
  assert.equal(await page.locator('[data-trip-print]').count(),0)
  assert(!(await page.locator('body').innerText()).includes('เอกสารชุดเดียวกัน'),'หน้าจอต้องไม่มีคำว่า "เอกสารชุดเดียวกัน" แล้ว')
  const framed=await page.locator('tbody tr').evaluateAll((trs,id)=>{const at=trs.findIndex(tr=>tr.dataset.tripGroup===id);return trs.slice(at+1,at+4).map(tr=>[tr.dataset.booking,tr.dataset.tripFrame??null,tr.style.backgroundColor])},groupTrip)
  assert.deepEqual(framed.slice(0,2).map(([id,frame])=>[id,frame]),[[groupE,groupTrip],[groupF,groupTrip]],'หัวกรอบต้องอยู่เหนือแถวของทุกคนในเที่ยวพอดี เรียงตามเวลานัด')
  assert.notEqual(framed[2]?.[1],groupTrip,'แถวถัดจากกรอบต้องไม่ใช่คนในเที่ยวนี้')
  assert.equal(framed[0][2],framed[1][2],'แถวในกรอบเดียวกันต้องพื้นสีเดียวกัน');assert(!['rgb(255, 255, 255)','rgb(245, 248, 252)'].includes(framed[0][2]),`พื้นแถวในกรอบต้องต่างจากแถวลายสลับปกติ: ${framed[0][2]}`)
  for(const id of [groupE,groupF])assert.equal(await row(id).getByText(/ไปรถคันเดียวกับ/).count(),0,'แถวในกรอบไม่ต้องมีบรรทัด "ไปรถคันเดียวกับ" ซ้ำ หัวกรอบบอกแล้ว')
  assert.equal(await row(b1).getAttribute('data-trip-frame'),null,'เที่ยวที่มีคนเดียวต้องไม่มีกรอบ')
  assert.equal(await row(b1).getByText(/ไปรถคันเดียวกับ/).count(),0,'เที่ยวที่มีคนเดียวต้องไม่ขึ้นบรรทัด "ไปรถคันเดียวกับ"')
  // คนในเที่ยวไม่ครบในจอ (ค้นหาเจอคนเดียว) = ไม่ตีกรอบ แถวกลับไปบอกชื่อคนที่ไปรถคันเดียวกันแทน หัวกรอบจึงไม่บอกจำนวนเกินแถวที่เห็น
  const inboxSearch=page.getByLabel('ค้นหาชื่อ เบอร์ จุดรับ โรงพยาบาล เลขที่',{exact:true})
  await inboxSearch.fill('ไปด้วยกัน อี')
  await row(groupE).getByText('ไปรถคันเดียวกับ [TEST] ไปด้วยกัน เอฟ',{exact:true}).waitFor()
  assert.equal(await page.locator('tr[data-trip-group]').count(),0,'เห็นคนเดียวของเที่ยวต้องไม่ตีกรอบ');assert.equal(await row(groupE).getAttribute('data-trip-frame'),null)
  await inboxSearch.fill('');await tripFrame.waitFor()
  // มือถือ: กรอบเดียวกันครอบการ์ดของทุกคนในเที่ยว ไม่ล้นจอ และการ์ดแต่ละใบมีปุ่มพิมพ์ของตัวเองสูงอย่างน้อย 44px
  await page.setViewportSize({width:390,height:900})
  const cardFrame=page.locator(`section[data-trip-group="${groupTrip}"]`);await cardFrame.waitFor()
  assert.deepEqual(await cardFrame.locator('article[data-booking]').evaluateAll(cards=>cards.map(card=>card.dataset.booking)),[groupE,groupF],'กรอบบนมือถือต้องครอบการ์ดของทุกคนในเที่ยว')
  assert.equal(await cardFrame.locator('button[data-trip-print]').count(),0)
  for(const id of [groupE,groupF]){
   const cardPrint=cardFrame.locator(`article[data-booking="${id}"] button[data-row-print]`);await cardPrint.waitFor()
   const box=await cardPrint.boundingBox();assert(box.height>=44&&box.x>=0&&box.x+box.width<=390,`ปุ่มพิมพ์ในการ์ดมือถือต้องสูงอย่างน้อย 44px และอยู่ในจอ: ${JSON.stringify(box)}`)
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'กรอบกลุ่มเที่ยวต้องไม่ทำให้จอ 390px ล้น')
  await page.setViewportSize({width:1280,height:900});await tripFrame.waitFor()

  // ปุ่มพิมพ์ในแถว (ไอคอนเครื่องพิมพ์) — กดแล้วได้ใบคำขอ + หนังสือนำส่งของคนในแถวนั้นคนเดียว ไม่เปิดแผ่นรายละเอียด
  const packetOf=win=>win.evaluate(()=>[...document.querySelectorAll('.sheet')].map(s=>s.querySelector('.letter-sign')?'letter':!s.querySelector('.form-title')?'other':s.innerText.includes('[TEST] ไปด้วยกัน อี')?'form:E':s.innerText.includes('[TEST] ไปด้วยกัน เอฟ')?'form:F':'form:?'))
  const letterNoOf=win=>win.evaluate(()=>document.querySelector('.letter-no')?.innerText.replace(/\s+/g,' ').trim()??'')
  const printRow=async id=>{
   const button=row(id).getByRole('button',{name:/^พิมพ์เอกสาร 2 ประเภท: /});assert.equal(await button.locator('svg.lucide-printer').count(),1,'ปุ่มพิมพ์ในแถวต้องมีไอคอนเครื่องพิมพ์')
   const [win]=await Promise.all([page.waitForEvent('popup'),button.click()])
   await win.waitForFunction(()=>document.querySelector('.form-title')?.innerText.includes('ใบคำขอรถรับ-ส่งผู้ป่วย'))
   const out={packet:await packetOf(win),letterNo:await letterNoOf(win)};await win.close();assert.equal(await sheet.count(),0,'กดพิมพ์ที่แถวต้องไม่เปิดแผ่นรายละเอียดของใคร');return out
  }
  const printedE=await printRow(groupE),printedF=await printRow(groupF)
  assert.deepEqual(printedE.packet,['form:E','letter'],'กดพิมพ์ของคนแรกต้องได้ใบคำขอของเขา + หนังสือของเขา ไม่มีของอีกคน')
  assert.deepEqual(printedF.packet,['form:F','letter'],'กดพิมพ์ของคนที่สองต้องได้ใบคำขอของเขา + หนังสือของเขา ไม่มีของอีกคน')
  assert(!/พร|\d/.test(printedE.letterNo)&&!/พร|\d/.test(printedF.letterNo),`ยังไม่ได้บันทึกเลข ช่อง "ที่" ต้องเป็นเส้นประให้เขียนมือ: "${printedE.letterNo}" / "${printedF.letterNo}"`)

  // เลขที่หนังสือแยกรายคน: บันทึกผ่านหน้าจอทีละคน (กล่อง "เอกสารคำขอและนำส่งกองทุน" ในแผ่นของคนนั้น)
  const recordViaSheet=async(id,no)=>{
   await row(id).getByRole('button',{name:'ดูขั้นตอนต่อไป',exact:true}).click()
   await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
   const docs=sheet.locator('div.rounded-xl',{hasText:'เอกสารคำขอและนำส่งกองทุน'}).last()
   await docs.getByText(/เลขที่หนังสือแยกรายคน/).waitFor()
   await docs.getByRole('button',{name:'กรอกเลขหนังสือ',exact:true}).click()
   await docs.getByLabel('เลขที่หนังสือ').fill(no);await docs.getByRole('button',{name:'บันทึกเลขหนังสือ',exact:true}).click()
   await toast('บันทึกเลขหนังสือนำส่งแล้ว').waitFor();await docs.getByText(new RegExp(`ที่ ${no}`)).waitFor()
   await sheet.getByText('บันทึกเลขหนังสือนำส่ง',{exact:true}).first().waitFor({timeout:15000})
   await sheet.getByRole('button',{name:'ปิด',exact:true}).click();await sheet.waitFor({state:'detached'})
  }
  await recordViaSheet(groupE,'พร 72301/301')
  const letterRows=await runSql(async()=>(await db.query('SELECT id,forward_letter_no,forward_letter_date::text AS d,letter_revision FROM public.patient_bookings WHERE id=ANY($1)',[[groupE,groupF]])).rows)
  const rowE=letterRows.find(r=>r.id===groupE),rowF=letterRows.find(r=>r.id===groupF)
  assert.equal(rowE.forward_letter_no,'พร 72301/301');assert.equal(rowE.letter_revision,1);assert.equal(rowF.forward_letter_no,null,'บันทึกเลขของคนแรก ต้องไม่ไปติดคนที่สอง');assert.equal(rowF.letter_revision,0)
  assert.equal((await runSql(async()=>(await db.query('SELECT forward_letter_no FROM public.patient_booking_trips WHERE id=$1',[groupTrip])).rows[0])).forward_letter_no,null,'เลขหนังสือแยกรายคนต้องไม่เขียนทับเลขของเที่ยว')
  await recordViaSheet(groupF,'พร 72301/302')
  assert.equal((await printRow(groupE)).letterNo.includes('พร 72301/301'),true,'หนังสือของคนแรกต้องเป็นเลขของเขา')
  const secondPrint=await printRow(groupF);assert(secondPrint.letterNo.includes('พร 72301/302')&&!secondPrint.letterNo.includes('พร 72301/301'),`หนังสือของคนที่สองต้องเป็นเลขของเขา ไม่ใช่เลขของคนแรก: "${secondPrint.letterNo}"`)

  // ฐานข้อมูล: ตรวจ revision, สิทธิ์, ข้อมูลที่ไม่ถูกต้อง, ประวัติ และรายงานรายเดือน/รายงวดที่รวมเลขของทุกคนในเที่ยว
  const today=new Date().toISOString().slice(0,10)
  const letterRev=async id=>(await runSql(async()=>(await db.query('SELECT letter_revision FROM public.patient_bookings WHERE id=$1',[id])).rows[0])).letter_revision
  await runAs(coordinator,async()=>{
   assert.equal(await rpc('patient_booking_record_booking_letter',[tenant,groupE,0,'พร 72301/301',rowE.d]),1,'ยิงซ้ำด้วยค่าเดิมต้องตอบ revision ปัจจุบันโดยไม่เขียนซ้ำ')
   await assert.rejects(()=>rpc('patient_booking_record_booking_letter',[tenant,groupE,0,'พร 72301/399',today]),/เปลี่ยนแล้ว/,'revision เก่าที่ค่าต่างจากปัจจุบันต้องถูกปฏิเสธ')
   await assert.rejects(()=>rpc('patient_booking_record_booking_letter',[tenant,groupE,1,'',today]),/เลขที่หนังสือ/)
   await assert.rejects(()=>rpc('patient_booking_record_booking_letter',[tenant,groupE,1,'x','2600-01-01']),/วันที่หนังสือ/)
   await assert.rejects(()=>rpc('patient_booking_record_booking_letter',[tenant,b2,0,'x',today]),/ไม่พบคำขอนี้|ยังไม่ได้ยืนยัน/,'คำขอที่ยกเลิกแล้วต้องบันทึกเลขหนังสือไม่ได้')
  })
  for(const [who,user] of [['คนขับ',driver],['ผู้จอง',citizen]])await runAs(user,()=>assert.rejects(()=>rpc('patient_booking_record_booking_letter',[tenant,groupE,1,'y',today]),/เจ้าหน้าที่จัดคิว/,`${who}ต้องบันทึกเลขหนังสือไม่ได้`))
  assert.equal(await letterRev(groupE),1,'คำสั่งที่ถูกปฏิเสธต้องไม่เปลี่ยน revision')
  const letterEvents=await runSql(async()=>(await db.query("SELECT entity_id,detail->>'letter_no' AS no FROM public.patient_booking_events WHERE action='booking_letter_recorded' AND entity_id=ANY($1) ORDER BY created_at",[[groupE,groupF]])).rows)
  assert.deepEqual(letterEvents.map(e=>[e.entity_id,e.no]),[[groupE,'พร 72301/301'],[groupF,'พร 72301/302']],'ทุกการบันทึกเลขต้องมีร่องรอยในประวัติของคำขอนั้น')
  const monthDay=(await runSql(async()=>(await db.query("SELECT t.plan->>'date' AS d FROM public.patient_booking_trips t WHERE t.id=$1",[groupTrip])).rows[0])).d
  const reportRow=await runAs(coordinator,async()=>({month:(await rpc('patient_booking_month_report',[tenant,monthDay])).trips.find(t=>t.trip_id===groupTrip),period:(await rpc('patient_booking_period_report',[tenant,monthDay,monthDay])).trips.find(t=>t.trip_id===groupTrip)}))
  for(const [label,report] of Object.entries(reportRow))assert.equal(report?.letter_no,'พร 72301/301, พร 72301/302',`รายงาน${label}ของเที่ยวต้องรวมเลขหนังสือของทุกคน เรียงตามเวลานัด: ${report?.letter_no}`)
 }
 console.log('PASS separate documents per rider: trip frame only says who rides together (no document wording, no trip-wide print button); each row/card prints only that rider\'s request form + letter; letter numbers are recorded per rider through the sheet and the database (revision conflict, idempotent retry, roles, validation, audit event, month and period reports list every rider\'s number)')

 // ── รับจองแทนทางโทรศัพท์ → กลับกล่องพร้อมปุ่ม "ยืนยันรถเลย" ──
 await page.getByRole('button',{name:/รับจองแทน/}).click()
 await page.getByRole('heading',{name:'รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์'}).waitFor()
 assert.equal(await page.getByRole('checkbox',{name:/นั่งรถคันเดียวกับผู้ป่วยคนอื่น/}).isChecked(),true,'เจ้าหน้าที่รับแทนก็ติ๊กนั่งร่วมไว้ก่อน')
 await setDay(intakeDay)
 await page.getByRole('group',{name:'เวลานัดแพทย์'}).getByRole('button',{name:'10:00 น.',exact:true}).click()
 await page.getByLabel('ชื่อ–สกุลผู้จอง',{exact:true}).fill('[TEST] ผู้ป่วยโทรมา');await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).fill('0810000010')
 await page.getByRole('group',{name:'หมู่บ้าน/สถานที่'}).getByRole('button',{name:'TEST บ้านใต้'}).click()
 await page.getByRole('button',{name:'ส่งคำขอ',exact:true}).click()
 await page.getByRole('checkbox',{name:'ผู้จองยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น (แจ้งทางโทรศัพท์/หน้าเคาน์เตอร์แล้ว)'}).check()
 await page.getByRole('button',{name:'ยืนยันส่งคำขอ',exact:true}).click()
 await page.getByText('รับคำขอแทนแล้ว',{exact:true}).waitFor()
 await page.getByRole('button',{name:'ยืนยันรถเลย',exact:true}).click();await toast('ยืนยันรถแล้ว').waitFor()
 const intake=(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).bookings.find(b=>b.patient_name==='[TEST] ผู้ป่วยโทรมา')
 assert.equal(intake.status,'confirmed');assert.equal(intake.entry_channel,'staff','ช่องทางต้องบันทึกว่าเจ้าหน้าที่รับแทน');assert.equal(intake.share,true)
 // ── ใบพิมพ์ของคำขอที่รับจองแทน (เจ้าของระบบเลือก 2569-10-01 "ไม่ต้องเซ็น") ──
 // บอกตามจริงว่าเจ้าหน้าที่รับจองแทน ห้ามอ้างว่าผู้แจ้งยืนยันตัวตนผ่านระบบ และหนังสือนำส่งต้องไม่เขียนขัดกับใบที่แนบ
 {
  await row(intake.id).getByRole('button',{name:'ดูขั้นตอนต่อไป',exact:true}).click()
  const [intakeWin]=await Promise.all([page.waitForEvent('popup'),sheet.getByRole('button',{name:'พิมพ์เอกสาร 2 ประเภท',exact:true}).click()])
  await intakeWin.waitForFunction(()=>document.querySelector('.form-title')?.innerText.includes('ใบคำขอรถรับ-ส่งผู้ป่วย'))
  const doc=await printedDoc(intakeWin,intake.id)
  // ลำดับกระดาษตามลำดับเรื่อง (เจ้าของระบบสั่ง 2569-10-01): ใบคำขอ ประชาชน → นายก ก่อน แล้วหนังสือนำส่ง นายก → กองทุน
  assert.deepEqual(doc.kinds,['form','letter'],'เที่ยวที่มีผู้ป่วยคนเดียวต้องพิมพ์ใบคำขอก่อน แล้วตามด้วยหนังสือนำส่ง')
  assert.equal(doc.note,'',`ใต้ชื่อผู้ยื่นต้องไม่มีบรรทัดกำกับ แม้เป็นคำขอที่เจ้าหน้าที่รับจองแทน (เจ้าของระบบสั่งตัดทุกช่องทาง 2569-10-02): "${doc.note}"`)
  assert.ok(doc.form.includes('[TEST] ผู้ป่วยโทรมา'),'ชื่อผู้แจ้งต้องอยู่บนใบคำขอ')
  for(const claim of ['ยืนยันตัวตน','ลงลายมือชื่อ','ผ่านระบบบริการอิเล็กทรอนิกส์','เจ้าหน้าที่รับจองแทน'])assert.ok(!doc.all.includes(claim),`เอกสารของคำขอที่รับจองแทนต้องไม่มี "${claim}"`)
  await intakeWin.close();await sheet.getByRole('button',{name:'ปิด',exact:true}).click();await sheet.waitFor({state:'detached'})
 }
 console.log('PASS staff intake by phone returns to the inbox with vehicle confirmation review, channel recorded as staff and printed as staff intake without an online-signature claim')
 // ── บัญชีเจ้าหน้าที่เปิดหน้าประชาชน: ฟอร์มต้องไม่เติมข้อมูลของคนที่โทรมาให้รับแทน ──
 // คำขอที่รับแทนบันทึกเจ้าหน้าที่เป็นผู้สร้าง ก่อน 20260922120000 จึงไปอยู่ใน "การจองของฉัน" ของเจ้าหน้าที่ด้วย
 // ถ้าหยิบมาเติม เจ้าหน้าที่ที่จองให้ตัวเองจะส่งคำขอด้วยชื่อ เบอร์ และจุดรับของคนอื่นโดยไม่รู้ตัว
 await page.setViewportSize({width:390,height:900})
 await page.goto(`${base}/__patient?as=coordinator`);await page.getByRole('region',{name:'บริการรถรับส่งผู้ป่วย'}).waitFor()
 // คำขอที่รับแทนเป็นงานของสำนักงาน (20260922120000) ไม่ขึ้นใน "คำขอของฉัน" ของคนที่รับสาย
 // ลิงก์ไปหน้าทำงานขึ้นหลังโหลดรายการของฉันเสร็จ ใช้เป็นสัญญาณว่ารายการมาครบแล้วก่อนตรวจว่าไม่มี
 await page.getByRole('link',{name:'ไปหน้าทำงานเจ้าหน้าที่',exact:true}).waitFor()
 assert.equal(await page.getByRole('article').filter({hasText:'[TEST] ผู้ป่วยโทรมา'}).count(),0,'คำขอที่รับแทนต้องไม่ขึ้นใน "คำขอของฉัน" ของเจ้าหน้าที่ที่รับสาย')
 await page.getByRole('button',{name:'🚐 ขอรถไปโรงพยาบาล',exact:true}).click()
 const ownName=page.getByLabel('ชื่อ–สกุลผู้จอง',{exact:true});await ownName.waitFor()
 assert.equal(await page.getByText('เติมข้อมูลจากการจองครั้งก่อนให้แล้ว',{exact:false}).count(),0,'คำขอที่รับแทนไม่ใช่การจองครั้งก่อนของเจ้าหน้าที่')
 assert.equal(await ownName.inputValue(),'TEST Browser Requester','ชื่อผู้จองต้องมาจากบัญชีตัวเอง ไม่ใช่คนที่โทรมา')
 assert.notEqual(await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).inputValue(),'0810000010','ต้องไม่มีเบอร์ของคนที่โทรมา')
 assert.notEqual(await page.getByRole('group',{name:'หมู่บ้าน/สถานที่'}).getByRole('button',{name:'TEST บ้านใต้'}).getAttribute('aria-pressed'),'true','ต้องไม่มีจุดรับของคนที่โทรมา')
 console.log('PASS staff account on the citizen page neither lists nor is prefilled from bookings it took by phone for other people')
 // ── ผู้จองทางโทรศัพท์โทรมาแจ้งพร้อมกลับ → ใครรับสายก็กดแทนได้จากแผ่นคำขอ ระบบแจ้งคนขับให้ ──
 // เดิมปุ่มนี้มีแค่ฝั่งประชาชน คำขอทางโทรศัพท์จึงกดได้เฉพาะคนที่รับสายตอนจอง ผ่านหน้าประชาชนของตัวเอง
 const intakeTrip=await tripOf(intake.id)
 await runAs(driver,async()=>{
  const ws=()=>rpc('patient_booking_workspace',[tenant])
  const tripStep=async()=>{const t=(await ws()).trips.find(x=>x.id===intakeTrip);await rpc('patient_booking_action',[tenant,randomUUID(),t.id,t.revision,'trip_next',''])}
  const riderStep=async()=>{const b=(await ws()).bookings.find(x=>x.id===intake.id);await rpc('patient_booking_action',[tenant,randomUUID(),b.id,b.revision,'passenger_next',''])}
  await tripStep();await riderStep();await riderStep();await tripStep()
 })
 assert.equal((await bookingRow(intake.id)).passenger_step,2,'ผู้ป่วยถึงโรงพยาบาลแล้ว')
 await staffDesk()
 await click('readyForCaller',row(intake.id).getByRole('button',{name:'ดูรายละเอียด',exact:true}))
 await click('readyForCaller',sheet.getByRole('button',{name:'แจ้งพร้อมให้มารับกลับแทนผู้จอง',exact:true}))
 await toast('บันทึกแล้ว').waitFor();assert.equal((await bookingRow(intake.id)).return_ready,true)
 await row(intake.id).getByText('พร้อมรับกลับ',{exact:true}).waitFor()
 const readyEvent=await runSql(async()=>(await db.query("SELECT actor_id FROM public.patient_booking_events WHERE entity_id=$1 AND action='ready_return'",[intake.id])).rows[0])
 assert.equal(readyEvent.actor_id,coordinator,'ประวัติต้องบอกว่าเจ้าหน้าที่คนไหนแจ้งแทน')
 assert(await runSql(async()=>(await db.query('SELECT count(*)::int AS n FROM public.patient_booking_notices WHERE entity_id=$1 AND recipient_id=$2',[intake.id,driver])).rows[0].n)>0,'คนขับต้องได้รับแจ้ง')
 assert.equal(clicks.readyForCaller,2,'เปิดแผ่น + กดแจ้ง')
 console.log('PASS caller phones in ready to return: any coordinator records it from the inbox sheet in 2 clicks, driver notified, actor audited')

 // ── ปุ่มของประชาชนถึงฐานข้อมูลจริง (op ครบ — กับดัก #244) + เจ้าหน้าที่ประสานยกเลิก ──
 const cancelId=randomUUID();await submitAs(citizen,cancelId,{patient_name:'TEST cancel button',phone:'0800000911'})
 await page.setViewportSize({width:390,height:900});await visit('citizen')
 await page.getByRole('article').filter({hasText:'TEST cancel button'}).getByRole('button',{name:'ยกเลิกคำขอ',exact:true}).click()
 await toast('บันทึกแล้ว').waitFor();assert.equal((await bookingRow(cancelId)).status,'cancelled')
 // ผู้จองกดยกเลิกเอง = ไม่มีเหตุผลของเจ้าหน้าที่ให้อ่าน (กล่องเหตุผลต้องไม่ขึ้นลอย ๆ)
 const ownCancelCard=page.getByRole('article').filter({hasText:'TEST cancel button'})
 await ownCancelCard.getByText('ยกเลิกแล้ว',{exact:true}).waitFor()
 assert.equal(await ownCancelCard.getByText('เจ้าหน้าที่แจ้งเหตุผลที่ยกเลิก').count(),0,'ผู้จองยกเลิกเองไม่ต้องมีเหตุผลของเจ้าหน้าที่')
 await page.getByRole('article').filter({hasText:areaC.slice(0,8).toUpperCase()}).getByRole('button',{name:'ขอประสานยกเลิก',exact:true}).click()
 await toast('บันทึกแล้ว').waitFor();assert.equal((await bookingRow(areaC)).cancel_requested,true)
 const areaTrip=await tripOf(areaC)
 await staffDesk();await row(areaC).getByRole('button',{name:'ประสานยกเลิก',exact:true}).click()
 await sheet.getByRole('button',{name:'ยกเลิกให้ตามที่ขอ',exact:true}).click();await sheet.waitFor({state:'detached'})
 assert.equal((await bookingRow(areaC)).status,'cancelled')
 assert.equal((await runSql(async()=>(await db.query('SELECT state FROM public.patient_booking_trips WHERE id=$1',[areaTrip])).rows[0])).state,'cancelled','ผู้เดินทางคนเดียวขอยกเลิก = คืนช่วงเวลารถทันที')
 // ── ผู้จองอ่านเหตุผลที่เจ้าหน้าที่บันทึกตอนยกเลิก (20260922130000) — b2 ถูกแจ้ง "รถไม่ว่าง" ไปก่อนหน้านี้ ──
 await page.setViewportSize({width:390,height:900});await visit('newcomer')
 const declinedCard=page.getByRole('article').filter({hasText:b2.slice(0,8).toUpperCase()})
 await declinedCard.getByText('เจ้าหน้าที่แจ้งเหตุผลที่ยกเลิก').waitFor()
 await declinedCard.getByText('รถไม่ว่างในช่วงเวลาที่ขอ').waitFor()
 console.log('PASS citizen cancel / cancellation request reach PostgreSQL; coordinator completes it and frees the vehicle; the traveller reads why staff cancelled')

 // ── คนขับ: ไป-กลับ 2 ปุ่ม · เที่ยวเดิมที่บันทึกค้างจบได้ · ผู้ป่วยแจ้งพร้อมกลับ · เลขไมล์ช่องเดียว ──
 const b1Trip=await tripOf(b1),chairTrip=await tripOf(chairD)
 await runSql(()=>db.query("UPDATE public.patient_booking_trips SET state='cancelled' WHERE state IN ('outbound','hospital','returning','issue') AND id NOT IN ($1,$2)",[b1Trip,chairTrip]))
 await page.setViewportSize({width:390,height:900})
 await page.clock.setFixedTime(new Date(`${b1Day}T07:00:00+07:00`))
 await visit('driver');await card(b1Trip).waitFor()
 await click('driverRound',card(b1Trip).getByRole('button',{name:'ออกรถ',exact:true}));await toast('บันทึกแล้ว · ออกรถ').waitFor()
 await runAs(driver,async()=>{const b=(await rpc('patient_booking_workspace',[tenant])).bookings.find(x=>x.id===b1);await rpc('patient_booking_action',[tenant,randomUUID(),b1,b.revision,'passenger_next',''])})
 await visit('newcomer');await page.getByRole('article').filter({hasText:b1.slice(0,8).toUpperCase()}).getByRole('button',{name:'พร้อมให้มารับกลับ',exact:true}).click()
 await toast('บันทึกแล้ว').waitFor();assert.equal((await bookingRow(b1)).return_ready,true)
 await visit('driver');await card(b1Trip).getByText('แจ้งพร้อมให้รับกลับแล้ว').waitFor()
 await click('driverRound',card(b1Trip).getByRole('button',{name:'กลับแล้ว · จบงาน',exact:true}))
 const odo=page.locator(`section[aria-label="จบแล้ว รอเติมเลขไมล์"] article[data-trip="${b1Trip}"]`);await odo.waitFor()
 assert.equal(clicks.driverRound,2,'ไป-กลับ 2 ปุ่ม');const b1Done=await bookingRow(b1);assert.equal(b1Done.status,'completed');assert.equal(b1Done.passenger_step,4)
 let startOdo=15000
 if(await odo.getByLabel('เลขไมล์ออก',{exact:true}).count())await odo.getByLabel('เลขไมล์ออก',{exact:true}).fill(String(startOdo))
 else startOdo=Number((await odo.locator('strong').first().innerText()).replace(/\D/g,''))
 await odo.getByLabel('เลขไมล์กลับ',{exact:true}).fill(String(startOdo+33));await odo.getByText('ระยะทาง 33 กม.',{exact:true}).waitFor()
 await odo.getByRole('button',{name:/^บันทึกเลขไมล์/}).click();await toast('บันทึกเลขไมล์แล้ว').waitFor();await odo.waitFor({state:'detached'})
 await visit('newcomer');await page.getByRole('article').filter({hasText:b1.slice(0,8).toUpperCase()}).getByText('เดินทางเสร็จแล้ว',{exact:false}).waitFor()
 // ── ขาเดียว + แจ้งเหตุขัดข้อง → เจ้าหน้าที่แก้จากกล่องคำขอรถ → คนขับวิ่งต่อจนจบ (2 ปุ่ม) ──
 await page.clock.setFixedTime(new Date(`${helperDay}T07:00:00+07:00`))
 await visit('driver')
 await click('driverOneWay',card(chairTrip).getByRole('button',{name:'ออกรถ',exact:true}));await toast('บันทึกแล้ว · ออกรถ').waitFor()
 await card(chairTrip).getByRole('button',{name:'แจ้งเหตุขัดข้อง',exact:true}).click()
 await card(chairTrip).getByRole('button',{name:'รถเสีย / รถมีปัญหา',exact:true}).click()
 await card(chairTrip).getByRole('button',{name:'ส่งให้เจ้าหน้าที่',exact:true}).click()
 await card(chairTrip).getByText(/แจ้งเหตุขัดข้องแล้ว: รถเสีย/).waitFor()
 await staffDesk();await row(chairD).getByRole('button',{name:'แก้เหตุขัดข้อง',exact:true}).click()
 await sheet.getByRole('button',{name:'แก้ไขแล้ว เดินรถต่อ',exact:true}).click();await sheet.waitFor({state:'detached'})
 await page.setViewportSize({width:390,height:900});await visit('driver')
 await click('driverOneWay',card(chairTrip).getByRole('button',{name:'กลับแล้ว · จบงาน',exact:true}));await toast('บันทึกแล้ว · กลับแล้ว · จบงาน').waitFor()
 const chairDone=await bookingRow(chairD);assert.equal(chairDone.status,'completed');assert.equal(chairDone.passenger_step,2);assert.equal(clicks.driverOneWay,2,'ขาเดียว 2 ปุ่ม')
 console.log('PASS driver: round trip in 2 presses with legacy partial-trip completion, ready-to-return bell, one-field odometer; one-way in 2 presses with incident resolved from the inbox')

 // ── เอกสารถึงกองทุนผ่านกล่องคำขอรถ + ร่างที่กรอกค้างไม่ถูกเขียนทับเงียบ ๆ ──
 {
  const trip=(id,time,end,state='completed')=>({id,state,odometer_end:end,plan:{pickup_at:`2026-10-05T${time}:00+07:00`}})
  const loaded=[trip('a','08:00',100),trip('late','11:00',200),trip('void','09:00',150,'cancelled'),trip('open','08:30',null,'confirmed')]
  assert.equal(previousOdometer(trip('now','09:30',null,'confirmed'),loaded),100,'ต้องหยิบเที่ยวก่อนหน้า ไม่ใช่เที่ยวที่วิ่งทีหลังหรือที่ยกเลิก')
  assert.equal(previousOdometer(trip('first','07:00',null,'confirmed'),loaded),'','ไม่มีเที่ยวก่อนหน้าต้องเว้นว่าง ไม่เดา')
 }
 await staffDesk();await row(b1).getByRole('button',{name:'บันทึกเอกสาร',exact:true}).click()
 // ── ปุ่ม "พิมพ์" บนหัวแผ่น (เจ้าของระบบขอ 2026-09-24) — ไม่ต้องเลื่อนหาปุ่มพิมพ์ในกล่องเอกสาร ──
 {
  const [letterWin]=await Promise.all([page.waitForEvent('popup'),click('printFromHeader',sheet.getByRole('button',{name:'พิมพ์เอกสาร 2 ประเภท',exact:true}))])
  await letterWin.waitForFunction(()=>document.querySelector('.form-title')?.innerText.includes('ใบคำขอรถรับ-ส่งผู้ป่วย'))
  const printed=await letterWin.evaluate(()=>document.body.innerText)
  assert.ok(printed.includes('ขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย'),'ต้องได้หนังสือนำส่ง')
  assert.ok(printed.includes(b1.slice(0,8).toUpperCase()),'ต้องเป็นเอกสารของเที่ยวที่เปิดอยู่')
  // ผู้จองล็อกอินจองเอง (entry_channel 'online') = ลงชื่อออนไลน์ ไม่ขอให้เซ็นปากกา (เจ้าของระบบสั่ง 2569-10-01)
  const doc=await printedDoc(letterWin,b1)
  assert.equal(doc.note,'',`ใบที่ผู้จองยื่นเองต้องไม่มีบรรทัดกำกับใต้ชื่อ (สั่งตัด 2569-10-02): "${doc.note}"`)
  assert.equal(doc.originCount,0,`ท้ายใบของใบที่ผู้จองยื่นเองต้องไม่มีบรรทัดที่มา (สั่งลบ 2569-10-02): "${doc.origin}"`)
  assert.ok(!doc.form.includes('ลงลายมือชื่อ')&&!doc.form.includes('รับจองแทน'),'ใบของผู้ที่จองเองต้องไม่ขอให้เซ็นปากกา และไม่ติดข้อความของคำขอที่รับจองแทน')
  // ลำดับกระดาษ: ใบคำขอทุกใบก่อน หนังสือนำส่งเป็นแผ่นสุดท้าย (เจ้าของระบบสั่ง 2569-10-01)
  assert.ok(doc.kinds.length>=2&&doc.kinds.at(-1)==='letter'&&doc.kinds.slice(0,-1).every(kind=>kind==='form'),`ลำดับแผ่นต้องเป็น ใบคำขอ → หนังสือนำส่ง: ${doc.kinds}`)
  // หนังสือนำส่ง: นายกเซ็นปากกา ระบบไม่พิมพ์ชื่อเป็นลายมือชื่อ · ฐานทดสอบไม่มีทะเบียนผู้ลงนาม = ต้องเตือนบนจอว่าไปตั้งที่ไหน
  assert.equal(doc.mayorSigned,0,'หนังสือนำส่งต้องไม่มีชื่อพิมพ์แทนลายมือชื่อของนายก')
  assert.ok(doc.notice?.text.includes('ผู้ลงนามเอกสาร')&&doc.notice.display==='block','ยังไม่ได้ตั้งชื่อนายก หน้าต่างพิมพ์ต้องขึ้นแถบเตือนบนจอ')
  assert.equal(clicks.printFromHeader,1);await letterWin.close()
 }
 await sheet.getByRole('button',{name:'กรอกเลขหนังสือ',exact:true}).click()
 await sheet.getByLabel('เลขที่หนังสือ',{exact:true}).fill('พร 72301/77');await sheet.getByRole('button',{name:'บันทึกเลขหนังสือ',exact:true}).click();await toast('บันทึกเลขหนังสือนำส่งแล้ว').waitFor()
 // เอกสารครบแล้ว = แถวไม่มีงานค้าง ย้ายไปส่วน "เสร็จแล้ว / ยกเลิก" ที่พับไว้ (ปุ่มแถวเป็น "ดูรายละเอียด" ตรวจในฉาก inbox order)
 // แผ่นที่เปิดอยู่ไม่ปิดตาม และแบบฟอร์มย้ายไปอยู่ใต้ "จัดการเพิ่มเติม"
 await row(b1).waitFor({state:'detached'})
 await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByText(/^ที่ พร 72301\/77 ลงวันที่/).waitFor()
 let docs=(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===b1Trip)
 // เลขหนังสือแยกรายคน (2569-10-02): บันทึกที่คำขอของคนนั้น ไม่เขียนทับเลขของเที่ยว
 const b1Letter=(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).bookings.find(x=>x.id===b1)
 assert.equal(b1Letter.forward_letter_no,'พร 72301/77','เลขหนังสือต้องบันทึกที่คำขอของคนที่เปิดแผ่น');assert.equal(docs.forward_letter_no,null,'เลขของเที่ยวต้องไม่ถูกเขียน')
 assert.equal(docs.odometer_end,startOdo+33,'เลขไมล์ของคนขับต้องถึงฐานข้อมูล')
 await sheet.getByLabel('เลขไมล์กลับ',{exact:true}).fill(String(startOdo+40));await sheet.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).selectOption('กรอกผิด')
 await runAs(coordinator,()=>rpc('patient_booking_save_odometer',[tenant,b1Trip,docs.docs_revision,16000,16044,false,'กรอกผิด']))
 await sheet.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await sheet.getByText(/ค่าล่าสุด: เลขไมล์ออก 16000/).waitFor()
 assert.equal(await sheet.getByLabel('เลขไมล์กลับ',{exact:true}).inputValue(),String(startOdo+40))
 assert.equal(await sheet.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).isDisabled(),true)
 await sheet.getByRole('button',{name:'ยืนยันใช้ค่าที่ฉันแก้',exact:true}).click();await sheet.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).click();await toast('บันทึกเลขไมล์แล้ว').waitFor()
 docs=(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===b1Trip);assert.equal(docs.odometer_end,startOdo+40)
 await sheet.getByRole('button',{name:'แก้เลขหนังสือ',exact:true}).click();await sheet.getByLabel('เลขที่หนังสือ',{exact:true}).fill('TEST draft')
 // ร่างเลขหนังสือชนกับคนอื่นที่บันทึกก่อน: เลขหนังสือแยกรายคนแล้ว (2569-10-02) revision ที่เทียบคือ letter_revision ของคำขอ
 const b1Now=(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).bookings.find(x=>x.id===b1)
 await runAs(coordinator,()=>rpc('patient_booking_record_booking_letter',[tenant,b1,b1Now.letter_revision,'TEST newest',b1Now.forward_letter_date]))
 await sheet.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await sheet.getByText(/ค่าล่าสุด: เลขหนังสือ TEST newest/).waitFor()
 assert.equal(await sheet.getByRole('button',{name:'บันทึกเลขหนังสือ',exact:true}).isDisabled(),true)
 await sheet.getByRole('button',{name:'ใช้ค่าล่าสุด',exact:true}).click();assert.equal(await sheet.getByLabel('เลขที่หนังสือ',{exact:true}).inputValue(),'TEST newest')
 await sheet.getByLabel('เลขไมล์กลับ',{exact:true}).fill('5');await sheet.getByLabel('มาตรวัดมีปัญหา / ระยะทางรอตรวจสอบ',{exact:true}).check();await sheet.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).selectOption('เปลี่ยนมาตรวัด')
 await sheet.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).click();await toast('บันทึกเลขไมล์แล้ว').waitFor()
 const report=await runAs(coordinator,()=>rpc('patient_booking_month_report',[tenant,`${b1Day.slice(0,7)}-01`]));assert.equal(report.trips.find(t=>t.trip_id===b1Trip).distance,null)
 await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'})
 console.log('PASS fund documents through the inbox sheet: letter number + driver odometer reach PostgreSQL; stale drafts blocked, explicit overwrite, latest letter, abnormal meter excluded')

 // ── แจ้งรถล่าช้า (ย้ายจากตารางออกรถมาอยู่ใน "จัดการเพิ่มเติม") ผู้จองเห็นเวลาใหม่ในการ์ดของตัวเอง ──
 const joinTrip=await tripOf(joinA)
 await row(joinA).click();await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByRole('button',{name:'เปลี่ยนวันและเวลาเดินทาง',exact:true}).waitFor()
 assert.equal(await sheet.getByRole('button',{name:'แจ้งรถล่าช้า / เวลารับล่าสุด',exact:true}).count(),0,'ก่อนออกรถต้องไม่เห็นฟอร์มแจ้งเวลาโดยประมาณซ้ำกับการเปลี่ยนคิว')
 await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'})
 await runAs(driver,async()=>{const t=(await rpc('patient_booking_workspace',[tenant])).trips.find(x=>x.id===joinTrip);await rpc('patient_booking_action',[tenant,randomUUID(),joinTrip,t.revision,'trip_next',''])})
 await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click()
 await row(joinA).click();await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByRole('button',{name:'แจ้งรถล่าช้า / เวลารับล่าสุด',exact:true}).click()
 assert.equal(await sheet.getByText('เปลี่ยนวันและเวลาเดินทาง',{exact:true}).count(),0,'ระหว่างเที่ยวต้องไม่แสดงฟอร์มย้ายคิวคู่กับฟอร์มแจ้งเวลา')
 await sheet.getByLabel('ประกาศการเดินทาง',{exact:true}).selectOption('delayed')
 await sheet.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).fill('10:00');await sheet.getByLabel('รับกลับประมาณการใหม่',{exact:true}).fill('14:30')
 await sheet.getByRole('button',{name:'บันทึกประกาศและเวลา',exact:true}).click();await toast('บันทึกประกาศและเวลาประมาณการแล้ว').waitFor()
 await sheet.getByRole('button',{name:'แจ้งรถล่าช้า / เวลารับล่าสุด',exact:true}).click();await sheet.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).fill('10:05')
 const scheduled=(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===joinTrip)
 await runAs(coordinator,()=>rpc('patient_booking_update_schedule',[tenant,joinTrip,scheduled.schedule_revision,'delayed',at(joinDay,'10:10'),at(joinDay,'14:30')]))
 await sheet.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await sheet.getByText(/ข้อมูลแจ้งเวลาเปลี่ยนแล้ว:/).waitFor()
 assert.equal(await sheet.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).inputValue(),'10:05')
 assert.equal(await sheet.getByRole('button',{name:'บันทึกประกาศและเวลา',exact:true}).isDisabled(),true)
 await sheet.getByRole('button',{name:'ใช้เวลาแจ้งล่าสุด',exact:true}).click();assert.equal(await sheet.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).inputValue(),'10:10')
 await page.keyboard.press('Escape')
 await page.setViewportSize({width:390,height:900});await visit('citizen')
 const joinCard=page.getByRole('article').filter({hasText:joinA.slice(0,8).toUpperCase()})
 await joinCard.getByText('รถล่าช้า · กรุณาตรวจเวลาล่าสุด',{exact:true}).waitFor();assert.match(await joinCard.innerText(),/10:10/)
 console.log('PASS delay notice from the inbox sheet reaches the traveller card; stale draft preserved and blocked')

 // ── จอหลายขนาด ทุกบทบาท ไม่ล้นแนวนอน ──
 for(const width of [320,390,768,1024]){
  await page.setViewportSize({width,height:900})
  for(const as of ['citizen','coordinator','driver','admin']){
   await visit(as);if(as==='admin')await page.getByRole('button',{name:'ตั้งค่า',exact:true}).click()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width} ${as} overflow`)
   if(as==='admin' && process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-settings-${width}.png`,fullPage:true})}
  }
  console.log(`PASS rendered ${width}px four roles`)
 }
 // ── จอ PC: กล่องคำขอรถเป็นตาราง ปุ่มดำเนินการต้องไม่ถูกตัด (คอลัมน์ปักขวา — #134) · จอเล็กเป็นการ์ด ──
 await page.setViewportSize({width:1440,height:950});await visit('coordinator')
 const inboxTable=page.locator('table').filter({hasText:'ผู้เดินทาง'}).first();await inboxTable.waitFor()
 assert.deepEqual(await inboxTable.locator('thead th').allTextContents(),['ที่','วันเวลานัด','ผู้เดินทาง','โรงพยาบาล / จุดรับ','สถานะ','ดำเนินการ'])
 assert.equal(await page.evaluate(()=>{const table=[...document.querySelectorAll('table')].find(t=>t.innerText.includes('ดำเนินการ'));if(!table)return 'ไม่พบตาราง';const right=Math.min(table.parentElement.getBoundingClientRect().right,innerWidth);const clipped=[...table.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().right>right+1);return clipped.length?`ปุ่มถูกตัด ${clipped.length}`:'ok'}),'ok')
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'กล่องคำขอรถ 1440px overflow')
 await page.setViewportSize({width:390,height:900});assert.equal(await page.locator('table').filter({hasText:'วันเวลานัด'}).locator('visible=true').count(),0,'จอเล็กต้องใช้การ์ด ไม่ใช่ตาราง')
 console.log('PASS inbox renders a desktop table at 1440px with actions visible, cards on small screens')
 // ── โครงเดียวกับกล่องงาน "คำร้อง": แถบแท็บชั้นเดียว กล่องบอกจำนวน ค้นหาได้ เปิดเรื่องเป็นแผ่นลอยทับ ──
 await page.clock.setFixedTime(new Date());await page.setViewportSize({width:1280,height:900});await visit('coordinator')
 const menu=page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'})
 assert.deepEqual(await menu.getByRole('button').allInnerTexts(),['คำขอรถ','ปฏิทิน','งานคนขับ','รายงาน'],'ผู้จัดคิวเห็นงานคนขับเพื่อจัดคนขับแทนด้วย')
 await page.setViewportSize({width:320,height:900})
 for(const tab of await menu.getByRole('button').all()){
  const box=await tab.boundingBox();assert(box.x>=0&&box.x+box.width<=321,'แท็บเจ้าหน้าที่ต้องเห็นเต็มปุ่มบนมือถือ')
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'แท็บเจ้าหน้าที่ 320px overflow')
 // ประวัติจริงเกิน 50 รายการ: โหลดทีละ 20 จากฐานข้อมูล พร้อมสิทธิ์เฉพาะผู้จัดคิว
 await runSql(async()=>{
  for(let i=0;i<61;i++)await db.query('INSERT INTO public.patient_booking_events(municipality_id,actor_id,entity_id,action,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)',[tenant,admin,randomUUID(),`[TEST] history ${String(i).padStart(2,'0')}`,{},new Date(Date.UTC(2026,8,27,12,0,i)).toISOString()])
 })
 // เหตุการณ์ที่รู้จัก + ข้อมูลเที่ยวเก่าเกิน 30 วัน ซึ่งต้องแสดงได้ในสรุปเดือนนั้น
 await runSql(async()=>{
  await db.query('INSERT INTO public.patient_booking_events(municipality_id,actor_id,entity_id,action,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)',[tenant,admin,joinA,'submitted',{},'2099-01-01T00:00:00Z'])
  for (const [state,end] of [['completed',115],['completed',null],['cancelled',120]]) {
   await db.query(`INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,state,confirmed_by,odometer_start,odometer_end,updated_at)
    VALUES($1,$2,$3,'{}',$4,$5,$6,100,$7,'2001-01-01')`,[randomUUID(),tenant,driver,{date:'2001-01-10',pickup_at:'2001-01-10T08:00:00+07:00',route_label:'[TEST] โรงพยาบาลเดือนเก่า'},state,admin,end])
  }
 })
 const eventCount=Number((await runSql(async()=>(await db.query('SELECT count(*) AS total FROM public.patient_booking_events WHERE municipality_id=$1',[tenant])).rows[0].total)))
 await assert.rejects(runAs(citizen,()=>rpc('patient_booking_events_page',[tenant,1])),/เฉพาะเจ้าหน้าที่/)
 await assert.rejects(runAs(driver,()=>rpc('patient_booking_events_page',[tenant,1])),/เฉพาะเจ้าหน้าที่/)
 const reportPage=await runAs(coordinator,()=>rpc('patient_booking_events_page',[tenant,1]))
 assert.equal(reportPage.total,eventCount);assert.equal(reportPage.events.length,20)
 await menu.getByRole('button',{name:'รายงาน',exact:true}).click()
 const monthlyReport=page.getByRole('region',{name:'สรุปการใช้รถตามช่วงเวลา',exact:true})
 const selectReportMonth=async value=>{await monthlyReport.getByLabel('ปี พ.ศ.',{exact:true}).selectOption(String(Number(value.slice(0,4))+543));await monthlyReport.getByLabel('เดือน',{exact:true}).selectOption(value.slice(5,7))}
 await selectReportMonth('2001-01')
 await monthlyReport.getByRole('heading',{name:'รายการเที่ยวช่วงนี้ · 2 เที่ยว',exact:true}).waitFor()
 assert.equal(await monthlyReport.locator('[data-report-trip]').count(),2,'เที่ยวเก่าเกิน 30 วันยังอยู่ในสรุปเดือนเดิม และไม่รวมเที่ยวที่ยกเลิก')
 assert.match(await monthlyReport.locator('[data-report-summary="จบเที่ยวแล้ว"]').innerText(),/2 เที่ยว/)
 assert.match(await monthlyReport.locator('[data-report-summary="ระยะทางที่บันทึกแล้ว"]').innerText(),/15 กม\./)
 assert.match(await monthlyReport.locator('[data-report-summary="ระยะทางที่บันทึกแล้ว"]').innerText(),/ยังไม่มีระยะทางที่ใช้ได้ 1 เที่ยว/)
 // Print button goes through actual Staff page -> real range RPC -> printable document.
 for(const selection of [{mode:'month',label:'ประจำเดือน มกราคม 2544'},{mode:'quarter',label:'ไตรมาส 2 · ปีงบประมาณ 2544'},{mode:'year',label:'ปีปฏิทิน 2544'},{mode:'custom',label:'ตามช่วงวันที่กำหนด'}]){
  await monthlyReport.getByRole('button',{name:REPORT_MODES[selection.mode],exact:true}).click()
  if(['quarter','year'].includes(selection.mode)){
   await monthlyReport.getByLabel('ปี พ.ศ.',{exact:true}).selectOption('2544')
   await monthlyReport.getByLabel('การนับปี',{exact:true}).selectOption(selection.mode==='quarter'?'fiscal':'calendar')
   if(selection.mode==='quarter')await monthlyReport.getByLabel('ไตรมาส',{exact:true}).selectOption('2')
  }
  if(selection.mode==='custom'){
   await monthlyReport.getByLabel('วันที่เริ่ม',{exact:true}).fill('2001-01-10')
   await monthlyReport.getByLabel('วันที่สิ้นสุด',{exact:true}).fill('2001-01-10')
  }
  await monthlyReport.getByRole('heading',{name:'รายการเที่ยวช่วงนี้ · 2 เที่ยว',exact:true}).waitFor()
  const [printWin]=await Promise.all([page.waitForEvent('popup'),monthlyReport.getByRole('button',{name:'พิมพ์สรุป',exact:true}).click()])
  await printWin.waitForFunction(()=>!!document.querySelector('.report-title'))
  assert((await printWin.locator('.report-title').innerText()).includes(selection.label))
  assert.match(await printWin.locator('tfoot').innerText(),/รวมเที่ยวที่จบแล้ว 2 เที่ยว/)
  assert(!await printWin.locator('body').innerText().then(text=>text.includes('PRIVATE_TEST')))
  const closePrint=printWin.getByRole('button',{name:'ปิดหน้าต่าง',exact:true})
  for(const width of [320,390,1440]){
   await printWin.setViewportSize({width,height:900})
   const box=await closePrint.boundingBox();assert(box.height>=44&&box.x>=0&&box.x+box.width<=width,'print close button visible at '+width)
  }
  await printWin.evaluate(()=>scrollTo(0,document.body.scrollHeight))
  assert(await closePrint.isVisible(),'close stays visible while reading a long document')
  await printWin.emulateMedia({media:'print'});assert.equal(await closePrint.isVisible(),false,'close is never printed')
  await printWin.emulateMedia({media:'screen'})
  await Promise.all([printWin.waitForEvent('close'),closePrint.click()])
  assert.equal(page.isClosed(),false,'closing print does not close the staff page')
 }
 // Slow preparation is also closeable; response arriving afterwards must not reopen it or raise an error.
 await page.route('**/__patient_rpc',async route=>{
  if(route.request().postDataJSON().name==='patient_booking_period_report')await new Promise(resolve=>setTimeout(resolve,400))
  await route.fallback()
 })
 const [loadingPrint]=await Promise.all([page.waitForEvent('popup'),monthlyReport.getByRole('button',{name:'พิมพ์สรุป',exact:true}).click()])
 await loadingPrint.getByRole('status').filter({hasText:'กำลังเตรียมเอกสาร...'}).waitFor()
 await Promise.all([loadingPrint.waitForEvent('close'),loadingPrint.getByRole('button',{name:'ปิดหน้าต่าง',exact:true}).click()])
 await page.waitForTimeout(500)
 assert.equal(await page.getByRole('alert').filter({hasText:'เตรียมสรุปตามช่วงเวลาไม่สำเร็จ'}).count(),0)
 assert.equal(page.context().pages().filter(p=>p!==page).length,0,'closed print never reopens after its data arrives')
 await page.unroute('**/__patient_rpc')
 await monthlyReport.getByRole('button',{name:'รายเดือน',exact:true}).click()
 // เลือกเดือนว่างต้องไม่แสดงยอดของเดือนก่อน
 await selectReportMonth('2001-02')
 await monthlyReport.getByText('ไม่มีเที่ยวรถในช่วงที่เลือก ลองเลือกช่วงอื่น').waitFor()
 assert.match(await monthlyReport.locator('[data-report-summary="จบเที่ยวแล้ว"]').innerText(),/0 เที่ยว/)
 // โหลดล้มเหลวมีทางลองใหม่ ไม่ขึ้นยอด 0 ลวง
 let failMonthOnce=true
 await page.route('**/__patient_rpc',async route=>{
  const request=route.request().postDataJSON()
  if(failMonthOnce&&request.name==='patient_booking_period_report'){
   failMonthOnce=false
   await route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{message:'[TEST] unavailable'}})})
  }else await route.continue()
 })
 await selectReportMonth('2001-01')
 await monthlyReport.getByRole('alert').waitFor()
 assert.equal(await monthlyReport.locator('[data-report-summary]').count(),0)
 await monthlyReport.getByRole('button',{name:'ลองอีกครั้ง'}).click()
 await monthlyReport.getByRole('heading',{name:'รายการเที่ยวช่วงนี้ · 2 เที่ยว',exact:true}).waitFor()
 await page.unroute('**/__patient_rpc')
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'สรุปรายเดือน 320px overflow')
 if(process.env.PATIENT_PREVIEW_SHOTS){
  await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true})
  await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/staff-report-320.png`,fullPage:true})
  await page.setViewportSize({width:1280,height:1000})
  await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/staff-report-1280.png`,fullPage:true})
  await page.setViewportSize({width:320,height:900})
 }
 console.log('PASS monthly report: selected month, trips older than 30 days, cancelled exclusion, missing odometer, empty month, retry, 320px')
 await page.locator('summary').filter({hasText:'ประวัติการทำรายการทุกเดือน'}).click()
 await page.locator('[data-report-event]').first().getByRole('heading',{name:'ส่งคำขอ',exact:true}).waitFor()
 await page.locator('[data-report-event]').first().getByText('[TEST] นางเอ นั่งร่วมได้',{exact:true}).waitFor()
 const historyNav=page.getByRole('navigation',{name:'แบ่งหน้าประวัติ'})
 await historyNav.getByText(`แสดง 1–20 จาก ${eventCount} รายการ · หน้า 1/${Math.ceil(eventCount/20)}`).waitFor()
 assert.equal(await page.locator('[data-report-event]').count(),20)
 await historyNav.getByRole('button',{name:'ถัดไป'}).click()
 await historyNav.getByText(`แสดง 21–40 จาก ${eventCount} รายการ · หน้า 2/${Math.ceil(eventCount/20)}`).waitFor()
 assert.equal(await page.locator('[data-report-event]').count(),20)
 await historyNav.getByRole('button',{name:'ถัดไป'}).click()
 await historyNav.getByText(`แสดง 41–60 จาก ${eventCount} รายการ · หน้า 3/${Math.ceil(eventCount/20)}`).waitFor()
 assert.equal(await page.locator('[data-report-event]').count(),20)
 await historyNav.getByRole('button',{name:'ก่อนหน้า'}).click()
 await historyNav.getByText(`แสดง 21–40 จาก ${eventCount} รายการ · หน้า 2/${Math.ceil(eventCount/20)}`).waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'รายงาน 320px overflow')
 console.log('PASS staff report pages through database; 20 rows per page, navigation, 320px, denied to citizen and driver')
 await menu.getByRole('button',{name:'ปฏิทิน',exact:true}).click()
 const staffCalendar=page.getByRole('region',{name:'ปฏิทินงานรถรับส่งผู้ป่วย'})
 await staffCalendar.getByLabel('ปี พ.ศ.',{exact:true}).selectOption(joinDay.slice(0,4))
 await staffCalendar.getByLabel('เดือน',{exact:true}).selectOption(joinDay.slice(5,7))
 const staffDay=staffCalendar.locator(`[data-staff-calendar-date="${joinDay}"]`)
 await staffDay.click();assert((await staffDay.boundingBox()).width>=44,'ปุ่มวันในปฏิทินเจ้าหน้าที่ต้องกดง่าย')
 await staffCalendar.getByRole('region',{name:'รายการในวันที่เลือก'}).getByText('[TEST] นางเอ นั่งร่วมได้').waitFor()
 if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/staff-calendar-320.png`,fullPage:true})}
 await staffCalendar.getByRole('button',{name:'ตารางรายการ'}).click()
 await staffCalendar.getByRole('region',{name:'ตารางรายการรายเดือน'}).getByText('[TEST] นางเอ นั่งร่วมได้').waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'ปฏิทินเจ้าหน้าที่ 320px overflow')
 await menu.getByRole('button',{name:'คำขอรถ',exact:true}).click()
 await page.setViewportSize({width:1280,height:900})
 console.log('PASS staff calendar: visible mobile tab, monthly day and table, confirmed trip and rider, 320px layout')
 await page.getByText(/^\d+ รายการ$/).first().waitFor()
 const search=page.getByLabel('ค้นหาชื่อ เบอร์ จุดรับ โรงพยาบาล เลขที่',{exact:true})
 await search.fill('ไม่มีชื่อนี้ในระบบ');await page.getByText('ไม่พบคำขอที่ค้นหา',{exact:true}).waitFor()
 assert.equal(await page.locator('table:visible').count(),0,'ค้นไม่เจอต้องไม่เหลือตารางค้างไว้')
 await search.fill('[TEST] นางเอ นั่งร่วมได้');await row(joinA).click()
 await sheet.getByText('วันเวลานัด',{exact:true}).waitFor()
 await page.keyboard.press('Escape');assert.equal(await sheet.count(),0,'กด Escape ต้องปิดแผ่นและกลับมาที่รายการ')
 console.log('PASS staff workspace uses the complaint-style shell: one tab bar, counted list card, search and a floating detail sheet')

 // ── ปิดรับจอง: ไม่มีทางรับเรื่องสำรอง ผู้ดูแลยังเข้าตั้งค่าได้ · แยกหน้าประชาชน/เจ้าหน้าที่ ──
 await actor(admin);const currentSettings=(await rpc('patient_booking_workspace',[tenant])).settings
 await rpc('patient_booking_save_settings',[tenant,currentSettings.revision,{...settings,enabled:false}])
 await visit('citizen');await page.getByText('หน่วยงานยังไม่เปิดรับจองรถออนไลน์ กรุณาติดต่อเจ้าหน้าที่เพื่อสอบถามบริการ',{exact:true}).waitFor()
 assert.equal(await page.locator('a[href*="type=patient_transport_request"]').count(),0)
 await page.getByRole('link',{name:'ติดตามคำขอที่เคยยื่นไว้',exact:true}).waitFor()
 await visit('admin');await page.getByRole('button',{name:'ตั้งค่า',exact:true}).click();await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).waitFor()
 const citizenSource=await readFile(new URL('../src/pages/CitizenDocRequest.jsx',import.meta.url),'utf8');const staffSource=await readFile(new URL('../src/pages/StaffDashboard.jsx',import.meta.url),'utf8')
 assert(citizenSource.indexOf('<Navigate to="/patient-transport" replace />') < citizenSource.indexOf('if (needsIdCard)'));assert(!citizenSource.includes('PatientTransportWizard'));assert(!staffSource.includes('PatientTransportWizard'));assert(staffSource.includes("onSelectPatientTransport={() => { setShowAdd(false); navigate('/staff/patient-transport') }}"));assert(staffSource.includes('<PatientTransportPanel'))
 assert(staffSource.includes('activeModule === PATIENT_TRANSPORT_MODULE_KEY && <PatientTransportStaff'),'แดชบอร์ดเจ้าหน้าที่ต้องเรนเดอร์โมดูลนี้เอง')
 assert(!staffSource.includes("externalUrl: '/staff/patient-transport'"),'เมนูต้องไม่พาออกไปหน้าลอยแยก')
 const appSource=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8')
 assert(appSource.includes('<Route path="/staff/patient-transport" element={<Navigate to="/staff" state={{ module: PATIENT_TRANSPORT_MODULE_KEY }} replace />} />'),'ลิงก์เดิมต้องพาเข้าโมดูลในโครงหน้าเจ้าหน้าที่')
 const citizenPage=await readFile(new URL('../src/pages/PatientTransportBooking.jsx',import.meta.url),'utf8')
 const staffPage=await readFile(new URL('../src/pages/PatientTransportStaff.jsx',import.meta.url),'utf8')
 assert(citizenPage.includes("'patient_booking_mine'")&&!citizenPage.includes('patient_booking_workspace'),'หน้าประชาชนต้องไม่ดึงคิวทั้งหน่วยงาน')
 for(const staffOnly of ['BookingSettings','BookingInbox','DriverTrips','BookingDaySchedule'])assert(!citizenPage.includes(staffOnly),`หน้าประชาชนไม่ควร import ${staffOnly}`)
 assert(staffPage.includes("'patient_booking_workspace'")&&staffPage.includes('p_staff_entry: true'))
 // บัญชีเจ้าหน้าที่เปิดหน้าประชาชนต้องได้หน้าประชาชนปกติ + ลิงก์ไปหน้าทำงาน
 await page.goto(`${base}/__patient?as=coordinator`);await page.getByRole('region',{name:'บริการรถรับส่งผู้ป่วย'}).waitFor()
 await page.getByRole('link',{name:'ไปหน้าทำงานเจ้าหน้าที่',exact:true}).waitFor()
 for(const staffTab of ['คำขอรถ','งานคนขับ','รายงาน','ตั้งค่า'])assert.equal(await page.getByRole('button',{name:staffTab,exact:true}).count(),0,`หน้าประชาชนไม่ควรมีแท็บ ${staffTab}`)
 await page.getByRole('link',{name:'หน้าทำงานเจ้าหน้าที่',exact:true}).waitFor()
 console.log('PASS split citizen/staff pages, staff links, citizen page loads only its own data, no fallback intake when closed')
 await page.goto(`${base}/__patient?as=coordinator&page=staff`)
 await page.getByRole('button',{name:'คำขอรถ',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'ลบ',exact:true}).count(),0)
 await page.goto(`${base}/__patient?as=admin&page=staff`)
 await page.getByRole('button',{name:'ลบ',exact:true}).first().waitFor()
 await page.getByRole('button',{name:'ลบ',exact:true}).first().click()
 const deleteDialog=page.getByRole('dialog',{name:'ลบคำขอรถ'})
 await deleteDialog.waitFor()
 assert(await deleteDialog.getByRole('button',{name:'ยืนยันลบถาวร'}).isDisabled())
 await deleteDialog.getByRole('button',{name:'เก็บคำขอไว้'}).click()
 await page.setViewportSize({width:390,height:844})
 await page.locator('article[data-booking]').first().getByRole('button',{name:'ลบ',exact:true}).click()
 await deleteDialog.waitFor()
 await deleteDialog.getByRole('button',{name:'เก็บคำขอไว้'}).click()
 await db.exec('RESET ROLE')
 const uiDeleteId='00000000-0000-4000-8000-000000000970'
 await db.query(`INSERT INTO public.patient_bookings SELECT (jsonb_populate_record(NULL::public.patient_bookings,to_jsonb(b)||jsonb_build_object('id',$1::text,'trip_id',NULL,'status','submitted','patient_name','TEST UI DELETE'))).* FROM public.patient_bookings b LIMIT 1`,[uiDeleteId])
 await page.reload()
 await page.locator(`article[data-booking="${uiDeleteId}"]`).getByRole('button',{name:'ลบ',exact:true}).click()
 await deleteDialog.getByLabel('เหตุผลการลบ').fill('TEST UI duplicate')
 await deleteDialog.getByRole('button',{name:'ยืนยันลบถาวร'}).click()
 await deleteDialog.waitFor({state:'detached'})
 assert.equal(await page.locator(`[data-booking="${uiDeleteId}"]`).count(),0)
 await db.exec('RESET ROLE')
 assert.equal((await db.query('SELECT id FROM public.patient_bookings WHERE id=$1',[uiDeleteId])).rows.length,0)
 console.log('PASS admin-only deletion buttons, confirmation, mandatory reason, mobile access and actual deletion through UI')
 // Select a trip eight months ahead through the monthly calendar and submit a real join request.
 await runAs(admin,async()=>rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings]))
 const monthDate=new Date();monthDate.setUTCDate(monthDate.getUTCDate()+240);while([0,6].includes(monthDate.getUTCDay()))monthDate.setUTCDate(monthDate.getUTCDate()+1)
 const monthDay=monthDate.toISOString().slice(0,10), monthBooking=randomUUID(), monthTrip=randomUUID()
 await submitAs(citizen,monthBooking,{patient_name:'TEST calendar shared rider',phone:'0800000765',share:true,companions:0,appointment_at:at(monthDay,'10:00'),return_at:at(monthDay,'12:00')})
 await runAs(coordinator,async()=>{const plan=await rpc('patient_booking_preview',[tenant,[monthBooking],'']);assert.deepEqual(plan.errors,[]);await rpc('patient_booking_confirm',[tenant,monthTrip,[monthBooking],plan,''])})
 await page.setViewportSize({width:390,height:900});await visit('newcomer')
 await page.getByRole('button',{name:'🚐 ขอรถไปโรงพยาบาล',exact:true}).click()
 await page.getByLabel('ปี พ.ศ.',{exact:true}).selectOption(monthDay.slice(0,4))
 await page.getByLabel('เดือน',{exact:true}).selectOption(monthDay.slice(5,7))
 const monthCell=page.locator(`[data-calendar-date="${monthDay}"]`)
 await monthCell.getByText('ร่วมได้',{exact:true}).waitFor();await monthCell.click()
 await page.getByRole('button',{name:'ขอร่วมเที่ยวนี้',exact:true}).click()
 await page.getByRole('group',{name:'เวลานัดแพทย์'}).getByRole('button',{name:'10:00 น.',exact:true}).click()
 await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).fill('0800000766')
 await page.getByRole('group',{name:'หมู่บ้าน/สถานที่'}).getByRole('button',{name:'TEST บ้านเหนือ'}).click()
 await page.getByLabel('บ้านเลขที่ / จุดสังเกต',{exact:true}).fill('TEST calendar pickup')
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 await page.screenshot({path:'D:/tmp/patient-month-calendar-390.png',fullPage:true})
 await page.getByRole('button',{name:'ส่งคำขอ',exact:true}).click()
 await page.getByRole('checkbox',{name:'ยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น'}).check()
 await page.getByRole('button',{name:'ยืนยันส่งคำขอ',exact:true}).click()
 await page.getByText('ส่งคำขอสำเร็จ',{exact:true}).waitFor()
 const joined=await runSql(()=>db.query('SELECT requested_trip_id FROM public.patient_bookings WHERE phone=$1',['0800000766']))
 assert.equal(joined.rows[0].requested_trip_id,monthTrip)
 console.log('PASS monthly picker: Thai month/year, eight-month trip details, mobile layout, join request persisted through actual UI')
 // Reschedule through the staff dialog on a narrow screen, then verify persisted queue.
 const moveUiDate=new Date();moveUiDate.setUTCDate(moveUiDate.getUTCDate()+190)
 const moveUiDay=moveUiDate.toISOString().slice(0,10);moveUiDate.setUTCDate(moveUiDate.getUTCDate()+1)
 const moveUiNext=moveUiDate.toISOString().slice(0,10), moveUiBooking=randomUUID(), moveUiTrip=randomUUID()
 await submitAs(citizen,moveUiBooking,{patient_name:'TEST UI RESCHEDULE',companions:0,appointment_at:at(moveUiDay,'10:00'),return_at:at(moveUiDay,'12:00')})
 await runAs(coordinator,async()=>{const plan=await rpc('patient_booking_preview',[tenant,[moveUiBooking],'']);await rpc('patient_booking_confirm',[tenant,moveUiTrip,[moveUiBooking],plan,''])})
 await staffDesk();await row(moveUiBooking).click()
 await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByRole('button',{name:'เปลี่ยนวันและเวลาเดินทาง',exact:true}).click()
 await page.setViewportSize({width:390,height:844})
 await sheet.getByLabel('วันเดินทางใหม่',{exact:true}).fill(moveUiNext)
 await sheet.getByLabel('เวลานัดแพทย์ใหม่',{exact:true}).fill('11:00')
 await sheet.getByLabel('เวลารับกลับใหม่',{exact:true}).fill('13:00')
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 await sheet.getByLabel('วันเดินทางใหม่',{exact:true}).scrollIntoViewIfNeeded()
 await page.screenshot({path:'D:/tmp/patient-reschedule-mobile.png',fullPage:false})
 await sheet.getByRole('button',{name:'บันทึกวันเวลาใหม่',exact:true}).click()
 await toast('เปลี่ยนวันเวลาแล้ว').waitFor()
 const movedUi=await runSql(async()=>(await db.query('SELECT appointment_at,return_at,trip_id FROM public.patient_bookings WHERE id=$1',[moveUiBooking])).rows[0])
 assert.equal(new Date(movedUi.appointment_at).toISOString(),new Date(at(moveUiNext,'11:00')).toISOString())
 assert.equal(new Date(movedUi.return_at).toISOString(),new Date(at(moveUiNext,'13:00')).toISOString())
 assert.notEqual(movedUi.trip_id,moveUiTrip)
 console.log('PASS mobile staff rescheduling through actual dialog: new day, appointment, return and reservation persisted')
 // Moving onto a day with a confirmed, overlapping trip must join that trip instead of creating a second vehicle reservation.
 const joinSourceDate=new Date(`${moveUiNext}T12:00:00Z`);joinSourceDate.setUTCDate(joinSourceDate.getUTCDate()+2)
 const joinSourceDay=joinSourceDate.toISOString().slice(0,10);joinSourceDate.setUTCDate(joinSourceDate.getUTCDate()+1)
 const joinTargetDay=joinSourceDate.toISOString().slice(0,10)
 const joinSource=randomUUID(),joinTarget=randomUUID(),joinSourceTrip=randomUUID(),joinTargetTrip=randomUUID()
 await submitAs(citizen,joinSource,{patient_name:'[TEST] ย้ายร่วมเที่ยวต้นทาง',phone:'0800000761',companions:0,appointment_at:at(joinSourceDay,'10:00'),return_at:at(joinSourceDay,'14:00')})
 await submitAs(citizen,joinTarget,{patient_name:'[TEST] ย้ายร่วมเที่ยวปลายทาง',phone:'0800000762',companions:0,appointment_at:at(joinTargetDay,'10:00'),return_at:at(joinTargetDay,'14:00')})
 await runAs(coordinator,async()=>{
  for(const [id,tripId] of [[joinSource,joinSourceTrip],[joinTarget,joinTargetTrip]]){
   const plan=await rpc('patient_booking_preview',[tenant,[id],'']);assert.deepEqual(plan.errors,[])
   await rpc('patient_booking_confirm',[tenant,tripId,[id],plan,''])
  }
 })
 const beforeJoin=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 const sourceSnapshot={trip:joinSourceTrip,revision:beforeJoin.trips.find(t=>t.id===joinSourceTrip).revision,
  docs_revision:beforeJoin.trips.find(t=>t.id===joinSourceTrip).docs_revision,schedule_revision:beforeJoin.trips.find(t=>t.id===joinSourceTrip).schedule_revision,
  settings_revision:beforeJoin.settings.revision,bookings:{[joinSource]:beforeJoin.bookings.find(b=>b.id===joinSource).revision}}
 const targetRevision=beforeJoin.trips.find(t=>t.id===joinTargetTrip).revision
 const targetBookingRevision=beforeJoin.bookings.find(b=>b.id===joinTarget).revision
 const moveArgs=[tenant,randomUUID(),joinSource,sourceSnapshot,joinTargetTrip,targetRevision,joinTarget,targetBookingRevision]
 await assert.rejects(runAs(citizen,()=>rpc('patient_booking_move_into_trip',moveArgs)),/เฉพาะเจ้าหน้าที่/)
 await assert.rejects(runAs(driver,()=>rpc('patient_booking_move_into_trip',moveArgs)),/เฉพาะเจ้าหน้าที่/)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_move_into_trip',[...moveArgs.slice(0,5),targetRevision+1,...moveArgs.slice(6)])),/เที่ยวเปลี่ยน/)
 await runSql(()=>db.query('UPDATE public.patient_booking_settings SET seats=1 WHERE municipality_id=$1',[tenant]))
 const capacityBefore=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_move_into_trip',moveArgs)),/ที่นั่งไม่พอ/)
 assert.deepEqual(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant])),capacityBefore,'capacity failure must roll back both trips and the rider')
 await runSql(()=>db.query('UPDATE public.patient_booking_settings SET seats=4 WHERE municipality_id=$1',[tenant]))
 await staffDesk();await row(joinSource).click()
 await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByRole('button',{name:'ย้ายไปร่วมเที่ยวที่มีอยู่',exact:true}).click()
 await sheet.getByLabel('เลือกเที่ยวปลายทาง').selectOption(joinTargetTrip)
 await sheet.getByText(/วันเวลานัดใหม่.*รับกลับ/).waitFor()
 // เที่ยวปลายทางเป็นวันถัดไป — ต้องเตือนว่าคนละวันกับนัดเดิมก่อนกดย้าย (เคสจริง 2569-10-01 ย้ายผิดวัน)
 await sheet.getByText('เที่ยวนี้คนละวันกับนัดเดิม',{exact:false}).waitFor()
 await page.setViewportSize({width:320,height:900})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'ย้ายร่วมเที่ยว 320px overflow')
 await sheet.getByRole('button',{name:'ย้ายไปร่วมเที่ยวนี้',exact:true}).click()
 await sheet.getByRole('status').filter({hasText:'ย้ายไปร่วมเที่ยวแล้ว'}).waitFor()
 const afterJoin=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 assert.equal(afterJoin.bookings.find(b=>b.id===joinSource).trip_id,joinTargetTrip)
 assert.equal(afterJoin.bookings.find(b=>b.id===joinSource).appointment_at,afterJoin.bookings.find(b=>b.id===joinTarget).appointment_at)
 assert.equal(afterJoin.bookings.find(b=>b.id===joinSource).return_at,afterJoin.bookings.find(b=>b.id===joinTarget).return_at)
 assert.equal(afterJoin.trips.find(t=>t.id===joinSourceTrip).state,'cancelled')
 assert.equal(afterJoin.trips.find(t=>t.id===joinTargetTrip).booking_ids.length,2)
 const persistedMove=await runSql(async()=>(await db.query("SELECT id,payload FROM public.patient_booking_operations WHERE payload->>'action'='move_into_trip' ORDER BY created_at DESC LIMIT 1")).rows[0])
 const replay=persistedMove.payload
 assert.deepEqual(await runAs(coordinator,()=>rpc('patient_booking_move_into_trip',[tenant,persistedMove.id,joinSource,replay.expected,joinTargetTrip,replay.target_revision,joinTarget,replay.target_booking_revision])),replay.result)
 assert.deepEqual(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant])),afterJoin,'retry must not alter trips or duplicate notices')
 console.log('PASS confirmed rider joins existing trip through staff UI; original preserved, guards, replay and 320px')
 // A patient already confirmed with the destination's other rider must not get a second
 // seat. Closing only the redundant later booking must also replan the remaining rider.
 const duplicateDate=new Date();duplicateDate.setUTCDate(duplicateDate.getUTCDate()+235)
 const duplicateTargetDay=duplicateDate.toISOString().slice(0,10);duplicateDate.setUTCDate(duplicateDate.getUTCDate()+1)
 const duplicateSourceDay=duplicateDate.toISOString().slice(0,10)
 const duplicateExisting=randomUUID(),duplicatePeer=randomUUID(),duplicateSource=randomUUID(),duplicateOther=randomUUID()
 const duplicateTargetTrip=randomUUID(),duplicateSourceTrip=randomUUID()
 for(const [id,name,phone,day] of [
  [duplicateExisting,'[TEST] ผู้เดินทางคิวซ้ำ','0800000771',duplicateTargetDay],
  [duplicatePeer,'[TEST] ผู้ร่วมเที่ยวปลายทาง','0800000772',duplicateTargetDay],
  [duplicateSource,'[TEST] ผู้เดินทางคิวซ้ำ','0800000771',duplicateSourceDay],
  [duplicateOther,'[TEST] ผู้ร่วมเที่ยวต้นทาง','0800000773',duplicateSourceDay],
 ]) await submitAs(citizen,id,{patient_name:name,phone,companions:0,appointment_at:at(day,'12:00'),return_at:at(day,'17:30')})
 await runAs(coordinator,async()=>{
  for(const [ids,tripId] of [[[duplicateExisting,duplicatePeer],duplicateTargetTrip],[[duplicateSource,duplicateOther],duplicateSourceTrip]]){
   const plan=await rpc('patient_booking_preview',[tenant,ids,''])
   await rpc('patient_booking_confirm',[tenant,tripId,ids,plan,''])
  }
 })
 const duplicateBefore=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 const duplicateStart=duplicateBefore.trips.find(t=>t.id===duplicateSourceTrip)
 const duplicateDestination=duplicateBefore.trips.find(t=>t.id===duplicateTargetTrip)
 const duplicateExpected={trip:duplicateSourceTrip,revision:duplicateStart.revision,docs_revision:duplicateStart.docs_revision,
  schedule_revision:duplicateStart.schedule_revision,settings_revision:duplicateBefore.settings.revision,
  bookings:Object.fromEntries(duplicateBefore.bookings.filter(b=>b.trip_id===duplicateSourceTrip).map(b=>[b.id,b.revision]))}
 const duplicateTargetRider=duplicateBefore.bookings.find(b=>b.id===duplicatePeer)
 const duplicateArgs=[tenant,randomUUID(),duplicateSource,duplicateExpected,duplicateTargetTrip,duplicateDestination.revision,
  duplicatePeer,duplicateTargetRider.revision]
 await assert.rejects(runAs(citizen,()=>rpc('patient_booking_move_into_trip',duplicateArgs)),/เฉพาะเจ้าหน้าที่/)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_move_into_trip',[
  ...duplicateArgs.slice(0,5),duplicateDestination.revision+1,...duplicateArgs.slice(6)])),/เที่ยวเปลี่ยน/)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_move_into_trip',[
  ...duplicateArgs.slice(0,6),duplicateExisting,duplicateBefore.bookings.find(b=>b.id===duplicateExisting).revision+1])),/เวลาของเที่ยวปลายทางเปลี่ยน/)
 await staffDesk();await row(duplicateSource).click()
 await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByRole('button',{name:'ย้ายไปร่วมเที่ยวที่มีอยู่',exact:true}).click()
 await sheet.getByLabel('เลือกเที่ยวปลายทาง').selectOption(duplicateTargetTrip)
 await sheet.getByText('ผู้เดินทางมีคิวที่ยืนยันแล้วในเที่ยวนี้',{exact:false}).waitFor()
 // คิวซ้ำคนละวัน (ต้นทางเป็นวันถัดจากปลายทาง) = อาจเป็นนัดจริง 2 วัน ช่องติ๊กต้องระบุวันนัดที่จะถูกยกเลิก
 await sheet.getByText('อาจเป็นนัดจริงคนละวัน',{exact:false}).waitFor()
 assert.equal(await sheet.getByText('เที่ยวนี้คนละวันกับนัดเดิม',{exact:false}).count(),0,'คิวซ้ำแสดงคำเตือนในกล่องเดียว ไม่ซ้อน 2 กล่อง')
 const closeDuplicate=sheet.getByRole('button',{name:'ปิดคำขอซ้ำ · ใช้คิวที่ยืนยันแล้ว'})
 assert(await closeDuplicate.isDisabled())
 await page.setViewportSize({width:320,height:900})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'duplicate confirmation 320px overflow')
 await sheet.getByRole('checkbox',{name:/ผู้ป่วยแจ้งแล้วว่าไม่ไปนัด/}).scrollIntoViewIfNeeded()
 await page.screenshot({path:'D:/tmp/patient-duplicate-confirm-320.png',fullPage:false})
 await sheet.getByRole('checkbox',{name:/ผู้ป่วยแจ้งแล้วว่าไม่ไปนัด/}).check()
 await closeDuplicate.click()
 let duplicateStatus='confirmed'
 for(let attempt=0;attempt<30 && duplicateStatus==='confirmed';attempt++){
  await new Promise(resolve=>setTimeout(resolve,100))
  duplicateStatus=(await runSql(async()=>(await db.query('SELECT status FROM public.patient_bookings WHERE id=$1',[duplicateSource])).rows[0])).status
 }
 assert.equal(duplicateStatus,'cancelled',`duplicate close failed: ${await sheet.getByRole('alert').allTextContents()}`)
 const duplicateAfter=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 assert.equal(duplicateAfter.bookings.find(b=>b.id===duplicateSource).status,'cancelled')
 assert.equal(duplicateAfter.bookings.find(b=>b.id===duplicateExisting).status,'confirmed')
 assert.match((await runAs(citizen,()=>rpc('patient_booking_mine',[tenant]))).bookings.find(b=>b.id===duplicateSource).cancel_note,/คำขอนี้ซ้ำกับคิวที่ยืนยันแล้ว/)
 assert.equal(duplicateAfter.bookings.find(b=>b.id===duplicatePeer).trip_id,duplicateTargetTrip)
 assert.equal(duplicateAfter.trips.find(t=>t.id===duplicateTargetTrip).revision,duplicateDestination.revision)
 const replanned=duplicateAfter.trips.find(t=>t.id===duplicateSourceTrip)
 assert.equal(replanned.state,'confirmed')
 assert.deepEqual(replanned.booking_ids,[duplicateOther])
 assert.notEqual(replanned.plan.pickup_at,duplicateStart.plan.pickup_at)
 assert.equal(replanned.plan.booking_ids.length,1)
 const closedOp=await runSql(async()=>(await db.query("SELECT id,payload FROM public.patient_booking_operations WHERE payload->>'action'='move_into_trip' ORDER BY created_at DESC LIMIT 1")).rows[0])
 assert.equal(closedOp.payload.result.duplicate_closed,true)
 assert.deepEqual(await runAs(coordinator,()=>rpc('patient_booking_move_into_trip',[
  tenant,closedOp.id,duplicateSource,closedOp.payload.expected,duplicateTargetTrip,closedOp.payload.target_revision,
  closedOp.payload.target_booking,closedOp.payload.target_booking_revision])),closedOp.payload.result)
 assert.deepEqual(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant])),duplicateAfter,'duplicate retry must be idempotent')
 console.log('PASS duplicate confirmed booking: reviewed UI closes only extra seat, replans other rider, preserves destination, rejects stale/unauthorized, retry')
 // Reproduce the real staff failure: a confirmed morning wait request and two pending
 // midday requests for the same destination. The visible group button must finish the job.
 const uiWaveDay=new Date();uiWaveDay.setUTCDate(uiWaveDay.getUTCDate()+300)
 const uiWaveDate=uiWaveDay.toISOString().slice(0,10)
 const uiWaveTrip=randomUUID(),uiEarly=randomUUID(),uiLateA=randomUUID(),uiLateB=randomUUID()
 await submitAs(citizen,uiEarly,{patient_name:'[TEST] UI รอบเช้า',phone:'0800000881',appointment_at:at(uiWaveDate,'09:00'),return_at:at(uiWaveDate,'16:00')})
 await submitAs(citizen,uiLateA,{patient_name:'[TEST] UI รอบสาย A',phone:'0800000882',companions:0,appointment_at:at(uiWaveDate,'12:00'),return_at:at(uiWaveDate,'16:00')})
 await submitAs(citizen,uiLateB,{patient_name:'[TEST] UI รอบสาย B',phone:'0800000883',companions:0,appointment_at:at(uiWaveDate,'12:00'),return_at:at(uiWaveDate,'16:00')})
 await runAs(coordinator,async()=>rpc('patient_booking_confirm',[tenant,uiWaveTrip,[uiEarly],await rpc('patient_booking_preview',[tenant,[uiEarly],'']),'']))
 await staffDesk()
 await row(uiLateA).getByRole('button',{name:/ยืนยันรถ.*ไปด้วยกัน 2 คน/}).click()
 await problem.getByText('จัดรถรับ 2 รอบได้').waitFor()
 await page.setViewportSize({width:320,height:900})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'multiwave staff 320px overflow')
 await problem.getByRole('button',{name:'ประสานแล้ว · ยืนยันรถหลายรอบ'}).click()
 await toast('ยืนยันรถแล้ว').waitFor()
 const uiWaveWs=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 assert([uiEarly,uiLateA,uiLateB].every(bid=>uiWaveWs.bookings.find(b=>b.id===bid).trip_id===uiWaveTrip))
 await visit('driver')
 await card(uiWaveTrip).getByText('แผนวิ่งรถวันนี้').waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'multiwave driver 320px overflow')
 await visit('citizen')
 await page.getByText(/รถจะมารับคุณประมาณ/).first().waitFor()
 console.log('PASS staff group button confirms two pickup waves; driver and citizen see their own schedule at 320px')
 // A confirmed rider must be able to correct both the pickup text and map pin without releasing shared vehicle time.
 const pickupDay=(await freeDays(1))[0],pickupBooking=randomUUID(),pickupTrip=randomUUID()
 await submitAs(citizen,pickupBooking,{patient_name:'[TEST] แก้จุดรับหลังยืนยัน',phone:'0800000891',companions:0,share:false,
  pickup:'TEST จุดรับเดิม',pickup_lat:18.1,pickup_lng:100.1,appointment_at:at(pickupDay,'10:00'),return_at:at(pickupDay,'12:00')})
 await runAs(coordinator,async()=>rpc('patient_booking_confirm',[tenant,pickupTrip,[pickupBooking],await rpc('patient_booking_preview',[tenant,[pickupBooking],'']),'']))
 const pickupBefore=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 const oldPickup=pickupBefore.bookings.find(b=>b.id===pickupBooking),oldTrip=pickupBefore.trips.find(t=>t.id===pickupTrip)
 const pickupArgs=[tenant,randomUUID(),pickupBooking,oldPickup.revision,'TEST จุดรับที่ถูกต้อง',18.2,100.2,true]
 for(const who of [null,citizen,driver]) await assert.rejects(runAs(who,()=>rpc('patient_booking_update_pickup',pickupArgs)),/permission denied|เฉพาะผู้ยืนยันคิวหรือแอดมิน/)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_update_pickup',[...pickupArgs.slice(0,3),oldPickup.revision+1,...pickupArgs.slice(4)])),/เปลี่ยนแล้ว/)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_update_pickup',[...pickupArgs.slice(0,7),false])),/อยู่ในเขตบริการ/)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_update_pickup',[...pickupArgs.slice(0,5),18.2,null,true])),/พิกัดครบ/)
 await staffDesk();await page.setViewportSize({width:320,height:900});await page.locator(`article[data-booking="${pickupBooking}"]`).click()
 await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByRole('button',{name:'แก้จุดรับ / หมุด'}).click()
 await sheet.getByLabel('จุดรับที่ถูกต้อง').fill('TEST จุดรับใหม่จากเจ้าหน้าที่')
 await sheet.getByText(/ยังไม่มีหมุดสำหรับจุดรับใหม่นี้/).waitFor()
 await sheet.getByRole('button',{name:'ปักหมุดใหม่'}).click()
 await page.getByRole('button',{name:'ยืนยันตำแหน่ง'}).click()
 await sheet.getByRole('checkbox',{name:/ตรวจแล้วว่าจุดรับใหม่นี้อยู่ในเขตบริการ/}).check()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'ฟอร์มแก้จุดรับต้องไม่ล้นจอ 320px')
 await sheet.getByRole('button',{name:'บันทึกจุดรับใหม่'}).scrollIntoViewIfNeeded()
 await page.screenshot({path:'D:/tmp/patient-pickup-correction-320.png'})
 await sheet.getByRole('button',{name:'บันทึกจุดรับใหม่'}).click()
 await toast('แก้จุดรับแล้ว').waitFor()
 const pickupAfter=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 const corrected=pickupAfter.bookings.find(b=>b.id===pickupBooking),correctedTrip=pickupAfter.trips.find(t=>t.id===pickupTrip)
 assert.equal(corrected.pickup,'TEST จุดรับใหม่จากเจ้าหน้าที่');assert.notEqual(corrected.pickup_lat,oldPickup.pickup_lat)
 assert(Number.isFinite(corrected.pickup_lat)&&Number.isFinite(corrected.pickup_lng))
 assert.equal(corrected.trip_id,pickupTrip);assert.equal(corrected.status,'confirmed');assert.equal(correctedTrip.state,'confirmed')
 assert.equal(correctedTrip.plan.pickup_at,oldTrip.plan.pickup_at);assert(correctedTrip.docs_revision>oldTrip.docs_revision)
 assert.equal(correctedTrip.plan.booking_revisions[pickupBooking],corrected.revision)
 const pickupAudit=await runSql(async()=>(await db.query("SELECT detail FROM public.patient_booking_events WHERE entity_id=$1 AND action='pickup_corrected'",[pickupBooking])).rows)
 assert.equal(pickupAudit.length,1);assert.equal(pickupAudit[0].detail.before.pickup,'TEST จุดรับเดิม')
 assert.equal(pickupAudit[0].detail.after.pickup,corrected.pickup)
 const retry=await runSql(async()=>(await db.query("SELECT id,payload FROM public.patient_booking_operations WHERE payload->>'action'='update_pickup' AND payload->>'booking'=$1",[pickupBooking])).rows[0])
 await runAs(coordinator,()=>rpc('patient_booking_update_pickup',[tenant,retry.id,pickupBooking,oldPickup.revision,corrected.pickup,corrected.pickup_lat,corrected.pickup_lng,true]))
 assert.equal((await runSql(async()=>(await db.query("SELECT count(*)::integer AS n FROM public.patient_booking_events WHERE entity_id=$1 AND action='pickup_corrected'",[pickupBooking])).rows[0])).n,1,'retry must not duplicate audit')
 const driverPickup=await runAs(driver,()=>rpc('patient_booking_workspace',[tenant]))
 assert.equal(driverPickup.bookings.find(b=>b.id===pickupBooking).pickup,corrected.pickup)
 assert(driverPickup.notices.some(n=>n.entity_id===pickupBooking&&n.message.includes('แก้จุดรับแล้ว')),'driver must receive an in-app notice')
 assert(JSON.stringify((await runAs(citizen,()=>rpc('patient_booking_mine',[tenant]))).bookings).includes(corrected.pickup))
 assert(!JSON.stringify(await runAs(null,()=>rpc('patient_booking_calendar',[tenant,pickupDay,pickupDay]))).includes(corrected.pickup),'public calendar must not expose corrected address')
 await sheet.getByRole('button',{name:'แก้จุดรับ / หมุด'}).click()
 await sheet.getByLabel('จุดรับที่ถูกต้อง').fill('TEST ร่างที่เปิดค้าง')
 await runAs(admin,()=>rpc('patient_booking_update_pickup',[tenant,randomUUID(),pickupBooking,corrected.revision,'TEST ข้อความใหม่ ไม่มีหมุด',null,null,true]))
 await sheet.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click()
 await sheet.getByText('คำขอเปลี่ยนแล้ว กรุณาปิดฟอร์มแล้วเปิดใหม่เพื่อตรวจข้อมูลล่าสุด').waitFor()
 assert(await sheet.getByRole('button',{name:'บันทึกจุดรับใหม่'}).isDisabled(),'stale form must not overwrite a concurrent correction')
 const adminCorrected=await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))
 assert.equal(adminCorrected.bookings.find(b=>b.id===pickupBooking).pickup_lat,null,'admin may remove a wrong pin')
 await runSql(()=>db.query("UPDATE public.patient_booking_trips SET state='outbound' WHERE id=$1",[pickupTrip]))
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_update_pickup',[tenant,randomUUID(),pickupBooking,adminCorrected.bookings.find(b=>b.id===pickupBooking).revision,'TEST สายเกินไป',null,null,true])),/รถยังไม่ออก/)
 await runSql(async()=>{
  await db.query("UPDATE public.patient_bookings SET status='completed',appointment_at=now()-interval '6 years',return_at=now()-interval '6 years' WHERE id=$1",[pickupBooking])
  await db.query("SELECT public.purge_expired_patient_booking_contacts('5 years',false)")
  const history=(await db.query("SELECT detail FROM public.patient_booking_events WHERE entity_id=$1 AND action='pickup_corrected'",[pickupBooking])).rows
  assert(history.every(e=>e.detail.contact_purged&&!('before' in e.detail)&&!('after' in e.detail)),'retention must remove copied pickup details from this new audit event')
  const operations=(await db.query("SELECT payload FROM public.patient_booking_operations WHERE payload->>'action'='update_pickup' AND payload->>'booking'=$1",[pickupBooking])).rows
  assert(operations.every(o=>o.payload.contact_purged&&!('pickup' in o.payload)&&!('lat' in o.payload)&&!('lng' in o.payload)),'retention must remove copied pickup details from retry records')
  await db.query("UPDATE public.patient_booking_trips SET state='completed' WHERE id=$1",[pickupTrip])
 })
 console.log('PASS confirmed pickup correction: staff UI map and text, 320px, role and state guards, audit, retry, private views and driver notice')
 // Correct the hospital on a confirmed booking without cancelling the citizen's request.
 await runAs(admin,async()=>{const ws=await rpc('patient_booking_workspace',[tenant]);await rpc('patient_booking_save_settings',[tenant,ws.settings.revision,{...ws.settings,routes:[...ws.settings.routes,{id:'hospital-b',label:'TEST Hospital B',minutes:15}]}])})
 const hospitalSnapshot=(ws,bid)=>{const b=ws.bookings.find(x=>x.id===bid),t=ws.trips.find(x=>x.id===b.trip_id);return {trip:t.id,revision:t.revision,docs_revision:t.docs_revision,schedule_revision:t.schedule_revision,settings_revision:ws.settings.revision,bookings:Object.fromEntries(ws.bookings.filter(x=>x.trip_id===t.id&&x.status!=='cancelled').map(x=>[x.id,x.revision]))}}
 const hospitalDay=(await freeDays(1))[0],hospitalBooking=randomUUID(),hospitalTrip=randomUUID()
 await submitAs(citizen,hospitalBooking,{patient_name:'[TEST] เปลี่ยนโรงพยาบาล',phone:'0800000921',companions:0,appointment_at:at(hospitalDay,'10:00'),return_at:at(hospitalDay,'14:00')})
 await runAs(coordinator,async()=>rpc('patient_booking_confirm',[tenant,hospitalTrip,[hospitalBooking],await rpc('patient_booking_preview',[tenant,[hospitalBooking],'']),'']))
 const hospitalBefore=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 const hospitalExpected=hospitalSnapshot(hospitalBefore,hospitalBooking)
 const hospitalArgs=[tenant,randomUUID(),hospitalBooking,hospitalExpected,'hospital-b','single']
 for(const who of [null,citizen,driver])await assert.rejects(runAs(who,()=>rpc('patient_booking_change_hospital',hospitalArgs)),/permission denied|เฉพาะผู้รับผิดชอบ/)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_change_hospital',[...hospitalArgs.slice(0,3),{...hospitalExpected,revision:999},...hospitalArgs.slice(4)])),/คิวเปลี่ยนแล้ว/)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_change_hospital',[...hospitalArgs.slice(0,4),'unknown','single'])),/เลือกโรงพยาบาล/)
 await staffDesk();await page.setViewportSize({width:320,height:900});await page.locator(`article[data-booking="${hospitalBooking}"]`).click()
 await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByRole('button',{name:'เปลี่ยนโรงพยาบาล',exact:true}).click()
 await sheet.getByLabel('โรงพยาบาลที่ถูกต้อง').selectOption('hospital-b')
 await sheet.getByRole('button',{name:'ตรวจและเปลี่ยนโรงพยาบาล',exact:true}).click()
 assert.equal((await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).bookings.find(b=>b.id===hospitalBooking).route_id,'a','review must not write before confirmation')
 await sheet.getByRole('button',{name:'ยืนยันเปลี่ยนโรงพยาบาล',exact:true}).scrollIntoViewIfNeeded()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'hospital form must fit 320px')
 await page.screenshot({path:'D:/tmp/patient-hospital-correction-320.png'})
 await sheet.getByRole('button',{name:'ยืนยันเปลี่ยนโรงพยาบาล',exact:true}).click()
 await sheet.getByRole('status').filter({hasText:'เปลี่ยนโรงพยาบาลแล้ว'}).waitFor()
 const hospitalAfter=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 const hb=hospitalAfter.bookings.find(b=>b.id===hospitalBooking),ht=hospitalAfter.trips.find(t=>t.id===hospitalTrip)
 assert.equal(hb.route_id,'hospital-b');assert.equal(hb.route_label,'TEST Hospital B');assert.equal(hb.status,'confirmed');assert.equal(hb.trip_id,hospitalTrip)
 assert.equal(hb.appointment_at,hospitalBefore.bookings.find(b=>b.id===hospitalBooking).appointment_at)
 assert.equal(ht.plan.route_id,'hospital-b');assert.equal(ht.plan.booking_revisions[hb.id],hb.revision);assert(ht.docs_revision>hospitalExpected.docs_revision)
 assert.notEqual(ht.plan.pickup_at,hospitalBefore.trips.find(t=>t.id===hospitalTrip).plan.pickup_at,'new travel time must change pickup')
 const hospitalOp=await runSql(async()=>(await db.query("SELECT id,payload FROM public.patient_booking_operations WHERE payload->>'action'='change_hospital' AND payload->>'booking'=$1",[hospitalBooking])).rows[0])
 await runAs(coordinator,()=>rpc('patient_booking_change_hospital',[tenant,hospitalOp.id,hospitalBooking,hospitalExpected,'hospital-b','single']))
 assert.deepEqual(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant])),hospitalAfter,'retry must not duplicate changes or notices')
 const hd=await runAs(driver,()=>rpc('patient_booking_workspace',[tenant]));assert.equal(hd.bookings.find(b=>b.id===hb.id).route_label,'TEST Hospital B');assert(hd.notices.some(n=>n.entity_id===ht.id&&n.message.includes('เปลี่ยนโรงพยาบาล')))
 assert(JSON.stringify(await runAs(citizen,()=>rpc('patient_booking_mine',[tenant]))).includes('TEST Hospital B'))
 assert(JSON.stringify(await runAs(null,()=>rpc('patient_booking_calendar',[tenant,hospitalDay,hospitalDay]))).includes('TEST Hospital B'))
 // Splitting two simultaneous riders cannot double-book the only vehicle; all changes roll back.
 const sharedDay=(await freeDays(1))[0],sharedA=randomUUID(),sharedB=randomUUID(),sharedTrip=randomUUID()
 for(const [id,name,phone]of [[sharedA,'A','0800000931'],[sharedB,'B','0800000932']])await submitAs(citizen,id,{patient_name:`[TEST] ร่วมเที่ยวเปลี่ยน รพ ${name}`,phone,companions:0,appointment_at:at(sharedDay,'10:00'),return_at:at(sharedDay,'14:00')})
 await runAs(coordinator,async()=>rpc('patient_booking_confirm',[tenant,sharedTrip,[sharedA,sharedB],await rpc('patient_booking_preview',[tenant,[sharedA,sharedB],'']),'']))
 const sharedBefore=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant])),sharedExpected=hospitalSnapshot(sharedBefore,sharedA)
 await assert.rejects(runAs(coordinator,()=>rpc('patient_booking_change_hospital',[tenant,randomUUID(),sharedA,sharedExpected,'hospital-b','single'])),/คิวเดิมยังอยู่/)
 assert.deepEqual(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant])),sharedBefore,'failed split must preserve both passengers, source plan, documents and notices')
 await runAs(admin,()=>rpc('patient_booking_change_hospital',[tenant,randomUUID(),sharedA,sharedExpected,'hospital-b','all']))
 const sharedAfter=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]));assert([sharedA,sharedB].every(id=>sharedAfter.bookings.find(b=>b.id===id).route_id==='hospital-b'))
 // A stale open form cannot silently overwrite another staff member's change.
 await sheet.getByRole('button',{name:'ปิดฟอร์มเปลี่ยนโรงพยาบาล'}).click();await sheet.getByRole('button',{name:'เปลี่ยนโรงพยาบาล',exact:true}).click()
 await sheet.getByLabel('โรงพยาบาลที่ถูกต้อง').selectOption('a')
 await runAs(admin,()=>rpc('patient_booking_change_hospital',[tenant,randomUUID(),hospitalBooking,hospitalSnapshot(sharedAfter,hospitalBooking),'a','single']))
 await sheet.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click()
 await sheet.getByText('คิวเปลี่ยนแล้ว กรุณาปิดฟอร์มและเปิดใหม่จากข้อมูลล่าสุด').waitFor()
 assert(await sheet.getByRole('button',{name:'ตรวจและเปลี่ยนโรงพยาบาล',exact:true}).isDisabled())
 await runSql(()=>db.query("UPDATE public.patient_booking_trips SET state='outbound' WHERE id=$1",[sharedTrip]))
 await assert.rejects(runAs(admin,()=>rpc('patient_booking_change_hospital',[tenant,randomUUID(),sharedA,hospitalSnapshot(sharedAfter,sharedA),'a','all'])),/รถยังไม่ออก/)
 await runSql(async()=>{await db.query("UPDATE public.patient_booking_trips SET state='completed' WHERE id=$1",[sharedTrip]);await db.query("UPDATE public.patient_bookings SET status='completed' WHERE trip_id=$1",[sharedTrip])})
 // Distinct outbound runs can split successfully without moving the other rider.
 const splitDay=(await freeDays(1))[0],splitA=randomUUID(),splitB=randomUUID(),splitTrip=randomUUID()
 for(const [id,name,phone,time]of [[splitA,'เช้า','0800000941','09:00'],[splitB,'บ่าย','0800000942','13:00']])await submitAs(citizen,id,{patient_name:`[TEST] แยกโรงพยาบาล ${name}`,phone,companions:0,appointment_at:at(splitDay,time),return_mode:'one_way',return_at:null})
 await runAs(coordinator,async()=>{
  await rpc('patient_booking_confirm',[tenant,splitTrip,[splitA],await rpc('patient_booking_preview',[tenant,[splitA],'']),''])
  await rpc('patient_booking_confirm_multiwave',[tenant,randomUUID(),[splitB],splitTrip,await rpc('patient_booking_preview_multiwave',[tenant,[splitB],splitTrip])])
 })
 const splitBefore=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 const splitResult=await runAs(coordinator,()=>rpc('patient_booking_change_hospital',[tenant,randomUUID(),splitB,hospitalSnapshot(splitBefore,splitB),'hospital-b','single']))
 assert.notEqual(splitResult.trip_id,splitTrip)
 const splitAfter=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 assert.deepEqual(splitAfter.bookings.find(b=>b.id===splitA),splitBefore.bookings.find(b=>b.id===splitA),'unchanged rider must keep original hospital and times')
 assert.equal(splitAfter.bookings.find(b=>b.id===splitB).trip_id,splitResult.trip_id)
 assert.equal(splitAfter.trips.find(t=>t.id===splitResult.trip_id).plan.route_id,'hospital-b')
 assert.deepEqual(splitAfter.trips.find(t=>t.id===splitTrip).booking_ids,[splitA])
 assert.equal(splitAfter.trips.find(t=>t.id===splitTrip).plan.outbound_waves.length,1)
 console.log('PASS hospital correction: mobile reviewed confirmation, role and revision guards, travel recalculation, shared conflict rollback, safe split, explicit all-rider change, driver/citizen/calendar updates and idempotent retry')
 // Driver sick leave: admin can see all assignments and make an audited replacement.
 await runAs(coordinator,async()=>{const t=(await rpc('patient_booking_workspace',[tenant])).trips.find(x=>x.id===joinTrip);if(t.state==='outbound')await rpc('patient_booking_action',[tenant,randomUUID(),t.id,t.revision,'trip_finish',''])})
 const coverDay=(await freeDays(1))[0],coverBooking=randomUUID(),coverTrip=randomUUID()
 await submitAs(citizen,coverBooking,{patient_name:'[TEST] คนขับลาป่วย',phone:'0800000951',companions:0,appointment_at:at(coverDay,'10:00'),return_mode:'one_way',return_at:null})
 await runAs(coordinator,async()=>rpc('patient_booking_confirm',[tenant,coverTrip,[coverBooking],await rpc('patient_booking_preview',[tenant,[coverBooking],'']),'']))
 const driverExpected=trips=>Object.fromEntries(trips.map(t=>[t.id,{revision:t.revision,docs_revision:t.docs_revision,driver_id:t.driver_id}]))
 const beforeCover=await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))
 const cover=beforeCover.trips.find(t=>t.id===coverTrip),coverExpected=driverExpected([cover])
 const coverArgs=[tenant,randomUUID(),coverTrip,null,driver,coverStaff,coverExpected,false]
 for(const who of [null,citizen,driver,coverStaff,setupAdmin])await assert.rejects(runAs(who,()=>rpc('patient_booking_reassign_driver',coverArgs)),/permission denied|เฉพาะแอดมินหรือผู้ยืนยันคิว/)
 await assert.rejects(runAs(admin,()=>rpc('patient_booking_reassign_driver',[...coverArgs.slice(0,5),setupAdmin,coverExpected,false])),/บัญชีเจ้าหน้าที่ของหน่วยงานนี้/)
 await assert.rejects(runAs(admin,()=>rpc('patient_booking_reassign_driver',[...coverArgs.slice(0,6),{[coverTrip]:{...coverExpected[coverTrip],revision:999}},false])),/เที่ยวหรือข้อมูลเปลี่ยน/)
 await staffDesk('admin');await page.setViewportSize({width:320,height:900})
 await page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'}).getByRole('button',{name:'งานคนขับ'}).click()
 await card(coverTrip).getByRole('button',{name:'เปลี่ยนคนขับเที่ยวนี้'}).click()
 await card(coverTrip).getByLabel('คนขับแทน').selectOption(coverStaff)
 await card(coverTrip).getByRole('button',{name:'ตรวจและเปลี่ยนคนขับ'}).click()
 assert.equal((await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===coverTrip).driver_id,driver,'review does not change driver')
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'320px admin replacement must fit')
 await card(coverTrip).getByRole('button',{name:'ยืนยันเปลี่ยนคนขับ'}).click()
 await toast('เปลี่ยนคนขับแล้ว').waitFor()
 const afterCover=await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))
 const assigned=afterCover.trips.find(t=>t.id===coverTrip)
 assert.equal(assigned.driver_id,coverStaff);assert(assigned.docs_revision>cover.docs_revision)
 assert.equal(assigned.driver_history.length,1);assert.equal(assigned.driver_history[0].phase,'before_departure')
 const substituteView=await runAs(coverStaff,()=>rpc('patient_booking_workspace',[tenant]))
 assert.equal(substituteView.role,'driver');assert(substituteView.trips.some(t=>t.id===coverTrip));assert.equal(substituteView.people,null)
 assert.equal((await runAs(coverStaff,()=>rpc('patient_booking_staff_work_badge',[tenant]))).driver,1)
 assert(!(await runAs(driver,()=>rpc('patient_booking_workspace',[tenant]))).trips.some(t=>t.id===coverTrip),'former driver must lose private trip access')
 const coverOperation=await runSql(async()=>(await db.query("SELECT id FROM public.patient_booking_operations WHERE payload->>'action'='reassign_driver' AND payload->>'trip'=$1",[coverTrip])).rows[0].id)
 await runAs(admin,()=>rpc('patient_booking_reassign_driver',[tenant,coverOperation,coverTrip,null,driver,coverStaff,coverExpected,false]))
 assert.equal((await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===coverTrip).driver_history.length,1,'retry must not duplicate history')
 // During an actual journey, require explicit handover and preserve both driver names.
 await visit('coverdriver');await card(coverTrip).getByText('TEST คนขับแทน',{exact:true}).first().waitFor()
 assert.equal(await card(coverTrip).getByRole('button',{name:'เปลี่ยนคนขับเที่ยวนี้'}).count(),0)
 await assert.rejects(runAs(driver,()=>rpc('patient_booking_action',[tenant,randomUUID(),coverTrip,assigned.revision,'trip_next',''])),/ไม่มีสิทธิ์/)
 await runAs(coverStaff,()=>rpc('patient_booking_action',[tenant,randomUUID(),coverTrip,assigned.revision,'trip_next','']))
 const inMotion=(await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===coverTrip)
 await assert.rejects(runAs(admin,()=>rpc('patient_booking_reassign_driver',[tenant,randomUUID(),coverTrip,null,coverStaff,driver,driverExpected([inMotion]),false])),/ส่งมอบงาน/)
 await runAs(coordinator,()=>rpc('patient_booking_reassign_driver',[tenant,randomUUID(),coverTrip,null,coverStaff,driver,driverExpected([inMotion]),true]))
 const handed=(await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===coverTrip)
 assert.equal(handed.driver_id,driver);assert.deepEqual(handed.driver_history.map(h=>h.phase),['before_departure','in_journey'])
 const driverHanded=await runAs(driver,()=>rpc('patient_booking_workspace',[tenant]))
 assert(driverHanded.trips.some(t=>t.id===coverTrip),'new driver sees the in-progress trip')
 assert(driverHanded.notices.some(n=>n.entity_id===coverTrip&&n.message.includes('เปลี่ยนคนขับ')))
 await staffDesk('admin');await page.setViewportSize({width:320,height:900})
 await page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'}).getByRole('button',{name:'งานคนขับ'}).click()
 await card(coverTrip).getByText('ประวัติคนขับ',{exact:true}).click()
 await card(coverTrip).getByText(/ส่งมอบระหว่างเที่ยว/).waitFor()
 await card(coverTrip).getByRole('button',{name:/จบงาน/}).click()
 await toast('บันทึกแล้ว').waitFor()
 const finishedCover=(await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===coverTrip)
 assert.equal(finishedCover.state,'completed');assert.equal(finishedCover.driver_id,driver,'admin recording must preserve the actual driver')
 await runAs(admin,()=>rpc('patient_booking_save_odometer',[tenant,coverTrip,finishedCover.docs_revision,20000,20120,false,'']))
 const finishAudit=await runSql(async()=>(await db.query("SELECT actor_id,detail FROM public.patient_booking_events WHERE entity_id=$1 AND action='trip_finish'",[coverTrip])).rows[0])
 assert.equal(finishAudit.actor_id,admin);assert.equal(finishAudit.detail.driver_id,driver)
 await assert.rejects(runAs(admin,()=>rpc('patient_booking_reassign_driver',[tenant,randomUUID(),coverTrip,null,driver,coverStaff,driverExpected([finishedCover]),false])),/เที่ยวหรือข้อมูลเปลี่ยน|เที่ยวจบ/)
 // One click can reassign every still-confirmed run on a chosen day.
 const coverAllDay=(await freeDays(1))[0],allA=randomUUID(),allB=randomUUID(),allTripA=randomUUID(),allTripB=randomUUID()
 for(const [id,time]of [[allA,'09:00'],[allB,'15:00']])await submitAs(citizen,id,{patient_name:`[TEST] คนขับแทนทั้งวัน ${time}`,phone:id===allA?'0800000952':'0800000953',companions:0,appointment_at:at(coverAllDay,time),return_mode:'one_way',return_at:null})
 await runAs(coordinator,async()=>{
  await rpc('patient_booking_confirm',[tenant,allTripA,[allA],await rpc('patient_booking_preview',[tenant,[allA],'']),''])
  await rpc('patient_booking_confirm',[tenant,allTripB,[allB],await rpc('patient_booking_preview',[tenant,[allB],'']),''])
 })
 const allBefore=await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))
 const allExpected=driverExpected(allBefore.trips.filter(t=>[allTripA,allTripB].includes(t.id)))
 await assert.rejects(runAs(citizen,()=>rpc('patient_booking_reassign_driver',[tenant,randomUUID(),null,coverAllDay,driver,admin,allExpected,false])),/permission denied|เฉพาะแอดมิน/)
 await assert.rejects(runAs(admin,()=>rpc('patient_booking_reassign_driver',[tenant,randomUUID(),null,coverAllDay,driver,admin,driverExpected([allBefore.trips.find(t=>t.id===allTripA)]),false])),/รายการเที่ยวหรือข้อมูลเปลี่ยน/)
 const collisionCover=randomUUID()
 await runSql(()=>db.query("INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,confirmed_by) SELECT $1,municipality_id,$2,'{}'::uuid[],plan,$2 FROM public.patient_booking_trips WHERE id=$3",[collisionCover,admin,allTripA]))
 await assert.rejects(runAs(admin,()=>rpc('patient_booking_reassign_driver',[tenant,randomUUID(),null,coverAllDay,driver,admin,allExpected,false])),/งานรถรับส่งผู้ป่วยชนเวลา/)
 const afterCollision=await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))
 for(const id of [allTripA,allTripB])assert.deepEqual(afterCollision.trips.find(t=>t.id===id),allBefore.trips.find(t=>t.id===id),'bulk conflict must not partially reassign any trip')
 await runSql(()=>db.query("UPDATE public.patient_booking_trips SET state='cancelled' WHERE id=$1",[collisionCover]))
 await staffDesk('admin');await page.setViewportSize({width:320,height:900})
 await page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'}).getByRole('button',{name:'งานคนขับ'}).click()
 await page.getByRole('button',{name:'จัดคนขับแทนวันนี้'}).click()
 await page.getByLabel('วันที่ต้องจัดคนขับแทน').fill(coverAllDay)
 await page.getByText('จัดคนขับแทนวันนี้ · 2 เที่ยว').waitFor()
 await page.getByLabel('คนขับแทน',{exact:true}).selectOption(admin)
 await page.getByRole('button',{name:'ตรวจและเปลี่ยนคนขับ'}).click()
 await page.getByRole('button',{name:'ยืนยันเปลี่ยนคนขับ'}).scrollIntoViewIfNeeded()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'bulk driver cover fits 320px')
 await page.screenshot({path:'D:/tmp/patient-driver-cover-320.png'})
 await page.getByRole('button',{name:'ยืนยันเปลี่ยนคนขับ'}).click()
 await toast('เปลี่ยนคนขับแล้ว').waitFor()
 const allAfter=await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))
 assert([allTripA,allTripB].every(id=>allAfter.trips.find(t=>t.id===id).driver_id===admin))
 assert([allTripA,allTripB].every(id=>allAfter.trips.find(t=>t.id===id).driver_history.length===1))
 const adminBadge=await runAs(admin,()=>rpc('patient_booking_staff_work_badge',[tenant]))
 assert(adminBadge.driver>=2,'admin badge shows substitute work')
 const rescheduledCover=await runAs(coordinator,()=>rpc('patient_booking_reschedule',[tenant,randomUUID(),allA,'single',hospitalSnapshot(allAfter,allA),at(coverAllDay,'09:15'),null,false]))
 assert(rescheduledCover.saved)
 assert.equal((await runAs(admin,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===rescheduledCover.trip_id).driver_id,admin,'rescheduling must preserve the explicitly assigned substitute')
 console.log('PASS driver cover: admin mobile work tab, reviewed single/day assignment, handover history, authorization, stale revisions, private reassignment, notices, retry and badge')
 // ── จอ PC: งานคนขับเป็นตารางแบบกล่องคำขอรถ (เจ้าของระบบสั่ง 2569-09-30) · จอเล็กยังเป็นการ์ดปุ่มใหญ่ ──
 // ออกรถ/จบงานจากแถวต้องผ่านกล่องทวน กดยกเลิกแล้วไม่บันทึก · จบงานแล้วแผ่นเปิดต่อที่ช่องเลขไมล์กลับ
 const deskDay=(await freeDays(1))[0],deskBooking=randomUUID(),deskTrip=randomUUID()
 await submitAs(citizen,deskBooking,{patient_name:'[TEST] ตารางคนขับ',phone:'0800000961',companions:1,appointment_at:at(deskDay,'10:00'),return_mode:'one_way',return_at:null})
 await runAs(coordinator,async()=>rpc('patient_booking_confirm',[tenant,deskTrip,[deskBooking],await rpc('patient_booking_preview',[tenant,[deskBooking],'']),'']))
 await runSql(()=>db.query("UPDATE public.patient_booking_trips SET state='cancelled' WHERE state IN ('outbound','hospital','returning','issue') AND id<>$1",[deskTrip]))
 await page.clock.setFixedTime(new Date(`${deskDay}T07:00:00+07:00`))
 const deskRow=page.locator(`tr[data-trip="${deskTrip}"]`),deskTable=page.locator('table').filter({hasText:'วันเวลาออกรับ'})
 const deskState=async()=>(await runSql(async()=>(await db.query('SELECT state FROM public.patient_booking_trips WHERE id=$1',[deskTrip])).rows[0])).state
 await page.setViewportSize({width:390,height:900});await visit('driver')
 await card(deskTrip).getByRole('button',{name:'ออกรถ',exact:true}).waitFor()
 assert.equal(await deskTable.count(),0,'จอเล็กต้องใช้การ์ดปุ่มใหญ่ ไม่ใช่ตาราง')
 // ขยายจอโดยไม่โหลดหน้าใหม่ก็ต้องสลับเป็นตาราง
 await page.setViewportSize({width:1280,height:900});await deskRow.waitFor()
 assert.equal(await page.locator(`article[data-trip="${deskTrip}"]`).count(),0,'จอ PC ต้องไม่วาดการ์ดซ้ำกับแถวตาราง')
 for(const width of [1280,1366,1440]){
  await page.setViewportSize({width,height:900});await visit('driver');await deskRow.waitFor()
  const fit=await deskRow.getByRole('button',{name:'ออกรถ',exact:true}).evaluate(button=>{
   const box=button.closest('.overflow-x-auto').getBoundingClientRect(),own=button.getBoundingClientRect()
   return {inside:own.left>=box.left-0.5&&own.right<=box.right+0.5,overflow:document.documentElement.scrollWidth>innerWidth}
  })
  assert.deepEqual(fit,{inside:true,overflow:false},`ปุ่มออกรถต้องไม่ถูกตัดที่จอ ${width}px`)
  const statusRight=await deskRow.locator('td').nth(5).evaluate(td=>td.getBoundingClientRect().right),stickyLeft=await deskRow.locator('td').last().evaluate(td=>td.getBoundingClientRect().left)
  assert(statusRight<=stickyLeft+0.5,`คอลัมน์ดำเนินการต้องไม่บังสถานะที่จอ ${width}px`)
 }
 if(process.env.PATIENT_PREVIEW_SHOTS)await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/driver-desk-1440.png`,fullPage:true})
 // ผู้จัดคิวที่ไม่ใช่คนขับของเที่ยว: เห็นแถวแต่ไม่มีปุ่มออกรถ · เปลี่ยนคนขับอยู่ในแผ่น · จัดคนขับแทนทั้งวันเปิดเป็นแผ่น
 await page.setViewportSize({width:1280,height:900});await visit('coordinator')
 await page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'}).getByRole('button',{name:'งานคนขับ',exact:true}).click()
 await deskRow.getByRole('button',{name:'ดูรายละเอียด',exact:true}).waitFor()
 assert.equal(await deskRow.getByRole('button',{name:'ออกรถ',exact:true}).count(),0,'ผู้จัดคิวที่ไม่ใช่คนขับต้องไม่มีปุ่มออกรถ')
 await deskRow.click();await sheet.getByRole('button',{name:'เปลี่ยนคนขับเที่ยวนี้',exact:true}).waitFor()
 if(process.env.PATIENT_PREVIEW_SHOTS)await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/driver-desk-sheet-coordinator.png`})
 await sheet.getByRole('button',{name:'ปิด',exact:true}).click();await sheet.waitFor({state:'detached'})
 await page.getByRole('button',{name:'จัดคนขับแทนวันนี้',exact:true}).click();await sheet.getByLabel('วันที่ต้องจัดคนขับแทน').waitFor()
 await sheet.getByRole('button',{name:'ปิด',exact:true}).click();await sheet.waitFor({state:'detached'})
 // คนขับ: กล่องทวนบอกเที่ยวและผู้เดินทาง · กดยกเลิก = ไม่บันทึก · กดตกลง = บันทึกออกรถ
 await visit('driver');await deskRow.waitFor()
 const promptsBefore=tripPrompts.length
 await deskRow.getByRole('button',{name:'ออกรถ',exact:true}).click()
 assert.equal(tripPrompts.length,promptsBefore+1,'ออกรถจากแถวต้องขึ้นกล่องทวนก่อน')
 const review=tripPrompts.at(-1)
 assert(['บันทึก “ออกรถ”','[TEST] ตารางคนขับ','ออกรับ: วันนี้'].every(text=>review.includes(text)),`กล่องทวนต้องบอกเที่ยวและผู้เดินทาง: ${review}`)
 assert.equal(await deskState(),'confirmed','กดยกเลิกในกล่องทวนต้องไม่บันทึก')
 acceptNextTripPrompt=true
 await deskRow.getByRole('button',{name:'ออกรถ',exact:true}).click();await toast('บันทึกแล้ว · ออกรถ').waitFor()
 assert.equal(await deskState(),'outbound')
 await deskRow.getByText('กำลังให้บริการ',{exact:true}).waitFor()
 // ช่องค้นหาหาจากชื่อผู้เดินทางได้ — ทดสอบก่อนจบเที่ยว เพราะหลังจบฐานข้อมูลไม่ส่งชื่อผู้เดินทางให้คนขับแล้ว
 const deskSearch=page.getByLabel('ค้นหาผู้ป่วย โรงพยาบาล คนขับ')
 await deskSearch.fill('ตารางคนขับ');await deskRow.waitFor();assert.equal(await page.locator('tr[data-trip]').count(),1,'ค้นหาแล้วต้องเหลือเฉพาะเที่ยวที่ตรง')
 await deskSearch.fill('ไม่มีชื่อนี้ในระบบ');await page.getByText('ไม่พบเที่ยวที่ค้นหา',{exact:true}).waitFor()
 await deskSearch.fill('');await deskRow.waitFor()
 // คลิกแถว = แผ่นรายละเอียดที่มีทุกอย่างของการ์ด (โทร แจ้งเหตุขัดข้อง)
 await deskRow.click()
 await sheet.getByRole('link',{name:/โทร 0800000961/}).waitFor();await sheet.getByRole('button',{name:'แจ้งเหตุขัดข้อง',exact:true}).waitFor()
 await sheet.getByRole('button',{name:'ปิด',exact:true}).click();await sheet.waitFor({state:'detached'})
 // จบงานจากแถว → แผ่นเปิดต่อที่ช่องเลขไมล์กลับ → บันทึกแล้วแผ่นปิด แถวเป็น "จบเที่ยวแล้ว"
 acceptNextTripPrompt=true
 await deskRow.getByRole('button',{name:'กลับแล้ว · จบงาน',exact:true}).click();await toast('บันทึกแล้ว · กลับแล้ว · จบงาน').waitFor()
 assert(tripPrompts.at(-1).includes('ส่งผู้เดินทางครบทุกคน'),'กล่องทวนจบงานต้องเตือนเรื่องผู้ป่วยที่ไม่ได้ขึ้นรถ')
 const deskOdo=sheet.locator(`article[data-trip="${deskTrip}"]`);await deskOdo.getByLabel('เลขไมล์กลับ',{exact:true}).waitFor()
 let deskStart=30000
 if(await deskOdo.getByLabel('เลขไมล์ออก',{exact:true}).count())await deskOdo.getByLabel('เลขไมล์ออก',{exact:true}).fill(String(deskStart))
 else deskStart=Number((await deskOdo.locator('strong').first().innerText()).replace(/\D/g,''))
 await deskOdo.getByLabel('เลขไมล์กลับ',{exact:true}).fill(String(deskStart+41));await deskOdo.getByText('ระยะทาง 41 กม.',{exact:true}).waitFor()
 await deskOdo.getByRole('button',{name:/^บันทึกเลขไมล์/}).click();await toast('บันทึกเลขไมล์แล้ว').waitFor();await sheet.waitFor({state:'detached'})
 assert.equal(await deskState(),'completed')
 await deskRow.getByText('จบเที่ยวแล้ว',{exact:true}).waitFor();await deskRow.getByText('ระยะทาง 41 กม.',{exact:true}).waitFor()
 await deskRow.getByText('ไม่แสดงหลังจบเที่ยว',{exact:true}).waitFor()
 // ป้ายกรอง
 const deskPills=page.getByRole('group',{name:'กรองงานคนขับ'})
 await deskPills.getByRole('button',{name:/^วันนี้/}).click();assert.equal(await deskRow.count(),0,'เที่ยวที่จบแล้วต้องไม่อยู่ในกลุ่มวันนี้')
 await deskPills.getByRole('button',{name:/^จบแล้ว/}).click();await deskRow.waitFor()
 await deskPills.getByRole('button',{name:/^ทั้งหมด/}).click();await deskRow.waitFor()
 console.log('PASS driver desk: PC table at 1280/1366/1440 with pinned action, cards below md, reviewed depart/finish from a row (dismiss records nothing), detail sheet, odometer after finish, coordinator view, filters and search')
 // ── ประวัติการดำเนินการในแผ่นคำขอ (เจ้าของระบบสั่ง 2569-10-01 แบบ ก): ใครกดอะไร เมื่อไร ──
 // ผู้จองส่ง → ผู้ยืนยันคิวยืนยันรถ → ผู้จองขอยกเลิก → แอดมินกดออกรถแทนคนขับ → ผู้ยืนยันคิวนำออกพร้อมเหตุผล → เที่ยวจบทีหลัง
 // เหตุการณ์ของเที่ยวก่อนคำขอเข้าเที่ยว หลังถูกนำออก หรือที่ระบุคำขออื่น ต้องไม่ปนเข้าประวัติของคำขอนี้
 const histDay=(await freeDays(1))[0],histBooking=randomUUID(),histTrip=randomUUID(),histReason='TEST ผู้ป่วยแจ้งเลื่อนนัด'
 await submitAs(citizen,histBooking,{patient_name:'[TEST] ประวัติคำขอ',phone:'0800000971',companions:0,appointment_at:at(histDay,'10:00'),return_mode:'one_way',return_at:null})
 await runAs(coordinator,async()=>rpc('patient_booking_confirm',[tenant,histTrip,[histBooking],await rpc('patient_booking_preview',[tenant,[histBooking],'']),'']))
 const histRevision=async table=>(await runSql(async()=>(await db.query(`SELECT revision FROM public.${table} WHERE id=$1`,[table==='patient_bookings'?histBooking:histTrip])).rows[0])).revision
 const confirmedAt=(await runSql(async()=>(await db.query("SELECT created_at FROM public.patient_booking_events WHERE entity_id=$1 AND action='confirmed'",[histTrip])).rows[0])).created_at
 const addTripEvent=(action,detail,created)=>runSql(()=>db.query('INSERT INTO public.patient_booking_events(municipality_id,actor_id,entity_id,action,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)',[tenant,admin,histTrip,action,detail,created]))
 await addTripEvent('schedule_updated',{note:'TEST ก่อนเข้าเที่ยว'},new Date(new Date(confirmedAt).getTime()-60000).toISOString())
 await addTripEvent('moved_into_trip',{booking_id:randomUUID()},new Date().toISOString())
 await addTripEvent('rescheduled',{scope:'single'},new Date().toISOString())
 await addTripEvent('schedule_updated',{note:'TEST หลังเข้าเที่ยว'},new Date().toISOString())
 let histRev=await histRevision('patient_bookings');await runAs(citizen,()=>rpc('patient_booking_action',[tenant,randomUUID(),histBooking,histRev,'cancel','']))
 await runSql(()=>db.query("UPDATE public.patient_booking_trips SET state='cancelled' WHERE state IN ('outbound','hospital','returning','issue') AND id<>$1",[histTrip]))
 let histTripRev=await histRevision('patient_booking_trips');await runAs(admin,()=>rpc('patient_booking_action',[tenant,randomUUID(),histTrip,histTripRev,'trip_next','']))
 histRev=await histRevision('patient_bookings');await runAs(coordinator,()=>rpc('patient_booking_action',[tenant,randomUUID(),histBooking,histRev,'cancel_passenger',histReason]))
 histTripRev=await histRevision('patient_booking_trips');await runAs(admin,()=>rpc('patient_booking_action',[tenant,randomUUID(),histTrip,histTripRev,'trip_finish','']))
 const seen=(await runAs(coordinator,()=>rpc('patient_booking_history',[tenant,histBooking]))).events
 assert.deepEqual(seen.map(e=>e.action),['submitted','confirmed','schedule_updated','cancel','trip_next','cancel_passenger'],'ประวัติต้องมีเฉพาะช่วงที่คำขออยู่ในเที่ยว')
 assert.deepEqual(seen.map(e=>e.actor_name),['Citizen TEST','Coordinator TEST','Admin TEST','Citizen TEST','Admin TEST','Coordinator TEST'])
 assert.deepEqual(seen.map(e=>e.by_booker),[true,false,false,true,false,false])
 assert.equal(seen[2].note,'TEST หลังเข้าเที่ยว');assert.equal(seen[4].for_driver,'Driver TEST','แอดมินกดออกรถแทนต้องบอกชื่อคนขับจริง');assert.equal(seen[5].note,histReason)
 const historyKeys=['id','action','at','actor_name','by_booker','entry_channel','note','for_driver','driver_before','driver_after']
 assert(seen.every(e=>Object.keys(e).every(k=>historyKeys.includes(k))),'ห้ามส่ง before/after หรือรายละเอียดอื่นของคำขอออกไป')
 assert.deepEqual((await runAs(admin,()=>rpc('patient_booking_history',[tenant,histBooking]))).events.map(e=>e.id),seen.map(e=>e.id),'แอดมินเห็นชุดเดียวกับผู้ยืนยันคิว')
 for(const who of [citizen,driver,coverStaff])await assert.rejects(runAs(who,()=>rpc('patient_booking_history',[tenant,histBooking])),/เฉพาะเจ้าหน้าที่จัดคิว/)
 await assert.rejects(runAs(null,()=>rpc('patient_booking_history',[tenant,histBooking])),/permission denied/)
 await assert.rejects(runAs(setupAdmin,()=>rpc('patient_booking_history',[setupTenant,histBooking])),/ไม่พบคำขอนี้/)
 const deskHistory=new Set((await runAs(coordinator,()=>rpc('patient_booking_history',[tenant,deskBooking]))).events.map(e=>e.id))
 assert(deskHistory.size>0&&seen.every(e=>!deskHistory.has(e.id)),'ประวัติของคำขออื่นต้องไม่ปนกัน')
 // หน้าจอ: กล่องประวัติท้ายแผ่นคำขอ บอกชื่อผู้กด ผู้จอง และคนขับจริงเมื่อแอดมินกดแทน (คำขอนี้ถูกนำออกจากเที่ยว = อยู่ส่วนที่พับไว้)
 await staffDesk('coordinator');await openDone();await row(histBooking).click()
 const histBox=sheet.getByRole('region',{name:'ประวัติการดำเนินการ'})
 for(const text of ['ส่งคำขอ','โดย Citizen TEST (ผู้จอง)','ขอยกเลิก (รอเจ้าหน้าที่ประสาน)','โดย Admin TEST · บันทึกแทนคนขับ Driver TEST','นำออกจากเที่ยว (ยกเลิก)',histReason])await histBox.getByText(text,{exact:true}).first().waitFor()
 assert.equal(await histBox.getByRole('listitem').count(),6)
 assert.equal(await histBox.getByText('กลับแล้ว · จบงาน',{exact:true}).count(),0,'เหตุการณ์หลังถูกนำออกจากเที่ยวต้องไม่ขึ้น')
 if(process.env.PATIENT_PREVIEW_SHOTS)await histBox.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/booking-history.png`})
 await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'})
 // ฐานข้อมูลยังไม่มีฟังก์ชัน (merge ก่อน apply migration) = ซ่อนกล่องเงียบ ๆ · ผิดพลาดอื่น = บอกพร้อมปุ่มลองอีกครั้ง
 let historyReply={data:null,error:{code:'PGRST202',message:'Could not find the function'}}
 await page.route('**/__patient_rpc',async route=>{const request=route.request().postDataJSON();if(request.name==='patient_booking_history'&&historyReply)await route.fulfill({json:historyReply});else await route.fallback()})
 const historyAnswered=()=>page.waitForResponse(response=>response.url().endsWith('/__patient_rpc')&&response.request().postDataJSON()?.name==='patient_booking_history')
 const answered=historyAnswered();await row(histBooking).click();await answered;await sheet.getByText('วันเวลานัด',{exact:true}).waitFor();await page.waitForTimeout(200)
 assert.equal(await sheet.getByRole('region',{name:'ประวัติการดำเนินการ'}).count(),0,'ยังไม่มีฟังก์ชันต้องซ่อนกล่องประวัติ')
 assert.equal(await sheet.getByText('โหลดประวัติการดำเนินการไม่สำเร็จ',{exact:false}).count(),0,'ยังไม่มีฟังก์ชันต้องไม่ขึ้นข้อความผิดพลาด')
 await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'})
 historyReply={data:null,error:{message:'TEST network down'}}
 await row(histBooking).click();await sheet.getByText('โหลดประวัติการดำเนินการไม่สำเร็จ',{exact:false}).waitFor()
 historyReply=null;await sheet.getByRole('button',{name:'ลองอีกครั้ง',exact:true}).click();await sheet.getByRole('region',{name:'ประวัติการดำเนินการ'}).waitFor()
 await page.unroute('**/__patient_rpc');await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'})
 console.log('PASS booking history: who did what and when in the request sheet; booker and on-behalf labels, trip membership window, other requests isolated, staff-only, missing function hidden, retry')
 // ── เปิดคำขอที่ถูกปิดเป็นคิวซ้ำผิดวันกลับมา (แก้ข้อมูลรายกรณีตามคำสั่งเจ้าของระบบ 2569-10-01 — ยังไม่มีปุ่มในระบบ) ──
 // คำสั่งเดียวกับที่ใช้กับข้อมูลจริง: กลับเป็นรอยืนยันรถ ไม่มีเที่ยว + บันทึก reopened ในนามผู้สั่ง
 // หลังเปิดกลับ: ป้าย "คิวที่ใช้เดินทาง" ต้องไม่ค้าง · ประวัติขึ้น "เปิดคำขอกลับมาใช้" · มีปุ่มยืนยันรถให้แอดมินกดต่อ
 await runSql(async()=>{
  const reopened=await db.query("UPDATE public.patient_bookings SET status='submitted',trip_id=NULL,requested_trip_id=NULL,cancel_requested=false,return_ready=false,passenger_step=0,revision=revision+1,updated_at=now() WHERE id=$1 AND status='cancelled'",[duplicateSource])
  assert.equal(reopened.affectedRows,1)
  await db.query("INSERT INTO public.patient_booking_events(municipality_id,actor_id,entity_id,action,detail) VALUES($1,$2,$3,'reopened',$4)",[tenant,admin,duplicateSource,{note:'TEST เปิดคำขอกลับ ย้ายเข้าเที่ยวผิดวัน'}])
 })
 assert.equal((await runAs(citizen,()=>rpc('patient_booking_mine',[tenant]))).bookings.find(b=>b.id===duplicateSource).cancel_note??null,null,'เปิดกลับแล้วผู้จองต้องไม่เห็นเหตุผลยกเลิกค้าง')
 await staffDesk('admin');await row(duplicateSource).click()
 await sheet.getByRole('region',{name:'ประวัติการดำเนินการ'}).getByText('เปิดคำขอกลับมาใช้',{exact:true}).waitFor()
 assert.equal(await sheet.getByText('คิวที่ใช้เดินทาง',{exact:false}).count(),0,'คำขอที่เปิดกลับต้องไม่ขึ้นป้ายคิวซ้ำค้าง')
 assert(await sheet.getByRole('button',{name:/^ยืนยันรถ/}).count()>0,'เปิดกลับแล้วต้องมีปุ่มยืนยันรถให้กดต่อ')
 await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'})
 console.log('PASS reopened wrong-day duplicate: back to awaiting confirmation, no stale duplicate banner or cancel reason, history label, confirm button')
 // ── กล่องคำขอรถแบ่ง 3 ส่วนตามความสำคัญ มีหัวกลุ่มคั่น แต่ละส่วนเรียงวันนัดเร็ว → ช้า (เจ้าของระบบสั่ง 2569-10-01) ──
 // ต้องดำเนินการ (ความด่วนก่อน แล้ววันนัด) → รอเดินทาง/กำลังเดินทาง → เสร็จแล้ว/ยกเลิก (เดิมส่วนนี้เรียงล่าสุดขึ้นก่อน)
 await staffDesk('coordinator')
 const orderTable=page.locator('table').filter({hasText:'วันเวลานัด'})
 await orderTable.locator('tr[data-booking]').first().waitFor()
 // ส่วน "เสร็จแล้ว / ยกเลิก" พับไว้ตอนเปิดหน้า (เจ้าของระบบเลือก 2569-10-01 แบบ ก — รายการที่จบแล้ว 30 วันต่อท้ายจนหน้ายาว)
 // เห็นหัวกลุ่มพร้อมจำนวนและปุ่มแสดง แต่ไม่มีแถว · งานค้างกับรอเดินทางแสดงตามปกติ
 const doneHeader=orderTable.locator('tr[data-section-header="done"]')
 await doneHeader.waitFor()
 assert.equal(await doneToggle().getAttribute('aria-expanded'),'false','เปิดหน้าแล้วส่วนเสร็จแล้วต้องพับไว้')
 assert.equal(await orderTable.locator('tr[data-section="done"]').count(),0,'ส่วนที่พับต้องไม่มีแถว')
 for(const section of ['action','live'])assert(await orderTable.locator(`tr[data-section="${section}"]`).count()>0,`ส่วน ${section} ต้องแสดงตามปกติ`)
 const foldedCount=Number((await doneHeader.innerText()).match(/(\d+) รายการ/)[1])
 assert(foldedCount>0,'หัวกลุ่มที่พับต้องบอกจำนวนรายการที่ซ่อนอยู่')
 // ค้นหาหรือกดป้ายเสร็จแล้ว/ยกเลิก = กำลังหาของในส่วนนี้ ระบบเปิดให้เองโดยไม่มีปุ่มพับ · ล้างแล้วกลับไปพับเหมือนเดิม
 await search.fill('[TEST] ประวัติคำขอ');await row(histBooking).waitFor()
 assert.equal(await doneToggle().count(),0,'ระหว่างค้นหาต้องไม่มีปุ่มพับ')
 await search.fill('');await row(histBooking).waitFor({state:'detached'})
 const orderPills=page.getByRole('group',{name:'กรองคำขอรถ'})
 await orderPills.getByRole('button',{name:/^ยกเลิก/}).click();await row(histBooking).waitFor()
 assert.equal(await doneToggle().count(),0,'กดป้ายยกเลิกแล้วต้องเห็นรายการเลย ไม่ต้องกดแสดงอีก')
 await orderPills.getByRole('button',{name:/^ทั้งหมด/}).click();await row(histBooking).waitFor({state:'detached'})
 // กดแสดงรายการ → เห็นครบตามจำนวนบนหัวกลุ่ม และแถวที่จบแล้วปุ่มเป็น "ดูรายละเอียด"
 await openDone()
 assert.equal(await orderTable.locator('tr[data-section="done"]').count(),foldedCount,'กดแสดงแล้วต้องเห็นครบตามจำนวนบนหัวกลุ่ม')
 const doneButtons=await orderTable.locator('tr[data-section="done"]').evaluateAll(trs=>trs.map(tr=>tr.querySelector('button')?.textContent.trim()))
 assert(doneButtons.every(text=>text==='ดูรายละเอียด'),`แถวที่จบแล้วปุ่มแถวต้องเป็น "ดูรายละเอียด": ${JSON.stringify(doneButtons)}`)
 // แถวหัวกรอบของกลุ่มเที่ยว (data-trip-group) ไม่ใช่หัวส่วนและไม่ใช่คำขอ ตรวจแยกด้านล่าง
 const listed=await orderTable.locator('tbody tr:not([data-trip-group])').evaluateAll(trs=>trs.map(tr=>tr.dataset.sectionHeader
  ?{header:tr.dataset.sectionHeader,text:tr.innerText.trim()}:{booking:tr.dataset.booking,section:tr.dataset.section,at:tr.dataset.at}))
 const orderWorkspace=await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))
 const orderTrips=new Map(orderWorkspace.trips.map(t=>[t.id,t]))
 const sectionRank={action:0,live:1,done:2}
 const bookingRows=listed.filter(item=>item.booking)
 assert.equal(bookingRows.length,orderWorkspace.bookings.length,'ทุกคำขอต้องอยู่ในตาราง')
 for(const [index,item] of bookingRows.entries()){
  const b=orderWorkspace.bookings.find(x=>x.id===item.booking)
  const trip=b.trip_id&&b.status!=='cancelled'?orderTrips.get(b.trip_id)||null:null
  item.rank=staffNextAction(b,trip).rank
  assert.equal(item.section,item.rank<9?'action':['confirmed','running'].includes(bookingStage(b,trip))?'live':'done',`ส่วนของคำขอ ${item.booking.slice(0,8)} ไม่ถูก`)
  if(!index)continue
  const prev=bookingRows[index-1]
  assert(sectionRank[prev.section]<=sectionRank[item.section],'ส่วนต้องเรียง ต้องดำเนินการ → รอเดินทาง → เสร็จแล้ว')
  if(prev.section!==item.section)continue
  if(item.section==='action'&&prev.rank!==item.rank)assert(prev.rank<item.rank,'ส่วนต้องดำเนินการต้องเรียงตามความด่วน')
  else assert(prev.at<=item.at,`ในส่วน ${item.section} ต้องเรียงวันนัดเร็วไปช้า: ${prev.at} → ${item.at}`)
 }
 const presentSections=[...new Set(bookingRows.map(item=>item.section))]
 assert.deepEqual(presentSections,['action','live','done'],'ข้อมูลทดสอบต้องมีครบ 3 ส่วน')
 assert.deepEqual(listed.filter(item=>item.header).map(item=>item.header),presentSections,'ส่วนละ 1 หัวกลุ่ม')
 for(const [index,item] of listed.entries()){
  if(item.header)assert(item.text.includes(`${bookingRows.filter(row=>row.section===item.header).length} รายการ`),`หัวกลุ่ม ${item.header} ต้องบอกจำนวนถูก`)
  else if(!listed[index-1]?.booking||listed[index-1].section!==item.section)assert.equal(listed[index-1]?.header,item.section,'หัวกลุ่มต้องอยู่ก่อนแถวแรกของส่วน')
 }
 // กรอบกลุ่มเที่ยว (เจ้าของระบบเลือกแบบ ก 2569-10-02): หัวกรอบ 1 แถว ตามด้วยแถวของทุกคนในเที่ยวพอดี จำนวนบนหัวกรอบ = ผู้เดินทาง
 // ที่ชุดเอกสารของเที่ยวพิมพ์ให้ · เที่ยวที่ทุกคนอยู่ติดกันในส่วนเดียวกันต้องมีกรอบ นอกนั้นต้องไม่มี (หัวกรอบห้ามบอกจำนวนเกินแถวที่เห็น)
 const frames=await orderTable.locator('tbody tr').evaluateAll(trs=>trs.flatMap((tr,index)=>{
  if(!tr.dataset.tripGroup)return []
  const size=Number(tr.innerText.match(/เที่ยวเดียวกัน (\d+) คน/)?.[1])
  return [{id:tr.dataset.tripGroup,size,members:trs.slice(index+1,index+1+size).map(next=>next.dataset.tripFrame??null),after:trs[index+1+size]?.dataset.tripFrame??null,band:getComputedStyle(tr.cells[0]).backgroundColor}]}))
 assert(frames.length>0,'ข้อมูลทดสอบต้องมีเที่ยวที่ไปด้วยกันอย่างน้อย 1 เที่ยว')
 for(const frame of frames){
  assert(frame.size>=2&&frame.members.length===frame.size&&frame.members.every(id=>id===frame.id),`หัวกรอบเที่ยว ${frame.id.slice(0,8)} ต้องตามด้วยแถวของทุกคนในเที่ยวพอดี: ${JSON.stringify(frame)}`)
  assert.notEqual(frame.after,frame.id,'แถวถัดจากกรอบต้องไม่ใช่คนในเที่ยวเดียวกัน')
 }
 assert.equal(await orderTable.locator('tr[data-trip-frame]').count(),frames.reduce((sum,frame)=>sum+frame.size,0),'แถวที่ติดป้ายกรอบต้องอยู่ใต้หัวกรอบของเที่ยวตัวเองทุกแถว')
 for(const trip of orderWorkspace.trips.filter(t=>t.state!=='cancelled')){
  const at=bookingRows.flatMap((item,index)=>{const b=orderWorkspace.bookings.find(x=>x.id===item.booking);return b.trip_id===trip.id&&['confirmed','completed'].includes(b.status)?[index]:[]})
  const together=at.length>1&&at.at(-1)-at[0]===at.length-1&&new Set(at.map(index=>bookingRows[index].section)).size===1
  assert.equal(frames.some(frame=>frame.id===trip.id&&frame.size===at.length),together,`เที่ยว ${trip.id.slice(0,8)} มีผู้เดินทาง ${at.length} คน ${together?'อยู่ติดกัน ต้องมีกรอบ':'ต้องไม่มีกรอบ'}`)
 }
 // แยกส่วนด้วยสี (เจ้าของระบบสั่งเพิ่ม 2569-10-01 — หัวกลุ่มเทาอ่อนเดิมกลืนกับแถวลายสลับ): หัวกลุ่มคนละสี ไม่ใช่สีพื้นแถว
 // และทุกแถวมีแถบซ้ายสีเดียวกับส่วนของตัวเอง
 const bands=await orderTable.locator('tr[data-section-header] td > span:last-child').evaluateAll(spans=>spans.map(span=>getComputedStyle(span).backgroundColor))
 assert.equal(new Set(bands).size,presentSections.length,'หัวกลุ่มแต่ละส่วนต้องคนละสี')
 for(const band of bands)assert(!['rgb(255, 255, 255)','rgb(245, 248, 252)'].includes(band),'หัวกลุ่มต้องไม่ใช้สีเดียวกับพื้นแถว')
 for(const frame of frames)assert(![...bands,'rgb(255, 255, 255)','rgb(245, 248, 252)'].includes(frame.band),`หัวกรอบเที่ยวต้องไม่ใช้สีของหัวส่วนหรือพื้นแถว: ${frame.band}`)
 const strips=await orderTable.locator('tr[data-booking]').evaluateAll(trs=>trs.map(tr=>[tr.dataset.section,getComputedStyle(tr.cells[0]).boxShadow]))
 const stripOf=new Map(strips)
 assert(strips.every(([section,strip])=>strip!=='none'&&stripOf.get(section)===strip),'ทุกแถวต้องมีแถบซ้ายสีของส่วนตัวเอง')
 assert.equal(new Set(stripOf.values()).size,presentSections.length,'แถบซ้ายแต่ละส่วนต้องคนละสี')
 // จอมือถือ: การ์ดเรียงชุดเดียวกับตาราง และมีหัวกลุ่มคั่นแบบเดียวกัน
 await page.setViewportSize({width:390,height:900})
 assert.deepEqual(await page.locator('article[data-booking]').evaluateAll(cards=>cards.map(card=>card.dataset.booking)),bookingRows.map(item=>item.booking),'มือถือต้องเรียงชุดเดียวกับตาราง')
 assert.deepEqual(await page.locator('h3[data-section-header]').evaluateAll(heads=>heads.map(head=>head.dataset.sectionHeader)),presentSections)
 assert.deepEqual(await page.locator('section[data-trip-group]').evaluateAll(boxes=>boxes.map(box=>[box.dataset.tripGroup,box.querySelectorAll('article[data-booking]').length])),frames.map(frame=>[frame.id,frame.size]),'มือถือต้องมีกรอบกลุ่มเที่ยวชุดเดียวกับตาราง')
 await page.locator('h3[data-section-header="done"]').waitFor()
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'หัวกลุ่มต้องไม่ทำให้จอ 390px ล้น')
 // มือถือพับได้ด้วยปุ่มเดียวกัน (ขนาดนิ้วกด 44px) — พับแล้วการ์ดของส่วนเสร็จแล้วหาย เหลือหัวกลุ่ม
 assert((await doneToggle().boundingBox()).height>=44,'ปุ่มพับบนมือถือต้องสูงอย่างน้อย 44px')
 await doneToggle().click();assert.equal(await doneToggle().getAttribute('aria-expanded'),'false')
 assert.equal(await page.locator('article[data-section="done"]').count(),0,'พับแล้วต้องไม่มีการ์ดของส่วนเสร็จแล้ว')
 assert.equal(await page.locator('article[data-booking]').count(),bookingRows.length-foldedCount)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'หัวกลุ่มที่มีปุ่มพับต้องไม่ทำให้จอ 390px ล้น')
 await page.setViewportSize({width:1280,height:900})
 console.log('PASS inbox order: action → live → done sections with colored headers and row strips, urgency then appointment within action, ascending dates within each section, same order on mobile; a trip frame wraps exactly the riders of every shared trip whose riders sit together, on table and mobile')
 console.log('PASS done section folded on open: header with count + show button, search and done/cancelled pills open it without a toggle, toggle on desktop and mobile')
 console.log(`PASS click counts ${JSON.stringify(clicks)}`)
 assert.deepEqual(errors,[])
}catch(error){ if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-browser-failure.png`,fullPage:true})};throw error }finally{await browser.close();await server.close();await db.close()}
