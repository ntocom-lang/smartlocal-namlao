import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { thaiDay, bookingTimingAdvice, normalizeBookingPhone } from '../src/lib/patientBooking.js'

const day = thaiDay(Date.now() + 10 * 86400000)
const info = { routes: [{ id: 'r', label: 'โรงพยาบาล TEST', minutes: 60 }], office_start: 510, office_end: 990, buffer_minutes: 15, boarding_minutes: 15, min_lead_days: 0, contact_phone: '050000000', privacy_notice: 'TEST ข้อความใช้ข้อมูล', owner_name: 'TEST กองทุน', consent_version: 'patient-booking-v1' }
assert.equal(normalizeBookingPhone('+66 89-000-0000'), '0890000000')
assert.equal(normalizeBookingPhone('๐๘๙ ๐๐๐ ๐๐๐๐'), '0890000000')
assert.equal(normalizeBookingPhone('123'), '123')
assert.equal(normalizeBookingPhone('089abc0000000'), '089abc0000000')
const advice = bookingTimingAdvice({ route_id:'r', return_mode:'wait' }, info)
assert.equal(advice.earliest, 600);assert.equal(advice.latest, 900)
assert.equal(bookingTimingAdvice({route_id:'r',return_mode:'one_way'},info).latest,915)
assert.equal(bookingTimingAdvice({route_id:'missing'},info),null)
assert.equal(bookingTimingAdvice({route_id:'r'},{...info,office_end:550}).possible,false)
const server = await createServer({ configFile: false, envDir: false, server: { host: '127.0.0.1', port: 0 }, plugins: [react(), tailwindcss(), {
  name: 'isolated-booking-form-guidance', enforce: 'pre',
  resolveId(id) { if (id === '/__guidance.js') return '\0guidance.js' },
  load(id) {
    const file = id.replaceAll('\\', '/')
    if (id === '\0guidance.js') return `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import Form from '/src/components/patientTransport/BookingForm.jsx'; import '/src/index.css'; function App(){const [error,setError]=useState(''); return React.createElement(Form,{tenantId:"test",initial:{day:${JSON.stringify(day)}},info:${JSON.stringify(info)},onBack:()=>{},onSubmit:()=>{setError('เครือข่ายขัดข้อง');return false},submitError:error})};createRoot(document.getElementById('root')).render(React.createElement(App));`
    if (file.endsWith('/lib/supabase.js')) return `export const supabase={rpc:async(name,args)=>{const days=[];const to=new Date(args.p_to+'T12:00:00+07:00').getTime();for(let t=new Date(args.p_from+'T12:00:00+07:00').getTime();t<=to&&days.length<60;t+=86400000){days.push({date:new Date(t+7*3600000).toISOString().slice(0,10),status:'open',free:[],trips:[]})}return {data:{days}}}}`
    if (file.endsWith('/contexts/TenantContext.jsx')) return 'export const useTenant=()=>({tenant:{}})'
    if (file.endsWith('/components/MapPicker.jsx')) return 'export default function MapPicker(){return null}'
  },
  configureServer(s) { s.middlewares.use(async (req,res,next) => { if(req.url !== '/__guidance') return next(); res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="min-h-screen bg-white p-4 text-slate-900" id="root"></div><script type="module" src="/__guidance.js"></script></body></html>')) }) },
}] })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const width of [375,1280]) {
    const page = await browser.newPage({viewport:{width,height:900}})
    page.setDefaultTimeout(8000)
    const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__guidance`)
    await page.getByText('ระบบช่วยคำนวณการเดินทาง',{exact:true}).waitFor()
    assert((await page.getByRole('region',{name:'คำแนะนำจากข้อมูลการเดินทาง'}).innerText()).includes('10:00–15:00'))
    // ปุ่มส่งกดได้เสมอ ความไม่ครบต้องบอกเป็นรายการภาษาไทย ไม่ใช่ปุ่มสีเทา
    await page.getByRole('button',{name:'ส่งคำขอจองรถ',exact:true}).click()
    await page.getByText('เลือกเวลานัดตามใบนัดแพทย์ ไม่ใช่เวลาที่ต้องการให้รถมารับ',{exact:true}).waitFor()
    // เวลาที่รถไปส่งไม่ทันต้องไม่อยู่ในรายการให้เลือกตั้งแต่แรก
    const offered=await page.getByLabel('เวลานัดแพทย์',{exact:true}).locator('option').allInnerTexts()
    assert.equal(offered.includes('08:30 น.'),false)
    assert.equal(offered[1],'10:00 น.');assert.equal(offered.at(-1),'15:00 น.')
    await page.getByLabel('เวลานัดแพทย์',{exact:true}).selectOption('15:00')
    await page.getByLabel('คาดว่าพร้อมรับกลับ (ยังไม่ทราบเว้นว่างได้)',{exact:true}).selectOption('10:00')
    await page.getByText('เวลาพร้อมรับกลับ 10:00 อยู่ก่อนเวลานัด 15:00',{exact:true}).waitFor()
    await page.getByLabel('คาดว่าพร้อมรับกลับ (ยังไม่ทราบเว้นว่างได้)',{exact:true}).selectOption('')
    await page.getByLabel('เวลานัดแพทย์',{exact:true}).selectOption('10:00')
    await page.getByLabel('เป็นการเดินทางตามนัด ไม่ใช่เหตุฉุกเฉิน').check()
    await page.getByLabel('ชื่อ–สกุลผู้จอง',{exact:true}).fill('TEST ผู้จอง')
    await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).fill('123')
    await page.getByRole('button',{name:'ส่งคำขอจองรถ',exact:true}).click()
    await page.getByText('กรอกเบอร์โทรที่ขึ้นต้นด้วย 0 จำนวน 9–10 หลัก ใช้ตัวเลขติดกัน ไม่เว้นวรรคหรือใส่ขีด',{exact:false}).waitFor()
    await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).fill('+66 89-000-0000')
    await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).blur()
    assert.equal(await page.getByLabel('เบอร์ติดต่อกลับ',{exact:true}).inputValue(),'0890000000')
    await page.getByText('จัดรูปแบบเบอร์โทรเป็น 0890000000 แล้ว กรุณาตรวจว่าถูกต้อง',{exact:true}).waitFor()
    await page.getByLabel('จุดรับและจุดสังเกต',{exact:true}).fill('TEST จุดรับ')
    await page.getByLabel('จุดรับอยู่ในเขตพื้นที่ให้บริการ',{exact:true}).check()
    await page.getByRole('button',{name:'ส่งคำขอจองรถ',exact:true}).click()
    await page.getByText('อ่านข้อความข้างช่องแล้วติ๊กยืนยันเฉพาะเมื่อเป็นจริง หากยังยืนยันไม่ได้ ให้ติดต่อเจ้าหน้าที่ก่อนส่งคำขอ',{exact:false}).waitFor()
    await page.getByLabel('ยืนยันการใช้ข้อมูลตามข้อความข้างต้น และข้อมูลจองถูกต้อง').check()
    await page.getByRole('button',{name:'ส่งคำขอจองรถ',exact:true}).click()
    await page.getByText('ส่งคำขอยังไม่สำเร็จ',{exact:true}).waitFor()
    assert((await page.locator('body').innerText()).includes('ระบบใช้รหัสคำขอเดิมเพื่อป้องกันคำขอซ้ำ'))
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth))
    assert.deepEqual(errors,[])
    await page.screenshot({path:`D:/tmp/booking-guidance-${width}.png`,fullPage:true})
    await page.close();console.log(`PASS ${width}px: required fields, office hours, return time, phone, consent, submit failure, no overflow`)
  }
} finally { await browser.close();await server.close() }
