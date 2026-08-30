import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, navigateClientSide, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const MATRIX_PATH = path.join(ROOT_DIR, 'docs', 'testing', 'TEST_ROLE_MATRIX.md')
const SEED_PATH = path.join(ROOT_DIR, 'supabase', 'seed_demo_accounts.sql')
const LOCAL_ENV_PATH = path.join(ROOT_DIR, '.env.test.local')
const LOG_PATH = path.join(ROOT_DIR, 'test-results.log')
const PROFILE_ROOT = path.join(ROOT_DIR, '.chrome-test-profiles')
const DEFAULT_BASE_URL = 'https://demo.rk-networks.com'
const DEMO_TENANT_NAME = 'เทศบาลตำบลสาธิต'
const CREDENTIAL_KEYS = ['DEMO_TEST_PASSWORD', 'DEMO_SUPERADMIN_PASSWORD']

// ข้อความที่ต้องมีจริงบนหน้านั้น ใช้พิสูจน์ว่า "เข้าถึงได้" หมายถึงหน้าเรนเดอร์จริง ไม่ใช่แค่ URL ตรง
// (RequireAuth คืน null = จอว่างโดย URL ไม่เปลี่ยน ถ้าดูแต่ pathname จะได้ PASS ปลอม)
// ต้องเป็นข้อความที่ "มองเห็นจริง" เท่านั้น หัวข้อ sr-only ใช้ไม่ได้ เพราะ innerText ไม่นับให้
// (เช่น <h2 class="sr-only">แผงควบคุมผู้ดูแลระบบ</h2> ของ /admin — ที่เห็นจริงคือ "แผงควบคุม ADMIN")
const ROUTE_MARKERS = {
  '/profile': 'ข้อมูลบัญชีของฉัน',
  '/staff': 'ระบบเจ้าหน้าที่',
  '/admin': 'แผงควบคุม ADMIN',
  '/technician': 'แผงควบคุมช่าง',
  '/fleet': 'ระบบยานพาหนะและเชื้อเพลิง',
}

const FLEET_DENIED_TEXT = 'ไม่มีสิทธิ์เข้าใช้ระบบ'
const FLEET_MENU_LABEL = 'ยานพาหนะ/น้ำมัน'

// role ที่ matrix ระบุว่า "อ่านได้ แก้/ลบไม่ได้" ต้องไม่มี affordance ของการเขียนให้กดเลย
// (บทเรียนจาก defect P1 ของ Fleet: ปุ่มโผล่แล้วกดไปเจอ error ดิบจาก Postgres)
const DESTRUCTIVE_PATTERN = /(ลบ|แก้ไข|delete|edit)/i
const BACK_OFFICE_ROUTES = new Set(['/admin', '/staff'])
const ADMIN_MANAGEMENT_MENUS = [
  'ประเภทคำร้อง', 'สายด่วน', 'สถานที่เกิดเหตุ', 'ค่าธรรมเนียม', 'ยานพาหนะ',
  'ตั้งค่าระบบ', 'จัดการผู้ใช้และการแต่งตั้ง', 'บันทึกกิจกรรม',
]

