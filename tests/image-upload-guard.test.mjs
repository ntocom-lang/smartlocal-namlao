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
    window.makeImage = async ({ w, h, type = 'image/png', name = 'photo.png', transparentLeft = false, fileType = type, noise = 4, quality }) => {
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
        const n = ((seed >>> 24) % (noise * 2 + 1)) - noise
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n
      }
      ctx.putImageData(img, 0, 0)
      if (transparentLeft) ctx.clearRect(0, 0, Math.floor(w / 2), h)
      const blob = await new Promise(r => canvas.toBlob(r, type, quality))
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
  assert.ok(r.before > 500 * 1024, `รูปทดสอบต้องใหญ่กว่า 500 KB (ได้ ${r.before})`)
  assert.equal(r.same, false)
  assert.equal(r.type, 'image/jpeg')
  assert.ok(r.after < 1024 * 1024, `ต้องเล็กกว่า 1 MB (ได้ ${r.after})`)
  assert.ok(Math.max(r.w, r.h) <= 1600, `ด้านยาวต้องไม่เกิน 1600 px (ได้ ${r.w}x${r.h})`)
})

test('รูปเล็กกว่า 500 KB → คืนไฟล์เดิมตัวเดิม ไม่แตะ', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 400, h: 300 })
    return { size: f.size, same: (await window.U.limitPublicImage('municipality-assets', f)) === f }
  })
  assert.ok(r.size < 500 * 1024, `รูปทดสอบต้องเล็กกว่า 500 KB (ได้ ${r.size})`)
  assert.equal(r.same, true)
})

test('รูปแนวตั้ง 3000x4000 → ด้านยาวไม่เกิน 1600 px (ของเดิมได้ 1600x2134)', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 3000, h: 4000, type: 'image/jpeg', name: 'IMG.jpg', quality: 0.92 })
    const out = await window.U.limitPublicImage('event-attachments', f)
    return { same: out === f, ...(await window.dims(out)), before: f.size, after: out.size }
  })
  assert.equal(r.same, false)
  assert.ok(Math.max(r.w, r.h) <= 1600, `ด้านยาวต้องไม่เกิน 1600 px (ได้ ${r.w}x${r.h})`)
  assert.equal(Math.round((r.w / r.h) * 100), 75, 'สัดส่วนภาพต้องคงเดิม 3:4')
  assert.ok(r.after < r.before)
})

test('ไม่ขยายรูป: PNG 1400x1000 ที่หนัก >500 KB → ขนาดภาพคงเดิม เล็กลงแต่เป็น JPEG', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 1400, h: 1000, noise: 14 })
    const out = await window.U.limitPublicImage('municipality-assets', f)
    return { before: f.size, after: out.size, same: out === f, type: out.type, ...(await window.dims(out)) }
  })
  assert.ok(r.before > 500 * 1024, `รูปทดสอบต้องหนักกว่า 500 KB (ได้ ${r.before})`)
  assert.equal(r.same, false)
  assert.equal(r.type, 'image/jpeg')
  assert.deepEqual([r.w, r.h], [1400, 1000], 'ห้ามขยายหรือย่อรูปที่ด้านยาวไม่ถึง 1600 px')
  assert.ok(r.after < r.before * 0.85)
})

test('JPEG ที่ย่อแล้วหนัก >500 KB แต่เข้ารหัสซ้ำไม่ประหยัดถึง 15% → คืนไฟล์เดิม (ไม่เสียคุณภาพเปล่า)', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 1400, h: 1000, type: 'image/jpeg', name: 'a.jpg', noise: 34, quality: 0.85 })
    return { size: f.size, same: (await window.U.limitPublicImage('municipality-assets', f)) === f }
  })
  assert.ok(r.size > 500 * 1024, `รูปทดสอบต้องหนักกว่า 500 KB ไม่งั้นเทสต์ไม่มีความหมาย (ได้ ${r.size})`)
  assert.equal(r.same, true)
})

test('keepFormat: true → ไม่แตะแม้เป็น PNG ทึบขนาดใหญ่ (โลโก้/ไอคอนแอป/QR)', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 1400, h: 1000, noise: 14 })
    return {
      size: f.size,
      kept: (await window.U.limitPublicImage('municipality-assets', f, { keepFormat: true })) === f,
      shrunkWithout: (await window.U.limitPublicImage('municipality-assets', f)) !== f,
    }
  })
  assert.ok(r.size > 500 * 1024)
  assert.equal(r.kept, true)
  assert.equal(r.shrunkWithout, true, 'พิสูจน์ว่าถ้าไม่ส่ง keepFormat ไฟล์เดียวกันนี้ถูกย่อจริง')
})

