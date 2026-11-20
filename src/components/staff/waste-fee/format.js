// ตัวช่วยแสดงผลของหน้าทะเบียนค่าธรรมเนียมขยะ (ไม่ใช่คอมโพเนนต์ — แยกไฟล์เพื่อให้ fast refresh ทำงาน)
// วันที่/เงิน/เวลาประทับใช้ชุดเดียวกับทะเบียนใบอนุญาต (ภาษาหน้าจอเดียวกัน)
import { thaiShortDate } from '../../../lib/complaintReportPeriods'
export { fmtDate, fmtDateTime, fmtMoney } from '../licence/format'

/** เดือนแบบย่อ พ.ศ. จากวันที่ ISO: 2026-11-01 → "พ.ย. 2569" · ว่าง/ผิดรูป = — */
export const fmtMonth = iso => (/^\d{4}-\d{2}-\d{2}/.test(String(iso ?? '')) ? thaiShortDate(String(iso).slice(0, 10)).replace(/^\d+\s/, '') : '—')

/** ค่าของ <input type="month"> (yyyy-mm) จากวันที่ ISO */
export const toMonthInput = iso => (/^\d{4}-\d{2}/.test(String(iso ?? '')) ? String(iso).slice(0, 7) : '')
