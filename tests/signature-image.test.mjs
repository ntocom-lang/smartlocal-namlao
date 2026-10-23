// ภาพลายเซ็น — ส่วนคำนวณล้วน (src/lib/signatureImage.js)   node tests/signature-image.test.mjs   (หรือ npm run test:esign)
// ตัวส่งออกจริงใช้ canvas (ทดสอบในเบราว์เซอร์: tests/esign-profile.playwright.mjs) ส่วนนี้กันตรรกะที่ผิดเงียบๆ:
// กรอบตัดขอบเพี้ยน · ลบพื้นขาวจนเส้นอ่อนหาย/พื้นเทายังเหลือหมอก · ขนาด/ไบต์เกินเพดานฐานข้อมูล
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  SIGNATURE_MAX_BYTES, SIGNATURE_MAX_H, SIGNATURE_MAX_W, SIGNATURE_PAD_H, SIGNATURE_PAD_W, SIGNATURE_PEN_COLORS, SIGNATURE_TARGET_BYTES,
  base64Bytes, checkSignatureFile, contentBounds, estimateBackgroundLuma, exportWithinBudget, fitSize, hasTransparency, padBounds,
  pngBase64FromDataUrl, signatureClientMessage, whiteToAlpha, SIGNATURE_CLIENT_MESSAGES, SIGNATURE_MAX_IMAGES,
} from '../src/lib/signatureImage.js'

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }
const read = path => readFile(new URL(path, import.meta.url), 'utf8')

// ภาพ RGBA สังเคราะห์: พื้นสีเดียว + สี่เหลี่ยมหมึก
function makeImage(width, height, { bg = [255, 255, 255, 255], ink = null } = {}) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(bg, i * 4)
  if (ink) {
    for (let y = ink.y; y < ink.y + ink.h; y++) for (let x = ink.x; x < ink.x + ink.w; x++) data.set(ink.rgba, (y * width + x) * 4)
  }
  return data
}
const alphaAt = (data, width, x, y) => data[(y * width + x) * 4 + 3]

