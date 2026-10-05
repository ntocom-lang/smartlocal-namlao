// ฝั่งหน้าเว็บของพร็อกซีรูป /_img/ (src/lib/edgeImage.js) — ต้นเหตุ: Cached Egress ของ Supabase เกินโควตา 2026-10-04 (NOTES.md ข้อ 15)
// ส่วนแรกเป็นฟังก์ชันล้วนใน Node · ส่วนตัวสำรองรันใน Chrome จริง (route ปลอม ไม่ยิง Supabase/Worker จริง) · ส่วนท้ายตรวจระดับซอร์ส
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { edgeImageUrl, edgeImageUrls, originalImageUrl, EDGE_ALLOWED_STORAGE } from '../src/lib/edgeImage.js'
import { resolveImageRequest, ALLOWED_STORAGE } from '../worker/imageProxy.js'

const read = rel => readFile(new URL(rel, import.meta.url), 'utf8')

const SB = 'https://abc.supabase.co'
const prod = { supabaseOrigin: SB, hostname: 'namlao.rk-networks.com', origin: 'https://namlao.rk-networks.com', dev: false }
const PUB = `${SB}/storage/v1/object/public/`
const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const CASES_REWRITTEN = [
  [`${PUB}logos/logo-namlao.png`, 'https://namlao.rk-networks.com/_img/logos/logo-namlao.png'],
  [`${PUB}municipality-assets/banners/namlao/a.jpg`, 'https://namlao.rk-networks.com/_img/municipality-assets/banners/namlao/a.jpg'],
  [`${PUB}complaint-attachments/posts/b7394bd8/1782867272487-opt.jpg`, 'https://namlao.rk-networks.com/_img/complaint-attachments/posts/b7394bd8/1782867272487-opt.jpg'],
  [`${PUB}complaint-attachments/tourism/x/photo.jpg`, 'https://namlao.rk-networks.com/_img/complaint-attachments/tourism/x/photo.jpg'],
  [`${PUB}complaint-attachments/staff/p.png`, 'https://namlao.rk-networks.com/_img/complaint-attachments/staff/p.png'],
  [`${PUB}logos/logo.png?v=1780000000000`, 'https://namlao.rk-networks.com/_img/logos/logo.png?v=1780000000000'],
  [`${PUB}logos/%E0%B8%81.png`, 'https://namlao.rk-networks.com/_img/logos/%E0%B8%81.png'],
  [`${SB}/functions/v1/drive-file?id=${DRIVE_ID}`, `https://namlao.rk-networks.com/_img/drive-file?id=${DRIVE_ID}`],
  [`${SB}/functions/v1/drive-file?id=${DRIVE_ID}&v=1780000000000`, `https://namlao.rk-networks.com/_img/drive-file?id=${DRIVE_ID}&v=1780000000000`],
]

test('URL รูปสาธารณะบน Supabase → /_img/ ของโฮสต์ปัจจุบัน (แบบเต็ม ไม่ใช่ path สัมพัทธ์)', () => {
  for (const [from, to] of CASES_REWRITTEN) assert.equal(edgeImageUrl(from, prod), to, from)
})

test('ย้อนกลับด้วย originalImageUrl ได้ URL เดิมเป๊ะ (ใช้เป็นตัวสำรอง)', () => {
  for (const [from, to] of CASES_REWRITTEN) assert.equal(originalImageUrl(to, prod), from, to)
})

// ⚠️ PDPA: โฟลเดอร์อื่นของ complaint-attachments คือรูปแนบคำร้องของประชาชน ต้องไม่ถูกเขียนเป็น /_img/ เด็ดขาด
test('รูปคำร้องประชาชนและ bucket ที่ไม่อยู่ในรายการ → คืน URL เดิม', () => {
  const same = [
    `${PUB}complaint-attachments/3f8e1c52-0b4d-4c3a-9a67-111122223333/photo.jpg`,
    `${PUB}complaint-attachments/photo.jpg`,
    `${PUB}complaint-attachments/posts`,
    `${PUB}documents/a.pdf`,
    `${PUB}logos`,
    `${SB}/storage/v1/object/sign/logos/a.png?token=t`,
    `${SB}/storage/v1/object/authenticated/logos/a.png`,
    `${SB}/rest/v1/municipalities`,
  ]
  for (const u of same) assert.equal(edgeImageUrl(u, prod), u, u)
})