test('ไฟล์เสียที่อ้างว่าเป็น PNG หนัก >500 KB → คืนไฟล์เดิม ไม่ throw ไม่บล็อกการอัปโหลด', async () => {
  const r = await page.evaluate(async () => {
    const f = new File([new Uint8Array(900 * 1024)], 'broken.png', { type: 'image/png' })
    const out = await window.U.limitPublicImage('municipality-assets', f)
    return out === f
  })
  assert.equal(r, true)
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

test('PNG ที่มีส่วนโปร่งใส → คืนไฟล์เดิม ไม่แปลงเป็น JPEG (พื้นโปร่งใสจะเพี้ยน)', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 3000, h: 1600, transparentLeft: true })
    return { size: f.size, same: (await window.U.limitPublicImage('municipality-assets', f)) === f }
  })
  assert.ok(r.size > 500 * 1024)
  assert.equal(r.same, true)
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

// ── รูปข่าว: ย่อเหลือ 800 px ตั้งแต่ตอนอัปโหลด ───────────────────────────────────────────────
// ข้อมูลจริง 2026-10-04: รูปข่าว 8 ใบบนหน้าแรกน้ำเลา 1.6 MB ต่อการโหลดแบบเย็น ถูกโหลด ~14 ชุด/วัน
test('รูปข่าวแนวนอน 3000x2000 → JPEG กว้าง POST_IMAGE_MAX_WIDTH และเล็กลงชัดเจน', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 3000, h: 2000, type: 'image/jpeg', name: 'news.jpg' })
    const out = await window.U.shrinkPhoto(f, { maxWidth: window.U.POST_IMAGE_MAX_WIDTH, quality: window.U.POST_IMAGE_QUALITY })
    const d = await window.dims(out)
    return { before: f.size, after: out.size, same: out === f, type: out.type, w: d.w, h: d.h, max: window.U.POST_IMAGE_MAX_WIDTH }
  })
  assert.equal(r.max, 800)
  assert.equal(r.same, false)
  assert.equal(r.type, 'image/jpeg')
  assert.equal(r.w, 800, `ต้องกว้าง 800 px (ได้ ${r.w}x${r.h})`)
  assert.ok(r.after < r.before * 0.5, `ต้องเล็กลงอย่างน้อยครึ่งหนึ่ง (ก่อน ${r.before} หลัง ${r.after})`)
})

test('รูปข่าวแนวตั้ง 1200x2112 (ขนาดจริงของข่าวบนหน้าแรก) → กว้าง 800 (ไม่ใช่ 455 แบบจำกัดด้านยาว ที่เบลอใน object-cover)', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 1200, h: 2112, type: 'image/jpeg', name: 'poster.jpg' })
    const out = await window.U.shrinkPhoto(f, { maxWidth: window.U.POST_IMAGE_MAX_WIDTH, quality: window.U.POST_IMAGE_QUALITY })
    const d = await window.dims(out)
    return { before: f.size, after: out.size, w: d.w, h: d.h }
  })
  assert.equal(r.w, 800)
  assert.ok(Math.abs(r.h - 1408) <= 1, `สัดส่วนต้องคงเดิม (ได้ ${r.w}x${r.h})`)
  assert.ok(r.after < r.before, `ต้องเล็กลง (ก่อน ${r.before} หลัง ${r.after})`)
})

test('maxWidth ไม่ทำให้เพดานด้านยาว maxEdge หาย: แนวตั้งแคบ 600x4000 → ด้านยาว ≤ 1600', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 600, h: 4000, type: 'image/jpeg', name: 'tall.jpg' })
    const out = await window.U.shrinkPhoto(f, { maxWidth: window.U.POST_IMAGE_MAX_WIDTH, quality: window.U.POST_IMAGE_QUALITY })
    const d = await window.dims(out)
    return { w: d.w, h: d.h }
  })
  assert.equal(r.h, 1600)
  assert.ok(r.w <= 240, `สัดส่วนต้องคงเดิม (ได้ ${r.w}x${r.h})`)
})

test('รูปข่าวที่เล็กอยู่แล้ว 500x300 → ไม่ถูกขยาย', async () => {
  const r = await page.evaluate(async () => {
    const f = await window.makeImage({ w: 500, h: 300, type: 'image/jpeg', name: 'small.jpg' })
    const out = await window.U.shrinkPhoto(f, { maxWidth: window.U.POST_IMAGE_MAX_WIDTH, quality: window.U.POST_IMAGE_QUALITY })
    const d = await window.dims(out)
    return { w: d.w, h: d.h }
  })
  assert.deepEqual([r.w, r.h], [500, 300])
})

