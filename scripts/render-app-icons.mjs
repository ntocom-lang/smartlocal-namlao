// แปลงไอคอนแอปแบบ maskable จาก SVG เป็น PNG (192/512) — รันเมื่อแก้ public/icons/app-icon-maskable.svg เท่านั้น
// รันด้วย: node scripts/render-app-icons.mjs
//
// ใช้ Chrome ผ่าน Playwright ที่โปรเจกต์มีอยู่แล้ววาดภาพ (ไม่เพิ่ม dependency แปลงรูป — หลักงบ 0 บาท)
// ไฟล์ที่ได้ใช้ใน manifest ของโดเมนกลาง (worker/storeApp.js) และเป็นไอคอนแอป Android (scripts/twa-build.mjs)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url)
const svg = readFileSync(new URL('public/icons/app-icon-maskable.svg', root), 'utf8')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`)
    const out = new URL(`public/icons/maskable-${size}x${size}.png`, root)
    await page.screenshot({ path: fileURLToPath(out), clip: { x: 0, y: 0, width: size, height: size } })
    console.log(`  ✓ ${fileURLToPath(out)}`)
    await page.close()
  }
} finally {
  await browser.close()
}
