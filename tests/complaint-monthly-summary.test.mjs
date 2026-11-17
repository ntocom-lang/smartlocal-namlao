// สรุปเรื่องร้องเรียนรายเดือน (src/lib/complaintMonthlySummary.js + complaintMonthlyPrint.js)
//   ชั้นแรก: ช่วงวันที่/ตัวเลือกเดือน/ตัวเลขสรุป/ข้อความสรุป — คำนวณล้วน ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต
//   ชั้นสอง: โหลดใบจริงใน Chrome — ต้องจบ 1 แผ่น A4 และโค้ดที่ฝังมากับชื่อ อปท./ชื่อหมวดไม่ทำงาน
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// ตั้งโซนเวลาเครื่องเป็นต่างประเทศ: ถ้าโค้ดอ่านเดือนจากเวลาเครื่องแทนเวลาไทย เคสข้ามเดือนด้านล่างจะพัง
process.env.TZ = 'America/Los_Angeles'
const Sum = await import('../src/lib/complaintMonthlySummary.js')
const {
  MAX_CATEGORY_ROWS, MONTH_OPTION_COUNT, UNSPECIFIED_ISSUE_LABEL, lastFullMonth, monthPeriod, parseMonthParam, recentMonthOptions, summarizeMonth,
} = Sum
const { buildComplaintMonthlyHtml } = await import('../src/lib/complaintMonthlyPrint.js')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const NOW = new Date('2026-10-18T05:00:00Z') // 18 ต.ค. 2569 เที่ยงเวลาไทย
const LABELS = {
  light: 'ไฟฟ้าสาธารณะ', water: 'น้ำประปา', trash: 'ขยะ/ความสะอาด', road: 'ถนน/ทางสาธารณะ', other: 'อื่นๆ',
}
const labelOf = code => LABELS[code] ?? `หมวด ${code}`
const rowsOf = spec => Object.entries(spec).flatMap(([category, n]) => Array.from({ length: n }, () => ({ category })))
const APRIL = monthPeriod(2569, 4)
const summarize = (over = {}) => summarizeMonth({
  stats: { total: 39, open: 1, in_progress: 1, resolved: 37, rejected: 0, avg_days: 1.5 },
  rows: rowsOf({ light: 13, other: 11, water: 7, trash: 7, road: 1 }),
  labelOf, tenantName: 'เทศบาลตำบลสาธิต', period: APRIL, now: NOW, ...over,
})

await test('ช่วงวันที่ของเดือน: ปีอธิกสุรทิน ธันวาคม และเลข พ.ศ.→ค.ศ.', () => {
  assert.deepEqual([APRIL.from, APRIL.to, APRIL.label, APRIL.key], ['2026-04-01', '2026-04-30', 'เมษายน 2569', '2569-04'])
  assert.equal(monthPeriod(2567, 2).to, '2024-02-29', 'ก.พ. 2567 = ค.ศ. 2024 เป็นปีอธิกสุรทิน')
  assert.equal(monthPeriod(2568, 2).to, '2025-02-28')
  assert.deepEqual([monthPeriod(2568, 12).from, monthPeriod(2568, 12).to], ['2025-12-01', '2025-12-31'])
})

await test('อ่าน ?m= — ค่าผิดรูปแบบ อนาคต และไกลเกินช่วงตัวเลือกต้องเป็น null', () => {
  assert.equal(parseMonthParam('2569-04', NOW).key, '2569-04')
  assert.equal(parseMonthParam('2569-10', NOW).key, '2569-10', 'เดือนปัจจุบันเปิดได้')
  for (const bad of ['2569-11', '2570-01', '2569-13', '2569-00', '2569-4', '69-04', 'abc', '', null, undefined, '2569-04-01', ' 2569-04']) {
    assert.equal(parseMonthParam(bad, NOW), null, String(bad))
  }
  assert.equal(parseMonthParam('2567-11', NOW).key, '2567-11', 'เดือนที่ 24 ย้อนหลังยังเปิดได้')
  assert.equal(parseMonthParam('2567-10', NOW), null, 'เดือนที่ 25 ย้อนหลังเกินช่วง')
})

await test('ตัวเลือกเดือน: เรียงใหม่→เก่า ข้ามปีถูก และครบ 24 เดือน', () => {
  const options = recentMonthOptions(MONTH_OPTION_COUNT, NOW)
  assert.equal(options.length, 24)
  assert.equal(options[0].key, '2569-10')
  assert.equal(options[9].key, '2569-01')
  assert.equal(options[10].key, '2568-12', 'ม.ค. 2569 → ธ.ค. 2568')
  assert.equal(options[23].key, '2567-11')
  assert.equal(new Set(options.map(o => o.key)).size, 24, 'ห้ามซ้ำ')
  assert.equal(lastFullMonth(NOW).key, '2569-09', 'เดือนที่จบครบล่าสุด')
})

await test('เดือนตามเวลาไทย ไม่ใช่เวลาเครื่อง (เครื่องอยู่ลอสแอนเจลิส)', () => {
  // 30 ก.ย. 18:30 UTC = 1 ต.ค. 01:30 เวลาไทย แต่ในลอสแอนเจลิสยังเป็น 30 ก.ย. 11:30
  const edge = new Date('2026-09-30T18:30:00Z')
  assert.equal(recentMonthOptions(1, edge)[0].key, '2569-10')
  assert.equal(lastFullMonth(edge).key, '2569-09')
  assert.ok(parseMonthParam('2569-10', edge))
  assert.equal(summarize({ period: monthPeriod(2569, 10), now: edge }).isCurrentMonth, true)
})

await test('ตัวเลขสรุปตรงกับตัวอย่างจริง 39 เรื่อง (เสร็จ 37 = 94.9%)', () => {
  const s = summarize()
  assert.deepEqual([s.total, s.resolved, s.ongoing, s.rejected], [39, 37, 2, 0])
  assert.equal(s.resolvedPercent, 94.9)
  assert.equal(s.ongoingPercent, 5.1)
  assert.deepEqual(s.categories.map(c => [c.label, c.count, c.percent]), [
    ['ไฟฟ้าสาธารณะ', 13, 33.3],
    ['อื่นๆ', 11, 28.2],
    ['ขยะ/ความสะอาด', 7, 17.9], // เท่ากับน้ำประปา → เรียงตามตัวอักษรไทย ขยะ ก่อน น้ำ
    ['น้ำประปา', 7, 17.9],
    ['ถนน/ทางสาธารณะ', 1, 2.6],
  ])
  assert.equal(s.categories.reduce((sum, c) => sum + c.count, 0), s.total)
})

