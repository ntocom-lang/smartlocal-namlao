// ตรรกะคำนวณรายงานผลการก่อสร้างประจำสัปดาห์ (src/lib/constructionReport.js)
//   คำนวณล้วน ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต · เคสทองคำคือตัวเลขตัวอย่างในไฟล์ HTML ต้นฉบับที่เจ้าของระบบส่งมา
//   (6 รายการ สัดส่วน 15/15/15/30/15/10 → จริงถ่วงน้ำหนัก 8.40% · แผน 10.25% · ช้า 1.85 จุด)
import assert from 'node:assert/strict'

// ตั้งโซนเวลาเครื่องเป็นต่างประเทศ: ถ้าโค้ดอ่านวันจากเวลาเครื่องแทนปฏิทินล้วน เคสข้ามวัน/ข้ามปีด้านล่างจะพัง
process.env.TZ = 'America/Los_Angeles'
const C = await import('../src/lib/constructionReport.js')
const {
  MAX_PERIOD_DAYS, buildReportSheet, contractTiming, daysBetween, draftFromPrevious, effectiveEndDate, emptyFinance,
  fiscalYearOfIso, formatPct, freezeSheet, groupSeries, inclusiveDays, isIsoDate, nextReportDraft, periodDates,
  plannedPct, progressSeries, projectAccess, round2, scheduleLabel, validateItems, validatePeriod,
} = C

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// ── ข้อมูลทองคำจากต้นฉบับ ──────────────────────────────────────────────
const ITEMS = [
  { id: 'a', name: 'งานเตรียมพื้นที่และงานดินตัด/ถม', weight_pct: 15 },
  { id: 'b', name: 'งานชั้นรองพื้นทาง (Subbase)', weight_pct: 15 },
  { id: 'c', name: 'งานชั้นพื้นทาง (Base Course)', weight_pct: 15 },
  { id: 'd', name: 'งานผิวทางคอนกรีตเสริมเหล็ก (คสล.)', weight_pct: 30 },
  { id: 'e', name: 'งานผิวทางลาดยาง (Asphalt)', weight_pct: 15 },
  { id: 'f', name: 'งานไหล่ทาง รางระบายน้ำ และเครื่องหมายจราจร', weight_pct: 10 },
]
const CONTRACT = { start_date: '2026-08-01', end_date: '2026-11-28', extended_until: null } // 120 วัน
const GOLDEN_PROGRESS = {
  a: { base: 15, week: 0, plan: 15 },
  b: { base: 10, week: 5, plan: 15 },
  c: { base: 5, week: 5, plan: 12 },
  d: { base: 0, week: 8, plan: 10 },
  e: { base: 0, week: 0, plan: 5 },
  f: { base: 0, week: 0, plan: 2 },
}
const goldenReport = { week_no: 1, period_start: '2026-08-01', period_end: '2026-08-07', status: 'draft', progress: GOLDEN_PROGRESS }

test('เคสทองคำต้นฉบับ: จริง 8.40% · แผน 10.25% · ช้า 1.85 จุด', () => {
  const sheet = buildReportSheet({ items: ITEMS, reports: [goldenReport], report: goldenReport, contract: CONTRACT })
  assert.equal(sheet.overall.actual, 8.4)
  assert.equal(sheet.overall.plan, 10.25)
  assert.equal(sheet.overall.variance, -1.85)
  assert.deepEqual(sheet.overall.label, { key: 'behind', text: 'ช้า -1.9%' })
  assert.deepEqual(sheet.items.map(r => r.cum), [15, 15, 10, 8, 0, 0])
  assert.deepEqual(sheet.items.map(r => r.weighted), [2.25, 2.25, 1.5, 2.4, 0, 0])
  assert.deepEqual(sheet.items.map(r => r.weightedPlan), [2.25, 2.25, 1.8, 3, 0.75, 0.2])
  assert.deepEqual(sheet.items.map(r => r.variance), [0, 0, -2, -2, -5, -2])
  assert.deepEqual(sheet.items.map(r => r.label.key), ['on_track', 'on_track', 'behind', 'behind', 'behind', 'behind'])
  assert.equal(sheet.overall.week, 3.9, 'ผลงานในสัปดาห์ถ่วงน้ำหนัก = (15×5 + 15×5 + 30×8) ÷ 100')
  assert.equal(sheet.overall.prev, 4.5, 'ยอดก่อนหน้า (15×15 + 15×10 + 15×5) ÷ 100 — บวกกับสัปดาห์นี้ได้ 8.4')
  assert.ok(sheet.canFinalize, JSON.stringify(sheet.problems))
})

