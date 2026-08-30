// E2E: กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)
// เจตนา: ประชาชนตอบคำถาม + ปักหมุด → เจ้าหน้าที่กดรับทราบเท่านั้น
//        ผู้บริหารเห็นคำตอบและพิกัดบนแผนที่เพื่อประกอบการตัดสินใจ
//
// ยิงได้เฉพาะ https://demo.rk-networks.com
// ข้อมูลที่สร้างต้องขึ้นต้น [TEST] · เบอร์ 0000000000 · พิกัดใช้จุดกลางเทศบาล ไม่ใช้ GPS จริง
// ห้าม log credential/token/เนื้อหาหน้าเว็บดิบ

import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, navigateClientSide as settleAndNavigate, reloadIfServiceWorkerUpdated, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.test.local')
const LOG_PATH = path.join(ROOT_DIR, 'test-results-odor.log')
const PROFILE_ROOT = path.join(ROOT_DIR, '.chrome-test-profiles')
const DEFAULT_BASE_URL = 'https://demo.rk-networks.com'

const TEST_MARKER = '[TEST] E2E odor'
// ตารางของผู้รับผิดชอบ (OdorComplaintTable) แสดงแค่ สถานที่/วันที่/เวลา/ความรุนแรง/อาการ/สถานะ
// ไม่มีเลขที่คำร้องและไม่มีรายละเอียด — การหาแถวด้วย ref_no หรือ TEST_MARKER จึงไม่มีวันเจอ
// (เคยทำให้ staff-ack ขึ้น BLOCKED ทั้งที่คำร้องถูกมอบหมายถูกต้อง) ใช้ "สถานที่" ที่ไม่ซ้ำต่อรอบ
// เป็นตัวชี้แถวแทน — ไม่ซ้ำกับรอบก่อนๆ ที่อาจยังค้างอยู่ในแท็ป "รอรับทราบ"
const RUN_ID = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
const TEST_LOCATION = `[TEST] จุดจำลอง E2E-${RUN_ID} ไม่ใช่สถานที่จริง`
const TEST_DETAIL = `${TEST_MARKER} — กลิ่นเหม็นจำลอง ไม่ใช่เหตุจริง ห้ามลงพื้นที่`
const TEST_PHONE = '0000000000'
const TEST_FIRST_NAME = '[TEST]ผู้ทดสอบ'
const TEST_LAST_NAME = 'กลิ่นเหม็น'
const ODOR_LABEL = 'กลิ่นเหม็นรบกวน'

// ผู้รับผิดชอบของสายงานนี้ต้องเป็นบัญชีเดียวกันทุกครั้ง ไม่งั้นเคส "ผู้ไม่รับผิดชอบมองไม่เห็น"
// จะกลายเป็นการเดา — uuid มาจาก supabase/seed_demo_accounts.sql (demo-technician-2)
const ACK_STAFF_ID = '0de00000-0000-4000-8000-000000000006'
const ACK_STAFF_LABEL = '[TEST] ช่างไฟฟ้า สำนักปลัด'
const ACK_ACCOUNT = { alias: 'demo-technician-2', profile: 'technician-2', route: '/technician' }
// บัญชีเจ้าหน้าที่คนละกอง/ไม่ใช่ผู้รับผิดชอบ ใช้พิสูจน์ว่าหมวดเฉพาะกิจไม่รั่วไปหาเพื่อนร่วมงาน
const OTHER_STAFF_ACCOUNT = { alias: 'demo-staff', profile: 'staff', route: '/staff' }
// hostname demo.rk-networks.com → slug 'demo' (ดู detectTenantSlug ใน src/contexts/TenantContext.jsx)
const TENANT_SLUG = 'demo'

// คีย์ที่ห้ามหลุดออกทางหมุดแผนที่ของผู้บริหารเด็ดขาด — ตรวจทั้งชื่อคีย์และเนื้อหาที่รู้ว่าเป็น PII ของเคสนี้
const PII_PIN_KEYS = ['detail', 'subject', 'phone', 'reporter_name', 'user_id', 'village']
const ALLOWED_PIN_ANSWER_KEYS = [
  'odor_intensity', 'odor_time_range', 'wind_direction', 'health_effect', 'acknowledged',
]

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

  // anon key เป็นค่าสาธารณะโดยธรรมชาติ (ฝังอยู่ใน JS bundle ของทุกหน้าเว็บอยู่แล้ว) จึงอ่านจาก
  // .env.local ได้ตรงๆ — ใช้ยิง RPC ระดับ API เพื่อพิสูจน์เคสที่ UI พิสูจน์แทนไม่ได้:
  // "คนไม่ล็อกอินเห็นอะไรบ้าง" และ "ผู้บริหารได้ payload หน้าตาแบบไหนจริงๆ"
  // ไม่มีการ log ค่าเหล่านี้หรือ access token ที่ดึงจากเบราว์เซอร์ที่ใดในไฟล์นี้
  for (const envPath of [path.join(ROOT_DIR, '.env.local'), path.join(ROOT_DIR, '.env')]) {
    try {
      const env = parseEnv(await readFile(envPath, 'utf8'))
      if (!process.env.VITE_SUPABASE_URL && env.VITE_SUPABASE_URL) process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL
      if (!process.env.VITE_SUPABASE_ANON_KEY && env.VITE_SUPABASE_ANON_KEY) process.env.VITE_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

function supabaseConfig() {
  const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!url || !anonKey) {
    throw new BlockedError('ไม่พบ VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY (.env.local) จึงตรวจสิทธิ์ระดับ API ไม่ได้')
  }
  return { url, anonKey }
}

// token = access token ของผู้ใช้ที่ล็อกอินอยู่ (ไม่ส่ง = สิทธิ์ anon ล้วน)
async function supabaseFetch(pathname, { token = null, method = 'GET', body = null } = {}) {
  const { url, anonKey } = supabaseConfig()
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token || anonKey}`,
    'Content-Type': 'application/json',
  }
  if (method === 'PATCH') headers.Prefer = 'return=representation'
  const response = await fetch(`${url}${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  })
  let payload = null
  try { payload = await response.json() } catch { payload = null }
  return { status: response.status, ok: response.ok, payload }
}

