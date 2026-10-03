// "ขอแสดงความนับถือ" ต้องอยู่กึ่งกลางเหนือชื่อผู้ลงนาม — กันถอยหลังใบที่ตรงกันอยู่แล้ว 4 ใบ
//
// ที่มา (2569-10-03): เจ้าของระบบจับได้ว่าคำลงท้ายเยื้องจากชื่อในใบคำขอรถรับ-ส่งผู้ป่วย (4.66mm)
// และใบขอรับการช่วยเหลือ (8.14mm) แก้ใน PR #408 พร้อมเทสต์ของสองใบนั้นเอง (patient-transport-layout,
// public-assistance-layout) แล้ววัดใบอื่นทั้งหมด — 4 ใบนี้ตรงกัน 0mm อยู่แล้วแต่ไม่มีเทสต์กันเลย
// แก้ CSS ของใบไหนแล้วคำลงท้ายเยื้องออกไปจะไม่มีใครเห็นจนกว่าเจ้าหน้าที่จะพิมพ์ออกมา
//   1. หนังสือนำส่งกองทุน (patientTransportPrint.js — .regards + .letter-sign)
//   2. แบบคำร้อง (สภา) (councilFormPrint.js)
//   3. ใบแจ้งขอยกเลิกเก็บขนขยะ (wasteCollectionCancelPrint.js)
//   4. ใบแจ้งขออนุญาตเก็บขนขยะ (wasteCollectionRequestPrint.js — ไม่มีเทสต์เลย์เอาต์อื่นเลย)
//
// "แกนชื่อ" = บรรทัด "(ชื่อ)" ใต้ช่องเซ็นของใบนั้น (ทุกใบเว้นวงเล็บเปล่าให้เขียนมือเมื่อไม่มีชื่อ)
// ⚠️ วัดด้วย Range + getClientRects() (กล่องตัวอักษรจริง) ผ่าน measureTextCenterMm ห้ามวัดกล่องของ element
//    — บทเรียนใน tests/lib/signBlockChecks.mjs · และมีข้อ "วัดแล้วต้องเห็นของเยื้อง" กันตัววัดผ่านลวง
// ⚠️ ใบสองระบบ (ระบบคำขอเดิม/ระบบจองคิว) ของรถรับ-ส่ง และใบขอรับการช่วยเหลือ มีเทสต์ของตัวเองแล้ว ไม่ซ้ำที่นี่
//
// รันด้วย: npm run test:regards-alignment

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildPatientTransportLetterHtml } from '../src/lib/patientTransportPrint.js'
import { buildCouncilComplaintHtml } from '../src/lib/councilFormPrint.js'
import { buildWasteCollectionCancelHtml } from '../src/lib/wasteCollectionCancelPrint.js'
import { buildWasteCollectionRequestHtml } from '../src/lib/wasteCollectionRequestPrint.js'
import { measureTextCenterMm } from './lib/signBlockChecks.mjs'

const TOLERANCE_MM = 0.5
const CLOSING = 'ขอแสดงความนับถือ'
const SHORT_NAME = 'นายสมชาย ใจดี'
const LONG_NAME = 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล'

const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
  org_type: 'อบต.',
  address: 'เลขที่ 199 หมู่ที่ 5 ตำบลทุ่งแค้ว',
  district: 'หนองม่วงไข่',
  province: 'แพร่',
  phone: '0-5460-0000',
  fax: '0-5460-0001',
}

