// หน้าแรกเจ้าหน้าที่ (/staff แท็บ "แดชบอร์ด") — ต้อง "ไม่โกหก" และใช้งานได้ทั้งมือถือ/PC
//
// ตรวจต่อบัญชี (staff / technician / officer / admin) × จอ (390 มือถือ / 1280 PC):
//   1. ไม่มีเลื่อนแนวนอน และมีหัวหน้าแรก
//   2. สถานะ "งานค้าง" นิ่งแล้วต้องเป็นอย่างใดอย่างหนึ่งพอดี: มีการ์ดงาน / มีป้ายผิดพลาด / "ไม่มีงานค้าง"
//      ห้ามขึ้น "ไม่มีงานค้าง" พร้อมการ์ดงาน (ขัดกันเอง)
//   3. ปุ่มทางลัดทุกปุ่มสูง ≥ 44px และไม่ล้นจอ
//   4. PC: "เครื่องมือทั้งหมด" พับอยู่ตอนเข้า กดแล้วกาง · มือถือ: มีปุ่ม "เมนูทั้งหมด" และไม่มีกล่องพับ
//   5. ส่วน "กองของฉัน" ต้องโผล่เฉพาะหัวหน้ากอง (officer) — บัญชีอื่นห้ามเห็นและห้ามยิง RPC ของกอง
// สถานการณ์เพิ่ม (staff):
//   6. ⚠️ คำร้อง query พัง (500) ต้องขึ้นป้ายเตือนของคำร้อง และห้ามขึ้น "ไม่มีงานค้าง" — กันไฟเขียวปลอม
//   7. ⚠️ สรุปกำหนดเสร็จพัง ต้องขึ้นป้ายเตือน ห้ามขึ้น "ไม่มีงานค้าง"
//   8. มีคำร้องเลยกำหนด/ใกล้ครบ → ขึ้นแถวเตือนพร้อมตัวเลขถูก + กิจกรรมที่มอบหมาย; ห้ามขึ้น "ไม่มีงานค้าง"
//   9. ถือคำร้องอยู่แต่ยังไม่ถึงกำหนด → ขึ้น "ไม่มีงานเร่งด่วน" (ไม่ใช่ "ไม่มีงานค้าง")
//  10. ทางลัด "ใช้บ่อย" เรียงตามที่เปิดจริง
//
// RPC สรุปหน้าแรก 2 ตัวถูก "จำลองคำตอบ" ด้วย route (ไม่ผูกกับว่า migration apply แล้วหรือยัง และไม่ต้องมีข้อมูลจริง)
//   SH_LIVE=1 = ไม่จำลอง ใช้ RPC จริง (ใช้หลัง apply migration แล้ว เพื่อดูว่าคำตอบจริงขึ้นหน้าจอถูก)
// อ่านอย่างเดียว ไม่สร้าง/แก้ข้อมูลในฐานข้อมูล (เขียน localStorage ของ localhost เท่านั้น แล้วล้างทิ้ง)
//   node tests/staff-home-layout.playwright.mjs                          (localhost:5174)
//   SH_TEST_BASE_URL=https://demo.rk-networks.com node tests/staff-home-layout.playwright.mjs

import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = process.env.SH_PROFILE_ROOT || path.join(ROOT_DIR, '.chrome-test-profiles')
const SHOT_DIR = process.env.SH_SHOT_DIR || path.join(os.tmpdir(), 'staff-home-shots')
const DEFAULT_BASE_URL = 'http://localhost:5174'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])
const LIVE = process.env.SH_LIVE === '1'

const PROFILES = process.env.SH_ONLY ? process.env.SH_ONLY.split(',') : ['TEST-staff', 'TEST-technician', 'TEST-officer', 'TEST-admin']
const VIEWPORTS = [{ name: 'มือถือ', width: 390, height: 844 }, { name: 'PC', width: 1280, height: 800 }]
const FREQ_PREFIX = 'sl:staff-freq:v1'

