// เทสต์ตัวคำนวณรอบเก็บขยะ — กฎตั้งครั้งเดียว ระบบต้องได้วันที่ถูกเองทุกเดือนทุกปี
// รันด้วย: node tests/waste-schedule.test.mjs
import assert from 'node:assert/strict'
import {
  computeCollections, describeRule, dayIndex, missedPickupDetail, mooListText, nextCollection,
  parseMooNo, ruleOccursOn, thaiLongDate, thaiShortDate, timeText, validateSchedule, weekdayOf,
} from '../src/lib/wasteSchedule.js'

const noHoliday = () => null
const weekdayOnly = (d) => ![0, 6].includes(weekdayOf(d))
const dates = (items) => items.map(i => i.date)

const base = {
  waste_type: 'general', moo_nos: [], rule: 'weekly', interval_weeks: 1, weekdays: [4], nth: null,
  time_from: '07:00', time_to: '09:00', holiday_policy: 'collect', starts_on: '2026-01-01', ends_on: null,
}

// ── ปฏิทินอ้างอิง (ยืนยันก่อนใช้ ไม่งั้นเทสต์ผ่านเพราะเข้าใจวันผิดกันทั้งคู่) ──
assert.equal(weekdayOf('2026-09-17'), 4) // พฤหัส
assert.equal(weekdayOf('2026-10-01'), 4)
assert.equal(weekdayOf('2026-09-30'), 3)

// ── รายสัปดาห์ ──
{
  const items = computeCollections({ schedules: [base], from: '2026-09-14', days: 21, holidayFn: noHoliday })
  assert.deepEqual(dates(items), ['2026-09-17', '2026-09-24', '2026-10-01'])
  assert.ok(items.every(i => i.status === 'normal'))
}

// ── หลายวันต่อสัปดาห์ ──
{
  const s = { ...base, weekdays: [1, 4] }
  const items = computeCollections({ schedules: [s], from: '2026-09-14', days: 7, holidayFn: noHoliday })
  assert.deepEqual(dates(items), ['2026-09-14', '2026-09-17'])
  assert.equal(describeRule(s), 'ทุกวันจันทร์ และพฤหัสบดี')
}

// ── 2 สัปดาห์ครั้ง นับจากสัปดาห์ที่เริ่มใช้ ──
{
  const s = { ...base, interval_weeks: 2, starts_on: '2026-09-15' } // อังคาร → สัปดาห์นี้คือสัปดาห์เก็บ
  const items = computeCollections({ schedules: [s], from: '2026-09-14', days: 35, holidayFn: noHoliday })
  assert.deepEqual(dates(items), ['2026-09-17', '2026-10-01', '2026-10-15'])
  assert.equal(describeRule(s), 'ทุก 2 สัปดาห์ วันพฤหัสบดี')
}

// ── รายเดือน: พุธที่ 2 และศุกร์สุดท้าย ──
{
  const wed2 = { ...base, waste_type: 'hazardous', rule: 'monthly', weekdays: [3], nth: 2 }
  const items = computeCollections({ schedules: [wed2], from: '2026-09-01', days: 92, holidayFn: noHoliday })
  assert.deepEqual(dates(items), ['2026-09-09', '2026-10-14', '2026-11-11'])
  assert.equal(describeRule(wed2), 'วันพุธที่ 2 ของทุกเดือน')

  const lastFri = { ...wed2, weekdays: [5], nth: -1 }
  assert.ok(ruleOccursOn(lastFri, '2026-09-25'))
  assert.ok(!ruleOccursOn(lastFri, '2026-09-18'))
  assert.ok(ruleOccursOn(lastFri, '2026-10-30'))
  assert.equal(describeRule(lastFri), 'วันศุกร์สุดท้ายของทุกเดือน')
}

// ── ช่วงใช้งานของกฎ ──
{
  const s = { ...base, starts_on: '2026-09-20', ends_on: '2026-10-05' }
  const items = computeCollections({ schedules: [s], from: '2026-09-14', days: 30, holidayFn: noHoliday })
  assert.deepEqual(dates(items), ['2026-09-24', '2026-10-01'])
}

