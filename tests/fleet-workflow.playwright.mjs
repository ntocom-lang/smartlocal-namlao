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
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const DEMO_TENANT_NAME = 'เทศบาลตำบลสาธิต'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])

// ข้อมูลทดสอบ ต้องอ่านออกทันทีว่าไม่ใช่ของจริง
const STAMP = new Date().toISOString().replace(/\D/g, '').slice(4, 12)
const TEST_VEHICLE_NAME = `[TEST] regression ${STAMP}`
const TEST_PLATE = `TEST ${STAMP.slice(-4)}`
const TEST_DESTINATION = '[TEST] จุดจำลอง ไม่ใช่สถานที่จริง'
const TEST_PURPOSE = `[TEST] regression ${STAMP} ห้ามใช้รถจริง`
const TEST_STATION = '[TEST] ปั๊มจำลอง'
const TEST_LOCALITY = '[TEST] อำเภอจำลอง'
const TEST_PROVINCE = '[TEST] จังหวัดจำลอง'
const TEST_POSITION = '[TEST] ตำแหน่งจำลอง'
const TEST_BACKDATED_REASON = '[TEST] เหตุจำลอง ใช้รถฉุกเฉินนอกเวลาราชการ ยังไม่ได้ยื่นคำขอล่วงหน้า'
const PRINT_DIR = process.env.FLEET_TEST_PRINT_DIR || path.join(ROOT_DIR, 'tmp')
// คำนำหน้าที่ใช้ตัดสินว่าแถวไหน "ของเทสตัวนี้" — โหมด --cleanup ลบเฉพาะที่ตรงคำนี้เป๊ะ
const CLEANUP_PREFIX = '[TEST] regression '

// ปุ่มเขียนข้อมูลถูกเปลี่ยนชื่อตอนทำใบขออนุญาตใช้รถ (แบบ 3): "จองรถ" → "ขออนุญาตใช้รถ",
// "บันทึกการเดินทาง" → "บันทึกการใช้รถย้อนหลัง" ถ้าไม่ตามชื่อใหม่ ข้อ 1 จะกลายเป็น false PASS
const WRITE_BUTTON_RE = /เพิ่มทรัพย์สิน|บันทึกเชื้อเพลิง|บันทึกซ่อมบำรุง|ขออนุญาตใช้รถ|บันทึกการใช้รถย้อนหลัง|บันทึกย้อนหลัง|นำเข้า CSV/
const FLEET_TAB_LABELS = ['ภาพรวม', 'รถและเครื่องยนต์', 'เชื้อเพลิง', 'การใช้รถ', 'ซ่อมบำรุง', 'รายงาน', 'งบประมาณ']

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

// localStorage แยกตาม origin — session ที่ค้างในโปรไฟล์เป็นของสนามซ้อม ไม่ใช่ของ localhost
// จึงต้องคัดเฉพาะคีย์ sb-* / sl-auth-remember มายัดใส่ dev server ก่อน goto ครั้งแรก
// token อยู่ใน memory ของ Node เท่านั้น ห้าม log ห้ามเขียนไฟล์เด็ดขาด
async function transferDemoSession(page, baseUrl) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) return
  await page.goto(SESSION_SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)
  const entries = await safeEvaluate(page, () => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('sb-') || key === 'sl-auth-remember'), undefined, [])
  const tokenEntry = entries.find(([key]) => key.endsWith('-auth-token'))
  if (!tokenEntry) {
    throw new BlockedError('โปรไฟล์นี้ไม่มี session ค้างบนสนามซ้อม — เปิด Chrome โปรไฟล์นี้ล็อกอินใหม่ก่อน')
  }
  let hasRefreshToken = false
  try {
    hasRefreshToken = Boolean(JSON.parse(tokenEntry[1])?.refresh_token)
  } catch { hasRefreshToken = false }
  if (!hasRefreshToken) {
    throw new BlockedError('session ในโปรไฟล์ไม่มี refresh token — ต่ออายุเองไม่ได้ ต้องล็อกอินใหม่')
  }
  await page.addInitScript(pairs => {
    for (const [key, value] of pairs) {
      try { localStorage.setItem(key, value) } catch { /* โควตาเต็ม/โหมดส่วนตัว */ }
    }
  }, entries)
}

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
  // หน้าต่างพิมพ์เรียก window.print() เอง — headless Chrome ไม่มีคิวพิมพ์ ต้อง stub ไว้
  // ไม่งั้นการรันแบบ --headed จะค้างที่ไดอะล็อกพิมพ์ของระบบปฏิบัติการ
  await context.addInitScript(() => { window.print = () => {} })
  const page = context.pages()[0] || await context.newPage()
  page.on('dialog', dialog => {
    // alert ของแอปคือทางเดียวที่บอกว่าบันทึกไม่ผ่านเพราะอะไร ปกติถูกกลืนไปเงียบๆ
    // FLEET_TEST_DEBUG=1 จึงพ่นออก stderr เพื่อไล่ปัญหา (ไม่ลงไฟล์ผลทดสอบ)
    if (process.env.FLEET_TEST_DEBUG) {
      process.stderr.write(`DIALOG[${profile}]: ${dialog.message().slice(0, 300)}\n`)
    }
    dialog.accept().catch(() => {})
  })
  await transferDemoSession(page, baseUrl)
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

// "ตำแหน่งผู้ขอ" เป็น readOnly เมื่อโปรไฟล์มีตำแหน่งอยู่แล้ว (trigger ฝั่ง DB จะเขียนทับให้)
// element.fill() จะโยน error กับช่อง readOnly จึงต้องข้ามอย่างตั้งใจ ไม่ใช่ปล่อยให้เทสล้ม
async function fillFieldIfEditable(page, labelText, value) {
  const element = (await controlHandle(page, labelText, 'input, textarea')).asElement()
  if (!element) throw new BlockedError(`ไม่พบช่อง "${labelText}"`)
  const locked = await element.evaluate(el => el.readOnly || el.disabled)
  if (locked) return false
  await element.fill(String(value))
  return true
}

