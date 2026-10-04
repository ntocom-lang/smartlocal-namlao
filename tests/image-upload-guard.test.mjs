// กันไม่ให้รูปใหญ่หลุดขึ้นหน้าสาธารณะอีก (ต้นเหตุ Supabase ตัดบริการ 402 เมื่อ 2026-10-04)
// ส่วนแรกรันใน Chrome จริงด้วย canvas จริง ไม่ mock — ไม่ยิง Supabase/ฐานข้อมูลเลย
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const read = rel => readFile(new URL(rel, import.meta.url), 'utf8')
const imageUtilsSrc = await read('../src/lib/imageUtils.js')

let browser
let page

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage()
  await page.route('https://guard.test/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/imageUtils.js') return route.fulfill({ contentType: 'text/javascript', body: imageUtilsSrc })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>guard</title>' })
  })
  await page.goto('https://guard.test/')
  await page.evaluate(async () => {
    window.U = await import('/imageUtils.js')
    // รูปจำลองแบบรูปถ่าย: ไล่สี + วงกลมเบลอ + สัญญาณรบกวนเล็กน้อย (เมล็ดคงที่ ผลซ้ำได้)
    window.makeImage = async ({ w, h, type = 'image/png', name = 'photo.png', transparentLeft = false, fileType = type }) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#2a6fdb'); g.addColorStop(1, '#f2c14e')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 40; i += 1) {
        ctx.fillStyle = `hsla(${(i * 37) % 360}, 60%, 50%, 0.35)`
        ctx.beginPath(); ctx.arc((i * 211) % w, (i * 97) % h, 60 + (i % 7) * 25, 0, Math.PI * 2); ctx.fill()
      }
      const img = ctx.getImageData(0, 0, w, h)
      let seed = 12345
      for (let i = 0; i < img.data.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        const n = ((seed >>> 24) % 9) - 4
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n
      }
      ctx.putImageData(img, 0, 0)
      if (transparentLeft) ctx.clearRect(0, 0, Math.floor(w / 2), h)
      const blob = await new Promise(r => canvas.toBlob(r, type))
      return new File([blob], name, { type: fileType })
    }
    window.dims = async file => { const b = await createImageBitmap(file); const d = { w: b.width, h: b.height }; b.close(); return d }
  })
})

after(async () => { await browser?.close() })

test('รูปใหญ่ใน bucket สาธารณะ → ถูกย่อเป็น JPEG ≤1600 px และเล็กกว่า 1 MB', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 3000, h: 1600 })
    const out = await window.U.limitPublicImage('municipality-assets', f)
    const d = await window.dims(out)
    return { before: f.size, after: out.size, same: out === f, type: out.type, w: d.w, h: d.h }
  })
  assert.ok(r.before > 1.5 * 1024 * 1024, `รูปทดสอบต้องใหญ่กว่า 1.5 MB (ได้ ${r.before})`)
  assert.equal(r.same, false)
  assert.equal(r.type, 'image/jpeg')
  assert.ok(r.after < 1024 * 1024, `ต้องเล็กกว่า 1 MB (ได้ ${r.after})`)
  assert.ok(Math.max(r.w, r.h) <= 1600, `ด้านยาวต้องไม่เกิน 1600 px (ได้ ${r.w}x${r.h})`)
})

test('รูปเล็กกว่า 1.5 MB → คืนไฟล์เดิมตัวเดิม ไม่แตะ', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 600, h: 300 })
    return { size: f.size, same: (await window.U.limitPublicImage('municipality-assets', f)) === f }
  })
  assert.ok(r.size < 1.5 * 1024 * 1024)
  assert.equal(r.same, true)
})

test('bucket เอกสาร (สลิป/หนังสือราชการ ฯลฯ) → ไม่ย่อ เพราะตัวหนังสือในสแกนต้องอ่านออก', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 3000, h: 1600 })
    const out = {}
    for (const b of ['payment-slips', 'official-documents', 'document-certs', 'org-documents', 'fleet-documents']) {
      out[b] = (await window.U.limitPublicImage(b, f)) === f
    }
    return out
  })
  for (const [bucket, unchanged] of Object.entries(r)) assert.equal(unchanged, true, `${bucket} ต้องไม่ถูกย่อ`)
})

