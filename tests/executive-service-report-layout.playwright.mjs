// Layout test (Chrome จริง): ใบ "สรุปผลการให้บริการประชาชน" ของห้องผู้บริหาร เฟส E3-1
//   - ช่องลงนาม 3 ช่อง (ผู้จัดทำ / ผู้เสนอ / ผู้รับทราบ) ตามมาตรฐาน govSignBlock.js
//     วัดด้วย assertSignBlockStandard / assertSignLinesAligned (Range + getClientRects) เท่านั้น ห้ามเขียนวิธีวัดเอง
//   - ไม่มีอะไรล้นขอบกระดาษ (พื้นที่พิมพ์ 160 มม.) · หมายเหตุ + ช่องลงนาม + บรรทัดที่มาอยู่แผ่นเดียวกัน
//   - ตัวรายงาน (ส่วนที่ 1–5 + หมายเหตุ + ช่องลงนาม) จบใน 2 แผ่น · สูตรคำนวณเป็นภาคผนวกขึ้นแผ่นใหม่หลังช่องลงนาม · รวมไม่เกิน 4 แผ่น
// รัน: node tests/executive-service-report-layout.playwright.mjs [--out <โฟลเดอร์เก็บ PDF/PNG ไว้ดูด้วยตา>]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { buildExecServiceReportHtml } from '../src/lib/executiveServiceReportPrint.js'
import { execReportDefaultPeriod } from '../src/lib/executiveReportPeriods.js'
import { buildExecModel } from '../src/lib/executiveData.js'
import { PX_PER_MM, assertSignBlockStandard, assertSignLinesAligned, measureSignRows } from './lib/signBlockChecks.mjs'

const outIndex = process.argv.indexOf('--out')
const OUT_DIR = outIndex > 0 ? process.argv[outIndex + 1] : null

const TODAY = '2026-11-10'
const NOW = new Date(`${TODAY}T05:00:00Z`)
const MONTH = execReportDefaultPeriod('month', NOW)
const QUARTER = execReportDefaultPeriod('quarter', NOW)

// อปท. ขนาดจริง: 6 กอง + ไม่ระบุกอง (เทศบาลตำบลส่วนใหญ่มี 5–6 กอง) — ใบต้องรับได้โดยไม่ล้น
const DEPARTMENTS = ['สำนักปลัดเทศบาล', 'กองคลัง', 'กองช่าง', 'กองสาธารณสุขและสิ่งแวดล้อม', 'กองการศึกษา ศาสนาและวัฒนธรรม', 'กองสวัสดิการสังคม']

const summaries = () => ({
  complaints: { ok: true, data: {
    period: { total: 128, citizen_online: 96, oss_counter: 30, confidential: 2, adhoc: 4 },
    on_time: { completed: 110, on_time: 92, late: 18, no_due: 0, open_past_due: 7, undated: 0 },
    backlog: [
      { s: 'new', due: '2026-11-02', c: '2026-11-02', u: true, n: 3 },
      { s: 'received', due: '2026-11-05', c: '2026-10-30', u: false, n: 9 },
      { s: 'in_progress', due: '2026-11-20', c: '2026-10-12', u: false, n: 14 },
    ],
  } },
  doc_requests: { ok: true, data: {
    by_type: [{ t: 'tax_notice', total: 240, pending: 12, processing: 8, completed: 214, rejected: 6, avg_days: 2.5 }],
    on_time: { by_type: [{ t: 'tax_notice', completed: 214, on_time: 201, late: 13, no_due: 0, open_past_due: 4, undated: 0 }] },
    backlog: [{ t: 'tax_notice', s: 'pending', due: '2026-11-01', c: '2026-10-25', n: 12 }, { t: 'tax_notice', s: 'processing', due: '2026-11-20', c: '2026-11-05', n: 8 }],
    entered: { citizen: 150, council: 20, staff: 65, unknown: 5 },
  } },
  satisfaction: { ok: true, data: {
    closed: 110, any_rated: 64,
    sources: {
      verified: { complaints: 20, sum: 88, cnt: 20 }, via_link: { complaints: 30, sum: 129, cnt: 30 },
      proxy: { complaints: 12, sum: 58, cnt: 12 }, linked_anon: { complaints: 2, sum: 7, cnt: 2 },
    },
    genuine: { complaints: 50, sum: 217, cnt: 50 }, general: { n: 14, sum: 61 }, low: { proxy: 1 },
    by_dept: DEPARTMENTS.map((_, i) => ({ dept: `d${i}`, closed: 18, genuine_sum: 34 + i, genuine_cnt: 8, all_sum: 40, all_cnt: 10 })),
  } },
  departments: { ok: true, data: {
    departments: [
      ...DEPARTMENTS.map((name, i) => ({ id: `d${i}`, name, short_name: null, complaints: { open: 4 + i, overdue: i % 3, parked: 0, done: 18 }, docs: { open: 3, overdue: i % 2, done: 35 } })),
      { id: null, name: null, complaints: { open: 2, overdue: 1, parked: 0, done: 0 }, docs: { open: 0, overdue: 0, done: 0 } },
    ],
  } },
})