async function fetchTenantId() {
  const { status, payload } = await supabaseFetch(
    `/rest/v1/municipalities?slug=eq.${TENANT_SLUG}&select=id`)
  const id = Array.isArray(payload) ? payload[0]?.id : null
  if (!id) throw new BlockedError(`หา municipality ของสนามซ้อมไม่เจอ (HTTP ${status})`)
  return id
}

// อ่าน access token ของ session ที่เบราว์เซอร์ถืออยู่ — เก็บไว้ใน memory ของ runner เท่านั้น
async function readAccessToken(page) {
  const token = await page.evaluate(() => {
    // supabase-js เก็บ session ได้ทั้ง localStorage และ sessionStorage (ดู rememberAwareStorage
    // ใน src/lib/supabase.js) และบางรุ่นเก็บเป็นสตริง base64- นำหน้า จึงต้องรองรับทั้ง 4 ทาง
    const decode = (raw) => {
      if (!raw) return null
      const text = raw.startsWith('base64-') ? atob(raw.slice(7)) : raw
      try { return JSON.parse(text) } catch { return null }
    }
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index)
        if (!key || !/^sb-.*-auth-token$/.test(key)) continue
        const parsed = decode(store.getItem(key))
        const value = parsed?.access_token ?? parsed?.currentSession?.access_token
        if (value) return value
      }
    }
    return null
  })
  if (!token) throw new BlockedError('อ่าน session token จากเบราว์เซอร์ไม่ได้')
  return token
}

function parseArgs(argv) {
  const result = { headed: false, write: false }
  for (const arg of argv) {
    if (arg === '--headed') result.headed = true
    else if (arg === '--write') result.write = true
    else if (arg === '--help') {
      process.stdout.write('Usage: node tests/odor-workflow.playwright.mjs [--headed] [--write]\n')
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
  assert.equal(parsed.protocol, 'https:', 'Odor runner accepts HTTPS only')
  assert.equal(parsed.hostname, 'demo.rk-networks.com', 'Odor runner refuses every tenant except demo.rk-networks.com')
  assert.equal(parsed.pathname, '/', 'PLAYWRIGHT_BASE_URL must not contain a tenant/path override')
  return rawUrl
}

function safeReason(error) {
  if (error instanceof BlockedError || error?.name === 'AssertionError') return error.message
  const firstLine = String(error?.message ?? error).split('\n')[0].trim()
  return `${error?.name ?? 'Error'}: ${firstLine.slice(0, 200)}`
}

const authStates = new WeakMap()

async function waitForApp(page, milliseconds = 1_200) {
  await page.waitForTimeout(milliseconds)
}

async function navigateClientSide(page, route) {
  return settleAndNavigate(page, authStates.get(page), route)
}

async function isVisible(locator) {
  return await locator.count() > 0 && await locator.first().isVisible()
}

async function bodyHas(page, text) {
  const body = await page.evaluate(() => document.body?.innerText || '')
  return body.includes(text)
}

async function dismissProfileReminders(page) {
  for (let round = 0; round < 2; round += 1) {
    const skip = page.getByRole('button', { name: 'ข้ามไปก่อน', exact: true })
    if (!await isVisible(skip)) break
    await skip.first().click()
    await waitForApp(page, 600)
  }
}

async function hasLiveSession(page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const current = await navigateClientSide(page, '/profile')
    if (current === '/profile') return true
    if (Date.now() >= deadline) return false
    await waitForApp(page, 700)
  }
}

async function loginAs(page, alias) {
  const password = process.env.DEMO_TEST_PASSWORD
  if (await hasLiveSession(page)) return
  await navigateClientSide(page, '/auth')
  const form = page.locator('form').filter({ has: page.locator('input[autocomplete="current-password"]') }).first()
  await form.locator('input[autocomplete="email"]').fill(`${alias}@smartlocal.test`)
  const passwordInput = form.locator('input[autocomplete="current-password"]')
  if (password) {
    await passwordInput.fill(password)
  } else {
    await waitForApp(page, 1_500)
    if (!await passwordInput.evaluate((input) => input.value.length > 0)) {
      throw new BlockedError(`ไม่พบ DEMO_TEST_PASSWORD และ Chrome ไม่ได้เติมรหัสให้ ${alias}`)
    }
  }
  await form.locator('button[type="submit"]').click()
  try {
    await page.waitForFunction(() => !['/auth', '/admin/login'].includes(window.location.pathname), null, { timeout: 20_000 })
  } catch {
    throw new BlockedError(`login ${alias} ไม่สำเร็จ`)
  }
  await waitForApp(page)
}

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
  try {
    const page = context.pages()[0] || await context.newPage()
    authStates.set(page, trackProfileResolution(page))
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
    await reloadIfServiceWorkerUpdated(page, baseUrl)
    await waitForSettled(page, authStates.get(page))
    await loginAs(page, alias)
    await dismissProfileReminders(page)
    return await fn(page)
  } finally {
    await context.close()
  }
}

