// แบบคำร้อง (สภา/ศูนย์รับเรื่องราวร้องทุกข์) — ตรวจเลย์เอาต์ตอนพิมพ์จริงด้วยเบราว์เซอร์
//
// คู่กับ complaint-print-routing.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่เปิดเบราว์เซอร์
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริง: ช่องลงนามได้มาตรฐานกลางไหม ล้นขอบไหม
//
// ทำไมเพิ่งมามี: ใบนี้ไม่เคยมีเทสต์เลย์เอาต์เลย ตอนไล่ใบทั้งระบบมาใช้ช่องลงนามมาตรฐาน
// (govSignBlock.js) จึงเจอว่าของเดิมเป็นข้อความ "ลงชื่อ........." กับวงเล็บชื่อที่จัดกึ่งกลาง
// "ของคอลัมน์" ทั้งคู่ — วงเล็บจึงเยื้องซ้ายของเส้นอยู่ครึ่งหนึ่งของคำว่า "ลงชื่อ"
// อาการเดียวกับที่เจ้าของระบบจับได้จากใบยืมพัสดุที่พิมพ์ออกกระดาษ
//
// รันด้วย: npm run test:council

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildCouncilComplaintHtml } from '../src/lib/councilFormPrint.js'
import { assertSignBlockStandard, assertSignLinesAligned } from './lib/signBlockChecks.mjs'
import { qrLayout } from '../src/lib/qrSvg.js'

