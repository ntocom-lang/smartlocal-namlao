import { useState } from 'react'
import { useTenant } from '../../contexts/TenantContext'
import { supabase } from '../../lib/supabase'
import MapPicker from '../MapPicker'
import { ListCard, Pills, Sheet } from './StaffShell'
import { AmendBooking, TripFundDocs, OdometerForm } from './BookingOperations'
import { ScheduleUpdate, RescheduleJourney } from './BookingDaySchedule'
import { STAGES, TRIP_STATUS, RETURN_MODES, MOBILITY, bookingStage, staffNextAction, bookingPlanGuidance, joinRefusal, suggestGroups, dateTime, clockOf, whenLabel, inputClass, buttonClass, primaryClass, pickupForBooking, returnForBooking } from '../../lib/patientBooking'

/**
 * กล่อง "คำขอรถ" ของเจ้าหน้าที่ — 1 แถว = 1 คำขอ และมีปุ่มเดียวต่อแถวที่บอกงานถัดไป
 *
 * เจ้าของระบบสั่ง 2569-09-21 ให้ทำแบบกล่องงาน "คำร้อง/คำขอบริการ" หลังทดลองของจริงแล้วงงทุกฝั่ง
 * ของเดิมแยก 3 แท็บ (ตารางออกรถ · คิวรอจัดแผน · เที่ยวเดินรถ) ยืนยัน 1 คำขอต้องกด 3–4 ครั้ง
 * พร้อมอ่านผลตรวจแผนเอง และเมื่อชนคิวก็ไม่มีปุ่มให้ไปต่อ
 *
 * "ยืนยันรถ" ต้องทวนชื่อและวันเวลานัดก่อน ระบบจึงตรวจคิวและบันทึก (patient_booking_preview → confirm)
 * ติดปัญหา → แผ่นรายละเอียดเปิดเอง บอกเหตุประโยคเดียว + ปุ่มแก้ที่กดแล้วระบบยืนยันต่อให้เลย
 * ⚠️ การยืนยันรถยังเป็นเจ้าหน้าที่กดเองทุกครั้ง เพราะเป็นการตัดสินให้บริการแก่ประชาชน ระบบไม่ยืนยันแทน
 * ⚠️ คอลัมน์ "ดำเนินการ" ต้องปักขวาเสมอ ตารางกว้างกว่าพื้นที่ ถอดแล้วปุ่มหลักถูกตัดทุกจอ (#134)
 */

const PILLS = [
  ['all', 'ทั้งหมด', '#64748b'],
  ['submitted', 'รอยืนยันรถ', STAGES.submitted.color],
  ['confirmed', 'ยืนยันแล้ว', STAGES.confirmed.color],
  ['running', 'กำลังเดินทาง', STAGES.running.color],
  ['completed', 'เสร็จแล้ว', STAGES.completed.color],
  ['cancelled', 'ยกเลิก', STAGES.cancelled.color],
]
const RELATIONS = { self: 'ผู้ป่วยจองเอง', relative: 'ญาติจองแทน', caregiver: 'ผู้ดูแลจองแทน' }
const ref = id => String(id).slice(0, 8).toUpperCase()
const CONFLICT = 'ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว'

function linkedConfirmedBooking(booking, bookings, events = []) {
  if (booking.status !== 'cancelled') return null
  const event = events.find(item => item.entity_id === booking.id && item.action === 'cancel_passenger' && item.detail?.existing_booking_id)
  return bookings.find(item => item.id === event?.detail.existing_booking_id && ['confirmed', 'completed'].includes(item.status)) || null
}

// แถวของกล่อง: คำขอ + เที่ยว + ขั้น + งานถัดไป + กลุ่มที่ระบบเสนอให้ไปด้วยกัน
// ระบบเสนอกลุ่มเฉพาะคนที่เลือก "นั่งร่วมได้" เดินได้เอง ปลายทาง/วัน/ขากลับตรงกัน เวลาห่างไม่เกิน 30 นาที
// และที่นั่งพอ (suggestGroups) — ฐานข้อมูลคำนวณแผนทั้งก้อนซ้ำใต้ล็อกก่อนยืนยันทุกครั้ง
function buildRows(workspace) {
  const trips = new Map(workspace.trips.map(t => [t.id, t]))
  const groupOf = new Map()
  for (const group of suggestGroups(workspace.bookings.filter(b => !b.requested_trip_id), workspace.settings)) for (const b of group) groupOf.set(b.id, group)
  const rows = workspace.bookings.map(booking => {
    // คนที่ถูกนำออกจากเที่ยวยังมี trip_id ค้างอยู่ — ไม่แสดงเที่ยวนั้นเป็นของเขาอีก (แบบการ์ดฝั่งประชาชน)
    const trip = booking.trip_id && booking.status !== 'cancelled' ? trips.get(booking.trip_id) || null : null
    const linked = linkedConfirmedBooking(booking, workspace.bookings, workspace.events)
    return { booking, trip, linked, stage: bookingStage(booking, trip), next: staffNextAction(booking, trip), group: groupOf.get(booking.id) || [booking] }
  })
  // งานที่ต้องทำขึ้นก่อน (เหตุขัดข้อง → ขอยกเลิก → รอยืนยันรถ → เอกสาร) แล้วคำขอที่ยังเดินอยู่ตามวันนัด
  // ส่วนที่จบแล้วเรียงล่าสุดขึ้นก่อน
  const live = r => ['submitted', 'confirmed', 'running'].includes(r.stage)
  const at = r => String((r.linked || r.booking).appointment_at || '')
  return rows.sort((x, y) => x.next.rank - y.next.rank || Number(live(y)) - Number(live(x))
    || (live(x) ? at(x).localeCompare(at(y)) : at(y).localeCompare(at(x))))
}

const haystack = ({ booking: b, linked }) => [b.patient_name, b.requester_name, b.phone, b.pickup, b.route_label, ref(b.id), dateTime(b.appointment_at), whenLabel(b.appointment_at), linked && ref(linked.id), linked && dateTime(linked.appointment_at)].join(' ').toLowerCase()

function actionLabel({ next, group, booking, trip }) {
  if (next.id === 'view' && booking.status === 'confirmed' && trip?.state === 'confirmed') return 'ดูขั้นตอนต่อไป'
  if (next.id !== 'confirm') return next.label
  if (booking.requested_trip_id) return 'ยืนยันรถ · ร่วมเที่ยวที่ขอ'
  return group.length > 1 ? `ยืนยันรถ · ไปด้วยกัน ${group.length} คน` : 'ยืนยันรถ'
}

// ปุ่มเดียวของแถว — ปุ่มทึบสีตามผลที่จะได้ = ยังมีงานค้าง · ปุ่มกรอบเทา = แค่เปิดดู (แบบกล่องคำขอบริการ)
function RowButton({ row, busy, onPress, full }) {
  const { next } = row
  return <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); onPress(row) }}
    className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-50 ${full ? 'w-full text-base' : ''} ${next.color ? 'border-transparent text-white' : 'border-slate-300 bg-white text-slate-700'}`}
    style={next.color ? { backgroundColor: next.color } : undefined}>{actionLabel(row)}</button>
}

function StatusChips({ row }) {
  const { booking: b, trip, stage } = row
  const issue = b.status === 'confirmed' && trip?.state === 'issue'
  const text = issue ? 'เหตุขัดข้อง' : stage === 'running' ? TRIP_STATUS[trip.state] : STAGES[stage].label
  return <span className="inline-flex flex-wrap justify-center gap-1">
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${issue ? 'bg-red-100 text-red-800' : STAGES[stage].chip}`}>{text}</span>
    {b.status === 'confirmed' && b.cancel_requested && <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">ขอยกเลิก</span>}
    {b.status === 'confirmed' && b.return_ready && <span className="whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-900">พร้อมรับกลับ</span>}
  </span>
}

