// Pure-logic test สำหรับ src/lib/staffMonthOverview.js — การ์ด "ภาพรวมเดือนนี้" บนหน้าแรกเจ้าหน้าที่
// ไม่ใช้ฐานข้อมูล ไม่ใช้เบราว์เซอร์ (ฝั่ง SQL ตรวจโดย tests/staff-month-overview-db.test.mjs)
//
// จุดที่ต้องกันที่สุด: ตัวหารศูนย์ต้องไม่กลายเป็น 0% (ไม่มีเรื่องครบกำหนด ≠ ตรงเวลา 0%) และ ผลผิดรูปต้องไม่ทำให้หน้าแรกพัง
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MONTH_OVERVIEW_RULE, monthOverviewRule, normalizeMonthOverview } from '../src/lib/staffMonthOverview.js'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const base = {
  scope: 'department', department_name: 'กองช่าง', month_start: '2026-11-01', today: '2026-11-16',
  received: 12, completed: 7, on_time: 5, late: 1, no_due: 1, open_past_due: 2, open_now: 9,
}

test('ไม่ใช่ object / ไม่มี scope ที่รู้จัก → null', () => {
  assert.equal(normalizeMonthOverview(null), null)
  assert.equal(normalizeMonthOverview(undefined), null)
  assert.equal(normalizeMonthOverview('x'), null)
  assert.equal(normalizeMonthOverview(42), null)
  assert.equal(normalizeMonthOverview([]), null)
  assert.equal(normalizeMonthOverview({}), null)
  assert.equal(normalizeMonthOverview({ ...base, scope: 'everything' }), null)
  assert.equal(normalizeMonthOverview({ ...base, scope: undefined }), null)
})

test('ผลปกติของกอง: แปลงฟิลด์ครบและคิดร้อยละตรงเวลา', () => {
  const m = normalizeMonthOverview(base)
  assert.deepEqual(m, {
    scope: 'department', departmentName: 'กองช่าง', monthStart: '2026-11-01', today: '2026-11-16',
    received: 12, completed: 7, onTime: 5, late: 1, noDue: 1, openPastDue: 2, openNow: 9,
    onTimePct: 63, // 5 ÷ (5 + 1 + 2) = 62.5 → 63
    periodText: '1–16 พฤศจิกายน 2569',
  })
})

test('scope municipality ไม่มีชื่อกอง → departmentName ว่าง', () => {
  const m = normalizeMonthOverview({ ...base, scope: 'municipality', department_name: null })
  assert.equal(m.scope, 'municipality')
  assert.equal(m.departmentName, '')
})

test('ตัวหาร 0 (ไม่มีเรื่องครบกำหนด) → onTimePct เป็น null ไม่ใช่ 0', () => {
  const m = normalizeMonthOverview({ ...base, on_time: 0, late: 0, open_past_due: 0, no_due: 3, completed: 3 })
  assert.equal(m.onTimePct, null)
  assert.equal(normalizeMonthOverview({ scope: 'municipality' }).onTimePct, null)
})

test('ตัวหารมีแต่ตรงเวลา 0 → 0% จริง (ต่างจากตัวหาร 0)', () => {
  assert.equal(normalizeMonthOverview({ ...base, on_time: 0, late: 2, open_past_due: 1 }).onTimePct, 0)
})

test('ปัดร้อยละเป็นจำนวนเต็ม (ปัดครึ่งขึ้น) และ 100% เมื่อไม่มีช้า/ค้างเลยกำหนด', () => {
  assert.equal(normalizeMonthOverview({ ...base, on_time: 1, late: 2, open_past_due: 0 }).onTimePct, 33) // 33.3
  assert.equal(normalizeMonthOverview({ ...base, on_time: 2, late: 1, open_past_due: 0 }).onTimePct, 67) // 66.7
  assert.equal(normalizeMonthOverview({ ...base, on_time: 5, late: 0, open_past_due: 0 }).onTimePct, 100)
  assert.equal(normalizeMonthOverview({ ...base, on_time: 1, late: 1, open_past_due: 0 }).onTimePct, 50)
})

test('ค้างที่เลยกำหนดอยู่ในตัวหาร (ปล่อยเรื่องยากค้างไว้ต้องไม่ทำให้ร้อยละดูดีขึ้น)', () => {
  const withoutOpen = normalizeMonthOverview({ ...base, on_time: 4, late: 0, open_past_due: 0 }).onTimePct
  const withOpen = normalizeMonthOverview({ ...base, on_time: 4, late: 0, open_past_due: 4 }).onTimePct
  assert.equal(withoutOpen, 100)
  assert.equal(withOpen, 50)
})

