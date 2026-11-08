// ใบพิมพ์แผนการดำเนินงาน (src/lib/localPlanPrint.js) + ตัวอ่านตาราง HTML (src/lib/htmlTableGrid.js: readHtmlTables)
// ส่วน node = เนื้อหา/escape/ช่องเดือน/มาตรฐาน govDocStyle · ส่วน Chrome = เลย์เอาต์ตอนพิมพ์จริง (A4 แนวนอน 257×170 มม.) + DOMParser
// ข้อมูลทั้งหมดเป็นข้อมูลสมมติ (ชื่อกอง/โครงการสมมติ ไม่ใช่แผนของ อปท. ใด) — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
//   node tests/local-plan-print.test.mjs   (npm run test:local-plan:print)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { GOV_PAGE_MARGIN_LANDSCAPE } from '../src/lib/govDocStyle.js'
import { MAX_ROWS } from '../src/lib/tabularImport.js'
import { buildOpPlanPrintHtml, monthCellsHtml, monthHeaderLabels, responsibleOf } from '../src/lib/localPlanPrint.js'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const tenant = { name: 'เทศบาลตำบลสาธิต', district: 'อำเภอเมืองสมมติ', province: 'จังหวัดสมมติ' }
const departments = [
  { id: 'd-clerk', name: 'สำนักปลัด' },
  { id: 'd-eng', name: 'กองช่าง' },
  { id: 'd-edu', name: 'กองการศึกษา ศาสนาและวัฒนธรรม' },
]
const draftPlan = { fiscal_year: 2569, kind: 'main', revision_no: 0, status: 'draft' }
const publishedPlan = { ...draftPlan, status: 'published' }
let seq = 0
const item = (over = {}) => ({
  id: `i${++seq}`, seq_no: seq, sort_order: seq * 10, item_name: `โครงการทดสอบ ${seq}`, amount: 100000, department_id: 'd-eng', source: 'local', external_agency: null,
  month_from: null, month_to: null, ...over,
})

// ── ส่วน node ───────────────────────────────────────────────────────────────

// รวมความกว้างช่อง (นับ colspan) ของแถวข้อมูลแถวเดียว แล้วตัดเฉพาะส่วนช่องเดือนออกมา
const monthCols = html => {
  const cells = [...html.matchAll(/<td class="mc(?: span-cell)?"(?: colspan="(\d+)")?>/g)]
  return cells.reduce((n, m) => n + (m[1] ? Number(m[1]) : 1), 0)
}

test('escape: ชื่อโครงการ/กอง/หน่วยงาน/อปท. ที่มี < > " \' & ไม่หลุดเป็น tag', () => {
  const evil = '<script>alert(1)</script> "x" \'y\' & <img src=x onerror=alert(2)>'
  const html = buildOpPlanPrintHtml({
    tenant: { name: evil, district: '"><b>', province: '</td><i>' },
    opPlan: { ...draftPlan, kind: 'amendment', revision_no: 1 },
    items: [item({ item_name: evil }), item({ source: 'external', external_agency: evil, department_id: null })],
    departments: [{ id: 'd-eng', name: evil }], asOf: '2026-11-08',
  })
  assert.equal(/<script/i.test(html), false, 'มี <script จากข้อมูลหลุดออกมา')
  assert.equal(/<img/i.test(html), false, 'มี <img จากข้อมูลหลุดออกมา')
  assert.equal(/<b>|<i>/.test(html), false, 'ชื่ออำเภอ/จังหวัดหลุดเป็น tag')
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &#039;y&#039; &amp; &lt;img'), 'ต้อง escape ครบทั้ง 5 ตัว')
})

test('(ร่าง) บนปกเฉพาะฉบับร่าง · ฉบับประกาศแล้วไม่มี', () => {
  const draft = buildOpPlanPrintHtml({ tenant, opPlan: draftPlan, items: [], departments, asOf: '2026-11-08' })
  const published = buildOpPlanPrintHtml({ tenant, opPlan: publishedPlan, items: [], departments, asOf: '2026-11-08' })
  assert.ok(draft.includes('(ร่าง)'))
  assert.equal(published.includes('(ร่าง)'), false)
})

