// หน้าตรวจสอบเอกสารลงนามออนไลน์สาธารณะ /v/<รหัส> (ชุด S4) — ทดสอบในเบราว์เซอร์จริง ไม่ต้องล็อกอิน
//
// ดักเฉพาะ esign_verify (ตอบแบบจำลอง) จึงไม่เขียน/ไม่อ่านข้อมูลเอกสารจริงของ อปท. ใดเลย
// ตรวจ: ทุกสถานะ (ครบ/ไม่ครบ/ยังไม่ลงนาม/เนื้อหาไม่ตรง/คำขอถูกยกเลิก) · ไม่พบ · รหัสผิดรูปไม่ถูกส่งไปถาม DB · เปิดถี่เกิน (PT429) ลองใหม่ได้ · error
//   หน้านี้ไม่มีรูป และไม่แสดงฟิลด์ใดนอกรายการที่อนุญาต (ใส่ปลายทาง/ภาพลายเซ็นปลอมไว้ในคำตอบจำลองแล้วดูว่าไม่ขึ้น) · noindex · มือถือ 390/360 ไม่ล้น
//
//   ES_TEST_BASE_URL=http://demo.localhost:5176 node tests/esign-verify.playwright.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const BASE = (process.env.ES_TEST_BASE_URL || 'http://demo.localhost:5174').replace(/\/$/, '')
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'demo.localhost', 'localhost', '127.0.0.1'])
if (!ALLOWED_HOSTS.has(new URL(BASE).hostname)) throw new Error(`ปฏิเสธการยิงไปที่ ${new URL(BASE).hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)
const CODE = '0123456789abcdef0123456789abcdef'

const slot = (key, label, extra = {}) => ({ slot: key, label, signed: false, ...extra })
const signedSlot = (key, label, name, extra = {}) => slot(key, label, {
  signed: true, signer_name: name, signer_position: 'ตำแหน่งในโปรไฟล์', signed_as: '', decision: key === 'authority' ? 'approve' : 'sign', signed_at: '2026-10-23T04:00:00Z', ...extra,
})
const verifyResult = (overrides = {}) => ({
  found: true, municipality_name: 'เทศบาลตำบลสาธิต', doc_type: 'fleet_trip_request', doc_label: 'ใบขออนุญาตใช้ยานพาหนะส่วนกลาง/รถรับรอง (แบบ 3)', document_date: '2026-10-23',
  trip_status: 'active', state: 'complete', required: 3, signed_count: 3, revoked_count: 0,
  slots: [
    signedSlot('requester', 'ผู้ขออนุญาต', 'นางสาวสมหญิง ผู้ขอ'),
    signedSlot('dept_head', 'ผู้อำนวยการสำนัก/กอง หรือผู้แทน', 'นายสมชาย หัวหน้ากอง', { signed_as: 'ผู้อำนวยการกองช่าง', signed_at: '2026-10-23T05:30:00Z' }),
    signedSlot('authority', 'ผู้มีอำนาจสั่งใช้ยานพาหนะ', 'นายสมศักดิ์ นายก', { signed_as: 'นายกเทศมนตรีตำบลสาธิต', signed_at: '2026-10-23T06:45:00Z' }),
  ],
  // ฟิลด์ที่ฝั่ง DB ไม่ส่งจริง — ใส่ไว้ในคำตอบจำลองเพื่อพิสูจน์ว่าหน้าไม่แสดงของนอกรายการ
  destination: 'ปลายทางลับห้ามขึ้น', purpose: 'วัตถุประสงค์ลับห้ามขึ้น', png_base64: 'iVBORw0KGgo=',
  ...overrides,
})

const browser = await chromium.launch({ channel: 'chrome', headless: true })
let calls = []
let handler = () => ({ status: 200, body: verifyResult() })

async function newPage(width = 1280, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } })
  await context.route(/\/rest\/v1\/rpc\/esign_verify(\?|$)/, async route => {
    const request = route.request()
    const cors = {
      'access-control-allow-origin': request.headers().origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*',
      'access-control-allow-credentials': 'true',
    }
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
    calls.push(request.postDataJSON())
    const { status, body } = handler(calls.length)
    await route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
  })
  const page = await context.newPage()
  return { page, context }
}

async function open(page, code = CODE) {
  await page.goto(`${BASE}/v/${code}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.locator('[data-verify-page]').waitFor({ timeout: 30_000 })
}
const settled = page => page.locator('[data-verify-state], [data-verify-notfound], [data-verify-error]').first().waitFor({ timeout: 20_000 })
const text = page => page.locator('[data-verify-page]').innerText()
const noOverflow = async (page, where) => {
  const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))
  assert.ok(m.scrollW <= m.clientW + 1, `${where}: เลื่อนแนวนอน (${m.scrollW} > ${m.clientW})`)
}