test('แผนตามเวลา (หน้า 1/6 ของต้นฉบับ): นับวันแรกด้วย · เกณฑ์ใกล้เคียง < 1 · ใช้วันสิ้นสุดช่วงรายงาน', () => {
  const sheet = buildReportSheet({ items: ITEMS, reports: [goldenReport], report: goldenReport, contract: CONTRACT })
  const t = sheet.timing
  assert.deepEqual([t.durationDays, t.elapsedDays, t.remainingDays, t.overdueDays], [120, 7, 113, 0])
  assert.equal(t.planPct, 5.83)
  assert.equal(t.remainingPct, 94.17)
  assert.equal(t.variance, 2.57)
  assert.deepEqual(t.label, { key: 'ahead', text: 'เร็ว +2.6%' })
})

test('ผลลัพธ์เป็น JSON ล้วน (เก็บลง frozen ได้ ไม่มี NaN/undefined) และ freezeSheet ตัด problems ออก', () => {
  const sheet = buildReportSheet({ items: ITEMS, reports: [goldenReport], report: goldenReport, contract: CONTRACT })
  assert.deepEqual(JSON.parse(JSON.stringify(sheet)), sheet)
  const frozen = freezeSheet(sheet)
  assert.equal(frozen.version, 1)
  assert.ok(!('problems' in frozen) && !('canFinalize' in frozen))
  assert.deepEqual(frozen.items, sheet.items)
})

// ── ยกยอดสะสม ──────────────────────────────────────────────────────────
test('ยอดก่อนหน้ารวมจากสัปดาห์ก่อนๆ เอง · ฉบับที่ยังไม่บันทึกคำนวณได้ · ลำดับใน array ไม่สำคัญ', () => {
  const w1 = { week_no: 1, period_start: '2026-10-01', period_end: '2026-10-07', progress: { a: { base: 10, week: 5 }, b: { week: 2 } } }
  const w2 = { week_no: 2, period_start: '2026-10-08', period_end: '2026-10-14', progress: { a: { week: 5 }, b: { week: 3 } } }
  const w3 = { week_no: 3, period_start: '2026-10-15', period_end: '2026-10-21', progress: { a: { week: 1 } } }
  const items = [{ id: 'a', name: 'ก', weight_pct: 50 }, { id: 'b', name: 'ข', weight_pct: 50 }]
  const withoutPlan = { items, contract: CONTRACT }
  const s2 = buildReportSheet({ ...withoutPlan, reports: [w3, w1, w2], report: w2 })
  assert.deepEqual(s2.items.map(r => [r.prev, r.week, r.cum]), [[15, 5, 20], [2, 3, 5]])
  const s3 = buildReportSheet({ ...withoutPlan, reports: [w1, w2], report: w3 }) // w3 ยังไม่อยู่ใน reports (ร่างใหม่)
  assert.deepEqual(s3.items.map(r => [r.prev, r.week, r.cum]), [[20, 1, 21], [5, 0, 5]])
  assert.equal(s3.overall.actual, 13, '(21×50 + 5×50) ÷ 100')
})

test('ยอดตั้งต้น base มีผลเฉพาะสัปดาห์แรกสุด — ใส่ในสัปดาห์หลังไม่ทำให้ยอดเบิ้ล', () => {
  const items = [{ id: 'a', name: 'ก', weight_pct: 100 }]
  const w1 = { week_no: 4, period_start: '2026-10-01', period_end: '2026-10-07', progress: { a: { base: 40, week: 10 } } }
  const w2 = { week_no: 5, period_start: '2026-10-08', period_end: '2026-10-14', progress: { a: { base: 99, week: 10 } } }
  const s = buildReportSheet({ items, reports: [w1, w2], report: w2, contract: CONTRACT })
  assert.deepEqual([s.items[0].prev, s.items[0].cum], [50, 60])
})

