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
// เวลาเป็นนาฬิกาไทยจากค่า ISO ที่ฐานข้อมูลส่งมา เช่น "08:45"
export function clockOf(value) { return value ? new Date(value).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '' }
// "วันนี้ / พรุ่งนี้" ช่วยให้กวาดตาหางานของวันได้เร็ว วันอื่นแสดงชื่อวันกับวันที่สั้น
// ต่างปีต้องมีปีกำกับ ไม่งั้นคำขอค้างจากปีก่อนดูเหมือนนัดเดือนหน้า
export function whenLabel(at) {
  if (!at) return 'ยังไม่ทราบวัน'
  const day = thaiDay(at)
  if (day === thaiDay()) return 'วันนี้'
  if (day === thaiDay(Date.now() + 86400000)) return 'พรุ่งนี้'
  const sameYear = day.slice(0, 4) === thaiDay().slice(0, 4)
  return new Date(at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: '2-digit' }) })
}
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

// แถบขั้นตอนที่ประชาชนเห็นในการ์ด "คำขอของฉัน" — 4 ขั้นแบบเดียวกับแถบสถานะของคำขอบริการ/เอกสาร
// (src/pages/MyDocRequests.jsx) ประชาชนจะได้อ่านสถานะด้วยภาษาชุดเดียวกันทุกบริการ
export const BOOKING_STEPS = ['ส่งคำขอแล้ว', 'ยืนยันรถแล้ว', 'กำลังเดินทาง', 'เสร็จแล้ว']
export function bookingStep(booking, trip) {
  if (booking.status === 'cancelled') return 0
  if (booking.status === 'completed') return 4
  if (['outbound', 'hospital', 'returning'].includes(trip?.state)) return 3
  return booking.status === 'confirmed' ? 2 : 1
}

// ไม่ทราบเวลารับกลับ: กันรถอย่างน้อยถึงเวลานัดสุดท้ายของหน่วยงาน
// นัดช่วงท้ายเผื่ออย่างน้อย 60 นาทีหลังนัด ไม่สร้างแผนที่รับกลับทันทีตอนเริ่มพบแพทย์
// เป็นเวลาเผื่อจัดคิว ไม่ใช่เวลาที่แพทย์จะตรวจเสร็จ เจ้าหน้าที่ยังปรับได้หลังประสาน
export function latestReturnClock(form, info) {
  if (form.return_mode === 'one_way') return ''
  if (!Number.isFinite(info?.office_end)) return ''
  const appointment = form.time ? minutes(form.time) : 0
  const back = Math.min(1439, Math.ceil(Math.max(info.office_end, appointment + 60) / 15) * 15)
  return back > 0 ? clockTime(back) : ''
}

// นาทีของวันนั้นตามเวลาไทย จากเวลาที่ฐานข้อมูลส่งมาเป็น ISO
function dayMinutes(value, day) {
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.round((at - Date.parse(`${day}T00:00:00+07:00`)) / 60000) : NaN
}

// เวลานัดที่ "รถว่างจริง" ของวันนั้น — ช่วงกันรถที่ ptb_plan จะคำนวณต้องอยู่ในช่วงว่างช่วงเดียวทั้งช่วง
// ช่อง free ของ patient_booking_calendar ตัดเวลาที่ผ่านมาแล้วและช่วงของเที่ยวที่ยืนยันแล้วออกให้แล้ว
// ⚠️ เป็นการกรองเพื่อไม่ให้ประชาชนเลือกเวลาที่ยืนยันไม่ได้ตั้งแต่ต้น ไม่ใช่การจองที่นั่ง
// ฐานข้อมูลยังคำนวณแผนทั้งก้อนใหม่ใต้ล็อกก่อนยืนยันทุกครั้ง
export function freeTimeChoices(form, info, dayInfo, step = 15, ignoreAvailability = false) {
  if (!dayInfo?.date || dayInfo.status !== 'open' || !Number.isFinite(info?.office_start) || !Number.isFinite(info?.office_end)) return []
  const windows = (dayInfo.free || [])
    .map(w => ({ start: dayMinutes(w.start, dayInfo.date), end: dayMinutes(w.end, dayInfo.date) }))
    .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end))
  const times = []
  const endOfDay = Math.min(info.office_end, 1439)
  const choices = new Set([info.office_start, endOfDay])
  for (let at = Math.ceil(info.office_start / step) * step; at <= endOfDay; at += step) choices.add(at)
  for (const at of [...choices].sort((a, b) => a - b)) {
    const time = clockTime(at)
    const back = form.return_mode === 'one_way' ? '' : (form.back || latestReturnClock({ ...form, time }, info))
    if (form.return_mode !== 'one_way' && (!back || minutes(back) < at)) continue
    const span = journeyWindow({ ...form, time, back }, info)
    if (!span) continue
    const end = span.end ?? span.start
    if (ignoreAvailability || windows.some(w => span.start >= w.start && end <= w.end)) times.push(time)
  }
  return times
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