test('ไม่ใช่รูปที่ย่อได้ (gif/svg/pdf) → ไม่แตะ แม้ใหญ่และอยู่ใน bucket สาธารณะ', async () => {
  const r = await page.evaluate(async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024)
    const out = {}
    for (const [name, type] of [['a.gif', 'image/gif'], ['a.svg', 'image/svg+xml'], ['a.pdf', 'application/pdf']]) {
      const f = new File([bytes], name, { type })
      out[name] = (await window.U.limitPublicImage('municipality-assets', f)) === f
    }
    return out
  })
  for (const [name, unchanged] of Object.entries(r)) assert.equal(unchanged, true, `${name} ต้องไม่ถูกแตะ`)
})

test('PNG โปร่งใส → ส่วนโปร่งใสเป็นสีขาว ไม่ใช่สีดำ', async () => {
  const px = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 3000, h: 1600, transparentLeft: true })
    const out = await window.U.limitPublicImage('municipality-assets', f)
    const bmp = await createImageBitmap(out)
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0)
    return Array.from(ctx.getImageData(20, 20, 1, 1).data)
  })
  assert.ok(px[0] >= 245 && px[1] >= 245 && px[2] >= 245, `ต้องเป็นสีขาว (ได้ rgb ${px.slice(0, 3)})`)
})

test('กล้องมือถือที่ file.type ว่าง → เช็คจากนามสกุลแล้วย่อได้', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 3000, h: 1600, name: 'IMG_0001.png', fileType: '' })
    const out = await window.U.limitPublicImage('event-attachments', f)
    return { type: f.type, same: out === f, outType: out.type }
  })
  assert.equal(r.type, '')
  assert.equal(r.same, false)
  assert.equal(r.outType, 'image/jpeg')
})

test('compressImage รับ skipUnder: 0 บังคับเข้ารหัสใหม่แม้ไฟล์เล็ก (เปลี่ยน PNG → JPEG)', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 600, h: 300 })
    const out = await window.U.compressImage(f, 1600, 0.85, { skipUnder: 0 })
    return { same: out === f, type: out.type }
  })
  assert.equal(r.same, false)
  assert.equal(r.type, 'image/jpeg')
})

test('bucket เอกสารต้องไม่หลุดเข้ารายการ bucket สาธารณะ', async () => {
  const buckets = await page.evaluate(() => Array.from(window.U.PUBLIC_IMAGE_BUCKETS))
  for (const b of ['payment-slips', 'official-documents', 'document-certs', 'org-documents', 'fleet-documents']) {
    assert.ok(!buckets.includes(b), `${b} ห้ามอยู่ใน PUBLIC_IMAGE_BUCKETS`)
  }
})

// ── ระดับซอร์ส: กันการแก้กลับโดยไม่รู้ตัว ─────────────────────────────────────────────────
test('uploadFile ต้องเรียก limitPublicImage ก่อนแปลงเป็น base64 เสมอ', async () => {
  const src = await read('../src/lib/driveStorage.js')
  const fnStart = src.indexOf('export async function uploadFile(')
  assert.ok(fnStart > 0)
  const body = src.slice(fnStart)
  const guard = body.indexOf('limitPublicImage(bucket, original)')
  const encode = body.indexOf('fileToBase64(file)')
  assert.ok(guard > 0, 'ไม่พบการเรียก limitPublicImage ใน uploadFile')
  assert.ok(encode > guard, 'limitPublicImage ต้องมาก่อน fileToBase64')
})

test('หน้าตั้งค่า: ห้ามส่งไฟล์ดิบขึ้น municipality-assets และรูปถ่ายทุกช่องต้องเข้ารหัส JPEG', async () => {
  const src = await read('../src/components/admin/SystemSettingsAdmin.jsx')
  assert.doesNotMatch(src, /uploadFile\('municipality-assets', file,/, 'มีการส่งไฟล์ดิบ (file) ขึ้น municipality-assets')
  const photoCalls = [...src.matchAll(/resizeImage\(file, 1600[^)]*\)/g)].map(m => m[0])
  assert.ok(photoCalls.length >= 4, `ต้องมีรูปถ่ายอย่างน้อย 4 ช่อง (หัวเว็บ, Smart City, พื้นหลัง, แบนเนอร์) ได้ ${photoCalls.length}`)
  for (const call of photoCalls) assert.match(call, /PHOTO_JPEG/, `${call} ต้องใช้ PHOTO_JPEG`)
  assert.doesNotMatch(src, /tourism-background-\$\{tenant\.slug\}\.png/, 'นามสกุลไฟล์ต้องตรงเนื้อไฟล์ (.jpg)')
})
