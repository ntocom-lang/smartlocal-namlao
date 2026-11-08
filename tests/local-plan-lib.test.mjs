// ตรรกะปฏิทินปีงบ + กำหนดเวลาตามระเบียบของเมนู "แผนพัฒนาท้องถิ่น" (src/lib/localPlanCalendar.js, localPlanDeadlines.js)
// คำนวณล้วน ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/local-plan-lib.test.mjs
// ตั้งโซนเวลาเครื่องเป็นต่างประเทศก่อน import — โค้ดที่เผลออ่านวันจากนาฬิกา/โซนเครื่องจะเพี้ยนให้เห็น
import assert from 'node:assert/strict'

process.env.TZ = 'America/Los_Angeles'
const C = await import('../src/lib/localPlanCalendar.js')
const D = await import('../src/lib/localPlanDeadlines.js')
const { addDays } = await import('../src/lib/complaintReportPeriods.js')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// วันในสัปดาห์ของ 'YYYY-MM-DD' (0 = อาทิตย์) คำนวณบน UTC — ใช้ยืนยันว่าตัวอย่างที่เลือกตรงเสาร์/อาทิตย์จริง
const weekday = iso => new Date(`${iso}T00:00:00Z`).getUTCDay()

// ── ปฏิทินปีงบ ─────────────────────────────────────────────────────────────

test('fiscalMonthToCalendar: เดือนที่ 1/3/4/12 ↔ เดือนปฏิทิน+ปี', () => {
  // ปีงบ 2569 = ต.ค. 2568 (ค.ศ. 2025) – ก.ย. 2569 (ค.ศ. 2026)
  assert.deepEqual(C.fiscalMonthToCalendar(1, 2569), { month: 10, yearCE: 2025, yearBE: 2568 })
  assert.deepEqual(C.fiscalMonthToCalendar(3, 2569), { month: 12, yearCE: 2025, yearBE: 2568 })
  assert.deepEqual(C.fiscalMonthToCalendar(4, 2569), { month: 1, yearCE: 2026, yearBE: 2569 })
  assert.deepEqual(C.fiscalMonthToCalendar(12, 2569), { month: 9, yearCE: 2026, yearBE: 2569 })
  assert.equal(C.fiscalMonthToCalendar(0, 2569), null)
  assert.equal(C.fiscalMonthToCalendar(13, 2569), null)
  assert.equal(C.fiscalMonthToCalendar(1.5, 2569), null)
})

test('calendarToFiscalMonth: กลับทางได้ครบ 12 เดือน (round trip)', () => {
  assert.equal(C.calendarToFiscalMonth(10), 1)
  assert.equal(C.calendarToFiscalMonth(12), 3)
  assert.equal(C.calendarToFiscalMonth(1), 4)
  assert.equal(C.calendarToFiscalMonth(9), 12)
  for (let fm = 1; fm <= 12; fm++) assert.equal(C.calendarToFiscalMonth(C.fiscalMonthToCalendar(fm, 2570).month), fm)
  assert.equal(C.calendarToFiscalMonth(0), null)
  assert.equal(C.calendarToFiscalMonth(13), null)
})

test('fiscalMonthRange: วันแรกเดือนต้น – วันสุดท้ายเดือนปลาย รวมข้ามปี', () => {
  assert.deepEqual(C.fiscalMonthRange(2569, 1, 3), { from: '2025-10-01', to: '2025-12-31' })
  assert.deepEqual(C.fiscalMonthRange(2569, 1, 12), { from: '2025-10-01', to: '2026-09-30' })
  assert.deepEqual(C.fiscalMonthRange(2569, 3, 4), { from: '2025-12-01', to: '2026-01-31' })
  assert.deepEqual(C.fiscalMonthRange(2569, 6, 6), { from: '2026-03-01', to: '2026-03-31' })
  assert.equal(C.fiscalMonthRange(2569, 0, 3), null)
})