async function openAdminCategories(page) {
  await navigateClientSide(page, '/admin')
  const heading = page.getByRole('heading', { name: 'จัดการประเภทคำร้อง' })
  if (!await isVisible(heading)) {
    const menu = page.locator('button:visible').filter({ hasText: /^ประเภทคำร้อง$/ }).first()
    if (!await isVisible(menu)) throw new BlockedError('ไม่พบเมนู "ประเภทคำร้อง"')
    await menu.click()
  }
  await heading.waitFor({ state: 'visible', timeout: 15_000 })
  const adhoc = page.locator('button:visible').filter({ hasText: /เฉพาะกิจ/ }).first()
  if (!await isVisible(adhoc)) throw new BlockedError('ไม่พบแท็บ "เฉพาะกิจ" ในหน้าประเภทคำร้อง')
  await adhoc.click()
  await waitForApp(page, 1_000)
}

function odorCategoryRow(page) {
  const desktop = page.locator('tr:visible').filter({ hasText: ODOR_LABEL })
  const mobile = page.locator('div.rounded-xl:visible').filter({ hasText: ODOR_LABEL })
  return desktop.or(mobile).first()
}

async function inspectCitizenForm(page) {
  await navigateClientSide(page, '/complaint?form=environment')
  await waitForApp(page, 2_000)
  const odorPill = page.locator('button:visible').filter({ hasText: ODOR_LABEL })
  return { formHasOdor: await odorPill.count() > 0 && await odorPill.first().isVisible() }
}

async function inspectAdminOdor(page) {
  await openAdminCategories(page)
  const row = odorCategoryRow(page)
  const exists = await isVisible(row)
  if (!exists) return { exists: false, active: false, hasAssignee: false, hasDepartment: false }
  // สวิตช์สถานะบอกค่าจริงผ่าน aria-checked (ของเดิมเป็นปุ่มที่เขียนว่า "เปิด"/"ปิด" ซึ่งอ่านได้
  // 2 ทาง ทั้งคนและเทสต์ — ดู CategoryActiveSwitch ใน src/pages/AdminDashboard.jsx)
  const toggle = row.getByRole('switch').first()
  const active = await isVisible(toggle) && await toggle.getAttribute('aria-checked') === 'true'
  const selects = row.locator('select:visible')
  const deptValue = await selects.count() > 0 ? await selects.nth(0).inputValue() : ''
  const assigneeValue = await selects.count() > 1 ? await selects.nth(1).inputValue() : ''
  return { exists: true, active, hasAssignee: Boolean(assigneeValue), hasDepartment: Boolean(deptValue) }
}

async function enableOdorIfNeeded(page, state) {
  await openAdminCategories(page)
  const row = odorCategoryRow(page)
  if (!await isVisible(row)) throw new BlockedError('สนามซ้อมไม่มีหมวดกลิ่นเหม็นรบกวนให้เปิด')

  const departmentSelect = row.locator('select').first()
  if (await departmentSelect.count()) {
    const currentDept = await departmentSelect.inputValue()
    if (!currentDept) {
      const health = departmentSelect.locator('option').filter({ hasText: /สาธารณสุข|สำนักปลัด/ }).first()
      if (!await health.count()) throw new BlockedError('ไม่พบกองสาธารณสุขหรือสำนักปลัดให้ผูกหมวด odor')
      await departmentSelect.selectOption({ value: await health.getAttribute('value') })
      await waitForApp(page, 1_200)
    }
  }

  // ผู้รับผิดชอบต้องเป็น demo-technician-2 เสมอ (ไม่ใช่ "ใครก็ได้ที่เจอในลิสต์") เพราะเคส
  // "ผู้ไม่รับผิดชอบมองไม่เห็น" ต้องรู้แน่ว่าใครคือคนที่ควรเห็น และใครคือคนที่ต้องไม่เห็น
  const assigneeSelect = row.locator('select').nth(1)
  if (!await assigneeSelect.count()) throw new BlockedError('ไม่พบช่องเลือกผู้รับผิดชอบของหมวด odor')
  if (await assigneeSelect.inputValue() !== ACK_STAFF_ID) {
    const target = assigneeSelect.locator(`option[value="${ACK_STAFF_ID}"]`)
    if (!await target.count()) {
      throw new BlockedError(`ไม่พบบัญชีผู้รับผิดชอบ ${ACK_STAFF_LABEL} ในลิสต์ (seed สนามซ้อมไม่ครบ)`)
    }
    await assigneeSelect.selectOption({ value: ACK_STAFF_ID })
    await waitForApp(page, 1_200)
  }

  if (!state.active) {
    const toggle = row.getByRole('switch').first()
    if (!await isVisible(toggle)) throw new BlockedError('ไม่พบสวิตช์เปิด/ปิดหมวด odor')
    if (await toggle.getAttribute('aria-checked') !== 'true') {
      await toggle.click()
      await waitForApp(page, 1_500)
    }
  }

  const after = await inspectAdminOdor(page)
  if (!after.active) throw new BlockedError('เปิดหมวด odor ไม่สำเร็จ (อาจยังไม่มีกองรับผิดชอบ)')
  return after
}

async function pinFallbackLocation(page) {
  const pin = page.locator('button:visible').filter({ hasText: /ปักหมุดจากแผนที่/ }).first()
  if (!await isVisible(pin)) throw new BlockedError('ไม่พบปุ่มปักหมุด')
  await pin.click()
  const confirm = page.getByRole('button', { name: 'ยืนยันตำแหน่ง' }).first()
  await confirm.waitFor({ state: 'visible', timeout: 20_000 })
  await confirm.click()
  await waitForApp(page, 800)
}