test('สะสมเกิน 100 = ผิด ล็อกไม่ได้ · ยอดรวมถ่วงน้ำหนักไม่ทะลุ 100', () => {
  const items = [{ id: 'a', name: 'ก', weight_pct: 60 }, { id: 'b', name: 'ข', weight_pct: 40 }]
  const w1 = { week_no: 1, period_start: '2026-10-01', period_end: '2026-10-07', progress: { a: { base: 95, week: 10 }, b: { base: 100 } } }
  const s = buildReportSheet({ items, reports: [w1], report: w1, contract: CONTRACT })
  assert.ok(s.problems.some(p => p.code === 'over_100' && p.itemId === 'a'))
  assert.equal(s.canFinalize, false)
  assert.equal(s.items[0].cum, 105)
  assert.equal(s.overall.actual, 100)
})

test('ผลงานในสัปดาห์ติดลบ = ผิด', () => {
  const items = [{ id: 'a', name: 'ก', weight_pct: 100 }]
  const w1 = { week_no: 1, period_start: '2026-10-01', period_end: '2026-10-07', progress: { a: { week: -3 } } }
  const s = buildReportSheet({ items, reports: [w1], report: w1, contract: CONTRACT })
  assert.ok(s.problems.some(p => p.code === 'negative_week'))
  assert.equal(s.items[0].week, 0)
  assert.equal(s.canFinalize, false)
})

test('ค่าตัวเลขจากคอลัมน์ numeric ที่มาเป็นสตริงใช้ได้', () => {
  const items = [{ id: 'a', name: 'ก', weight_pct: '100.000', plan_start: '2026-10-01', plan_end: '2026-10-10' }]
  const w1 = { week_no: 1, period_start: '2026-10-01', period_end: '2026-10-05', progress: { a: { week: '25.5', plan: '' } } }
  const s = buildReportSheet({ items, reports: [w1], report: w1, contract: CONTRACT })
  assert.equal(s.items[0].cum, 25.5)
  assert.equal(s.items[0].plan, 50, 'plan ว่าง = ไม่ได้แก้ทับ → เชิงเส้น')
  assert.equal(s.items[0].planSource, 'linear')
})

// ── แผนเชิงเส้น ────────────────────────────────────────────────────────
test('แผนเชิงเส้นจากวัน เริ่ม–สิ้นสุดของรายการ (นับวันแรกด้วย) · ก่อนเริ่ม 0 · หลังสิ้นสุด 100', () => {
  const item = { plan_start: '2026-10-01', plan_end: '2026-10-10' }
  assert.equal(plannedPct(item, '2026-09-30'), 0)
  assert.equal(plannedPct(item, '2026-10-01'), 10)
  assert.equal(plannedPct(item, '2026-10-05'), 50)
  assert.equal(plannedPct(item, '2026-10-09'), 90)
  assert.equal(plannedPct(item, '2026-10-10'), 100)
  assert.equal(plannedPct(item, '2026-12-31'), 100)
})

test('แผนที่แก้ทับชนะเชิงเส้น (0 ก็นับว่ากรอก) · เกินช่วงถูกตัดที่ 0–100 · ไม่รู้แผน = null ไม่ใช่ 0', () => {
  const item = { plan_start: '2026-10-01', plan_end: '2026-10-10' }
  assert.equal(plannedPct(item, '2026-10-05', 0), 0)
  assert.equal(plannedPct(item, '2026-10-05', '25'), 25)
  assert.equal(plannedPct(item, '2026-10-05', 150), 100)
  assert.equal(plannedPct(item, '2026-10-05', -5), 0)
  assert.equal(plannedPct(item, '2026-10-05', null), 50)
  assert.equal(plannedPct({}, '2026-10-05'), null)
  assert.equal(plannedPct({ plan_start: '2026-10-10', plan_end: '2026-10-01' }, '2026-10-05'), null)
  assert.equal(plannedPct(item, 'not-a-date'), null)
  assert.equal(plannedPct({ plan_start: '2026-02-30', plan_end: '2026-03-10' }, '2026-03-01'), null, '30 ก.พ. ไม่มีจริง')
})