test('ปก: ชื่อเรื่อง ปีงบ ชื่อ อปท. + อำเภอ/จังหวัด · ชื่อฉบับเฉพาะที่ไม่ใช่ฉบับหลัก', () => {
  const main = buildOpPlanPrintHtml({ tenant, opPlan: draftPlan, items: [], departments, asOf: '2026-11-08' })
  const cover = main.slice(main.indexOf('class="sheet cover"'), main.indexOf('</section>'))
  assert.ok(cover.includes('<h1>แผนการดำเนินงาน</h1>'))
  assert.ok(cover.includes('ประจำปีงบประมาณ พ.ศ. 2569'))
  assert.ok(cover.includes('เทศบาลตำบลสาธิต อำเภอเมืองสมมติ จังหวัดสมมติ'), 'คำนำหน้า "อำเภอ"/"จังหวัด" ซ้ำไม่ได้')
  assert.equal(cover.includes('ฉบับหลัก'), false)
  const amend = buildOpPlanPrintHtml({ tenant, opPlan: { ...draftPlan, kind: 'amendment', revision_no: 2 }, items: [], departments, asOf: '2026-11-08' })
  assert.ok(amend.includes('แก้ไขครั้งที่ 2'))
  const supp = buildOpPlanPrintHtml({ tenant, opPlan: { ...draftPlan, kind: 'supplement', revision_no: 1 }, items: [], departments, asOf: '2026-11-08' })
  assert.ok(supp.includes('เพิ่มเติมครั้งที่ 1'))
})

test('ช่วงเดือน 3–5 = colspan 3 เดียว และรวมช่องต่อแถว = 12', () => {
  const html = monthCellsHtml({ month_from: 3, month_to: 5 })
  assert.equal(html.match(/colspan="3"/g)?.length, 1)
  assert.equal(html.match(/span-cell/g)?.length, 1, 'ช่วงเดียว = ลูกศรเดียว')
  assert.equal(monthCols(html), 12)
  assert.equal(html.match(/<td class="mc"><\/td>/g).length, 9, 'ว่างก่อน 2 + หลัง 7')
  assert.ok(html.indexOf('colspan="3"') > html.indexOf('<td class="mc"></td><td class="mc"></td><td class="mc span-cell"'), 'ช่องว่างก่อนช่วง 2 ช่อง')
  for (const [a, b] of [[1, 1], [1, 12], [12, 12], [6, 7], [1, 3]]) {
    assert.equal(monthCols(monthCellsHtml({ month_from: a, month_to: b })), 12, `${a}–${b}`)
  }
  assert.ok(monthCellsHtml({ month_from: 1, month_to: 3 }).includes('aria-label="ต.ค.–ธ.ค."'))
})

test('ไม่มีเดือน / ช่วงผิดรูป = 12 ช่องว่าง ไม่เดาช่วงให้', () => {
  for (const it of [{}, { month_from: null, month_to: null }, { month_from: 4, month_to: null }, { month_from: 5, month_to: 2 }, { month_from: 0, month_to: 13 }, { month_from: 'x', month_to: 'y' }]) {
    const html = monthCellsHtml(it)
    assert.equal(monthCols(html), 12, JSON.stringify(it))
    assert.equal(html.includes('span-cell'), false, JSON.stringify(it))
  }
})

test('ปีในหัวเดือน: ต.ค.–ธ.ค. = ปีงบ−1 · ม.ค.–ก.ย. = ปีงบ (2 หลัก)', () => {
  assert.deepEqual(monthHeaderLabels(2569).map(m => m.text),
    ['ต.ค.68', 'พ.ย.68', 'ธ.ค.68', 'ม.ค.69', 'ก.พ.69', 'มี.ค.69', 'เม.ย.69', 'พ.ค.69', 'มิ.ย.69', 'ก.ค.69', 'ส.ค.69', 'ก.ย.69'])
  assert.equal(monthHeaderLabels(2600)[0].text, 'ต.ค.99')
  const html = buildOpPlanPrintHtml({ tenant, opPlan: draftPlan, items: [], departments, asOf: '2026-11-08' })
  assert.equal(html.match(/<th class="mh">/g).length, 12)
  assert.ok(html.includes('<th class="mh">ต.ค.</th>') && html.includes('<th class="mh">ก.ย.</th>'), 'ช่องเดือนเป็นชื่อเดือนเปล่า (ปีอยู่แถวบน)')
  assert.ok(html.includes('<th colspan="3" class="yh">พ.ศ. 2568</th>') && html.includes('<th colspan="9" class="yh">พ.ศ. 2569</th>'), 'แถวปี พ.ศ. คร่อม ต.ค.–ธ.ค. (ปีงบ−1) และ ม.ค.–ก.ย. (ปีงบ)')
  assert.equal(html.match(/<th colspan="3" class="qh">ไตรมาส [1-4]<\/th>/g).length, 4)
})