test('fiscalMonthRange: ก.พ. ปีธรรมดา 28 วัน / ปีอธิกสุรทิน 29 วัน (ปีงบ 2571 → ก.พ. 2028)', () => {
  assert.equal(C.fiscalMonthRange(2569, 5, 5).to, '2026-02-28')
  assert.deepEqual(C.fiscalMonthRange(2571, 5, 5), { from: '2028-02-01', to: '2028-02-29' })
  assert.equal(C.fiscalMonthRange(2572, 5, 5).to, '2029-02-28')
})

test('ไตรมาส: quarterOfFiscalMonth / quartersOfSpan', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(C.quarterOfFiscalMonth), [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4])
  assert.equal(C.quarterOfFiscalMonth(0), null)
  assert.deepEqual(C.quartersOfSpan(1, 3), [1])
  assert.deepEqual(C.quartersOfSpan(3, 4), [1, 2])
  assert.deepEqual(C.quartersOfSpan(1, 12), [1, 2, 3, 4])
  assert.deepEqual(C.quartersOfSpan(5, 5), [2])
  assert.deepEqual(C.quartersOfSpan(null, null), [])
  assert.deepEqual(C.quartersOfSpan(5, 2), [])
})

test('fiscalMonthLabel / spanLabel', () => {
  assert.equal(C.fiscalMonthLabel(1), 'ต.ค.')
  assert.equal(C.fiscalMonthLabel(12), 'ก.ย.')
  assert.equal(C.fiscalMonthLabel(13), '')
  assert.equal(C.spanLabel(1, 3), 'ต.ค.–ธ.ค.')
  assert.equal(C.spanLabel(4, 4), 'ม.ค.')
  assert.equal(C.spanLabel(1, 12), 'ต.ค.–ก.ย.')
  assert.equal(C.spanLabel(null, null), '')
  assert.equal(C.spanLabel(undefined, undefined), '')
  assert.equal(C.spanLabel(5, 2), '')
})

test('validateSpan: กติกาเดียวกับ CHECK local_op_plan_items_month_range', () => {
  assert.equal(C.validateSpan(null, null), null)
  assert.equal(C.validateSpan(undefined, undefined), null)
  assert.equal(C.validateSpan(1, 12), null)
  assert.equal(C.validateSpan(5, 5), null)
  assert.equal(C.validateSpan('3', '4'), null)
  assert.match(C.validateSpan(1, null), /ทั้งคู่/)
  assert.match(C.validateSpan(null, 6), /ทั้งคู่/)
  assert.match(C.validateSpan(0, 3), /1–12/)
  assert.match(C.validateSpan(1, 13), /1–12/)
  assert.match(C.validateSpan(1.5, 3), /1–12/)
  assert.match(C.validateSpan(6, 5), /ไม่ก่อน/)
})

// ── parseMonthSpan ─────────────────────────────────────────────────────────

test('parseMonthSpan: ย่อ+ปี 2 หลัก ต.ค.68–มี.ค.69 (ปีงบ 2569 ไม่มี warning)', () => {
  assert.deepEqual(C.parseMonthSpan('ต.ค.68–มี.ค.69', { fiscalYearBE: 2569 }), { from: 1, to: 6 })
  assert.deepEqual(C.parseMonthSpan('ต.ค.68–มี.ค.69'), { from: 1, to: 6 })
})

test('parseMonthSpan: ย่อ ไม่มีปี + ขีดมีช่องว่าง/ไม่มีจุด', () => {
  assert.deepEqual(C.parseMonthSpan('ต.ค. - ธ.ค.'), { from: 1, to: 3 })
  assert.deepEqual(C.parseMonthSpan('ตค-ธค'), { from: 1, to: 3 })
  assert.deepEqual(C.parseMonthSpan('  ม.ค.   –   มี.ค.  '), { from: 4, to: 6 })
  assert.deepEqual(C.parseMonthSpan('ก.ค.-ก.ย.'), { from: 10, to: 12 })
})

