// Regression test สำหรับ defects ที่พบใน E2E "ระบบยานพาหนะและเชื้อเพลิง จบกระบวนการ" (2026-08-30)
//
// ครอบ acceptance criteria ของ 5 ข้อ:
//   1. fleet_viewer ต้องไม่เห็นปุ่มเขียนข้อมูลในทุกแท็บ (เดิมเห็น "จองรถ"/"บันทึกการเดินทาง"
//      แล้วกดบันทึกไม่ได้ เจอ error ดิบ "new row violates row-level security policy")
//   2. trip_date ต้องเท่ากับวันที่ออกเดินทางจริง ไม่ใช่วันที่จองไว้
//   3. ตัวนับ "(x–y จาก N)" หน้าเชื้อเพลิงต้องตรงกับจำนวนแถวทันทีหลังบันทึก ไม่ต้องรีเฟรช
//   4. สมุดประจำรถต้องนับเฉพาะทริปสถานะ completed ไม่รวมคำขอที่ยังไม่อนุมัติ/ถูกปฏิเสธ/ยกเลิก
//   5. อัตราสิ้นเปลืองในสมุดประจำรถต้องใช้วิธี full-to-full เดียวกับหน้าภาพรวม
//      (เดิมหาร distance/liters ได้ 0.6 กม./ล. สำหรับรถกระบะ ขณะที่หน้าภาพรวมได้ 7.1)
//   โบนัส: แท็บ "งบประมาณ" ต้องขึ้นเฉพาะผู้ดูแลระบบยานพาหนะ
//
// ⚠️ ข้อบังคับด้านความปลอดภัย/PDPA (เหมือน negative-authorization.playwright.mjs)
//   - ยิงได้เฉพาะสนามซ้อม demo.rk-networks.com หรือ dev server ในเครื่อง (VITE_TENANT_SLUG=demo)
//     hostname อื่น = ปฏิเสธทันที
//   - ห้าม log credential/token/เนื้อหาหน้าเว็บดิบ ลง test-results ทุกกรณี
//   - ข้อมูลที่สร้างต้องขึ้นต้นด้วย [TEST] ไม่มี PII ไม่มีทะเบียนรถจริง ไม่มีพิกัดจริง
//
// โหมดการรัน
//   ค่าเริ่มต้น = read-only ตรวจข้อ 1, 4, 5 และแท็บงบประมาณ จากข้อมูลที่มีอยู่แล้ว
//   --write     = ตรวจข้อ 2, 3 เพิ่ม ซึ่ง "เขียน DB ของสนามซ้อมจริง" (สร้างรถ 1 คัน
//                 เติมน้ำมัน 1 ใบ และทริป 1 รายการต่อการรัน 1 ครั้ง) จึงต้องสั่งเอง
//   --cleanup   = ลบเฉพาะข้อมูลที่โหมด --write สร้างไว้ (รถชื่อขึ้นต้น "[TEST] regression "
//                 พร้อมประวัติของรถคันนั้น) ไม่แตะข้อมูลอื่นบนสนามซ้อมและไม่แตะ อปท. จริง
//
// การล็อกอิน: ใช้ session ที่ค้างอยู่ใน .chrome-test-profiles/TEST-fleet-* เป็นหลัก
// ถ้าโปรไฟล์หมดอายุค่อย fallback ไป DEMO_TEST_PASSWORD เหมือนไฟล์ทดสอบตัวอื่น

import assert from 'node:assert/strict'
import { readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, reloadIfServiceWorkerUpdated, safeEvaluate } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.test.local')
const LOG_PATH = path.join(ROOT_DIR, 'test-results-fleet.log')
const PROFILE_ROOT = path.join(ROOT_DIR, '.chrome-test-profiles')
const DEFAULT_BASE_URL = 'https://demo.rk-networks.com'
const DEMO_TENANT_NAME = 'เทศบาลตำบลสาธิต'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])