test('ค่าติดลบ / สตริง / ไม่ใช่ตัวเลข → 0 · สตริงตัวเลขอ่านเป็นตัวเลข · ทศนิยมปัดลง', () => {
  const m = normalizeMonthOverview({
    scope: 'municipality', received: -5, completed: 'abc', on_time: null, late: undefined,
    no_due: NaN, open_past_due: '4', open_now: 2.9,
  })
  assert.equal(m.received, 0)
  assert.equal(m.completed, 0)
  assert.equal(m.onTime, 0)
  assert.equal(m.late, 0)
  assert.equal(m.noDue, 0)
  assert.equal(m.openPastDue, 4)
  assert.equal(m.openNow, 2)
  assert.equal(m.onTimePct, 0, 'ตัวหาร 4 / ตรงเวลา 0 = 0%')
})

test('periodText วันที่ 1 (ต้นเดือน = วันนี้) → วันเดียว ไม่มีขีด', () => {
  const m = normalizeMonthOverview({ ...base, month_start: '2026-11-01', today: '2026-11-01' })
  assert.equal(m.periodText, '1 พฤศจิกายน 2569')
})

test('periodText ปกติ: ช่วง 1–N เดือนไทยเต็ม ปี พ.ศ.', () => {
  assert.equal(normalizeMonthOverview({ ...base, today: '2026-11-16' }).periodText, '1–16 พฤศจิกายน 2569')
  assert.equal(normalizeMonthOverview({ ...base, month_start: '2026-02-01', today: '2026-02-28' }).periodText, '1–28 กุมภาพันธ์ 2569')
})

test('periodText ปีข้าม: ธันวาคม → ปี พ.ศ. ตามปีนั้น · มกราคมปีถัดไป +1', () => {
  assert.equal(normalizeMonthOverview({ ...base, month_start: '2026-12-01', today: '2026-12-31' }).periodText, '1–31 ธันวาคม 2569')
  assert.equal(normalizeMonthOverview({ ...base, month_start: '2027-01-01', today: '2027-01-05' }).periodText, '1–5 มกราคม 2570')
})

test('periodText ผิดรูป/วันที่ไม่มีจริง/ไม่ส่งมา → สตริงว่าง ไม่พัง', () => {
  for (const [monthStart, today] of [
    ['', ''], [undefined, undefined], [null, '2026-11-16'], ['2026-11-01', 'พรุ่งนี้'],
    ['2026-13-01', '2026-11-16'], ['2026-11-01', '2026-11-31'], ['2026/11/01', '2026/11/16'], [20261101, 20261116],
  ]) {
    const m = normalizeMonthOverview({ ...base, month_start: monthStart, today })
    assert.equal(m.periodText, '', `${monthStart} / ${today}`)
  }
})

test('วันที่ที่มีเวลาต่อท้าย (ISO) ยังอ่านได้และตัดเหลือวันที่', () => {
  const m = normalizeMonthOverview({ ...base, month_start: '2026-11-01T00:00:00+07:00', today: '2026-11-16T09:30:00+07:00' })
  assert.equal(m.periodText, '1–16 พฤศจิกายน 2569')
  assert.equal(m.monthStart, '2026-11-01')
  assert.equal(m.today, '2026-11-16')
})

test('"วิธีคิด": scope กองมีประโยค "กองของฉัน" · scope หน่วยงานตัดออก · ค่าคงที่ตรงกับ scope กอง', () => {
  assert.ok(monthOverviewRule('department').includes('"กองของฉัน"'))
  assert.ok(!monthOverviewRule('municipality').includes('กองของฉัน'))
  assert.equal(MONTH_OVERVIEW_RULE, monthOverviewRule('department'))
  // ส่วนที่ใช้ร่วมกันต้องอยู่ในทั้งสองแบบ: สูตร + ข้อยกเว้นหมวด
  for (const scope of ['department', 'municipality']) {
    const rule = monthOverviewRule(scope)
    assert.ok(rule.includes('เสร็จทันกำหนด ÷ (เสร็จทันกำหนด + เสร็จช้า + ค้างที่เลยกำหนด)'))
    assert.ok(rule.includes('ไม่นับหมวดเฉพาะกิจและหมวดร้องเรียนเจ้าหน้าที่'))
  }
  assert.ok(monthOverviewRule('municipality').endsWith('(คุ้มครองผู้ร้อง)'))
})

test('ผลลัพธ์ไม่มีชื่อคน/เลขคำร้อง และถ้อยคำบนจอไม่มี "ไม่ใช้ AI"', () => {
  const m = normalizeMonthOverview({ ...base, requester_name: 'สมชาย', ref_no: 'CP-1' })
  assert.ok(!('requester_name' in m) && !('ref_no' in m))
  assert.ok(!JSON.stringify(m).includes('สมชาย'))
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const strip = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  for (const path of ['src/lib/staffMonthOverview.js', 'src/components/staff/StaffMonthOverview.jsx']) {
    assert.ok(!/ไม่ใช้\s*AI|ไม่ได้ใช้\s*AI/i.test(strip(read(path))), `${path}: ห้ามเขียน "ไม่ใช้ AI" บนจอ`)
  }
})

console.log(`\n${cases} cases passed`)
