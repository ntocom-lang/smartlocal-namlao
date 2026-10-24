// ใบพิมพ์ลงนามออนไลน์ (ชุด S4) — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ในเบราว์เซอร์: แบบ ๓ และ สก.๑
//   node tests/esign-print-layout.test.mjs
//
// สิ่งที่วัดได้เฉพาะจากการเรนเดอร์จริง (เนื้อหา HTML ดู tests/esign-print.test.mjs):
//   1. ลงนามออนไลน์ครบ (ภาพ 3 ช่อง + วันที่ + เส้นหลักฐาน/QR ท้ายใบ) ใบต้องยังจบ 1 หน้า A4 แม้ตำแหน่ง "รักษาราชการแทน" ยาวสุด
//   2. ภาพลายเซ็นนั่งบนเส้นของตัวเอง (ก้นภาพอยู่ที่เส้น) และไม่ทับตัวอักษรใดบนใบ — ภาพลอยเหนือเส้น (absolute) ถ้าที่ว่างเหนือเส้นไม่พอ ภาพจะไปทับบล็อกก่อนหน้า
//   3. ภาพไม่ล้นขอบกระดาษ · QR ท้ายใบอยู่ในพื้นที่พิมพ์
//   4. ใบเซ็นสด (ไม่มี esign) สูงเท่าเดิมทุกพิกเซล — ใบของ อปท. ที่ไม่เปิดใช้ต้องไม่ขยับ
// ⚠️ วัดกล่องตัวอักษรจริงด้วย Range (ไม่ใช่กล่องของ element) ตามกติกาของโปรเจกต์
import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildFleetSk1Html, buildFleetTripRequestHtml } from '../src/lib/fleetTripPrint.js'
import { esignPrintData } from '../src/lib/esignPrint.js'
import {
  VERIFY_CODE, deptHead, fullStatus, onlineTrip, orderAuthority, samplePng, signature, slotStatus, tenant, trip,
} from './lib/esignPrintFixtures.mjs'

// ⚠️ วัดที่ความกว้างพื้นที่พิมพ์จริง 160mm = 605px (โหมดพิมพ์ .sheet เป็น width:auto ขอบมาจาก @page) ไม่ใช่ 794px (A4 เต็มกว้าง):
// ที่ 794px บรรทัดไม่ตัดจึงต่ำกว่าจริง ~100px แล้วใบที่ตกหน้า 2 จะ "ผ่าน" ลวง (วัดซ้ำแล้ว 2569-10-24)
const PRINT_WIDTH_PX = 605
const PRINTABLE_HEIGHT_PX = 1043 // 276mm — ค่าเดียวกับ tests/fleet-form3-layout.test.mjs
const MM = 3.7795

// ภาพ 2:1 ขนาดสูงสุดที่ระบบรับ (640×320) และภาพกว้างพิเศษ — ต้องถูกจำกัดด้วย max-height/max-width ไม่ดันใบ
const WIDE = samplePng(640, 160).toString('base64')
const SQUARE = samplePng(320, 320).toString('base64')
const TWO_TO_ONE = samplePng(640, 320).toString('base64')
const stamps = (images = {}) => ({ ok: true, items: Object.entries(images).map(([slot, png]) => ({ slot, signature_id: 's-' + slot, width: 640, height: 320, png_base64: png })) })
const dataFor = (status, images) => esignPrintData({ status, stamps: stamps(images), verifyCode: VERIFY_CODE, origin: 'https://demo.example.go.th' })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()

async function render(html) {
  await page.setViewportSize({ width: PRINT_WIDTH_PX, height: PRINTABLE_HEIGHT_PX })
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
  await page.emulateMedia({ media: 'print' })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => Promise.all([...document.images].map(img => (img.complete ? null : new Promise(resolve => { img.onload = resolve; img.onerror = resolve })))))
  // ฟอนต์ THSarabunPSK มาจากเครือข่าย: อ่านความสูงของใบซ้ำจนนิ่ง 2 รอบติด (เคยวัดได้ 952 vs 996px ในสองรอบเพราะฟอนต์ยังโหลดไม่เสร็จ)
  let last = -1
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const height = await page.evaluate(() => document.querySelector('.sheet').getBoundingClientRect().height)
    if (height === last) break
    last = height
    await page.waitForTimeout(300)
  }
}

