// แบบคำขออนุญาตใช้น้ำประปา — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วยเบราว์เซอร์
//
// คู่กับ water-supply-print.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่ต้องเปิดเบราว์เซอร์ (เร็วกว่ามาก)
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริง: จบใน 1 หน้าไหม ล้นขอบกระดาษไหม
//
// ทำไมต้องมี: ใบนี้หนักกว่าใบเก็บขนขยะทั้งสองใบ — มีบล็อก "สิ่งที่ส่งมาด้วย" 3 บรรทัด
// บล็อก "เขียนที่ + ที่อยู่สำนักงาน" อีก 3 บรรทัด และย่อหน้าหลักที่มีที่อยู่เต็ม 2 ชุด
// (ที่อยู่ผู้ยื่น + สถานที่ติดตั้งมาตร) บวกย่อหน้าพิกัดกับบรรทัดกำกับการลงชื่ออิเล็กทรอนิกส์
// ชื่อไทยยาวๆ จึงดันใบตกหน้า 2 ได้จริง และ "เอกสารราชการ 1 ใบ = 1 แผ่น" เป็นสิ่งที่เจ้าหน้าที่คาดหวัง
//
// เทสนี้ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล — เรนเดอร์ HTML ตรงๆ แล้ววัดจาก DOM/PDF จริง
// รันด้วย: npm run test:water-supply (รันคู่กับไฟล์ตรวจเนื้อหา)

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildWaterSupplyRequestHtml } from '../src/lib/waterSupplyRequestPrint.js'

const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
  org_type: 'อบต.',
  address: '100 หมู่ที่ 1 ตำบลทุ่งแค้ว\nอำเภอหนองม่วงไข่ จังหวัดแพร่',
}

// ค่ายาวที่สุดที่คาดว่าจะเจอจริง — ชื่อไทยเต็มยศแบบที่เคยทำให้วงเล็บช่องลงนามตกคนละบรรทัด
// มาแล้วในใบขอรับบริการเก็บขนขยะ (ดูคอมเมนต์ .signature ใน wasteCollectionRequestPrint.js)
const LONG_NAME = { title: 'นางสาว', first: 'ประกายมาศ', last: 'ศรีวิชัยเลิศสกุล' }