async function createOdorComplaint(page) {
  await navigateClientSide(page, '/complaint?form=environment')
  await waitForApp(page, 1_500)
  const odor = page.locator('button:visible').filter({ hasText: ODOR_LABEL }).first()
  if (!await isVisible(odor)) throw new BlockedError('ประชาชนไม่เห็นหมวดกลิ่นเหม็นรบกวน — หมวดยังถูกปิดอยู่')
  await odor.click()
  await waitForApp(page, 600)

  for (const [placeholder, value] of [['ชื่อ *', TEST_FIRST_NAME], ['นามสกุล *', TEST_LAST_NAME]]) {
    const field = page.getByPlaceholder(placeholder).first()
    if (await isVisible(field) && !(await field.inputValue()).trim()) await field.fill(value)
  }

  const timeRange = page.locator('select:visible').filter({ has: page.locator('option[value="morning"]') }).first()
  if (!await isVisible(timeRange)) throw new BlockedError('ไม่พบช่องช่วงเวลาที่ได้กลิ่น')
  await timeRange.selectOption('morning')

  const intensity = page.locator('select:visible').filter({ has: page.locator('option[value="3"]') }).first()
  if (!await isVisible(intensity)) throw new BlockedError('ไม่พบช่องระดับความรุนแรง')
  await intensity.selectOption('3')

  const wind = page.locator('select:visible').filter({ has: page.locator('option[value="เหนือ"]') }).first()
  if (!await isVisible(wind)) throw new BlockedError('ไม่พบช่องทิศทางลม')
  await wind.selectOption('เหนือ')

  const detail = page.locator('textarea:visible').first()
  await detail.fill(TEST_DETAIL)

  const location = page.getByPlaceholder('สถานที่').first()
  if (await isVisible(location)) await location.fill(TEST_LOCATION)
  const phone = page.getByPlaceholder('เบอร์ติดต่อ *').first()
  if (await isVisible(phone)) await phone.fill(TEST_PHONE)

  await pinFallbackLocation(page)

  const submit = page.locator('button:visible').filter({ hasText: /ส่งเรื่องแจ้งกลิ่นเหม็น|ส่งคำร้อง/ }).first()
  if (!await isVisible(submit)) throw new BlockedError('ไม่พบปุ่มส่งคำร้องกลิ่นเหม็น')
  await submit.click()
  await waitForApp(page, 600)
  const accept = page.getByRole('button', { name: 'ยอมรับและส่ง', exact: true }).first()
  if (!await isVisible(accept)) throw new BlockedError('ไม่พบ consent modal ก่อนส่งคำร้อง')
  await accept.click()
  await page.getByRole('heading', { name: 'ส่งคำร้องสำเร็จ!', exact: true }).waitFor({ timeout: 25_000 })
  const bodyText = await page.evaluate(() => document.body?.innerText || '')
  const match = bodyText.match(/\b[A-Z]{2}-\d{2}-\d{4}\b/)
  if (!match) throw new BlockedError('ส่งสำเร็จแต่หาเลขที่อ้างอิงไม่เจอ')
  return match[0]
}

// ผู้รับผิดชอบ: ต้องเห็นข้อมูลครบ (ชื่อผู้แจ้ง เบอร์ติดต่อ คำตอบ พิกัด) แล้วกด "รับทราบ" ครั้งเดียวจบ
// คืน access token กลับไปให้ main() ใช้ตรวจ 2 เคสที่ UI ตรวจแทนไม่ได้: กดรับทราบซ้ำ และการยิง
// PATCH เปลี่ยน status ตรงผ่าน PostgREST
async function staffAcknowledge(page, refNo) {
  await navigateClientSide(page, ACK_ACCOUNT.route)
  await waitForApp(page, 2_000)
  const panel = page.locator('div:visible').filter({ hasText: 'เฉพาะกิจ: กลิ่นเหม็นรบกวน' }).first()
  if (!await isVisible(panel)) {
    throw new BlockedError(`ผู้รับผิดชอบไม่เห็นแผงรับทราบ odor (คำร้อง ${refNo} อาจยังไม่ถูก assign)`)
  }
  const row = page.locator('tr:visible, div[class*="cursor-pointer"]:visible')
    .filter({ hasText: TEST_LOCATION }).first()
  if (!await isVisible(row)) {
    throw new BlockedError(`ไม่พบคำร้อง ${refNo} ในแผงรับทราบ (หาจากสถานที่ ${TEST_LOCATION})`)
  }
  await row.click()
  await waitForApp(page, 1_500)

  // "เห็นข้อมูลครบ" = คำตอบเชิงวิเคราะห์ + ข้อมูลติดต่อผู้แจ้ง (ผู้รับผิดชอบต้องโทรกลับได้)
  // ชื่อผู้แจ้งมาจากโปรไฟล์ของบัญชีที่ล็อกอินยื่น (ฟอร์มเติมให้อัตโนมัติถ้ามีในโปรไฟล์) จึงตรวจว่า
  // "มีชื่อผู้แจ้งแสดงอยู่" ไม่ใช่ตรวจว่าตรงกับชื่อที่เทสต์พิมพ์ — ของเดิมทำให้ FAIL ทั้งที่ข้อมูลครบ
  if (await bodyHas(page, 'ไม่ระบุชื่อผู้แจ้ง')) {
    throw new Error('ผู้รับผิดชอบเปิดรายละเอียดแล้วไม่เห็นชื่อผู้แจ้งเลย')
  }
  const missing = []
  for (const [label, needle] of [
    ['ผู้แจ้ง', 'ผู้แจ้ง:'],
    ['เบอร์ติดต่อ', TEST_PHONE],
    ['ระดับความรุนแรง', 'ระดับความรุนแรง'],
    ['ทิศทางลม', 'ทิศทางลม'],
    ['พิกัดที่ปักหมุด', 'พิกัดที่ปักหมุด'],
  ]) {
    if (!await bodyHas(page, needle)) missing.push(label)
  }
  if (missing.length > 0) {
    throw new Error(`ผู้รับผิดชอบเปิดรายละเอียดแล้วแต่ไม่เห็น: ${missing.join(', ')}`)
  }

  const ack = page.getByRole('button', { name: 'รับทราบ', exact: true }).first()
  if (!await isVisible(ack)) throw new BlockedError('ไม่พบปุ่มรับทราบ')
  await ack.click()
  await waitForApp(page, 2_000)
  if (await isVisible(ack)) throw new Error('กดรับทราบแล้วปุ่มยังอยู่ — สถานะไม่ขยับ')
  return await readAccessToken(page)
}