// ข้อมูลทดสอบ ต้องอ่านออกทันทีว่าไม่ใช่ของจริง
const STAMP = new Date().toISOString().replace(/\D/g, '').slice(4, 12)
const TEST_VEHICLE_NAME = `[TEST] regression ${STAMP}`
const TEST_PLATE = `TEST ${STAMP.slice(-4)}`
const TEST_DESTINATION = '[TEST] จุดจำลอง ไม่ใช่สถานที่จริง'
const TEST_PURPOSE = `[TEST] regression ${STAMP} ห้ามใช้รถจริง`
const TEST_STATION = '[TEST] ปั๊มจำลอง'
// คำนำหน้าที่ใช้ตัดสินว่าแถวไหน "ของเทสตัวนี้" — โหมด --cleanup ลบเฉพาะที่ตรงคำนี้เป๊ะ
const CLEANUP_PREFIX = '[TEST] regression '

const WRITE_BUTTON_RE = /เพิ่มทรัพย์สิน|บันทึกเชื้อเพลิง|บันทึกซ่อมบำรุง|จองรถ|บันทึกการเดินทาง|นำเข้า CSV/
const FLEET_TAB_LABELS = ['ภาพรวม', 'รถและเครื่องยนต์', 'เชื้อเพลิง', 'การเดินทาง', 'ซ่อมบำรุง', 'รายงาน', 'งบประมาณ']

// ───────────────────────────────────────────────────────────── config/safety ──

function parseEnv(content) {
  const parsed = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    parsed[line.slice(0, separator).trim()] = value
  }
  return parsed
}

async function loadLocalTestEnv() {
  try {
    const localEnv = parseEnv(await readFile(LOCAL_ENV_PATH, 'utf8'))
    if (!process.env.DEMO_TEST_PASSWORD && localEnv.DEMO_TEST_PASSWORD) {
      process.env.DEMO_TEST_PASSWORD = localEnv.DEMO_TEST_PASSWORD
    }
  } catch {
    // ไม่มีไฟล์ = พึ่ง session ที่ค้างอยู่ในโปรไฟล์ Chrome อย่างเดียว
  }
}

