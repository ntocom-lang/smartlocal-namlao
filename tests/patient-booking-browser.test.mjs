// Actual React screens + isolated PostgreSQL RPCs. All non-loopback requests blocked.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
process.env.PATIENT_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, settings, day, calendarDay } = await import('./patient-booking-db.test.mjs')
await actor(admin); await rpc('patient_booking_save_settings',[tenant,(await rpc('patient_booking_workspace',[tenant])).settings.revision,settings])
let chain = Promise.resolve()
const users = { citizen, coordinator, driver, admin, anonymous: null }
const order = {
 patient_booking_info:['p_muni'],patient_booking_workspace:['p_muni'],patient_booking_submit:['p_muni','p_id','p_data'],
 patient_booking_save_settings:['p_muni','p_revision','p_data'],patient_booking_preview:['p_muni','p_ids','p_helper'],
 patient_booking_confirm:['p_muni','p_id','p_ids','p_expected','p_helper'],patient_booking_action:['p_muni','p_op','p_entity','p_revision','p_action','p_note'],
 patient_booking_calendar:['p_muni','p_from','p_to'],patient_booking_submit_join:['p_muni','p_id','p_trip','p_data'],patient_booking_preview_join:['p_muni','p_booking'],patient_booking_confirm_join:['p_muni','p_op','p_booking','p_expected'],
 patient_booking_amend:['p_muni','p_op','p_id','p_revision','p_data','p_note'],
}
const plugin = {
 name:'isolated-patient-booking-browser',enforce:'pre',
 resolveId(id){ if(id==='/__patient_entry.js')return '\0patient-entry.js' },
 load(id){
  const normalized=id.replaceAll('\\','/')
  if(id==='\0patient-entry.js')return `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import Page from '/src/pages/PatientTransportBooking.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Page)));`
  if(normalized.endsWith('/contexts/TenantContext.jsx'))return `export const useTenant=()=>({tenant:{id:'${tenant}',name:'อบต. TEST'},isModuleEnabled:()=>true})`
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
const visit=async as=>{await page.goto(`${base}/__patient?as=${as}`);await page.getByRole('button',{name:'หน้าบริการ',exact:true}).waitFor()}
try{
 await visit('citizen');await page.getByRole('button',{name:'ขอจองรถรับส่ง',exact:true}).click()
 await page.getByLabel('วันที่นัดแพทย์',{exact:true}).fill(day);await page.getByLabel('เวลานัดแพทย์',{exact:true}).fill('14:30');await page.getByLabel('คาดว่าพร้อมรับกลับ (ยังไม่ทราบเว้นว่างได้)',{exact:true}).fill('15:00');await page.getByLabel('เป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน',{exact:true}).check();await page.getByRole('button',{name:'ต่อไป',exact:true}).click()
 await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).fill('0800000099');await page.getByLabel('จุดรับและจุดสังเกต',{exact:true}).fill('TEST Browser pickup');await page.getByLabel('ผู้เดินทางอยู่ในเขตพื้นที่ (หากไม่แน่ใจให้เจ้าหน้าที่ตรวจสอบ)',{exact:true}).check();await page.getByRole('button',{name:'ต่อไป',exact:true}).click();await page.getByLabel('ยืนยันการใช้ข้อมูลตามข้อความข้างต้น และข้อมูลจองถูกต้อง',{exact:true}).check();await page.getByRole('button',{name:'ส่งคำขอจองรถ',exact:true}).click();await page.getByRole('article').filter({hasText:'TEST Browser Requester'}).waitFor()
 await visit('coordinator');await page.getByRole('button',{name:'จัดคิว',exact:true}).click();const proposal=page.getByRole('article').filter({hasText:'TEST Browser Requester'});await proposal.getByRole('button',{name:'ตรวจแผนและเวลาว่าง',exact:true}).click();await page.getByRole('button',{name:'ตรวจแล้ว ยืนยันเที่ยวนี้',exact:true}).click();await page.getByRole('status').filter({hasText:'ยืนยันเที่ยวแล้ว'}).waitFor();
 await visit('driver');await page.getByRole('button',{name:'งานคนขับ',exact:true}).click();const trip=page.getByRole('article').filter({hasText:'TEST Browser Requester'});for(const label of ['ออกไปรับ','รับผู้เดินทางแล้ว','ส่งถึงโรงพยาบาลแล้ว','ส่งถึงครบ · รอรับกลับ','ออกไปรับขากลับ','รับกลับแล้ว','ส่งถึงจุดหมายแล้ว','ส่งกลับครบ · จบเที่ยว']){await trip.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).waitFor();}
 await visit('citizen');await page.getByRole('button',{name:'การจองของฉัน',exact:true}).click();assert.match(await page.getByRole('article').filter({hasText:'TEST Browser Requester'}).textContent(),/จบเที่ยวแล้ว/)
 console.log('PASS actual React booking -> coordinator confirmation -> driver individual return -> citizen completed, backed by local PostgreSQL')
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

 for(const width of [320,390,768,1024]){await page.setViewportSize({width,height:900});for(const as of ['citizen','coordinator','driver','admin']){await visit(as);const tab={citizen:'หน้าบริการ',coordinator:'จัดคิว',driver:'งานคนขับ',admin:'ตั้งค่า'}[as];await page.getByRole('button',{name:tab,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width} ${as} overflow`)}console.log(`PASS rendered ${width}px four roles`)}
 if(process.env.PATIENT_PREVIEW_SHOTS){await mkdir(process.env.PATIENT_PREVIEW_SHOTS,{recursive:true});await page.setViewportSize({width:390,height:900});await visit('citizen');await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-booking-live-ui-390.png`,fullPage:true});await visit('coordinator');await page.getByRole('button',{name:'จัดคิว',exact:true}).click();await page.screenshot({path:`${process.env.PATIENT_PREVIEW_SHOTS}/patient-booking-queue-390.png`,fullPage:true})}
 assert.deepEqual(errors,[])
}finally{await browser.close();await server.close();await db.close()}