test('ถ้ามีรายการไม่ได้ตั้งแผน แผนรวม/เร็วช้ารวมเป็น null (ไม่ปัดเป็น 0 แล้วโชว์ว่าเร็ว)', () => {
  const items = [
    { id: 'a', name: 'ก', weight_pct: 50, plan_start: '2026-10-01', plan_end: '2026-10-10' },
    { id: 'b', name: 'ข', weight_pct: 50 },
  ]
  const w1 = { week_no: 1, period_start: '2026-10-01', period_end: '2026-10-07', progress: { a: { week: 10 }, b: { week: 10 } } }
  const s = buildReportSheet({ items, reports: [w1], report: w1, contract: CONTRACT })
  assert.equal(s.items[0].plan, 70)
  assert.equal(s.items[1].plan, null)
  assert.equal(s.overall.plan, null)
  assert.deepEqual(s.overall.label, { key: 'unknown', text: '—' })
  assert.ok(s.problems.some(p => p.code === 'no_plan' && p.level === 'info'))
  assert.ok(s.canFinalize, 'ไม่ได้ตั้งแผนไม่ขวางการล็อก — แค่เทียบเร็ว/ช้าไม่ได้')
})

// ── เวลาตามสัญญา ───────────────────────────────────────────────────────
test('วันคงเหลือนับ ณ วันสิ้นสุดช่วงรายงาน ไม่ใช่วันนี้ (พิมพ์ย้อนหลังได้เลขเดิม) · เกินกำหนดติดลบ', () => {
  const c = { start_date: '2026-10-01', end_date: '2026-10-10' }
  assert.deepEqual(
    (({ durationDays, elapsedDays, remainingDays, remainingPct, timePlanPct }) => [durationDays, elapsedDays, remainingDays, remainingPct, timePlanPct])(contractTiming(c, '2026-10-04')),
    [10, 4, 6, 60, 40],
  )
  assert.deepEqual(contractTiming(c, '2026-10-04'), contractTiming(c, '2026-10-04'), 'ฟังก์ชันล้วน ไม่แตะนาฬิกา')
  const last = contractTiming(c, '2026-10-10')
  assert.deepEqual([last.remainingDays, last.overdueDays, last.elapsedDays, last.timePlanPct], [0, 0, 10, 100])
  const late = contractTiming(c, '2026-10-12')
  assert.deepEqual([late.remainingDays, late.overdueDays, late.elapsedDays, late.timePlanPct, late.remainingPct], [-2, 2, 10, 100, 0])
  const early = contractTiming(c, '2026-09-28')
  assert.deepEqual([early.elapsedDays, early.timePlanPct, early.remainingPct], [0, 0, 100])
})

test('ต่อสัญญา: ใช้วันที่ต่อถึงเมื่อเลยวันสิ้นสุดเดิมเท่านั้น · ข้อมูลขาด/ผิด = null', () => {
  assert.equal(effectiveEndDate({ end_date: '2026-10-10', extended_until: '2026-10-20' }), '2026-10-20')
  assert.equal(effectiveEndDate({ end_date: '2026-10-10', extended_until: '2026-10-05' }), '2026-10-10')
  assert.equal(effectiveEndDate({ extended_until: '2026-10-20' }), '2026-10-20')
  assert.equal(effectiveEndDate({}), null)
  assert.equal(contractTiming({ start_date: '2026-10-01', end_date: '2026-10-10', extended_until: '2026-10-20' }, '2026-10-12').remainingDays, 8)
  assert.equal(contractTiming({ start_date: '2026-10-10', end_date: '2026-10-01' }, '2026-10-05'), null)
  assert.equal(contractTiming({ end_date: '2026-10-10' }, '2026-10-05'), null)
  assert.equal(contractTiming({ start_date: '2026-10-01', end_date: '2026-10-10' }, ''), null)
})