// ผู้ที่ไม่ได้ถูกมอบหมาย: ต้องไม่เห็นคำร้องนี้เลยทั้งทาง UI และทาง API ตรง
async function assertOtherStaffBlind(page, complaintId, refNo) {
  await navigateClientSide(page, OTHER_STAFF_ACCOUNT.route)
  await waitForApp(page, 2_500)
  if (await bodyHas(page, refNo) || await bodyHas(page, TEST_MARKER) || await bodyHas(page, TEST_LOCATION)) {
    throw new Error(`เจ้าหน้าที่ที่ไม่ใช่ผู้รับผิดชอบเห็นคำร้อง ${refNo} บนหน้าจอ`)
  }
  const token = await readAccessToken(page)
  const { payload } = await supabaseFetch(
    `/rest/v1/complaints?id=eq.${complaintId}&select=id,detail,phone`, { token })
  if (Array.isArray(payload) && payload.length > 0) {
    throw new Error('เจ้าหน้าที่ที่ไม่ใช่ผู้รับผิดชอบอ่านคำร้องเฉพาะกิจผ่าน REST ได้')
  }
  const pins = await supabaseFetch('/rest/v1/rpc/data_center_unified_pins', {
    token, method: 'POST', body: { _municipality_id: await fetchTenantId() },
  })
  const leaked = Array.isArray(pins.payload)
    && pins.payload.some((pin) => pin.source_id === complaintId)
  if (leaked) throw new Error('หมุดคำร้องเฉพาะกิจโผล่ให้เจ้าหน้าที่ที่ไม่ใช่ผู้รับผิดชอบ')
}

async function inspectViewerMap(page) {
  // '/data-center' เป็นหน้า landing ให้เลือกสาธารณะ/เจ้าหน้าที่ ไม่ใช่ตัวแผนที่ — ผู้บริหารต้องเข้า
  // '/data-center/staff' (RequireAuth staffOnly) ถึงจะได้แผนที่ที่มีตัวกรองสถานะและแท็บ "เฉพาะกิจ"
  await navigateClientSide(page, '/data-center/staff')
  await waitForApp(page, 2_500)
  // หน้านี้เปิดมาที่โมดูลรายการก่อน ต้องกด "แผนที่ GIS" ถึงจะได้ DataCenterMap ที่มีตัวกรองสถานะ
  const mapModule = page.locator('button:visible').filter({ hasText: 'แผนที่ GIS' }).first()
  if (!await isVisible(mapModule)) throw new BlockedError('ผู้บริหารไม่พบเมนู "แผนที่ GIS" ในศูนย์ข้อมูล')
  await mapModule.click()
  await waitForApp(page, 3_000)
  const adhoc = page.locator('button:visible').filter({ hasText: 'เฉพาะกิจ' }).first()
  const hasAdhocTab = await isVisible(adhoc)
  if (hasAdhocTab) {
    await adhoc.click()
    await waitForApp(page, 1_500)
  }
  // แผงสรุปเปิดมาที่แท็บ "ศูนย์ข้อมูลดิจิทัล" เสมอ — หมุดคำร้องขึ้นบนแผนที่แล้วแต่รายชื่อหมวดอยู่ใน
  // แท็บ "คำร้อง" ต้องกดก่อนถึงจะมีข้อความให้ตรวจได้ (หมุดบน Google Maps ไม่ใช่ DOM text)
  // ใช้ accessible name ไม่ใช่ hasText: ปุ่มมีไอคอน + ข้อความคนละบรรทัด ทำให้ regex ^คำร้อง$ ไม่ match
  const complaintTab = page.getByRole('button', { name: 'คำร้อง', exact: true }).first()
  if (await complaintTab.count()) {
    await complaintTab.click()
    await waitForApp(page, 2_000)
  }
  return {
    hasAdhocTab,
    hasOdorText: await bodyHas(page, ODOR_LABEL) || await bodyHas(page, 'odor'),
    // หน้าจอผู้บริหารต้องไม่มีข้อความที่ประชาชนพิมพ์เองหรือข้อมูลติดต่อโผล่ที่ไหนเลย
    leakedPii: (await bodyHas(page, TEST_DETAIL)) || (await bodyHas(page, TEST_PHONE))
      || (await bodyHas(page, TEST_FIRST_NAME)),
    token: await readAccessToken(page),
  }
}

// หมุดของคำร้องนี้ตามที่ role หนึ่งๆ มองเห็นจริงผ่าน RPC (ระดับ API ไม่ผ่านการเรนเดอร์ของ UI)
async function pinForComplaint(token, tenantId, complaintId) {
  const { status, payload } = await supabaseFetch('/rest/v1/rpc/data_center_unified_pins', {
    token, method: 'POST', body: { _municipality_id: tenantId },
  })
  if (!Array.isArray(payload)) {
    throw new BlockedError(`เรียก data_center_unified_pins ไม่สำเร็จ (HTTP ${status})`)
  }
  return payload.find((pin) => pin.source_id === complaintId) ?? null
}

