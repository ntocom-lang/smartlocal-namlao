// Pure-logic tests for src/lib/staffPerformance.js — no database, no network.
// The device timezone is forced to America/Los_Angeles before the library loads, so any
// accidental use of the machine's local date (instead of Bangkok time) makes these fail.
// Expected working-day counts were counted by hand from the 2026 calendar and holiday table.
import assert from 'node:assert/strict'

process.env.TZ = 'America/Los_Angeles'
const lib = await import('../src/lib/staffPerformance.js')
const { setHolidayRows } = await import('../src/lib/workingDays.js')
setHolidayRows([])

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const row = (n, fields = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  ref_no: `ES-69-${String(n).padStart(4, '0')}`,
  category: 'light',
  issue_type: 'ไฟดับทั้งดวง',
  village: 'หมู่ 1',
  channel: 'citizen_online',
  status: 'closed',
  is_confidential: false,
  created_at: '2026-05-01T02:00:00Z',
  received_at: null,
  first_done_at: null,
  closed_at: null,
  finish_recorded: true,
  due_date: null,
  resolved_by_name: null,
  rating: null,
  reopen_count: 0,
  ...fields,
})
const n = (item) => Number(item.refNo?.slice(-4) ?? item.id.slice(-4))

const rows = [
  row(1, { created_at: '2026-09-20T03:00:00Z', received_at: '2026-09-20T03:00:05Z', closed_at: '2026-09-24T02:00:00Z', due_date: '2026-09-30', rating: 5 }),
  row(2, { created_at: '2026-03-25T03:00:00Z', received_at: '2026-03-25T03:00:00Z', closed_at: '2026-03-31T17:30:00Z', due_date: '2026-03-28' }),
  row(3, { created_at: '2026-03-20T03:00:00Z', closed_at: '2026-03-31T16:30:00Z' }),
  row(4, { finish_recorded: false, created_at: '2026-06-01T02:00:00Z', closed_at: '2026-06-10T08:00:00Z', first_done_at: '2026-06-08T03:00:00Z', due_date: '2026-06-09' }),
  row(5, { finish_recorded: false }),
  row(6, { status: 'received', finish_recorded: false, created_at: '2026-03-30T02:00:00Z', received_at: '2026-03-30T02:00:00Z', due_date: '2026-04-02' }),
  row(7, { status: 'in_progress', finish_recorded: false, created_at: '2026-09-25T02:00:00Z', due_date: '2026-10-05' }),
  row(8, { created_at: '2026-09-01T02:00:00Z', closed_at: '2026-09-10T03:00:00Z', due_date: '2026-09-11', reopen_count: 1 }),
  row(9, { created_at: '2026-06-29T02:00:00Z', closed_at: '2026-07-01T03:00:00Z' }),
  row(10, { created_at: '2026-05-05T02:00:00Z', closed_at: '2026-05-15T03:00:00Z', due_date: '2026-05-10' }),
  row(11, { is_confidential: true, category: 'corruption', ref_no: null, village: null, issue_type: null, closed_at: '2026-08-01T03:00:00Z' }),
  row(12, { status: 'rejected', finish_recorded: false, created_at: '2026-05-05T02:00:00Z' }),
  row(13, { status: 'rejected', finish_recorded: false, created_at: '2026-03-05T02:00:00Z' }),
  row(14, { category: 'road', created_at: '2026-08-17T02:00:00Z', closed_at: '2026-08-20T03:00:00Z', resolved_by_name: '[TEST] หัวหน้ากองช่าง' }),
  row(15, { category: 'road', channel: 'oss_counter', created_at: '2026-08-18T02:00:00Z', closed_at: '2026-08-21T03:00:00Z' }),
  row(16, { created_at: '2026-04-10T02:00:00Z', received_at: '2026-04-10T02:00:00Z', closed_at: '2026-04-17T03:00:00Z' }),
  row(17, { created_at: '2026-08-10T03:00:00Z', received_at: '2026-08-10T03:00:00Z', closed_at: '2026-08-05T03:00:00Z' }),
  row(20, { created_at: '2026-06-20T02:00:00Z', received_at: '2026-06-20T02:00:00Z', closed_at: '2026-07-01T03:00:00Z', due_date: '2026-06-25' }),
]
const items = lib.normalizePerformanceRows(rows)
const byNo = Object.fromEntries(items.map((i) => [n(i), i]))
const ROUND_2 = { from: '2026-04-01', to: '2026-09-30', today: '2026-09-27' }
const round2 = lib.summarizePerformance(items, ROUND_2)
const light = round2.byCategory.find((g) => g.category === 'light')
const road = round2.byCategory.find((g) => g.category === 'road')