// วันที่ตามเวลาไทย (เหมือนที่ RPC ส่งกลับ) — เครื่องทดสอบอาจตั้งเขตเวลาอื่น
const bangkokDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

// ── คำตอบจำลอง ──
const NEUTRAL_SUMMARY = () => ({ today: bangkokDate(), complaint_due: [], my_events: [] })
const BUSY_SUMMARY = () => ({
  today: bangkokDate(),
  complaint_due: [{ due: bangkokDate(-1), n: 2 }, { due: bangkokDate(0), n: 1 }, { due: bangkokDate(14), n: 3 }],
  my_events: [
    { id: 'e1', title: '[TEST] ประชุมประจำเดือน', date: bangkokDate(0), time: '09:30:00', end_date: null, location: 'ห้องประชุมใหญ่', task: 'attend' },
    { id: 'e2', title: '[TEST] พิธีเปิดงานกีฬา', date: bangkokDate(1), time: null, end_date: null, location: null, task: 'preside' },
  ],
})
const HOLDING_SUMMARY = () => ({ today: bangkokDate(), complaint_due: [{ due: bangkokDate(14), n: 4 }, { due: null, n: 1 }], my_events: [] })
const WORKLOAD = () => ({
  today: bangkokDate(), department_name: 'กองช่าง', unassigned: 3,
  members: [
    { id: 'm1', name: '[TEST] ช่างไฟฟ้า', open: 5, unstarted: 2, overdue: 2 },
    { id: 'm2', name: '[TEST] ช่างประปา', open: 0, unstarted: 0, overdue: 0 },
    { id: 'm3', name: null, open: 1, unstarted: 1, overdue: 0 },
  ],
})

async function mockRpc(page, { summary, workload, summaryStatus = 200 } = {}) {
  if (LIVE) return { calls: { summary: 0, workload: 0 } }
  const calls = { summary: 0, workload: 0 }
  await page.route('**/rest/v1/rpc/staff_home_summary*', route => {
    calls.summary++
    if (summaryStatus !== 200) return route.fulfill({ status: summaryStatus, contentType: 'application/json', body: '{"message":"boom"}' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary ?? NEUTRAL_SUMMARY()) })
  })
  await page.route('**/rest/v1/rpc/staff_dept_workload*', route => {
    calls.workload++
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workload ?? WORKLOAD()) })
  })
  return { calls }
}
async function unmockRpc(page) {
  await page.unroute('**/rest/v1/rpc/staff_home_summary*').catch(() => {})
  await page.unroute('**/rest/v1/rpc/staff_dept_workload*').catch(() => {})
}

