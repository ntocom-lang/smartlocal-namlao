// เทสต์หน้า /download และไฟล์ APK ที่ให้โหลด — รันด้วย: node tests/app-download.test.mjs
//
// ทำไมต้องมี:
// 1) ค่า SHA-256/ขนาด/เวอร์ชันที่หน้าเว็บแสดง ต้องตรงกับไฟล์ที่เสิร์ฟจริง — ไม่ตรง = คนตรวจไฟล์แล้วคิดว่าถูกเปลี่ยนมือ
//    และไฟล์เก่าค้างหลัง build ใหม่โดยไม่มีใครรู้ (สคริปต์ npm run twa:publish เขียนค่าให้ เทสต์นี้กันคนแก้มือ/ลืม publish)
// 2) ไฟล์ APK หายแล้วโดเมนตอบหน้า HTML (SPA fallback) มือถือจะโหลดไปเป็น "apk" เสียแล้วติดตั้งไม่ได้ — ต้องได้ 404
// 3) ถ้อยคำในหน้าติดตั้งต้องไม่สัญญาเกินที่ทดสอบแล้ว (บัญชีใช้ร่วมกันได้ แต่การจำล็อกอินแยกตามช่องทาง)
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import worker from '../worker/index.js'
import { APK_DOWNLOAD } from '../src/lib/appDownload.js'
import { PLATFORM_APP_NAME, platformPageFor } from '../src/lib/platform.js'
import { buildPlatformDownload, formatFileSize } from '../src/lib/platformInfo.js'
import { APK_PUBLIC_PATH, appDownloadModule } from '../scripts/twa-publish.mjs'
import { APP_VERSION } from '../scripts/twa-build.mjs'

const root = new URL('..', import.meta.url)
const APP_HOST = 'app.rk-networks.com'
let passed = 0
async function check(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`) }
const textOf = (doc) => JSON.stringify(doc)
const section = (doc, id) => doc.sections.find((s) => s.id === id)

console.log('ไฟล์ APK ที่ให้โหลด')
const apkFile = new URL(`public${APK_DOWNLOAD.path}`, root)
await check('ไฟล์อยู่ที่ path ที่หน้าเว็บอ้าง เป็นไฟล์ zip (APK) ไม่ว่าง', () => {
  assert.equal(APK_DOWNLOAD.path, APK_PUBLIC_PATH)
  assert.match(APK_DOWNLOAD.path, /^\/downloads\/[a-z0-9-]+\.apk$/)
  assert.ok(existsSync(apkFile), 'ไม่พบไฟล์ — รัน npm run twa:build แล้ว npm run twa:publish')
  assert.equal(readFileSync(apkFile).subarray(0, 2).toString('latin1'), 'PK')
})
await check('SHA-256 · ขนาด · เวอร์ชัน ที่หน้าเว็บแสดงตรงกับไฟล์จริงและ APP_VERSION', () => {
  const bytes = readFileSync(apkFile)
  assert.equal(APK_DOWNLOAD.sha256, createHash('sha256').update(bytes).digest('hex'), 'ไฟล์ไม่ตรงกับ src/lib/appDownload.js — รัน npm run twa:publish ใหม่')
  assert.equal(APK_DOWNLOAD.sizeBytes, statSync(apkFile).size)
  assert.equal(APK_DOWNLOAD.versionName, APP_VERSION.name)
  assert.equal(APK_DOWNLOAD.versionCode, APP_VERSION.code)
})
await check('src/lib/appDownload.js คือผลของ twa:publish ทุกตัวอักษร (ห้ามแก้มือ)', () => {
  assert.equal(readFileSync(new URL('src/lib/appDownload.js', root), 'utf8').replace(/\r\n/g, '\n'), appDownloadModule(APK_DOWNLOAD))
})
await check('ไฟล์ APK ที่ไม่มีจริงได้ 404 ไม่ใช่หน้า HTML ของเว็บ', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('ห้ามยิงเครือข่าย') }
  try {
    const res = await worker.fetch(new Request(`https://${APP_HOST}/downloads/ไม่มีไฟล์นี้.apk`), {}, { waitUntil() {} })
    assert.equal(res.status, 404)
  } finally {
    globalThis.fetch = realFetch
  }
})