// ── งานคนขับ: ปุ่มใหญ่ปุ่มเดียวต่อขั้น (เจ้าของระบบสั่ง 2569-09-21) ──
// ไป-กลับ 4 ครั้ง · ขาเดียว 2 ครั้ง (เดิม 8 และ 4 ครั้ง เพราะต้องกดรับ/ส่งทีละคนแยกจากการเดินเที่ยว)
// แต่ละปุ่มยิงคำสั่งเดิมของฐานข้อมูลหลายตัวต่อกัน — กติกาของฐานข้อมูลไม่เปลี่ยน
// ⚠️ ที่เสียไป: เวลารับขึ้นรถรายคนไม่ถูกบันทึกแยก (บันทึกพร้อมกันตอนส่งถึง) สรุปรายเดือนไม่ได้ใช้ค่านี้
export const DRIVER_STEPS = { round: ['ออกรถ', 'ถึง รพ.', 'ออกรับกลับ', 'ถึงบ้าน'], one_way: ['ออกรถ', 'ถึง รพ.'] }
export function driverProgress(trip) {
  const oneWay = trip.plan?.return_mode === 'one_way'
  return { confirmed: 0, outbound: 1, hospital: 2, returning: 3, completed: oneWay ? 2 : 4 }[trip.state] ?? 0
}
const riders = (trip, bookings) => bookings.filter(b => b.trip_id === trip.id && b.status === 'confirmed')
// ป้ายปุ่มใหญ่ของขั้นถัดไป · '' = ไม่มีปุ่ม (รอเจ้าหน้าที่แก้เหตุขัดข้อง จบแล้ว หรือยกเลิก)
export function driverNext(trip, bookings) {
  if (!riders(trip, bookings).length && ['outbound', 'hospital', 'returning'].includes(trip.state)) return 'จบเที่ยว · ไม่มีผู้เดินทางแล้ว'
  const oneWay = trip.plan?.return_mode === 'one_way'
  return { confirmed: 'ออกรถไปรับ', outbound: oneWay ? 'ส่งถึงโรงพยาบาลแล้ว · จบงาน' : 'ส่งถึงโรงพยาบาลแล้ว', hospital: 'ออกไปรับกลับ', returning: 'ส่งถึงบ้านแล้ว · จบงาน' }[trip.state] || ''
}
// คำสั่งเดิมที่ต้องยิงเพื่อไปถึงขั้นถัดไป คำนวณจากสถานะล่าสุด ขั้นที่บันทึกแล้วจึงถูกข้ามเอง
// (เน็ตหลุดกลางทาง กดซ้ำแล้วทำต่อจากที่ค้าง) · booking: null = คำสั่งของเที่ยว
// ส่งถึงโรงพยาบาล = ผู้เดินทางทุกคน 0→1→2 แล้วเดินเที่ยว · ส่งถึงบ้าน = ทุกคน 2→3→4 แล้วจบเที่ยว
export function driverSteps(trip, bookings) {
  const people = riders(trip, bookings)
  const bump = to => people.flatMap(b => Array.from({ length: Math.max(0, to - (Number(b.passenger_step) || 0)) }, () => ({ booking: b.id, action: 'passenger_next' })))
  const next = { booking: null, action: 'trip_next' }
  if (trip.state === 'confirmed') return [next]
  if (trip.state === 'outbound') return [...bump(2), next]
  // ไม่เหลือผู้เดินทาง (เจ้าหน้าที่นำออกระหว่างรอรับกลับ) = เดินเที่ยว 2 ครั้งจนจบ ไม่ต้องออกไปรับใคร
  if (trip.state === 'hospital') return people.length ? [next] : [next, next]
  if (trip.state === 'returning') return [...bump(4), next]
  return []
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

// ── กล่อง "คำขอรถ" ของเจ้าหน้าที่: 1 แถว = 1 คำขอ แบบกล่องงานคำร้อง (เจ้าของระบบสั่ง 2569-09-21) ──

// ขั้นของแถว — ใช้ทั้งป้ายกรองและป้ายสถานะ เที่ยวที่แจ้งเหตุขัดข้องนับตามขั้นก่อนเกิดเหตุ
// (เหตุขัดข้องเป็น "งานที่ต้องทำ" ของแถว ไม่ใช่ขั้นใหม่ ปุ่มแดงของแถวบอกอยู่แล้ว)
export const STAGES = {
  submitted: { label: 'รอยืนยันรถ', color: '#d97706', chip: 'bg-amber-100 text-amber-900' },
  confirmed: { label: 'ยืนยันรถแล้ว', color: '#0284c7', chip: 'bg-sky-100 text-sky-900' },
  running: { label: 'กำลังเดินทาง', color: '#7c3aed', chip: 'bg-violet-100 text-violet-900' },
  completed: { label: 'เสร็จแล้ว', color: '#059669', chip: 'bg-emerald-100 text-emerald-900' },
  cancelled: { label: 'ยกเลิกแล้ว', color: '#64748b', chip: 'bg-slate-200 text-slate-700' },
}
export function bookingStage(booking, trip) {
  if (['submitted', 'completed', 'cancelled'].includes(booking.status)) return booking.status
  const state = trip?.state === 'issue' ? trip.state_before_issue : trip?.state
  return ['outbound', 'hospital', 'returning'].includes(state) ? 'running' : 'confirmed'
}

// ปุ่มเดียวของแถว = งานถัดไปที่เจ้าหน้าที่ต้องทำ แบบ NEXT_ACTION ของคำร้อง (ComplaintsManager.jsx)
// สีปุ่ม = สีของผลที่จะได้ ใช้เฉด 700 ให้ตัวอักษรขาวอ่านออก · rank น้อย = ขึ้นก่อนในกล่อง
export function staffNextAction(booking, trip) {
  if (booking.status === 'submitted') return { id: 'confirm', label: 'ยืนยันรถ', color: '#0369a1', rank: 2 }
  if (booking.status === 'confirmed' && trip?.state === 'issue') return { id: 'issue', label: 'แก้เหตุขัดข้อง', color: '#b91c1c', rank: 0 }
  if (booking.status === 'confirmed' && booking.cancel_requested) return { id: 'cancel', label: 'ประสานยกเลิก', color: '#b45309', rank: 1 }
  if (booking.status === 'completed' && trip && trip.state === 'completed'
    && (!trip.forward_letter_no || trip.odometer_issue || !Number.isFinite(trip.odometer_end))) return { id: 'docs', label: 'บันทึกเอกสาร', color: '#047857', rank: 3 }
  return { id: 'view', label: 'ดูรายละเอียด', color: '', rank: 9 }
}

// ยืนยันรถไม่ผ่าน → ประโยคเดียวบอกเหตุ + ปุ่มแก้ที่กดแล้วระบบยืนยันต่อให้เอง
// ข้อความฝั่งซ้ายต้องตรงกับที่ ptb_plan ส่งมาทุกตัวอักษร (tests/patient-booking-guidance.test.mjs ตรวจครบทุกข้อ)
// ปุ่มแก้: area ตรวจเขตแล้วยืนยัน · helper ใส่ชื่อผู้ช่วยแล้วยืนยัน · single ยืนยันเฉพาะคำขอนี้ ·
// amend แก้วันเวลาหลังโทรประสานแล้วยืนยัน · cancel ยกเลิกคำขอพร้อมเหตุผล · call โทรหาผู้จอง ·
// settings ไปหน้าตั้งค่า · issue ไปแก้เหตุขัดข้องของวันนั้น · reload โหลดข้อมูลล่าสุด
const SETTINGS_FIX = ['settings']
const CONFIRM_BLOCKERS = {
  'ต้องตรวจสอบพื้นที่รับบริการ': ['ยังไม่ได้ตรวจว่าจุดรับอยู่ในเขตพื้นที่ให้บริการ', ['area']],
  'ต้องยืนยันผู้ช่วยเคลื่อนย้ายประจำเที่ยว': ['ผู้ป่วยใช้รถเข็นหรือเปล ต้องมีผู้ช่วยเคลื่อนย้ายไปด้วย', ['helper']],
  'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว': ['รถไม่ว่าง ช่วงเวลานี้ชนกับเที่ยวที่ยืนยันแล้ว', ['call', 'amend', 'cancel']],
  'มีเหตุขัดข้องที่ยังไม่คลี่คลายในวันเดียวกัน': ['วันนั้นมีเที่ยวที่แจ้งเหตุขัดข้องค้างอยู่ ต้องแก้เหตุนั้นก่อน', ['issue']],
  'ตรงวันหยุดให้บริการ': ['วันนัดตรงวันหยุดให้บริการ', ['call', 'amend', 'cancel']],
  'เวลารับ–ส่งอยู่นอกเวลาบริการ': ['เวลารับ–ส่งเกินเวลาให้บริการของรถ', ['call', 'amend', 'cancel']],
  'เวลานัดแพทย์อยู่นอกช่วงที่เปิดรับจอง': ['เวลานัดแพทย์อยู่นอกช่วงเวลาที่ตั้งไว้สำหรับรับจอง', ['call', 'amend', 'cancel']],
  'วันเดินทางผ่านแล้ว': ['วันนัดผ่านไปแล้ว', ['call', 'amend', 'cancel']],
  'ยังไม่มีเวลาขากลับ': ['ยังไม่มีเวลารับกลับ', ['call', 'amend']],
  'เวลารับกลับอยู่ก่อนเวลานัด': ['เวลารับกลับอยู่ก่อนเวลานัด', ['call', 'amend']],
  'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว': ['ที่นั่งไม่พอ (นับผู้ติดตามและผู้ช่วยแล้ว)', ['single', 'call', 'cancel']],
  'เส้นทาง วันเดินทาง หรือรูปแบบรับกลับไม่ตรงกัน': ['ไปด้วยกันไม่ได้ ปลายทาง วัน หรือขากลับไม่ตรงกัน', ['single']],
  'ร่วมเที่ยวได้เฉพาะผู้เดินได้และยินดีร่วมเที่ยว': ['ไปด้วยกันไม่ได้ มีผู้ใช้รถเข็น/เปล หรือผู้ไม่ประสงค์นั่งร่วม', ['single']],
  'เวลานัดห่างเกินช่วงร่วมเที่ยว': ['ไปด้วยกันไม่ได้ เวลานัดห่างกันเกิน 30 นาที', ['single']],
  'เวลารับกลับห่างเกินช่วงร่วมเที่ยว': ['ไปด้วยกันไม่ได้ เวลารับกลับห่างกันเกิน 30 นาที', ['single']],
  'มีคำขอที่ปิดหรือยกเลิกแล้ว': ['มีคำขอที่ปิดหรือยกเลิกไปแล้ว ข้อมูลบนจอเก่า', ['reload']],
  'ยังไม่ตั้งเส้นทางโรงพยาบาลและพื้นที่จุดรับ': ['โรงพยาบาลนี้ไม่อยู่ในรายการที่ตั้งไว้แล้ว', ['amend', 'settings']],
  'ยังไม่ยืนยันความจุรถ': ['ยังไม่ได้ตั้งจำนวนที่นั่งของรถ', SETTINGS_FIX],
  'รถหรือคนขับยังไม่พร้อมให้บริการ': ['รถหรือคนขับยังไม่พร้อม (ปิดบริการ งดบริการ หรือยังไม่เลือกคนขับ)', SETTINGS_FIX],
  'หน่วยงานเจ้าของรถปิดรับเรื่อง': ['หน่วยงานเจ้าของรถปิดรับเรื่องอยู่', SETTINGS_FIX],
  'บัญชีคนขับไม่ได้รับสิทธิ์เจ้าหน้าที่แล้ว': ['บัญชีคนขับไม่มีสิทธิ์เจ้าหน้าที่แล้ว', SETTINGS_FIX],
  'ยังไม่ยืนยันที่ยึดรถเข็น': ['รถยังไม่ได้ตั้งว่ามีที่ยึดรถเข็น', SETTINGS_FIX],
  'ยังไม่ยืนยันที่ยึดเปล': ['รถยังไม่ได้ตั้งว่ามีที่ยึดเปล', SETTINGS_FIX],
}

// เที่ยวที่ชนเวลากับแผนนี้ — เงื่อนไขเดียวกับที่ ptb_plan ใช้ตัดสิน "ทับช่วงรถ" (ทุกสถานะยกเว้นยกเลิก
// และไม่นับเที่ยวที่มีคำขอในแผนนี้อยู่แล้ว) ใช้ทั้งบอกว่าชนกับเที่ยวไหน และหาเที่ยวที่ลองไปคันเดียวกัน
export function overlappingTrips(plan, trips = []) {
  return trips.filter(t => t.state !== 'cancelled' && !(t.booking_ids || []).some(id => plan?.booking_ids?.includes(id))
    && (t.plan?.blocks || []).some(old => (plan?.blocks || []).some(b => Date.parse(old.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(old.end))))
}
// เที่ยวที่ลอง "ให้ไปคันเดียวกัน" ได้ (20260921120000): ยืนยันแล้ว ปลายทาง วัน และขากลับตรงกัน
// เป็นแค่ตัวกรองไม่ให้ถามฐานข้อมูลเปล่า ๆ — เงื่อนไขจริง (ยินยอมนั่งร่วม ที่นั่ง เวลา) ฐานข้อมูลตัดสินเอง
export function joinCandidates(plan, trips = []) {
  return overlappingTrips(plan, trips).filter(t => t.state === 'confirmed' && t.plan?.route_id === plan?.route_id
    && t.plan?.return_mode === plan?.return_mode && t.plan?.date === plan?.date).slice(0, 3)
}
// เหตุที่ไปคันเดียวกันไม่ได้ เป็นภาษาเจ้าหน้าที่ — ข้อความจากฐานข้อมูลเขียนไว้ให้ประชาชน ("กรุณาประสานเจ้าหน้าที่")
const JOIN_REFUSALS = [
  ['เที่ยวนี้ไม่เปิดร่วมแล้ว', 'เที่ยวนั้นออกรถแล้ว หรือเปลี่ยนสถานะไปแล้ว'],
  ['เที่ยวนี้ไม่พร้อมรับผู้ร่วมเพิ่ม', 'ผู้เดินทางเดิมในเที่ยวนั้นไม่ได้เลือกนั่งร่วม ใช้รถเข็น/เปล หรือขอยกเลิกไว้'],
  ['เวลาเริ่มรับของแผนร่วมเที่ยวผ่านแล้ว', 'เวลารถออกรับของแผนใหม่ผ่านไปแล้ว'],
  ['คนขับเปลี่ยนแล้ว', 'คนขับของเที่ยวนั้นไม่ใช่คนขับปัจจุบัน ต้องจัดเที่ยวใหม่'],
]
export function joinRefusal({ plan, error, code } = {}, workspace = {}) {
  if (code === 'PGRST202') return 'ระบบยังไม่เปิดใช้การรวมเที่ยว (รอปรับฐานข้อมูล)'
  if (error) return JOIN_REFUSALS.find(([key]) => error.includes(key))?.[1] || error
  return (plan?.errors || []).map(message => bookingPlanGuidance(message, plan, workspace).text).join(' · ')
}

// Explain server validation without changing its decision. Unknown errors retain their original text.
// คืน { message ต้นฉบับ, text ประโยคเดียว, detail ตัวเลขประกอบ, fixes ปุ่มแก้ }
// "ยืนยันเฉพาะคำขอนี้" ขึ้นเฉพาะแผนที่มีหลายคน — แผนคนเดียวไม่มีอะไรให้แยก
export function bookingPlanGuidance(message, plan, workspace = {}) {
  const settings = workspace.settings || {}
  const sameSettings = plan?.settings_revision == null || settings.revision == null || plan.settings_revision === settings.revision
  const selected = (workspace.bookings || []).filter(b => plan?.booking_ids?.includes(b.id))
  let detail = ''
  if (!sameSettings) detail = 'ค่าตั้งเปลี่ยนหลังตรวจแผน กรุณาโหลดข้อมูลล่าสุดแล้วตรวจแผนอีกครั้ง'
  else if (message === 'เวลานัดแพทย์อยู่นอกช่วงที่เปิดรับจอง' && Number.isFinite(settings.office_start) && Number.isFinite(settings.office_end)) {
    detail = `เวลานัดแพทย์ที่เปิดรับจอง ${clockTime(settings.office_start)}–${clockTime(settings.office_end)} น.${selected.length ? ` · ${selected.map(b => `${b.patient_name} นัด ${dateTime(b.appointment_at)}`).join(' / ')}` : ''}`
  } else if (message === 'เวลารับ–ส่งอยู่นอกเวลาบริการ' && Number.isFinite(settings.office_start) && Number.isFinite(settings.office_end) && plan?.date) {
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
    detail = overlappingTrips(plan, workspace.trips).map(t => `${t.plan.route_label || 'เที่ยวเดิม'} · เริ่มรับ ${dateTime(t.plan.pickup_at)}`).join(' / ')
  } else if (['เวลานัดห่างเกินช่วงร่วมเที่ยว', 'เวลารับกลับห่างเกินช่วงร่วมเที่ยว', 'ยังไม่มีเวลาขากลับ', 'เวลารับกลับอยู่ก่อนเวลานัด'].includes(message)) {
    detail = selected.map(b => `${b.patient_name} · นัด ${dateTime(b.appointment_at)} · พร้อมรับกลับ ${dateTime(b.return_at)}`).join(' / ')
  }
  const known = Object.hasOwn(CONFIRM_BLOCKERS, message)
  const [text, fixes] = known ? CONFIRM_BLOCKERS[message] : [message, ['reload', 'call']]
  const group = (plan?.booking_ids?.length || 0) > 1
  return { message, text, detail, known, fixes: group ? fixes : fixes.filter(fix => fix !== 'single') }
}

// Advisory only: does not change appointments or reserve the vehicle.
export function bookingTimingAdvice(form, info) {
  const route = info?.routes?.find(r => r.id === form.route_id)
  const travel = route?.minutes == null ? NaN : Number(route.minutes)
  if (![travel, info?.buffer_minutes, info?.boarding_minutes, info?.office_start, info?.office_end].every(Number.isFinite) || travel < 0) return null
  const before = travel + info.buffer_minutes + info.boarding_minutes
  const after = form.return_mode === 'one_way' ? travel + info.boarding_minutes : before
  // ช่วงตั้งค่าเป็นเวลานัดแพทย์โดยตรง เวลาเดินทางใช้คำนวณช่วงที่รถถูกจองเท่านั้น
  const earliest = info.office_start
  const latest = info.office_end
  return { travel, before, after, earliest, latest, possible: earliest <= latest, span: journeyWindow(form, info) }
}

export function normalizeBookingPhone(value) {
  const translated = String(value ?? '').replace(/[๐-๙]/g, c => String(c.charCodeAt(0) - '๐'.charCodeAt(0)))
    .replace(/[\s()-]/g, '')
  const local = translated.replace(/^\+66/, '0')
  // Keep unrecognized input intact so validation can explain the problem; never guess missing digits.
  return /^0[0-9]{8,9}$/.test(local) ? local : value
}