// งานที่ต้องใส่เหตุผลลงประวัติ (ยกเลิก คืนคิว แก้เหตุขัดข้อง) — กล่องละงาน ปุ่มเดียว
// เหตุผลที่ระบบรู้อยู่แล้วเติมไว้ให้แก้ได้ งานที่ระบบไม่รู้เหตุผลปล่อยว่างให้เจ้าหน้าที่พิมพ์เอง
// seenByCitizen = งานที่ยกเลิกคำขอ ผู้จองจะอ่านข้อความนี้ในหน้าของตัวเอง (20260922130000) ป้ายช่องกรอกต้องบอกให้รู้ตัว
// ก่อนพิมพ์ ไม่ใช่ให้รู้ทีหลังว่าเขียนอะไรไป · งานภายใน (คืนคิว แก้เหตุขัดข้อง) ไม่ตั้งธงนี้ เพราะผู้จองไม่เห็น
function ReasonAction({ title, hint, defaultReason = '', placeholder = '', button, primary, busy, onRun, seenByCitizen }) {
  const [note, setNote] = useState(defaultReason)
  return <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
    <p className="font-semibold">{title}</p>
    {hint && <p className="text-sm text-slate-600">{hint}</p>}
    <label className="block text-sm">{seenByCitizen ? 'เหตุผล (ผู้จองจะเห็นข้อความนี้)' : 'เหตุผล (บันทึกในประวัติ)'}
      <input className={inputClass} aria-label={`เหตุผล: ${title}`} value={note} maxLength={500} placeholder={placeholder} onChange={e => setNote(e.target.value)} />
    </label>
    <button type="button" className={primary ? primaryClass : buttonClass} disabled={busy || !note.trim()} onClick={() => onRun(note.trim())}>{button}</button>
  </div>
}

