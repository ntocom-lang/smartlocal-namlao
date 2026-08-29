import assert from 'node:assert/strict'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const ROOT_DIR = process.cwd()
const BASE_URL = (process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')
const MATRIX_PATH = path.join(ROOT_DIR, 'docs', 'testing', 'TEST_ROLE_MATRIX.md')
const LOG_PATH = path.join(ROOT_DIR, 'test-results.log')
const PROFILE_ROOT = path.join(ROOT_DIR, '.chrome-test-profiles')
const ACTION_PATTERN = /(ลบ|แก้ไข|delete|edit)/i

class BlockedError extends Error {}

const roleCases = [
  {
    alias: 'test-viewer',
    role: 'viewer',
    profileDir: path.join(PROFILE_ROOT, 'TEST-viewer'),
    forbiddenRoutes: [],
    accessibleRoutes: ['/admin', '/staff', '/events/manage', '/data-center/staff'],
    forbiddenAdminMenus: [
      'ประเภทคำร้อง', 'สายด่วน', 'สถานที่เกิดเหตุ', 'ค่าธรรมเนียม', 'ยานพาหนะ',
      'ตั้งค่าระบบ', 'จัดการผู้ใช้และการแต่งตั้ง', 'บันทึกกิจกรรม',
    ],
  },
  {
    alias: 'test-council',
    role: 'council',
    profileDir: path.join(PROFILE_ROOT, 'TEST-council'),
    forbiddenRoutes: ['/admin'],
    accessibleRoutes: ['/staff', '/events/manage', '/data-center/staff'],
    forbiddenAdminMenus: [],
  },
]

function pathnameOf(page) {
  return new URL(page.url()).pathname
}

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function navigateAuthenticated(page, route) {
  try {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.waitForTimeout(800)
  } catch {
    throw new BlockedError(`เปิด ${route} ไม่สำเร็จ: local app ไม่พร้อมหรือ session ใช้งานไม่ได้`)
  }

  const currentPath = pathnameOf(page)
  if (currentPath === '/auth' || currentPath === '/admin/login') {
    throw new BlockedError(`Chrome Profile ยังไม่ได้ล็อกอินสำหรับ ${route}`)
  }
  return currentPath
}

async function countVisibleEnabled(locator) {
  const count = await locator.count()
  let actionableCount = 0
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index)
    if (await item.isVisible() && await item.isEnabled()) actionableCount += 1
  }
  return actionableCount
}

async function assertNoDestructiveActions(page, alias, route) {
  const buttonCount = await countVisibleEnabled(page.getByRole('button', { name: ACTION_PATTERN }))
  const linkCount = await countVisibleEnabled(page.getByRole('link', { name: ACTION_PATTERN }))
  assert.equal(
    buttonCount + linkCount,
    0,
    `${alias} พบปุ่ม/ลิงก์ลบหรือแก้ไขที่กดได้บน ${route}`,
  )
}

async function assertForbiddenAdminMenus(page, alias, menuLabels) {
  for (const label of menuLabels) {
    const visibleCount = await countVisibleEnabled(page.getByRole('button', { name: label, exact: true }))
    assert.equal(visibleCount, 0, `${alias} เห็นเมนูจัดการที่ต้องถูกซ่อน: ${label}`)
  }
}

async function runRoleCase(roleCase) {
  if (!await pathExists(roleCase.profileDir)) {
    throw new BlockedError(`ไม่พบ Chrome Profile ${path.basename(roleCase.profileDir)}`)
  }

  let context
  try {
    context = await chromium.launchPersistentContext(roleCase.profileDir, {
      channel: 'chrome',
      headless: true,
      viewport: { width: 1440, height: 900 },
    })
  } catch {
    throw new BlockedError(`เปิด Chrome Profile ${path.basename(roleCase.profileDir)} ไม่สำเร็จ; ให้ปิด Chrome Profile นี้ก่อนรันซ้ำ`)
  }

  try {
    const pages = context.pages()
    const page = pages[0] || await context.newPage()

    for (const route of roleCase.forbiddenRoutes) {
      const currentPath = await navigateAuthenticated(page, route)
      assert.notEqual(currentPath, route, `${roleCase.alias} เข้าถึง route ต้องห้าม ${route}`)
    }

    for (const route of roleCase.accessibleRoutes) {
      const currentPath = await navigateAuthenticated(page, route)
      assert.equal(currentPath, route, `${roleCase.alias} ถูก redirect ออกจาก route ที่ใช้ตรวจ ${route}`)
      await assertNoDestructiveActions(page, roleCase.alias, route)
      if (route === '/admin') {
        await assertForbiddenAdminMenus(page, roleCase.alias, roleCase.forbiddenAdminMenus)
      }
    }
  } finally {
    await context.close()
  }
}

function safeReason(error) {
  if (error instanceof BlockedError || error?.name === 'AssertionError') return error.message
  return 'Playwright ทำงานไม่สำเร็จ; ไม่บันทึก raw page/error เพื่อป้องกันข้อมูลส่วนบุคคลรั่วไหล'
}

async function main() {
  const matrix = await readFile(MATRIX_PATH, 'utf8')
  for (const { alias, role } of roleCases) {
    const matrixRowPattern = new RegExp(`\\|\\s*\`${alias}\`\\s*\\|[^\\n]*\`${role}\``)
    assert.match(matrix, matrixRowPattern, `Role Matrix ไม่มี mapping ${alias} -> ${role}`)
  }

  const results = []
  for (const roleCase of roleCases) {
    try {
      await runRoleCase(roleCase)
      results.push({ alias: roleCase.alias, status: 'PASS', reason: 'ไม่พบปุ่มลบ/แก้ไขที่มองเห็นและกดได้บน route ที่ตรวจ' })
    } catch (error) {
      results.push({
        alias: roleCase.alias,
        status: error instanceof BlockedError ? 'BLOCKED' : 'FAIL',
        reason: safeReason(error),
      })
    }
  }

  const counts = {
    PASS: results.filter((result) => result.status === 'PASS').length,
    FAIL: results.filter((result) => result.status === 'FAIL').length,
    BLOCKED: results.filter((result) => result.status === 'BLOCKED').length,
  }
  const lines = [
    `Negative Authorization Playwright Test`,
    `Timestamp: ${new Date().toISOString()}`,
    `Matrix: docs/testing/TEST_ROLE_MATRIX.md`,
    `Base URL: ${BASE_URL}`,
    `Scope: visible+enabled delete/edit controls; no destructive click, screenshot, trace, password, token, or page data logged`,
    '',
    ...results.map((result) => `${result.status} ${result.alias}: ${result.reason}`),
    '',
    `SUMMARY PASS=${counts.PASS} FAIL=${counts.FAIL} BLOCKED=${counts.BLOCKED}`,
  ]

  await mkdir(path.dirname(LOG_PATH), { recursive: true })
  await writeFile(LOG_PATH, `${lines.join('\n')}\n`, 'utf8')
  process.stdout.write(`${lines.join('\n')}\n`)

  if (counts.FAIL > 0) process.exitCode = 1
  else if (counts.BLOCKED > 0) process.exitCode = 2
}

main().catch(async (error) => {
  const lines = [
    'Negative Authorization Playwright Test',
    `Timestamp: ${new Date().toISOString()}`,
    `FAIL test-setup: ${safeReason(error)}`,
    '',
    'SUMMARY PASS=0 FAIL=1 BLOCKED=0',
  ]
  await writeFile(LOG_PATH, `${lines.join('\n')}\n`, 'utf8')
  process.stderr.write(`${lines.join('\n')}\n`)
  process.exitCode = 1
})
