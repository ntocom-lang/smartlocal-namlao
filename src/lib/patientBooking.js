// Suggestions only. PostgreSQL recomputes the complete plan under the resource lock.
import { activeOrgTerms } from './orgTerms.js'
import { signatoryMoment } from './documentSignatories.js'

// คำเรียกหน่วยงานสั้นตามประเภทจริง (อบต./ทต./ทม./ทน./อบจ.) — เดิมฝัง "อบต." ตายตัว
// ทำให้เทศบาลเห็นข้อความผิดประเภท · org_type ที่ไม่มีตัวย่อ (เช่น 'เทศบาล' เฉยๆ) ใช้คำกลาง
export function orgAbbr() { return activeOrgTerms().abbr || 'หน่วยงาน' }
export const BOOKING_STATUS = { submitted: 'รับคำขอแล้ว รอยืนยันรถ', confirmed: 'ยืนยันรถแล้ว', completed: 'จบเที่ยวแล้ว', cancelled: 'ยกเลิกแล้ว' }
export const TRIP_STATUS = { confirmed: 'ยืนยันรถแล้ว', outbound: 'กำลังให้บริการ', hospital: 'กำลังให้บริการ', returning: 'กำลังให้บริการ', completed: 'จบเที่ยวแล้ว', issue: 'ต้องประสานเหตุขัดข้อง', cancelled: 'ยกเลิกแผนเที่ยว' }
export const RETURN_MODES = { wait: 'รอรับกลับ', later: 'กลับมารับภายหลัง', one_way: 'ขาไปอย่างเดียว' }
export const MOBILITY = { walk: 'เดินได้เอง', wheelchair: 'ใช้รถเข็น', stretcher: 'ใช้เปล' }
export const inputClass = 'w-full min-h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900'
export const buttonClass = 'min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50'
export const primaryClass = 'min-h-11 rounded-xl bg-sky-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50'
export const isCommunity = booking => booking?.service_type === 'community'
// สถานที่อื่น: แอดมินเปิดช่อง "อื่นๆ" ครั้งเดียว ไม่ใช้เวลาเดินทางกันรถ
// ผู้จองพิมพ์ชื่อสถานที่เอง → ฐานข้อมูลเก็บเป็น route_label ของคำขอนั้น และไม่ให้ร่วมเที่ยวกับใคร
// ⚠️ ค่านี้ต้องตรงกับ '__other__' ใน patient_booking_submit/amend/change_hospital
export const OTHER_PLACE_ID = '__other__'
export const OTHER_PLACE_MAX = 200
export const isOtherPlace = routeId => routeId === OTHER_PLACE_ID
// ตัดช่องว่าง/ขึ้นบรรทัดใหม่ให้เหลือช่องว่างเดียวแบบเดียวกับที่ฐานข้อมูลทำ — ข้อความที่ผู้ใช้เห็นในหน้าทวนจะตรงกับที่เก็บจริง
export const cleanPlaceName = text => Array.from(String(text ?? ''), ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch).join('').replace(/\s+/g, ' ').trim().slice(0, OTHER_PLACE_MAX + 1)
export const serviceLabel = booking => isCommunity(booking) ? 'ชุมชน' : 'ผู้ป่วย'
export const bookingName = booking => isCommunity(booking) ? `กลุ่ม ${booking.group_label || 'ไม่ระบุชื่อกลุ่ม'} (${booking.party_size || 0} คน)` : booking?.patient_name || ''
export const bookingPeople = booking => isCommunity(booking) ? Number(booking.party_size || 0) : 1 + Number(booking?.companions || 0)
export const bookingTravel = booking => isCommunity(booking) ? `ผู้เดินทาง ${booking.party_size || 0} คน · ไม่ร่วมเที่ยว` : `${MOBILITY[booking?.mobility]} · ผู้ติดตาม ${booking?.companions || 0} คน`
// Public info remains available when only community intake is closed. Never manufacture consent text.
export function communityPayload(booking, info, overrides = {}) {
  return {
    ...Object.fromEntries(['requester_name', 'phone', 'pickup', 'route_id', 'appointment_at', 'return_at', 'return_mode', 'group_label', 'party_size', 'purpose_code'].map(key => [key, booking[key]])),
    pickup_lat: booking.pickup_lat ?? null, pickup_lng: booking.pickup_lng ?? null, in_area: !!booking.in_area,
    ...overrides, rules_version: info?.community?.rules_version, consent: true,
    consent_version: info?.community?.consent_version, privacy_notice: info?.community?.privacy_notice, owner_name: info?.owner_name,
  }
}
// v2 owns service/people totals. Keep historical patient letter numbers from the legacy report.
// ระยะทางมาจากเลขไมล์รายวัน (patient_booking_odometer_days) ช่วงเดียวกัน — days = null คือไม่มีข้อมูลรายวัน
// (ตัวจำลองรุ่นเก่าในเทสต์) ตัวสรุปจะใช้ระยะรายเที่ยวเดิมแทน · ของจริงเรียกไม่สำเร็จ call จะโยน error ทั้งรายงาน ไม่ถอยเงียบ
export async function servicePeriodReport(call, from, to, service = null) {
  const [report, legacy, odometer] = await Promise.all([
    call('patient_booking_period_report_v2', { p_from: from, p_to: to, p_service: service }),
    service === 'community' ? null : call('patient_booking_period_report', { p_from: from, p_to: to }),
    call('patient_booking_odometer_days', { p_from: from, p_to: to }),
  ])
  if (report?.from !== from || report?.to !== to || !Array.isArray(report?.trips)) throw new Error('ช่วงข้อมูลรายงานไม่ตรงกับช่วงที่เลือก กรุณาโหลดใหม่')
  if (legacy && (legacy.from !== from || legacy.to !== to || !Array.isArray(legacy.trips))) throw new Error('ข้อมูลเลขหนังสือไม่ตรงกับช่วงที่เลือก กรุณาโหลดใหม่')
  const days = Array.isArray(odometer?.days) ? odometer.days : null
  if (days && (odometer.from !== from || odometer.to !== to)) throw new Error('ข้อมูลเลขไมล์ไม่ตรงกับช่วงที่เลือก กรุณาโหลดใหม่')
  const metadata = new Map((legacy?.trips || []).map(t => [t.trip_id, t]))
  return { ...report, days, trips: report.trips.map(t => ({
    ...(metadata.get(t.trip_id) || {}), ...t,
    passengers: isCommunity(t) ? 0 : t.request_count,
  })) }
}
// ตัวจัดรูปแบบสร้างครั้งเดียว — เดิมสร้างใหม่ทุกครั้งที่เรียก suggestGroups เรียกคู่ละ 2 ครั้ง คำขอรอยืนยัน 600 ใบ (เจอ 2569-10-05 ตอนจำลองข้อมูลมากๆ) = หน้าค้าง ~18 วินาที
const THAI_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
export function thaiDay(value = new Date()) {
  const parts = THAI_DAY_FORMAT.formatToParts(new Date(value))
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)?.value).join('-')
}
export function dateTime(value) {
  return value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'ยังไม่ทราบ'
}
export function clockTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
export function bookingLastDay(today = thaiDay()) {
  const [year, month, day] = today.split('-').map(Number)
  const last = new Date(Date.UTC(year + 1, month, 0)).getUTCDate()
  return `${year + 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`
}
// เวลาเป็นนาฬิกาไทยจากค่า ISO ที่ฐานข้อมูลส่งมา เช่น "08:45"
export function clockOf(value) { return value ? new Date(value).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '' }
// Only staff announcements are pickup times. Legacy generated estimates had revision 1.
export function coordinatedPickup(trip) {
  return trip?.estimated_pickup_at && trip.schedule_revision > 1
    ? trip.estimated_pickup_at : null
}
export function pickupForBooking(trip) { return coordinatedPickup(trip) }
export function returnForBooking(trip, booking) { return trip?.estimated_return_at || booking?.return_at || trip?.plan?.return_at || null }
export function pickupLabel(trip, full = false) {
  const at = coordinatedPickup(trip)
  return at ? `รับประมาณ ${full ? dateTime(at) : `${clockOf(at)} น.`}` : 'รอประสานเวลารับ'
}
export function tripOrderTime(trip) {
  return coordinatedPickup(trip) || trip?.plan?.appointment_at || trip?.appointment_at || trip?.plan?.outbound_waves?.[0]?.appointment_start || `${trip?.plan?.date || trip?.date || ''}T00:00:00+07:00`
}
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

