// Regression test สำหรับสวิตช์ "เปิด/ปิดบริการ" รายประเภทคำขอเอกสาร (2569-09-08) —
// แทนที่ UX เดิม "ลบ + แถบกู้คืนใต้ตาราง" (PR #67) แต่ยังเขียนคีย์เดิม fee_schedule._removed_types
// รวมคอลัมน์ "ที่" (PR #69) ที่ยังต้องเรียง 1..n เหมือนเดิม
//
// ครอบ acceptance criteria:
//   1. สวิตช์เปิด/ปิดต้องขึ้นครบทุกแถว ส่วนปุ่มลบถาวรมีเฉพาะประเภทที่ อปท. เพิ่มเอง
//      (ประเภทมาตรฐานลบไม่ได้ เพราะลิสต์อยู่ในโค้ดเป็นของกลางทุก อปท.)
//   2. คอลัมน์แรกหัวว่า "ที่" ตามแบบพิมพ์ราชการ และเลขเรียง 1..n ต่อเนื่องเสมอ
//   3. ปิดสวิตช์แล้ว "แถวต้องยังอยู่ในตาราง" (ต่างจากเดิมที่แถวหายไปอยู่แถบกู้คืน)
//      พร้อมป้าย "ปิดอยู่" และช่องผังงานถูกล็อก
//   4. ปิดแล้วบันทึก → ค่าลง fee_schedule._removed_types จริง โหลดหน้าใหม่ยังปิดอยู่
//      และเปิดกลับได้จากสวิตช์ในแถวเดิม
//   5. ประเภทที่ปิดต้องหายจากหน้าแรกฝั่งประชาชน โดยประเภทอื่นยังอยู่ครบ (ไม่กรองเกินจำเป็น)
//   6. **ปิดแล้วเปิดกลับ ผังงานที่ตั้งไว้ต้องไม่หาย** — หัวใจของการเปลี่ยนจาก "ลบ" เป็น "ปิด"
//      โค้ดเดิมลบแถว document_type_assignments ทิ้งตอนบันทึก เปิดกลับมาแล้ว SLA เด้งกลับดีฟอลต์
//   7. กดบันทึกแล้วต้องอยู่หน้าเดิม — กันบั๊ก patchTenant ที่ทำให้ RequireAuth คืน null
//      แล้วหน้าทั้งหน้า remount (PR #66) ถ้าใครเผลอใส่ `tenant` ทั้ง object กลับเข้า deps
//      ของ effect ใน AuthContext เทสต์ข้อนี้จะแดงทันที
//
// ⚠️ ข้อบังคับด้านความปลอดภัย/PDPA (เหมือน negative-authorization.playwright.mjs)
//   - ยิงได้เฉพาะสนามซ้อม demo.rk-networks.com หรือ dev server ในเครื่อง (VITE_TENANT_SLUG=demo)
//     hostname อื่น = ปฏิเสธทันที ห้ามยิงใส่ อปท. จริงเด็ดขาด
//   - ห้าม log credential/token/เนื้อหาหน้าเว็บดิบ ลง test-results ทุกกรณี
//   - ไม่สร้างข้อมูลประชาชนใดๆ โหมด --write แตะเฉพาะ "รายการประเภทคำขอ" ของสนามซ้อม
//
// โหมดการรัน
//   ค่าเริ่มต้น = read-only ตรวจข้อ 1, 2, 3 (กดสวิตช์แต่ไม่กดบันทึก จึงไม่แตะ DB เลย
//                 ทิ้ง draft ด้วยการโหลดหน้าใหม่)
//   --write     = ตรวจข้อ 4, 5, 6, 7 เพิ่ม ซึ่ง "เขียน fee_schedule + document_type_assignments
//                 ของสนามซ้อมจริง" แล้วกู้คืนกลับสภาพเดิมให้เสมอใน finally ต่อให้ assertion พัง
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

// ประเภทที่ใช้ทดสอบการปิด — เลือก waste_collection เพราะเป็นประเภทมาตรฐานที่ไม่มี wizard
// เฉพาะทางผูกอยู่ (ต่างจาก building_permit / waste_collection_request) ปิดแล้วเปิดคืนได้สะอาด
const TARGET_LABEL = 'ค่าธรรมเนียมขยะ'
const TARGET_VALUE = 'waste_collection'
// ประเภทกลางตาราง ใช้ทดสอบว่าปิดแล้วแถวยังอยู่ที่เดิม เลขลำดับไม่ขยับ (กดสวิตช์แต่ไม่บันทึก)
const MIDDLE_LABEL = 'ค่าธรรมเนียม/ภาษี'
// ค่า SLA ที่ใช้ทดสอบว่าผังงานไม่หายตอนปิด — ต้องไม่ตรงดีฟอลต์ของ waste_collection (3 วัน)
const PROBE_SLA = '5'

