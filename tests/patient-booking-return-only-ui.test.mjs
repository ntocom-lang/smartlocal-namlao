// Real React components with synthetic data. All non-loopback requests are blocked. No .env, no database, no real citizen data.
// รถรับ-ส่งผู้ป่วย "รับกลับอย่างเดียว" (เจ้าของระบบสั่ง 2569-11-04) — ฝั่งหน้าจอ:
//   ฟอร์ม: ฟอร์มไป–กลับเดิมไม่เปลี่ยน · ทางเข้า "ต้องการรถรับกลับอย่างเดียว" สลับถ้อยคำกล่อง 1–7 · เวลาเดียว (นัด = รับกลับ)
//          ร่วมกลับ/รถไปรับโดยเฉพาะ · หน้าทวนก่อนส่ง · payload ที่ส่งออก · เจ้าหน้าที่รับจองแทนใช้ได้เหมือนกัน
//   เจ้าหน้าที่/คนขับ/ผู้จอง: เห็น "ส่งที่บ้าน" ไม่ใช่ "จุดรับ" · ไม่มีเวลา "รถมารับ" ที่บ้าน
// ภาพถ่ายหน้าจอ: RETURN_ONLY_SHOT_DIR=<โฟลเดอร์> node tests/patient-booking-return-only-ui.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { thaiDay } from '../src/lib/patientBooking.js'

const SHOTS = process.env.RETURN_ONLY_SHOT_DIR
if (SHOTS) await mkdir(SHOTS, { recursive: true })
const day = thaiDay(Date.now() + 3 * 86400000)
const routes = [{ id: 'a', label: 'TEST โรงพยาบาล A', zone: 'TEST เมือง' }, { id: 'b', label: 'TEST โรงพยาบาล B', zone: 'TEST เมือง' }]
const info = { revision: 1, enabled: true, booking_mode: true, scheduling_mode: 'manual', office_start: 450, office_end: 1050, seats: 4, routes, min_lead_days: 0,
  privacy_notice: 'TEST ข้อความใช้ข้อมูล', consent_version: 'patient-booking-v1', owner_name: 'TEST กองทุน', contact_phone: '0800000000', community: { enabled: false } }
const at = (time, d = day) => `${d}T${time}:00+07:00`
const calendarTrip = { id: 'trip-1', route_id: 'a', route_label: 'TEST โรงพยาบาล A', date: day, joinable: true, remaining: 2, people: 2, status: 'joinable', state: 'confirmed',
  return_mode: 'one_way', return_at: null, appointment_at: at('09:30'), estimated_pickup_at: null, schedule_revision: 1, outbound_waves: [{ appointment_start: at('09:30') }] }
const rider = { id: 'ro1', created_by: 'citizen', patient_name: 'TEST ผู้ป่วยนอน', requester_name: 'TEST ญาติ', phone: '0800000001', relation: 'relative', in_area: true,
  pickup: 'TEST บ้านเลขที่ 9 หมู่ 1', pickup_lat: 18.1, pickup_lng: 100.1, mobility: 'walk', companions: 0, share: true, route_id: 'a', route_label: 'TEST โรงพยาบาล A',
  appointment_at: at('11:00'), return_at: at('11:00'), return_mode: 'return_only', status: 'submitted', trip_id: null, revision: 1, passenger_step: 0, service_type: 'patient', entry_channel: 'online' }
const settings = { ...info, partner_id: 'fund', driver_id: 'driver', coordinator_ids: ['admin'], wheelchairs: 1, stretchers: 1 }
const returnTrip = { id: 'trip-r', booking_ids: ['ro2'], driver_id: 'driver', driver_name: 'TEST คนขับ', state: 'confirmed', revision: 1, docs_revision: 1, schedule_revision: 1, public_notice: 'normal',
  plan: { date: day, route_id: 'a', route_label: 'TEST โรงพยาบาล A', appointment_at: at('11:00'), return_at: at('11:00'), return_mode: 'later', service_type: 'patient', pickup_at: null, blocks: [], outbound_waves: [], return_waves: [{ return_start: at('11:00'), return_end: at('11:00'), passengers: 1 }], errors: [] } }
