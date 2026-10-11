// Real React components with synthetic data. All non-loopback requests are blocked.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { thaiDay } from '../src/lib/patientBooking.js'
const today=thaiDay(), tomorrow=thaiDay(Date.now()+86400000)
const settings={revision:1,enabled:true,partner_id:'fund',driver_id:'driver',coordinator_ids:['admin'],office_start:450,office_end:1050,seats:4,wheelchairs:1,stretchers:1,
 routes:[{id:'a',label:'TEST โรงพยาบาล',zone:'TEST เมือง',minutes:240}],buffer_minutes:90,boarding_minutes:60,contact_phone:'0800000000'}
const community={revision:1,rules_version:1,enabled:true,window_start:360,window_end:1200,places:[{id:'temple',label:'TEST วัด',minutes:240}],activities:[{code:'meet',label:'TEST กิจกรรม'}],rules_reference:'TEST ข้อบังคับสมมติ',privacy_notice:'TEST ข้อมูลชุมชน',consent_version:'community-booking-v1'}
const info={...settings,booking_mode:true,scheduling_mode:'manual',privacy_notice:'TEST ข้อมูล',consent_version:'patient-booking-v1',owner_name:'TEST กองทุน',community}
const rider={id:'rider',created_by:'citizen',patient_name:'TEST ผู้เดินทาง',requester_name:'TEST ผู้ขอ',phone:'0800000001',relation:'self',in_area:true,pickup:'TEST จุดรับ',mobility:'walk',companions:0,share:true,route_id:'a',route_label:'TEST โรงพยาบาล',appointment_at:`${today}T12:00:00+07:00`,return_at:`${today}T17:30:00+07:00`,return_mode:'wait',status:'confirmed',trip_id:'trip',revision:1,passenger_step:0,service_type:'patient'}
const trip={id:'trip',booking_ids:['rider'],driver_id:'driver',driver_name:'TEST คนขับ',state:'confirmed',revision:1,docs_revision:1,schedule_revision:1,public_notice:'normal',
 plan:{date:today,route_id:'a',route_label:'TEST โรงพยาบาล',appointment_at:rider.appointment_at,return_at:rider.return_at,return_mode:'wait',service_type:'patient',pickup_at:`${today}T06:00:00+07:00`,blocks:[{start:`${today}T00:00:00+07:00`,end:`${today}T23:59:00+07:00`}],outbound_waves:[{appointment_start:rider.appointment_at,appointment_end:rider.appointment_at,pickup_at:`${today}T06:00:00+07:00`}],errors:[]}}