const CARD_HEADING = 'ประเภทคำขอเอกสารและผังงาน'
const DISABLED_BADGE = 'ปิดอยู่'
const SAVE_BUTTON = /^บันทึก(การเปลี่ยนแปลง)?$/
const TOGGLE = 'button[role="switch"]'
// ปุ่มลบถาวรเหลือเฉพาะประเภทที่ อปท. เพิ่มเอง
const DELETE_BUTTON = 'button[title*="ลบประเภทที่เพิ่มเอง"]'

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

/**
 * กดบันทึกแล้วรอผลจาก REST — ใช้ response แทนข้อความบนจอ เพื่อไม่ผูกกับ UI
 *
 * ต้องรับได้ทั้งสองตาราง: เปิด/ปิดบริการเขียน municipalities (PATCH) ส่วนการแก้กอง/ผู้รับผิดชอบ/
 * วันแล้วเสร็จเขียน document_type_assignments (upsert = POST) การบันทึกครั้งหนึ่งอาจมีแค่อย่างใด
 * อย่างหนึ่ง ถ้าดักเฉพาะ municipalities เทสต์จะค้างครบ 30 วิ ตอนบันทึกที่แก้แต่ผังงาน
 */
async function saveAndWait(page) {
  const patched = page.waitForResponse(
    res => /\/rest\/v1\/(municipalities|document_type_assignments)/.test(res.url())
      && ['PATCH', 'POST'].includes(res.request().method()),
    { timeout: 30_000 })
  await page.getByRole('button', { name: SAVE_BUTTON }).first().click()
  const response = await patched
  await page.waitForTimeout(1_500)
  return response.status()
}

// ─────────────────────────────────────────────────────── read-only checks ──