// Kept for old imports only. Manual dispatch does not calculate vehicle reservations.
export function journeyWindow() { return null }
export function journeyBlocks() { return [] }

// กลุ่มปลายทาง (20261007150000): ปลายทางที่ผู้ดูแลตั้งชื่อกลุ่มเดียวกัน = รถเที่ยวเดียวแวะส่งได้หลายจุด
// ว่าง = ไม่รวมกับปลายทางอื่น · ต้องตัดสินแบบเดียวกับ ptb_plan (ตัดช่องว่างหัวท้าย แล้วเทียบตรงตัว)
export function routeZone(routes, routeId) { return String(routes?.find(r => r.id === routeId)?.zone || '').trim() }
export function sameDestinationGroup(routes, a, b) {
  if (!a || !b) return false
  if (a === b) return true
  const zone = routeZone(routes, a)
  return !!zone && zone === routeZone(routes, b)
}
// ปลายทางทั้งหมดที่นั่งรถเที่ยวเดียวกับปลายทางนี้ได้ (รวมตัวเอง) ตามลำดับในหน้าตั้งค่า
export function destinationGroup(routes, routeId) { return (routes || []).filter(r => sameDestinationGroup(routes, r.id, routeId)) }

// แถบขั้นตอนที่ประชาชนเห็นในการ์ด "คำขอของฉัน" — 4 ขั้นแบบเดียวกับแถบสถานะของคำขอบริการ/เอกสาร
// (src/pages/MyDocRequests.jsx) ประชาชนจะได้อ่านสถานะด้วยภาษาชุดเดียวกันทุกบริการ
export const BOOKING_STEPS = ['ส่งคำขอแล้ว', 'ยืนยันรถแล้ว', 'กำลังเดินทาง', 'เสร็จแล้ว']
export function bookingStep(booking, trip) {
  if (booking.status === 'cancelled') return 0
  if (booking.status === 'completed') return 4
  if (['outbound', 'hospital', 'returning'].includes(trip?.state)) return 3
  return booking.status === 'confirmed' ? 2 : 1
}

// ไม่ทราบเวลารับกลับ: ค่าเริ่มต้นสำหรับคำขอเท่านั้น ไม่ใช้กันรถ
// นัดช่วงท้ายเผื่ออย่างน้อย 60 นาทีหลังนัด ไม่สร้างแผนที่รับกลับทันทีตอนเริ่มพบแพทย์
// ไม่ใช่เวลาที่แพทย์จะตรวจเสร็จ เจ้าหน้าที่ยังปรับได้หลังประสาน
export function latestReturnClock(form, info) {
  if (form.return_mode === 'one_way') return ''
  if (!Number.isFinite(info?.office_end)) return ''
  const appointment = form.time ? minutes(form.time) : 0
  const back = Math.min(1439, Math.ceil(Math.max(info.office_end, appointment + 60) / 15) * 15)
  return back > 0 ? clockTime(back) : ''
}

// Intake hours are appointment/arrival hours, not proof that the vehicle is free.
function intakeTimes(form, dayInfo, start, end, step) {
  if (!dayInfo?.date || dayInfo.status !== 'open' || !Number.isFinite(start) || !Number.isFinite(end)) return []
  const last = Math.min(end, 1439), choices = new Set([start, last])
  for (let at = Math.ceil(start / step) * step; at <= last; at += step) choices.add(at)
  return [...choices].sort((a, b) => a - b).filter(at => at >= start && at <= last
    && Date.parse(bangkokISO(dayInfo.date, clockTime(at))) > Date.now()
    && (form.return_mode === 'one_way' || !form.back || minutes(form.back) >= at)).map(clockTime)
}
export function freeTimeChoices(form, info, dayInfo, step = 15) {
  return isCommunity(form) ? communityTimeChoices(form, info, dayInfo, step)
    : intakeTimes(form, dayInfo, info?.office_start, info?.office_end, step)
}
// Staff coordinate separate return rounds. No travel formula removes return choices.
export function joinReturnChoices(form, info, trip) {
  const tripBack = clockOf(trip?.return_at)
  if (!tripBack || !form.time || trip.return_mode !== 'wait') return tripBack ? [tripBack] : []
  const out = []
  for (let at = Math.ceil(minutes(form.time) / 60) * 60; at < minutes(tripBack); at += 60) out.push(clockTime(at))
  return [...out, tripBack]
}
export function communityVehicleBlocks() { return [] }
export function communityTimeChoices(form, info, dayInfo, step = 15) {
  return intakeTimes(form, dayInfo, info?.community?.window_start, info?.community?.window_end, step)
}