test('traversal / path เพี้ยน / พารามิเตอร์เพี้ยน → คืน URL เดิม', () => {
  const same = [
    `${PUB}logos/%2e%2e/complaint-attachments/x.jpg`,
    `${PUB}logos/a%2fb.png`,
    `${PUB}logos/a%5cb.png`,
    `${PUB}logos//a.png`,
    `${PUB}logos/../complaint-attachments/3f8e1c52-0b4d-4c3a-9a67-111122223333/photo.jpg`,
    `${PUB}municipality-assets/../../../../rest/v1/profiles`,
    `${SB}/functions/v1/drive-file`,
    `${SB}/functions/v1/drive-file?id=short`,
    `${SB}/functions/v1/drive-file?id=${DRIVE_ID}/../x`,
    `${SB}/functions/v1/other?id=${DRIVE_ID}`,
  ]
  for (const u of same) assert.equal(edgeImageUrl(u, prod), u, u)
})

// new URL() ยุบ ./ และ ../ ให้ก่อนตรวจ (เบราว์เซอร์ทำแบบเดียวกันอยู่แล้ว) จึงตรวจ allowlist บน path ที่ยุบแล้ว — ไม่หลุดผ่าน ../
test('./ ในพาธถูกยุบเหมือนที่เบราว์เซอร์ทำ แล้วตรวจ allowlist บนพาธที่ยุบแล้ว', () => {
  assert.equal(edgeImageUrl(`${PUB}logos/./a.png`, prod), 'https://namlao.rk-networks.com/_img/logos/a.png')
  assert.equal(edgeImageUrl(`${PUB}logos/x/../a.png`, prod), 'https://namlao.rk-networks.com/_img/logos/a.png')
})

test('v ที่ไม่ใช่ตัวเลขถูกทิ้ง (Worker จะตอบ 404 ถ้าส่งไป) และพารามิเตอร์อื่นไม่ถูกส่งต่อ', () => {
  assert.equal(edgeImageUrl(`${PUB}logos/a.png?v=abc`, prod), 'https://namlao.rk-networks.com/_img/logos/a.png')
  assert.equal(edgeImageUrl(`${PUB}logos/a.png?t=1&download=1`, prod), 'https://namlao.rk-networks.com/_img/logos/a.png')
})

test('ทำงานเฉพาะโฮสต์ *.rk-networks.com บนบันเดิล production — ที่อื่นคืน URL เดิมทุกกรณี', () => {
  const url = `${PUB}logos/a.png`
  const cases = [
    { ...prod, hostname: 'localhost', origin: 'http://localhost:5174' },
    { ...prod, hostname: 'namlao.localhost', origin: 'http://namlao.localhost:5174' },
    { ...prod, hostname: 'smartlocal.ntocom.workers.dev', origin: 'https://smartlocal.ntocom.workers.dev' },
    { ...prod, hostname: 'rk-networks.com', origin: 'https://rk-networks.com' },
    { ...prod, hostname: 'evilrk-networks.com', origin: 'https://evilrk-networks.com' },
    { ...prod, hostname: 'rk-networks.com.evil.test', origin: 'https://rk-networks.com.evil.test' },
    { ...prod, dev: true },
    { ...prod, supabaseOrigin: '' },
    { ...prod, origin: '' },
  ]
  for (const ctx of cases) assert.equal(edgeImageUrl(url, ctx), url, JSON.stringify(ctx))
})

test('URL ของโปรเจกต์อื่น/โฮสต์อื่น/ค่าที่ไม่ใช่สตริง → ไม่ถูกแตะ', () => {
  for (const u of ['https://other.supabase.co/storage/v1/object/public/logos/a.png', 'https://example.com/a.png', '/tourism-bg.jpg', 'not a url', '', null, undefined, 42, {}]) {
    assert.deepEqual(edgeImageUrl(u, prod), u)
  }
  assert.deepEqual(edgeImageUrls(null, prod), null)
  assert.deepEqual(edgeImageUrls([`${PUB}logos/a.png`, null], prod), ['https://namlao.rk-networks.com/_img/logos/a.png', null])
  // นอกเบราว์เซอร์ (ไม่มี window.location) ต้องปิดตัวเอง — ไม่เขียน URL เป็น /_img/ ในที่ที่ไม่มี Worker
  assert.deepEqual(edgeImageUrls([`${PUB}logos/a.png`]), [`${PUB}logos/a.png`])
})

