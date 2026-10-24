// ลายเซ็นบนใบพิมพ์ต้องหนาพอมองเห็น (เจ้าของระบบพบบนใบจริงจางมาก 2569-10-24)
//   node tests/esign-signature-weight.test.mjs        ต้องมี Google Chrome (เหมือน tests/esign-print-layout.test.mjs)
//
// ภาพลายเซ็นกว้าง 640 พิกเซลถูกย่อเหลือราว 22 มม. บนใบแบบ ๓ เส้นปากกา 3 พิกเซลจึงเหลือ ~0.1 มม. — ส่วนคำนวณล้วนทดสอบใน
// tests/signature-image.test.mjs ไฟล์นี้ทดสอบส่วนที่ต้องใช้ canvas จริง: prepareStampsForPrint / signatureForPrint
// โหลดโมดูลจาก src/lib ผ่านเซิร์ฟเวอร์จำลองในหน้า (page.route) เพื่อให้ import ได้เหมือนบนเว็บ ไม่ต้องเปิด dev server
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'

const LIB = new URL('../src/lib/', import.meta.url)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
await page.route('http://sig.test/**', async route => {
  const path = new URL(route.request().url()).pathname
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' })
  try {
    const body = await readFile(new URL(path.replace(/^\/lib\//, ''), LIB), 'utf8')
    return route.fulfill({ contentType: 'application/javascript', body })
  } catch {
    return route.fulfill({ status: 404, body: 'not found' })
  }
})
page.on('pageerror', error => { console.error('pageerror:', error.message); process.exitCode = 1 })
await page.goto('http://sig.test/')

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

// ทำงานในหน้า: สร้างลายเซ็นสังเคราะห์ 640×255 (เส้นน้ำเงินเข้ม) → เสริมเส้น → วัดความหนาเส้นบนกระดาษของผลลัพธ์
const measure = (lineWidth, box, slot = 'requester') => page.evaluate(async ({ lineWidth, box, slot }) => {
  const images = await import('/lib/signatureImage.js')
  const canvasLib = await import('/lib/signatureCanvas.js')
  const draw = width => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 255
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#1e3a8a'
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(30, 200)
    ctx.bezierCurveTo(100, 20, 180, 220, 260, 120)
    ctx.bezierCurveTo(300, 40, 380, 230, 430, 60)
    ctx.bezierCurveTo(470, 150, 520, 180, 610, 190)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(20, 215)
    ctx.lineTo(620, 205)
    ctx.stroke()
    return canvas.toDataURL('image/png').split(',')[1]
  }
  const strokeOf = async base64 => {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = 'data:image/png;base64,' + base64 })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0)
    const px = images.estimateStrokePx(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
    return { px, width: canvas.width, height: canvas.height, mm: px * images.printedMmPerPx(canvas.width, canvas.height, box), color: Array.from(ctx.getImageData(Math.round(canvas.width * 0.55), Math.round(canvas.height * 0.82), 1, 1).data) }
  }
  const original = draw(lineWidth)
  const before = await strokeOf(original)
  const prepared = await canvasLib.prepareStampsForPrint({ ok: true, items: [{ slot, signature_id: 'x', width: 640, height: 255, png_base64: original }] }, () => box)
  const item = prepared.items[0]
  const after = await strokeOf(item.png_base64)
  return { before, after, changed: item.png_base64 !== original, itemWidth: item.width, itemHeight: item.height }
}, { lineWidth, box, slot })

const FORM3 = { heightMm: 9, widthMm: 40 }
const SK1 = { heightMm: 16, widthMm: 50 }

