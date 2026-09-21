import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { thaiDay, bookingTimingAdvice, normalizeBookingPhone, freeTimeChoices, latestReturnClock } from '../src/lib/patientBooking.js'

// ฟอร์มจองแบบปุ่มตัวเลือก (เจ้าของระบบสั่ง 2569-09-21 "ให้ประชาชนพิมพ์น้อยที่สุด")
// เวลานัดขึ้นเฉพาะเวลาที่รถว่างและไปส่งทัน · ขาดอะไรบอกเป็นรายการภาษาไทย · ทวนก่อนส่ง + ยินยอม 1 ช่อง
const day = thaiDay(Date.now() + 10 * 86400000)
const info = { routes: [{ id: 'r', label: 'โรงพยาบาล TEST', minutes: 60 }], office_start: 510, office_end: 990, buffer_minutes: 15, boarding_minutes: 15, min_lead_days: 0, contact_phone: '050000000', privacy_notice: 'TEST ข้อความใช้ข้อมูล', owner_name: 'TEST กองทุน', consent_version: 'patient-booking-v1' }
assert.equal(normalizeBookingPhone('+66 89-000-0000'), '0890000000')
assert.equal(normalizeBookingPhone('๐๘๙ ๐๐๐ ๐๐๐๐'), '0890000000')
assert.equal(normalizeBookingPhone('123'), '123')
assert.equal(normalizeBookingPhone('089abc0000000'), '089abc0000000')
const advice = bookingTimingAdvice({ route_id: 'r', return_mode: 'wait' }, info)
assert.equal(advice.earliest, 600); assert.equal(advice.latest, 900)
assert.equal(bookingTimingAdvice({ route_id: 'r', return_mode: 'one_way' }, info).latest, 915)
assert.equal(bookingTimingAdvice({ route_id: 'missing' }, info), null)
assert.equal(bookingTimingAdvice({ route_id: 'r' }, { ...info, office_end: 550 }).possible, false)

// เวลาที่ "รถว่างจริง": แผนเดินทางทั้งช่วงต้องอยู่ในช่วงว่างช่วงเดียว (ช่อง free ของ patient_booking_calendar)
const at = (d, t) => `${d}T${t}:00+07:00`
const openDay = free => ({ date: day, status: 'open', free: free.map(([start, end]) => ({ start: at(day, start), end: at(day, end) })) })
const draft = { route_id: 'r', return_mode: 'wait', back: '' }
// ไม่ทราบเวลากลับ = กันรถถึงเวลาที่ยังกลับทันปิดบริการ (16:30 − 90 นาที)
assert.equal(latestReturnClock(draft, info), '15:00')
const wholeDay = freeTimeChoices(draft, info, openDay([['08:30', '16:30']]), 30)
assert.equal(wholeDay[0], '10:00', 'รถออก 08:30 ไปถึงนัดได้เร็วสุด 10:00'); assert.equal(wholeDay.at(-1), '15:00'); assert(!wholeDay.includes('08:30'))
// มีเที่ยวที่ยืนยันแล้ว 09:00–13:00 → เหลือเวลาที่แผนทั้งช่วงไม่ชนเท่านั้น
const busyDay = openDay([['08:30', '09:00'], ['13:00', '16:30']])
assert.deepEqual(freeTimeChoices(draft, info, busyDay, 30), ['14:30', '15:00'])
assert.deepEqual(freeTimeChoices({ ...draft, return_mode: 'one_way' }, info, busyDay, 15), ['14:30', '14:45', '15:00', '15:15'])
assert.deepEqual(freeTimeChoices(draft, info, { ...openDay([['08:30', '16:30']]), status: 'closed' }), [], 'วันปิดให้บริการต้องไม่มีเวลาให้เลือก')
// ทราบเวลากลับแล้ว ช่วงกันรถสั้นลง เวลานัดที่เลือกได้ต้องไม่เกินเวลากลับ
assert.equal(freeTimeChoices({ ...draft, back: '12:00' }, info, openDay([['08:30', '16:30']]), 30).at(-1), '12:00')