await test('ข้อความสรุปมาจากแม่แบบ: มีตัวเลข ไม่มีคำประเมินผลงานตัวเอง', () => {
  const s = summarize()
  assert.ok(s.narrative.startsWith('ในเดือนเมษายน 2569 เทศบาลตำบลสาธิตรับเรื่องร้องเรียน/ร้องทุกข์ผ่านระบบ e-Service ทั้งหมด 39 เรื่อง'))
  assert.ok(s.narrative.includes('หมวดที่มีจำนวนเรื่องสูงสุดตามลำดับ ได้แก่ ไฟฟ้าสาธารณะ 13 เรื่อง (ร้อยละ 33.3) อื่นๆ 11 เรื่อง (ร้อยละ 28.2) และ ขยะ/ความสะอาด 7 เรื่อง (ร้อยละ 17.9)'))
  assert.ok(s.narrative.includes('ดำเนินการแล้วเสร็จ 37 เรื่อง (ร้อยละ 94.9) และ อยู่ระหว่างดำเนินการ 2 เรื่อง'))
  for (const praise of ['น่าพอใจ', 'ดีเยี่ยม', 'ยอดเยี่ยม', 'ประสบความสำเร็จ', 'มีประสิทธิภาพ']) {
    assert.ok(!s.narrative.includes(praise), `ห้ามประเมินผลงานตัวเอง: ${praise}`)
  }
  assert.ok(s.notes.some(n => n.includes('ณ วันที่ 18 ตุลาคม 2569') && n.includes('อาจเปลี่ยน')), 'ต้องบอกวันที่ของข้อมูลและว่าตัวเลขขยับได้')
  assert.ok(!s.notes.some(n => n.includes('ยังไม่สิ้นสุด')), 'เมษายนจบแล้ว')
})

await test('เรื่องที่ไม่รับ/ยกเลิกขึ้นในประโยคสถานะ ต่อเมื่อมี', () => {
  const s = summarize({ stats: { total: 10, open: 0, in_progress: 1, resolved: 8, rejected: 1 }, rows: rowsOf({ light: 10 }) })
  assert.ok(s.narrative.includes('ดำเนินการแล้วเสร็จ 8 เรื่อง (ร้อยละ 80) อยู่ระหว่างดำเนินการ 1 เรื่อง และ ไม่รับเรื่อง/ยกเลิก 1 เรื่อง'))
  assert.ok(s.narrative.includes('ทุกเรื่องอยู่ในหมวดไฟฟ้าสาธารณะ'), 'หมวดเดียว')
})

await test('เดือนที่ไม่มีเรื่อง: ข้อความบอกตรงๆ ไม่มีตารางหมวด ไม่มีหมายเหตุสถานะ', () => {
  const s = summarize({ stats: { total: 0 }, rows: [] })
  assert.equal(s.narrative, 'ในเดือนเมษายน 2569 ไม่มีเรื่องร้องเรียน/ร้องทุกข์ที่รับผ่านระบบ e-Service ของเทศบาลตำบลสาธิต')
  assert.deepEqual([s.total, s.resolvedPercent, s.categories.length, s.notes.length], [0, 0, 0, 0])
  assert.ok(buildComplaintMonthlyHtml({ tenant: { name: 'ก' }, summary: s }).includes('ไม่มีเรื่องร้องเรียน'))
})

await test('เดือนปัจจุบันมีหมายเหตุว่ายังไม่สิ้นสุด', () => {
  const s = summarize({ period: monthPeriod(2569, 10) })
  assert.ok(s.notes.some(n => n.includes('เดือนนี้ยังไม่สิ้นสุด')))
})

await test(`หมวดเกิน ${MAX_CATEGORY_ROWS} พับส่วนที่เหลือรวมกัน โดยไม่ใช้ชื่อ "อื่นๆ" ที่ชนกับหมวดจริง`, () => {
  const spec = {}
  for (let i = 0; i < 11; i++) spec[`c${i}`] = 11 - i // 11,10,...,1 = 66 เรื่อง
  spec.other = 0
  const s = summarize({ stats: { total: 66, resolved: 66 }, rows: rowsOf(spec) })
  assert.equal(s.categories.length, MAX_CATEGORY_ROWS)
  const rest = s.categories.at(-1)
  assert.equal(rest.label, 'หมวดที่เหลือ (4 หมวด)', '11 หมวด แสดง 7 + พับ 4')
  assert.equal(rest.code, null)
  assert.equal(rest.count, 4 + 3 + 2 + 1)
  assert.equal(s.categories.reduce((sum, c) => sum + c.count, 0), 66, 'พับแล้วยอดรวมต้องเท่าเดิม')
  assert.ok(!s.narrative.includes('หมวดที่เหลือ'), 'หมวดที่พับไม่ถูกเรียงเข้าอันดับในข้อความ')
})

await test('รายการถูกตัดที่ LIMIT: ไม่แสดงสัดส่วนหมวดเลย (ดีกว่าแสดงเลขเพี้ยน) แต่ยอดรวมยังจริง', () => {
  const s = summarize({ stats: { total: 1500, resolved: 1200, in_progress: 300 }, rows: rowsOf({ light: 1000 }) })
  assert.equal(s.categoriesComplete, false)
  assert.equal(s.categories.length, 0)
  assert.equal(s.total, 1500)
  assert.ok(!s.narrative.includes('หมวดที่มีจำนวนเรื่องสูงสุด'))
  assert.ok(s.notes.some(n => n.includes('ไม่แสดงสัดส่วนตามหมวด') && n.includes('1,000 จาก 1,500')))
})

await test('ชื่อหมวดมาจาก labelOf เท่านั้น — รหัสดิบไม่หลุดลงข้อความ', () => {
  const s = summarize({ stats: { total: 2, resolved: 2 }, rows: rowsOf({ water_repair: 2 }), labelOf: () => 'ซ่อมน้ำประปา' })
  assert.ok(!s.narrative.includes('water_repair'))
  assert.ok(s.narrative.includes('ซ่อมน้ำประปา'))
})

// ── รายการย่อยใต้หมวด (complaint_issue_breakdown_fy) ──
const LIGHT_ROWS = [
  { issue_label: 'ไฟดับทั้งดวง', total: 6 }, { issue_label: 'ไฟกระพริบ', total: '3' }, // bigint จาก PostgREST อาจเป็นสตริง
  { issue_label: 'สายไฟชำรุด', total: 2 }, { issue_label: null, total: 2 },
]
const lightOf = summary => summary.categories.find(c => c.code === 'light')

await test('รายการย่อย: ผลรวมตรงยอดหมวด → แนบใต้หมวดนั้นตามลำดับเดิมจากฐานข้อมูล ชื่อ NULL = "ไม่ระบุลักษณะ"', () => {
  const s = summarize({ issueBreakdown: { category: 'light', rows: LIGHT_ROWS } })
  assert.deepEqual(lightOf(s).subItems, [
    { label: 'ไฟดับทั้งดวง', count: 6 }, { label: 'ไฟกระพริบ', count: 3 },
    { label: 'สายไฟชำรุด', count: 2 }, { label: UNSPECIFIED_ISSUE_LABEL, count: 2 },
  ])
  for (const c of s.categories.filter(c => c.code !== 'light')) assert.equal(c.subItems, undefined, `${c.label} ต้องไม่มีรายการย่อย`)
})

