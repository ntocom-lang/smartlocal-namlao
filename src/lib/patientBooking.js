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

// เลขไมล์กลับของเที่ยวก่อนหน้า "ตามเวลาเริ่มรับ" ที่ไม่ถูกยกเลิกและบันทึกเลขไมล์กลับแล้ว
// ⚠️ เดิมใช้ค่าสูงสุดของทุกเที่ยวที่โหลดมา ซึ่งหยิบเที่ยวที่วิ่งทีหลังมาได้เมื่อกรอกย้อนหลัง (ผลตรวจ #227 ข้อ 5)
// ไม่มีเที่ยวก่อนหน้าในข้อมูลที่โหลดมา (หน้าจอเห็นย้อนหลัง 30 วัน) = เว้นว่างให้กรอกเอง ดีกว่าเดาผิด
export function previousOdometer(trip, trips) {
  const at = trip?.plan?.pickup_at
  const before = trips
    .filter(t => t.id !== trip.id && t.state === 'completed' && !t.odometer_issue && Number.isFinite(t.odometer_end) && at && t.plan?.pickup_at && t.plan.pickup_at < at)
    .sort((a, b) => String(b.plan.pickup_at).localeCompare(String(a.plan.pickup_at)))
  return before.length ? before[0].odometer_end : ''
}