test('แถวรวม: จำนวนรายการ + ผลรวมงบ (ช่องว่างนับ 0 ปัดสตางค์) · งบว่างพิมพ์ช่องว่าง', () => {
  const html = buildOpPlanPrintHtml({
    tenant, opPlan: draftPlan, departments, asOf: '2026-11-08',
    items: [item({ amount: 1200000 }), item({ amount: 350000.5 }), item({ amount: null }), item({ amount: 0.1 }), item({ amount: 0.2 })],
  })
  assert.ok(html.includes('รวม 5 รายการ'))
  assert.ok(html.includes('<td class="amt">1,550,000.80</td>'), 'ผลรวมควรเป็น 1,550,000.80 (0.1+0.2 ต้องไม่ลอยเป็น .30000000000000004)')
  assert.ok(html.includes('<td class="amt">1,200,000.00</td>') && html.includes('<td class="amt">350,000.50</td>'))
  assert.equal(html.match(/<td class="amt"><\/td>/g)?.length, 1, 'งบ null = ช่องว่าง ไม่ใช่ "—"')
  assert.equal(html.includes('—</td>'), false)
})

test('ไม่มีรายการ = แถว "— ยังไม่มีรายการ —" และไม่มีแถวรวม', () => {
  const html = buildOpPlanPrintHtml({ tenant, opPlan: draftPlan, items: [], departments, asOf: '2026-11-08' })
  assert.ok(html.includes('— ยังไม่มีรายการ —'))
  assert.equal(html.includes('class="total"'), false)
})

test('เรียงด้วย sortItems · ผู้รับผิดชอบ: กองจากทะเบียน / หน่วยงานอื่นใช้ external_agency / ไม่เจอ = ว่าง', () => {
  const html = buildOpPlanPrintHtml({
    tenant, opPlan: draftPlan, departments, asOf: '2026-11-08',
    items: [
      item({ item_name: 'ลำดับสอง', sort_order: 20, department_id: 'd-edu' }),
      item({ item_name: 'ลำดับหนึ่ง', sort_order: 10, department_id: 'd-eng' }),
      item({ item_name: 'ลำดับสาม', sort_order: 30, source: 'external', external_agency: 'สำนักงานสมมติจังหวัด', department_id: 'd-eng' }),
      item({ item_name: 'ลำดับสี่', sort_order: 40, department_id: 'd-ghost' }),
    ],
  })
  const order = ['ลำดับหนึ่ง', 'ลำดับสอง', 'ลำดับสาม', 'ลำดับสี่'].map(n => html.indexOf(n))
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ต้องเรียงตาม sort_order')
  assert.ok(html.includes('<td class="who">กองช่าง</td>') && html.includes('<td class="who">กองการศึกษา ศาสนาและวัฒนธรรม</td>'))
  assert.ok(html.includes('<td class="who">สำนักงานสมมติจังหวัด</td>'))
  assert.ok(html.includes('<td class="who"></td>'), 'กองที่ไม่อยู่ในทะเบียน (อปท. อื่น/ถูกลบ) = ว่าง ไม่ใช่ชื่อกองอื่น')
  assert.equal(responsibleOf({ source: 'local', department_id: 'd-eng' }, departments), 'กองช่าง')
})

