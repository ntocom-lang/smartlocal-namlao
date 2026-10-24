// Actual staff detail UI with synthetic fixtures. No production client or external requests.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const booking = { id: 'test-booking', patient_name: 'TEST ผู้เดินทาง', requester_name: 'TEST ผู้ขอ', phone: '0800000000',
  status: 'confirmed', trip_id: 'test-trip', revision: 7, passenger_step: 0, route_id: 'a', route_label: 'TEST โรงพยาบาล',
  appointment_at: '2026-11-05T10:00:00+07:00', return_at: '2026-11-05T17:00:00+07:00', return_mode: 'wait', mobility: 'walk', companions: 0, share: true }
const trip = { id: 'test-trip', state: 'confirmed', revision: 9, docs_revision: 1, driver_id: 'driver', created_at: '2026-10-24T08:00:00+07:00',
  plan: { date: '2026-11-05', route_id: 'a', route_label: 'TEST โรงพยาบาล', return_mode: 'wait', appointment_at: booking.appointment_at, return_at: booking.return_at } }
const seed = { role: 'admin', settings: { seats: 10, driver_id: 'driver', routes: [{ id: 'a', label: 'TEST โรงพยาบาล' }] },
  bookings: [booking], trips: [trip], events: [], people: [], odometer: { failed: false, days: [] } }
