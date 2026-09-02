// แบบ 3 ใบขออนุญาตใช้รถส่วนกลาง — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วยเบราว์เซอร์
//
// แยกจาก fleet-form3-signatories.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่เปิดเบราว์เซอร์
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริง: ใบต้องจบใน 1 หน้า A4 และข้อความ
// ต้องไม่ล้นออกนอกขอบกระดาษ
//
// ที่มา: ป้ายบทบาทช่อง "ผู้อำนวยการกอง/หัวหน้ากอง" เปลี่ยนจากคำกลางความยาวคงที่
// มาเป็นชื่อตำแหน่งที่ อปท. พิมพ์เอง (ยาวได้ถึง 250 ตัวอักษร) ซึ่งอยู่ในคอลัมน์กว้าง 13em
// ที่สืบ white-space:nowrap มาจากแถว — ถ้าไม่ยอมให้ตัดบรรทัด ข้อความจะล้นออกนอก
// ขอบกระดาษแล้วหายเงียบๆ บนเอกสารที่เอาไปให้ผู้มีอำนาจเซ็น
//
// รันด้วย: node tests/fleet-form3-layout.test.mjs

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildFleetTripRequestHtml, resolveDeptHead, resolveOrderAuthority } from '../src/lib/fleetTripPrint.js'

const tenant = { name: 'เทศบาลตำบลสาธิต', province: 'แพร่' }

const trip = {
  id: 't1',
  status: 'approved',
  created_at: '2026-09-01T02:00:00.000Z',
  planned_departure: '2026-09-01T02:00:00.000Z',
  planned_return: '2026-09-01T09:00:00.000Z',
  destination: 'ศาลากลางจังหวัดแพร่ และสำนักงานส่งเสริมการปกครองท้องถิ่นจังหวัด',
  destination_locality: 'อำเภอเมืองแพร่',
  destination_province: 'แพร่',
  purpose: 'ประชุมชี้แจงแนวทางการปฏิบัติงานประจำปีงบประมาณ',
  passengers: 4,
  requester: { full_name: 'นางสาวจันทร์จิรา คันธสังข์', job_title: 'นักจัดการงานทั่วไปชำนาญการ' },
  requester_position: 'นักจัดการงานทั่วไปชำนาญการ',
  driver: { full_name: 'นายสมศักดิ์ ขับเคลื่อนยานยนต์' },
  vehicle: { license_plate: 'กข 1234 แพร่' },
  approved_by: 'x',
  approver: { full_name: 'นายสมนึก ธนเดชากุล' },
}

// ชื่อกองที่ยาวที่สุดที่เจอได้จริงใน อปท. — ยาวกว่าป้ายกลางเดิมเกือบเท่าตัว
const LONG_TITLE = 'ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม'

const A4_HEIGHT_PX = 1122   // 297mm ที่ 96dpi
const A4_WIDTH_PX = 794     // 210mm ที่ 96dpi

// ต้องระบุ channel: 'chrome' — เครื่องนี้ไม่มี chromium ที่ playwright บันเดิลมา
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()

async function measure(deptTitle) {
  const html = buildFleetTripRequestHtml({
    trip,
    tenant,
    orderAuthority: resolveOrderAuthority(
      { manual_name: 'นายสมนึก ธนเดชากุล', title_override: 'นายกเทศมนตรีตำบลสาธิต' }, tenant, 'mayor',
    ),
    deptHead: resolveDeptHead(
      deptTitle
        ? { manual_name: 'นางสาวจันทร์จิรา คันธสังข์', title_override: deptTitle }
        : null,
    ),
  })
  await page.setViewportSize({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX })
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const doc = document.documentElement
    const sheet = document.querySelector('.sheet') || document.body
    const roles = [...document.querySelectorAll('.signature-role')]
    return {
      // ต้องวัดตัวกระดาษ ไม่ใช่ scrollHeight ของเอกสาร — ตัวหลังเท่ากับความสูง viewport
      // เสมอเมื่อเนื้อหายังไม่ล้น จึงผ่านทุกครั้งจนกว่าจะพังไปแล้ว
      sheetHeight: Math.ceil(sheet.getBoundingClientRect().height),
      docHeight: Math.max(doc.scrollHeight, document.body.scrollHeight),
      docWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
      sheetRight: sheet.getBoundingClientRect().right,
      roles: roles.map(el => {
        const r = el.getBoundingClientRect()
        return { text: el.textContent.trim(), right: r.right, width: r.width, scrollWidth: el.scrollWidth }
      }),
    }
  })
}

