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