await test('รายการย่อย: ไม่ส่ง/ผลรวมไม่ตรง/มีแต่ไม่ระบุ/ว่าง → ไม่แสดง (ดีกว่าตัวเลขที่รวมกันไม่เท่าหมวด)', () => {
  const cases = {
    'ไม่ส่ง': null,
    'ผลรวมเกิน (มีเรื่องเข้ามาคั่นระหว่างสองคำสั่ง)': { category: 'light', rows: [...LIGHT_ROWS, { issue_label: 'ไฟกระพริบ', total: 1 }] },
    'ผลรวมขาด': { category: 'light', rows: LIGHT_ROWS.slice(0, 2) },
    'มีแต่ไม่ระบุลักษณะ': { category: 'light', rows: [{ issue_label: null, total: 13 }] },
    'แถวว่าง': { category: 'light', rows: [] },
    'rows เป็น null': { category: 'light', rows: null },
  }
  for (const [name, issueBreakdown] of Object.entries(cases)) {
    assert.equal(lightOf(summarize({ issueBreakdown })).subItems, undefined, name)
  }
})

await test('รายการย่อย: หมวดไม่ตรง หรือหมวดถูกพับรวมใน "หมวดที่เหลือ" → ไม่แนบ', () => {
  assert.equal(lightOf(summarize({ issueBreakdown: { category: 'trash', rows: LIGHT_ROWS } })).subItems, undefined)
  const spec = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`c${i}`, 11 - i]))
  spec.light = 1
  const s = Sum.summarizeMonth({
    stats: { total: 67, resolved: 67 }, rows: rowsOf(spec), labelOf, tenantName: 'ก', period: APRIL, now: NOW,
    issueBreakdown: { category: 'light', rows: [{ issue_label: 'ไฟดับทั้งดวง', total: 1 }] },
  })
  assert.ok(s.categories.every(c => c.subItems === undefined))
})

// ── ชุดตัวเลขที่ล็อก (เฟส 2): categoryCounts + lock ──
const LOCK_MAY = { publishedAt: '2026-05-02T01:30:00Z', revision: 1 } // 2 พ.ค. 2569 08:30 น. เวลาไทย

await test('ชุดที่ล็อก: ยอดรายหมวดมาจาก categoryCounts — ไม่ติดเพดานของ rows (rows ถูกตัดที่ 1,000 แต่ยอดรวม 1,500 ยังได้สัดส่วนครบ) · bigint สตริงใช้ได้', () => {
  const s = summarize({
    stats: { total: 1500, resolved: 1200, in_progress: 300 }, rows: rowsOf({ light: 1000 }),
    categoryCounts: [{ category: 'water', total: '600' }, { category: 'light', total: 900 }],
  })
  assert.equal(s.categoriesComplete, true)
  assert.deepEqual(s.categories.map(c => [c.code, c.count, c.percent]), [['light', 900, 60], ['water', 600, 40]])
  assert.ok(!s.notes.some(n => n.includes('ไม่แสดงสัดส่วนตามหมวด')))
})

await test('ชุดที่ล็อก: "ณ วันที่" = วันที่ล็อกตามเวลาไทย (ไม่ใช่วันที่เปิดดู) · หมายเหตุบอกวันที่ล็อกและแทนประโยค "ตัวเลขอาจเปลี่ยน"', () => {
  const s = summarize({ lock: LOCK_MAY })
  assert.equal(s.asOf, '2 พฤษภาคม 2569')
  assert.deepEqual(s.locked, { asOf: '2 พฤษภาคม 2569', revision: 1 })
  assert.ok(s.notes[0].includes('ตัวเลขชุดนี้ล็อกไว้เมื่อวันที่ 2 พฤษภาคม 2569'))
  assert.ok(!s.notes.some(n => n.includes('ตัวเลขอาจเปลี่ยน')), 'ชุดที่ล็อกนิ่งแล้ว ห้ามบอกว่าตัวเลขอาจเปลี่ยน')
  assert.ok(!s.notes[0].includes('แก้ไขครั้งที่'))
  // 1 พ.ค. 17:30 UTC = 2 พ.ค. 00:30 เวลาไทย (เครื่องทดสอบตั้งเป็นลอสแอนเจลิส) ต้องได้วันที่ 2
  assert.equal(summarize({ lock: { publishedAt: '2026-05-01T17:30:00Z', revision: 1 } }).asOf, '2 พฤษภาคม 2569')
})

await test('ชุดที่ล็อกซ้ำ (revision ≥ 2) บอกผู้อ่านว่าตัวเลขถูกแก้ไขกี่ครั้ง', () => {
  assert.ok(summarize({ lock: { ...LOCK_MAY, revision: 2 } }).notes[0].includes('(แก้ไขครั้งที่ 1)'))
  assert.ok(summarize({ lock: { ...LOCK_MAY, revision: 4 } }).notes[0].includes('(แก้ไขครั้งที่ 3)'))
})

await test('ไม่ส่ง lock → locked เป็น null และหมายเหตุเดิมไม่เปลี่ยน · วันที่ล็อกเสีย = ถือว่าไม่ได้ล็อก (ใช้วันที่เปิดดู ไม่ใช่ "Invalid Date")', () => {
  const live = summarize()
  assert.equal(live.locked, null)
  assert.ok(live.notes[0].includes('ร้อยละที่แล้วเสร็จนับจากสถานะ ณ วันที่ 18 ตุลาคม 2569'))
  const broken = summarize({ lock: { publishedAt: 'ไม่ใช่วันที่', revision: 1 } })
  assert.equal(broken.locked, null)
  assert.equal(broken.asOf, '18 ตุลาคม 2569')
  assert.ok(!JSON.stringify(broken).includes('Invalid'))
})

await test('ชุดที่ล็อกกับรายการย่อยหมวดไฟฟ้า: แนบรายการย่อยจากชุดที่ล็อกเมื่อผลรวมตรงยอดหมวดเหมือนข้อมูลสด', () => {
  const s = summarize({
    categoryCounts: [{ category: 'light', total: 13 }, { category: 'other', total: 11 }, { category: 'water', total: 7 }, { category: 'trash', total: 7 }, { category: 'road', total: 1 }],
    issueBreakdown: { category: 'light', rows: LIGHT_ROWS }, lock: LOCK_MAY,
  })
  assert.equal(lightOf(s).subItems.length, 4)
})