async function readFieldValue(page, labelText) {
  const element = (await controlHandle(page, labelText, 'input, textarea, select')).asElement()
  if (!element) throw new BlockedError(`ไม่พบช่อง "${labelText}"`)
  return element.evaluate(el => el.value)
}

// ช่องร่วมของใบขออนุญาตใช้รถ (แบบ 3) ที่ทั้งฟอร์ม "ขออนุญาตใช้รถ" และ "บันทึกย้อนหลัง" ต้องมี
async function fillForm3Fields(page, { destination, purpose, passengers = 3 }) {
  await fillFieldIfEditable(page, 'ตำแหน่งผู้ขอ', TEST_POSITION)
  await fillField(page, 'จำนวนผู้ร่วมเดินทาง', passengers)
  const destinationLabel = await page.evaluate(() =>
    [...document.querySelectorAll('label')].some(el => el.offsetParent !== null
      && el.textContent.trim().startsWith('สถานที่ไป')) ? 'สถานที่ไป' : 'ปลายทาง')
  await fillField(page, destinationLabel, destination)
  await fillField(page, 'ในท้องที่', TEST_LOCALITY)
  await fillField(page, 'จังหวัด', TEST_PROVINCE)
  await fillField(page, 'วัตถุประสงค์', purpose)
}

// เปิดแถวรายการที่ตรงกับ destination ที่ระบุ (คลิกที่แถว ไม่ใช่ปุ่มในแถว)
async function openTripDetail(page, destination) {
  const opened = await page.evaluate(target => {
    const rows = [...document.querySelectorAll('table tbody tr')]
      .filter(el => el.offsetParent !== null && (el.innerText || '').includes(target))
    // แถวสุดท้ายที่ตรง = รายการที่เพิ่งสร้าง เผื่อกรณีมีทริปทดสอบชื่อคล้ายกันค้างอยู่
    const row = rows[rows.length - 1]
    if (!row) return false
    const cell = [...row.querySelectorAll('td')].find(td => !td.querySelector('button')) || row
    cell.click()
    return true
  }, destination)
  if (!opened) throw new BlockedError(`ไม่พบรายการ "${destination}" ในตาราง`)
  await page.waitForTimeout(1_500)
  const isDetail = await page.evaluate(() => document.body.innerText.includes('รายละเอียดการใช้รถ'))
  if (!isDetail) throw new BlockedError('คลิกแถวแล้วกล่อง "รายละเอียดการใช้รถ" ไม่เปิด')
}

// กดพิมพ์แล้วอ่านเนื้อหาหน้าต่างพิมพ์ (window.print ถูก stub ไว้ที่ addInitScript แล้ว)
async function capturePrintDoc(context, page, { pdfPath } = {}) {
  const popupPromise = context.waitForEvent('page', { timeout: 20_000 })
  await clickButton(page, 'พิมพ์ใบขอใช้รถ', { exact: false })
  const popup = await popupPromise
  await popup.waitForTimeout(1_500)
  const text = await popup.evaluate(() => document.body.innerText.replace(/ /g, ' '))
  if (pdfPath) {
    await popup.pdf({ path: pdfPath, format: 'A4', printBackground: true })
    // PNG ไว้ให้คนดูเทียบกับแบบฟอร์มกระดาษด้วยตา (PDF เปิดดูใน terminal ไม่ได้)
    await popup.setViewportSize({ width: 794, height: 1123 })
    await popup.screenshot({ path: pdfPath.replace(/\.pdf$/, '.png'), fullPage: true })
  }
  await popup.close()
  await page.waitForTimeout(500)
  return text
}

// รถทดสอบของรอบนี้ถูกสร้างใน checkFuelCounter — แต่ต้องสร้างเองได้ด้วยเวลารันชุดเดียว
// ผ่าน FLEET_TEST_ONLY เพื่อไม่ให้ต้องรันทั้งไฟล์ซ้ำตอนไล่แก้
async function ensureTestVehicle(page) {
  await openTab(page, 'รถและเครื่องยนต์')
  const exists = await page.evaluate(name => document.body.innerText.includes(name), TEST_VEHICLE_NAME)
  if (exists) return
  await clickButton(page, 'เพิ่มทรัพย์สิน', { exact: false })
  await page.waitForTimeout(1_000)
  await fillField(page, 'ชื่อ / รหัส', TEST_VEHICLE_NAME)
  await fillField(page, 'ทะเบียน', TEST_PLATE)
  await selectField(page, 'ประเภท', 'รถกระบะ')
  await fillField(page, 'ความจุถัง', 60)
  await fillField(page, 'ค่ามิเตอร์เริ่มต้น', 10_000)
  // ต้องเป็น "รถส่วนกลาง" ไม่งั้น fleet_staff คนละกองมองไม่เห็น (fleet_can_read_asset)
  // และแบบ 3 คือใบขออนุญาตใช้ "รถส่วนกลาง" อยู่แล้ว
  const pooled = await page.evaluate(() => {
    const box = document.querySelector('#is_pool')
    if (!box || box.checked) return Boolean(box?.checked)
    box.click()
    return true
  })
  if (!pooled) throw new BlockedError('ตั้งค่ารถทดสอบเป็นทรัพย์สินส่วนกลางไม่สำเร็จ')
  await clickButton(page, 'บันทึก')
  await page.waitForTimeout(2_500)
}

// หาแถวของทริปจาก destination แล้วอ่าน/กดปุ่มเฉพาะในแถวนั้น เพื่อไม่ให้ไปโดนทริปอื่น
// (เขียนตรรกะซ้ำในแต่ละ evaluate เพราะ dev server ตั้ง CSP ห้าม eval/new Function)
async function rowTextOf(page, destination) {
  const text = await page.evaluate(target => {
    const rows = [...document.querySelectorAll('table tbody tr')]
      .filter(el => el.offsetParent !== null && (el.innerText || '').includes(target))
    const row = rows[rows.length - 1]
    return row ? row.innerText : null
  }, destination)
  if (text === null) throw new BlockedError(`ไม่พบแถวของ "${destination}" ในตาราง`)
  return text
}

