// E2E: การกดบนแผนที่ data-center — แผงรายละเอียดหมุดต้องเปิด/ปิดตามที่คาด
// เจตนา: กดหมุด → แผงเปิด · กดที่ว่าง → แผงปิด · กดหมุดอื่น → สลับไม่ใช่ปิดทิ้ง · ลากแผนที่ → ไม่ปิด
//
// ยิงได้เฉพาะ https://demo.rk-networks.com (สนามซ้อม) — อ่านและกดอย่างเดียว ไม่สร้าง ไม่แก้ ไม่ลบข้อมูล
// จึงรันซ้ำได้ไม่จำกัดและไม่ต้องเก็บกวาดอะไรหลังรัน (ต่างจาก tests/odor-workflow ที่สร้างคำร้องจริง)
// ห้าม log credential/token/เนื้อหาหน้าเว็บดิบ
//
//   node tests/map-click.playwright.mjs [--headed]
//
// ⚠️ ต้องมี session ค้างอยู่ใน .chrome-test-profiles/TEST-admin (หรือให้ Chrome เติมรหัสให้)
//    เหมือนเทสต์ Playwright ตัวอื่นในโฟลเดอร์นี้ ถ้าไม่มีจะขึ้น BLOCKED ไม่ใช่ FAIL
//
// ── กับดักที่เคยทำให้เทสต์ตัวนี้รายงานผลผิด เก็บไว้เตือนคนแก้รอบหน้า ─────────────
//  1. มุมขวาบนของแผนที่มี "ปุ่มลอย" เปิด/ปิดเลเยอร์ (ย้ายมาจากซ้ายบน) การกดตรงนั้นเพื่อจำลอง "กดที่ว่าง"
//     กลายเป็นปิดเลเยอร์แล้วหมุดหายหมด → เคยอ่านผลผิดว่าเป็น regression ของโค้ดจริง
//     จึงต้องนับหมุดก่อน/หลังทุกครั้ง ถ้าจำนวนเปลี่ยน = กดโดนปุ่ม ไม่ใช่ที่ว่าง ให้ถือว่าไม่ผ่าน
//  2. หมุดของศูนย์ข้อมูลดิจิทัล (CCTV ฯลฯ) ทับหมุดคำร้องอยู่พอดี ต้องปิดเลเยอร์พวกนั้นก่อน
//     ไม่งั้นกดยังไงก็โดนหมุดผิดใบตลอด — ตอนนี้หมุดพวกนั้นมีแผงรายละเอียดของตัวเองแล้ว (เดิมไม่มี)
//     panelOpen() ด้านล่างจึงต้องชี้ด้วยฟิลด์ที่มีเฉพาะในแผงของหมุดกลิ่น (ทิศทางลม/ระดับความรุนแรง)
//     ไม่ใช่แค่ "มีแผงโผล่ไหม" ซึ่งตอนนี้เป็นจริงกับทุกหมุด
//  3. หมุดคำร้องหลายใบซ้อนพิกัดเดียวกัน กดได้แค่ใบบนสุด ต้องซูมออกก่อนถึงจะเจอกลุ่มอื่น
//  6. หมุดไม่มี attribute title แล้ว (ถอดออกตอนทำให้กดหมุดไหนก็เห็นรายละเอียด) ห้ามคัดหมุด
//     ด้วย title เด็ดขาด ให้กดจริงแล้วดูว่าแผงที่เปิดเป็นของหมวดกลิ่นไหม
//  5. ตัวกรองสถานะย้ายจากแถบบนสุดของหน้าเข้าไปอยู่ใน "แท็บคำร้อง" แล้ว ต้องเข้าแท็บก่อนถึงจะกดได้
//     และทุกขั้นการกดต้องล้มดังๆ ถ้าหาปุ่มไม่เจอ ห้ามข้ามเงียบ ไม่งั้นเทสต์จะไปล้มที่ปลายทาง
//     แล้วอ่านผลผิดว่าแผนที่พัง ทั้งที่แค่กดไม่ถูกที่ (เกิดขึ้นจริงหลัง UI ย้ายปุ่ม 2569-09-06)
//  4. หมุดที่อยู่นอกกรอบจอกดไม่ได้ — ยืนยันด้วย document.elementFromPoint ว่าตัวบนสุด ณ จุดนั้น
//     คือหมุดที่ตั้งใจจะกดจริง อย่าเชื่อ boundingClientRect เฉยๆ