function resolveBaseUrl() {
  const raw = (process.env.SH_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
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

async function clearFrequent(page) {
  await safeEvaluate(page, prefix => {
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key)
  }, FREQ_PREFIX)
}

async function openHome(page, baseUrl, auth) {
  // ERR_ABORTED = service worker รุ่นใหม่ activate แล้วสั่งโหลดหน้าซ้ำกลางทาง (autoUpdate) — ลองอีกครั้งเดียว
  try {
    await page.goto(`${baseUrl}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  } catch (error) {
    if (!/ERR_ABORTED/.test(String(error?.message))) throw error
    await page.goto(`${baseUrl}/staff`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  }
  await waitForSettled(page, auth)
  await page.locator('h1', { hasText: 'แดชบอร์ดสำหรับเจ้าหน้าที่' }).first().waitFor({ state: 'visible', timeout: 20_000 })
  // บัญชีทดสอบที่ยังไม่มีเบอร์โทรจะเจอหน้าต่าง "เพิ่มเบอร์มือถือ" ครอบทั้งจอ (ฟีเจอร์เดิม ไม่เกี่ยวกับหน้านี้)
  // มันบังการคลิกทุกอย่างข้างหลัง จึงต้องกด "ข้ามไปก่อน" ก่อน
  await dismissPhonePrompt(page)
}

async function dismissPhonePrompt(page) {
  const skip = page.getByRole('button', { name: 'ข้ามไปก่อน' })
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {})
}

// รอจน "กำลังตรวจงานค้าง" หายไป (ตัวเลขนิ่ง) — ไม่นิ่งภายใน 25 วิ = BLOCKED ไม่ใช่ผ่าน
async function waitForTodoSettled(page) {
  try {
    await page.waitForFunction(() => !document.querySelector('[data-home-loading], [data-home-dept-loading]'), undefined, { timeout: 25_000 })
  } catch {
    throw new BlockedError('สถานะงานค้างไม่นิ่งภายใน 25 วินาที (ยังขึ้น "กำลังตรวจ…")')
  }
  await page.waitForTimeout(500)
  await dismissPhonePrompt(page)
}

async function snapshotHome(page) {
  return page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
    const q = sel => [...document.querySelectorAll(sel)].filter(visible)
    const num = el => Number((el?.textContent ?? '').replace(/\D/g, ''))
    return {
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      workRows: q('[data-home-work]').map(el => ({ key: el.dataset.homeWork, count: num(el.querySelector('[data-home-work-count]')) })),
      errors: q('[data-home-work-error]').map(el => el.dataset.homeWorkError),
      summaryError: q('[data-home-summary-error]').length,
      attention: q('[data-home-attention]').map(el => ({ key: el.dataset.homeAttention, count: num(el.querySelector('span.text-2xl')) })),
      events: q('[data-home-event]').map(el => el.textContent.trim()),
      holding: q('[data-home-holding]').length,
      loading: q('[data-home-loading]').length,
      clear: q('[data-home-clear]').length,
      hasTodoSection: q('[data-home-todo]').length,
      dept: q('[data-home-dept]').length,
      deptError: q('[data-home-dept-error]').length,
      deptSection: q('[data-home-dept-section]').length,
      unassigned: q('[data-home-unassigned]').map(el => el.dataset.homeUnassigned),
      members: q('[data-home-member]').map(el => ({ id: el.dataset.homeMember, text: el.textContent.trim(), overdueRed: Boolean(el.querySelector('.text-red-600')) })),
      tiles: q('[data-home-shortcuts] [data-menu-tile]').map(el => {
        const r = el.getBoundingClientRect()
        return { key: el.dataset.menuTile, h: r.height, right: r.right, left: r.left }
      }),
      createEvent: q('[data-home-create-event]').length,
      allToolsVisible: q('[data-home-all-tools]').length,
      allToolsOpen: document.querySelector('[data-home-all-tools]')?.open ?? null,
      menuButtonVisible: [...document.querySelectorAll('button')].filter(visible).some(b => b.textContent.includes('เมนูทั้งหมด') && b.textContent.includes('เมนูตามสิทธิ์')),
      viewport: window.innerWidth,
    }
  })
}

async function checkBasic(page, label, vp, { expectDept }) {
  await waitForTodoSettled(page)
  const s = await snapshotHome(page)
  assert.ok(s.overflowX <= 1, `${label}: เลื่อนแนวนอนได้ ${s.overflowX}px`)
  if (s.hasTodoSection && !LIVE) {
    const shown = s.workRows.length + s.errors.length + s.attention.length + s.summaryError + s.clear + s.holding
    assert.ok(shown >= 1, `${label}: ส่วน "ต้องทำตอนนี้" ว่างเปล่า`)
    assert.ok(!(s.clear > 0 && (s.workRows.length > 0 || s.errors.length > 0 || s.attention.length > 0 || s.summaryError > 0)),
      `${label}: ขึ้น "ไม่มีงานค้าง" ทั้งที่มีการ์ดงาน/แถวเตือน/ป้ายผิดพลาดอยู่ด้วย`)
    for (const row of s.workRows) assert.ok(row.count > 0, `${label}: การ์ดงาน ${row.key} ขึ้นทั้งที่เลขเป็น 0`)
  }
  assert.equal(s.deptSection > 0, expectDept, expectDept
    ? `${label}: หัวหน้ากองต้องเห็นส่วน "กองของฉัน"` : `${label}: บัญชีที่ไม่ใช่หัวหน้ากองห้ามเห็นส่วน "กองของฉัน"`)
  for (const tile of s.tiles) {
    assert.ok(tile.h >= 44, `${label}: ปุ่มทางลัด ${tile.key} สูง ${Math.round(tile.h)}px < 44px`)
    assert.ok(tile.left >= -1 && tile.right <= s.viewport + 1, `${label}: ปุ่มทางลัด ${tile.key} ล้นจอ`)
  }
  if (vp.width >= 768) {
    assert.equal(s.allToolsVisible, 1, `${label}: PC ไม่เจอกล่อง "เครื่องมือทั้งหมด"`)
    assert.equal(s.allToolsOpen, false, `${label}: "เครื่องมือทั้งหมด" ต้องพับอยู่ตอนเข้า`)
    await page.locator('[data-home-all-tools] summary').click()
    const opened = await page.evaluate(() => ({
      open: document.querySelector('[data-home-all-tools]').open,
      buttons: document.querySelectorAll('[data-home-all-tools] [data-home-tool]').length,
    }))
    assert.equal(opened.open, true, `${label}: กด "เครื่องมือทั้งหมด" แล้วไม่กาง`)
    assert.ok(opened.buttons > 0, `${label}: กางแล้วไม่มีเครื่องมือสักอัน`)
    await page.locator('[data-home-all-tools] summary').click()
  } else {
    assert.equal(s.allToolsVisible, 0, `${label}: มือถือไม่ควรเห็นกล่องพับ "เครื่องมือทั้งหมด"`)
    assert.ok(s.menuButtonVisible, `${label}: มือถือไม่เจอปุ่ม "เมนูทั้งหมด"`)
  }
  return s
}

async function main() {
  const baseUrl = resolveBaseUrl()
  await mkdir(SHOT_DIR, { recursive: true })
  let passed = 0
  let failed = 0
  const report = (ok, text) => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`) }
  // รันสถานการณ์หนึ่ง: BLOCKED ทำให้หยุดทั้งชุด (ไม่นับเป็นผ่าน) · assertion ที่ตก = FAIL แล้วไปต่อ
  const scenario = async (label, run) => {
    try {
      report(true, `${label} — ${await run()}`)
    } catch (error) {
      if (error instanceof BlockedError) throw error
      report(false, `${label} — ${error.message.split('\n')[0]}`)
    }
  }

  for (const name of PROFILES) {
    const profileDir = path.join(PROFILE_ROOT, name)
    try { await access(profileDir) } catch { console.log(`SKIP  ${name} — ไม่พบโปรไฟล์`); continue }
    let context
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome', headless: !process.argv.includes('--headed'), viewport: { width: 1280, height: 800 },
      })
    } catch {
      throw new BlockedError(`เปิด ${name} ไม่สำเร็จ; ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ`)
    }
    const page = context.pages()[0] || await context.newPage()
    const auth = trackProfileResolution(page)
    const isHead = name === 'TEST-officer'
    try {
      await transferDemoSession(page, baseUrl)
      for (const vp of VIEWPORTS) {
        await scenario(`${name} · ${vp.name} ${vp.width}px`, async () => {
          const { calls } = await mockRpc(page)
          try {
            await page.setViewportSize({ width: vp.width, height: vp.height })
            await openHome(page, baseUrl, auth)
            await clearFrequent(page)
            await openHome(page, baseUrl, auth)
            const s = await checkBasic(page, `${name} ${vp.width}`, vp, { expectDept: isHead })
            if (!LIVE) assert.equal(calls.workload > 0, isHead, isHead ? 'หัวหน้ากองต้องยิง RPC ภาระงานของกอง' : 'บัญชีที่ไม่ใช่หัวหน้ากองห้ามยิง RPC ภาระงานของกอง')
            await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${vp.width}.png`), fullPage: true })
            return `การ์ดงาน ${s.workRows.length} · ป้ายเตือน ${s.errors.length} · ไม่มีงานค้าง ${s.clear} · ทางลัด ${s.tiles.length} · กองของฉัน ${s.dept}`
          } finally { await unmockRpc(page) }
        })
      }

      if (isHead && !LIVE) {
        for (const vp of VIEWPORTS) {
          await scenario(`${name} · ภาระงานรายคนของกอง ${vp.width}px`, async () => {
            await mockRpc(page, { summary: BUSY_SUMMARY() })
            try {
              await page.setViewportSize({ width: vp.width, height: vp.height })
              await openHome(page, baseUrl, auth)
              await waitForTodoSettled(page)
              const s = await snapshotHome(page)
              await page.screenshot({ path: path.join(SHOT_DIR, `${name}-dept-${vp.width}.png`), fullPage: true })
              assert.equal(s.dept, 1, 'ไม่เจอการ์ด "กองของฉัน"')
              assert.equal(s.members.length, 3, `ต้องเห็นทุกคนในกอง (เห็น ${s.members.length})`)
              assert.deepEqual(s.members.map(m => m.id), ['m1', 'm2', 'm3'], 'ลำดับต้องคงที่ตามที่ฐานข้อมูลส่งมา (เรียงตามชื่อ ไม่เรียงตามภาระ)')
              assert.ok(s.members[0].overdueRed, 'คนที่มีงานเลยกำหนดต้องเน้นสีแดง')
              assert.ok(!s.members[1].overdueRed, 'คนที่ไม่มีงานเลยกำหนดห้ามเน้นสีแดง')
              assert.match(s.members[1].text, /0/, 'คนที่ว่างงานต้องโผล่เป็น 0')
              assert.match(s.members[2].text, /ไม่ระบุชื่อ/, 'ชื่อว่างต้องมีคำแทน')
              assert.deepEqual(s.unassigned, ['3'], 'ต้องมีปุ่ม "ยังไม่มอบหมาย 3 ใบ"')
              assert.ok(s.overflowX <= 1, `เลื่อนแนวนอนได้ ${s.overflowX}px`)
              return 'เห็นครบ 3 คน เรียงคงที่ เน้นเลยกำหนดเฉพาะคนที่มี'
            } finally { await unmockRpc(page) }
          })
        }
        await scenario(`${name} · ภาระงานของกองโหลดไม่สำเร็จ`, async () => {
          await page.route('**/rest/v1/rpc/staff_dept_workload*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }))
          await page.route('**/rest/v1/rpc/staff_home_summary*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NEUTRAL_SUMMARY()) }))
          try {
            await page.setViewportSize({ width: 1280, height: 800 })
            await openHome(page, baseUrl, auth)
            await waitForTodoSettled(page)
            const s = await snapshotHome(page)
            assert.equal(s.deptError, 1, 'ต้องขึ้นป้ายเตือนว่าโหลดภาระงานของกองไม่สำเร็จ')
            assert.equal(s.members.length, 0, 'ห้ามแสดงรายชื่อ/ตัวเลขเมื่อโหลดไม่สำเร็จ')
            return 'ขึ้นป้ายเตือน ไม่แสดงตัวเลขมั่ว'
          } finally { await unmockRpc(page) }
        })
      }

      if (name === 'TEST-staff' && !LIVE) {
        await scenario(`${name} · คำร้อง query พัง`, async () => {
          await mockRpc(page)
          await page.route('**/rest/v1/complaints*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }))
          try {
            await page.setViewportSize({ width: 1280, height: 800 })
            await openHome(page, baseUrl, auth)
            await waitForTodoSettled(page)
            const s = await snapshotHome(page)
            await page.screenshot({ path: path.join(SHOT_DIR, `${name}-complaints-error.png`), fullPage: true })
            assert.ok(s.errors.includes('complaints'), `ไม่ขึ้นป้ายเตือนของคำร้อง (errors=${JSON.stringify(s.errors)})`)
            assert.equal(s.clear, 0, 'ขึ้น "ไม่มีงานค้าง" ทั้งที่โหลดตัวเลขคำร้องไม่สำเร็จ — ไฟเขียวปลอม')
            return 'ขึ้นป้ายเตือน และไม่ขึ้น "ไม่มีงานค้าง"'
          } finally { await page.unroute('**/rest/v1/complaints*').catch(() => {}); await unmockRpc(page) }
        })

        await scenario(`${name} · สรุปกำหนดเสร็จพัง`, async () => {
          await mockRpc(page, { summaryStatus: 500 })
          try {
            await page.setViewportSize({ width: 1280, height: 800 })
            await openHome(page, baseUrl, auth)
            await waitForTodoSettled(page)
            const s = await snapshotHome(page)
            assert.equal(s.summaryError, 1, 'ไม่ขึ้นป้ายเตือนว่าตรวจกำหนดเสร็จไม่สำเร็จ')
            assert.equal(s.clear, 0, 'ขึ้น "ไม่มีงานค้าง" ทั้งที่ตรวจกำหนดเสร็จไม่สำเร็จ — ไฟเขียวปลอม')
            assert.equal(s.attention.length, 0, 'ห้ามมีแถวเตือนกำหนดเสร็จเมื่อไม่มีข้อมูล')
            return 'ขึ้นป้ายเตือน และไม่ขึ้น "ไม่มีงานค้าง"'
          } finally { await unmockRpc(page) }
        })

        for (const vp of VIEWPORTS) {
          await scenario(`${name} · มีงานเลยกำหนด/ใกล้ครบ + กิจกรรม ${vp.width}px`, async () => {
            await mockRpc(page, { summary: BUSY_SUMMARY() })
            try {
              await page.setViewportSize({ width: vp.width, height: vp.height })
              await openHome(page, baseUrl, auth)
              await waitForTodoSettled(page)
              const s = await snapshotHome(page)
              await page.screenshot({ path: path.join(SHOT_DIR, `${name}-busy-${vp.width}.png`), fullPage: true })
              const by = Object.fromEntries(s.attention.map(a => [a.key, a.count]))
              assert.deepEqual(by, { overdue: 2, soon: 1 }, `แถวเตือนไม่ตรง (ได้ ${JSON.stringify(by)})`)
              assert.deepEqual(s.attention.map(a => a.key), ['overdue', 'soon'], 'เลยกำหนดต้องมาก่อนใกล้ครบ')
              assert.equal(s.clear, 0, 'ขึ้น "ไม่มีงานค้าง" ทั้งที่มีงานเลยกำหนด')
              assert.equal(s.events.length, 2, `กิจกรรมที่มอบหมายต้องขึ้น 2 รายการ (ได้ ${s.events.length})`)
              assert.match(s.events[0], /09:30/, 'กิจกรรมวันนี้ต้องแสดงเวลา')
              assert.match(s.events[0], /ไปประชุมแทน/, 'ต้องแสดงภารกิจเป็นภาษาไทย')
              assert.equal(s.deptSection, 0, 'ไม่ใช่หัวหน้ากอง ห้ามเห็นส่วนกอง')
              assert.ok(s.overflowX <= 1, `เลื่อนแนวนอนได้ ${s.overflowX}px`)
              return 'เลยกำหนด 2 · ใกล้ครบ 1 · กิจกรรม 2 เรียงถูก'
            } finally { await unmockRpc(page) }
          })
        }

        await scenario(`${name} · ถือคำร้องอยู่แต่ยังไม่ถึงกำหนด`, async () => {
          // บังคับให้ไม่มีงานรอรับเลย (badge ทุกตัว = 0) เพื่อให้ผลไม่ขึ้นกับข้อมูลจริงของบัญชีทดสอบ
          // — นับอย่างเดียวด้วย HEAD + content-range: */0 ตามที่ supabase-js อ่านเป็น count
          const zeroCount = route => route.fulfill({ status: 200, headers: { 'content-range': '*/0' }, contentType: 'application/json', body: '' })
          await page.route('**/rest/v1/complaints*', zeroCount)
          await page.route('**/rest/v1/document_requests*', zeroCount)
          await mockRpc(page, { summary: HOLDING_SUMMARY() })
          try {
            await page.setViewportSize({ width: 1280, height: 800 })
            await openHome(page, baseUrl, auth)
            await waitForTodoSettled(page)
            const s = await snapshotHome(page)
            await page.screenshot({ path: path.join(SHOT_DIR, `${name}-holding.png`), fullPage: true })
            assert.equal(s.workRows.length, 0, 'จำลอง badge เป็น 0 แล้วต้องไม่มีการ์ดงานรอรับ')
            assert.equal(s.holding, 1, 'ต้องขึ้น "ไม่มีงานเร่งด่วน" พร้อมจำนวนที่ยังถืออยู่')
            assert.equal(s.clear, 0, 'ห้ามขึ้น "ไม่มีงานค้างตอนนี้" ทั้งที่ยังถือคำร้องอยู่ 5 ใบ')
            return 'ขึ้น "ไม่มีงานเร่งด่วน" ไม่ใช่ "ไม่มีงานค้าง"'
          } finally {
            await page.unroute('**/rest/v1/complaints*').catch(() => {})
            await page.unroute('**/rest/v1/document_requests*').catch(() => {})
            await unmockRpc(page)
          }
        })

        await scenario(`${name} · ทางลัดตามการใช้งาน`, async () => {
          await mockRpc(page)
          try {
            await page.setViewportSize({ width: 1280, height: 800 })
            await openHome(page, baseUrl, auth)
            await clearFrequent(page)
            await openHome(page, baseUrl, auth)
            await page.locator('[data-home-all-tools] summary').click()
            const target = await page.evaluate(() => {
              const keys = [...document.querySelectorAll('[data-home-all-tools] [data-home-tool]')].map(b => b.dataset.homeTool)
              return ['posts', 'infra', 'events'].find(k => keys.includes(k)) ?? null
            })
            if (!target) throw new BlockedError('บัญชีนี้ไม่มีโมดูลทดสอบ (posts/infra/events) ให้เปิด')
            for (let i = 0; i < 2; i++) {
              if (!(await page.locator('[data-home-all-tools]').getAttribute('open') !== null)) await page.locator('[data-home-all-tools] summary').click()
              await page.locator(`[data-home-tool="${target}"]`).click()
              await page.waitForTimeout(800)
              await page.locator('button:visible, a:visible').filter({ hasText: /^แดชบอร์ด$/ }).first().click()
              await page.locator('h1', { hasText: 'แดชบอร์ดสำหรับเจ้าหน้าที่' }).first().waitFor({ state: 'visible', timeout: 15_000 })
            }
            const s = await snapshotHome(page)
            assert.equal(s.tiles[0]?.key, target, `ใบแรกของ "ใช้บ่อย" ควรเป็น ${target} แต่ได้ ${s.tiles.map(t => t.key).join(',')}`)
            return `เปิด ${target} 2 ครั้ง ขึ้นเป็นใบแรก`
          } finally { await unmockRpc(page) }
        })
      }
      await clearFrequent(page)
    } finally {
      await context.close().catch(() => {})
    }
  }

  console.log(`\n${passed} ผ่าน / ${failed} ไม่ผ่าน${LIVE ? ' (โหมด LIVE: ใช้ RPC จริง)' : ''} — ภาพหน้าจอ: ${SHOT_DIR}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.log(`${error instanceof BlockedError ? 'BLOCKED' : 'ERROR'}: ${error.message.split('\n')[0]}`)
  process.exit(2)
})
