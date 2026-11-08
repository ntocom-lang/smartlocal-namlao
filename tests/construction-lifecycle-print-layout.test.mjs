// ใบพิมพ์วงจรโครงการก่อสร้าง P8–P12 — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ในเบราว์เซอร์ (Chrome ที่ลงในเครื่อง)
// ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล รันด้วย: npm run test:construction:print-layout
//
// ⚠️ วัดที่ viewport 605×1043px = 160×276mm = พื้นที่พิมพ์แนวตั้งตาม govPageCss() (ถ้า viewport กว้างกว่านี้ PDF จะจัดหน้าตามความกว้างนั้น
//    แล้วตัวอักษรล้นขอบขวาโดยตรวจไม่เจอ) · ช่องลงนามวัดด้วยกล่องตัวอักษรจริง (Range) ผ่าน tests/lib/signBlockChecks.mjs ห้ามวัดวิธีใหม่
// ⚠️ จำนวนแผ่นวัดจากความสูงเนื้อหาใน DOM (≤ 276mm = 1043px) ซึ่งเข้มกว่า PDF จริงราว 7% (Chrome บน Windows ปัดความกว้างตัวอักษรเป็นพิกเซลเต็ม
//    ตอนวัดบนจอ แต่ PDF ใช้ metric จริง) — เหมือนเทสต์ใบยืมพัสดุ (asset-borrow-layout) ที่เลิกนับแผ่นจาก regex ของ PDF เพราะ object stream บีบอัด
//    จึงใช้ PDF นับเสริมเฉพาะ "ไม่เกินกี่แผ่น" ของใบ 2 แผ่น
//
// เกณฑ์ (ตามแผนที่เจ้าของระบบอนุมัติ: ทุกใบจบ 1 แผ่น ด้วย fixture กรรมการ 3 คน + cause/detail ยาว ~300 ตัวอักษร):
//   P8 ใบรับรอง · P11 รายงานตรวจก่อนครบประกัน · P12 หนังสือแจ้งแก้ไข = 1 แผ่น
//   P9 / P10 (บันทึกเสนอ) = 2 แผ่นเสมอ (เจ้าของระบบเลือก 2569-11-08): ช่องลงนามกลาง ผอ./ปลัด/นายก (ที่ว่างเหนือเส้น 18 มม. × 2)
//   + กรรมการ + ความเห็น/คำสั่ง + footnote ใส่แผ่นเดียวไม่พอ → ตัดหน้าบังคับที่ .page-two ("- ๒ -" + ความเห็น/คำสั่ง)
//   เทสต์ two-page-split วัด "ก่อน .page-two" ≤ 1 แผ่น และ "ตั้งแต่ .page-two" ≤ 1 แผ่น (ไม่งั้นได้ 3 แผ่น)
import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import { assertSignBlockStandard, assertSignLinesAligned, PX_PER_MM } from './lib/signBlockChecks.mjs'
import {
  buildChangeRequestMemoHtml, buildContractAmendMemoHtml, buildDefectNoticeLetterHtml, buildInstallmentCertificateHtml, buildWarrantyInspectionReportHtml,
} from '../src/lib/constructionLifecyclePrint.js'
import { fixture } from './lib/constructionLifecyclePrintFixtures.mjs'

const PAGE_W = 605
const PAGE_H = 1043

const DOCS = [
  { key: 'p8', label: 'P8 ใบรับรองผลการปฏิบัติงาน', maxPages: 1, rows: 3, committee: true, build: f => buildInstallmentCertificateHtml(f) },
  { key: 'p9', label: 'P9 บันทึกเสนอขยายเวลา', maxPages: 2, rows: 6, committee: true, staff: true, build: f => buildChangeRequestMemoHtml({ ...f, change: f.extend }) },
  { key: 'p10', label: 'P10 บันทึกเสนอแก้ไขสัญญา', maxPages: 2, rows: 7, committee: true, staff: true, build: f => buildContractAmendMemoHtml({ ...f, change: f.amend }) },
  { key: 'p11', label: 'P11 รายงานตรวจก่อนครบประกัน', maxPages: 1, rows: 3, build: f => buildWarrantyInspectionReportHtml(f) },
  { key: 'p12', label: 'P12 หนังสือแจ้งแก้ไข', maxPages: 1, rows: 1, build: f => buildDefectNoticeLetterHtml({ ...f, defect: f.defect }) },
]