test('ไม่มีวันสัญญา → sheet ยังคำนวณผลงานได้ timing เป็น null + แจ้งแบบ info (ไม่ขวางล็อก)', () => {
  const s = buildReportSheet({ items: ITEMS, reports: [goldenReport], report: goldenReport, contract: {} })
  assert.equal(s.timing, null)
  assert.equal(s.overall.actual, 8.4)
  assert.ok(s.problems.some(p => p.code === 'no_contract_dates' && p.level === 'info'))
  assert.ok(s.canFinalize)
})

// ── วันที่ ─────────────────────────────────────────────────────────────
test('วันที่ล้วนไม่พึ่งโซนเวลาเครื่อง (ตั้ง TZ ลอสแอนเจลิส) · ปีอธิกสุรทิน · วันที่ไม่มีจริง', () => {
  assert.equal(isIsoDate('2028-02-29'), true)
  assert.equal(isIsoDate('2027-02-29'), false)
  assert.equal(isIsoDate('2026-04-31'), false)
  assert.equal(isIsoDate('1 ส.ค. 2569'), false, 'ข้อความไทยอิสระไม่ใช่วันที่ — ต้นฉบับเคยอ่านเป็นมกราคมเงียบๆ')
  assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1)
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1)
  assert.equal(inclusiveDays('2026-10-01', '2026-10-07'), 7)
  assert.equal(daysBetween('2026-10-05', '2026-10-01'), -4)
  assert.equal(daysBetween('x', '2026-10-01'), null)
  assert.deepEqual(periodDates('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  assert.deepEqual(periodDates('2026-11-02', '2026-10-30'), [])
  assert.equal(periodDates('2020-01-01', '2030-01-01').length, 370, 'เพดานกันลูปบาน')
})

test('ปีงบประมาณ (พ.ศ.) จากวันที่ ISO: 1 ต.ค. เริ่มปีงบใหม่', () => {
  assert.equal(fiscalYearOfIso('2026-09-30'), 2569)
  assert.equal(fiscalYearOfIso('2026-10-01'), 2570)
  assert.equal(fiscalYearOfIso('2027-01-15'), 2570)
  assert.equal(fiscalYearOfIso('nope'), null)
})

// ── ช่วงรายงาน ─────────────────────────────────────────────────────────
test('สัปดาห์ถัดไปต่อจากฉบับล่าสุด: ข้ามเดือน/ปี/29 ก.พ. · ฉบับแรกเริ่มวันเริ่มสัญญา', () => {
  assert.deepEqual(nextReportDraft({ reports: [], contract: { start_date: '2026-10-26' } }),
    { week_no: 1, period_start: '2026-10-26', period_end: '2026-11-01' })
  assert.deepEqual(nextReportDraft({ reports: [], contract: {} }), { week_no: 1, period_start: null, period_end: null })
  const reports = [
    { week_no: 2, period_start: '2026-12-25', period_end: '2026-12-31' },
    { week_no: 1, period_start: '2026-12-18', period_end: '2026-12-24' },
  ]
  assert.deepEqual(nextReportDraft({ reports }), { week_no: 3, period_start: '2027-01-01', period_end: '2027-01-07' })
  assert.deepEqual(nextReportDraft({ reports: [{ week_no: 7, period_start: '2028-02-22', period_end: '2028-02-28' }] }),
    { week_no: 8, period_start: '2028-02-29', period_end: '2028-03-06' })
})

