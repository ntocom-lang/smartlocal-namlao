// Regression test สำหรับ "ลบประเภทคำขอเอกสารออกจาก อปท. ได้" (PR #67) + คอลัมน์ "ที่" (PR #69)
//
// ครอบ acceptance criteria:
//   1. ปุ่มลบต้องขึ้นครบทุกแถว รวมประเภทมาตรฐาน (เดิมขึ้นเฉพาะประเภทที่ อปท. เพิ่มเอง)
//   2. คอลัมน์แรกหัวว่า "ที่" ตามแบบพิมพ์ราชการ และเลขเรียง 1..n ต่อเนื่องเสมอ
//      แม้ลบประเภทกลางตารางออก (เลขนับจากแถวที่แสดงจริง ไม่ใช่ตำแหน่งใน BASE_DOCUMENT_TYPES)
//   3. ลบแล้วบันทึก → ค่าลง fee_schedule._removed_types จริง โหลดหน้าใหม่ยังหาย
//      และมีแถบกู้คืนให้เอากลับมาได้
//   4. ประเภทที่ลบต้องหายจากหน้าแรกฝั่งประชาชน โดยประเภทอื่นยังอยู่ครบ (ไม่กรองเกินจำเป็น)
//   5. กดบันทึกแล้วต้องอยู่หน้าเดิมและเห็น "บันทึกสำเร็จ" — กันบั๊ก patchTenant ที่ทำให้
//      RequireAuth คืน null แล้วหน้าทั้งหน้า remount (PR #66) ถ้าใครเผลอใส่ `tenant` ทั้ง object
//      กลับเข้า deps ของ effect ใน AuthContext เทสต์ข้อนี้จะแดงทันที
//
// ⚠️ ข้อบังคับด้านความปลอดภัย/PDPA (เหมือน negative-authorization.playwright.mjs)
//   - ยิงได้เฉพาะสนามซ้อม demo.rk-networks.com หรือ dev server ในเครื่อง (VITE_TENANT_SLUG=demo)
//     hostname อื่น = ปฏิเสธทันที ห้ามยิงใส่ อปท. จริงเด็ดขาด
//   - ห้าม log credential/token/เนื้อหาหน้าเว็บดิบ ลง test-results ทุกกรณี
//   - ไม่สร้างข้อมูลประชาชนใดๆ โหมด --write แตะเฉพาะ "รายการประเภทคำขอ" ของสนามซ้อม
//
// โหมดการรัน
//   ค่าเริ่มต้น = read-only ตรวจข้อ 1, 2 และการเรียงเลขใหม่หลังกดลบ (กดลบแต่ไม่กดบันทึก
//                 จึงไม่แตะ DB เลย ทิ้ง draft ด้วยการโหลดหน้าใหม่)
//   --write     = ตรวจข้อ 3, 4, 5 เพิ่ม ซึ่ง "เขียน fee_schedule ของสนามซ้อมจริง" แล้ว
//                 กู้คืนกลับสภาพเดิมให้เสมอใน finally ต่อให้ assertion ระหว่างทางพัง
//   --headed    = เปิดหน้าต่างเบราว์เซอร์ให้ดูด้วยตา
//
// การล็อกอิน: ใช้ session ที่ค้างใน .chrome-test-profiles/TEST-admin กับ TEST-citizen
// (ไม่ต้องมีรหัสผ่าน) ถ้าโปรไฟล์หมดอายุจะรายงาน BLOCKED ไม่ใช่ FAIL

