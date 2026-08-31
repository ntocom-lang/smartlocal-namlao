import assert from 'node:assert/strict'
import { fleetPeriodRange, formatBEDate } from '../src/lib/fleetReportPeriod.js'

const month = fleetPeriodRange({ mode: 'month', yearBE: 2569, month: 8 })
assert.equal(month.from, '2026-08-01')
assert.equal(month.to, '2026-08-31')
assert.equal(month.label, 'ประจำเดือน สิงหาคม พ.ศ. 2569')

const feb = fleetPeriodRange({ mode: 'month', yearBE: 2567, month: 2 })
assert.equal(feb.from, '2024-02-01')
assert.equal(feb.to, '2024-02-29')

const q1 = fleetPeriodRange({ mode: 'quarter', fiscalYearBE: 2569, quarter: 1 })
assert.equal(q1.from, '2025-10-01')
assert.equal(q1.to, '2025-12-31')
assert.match(q1.label, /ปีงบประมาณ พ.ศ. 2569/)
assert.match(q1.label, /ต\.ค/)

const q3 = fleetPeriodRange({ mode: 'quarter', fiscalYearBE: 2569, quarter: 3 })
assert.equal(q3.from, '2026-04-01')
assert.equal(q3.to, '2026-06-30')
assert.match(q3.label, /ไตรมาสที่ 3/)

const q4 = fleetPeriodRange({ mode: 'quarter', fiscalYearBE: 2569, quarter: 4 })
assert.equal(q4.from, '2026-07-01')
assert.equal(q4.to, '2026-09-30')

const year = fleetPeriodRange({ mode: 'year', fiscalYearBE: 2569 })
assert.equal(year.from, '2025-10-01')
assert.equal(year.to, '2026-09-30')
assert.match(year.label, /ปีงบประมาณ พ.ศ. 2569/)

assert.equal(formatBEDate('2026-08-01'), '1 สิงหาคม พ.ศ. 2569')
const custom = fleetPeriodRange({ mode: 'custom', dateFrom: '2026-08-01', dateTo: '2026-08-15' })
assert.equal(custom.label, 'ตั้งแต่วันที่ 1 สิงหาคม พ.ศ. 2569 ถึง 15 สิงหาคม พ.ศ. 2569')

console.log('fleet-report-period.test.mjs PASS')