test('ตรวจช่วงรายงาน: ข้ามวัน/ซ้อนทับ/ยาวเกิน/กลับด้าน/ว่าง/เลขสัปดาห์', () => {
  const prev = { week_no: 1, period_start: '2026-10-01', period_end: '2026-10-07' }
  const codes = report => validatePeriod({ reports: [prev], report }).map(p => p.code)
  assert.deepEqual(codes({ week_no: 2, period_start: '2026-10-08', period_end: '2026-10-14' }), [])
  assert.deepEqual(codes({ week_no: 2, period_start: '2026-10-08', period_end: '2026-10-10' }), [], 'สัปดาห์สุดท้ายสั้นกว่า 7 วันได้')
  assert.deepEqual(codes({ week_no: 2, period_start: '2026-10-09', period_end: '2026-10-15' }), ['period_gap'])
  assert.deepEqual(codes({ week_no: 2, period_start: '2026-10-07', period_end: '2026-10-13' }), ['period_overlap'])
  assert.deepEqual(codes({ week_no: 2, period_start: '2026-10-08', period_end: '2026-10-15' }), ['period_too_long'])
  assert.deepEqual(codes({ week_no: 2, period_start: '2026-10-14', period_end: '2026-10-08' }), ['period_order'])
  assert.deepEqual(codes({ week_no: 2, period_start: null, period_end: null }), ['period_invalid'])
  assert.deepEqual(codes({ week_no: 0, period_start: '2026-10-08', period_end: '2026-10-14' }), ['week_no'])
  assert.equal(MAX_PERIOD_DAYS, 7)
  const gap = validatePeriod({ reports: [prev], report: { week_no: 2, period_start: '2026-10-09', period_end: '2026-10-15' } })[0]
  assert.match(gap.message, /8 ต\.ค\. 2569/)
})

test('ช่วงรายงานผิดทำให้ล็อกไม่ได้ (canFinalize = false)', () => {
  const prev = { week_no: 1, period_start: '2026-10-01', period_end: '2026-10-07', progress: {} }
  const bad = { week_no: 2, period_start: '2026-10-10', period_end: '2026-10-16', progress: {} }
  const items = [{ id: 'a', name: 'ก', weight_pct: 100 }]
  assert.equal(buildReportSheet({ items, reports: [prev], report: bad, contract: CONTRACT }).canFinalize, false)
})

// ── ตรวจรายการงาน ──────────────────────────────────────────────────────
test('ตรวจรายการงาน: สัดส่วนรวม 100 (เผื่อทศนิยมปัดเศษ) · ชื่อ · ช่วงแผน', () => {
  const ok = [{ id: 1, name: 'ก', weight_pct: 33.33 }, { id: 2, name: 'ข', weight_pct: 33.33 }, { id: 3, name: 'ค', weight_pct: 33.34 }]
  assert.deepEqual(validateItems(ok).filter(p => p.level === 'error'), [])
  const near = [{ id: 1, name: 'ก', weight_pct: 50 }, { id: 2, name: 'ข', weight_pct: 49.97 }]
  assert.deepEqual(validateItems(near).filter(p => p.level === 'error'), [], 'ผลรวม 99.97 อยู่ในเกณฑ์ปัดเศษ')
  const short = [{ id: 1, name: 'ก', weight_pct: 50 }, { id: 2, name: 'ข', weight_pct: 49.9 }]
  assert.deepEqual(validateItems(short).map(p => p.code), ['weight_sum', 'no_plan'])
  assert.match(validateItems(short)[0].message, /99\.9%/)
  assert.deepEqual(validateItems([]).map(p => p.code), ['no_items'])
  const bad = [
    { id: 1, name: '', weight_pct: 60 },
    { id: 2, name: 'ข', weight_pct: -5 },
    { id: 3, name: 'ค', weight_pct: 45, plan_start: '2026-10-10', plan_end: '2026-10-01' },
  ]
  const codes = validateItems(bad).map(p => p.code)
  for (const code of ['item_name', 'item_weight', 'plan_range']) assert.ok(codes.includes(code), code)
})