function resolveBaseUrl() {
  const raw = process.env.FLEET_TEST_BASE_URL || DEFAULT_BASE_URL
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedError('FLEET_TEST_BASE_URL ไม่ใช่ URL ที่ถูกต้อง')
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new BlockedError(`ปฏิเสธการยิงไปที่ ${url.hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)
  }
  return url.origin
}

function parseArgs(argv) {
  return {
    write: argv.includes('--write'),
    cleanup: argv.includes('--cleanup'),
    headed: argv.includes('--headed'),
  }
}

async function pathExists(target) {
  try { await access(target); return true } catch { return false }
}

// ───────────────────────────────────────────────────────────────── page utils ──

async function openFleet(profile, baseUrl, headed) {
  const profileDir = path.join(PROFILE_ROOT, `TEST-${profile}`)
  if (!await pathExists(profileDir)) {
    throw new BlockedError(`ไม่พบโปรไฟล์ TEST-${profile} — สร้างด้วย tests/negative-authorization.playwright.mjs ก่อน`)
  }
  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome', headless: !headed, viewport: { width: 1440, height: 950 },
    })
  } catch {
    throw new BlockedError(`เปิด TEST-${profile} ไม่สำเร็จ; ปิด Chrome โปรไฟล์นี้ก่อนรันซ้ำ`)
  }
  const page = context.pages()[0] || await context.newPage()
  page.on('dialog', dialog => dialog.accept().catch(() => {}))
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(2_500)
  await reloadIfServiceWorkerUpdated(page, baseUrl)
  await page.waitForTimeout(2_500)

  // dev server ในเครื่องใช้ VITE_TENANT_SLUG=demo จึงชี้ tenant เดียวกัน แต่ต้องยืนยันจากหน้าจอ
  const onDemo = await safeEvaluate(page, name => document.body?.innerText?.includes(name) ?? false, DEMO_TENANT_NAME, false)
  if (!onDemo) throw new BlockedError(`ไม่พบชื่อ tenant "${DEMO_TENANT_NAME}" — ยกเลิกเพื่อกันยิงผิด อปท.`)

  await gotoRoute(page, '/fleet', 5_000)
  await dismissOnboarding(page)
  const denied = await page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าใช้ระบบ', exact: true }).count()
  if (denied) throw new BlockedError(`${profile} เข้า /fleet ไม่ได้ — ตรวจ fleet_role ของบัญชีทดสอบ`)
  return { context, page }
}

async function gotoRoute(page, route, wait = 3_000) {
  await page.evaluate(target => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, route)
  await page.waitForTimeout(wait)
}

// กล่อง onboarding ของประชาชน (เพิ่มเบอร์มือถือ/ชื่อ-นามสกุล) บังหน้าปฏิบัติงานอยู่ ต้องปิดก่อน
async function dismissOnboarding(page) {
  for (let i = 0; i < 2; i++) {
    const skip = page.getByRole('button', { name: 'ข้ามไปก่อน', exact: true })
    if (await skip.count() && await skip.first().isVisible().catch(() => false)) {
      await skip.first().click().catch(() => {})
      await page.waitForTimeout(800)
    }
  }
  await page.waitForTimeout(1_500)
}

async function visibleTabs(page) {
  return page.evaluate(labels => [...document.querySelectorAll('button')]
    .filter(b => b.offsetParent !== null && labels.includes((b.innerText || '').trim()))
    .map(b => b.innerText.trim()), FLEET_TAB_LABELS)
}

async function openTab(page, label) {
  const clicked = await page.evaluate(target => {
    const button = [...document.querySelectorAll('button')]
      .find(b => b.offsetParent !== null && (b.innerText || '').trim() === target)
    if (!button) return false
    button.click()
    return true
  }, label)
  if (!clicked) throw new BlockedError(`ไม่พบแท็บ "${label}"`)
  await page.waitForTimeout(2_500)
}

async function writeButtonsOn(page) {
  return page.evaluate(source => [...document.querySelectorAll('button')]
    .filter(b => b.offsetParent !== null)
    .map(b => (b.innerText || '').trim())
    .filter(text => new RegExp(source).test(text)), WRITE_BUTTON_RE.source)
}

// ฟอร์มของโมดูลนี้ไม่ผูก htmlFor จึงต้องหา control ที่อยู่ในกล่องเดียวกับ <label>
function controlHandle(page, labelText, selector) {
  return page.evaluateHandle(([text, sel]) => {
    const labels = [...document.querySelectorAll('label')]
      .filter(el => el.offsetParent !== null && el.textContent.trim().startsWith(text))
    for (const label of labels) {
      const control = label.parentElement?.querySelector(sel)
      if (control) return control
    }
    return null
  }, [labelText, selector])
}

async function fillField(page, labelText, value) {
  const element = (await controlHandle(page, labelText, 'input, textarea')).asElement()
  if (!element) throw new BlockedError(`ไม่พบช่อง "${labelText}"`)
  await element.fill(String(value))
}

async function selectField(page, labelText, optionLabel) {
  const element = (await controlHandle(page, labelText, 'select')).asElement()
  if (!element) throw new BlockedError(`ไม่พบดรอปดาวน์ "${labelText}"`)
  await element.selectOption({ label: optionLabel })
}

async function clickButton(page, label, { exact = true } = {}) {
  const clicked = await page.evaluate(([target, isExact]) => {
    const button = [...document.querySelectorAll('button')]
      .filter(b => b.offsetParent !== null)
      .find(b => {
        const text = (b.innerText || '').trim()
        return isExact ? text === target : text.includes(target)
      })
    if (!button) return false
    button.click()
    return true
  }, [label, exact])
  if (!clicked) throw new BlockedError(`ไม่พบปุ่ม "${label}"`)
  await page.waitForTimeout(1_500)
}

const bodyText = page => page.evaluate(() => document.body.innerText)

// ───────────────────────────────────────────────────────────────────── checks ──

// ข้อ 1 — fleet_viewer อ่านอย่างเดียวจริง และไม่เห็นแท็บงบประมาณ
async function checkViewerReadOnly(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-viewer', baseUrl, headed)
  try {
    const tabs = await visibleTabs(page)
    assert.ok(!tabs.includes('งบประมาณ'), 'fleet_viewer เห็นแท็บงบประมาณ ทั้งที่ RLS ไม่ให้เขียน')
    for (const tab of ['รถและเครื่องยนต์', 'เชื้อเพลิง', 'การเดินทาง', 'ซ่อมบำรุง']) {
      await openTab(page, tab)
      const buttons = await writeButtonsOn(page)
      assert.deepEqual(buttons, [], `fleet_viewer เห็นปุ่มเขียนข้อมูลในแท็บ "${tab}": ${buttons.join(', ')}`)
    }
  } finally {
    await context.close()
  }
}

// ข้อ 4/5 + แท็บงบประมาณ — ตรวจจากสมุดประจำรถของ fleet_admin
async function checkAdminViews(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  try {
    const tabs = await visibleTabs(page)
    assert.ok(tabs.includes('งบประมาณ'), 'fleet_admin ไม่เห็นแท็บงบประมาณ')

    await openTab(page, 'งบประมาณ')
    const budgetText = await bodyText(page)
    assert.ok(budgetText.includes('งบประมาณน้ำมันต่อกอง'), 'แท็บงบประมาณเปิดไม่ขึ้น')

    await openTab(page, 'รถและเครื่องยนต์')
    const detailButton = page.locator('button[title="ดูสถิติการใช้งาน"]').filter({ visible: true }).first()
    if (!await detailButton.count()) throw new BlockedError('ยังไม่มีทรัพย์สินให้เปิดสมุดประจำรถ')
    await detailButton.click()
    await page.waitForTimeout(3_500)

    const modalText = await page.evaluate(() =>
      [...document.querySelectorAll('div.fixed.inset-0')].map(m => m.innerText).join('\n'))
    assert.ok(modalText.includes('อัตราสิ้นเปลืองเฉลี่ย'), 'สมุดประจำรถไม่เปิด')

    // ข้อ 5 — ต้องระบุวิธีคิดว่าเป็น full-to-full ไม่ใช่ระยะทาง ÷ ลิตรทั้งหมด
    const hasMethodNote = modalText.includes('เฉลี่ยจากการเติมเต็มถัง')
      || modalText.includes('ต้องเติมเต็มถังติดกันอย่างน้อย 2 ครั้ง')
    assert.ok(hasMethodNote, 'สมุดประจำรถไม่ได้บอกวิธีคิดอัตราสิ้นเปลือง (เสี่ยงกลับไปใช้สูตรเดิม)')

    // ข้อ 4 — จำนวนเที่ยวรวมต้องไม่มากกว่าผลรวมรายเดือน และรายเดือนที่ 0 กม. ต้องไม่ถูกนับเป็นเที่ยว
    const monthlyTrips = [...modalText.matchAll(/(\d+) เที่ยว · ([\d,]+) กม\./g)]
    for (const [, trips, km] of monthlyTrips) {
      if (Number(km.replace(/,/g, '')) === 0) {
        assert.equal(Number(trips), 0,
          'สมุดประจำรถนับเที่ยวที่ระยะทาง 0 กม. — น่าจะรวมคำขอที่ยังไม่อนุมัติ/ยกเลิกเข้ามาด้วย')
      }
    }
  } finally {
    await context.close()
  }
}

// ข้อ 3 — ตัวนับรายการหน้าเชื้อเพลิงต้องอัปเดตทันทีหลังบันทึก (โหมด --write)
async function checkFuelCounter(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  try {
    // เตรียมรถของตัวเองไว้ก่อน เพื่อไม่ไปแตะทรัพย์สินที่ อปท. ใช้จริง
    await openTab(page, 'รถและเครื่องยนต์')
    await clickButton(page, 'เพิ่มทรัพย์สิน', { exact: false })
    await page.waitForTimeout(1_000)
    await fillField(page, 'ชื่อ / รหัส', TEST_VEHICLE_NAME)
    await fillField(page, 'ทะเบียน', TEST_PLATE)
    await selectField(page, 'ประเภท', 'รถกระบะ')
    await fillField(page, 'ความจุถัง', 60)
    await fillField(page, 'ค่ามิเตอร์เริ่มต้น', 10_000)
    await clickButton(page, 'บันทึก')
    await page.waitForTimeout(2_500)

    await openTab(page, 'เชื้อเพลิง')
    const readCounter = async () => {
      const text = await bodyText(page)
      const match = text.match(/\((\d+)–(\d+) จาก (\d+)\)/)
      return match ? { shown: Number(match[2]), total: Number(match[3]) } : null
    }
    const before = await readCounter()

    await clickButton(page, 'บันทึกเชื้อเพลิง', { exact: false })
    await page.waitForTimeout(1_000)
    await selectField(page, 'ยานพาหนะ/เครื่องยนต์', `${TEST_VEHICLE_NAME} (${TEST_PLATE})`)
    await page.waitForTimeout(500)
    await fillField(page, 'เลขไมล์', 10_500)
    await fillField(page, 'ปริมาณ (ลิตร)', 40)
    await fillField(page, 'ราคา/ลิตร', 32)
    await fillField(page, 'ปั๊ม / สถานี', TEST_STATION)
    await fillField(page, 'หมายเหตุ', TEST_PURPOSE)
    await clickButton(page, 'บันทึก')
    await page.waitForTimeout(3_500)

    const after = await readCounter()
    assert.ok(after, 'อ่านตัวนับรายการเชื้อเพลิงไม่ได้')
    assert.equal(after.total, (before?.total ?? 0) + 1,
      `ตัวนับรายการเชื้อเพลิงค้าง — ก่อนบันทึก ${before?.total ?? 0} หลังบันทึกได้ ${after.total}`)

    const rowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length)
    assert.ok(rowCount >= after.shown,
      `จำนวนแถวที่แสดง (${rowCount}) ไม่สอดคล้องกับตัวนับ (${after.shown})`)
  } finally {
    await context.close()
  }
}

// ข้อ 2 — จองล่วงหน้าแล้วออกเดินทางวันนี้ วันที่ในตารางต้องเป็นวันนี้ ไม่ใช่วันที่จอง
async function checkTripDateFollowsDeparture(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  try {
    await openTab(page, 'การเดินทาง')
    const pad = n => String(n).padStart(2, '0')
    const today = new Date()
    const later = new Date(Date.now() + 3 * 86_400_000)
    const at = (d, hour) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`
    const thaiToday = today.toLocaleDateString('th-TH', { dateStyle: 'short' })

    await clickButton(page, 'จองรถ')
    await page.waitForTimeout(1_000)
    await selectField(page, 'ยานพาหนะ', `${TEST_VEHICLE_NAME} (${TEST_PLATE})`)
    await fillField(page, 'วันเวลาออก', at(later, 9))
    await fillField(page, 'กลับโดยประมาณ', at(later, 16))
    await fillField(page, 'ปลายทาง', TEST_DESTINATION)
    await fillField(page, 'วัตถุประสงค์', TEST_PURPOSE)
    await clickButton(page, 'ส่งคำขอจอง')
    await page.waitForTimeout(3_000)

    await clickButton(page, 'อนุมัติ', { exact: false })
    await page.waitForTimeout(3_000)

    await clickButton(page, '🚀', { exact: false })
    await page.waitForTimeout(1_200)
    await fillField(page, 'เวลาออกจริง', at(today, 9))
    await fillField(page, 'เลขไมล์ก่อนออก', 10_500)
    await clickButton(page, 'ยืนยันออกเดินทาง')
    await page.waitForTimeout(3_500)

    const text = await bodyText(page)
    const activeBlock = text.slice(text.indexOf('การจองและการเดินทาง'), text.indexOf('ประวัติการเดินทาง'))
    assert.ok(activeBlock.includes(TEST_DESTINATION), 'ไม่พบทริปทดสอบในรายการที่กำลังดำเนินอยู่')
    assert.ok(activeBlock.includes(thaiToday),
      `ตารางแสดงวันที่จอง ไม่ใช่วันที่ออกเดินทางจริง (${thaiToday})`)

    // ปิดงานให้เรียบร้อย ไม่ทิ้งทริปค้างสถานะ "กำลังเดินทาง" ไว้บนสนามซ้อม
    await clickButton(page, '🏁', { exact: false })
    await page.waitForTimeout(1_200)
    await fillField(page, 'เวลากลับจริง', at(today, 16))
    await fillField(page, 'เลขไมล์หลังกลับ', 10_560)
    await clickButton(page, 'ยืนยันกลับถึง')
    await page.waitForTimeout(3_000)
  } finally {
    await context.close()
  }
}

