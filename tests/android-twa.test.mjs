// เทสต์แอป Android (TWA) ฝั่งเว็บ — รันด้วย: node tests/android-twa.test.mjs
//
// ทำไมต้องมี: แอป TWA จะแสดงเต็มจอได้ก็ต่อเมื่อทุกโดเมนที่แอปเปิดตอบ /.well-known/assetlinks.json ที่ชื่อ package
// และลายนิ้วมือใบรับรองตรงกับแอปเป๊ะ ผิดตัวเดียว = แถบที่อยู่เว็บโผล่ทุกหน้าโดยไม่มี error ให้เห็นที่ไหนเลย
// และไฟล์นี้ต้องตอบจาก Worker ก่อนด่าน "ไฟล์ .json ที่ไม่มีจริง = 404" (isFileRequest)
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import worker from '../worker/index.js'
import {
  ANDROID_CERT_FINGERPRINTS, ANDROID_PACKAGE_ID, ASSET_LINKS_PATH, PLATFORM_APP_NAME, PLATFORM_ICONS, PLATFORM_THEME_COLOR,
  assetLinks, buildPlatformManifest, isPlatformHostname,
} from '../worker/storeApp.js'
import { PLATFORM_APP_NAME as CLIENT_APP_NAME } from '../src/lib/platform.js'
import { APP_VERSION, TWA_HOST, buildTwaManifest, trustedOrigins } from '../scripts/twa-build.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
let passed = 0
async function check(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`) }

// ขนาดจริงของ PNG จาก IHDR
function pngSize(publicPath) {
  const buf = readFileSync(new URL(`public${publicPath}`, root))
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', publicPath)
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`
}

// Worker ต้องตอบเองโดยไม่ยิงเครือข่าย (ถ้าแตะ Supabase แปลว่าไหลไปผิดทาง)
async function callWorker(url) {
  const realFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error(`ห้ามยิงเครือข่าย: ${url}`) }
  try {
    return await worker.fetch(new Request(url), {}, { waitUntil() {} })
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('ไฟล์ยืนยันแอป (assetlinks.json)')
await check('ชื่อ package ถูกรูปแบบ Android และลายนิ้วมือเป็น SHA-256 ตัวใหญ่คั่นด้วย :', () => {
  assert.match(ANDROID_PACKAGE_ID, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
  assert.ok(ANDROID_CERT_FINGERPRINTS.length >= 1)
  for (const fp of ANDROID_CERT_FINGERPRINTS) assert.match(fp, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, fp)
  assert.deepEqual(assetLinks(), [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: ANDROID_PACKAGE_ID, sha256_cert_fingerprints: [...ANDROID_CERT_FINGERPRINTS] },
  }])
})
await check('ทุกโดเมนที่แอปเปิด (โดเมนกลาง + อปท. + www) ตอบไฟล์เดียวกันจาก Worker ไม่ตกด่าน 404 ของไฟล์ .json', async () => {
  for (const host of ['app.rk-networks.com', 'namlao.rk-networks.com', 'demo.rk-networks.com', 'www.rk-networks.com']) {
    const res = await callWorker(`https://${host}${ASSET_LINKS_PATH}`)
    assert.equal(res.status, 200, host)
    assert.match(res.headers.get('content-type'), /^application\/json/, host)
    assert.deepEqual(await res.json(), assetLinks(), host)
  }
  // ไฟล์ .json อื่นที่ไม่มีจริงยังเป็น 404 เหมือนเดิม
  assert.equal((await callWorker('https://app.rk-networks.com/.well-known/other.json')).status, 404)
})

console.log('ข้อมูลแอปของโดเมนกลาง (manifest)')
await check('app.* ได้ manifest ของแอปกลางโดยไม่แตะฐานข้อมูล · www ยัง 404 เหมือนเดิม', async () => {
  const res = await callWorker('https://app.rk-networks.com/manifest.webmanifest')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^application\/manifest\+json/)
  assert.deepEqual(await res.json(), buildPlatformManifest())
  assert.equal((await callWorker('https://www.rk-networks.com/manifest.webmanifest')).status, 404)
  assert.equal(isPlatformHostname('app.rk-networks.com'), true)
  assert.equal(isPlatformHostname('namlao.rk-networks.com'), false)
})
await check('ชื่อแอปตรงกับฝั่งหน้าเว็บ · start_url/scope ที่ราก · ไอคอนทุกไฟล์มีจริงและขนาดตรงที่ประกาศ', () => {
  const manifest = buildPlatformManifest()
  assert.equal(PLATFORM_APP_NAME, CLIENT_APP_NAME)
  assert.equal(manifest.name, CLIENT_APP_NAME)
  assert.equal(manifest.id, '/')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  for (const icon of PLATFORM_ICONS) assert.equal(pngSize(icon.src), icon.sizes, icon.src)
  for (const size of ['192x192', '512x512']) {
    assert.ok(PLATFORM_ICONS.some((i) => i.purpose === 'maskable' && i.sizes === size), `maskable ${size}`)
    assert.ok(PLATFORM_ICONS.some((i) => i.purpose === 'any' && i.sizes === size), `any ${size}`)
  }
})
await check('ไอคอน maskable: พื้นเต็มกรอบไม่มีมุมโค้ง สีเดียวกับธีม ภาพย่อให้อยู่ในวงที่ Android ไม่ขลิบ', () => {
  const svg = read('public/icons/app-icon-maskable.svg')
  assert.match(svg, /<rect width="512" height="512" fill="([^"]+)"\/>/)
  assert.equal(svg.match(/<rect width="512" height="512" fill="([^"]+)"\/>/)[1], PLATFORM_THEME_COLOR)
  const scale = Number(svg.match(/scale\(([\d.]+)\)/)[1])
  // จุดไกลสุดของภาพอาคาร (มุมฐาน) ห่างจุดกลางภาพ 237px — คูณสเกลแล้วต้องไม่เกินรัศมีวงปลอดภัย 40% = 204.8px
  assert.ok(Math.hypot(160, 175) * scale <= 204.8, `scale ${scale}`)
  assert.match(read('public/icons/app-icon.svg'), new RegExp(`fill="${PLATFORM_THEME_COLOR}"`), 'ไอคอนแบบ any ใช้สีเดียวกัน')
})

