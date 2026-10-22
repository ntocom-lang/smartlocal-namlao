// QR เปิดแผนที่ข้างย่อหน้าพิกัดของใบคำขอในงานบริการประชาชน (src/lib/govMapQr.js)
//   ชั้นแรก (node ล้วน): เกณฑ์พิกัดที่ใช้ได้ · รูปแบบลิงก์ · path ของ QR ตรงกับไลบรารี · ไม่มีพิกัด = คืนย่อหน้าเดิมทุกตัวอักษร
//   ชั้นสอง (Chrome จริง): วาด QR ลงภาพแล้วสุ่มสีพิกเซลกลางโมดูลทุกจุดเทียบกับเมทริกซ์ของไลบรารี — ตำแหน่ง/ขนาด/ขอบสงบที่
//            เพี้ยนแม้ 1px ทำให้สแกนไม่ติดโดยตาคนมองไม่เห็น · และขนาดบนกระดาษ 18 มม. อยู่ชิดขวาของย่อหน้า
// เทสต์ระดับใบ (ขยะ/ยกเลิกขยะ/น้ำ) อยู่ในไฟล์เทสต์ของแต่ละใบ — ไฟล์นี้ตรวจเฉพาะตัวกลาง
// รันด้วย: npm run test:gov-map-qr

import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { create as createQr } from 'qrcode'
import {
  MAP_QR_HINT, govMapQrCss, govPointWithMapQr, mapLinkOf, mapPinOf, mapQrSvg,
} from '../src/lib/govMapQr.js'
import { QUIET_MODULES, qrLayout } from '../src/lib/qrSvg.js'

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const POINT = { lat: 18.258742, lng: 100.308329, address: 'บ้านทุ่งแค้ว' }
const POINT_HTML = '<p class="point-copy">จุดวางถังตามพิกัดแผนที่ <span class="fill-value">18.258742, 100.308329 (บ้านทุ่งแค้ว)</span></p>'
const LINK = 'https://maps.google.com/?q=18.258742,100.308329'

await test('พิกัดที่ใช้ได้: ตัวเลข/สตริงตัวเลข/ค่าติดลบ/ละติจูด 0 กับลองจิจูดไม่ศูนย์ · ที่เหลือ = null (ไม่เดา)', () => {
  assert.deepEqual(mapPinOf(POINT), { lat: 18.258742, lng: 100.308329 })
  assert.deepEqual(mapPinOf({ lat: '18.25', lng: '100.30' }), { lat: 18.25, lng: 100.3 })
  assert.deepEqual(mapPinOf({ lat: -33.86, lng: -151.2 }), { lat: -33.86, lng: -151.2 })
  assert.deepEqual(mapPinOf({ lat: 0, lng: 100.3 }), { lat: 0, lng: 100.3 })
  for (const bad of [
    null, undefined, {}, { lat: null, lng: 100 }, { lat: 18, lng: undefined }, { lat: '', lng: '' },
    { lat: 'x', lng: null }, { lat: NaN, lng: 100 }, { lat: Infinity, lng: 100 },
    { lat: 0, lng: 0 }, { lat: '0', lng: '0' }, { lat: 91, lng: 100 }, { lat: -91, lng: 100 }, { lat: 18, lng: 181 }, { lat: 18, lng: -181 },
  ]) assert.equal(mapPinOf(bad), null, `ควรเป็น null: ${JSON.stringify(bad)}`)
})

await test('ลิงก์แผนที่: รูปแบบเดียวกับใบคำร้อง/ปุ่มหน้าเจ้าหน้าที่ · ทศนิยม 6 ตำแหน่ง · ไม่มีคีย์/พารามิเตอร์ส่วนตัว', () => {
  assert.equal(mapLinkOf({ lat: 18.258742, lng: 100.308329 }), LINK)
  assert.equal(mapLinkOf({ lat: 18.2456789, lng: 100.1234567 }), 'https://maps.google.com/?q=18.245679,100.123457')
  assert.equal(mapLinkOf({ lat: -33.5, lng: -151.25 }), 'https://maps.google.com/?q=-33.500000,-151.250000')
  assert.ok(!/key=|token|user|name/i.test(mapLinkOf({ lat: 18.2, lng: 100.3 })))
})

