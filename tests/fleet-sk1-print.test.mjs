// แบบ สก. ๑ บันทึกรับรองการใช้ยานพาหนะส่วนกลาง (กรณีผู้บริหารท้องถิ่นเป็นผู้ขอใช้)
// ต้นฉบับจาก อบต.ทุ่งแค้ว (เจ้าของระบบส่งมา 2569-10-18) · ใช้เฉพาะนายก · พิมพ์คู่กับแบบ 3
// ตรวจเนื้อหาใบพิมพ์ + เงื่อนไขปุ่ม + เลย์เอาต์ตอนพิมพ์จริง (Chrome)
// รันด้วย: npm run test:fleet:sk1 — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { buildFleetSk1Html, buildFleetTripRequestHtml, isMayorPosition, tripRequesterIsMayor } from '../src/lib/fleetTripPrint.js'
import { PRINT_WINDOW_CLOSE_CLASS, addMobileCloseButton } from '../src/lib/printWindowClose.js'
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
// ── ปุ่ม "ปิดหน้าต่าง" บนหน้าต่างใบพิมพ์ เฉพาะมือถือ (เจ้าของระบบแจ้ง 2569-10-25 บนมือถือกดพิมพ์แล้วปิดไม่ได้) ──
// บนมือถือใบที่เปิดด้วย window.open เป็นแท็บใหม่ที่ไม่มีแถบปิด/ย้อนกลับ — ใบรถรับ-ส่งผู้ป่วยแก้ไว้แล้ว (#375) ใบยานพาหนะยังไม่มี
const wrapped = addMobileCloseButton(html)
assert.equal((wrapped.match(new RegExp(`class="${PRINT_WINDOW_CLOSE_CLASS}"`, 'g')) ?? []).length, 1, 'ต้องมีปุ่มปิดหน้าต่างปุ่มเดียว')
assert.ok(wrapped.includes('onclick="window.close()"'), 'ปุ่มต้องปิดหน้าต่างด้วย window.close()')
assert.ok(wrapped.indexOf(PRINT_WINDOW_CLOSE_CLASS) < wrapped.indexOf('</head>') && wrapped.lastIndexOf(PRINT_WINDOW_CLOSE_CLASS) < wrapped.lastIndexOf('</body>'),
  'CSS อยู่ใน <head> และปุ่มอยู่ก่อน </body>')
assert.ok(wrapped.includes('(hover: none) and (pointer: coarse)'), 'ต้องแสดงเฉพาะอุปกรณ์สัมผัส ไม่ใช่ตามความกว้างจอ (หน้า document.write ไม่มี viewport meta มือถือจึงได้ ~980px)')
assert.ok(/@media print \{[^}]*display: none !important/.test(wrapped), 'ปุ่มต้องไม่ติดไปกับกระดาษ')
assert.equal(addMobileCloseButton(wrapped), wrapped, 'ใส่ซ้ำต้องไม่ได้ปุ่มที่สอง')
assert.ok(wrapped.includes('visualViewport'), 'ปุ่มต้องจัดตำแหน่ง/ขนาดตามส่วนที่มองเห็นจริง (visualViewport) — หน้าเอกสารไม่มี viewport meta มือถือย่อหน้ากว้าง 980px ปุ่มติดขอบขวาของหน้าเคยหลุดจอ')
assert.equal(/right:\s*10px/.test(wrapped), false, 'ห้ามกลับไปใช้ปุ่มติดขอบขวาของหน้า (หลุดจอบนมือถือจริง)')
assert.equal(addMobileCloseButton(html).replace(/<style data-print-window-close>[\s\S]*?<\/style>/, '').replace(/<div class="print-window-close-touch">[\s\S]*?<\/div><script>[\s\S]*?<\/script>/, ''), html,
  'นอกจากปุ่มกับ CSS ของปุ่ม เนื้อใบต้องไม่เปลี่ยนแม้แต่ตัวอักษรเดียว')
