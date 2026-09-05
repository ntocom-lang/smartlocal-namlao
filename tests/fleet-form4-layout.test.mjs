// แบบ 4 บันทึกการใช้รถ — ตรวจ "เลย์เอาต์ตอนพิมพ์จริง" ด้วยเบราว์เซอร์
//
// แยกจาก fleet-form4-print.test.mjs ที่ตรวจเนื้อหา HTML แบบไม่ต้องเปิดเบราว์เซอร์ (เร็วกว่ามาก)
// ไฟล์นี้ตรวจเฉพาะสิ่งที่วัดได้จากการเรนเดอร์จริงเท่านั้น: ข้อความขาด/ล้นหน้า
//
// ที่มา: ของเดิม (ก่อน 2026-09-06) ใช้สคริปต์ auto-fit ย่อขนาดฟอนต์รายช่องจนถึง 7pt
// แล้วตัด 2 บรรทัดจบด้วย "…" ถ้ายังไม่พอ — ผลคือชื่อ-นามสกุลจริงในข้อมูลจริงถูกตัดหาย
// (เช่น "นาย ชัยวัฒน์ บัว...") เพราะคอลัมน์แคบไปสำหรับชื่อยาว แม้ย่อ font สุดแล้วก็ยังไม่พอ
// แก้โดยเลิกย่อ font รายช่อง ใช้ขนาดเดียวกันทั้งตาราง (10.5pt) ให้ชื่อ-นามสกุลขึ้นบรรทัดใหม่
// แทนได้ไม่จำกัดจำนวนบรรทัด (ต้องแสดงครบเสมอ) ส่วนสถานที่ไป/หมายเหตุที่เป็นข้อความอิสระ
// ยาวไม่จำกัดได้จริง (เคยเจอปลายทางหลายหมู่บ้านคั่นด้วยจุลภาค) ยังกันไว้ที่ 2 บรรทัด+ellipsis
// เพื่อไม่ให้ 1 แถวที่ยาวผิดปกติดันทั้งหน้าล้น — ดู .cell--clamp ใน fleetForm4Print.js
//
// เทสนี้ไม่ต้องล็อกอิน ไม่แตะฐานข้อมูล — เรนเดอร์ HTML ตรงๆ แล้ววัดจาก DOM/PDF จริง
// รันด้วย: npm run test:fleet:form4 (รันคู่กับไฟล์ตรวจเนื้อหา)

import assert from 'node:assert/strict'
import process from 'node:process'
import { chromium } from 'playwright'
import {
  buildFleetForm4Html,
  FORM4_ROWS_PER_PAGE,
} from '../src/lib/fleetForm4Print.js'

const VEHICLE = { name: 'รถกระเช้าไฟฟ้า', license_plate: '81-7417 แพร่' }
const PERIOD = 'ประจำเดือน กันยายน พ.ศ. 2569'

// ค่ายาวที่สุดที่คาดว่าจะเจอจริง: ปลายทางหลายหมู่บ้านคั่นด้วยจุลภาค ชื่อ-สกุลไทยเต็ม
// และหมายเหตุระดับประโยค ถ้าเทสนี้ผ่าน แปลว่าเคสงานจริงไม่มีชื่อ/ข้อความขาดหาย
const LONG_DESTINATION = 'บ้านห้วยทรายขาว,บ้านห้วยกาน,บ้านแม่ยางเปี้ยว,บ้านนาตุ้ม,บ้านปงท่าข้าม'
const LONG_NAME = 'นาย เกียรติศักดิ์ สะปุระเสริฐวงศ์'
const LONG_NOTE = 'ตรวจสอบไฟฟ้าสาธารณะชำรุดหลายจุดในเขตพื้นที่ตำบล'

function makeTrips(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    started_at: '2026-09-01T07:59:00Z',
    returned_at: '2026-09-01T09:30:00Z',
    destination: index % 3 === 0 ? LONG_DESTINATION : 'บ้านห้วยทรายขาว,บ้านห้วยกาน',
    odometer_start: 100554 + index,
    odometer_end: 100566 + index,
    distance_km: 12,
    requester: { full_name: LONG_NAME },
    driver: { full_name: LONG_NAME },
    notes: index % 4 === 0 ? LONG_NOTE : '',
  }))
}