test('the machine really runs outside Bangkok time', () => {
  assert.equal(new Date('2026-03-31T17:30:00Z').getDate(), 31)
})

test('evaluation rounds follow the fiscal year halves', () => {
  const r1 = lib.performancePeriodRange({ mode: 'round', fiscalYearBE: 2569, round: 1 })
  assert.equal(r1.from, '2025-10-01')
  assert.equal(r1.to, '2026-03-31')
  assert.match(r1.label, /^รอบการประเมินที่ 1 ปีงบประมาณ พ\.ศ\. 2569 \(1 ตุลาคม พ\.ศ\. 2568 – 31 มีนาคม พ\.ศ\. 2569\)$/)
  const r2 = lib.performancePeriodRange({ mode: 'round', fiscalYearBE: 2569, round: 2 })
  assert.equal(r2.from, '2026-04-01')
  assert.equal(r2.to, '2026-09-30')
})

test('month, quarter and year reuse the existing fleet period labels', () => {
  const month = lib.performancePeriodRange({ mode: 'month', yearBE: 2569, month: 9 })
  assert.deepEqual([month.from, month.to], ['2026-09-01', '2026-09-30'])
  const quarter = lib.performancePeriodRange({ mode: 'quarter', fiscalYearBE: 2569, quarter: 4 })
  assert.deepEqual([quarter.from, quarter.to], ['2026-07-01', '2026-09-30'])
  const year = lib.performancePeriodRange({ mode: 'year', fiscalYearBE: 2570 })
  assert.deepEqual([year.from, year.to], ['2026-10-01', '2027-09-30'])
})

test('default period is this month, except October and April open the round that just ended', () => {
  assert.deepEqual(lib.defaultPerformancePeriod(new Date('2026-09-27T05:00:00Z')),
    { mode: 'month', yearBE: 2569, month: 9, fiscalYearBE: 2569, quarter: 4, round: 2 })
  const october = lib.defaultPerformancePeriod(new Date('2026-09-30T17:30:00Z'))
  assert.deepEqual([october.mode, october.fiscalYearBE, october.round], ['round', 2569, 2])
  const april = lib.defaultPerformancePeriod(new Date('2026-04-10T03:00:00Z'))
  assert.deepEqual([april.mode, april.fiscalYearBE, april.round], ['round', 2569, 1])
  const january = lib.defaultPerformancePeriod(new Date('2027-01-15T03:00:00Z'))
  assert.deepEqual([january.mode, january.fiscalYearBE, january.quarter, january.round], ['month', 2570, 2, 1])
})

test('dates are converted to the Bangkok calendar day', () => {
  assert.equal(lib.bangkokDateOf('2026-03-31T17:30:00Z'), '2026-04-01')
  assert.equal(lib.bangkokDateOf('2026-03-31T16:30:00Z'), '2026-03-31')
  assert.equal(lib.bangkokDateOf('2026-09-30'), '2026-09-30')
  assert.equal(lib.bangkokDateOf(null), null)
  assert.equal(lib.bangkokDateOf('not a date'), null)
  assert.equal(lib.thaiShortDate('2026-09-24'), '24 ก.ย. 2569')
})

test('completion date: recorded finish uses closed_at, legacy uses the earlier done row', () => {
  assert.equal(byNo[1].completionSource, 'recorded')
  assert.equal(byNo[1].completedDate, '2026-09-24')
  assert.equal(byNo[4].completionSource, 'legacy')
  assert.equal(byNo[4].completedDate, '2026-06-08')
  assert.equal(byNo[4].dueResult, 'on_time')
  assert.equal(byNo[5].completionSource, 'unknown')
  assert.equal(byNo[6].completionSource, null)
})

test('working days skip weekends and public holidays, same as the SLA badges', () => {
  assert.equal(byNo[1].workingDays, 4)
  assert.equal(byNo[2].workingDays, 5)
  assert.equal(byNo[4].workingDays, 4)
  assert.equal(byNo[8].workingDays, 7)
  assert.equal(byNo[9].workingDays, 2)
  assert.equal(byNo[10].workingDays, 7)
  assert.equal(byNo[16].workingDays, 2)
  assert.equal(byNo[20].workingDays, 8)
})