// Explain server validation without changing its decision. Unknown errors retain their original text.
const PLAN_FIXES = {
  'เวลารับ–ส่งอยู่นอกเวลาบริการ': 'ถ้ารถให้บริการช่วงนี้ได้จริง ให้ผู้ดูแลไป “ตั้งค่า” ปรับ “เริ่มบริการ / สิ้นสุดบริการ” หากให้บริการไม่ได้ ให้ประสานผู้จองแล้วกด “แก้ข้อมูลหลังประสาน” ปรับวันเวลานัดหรือเวลารับกลับตามจริง',
  'ยังไม่ตั้งเส้นทางโรงพยาบาลและพื้นที่จุดรับ': 'ให้ผู้ดูแลเพิ่มเส้นทางใน “ตั้งค่า” หรือกด “แก้ข้อมูลหลังประสาน” เลือกเส้นทางที่ถูกต้อง',
  'ยังไม่ยืนยันความจุรถ': 'ให้ผู้ดูแลไป “ตั้งค่า” กรอกที่นั่งผู้โดยสาร ที่ยึดรถเข็น และที่ยึดเปลตามรถจริง ช่องที่ไม่มีให้ใส่ 0',
  'รถหรือคนขับยังไม่พร้อมให้บริการ': 'ให้ผู้ดูแลตรวจ “ตั้งค่า” ว่าเปิดบริการแล้ว เลือกบัญชีคนขับแล้ว และไม่ได้ระบุรถงดบริการ ถ้ายังไม่พร้อมให้ประสานวันใหม่',
  'หน่วยงานเจ้าของรถปิดรับเรื่อง': 'ให้ผู้ดูแลตรวจทะเบียนหน่วยงานรับเรื่องต่อ ว่ากองทุนเจ้าของรถยังเปิดรับเรื่อง แล้วตรวจหน่วยงานที่เลือกใน “ตั้งค่า”',
  'บัญชีคนขับไม่ได้รับสิทธิ์เจ้าหน้าที่แล้ว': 'ให้ผู้ดูแลตรวจสิทธิ์บัญชีคนขับ หรือเลือกบัญชีเจ้าหน้าที่ที่เป็นคนขับจริงใน “ตั้งค่า”',
  'ตรงวันหยุดให้บริการ': 'ประสานวันเดินทางใหม่ แล้วกด “แก้ข้อมูลหลังประสาน” เปลี่ยนวันนัด ระบบหยุดเสาร์–อาทิตย์และวันหยุดที่หน่วยงานบันทึกไว้',
  'วันเดินทางผ่านแล้ว': 'ตรวจวันนัดกับผู้จอง แล้วกด “แก้ข้อมูลหลังประสาน” ใส่วันนัดที่ถูกต้อง หากไม่เดินทางแล้วให้ยกเลิกตามคำขอ',
  'มีคำขอที่ปิดหรือยกเลิกแล้ว': 'โหลดรายการล่าสุด แล้วเลือกเฉพาะคำขอที่ยังรอจัดคิว ไม่รวมคำขอที่จบหรือยกเลิกแล้ว',
  'ต้องตรวจสอบพื้นที่รับบริการ': 'ตรวจจุดรับกับผู้จอง แล้วกด “แก้ข้อมูลหลังประสาน” ยืนยันว่าอยู่ในพื้นที่เฉพาะเมื่อได้ตรวจแล้ว',
  'เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน': 'แยกคำขอที่ต่างเส้นทาง ต่างวัน หรือรูปแบบรับกลับไม่ตรงกัน โดยกด “ตรวจเป็นเที่ยวเดี่ยว” หากข้อมูลผิดให้แก้หลังประสาน',
  'ร่วมเที่ยวได้เฉพาะผู้เดินได้และยินดีร่วมเที่ยว': 'กด “ตรวจเป็นเที่ยวเดี่ยว” สำหรับผู้ใช้รถเข็น เปล หรือไม่ประสงค์ร่วมเที่ยว ไม่เปลี่ยนข้อมูลการเคลื่อนไหวเพื่อให้ผ่าน',
  'ยังไม่มีเวลาขากลับ': 'ประสานเวลาพร้อมรับกลับ แล้วกด “แก้ข้อมูลหลังประสาน” กรอก “เวลาพร้อมรับกลับ” ถ้าไม่ใช้ขากลับให้เลือกรูปแบบขาไปอย่างเดียวตามจริง',
  'เวลารับกลับอยู่ก่อนเวลานัด': 'กด “แก้ข้อมูลหลังประสาน” ตรวจเวลานัดและเวลาพร้อมรับกลับ เวลารับกลับต้องไม่ก่อนเวลานัด',
  'ยังไม่ยืนยันที่ยึดรถเข็น': 'ให้ผู้ดูแลตรวจ “ตั้งค่า → ที่ยึดรถเข็น” ตามอุปกรณ์จริง หากรถไม่รองรับให้ประสานรถที่เหมาะสม',
  'ยังไม่ยืนยันที่ยึดเปล': 'ให้ผู้ดูแลตรวจ “ตั้งค่า → ที่ยึดเปล” ตามอุปกรณ์จริง หากรถไม่รองรับให้ประสานรถที่เหมาะสม',
  'ต้องยืนยันผู้ช่วยเคลื่อนย้ายประจำเที่ยว': 'กรอกชื่อผู้ช่วยที่พร้อมเดินทางจริงในช่อง “ผู้ช่วยเคลื่อนย้ายที่พร้อมประจำเที่ยว” เหนือผลตรวจ แล้วตรวจแผนอีกครั้ง',
  'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว': 'ตรวจจำนวนผู้ติดตามและผู้ช่วยกับผู้จอง หากร่วมเที่ยวให้แยกเป็นเที่ยวเดี่ยว ไม่เพิ่มจำนวนที่นั่งในตั้งค่าเกินรถจริง',
  'เวลานัดห่างเกินช่วงร่วมเที่ยว': 'เที่ยวร่วมต้องมีเวลานัดห่างกันไม่เกิน 30 นาที ให้กด “ตรวจเป็นเที่ยวเดี่ยว” หรือแก้เวลานัดเฉพาะเมื่อข้อมูลเดิมผิด',
  'เวลารับกลับห่างเกินช่วงร่วมเที่ยว': 'เที่ยวร่วมต้องมีเวลาพร้อมรับกลับห่างกันไม่เกิน 30 นาที ให้แยกเที่ยวหรือประสานเวลารับกลับที่ทำได้จริง',
  'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว': 'เปิด “เที่ยวที่ยืนยันแล้ว” หรือ “ตารางออกรถ” ดูช่วงที่ชน แล้วประสานเวลาใหม่ ไม่ยกเลิกเที่ยวเดิมโดยไม่ได้ประสาน',
  'มีเหตุขัดข้องที่ยังไม่คลี่คลายในวันเดียวกัน': 'เปิด “เที่ยวที่ยืนยันแล้ว” ดูเที่ยวที่ต้องประสานเหตุขัดข้อง แก้เหตุจริงและบันทึกผลก่อนจัดคิวเพิ่ม',
}