const ROLE_CASES = [
  { alias: 'demo-superadmin', profile: 'superadmin', role: 'superadmin', required: ['/profile'], forbidden: [], fleetAccess: null, privilegedScopeSkipped: true },
  { alias: 'demo-admin', profile: 'admin', role: 'admin', required: ['/profile', '/admin', '/staff'], forbidden: ['/technician'], fleetAccess: true },
  { alias: 'demo-officer-eng', profile: 'officer', role: 'officer', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: true },
  { alias: 'demo-officer-fin', profile: 'officer-fin', role: 'officer', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: true },
  { alias: 'demo-officer-edu', profile: 'officer-edu', role: 'officer', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: true },
  { alias: 'demo-officer-audit', profile: 'officer-audit', role: 'officer', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: true },
  { alias: 'demo-staff', profile: 'staff', role: 'staff', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: false },
  { alias: 'demo-staff-edu', profile: 'staff-edu', role: 'staff', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: false },
  { alias: 'demo-staff-audit', profile: 'staff-audit', role: 'staff', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: false },
  { alias: 'demo-technician', profile: 'technician', role: 'technician', required: ['/profile', '/technician', '/staff'], forbidden: ['/admin'], fleetAccess: false },
  { alias: 'demo-technician-2', profile: 'technician-2', role: 'technician', required: ['/profile', '/technician', '/staff'], forbidden: ['/admin'], fleetAccess: false },
  { alias: 'demo-viewer', profile: 'viewer', role: 'viewer', required: ['/profile', '/admin', '/staff'], forbidden: ['/technician'], fleetAccess: true, readOnly: true },
  { alias: 'demo-council', profile: 'council', role: 'council', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: true, readOnly: true },
  { alias: 'demo-citizen', profile: 'citizen', role: 'citizen', required: ['/profile'], forbidden: ['/admin', '/staff', '/technician'], fleetAccess: false },
  { alias: 'demo-fleet-admin', profile: 'fleet-admin', role: 'staff', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: true },
  { alias: 'demo-fleet-staff', profile: 'fleet-staff', role: 'staff', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: true },
  { alias: 'demo-fleet-viewer', profile: 'fleet-viewer', role: 'staff', required: ['/profile', '/staff'], forbidden: ['/admin', '/technician'], fleetAccess: true },
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
    for (const key of CREDENTIAL_KEYS) {
      if (!process.env[key] && localEnv[key]) process.env[key] = localEnv[key]
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  // Claude/Codex ที่เปิดค้างไว้ก่อน `setx` จะไม่เห็น environment ใหม่ใน process เดิม
  // อ่านเฉพาะสอง key ที่อนุญาตจาก HKCU โดยตรงเป็น fallback และห้าม log ค่าที่อ่านได้
  if (process.platform === 'win32') {
    for (const key of CREDENTIAL_KEYS) {
      if (process.env[key]) continue
      try {
        const output = execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', key], {
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const match = output.match(new RegExp(`^\\s*${escapedKey}\\s+REG_\\w+\\s+(.+)$`, 'mi'))
        if (match?.[1]) process.env[key] = match[1].trim()
      } catch {
        // ไม่มีค่าใน Windows user environment ให้ใช้ session/autofill/.env.test.local ต่อไป
      }
    }
  }
}

function parseArgs(argv) {
  const result = { checkConfig: false, headed: false, roles: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check-config') result.checkConfig = true
    else if (arg === '--headed') result.headed = true
    else if (arg === '--roles') {
      result.roles = argv[++index]
      if (!result.roles) throw new Error('--roles requires a comma-separated value')
    }
    else if (arg.startsWith('--roles=')) result.roles = arg.slice('--roles='.length)
    else if (arg === '--help') {
      process.stdout.write([
        'Usage: npm run test:demo-roles -- [--check-config] [--headed] [--roles alias,...]',
        'Examples:',
        '  npm run test:demo-roles:check',
        '  npm run test:demo-roles -- --roles demo-admin,demo-technician',
        '',
      ].join('\n'))
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function selectRoleCases(rawSelection) {
  if (!rawSelection || rawSelection === 'all') return ROLE_CASES
  const requested = [...new Set(rawSelection.split(',').map((value) => value.trim()).filter(Boolean))]
  const selected = requested.map((name) => ROLE_CASES.find((roleCase) => roleCase.alias === name || roleCase.profile === name))
  const missing = requested.filter((_, index) => !selected[index])
  assert.equal(missing.length, 0, `Unknown demo role/profile: ${missing.join(', ')}`)
  return selected
}

function resolveBaseUrl() {
  const rawUrl = (process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  const parsed = new URL(rawUrl)
  assert.equal(parsed.protocol, 'https:', 'Demo runner accepts HTTPS only')
  assert.equal(parsed.hostname, 'demo.rk-networks.com', 'Demo runner refuses every tenant except demo.rk-networks.com')
  assert.equal(parsed.pathname, '/', 'PLAYWRIGHT_BASE_URL must not contain a tenant/path override')
  return rawUrl
}

async function validateConfiguration(selectedCases) {
  const [matrix, seed] = await Promise.all([
    readFile(MATRIX_PATH, 'utf8'),
    readFile(SEED_PATH, 'utf8'),
  ])
  assert.equal(ROLE_CASES.length, 17, 'Demo role matrix must contain exactly 17 accounts')
  assert.equal(new Set(ROLE_CASES.map(({ alias }) => alias)).size, ROLE_CASES.length, 'Demo aliases must be unique')
  assert.equal(new Set(ROLE_CASES.map(({ profile }) => profile)).size, ROLE_CASES.length, 'Chrome profile names must be unique')
  for (const roleCase of ROLE_CASES) {
    assert.match(roleCase.alias, /^demo-[a-z0-9-]+$/, `Unsafe alias: ${roleCase.alias}`)
    assert.ok(matrix.includes(`\`${roleCase.alias}\``), `Role Matrix is missing ${roleCase.alias}`)
    assert.ok(seed.includes(`'${roleCase.alias}'`), `Demo seed is missing ${roleCase.alias}`)
  }
  assert.ok(selectedCases.length > 0, 'At least one demo role must be selected')
}

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function assertDemoTenant(page) {
  const isDemo = await page.evaluate((expectedName) => {
    const text = `${document.title}\n${document.body?.innerText || ''}`
    return text.includes(expectedName)
  }, DEMO_TENANT_NAME)
  if (!isDemo) throw new BlockedError(`ไม่พบชื่อ tenant "${DEMO_TENANT_NAME}" บนหน้าเป้าหมาย`)
}

function passwordFor(roleCase) {
  return roleCase.role === 'superadmin'
    ? process.env.DEMO_SUPERADMIN_PASSWORD
    : process.env.DEMO_TEST_PASSWORD
}

async function loginWithLocalCredential(page, authState, roleCase) {
  const password = passwordFor(roleCase)
  await navigateClientSide(page, authState, '/auth')
  const form = page.locator('form').filter({ has: page.locator('input[autocomplete="current-password"]') }).first()
  const emailInput = form.locator('input[autocomplete="email"]')
  const passwordInput = form.locator('input[autocomplete="current-password"]')
  await emailInput.fill(`${roleCase.alias}@smartlocal.test`)
  if (password) {
    await passwordInput.fill(password)
  } else {
    // ตรวจแค่ว่า Chrome เติมค่าให้แล้วหรือยัง โดยไม่ดึงค่า password ออกจาก browser context
    const hasBrowserCredential = await passwordInput.evaluate((input) => input.value.length > 0)
    if (!hasBrowserCredential) {
      const key = roleCase.role === 'superadmin' ? 'DEMO_SUPERADMIN_PASSWORD' : 'DEMO_TEST_PASSWORD'
      throw new BlockedError(`session/Chrome autofill ไม่พร้อมและไม่พบ ${key} ใน environment/.env.test.local`)
    }
  }
  await form.locator('button[type="submit"]').click()

  try {
    await page.waitForFunction(() => !['/auth', '/admin/login'].includes(window.location.pathname), null, { timeout: 20_000 })
  } catch {
    throw new BlockedError(`login ${roleCase.alias} ไม่สำเร็จ (ไม่บันทึกรายละเอียด credential)`)
  }
  await waitForSettled(page, authState)
}

async function ensureAuthenticated(page, authState, roleCase) {
  const currentPath = await navigateClientSide(page, authState, '/profile')
  if (currentPath === '/auth' || currentPath === '/admin/login') {
    await loginWithLocalCredential(page, authState, roleCase)
  }
  const verifiedPath = await navigateClientSide(page, authState, '/profile')
  assert.equal(verifiedPath, '/profile', `${roleCase.alias} ไม่ผ่าน authenticated /profile smoke test`)
}

/**
 * รอข้อความบนหน้าจอแบบมีเพดานเวลา คืน true/false ไม่โยน
 *
 * หน้าหลังบ้านเกือบทุกหน้าโหลดผ่าน lazy() + Suspense ซึ่ง fallback เป็นวงกลมหมุนที่ "ไม่มี
 * ข้อความ" การเช็คครั้งเดียวทันทีหลังเปลี่ยน route จึงตกช่วงที่ chunk ยังโหลดไม่เสร็จ
 */
async function waitForText(page, text, timeout = 12_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await page.evaluate((needle) => (document.body?.innerText ?? '').includes(needle), text)) return true
    if (Date.now() >= deadline) return false
    await page.waitForTimeout(200)
  }
}

/** อยู่ที่ route จริง "และ" หน้านั้นเรนเดอร์เนื้อหาของตัวเองจริง — จอว่างต้องไม่นับเป็นผ่าน */
async function assertRequiredRoute(page, authState, roleCase, route) {
  const currentPath = await navigateClientSide(page, authState, route)
  assert.equal(currentPath, route, `${roleCase.alias} ถูก redirect ออกจาก route ที่ต้องเข้าได้ ${route}`)

  const marker = ROUTE_MARKERS[route]
  if (!marker) return
  assert.ok(
    await waitForText(page, marker),
    `${roleCase.alias} อยู่ที่ ${route} แต่หน้าไม่เรนเดอร์เนื้อหาของตัวเอง (ไม่พบ "${marker}")`,
  )
}

async function assertForbiddenRoute(page, authState, roleCase, route) {
  const currentPath = await navigateClientSide(page, authState, route)
  assert.notEqual(currentPath, route, `${roleCase.alias} เข้าถึง route ต้องห้าม ${route}`)
}

/** นับเฉพาะ control ที่ "มองเห็นและกดได้" — ปุ่มที่ถูกซ่อน/disable ไม่ใช่ช่องโหว่ */
async function countActionable(locator) {
  const total = await locator.count()
  let actionable = 0
  for (let index = 0; index < total; index += 1) {
    const item = locator.nth(index)
    if (await item.isVisible() && await item.isEnabled()) actionable += 1
  }
  return actionable
}

async function assertNoDestructiveActions(page, roleCase, route) {
  const buttons = await countActionable(page.getByRole('button', { name: DESTRUCTIVE_PATTERN }))
  const links = await countActionable(page.getByRole('link', { name: DESTRUCTIVE_PATTERN }))
  assert.equal(
    buttons + links,
    0,
    `${roleCase.alias} (สิทธิ์อ่านอย่างเดียว) พบปุ่ม/ลิงก์ลบหรือแก้ไขที่กดได้บน ${route}`,
  )
}

/**
 * ไม่มี fleet_role = ต้องไม่เห็นเมนูยานพาหนะในหน้าเจ้าหน้าที่ (TEST_ROLE_MATRIX ระบุไว้ตรงๆ
 * ที่ demo-staff) เมนูที่กดแล้วเจอ "ไม่มีสิทธิ์เข้าใช้ระบบ" คือ dead-end ไม่ใช่การกันสิทธิ์
 */
async function assertNoFleetMenu(page, roleCase) {
  const visible = await countActionable(page.getByRole('button', { name: FLEET_MENU_LABEL, exact: true }))
  assert.equal(visible, 0, `${roleCase.alias} ไม่มี fleet_role แต่ยังเห็นเมนู "${FLEET_MENU_LABEL}" ใน /staff`)
}

async function assertNoAdminManagementMenus(page, roleCase) {
  for (const label of ADMIN_MANAGEMENT_MENUS) {
    const visible = await countActionable(page.getByRole('button', { name: label, exact: true }))
    assert.equal(visible, 0, `${roleCase.alias} เห็นเมนูจัดการที่ต้องถูกซ่อน: ${label}`)
  }
}

async function assertFleetAccess(page, authState, roleCase) {
  if (roleCase.fleetAccess === null) return
  const currentPath = await navigateClientSide(page, authState, '/fleet')

  if (!roleCase.fleetAccess) {
    // ถูก redirect ออกไปเลย หรืออยู่ที่ /fleet แต่โดนปฏิเสธสิทธิ์ ถือว่าถูกทั้งคู่
    const denied = currentPath !== '/fleet' || await waitForText(page, FLEET_DENIED_TEXT)
    assert.ok(denied, `${roleCase.alias} ไม่มี fleet_role แต่เข้า /fleet ได้`)
    return
  }

  assert.equal(currentPath, '/fleet', `${roleCase.alias} ถูก redirect ออกจาก /fleet`)
  // ต้องรอให้ FleetPage เรนเดอร์จริงก่อน ไม่งั้น "ไม่เห็นข้อความปฏิเสธ" อาจแปลว่าหน้ายังไม่โหลด
  assert.ok(
    await waitForText(page, ROUTE_MARKERS['/fleet']),
    `${roleCase.alias} อยู่ที่ /fleet แต่หน้าไม่เรนเดอร์เนื้อหาของตัวเอง`,
  )
  const denialVisible = await page.evaluate(
    (needle) => (document.body?.innerText ?? '').includes(needle),
    FLEET_DENIED_TEXT,
  )
  assert.equal(denialVisible, false, `${roleCase.alias} มี fleet_role แต่ UI ปฏิเสธสิทธิ์`)
}

async function runRoleCase(roleCase, baseUrl, headed) {
  const profileDir = path.join(PROFILE_ROOT, `TEST-${roleCase.profile}`)
  if (!await pathExists(profileDir) && !passwordFor(roleCase)) {
    throw new BlockedError(`ไม่พบ TEST-${roleCase.profile} และไม่มี local credential สำหรับ bootstrap`)
  }

  let context
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: !headed,
      viewport: { width: 1440, height: 900 },
    })
  } catch {
    throw new BlockedError(`เปิด TEST-${roleCase.profile} ไม่สำเร็จ; ปิด Chrome Profile นี้ก่อนรันซ้ำ`)
  }

  try {
    const page = context.pages()[0] || await context.newPage()
    // ต้องดักก่อน goto เสมอ ไม่งั้น response ของ profiles รอบ boot หลุดไปก่อนติดตั้ง listener
    const authState = trackProfileResolution(page)
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
    await waitForSettled(page, authState)
    await assertDemoTenant(page)
    await ensureAuthenticated(page, authState, roleCase)

    for (const route of roleCase.required) {
      await assertRequiredRoute(page, authState, roleCase, route)
      if (route === '/staff' && roleCase.fleetAccess === false) await assertNoFleetMenu(page, roleCase)
      if (!roleCase.readOnly || !BACK_OFFICE_ROUTES.has(route)) continue
      await assertNoDestructiveActions(page, roleCase, route)
      if (route === '/admin') await assertNoAdminManagementMenus(page, roleCase)
    }

    for (const route of roleCase.forbidden) await assertForbiddenRoute(page, authState, roleCase, route)
    await assertFleetAccess(page, authState, roleCase)
  } finally {
    await context.close()
  }
}