test('completion before receipt is flagged instead of counted as negative days', () => {
  assert.equal(byNo[17].dateAnomaly, true)
  assert.equal(byNo[17].workingDays, null)
  assert.equal(round2.dateAnomalies, 1)
})

test('only work finished inside the round is listed, by Bangkok date', () => {
  assert.deepEqual(round2.completedItems.map(n).sort((a, b) => a - b), [1, 2, 4, 8, 9, 10, 14, 15, 16, 17, 20])
})

test('quantity per category and in total', () => {
  assert.deepEqual(light.quantity, { completed: 9, received: 9, receivedDone: 8, receivedDoneRate: 88.9, openAtEnd: 2 })
  assert.deepEqual(road.quantity, { completed: 2, received: 2, receivedDone: 2, receivedDoneRate: 100, openAtEnd: 0 })
  assert.equal(round2.total.quantity.completed, 11)
  assert.equal(round2.total.quantity.received, 11)
  assert.equal(round2.total.quantity.openAtEnd, 2)
})

test('quality counts reopened work and averages citizen ratings with their count', () => {
  assert.deepEqual(light.quality, { notReopened: 8, notReopenedRate: 88.9, reopened: 1, ratingCount: 1, ratingAverage: 5 })
})

test('timeliness puts open work already past due into the denominator', () => {
  assert.deepEqual(light.benefit, { onTime: 3, late: 3, openPastDue: 1, noDue: 3, onTimeRate: 42.9, medianWorkingDays: 4.5 })
  assert.deepEqual(road.benefit, { onTime: 0, late: 0, openPastDue: 0, noDue: 2, onTimeRate: null, medianWorkingDays: 3 })
  assert.equal(round2.total.benefit.onTimeRate, 42.9)
  assert.equal(round2.total.benefit.medianWorkingDays, 4)
  assert.equal(lib.median([7, 1, 4, 2]), 3)
})

test('legacy dates, undated work, confidential and rejected complaints are kept apart', () => {
  assert.equal(light.legacyCount, 1)
  assert.deepEqual(round2.undatedItems.map(n), [5])
  assert.deepEqual(round2.confidential, { completed: 1, openAtEnd: 0 })
  assert.ok(!round2.completedItems.some((i) => i.isConfidential))
  assert.equal(round2.rejected, 1)
})

test('open items at the end of a past month include work finished after it', () => {
  const june = lib.summarizePerformance(items, { from: '2026-06-01', to: '2026-06-30', today: '2026-09-27' })
  assert.deepEqual(june.openItems.map((i) => [n(i), i.pastDue, i.finishedAfterPeriod]), [[6, true, false], [20, true, true], [9, false, true]])
  assert.deepEqual(june.completedItems.map(n), [4])
  assert.equal(june.total.benefit.onTimeRate, 33.3)
})

test('a period in a year without holiday data is reported', () => {
  assert.deepEqual(round2.holidayYearsMissing, [])
  const nextRound = lib.summarizePerformance(items, { from: '2026-10-01', to: '2027-03-31', today: '2026-10-05' })
  assert.deepEqual(nextRound.holidayYearsMissing, [2027])
})

test('CSV has a BOM, Thai dates, notes and no spreadsheet formulas', () => {
  const summary = lib.summarizePerformance(lib.normalizePerformanceRows([
    ...rows,
    row(30, { village: '=HYPERLINK("http://example.invalid")', closed_at: '2026-09-01T03:00:00Z' }),
  ]), ROUND_2)
  const csvRows = lib.performanceCsvRows(summary, { categoryLabels: { light: 'ไฟฟ้าสาธารณะ', road: 'ถนน' } })
  const csv = lib.toCsv(csvRows)
  assert.ok(csv.startsWith('﻿"กลุ่ม","เลขที่"'))
  assert.ok(csv.includes('"\'=HYPERLINK(""http://example.invalid"")"'))
  assert.ok(csv.includes('"แล้วเสร็จ","ES-69-0004","ไฟฟ้าสาธารณะ"'))
  assert.ok(csv.includes('† วันที่จากประวัติการดำเนินงาน'))
  assert.ok(csv.includes('ปิดงานแทนโดย [TEST] หัวหน้ากองช่าง'))
  assert.ok(csv.includes('"เคาน์เตอร์"'))
  assert.ok(csv.includes('"24 ก.ย. 2569"'))
  assert.ok(!csv.includes('corruption'))
  assert.equal(csvRows.filter((r) => r[0] === 'ไม่ทราบวันแล้วเสร็จ').length, 1)
})

console.log(`All ${cases} staff performance checks passed`)
