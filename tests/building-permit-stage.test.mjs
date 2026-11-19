// ขั้นความคืบหน้าใบอนุญาตก่อสร้าง + ข้อความวันหมดอายุ (src/lib/buildingPermitStage.js) — node ล้วน ไม่ต่อ DB
import assert from 'node:assert/strict'
import {
  PERMIT_STAGES, stageIndex, nextStage, stageAllowsPermitFields, permitExpiryInfo, bangkokTodayIso, thaiShortDate,
} from '../src/lib/buildingPermitStage.js'

let passed = 0
const t = (name, fn) => { fn(); passed += 1; console.log('  ✓', name) }

t('ลำดับขั้น 6 ขั้น เริ่มที่ null จบที่ collected', () => {
  assert.deepEqual(PERMIT_STAGES.map(s => s.key), [null, 'doc_check', 'site_inspection', 'review', 'issued', 'collected'])
  assert.equal(PERMIT_STAGES[0].label, 'รับคำขอแล้ว')
  assert.equal(PERMIT_STAGES[4].label, 'ออกใบอนุญาตแล้ว รอรับ')
})

t('stageIndex: null/undefined/ว่าง = 0 · ค่าแปลก = -1', () => {
  assert.equal(stageIndex(null), 0)
  assert.equal(stageIndex(undefined), 0)
  assert.equal(stageIndex(''), 0)
  assert.equal(stageIndex('review'), 3)
  assert.equal(stageIndex('collected'), 5)
  assert.equal(stageIndex('nope'), -1)
})

t('nextStage: เดินไปทีละขั้น และขั้นสุดท้าย/ค่าแปลกไม่มีขั้นถัดไป', () => {
  assert.equal(nextStage(null).key, 'doc_check')
  assert.equal(nextStage('doc_check').key, 'site_inspection')
  assert.equal(nextStage('review').key, 'issued')
  assert.equal(nextStage('issued').key, 'collected')
  assert.equal(nextStage('collected'), null)
  assert.equal(nextStage('nope'), null)
})

t('stageAllowsPermitFields: เฉพาะ issued/collected', () => {
  for (const s of [null, 'doc_check', 'site_inspection', 'review']) assert.equal(stageAllowsPermitFields(s), false)
  for (const s of ['issued', 'collected']) assert.equal(stageAllowsPermitFields(s), true)
})

t('permitExpiryInfo: เหลือหลายวัน (tone ok)', () => {
  const r = permitExpiryInfo('2027-11-01', '2026-11-19')
  assert.equal(r.daysLeft, 347)
  assert.equal(r.expired, false)
  assert.equal(r.tone, 'ok')
  assert.equal(r.text, 'ใช้ได้ถึง 1 พ.ย. 2570 · เหลือ 347 วัน')
})

t('permitExpiryInfo: ไม่เกิน 30 วัน = soon (ขอบ 30 / 31)', () => {
  assert.equal(permitExpiryInfo('2026-12-19', '2026-11-19').tone, 'soon')
  assert.equal(permitExpiryInfo('2026-12-20', '2026-11-19').tone, 'ok')
  assert.equal(permitExpiryInfo('2026-11-20', '2026-11-19').daysLeft, 1)
})

t('permitExpiryInfo: วันนี้เป็นวันสุดท้าย = ยังไม่หมด', () => {
  const r = permitExpiryInfo('2026-11-19', '2026-11-19')
  assert.deepEqual(r, { daysLeft: 0, expired: false, tone: 'soon', text: 'ใช้ได้ถึงวันนี้' })
})

t('permitExpiryInfo: หมดแล้ว (เมื่อวานเป็นต้นไป)', () => {
  const r = permitExpiryInfo('2026-11-18', '2026-11-19')
  assert.equal(r.expired, true)
  assert.equal(r.tone, 'expired')
  assert.equal(r.daysLeft, -1)
  assert.equal(r.text, 'หมดอายุแล้ว (ใช้ได้ถึง 18 พ.ย. 2569)')
  assert.equal(permitExpiryInfo('2027-11-01', '2028-01-10').text, 'หมดอายุแล้ว (ใช้ได้ถึง 1 พ.ย. 2570)')
})

t('permitExpiryInfo: ไม่มีวันหมดอายุ/รูปแบบผิด = null', () => {
  assert.equal(permitExpiryInfo(null, '2026-11-19'), null)
  assert.equal(permitExpiryInfo(undefined, '2026-11-19'), null)
  assert.equal(permitExpiryInfo('', '2026-11-19'), null)
  assert.equal(permitExpiryInfo('19/11/2026', '2026-11-19'), null)
  assert.equal(permitExpiryInfo('2026-13-40', '2026-11-19'), null)
})

t('permitExpiryInfo: ข้ามปี และปีอธิกสุรทิน', () => {
  assert.equal(permitExpiryInfo('2027-01-05', '2026-12-30').daysLeft, 6)
  assert.equal(permitExpiryInfo('2028-03-01', '2028-02-28').daysLeft, 2)
  assert.equal(permitExpiryInfo('2027-01-01', '2026-12-31').text, 'ใช้ได้ถึง 1 ม.ค. 2570 · เหลือ 1 วัน')
})

t('permitExpiryInfo: ค่า ISO ยาวก็อ่านส่วนวันที่ได้', () => {
  assert.equal(permitExpiryInfo('2026-11-19T00:00:00', '2026-11-19').daysLeft, 0)
})

t('bangkokTodayIso: ใช้ปฏิทินไทย (UTC 17:30 ของวันที่ 18 = วันที่ 19 เวลาไทย)', () => {
  assert.equal(bangkokTodayIso(new Date('2026-11-18T17:30:00Z')), '2026-11-19')
  assert.equal(bangkokTodayIso(new Date('2026-11-18T16:59:00Z')), '2026-11-18')
})

t('thaiShortDate', () => {
  assert.equal(thaiShortDate('2026-12-31'), '31 ธ.ค. 2569')
  assert.equal(thaiShortDate('xx'), '')
})

console.log(`\nผ่านทั้งหมด ${passed} กรณี`)