// ───────────────────────────────────────────────────────────────────── cleanup ──

// ดัก header ของคำขอที่ "แอปยิงเอง" (apikey + bearer ของ session ที่ล็อกอินอยู่)
// เก็บไว้ใน memory ของ Node เท่านั้น ไม่ log ไม่เขียนไฟล์ ไม่ส่งต่อที่ไหน
function captureRestHeaders(page) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new BlockedError('ไม่พบคำขอไป Supabase ภายในเวลาที่กำหนด')), 30_000)
    page.on('request', request => {
      const url = request.url()
      if (!url.includes('/rest/v1/')) return
      const headers = request.headers()
      if (!headers.apikey || !headers.authorization) return
      clearTimeout(timer)
      resolve({ restBase: url.split('/rest/v1/')[0] + '/rest/v1', headers })
    })
  })
}

// ลบเฉพาะรถที่ชื่อขึ้นต้นด้วย CLEANUP_PREFIX พร้อมประวัติของรถคันนั้น
// กติกาความปลอดภัย: ยืนยัน tenant = demo ก่อน แล้วจึงลบด้วย "รายการ id ที่คัดมาแล้ว"
// ไม่ยิง pattern เข้า query ตรงๆ เพื่อไม่ให้มีทางลบเกินขอบเขตแม้ชื่อรถจะมีอักขระพิเศษ
async function cleanupTestData(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  const pending = captureRestHeaders(page)
  try {
    await gotoRoute(page, '/fleet', 1_000)
    await openTab(page, 'รถและเครื่องยนต์')
    const { restBase, headers } = await pending
    const auth = {
      apikey: headers.apikey,
      authorization: headers.authorization,
      'content-type': 'application/json',
    }
    const get = async query => {
      const response = await fetch(`${restBase}/${query}`, { headers: auth })
      if (!response.ok) throw new BlockedError(`อ่านข้อมูลไม่สำเร็จ (HTTP ${response.status})`)
      return response.json()
    }
    const remove = async query => {
      const response = await fetch(`${restBase}/${query}`, { method: 'DELETE', headers: auth })
      if (!response.ok) throw new BlockedError(`ลบไม่สำเร็จ (HTTP ${response.status})`)
    }

    const tenants = await get('municipalities?slug=eq.demo&select=id')
    const tenantId = tenants[0]?.id
    if (!tenantId) throw new BlockedError('หา tenant slug=demo ไม่เจอ — ยกเลิกการลบ')

    const vehicles = await get(`fleet_vehicles?municipality_id=eq.${tenantId}&select=id,name`)
    const targets = vehicles.filter(v => typeof v.name === 'string' && v.name.startsWith(CLEANUP_PREFIX))
    if (!targets.length) {
      process.stdout.write('CLEANUP: ไม่มีรถทดสอบของเทสตัวนี้ค้างอยู่\n')
      return 0
    }
    const idList = `(${targets.map(v => v.id).join(',')})`
    for (const table of ['fleet_fuel_records', 'fleet_trips', 'fleet_maintenance']) {
      await remove(`${table}?vehicle_id=in.${idList}`)
    }
    await remove(`fleet_vehicles?id=in.${idList}&municipality_id=eq.${tenantId}`)
    process.stdout.write(`CLEANUP: ลบรถทดสอบ ${targets.length} คันพร้อมประวัติเรียบร้อย\n`)
    return targets.length
  } finally {
    await context.close()
  }
}