console.log('ค่าที่ใช้สร้างแอป (scripts/twa-build.mjs)')
const tenants = [{ slug: 'namlao' }, { slug: 'demo' }, { slug: 'thungkaew' }, { slug: 'namlao' }, { slug: 'app' }, { slug: 'www' }, { slug: 'Bad Slug' }, { slug: null }, {}]
const twa = buildTwaManifest({ tenants, keystorePath: 'X:\\keys\\test.jks' })
await check('โดเมน อปท. ที่เปิดเต็มจอมาจากรายชื่อในฐาน: รวมสาธิต ตัดโดเมนกลาง/ค่าผิดรูป/ซ้ำ เรียงแน่นอน', () => {
  assert.deepEqual(twa.additionalTrustedOrigins, ['demo.rk-networks.com', 'namlao.rk-networks.com', 'thungkaew.rk-networks.com'])
  assert.deepEqual(trustedOrigins(undefined), [])
})
await check('แอปเปิดโดเมนกลาง ใช้ package/ชื่อ/สีเดียวกับที่เว็บประกาศ เปิดแจ้งเตือน และเซ็นด้วยกุญแจ upload', () => {
  assert.equal(twa.packageId, ANDROID_PACKAGE_ID)
  assert.equal(twa.host, TWA_HOST)
  assert.ok(isPlatformHostname(TWA_HOST))
  assert.equal(twa.name, PLATFORM_APP_NAME)
  assert.equal(twa.themeColor, PLATFORM_THEME_COLOR)
  assert.equal(twa.startUrl, '/')
  assert.equal(twa.enableNotifications, true)
  assert.ok(twa.minSdkVersion >= 24, 'androidbrowserhelper ต้องการ minSdk 24 — ต่ำกว่านี้ build ล้ม')
  assert.deepEqual(twa.signingKey, { path: 'X:\\keys\\test.jks', alias: 'upload' })
  assert.ok(Number.isInteger(APP_VERSION.code) && APP_VERSION.code >= 1)
  assert.equal(twa.appVersionCode, APP_VERSION.code)
  assert.equal(twa.webManifestUrl, `https://${TWA_HOST}/manifest.webmanifest`)
  for (const key of ['iconUrl', 'maskableIconUrl']) {
    const url = new URL(twa[key])
    assert.equal(url.host, TWA_HOST, key)
    assert.ok(existsSync(new URL(`public${url.pathname}`, root)), `${key} ต้องเป็นไฟล์ที่ deploy ขึ้นเว็บจริง`)
    assert.equal(pngSize(url.pathname), '512x512', key)
  }
  assert.ok(PLATFORM_ICONS.some((i) => twa.maskableIconUrl.endsWith(i.src) && i.purpose === 'maskable'))
})
await check('กุญแจและรหัสผ่านไม่อยู่ใน repo: สคริปต์รับรหัสจาก env เท่านั้น และ .gitignore กันไฟล์กุญแจ', () => {
  const script = read('scripts/twa-build.mjs')
  assert.match(script, /process\.env\.TWA_KEYSTORE_PASSWORD/)
  // ค่าที่ขึ้นต้นด้วย < คือตัวอย่างในคอมเมนต์ ('<รหัสในไฟล์ ...>') ไม่ใช่รหัสจริง
  assert.doesNotMatch(script, /PASSWORD\s*[:=]\s*['"](?!<)[^'"]{6,}['"]/)
  const ignore = read('.gitignore')
  for (const pattern of ['*.jks', '*.keystore']) assert.ok(ignore.split(/\r?\n/).includes(pattern), pattern)
})

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)
