// ตัวเลือกช่วงของใบ "สรุปผลการให้บริการประชาชน" (ห้องผู้บริหาร เฟส E3-1) — ฟังก์ชันล้วน ไม่อ่านนาฬิกาเอง (รับ now เข้ามา)
//
// ต่างจากปุ่มช่วงบนหน้าห้องผู้บริหาร (execPeriodRange: ทุกช่วง "นับถึงวันนี้"): ใบที่พิมพ์เข้าแฟ้มต้องเป็น "ช่วงที่จบแล้ว"
// to = วันสุดท้ายของช่วงจริง (ไม่ใช่วันนี้) ไม่งั้นตัวเลขของใบเดียวกันเปลี่ยนไปตามวันที่กดพิมพ์
//   รายเดือน   → 12 เดือนที่จบแล้วย้อนหลัง · ค่าเริ่มต้น = เดือนที่เพิ่งจบ
//   รายไตรมาส → 8 ไตรมาสปีงบที่จบแล้ว (ต.ค.–ธ.ค. / ม.ค.–มี.ค. / เม.ย.–มิ.ย. / ก.ค.–ก.ย.) · ค่าเริ่มต้น = ไตรมาสที่เพิ่งจบ
// กติกาปีงบ/ไตรมาสใช้ของกลาง (fiscalYear.js ผ่าน quarterPeriod) ไม่เขียนซ้ำ · "เดือนนี้/ไตรมาสนี้" ที่ยังไม่จบไม่อยู่ในตัวเลือก
// วันที่ทุกตัวคำนวณจากวันที่ตามปฏิทินไทย (bangkokIsoDate) ไม่พึ่งโซนเวลาเครื่อง

import { bangkokIsoDate, recentQuarterOptions, thaiDateRange } from './complaintReportPeriods.js'
import { monthPeriod } from './complaintMonthlySummary.js'

export const EXEC_REPORT_KINDS = Object.freeze(['month', 'quarter'])
export const EXEC_REPORT_KIND_LABELS = Object.freeze({ month: 'รายเดือน', quarter: 'รายไตรมาส' })
export const EXEC_REPORT_MONTH_COUNT = 12
export const EXEC_REPORT_QUARTER_COUNT = 8

/**
 * @typedef {{ kind: 'month'|'quarter', key: string, label: string, optionLabel: string, from: string, to: string, rangeText: string }} ExecReportPeriod
 *   label = หัวใบ ("ไตรมาสที่ 1 ปีงบประมาณ 2570") · optionLabel = ตัวเลือก (ไตรมาสมีเดือนกำกับ "ไตรมาส 1/2570 (ต.ค.–ธ.ค. 2569)"
 *   ชุดเดียวกับหน้า /reports/complaints — กันเลือกไตรมาสผิดในที่ประชุม · code review E3-1)
 */

const toExecPeriod = (kind, p) => ({
  kind, key: `${kind}:${p.key}`, label: p.label, optionLabel: p.optionLabel || p.label,
  from: p.from, to: p.to, rangeText: thaiDateRange(p.from, p.to),
})

/** เดือนที่จบแล้วย้อนหลัง count เดือน เรียงใหม่→เก่า (ตัวแรก = เดือนที่เพิ่งจบ) — เดือนปัจจุบันที่ยังไม่จบไม่รวม */
export function execReportMonthOptions(now = new Date(), count = EXEC_REPORT_MONTH_COUNT) {
  const today = bangkokIsoDate(now)
  const index = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) // เลขเดือนต่อเนื่อง (ปี ค.ศ. × 12 + เดือน 0-11)
  return Array.from({ length: count }, (_, i) => {
    const n = index - 1 - i
    return toExecPeriod('month', monthPeriod(Math.floor(n / 12) + 543, (n % 12) + 1))
  })
}

/** ไตรมาสปีงบที่จบแล้วย้อนหลัง count ไตรมาส เรียงใหม่→เก่า (ตัวแรก = ไตรมาสที่เพิ่งจบ) */
export function execReportQuarterOptions(now = new Date(), count = EXEC_REPORT_QUARTER_COUNT) {
  // recentQuarterOptions ตัวแรกคือไตรมาสปัจจุบัน (ยังไม่จบ) — ข้ามไป
  return recentQuarterOptions(count + 1, now).slice(1).map((q) => toExecPeriod('quarter', q))
}

export function execReportPeriodOptions(kind, now = new Date()) {
  if (kind === 'month') return execReportMonthOptions(now)
  if (kind === 'quarter') return execReportQuarterOptions(now)
  throw new Error(`ชนิดช่วงไม่รู้จัก: ${kind}`)
}

/** ค่าเริ่มต้นของแต่ละชนิด = ช่วงที่เพิ่งจบ */
export function execReportDefaultPeriod(kind, now = new Date()) {
  return execReportPeriodOptions(kind, now)[0]
}

/** หาช่วงจาก key ในตัวเลือกของชนิดนั้น (ไม่พบ = null) */
export function findExecReportPeriod(kind, key, now = new Date()) {
  return execReportPeriodOptions(kind, now).find((p) => p.key === key) ?? null
}
