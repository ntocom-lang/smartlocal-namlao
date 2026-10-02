// Actual React UI + print builders, isolated from every production/network write.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)
const { default: tailwind } = await import(pathToFileURL(require.resolve('@tailwindcss/vite')).href)
const { chromium } = require('playwright')
const tenant = { id: 'test-muni', org_type: 'อบต.', name: 'องค์การบริหารส่วนตำบลตัวอย่าง', district: 'ตัวอย่าง', province: 'ตัวอย่าง', address: 'เลขที่ 1 หมู่ที่ 1' }
const trip = { id: 'test-trip', state: 'confirmed', created_at: '2026-09-30T18:30:00Z', updated_at: '2026-10-02T08:00:00+07:00', revision: 1, docs_revision: 1, driver_id: 'test-driver', driver_name: 'TEST คนขับ', plan: { date: '2026-10-05', route_label: 'โรงพยาบาลตัวอย่าง', pickup_at: '2026-10-05T09:00:00+07:00', return_at: '2026-10-05T17:00:00+07:00' } }
const booking = { id: 'testbook-001', patient_name: 'TEST ผู้ป่วยตัวอย่าง', requester_name: 'TEST ผู้ยื่นตัวอย่าง', phone: '0800000000', status: 'confirmed', trip_id: trip.id, appointment_at: '2026-10-05T10:00:00+07:00', return_at: '2026-10-05T17:00:00+07:00', route_id: 'test-route', route_label: 'โรงพยาบาลตัวอย่าง', pickup: 'หมู่ 1 บ้านตัวอย่าง', mobility: 'walk', companions: 1, return_mode: 'wait', relation: 'relative', entry_channel: 'staff', created_at: '2026-10-02T08:00:00+07:00', consent_at: '2026-10-02T08:00:00+07:00', revision: 1, letter_revision: 1, forward_letter_no: 'ทด 2569/1', forward_letter_date: '2026-10-02', passenger_step: 0 }
const workspace = { role: 'admin', settings: { enabled: true, partner_id: 'test-partner', driver_id: 'test-driver', seats: 10, open_time: '07:30', close_time: '17:30', revision: 1 }, bookings: [booking, { ...booking, id: 'testbook-002', patient_name: 'TEST ผู้ป่วยคนอื่น', forward_letter_no: 'ทด 2569/2' }], trips: [trip], routes: [{ id: 'test-route', label: 'โรงพยาบาลตัวอย่าง', duration_minutes: 60 }], staff: [], events: [] }
const header = { municipality_id: tenant.id, partner_id: 'test-partner', workflow_status: 'forwarded', partner_name_snapshot: 'กองทุนตัวอย่าง', recipient_title_snapshot: 'ประธานกองทุนตัวอย่าง', appointment_at: booking.appointment_at, forward_letter_no: booking.forward_letter_no, forward_letter_date: booking.forward_letter_date, consent_at: booking.consent_at }
const parent = { requester_name: booking.requester_name, requester_phone: booking.phone, created_at: booking.created_at, permit_form_data: { patient_name: booking.patient_name, pickup_address: booking.pickup, destination: booking.route_label, trip_type: 'round_trip', companions: 1, signed_by: { channel: 'booking_staff' } } }
const plugin = {
  name: 'isolated-letter-print-test', enforce: 'pre',
  resolveId(id) { if (id === '/__print_entry.js') return '\0print-entry.js' },
  load(id) {
    const normalized = id.replaceAll('\\', '/').split('?')[0]
    if (id === '\0print-entry.js') return `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import Staff from '/src/pages/PatientTransportStaff.jsx';import Legacy from '/src/components/staff/PatientTransportPanel.jsx';import '/src/index.css';const Page=new URLSearchParams(location.search).has('legacy')?Legacy:Staff;createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Page,{requestId:'testbook-001'})));`
    if (normalized.endsWith('/contexts/TenantContext.jsx')) return `export const useTenant=()=>({tenant:${JSON.stringify(tenant)},isModuleEnabled:()=>true});`
    if (normalized.endsWith('/contexts/AuthContext.jsx')) return `export const useAuth=()=>({session:{user:{id:'test-admin'}},profileName:'TEST ผู้ดูแล'});`
    if (normalized.endsWith('/hooks/usePatientBooking.js')) return `
      import {useEffect,useState} from 'react';const seed=${JSON.stringify(workspace)};
      const query=new URLSearchParams(location.search);
      if(query.has('pending')){seed.bookings=[{...seed.bookings[0],status:'submitted',trip_id:null}];seed.trips=[];}
      if(query.has('blank')){seed.bookings[0].forward_letter_no=null;seed.bookings[0].forward_letter_date=null;}
      if(query.has('no-confirmation')){seed.trips[0].created_at=null;}
      export default function(){
        const [workspace,setWorkspace]=useState(seed),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
        useEffect(()=>{window.__qaWorkspace=workspace;window.__qaRefresh=()=>setWorkspace(w=>({...w,bookings:w.bookings.map((b,i)=>i?b:{...b,letter_revision:b.letter_revision+1,forward_letter_no:'ทด 2569/ล่าสุด',forward_letter_date:'2026-10-02'})}));},[workspace]);
        async function mutate(name,args){
          if(name!=='patient_booking_record_booking_letter')throw Error('Unexpected write '+name);
          window.__rpcCalls??=[];window.__rpcCalls.push({name,args,popupOpened:window.__opened||0});
          setBusy(true);setError('');await new Promise(resolve=>setTimeout(resolve,80));
          const current=workspace.bookings.find(b=>b.id===args.p_booking);
          if(window.__qaFail||current.letter_revision!==args.p_letter_revision){setBusy(false);setError('TEST บันทึกไม่สำเร็จ กรุณาตรวจข้อมูลล่าสุด');return false;}
          setWorkspace(w=>({...w,bookings:w.bookings.map(b=>b.id===args.p_booking?{...b,forward_letter_no:args.p_letter_no,forward_letter_date:args.p_letter_date,letter_revision:b.letter_revision+1}:b)}));
          setBusy(false);setNotice('บันทึกเลขหนังสือนำส่งแล้ว');return true;
        }
        return {current:true,info:{enabled:true},workspace,error,setError,notice,setNotice,busy,reload:()=>{},mutate,task:()=>{throw Error('Unexpected task')},op:()=> 'test-op'};
      }`
    if (normalized.endsWith('/lib/supabase.js')) return `
      const query=new URLSearchParams(location.search),header=${JSON.stringify(header)};
      if(query.has('draft')){header.workflow_status='submitted';header.forward_letter_no=null;header.forward_letter_date=null;}
      const rows={patient_transport_requests:header,document_requests:${JSON.stringify(parent)},referral_partners:{name:'กองทุนตัวอย่าง',recipient_title:'ประธานกองทุนตัวอย่าง'},profiles:{id:'test-admin',role:'admin',municipality_id:'test-muni'}};
      export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'test-admin'}}}})},rpc:async name=>{if(name==='patient_booking_history')return {data:{events:[]},error:null};throw Error('Unexpected legacy RPC '+name)},from:table=>{const api={select:()=>api,eq:()=>api,order:()=>api,maybeSingle:()=>api,then:(resolve,reject)=>Promise.resolve({data:rows[table]??[],error:null}).then(resolve,reject)};return api}};`
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/__print?')) return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__print_entry.js"></script></body></html>'))
    })
  },
}
const cacheDir = await mkdtemp(path.join(tmpdir(), 'patient-letter-print-test-'))
const server = await createServer({ root, configFile: false, cacheDir, plugins: [plugin, react(), tailwind()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ channel: 'chrome' })
const printName = /^พิมพ์หนังสือขอความอนุเคราะห์รถรับ/
const savePrintName = /^บันทึกและพิมพ์หนังสือขอความอนุเคราะห์รถรับ/
let passed = 0
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    await context.addInitScript(() => {
      window.print = () => { window.__printCount = (window.__printCount || 0) + 1 }
      const open = window.open.bind(window)
      window.open = (...args) => { window.__opened = (window.__opened || 0) + 1; return window.__blockPopup ? null : open(...args) }
    })
    const page = await context.newPage()
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    async function open(query = 'confirmed=1') {
      await page.goto(base + '/__print?' + query)
      await page.getByRole('button', { name: 'เลือกเอกสารที่จะพิมพ์: TEST ผู้ป่วยตัวอย่าง', exact: true }).click()
      const docs = page.locator('section[aria-label="เอกสารของผู้เดินทาง"]')
      await docs.waitFor()
      return docs
    }
    async function fill(docs, number = 'ทด 2569/77') {
      await docs.getByLabel('เลขที่หนังสือ (ที่)', { exact: true }).fill(number)
      await docs.getByLabel('ลงวันที่', { exact: true }).fill('2026-10-01')
    }
    async function printed(button, number, expectedDay = null) {
      const wait = page.waitForEvent('popup'); await button.click(); const popup = await wait
      await popup.waitForFunction(() => window.__printCount === 1)
      assert.equal(await popup.locator('.sheet').count(), 2)
      assert.equal((await popup.locator('.letter-no').innerText()).replace(/\s+/g, ' ').trim(), number ? `ที่ ${number}` : '')
      assert.equal(await popup.locator('.letter-no .fill-blank').count(), 0, 'missing number must leave clean space without dotted placeholder')
      if (expectedDay) assert.match(await popup.locator('.letter-date').innerText(), new RegExp(`^${Number(expectedDay)} .*2569$`))
      const text = (await popup.locator('.sheet').allInnerTexts()).join('\n')
      assert.ok(text.includes(booking.patient_name) && !text.includes('TEST ผู้ป่วยคนอื่น'))
      await popup.getByRole('button', { name: 'ปิดหน้าต่าง' }).click()
    }
    const pass = name => { passed++; console.log(`PASS ${width}px ${name}`) }

    let docs = await open()
    const number = docs.getByLabel('เลขที่หนังสือ (ที่)', { exact: true })
    assert.equal(await number.inputValue(), booking.forward_letter_no)
    assert.equal(await docs.getByLabel('ลงวันที่', { exact: true }).inputValue(), booking.forward_letter_date, 'recorded issue date must be preserved for reprint')
    for (const control of [number, docs.getByLabel('ลงวันที่', { exact: true }), docs.getByRole('button', { name: printName })]) {
      await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox()
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width, JSON.stringify(box))
    }
    await printed(docs.getByRole('button', { name: printName }), booking.forward_letter_no)
    assert.equal(await page.evaluate(() => window.__rpcCalls?.length || 0), 0)
    pass('existing-number prints directly without redundant save')

    await fill(docs)
    await printed(docs.getByRole('button', { name: savePrintName }), 'ทด 2569/77', true)
    const [call] = await page.evaluate(() => window.__rpcCalls)
    assert.deepEqual(call.args, { p_booking: booking.id, p_letter_revision: 1, p_letter_no: 'ทด 2569/77', p_letter_date: '2026-10-01' })
    assert.ok(call.popupOpened > 0, 'popup must be opened before asynchronous save')
    assert.equal(await page.evaluate(() => window.__qaWorkspace.bookings[1].forward_letter_no), 'ทด 2569/2')
    pass('save-and-print uses entered values and saves only selected person')

    docs = await open(); await fill(docs, 'ทด 2569/ล้มเหลว')
    await page.evaluate(() => { window.__qaFail = true })
    const failedPopup = page.waitForEvent('popup'); await docs.getByRole('button', { name: savePrintName }).click()
    const popup = await failedPopup; if (!popup.isClosed()) await popup.waitForEvent('close')
    await page.getByRole('alert').filter({ hasText: 'TEST บันทึกไม่สำเร็จ' }).first().waitFor()
    assert.equal(await docs.getByLabel('เลขที่หนังสือ (ที่)', { exact: true }).inputValue(), 'ทด 2569/ล้มเหลว')
    await page.evaluate(() => { window.__qaFail = false })
    await printed(docs.getByRole('button', { name: savePrintName }), 'ทด 2569/ล้มเหลว', true)
    pass('save failure closes loading popup, preserves draft and supports retry')

    docs = await open(); await fill(docs, 'ทด 2569/ฉันแก้')
    await page.evaluate(() => window.__qaRefresh())
    await docs.getByRole('alert').filter({ hasText: 'มีข้อมูลใหม่ระหว่างที่คุณกรอก' }).waitFor()
    assert.equal(await docs.getByRole('button', { name: savePrintName }).isDisabled(), true)
    assert.equal(await docs.getByLabel('เลขที่หนังสือ (ที่)', { exact: true }).inputValue(), 'ทด 2569/ฉันแก้')
    await docs.getByRole('button', { name: 'ยืนยันใช้ค่าที่ฉันแก้', exact: true }).click()
    await printed(docs.getByRole('button', { name: savePrintName }), 'ทด 2569/ฉันแก้', true)
    assert.equal(await page.evaluate(() => window.__rpcCalls[0].args.p_letter_revision), 2)
    pass('revision conflict requires explicit review before replacing latest number')

    docs = await open(); await fill(docs)
    await docs.getByRole('button', { name: 'บันทึกเลขที่/วันที่อย่างเดียว', exact: true }).click()
    await docs.getByRole('button', { name: printName }).waitFor()
    assert.equal(await page.evaluate(() => window.__opened || 0), 0)
    await printed(docs.getByRole('button', { name: printName }), 'ทด 2569/77', true)
    assert.equal(await page.evaluate(() => window.__rpcCalls.length), 1)
    pass('save-only remains available and reprint does not save again')

    docs = await open()
    await docs.getByLabel('ลงวันที่', { exact: true }).fill('2026-10-03')
    await printed(docs.getByRole('button', { name: savePrintName }), booking.forward_letter_no, 3)
    assert.deepEqual(await page.evaluate(() => window.__rpcCalls[0].args), { p_booking: booking.id, p_letter_revision: 1, p_letter_no: booking.forward_letter_no, p_letter_date: '2026-10-03' })
    pass('date-only correction saves without changing an existing letter number')

    docs = await open(); await fill(docs)
    await page.evaluate(() => { window.__blockPopup = true })
    await docs.getByRole('button', { name: savePrintName }).click()
    await page.getByRole('alert').filter({ hasText: 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์' }).first().waitFor()
    assert.equal(await page.evaluate(() => window.__rpcCalls?.length || 0), 0)
    assert.equal(await docs.getByLabel('เลขที่หนังสือ (ที่)', { exact: true }).inputValue(), 'ทด 2569/77')
    pass('blocked popup does not save and draft stays available')

    docs = await open('blank=1')
    assert.equal(await docs.getByLabel('ลงวันที่', { exact: true }).inputValue(), '2026-10-01', 'default must use Bangkok confirmation day, not appointment, submission or updated date')
    let popupWait = page.waitForEvent('popup'); await docs.getByRole('button', { name: printName }).click(); let blank = await popupWait
    await blank.waitForFunction(() => window.__printCount === 1)
    assert.equal((await blank.locator('.letter-no').innerText()).trim(), '')
    assert.equal(await blank.locator('.letter-no .fill-blank').count(), 0)
    assert.equal(await blank.locator('.letter-date .fill-blank').count(), 0)
    assert.match(await blank.locator('.letter-date').innerText(), /^1 .*2569$/)
    await blank.close()
    assert.equal(await page.evaluate(() => window.__rpcCalls?.length || 0), 0)
    pass('blank number prints with Bangkok confirmation date, without database write')
    await docs.getByLabel('ลงวันที่', { exact: true }).fill('2026-10-03')
    assert.equal(await docs.getByRole('button', { name: 'บันทึกเลขที่/วันที่อย่างเดียว', exact: true }).count(), 0)
    await printed(docs.getByRole('button', { name: printName }), '', 3)
    assert.equal(await page.evaluate(() => window.__rpcCalls?.length || 0), 0)
    pass('editable draft date prints before number assignment without database write')

    await docs.getByRole('button', { name: 'ใช้ค่าที่บันทึกไว้', exact: true }).click()
    await docs.getByLabel('เลขที่หนังสือ (ที่)', { exact: true }).fill('ทด 2569/วันยืนยัน')
    assert.equal(await docs.getByLabel('ลงวันที่', { exact: true }).inputValue(), '2026-10-01', 'entering a number must keep the confirmation date')
    await printed(docs.getByRole('button', { name: savePrintName }), 'ทด 2569/วันยืนยัน', true)
    assert.equal(await page.evaluate(() => window.__rpcCalls[0].args.p_letter_date), '2026-10-01')
    pass('new number saves and prints the automatic confirmation date')

    docs = await open('blank=1&no-confirmation=1')
    assert.equal(await docs.getByLabel('ลงวันที่', { exact: true }).inputValue(), '', 'missing confirmation timestamp must not invent a date')
    popupWait = page.waitForEvent('popup'); await docs.getByRole('button', { name: printName }).click(); blank = await popupWait
    await blank.waitForFunction(() => window.__printCount === 1)
    assert.equal(await blank.locator('.letter-date .fill-blank').count(), 3)
    await blank.close()
    pass('missing confirmation evidence keeps date blank instead of guessing today')

    docs = await open('pending=1')
    assert.equal(await docs.getByLabel('เลขที่หนังสือ (ที่)', { exact: true }).count(), 0)
    assert.equal(await docs.getByRole('button', { name: printName }).isDisabled(), true)
    popupWait = page.waitForEvent('popup'); await docs.getByRole('button', { name: /พิมพ์ใบคำขอรถรับ/ }).click(); blank = await popupWait
    await blank.waitForFunction(() => window.__printCount === 1)
    assert.equal(await blank.locator('.sheet').count(), 1); await blank.close()
    pass('pending citizen request prints while fund fields remain unavailable')

    await page.goto(base + '/__print?legacy=1&draft=1')
    const legacyNumber = page.getByLabel('เลขที่หนังสือ (ที่)', { exact: true })
    await legacyNumber.waitFor(); await legacyNumber.fill('ทด 2569/ก่อนส่ง')
    await page.getByLabel('ลงวันที่', { exact: true }).fill('2026-10-01')
    await printed(page.getByRole('button', { name: printName }), 'ทด 2569/ก่อนส่ง', true)
    pass('legacy request accepts draft number/date before print without marking sent')

    await page.goto(base + '/__print?legacy=1')
    await legacyNumber.waitFor()
    assert.equal(await legacyNumber.inputValue(), booking.forward_letter_no)
    assert.equal(await legacyNumber.isDisabled(), true)
    await printed(page.getByRole('button', { name: printName }), booking.forward_letter_no)
    pass('legacy reprint uses recorded number/date')

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    if (process.env.PATIENT_LETTER_PRINT_SCREENSHOT_DIR) {
      await mkdir(process.env.PATIENT_LETTER_PRINT_SCREENSHOT_DIR, { recursive: true })
      docs = await open(); await fill(docs)
      await page.screenshot({ path: path.join(process.env.PATIENT_LETTER_PRINT_SCREENSHOT_DIR, `before-print-${width}.png`) })
    }
    await context.close()
  }
  console.log(`Passed ${passed} UI cases; all database/network calls isolated`)
} finally { await browser.close(); await server.close() }
