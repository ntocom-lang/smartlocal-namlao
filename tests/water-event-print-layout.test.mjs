// ใบสรุปค่าที่วัดได้ช่วงเหตุการณ์น้ำ-ฝน (เฟส 3 · PR 3.3) — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วย Chrome (A4 แนวตั้ง)
// ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล รันด้วย: node tests/water-event-print-layout.test.mjs
//
// ⚠️ วัดที่ viewport 605×1043px = 160×276mm = พื้นที่พิมพ์แนวตั้งตาม govPageCss() เพราะโหมดพิมพ์ใช้ขอบ @page จริง
// (ใบนี้หลายหน้าได้ จึงไม่ใช้ padding ของ .sheet แบบใบที่ซ่อนหัวท้ายกระดาษ) · จำนวนหน้านับจาก PDF จริงที่ Chrome เรนเดอร์
// (page.pdf + preferCSSPageSize) ไม่ใช่เดาจากความสูง — ตัวแบ่งหน้าจริงเคารพ break-inside/หัวตารางซ้ำ
//
// เกณฑ์ที่ล็อกไว้ (วัดจริง 2569-10-17): เหตุการณ์เล็ก (3 สถานี 1 ข้อความเตือน ไม่มีช่วงขาด) จบ 1 แผ่นพร้อมช่องลงนาม ·
// เหตุการณ์ทั่วไป (5 สถานี 2 ข้อความ) ≤ 2 แผ่น · น้ำเลา (11 สถานี 3 ไม่มีค่า) ≤ 2 แผ่น · เลวร้ายสุด (12 สถานีชื่อยาว ข้อความเตือน 6 ฉบับยาว) ≤ 3 แผ่น
// ช่องลงนามห้ามขาดกลางหน้า · ตารางห้ามล้นขอบขวา
import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { assertSignBlockStandard, assertSignLinesAligned, PX_PER_MM } from './lib/signBlockChecks.mjs'
import { buildWaterEventHtml } from '../src/lib/waterEventPrint.js'
import { ACKNOWLEDGER, PREPARER, PRINTED_AT, TENANT, eventDetail } from './lib/waterEventFixtures.mjs'

const html = (detailOptions = {}, { signers = true } = {}) => buildWaterEventHtml({
  tenant: TENANT, detail: eventDetail(detailOptions), printedAt: PRINTED_AT,
  preparer: signers ? PREPARER : null, acknowledger: signers ? ACKNOWLEDGER : null,
})

const SCENARIOS = {
  light: { options: { stations: 3, dam: false, gaps: false, warnings: 1 }, maxPages: 1 },
  typical: { options: { stations: 5, warnings: 2 }, maxPages: 2 },
  namlao: { options: { stations: 11, blank: 3, warnings: 3 }, maxPages: 2 },
  worst: { options: { stations: 12, warnings: 6, long: true }, maxPages: 3 },
}