import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { BlockedError, navigateClientSide, reloadIfServiceWorkerUpdated, trackProfileResolution, waitForSettled } from './lib/appReady.mjs'

const ROOT_DIR = process.cwd()
const PROFILE_ROOT = path.join(ROOT_DIR, '.chrome-test-profiles')
const BASE_URL = 'https://demo.rk-networks.com'
const ACCOUNT = { alias: 'demo-admin', profile: 'admin' }

// เคสทั้งหมดที่การรันเต็มต้องได้ผล ใช้กระทบยอดตอนจบเหมือน tests/odor-workflow.playwright.mjs
// เคสที่ไม่ถูก record จะขึ้น SKIP ไม่ใช่หายไปเงียบๆ (SKIP นับเป็นไม่ผ่าน จึง exit 1)
const EXPECTED_STEPS = ['map-ready', 'pin-tooltip', 'click-empty-closes', 'click-other-pin-switches', 'drag-keeps-open']

// ป้ายของตัวกรองสถานะ "ทุกสถานะ" เคยชื่อ "ทั้งหมด" มาก่อน รับทั้งสองคำเพื่อไม่ให้เทสต์พังตอนเปลี่ยนคำ
const ALL_STATUS_LABEL = /^\s*(ทุกสถานะ|ทั้งหมด)\s*$/

const wait = (page, ms) => page.waitForTimeout(ms)