let total = 0
let failed = 0
const run = async (label, fn) => {
  total += 1
  calls = []
  handler = () => ({ status: 200, body: verifyResult() })
  const { page, context } = await newPage()
  try {
    const note = await fn(page, context)
    console.log(`PASS  ${label}${note ? ` — ${note}` : ''}`)
  } catch (error) {
    failed += 1
    if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `verify-fail-${total}.png`) }).catch(() => {})
    console.log(`FAIL  ${label} — ${String(error.message).split('\n').slice(0, 3).join(' | ')}`)
  } finally { await context.close().catch(() => {}) }
}

await run('ลงนามครบ: สถานะเขียว · ชื่อ/ตำแหน่งที่ลงนาม/เวลา · ไม่ล็อกอิน · ส่ง p_code', async page => {
  await open(page)
  await settled(page)
  assert.equal(new URL(page.url()).pathname, `/v/${CODE}`, 'ถูกพาออกจากหน้าตรวจสอบ (ต้องเปิดได้โดยไม่ล็อกอิน)')
  assert.ok(calls.length >= 1 && calls.every(call => call.p_code === CODE && Object.keys(call).length === 1), `ต้องส่งเฉพาะ p_code ของลิงก์: ${JSON.stringify(calls)}`)
  assert.equal(await page.locator('[data-verify-state]').getAttribute('data-verify-state'), 'complete')
  const content = await text(page)
  // หัวของหน้านี้ (ไม่ใช่ <header> ของเปลือกแอปที่มีชื่อ อปท. ของผู้เช่าเสมอ) — ต้องใช้ชื่อหน่วยงานจากเอกสารที่ตรวจสอบ
  const header = await page.locator('h1', { hasText: 'ตรวจสอบเอกสารลงนามออนไลน์' }).locator('xpath=..').innerText()
  assert.ok(header.includes('เทศบาลตำบลสาธิต') && header.includes('ตรวจสอบเอกสารลงนามออนไลน์'), `หัวหน้าไม่บอกหน่วยงาน/ชื่อหน้า: ${header}`)
  for (const expected of ['ลงนามออนไลน์ครบทุกช่อง', 'เนื้อหาตรงกับที่ลงนามไว้', 'ใบขออนุญาตใช้ยานพาหนะส่วนกลาง/รถรับรอง (แบบ 3)', 'ลงวันที่ 23 ตุลาคม พ.ศ. 2569',
    'นางสาวสมหญิง ผู้ขอ', 'นายสมชาย หัวหน้ากอง', 'ผู้อำนวยการกองช่าง', 'นายสมศักดิ์ นายก', 'นายกเทศมนตรีตำบลสาธิต', 'อนุมัติเมื่อ', 'ลงนามเมื่อ']) {
    assert.ok(content.includes(expected), `ไม่มี "${expected}"`)
  }
  assert.equal(await page.locator('[data-verify-slot]').count(), 3)
  assert.equal(await page.locator('[data-verify-slot-signed="yes"]').count(), 3)
  assert.ok((await page.locator('[data-verify-note]').innerText()).includes('ไม่แสดงภาพลายเซ็น'))
  return 'ครบ ๓ ช่อง'
})

