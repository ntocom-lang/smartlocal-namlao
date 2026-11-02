// เทสต์ชุดเอกสารส่ง Google Play — รันด้วย: node tests/store-listing.test.mjs
//
// ทำไมต้องมี: ข้อความหน้าสโตร์ยาวเกินเพดานหรือบอกฟีเจอร์ที่ไม่มีจริง = ส่งแอปไม่ผ่านหรือโดนตีกลับตอนรีวิว
// และภาพหน้าจอต้องมาจากโดเมนกลางกับ อปท. สาธิตเท่านั้น (ห้ามถ่ายหน้าของ อปท. จริง — อาจมีข้อมูลประชาชน)
// ตัวเลขเพดานตรวจจากหน้าทางการของ Google 2569-11-03:
//   support.google.com/googleplay/android-developer/answer/9859152 (ชื่อ 30 · สั้น 80 · เต็ม 4,000 ตัวอักษร)
//   support.google.com/googleplay/android-developer/answer/9866151 (ไอคอน/ภาพหน้าจอ/feature graphic)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ANDROID_PACKAGE_ID } from '../worker/storeApp.js'
import { PLATFORM_APP_NAME, PLATFORM_DOMAIN, platformPageFor } from '../src/lib/platform.js'
import { FEATURE_GRAPHIC, SCREEN, SHOTS, checkScreenshot, pngInfo } from '../scripts/store-assets.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const listing = JSON.parse(read('docs/store/listing.json'))
const count = (text) => [...text].length // นับตัวอักษรรวมสระ/วรรณยุกต์ ตามที่ Play นับ
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`) }

console.log('ข้อความหน้าสโตร์ (docs/store/listing.json)')
check('ชื่อและ package ตรงกับที่แอปใช้จริง (ชื่อในนโยบาย/แอป/สโตร์ต้องเป็นชื่อเดียวกัน)', () => {
  assert.equal(listing.app.name, PLATFORM_APP_NAME)
  assert.equal(listing.app.package, ANDROID_PACKAGE_ID)
  for (const lang of ['th', 'en']) assert.equal(listing[lang].title, PLATFORM_APP_NAME, lang)
})
check('ความยาวไม่เกินเพดาน Google Play: ชื่อ 30 · คำอธิบายสั้น 80 · คำอธิบายเต็ม 4,000', () => {
  for (const lang of ['th', 'en']) {
    const t = listing[lang]
    assert.ok(count(t.title) <= 30, `${lang} title ${count(t.title)}`)
    assert.ok(count(t.shortDescription) <= 80, `${lang} short ${count(t.shortDescription)}`)
    assert.ok(count(t.fullDescription) <= 4000, `${lang} full ${count(t.fullDescription)}`)
    assert.ok(t.shortDescription.trim() && t.fullDescription.trim() && t.releaseNotes.trim(), lang)
  }
})
check('ทุกฟีเจอร์ที่โฆษณาชี้ route ที่มีจริงในแอป และปรากฏในคำอธิบายเต็มทั้งสองภาษา', () => {
  const app = read('src/App.jsx')
  assert.ok(listing.features.length >= 4)
  for (const f of listing.features) {
    assert.ok(app.includes(`path="${f.route}"`), `ไม่มี route ${f.route} ใน App.jsx`)
    assert.ok(listing.th.fullDescription.includes(f.th), `ไทยไม่มี: ${f.th}`)
    assert.ok(listing.en.fullDescription.includes(f.en), `อังกฤษไม่มี: ${f.en}`)
  }
})
check('ลิงก์ที่กรอกในสโตร์อยู่โดเมนกลาง ชี้หน้ากลางที่มีจริง (นโยบาย/ลบบัญชี/ช่วยเหลือ) ไม่ใช่ PDF', () => {
  const expected = { privacyPolicy: 'privacy', accountDeletion: 'account-delete', support: 'support' }
  for (const [key, page] of Object.entries(expected)) {
    const url = new URL(listing.urls[key])
    assert.equal(url.protocol, 'https:', key)
    assert.equal(url.hostname, `app.${PLATFORM_DOMAIN}`, key)
    assert.equal(platformPageFor(url.pathname), page, key)
  }
})
check('ข้อความไม่อ้างว่าเป็นแอปของหน่วยงานรัฐส่วนกลาง และบอกวิธีลบบัญชีในแอป', () => {
  for (const lang of ['th', 'en']) {
    const full = listing[lang].fullDescription
    assert.ok(/ไม่ใช่แอปของกรมส่งเสริมการปกครองท้องถิ่น|not an app of the Department of Local Administration/.test(full), lang)
    assert.ok(/ลบบัญชี|delete your account/.test(full), lang)
  }
})

console.log('ภาพหน้าสโตร์ (scripts/store-assets.mjs)')
check('ภาพหน้าจอ 2–8 ภาพ ขนาดแนวตั้ง 9:16 ≥ 1080x1920 เข้าเกณฑ์โปรโมชันหน้าจอใหญ่ (≥ 4 ภาพ)', () => {
  assert.ok(SHOTS.length >= 4 && SHOTS.length <= 8, `${SHOTS.length} ภาพ`)
  assert.equal(SCREEN.width * SCREEN.scale, 1080)
  assert.equal(SCREEN.height * SCREEN.scale, 1920)
  assert.equal(checkScreenshot({ width: 1080, height: 1920, colorType: 2 }), '')
})
check('ตัวตรวจขนาดจับของที่ผิดกติกา: มีช่องอัลฟา · ต่ำกว่า 320 · ยาวเกิน 3840 · สัดส่วนเกิน 2 เท่า', () => {
  assert.notEqual(checkScreenshot({ width: 1080, height: 1920, colorType: 6 }), '')
  assert.notEqual(checkScreenshot({ width: 300, height: 500, colorType: 2 }), '')
  assert.notEqual(checkScreenshot({ width: 1080, height: 3900, colorType: 2 }), '')
  assert.notEqual(checkScreenshot({ width: 1000, height: 2100, colorType: 2 }), '')
})
check('ถ่ายเฉพาะโดเมนกลางกับ อปท. สาธิต (demo) — ห้ามหน้าของ อปท. จริง (PDPA)', () => {
  const allowed = new Set([`app.${PLATFORM_DOMAIN}`, `demo.${PLATFORM_DOMAIN}`])
  for (const shot of SHOTS) assert.ok(allowed.has(new URL(shot.url).hostname), shot.url)
})
check('ภาพ feature graphic 1024x500 และไอคอน 512x512 PNG 32 บิตมีอัลฟา ≤ 1,024KB', () => {
  assert.deepEqual({ ...FEATURE_GRAPHIC }, { width: 1024, height: 500 })
  const buf = readFileSync(new URL('public/icons/icon-512x512.png', root))
  assert.deepEqual(pngInfo(buf), { width: 512, height: 512, bitDepth: 8, colorType: 6 })
  assert.ok(buf.length <= 1024 * 1024)
})

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)