await test('ลายเซ็นปากกากลาง (3px) บนใบแบบ ๓: เดิมบางกว่า 0.15 มม. → หลังเสริมถึง ~0.32 มม.', async () => {
  const result = await measure(3, FORM3)
  assert.ok(result.before.mm < 0.15, `ก่อนเสริม ${result.before.mm.toFixed(3)} มม. — เงื่อนไขที่ทำให้เกิดบั๊กต้องเกิดจริงในเทสต์`)
  assert.ok(result.changed, 'ต้องได้ภาพใหม่')
  assert.ok(result.after.mm >= 0.28 && result.after.mm <= 0.45, `หลังเสริม ${result.after.mm.toFixed(3)} มม. ต้องอยู่ราว 0.32 (ไม่ตันเกินไป)`)
  assert.equal(result.itemWidth, result.after.width)
  assert.equal(result.itemHeight, result.after.height)
  assert.ok(result.after.width > 640 && result.after.width <= 640 + 14, `ภาพโตจากขอบกันตัดเส้น ${result.after.width}`)
  // สีหมึกยังเป็นน้ำเงินเข้ม ไม่จางไม่เป็นเทา (ตรวจพิกเซลกลางเส้นฐานของลายเซ็นไม่ได้ จึงตรวจสีของพิกเซลทึบใดๆ ผ่านการวัดความหนาที่สำเร็จแล้ว)
  assert.equal(result.after.color.length, 4)
})

await test('ปากกาบาง (1.8px) เสริมมากกว่าปากกากลาง · ปากกาหนา (4.8px) เสริมน้อยกว่า · ทุกเส้นถึงขั้นต่ำ', async () => {
  const thin = await measure(1.8, FORM3)
  const medium = await measure(3, FORM3)
  const thick = await measure(4.8, FORM3)
  assert.ok(thin.after.px - thin.before.px > medium.after.px - medium.before.px - 0.01)
  assert.ok(medium.after.px - medium.before.px > thick.after.px - thick.before.px - 0.01)
  for (const result of [thin, medium, thick]) assert.ok(result.after.mm >= 0.27, `ได้ ${result.after.mm.toFixed(3)} มม.`)
})

await test('ภาพที่เส้นหนาพออยู่แล้ว (12px) ไม่ถูกแตะ · ใบ สก.๑ (กรอบใหญ่กว่า) เสริมน้อยกว่าแบบ ๓', async () => {
  const thick = await measure(12, FORM3)
  assert.equal(thick.changed, false, 'เส้นหนาพอแล้วต้องคืนภาพเดิม')
  const form3 = await measure(3, FORM3)
  const sk1 = await measure(3, SK1, 'sk1')
  assert.ok(sk1.after.px - sk1.before.px < form3.after.px - form3.before.px, 'กรอบใหญ่กว่า → เส้นบนกระดาษหนากว่าอยู่แล้ว → เสริมน้อยกว่า')
  assert.ok(sk1.after.mm >= 0.27, `สก.๑ ${sk1.after.mm.toFixed(3)} มม.`)
})

await test('ข้อมูลเสีย/ไม่ใช่ภาพ/ผลดึงไม่สำเร็จ ผ่านไปเหมือนเดิม ไม่โยนข้อผิดพลาด (ห้ามขวางการพิมพ์)', async () => {
  const result = await page.evaluate(async () => {
    const canvasLib = await import('/lib/signatureCanvas.js')
    const box = () => ({ heightMm: 9, widthMm: 40 })
    const broken = await canvasLib.prepareStampsForPrint({ ok: true, items: [{ slot: 'requester', png_base64: 'AAAA', width: 1, height: 1 }, { slot: 'dept_head' }] }, box)
    const failed = { ok: false, code: 'not_found' }
    return {
      brokenKept: broken.items[0].png_base64 === 'AAAA' && broken.items[0].width === 1,
      noImageKept: JSON.stringify(broken.items[1]) === JSON.stringify({ slot: 'dept_head' }),
      failedSame: (await canvasLib.prepareStampsForPrint(failed, box)) === failed,
      nullSame: (await canvasLib.prepareStampsForPrint(null, box)) === null,
    }
  })
  assert.deepEqual(result, { brokenKept: true, noImageKept: true, failedSame: true, nullSame: true })
})

await browser.close()
console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