test('เรียกซ้ำได้ (URL /_img/ อยู่แล้วไม่เปลี่ยน) และ originalImageUrl ไม่แตะ URL ที่ไม่ใช่ /_img/', () => {
  for (const [, edge] of CASES_REWRITTEN) assert.equal(edgeImageUrl(edge, prod), edge)
  for (const u of [`${PUB}logos/a.png`, 'https://other.test/_img/logos/a.png', 'https://namlao.rk-networks.com/assets/a.png', 'x', null]) {
    assert.equal(originalImageUrl(u, prod), null, String(u))
  }
  assert.equal(originalImageUrl(`https://namlao.rk-networks.com/_img/drive-file?id=bad`, prod), null)
})

// ── ต้องตรงกับ Worker ─────────────────────────────────────────────────────────────────────
test('รายการ bucket ตรงกับ ALLOWED_STORAGE ใน worker/imageProxy.js เป๊ะ', () => {
  assert.deepEqual(EDGE_ALLOWED_STORAGE, ALLOWED_STORAGE)
})

test('ทุก URL ที่ฝั่งเว็บเขียนเป็น /_img/ ต้องเป็น URL ที่ Worker ยอมให้ผ่าน (และกลับกันสำหรับ Storage/drive-file ที่ฝั่งเว็บไม่เขียน)', () => {
  const urls = [
    ...CASES_REWRITTEN.map(([from]) => from),
    `${PUB}complaint-attachments/3f8e1c52-0b4d-4c3a-9a67-111122223333/photo.jpg`,
    `${PUB}complaint-attachments/posts`,
    `${PUB}documents/a.pdf`,
    `${PUB}logos/%2e%2e/a.png`,
    `${PUB}logos//a.png`,
    `${PUB}logos/a.png?v=abc`,
    `${SB}/functions/v1/drive-file?id=short`,
  ]
  for (const url of urls) {
    const edge = edgeImageUrl(url, prod)
    const rewritten = edge !== url
    const u = new URL(edge)
    const workerSays = rewritten ? resolveImageRequest(u.pathname, u.search, SB) : null
    if (rewritten) assert.ok(workerSays, `ฝั่งเว็บเขียน ${url} เป็น /_img/ แต่ Worker ไม่ยอมผ่าน`)
  }
  // ฝั่งเว็บไม่ยอมเขียนอะไรที่ Worker ปฏิเสธ — ตรวจย้อนจากฝั่ง Worker สำหรับ path ที่ควรปฏิเสธ
  for (const bad of ['complaint-attachments/3f8e1c52-0b4d-4c3a-9a67-111122223333/photo.jpg', 'complaint-attachments/posts', 'documents/a.pdf']) {
    assert.equal(resolveImageRequest(`/_img/${bad}`, '', SB), null, bad)
    assert.equal(edgeImageUrl(`${PUB}${bad}`, prod), `${PUB}${bad}`, bad)
  }
})

// ── ตัวสำรองใน Chrome จริง ─────────────────────────────────────────────────────────────────
// เสิร์ฟสำเนา edgeImage.js ที่แทนค่า env 2 จุดด้วยค่าคงที่ (ไฟล์จริงอ่านจาก import.meta.env ของ Vite)
const edgeRaw = await read('../src/lib/edgeImage.js')
for (const needle of ['new URL(import.meta.env?.VITE_SUPABASE_URL)', 'Boolean(import.meta.env?.DEV)']) {
  assert.ok(edgeRaw.includes(needle), `ไม่พบ ${needle} ใน edgeImage.js — โครงไฟล์เปลี่ยน ปรับเทสต์นี้`)
}
const edgeSrc = edgeRaw
  .replace('new URL(import.meta.env?.VITE_SUPABASE_URL)', `new URL('${SB}')`)
  .replace('Boolean(import.meta.env?.DEV)', 'false')

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64')
let browser
let page
const hits = []

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage()
  await page.route('https://namlao.rk-networks.com/**', route => {
    const url = new URL(route.request().url())
    hits.push(url.pathname + url.search)
    if (url.pathname === '/edge.js') return route.fulfill({ contentType: 'text/javascript', body: edgeSrc })
    if (url.pathname === '/_img/logos/good.png') return route.fulfill({ contentType: 'image/png', body: PIXEL })
    if (url.pathname.startsWith('/_img/')) return route.fulfill({ status: 502, contentType: 'text/plain', body: 'bad gateway' })
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fallback</title>' })
  })
  await page.route(`${SB}/**`, route => {
    const url = new URL(route.request().url())
    hits.push('SB ' + url.pathname + url.search)
    if (url.pathname.endsWith('/gone.png')) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no' })
    return route.fulfill({ contentType: 'image/png', body: PIXEL })
  })
  await page.goto('https://namlao.rk-networks.com/')
  await page.evaluate(async () => {
    const mod = await import('/edge.js')
    window.E = mod
    window.removeFallback = mod.installEdgeImageFallback()
  })
})