async function render(browser, content, { print = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 605, height: 1043 } })
  await page.setContent(content, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  if (print) await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

// จำนวนหน้าจาก PDF จริง (Page ไม่ใช่ Pages)
async function pdfPages(page) {
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

// ข้อความในช่องตารางห้ามล้นออกนอกช่อง (ตารางยังกว้างเท่าเดิมจึงจับที่ระดับตารางไม่ได้ ต้องวัดรายช่อง)
async function assertNoCellOverflow(page) {
  const spilled = await page.evaluate(() => [...document.querySelectorAll('table td, table th')]
    .filter(cell => cell.scrollWidth > cell.clientWidth + 1)
    .map(cell => cell.textContent.trim().slice(0, 30)))
  assert.deepEqual(spilled, [], `ข้อความล้นออกนอกช่องตาราง: ${spilled.slice(0, 5).join(' | ')}`)
}

const checks = [
  ...Object.entries(SCENARIOS).map(([name, { options, maxPages }]) => ({
    name: `pages-${name}`,
    reason: `เหตุการณ์ขนาด "${name}" ต้องไม่เกิน ${maxPages} แผ่น และไม่ล้นขอบขวา`,
    async run(browser) {
      const page = await render(browser, html(options))
      try {
        const pages = await pdfPages(page)
        assert.ok(pages >= 1 && pages <= maxPages, `ใบ ${name} ได้ ${pages} แผ่น (ต้อง ≤ ${maxPages})`)
        const info = await page.evaluate(() => ({
          overflowX: document.documentElement.scrollWidth - innerWidth,
          tableWider: [...document.querySelectorAll('table')].some(t => t.scrollWidth > t.parentElement.clientWidth + 1),
          sheetMm: document.querySelector('.sheet').getBoundingClientRect().width,
        }))
        assert.ok(info.overflowX <= 1, `ใบ ${name} ล้นขอบขวา ${info.overflowX}px`)
        assert.equal(info.tableWider, false, `ตารางใบ ${name} กว้างกว่าพื้นที่พิมพ์`)
        assert.ok(Math.abs(info.sheetMm / PX_PER_MM - 160) < 1, `กรอบใบพิมพ์ต้องกว้าง 160mm = พื้นที่พิมพ์ (ได้ ${(info.sheetMm / PX_PER_MM).toFixed(1)}mm)`)
        await assertNoCellOverflow(page)
        return pages
      } finally { await page.close() }
    },
  })),
  {
    name: 'sign-block-standard',
    reason: 'ช่องลงนาม ผู้จัดทำ/ผู้รับทราบ ต้องได้มาตรฐานกลาง (govSignBlock) แม้ชื่อและตำแหน่ง "รักษาราชการแทน" ยาวสุด หรือยังไม่ได้ตั้งผู้ลงนาม',
    async run(browser) {
      for (const content of [html({ stations: 3, warnings: 1 }), html({ stations: 3, warnings: 1 }, { signers: false })]) {
        const page = await render(browser, content)
        try {
          await assertSignBlockStandard(page, { minRows: 2, minBelow: 6 })
          await assertSignLinesAligned(page, '.report-sign .sign-row')
          const info = await page.evaluate(() => {
            const block = document.querySelector('.report-sign')
            return { breakInside: getComputedStyle(block).breakInside, width: innerWidth }
          })
          assert.equal(info.breakInside, 'avoid', 'ช่องลงนามแยกไปคนละหน้าได้')
          // ตัวอักษรใต้เส้นทุกบรรทัดต้องอยู่ในกระดาษ (ชื่อ/ตำแหน่งยาวล้นขอบซ้าย-ขวาไม่ได้)
          const outside = await page.evaluate(() => [...document.querySelectorAll('.report-sign .sign-below')].map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            const rects = [...range.getClientRects()]
            const left = Math.min(...rects.map(r => r.left))
            const right = Math.max(...rects.map(r => r.right))
            return { text: el.textContent.trim().slice(0, 30), left, right, ok: left >= -0.5 && right <= innerWidth + 0.5 }
          }).filter(item => !item.ok))
          assert.deepEqual(outside, [], `บรรทัดใต้เส้นลงนามล้นขอบกระดาษ: ${JSON.stringify(outside)}`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'table-repeats-header-rows-and-blocks-never-split',
    reason: 'เหตุการณ์ใหญ่ไหลหลายหน้า: หัวตารางซ้ำ แถวห้ามขาดกลาง ข้อความเตือนแต่ละฉบับห้ามขาดกลาง ช่องลงนามห้ามขาดกลาง',
    async run(browser) {
      const page = await render(browser, html(SCENARIOS.worst.options))
      try {
        const info = await page.evaluate(() => ({
          head: getComputedStyle(document.querySelector('table.stations thead')).display,
          rowBreak: getComputedStyle(document.querySelector('table.stations tbody tr')).breakInside,
          warnBreak: getComputedStyle(document.querySelector('.warn')).breakInside,
          signBreak: getComputedStyle(document.querySelector('.report-sign')).breakInside,
          secAfter: getComputedStyle(document.querySelector('.sec')).breakAfter,
          rows: document.querySelectorAll('table.stations tbody tr').length,
          warns: document.querySelectorAll('.warn').length,
        }))
        assert.equal(info.head, 'table-header-group', 'หัวตารางไม่ซ้ำเมื่อขึ้นหน้าใหม่')
        assert.equal(info.rowBreak, 'avoid', 'แถวตารางขาดกลางหน้าได้')
        assert.equal(info.warnBreak, 'avoid', 'ข้อความเตือนฉบับเดียวขาดกลางหน้าได้')
        assert.equal(info.signBreak, 'avoid', 'ช่องลงนามขาดกลางหน้าได้')
        assert.equal(info.secAfter, 'avoid', 'หัวข้อส่วนไปค้างท้ายหน้าโดยไม่มีเนื้อหาตาม')
        assert.equal(info.rows, 12); assert.equal(info.warns, 6)
      } finally { await page.close() }
    },
  },
  {
    name: 'open-event-note-fits',
    reason: 'เหตุการณ์ที่ยังเปิดอยู่มีแถบเตือน "ค่าอาจเปลี่ยน" เพิ่ม — เหตุการณ์เล็กต้องยังจบ 1 แผ่น',
    async run(browser) {
      const page = await render(browser, html({ stations: 3, dam: false, gaps: false, warnings: 1, open: true }))
      try {
        assert.equal(await page.locator('[data-open-note]').count(), 1)
        const pages = await pdfPages(page)
        assert.equal(pages, 1, `เหตุการณ์เล็กที่ยังเปิดอยู่ได้ ${pages} แผ่น`)
      } finally { await page.close() }
    },
  },
  {
    name: 'trend-svg-inside-cell',
    reason: 'กราฟแนวโน้มต้องอยู่ในช่องของมัน ไม่ล้นทับช่องข้างๆ',
    async run(browser) {
      const page = await render(browser, html({ stations: 4, warnings: 0 }))
      try {
        const bad = await page.evaluate(() => [...document.querySelectorAll('td.trend svg')].filter(svg => {
          const cell = svg.closest('td').getBoundingClientRect()
          const box = svg.getBoundingClientRect()
          return box.left < cell.left - 0.5 || box.right > cell.right + 0.5
        }).length)
        assert.equal(bad, 0, `กราฟล้นช่อง ${bad} จุด`)
        assert.ok(await page.locator('td.trend svg').count() >= 3)
      } finally { await page.close() }
    },
  },
  {
    name: 'gov-font',
    reason: 'ใช้ THSarabunPSK 14pt + font-size-adjust 0.45 เหมือนเอกสารทุกใบของระบบ · ตารางลดเหลือ 12pt ตามข้อยกเว้นที่เขียนเหตุผลไว้',
    async run(browser) {
      const page = await render(browser, html({ stations: 3, warnings: 1 }))
      try {
        const style = await page.evaluate(() => {
          const computed = getComputedStyle(document.body)
          const cell = getComputedStyle(document.querySelector('table.stations td'))
          return {
            family: computed.fontFamily, sizePx: parseFloat(computed.fontSize), adjust: computed.fontSizeAdjust,
            cellPx: parseFloat(cell.fontSize), cellAdjust: cell.fontSizeAdjust,
          }
        })
        assert.match(style.family, /THSarabunPSK/)
        assert.ok(style.sizePx > 18.5 && style.sizePx < 19, `ขนาดตัวอักษร ${style.sizePx}px ไม่ใช่ 14pt`)
        assert.equal(style.adjust, '0.45')
        assert.ok(style.cellPx > 15.5 && style.cellPx < 16.5, `ขนาดตัวอักษรในตาราง ${style.cellPx}px ไม่ใช่ 12pt`)
        assert.equal(style.cellAdjust, '0.45', 'ตารางยังต้องมี font-size-adjust')
      } finally { await page.close() }
    },
  },
]

// channel: 'chrome' ใช้ Chrome ที่ลงในเครื่องอยู่แล้ว ไม่ต้อง playwright install เพิ่ม
const browser = await chromium.launch({ channel: 'chrome' })
let failed = 0
try {
  for (const check of checks) {
    try {
      const note = await check.run(browser)
      console.log(`  ✓ ${check.name}${note ? ` (${note} แผ่น)` : ''}`)
    } catch (error) {
      failed += 1
      console.log(`  ✗ ${check.name} — ${check.reason}\n    ${error.message}`)
    }
  }
} finally {
  await browser.close()
}
console.log(failed === 0 ? `\n✅ ผ่านทั้ง ${checks.length} ข้อ` : `\n❌ ไม่ผ่าน ${failed}/${checks.length} ข้อ`)
process.exit(failed === 0 ? 0 : 1)
