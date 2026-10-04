// ตัวกันรูป Storage ในสคริปต์ Playwright (tests/lib/blockStorageImages.mjs) — ต้นเหตุ: สคริปต์ของเราเองกินราว 40–50% ของ
// Cached Egress ของ Supabase ในบางวัน (วัดจาก edge_logs 2026-10-04, ดู docs/ai/NOTES.md ข้อ 15)
// เทสต์นี้ไม่แตะเครือข่ายจริงเลย: ทุกคำขอถูกตอบด้วย route ปลอมใน Chrome จริง
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { blockStorageImages, isPublicStorageUrl } from './lib/blockStorageImages.mjs'

const STORAGE_IMG = 'https://umxssfahtuprnztlytdd.supabase.co/storage/v1/object/public/municipality-assets/logos/logo-namlao.png'
const SIGNED_IMG = 'https://umxssfahtuprnztlytdd.supabase.co/storage/v1/object/sign/docs/a.png?token=t'
const OTHER_IMG = 'https://cdn.test/a.svg'
const ICON_IMG = 'https://umxssfahtuprnztlytdd.supabase.co/storage/v1/object/public/logos/tab-icon.png'

let browser
let page
const reachedNetwork = [] // URL ของ supabase.co ที่ "หลุดไปถึงเครือข่าย" (route ปลอมด้านล่างเป็นด่านสุดท้าย)

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage()
  // route ที่ลงทะเบียนก่อนถูกเรียกทีหลัง: ตัวกันรูปลงทะเบียนทีหลังสุดจึงเห็นคำขอก่อน แล้ว fallback ลงมาที่นี่
  await page.route('https://block.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>t</title><link rel="icon" href="${ICON_IMG}"><img id="a" src="${STORAGE_IMG}"><img id="b" src="${OTHER_IMG}"><img id="c" src="${SIGNED_IMG}">`,
  }))
  await page.route('https://cdn.test/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>',
  }))
  await page.route(url => url.hostname.endsWith('.supabase.co'), route => {
    reachedNetwork.push(route.request().url())
    return route.fulfill({ contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'REAL' })
  })
  await blockStorageImages(page)
  await page.goto('https://block.test/')
  await page.waitForFunction(() => [...document.images].every(i => i.complete))
})

after(async () => { await browser?.close() })

test('รูปจาก Storage สาธารณะ → ได้พิกเซล 1x1 ที่ Chrome ถอดรหัสได้จริง และไม่หลุดไปถึงเครือข่าย', async () => {
  const w = await page.$eval('#a', img => img.naturalWidth)
  assert.equal(w, 1)
  assert.ok(!reachedNetwork.includes(STORAGE_IMG), 'คำขอรูป Storage หลุดไปถึงเครือข่าย')
})

test('ไอคอนแท็บ <link rel="icon"> จาก Storage → ไม่หลุดไปถึงเครือข่าย (resourceType เป็น other ไม่ใช่ image)', async () => {
  await page.waitForTimeout(1500) // เบราว์เซอร์ดึง favicon หลังโหลดหน้าเสร็จ
  assert.ok(!reachedNetwork.includes(ICON_IMG), 'คำขอไอคอนแท็บหลุดไปถึงเครือข่าย — โลโก้ 543 KB ต่อการเปิดหน้า')
})

test('รูปจากโฮสต์อื่น → ไม่ถูกแตะ', async () => {
  assert.equal(await page.$eval('#b', img => img.naturalWidth), 40)
})

test('Storage ที่ไม่ใช่ /object/public/ (signed) → ไม่ถูกกรอง ไปถึงเครือข่ายตามปกติ', async () => {
  assert.ok(reachedNetwork.includes(SIGNED_IMG))
})

test('fetch() ไป Storage สาธารณะ → ไม่ใช่รูป จึง fallback ไปเครือข่าย (แอปบางจุดอ่านไฟล์จริง)', async () => {
  const text = await page.evaluate(url => fetch(url).then(r => r.text()), STORAGE_IMG)
  assert.equal(text, 'REAL')
  assert.ok(reachedNetwork.includes(STORAGE_IMG))
})

test('isPublicStorageUrl แม่นยำ', () => {
  const yes = [STORAGE_IMG, 'https://abc.supabase.co/storage/v1/object/public/logos/x.png?v=1']
  const no = [
    SIGNED_IMG,
    'https://abc.supabase.co/rest/v1/profiles',
    'https://abc.supabase.co/functions/v1/drive-file?id=1',
    'https://example.com/storage/v1/object/public/x.png',
    'https://notsupabase.co/storage/v1/object/public/x.png',
  ]
  for (const u of yes) assert.equal(isPublicStorageUrl(new URL(u)), true, u)
  for (const u of no) assert.equal(isPublicStorageUrl(new URL(u)), false, u)
})

// ── ระดับซอร์ส ──────────────────────────────────────────────────────────────────────────
// post-deploy-smoke เปิดหน้าแรกน้ำเลา (รูปอยู่ Supabase Storage) แบบ context ใหม่ทุกรอบ จึงต้องมีตัวกัน
// จำนวนต้องเท่ากับจำนวน browser.newContext( ในไฟล์ — เพิ่ม context ใหม่แล้วลืมครอบ เทสต์จะแดง
test('post-deploy-smoke → import ตัวกัน และครอบทุก context', async () => {
  const src = await readFile(new URL('post-deploy-smoke.mjs', import.meta.url), 'utf8')
  assert.match(src, /import \{ blockStorageImages \} from '\.\/lib\/blockStorageImages\.mjs'/)
  const contexts = [...src.matchAll(/browser\.newContext\(/g)].length
  const calls = [...src.matchAll(/await blockStorageImages\(context\)/g)].length
  assert.ok(contexts >= 1, 'ไม่พบ browser.newContext( — โครงไฟล์เปลี่ยน ปรับเทสต์นี้')
  assert.equal(calls, contexts, `ครอบ context ไม่ครบ (context ${contexts}, ครอบ ${calls})`)
})

// เครื่องมือที่ต้องเห็นรูปจริง (ถ่ายภาพหน้าจอ/ตรวจ build ให้เจ้าของดู) ห้ามใช้ตัวกัน — ภาพจะไม่จริง
for (const file of ['screenshot-local-build.mjs', 'verify-local-build.mjs']) {
  test(`${file} ต้องไม่ใช้ตัวกันรูป (ต้องเห็นรูปจริง)`, async () => {
    const src = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /blockStorageImages/)
  })
}