// เคส PDPA ของข้อนี้ทั้งหมด: ผู้บริหารต้องได้ "ข้อมูลวิเคราะห์" แต่ต้องไม่ได้ข้อมูลระบุตัวบุคคล
function describeViewerPinProblems(pin) {
  if (!pin) return ['ผู้บริหารไม่เห็นหมุดของคำร้องนี้เลย']
  const problems = []
  if (pin.latitude == null || pin.longitude == null) problems.push('ไม่มีพิกัด')
  if (!pin.created_at) problems.push('ไม่มีวันเวลา')
  for (const key of PII_PIN_KEYS) {
    if (pin[key] != null) problems.push(`มีฟิลด์ ${key}`)
  }
  const serialized = JSON.stringify(pin)
  for (const [label, needle] of [['รายละเอียด', TEST_DETAIL], ['เบอร์โทร', TEST_PHONE], ['ชื่อผู้แจ้ง', TEST_FIRST_NAME]]) {
    if (serialized.includes(needle)) problems.push(`payload มี${label}`)
  }
  const answers = pin.extra_data
  if (!answers || typeof answers !== 'object') {
    problems.push('ไม่มีคำตอบ structured ให้วิเคราะห์')
  } else {
    const unexpected = Object.keys(answers).filter((key) => !ALLOWED_PIN_ANSWER_KEYS.includes(key))
    if (unexpected.length > 0) problems.push(`extra_data มีคีย์นอก whitelist: ${unexpected.join(',')}`)
    for (const key of ['odor_intensity', 'odor_time_range', 'wind_direction']) {
      if (answers[key] == null) problems.push(`extra_data ขาด ${key}`)
    }
  }
  return problems
}

async function appendLog(results) {
  const lines = [
    'SmartLocal Odor Playwright Test',
    `Timestamp: ${new Date().toISOString()}`,
    'Base URL: https://demo.rk-networks.com',
    'Credentials/tokens/page data: never logged',
    '',
    ...results.map((item) => `${item.status} ${item.step}: ${item.reason}`),
    '',
    `SUMMARY PASS=${results.filter((item) => item.status === 'PASS').length} FAIL=${results.filter((item) => item.status === 'FAIL').length} BLOCKED=${results.filter((item) => item.status === 'BLOCKED').length}`,
    '',
  ]
  await writeFile(LOG_PATH, lines.join('\n'), 'utf8')
}

