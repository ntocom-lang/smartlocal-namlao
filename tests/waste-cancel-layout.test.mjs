// ใบแจ้งขอยกเลิกการเก็บขนขยะมูลฝอย — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วยเบราว์เซอร์
//
// คู่กับ waste-cancel-print.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่ต้องเปิดเบราว์เซอร์ (เร็วกว่ามาก)
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริง: จบใน 1 หน้าไหม ล้นขอบกระดาษไหม
//
// ทำไมต้องมี: ใบนี้มีย่อหน้าหลักที่ยาวกว่าใบขอรับบริการ (มีที่อยู่ 2 ชุด — ผู้ยื่นกับผู้ใช้บริการ)
// บวกบรรทัดกำกับการลงชื่ออิเล็กทรอนิกส์ท้ายช่องลงนาม ชื่อไทยยาวๆ กับเหตุผลแบบพิมพ์เองจึงดัน
// ใบตกหน้า 2 ได้จริง และ "เอกสารราชการ 1 ใบ = 1 แผ่น" เป็นสิ่งที่เจ้าหน้าที่คาดหวัง
//
// เทสนี้ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล — เรนเดอร์ HTML ตรงๆ แล้ววัดจาก DOM/PDF จริง
// รันด้วย: npm run test:waste-cancel (รันคู่กับไฟล์ตรวจเนื้อหา)

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildWasteCollectionCancelHtml } from '../src/lib/wasteCollectionCancelPrint.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', org_type: 'อบต.' }

// ค่ายาวที่สุดที่คาดว่าจะเจอจริง — ชื่อไทยเต็มยศแบบที่เคยทำให้วงเล็บช่องลงนามตกคนละบรรทัด
// มาแล้วในใบขอรับบริการ (ดูคอมเมนต์ .signature ใน wasteCollectionCancelPrint.js)
const LONG_NAME = { title: 'นางสาว', first: 'ประกายมาศ', last: 'ศรีวิชัยเลิศสกุล' }
const LONG_REASON = 'ย้ายไปอยู่กับบุตรที่ต่างจังหวัดถาวรและได้รื้อถอนบ้านพักหลังเดิมออกแล้ว'

function longForm(overrides = {}) {
  return {
    form_type: 'waste_collection_cancel',
    form_version: 1,
    applicant: {
      ...LONG_NAME, age: 68, phone: '081-234-5678', id_card: '1234567890123',
      addr_no: '199/25', addr_moo: '12',
      addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
    },
    // เคสหนักสุด: ยื่นแทนคนอื่น จึงมีที่อยู่เต็ม 2 ชุดในย่อหน้าเดียว
    same_as_applicant: false,
    subscriber: {
      title: 'นาย', first: 'ประสิทธิ์ชัย', last: 'ธนาวัฒน์วรกุล', age: 91,
      addr_no: '288/17', addr_moo: '11',
      addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
    },
    cancel_reason: 'อื่นๆ',
    cancel_reason_other: LONG_REASON,
    cancel_date: '2026-10-01',
    // ปักหมุดด้วย — ย่อหน้าพิกัดเพิ่มเข้ามาทีหลัง ต้องอยู่ในงบความสูงของเคสหนักสุดเหมือนกัน
    // ชื่อสถานที่จาก Nominatim ยาวได้ถึง 95 ตัวอักษรและพิมพ์ลงใบเต็มๆ (ไม่ตัดแล้วตั้งแต่ 2569-09-08)
    // จึงกินราว 2 บรรทัด — เคสนี้คือเคสที่ต้องยืนยันว่าใบยังจบ 1 หน้า
    collection_point: {
      lat: 18.2456789,
      lng: 100.1234567,
      address: 'ถนนยันตรกิจโกศล, ตำบลทุ่งแค้ว, อำเภอหนองม่วงไข่, จังหวัดแพร่, ภาคเหนือ, 54170, ประเทศไทย',
    },
    outstanding_ack: true,
    signed_at: '2026-09-07T10:32:00',
    signed_by: { channel: 'online', name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล' },
    ...overrides,
  }
}

async function render(browser, form) {
  const page = await browser.newPage()
  const html = buildWasteCollectionCancelHtml({
    form,
    tenant: TENANT,
    thDate: '7 กันยายน พ.ศ. 2569',
    referenceNo: 'A1B2C3D4',
    signedAt: form.signed_at,
  })
  await page.setContent(html, { waitUntil: 'load' })
  // ต้องรอฟอนต์โหลดเสร็จก่อนวัด ไม่งั้นวัดความสูงด้วยฟอนต์สำรองแล้วได้ผลผิด
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

// ความสูงเนื้อความจริง วัดจากขอบบนของ .sheet ถึงท้ายช่องลงนามผู้ยื่น
//
// ⚠️ ห้ามวัดถึง .reference — ตั้งแต่ 2569-09-08 บรรทัดนั้นถูก flex ดันไปติดขอบล่างของหน้าเสมอ
// (ดู .stamp-space ในไฟล์ใบพิมพ์) วัดถึงมันจะได้ค่าเท่าความสูงหน้ากระดาษทุกครั้ง ใช้หาการล้นไม่ได้
function contentHeightMm(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.sheet')
    const last = sheet.querySelector('.signature')
    return (last.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top) / 3.779527
  })
}