// ── 1. ไม่ได้ตั้งผู้ลงนามของกอง = ต้องคงป้ายกลางไว้ ────────────────────────────────
const blank = await measure(null)
assert.ok(
  blank.roles.some(r => r.text === 'ผู้อำนวยการกอง/หัวหน้ากอง'),
  'ยังไม่ตั้งผู้ลงนามต้องคงป้ายกลางของแบบฟอร์มไว้ ห้ามเว้นว่าง',
)

// ── 2. ตั้งแล้ว = ป้ายเปลี่ยนเป็นชื่อตำแหน่งที่ระบุ ────────────────────────────────
const named = await measure('ผู้อำนวยการกองช่าง')
assert.ok(
  named.roles.some(r => r.text === 'ผู้อำนวยการกองช่าง'),
  'ป้ายบทบาทต้องใช้ชื่อตำแหน่งที่ อปท. ระบุไว้',
)
assert.ok(
  !named.roles.some(r => r.text === 'ผู้อำนวยการกอง/หัวหน้ากอง'),
  'เมื่อระบุตำแหน่งแล้วต้องไม่เหลือป้ายกลางค้างอยู่',
)

// ── 3. ตำแหน่งยาวสุดต้องไม่ล้นขอบกระดาษ และใบยังจบใน 1 หน้า ────────────────────────
const long = await measure(LONG_TITLE)
const longRole = long.roles.find(r => r.text === LONG_TITLE)
assert.ok(longRole, 'ต้องเจอป้ายบทบาทที่เป็นตำแหน่งยาว')
assert.ok(
  longRole.scrollWidth <= Math.ceil(longRole.width) + 1,
  `ป้ายบทบาทถูกตัดหาย: ต้องใช้ ${longRole.scrollWidth}px แต่มีให้ ${Math.round(longRole.width)}px`,
)
assert.ok(
  longRole.right <= long.sheetRight + 1,
  `ป้ายบทบาทล้นขอบกระดาษ: right=${Math.round(longRole.right)} ขอบ=${Math.round(long.sheetRight)}`,
)
assert.ok(
  long.docWidth <= A4_WIDTH_PX + 1,
  `เอกสารกว้างเกิน A4: ${long.docWidth}px > ${A4_WIDTH_PX}px`,
)
// วัดกับกรณีที่ยาวที่สุดเท่าที่ DB ยอม (title_override ≤ 250 ตัวอักษร) ไม่ใช่แค่ค่าที่เจอบ่อย
const extreme = await measure('ผู้อำนวยการกอง'.repeat(17))
assert.ok(
  extreme.sheetHeight <= A4_HEIGHT_PX,
  `ใบเกิน 1 หน้า A4 เมื่อชื่อตำแหน่งยาวสุด: ${extreme.sheetHeight}px > ${A4_HEIGHT_PX}px`,
)
assert.ok(
  long.sheetHeight <= A4_HEIGHT_PX,
  `ใบเกิน 1 หน้า A4 เมื่อชื่อตำแหน่งยาว: ${long.sheetHeight}px > ${A4_HEIGHT_PX}px`,
)

await browser.close()
console.log(`fleet form 3 layout assertions passed `
  + `(ตำแหน่งยาวปกติ ${long.sheetHeight}px, ยาวสุด ${extreme.sheetHeight}px / A4 ${A4_HEIGHT_PX}px)`)
process.exit(0)
