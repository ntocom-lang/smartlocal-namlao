// แบบ สก. ๑ บันทึกรับรองการใช้ยานพาหนะส่วนกลาง (กรณีผู้บริหารท้องถิ่นเป็นผู้ขอใช้)
// ต้นฉบับจาก อบต.ทุ่งแค้ว (เจ้าของระบบส่งมา 2569-10-18) · ใช้เฉพาะนายก · พิมพ์คู่กับแบบ 3
// ตรวจเนื้อหาใบพิมพ์ + เงื่อนไขปุ่ม + เลย์เอาต์ตอนพิมพ์จริง (Chrome)
// รันด้วย: npm run test:fleet:sk1 — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { buildFleetSk1Html, isMayorPosition, tripRequesterIsMayor } from '../src/lib/fleetTripPrint.js'
import { assertSignBlockStandard } from './lib/signBlockChecks.mjs'

// ── ใครได้แบบ สก. ๑: นายกเท่านั้น (เจ้าของระบบเลือก 2569-10-18 ไม่รวมรองนายก) ─────────────
for (const text of ['นายกเทศมนตรีตำบลน้ำเลา', 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว', ' นายก อบต.']) {
  assert.equal(isMayorPosition(text), true, `"${text}" ต้องนับเป็นนายก`)
}
for (const text of ['รองนายกเทศมนตรี', 'รองนายกองค์การบริหารส่วนตำบลทุ่งแค้ว', 'ผู้ช่วยนายก', 'เลขานุการนายก',
  'นายกรัฐมนตรี', 'ปลัดเทศบาล', '', null, undefined]) {
  assert.equal(isMayorPosition(text), false, `"${text}" ต้องไม่นับเป็นนายก`)
}
// ตำแหน่งที่กรอกในคำขอชนะโปรไฟล์ — ทางแก้เมื่อระบบดูผิดคือแก้ช่องตำแหน่งในคำขอ
assert.equal(tripRequesterIsMayor({ requester_position: 'นายกเทศมนตรีตำบลสาธิต', requester: { job_title: 'นักจัดการงานทั่วไป' } }), true)
assert.equal(tripRequesterIsMayor({ requester_position: 'นักจัดการงานทั่วไป', requester: { job_title: 'นายกเทศมนตรี' } }), false)
assert.equal(tripRequesterIsMayor({ requester_position: '  ', requester: { job_title: 'นายกเทศมนตรีตำบลสาธิต' } }), true)
assert.equal(tripRequesterIsMayor({ requester: { position: { name: 'นายกองค์การบริหารส่วนตำบลสาธิต' } } }), true)
assert.equal(tripRequesterIsMayor({}), false)

// ── เนื้อหาใบ: ถ้อยคำตามต้นฉบับเรียงตามลำดับ + ค่าจากคำขอใช้รถ ─────────────────────────────
const tenant = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว' }
const trip = {
  status: 'completed',
  requester: { full_name: 'นายกันตพงษ์ คำปลุก', job_title: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว' },
  requester_position: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว',
  vehicle: { license_plate: 'กข 1234 แพร่' },
  destination: 'ศาลากลางจังหวัดแพร่',
  destination_locality: 'อำเภอเมืองแพร่',
  destination_province: 'จังหวัดแพร่',
  purpose: 'ประชุมผู้บริหารท้องถิ่นประจำเดือน',
  planned_departure: '2026-10-20T01:00:00Z',
  planned_return: '2026-10-20T09:00:00Z',
  started_at: '2026-10-20T01:30:00Z',
  returned_at: '2026-10-20T10:15:00Z',
}
const html = buildFleetSk1Html({ trip, tenant })
const body = html.slice(html.indexOf('<body>'))
const order = ['แบบ สก. ๑', 'บันทึกรับรองการใช้ยานพาหนะส่วนกลาง', '(กรณีผู้บริหารท้องถิ่นเป็นผู้ขอใช้ยานพาหนะส่วนกลาง)',
  'เขียนที่', 'วันที่', 'เดือน', 'พ.ศ.', 'ข้าพเจ้า', 'ตำแหน่ง', 'ได้ใช้ยานพาหนะส่วนกลาง หมายเลขทะเบียน', 'เดินทางไปยัง',
  'เพื่อ', 'ในวันที่', 'เดือน', 'พ.ศ.', 'เวลา', 'น.', 'ถึงวันที่', 'เดือน', 'พ.ศ.', 'เวลา', 'น.',
  'ขอรับรองว่า รายละเอียดการใช้ยานพาหนะส่วนกลางในครั้งนี้ เป็นความจริงทุกประการ',
  // govSignRow วางคำต่อท้าย "ผู้บริหารท้องถิ่น" หลังบรรทัดใต้เส้นใน DOM (บนกระดาษอยู่ท้ายเส้นเหมือนต้นฉบับ)
  '(ลงชื่อ)', '(นายกันตพงษ์ คำปลุก)', 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว', 'วันที่', 'เดือน', 'ปี', 'ผู้บริหารท้องถิ่น']
let cursor = -1
for (const text of order) {
  const at = body.indexOf(text, cursor + 1)
  assert.ok(at > cursor, `แบบ สก. ๑ ต้องมี "${text}" ตามลำดับต้นฉบับ`)
  cursor = at
}
for (const text of ['>องค์การบริหารส่วนตำบลทุ่งแค้ว<', '>กข 1234 แพร่<', '>ศาลากลางจังหวัดแพร่ อำเภอเมืองแพร่ จังหวัดแพร่<',
  '>ประชุมผู้บริหารท้องถิ่นประจำเดือน<', '>08:30<', '>17:15<', '>ตุลาคม<', '>2569<']) {
  assert.ok(body.includes(text), `แบบ สก. ๑ ต้องมี ${text}`)
}
assert.equal(body.includes('จังหวัดจังหวัด'), false, 'ชื่อจังหวัดที่มีคำว่า "จังหวัด" อยู่แล้วต้องไม่ซ้ำ')
// เวลาจริงชนะเวลาตามคำขอ (ชุดเดียวกับแบบ 3)
assert.equal(body.includes('>08:00<'), false, 'ออกจริง 08:30 ต้องไม่พิมพ์เวลาตามคำขอ 08:00')
// ต้นฉบับไม่อ้างเลขข้อระเบียบ — ห้ามเติมเอง (ที่มายังต้องยืนยันกับฉบับปัจจุบัน)
for (const text of ['ระเบียบ', 'ข้อ ๑๒', 'ข้อ 12']) {
  assert.equal(body.includes(text), false, `แบบ สก. ๑ ต้องไม่มี "${text}" ที่ต้นฉบับไม่มี`)
}

// ยังไม่กลับ = วันที่หัวใบเว้นว่าง (ห้ามรับรองล่วงหน้าด้วยวันกลับตามแผน) แต่ช่วงเวลาใช้ตามคำขอได้
const pending = buildFleetSk1Html({ trip: { ...trip, status: 'approved', started_at: null, returned_at: null }, tenant })
const headDate = pending.slice(pending.indexOf('class="head"'), pending.indexOf('class="body"'))
assert.equal(/fill-day is-filled|fill-month is-filled|fill-year is-filled/.test(headDate), false,
  'ยังไม่กลับ วันที่หัวใบต้องเว้นให้เขียน')
assert.ok(pending.includes('>08:00<') && pending.includes('>16:00<'), 'ยังไม่ออกเดินทาง ช่วงเวลาใช้ตามคำขอ')

// escape + ใบเปล่า (ไม่มีชื่อ = วงเล็บเว้นชื่อ, ไม่มีตำแหน่ง = ชื่อตำแหน่งนายกของ อปท.)
const nasty = buildFleetSk1Html({ trip: { ...trip, purpose: '<img src=x onerror=alert(1)>' }, tenant })
assert.ok(nasty.includes('&lt;img src=x onerror=alert(1)&gt;') && !nasty.includes('<img src=x'), 'ข้อความจากผู้ใช้ต้อง escape')
const blank = buildFleetSk1Html({ trip: {}, tenant: { name: 'เทศบาลตำบลน้ำเลา' } })
assert.ok(/\(\.{10,}\)/.test(blank), 'ไม่มีชื่อผู้ขอ = วงเล็บเว้นชื่อให้เขียน')
assert.ok(blank.includes('นายกเทศมนตรีตำบลน้ำเลา'), 'ไม่มีตำแหน่ง = ใช้ชื่อตำแหน่งนายกของ อปท.')

// ── หน้าจอ: ปุ่มเฉพาะคำขอของนายกที่ได้รถแล้ว และยังมีปุ่มแบบ 3 อยู่ (พิมพ์คู่ ไม่ได้แทน) ───────
const page = readFileSync('src/components/fleet/FleetTrips.jsx', 'utf8')
assert.ok(/const canPrintSk1 = tripRequesterIsMayor\(t\) && \['approved', 'in_progress', 'completed'\]\.includes\(t\.status\)/.test(page),
  'ปุ่มแบบ สก. ๑ ต้องขึ้นเฉพาะนายก + คำขอที่ได้รถแล้ว')
assert.ok(page.includes('{canPrintSk1 && (') && page.includes('printSk1(t)'), 'ต้องมีปุ่มพิมพ์แบบ สก. ๑')
assert.ok(page.includes('onClick={() => printTripRequest(t)}'), 'ปุ่มแบบ 3 ต้องยังอยู่ — เจ้าของระบบเลือกพิมพ์คู่')

// ── เลย์เอาต์ตอนพิมพ์จริง: ต้องจบ 1 แผ่น ไม่ล้นขอบ ช่องลงนามตามมาตรฐาน ─────────────────────
const longTrip = {
  ...trip,
  requester: { full_name: 'ว่าที่ร้อยตรีกันตพงษ์ศักดิ์ คำปลุกเจริญยิ่งยงวงศ์', job_title: '' },
  // ตำแหน่งห้ามตัดคำ (nowrap) — ใส่ยาวเกินปกติไว้ด้วยว่ายังไม่ล้นขอบขวาทั้งในเนื้อความและใต้ลายเซ็น
  requester_position: 'นายกองค์การบริหารส่วนตำบลทุ่งแค้ว อำเภอเมืองแพร่ จังหวัดแพร่',
  destination: 'สำนักงานส่งเสริมการปกครองท้องถิ่นจังหวัดแพร่ และศาลากลางจังหวัดแพร่ (อาคารหลังใหม่) ห้องประชุมชั้น 3',
  purpose: 'เข้าร่วมประชุมชี้แจงแนวทางการจัดทำแผนพัฒนาท้องถิ่นและการบริหารงบประมาณประจำปี พ.ศ. 2570 ตามหนังสือจังหวัดแพร่',
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  // โหมดพิมพ์ .sheet ไม่มี padding (ขอบมาจาก @page) — viewport ต้องเท่าพื้นที่พิมพ์ 160 × 276 มม.
  // ถ้าใช้กว้าง A4 เต็ม บรรทัดจะได้ที่กว้างกว่ากระดาษจริง 50 มม. แล้วผ่านลวง
  const view = await browser.newPage({ viewport: { width: 605, height: 1043 } })
  const results = []
  for (const [name, args, minBelow] of [
    ['ข้อมูลครบ', { trip, tenant }, 3],
    ['ข้อความยาวสุด', { trip: longTrip, tenant }, 3],
    ['ใบเปล่า', { trip: {}, tenant }, 3],
  ]) {
    await view.setContent(buildFleetSk1Html(args), { waitUntil: 'load' })
    await view.evaluate(() => document.fonts.ready)
    await view.emulateMedia({ media: 'print' })
    await view.waitForTimeout(200)
    const pdf = await view.pdf({ preferCSSPageSize: true, printBackground: true })
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    assert.equal(pages, 1, `แบบ สก. ๑ (${name}) ต้องจบ 1 แผ่น ได้ ${pages} แผ่น`)
    const measured = await view.evaluate(() => {
      const mm = 96 / 25.4
      const sheet = document.querySelector('.sheet')
      const box = sheet.getBoundingClientRect()
      const lineHeight = parseFloat(getComputedStyle(sheet).lineHeight)
      // กล่องตัวอักษรจริง (Range) — วัดกล่อง element แล้วได้ผลลวงมาแล้ว
      const textRight = el => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return Math.max(...[...range.getClientRects()].map(rect => rect.right))
      }
      return {
        bottom: (document.querySelector('.eservice-origin').getBoundingClientRect().bottom - box.top) / mm,
        overflowRight: [...document.querySelectorAll('.line-row, .flow, .sign-row, .certify')]
          .filter(el => textRight(el) > box.right + 1).map(el => el.textContent.trim().slice(0, 20)),
        // ป้ายคำ (ข้าพเจ้า/เดินทางไปยัง/เวลา ฯลฯ) ห้ามตกบรรทัด — สูงเกิน 1 บรรทัด = ถูกบีบ
        wrappedLabels: [...document.querySelectorAll('.line-row > span:not(.fill)')]
          .filter(el => el.getBoundingClientRect().height > lineHeight * 1.5).map(el => el.textContent.trim()),
        // ช่องวันที่/เวลาต้องเหลือที่ให้เขียนด้วยมือ
        narrowFills: [...document.querySelectorAll('.fill:not(.is-filled)')]
          .filter(el => el.getBoundingClientRect().width < 8 * mm).length,
        headDateOneLine: document.querySelectorAll('.head .line-row')[1].getBoundingClientRect().height < lineHeight * 1.6,
        // ชื่อ/ตำแหน่ง/ทะเบียนห้ามถูกตัดกลางคำ (เคยได้ "…ตำบลทุ่งแค้|ว")
        keeps: document.querySelectorAll('.keep').length,
        brokenKeeps: [...document.querySelectorAll('.keep')].filter(el => el.getClientRects().length > 1)
          .map(el => el.textContent.trim()),
      }
    })
    results.push(`${name} ${measured.bottom.toFixed(1)}`)
    assert.ok(measured.bottom <= 276, `แบบ สก. ๑ (${name}) ล้นพื้นที่พิมพ์: ${measured.bottom.toFixed(1)} มม.`)
    assert.deepEqual(measured.overflowRight, [], `แบบ สก. ๑ (${name}) มีบรรทัดล้นขอบขวา`)
    assert.deepEqual(measured.wrappedLabels, [], `แบบ สก. ๑ (${name}) ป้ายคำถูกบีบจนตกบรรทัด`)
    assert.equal(measured.narrowFills, 0, `แบบ สก. ๑ (${name}) มีช่องว่างแคบเกินเขียนด้วยมือ`)
    assert.ok(measured.headDateOneLine, `แบบ สก. ๑ (${name}) บรรทัดวันที่หัวใบต้องอยู่บรรทัดเดียว`)
    assert.deepEqual(measured.brokenKeeps, [], `แบบ สก. ๑ (${name}) ชื่อ/ตำแหน่ง/ทะเบียนถูกตัดกลางคำ`)
    if (args.trip.requester_position) assert.equal(measured.keeps, 3, `แบบ สก. ๑ (${name}) ชื่อ ตำแหน่ง ทะเบียน ต้องห้ามตัดคำทั้ง 3 ช่อง`)
    await assertSignBlockStandard(view, { minRows: 1, minBelow })
  }
  console.log(`fleet แบบ สก. ๑ print assertions passed (${results.join(' · ')} มม. / 276)`)
} finally {
  await browser.close()
}
