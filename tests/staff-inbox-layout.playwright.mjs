// กล่องงานเจ้าหน้าที่ (คำขอบริการ/เอกสาร) — ปุ่มดำเนินการต้องมองเห็นได้โดยไม่ต้องเลื่อนแนวนอน
//
// ทำไมต้องมี: #134 ถอด sticky ออกจากคอลัมน์ "ดำเนินการ" แล้วไม่มีเทสต์ไหนจับได้ วัดบน production
// 2569-09-11 พบว่าตารางกว้าง 1106px แต่พื้นที่เนื้อหามีให้แค่ 1022px (จอ 1366/1440) และ 990px
// (จอ 1280) ปุ่ม "ตรวจสอบคำขอ" ถูกตัดครึ่งและปุ่มลบหายทุกขนาดจอที่เจ้าหน้าที่ใช้จริง
// ทั้งที่คอมเมนต์เดิมเคยบันทึกปัญหานี้ไว้แล้ว — คอมเมนต์หายไปพร้อมโค้ด จึงต้องมีเทสต์แทน
//
// ⚠️ ข้อนี้ไม่ได้ตรวจว่า "ตารางพอดีจอ" (พอดีไม่ได้แน่นอน ความกว้างขึ้นกับชื่อคน) แต่ตรวจว่า
// ปุ่มหลักของทุกแถวอยู่ในกรอบที่มองเห็นได้ ซึ่งเป็นสิ่งที่เจ้าหน้าที่ต้องการจริง
//
// อ่านอย่างเดียว ไม่สร้าง/แก้ข้อมูล · ยิงได้เฉพาะ dev server ในเครื่องหรือสนามซ้อม
//   node tests/staff-inbox-layout.playwright.mjs                       (localhost:5174)
//   SI_TEST_BASE_URL=https://demo.rk-networks.com node tests/staff-inbox-layout.playwright.mjs

import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.SI_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const SHOT_DIR = process.env.SI_SHOT_DIR || path.join(ROOT_DIR, 'test-results-staff-inbox')
const DEFAULT_BASE_URL = 'http://localhost:5174'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])

// ความกว้างจอที่เจ้าหน้าที่ อปท. ใช้จริง — 1366 คือจอโน้ตบุ๊กราชการส่วนใหญ่
const WIDTHS = [1280, 1366, 1440]

function resolveBaseUrl() {
  const raw = (process.env.SI_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const url = new URL(raw)
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new BlockedError(`ปฏิเสธการยิงไปที่ ${url.hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)
  }
  return url.origin
}

// localStorage แยกตาม origin — ย้าย session ของสนามซ้อมมาใส่ localhost ก่อน goto ครั้งแรก
async function transferDemoSession(page, baseUrl) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) return
  await page.goto(SESSION_SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)
  const entries = await safeEvaluate(page, () => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('sb-') || key === 'sl-auth-remember'), undefined, [])
  if (!entries.find(([key]) => key.endsWith('-auth-token'))) {
    throw new BlockedError('โปรไฟล์นี้ไม่มี session ค้างบนสนามซ้อม — เปิด Chrome โปรไฟล์นี้ล็อกอินใหม่ก่อน')
  }
  await page.addInitScript(pairs => {
    for (const [key, value] of pairs) {
      try { localStorage.setItem(key, value) } catch { /* โควตาเต็ม/โหมดส่วนตัว */ }
    }
  }, entries)
}

async function main() {
  const baseUrl = resolveBaseUrl()
  await mkdir(SHOT_DIR, { recursive: true })
  const profileDir = path.join(PROFILE_ROOT, 'TEST-admin')
  try { await access(profileDir) } catch { throw new BlockedError('ไม่พบโปรไฟล์ TEST-admin') }

  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome', headless: !process.argv.includes('--headed'), viewport: { width: 1366, height: 768 },
    })
  } catch {
    throw new BlockedError('เปิด TEST-admin ไม่สำเร็จ; ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ')
  }
  const page = context.pages()[0] || await context.newPage()
  const auth = trackProfileResolution(page)
  let failed = 0

  try {
    await transferDemoSession(page, baseUrl)
    for (const width of WIDTHS) {
      try {
        await page.setViewportSize({ width, height: 768 })
        await page.goto(`${baseUrl}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await waitForSettled(page, auth)
        // /staff เปิดที่แดชบอร์ดรวม ต้องเข้าเมนู "คำขอบริการ/เอกสาร" ก่อนถึงจะเจอกล่องงาน
        await page.locator('text=คำขอบริการ/เอกสาร').locator('visible=true').first().click({ timeout: 20_000 })
        await page.waitForTimeout(4_000)

        const rows = await page.evaluate(() => {
          const table = [...document.querySelectorAll('table')].find(t => t.innerText.includes('ดำเนินการ'))
          if (!table) return null
          const frame = table.parentElement.getBoundingClientRect()
          const right = Math.min(frame.right, window.innerWidth)
          return [...table.querySelectorAll('tbody tr')].slice(0, 10).map(tr => {
            const buttons = [...tr.querySelectorAll('td:last-child button')]
            return buttons.map(b => ({ text: b.textContent.trim() || '(ไอคอน)', right: b.getBoundingClientRect().right, frameRight: right }))
          })
        })
        assert.ok(rows, 'ไม่เจอตารางกล่องงาน')
        assert.ok(rows.length > 0, 'ตารางกล่องงานไม่มีแถวให้ตรวจ')
        const clipped = rows.flat().filter(b => b.right > b.frameRight + 1)
        await page.screenshot({ path: path.join(SHOT_DIR, `inbox-${width}.png`) })
        assert.deepEqual(clipped.map(b => b.text), [],
          `ปุ่มถูกตัดนอกกรอบ ${clipped.length} ปุ่ม (ขอบขวาปุ่ม ${Math.round(clipped[0]?.right)}px `
          + `เกินกรอบ ${Math.round(clipped[0]?.frameRight)}px) — ตรวจว่าคอลัมน์ "ดำเนินการ" ยังเป็น sticky right-0`)
        console.log(`PASS  จอ ${width}px — ปุ่มดำเนินการ ${rows.flat().length} ปุ่มใน ${rows.length} แถว มองเห็นครบ`)
      } catch (error) {
        failed += 1
        console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'FAIL'}  จอ ${width}px — ${error.message.split('\n')[0]}`)
      }
    }
  } finally {
    await context.close().catch(() => {})
  }

  console.log(`\n${WIDTHS.length - failed}/${WIDTHS.length} ผ่าน — ภาพหน้าจอ: ${SHOT_DIR}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${error.message.split('\n')[0]}`)
  process.exit(2)
})
