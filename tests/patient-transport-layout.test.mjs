// หนังสือนำส่ง + ใบคำขอรับสวัสดิการ (รถรับ-ส่งผู้ป่วย) — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง"
//
// วิธีเดียวกับ asset-borrow-layout.test.mjs: เรนเดอร์ HTML ด้วยเบราว์เซอร์จริงแล้ววัดจาก DOM
// ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล รันด้วย: node tests/patient-transport-layout.test.mjs
//
// ทำไมต้องมี: ทั้งสองใบต้องจบใบละ 1 แผ่น — หนังสือนำส่งที่ล้นไปหน้า 2 ทำให้ช่องลงนามของนายก
// หลุดไปอยู่คนละหน้ากับเนื้อความ ซึ่งเป็นเอกสารที่ใช้ไม่ได้ ส่วนใบคำขอมีตารางรายละเอียด
// ที่อยู่จุดรับยาวๆ ดันใบตกหน้า 2 ได้จริง (กล่องของคณะกรรมการกองทุนตัดออกแล้ว 2569-10-01)
//
// ⚠️ วัดที่ viewport 794px = 210mm พอดี เพราะโหมดพิมพ์ของใบชุดนี้ตั้ง .sheet เป็น width:auto
// แล้วให้ขอบกระดาษมาจาก padding (govPagePadding) — viewport กว้างกว่านี้ = ข้อความตัดบรรทัด
// น้อยกว่าตอนพิมพ์จริง แล้ววัดความสูงได้ต่ำกว่าความจริง

import assert from 'node:assert/strict'
import process from 'node:process'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import {
  buildBookingRequestFormHtml, buildBookingForwardLetterHtml, buildPatientTransportFormHtml, buildPatientTransportLetterHtml, buildPatientTransportPacketHtml,
  buildTripForwardLetterHtml, buildTripMonthReportHtml, tripPassengers, writeAndPrint, PRINT_DIALOG_DELAY_MS,
} from '../src/lib/patientTransportPrint.js'
import { bookingLetter } from '../src/lib/patientBooking.js'
import { thaiDateFromDateInput } from '../src/lib/thaiDate.js'
import { assertSignBlockStandard, assertSignLinesAligned, measureSignRows, measureTextCenterMm } from './lib/signBlockChecks.mjs'
import { addressFromMap, joinPickup, pickupSentence, stripForeignParts } from '../src/lib/pickupText.js'
import { collectionPointText } from '../src/lib/wasteCollectionRequestPrint.js'
import { meterPointText } from '../src/lib/waterSupplyRequestPrint.js'

const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
  org_type: 'อบต.',
  address: 'เลขที่ 199 หมู่ที่ 5 ตำบลทุ่งแค้ว',
  district: 'หนองม่วงไข่',
  province: 'แพร่',
  phone: '0-5460-0000',
  fax: '0-5460-0001',
}

const MAYOR = { name: 'นายสมศักดิ์ ตั้งใจพัฒนา', title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' }

// ค่ายาวที่สุดที่คาดว่าจะเจอจริง — ชื่อกองทุนเต็มพร้อมอำเภอ/จังหวัด ที่อยู่จุดรับเต็มรูปแบบ
// และหมายเหตุเที่ยวกลับที่ประชาชนพิมพ์เองจนเกือบเต็มเพดานของฐานข้อมูล
const HEADER = {
  municipality_id: 'muni-1',
  department_id: 'dept-1',
  partner_id: 'partner-1',
  partner_name_snapshot: 'กองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่',
  recipient_title_snapshot: 'ประธานคณะกรรมการกองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว',
  appointment_at: '2026-09-18T08:30:00+07:00',
  mobility: 'wheelchair',
  workflow_status: 'forwarded',
  consent_at: '2026-09-10T09:15:00+07:00',
  consent_version: 'ptr-consent-v1',
  forward_letter_no: 'พร 72301/1234',
  forward_letter_date: '2026-09-11',
}

const FORM = {
  requester_relation: 'relative',
  requester_relation_note: 'บุตรสาว',
  patient_name: 'นางประกายมาศ ศรีวิชัยเลิศสกุล',
  patient_age: 78,
  fund_member_no: 'ทค-2560-01234',
  beneficiary_of_name: 'นายบุญมี ศรีวิชัยเลิศสกุล',
  beneficiary_of_member_no: 'ทค-2559-00987',
  pickup_address: 'บ้านเลขที่ 199/25 หมู่ที่ 12 ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่ 54170',
  pickup_landmark: 'บ้านหลังคาสีน้ำเงิน ตรงข้ามศาลาประชาคมหมู่บ้าน ถัดจากร้านค้าชุมชน',
  destination: 'โรงพยาบาลแพร่',
  destination_detail: 'อาคารผู้ป่วยนอก ชั้น 2 คลินิกไตเทียม',
  appointment_kind: 'other',
  appointment_kind_note: 'ตรวจติดตามหลังผ่าตัดตามใบนัด',
  trip_type: 'round_trip',
  return_note: 'ขากลับประมาณ 14.00 น. หากแพทย์ตรวจเสร็จช้าจะโทรแจ้งเจ้าหน้าที่อีกครั้ง',
  mobility: 'wheelchair',
  companions: 1,
  consent_text: 'ข้าพเจ้ายินยอมให้องค์การบริหารส่วนตำบลทุ่งแค้วส่งข้อมูลในคำขอนี้...',
  consent_version: 'ptr-consent-v1',
  signed_at: '2026-09-10T09:15:00+07:00',
  signed_by: { channel: 'online', name: 'นางสาวสุดารัตน์ ศรีวิชัยเลิศสกุล' },
}

const PARENT = {
  requester_name: 'นางสาวสุดารัตน์ ศรีวิชัยเลิศสกุล',
  requester_phone: '081-234-5678',
  requester_address: 'บ้านเลขที่ 199/25 หมู่ที่ 12 ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่',
  created_at: '2026-09-10T09:15:00+07:00',
}

function args(overrides = {}) {
  return {
    header: HEADER,
    form: FORM,
    parent: PARENT,
    partner: { address: 'ที่ทำการกองทุนฯ หมู่ที่ 5 ตำบลทุ่งแค้ว', phone: '089-999-8888' },
    tenant: TENANT,
    mayor: MAYOR,
    referenceNo: 'A1B2C3D4',
    docDate: PARENT.created_at,
    emblemUrl: '',
    ...overrides,
  }
}

// --- ข้อมูลตัวอย่างของระบบจองคิวรถ — ค่ายาวที่สุดที่คาดได้จริง (เที่ยวเต็มคัน 8 คน) -------------
const PARTNER = {
  name: 'กองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่',
  recipient_title: 'ประธานคณะกรรมการกองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว',
}
const TRIP = {
  id: 'trip-1',
  plan: {
    date: '2026-10-05', pickup_at: '2026-10-05T06:45:00+07:00',
    route_label: 'โรงพยาบาลแพร่ — รับจากหมู่ 1 ถึงหมู่ 12 ตำบลทุ่งแค้ว (เส้นทางหลักผ่านตลาดสด)',
  },
  helper_name: 'นางสาวอาสาสมัคร ช่วยเคลื่อนย้ายดี',
  forward_letter_no: 'พร 72301/88',
  forward_letter_date: '2026-10-01',
}
const TRIP_BOOKINGS = Array.from({ length: 8 }, (_, i) => ({
  id: `b-${i}`, trip_id: 'trip-1', status: 'confirmed',
  patient_name: `นางทดสอบ ศรีวิชัยเลิศสกุลวงศ์${i + 1}`,
  appointment_at: `2026-10-05T0${8 + (i % 2)}:${i % 2 ? '30' : '00'}:00+07:00`,
  mobility: i === 0 ? 'wheelchair' : 'walk', companions: i % 3,
  return_mode: 'wait', return_at: '2026-10-05T12:00:00+07:00',
  requester_name: `นายผู้ยื่น ทดสอบ${i + 1}`, relation: 'relative', created_at: '2026-10-01T08:00:00+07:00',
  // ช่องทางที่คำขอเข้ามา (patient_bookings.entry_channel) — สลับให้เที่ยวเดียวมีทั้งคนที่จองเองกับคนที่เจ้าหน้าที่รับจองแทน
  entry_channel: i % 2 ? 'staff' : 'online',
  consent_at: '2026-10-01T08:00:00+07:00', consent_version: 'patient-booking-v1',
  // ข้อมูลติดต่อพิมพ์เฉพาะใบคำขอ พิกัดไม่พิมพ์
  phone: '0891234567', pickup: 'บ้านเลขที่ 88 หมู่ 3', pickup_lat: 18.1234, pickup_lng: 100.1234,
}))
const tripArgs = () => ({
  tenant: TENANT, trip: TRIP, bookings: TRIP_BOOKINGS, partner: PARTNER, mayor: MAYOR,
  emblemUrl: `data:image/svg+xml;base64,${readFileSync(new URL('../public/images/garuda.svg', import.meta.url)).toString('base64')}`,
})
const monthArgs = () => ({
  tenant: TENANT, partner: PARTNER,
  report: {
    month: '2026-10-01',
    // 20 เที่ยวจบแล้ว + 2 เที่ยวยังไม่ได้วิ่ง — ยอดรวมต้องนับเฉพาะ 20 เที่ยวแรก (ผลตรวจ #227 ข้อ 3)
    trips: Array.from({ length: 22 }, (_, i) => ({
      trip_id: `t-${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}`, state: i < 20 ? 'completed' : 'confirmed',
      route_label: 'โรงพยาบาลแพร่ — หมู่ 1 ถึงหมู่ 12', passengers: 4, companions: 3,
      odometer_start: i < 20 ? 12000 + i * 80 : null, odometer_end: i < 20 ? 12000 + i * 80 + 76 : null,
      distance: i < 20 ? 76 : null, driver_name: 'นายขับดี ปลอดภัยยิ่ง',
      // เลขหนังสือแยกรายคน (2569-10-02): เที่ยวที่ไปหลายคนรายงานรวมเป็น "เลข, เลข, เลข" ต้องตัดบรรทัดในช่องเดียว ไม่ดันตารางล้นกระดาษ
      letter_no: i === 3 ? 'พร 72301/103, พร 72301/104, พร 72301/105, พร 72301/106' : `พร 72301/${100 + i}`,
    })),
  },
})

async function render(browser, html) {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } })
  await page.setContent(html, { waitUntil: 'load' })
  // ต้องรอฟอนต์โหลดเสร็จก่อนวัด ไม่งั้นวัดความสูงด้วยฟอนต์สำรองแล้วได้ผลผิด
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

// พื้นที่ที่เนื้อหาใช้ได้จริง วัดจาก "ขอบบนของแผ่น" ถึงขอบล่างของเนื้อหาชิ้นสุดท้าย
// = 297mm − ขอบล่าง 9mm (ขอบบน 12mm นับรวมอยู่ในระยะนี้แล้วเพราะวัดจากขอบแผ่น)
const PRINT_HEIGHT_MM = 288
// เผื่อ 11mm ให้เครื่องที่ไม่มี THSarabunPSK แล้วตกไปใช้ Sarabun ซึ่ง metric ไม่เท่ากันเป๊ะ
// (ค่าเผื่อเท่ากับใบยืมพัสดุ ซึ่งไล่มาจากใบพิมพ์จริงแล้ว)
const ONE_PAGE_BUDGET_MM = 277

/** ความสูงที่เนื้อหาของแผ่นที่ index ใช้จริง — min-height ของ .sheet ไม่ถูกนับ */
function sheetContentMm(page, index) {
  return page.evaluate(order => {
    const sheet = document.querySelectorAll('.sheet')[order]
    const top = sheet.getBoundingClientRect().top
    const bottom = Math.max(...[...sheet.children].map(el => el.getBoundingClientRect().bottom))
    return (bottom - top) / 3.779527
  }, index)
}

// แผ่นของชุดเอกสารต้องหาจาก "ชนิดของแผ่น" ไม่ใช่เลขลำดับ — ลำดับเป็นเรื่องที่เจ้าของระบบสั่งเปลี่ยนได้
// (2569-10-01 สลับให้ใบคำขอขึ้นก่อนหนังสือนำส่ง) เทสต์ที่อ้างแผ่นด้วยเลขลำดับ ตอนสลับแล้ววัดผิดใบแบบเงียบๆ:
// ข้อ "หนังสือนำส่งจบ 1 หน้า" ไปวัดใบคำขอแทนแล้วยังผ่าน
const letterSheetOf = page => page.locator('.sheet').filter({ has: page.locator('.letter-sign') })
const formSheetsOf = page => page.locator('.sheet').filter({ has: page.locator('.form-title') })
/** ชนิดของแผ่นเรียงตามที่จะออกจากเครื่องพิมพ์ เช่น ['form', 'form', 'letter'] */
function sheetKinds(page) {
  return page.evaluate(() => [...document.querySelectorAll('.sheet')].map(sheet =>
    (sheet.querySelector('.letter-sign') ? 'letter' : sheet.querySelector('.fund-title') ? 'fund-form' : sheet.querySelector('.form-title') ? 'form' : 'other')))
}