after(async () => { await browser?.close() })

async function addImg(src) {
  return page.evaluate(src => new Promise(resolve => {
    const img = document.createElement('img')
    img.id = 'i' + Math.random().toString(36).slice(2)
    img.onload = img.onerror = () => setTimeout(() => resolve({ id: img.id, w: img.naturalWidth, src: img.src, fb: img.dataset.edgeFallback ?? null }), 150)
    img.src = src
    document.body.append(img)
  }), src)
}

test('รูปผ่าน /_img/ ปกติ → ไม่ไปแตะ Supabase และไม่ตั้งธงสำรอง', async () => {
  hits.length = 0
  const r = await addImg('https://namlao.rk-networks.com/_img/logos/good.png')
  assert.equal(r.w, 1)
  assert.equal(r.fb, null)
  assert.deepEqual(hits, ['/_img/logos/good.png'])
})

test('/_img/ ตอบ error → <img> ชี้กลับ URL เดิมของ Supabase 1 ครั้ง และรูปขึ้น', async () => {
  hits.length = 0
  const r = await addImg('https://namlao.rk-networks.com/_img/logos/broken.png?v=1780000000000')
  assert.equal(r.w, 1, 'รูปควรขึ้นจาก URL สำรอง')
  assert.equal(r.fb, '1')
  assert.equal(r.src, `${SB}/storage/v1/object/public/logos/broken.png?v=1780000000000`)
  assert.deepEqual(hits, ['/_img/logos/broken.png?v=1780000000000', 'SB /storage/v1/object/public/logos/broken.png?v=1780000000000'])
})

test('รูป Drive: /_img/drive-file error → กลับไป drive-file ตรง', async () => {
  hits.length = 0
  const r = await addImg(`https://namlao.rk-networks.com/_img/drive-file?id=${DRIVE_ID}`)
  assert.equal(r.w, 1)
  assert.equal(r.src, `${SB}/functions/v1/drive-file?id=${DRIVE_ID}`)
})

test('ทั้ง /_img/ และต้นฉบับไม่มีรูป → ลองครั้งเดียวเท่านั้น ไม่วนซ้ำ', async () => {
  hits.length = 0
  const r = await addImg('https://namlao.rk-networks.com/_img/logos/gone.png')
  assert.equal(r.w, 0)
  await page.waitForTimeout(400)
  assert.deepEqual(hits, ['/_img/logos/gone.png', 'SB /storage/v1/object/public/logos/gone.png'])
})

test('รูปที่ไม่ใช่ /_img/ พังเอง → ไม่ถูกแตะ', async () => {
  hits.length = 0
  const r = await addImg(`${SB}/storage/v1/object/public/logos/gone.png`)
  assert.equal(r.fb, null)
  assert.deepEqual(hits, ['SB /storage/v1/object/public/logos/gone.png'])
})

test('ถอดตัวดักออกแล้วไม่มีผล (ฟังก์ชันคืนตัวถอดที่ใช้ได้จริง)', async () => {
  await page.evaluate(() => window.removeFallback())
  hits.length = 0
  const r = await addImg('https://namlao.rk-networks.com/_img/logos/broken2.png')
  assert.equal(r.fb, null)
  assert.equal(r.w, 0)
  assert.deepEqual(hits, ['/_img/logos/broken2.png'])
})