await test('QR: path ตรงกับเมทริกซ์ของลิงก์ทุกโมดูล · ดำบนขาว · ขอบสงบ 4 โมดูล · ไม่มีพิกัด = สตริงว่าง', () => {
  assert.equal(mapQrSvg(null), '')
  assert.equal(mapQrSvg({ lat: 0, lng: 0 }), '')
  assert.equal(mapQrSvg({ lat: 'x', lng: 1 }), '')
  const svg = mapQrSvg(POINT)
  const layout = qrLayout(LINK, 1000)
  assert.ok(svg.includes(`d="${layout.d}"`), 'QR ต้องเข้ารหัสลิงก์ที่คาดไว้ (เขียนลิงก์ตรงๆ ในเทสต์ ไม่เรียกฟังก์ชันสร้างลิงก์ซ้ำ)')
  const box = layout.size + QUIET_MODULES * 2
  assert.ok(svg.includes(`viewBox="0 0 ${box} ${box}"`))
  assert.ok(svg.includes(`<rect width="${box}" height="${box}" fill="#fff"/>`), 'พื้นขาวรวมขอบสงบ')
  assert.ok(svg.includes(`translate(${QUIET_MODULES} ${QUIET_MODULES})`) && svg.includes('fill="#000"'))
  assert.equal(QUIET_MODULES, 4)
  assert.ok(svg.includes('role="img"') && svg.includes('aria-label='), 'โปรแกรมอ่านหน้าจอต้องรู้ว่านี่คือรูป QR')
  assert.equal(svg.split('<svg').length - 1, 1)
})

await test('ย่อหน้ากับ QR: ไม่มีพิกัด/พิกัดเสีย = คืนย่อหน้าเดิมทุกตัวอักษร · มีพิกัด = ย่อหน้าเดิมไม่ถูกแก้ + QR + คำกำกับ', () => {
  for (const bad of [null, undefined, { lat: 'x', lng: null }, { lat: 0, lng: 0 }, { lat: 200, lng: 1 }]) {
    assert.equal(govPointWithMapQr({ pointHtml: POINT_HTML, point: bad }), POINT_HTML, `ต้องคืนเดิมเป๊ะ: ${JSON.stringify(bad)}`)
  }
  const html = govPointWithMapQr({ pointHtml: POINT_HTML, point: POINT })
  assert.ok(html.includes(POINT_HTML), 'ย่อหน้าเดิมต้องอยู่ครบทุกตัวอักษร (ใบลอกจากต้นฉบับ ห้ามแก้ถ้อยคำ)')
  assert.ok(html.startsWith('<div class="map-point"><div class="map-point__text">'))
  assert.ok(html.indexOf(POINT_HTML) < html.indexOf('<svg'), 'ข้อความอยู่ซ้าย QR อยู่ขวา')
  assert.ok(html.includes(`<span class="map-point__hint">${MAP_QR_HINT}</span>`) && MAP_QR_HINT === 'สแกนเปิดแผนที่')
  assert.equal(html.split('<svg').length - 1, 1)
})

await test('คำกำกับที่ส่งมาถูกหนีอักขระ (กันของแปลกหลุดเป็นโค้ดหากมีคนส่งค่าจากข้อมูลผู้ใช้มาในอนาคต)', () => {
  const html = govPointWithMapQr({ pointHtml: POINT_HTML, point: POINT, hint: '<img src=x onerror=alert(1)>' })
  assert.ok(!html.includes('<img') && html.includes('&lt;img src=x'))
})