async function rowButtons(page, destination) {
  const labels = await page.evaluate(target => {
    const rows = [...document.querySelectorAll('table tbody tr')]
      .filter(el => el.offsetParent !== null && (el.innerText || '').includes(target))
    const row = rows[rows.length - 1]
    if (!row) return null
    return [...row.querySelectorAll('button')].map(b => (b.innerText || '').trim())
  }, destination)
  if (labels === null) throw new BlockedError(`ไม่พบแถวของ "${destination}" ในตาราง`)
  return labels
}

async function clickButtonInRow(page, destination, buttonText) {
  const clicked = await page.evaluate(([target, label]) => {
    const rows = [...document.querySelectorAll('table tbody tr')]
      .filter(el => el.offsetParent !== null && (el.innerText || '').includes(target))
    const row = rows[rows.length - 1]
    if (!row) return false
    const button = [...row.querySelectorAll('button')]
      .find(b => (b.innerText || '').trim().includes(label))
    if (!button) return false
    button.click()
    return true
  }, [destination, buttonText])
  if (!clicked) throw new BlockedError(`ไม่พบปุ่ม "${buttonText}" ในแถวของ "${destination}"`)
  await page.waitForTimeout(1_500)
}

function closeDetail(page) {
  return page.evaluate(() => {
    const modal = [...document.querySelectorAll('div.fixed.inset-0')]
      .find(m => (m.innerText || '').includes('รายละเอียดการใช้รถ'))
    modal?.querySelector('button')?.click()
  })
}

// ───────────────────────────────────────────────────────────────────── checks ──

// ข้อ 1 — fleet_viewer อ่านอย่างเดียวจริง และไม่เห็นแท็บงบประมาณ
async function checkViewerReadOnly(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-viewer', baseUrl, headed)
  try {
    const tabs = await visibleTabs(page)
    assert.ok(!tabs.includes('งบประมาณ'), 'fleet_viewer เห็นแท็บงบประมาณ ทั้งที่ RLS ไม่ให้เขียน')
    for (const tab of ['รถและเครื่องยนต์', 'เชื้อเพลิง', 'การใช้รถ', 'ซ่อมบำรุง']) {
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

// แบบ 4 อยู่แท็บรายงาน — กดไม่ได้จนกว่าจะเลือก 1 คัน เพราะเอกสารเป็นรายคันตามกระดาษ
async function checkForm4PrintButton(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  try {
    await openTab(page, 'รายงาน')
    const body = await bodyText(page)
    assert.ok(body.includes('พิมพ์แบบ 4'), 'แท็บรายงานไม่มีปุ่มพิมพ์แบบ 4')
    const before = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.offsetParent !== null && (b.innerText || '').includes('พิมพ์แบบ 4'))
      return btn ? { disabled: btn.disabled, label: (btn.innerText || '').trim() } : null
    })
    assert.ok(before, 'หาปุ่มพิมพ์แบบ 4 ไม่เจอ')
    assert.equal(before.disabled, true, 'ปุ่มแบบ 4 กดได้ทั้งที่ยังไม่เลือกยานพาหนะ')

    const optionLabel = await page.evaluate(() => {
      const select = [...document.querySelectorAll('select')]
        .find(el => [...el.options].some(opt => (opt.textContent || '').includes('ทุกทรัพย์สิน')))
      const option = [...(select?.options || [])].find(opt => opt.value)
      return option?.textContent?.trim() || ''
    })
    assert.ok(optionLabel, 'ยังไม่มียานพาหนะให้เลือกในหน้ารายงาน')
    await selectField(page, 'รถ/เครื่องยนต์/ครุภัณฑ์', optionLabel)
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.offsetParent !== null && (b.innerText || '').includes('พิมพ์แบบ 4'))
      return btn ? btn.disabled : null
    })
    assert.equal(after, false, 'เลือกยานพาหนะแล้วปุ่มแบบ 4 ยังกดไม่ได้')

    const popupPromise = context.waitForEvent('page', { timeout: 20_000 })
    await clickButton(page, 'พิมพ์แบบ 4', { exact: false })
    const popup = await popupPromise
    await popup.waitForTimeout(1_500)
    const printed = await popup.evaluate(() => document.body.innerText.replace(/\u00a0/g, ' '))
    assert.ok(printed.includes('แบบ 4'), 'หน้าต่างพิมพ์ไม่ใช่แบบ 4')
    assert.ok(printed.includes('บันทึกการใช้'), 'เอกสารไม่มีหัว "บันทึกการใช้รถ"')
    assert.ok(printed.includes('หมายเลขทะเบียน'), 'เอกสารไม่มีบรรทัดทะเบียน')
    assert.ok(printed.includes('ผู้ใช้รถ') && printed.includes('พนักงานขับรถ'),
      'เอกสารไม่มีคอลัมน์ผู้ใช้รถ/พนักงานขับรถตามต้นฉบับ')
    assert.ok(!printed.includes('undefined') && !printed.includes('NaN'),
      'เอกสารพิมพ์มีค่าที่เรนเดอร์ไม่สำเร็จ')
    await popup.pdf({
      path: path.join(PRINT_DIR, 'fleet-form4-live.pdf'),
      format: 'A4', landscape: true, printBackground: true,
    })
    await popup.setViewportSize({ width: 1123, height: 794 })
    await popup.screenshot({ path: path.join(PRINT_DIR, 'fleet-form4-live.png'), fullPage: true })
    await popup.close()
  } finally {
    await context.close()
  }
}