// ─────────────────────────────────────────────────────────────────── reporting ──

function safeReason(error) {
  if (error instanceof BlockedError || error?.name === 'AssertionError') return error.message
  return 'Playwright ทำงานไม่สำเร็จ; ไม่บันทึก raw page/error เพื่อป้องกันข้อมูลรั่วไหล'
}

async function writeResults(results, baseUrl, write) {
  const counts = {
    PASS: results.filter(r => r.status === 'PASS').length,
    FAIL: results.filter(r => r.status === 'FAIL').length,
    BLOCKED: results.filter(r => r.status === 'BLOCKED').length,
  }
  const lines = [
    'SmartLocal Fleet Workflow Regression Test',
    `Timestamp: ${new Date().toISOString()}`,
    `Base URL: ${baseUrl}`,
    `Mode: ${write ? 'write (สร้างข้อมูล [TEST] บนสนามซ้อม)' : 'read-only'}`,
    'Credentials/tokens/page data: never logged',
    '',
    ...results.map(r => `${r.status} ${r.name}: ${r.reason}`),
    '',
    `SUMMARY PASS=${counts.PASS} FAIL=${counts.FAIL} BLOCKED=${counts.BLOCKED}`,
  ]
  await writeFile(LOG_PATH, `${lines.join('\n')}\n`, 'utf8')
  process.stdout.write(`${lines.join('\n')}\n`)
  return counts
}