await test('CSS: QR 18 มม. ชิดขวา ไม่ตัดกลางหน้า · โหมดเจ้าหน้าที่บีบระยะล่าง 3mm · ย่อหน้าพิกัดไม่เว้นล่างซ้อนกับแถว', () => {
  const css = govMapQrCss()
  assert.match(css, /\.map-point__qr \{ width: 18mm; height: 18mm; \}/)
  assert.match(css, /\.map-point \{[^}]*display: flex[^}]*break-inside: avoid/)
  assert.match(css, /\.sheet--staff \.map-point \{ margin-bottom: 3mm; \}/)
  assert.match(css, /\.map-point \.map-point__text \.point-copy \{ margin-bottom: 0; \}/)
})

// ── ชั้นสอง: Chrome จริง ──
const browser = await chromium.launch({ channel: 'chrome' })
try {
  await test('Chrome: QR ที่เรนเดอร์ตรงกับเมทริกซ์ทุกโมดูล · ขอบสงบขาว · ขนาดบนกระดาษ 18 มม. ชิดขวาของย่อหน้า', async () => {
    const page = await browser.newPage({ viewport: { width: 700, height: 300 }, deviceScaleFactor: 8 })
    try {
      await page.route('**/*', route => route.abort())
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>
        body { margin: 0; padding: 20px; font: 14pt sans-serif; } p { margin: 0 0 4mm; } .sheet { width: 160mm; }
        .point-copy { text-indent: 25mm; } ${govMapQrCss()}</style>
        <main class="sheet">${govPointWithMapQr({ pointHtml: POINT_HTML, point: POINT })}</main>`)
      const box = await page.locator('.map-point__qr').boundingBox()
      const row = await page.locator('.map-point').boundingBox()
      const mm = px => px * 25.4 / 96
      assert.ok(Math.abs(mm(box.width) - 18) < 0.3 && Math.abs(mm(box.height) - 18) < 0.3, `QR ${mm(box.width).toFixed(2)}×${mm(box.height).toFixed(2)} มม.`)
      assert.ok(Math.abs((row.x + row.width) - (box.x + box.width)) < 6, 'QR ต้องชิดขอบขวาของแถว')
      const shot = (await page.screenshot({ clip: box })).toString('base64')
      const modules = createQr(LINK, { errorCorrectionLevel: 'M' }).modules
      const sampled = await page.evaluate(async ({ b64, size, quiet }) => {
        const image = new Image()
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/png;base64,${b64}` })
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
        const total = size + quiet * 2
        const unit = canvas.width / total
        const lum = (x, y) => { const [r, g, b] = context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data; return (r + g + b) / 3 }
        const dark = []
        for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) dark.push(lum((quiet + col + 0.5) * unit, (quiet + row + 0.5) * unit) < 128)
        // วงแหวนขอบสงบ (4 โมดูลรอบนอก): สุ่มกลางโมดูลที่ขอบ 4 ด้านต้องขาว
        const ring = []
        for (let i = 0; i < total; i += 3) for (const [x, y] of [[i, 0], [i, total - 1], [0, i], [total - 1, i]]) ring.push(lum((x + 0.5) * unit, (y + 0.5) * unit))
        return { dark, ring: Math.min(...ring) }
      }, { b64: shot, size: modules.size, quiet: QUIET_MODULES })
      let wrong = 0
      for (let r = 0; r < modules.size; r++) for (let c = 0; c < modules.size; c++) if (sampled.dark[r * modules.size + c] !== !!modules.get(r, c)) wrong++
      assert.equal(wrong, 0, `โมดูลบนภาพไม่ตรง ${wrong} จุด`)
      assert.ok(sampled.ring > 250, `ขอบสงบไม่ขาว (ต่ำสุด ${sampled.ring})`)
    } finally { await page.close() }
  })
} finally {
  await browser.close()
}

console.log(`\n${cases} cases passed`)