async function run(page, record) {
  const go = (route, auth) => navigateClientSide(page, auth, route)
  const auth = trackProfileResolution(page)

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 25_000 })
  await reloadIfServiceWorkerUpdated(page, BASE_URL)
  await waitForSettled(page, auth)

  if (await go('/profile', auth) !== '/profile') {
    await go('/auth', auth)
    const form = page.locator('form').filter({ has: page.locator('input[autocomplete="current-password"]') }).first()
    await form.locator('input[autocomplete="email"]').fill(`${ACCOUNT.alias}@smartlocal.test`)
    const password = form.locator('input[autocomplete="current-password"]')
    if (process.env.DEMO_TEST_PASSWORD) await password.fill(process.env.DEMO_TEST_PASSWORD)
    else {
      await wait(page, 1_500)
      if (!await password.evaluate((input) => input.value.length > 0)) {
        throw new BlockedError('ไม่พบ DEMO_TEST_PASSWORD และ Chrome ไม่ได้เติมรหัสให้')
      }
    }
    await form.locator('button[type="submit"]').click()
    try {
      await page.waitForFunction(() => !['/auth', '/admin/login'].includes(window.location.pathname), null, { timeout: 20_000 })
    } catch { throw new BlockedError(`login ${ACCOUNT.alias} ไม่สำเร็จ`) }
    await wait(page, 1_500)
  }
  for (let round = 0; round < 2; round += 1) {
    const skip = page.getByRole('button', { name: 'ข้ามไปก่อน', exact: true })
    if (!await skip.first().isVisible().catch(() => false)) break
    await skip.first().click(); await wait(page, 700)
  }

  // ── เตรียมแผนที่ให้มีหมุดคำร้องที่กดแล้วมีแผงจริง ─────────────────────────
  await go('/data-center/staff', auth)
  await wait(page, 3_000)
  await page.getByRole('button', { name: /แผนที่ GIS/ }).first().click().catch(() => {})
  await wait(page, 4_000)

  // ⚠️ ลำดับสำคัญ: ต้องเข้าแท็บ "คำร้อง" ก่อน แล้วตัวกรองสถานะถึงจะโผล่
  //   เดิมตัวกรองอยู่บนแถบบนสุดของหน้า กดได้ทันทีตั้งแต่เปิดแผนที่ แต่ถูกย้ายเข้าไปอยู่ในแท็บ
  //   แล้ว (2569-09-06) ถ้ากดสลับลำดับ ปุ่มจะยังไม่มีอยู่ในหน้าจอ ตัวกรองค้างที่ "เสร็จสิ้นแล้ว"
  //   ซึ่งตัดหมวดเฉพาะกิจออกหมด หมุดกลิ่นจึงไม่ขึ้นเลยแม้แต่จุดเดียว
  //
  // ⚠️ ทุกขั้นตรงนี้ต้องล้มดังๆ ถ้าหาปุ่มไม่เจอ ห้ามใช้ if (isVisible) แล้วข้ามเงียบ
  //   ของเดิมข้ามเงียบ พอ UI ย้ายปุ่ม เทสต์เลยเดินต่อไปจนหาหมุดไม่เจอแล้วค่อยล้มที่ปลายทาง
  //   ทำให้อ่านผลผิดว่า "แผนที่พัง" ทั้งที่แค่กดไม่ถูกที่ ล้มที่ขั้นที่ผิดจริงอ่านง่ายกว่ามาก
  const clickOrFail = async (locator, what, settleMs) => {
    if (!await locator.isVisible().catch(() => false)) {
      throw new BlockedError(`ไม่พบปุ่ม "${what}" บนหน้าจอ — UI อาจถูกย้าย ต้องอัปเดตเทสต์ตาม`)
    }
    await locator.click()
    await wait(page, settleMs)
  }

  // ชื่อแท็บมีตัวเลขจำนวนหมุดต่อท้ายแล้ว ("คำร้อง 12") จึงต้องเผื่อตัวเลขไว้ในชื่อที่ค้นหา
  await clickOrFail(page.getByRole('button', { name: /^\s*คำร้อง\s*\d*\s*$/ }).first(), 'แท็บคำร้อง', 2_500)
  // ตัวกรองสถานะเริ่มต้นคือ "เสร็จสิ้นแล้ว" ซึ่งตัดหมวดเฉพาะกิจออกทั้งหมด
  await clickOrFail(page.getByRole('button', { name: ALL_STATUS_LABEL }).first(), 'ตัวกรองทุกสถานะ', 3_000)
  await clickOrFail(page.getByRole('button', { name: /กลิ่นเหม็น/ }).first(), 'หมวดกลิ่นเหม็นรบกวน', 4_000)

  // ปิดเลเยอร์ของศูนย์ข้อมูลดิจิทัลที่ทับหมุดคำร้องอยู่ (ดูกับดักข้อ 2 ที่หัวไฟล์)
  const layerToggle = page.locator('.absolute.right-3.top-3 button').first()
  if (await layerToggle.isVisible().catch(() => false)) { await layerToggle.click(); await wait(page, 2_500) }

  // ซูมออกเพื่อให้หมุดที่ซ้อนกันแยกออกเป็นหลายกลุ่ม (กับดักข้อ 3)
  for (let step = 0; step < 3; step += 1) {
    await page.locator('.leaflet-control-zoom-out').click().catch(() => {})
    await wait(page, 1_100)
  }

  const mapBox = await page.locator('.leaflet-container').boundingBox()
  if (!mapBox) throw new BlockedError('ไม่พบกรอบแผนที่บนหน้าจอ')

  const markerCount = () => page.locator('.leaflet-marker-icon').count()
  // แผงรายละเอียดของหมุดคำร้องหมวดเฉพาะกิจ ใช้หัวข้อที่มีเฉพาะในแผงนั้นเป็นตัวชี้วัด
  // (หมุดชนิดอื่นก็เปิดแผงได้แล้ว แต่ไม่มีสองช่องนี้ จึงยังใช้แยกหมวดกลิ่นออกมาได้)
  const panelOpen = () => page.evaluate(() => /ทิศทางลม|ระดับความรุนแรง/.test(document.body.innerText || ''))

  // จุดของหมุดที่กดโดนจริง — ตัวบนสุด ณ จุดนั้นต้องเป็นหมุด ไม่ใช่หมุดอื่นที่ทับอยู่ (กับดักข้อ 4)
  const candidates = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('.leaflet-marker-icon')) {
      const rect = el.getBoundingClientRect()
      const x = rect.x + rect.width / 2
      const y = rect.y + rect.height / 2
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue
      if (!document.elementFromPoint(x, y)?.closest('.leaflet-marker-icon')) continue
      if (out.some((p) => Math.abs(p.x - x) < 6 && Math.abs(p.y - y) < 6)) continue
      out.push({ x, y })
    }
    return out
  })

  // ⚠️ ห้ามคัดหมุดกลิ่นด้วย attribute title — หมุดทุกใบไม่มี title แล้ว (ถอดออก 2569-09-06
  //   ตอนที่ทำให้กดหมุดไหนก็เห็นรายละเอียด) เดิมเทสต์กรองด้วย /กลิ่นเหม็น/ บน title ผลคือ
  //   ได้ 0 จุดทั้งที่มีหมุดกลิ่น 11 ใบอยู่ตรงหน้า แล้วรายงานว่า "สนามซ้อมไม่มีคำร้องกลิ่นพอ"
  //   ซึ่งชี้ผิดที่หมด — วิธีที่ทนต่อการเปลี่ยน UI คือกดจริงแล้วดูว่าแผงที่เปิดเป็นของหมวดกลิ่นไหม
  //   (หมุดของศูนย์ข้อมูลดิจิทัลก็มีแผงของตัวเองแล้ว แต่ไม่มีช่องทิศทางลม/ระดับความรุนแรง)
  const spots = []
  for (const point of candidates) {
    await page.mouse.click(point.x, point.y)
    await wait(page, 900)
    if (await panelOpen()) spots.push(point)
    if (spots.length >= 2) break
  }

  if (spots.length < 2) {
    throw new BlockedError(`กดครบ ${candidates.length} หมุดที่กดโดนได้แล้ว เจอหมุดที่เปิดแผงหมวดกลิ่นเพียง ${spots.length} จุด (ต้องการ 2) — สนามซ้อมอาจไม่มีคำร้องกลิ่นพอ หรือแผงเปลี่ยนหัวข้อไปแล้ว`)
  }
  record('map-ready', 'PASS', `เตรียมแผนที่ได้ หมุดทั้งหมด ${await markerCount()} · หมุดกลิ่นที่กดโดนจริง ${spots.length}`)

  // ── หมุดต้องมี tooltip ตอน hover และต้องไม่มี popup ของ Leaflet โผล่ซ้อนการ์ด ────────
  // สองอย่างนี้ผูกกันใน LeafletMapCanvas: markerData.title เป็นทั้งข้อความ hover และสวิตช์สั่ง
  // bindPopup ส่วน markerData.tooltip ให้เฉพาะข้อความ hover ถ้าวันหลังมีคนสลับกลับไปใช้ title
  // จะได้ tooltip กลับมาก็จริง แต่แถม popup ซ้อนการ์ดมาด้วย เคสนี้จับทั้งสองด้านพร้อมกัน
  try {
    const tooltips = await page.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon')]
      .map((el) => (el.getAttribute('title') || '').trim()).filter(Boolean).length)
    const total = await markerCount()
    await page.mouse.click(spots[0].x, spots[0].y)
    await wait(page, 1_200)
    const leafletPopups = await page.locator('.leaflet-popup').count()
    record('pin-tooltip', tooltips === total && leafletPopups === 0 ? 'PASS' : 'FAIL',
      `หมุดที่มีข้อความ hover ${tooltips}/${total} · popup ของ Leaflet ที่ซ้อนการ์ด ${leafletPopups} (ต้องเป็น 0)`)
  } catch (error) { record('pin-tooltip', 'FAIL', String(error.message).slice(0, 160)) }

  // จุดว่าง: เลี่ยงปุ่มลอย (ขวาบน) แถบซูม (ขวาล่าง) และแผงรายละเอียด (กลางล่าง)
  const emptyX = mapBox.x + mapBox.width * 0.30
  const emptyY = mapBox.y + mapBox.height * 0.72

  // ── กดหมุด แล้วกดที่ว่าง ต้องปิด ─────────────────────────────────────────
  try {
    await page.mouse.click(spots[0].x, spots[0].y); await wait(page, 1_400)
    const opened = await panelOpen()
    const before = await markerCount()
    await page.mouse.click(emptyX, emptyY); await wait(page, 1_600)
    const after = await markerCount()
    const closed = !(await panelOpen())
    // จำนวนหมุดต้องไม่เปลี่ยน ไม่งั้นแปลว่าไปกดโดนปุ่มปิดเลเยอร์ ไม่ใช่ที่ว่าง (กับดักข้อ 1)
    const clickedEmptyGround = before === after
    record('click-empty-closes', opened && closed && clickedEmptyGround ? 'PASS' : 'FAIL',
      `กดหมุดแล้วแผงเปิด=${opened} · กดที่ว่างแล้วแผงปิด=${closed} · จำนวนหมุดคงเดิม ${before}→${after}`)
  } catch (error) { record('click-empty-closes', 'FAIL', String(error.message).slice(0, 160)) }

  // ── กดหมุดอื่น ต้องสลับแผง ไม่ใช่ปิดทิ้ง ───────────────────────────────────
  try {
    await page.mouse.click(spots[0].x, spots[0].y); await wait(page, 1_400)
    const first = await panelOpen()
    await page.mouse.click(spots[1].x, spots[1].y); await wait(page, 1_600)
    const second = await panelOpen()
    record('click-other-pin-switches', first && second ? 'PASS' : 'FAIL',
      `หมุดแรกเปิดแผง=${first} · กดหมุดที่สองแล้วแผงยังอยู่=${second}`)
  } catch (error) { record('click-other-pin-switches', 'FAIL', String(error.message).slice(0, 160)) }

  // ── ลากแผนที่ ต้องไม่ปิด ─────────────────────────────────────────────────
  try {
    await page.mouse.click(spots[0].x, spots[0].y); await wait(page, 1_400)
    if (!await panelOpen()) throw new Error('เปิดแผงไม่ได้ก่อนเริ่มลาก')
    await page.mouse.move(emptyX, emptyY)
    await page.mouse.down()
    await page.mouse.move(emptyX - 130, emptyY - 70, { steps: 14 })
    await page.mouse.up(); await wait(page, 1_600)
    const survived = await panelOpen()
    record('drag-keeps-open', survived ? 'PASS' : 'FAIL', `ลากแผนที่แล้วแผงยังเปิด=${survived}`)
  } catch (error) { record('drag-keeps-open', 'FAIL', String(error.message).slice(0, 160)) }
}

