// หนังสือนำส่ง + ใบคำขอรับสวัสดิการ (รถรับ-ส่งผู้ป่วย) — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง"
//
// วิธีเดียวกับ asset-borrow-layout.test.mjs: เรนเดอร์ HTML ด้วยเบราว์เซอร์จริงแล้ววัดจาก DOM
// ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล รันด้วย: node tests/patient-transport-layout.test.mjs
//
// ทำไมต้องมี: ทั้งสองใบต้องจบใบละ 1 แผ่น — หนังสือนำส่งที่ล้นไปหน้า 2 ทำให้ช่องลงนามของนายก
// หลุดไปอยู่คนละหน้ากับเนื้อความ ซึ่งเป็นเอกสารที่ใช้ไม่ได้ ส่วนใบคำขอมีตาราง 10 แถว +
// บล็อกลงนามของกองทุนอีก 2 ช่อง ที่อยู่จุดรับยาวๆ ดันใบตกหน้า 2 ได้จริง
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

const checks = [
  {
    name: 'forward-letter-one-page',
    reason: 'หนังสือนำส่งที่ล้นหน้า 2 ทำให้ช่องลงนามนายกหลุดไปคนละหน้ากับเนื้อความ ใช้ไม่ได้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const mm = await sheetContentMm(page, 0)
        assert.ok(mm <= ONE_PAGE_BUDGET_MM,
          `หนังสือนำส่งสูง ${mm.toFixed(1)}mm เกินงบ ${ONE_PAGE_BUDGET_MM}mm `
          + `(พื้นที่ ${PRINT_HEIGHT_MM}mm) — ทบทวนระยะเว้นก่อนช่องลงนามหรือความยาวย่อหน้า`)
      } finally { await page.close() }
    },
  },
  {
    name: 'welfare-form-one-page',
    reason: 'ใบคำขอมีตาราง 10 แถว + ช่องลงนามกองทุน 2 ช่อง ที่อยู่ยาวๆ ดันตกหน้า 2 ได้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const mm = await sheetContentMm(page, 1)
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
        assert.equal(info.breakBefore, 'page', 'ใบคำขอไม่ได้ตั้ง break-before: page')
      } finally { await page.close() }
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
          text: document.body.innerText,
        }))
        assert.equal(info.sheets, 1, `ได้ ${info.sheets} แผ่น ต้องเป็น 1 แผ่น`)
        assert.ok(!info.text.includes('ขอแสดงความนับถือ'),
          'ใบของประชาชนมีคำลงท้ายของหนังสือราชการติดมาด้วย')
        assert.ok(!info.text.includes(MAYOR.name),
          'ใบของประชาชนมีชื่อผู้บริหาร อปท. ในช่องลงนาม ซึ่งไม่ควรมี')
      } finally { await page.close() }
    },
  },
  {
    name: 'no-horizontal-overflow',
    reason: 'พื้นที่พิมพ์กว้าง 16 ซม. ตาราง กล่องกองทุน หรือช่องลงนามล้นขอบขวาไม่ได้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const overflow = await page.evaluate(() =>
          [...document.querySelectorAll('.sheet')].flatMap((sheet, index) => {
            const style = getComputedStyle(sheet)
            const inner = sheet.getBoundingClientRect().width
              - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            return [...sheet.querySelectorAll('table, .two-col, .committee, .letter-head')]
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
        // ผู้ยื่นคำขอ 1 ช่อง + กรรมการกองทุน 2 ช่อง (ช่องละ 2 บรรทัดใต้เส้น) = อย่างน้อย 5 บรรทัด
        await assertSignBlockStandard(page, { minRows: 3, minBelow: 5 })
        // ช่องกรรมการกองทุนอยู่บล็อกเดียวกัน 2 คอลัมน์ เส้นต้องยาวเท่ากัน
        await assertSignLinesAligned(page, '.committee .sign-row')
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
    reason: 'ย่อหน้าเงื่อนไขการใช้ข้อมูลกับบรรทัดกำกับที่มาของแบบ เป็นเนื้อหาบังคับ ห้ามหายไปเงียบๆ',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const text = await page.evaluate(() => document.body.innerText)
        assert.ok(text.includes('ให้ความยินยอมเป็นการเฉพาะ'),
          'หนังสือนำส่งไม่มีย่อหน้าแจ้งฐานความยินยอม')
        assert.ok(text.includes('หยุดใช้ข้อมูลเมื่อเสร็จภารกิจ'),
          'หนังสือนำส่งไม่ได้จำกัดขอบเขตการใช้ข้อมูลของผู้รับ')
        assert.ok(text.includes('สถาบันพัฒนาองค์กรชุมชน'),
          'ใบคำขอไม่มีบรรทัดกำกับว่าลอกโครงมาจากแบบตัวอย่างกลางของ พอช.')
        assert.ok(text.includes('มิใช่ของ'),
          'ใบคำขอไม่ได้บอกว่าการพิจารณาเป็นอำนาจของกองทุน ไม่ใช่ของ อปท.')
      } finally { await page.close() }
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
    name: 'fund-committee-fields-blank',
    reason: 'คณะกรรมการกองทุนไม่ได้อยู่ในระบบนี้ ระบบต้องไม่กรอกความเห็นหรือชื่อผู้ลงนามให้',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const committee = await page.evaluate(() =>
          document.querySelector('.committee').innerText.replace(/\s+/g, ' '))
        assert.ok(!committee.includes('อนุมัติแล้ว'), 'กล่องกองทุนมีผลการพิจารณาที่ระบบเติมให้')
        // ต้องไม่มีชื่อคนจริงคนใดหลุดเข้าไปในช่องลงนามของกองทุน
        for (const name of [MAYOR.name, PARENT.requester_name, FORM.patient_name]) {
          assert.ok(!committee.includes(name), `กล่องกองทุนมีชื่อ "${name}" อยู่ในช่องลงนาม`)
        }
      } finally { await page.close() }
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
        // เหลือเส้นให้เขียนมือเฉพาะของกองทุน 2 ช่อง (ประธาน + เหรัญญิก/พยาน)
        assert.equal(info.lines, 2, `มีเส้นลงนาม ${info.lines} เส้น ต้องเป็น 2`)
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
      for (const count of [1, 8]) {
        const input = tripArgs()
        input.bookings = input.bookings.slice(0, count)
        input.bookings.push({ ...TRIP_BOOKINGS[0], id: 'cancelled', status: 'cancelled', patient_name: 'CANCELLED_PATIENT' })
        input.bookings.push({ ...TRIP_BOOKINGS[0], id: 'other', trip_id: 'other-trip', patient_name: 'OTHER_TRIP_PATIENT' })
        const page = await render(browser, buildTripForwardLetterHtml(input))
        try {
          assert.equal(await page.locator('.sheet').count(), count + 1)
          assert.equal(await page.locator('.committee').count(), count)
          const text = await page.locator('body').innerText()
          assert.ok(!text.includes('CANCELLED_PATIENT') && !text.includes('OTHER_TRIP_PATIENT'))
          assert.ok(text.includes(`จำนวน ${count} ฉบับ`))
          for (let i = 0; i <= count; i++) {
            const mm = await sheetContentMm(page, i)
            assert.ok(mm <= ONE_PAGE_BUDGET_MM, `แผ่น ${i + 1} สูง ${mm.toFixed(1)}mm เกิน ${ONE_PAGE_BUDGET_MM}mm`)
          }
          await assertSignBlockStandard(page, { minRows: count * 3, minBelow: count * 5 })
          if (count === 1 && process.env.PATIENT_PRINT_SCREENSHOT_DIR) {
            for (let i = 0; i < 2; i++) await page.locator('.sheet').nth(i).screenshot({ path: `${process.env.PATIENT_PRINT_SCREENSHOT_DIR}/patient-document-${i + 1}.png` })
          }
        } finally { await page.close() }
      }
      assert.throws(() => buildTripForwardLetterHtml({ ...tripArgs(), bookings: [] }), /ไม่มีคำขอ/)
    },
  },
  {
    name: 'trip-letter-data-minimization',
    reason: 'หนังสือไม่ใส่เบอร์/จุดรับ ใบคำขอมีข้อมูลตามแบบ ไม่พิมพ์พิกัดและไม่อ้างว่าลงชื่อออนไลน์',
    async run(browser) {
      const page = await render(browser, buildTripForwardLetterHtml({ ...tripArgs(), bookings: TRIP_BOOKINGS.slice(0, 1) }))
      try {
        const letter = await page.locator('.sheet').nth(0).innerText()
        const form = await page.locator('.sheet').nth(1).innerText()
        for (const value of ['0891234567', 'บ้านเลขที่ 88']) {
          assert.ok(!letter.includes(value))
          assert.ok(form.includes(value))
        }
        assert.ok(!(letter + form).includes('18.1234'))
        assert.ok(letter.includes('ให้ความยินยอมเป็นการเฉพาะ'))
        assert.ok(letter.includes('พร 72301/88'))
        assert.ok(form.includes('ใบคำขอรับสวัสดิการ'))
        assert.ok(form.includes('โปรดลงลายมือชื่อรับรอง'))
        assert.ok(!form.includes('ลงชื่อโดยการยืนยันตัวตน'))
        assert.ok(!form.includes('เจ้าหน้าที่บันทึกคำขอแทนที่เคาน์เตอร์'))
        assert.equal(await page.locator('.committee .box--on').count(), 0)
      } finally { await page.close() }
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
          const letter = page.locator('.sheet').nth(0)
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
          const text = await page.locator('.sheet').nth(0).innerText()
          assert.ok(!text.includes('ข้อความยินยอมรุ่น'), `${label}: ยังมีคำว่า "ข้อความยินยอมรุ่น"`)
          assert.ok(!text.includes(version), `${label}: ยังพิมพ์รหัส ${version}`)
          assert.ok(text.includes('ให้ความยินยอมเป็นการเฉพาะ'), `${label}: ย่อหน้าความยินยอมหายไปด้วย`)
          assert.match(text, /เมื่อวันที่ \d+ \S+ \d{4}/, `${label}: วันที่ยินยอมหายไปด้วย`)
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