const SIGNATORIES = {
  // ชื่อ+ตำแหน่งยาวสุดที่คาดว่าจะเจอจริง — เคสที่แกนกลางเลื่อนง่ายที่สุดเพราะกว้างกว่าเส้น
  department_head: {
    name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล',
    title: 'รักษาราชการแทน ผู้อำนวยการกองช่าง',
    authority_reference: 'คำสั่งที่ 45/2569',
  },
  clerk: { name: 'นางสมหญิง รักษ์ราชการดี', title: 'ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' },
  mayor: { name: 'นายสมศักดิ์ ตั้งใจพัฒนา', title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' },
}

const ARGS = {
  c: {
    id: '00000000-0000-4000-8000-000000000001',
    reporter_name: 'นายสมชาย ใจดีมีสุข',
    category: 'light',
    department: 'กองช่าง',
    detail: 'ไฟฟ้าสาธารณะริมถนนสายบ้านทุ่งแค้ว-บ้านหนองม่วงไข่ ชำรุดดับทั้งสาย',
    village: 'หมู่ที่ 12',
  },
  tenant: {
    name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว',
    org_type: 'อบต.',
    district: 'อำเภอหนองม่วงไข่',
    province: 'จังหวัดแพร่',
  },
  terminology: {
    mayor: 'นายกองค์การบริหารส่วนตำบล',
    clerk: 'ปลัดองค์การบริหารส่วนตำบล',
    council: 'สมาชิกสภาองค์การบริหารส่วนตำบล',
  },
  num: '128/2569',
  thDate: '14 พฤศจิกายน 2569',
  cat: 'ไฟฟ้าสาธารณะ',
  phone: '081-234-5678',
}

// ⚠️ viewport ต้องเท่าความกว้างพื้นที่พิมพ์จริง (160mm = 604.7px ที่ 96dpi) ไม่งั้นข้อความ
// ตัดบรรทัดคนละแบบกับตอนพิมพ์ แล้ววัดได้ตัวเลขสวยเกินจริง (เคสจริงที่พลาดมาแล้ว 2569-09-12)
async function render(browser, html) {
  const page = await browser.newPage({ viewport: { width: 605, height: 1044 } })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(200)
  return page
}

const checks = [
  {
    name: 'signature-block-standard',
    reason: 'ช่องลงนาม 3 จุดต้องได้มาตรฐานกลาง — บรรทัดใต้เส้นกึ่งกลางบนแกนของเส้น และวงเล็บกว้างเท่าเส้น',
    async run(browser) {
      // ทะเบียนผู้ลงนามว่าง = ทุกช่องเป็นวงเล็บเว้นชื่อ ตรวจความกว้างช่องเขียนได้ครบ
      const blank = await render(browser, buildCouncilComplaintHtml({ ...ARGS, signatories: {} }))
      try {
        await assertSignBlockStandard(blank, { minRows: 3, minBelow: 6 })
        await assertSignLinesAligned(blank)
      } finally { await blank.close() }

      // มีชื่อ+ตำแหน่งยาวเต็มยศ และมีบรรทัดอ้างอิงคำสั่งมอบอำนาจเพิ่มอีกบรรทัด
      const named = await render(browser, buildCouncilComplaintHtml({ ...ARGS, signatories: SIGNATORIES }))
      try {
        await assertSignBlockStandard(named, { minRows: 3, minBelow: 7 })
        await assertSignLinesAligned(named)
      } finally { await named.close() }
    },
  },
  {
    name: 'nothing-overflows-print-width',
    reason: 'ไม่มีอะไรล้นขอบขวาของพื้นที่พิมพ์ 16 ซม. — ชื่อตำแหน่งเต็มยศกว้างกว่าคอลัมน์ลงนาม',
    async run(browser) {
      const page = await render(browser, buildCouncilComplaintHtml({ ...ARGS, signatories: SIGNATORIES }))
      try {
        const overflow = await page.evaluate(() => {
          const limit = document.body.getBoundingClientRect().right
          return [...document.querySelectorAll('body *')]
            .map(el => Math.round(el.getBoundingClientRect().right - limit))
            .filter(diff => diff > 1).length
        })
        assert.equal(overflow, 0, `มี ${overflow} กล่องที่ล้นขอบขวาของพื้นที่พิมพ์`)
      } finally { await page.close() }
    },
  },
  {
    name: 'acting-title-splits-after-acting-word',
    reason: 'ตำแหน่งรักษาราชการแทนยาว ตัดหลังคำว่า "รักษาราชการแทน" เป็น 2 บรรทัดตามแบบ และไม่ล้นขอบขวา (เจ้าของระบบสั่ง 2569-10-06)',
    async run(browser) {
      const acting = {
        ...SIGNATORIES,
        department_head: { name: 'นายชัยศักดิ์ ชัยธรรม', title: 'ผู้อำนวยการกองช่าง' },
        clerk: {
          name: 'นายชัยศักดิ์ ชัยธรรม',
          title: 'ผู้อำนวยการกองช่าง รักษาราชการแทน ปลัดเทศบาลตำบลน้ำเลา',
          authority_reference: 'คำสั่งที่ 45/2569',
        },
      }
      const page = await render(browser, buildCouncilComplaintHtml({ ...ARGS, signatories: acting }))
      try {
        const seen = await page.evaluate(() => {
          const limit = document.body.getBoundingClientRect().right
          const clerkCell = document.querySelectorAll('.center-row')[1]
          const lines = [...clerkCell.querySelectorAll('.sign-below')].map(el => el.textContent.trim())
          const right = Math.max(...[...document.querySelectorAll('.sign-below')].map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return Math.max(...[...range.getClientRects()].map(rect => rect.right))
          }))
          return { lines, overflow: right - limit }
        })
        assert.deepEqual(seen.lines.slice(1, 3), ['ผู้อำนวยการกองช่าง รักษาราชการแทน', 'ปลัดเทศบาลตำบลน้ำเลา'])
        assert.ok(seen.lines[3].includes('45/2569'), 'เลขที่คำสั่งต้องอยู่ใต้ตำแหน่ง')
        assert.ok(seen.overflow <= 0.5, `ตำแหน่งล้นขอบขวาของพื้นที่พิมพ์ ${seen.overflow.toFixed(1)}px`)
        await assertSignBlockStandard(page, { minRows: 3, minBelow: 7 })
        await assertSignLinesAligned(page)
      } finally { await page.close() }
    },
  },
  {
    // เจ้าของระบบถาม 2569-10-21: ใบคำร้องไม่มีพิกัด กลัวถูกถามว่า "พิกัดอยู่ไหน" ทั้งที่ระบบเก็บไว้ (91% ของเรื่องใน 120 วัน)
    name: 'coordinates-printed-with-qr',
    reason: 'เรื่องที่ปักหมุดไว้ต้องพิมพ์พิกัด + QR เปิดแผนที่ ขนาดสแกนได้ · เรื่องที่ไม่ได้ปักต้องบอกตรงๆ ว่าไม่ได้ปักหมุด · ใบยังจบ 1 แผ่นและไม่ล้นขอบ',
    async run(browser) {
      const pinned = { ...ARGS.c, latitude: 18.123456, longitude: 100.654321 }
      const page = await render(browser, buildCouncilComplaintHtml({ ...ARGS, c: pinned, signatories: SIGNATORIES }))
      try {
        const seen = await page.evaluate(() => {
          const svg = document.querySelector('.geo-qr svg')
          const box = svg?.getBoundingClientRect()
          const body = document.body.getBoundingClientRect()
          const caption = document.querySelector('.geo-qr p')
          const rect = caption?.getBoundingClientRect()
          return {
            rows: [...document.querySelectorAll('.points div')].map(el => el.textContent.replace(/\s+/g, ' ').trim()),
            path: svg?.querySelector('path')?.getAttribute('d') ?? null,
            sideMm: box ? box.width / 3.779527 : 0,
            heightMm: box ? box.height / 3.779527 : 0,
            right: Math.max(box?.right ?? 0, rect?.right ?? 0) - body.right,
            captionText: caption?.textContent ?? '',
            bodyHeight: body.height,
          }
        })
        assert.ok(seen.rows.includes('พิกัด 18.12346, 100.65432'), `ไม่พบบรรทัดพิกัด (5 ทศนิยม) — ได้ ${JSON.stringify(seen.rows)}`)
        // QR ต้องเข้ารหัสลิงก์แผนที่ของพิกัดนี้จริง (เทียบเมทริกซ์ที่สร้างจากลิงก์ที่คาดไว้ ไม่ใช่แค่ว่ามีรูป)
        const expected = qrLayout('https://maps.google.com/?q=18.123456,100.654321', 1000)
        assert.equal(seen.path, expected.d, 'QR ไม่ได้เข้ารหัสลิงก์แผนที่ของพิกัดที่พิมพ์')
        // ขั้นต่ำที่สแกนจากกระดาษได้สบายคือราว 18mm สำหรับลิงก์ยาวขนาดนี้ (module ≥ 0.4mm)
        assert.ok(seen.sideMm >= 18 && seen.sideMm <= 22, `QR ด้านละ ${seen.sideMm.toFixed(1)}mm ต้อง 18–22mm`)
        assert.ok(Math.abs(seen.sideMm - seen.heightMm) < 0.1, 'QR ต้องเป็นสี่เหลี่ยมจัตุรัส')
        assert.ok(seen.right <= 0.5, `QR/คำอธิบายล้นขอบขวา ${seen.right.toFixed(1)}px`)
        assert.ok(seen.captionText.includes('สแกน QR'), 'ต้องมีคำอธิบายให้ผู้อ่านรู้ว่า QR คืออะไร')
        // ใบต้องจบ 1 แผ่น (พื้นที่พิมพ์ 276mm = 1043px) แม้ชื่อ-ตำแหน่งผู้ลงนามยาวเต็มยศ
        assert.ok(seen.bodyHeight <= 1043, `ใบสูง ${Math.round(seen.bodyHeight)}px เกิน 1 หน้า (1043px) เมื่อมี QR`)
        await assertSignBlockStandard(page, { minRows: 3, minBelow: 7 })
      } finally { await page.close() }
    },
  },
  {
    name: 'coordinates-states-never-lie',
    reason: 'ไม่ได้ปักหมุด = บอกตรงๆ · ไม่มีสิทธิ์เห็นพิกัด (ข้อมูลไม่มีคีย์) = ไม่พิมพ์อะไร ห้ามเขียนว่า "ไม่ได้ปักหมุด" ทั้งที่มีหมุดแต่สิทธิ์ปิดไว้',
    async run(browser) {
      const noPin = ' ไม่ได้ปักหมุด'
      const cases = [
        ['ไม่ได้ปัก (null)', { ...ARGS.c, latitude: null, longitude: null }, { row: true, qr: false, text: noPin }],
        ['หมุด 0,0 (ค่าเสีย)', { ...ARGS.c, latitude: 0, longitude: 0 }, { row: true, qr: false, text: noPin }],
        ['พิกัดนอกช่วงโลก', { ...ARGS.c, latitude: 181, longitude: 400 }, { row: true, qr: false, text: noPin }],
        ['ครึ่งเดียว', { ...ARGS.c, latitude: 18.1, longitude: null }, { row: true, qr: false, text: noPin }],
        ['สิทธิ์ปิด (ไม่มีคีย์ latitude)', { ...ARGS.c }, { row: false, qr: false }],
      ]
      for (const [label, c, expected] of cases) {
        const page = await render(browser, buildCouncilComplaintHtml({ ...ARGS, c, signatories: SIGNATORIES }))
        try {
          const seen = await page.evaluate(() => ({
            rows: [...document.querySelectorAll('.points div')].map(el => el.textContent.replace(/\s+/g, ' ').trim()),
            qr: document.querySelectorAll('.geo-qr svg').length,
          }))
          const row = seen.rows.find(text => text.startsWith('พิกัด'))
          assert.equal(Boolean(row), expected.row, `${label}: บรรทัดพิกัด ${row ? `"${row}"` : 'ไม่มี'}`)
          if (expected.row) assert.ok(row.includes(expected.text.trim()), `${label}: ข้อความ "${row}"`)
          assert.equal(seen.qr > 0, expected.qr, `${label}: QR ${seen.qr}`)
        } finally { await page.close() }
      }
      // ปิดด้วยตัวเลือก includeCoordinates: false (Draft PDF ถ้า DPO สั่งตัด) ต้องไม่เหลือทั้งแถวและ QR แม้มีหมุด
      const off = await render(browser, buildCouncilComplaintHtml({
        ...ARGS, c: { ...ARGS.c, latitude: 18.1, longitude: 100.6 }, signatories: SIGNATORIES, includeCoordinates: false,
      }))
      try {
        const seen = await off.evaluate(() => ({ text: document.body.textContent, qr: document.querySelectorAll('.geo-qr').length }))
        assert.ok(!seen.text.includes('พิกัด') && seen.qr === 0, 'includeCoordinates:false ต้องไม่พิมพ์พิกัด/QR')
      } finally { await off.close() }
    },
  },
]

const browser = await chromium.launch({ channel: 'chrome' })
let failed = 0
console.log('แบบคำร้อง (สภา) — ตรวจเอกสารที่พิมพ์')
for (const check of checks) {
  try {
    await check.run(browser)
    console.log(`PASS ${check.name}: ${check.reason}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${check.name}: ${error.message}`)
  }
}
await browser.close()
console.log(`SUMMARY PASS=${checks.length - failed} FAIL=${failed}`)
if (failed) process.exitCode = 1
