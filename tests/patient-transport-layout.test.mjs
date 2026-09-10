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
import { chromium } from 'playwright'
import {
  buildPatientTransportFormHtml, buildPatientTransportPacketHtml,
} from '../src/lib/patientTransportPrint.js'

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
    departmentName: 'สำนักปลัด',
    referenceNo: 'A1B2C3D4',
    docDate: PARENT.created_at,
    emblemUrl: '',
    ...overrides,
  }
}

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
            return [...sheet.querySelectorAll('table, .two-col, .committee, .letter-head, .choices')]
              .map(el => ({ index, diff: el.getBoundingClientRect().width - inner }))
              .filter(entry => entry.diff > 1)
          }))
        assert.deepEqual(overflow, [],
          `มีบล็อกล้นขอบขวา: ${overflow.map(e => `แผ่น ${e.index + 1} เกิน ${e.diff.toFixed(1)}px`).join(', ')}`)
      } finally { await page.close() }
    },
  },
  {
    name: 'signature-name-centered-under-line',
    reason: 'บรรทัดใต้เส้นลงนาม (วงเล็บชื่อ/ชื่อตำแหน่ง) ต้องอยู่กึ่งกลางแกนเดียวกับเส้นจุด',
    async run(browser) {
      const page = await render(browser, buildPatientTransportPacketHtml(args()))
      try {
        const offsets = await page.evaluate(() => {
          const centerOf = el => {
            const box = el.getBoundingClientRect()
            return box.left + box.width / 2
          }
          return [...document.querySelectorAll('.sign-row')].flatMap((row, index) => {
            const line = row.querySelector('.sign-line')
            if (!line) return []
            return [...row.querySelectorAll('.sign-below')].map((below, order) => ({
              block: index, order, diff: Math.abs(centerOf(line) - centerOf(below)),
            }))
          })
        })
        // ช่องกรรมการกองทุน 2 ช่อง มีบรรทัดใต้เส้นช่องละ 2 บรรทัด = อย่างน้อย 4
        assert.ok(offsets.length >= 4,
          `เจอบรรทัดใต้เส้นลงนามแค่ ${offsets.length} บรรทัด — ต้องมีอย่างน้อย 4`)
        // 1mm = 3.78px ที่ 96dpi — เกินกว่านี้เริ่มเห็นด้วยตาเปล่าบนกระดาษ
        const crooked = offsets.filter(entry => entry.diff > 3.78)
        assert.deepEqual(crooked, [],
          `วงเล็บชื่อไม่อยู่กึ่งกลางใต้เส้นจุด: ${crooked
            .map(e => `บล็อก ${e.block} บรรทัด ${e.order} เยื้อง ${(e.diff / 3.78).toFixed(1)}mm`)
            .join(', ')}`)
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