await run('ไม่แสดงภาพ/เนื้อหาคำขอ: ไม่มีรูปในหน้า · ฟิลด์ปลายทาง/วัตถุประสงค์/ภาพที่ไม่ได้รับอนุญาตไม่ขึ้น', async page => {
  await open(page)
  await settled(page)
  assert.equal(await page.locator('[data-verify-page] img').count(), 0, 'หน้าตรวจสอบสาธารณะต้องไม่มีรูป')
  const html = await page.content()
  for (const secret of ['ปลายทางลับห้ามขึ้น', 'วัตถุประสงค์ลับห้ามขึ้น', 'iVBORw0KGgo']) assert.ok(!html.includes(secret), `หน้ามี "${secret}"`)
  return 'ไม่มีรูป ไม่มีฟิลด์นอกรายการ'
})

await run('ลงนามไม่ครบ / ยังไม่ลงนาม', async (page, context) => {
  handler = () => ({ status: 200, body: verifyResult({ state: 'partial', signed_count: 1, slots: [signedSlot('requester', 'ผู้ขออนุญาต', 'นางสาวสมหญิง ผู้ขอ'), slot('dept_head', 'ผอ.กอง'), slot('authority', 'ผู้มีอำนาจ')] }) })
  await open(page)
  await settled(page)
  assert.ok((await text(page)).includes('ลงนามออนไลน์แล้ว 1 จาก 3 ช่อง'))
  assert.equal(await page.locator('[data-verify-slot-signed="no"]').count(), 2)
  assert.ok((await page.locator('[data-verify-slot="dept_head"]').innerText()).includes('ยังไม่ลงนามออนไลน์'))
  // ยังไม่มีผู้ลงนามเลย
  handler = () => ({ status: 200, body: verifyResult({ state: 'unsigned', signed_count: 0, slots: [slot('requester', 'ผู้ขออนุญาต')] }) })
  await page.reload()
  await settled(page)
  assert.ok((await text(page)).includes('ยังไม่มีการลงนามออนไลน์'))
  void context
  return 'บางช่อง + ไม่มีเลย'
})

await run('เนื้อหาไม่ตรงกับที่ลงนาม: เตือนห้ามใช้', async page => {
  handler = () => ({ status: 200, body: verifyResult({ state: 'modified' }) })
  await open(page)
  await settled(page)
  const content = await text(page)
  assert.ok(content.includes('เนื้อหาไม่ตรงกับที่ลงนามไว้') && content.includes('ห้ามใช้เอกสารนี้'))
  assert.equal(await page.locator('[data-verify-state]').getAttribute('data-verify-state'), 'modified')
  assert.ok((await page.locator('[data-verify-state]').getAttribute('class')).includes('red'), 'สีแดง')
  return 'สีแดง + ห้ามใช้'
})

await run('คำขอถูกยกเลิก/ไม่อนุมัติ แม้ลายเซ็นครบ: ไม่เป็นสีเขียว + บอกชัด · มีการถอนลายเซ็นมาก่อน = บอกจำนวน', async page => {
  handler = () => ({ status: 200, body: verifyResult({ trip_status: 'cancelled', revoked_count: 2 }) })
  await open(page)
  await settled(page)
  assert.ok((await page.locator('[data-verify-closed]').innerText()).includes('ยกเลิกแล้ว'))
  const cls = await page.locator('[data-verify-state]').getAttribute('class')
  assert.ok(cls.includes('amber') && !cls.includes('emerald'), `คำขอปิดแล้วต้องไม่เป็นสีเขียว (${cls})`)
  assert.ok((await page.locator('[data-verify-revoked]').innerText()).includes('2 ครั้ง'))
  handler = () => ({ status: 200, body: verifyResult({ trip_status: 'rejected' }) })
  await page.reload()
  await settled(page)
  assert.ok((await page.locator('[data-verify-closed]').innerText()).includes('ไม่อนุมัติแล้ว'))
  return 'ยกเลิก + ไม่อนุมัติ'
})