export function bookingPlanGuidance(message, plan, workspace = {}) {
  const settings = workspace.settings || {}
  const sameSettings = plan?.settings_revision == null || settings.revision == null || plan.settings_revision === settings.revision
  const selected = (workspace.bookings || []).filter(b => plan?.booking_ids?.includes(b.id))
  let detail = ''
  if (!sameSettings) detail = 'ค่าตั้งเปลี่ยนหลังตรวจแผน กรุณาโหลดข้อมูลล่าสุดแล้วตรวจแผนอีกครั้ง'
  else if (message === 'เวลารับ–ส่งอยู่นอกเวลาบริการ' && Number.isFinite(settings.office_start) && Number.isFinite(settings.office_end) && plan?.date) {
    const midnight = Date.parse(`${plan.date}T00:00:00+07:00`)
    const open = midnight + settings.office_start * 60000
    const close = midnight + settings.office_end * 60000
    const starts = (plan.blocks || []).map(b => Date.parse(b.start)).filter(Number.isFinite)
    const ends = (plan.blocks || []).map(b => Date.parse(b.end)).filter(Number.isFinite)
    const start = starts.length ? Math.min(...starts) : Date.parse(plan.pickup_at)
    const end = ends.length ? Math.max(...ends) : NaN
    const clock = at => new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
    const problems = []
    if (start < open) problems.push(`เริ่มรับ ${clock(start)} ก่อนเวลาเปิดบริการ ${clockTime(settings.office_start)}`)
    if (end > close) problems.push(`รถกลับถึงพื้นที่ ${dateTime(end)} หลังเวลาปิดบริการ ${clockTime(settings.office_end)}`)
    detail = [...problems, `เวลาบริการที่ตั้งไว้ ${clockTime(settings.office_start)}–${clockTime(settings.office_end)} น. ระบบรวมเวลาเดินทางและเวลาเผื่อรับ–ส่งด้วย`].join(' · ')
  } else if (message === 'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว' && Number.isFinite(plan?.seats) && Number.isFinite(settings.seats)) {
    detail = `แผนนี้ต้องใช้ ${plan.seats} ที่นั่ง รวมผู้ติดตามและผู้ช่วยแล้ว แต่รถตั้งไว้ ${settings.seats} ที่นั่ง ไม่รวมคนขับ`
  } else if (message === 'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว') {
    const conflicts = (workspace.trips || []).filter(t => t.state !== 'cancelled' && !(t.booking_ids || []).some(id => plan?.booking_ids?.includes(id)) && (t.plan?.blocks || []).some(old => (plan?.blocks || []).some(b => Date.parse(old.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(old.end))))
    detail = conflicts.map(t => `${t.plan.route_label || 'เที่ยวเดิม'} · เริ่มรับ ${dateTime(t.plan.pickup_at)}`).join(' / ')
  } else if (['เวลานัดห่างเกินช่วงร่วมเที่ยว', 'เวลารับกลับห่างเกินช่วงร่วมเที่ยว', 'ยังไม่มีเวลาขากลับ', 'เวลารับกลับอยู่ก่อนเวลานัด'].includes(message)) {
    detail = selected.map(b => `${b.patient_name} · นัด ${dateTime(b.appointment_at)} · พร้อมรับกลับ ${dateTime(b.return_at)}`).join(' / ')
  }
  return {
    message, detail,
    advice: PLAN_FIXES[message] || 'โหลดรายการล่าสุดแล้วตรวจแผนอีกครั้ง หากยังพบข้อความนี้ ให้แจ้งผู้ดูแลพร้อมข้อความและวันเวลาของเที่ยวนี้',
  }
}

// Advisory only: does not change appointments or reserve the vehicle.
export function bookingTimingAdvice(form, info) {
  const route = info?.routes?.find(r => r.id === form.route_id)
  const travel = route?.minutes == null ? NaN : Number(route.minutes)
  if (![travel, info?.buffer_minutes, info?.boarding_minutes, info?.office_start, info?.office_end].every(Number.isFinite) || travel < 0) return null
  const before = travel + info.buffer_minutes + info.boarding_minutes
  const after = form.return_mode === 'one_way' ? travel + info.boarding_minutes : before
  const earliest = info.office_start + before
  const latest = info.office_end - after
  return { travel, before, after, earliest, latest, possible: earliest <= latest, span: journeyWindow(form, info) }
}

export function normalizeBookingPhone(value) {
  const translated = String(value ?? '').replace(/[๐-๙]/g, c => String(c.charCodeAt(0) - '๐'.charCodeAt(0)))
    .replace(/[\s()-]/g, '')
  const local = translated.replace(/^\+66/, '0')
  // Keep unrecognized input intact so validation can explain the problem; never guess missing digits.
  return /^0[0-9]{8,9}$/.test(local) ? local : value
}