async function render(browser, content, media = 'print') {
  const page = await browser.newPage({ viewport: { width: PAGE_W, height: PAGE_H } })
  await page.setContent(content, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media })
  await page.waitForTimeout(300)
  return page
}

// regex /Type /Page อ่านไม่เจอเมื่อ Chromium บีบอัด object stream (คืนน้อยกว่าจริง) — ใช้เป็นขอบล่างเสริมเท่านั้น ห้ามใช้เป็นหลักฐานว่า "1 แผ่น"
function pdfPageCount(buffer) {
  const text = buffer.toString('latin1')
  return Math.max((text.match(/\/Type\s*\/Page[^s]/g) || []).length, ...(text.match(/\/Count (\d+)/g) || []).map(m => Number(m.split(' ')[1])))
}

const contentHeightPx = page => page.evaluate(() => Math.round(document.querySelector('.sheet').getBoundingClientRect().height))
const BASE = { long: true }
const variants = doc => [
  ['ข้อมูลยาว กรรมการ 3 คน', doc.build(fixture(BASE))],
  ['ไม่มีผู้ลงนามในทะเบียน', doc.build(fixture({ ...BASE, withSignatories: false }))],
]

// ส่วนก่อน/หลังจุดตัดหน้าบังคับ (.page-two) — วัดในเลย์เอาต์ต่อเนื่อง (viewport ไม่แบ่งหน้า) เทียบพื้นที่พิมพ์ 1 แผ่น
const splitHeightsPx = page => page.evaluate(() => {
  const sheet = document.querySelector('.sheet').getBoundingClientRect()
  const two = document.querySelector('.page-two')
  if (!two) return null
  const top = two.getBoundingClientRect().top
  const marginTop = parseFloat(getComputedStyle(two).marginTop) || 0
  return { one: Math.round(top - marginTop - sheet.top), two: Math.round(sheet.bottom - top) }
})

