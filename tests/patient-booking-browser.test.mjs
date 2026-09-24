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
import { previousOdometer, thaiDay } from '../src/lib/patientBooking.js'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, baseBooking } = await import('./patient-booking-db.test.mjs')
await actor(admin); await rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings])
const setupTenant='00000000-0000-4000-8000-000000009001',setupAdmin='00000000-0000-4000-8000-000000009002',setupPartner='00000000-0000-4000-8000-000000009003'
// ผู้ใช้ใหม่ที่ยังไม่เคยจอง — ใช้วัด "จองครั้งแรก" กับ "จองครั้งต่อไป" (เติมข้อมูลจากครั้งก่อน)
const newcomer='00000000-0000-4000-8000-000000000016'
await db.exec('RESET ROLE')
await db.query('INSERT INTO public.municipalities(id) VALUES($1)',[setupTenant])
await db.query("INSERT INTO public.profiles(id,municipality_id,role,full_name) VALUES($1,$2,'admin','TEST ผู้รับผิดชอบรถ')",[setupAdmin,setupTenant])
await db.query("INSERT INTO public.profiles(id,municipality_id,role,full_name) VALUES($1,$2,'citizen','TEST ผู้ใช้ใหม่')",[newcomer,tenant])
await db.query("INSERT INTO public.referral_partners(id,municipality_id,name,is_active,document_types,min_lead_days) VALUES($1,$2,'TEST กองทุนรถรับส่ง',true,ARRAY['patient_transport_request'],0)",[setupPartner,setupTenant])
// ทะเบียนสถานที่ของ อปท. (ตารางเดียวกับที่หน้าคำร้องใช้) — ฟอร์มจองให้กดเลือกหมู่บ้านแทนพิมพ์เอง
await db.exec('CREATE TABLE public.locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),municipality_id uuid,name text,sort_order integer)')
await db.query("INSERT INTO public.locations(municipality_id,name,sort_order) VALUES($1,'TEST บ้านเหนือ',1),($1,'TEST บ้านใต้',2)",[tenant])
let chain = Promise.resolve()
const users = { setupadmin:setupAdmin, citizen, newcomer, coordinator, driver, admin, anonymous: null }
const order = {
 patient_booking_delete:['p_muni','p_op','p_booking','p_revision','p_trip_revision','p_docs_revision','p_reason'],
 patient_booking_update_schedule:['p_muni','p_trip','p_revision','p_notice','p_pickup','p_return'],
 patient_booking_info:['p_muni'],patient_booking_workspace:['p_muni'],patient_booking_mine:['p_muni'],patient_booking_submit:['p_muni','p_id','p_data','p_staff_entry'],
 patient_booking_save_settings:['p_muni','p_revision','p_data'],patient_booking_preview:['p_muni','p_ids','p_helper'],
 patient_booking_confirm:['p_muni','p_id','p_ids','p_expected','p_helper'],patient_booking_action:['p_muni','p_op','p_entity','p_revision','p_action','p_note'],
 patient_booking_calendar:['p_muni','p_from','p_to'],patient_booking_submit_join:['p_muni','p_id','p_trip','p_data','p_staff_entry'],patient_booking_preview_join:['p_muni','p_booking'],patient_booking_confirm_join:['p_muni','p_op','p_booking','p_expected'],
 patient_booking_preview_into_trip:['p_muni','p_booking','p_trip'],patient_booking_confirm_into_trip:['p_muni','p_op','p_booking','p_trip','p_expected'],
 patient_booking_amend:['p_muni','p_op','p_id','p_revision','p_data','p_note'],
 patient_booking_save_odometer:['p_muni','p_trip','p_docs_revision','p_start','p_end','p_issue','p_note'],patient_booking_record_letter:['p_muni','p_trip','p_docs_revision','p_letter_no','p_letter_date'],patient_booking_record_odometer:['p_muni','p_trip','p_docs_revision','p_start','p_end'],patient_booking_month_report:['p_muni','p_month'],
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
page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())