// สโมกทดสอบแท็บที่ชุด regression เดิมไม่ได้แตะ (ซ่อมบำรุง/งบประมาณ/ปุ่มส่งออก/ปุ่มพิมพ์เชื้อเพลิง)
// อ่านอย่างเดียว ไม่เขียนข้อมูล — จับ 2 อย่างที่ assert รายข้อจับไม่ได้:
//   ก) แท็บใดเรนเดอร์พังเงียบๆ (crash boundary/หน้าว่าง) หลังแก้โค้ดชุดใหญ่
//   ข) console error / uncaught exception ที่ไม่โผล่บนหน้าจอแต่พังตอนผู้ใช้จริงกดต่อ
const TAB_ANCHORS = {
  'ภาพรวม': ['อัตราสิ้นเปลือง'],
  'รถและเครื่องยนต์': ['เพิ่มทรัพย์สิน', 'ประเภทรถ', 'นำเข้า CSV/XLSX'],
  'เชื้อเพลิง': ['บันทึกเชื้อเพลิง', 'รายการ'],
  'การใช้รถ': ['ประวัติการใช้รถ'],
  'ซ่อมบำรุง': ['บันทึกซ่อมบำรุง'],
  'รายงาน': ['ดูรายงาน', 'พิมพ์แบบ 4'],
  'งบประมาณ': ['ปีงบประมาณ'],
}
// ข้อความที่แปลว่า "เรนเดอร์ไม่ผ่าน" ไม่ใช่แค่ไม่มีข้อมูล (FleetEmptyState เป็นสภาพปกติ)
const CRASH_MARKERS = [
  'Something went wrong', 'Unexpected Application Error', 'Cannot read properties',
  'is not a function', 'new row violates row-level security',
]

async function checkAllTabsSmoke(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  const runtimeErrors = []
  // เก็บเฉพาะ 120 ตัวแรกของข้อความ พอชี้จุดได้โดยไม่พาเนื้อหาหน้าเว็บออกมา
  page.on('pageerror', err => runtimeErrors.push(`pageerror: ${String(err?.message ?? '').slice(0, 120)}`))
  page.on('console', msg => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // ทรัพยากรภายนอกที่โหลดไม่ได้บน dev server (favicon/แผนที่/ฟอนต์) ไม่ใช่ข้อบกพร่องของโมดูลนี้
    if (/favicon|manifest|net::ERR|Failed to load resource|googleapis|longdo/i.test(text)) return
    runtimeErrors.push(`console: ${text.slice(0, 120)}`)
  })
  try {
    const tabs = await visibleTabs(page)
    for (const label of Object.keys(TAB_ANCHORS)) {
      assert.ok(tabs.includes(label), `ผู้ดูแลระบบยานพาหนะไม่เห็นแท็บ "${label}"`)
    }
    for (const [label, anchors] of Object.entries(TAB_ANCHORS)) {
      await openTab(page, label)
      const text = await bodyText(page)
      for (const marker of CRASH_MARKERS) {
        assert.ok(!text.includes(marker), `แท็บ "${label}" เรนเดอร์ไม่ผ่าน (พบ "${marker}")`)
      }
      assert.ok(!/undefined|NaN/.test(text), `แท็บ "${label}" แสดงค่า undefined/NaN บนหน้าจอ`)
      for (const anchor of anchors) {
        assert.ok(text.includes(anchor), `แท็บ "${label}" ไม่มี "${anchor}"`)
      }
    }
    // ปุ่มส่งออกของแท็บรายงานขึ้นหลังกด "ดูรายงาน" เท่านั้น (เรนเดอร์ตาม data)
    await openTab(page, 'รายงาน')
    await clickButton(page, 'ดูรายงาน', { exact: false })
    await page.waitForTimeout(4_000)
    const reportText = await bodyText(page)
    for (const label of ['พิมพ์ / PDF', 'Excel การใช้รถ', 'Excel น้ำมัน', 'Excel ซ่อมบำรุง']) {
      assert.ok(reportText.includes(label), `กดดูรายงานแล้วไม่มีปุ่ม "${label}"`)
    }
    assert.ok(!/undefined|NaN/.test(reportText), 'ผลรายงานมีค่า undefined/NaN')

    // ปุ่มพิมพ์ของเชื้อเพลิงอยู่ในกล่องรายละเอียดของแถว ไม่ได้อยู่บนแท็บ จึงต้องเปิดแถวก่อน
    // ถ้าสนามซ้อมยังไม่มีรายการเชื้อเพลิงเลย ให้ข้ามอย่างตั้งใจ ไม่ใช่ปล่อยผ่านเงียบๆ
    await openTab(page, 'เชื้อเพลิง')
    const openedFuelRow = await page.evaluate(() => {
      const row = [...document.querySelectorAll('table tbody tr')].find(el => el.offsetParent !== null)
      if (!row) return false
      const cell = [...row.querySelectorAll('td')].find(td => !td.querySelector('button')) || row
      cell.click()
      return true
    })
    if (openedFuelRow) {
      await page.waitForTimeout(1_500)
      const detail = await bodyText(page)
      assert.ok(detail.includes('พิมพ์บันทึกเชื้อเพลิง'),
        'เปิดรายละเอียดรายการเชื้อเพลิงแล้วไม่มีปุ่มพิมพ์')
      const fuelPopupPromise = context.waitForEvent('page', { timeout: 20_000 })
      await clickButton(page, 'พิมพ์บันทึกเชื้อเพลิง', { exact: false })
      const fuelPopup = await fuelPopupPromise
      await fuelPopup.waitForTimeout(1_500)
      const printed = await fuelPopup.evaluate(() => document.body.innerText.replace(/ /g, ' '))
      assert.ok(printed.includes('เชื้อเพลิง'), 'หน้าต่างพิมพ์ไม่ใช่ใบบันทึกเชื้อเพลิง')
      assert.ok(!printed.includes('undefined') && !printed.includes('NaN'),
        'ใบบันทึกเชื้อเพลิงมีค่าที่เรนเดอร์ไม่สำเร็จ')
      await fuelPopup.pdf({ path: path.join(PRINT_DIR, 'fleet-fuel-live.pdf'), format: 'A4', printBackground: true })
      await fuelPopup.close()
    } else {
      process.stdout.write('NOTE: ไม่มีรายการเชื้อเพลิงบนสนามซ้อม — ข้ามการตรวจใบพิมพ์เชื้อเพลิง' + String.fromCharCode(10))
    }

    assert.equal(runtimeErrors.length, 0,
      `พบ error ระหว่างเปิดแท็บ: ${runtimeErrors.slice(0, 3).join(' | ')}`)
  } finally {
    await context.close()
  }
}

