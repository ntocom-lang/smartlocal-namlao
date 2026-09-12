// แบบคำร้องขอรับการช่วยเหลือประชาชน — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วยเบราว์เซอร์
//
// คู่กับ public-assistance-print.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่ต้องเปิดเบราว์เซอร์ (เร็วกว่ามาก)
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริง: จบหน้าไหม ล้นขอบไหม ข้อความล้นกล่องไหม
//
// ทำไมต้องมี: ใบนี้หนักที่สุดในบรรดาใบที่ประชาชนยื่นออนไลน์ — มีทั้งย่อหน้าหลัก กล่องเส้นประ
// 2 ก้อน (6 + 3 บรรทัด) ช่องลงนาม และบล็อกเจ้าหน้าที่แบบตาราง 3 ช่องที่กินความสูง ~65 มม.
// รวมกันแล้วเคยล้นเป็น 2 แผ่นมาแล้วตอนพัฒนา (วัดได้ 322 มม. บนพื้นที่พิมพ์ 276 มม.)
//
// ⚠️ ต้องวัดจาก DOM ในโหมดจอ ห้ามวัดหลัง emulateMedia('print') — ในโหมดพิมพ์ .sheet ไม่มี
// padding ของตัวเอง (ขอบกระดาษมาจาก @page แทน) ความกว้างจึงเท่ากับ viewport ของเบราว์เซอร์
// (1280px = 338 มม.) ไม่ใช่พื้นที่พิมพ์ 160 มม. ข้อความจึงตัดบรรทัดน้อยกว่าของจริงมาก
// แล้ววัดความสูงได้ต่ำกว่าความจริง ~20 มม. (เจอจริงตอนเขียนเทสนี้: print media บอก 253 มม.
// ทั้งที่ของจริง 275 มม.) — โหมดจอมี padding 12/20/9/30 มม. ตรงกับขอบกระดาษพอดี
// ส่วนจำนวนหน้าให้ดูจาก page.pdf() ซึ่งเรนเดอร์ด้วย @page จริง
//
// รันด้วย: npm run test:public-assistance (รันคู่กับไฟล์ตรวจเนื้อหา)

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import {
  ATTACHMENT_ROWS_PER_PAGE,
  NEED_MAX_CHARS,
  PROBLEM_MAX_CHARS,
  buildPublicAssistanceRequestHtml,
} from '../src/lib/publicAssistancePrint.js'
import { assertSignBlockStandard } from './lib/signBlockChecks.mjs'

const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
  org_type: 'อบต.',
  address: '100 หมู่ที่ 1 ตำบลทุ่งแค้ว\nอำเภอหนองม่วงไข่ จังหวัดแพร่',
}

// ค่ายาวที่สุดที่คาดว่าจะเจอจริง — ชื่อไทยเต็มยศแบบที่เคยทำให้วงเล็บช่องลงนามตกคนละบรรทัด
// มาแล้วในใบขอรับบริการเก็บขนขยะ
const LONG_NAME = { title: 'นางสาว', first: 'ประกายมาศ', last: 'ศรีวิชัยเลิศสกุล' }

// ตัวอักษรไทยที่กว้างกว่าค่าเฉลี่ย ใช้เป็นเคสหนักสุดของกล่องเส้นประ — ข้อความจริงจะแคบกว่านี้
// เว้นวรรคทุก 4 ตัวอักษรเพื่อให้เบราว์เซอร์ตัดบรรทัดได้ตามปกติ (คำเดียวยาว 460 ตัวไม่ใช่ของจริง)
function wideText(length) {
  let text = ''
  while (text.length < length) text += 'ญฐฒณ '
  return text.slice(0, length).trim()
}

const DEPARTMENTS = [
  { name: 'สำนักปลัด' }, { name: 'กองคลัง' }, { name: 'กองช่าง' },
  { name: 'กองการศึกษา ศาสนาและวัฒนธรรม' }, { name: 'กองสวัสดิการสังคม' }, { name: 'กองสาธารณสุข' },
]

