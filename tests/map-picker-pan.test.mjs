// แผนที่ปักหมุด (LeafletMapPicker) ต้องไม่ดึงกล้องกลับเองหลังผู้ใช้ลาก + ปุ่มยืนยันต้องได้จุดใต้หมุดเป๊ะ
// รันด้วย: node tests/map-picker-pan.test.mjs
//
// ที่มา (เจ้าของระบบแจ้ง 2569-10-14 "เลื่อนแล้วเด้งคืน สะดุด"): เดิมชื่อที่อยู่จาก Nominatim (ตอบช้า 0.5–2 วิ)
// ถูกเก็บเป็น "ตำแหน่งที่เลือก" แล้วส่งกลับเป็น center ของแผนที่ → LeafletMapCanvas สั่ง panTo ไปจุดของ
// คำตอบนั้น ถ้าผู้ใช้ปัดต่อระหว่างรอ แผนที่จะเด้งกลับไปจุดที่ปัดผ่านมาแล้ว และปุ่มยืนยันได้พิกัดที่ตามหลังหมุด
//
// เทสต์นี้รันตัวปักหมุดตัวจริงบน Vite แยก (จำลองแค่ TenantContext) ไม่ต่อเน็ต: Nominatim ตอบช้าแบบตั้งใจ 1.5 วิ
// tile ภาพถูกตัดทิ้ง (แผนที่ทำงานได้โดยไม่มีภาพ) — ไม่แตะ DB ไม่ต้องล็อกอิน
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { chromium } from 'playwright'

const GEOCODE_DELAY_MS = 1500
const START = { lat: 17.63, lng: 100.098 }

const plugin = {
  name: 'isolated-map-picker',
  enforce: 'pre',
  resolveId(id) { if (id === '/__map_entry.js') return '\0map-entry.js' },
  load(id) {
    const normalized = id.replaceAll('\\', '/')
    if (normalized.endsWith('/contexts/TenantContext.jsx')) {
      return `export const useTenant=()=>({tenant:{latitude:${START.lat},longitude:${START.lng}}})`
    }
    if (id === '\0map-entry.js') {
      return `import React from 'react';import {createRoot} from 'react-dom/client';import L from 'leaflet';
import Picker from '/src/components/common/LeafletMapPicker.jsx';import '/src/index.css';
L.Map.addInitHook(function(){window.__map=this;window.__moves=0;this.on('movestart',()=>{window.__moves++})});
createRoot(document.getElementById('root')).render(React.createElement(Picker,{initialPos:${JSON.stringify(START)},onConfirm:(p)=>{window.__confirmed=p},onClose:()=>{}}))`
    }
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== '/__map') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__map_entry.js"></script></body></html>'))
    })
  },
}

const server = await createServer({ configFile: false, plugins: [plugin, react(), tailwind()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  page.on('pageerror', (e) => errors.push(e.message))
  let geocodeCalls = 0
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'nominatim.openstreetmap.org' && url.pathname === '/reverse') {
      geocodeCalls++
      await new Promise((resolve) => setTimeout(resolve, GEOCODE_DELAY_MS))
      const lat = Number(url.searchParams.get('lat'))
      // ร้องขอถูกยกเลิกระหว่างรอ (AbortController) = ตอบไม่ได้แล้ว ไม่ใช่ความผิดพลาด
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ display_name: `ทดสอบ ${lat.toFixed(5)}` }) }).catch(() => {})
    }
    return route.abort()
  })

  await page.goto(`${base}/__map`)
  await page.waitForFunction(() => window.__map, null, { timeout: 30_000 })
  // ให้คำถามชื่อที่อยู่ของจุดเริ่มต้นตอบกลับก่อน จะได้วัดเฉพาะผลของการลาก
  await page.waitForTimeout(GEOCODE_DELAY_MS + 900)

  const box = await page.locator('.leaflet-container').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const center = () => page.evaluate(() => { const c = window.__map.getCenter(); return { lat: c.lat, lng: c.lng } })
  async function drag(dx) {
    const before = await page.evaluate(() => window.__moves)
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + dx, cy, { steps: 10 })
    await page.mouse.up()
    await page.waitForFunction((n) => window.__moves > n, before)
    await page.waitForTimeout(400) // ให้ inertia จบและ moveend ยิงก่อน
  }

  // ลากครั้งแรก รอให้คำถามชื่อที่อยู่ของจุดนั้นออกไปแล้ว (ค้างอยู่ระหว่างรอคำตอบ) แล้วลากต่อ = จังหวะที่เคยเด้ง
  await drag(-160)
  await page.waitForTimeout(500)
  await drag(-160)
  const settled = await center()
  const movesAfterDrag = await page.evaluate(() => window.__moves)
  await page.waitForTimeout(GEOCODE_DELAY_MS * 2 + 500)

  const after = await center()
  const programmaticMoves = (await page.evaluate(() => window.__moves)) - movesAfterDrag
  assert.equal(programmaticMoves, 0, `แผนที่ขยับเองหลังผู้ใช้หยุดลาก ${programmaticMoves} ครั้ง (เด้งกลับ)`)
  assert.ok(Math.hypot(after.lat - settled.lat, after.lng - settled.lng) < 1e-9, 'กล้องต้องค้างอยู่ที่จุดที่ผู้ใช้ลากไป')

  // ชื่อที่อยู่ใต้แผนที่ต้องเป็นของจุดสุดท้าย ไม่ใช่จุดที่ลากผ่าน
  await page.getByText(`ทดสอบ ${settled.lat.toFixed(5)}`).waitFor({ timeout: GEOCODE_DELAY_MS * 2 })

  // ยืนยันทันทีหลังลากอีกรอบ (ก่อนชื่อที่อยู่ตอบ) — พิกัดต้องเป็นจุดใต้หมุด ไม่ใช่จุดเดิม
  await drag(120)
  const underPin = await center()
  await page.getByRole('button', { name: /ยืนยันตำแหน่ง/ }).click()
  const confirmed = await page.evaluate(() => window.__confirmed)
  assert.ok(confirmed, 'กดยืนยันแล้วต้องได้ตำแหน่ง')
  assert.ok(Math.hypot(confirmed.lat - underPin.lat, confirmed.lng - underPin.lng) < 1e-9,
    `ยืนยันได้พิกัดที่ไม่ตรงหมุด (${confirmed.lat}, ${confirmed.lng}) ≠ (${underPin.lat}, ${underPin.lng})`)

  assert.deepEqual(errors, [], 'หน้าเว็บมี error')
  console.log(`✓ map-picker-pan: ลากต่อเนื่องไม่เด้งกลับ · ยืนยันได้จุดใต้หมุด · ถามชื่อที่อยู่ ${geocodeCalls} ครั้ง`)
} finally {
  await browser.close()
  await server.close()
}