function longForm(overrides = {}) {
  return {
    form_type: 'water_supply_request',
    form_version: 1,
    applicant: {
      ...LONG_NAME, age: 68, phone: '081-234-5678', id_card: '1234567890123',
      addr_no: '199/25', addr_moo: '12',
      addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
    },
    // เคสหนักสุด: ขอมิเตอร์ให้คนละที่กับที่อยู่ตัวเอง จึงมีที่อยู่เต็ม 2 ชุดในย่อหน้าเดียว
    same_as_applicant: false,
    site: {
      addr_no: '288/17', addr_moo: '11',
      addr_subdistrict: 'ทุ่งแค้ว', addr_district: 'หนองม่วงไข่', addr_province: 'แพร่',
    },
    service_start_date: '2026-10-01',
    // ปักหมุดด้วย — ย่อหน้าพิกัดเป็นส่วนที่เพิ่มจากต้นฉบับ ต้องอยู่ในงบความสูงของเคสหนักสุดเหมือนกัน
    // ชื่อสถานที่จาก Nominatim ยาวได้ถึง 95 ตัวอักษรและพิมพ์ลงใบเต็มๆ (ไม่ตัดแล้วตั้งแต่ 2569-09-08)
    // จึงกินราว 2 บรรทัด — เคสนี้คือเคสที่ต้องยืนยันว่าใบยังจบ 1 หน้า
    meter_point: {
      lat: 18.2456789,
      lng: 100.1234567,
      address: 'ถนนยันตรกิจโกศล, ตำบลทุ่งแค้ว, อำเภอหนองม่วงไข่, จังหวัดแพร่, ภาคเหนือ, 54170, ประเทศไทย',
    },
    meter_ack: true,
    signed_at: '2026-09-07T10:32:00',
    signed_by: { channel: 'online', name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล' },
    ...overrides,
  }
}

async function render(browser, form, tenant = TENANT) {
  const page = await browser.newPage()
  const html = buildWaterSupplyRequestHtml({
    form,
    tenant,
    docDate: '2026-09-07T10:32:00',
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

// ความสูงเนื้อหาจริงวัดจากขอบบนของ .sheet ถึงขอบล่างขององค์ประกอบสุดท้ายที่มีอยู่จริง
// — .sheet เองมี min-height 297mm ในโหมดจอ วัดจากมันจะได้ค่าคงที่เสมอ ใช้หาการล้นไม่ได้
function contentHeightMm(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.sheet')
    const last = sheet.lastElementChild
    return (last.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top) / 3.779527
  })
}

const checks = [
  {
    name: 'fits-one-page',
    reason: 'แบบคำขอ 1 ใบต้องพิมพ์จบใน 1 แผ่น แม้ชื่อยาวสุดและมีที่อยู่ 2 ชุด + พิกัด',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        // preferCSSPageSize ให้ใช้ @page ของเอกสารเอง (A4 แนวตั้ง ขอบ 1.2/2/0.9/3 ซม.)
        // ถ้าไม่ใส่ Playwright จะใช้ margin ของตัวเองแล้ววัดพื้นที่ผิดจากตอนพิมพ์จริง
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 1,
          'ใบล้นไปหน้าที่ 2 — ทบทวนระยะ .title/.write-at/.enclosure หรือความยาวย่อหน้าหลัก')

        const mm = await contentHeightMm(page)
        // พื้นที่พิมพ์แนวตั้ง 276mm (297 - 12 - 9) เผื่อขอบไว้กันฟอนต์ต่างเครื่อง —
        // เครื่อง อปท. ส่วนใหญ่ไม่มี THSarabunPSK แล้วตกไปใช้ Sarabun ที่ metric ไม่เท่ากันเป๊ะ
        assert.ok(mm <= 262,
          `เนื้อหาสูง ${mm.toFixed(1)}mm เหลือขอบน้อยเกินไป (พื้นที่พิมพ์ 276mm) เสี่ยงตกหน้า 2 บนเครื่องอื่น`)
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
      }))
      try {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 1, 'ใบโหมดเคาน์เตอร์ล้นไปหน้าที่ 2')
        const mm = await contentHeightMm(page)
        assert.ok(mm <= 262, `เนื้อหาสูง ${mm.toFixed(1)}mm เหลือขอบน้อยเกินไป (พื้นที่พิมพ์ 276mm)`)
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
      const page = await render(browser, {
        form_type: 'water_supply_request',
        form_version: 1,
        applicant: {},
        same_as_applicant: false,
        site: {},
      })
      try {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 1, 'ใบเปล่าล้นไปหน้าที่ 2')
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'blank-field-labels-stay-with-their-box',
    reason: 'ใบเปล่า: ป้ายชื่อช่องกับกล่องเส้นประต้องอยู่บรรทัดเดียวกัน — เคสจริง "…อายุ" จบบรรทัดแล้วเส้นประไปลอยต้นบรรทัดถัดไป',
    async run(browser) {
      const page = await render(browser, {
        form_type: 'water_supply_request',
        form_version: 1,
        applicant: {},
        same_as_applicant: false,
        site: {},
      })
      try {
        // ⚠️ ห้ามนับบรรทัดจาก "จำนวนค่า top ที่ไม่ซ้ำกัน" แบบเทสอื่นในไฟล์นี้ — กลุ่มนี้มี
        // inline-block (กล่องเส้นประ line-height 1.05) ปนกับข้อความธรรมดา (line-height 1.25)
        // สอง rect จึงมี top ต่างกันเสมอแม้อยู่บรรทัดเดียวกัน วิธีนั้นรายงาน "2 บรรทัด" ทุกช่อง
        // (เจอจริงตอนเขียนเทสนี้ครั้งแรก) ต้องวัดจากความสูงรวมเทียบกับ line-height แทน
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

        // กันกรณีตรงข้าม: ถ้าวันหนึ่งเปลี่ยน field() แล้ว .field-blank หายไปหมด เทสข้างบน
        // จะผ่านเพราะไม่มีอะไรให้ตรวจ ต้องยืนยันว่ายังมีช่องว่างจริงในใบเปล่า
        const count = await page.locator('.field-blank').count()
        assert.ok(count >= 12, `ใบเปล่าควรมีช่องกรอกอย่างน้อย 12 ช่อง แต่พบ ${count}`)
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
    reason: 'ชื่อหน่วยงานแตกบรรทัดได้เฉพาะรอยต่อ "องค์การบริหารส่วนตำบล|ทุ่งแค้ว" — ห้ามตัดกลางคำเป็น "…ทุ่งแค้/ว"',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        // ตรวจที่ "ก้อนย่อย" ไม่ใช่ตัวครอบ — ตัวครอบตั้งใจให้กินสองบรรทัดได้ (ตรงรอยต่อ <wbr>)
        // แต่ละก้อน (คำนำหน้า / ชื่อท้องถิ่น) ต่างหากที่ห้ามขาด
        const lineCounts = await page.evaluate(() => [...document.querySelectorAll('.org-name > span')]
          .map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size
          }))
        assert.ok(lineCounts.length >= 6,
          `ควรมีก้อนชื่อหน่วยงาน 6 ก้อน (3 จุด × คำนำหน้า+ชื่อท้องถิ่น) แต่พบ ${lineCounts.length}`)
        assert.ok(lineCounts.every(n => n <= 1),
          `ชื่อหน่วยงานถูกตัดกลางคำ (จำนวนบรรทัดต่อก้อน: ${lineCounts.join(', ')})`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'body-copy-is-readable-and-has-no-stretched-gaps',
    reason: 'แบ่งข้อมูลผู้ยื่น/รายละเอียดคำขอ/ข้อตกลงเป็น 3 ย่อหน้าที่มีช่องไฟ และกัน text-align: justify ซึ่งทำให้เกิดรูโหว่กลางบรรทัด',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        // วัดความกว้างของช่องว่างจริงในแต่ละบรรทัด โดยเทียบกับความกว้างช่องว่างปกติของฟอนต์
        // เกิน 4 เท่า = รูโหว่ที่มองเห็นชัด (เคสที่ wasteCollectionCancelPrint.js เจอคือ ~45mm)
        const readability = await page.evaluate(() => {
          const paragraphs = [...document.querySelectorAll('.body-copy')]
          const ratios = paragraphs.map(para => {
            const gaps = []
            const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT)
            let node
            while ((node = walker.nextNode())) {
              for (let i = 0; i < node.data.length; i += 1) {
                if (node.data[i] !== ' ') continue
                const range = document.createRange()
                range.setStart(node, i)
                range.setEnd(node, i + 1)
                const rect = range.getBoundingClientRect()
                if (rect.width > 0) gaps.push(rect.width)
              }
            }
            if (gaps.length === 0) return 0
            const normal = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
            return Math.max(...gaps) / normal
          })
          const paragraphGaps = paragraphs.slice(1).map((para, index) =>
            para.getBoundingClientRect().top - paragraphs[index].getBoundingClientRect().bottom)
          return {
            count: paragraphs.length,
            minGapPx: Math.min(...paragraphGaps),
            worstRatio: Math.max(...ratios),
          }
        })
        assert.equal(readability.count, 3,
          `เนื้อหาหลักควรมี 3 ย่อหน้า แต่พบ ${readability.count} ย่อหน้า`)
        assert.ok(readability.minGapPx >= 8,
          `ช่องไฟระหว่างย่อหน้าเหลือเพียง ${readability.minGapPx.toFixed(1)}px — ยังอ่านเป็นก้อนแน่น`)
        assert.ok(readability.worstRatio <= 4,
          `มีช่องว่างถูกยืดกว้าง ${readability.worstRatio.toFixed(1)} เท่าของปกติ — เป็นรูโหว่กลางย่อหน้า`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'signature-block-stays-on-one-line-each',
    reason: 'บรรทัด "ลงชื่อ … ผู้ขออนุญาต" และชื่อในวงเล็บต้องอยู่บรรทัดละหนึ่ง — เคยเจอ "(" กับ ")" ตกคนละบรรทัด',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        // นับ "จำนวนบรรทัด" จากค่า top ที่ไม่ซ้ำกัน ไม่ใช่จำนวน rect —
        // ย่อหน้ามี <span> คั่น Range จึงคืน rect หลายก้อนบนบรรทัดเดียวกัน
        // (วัดจริงได้ 4 rect ทั้งที่อยู่บรรทัดเดียว) ถ้านับ rect ตรงๆ จะรายงานผิดทุกครั้ง
        const lineCounts = await page.evaluate(() => [...document.querySelectorAll('.signature-line, .sign-paren')]
          .map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size
          }))
        assert.ok(lineCounts.length >= 2, 'ไม่พบบรรทัดในช่องลงนาม — โครงช่องลงนามเปลี่ยนไปแล้ว')
        assert.ok(lineCounts.every(n => n <= 1),
          `บรรทัดในช่องลงนามถูกตัดขึ้นบรรทัดใหม่ (จำนวนบรรทัดต่อย่อหน้า: ${lineCounts.join(', ')})`)

        // ⚠️ อยู่บรรทัดเดียวกันยังไม่พอ — ต้องไม่ "พิมพ์ทับกัน" ด้วย เคสจริงที่หลุดมาแล้ว:
        // ชื่อ 62 มม. ในกล่อง width 54 มม. ล้นออกไปทับคำว่า "ผู้ขออนุญาต" จนอ่านไม่ออก
        // แต่เทสนับบรรทัดข้างบนยังผ่าน เพราะมันยังเป็นบรรทัดเดียวจริงๆ
        const overlap = await page.evaluate(() => {
          const name = document.querySelector('.signed-name, .signature .fill-blank')
          const role = document.querySelector('.sign-role')
          if (!name || !role) return null
          // ⚠️ ต้องวัดด้วย Range ไม่ใช่ getBoundingClientRect() ของตัว element —
          // inline-block ที่ตั้ง width ตายตัวคืนขนาด "กล่อง" เสมอ ส่วนข้อความที่ล้นออกนอกกล่อง
          // ไม่ถูกนับ วิธีวัดจากกล่องจึงรายงานว่าไม่ทับทั้งที่ตาเห็นว่าทับ (พิสูจน์แล้ว 2569-09-07)
          const range = document.createRange()
          range.selectNodeContents(name)
          const textRight = Math.max(...[...range.getClientRects()].map(r => r.right))
          return Math.round(textRight - role.getBoundingClientRect().left)
        })
        assert.ok(overlap !== null, 'ไม่พบชื่อผู้ลงนามหรือคำว่า "ผู้ขออนุญาต" — โครงช่องลงนามเปลี่ยนไปแล้ว')
        assert.ok(overlap <= 0,
          `ชื่อผู้ลงนามพิมพ์ทับคำว่า "ผู้ขออนุญาต" อยู่ ${overlap}px`)

        const centers = await page.evaluate(() => {
          const upper = document.querySelector('.signature-line')?.getBoundingClientRect()
          const lower = document.querySelector('.sign-paren')?.getBoundingClientRect()
          return upper && lower
            ? { upper: upper.left + upper.width / 2, lower: lower.left + lower.width / 2 }
            : null
        })
        assert.ok(centers, 'ไม่พบบรรทัดชื่อบนหรือล่างในช่องลงนาม')
        assert.ok(Math.abs(centers.upper - centers.lower) <= 1,
          `ชื่อในวงเล็บไม่อยู่กึ่งกลางใต้ชื่อบรรทัดบน (คลาด ${Math.abs(centers.upper - centers.lower).toFixed(1)}px)`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'long-office-address-wraps-cleanly',
    reason: 'ที่อยู่สำนักงานบรรทัดยาวต้องแบ่งได้ไม่เกิน 2 บรรทัดและไม่ลากบล็อกล้ำเข้ากลางหน้า',
    async run(browser) {
      const page = await render(browser, longForm(), {
        name: 'เทศบาลตำบลสาธิต',
        org_type: 'เทศบาลตำบล',
        address: 'เลขที่ 99 หมู่ที่ 5 ตำบลสาธิต อำเภอเมืองแพร่ จังหวัดแพร่ 54000',
      })
      try {
        const metrics = await page.evaluate(() => {
          const address = document.querySelector('.office-address')
          const range = document.createRange()
          range.selectNodeContents(address)
          const lines = new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size
          return {
            lines,
            width: address.getBoundingClientRect().width,
            maxWidth: 90 * (96 / 25.4),
          }
        })
        assert.equal(metrics.lines, 2,
          `ที่อยู่สำนักงานยาวควรแบ่งเป็น 2 บรรทัด แต่พบ ${metrics.lines} บรรทัด`)
        assert.ok(metrics.width <= metrics.maxWidth + 1,
          `บล็อกที่อยู่สำนักงานกว้างเกิน 90 มม. (${metrics.width.toFixed(1)}px)`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'enclosure-amounts-align',
    reason: '"จำนวน ๑ ฉบับ" ทั้ง 3 บรรทัดต้องเริ่มตรงคอลัมน์เดียวกัน ไม่ใช่เหลื่อมตามความยาวชื่อรายการ',
    async run(browser) {
      const page = await render(browser, longForm())
      try {
        const lefts = await page.evaluate(() => [...document.querySelectorAll('.enclosure-list span')]
          .filter(el => el.textContent.includes('จำนวน'))
          .map(el => Math.round(el.getBoundingClientRect().left)))
        assert.equal(lefts.length, 3, `ควรมีช่อง "จำนวน" 3 บรรทัด แต่พบ ${lefts.length}`)
        assert.equal(new Set(lefts).size, 1,
          `ช่อง "จำนวน" ไม่ตรงคอลัมน์กัน (ตำแหน่งซ้าย: ${lefts.join(', ')})`)

        // ทุกช่องต้องอยู่บรรทัดเดียว — เคสจริงที่เจอจากภาพเรนเดอร์: คอลัมน์กว้าง 24 มม.
        // ทำให้ "จำนวน ๑ ฉบับ" ตัดเป็น "จำนวน ๑ / ฉบับ" ทั้งสามบรรทัด (ตำแหน่งซ้ายยังตรงกัน
        // การเช็ค alignment อย่างเดียวจึงจับไม่ได้ ต้องนับบรรทัดด้วย)
        const wrapped = await page.evaluate(() => [...document.querySelectorAll('.enclosure-list span')]
          .map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            const tops = new Set([...range.getClientRects()].map(r => Math.round(r.top)))
            return { text: el.textContent.trim(), lines: tops.size }
          })
          .filter(item => item.lines > 1))
        assert.deepEqual(wrapped, [],
          `ช่องในบล็อกสิ่งที่ส่งมาด้วยตกบรรทัด: ${wrapped.map(w => `${w.text} (${w.lines})`).join(' | ')}`)
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
  process.stdout.write(`แบบคำขออนุญาตใช้น้ำประปา — ตรวจเอกสารที่พิมพ์\n${results.join('\n')}\n`)
  process.stdout.write(`SUMMARY PASS=${results.length - failed} FAIL=${failed}\n`)
  if (failed) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exitCode = 1
})