test('parseMonthSpan: ชื่อเต็ม + ปี พ.ศ. 4 หลัก + ปี ค.ศ.', () => {
  assert.deepEqual(C.parseMonthSpan('ตุลาคม 2568 - กันยายน 2569', { fiscalYearBE: 2569 }), { from: 1, to: 12 })
  assert.deepEqual(C.parseMonthSpan('ตุลาคม 2025 - กันยายน 2026', { fiscalYearBE: 2569 }), { from: 1, to: 12 })
  assert.deepEqual(C.parseMonthSpan('พฤศจิกายน – กุมภาพันธ์'), { from: 2, to: 5 })
  assert.deepEqual(C.parseMonthSpan('กรกฏาคม'), { from: 10, to: 10 }) // สะกด ฏ ที่พบบ่อย
})

test('parseMonthSpan: เดือนเดียว', () => {
  assert.deepEqual(C.parseMonthSpan('ต.ค.'), { from: 1, to: 1 })
  assert.deepEqual(C.parseMonthSpan('สิงหาคม'), { from: 11, to: 11 })
})

test('parseMonthSpan: ไตรมาสทุกรูปแบบ (ไทย/อารบิก/เลขไทย/Q)', () => {
  assert.deepEqual(C.parseMonthSpan('ไตรมาส 1'), { from: 1, to: 3 })
  assert.deepEqual(C.parseMonthSpan('ไตรมาสที่ 4'), { from: 10, to: 12 })
  assert.deepEqual(C.parseMonthSpan('ไตรมาส 1-2'), { from: 1, to: 6 })
  assert.deepEqual(C.parseMonthSpan('ไตรมาส 1 ถึง ไตรมาส 3'), { from: 1, to: 9 })
  assert.deepEqual(C.parseMonthSpan('ไตรมาส ๒'), { from: 4, to: 6 })
  assert.deepEqual(C.parseMonthSpan('ไตรมาส ๑–๔'), { from: 1, to: 12 })
  assert.deepEqual(C.parseMonthSpan('Q1-Q2'), { from: 1, to: 6 })
  assert.deepEqual(C.parseMonthSpan('q3'), { from: 7, to: 9 })
})

test('parseMonthSpan: เลขไทย + ขีดหลายแบบ + "ถึง"', () => {
  assert.deepEqual(C.parseMonthSpan('ต.ค.๖๘ – มี.ค.๖๙', { fiscalYearBE: 2569 }), { from: 1, to: 6 })
  assert.deepEqual(C.parseMonthSpan('ต.ค.—ธ.ค.'), { from: 1, to: 3 })
  assert.deepEqual(C.parseMonthSpan('ต.ค.−ธ.ค.'), { from: 1, to: 3 }) // minus sign U+2212
  assert.deepEqual(C.parseMonthSpan('ต.ค. ถึง ธ.ค.'), { from: 1, to: 3 })
  assert.deepEqual(C.parseMonthSpan('ตุลาคม ถึง มีนาคม'), { from: 1, to: 6 })
  assert.deepEqual(C.parseMonthSpan('ตุลาคม จนถึง ธันวาคม'), { from: 1, to: 3 })
})

test('parseMonthSpan: ปีกำกับอยู่นอกปีงบที่ส่งมา → คืนช่วง + warning', () => {
  const r = C.parseMonthSpan('ต.ค.67–มี.ค.68', { fiscalYearBE: 2569 })
  assert.equal(r.from, 1)
  assert.equal(r.to, 6)
  assert.match(r.warning, /ไม่อยู่ในปีงบประมาณ 2569/)
  // ธ.ค. 2569 เป็นปีงบ 2570
  const r2 = C.parseMonthSpan('ธ.ค.69', { fiscalYearBE: 2569 })
  assert.deepEqual([r2.from, r2.to], [3, 3])
  assert.match(r2.warning, /2569/)
  // ไม่ส่งปีงบ แต่ต้น-ปลายอยู่คนละปีงบ
  const r3 = C.parseMonthSpan('ต.ค.68–ต.ค.69')
  assert.match(r3.warning, /คนละปีงบประมาณ/)
})