// ── วันหยุดราชการ: ระบบจัดการเองตาม holiday_policy ที่ตั้งครั้งเดียว ──
{
  const holidayFn = (d) => (d === '2026-10-01' ? 'วันหยุดทดสอบ' : null)
  const range = { from: '2026-09-28', days: 7, holidayFn, workingDayFn: weekdayOnly }

  const collect = computeCollections({ schedules: [base], ...range })
  assert.equal(collect[0].status, 'normal')
  assert.equal(collect[0].holiday, 'วันหยุดทดสอบ')

  const skip = computeCollections({ schedules: [{ ...base, holiday_policy: 'skip' }], ...range })
  assert.equal(skip[0].status, 'cancelled')
  assert.equal(skip[0].auto, true)
  assert.equal(nextCollection(skip, 'general', '2026-09-28'), null)

  // พฤหัสเป็นวันหยุด → วันทำการถัดไปคือศุกร์ 2
  const moved = computeCollections({ schedules: [{ ...base, holiday_policy: 'next_working_day' }], ...range })
  assert.equal(moved[0].status, 'moved')
  assert.equal(moved[0].date, '2026-10-02')
  assert.equal(moved[0].originalDate, '2026-10-01')

  // ศุกร์ก็หยุดด้วย → ข้ามเสาร์อาทิตย์ไปจันทร์
  const longWeekend = (d) => (['2026-10-01', '2026-10-02'].includes(d) ? 'หยุดยาว' : null)
  const workingFn = (d) => weekdayOnly(d) && !longWeekend(d)
  const moved2 = computeCollections({
    schedules: [{ ...base, holiday_policy: 'next_working_day' }],
    from: '2026-09-28', days: 14, holidayFn: longWeekend, workingDayFn: workingFn,
  })
  assert.equal(moved2[0].date, '2026-10-05')
}

// ── รอบที่ถูกเลื่อนข้ามเข้ามาในช่วงที่ดูต้องไม่หาย ──
{
  const holidayFn = (d) => (d === '2026-09-24' ? 'หยุด' : null)
  const items = computeCollections({
    schedules: [{ ...base, holiday_policy: 'next_working_day' }],
    from: '2026-09-25', days: 3, holidayFn, workingDayFn: weekdayOnly,
  })
  assert.deepEqual(dates(items), ['2026-09-25'])
}

// ── ข้อยกเว้นที่เจ้าหน้าที่กดชนะ holiday_policy และครอบทุกกฎของวันนั้น ──
{
  const hz = { ...base, waste_type: 'hazardous', weekdays: [4] }
  const exceptions = [{ on_date: '2026-09-17', waste_type: null, moo_nos: [], action: 'move', new_date: '2026-09-18', reason: 'รถซ่อม' }]
  const items = computeCollections({
    schedules: [{ ...base, holiday_policy: 'skip' }, hz], exceptions,
    from: '2026-09-14', days: 7, holidayFn: (d) => (d === '2026-09-17' ? 'หยุด' : null),
  })
  assert.equal(items.length, 2)
  assert.ok(items.every(i => i.status === 'moved' && i.date === '2026-09-18' && i.reason === 'รถซ่อม' && !i.auto))

  const onlyGeneral = computeCollections({
    schedules: [base, hz],
    exceptions: [{ on_date: '2026-09-17', waste_type: 'general', moo_nos: [], action: 'cancel', reason: null }],
    from: '2026-09-14', days: 7, holidayFn: noHoliday,
  })
  assert.equal(onlyGeneral.find(i => i.waste_type === 'general').status, 'cancelled')
  assert.equal(onlyGeneral.find(i => i.waste_type === 'hazardous').status, 'normal')
}