// ── ชั้นสอง: ใบพิมพ์ ──
const PAYLOADS = [
  `<img src=x onerror="window.__pwned='img'">`,
  `<script>window.__pwned='script'</script>`,
  `<svg onload="window.__pwned='svg'"></svg>`,
  `</td></tr></tbody></table><h1 id=injected>x</h1>`,
]

await test('HTML ของใบ: ชื่อ อปท. และชื่อหมวดที่มีแท็กออกมาเป็นตัวอักษร', () => {
  const s = summarize({ labelOf: code => (code === 'light' ? PAYLOADS[0] : labelOf(code)), tenantName: PAYLOADS[1] })
  const html = buildComplaintMonthlyHtml({ tenant: { name: PAYLOADS[1] }, summary: s })
  for (const tag of ['<img', '<script', '<svg', '<h1']) {
    // <script ที่เหลืออยู่ได้เฉพาะของโครงใบ (ไม่มี) — เจอเมื่อไรแปลว่าหลุดมาจากข้อมูล
    assert.equal(html.split(tag).length - 1, 0, `พบ ${tag} ในใบ`)
  }
  assert.ok(html.includes('&lt;img src=x'))
})

await test('ใบไม่มีข้อมูลส่วนบุคคลและไม่มีตารางรายเรื่อง', () => {
  const html = buildComplaintMonthlyHtml({ tenant: { name: 'เทศบาลตำบลสาธิต' }, summary: summarize() })
  // ผลการดำเนินงาน 1 ตาราง + สัดส่วนหมวด 1 ตาราง = 2 — เพิ่มตารางที่สามเมื่อไรต้องมีคนทบทวนเรื่องข้อมูลส่วนบุคคลก่อน
  assert.equal(html.split('<table>').length - 1, 2)
  for (const banned of ['เบอร์', 'ที่อยู่', 'ผู้แจ้ง', 'ชื่อ-สกุล', 'ref_no', 'ES-69']) {
    assert.ok(!html.includes(banned), `ใบไม่ควรมี "${banned}"`)
  }
  assert.ok(html.includes('สรุปเรื่องร้องเรียน/ร้องทุกข์ประจำเดือนเมษายน 2569'))
  assert.ok(html.includes('ผ่านระบบ E-Service เทศบาลตำบลสาธิต · ข้อมูล ณ วันที่ 18 ตุลาคม 2569'))
})

const REPORT_URL = 'https://namlao.rk-networks.com/complaint'