// สวิตช์ต้องมีครบทุกแถว ส่วนปุ่มลบถาวรต้องไม่ขึ้นกับประเภทมาตรฐาน — ปิดสวิตช์ให้ผลเท่ากัน
// สำหรับ อปท. นี้อยู่แล้ว และลบลิสต์ในโค้ดซึ่งเป็นของกลางทุก อปท. ทิ้งไม่ได้
async function checkToggleOnEveryRow(baseUrl, headed) {
  const session = await openProfile('admin', headed)
  try {
    await transferDemoSession(session.page, baseUrl)
    await openDocTypeTab(session, baseUrl)
    const rows = await session.page.locator('table tbody tr').count()
    const toggles = await session.page.locator(`table ${TOGGLE}`).count()
    const deletes = await session.page.locator(`table ${DELETE_BUTTON}`).count()
    assert.ok(rows >= 6, `ตารางควรมีอย่างน้อย 6 ประเภท (รวมที่ปิดอยู่) แต่มี ${rows}`)
    assert.equal(toggles, rows, `สวิตช์มี ${toggles} ตัวแต่มี ${rows} แถว — ทุกประเภทต้องปิด/เปิดได้`)
    const customRows = await session.page.locator('table tbody tr').filter({ hasText: 'ประเภทที่เพิ่มเอง' }).count()
    assert.equal(deletes, customRows,
      `ปุ่มลบถาวรมี ${deletes} ปุ่มแต่มีประเภทที่เพิ่มเอง ${customRows} แถว — ประเภทมาตรฐานต้องลบไม่ได้`)
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

// ปิดประเภทกลางตาราง (ไม่กดบันทึก = ไม่แตะ DB) แล้วแถวต้องยังอยู่ที่เดิม เลขไม่ขยับ
// มีป้ายบอกว่าปิดอยู่ และช่องผังงานถูกล็อก
async function checkToggleKeepsRow(baseUrl, headed) {
  const session = await openProfile('admin', headed)
  try {
    await transferDemoSession(session.page, baseUrl)
    await openDocTypeTab(session, baseUrl)
    const before = await rowNumbers(session.page)
    const target = rowOf(session.page, MIDDLE_LABEL)
    if (await target.count() === 0) {
      throw new BlockedError(`สนามซ้อมไม่มีประเภท "${MIDDLE_LABEL}" ให้ทดสอบ (อาจถูกลบค้างไว้) กู้คืนก่อนรันซ้ำ`)
    }
    const toggle = target.locator(TOGGLE)
    assert.equal(await toggle.getAttribute('aria-checked'), 'true',
      `"${MIDDLE_LABEL}" ควรเปิดอยู่ก่อนเริ่มทดสอบ (สนามซ้อมอาจถูกปิดค้างไว้)`)
    await toggle.click()
    await session.page.waitForTimeout(600)

    const after = await rowNumbers(session.page)
    assert.deepEqual(after, before, 'ปิดสวิตช์แล้วแถวต้องยังอยู่ครบ เลขลำดับไม่ขยับ')
    const row = rowOf(session.page, MIDDLE_LABEL)
    assert.equal(await row.count(), 1, 'แถวที่ปิดต้องยังอยู่ในตาราง ไม่ใช่หายไปแถบอื่น')
    assert.equal(await row.locator(TOGGLE).getAttribute('aria-checked'), 'false', 'สวิตช์ต้องอยู่สถานะปิด')
    assert.ok((await row.textContent())?.includes(DISABLED_BADGE),
      `แถวที่ปิดต้องมีป้าย "${DISABLED_BADGE}" บอกว่าประชาชนยื่นใหม่ไม่ได้`)
    assert.ok(await row.locator('select:disabled').count() >= 2,
      'ช่องกอง/ผู้รับผิดชอบของแถวที่ปิดต้องถูกล็อก')
  } finally {
    // ไม่กดบันทึก จึงไม่มีอะไรต้องกู้คืน ปิดหน้าไปเลย draft หายเอง
    await session.context.close()
  }
}

// ─────────────────────────────────────────────────────────── write checks ──

const slaInput = row => row.locator('input[type="number"]')

/** ตั้งค่า "แล้วเสร็จใน" ของแถวแล้วบันทึก — ใช้ปักหมุดผังงานไว้ตรวจว่าปิดแล้วไม่หาย */
async function setSlaAndSave(page, label, days) {
  const input = slaInput(rowOf(page, label))
  await input.fill(days)
  await page.waitForTimeout(300)
  return saveAndWait(page)
}

// วงจรเต็ม: ตั้ง SLA → ปิด → บันทึก → ตรวจ persist + ฝั่งประชาชน → เปิดกลับ → ผังงานต้องยังอยู่
// การกู้คืนอยู่ใน finally เสมอ ต่อให้ assertion กลางทางพัง สนามซ้อมต้องกลับสภาพเดิม
async function checkDisableSaveEnable(baseUrl, headed) {
  const session = await openProfile('admin', headed)
  let touched = false
  let originalSla = null
  try {
    await transferDemoSession(session.page, baseUrl)

    // baseline ของหน้าแรกฝั่งประชาชน ก่อนปิด
    const citizenBefore = await collectHomeServiceLinks(baseUrl, headed)

    await openDocTypeTab(session, baseUrl)
    const rowsBefore = await session.page.locator('table tbody tr').count()
    const target = rowOf(session.page, TARGET_LABEL)
    if (await target.count() === 0) {
      throw new BlockedError(`สนามซ้อมไม่มีประเภท "${TARGET_LABEL}" ให้ทดสอบ (อาจถูกลบค้างไว้) กู้คืนก่อนรันซ้ำ`)
    }
    assert.equal(await target.locator(TOGGLE).getAttribute('aria-checked'), 'true',
      `"${TARGET_LABEL}" ควรเปิดอยู่ก่อนเริ่มทดสอบ (สนามซ้อมอาจถูกปิดค้างไว้)`)

    // ปักหมุดผังงานด้วยค่าที่ไม่ใช่ดีฟอลต์ ไว้ตรวจข้อ 6 ตอนท้าย
    originalSla = await slaInput(target).inputValue()
    touched = true
    await setSlaAndSave(session.page, TARGET_LABEL, PROBE_SLA)

    // ปิดบริการแล้วบันทึก
    await rowOf(session.page, TARGET_LABEL).locator(TOGGLE).click()
    await session.page.waitForTimeout(400)
    const status = await saveAndWait(session.page)
    assert.ok(status >= 200 && status < 300, `บันทึกไม่สำเร็จ (HTTP ${status})`)

    // ข้อ 7 — บั๊ก patchTenant: ต้องอยู่หน้าเดิม ไม่ถูกเด้งกลับหน้าแรกของหลังบ้าน
    assert.ok(await session.page.getByText(CARD_HEADING).count() > 0,
      'บันทึกแล้วหน้าถูก remount กลับไปหน้าแรกของหลังบ้าน — ตรวจ deps ของ effect ใน AuthContext')

    // ข้อ 4 — ค่าอยู่ใน DB จริง ไม่ใช่แค่ state ในหน้า
    await openDocTypeTab(session, baseUrl)
    const reopened = rowOf(session.page, TARGET_LABEL)
    assert.equal(await reopened.count(), 1, 'โหลดหน้าใหม่แล้วแถวที่ปิดต้องยังอยู่ในตาราง')
    assert.equal(await reopened.locator(TOGGLE).getAttribute('aria-checked'), 'false',
      'โหลดหน้าใหม่แล้วต้องยังปิดอยู่ (fee_schedule._removed_types ต้องถูกบันทึก)')
    assert.equal(await session.page.locator('table tbody tr').count(), rowsBefore,
      'จำนวนแถวต้องเท่าเดิม — ปิดบริการไม่ใช่การลบแถวออกจากตาราง')

    // ข้อ 5 — ฝั่งประชาชน: หายเฉพาะตัวที่ปิด ตัวอื่นอยู่ครบ
    const citizenAfter = await collectHomeServiceLinks(baseUrl, headed)
    assert.ok(!citizenAfter.some(href => href.endsWith(`type=${TARGET_VALUE}`)),
      'หน้าแรกฝั่งประชาชนยังมีปุ่มบริการของประเภทที่ปิดไปแล้ว')
    const others = citizenBefore.filter(href => !href.endsWith(`type=${TARGET_VALUE}`))
    for (const href of others) {
      assert.ok(citizenAfter.includes(href), `ประเภทอื่นหายไปด้วย: ${href} — กรองเกินจำเป็น`)
    }

    // ข้อ 6 — เปิดกลับแล้วผังงานต้องยังอยู่ (โค้ดเดิมลบแถว assignment ทิ้ง ค่าจะเด้งกลับดีฟอลต์)
    await openDocTypeTab(session, baseUrl)
    await rowOf(session.page, TARGET_LABEL).locator(TOGGLE).click()
    await session.page.waitForTimeout(400)
    await saveAndWait(session.page)
    await openDocTypeTab(session, baseUrl)
    const restored = rowOf(session.page, TARGET_LABEL)
    assert.equal(await restored.locator(TOGGLE).getAttribute('aria-checked'), 'true',
      'เปิดกลับแล้วต้องอยู่สถานะเปิดหลังโหลดหน้าใหม่')
    assert.equal(await slaInput(restored).inputValue(), PROBE_SLA,
      'ปิดแล้วเปิดกลับ ค่า "แล้วเสร็จใน" ที่ตั้งไว้ต้องไม่หาย — แถว document_type_assignments ต้องไม่ถูกลบตอนปิด')
  } finally {
    if (touched) {
      try {
        await openDocTypeTab(session, baseUrl)
        const row = rowOf(session.page, TARGET_LABEL)
        if (await row.locator(TOGGLE).getAttribute('aria-checked') === 'false') {
          await row.locator(TOGGLE).click()
          await session.page.waitForTimeout(300)
        }
        // คืนค่า SLA เดิมของสนามซ้อม (ค่าที่อ่านได้ตอนเริ่มเทสต์ อาจเป็นดีฟอลต์ของระบบ)
        await setSlaAndSave(session.page, TARGET_LABEL, originalSla || '3')
        await openDocTypeTab(session, baseUrl)
        const back = rowOf(session.page, TARGET_LABEL)
        const ok = await back.locator(TOGGLE).getAttribute('aria-checked') === 'true'
          && await slaInput(back).inputValue() === (originalSla || '3')
        if (!ok) {
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
    { name: 'toggle-every-row', reason: 'สวิตช์ขึ้นครบทุกแถว ปุ่มลบถาวรมีเฉพาะประเภทที่เพิ่มเอง', run: checkToggleOnEveryRow },
    { name: 'order-column', reason: 'คอลัมน์แรกหัวว่า "ที่" และเลขเรียง 1..n', run: checkOrderColumn },
    { name: 'toggle-keeps-row', reason: 'ปิดสวิตช์ (ยังไม่บันทึก) แล้วแถวยังอยู่ที่เดิม พร้อมป้ายและช่องที่ถูกล็อก', run: checkToggleKeepsRow },
  ]
  if (args.write) {
    checks.push({
      name: 'disable-save-enable',
      reason: 'ปิด → บันทึกลง DB → หายจากหน้าประชาชนเฉพาะตัวที่ปิด → เปิดกลับแล้วผังงานยังอยู่',
      run: checkDisableSaveEnable,
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