import assert from 'node:assert/strict'
import { writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, safeEvaluate, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const LOG_PATH = path.join(ROOT_DIR, 'test-results-doc-types.log')
const PROFILE_ROOT = path.join(ROOT_DIR, '.chrome-test-profiles')
const DEFAULT_BASE_URL = 'https://demo.rk-networks.com'
const SESSION_SOURCE_URL = 'https://demo.rk-networks.com'
const ALLOWED_HOSTS = new Set(['demo.rk-networks.com', 'localhost', '127.0.0.1'])

// ประเภทที่ใช้ทดสอบการลบ — เลือก waste_collection เพราะเป็นประเภทมาตรฐานที่ไม่มี wizard
// เฉพาะทางผูกอยู่ (ต่างจาก building_permit / waste_collection_request) ลบแล้วกู้คืนได้สะอาด
const TARGET_LABEL = 'ค่าธรรมเนียมขยะ'
const TARGET_VALUE = 'waste_collection'
// ประเภทกลางตาราง ใช้ทดสอบว่าเลขลำดับเรียงใหม่ต่อเนื่อง (กดลบแต่ไม่บันทึก)
const MIDDLE_LABEL = 'ค่าธรรมเนียม/ภาษี'

const CARD_HEADING = 'ประเภทคำขอเอกสารและผังงาน'
const RESTORE_STRIP = 'ประเภทที่ลบออกจากหน่วยงานนี้'
const SAVE_BUTTON = /^บันทึก(การเปลี่ยนแปลง)?$/
const DELETE_BUTTON = 'button[title*="ลบประเภทนี้"]'
const RESTORE_BUTTON = 'button[title="กู้คืนประเภทนี้"]'

function resolveBaseUrl() {
  const raw = (process.env.DOCTYPE_TEST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedError('DOCTYPE_TEST_BASE_URL ไม่ใช่ URL ที่ถูกต้อง')
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new BlockedError(`ปฏิเสธการยิงไปที่ ${url.hostname} — ทดสอบได้เฉพาะสนามซ้อมหรือ dev server ในเครื่อง`)
  }
  return url.origin
}

function parseArgs(argv) {
  return {
    write: argv.includes('--write'),
    headed: argv.includes('--headed'),
  }
}

async function pathExists(target) {
  try { await access(target); return true } catch { return false }
}

// localStorage แยกตาม origin — session ที่ค้างในโปรไฟล์เป็นของสนามซ้อม ไม่ใช่ของ localhost
// จึงต้องคัดเฉพาะคีย์ sb-* / sl-auth-remember มายัดใส่ dev server ก่อน goto ครั้งแรก
// token อยู่ใน memory ของ Node เท่านั้น ห้าม log ห้ามเขียนไฟล์เด็ดขาด
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

async function openProfile(profile, headed) {
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
  // กล่อง confirm ตอนลบประเภทมาตรฐาน — ตอบตกลงเสมอ ไม่งั้นเทสจะค้างที่ไดอะล็อก
  page.on('dialog', dialog => dialog.accept())
  return { context, page, auth: trackProfileResolution(page) }
}

/** เปิดแท็บ "ประเภทคำขอเอกสาร" ในหน้าแอดมิน (แท็บนี้ไม่มี URL ของตัวเอง ต้องคลิกเข้าไป) */
async function openDocTypeTab(session, baseUrl) {
  await session.page.goto(`${baseUrl}/admin`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await waitForSettled(session.page, session.auth)
  await session.page.getByRole('button', { name: 'ประเภทคำร้อง', exact: true }).first().click()
  await session.page.getByRole('button', { name: 'ประเภทคำขอเอกสาร', exact: true }).first().click()
  await session.page.getByText(CARD_HEADING).first().waitFor({ timeout: 20_000 })
  await session.page.waitForTimeout(1_500)
}

const rowOf = (page, label) => page.locator('tr').filter({ hasText: label }).first()

async function rowNumbers(page) {
  const cells = await page.locator('table tbody tr td:first-child').allTextContents()
  return cells.map(text => text.trim())
}

/** กดบันทึกแล้วรอ PATCH ของ municipalities — ใช้ response แทนข้อความบนจอ เพื่อไม่ผูกกับ UI */
async function saveAndWait(page) {
  const patched = page.waitForResponse(
    res => /\/rest\/v1\/municipalities/.test(res.url()) && res.request().method() === 'PATCH',
    { timeout: 30_000 })
  await page.getByRole('button', { name: SAVE_BUTTON }).first().click()
  const response = await patched
  await page.waitForTimeout(1_500)
  return response.status()
}

// ─────────────────────────────────────────────────────── read-only checks ──

// ปุ่มลบต้องมีครบทุกแถว — เดิมประเภทมาตรฐานไม่มีปุ่มเลย อปท. ที่ไม่ได้ให้บริการนั้นจึงเอาออกไม่ได้
async function checkDeleteButtonOnEveryRow(baseUrl, headed) {
  const session = await openProfile('admin', headed)
  try {
    await transferDemoSession(session.page, baseUrl)
    await openDocTypeTab(session, baseUrl)
    const rows = await session.page.locator('table tbody tr').count()
    const buttons = await session.page.locator(`table ${DELETE_BUTTON}`).count()
    assert.ok(rows >= 6, `ตารางควรมีอย่างน้อย 6 ประเภท แต่มี ${rows}`)
    assert.equal(buttons, rows, `ปุ่มลบมี ${buttons} ปุ่มแต่มี ${rows} แถว — ประเภทมาตรฐานต้องลบได้ด้วย`)
  } finally {
    await session.context.close()
  }
}

// หัวคอลัมน์ต้องเป็น "ที่" ตามแบบพิมพ์ราชการ ไม่ใช่ "ลำดับที่"
async function checkOrderColumn(baseUrl, headed) {
  const session = await openProfile('admin', headed)
  try {
    await transferDemoSession(session.page, baseUrl)
    await openDocTypeTab(session, baseUrl)
    const headers = (await session.page.locator('table thead th').allTextContents()).map(t => t.trim())
    assert.equal(headers[0], 'ที่', `หัวคอลัมน์แรกต้องเป็น "ที่" แต่ได้ "${headers[0]}"`)
    assert.equal(headers[1], 'ประเภทเอกสาร/บริการ', 'คอลัมน์ที่สองต้องเป็นชื่อประเภท')
    const numbers = await rowNumbers(session.page)
    const expected = numbers.map((_, i) => String(i + 1))
    assert.deepEqual(numbers, expected, `เลขลำดับต้องเรียง 1..${numbers.length} แต่ได้ ${numbers.join(',')}`)
  } finally {
    await session.context.close()
  }
}

// ลบประเภทกลางตาราง (ไม่กดบันทึก = ไม่แตะ DB) แล้วเลขต้องเรียงใหม่ต่อเนื่อง ไม่มีเลขหาย
async function checkRenumberAfterDelete(baseUrl, headed) {
  const session = await openProfile('admin', headed)
  try {
    await transferDemoSession(session.page, baseUrl)
    await openDocTypeTab(session, baseUrl)
    const before = await rowNumbers(session.page)
    const target = rowOf(session.page, MIDDLE_LABEL)
    if (await target.count() === 0) {
      throw new BlockedError(`สนามซ้อมไม่มีประเภท "${MIDDLE_LABEL}" ให้ทดสอบ (อาจถูกลบค้างไว้) กู้คืนก่อนรันซ้ำ`)
    }
    await target.locator(DELETE_BUTTON).click()
    await session.page.waitForTimeout(600)
    const after = await rowNumbers(session.page)
    assert.equal(after.length, before.length - 1, 'กดลบแล้วจำนวนแถวต้องลดลง 1')
    assert.deepEqual(after, after.map((_, i) => String(i + 1)),
      `เลขต้องเรียง 1..${after.length} ต่อเนื่องหลังลบแถวกลาง แต่ได้ ${after.join(',')}`)
    const stillListed = await rowOf(session.page, MIDDLE_LABEL).count()
    assert.equal(stillListed, 0, 'แถวที่กดลบต้องหายจากตารางทันทีตั้งแต่ยังไม่บันทึก')
  } finally {
    // ไม่กดบันทึก จึงไม่มีอะไรต้องกู้คืน ปิดหน้าไปเลย draft หายเอง
    await session.context.close()
  }
}

// ─────────────────────────────────────────────────────────── write checks ──

// วงจรเต็ม: ลบ → บันทึก → ตรวจ persist + ฝั่งประชาชน → กู้คืน
// กู้คืนอยู่ใน finally เสมอ ต่อให้ assertion กลางทางพัง สนามซ้อมต้องกลับสภาพเดิม
async function checkDeleteSaveRestore(baseUrl, headed) {
  const session = await openProfile('admin', headed)
  let removed = false
  try {
    await transferDemoSession(session.page, baseUrl)

    // baseline ของหน้าแรกฝั่งประชาชน ก่อนลบ
    const citizenBefore = await collectHomeServiceLinks(baseUrl, headed)

    await openDocTypeTab(session, baseUrl)
    const rowsBefore = await session.page.locator('table tbody tr').count()
    const target = rowOf(session.page, TARGET_LABEL)
    if (await target.count() === 0) {
      throw new BlockedError(`สนามซ้อมไม่มีประเภท "${TARGET_LABEL}" ให้ทดสอบ (อาจถูกลบค้างไว้) กู้คืนก่อนรันซ้ำ`)
    }
    await target.locator(DELETE_BUTTON).click()
    await session.page.waitForTimeout(400)
    const status = await saveAndWait(session.page)
    removed = true
    assert.ok(status >= 200 && status < 300, `บันทึกไม่สำเร็จ (HTTP ${status})`)

    // ข้อ 5 — บั๊ก patchTenant: ต้องอยู่หน้าเดิม ไม่ถูกเด้งกลับหน้าแรกของหลังบ้าน
    assert.ok(await session.page.getByText(CARD_HEADING).count() > 0,
      'บันทึกแล้วหน้าถูก remount กลับไปหน้าแรกของหลังบ้าน — ตรวจ deps ของ effect ใน AuthContext')
    assert.ok(await session.page.getByText(RESTORE_STRIP).count() > 0,
      'แถบกู้คืนต้องขึ้นในหน้าเดิมทันทีโดยไม่ต้องโหลดใหม่')

    // ข้อ 3 — ค่าอยู่ใน DB จริง ไม่ใช่แค่ state ในหน้า
    await openDocTypeTab(session, baseUrl)
    assert.equal(await rowOf(session.page, TARGET_LABEL).count(), 0,
      'โหลดหน้าใหม่แล้วประเภทที่ลบต้องยังหาย (fee_schedule._removed_types ต้องถูกบันทึก)')
    assert.equal(await session.page.locator('table tbody tr').count(), rowsBefore - 1,
      'จำนวนแถวหลังโหลดใหม่ต้องลดลง 1')
    const numbers = await rowNumbers(session.page)
    assert.deepEqual(numbers, numbers.map((_, i) => String(i + 1)),
      'เลขลำดับต้องยังเรียงต่อเนื่องหลังลบถาวร')

    // ข้อ 4 — ฝั่งประชาชน: หายเฉพาะตัวที่ลบ ตัวอื่นอยู่ครบ
    const citizenAfter = await collectHomeServiceLinks(baseUrl, headed)
    assert.ok(!citizenAfter.some(href => href.endsWith(`type=${TARGET_VALUE}`)),
      'หน้าแรกฝั่งประชาชนยังมีปุ่มบริการของประเภทที่ลบไปแล้ว')
    const others = citizenBefore.filter(href => !href.endsWith(`type=${TARGET_VALUE}`))
    for (const href of others) {
      assert.ok(citizenAfter.includes(href), `ประเภทอื่นหายไปด้วย: ${href} — กรองเกินจำเป็น`)
    }
  } finally {
    if (removed) {
      try {
        await openDocTypeTab(session, baseUrl)
        while (await session.page.locator(RESTORE_BUTTON).count() > 0) {
          await session.page.locator(RESTORE_BUTTON).first().click()
          await session.page.waitForTimeout(300)
        }
        await saveAndWait(session.page)
        await openDocTypeTab(session, baseUrl)
        const back = await rowOf(session.page, TARGET_LABEL).count() > 0
        const stripGone = await session.page.getByText(RESTORE_STRIP).count() === 0
        if (!back || !stripGone) {
          process.stderr.write(`⚠️ กู้คืน "${TARGET_LABEL}" บนสนามซ้อมไม่สำเร็จ ต้องตามเก็บด้วยมือ\n`)
        }
      } catch {
        process.stderr.write(`⚠️ กู้คืน "${TARGET_LABEL}" บนสนามซ้อมไม่สำเร็จ ต้องตามเก็บด้วยมือ\n`)
      }
    }
    await session.context.close()
  }
}

/**
 * ลิงก์บริการบนหน้าแรกฝั่งประชาชน (เลือกวัดที่หน้าแรก ไม่ใช่จอเลือกประเภทใน /doc-request
 * เพราะจอนั้นมี gate "ยืนยันตัวตนก่อนใช้บริการ" ที่ต้องกรอกเลขบัตรประชาชนลงโปรไฟล์ = PII
 * ซึ่งเทสต์ชุดนี้ห้ามแตะ)
 */
async function collectHomeServiceLinks(baseUrl, headed) {
  const session = await openProfile('citizen', headed)
  try {
    await transferDemoSession(session.page, baseUrl)
    await session.page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await waitForSettled(session.page, session.auth)
    await session.page.waitForTimeout(1_500)
    const hrefs = await session.page.locator('a[href*="doc-request?type="]')
      .evaluateAll(els => els.map(el => el.getAttribute('href')))
    return [...new Set(hrefs)]
  } finally {
    await session.context.close()
  }
}

// ────────────────────────────────────────────────────────────── reporting ──

function safeReason(error) {
  if (error instanceof BlockedError) return error.message
  if (error instanceof assert.AssertionError) return String(error.message).slice(0, 300)
  const message = String(error?.message ?? '')
  if (/Timeout|locator|waiting for/i.test(message)) return message.split('\n')[0].slice(0, 200)
  return 'Playwright ทำงานไม่สำเร็จ; ไม่บันทึก raw page/error เพื่อป้องกันข้อมูลรั่วไหล'
}

async function writeResults(results, baseUrl, write) {
  const counts = {
    PASS: results.filter(r => r.status === 'PASS').length,
    FAIL: results.filter(r => r.status === 'FAIL').length,
    BLOCKED: results.filter(r => r.status === 'BLOCKED').length,
  }
  const lines = [
    'SmartLocal Document Type Delete Regression Test',
    `Timestamp: ${new Date().toISOString()}`,
    `Base URL: ${baseUrl}`,
    `Mode: ${write ? 'write (แก้รายการประเภทคำขอของสนามซ้อมแล้วกู้คืน)' : 'read-only'}`,
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
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = resolveBaseUrl()

  const checks = [
    { name: 'delete-button-every-row', reason: 'ปุ่มลบขึ้นครบทุกแถว รวมประเภทมาตรฐาน', run: checkDeleteButtonOnEveryRow },
    { name: 'order-column', reason: 'คอลัมน์แรกหัวว่า "ที่" และเลขเรียง 1..n', run: checkOrderColumn },
    { name: 'renumber-after-delete', reason: 'ลบแถวกลาง (ยังไม่บันทึก) แล้วเลขเรียงใหม่ต่อเนื่อง', run: checkRenumberAfterDelete },
  ]
  if (args.write) {
    checks.push({
      name: 'delete-save-restore',
      reason: 'ลบ → บันทึกลง DB → หายจากหน้าประชาชนเฉพาะตัวที่ลบ → กู้คืนกลับสภาพเดิม',
      run: checkDeleteSaveRestore,
    })
  }

  // DOCTYPE_TEST_ONLY=order-column,... — รันเฉพาะบางชุดตอนไล่แก้
  const only = (process.env.DOCTYPE_TEST_ONLY || '').split(',').map(s => s.trim()).filter(Boolean)
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