const checks = [
  {
    name: 'fund-form-written-place-and-date-alignment',
    reason: 'เขียนที่ต้องชิดขวาและวันที่อยู่กลางบรรทัดถัดลงมา แม้ชื่อหน่วยงานยาวหรือยังไม่มีวันที่',
    async run(browser) {
      for (const [label, tenant, docDate] of [
        ['ปกติ', TENANT, '2026-09-27'],
        ['ชื่อหน่วยงานยาว', { ...TENANT, name: 'องค์การบริหารส่วนตำบลตัวอย่างชื่อท้องถิ่นยาวสำหรับตรวจตำแหน่งสถานที่เขียนและวันที่ในใบคำขอรับสวัสดิการ' }, '2026-09-27'],
        ['ยังไม่มีวันที่', TENANT, ''],
      ]) {
        const page = await render(browser, buildPatientTransportLetterHtml(args({ tenant, docDate })))
        try {
          const layout = await page.locator('.fund-form-sheet').evaluate(sheet => {
            // วัดข้อความจริงด้วย Range: กล่อง element กว้างเต็มช่องอาจกลบตำแหน่งข้อความที่ผิด
            const rects = selector => {
              const range = document.createRange()
              range.selectNodeContents(sheet.querySelector(selector))
              return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
                .map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }))
            }
            const table = sheet.querySelector('.fund-details').getBoundingClientRect()
            return { table: { left: table.left, right: table.right }, place: rects('.fund-written-label'), office: rects('.fund-written-office'), date: rects('.fund-written-date') }
          })
          const dateLeft = Math.min(...layout.date.map(rect => rect.left))
          const dateRight = Math.max(...layout.date.map(rect => rect.right))
          const written = [...layout.place, ...layout.office]
          const writtenRight = Math.max(...written.map(rect => rect.right))
          const writtenBottom = Math.max(...written.map(rect => rect.bottom))
          assert.ok(Math.abs(writtenRight - layout.table.right) < 1, `${label}: เขียนที่ไม่ชิดขอบขวา`)
          assert.ok(Math.abs((dateLeft + dateRight) / 2 - (layout.table.left + layout.table.right) / 2) < 1, `${label}: วันที่ไม่อยู่กึ่งกลางพื้นที่พิมพ์`)
          assert.ok(layout.date[0].top > writtenBottom, `${label}: วันที่ไม่ได้แยกอยู่ใต้สถานที่เขียน`)
          for (const rect of written) {
            assert.ok(rect.left >= layout.table.left - 1 && rect.right <= layout.table.right + 1, `${label}: สถานที่เขียนล้นพื้นที่พิมพ์`)
          }
          if (label === 'ชื่อหน่วยงานยาว') assert.ok(new Set(layout.office.map(rect => Math.round(rect.top))).size > 1, 'ไม่ได้ตรวจชื่อหน่วยงานที่ตัดบรรทัดจริง')
          if (!docDate) assert.equal(await page.locator('.fund-written-date .fill-blank').count(), 1)
          assert.deepEqual(await sheetKinds(page), ['letter', 'fund-form'])
          for (const sheet of [0, 1]) assert.ok(await sheetContentMm(page, sheet) <= ONE_PAGE_BUDGET_MM, `${label}: แผ่น ${sheet + 1} เกิน A4`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'separate-buttons-request-and-two-page-fund-packet',
    reason: 'ปุ่มแรกต้องออกใบคำขอถึงนายก 1 แผ่น ปุ่มที่สองต้องออกหนังสือและใบคำขอรับสวัสดิการ 2 แผ่นของรายที่เลือก',
    async run(browser) {
      for (const index of [0, 1]) {
        const booking = { ...TRIP_BOOKINGS[index], route_label: TRIP.plan.route_label, forward_letter_no: `พร 2569/${index + 1}` }
        const context = { ...tripArgs(), booking, bookings: [booking] }
        const request = await render(browser, buildBookingRequestFormHtml(context))
        const letter = await render(browser, buildBookingForwardLetterHtml(context))
        const packet = await render(browser, buildTripForwardLetterHtml(context))
        try {
          assert.deepEqual(await sheetKinds(request), ['form'])
          assert.deepEqual(await sheetKinds(letter), ['letter', 'fund-form'])
          assert.equal(await formSheetsOf(request).innerText(), await formSheetsOf(packet).innerText(), 'ใบคำขอแยกต้องใช้ข้อมูลเดียวกับชุดเดิม')
          const oldLetterText = (await letterSheetOf(packet).innerText()).replace('ใบคำขอรถรับ-ส่งผู้ป่วย', 'ใบคำขอรับสวัสดิการ (รถรับ-ส่งผู้ป่วย)')
          assert.equal(await letterSheetOf(letter).innerText(), oldLetterText, 'หนังสือต้องคงเนื้อหาและเลขของรายนี้ เปลี่ยนเฉพาะชื่อใบแนบ')
          assert.equal(await request.locator('.screen-note').count(), 0, 'ยืนยันรถแล้วต้องไม่บอกว่ายังไม่ยืนยัน')
          assert.ok((await letterSheetOf(letter).innerText()).includes(booking.forward_letter_no))
          assert.ok(!(await letterSheetOf(letter).innerText()).includes(TRIP_BOOKINGS[1 - index].patient_name), 'หนังสือมีผู้เดินทางอื่นติดมา')
          for (const page of [request, letter]) {
            for (let sheet = 0; sheet < await page.locator('.sheet').count(); sheet++) {
              assert.ok(await sheetContentMm(page, sheet) <= ONE_PAGE_BUDGET_MM, `แผ่น ${sheet + 1} เกิน A4 หน้าเดียว`)
            }
            assert.equal(await page.locator('.print-window-close').count(), 1, 'หน้าต่างต้องมีปุ่มปิด')
          }
          await assertSignBlockStandard(request, { minRows: 1, minBelow: 1 })
          await assertSignBlockStandard(letter, { minRows: 3, minBelow: 5 })
          await assertSignLinesAligned(letter, '.fund-committee .sign-row')
          const fund = letter.locator('.fund-form-sheet')
          assert.ok((await fund.locator('.kv').last().innerText()).includes(PARTNER.recipient_title))
          assert.equal(await fund.locator('.fund-details tr').count(), 8)
          assert.ok((await fund.locator('.fund-details').innerText()).includes(booking.patient_name))
          assert.ok(!(await fund.innerText()).includes(TRIP_BOOKINGS[1 - index].patient_name))
          assert.equal(await fund.locator('.fund-committee .box--on, .fund-committee .sign-signed').count(), 0, 'ห้ามระบบอนุมัติหรือลงนามแทนกรรมการ')
          // ช่องลงนามของกองทุนมี 2 ช่อง: ประธานคณะกรรมการกองทุน กับ "พยาน" เท่านั้น (เจ้าของระบบสั่งเอา "เหรัญญิก" ออก 2569-10-04)
          assert.deepEqual(await fund.locator('.fund-committee .sign-row').evaluateAll(rows => rows.map(row => row.querySelector('.sign-below:last-child').innerText.trim())), ['ประธานคณะกรรมการกองทุน', 'พยาน'], 'ช่องลงนามกองทุนต้องเหลือประธานกับพยาน')
          assert.ok(!(await fund.innerText()).includes('เหรัญญิก'), 'ใบคำขอรับสวัสดิการต้องไม่มีคำว่าเหรัญญิก')
          assert.equal((await fund.locator('.fund-details tr').filter({ hasText: 'ประเภทการนัด' }).locator('td').innerText()).trim(), '', 'ไม่มีข้อมูลประเภทนัดต้องไม่เดา')
          if (index === 0 && process.env.PATIENT_PRINT_SCREENSHOT_DIR) {
            for (const [name, page] of [['request', request], ['letter', letter]]) {
              await page.screenshot({ path: `${process.env.PATIENT_PRINT_SCREENSHOT_DIR}/patient-separated-${name}.png`, clip: { x: 0, y: 0, width: 794, height: 1123 } })
            }
          }
        } finally { await request.close(); await letter.close(); await packet.close() }
      }
      const booking = TRIP_BOOKINGS[0]
      for (const override of [
        { trip: null }, { trip: { ...TRIP, id: 'other-trip' } },
        { booking: { ...booking, status: 'submitted' } }, { trip: { ...TRIP, state: 'cancelled' } },
      ]) assert.throws(() => buildBookingForwardLetterHtml({ ...tripArgs(), booking, ...override }), /หลังยืนยันรถ/)
      const legacy = await render(browser, buildPatientTransportLetterHtml(args()))
      try {
        assert.deepEqual(await sheetKinds(legacy), ['letter', 'fund-form'], 'ทางเข้าคำขอเดิมต้องพิมพ์ชุดถึงกองทุนครบ 2 แผ่น')
        for (const sheet of [0, 1]) assert.ok(await sheetContentMm(legacy, sheet) <= ONE_PAGE_BUDGET_MM)
        await assertSignBlockStandard(legacy, { minRows: 3, minBelow: 5 })
      } finally { await legacy.close() }
    },
  },
  {
    name: 'citizen-to-mayor-and-office-to-fund',
    reason: 'ใบคำขอของประชาชนต้องเรียนถึงนายก อปท. ส่วนหนังสือนำส่งเรียนถึงกองทุน ใช้ชื่อผู้รับคนละแหล่ง',
    async run(browser) {
      for (const [tenant, recipient] of [
        [TENANT, 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว'],
        [{ ...TENANT, name: 'เทศบาลตำบลน้ำเลา', org_type: 'เทศบาลตำบล' }, 'นายกเทศมนตรีตำบลน้ำเลา'],
      ]) {
        for (const html of [
          buildPatientTransportPacketHtml(args({ tenant })),
          buildPatientTransportFormHtml(args({ tenant })),
          buildTripForwardLetterHtml({ ...tripArgs(), tenant, bookings: TRIP_BOOKINGS.slice(0, 2) }),
        ]) {
          const page = await render(browser, html)
          try {
            for (const sheet of await page.locator('.sheet').all()) {
              const isForm = await sheet.locator('.form-title').count() > 0
              const addressee = await sheet.locator('.kv').filter({ hasText: /^เรียน/ }).innerText()
              assert.equal(addressee.replace(/^เรียน\s*/, '').trim(), isForm ? recipient : HEADER.recipient_title_snapshot)
              if (isForm) {
                assert.equal(await sheet.locator('.form-title').innerText(), 'ใบคำขอรถรับ-ส่งผู้ป่วย')
                assert.ok((await sheet.locator('.form-request').innerText()).includes(`ขอให้${tenant.name}ประสาน`))
                const overlaps = await sheet.evaluate(el => {
                  const rect = selector => {
                    const range = document.createRange()
                    range.selectNodeContents(el.querySelector(selector))
                    return range.getBoundingClientRect()
                  }
                  const title = rect('.form-title'), reference = rect('.form-no')
                  return title.left < reference.right && title.right > reference.left && title.top < reference.bottom && title.bottom > reference.top
                })
                assert.equal(overlaps, false, 'ชื่อแบบพิมพ์ทับเลขที่คำขอ')
              }
            }
          } finally { await page.close() }
        }
      }
    },
  },
  {
    name: 'forward-letter-one-page',
    reason: 'หนังสือนำส่งที่ล้นหน้า 2 ทำให้ช่องลงนามนายกหลุดไปคนละหน้ากับเนื้อความ ใช้ไม่ได้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const mm = await sheetContentMm(page, (await sheetKinds(page)).indexOf('letter'))
        assert.ok(mm <= ONE_PAGE_BUDGET_MM,
          `หนังสือนำส่งสูง ${mm.toFixed(1)}mm เกินงบ ${ONE_PAGE_BUDGET_MM}mm `
          + `(พื้นที่ ${PRINT_HEIGHT_MM}mm) — ทบทวนระยะเว้นก่อนช่องลงนามหรือความยาวย่อหน้า`)
      } finally { await page.close() }
    },
  },
  {
    name: 'welfare-form-one-page',
    reason: 'ใบคำขอมีตารางรายละเอียด + ช่องลงนามผู้ยื่น ที่อยู่ยาวๆ ดันตกหน้า 2 ได้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const mm = await sheetContentMm(page, (await sheetKinds(page)).indexOf('form'))
        assert.ok(mm <= ONE_PAGE_BUDGET_MM,
          `ใบคำขอสูง ${mm.toFixed(1)}mm เกินงบ ${ONE_PAGE_BUDGET_MM}mm`)
      } finally { await page.close() }
    },
  },
  {
    name: 'packet-is-two-sheets',
    reason: 'ชุดที่ส่งกองทุนต้องมี 2 แผ่นเสมอ และแผ่นที่ 2 ต้องขึ้นหน้าใหม่ ไม่ต่อท้ายแผ่นแรก',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const info = await page.evaluate(() => {
          const sheets = [...document.querySelectorAll('.sheet')]
          return {
            count: sheets.length,
            breakBefore: sheets[1] ? getComputedStyle(sheets[1]).breakBefore : '',
          }
        })
        assert.equal(info.count, 2, `ได้ ${info.count} แผ่น ต้องเป็น 2 แผ่น`)
        assert.equal(info.breakBefore, 'page', 'แผ่นที่ 2 ไม่ได้ตั้ง break-before: page')
      } finally { await page.close() }
    },
  },
  {
    // เจ้าของระบบสั่ง 2569-10-01: เรียงกระดาษตามลำดับเรื่อง "ประชาชนแจ้งนายก → นายกส่งต่อกองทุน"
    // เดิมหนังสือนำส่งออกก่อนใบคำขอ ห้ามสลับกลับเองโดยไม่ถาม — ลำดับประกอบที่ packetBody() ในไฟล์ใบพิมพ์จุดเดียว
    name: 'packet-prints-request-before-letter',
    reason: 'ชุดเอกสารต้องพิมพ์ใบคำขอ (ประชาชน → นายก) ครบทุกใบก่อน แล้วปิดท้ายด้วยหนังสือนำส่ง (นายก → กองทุน) ฉบับเดียว'
      + ' ทั้งสองทางที่พิมพ์ชุดเอกสาร',
    async run(browser) {
      const byAppointment = bookings => [...bookings]
        .sort((a, b) => String(a.appointment_at).localeCompare(String(b.appointment_at)))
        .map(b => `คำขอผ่าน E-Service ${String(b.id).slice(0, 8).toUpperCase()}`)
      const cases = [
        ['ชุดเอกสารคำขอ (ระบบคำขอแบบเดิม)', buildPatientTransportPacketHtml(args()), ['คำขอผ่าน E-Service A1B2C3D4'], false],
        ...[1, 2, 8].map(count => [`หนังสือต่อเที่ยว ${count} คน`,
          buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, count) }),
          byAppointment(TRIP_BOOKINGS.slice(0, count)), false]),
        ['หนังสือต่อเที่ยว 2 คน ทะเบียนไม่มีชื่อนายก',
          buildTripForwardLetterHtml({ ...tripArgs(), mayor: null, bookings: TRIP_BOOKINGS.slice(0, 2) }),
          byAppointment(TRIP_BOOKINGS.slice(0, 2)), true],
      ]
      for (const [label, html, references, notice] of cases) {
        const page = await render(browser, html)
        try {
          assert.deepEqual(await sheetKinds(page), [...references.map(() => 'form'), 'letter'],
            `${label}: ลำดับแผ่นต้องเป็น ใบคำขอทุกใบ → หนังสือนำส่ง`)
          // ร่วมเที่ยวหลายคน: ใบคำขอเรียงตามเวลานัดเหมือนเดิม ไม่สลับเพราะย้ายหนังสือไปท้าย
          const printed = (await formSheetsOf(page).locator('.form-no').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim())
          assert.deepEqual(printed, references, `${label}: ใบคำขอไม่ได้เรียงตามเวลานัด`)
          const layout = await page.evaluate(() => ({
            breaks: [...document.querySelectorAll('.sheet')].slice(1).map(sheet => getComputedStyle(sheet).breakBefore),
            first: document.body.firstElementChild.className,
          }))
          assert.ok(layout.breaks.every(value => value === 'page'), `${label}: มีแผ่นที่ไม่ได้ขึ้นหน้าใหม่ (${layout.breaks.join(', ')})`)
          // แถบเตือนชื่อนายกอยู่บนสุดของหน้าต่างเสมอ ไม่ย้ายตามหนังสือไปท้ายชุด — คนพิมพ์ต้องเห็นทันทีที่เปิด
          assert.equal(layout.first, notice ? 'screen-note' : 'sheet', `${label}: สิ่งแรกในหน้าต่างพิมพ์`)
        } finally { await page.close() }
      }
    },
  },
  {
    // ⚠️ #368/#371 (พิมพ์ทั้งเที่ยวชุดเดียว) เลิกแล้ว — เจ้าของระบบสั่งกลับ 2569-10-02 ให้เอกสารแยกรายคน (ดู letter-is-per-person-with-own-number)
    // ข้อนี้ยังเก็บไว้เพราะหน้าจอยังใช้ tripPassengers ตัวเดียวกับตัวประกอบใบพิมพ์ตีกรอบกลุ่มเที่ยว (จำนวนคนในหัวกรอบ)
    // และตัวประกอบยังรับหลายคนได้ — ล็อกว่ารายชื่อที่ใช้นับ = ใบคำขอที่ตัวประกอบออกให้จริง เรียงเหมือนกัน
    name: 'screen-count-matches-printed-forms',
    reason: 'จำนวนแผ่นและรายชื่อที่หน้าจอเจ้าหน้าที่บอกก่อนกดพิมพ์ต้องเท่ากับกระดาษที่ออกจริง'
      + ' คำขอที่ยกเลิก ยังรอยืนยัน หรืออยู่เที่ยวอื่น ต้องไม่ถูกนับทั้งบนจอและบนกระดาษ',
    async run(browser) {
      const mixed = [
        ...TRIP_BOOKINGS.slice(0, 3),
        { ...TRIP_BOOKINGS[3], id: 'b-cancelled', status: 'cancelled' },
        { ...TRIP_BOOKINGS[4], id: 'b-submitted', status: 'submitted' },
        { ...TRIP_BOOKINGS[5], id: 'b-other-trip', trip_id: 'trip-2' },
        { ...TRIP_BOOKINGS[6], id: 'b-done', status: 'completed' },
      ]
      assert.deepEqual(tripPassengers(mixed, TRIP).map(b => b.id).sort(), ['b-0', 'b-1', 'b-2', 'b-done'],
        'นับเฉพาะคำขอที่ยืนยันแล้ว/จบแล้วของเที่ยวนี้')
      const refOf = b => `คำขอผ่าน E-Service ${String(b.id).slice(0, 8).toUpperCase()}`
      for (const bookings of [mixed, [...mixed].reverse(), mixed.slice(0, 1)]) {
        const riders = tripPassengers(bookings, TRIP)
        const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), bookings }))
        try {
          const printed = (await formSheetsOf(page).locator('.form-no').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim())
          assert.deepEqual(printed, riders.map(refOf), 'ใบคำขอที่พิมพ์ต้องตรงกับรายชื่อที่หน้าจอใช้นับ ทั้งจำนวนและลำดับ')
          assert.deepEqual(await sheetKinds(page), [...riders.map(() => 'form'), 'letter'], `จอบอก ${riders.length + 1} แผ่น กระดาษต้องออกเท่านั้น`)
        } finally { await page.close() }
      }
    },
  },
  {
    // เจ้าของระบบสั่ง 2569-10-02 (แบบ ก): คำขอที่ยังรอยืนยันรถพิมพ์ใบคำขอถึงนายกได้เลย ยังไม่มีเที่ยวจึงยังไม่มีหนังสือนำส่ง
    // ใบที่พิมพ์ตอนนี้ต้องเป็นใบเดียวกับที่จะออกในชุดของเที่ยวหลังยืนยันรถ (ประกอบจาก bookingPacket() ตัวเดียวกัน)
    // ไม่มีแถบบนจอบอกเรื่องหนังสือถึงกองทุน (เคยมี #373 — สั่งเอาออก 2569-10-05 เจ้าหน้าที่งง) ปุ่มหนังสือแยกอยู่ในแผ่นรายละเอียดอยู่แล้ว
    name: 'pending-request-form-matches-trip-packet',
    reason: 'ใบคำขอที่พิมพ์ตอนรอยืนยันรถต้องตรงกับใบในชุดหลังยืนยันทุกตัวอักษร มีแผ่นเดียว ไม่มีหนังสือนำส่ง จบ 1 หน้า'
      + ' และต้องไม่มีแถบหรือข้อความบนจอใดๆ ทั้งโหมดจอ โหมดพิมพ์ และซอร์ส',
    async run(browser) {
      // 0 = ผู้จองยื่นเองออนไลน์ · 1 = เจ้าหน้าที่รับจองแทน (บรรทัดกำกับใต้ชื่อต่างกัน ต้องตรงกันทั้งสองแบบ)
      for (const index of [0, 1]) {
        const booking = { ...TRIP_BOOKINGS[index], route_label: TRIP.plan.route_label }
        const pending = { ...booking, status: 'submitted', trip_id: null }
        const single = await render(browser, buildBookingRequestFormHtml({ tenant: TENANT, partner: PARTNER, mayor: MAYOR, booking: pending }))
        const packet = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), bookings: [booking] }))
        try {
          assert.deepEqual(await sheetKinds(single), ['form'], 'รอยืนยันรถต้องได้ใบคำขอแผ่นเดียว')
          assert.equal(await single.locator('.letter-sign, .letter-head, .emblem').count(), 0, 'รอยืนยันรถต้องไม่มีหนังสือนำส่ง')
          const formText = page => formSheetsOf(page).first().innerText()
          assert.equal(await formText(single), await formText(packet), 'ใบที่พิมพ์ตอนรอยืนยันรถต้องตรงกับใบในชุดหลังยืนยันรถ')
          const mm = await sheetContentMm(single, 0)
          assert.ok(mm <= ONE_PAGE_BUDGET_MM, `ใบคำขอตอนรอยืนยันรถสูง ${mm.toFixed(1)}mm เกินงบ ${ONE_PAGE_BUDGET_MM}mm`)
          await assertSignBlockStandard(single, { minRows: 1, minBelow: 1 })
          // เจ้าของระบบสั่งเอาแถบบนจอ "ยังไม่ยืนยันรถ จึงมีเฉพาะใบคำขอถึงนายก · หนังสือนำส่งกองทุนพิมพ์ได้หลังยืนยันรถจากปุ่มแยก" ออก (2569-10-05)
          // เจ้าหน้าที่งง กลัวข้อความนั้นพิมพ์ออกมาด้วย — ทั้งโหมดจอและโหมดพิมพ์ต้องไม่มีแถบและไม่มีข้อความนั้นเลย ซอร์สก็ต้องไม่มี (comment ในแม่แบบติดไปกับใบ)
          for (const media of ['print', 'screen']) {
            await single.emulateMedia({ media })
            assert.equal(await single.locator('.screen-note').count(), 0, `โหมด ${media}: ใบคำขอตอนรอยืนยันรถต้องไม่มีแถบบนจอใดๆ`)
            const body = await single.evaluate(() => document.body.textContent)
            for (const part of ['ยังไม่ยืนยันรถ', 'หนังสือนำส่งกองทุนพิมพ์ได้หลังยืนยันรถ', 'จากปุ่มแยก', 'ข้อความนี้ไม่ถูกพิมพ์']) {
              assert.ok(!body.includes(part), `โหมด ${media}: ใบไม่ควรมีข้อความ "${part}"`)
            }
          }
          const source = await single.content()
          // (ไม่ตรวจคำว่า screen-note ในซอร์ส: กฎ CSS ของแถบเป็นของส่วนกลาง ใช้กับแถบชื่อนายกของหนังสือนำส่งด้วย — ตรวจที่ DOM ด้านบนแล้ว)
          for (const part of ['ยังไม่ยืนยันรถ', 'จากปุ่มแยก']) assert.ok(!source.includes(part), `ซอร์สใบคำขอตอนรอยืนยันรถต้องไม่มี "${part}"`)
          if (index === 0 && process.env.PATIENT_PRINT_SCREENSHOT_DIR) {
            await single.screenshot({ path: `${process.env.PATIENT_PRINT_SCREENSHOT_DIR}/patient-pending-request-on-screen.png`, clip: { x: 0, y: 0, width: 794, height: 1123 } })
          }
        } finally { await single.close(); await packet.close() }
      }
      assert.throws(() => buildBookingRequestFormHtml({ tenant: TENANT, partner: PARTNER }), /ไม่พบคำขอ/, 'ไม่มีคำขอต้องไม่พิมพ์ใบเปล่า')
    },
  },
  {
    name: 'citizen-form-has-no-letter',
    reason: 'ประชาชนออกหนังสือราชการของ อปท. เองไม่ได้ ปุ่มฝั่งประชาชนต้องได้ใบคำขอใบเดียว',
    async run(browser) {
      const page = await render(browser, buildPatientTransportFormHtml(args()))
      try {
        const info = await page.evaluate(() => ({
          sheets: document.querySelectorAll('.sheet').length,
          letterParts: document.querySelectorAll('.letter-sign, .letter-head, .emblem').length,
          text: document.body.innerText,
        }))
        assert.equal(info.sheets, 1, `ได้ ${info.sheets} แผ่น ต้องเป็น 1 แผ่น`)
        // ⚠️ "ขอแสดงความนับถือ" ใช้เป็นตัวจับหนังสือนำส่งไม่ได้แล้ว — ใบคำขอแบบประโยคลงท้ายด้วยคำนี้เอง (2569-10-01)
        assert.equal(info.letterParts, 0, 'ใบของประชาชนมีส่วนของหนังสือนำส่ง (หัวหนังสือ/ครุฑ/ช่องลงนามนายก) ติดมาด้วย')
        assert.ok(!info.text.includes('สิ่งที่ส่งมาด้วย'), 'ใบของประชาชนมีบรรทัด "สิ่งที่ส่งมาด้วย" ของหนังสือนำส่งติดมาด้วย')
        assert.ok(!info.text.includes(MAYOR.name),
          'ใบของประชาชนมีชื่อผู้บริหาร อปท. ในช่องลงนาม ซึ่งไม่ควรมี')
      } finally { await page.close() }
    },
  },
  {
    name: 'no-horizontal-overflow',
    reason: 'พื้นที่พิมพ์กว้าง 16 ซม. ตาราง หัวหนังสือ หรือช่องลงนามล้นขอบขวาไม่ได้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll('.sheet')].flatMap((sheet, index) => {
            const style = getComputedStyle(sheet)
            const inner = sheet.getBoundingClientRect().width
              - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            return [...sheet.querySelectorAll('table, .two-col, .letter-head')]
              .map(el => ({ index, diff: el.getBoundingClientRect().width - inner }))
              .filter(entry => entry.diff > 1)
          }))
        assert.deepEqual(overflow, [],
          `มีบล็อกล้นขอบขวา: ${overflow.map(e => `แผ่น ${e.index + 1} เกิน ${e.diff.toFixed(1)}px`).join(', ')}`)
      } finally { await page.close() }
    },
  },
  {
    // ⚠️ ของเดิมวัดจุดกึ่งกลางจาก getBoundingClientRect() ของ span ซึ่งเป็นวิธีที่เคยให้ผล
    // "ผ่านลวง" มาแล้วในใบยืมพัสดุ (ของจริงเยื้องขวา 16-25mm แต่เทสต์ผ่าน เพราะกล่องของ span
    // อยู่กลางแกนเสมอ) ย้ายมาใช้ตัวตรวจกลางที่วัดกล่องตัวอักษรจริงด้วย Range แทน
    name: 'signature-block-standard',
    reason: 'ช่องลงนามทุกจุดต้องได้มาตรฐานกลาง — บรรทัดใต้เส้นกึ่งกลางบนแกนของเส้น และวงเล็บกว้างเท่าเส้น',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        // เหลือช่องผู้ยื่นคำขอช่องเดียว (ชื่อในวงเล็บใต้เส้น 1 บรรทัด) — ช่องกรรมการกองทุน 2 ช่องตัดออกแล้ว 2569-10-01
        await assertSignBlockStandard(page, { minRows: 1, minBelow: 1 })
      } finally { await page.close() }
    },
  },
  {
    name: 'gov-font-standard',
    reason: 'ทุกใบต้องใช้ THSarabunPSK 14pt + font-size-adjust ตามมาตรฐานกลาง ห้ามย่อฟอนต์เนื้อความ',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const style = await page.evaluate(() => {
          const computed = getComputedStyle(document.body)
          return {
            family: computed.fontFamily,
            sizePx: parseFloat(computed.fontSize),
            adjust: computed.fontSizeAdjust,
          }
        })
        assert.match(style.family, /THSarabunPSK/, 'ไม่ได้ใช้ฟอนต์ THSarabunPSK')
        // 14pt = 18.67px — เผื่อปัดเศษ
        assert.ok(style.sizePx > 18.5 && style.sizePx < 19,
          `ขนาดตัวอักษร ${style.sizePx}px ไม่ใช่ 14pt`)
        assert.equal(style.adjust, '0.45', `font-size-adjust = ${style.adjust} ต้องเป็น 0.45`)
      } finally { await page.close() }
    },
  },
  {
    name: 'pdpa-note-present-and-form-has-no-template-note',
    reason: 'ย่อหน้าเงื่อนไขการใช้ข้อมูลในหนังสือนำส่งเป็นเนื้อหาบังคับ ห้ามหายไปเงียบๆ'
      + ' · ส่วนย่อหน้ากำกับที่มาของแบบ (พอช. / ให้ใช้แบบของกองทุน) เจ้าของระบบสั่งลบ 2569-10-02'
      + ' และประโยค "การพิจารณาเป็นอำนาจของคณะกรรมการกองทุน มิใช่ของ อปท." สั่งตัด 2569-10-01'
      + ' (ใบนี้ยื่นต่อนายก เรื่องจบที่นายก) ทั้งสองอย่างต้องไม่กลับมาในทุกทางที่พิมพ์ใบคำขอ',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const text = await page.evaluate(() => document.body.innerText)
        assert.ok(text.includes('ให้ความยินยอมเป็นการเฉพาะ'),
          'หนังสือนำส่งไม่มีย่อหน้าแจ้งฐานความยินยอม')
        assert.ok(text.includes('หยุดใช้ข้อมูลเมื่อเสร็จภารกิจ'),
          'หนังสือนำส่งไม่ได้จำกัดขอบเขตการใช้ข้อมูลของผู้รับ')
      } finally { await page.close() }
      for (const [label, html] of [
        ['ชุดเอกสารคำขอ', buildPatientTransportPacketHtml(args())],
        ['ใบคำขอฝั่งประชาชน', buildPatientTransportFormHtml(args())],
        ['หนังสือต่อเที่ยว', buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 2) })],
      ]) {
        const sheets = await render(browser, html)
        try {
          assert.equal(await sheets.locator('.note-template').count(), 0,
            `${label}: ย่อหน้ากำกับที่มาของแบบกลับมาแล้ว (สั่งลบ 2569-10-02)`)
          const body = await sheets.locator('body').innerText()
          for (const phrase of [
            'สถาบันพัฒนาองค์กรชุมชน',
            'หากกองทุนมีแบบของตนเองให้ใช้แบบนั้นแทน',
            'การพิจารณาเป็นอำนาจของคณะกรรมการกองทุน',
          ]) {
            assert.ok(!body.includes(phrase), `${label}: ข้อความที่สั่งลบไปโผล่ในเอกสาร — "${phrase}"`)
          }
          // ท้ายใบต้องเหลือบรรทัดกำกับที่มาไว้เสมอ ไม่งั้นคนถือกระดาษไม่รู้ว่าออกจากระบบของ อปท. ไหน
          assert.ok(body.includes('ผ่านระบบ E-Service'),
            `${label}: ท้ายใบไม่เหลือบรรทัดกำกับที่มา "ผ่านระบบ E-Service …"`)
        } finally { await sheets.close() }
      }
    },
  },
  {
    name: 'form-offers-patient-transport-only',
    reason: 'ระบบเปิดรับเรื่องรถรับ-ส่งผู้ป่วยเรื่องเดียว ช่องหมวดอื่นของแบบ พอช. ทำให้เข้าใจผิดว่ายื่นเรื่องอื่นได้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportFormHtml(args()))
      try {
        const text = await page.evaluate(() => document.body.innerText)
        for (const word of ['เสียชีวิต', 'เยี่ยมไข้', 'ทุนการศึกษา', 'รับขวัญบุตร', 'อื่นๆ (ระบุ)']) {
          assert.ok(!text.includes(word), `ใบคำขอยังพิมพ์หมวด "${word}" อยู่`)
        }
        assert.ok(/เรื่อง\s+ขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย/.test(text),
          'หัวเรื่องของใบคำขอต้องเป็น "ขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย" ตรงกับหนังสือนำส่ง')
      } finally { await page.close() }
    },
  },
  {
    // เจ้าของระบบสั่ง 2569-10-01: "ใบคำขอรถรับ-ส่งผู้ป่วย ไม่ต้องใช้แบบตาราง ให้เป็นประโยคดีกว่า"
    // ข้อมูลชุดเดียวกับตารางเดิมทุกรายการ เขียนเป็น 2 ย่อหน้า + คำลงท้ายแบบเดียวกับแบบคำร้องใบอื่นของระบบ
    // ⚠️ ถ้อยคำในข้อนี้คือถ้อยคำบนกระดาษจริง — แก้ประโยคในไฟล์ใบพิมพ์ต้องแก้ที่นี่คู่กัน และต้องให้เจ้าของระบบเห็นก่อน
    name: 'request-form-is-prose-not-table',
    reason: 'ใบคำขอต้องเป็นประโยค ไม่ใช่ตาราง — ข้อมูลครบเท่าตารางเดิม วลีของข้อมูลที่ระบบไม่มีต้องหายทั้งวลี (ไม่เหลือป้ายลอย)'
      + ' ข้อมูลหลักที่ขาดไม่ได้ต้องเหลือเส้นประให้เขียนมือ และผู้ป่วยยื่นเองต้องใช้ "ข้าพเจ้า" ตลอดใบ',
    async run(browser) {
      const WHEN = String.raw`\d{1,2} \S+ 25\d\d เวลา \d{2}\.\d{2} น\.`
      const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // ประโยคที่คาดไว้ โดย {WHEN} คือวันเวลานัด (แสดงตามเวลาเครื่องที่พิมพ์ จึงตรวจรูปแบบ ไม่ล็อกชั่วโมง)
      const sentence = template => new RegExp(`^${template.split('{WHEN}').map(escapeRe).join(WHEN)}$`)
      const read = async (html, shotFile) => {
        const page = await render(browser, html)
        try {
          const forms = formSheetsOf(page)
          if (shotFile && process.env.PATIENT_PRINT_SCREENSHOT_DIR) {
            await forms.first().screenshot({ path: `${process.env.PATIENT_PRINT_SCREENSHOT_DIR}/${shotFile}` })
          }
          return await forms.evaluateAll(sheets => sheets.map(sheet => {
            const text = selector => sheet.querySelector(selector)?.innerText.replace(/\s+/g, ' ').trim() ?? ''
            const order = ['.form-request', '.form-travel', '.evidence', '.form-closing', '.form-regards', '.sign-block']
              .map(selector => sheet.querySelector(selector))
            return {
              tables: sheet.querySelectorAll('table').length,
              request: text('.form-request'), travel: text('.form-travel'),
              closing: text('.form-closing'), regards: text('.form-regards'),
              blanks: {
                request: sheet.querySelectorAll('.form-request .fill-blank').length,
                travel: sheet.querySelectorAll('.form-travel .fill-blank').length,
              },
              inOrder: order.every(Boolean) && order.every((el, i) => i === 0
                || (order[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
              // "ผู้ป่วย" ในถ้อยคำคงที่ของประโยคต้องอยู่ใน .nb ทุกจุด ไม่งั้นขึ้นบรรทัดใหม่แล้วขาดกลางคำเป็น "ผู้|ป่วย"
              looseWord: [...sheet.querySelectorAll('.form-request, .form-travel')]
                .flatMap(paragraph => [...paragraph.childNodes])
                .filter(node => node.nodeType === 3 && node.textContent.includes('ผู้ป่วย')).length,
              // เวลา "14.00 น." ต้องไม่ขาดคนละบรรทัด: ทุกเวลาในย่อหน้าการเดินทางต้องอยู่ในกล่องห้ามตัดบรรทัด
              splitTimes: (sheet.querySelector('.form-travel')?.innerText.match(/\d{1,2}[.:]\d{2}\s?น\./g) ?? []).length
                - [...(sheet.querySelector('.form-travel')?.querySelectorAll('.nb') ?? [])]
                  .reduce((sum, el) => sum + (el.textContent.match(/\d{1,2}[.:]\d{2}\s?น\./g) ?? []).length, 0),
              all: sheet.innerText,
            }
          }))
        } finally { await page.close() }
      }
      const request = `มีความประสงค์ขอให้${TENANT.name}ประสานขอความอนุเคราะห์รถรับ-ส่งผู้ป่วยจาก`
      const booker = TRIP_BOOKINGS[0]
      const tripWith = overrides => buildTripForwardLetterHtml({ ...tripArgs(), bookings: [{ ...booker, ...overrides }] })

      // 1) คำขอแบบเดิม ข้อมูลครบทุกช่อง (ค่ายาวสุด) — ทุกรายการของตารางเดิมต้องอยู่ในประโยค
      const [full] = await read(buildPatientTransportFormHtml(args()), 'patient-form-prose-full.png')
      assert.equal(full.request,
        `ข้าพเจ้า ${PARENT.requester_name} สมาชิกกองทุนเลขที่ ${FORM.fund_member_no} ที่อยู่ ${PARENT.requester_address}`
        + ` โทรศัพท์ ${PARENT.requester_phone} ในฐานะผู้รับผลประโยชน์ของ ${FORM.beneficiary_of_name} สมาชิกเลขที่ ${FORM.beneficiary_of_member_no}`
        + ` เป็นญาติ (บุตรสาว) ของผู้ป่วย ${request}${HEADER.partner_name_snapshot} สำหรับ ${FORM.patient_name} อายุ 78 ปี`)
      assert.match(full.travel, sentence(
        `ผู้ป่วยมีนัดที่ ${FORM.destination} ${FORM.destination_detail} ในวันที่ {WHEN} เพื่อ${FORM.appointment_kind_note}`
        + ` จึงขอให้รถมารับที่ ${FORM.pickup_address} (จุดสังเกต ${FORM.pickup_landmark})`
        + ` โดยผู้ป่วยใช้รถเข็น (วีลแชร์) มีผู้ติดตาม 1 คน และขอเดินทางไป-กลับ (${FORM.return_note})`))

      // 2) ระบบจองคิว ผู้ป่วยจองเอง — ไม่มีที่อยู่ อายุ ประเภทนัด จุดสังเกต: วลีต้องหายทั้งวลี และใช้ "ข้าพเจ้า" ตลอดใบ
      const [self] = await read(tripWith({ relation: 'self', patient_name: booker.requester_name, mobility: 'walk', companions: 0 }),
        'patient-form-prose-self.png')
      assert.equal(self.request,
        `ข้าพเจ้า ${booker.requester_name} โทรศัพท์ ${booker.phone} ${request}${PARTNER.name} สำหรับข้าพเจ้าซึ่งเป็นผู้ป่วยเอง`)
      assert.match(self.travel, sentence(
        `ข้าพเจ้ามีนัดที่ ${TRIP.plan.route_label} ในวันที่ {WHEN} จึงขอให้รถมารับที่ ${booker.pickup}`
        + ' โดยข้าพเจ้าเดินได้เอง ไม่มีผู้ติดตาม และขอเดินทางไป-กลับ (รอรับกลับ)'))
      for (const dangling of ['ที่อยู่', 'อายุ', 'เพื่อ', 'จุดสังเกต', 'ผู้ป่วยมีนัด']) {
        assert.ok(!`${self.request} ${self.travel}`.includes(dangling), `ผู้ป่วยจองเอง: เหลือวลี "${dangling}" ทั้งที่ไม่มีข้อมูล`)
      }
      // 2b) ระบุว่าผู้ป่วยยื่นเอง แต่ชื่อผู้ป่วยไม่ตรงกับผู้ยื่น (ข้อมูลขัดกัน) — ชื่อผู้ป่วยต้องไม่หายไปจากใบ
      const [mismatch] = await read(tripWith({ relation: 'self', patient_name: 'นางสมศรี ไม่ตรงชื่อ', mobility: 'walk', companions: 0 }))
      assert.ok(mismatch.request.endsWith(`${PARTNER.name} สำหรับ นางสมศรี ไม่ตรงชื่อ`), `ชื่อผู้ป่วยหายไปจากใบ: "${mismatch.request}"`)
      assert.ok(mismatch.travel.startsWith('ผู้ป่วยมีนัดที่'), `ชื่อไม่ตรงกันต้องเรียก "ผู้ป่วย" ไม่ใช่ "ข้าพเจ้า": "${mismatch.travel}"`)

      // 3) ระบบจองคิว ผู้ดูแลจองแทน ผู้ป่วยนอนเปล ขาไปอย่างเดียว — ไม่พิมพ์ "ขาไปอย่างเดียว" ซ้ำในวงเล็บ
      const [other] = await read(tripWith({ relation: 'caregiver', mobility: 'stretcher', companions: 2, return_mode: 'one_way' }))
      assert.equal(other.request,
        `ข้าพเจ้า ${booker.requester_name} โทรศัพท์ ${booker.phone} เป็นผู้ดูแลของผู้ป่วย ${request}${PARTNER.name} สำหรับ ${booker.patient_name}`)
      assert.match(other.travel, sentence(
        `ผู้ป่วยมีนัดที่ ${TRIP.plan.route_label} ในวันที่ {WHEN} จึงขอให้รถมารับที่ ${booker.pickup}`
        + ' โดยผู้ป่วยต้องนอนเปล มีผู้ติดตาม 2 คน และขอเดินทางขาไปอย่างเดียว'))

      // 4) ข้อมูลหลักหาย (คำขอเก่า/ข้อมูลไม่ครบ) — ประโยคยังอ่านได้ เหลือเส้นประให้เขียนมือ ไม่มีความเกี่ยวข้องก็ไม่พิมพ์วลีนั้น
      const [sparse] = await read(buildPatientTransportFormHtml(args({
        header: { ...HEADER, appointment_at: null, mobility: null },
        form: { requester_relation: 'other', signed_by: null },
        parent: { requester_name: PARENT.requester_name },
      })))
      assert.equal(sparse.blanks.request, 1, 'ไม่มีชื่อผู้ป่วยต้องเหลือเส้นประให้เขียน 1 จุด')
      assert.equal(sparse.blanks.travel, 3, 'ไม่มีปลายทาง วันเวลานัด และจุดรับ ต้องเหลือเส้นประให้เขียน 3 จุด')
      assert.ok(!sparse.request.includes('ของผู้ป่วย'), `ไม่ได้ระบุความเกี่ยวข้อง แต่ยังพิมพ์วลีความเกี่ยวข้อง: "${sparse.request}"`)

      // 5) ทุกทางที่พิมพ์ใบคำขอ: ไม่มีตาราง มีคำลงท้าย เรียง เนื้อความ → หลักฐาน → คำลงท้าย → ลงชื่อ และไม่มีค่าว่างหลุดเป็นตัวหนังสือ
      for (const [label, html] of [
        ['ชุดเอกสารคำขอ', buildPatientTransportPacketHtml(args())],
        ['ใบคำขอฝั่งประชาชน', buildPatientTransportFormHtml(args())],
        ['หนังสือต่อเที่ยว', buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 2) })],
        ['ข้อมูลไม่ครบ', buildPatientTransportFormHtml(args({ form: { signed_by: null }, parent: {} }))],
      ]) {
        const forms = await read(html)
        assert.ok(forms.length > 0, `${label}: ไม่พบใบคำขอ`)
        for (const form of forms) {
          assert.equal(form.tables, 0, `${label}: ใบคำขอยังมีตาราง`)
          assert.equal(form.closing, 'จึงเรียนมาเพื่อโปรดพิจารณาให้ความอนุเคราะห์', `${label}: คำลงท้ายของเนื้อความ`)
          assert.equal(form.regards, 'ขอแสดงความนับถือ', `${label}: คำลงท้าย`)
          assert.ok(form.inOrder, `${label}: ลำดับต้องเป็น ย่อหน้าคำขอ → ย่อหน้าการเดินทาง → หลักฐาน → คำลงท้าย → ลงชื่อ`)
          assert.equal(form.looseWord, 0, `${label}: คำว่า "ผู้ป่วย" ในประโยคไม่ได้กันขาดกลางคำ`)
          assert.equal(form.splitTimes, 0, `${label}: มีเวลา "xx.xx น." ที่ขาดคนละบรรทัดได้`)
          assert.ok(!/undefined|null|NaN/.test(form.all), `${label}: มีค่าว่างหลุดออกมาเป็นตัวหนังสือ`)
        }
      }
    },
  },
  {
    name: 'filled-fields-have-no-dotted-line',
    reason: 'เส้นประมีไว้ให้เขียนมือ ช่องที่ระบบพิมพ์ค่าแล้วต้องไม่มีเส้นประ ส่วนช่องว่างต้องยังมีให้เขียน',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const result = await page.evaluate(() => ({
          filled: [...document.querySelectorAll('.fill-value')]
            .filter(el => getComputedStyle(el).borderBottomStyle !== 'none').map(el => el.textContent.trim()),
          blanks: [...document.querySelectorAll('.fill-blank')]
            .filter(el => getComputedStyle(el).borderBottomStyle === 'dotted').length,
        }))
        assert.deepEqual(result.filled, [], `ช่องที่มีค่ายังมีเส้นประ: ${result.filled.join(', ')}`)
        assert.ok(result.blanks > 0, 'ช่องว่างสำหรับเขียนมือไม่มีเส้นประแล้ว')
      } finally { await page.close() }
    },
  },
  {
    // ผู้จองกดเลือก "หมู่ 3 บ้านทุ่งแค้ว" แล้วช่องจุดสังเกตมีคำเดียวกัน ระบบเก็บ "หมู่ 3 บ้านทุ่งแค้ว · หมู่ 3 บ้านทุ่งแค้ว"
    // ขึ้นใบคำขอซ้ำสองรอบ (เจ้าของระบบแจ้ง 2569-10-02) · ตัดเฉพาะส่วนที่เหมือนกันทุกตัวอักษร เพราะเลขหมู่ซ้อนกันได้
    name: 'pickup-text-has-no-duplicate-parts',
    reason: 'จุดรับที่ซ้ำกัน ("A · A") ต้องพิมพ์ครั้งเดียว ทั้งคำขอใหม่และคำขอเก่าที่เก็บไว้แล้ว · แต่ส่วนที่ต่างกันต้องอยู่ครบ'
      + ' และห้ามตัดแบบ "อยู่ในอีกส่วนหนึ่ง" (หมู่ 1 กับ หมู่ 10 คนละที่)',
    async run(browser) {
      const VILLAGE = 'หมู่ 3 บ้านทุ่งแค้ว'
      const SPOT = 'บ้านเลขที่ 99 ข้างวัด'
      assert.equal(joinPickup([VILLAGE, VILLAGE]), VILLAGE, 'ส่วนที่เหมือนกันต้องเหลือครั้งเดียว')
      assert.equal(joinPickup([VILLAGE, ` ${VILLAGE.replace(' ', '  ')} `]), VILLAGE, 'ช่องว่างซ้ำ/หัวท้ายต่างกันยังนับว่าซ้ำ')
      assert.equal(joinPickup([VILLAGE, SPOT]), `${VILLAGE} · ${SPOT}`, 'ส่วนที่ต่างกันต้องอยู่ครบตามลำดับ')
      assert.equal(joinPickup(['', VILLAGE, '   ']), VILLAGE, 'ส่วนว่างต้องไม่เหลือตัวคั่นลอยๆ')
      assert.equal(joinPickup(['หมู่ 1', 'บ้านเลขที่ 5 หมู่ 10']), 'หมู่ 1 · บ้านเลขที่ 5 หมู่ 10',
        'ห้ามตัดส่วนที่เป็นแค่ข้อความย่อยของอีกส่วน — "หมู่ 1" อยู่ใน "หมู่ 10" แต่คนละหมู่บ้าน')
      assert.equal(pickupSentence(`${VILLAGE} · ${SPOT} · ${VILLAGE}`), `${VILLAGE} ${SPOT}`, 'คำขอเก่าที่เก็บส่วนซ้ำไว้ไม่ติดกัน')
      assert.equal(pickupSentence(null), '')

      const DUP = `${VILLAGE} · ${VILLAGE}`
      const countIn = (text, word) => text.split(word).length - 1
      // ระบบจองคิว: ใบที่พิมพ์พร้อมหนังสือต่อเที่ยว
      {
        const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), bookings: [{ ...TRIP_BOOKINGS[0], pickup: DUP }] }))
        try {
          const text = (await formSheetsOf(page).first().innerText()).replace(/\s+/g, ' ')
          assert.equal(countIn(text, VILLAGE), 1, `ใบคำขอพิมพ์จุดรับซ้ำ: "${text.slice(text.indexOf('รับที่'), text.indexOf('รับที่') + 80)}"`)
          // ตรวจเฉพาะตัวคั่นที่ตามหลังจุดรับ ไม่ตรวจทั้งหน้า
          assert.ok(!text.includes(`${VILLAGE} · `), 'ตัวคั่นจุดรับค้างอยู่ทั้งที่ไม่เหลือส่วนที่สอง')
        } finally { await page.close() }
      }
      // ระบบคำขอแบบเดิม: ข้อความจุดรับอยู่ใน form.pickup_address ตรงๆ
      {
        const page = await render(browser, buildPatientTransportFormHtml(args({ form: { ...FORM, pickup_address: DUP } })))
        try {
          const text = (await formSheetsOf(page).first().innerText()).replace(/\s+/g, ' ')
          assert.equal(countIn(text, VILLAGE), 1, 'ใบคำขอแบบเดิมพิมพ์จุดรับซ้ำ')
        } finally { await page.close() }
      }
      // ส่วนที่ต่างกันต้องไม่หาย
      {
        const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), bookings: [{ ...TRIP_BOOKINGS[0], pickup: `${VILLAGE} · ${SPOT}` }] }))
        try {
          const text = (await formSheetsOf(page).first().innerText()).replace(/\s+/g, ' ')
          assert.ok(text.includes(`รถมารับที่ ${VILLAGE} ${SPOT} โดย`), 'ส่วนที่ต่างกันหายไปหรือเรียงไม่ต่อกันเป็นที่อยู่')
        } finally { await page.close() }
      }
    },
  },
  {
    // ที่อยู่จากหมุดแผนที่ถูกยัดลงช่องจุดสังเกต แล้วขึ้นกลางประโยคใบคำขอเป็น
    // "จึงขอให้รถมารับที่ หมู่ 3 บ้านทุ่งแค้ว · พร.4009, Ban Thung Khaeo, อำเภอหนองม่วงไข่, จังหวัดแพร่ โดย…"
    // (เจ้าของระบบแจ้ง 2569-10-02: ใส่ "· พร.4009, Ban Thung Khaeo" กับ "," มาทำไม ให้เป็นประโยคตามภาษาไทย)
    name: 'pickup-text-reads-as-thai-sentence',
    reason: 'จุดรับในประโยคใบคำขอต้องเป็นที่อยู่แบบไทย (ส่วนต่างๆ คั่นด้วยช่องว่าง) ไม่มีชื่ออังกฤษ รหัสทางหลวง จุลภาค หรือ " · " แทรก'
      + ' · แต่ที่อยู่จริงที่พิมพ์สั้นๆ (ซ.5 ม.3 เลขบ้าน 99/1) ต้องไม่ถูกตัด และถ้าตัดแล้วไม่เหลืออะไรต้องคืนข้อความเดิม',
    async run(browser) {
      const RAW = 'หมู่ 3 บ้านทุ่งแค้ว · พร.4009, Ban Thung Khaeo, อำเภอหนองม่วงไข่, จังหวัดแพร่'
      const SENTENCE = 'หมู่ 3 บ้านทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่'
      assert.equal(pickupSentence(RAW), SENTENCE, 'เคสจริงจากใบที่พิมพ์ออกมา')
      assert.equal(
        pickupSentence('ถนนยันตรกิจโกศล, ตำบลทุ่งแค้ว, อำเภอหนองม่วงไข่, จังหวัดแพร่, ภาคเหนือ, 54170, ประเทศไทย'),
        'ถนนยันตรกิจโกศล ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่ ภาคเหนือ 54170 ประเทศไทย',
        'ที่อยู่เต็มจากช่องค้นหาแผนที่: คงภาค/รหัสไปรษณีย์/ประเทศไว้ครบ — เจ้าของระบบไม่ให้ตัด (2569-10-02) เปลี่ยนแค่ตัวคั่นเป็นช่องว่าง')
      assert.equal(pickupSentence('ทล.101, หมู่ 4 บ้านดอนชัย'), 'หมู่ 4 บ้านดอนชัย', 'รหัสทางหลวงตัวย่อ 2 ตัวอักษร + เลข 3 หลัก')
      assert.equal(pickupSentence('บ้านเลขที่ 99/1 ซ.5, ม.3'), 'บ้านเลขที่ 99/1 ซ.5 ม.3', 'ซ.5 / ม.3 เป็นที่อยู่จริง ห้ามตัดเป็นรหัสทางหลวง')
      assert.equal(pickupSentence('99/1'), '99/1', 'เลขบ้านเฉยๆ ต้องไม่ถูกตัด')
      assert.equal(pickupSentence('ข้างร้าน 7-Eleven'), 'ข้างร้าน 7-Eleven', 'ส่วนที่มีอักษรไทยปนอังกฤษคือข้อความของผู้จอง ห้ามตัด')
      assert.equal(pickupSentence('Near the temple'), 'Near the temple', 'ตัดแล้วไม่เหลืออะไร ต้องคืนข้อความเดิม ไม่ปล่อยเส้นว่าง')
      assert.equal(pickupSentence('18.123456, 100.123456'), '18.123456, 100.123456', 'พิกัดล้วน (ค้นชื่อจากหมุดไม่สำเร็จ) ต้องคงจุลภาคคั่นละติจูด/ลองจิจูด')

      // ต้นทาง: ที่อยู่ที่เติมจากหมุดลงช่องจุดรับต้องเป็นข้อความที่ตัดแล้ว (เจ้าของระบบสั่ง 2569-10-02)
      const MAP_ADDRESS = 'พร.4009, Ban Thung Khaeo, อำเภอหนองม่วงไข่, จังหวัดแพร่'
      assert.equal(addressFromMap('', MAP_ADDRESS), 'อำเภอหนองม่วงไข่ จังหวัดแพร่', 'ช่องว่างต้องได้ที่อยู่ที่ตัดแล้ว')
      assert.equal(addressFromMap('   ', MAP_ADDRESS), 'อำเภอหนองม่วงไข่ จังหวัดแพร่', 'ช่องที่มีแต่ช่องว่างนับว่ายังว่าง')
      assert.equal(addressFromMap(null, MAP_ADDRESS), 'อำเภอหนองม่วงไข่ จังหวัดแพร่')
      assert.equal(addressFromMap('บ้านเลขที่ 99 ข้างวัด', MAP_ADDRESS), 'บ้านเลขที่ 99 ข้างวัด', 'ห้ามทับสิ่งที่ผู้ใช้พิมพ์เอง')
      assert.equal(addressFromMap('', ''), '')
      assert.equal(addressFromMap('', undefined), '')
      // ที่ปักหมุดได้จริงมี 2 จุด (ฟอร์มจองของผู้จอง / ฟอร์มเจ้าหน้าที่แก้จุดรับ) ทั้งคู่ต้องผ่านตัวเติมเดียวกัน
      // — เทสต์เบราว์เซอร์ของฟอร์มทั้งสองรันใน CI ไม่ได้ จึงตรวจที่ต้นฉบับว่ายังเรียกใช้อยู่ และไม่กลับไปเติมสตริงดิบ
      for (const file of ['BookingForm.jsx', 'BookingInbox.jsx']) {
        const source = readFileSync(new URL(`../src/components/patientTransport/${file}`, import.meta.url), 'utf8')
        assert.ok(source.includes('addressFromMap('), `${file} ไม่ได้ใช้ addressFromMap ตอนเติมที่อยู่จากหมุด`)
        assert.ok(!/setPickup\(\s*address\b/.test(source) && !/spot: f\.spot \|\| address/.test(source),
          `${file} กลับไปเติมที่อยู่จากหมุดแบบดิบ`)
      }

      const sentenceIn = (text) => new RegExp(`รถมารับที่ ${SENTENCE}( \\(จุดสังเกต[^)]*\\))? โดย`).test(text)
      // ระบบจองคิว: ใบที่พิมพ์พร้อมหนังสือต่อเที่ยว
      {
        const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), bookings: [{ ...TRIP_BOOKINGS[0], pickup: RAW }] }))
        try {
          const text = (await formSheetsOf(page).first().innerText()).replace(/\s+/g, ' ')
          assert.ok(sentenceIn(text), `จุดรับในประโยคไม่ใช่ที่อยู่ไทย: "${text.slice(text.indexOf('รับที่'), text.indexOf('รับที่') + 90)}"`)
          for (const stray of ['Ban Thung Khaeo', 'พร.4009']) assert.ok(!text.includes(stray), `ใบคำขอยังมี "${stray}"`)
        } finally { await page.close() }
      }
      // ระบบคำขอแบบเดิม
      {
        const page = await render(browser, buildPatientTransportFormHtml(args({ form: { ...FORM, pickup_address: RAW } })))
        try {
          const text = (await formSheetsOf(page).first().innerText()).replace(/\s+/g, ' ')
          assert.ok(sentenceIn(text), 'ใบคำขอแบบเดิมพิมพ์จุดรับไม่เป็นที่อยู่ไทย')
          assert.ok(!text.includes('Ban Thung Khaeo'), 'ใบคำขอแบบเดิมยังมีชื่ออังกฤษ')
        } finally { await page.close() }
      }
    },
  },
  {
    // เจ้าของระบบสั่ง 2569-10-02: หัวใบคำขอใช้รูปแบบเดียวกับใบคำร้อง (councilFormPrint.js) ไม่มีบรรทัด "เขียนที่"
    //   มุมซ้าย: "คำขอผ่าน E-Service <เลขอ้างอิง>" / "ลงวันที่ ..." ไม่มีช่องเลขรับซ้ำ (เจ้าของระบบสั่งตัด)
    //   กลางหน้า: ชื่อแบบ (ตัวหนา) แล้วบรรทัด "ผ่านระบบ E-Service <อปท.>"
    name: 'form-header-follows-complaint-layout',
    reason: 'หัวใบคำขอต้องไม่มี "เขียนที่" หรือช่อง "คำขอเลขที่" เหลือเลขอ้างอิง+ลงวันที่ ชื่อแบบกึ่งกลางอยู่ใต้บล็อกอ้างอิง'
      + ' · ทุกทางที่พิมพ์ใบคำขอ · วัดกล่องตัวอักษรจริงด้วย Range ไม่วัดกล่องของ element (ดู AGENTS.md ช่องลงนาม)',
    async run(browser) {
      for (const [label, html] of [
        ['ชุดเอกสารคำขอ', buildPatientTransportPacketHtml(args())],
        ['ใบคำขอฝั่งประชาชน', buildPatientTransportFormHtml(args())],
        ['หนังสือต่อเที่ยว', buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 2) })],
      ]) {
        const page = await render(browser, html)
        try {
          const forms = await formSheetsOf(page).evaluateAll(sheets => sheets.map(sheet => {
            const box = selector => {
              const el = sheet.querySelector(selector)
              if (!el) return null
              const range = document.createRange()
              range.selectNodeContents(el)
              const b = range.getBoundingClientRect()
              return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, text: el.textContent.replace(/\s+/g, ' ').trim() }
            }
            return {
              text: sheet.innerText.replace(/\s+/g, ' '),
              no: box('.form-no'), date: box('.form-date'), official: box('.official-ref'),
              title: box('.form-title'), origin: box('.form-fund'),
              printLeft: sheet.getBoundingClientRect().left + parseFloat(getComputedStyle(sheet).paddingLeft),
              printRight: sheet.getBoundingClientRect().right - parseFloat(getComputedStyle(sheet).paddingRight),
            }
          }))
          assert.ok(forms.length > 0, `${label}: ไม่พบใบคำขอ`)
          for (const f of forms) {
            assert.ok(!f.text.includes('เขียนที่'), `${label}: ใบคำขอยังมี "เขียนที่"`)
            assert.match(f.no?.text ?? '', /^คำขอผ่าน E-Service \S+/, `${label}: มุมซ้ายบนต้องเป็น "คำขอผ่าน E-Service <เลขอ้างอิง>": "${f.no?.text}"`)
            assert.match(f.date?.text ?? '', /^ลงวันที่ \d{1,2} \S+ \d{4}$/, `${label}: ต้องมี "ลงวันที่ <วัน เดือน พ.ศ.>": "${f.date?.text}"`)
            assert.equal(f.official, null, `${label}: ยังมีช่องเลขรับที่เจ้าของระบบสั่งตัด`)
            assert.ok(!f.text.includes('คำขอเลขที่'), `${label}: ยังมีข้อความช่องเลขรับซ้ำ`)
            assert.equal(f.origin?.text, `ผ่านระบบ E-Service ${TENANT.name}`, `${label}: ใต้ชื่อแบบต้องเป็น "ผ่านระบบ E-Service <อปท.>"`)
            // ลงวันที่อยู่ใต้เลขอ้างอิงในคอลัมน์ซ้าย
            assert.ok(f.date.top >= f.no.bottom - 1, `${label}: "ลงวันที่" ต้องอยู่ใต้เลขอ้างอิง`)
            assert.ok(Math.abs(f.no.left - f.date.left) < 1, `${label}: เลขอ้างอิงกับลงวันที่ต้องเริ่มตรงขอบซ้ายเดียวกัน`)
            // ชื่อแบบอยู่ใต้ข้อมูลอ้างอิง ไม่ทับ และอยู่กึ่งกลางพื้นที่พิมพ์
            assert.ok(f.title.top >= f.date.bottom - 1, `${label}: ชื่อแบบต้องอยู่ใต้บล็อกมุมกระดาษ`)
            assert.ok(f.origin.top >= f.title.bottom - 1, `${label}: "ผ่านระบบ E-Service…" ต้องอยู่ใต้ชื่อแบบ`)
            const mid = (f.title.left + f.title.right) / 2
            const printLeft = f.printLeft
            const printRight = f.printRight
            assert.ok(Math.abs(mid - (printLeft + printRight) / 2) < 3, `${label}: ชื่อแบบต้องอยู่กึ่งกลางพื้นที่พิมพ์ (กลางชื่อ ${mid.toFixed(1)} กลางหน้า ${((printLeft + printRight) / 2).toFixed(1)})`)
          }
        } finally { await page.close() }
      }
    },
  },
  {
    // เจ้าของระบบแจ้ง 2569-10-02: กดพิมพ์ใบคำขอรถรับ-ส่งฝั่งเจ้าหน้าที่แล้วหน้าต่างพิมพ์ไม่เด้ง ต่างจากหน้าคำร้อง
    // สาเหตุ: เติมเอกสารลงหน้าต่างแล้วไม่เรียก print() · ปุ่มพิมพ์ฝั่งเจ้าหน้าที่ 3 ปุ่ม (ใบคำขอ/หนังสือนำส่ง/สรุปช่วงเวลา) ผ่านทางเดียวกัน
    name: 'staff-print-opens-print-dialog',
    reason: 'เติมเอกสารลงหน้าต่างพิมพ์แล้วต้องเด้งหน้าต่างพิมพ์ให้เอง (หลังหน่วงให้ฟอนต์โหลด) และต้องไม่พิมพ์ถ้าเจ้าหน้าที่ปิดหน้าต่างไปแล้ว'
      + ' · ปุ่มพิมพ์ฝั่งเจ้าหน้าที่ต้องผ่าน writeAndPrint ทุกปุ่ม ไม่เขียนลงหน้าต่างเอง',
    async run() {
      const fakeWindow = () => {
        const log = []
        return {
          log, closed: false,
          document: { open: () => log.push('open'), write: html => log.push(`write:${html}`), close: () => log.push('close') },
          focus: () => log.push('focus'), print: () => log.push('print'),
        }
      }
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

      // เติมเอกสารแล้วเด้งหน้าต่างพิมพ์ครั้งเดียว หลังโฟกัสหน้าต่าง · ยังไม่เด้งก่อนครบเวลาหน่วง
      {
        const win = fakeWindow()
        writeAndPrint(win, '<p>เอกสาร</p>', 30)
        assert.deepEqual(win.log, ['open', 'write:<p>เอกสาร</p>', 'close'], 'ต้องเติมเอกสารก่อน และยังไม่พิมพ์ทันที (ฟอนต์ยังไม่โหลด)')
        await wait(120)
        assert.deepEqual(win.log.slice(3), ['focus', 'print'], 'ต้องโฟกัสหน้าต่างแล้วเด้งหน้าต่างพิมพ์ ครั้งเดียว')
      }
      // เจ้าหน้าที่ปิดหน้าต่างระหว่างรอ → ไม่พิมพ์
      {
        const win = fakeWindow()
        writeAndPrint(win, '<p>x</p>', 30)
        win.closed = true
        await wait(120)
        assert.ok(!win.log.includes('print'), 'หน้าต่างถูกปิดแล้ว ต้องไม่เรียกพิมพ์')
      }
      assert.equal(PRINT_DIALOG_DELAY_MS, 400, 'หน่วง 400ms เท่าปุ่มพิมพ์ของหน้าคำร้อง/ใบคำขอฝั่งประชาชน')

      // ปุ่มพิมพ์ฝั่งเจ้าหน้าที่ทุกปุ่มผ่าน printInNewWindow ซึ่งต้องใช้ writeAndPrint — ห้ามกลับไปเขียนลงหน้าต่างเอง
      const source = readFileSync(new URL('../src/pages/PatientTransportStaff.jsx', import.meta.url), 'utf8')
      const body = source.slice(source.indexOf('async function printInNewWindow'), source.indexOf('const printLetter'))
      assert.ok(body.includes('writeAndPrint(win, html)'), 'printInNewWindow ไม่ได้ใช้ writeAndPrint')
      assert.ok(!/win\.document\.(open|write)\(\s*html/.test(body), 'printInNewWindow กลับไปเขียนเอกสารลงหน้าต่างเองโดยไม่เรียกพิมพ์')
      for (const button of ['printLetter', 'printRequest', 'printPeriod']) {
        assert.ok(new RegExp(`const ${button} = [^=]*=> printInNewWindow\\(`).test(source), `${button} ไม่ได้ผ่าน printInNewWindow`)
      }
    },
  },
  {
    // เจ้าของระบบอนุมัติ 2569-10-02: ตัดส่วนที่แทรกมา ("Ban Thung Khaeo" "พร.4009") ออกจากจุดรับ/ที่อยู่จากหมุดทุกที่ที่แสดงให้คนอ่าน
    //   - ใบแจ้งเก็บขยะ + ใบขอใช้น้ำประปา: ที่อยู่ในวงเล็บต่อท้ายพิกัด คงจุลภาคและส่วนอื่นครบ (ไม่ใช่ประโยค · เคยสั่ง "ห้ามตัดชื่อสถานที่")
    //   - หน้าจอเจ้าหน้าที่รถรับ-ส่ง: แสดงจุดรับของคำขอเก่าที่เก็บข้อความเต็มไว้ (แสดงผลอย่างเดียว ข้อมูลที่เก็บไม่เปลี่ยน)
    name: 'foreign-address-parts-dropped-everywhere-readers-see',
    reason: 'ที่อยู่จากหมุดที่คนอ่านเห็น (ใบเก็บขยะ/น้ำประปา/หน้าจอเจ้าหน้าที่) ต้องไม่มีส่วนอังกฤษล้วนหรือรหัสทางหลวงแทรก'
      + ' แต่ส่วนที่เหลือต้องอยู่ครบ ไม่ตัดท้าย และค่าที่เก็บในฐานข้อมูลต้องไม่ถูกแก้',
    async run() {
      const MAP = 'พร.4009, Ban Thung Khaeo, ถนนยันตรกิจโกศล, ตำบลทุ่งแค้ว, อำเภอหนองม่วงไข่, จังหวัดแพร่, ภาคเหนือ, 54170, ประเทศไทย'
      const KEPT = 'ถนนยันตรกิจโกศล, ตำบลทุ่งแค้ว, อำเภอหนองม่วงไข่, จังหวัดแพร่, ภาคเหนือ, 54170, ประเทศไทย'
      assert.equal(stripForeignParts(MAP), KEPT, 'ตัดเฉพาะส่วนอังกฤษล้วนกับรหัสทางหลวง คงจุลภาคและส่วนอื่นครบ')
      assert.equal(stripForeignParts(' ถนนเอ , ถนนเอ , ตำบลบี '), 'ถนนเอ, ตำบลบี', 'ส่วนซ้ำเหลือครั้งเดียว')
      assert.equal(stripForeignParts('Near the temple'), 'Near the temple', 'ตัดแล้วไม่เหลืออะไร ต้องคืนข้อความเดิม')
      assert.equal(stripForeignParts('บ้านเลขที่ 99/1 ซ.5, ม.3'), 'บ้านเลขที่ 99/1 ซ.5, ม.3', 'ซ.5 / ม.3 เป็นที่อยู่จริง ห้ามตัด')
      assert.equal(stripForeignParts('ข้างร้าน 7-Eleven, ตำบลบี'), 'ข้างร้าน 7-Eleven, ตำบลบี', 'ส่วนที่มีอักษรไทยปนอังกฤษคือข้อความของผู้จอง ห้ามตัด')
      assert.equal(stripForeignParts(null), '')

      // ใบแจ้งเก็บขยะ: พิกัดก่อน แล้วที่อยู่ในวงเล็บ — คงครบ ไม่มี … และไม่มีส่วนที่แทรกมา
      assert.equal(collectionPointText({ lat: 18.307591, lng: 100.154992, address: MAP }), `18.307591, 100.154992 (${KEPT})`)
      assert.equal(collectionPointText({ lat: 18.3, lng: 100.1, address: '' }), '18.300000, 100.100000', 'ไม่มีที่อยู่ = พิกัดอย่างเดียว')
      assert.equal(collectionPointText({ lat: 18.3, lng: 100.1, address: 'Ban Thung Khaeo' }), '18.300000, 100.100000 (Ban Thung Khaeo)', 'ที่อยู่อังกฤษล้วน คืนข้อความเดิม ไม่ปล่อยวงเล็บว่าง')
      // ใบขอใช้น้ำประปา: ตัดส่วนที่แทรกก่อนนับความยาว (ยังตัดที่รอยจุลภาคไม่เกิน 48 ตัวอักษรตามเดิม)
      const water = meterPointText({ lat: 18.307591, lng: 100.154992, address: MAP })
      assert.ok(!water.includes('Ban Thung Khaeo') && !water.includes('พร.4009'), `ใบน้ำประปายังมีส่วนที่แทรกมา: ${water}`)
      assert.ok(water.startsWith('18.307591, 100.154992 (ถนนยันตรกิจโกศล, ตำบลทุ่งแค้ว'), `ใบน้ำประปาต้องเริ่มด้วยส่วนไทยแรก: ${water}`)

      // หน้าจอเจ้าหน้าที่ทุกจุดที่แสดงจุดรับต้องผ่าน pickupSentence · ช่องแก้จุดรับ (ข้อมูลดิบให้แก้) และข้อมูลค้นหาคงดิบ
      const read = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
      const SCREENS = [
        'components/patientTransport/BookingInbox.jsx', 'components/patientTransport/BookingOperations.jsx',
        'components/patientTransport/StaffBookingCalendar.jsx', 'components/staff/PatientTransportPanel.jsx',
      ]
      for (const file of SCREENS) {
        const source = read(file)
        assert.ok(source.includes('pickupSentence('), `${file} ไม่ได้ใช้ pickupSentence แสดงจุดรับ`)
        // แสดงผลดิบ {b.pickup} / {booking.pickup} / {row.booking.pickup} / {form.pickup_address} ต้องไม่เหลือ
        assert.ok(!/\{(b|booking|row\.booking)\.pickup\}/.test(source) && !/\{form\.pickup_address\}/.test(source),
          `${file} ยังแสดงจุดรับแบบข้อความเต็มดิบ`)
      }
    },
  },
  {
    name: 'evidence-line-has-no-id-copy',
    reason: 'บรรทัดหลักฐานในใบคำขอเหลือ "☐ ใบนัดแพทย์ ☐ อื่นๆ ___" เจ้าของระบบสั่งตัด "สำเนาบัตรประชาชนผู้ป่วย" ออก 2569-10-02'
      + ' ต้องไม่กลับมาในใบคำขอและใบคำขอรับสวัสดิการ และต้องไม่เหลือแค่ครึ่งเดียว (ช่องติ๊ก 2 ช่อง ตามคำที่เหลือ)',
    async run(browser) {
      for (const [label, html] of [
        ['ชุดเอกสารคำขอ', buildPatientTransportPacketHtml(args())],
        ['ใบคำขอฝั่งประชาชน', buildPatientTransportFormHtml(args())],
        ['ชุดหนังสือและใบคำขอรับสวัสดิการ', buildPatientTransportLetterHtml(args())],
        ['ชุดนำส่งกองทุนของผู้เดินทาง', buildBookingForwardLetterHtml({ ...tripArgs(), booking: TRIP_BOOKINGS[0] })],
        ['หนังสือต่อเที่ยว', buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 2) })],
      ]) {
        const page = await render(browser, html)
        try {
          const lines = await page.locator('.evidence, .fund-evidence').evaluateAll(els => els.map(el => ({
            text: el.textContent.replace(/\s+/g, ' ').trim(),
            boxes: el.querySelectorAll('.box').length,
          })))
          assert.ok(lines.length > 0, `${label}: ไม่พบบรรทัดหลักฐาน`)
          for (const line of lines) {
            assert.ok(!line.text.includes('บัตรประชาชน'), `${label}: บรรทัดหลักฐานยังมีบัตรประชาชน: "${line.text}"`)
            assert.match(line.text, /^หลักฐาน ใบนัดแพทย์ อื่นๆ/, `${label}: บรรทัดหลักฐานไม่ใช่ "ใบนัดแพทย์ / อื่นๆ": "${line.text}"`)
            assert.equal(line.boxes, 2, `${label}: ช่องติ๊กต้องมี 2 ช่อง (ใบนัดแพทย์, อื่นๆ) ได้ ${line.boxes}`)
          }
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'request-form-has-no-fund-committee-box',
    reason: 'เจ้าของระบบสั่งตัดกล่อง "สำหรับคณะกรรมการกองทุน" ออกจากใบคำขอ 2569-10-01 — ใบนี้ยื่นต่อนายก เรื่องจบที่นายก'
      + ' ยังไม่ไปถึงกองทุน ต้องไม่มีช่องอนุมัติ/ไม่อนุมัติหรือช่องลงนามของกรรมการกองทุนในทุกทางที่พิมพ์ใบคำขอ',
    async run(browser) {
      for (const [label, html] of [
        ['ชุดเอกสารคำขอ', buildPatientTransportPacketHtml(args())],
        ['ใบคำขอฝั่งประชาชน', buildPatientTransportFormHtml(args())],
        ['หนังสือต่อเที่ยว', buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 2) })],
      ]) {
        const page = await render(browser, html)
        try {
          assert.equal(await page.locator('.committee').count(), 0, `${label}: ยังมีกล่องของกองทุน`)
          const forms = await page.locator('.sheet').filter({ has: page.locator('.form-title') }).allInnerTexts()
          assert.ok(forms.length > 0, `${label}: ไม่พบใบคำขอ`)
          for (const text of forms) {
            for (const word of ['สำหรับคณะกรรมการกองทุน', 'ไม่อนุมัติ', 'ประธานคณะกรรมการกองทุน', 'เหรัญญิก']) {
              assert.ok(!text.includes(word), `${label}: ใบคำขอยังมี "${word}"`)
            }
            // ส่วนของผู้ยื่นต้องอยู่ครบ — ตัดเฉพาะกล่องของกองทุน
            for (const word of ['หลักฐาน', 'ผู้ยื่นคำขอ']) assert.ok(text.includes(word), `${label}: "${word}" หายไปด้วย`)
          }
        } finally { await page.close() }
      }
    },
  },
  {
    // ⚠️ ข้อนี้ "กลับด้าน" จากของเดิม (ที่เคยห้ามพิมพ์ชื่อเมื่อเจ้าหน้าที่คีย์แทน) ตามที่เจ้าของ
    // ระบบสั่งเมื่อ 2569-09-10 ให้พิมพ์ชื่อทุกกรณี · 2569-10-02 ตัดบรรทัดกำกับใต้ชื่อทุกช่องทาง (แบบ ข) ใบนี้จึงเหลือชื่อบนเส้น
    // อย่างเดียว และต้องไม่มีข้อความใดอ้างว่ายืนยันตัวตนผ่านระบบ (ไม่เป็นความจริง และใบนี้ส่งออกไปให้องค์กรภายนอกใช้อนุมัติ)
    name: 'counter-entry-prints-name-but-not-online-claim',
    reason: 'ใบที่เจ้าหน้าที่คีย์แทนต้องพิมพ์ชื่อผู้ยื่นบนเส้น ไม่มีบรรทัดกำกับใต้ชื่อ และไม่มีข้อความอ้างว่ายืนยันตัวตนผ่านระบบ',
    async run(browser) {
      const counterForm = { ...FORM, signed_by: null }
      const page = await render(browser, buildPatientTransportFormHtml(args({ form: counterForm })))
      try {
        const info = await page.evaluate(() => ({
          signed: [...document.querySelectorAll('.sign-signed')].map(el => el.textContent.trim()),
          notes: document.querySelectorAll('.signed-note').length,
          text: document.body.innerText,
          lines: document.querySelectorAll('.sign-line').length,
        }))
        assert.deepEqual(info.signed, [PARENT.requester_name],
          'ใบที่เจ้าหน้าที่คีย์แทนต้องพิมพ์ชื่อผู้ยื่นบนเส้น 1 จุด')
        assert.equal(info.notes, 0, 'ใต้ชื่อผู้ยื่นต้องไม่มีบรรทัดกำกับ')
        assert.ok(!/ยืนยันตัวตน/.test(info.text), 'ใบที่เจ้าหน้าที่คีย์แทนอ้างว่ายืนยันตัวตนผ่านระบบทั้งที่ไม่ได้ยืนยัน')
        // ไม่เหลือเส้นเปล่าให้เขียนมือ — ช่องผู้ยื่นพิมพ์ชื่อบนเส้นแล้ว ส่วนช่องของกรรมการกองทุนตัดออก 2569-10-01
        assert.equal(info.lines, 0, `มีเส้นลงนามเปล่า ${info.lines} เส้น ต้องไม่มี`)
      } finally { await page.close() }
    },
  },
  {
    // เจ้าของระบบสั่ง 2569-10-02 (แบบ ข "ตัดทุกแบบ"): ใต้ชื่อผู้ยื่นไม่มีบรรทัดกำกับ ทุกช่องทางที่คำขอเข้ามา — ต่อจาก #376 ที่ตัดของใบที่ยื่นออนไลน์
    // รับทราบผลแล้ว: กระดาษไม่บอกว่าชื่อบนเส้นเป็นการลงชื่อผ่านระบบหรือเจ้าหน้าที่รับจองแทน ใครยื่น/รับจองแทนเมื่อไรดูได้ที่ประวัติการดำเนินการ
    // ห้ามใส่กลับเองโดยไม่ถาม — ตรวจทุกทางที่พิมพ์ใบคำขอ ทุกช่องทาง และ html ดิบ (คอมเมนต์ในแม่แบบถูกส่งออกไปกับใบพิมพ์ด้วย)
    name: 'request-form-has-no-signed-note',
    reason: 'ใต้ชื่อผู้ยื่นต้องไม่มีบรรทัดกำกับ ทุกทางที่พิมพ์ใบคำขอและทุกช่องทาง · ชื่อยังอยู่บนเส้น เลขที่คำขอยังอยู่หัวใบ'
      + ' และท้ายใบจบที่ช่องลงชื่อ ไม่มีบรรทัดที่มา "ผ่านระบบ E-Service" ซ้ำ (เก็บที่เดียวใต้ชื่อแบบ — เจ้าของระบบสั่ง 2569-10-02)',
    async run(browser) {
      const BANNED = ['ลงชื่อโดยการยืนยันตัวตน', 'ยืนยันตัวตนผ่านระบบ', 'เจ้าหน้าที่รับจองแทน', 'เจ้าหน้าที่บันทึกคำขอแทน',
        'โปรดลงลายมือชื่อรับรอง', 'ลงลายมือชื่อรับรอง', 'จัดทำจากข้อมูลการจองรถ']
      const RAW_BANNED = ['ลงชื่อโดยการยืนยันตัวตน', 'เจ้าหน้าที่รับจองแทนทางโทรศัพท์', 'เจ้าหน้าที่บันทึกคำขอแทนที่เคาน์เตอร์',
        'โปรดลงลายมือชื่อรับรอง', 'จัดทำจากข้อมูลการจองรถ', 'signed-note']
      const tripBooking = channel => ({ ...TRIP_BOOKINGS[0], entry_channel: channel, route_label: TRIP.plan.route_label })
      const cases = [
        ['ชุดเอกสารคำขอ · ยื่นออนไลน์', buildPatientTransportPacketHtml(args()), PARENT.requester_name],
        ['ชุดเอกสารคำขอ · เจ้าหน้าที่คีย์แทนที่เคาน์เตอร์', buildPatientTransportPacketHtml(args({ form: { ...FORM, signed_by: null } })), PARENT.requester_name],
        ['ใบคำขอฝั่งประชาชน · ยื่นออนไลน์', buildPatientTransportFormHtml(args()), PARENT.requester_name],
        ['ใบคำขอฝั่งประชาชน · เจ้าหน้าที่คีย์แทนที่เคาน์เตอร์', buildPatientTransportFormHtml(args({ form: { ...FORM, signed_by: null } })), PARENT.requester_name],
        ...['online', 'staff', undefined].flatMap(channel => [
          [`ชุดต่อเที่ยว · ช่องทาง ${channel}`,
            buildTripForwardLetterHtml({ ...tripArgs(), bookings: [tripBooking(channel)] }), TRIP_BOOKINGS[0].requester_name],
          [`ใบคำขอตอนรอยืนยันรถ · ช่องทาง ${channel}`,
            buildBookingRequestFormHtml({ tenant: TENANT, partner: PARTNER, mayor: MAYOR, booking: { ...tripBooking(channel), status: 'submitted', trip_id: null } }),
            TRIP_BOOKINGS[0].requester_name],
        ]),
      ]
      for (const [label, html, requester] of cases) {
        for (const word of RAW_BANNED) assert.ok(!html.includes(word), `${label}: html ของใบพิมพ์ยังมี "${word}" (รวมคอมเมนต์และ CSS ในแม่แบบ)`)
        const page = await render(browser, html)
        try {
          const forms = await page.evaluate(() => [...document.querySelectorAll('.sheet')].filter(sheet => sheet.querySelector('.form-title')).map(sheet => ({
            text: sheet.innerText,
            signed: [...sheet.querySelectorAll('.sign-signed')].map(el => el.textContent.trim()),
            lines: sheet.querySelectorAll('.sign-line').length,
            afterSign: sheet.querySelector('.sign-block').nextElementSibling?.className ?? null,
            // กล่อง .request-close ห่อคำลงท้ายกับบล็อกลงชื่อไว้ด้วยกัน (ใช้คอลัมน์ร่วมกัน) — มองทะลุเฉพาะเมื่อมันเป็นองค์ประกอบสุดท้ายของใบ
            // ถ้ามีอะไรต่อท้ายกล่องนั้น lastElementChild จะไม่ใช่กล่อง จึงยังจับได้เหมือนเดิม
            last: (() => { const end = sheet.lastElementChild; return (end.classList.contains('request-close') ? end.lastElementChild : end).className })(),
            origins: sheet.querySelectorAll('.origin').length,
            fund: sheet.querySelector('.form-fund')?.innerText.trim() ?? '',
            reference: sheet.querySelector('.form-no')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
          })))
          assert.ok(forms.length > 0, `${label}: ไม่พบใบคำขอ`)
          for (const form of forms) {
            for (const word of BANNED) assert.ok(!form.text.includes(word), `${label}: ใบคำขอยังมี "${word}" ที่สั่งตัดแล้ว`)
            assert.deepEqual(form.signed, [requester], `${label}: ชื่อผู้ยื่นต้องยังอยู่บนเส้นลงชื่อ 1 จุด`)
            assert.equal(form.lines, 0, `${label}: ต้องไม่มีเส้นเปล่าให้เซ็น`)
            // ท้ายใบจบที่ช่องลงชื่อ — ไม่มีบรรทัดที่มา (.origin) และไม่มีอะไรต่อท้าย
            assert.equal(form.afterSign, null, `${label}: ใต้ช่องลงชื่อต้องไม่มีอะไรต่อท้าย (พบ .${form.afterSign})`)
            assert.ok(form.last.includes('sign-block'), `${label}: ท้ายใบต้องจบที่ช่องลงชื่อ (พบ .${form.last})`)
            assert.equal(form.origins, 0, `${label}: ท้ายใบยังมีบรรทัดที่มา ซึ่งพิมพ์ "ผ่านระบบ E-Service" ซ้ำกับใต้ชื่อแบบ`)
            // "ผ่านระบบ E-Service <อปท.>" ต้องปรากฏครั้งเดียวทั้งใบ คือใต้ชื่อแบบ
            assert.equal(form.fund, `ผ่านระบบ E-Service ${TENANT.name}`, `${label}: ใต้ชื่อแบบต้องเป็น "ผ่านระบบ E-Service <อปท.>"`)
            assert.equal(form.text.split('ผ่านระบบ E-Service').length - 1, 1, `${label}: "ผ่านระบบ E-Service" ต้องพิมพ์ครั้งเดียวต่อใบ`)
            assert.match(form.reference, /^คำขอผ่าน E-Service \S+/, `${label}: เลขอ้างอิงที่หัวใบเป็นเลขที่ใช้ค้นเรื่องกลับ ต้องยังอยู่`)
          }
        } finally { await page.close() }
      }
    },
  },
  // --- ระบบจองคิวรถ: หนังสือนำส่งต่อเที่ยว + สรุปรายเดือน ------------------------------------
  {
    // เจ้าของระบบสั่ง 2569-10-02 เลือกแบบ ข: เอกสารแยกรายคน — ผู้เดินทางแต่ละคนพิมพ์ใบคำขอ + หนังสือนำส่งของตัวเอง เลขที่หนังสือคนละเลข
    // (เดิม #368/#371 พิมพ์ทั้งเที่ยวชุดเดียว หนังสือฉบับเดียวมีเลขเดียว) หน้าจอเรียกตัวประกอบด้วยคำขอทีละใบ (bookings: [booking])
    // ⚠️ เลขของคำขอต้องชนะเลขของเที่ยวเสมอ: ถ้าหนังสือของคนที่สองพิมพ์เลขของเที่ยว (เลขเดียวกับคนแรก) ก็กลับไปเป็นหนังสือหลายฉบับเลขเดียวกัน
    name: 'letter-is-per-person-with-own-number',
    reason: 'พิมพ์คำขอเดียวต้องได้ใบคำขอ 1 + หนังสือ 1 ของคนนั้น ไม่มีของคนอื่นในเที่ยวเดียวกัน · เลขที่/วันที่หนังสือเป็นของคำขอเอง'
      + ' ไม่มีค่อยใช้เลขของเที่ยว (เที่ยวเก่า) ไม่มีทั้งคู่เว้นเส้นประให้เขียนมือ',
    async run(browser) {
      // 1) กติกาเลือกเลข (ตัวเดียวกับที่หน้าจอ งานถัดไป และใบพิมพ์ใช้)
      const tripWithLetter = { forward_letter_no: 'พร 9/9', forward_letter_date: '2026-09-01' }
      assert.deepEqual(bookingLetter({ forward_letter_no: 'พร 1/1', forward_letter_date: '2026-10-02' }, tripWithLetter),
        { no: 'พร 1/1', date: '2026-10-02', own: true }, 'เลขของคำขอเองต้องมาก่อนเลขของเที่ยว')
      assert.deepEqual(bookingLetter({ forward_letter_no: null }, tripWithLetter), { no: 'พร 9/9', date: '2026-09-01', own: false }, 'ไม่มีเลขของคำขอ = ใช้เลขของเที่ยวเดิม')
      assert.deepEqual(bookingLetter({}, {}), { no: '', date: '', own: false })
      assert.deepEqual(bookingLetter(undefined, undefined), { no: '', date: '', own: false })
      // 2) พิมพ์ทีละคน — 3 คนในเที่ยวเดียวกัน เลขคนละเลข วันที่คนละวัน
      const riders = TRIP_BOOKINGS.slice(0, 3).map((b, i) => ({ ...b, forward_letter_no: `พร 72301/${200 + i}`, forward_letter_date: `2026-10-0${i + 1}` }))
      for (const [index, rider] of riders.entries()) {
        const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), bookings: [rider] }))
        try {
          assert.deepEqual(await sheetKinds(page), ['form', 'letter'], `คนที่ ${index + 1}: ต้องได้ใบคำขอ 1 + หนังสือ 1 ไม่มีของคนอื่น`)
          const letter = await letterSheetOf(page).innerText()
          const form = await formSheetsOf(page).innerText()
          assert.ok(form.includes(`B-${index}`) && letter.includes(`B-${index}`), `คนที่ ${index + 1}: ใบคำขอและหนังสือต้องอ้างเลขที่คำขอของตัวเอง`)
          const letterNo = (await page.locator('.letter-no').innerText()).replace(/\s+/g, ' ').trim()
          assert.ok(letterNo.includes(`พร 72301/${200 + index}`), `คนที่ ${index + 1}: ช่อง "ที่" ต้องเป็นเลขของคำขอเอง: "${letterNo}"`)
          assert.ok(!letterNo.includes('พร 72301/88'), `คนที่ ${index + 1}: ใช้เลขของเที่ยวทับเลขของคำขอ`)
          assert.ok(letter.includes(thaiDateFromDateInput(`2026-10-0${index + 1}`)), `คนที่ ${index + 1}: วันที่หนังสือต้องเป็นของคำขอเอง`)
          for (const other of riders.filter((_, i) => i !== index)) {
            const otherIndex = riders.indexOf(other)
            for (const text of [letter, form]) {
              assert.ok(!text.includes(`B-${otherIndex}`) && !text.includes(`นายผู้ยื่น ทดสอบ${otherIndex + 1}`) && !text.includes(`พร 72301/${200 + otherIndex}`),
                `คนที่ ${index + 1}: เอกสารมีข้อมูลของคนที่ ${otherIndex + 1} ปนมา`)
            }
          }
          assert.ok(!/จำนวน \d+ ราย/.test(letter), `คนที่ ${index + 1}: หนังสือต้องเป็นฉบับของคนเดียว ไม่ใช่บัญชีรายชื่อหลายราย`)
        } finally { await page.close() }
      }
      // 3) เที่ยวเก่า: คำขอไม่มีเลขของตัวเอง ใช้เลขของเที่ยว (TRIP = พร 72301/88) · ไม่มีเลขเลย = เส้นประให้เขียนมือ
      for (const [label, trip, expected] of [
        ['เที่ยวเก่า ใช้เลขของเที่ยว', TRIP, 'พร 72301/88'],
        ['ยังไม่มีเลขเลย', { ...TRIP, forward_letter_no: null, forward_letter_date: null }, null],
      ]) {
        const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), trip, bookings: [TRIP_BOOKINGS[0]] }))
        try {
          const letterNo = (await page.locator('.letter-no').innerText()).replace(/\s+/g, ' ').trim()
          if (expected) assert.ok(letterNo.includes(expected), `${label}: "${letterNo}"`)
          else assert.ok(!/พร|\d/.test(letterNo), `${label}: ต้องเป็นเส้นประให้เขียนมือ ไม่ใช่เลขที่ระบบเดา — "${letterNo}"`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'trip-letter-one-page-each',
    reason: 'ผู้ป่วยหนึ่งคนได้ 2 ใบ; ร่วมเที่ยวใช้หนังสือเดียวแนบใบคำขอครบทุกคน ไม่มีเลขหนังสือซ้ำหลายฉบับ',
    async run(browser) {
      for (const count of [1, 2, 8]) {
        const input = tripArgs()
        input.bookings = input.bookings.slice(0, count)
        input.bookings.push({ ...TRIP_BOOKINGS[0], id: 'cancelled', status: 'cancelled', patient_name: 'CANCELLED_PATIENT' })
        input.bookings.push({ ...TRIP_BOOKINGS[0], id: 'other', trip_id: 'other-trip', patient_name: 'OTHER_TRIP_PATIENT' })
        const page = await render(browser, buildTripForwardLetterHtml(input))
        try {
          assert.equal(await page.locator('.sheet').count(), count + 1)
          assert.equal(await page.locator('.form-title').count(), count, 'ใบคำขอต้องครบคนละ 1 ใบ')
          const text = await page.locator('body').innerText()
          assert.ok(!text.includes('CANCELLED_PATIENT') && !text.includes('OTHER_TRIP_PATIENT'))
          assert.ok(text.includes(`จำนวน ${count} ฉบับ`))
          for (let i = 0; i <= count; i++) {
            const mm = await sheetContentMm(page, i)
            assert.ok(mm <= ONE_PAGE_BUDGET_MM, `แผ่น ${i + 1} สูง ${mm.toFixed(1)}mm เกิน ${ONE_PAGE_BUDGET_MM}mm`)
          }
          // ใบคำขอละ 1 ช่อง (ผู้ยื่นคำขอ) — ช่องกรรมการกองทุน 2 ช่องต่อใบตัดออกแล้ว 2569-10-01
          await assertSignBlockStandard(page, { minRows: count, minBelow: count })
          if (count === 1 && process.env.PATIENT_PRINT_SCREENSHOT_DIR) {
            // เลขในชื่อไฟล์ = ลำดับที่ออกจากเครื่องพิมพ์: 1 ใบคำขอ · 2 หนังสือนำส่ง
            for (let i = 0; i < 2; i++) await page.locator('.sheet').nth(i).screenshot({ path: `${process.env.PATIENT_PRINT_SCREENSHOT_DIR}/patient-document-${i + 1}.png` })
          }
        } finally { await page.close() }
      }
      assert.throws(() => buildTripForwardLetterHtml({ ...tripArgs(), bookings: [] }), /ไม่มีคำขอ/)
    },
  },
  {
    name: 'trip-letter-data-minimization',
    reason: 'หนังสือไม่ใส่เบอร์/จุดรับ ใบคำขอมีข้อมูลตามแบบ ไม่พิมพ์พิกัด และไม่ติดข้อความโหมดเคาน์เตอร์ของระบบคำขอแบบเดิม'
      + ' (บรรทัดกำกับการลงชื่อตรวจที่ trip-form-signature-follows-entry-channel)',
    async run(browser) {
      const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 1) }))
      try {
        const letter = await letterSheetOf(page).innerText()
        const form = await formSheetsOf(page).innerText()
        for (const value of ['0891234567', 'บ้านเลขที่ 88']) {
          assert.ok(!letter.includes(value))
          assert.ok(form.includes(value))
        }
        assert.ok(!(letter + form).includes('18.1234'))
        assert.ok(letter.includes('ให้ความยินยอมเป็นการเฉพาะ'))
        assert.ok(letter.includes('พร 72301/88'))
        assert.ok(form.includes('ใบคำขอรถรับ-ส่งผู้ป่วย'))
        assert.ok(!form.includes('สมาชิกกองทุนเลขที่'), 'คนทั่วไปไม่ต้องมีเลขสมาชิกกองทุนในแบบจองรถ')
        assert.ok(!form.includes('เจ้าหน้าที่บันทึกคำขอแทนที่เคาน์เตอร์'))
        assert.equal(await page.locator('.box--on').count(), 0, 'ระบบต้องไม่ติ๊กช่องใดให้เอง')
      } finally { await page.close() }
    },
  },
  {
    // ช่องทางที่คำขอเข้ามา (entry_channel) เหลือผลบนกระดาษ 2 ที่ (เจ้าของระบบสั่ง 2569-10-01 · ปรับ 2569-10-02):
    //   1) หนังสือนำส่งเขียนว่ายื่น "ผ่านระบบบริการอิเล็กทรอนิกส์" ได้เฉพาะคำขอที่ผู้แจ้งล็อกอินจองเอง
    //      ⚠️ ห้ามให้หนังสือถึงองค์กรภายนอกอ้างว่ายื่นผ่านระบบ ทั้งที่เจ้าหน้าที่รับจองแทนหรือไม่รู้ช่องทาง
    //   2) (เดิม) บรรทัดที่มาท้ายใบคำขอต่อท้ายเลขอ้างอิงเฉพาะใบที่ยื่นออนไลน์ (#376) — ลบแล้ว 2569-10-02 (แบบ ก เหลือที่เดียวใต้ชื่อแบบ)
    //      เลขอ้างอิงอยู่มุมซ้ายบนทุกช่องทาง (.form-no) ใช้ค้นเรื่องกลับ
    // บรรทัดกำกับใต้ชื่อผู้ยื่นถูกตัดทุกช่องทางแล้ว (แบบ ข 2569-10-02) — เดิมข้อนี้ชื่อ trip-form-signature-follows-entry-channel
    // และตรวจบรรทัดกำกับ 3 แบบ
    name: 'trip-letter-wording-follows-entry-channel',
    reason: 'หนังสือนำส่งเขียนว่ายื่นผ่านระบบบริการอิเล็กทรอนิกส์ได้เฉพาะคำขอที่ผู้จองยื่นเองออนไลน์ · ใบคำขอทุกช่องทางพิมพ์ชื่อผู้ยื่น'
      + 'บนเส้นโดยไม่มีบรรทัดกำกับใต้ชื่อ และใบของแต่ละคนในเที่ยวเดียวกันต้องเป็นชื่อผู้ยื่นของใบนั้น',
    async run(browser) {
      // คืนแผ่นตามชนิด ไม่ใช่ตามลำดับ: letter = หนังสือนำส่ง · forms = ใบคำขอเรียงตามที่พิมพ์ · form = ใบคำขอใบแรก
      const read = async (html, shotFile) => {
        const page = await render(browser, html)
        try {
          if (shotFile && process.env.PATIENT_PRINT_SCREENSHOT_DIR) {
            await formSheetsOf(page).first().screenshot({ path: `${process.env.PATIENT_PRINT_SCREENSHOT_DIR}/${shotFile}` })
          }
          const sheets = await page.evaluate(() => [...document.querySelectorAll('.sheet')].map(sheet => ({
            isForm: !!sheet.querySelector('.form-title'),
            text: sheet.innerText,
            notes: sheet.querySelectorAll('.signed-note').length,
            origins: sheet.querySelectorAll('.origin').length,
            reference: sheet.querySelector('.form-no')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
            signed: [...sheet.querySelectorAll('.sign-signed')].map(el => el.textContent.trim()),
            lines: sheet.querySelectorAll('.sign-line').length,
          })))
          const forms = sheets.filter(sheet => sheet.isForm)
          return { letter: sheets.find(sheet => !sheet.isForm), forms, form: forms[0] }
        } finally { await page.close() }
      }
      const trip = (bookings, shotFile) => read(buildTripForwardLetterHtml({ ...tripArgs(), bookings }), shotFile)
      const booking = (index, overrides = {}) => ({ ...TRIP_BOOKINGS[index], ...overrides })
      const nameOnly = (form, name, label) => {
        assert.deepEqual(form.signed, [name], `${label}: ชื่อผู้ยื่นต้องอยู่บนเส้นลงชื่อ 1 จุด`)
        assert.equal(form.lines, 0, `${label}: ต้องไม่มีเส้นเปล่าให้เซ็น`)
        assert.equal(form.notes, 0, `${label}: ใต้ชื่อผู้ยื่นต้องไม่มีบรรทัดกำกับ`)
        for (const claim of ['ยืนยันตัวตน', 'รับจองแทน', 'ลงลายมือชื่อ', 'จัดทำจากข้อมูลการจองรถ']) {
          assert.ok(!form.text.includes(claim), `${label}: ใบคำขอยังมี "${claim}"`)
        }
      }

      // 1) ผู้แจ้งล็อกอินจองเอง — หนังสือบอกว่ายื่นผ่านระบบ · เลขอ้างอิงอยู่มุมซ้ายบน ท้ายใบไม่มีบรรทัดที่มา
      {
        const { letter, form } = await trip([booking(0, { entry_channel: 'online' })])
        nameOnly(form, TRIP_BOOKINGS[0].requester_name, 'จองเอง')
        assert.match(form.reference, /^คำขอผ่าน E-Service B-0$/, `ใบของผู้ที่จองเอง: "${form.reference}"`)
        assert.equal(form.origins, 0, 'ท้ายใบต้องไม่มีบรรทัดที่มา (เก็บที่เดียวใต้ชื่อแบบ)')
        assert.ok(letter.text.includes('ผ่านระบบบริการอิเล็กทรอนิกส์'), 'หนังสือของคำขอที่จองเองต้องยังบอกว่ายื่นผ่านระบบ')
        assert.deepEqual(letter.signed, [], 'หนังสือนำส่งต้องไม่มีชื่อพิมพ์แทนลายมือชื่อ')
      }
      // 2) เจ้าหน้าที่รับจองแทน — หนังสือต้องไม่อ้างว่ายื่นผ่านระบบ · เลขที่คำขอยังอยู่หัวใบให้ค้นกลับ
      {
        const { letter, form } = await trip([booking(0, { entry_channel: 'staff' })], 'patient-document-staff-entry.png')
        nameOnly(form, TRIP_BOOKINGS[0].requester_name, 'รับจองแทน')
        assert.ok(form.reference.includes('B-0'), `เลขอ้างอิงที่หัวใบต้องยังอยู่ (ใช้ค้นเรื่องกลับ): "${form.reference}"`)
        assert.equal(form.origins, 0, 'ใบที่เจ้าหน้าที่รับจองแทนก็ไม่มีบรรทัดที่มาท้ายใบ')
        assert.ok(!letter.text.includes('ผ่านระบบบริการอิเล็กทรอนิกส์'),
          'หนังสือเขียนว่ายื่นผ่านระบบ ทั้งที่เจ้าหน้าที่รับจองแทน')
        assert.ok(letter.text.includes(`ได้ยื่นคำขอต่อ${TENANT.name} ตามเลขอ้างอิง B-0`), 'ย่อหน้าแรกของหนังสือต้องยังอ่านต่อเนื่องหลังตัดวลี')
      }
      // 3) ไม่รู้ช่องทาง (ไม่มีค่า หรือค่าที่ไม่รู้จัก) — หนังสือต้องไม่อ้างว่ายื่นผ่านระบบ
      for (const unknown of [undefined, null, 'phone']) {
        const { letter, form } = await trip([booking(0, { entry_channel: unknown })])
        nameOnly(form, TRIP_BOOKINGS[0].requester_name, `ช่องทาง ${unknown}`)
        assert.ok(!letter.text.includes('ผ่านระบบบริการอิเล็กทรอนิกส์'), `ช่องทาง ${unknown}: หนังสืออ้างว่ายื่นผ่านระบบ`)
      }
      // 4) เที่ยวเดียวมีทั้งสองช่องทาง — แต่ละใบเป็นชื่อผู้ยื่นของตัวเอง ไม่ปนกัน
      {
        const { forms } = await trip([booking(0), booking(1)])
        assert.equal(forms.length, 2)
        nameOnly(forms[0], TRIP_BOOKINGS[0].requester_name, 'ร่วมเที่ยว คนที่ 1')
        nameOnly(forms[1], TRIP_BOOKINGS[1].requester_name, 'ร่วมเที่ยว คนที่ 2')
        assert.ok(forms[0].reference.includes('B-0'), `ใบแรก: "${forms[0].reference}"`)
        assert.ok(forms[1].reference.includes('B-1'), `ใบที่สอง: "${forms[1].reference}"`)
        assert.equal(forms[0].origins + forms[1].origins, 0, 'ทั้งสองใบต้องไม่มีบรรทัดที่มาท้ายใบ')
      }
      // 5) ชุดเอกสารของระบบคำขอแบบเดิม: ย่อหน้าแรกของหนังสือได้ถ้อยคำเท่าเดิม
      for (const [label, form] of [['ยื่นออนไลน์', FORM], ['เจ้าหน้าที่คีย์แทนที่เคาน์เตอร์', { ...FORM, signed_by: null }]]) {
        const { letter } = await read(buildPatientTransportPacketHtml(args({ form })))
        assert.ok(letter.text.includes(`ได้ยื่นคำขอต่อ${TENANT.name} ผ่านระบบบริการอิเล็กทรอนิกส์ ตามเลขอ้างอิง A1B2C3D4`),
          `ระบบคำขอแบบเดิม (${label}): ย่อหน้าแรกของหนังสือเปลี่ยนไป`)
      }
    },
  },
  {
    // เจ้าของระบบเลือก 2569-10-01: หนังสือนำส่ง "นายกเซ็นปากกา" — ระบบพิมพ์ให้แค่ชื่อในวงเล็บ + ตำแหน่ง จากทะเบียนผู้ลงนามกลาง
    // ⚠️ ห้ามพิมพ์ชื่อนายกเป็นลายมือชื่อ (.sign-signed): นายกไม่ได้ทำอะไรในระบบตอนพิมพ์ = ระบบลงนามแทนผู้มีอำนาจ
    // บนหนังสือที่ส่งออกนอก อปท. — ถ้าวันหนึ่งจะให้นายกลงนามในระบบ ต้องมีการกดลงนามของนายกเองและบันทึกย้อนตรวจได้ก่อน
    name: 'letter-signer-from-registry-never-auto-signed',
    reason: 'หนังสือนำส่งต้องพิมพ์ชื่อนายกจากทะเบียนผู้ลงนามในวงเล็บ เว้นที่ให้เซ็นปากกา ห้ามพิมพ์ชื่อเป็นลายมือชื่อ'
      + ' · ยังไม่ได้ตั้งชื่อ = วงเล็บว่าง ไม่เดาชื่อ และมีแถบเตือนบนจอที่ไม่ถูกพิมพ์',
    async run(browser) {
      const actingTitle = 'ปลัดองค์การบริหารส่วนตำบล ปฏิบัติหน้าที่นายกองค์การบริหารส่วนตำบลทุ่งแค้ว'
      const cases = [
        ['ตั้งชื่อแล้ว', MAYOR, { name: `(${MAYOR.name})`, title: MAYOR.title, notice: false }],
        ['ทะเบียนว่าง', null, { name: null, title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว', notice: true }],
        ['มีแต่ตำแหน่ง ชื่อเว้นว่าง', { name: '   ', title: actingTitle }, { name: null, title: actingTitle, notice: true }],
      ]
      for (const [docLabel, build] of [
        ['ชุดเอกสารคำขอ', mayor => buildPatientTransportPacketHtml(args({ mayor }))],
        ['หนังสือต่อเที่ยว', mayor => buildTripForwardLetterHtml({ ...tripArgs(), mayor, bookings: TRIP_BOOKINGS.slice(0, 2) })],
      ]) {
        for (const [caseLabel, mayor, expected] of cases) {
          const label = `${docLabel} · ${caseLabel}`
          const page = await render(browser, build(mayor))
          try {
            const inspect = () => page.evaluate(() => {
              const sign = document.querySelector('.letter-sign')
              const letter = sign.closest('.sheet')
              const note = document.querySelector('.screen-note')
              return {
                lines: [...sign.querySelectorAll('p')].map(p => p.textContent.trim()),
                signed: letter.querySelectorAll('.sign-signed').length,
                gapMm: parseFloat(getComputedStyle(sign).marginTop) / 3.779527,
                note: note && { text: note.textContent, display: getComputedStyle(note).display, inSheet: !!note.closest('.sheet') },
              }
            })
            const printed = await inspect()
            assert.equal(printed.signed, 0, `${label}: หนังสือนำส่งพิมพ์ชื่อแทนลายมือชื่อของนายก`)
            assert.ok(printed.gapMm >= 11.9, `${label}: ที่ว่างให้นายกเซ็นเหลือ ${printed.gapMm.toFixed(1)}mm ต้องไม่ต่ำกว่า 12mm`)
            assert.equal(printed.lines.length, 2, `${label}: ช่องลงนามต้องมี 2 บรรทัด (ชื่อในวงเล็บ + ตำแหน่ง)`)
            if (expected.name) assert.equal(printed.lines[0], expected.name, `${label}: ชื่อในวงเล็บ`)
            else assert.match(printed.lines[0], /^\(\.{20,}\)$/, `${label}: ไม่มีชื่อในทะเบียนต้องเป็นวงเล็บว่าง ห้ามเดาชื่อ — ได้ "${printed.lines[0]}"`)
            assert.equal(printed.lines[1], expected.title, `${label}: ตำแหน่ง`)
            if (!expected.notice) {
              assert.equal(printed.note, null, `${label}: ตั้งชื่อนายกแล้วต้องไม่มีแถบเตือน`)
              continue
            }
            assert.ok(printed.note, `${label}: ไม่มีแถบเตือนว่ายังไม่ได้ตั้งชื่อนายก`)
            assert.ok(printed.note.text.includes('ผู้ลงนามเอกสาร') && printed.note.text.includes('ไม่ถูกพิมพ์'),
              `${label}: แถบเตือนไม่ได้บอกว่าต้องไปตั้งที่ไหน — "${printed.note.text}"`)
            assert.equal(printed.note.inSheet, false, `${label}: แถบเตือนอยู่ในแผ่นกระดาษ`)
            assert.equal(printed.note.display, 'none', `${label}: แถบเตือนถูกพิมพ์ลงกระดาษ`)
            await page.emulateMedia({ media: 'screen' })
            assert.equal((await inspect()).note.display, 'block', `${label}: แถบเตือนไม่ขึ้นบนจอ`)
            // ปุ่ม "ปิดหน้าต่าง" ลอยมุมขวาบนของหน้าต่าง ตัวอักษรของแถบต้องไม่วิ่งไปอยู่ใต้ปุ่ม (เคยทับปลายบรรทัดแรกจนอ่านไม่ครบ)
            // วัดกล่องของตัวอักษรจริงด้วย Range ไม่ใช่กล่องของแถบ — กล่องแถบกว้างถึงขอบจอได้ แต่ตัวอักษรห้ามเข้าใต้ปุ่ม
            for (const width of [360, 794, 1280]) {
              await page.setViewportSize({ width, height: 900 })
              const covered = await page.evaluate(() => {
                const button = document.querySelector('.print-window-close').getBoundingClientRect()
                const range = document.createRange()
                range.selectNodeContents(document.querySelector('.screen-note'))
                return [...range.getClientRects()].filter(r => r.width > 0
                  && r.left < button.right && r.right > button.left && r.top < button.bottom && r.bottom > button.top).length
              })
              assert.equal(covered, 0, `${label}: ปุ่มปิดหน้าต่างทับตัวอักษรของแถบเตือน ${covered} บรรทัดที่หน้าต่างกว้าง ${width}px`)
            }
            await page.setViewportSize({ width: 794, height: 1123 })
            if (docLabel === 'หนังสือต่อเที่ยว' && caseLabel === 'ทะเบียนว่าง' && process.env.PATIENT_PRINT_SCREENSHOT_DIR) {
              await page.screenshot({ path: `${process.env.PATIENT_PRINT_SCREENSHOT_DIR}/patient-letter-no-signer-on-screen.png`, clip: { x: 0, y: 0, width: 794, height: 1123 } })
            }
          } finally { await page.close() }
        }
      }
    },
  },
  {
    name: 'letter-has-no-owner-block',
    reason: 'เจ้าของระบบสั่งตัดบล็อก "ส่วนราชการเจ้าของเรื่อง / โทร. / โทรสาร" ท้ายหนังสือนำส่งออก 2026-09-24 ทั้งสองทางที่พิมพ์หนังสือ',
    async run(browser) {
      for (const [label, html] of [
        ['ชุดเอกสารคำขอ', buildPatientTransportPacketHtml(args())],
        ['หนังสือต่อเที่ยว', buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 1) })],
      ]) {
        const page = await render(browser, html)
        try {
          const letter = letterSheetOf(page)
          const text = await letter.innerText()
          assert.equal(await letter.locator('.owner').count(), 0, `${label}: ยังมีบล็อกเจ้าของเรื่อง`)
          for (const value of [TENANT.phone, TENANT.fax, 'โทรสาร']) {
            assert.ok(!text.includes(value), `${label}: ท้ายหนังสือยังมี "${value}"`)
          }
          assert.ok(/ขอแสดงความนับถือ/.test(text), `${label}: คำลงท้ายต้องอยู่ครบ`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'letter-has-no-consent-version-code',
    reason: 'รหัสรุ่นข้อความยินยอม (เช่น patient-booking-v1) เป็นรหัสภายในระบบ ผู้รับหนังสืออ่านไม่รู้เรื่อง เจ้าของระบบสั่งตัด 2026-09-24'
      + ' — ย่อหน้าความยินยอมและวันที่ยินยอมต้องยังอยู่ครบ',
    async run(browser) {
      for (const [label, html, version] of [
        ['ชุดเอกสารคำขอ', buildPatientTransportPacketHtml(args()), HEADER.consent_version],
        ['หนังสือต่อเที่ยว', buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 1) }), TRIP_BOOKINGS[0].consent_version],
      ]) {
        const page = await render(browser, html)
        try {
          const text = await letterSheetOf(page).innerText()
          assert.ok(!text.includes('ข้อความยินยอมรุ่น'), `${label}: ยังมีคำว่า "ข้อความยินยอมรุ่น"`)
          assert.ok(!text.includes(version), `${label}: ยังพิมพ์รหัส ${version}`)
          assert.ok(text.includes('ให้ความยินยอมเป็นการเฉพาะ'), `${label}: ย่อหน้าความยินยอมหายไปด้วย`)
          assert.match(text, /เมื่อวันที่ \d+ \S+ \d{4}/, `${label}: วันที่ยินยอมหายไปด้วย`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'sender-address-no-duplicate',
    reason: 'municipalities.address ของทุก อปท. มีอำเภอ/จังหวัด/รหัสไปรษณีย์ครบแล้ว ของเดิมเติมซ้ำอีกบรรทัด (เจ้าของระบบเห็นบน demo 2026-09-24)'
      + ' — ห้ามเติมซ้ำ ไม่แก้ถ้อยคำที่แอดมินพิมพ์ และยังเติมให้เมื่อที่อยู่ไม่มีจริง',
    async run(browser) {
      const cases = [
        ['ที่อยู่เต็มบรรทัดเดียว (demo/น้ำเลา/ทุ่งแค้ว)',
          { address: 'เลขที่ 99 หมู่ที่ 5 ตำบลสาธิต อำเภอเมืองแพร่ จังหวัดแพร่ 54000', district: 'เมืองแพร่', province: 'แพร่' },
          ['เลขที่ 99 หมู่ที่ 5 ตำบลสาธิต', 'อำเภอเมืองแพร่ จังหวัดแพร่ 54000']],
        ['คำย่อ ต./อ./จ. (ตำหนักธรรม) — ไม่ขยายคำให้',
          { address: '252 หมู่ที่ 2 ต.ตำหนักธรรม อ.หนองม่วงไข่ จ.แพร่ 54170', district: 'หนองม่วงไข่', province: 'แพร่' },
          ['252 หมู่ที่ 2 ต.ตำหนักธรรม', 'อ.หนองม่วงไข่ จ.แพร่ 54170']],
        ['ที่อยู่ไม่มีอำเภอ/จังหวัด — เติมจากช่องแยกตามเดิม',
          { address: 'เลขที่ 199 หมู่ที่ 5 ตำบลทุ่งแค้ว', district: 'หนองม่วงไข่', province: 'แพร่' },
          ['เลขที่ 199 หมู่ที่ 5 ตำบลทุ่งแค้ว', 'อำเภอหนองม่วงไข่ จังหวัดแพร่']],
        ['แอดมินขึ้นบรรทัดเอง — ใช้ตามที่พิมพ์',
          { address: 'เลขที่ 1 หมู่ที่ 2\nตำบลสาธิต อำเภอเมืองแพร่ จังหวัดแพร่', district: 'เมืองแพร่', province: 'แพร่' },
          ['เลขที่ 1 หมู่ที่ 2', 'ตำบลสาธิต อำเภอเมืองแพร่ จังหวัดแพร่']],
        ['ขาดแค่จังหวัด — "แพร่" ใน "เมืองแพร่" ไม่นับเป็นจังหวัด',
          { address: 'เลขที่ 5 ตำบลสาธิต อำเภอเมืองแพร่', district: 'เมืองแพร่', province: 'แพร่' },
          ['เลขที่ 5 ตำบลสาธิต', 'อำเภอเมืองแพร่ จังหวัดแพร่']],
      ]
      for (const [label, place, expected] of cases) {
        const tenant = { ...TENANT, ...place }
        const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), tenant, bookings: TRIP_BOOKINGS.slice(0, 1) }))
        try {
          const lines = await letterSheetOf(page).locator('.sender p').allInnerTexts()
          assert.deepEqual(lines.slice(1).map(line => line.trim()), expected, label)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'month-report-landscape-sign-standard',
    reason: 'สรุปรายเดือนแนวนอน 22 เที่ยว: ไม่ล้นขวา หัวตารางซ้ำเมื่อขึ้นหน้าใหม่ ช่องลงนามได้มาตรฐานกลาง และไม่มีชื่อผู้เดินทาง',
    async run(browser) {
      // แนวนอน 297mm = 1123px — วัดที่ viewport แนวตั้ง 794px จะได้ตารางแคบเกินจริงแล้วสูงผิดความจริง
      const page = await browser.newPage({ viewport: { width: 1123, height: 794 } })
      try {
        await page.setContent(buildTripMonthReportHtml(monthArgs()), { waitUntil: 'load' })
        await page.evaluate(() => document.fonts.ready)
        await page.emulateMedia({ media: 'print' })
        await page.waitForTimeout(300)
        const info = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          headerGroup: getComputedStyle(document.querySelector('thead')).display,
          rowBreak: getComputedStyle(document.querySelector('tbody tr')).breakInside,
          signBreak: getComputedStyle(document.querySelector('.report-sign')).breakInside,
          text: document.body.innerText,
        }))
        assert.equal(info.overflow, false, 'ตารางล้นขอบขวาของกระดาษแนวนอน')
        assert.equal(info.headerGroup, 'table-header-group', 'หัวตารางไม่ซ้ำเมื่อขึ้นหน้าใหม่')
        assert.equal(info.rowBreak, 'avoid', 'แถวขาดกลางระหว่างหน้าได้')
        assert.equal(info.signBreak, 'avoid', 'ช่องลงนามแยกไปคนละหน้าได้')
        assert.ok(!info.text.includes('นางทดสอบ'), 'สรุปรายเดือนห้ามมีชื่อผู้เดินทาง')
        assert.ok(info.text.includes('รวมเที่ยวที่จบแล้ว 20 เที่ยว') && info.text.includes('1520'), 'ยอดรวมต้องนับเฉพาะเที่ยวที่จบแล้ว')
        assert.ok(info.text.includes('เที่ยวที่ยังไม่จบในเดือนนี้ 2 เที่ยว'), 'เที่ยวที่ยังไม่ได้วิ่งต้องแยกแสดง ไม่หายไปเงียบๆ')
        await assertSignBlockStandard(page, { minRows: 2, minBelow: 4 })
        await assertSignLinesAligned(page, '.report-sign .sign-row')
      } finally { await page.close() }
    },
  },
  {
    name: 'fund-documents-gov-font',
    reason: 'เอกสารถึงกองทุนทั้งสองแบบต้องใช้ THSarabunPSK 14pt + font-size-adjust 0.45 เหมือนทุกใบ',
    async run(browser) {
      for (const html of [buildTripForwardLetterHtml(tripArgs()), buildTripMonthReportHtml(monthArgs())]) {
        const page = await render(browser, html)
        try {
          const style = await page.evaluate(() => {
            const computed = getComputedStyle(document.body)
            return { family: computed.fontFamily, sizePx: parseFloat(computed.fontSize), adjust: computed.fontSizeAdjust }
          })
          assert.match(style.family, /THSarabunPSK/)
          assert.ok(style.sizePx > 18.5 && style.sizePx < 19, `ขนาดตัวอักษร ${style.sizePx}px ไม่ใช่ 14pt`)
          assert.equal(style.adjust, '0.45')
        } finally { await page.close() }
      }
    },
  },
  {
    // เจ้าของระบบแจ้ง 2569-10-03 (ภาพจากใบจริง): "ขอแสดงความนับถือ" เยื้องไปจากชื่อผู้ยื่นคำขอ ให้อยู่ตรงชื่อ
    // ต้นเหตุ: คำลงท้ายจัดกลาง "พื้นที่พิมพ์" แต่ชื่ออยู่กลาง "แกนลงชื่อ" ซึ่งเยื้องจากกลางหน้า เพราะคำว่า "ลงชื่อ" (ซ้าย)
    // กับ "ผู้ยื่นคำขอ" (ขวา) กว้างไม่เท่ากัน — ต้องวัดกล่องตัวอักษรจริง (Range) ห้ามวัดกล่องของ <p> ซึ่งอยู่กลางหน้าเสมอ
    name: 'request-form-regards-centered-on-name',
    reason: 'คำลงท้าย "ขอแสดงความนับถือ" ต้องอยู่กึ่งกลางเหนือชื่อผู้ยื่นพอดี ทั้งชื่อสั้น ชื่อที่ยาวกว่าแกน (แกนยืดตามชื่อ)'
      + ' และไม่มีชื่อ (เส้นให้เขียนมือ) ทั้งใบจากระบบคำขอเดิมและใบจากระบบจองคิว · ระยะแนวตั้งระหว่างคำลงท้ายกับช่องลงชื่อต้องคง 8mm'
      + ' (ค่าที่ไล่ไว้ให้ใบจบ 1 หน้า)',
    async run(browser) {
      const NAMES = [
        ['ชื่อสั้น', 'นายสมชาย ใจดี'],
        ['ชื่อยาวกว่าแกน', 'นางสาวประกายมาศ ศรีวิชัยพัฒนาเจริญสุขสันต์ ณ เชียงใหม่ทดสอบระบบ'],
        ['ไม่มีชื่อ', ''],
      ]
      const builders = [
        ['ระบบคำขอเดิม', requesterName => buildPatientTransportFormHtml(args({ parent: { ...PARENT, requester_name: requesterName } }))],
        ['ระบบจองคิว', requesterName => {
          const booking = { ...TRIP_BOOKINGS[0], route_label: TRIP.plan.route_label, requester_name: requesterName }
          return buildBookingRequestFormHtml({ ...tripArgs(), booking, bookings: [booking] })
        }],
      ]
      const offsets = []
      for (const [system, build] of builders) {
        for (const [label, requesterName] of NAMES) {
          const page = await render(browser, build(requesterName))
          try {
            const rows = await measureSignRows(page)
            assert.equal(rows.length, 1, `${system}/${label}: ใบคำขอต้องมีช่องลงนามผู้ยื่นช่องเดียว`)
            const name = rows[0].below[0]
            if (label === 'ชื่อยาวกว่าแกน') assert.ok(name.widthMm > 55, `${system}: เคสนี้ต้องมีชื่อยาวกว่าแกน 55mm จริง (วัดได้ ${name.widthMm.toFixed(1)}mm) ไม่งั้นไม่ได้ทดสอบแกนที่ยืดตามชื่อ`)
            const offset = (await measureTextCenterMm(page, '.form-regards')) - name.centerMm
            offsets.push(`${system}/${label} ${offset.toFixed(2)}mm`)
            assert.ok(Math.abs(offset) <= 0.5, `${system}/${label}: "ขอแสดงความนับถือ" เยื้องจากกึ่งกลางชื่อ ${offset.toFixed(2)}mm (ต้องไม่เกิน 0.5mm)`)
            const gap = await page.evaluate(mm => {
              const regards = document.querySelector('.form-regards').getBoundingClientRect()
              const sign = document.querySelector('.request-sign').getBoundingClientRect()
              return (sign.top - regards.bottom) / mm
            }, 3.779527)
            assert.ok(Math.abs(gap - 8) <= 0.3, `${system}/${label}: ระยะคำลงท้ายถึงช่องลงชื่อ ${gap.toFixed(2)}mm (ต้องคง 8mm)`)
          } finally { await page.close() }
        }
      }
      return offsets.join(' · ')
    },
  },
]

// channel: 'chrome' ใช้ Chrome ที่ลงในเครื่องอยู่แล้ว ไม่ต้อง playwright install เพิ่ม
const browser = await chromium.launch({ channel: 'chrome' })
let failed = 0
try {
  for (const check of checks) {
    try { await check.run(browser); console.log(`  ✓ ${check.name}`) } catch (error) {
      failed += 1
      console.log(`  ✗ ${check.name} — ${check.reason}\n    ${error.message}`)
    }
  }
} finally {
  await browser.close()
}
console.log(failed === 0 ? `\n✅ ผ่านทั้ง ${checks.length} ข้อ` : `\n❌ ไม่ผ่าน ${failed}/${checks.length} ข้อ`)
process.exit(failed === 0 ? 0 : 1)