// วัดทุกอย่างที่เกี่ยวกับภาพ: ตำแหน่งเทียบเส้นของมัน · ทับตัวอักษรอื่นไหม · ล้นกระดาษไหม · ความสูงใบ · QR
const measure = () => page.evaluate(() => {
  const sheet = document.querySelector('.sheet')
  const sheetRect = sheet.getBoundingClientRect()
  const textRects = []
  const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.replace(/[\s ]/g, '')) continue
    // ข้อความที่เป็นส่วนของช่องลายเซ็นนั้นเอง (ข้อความแทนภาพ "ลงนามออนไลน์") ไม่นับว่าถูกภาพทับ
    if (node.parentElement.closest('.esign-line, .sign-line')) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) if (rect.width > 0.5 && rect.height > 0.5) textRects.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, text: node.textContent.trim().slice(0, 40) })
  }
  const images = [...document.querySelectorAll('.esign-img')].map(img => {
    const rect = img.getBoundingClientRect()
    const line = img.closest('.signature-line, .sign-line')?.getBoundingClientRect()
    const overlaps = textRects.filter(t => Math.min(rect.right, t.right) - Math.max(rect.left, t.left) > 1 && Math.min(rect.bottom, t.bottom) - Math.max(rect.top, t.top) > 1)
    return {
      width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top,
      lineBottomGap: line ? Math.abs(rect.bottom - line.bottom) : null,
      centerOffset: line ? Math.abs((rect.left + rect.right) / 2 - (line.left + line.right) / 2) : null,
      overlaps: overlaps.map(t => t.text),
    }
  })
  const qr = document.querySelector('.esign-evidence__qr')?.getBoundingClientRect()
  return {
    sheetHeight: Math.ceil(sheetRect.height), sheetRight: sheetRect.right, sheetLeft: sheetRect.left,
    docWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    images,
    typed: document.querySelectorAll('.esign-typed').length,
    qr: qr ? { width: qr.width, height: qr.height, right: qr.right, bottom: qr.bottom } : null,
    sheetBottom: sheetRect.bottom,
    evidenceBottom: document.querySelector('.esign-evidence')?.getBoundingClientRect().bottom ?? null,
  }
})

const form3 = (esign, tripOverride = {}, deptTitle = 'ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม') => buildFleetTripRequestHtml({
  trip: { ...onlineTrip, ...tripOverride }, tenant, orderAuthority, deptHead: { ...deptHead, title: deptTitle }, esign,
})
const withSlots = signatures => fullStatus({ slots: fullStatus().slots.map(slot => (signatures[slot.slot] ? { ...slot, signature: { ...slot.signature, ...signatures[slot.slot] } } : slot)) })

function checkImages(m, label, { expectCount, maxHeightMm, maxWidthMm }) {
  assert.equal(m.images.length, expectCount, `${label}: ภาพ ${m.images.length} (ควร ${expectCount})`)
  for (const [index, image] of m.images.entries()) {
    assert.ok(image.height <= maxHeightMm * MM + 0.8, `${label}[${index}]: ภาพสูง ${(image.height / MM).toFixed(1)}mm เกิน ${maxHeightMm}mm`)
    assert.ok(image.width <= maxWidthMm * MM + 0.8, `${label}[${index}]: ภาพกว้าง ${(image.width / MM).toFixed(1)}mm เกิน ${maxWidthMm}mm`)
    assert.ok(image.lineBottomGap <= 2.5, `${label}[${index}]: ก้นภาพห่างเส้นลงนาม ${(image.lineBottomGap / MM).toFixed(1)}mm (ต้องนั่งบนเส้น)`)
    assert.ok(image.centerOffset <= 2, `${label}[${index}]: ภาพไม่อยู่กึ่งกลางเส้น เยื้อง ${(image.centerOffset / MM).toFixed(1)}mm`)
    assert.deepEqual(image.overlaps, [], `${label}[${index}]: ภาพทับตัวอักษร ${JSON.stringify(image.overlaps)}`)
    assert.ok(image.left >= m.sheetLeft - 1 && image.right <= m.sheetRight + 1, `${label}[${index}]: ภาพล้นขอบพื้นที่พิมพ์`)
  }
}

// ── 1. ใบเซ็นสด (ไม่มี esign) สูงเท่าเดิม ───────────────────────────────────────────
await render(buildFleetTripRequestHtml({ trip, tenant, orderAuthority, deptHead }))
const baseline = await measure()
await render(buildFleetTripRequestHtml({ trip, tenant, orderAuthority, deptHead, esign: null }))
assert.equal((await measure()).sheetHeight, baseline.sheetHeight, 'esign=null ต้องสูงเท่าเดิม')
assert.ok(baseline.sheetHeight <= PRINTABLE_HEIGHT_PX, `ใบเซ็นสดเกิน 1 หน้า (${baseline.sheetHeight}px)`)