async function renderForm4(browser, trips) {
  const page = await browser.newPage()
  const html = buildFleetForm4Html({ vehicle: VEHICLE, trips, periodLabel: PERIOD })
  await page.setContent(html, { waitUntil: 'load' })
  // ต้องรอฟอนต์โหลดเสร็จก่อนวัด ไม่งั้นวัดความกว้าง/ความสูงด้วยฟอนต์สำรองแล้วได้ผลผิด
  await page.evaluate(() => document.fonts.ready)
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return page
}

// scrollWidth/scrollHeight > client* = เนื้อหาล้นกรอบแล้วถูก overflow:hidden กินไป
function overflowingCells(page, selector) {
  return page.evaluate(sel => [...document.querySelectorAll(sel)]
    .filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    .map(el => (el.textContent || '').trim())
    .slice(0, 5), selector)
}

// ".sheet" มี max-height + overflow:hidden ตอนพิมพ์ — getBoundingClientRect().height ของมัน
// เพดานอยู่ที่ 170mm เสมอไม่ว่าเนื้อหาจริงจะสูงแค่ไหน ใช้วัดหาการล้นไม่ได้ (จะรายงาน "พอดี"
// ทุกครั้งแม้ตัดเนื้อหาทิ้งไปจริง) ต้องวัดจาก <table> ที่ไม่ถูกครอบความสูงแทน
function sheetContentHeightMm(page) {
  return page.evaluate(() => [...document.querySelectorAll('.sheet')].map(sheet => {
    const table = sheet.querySelector('table')
    const sheetTop = sheet.getBoundingClientRect().top
    const tableBottom = table.getBoundingClientRect().bottom
    return (tableBottom - sheetTop) / 3.779527 // px -> mm ที่ 96dpi
  }))
}

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
}

