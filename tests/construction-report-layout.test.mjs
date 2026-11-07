// ใบรายงานผลการก่อสร้างประจำสัปดาห์ — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ในเบราว์เซอร์ (Chrome ที่ลงในเครื่อง)
// ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล รันด้วย: node tests/construction-report-layout.test.mjs
//
// ⚠️ วัดที่ viewport 605×1043px = 160×276mm = พื้นที่พิมพ์แนวตั้งตาม govPageCss() เพราะโหมดพิมพ์ใช้ขอบ @page จริง
// (ใบนี้หลายหน้าได้ จึงไม่ใช้ padding ของ .sheet) · จำนวนแผ่นนับจาก PDF จริง (page.pdf + preferCSSPageSize)
// ไม่ใช่เดาจากความสูง · ช่องลงนามวัดด้วยกล่องตัวอักษรจริง (Range) ผ่าน tests/lib/signBlockChecks.mjs ห้ามวัดวิธีใหม่
//
// เกณฑ์: ใบปกติ = 6 แผ่นพอดีตามต้นฉบับ (ทุกส่วนจบในแผ่นเดียว) · ใบหนัก (รายการงาน 20 · ชื่อยาว · บันทึกรายวันยาว) ≤ 10 แผ่น
import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { assertSignBlockStandard, assertSignLinesAligned, PX_PER_MM } from './lib/signBlockChecks.mjs'
import { buildConstructionReportHtml } from '../src/lib/constructionReportPrint.js'
import { fixture } from './lib/constructionReportFixtures.mjs'

const html = options => buildConstructionReportHtml(fixture(options))
const HEAVY = { extraItems: 14, long: true, crewRows: 9, logRows: 12 }
const PAGE_H = 1043