const SIGNATORIES = {
  clerk: { name: 'นายวิเชียร ทองสุขใสไพศาล' },
  mayor: { name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล' },
}

function people(count) {
  return Array.from({ length: count }, (unused, index) => ({
    name: `นางสาวจันทร์เพ็ญ แสงทองผ่องอำไพ ${index + 1}`,
    addr_no: `199/${index + 1}`,
    addr_moo: '12',
    note: 'ผู้สูงอายุ',
  }))
}

function longForm(overrides = {}) {
  return {
    form_type: 'public_assistance_request',
    form_version: 1,
    subject: 'ขอรับการช่วยเหลือกรณีอุทกภัยน้ำป่าไหลหลากเข้าท่วมบ้านเรือนราษฎร หมู่ที่ 12',
    applicant: {
      ...LONG_NAME, phone: '081-234-5678', id_card: '1234567890123',
      addr_no: '199/25', addr_moo: '12',
      addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
    },
    // เคสหนักสุด: กรอกเต็มเพดานที่ฟอร์มอนุญาตทั้งสองช่อง
    problem: wideText(PROBLEM_MAX_CHARS),
    need: wideText(NEED_MAX_CHARS),
    affected: people(5),
    signed_at: '2026-09-08T10:32:00',
    signed_by: { channel: 'online', name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล' },
    ...overrides,
  }
}

const BLANK_FORM = {
  form_type: 'public_assistance_request',
  form_version: 1,
  applicant: {},
  affected: [],
}

async function render(browser, form, extra = {}) {
  // viewport กว้างพอให้ .sheet (210 มม. = 794px) ไม่ถูกบีบ — ดู ⚠️ หัวไฟล์ว่าทำไมต้องวัดในโหมดจอ
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } })
  const html = buildPublicAssistanceRequestHtml({
    form,
    tenant: TENANT,
    docDate: '2026-09-08T10:32:00',
    referenceNo: 'A1B2C3D4',
    signedAt: form?.signed_at ?? null,
    ...extra,
  })
  await page.setContent(html, { waitUntil: 'load' })
  // ต้องรอฟอนต์โหลดเสร็จก่อนวัด ไม่งั้นวัดความสูงด้วยฟอนต์สำรองแล้วได้ผลผิด
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  return page
}

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

// ความสูงเนื้อหาของหน้าคำร้อง วัดจากขอบบนของพื้นที่พิมพ์ถึงขอบล่างขององค์ประกอบสุดท้าย
//
// ⚠️ ต้องปลด min-height ของ .sheet--request ก่อนวัดเสมอ — หน้าคำร้องสูงเต็มพื้นที่พิมพ์ตลอด
// โดยตั้งใจ (เพื่อดันบล็อกเจ้าหน้าที่ลงชิดขอบล่างด้วย margin-top: auto) ถ้าไม่ปลด ทุกใบจะวัดได้
// 276 มม. เท่ากันหมดจนเทสต์นี้ไม่เหลือความหมาย เราต้องการ "ความสูงของเนื้อหาจริง" ต่างหาก
function contentHeightMm(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.sheet')
    const restore = sheet.style.minHeight
    sheet.style.minHeight = '0'
    const top = sheet.getBoundingClientRect().top + parseFloat(getComputedStyle(sheet).paddingTop)
    const last = sheet.lastElementChild
    const mm = (last.getBoundingClientRect().bottom - top) / 3.779527
    sheet.style.minHeight = restore
    return mm
  })
}

// พื้นที่พิมพ์แนวตั้ง 276 มม. (297 - 12 - 9) — เผื่อไว้ 14 มม. เพราะเครื่อง อปท. ส่วนใหญ่
// ไม่มี THSarabunPSK แล้วตกไปใช้ Sarabun ที่ metric ไม่เท่ากันเป๊ะ
const MAX_CONTENT_MM = 262

