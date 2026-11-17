// ตัวช่วยแสดงผลของหน้าทะเบียนใบอนุญาต (ไม่ใช่คอมโพเนนต์ — แยกไฟล์เพื่อให้ fast refresh ทำงาน)
import { thaiShortDate } from '../../../lib/complaintReportPeriods'

/** วันที่ พ.ศ. แบบย่อ (28 ต.ค. 2569) · ว่าง/ผิดรูป = — */
export const fmtDate = iso => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? '')) ? thaiShortDate(iso) : '—')

/** จำนวนเงิน 2 ตำแหน่ง */
export const fmtMoney = n => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))
  ? '—' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

/** เวลาประทับของประวัติ: 28 ต.ค. 2569 14:05 (เวลาไทย) */
export function fmtDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return `${thaiShortDate(iso)} ${time}`
}