await test('ค่าคงที่ตรงกับเพดานของฐานข้อมูล (50,000 ไบต์ · 640×320 · 5 แบบ) — ถ้าแก้ฝั่งใดต้องแก้อีกฝั่ง', async () => {
  const functions = await read('../supabase/migrations/20261023100100_esign_image_functions.sql')
  const tables = await read('../supabase/migrations/20261023100000_esign_image_tables.sql')
  assert.equal(SIGNATURE_MAX_BYTES, 50000)
  assert.ok(functions.includes('IF v_len > 50000 THEN'), 'ฟังก์ชัน esign_png_decode ไม่ใช่ 50,000 ไบต์แล้ว')
  assert.ok(tables.includes('octet_length(png) BETWEEN 67 AND 50000'))
  assert.ok(functions.includes('r_width > 640') && functions.includes('r_height > 320'))
  assert.deepEqual([SIGNATURE_MAX_W, SIGNATURE_MAX_H], [640, 320])
  assert.ok(functions.includes('IF v_count >= 5 THEN'))
  assert.equal(SIGNATURE_MAX_IMAGES, 5)
  assert.ok(SIGNATURE_TARGET_BYTES < SIGNATURE_MAX_BYTES, 'ต้องเผื่อจากเพดาน')
  assert.equal(SIGNATURE_PAD_W / SIGNATURE_PAD_H, 2, 'แผ่นวาดต้องอัตราส่วน 2:1 เท่ากรอบสูงสุด')
  // ความกว้างแผ่นวาดตรงกับ base ของความหนาเส้น (ใช้คำนวณพิกเซลต่อความกว้างจริง)
  assert.equal(SIGNATURE_PAD_W, 640)
  assert.ok(SIGNATURE_PEN_COLORS.every(color => /^#[0-9a-f]{6}$/i.test(color.hex) && color.label))
})

await test('fitSize: ย่อให้พอดีกรอบรักษาสัดส่วน · ไม่ขยายภาพเล็ก · ขั้นต่ำ 1 พิกเซล', () => {
  assert.deepEqual(fitSize(1280, 640), { width: 640, height: 320 })
  assert.deepEqual(fitSize(1000, 100), { width: 640, height: 64 })
  assert.deepEqual(fitSize(100, 1000), { width: 32, height: 320 })
  assert.deepEqual(fitSize(200, 80), { width: 200, height: 80 }, 'ภาพเล็กต้องไม่ถูกขยาย')
  assert.deepEqual(fitSize(10000, 1), { width: 640, height: 1 })
  assert.deepEqual(fitSize(4000, 3000), { width: 427, height: 320 })
})

await test('contentBounds/padBounds: หากรอบเนื้อหาแม่น · ภาพว่างคืน null · เส้นจางเกินเกณฑ์ไม่นับ · ขยายกรอบไม่ล้นขอบภาพ', () => {
  const w = 50, h = 30
  const blank = makeImage(w, h, { bg: [0, 0, 0, 0] })
  assert.equal(contentBounds(blank, w, h), null)
  const dot = makeImage(w, h, { bg: [0, 0, 0, 0], ink: { x: 10, y: 7, w: 1, h: 1, rgba: [0, 0, 0, 255] } })
  assert.deepEqual(contentBounds(dot, w, h), { x: 10, y: 7, width: 1, height: 1 })
  const box = makeImage(w, h, { bg: [0, 0, 0, 0], ink: { x: 5, y: 4, w: 30, h: 12, rgba: [10, 20, 90, 255] } })
  assert.deepEqual(contentBounds(box, w, h), { x: 5, y: 4, width: 30, height: 12 })
  const faint = makeImage(w, h, { bg: [0, 0, 0, 0], ink: { x: 5, y: 4, w: 30, h: 12, rgba: [10, 20, 90, 6] } })
  assert.equal(contentBounds(faint, w, h), null, 'alpha ต่ำกว่าเกณฑ์ (12) ถือเป็นฝุ่น ไม่ใช่เส้น')
  assert.deepEqual(padBounds({ x: 5, y: 4, width: 30, height: 12 }, 3, w, h), { x: 2, y: 1, width: 36, height: 18 })
  assert.deepEqual(padBounds({ x: 0, y: 0, width: 50, height: 30 }, 9, w, h), { x: 0, y: 0, width: 50, height: 30 }, 'ห้ามล้นขอบ')
  assert.deepEqual(padBounds({ x: 48, y: 28, width: 2, height: 2 }, 5, w, h), { x: 43, y: 23, width: 7, height: 7 })
})

await test('whiteToAlpha: พื้นขาวโปร่งใส · หมึกเข้มทึบเต็ม · เส้นอ่อนยังเห็น · พื้นกระดาษเทา/ถ่ายมืดก็ลบได้ · คืนจำนวนพิกเซลที่เห็น', () => {
  const w = 60, h = 30
  // ขาวสะอาด + หมึกน้ำเงินเข้ม
  const clean = makeImage(w, h, { ink: { x: 10, y: 10, w: 40, h: 4, rgba: [20, 40, 120, 255] } })
  const visibleClean = whiteToAlpha(clean)
  assert.equal(alphaAt(clean, w, 0, 0), 0, 'พื้นขาวต้องโปร่งใส')
  assert.equal(alphaAt(clean, w, w - 1, h - 1), 0)
  assert.equal(alphaAt(clean, w, 20, 11), 255, 'หมึกเข้มต้องทึบเต็ม')
  assert.equal(visibleClean, 40 * 4)
  // สีของหมึกต้องไม่เพี้ยน (เปลี่ยนแค่ alpha)
  assert.deepEqual([...clean.slice((11 * w + 20) * 4, (11 * w + 20) * 4 + 3)], [20, 40, 120])

  // กระดาษเทา (ถ่ายในที่สลัว) — ไม่ใช่ขาว 255 แต่ยังต้องลบเป็นพื้นได้ ไม่ทิ้งหมอก
  const gray = makeImage(w, h, { bg: [196, 196, 192, 255], ink: { x: 10, y: 10, w: 40, h: 4, rgba: [40, 50, 100, 255] } })
  whiteToAlpha(gray)
  assert.ok(alphaAt(gray, w, 0, 0) <= 10, `พื้นเทาควรโปร่งใส (ได้ ${alphaAt(gray, w, 0, 0)})`)
  assert.ok(alphaAt(gray, w, 20, 11) >= 240, 'หมึกบนกระดาษเทาต้องยังทึบ')

  // เส้นสีอ่อน (ปากกาน้ำเงินจาง) บนพื้นขาว — ต้องยังเห็น ไม่หายเป็นพื้น
  const light = makeImage(w, h, { ink: { x: 10, y: 10, w: 40, h: 3, rgba: [150, 170, 230, 255] } })
  const visibleLight = whiteToAlpha(light)
  assert.ok(visibleLight > 0, 'เส้นสีอ่อนต้องไม่หายทั้งหมด')
  assert.ok(alphaAt(light, w, 20, 11) >= 100)

  // ภาพขาวล้วน = ไม่มีลายเซ็น
  const white = makeImage(w, h)
  assert.equal(whiteToAlpha(white), 0)
  assert.equal(contentBounds(white, w, h), null)
})

await test('whiteToAlpha: PNG ที่โปร่งใสอยู่แล้วไม่ถูกลบซ้ำ (เส้นอ่อนไม่จาง) · hasTransparency ตัดสินจากสัดส่วน', () => {
  const w = 40, h = 20
  const already = makeImage(w, h, { bg: [0, 0, 0, 0], ink: { x: 5, y: 5, w: 30, h: 3, rgba: [180, 190, 230, 255] } })
  assert.equal(hasTransparency(already), true)
  const before = [...already]
  const visible = whiteToAlpha(already)
  assert.deepEqual([...already], before, 'ภาพที่โปร่งใสอยู่แล้วต้องไม่ถูกแก้')
  assert.equal(visible, 30 * 3)
  assert.equal(hasTransparency(makeImage(w, h)), false)
  assert.equal(hasTransparency(new Uint8ClampedArray(0)), false)
})

await test('estimateBackgroundLuma: ใช้เปอร์เซ็นไทล์ — หมึกบางส่วนไม่ดึงค่าพื้นลง · ภาพโปร่งใสล้วนคืน 255', () => {
  const w = 100, h = 100
  const data = makeImage(w, h, { bg: [220, 220, 220, 255], ink: { x: 0, y: 0, w: 100, h: 10, rgba: [0, 0, 0, 255] } })
  assert.equal(estimateBackgroundLuma(data), 220)
  assert.equal(estimateBackgroundLuma(makeImage(w, h, { bg: [0, 0, 0, 0] })), 255)
})

await test('base64Bytes/pngBase64FromDataUrl: นับไบต์ตรงกับของจริง · รับเฉพาะ data URL แบบ PNG ที่ base64 สะอาด', () => {
  for (const size of [0, 1, 2, 3, 4, 5, 100, 1234]) {
    const buffer = Buffer.alloc(size, 7)
    assert.equal(base64Bytes(buffer.toString('base64')), size, `size ${size}`)
  }
  const b64 = Buffer.from('hello world').toString('base64')
  assert.equal(pngBase64FromDataUrl(`data:image/png;base64,${b64}`), b64)
  assert.equal(pngBase64FromDataUrl(`data:image/jpeg;base64,${b64}`), null)
  assert.equal(pngBase64FromDataUrl(`data:image/svg+xml;base64,${b64}`), null)
  assert.equal(pngBase64FromDataUrl('data:image/png;base64,ab cd'), null)
  assert.equal(pngBase64FromDataUrl('data:image/png;base64,ab\ncd'), null)
  assert.equal(pngBase64FromDataUrl(`data:image/png;base64,`), null)
  assert.equal(pngBase64FromDataUrl(null), null)
  assert.equal(pngBase64FromDataUrl(42), null)
})

await test('exportWithinBudget: ย่อทีละขั้นจนพอดี · ขนาดไม่เกิน 640×320 · ย่อไม่สำเร็จคืน null · ไม่เล็กกว่า 80 พิกเซล', () => {
  // ตัวเข้ารหัสปลอม: ไบต์ ∝ พื้นที่ภาพ
  const encodeFor = bytesPerPixel => (w, h) => ({ base64: 'A'.repeat(Math.ceil((w * h * bytesPerPixel * 4) / 3)) })
  const calls = []
  const small = exportWithinBudget({ width: 300, height: 100, encode: (w, h) => { calls.push([w, h]); return encodeFor(0.1)(w, h) } })
  assert.deepEqual(calls, [[300, 100]], 'พอดีตั้งแต่ครั้งแรกต้องเข้ารหัสครั้งเดียว')
  assert.deepEqual([small.width, small.height], [300, 100])

  const big = exportWithinBudget({ width: 1280, height: 640, encode: encodeFor(0.5) })
  assert.ok(big.width <= 640 && big.height <= 320, `ล้นกรอบ ${big.width}×${big.height}`)
  assert.ok(big.bytes <= SIGNATURE_TARGET_BYTES, `เกินงบ ${big.bytes}`)
  assert.equal(big.width / big.height, 2, 'สัดส่วนต้องคงเดิม')

  // ต้องย่อหลายขั้นจึงพอดี
  const stepped = exportWithinBudget({ width: 640, height: 320, encode: encodeFor(0.4) })
  assert.ok(stepped.width < 640 && stepped.bytes <= SIGNATURE_TARGET_BYTES)

  // ย่อสุดแล้วก็ยังเกิน = null (ผู้เรียกบอกผู้ใช้ว่าภาพละเอียดเกินไป)
  assert.equal(exportWithinBudget({ width: 640, height: 320, encode: () => ({ base64: 'A'.repeat(200000) }) }), null)
  // ตัวเข้ารหัสล้มเหลว = ข้ามไปขั้นต่อไป ไม่ throw
  let n = 0
  const flaky = exportWithinBudget({ width: 400, height: 200, encode: (w, h) => (++n < 3 ? null : encodeFor(0.1)(w, h)) })
  assert.ok(flaky && n === 3)
  // ลายเซ็นเล็กมากไม่ถูกย่อต่ำกว่า 80 พิกเซลกว้าง
  const tiny = []
  exportWithinBudget({ width: 100, height: 40, encode: (w, h) => { tiny.push(w); return { base64: 'A'.repeat(200000) } } })
  assert.ok(tiny.every((w, i) => w >= 80 || i === 0), `ย่อต่ำกว่า 80: ${tiny}`)
})

await test('checkSignatureFile: รับเฉพาะ PNG/JPG ≤ 8 MB · ข้อความภาษาไทยครบทุกรหัสที่ฝั่งเบราว์เซอร์คืนได้', async () => {
  assert.equal(checkSignatureFile(null), 'file_missing')
  assert.equal(checkSignatureFile({ type: 'image/svg+xml', size: 100 }), 'file_type')
  assert.equal(checkSignatureFile({ type: 'image/gif', size: 100 }), 'file_type')
  assert.equal(checkSignatureFile({ type: 'application/pdf', size: 100 }), 'file_type')
  assert.equal(checkSignatureFile({ type: 'image/png', size: 8 * 1024 * 1024 + 1 }), 'file_too_big')
  assert.equal(checkSignatureFile({ type: 'image/png', size: 8 * 1024 * 1024 }), null)
  assert.equal(checkSignatureFile({ type: 'image/jpeg', size: 1 }), null)
  const canvasSource = await read('../src/lib/signatureCanvas.js')
  const returned = new Set([...canvasSource.matchAll(/code: '([a-z_]+)'/g)].map(match => match[1]))
  for (const code of [...returned, 'pad_empty', 'file_missing', 'file_type', 'file_too_big']) {
    assert.ok(SIGNATURE_CLIENT_MESSAGES[code], `ไม่มีข้อความของรหัส ${code}`)
  }
  assert.ok(signatureClientMessage('ไม่รู้จัก').length > 5, 'รหัสไม่รู้จักต้องไม่คืนข้อความว่าง/รหัสดิบ')
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