test('มาตรฐาน govDocStyle: THSarabunPSK + A4 แนวนอน + ขอบ 3cm 2cm 1cm 2cm + font-size-adjust · ไม่เขียน font-family เอง', () => {
  assert.equal(GOV_PAGE_MARGIN_LANDSCAPE, '3cm 2cm 1cm 2cm')
  const html = buildOpPlanPrintHtml({ tenant, opPlan: draftPlan, items: [item()], departments, asOf: '2026-11-08' })
  assert.ok(html.includes('"THSarabunPSK"'))
  assert.ok(html.includes('@page { size: A4 landscape; margin: 0; }'), 'ซ่อนหัวกระดาษเบราว์เซอร์ (hideBrowserHeader) ขอบย้ายไปแถวเว้นระยะ')
  assert.ok(html.includes('td.space-top { height: 3cm; }') && html.includes('td.space-bottom { height: 1cm; }'), 'ขอบบน 3cm ล่าง 1cm ทุกหน้า')
  assert.ok(html.includes('padding: 0 2cm 0 2cm;'), 'ขอบซ้าย/ขวา 2cm')
  assert.ok(html.includes('font-size-adjust: 0.45;'))
  assert.equal(html.match(/font-family/g).length, 1, 'font-family ต้องมาจาก govDocFontIdentityCss() ที่เดียว')
  assert.equal(html.includes('A4 portrait'), false)
})

test('ท้ายใบ: บรรทัดที่มาแบบ govEServiceOriginText + ข้อมูล ณ วันที่ (พ.ศ.) · ไม่มีช่องลงนาม', () => {
  const html = buildOpPlanPrintHtml({ tenant, opPlan: draftPlan, items: [item()], departments, asOf: '2026-11-08' })
  assert.ok(html.includes('ผ่านระบบ E-Service เทศบาลตำบลสาธิต · ข้อมูล ณ วันที่ 8/11/2569'))
  assert.equal(/sign|ลงชื่อ|ลงนาม/.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), false, 'ใบนี้ไม่มีช่องลงนาม')
  assert.equal(buildOpPlanPrintHtml({ tenant, opPlan: draftPlan, items: [], departments }).includes('ข้อมูล ณ วันที่'), false, 'ไม่ส่ง asOf = ไม่เดาวันที่ให้')
})

// ── ส่วน Chrome ─────────────────────────────────────────────────────────────