// ข้อ 3 — ตัวนับรายการหน้าเชื้อเพลิงต้องอัปเดตทันทีหลังบันทึก (โหมด --write)
async function checkFuelCounter(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  try {
    // เตรียมรถของตัวเองไว้ก่อน เพื่อไม่ไปแตะทรัพย์สินที่ อปท. ใช้จริง
    // ใช้ helper ตัวเดียวกับชุดอื่น ไม่งั้นรถจะถูกสร้างแบบไม่ใช่ "ส่วนกลาง"
    // แล้วชุด staff-request-approval ที่รันทีหลังจะมองไม่เห็นรถคันนี้
    await ensureTestVehicle(page)

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
    await ensureTestVehicle(page)
    await openTab(page, 'การใช้รถ')
    const pad = n => String(n).padStart(2, '0')
    const today = new Date()
    const later = new Date(Date.now() + 3 * 86_400_000)
    const at = (d, hour) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`
    const thaiToday = today.toLocaleDateString('th-TH', { dateStyle: 'short' })

    await clickButton(page, 'ขออนุญาตใช้รถ')
    await page.waitForTimeout(1_000)
    await fillForm3Fields(page, { destination: TEST_DESTINATION, purpose: TEST_PURPOSE })
    await selectField(page, 'ยานพาหนะ', `${TEST_VEHICLE_NAME} (${TEST_PLATE})`)
    await fillField(page, 'วันเวลาออก', at(later, 9))
    await fillField(page, 'กลับโดยประมาณ', at(later, 16))
    await clickButton(page, 'ส่งคำขออนุญาตใช้รถ')
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
    const activeBlock = text.slice(text.indexOf('คำขอและการใช้รถ'), text.indexOf('ประวัติการใช้รถ'))
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

// ข้อ 6 — วงจร "ขออนุญาตใช้รถ (แบบ 3)" ครบรอบ: ยื่นคำขอ → อนุมัติ → ออก/กลับ → พิมพ์
//         ตรวจว่าเอกสารที่พิมพ์มีข้อมูลครบทุกช่องตามแบบ 3 และช่อง "อนุมัติ" ถูกติ๊ก
//         ตามสถานะจริงเท่านั้น (ยังไม่อนุมัติ = ต้องไม่ติ๊กให้เอง)
async function checkForm3RequestPrint(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  try {
    const pad = n => String(n).padStart(2, '0')
    const later = new Date(Date.now() + 5 * 86_400_000)
    const at = (d, hour) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`
    const destination = `${TEST_DESTINATION} แบบ3 ${STAMP}`

    await ensureTestVehicle(page)
    await openTab(page, 'การใช้รถ')
    await clickButton(page, 'ขออนุญาตใช้รถ')
    await page.waitForTimeout(1_000)

    // ตำแหน่งผู้ขอต้องมาจากข้อมูลบุคลากร ไม่ใช่ให้พิมพ์เองได้ตามใจ (snapshot กันแก้ย้อนหลัง)
    const positionEditable = await fillFieldIfEditable(page, 'ตำแหน่งผู้ขอ', TEST_POSITION)
    const positionValue = await readFieldValue(page, 'ตำแหน่งผู้ขอ')
    assert.ok(String(positionValue).trim(), 'ช่อง "ตำแหน่งผู้ขอ" ว่าง ทั้งที่เป็นช่องบังคับของแบบ 3')

    await fillField(page, 'จำนวนผู้ร่วมเดินทาง', 3)
    await fillField(page, 'สถานที่ไป', destination)
    await fillField(page, 'ในท้องที่', TEST_LOCALITY)
    await fillField(page, 'จังหวัด', TEST_PROVINCE)
    await fillField(page, 'วัตถุประสงค์', TEST_PURPOSE)
    await selectField(page, 'ยานพาหนะ', `${TEST_VEHICLE_NAME} (${TEST_PLATE})`)
    await fillField(page, 'วันเวลาออก', at(later, 8))
    await fillField(page, 'กลับโดยประมาณ', at(later, 17))
    await clickButton(page, 'ส่งคำขออนุญาตใช้รถ')
    await page.waitForTimeout(3_500)

    const afterSubmit = await bodyText(page)
    assert.ok(afterSubmit.includes(destination), 'ส่งคำขอแล้วไม่พบรายการในหน้าจอ')

    // ── พิมพ์ตอนยังไม่อนุมัติ: ห้ามติ๊ก "อนุมัติ" ให้ล่วงหน้า ──
    await openTripDetail(page, destination)
    const detailText = await page.evaluate(() =>
      [...document.querySelectorAll('div.fixed.inset-0')].map(m => m.innerText).join('\n'))
    for (const field of ['ตำแหน่งผู้ขอ', 'ผู้ร่วมเดินทาง', 'ในท้องที่', 'จังหวัด']) {
      assert.ok(detailText.includes(field), `กล่องรายละเอียดไม่มีช่อง "${field}" ของแบบ 3`)
    }
    assert.ok(detailText.includes(TEST_LOCALITY) && detailText.includes(TEST_PROVINCE),
      'กล่องรายละเอียดไม่แสดงท้องที่/จังหวัดที่กรอกไว้')

    const pendingPrint = await capturePrintDoc(context, page,
      { pdfPath: path.join(PRINT_DIR, 'fleet-form3-pending.pdf') })
    assert.ok(pendingPrint.includes('ใบขออนุญาตใช้รถส่วนกลาง'), 'หน้าต่างพิมพ์ไม่ใช่ใบขออนุญาตใช้รถ (แบบ 3)')
    assert.ok(/\(\s*\)\s*อนุมัติ/.test(pendingPrint),
      'คำขอที่ยังไม่อนุมัติ แต่เอกสารติ๊กช่อง "อนุมัติ" ให้แล้ว')
    await closeDetail(page)
    await page.waitForTimeout(1_000)

    // ── อนุมัติ แล้วเดินทางจริงจนจบ ──
    await clickButton(page, 'อนุมัติ', { exact: false })
    await page.waitForTimeout(3_000)
    await clickButton(page, '🚀', { exact: false })
    await page.waitForTimeout(1_200)
    await fillField(page, 'เวลาออกจริง', at(new Date(), 8))
    await fillField(page, 'เลขไมล์ก่อนออก', 20_000)
    await clickButton(page, 'ยืนยันออกเดินทาง')
    await page.waitForTimeout(3_500)
    await clickButton(page, '🏁', { exact: false })
    await page.waitForTimeout(1_200)
    await fillField(page, 'เวลากลับจริง', at(new Date(), 17))
    await fillField(page, 'เลขไมล์หลังกลับ', 20_128)
    await clickButton(page, 'ยืนยันกลับถึง')
    await page.waitForTimeout(3_500)

    // ── พิมพ์ฉบับสมบูรณ์: ต้องมีเลขไมล์ ระยะทาง ผู้ลงนาม และช่องอนุมัติถูกติ๊ก ──
    await openTripDetail(page, destination)
    const finalPrint = await capturePrintDoc(context, page,
      { pdfPath: path.join(PRINT_DIR, 'fleet-form3-completed.pdf') })
    const expected = [
      ['ทะเบียนรถ', TEST_PLATE],
      ['ตำแหน่งผู้ขอ', String(positionValue).trim()],
      ['ในท้องที่', TEST_LOCALITY],
      ['จังหวัด', TEST_PROVINCE.replace(/^จังหวัด\s*/, '')],
      ['สถานที่ไป', destination],
      ['วัตถุประสงค์', TEST_PURPOSE],
      ['จำนวนผู้ร่วมเดินทาง', '3'],
      ['เลขไมล์ขาไป', '20,000'],
      ['เลขไมล์ขากลับ', '20,128'],
      ['รวมระยะทาง', '128'],
    ]
    for (const [field, value] of expected) {
      assert.ok(finalPrint.includes(value), `เอกสารพิมพ์ไม่มีค่าของช่อง "${field}"`)
    }
    for (const role of ['ผู้ขออนุญาต', 'ผู้ขับรถ', 'ผู้อำนวยการกอง/หัวหน้ากอง', 'ผู้มีอำนาจสั่งใช้รถ']) {
      assert.ok(finalPrint.includes(role), `เอกสารพิมพ์ไม่มีช่องลงนาม "${role}"`)
    }
    assert.ok(/\(✓\)\s*อนุมัติ/.test(finalPrint),
      'คำขอที่อนุมัติและเดินทางจบแล้ว แต่เอกสารไม่ติ๊กช่อง "อนุมัติ"')
    assert.ok(!/\(✓\)\s*ไม่อนุมัติ/.test(finalPrint), 'เอกสารติ๊กช่อง "ไม่อนุมัติ" ผิด')

    // แบบ 3 กระดาษไม่มีเชิงอรรถระบบท้ายใบ
    assert.ok(!finalPrint.includes('ผ่านการอนุมัติในระบบโดย'),
      'เอกสารยังมีบรรทัด "ผ่านการอนุมัติในระบบโดย" ซึ่งไม่อยู่บนแบบ 3')
    assert.ok(!finalPrint.includes('ลายมือชื่ออิเล็กทรอนิกส์'),
      'เอกสารยังมีเชิงอรรถระบบท้ายใบ')
    // ช่อง "ผู้มีอำนาจสั่งใช้รถ" ต้องมาจากผู้ลงนามที่ อปท. ตั้งไว้ ไม่ใช่บัญชีที่กดอนุมัติในระบบ
    // เทสนี้ผู้ขอกับคนกดอนุมัติเป็นคนเดียวกัน — ชื่อในช่องผู้ขอต้องไม่ไปโผล่ที่ช่องผู้มีอำนาจ
    const requesterBlock = finalPrint.slice(finalPrint.indexOf('ผู้ขออนุญาต'), finalPrint.indexOf('ผู้ขับรถ'))
    const requesterPrinted = (requesterBlock.match(/\(([^)]+)\)/) || [])[1]?.trim()
    const authorityBlock = finalPrint.slice(finalPrint.lastIndexOf('ผู้มีอำนาจสั่งใช้รถ'))
    if (requesterPrinted) {
      assert.ok(!authorityBlock.includes(requesterPrinted),
        `ช่องผู้มีอำนาจสั่งใช้รถพิมพ์ชื่อผู้ขอ/คนกดอนุมัติ (${requesterPrinted}) แทนผู้ลงนามที่ตั้งค่าไว้`)
    }
    assert.ok(!finalPrint.includes('undefined') && !finalPrint.includes('NaN')
      && !finalPrint.includes('Invalid Date'), 'เอกสารพิมพ์มีค่าที่เรนเดอร์ไม่สำเร็จ')

    // ปีต้องเป็น พ.ศ. ไม่ใช่ ค.ศ. — พลาดตรงนี้เอกสารราชการใช้ไม่ได้
    const buddhistYear = String(new Date().getFullYear() + 543)
    assert.ok(finalPrint.includes(buddhistYear),
      `เอกสารไม่ได้ใช้ปี พ.ศ. (คาดว่าเจอ ${buddhistYear})`)
    await closeDetail(page)

    if (!positionEditable) {
      process.stdout.write('NOTE: ช่อง "ตำแหน่งผู้ขอ" ล็อกตามข้อมูลบุคลากร (ตรงกับ trigger ฝั่ง DB)\n')
    }
  } finally {
    await context.close()
  }
}

