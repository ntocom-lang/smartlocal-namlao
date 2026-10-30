// มุมมอง "ปี" ของรายงานคำร้องฝั่งเจ้าหน้าที่/แอดมินต้องนับตามปีงบประมาณ ให้ตรงกับหน้าสาธารณะ /reports/complaints
// ใช้วันที่เวลาท้องถิ่นของเครื่อง (ไม่ใช่สตริง UTC) เพราะ ReportManager อ่านวันที่ตามเวลาเครื่อง — รันบน CI โซนไหนก็ได้ผลเท่ากัน
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isInFiscalMonth, isInReportPeriod, reportFiscalYears } from '../src/lib/complaintReportPeriod.js'
import { FISCAL_MONTHS_TH } from '../src/lib/fiscalYear.js'

const at = (year, monthIndex, day, hour = 12) => new Date(year, monthIndex, day, hour).toISOString()
const fiscal = fiscalYear => ({ view: 'year', month: 0, year: 0, fiscalYear })

test('ขอบปีงบ: 30 ก.ย. 2569 อยู่ปีงบ 2569 · 1 ต.ค. 2569 อยู่ปีงบ 2570 (เคสที่สองหน้าเคยนับไม่ตรงกัน)', () => {
  assert.equal(isInReportPeriod(at(2026, 8, 30, 23), fiscal(2569)), true)
  assert.equal(isInReportPeriod(at(2026, 8, 30, 23), fiscal(2570)), false)
  assert.equal(isInReportPeriod(at(2026, 9, 1, 0), fiscal(2570)), true)
  assert.equal(isInReportPeriod(at(2026, 9, 1, 0), fiscal(2569)), false)
})

test('ปีงบครอบคลุมสองปีปฏิทิน: ม.ค. 2570 กับ ธ.ค. 2569 อยู่ปีงบเดียวกัน', () => {
  assert.equal(isInReportPeriod(at(2026, 11, 31), fiscal(2570)), true)
  assert.equal(isInReportPeriod(at(2027, 0, 1), fiscal(2570)), true)
})

test('มุมมองรายเดือนยังเลือกตามปีปฏิทิน และ "ทั้งหมด" รับทุกวันที่', () => {
  const october = { view: 'month', month: 9, year: 2026, fiscalYear: 2569 }
  assert.equal(isInReportPeriod(at(2026, 9, 15), october), true)
  assert.equal(isInReportPeriod(at(2025, 9, 15), october), false)
  assert.equal(isInReportPeriod(at(2001, 0, 1), { view: 'all' }), true)
})

test('แนวโน้มรายเดือน: เรียง ต.ค.→ก.ย. และแยกเดือนเดียวกันของคนละปีงบ', () => {
  assert.deepEqual(FISCAL_MONTHS_TH.map(m => m.label).slice(0, 4), ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.'])
  assert.equal(isInFiscalMonth(at(2026, 9, 15), 2570, 10), true)
  assert.equal(isInFiscalMonth(at(2025, 9, 15), 2570, 10), false)
  assert.equal(isInFiscalMonth(at(2027, 0, 15), 2570, 1), true)
  assert.equal(isInFiscalMonth(at(2026, 0, 15), 2570, 1), false)
})

test('ตัวเลือกปีงบ: ปีที่มีข้อมูล + ปีงบปัจจุบันเสมอ เรียงล่าสุดก่อน ไม่ซ้ำ', () => {
  const now = new Date(2026, 9, 30)
  const complaints = [{ created_at: at(2025, 0, 10) }, { created_at: at(2025, 11, 10) }, { created_at: at(2026, 1, 10) }]
  assert.deepEqual(reportFiscalYears(complaints, now), [2570, 2569, 2568])
  assert.deepEqual(reportFiscalYears([], now), [2570])
})

test('ReportManager ใช้ตัวนับกลาง ไม่กลับไปนับปีปฏิทินเอง และบอกช่วงวันที่ของปีงบ', async () => {
  const source = await readFile(new URL('../src/components/admin/ReportManager.jsx', import.meta.url), 'utf8')
  assert.ok(source.includes('isInReportPeriod(c.created_at, period)'), 'ยอดรับเข้าต้องใช้ตัวนับกลาง')
  assert.ok(source.includes('isInReportPeriod(c.updated_at, period)'), 'เวลาเฉลี่ยต้องใช้ตัวนับกลาง')
  assert.ok(source.includes('fiscalPeriodLabel(fiscalYear)'), 'ใบพิมพ์/หัวรายงานต้องมีช่วงวันที่ของปีงบ')
  assert.ok(!source.includes("view === 'year')  return d.getFullYear()"), 'ห้ามนับรายปีตามปีปฏิทิน')
})