const plugin = {
  name: 'isolated-cancel-details', enforce: 'pre',
  resolveId(id) { if (id === '/__cancel.js') return '\0cancel-entry' },
  load(id) {
    const name = id.replaceAll('\\', '/')
    if (name.endsWith('/contexts/TenantContext.jsx')) return "export const useTenant=()=>({tenant:{id:'test',name:'อบต. TEST'}})"
    if (name.endsWith('/lib/supabase.js')) return "export const supabase={rpc:async()=>({data:{events:[]},error:null})}"
    if (id !== '\0cancel-entry') return
    return `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Inbox from'/src/components/patientTransport/BookingInbox.jsx';import'/src/index.css';
      const ws=${JSON.stringify(seed)},q=new URLSearchParams(location.search),b=ws.bookings[0],t=ws.trips[0];
      ws.role=q.get('role')||'admin';b.passenger_step=Number(q.get('step')||0);t.state=q.get('state')||'confirmed';
      if(q.has('requested'))b.cancel_requested=true;
      if(q.has('shared')){ws.bookings.push({...b,id:'test-other',patient_name:'TEST ผู้ร่วมเที่ยว',cancel_requested:false});}
      if(q.has('pending')){b.status='submitted';b.trip_id=null;ws.trips=[];}
      if(q.has('terminal')){b.status=q.get('terminal');t.state=b.status;}
      if(q.has('missing'))ws.trips=[];
      if(t.state==='issue')t.state_before_issue=q.get('before')||'confirmed';
      window.__calls=[];window.__fail=false;window.__hold=false;
      function App(){const[busy,setBusy]=useState(false),[error,setError]=useState('');
        async function run(kind,entity,action,note,trip){window.__calls.push({kind,id:entity.id,revision:entity.revision,action,note,...(trip?{trip:trip.id}:{})});setBusy(true);setError('');
          if(window.__hold)await new Promise(resolve=>window.__release=resolve);
          setBusy(false);if(window.__fail){setError('TEST บันทึกไม่สำเร็จ กรุณาลองใหม่');return false;}return true;}
        const no=()=>{};return React.createElement(Inbox,{detailOnly:true,initialOpenId:b.id,workspace:ws,isAdmin:ws.role==='admin',currentUserId:'admin',busy,error,
          onAction:(entity,action,note)=>run('action',entity,action,note),onRemove:(entity,trip,note)=>run('remove',entity,'cancel_passenger',note,trip),
          onConfirm:no,onReload:no,onOpenDriver:no,onCloseBooking:no,onAmend:no,onUpdatePickup:no,onDelete:no});}
      createRoot(document.getElementById('root')).render(React.createElement('main',{className:'text-slate-900'},React.createElement(App)));`
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url?.split('?')[0] !== '/__cancel') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__cancel.js"></script></body></html>'))
    })
  },
}
const cacheDir = await mkdtemp(path.join(tmpdir(), 'patient-cancel-ui-'))
const server = await createServer({ root, configFile: false, envDir: false, cacheDir, plugins: [plugin, react(), tailwind()], logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}/__cancel`
const browser = await chromium.launch({ channel: 'chrome' })
const shots = path.join(root, 'tmp/cancel-ui')
await mkdir(shots, { recursive: true })
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    const detail = page.getByRole('dialog', { name: booking.patient_name, exact: true })
    const section = detail.getByRole('region', { name: 'ยกเลิกคำขอหรือการเดินทาง' })
    const launch = section.getByRole('button', { name: 'ยกเลิกการเดินทาง', exact: true })
    const reason = section.getByRole('textbox', { name: 'เหตุผลการยกเลิก' })
    const submit = section.getByRole('button', { name: 'ยืนยันยกเลิกการเดินทาง', exact: true })
    const calls = () => page.evaluate(() => window.__calls)
    async function open(query = '') { await page.goto(base + '?' + query); await detail.waitFor() }
    async function agree(button = submit) {
      let message = ''
      page.once('dialog', async d => { message = d.message(); await d.accept() })
      await button.click()
      return message
    }

    await open()
    const box = await launch.boundingBox()
    assert.ok(box.y >= 0 && box.y + box.height < 900 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, JSON.stringify(box))
    assert.equal(await detail.locator('details[open]').count(), 0, 'must be visible without opening additional actions')
    await page.screenshot({ path: path.join(shots, `detail-${width}.png`) })
    await launch.click()
    assert.equal(await submit.isDisabled(), true)
    await reason.fill('   '); assert.equal(await submit.isDisabled(), true)
    await reason.fill('TEST ผู้ป่วยเลื่อนนัด')
    for (const control of [reason, submit]) {
      const bounds = await control.boundingBox()
      assert.ok(bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify(bounds))
    }
    page.once('dialog', d => d.dismiss()); await submit.click()
    assert.deepEqual(await calls(), [], 'dismissing confirmation must not mutate')
    assert.equal(await reason.inputValue(), 'TEST ผู้ป่วยเลื่อนนัด')
    await section.getByRole('button', { name: 'เก็บรายการไว้', exact: true }).click()
    assert.deepEqual(await calls(), [])
    await launch.click()
    await page.screenshot({ path: path.join(shots, `reason-${width}.png`) })
    const prompt = await agree()
    await detail.waitFor({ state: 'detached' })
    assert.ok(prompt.includes(booking.patient_name) && prompt.includes('TEST ผู้ป่วยเลื่อนนัด') && prompt.includes('คนสุดท้าย'))
    assert.deepEqual(await calls(), [{ kind: 'remove', id: booking.id, revision: 7, action: 'cancel_passenger', note: 'TEST ผู้ป่วยเลื่อนนัด', trip: trip.id }])

    await open('shared=1&role=coordinator')
    await launch.click(); await reason.fill('TEST ไม่เดินทาง')
    assert.ok((await agree()).includes('ผู้เดินทางอีก 1 รายในเที่ยวไม่เปลี่ยน'))
    await detail.waitFor({ state: 'detached' })
    assert.equal((await calls())[0].id, booking.id)

    await open('pending=1')
    await section.getByRole('button', { name: 'ยกเลิกคำขอ', exact: true }).click()
    await reason.fill('TEST โทรมายกเลิก'); await agree(); await detail.waitFor({ state: 'detached' })
    assert.deepEqual(await calls(), [{ kind: 'action', id: booking.id, revision: 7, action: 'cancel', note: 'TEST โทรมายกเลิก' }])

    for (const query of ['requested=1', 'requested=1&state=issue', 'requested=1&shared=1']) {
      await open(query)
      assert.equal(await reason.inputValue(), 'ผู้จองขอยกเลิก')
      await agree(section.getByRole('button', { name: 'ยกเลิกให้ตามที่ขอ', exact: true })); await detail.waitFor({ state: 'detached' })
      const [call] = await calls()
      assert.equal(call.action, query.includes('shared') ? 'cancel_passenger' : 'release')
      assert.equal(call.id, query.includes('shared') ? booking.id : trip.id)
    }

    for (const query of ['state=outbound&step=1', 'state=returning&step=3', 'requested=1&state=issue&step=1&before=outbound']) {
      await open(query); assert.equal(await launch.isDisabled(), true)
      assert.equal(await reason.count(), 0)
      await section.getByText('ผู้เดินทางอยู่ระหว่างรับ–ส่ง', { exact: false }).waitFor()
      assert.deepEqual(await calls(), [])
    }
    await open('state=hospital&step=2&shared=1')
    await launch.click(); await reason.fill('TEST ประสานญาติมารับกลับแล้ว')
    await agree(); await detail.waitFor({ state: 'detached' })
    assert.equal((await calls())[0].action, 'cancel_passenger')

    for (const query of ['terminal=completed', 'terminal=cancelled', 'missing=1', 'role=driver', 'role=citizen']) {
      await open(query); assert.equal(await section.count(), 0, query)
      assert.deepEqual(await calls(), [])
    }

    await open(); await launch.click(); await reason.fill('TEST เครือข่ายขัดข้อง')
    await page.evaluate(() => { window.__fail = true })
    await agree(); await detail.getByRole('alert').filter({ hasText: 'TEST บันทึกไม่สำเร็จ' }).waitFor()
    assert.equal(await reason.inputValue(), 'TEST เครือข่ายขัดข้อง')
    await page.evaluate(() => { window.__fail = false; window.__hold = true })
    await agree(); await page.waitForFunction(() => !!window.__release)
    assert.equal(await submit.isDisabled(), true); assert.equal(await launch.isDisabled(), true)
    assert.equal((await calls()).length, 2)
    await page.evaluate(() => window.__release()); await detail.waitFor({ state: 'detached' })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px cancel UI: prominent action, required reason, confirmation dismiss/accept, role/state guards, shared/solo/pending/requested, failure/retry/busy`)
    await context.close()
  }
} finally { await browser.close(); await server.close() }