const checks = [
  {
    name: 'fits-one-page',
    reason: 'ใบคำร้อง 1 ใบต้องพิมพ์จบใน 1 แผ่น แม้ชื่อ/เหตุผล/ที่อยู่ 2 ชุดยาวสุดตามที่คาดว่าจะเจอจริง',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        // preferCSSPageSize ให้ใช้ @page ของเอกสารเอง (A4 แนวตั้ง ขอบ 1.2/2/0.9/3 ซม.)
        // ถ้าไม่ใส่ Playwright จะใช้ margin ของตัวเองแล้ววัดพื้นที่ผิดจากตอนพิมพ์จริง
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 1,
          'ใบล้นไปหน้าที่ 2 — ทบทวนระยะ .signature/.reference หรือความยาวย่อหน้ารับทราบค่าธรรมเนียม')

        const mm = await contentHeightMm(page)
        // พื้นที่พิมพ์แนวตั้ง 276mm (297 - 12 - 9) เนื้อความต้องจบภายใน 205mm เพื่อเหลือที่ให้
        // ตรายาง 55mm กับบรรทัดเลขอ้างอิงท้ายหน้า และเผื่อขอบกันฟอนต์ต่างเครื่อง —
        // เครื่อง อปท. ส่วนใหญ่ไม่มี THSarabunPSK แล้วตกไปใช้ Sarabun ที่ metric ไม่เท่ากันเป๊ะ
        assert.ok(mm <= 205,
          `เนื้อความสูง ${mm.toFixed(1)}mm กินที่ว่างสำหรับตรายาง (ต้องไม่เกิน 205mm จากพื้นที่พิมพ์ 276mm)`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'counter-mode-also-fits',
    reason: 'โหมดเจ้าหน้าที่กรอกแทนเว้นที่เซ็น 18mm แทนชื่อพิมพ์ ต้องยังจบ 1 หน้าเหมือนกัน',
    async run(browser) {
      const page = await render(browser, longForm({
        signed_by: { channel: 'counter', name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล' },
      }))
      try {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 1, 'ใบโหมดเคาน์เตอร์ล้นไปหน้าที่ 2')
        const mm = await contentHeightMm(page)
        assert.ok(mm <= 205, `เนื้อความสูง ${mm.toFixed(1)}mm กินที่ว่างสำหรับตรายาง (ต้องไม่เกิน 205mm)`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'stamp-space-and-footer-position',
    reason: 'ต้องเหลือที่ว่างท้ายใบให้เจ้าหน้าที่ปั๊มตรายางอย่างน้อย 50mm และบรรทัดเลขอ้างอิงต้องอยู่ล่างสุดของหน้า',
    async run(browser) {
      // วัดด้วย viewport เท่าพื้นที่พิมพ์จริง (160 × 276 มม. ที่ 96dpi) เพราะ .sheet ใช้
      // min-height:100% — ถ้า viewport สูงกว่านี้ ที่ว่างที่วัดได้จะมากเกินจริง
      const page = await browser.newPage({ viewport: { width: 605, height: 1043 } })
      try {
        const form = longForm()
        await page.setContent(buildWasteCollectionCancelHtml({
          form, tenant: TENANT, thDate: '7 กันยายน พ.ศ. 2569',
          referenceNo: 'A1B2C3D4', signedAt: form.signed_at,
        }), { waitUntil: 'load' })
        await page.evaluate(() => document.fonts.ready)
        await page.emulateMedia({ media: 'print' })
        await page.waitForTimeout(300)

        const box = await page.evaluate(() => {
          const px2mm = 3.779527
          const sheet = document.querySelector('.sheet')
          const stamp = document.querySelector('.stamp-space')
          const ref = document.querySelector('.reference')
          return {
            stampMm: stamp.getBoundingClientRect().height / px2mm,
            gapBelowRefMm: (sheet.getBoundingClientRect().bottom - ref.getBoundingClientRect().bottom) / px2mm,
          }
        })

        assert.ok(box.stampMm >= 50,
          `ที่ว่างสำหรับตรายางเหลือ ${box.stampMm.toFixed(1)}mm — ต้องไม่ต่ำกว่า 50mm`)
        // เลขอ้างอิงต้องเกาะขอบล่าง ไม่ลอยกลางหน้า (เผื่อ 5mm สำหรับ margin/ปัดเศษ)
        assert.ok(box.gapBelowRefMm <= 5,
          `บรรทัดเลขอ้างอิงลอยห่างขอบล่าง ${box.gapBelowRefMm.toFixed(1)}mm — ควรอยู่ล่างสุดของหน้า`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'nothing-overflows-print-width',
    reason: 'ไม่มีข้อความล้นขอบขวาของพื้นที่พิมพ์ 16 ซม. (เคสจริงที่เคยเจอ: ช่องลงนามล้นขอบ 3px)',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        const overflow = await page.evaluate(() => {
          const sheet = document.querySelector('.sheet')
          const box = sheet.getBoundingClientRect()
          const style = getComputedStyle(sheet)
          const left = box.left + parseFloat(style.paddingLeft)
          const right = box.right - parseFloat(style.paddingRight)
          return [...sheet.querySelectorAll('p, div, section, span')]
            .filter(el => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && (r.left < left - 1 || r.right > right + 1)
            })
            .map(el => `${el.className || el.tagName}: ${(el.textContent || '').trim().slice(0, 40)}`)
            .slice(0, 5)
        })
        assert.deepEqual(overflow, [], `องค์ประกอบล้นขอบพื้นที่พิมพ์: ${overflow.join(' | ')}`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'org-name-never-splits-mid-word',
    reason: 'ชื่อหน่วยงานกลางประโยคต้องไม่ถูกตัดกลางคำ — เคสจริง "…ตำบลทุ่งแค้" ค้างท้ายบรรทัดแล้ว "วตรวจสอบ" ขึ้นบรรทัดใหม่',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        const lineCounts = await page.evaluate(() => [...document.querySelectorAll('.org-name')]
          .map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size
          }))
        assert.ok(lineCounts.length >= 2, 'ไม่พบ .org-name ในใบ — ชื่อหน่วยงานหลุดการครอบ nowrap')
        assert.ok(lineCounts.every(n => n <= 1),
          `ชื่อหน่วยงานถูกตัดข้ามบรรทัด (จำนวนบรรทัดต่อจุด: ${lineCounts.join(', ')})`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'signature-name-stays-on-one-line',
    reason: 'ชื่อในวงเล็บช่องลงนามต้องอยู่บรรทัดเดียว — เคยเจอ "(" กับ ")" ตกคนละบรรทัดจนอ่านไม่รู้เรื่อง',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        // นับ "จำนวนบรรทัด" จากค่า top ที่ไม่ซ้ำกัน ไม่ใช่จำนวน rect —
        // ย่อหน้าชื่อในวงเล็บมี <span> คั่น Range จึงคืน rect หลายก้อนบนบรรทัดเดียวกัน
        // (วัดจริงได้ 4 rect ทั้งที่อยู่บรรทัดเดียว) ถ้านับ rect ตรงๆ จะรายงานผิดทุกครั้ง
        const lineCounts = await page.evaluate(() => [...document.querySelectorAll('.signature p:not(.signed-note)')]
          .map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            const tops = new Set([...range.getClientRects()].map(r => Math.round(r.top)))
            return tops.size
          }))
        assert.ok(lineCounts.every(n => n <= 1),
          `บรรทัดในช่องลงนามถูกตัดขึ้นบรรทัดใหม่ (จำนวนบรรทัดต่อย่อหน้า: ${lineCounts.join(', ')})`)
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
  process.stdout.write(`ใบแจ้งขอยกเลิกเก็บขนขยะ — ตรวจเอกสารที่พิมพ์\n${results.join('\n')}\n`)
  process.stdout.write(`SUMMARY PASS=${results.length - failed} FAIL=${failed}\n`)
  if (failed) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exitCode = 1
})