// ── ข้อยกเว้นรายหมู่ ต้องไม่ลามไปหมู่อื่น ──
{
  const moo3 = { ...base, moo_nos: [3] }
  const moo5 = { ...base, moo_nos: [5] }
  const exceptions = [{ on_date: '2026-09-17', waste_type: null, moo_nos: [3], action: 'cancel', reason: 'ถนนขาด' }]
  const args = { schedules: [moo3, moo5], exceptions, from: '2026-09-14', days: 7, holidayFn: noHoliday }

  assert.equal(computeCollections({ ...args, mooNo: 3 })[0].status, 'cancelled')
  const forMoo5 = computeCollections({ ...args, mooNo: 5 })
  assert.equal(forMoo5.length, 1)
  assert.equal(forMoo5[0].status, 'normal')

  // มุมมองทุกหมู่ (เจ้าหน้าที่): กฎหมู่ 5 ต้องปกติ
  const all = computeCollections(args)
  assert.equal(all.find(i => i.schedule === moo5).status, 'normal')
  assert.equal(all.find(i => i.schedule === moo3).status, 'cancelled')
}

// ── กฎของหมู่อื่นไม่ขึ้นในหน้าของหมู่เรา ──
{
  const items = computeCollections({
    schedules: [{ ...base, moo_nos: [1, 2] }, { ...base, weekdays: [1], moo_nos: [3] }],
    mooNo: 3, from: '2026-09-14', days: 7, holidayFn: noHoliday,
  })
  assert.deepEqual(dates(items), ['2026-09-14'])
}

// ── ข้อความ ──
assert.equal(parseMooNo('หมู่ 3'), 3)
assert.equal(parseMooNo('ม.12 บ้านใหม่'), 12)
assert.equal(parseMooNo('3'), 3)
assert.equal(parseMooNo(''), null)
assert.equal(parseMooNo(null), null)
assert.equal(parseMooNo('0'), null)
assert.equal(mooListText([5, 1, 3, 3]), 'หมู่ 1, 3, 5')
assert.equal(mooListText([]), 'ทุกหมู่')
assert.equal(timeText(base), '07:00–09:00 น.')
assert.equal(timeText({ time_from: '07:00:00', time_to: null }), 'ตั้งแต่ 07:00 น.')
assert.equal(timeText({}), '')
assert.equal(describeRule(base), 'ทุกวันพฤหัสบดี')
assert.equal(describeRule({ ...base, weekdays: [0, 1, 2, 3, 4, 5, 6] }), 'ทุกวัน')
assert.equal(thaiShortDate('2026-09-17'), 'พฤ. 17 ก.ย. 69')
assert.equal(thaiLongDate('2026-09-17'), 'วันพฤหัสบดีที่ 17 ก.ย. 2569')
assert.equal(dayIndex('bad'), null)
assert.equal(
  missedPickupDetail({ item: { waste_type: 'general', date: '2026-09-17' }, mooNo: 3, villages: [{ moo_no: 3, name: 'บ้านน้ำเลา' }] }),
  'รถเก็บขยะทั่วไปไม่มาเก็บตามรอบ วันพฤหัสบดีที่ 17 ก.ย. 2569 หมู่ 3 บ้านน้ำเลา',
)

// ── ตรวจก่อนบันทึก ──
assert.deepEqual(validateSchedule(base), [])
assert.ok(validateSchedule({ ...base, holiday_policy: undefined }).some(e => e.includes('วันหยุดราชการ')))
assert.ok(validateSchedule({ ...base, weekdays: [] }).length > 0)
assert.ok(validateSchedule({ ...base, rule: 'monthly', weekdays: [1, 2], nth: 1 }).some(e => e.includes('วันเดียว')))
assert.ok(validateSchedule({ ...base, rule: 'monthly', weekdays: [1], nth: null }).length > 0)
assert.ok(validateSchedule({ ...base, time_from: '09:00', time_to: '08:00' }).length > 0)
assert.ok(validateSchedule({ ...base, ends_on: '2025-12-31' }).length > 0)

console.log('waste-schedule: ผ่านทั้งหมด')