await run('ไม่พบ / รหัสผิดรูปไม่ถูกส่งไปถาม DB', async page => {
  handler = () => ({ status: 200, body: { found: false } })
  await open(page)
  await settled(page)
  assert.ok((await text(page)).includes('ไม่พบเอกสารนี้ในระบบ'))
  assert.ok((await text(page)).includes('อย่าถือว่าใบที่ถืออยู่ลงนามออนไลน์แล้ว'))
  assert.ok(calls.length >= 1)
  calls = []
  for (const bad of ['abc', CODE.toUpperCase(), CODE.slice(1), `${CODE}0`]) {
    await open(page, bad)
    await settled(page)
    assert.ok((await text(page)).includes('ไม่พบเอกสารนี้ในระบบ'), bad)
  }
  assert.equal(calls.length, 0, 'รหัสผิดรูปต้องไม่ยิง esign_verify (เปลืองโควตา 30 ครั้ง/5 นาที)')
  return 'ไม่พบ + 4 รหัสผิดรูปไม่ยิง RPC'
})

await run('เปิดถี่เกินโควตา (PT429) แสดงรอสักครู่ + ลองใหม่สำเร็จ · error ทั่วไปมีปุ่มลองใหม่', async page => {
  // ใช้ธงแทนการนับครั้ง (dev เรียกซ้ำสองรอบ) — จนกว่าจะกดลองใหม่ ตอบ PT429 ทุกครั้ง
  let throttled = true
  handler = () => (throttled ? { status: 400, body: { code: 'PT429', message: 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', details: null, hint: null } } : { status: 200, body: verifyResult() })
  await open(page)
  await settled(page)
  assert.ok((await text(page)).includes('เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'))
  throttled = false
  const before = calls.length
  await page.locator('[data-verify-error] button', { hasText: 'ลองใหม่' }).click()
  await page.locator('[data-verify-state]').waitFor({ timeout: 10_000 })
  assert.ok(calls.length > before, 'ปุ่มลองใหม่ต้องยิงถามใหม่')
  // error ทั่วไป
  handler = () => ({ status: 500, body: { code: 'XX000', message: 'boom', details: null, hint: null } })
  await page.reload()
  await settled(page)
  assert.ok((await text(page)).includes('ตรวจสอบไม่สำเร็จ'))
  return 'busy → ลองใหม่ผ่าน · error → เตือน'
})

await run('noindex: ลิงก์ที่แชร์ต่อไม่โผล่ในผลค้นหา', async page => {
  await open(page)
  await settled(page)
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="robots"]')?.content), 'noindex')
  return 'meta robots = noindex'
})

for (const [width, height] of [[390, 844], [360, 740]]) {
  await run(`มือถือ ${width}: ไม่ล้น แม้ชื่อ/ตำแหน่งยาวมาก`, async (page, context) => {
    const long = 'ก'.repeat(120)
    handler = () => ({ status: 200, body: verifyResult({ slots: verifyResult().slots.map((item, index) => (index === 0 ? { ...item, signer_name: `นาย${long}`, signed_as: `ผู้อำนวยการกอง${long} รักษาราชการแทน ปลัดองค์การบริหารส่วนตำบล` } : item)) }) })
    await page.setViewportSize({ width, height })
    await open(page)
    await settled(page)
    await noOverflow(page, `${width}px`)
    if (process.env.ES_SHOTS) await page.screenshot({ path: path.join(process.env.ES_SHOTS, `verify-${width}.png`), fullPage: true })
    void context
    return `${width}px ไม่ล้น`
  })
}

await browser.close()
console.log(`\n${total - failed}/${total} ผ่าน`)
process.exit(failed ? 1 : 0)