// ── 2. แบบ ๓ ลงนามครบ ภาพ 2:1 ใหญ่สุด ────────────────────────────────────────────────
await render(form3(dataFor(fullStatus(), { requester: TWO_TO_ONE, dept_head: SQUARE, authority: WIDE })))
const full = await measure()
checkImages(full, 'แบบ ๓ ครบ', { expectCount: 3, maxHeightMm: 9, maxWidthMm: 40 })
assert.ok(full.sheetHeight <= PRINTABLE_HEIGHT_PX, `แบบ ๓ ลงนามครบเกิน 1 หน้า ${full.sheetHeight}px > ${PRINTABLE_HEIGHT_PX}px (เหลือจากใบเดิม ${PRINTABLE_HEIGHT_PX - baseline.sheetHeight}px)`)
assert.ok(full.qr && Math.abs(full.qr.width - 13 * MM) < 1.5, `QR ต้องกว้างราว 13mm (ได้ ${full.qr && (full.qr.width / MM).toFixed(1)}mm)`)
assert.ok(full.qr.right <= full.sheetRight + 1 && full.docWidth <= PRINT_WIDTH_PX + 1, 'QR/ใบล้นขอบขวา')

// ── 3. ข้อความแทนภาพ (ไม่ได้แนบภาพ) + ตำแหน่งรักษาราชการแทนยาวสุด ───────────────────────────
await render(form3(dataFor(withSlots({ dept_head: { signed_as: 'ผู้อำนวยการกองช่าง รักษาราชการแทน ปลัดองค์การบริหารส่วนตำบลหนองม่วงไข่' } }), { requester: TWO_TO_ONE })))
const acting = await measure()
checkImages(acting, 'แบบ ๓ ตำแหน่งยาว', { expectCount: 1, maxHeightMm: 9, maxWidthMm: 40 })
assert.equal(acting.typed, 2, 'ช่องที่ไม่แนบภาพ 2 ช่อง (ผอ.กอง + ผู้มีอำนาจ) ต้องมีข้อความ "ลงนามออนไลน์" แทน')
assert.ok(acting.sheetHeight <= PRINTABLE_HEIGHT_PX, `ตำแหน่งยาวสุดเกิน 1 หน้า ${acting.sheetHeight}px`)

// ── 4. ลงนามไม่ครบ (คำเตือน "ยังไม่ลงนาม" ท้ายใบ) ──────────────────────────────────────────
const partialStatus = fullStatus({ complete: false, slots: [slotStatus('requester', { signed: true, signature: signature('นางสาวผู้ขอ ทดสอบ') }), slotStatus('dept_head'), slotStatus('authority')] })
await render(form3(dataFor(partialStatus, { requester: TWO_TO_ONE })))
const partial = await measure()
checkImages(partial, 'แบบ ๓ ไม่ครบ', { expectCount: 1, maxHeightMm: 9, maxWidthMm: 40 })
assert.ok(partial.sheetHeight <= PRINTABLE_HEIGHT_PX, `ลงนามไม่ครบเกิน 1 หน้า ${partial.sheetHeight}px`)

// ── 5. เนื้อหาไม่ตรง (คำเตือนตัวหนา) ยังต้องจบ 1 หน้า ─────────────────────────────────────
await render(form3(dataFor(withSlots({ authority: { content_matches: false } }), { requester: TWO_TO_ONE })))
const tampered = await measure()
assert.ok(tampered.sheetHeight <= PRINTABLE_HEIGHT_PX, `ใบที่มีคำเตือนเนื้อหาไม่ตรงเกิน 1 หน้า ${tampered.sheetHeight}px`)

// ── 6. แบบ สก. ๑ ──────────────────────────────────────────────────────────────────────
const sk1Trip = { ...trip, returned_at: '2026-09-01T09:30:00.000Z' }
await render(buildFleetSk1Html({ trip: sk1Trip, tenant }))
const sk1Base = await measure()
const sk1Status = fullStatus({ slots: [slotStatus('sk1', { signed: true, signature: signature('นายกเทศมนตรีทดสอบ', { signed_as: 'นายกเทศมนตรีตำบลสาธิต' }) })] })
await render(buildFleetSk1Html({ trip: sk1Trip, tenant, esign: dataFor(sk1Status, { sk1: TWO_TO_ONE }) }))
const sk1 = await measure()
checkImages(sk1, 'สก.๑', { expectCount: 1, maxHeightMm: 16, maxWidthMm: 50 })
assert.ok(sk1.sheetHeight <= PRINTABLE_HEIGHT_PX, `สก.๑ ลงนามออนไลน์เกิน 1 หน้า ${sk1.sheetHeight}px (ใบเดิม ${sk1Base.sheetHeight}px)`)
assert.ok(sk1.qr && sk1.qr.right <= sk1.sheetRight + 1)

await browser.close()
console.log('esign print layout assertions passed '
  + `(แบบ ๓ เดิม ${baseline.sheetHeight}px → ครบ ${full.sheetHeight}px · ตำแหน่งยาว ${acting.sheetHeight}px · ไม่ครบ ${partial.sheetHeight}px · คำเตือน ${tampered.sheetHeight}px / พื้นที่พิมพ์ ${PRINTABLE_HEIGHT_PX}px · สก.๑ ${sk1Base.sheetHeight}→${sk1.sheetHeight}px)`)
process.exit(0)
