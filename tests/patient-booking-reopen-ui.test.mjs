// Actual staff page, real usePatientBooking and isolated PostgreSQL RPCs.
// Every non-loopback browser request is aborted. No production credentials or data.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'
process.env.REOPEN_UI_QA='1'
const {db,actor,rpc,tenant,admin,coordinator,driver,citizen,owner,row,booking,submit,act}=await import('./patient-booking-reopen.test.mjs')
const root=fileURLToPath(new URL('../',import.meta.url)), shots=path.join(root,'tmp/reopen-ui')
await mkdir(shots,{recursive:true})
const actors={admin,coordinator,driver,citizen}
const signatures={patient_booking_info:['p_muni'],patient_booking_workspace_v2:['p_muni'],patient_booking_odometer_days:['p_muni','p_from','p_to'],
 patient_booking_history:['p_muni','p_booking'],patient_booking_reopen:['p_muni','p_op','p_booking','p_revision','p_reason'],
 patient_booking_preview:['p_muni','p_ids','p_helper'],patient_booking_confirm:['p_muni','p_id','p_ids','p_expected','p_helper']}
let chain=Promise.resolve(), releaseHold=null
const serial=fn=>{const next=chain.then(fn,fn);chain=next.catch(()=>{});return next}
const plugin={name:'isolated-reopen-workflow',enforce:'pre',resolveId(id){if(id==='/__reopen.js')return '\0reopen-entry'},load(id){
 const file=id.replaceAll('\\','/')
 if(file.endsWith('/contexts/TenantContext.jsx'))return `export const useTenant=()=>({tenant:{id:'${tenant}',name:'องค์การบริหารส่วนตำบล TEST',org_type:'อบต.'},isModuleEnabled:()=>true})`
 if(file.endsWith('/contexts/AuthContext.jsx'))return `const ids=${JSON.stringify(actors)};export const useAuth=()=>({session:{user:{id:ids[new URLSearchParams(location.search).get('as')||'coordinator']}},profileName:'TEST เจ้าหน้าที่'})`
 if(file.endsWith('/lib/supabase.js'))return `export const supabase={rpc:async(name,args)=>{
   let fault='';if(name==='patient_booking_reopen'){window.__sent??=[];window.__sent.push(args);fault=window.__fault||'';window.__fault='';}
   return fetch('/__reopen_rpc',{method:'POST',body:JSON.stringify({name,args,as:new URLSearchParams(location.search).get('as')||'coordinator',fault})}).then(r=>r.json());
  },from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,then:resolve=>resolve({data:[],error:null})};return q}}`
 if(id==='\0reopen-entry')return "import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Staff from'/src/pages/PatientTransportStaff.jsx';import'/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement('main',{className:'text-slate-900'},React.createElement(Staff))));"
},configureServer(server){server.middlewares.use(async(req,res,next)=>{
 if(req.url?.split('?')[0]==='/__reopen'){
  res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__reopen.js"></script></body></html>'));return
 }
 if(req.url!=='/__reopen_rpc')return next()
 const chunks=[];for await(const c of req)chunks.push(c)
 const request=JSON.parse(Buffer.concat(chunks).toString())
 if(request.fault==='hold')await new Promise(resolve=>releaseHold=resolve)
 const response=await serial(async()=>{
  try{
   const signature=signatures[request.name];if(!signature||!actors[request.as])throw Error('Test API denied')
   if(request.fault==='refuse')throw Error('TEST บันทึกไม่สำเร็จ')
   await actor(actors[request.as]);const data=await rpc(request.name,signature.map(k=>request.args[k]??(k==='p_helper'?'':null)))
   if(request.fault==='lost')throw Error('TEST ผลตอบกลับหาย กรุณาลองใหม่ด้วยรายการเดิม')
   return{data,error:null}
  }catch(e){return{data:null,error:{message:e.message,code:e.code||'TEST'}}}
 })
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response))
})}}
const cacheDir=await mkdtemp(path.join(tmpdir(),'patient-reopen-ui-'))
const server=await createServer({root,configFile:false,envDir:false,cacheDir,plugins:[plugin,react(),tailwind()],logLevel:'error',server:{host:'127.0.0.1',port:0}})
await server.listen()
const base=`http://127.0.0.1:${server.httpServer.address().port}/__reopen`
const browser=await chromium.launch({channel:'chrome'})
const future=new Date(Date.now()+100*86400000).toISOString().slice(0,10)
const make=async(label,changes={})=>serial(async()=>{
 const bid=await submit(`UI คืน ${label} ${Math.random()}`,'10:15',{appointment_at:`${future}T10:15:00+07:00`,return_at:`${future}T17:30:00+07:00`,share:false})
 await act(bid)
 if(Object.keys(changes).length)await owner(()=>db.query('UPDATE public.patient_bookings SET '+Object.keys(changes).map((k,i)=>`${k}=$${i+2}`).join(',')+' WHERE id=$1',[bid,...Object.values(changes)]))
 return bid
})
try{
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:960}})
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  const detail=page.getByRole('dialog'),panel=detail.getByRole('region',{name:'คืนรายการที่ยกเลิก'})
  const launch=panel.getByRole('button',{name:'คืนรายการเป็นรอยืนยันรถ',exact:true}),reason=panel.getByRole('textbox',{name:'เหตุผลการคืนรายการ (บันทึกในประวัติ)'})
  const restore=panel.getByRole('button',{name:'ยืนยันคืนรายการ',exact:true})
  async function visit(bid,as='coordinator'){
   await page.goto(`${base}?as=${as}`);await page.getByRole('navigation',{name:'งานรถรับส่งผู้ป่วย'}).waitFor()
   await page.getByRole('group',{name:'กรองคำขอรถ'}).getByRole('button',{name:/^ยกเลิก/}).click()
   await page.getByRole('textbox',{name:'ค้นหาชื่อ เบอร์ จุดรับ โรงพยาบาล เลขที่',exact:true}).fill(bid.slice(0,8))
   const r=page.locator(`[data-booking="${bid}"]:visible`);await r.getByRole('button',{name:'ดูรายละเอียด',exact:true}).click();await detail.waitFor()
  }
  async function agree(button=restore){let text='';page.once('dialog',async d=>{text=d.message();await d.accept()});await button.click();return text}
  async function queued(bid){
   await panel.waitFor({state:'detached'});await detail.getByRole('button',{name:/^ยืนยันรถ/}).first().waitFor()
   assert.equal((await serial(()=>booking(bid))).status,'submitted')
  }
  const bid=await make(`ปกติ ${width}`)
  await visit(bid)
  const bounds=await launch.boundingBox();assert.ok(bounds.height>=44&&bounds.y>=0&&bounds.y+bounds.height<960&&bounds.x>=0&&bounds.x+bounds.width<=width,JSON.stringify(bounds))
  await page.screenshot({path:path.join(shots,`cancelled-${width}.png`)})
  await launch.click();assert.equal(await restore.isDisabled(),true)
  await reason.fill('   ');assert.equal(await restore.isDisabled(),true)
  await reason.fill('TEST ประสานผู้ป่วยแล้ว ต้องการเดินทางต่อ')
  page.once('dialog',d=>d.dismiss());await restore.click();assert.equal(await page.evaluate(()=>window.__sent?.length||0),0)
  await panel.getByRole('button',{name:'ยังไม่คืนรายการ',exact:true}).click();await launch.click()
  assert.equal(await reason.inputValue(),'TEST ประสานผู้ป่วยแล้ว ต้องการเดินทางต่อ')
  await page.screenshot({path:path.join(shots,`reason-${width}.png`)})
  const message=await agree();assert.ok(message.includes('ต้องยืนยันรถใหม่')&&message.includes('TEST ประสานผู้ป่วยแล้ว'))
  await queued(bid)
  const [sent]=await page.evaluate(()=>window.__sent)
  assert.equal(sent.p_booking,bid);assert.equal(sent.p_muni,tenant);assert.ok(sent.p_op)
  // Real page uses the normal confirmation workflow; restore did not reserve a vehicle.
  await agree(detail.getByRole('button',{name:/^ยืนยันรถ/}).first())
  await page.waitForFunction(()=>document.querySelector('[role="status"]')?.innerText.includes('ยืนยันรถแล้ว'))
  assert.equal((await serial(()=>booking(bid))).status,'confirmed')
  console.log(`PASS ${width}px actual staff page: cancelled -> reopen with reason/confirmation -> submitted -> confirm new trip; no extra data entry`)

  const retry=await make(`ตอบกลับหาย ${width}`);await visit(retry);await launch.click();await reason.fill('TEST ตอบกลับหาย')
  await page.evaluate(()=>window.__fault='lost');await agree()
  await detail.getByRole('alert').filter({hasText:'TEST ผลตอบกลับหาย'}).waitFor()
  assert.equal(await reason.inputValue(),'TEST ตอบกลับหาย')
  const recorded=await serial(()=>row("SELECT count(*)::int n FROM public.patient_booking_events WHERE entity_id=$1 AND action='reopened'",[retry]))
  assert.equal(recorded.n,1)
  await agree();await queued(retry)
  const requests=await page.evaluate(()=>window.__sent);assert.deepEqual(requests[0],requests[1],'lost response retry reuses the operation and revision')
  assert.equal((await serial(()=>row("SELECT count(*)::int n FROM public.patient_booking_events WHERE entity_id=$1 AND action='reopened'",[retry]))).n,1)

  const stale=await make(`ข้อมูลเปลี่ยน ${width}`);await visit(stale);await launch.click();await reason.fill('TEST ตรวจข้อมูลใหม่')
  await serial(()=>owner(()=>db.query('UPDATE public.patient_bookings SET revision=revision+1 WHERE id=$1',[stale])))
  await agree();await panel.getByRole('alert').filter({hasText:'คำขอเปลี่ยนแล้ว'}).waitFor();assert.equal(await restore.isDisabled(),true)
  assert.equal(await reason.inputValue(),'TEST ตรวจข้อมูลใหม่')
  await panel.getByRole('button',{name:'ตรวจแล้ว ใช้ข้อมูลล่าสุด',exact:true}).click();await agree();await queued(stale)

  const failed=await make(`ล้มเหลว ${width}`);await visit(failed);await launch.click();await reason.fill('TEST ลองใหม่')
  await page.evaluate(()=>window.__fault='refuse');await agree();await detail.getByRole('alert').filter({hasText:'TEST บันทึกไม่สำเร็จ'}).waitFor()
  assert.equal((await serial(()=>booking(failed))).status,'cancelled');assert.equal(await reason.inputValue(),'TEST ลองใหม่')
  await page.evaluate(()=>window.__fault='hold');await agree()
  for(let n=0;!releaseHold&&n<50;n++)await new Promise(resolve=>setTimeout(resolve,20))
  assert.ok(releaseHold);assert.equal(await restore.isDisabled(),true);assert.equal(await launch.isDisabled(),true)
  releaseHold();releaseHold=null;await queued(failed)
  console.log(`PASS ${width}px lost response/idempotent retry, stale revision with explicit review, failure preserves draft and busy blocks repeat`)

  const past=await make(`วันนัดผ่าน ${width}`,{appointment_at:'2025-01-02T10:15:00+07:00',return_at:'2025-01-02T17:30:00+07:00'})
  await visit(past);await launch.click();await panel.getByText('วันนัดเดิมผ่านมาแล้ว',{exact:false}).waitFor();await reason.fill('TEST เลือกวันใหม่หลังคืน')
  await agree();await queued(past)
  for(const changes of [{passenger_step:2},{contact_purged_at:new Date().toISOString()}]){
   const blocked=await make(`ห้ามคืน ${width}`,changes);await visit(blocked)
   assert.equal(await launch.isDisabled(),true);assert.equal(await reason.count(),0)
  }
  for(const as of ['driver','citizen']){
   await page.goto(`${base}?as=${as}`);await page.waitForFunction(()=>document.body.innerText.length>50)
   assert.equal(await page.getByRole('button',{name:'คืนรายการเป็นรอยืนยันรถ',exact:true}).count(),0)
  }
  const community=await serial(()=>row("SELECT id FROM public.patient_bookings WHERE service_type='community' AND status='cancelled' LIMIT 1"))
  await visit(community.id);assert.equal(await panel.count(),0,'patient restore must not appear for community requests')
  const adminCase=await make(`แอดมิน ${width}`);await visit(adminCase,'admin');assert.equal(await launch.isEnabled(),true)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[])
  console.log(`PASS ${width}px past appointment warning, partial/purged records blocked, driver/citizen hidden, admin enabled, no overflow/errors`)
  await context.close()
 }
}finally{if(releaseHold)releaseHold();await browser.close();await server.close();await chain;await db.close()}
