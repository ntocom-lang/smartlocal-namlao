// Suggestions only. PostgreSQL recomputes the complete plan under the resource lock.
import { activeOrgTerms } from './orgTerms.js'

// คำเรียกหน่วยงานสั้นตามประเภทจริง (อบต./ทต./ทม./ทน./อบจ.) — เดิมฝัง "อบต." ตายตัว
// ทำให้เทศบาลเห็นข้อความผิดประเภท · org_type ที่ไม่มีตัวย่อ (เช่น 'เทศบาล' เฉยๆ) ใช้คำกลาง
export function orgAbbr() { return activeOrgTerms().abbr || 'หน่วยงาน' }
export const BOOKING_STATUS = { submitted: 'รับคำขอแล้ว รอยืนยันรถ', confirmed: 'ยืนยันรถแล้ว', completed: 'จบเที่ยวแล้ว', cancelled: 'ยกเลิกแล้ว' }
export const TRIP_STATUS = { confirmed: 'ยืนยันรถแล้ว', outbound: 'กำลังรับ–ส่งขาไป', hospital: 'ถึงโรงพยาบาล รอรับกลับ', returning: 'กำลังรับ–ส่งขากลับ', completed: 'จบเที่ยวแล้ว', issue: 'ต้องประสานเหตุขัดข้อง', cancelled: 'ยกเลิกแผนเที่ยว' }
export const RETURN_MODES = { wait: 'รอรับกลับ', later: 'กลับมารับภายหลัง', one_way: 'ขาไปอย่างเดียว' }
export const MOBILITY = { walk: 'เดินได้เอง', wheelchair: 'ใช้รถเข็น', stretcher: 'ใช้เปล' }
export const inputClass = 'w-full min-h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900'
export const buttonClass = 'min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50'
export const primaryClass = 'min-h-11 rounded-xl bg-sky-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50'
export function thaiDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)?.value).join('-')
}
export function dateTime(value) {
  return value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'ยังไม่ทราบ'
}
export function clockTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
export function minutes(value) { const [h, m] = value.split(':').map(Number); return h * 60 + m }
export function bangkokISO(day, time) { return day && time ? new Date(`${day}T${time}:00+07:00`).toISOString() : null }

// Reasons shown while booking; keyed by the same day_status the public calendar RPC returns.
export const DAY_BLOCKED = {
  past: 'วันที่ผ่านมาแล้ว กรุณาเลือกวันถัดไป',
  unavailable: 'รถหรือคนขับยังไม่พร้อมให้บริการในช่วงนี้',
  unverified: 'ยังไม่ได้ตรวจปฏิทินวันหยุดถึงวันนี้ กรุณาเลือกวันที่ใกล้กว่านี้หรือติดต่อเจ้าหน้าที่',
  closed: 'ตรงวันหยุดให้บริการ (เสาร์–อาทิตย์และวันหยุดของหน่วยงาน)',
  lead_time: 'พ้นกำหนดจองล่วงหน้าแล้ว กรุณาเลือกวันที่ไกลกว่านี้',
  issue: 'วันนี้มีเหตุขัดข้องที่ยังไม่คลี่คลาย กรุณาเลือกวันอื่นหรือติดต่อเจ้าหน้าที่',
}

// Mirrors ptb_plan for a single booking so the form warns before the request reaches the queue.
// PostgreSQL still recomputes the whole plan under the resource lock before any confirmation.
export function journeyWindow({ time, back, return_mode: returnMode, route_id: routeId }, info) {
  const route = info?.routes?.find(r => r.id === routeId)
  if (!route || !time || !Number.isFinite(info?.buffer_minutes) || !Number.isFinite(info?.boarding_minutes)) return null
  const travel = Number(route.minutes)
  const appointment = minutes(time)
  const start = appointment - (travel + info.buffer_minutes + info.boarding_minutes)
  const outbound = appointment + info.boarding_minutes + travel
  if (returnMode === 'one_way') return { start, end: outbound }
  if (!back) return { start, end: null }
  return { start, end: minutes(back) + info.boarding_minutes + travel + info.buffer_minutes }
}

export function suggestGroups(bookings, settings) {
  const pending = bookings.filter(r => r.status === 'submitted').sort((a, b) => a.appointment_at.localeCompare(b.appointment_at) || a.id.localeCompare(b.id))
  const groups = []
  for (const r of pending) {
    const group = groups.find(g => {
      const first = g[0]
      return settings?.seats && r.share && r.mobility === 'walk' && g.every(x => x.share && x.mobility === 'walk')
        && first.route_id === r.route_id && first.return_mode === r.return_mode && thaiDay(first.appointment_at) === thaiDay(r.appointment_at)
        && Math.abs(new Date(first.appointment_at) - new Date(r.appointment_at)) <= 30 * 60000
        && (r.return_mode === 'one_way' || (r.return_at && first.return_at && Math.abs(new Date(first.return_at) - new Date(r.return_at)) <= 30 * 60000))
        && g.reduce((n, x) => n + 1 + x.companions, 1 + r.companions) <= settings.seats
    })
    if (group) group.push(r)
    else groups.push([r])
  }
  return groups
}

export function nextTripAction(trip) {
  return { confirmed: 'ออกไปรับ', outbound: trip.plan?.return_mode === 'one_way' ? 'กลับถึงพื้นที่ · จบเที่ยว' : 'ส่งถึงครบ · รอรับกลับ', hospital: 'ออกไปรับขากลับ', returning: 'ส่งกลับครบ · จบเที่ยว' }[trip.state]
}
export function nextPassengerAction(booking, trip) {
  if (trip.state === 'outbound') return ['รับผู้เดินทางแล้ว', 'ส่งถึงโรงพยาบาลแล้ว'][booking.passenger_step]
  if (trip.state === 'returning') return { 2: 'รับกลับแล้ว', 3: 'ส่งถึงจุดหมายแล้ว' }[booking.passenger_step]
  return null
}