// ── หนังสือนำส่ง: นายกเซ็นปากกา (ไม่พิมพ์ชื่อเป็นลายเซ็น) แต่ชื่อในวงเล็บเปลี่ยนตามทะเบียนผู้ลงนาม
const LETTER_ARGS = {
  header: {
    municipality_id: 'muni-1', department_id: 'dept-1', partner_id: 'partner-1',
    partner_name_snapshot: 'กองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่',
    recipient_title_snapshot: 'ประธานคณะกรรมการกองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว',
    appointment_at: '2026-09-18T08:30:00+07:00', mobility: 'wheelchair', workflow_status: 'forwarded',
    consent_at: '2026-09-10T09:15:00+07:00', consent_version: 'ptr-consent-v1',
    forward_letter_no: 'พร 72301/1234', forward_letter_date: '2026-09-11',
  },
  form: {
    requester_relation: 'relative', requester_relation_note: 'บุตรสาว',
    patient_name: 'นางประกายมาศ ศรีวิชัยเลิศสกุล', patient_age: 78, fund_member_no: 'ทค-2560-01234',
    pickup_address: 'บ้านเลขที่ 199/25 หมู่ที่ 12 ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่',
    destination: 'โรงพยาบาลแพร่', appointment_kind: 'other', appointment_kind_note: 'ตรวจติดตามหลังผ่าตัด',
    trip_type: 'round_trip', mobility: 'wheelchair', companions: 1,
    consent_version: 'ptr-consent-v1', signed_at: '2026-09-10T09:15:00+07:00',
    signed_by: { channel: 'online', name: 'นางสาวสุดารัตน์ ศรีวิชัยเลิศสกุล' },
  },
  parent: {
    requester_name: 'นางสาวสุดารัตน์ ศรีวิชัยเลิศสกุล', requester_phone: '081-234-5678',
    requester_address: 'บ้านเลขที่ 199/25 หมู่ที่ 12 ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่',
    created_at: '2026-09-10T09:15:00+07:00',
  },
  partner: { address: 'ที่ทำการกองทุนฯ หมู่ที่ 5 ตำบลทุ่งแค้ว', phone: '089-999-8888' },
  tenant: TENANT,
  referenceNo: 'A1B2C3D4',
  docDate: '2026-09-10T09:15:00+07:00',
  emblemUrl: '',
}
const mayor = name => ({ name, title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' })

// ── แบบคำร้อง (สภา): ชื่อใต้คำลงท้ายคือผู้ร้อง
const COUNCIL_ARGS = {
  c: {
    id: '00000000-0000-4000-8000-000000000001', reporter_name: SHORT_NAME, category: 'light',
    department: 'กองช่าง', detail: 'ไฟฟ้าสาธารณะริมถนนสายบ้านทุ่งแค้ว-บ้านหนองม่วงไข่ ชำรุดไม่สว่างมาหลายวัน',
    village: 'หมู่ที่ 12',
  },
  tenant: { name: TENANT.name, org_type: 'อบต.', district: 'อำเภอหนองม่วงไข่', province: 'จังหวัดแพร่' },
  terminology: {
    mayor: 'นายกองค์การบริหารส่วนตำบล', clerk: 'ปลัดองค์การบริหารส่วนตำบล',
    council: 'สมาชิกสภาองค์การบริหารส่วนตำบล',
  },
  num: '128/2569', thDate: '14 พฤศจิกายน 2569', cat: 'ไฟฟ้าสาธารณะ', phone: '081-234-5678',
  signatories: {},
}

// ── ใบขยะสองใบ: ผู้ยื่นลงชื่อออนไลน์ (พิมพ์ชื่อ) หรือเคาน์เตอร์ (เว้นช่องเซ็น) — สองทางมีโครงต่างกัน
const APPLICANT = {
  title: 'นาย', first: 'สมชาย', last: 'ใจดี', age: 45, phone: '081-234-5678', id_card: '1234567890123',
  addr_no: '99/1', addr_moo: '4', addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
}
const LONG_APPLICANT = { ...APPLICANT, title: 'นางสาว', first: 'ประกายมาศ', last: 'ศรีวิชัยเลิศสกุล' }
const wasteForm = (type, applicant, signedBy) => ({
  form_type: type, form_version: 1, applicant,
  place_type: 'บ้านพักอาศัย', bin_count: 1,
  same_as_applicant: true, cancel_reason: 'ย้ายที่อยู่', cancel_date: '2026-10-01', outstanding_ack: true,
  collection_point: { lat: 18.258742, lng: 100.308329, address: 'บ้านทุ่งแค้ว' },
  service_start_date: '2026-10-01',
  signed_at: '2026-09-07T10:32:00', signed_by: signedBy,
})
const wasteHtml = (build, type) => (applicant, channel) => build({
  form: wasteForm(type, applicant, { channel, name: `${applicant.title}${applicant.first} ${applicant.last}` }),
  tenant: { name: TENANT.name, org_type: 'อบต.' },
  thDate: '7 กันยายน พ.ศ. 2569', referenceNo: 'A1B2C3D4', signedAt: '2026-09-07T10:32:00',
})

// สิ่งที่แต่ละใบต้องวัด: ชื่อที่ต้องลอง + ตัวสร้างใบ
const DOCS = [
  {
    name: 'หนังสือนำส่งกองทุน',
    cases: [
      ['ชื่อนายกสั้น', () => buildPatientTransportLetterHtml({ ...LETTER_ARGS, mayor: mayor(SHORT_NAME) })],
      ['ชื่อนายกยาว', () => buildPatientTransportLetterHtml({ ...LETTER_ARGS, mayor: mayor('พันตำรวจเอกสมศักดิ์ ตั้งใจพัฒนาเจริญสุขสันต์') })],
      ['ไม่มีชื่อนายก', () => buildPatientTransportLetterHtml({ ...LETTER_ARGS, mayor: mayor('') })],
    ],
  },
  {
    name: 'แบบคำร้อง (สภา)',
    cases: [
      ['ชื่อผู้ร้องสั้น', () => buildCouncilComplaintHtml(COUNCIL_ARGS)],
      ['ชื่อผู้ร้องยาว', () => buildCouncilComplaintHtml({ ...COUNCIL_ARGS, c: { ...COUNCIL_ARGS.c, reporter_name: LONG_NAME } })],
    ],
  },
  {
    name: 'ใบแจ้งขอยกเลิกเก็บขนขยะ',
    cases: [
      ['ออนไลน์ ชื่อสั้น', () => wasteHtml(buildWasteCollectionCancelHtml, 'waste_collection_cancel')(APPLICANT, 'online')],
      ['ออนไลน์ ชื่อยาว', () => wasteHtml(buildWasteCollectionCancelHtml, 'waste_collection_cancel')(LONG_APPLICANT, 'online')],
      ['เคาน์เตอร์ ชื่อสั้น', () => wasteHtml(buildWasteCollectionCancelHtml, 'waste_collection_cancel')(APPLICANT, 'counter')],
    ],
  },
  {
    name: 'ใบแจ้งขออนุญาตเก็บขนขยะ',
    cases: [
      ['ออนไลน์ ชื่อสั้น', () => wasteHtml(buildWasteCollectionRequestHtml, 'waste_collection_request')(APPLICANT, 'online')],
      ['ออนไลน์ ชื่อยาว', () => wasteHtml(buildWasteCollectionRequestHtml, 'waste_collection_request')(LONG_APPLICANT, 'online')],
      ['เคาน์เตอร์ ชื่อสั้น', () => wasteHtml(buildWasteCollectionRequestHtml, 'waste_collection_request')(APPLICANT, 'counter')],
    ],
  },
]

// ⚠️ viewport ต้องเท่าความกว้างพื้นที่พิมพ์จริง (160mm = 604.7px ที่ 96dpi) เหตุผลเดียวกับ council-form-layout
async function render(browser, html) {
  const page = await browser.newPage({ viewport: { width: 605, height: 1044 } })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(200)
  return page
}

// ติดป้ายให้สองบรรทัดที่ต้องวัดด้วย data-attribute แล้วคืนจำนวนที่เจอ — วัดซ้ำด้วย measureTextCenterMm
async function tagClosingAndName(page) {
  return page.evaluate(closingText => {
    const closings = [...document.querySelectorAll('p')].filter(p => p.textContent.trim() === closingText)
    if (closings.length !== 1) return { closings: closings.length, name: null }
    const [closing] = closings
    closing.setAttribute('data-closing', '')
    // ชื่ออยู่ในกล่องลงนามเดียวกับคำลงท้าย (หนังสือนำส่งแยกเป็นพี่น้อง) — หา "(…)" บรรทัดแรกที่อยู่ถัดจากคำลงท้ายในเอกสาร
    const name = [...document.querySelectorAll('p')].find(p =>
      (closing.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) && p.textContent.trim().startsWith('('))
    name?.setAttribute('data-name', '')
    return { closings: closings.length, name: name?.textContent.trim() ?? null }
  }, CLOSING)
}

const checks = [
  {
    name: 'regards-centered-on-name',
    reason: `"${CLOSING}" ต้องอยู่กึ่งกลางเหนือบรรทัด "(ชื่อ)" ของใบนั้น (เยื้องไม่เกิน ${TOLERANCE_MM}mm) ทั้งชื่อสั้น ชื่อยาว และไม่มีชื่อ`,
    async run(browser) {
      const offsets = []
      for (const doc of DOCS) {
        for (const [label, build] of doc.cases) {
          const page = await render(browser, build())
          try {
            const found = await tagClosingAndName(page)
            assert.equal(found.closings, 1, `${doc.name}/${label}: ต้องมีคำลงท้ายหนึ่งที่ แต่เจอ ${found.closings}`
              + ' — โครงสร้างเปลี่ยนไปจนไม่มีอะไรให้วัด ไม่ใช่ว่าผ่าน')
            assert.ok(found.name, `${doc.name}/${label}: ไม่พบบรรทัด "(ชื่อ)" ใต้คำลงท้าย`)
            const offset = (await measureTextCenterMm(page, '[data-closing]')) - (await measureTextCenterMm(page, '[data-name]'))
            offsets.push(`${doc.name}/${label} ${offset.toFixed(2)}`)
            assert.ok(Math.abs(offset) <= TOLERANCE_MM,
              `${doc.name}/${label}: "${CLOSING}" เยื้องจากกึ่งกลางชื่อ ${offset.toFixed(2)}mm (ขวาเป็นบวก) เกิน ${TOLERANCE_MM}mm`)
          } finally { await page.close() }
        }
      }
      return offsets.join(' · ')
    },
  },
  {
    name: 'measurement-detects-misalignment',
    reason: 'ตัววัดต้อง "เห็น" คำลงท้ายที่เยื้องจริง — ขยับคำลงท้าย 6mm แล้วต้องวัดได้ราว 6mm กันเทสต์ข้างบนผ่านลวง'
      + ' (เคยมีเทสต์ที่วัดกล่องของ element แล้วผ่านทั้งที่ของจริงเยื้อง 16-25mm)',
    async run(browser) {
      for (const doc of DOCS) {
        const [label, build] = doc.cases[0]
        const page = await render(browser, build())
        try {
          await tagClosingAndName(page)
          const before = await measureTextCenterMm(page, '[data-closing]')
          await page.evaluate(() => {
            const closing = document.querySelector('[data-closing]')
            closing.style.position = 'relative'
            closing.style.left = '6mm'
          })
          // วัดเป็น "ส่วนต่างก่อน–หลังขยับ" ไม่ผูกกับว่าใบนั้นตรงอยู่หรือไม่ — ใบเยื้องอยู่แล้วให้ข้อแรกรายงาน ข้อนี้รายงานเฉพาะตัววัดเสีย
          const moved = (await measureTextCenterMm(page, '[data-closing]')) - before
          assert.ok(Math.abs(moved - 6) <= 0.3, `${doc.name}/${label}: ขยับคำลงท้าย 6mm แต่วัดได้ ${moved.toFixed(2)}mm — ตัววัดไม่ไวพอ`)
        } finally { await page.close() }
      }
    },
  },
]

// channel: 'chrome' ใช้ Chrome ที่ลงในเครื่องอยู่แล้ว ไม่ต้อง playwright install เพิ่ม
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let failed = 0
console.log('คำลงท้ายตรงชื่อผู้ลงนาม — ใบที่ตรงกันอยู่แล้ว 4 ใบ')
try {
  for (const check of checks) {
    try {
      const detail = await check.run(browser)
      console.log(`PASS ${check.name}: ${check.reason}${typeof detail === 'string' && detail ? `\n     ${detail}` : ''}`)
    } catch (error) {
      failed += 1
      console.log(`FAIL ${check.name}: ${error.message}`)
    }
  }
} finally {
  await browser.close()
}
console.log(`SUMMARY PASS=${checks.length - failed} FAIL=${failed}`)
if (failed) process.exitCode = 1
