// ตรรกะล้วนของ "งานของฉัน/กองของฉัน" บนหน้าแรกเจ้าหน้าที่ — ไฟล์นี้ห้าม import supabase
// (เทสต์ node tests/staff-home-summary.test.mjs import ตรง) ข้อมูลมาจาก RPC 2 ตัวใน migration
//   20261012130000 staff_home_summary  ·  20261012130100 staff_dept_workload
import { addWorkingDays } from './workingDays.js'
import { taskLabel } from './eventAssignment.js'

// ใกล้ครบกำหนด = ครบกำหนดภายใน 1 วันทำการนับจากวันนี้ (วันนี้ + วันทำการถัดไป)
// ค่าเดียวกับที่บอกในหน้าจอ ถ้าเปลี่ยนต้องแก้ถ้อยคำ "ภายใน 1 วันทำการ" ใน StaffOperationalDashboard ด้วย
export const SOON_WORKING_DAYS = 1

/**
 * แยกคำร้องที่ถืออยู่ตามกำหนดเสร็จ
 *  - overdue : เลยวันกำหนดแล้ว (due < วันนี้) — เทียบแบบวันปฏิทิน เพราะ due_date ถูกตั้งเป็นวันทำการอยู่แล้ว
 *              (trigger auto_assign_complaint ใช้ add_working_days) · วันศุกร์เลยกำหนด เปิดดูวันเสาร์ก็ยังเป็น "เลยกำหนด"
 *  - soon    : วันนี้ ถึง วันทำการถัดไป (เปิดวันศุกร์ = ถึงวันจันทร์)
 *  - later   : หลังจากนั้น
 *  - noDue   : ไม่มีวันกำหนด (ไม่เดาว่าเลย — ไม่มีกฎให้ตัดสิน)
 * today ต้องเป็นวันที่ตามเวลาไทยจาก RPC (ไม่ใช้นาฬิกาเครื่องผู้ใช้ — เครื่องตั้งเวลาเพี้ยนแล้วเลขจะผิดเงียบๆ)
 */
export function bucketComplaintDue(rows, today) {
  const out = { overdue: 0, soon: 0, later: 0, noDue: 0, open: 0 }
  if (!today || !Array.isArray(rows)) return out
  const soonLimit = addWorkingDays(today, SOON_WORKING_DAYS)
  for (const row of rows) {
    const n = Number(row?.n)
    if (!Number.isFinite(n) || n <= 0) continue
    out.open += n
    const due = typeof row?.due === 'string' ? row.due.slice(0, 10) : null
    if (!due) out.noDue += n
    else if (due < today) out.overdue += n
    else if (soonLimit && due <= soonLimit) out.soon += n
    else out.later += n
  }
  return out
}

/** "09:00" จาก time ของ Postgres ('09:00:00') — ไม่มีเวลา = null */
export function shortTime(value) {
  const m = /^(\d{2}):(\d{2})/.exec(String(value ?? ''))
  return m ? `${m[1]}:${m[2]}` : null
}

/**
 * กิจกรรมที่มอบหมายให้ฉัน แยกเป็น วันนี้ / พรุ่งนี้ (กิจกรรมหลายวันที่คาบเกี่ยววันนี้นับเป็นวันนี้)
 * ค่า date/end_date เป็น 'YYYY-MM-DD' ตามเวลาไทย เทียบสตริงกับ today ที่ RPC ส่งมาได้ตรงๆ
 */
export function groupMyEvents(events, today) {
  const rows = (Array.isArray(events) ? events : [])
    .filter(e => e && e.title && typeof e.date === 'string')
    .map(e => {
      const start = e.date.slice(0, 10)
      const end = typeof e.end_date === 'string' && e.end_date.slice(0, 10) >= start ? e.end_date.slice(0, 10) : start
      return {
        id: e.id, title: String(e.title), time: shortTime(e.time), location: e.location ? String(e.location) : null,
        task: taskLabel(e.task) || null, ongoing: start < today && end >= today, start,
        day: start <= today && end >= today ? 'today' : 'tomorrow',
      }
    })
  return {
    today: rows.filter(e => e.day === 'today'),
    tomorrow: rows.filter(e => e.day === 'tomorrow'),
  }
}

/** แถวภาระงานของกอง — ปรับให้ปลอดภัยต่อข้อมูลผิดรูป (ตัวเลขติดลบ/ไม่ใช่ตัวเลข = 0) และชื่อว่าง */
export function normalizeWorkload(payload) {
  const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0)
  const members = (Array.isArray(payload?.members) ? payload.members : []).map(m => ({
    id: String(m?.id ?? ''),
    name: String(m?.name ?? '').trim() || null,
    open: num(m?.open), unstarted: num(m?.unstarted), overdue: num(m?.overdue),
  })).filter(m => m.id)
  return {
    departmentName: String(payload?.department_name ?? '').trim() || null,
    unassigned: num(payload?.unassigned),
    members,
    totals: members.reduce((t, m) => ({ open: t.open + m.open, overdue: t.overdue + m.overdue }), { open: 0, overdue: 0 }),
  }
}

/**
 * หน้าแรกเจ้าหน้าที่ควรขึ้น "ไม่มีงานค้าง" ได้เมื่อไร — ต้องรู้ครบทุกแหล่งว่าเป็น 0 จริง
 * (เลข badge ทั้งสามตัว + สรุปกำหนดเสร็จ) ห้ามขึ้นถ้าแหล่งใดยังโหลดอยู่/พัง เพราะค่าเริ่มต้นของทุกตัวคือ 0
 * @returns {'loading'|'error'|'pending'|'clear'|'holding'}
 *   holding = ไม่มีงานเร่ง แต่ยังถือคำร้องที่ยังไม่ถึงกำหนดอยู่ (บอกตรงๆ ไม่ใช่ "ไม่มีงาน")
 */
export function todoState({ badgeStatuses, badgeCounts, summaryStatus, due }) {
  const statuses = [...badgeStatuses, summaryStatus].filter(Boolean)
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('loading')) return 'loading'
  const badgeTotal = badgeCounts.reduce((s, n) => s + (Number(n) > 0 ? Number(n) : 0), 0)
  if (badgeTotal > 0 || (due?.overdue ?? 0) > 0 || (due?.soon ?? 0) > 0) return 'pending'
  return (due?.open ?? 0) > 0 ? 'holding' : 'clear'
}
