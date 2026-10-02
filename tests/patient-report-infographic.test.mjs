// หน้ารายงานจริง + ภาพ PNG จริง แยกจากฐานข้อมูล; ทุก request นอก loopback ถูกบล็อก
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { REPORT_MODES } from '../src/lib/patientReportPeriod.js'

const artifactDir = process.env.PATIENT_REPORT_ARTIFACTS || 'D:/tmp/patient-report-infographic-shots'
await mkdir(artifactDir, { recursive: true })
const agency = 'องค์การบริหารส่วนตำบลตัวอย่างเพื่อทดสอบรายงาน'
const secret = { patient_name: 'TEST_PRIVATE_NAME', phone: '0899999999', pickup: 'TEST_PRIVATE_ADDRESS', pickup_lat: 18.123, pickup_lng: 100.123 }
const trip = (id, state, route_label, passengers, distance, companions = 0) => ({ trip_id: id, state, route_label, passengers, distance, companions, date: '2026-01-10', pickup_at: '2026-01-10T08:00:00+07:00', driver_name: 'TEST Driver', ...secret })
const fixtures = {
 '2026-01': [trip('a1111111','completed','โรงพยาบาลตัวอย่าง ก',2,15,1),trip('a2222222','completed','โรงพยาบาลตัวอย่าง ก',1,null),trip('b1111111','confirmed','โรงพยาบาลตัวอย่าง ข',1,null),trip('c1111111','issue','ศูนย์ฟอกไตตัวอย่าง',1,null)],
 '2026-02': [trip('d1111111','completed','โรงพยาบาลตัวอย่างเดือนใหม่ที่มีชื่อยาวสำหรับตรวจว่าข้อความในภาพไม่ถูกตัด',1,5)],
 '2026-04': Array.from({length:10},(_,i)=>trip(`other${i}`,'completed',`โรงพยาบาลลำดับ ${i+1}`,1,1)),
}
for(const [month,rows] of Object.entries(fixtures))for(const row of rows){row.date=month+'-10';row.pickup_at=month+'-10T08:00:00+07:00'}
const plugin = {
 name:'isolated-patient-report',enforce:'pre',
 resolveId(id){if(id==='/__report_entry.js')return '\0report-entry.js'},
 load(id){
  if(id==='\0report-entry.js')return `import React from 'react';import {createRoot} from 'react-dom/client';import {QueueReport} from '/src/components/patientTransport/BookingOperations.jsx';import '/src/index.css';
   window.__reportFixtures=${JSON.stringify(fixtures)};window.__prints=[];
   createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement('div',{style:{maxWidth:1100,margin:'0 auto',padding:12,background:'#edf2f7',color:'#16324f'}},React.createElement(QueueReport,{workspace:{trips:[],bookings:[]},busy:false,onPeriodReport:period=>window.__prints.push(period)}))));`
  const normalized=id.replaceAll('\\','/')
  if(normalized.endsWith('/contexts/TenantContext.jsx'))return `export const useTenant=()=>({tenant:{id:'test-tenant',name:${JSON.stringify(agency)}}})`
  if(normalized.endsWith('/lib/supabase.js'))return `export const supabase={rpc:async(name,args)=>{
   if(name==='patient_booking_period_report'){window.__requests=(window.__requests||[]).concat(args);if(window.__rpcReject)throw new Error('TEST network rejection');if(window.__rpcFail)return {data:null,error:{message:'TEST fail'}};if(window.__delay)await new Promise(r=>setTimeout(r,window.__delay));return {data:{from:args.p_from,to:args.p_to,trips:Object.values(window.__reportFixtures).flat().filter(t=>t.date>=args.p_from&&t.date<=args.p_to)},error:null}};
   if(name==='patient_booking_events_page')return {data:{total:0,page:1,events:[]},error:null};
   throw new Error('Unexpected RPC '+name)
  }};`
 },
 configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url!=='/__report')return next()
  res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__report_entry.js"></script></body></html>'))
 })},
}
const server=await createServer({configFile:false,plugins:[plugin,react(),tailwind()],server:{host:'127.0.0.1',port:0},logLevel:'error'})
await server.listen()
const base=`http://127.0.0.1:${server.httpServer.address().port}`
const browser=await chromium.launch({channel:'msedge',headless:true})
const context=await browser.newContext({viewport:{width:320,height:900},locale:'th-TH',acceptDownloads:true,serviceWorkers:'block'})
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort())
const page=await context.newPage();const errors=[]
page.on('pageerror',e=>{errors.push(e.message);console.error('Browser:',e.message)});page.setDefaultTimeout(15000)
await page.addInitScript(()=>{
 window.__drawn=[];window.__shares=[];window.__shareMode='ok';window.__failImage=false
 const fillText=CanvasRenderingContext2D.prototype.fillText
 CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){window.__drawn.push({text,x,y,width:this.measureText(text).width,height:this.canvas.height,canvasWidth:this.canvas.width,font:this.font});return fillText.call(this,text,x,y,...rest)}
 const toBlob=HTMLCanvasElement.prototype.toBlob
 HTMLCanvasElement.prototype.toBlob=function(callback,...rest){if(window.__failImage)callback(null);else toBlob.call(this,callback,...rest)}
 Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>window.__shareMode!=='unsupported'&&files.length===1&&files[0].type==='image/png'})
 Object.defineProperty(navigator,'share',{configurable:true,value:async({files,title,text})=>{
  if(window.__shareMode==='abort')throw new DOMException('Dismissed','AbortError')
  window.__shares.push({name:files[0].name,size:files[0].size,type:files[0].type,title,text,activation:navigator.userActivation.isActive})
 }})
})
try{
 await page.goto(`${base}/__report`)
 const report=page.getByRole('region',{name:'สรุปการใช้รถตามช่วงเวลา',exact:true})
 const selectMonth=async value=>{await report.getByLabel('ปี พ.ศ.',{exact:true}).selectOption(String(Number(value.slice(0,4))+543));await report.getByLabel('เดือน',{exact:true}).selectOption(value.slice(5,7))}
 const download=report.getByRole('button',{name:'ดาวน์โหลดอินโฟกราฟิก PNG',exact:true})
 const share=report.getByRole('button',{name:'แชร์อินโฟกราฟิก',exact:true})
 const ready=()=>page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('ดาวน์โหลดอินโฟกราฟิก PNG'));return button&&!button.disabled})
 await selectMonth('2026-01');await ready()
 assert.equal(await report.getByLabel('ปี พ.ศ.',{exact:true}).inputValue(),'2569')
 assert.equal(await report.getByLabel('เดือน',{exact:true}).locator('option:checked').innerText(),'มกราคม')
 // Changing only the Buddhist year must fetch that year and preserve the selected month.
 await report.getByLabel('ปี พ.ศ.',{exact:true}).selectOption('2570');await ready()
 assert.match(await report.innerText(),/มกราคม 2570/)
 assert.deepEqual((await page.evaluate(()=>window.__requests.at(-1))),{p_muni:'test-tenant',p_from:'2027-01-01',p_to:'2027-01-31'})
 await report.getByLabel('ปี พ.ศ.',{exact:true}).selectOption('2569');await ready()
 const infographic=page.getByRole('region',{name:'อินโฟกราฟิกสรุปรถรับส่งผู้ป่วย',exact:true})
 const pie=page.getByRole('region',{name:'กราฟวงกลมเที่ยวรถแยกตามโรงพยาบาล',exact:true})
 assert.equal(await pie.locator('[data-pie-hospital]').count(),3)
 await pie.locator('[data-pie-legend="โรงพยาบาลตัวอย่าง ก"]').getByText('2 เที่ยว · 50%',{exact:true}).waitFor()
 await pie.locator('[data-pie-legend="โรงพยาบาลตัวอย่าง ข"]').getByText('1 เที่ยว · 25%',{exact:true}).waitFor()
 const graph=page.getByRole('region',{name:'กราฟแท่งเที่ยวรถแยกตามโรงพยาบาล',exact:true})
 assert.equal(await graph.locator('[data-report-hospital]').count(),3)
 await graph.getByRole('img',{name:'โรงพยาบาลตัวอย่าง ก: จบ 2 เที่ยว ยังไม่จบ 0 เที่ยว',exact:true}).waitFor()
 await graph.getByRole('img',{name:'โรงพยาบาลตัวอย่าง ข: จบ 0 เที่ยว ยังไม่จบ 1 เที่ยว',exact:true}).waitFor()
 assert.match(await infographic.locator('[data-report-summary="จบเที่ยวแล้ว"]').innerText(),/2 เที่ยว/)
 assert.match(await infographic.locator('[data-report-summary="เที่ยวที่ยังไม่จบ"]').innerText(),/2 เที่ยว/)
 assert.match(await infographic.locator('[data-report-summary="ให้บริการผู้เดินทาง"]').innerText(),/3 ครั้ง/)
 assert.match(await infographic.locator('[data-report-summary="ระยะทางที่บันทึกแล้ว"]').innerText(),/15 กม\./)
 assert.match(await infographic.innerText(),/ยังไม่มีระยะทางที่ใช้ได้ 1 เที่ยว/)
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1100})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`graph ${width}px overflow`)
  const modes=report.getByRole('group',{name:'ประเภทรายงาน',exact:true}).getByRole('button')
  assert.equal(await modes.count(),4)
  assert.equal(await report.getByRole('button',{name:'รายเดือน',exact:true}).getAttribute('aria-pressed'),'true')
  for(const button of [download,share,...await modes.all(),report.getByLabel('เดือน',{exact:true}),report.getByLabel('ปี พ.ศ.',{exact:true})]){const box=await button.boundingBox();assert(box.height>=44&&box.x>=0&&box.x+box.width<=width,`${width}px action fully visible`)}
  if([320,1440].includes(width)){
   await page.screenshot({path:`${artifactDir}/report-${width}.png`,fullPage:true})
   await report.locator('form').screenshot({path:`${artifactDir}/report-controls-${width}.png`})
  }
 }
 const downloadPromise=page.waitForEvent('download');await download.click();const saved=await downloadPromise
 assert.equal(saved.suggestedFilename(),'patient-transport-2026-01.png')
 await saved.saveAs(`${artifactDir}/infographic-2026-01.png`)
 const png=await readFile(`${artifactDir}/infographic-2026-01.png`)
 assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1080);assert(png.readUInt32BE(20)>1000)
 await share.click()
 let shared=await page.evaluate(()=>window.__shares.at(-1))
 assert.equal(shared.name,'patient-transport-2026-01.png');assert.equal(shared.type,'image/png');assert(shared.size>10000);assert(shared.activation,'native share must retain the click activation')
 assert.match(shared.text,/จบเที่ยวแล้ว: 2 เที่ยว/);assert.match(shared.text,/ให้บริการผู้เดินทาง: 3 ครั้ง/);assert.match(shared.text,/15 กม\./);assert.match(shared.text,/ยังไม่มีระยะทางที่ใช้ได้ 1 เที่ยว/)
 assert.match(shared.text,/โรงพยาบาลตัวอย่าง ก: จบ 2 เที่ยว/)
 assert.match(shared.text,/โรงพยาบาลตัวอย่าง ก: 2 เที่ยว \(50%\)/)
 assert.match(shared.text,/โรงพยาบาลตัวอย่าง ข: 1 เที่ยว \(25%\)/)
 assert(!shared.text.includes('TEST_PRIVATE'));assert(!shared.text.includes(secret.phone));assert(!shared.text.includes('18.123'));assert(!shared.text.includes('a1111111'))
 const drawn=await page.evaluate(()=>window.__drawn)
 assert(drawn.some(row=>row.text===agency),'agency in PNG');assert(drawn.some(row=>row.text==='3 ครั้ง'),'same service count in PNG')
 assert(drawn.some(row=>row.text==='สัดส่วนเที่ยวรถแยกตามโรงพยาบาล'),'pie title in PNG')
 assert(drawn.some(row=>row.text==='2 เที่ยว · 50%'),'same hospital proportion in PNG')
 assert(drawn.every(row=>row.x>=0&&row.x+row.width<=row.canvasWidth+1&&row.y+8<row.height),'every PNG text fits the canvas')
 assert(!drawn.some(row=>row.text.includes('TEST_PRIVATE')||row.text.includes(secret.phone)),'PNG contains no patient identifiers')
 // เปลี่ยนเดือนแล้วต้องเตรียมไฟล์ใหม่ ข้อความแชร์และกราฟต้องเป็นเดือนเดียวกัน
 await selectMonth('2026-02');await ready();await share.click()
 shared=await page.evaluate(()=>window.__shares.at(-1))
 assert.equal(shared.name,'patient-transport-2026-02.png');assert.match(shared.text,/กุมภาพันธ์ 2569/);assert.match(shared.text,/5 กม\./);assert(!shared.text.includes('15 กม.'))
 assert.equal(await pie.locator('circle[data-pie-hospital]').count(),1,'single hospital must render a full circle')
 await pie.locator('[data-pie-legend]').getByText('1 เที่ยว · 100%',{exact:true}).waitFor()
 const newDownloadPromise=page.waitForEvent('download');await download.click();await(await newDownloadPromise).saveAs(`${artifactDir}/infographic-long-hospital.png`)
 // รวมโรงพยาบาลส่วนที่เกินเป็นกลุ่มอื่น โดยไม่ทำยอดหาย
 await selectMonth('2026-04');await ready()
 assert.equal(await graph.locator('[data-report-hospital]').count(),8)
 assert.equal(await pie.locator('[data-pie-hospital]').count(),8)
 await pie.locator('[data-pie-legend="อื่น ๆ (รวม 3 โรงพยาบาล)"]').getByText('3 เที่ยว · 30%',{exact:true}).waitFor()
 await graph.getByRole('img',{name:'อื่น ๆ (รวม 3 โรงพยาบาล): จบ 3 เที่ยว ยังไม่จบ 0 เที่ยว',exact:true}).waitFor()
 assert.match(await infographic.locator('[data-report-summary="จบเที่ยวแล้ว"]').innerText(),/10 เที่ยว/)
 await share.click();assert.match((await page.evaluate(()=>window.__shares.at(-1))).text,/แสดง 7 โรงพยาบาล/)
 const manyDownloadPromise=page.waitForEvent('download');await download.click();await(await manyDownloadPromise).saveAs(`${artifactDir}/infographic-many-hospitals.png`)
 // เดือนว่างไม่สร้างแท่งหรือยอดหลอก และยังดาวน์โหลดได้
 await selectMonth('2026-03');await ready()
 assert.equal(await pie.locator('[data-pie-hospital]').count(),0,'empty month must not fabricate a pie')
 assert.equal(await graph.getByRole('img').count(),0);await graph.getByText('ไม่มีเที่ยวรถในช่วงที่เลือก').waitFor()
 await share.click();assert.match((await page.evaluate(()=>window.__shares.at(-1))).text,/เที่ยวทั้งหมด 0 เที่ยว/)
 await page.evaluate(()=>{window.__shareMode='unsupported'});await share.click()
 await page.getByRole('status').filter({hasText:'เครื่องนี้ไม่รองรับแชร์ภาพโดยตรง'}).waitFor();assert.equal(await download.isEnabled(),true)
 await page.evaluate(()=>{window.__shareMode='abort'});await share.click();assert.equal(await page.getByText('เปิดเมนูแชร์ไม่สำเร็จ',{exact:false}).count(),0)
 // ภาพล้มเหลวมี retry และไม่ให้กดแชร์ไฟล์เดือนก่อน
 await page.evaluate(()=>{window.__failImage=true});await selectMonth('2026-05')
 await page.getByRole('alert').filter({hasText:'เตรียมภาพไม่สำเร็จ'}).waitFor();assert.equal(await download.isDisabled(),true)
 await page.evaluate(()=>{window.__failImage=false});await page.getByRole('button',{name:'ลองเตรียมภาพใหม่'}).click();await ready()
 await report.getByRole('button',{name:'พิมพ์สรุป',exact:true}).click();assert.deepEqual((await page.evaluate(()=>window.__prints)).map(p=>[p.mode,p.from,p.to]),[['month','2026-05-01','2026-05-31']])
 // All period controls, graph/share and print must use exactly the same range.
 await page.evaluate(()=>{window.__shareMode='ok'})
 const mode=value=>report.getByRole('button',{name:REPORT_MODES[value],exact:true}).click(),print=report.getByRole('button',{name:'พิมพ์สรุป',exact:true})
 await mode('quarter');await report.getByLabel('ปี พ.ศ.',{exact:true}).selectOption('2569');await report.getByLabel('ไตรมาส',{exact:true}).selectOption('2');await ready()
 await report.getByRole('heading',{name:'รายการเที่ยวช่วงนี้ · 5 เที่ยว',exact:true}).waitFor()
 await print.click();await share.click();shared=await page.evaluate(()=>window.__shares.at(-1))
 assert.equal(shared.name,'patient-transport-2026-01-01_2026-03-31.png');assert.match(shared.text,/ไตรมาส 2 · ปีงบประมาณ 2569/);assert.match(shared.text,/20 กม\./)
 await report.getByLabel('การนับปี').selectOption('calendar');await report.getByLabel('ไตรมาส',{exact:true}).selectOption('1');await ready();await share.click()
 assert.match((await page.evaluate(()=>window.__shares.at(-1))).text,/ไตรมาส 1 · ปีปฏิทิน 2569/)
 await mode('year');await ready();await report.getByRole('heading',{name:'รายการเที่ยวช่วงนี้ · 15 เที่ยว',exact:true}).waitFor()
 await print.click();await share.click();shared=await page.evaluate(()=>window.__shares.at(-1))
 assert.equal(shared.name,'patient-transport-2026-01-01_2026-12-31.png');assert.match(shared.text,/ปีปฏิทิน 2569/);assert.match(shared.text,/30 กม\./)
 await report.getByLabel('การนับปี').selectOption('fiscal');await ready();await share.click()
 assert.equal((await page.evaluate(()=>window.__shares.at(-1))).name,'patient-transport-2025-10-01_2026-09-30.png')
 await mode('custom');await report.getByLabel('วันที่เริ่ม',{exact:true}).fill('2026-01-10');await report.getByLabel('วันที่สิ้นสุด',{exact:true}).fill('2026-01-10');await ready()
 await report.getByRole('heading',{name:'รายการเที่ยวช่วงนี้ · 4 เที่ยว',exact:true}).waitFor();await print.click();await share.click()
 assert.equal((await page.evaluate(()=>window.__shares.at(-1))).name,'patient-transport-2026-01-10_2026-01-10.png')
 assert.deepEqual((await page.evaluate(()=>window.__prints)).map(p=>[p.mode,p.from,p.to]),[['month','2026-05-01','2026-05-31'],['quarter','2026-01-01','2026-03-31'],['year','2026-01-01','2026-12-31'],['custom','2026-01-10','2026-01-10']])
 await report.getByLabel('วันที่สิ้นสุด',{exact:true}).fill('2026-01-09')
 await report.getByRole('alert').filter({hasText:'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม'}).waitFor();assert.equal(await print.isDisabled(),true);assert.equal(await report.locator('[data-report-visuals]').count(),0)
 await report.getByLabel('วันที่สิ้นสุด',{exact:true}).fill('2026-01-10');await ready()
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`custom controls ${width}px overflow`)
  const box=await print.boundingBox();assert(box.height>=44&&box.x>=0&&box.x+box.width<=width)
  if([320,1440].includes(width))await page.screenshot({path:`${artifactDir}/period-custom-${width}.png`,fullPage:true})
 }
 // Old delayed responses cannot restore another period's data or PNG.
 await mode('month');await page.evaluate(()=>{window.__delay=300});await selectMonth('2026-01')
 await page.evaluate(()=>{window.__delay=0});await selectMonth('2026-02');await ready();await share.click()
 await page.waitForTimeout(350);assert.equal((await page.evaluate(()=>window.__shares.at(-1))).name,'patient-transport-2026-02.png');assert.match(await infographic.innerText(),/กุมภาพันธ์ 2569/)
 await page.evaluate(()=>{window.__rpcFail=true});await selectMonth('2026-03');await report.getByRole('alert').filter({hasText:'โหลดสรุปช่วงนี้ไม่สำเร็จ'}).waitFor()
 assert.equal(await report.locator('[data-report-summary]').count(),0);assert.equal(await print.isDisabled(),true)
 await page.evaluate(()=>{window.__rpcFail=false});await report.getByRole('button',{name:'ลองอีกครั้ง',exact:true}).click();await ready()
 await page.evaluate(()=>{window.__rpcReject=true});await selectMonth('2026-06');await report.getByRole('alert').filter({hasText:'โหลดสรุปช่วงนี้ไม่สำเร็จ'}).waitFor()
 await page.evaluate(()=>{window.__rpcReject=false});await report.getByRole('button',{name:'ลองอีกครั้ง',exact:true}).click();await ready()
 assert((await page.evaluate(()=>window.__drawn)).every(row=>row.x>=0&&row.x+row.width<=row.canvasWidth+1&&row.y+8<row.height),'all period PNG text fits')
 assert.deepEqual(errors,[])
 console.log('PASS report infographic: 4 visible mode buttons, Thai month/Buddhist year selectors, year-only change, all 4 period modes, fiscal/calendar year and quarter, inclusive single day, hospital bars/pie percentages, 320/390/768/1440px, real PNG, text bounds, no patient identifiers, exact print/share ranges, grouped hospitals, empty period, activation/fallback/cancel, generation retry, stale response exclusion, RPC failure/rejection retry')
 console.log(`Artifacts: ${artifactDir}`)
}finally{await context.close();await browser.close();await server.close()}