const server = await createServer({ configFile: false, envDir: false, server: { host: '127.0.0.1', port: 0 }, plugins: [react(), tailwindcss(), {
  name: 'isolated-booking-form-guidance', enforce: 'pre',
  resolveId(id) { if (id === '/__guidance.js') return '\0guidance.js' },
  load(id) {
    const file = id.replaceAll('\\', '/')
    // onSubmit คืน false = ส่งไม่สำเร็จ (เครือข่ายขัดข้อง) ฟอร์มต้องปิดแผ่นทวนแล้วบอกวิธีแก้
    if (id === '\0guidance.js') return `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import Form from '/src/components/patientTransport/BookingForm.jsx'; import '/src/index.css'; function App(){const [error,setError]=useState(''); return React.createElement(Form,{tenantId:"test",info:${JSON.stringify(info)},onBack:()=>{},onSubmit:()=>{setError('เครือข่ายขัดข้อง');return false},submitError:error})};createRoot(document.getElementById('root')).render(React.createElement(App));`
    // ปฏิทินสาธารณะ: ทุกวันเปิด รถว่างทั้งวัน · ทะเบียนสถานที่ของหน่วยงาน 2 แห่ง
    if (file.endsWith('/lib/supabase.js')) return `export const supabase={
      rpc:async(name,args)=>{const days=[];const to=new Date(args.p_to+'T12:00:00+07:00').getTime();for(let t=new Date(args.p_from+'T12:00:00+07:00').getTime();t<=to&&days.length<60;t+=86400000){const d=new Date(t+7*3600000).toISOString().slice(0,10);days.push({date:d,status:'open',free:[{start:d+'T08:30:00+07:00',end:d+'T16:30:00+07:00'}],trips:[]})}return {data:{days}}},
      from:()=>{const api={select:()=>api,eq:()=>api,order:()=>api,then:resolve=>resolve({data:[{id:'1',name:'TEST บ้านเหนือ'},{id:'2',name:'TEST บ้านใต้'}],error:null})};return api}}`
    if (file.endsWith('/contexts/TenantContext.jsx')) return 'export const useTenant=()=>({tenant:{}})'
    if (file.endsWith('/components/MapPicker.jsx')) return 'export default function MapPicker(){return null}'
  },
  configureServer(s) { s.middlewares.use(async (req, res, next) => { if (req.url !== '/__guidance') return next(); res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div class="min-h-screen bg-white p-4 text-slate-900" id="root"></div><script type="module" src="/__guidance.js"></script></body></html>')) }) },
}] })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(8000)
    const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message) })
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__guidance`)
    const days = page.getByRole('group', { name: 'วันที่ไปโรงพยาบาล' }).getByRole('button')
    await days.first().waitFor()
    assert(await days.count() <= 6, 'ปุ่มวันที่ขึ้นไม่เกิน 6 วัน')
    assert.equal(await days.first().getAttribute('aria-pressed'), 'true', 'วันแรกที่รถว่างต้องเลือกไว้ให้แล้ว')
    // เวลาที่รถไปส่งไม่ทันต้องไม่อยู่ในปุ่มให้เลือกตั้งแต่แรก
    const times = page.getByRole('group', { name: 'เวลานัดแพทย์' }).getByRole('button')
    const offered = await times.allInnerTexts()
    assert.equal(offered.includes('08:30 น.'), false)
    assert.equal(offered[0], '10:00 น.'); assert.equal(offered.at(-1), '15:00 น.')
    // ปุ่มส่งกดได้เสมอ ความไม่ครบต้องบอกเป็นรายการภาษาไทย ไม่ใช่ปุ่มสีเทา
    await page.getByRole('button', { name: 'ส่งคำขอ', exact: true }).click()
    const missing = page.getByRole('alert').filter({ hasText: 'ยังส่งคำขอไม่ได้' })
    await missing.waitFor()
    for (const label of ['เวลานัดแพทย์', 'ชื่อ–สกุลผู้จอง', 'เบอร์ติดต่อกลับ', 'จุดรับ']) assert((await missing.innerText()).includes(label), label)
    await times.filter({ hasText: '10:00 น.' }).click()
    assert.equal(await times.filter({ hasText: '10:00 น.' }).getAttribute('aria-pressed'), 'true')
    await page.getByLabel('ชื่อ–สกุลผู้จอง', { exact: true }).fill('TEST ผู้จอง')
    await page.getByLabel('เบอร์ติดต่อกลับ', { exact: true }).fill('123')
    await page.getByRole('button', { name: 'ส่งคำขอ', exact: true }).click()
    await page.getByText('กรอกเบอร์โทรที่ขึ้นต้นด้วย 0 จำนวน 9–10 หลักในข้อ 5', { exact: true }).waitFor()
    await page.getByLabel('เบอร์ติดต่อกลับ', { exact: true }).fill('+66 89-000-0000')
    await page.getByLabel('เบอร์ติดต่อกลับ', { exact: true }).blur()
    assert.equal(await page.getByLabel('เบอร์ติดต่อกลับ', { exact: true }).inputValue(), '0890000000')
    await page.getByText('จัดรูปแบบเบอร์โทรเป็น 0890000000 แล้ว กรุณาตรวจว่าถูกต้อง', { exact: true }).waitFor()
    // จุดรับ: กดเลือกหมู่บ้านจากทะเบียน แล้วพิมพ์แค่บ้านเลขที่/จุดสังเกต
    await page.getByRole('group', { name: 'หมู่บ้าน/สถานที่' }).getByRole('button', { name: 'TEST บ้านเหนือ' }).click()
    await page.getByLabel('บ้านเลขที่ / จุดสังเกต', { exact: true }).fill('บ้านเลขที่ 9')
    // ทราบเวลากลับ → ระบบกันรถสั้นลง
    await page.getByRole('button', { name: 'ระบุเวลาที่คาดว่าเสร็จ (ถ้าทราบ)' }).click()
    await page.getByRole('group', { name: 'คาดว่าเสร็จประมาณ' }).getByRole('button', { name: '12:00 น.' }).click()
    await page.getByText('12:00 น.', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'ส่งคำขอ', exact: true }).click()
    // หน้าทวนก่อนส่ง: สรุปทุกช่อง + คำรับรอง + ยินยอม 1 ช่อง ปุ่มยืนยันกดได้เมื่อยินยอมแล้วเท่านั้น
    await page.getByText('ตรวจทานก่อนส่ง', { exact: true }).waitFor()
    const body = await page.locator('body').innerText()
    for (const text of ['TEST บ้านเหนือ · บ้านเลขที่ 9 · ไม่ได้ปักหมุด', 'คาดว่าเสร็จ 12:00 น.', 'ไม่ใช่เจ็บป่วยฉุกเฉิน', '0890000000']) assert(body.includes(text), text)
    const confirm = page.getByRole('button', { name: 'ยืนยันส่งคำขอ', exact: true })
    assert.equal(await confirm.isDisabled(), true, 'ยังไม่ยินยอมต้องส่งไม่ได้')
    await page.getByRole('checkbox', { name: 'ยินยอมให้ใช้ข้อมูลตามข้อความข้างต้น' }).check()
    await confirm.click()
    // ส่งไม่สำเร็จ: แผ่นทวนปิดเอง แล้วเห็นกล่องบอกวิธีแก้ ไม่ใช่ค้างอยู่หลังแผ่น
    await page.getByText('ส่งคำขอยังไม่สำเร็จ', { exact: true }).waitFor()
    assert.equal(await page.getByText('ตรวจทานก่อนส่ง', { exact: true }).count(), 0)
    assert((await page.locator('body').innerText()).includes('ระบบใช้รหัสคำขอเดิมเพื่อป้องกันคำขอซ้ำ'))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `D:/tmp/booking-guidance-${width}.png`, fullPage: true })
    await page.close(); console.log(`PASS ${width}px: free-time choices only, missing list, phone format, place registry, return time, review + consent, submit failure, no overflow`)
  }
} finally { await browser.close(); await server.close() }