// ── ร่างสัปดาห์ใหม่ + ภาพรวม ───────────────────────────────────────────
test('ร่างสัปดาห์ใหม่คัดลอกเฉพาะชื่อแถวกำลังคน/เครื่องจักร + ยอดงวด · ไม่เดาอากาศ/ผลงาน/ปัญหา', () => {
  const prev = {
    memo_to: 'หัวหน้ากองช่าง',
    crew: [{ name: 'โฟร์แมน', days: [2, 2, 2, 2, 2, 2, 0] }],
    machinery: [{ name: 'รถบดถนน (Road Roller)', days: [1, 1, 1, 1, 1, 1, 0] }],
    weather: { '2026-10-01': ['clear'] },
    daily_log: [{ date: '2026-10-01', detail: 'เทคอนกรีต', note: '-' }],
    issues: { problems: 'ฝนตก', solution: 'เลื่อนงาน', other: '' },
    progress: { a: { week: 5 } },
    finance: { advance_amount: 100000, advance_pct: 15, budget_rows: [{ year: '2570', installments_total: 4 }] },
  }
  const draft = draftFromPrevious(prev, { period_start: '2026-10-08', period_end: '2026-10-14' })
  assert.deepEqual(draft.crew, [{ name: 'โฟร์แมน', days: [0, 0, 0, 0, 0, 0, 0] }])
  assert.deepEqual(draft.machinery[0].days.length, 7)
  assert.deepEqual([draft.weather, draft.daily_log, draft.progress], [{}, [], {}])
  assert.deepEqual(draft.issues, { problems: '', solution: '', other: '' })
  assert.equal(draft.memo_to, 'หัวหน้ากองช่าง')
  assert.deepEqual(draft.finance, prev.finance)
  draft.finance.budget_rows[0].year = 'แก้'
  assert.equal(prev.finance.budget_rows[0].year, '2570', 'คัดลอกลึก ไม่แก้ต้นทาง')
  assert.deepEqual(draftFromPrevious(null, { period_start: '2026-10-08', period_end: '2026-10-10' }).finance, emptyFinance())
  assert.equal(draftFromPrevious({ crew: [{ name: 'ก' }] }, { period_start: '2026-10-08', period_end: '2026-10-10' }).crew[0].days.length, 3, 'ช่วงสั้นกว่า 7 วัน')
})

test('กราฟ/สรุป: ฉบับที่ล็อกแล้วใช้ตัวเลขแช่แข็ง ไม่คำนวณใหม่ · รวมรายเดือน/ปีงบ', () => {
  const items = [{ id: 'a', name: 'ก', weight_pct: 100, plan_start: '2026-09-01', plan_end: '2026-11-30' }]
  const w1 = { week_no: 1, status: 'final', period_start: '2026-09-24', period_end: '2026-09-30', progress: { a: { week: 10 } } }
  w1.frozen = freezeSheet(buildReportSheet({ items, reports: [w1], report: w1, contract: CONTRACT }))
  const w2 = { week_no: 2, status: 'final', period_start: '2026-10-01', period_end: '2026-10-07', progress: { a: { week: 10 } } }
  w2.frozen = freezeSheet(buildReportSheet({ items, reports: [w1, w2], report: w2, contract: CONTRACT }))
  const w3 = { week_no: 3, status: 'draft', period_start: '2026-10-08', period_end: '2026-10-14', progress: { a: { week: 5 } } }
  w1.progress.a.week = 99 // แก้ข้อมูลดิบหลังล็อก (ทำไม่ได้จริงเพราะ trigger) — ตัวเลขที่พิมพ์ต้องไม่ขยับ
  const series = progressSeries({ items, reports: [w3, w1, w2], contract: CONTRACT })
  // ฉบับที่ล็อกแล้วยังเป็น 10 และ 20 แม้ข้อมูลดิบถูกแก้เป็น 99 · ร่างฉบับที่ 3 คำนวณสดจากข้อมูลดิบ (99+10+5 ทะลุ 100 → ตัดที่ 100)
  assert.deepEqual(series.map(p => [p.week_no, p.actual, p.week, p.status]), [[1, 10, 10, 'final'], [2, 20, 10, 'final'], [3, 100, 5, 'draft']])
  const byMonth = groupSeries(series, 'month')
  assert.deepEqual(byMonth.map(g => [g.key, g.weeks]), [['2026-09', 1], ['2026-10', 2]])
  assert.equal(byMonth[1].endActual, series[2].actual)
  const byFiscal = groupSeries(series, 'fiscal')
  assert.deepEqual(byFiscal.map(g => [g.key, g.weeks, g.from, g.to]), [[2569, 1, '2026-09-24', '2026-09-30'], [2570, 2, '2026-10-01', '2026-10-14']])
  assert.equal(byFiscal[1].gained, 15)
})