console.log('หน้า /download')
const doc = buildPlatformDownload([], APP_HOST)
await check('เป็นหน้ากลาง /download บนโดเมนกลาง (ทับ / ท้ายได้)', () => {
  assert.equal(platformPageFor('/download'), 'download')
  assert.equal(platformPageFor('/download/'), 'download')
  assert.equal(platformPageFor('/downloads'), null)
  assert.equal(platformPageFor('/downloads/x.apk'), null)
})
await check('ชื่อแอปตรงกับสโตร์ · ปุ่มโหลดชี้ไฟล์จริงพร้อมเวอร์ชัน/ขนาด · มี SHA-256 ให้ตรวจ', () => {
  assert.ok(doc.title.includes(PLATFORM_APP_NAME))
  const android = section(doc, 'android')
  assert.equal(android.download.href, APK_DOWNLOAD.path)
  assert.match(android.download.meta, new RegExp(`เวอร์ชัน ${APK_DOWNLOAD.versionName} · ${formatFileSize(APK_DOWNLOAD.sizeBytes).replace('.', '\\.')}`))
  assert.ok(android.details.text.includes(APK_DOWNLOAD.sha256))
  assert.ok(android.steps.some((s) => s.includes('แหล่งที่ไม่รู้จัก')), 'ต้องบอกเรื่องติดตั้งจากแหล่งที่ไม่รู้จัก')
  assert.ok(android.steps.some((s) => s.includes('Play Protect')))
  assert.ok(android.steps.some((s) => s.includes(`"${PLATFORM_APP_NAME}"`)))
})
await check('หลังกดโหลดมีขั้นต่อไปที่ผู้ใช้ต้องทำเอง และไม่อ้างว่าติดตั้งให้อัตโนมัติ (Android ไม่ให้เว็บติดตั้งแอปเอง)', () => {
  const { after } = section(doc, 'android').download
  assert.ok(after.title && after.steps.length >= 3 && after.steps.length <= 5, 'สั้นพอให้ผู้สูงอายุอ่านจบ')
  const text = after.steps.join(' ')
  for (const word of ['เปิด', 'ติดตั้ง', 'อนุญาตจากแหล่งนี้', 'เก็บไว้']) assert.ok(text.includes(word), word)
  assert.doesNotMatch(textOf(doc), /ติดตั้ง(ให้)?อัตโนมัติ|ติดตั้งเอง/)
})
await check('มีวิธีของ iPhone (ไม่มี APK บน iOS) และ QR ชี้หน้านี้บนโดเมนกลาง', () => {
  const iphone = section(doc, 'iphone')
  assert.ok(iphone.steps.length >= 3)
  assert.match(iphone.note, /ไม่มีไฟล์ติดตั้งแบบ Android/)
  assert.equal(section(doc, 'share').qr.text, `https://${APP_HOST}/download`)
})
await check('ไม่สัญญาเกินที่ทดสอบ: บัญชีใช้ร่วมกันได้ แต่ล็อกอินซ้ำ "อาจ" ต้องทำ · แจ้งเตือนบน iPhone ยังทดสอบอยู่', () => {
  const account = section(doc, 'account').items.join(' ')
  assert.match(account, /ไม่ต้องสมัครใหม่/)
  assert.match(account, /อาจต้อง.*เข้าสู่ระบบ/)
  assert.match(section(doc, 'iphone').note, /อยู่ระหว่างทดสอบ/)
  assert.doesNotMatch(textOf(doc), /undefined|null|NaN|\[object/)
  assert.doesNotMatch(textOf(doc), /ฟรี|รับประกัน|100%/)
})
await check('ทางเลือกทดลองไม่กระทบหน่วยงานจริง (สาธิต) และลิงก์ภายในพาไปหน้ากลางที่มีอยู่', () => {
  assert.match(section(doc, 'try').paragraphs.join(' '), /เทศบาลตำบลสาธิต/)
  const links = doc.sections.flatMap((s) => s.links ?? [])
  assert.ok(links.length >= 2)
  for (const link of links) {
    assert.ok(link.to === '/' || platformPageFor(link.to), `${link.to} ไม่ใช่หน้ากลาง`)
  }
})
await check('ขนาดไฟล์ที่คนอ่านรู้เรื่อง', () => {
  assert.equal(formatFileSize(1067050), '1.0 MB')
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB')
  assert.equal(formatFileSize(300 * 1024), '300 KB')
  assert.equal(formatFileSize(10), '1 KB')
})

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)