function Facts({ booking: b, trip, others, historical = false }) {
  const pin = Number.isFinite(b.pickup_lat) && Number.isFinite(b.pickup_lng)
  const items = [
    [historical ? 'วันเวลานัดเดิม (ยกเลิก)' : 'วันเวลานัด', dateTime(b.appointment_at)],
    [historical ? 'โรงพยาบาลในคำขอเดิม' : 'โรงพยาบาล', b.route_label],
    [historical ? 'ขากลับในคำขอเดิม' : 'ขากลับ', b.return_mode === 'one_way' ? 'ขาไปอย่างเดียว' : `${RETURN_MODES[b.return_mode]} · ${b.return_at ? `ประมาณ ${clockOf(b.return_at)} น.` : 'ยังไม่ทราบเวลา'}`],
    ['จุดรับ', <>{b.pickup}{pin && <a className="ml-2 font-semibold text-sky-800 underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${b.pickup_lat},${b.pickup_lng}`}>📍 นำทาง</a>}</>],
    ['การเดินทาง', `${MOBILITY[b.mobility]} · ผู้ติดตาม ${b.companions} คน${b.share ? ' · นั่งร่วมกับผู้ป่วยอื่นได้' : ''}`],
    ['ผู้จอง', b.relation === 'self' ? RELATIONS.self : `${b.requester_name || '—'} (${RELATIONS[b.relation] || 'จองแทน'})`],
    ['เบอร์ติดต่อ', b.phone ? <a className="font-semibold text-sky-800 underline" href={`tel:${b.phone}`}>{b.phone}</a> : '—'],
    ['รับเรื่องทาง', b.entry_channel === 'staff' ? 'เจ้าหน้าที่รับแทน (โทรศัพท์/เคาน์เตอร์)' : 'ออนไลน์'],
    ...(trip ? [
      ['สถานะเที่ยว', TRIP_STATUS[trip.state]],
      ['รถมารับ', `ประมาณ ${clockOf(pickupForBooking(trip, b))} น.`],
      ...(b.return_mode !== 'one_way' ? [['รับกลับ', `ประมาณ ${clockOf(returnForBooking(trip, b))} น.`]] : []),
      ['คนขับ', trip.driver_name || '—'],
      ...(trip.helper_name ? [['ผู้ช่วย', trip.helper_name]] : []),
    ] : []),
    ...(others.length ? [[trip ? 'ในเที่ยวเดียวกัน' : 'ระบบเสนอไปด้วยกัน', others.map(x => x.patient_name).join(', ')]] : []),
  ]
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-slate-200 p-3 text-sm">
    {items.map(([label, value]) => <div key={label} className="contents">
      <dt className="whitespace-nowrap font-semibold text-slate-600">{label}</dt><dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>)}
  </dl>
}

// ยืนยันรถไม่ผ่าน: เหตุประโยคเดียว + ปุ่มแก้ที่กดแล้วระบบยืนยันต่อให้เอง (กดรวม 2 ครั้ง)
function ProblemBox({ row, problem, rows, workspace, busy, isAdmin, onConfirm, onJoin, onOpen, act, onReload, onSettings }) {
  const { booking: b } = row
  const issues = problem.plan.errors.map(message => bookingPlanGuidance(message, problem.plan, workspace))
  const fixes = new Set(issues.flatMap(x => x.fixes))
  // ผู้ช่วยเคลื่อนย้าย: เติมชื่อจากเที่ยวล่าสุดให้ (ส่วนใหญ่เป็นคนเดิม) เจ้าหน้าที่ตรวจว่าไปได้จริงแล้วกด
  const lastHelper = workspace.trips.filter(t => t.helper_name).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0]?.helper_name || ''
  const [helper, setHelper] = useState(problem.helper || lastHelper)
  const [amending, setAmending] = useState(false)
  const issueRow = rows.find(r => r.booking.status === 'confirmed' && r.trip?.state === 'issue' && r.trip.plan?.date === problem.plan.date)
  const conflict = problem.plan.errors.includes(CONFLICT)
  const cancelReason = conflict ? 'รถไม่ว่างในช่วงเวลาที่ขอ' : issues.find(x => x.fixes.includes('cancel'))?.text || ''
  const retry = (options = {}) => onConfirm(row, { ids: problem.ids, helper: fixes.has('helper') ? helper.trim() : '', ...options })
  return <section aria-label="ยืนยันรถไม่ได้" className="space-y-3 rounded-xl border-2 border-red-300 bg-red-50 p-3 sm:p-4">
    <h4 className="font-bold text-red-800">ยืนยันรถไม่ได้{issues.length > 1 ? ` · ต้องแก้ ${issues.length} เรื่อง` : ''}</h4>
    <ol className="space-y-2">{issues.map((x, i) => <li key={x.message} className="rounded-lg bg-white p-3">
      <p className="font-semibold text-slate-900">{issues.length > 1 ? `${i + 1}. ` : ''}{x.text}</p>
      {x.detail && <p className="mt-1 text-sm text-slate-700">{x.message === CONFLICT ? 'ชนกับ: ' : ''}{x.detail}</p>}
    </li>)}</ol>
    {/* ชนคิว: ระบบลองแผน "ไปคันเดียวกัน" ไว้แล้ว — ขึ้นเวลาใหม่ของผู้เดินทางเดิมให้เห็นก่อนกด
        (ขึ้นรถเพิ่ม 1 คน รถต้องออกรับเร็วขึ้น) ระบบแจ้งทุกคนในแอป แต่ควรโทรแจ้งผู้เดินทางเดิมด้วย */}
    {(problem.joins || []).map(option => {
      const riders = workspace.bookings.filter(x => x.trip_id === option.trip.id && x.status === 'confirmed')
      if (!option.plan || option.plan.errors?.length) return <p key={option.trip.id} className="rounded-lg bg-white p-3 text-sm text-slate-700">
        ไปคันเดียวกับเที่ยวเริ่มรับ {clockOf(option.trip.plan?.pickup_at)} น. ไม่ได้: {joinRefusal(option, workspace)}
      </p>
      const incoming = rows.filter(x => option.ids?.includes(x.booking.id)).map(x => x.booking)
      const waves = option.plan.outbound_waves || []
      const returns = option.plan.return_waves || []
      const changedWait = [...riders, ...incoming].filter(x => x.return_mode === 'wait')
      return <div key={option.trip.id} className="space-y-2 rounded-lg border-2 border-emerald-400 bg-white p-3">
        <p className="font-semibold text-emerald-900">{option.plan.multiwave ? `จัดรถรับ ${waves.length} รอบได้` : 'ไปคันเดียวกับเที่ยวเดิมได้'}{riders.length ? ` · ร่วมเที่ยวกับ ${riders.map(x => x.patient_name).join(', ')}` : ''}</p>
        {option.plan.multiwave ? <>
          <ol className="list-inside list-decimal text-sm">{waves.map((wave, i) => <li key={i}>รอบรับ {i + 1}: เริ่ม {clockOf(wave.pickup_at)} น. · นัดแพทย์ {clockOf(wave.appointment_start)}–{clockOf(wave.appointment_end)} น.</li>)}</ol>
          <p className="text-sm">รับกลับ {returns.length} รอบ: {returns.map(w => `${clockOf(w.return_start)} น.`).join(' / ') || 'ขาไปอย่างเดียว'}</p>
          {!!changedWait.length && <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">ต้องประสาน {changedWait.map(x => x.patient_name).join(', ')} ก่อน: รถจะออกไปรับรอบอื่น จึงเปลี่ยนจาก “รอรับกลับ” เป็น “กลับมารับภายหลัง” ระบบบันทึกและแจ้งเวลาใหม่เมื่อยืนยัน</p>}
          <p className="text-sm">คนขับจะเห็นทุกรอบในงานเดียว และกดเพียง “ออกรถ” กับ “กลับแล้ว” เมื่อจบทั้งหมด</p>
        </> : <p className="text-sm">เวลารถออกรับใหม่ <strong>{clockOf(option.plan.pickup_at)} น.</strong> (เดิม {clockOf(option.trip.plan?.pickup_at)} น.) ระบบแจ้งเวลาใหม่ในแอปให้ทุกคน ควรโทรแจ้งผู้เดินทางเดิมด้วย</p>}
        {(option.plan.multiwave ? changedWait : riders).some(x => x.phone) && <div className="flex flex-wrap gap-2">{(option.plan.multiwave ? changedWait : riders).filter(x => x.phone).map(x => <a key={x.id} className={`${buttonClass} inline-flex items-center`} href={`tel:${x.phone}`}>📞 {x.patient_name}</a>)}</div>}
        <button type="button" className={primaryClass} disabled={busy} onClick={() => onJoin(row, option)}>{option.plan.multiwave ? 'ประสานแล้ว · ยืนยันรถหลายรอบ' : `ให้ไปคันเดียวกัน · รถออกรับ ${clockOf(option.plan.pickup_at)} น.`}</button>
      </div>
    })}
    {fixes.has('helper') && <label className="block">ชื่อผู้ช่วยเคลื่อนย้ายที่ไปด้วย
      <input className={inputClass} value={helper} maxLength={200} onChange={e => setHelper(e.target.value)} />
      {!!lastHelper && helper === lastHelper && <span className="text-sm text-slate-600">เติมชื่อจากเที่ยวล่าสุดให้แล้ว ตรวจว่าไปได้จริงก่อนกด</span>}
    </label>}
    <div className="flex flex-wrap gap-2">
      {fixes.has('area') && <button type="button" className={primaryClass} disabled={busy} onClick={() => retry({ verifyArea: true })}>ตรวจแล้ว จุดรับอยู่ในเขต · ยืนยันรถ</button>}
      {fixes.has('helper') && !fixes.has('area') && <button type="button" className={primaryClass} disabled={busy || !helper.trim()} onClick={() => retry()}>ยืนยันรถ</button>}
      {fixes.has('single') && <button type="button" className={buttonClass} disabled={busy} onClick={() => retry({ ids: [b.id], separate: true })}>ยืนยันเฉพาะ {b.patient_name} (ไม่ไปด้วยกัน)</button>}
      {fixes.has('amend') && !amending && <button type="button" className={buttonClass} disabled={busy} onClick={() => setAmending(true)}>แก้วันเวลาหลังโทรประสาน</button>}
      {fixes.has('issue') && issueRow && <button type="button" className={buttonClass} onClick={() => onOpen(issueRow.booking.id)}>ไปแก้เหตุขัดข้องของวันนั้น</button>}
      {fixes.has('settings') && isAdmin && <button type="button" className={buttonClass} onClick={onSettings}>ไปหน้าตั้งค่า</button>}
      {fixes.has('reload') && <button type="button" className={buttonClass} disabled={busy} onClick={onReload}>โหลดข้อมูลล่าสุด</button>}
      {fixes.has('call') && b.phone && <a className={`${buttonClass} inline-flex items-center`} href={`tel:${b.phone}`}>📞 โทรหาผู้จอง {b.phone}</a>}
    </div>
    {fixes.has('settings') && !isAdmin && <p className="text-sm">ต้องให้ผู้ดูแลระบบแก้ในหน้า “ตั้งค่า” ก่อน</p>}
    {amending && <AmendBooking booking={b} routes={workspace.settings?.routes || []} busy={busy} saveLabel="บันทึกและยืนยันรถ" onBack={() => setAmending(false)}
      onSave={(values, reason) => onConfirm(row, { ids: [b.id], separate: true, amend: { booking: b, values, reason } })} />}
    {fixes.has('cancel') && <ReasonAction busy={busy} title={conflict ? 'รถไม่ว่าง ให้บริการตามเวลานี้ไม่ได้' : 'ให้บริการตามคำขอนี้ไม่ได้'}
      hint="ผู้จองจะเห็น “ยกเลิกแล้ว” พร้อมเหตุผลบรรทัดล่างนี้ในหน้าของตัวเอง ควรโทรแจ้งก่อนกด" defaultReason={cancelReason} seenByCitizen
      button={conflict ? 'แจ้งว่ารถไม่ว่าง และยกเลิกคำขอ' : 'ยกเลิกคำขอ'} onRun={note => act(b, 'cancel', note)} />}
  </section>
}

// งานที่ไม่ได้ทำทุกวัน พับไว้ใต้ "จัดการเพิ่มเติม" — งานหลักของแถวอยู่ด้านบนเสมอ
function MoveIntoTrip({ booking, trip, passengers, workspace, busy, onReload }) {
  const { tenant } = useTenant()
  const [selected, setSelected] = useState('')
  const [operation, setOperation] = useState(() => crypto.randomUUID())
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [approvedDuplicate, setApprovedDuplicate] = useState(false)
  const [openedAt] = useState(() => Date.now())
  const options = workspace.trips.filter(candidate => candidate.id !== trip.id && candidate.state === 'confirmed' &&
    candidate.plan?.route_id === booking.route_id && candidate.plan?.return_mode === booking.return_mode &&
    new Date(candidate.plan?.pickup_at).getTime() > openedAt).map(candidate => {
    const riders = workspace.bookings.filter(item => item.trip_id === candidate.id && item.status === 'confirmed')
    if (!riders.length || riders.some(item => !item.share || item.mobility !== 'walk' || item.passenger_step !== 0 || item.cancel_requested || item.return_ready)) return null
    const first = [...riders].sort((a, b) => a.appointment_at.localeCompare(b.appointment_at) || a.id.localeCompare(b.id))[0]
    return { trip: candidate, rider: first, count: riders.length }
  }).filter(Boolean).sort((a, b) => a.rider.appointment_at.localeCompare(b.rider.appointment_at))
  const target = options.find(option => option.trip.id === selected)
  const existingBooking = target && workspace.bookings.find(item => item.trip_id === target.trip.id && item.status === 'confirmed' &&
    item.id !== booking.id && item.patient_name === booking.patient_name && item.phone === booking.phone &&
    item.route_id === booking.route_id && item.appointment_at === target.rider.appointment_at)
  const move = async () => {
    if (!target || pending || busy) return
    const reviewedRider = existingBooking || target.rider
    setPending(true); setError(''); setMessage('')
    try {
      const expected = { trip: trip.id, revision: trip.revision, docs_revision: trip.docs_revision,
        schedule_revision: trip.schedule_revision, settings_revision: workspace.settings.revision,
        bookings: Object.fromEntries([...passengers].sort((a, b) => a.id.localeCompare(b.id)).map(item => [item.id, item.revision])) }
      const { data, error: failure } = await supabase.rpc('patient_booking_move_into_trip', {
        p_muni: tenant.id, p_op: operation, p_booking: booking.id, p_expected: expected,
        p_target: target.trip.id, p_target_revision: target.trip.revision,
        p_target_booking: reviewedRider.id, p_target_booking_revision: reviewedRider.revision,
      })
      if (failure || !data?.saved) setError(failure?.message || 'ย้ายคิวไม่สำเร็จ กรุณาลองใหม่')
      else { setMessage(data.duplicate_closed ? 'ปิดคำขอซ้ำแล้ว คิวในเที่ยวปลายทางยังอยู่ ระบบคำนวณเที่ยวเดิมและแจ้งผู้เกี่ยวข้องแล้ว กรุณาพิมพ์เอกสารเที่ยวเดิมใหม่' : 'ย้ายไปร่วมเที่ยวแล้ว ระบบแจ้งผู้เกี่ยวข้องแล้ว กรุณาพิมพ์เอกสารใหม่'); await onReload() }
    } catch { setError('ติดต่อระบบไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง') }
    finally { setPending(false) }
  }
  return <div className="space-y-3 rounded-xl bg-sky-50 p-3">
    <p className="font-semibold">ย้ายไปร่วมเที่ยวที่มีอยู่</p>
    <p className="text-sm">ย้ายเฉพาะ {booking.patient_name} · ระบบใช้เวลานัดและเวลารับกลับของเที่ยวที่เลือก ตรวจที่นั่งและเวลารถใหม่ แล้วเก็บเที่ยวเดิมกับเอกสารไว้เป็นประวัติ</p>
    <label className="block">เลือกเที่ยวปลายทาง<select className={inputClass} value={selected} onChange={event => { setSelected(event.target.value); setOperation(crypto.randomUUID()); setApprovedDuplicate(false); setError(''); setMessage('') }}>
      <option value="">เลือกวันที่และผู้เดินทางในเที่ยว</option>
      {options.map(option => <option key={option.trip.id} value={option.trip.id}>{dateTime(option.rider.appointment_at)} · {option.rider.patient_name} · {option.count} คน</option>)}
    </select></label>
    {target && <p className="rounded-lg bg-white p-3 text-sm">วันเวลานัดใหม่ {dateTime(target.rider.appointment_at)} · {target.rider.return_at ? `รับกลับ ${dateTime(target.rider.return_at)}` : 'เที่ยวไปอย่างเดียว'} · จุดรับของผู้เดินทางรายนี้ยังคงเดิม เวลารถมารับจะคำนวณใหม่</p>}
    {existingBooking && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">ผู้เดินทางมีคิวที่ยืนยันแล้วในเที่ยวนี้ · เลขที่ {ref(existingBooking.id)}</p>
      <p>ไม่ต้องเพิ่มที่นั่งซ้ำ ระบบจะปิดเฉพาะคำขอที่กำลังเปิดอยู่ คิวในเที่ยวปลายทางยังอยู่ ผู้เดินทางคนอื่นในเที่ยวเดิมยังเดินทางตามปกติ แต่เวลารถรับอาจเปลี่ยนหลังคำนวณแผนใหม่ ระบบจะแจ้งผู้เกี่ยวข้องและต้องพิมพ์เอกสารเที่ยวเดิมใหม่</p>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="size-5 shrink-0" checked={approvedDuplicate} onChange={event => setApprovedDuplicate(event.target.checked)} />ตรวจแล้วว่าคิวปลายทางเป็นของผู้เดินทางรายนี้ และต้องการปิดคำขอซ้ำ</label>
    </div>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">{error} · คิวเดิมยังอยู่</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900">{message}</p>}
    <button type="button" className={primaryClass} disabled={!target || pending || busy || (existingBooking && !approvedDuplicate)} onClick={move}>{pending ? 'กำลังตรวจคิว...' : existingBooking ? 'ปิดคำขอซ้ำ · ใช้คิวที่ยืนยันแล้ว' : 'ย้ายไปร่วมเที่ยวนี้'}</button>
  </div>
}

function ChangeHospital({ booking, trip, passengers, workspace, busy, onReload, onBack }) {
  const { tenant } = useTenant()
  const current = { trip: trip.id, revision: trip.revision, docs_revision: trip.docs_revision,
    schedule_revision: trip.schedule_revision, settings_revision: workspace.settings.revision,
    bookings: Object.fromEntries([...passengers].sort((a, b) => a.id.localeCompare(b.id)).map(b => [b.id, b.revision])) }
  const [expected] = useState(current)
  const [route, setRoute] = useState('')
  const [scope, setScope] = useState('single')
  const [operation, setOperation] = useState(() => crypto.randomUUID())
  const [review, setReview] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const stale = JSON.stringify(current) !== JSON.stringify(expected)
  const routes = (workspace.settings.routes || []).filter(r => r.id !== booking.route_id)
  const selected = routes.find(r => r.id === route)
  const reset = () => { setReview(false); setError(''); setOperation(crypto.randomUUID()) }
  const save = async () => {
    if (pending || busy || stale || saved || !selected) return
    setPending(true); setError('')
    try {
      const { data, error: failure } = await supabase.rpc('patient_booking_change_hospital', {
        p_muni: tenant.id, p_op: operation, p_booking: booking.id, p_expected: expected, p_route: route, p_scope: scope,
      })
      if (failure || !data?.saved) setError(failure?.message || 'ยังเปลี่ยนโรงพยาบาลไม่สำเร็จ กรุณาลองใหม่')
      else { setSaved(true); await onReload() }
    } catch { setError('ติดต่อระบบไม่สำเร็จ กรุณาโหลดข้อมูลล่าสุดเพื่อตรวจผลก่อนลองใหม่') }
    finally { setPending(false) }
  }
  return <div className="space-y-3 rounded-xl border-2 border-sky-700 bg-sky-50 p-3">
    <h3 className="font-bold">เปลี่ยนโรงพยาบาลก่อนรถออก</h3>
    {saved ? <p role="status">เปลี่ยนโรงพยาบาลแล้ว ระบบแจ้งผู้จองและคนขับแล้ว กรุณาตรวจเวลารับล่าสุดและพิมพ์เอกสารใหม่</p> : <>
      <p className="text-sm">โรงพยาบาลเดิม: {booking.route_label} · คงวันเวลานัดเดิม ระบบคำนวณเวลารับและตรวจรถว่างใหม่ ถ้าชนคิวอื่นจะไม่เปลี่ยนข้อมูล</p>
      <label className="block">โรงพยาบาลที่ถูกต้อง<select className={inputClass} value={route} disabled={pending} onChange={e => { setRoute(e.target.value); reset() }}><option value="">เลือกโรงพยาบาล</option>{routes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      {!routes.length && <p role="alert">ยังไม่มีโรงพยาบาลอื่นให้เลือก ให้แอดมินเพิ่มโรงพยาบาลในตั้งค่ารถรับ–ส่งผู้ป่วยก่อน</p>}
      {passengers.length > 1 && <><label className="block">ผู้เดินทางที่เปลี่ยนโรงพยาบาล<select className={inputClass} value={scope} disabled={pending} onChange={e => { setScope(e.target.value); reset() }}><option value="single">เฉพาะ {booking.patient_name}</option><option value="all">ทั้งเที่ยว {passengers.length} คน</option></select></label>
        <p className="text-sm">{scope === 'all' ? `เปลี่ยนทุกคน: ${passengers.map(b => b.patient_name).join(' · ')}` : 'ผู้ร่วมเที่ยวคนอื่นยังไปโรงพยาบาลเดิม ระบบจะแยกเที่ยวและตรวจเวลารถไม่ให้ทับกัน'}</p></>}
      {stale && <p role="alert">คิวเปลี่ยนแล้ว กรุณาปิดฟอร์มและเปิดใหม่จากข้อมูลล่าสุด</p>}
      {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">{error}</p>}
      {review ? <div className="space-y-3 rounded-xl border bg-white p-3"><p>ยืนยันเปลี่ยนเป็น <strong>{selected?.label}</strong> สำหรับ {scope === 'all' ? `ทั้งเที่ยว ${passengers.length} คน` : booking.patient_name} ใช่หรือไม่?</p><p className="text-sm">วันเวลานัด {dateTime(booking.appointment_at)} · เอกสารที่พิมพ์แล้วต้องพิมพ์ใหม่</p><button type="button" className={primaryClass} disabled={busy || pending || stale} onClick={save}>{pending ? 'กำลังตรวจคิว...' : 'ยืนยันเปลี่ยนโรงพยาบาล'}</button></div>
        : <button type="button" className={primaryClass} disabled={!selected || busy || stale} onClick={() => setReview(true)}>ตรวจและเปลี่ยนโรงพยาบาล</button>}
    </>}
    <button type="button" className={buttonClass} disabled={pending} onClick={onBack}>ปิดฟอร์มเปลี่ยนโรงพยาบาล</button>
  </div>
}

function PickupCorrection({ booking, busy, onSave, onBack }) {
  const { tenant } = useTenant()
  const [snapshot] = useState(booking)
  const [pickup, setPickup] = useState(booking.pickup || '')
  const [point, setPoint] = useState({ lat: booking.pickup_lat ?? null, lng: booking.pickup_lng ?? null })
  const [verified, setVerified] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const stale = booking.revision !== snapshot.revision
  const changed = pickup.trim() !== booking.pickup || point.lat !== (booking.pickup_lat ?? null) || point.lng !== (booking.pickup_lng ?? null)
  return <form className="space-y-3 rounded-xl border-2 border-sky-700 p-3" onSubmit={async e => {
    e.preventDefault()
    if (!busy && !stale && changed && verified && pickup.trim() && await onSave(snapshot, pickup.trim(), point.lat, point.lng)) onBack()
  }}>
    <h3 className="font-bold">แก้จุดรับก่อนรถออก</h3>
    <p className="text-sm text-slate-700">แก้เฉพาะผู้เดินทางรายนี้ คิวและเวลารถเดิมไม่เปลี่ยน ระบบจะแจ้งคนขับกับผู้จองและเก็บประวัติไว้</p>
    <label className="block">จุดรับที่ถูกต้อง
      <textarea className={`${inputClass} min-h-20`} required maxLength={500} value={pickup} onChange={e => {
        setPickup(e.target.value)
        // A text correction must never leave the driver navigating to the old pin.
        setPoint({ lat: null, lng: null }); setVerified(false)
      }} />
    </label>
    <p className="text-sm text-slate-700">{point.lat === null ? 'ยังไม่มีหมุดสำหรับจุดรับใหม่นี้ · หากไม่ปักหมุด คนขับต้องโทรถามทาง' : `หมุดที่จะใช้: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} onClick={() => setShowMap(true)}>📍 {point.lat === null ? 'ปักหมุดใหม่' : 'แก้หมุด'}</button>
      {point.lat !== null && <button type="button" className={buttonClass} onClick={() => { setPoint({ lat: null, lng: null }); setVerified(false) }}>เอาหมุดออก</button>}
    </div>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5 shrink-0" checked={verified} onChange={e => setVerified(e.target.checked)} />ตรวจแล้วว่าจุดรับใหม่นี้อยู่ในเขตบริการและแจ้งผู้เดินทางแล้ว</label>
    {stale && <p role="alert" className="text-red-700">คำขอเปลี่ยนแล้ว กรุณาปิดฟอร์มแล้วเปิดใหม่เพื่อตรวจข้อมูลล่าสุด</p>}
    <div className="flex flex-wrap gap-2"><button type="submit" className={primaryClass} disabled={busy || stale || !changed || !verified || !pickup.trim()}>บันทึกจุดรับใหม่</button><button type="button" className={buttonClass} disabled={busy} onClick={onBack}>ปิด</button></div>
    {showMap && <MapPicker initialPos={point.lat === null ? null : point} fallbackPos={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null} autoLocate={false}
      onConfirm={({ lat, lng, address }) => { setPoint({ lat, lng }); if (!pickup.trim()) setPickup(address || ''); setVerified(false); setShowMap(false) }} onClose={() => setShowMap(false)} />}
  </form>
}

function MoreActions({ row, workspace, busy, onConfirm, act, remove, onAmend, onUpdatePickup, onRecordLetter, onPrintLetter, onOdometer, onReschedule, onUpdateSchedule, onReload }) {
  const { booking: b, trip, next, group } = row
  const [amending, setAmending] = useState(false)
  const [correctingPickup, setCorrectingPickup] = useState(false)
  const [changingHospital, setChangingHospital] = useState(false)
  const [scheduling, setScheduling] = useState(null)
  const [openedAt] = useState(() => Date.now())
  const passengers = trip ? workspace.bookings.filter(x => x.trip_id === trip.id && x.status !== 'cancelled') : []
  const tripOpen = trip && !['completed', 'cancelled'].includes(trip.state)
  const canReschedule = trip && ['confirmed', 'outbound'].includes(trip.state) && trip.odometer_end == null && passengers.every(x => x.passenger_step === 0 && !x.return_ready)
  const canMoveIntoTrip = canReschedule && trip.state === 'confirmed' && b.share && b.mobility === 'walk' && new Date(trip.plan?.pickup_at).getTime() > openedAt
  const inService = tripOpen && trip.state !== 'confirmed'
  const releasable = trip && (trip.state === 'confirmed' || (trip.state === 'issue' && trip.state_before_issue === 'confirmed')) && passengers.every(x => x.passenger_step === 0)
  const removable = b.status === 'confirmed' && [0, 2].includes(b.passenger_step) && next.id !== 'cancel'
  const submitted = b.status === 'submitted'
  const canCorrectPickup = b.status === 'confirmed' && trip?.state === 'confirmed' && b.passenger_step === 0
  if (b.status === 'cancelled' || (!submitted && !trip) || trip?.state === 'cancelled') return null
  // ไม่มีงานเพิ่มเติมให้ทำ (เช่น เที่ยวจบแล้วแต่เอกสารยังเป็นงานหลักของแถว) = ไม่แสดงกล่องพับว่าง ๆ
  if (!submitted && !tripOpen && !(trip && next.id !== 'docs') && !removable && !releasable) return null
  return <details className="rounded-xl border border-slate-200 px-3">
    <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-sky-800">จัดการเพิ่มเติม</summary>
    <div className="space-y-3 pb-3">
      {submitted && <>
        {!amending && <button type="button" className={buttonClass} disabled={busy} onClick={() => setAmending(true)}>แก้ข้อมูลหลังโทรประสาน</button>}
        {amending && <AmendBooking booking={b} routes={workspace.settings?.routes || []} busy={busy} onBack={() => setAmending(false)}
          onSave={async (values, reason) => { if (await onAmend(b, values, reason)) setAmending(false) }} />}
        {group.length > 1 && <button type="button" className={buttonClass} disabled={busy} onClick={() => onConfirm(row, { ids: [b.id], separate: true })}>ยืนยันเฉพาะคำขอนี้ (ไม่ไปด้วยกัน)</button>}
        {b.requested_trip_id && <button type="button" className={buttonClass} disabled={busy} onClick={() => onConfirm(row, { ids: [b.id], separate: true })}>ยืนยันเป็นเที่ยวแยก (ไม่ร่วมเที่ยวที่ขอ)</button>}
        <ReasonAction busy={busy} title="ยกเลิกคำขอ" placeholder="เช่น ผู้จองแจ้งยกเลิกทางโทรศัพท์" button="ยกเลิกคำขอ" seenByCitizen onRun={note => act(b, 'cancel', note)} />
      </>}
      {canCorrectPickup && !correctingPickup && <button type="button" className={buttonClass} disabled={busy} onClick={() => setCorrectingPickup(true)}>แก้จุดรับ / หมุด</button>}
      {canCorrectPickup && !changingHospital && <button type="button" className={buttonClass} disabled={busy} onClick={() => setChangingHospital(true)}>เปลี่ยนโรงพยาบาล</button>}
      {canCorrectPickup && changingHospital && <ChangeHospital booking={b} trip={trip} passengers={passengers} workspace={workspace} busy={busy} onReload={onReload} onBack={() => setChangingHospital(false)} />}
      {canCorrectPickup && correctingPickup && <PickupCorrection booking={b} busy={busy} onSave={onUpdatePickup} onBack={() => setCorrectingPickup(false)} />}
      {canReschedule && scheduling !== 'reschedule' && <button type="button" className={buttonClass} disabled={busy} onClick={() => setScheduling('reschedule')}>{trip.state === 'confirmed' ? 'เปลี่ยนวันและเวลาเดินทาง' : 'กดออกรถผิด · เปลี่ยนวันเวลา'}</button>}
      {canMoveIntoTrip && scheduling !== 'move' && <button type="button" className={buttonClass} disabled={busy} onClick={() => setScheduling('move')}>ย้ายไปร่วมเที่ยวที่มีอยู่</button>}
      {inService && scheduling !== 'estimate' && <button type="button" className={buttonClass} disabled={busy} onClick={() => setScheduling('estimate')}>แจ้งรถล่าช้า / เวลารับล่าสุด</button>}
      {scheduling && <button type="button" className={buttonClass} disabled={busy} onClick={() => setScheduling(null)}>ปิดฟอร์ม</button>}
      {canReschedule && scheduling === 'reschedule' && <RescheduleJourney key={`reschedule-${trip.id}`} trip={trip} booking={b} passengers={passengers} settings={workspace.settings} busy={busy} onReschedule={async args => { const out = await onReschedule(args); if (out?.saved) setScheduling(null); return out }} />}
      {canMoveIntoTrip && scheduling === 'move' && <MoveIntoTrip booking={b} trip={trip} passengers={passengers} workspace={workspace} busy={busy} onReload={onReload} />}
      {inService && scheduling === 'estimate' && <ScheduleUpdate key={trip.id} trip={trip} busy={busy} onUpdate={async (...args) => { const saved = await onUpdateSchedule(...args); if (saved) setScheduling(null); return saved }} />}
      {trip && next.id !== 'docs' && <TripFundDocs trip={trip} busy={busy} onRecordLetter={onRecordLetter} onPrintLetter={onPrintLetter} />}
      {trip?.state === 'completed' && next.id !== 'docs' && <OdometerForm trip={trip} trips={workspace.trips} busy={busy} onSave={onOdometer} />}
      {removable && <ReasonAction busy={busy} title="นำรายนี้ออกจากเที่ยว" hint="ใช้เมื่อประสานแล้วว่าไม่เดินทาง ผู้เดินทางคนอื่นในเที่ยวไม่เปลี่ยน · ถ้าเป็นคนสุดท้ายและรถยังไม่ออก ระบบคืนช่วงเวลารถให้ด้วย" placeholder="เช่น ผู้ป่วยแจ้งเลื่อนนัด" button="นำออกจากเที่ยว" seenByCitizen onRun={remove} />}
      {releasable && <ReasonAction busy={busy} title="คืนคิวทั้งเที่ยว" hint="ผู้เดินทางทุกคนในเที่ยวนี้กลับไปเป็น “รอยืนยันรถ” เพื่อจัดรถใหม่" placeholder="เช่น รถเสีย ต้องจัดรถใหม่" button="คืนคิวทั้งเที่ยว" onRun={note => act(trip, 'release', note)} />}
    </div>
  </details>
}

function BookingSheet({ row, rows, workspace, problem, busy, error, isAdmin, currentUserId, onOpenDriver, onClose, onReload, onConfirm, onJoin, onOpen, onAction, onRemove, onAmend, onUpdatePickup, onRecordLetter, onPrintLetter, onOdometer, onReschedule, onUpdateSchedule, onSettings }) {
  const { booking: b, trip, linked, stage, next, group } = row
  const passengers = trip ? workspace.bookings.filter(x => x.trip_id === trip.id && x.status !== 'cancelled') : []
  const others = (trip ? passengers : group).filter(x => x.id !== b.id)
  const issue = b.status === 'confirmed' && trip?.state === 'issue'
  // ขอยกเลิกในเที่ยวที่มีคนเดียวและรถยังไม่ออก = คืนคิวทั้งเที่ยว ช่วงเวลารถจะว่างให้คนอื่นทันที
  const soloRelease = trip && passengers.length === 1 && (trip.state === 'confirmed' || (trip.state === 'issue' && trip.state_before_issue === 'confirmed')) && b.passenger_step === 0
  const removable = b.status === 'confirmed' && [0, 2].includes(b.passenger_step)
  const act = (entity, name, note) => onAction(entity, name, note).then(ok => { if (ok) onClose(); return ok })
  const remove = note => onRemove(b, trip, note).then(ok => { if (ok) onClose(); return ok })
  const showProblem = problem && b.status === 'submitted'
  // เงื่อนไขเดียวกับปุ่ม "พร้อมให้มารับกลับ" ฝั่งประชาชน (BookingOperations) และที่ฐานข้อมูลตรวจ
  const readyReturn = b.status === 'confirmed' && ['outbound', 'hospital'].includes(trip?.state) && b.return_mode !== 'one_way' && !b.return_ready
  // พิมพ์หนังสือนำส่ง + ใบคำขอของทั้งเที่ยว (ชุดเดียวกับปุ่มในกล่อง "เอกสารส่งกองทุน") — มีเฉพาะคำขอที่ยืนยันรถแล้ว
  // ยังไม่ยืนยัน = ยังไม่มีเที่ยว ไม่มีหนังสือให้พิมพ์ · คำขอ/เที่ยวที่ยกเลิกแล้วไม่ต้องส่งเอกสารถึงกองทุน
  const printable = trip && b.status !== 'cancelled' && trip.state !== 'cancelled'
  return <Sheet wide title={b.patient_name} subtitle={`${issue ? 'เหตุขัดข้อง' : STAGES[stage].label} · เลขที่ ${ref(b.id)}`} onClose={onClose} onReload={onReload} busy={busy}
    onPrint={printable ? () => onPrintLetter(trip) : undefined} printLabel="พิมพ์หนังสือนำส่ง">
    {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</div>}
    {linked && <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <p className="font-bold text-sky-950">คิวที่ใช้เดินทาง: {dateTime(linked.appointment_at)} · เลขที่ {ref(linked.id)}</p>
      <p className="text-sm text-slate-700">คำขอนี้ปิดเป็นคิวซ้ำ · นัดเดิม {dateTime(b.appointment_at)}</p>
      <button type="button" className={buttonClass} onClick={() => onOpen(linked.id)}>เปิดคิวที่ยืนยันแล้ว</button>
    </div>}
    {showProblem && <ProblemBox key={JSON.stringify(problem.plan.errors)} row={row} problem={problem} rows={rows} workspace={workspace} busy={busy} isAdmin={isAdmin}
      onConfirm={onConfirm} onJoin={onJoin} onOpen={onOpen} act={act} onReload={onReload} onSettings={onSettings} />}
    {/* งานที่ต้องทำของแถวขึ้นก่อนรายละเอียด — แผ่นเปิดเพราะกดปุ่มนั้นมา จอมือถือจะได้ไม่ต้องเลื่อนหา */}
    {next.id === 'confirm' && !showProblem && <button type="button" className="min-h-12 w-full rounded-xl px-4 text-base font-bold text-white disabled:opacity-50" style={{ backgroundColor: next.color }} disabled={busy} onClick={() => onConfirm(row)}>{actionLabel(row)}</button>}
    {b.status === 'confirmed' && trip?.state === 'confirmed' && <section aria-label="ขั้นตอนหลังยืนยันรถ" className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
      <p className="font-bold text-sky-950">ยืนยันรถแล้ว · ขั้นต่อไป</p>
      <p className="text-sm text-slate-800">ผู้จองและคนขับเห็นเที่ยวในระบบแล้ว พิมพ์หนังสือนำส่งกับใบคำขอได้ตอนนี้ วันเดินทางคนขับเปิด “งานคนขับ” เพื่อบันทึกการรับ–ส่งและจบเที่ยว</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} disabled={busy} onClick={() => onPrintLetter(trip)}>พิมพ์หนังสือนำส่ง + ใบคำขอ</button>
        {trip.driver_id === currentUserId && <button type="button" className={buttonClass} onClick={onOpenDriver}>ไปงานคนขับ</button>}
      </div>
      {trip.driver_id !== currentUserId && <p className="text-sm text-slate-700">ถ้าคนขับใช้อีกบัญชี ให้เข้าหน้าเจ้าหน้าที่ด้วยบัญชีคนขับ แล้วเปิดแท็บ “งานคนขับ”</p>}
    </section>}
    {next.id === 'cancel' && (soloRelease
      ? <ReasonAction busy={busy} primary title="ผู้จองขอยกเลิก" hint="เที่ยวนี้มีผู้เดินทางคนเดียว ยกเลิกแล้วช่วงเวลารถว่างให้คนอื่นจองได้ทันที" defaultReason="ผู้จองขอยกเลิก" button="ยกเลิกให้ตามที่ขอ" onRun={note => act(trip, 'release', note)} />
      : removable
        ? <ReasonAction busy={busy} primary title="ผู้จองขอยกเลิก" hint="นำผู้เดินทางรายนี้ออกจากเที่ยว ผู้เดินทางคนอื่นไม่เปลี่ยน" defaultReason="ผู้จองขอยกเลิก" seenByCitizen button="ยกเลิกให้ตามที่ขอ" onRun={remove} />
        : <p className="rounded-xl bg-amber-50 p-3">ผู้เดินทางอยู่บนรถ ยกเลิกระหว่างทางไม่ได้ ให้โทรประสานคนขับ</p>)}
    {next.id === 'issue' && <>
      <p className="rounded-xl bg-red-50 p-3"><strong>เหตุที่แจ้ง:</strong> {trip.issue_note || '—'}</p>
      {/* คนขับกดส่งถึงได้เฉพาะเมื่อส่งครบทุกคน — ผู้ป่วยที่ไม่ได้ขึ้นรถต้องถูกนำออกจากเที่ยวก่อน */}
      {passengers.length > 0 && <p className="text-sm text-slate-700">ถ้ามีผู้ป่วยไม่ได้ขึ้นรถ: เปิด “จัดการเพิ่มเติม” ของรายนั้น นำออกจากเที่ยวก่อน แล้วค่อยกด “แก้ไขแล้ว เดินรถต่อ”</p>}
      <ReasonAction busy={busy} primary title="ประสานแก้ไขแล้ว" defaultReason="ประสานแก้ไขแล้ว เดินรถต่อได้" button="แก้ไขแล้ว เดินรถต่อ" onRun={note => act(trip, 'resolve', note)} />
    </>}
    {next.id === 'docs' && <>
      <TripFundDocs trip={trip} busy={busy} onRecordLetter={onRecordLetter} onPrintLetter={onPrintLetter} />
      <OdometerForm trip={trip} trips={workspace.trips} busy={busy} onSave={onOdometer} />
    </>}
    {/* ผู้จองโทรมาแจ้งว่าพร้อมกลับ — คำขอที่รับจองทางโทรศัพท์ผู้จองไม่มีบัญชีให้กดเอง ใครรับสายก็กดแทนได้
        (ฐานข้อมูลให้สิทธิ์ผู้ประสานงานอยู่แล้ว) ระบบแจ้งคนขับให้และบันทึกว่าใครกด */}
    {readyReturn && <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-sm text-slate-600">ผู้จองโทรมาแจ้งว่าตรวจเสร็จแล้ว · ระบบแจ้งคนขับให้</p>
      <button type="button" className={primaryClass} disabled={busy} onClick={() => act(b, 'ready_return')}>แจ้งพร้อมให้มารับกลับแทนผู้จอง</button>
    </div>}
    <Facts booking={b} trip={trip} others={others} historical={!!linked} />
    <MoreActions row={row} workspace={workspace} busy={busy} onConfirm={onConfirm} act={act} remove={remove} onAmend={onAmend} onUpdatePickup={onUpdatePickup}
      onRecordLetter={onRecordLetter} onPrintLetter={onPrintLetter} onOdometer={onOdometer} onReschedule={onReschedule} onUpdateSchedule={onUpdateSchedule} onReload={onReload} />
  </Sheet>
}

export default function BookingInbox({ workspace, busy, error, isAdmin, action, created, detailOnly = false, initialOpenId = null, currentUserId, onOpenDriver, onCloseBooking, onClearCreated, onDelete, onConfirm, onJoin, onAction, onRemove, onAmend, onUpdatePickup, onRecordLetter, onPrintLetter, onOdometer, onReschedule, onUpdateSchedule, onReload, onSettings }) {
  const [deleting, setDeleting] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteAttempted, setDeleteAttempted] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(initialOpenId)
  const [problem, setProblem] = useState(null)
  const rows = buildRows(workspace)
  const words = search.trim().toLowerCase()
  const shown = rows.filter(r => (filter === 'all' || r.stage === filter) && (!words || haystack(r).includes(words)))
  const count = id => id === 'all' ? rows.length : rows.filter(r => r.stage === id).length
  const open = rows.find(r => r.booking.id === openId)
  const createdRow = created && rows.find(r => r.booking.id === created.id)

  function approveVehicle(bookings, extra = '') {
    const details = bookings.map(b => `• ${b.patient_name} · นัด ${dateTime(b.appointment_at)}`).join('\n')
    return window.confirm(`ยืนยันรถให้ ${bookings.length} คนหรือไม่?\n\n${details}${extra ? `\n${extra}` : ''}\n\nตรวจข้อมูลแล้วกด “ตกลง” เพื่อบันทึกคิวรถ หรือกด “ยกเลิก” เพื่อกลับไปแก้ไข`)
  }
  // กดยืนยันจากแถวหรือจากแผ่น: ทวนก่อนทุกครั้ง · ติดปัญหา = เปิดแผ่นของแถวนั้นพร้อมปุ่มแก้
  // ไม่สำเร็จเพราะเครือข่าย/ข้อมูลเปลี่ยน = เปิดแผ่นให้เห็นข้อความผิดพลาดตรงหน้า (ไม่ต้องเลื่อนขึ้นไปหา)
  async function confirmRow(row, options = {}) {
    const ids = options.ids || (row.booking.requested_trip_id ? [row.booking.id] : row.group.map(b => b.id))
    const bookings = workspace.bookings.filter(b => ids.includes(b.id)).map(b => options.amend?.booking?.id === b.id
      ? { ...b, appointment_at: options.amend.values.appointment_at || b.appointment_at } : b)
    if (!approveVehicle(bookings.length ? bookings : [row.booking], options.separate ? 'จัดเป็นเที่ยวแยก' : '')) return
    const out = await onConfirm(ids, options)
    if (out?.confirmed) {
      close()
      if (created && out.ids.includes(created.id)) onClearCreated()
      return
    }
    if (out?.plan) setProblem({ bookingId: row.booking.id, ids: out.ids, plan: out.plan, joins: out.joins || [], helper: options.helper || '' })
    setOpenId(row.booking.id)
  }
  // ชนคิว → ไปคันเดียวกับเที่ยวที่ยืนยันแล้ว สำเร็จแล้วปิดแผ่น ไม่สำเร็จคงแผ่นไว้ให้เห็นข้อความผิดพลาด
  async function joinRow(row, option) {
    const incoming = rows.filter(x => option.ids?.includes(x.booking.id)).map(x => x.booking)
    const bookings = incoming.length ? incoming : [row.booking]
    const extra = option.plan.multiwave ? 'จัดรถรับหลายรอบในเที่ยวเดียวกัน' : `ร่วมเที่ยวเดิม · เริ่มรับประมาณ ${clockOf(option.plan.pickup_at)} น.`
    if (!approveVehicle(bookings, extra)) return
    if (await onJoin(bookings, option.trip, option.plan)) close()
  }
  function press(row) {
    if (row.next.id === 'confirm') return confirmRow(row)
    setProblem(null); setOpenId(row.booking.id)
  }
  const close = () => { setOpenId(null); setProblem(null); onCloseBooking?.() }

  const deleteBlocked = deleting?.trip && !['confirmed', 'completed', 'cancelled'].includes(deleting.trip.state)
  function deleteButton(row) {
    return isAdmin && <button type="button" className="min-h-11 rounded-xl border border-red-300 px-4 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={busy}
      onClick={e => { e.stopPropagation(); setOpenId(null); setDeleting(row); setDeleteReason(''); setDeleteAttempted(false) }}>ลบ</button>
  }
  async function submitDelete(e) {
    e.preventDefault()
    if (busy || deleteBlocked || !deleteReason.trim()) return
    setDeleteAttempted(true)
    if (await onDelete(deleting, deleteReason)) {
      if (created?.id === deleting.booking.id) onClearCreated()
      setDeleting(null)
    }
  }
  const pills = <Pills value={filter} onChange={setFilter} label="กรองคำขอรถ" items={PILLS.map(([id, label, color]) => ({ id, label, color, count: count(id) }))} />
  const sheet = open && <BookingSheet key={open.booking.id} row={open} rows={rows} workspace={workspace} problem={problem?.bookingId === open.booking.id ? problem : null}
    busy={busy} error={error} isAdmin={isAdmin} currentUserId={currentUserId} onOpenDriver={onOpenDriver} onClose={close} onReload={onReload} onConfirm={confirmRow} onJoin={joinRow}
    onOpen={id => { setProblem(null); setOpenId(id) }} onAction={onAction} onRemove={onRemove} onAmend={onAmend} onUpdatePickup={onUpdatePickup} onRecordLetter={onRecordLetter}
    onPrintLetter={onPrintLetter} onOdometer={onOdometer} onReschedule={onReschedule} onUpdateSchedule={onUpdateSchedule} onSettings={() => { close(); onSettings() }} />
  if (detailOnly) return sheet
  return <ListCard title="คำขอรถ" count={rows.length} search={search} onSearch={setSearch} searchLabel="ค้นหาชื่อ เบอร์ จุดรับ โรงพยาบาล เลขที่" action={action} pills={pills}>
    <div className="space-y-4 p-4 sm:p-5">
      {created && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
        <p className="min-w-0 flex-1"><strong>รับคำขอแทนแล้ว</strong> · {created.name} · เลขที่ {ref(created.id)}</p>
        {createdRow?.next.id === 'confirm' && <button type="button" className="min-h-11 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: createdRow.next.color }} disabled={busy} onClick={() => confirmRow(createdRow)}>ยืนยันรถเลย</button>}
        <button type="button" className={buttonClass} onClick={onClearCreated}>ปิด</button>
      </div>}
      {!rows.length && <p className="py-10 text-center text-sm font-semibold text-gray-400">ยังไม่มีคำขอรถ · คำขอจากประชาชนและที่รับแทนจะขึ้นที่นี่</p>}
      {rows.length > 0 && !shown.length && <p className="py-10 text-center text-sm font-semibold text-gray-400">{words ? 'ไม่พบคำขอที่ค้นหา' : 'ไม่มีคำขอในกลุ่มนี้ · กดป้าย “ทั้งหมด” เพื่อดูทุกคำขอ'}</p>}
      {shown.length > 0 && <div className="hidden overflow-x-auto border border-gray-300 shadow-sm md:block" style={{ borderRadius: 4 }}>
        {/* โรงพยาบาลกับจุดรับอยู่ช่องเดียวกัน (2 บรรทัด) ให้ตารางพอดีพื้นที่ — แยกคอลัมน์แล้วตารางล้น
            คอลัมน์ "ดำเนินการ" ที่ปักขวาจะทับป้ายสถานะจนอ่านไม่ออก */}
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead><tr style={{ backgroundColor: '#1a3a5c' }}>
            <th className="w-10 whitespace-nowrap border-r border-white/10 px-2 py-2.5 text-center text-[11px] font-bold text-white">ที่</th>
            <th className="whitespace-nowrap border-r border-white/10 px-2 py-2.5 text-center text-[11px] font-bold text-white">วันเวลานัด</th>
            <th className="whitespace-nowrap border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">ผู้เดินทาง</th>
            <th className="whitespace-nowrap border-r border-white/10 px-2 py-2.5 text-left text-[11px] font-bold text-white">โรงพยาบาล / จุดรับ</th>
            <th className="whitespace-nowrap border-r border-white/10 px-2 py-2.5 text-center text-[11px] font-bold text-white">สถานะ</th>
            <th className="sticky right-0 z-10 min-w-[170px] whitespace-nowrap px-2 py-2.5 text-center text-[11px] font-bold text-white shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.15)]" style={{ background: 'inherit' }}>ดำเนินการ</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-200">{shown.map((row, index) => {
            const { booking: b, trip, linked, group } = row
            const pickupAt = trip && pickupForBooking(trip, b)
            const shade = index % 2 === 0 ? '#fff' : '#f5f8fc'
            return <tr key={b.id} data-booking={b.id} className="cursor-pointer align-top transition-colors" style={{ backgroundColor: shade }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'} onMouseLeave={e => e.currentTarget.style.backgroundColor = shade}
              onClick={() => { setProblem(null); setOpenId(b.id) }}>
              <td className="border-r border-gray-200 px-2 py-2.5 text-center text-xs text-gray-500">{index + 1}</td>
              <td className="whitespace-nowrap border-r border-gray-200 px-2 py-2.5 text-center"><span className="block font-semibold">{whenLabel((linked || b).appointment_at)}</span><span className="block">{clockOf((linked || b).appointment_at)} น.</span>{linked && <span className="block text-[11px] text-sky-800">คิวจริง {ref(linked.id)}</span>}{linked && <span className="block text-[11px] text-gray-500">เดิม {dateTime(b.appointment_at)}</span>}{pickupAt && b.status !== 'cancelled' && <span className="block text-[11px] text-gray-500">รถมารับ {clockOf(pickupAt)}</span>}</td>
              <td className="border-r border-gray-200 px-2 py-2.5"><span className="font-semibold">{b.patient_name}</span><span className="block text-[11px] text-gray-500">{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน</span>{b.status === 'submitted' && group.length > 1 && <span className="block text-[11px] font-semibold text-sky-800">ไปด้วยกันกับ {group.filter(x => x.id !== b.id).map(x => x.patient_name).join(', ')}</span>}</td>
              <td className="border-r border-gray-200 px-2 py-2.5"><span className="block max-w-[260px] truncate" title={b.route_label}>{b.route_label}</span><span className="block max-w-[260px] truncate text-[11px] text-gray-500" title={b.pickup}>รับที่ {b.pickup}</span><span className="block text-[11px] text-gray-500">{RETURN_MODES[b.return_mode]}{Number.isFinite(b.pickup_lat) && <span className="text-emerald-700"> · 📍 มีหมุด</span>}</span></td>
              <td className="border-r border-gray-200 px-2 py-2.5 text-center"><StatusChips row={row} /></td>
              <td className="sticky right-0 z-10 px-2 py-2.5 text-center shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.15)]" style={{ background: 'inherit' }}><div className="flex flex-wrap justify-center gap-2"><RowButton row={row} busy={busy} onPress={press} />{deleteButton(row)}</div></td>
            </tr>
          })}</tbody>
        </table>
      </div>}
      <div className="space-y-3 md:hidden">{shown.map(row => {
        const { booking: b, trip, linked, group } = row
        const pickupAt = trip && pickupForBooking(trip, b)
        return <article key={b.id} data-booking={b.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" onClick={() => { setProblem(null); setOpenId(b.id) }}>
          <div className="flex items-start justify-between gap-2"><h3 className="font-bold">{b.patient_name}</h3><StatusChips row={row} /></div>
          <p><strong>{whenLabel((linked || b).appointment_at)} {clockOf((linked || b).appointment_at)} น.</strong> · {linked ? linked.route_label : b.route_label}</p>
          {linked && <p className="text-sm text-sky-800">คิวที่ใช้เดินทาง {ref(linked.id)} · นัดเดิมที่ยกเลิก {dateTime(b.appointment_at)}</p>}
          <p className="text-sm text-slate-600">จุดรับ: {b.pickup}{Number.isFinite(b.pickup_lat) ? ' · 📍 มีหมุด' : ''}</p>
          <p className="text-sm text-slate-600">{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน{pickupAt && b.status !== 'cancelled' ? ` · รถมารับ ${clockOf(pickupAt)} น.` : ''}</p>
          {b.status === 'submitted' && group.length > 1 && <p className="text-sm font-semibold text-sky-800">ไปด้วยกันกับ {group.filter(x => x.id !== b.id).map(x => x.patient_name).join(', ')}</p>}
          <div className="flex flex-wrap gap-2"><RowButton row={row} busy={busy} onPress={press} full />{deleteButton(row)}</div>
        </article>
      })}</div>
    </div>
    {deleting && <Sheet title="ลบคำขอรถ" onClose={() => { if (!busy) setDeleting(null) }}>
      <form onSubmit={submitDelete} className="space-y-4">
        <p><strong>{deleting.booking.patient_name}</strong> · เลขที่ {ref(deleting.booking.id)}</p>
        <p className="text-sm text-red-800">ลบคำขอนี้ถาวร กู้คืนจากหน้านี้ไม่ได้ รายการจะหายจากเอกสารและรายงานที่สร้างใหม่ แต่ยังเก็บประวัติผู้ลบ เวลา และเหตุผลไว้ตรวจสอบ เอกสารที่พิมพ์ไปแล้วไม่เปลี่ยนตาม</p>
        <p className="text-sm">ถ้าเป็นเที่ยวร่วม ระบบจะคงผู้เดินทางคนอื่นไว้ หากไม่เหลือผู้เดินทางจะคืนคิวรถให้เอง</p>
        {deleteBlocked && <p role="alert" className="text-red-700">เที่ยวรถอยู่ระหว่างรับ–ส่งหรือมีปัญหา ให้จบเที่ยวหรือประสานคืนคิวก่อนลบ</p>}
        <label className="block">เหตุผลการลบ<textarea autoFocus required maxLength={500} value={deleteReason} onChange={e => setDeleteReason(e.target.value)} disabled={busy} className="mt-1 block min-h-24 w-full rounded-xl border p-3" /></label>
        <p className="text-xs text-slate-500">ระบุเฉพาะเหตุผล ไม่ต้องใส่ข้อมูลสุขภาพหรือข้อมูลส่วนตัว</p>
        {deleteAttempted && error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={() => setDeleting(null)}>เก็บคำขอไว้</button>
          <button type="submit" disabled={busy || deleteBlocked || !deleteReason.trim()} className="min-h-11 rounded-xl bg-red-700 px-4 font-bold text-white disabled:opacity-50">{busy ? 'กำลังลบ…' : 'ยืนยันลบถาวร'}</button></div>
      </form>
    </Sheet>}
    {sheet}
  </ListCard>
}