export function suggestGroups(bookings, settings) {
  const pending = bookings.filter(r => r.status === 'submitted').sort((a, b) => a.appointment_at.localeCompare(b.appointment_at) || a.id.localeCompare(b.id))
  const groups = []
  for (const r of pending) {
    const group = groups.find(g => {
      const first = g[0]
      return !isCommunity(r) && settings?.seats && r.share && r.mobility === 'walk' && g.every(x => !isCommunity(x) && x.share && x.mobility === 'walk')
        && sameDestinationGroup(settings?.routes, first.route_id, r.route_id) && first.return_mode === r.return_mode && thaiDay(first.appointment_at) === thaiDay(r.appointment_at)
        && Math.abs(new Date(first.appointment_at) - new Date(r.appointment_at)) <= 30 * 60000
        && (r.return_mode === 'one_way' || (r.return_at && first.return_at && Math.abs(new Date(first.return_at) - new Date(r.return_at)) <= 30 * 60000))
        && g.reduce((n, x) => n + 1 + x.companions, 1 + r.companions) <= settings.seats
    })
    if (group) group.push(r)
    else groups.push([r])
  }
  return groups
}

// คนขับบันทึกเฉพาะออกจากสำนักงานและกลับถึงสำนักงาน ไม่ต้องออนไลน์ระหว่างทาง
export const DRIVER_STEPS = { round: ['ออกรถ', 'กลับแล้ว'], one_way: ['ออกรถ', 'กลับแล้ว'] }
export function driverProgress(trip) {
  return { confirmed: 0, outbound: 1, hospital: 1, returning: 1, completed: 2 }[trip.state] ?? 0
}
export function driverNext(trip) {
  return { confirmed: 'ออกรถ', outbound: 'กลับแล้ว · จบงาน', hospital: 'กลับแล้ว · จบงาน', returning: 'กลับแล้ว · จบงาน' }[trip.state] || ''
}
// จบทั้งเที่ยวใน transaction เดียว ไม่สร้างเวลาถึงโรงพยาบาล/ออกกลับที่ไม่ได้บันทึกจริง
export function driverSteps(trip) {
  if (trip.state === 'confirmed') return [{ booking: null, action: 'trip_next' }]
  if (['outbound', 'hospital', 'returning'].includes(trip.state)) return [{ booking: null, action: 'trip_finish' }]
  return []
}

// ── เลขไมล์เหมาเป็นวัน (20261008100200 · เจ้าของระบบสั่ง 2569-10-08) ──
// รถคันเดียววิ่งหลายเที่ยวซ้อนเวลากันได้ (08:00–16:00 กับ 10:00–17:00) เลขไมล์รายเที่ยวจึงแบ่งไม่ได้จริง
// 1 แถว = 1 วัน: เลขไมล์ออกต่อจากเลขกลับล่าสุดของวันก่อน (ระบบเติมให้) · เลขไมล์กลับใส่ครั้งเดียวตอนรถกลับถึงกองทุนสิ้นวัน
// แถวรายวันมาจาก patient_booking_odometer_days: { date, trips, completed, open, mine, services, odometer_*, revision }
export const dayRecorded = day => !!day && Number.isFinite(day.odometer_end) && Number.isFinite(day.odometer_start) && !day.odometer_issue
export const dayDistance = day => dayRecorded(day) ? day.odometer_end - day.odometer_start : null
// เลขไมล์ออกของวัน = เลขกลับของวันล่าสุดก่อนหน้าที่บันทึกครบ (ข้ามวันที่รอตรวจสอบ) · ไม่มีในข้อมูลที่โหลดมา ใช้เลขก่อนช่วงจากฐานข้อมูล
// ไม่มีทั้งคู่ (วันแรกที่ใช้ระบบ) = เว้นว่างให้กรอกเอง ดีกว่าเดาผิด
export function previousDayOdometer(date, days = [], before = null) {
  const prior = days.filter(d => d.date < date && Number.isFinite(d.odometer_end) && !d.odometer_issue)
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (prior) return prior.odometer_end
  return before?.date && before.date < date && Number.isFinite(before.odometer_end) ? before.odometer_end : ''
}
// วันที่รอเลขไมล์ปิดวัน: มีเที่ยวจบแล้ว ไม่มีเที่ยวค้างในวันนั้น (ทุกคนขับ) และยังไม่มีเลขไมล์ที่ใช้ได้
// ใช้ open จากฐานข้อมูล ไม่ใช้ workspace — คนขับเห็นแค่เที่ยวของตัวเอง แต่วันนั้นอาจมีคนขับแทนวิ่งอีกเที่ยวอยู่
// วันที่ (เวลาไทย) ถัดจากวันนี้ n วัน (ติดลบ = ย้อนหลัง) — ใช้ตัดช่วง 30 วันที่แก้เลขไมล์ย้อนหลังได้
export const thaiDayAfter = days => thaiDay(Date.now() + days * 86400000)
export const dayPending = day => !!day && day.completed > 0 && day.open === 0 && !dayRecorded(day)

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
// สีของหัวกลุ่ม 3 ส่วนที่ใช้ร่วมกันทุกแท็บ (เจ้าของระบบสั่ง 2569-10-01 กล่องคำขอรถ · 2569-10-05 งานคนขับ — เห็นแล้วรู้ว่างานไหนเสร็จหรือยัง)
// ส้ม = ต้องทำ · ฟ้า = รอ/กำลังเดินทาง · เทา = จบแล้ว (เงียบที่สุด) — bar = แถบซ้าย, tint = พื้นหัวกลุ่ม, ink = ตัวอักษร
// ชื่อส่วนแต่ละแท็บตั้งเอง ("ต้องดำเนินการ" ของคำขอรถ · "ต้องทำตอนนี้" ของงานคนขับ) สีใช้ชุดเดียวกัน สองแท็บจะได้ไม่ผิดกัน
// ตัวแถบหัวกลุ่มคือ SectionBand ใน components/patientTransport/StaffShell.jsx (ค่าคงที่วางที่นี่เพราะไฟล์คอมโพเนนต์ export ค่าอื่นไม่ได้ ตามกฎ react-refresh)
export const SECTION_TONES = {
  action: { bar: '#d97706', tint: '#fef3c7', ink: '#78350f' },
  live: { bar: '#0284c7', tint: '#e0f2fe', ink: '#0c4a6e' },
  done: { bar: '#94a3b8', tint: '#e2e8f0', ink: '#334155' },
}
// ── แบ่งหน้ารายการของเจ้าหน้าที่ (เจ้าของระบบสั่ง 2569-10-05 "ทำไว้รอ อย่าให้เจอปัญหาแล้วค่อยทำ") ──
// ค่าตั้งต้น 20 รายการต่อหน้า เท่าแท็บคำร้อง · แถบแบ่งหน้าขึ้นเมื่อรายการเกินค่าตั้งต้น ปริมาณจริงตอนนี้ยังไม่เกิน เจ้าหน้าที่จึงยังไม่เห็นอะไรเปลี่ยน
export const PAGE_SIZES = [10, 20, 50, 100]
export const PAGE_SIZE_DEFAULT = 20
// จำค่าที่เจ้าหน้าที่เลือกไว้ในเครื่อง — สลับแท็บแล้วตารางเปิดใหม่ ถ้าไม่จำ ค่าที่เลือก (50/ทั้งหมด) จะเด้งกลับเป็น 20 ทุกครั้ง · ใช้ร่วมสองตาราง
// เบราว์เซอร์ที่ปิดที่เก็บข้อมูล (โหมดส่วนตัว/บล็อก) ใช้ค่าตั้งต้นต่อไป ไม่พัง
const PAGE_SIZE_KEY = 'ptb-staff-page-size'
export function loadPageSize() {
  try {
    const saved = localStorage.getItem(PAGE_SIZE_KEY)
    return saved === 'all' ? 'all' : PAGE_SIZES.includes(Number(saved)) ? Number(saved) : PAGE_SIZE_DEFAULT
  } catch { return PAGE_SIZE_DEFAULT }
}
export function savePageSize(value) {
  try { localStorage.setItem(PAGE_SIZE_KEY, String(value)) } catch { /* เก็บไม่ได้ก็ใช้แค่รอบนี้ */ }
}

