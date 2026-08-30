// Regression test สำหรับ defects ที่พบใน E2E "แจ้งเรื่องไฟฟ้าสาธารณะจนปิดเรื่อง" (2026-08-30)
//
// ครอบ acceptance criteria ของ 4 ข้อ:
//   1. รูปหลักฐานเป็น optional ตามนโยบาย (commit 0edd5ac) — ต้องไม่มีข้อความ/ปุ่มที่สื่อว่าบังคับ
//   2. Telegram ของ อปท. ที่ไม่ได้ผูกกลุ่ม ต้องไม่ขึ้น console error
//   3. กล่อง "เพิ่มเบอร์มือถือ" กดข้ามแล้วต้องไม่เด้งซ้ำภายใน session เดียว ทุก role
//   4. หน้า /auth ของสนามซ้อมต้องไม่มีชื่อ อปท. จริง
//
// ⚠️ ข้อบังคับด้านความปลอดภัย/PDPA ของไฟล์นี้ (เหมือน negative-authorization.playwright.mjs)
//   - ยิงได้เฉพาะ https://demo.rk-networks.com เท่านั้น hostname อื่น = ปฏิเสธทันที
//   - ห้าม log credential/token/เนื้อหาหน้าเว็บดิบ ลง test-results ทุกกรณี
//   - ข้อมูลที่สร้างต้องขึ้นต้นด้วย [TEST] ไม่มี PII ไม่มีรูป ไม่มีพิกัดจริง เบอร์ใช้ 0000000000
//
// โหมดการรัน
//   ค่าเริ่มต้น = read-only ไม่แตะข้อมูล (ตรวจข้อ 1-4 จากหน้าจอที่มีอยู่)
//   --write     = รัน workflow เต็ม new → received → in_progress → done → closed ซึ่ง "เขียน DB
//                 ของสนามซ้อมจริง" ทิ้งคำร้อง [TEST] ไว้ 1 เรื่องต่อการรัน 1 ครั้ง จึงต้องสั่งเอง
//                 ไม่ผูกกับการรันปกติ

import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const ROOT_DIR = process.cwd()
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.test.local')
const LOG_PATH = path.join(ROOT_DIR, 'test-results-workflow.log')
const PROFILE_ROOT = path.join(ROOT_DIR, '.chrome-test-profiles')
const DEFAULT_BASE_URL = 'https://demo.rk-networks.com'
const DEMO_TENANT_NAME = 'เทศบาลตำบลสาธิต'

// ชื่อ อปท. จริงที่ห้ามโผล่บนสนามซ้อม — เคยหลุดมาทาง municipalities.system_name ที่ seed
// คัดลอกมาจากน้ำเลา (แก้ที่ 20260901140000_fix_demo_tenant_system_name.sql)
const FOREIGN_TENANT_NAMES = ['น้ำเลา', 'ตำหนักธรรม', 'ทุ่งแค้ว']

const PHONE_MODAL_HEADING = 'เพิ่มเบอร์มือถือ'
const NAME_MODAL_HEADING = 'กรอกชื่อ-นามสกุลให้ครบ'
const SKIP_BUTTON = 'ข้ามไปก่อน'
const PHOTO_MANDATORY_TEXT = 'กรุณาถ่ายรูปหลักฐานก่อนปิดงาน'
const TELEGRAM_ERROR_PATTERN = /Telegram notification failed/i

// ข้อมูลทดสอบ ต้องระบุตัวเองว่าเป็นของทดสอบในทุกช่องที่เจ้าหน้าที่จะเห็น
const TEST_MARKER = '[TEST] E2E regression'
const TEST_DETAIL = `${TEST_MARKER} — ไฟดับทั้งดวง (อัตโนมัติ) ห้ามส่งทีมช่างจริง`
const TEST_LOCATION = '[TEST] จุดจำลองหน้าอาคารเทศบาล ไม่ใช่สถานที่จริง'
const TEST_PHONE = '0000000000'

class BlockedError extends Error {}

// ───────────────────────────────────────────────────────────── config/safety ──