test('parseMonthSpan: ช่วงย้อน / อ่านไม่ได้ → null', () => {
  assert.equal(C.parseMonthSpan('ธ.ค.–ต.ค.'), null)
  assert.equal(C.parseMonthSpan('ก.ย.–ต.ค.'), null) // ก.ย. = เดือนที่ 12 → ต.ค. = 1
  assert.equal(C.parseMonthSpan('ไตรมาส 3-1'), null)
  assert.equal(C.parseMonthSpan('ไตรมาส 5'), null)
  assert.equal(C.parseMonthSpan('ตลอดปี'), null)
  assert.equal(C.parseMonthSpan('ต.ค.-'), null)
  assert.equal(C.parseMonthSpan('ต.ค.-ธ.ค.-ม.ค.'), null)
  assert.equal(C.parseMonthSpan(''), null)
  assert.equal(C.parseMonthSpan(null), null)
  assert.equal(C.parseMonthSpan('abc'), null)
  assert.equal(C.parseMonthSpan('ต.ค.1234'), null) // ปีที่ไม่สมเหตุสมผล
})

// ── ข้อ 27 : แผนการดำเนินงาน 30 วัน ──────────────────────────────────────────

test('ค่าคงที่: OP_PLAN_DAYS / SOON_DAYS / PLAN_AMEND_MIN_DAYS / CLOSING_DAYS / BASIS_LABELS', () => {
  assert.equal(D.OP_PLAN_DAYS, 30)
  assert.equal(D.SOON_DAYS, 7)
  assert.equal(D.PLAN_AMEND_MIN_DAYS, 180)
  assert.equal(D.CLOSING_DAYS, 30)
  assert.deepEqual(Object.keys(D.BASIS_LABELS), ['annual_budget', 'supplementary_budget', 'accumulated_fund', 'external_notice'])
  for (const label of Object.values(D.BASIS_LABELS)) assert.ok(label.length > 5)
})

test('daysBetween: ไม่โดน DST/โซนเวลาเครื่อง', () => {
  assert.equal(D.daysBetween('2026-03-07', '2026-03-09'), 2) // LA เปลี่ยนเวลา 8 มี.ค.
  assert.equal(D.daysBetween('2026-11-01', '2026-11-02'), 1) // LA ถอยเวลา 1 พ.ย.
  assert.equal(D.daysBetween('2026-11-14', '2026-11-14'), 0)
  assert.equal(D.daysBetween('2026-11-14', '2026-11-13'), -1)
  assert.equal(D.daysBetween('2026-01-01', '2027-01-01'), 365)
})

test('opPlanDeadline: basis_on 2026-10-15 → ครบ 2026-11-14 (นับ 30 วันปฏิทิน)', () => {
  const r = D.opPlanDeadline({ basis: 'annual_budget', basis_on: '2026-10-15' }, '2026-10-20')
  assert.equal(r.baseDueOn, '2026-11-14')
  assert.equal(r.dueOn, '2026-11-14')
  assert.equal(r.extended, false)
  assert.equal(r.daysLeft, 25)
  assert.equal(r.state, 'open')
  assert.equal(r.basisLabel, D.BASIS_LABELS.annual_budget)
})

test('opPlanDeadline: ข้ามเดือน/ข้ามปี 2026-12-10 → 2027-01-09 และ 2026-02-01 → 2026-03-03', () => {
  assert.equal(D.opPlanDeadline({ basis_on: '2026-12-10' }, '2026-12-11').dueOn, '2027-01-09')
  assert.equal(D.opPlanDeadline({ basis_on: '2026-12-10' }, '2026-12-11').basisLabel, null)
  assert.equal(D.opPlanDeadline({ basis_on: '2026-02-01' }, '2026-02-02').dueOn, '2026-03-03')
  assert.equal(D.opPlanDeadline({ basis_on: '2028-02-01' }, '2028-02-02').dueOn, '2028-03-02') // ปีอธิกสุรทิน
})

