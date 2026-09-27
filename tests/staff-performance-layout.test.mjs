// รายงานผลการปฏิบัติงานตามคำร้อง (A4 แนวนอน) — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วย Chrome จริง
// ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล รันด้วย: node tests/staff-performance-layout.test.mjs
//
// ⚠️ วัดที่ viewport 1123x794 = 297x210mm พอดี เพราะโหมดพิมพ์ตั้ง .sheet เป็น width:auto
// แล้วให้ขอบกระดาษมาจาก padding (govPagePadding) — viewport แคบกว่านี้ตารางจะตัดบรรทัดมากเกินจริง
//
// ทำไมหน้า 1 ต้องจบในหน้าเดียว: ช่องลงนามรับรองต้องอยู่หน้าเดียวกับตารางสรุปที่รับรอง
// พื้นที่พิมพ์แนวนอนสูงแค่ 170mm จึงล็อกไว้ที่ 7 หมวด (วัดจริง 204.4 จาก 208mm; คนหนึ่งคน
// รับผิดชอบไม่เกินนี้ในทางปฏิบัติ) ถ้าจะให้ได้ 8 หมวดต้องตัดบรรทัดวันที่ใต้ช่องลงนามรับรองออก
// เกินนั้นยอมให้ตารางไหลไปหน้า 2 ได้ แต่หัวตารางต้องซ้ำและช่องลงนามห้ามขาดครึ่ง

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { assertSignBlockStandard, assertSignLinesAligned, PX_PER_MM } from './lib/signBlockChecks.mjs'
import { buildStaffPerformanceHtml } from '../src/lib/staffPerformancePrint.js'
import { normalizePerformanceRows, summarizePerformance } from '../src/lib/staffPerformance.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว' }
// ค่ายาวที่สุดที่คาดว่าจะเจอจริง — ชื่อ-สกุลยาว ตำแหน่งพร้อมระดับ
const PERSON = {
  name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุลวงศ์',
  title: 'เจ้าพนักงานธุรการปฏิบัติงาน',
  departmentName: 'กองช่าง องค์การบริหารส่วนตำบลทุ่งแค้ว',
}
const CERTIFIER = { name: 'นายสมศักดิ์ ตั้งใจพัฒนาชุมชน', title: 'ผู้อำนวยการกองช่าง (นักบริหารงานช่าง ระดับต้น)' }
const CATEGORY_NAMES = [
  'ไฟฟ้าสาธารณะ', 'ถนน/ทางสาธารณะชำรุด', 'ท่อระบายน้ำอุดตัน', 'ต้นไม้กีดขวาง/กิ่งไม้ใกล้สายไฟ',
  'น้ำประปาไม่ไหล/ไหลอ่อน', 'ขยะตกค้าง/ไม่มีรถเก็บ', 'เหตุเดือดร้อนรำคาญ', 'ขอยืมวัสดุอุปกรณ์',
  'ท่อประปาแตกรั่ว', 'สัตว์จรจัด', 'น้ำท่วมขัง', 'ขุดลอกคูคลอง', 'สุขาภิบาลอาหาร', 'ควบคุมโรคติดต่อ', 'อื่นๆ',
]

function rowsFor(categoryCount, perCategory, { longNotes = false } = {}) {
  const rows = []
  let n = 0
  for (let c = 0; c < categoryCount; c++) {
    for (let k = 0; k < perCategory; k++) {
      n++
      const day = String(1 + (n % 27)).padStart(2, '0')
      rows.push({
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        ref_no: `ES-69-${String(n).padStart(4, '0')}`,
        category: `c${c}`,
        issue_type: longNotes ? 'ไฟดับทั้งดวงตั้งแต่หัวซอยถึงท้ายซอย' : 'ไฟดับทั้งดวง',
        village: longNotes ? 'หมู่ที่ 12 บ้านทุ่งแค้วใต้ (ชุมชนหลังวัด)' : 'หมู่ 3',
        channel: n % 5 === 0 ? 'oss_counter' : 'citizen_online',
        status: 'closed',
        is_confidential: false,
        created_at: `2026-08-${day}T02:00:00Z`,
        received_at: `2026-08-${day}T02:05:00Z`,
        first_done_at: null,
        closed_at: `2026-09-${day}T03:00:00Z`,
        finish_recorded: n % 4 !== 0,
        due_date: `2026-09-${String(Math.min(28, 1 + (n % 27) + (n % 3))).padStart(2, '0')}`,
        resolved_by_name: longNotes && n % 2 ? 'นายสมศักดิ์ ตั้งใจพัฒนาชุมชน' : null,
        rating: n % 3 === 0 ? 4 : null,
        reopen_count: longNotes && n % 7 === 0 ? 1 : 0,
      })
    }
  }
  return rows
}