// units = [{ size }] เรียงตามลำดับที่แสดง — กรอบเที่ยวเดียวกัน (หลายคน) เป็น 1 หน่วยที่ size = จำนวนแถว จะได้ไม่ถูกตัดคร่อมสองหน้า
// หน้าหนึ่งรับหน่วยจนครบ perPage แถวแล้วปิด จึงเกิน perPage ได้ไม่เกินจำนวนแถวของกรอบสุดท้ายลบ 1
// size 0 = หน่วยที่ไม่แสดงแถว (ส่วนที่พับอยู่) ต่อท้ายหน้าที่มันตกอยู่เสมอ ไม่เปิดหน้าใหม่ — ไม่งั้นได้หน้าว่างที่มีแต่หัวกลุ่ม
// page เกินช่วงถูกบีบเข้าช่วง (รายการลดลงหลังกดบันทึก แล้วหน้าที่ดูอยู่หายไป) · perPage = 'all' คือหน้าเดียว
export function paginate(units, perPage, page = 1) {
  const all = perPage === 'all' || !Number.isFinite(perPage) || perPage < 1
  const pages = []
  for (const unit of units) {
    const last = pages.at(-1)
    if (!last || (!all && unit.size > 0 && last.rows >= perPage)) pages.push({ units: [], rows: 0 })
    pages.at(-1).units.push(unit)
    pages.at(-1).rows += unit.size
  }
  const total = units.reduce((sum, unit) => sum + unit.size, 0)
  if (!pages.length) return { page: 1, pages: 1, units: [], from: 0, to: 0, total }
  const current = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), pages.length)
  const before = pages.slice(0, current - 1).reduce((sum, p) => sum + p.rows, 0)
  const { units: onPage, rows } = pages[current - 1]
  return { page: current, pages: pages.length, units: onPage, from: rows ? before + 1 : 0, to: before + rows, total }
}

// ฐานข้อมูลส่งคำขอและเที่ยวให้หน้าเจ้าหน้าที่ได้ไม่เกิน 1,000 ใบต่อชนิด (LIMIT 1000 ใน patient_booking_workspace_v2 · migration 20261003150000)
// คำขอเรียงวันนัดเก่า→ใหม่ จึงตัดคำขอที่นัดไกลที่สุดทิ้งก่อน ซึ่งมักเป็นคำขอที่ยังรอยืนยัน · เที่ยวเรียงตามเวลาสร้างใหม่→เก่า ตัดเที่ยวเก่าสุดทิ้ง
// ถึงเพดานแล้วหน้าจอต้องบอก ห้ามหายเงียบ — แก้ที่ต้นเหตุ (ให้ฐานข้อมูลคัดรายการแบบอื่น) เป็นงาน migration แยก
export const WORKSPACE_ROW_LIMIT = 1000
export const workspaceTruncated = workspace => (workspace?.bookings?.length ?? 0) >= WORKSPACE_ROW_LIMIT || (workspace?.trips?.length ?? 0) >= WORKSPACE_ROW_LIMIT
export function bookingStage(booking, trip) {
  if (['submitted', 'completed', 'cancelled'].includes(booking.status)) return booking.status
  const state = trip?.state === 'issue' ? trip.state_before_issue : trip?.state
  return ['outbound', 'hospital', 'returning'].includes(state) ? 'running' : 'confirmed'
}