function safeReason(error) {
  if (error instanceof BlockedError || error?.name === 'AssertionError') return error.message
  // บรรทัดแรกของ error จาก Playwright เป็นข้อความของ library (selector/timeout) ยังไม่มีเนื้อหาหน้าเว็บ
  // ส่วน call log บรรทัดถัดไปมี snippet ของ DOM จึงตัดทิ้งเสมอ — เหมือน complaint-workflow runner
  // ของเดิมกลบทั้งก้อนจนไล่สาเหตุไม่ได้เลย ต้องไปเขียนสคริปต์แยกทุกครั้งที่มี FAIL
  const firstLine = String(error?.message ?? error).split('\n')[0].trim()
  return `${error?.name ?? 'Error'}: ${firstLine.slice(0, 200)}`
}

async function writeResults(results, baseUrl) {
  const counts = {
    PASS: results.filter(({ status }) => status === 'PASS').length,
    FAIL: results.filter(({ status }) => status === 'FAIL').length,
    BLOCKED: results.filter(({ status }) => status === 'BLOCKED').length,
  }
  const lines = [
    'SmartLocal Demo Role Playwright Test',
    `Timestamp: ${new Date().toISOString()}`,
    `Base URL: ${baseUrl}`,
    'Scope: auth/profile + allowed/forbidden routes + Fleet access + read-only affordances; no create/update/delete click',
    'Credentials/tokens/page data: never logged',
    '',
    ...results.map(({ alias, status, reason }) => `${status} ${alias}: ${reason}`),
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
  const selectedCases = selectRoleCases(args.roles || process.env.DEMO_TEST_ROLES)
  const baseUrl = resolveBaseUrl()
  await validateConfiguration(selectedCases)

  if (args.checkConfig) {
    process.stdout.write(`PASS demo role runner config: ${ROLE_CASES.length} accounts; selected=${selectedCases.length}; target=${baseUrl}\n`)
    return
  }

  const results = []
  for (const roleCase of selectedCases) {
    try {
      await runRoleCase(roleCase, baseUrl, args.headed)
      const reason = roleCase.privilegedScopeSkipped
        ? 'auth/profile ผ่าน; ข้าม privileged cross-tenant modules ตาม safety gate'
        : `auth/route/Fleet matrix ผ่านสำหรับ role=${roleCase.role}`
      results.push({ alias: roleCase.alias, status: 'PASS', reason })
    } catch (error) {
      results.push({
        alias: roleCase.alias,
        status: error instanceof BlockedError ? 'BLOCKED' : 'FAIL',
        reason: safeReason(error),
      })
    }
  }

  const counts = await writeResults(results, baseUrl)
  if (counts.FAIL > 0) process.exitCode = 1
  else if (counts.BLOCKED > 0) process.exitCode = 2
}

main().catch(async (error) => {
  const reason = safeReason(error)
  await writeFile(LOG_PATH, `FAIL test-setup: ${reason}\nSUMMARY PASS=0 FAIL=1 BLOCKED=0\n`, 'utf8')
  process.stderr.write(`FAIL test-setup: ${reason}\nSUMMARY PASS=0 FAIL=1 BLOCKED=0\n`)
  process.exitCode = 1
})