await test('ใบ A4: ไม่ส่งลิงก์ = ไม่มีช่อง QR · ส่งแล้ว = QR เวกเตอร์ฝังในใบ + ข้อความชวนแจ้งเรื่อง + ลิงก์ไม่มี https://', () => {
  const tenant = { name: 'เทศบาลตำบลสาธิต' }
  const plainHtml = buildComplaintMonthlyHtml({ tenant, summary: summarize() })
  assert.ok(!plainHtml.includes('class="report"') && !plainHtml.includes('<svg'), 'ไม่มีลิงก์ต้องไม่มีช่อง')
  const html = buildComplaintMonthlyHtml({ tenant, summary: summarize(), reportUrl: REPORT_URL })
  assert.equal(html.split('<svg').length - 1, 1)
  assert.ok(html.includes('class="report"') && html.includes('แจ้งเรื่อง/ติดตามเรื่องของท่าน'))
  assert.ok(html.includes('สแกน QR หรือเข้าที่ namlao.rk-networks.com/complaint') && !html.includes('https://namlao'))
  // บรรทัดแหล่งที่มา/วันที่ของข้อมูลย้ายเข้าไปอยู่ในช่อง ไม่หายไปและไม่ซ้ำสองที่
  assert.equal(html.split('ข้อมูล ณ วันที่ 18 ตุลาคม 2569').length - 1, 1, 'วันที่ของข้อมูลต้องมีบรรทัดเดียว')
  assert.ok(html.includes('<p class="origin">ผ่านระบบ E-Service เทศบาลตำบลสาธิต · ข้อมูล ณ วันที่ 18 ตุลาคม 2569</p>'))
  assert.ok(/<path transform="translate\(4 4\)" d="M[^"]+" fill="#000"\/>/.test(html), 'QR ต้องดำล้วน พร้อมขอบสงบ 4 โมดูล')
  assert.ok(/<rect width="\d+" height="\d+" fill="#fff"\/>/.test(html), 'พื้นขาวหลัง QR')
  // ไม่ดึงอะไรจากเครือข่าย (ใบพิมพ์จากหน้าต่างใหม่ที่ออฟไลน์ได้) และยังไม่มีข้อมูลส่วนบุคคล/ตารางเพิ่ม
  assert.ok(!/<(img|link)[^>]+(src|href)=["']https?:\/\/namlao/.test(html))
  assert.equal(html.split('<table>').length - 1, 2)
  for (const banned of ['เบอร์', 'ที่อยู่', 'ผู้แจ้ง', 'ชื่อ-สกุล', 'ref_no', 'ES-69']) assert.ok(!html.includes(banned), `ใบไม่ควรมี "${banned}"`)
})

await test('ใบ A4: ลิงก์ที่มีแท็กถูกหนีอักขระ · สร้าง QR ไม่ได้ก็ยังเหลือลิงก์ตัวอักษร (ไม่ล้ม)', () => {
  const tenant = { name: 'เทศบาลตำบลสาธิต' }
  const evil = buildComplaintMonthlyHtml({ tenant, summary: summarize(), reportUrl: 'https://x.test/"><script>window.__pwned=1</script>' })
  assert.ok(!evil.includes('<script'), 'ลิงก์หลุดเป็นโค้ด')
  assert.ok(evil.includes('&lt;script&gt;'))
  const tooLong = buildComplaintMonthlyHtml({ tenant, summary: summarize(), reportUrl: `https://x.test/${'a'.repeat(2500)}` })
  assert.ok(!tooLong.includes('<svg') && tooLong.includes('เข้าที่ x.test/') && !tooLong.includes('สแกน QR'))
})

// ── ไม่แสดงหมวดในภาพ/ใบที่ส่งออก (2569-10-29) → ตัดเรื่องในหมวดออกทั้งหมด ยอด/ผลการดำเนินงานคิดใหม่ (เจ้าของสั่ง 2569-11-17) ──
const sumOf = categories => categories.reduce((total, c) => total + c.count, 0)
const textOf = s => [...s.sentences, ...s.notes, ...s.categories.map(c => c.label)].join(' ')
// รายเรื่องมีสถานะ: ไฟฟ้า 13 (เสร็จ 13 ใช้ 2 วัน) · อื่นๆ 11 (เสร็จ 10 ใช้ 1 วัน + รอ 1) · ประปา 7 (เสร็จ 6 + ระหว่าง 1) · ขยะ 7 เสร็จ · ถนน 1 เสร็จ
const statusRows = [
  ...Array.from({ length: 13 }, () => ({ category: 'light', status: 'done', days_taken: 2 })),
  ...Array.from({ length: 10 }, () => ({ category: 'other', status: 'closed', days_taken: 1 })),
  { category: 'other', status: 'new', days_taken: null },
  ...Array.from({ length: 6 }, () => ({ category: 'water', status: 'completed', days_taken: 1 })),
  { category: 'water', status: 'in_progress', days_taken: null },
  ...Array.from({ length: 7 }, () => ({ category: 'trash', status: 'done', days_taken: 1 })),
  { category: 'road', status: 'done', days_taken: 1 },
]

await test('statsFromRows: กลุ่มสถานะชุดเดียวกับ complaint_stats_fy · ค่าเฉลี่ยวันเฉพาะเรื่องที่เสร็จ', () => {
  assert.deepEqual(Sum.statsFromRows([
    { status: 'new' }, { status: 'pending' }, { status: 'received' }, { status: 'in_progress' },
    { status: 'done', days_taken: 1 }, { status: 'closed', days_taken: '2' }, { status: 'completed', days_taken: null },
    { status: 'rejected' }, { status: 'parked' },
  ]), { total: 9, open: 3, in_progress: 1, resolved: 3, rejected: 1, parked: 1, avg_days: 1.5 })
  assert.equal(Sum.statsFromRows([]).avg_days, null)
})

await test('ไม่แสดงหมวด: ไม่ส่ง/ส่งรหัสที่ไม่มีในช่วงนี้ = เหมือนเดิมทุกอย่าง · allCategories มีครบทุกหมวด', () => {
  const base = summarize()
  assert.equal(base.hiddenCount, 0)
  assert.equal(base.excludesHidden, false)
  assert.deepEqual(base.allCategories.map(c => c.code), ['light', 'other', 'trash', 'water', 'road'])
  const unknown = summarize({ hiddenCategories: ['corruption'] })
  assert.deepEqual([unknown.sentences, unknown.notes, unknown.categories, unknown.total], [base.sentences, base.notes, base.categories, base.total])
})

await test('ไม่แสดงหมวด: ตัดไฟฟ้า 13 เรื่องออกทั้งหมด → ยอด 26 · ผลการดำเนินงานคิดใหม่ · ไม่มี "หมวดที่เหลือ" · หมายเหตุไม่บอกชื่อ', () => {
  const s = summarize({ rows: statusRows, hiddenCategories: ['light'] })
  assert.equal(s.excludesHidden, true)
  assert.equal(s.hiddenCount, 1)
  assert.equal(s.total, 26)
  assert.equal(sumOf(s.categories), 26, 'วงกลมต้องบวกได้เท่ายอดที่แสดง')
  assert.ok(!s.categories.some(c => c.code === null), 'ห้ามมีแถว "หมวดที่เหลือ" จากหมวดที่ปิด')
  assert.deepEqual([s.resolved, s.ongoing, s.rejected], [24, 2, 0])
  assert.equal(s.resolvedPercent, 92.3)
  assert.equal(s.avgDays, 1, 'ค่าเฉลี่ยวันต้องไม่รวมไฟฟ้า (2 วัน)')
  assert.ok(!textOf(s).includes('ไฟฟ้าสาธารณะ'), 'ชื่อหมวดที่ปิดหลุด')
  assert.ok(s.sentences[0].includes('ผ่านระบบ e-Service จำนวน 26 เรื่อง') && !s.sentences[0].includes('ทั้งหมด'))
  assert.ok(s.sentences.some(x => x.startsWith('หมวดที่มีจำนวนเรื่องสูงสุดตามลำดับ ได้แก่ อื่นๆ 11 เรื่อง (ร้อยละ 42.3)')))
  assert.ok(s.sentences.some(x => x.startsWith('ดำเนินการแล้วเสร็จ 24 เรื่อง (ร้อยละ 92.3)')))
  assert.ok(s.notes.includes(Sum.EXCLUDED_NOTE))
  assert.ok(!/\d+ หมวด/.test(Sum.EXCLUDED_NOTE), 'หมายเหตุต้องไม่บอกจำนวนหมวด')
  assert.deepEqual(s.allCategories.map(c => c.code), ['light', 'other', 'trash', 'water', 'road'], 'รายการปุ่มยังครบเพื่อกดกลับมาแสดงได้')
  const html = buildComplaintMonthlyHtml({ tenant: { name: 'เทศบาลตำบลสาธิต' }, summary: s })
  assert.ok(!html.includes('ไฟฟ้าสาธารณะ') && !html.includes('รับเรื่องทั้งหมด') && html.includes('รับเรื่อง (เฉพาะหมวดที่เผยแพร่)'))
  assert.ok(html.includes('ไม่รวมเรื่องบางหมวดที่ไม่ได้เผยแพร่'))
})

await test('ไม่แสดงหมวด: เหลือหมวดเดียว → "ทุกเรื่องอยู่ในหมวด…" ของเรื่องที่แสดง · ปิดครบทุกหมวด = ไม่ตัด (ภาพว่างจะเป็นข้อความเท็จ)', () => {
  const one = summarize({ rows: statusRows, hiddenCategories: ['light', 'other', 'trash', 'water'] })
  assert.equal(one.total, 1)
  assert.ok(one.sentences.includes('ทุกเรื่องอยู่ในหมวดถนน/ทางสาธารณะ'))
  const all = summarize({ rows: statusRows, hiddenCategories: ['light', 'other', 'trash', 'water', 'road'] })
  assert.equal(all.excludesHidden, false)
  assert.equal(all.total, 39)
})

await test(`ไม่แสดงหมวด + หมวดเกิน ${MAX_CATEGORY_ROWS}: พับเฉพาะหมวดที่แสดง · หมวดที่ปิดไม่อยู่ในแถวใด`, () => {
  const spec = Object.fromEntries([200, 150, 130, 120, 100, 90, 80, 70, 50, 35, 20].map((n, i) => [`c${i}`, n]))
  const rows = Object.entries(spec).flatMap(([category, n]) => Array.from({ length: n }, () => ({ category, status: 'done' })))
  const s = summarizeMonth({
    stats: { total: 1045, resolved: 1045 }, rows, labelOf: code => `หมวด ${code}`,
    tenantName: 'เทศบาลตำบลสาธิต', period: APRIL, now: NOW, hiddenCategories: ['c0'],
  })
  assert.equal(s.total, 845)
  assert.equal(s.categories.length, MAX_CATEGORY_ROWS)
  assert.equal(sumOf(s.categories), 845)
  assert.ok(!s.categories.some(c => c.code === 'c0'))
  assert.equal(s.categories.at(-1).label, `หมวดที่เหลือ (${10 - (MAX_CATEGORY_ROWS - 1)} หมวด)`)
})

await test('ไม่แสดงหมวด: รายการย่อยของไฟฟ้าที่ปิดไม่หลุด · ชุดที่ล็อก (categoryCounts) ตัดไม่ได้ = คงเดิม (หน้าเว็บส่งตัวเลขสดมาแทน)', () => {
  const breakdown = { category: 'light', rows: [{ issue_label: 'ไฟดับทั้งดวง', total: 13 }] }
  const s = summarize({ rows: statusRows, hiddenCategories: ['light'], issueBreakdown: breakdown })
  assert.ok(!s.categories.some(c => c.subItems))
  assert.ok(!textOf(s).includes('ไฟดับ'))
  const locked = summarize({
    rows: [], hiddenCategories: ['other'],
    categoryCounts: [{ category: 'light', total: '13' }, { category: 'other', total: '11' }, { category: 'water', total: '15' }],
    lock: { publishedAt: '2026-05-02T01:30:00Z', revision: 1 },
  })
  assert.equal(locked.excludesHidden, false)
  assert.equal(locked.total, 39)
})

// ── อันดับพื้นที่ / ประเภท (เจ้าของสั่ง 2569-11-17 ตามภาพอ้างอิง TOP 10) ──
await test('อันดับประเภท: หมวดทั่วไปใช้ชื่อหมวด · ไฟฟ้าแตกเป็นรายลักษณะมีชื่อหมวดกำกับ · ไม่เกิน 5 · ไม่มีหมวดที่ปิด', () => {
  const breakdown = { category: 'light', rows: [
    { issue_label: 'ไฟดับทั้งดวง', total: 8 }, { issue_label: 'อื่นๆ', total: 3 }, { issue_label: null, total: 2 },
  ] }
  const s = summarize({ issueBreakdown: breakdown })
  assert.deepEqual(s.typeRanking.map(t => [t.label, t.group, t.count]), [
    ['อื่นๆ', null, 11], ['ไฟดับทั้งดวง', 'ไฟฟ้าสาธารณะ', 8], ['ขยะ/ความสะอาด', null, 7], ['น้ำประปา', null, 7],
    ['ไฟฟ้าสาธารณะ', 'อื่นๆ', 3],
  ])
  // ลักษณะ "อื่นๆ"/"ไม่ระบุลักษณะ" ใช้ชื่อหมวดเป็นชื่อหลัก ไม่ใช่คำว่า "อื่นๆ" เดี่ยวๆ
  assert.ok(!s.typeRanking.some(t => t.label === 'อื่นๆ' && t.group === 'ไฟฟ้าสาธารณะ'))
  assert.equal(Sum.MAX_RANK_ROWS, 5)
  // ยอดรายลักษณะไม่ตรงยอดหมวด (อ่านคนละจังหวะ) = ไม่แตก ใช้ชื่อหมวดทั้งก้อน
  const mismatch = summarize({ issueBreakdown: { category: 'light', rows: [{ issue_label: 'ไฟดับทั้งดวง', total: 4 }] } })
  assert.deepEqual(mismatch.typeRanking[0], { label: 'ไฟฟ้าสาธารณะ', group: null, code: 'light', count: 13 })
  const hidden = summarize({ rows: statusRows, hiddenCategories: ['other'], issueBreakdown: breakdown })
  assert.ok(!hidden.typeRanking.some(t => t.code === 'other'), 'หมวดที่ปิดต้องไม่อยู่ในอันดับประเภท')
  assert.equal(summarize({ stats: { total: 0 }, rows: [] }).typeRanking, null)
})

await test('อันดับพื้นที่: เรียงมาก→น้อย ไม่เกิน 5 · แถวไม่ระบุหมู่ (NULL/ว่าง) ไม่ถูกจัดอันดับ · ไม่ส่ง/ไม่มีข้อมูล = null', () => {
  const s = summarize({ areaCounts: [
    { area: 'หมู่ 2', total: '3' }, { area: null, total: 9 }, { area: 'หมู่ 10', total: 5 }, { area: '  ', total: 4 },
    { area: 'บ้านใหม่', total: 5 }, { area: 'หมู่ 1', total: 1 }, { area: 'หมู่ 3', total: 2 }, { area: 'หมู่ 4', total: 2 },
  ] })
  assert.deepEqual(s.areaRanking.map(a => [a.label, a.count]), [['บ้านใหม่', 5], ['หมู่ 10', 5], ['หมู่ 2', 3], ['หมู่ 3', 2], ['หมู่ 4', 2]])
  assert.equal(summarize().areaRanking, null)
  assert.equal(summarize({ areaCounts: [{ area: null, total: 4 }] }).areaRanking, null)
})

await test('SQL อันดับพื้นที่: ชื่อผ่าน exec_village_label เท่านั้น · ไม่นับหมวดอ่อนไหว · ตัดหมวดได้เฉพาะเจ้าหน้าที่ · anon เรียกได้', async () => {
  const { readFile } = await import('node:fs/promises')
  const sql = await readFile(new URL('../supabase/migrations/20261206100000_complaint_area_ranking_fy.sql', import.meta.url), 'utf8')
  assert.ok(sql.includes("NULLIF(public.exec_village_label(_municipality_id, r.village), '') AS area"))
  // หมวดทุจริตปิดตายตามรหัส ไม่พึ่งธง requires_manual_intake อย่างเดียว (migration-reviewer รอบ 1)
  assert.ok(sql.includes("AND c.category <> 'corruption'"))
  // คนทั่วไปได้อันดับเฉพาะช่วงเดือนเต็ม (กันจับคู่เรื่องเดี่ยวรายวันกับ complaints_public_fy และการลบสองช่วง)
  assert.ok(sql.includes('IF NOT v_is_staff AND (EXTRACT(day FROM _from) <> 1 OR EXTRACT(day FROM _to + 1) <> 1) THEN'))
  // role/สังกัด NULL ต้องได้ false ไม่ใช่ NULL (NULL ทำให้ด่านเดือนเต็มถูกข้าม)
  assert.ok(/v_is_staff := COALESCE\(v_role = 'superadmin'[\s\S]*?, false\);/.test(sql))
  assert.ok(sql.includes('NOT COALESCE(c.category = ANY (v_exclude), false)'), 'NULL ในรายการตัดหมวดต้องไม่ทำให้ทุกแถวหลุด')
  // c.village ดิบอยู่ได้แค่ใน CTE raw (นับ/จัดกลุ่ม) — คอลัมน์ที่คืนต้องเป็น g.area ที่ผ่าน exec_village_label เท่านั้น
  assert.ok(sql.includes('SELECT g.area, sum(g.n)::bigint AS total'), 'ผลลัพธ์ต้องมาจาก g.area')
  assert.ok(!/SELECT[^;]*\bc\.village\s+AS\s+area/.test(sql), 'ห้ามคืน c.village ดิบเป็น area')
  assert.ok(sql.includes('NOT COALESCE(cat.requires_manual_intake, false)'))
  assert.ok(/v_role IN \('admin', 'officer', 'staff'\)/.test(sql) && sql.includes("v_role = 'superadmin'"))
  assert.ok(sql.includes("SET search_path = ''") && sql.includes('SECURITY DEFINER'))
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.complaint_area_ranking_fy(uuid, date, date, text[]) TO anon, authenticated;'))
})

// channel: 'chrome' ใช้ Chrome ที่ลงในเครื่องอยู่แล้ว ไม่ต้อง playwright install เพิ่ม
const browser = await chromium.launch({ channel: 'chrome' })
try {
  await test('โหลดใบใน Chrome จริง — โค้ดที่ฝังมาไม่ทำงาน', async () => {
    const s = summarize({ labelOf: code => (code === 'light' ? PAYLOADS[0] : labelOf(code)), tenantName: PAYLOADS[2] })
    const page = await browser.newPage()
    try {
      await page.route('**/*', route => route.abort()) // ไม่ใช้เน็ต (ฟอนต์ Google ถูกบล็อกด้วย)
      await page.setContent(buildComplaintMonthlyHtml({ tenant: { name: PAYLOADS[2] }, summary: s }), { waitUntil: 'domcontentloaded' })
      assert.equal(await page.evaluate(() => window.__pwned), undefined, 'โค้ดที่ฝังมาทำงาน')
      assert.equal(await page.locator('#injected').count(), 0)
      assert.ok((await page.locator('table').first().innerText()).includes('รับเรื่องทั้งหมด'))
    } finally { await page.close() }
  })

  // ใบที่ยาวที่สุดที่เป็นไปได้: 8 หมวด (พับแล้ว) + ทุกหมายเหตุขึ้นพร้อมกัน (เดือนปัจจุบัน + ตัวเลขยาว) ต้องยังจบ 1 แผ่น
  await test('จบ 1 แผ่น A4 แม้เนื้อหายาวสุด (8 หมวด + หมายเหตุครบ + ชื่อ อปท. ยาว)', async () => {
    // 11 หมวด รวม 1,045 เรื่อง (ผลรวมต้องเท่ากับ total ไม่งั้นตัวคำนวณจะถือว่าข้อมูลถูกตัดแล้วไม่แสดงตารางหมวด)
    const spec = Object.fromEntries([200, 150, 130, 120, 100, 90, 80, 70, 50, 35, 20].map((n, i) => [`c${i}`, n]))
    const worst = summarizeMonth({
      stats: { total: 1045, open: 40, in_progress: 100, resolved: 890, rejected: 15, avg_days: 12.5 },
      rows: rowsOf(spec),
      labelOf: code => `หมวดคำร้องเรื่องที่มีชื่อค่อนข้างยาวมาก ${code}`,
      tenantName: 'องค์การบริหารส่วนตำบลที่มีชื่อยาวมากพอสมควรสำหรับทดสอบการขึ้นบรรทัดใหม่ของข้อความ',
      period: monthPeriod(2569, 10), now: NOW,
    })
    const page = await browser.newPage()
    try {
      await page.route('**/*', route => route.abort())
      await page.setContent(buildComplaintMonthlyHtml({ tenant: { name: 'องค์การบริหารส่วนตำบลที่มีชื่อยาวมากพอสมควรสำหรับทดสอบการขึ้นบรรทัดใหม่ของข้อความ' }, summary: worst }), { waitUntil: 'domcontentloaded' })
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
      assert.equal(pages, 1, `ใบยาวสุดพิมพ์ได้ ${pages} แผ่น`)
    } finally { await page.close() }
  })

  // ใบของเดือนที่ล็อก: หมายเหตุล็อก (ยาวกว่าหมายเหตุเดิม + "แก้ไขครั้งที่ N") ต้องยังจบ 1 แผ่นแม้เนื้อหายาวสุด และมีวันที่ล็อกในส่วนท้ายใบ
  await test('ใบของเดือนที่ล็อก: จบ 1 แผ่น A4 แม้เนื้อหายาวสุด · ท้ายใบบอกวันที่ล็อก ไม่ใช่วันที่พิมพ์', async () => {
    const spec = Object.fromEntries([200, 150, 130, 120, 100, 90, 80, 70, 50, 35, 20].map((n, i) => [`c${i}`, n]))
    const tenantName = 'องค์การบริหารส่วนตำบลที่มีชื่อยาวมากพอสมควรสำหรับทดสอบการขึ้นบรรทัดใหม่ของข้อความ'
    const worstLocked = summarizeMonth({
      stats: { total: 1045, open: 40, in_progress: 100, resolved: 890, rejected: 15, avg_days: 12.5 },
      rows: [], categoryCounts: Object.entries(spec).map(([category, total]) => ({ category, total })),
      labelOf: code => `หมวดคำร้องเรื่องที่มีชื่อค่อนข้างยาวมาก ${code}`, tenantName,
      period: monthPeriod(2569, 9), now: NOW, lock: { publishedAt: '2026-10-02T01:30:00Z', revision: 12 },
    })
    const html = buildComplaintMonthlyHtml({ tenant: { name: tenantName }, summary: worstLocked })
    assert.ok(html.includes('ข้อมูล ณ วันที่ 2 ตุลาคม 2569') && !html.includes('ข้อมูล ณ วันที่ 18 ตุลาคม 2569'))
    assert.ok(html.includes('ตัวเลขชุดนี้ล็อกไว้เมื่อวันที่ 2 ตุลาคม 2569 (แก้ไขครั้งที่ 11)'))
    const page = await browser.newPage()
    try {
      await page.route('**/*', route => route.abort())
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
      assert.equal(pages, 1, `ใบของเดือนที่ล็อกพิมพ์ได้ ${pages} แผ่น`)
    } finally { await page.close() }
  })

  // ช่อง QR (24 มม.) กินที่เพิ่มราว 1.3–1.8 ซม. — ใบที่หนาแน่นแต่เป็นไปได้จริง (หมวดพับครบ 8 แถว ชื่อหมวดยาว ~37 ตัวอักษร
  // ชื่อ อปท. 2 บรรทัดในบรรทัดแหล่งที่มา หมายเหตุครบ ทั้งเดือนสดและเดือนที่ล็อก 12 ครั้ง) ต้องยังจบ 1 แผ่น
  await test('ใบที่มีช่อง QR: จบ 1 แผ่น A4 เมื่อหนาแน่นแต่เป็นไปได้จริง (สดและล็อก) · QR กว้าง 24 มม. อยู่ในพื้นที่พิมพ์', async () => {
    const spec = Object.fromEntries([200, 150, 130, 120, 100, 90, 80, 70, 50, 35, 20].map((n, i) => [`c${i}`, n]))
    const tenantName = 'องค์การบริหารส่วนตำบลที่มีชื่อยาวพอสมควรมาก'
    const stats = { total: 1045, open: 40, in_progress: 100, resolved: 890, rejected: 15, avg_days: 12.5 }
    const labelOfDense = code => `หมวดเรื่องร้องเรียนที่ชื่อค่อนข้างยาว ${code}`
    const dense = summarizeMonth({ stats, rows: rowsOf(spec), labelOf: labelOfDense, tenantName, period: monthPeriod(2569, 10), now: NOW })
    const denseLocked = summarizeMonth({
      stats, rows: [], categoryCounts: Object.entries(spec).map(([category, total]) => ({ category, total })),
      labelOf: labelOfDense, tenantName, period: monthPeriod(2569, 9), now: NOW, lock: { publishedAt: '2026-10-02T01:30:00Z', revision: 12 },
    })
    for (const [name, summary] of [['สด', dense], ['ล็อก', denseLocked]]) {
      const page = await browser.newPage()
      try {
        await page.route('**/*', route => route.abort())
        await page.setContent(buildComplaintMonthlyHtml({ tenant: { name: tenantName }, summary, reportUrl: REPORT_URL }), { waitUntil: 'domcontentloaded' })
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
        assert.equal(pages, 1, `ใบหนาแน่น (${name}) พร้อม QR พิมพ์ได้ ${pages} แผ่น`)
        const box = await page.evaluate(() => {
          const svg = document.querySelector('.report svg').getBoundingClientRect()
          const sheet = document.querySelector('.sheet').getBoundingClientRect()
          return { w: svg.width, h: svg.height, right: svg.right, left: svg.left, sheetRight: sheet.right, sheetLeft: sheet.left, origin: document.querySelector('.report .origin').textContent }
        })
        const mm = px => px * 25.4 / 96
        assert.ok(Math.abs(mm(box.w) - 24) < 0.5 && Math.abs(mm(box.h) - 24) < 0.5, `QR ${mm(box.w).toFixed(1)}×${mm(box.h).toFixed(1)} มม.`)
        // ขอบซ้าย 3 ซม. ขอบขวา 2 ซม. (พื้นที่พิมพ์ 16 ซม.) — QR ต้องอยู่ในนั้น
        assert.ok(mm(box.left - box.sheetLeft) >= 30 - 0.5 && mm(box.sheetRight - box.right) >= 20 - 0.5, 'QR ล้นขอบกระดาษ')
        assert.ok(box.origin.includes('ข้อมูล ณ วันที่'), 'บรรทัดแหล่งที่มาต้องยังอยู่ท้ายใบ')
      } finally { await page.close() }
    }
  })

  // ใบของไตรมาส/สัปดาห์/วัน (เจ้าของระบบสั่ง 2569-10-29): หัวใบยาวกว่ารายเดือน — ไตรมาสปัจจุบัน (หมายเหตุครบ) หนาแน่นพร้อม QR
  // ต้องยังจบ 1 แผ่นเท่าเงื่อนไขของใบรายเดือนข้างบน
  await test('ใบของไตรมาส/สัปดาห์/วัน: จบ 1 แผ่น A4 เมื่อหนาแน่นพร้อม QR · หัวใบใช้ชื่อช่วงของตัวเอง', async () => {
    const { quarterPeriod, weekPeriod, dayPeriod, fiscalYearPeriod } = await import('../src/lib/complaintReportPeriods.js')
    const spec = Object.fromEntries([200, 150, 130, 120, 100, 90, 80, 70, 50, 35, 20].map((n, i) => [`c${i}`, n]))
    const tenantName = 'องค์การบริหารส่วนตำบลที่มีชื่อยาวพอสมควรมาก'
    const stats = { total: 1045, open: 40, in_progress: 100, resolved: 890, rejected: 15, avg_days: 12.5 }
    const labelOfDense = code => `หมวดเรื่องร้องเรียนที่ชื่อค่อนข้างยาว ${code}`
    for (const period of [quarterPeriod(2570, 1), weekPeriod('2025-12-29'), dayPeriod('2026-10-18'), fiscalYearPeriod(2570)]) {
      const summary = summarizeMonth({ stats, rows: rowsOf(spec), labelOf: labelOfDense, tenantName, period, now: NOW })
      const page = await browser.newPage()
      try {
        await page.route('**/*', route => route.abort())
        await page.setContent(buildComplaintMonthlyHtml({ tenant: { name: tenantName }, summary, reportUrl: REPORT_URL }), { waitUntil: 'domcontentloaded' })
        assert.equal(await page.locator('.title').innerText(), `สรุปเรื่องร้องเรียน/ร้องทุกข์ประจำ${period.label}`)
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
        assert.equal(pages, 1, `ใบ${period.label} พิมพ์ได้ ${pages} แผ่น`)
      } finally { await page.close() }
    }
  })

  // ใบสุดโต่งที่ไม่เกิดจริง (ชื่อหมวดทุกหมวด ~45 ตัวอักษร + ชื่อ อปท. 85 ตัวอักษร) พร้อม QR เกิน 1 แผ่นได้ — วัดแล้วเกินราว 5 มม.
  // ยอมให้ลงแผ่นที่ 2 ได้ไม่เกิน 2 แผ่น (ช่อง QR มี break-inside: avoid ไม่ถูกตัดครึ่ง) ห้ามบานเกินนั้น
  await test('ใบสุดโต่งที่ไม่เกิดจริง + QR: ไม่เกิน 2 แผ่น', async () => {
    const spec = Object.fromEntries([200, 150, 130, 120, 100, 90, 80, 70, 50, 35, 20].map((n, i) => [`c${i}`, n]))
    const tenantName = 'องค์การบริหารส่วนตำบลที่มีชื่อยาวมากพอสมควรสำหรับทดสอบการขึ้นบรรทัดใหม่ของข้อความ'
    const worst = summarizeMonth({
      stats: { total: 1045, open: 40, in_progress: 100, resolved: 890, rejected: 15, avg_days: 12.5 }, rows: rowsOf(spec),
      labelOf: code => `หมวดคำร้องเรื่องที่มีชื่อค่อนข้างยาวมาก ${code}`, tenantName, period: monthPeriod(2569, 10), now: NOW,
    })
    const page = await browser.newPage()
    try {
      await page.route('**/*', route => route.abort())
      await page.setContent(buildComplaintMonthlyHtml({ tenant: { name: tenantName }, summary: worst, reportUrl: REPORT_URL }), { waitUntil: 'domcontentloaded' })
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
      assert.ok(pages <= 2, `ใบสุดโต่งพร้อม QR พิมพ์ได้ ${pages} แผ่น`)
    } finally { await page.close() }
  })
} finally {
  await browser.close()
}

console.log(`\n${cases} cases passed`)