test('opPlanDeadline: วันครบกำหนดตรงเสาร์/อาทิตย์ → ติดธง dueIsHoliday ไม่เลื่อนวัน', () => {
  const sat = D.opPlanDeadline({ basis_on: '2026-10-15' }, '2026-10-20') // 2026-11-14
  assert.equal(weekday(sat.dueOn), 6)
  assert.equal(sat.dueIsHoliday, true)
  assert.equal(sat.holidayName, null) // เสาร์ธรรมดา ไม่ใช่วันนักขัตฤกษ์
  const sun = D.opPlanDeadline({ basis_on: '2026-10-16' }, '2026-10-20') // 2026-11-15
  assert.equal(sun.dueOn, '2026-11-15')
  assert.equal(weekday(sun.dueOn), 0)
  assert.equal(sun.dueIsHoliday, true)
  const weekdayDue = D.opPlanDeadline({ basis_on: '2026-10-19' }, '2026-10-20') // 2026-11-18 พุธ
  assert.equal(weekday(weekdayDue.dueOn), 3)
  assert.equal(weekdayDue.dueIsHoliday, false)
})

test('opPlanDeadline: วันครบกำหนดตรงวันหยุดนักขัตฤกษ์ → มีชื่อวันหยุด', () => {
  const r = D.opPlanDeadline({ basis_on: '2026-11-10' }, '2026-11-11') // 2026-12-10 วันรัฐธรรมนูญ (พฤหัสบดี)
  assert.equal(r.dueOn, '2026-12-10')
  assert.equal(weekday(r.dueOn), 4)
  assert.equal(r.dueIsHoliday, true)
  assert.equal(r.holidayName, 'วันรัฐธรรมนูญ')
  assert.match(D.warningText(D.opPlanDeadline({ basis_on: '2026-11-10' }, '2026-12-08')) || '', /วันรัฐธรรมนูญ/)
})

test('opPlanDeadline: ขยายเวลา (extended_due_on) ใช้แทนกำหนดเดิม', () => {
  const plan = { basis: 'annual_budget', basis_on: '2026-10-15', extended_due_on: '2026-12-14', extension_ref_no: 'ที่ มท 0000/ว 1' }
  const r = D.opPlanDeadline(plan, '2026-11-20') // เลยกำหนดเดิมแล้ว แต่ขยายไว้
  assert.equal(r.extended, true)
  assert.equal(r.baseDueOn, '2026-11-14')
  assert.equal(r.dueOn, '2026-12-14')
  assert.equal(r.state, 'open')
  assert.equal(r.daysLeft, 24)
  assert.match(D.warningText(D.opPlanDeadline(plan, '2026-12-10')) || '', /ขยายเวลาแล้ว/)
})

test('opPlanDeadline: ทุก state และขอบ 7 วัน / 0 วัน / -1 วัน', () => {
  const plan = { basis: 'annual_budget', basis_on: '2026-10-15' } // ครบ 2026-11-14
  const at = today => D.opPlanDeadline(plan, today)
  assert.equal(at('2026-11-06').daysLeft, 8)
  assert.equal(at('2026-11-06').state, 'open') // 8 วัน = open
  assert.equal(at('2026-11-07').daysLeft, 7)
  assert.equal(at('2026-11-07').state, 'soon') // 7 วัน = soon
  assert.equal(at('2026-11-13').daysLeft, 1)
  assert.equal(at('2026-11-13').state, 'soon')
  assert.equal(at('2026-11-14').daysLeft, 0)
  assert.equal(at('2026-11-14').state, 'due_today')
  assert.equal(at('2026-11-15').daysLeft, -1)
  assert.equal(at('2026-11-15').state, 'overdue')
  assert.equal(at('2027-03-01').state, 'overdue')
  assert.equal(D.opPlanDeadline({}, '2026-11-14').state, 'no_basis')
  assert.deepEqual(D.opPlanDeadline({ basis: null, basis_on: null }, '2026-11-14'), {
    state: 'no_basis', dueOn: null, baseDueOn: null, extended: false,
    daysLeft: null, dueIsHoliday: false, holidayName: null, basisLabel: null,
  })
})