const confirmedRider = { ...rider, id: 'ro2', status: 'confirmed', trip_id: 'trip-r' }
const workspace = { role: 'admin', settings, community_rules: { enabled: false, places: [], activities: [] }, partners: [{ id: 'fund', name: 'TEST กองทุน' }], people: [{ id: 'admin', name: 'TEST ผู้ดูแล' }, { id: 'driver', name: 'TEST คนขับ' }],
  bookings: [rider, confirmedRider], trips: [returnTrip], events: [], odometer: { failed: false, days: [], previous: null } }

const plugin = {
  name: 'return-only-ui', enforce: 'pre',
  resolveId(id) { if (id === '/__ro.js') return '\0ro-entry' },
  load(id) {
    const file = id.replaceAll('\\', '/')
    if (file.endsWith('/contexts/TenantContext.jsx')) return "export const useTenant=()=>({tenant:{id:'test',name:'อบต. TEST'}})"
    if (file.endsWith('/lib/supabase.js')) return `export const supabase={rpc:async(name,args)=>{if(name==='patient_booking_calendar'){const days=[];for(let at=Date.parse(args.p_from+'T12:00:00+07:00');at<=Date.parse(args.p_to+'T12:00:00+07:00');at+=86400000){const date=new Date(at+7*3600000).toISOString().slice(0,10);days.push({date,status:'open',trips:date===${JSON.stringify(day)}?[${JSON.stringify(calendarTrip)}]:[],free:[],community_free:[]})}return{data:{scheduling_mode:'manual',days}}}return{data:{events:[],items:[],days:[]}}},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,then:resolve=>resolve({data:[],error:null})};return q}}`
    if (id === '\0ro-entry') return `import React from 'react';import{createRoot}from'react-dom/client';import Inbox from '/src/components/patientTransport/BookingInbox.jsx';import Form from '/src/components/patientTransport/BookingForm.jsx';import{DriverTrips,BookingCards}from'/src/components/patientTransport/BookingOperations.jsx';import'/src/index.css';
const ws=${JSON.stringify(workspace)},info=${JSON.stringify(info)},rider=${JSON.stringify(rider)};window.submitted=[];const mode=location.hash.slice(1);const no=()=>{};
function App(){
 if(mode==='form'||mode==='staff'||mode==='last')return React.createElement(Form,{tenantId:'test',info,staffEntry:mode==='staff',lastBooking:mode==='last'?{requester_name:'TEST ญาติ',phone:'0800000001',relation:'self',route_id:'a',route_label:'TEST โรงพยาบาล A',return_mode:'one_way',mobility:'walk',companions:0,share:true,pickup:'TEST บ้านเลขที่ 9'}:undefined,onBack:no,onSubmit:async(id,payload,tripId)=>{window.submitted.push({id,payload,tripId});return true}});
 if(mode==='driver')return React.createElement(DriverTrips,{workspace:ws,uid:'driver',contactPhone:'0800000000',onAdvance:no,onAction:no,onOdometer:no,onReassign:no});
 if(mode==='citizen')return React.createElement(BookingCards,{bookings:[ws.bookings[1]],trips:ws.trips,onAction:no});
 return React.createElement(Inbox,{workspace:{...ws,bookings:[rider]},currentUserId:'admin',isAdmin:true,onConfirm:no,onJoin:no,onAction:no,onDelete:no,onAmend:no,onReload:no,onSettings:no})}
createRoot(document.getElementById('root')).render(React.createElement('main',{className:'mx-auto max-w-5xl bg-slate-50 text-slate-900 p-3'},React.createElement(App)));`
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url?.split('?')[0] === '/__ro') {
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__ro.js"></script></body></html>'))
      } else next()
    })
  },
}
const server = await createServer({ configFile: false, envDir: false, logLevel: 'error', plugins: [plugin, react(), tailwind()], server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const base = `http://127.0.0.1:${server.httpServer.address().port}/__ro`
let checks = 0
const ok = (value, label) => { assert.ok(value, label); checks++ }
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) : null
const open = async (width, mode) => {
  const page = await browser.newPage({ viewport: { width, height: 960 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`${base}#${mode}`); await page.locator('main').waitFor()
  await page.waitForFunction(() => document.querySelector('main')?.innerText.length > 50)
  return { page, errors }
}
const body = page => page.locator('body').innerText()
const pickDay = async page => {
  const month = day.slice(5, 7)
  if (await page.getByLabel('เดือน').inputValue() !== month) await page.getByLabel('เดือน').selectOption(month)
  await page.locator(`[data-calendar-date="${day}"]`).click()
}
const fillWho = async page => {
  await page.getByLabel('ชื่อ–สกุลผู้จอง').fill('TEST ญาติผู้ป่วย')
  await page.getByLabel('เบอร์ติดต่อกลับ').fill('0800000009')
  await page.getByLabel(/จุด(ส่ง|รับ)และจุดสังเกต/).fill('TEST บ้านเลขที่ 9 หมู่ 1')
}
const sendThroughReview = async page => {
  await page.getByRole('button', { name: 'ส่งคำขอ', exact: true }).click()
  await page.getByText('ตรวจทานก่อนส่ง').waitFor()
  await page.locator('div.fixed input[type=checkbox]').check()
}

try {
  for (const width of [320, 390, 1280]) {
    // ── 1) ฟอร์มปกติ: ไม่เปลี่ยน + มีทางเข้า ──
    let { page, errors } = await open(width, 'form')
    let text = await body(page)
    ok(text.includes('ขอรถไปโรงพยาบาล') && text.includes('วันที่ไปโรงพยาบาล') && text.includes('เวลานัดแพทย์') && text.includes('โรงพยาบาลที่จะไป') && text.includes('จุดรับ'), 'ฟอร์มไป–กลับต้องใช้ถ้อยคำเดิม')
    ok(text.includes('ผู้ป่วยนอนโรงพยาบาลอยู่ ต้องการรถ “รับกลับ” อย่างเดียว?'), 'ต้องมีทางเข้ารับกลับอย่างเดียว')
    eq(await page.locator('[data-return-only-mode]').count(), 0); eq(await page.locator('[data-return-only-ways]').count(), 0)
    ok(text.includes('ให้รถรอรับกลับ') && text.includes('ไปอย่างเดียว'), 'ขากลับเดิมต้องยังมีครบ')
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `ฟอร์มปกติล้นจอ ${width}px`)
    if (width === 390) await shot(page, 'form-round-390')

    // ── 2) กดทางเข้า: ถ้อยคำ 1–7 เปลี่ยน ไม่เหลือคำว่านัดแพทย์/จุดรับ ──
    await page.getByRole('button', { name: 'ต้องการรถรับกลับอย่างเดียว' }).click()
    await page.locator('[data-return-only-mode]').waitFor()
    text = await body(page)
    for (const word of ['ขอรถรับกลับจากโรงพยาบาล', 'วันที่ผู้ป่วยออกจากโรงพยาบาล', 'เวลาที่ผู้ป่วยพร้อมออก', 'โรงพยาบาลที่ผู้ป่วยพักอยู่', 'วิธีกลับ', 'ให้รถไปรับโดยเฉพาะ', 'บ้านที่จะไปส่ง'])
      ok(text.includes(word), `ต้องมี “${word}” ในโหมดรับกลับอย่างเดียว`)
    for (const word of ['เวลานัดแพทย์', 'ให้รถรอรับกลับ', 'ขอรถไปโรงพยาบาล', 'วันที่ไปโรงพยาบาล', 'โรงพยาบาลที่จะไป'])
      ok(!text.includes(word), `ต้องไม่มี “${word}” ในโหมดรับกลับอย่างเดียว`)
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `โหมดรับกลับอย่างเดียวล้นจอ ${width}px`)

    // ── 3) รถไปรับโดยเฉพาะ: เวลาเดียว นัด = รับกลับ ไม่ผูกเที่ยว ──
    await pickDay(page)
    await page.getByRole('group', { name: 'เวลาที่ผู้ป่วยพร้อมออก' }).getByRole('button', { name: /11:00/ }).click()
    ok(await page.getByRole('button', { name: /ขอร่วมกลับกับรถที่ไป TEST โรงพยาบาล A/ }).count() > 0, 'ต้องเสนอรถที่ไปโรงพยาบาลเดียวกันวันนั้น')
    eq(await page.getByRole('button', { name: /ให้รถไปรับโดยเฉพาะ/ }).getAttribute('aria-pressed'), 'true', 'ค่าเริ่มต้น = รถไปรับโดยเฉพาะ')
    await fillWho(page)
    if (width === 390) await shot(page, 'form-return-only-390')
    await sendThroughReview(page)
    text = await body(page)
    for (const word of ['วันที่กลับ', 'เวลาพร้อมออก', 'ผู้ป่วยอยู่ที่', 'ส่งที่บ้าน', 'รับกลับอย่างเดียว · ไม่มีขาไปจากบ้าน', 'เป็นการเดินทางกลับบ้านหลังแพทย์อนุญาตให้ออกจากโรงพยาบาล', 'บ้านที่ไปส่งอยู่ในเขตพื้นที่ให้บริการของ'])
      ok(text.includes(word), `หน้าทวนต้องมี “${word}”`)
    ok(!text.includes('เป็นการเดินทางไปตามนัดของแพทย์') && !text.includes('วันนัด'), 'หน้าทวนต้องไม่ใช้ถ้อยคำไปตามนัด')
    if (width === 390) await shot(page, 'review-return-only-390')
    await page.getByRole('button', { name: 'ยืนยันส่งคำขอ' }).click()
    await page.waitForFunction(() => window.submitted.length === 1)
    let sent = await page.evaluate(() => window.submitted[0])
    eq(sent.payload.return_mode, 'return_only'); eq(Date.parse(sent.payload.appointment_at), Date.parse(at('11:00'))); eq(Date.parse(sent.payload.return_at), Date.parse(at('11:00')), 'เวลานัด = เวลารับกลับ')
    eq(sent.payload.route_id, 'a'); eq(sent.payload.share, true); eq(sent.tripId ?? null, null, 'รถไปรับโดยเฉพาะต้องไม่ผูกเที่ยว')
    ok(sent.payload.pickup.includes('TEST บ้านเลขที่ 9'))
    eq(errors, []); await page.close()

    // ── 4) ร่วมกลับกับรถที่ไปวันนั้น: ส่งพร้อมรหัสเที่ยว คงรูปแบบรับกลับอย่างเดียว ──
    ;({ page, errors } = await open(width, 'form'))
    await page.getByRole('button', { name: 'ต้องการรถรับกลับอย่างเดียว' }).click()
    await pickDay(page)
    await page.getByRole('group', { name: 'เวลาที่ผู้ป่วยพร้อมออก' }).getByRole('button', { name: /11:00/ }).click()
    await page.getByRole('group', { name: 'วิธีกลับ' }).getByRole('button', { name: /ขอร่วมกลับกับรถที่ไป TEST โรงพยาบาล A/ }).click()
    eq(await page.getByRole('group', { name: 'วิธีกลับ' }).getByRole('button', { name: /ขอร่วมกลับกับรถที่ไป/ }).getAttribute('aria-pressed'), 'true')
    ok(await page.getByText('ตรวจแล้วเลือกเวลา').count() === 0)
    await fillWho(page); await sendThroughReview(page)
    ok((await body(page)).includes('ขอร่วมกลับกับรถที่ไป TEST โรงพยาบาล A · รอเจ้าหน้าที่ยืนยัน'), 'หน้าทวนต้องบอกว่าขอร่วมกลับ')
    await page.getByRole('button', { name: 'ยืนยันส่งคำขอ' }).click()
    await page.waitForFunction(() => window.submitted.length === 1)
    sent = await page.evaluate(() => window.submitted[0])
    eq(sent.tripId, 'trip-1'); eq(sent.payload.return_mode, 'return_only'); eq(Date.parse(sent.payload.return_at), Date.parse(at('11:00'))); eq(Date.parse(sent.payload.appointment_at), Date.parse(at('11:00')))
    eq(errors, []); await page.close()

    // ── 5) สลับกลับไป–กลับ: ถ้อยคำเดิมกลับมา ไม่ค้างค่าของโหมดรับกลับ ──
    ;({ page, errors } = await open(width, 'form'))
    await page.getByRole('button', { name: 'ต้องการรถรับกลับอย่างเดียว' }).click()
    await page.getByRole('button', { name: '← กลับไปจองไป–กลับ' }).click()
    text = await body(page)
    ok(text.includes('วันที่ไปโรงพยาบาล') && text.includes('ให้รถรอรับกลับ') && !text.includes('วิธีกลับ'), 'สลับกลับแล้วต้องเป็นฟอร์มไป–กลับเดิม')
    eq(await page.locator('[data-return-only-mode]').count(), 0)
    eq(errors, []); await page.close()
  }

  // ── 6) เจ้าหน้าที่รับจองแทน: ทางเข้าเดียวกัน ไม่มีรายการรถให้ร่วม (เจ้าหน้าที่จัดเองในกล่องคำขอรถ) ──
  let { page, errors } = await open(390, 'staff')
  await page.getByRole('button', { name: 'ต้องการรถรับกลับอย่างเดียว' }).click()
  await pickDay(page)
  await page.getByRole('group', { name: 'เวลาที่ผู้ป่วยพร้อมออก' }).getByRole('button', { name: /11:00/ }).click()
  eq(await page.getByRole('button', { name: /ขอร่วมกลับกับรถที่ไป/ }).count(), 0, 'รับจองแทนไม่เสนอรายการร่วมเที่ยว')
  ok((await body(page)).includes('รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์'))
  eq(errors, []); await page.close()

  // ── 7) ครั้งก่อนจองไปอย่างเดียว: บอกว่ากดปุ่มนี้ตอนแพทย์ให้กลับ และเติมข้อมูลครั้งก่อน ──
  ;({ page, errors } = await open(390, 'last'))
  let text = await body(page)
  ok(text.includes('ครั้งก่อนจองไปอย่างเดียว กดปุ่มนี้เมื่อแพทย์ให้กลับบ้าน'), 'ต้องแนะนำคนที่เคยจองไปนอน')
  ok(text.includes('เติมข้อมูลจากการจองครั้งก่อนให้แล้ว'))
  await page.getByRole('button', { name: 'ต้องการรถรับกลับอย่างเดียว' }).click()
  eq(await page.getByLabel('เบอร์ติดต่อกลับ').inputValue(), '0800000001', 'ยังเติมเบอร์จากครั้งก่อน')
  eq(errors, []); await page.close()

  // ── 8) เจ้าหน้าที่ / คนขับ / ผู้จอง ──
  ;({ page, errors } = await open(1280, 'inbox'))
  text = await page.locator('tr[data-booking]').first().innerText()
  ok(text.includes('ส่งที่') && text.includes('รับกลับอย่างเดียว') && !text.includes('รับที่ TEST'), `แถวกล่องคำขอรถ: ${text}`)
  await page.locator('tr[data-booking]').first().click()
  text = await body(page)
  for (const word of ['ส่งที่บ้าน', 'วันเวลาที่ผู้ป่วยพร้อมออก', 'โรงพยาบาลที่พักอยู่', 'รับกลับอย่างเดียว · ไม่มีขาไปจากบ้าน'])
    ok(text.includes(word), `แผ่นรายละเอียดต้องมี “${word}”`)
  if (SHOTS) await shot(page, 'inbox-return-only-1280')
  eq(errors, []); await page.close()

  ;({ page, errors } = await open(390, 'driver'))
  text = await body(page)
  ok(text.includes('รถออก') || text.includes('รอประสานเวลารถออก'), 'เที่ยวที่ไม่มีขาไปต้องไม่ขึ้น “รอประสานเวลารับ”')
  ok(!text.includes('รอประสานเวลารับ ') && text.includes('รับที่ TEST โรงพยาบาล A → ส่งที่บ้าน') && text.includes('พร้อมออกจากโรงพยาบาล') && text.includes('นำทางไปบ้านที่ส่ง'), `การ์ดคนขับ: ${text.slice(0, 400)}`)
  ok(!text.includes('จุดรับ:') && !text.includes('นัดแพทย์'))
  if (SHOTS) await shot(page, 'driver-return-only-390')
  eq(errors, []); await page.close()

  ;({ page, errors } = await open(390, 'citizen'))
  text = await body(page)
  ok(text.includes('รับกลับจาก TEST โรงพยาบาล A') && text.includes('พร้อมออก'), `การ์ดผู้จอง: ${text.slice(0, 300)}`)
  eq(errors, []); await page.close()
  console.log(`PASS return-only UI: ${checks} checks (ฟอร์มเดิมไม่เปลี่ยน, ทางเข้า, ถ้อยคำ 1–7, เวลาเดียว, ร่วมกลับ/รถเฉพาะ, หน้าทวน, payload, รับจองแทน, ครั้งก่อนไปอย่างเดียว, เจ้าหน้าที่/คนขับ/ผู้จอง, 320/390/1280px ไม่ล้น)`)
} finally { await browser.close(); await server.close() }