test('ป้ายเร็ว/ช้า + รูปแบบตัวเลข', () => {
  assert.deepEqual(scheduleLabel(0.49), { key: 'on_track', text: 'ตามแผน' })
  assert.deepEqual(scheduleLabel(-0.49), { key: 'on_track', text: 'ตามแผน' })
  assert.deepEqual(scheduleLabel(0.5), { key: 'ahead', text: 'เร็ว +0.5%' })
  assert.deepEqual(scheduleLabel(-0.5), { key: 'behind', text: 'ช้า -0.5%' })
  assert.deepEqual(scheduleLabel(0.9, 1), { key: 'on_track', text: 'ตามแผน' })
  assert.deepEqual(scheduleLabel(null), { key: 'unknown', text: '—' })
  assert.deepEqual(scheduleLabel(Number.NaN), { key: 'unknown', text: '—' })
  assert.equal(formatPct(8.4), '8.40%')
  assert.equal(formatPct(null), '—')
  assert.equal(formatPct('abc'), '—')
  assert.equal(round2(8.399999999999999), 8.4)
})

test('สิทธิ์ฝั่งหน้าจอ ตรงกับ policy: ผู้จัดการ · คนกองเดียวกัน · ผู้สร้าง · ผู้ควบคุมงานที่ถูกระบุ · คนอื่น', () => {
  const project = { id: 'p', department_id: 'D1', created_by: 'creator' }
  const access = (role, extra = {}) => projectAccess({ role, project, userId: 'someone', departmentId: null, ...extra })
  const all = { read: true, write: true, manage: true, editBase: true }
  const none = { read: false, write: false, manage: false, editBase: false }
  assert.deepEqual(access('superadmin'), all)
  assert.deepEqual(access('admin'), all)
  assert.deepEqual(access('officer', { departmentId: 'D1' }), all)
  assert.deepEqual(access('officer', { departmentId: 'D2' }), none)
  assert.deepEqual(access('officer', { departmentId: null }), none, 'หัวหน้าที่ไม่มีกองไม่เห็น')
  assert.deepEqual(access('staff', { departmentId: 'D1' }), { read: true, write: false, manage: false, editBase: false })
  assert.deepEqual(access('technician', { userId: 'creator', departmentId: 'D2' }), { read: true, write: true, manage: false, editBase: true })
  assert.deepEqual(access('technician', { departmentId: 'D2', listed: { any: true, supervisor: true } }), { read: true, write: true, manage: false, editBase: false })
  assert.deepEqual(access('technician', { departmentId: 'D2', listed: { any: true, supervisor: false } }), { read: true, write: false, manage: false, editBase: false })
  assert.deepEqual(access('technician', { departmentId: 'D2' }), none)
  const readOnly = { read: true, write: false, manage: false, editBase: false }
  assert.deepEqual(access('viewer', { departmentId: 'D2' }), readOnly, 'viewer อ่านได้ทุกโครงการของ อปท. อ่านอย่างเดียว (RLS ให้อ่านทั้ง อปท.)')
  assert.deepEqual(access('viewer', { departmentId: null, userId: 'creator' }), readOnly, 'viewer ไม่ได้สิทธิ์เขียนแม้เป็นผู้สร้าง')
  for (const role of ['council', 'citizen', undefined]) assert.deepEqual(access(role, { departmentId: 'D1' }), none, String(role))
  assert.deepEqual(projectAccess({ role: 'admin', project: null }), none)
  assert.deepEqual(projectAccess({ role: 'staff', project: { department_id: null, created_by: null }, departmentId: null, userId: null }), none, 'กอง/ผู้สร้างเป็น null ต้องไม่ตรงกับ null ของผู้ใช้')
})

console.log(`\n${cases} cases passed`)