test('opPlanDeadline: ประกาศแล้ว ทันกำหนด / เลยกำหนด (ตัดสินจาก published_on ไม่ใช่ today)', () => {
  const base = { basis: 'annual_budget', basis_on: '2026-10-15', status: 'published' }
  const onDue = D.opPlanDeadline({ ...base, published_on: '2026-11-14' }, '2027-06-01')
  assert.equal(onDue.state, 'published_on_time')
  assert.equal(onDue.daysLeft, null)
  assert.equal(D.opPlanDeadline({ ...base, published_on: '2026-10-16' }, '2027-06-01').state, 'published_on_time')
  assert.equal(D.opPlanDeadline({ ...base, published_on: '2026-11-15' }, '2026-11-15').state, 'published_late')
  // ขยายเวลาแล้วประกาศหลังกำหนดเดิมแต่ก่อนกำหนดใหม่ = ทัน
  const ext = { ...base, extended_due_on: '2026-12-14', extension_ref_no: 'x', published_on: '2026-12-01' }
  assert.equal(D.opPlanDeadline(ext, '2026-12-02').state, 'published_on_time')
  // ฉบับร่างที่มี published_on ค้าง (ไม่ควรมี) ไม่นับว่าประกาศแล้ว
  assert.equal(D.opPlanDeadline({ ...base, status: 'draft', published_on: '2026-10-16' }, '2026-11-20').state, 'overdue')
})

test('warningText (แผนดำเนินงาน): ข้อความเฉพาะ state ที่ต้องเตือน', () => {
  const plan = { basis: 'annual_budget', basis_on: '2026-10-15' }
  const w = today => D.warningText(D.opPlanDeadline(plan, today))
  assert.equal(w('2026-10-20'), null) // open
  assert.match(w('2026-11-07'), /เหลือ 7 วัน/)
  assert.match(w('2026-11-14'), /วันนี้ครบกำหนด/)
  assert.match(w('2026-11-16'), /เกินกำหนด.*2 วัน/)
  assert.match(w('2026-11-14'), /หยุด/) // 14 พ.ย. เป็นเสาร์
  assert.match(D.warningText(D.opPlanDeadline({}, '2026-11-14')), /ยังไม่ระบุวันที่ตั้งต้น/)
  assert.equal(D.warningText(D.opPlanDeadline({ ...plan, status: 'published', published_on: '2026-11-01' }, '2026-11-20')), null)
  assert.match(D.warningText(D.opPlanDeadline({ ...plan, status: 'published', published_on: '2026-11-20' }, '2026-11-21')), /หลังวันครบกำหนด/)
  assert.equal(D.warningText(null), null)
  assert.equal(D.warningText({}), null)
})

// ── ข้อ 22 : แผนพัฒนาเหลืออายุ < 180 วัน ────────────────────────────────────

const PLAN = { year_from: 2571, year_to: 2575 }

test('devPlanAmendWindow: แผน 2571–2575 → สิ้นอายุ 2032-09-30, วันสุดท้ายที่แก้ได้ 2032-04-03 (เหลือ 180 วันพอดี)', () => {
  const r = D.devPlanAmendWindow(PLAN, '2030-01-01')
  assert.equal(r.planEndsOn, '2032-09-30')
  assert.equal(r.lastAmendOn, '2032-04-03')
  // ยืนยันวิธีนับแยกจากโค้ด : จาก lastAmendOn ถึงวันสิ้นแผน = 180 วันพอดี
  assert.equal(D.daysBetween(r.lastAmendOn, r.planEndsOn), 180)
  assert.equal(addDays(r.planEndsOn, -180), r.lastAmendOn)
  assert.equal(r.state, 'open')
  assert.equal(r.daysLeftInPlan, D.daysBetween('2030-01-01', '2032-09-30'))
})