async function render(browser, content) {
  const page = await browser.newPage({ viewport: { width: 605, height: PAGE_H } })
  await page.setContent(content, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

async function pdfPages(page) {
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

const checks = [
  {
    name: 'pages-normal',
    reason: 'ใบปกติต้อง 6 แผ่นพอดีตามต้นฉบับ และแต่ละส่วนสูงไม่เกินพื้นที่พิมพ์ (ไม่ล้นไปแผ่นถัดไป)',
    async run(browser) {
      const page = await render(browser, html())
      try {
        const pages = await pdfPages(page)
        assert.equal(pages, 6, `ใบปกติได้ ${pages} แผ่น (ต้อง 6)`)
        const heights = await page.evaluate(() => [...document.querySelectorAll('section.pg')].map(el => Math.round(el.getBoundingClientRect().height)))
        assert.equal(heights.length, 6)
        heights.forEach((h, i) => assert.ok(h <= PAGE_H, `ส่วนที่ ${i + 1} สูง ${h}px เกินพื้นที่พิมพ์ ${PAGE_H}px`))
        return pages
      } finally { await page.close() }
    },
  },
  {
    name: 'pages-heavy',
    reason: 'ใบหนักไหลหลายแผ่นได้ แต่ต้องไม่เกิน 10 แผ่น ไม่ล้นขอบขวา และตารางไม่กว้างกว่าพื้นที่พิมพ์',
    async run(browser) {
      const page = await render(browser, html(HEAVY))
      try {
        const pages = await pdfPages(page)
        assert.ok(pages >= 6 && pages <= 10, `ใบหนักได้ ${pages} แผ่น (ต้อง 6–10)`)
        return pages
      } finally { await page.close() }
    },
  },
  {
    name: 'no-overflow-x-and-cells',
    reason: 'ทั้งใบปกติ/ใบหนัก/สัปดาห์สั้น 3 วัน ต้องไม่ล้นขอบขวา ตารางต้องไม่กว้างกว่ากรอบ 160mm และข้อความไม่ล้นช่องตาราง',
    async run(browser) {
      for (const [name, options] of [['normal', {}], ['heavy', HEAVY], ['short', { dayCount: 3 }], ['draft', { final: false }]]) {
        const page = await render(browser, html(options))
        try {
          const info = await page.evaluate(() => ({
            overflowX: document.documentElement.scrollWidth - innerWidth,
            tableWider: [...document.querySelectorAll('table')].some(t => t.getBoundingClientRect().width > document.querySelector('.sheet').getBoundingClientRect().width + 1),
            sheetPx: document.querySelector('.sheet').getBoundingClientRect().width,
            spilled: [...document.querySelectorAll('table td, table th')].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim().slice(0, 30)),
          }))
          assert.ok(info.overflowX <= 1, `ใบ ${name} ล้นขอบขวา ${info.overflowX}px`)
          assert.equal(info.tableWider, false, `ตารางใบ ${name} กว้างกว่ากรอบ`)
          assert.ok(Math.abs(info.sheetPx / PX_PER_MM - 160) < 1, `กรอบใบ ${name} ต้องกว้าง 160mm (ได้ ${(info.sheetPx / PX_PER_MM).toFixed(1)}mm)`)
          assert.deepEqual(info.spilled, [], `ใบ ${name} ข้อความล้นช่องตาราง: ${info.spilled.slice(0, 4).join(' | ')}`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'sign-block-standard',
    reason: 'ช่องลงนาม 5 จุด (หัวหน้า + ผู้ควบคุมงาน 3 + ผู้แทนผู้รับจ้าง) ต้องได้มาตรฐานกลาง ทั้งมีชื่อและเว้นว่างให้เขียนมือ',
    async run(browser) {
      for (const content of [html(), html({ withPeople: false }), html({ long: true })]) {
        const page = await render(browser, content)
        try {
          await assertSignBlockStandard(page, { minRows: 5, minBelow: 5 })
          await assertSignLinesAligned(page, '.report-sign .sign-row')
          const info = await page.evaluate(() => ({
            breaks: [...document.querySelectorAll('.report-sign, .sign-right')].map(el => getComputedStyle(el).breakInside),
            outside: [...document.querySelectorAll('.sign-below')].map(el => {
              const range = document.createRange()
              range.selectNodeContents(el)
              const rects = [...range.getClientRects()]
              const left = Math.min(...rects.map(r => r.left))
              const right = Math.max(...rects.map(r => r.right))
              return { text: el.textContent.trim().slice(0, 30), ok: left >= -0.5 && right <= innerWidth + 0.5 }
            }).filter(item => !item.ok),
          }))
          assert.ok(info.breaks.every(b => b === 'avoid'), `ช่องลงนามขาดกลางหน้าได้: ${info.breaks}`)
          assert.deepEqual(info.outside, [], `บรรทัดใต้เส้นลงนามล้นขอบกระดาษ: ${JSON.stringify(info.outside)}`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'sign-blocks-stay-on-their-page',
    reason: 'ช่องลงนามหน้า 1 ต้องอยู่หน้าเดียวกับ "จึงเรียนมาเพื่อโปรดทราบ" และช่องลงนามหน้า 5 อยู่ในส่วนที่ 5 (ไม่ลอยไปหน้ากราฟ)',
    async run(browser) {
      const page = await render(browser, html())
      try {
        const info = await page.evaluate(() => {
          const sections = [...document.querySelectorAll('section.pg')]
          const within = (el, i) => sections[i].contains(el)
          return {
            memoSign: within(document.querySelector('.sign-right'), 0),
            reportSign: [...document.querySelectorAll('.report-sign')].every(el => within(el, 4)),
          }
        })
        assert.equal(info.memoSign, true)
        assert.equal(info.reportSign, true)
      } finally { await page.close() }
    },
  },
  {
    name: 'table-rows-never-split-and-headers-repeat',
    reason: 'ใบหนักไหลหลายหน้า: หัวตารางซ้ำ แถวห้ามขาดกลาง หัวข้อห้ามค้างท้ายหน้า',
    async run(browser) {
      const page = await render(browser, html(HEAVY))
      try {
        const info = await page.evaluate(() => ({
          head: getComputedStyle(document.querySelector('table.grid thead')).display,
          rowBreak: getComputedStyle(document.querySelector('table.grid tbody tr')).breakInside,
          secAfter: getComputedStyle(document.querySelector('.sec')).breakAfter,
          pgBreak: getComputedStyle(document.querySelectorAll('section.pg')[1]).breakBefore,
          barBreak: getComputedStyle(document.querySelector('.bar-row')).breakInside,
        }))
        assert.equal(info.head, 'table-header-group')
        assert.equal(info.rowBreak, 'avoid')
        assert.equal(info.secAfter, 'avoid')
        assert.equal(info.pgBreak, 'page')
        assert.equal(info.barBreak, 'avoid')
      } finally { await page.close() }
    },
  },
  {
    name: 'gov-font',
    reason: 'เนื้อความ 14pt ตารางคุมขนาดเอง 12pt (ข้อยกเว้นขนาดตัวอักษรเท่านั้น) ฟอนต์ THSarabunPSK + font-size-adjust 0.45 ทั้งสองส่วน',
    async run(browser) {
      const page = await render(browser, html())
      try {
        const style = await page.evaluate(() => {
          const body = getComputedStyle(document.body)
          const cell = getComputedStyle(document.querySelector('table.grid td'))
          return {
            family: body.fontFamily, sizePx: parseFloat(body.fontSize), adjust: body.fontSizeAdjust,
            cellPx: parseFloat(cell.fontSize), cellAdjust: cell.fontSizeAdjust, cellFamily: cell.fontFamily,
          }
        })
        assert.match(style.family, /THSarabunPSK/)
        assert.ok(style.sizePx > 18.5 && style.sizePx < 19, `ขนาดตัวอักษร ${style.sizePx}px ไม่ใช่ 14pt`)
        assert.equal(style.adjust, '0.45')
        assert.ok(style.cellPx > 15.5 && style.cellPx < 16.5, `ขนาดตัวอักษรในตาราง ${style.cellPx}px ไม่ใช่ 12pt`)
        assert.equal(style.cellAdjust, '0.45', 'ตารางยังต้องมี font-size-adjust')
        assert.match(style.cellFamily, /THSarabunPSK/)
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