function html(categoryCount, perCategory, options) {
  const summary = summarizePerformance(normalizePerformanceRows(rowsFor(categoryCount, perCategory, options)),
    { from: '2026-04-01', to: '2026-09-30', today: '2026-09-27' })
  const categoryLabels = Object.fromEntries(CATEGORY_NAMES.map((name, i) => [`c${i}`, name]))
  return buildStaffPerformanceHtml({
    tenant: TENANT, person: PERSON, certifier: CERTIFIER, summary, categoryLabels,
    periodLabel: 'รอบการประเมินที่ 2 ปีงบประมาณ พ.ศ. 2569 (1 เมษายน พ.ศ. 2569 – 30 กันยายน พ.ศ. 2569)',
    scopeNote: 'นับเฉพาะคำร้องของกองช่าง (หัวหน้ากองเป็นผู้พิมพ์) ฉบับที่นับครบคือฉบับที่เจ้าตัวพิมพ์เอง',
    printedAt: new Date('2026-09-27T07:05:00Z'),
  })
}

async function render(browser, content) {
  const page = await browser.newPage({ viewport: { width: 1123, height: 794 } })
  await page.setContent(content, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

const PAGE_HEIGHT_MM = 208

// คอลัมน์ตัวเลข/วันที่ห้ามตัดบรรทัด (nowrap) ถ้าคอลัมน์แคบเกิน ข้อความจะล้นทับเส้นตารางช่องข้างๆ
// ตารางยังกว้างเท่าเดิม ตรวจที่ระดับตารางจึงจับไม่ได้ ต้องวัดรายช่อง (เจอจริงตอนออกแบบ: "20 ก.ค. 2569 †")
async function assertNoCellOverflow(page) {
  const spilled = await page.evaluate(() => [...document.querySelectorAll('table td, table th')]
    .filter(cell => cell.scrollWidth > cell.clientWidth + 1)
    .map(cell => cell.textContent.trim().slice(0, 30)))
  assert.deepEqual(spilled, [], `ข้อความล้นออกนอกช่องตาราง: ${spilled.slice(0, 5).join(' | ')}`)
}

const checks = [
  {
    name: 'page-1-fits-with-7-categories',
    reason: 'หน้าสรุป 7 หมวด + หมายเหตุ + ช่องลงนาม ต้องจบในหน้าเดียว ไม่ให้ช่องรับรองหลุดไปคนละหน้ากับตาราง',
    async run(browser) {
      const page = await render(browser, html(7, 3))
      try {
        const info = await page.evaluate(() => ({
          sheetHeight: document.querySelector('.sheet').getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth > innerWidth,
          sheets: document.querySelectorAll('.sheet').length,
        }))
        const heightMm = info.sheetHeight / PX_PER_MM
        assert.ok(heightMm <= PAGE_HEIGHT_MM + 0.5, `หน้า 1 สูง ${heightMm.toFixed(1)}mm เกิน ${PAGE_HEIGHT_MM}mm`)
        assert.equal(info.overflow, false, 'ตารางล้นขอบขวาของกระดาษแนวนอน')
        await assertNoCellOverflow(page)
        assert.equal(info.sheets, 2, 'ต้องมีหน้าสรุป 1 หน้า และหน้าแนบรายการอีก 1 ชุด')
      } finally { await page.close() }
    },
  },
  {
    name: 'sign-block-standard',
    reason: 'ช่องลงนาม ผู้รายงาน/ผู้รับรอง ต้องได้มาตรฐานกลาง (govSignBlock) แม้ชื่อและตำแหน่งยาว',
    async run(browser) {
      for (const content of [html(3, 2), buildStaffPerformanceHtml({
        tenant: TENANT, person: PERSON, certifier: null, periodLabel: 'x',
        summary: summarizePerformance([], { from: '2026-04-01', to: '2026-09-30', today: '2026-09-27' }),
      })]) {
        const page = await render(browser, content)
        try {
          await assertSignBlockStandard(page, { minRows: 2, minBelow: 6 })
          await assertSignLinesAligned(page, '.report-sign .sign-row')
          const breakInside = await page.evaluate(() => getComputedStyle(document.querySelector('.report-sign')).breakInside)
          assert.equal(breakInside, 'avoid', 'ช่องลงนามแยกไปคนละหน้าได้')
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'attachment-80-rows-paginate',
    reason: 'รายการแนบ 80 เรื่องที่มีหมายเหตุยาว: ไม่ล้นขวา หัวตารางซ้ำทุกหน้า แถวไม่ขาดกลาง',
    async run(browser) {
      const page = await render(browser, html(1, 80, { longNotes: true }))
      try {
        const info = await page.evaluate(() => {
          const list = document.querySelector('table.list')
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            tableWider: list.scrollWidth > list.parentElement.clientWidth + 1,
            headerGroup: getComputedStyle(list.querySelector('thead')).display,
            rowBreak: getComputedStyle(list.querySelector('tbody tr')).breakInside,
            rows: list.querySelectorAll('tbody tr').length,
          }
        })
        assert.equal(info.overflow, false, 'หน้าแนบล้นขอบขวา')
        assert.equal(info.tableWider, false, 'ตารางรายการกว้างกว่าพื้นที่พิมพ์')
        await assertNoCellOverflow(page)
        assert.equal(info.headerGroup, 'table-header-group', 'หัวตารางไม่ซ้ำเมื่อขึ้นหน้าใหม่')
        assert.equal(info.rowBreak, 'avoid', 'แถวขาดกลางระหว่างหน้าได้')
        assert.equal(info.rows, 80)
      } finally { await page.close() }
    },
  },
  {
    name: 'many-categories-flow-to-next-page',
    reason: '15 หมวดยาวเกินหน้าเดียวได้ แต่ห้ามล้นขวา หัวตารางสรุปต้องซ้ำ และช่องลงนามห้ามขาดครึ่ง',
    async run(browser) {
      const page = await render(browser, html(15, 2))
      try {
        const info = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          headerGroup: getComputedStyle(document.querySelector('table.summary thead')).display,
          signBreak: getComputedStyle(document.querySelector('.report-sign')).breakInside,
          categoryRows: document.querySelectorAll('table.summary tbody tr').length,
        }))
        assert.equal(info.overflow, false)
        assert.equal(info.headerGroup, 'table-header-group')
        assert.equal(info.signBreak, 'avoid')
        assert.equal(info.categoryRows, 15)
      } finally { await page.close() }
    },
  },
  {
    name: 'gov-font',
    reason: 'ใช้ THSarabunPSK 14pt + font-size-adjust 0.45 เหมือนเอกสารทุกใบของระบบ',
    async run(browser) {
      const page = await render(browser, html(2, 2))
      try {
        const style = await page.evaluate(() => {
          const computed = getComputedStyle(document.body)
          return { family: computed.fontFamily, sizePx: parseFloat(computed.fontSize), adjust: computed.fontSizeAdjust }
        })
        assert.match(style.family, /THSarabunPSK/)
        assert.ok(style.sizePx > 18.5 && style.sizePx < 19, `ขนาดตัวอักษร ${style.sizePx}px ไม่ใช่ 14pt`)
        assert.equal(style.adjust, '0.45')
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