const MM = 96 / 25.4
const pdfPageCount = buffer => (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

// ชื่อโครงการยาวสมจริงแบบฉบับร่างแผนการดำเนินงานของเทศบาล (สมมติ) — ยาวตั้งแต่ ~40 ถึง ~190 ตัวอักษร
const NAME_TEMPLATES = [
  n => `โครงการก่อสร้างถนนคอนกรีตเสริมเหล็ก สายบ้านตัวอย่าง หมู่ที่ ${n % 9 + 1} - บ้านสมมติ หมู่ที่ ${n % 7 + 2} ขนาดกว้าง 4.00 เมตร ยาว ${300 + n * 10} เมตร หนา 0.15 เมตร พร้อมวางท่อระบายน้ำ`,
  n => `โครงการอบรมให้ความรู้ด้านการป้องกันและควบคุมโรคไข้เลือดออก ประจำปี ${n}`,
  n => `โครงการส่งเสริมการเรียนรู้ตลอดชีวิตของผู้สูงอายุ ตำบลสาธิต กิจกรรมที่ ${n}`,
  n => `โครงการปรับปรุงซ่อมแซมระบบประปาหมู่บ้าน หมู่ที่ ${n % 9 + 1} พร้อมติดตั้งเครื่องสูบน้ำและถังเก็บน้ำใสแบบสูง ความจุไม่น้อยกว่า 30 ลูกบาศก์เมตร จำนวน 1 แห่ง`,
  n => `ค่าใช้จ่ายในการจัดงานประเพณีและวัฒนธรรมท้องถิ่น ครั้งที่ ${n}`,
  n => `โครงการสนับสนุนค่าใช้จ่ายการบริหารสถานศึกษาของศูนย์พัฒนาเด็กเล็กสังกัดเทศบาล (ค่าอาหารกลางวัน ค่าจัดการเรียนการสอน ค่าหนังสือเรียน ค่าอุปกรณ์การเรียน ค่าเครื่องแบบนักเรียน ค่ากิจกรรมพัฒนาผู้เรียน) ปีที่ ${n}`,
]
const seventy = Array.from({ length: 70 }, (_, i) => item({
  seq_no: i + 1, sort_order: (i + 1) * 10, item_name: NAME_TEMPLATES[i % NAME_TEMPLATES.length](i + 1),
  amount: i === 0 ? 99999999.99 : (i % 5 === 0 ? null : 15000 + i * 7350.25),
  department_id: ['d-clerk', 'd-eng', 'd-edu'][i % 3], month_from: i % 4 === 3 ? null : (i % 12) + 1, month_to: i % 4 === 3 ? null : Math.min(12, (i % 12) + 1 + (i % 5)),
}))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const open = async (items, plan = draftPlan) => {
    const page = await browser.newPage({ viewport: { width: Math.round(297 * MM), height: Math.round(210 * MM) } })
    await page.setContent(buildOpPlanPrintHtml({ tenant, opPlan: plan, items, departments, asOf: '2026-11-08' }), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.emulateMedia({ media: 'print' })
    await page.waitForTimeout(300)
    return page
  }
  const pdfOf = async page => pdfPageCount(await page.pdf({ preferCSSPageSize: true, printBackground: false }))

  // (ก) 70 รายการชื่อยาว → ปก + ตารางข้ามหลายหน้า · หน้า 1 เป็นปก
  const big = await open(seventy)
  try {
    const m = await big.evaluate(() => {
      const mm = 96 / 25.4
      const rows = [...document.querySelectorAll('tr.item')]
      const heights = rows.map(r => r.getBoundingClientRect().height)
      const lineCount = el => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size
      }
      const table = document.querySelector('table.plan')
      const tableRight = table.getBoundingClientRect().right
      const overflowing = [...table.querySelectorAll('td, th')].filter(c => c.scrollWidth > c.clientWidth + 1)
      const spillRight = [...table.querySelectorAll('td, th')].filter(c => c.getBoundingClientRect().right > tableRight + 1)
      // ลูกศรต้องมีความกว้างจริง (เส้นกลางไม่ยุบเป็น 0) ทุกอัน
      const arrows = [...document.querySelectorAll('.span')]
      return {
        rowCount: rows.length,
        minRowH: Math.min(...heights), maxRowH: Math.max(...heights), sumRowH: heights.reduce((a, b) => a + b, 0),
        headH: table.querySelector('thead').getBoundingClientRect().height,
        tableWidthMm: table.getBoundingClientRect().width / mm,
        overflowing: overflowing.map(c => `${c.tagName}.${c.className}:${c.textContent.trim().slice(0, 20)}`),
        spillRight: spillRight.length,
        monthHeadLines: [...document.querySelectorAll('th.mh')].map(lineCount),
        monthHeadFit: [...document.querySelectorAll('th.mh')].every(th => {
          const range = document.createRange()
          range.selectNodeContents(th)
          const r = range.getBoundingClientRect()
          return r.width <= th.clientWidth + 0.5
        }),
        amtLines: Math.max(...[...document.querySelectorAll('td.amt')].map(lineCount)),
        arrowCount: arrows.length,
        arrowMinLineW: Math.min(...arrows.map(a => a.querySelector('.ln').getBoundingClientRect().width)),
        arrowSpanCols: [...document.querySelectorAll('td.span-cell')].every(td => td.querySelector('.span').getBoundingClientRect().width <= td.getBoundingClientRect().width),
        coverTitle: document.querySelector('.cover h1')?.textContent,
        colWidthsMm: [...table.querySelectorAll('col')].map(c => +(c.getBoundingClientRect().width / mm).toFixed(1)),
        fontOk: document.fonts.check('14pt THSarabunPSK'),
        bodyFont: getComputedStyle(document.body).fontFamily,
      }
    })
    console.log('  [วัดจริง] ตาราง', m.tableWidthMm.toFixed(1), 'มม. · คอลัมน์(มม.)', m.colWidthsMm.join('/'), '· THSarabunPSK ติดตั้ง =', m.fontOk)
    assert.equal(m.rowCount, 70)
    assert.equal(m.coverTitle, 'แผนการดำเนินงาน')
    assert.ok(m.tableWidthMm <= 257.5, `ตารางกว้างเกินพื้นที่พิมพ์ 257 มม.: ${m.tableWidthMm.toFixed(1)} มม.`)
    assert.deepEqual(m.overflowing, [], `มีช่องล้นเส้นตาราง (scrollWidth > clientWidth): ${m.overflowing.join(' | ')}`)
    assert.equal(m.spillRight, 0, 'มีช่องยื่นพ้นขอบขวาของตาราง')
    assert.deepEqual([...new Set(m.monthHeadLines)], [1], `หัวเดือนต้องจบบรรทัดเดียวทุกช่อง (บรรทัดที่วัดได้: ${[...new Set(m.monthHeadLines)]})`)
    assert.ok(m.monthHeadFit, 'ตัวอักษรหัวเดือนกว้างกว่าช่อง (ล้น/ชนเส้น)')
    assert.equal(m.amtLines, 1, 'งบประมาณ (รวม 99,999,999.99) ต้องจบบรรทัดเดียว')
    assert.ok(m.arrowCount > 40, `ต้องมีลูกศรช่วงเดือน (พบ ${m.arrowCount})`)
    assert.ok(m.arrowMinLineW > 0.5, 'เส้นกลางลูกศรยุบเป็นศูนย์ — ช่วงเดือน 1 ช่องแล้วหัวลูกศรสองข้างกินที่หมด')
    assert.ok(m.arrowSpanCols, 'ลูกศรกว้างเกินช่องที่คร่อม')

    const pages = await pdfOf(big)
    const usable = 170 * MM - m.headH
    const rowsMax = Math.floor(usable / m.minRowH)
    const minPages = 1 + Math.ceil(70 / rowsMax)
    const maxPages = 1 + Math.ceil(m.sumRowH / (usable - m.maxRowH)) + 1
    console.log(`  [PDF] 70 รายการ = ${pages} หน้า (ขั้นต่ำที่คำนวณได้ ${minPages}, เพดาน ${maxPages}; ความสูงแถว ${(m.minRowH / MM).toFixed(1)}–${(m.maxRowH / MM).toFixed(1)} มม.)`)
    assert.ok(pages >= minPages, `หน้าน้อยกว่าที่คำนวณได้ (${pages} < ${minPages}) — ตารางไม่ไหลข้ามหน้า/แถวหาย`)
    assert.ok(pages <= maxPages, `หน้ามากเกินไป (${pages} > ${maxPages}) — มีที่ว่างเสียกลางหน้า`)
  } finally {
    await big.close()
  }

  // (ก2) ผลรวมสูงสุดที่เป็นไปได้จริงของ อปท. ตำบล (ราว 999 ล้านบาท) ต้องไม่ล้นช่องงบ
  const rich = await open([item({ amount: 999999999.99 })])
  try {
    const overflow = await rich.evaluate(() => [...document.querySelectorAll('td.amt')].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent))
    assert.deepEqual(overflow, [], 'งบ/ผลรวมระดับร้อยล้านล้นช่องงบประมาณ — ขยายคอลัมน์งบหรือลดขนาดช่องนี้')
  } finally {
    await rich.close()
  }

  // (ข) 1 รายการ → ปก 1 หน้า + ตาราง 1 หน้า = 2 หน้า (ปกแยกหน้าจริง)
  for (const [label, items] of [['1 รายการ', [seventy[1]]], ['ไม่มีรายการ', []]]) {
    const page = await open(items)
    try {
      assert.equal(await pdfOf(page), 2, `${label} ต้องได้ 2 หน้า (ปก + ตาราง)`)
    } finally {
      await page.close()
    }
  }
  const published = await open([seventy[1]], publishedPlan)
  try {
    assert.equal(await published.locator('.cover .draft').count(), 0, 'ฉบับประกาศแล้วต้องไม่มี (ร่าง)')
    assert.equal(await pdfOf(published), 2)
  } finally {
    await published.close()
  }

  // (จ) readHtmlTables ใน Chrome จริง (DOMParser) — ฉีดโค้ดไฟล์จริงเข้าหน้า (ตัด import/export ให้เป็นสคริปต์ธรรมดา)
  const source = readFileSync(new URL('../src/lib/htmlTableGrid.js', import.meta.url), 'utf8')
  const script = source.replace(/^import \{ MAX_ROWS \} from '\.\/tabularImport\.js'$/m, `const MAX_ROWS = ${MAX_ROWS}`).replace(/^export /gm, '')
  assert.ok(script.includes(`const MAX_ROWS = ${MAX_ROWS}`) && !/^(import|export) /m.test(script), 'แปลงไฟล์เป็นสคริปต์ธรรมดาไม่สำเร็จ — โครง import/export ของ htmlTableGrid.js เปลี่ยน ต้องแก้เทสต์นี้')
  const host = await browser.newPage()
  try {
    await host.setContent('<!doctype html><meta charset="utf-8"><body></body>')
    await host.addScriptTag({ content: script })
    const read = html => host.evaluate(h => {
      const out = readHtmlTables(h)
      return out && { ...out, rows: out.rows.map(r => r.map(t => t.replace(/\s+/g, ' ').trim())) }
    }, html)

    // แบบที่ Excel วาง: มี <style> ใน head, <col>, td colspan/rowspan, <br>, &nbsp;, ความเห็น StartFragment
    const excel = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"><style>td{mso-number-format:General;} .xl65{color:red}</style></head>
<body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=500 style='border-collapse:collapse'>
<col width=40 style='width:30pt'><col width=200 style='width:150pt'><col width=60><col width=60><col width=60><col width=90>
<tr><td rowspan=2 class=xl65>ที่</td><td rowspan=2>โครงการ/กิจกรรม</td><td colspan=3>ไตรมาส 1</td><td rowspan=2>ผู้รับผิดชอบ</td></tr>
<tr><td>ต.ค.67</td><td>พ.ย.67</td><td>ธ.ค.67</td></tr>
<tr><td>1</td><td>โครงการ ก<br>ต่อบรรทัดสอง</td><td colspan=3 style='text-align:center'>↔</td><td rowspan=2>กองช่าง</td></tr>
<tr><td>2</td><td>โครงการ&nbsp;ข</td><td>&nbsp;</td><td>&nbsp;</td><td>↔</td></tr>
</table><!--EndFragment--></body></html>`
    const x = await read(excel)
    assert.ok(x, 'อ่านตาราง Excel ไม่ได้ (null)')
    assert.deepEqual(x.rows, [
      ['ที่', 'โครงการ/กิจกรรม', 'ไตรมาส 1', 'ไตรมาส 1', 'ไตรมาส 1', 'ผู้รับผิดชอบ'],
      ['ที่', 'โครงการ/กิจกรรม', 'ต.ค.67', 'พ.ย.67', 'ธ.ค.67', 'ผู้รับผิดชอบ'],
      ['1', 'โครงการ ก ต่อบรรทัดสอง', '↔', '↔', '↔', 'กองช่าง'],
      ['2', 'โครงการ ข', '', '', '↔', 'กองช่าง'],
    ], 'ตาราง Excel: merge ไม่ถูกคลี่/คัดค่า, <br> ไม่กลายเป็นช่องว่าง, หรือ <style> ปนเข้าข้อความ')
    assert.deepEqual(x.merged, { rowspan: true, colspan: true })

    // แบบที่ Word วาง: <o:p>, <p class=MsoNormal> หลายย่อหน้าในช่องเดียว, span lang
    const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><body lang=TH>
<!--StartFragment--><table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0>
<tr><td width=40 valign=top><p class=MsoNormal><span lang=TH>ที่</span><o:p></o:p></p></td><td width=300 valign=top><p class=MsoNormal><span lang=TH>โครงการ</span><o:p></o:p></p></td><td valign=top><p class=MsoNormal>งบประมาณ<o:p></o:p></p></td></tr>
<tr><td valign=top><p class=MsoNormal>1<o:p></o:p></p></td><td valign=top><p class=MsoNormal>โครงการอบรม</p><p class=MsoNormal>ส่วนที่สอง<o:p></o:p></p></td><td valign=top><p class=MsoNormal>50,000<o:p>&nbsp;</o:p></p></td></tr>
</table><!--EndFragment--></body></html>`
    const w = await read(word)
    assert.deepEqual(w.rows, [['ที่', 'โครงการ', 'งบประมาณ'], ['1', 'โครงการอบรม ส่วนที่สอง', '50,000']], 'ตาราง Word: <o:p>/<p> ทำให้ข้อความติดกันหรือมีตัวแปลก')
    assert.deepEqual(w.merged, { rowspan: false, colspan: false })

    // ตารางซ้อน (1): ตารางเค้าโครงนอกมี 2 เซลล์ ตารางข้อมูลข้างในมีมากกว่า → เลือกตารางข้อมูล
    const layout = '<table><tr><td>เมนู</td><td><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></td></tr></table>'
    assert.deepEqual((await read(layout)).rows, [['a', 'b'], ['c', 'd']], 'ตารางซ้อน: ต้องเลือกตารางที่มีเซลล์มากสุด (ตารางลูก) ไม่ใช่ตารางห่อนอก')
    // ตารางซ้อน (2): ตารางข้อมูลมีตารางย่อยในเซลล์เดียว → ไม่นับเซลล์ลูกซ้ำ แถว/คอลัมน์ของตารางแม่ไม่เพี้ยน ข้อความลูกอยู่ในเซลล์แม่
    const nested = '<table><tr><td>1</td><td>ก</td><td>x</td></tr><tr><td>2</td><td><table><tr><td>ลูก1</td><td>ลูก2</td></tr></table></td><td>y</td></tr></table>'
    const n = await read(nested)
    assert.equal(n.rows.length, 2, 'ตารางซ้อน: จำนวนแถวต้องเป็นของตารางแม่')
    assert.equal(n.rows[0].length, 3)
    assert.deepEqual(n.rows[1].map(t => t.replace(/\s+/g, '')), ['2', 'ลูก1ลูก2', 'y'])

    assert.equal(await read('<p>ไม่มีตาราง</p>'), null)
    assert.equal(await read('<table></table>'), null, 'ตารางไม่มีเซลล์ = null')
    assert.equal(await read(''), null)

    // ความปลอดภัย: DOMParser inert — สคริปต์/onerror ในข้อมูลที่วางไม่ทำงาน ข้อความล้วนเท่านั้น
    const hostile = await read('<table><tr><td><img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><style>b{}</style>ปกติ</td><td><a href="javascript:window.__pwned=3">ลิงก์</a></td></tr></table>')
    assert.deepEqual(hostile.rows, [['ปกติ', 'ลิงก์']], 'ต้องได้เฉพาะข้อความ ไม่มี script/style ปน')
    await host.waitForTimeout(200)
    assert.equal(await host.evaluate(() => window.__pwned), undefined, 'โค้ดในข้อมูลที่วางถูกรัน — DOMParser ต้อง inert')

    // colspan/rowspan ผิดรูปจาก HTML จริงไม่ทำให้พัง
    const bad = await read('<table><tr><td colspan="abc" rowspan="-3">a</td><td colspan="0">b</td><td colspan="99999">c</td></tr><tr><td>d</td></tr></table>')
    assert.equal(bad.rows.length, 2)
    assert.ok(bad.rows.every(r => r.length === bad.rows[0].length && r.length <= 200))
    assert.deepEqual(bad.rows[0].slice(0, 2), ['a', 'b'])
    assert.equal(bad.rows[1][0], 'd')

    // ไม่มี DOMParser → throw ข้อความไทย
    const noParser = await host.evaluate(() => { try { readHtmlTables('<table></table>', { DOMParserImpl: null }); return '' } catch (e) { return e.message } })
    assert.ok(noParser.includes('DOMParser'), 'ไม่มี DOMParser ต้อง throw ข้อความชัดเจน')
  } finally {
    await host.close()
  }
} finally {
  await browser.close()
}

console.log(`\nlocal-plan-print: ${cases} node cases + browser checks passed`)