// ปุ่มเดียวของแถว = งานถัดไปที่เจ้าหน้าที่ต้องทำ แบบ NEXT_ACTION ของคำร้อง (ComplaintsManager.jsx)
// สีปุ่ม = สีของผลที่จะได้ ใช้เฉด 700 ให้ตัวอักษรขาวอ่านออก · rank น้อย = ขึ้นก่อนในกล่อง
// เลขที่/วันที่หนังสือนำส่งของคำขอหนึ่งใบ — เจ้าของระบบสั่ง 2569-10-02 ให้เอกสารแยกรายคน เลขที่หนังสือคนละเลข
// (patient_bookings.forward_letter_no) · คำขอที่ยังไม่มีเลขของตัวเองใช้เลขของเที่ยว (เที่ยวเก่าที่บันทึกก่อนแยกรายคน)
// own = เลขของคำขอนี้เอง · ไม่มีทั้งคู่ = ช่อง "ที่" ว่าง (พิมพ์ได้ เว้นเส้นประให้เขียนมือ)
// วันที่ซึ่งยังไม่ได้บันทึกใช้วันที่ยืนยันเที่ยวรถ (created_at ของเที่ยวเกิดในคำสั่งยืนยัน)
// ตามเวลาไทย · ไม่ใช้ updated_at เพราะอาจเป็นวันที่แก้คิว/เลขไมล์ภายหลัง และไม่เดาวันนี้เมื่อไม่มีหลักฐาน
// ⚠️ ใช้ฟังก์ชันนี้ที่เดียวทั้งหน้าจอ งานถัดไป และใบพิมพ์ — ห้ามอ่าน trip.forward_letter_no ตรงๆ แล้วลืมเลขของคำขอ
export function bookingLetter(booking, trip) {
  const confirmationDate = ['confirmed', 'completed'].includes(booking?.status) && trip?.state !== 'cancelled'
    && trip?.created_at && Number.isFinite(new Date(trip.created_at).getTime()) ? thaiDay(trip.created_at) : ''
  if (booking?.forward_letter_no) return { no: booking.forward_letter_no, date: booking.forward_letter_date || confirmationDate, own: true }
  if (trip?.forward_letter_no) return { no: trip.forward_letter_no, date: trip.forward_letter_date || confirmationDate, own: false }
  // ใบพิมพ์อาจส่งวันที่ที่เจ้าหน้าที่แก้ในร่างมาก่อนมีเลขที่ (ยังไม่บันทึกลงฐานข้อมูล)
  return { no: '', date: booking?.forward_letter_date || confirmationDate, own: false }
}

// เวลาที่ใช้หาผู้ลงนามของเอกสารชุดนี้ (ใบคำขอ + หนังสือนำส่ง) — ชุดเอกสารลงนามตอนออกหนังสือนำส่ง
// เลือกหนังสือแบบเดียวกับ bookingLetter: เลขของคำขอเองก่อน แล้วเลขของเที่ยว
// บันทึกเลขแล้ว = เวลาที่บันทึก (ลงวันที่ย้อนหลังใช้วันที่ในหนังสือ) · ยังไม่บันทึกเลข = เรื่องยังไม่เสร็จ ใช้คนปัจจุบัน
// (เจ้าของระบบสั่ง 2569-10-06: เปลี่ยนผู้ลงนามแล้วเอกสารที่เสร็จแล้วคงชื่อเดิม เรื่องที่ค้างใช้คนใหม่)
export function bookingLetterMoment(booking, trip) {
  if (booking?.forward_letter_no) {
    return signatoryMoment({ finishedAt: booking.forward_recorded_at, documentDate: booking.forward_letter_date })
  }
  if (trip?.forward_letter_no) {
    return signatoryMoment({ finishedAt: trip.forward_recorded_at, documentDate: trip.forward_letter_date })
  }
  return signatoryMoment({})
}

// day = แถวเลขไมล์ของวันเดินทาง (เลขไมล์เหมาเป็นวัน) · ไม่มีแถว = อยู่นอกช่วงที่โหลด ไม่ถือว่าค้าง (ไม่เดาว่าขาด)
// เลขไมล์รายเที่ยวเดิมไม่ใช้ตัดสินแล้ว — เที่ยวใหม่ไม่มีเลขไมล์รายเที่ยว ถ้ายังดูอยู่ทุกคำขอจะค้าง "บันทึกเอกสาร" ตลอด
export function staffNextAction(booking, trip, day = null) {
  if (booking.status === 'submitted') return { id: 'confirm', label: 'ยืนยันรถ', color: '#0369a1', rank: 2 }
  if (booking.status === 'confirmed' && trip?.state === 'issue') return { id: 'issue', label: 'แก้เหตุขัดข้อง', color: '#b91c1c', rank: 0 }
  if (booking.status === 'confirmed' && booking.cancel_requested) return { id: 'cancel', label: 'ประสานยกเลิก', color: '#b45309', rank: 1 }
  if (booking.status === 'completed' && trip && trip.state === 'completed'
    && (!bookingLetter(booking, trip).no || (!!day && !dayRecorded(day)))) return { id: 'docs', label: 'บันทึกเอกสาร', color: '#047857', rank: 3 }
  return { id: 'view', label: 'ดูรายละเอียด', color: '', rank: 9 }
}

