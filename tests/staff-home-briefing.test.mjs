// Pure-logic test สำหรับ src/lib/staffHomeBriefing.js — "สรุปวันนี้" ในแถบหัวหน้าแรกเจ้าหน้าที่
// ไม่ใช้ฐานข้อมูล ไม่ใช้เบราว์เซอร์
//
// จุดที่ต้องกันที่สุด: ห้ามสรุปว่า "ไม่มีงานค้าง" จากตัวเลขที่ยังไม่รู้ (กำลังโหลด/พัง) — ไฟเขียวปลอมอันตรายกว่าไม่มีไฟ
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STAFF_BRIEFING_MAX_LINES, STAFF_BRIEFING_RULE, buildStaffBriefing } from '../src/lib/staffHomeBriefing.js'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const rain = { id: 'hazard:heavy_rain', what: 'พยากรณ์ฝนหนักพรุ่งนี้', brief: 'พรุ่งนี้ (17 พ.ย.) พยากรณ์ฝนหนัก 42.5 มม. — ควรเตรียมรับมือ' }
const dust = { id: 'hazard:pm25', what: 'ฝุ่น PM2.5 เริ่มมีผลกระทบต่อสุขภาพ' } // ไม่มี brief → ใช้ what

test('ยังโหลดไม่เสร็จ → null (ไม่ขึ้นบรรทัดสรุป)', () => {
  assert.equal(buildStaffBriefing({ ready: true, state: 'loading', waiting: 0, overdue: 0 }), null)
  assert.equal(buildStaffBriefing({ ready: false, state: 'pending', waiting: 3 }), null)
  assert.equal(buildStaffBriefing({ state: 'pending', waiting: 3 }), null, 'ไม่ส่ง ready = ไม่พร้อม')
  assert.equal(buildStaffBriefing(), null)
})

test('มีแหล่งตัวเลขพัง (state error) → null ไม่ขึ้นสรุปจากตัวเลขไม่ครบ', () => {
  assert.equal(buildStaffBriefing({ ready: true, state: 'error', waiting: 0, overdue: 0, hazards: [rain] }), null)
})

test('ไม่มีงานค้าง (clear) → "วันนี้ไม่มีงานค้าง" tone clear', () => {
  assert.deepEqual(buildStaffBriefing({ ready: true, state: 'clear', waiting: 0, overdue: 0, soon: 0 }),
    { lines: ['วันนี้ไม่มีงานค้าง'], tone: 'clear' })
})

test('clear + ภัยที่กำลังมา → บรรทัด 2 เป็นภัยแรก (ใช้ brief ก่อน what)', () => {
  const b = buildStaffBriefing({ ready: true, state: 'clear', hazards: [rain, dust] })
  assert.deepEqual(b.lines, ['วันนี้ไม่มีงานค้าง', rain.brief])
  assert.equal(b.tone, 'clear')
  assert.deepEqual(buildStaffBriefing({ ready: true, state: 'clear', hazards: [dust] }).lines, ['วันนี้ไม่มีงานค้าง', dust.what])
})

test('เลยกำหนดชนะงานรอ: ขึ้นบรรทัดเลยกำหนด tone urgent', () => {
  const b = buildStaffBriefing({ ready: true, state: 'pending', waiting: 5, overdue: 2, soon: 1 })
  assert.equal(b.lines[0], 'มีคำร้องเลยกำหนด 2 ใบ ควรเร่งดำเนินการ')
  assert.equal(b.tone, 'urgent')
  assert.ok(!b.lines.some(l => l.includes('มีงานรอคุณ')), 'บรรทัดงานมีบรรทัดเดียว ไม่ซ้อนกัน')
})

test('งานรอ + ใกล้ครบกำหนด: "มีงานรอคุณ N เรื่อง · ใกล้ครบกำหนด M ใบ"', () => {
  const b = buildStaffBriefing({ ready: true, state: 'pending', waiting: 3, overdue: 0, soon: 2 })
  assert.deepEqual(b, { lines: ['มีงานรอคุณ 3 เรื่อง · ใกล้ครบกำหนด 2 ใบ'], tone: 'normal' })
  assert.deepEqual(buildStaffBriefing({ ready: true, state: 'pending', waiting: 3, overdue: 0, soon: 0 }).lines, ['มีงานรอคุณ 3 เรื่อง'])
})

test('ใกล้ครบอย่างเดียว (ไม่มีงานรอ/เลยกำหนด) ไม่ปล่อยบรรทัดงานว่าง', () => {
  assert.deepEqual(buildStaffBriefing({ ready: true, state: 'pending', waiting: 0, overdue: 0, soon: 2 }).lines, ['มีคำร้องใกล้ครบกำหนด 2 ใบ'])
})