const checks = [
  {
    name: 'fits-one-page',
    reason: 'หน้าคำร้องต้องจบใน 1 แผ่น แม้กรอกยาวเต็มเพดานทั้งสองช่องและชื่อยาวสุด',
    async run(browser) {
      const page = await render(browser, longForm(), { departments: DEPARTMENTS, signatories: SIGNATORIES })
      try {
        const mm = await contentHeightMm(page)
        assert.ok(mm <= MAX_CONTENT_MM,
          `เนื้อหาหน้าคำร้องสูง ${mm.toFixed(1)}mm เกิน ${MAX_CONTENT_MM}mm — เสี่ยงตกหน้า 2 บนเครื่องที่ไม่มีฟอนต์ราชการ`)

        await page.emulateMedia({ media: 'print' })
        // preferCSSPageSize ให้ใช้ @page ของเอกสารเอง (A4 แนวตั้ง ขอบ 1.2/2/0.9/3 ซม.)
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 2,
          'ต้องได้ 2 แผ่นพอดี: หน้าคำร้อง 1 + บัญชีแนบท้าย 1 (5 รายชื่อยังอยู่ในหน้าเดียว)')
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'counter-mode-also-fits',
    reason: 'โหมดเจ้าหน้าที่กรอกแทนใช้เส้นประให้เซ็นปากกาแทนชื่อพิมพ์ ต้องยังจบ 1 หน้าเหมือนกัน',
    async run(browser) {
      const page = await render(browser, longForm({
        signed_by: { channel: 'counter', name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล' },
      }), { departments: DEPARTMENTS })
      try {
        const mm = await contentHeightMm(page)
        assert.ok(mm <= MAX_CONTENT_MM, `เนื้อหาหน้าคำร้องสูง ${mm.toFixed(1)}mm เกิน ${MAX_CONTENT_MM}mm`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'blank-form-also-fits',
    reason: 'ใบเปล่า (ทุกช่องเป็นเส้นประ) ต้องจบ 1 หน้าด้วย — เจ้าหน้าที่พิมพ์ไว้แจกหน้าเคาน์เตอร์',
    async run(browser) {
      // ค่าว่างทั้งใบทำให้ทุกช่องกลายเป็นกล่องเส้นประความกว้างคงที่ ซึ่งกว้างกว่าข้อความจริง
      // ในหลายช่อง — เป็นคนละเคสกับ "ข้อความยาวสุด" ต้องตรวจแยก
      const page = await render(browser, BLANK_FORM)
      try {
        const mm = await contentHeightMm(page)
        assert.ok(mm <= MAX_CONTENT_MM, `ใบเปล่าสูง ${mm.toFixed(1)}mm เกิน ${MAX_CONTENT_MM}mm`)
        await page.emulateMedia({ media: 'print' })
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 2, 'ใบเปล่าต้องได้หน้าคำร้อง 1 + บัญชีแนบท้ายเปล่า 1')
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'filled-fields-have-no-dotted-lines',
    reason: 'ช่องที่มีข้อความแล้วต้องไม่เหลือเส้นประค้างใต้ข้อความ (ผู้ใช้ระบบสั่งแก้ 2569-09-09) ส่วนใบเปล่าต้องยังมีครบ',
    async run(browser) {
      const filled = await render(browser, longForm())
      try {
        // นับเฉพาะกล่องในตัวใบ ไม่รวมบล็อกเจ้าหน้าที่ซึ่งเว้นเส้นประไว้ให้เขียนมือเสมอ
        const counts = await filled.evaluate(() => ({
          dotted: document.querySelectorAll('.sheet--request > .fill-lines').length,
          written: document.querySelectorAll('.sheet--request > .written').length,
        }))
        assert.equal(counts.dotted, 0, 'ช่องปัญหา/ความต้องการที่กรอกมาแล้วต้องไม่มีกล่องเส้นประเหลือ')
        assert.equal(counts.written, 2, 'ต้องพิมพ์ข้อความทั้งช่องปัญหาและช่องความต้องการ')
      } finally {
        await filled.close()
      }
      const blank = await render(browser, BLANK_FORM)
      try {
        const lines = await blank.evaluate(() =>
          [...document.querySelectorAll('.sheet--request > .fill-lines')]
            .map(box => box.querySelectorAll('.dot-line').length))
        assert.deepEqual(lines, [15, 6], 'ใบเปล่าต้องมีเส้นประให้เขียนมือครบตามที่ไล่ความสูงไว้')
      } finally {
        await blank.close()
      }
    },
  },
  {
    name: 'page-tail-sits-at-page-bottom',
    reason: 'ท้ายใบต้องยึดขอบล่างของหน้าเสมอ ไม่ลอยขึ้นกลางหน้าเมื่อผู้ยื่นเขียนสั้น (ที่ว่างต้องอยู่เหนือ ไม่ใช่ใต้)',
    async run(browser) {
      // ตัวยึดขอบล่างเปลี่ยนตามโหมด: ปิดตาราง = บรรทัดกำกับที่มาของใบ / เปิดตาราง = ตาราง
      // แล้วบรรทัดกำกับต่อท้าย ทั้งสองโหมดจึงวัดที่ "ลูกคนสุดท้ายของหน้า" เหมือนกัน
      for (const includeOfficerBlock of [false, true]) {
        const page = await render(browser, longForm({ problem: 'น้ำท่วมบ้าน', need: 'ขอถุงยังชีพ' }),
          { includeOfficerBlock })
        try {
          // .sheet ในโหมดจอมี padding ล่าง 9 มม. ตรงกับขอบกระดาษ ท้ายใบจึงต้องจบที่ขอบในพอดี
          const bottomGapMm = await page.evaluate(() => {
            const sheet = document.querySelector('.sheet--request')
            const inner = sheet.getBoundingClientRect().bottom
              - parseFloat(getComputedStyle(sheet).paddingBottom)
            return (inner - sheet.lastElementChild.getBoundingClientRect().bottom) / 96 * 25.4
          })
          assert.ok(bottomGapMm < 2,
            `ท้ายใบลอยเหนือขอบล่าง ${bottomGapMm.toFixed(1)} มม. (ตาราง${includeOfficerBlock ? 'เปิด' : 'ปิด'})`
            + ' — ตรวจ margin-top: auto ของ .signed-note กับ .officer')
        } finally {
          await page.close()
        }
      }
    },
  },
  {
    name: 'blank-field-labels-stay-with-their-box',
    reason: 'ใบเปล่า: ป้ายชื่อช่องกับกล่องเส้นประต้องอยู่บรรทัดเดียวกัน ไม่ใช่เส้นประลอยต้นบรรทัดถัดไป',
    async run(browser) {
      const page = await render(browser, BLANK_FORM)
      try {
        // ⚠️ ห้ามนับบรรทัดจากค่า top ที่ไม่ซ้ำกัน — กลุ่มนี้มี inline-block (กล่องเส้นประ
        // line-height 1.05) ปนกับข้อความธรรมดา (1.25) สอง rect จึงมี top ต่างกันเสมอ
        // แม้อยู่บรรทัดเดียวกัน ต้องวัดจากความสูงรวมเทียบกับ line-height แทน
        const broken = await page.evaluate(() => [...document.querySelectorAll('.field-blank')]
          .map(el => {
            const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
            return {
              text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 30),
              height: Math.round(el.getBoundingClientRect().height),
              limit: Math.round(lineHeight * 1.6),
            }
          })
          .filter(item => item.height > item.limit))
        assert.deepEqual(broken, [],
          `ป้ายชื่อช่องหลุดจากกล่องเส้นประ: ${broken.map(b => `${b.text} (สูง ${b.height}px > ${b.limit}px)`).join(' | ')}`)

        // 7 ช่อง = ข้าพเจ้า/บ้านเลขที่/หมู่ที่/ตำบล/อำเภอ/จังหวัด/จำนวนผู้เดือดร้อน
        // เดิม 10+ เพราะนับช่องวันที่ในตารางท้ายใบด้วย ซึ่งถูกถอดออกชั่วคราวแล้ว
        const count = await page.locator('.field-blank').count()
        assert.ok(count >= 7, `ใบเปล่าควรมีช่องกรอกอย่างน้อย 7 ช่อง แต่พบ ${count}`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'nothing-overflows-print-width',
    reason: 'ไม่มีอะไรล้นขอบขวาของพื้นที่พิมพ์ 16 ซม. (เคสจริง: ช่องลงนาม "ผู้ขอความช่วยเหลือ" เคยล้น 12.5px)',
    async run(browser) {
      const page = await render(browser, longForm(), { departments: DEPARTMENTS, signatories: SIGNATORIES })
      try {
        const overflow = await page.evaluate(() => {
          const results = []
          for (const sheet of document.querySelectorAll('.sheet')) {
            const box = sheet.getBoundingClientRect()
            const style = getComputedStyle(sheet)
            const right = box.right - parseFloat(style.paddingRight)
            for (const el of sheet.querySelectorAll('*')) {
              const rect = el.getBoundingClientRect()
              if (rect.width > 0 && rect.right > right + 1) {
                results.push(`${el.className || el.tagName} +${(rect.right - right).toFixed(1)}px`)
              }
            }
          }
          return [...new Set(results)]
        })
        assert.deepEqual(overflow, [], `ล้นขอบขวา: ${overflow.join(' | ')}`)
      } finally {
        await page.close()
      }
    },
  },
  {
    // ช่องลงนามของใบนี้มี 2 ชุด: ผู้ยื่นท้ายคำร้อง และช่องเจ้าหน้าที่ 3 ช่องในตารางท้ายใบ
    // ทั้งสองชุดใช้ของกลาง govSignBlock.js แล้ว จึงตรวจด้วยตัวตรวจกลางชุดเดียวกับใบอื่น
    name: 'signature-block-standard',
    reason: 'ช่องลงนามทุกจุดต้องได้มาตรฐานกลาง — บรรทัดใต้เส้นกึ่งกลางบนแกนของเส้น และวงเล็บกว้างเท่าเส้น',
    async run(browser) {
      // ใบเปล่า: ทุกช่องเป็นวงเล็บเว้นชื่อ จึงตรวจความกว้างช่องเขียนได้ครบทุกจุด
      const blank = await render(browser, BLANK_FORM, { departments: DEPARTMENTS, includeOfficerBlock: true })
      try {
        await assertSignBlockStandard(blank, { minRows: 4, minBelow: 4 })
      } finally { await blank.close() }

      // ใบที่มีชื่อยาวสุด: เคสที่แกนกลางเลื่อนง่ายที่สุด เพราะชื่อกว้างกว่าเส้น
      const filled = await render(browser, longForm(), { departments: DEPARTMENTS, signatories: SIGNATORIES, includeOfficerBlock: true })
      try {
        await assertSignBlockStandard(filled, { minRows: 4, minBelow: 4 })
      } finally { await filled.close() }
    },
  },
  {
    name: 'officer-block-not-split',
    reason: 'บล็อกเจ้าหน้าที่ (ผู้รับเรื่อง/ความเห็นปลัด/คำอนุมัติ) ต้องอยู่ครบในแผ่นเดียว ไม่ถูกตัดครึ่ง',
    async run(browser) {
      const page = await render(browser, longForm(),
        { departments: DEPARTMENTS, signatories: SIGNATORIES, includeOfficerBlock: true })
      try {
        const bottomMm = await page.evaluate(() => {
          const sheet = document.querySelector('.sheet')
          const top = sheet.getBoundingClientRect().top + parseFloat(getComputedStyle(sheet).paddingTop)
          const officer = document.querySelector('.officer')
          return (officer.getBoundingClientRect().bottom - top) / 3.779527
        })
        assert.ok(bottomMm <= 276,
          `บล็อกเจ้าหน้าที่จบที่ ${bottomMm.toFixed(1)}mm เกินพื้นที่พิมพ์ 276mm จึงถูกตัดข้ามหน้า`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'roster-fits-and-repeats-per-page',
    reason: `บัญชีแนบท้ายต้องได้ ${ATTACHMENT_ROWS_PER_PAGE} แถว/หน้า สูงไม่เกินกระดาษ และหัวตารางซ้ำทุกหน้า`,
    async run(browser) {
      // 40 รายชื่อ = 2 หน้าแนบท้าย (33 + 7) รวมทั้งใบ 3 แผ่น
      const page = await render(browser, longForm({ affected: people(40) }), { departments: DEPARTMENTS })
      try {
        const rosters = await page.evaluate(() => [...document.querySelectorAll('.sheet--attachment')]
          .map(sheet => {
            const style = getComputedStyle(sheet)
            const table = sheet.querySelector('.roster')
            const rect = table.getBoundingClientRect()
            return {
              rows: sheet.querySelectorAll('tbody tr').length,
              heads: sheet.querySelectorAll('thead tr').length,
              heightMm: +(rect.height / 3.779527).toFixed(1),
              widthMm: +(rect.width / 3.779527).toFixed(1),
              padded: +((sheet.getBoundingClientRect().width
                - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / 3.779527).toFixed(1),
            }
          }))
        assert.equal(rosters.length, 2, `40 รายชื่อต้องได้บัญชีแนบท้าย 2 หน้า แต่ได้ ${rosters.length}`)
        for (const [index, roster] of rosters.entries()) {
          assert.equal(roster.rows, ATTACHMENT_ROWS_PER_PAGE,
            `หน้าแนบท้ายที่ ${index + 1} มี ${roster.rows} แถว ต้องเป็น ${ATTACHMENT_ROWS_PER_PAGE}`)
          assert.equal(roster.heads, 1, `หน้าแนบท้ายที่ ${index + 1} ต้องมีหัวตารางของตัวเอง`)
          assert.ok(roster.heightMm <= 276,
            `ตารางหน้าที่ ${index + 1} สูง ${roster.heightMm}mm เกินพื้นที่พิมพ์ 276mm`)
          assert.ok(roster.widthMm <= roster.padded + 0.5,
            `ตารางหน้าที่ ${index + 1} กว้าง ${roster.widthMm}mm เกินพื้นที่พิมพ์ ${roster.padded}mm`)
        }

        await page.emulateMedia({ media: 'print' })
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 3, '40 รายชื่อต้องได้ 3 แผ่น: คำร้อง 1 + แนบท้าย 2')
      } finally {
        await page.close()
      }
    },
  },
]

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const results = []
  try {
    for (const check of checks) {
      try {
        await check.run(browser)
        results.push(`PASS ${check.name}: ${check.reason}`)
      } catch (error) {
        results.push(`FAIL ${check.name}: ${error?.message ?? error}`)
      }
    }
  } finally {
    await browser.close()
  }
  const failed = results.filter(line => line.startsWith('FAIL')).length
  process.stdout.write(`แบบคำร้องขอรับการช่วยเหลือประชาชน — ตรวจเอกสารที่พิมพ์\n${results.join('\n')}\n`)
  process.stdout.write(`SUMMARY PASS=${results.length - failed} FAIL=${failed}\n`)
  if (failed) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exitCode = 1
})