const checks = [
  {
    name: 'two-page-split',
    reason: 'P9/P10 = 2 แผ่นพอดี: เนื้อความ+กรรมการ อยู่แผ่น 1 · "- ๒ -" (+ผู้รับรองของ P10) + ความเห็น/คำสั่ง + ช่องลงนามกลาง + footnote อยู่แผ่น 2 · ใบ 1 แผ่นต้องไม่มี .page-two',
    async run(browser) {
      const notes = []
      for (const doc of DOCS) {
        for (const [name, html] of variants(doc)) {
          const page = await render(browser, html)
          try {
            const split = await splitHeightsPx(page)
            if (doc.maxPages === 1) { assert.equal(split, null, `${doc.label} (${name}) ไม่ควรมีจุดตัดหน้าบังคับ`); continue }
            assert.ok(split, `${doc.label} (${name}) ไม่มี .page-two`)
            assert.ok(split.one <= PAGE_H, `${doc.label} (${name}) แผ่น 1 สูง ${split.one}px เกิน ${PAGE_H}px → จะกลายเป็น 3 แผ่น`)
            assert.ok(split.two <= PAGE_H, `${doc.label} (${name}) แผ่น 2 สูง ${split.two}px เกิน ${PAGE_H}px`)
            const head = await page.evaluate(() => document.querySelector('.page-two').firstElementChild.textContent.trim())
            assert.equal(head, '- ๒ -', `${doc.label} (${name}) แผ่น 2 ต้องขึ้นต้นด้วยเลขหน้า`)
            notes.push(`${doc.key}=${split.one}+${split.two}px`)
          } finally { await page.close() }
        }
      }
      return notes.join(' ')
    },
  },
  {
    name: 'page-count',
    reason: 'P8/P11/P12 ต้องจบ 1 แผ่น (ความสูงเนื้อหา ≤ 276mm และ PDF ไม่เกิน 1 แผ่น) · P9/P10 ไม่เกิน 2 แผ่น (เจ้าของระบบเลือก 2 แผ่น 2569-11-08)',
    async run(browser) {
      const notes = []
      for (const doc of DOCS) {
        for (const [name, html] of variants(doc)) {
          const page = await render(browser, html)
          try {
            const px = await contentHeightPx(page)
            const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
            const pages = pdfPageCount(pdf)
            assert.ok(pages <= doc.maxPages, `${doc.label} (${name}) ได้ ${pages} แผ่น (ต้องไม่เกิน ${doc.maxPages})`)
            assert.ok(px <= PAGE_H * doc.maxPages, `${doc.label} (${name}) สูง ${px}px (${(px / PX_PER_MM).toFixed(0)}mm) เกิน ${doc.maxPages} แผ่น (${PAGE_H * doc.maxPages}px)`)
            if (doc.maxPages === 1) assert.ok(px <= PAGE_H, `${doc.label} (${name}) สูง ${px}px เกินพื้นที่พิมพ์ ${PAGE_H}px`)
            notes.push(`${doc.key}=${px}px`)
          } finally { await page.close() }
        }
      }
      return notes.join(' ')
    },
  },
  {
    name: 'committee-of-five-still-fits-p8',
    reason: 'กรรมการ 5 คน (2 แถว) ใน P8 ต้องยังจบ 1 แผ่น',
    async run(browser) {
      const page = await render(browser, buildInstallmentCertificateHtml(fixture({ ...BASE, committee: 5 })))
      try {
        const px = await contentHeightPx(page)
        assert.ok(px <= PAGE_H, `P8 กรรมการ 5 คนสูง ${px}px เกิน ${PAGE_H}px`)
        await assertSignBlockStandard(page, { minRows: 5, minBelow: 10 })
      } finally { await page.close() }
    },
  },
  {
    name: 'sign-block-standard',
    reason: 'ช่องลงนามทุกจุดของทุกใบต้องได้มาตรฐานกลาง (บรรทัดใต้เส้นกึ่งกลางบนแกน วงเล็บเว้นชื่อกว้างเท่าเส้น) ทั้งมีชื่อและเว้นว่างให้เขียนมือ',
    async run(browser) {
      for (const doc of DOCS) {
        for (const [name, html] of variants(doc)) {
          const page = await render(browser, html)
          try {
            await assertSignBlockStandard(page, { minRows: doc.rows, minBelow: doc.rows })
            if (doc.committee) await assertSignLinesAligned(page, '.committee .sign-row')
            if (doc.staff) await assertSignLinesAligned(page, '.staff-sign-row:not(.staff-sign-row--last) .sign-row')
          } catch (error) {
            error.message = `${doc.label} (${name}): ${error.message}`
            throw error
          } finally { await page.close() }
        }
      }
    },
  },
  {
    name: 'sign-groups-never-split',
    reason: 'กลุ่มลงนาม (กรรมการ/ช่องลงนามกลาง/ความเห็น-คำสั่ง) ห้ามขาดกลางหน้า — break-inside: avoid ทุกกลุ่ม',
    async run(browser) {
      for (const doc of DOCS) {
        const page = await render(browser, doc.build(fixture(BASE)))
        try {
          const breaks = await page.evaluate(() => [...document.querySelectorAll('.committee, .sign-single, .staff-sign, .order-group, .close-group, .letter-sign')]
            .map(el => `${el.className.split(' ')[0]}:${getComputedStyle(el).breakInside}`))
          assert.ok(breaks.length > 0, `${doc.label} ไม่พบกลุ่มลงนาม`)
          const bad = breaks.filter(item => !item.endsWith(':avoid'))
          assert.deepEqual(bad, [], `${doc.label} กลุ่มลงนามขาดกลางหน้าได้: ${bad}`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'no-overflow-width',
    reason: 'ตัวอักษรทุกตัว (วัดด้วย Range) ต้องอยู่ในกรอบกว้าง 160mm — ไม่ล้นขอบขวา/ซ้าย และกรอบใบกว้าง 160mm',
    async run(browser) {
      for (const doc of DOCS) {
        for (const [name, html] of [...variants(doc), ['กรรมการ 5 คน + ชื่อยาว', doc.build(fixture({ ...BASE, committee: 5 }))]]) {
          const page = await render(browser, html)
          try {
            const info = await page.evaluate(() => {
              const walker = document.createTreeWalker(document.querySelector('.sheet'), NodeFilter.SHOW_TEXT)
              const outside = []
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (!node.textContent.trim()) continue
                const range = document.createRange()
                range.selectNodeContents(node)
                for (const rect of range.getClientRects()) {
                  if (rect.width === 0) continue
                  if (rect.left < -0.5 || rect.right > innerWidth + 0.5) outside.push(`${node.textContent.trim().slice(0, 24)} [${rect.left.toFixed(0)}..${rect.right.toFixed(0)}]`)
                }
              }
              return { outside, overflowX: document.documentElement.scrollWidth - innerWidth, sheetPx: document.querySelector('.sheet').getBoundingClientRect().width }
            })
            assert.deepEqual(info.outside, [], `${doc.label} (${name}) ตัวอักษรล้นกรอบ 160mm: ${info.outside.slice(0, 4).join(' | ')}`)
            assert.ok(info.overflowX <= 1, `${doc.label} (${name}) ล้นขอบขวา ${info.overflowX}px`)
            assert.ok(Math.abs(info.sheetPx / PX_PER_MM - 160) < 1, `${doc.label} กรอบใบต้องกว้าง 160mm (ได้ ${(info.sheetPx / PX_PER_MM).toFixed(1)}mm)`)
          } finally { await page.close() }
        }
      }
    },
  },
  {
    name: 'gov-font',
    reason: 'เนื้อความ 14pt ฟอนต์ THSarabunPSK + font-size-adjust 0.45 ทุกใบ (footnote 11pt ของ P9–P11 เป็นข้อความกำกับ ไม่ใช่เนื้อความ)',
    async run(browser) {
      for (const doc of DOCS) {
        const page = await render(browser, doc.build(fixture(BASE)))
        try {
          const style = await page.evaluate(() => {
            const body = getComputedStyle(document.body)
            const para = getComputedStyle(document.querySelector('.para'))
            const note = document.querySelector('.footnote')
            return {
              family: body.fontFamily, sizePx: parseFloat(body.fontSize), adjust: body.fontSizeAdjust, paraPx: parseFloat(para.fontSize),
              notePx: note ? parseFloat(getComputedStyle(note).fontSize) : null,
            }
          })
          assert.match(style.family, /THSarabunPSK/, doc.label)
          assert.ok(style.sizePx > 18.5 && style.sizePx < 19, `${doc.label} ขนาดตัวอักษร ${style.sizePx}px ไม่ใช่ 14pt`)
          assert.ok(style.paraPx > 18.5 && style.paraPx < 19, `${doc.label} ย่อหน้า ${style.paraPx}px ไม่ใช่ 14pt`)
          assert.equal(style.adjust, '0.45', doc.label)
          if (style.notePx !== null) assert.ok(style.notePx > 14.4 && style.notePx < 15, `${doc.label} footnote ${style.notePx}px ไม่ใช่ 11pt`)
        } finally { await page.close() }
      }
    },
  },
  {
    name: 'screen-only-notes-hidden-in-print',
    reason: 'ป้ายเตือนของ P8/P12 เห็นบนจอแต่หายตอนพิมพ์ (ไม่กินที่ ไม่ลงกระดาษ) · P9–P11 ไม่มีป้าย',
    async run(browser) {
      for (const doc of DOCS) {
        const html = doc.build(fixture(BASE))
        const hasNote = html.includes('class="screen-only"')
        assert.equal(hasNote, doc.key === 'p8' || doc.key === 'p12', `${doc.label} ป้ายบนจอผิดใบ`)
        if (!hasNote) continue
        const onScreen = await render(browser, html, 'screen')
        const onPrint = await render(browser, html, 'print')
        try {
          const display = page => page.evaluate(() => getComputedStyle(document.querySelector('.screen-only')).display)
          assert.notEqual(await display(onScreen), 'none', `${doc.label} ป้ายต้องเห็นบนจอ`)
          assert.equal(await display(onPrint), 'none', `${doc.label} ป้ายต้องหายตอนพิมพ์`)
        } finally { await onScreen.close(); await onPrint.close() }
      }
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
      console.log(`  ✓ ${check.name}${note ? ` (${note})` : ''}`)
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