const TENANT = { name: 'เทศบาลตำบลทดสอบเลย์เอาต์', org_type: 'municipality' }
// ชื่อยาว + ตำแหน่ง "รักษาราชการแทน" (กรณีที่กว้างที่สุดที่เจอจริง) — ต้องไม่ดันเส้นหรือหลุดแกน
const LONG_SIGNATORIES = {
  clerk: { name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุล', title: 'รองปลัดเทศบาล รักษาราชการแทน ปลัดเทศบาล' },
  mayor: { name: 'นายสมศักดิ์ วงศ์ประเสริฐสุขสวัสดิ์', title: 'นายกเทศมนตรีตำบลทดสอบเลย์เอาต์' },
}

const CASES = [
  { name: 'month-signed', label: 'รายเดือน · ตั้งผู้ลงนามแล้ว (ชื่อยาว + รักษาราชการแทน)', period: MONTH, model: () => buildExecModel(summaries()), signatories: LONG_SIGNATORIES },
  { name: 'quarter-unset', label: 'รายไตรมาส · ยังไม่ได้ตั้งผู้ลงนาม (เส้นประ + ชื่อตำแหน่งสำรอง)', period: QUARTER, model: () => buildExecModel(summaries()), signatories: null },
  { name: 'month-nodata', label: 'รายเดือน · โหลดข้อมูลไม่ได้ทุกส่วน (ใบสั้นสุด)', period: MONTH, model: () => buildExecModel({}), signatories: null },
]

// พื้นที่พิมพ์แนวตั้ง 160 มม. (ขอบซ้าย 3 ซม. ขวา 2 ซม.) · สูงสุดกี่แผ่นที่ยอมรับ — เกินนี้แปลว่ามีอะไรบานผิดปกติ
const MAX_PAGES = 4
const MAX_BODY_PAGES = 2
const pdfPageCount = (buffer) => (buffer.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length

const browser = await chromium.launch({ channel: 'chrome', headless: true })
let cases = 0
try {
  for (const c of CASES) {
    let summary = ''
    const html = buildExecServiceReportHtml({ model: c.model(), today: TODAY, period: c.period, tenant: TENANT, signatories: c.signatories })
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } })
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.emulateMedia({ media: 'print' })

    // 1) ช่องลงนามมาตรฐาน: 3 ช่อง · บรรทัดใต้เส้นอยู่บนแกนของเส้น · วงเล็บเว้นชื่อกว้างเท่าเส้น · เส้นกว้างเท่ากันทุกจุด
    await assertSignBlockStandard(page, { minRows: 3, minBelow: 5 })
    await assertSignLinesAligned(page, '.exec-sign .sign-row')
    const rows = await measureSignRows(page)
    assert.deepEqual(rows.map((r) => r.role), ['ผู้จัดทำ', 'ผู้เสนอ', 'ผู้รับทราบ'], `${c.label}: ลำดับช่องลงนาม`)
    for (const r of rows) assert.ok(Math.abs(r.lineMm - 40) <= 0.5, `${c.label}: เส้น "${r.role}" ต้องกว้าง 40mm (ได้ ${r.lineMm?.toFixed(1)}mm)`)

    // 2) ไม่มีอะไรล้นพื้นที่พิมพ์ (วัดกล่องตัวอักษรจริงของทุกบรรทัดใต้เส้น + ตารางทุกตัว เทียบขอบในของ .sheet)
    const overflow = await page.evaluate((mm) => {
      const sheet = document.querySelector('.sheet')
      const style = getComputedStyle(sheet)
      const box = sheet.getBoundingClientRect()
      const left = box.left + parseFloat(style.paddingLeft)
      const right = box.right - parseFloat(style.paddingRight)
      const textBox = (el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const rects = [...range.getClientRects()]
        return rects.length ? { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) } : null
      }
      const bad = []
      for (const el of document.querySelectorAll('.sign-below, .sign-role, table.t, .title, .sub, .origin, .formulas li, .notes li')) {
        const b = el.matches('table.t') ? el.getBoundingClientRect() : textBox(el)
        if (b && (b.left < left - 1 || b.right > right + 1)) bad.push(`${el.className || el.tagName}: ${((b.left - left) / mm).toFixed(1)}..${((b.right - right) / mm).toFixed(1)}mm "${el.textContent.trim().slice(0, 24)}"`)
      }
      return { bad, printableMm: (right - left) / mm }
    }, PX_PER_MM)
    assert.ok(Math.abs(overflow.printableMm - 160) <= 0.5, `${c.label}: พื้นที่พิมพ์ต้องกว้าง 160mm (ได้ ${overflow.printableMm.toFixed(1)}mm)`)
    assert.deepEqual(overflow.bad, [], `${c.label}: มีเนื้อหาล้นพื้นที่พิมพ์`)

    // 3) ตัวอักษรของช่องผู้จัดทำกับผู้เสนอ (แถวแรก ซ้าย/ขวา) ไม่ทับกัน — ชื่อยาวจัดกึ่งกลางบนแกนเส้นจึงยื่นออกนอกกล่องของช่องได้
    //    ต้องวัดกล่องตัวอักษรจริงรายบรรทัด (Range ของ element ใบสุด) ไม่ใช่กล่องของช่อง: Range ที่ครอบ block ทั้งก้อนคืนกล่องของ block มาด้วย
    const gapMm = await page.evaluate((mm) => {
      const extent = (cell) => {
        const rects = [...cell.querySelectorAll('.sign-role, .sign-below, .sign-line')].flatMap((el) => {
          if (el.matches('.sign-line')) return [el.getBoundingClientRect()]
          const range = document.createRange()
          range.selectNodeContents(el)
          return [...range.getClientRects()]
        })
        return rects.length ? { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) } : null
      }
      const cells = [...document.querySelectorAll('.exec-sign-row:not(.exec-sign-row--last) .exec-sign-cell')].map(extent)
      return cells.length === 2 && cells[0] && cells[1] ? (cells[1].left - cells[0].right) / mm : null
    }, PX_PER_MM)
    assert.ok(gapMm !== null && gapMm >= 2, `${c.label}: ตัวอักษรช่องผู้จัดทำกับผู้เสนอชิด/ทับกัน (ห่าง ${gapMm?.toFixed(1)}mm ต้อง ≥ 2mm)`)

    // 4) จำนวนแผ่น + ปิดท้าย (หมายเหตุ/ลงนาม/บรรทัดที่มา) ไม่ถูกตัดข้ามแผ่น
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    const pages = pdfPageCount(pdf)
    // เก็บไฟล์ก่อน assert จำนวนแผ่น — ล้มแล้วยังมี PDF ให้เปิดดูว่าบานตรงไหน
    if (OUT_DIR) {
      fs.mkdirSync(OUT_DIR, { recursive: true })
      fs.writeFileSync(path.join(OUT_DIR, `exec-service-report-${c.name}.pdf`), pdf)
      await page.emulateMedia({ media: 'screen' })
      await page.screenshot({ path: path.join(OUT_DIR, `exec-service-report-${c.name}.png`), fullPage: true })
      await page.emulateMedia({ media: 'print' })
    }
    assert.ok(pages >= 1 && pages <= MAX_PAGES, `${c.label}: ได้ ${pages} แผ่น (ยอมรับ 1–${MAX_PAGES})`)
    const closingBreak = await page.evaluate(() => getComputedStyle(document.querySelector('.closing')).breakInside)
    assert.equal(closingBreak, 'avoid', `${c.label}: ส่วนปิดท้ายต้อง break-inside: avoid`)

    // 5) ตัวรายงาน (ส่วนที่ 1–5 + หมายเหตุ + ช่องลงนาม) จบภายใน 2 แผ่น — ภาคผนวกสูตรขึ้นแผ่นใหม่ต่อจากนั้น
    //    วัดโดยถอดภาคผนวกออกแล้วนับแผ่น: ช่องลงนามต้องไม่ถูกดันไปอยู่แผ่นที่ 3 ตามหลังเนื้อหา
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.appendix')).breakBefore), 'page', `${c.label}: ภาคผนวกต้องขึ้นแผ่นใหม่`)
    await page.evaluate(() => document.querySelector('.appendix').remove())
    const bodyPages = pdfPageCount(await page.pdf({ preferCSSPageSize: true, printBackground: true }))
    assert.ok(bodyPages <= MAX_BODY_PAGES, `${c.label}: ตัวรายงานยาว ${bodyPages} แผ่น (ต้องจบใน ${MAX_BODY_PAGES} แผ่น รวมช่องลงนาม)`)
    assert.ok(pages > bodyPages, `${c.label}: ภาคผนวกต้องอยู่แผ่นถัดจากตัวรายงาน (รวม ${pages} · ตัวรายงาน ${bodyPages})`)
    summary = `${pages} แผ่น (ตัวรายงาน ${bodyPages} + ภาคผนวก ${pages - bodyPages})`

    await page.close()
    cases++
    console.log(`PASS ${c.label} — ${summary}`)
  }
} finally {
  await browser.close()
}
console.log(`\nok — ${cases} cases`)