// คำสั่งตรงถึงฐานข้อมูลต่อคิวเดียวกับคำขอจากเบราว์เซอร์ บทบาทจะได้ไม่สลับกันกลางทาง
const queue=job=>{let out;const run=async()=>{out=await job()};const p=chain.then(run,run);chain=p.catch(()=>{});return p.then(()=>out)}
const runAs=(user,fn)=>queue(async()=>{await actor(user);return fn()})
const runSql=fn=>queue(async()=>{await db.exec('RESET ROLE');return fn()})
const tripOf=id=>runSql(async()=>(await db.query('SELECT trip_id FROM public.patient_bookings WHERE id=$1',[id])).rows[0].trip_id)
const bookingRow=id=>runSql(async()=>(await db.query('SELECT status,trip_id,passenger_step,cancel_requested,return_ready,entry_channel,in_area FROM public.patient_bookings WHERE id=$1',[id])).rows[0])
const STAFF_ROLES=['setupadmin','coordinator','driver','admin']
const visit=async as=>{
 if(STAFF_ROLES.includes(as)){await page.goto(`${base}/__patient?as=${as}&page=staff`);await page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'}).waitFor();return}
 await page.goto(`${base}/__patient?as=${as}`);await page.getByRole('region',{name:'บริการรถรับส่งผู้ป่วย'}).waitFor()}
const staffDesk=async(as='coordinator')=>{await page.setViewportSize({width:1280,height:900});await visit(as)}
const row=id=>page.locator(`tr[data-booking="${id}"]`)
const toast=text=>page.getByRole('status').filter({hasText:text})
const problem=page.getByRole('region',{name:'ยืนยันรถไม่ได้'})
const sheet=page.getByRole('dialog')
const card=trip=>page.locator(`article[data-trip="${trip}"]`).first()
const setDay=async value=>{await page.locator('summary').filter({hasText:'เลือกวันอื่น'}).first().evaluate(node=>{node.parentElement.open=true});await page.getByLabel('วันที่นัดแพทย์',{exact:true}).fill(value)}
const clicks={}
const click=async(key,locator)=>{await locator.click();clicks[key]=(clicks[key]||0)+1}
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
 await page.getByRole('group',{name:'เจ้าหน้าที่ผู้ยืนยันคิว',exact:true}).getByRole('checkbox').check()
 await page.getByLabel('ที่นั่งผู้โดยสาร ไม่รวมคนขับ',{exact:true}).fill('4');await page.getByLabel('ที่ยึดรถเข็น',{exact:true}).fill('1');await page.getByLabel('ที่ยึดเปล',{exact:true}).fill('1');await page.getByLabel('เบอร์ติดต่อหน่วยงาน',{exact:true}).fill('0800000000')
 await page.getByRole('button',{name:'เพิ่มเส้นทาง',exact:true}).click();await page.getByLabel('ชื่อโรงพยาบาล — พื้นที่รับ',{exact:true}).fill('TEST โรงพยาบาลใกล้เคียง');await page.getByLabel('นาทีต่อขา',{exact:true}).fill('30')
 await page.getByRole('checkbox',{name:'เปิดรับจองรถออนไลน์',exact:true}).check();await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await toast('บันทึกค่าตั้งต้นแล้ว').waitFor()
 await actor(setupAdmin);const initialSettings=(await rpc('patient_booking_workspace',[setupTenant])).settings;assert.equal(initialSettings.enabled,true);assert.equal(initialSettings.calendar_checked_through,null);assert(initialSettings.privacy_notice.includes('บริการรถรับส่งผู้ป่วย'));assert.equal(initialSettings.driver_id,setupAdmin);assert.deepEqual(initialSettings.coordinator_ids,[setupAdmin]);assert.equal((await rpc('patient_booking_info',[setupTenant])).enabled,true)
 await page.goto(`${base}/__patient?as=setupadmin`);await page.getByRole('button',{name:'🚐 ขอรถไปโรงพยาบาล',exact:true}).waitFor()
 console.log('PASS first-time setup completed through actual UI and booking opens; one account serves both duties')

 // ── บัญชีเดียวสองหน้าที่ (ผู้จัดคิว + คนขับ) เห็นทั้ง "คำขอรถ" และ "งานคนขับ" แม้ยังไม่มีเที่ยว ──
 await visit('admin');await page.getByRole('button',{name:'ตั้งค่า',exact:true}).click()
 const dualCheckbox=page.getByRole('group',{name:'เจ้าหน้าที่ผู้ยืนยันคิว',exact:true}).getByRole('checkbox',{name:'Driver TEST',exact:true})
 await dualCheckbox.check();await page.getByLabel('บัญชีคนขับ',{exact:true}).selectOption(coordinator);await page.getByLabel('บัญชีคนขับ',{exact:true}).selectOption(driver);assert.equal(await dualCheckbox.isChecked(),true)
 await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await toast('บันทึกค่าตั้งต้นแล้ว').waitFor()
 await actor(driver);const dualWorkspace=await rpc('patient_booking_workspace',[tenant]);assert.equal(dualWorkspace.role,'coordinator');assert.equal(dualWorkspace.settings.driver_id,driver)
 await page.route('**/__patient_rpc',async route=>{const request=route.request().postDataJSON();if(request.name==='patient_booking_workspace'&&request.user==='driver'){const response=await route.fetch();const body=await response.json();body.data.trips=[];await route.fulfill({response,json:body})}else await route.fallback()})
 await visit('driver');await page.getByRole('button',{name:'คำขอรถ',exact:true}).waitFor();await page.getByRole('button',{name:'งานคนขับ',exact:true}).click();await page.getByText('วันนี้ไม่มีเที่ยวที่ต้องออก').waitFor();await page.unroute('**/__patient_rpc')
 await actor(admin);await rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings])
 console.log('PASS dual-duty account keeps both tabs, including an empty driver tab')

 // ── ประชาชนจองครั้งแรก: ปุ่มตัวเลือก → ทวนก่อนส่ง → จอสำเร็จ + เลขที่คำขอ ──
 await page.setViewportSize({width:390,height:900});await visit('newcomer')
 await click('citizenFirst',page.getByRole('button',{name:'🚐 ขอรถไปโรงพยาบาล',exact:true}))
 const timeChips=page.getByRole('group',{name:'เวลานัดแพทย์'}).getByRole('button');await timeChips.first().waitFor()
 const firstTimes=await timeChips.allInnerTexts();assert(firstTimes.length>0,'ต้องมีเวลาที่รถว่างให้เลือก')
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

 // ── ยืนยันรถคลิกเดียว ──
 await staffDesk()
 await row(b1).waitFor()
 await click('confirm',row(b1).getByRole('button',{name:'ยืนยันรถ',exact:true}))
 await toast('ยืนยันรถแล้ว').waitFor()
 assert.equal((await bookingRow(b1)).status,'confirmed');assert.equal(clicks.confirm,1)
 // ── ชนคิว: ระบบลองรวมเที่ยวให้ก่อน (ผู้เดินทางเดิมไม่นั่งร่วม = รวมไม่ได้ บอกเหตุ) → แจ้งว่ารถไม่ว่าง ──
 await click('conflictDecline',row(b2).getByRole('button',{name:'ยืนยันรถ',exact:true}))
 await problem.waitFor();await problem.getByText('รถไม่ว่าง ช่วงเวลานี้ชนกับเที่ยวที่ยืนยันแล้ว').waitFor()
 await problem.getByText(/ไม่ได้: ผู้เดินทางเดิมในเที่ยวนั้นไม่ได้เลือกนั่งร่วม/).waitFor()
 assert.equal(await sheet.getByRole('button',{name:'พิมพ์หนังสือนำส่ง',exact:true}).count(),0,'ยังไม่ยืนยันรถ = ยังไม่มีหนังสือให้พิมพ์ ปุ่มพิมพ์บนหัวแผ่นต้องไม่ขึ้น')
 assert.equal(await problem.getByLabel('เหตุผล: รถไม่ว่าง ให้บริการตามเวลานี้ไม่ได้').inputValue(),'รถไม่ว่างในช่วงเวลาที่ขอ')
 await click('conflictDecline',problem.getByRole('button',{name:'แจ้งว่ารถไม่ว่าง และยกเลิกคำขอ',exact:true}))
 await sheet.waitFor({state:'detached'});await row(b2).getByText('ยกเลิกแล้ว').waitFor()
 assert.equal((await bookingRow(b2)).status,'cancelled');assert.equal(clicks.conflictDecline,2)
 assert.equal((await runSql(async()=>(await db.query("SELECT detail->>'note' AS note FROM public.patient_booking_events WHERE entity_id=$1 AND action='cancel'",[b2])).rows[0])).note,'รถไม่ว่างในช่วงเวลาที่ขอ','เหตุผลที่ไม่ให้บริการต้องอยู่ในประวัติ')
 // ── ชนคิวแต่ไปคันเดียวกันได้ (20260921120000): บอกเวลาใหม่ก่อนกด แล้วรวมเที่ยวในคลิกเดียว ──
 await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click()
 await row(joinA).getByRole('button',{name:'ยืนยันรถ',exact:true}).click();await toast('ยืนยันรถแล้ว').waitFor()
 await submitAs(citizen,joinB,{patient_name:'[TEST] นายบี ขอไปด้วย',phone:'0810000005',share:true,appointment_at:at(joinDay,'10:15'),return_at:at(joinDay,'12:00')})
 await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click()
 await click('join',row(joinB).getByRole('button',{name:'ยืนยันรถ',exact:true}))
 const joinButton=problem.getByRole('button',{name:/^ให้ไปคันเดียวกัน · รถออกรับ \d\d:\d\d น\.$/});await joinButton.waitFor()
 await problem.getByText(/เวลารถออกรับใหม่ \d\d:\d\d น\. \(เดิม \d\d:\d\d น\.\)/).waitFor()
 await problem.getByRole('link',{name:'📞 [TEST] นางเอ นั่งร่วมได้'}).waitFor()
 await click('join',joinButton)
 await toast('ไปคันเดียวกับเที่ยวเดิม').waitFor()
 assert.equal(await tripOf(joinB),await tripOf(joinA),'ต้องอยู่เที่ยวเดียวกัน');assert.equal(clicks.join,2)
 // ── ยังไม่ได้ตรวจเขตพื้นที่ → "ตรวจแล้ว · ยืนยันรถ" ยืนยันต่อให้ในคลิกเดียวกัน ──
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
 // ── ระบบเสนอให้ไปด้วยกัน (นั่งร่วมได้ทั้งคู่ เวลาใกล้กัน) → ยืนยันทั้งกลุ่มในคลิกเดียว ──
 await row(groupE).getByRole('button',{name:'ยืนยันรถ · ไปด้วยกัน 2 คน',exact:true}).click();await toast('ยืนยันรถแล้ว').waitFor()
 assert.equal(await tripOf(groupE),await tripOf(groupF))
 console.log('PASS coordinator inbox: confirm in 1 click; conflict -> decline with reason in 2; conflict -> same vehicle in 2; area check, mover helper and suggested group each confirmed through the real UI')

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
 console.log('PASS staff intake by phone returns to the inbox with a one-click confirm, channel recorded as staff')
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

 // ── คนขับ: ไป-กลับ 4 ปุ่ม · กดซ้ำหลังเน็ตหลุดทำต่อได้ · ผู้ป่วยแจ้งพร้อมกลับ · เลขไมล์ช่องเดียว ──
 const b1Trip=await tripOf(b1),chairTrip=await tripOf(chairD)
 await runSql(()=>db.query("UPDATE public.patient_booking_trips SET state='cancelled' WHERE state IN ('outbound','hospital','returning','issue') AND id NOT IN ($1,$2)",[b1Trip,chairTrip]))
 await page.setViewportSize({width:390,height:900})
 await page.clock.setFixedTime(new Date(`${b1Day}T07:00:00+07:00`))
 await visit('driver');await card(b1Trip).waitFor()
 await click('driverRound',card(b1Trip).getByRole('button',{name:'ออกรถไปรับ',exact:true}));await toast('บันทึกแล้ว · ออกรถไปรับ').waitFor()
 await runAs(driver,async()=>{const b=(await rpc('patient_booking_workspace',[tenant])).bookings.find(x=>x.id===b1);await rpc('patient_booking_action',[tenant,randomUUID(),b1,b.revision,'passenger_next',''])})
 await click('driverRound',card(b1Trip).getByRole('button',{name:'ส่งถึงโรงพยาบาลแล้ว',exact:true}));await toast('บันทึกแล้ว · ส่งถึงโรงพยาบาลแล้ว').waitFor()
 assert.equal((await bookingRow(b1)).passenger_step,2,'กดซ้ำหลังเน็ตหลุดต้องทำต่อจากขั้นที่ค้าง ไม่ข้ามหรือซ้ำ')
 await visit('newcomer');await page.getByRole('article').filter({hasText:b1.slice(0,8).toUpperCase()}).getByRole('button',{name:'พร้อมให้มารับกลับ',exact:true}).click()
 await toast('บันทึกแล้ว').waitFor();assert.equal((await bookingRow(b1)).return_ready,true)
 await visit('driver');await card(b1Trip).getByText('แจ้งพร้อมให้รับกลับแล้ว').waitFor()
 await click('driverRound',card(b1Trip).getByRole('button',{name:'ออกไปรับกลับ',exact:true}));await toast('บันทึกแล้ว · ออกไปรับกลับ').waitFor()
 await click('driverRound',card(b1Trip).getByRole('button',{name:'ส่งถึงบ้านแล้ว · จบงาน',exact:true}))
 const odo=page.locator(`section[aria-label="จบแล้ว รอเติมเลขไมล์"] article[data-trip="${b1Trip}"]`);await odo.waitFor()
 assert.equal(clicks.driverRound,4,'ไป-กลับ 4 ปุ่ม');const b1Done=await bookingRow(b1);assert.equal(b1Done.status,'completed');assert.equal(b1Done.passenger_step,4)
 let startOdo=15000
 if(await odo.getByLabel('เลขไมล์ออก',{exact:true}).count())await odo.getByLabel('เลขไมล์ออก',{exact:true}).fill(String(startOdo))
 else startOdo=Number((await odo.locator('strong').first().innerText()).replace(/\D/g,''))
 await odo.getByLabel('เลขไมล์กลับ',{exact:true}).fill(String(startOdo+33));await odo.getByText('ระยะทาง 33 กม.',{exact:true}).waitFor()
 await odo.getByRole('button',{name:/^บันทึกเลขไมล์/}).click();await toast('บันทึกเลขไมล์แล้ว').waitFor();await odo.waitFor({state:'detached'})
 await visit('newcomer');await page.getByRole('article').filter({hasText:b1.slice(0,8).toUpperCase()}).getByText('เดินทางเสร็จแล้ว',{exact:false}).waitFor()
 // ── ขาเดียว + แจ้งเหตุขัดข้อง → เจ้าหน้าที่แก้จากกล่องคำขอรถ → คนขับวิ่งต่อจนจบ (2 ปุ่ม) ──
 await page.clock.setFixedTime(new Date(`${helperDay}T07:00:00+07:00`))
 await visit('driver')
 await click('driverOneWay',card(chairTrip).getByRole('button',{name:'ออกรถไปรับ',exact:true}));await toast('บันทึกแล้ว · ออกรถไปรับ').waitFor()
 await card(chairTrip).getByRole('button',{name:'แจ้งเหตุขัดข้อง',exact:true}).click()
 await card(chairTrip).getByRole('button',{name:'รถเสีย / รถมีปัญหา',exact:true}).click()
 await card(chairTrip).getByRole('button',{name:'ส่งให้เจ้าหน้าที่',exact:true}).click()
 await card(chairTrip).getByText(/แจ้งเหตุขัดข้องแล้ว: รถเสีย/).waitFor()
 await staffDesk();await row(chairD).getByRole('button',{name:'แก้เหตุขัดข้อง',exact:true}).click()
 await sheet.getByRole('button',{name:'แก้ไขแล้ว เดินรถต่อ',exact:true}).click();await sheet.waitFor({state:'detached'})
 await page.setViewportSize({width:390,height:900});await visit('driver')
 await click('driverOneWay',card(chairTrip).getByRole('button',{name:'ส่งถึงโรงพยาบาลแล้ว · จบงาน',exact:true}));await toast('บันทึกแล้ว · ส่งถึงโรงพยาบาลแล้ว · จบงาน').waitFor()
 const chairDone=await bookingRow(chairD);assert.equal(chairDone.status,'completed');assert.equal(chairDone.passenger_step,2);assert.equal(clicks.driverOneWay,2,'ขาเดียว 2 ปุ่ม')
 console.log('PASS driver: round trip in 4 presses with resume after a dropped connection, ready-to-return bell, one-field odometer; one-way in 2 presses with incident resolved from the inbox')

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
  const [letterWin]=await Promise.all([page.waitForEvent('popup'),click('printFromHeader',sheet.getByRole('button',{name:'พิมพ์หนังสือนำส่ง',exact:true}))])
  await letterWin.waitForFunction(()=>document.body?.innerText.includes('ใบคำขอรับสวัสดิการ'))
  const printed=await letterWin.evaluate(()=>document.body.innerText)
  assert.ok(printed.includes('ขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย'),'ต้องได้หนังสือนำส่ง')
  assert.ok(printed.includes(b1.slice(0,8).toUpperCase()),'ต้องเป็นเอกสารของเที่ยวที่เปิดอยู่')
  assert.equal(clicks.printFromHeader,1);await letterWin.close()
 }
 await sheet.getByRole('button',{name:'กรอกเลขหนังสือ',exact:true}).click()
 await sheet.getByLabel('เลขที่หนังสือ',{exact:true}).fill('พร 72301/77');await sheet.getByRole('button',{name:'บันทึกเลขหนังสือ',exact:true}).click();await toast('บันทึกเลขหนังสือนำส่งแล้ว').waitFor()
 // เอกสารครบแล้ว = แถวไม่มีงานค้าง ปุ่มแถวกลับเป็น "ดูรายละเอียด" และแบบฟอร์มย้ายไปอยู่ใต้ "จัดการเพิ่มเติม"
 await row(b1).getByRole('button',{name:'ดูรายละเอียด',exact:true}).waitFor()
 await sheet.locator('summary').filter({hasText:'จัดการเพิ่มเติม'}).click()
 await sheet.getByText(/^ที่ พร 72301\/77 ลงวันที่/).waitFor()
 let docs=(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===b1Trip)
 assert.equal(docs.forward_letter_no,'พร 72301/77');assert.equal(docs.odometer_end,startOdo+33,'เลขไมล์ของคนขับต้องถึงฐานข้อมูล')
 await sheet.getByLabel('เลขไมล์กลับ',{exact:true}).fill(String(startOdo+40));await sheet.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).selectOption('กรอกผิด')
 await runAs(coordinator,()=>rpc('patient_booking_save_odometer',[tenant,b1Trip,docs.docs_revision,16000,16044,false,'กรอกผิด']))
 await sheet.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await sheet.getByText(/ค่าล่าสุด: เลขไมล์ออก 16000/).waitFor()
 assert.equal(await sheet.getByLabel('เลขไมล์กลับ',{exact:true}).inputValue(),String(startOdo+40))
 assert.equal(await sheet.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).isDisabled(),true)
 await sheet.getByRole('button',{name:'ยืนยันใช้ค่าที่ฉันแก้',exact:true}).click();await sheet.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).click();await toast('บันทึกเลขไมล์แล้ว').waitFor()
 docs=(await runAs(coordinator,()=>rpc('patient_booking_workspace',[tenant]))).trips.find(t=>t.id===b1Trip);assert.equal(docs.odometer_end,startOdo+40)
 await sheet.getByRole('button',{name:'แก้เลขหนังสือ',exact:true}).click();await sheet.getByLabel('เลขที่หนังสือ',{exact:true}).fill('TEST draft')
 await runAs(coordinator,()=>rpc('patient_booking_record_letter',[tenant,b1Trip,docs.docs_revision,'TEST newest',docs.forward_letter_date]))
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
 await sheet.getByRole('button',{name:'แจ้งรถล่าช้า / ปรับเวลาประมาณการ',exact:true}).click()
 await sheet.getByLabel('ประกาศการเดินทาง',{exact:true}).selectOption('delayed')
 await sheet.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).fill('10:00');await sheet.getByLabel('รับกลับประมาณการใหม่',{exact:true}).fill('14:30')
 await sheet.getByRole('button',{name:'บันทึกประกาศและเวลา',exact:true}).click();await toast('บันทึกประกาศและเวลาประมาณการแล้ว').waitFor()
 await sheet.getByRole('button',{name:'แจ้งรถล่าช้า / ปรับเวลาประมาณการ',exact:true}).click();await sheet.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).fill('10:05')
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
 await page.setViewportSize({width:1280,height:900});await visit('coordinator')
 const menu=page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'})
 assert.deepEqual(await menu.getByRole('button').allInnerTexts(),['คำขอรถ','รายงาน'],'ผู้จัดคิวเห็น 2 แท็บ (6 แท็บเดิมรวมแล้ว)')
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
 console.log(`PASS click counts ${JSON.stringify(clicks)}`)
 assert.deepEqual(errors,[])
}catch(error){ if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-browser-failure.png`,fullPage:true})};throw error }finally{await browser.close();await server.close();await db.close()}
