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
  buildPatientTransportFormHtml, buildPatientTransportPacketHtml,
  buildTripForwardLetterHtml, buildTripMonthReportHtml,
} from '../src/lib/patientTransportPrint.js'
import { assertSignBlockStandard, assertSignLinesAligned } from './lib/signBlockChecks.mjs'

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
      distance: i < 20 ? 76 : null, driver_name: 'นายขับดี ปลอดภัยยิ่ง', letter_no: `พร 72301/${100 + i}`,
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
    (sheet.querySelector('.letter-sign') ? 'letter' : sheet.querySelector('.form-title') ? 'form' : 'other')))
}

const checks = [
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
        .map(b => `เลขที่คำขอ ${String(b.id).slice(0, 8).toUpperCase()}`)
      const cases = [
        ['ชุดเอกสารคำขอ (ระบบคำขอแบบเดิม)', buildPatientTransportPacketHtml(args()), ['เลขที่คำขอ A1B2C3D4'], false],
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
    name: 'pdpa-and-template-notes-present',
    reason: 'ย่อหน้าเงื่อนไขการใช้ข้อมูลกับบรรทัดกำกับที่มาของแบบ เป็นเนื้อหาบังคับ ห้ามหายไปเงียบๆ'
      + ' · ประโยค "การพิจารณาเป็นอำนาจของคณะกรรมการกองทุน มิใช่ของ อปท." เจ้าของระบบสั่งตัด 2569-10-01'
      + ' (ใบนี้ยื่นต่อนายก เรื่องจบที่นายก) ต้องไม่กลับมาในทุกทางที่พิมพ์ใบคำขอ',
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
          const notes = await sheets.locator('.note-template').allInnerTexts()
          assert.ok(notes.length > 0, `${label}: ไม่พบบรรทัดกำกับท้ายใบคำขอ`)
          for (const note of notes) {
            assert.ok(note.includes('สถาบันพัฒนาองค์กรชุมชน'),
              `${label}: ใบคำขอไม่มีบรรทัดกำกับว่าลอกโครงมาจากแบบตัวอย่างกลางของ พอช.`)
            assert.ok(note.includes('หากกองทุนมีแบบของตนเองให้ใช้แบบนั้นแทน'),
              `${label}: บรรทัดกำกับไม่ได้บอกให้ใช้แบบของกองทุนเมื่อกองทุนมีแบบของตนเอง`)
            for (const word of ['การพิจารณาเป็นอำนาจ', 'มิใช่ของ']) {
              assert.ok(!note.includes(word), `${label}: บรรทัดท้ายใบยังมี "${word}" ที่สั่งตัดแล้ว`)
            }
          }
          assert.ok(!(await sheets.locator('body').innerText()).includes('การพิจารณาเป็นอำนาจของคณะกรรมการกองทุน'),
            `${label}: ประโยคที่สั่งตัดไปโผล่ที่อื่นในเอกสาร`)
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
    // ระบบสั่งเมื่อ 2569-09-10 ให้พิมพ์ชื่อทุกกรณี — สิ่งที่ยังห้ามคือ "บรรทัดกำกับ" ที่อ้างว่า
    // ยืนยันตัวตนผ่านระบบแล้ว เพราะไม่เป็นความจริงและใบนี้ส่งออกไปให้องค์กรภายนอกใช้อนุมัติ
    name: 'counter-entry-prints-name-but-not-online-claim',
    reason: 'ใบที่เจ้าหน้าที่คีย์แทนต้องพิมพ์ชื่อผู้ยื่น แต่ห้ามอ้างว่ายืนยันตัวตนผ่านระบบแล้ว',
    async run(browser) {
      const counterForm = { ...FORM, signed_by: null }
      const page = await render(browser, buildPatientTransportFormHtml(args({ form: counterForm })))
      try {
        const info = await page.evaluate(() => ({
          signed: [...document.querySelectorAll('.sign-signed')].map(el => el.textContent.trim()),
          note: document.querySelector('.signed-note')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
          lines: document.querySelectorAll('.sign-line').length,
        }))
        assert.deepEqual(info.signed, [PARENT.requester_name],
          'ใบที่เจ้าหน้าที่คีย์แทนต้องพิมพ์ชื่อผู้ยื่นบนเส้น 1 จุด')
        assert.ok(!/ยืนยันตัวตนผ่านระบบ/.test(info.note),
          `บรรทัดกำกับอ้างว่ายืนยันตัวตนผ่านระบบทั้งที่ไม่ได้ยืนยัน: "${info.note}"`)
        assert.ok(/บันทึกคำขอแทนที่เคาน์เตอร์/.test(info.note),
          `บรรทัดกำกับไม่ได้บอกว่าเจ้าหน้าที่บันทึกแทน: "${info.note}"`)
        assert.ok(/ลงลายมือชื่อรับรอง/.test(info.note),
          'ไม่ได้บอกให้ผู้ยื่นเซ็นรับรองทับ ทั้งที่ยังไม่มีลายมือชื่อจริงบนใบ')
        // ไม่เหลือเส้นเปล่าให้เขียนมือ — ช่องผู้ยื่นพิมพ์ชื่อบนเส้นแล้ว ส่วนช่องของกรรมการกองทุนตัดออก 2569-10-01
        assert.equal(info.lines, 0, `มีเส้นลงนามเปล่า ${info.lines} เส้น ต้องไม่มี`)
      } finally { await page.close() }
    },
  },
  {
    name: 'online-entry-keeps-eservice-note',
    reason: 'ใบที่ประชาชนยื่นเองต้องมีบรรทัดกำกับ E-Service พร้อมเลขอ้างอิง เป็นร่องรอยให้ตรวจย้อนได้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportFormHtml(args()))
      try {
        const note = await page.evaluate(() =>
          document.querySelector('.signed-note')?.textContent.replace(/\s+/g, ' ').trim() ?? '')
        assert.ok(/ยืนยันตัวตนผ่านระบบ E-Service/.test(note), `ไม่พบบรรทัดกำกับ E-Service: "${note}"`)
        assert.ok(note.includes('A1B2C3D4'), 'บรรทัดกำกับไม่มีเลขอ้างอิง')
        assert.ok(!/บันทึกคำขอแทนที่เคาน์เตอร์/.test(note), 'ใบที่ยื่นออนไลน์ติดข้อความของโหมดเคาน์เตอร์มาด้วย')
      } finally { await page.close() }
    },
  },
  // --- ระบบจองคิวรถ: หนังสือนำส่งต่อเที่ยว + สรุปรายเดือน ------------------------------------
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
    // เจ้าของระบบสั่ง 2569-10-01: ใบคำขอถึงนายกลงชื่อเป็นชื่อผู้แจ้ง "แบบออนไลน์" — เขียนได้ตามจริงเฉพาะคำขอที่ผู้แจ้ง
    // ล็อกอินจองเอง (entry_channel 'online') · คำขอที่เจ้าหน้าที่รับจองแทน เจ้าของระบบเลือก "ไม่ต้องเซ็น" ให้บอกตามจริง
    // ว่าเจ้าหน้าที่รับจองแทน · ⚠️ ห้ามให้ใบที่ผู้แจ้งไม่ได้แตะระบบอ้างว่ายืนยันตัวตนผ่านระบบ (ใบนี้แนบไปกับหนังสือถึงองค์กรภายนอก)
    name: 'trip-form-signature-follows-entry-channel',
    reason: 'บรรทัดกำกับใต้ชื่อผู้ยื่นต้องตรงกับช่องทางที่คำขอเข้ามาจริง: จองเอง = ลงชื่อออนไลน์ · เจ้าหน้าที่รับจองแทน = บอกว่ารับจองแทน'
      + ' ไม่ขอลายมือชื่อ · ไม่รู้ช่องทาง = ไม่อ้างอะไรเลย และหนังสือนำส่งต้องไม่เขียนขัดกับใบที่แนบ',
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
            note: sheet.querySelector('.signed-note')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
            signed: [...sheet.querySelectorAll('.sign-signed')].map(el => el.textContent.trim()),
            lines: sheet.querySelectorAll('.sign-line').length,
          })))
          const forms = sheets.filter(sheet => sheet.isForm)
          return { letter: sheets.find(sheet => !sheet.isForm), forms, form: forms[0] }
        } finally { await page.close() }
      }
      const trip = (bookings, shotFile) => read(buildTripForwardLetterHtml({ ...tripArgs(), bookings }), shotFile)
      const booking = (index, overrides = {}) => ({ ...TRIP_BOOKINGS[index], ...overrides })
      // วันเวลาแสดงตามเวลาเครื่องที่พิมพ์ — ตรวจรูปแบบ ไม่ล็อกชั่วโมง เครื่องที่ตั้งโซนเวลาอื่นจะได้ไม่ล้มลวง
      const STAMP = String.raw`เมื่อ \d{1,2} \S+ 2569 เวลา \d{2}\.\d{2} น\.`
      const nameOnLine = (form, name, label) => {
        assert.deepEqual(form.signed, [name], `${label}: ชื่อผู้ยื่นต้องอยู่บนเส้นลงชื่อ 1 จุด`)
        assert.equal(form.lines, 0, `${label}: ต้องไม่มีเส้นเปล่าให้เซ็น`)
      }

      // 1) ผู้แจ้งล็อกอินจองเอง — ลงชื่อออนไลน์ ไม่ขอให้เซ็นปากกา
      {
        const { letter, form } = await trip([booking(0, { entry_channel: 'online' })])
        assert.match(form.note, new RegExp(`^ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service ${STAMP} · เลขอ้างอิง B-0$`),
          `ใบของผู้ที่จองเอง: "${form.note}"`)
        nameOnLine(form, TRIP_BOOKINGS[0].requester_name, 'จองเอง')
        assert.ok(letter.text.includes('ผ่านระบบบริการอิเล็กทรอนิกส์'), 'หนังสือของคำขอที่จองเองต้องยังบอกว่ายื่นผ่านระบบ')
        assert.deepEqual(letter.signed, [], 'หนังสือนำส่งต้องไม่มีชื่อพิมพ์แทนลายมือชื่อ')
      }
      // 2) เจ้าหน้าที่รับจองแทน — บอกตามจริง ไม่อ้างว่ายืนยันตัวตน ไม่ขอลายมือชื่อ
      {
        const { letter, form } = await trip([booking(0, { entry_channel: 'staff' })], 'patient-document-staff-entry.png')
        assert.match(form.note, new RegExp(`^เจ้าหน้าที่รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์ ${STAMP} · เลขอ้างอิง B-0$`),
          `ใบที่เจ้าหน้าที่รับจองแทน: "${form.note}"`)
        for (const claim of ['ยืนยันตัวตน', 'ลงลายมือชื่อ']) {
          assert.ok(!form.note.includes(claim), `ใบที่เจ้าหน้าที่รับจองแทนต้องไม่มี "${claim}": "${form.note}"`)
        }
        nameOnLine(form, TRIP_BOOKINGS[0].requester_name, 'รับจองแทน')
        assert.ok(!letter.text.includes('ผ่านระบบบริการอิเล็กทรอนิกส์'),
          'หนังสือเขียนว่ายื่นผ่านระบบ ทั้งที่ใบคำขอที่แนบเขียนว่าเจ้าหน้าที่รับจองแทน')
        assert.ok(letter.text.includes(`ได้ยื่นคำขอต่อ${TENANT.name} ตามเลขอ้างอิง B-0`), 'ย่อหน้าแรกของหนังสือต้องยังอ่านต่อเนื่องหลังตัดวลี')
      }
      // 3) ไม่รู้ช่องทาง (ไม่มีค่า หรือค่าที่ไม่รู้จัก) — ไม่อ้างทั้งสองแบบ คงข้อความเดิมที่ขอให้เซ็นรับรอง
      for (const unknown of [undefined, null, 'phone']) {
        const { letter, form } = await trip([booking(0, { entry_channel: unknown })])
        assert.ok(form.note.includes('จัดทำจากข้อมูลการจองรถ') && form.note.includes('โปรดลงลายมือชื่อรับรอง'),
          `ช่องทาง ${unknown}: "${form.note}"`)
        for (const claim of ['ยืนยันตัวตน', 'รับจองแทน']) {
          assert.ok(!form.note.includes(claim), `ช่องทาง ${unknown}: อ้าง "${claim}" ทั้งที่ไม่รู้ช่องทาง`)
        }
        assert.ok(!letter.text.includes('ผ่านระบบบริการอิเล็กทรอนิกส์'), `ช่องทาง ${unknown}: หนังสืออ้างว่ายื่นผ่านระบบ`)
      }
      // 4) เที่ยวเดียวมีทั้งสองแบบ — แต่ละใบได้บรรทัดของตัวเอง ไม่ปนกัน
      {
        const { forms } = await trip([booking(0), booking(1)])
        assert.equal(forms.length, 2)
        assert.ok(forms[0].note.includes('ยืนยันตัวตนผ่านระบบ E-Service') && forms[0].note.includes('B-0'), `ใบแรก: "${forms[0].note}"`)
        assert.ok(forms[1].note.includes('เจ้าหน้าที่รับจองแทน') && forms[1].note.includes('B-1'), `ใบที่สอง: "${forms[1].note}"`)
        assert.ok(!forms[1].note.includes('ยืนยันตัวตน'), 'ใบของคนที่เจ้าหน้าที่รับจองแทนติดข้อความลงชื่อออนไลน์ของอีกคน')
        nameOnLine(forms[0], TRIP_BOOKINGS[0].requester_name, 'ร่วมเที่ยว คนที่ 1')
        nameOnLine(forms[1], TRIP_BOOKINGS[1].requester_name, 'ร่วมเที่ยว คนที่ 2')
      }
      // 5) ชุดเอกสารของระบบคำขอแบบเดิมต้องได้ถ้อยคำเท่าเดิม — งานนี้แก้เฉพาะระบบจองคิว
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