// ── ระดับซอร์ส ──────────────────────────────────────────────────────────────────────────
// จุดที่ต้องใช้ edgeImageUrl: เพิ่มจุดแสดงรูปใหม่แล้วลืมครอบ = รูปนั้นยังดึง Supabase ตรง (ไม่ผิด แต่โควตากลับมากิน)
const RENDER_SITES = {
  'src/components/home/BannerSlider.jsx': [/edgeImageUrl\(toReliableImageUrl\(b\.image_url\)\)/],
  'src/components/home/PostsHighlight.jsx': [/src=\{edgeImageUrl\(post\.image_url\)\}/],
  'src/pages/PostsPage.jsx': [/src=\{edgeImageUrl\(post\.image_url\)\}/],
  'src/components/home/TourismSection.jsx': [/src=\{edgeImageUrl\(hero\.image_url\)\}/, /src=\{edgeImageUrl\(place\.image_url\)\}/, /edgeImageUrl\(toReliableImageUrl\(tenant\?\.tourism_background_url\)\)/, /originalImageUrl\(backgroundUrl\)/],
  'src/pages/TourismPage.jsx': [/src=\{edgeImageUrl\(place\.image_url\)\}/],
  'src/pages/TourismDetailPage.jsx': [/\.filter\(Boolean\)\.map\(u => edgeImageUrl\(u\)\)/],
  'src/components/home/StaffSection.jsx': [/src=\{edgeImageUrl\(person\.photo_url\)\}/],
  'src/contexts/TenantContext.jsx': [/logo_url: edgeUrl\(merged\.logo_url\)/, /header_image_url: edgeUrl\(merged\.header_image_url\)/, /smart_city_image_url: edgeUrl\(merged\.smart_city_image_url\)/],
}
for (const t of ['CivicFriendly', 'CleanMinimal', 'EcoFriendly', 'SmartModern', 'WaveFluid']) {
  RENDER_SITES[`src/components/citizen/templates/${t}/Home.jsx`] = [/src=\{edgeImageUrl\(post\.image_url\)\}/]
}

for (const [file, patterns] of Object.entries(RENDER_SITES)) {
  test(`${file} → ใช้ edgeImageUrl กับรูปสาธารณะ และไม่เหลือ src ดิบ`, async () => {
    const src = await read(`../${file}`)
    assert.match(src, /import \{[^}]*edgeImageUrl[^}]*\} from '[./]+\/lib\/edgeImage'/)
    for (const p of patterns) assert.match(src, p)
    assert.doesNotMatch(src, /src=\{(post|place|hero|person)\.(image_url|photo_url)\}/, 'เหลือ <img src> ที่ไม่ผ่าน edgeImageUrl')
  })
}

test('main.jsx ติดตั้งตัวสำรองก่อน render', async () => {
  const src = await read('../src/main.jsx')
  const install = src.indexOf('installEdgeImageFallback()')
  assert.ok(install > 0, 'ไม่พบการเรียก installEdgeImageFallback()')
  assert.ok(install < src.indexOf('createRoot('), 'ต้องติดตั้งก่อน createRoot(...).render')
})

// ⚠️ รูปคำร้องประชาชนและหน้าจัดการต้องไม่ผ่านพร็อกซี: ไฟล์เหล่านี้ห้าม import edgeImage เด็ดขาด
// (ComplaintsManager เรียก toReliableImageUrl กับไฟล์แนบคำร้อง — ถ้าเผลอครอบ edgeImageUrl รูปประชาชนจะเข้าแคช edge 7 วัน)
for (const file of ['src/lib/driveStorage.js', 'src/components/admin/ComplaintsManager.jsx', 'src/components/admin/SystemSettingsAdmin.jsx', 'src/components/staff/PostsManager.jsx', 'src/components/common/TenantPicker.jsx']) {
  test(`${file} ต้องไม่ใช้ edgeImage (รูปคำร้อง/หน้าจัดการ/ค่าที่บันทึกลงฐานข้อมูล)`, async () => {
    assert.doesNotMatch(await read(`../${file}`), /edgeImage/)
  })
}

test('ไม่มีโค้ดบันทึก tenant.logo_url / header / smart_city ที่ผ่าน edgeImageUrl กลับลงฐานข้อมูล', async () => {
  const src = await read('../src/components/admin/SystemSettingsAdmin.jsx')
  // SystemSettingsAdmin เขียนเฉพาะ URL ของไฟล์ที่เพิ่งอัปโหลด — ห้ามมีการส่ง tenant.<รูป> เข้า .update/.rpc
  assert.doesNotMatch(src, /(update|upsert)\(\{[^}]*tenant\??\.(logo_url|header_image_url|smart_city_image_url)/)
  assert.doesNotMatch(src, /p_(logo|header_image|smart_city_image)_url:\s*tenant/)
})