// ข้อ 7 — บันทึกการใช้รถย้อนหลัง: ต้องได้สถานะ "เสร็จสิ้น" ทันที เข้าไปอยู่ในประวัติ
//         และเอกสารที่พิมพ์ต้อง "ไม่ติ๊กอนุมัติ" เพราะไม่ได้ผ่านขั้นอนุมัติจริง
// ข้อ 8 — แยกบทบาท "ผู้ขอ" กับ "ผู้อนุมัติ" ให้ขาดจากกัน: เจ้าหน้าที่ยื่นคำขอได้
//         แต่ต้องอนุมัติคำขอของตัวเองไม่ได้ ต้องรอผู้มีอำนาจสั่งใช้รถกดอนุมัติ
//         (เป็นหัวใจของแบบ 3 ถ้าพลาดข้อนี้ เอกสารที่พิมพ์ออกมาไม่มีค่าเชิงการควบคุมภายใน)
async function checkStaffRequestNeedsAdminApproval(baseUrl, headed) {
  const pad = n => String(n).padStart(2, '0')
  const later = new Date(Date.now() + 9 * 86_400_000)
  const at = (d, hour) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`
  const destination = `${TEST_DESTINATION} คำขอเจ้าหน้าที่ ${STAMP}`

  // รถทดสอบต้องมีก่อน และเจ้าหน้าที่ทั่วไปสร้างทรัพย์สินเองไม่ได้ จึงให้ admin เตรียมให้
  const admin = await openFleet('fleet-admin', baseUrl, headed)
  try { await ensureTestVehicle(admin.page) } finally { await admin.context.close() }

  const staff = await openFleet('fleet-staff', baseUrl, headed)
  try {
    await openTab(staff.page, 'การใช้รถ')

    // บันทึกย้อนหลัง = สร้างรายการ "เสร็จสิ้นแล้ว" ข้ามขั้นอนุมัติ ต้องเป็นสิทธิ์ผู้ดูแลเท่านั้น
    const staffButtons = await writeButtonsOn(staff.page)
    assert.ok(!staffButtons.some(label => label.includes('บันทึกย้อนหลัง')
      || label.includes('บันทึกการใช้รถย้อนหลัง')),
      'เจ้าหน้าที่ทั่วไปเห็นปุ่มบันทึกการใช้รถย้อนหลัง — สร้างประวัติที่ไม่มีใครอนุมัติได้เอง')
    assert.ok(staffButtons.some(label => label.includes('ขออนุญาตใช้รถ')),
      'เจ้าหน้าที่ไม่เห็นปุ่มขออนุญาตใช้รถ')

    await clickButton(staff.page, 'ขออนุญาตใช้รถ')
    await staff.page.waitForTimeout(1_000)
    await fillForm3Fields(staff.page, { destination, purpose: TEST_PURPOSE, passengers: 1 })
    await selectField(staff.page, 'ยานพาหนะ', `${TEST_VEHICLE_NAME} (${TEST_PLATE})`)
    await fillField(staff.page, 'วันเวลาออก', at(later, 8))
    await fillField(staff.page, 'กลับโดยประมาณ', at(later, 12))
    await clickButton(staff.page, 'ส่งคำขออนุญาตใช้รถ')
    await staff.page.waitForTimeout(3_500)

    const text = await bodyText(staff.page)
    assert.ok(text.includes(destination), 'เจ้าหน้าที่ส่งคำขอใช้รถไม่สำเร็จ')
    assert.ok(!/new row violates row-level security/i.test(text),
      'เจ้าหน้าที่เจอ error ดิบจาก RLS ตอนส่งคำขอ')

    const ownRowButtons = await rowButtons(staff.page, destination)
    assert.ok(!ownRowButtons.some(label => label.includes('อนุมัติ')),
      'เจ้าหน้าที่ทั่วไปเห็นปุ่มอนุมัติคำขอของตัวเอง — ขัดหลักแยกผู้ขอออกจากผู้อนุมัติ')
    assert.ok(ownRowButtons.some(label => label.includes('ยกเลิก')),
      'เจ้าหน้าที่ยกเลิกคำขอของตัวเองไม่ได้')
  } finally {
    await staff.context.close()
  }

  const approver = await openFleet('fleet-admin', baseUrl, headed)
  try {
    await openTab(approver.page, 'การใช้รถ')
    const buttons = await rowButtons(approver.page, destination)
    assert.ok(buttons.some(label => label.includes('อนุมัติ')),
      'ผู้ดูแลระบบยานพาหนะไม่เห็นปุ่มอนุมัติคำขอของเจ้าหน้าที่')
    await clickButtonInRow(approver.page, destination, 'อนุมัติ')
    await approver.page.waitForTimeout(3_000)
    const rowText = await rowTextOf(approver.page, destination)
    assert.ok(rowText.includes('อนุมัติแล้ว'),
      `อนุมัติแล้วแต่สถานะในตารางไม่เปลี่ยนเป็น "อนุมัติแล้ว"`)
  } finally {
    await approver.context.close()
  }
}

async function checkBackdatedEntryPrint(baseUrl, headed) {
  const { context, page } = await openFleet('fleet-admin', baseUrl, headed)
  try {
    const pad = n => String(n).padStart(2, '0')
    const past = new Date(Date.now() - 6 * 86_400_000)
    const at = (d, hour) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`
    const destination = `${TEST_DESTINATION} ย้อนหลัง ${STAMP}`
    const thaiPastDate = past.toLocaleDateString('th-TH', { dateStyle: 'short' })

    await ensureTestVehicle(page)
    await openTab(page, 'การใช้รถ')
    await clickButton(page, 'บันทึกการใช้รถย้อนหลัง', { exact: false })
    await page.waitForTimeout(1_000)
    await fillForm3Fields(page, { destination, purpose: TEST_PURPOSE, passengers: 2 })
    await selectField(page, 'ยานพาหนะ', `${TEST_VEHICLE_NAME} (${TEST_PLATE})`)
    await fillField(page, 'วันเวลาออก', at(past, 9))
    await fillField(page, 'วันเวลากลับ', at(past, 15))
    await fillField(page, 'เลขไมล์ก่อน', 20_128)
    await fillField(page, 'เลขไมล์หลัง', 20_212)

    // เหตุผลเป็นช่องบังคับ — กดบันทึกทั้งที่ยังว่างต้องไม่ผ่าน และต้องไม่สร้างแถวค้างไว้
    await clickButton(page, 'บันทึก')
    await page.waitForTimeout(1_500)
    const stillOpen = await page.evaluate(() =>
      document.body.innerText.includes('เหตุผลที่บันทึกย้อนหลัง'))
    assert.ok(stillOpen, 'บันทึกย้อนหลังผ่านได้ทั้งที่ยังไม่กรอกเหตุผล')

    await fillField(page, 'เหตุผลที่บันทึกย้อนหลัง', TEST_BACKDATED_REASON)
    await clickButton(page, 'บันทึก')
    await page.waitForTimeout(3_500)

    const text = await bodyText(page)
    assert.ok(text.includes(destination), 'บันทึกย้อนหลังแล้วไม่พบรายการในหน้าจอ')

    // ต้องตกลงไปอยู่ในบล็อก "ประวัติการใช้รถ" ไม่ใช่ค้างเป็นคำขอที่ยังดำเนินการอยู่
    const historyBlock = text.slice(text.indexOf('ประวัติการใช้รถ'))
    assert.ok(historyBlock.includes(destination),
      'รายการย้อนหลังไม่เข้าไปอยู่ในประวัติการใช้รถ (สถานะน่าจะไม่ใช่ "เสร็จสิ้น")')
    assert.ok(historyBlock.includes(thaiPastDate),
      `ประวัติไม่ได้ใช้วันที่ออกเดินทางจริงย้อนหลัง (${thaiPastDate})`)

    await openTripDetail(page, destination)
    const printed = await capturePrintDoc(context, page,
      { pdfPath: path.join(PRINT_DIR, 'fleet-form3-backdated.pdf') })
    assert.ok(printed.includes(TEST_LOCALITY) && printed.includes('20,128') && printed.includes('20,212'),
      'เอกสารของรายการย้อนหลังไม่มีท้องที่/เลขไมล์ที่บันทึกไว้')
    assert.ok(printed.includes('84'), 'เอกสารไม่ได้คำนวณระยะทางรวม (คาดว่า 84 กม.)')
    assert.ok(/\(\s*\)\s*อนุมัติ/.test(printed),
      'รายการย้อนหลังไม่ได้ผ่านขั้นอนุมัติ แต่เอกสารติ๊กช่อง "อนุมัติ" ให้เอง')
    assert.ok(printed.includes(TEST_BACKDATED_REASON),
      'เอกสารไม่ได้พิมพ์เหตุผลที่บันทึกย้อนหลังกำกับไว้')
    assert.ok(!printed.includes('ผ่านการอนุมัติในระบบโดย'),
      'รายการย้อนหลังไม่มีผู้อนุมัติ แต่เอกสารขึ้นบรรทัดว่ามีคนอนุมัติในระบบ')
    await closeDetail(page)
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
  // FLEET_TEST_DEBUG=1 → พิมพ์บรรทัดแรกของ error ออก stderr เท่านั้น (ไม่ลงไฟล์ผลทดสอบ)
  // ให้พอไล่ปัญหาเครื่องมือได้ โดยไม่พาเนื้อหาหน้าเว็บทั้งก้อนออกมา
  if (process.env.FLEET_TEST_DEBUG) {
    process.stderr.write(`DEBUG ${error?.name}: ${String(error?.message ?? '').split('\n')[0].slice(0, 300)}\n`)
  }
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
    { name: 'form4-print-button', reason: 'แท็บรายงานมีปุ่มพิมพ์แบบ 4 และกดไม่ได้จนกว่าจะเลือกยานพาหนะ 1 คัน', run: checkForm4PrintButton },
    { name: 'all-tabs-smoke', reason: 'ทุกแท็บของผู้ดูแลเรนเดอร์ครบและไม่มี error ใน console', run: checkAllTabsSmoke },
  ]
  if (args.write) {
    checks.push(
      { name: 'fuel-counter', reason: 'ตัวนับรายการเชื้อเพลิงอัปเดตทันทีหลังบันทึก', run: checkFuelCounter },
      { name: 'trip-date', reason: 'trip_date ตามวันที่ออกเดินทางจริง', run: checkTripDateFollowsDeparture },
      { name: 'form3-request-print', reason: 'ขออนุญาตใช้รถ → อนุมัติ → เดินทาง → พิมพ์แบบ 3 ครบทุกช่อง', run: checkForm3RequestPrint },
      { name: 'staff-request-approval', reason: 'เจ้าหน้าที่ยื่นคำขอได้ แต่อนุมัติเองไม่ได้ ต้องให้ผู้มีอำนาจอนุมัติ', run: checkStaffRequestNeedsAdminApproval },
      { name: 'backdated-entry-print', reason: 'บันทึกย้อนหลังเข้าประวัติทันที และเอกสารไม่ติ๊กอนุมัติเอง', run: checkBackdatedEntryPrint },
    )
  }

  // FLEET_TEST_ONLY=form3-request-print,... — รันเฉพาะบางชุดตอนไล่แก้ ไม่ต้องรันทั้งไฟล์ซ้ำ
  const only = (process.env.FLEET_TEST_ONLY || '').split(',').map(s => s.trim()).filter(Boolean)
  const selected = only.length ? checks.filter(c => only.includes(c.name)) : checks

  const results = []
  for (const check of selected) {
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