test('devPlanAmendWindow: ขอบเส้น 180 วัน — lastAmendOn ยังแก้ได้, วันถัดไป closed', () => {
  const last = D.devPlanAmendWindow(PLAN, '2032-04-03')
  assert.equal(last.daysToCutoff, 0)
  assert.equal(last.state, 'closing') // ยังแก้ได้ แต่ใกล้เส้นที่สุด
  assert.equal(last.daysLeftInPlan, 180)
  const next = D.devPlanAmendWindow(PLAN, '2032-04-04')
  assert.equal(next.daysToCutoff, -1)
  assert.equal(next.state, 'closed')
  assert.equal(next.daysLeftInPlan, 179)
})

test('devPlanAmendWindow: ขอบ CLOSING_DAYS — 30 วันก่อนเส้น = closing, 31 วัน = open', () => {
  const c30 = D.devPlanAmendWindow(PLAN, addDays('2032-04-03', -D.CLOSING_DAYS))
  assert.equal(c30.daysToCutoff, 30)
  assert.equal(c30.state, 'closing')
  const c31 = D.devPlanAmendWindow(PLAN, addDays('2032-04-03', -(D.CLOSING_DAYS + 1)))
  assert.equal(c31.daysToCutoff, 31)
  assert.equal(c31.state, 'open')
})

test('devPlanAmendWindow: วันสุดท้ายของแผนยัง closed, หลังสิ้นแผน expired, ก่อนเริ่ม not_started', () => {
  assert.equal(D.devPlanAmendWindow(PLAN, '2032-09-30').state, 'closed')
  assert.equal(D.devPlanAmendWindow(PLAN, '2032-09-30').daysLeftInPlan, 0)
  assert.equal(D.devPlanAmendWindow(PLAN, '2032-10-01').state, 'expired')
  assert.equal(D.devPlanAmendWindow(PLAN, '2035-01-01').state, 'expired')
  // แผนเริ่ม 1 ต.ค. 2570 (ปีงบ 2571 = 2027-10-01) — วันก่อนเริ่มยังแก้ได้ ไม่ใช่ error
  assert.equal(D.devPlanAmendWindow(PLAN, '2027-09-30').state, 'not_started')
  assert.equal(D.devPlanAmendWindow(PLAN, '2027-10-01').state, 'open')
  assert.equal(D.devPlanAmendWindow(PLAN, '2020-01-01').state, 'not_started')
})

test('devPlanAmendWindow: แผนปีเดียว (year_from = year_to) เส้นตกกลางปี', () => {
  const one = { year_from: 2569, year_to: 2569 }
  const r = D.devPlanAmendWindow(one, '2025-10-01')
  assert.equal(r.planEndsOn, '2026-09-30')
  assert.equal(r.lastAmendOn, '2026-04-03')
  assert.equal(r.state, 'open')
  assert.equal(D.devPlanAmendWindow(one, '2026-04-04').state, 'closed')
})

test('warningText (แผนพัฒนา): closing / closed / expired / open', () => {
  const w = today => D.warningText(D.devPlanAmendWindow(PLAN, today))
  assert.equal(w('2030-01-01'), null)
  assert.equal(w('2027-09-30'), null) // not_started
  assert.match(w('2032-03-24'), /เหลือ 10 วัน/)
  assert.match(w('2032-04-03'), /วันนี้เป็นวันสุดท้าย/)
  assert.match(w('2032-04-04'), /ไม่ถึง 180 วัน.*ห้ามเพิ่มเติม/)
  assert.match(w('2032-10-01'), /สิ้นอายุ/)
})

test('devPlanAmendWindow: ปีว่าง/ไม่ใช่เลข → null และ warningText(null) = null', () => {
  assert.equal(D.devPlanAmendWindow({ year_from: 2571 }, '2030-01-01'), null)
  assert.equal(D.devPlanAmendWindow({ year_from: '', year_to: 2575 }, '2030-01-01'), null)
  assert.equal(D.devPlanAmendWindow(null, '2030-01-01'), null)
  assert.equal(D.devPlanAmendWindow({ year_from: '2571', year_to: '2575' }, '2030-01-01').planEndsOn, '2032-09-30')
  assert.equal(D.warningText(null), null)
})

console.log(`\nlocal-plan-lib: ${cases} cases passed`)