const checks = [
  {
    name: 'no-name-ever-clipped',
    reason: 'ชื่อ-นามสกุล (ผู้ใช้รถ/พนักงานขับรถ) ต้องแสดงครบเสมอ ห้ามตัด/ย่อจนขาดหาย',
    async run(browser) {
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE - 1))
      try {
        // ชื่อไม่ใช้ .cell--clamp เลย (ดู dataRow ใน fleetForm4Print.js) จึงต้องไม่ล้นเด็ดขาด
        const clippedNames = await overflowingCells(page, 'td.left .cell:not(.cell--clamp)')
        assert.deepEqual(clippedNames, [],
          `ชื่อ/ข้อความที่ไม่ควรถูกตัดกลับถูกตัด: ${clippedNames.join(' | ')}`)

        // ช่องตัวเลข/วันที่ยังเป็นบรรทัดเดียวตายตัว ถ้าล้นคือคอลัมน์แคบไป (ไม่ควรเกิดกับข้อมูลจริง)
        const clippedPlain = await overflowingCells(page, 'td:not(.left)')
        assert.deepEqual(clippedPlain, [],
          `ช่องตัวเลข/วันที่ถูกตัด: ${clippedPlain.join(' | ')}`)

        const clippedHead = await overflowingCells(page, 'th')
        assert.deepEqual(clippedHead, [],
          `หัวตารางถูกตัด: ${clippedHead.join(' | ')}`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'single-line-preferred',
    reason: 'ข้อความสั้นยังเป็นบรรทัดเดียวเท่าต้นฉบับกระดาษ ไม่ขึ้นบรรทัดใหม่โดยไม่จำเป็น',
    async run(browser) {
      const trips = makeTrips(3).map(trip => ({
        ...trip, destination: 'บ้านห้วยทรายขาว', notes: '', requester: { full_name: 'นาย ทดสอบ ระบบ' },
        driver: { full_name: 'นาย ทดสอบ ระบบ' },
      }))
      const page = await renderForm4(browser, trips)
      try {
        // Range.getClientRects() ของเนื้อหาข้อความล้วน: 1 บรรทัด = 1 rect, ขึ้นบรรทัดใหม่ = มากกว่า 1
        const lineCounts = await page.evaluate(() => [...document.querySelectorAll('td.left .cell')]
          .map(el => {
            const range = document.createRange()
            range.selectNodeContents(el)
            return range.getClientRects().length
          }))
        assert.ok(lineCounts.every(n => n <= 1),
          `ข้อความสั้นถูกขึ้นบรรทัดใหม่ทั้งที่บรรทัดเดียวก็พอ (จำนวนบรรทัดต่อช่อง: ${lineCounts.join(', ')})`)
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'fits-one-page',
    reason: 'หนึ่งเดือนที่ยังไม่เต็มหน้า (แม้ชื่อ/ปลายทาง/หมายเหตุยาวสุดตามที่คาดว่าจะเจอจริง) ต้องพิมพ์จบใน 1 แผ่น',
    async run(browser) {
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE - 1))
      try {
        // preferCSSPageSize ให้ใช้ @page ของเอกสารเอง (A4 แนวนอน)
        // ถ้าไม่ใส่ Playwright จะใช้ margin 0 แล้ววัดพื้นที่ผิดจากตอนพิมพ์จริง
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 1,
          'ตารางล้นออกไปหน้าที่ 2 — ปรับ FORM4_ROWS_PER_PAGE ลง หรือทบทวนความกว้างคอลัมน์')

        const heights = await sheetContentHeightMm(page)
        // เหลือขอบไว้กันฟอนต์ต่างเครื่อง (เครื่อง อปท. ใช้ TH Sarabun New ที่ metric ไม่เท่ากัน)
        // พื้นที่พิมพ์จริง 170mm — วัดจาก <table> ตรงๆ ไม่ใช่ .sheet ที่ถูก overflow:hidden ครอบไว้
        // (ครอบแล้วจะรายงาน "พอดี 170mm" เสมอแม้เนื้อหาจริงล้นไปเยอะ ดู sheetContentHeightMm ด้านบน)
        for (const mm of heights) {
          assert.ok(mm <= 167,
            `เนื้อหาสูง ${mm.toFixed(1)}mm เหลือขอบน้อยเกินไป (พื้นที่พิมพ์ 170mm) เสี่ยงตกหน้า 2 บนเครื่องอื่น`)
        }
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'overflow-spillover-page-fits',
    reason: 'เดือนที่ข้อมูลเต็มพอดี 1 หน้า แถวรวมยอดจะเด้งไปหน้าถัดไปเดี่ยวๆ (ดู paginateForm4Trips) — หน้านั้นเกือบเป็นแถวว่างล้วน ต้องไม่ล้นเพราะแถวว่างถูกดันสูงเพื่อเติมเต็มหน้า',
    async run(browser) {
      // ที่มา: 2026-09-05 ตั้ง tr.blank-filler ให้สูงกว่าปกติเพื่อให้ตารางเต็มหน้าเวลาข้อมูลน้อย
      // (ดูคอมเมนต์ tr.blank-filler td ใน fleetForm4Print.js) ตอนแรกตั้ง 11mm โดยลืมคิดพื้นที่
      // ของ thead (หัวตาราง 2 แถวที่มีป้ายกำกับยาวถึง 4 บรรทัด กิน ~19mm) รวมเข้าไปในงบ
      // ผลคือหน้าที่มีแต่แถวว่าง 13 แถว + แถวรวม 1 แถว ล้นไป 195mm จาก 189mm (ยุคขอบเข้าแฟ้มด้านซ้าย) แก้เป็น 9.8mm
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE))
      try {
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        assert.equal(pdfPageCount(pdf), 2,
          'ข้อมูลเต็มพอดี 1 หน้าต้องมีหน้าที่ 2 สำหรับแถวรวมยอดเสมอ (ไม่งั้นแถวรวมหายไปพร้อมกับหน้าแรก)')

        const heights = await sheetContentHeightMm(page)
        for (const mm of heights) {
          assert.ok(mm <= 167,
            `เนื้อหาสูง ${mm.toFixed(1)}mm เหลือขอบน้อยเกินไป (พื้นที่พิมพ์ 170mm) — ปรับ tr.blank-filler td height ลง`)
        }
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'long-free-text-visibly-clamped-not-silently-lost',
    reason: 'สถานที่ไป/หมายเหตุที่ยาวเกินกันไว้ต้องจบด้วย "…" ให้เห็น ไม่ตัดหายเงียบแบบไม่มีสัญญาณ',
    async run(browser) {
      const trips = makeTrips(3).map((trip, index) => index === 0
        ? { ...trip, notes: 'เหตุฉุกเฉินนอกเวลาราชการ '.repeat(20), destination: 'จุดทดสอบ' }
        : trip)
      const page = await renderForm4(browser, trips)
      try {
        const state = await page.evaluate(() => {
          const cell = [...document.querySelectorAll('td.left .cell--clamp')]
            .find(el => (el.textContent || '').includes('เหตุฉุกเฉินนอกเวลาราชการ'))
          if (!cell) return null
          const cs = getComputedStyle(cell)
          return {
            webkitLineClamp: cs.webkitLineClamp,
            overflowHidden: cs.overflow === 'hidden',
            clipped: cell.scrollHeight > cell.clientHeight + 1,
          }
        })
        assert.ok(state, 'ไม่พบช่องหมายเหตุที่มีข้อความยาวทดสอบ')
        assert.ok(state.clipped, 'ทดสอบนี้ต้องการข้อความที่ยาวเกินจริง แต่กลับแสดงครบพอดี — ปรับความยาวข้อความทดสอบ')
        assert.equal(state.webkitLineClamp, '2',
          'ไม่ได้ตั้ง -webkit-line-clamp ข้อความที่เกินจะถูกตัดหายโดยไม่มี "…" บอก')
        assert.ok(state.overflowHidden, 'ข้อความล้นออกนอกตาราง ทับเส้นกรอบ แทนที่จะถูก clamp ไว้ในกรอบ')
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'backdated-reason-not-printed',
    reason: 'เหตุผลบันทึกย้อนหลังต้องไม่ปรากฏในหมายเหตุของแบบ 4 อีกต่อไป',
    async run(browser) {
      const trips = makeTrips(2).map(trip => ({ ...trip, notes: '', backdated_reason: 'เหตุผลทดสอบเฉพาะกิจ' }))
      const page = await renderForm4(browser, trips)
      try {
        const text = await page.evaluate(() => document.body.innerText)
        assert.ok(!text.includes('เหตุผลทดสอบเฉพาะกิจ'),
          'เหตุผลบันทึกย้อนหลังหลุดไปแสดงในแบบ 4 ทั้งที่ควรอยู่แค่ในระบบ')
      } finally {
        await page.close()
      }
    },
  },
  {
    name: 'total-row-always-present',
    reason: 'แถวรวมระยะทางทั้งสิ้นต้องมีเสมอ แม้แถวข้อมูลจะเต็มหน้าพอดี',
    async run(browser) {
      const page = await renderForm4(browser, makeTrips(FORM4_ROWS_PER_PAGE))
      try {
        const text = await page.evaluate(() => document.body.innerText)
        assert.ok(text.includes('รวมระยะทางทั้งสิ้น'),
          'ข้อมูลเต็มหน้าพอดีแล้วแถวรวมยอดหายไป')
        const totalRows = await page.evaluate(() => document.querySelectorAll('tr.total').length)
        assert.equal(totalRows, 1, `พบแถวรวมยอด ${totalRows} แถว ต้องมีแถวเดียว`)
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
  process.stdout.write(`แบบ 4 — ตรวจเอกสารที่พิมพ์\n${results.join('\n')}\n`)
  process.stdout.write(`SUMMARY PASS=${results.length - failed} FAIL=${failed}\n`)
  if (failed) process.exitCode = 1
}

main().catch(error => {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exitCode = 1
})