// ── ระดับซอร์ส: กันการแก้กลับโดยไม่รู้ตัว ─────────────────────────────────────────────────
test('uploadFile ต้องเรียก limitPublicImage ก่อนแปลงเป็น base64 เสมอ', async () => {
  const src = await read('../src/lib/driveStorage.js')
  const fnStart = src.indexOf('export async function uploadFile(')
  assert.ok(fnStart > 0)
  const body = src.slice(fnStart)
  const guard = body.indexOf('limitPublicImage(bucket, original, { keepFormat: options.keepFormat })')
  const encode = body.indexOf('fileToBase64(file)')
  assert.ok(guard > 0, 'ไม่พบการเรียก limitPublicImage ใน uploadFile')
  assert.ok(encode > guard, 'limitPublicImage ต้องมาก่อน fileToBase64')
})

test('หน้าตั้งค่า: ไอคอนแอป / โลโก้ / QR ต้องส่ง keepFormat: true (ไม่งั้นถูกแปลงเป็น JPEG)', async () => {
  const src = await read('../src/components/admin/SystemSettingsAdmin.jsx')
  const calls = {
    'ไอคอนแอป': /filename: `app-icon-\$\{tenant\.slug\}\.png`,[\s\S]{0,160}?keepFormat: true/,
    'โลโก้': /filename: `logo-\$\{tenant\.slug\}\.png`,[\s\S]{0,160}?keepFormat: true/,
    'QR': /filename: `\$\{tenant\.slug\}\.png`,[\s\S]{0,160}?keepFormat: true/,
  }
  for (const [name, re] of Object.entries(calls)) assert.match(src, re, `${name} ไม่ได้ส่ง keepFormat: true`)
})

test('หน้าตั้งค่า: ห้ามส่งไฟล์ดิบขึ้น municipality-assets และรูปถ่ายทุกช่องต้องเข้ารหัส JPEG', async () => {
  const src = await read('../src/components/admin/SystemSettingsAdmin.jsx')
  assert.doesNotMatch(src, /uploadFile\('municipality-assets', file,/, 'มีการส่งไฟล์ดิบ (file) ขึ้น municipality-assets')
  const photoCalls = [...src.matchAll(/resizeImage\(file, 1600[^)]*\)/g)].map(m => m[0])
  assert.ok(photoCalls.length >= 4, `ต้องมีรูปถ่ายอย่างน้อย 4 ช่อง (หัวเว็บ, Smart City, พื้นหลัง, แบนเนอร์) ได้ ${photoCalls.length}`)
  for (const call of photoCalls) assert.match(call, /PHOTO_JPEG/, `${call} ต้องใช้ PHOTO_JPEG`)
  assert.doesNotMatch(src, /tourism-background-\$\{tenant\.slug\}\.png/, 'นามสกุลไฟล์ต้องตรงเนื้อไฟล์ (.jpg)')
})

test('หน้าจัดการข่าว: ย่อด้วย shrinkPhoto + POST_IMAGE_MAX_WIDTH และนามสกุลต้องตรงเนื้อไฟล์', async () => {
  const src = await read('../src/components/staff/PostsManager.jsx')
  assert.match(src, /shrinkPhoto\(file, \{ maxWidth: POST_IMAGE_MAX_WIDTH, quality: POST_IMAGE_QUALITY \}\)/, 'ไม่ได้ย่อด้วย shrinkPhoto ตามค่ารูปข่าว')
  assert.doesNotMatch(src, /compressImage\(/, 'compressImage ข้ามไฟล์ <1.5 MB และขยายรูปแนวตั้งได้ — ห้ามกลับไปใช้')
  assert.match(src, /compressed\.type === 'image\/jpeg' \? 'jpg'/, 'นามสกุลต้องดูจากไฟล์ที่ย่อแล้ว ไม่ใช่ไฟล์ต้นฉบับ')
})

test('หน้าจัดการท่องเที่ยว: ห้ามใช้ค่าย่อของรูปข่าว (หน้ารายละเอียดแสดงใหญ่กว่ามาก)', async () => {
  const src = await read('../src/components/admin/TourismManager.jsx')
  assert.doesNotMatch(src, /POST_IMAGE_MAX_WIDTH/)
})