async function main() {
  await loadLocalTestEnv()
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = resolveBaseUrl()
  const results = []

  const record = (step, status, reason) => {
    results.push({ step, status, reason })
    process.stdout.write(`${status} ${step}: ${reason}\n`)
  }

  try {
    const citizen = await withAccount('demo-citizen', 'citizen', baseUrl, args.headed, inspectCitizenForm)
    record('citizen-form', citizen.formHasOdor ? 'PASS' : 'BLOCKED',
      citizen.formHasOdor
        ? 'ประชาชนเห็นหมวดกลิ่นเหม็นรบกวนในฟอร์มสิ่งแวดล้อม'
        : 'หมวดกลิ่นเหม็นรบกวนถูกซ่อนจากฟอร์มประชาชน — สนามซ้อมปิด is_active ตาม seed')

    const admin = await withAccount('demo-admin', 'admin', baseUrl, args.headed, inspectAdminOdor)
    record('admin-category', admin.exists ? (admin.active ? 'PASS' : 'BLOCKED') : 'FAIL',
      admin.exists
        ? `หมวดมีอยู่ active=${admin.active} dept=${admin.hasDepartment} assignee=${admin.hasAssignee}`
        : 'แอดมินไม่พบหมวดกลิ่นเหม็นรบกวนในแท็บเฉพาะกิจ')

    if (!args.write) {
      record('write-workflow', 'BLOCKED', 'รันแบบอ่านอย่างเดียว ไม่เปิดหมวดและไม่สร้างคำร้อง — ใช้ --write เพื่อทดสอบจนจบ')
      await appendLog(results)
      process.exitCode = results.some((item) => item.status !== 'PASS') ? 1 : 0
      return
    }

    const enabled = await withAccount('demo-admin', 'admin', baseUrl, args.headed, (page) => enableOdorIfNeeded(page, admin))
    record('enable-odor', enabled.active ? 'PASS' : 'FAIL',
      `เปิดหมวดแล้ว active=${enabled.active} assignee=${enabled.hasAssignee}`)

    const refNo = await withAccount('demo-citizen', 'citizen', baseUrl, args.headed, createOdorComplaint)
    record('citizen-submit', 'PASS', `สร้างคำร้อง ${refNo} พร้อมคำถามและหมุดกลางเทศบาล`)

    const tenantId = await fetchTenantId()

    // แอดมินเป็นทางเดียวที่อ่านแถวคำร้องได้เต็ม ใช้เป็น "ผู้สังเกตการณ์" ของเทสต์ทั้งชุด
    const adminToken = await withAccount('demo-admin', 'admin', baseUrl, args.headed, async (page) => {
      await navigateClientSide(page, '/admin')
      await waitForApp(page, 1_200)
      return await readAccessToken(page)
    })

    const readComplaint = async () => {
      const { status, payload } = await supabaseFetch(
        `/rest/v1/complaints?ref_no=eq.${encodeURIComponent(refNo)}&select=id,status,assigned_to,category,latitude,longitude,extra_data`,
        { token: adminToken })
      const row = Array.isArray(payload) ? payload[0] : null
      if (!row) throw new BlockedError(`แอดมินอ่านคำร้อง ${refNo} ไม่ได้ (HTTP ${status})`)
      return row
    }

    const submitted = await readComplaint()
    const complaintId = submitted.id
    record('auto-assign',
      submitted.assigned_to === ACK_STAFF_ID ? 'PASS' : 'FAIL',
      submitted.assigned_to === ACK_STAFF_ID
        ? `คำร้องถูกมอบหมายให้ ${ACK_STAFF_LABEL} อัตโนมัติตั้งแต่ตอนยื่น`
        : `คำร้องไม่ได้ถูกมอบหมายให้ ${ACK_STAFF_LABEL} (assigned_to=${submitted.assigned_to ?? 'ว่าง'})`)
    record('submit-validation',
      (submitted.latitude != null && submitted.extra_data?.odor_intensity != null
        && submitted.extra_data?.odor_time_range && submitted.extra_data?.wind_direction) ? 'PASS' : 'FAIL',
      `บันทึกพิกัดและคำตอบครบ intensity=${submitted.extra_data?.odor_intensity ?? '-'} range=${submitted.extra_data?.odor_time_range ?? '-'}`)

    let ackToken = null
    try {
      ackToken = await withAccount(ACK_ACCOUNT.alias, ACK_ACCOUNT.profile, baseUrl, args.headed,
        (page) => staffAcknowledge(page, refNo))
      record('staff-ack', 'PASS', `ผู้รับผิดชอบเห็นข้อมูลครบและกดรับทราบ ${refNo} ครั้งเดียว`)
    } catch (error) {
      record('staff-ack', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
    }

    if (ackToken) {
      // กดรับทราบซ้ำ: ต้องไม่ error และต้องไม่ทับเวลา/ผู้รับทราบของครั้งแรก
      try {
        const after = await readComplaint()
        const firstAckAt = after.extra_data?.acknowledged_at ?? null
        const again = await supabaseFetch('/rest/v1/rpc/acknowledge_odor_complaint', {
          token: ackToken, method: 'POST', body: { p_complaint_id: complaintId },
        })
        const afterSecond = await readComplaint()
        const unchanged = firstAckAt && afterSecond.extra_data?.acknowledged_at === firstAckAt
        record('ack-idempotent', (again.ok && again.payload?.already === true && unchanged) ? 'PASS' : 'FAIL',
          unchanged
            ? 'กดรับทราบซ้ำได้ผลลัพธ์ already=true และเวลาเดิมไม่ถูกทับ'
            : `กดรับทราบซ้ำแล้วข้อมูลเปลี่ยน (HTTP ${again.status})`)
        record('ack-identity',
          afterSecond.extra_data?.acknowledged_by === ACK_STAFF_ID ? 'PASS' : 'FAIL',
          `ผู้รับทราบที่บันทึกในฐานข้อมูล = ${afterSecond.extra_data?.acknowledged_by ?? 'ไม่มี'}`)
        record('status-untouched', afterSecond.status === 'pending' ? 'PASS' : 'FAIL',
          `สถานะหลังรับทราบ = ${afterSecond.status} (ต้องเป็น pending)`)
      } catch (error) {
        record('ack-idempotent', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
      }

      // ผู้รับผิดชอบยิง PATCH ตรงผ่าน PostgREST เปลี่ยนสถานะ/หมวด — ต้องถูก trigger ปฏิเสธ
      try {
        const patchStatus = await supabaseFetch(`/rest/v1/complaints?id=eq.${complaintId}`, {
          token: ackToken, method: 'PATCH', body: { status: 'closed' },
        })
        const patchCategory = await supabaseFetch(`/rest/v1/complaints?id=eq.${complaintId}`, {
          token: ackToken, method: 'PATCH', body: { category: 'other', latitude: 0, longitude: 0 },
        })
        const current = await readComplaint()
        const blocked = !patchStatus.ok && !patchCategory.ok
          && current.status === 'pending' && current.category === 'odor' && current.latitude !== 0
        record('direct-update-blocked', blocked ? 'PASS' : 'FAIL',
          blocked
            ? 'ผู้รับผิดชอบแก้สถานะ/หมวด/พิกัดผ่าน API ตรงไม่ได้ (ถูก trigger ปฏิเสธ)'
            : `API ตรงยังแก้ข้อมูลหลักได้ (status=${patchStatus.status}, category=${patchCategory.status})`)
      } catch (error) {
        record('direct-update-blocked', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
      }
    }

    try {
      await withAccount(OTHER_STAFF_ACCOUNT.alias, OTHER_STAFF_ACCOUNT.profile, baseUrl, args.headed,
        (page) => assertOtherStaffBlind(page, complaintId, refNo))
      record('non-assigned-blind', 'PASS', 'เจ้าหน้าที่ที่ไม่ใช่ผู้รับผิดชอบไม่เห็นคำร้องนี้ทั้งบนหน้าจอ REST และหมุดแผนที่')
    } catch (error) {
      record('non-assigned-blind', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
    }

    try {
      const adminPin = await pinForComplaint(adminToken, tenantId, complaintId)
      record('admin-map-pin', adminPin ? 'PASS' : 'FAIL',
        adminPin ? 'แอดมินเห็นหมุดคำร้องกลิ่นเหม็นบนแผนที่' : 'แอดมินไม่เห็นหมุดของคำร้องนี้')
    } catch (error) {
      record('admin-map-pin', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
    }

    try {
      await withAccount('demo-admin', 'admin', baseUrl, args.headed, async (page) => {
        await navigateClientSide(page, '/staff')
        const menu = page.locator('button:visible').filter({ hasText: /^คำร้อง(\s|$)/ }).first()
        if (!await isVisible(menu)) throw new BlockedError('ไม่พบเมนูคำร้อง')
        await menu.click()
        await waitForApp(page, 2_000)
        const adhoc = page.locator('button:visible').filter({ hasText: /เฉพาะกิจ/ }).first()
        if (!await isVisible(adhoc)) throw new BlockedError('แอดมินไม่เห็นแท็บเฉพาะกิจหลังมีคำร้อง odor')
        await adhoc.click()
        await waitForApp(page, 1_200)
        const receive = page.locator('button:visible').filter({ hasText: /^รับเรื่อง$/ }).first()
        const close = page.locator('button:visible').filter({ hasText: /^ปิดเรื่อง$/ }).first()
        if (await isVisible(receive) || await isVisible(close)) {
          throw new BlockedError('แท็บเฉพาะกิจยังมีปุ่มรับเรื่อง/ปิดเรื่อง ซึ่งไม่ควรมีในสายงานนี้')
        }
      })
      record('admin-no-status-pipeline', 'PASS', 'แอดมินเห็นแท็บเฉพาะกิจ และไม่มีปุ่มรับเรื่อง/ปิดเรื่อง')
    } catch (error) {
      record('admin-no-status-pipeline', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
    }

    try {
      const map = await withAccount('demo-viewer', 'viewer', baseUrl, args.headed, inspectViewerMap)
      record('executive-map', map.hasOdorText ? 'PASS' : 'FAIL',
        map.hasAdhocTab
          ? (map.hasOdorText ? 'ผู้บริหารเห็นหมุด/ข้อความกลิ่นเหม็นบนแผนที่' : 'มีแท็บเฉพาะกิจแต่ผู้บริหารไม่เห็นข้อมูล odor')
          : 'ผู้บริหารไม่มีแท็บเฉพาะกิจและไม่เห็นกลิ่นเหม็นบนแผนที่')

      const viewerPin = await pinForComplaint(map.token, tenantId, complaintId)
      const problems = describeViewerPinProblems(viewerPin)
      record('executive-pin-payload', problems.length === 0 ? 'PASS' : 'FAIL',
        problems.length === 0
          ? 'ผู้บริหารได้พิกัด+เวลา+คำตอบ structured ครบ และไม่มีฟิลด์ข้อมูลส่วนบุคคลเลย'
          : `payload ของผู้บริหารมีปัญหา: ${problems.join(', ')}`)
      record('executive-no-pii-onscreen', map.leakedPii ? 'FAIL' : 'PASS',
        map.leakedPii
          ? 'หน้าจอผู้บริหารมีข้อความรายละเอียด/เบอร์โทร/ชื่อผู้แจ้งโผล่ออกมา'
          : 'หน้าจอผู้บริหารไม่มีรายละเอียด เบอร์โทร หรือชื่อผู้แจ้งของคำร้องนี้')
    } catch (error) {
      record('executive-map', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
    }

    // คนไม่ล็อกอิน (anon key ที่หยิบจาก JS bundle ได้เสมอ) ต้องไม่เห็นหมุดคำร้องใดๆ ทั้งสิ้น
    try {
      const anonPins = await supabaseFetch('/rest/v1/rpc/data_center_unified_pins', {
        method: 'POST', body: { _municipality_id: tenantId },
      })
      const rows = Array.isArray(anonPins.payload) ? anonPins.payload : []
      const complaintRows = rows.filter((pin) => pin.source_table === 'complaints')
      const thisComplaint = rows.some((pin) => pin.source_id === complaintId)
      const anonAllTenants = await supabaseFetch('/rest/v1/rpc/data_center_unified_pins', {
        method: 'POST', body: { _municipality_id: null },
      })
      record('anon-map',
        (!thisComplaint && complaintRows.length === 0 && !anonAllTenants.ok) ? 'PASS' : 'FAIL',
        (!thisComplaint && complaintRows.length === 0 && !anonAllTenants.ok)
          ? 'ผู้ใช้ที่ไม่ล็อกอินไม่เห็นหมุดคำร้องเลย และขอข้ามเทศบาลไม่ได้'
          : `anon เห็นคำร้อง ${complaintRows.length} รายการ (คำร้องนี้=${thisComplaint}) / ขอข้ามเทศบาลได้=${anonAllTenants.ok}`)
    } catch (error) {
      record('anon-map', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
    }

    try {
      await withAccount('demo-citizen', 'citizen', baseUrl, args.headed, async (page) => {
        await navigateClientSide(page, '/my-complaints')
        await waitForApp(page, 2_000)
        const hasRef = await bodyHas(page, refNo.replace(/^[A-Z]+-/, '')) || await bodyHas(page, refNo)
        if (!hasRef) throw new BlockedError(`ประชาชนไม่พบคำร้อง ${refNo} ในหน้าติดตาม`)
        // เกณฑ์ผ่าน = ผู้แจ้งติดตามคำร้องของตัวเองได้ (ข้างบนตรวจไปแล้ว)
        // ส่วนคำว่าเห็น "รับทราบแล้ว" หรือไม่ ยังเป็นช่องว่างที่รู้ตัว: หมวดเฉพาะกิจไม่แตะ status
        // หน้าติดตามจึงยังโชว์ "คำร้องใหม่" ตลอด แม้ผู้รับผิดชอบจะรับทราบแล้ว — บันทึกไว้เป็นข้อมูล
        // ไม่ใช่ FAIL ปลอมและไม่ใช่ PASS ที่อ่านแล้วเข้าใจผิดว่าแก้แล้ว
        const showsAck = await bodyHas(page, 'รับทราบแล้ว')
        record('citizen-followup', 'PASS',
          showsAck
            ? `ประชาชนติดตาม ${refNo} ได้ และเห็นสถานะรับทราบแล้ว`
            : `ประชาชนติดตาม ${refNo} ได้ — หมายเหตุ: ยังโชว์สถานะ pipeline ปกติ ไม่มีคำว่า "รับทราบแล้ว" (ช่องว่างที่รู้ตัว)`)
      })
    } catch (error) {
      record('citizen-followup', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
    }
  } catch (error) {
    record('runner', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', safeReason(error))
  }

  await appendLog(results)
  process.exitCode = results.some((item) => item.status !== 'PASS') ? 1 : 0
}

main()