const workspace={role:'admin',settings,community_rules:community,partners:[{id:'fund',name:'TEST กองทุน'}],people:[{id:'admin',name:'TEST ผู้ดูแล'},{id:'driver',name:'TEST คนขับ'}],bookings:[rider],trips:[trip],events:[],odometer:{failed:false,days:[],previous:null}}
const plugin={name:'manual-dispatch-ui',enforce:'pre',resolveId(id){if(id==='/__manual.js')return '\0manual-entry'},load(id){
 const file=id.replaceAll('\\','/')
 if(file.endsWith('/contexts/TenantContext.jsx'))return "export const useTenant=()=>({tenant:{id:'test',name:'อบต. TEST'}})"
 if(file.endsWith('/lib/supabase.js'))return `export const supabase={rpc:async(name,args)=>{if(name==='patient_booking_calendar'){const days=[];for(let at=Date.parse(args.p_from+'T12:00:00+07:00');at<=Date.parse(args.p_to+'T12:00:00+07:00');at+=86400000){const date=new Date(at+7*3600000).toISOString().slice(0,10);days.push({date,status:'open',trips:[],free:[],community_free:[]})}return{data:{scheduling_mode:'manual',days}}}return{data:{events:[],items:[],days:[]}}},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,then:resolve=>resolve({data:[],error:null})};return q}}`
 if(id==='\0manual-entry')return `import React from 'react';import{createRoot}from'react-dom/client';import Settings from '/src/components/patientTransport/BookingSettings.jsx';import Community from '/src/components/patientTransport/CommunitySettings.jsx';import Inbox from '/src/components/patientTransport/BookingInbox.jsx';import Calendar from '/src/components/patientTransport/StaffBookingCalendar.jsx';import Form from '/src/components/patientTransport/BookingForm.jsx';import{DriverTrips,BookingCards}from'/src/components/patientTransport/BookingOperations.jsx';import'/src/index.css';const ws=${JSON.stringify(workspace)},info=${JSON.stringify(info)};window.saved=[];window.confirmCalls=0;window.advanceCalls=0;const mode=location.hash.slice(1);const no=()=>{};function App(){if(mode==='settings')return React.createElement(Settings,{workspace:ws,onSave:(revision,payload)=>window.saved.push(payload)});if(mode==='community')return React.createElement(Community,{rules:ws.community_rules,onSave:(revision,payload)=>{window.saved.push(payload);return true}});if(mode==='driver')return React.createElement(DriverTrips,{workspace:ws,uid:'driver',contactPhone:'0800000000',onAdvance:()=>{window.advanceCalls++},onAction:no,onOdometer:no,onReassign:no});if(mode==='calendar')return React.createElement(Calendar,{workspace:ws,onOpenBooking:no});if(mode==='citizen')return React.createElement(BookingCards,{bookings:ws.bookings,trips:ws.trips,onAction:no});if(mode==='form')return React.createElement(Form,{tenantId:'test',info,onBack:no,onSubmit:no});const pending={...ws.bookings[0],status:'submitted',trip_id:null};return React.createElement(Inbox,{workspace:{...ws,bookings:[pending]},currentUserId:'admin',isAdmin:true,onConfirm:async()=>{window.confirmCalls++;return{ids:['rider'],plan:{errors:[]},confirmed:true}},onJoin:no,onAction:no,onDelete:no,onAmend:no,onReload:no,onSettings:no})}createRoot(document.getElementById('root')).render(React.createElement('main',{className:'mx-auto max-w-5xl bg-slate-50 text-slate-900 p-3'},React.createElement(App)));`
},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]==='/__manual'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__manual.js"></script></body></html>'))}else next()})}}
const server=await createServer({configFile:false,envDir:false,logLevel:'error',plugins:[plugin,react(),tailwind()],server:{host:'127.0.0.1',port:0}})
await server.listen(); const browser=await chromium.launch({channel:'chrome',headless:true}), base=`http://127.0.0.1:${server.httpServer.address().port}/__manual`
await mkdir(new URL('../tmp/manual-dispatch-ui/',import.meta.url),{recursive:true})
try {
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:960}}), errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  for(const mode of ['settings','community','driver','calendar','citizen','form','inbox']){
   await page.goto(`${base}?screen=${mode}#${mode}`);await page.locator('main').waitFor();await page.waitForFunction(()=>document.querySelector('main')?.innerText.length>50)
   const text=await page.locator('body').innerText()
   assert.doesNotMatch(text,/นาทีต่อขา|เวลาเดินทาง \(นาที\)|เวลาเผื่อก่อนนัด|06:00/)
   if(['driver','calendar','citizen'].includes(mode))assert.match(text,/รอประสานเวลารับ/)
   if(['driver','calendar'].includes(mode))assert.match(text,/นัด.*12:00/,'appointment must remain visible separately from pickup')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${mode} ${width}px overflow`)
   if(mode==='settings'){
    await page.getByRole('button',{name:'บันทึกการตั้งค่า'}).click()
    const payload=await page.evaluate(()=>window.saved[0]);assert.ok(payload);assert.ok(!('minutes'in payload.routes[0]));assert.ok(!('buffer_minutes'in payload));assert.ok(!('boarding_minutes'in payload))
   }
   if(mode==='community'){
    await page.getByRole('button',{name:'บันทึกกฎบริการชุมชน'}).click();const payload=await page.evaluate(()=>window.saved[0]);assert.ok(payload);assert.ok(!('minutes'in payload.places[0]))
   }
   if(mode==='form'){
    const day=page.locator(`[data-calendar-date="${tomorrow}"]`);await day.waitFor();await day.click();assert.ok(await page.getByRole('group',{name:'เวลานัดแพทย์'}).getByRole('button').count()>20,'no free intervals must not hide appointment times')
   }
   if(mode==='inbox'){
    const confirm=page.getByRole('button',{name:/^ยืนยันรถ/}).first()
    page.once('dialog',d=>d.dismiss());await confirm.click();assert.equal(await page.evaluate(()=>window.confirmCalls),0)
    page.once('dialog',d=>d.accept());await confirm.click();assert.equal(await page.evaluate(()=>window.confirmCalls),1)
   }
   await page.screenshot({path:new URL(`../tmp/manual-dispatch-ui/${mode}-${width}.png`,import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true})
  }
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS manual dispatch ${width}px: settings save without durations, no invented pickup, open intake, confirmation guard, no overflow`)
 }
}finally{await browser.close();await server.close()}