test('holding: ถือคำร้องอยู่แต่ยังไม่ถึงกำหนด → "ไม่มีงานเร่งด่วน" (ไม่ใช่ "ไม่มีงานค้าง")', () => {
  const b = buildStaffBriefing({ ready: true, state: 'holding', waiting: 0, overdue: 0, soon: 0 })
  assert.deepEqual(b, { lines: ['ไม่มีงานเร่งด่วน'], tone: 'normal' })
  assert.ok(!b.lines.join('').includes('ไม่มีงานค้าง'))
})

test('ภัยที่กำลังมาขึ้นบรรทัด 2 · ไม่มีภัยแต่มีกิจกรรมวันนี้ → บรรทัดกิจกรรม', () => {
  const withHazard = buildStaffBriefing({ ready: true, state: 'pending', waiting: 2, eventsToday: 3, hazards: [rain] })
  assert.deepEqual(withHazard.lines, ['มีงานรอคุณ 2 เรื่อง', rain.brief], 'ภัยชนะกิจกรรม')
  const withEvents = buildStaffBriefing({ ready: true, state: 'pending', waiting: 2, eventsToday: 3, hazards: [] })
  assert.deepEqual(withEvents.lines, ['มีงานรอคุณ 2 เรื่อง', 'วันนี้มีกิจกรรมที่ได้รับมอบหมาย 3 รายการ'])
})

test('ไม่เกิน 2 บรรทัดเสมอ (แม้มีภัยหลายตัว + กิจกรรม + เลยกำหนด)', () => {
  const b = buildStaffBriefing({ ready: true, state: 'pending', waiting: 9, overdue: 4, soon: 2, eventsToday: 5, hazards: [rain, dust] })
  assert.ok(b.lines.length <= STAFF_BRIEFING_MAX_LINES)
  assert.equal(b.lines.length, 2)
  const c = buildStaffBriefing({ ready: true, state: 'clear', hazards: [rain, dust], eventsToday: 4 })
  assert.equal(c.lines.length, 2)
})

test('ค่าที่ไม่ใช่ตัวเลข/ติดลบ/ว่าง ถือเป็น 0 · ทศนิยมปัดลง · ไม่มีอะไรจะสรุป = null', () => {
  assert.equal(buildStaffBriefing({ ready: true, state: 'pending', waiting: 'x', overdue: -3, soon: null, eventsToday: undefined }), null)
  assert.deepEqual(buildStaffBriefing({ ready: true, state: 'pending', waiting: '4', overdue: 'abc' }).lines, ['มีงานรอคุณ 4 เรื่อง'])
  assert.deepEqual(buildStaffBriefing({ ready: true, state: 'pending', waiting: 2.9 }).lines, ['มีงานรอคุณ 2 เรื่อง'])
  // ภัยผิดรูป (ไม่มีข้อความ) ไม่ทำให้พังและไม่ขึ้นบรรทัดเปล่า
  assert.deepEqual(buildStaffBriefing({ ready: true, state: 'pending', waiting: 1, hazards: [null, {}, { what: '' }] }).lines, ['มีงานรอคุณ 1 เรื่อง'])
})

test('ตัวเลขใช้รูปแบบไทย (th-TH) และข้อความไม่มีชื่อคน', () => {
  const b = buildStaffBriefing({ ready: true, state: 'pending', waiting: 1234 })
  assert.equal(b.lines[0], `มีงานรอคุณ ${(1234).toLocaleString('th-TH')} เรื่อง`)
})

test('ถ้อยคำ "วิธีคิด": เป็นข้อความที่เจ้าของกำหนด และไม่มีคำว่า "ไม่ใช้ AI" ที่ไหนในไฟล์ที่ขึ้นหน้าจอ', () => {
  assert.equal(STAFF_BRIEFING_RULE, 'ระบบสรุปจากตัวเลขในหน้านี้ตามลำดับ: งานเลยกำหนด → งานรอคุณ → ภัยที่กำลังมา → กิจกรรมวันนี้ ไม่เกิน 2 บรรทัด · ตัวเลขที่ยังโหลดไม่ได้จะไม่ถูกสรุป')
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const strip = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  for (const path of ['src/lib/staffHomeBriefing.js', 'src/components/staff/StaffHomeHero.jsx', 'src/components/staff/StaffAreaSituation.jsx', 'src/components/staff/StaffOperationalDashboard.jsx']) {
    assert.ok(!/ไม่ใช้\s*AI|ไม่ได้ใช้\s*AI/i.test(strip(read(path))), `${path}: ห้ามเขียน "ไม่ใช้ AI" บนจอ`)
  }
})

console.log(`\n${cases} cases passed`)