async function main() {
  const headed = process.argv.slice(2).includes('--headed')
  const results = []
  const record = (step, status, reason) => {
    results.push({ step, status })
    process.stdout.write(`${status} ${step}: ${reason}\n`)
  }

  let context
  try {
    context = await chromium.launchPersistentContext(path.join(PROFILE_ROOT, `TEST-${ACCOUNT.profile}`), {
      channel: 'chrome',
      headless: !headed,
      viewport: { width: 1440, height: 1000 },
    })
  } catch {
    record('runner', 'BLOCKED', `เปิด TEST-${ACCOUNT.profile} ไม่สำเร็จ; ปิด Chrome Profile นี้ก่อนรันซ้ำ`)
    process.exitCode = 1
    return
  }

  try {
    const page = context.pages()[0] || await context.newPage()
    await run(page, record)
  } catch (error) {
    record('runner', error instanceof BlockedError ? 'BLOCKED' : 'FAIL', String(error.message).slice(0, 200))
  } finally {
    await context.close()
  }

  // เคสที่ไม่ถูก record เลยต้องโผล่เป็น SKIP ไม่ใช่หายไปจากผลลัพธ์
  const recorded = new Set(results.map((item) => item.step))
  for (const step of EXPECTED_STEPS) {
    if (recorded.has(step)) continue
    record(step, 'SKIP', 'ไม่ได้ถูกตรวจในรอบนี้ — ขั้นก่อนหน้าล้มหรือการรันจบก่อนถึงเคสนี้')
  }

  const passed = results.filter((item) => item.status === 'PASS').length
  process.stdout.write(`\n=== ${passed}/${EXPECTED_STEPS.length} ผ่าน ===\n`)
  process.exitCode = results.some((item) => item.status !== 'PASS') ? 1 : 0
}

main()