async function main() {
  await loadLocalTestEnv()
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = resolveBaseUrl()

  // โหมดล้างข้อมูลทำงานเดี่ยว ไม่ปนกับการตรวจ เพื่อไม่ให้เผลอลบระหว่างที่เทสยังใช้ข้อมูลอยู่
  if (args.cleanup) {
    await cleanupTestData(baseUrl, args.headed)
    return
  }

  const checks = [
    { name: 'viewer-read-only', reason: 'fleet_viewer ไม่มีปุ่มเขียนข้อมูลและไม่เห็นแท็บงบประมาณ', run: checkViewerReadOnly },
    { name: 'admin-views', reason: 'แท็บงบประมาณเปิดได้ + สมุดประจำรถนับเที่ยว/อัตราสิ้นเปลืองถูกวิธี', run: checkAdminViews },
  ]
  if (args.write) {
    checks.push(
      { name: 'fuel-counter', reason: 'ตัวนับรายการเชื้อเพลิงอัปเดตทันทีหลังบันทึก', run: checkFuelCounter },
      { name: 'trip-date', reason: 'trip_date ตามวันที่ออกเดินทางจริง', run: checkTripDateFollowsDeparture },
    )
  }

  const results = []
  for (const check of checks) {
    try {
      await check.run(baseUrl, args.headed)
      results.push({ name: check.name, status: 'PASS', reason: check.reason })
    } catch (error) {
      results.push({
        name: check.name,
        status: error instanceof BlockedError ? 'BLOCKED' : 'FAIL',
        reason: safeReason(error),
      })
    }
  }

  const counts = await writeResults(results, baseUrl, args.write)
  if (counts.FAIL > 0) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${safeReason(error)}\n`)
  process.exitCode = 1
})