// ยืนยันรถไม่ผ่าน → ประโยคเดียวบอกเหตุ + ปุ่มแก้ที่กดแล้วระบบยืนยันต่อให้เอง
// ข้อความฝั่งซ้ายต้องตรงกับที่ ptb_plan ส่งมาทุกตัวอักษร (tests/patient-booking-guidance.test.mjs ตรวจครบทุกข้อ)
// ปุ่มแก้: area ตรวจเขตแล้วยืนยัน · helper ใส่ชื่อผู้ช่วยแล้วยืนยัน · single ยืนยันเฉพาะคำขอนี้ ·
// amend แก้วันเวลาหลังโทรประสานแล้วยืนยัน · cancel ยกเลิกคำขอพร้อมเหตุผล · call โทรหาผู้จอง ·
// settings ไปหน้าตั้งค่า · issue ไปแก้เหตุขัดข้องของวันนั้น · reload โหลดข้อมูลล่าสุด
const SETTINGS_FIX = ['settings']
const CONFIRM_BLOCKERS = {
  'ห้ามรวมงานผู้ป่วยกับงานชุมชน': ['งานผู้ป่วยและงานชุมชนต้องแยกเที่ยว', ['single']],
  'งานชุมชนไม่เปิดร่วมเที่ยว': ['งานชุมชนใช้หนึ่งคำขอต่อเที่ยว รวมเฉพาะคนในกลุ่มนั้น', ['single']],
  'งานชุมชนไม่ใช้ผู้ช่วยเคลื่อนย้าย': ['งานชุมชนรับเฉพาะผู้เดินได้ ให้ล้างชื่อผู้ช่วยของแผนนี้', ['reload', 'call']],
  'ยังไม่ตั้งสถานที่ชุมชนและเวลาเดินทาง': ['ข้อมูลการจัดคิวรุ่นเก่า กรุณาโหลดหน้าใหม่', ['reload']],
  'ยังไม่ตั้งสถานที่ชุมชน': ['สถานที่ชุมชนนี้ไม่อยู่ในรายการที่ตั้งไว้', ['amend', 'settings']],
  'ยังไม่ตั้งช่วงเวลาบริการชุมชน': ['ยังไม่ได้ตั้งช่วงเวลาที่ต้องถึงของบริการชุมชน', SETTINGS_FIX],
  'เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน': ['เวลาที่ต้องถึงอยู่นอกช่วงเวลาบริการชุมชนที่ตั้งไว้', ['call', 'amend', 'cancel']],
  'รูปแบบขากลับของผู้ร่วมเที่ยวไม่ตรงกัน': ['ขากลับของผู้ร่วมเที่ยวต้องเป็นรูปแบบเดียวกัน', ['single', 'call']],
  'ต้องจัดรอบรับหลายรอบผ่านเที่ยวที่ยืนยันแล้ว': ['รอบรับหลายรอบต้องเริ่มจากเที่ยวที่ยืนยันแล้ว', ['single', 'call']],
  'รอบรับ–ส่งทับกันภายในแผนเดียว': ['รถทำรอบรับ–ส่งตามแผนนี้พร้อมกันไม่ได้', ['call', 'amend', 'cancel']],
  'ต้องตรวจสอบพื้นที่รับบริการ': ['ยังไม่ได้ตรวจว่าจุดรับอยู่ในเขตพื้นที่ให้บริการ', ['area']],
  'ต้องยืนยันผู้ช่วยเคลื่อนย้ายประจำเที่ยว': ['ผู้ป่วยใช้รถเข็นหรือเปล ต้องมีผู้ช่วยเคลื่อนย้ายไปด้วย', ['helper']],
  'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว': ['กรุณาโหลดหน้าใหม่เพื่อใช้การจัดรอบโดยเจ้าหน้าที่', ['reload', 'call']],
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

// Legacy guidance may still contain an overlap error; it must never create a reservation.
export function overlappingTrips() { return [] }
// Existing confirmed trips for the same day/destination. Staff choose whether to combine.
export function joinCandidates(plan, trips = [], routes = []) {
  if ((plan?.service_type || 'patient') !== 'patient') return []
  return trips.filter(t => !(t.booking_ids || []).some(id => plan?.booking_ids?.includes(id)) && t.plan?.date === plan?.date && (t.plan?.service_type || 'patient') === 'patient' && t.state === 'confirmed' && sameDestinationGroup(routes, t.plan?.route_id, plan?.route_id)
    && (t.plan?.return_mode === plan?.return_mode ||
      (['wait', 'later'].includes(t.plan?.return_mode) && ['wait', 'later'].includes(plan?.return_mode)))).slice(0, 3)
}
// เหตุที่ไปคันเดียวกันไม่ได้ เป็นภาษาเจ้าหน้าที่ — ข้อความจากฐานข้อมูลเขียนไว้ให้ประชาชน ("กรุณาประสานเจ้าหน้าที่")
const JOIN_REFUSALS = [
  ['เที่ยวนี้ไม่เปิดร่วมแล้ว', 'เที่ยวนั้นออกรถแล้ว หรือเปลี่ยนสถานะไปแล้ว'],
  ['เที่ยวนี้ไม่พร้อมรับผู้ร่วมเพิ่ม', 'ผู้เดินทางเดิมในเที่ยวนั้นไม่ได้เลือกนั่งร่วม ใช้รถเข็น/เปล หรือขอยกเลิกไว้'],
  ['เวลาเริ่มรับของแผนร่วมเที่ยวผ่านแล้ว', 'ข้อมูลการจัดคิวรุ่นเก่า กรุณาโหลดหน้าใหม่'],
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
  else if (message === 'เวลาที่ต้องถึงอยู่นอกช่วงบริการชุมชน') {
    const rules = workspace.community_rules
    if (plan?.community_rules_version != null && rules?.rules_version != null && plan.community_rules_version !== rules.rules_version) {
      detail = 'กฎบริการชุมชนเปลี่ยนหลังตรวจแผน กรุณาโหลดข้อมูลล่าสุดแล้วตรวจแผนอีกครั้ง'
    } else if (Number.isFinite(rules?.window_start) && Number.isFinite(rules?.window_end)) {
      detail = `ช่วงเวลาที่ต้องถึงของบริการชุมชน ${clockTime(rules.window_start)}–${clockTime(rules.window_end)} น.`
    }
  }
  else if (message === 'เวลานัดแพทย์อยู่นอกช่วงที่เปิดรับจอง' && Number.isFinite(settings.office_start) && Number.isFinite(settings.office_end)) {
    detail = `เวลานัดแพทย์ที่เปิดรับจอง ${clockTime(settings.office_start)}–${clockTime(settings.office_end)} น.${selected.length ? ` · ${selected.map(b => `${b.patient_name} นัด ${dateTime(b.appointment_at)}`).join(' / ')}` : ''}`
  } else if (message === 'เวลารับ–ส่งอยู่นอกเวลาบริการ') {
    detail = 'ข้อมูลการจัดคิวจากระบบรุ่นเก่า กรุณาโหลดหน้าใหม่เพื่อใช้การจัดรอบโดยเจ้าหน้าที่'
  } else if (message === 'ที่นั่งไม่พอรวมผู้ติดตามและผู้ช่วยแล้ว' && Number.isFinite(plan?.seats) && Number.isFinite(settings.seats)) {
    detail = `แผนนี้ต้องใช้ ${plan.seats} ที่นั่ง รวมผู้ติดตามและผู้ช่วยแล้ว แต่รถตั้งไว้ ${settings.seats} ที่นั่ง ไม่รวมคนขับ`
  } else if (message === 'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว') {
    detail = 'ข้อมูลการจัดคิวจากระบบรุ่นเก่า กรุณาโหลดหน้าใหม่'
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
  if (!info?.routes?.some(r => r.id === form.route_id) || !Number.isFinite(info.office_start) || !Number.isFinite(info.office_end)) return null
  return { earliest: info.office_start, latest: info.office_end, possible: info.office_start <= info.office_end, span: null }
}

export function normalizeBookingPhone(value) {
  const translated = String(value ?? '').replace(/[๐-๙]/g, c => String(c.charCodeAt(0) - '๐'.charCodeAt(0)))
    .replace(/[\s()-]/g, '')
  const local = translated.replace(/^\+66/, '0')
  // Keep unrecognized input intact so validation can explain the problem; never guess missing digits.
  return /^0[0-9]{8,9}$/.test(local) ? local : value
}

// ── ประวัติการดำเนินการของคำขอ (patient_booking_history, 20261001100000) — แปลรหัสคำสั่งเป็นภาษาเจ้าหน้าที่ ──
// สีแถบซ้ายใช้ชุดเดียวกับขั้นของคำขอ (STAGES) ให้กวาดตาเห็นว่าเป็นช่วงไหนของงาน · สีเทา = แก้ข้อมูล/เอกสาร
const EDITED = '#94a3b8'
const HISTORY = {
  submitted: ['ส่งคำขอ', STAGES.submitted.color],
  requested_join: ['ขอร่วมเที่ยวที่มีอยู่', STAGES.submitted.color],
  staff_join: ['ให้ร่วมเที่ยวที่ยืนยันแล้ว', STAGES.confirmed.color],
  confirmed: ['ยืนยันรถ', STAGES.confirmed.color],
  confirmed_join: ['ยืนยันรถ · ร่วมเที่ยวเดิม', STAGES.confirmed.color],
  confirmed_multiwave: ['ยืนยันรถ · รับหลายรอบ', STAGES.confirmed.color],
  rescheduled_from: ['เปลี่ยนวันเวลาเดินทาง', STAGES.confirmed.color],
  moved_into_trip: ['ย้ายไปร่วมเที่ยวอื่น', STAGES.confirmed.color],
  amended: ['แก้ข้อมูลตามที่ประสาน', EDITED],
  pickup_corrected: ['แก้จุดรับ', EDITED],
  hospital_changed: ['เปลี่ยนโรงพยาบาล', EDITED],
  return_later_for_multiwave: ['เปลี่ยนเป็นกลับมารับภายหลัง (รับหลายรอบ)', EDITED],
  schedule_updated: ['แจ้งเวลารับล่าสุด / รถล่าช้า', EDITED],
  driver_reassigned: ['เปลี่ยนคนขับ', EDITED],
  departure_corrected: ['แก้การกดออกรถผิด', EDITED],
  letter_recorded: ['บันทึกเลขหนังสือนำส่ง', EDITED],
  booking_letter_recorded: ['บันทึกเลขหนังสือนำส่ง', EDITED],
  odometer_recorded: ['บันทึกเลขไมล์', EDITED],
  trip_next: ['ออกรถ', STAGES.running.color],
  passenger_next: ['บันทึกขั้นผู้เดินทาง', STAGES.running.color],
  ready_return: ['แจ้งพร้อมให้มารับกลับ', STAGES.running.color],
  issue: ['แจ้งเหตุขัดข้อง', '#b91c1c'],
  resolve: ['แก้เหตุขัดข้องแล้ว เดินรถต่อ', STAGES.running.color],
  trip_finish: ['กลับแล้ว · จบงาน', STAGES.completed.color],
  cancel_passenger: ['นำออกจากเที่ยว (ยกเลิก)', STAGES.cancelled.color],
  release: ['คืนคิวทั้งเที่ยว', STAGES.cancelled.color],
  duplicate_booking_closed: ['ปิดคำขอซ้ำ (ใช้คิวที่ยืนยันแล้ว)', STAGES.cancelled.color],
  // เปิดคำขอที่ปิดผิดกลับเป็นรอยืนยันรถ — ยังไม่มีปุ่มในระบบ เจ้าของระบบสั่งแก้ข้อมูลเป็นรายกรณี (2569-10-01 ใบที่ย้ายเข้าเที่ยวผิดวัน)
  reopened: ['เปิดคำขอกลับมาใช้', STAGES.submitted.color],
}
// เหตุการณ์ที่ทำให้คำขอมีเที่ยวที่ยืนยันแล้ว — ใช้ตัดสินป้ายของ "cancel" ด้านล่าง
const HISTORY_CONFIRMS = new Set(['confirmed', 'confirmed_join', 'confirmed_multiwave', 'staff_join', 'rescheduled_from', 'moved_into_trip'])
// รับรายการตามลำดับเวลา (เก่า → ใหม่ แบบประวัติของคำร้อง) · joined_from_trip เกิดคู่กับ moved_into_trip ในคำสั่งเดียว แสดงบรรทัดเดียวพอ
export function describeHistory(events = []) {
  let confirmed = false
  return events.filter(e => e.action !== 'joined_from_trip').map(e => {
    let [label, color] = HISTORY[e.action] || [e.action, EDITED]
    // ยกเลิกก่อนยืนยันรถ = ยกเลิกทันที · หลังยืนยันรถ = แค่ "ขอยกเลิก" รอเจ้าหน้าที่ประสาน (patient_booking_action)
    // ป้ายเดียวตายตัวจะทำให้เข้าใจผิดว่าคำขอที่ยังเดินทางอยู่ถูกยกเลิกไปแล้ว จึงไล่สถานะตามลำดับเหตุการณ์เอง
    if (e.action === 'cancel') [label, color] = confirmed ? ['ขอยกเลิก (รอเจ้าหน้าที่ประสาน)', STAGES.submitted.color] : ['ยกเลิกคำขอ', STAGES.cancelled.color]
    if (e.action === 'submitted' && e.entry_channel === 'staff') label = 'รับคำขอแทน (โทรศัพท์/เคาน์เตอร์)'
    if (HISTORY_CONFIRMS.has(e.action)) confirmed = true
    if (['release', 'cancel_passenger', 'reopened'].includes(e.action)) confirmed = false
    const who = [`${e.actor_name}${e.by_booker ? ' (ผู้จอง)' : ''}`, e.for_driver && `บันทึกแทนคนขับ ${e.for_driver}`].filter(Boolean).join(' · ')
    const extra = e.action === 'driver_reassigned' ? `${e.driver_before || 'คนขับเดิม'} → ${e.driver_after || 'คนขับใหม่'}` : ''
    return { id: e.id, at: e.at, label, color, who, extra, note: e.note || '' }
  })
}

// หน้ารายงานโหลดประวัติทีละหน้า จึงห้ามเดาสถานะย้อนหลังจากคำขอปัจจุบัน
// โดยเฉพาะ cancel ที่อาจเป็นเพียงการขอประสานยกเลิกหลังยืนยันรถแล้ว
export function reportEvent(event, workspace = {}) {
  const detail = event.detail || {}
  const extraLabels = {
    cancel: 'ดำเนินการยกเลิกคำขอ',
    rescheduled: 'ย้ายผู้เดินทางออกจากเที่ยวเดิม',
    joined_from_trip: 'รับผู้เดินทางจากเที่ยวอื่นมาร่วมเที่ยว',
    delete_booking: 'ลบคำขอ',
    settings_changed: 'ปรับตั้งค่าบริการรถ',
    trip_next: 'บันทึกการเดินรถ',
    note: 'บันทึกข้อความเพิ่มเติม',
    day_odometer_recorded: 'บันทึกเลขไมล์ประจำวัน',
  }
  const label = extraLabels[event.action] || HISTORY[event.action]?.[0] || 'บันทึกการเปลี่ยนแปลง'
  const booking = (workspace.bookings || []).find(b => b.id === (detail.booking_id || event.entity_id))
  const trip = (workspace.trips || []).find(t => t.id === event.entity_id)
  const riders = booking ? [booking] : trip ? (workspace.bookings || []).filter(b => b.trip_id === trip.id && b.status !== 'cancelled') : []
  return {
    label: event.action === 'submitted' && booking?.entry_channel === 'staff' ? 'รับคำขอแทน (โทรศัพท์/เคาน์เตอร์)' : label,
    // เลขไมล์ประจำวันผูกกับวัน ไม่ใช่คำขอ/เที่ยว — บอกวันที่และตัวเลขแทนชื่อผู้เดินทาง
    subject: event.action === 'day_odometer_recorded' ? `วันที่ ${detail.date || '-'} · เลขไมล์ ${detail.start ?? '-'} → ${detail.end ?? '-'}${detail.issue ? ' (รอตรวจสอบ)' : ''}`
      : riders.length ? riders.map(bookingName).join(', ') : trip?.plan?.route_label || '',
    reference: `${booking ? 'คำขอเลขที่' : trip ? 'เที่ยวรถเลขที่' : 'รายการอ้างอิง'} ${String(booking?.id || trip?.id || event.entity_id || '').slice(0, 8).toUpperCase()}`,
    note: typeof detail.note === 'string' ? detail.note : '',
  }
}

// ใช้ชุดข้อมูลรายเดือนจาก RPC โดยตรง ไม่ใช้ workspace ที่เก็บเที่ยวปิดแค่ 30 วัน
// days (เลขไมล์เหมาเป็นวัน): ระยะทาง = ผลรวมของ "วันที่มีเที่ยวจบแล้วในรายงานนี้" วันละครั้ง ไม่คูณตามจำนวนเที่ยว
//   missingDistance นับเป็น "วัน" ที่ยังไม่มีเลขไมล์หรือรอตรวจสอบ · รายงานกรองบริการ = ระยะของรถทั้งวันที่มีบริการนั้น
// ไม่ส่ง days = รายงานรุ่นก่อนเลขไมล์รายวัน ใช้ระยะรายเที่ยวเดิม (unit = 'trip')
export function monthReportSummary(trips = [], days = null) {
  const completed = trips.filter(t => t.state === 'completed')
  const base = {
    completed: completed.length,
    pending: trips.filter(t => t.state !== 'completed' && t.state !== 'cancelled').length,
    passengers: completed.reduce((sum, t) => sum + Number(t.passengers || 0), 0),
    companions: completed.reduce((sum, t) => sum + Number(t.companions || 0), 0),
  }
  if (Array.isArray(days)) {
    const byDate = new Map(days.map(d => [d.date, d]))
    const dates = [...new Set(completed.map(t => t.date).filter(Boolean))].sort()
    const measured = dates.filter(date => dayDistance(byDate.get(date)) !== null)
    return { ...base, unit: 'day', days: dates.length, distance: measured.reduce((sum, date) => sum + dayDistance(byDate.get(date)), 0), missingDistance: dates.length - measured.length }
  }
  const measured = completed.filter(t => !t.odometer_issue && typeof t.distance === 'number' && Number.isFinite(t.distance) && t.distance >= 0)
  return { ...base, distance: measured.reduce((sum, t) => sum + t.distance, 0), missingDistance: completed.length - measured.length }
}

export function serviceReportSummary(trips = [], days = null) {
  const completed = trips.filter(t => t.state === 'completed')
  return { ...monthReportSummary(trips, days),
    people: completed.reduce((sum, t) => sum + Number(t.people ?? Number(t.passengers || 0) + Number(t.companions || 0)), 0),
    requests: completed.reduce((sum, t) => sum + Number(t.request_count ?? t.passengers ?? 0), 0),
  }
}