function parseEnv(content) {
  const parsed = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

async function loadLocalTestEnv() {
  try {
    const localEnv = parseEnv(await readFile(LOCAL_ENV_PATH, 'utf8'))
    if (!process.env.DEMO_TEST_PASSWORD && localEnv.DEMO_TEST_PASSWORD) {
      process.env.DEMO_TEST_PASSWORD = localEnv.DEMO_TEST_PASSWORD
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function parseArgs(argv) {
  const result = { headed: false, write: false }
  for (const arg of argv) {
    if (arg === '--headed') result.headed = true
    else if (arg === '--write') result.write = true
    else if (arg === '--help') {
      process.stdout.write([
        'Usage: npm run test:workflow -- [--headed] [--write]',
        '  (ไม่ใส่ flag) ตรวจแบบอ่านอย่างเดียว ไม่แตะข้อมูลของสนามซ้อม',
        '  --write      รัน workflow เต็มจนปิดเรื่อง สร้างคำร้อง [TEST] ค้างไว้ 1 เรื่อง',
        '',
      ].join('\n'))
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function resolveBaseUrl() {
  const rawUrl = (process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const parsed = new URL(rawUrl)
  assert.equal(parsed.protocol, 'https:', 'Workflow runner accepts HTTPS only')
  assert.equal(parsed.hostname, 'demo.rk-networks.com', 'Workflow runner refuses every tenant except demo.rk-networks.com')
  assert.equal(parsed.pathname, '/', 'PLAYWRIGHT_BASE_URL must not contain a tenant/path override')
  return rawUrl
}

function safeReason(error) {
  if (error instanceof BlockedError || error?.name === 'AssertionError') return error.message
  return 'Playwright ทำงานไม่สำเร็จ; ไม่บันทึก raw page/error เพื่อป้องกันข้อมูลรั่วไหล'
}

// ────────────────────────────────────────────────────────────── page helpers ──

async function waitForApp(page, milliseconds = 1_200) {
  await page.waitForTimeout(milliseconds)
}

function pathnameOf(page) {
  return new URL(page.url()).pathname
}

async function navigateClientSide(page, route) {
  await page.evaluate((nextRoute) => {
    window.history.pushState({}, '', nextRoute)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, route)
  await waitForApp(page)
  return pathnameOf(page)
}

async function isVisible(locator) {
  return await locator.count() > 0 && await locator.first().isVisible()
}

function phoneModal(page) {
  return page.getByRole('heading', { name: PHONE_MODAL_HEADING, exact: true })
}

function nameModal(page) {
  return page.getByRole('heading', { name: NAME_MODAL_HEADING, exact: true })
}

/** ปิดกล่องเตือนโปรไฟล์ที่ค้างอยู่ด้วยการกด "ข้ามไปก่อน" คืนค่าว่าเจอกล่องหรือไม่ */
async function dismissProfileReminders(page) {
  let sawReminder = false
  // ชื่อมาก่อนเบอร์เสมอ (AppShell render แบบ if/else) จึงต้องวนมากกว่าหนึ่งรอบ
  for (let round = 0; round < 2; round += 1) {
    if (!await isVisible(phoneModal(page)) && !await isVisible(nameModal(page))) break
    sawReminder = true
    const skip = page.getByRole('button', { name: SKIP_BUTTON, exact: true })
    if (!await isVisible(skip)) {
      throw new BlockedError('กล่องเตือนโปรไฟล์ไม่มีปุ่ม "ข้ามไปก่อน" (บัญชีนี้อยู่ในโหมดบังคับกรอก)')
    }
    await skip.first().click()
    await waitForApp(page, 600)
  }
  return sawReminder
}

async function assertNoProfileReminder(page, context) {
  assert.equal(await isVisible(phoneModal(page)), false, `กล่อง "${PHONE_MODAL_HEADING}" เด้งซ้ำหลังกดข้าม ที่ ${context}`)
  assert.equal(await isVisible(nameModal(page)), false, `กล่อง "${NAME_MODAL_HEADING}" เด้งซ้ำหลังกดข้าม ที่ ${context}`)
}

async function loginAs(page, alias) {
  const password = process.env.DEMO_TEST_PASSWORD
  await navigateClientSide(page, '/profile')
  if (!['/auth', '/admin/login'].includes(pathnameOf(page))) return

  await navigateClientSide(page, '/auth')
  const form = page.locator('form').filter({ has: page.locator('input[autocomplete="current-password"]') }).first()
  await form.locator('input[autocomplete="email"]').fill(`${alias}@smartlocal.test`)
  const passwordInput = form.locator('input[autocomplete="current-password"]')
  if (password) {
    await passwordInput.fill(password)
  } else if (!await passwordInput.evaluate((input) => input.value.length > 0)) {
    throw new BlockedError(`ไม่พบ DEMO_TEST_PASSWORD และ Chrome ไม่ได้เติมรหัสให้ ${alias}`)
  }
  await form.locator('button[type="submit"]').click()
  try {
    await page.waitForFunction(() => !['/auth', '/admin/login'].includes(window.location.pathname), null, { timeout: 20_000 })
  } catch {
    throw new BlockedError(`login ${alias} ไม่สำเร็จ (ไม่บันทึกรายละเอียด credential)`)
  }
  await waitForApp(page)
}

/**
 * เปิด browser context หนึ่งบัญชี พร้อมเก็บ console error ไว้ตรวจเรื่อง Telegram
 * ใช้ persistent profile ชุดเดียวกับ negative-authorization runner
 */
async function withAccount(alias, profile, baseUrl, headed, fn) {
  const profileDir = path.join(PROFILE_ROOT, `TEST-${profile}`)
  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: !headed,
      viewport: { width: 1440, height: 900 },
    })
  } catch {
    throw new BlockedError(`เปิด TEST-${profile} ไม่สำเร็จ; ปิด Chrome Profile นี้ก่อนรันซ้ำ`)
  }

  const consoleErrors = []
  try {
    const page = context.pages()[0] || await context.newPage()
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      // เก็บเฉพาะ pattern ที่ตรวจ ไม่เก็บข้อความ console ทั้งหมด (อาจมีข้อมูลของผู้ใช้ปนมา)
      if (TELEGRAM_ERROR_PATTERN.test(message.text())) consoleErrors.push('telegram-notification-failed')
    })
    page.on('pageerror', (error) => {
      if (TELEGRAM_ERROR_PATTERN.test(error?.message ?? '')) consoleErrors.push('telegram-notification-failed')
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
    await waitForApp(page, 1_800)
    await loginAs(page, alias)
    return await fn(page, consoleErrors)
  } finally {
    await context.close()
  }
}

// ─────────────────────────────────────────────────────────────────── checks ──

/** ข้อ 4: หน้า /auth ของสนามซ้อมต้องไม่ยืมชื่อ อปท. จริงมาแสดง */
async function checkAuthBranding(baseUrl, headed) {
  let context
  try {
    context = await chromium.launch({ channel: 'chrome', headless: !headed })
  } catch {
    throw new BlockedError('เปิด Chrome ไม่สำเร็จ')
  }
  try {
    const page = await context.newPage()
    await page.goto(`${baseUrl}/auth`, { waitUntil: 'domcontentloaded', timeout: 25_000 })
    await waitForApp(page, 2_000)
    const text = await page.evaluate(() => `${document.title}\n${document.body?.innerText || ''}`)
    assert.ok(text.includes(DEMO_TENANT_NAME), `หน้า /auth ไม่แสดงชื่อ "${DEMO_TENANT_NAME}"`)
    for (const foreign of FOREIGN_TENANT_NAMES) {
      assert.equal(text.includes(foreign), false, `หน้า /auth ของสนามซ้อมแสดงชื่อ อปท. จริง "${foreign}"`)
    }
  } finally {
    await context.close()
  }
}

/** ข้อ 3: ประชาชนกดข้ามกล่องเบอร์โทรครั้งเดียว แล้วเปลี่ยนหน้าได้โดยไม่โดนเด้งซ้ำ */
async function checkCitizenReminderDismissal(baseUrl, headed) {
  return withAccount('demo-citizen', 'citizen', baseUrl, headed, async (page) => {
    const sawReminder = await dismissProfileReminders(page)
    if (!sawReminder) {
      throw new BlockedError('บัญชี demo-citizen มีเบอร์/ชื่อครบแล้ว จึงไม่มีกล่องเตือนให้ทดสอบ')
    }
    for (const route of ['/complaint', '/my-complaints', '/more', '/profile', '/']) {
      await navigateClientSide(page, route)
      await assertNoProfileReminder(page, route)
    }
  })
}

/** ข้อ 3 (ต่อ): หลังบ้านต้องไม่ถูก overlay ของ onboarding ประชาชนบัง */
async function checkBackOfficeNotBlocked(baseUrl, headed) {
  return withAccount('demo-technician-2', 'technician-2', baseUrl, headed, async (page) => {
    const sawReminder = await dismissProfileReminders(page)
    if (!sawReminder) {
      // ไม่เจอกล่องเตือนตั้งแต่แรก = ทดสอบ "กดข้ามแล้วต้องไม่เด้งซ้ำ" ไม่ได้จริง
      // ต้องรายงาน BLOCKED ไม่ใช่ PASS ไม่งั้นเป็นผลลวงที่บอกว่าบั๊กถูกแก้แล้วทั้งที่ไม่เคยตรวจ
      throw new BlockedError('บัญชี demo-technician-2 มีเบอร์/ชื่อครบแล้ว จึงไม่มีกล่องเตือนให้ทดสอบ')
    }
    for (const route of ['/technician', '/staff', '/technician', '/profile']) {
      await navigateClientSide(page, route)
      await assertNoProfileReminder(page, route)
    }
  })
}

/**
 * ข้อ 1: หน้าช่างต้องไม่มีข้อความ/ปุ่มที่สื่อว่ารูปหลักฐานเป็นข้อบังคับ
 * และช่างต้องไม่มีปุ่มปิดเรื่องขั้นสุดท้าย (อำนาจของ admin เท่านั้น)
 */
async function checkTechnicianFinishAffordance(baseUrl, headed) {
  return withAccount('demo-technician-2', 'technician-2', baseUrl, headed, async (page) => {
    await dismissProfileReminders(page)
    await navigateClientSide(page, '/technician')
    assert.equal(pathnameOf(page), '/technician', 'demo-technician-2 เข้า /technician ไม่ได้')

    const bodyText = await page.evaluate(() => document.body?.innerText || '')
    assert.equal(
      bodyText.includes(PHOTO_MANDATORY_TEXT),
      false,
      `หน้าช่างยังมีข้อความ "${PHOTO_MANDATORY_TEXT}" ทั้งที่นโยบายคือรูปหลักฐานไม่บังคับ`,
    )

    const job = page.locator('button, tr').filter({ hasText: TEST_MARKER }).first()
    if (!await isVisible(job)) {
      throw new BlockedError(`ไม่มีงาน "${TEST_MARKER}" ในคิวของช่าง — รันด้วย --write ก่อนเพื่อสร้างงานทดสอบ`)
    }
    await job.click()
    await waitForApp(page, 800)

    const finishButton = page.getByRole('button', { name: /ปิดงาน/ }).first()
    if (await isVisible(finishButton)) {
      assert.equal(await finishButton.isEnabled(), true, 'ปุ่ม "ปิดงาน" ถูก disable ทั้งที่ไม่มีรูปก็ปิดงานได้ตามนโยบาย')
    }
    const finalClose = page.getByRole('button', { name: /^ปิดเรื่อง$/ })
    assert.equal(await isVisible(finalClose), false, 'ช่างเห็นปุ่ม "ปิดเรื่อง" ซึ่งเป็นอำนาจของ admin เท่านั้น')
  })
}

// ───────────────────────────────────────────────────────── write-path (opt-in) ──

/** citizen: สร้างคำร้องหมวดไฟฟ้าสาธารณะ คืนเลขที่อ้างอิง */
async function createTestComplaint(page) {
  await navigateClientSide(page, '/complaint')
  await dismissProfileReminders(page)
  const category = page.getByText('ไฟฟ้าสาธารณะ', { exact: false }).first()
  if (!await isVisible(category)) throw new BlockedError('ไม่พบหมวด "ไฟฟ้าสาธารณะ" บนหน้าเลือกหมวด')
  await category.click()
  await waitForApp(page, 1_200)

  const detail = page.locator('textarea').first()
  if (!await isVisible(detail)) throw new BlockedError('ไม่พบช่องรายละเอียดในแบบฟอร์มคำร้อง')
  await detail.fill(TEST_DETAIL)

  const location = page.getByPlaceholder('สถานที่').first()
  if (await isVisible(location)) await location.fill(TEST_LOCATION)
  const phone = page.getByPlaceholder('เบอร์ติดต่อ *').first()
  if (await isVisible(phone)) await phone.fill(TEST_PHONE)

  await page.getByRole('button', { name: 'ส่งคำร้อง', exact: true }).first().click()
  await waitForApp(page, 600)
  const accept = page.getByRole('button', { name: 'ยอมรับและส่ง', exact: true }).first()
  if (!await isVisible(accept)) throw new BlockedError('ไม่พบ consent modal ก่อนส่งคำร้อง (PDPA gate หาย)')
  await accept.click()

  await page.getByRole('heading', { name: 'ส่งคำร้องสำเร็จ!', exact: true }).waitFor({ timeout: 25_000 })
  const bodyText = await page.evaluate(() => document.body?.innerText || '')
  const match = bodyText.match(/\b[A-Z]{2}-\d{2}-\d{4}\b/)
  if (!match) throw new BlockedError('ส่งคำร้องสำเร็จแต่หาเลขที่อ้างอิงบนหน้าจอไม่เจอ')
  return match[0]
}

/** เปิดคำร้องตามเลขที่อ้างอิงแล้วกดปุ่มที่ระบุ ใช้ร่วมกันทั้งฝั่ง admin และช่าง */
async function actOnComplaint(page, refNo, buttonName) {
  const row = page.locator('button, tr').filter({ hasText: refNo }).first()
  if (!await isVisible(row)) throw new BlockedError(`ไม่พบคำร้อง ${refNo} ในรายการของหน้านี้`)
  await row.click()
  await waitForApp(page, 900)
  const button = page.getByRole('button', { name: buttonName }).first()
  if (!await isVisible(button)) throw new BlockedError(`ไม่พบปุ่ม "${buttonName}" ของคำร้อง ${refNo}`)
  await button.click()
  await waitForApp(page, 1_500)
}

async function runWriteWorkflow(baseUrl, headed, telegramErrors) {
  const refNo = await withAccount('demo-citizen', 'citizen', baseUrl, headed, async (page, errors) => {
    const created = await createTestComplaint(page)
    telegramErrors.push(...errors)
    return created
  })

  await withAccount('demo-admin', 'admin', baseUrl, headed, async (page, errors) => {
    await dismissProfileReminders(page)
    await navigateClientSide(page, '/admin')
    await actOnComplaint(page, refNo, /^รับเรื่อง$/)
    telegramErrors.push(...errors)
  })

  await withAccount('demo-technician-2', 'technician-2', baseUrl, headed, async (page, errors) => {
    await dismissProfileReminders(page)
    await navigateClientSide(page, '/technician')
    await actOnComplaint(page, refNo, /เริ่มดำเนินการ/)
    // ปิดงานโดยไม่แนบรูป = พฤติกรรมที่ถูกต้องตามนโยบายปัจจุบัน
    await actOnComplaint(page, refNo, /ปิดงาน/)
    const finalClose = page.getByRole('button', { name: /^ปิดเรื่อง$/ })
    assert.equal(await isVisible(finalClose), false, 'ช่างเห็นปุ่ม "ปิดเรื่อง" ซึ่งเป็นอำนาจของ admin เท่านั้น')
    telegramErrors.push(...errors)
  })

  await withAccount('demo-admin', 'admin', baseUrl, headed, async (page, errors) => {
    await dismissProfileReminders(page)
    await navigateClientSide(page, '/admin')
    await actOnComplaint(page, refNo, /^ปิดเรื่อง$/)
    telegramErrors.push(...errors)
  })

  await withAccount('demo-citizen', 'citizen', baseUrl, headed, async (page, errors) => {
    await dismissProfileReminders(page)
    await navigateClientSide(page, '/my-complaints')
    const bodyText = await page.evaluate(() => document.body?.innerText || '')
    assert.ok(bodyText.includes(refNo), `ประชาชนไม่เห็นคำร้อง ${refNo} ในหน้าติดตาม`)
    assert.ok(bodyText.includes('ปิดเรื่องแล้ว'), `คำร้อง ${refNo} ไม่ได้แสดงสถานะ "ปิดเรื่องแล้ว"`)
    telegramErrors.push(...errors)
  })

  return refNo
}

// ─────────────────────────────────────────────────────────────────────── main ──

async function writeResults(results, baseUrl, mode) {
  const counts = {
    PASS: results.filter(({ status }) => status === 'PASS').length,
    FAIL: results.filter(({ status }) => status === 'FAIL').length,
    BLOCKED: results.filter(({ status }) => status === 'BLOCKED').length,
  }
  const lines = [
    'SmartLocal Complaint Workflow Regression',
    `Timestamp: ${new Date().toISOString()}`,
    `Base URL: ${baseUrl}`,
    `Mode: ${mode}`,
    'Credentials/tokens/page data: never logged',
    '',
    ...results.map(({ name, status, reason }) => `${status} ${name}: ${reason}`),
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
  const results = []
  const telegramErrors = []

  const checks = [
    { name: 'auth-branding', reason: 'หน้า /auth แสดงชื่อสนามซ้อมและไม่มีชื่อ อปท. จริง', run: () => checkAuthBranding(baseUrl, args.headed) },
    { name: 'citizen-reminder-once', reason: 'ประชาชนกดข้ามกล่องเบอร์โทรแล้วไม่เด้งซ้ำข้ามหน้า', run: () => checkCitizenReminderDismissal(baseUrl, args.headed) },
    { name: 'backoffice-not-blocked', reason: 'ช่างเข้าหลังบ้านได้โดยไม่ถูกกล่อง onboarding บัง', run: () => checkBackOfficeNotBlocked(baseUrl, args.headed) },
    { name: 'technician-finish-affordance', reason: 'ปุ่มปิดงานไม่ผูกกับรูปหลักฐาน และช่างไม่มีปุ่มปิดเรื่อง', run: () => checkTechnicianFinishAffordance(baseUrl, args.headed) },
  ]

  if (args.write) {
    checks.unshift({
      name: 'full-workflow',
      reason: 'new → received → in_progress → done → closed ครบตามอำนาจของแต่ละ role',
      run: async () => {
        const refNo = await runWriteWorkflow(baseUrl, args.headed, telegramErrors)
        process.stdout.write(`INFO สร้างคำร้องทดสอบ ${refNo} ค้างไว้ในสนามซ้อม (ลบเองภายหลังได้)\n`)
      },
    })
  }

  for (const check of checks) {
    try {
      const collected = await check.run()
      if (Array.isArray(collected)) telegramErrors.push(...collected)
      results.push({ name: check.name, status: 'PASS', reason: check.reason })
    } catch (error) {
      results.push({
        name: check.name,
        status: error instanceof BlockedError ? 'BLOCKED' : 'FAIL',
        reason: safeReason(error),
      })
    }
  }

  // ข้อ 2: ตรวจรวมท้ายสุด — สนามซ้อมไม่ได้ผูกกลุ่ม Telegram จึงต้องไม่มี console error สักครั้ง
  // notifyTelegram() ถูกเรียกเฉพาะตอน "เปลี่ยนสถานะคำร้อง" โหมด read-only ไม่แตะสถานะเลย
  // ผลว่าง = ไม่มีอะไรให้ตรวจ ไม่ใช่ผ่าน ต้องรายงาน BLOCKED เพื่อไม่ให้เข้าใจผิดว่าบั๊กนี้ถูกยืนยันแล้ว
  if (telegramErrors.length > 0) {
    results.push({ name: 'no-telegram-console-error', status: 'FAIL', reason: `พบ console error เรื่อง Telegram ${telegramErrors.length} ครั้ง` })
  } else if (results.find(({ name }) => name === 'full-workflow')?.status === 'PASS') {
    // ต้องเช็คว่า workflow "รันจบจริง" ไม่ใช่แค่มี --write — รอบที่ workflow BLOCKED ตั้งแต่ login
    // ไม่มีการเปลี่ยนสถานะสักครั้ง ผลว่างจึงไม่ได้แปลว่าแจ้งเตือนทำงานถูก
    results.push({ name: 'no-telegram-console-error', status: 'PASS', reason: 'workflow เต็มรอบไม่มี console error เรื่องแจ้งเตือน Telegram' })
  } else {
    results.push({
      name: 'no-telegram-console-error',
      status: 'BLOCKED',
      reason: args.write
        ? 'workflow ไม่ได้รันจนจบ จึงไม่มีการเปลี่ยนสถานะให้ยิงแจ้งเตือน'
        : 'ต้องรันด้วย --write ถึงจะมีการเปลี่ยนสถานะให้ยิงแจ้งเตือน',
    })
  }

  const counts = await writeResults(results, baseUrl, args.write ? 'read-write (--write)' : 'read-only')
  if (counts.FAIL > 0) process.exitCode = 1
  else if (counts.BLOCKED > 0) process.exitCode = 2
}

main().catch(async (error) => {
  const reason = safeReason(error)
  await writeFile(LOG_PATH, `FAIL test-setup: ${reason}\nSUMMARY PASS=0 FAIL=1 BLOCKED=0\n`, 'utf8')
  process.stderr.write(`FAIL test-setup: ${reason}\nSUMMARY PASS=0 FAIL=1 BLOCKED=0\n`)
  process.exitCode = 1
})
