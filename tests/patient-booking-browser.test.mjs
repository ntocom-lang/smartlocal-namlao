// Actual React screens + isolated PostgreSQL RPCs. All non-loopback requests blocked.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import { previousOdometer, thaiDay } from '../src/lib/patientBooking.js'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, day, calendarDay } = await import('./patient-booking-db.test.mjs')
await actor(admin); await rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings])
const setupTenant='00000000-0000-4000-8000-000000009001',setupAdmin='00000000-0000-4000-8000-000000009002',setupPartner='00000000-0000-4000-8000-000000009003'
await db.exec('RESET ROLE')
await db.query('INSERT INTO public.municipalities(id) VALUES($1)',[setupTenant])
await db.query("INSERT INTO public.profiles(id,municipality_id,role,full_name) VALUES($1,$2,'admin','TEST ผู้รับผิดชอบรถ')",[setupAdmin,setupTenant])
await db.query("INSERT INTO public.referral_partners(id,municipality_id,name,is_active,document_types,min_lead_days) VALUES($1,$2,'TEST กองทุนรถรับส่ง',true,ARRAY['patient_transport_request'],0)",[setupPartner,setupTenant])
let chain = Promise.resolve()
const users = { setupadmin:setupAdmin, citizen, coordinator, driver, admin, anonymous: null }
const order = {
 patient_booking_update_schedule:['p_muni','p_trip','p_revision','p_notice','p_pickup','p_return'],
 patient_booking_info:['p_muni'],patient_booking_workspace:['p_muni'],patient_booking_submit:['p_muni','p_id','p_data','p_staff_entry'],
 patient_booking_save_settings:['p_muni','p_revision','p_data'],patient_booking_preview:['p_muni','p_ids','p_helper'],
 patient_booking_confirm:['p_muni','p_id','p_ids','p_expected','p_helper'],patient_booking_action:['p_muni','p_op','p_entity','p_revision','p_action','p_note'],
 patient_booking_calendar:['p_muni','p_from','p_to'],patient_booking_submit_join:['p_muni','p_id','p_trip','p_data','p_staff_entry'],patient_booking_preview_join:['p_muni','p_booking'],patient_booking_confirm_join:['p_muni','p_op','p_booking','p_expected'],
 patient_booking_amend:['p_muni','p_op','p_id','p_revision','p_data','p_note'],
 patient_booking_save_odometer:['p_muni','p_trip','p_docs_revision','p_start','p_end','p_issue','p_note'],patient_booking_record_letter:['p_muni','p_trip','p_docs_revision','p_letter_no','p_letter_date'],patient_booking_record_odometer:['p_muni','p_trip','p_docs_revision','p_start','p_end'],patient_booking_month_report:['p_muni','p_month'],
}
const plugin = {
 name:'isolated-patient-booking-browser',enforce:'pre',
 resolveId(id){ if(id==='/__patient_entry.js')return '\0patient-entry.js' },
 load(id){
  const normalized=id.replaceAll('\\','/')
  if(id==='\0patient-entry.js')return `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import Page from '/src/pages/PatientTransportBooking.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Page)));`
  if(normalized.endsWith('/contexts/TenantContext.jsx'))return `export const useTenant=()=>({tenant:{id:new URLSearchParams(location.search).get('as')==='setupadmin'?'${setupTenant}':'${tenant}',name:'อบต. TEST'},isModuleEnabled:()=>true})`
  if(normalized.endsWith('/contexts/AuthContext.jsx'))return `const role=new URLSearchParams(location.search).get('as')||'citizen';const ids=${JSON.stringify(users)};export const useAuth=()=>({session:{user:{id:ids[role]}},profileName:'TEST Browser Requester'});`
  if(normalized.endsWith('/lib/supabase.js'))return `export const supabase={rpc:async(name,args)=>{const user=new URLSearchParams(location.search).get('as')||'citizen';return (await fetch('/__patient_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,user})})).json()}};`
 },
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url.startsWith('/__patient?')){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__patient_entry.js"></script></body></html>'));return}
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
const visit=async (as, home=true)=>{await page.goto(`${base}/__patient?as=${as}`);await page.getByRole('button',{name:'หน้าบริการ',exact:true}).waitFor();if(home)await page.getByRole('button',{name:'หน้าบริการ',exact:true}).click()}
try{
 await visit('setupadmin');await page.getByRole('button',{name:'ตั้งค่ารถและเปิดบริการ',exact:true}).click()
 await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกค่าตั้งต้นแล้ว'}).waitFor()
 await actor(setupAdmin);assert.equal((await rpc('patient_booking_workspace',[setupTenant])).settings.enabled,false)
 console.log('PASS first-time empty draft settings saved without enabling booking')
 await page.locator('select').filter({has:page.locator(`option[value="${setupPartner}"]`)}).selectOption(setupPartner)
 await page.getByLabel('บัญชีคนขับ',{exact:true}).selectOption(setupAdmin)
 await page.getByRole('group',{name:'เจ้าหน้าที่ผู้ยืนยันคิว',exact:true}).getByRole('checkbox').check()
 await page.getByLabel('ที่นั่งผู้โดยสาร ไม่รวมคนขับ',{exact:true}).fill('4');await page.getByLabel('ที่ยึดรถเข็น',{exact:true}).fill('1');await page.getByLabel('ที่ยึดเปล',{exact:true}).fill('1');await page.getByLabel('เบอร์ติดต่อหน่วยงาน',{exact:true}).fill('0800000000')
 await page.getByRole('button',{name:'เพิ่มเส้นทาง',exact:true}).click();await page.getByLabel('ชื่อโรงพยาบาล — พื้นที่รับ',{exact:true}).fill('TEST โรงพยาบาลใกล้เคียง');await page.getByLabel('นาทีต่อขา',{exact:true}).fill('30')
 for(const label of ['ตรวจปฏิทินวันหยุดครอบคลุมถึง','ข้อความแจ้งการใช้ข้อมูลที่ผู้รับผิดชอบตรวจรับแล้ว'])assert.equal(await page.getByLabel(label,{exact:true}).count(),0)
 await page.getByRole('checkbox',{name:'เปิดรับจองรถออนไลน์',exact:true}).check();await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกค่าตั้งต้นแล้ว'}).waitFor()
 await actor(setupAdmin);const initialSettings=(await rpc('patient_booking_workspace',[setupTenant])).settings;assert.equal(initialSettings.enabled,true);assert.equal(initialSettings.calendar_checked_through,null);assert.equal(initialSettings.delegation_reference,'');assert(initialSettings.privacy_notice.includes('บริการรถรับส่งผู้ป่วย'));assert.equal(initialSettings.driver_id,setupAdmin);assert.deepEqual(initialSettings.coordinator_ids,[setupAdmin]);assert.equal((await rpc('patient_booking_info',[setupTenant])).enabled,true)
 await page.getByRole('button',{name:'หน้าบริการ',exact:true}).click();await page.getByRole('button',{name:'ขอจองรถรับส่ง',exact:true}).waitFor()
 console.log('PASS first-time setup completed through actual UI and booking opens; one account serves both duties')
 for(const [as, role] of [['anonymous','citizen'],['citizen','citizen'],['coordinator','coordinator'],['driver','driver'],['admin','admin']]) {
  await visit(as,false);await page.getByRole('button',{name:'คู่มือและแนะนำการใช้งาน',exact:true}).click()
  const help=page.getByRole('region',{name:'คู่มือรถรับส่งผู้ป่วย'});assert.equal(await help.getByLabel('คู่มือสำหรับ',{exact:true}).inputValue(),role)
  if(role==='citizen')assert.equal(await help.locator('option').count(),1)
  await help.locator('summary').first().click();await help.getByRole('button',{name:'แนะนำทีละขั้น',exact:true}).click()
  assert.equal(await help.getByRole('button',{name:'ขั้นก่อนหน้า',exact:true}).isDisabled(),true)
  assert.equal(await page.locator('nav [data-help-highlight="true"]').count(),1)
  await help.getByRole('button',{name:'ขั้นถัดไป',exact:true}).click();await help.getByRole('button',{name:'ขั้นก่อนหน้า',exact:true}).click()
  for(const width of [320,390,768]) {await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`help ${as} ${width}px overflow`)}
  if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.setViewportSize({width:390,height:900});await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-help-${as}.png`,fullPage:true})}
  await help.getByRole('button',{name:'ปิดคำแนะนำ',exact:true}).focus();await page.keyboard.press('Escape');assert.equal(await help.count(),0);assert.equal(await page.locator('nav [data-help-highlight="true"]').count(),0)
  assert.equal(await page.getByRole('button',{name:'คู่มือและแนะนำการใช้งาน',exact:true}).evaluate(el=>el===document.activeElement),true)
 }
 await visit('citizen');await page.getByRole('button',{name:'ขอจองรถรับส่ง',exact:true}).click();await page.getByLabel('วันที่นัดแพทย์',{exact:true}).fill(day)
 await page.getByRole('button',{name:'คู่มือและแนะนำการใช้งาน',exact:true}).click();await page.getByRole('button',{name:'แนะนำทีละขั้น',exact:true}).click()
 while(await page.getByRole('button',{name:'ขั้นถัดไป',exact:true}).count())await page.getByRole('button',{name:'ขั้นถัดไป',exact:true}).click()
 await page.getByRole('button',{name:'จบคำแนะนำ',exact:true}).click();assert.equal(await page.getByLabel('วันที่นัดแพทย์',{exact:true}).inputValue(),day)
 console.log('PASS role-aware manual, step guide, menu highlight, keyboard close/focus, responsive layout and unsaved booking preserved')
 await visit('anonymous',false);await page.getByRole('region',{name:'ตารางรถสำหรับประชาชน'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'ตาราง',exact:true}).getAttribute('aria-pressed'),'true')
 assert.equal(await page.getByLabel('ตั้งแต่วันที่',{exact:true}).inputValue(),thaiDay())
 await page.getByRole('button',{name:'ปฏิทิน',exact:true}).click();await visit('anonymous',false)
 assert.equal(await page.getByRole('button',{name:'ปฏิทิน',exact:true}).getAttribute('aria-pressed'),'true')
 await page.getByRole('button',{name:'ตั้งแต่วันนี้ 14 วัน',exact:true}).click()
 await visit('coordinator',false);await page.getByRole('region',{name:'ตารางออกรถเจ้าหน้าที่'}).waitFor()
 assert.equal(await page.getByLabel('วันออกรถ',{exact:true}).inputValue(),thaiDay())
 console.log('PASS role defaults: citizen upcoming table, calendar preference retained, coordinator daily schedule')
 await visit('admin');await page.getByRole('button',{name:'ตั้งค่า',exact:true}).click()
 const dualCheckbox=page.getByRole('group',{name:'เจ้าหน้าที่ผู้ยืนยันคิว',exact:true}).getByRole('checkbox',{name:'Driver TEST',exact:true})
 await dualCheckbox.check();await page.getByLabel('บัญชีคนขับ',{exact:true}).selectOption(coordinator);await page.getByLabel('บัญชีคนขับ',{exact:true}).selectOption(driver);assert.equal(await dualCheckbox.isChecked(),true)
 await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกค่าตั้งต้นแล้ว'}).waitFor()
 await actor(driver);const dualWorkspace=await rpc('patient_booking_workspace',[tenant]);assert.equal(dualWorkspace.role,'coordinator');assert(dualWorkspace.settings.coordinator_ids.includes(driver));assert.equal(dualWorkspace.settings.driver_id,driver)
 // An empty trip list must not hide the assigned driver's menu.
 await page.route('**/__patient_rpc',async route=>{const request=route.request().postDataJSON();if(request.name==='patient_booking_workspace'&&request.user==='driver'){const response=await route.fetch();const body=await response.json();body.data.trips=[];await route.fulfill({response,json:body})}else await route.fallback()})
 await visit('driver',false);await page.getByRole('button',{name:'จัดคิว',exact:true}).waitFor();await page.getByRole('button',{name:'งานคนขับ',exact:true}).click();await page.unroute('**/__patient_rpc')

 await visit('citizen');await page.getByRole('button',{name:'ขอจองรถรับส่ง',exact:true}).click()
 await page.getByLabel('วันที่นัดแพทย์',{exact:true}).fill(day);await page.getByLabel('เวลานัดแพทย์',{exact:true}).fill('14:30');await page.getByLabel('คาดว่าพร้อมรับกลับ (ยังไม่ทราบเว้นว่างได้)',{exact:true}).fill('15:00');await page.getByLabel('เป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน',{exact:true}).check();await page.getByRole('button',{name:'ต่อไป',exact:true}).click()
 await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).fill('0800000099');await page.getByLabel('จุดรับและจุดสังเกต',{exact:true}).fill('TEST Browser pickup');await page.getByLabel('ผู้เดินทางอยู่ในเขตพื้นที่ (หากไม่แน่ใจให้เจ้าหน้าที่ตรวจสอบ)',{exact:true}).check();await page.getByRole('button',{name:'ต่อไป',exact:true}).click();await page.getByLabel('ยืนยันการใช้ข้อมูลตามข้อความข้างต้น และข้อมูลจองถูกต้อง',{exact:true}).check();await page.getByRole('button',{name:'ส่งคำขอจองรถ',exact:true}).click();await page.getByRole('article').filter({hasText:'TEST Browser Requester'}).waitFor()
 await visit('driver');await page.getByRole('button',{name:'จัดคิว',exact:true}).click();const proposal=page.getByRole('article').filter({hasText:'TEST Browser Requester'});await proposal.getByRole('button',{name:'ตรวจแผนและเวลาว่าง',exact:true}).click();await page.getByRole('button',{name:'ตรวจแล้ว ยืนยันเที่ยวนี้',exact:true}).click();await page.getByRole('status').filter({hasText:'ยืนยันเที่ยวแล้ว'}).waitFor();
 await visit('driver');await page.getByRole('button',{name:'งานคนขับ',exact:true}).click();const trip=page.getByRole('article').filter({hasText:'TEST Browser Requester'});for(const label of ['ออกไปรับ','รับผู้เดินทางแล้ว','ส่งถึงโรงพยาบาลแล้ว','ส่งถึงครบ · รอรับกลับ','ออกไปรับขากลับ','รับกลับแล้ว','ส่งถึงจุดหมายแล้ว','ส่งกลับครบ · จบเที่ยว']){await trip.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).waitFor();}
 await visit('citizen');await page.getByRole('button',{name:'การจองของฉัน',exact:true}).click();assert.match(await page.getByRole('article').filter({hasText:'TEST Browser Requester'}).textContent(),/จบเที่ยวแล้ว/)
 console.log('PASS actual React booking -> coordinator confirmation -> driver individual return -> citizen completed, backed by local PostgreSQL')
 await actor(driver);const sameActorTrip=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.state==='completed'&&t.confirmed_by===driver);assert(sameActorTrip);assert.equal(sameActorTrip.driver_id,driver)
 await actor(admin);await rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings])
 console.log('PASS same account saves both roles, retains coordinator checkbox on driver selection, sees empty driver menu, confirms and completes its own assigned trip')

 await visit('anonymous');await page.getByRole('button',{name:'ดูตารางรถ',exact:true}).click();await page.getByLabel('เดือน',{exact:true}).fill(calendarDay.slice(0,7));await page.locator('summary').filter({hasText:'กรองวันที่และเส้นทาง'}).click();await page.getByLabel('ตั้งแต่วันที่',{exact:true}).fill(calendarDay);await page.getByLabel('ถึงวันที่',{exact:true}).fill(calendarDay);await page.getByRole('button',{name:'ตาราง',exact:true}).click();await page.getByText('ผู้เดินทางรวมผู้ติดตาม 3 คน · เหลือ 1 ที่นั่ง',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'ขอร่วมเที่ยวนี้',exact:true}).count(),0)
 await visit('citizen');await page.getByRole('button',{name:'ดูตารางรถ',exact:true}).click();assert.equal(await page.getByRole('button',{name:'ตาราง',exact:true}).getAttribute('aria-pressed'),'true');await page.getByLabel('เดือน',{exact:true}).fill(calendarDay.slice(0,7));await page.locator('summary').filter({hasText:'กรองวันที่และเส้นทาง'}).click();await page.getByLabel('ตั้งแต่วันที่',{exact:true}).fill(calendarDay);await page.getByLabel('ถึงวันที่',{exact:true}).fill(calendarDay);await page.getByLabel('เฉพาะเที่ยวที่ร่วมได้',{exact:true}).check();await page.getByRole('button',{name:'ขอร่วมเที่ยวนี้',exact:true}).click()
 assert.equal(await page.getByLabel('วันที่นัดแพทย์',{exact:true}).inputValue(),calendarDay);await page.getByLabel('เวลานัดแพทย์',{exact:true}).fill('10:30');await page.getByLabel('เป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน',{exact:true}).check();await page.getByRole('button',{name:'ต่อไป',exact:true}).click();await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).fill('0800000500');await page.getByLabel('จุดรับและจุดสังเกต',{exact:true}).fill('TEST calendar browser pickup');await page.getByLabel('ผู้ติดตาม',{exact:true}).selectOption('0');await page.getByLabel('ผู้เดินทางอยู่ในเขตพื้นที่ (หากไม่แน่ใจให้เจ้าหน้าที่ตรวจสอบ)',{exact:true}).check();await page.getByRole('button',{name:'ต่อไป',exact:true}).click();await page.getByLabel('ยืนยันการใช้ข้อมูลตามข้อความข้างต้น และข้อมูลจองถูกต้อง',{exact:true}).check();await page.getByRole('button',{name:'ส่งคำขอจองรถ',exact:true}).click();await page.getByText('ขอร่วมเที่ยว รอเจ้าหน้าที่ตรวจยืนยัน',{exact:true}).waitFor()
 await visit('coordinator');await page.getByRole('button',{name:'จัดคิว',exact:true}).click();await page.getByRole('article').filter({hasText:'ขอร่วมเที่ยวที่ยืนยันแล้ว'}).getByRole('button',{name:'ตรวจแผนและเวลาว่าง',exact:true}).click();await page.getByRole('button',{name:'ตรวจแล้ว ยืนยันเที่ยวนี้',exact:true}).click();await page.getByRole('status').filter({hasText:'ยืนยันร่วมเที่ยวแล้ว'}).waitFor()
 await visit('citizen');await page.getByRole('button',{name:'ดูตารางรถ',exact:true}).click();await page.getByLabel('เดือน',{exact:true}).fill(calendarDay.slice(0,7));await page.locator('summary').filter({hasText:'กรองวันที่และเส้นทาง'}).click();await page.getByLabel('ตั้งแต่วันที่',{exact:true}).fill(calendarDay);await page.getByLabel('ถึงวันที่',{exact:true}).fill(calendarDay);await page.getByText('ผู้เดินทางรวมผู้ติดตาม 4 คน · เหลือ 0 ที่นั่ง',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'ขอร่วมเที่ยวนี้',exact:true}).count(),0)
 for(const width of [320,390,768,1024]){await page.setViewportSize({width,height:900});for(const mode of ['ปฏิทิน','ตาราง']){await page.getByRole('button',{name:mode,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width} ${mode} overflow`)} }
 if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.setViewportSize({width:390,height:900});await page.getByLabel('ตั้งแต่วันที่',{exact:true}).fill(`${calendarDay.slice(0,7)}-01`);await page.getByLabel('ถึงวันที่',{exact:true}).fill(`${calendarDay.slice(0,7)}-28`);await page.locator('summary').filter({hasText:'กรองวันที่และเส้นทาง'}).click();for(const [mode,file] of [['ปฏิทิน','calendar'],['ตาราง','table']]){await page.getByRole('button',{name:mode,exact:true}).click();if(mode==='ปฏิทิน') { await page.locator('[aria-label="ปฏิทินรายเดือน"] button').filter({hasText:new RegExp(`^${Number(calendarDay.slice(-2))}\\D`)}).click() } await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-${file}-390.png`,fullPage:true})}}
 console.log('PASS anonymous aggregate calendar, remembered view, table join request -> existing-trip confirmation -> full seats; calendar/table at 320/390/768/1024px')

 // Intake guards seen by a citizen: the form refuses days and appointment times the queue could never confirm.
 await page.setViewportSize({width:390,height:900});await visit('citizen');await page.getByRole('button',{name:'ขอจองรถรับส่ง',exact:true}).click()
 const weekendDate=new Date();weekendDate.setUTCDate(weekendDate.getUTCDate()+1);while(weekendDate.getUTCDay()!==6)weekendDate.setUTCDate(weekendDate.getUTCDate()+1)
 await page.getByLabel('วันที่นัดแพทย์',{exact:true}).fill(weekendDate.toISOString().slice(0,10))
 await page.getByRole('alert').filter({hasText:'ตรงวันหยุดให้บริการ'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'ต่อไป',exact:true}).isDisabled(),true,'Weekend must block the step')
 if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-booking-blocked-day-390.png`,fullPage:true})}
 await page.getByLabel('วันที่นัดแพทย์',{exact:true}).fill(day);await page.getByLabel('เวลานัดแพทย์',{exact:true}).fill('08:45')
 await page.getByRole('alert').filter({hasText:'นอกเวลาบริการ'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'ต่อไป',exact:true}).isDisabled(),true,'Pickup before office hours must block the step')
 if(process.env.PATIENT_PREVIEW_SHOTS){await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-booking-early-appointment-390.png`,fullPage:true})}
 await page.getByLabel('เวลานัดแพทย์',{exact:true}).fill('10:00')
 await page.getByRole('status').filter({hasText:'วันนี้เปิดรับจอง'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'ต่อไป',exact:true}).isDisabled(),false,'A serviceable day and time must pass')
 if(process.env.PATIENT_PREVIEW_SHOTS){await page.getByLabel('เป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน',{exact:true}).check();await page.getByRole('button',{name:'ต่อไป',exact:true}).click();await page.getByText('ปักหมุดจุดรับ (ถ้าสะดวก)',{exact:true}).waitFor();await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-booking-pickup-pin-390.png`,fullPage:true})}
 console.log('PASS booking form blocks closed days and appointments outside office hours before the request is sent')

 // เอกสารถึงกองทุนผ่านหน้าจอจริง: เจ้าหน้าที่บันทึกเลขหนังสือ คนขับบันทึกเลขไมล์ ค่าถึงฐานข้อมูลจริง
 await page.setViewportSize({width:390,height:900});await visit('driver');await page.getByRole('button',{name:'งานคนขับ',exact:true}).click()
 const driverTrip=page.getByRole('article').first();await driverTrip.getByLabel('เลขไมล์ออก',{exact:true}).fill('15000');await driverTrip.getByLabel('เลขไมล์กลับ',{exact:true}).fill('15033')
 if(await driverTrip.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).count()) await driverTrip.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).selectOption('กรอกผิด');await driverTrip.getByText('ระยะทาง 33 กม.',{exact:true}).waitFor();await driverTrip.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกเลขไมล์แล้ว'}).waitFor()
 await visit('coordinator');await page.getByRole('button',{name:'จัดคิว',exact:true}).click();await page.getByRole('button',{name:'เที่ยวที่ยืนยันแล้ว',exact:true}).click()
 const odoTrip=page.locator('article:has(input[name="odometer_end"][value="15033"])')
 // เลขไมล์ออก = เลขไมล์กลับของเที่ยวก่อนหน้าตามเวลา ไม่ใช่ค่าสูงสุดของทุกเที่ยว (ผลตรวจ #227 ข้อ 5)
 {
  const trip=(id,at,end,state='completed')=>({id,state,odometer_end:end,plan:{pickup_at:`2026-10-05T${at}:00+07:00`}})
  const loaded=[trip('a','08:00',100),trip('late','11:00',200),trip('void','09:00',150,'cancelled'),trip('open','08:30',null,'confirmed')]
  assert.equal(previousOdometer(trip('now','09:30',null,'confirmed'),loaded),100,'ต้องหยิบเที่ยวก่อนหน้า ไม่ใช่เที่ยวที่วิ่งทีหลังหรือที่ยกเลิก')
  assert.equal(previousOdometer(trip('first','07:00',null,'confirmed'),loaded),'','ไม่มีเที่ยวก่อนหน้าต้องเว้นว่าง ไม่เดา')
 };await odoTrip.getByRole('button',{name:/^(กรอก|แก้)เลขหนังสือ$/}).click()
 await odoTrip.getByLabel('เลขที่หนังสือ',{exact:true}).fill('พร 72301/77');await odoTrip.getByRole('button',{name:'บันทึกเลขหนังสือ',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกเลขหนังสือนำส่งแล้ว'}).waitFor()
 await odoTrip.getByText(/^ที่ พร 72301\/77 ลงวันที่/).waitFor()
 if(process.env.PATIENT_PREVIEW_SHOTS){await odoTrip.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-booking-fund-docs-390.png`})}
 await actor(coordinator);const saved=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.forward_letter_no==='พร 72301/77')
 assert(saved,'เลขหนังสือไม่ถึงฐานข้อมูล');assert.equal(saved.odometer_end,15033,'เลขไมล์ไม่ถึงฐานข้อมูล')
 // จบเที่ยวแล้วแต่ยังไม่มีเลขไมล์กลับ ต้องยังอยู่ในหน้าคนขับให้เติมเองได้ (ผลตรวจ #227 ข้อ 4)
 await visit('driver');await page.getByRole('button',{name:'งานคนขับ',exact:true}).click()
 const waiting=page.getByRole('region',{name:'จบแล้ว รอเติมเลขไมล์'});await waiting.getByRole('heading',{name:/^จบแล้ว รอเติมเลขไมล์/}).waitFor()
 const late=waiting.getByRole('article').first();await late.locator('input[name="odometer_start"]').fill('14000');await late.locator('input[name="odometer_end"]').fill('14020')
 if(await late.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).count()) await late.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).selectOption('กรอกผิด');await late.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกเลขไมล์แล้ว'}).waitFor()
 await actor(coordinator);assert((await rpc('patient_booking_workspace',[tenant])).trips.some(t=>t.state==='completed'&&t.odometer_end===14020),'เลขไมล์ของเที่ยวที่จบแล้วไม่ถึงฐานข้อมูล')
 console.log('PASS fund documents through the real UI: driver odometer + coordinator letter number reach PostgreSQL')
 await visit('coordinator');await page.getByRole('button',{name:'จัดคิว',exact:true}).click();await page.getByRole('button',{name:'เที่ยวที่ยืนยันแล้ว',exact:true}).click()
 const editingIndex=await page.getByRole('article').evaluateAll(nodes=>nodes.findIndex(n=>n.textContent.includes('พร 72301/77')));const editing=page.getByRole('article').nth(editingIndex);await editing.waitFor()
 await editing.getByLabel('เลขไมล์กลับ',{exact:true}).fill('15040');await editing.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).selectOption('กรอกผิด')
 await actor(coordinator);let v=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===saved.id)
 await rpc('patient_booking_save_odometer',[tenant,saved.id,v.docs_revision,16000,16044,false,'กรอกผิด'])
 await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await editing.getByText(/ค่าล่าสุด: เลขไมล์ออก 16000/).waitFor()
 assert.equal(await editing.getByLabel('เลขไมล์กลับ',{exact:true}).inputValue(),'15040')
 assert.equal(await editing.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).isDisabled(),true)
 await editing.getByRole('button',{name:'ยืนยันใช้ค่าที่ฉันแก้',exact:true}).click();await editing.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกเลขไมล์แล้ว'}).waitFor()
 await actor(coordinator);v=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.id===saved.id);assert.equal(v.odometer_end,15040)
 // Clean fields follow new server values; edited letter keeps its baseline revision.
 await editing.getByRole('button',{name:'แก้เลขหนังสือ',exact:true}).click();await editing.getByLabel('เลขที่หนังสือ',{exact:true}).fill('TEST draft')
 await rpc('patient_booking_record_letter',[tenant,saved.id,v.docs_revision,'TEST newest',saved.forward_letter_date])
 await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await editing.getByText(/ค่าล่าสุด: เลขหนังสือ TEST newest/).waitFor()
 assert.equal(await editing.getByRole('button',{name:'บันทึกเลขหนังสือ',exact:true}).isDisabled(),true)
 await editing.getByRole('button',{name:'ใช้ค่าล่าสุด',exact:true}).click();assert.equal(await editing.getByLabel('เลขที่หนังสือ',{exact:true}).inputValue(),'TEST newest')
 // Abnormal meter readings are accepted but excluded from report distance.
 await editing.getByLabel('เลขไมล์กลับ',{exact:true}).fill('5');await editing.getByLabel('มาตรวัดมีปัญหา / ระยะทางรอตรวจสอบ',{exact:true}).check();await editing.getByLabel('เหตุผลที่แก้เลขไมล์',{exact:true}).selectOption('เปลี่ยนมาตรวัด')
 await editing.getByRole('button',{name:'บันทึกเลขไมล์',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกเลขไมล์แล้ว'}).waitFor()
 await actor(coordinator);const actualReport=await rpc('patient_booking_month_report',[tenant,saved.plan.date]);assert.equal(actualReport.trips.find(t=>t.trip_id===saved.id).distance,null)
 console.log('PASS dirty draft survives refresh, stale save blocked, explicit overwrite succeeds, letter accepts latest, abnormal meter saves without distance')


 await visit('coordinator',false);await page.getByLabel('วันออกรถ',{exact:true}).fill(calendarDay)
 const schedule=page.getByRole('region',{name:'ตารางออกรถเจ้าหน้าที่'});await schedule.getByText('ขาไปและกลับพื้นที่',{exact:false}).waitFor()
 assert.equal(await schedule.getByRole('article').count(),2,'later must show both reserved windows')
 await schedule.getByRole('region',{name:'คำขอรอยืนยันของวัน'}).waitFor()
 const firstBlock=schedule.getByRole('article').first();await firstBlock.locator('summary').click()
 await firstBlock.getByRole('button',{name:'แจ้งล่าช้า / ปรับเวลาประมาณการ',exact:true}).click()
 await firstBlock.getByLabel('ประกาศการเดินทาง',{exact:true}).selectOption('delayed')
 await firstBlock.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).fill('10:00')
 await firstBlock.getByLabel('รับกลับประมาณการใหม่',{exact:true}).fill('14:30')
 await firstBlock.getByRole('button',{name:'บันทึกประกาศและเวลา',exact:true}).click();await page.getByRole('status').filter({hasText:'บันทึกประกาศและเวลาประมาณการแล้ว'}).waitFor()
 // An update by another coordinator cannot silently acquire the draft's current revision.
 await firstBlock.getByRole('button',{name:'แจ้งล่าช้า / ปรับเวลาประมาณการ',exact:true}).click()
 await firstBlock.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).fill('10:05')
 await actor(coordinator);let scheduleTrip=(await rpc('patient_booking_workspace',[tenant])).trips.find(t=>t.plan.date===calendarDay)
 await rpc('patient_booking_update_schedule',[tenant,scheduleTrip.id,scheduleTrip.schedule_revision,'delayed',`${calendarDay}T10:10:00+07:00`,`${calendarDay}T14:30:00+07:00`])
 await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();await firstBlock.getByText(/ข้อมูลแจ้งเวลาเปลี่ยนแล้ว:/).waitFor()
 assert.equal(await firstBlock.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).inputValue(),'10:05')
 assert.equal(await firstBlock.getByRole('button',{name:'บันทึกประกาศและเวลา',exact:true}).isDisabled(),true)
 await firstBlock.getByRole('button',{name:'ใช้เวลาแจ้งล่าสุด',exact:true}).click()
 assert.equal(await firstBlock.getByLabel('เริ่มรับประมาณการใหม่',{exact:true}).inputValue(),'10:10')
 for(const width of [320,390,768,1024]) {await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`schedule ${width}px overflow`)}
 if(process.env.PATIENT_PREVIEW_SHOTS){await page.setViewportSize({width:390,height:900});await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-schedule-staff-390.png`,fullPage:true})}
 await visit('anonymous',false);await page.getByLabel('เดือน',{exact:true}).fill(calendarDay.slice(0,7));await page.locator('summary').filter({hasText:'กรองวันที่และเส้นทาง'}).click();await page.getByLabel('ตั้งแต่วันที่',{exact:true}).fill(calendarDay);await page.getByLabel('ถึงวันที่',{exact:true}).fill(calendarDay)
 await page.getByText(/แจ้งเวลาล่าสุด: เริ่มรับ 10:10/).waitFor();await page.getByText('รถล่าช้า · กรุณาดูเวลาประมาณการล่าสุด',{exact:true}).waitFor()
 assert(!await page.getByRole('region',{name:'ตารางรถสำหรับประชาชน'}).textContent().then(text=>/TEST patient|TEST pickup|Driver TEST/.test(text)))
 if(process.env.PATIENT_PREVIEW_SHOTS){await page.locator('summary').filter({hasText:'กรองวันที่และเส้นทาง'}).click();await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-schedule-public-390.png`,fullPage:true})}
 await visit('citizen',false);await page.getByRole('button',{name:'การจองของฉัน',exact:true}).click();await page.getByText(/แจ้งเริ่มรับล่าสุด.*10:10/).first().waitFor()
 console.log('PASS daily blocks, private roster, schedule update reaches public and own booking, stale draft preserved/blocked, responsive 320/390/768/1024px')

 for(const width of [320,390,768,1024]){await page.setViewportSize({width,height:900});for(const as of ['citizen','coordinator','driver','admin']){await visit(as);const tab={citizen:'หน้าบริการ',coordinator:'จัดคิว',driver:'งานคนขับ',admin:'ตั้งค่า'}[as];await page.getByRole('button',{name:tab,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width} ${as} overflow`)}console.log(`PASS rendered ${width}px four roles`)}
 if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.setViewportSize({width:390,height:900});await visit('citizen');await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-booking-live-ui-390.png`,fullPage:true});await visit('coordinator');await page.getByRole('button',{name:'จัดคิว',exact:true}).click();await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-booking-queue-390.png`,fullPage:true})}
 // Disabled booking has no second intake form; administrators retain setup access.
 await actor(admin);const currentSettings=(await rpc('patient_booking_workspace',[tenant])).settings
 await rpc('patient_booking_save_settings',[tenant,currentSettings.revision,{...settings,enabled:false}])
 await visit('citizen',false);await page.getByText('หน่วยงานยังไม่เปิดรับจองรถออนไลน์ กรุณาติดต่อเจ้าหน้าที่เพื่อสอบถามบริการ',{exact:true}).waitFor()
 assert.equal(await page.locator('a[href*="type=patient_transport_request"]').count(),0)
 await page.getByRole('link',{name:'ติดตามคำขอที่เคยยื่นไว้',exact:true}).waitFor()
 await page.getByRole('button',{name:'คู่มือและแนะนำการใช้งาน',exact:true}).click();await page.getByRole('button',{name:'แนะนำทีละขั้น',exact:true}).click();await page.getByRole('button',{name:'จบคำแนะนำ',exact:true}).waitFor()
 await visit('admin');await page.getByRole('button',{name:'ตั้งค่ารถและเปิดบริการ',exact:true}).click();await page.getByRole('button',{name:'ตั้งค่า',exact:true}).waitFor()
 const citizenSource=await readFile(new URL('../src/pages/CitizenDocRequest.jsx',import.meta.url),'utf8');const staffSource=await readFile(new URL('../src/pages/StaffDashboard.jsx',import.meta.url),'utf8')
 assert(citizenSource.indexOf('<Navigate to="/patient-transport" replace />') < citizenSource.indexOf('if (needsIdCard)'));assert(!citizenSource.includes('PatientTransportWizard'));assert(!staffSource.includes('PatientTransportWizard'));assert(citizenSource.includes('<Navigate to="/patient-transport" replace />'));assert(staffSource.includes("onSelectPatientTransport={() => { setShowAdd(false); navigate('/patient-transport') }}"));assert(staffSource.includes('<PatientTransportPanel'))
 console.log('PASS unified entry routes, no fallback intake, disabled service/admin setup, history retained')
 assert.deepEqual(errors,[])
}catch(error){ if(process.env.PATIENT_PREVIEW_SHOTS)await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-schedule-failure.png`,fullPage:true});throw error }finally{await browser.close();await server.close();await db.close()}