// หน้า "กำลังเตรียมใบพิมพ์" (ไม่มี <head>/<body> ครบ) ก็ต้องได้ปุ่ม — ใบลงนามออนไลน์รอดึงลายเซ็นนาน
const loading = addMobileCloseButton('<!doctype html><meta charset="utf-8"><title>กำลังเตรียมใบพิมพ์</title><body style="padding:2rem">กำลังเตรียมใบพิมพ์…</body>')
assert.ok(loading.startsWith('<!doctype html><style data-print-window-close>') && loading.includes('onclick="window.close()"'), 'หน้ากำลังเตรียมต้องมีปุ่มปิดด้วย')
const fragment = addMobileCloseButton('<p>ชิ้นส่วนเปล่า</p>')
assert.ok(fragment.startsWith('<style data-print-window-close>') && fragment.includes('<p>ชิ้นส่วนเปล่า</p><div class=') && fragment.includes('</button></div><script>'),
  'ชิ้นส่วนที่ไม่มี head/body: CSS นำหน้า เนื้อเดิมอยู่กลาง ปุ่มต่อท้าย')
assert.ok(addMobileCloseButton(null).includes('window.close()'), 'ค่าว่างต้องไม่พัง')
// ตัวพิมพ์ในหน้ารถต้องใช้ตัวช่วยนี้จริงทั้งสองทาง (ใบทันที + หน้ากำลังเตรียม) และไม่เด้งหน้าต่างพิมพ์ใส่หน้าต่างที่ปิดไปแล้ว
const tripsPage = readFileSync('src/components/fleet/FleetTrips.jsx', 'utf8')
assert.equal((tripsPage.match(/addMobileCloseButton\(/g) ?? []).length, 2, 'ต้องห่อทั้งใบพิมพ์และหน้ากำลังเตรียม')
assert.ok(tripsPage.includes('win.document.write(addMobileCloseButton(html))'), 'ใบที่เขียนลงหน้าต่างต้องผ่านตัวช่วย')
assert.ok((tripsPage.match(/if \(win\.closed\) return/g) ?? []).length >= 3, 'ปิดหน้าต่างระหว่างรอแล้วต้องไม่เขียน/ไม่สั่งพิมพ์/ไม่ alert ตามหลัง')
// หน้าต่างรายละเอียดการใช้รถต้องอยู่เหนือแถบเมนูล่างบนมือถือ (BottomNav fixed bottom-0 z-50 วาดทีหลัง) — ไม่งั้นแถบเมนูทับท้ายหน้าต่างและ
// รับการแตะแทนปุ่มพิมพ์ แบบ 3 / สก. ๑ ที่อยู่ล่างสุด (วัดจริงบนจอ 390×844: Playwright รายงาน "intercepts pointer events") — เจ้าของระบบแจ้ง 2569-10-25
const modalTitleAt = tripsPage.indexOf('>รายละเอียดการใช้รถ</h2>')
assert.ok(modalTitleAt > 0, 'ไม่พบหัวหน้าต่างรายละเอียดการใช้รถ')
const modalWrapper = tripsPage.slice(modalTitleAt - 700, modalTitleAt)
const wrapperClass = [...modalWrapper.matchAll(/className="(fixed inset-0 [^"]*)"/g)].at(-1)?.[1] ?? ''
assert.ok(wrapperClass.split(' ').includes('z-[55]') && !wrapperClass.split(' ').includes('z-50'),
  `หน้าต่างรายละเอียดการใช้รถต้องเป็น z-[55] (เหนือ BottomNav z-50 ต่ำกว่าหน้าต่างย่อย z-[60]/z-[80]) ได้ "${wrapperClass}"`)
const request3 = buildFleetTripRequestHtml({ trip: {}, tenant, orderAuthority: {}, deptHead: {}, esign: null })

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

  // ── ปุ่มปิดหน้าต่างบน Chrome จริง: คอมพิวเตอร์ไม่เห็น · มือถือเห็นและกดปิดได้ · กระดาษไม่มี ───────────
  // เปิดเป็นหน้าต่างใหม่ด้วย window.open เหมือนปุ่มพิมพ์ในระบบ — ปัญหาเกิดเฉพาะหน้าต่างแบบนี้บนมือถือ (page.setContent ไม่เหมือน: ผลวัดลวง)
  const openPopup = async (context, source) => {
    const opener = await context.newPage()
    await opener.setContent('<p>opener</p>')
    const popupPromise = opener.waitForEvent('popup')
    await opener.evaluate(markup => { window.__printWin = window.open('', '_blank'); window.__printWin.document.write(markup); window.__printWin.document.close() }, source)
    const popup = await popupPromise
    await popup.waitForLoadState('load')
    return { opener, popup }
  }
  // ตำแหน่ง/ขนาดปุ่ม "บนหน้าจอจริง" (คิดตามส่วนที่มองเห็น) + ทดสอบกดตรงกลางปุ่มแล้วได้ปุ่มจริง ไม่ใช่ตัวอื่นบัง
  // มือถือคิดสเกลย่อพอดีจอหลังจัดหน้าเสร็จ ปุ่มจึงปรับตัวตามหลังโหลด — รอจนสเกลของปุ่มตรงกับ 1/สเกลของส่วนที่มองเห็น (ไม่ตรงเลย = ปุ่มไม่เคยปรับ → หมดเวลาแล้วเทสต์ล้ม)
  const measureButton = async popup => {
    await popup.waitForFunction(cls => {
      const wrap = document.querySelector(`.${cls}`)
      if (!wrap || getComputedStyle(wrap).display === 'none') return true
      const match = /scale\(([\d.]+)\)/.exec(wrap.style.transform || '')
      return Boolean(match) && Math.abs(parseFloat(match[1]) - 1 / window.visualViewport.scale) < 0.02
    }, PRINT_WINDOW_CLOSE_CLASS, { timeout: 4000 })
    return measureOnce(popup)
  }
  const measureOnce = popup => popup.evaluate(cls => {
    const wrap = document.querySelector(`.${cls}`)
    if (!wrap || getComputedStyle(wrap).display === 'none') return { displayed: false }
    const box = wrap.querySelector('button').getBoundingClientRect()
    const vv = window.visualViewport
    const screen = {
      left: (box.left - vv.offsetLeft) * vv.scale, top: (box.top - vv.offsetTop) * vv.scale,
      width: box.width * vv.scale, height: box.height * vv.scale,
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { displayed: true, screen, scale: vv.scale, deviceWidth: vv.width * vv.scale, hitsButton: Boolean(hit?.closest(`.${cls} button`)) }
  }, PRINT_WINDOW_CLOSE_CLASS)
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  try {
    for (const [name, source] of [['แบบ สก. ๑', addMobileCloseButton(html)], ['แบบ 3', addMobileCloseButton(request3)]]) {
      const onDesktop = await openPopup(desktop, source)
      assert.equal((await measureOnce(onDesktop.popup)).displayed, false, `${name}: คอมพิวเตอร์ (มีเมาส์) ต้องไม่เห็นปุ่ม — เจ้าของระบบสั่ง "เฉพาะมือถือ"`)
      await onDesktop.opener.close()
      const onTouch = await openPopup(touch, source)
      const m = await measureButton(onTouch.popup)
      assert.equal(m.displayed, true, `${name}: มือถือต้องเห็นปุ่มปิดหน้าต่าง`)
      // ⚠️ วัดเป็นพิกเซลบนจอจริง (คูณสเกลของส่วนที่มองเห็น) — หน้าไม่มี viewport meta ถูกย่อ ~0.5 เท่า ปุ่ม CSS 44px เหลือ ~22px บนจอ
      assert.ok(m.screen.height >= 43 && m.screen.width >= 43, `${name}: ปุ่มบนจอต้องกดด้วยนิ้วได้ (≥44px) ได้ ${m.screen.width.toFixed(0)}×${m.screen.height.toFixed(0)} (สเกล ${m.scale.toFixed(2)})`)
      assert.ok(m.screen.left >= 0 && m.screen.top >= 0 && m.screen.left + m.screen.width <= m.deviceWidth + 1,
        `${name}: ปุ่มต้องอยู่ในจอ (เคยหลุดไปทางขวา) ได้ ซ้าย ${m.screen.left.toFixed(0)} กว้าง ${m.screen.width.toFixed(0)} / จอ ${m.deviceWidth.toFixed(0)}`)
      assert.equal(m.hitsButton, true, `${name}: จุดกลางปุ่มต้องกดโดนปุ่ม ไม่มีองค์ประกอบอื่นบัง`)
      await onTouch.popup.emulateMedia({ media: 'print' })
      assert.equal(await onTouch.popup.evaluate(cls => getComputedStyle(document.querySelector(`.${cls}`)).display, PRINT_WINDOW_CLOSE_CLASS), 'none',
        `${name}: ตอนพิมพ์ต้องไม่มีปุ่ม (แม้เป็นอุปกรณ์สัมผัส)`)
      await onTouch.opener.close()
    }
    // ผู้ใช้ซูมเข้า/เลื่อนดูใบ → ปุ่มต้องตามมา ขนาดบนจอคงที่ ไม่ตกขอบ
    {
      const { opener, popup } = await openPopup(touch, addMobileCloseButton(html))
      const cdp = await touch.newCDPSession(popup)
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2.5 })
      await popup.evaluate(() => window.scrollTo(300, 400))
      await popup.waitForTimeout(300)
      const zoomed = await measureButton(popup)
      assert.ok(zoomed.screen.height >= 43 && zoomed.screen.left >= 0 && zoomed.screen.top >= 0 && zoomed.screen.left + zoomed.screen.width <= zoomed.deviceWidth + 1 && zoomed.hitsButton,
        `ซูมเข้า/เลื่อนแล้วปุ่มต้องยังอยู่มุมจอและกดได้: ${JSON.stringify(zoomed)}`)
      await opener.close()
    }
    // ใส่ปุ่มแล้วเลย์เอาต์ใบเดิมทุกมิลลิเมตร (เนื้อกับปุ่มแยกกัน) — ยังจบ 1 แผ่นและไม่ล้นพื้นที่พิมพ์เท่าเดิม
    const printView = await browser.newPage({ viewport: { width: 605, height: 1043 } })
    await printView.setContent(addMobileCloseButton(html), { waitUntil: 'load' })
    await printView.evaluate(() => document.fonts.ready)
    await printView.emulateMedia({ media: 'print' })
    const withButtonPdf = await printView.pdf({ preferCSSPageSize: true, printBackground: true })
    assert.equal((withButtonPdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 1, 'ใส่ปุ่มแล้วใบต้องยังจบ 1 แผ่น')
    const bottomWith = await printView.evaluate(() => document.querySelector('.eservice-origin').getBoundingClientRect().bottom)
    await printView.setContent(html, { waitUntil: 'load' })
    await printView.evaluate(() => document.fonts.ready)
    await printView.emulateMedia({ media: 'print' })
    const bottomWithout = await printView.evaluate(() => document.querySelector('.eservice-origin').getBoundingClientRect().bottom)
    assert.equal(bottomWith, bottomWithout, 'ใส่ปุ่มแล้วตำแหน่งท้ายใบต้องไม่ขยับ')
    await printView.close()

    // กดปุ่มบนมือถือแล้วหน้าต่างปิดจริง
    const closing = await openPopup(touch, addMobileCloseButton(html))
    await closing.popup.locator('button', { hasText: 'ปิดหน้าต่าง' }).click()
    await closing.opener.waitForFunction(() => window.__printWin.closed, null, { timeout: 5000 })
    await closing.opener.close()
    console.log('fleet print-window close button passed (คอมพิวเตอร์ไม่เห็น · มือถืออยู่ในจอ ≥44px กดโดน ปิดได้ · ซูมแล้วปุ่มตาม · ตอนพิมพ์ไม่มี · เลย์เอาต์ใบไม่เปลี่ยน)')
  } finally {
    await desktop.close()
    await touch.close()
  }
} finally {
  await browser.close()
}
