import { useState } from 'react'
import { ListCard, Pills, Sheet } from './StaffShell'
import { AmendBooking, TripFundDocs, OdometerForm } from './BookingOperations'
import { ScheduleUpdate } from './BookingDaySchedule'
import { STAGES, TRIP_STATUS, RETURN_MODES, MOBILITY, bookingStage, staffNextAction, bookingPlanGuidance, joinRefusal, suggestGroups, dateTime, clockOf, whenLabel, inputClass, buttonClass, primaryClass } from '../../lib/patientBooking'

/**
 * กล่อง "คำขอรถ" ของเจ้าหน้าที่ — 1 แถว = 1 คำขอ และมีปุ่มเดียวต่อแถวที่บอกงานถัดไป
 *
 * เจ้าของระบบสั่ง 2569-09-21 ให้ทำแบบกล่องงาน "คำร้อง/คำขอบริการ" หลังทดลองของจริงแล้วงงทุกฝั่ง
 * ของเดิมแยก 3 แท็บ (ตารางออกรถ · คิวรอจัดแผน · เที่ยวเดินรถ) ยืนยัน 1 คำขอต้องกด 3–4 ครั้ง
 * พร้อมอ่านผลตรวจแผนเอง และเมื่อชนคิวก็ไม่มีปุ่มให้ไปต่อ
 *
 * ตอนนี้ "ยืนยันรถ" คลิกเดียว = ระบบตรวจคิวแล้วยืนยันต่อทันที (patient_booking_preview → confirm)
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
    return { booking, trip, stage: bookingStage(booking, trip), next: staffNextAction(booking, trip), group: groupOf.get(booking.id) || [booking] }
  })
  // งานที่ต้องทำขึ้นก่อน (เหตุขัดข้อง → ขอยกเลิก → รอยืนยันรถ → เอกสาร) แล้วคำขอที่ยังเดินอยู่ตามวันนัด
  // ส่วนที่จบแล้วเรียงล่าสุดขึ้นก่อน
  const live = r => ['submitted', 'confirmed', 'running'].includes(r.stage)
  const at = r => String(r.booking.appointment_at || '')
  return rows.sort((x, y) => x.next.rank - y.next.rank || Number(live(y)) - Number(live(x))
    || (live(x) ? at(x).localeCompare(at(y)) : at(y).localeCompare(at(x))))
}

const haystack = ({ booking: b }) => [b.patient_name, b.requester_name, b.phone, b.pickup, b.route_label, ref(b.id), dateTime(b.appointment_at), whenLabel(b.appointment_at)].join(' ').toLowerCase()

function actionLabel({ next, group, booking }) {
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
function ReasonAction({ title, hint, defaultReason = '', placeholder = '', button, primary, busy, onRun }) {
  const [note, setNote] = useState(defaultReason)
  return <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
    <p className="font-semibold">{title}</p>
    {hint && <p className="text-sm text-slate-600">{hint}</p>}
    <label className="block text-sm">เหตุผล (บันทึกในประวัติ)
      <input className={inputClass} aria-label={`เหตุผล: ${title}`} value={note} maxLength={500} placeholder={placeholder} onChange={e => setNote(e.target.value)} />
    </label>
    <button type="button" className={primary ? primaryClass : buttonClass} disabled={busy || !note.trim()} onClick={() => onRun(note.trim())}>{button}</button>
  </div>
}

function Facts({ booking: b, trip, others }) {
  const pin = Number.isFinite(b.pickup_lat) && Number.isFinite(b.pickup_lng)
  const items = [
    ['วันเวลานัด', dateTime(b.appointment_at)],
    ['โรงพยาบาล', b.route_label],
    ['ขากลับ', b.return_mode === 'one_way' ? 'ขาไปอย่างเดียว' : `${RETURN_MODES[b.return_mode]} · ${b.return_at ? `ประมาณ ${clockOf(b.return_at)} น.` : 'ยังไม่ทราบเวลา'}`],
    ['จุดรับ', <>{b.pickup}{pin && <a className="ml-2 font-semibold text-sky-800 underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${b.pickup_lat},${b.pickup_lng}`}>📍 นำทาง</a>}</>],
    ['การเดินทาง', `${MOBILITY[b.mobility]} · ผู้ติดตาม ${b.companions} คน${b.share ? ' · นั่งร่วมกับผู้ป่วยอื่นได้' : ''}`],
    ['ผู้จอง', b.relation === 'self' ? RELATIONS.self : `${b.requester_name || '—'} (${RELATIONS[b.relation] || 'จองแทน'})`],
    ['เบอร์ติดต่อ', b.phone ? <a className="font-semibold text-sky-800 underline" href={`tel:${b.phone}`}>{b.phone}</a> : '—'],
    ['รับเรื่องทาง', b.entry_channel === 'staff' ? 'เจ้าหน้าที่รับแทน (โทรศัพท์/เคาน์เตอร์)' : 'ออนไลน์'],
    ...(trip ? [
      ['สถานะเที่ยว', TRIP_STATUS[trip.state]],
      ['รถมารับ', `ประมาณ ${clockOf(trip.estimated_pickup_at || trip.plan?.pickup_at)} น.`],
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
      return <div key={option.trip.id} className="space-y-2 rounded-lg border-2 border-emerald-400 bg-white p-3">
        <p className="font-semibold text-emerald-900">ไปคันเดียวกับเที่ยวเดิมได้{riders.length ? ` · นั่งร่วมกับ ${riders.map(x => x.patient_name).join(', ')}` : ''}</p>
        <p className="text-sm">เวลารถออกรับใหม่ <strong>{clockOf(option.plan.pickup_at)} น.</strong> (เดิม {clockOf(option.trip.plan?.pickup_at)} น.) ระบบแจ้งเวลาใหม่ในแอปให้ทุกคน ควรโทรแจ้งผู้เดินทางเดิมด้วย</p>
        {riders.some(x => x.phone) && <div className="flex flex-wrap gap-2">{riders.filter(x => x.phone).map(x => <a key={x.id} className={`${buttonClass} inline-flex items-center`} href={`tel:${x.phone}`}>📞 {x.patient_name}</a>)}</div>}
        <button type="button" className={primaryClass} disabled={busy} onClick={() => onJoin(row, option)}>ให้ไปคันเดียวกัน · รถออกรับ {clockOf(option.plan.pickup_at)} น.</button>
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
      hint="ผู้จองจะเห็นสถานะ “ยกเลิกแล้ว” ในหน้าของตัวเอง ควรโทรแจ้งก่อนกด" defaultReason={cancelReason}
      button={conflict ? 'แจ้งว่ารถไม่ว่าง และยกเลิกคำขอ' : 'ยกเลิกคำขอ'} onRun={note => act(b, 'cancel', note)} />}
  </section>
}

// งานที่ไม่ได้ทำทุกวัน พับไว้ใต้ "จัดการเพิ่มเติม" — งานหลักของแถวอยู่ด้านบนเสมอ
function MoreActions({ row, workspace, busy, onConfirm, act, remove, onAmend, onRecordLetter, onPrintLetter, onOdometer, onUpdateSchedule }) {
  const { booking: b, trip, next, group } = row
  const [amending, setAmending] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const passengers = trip ? workspace.bookings.filter(x => x.trip_id === trip.id && x.status !== 'cancelled') : []
  const tripOpen = trip && !['completed', 'cancelled'].includes(trip.state)
  const releasable = trip && (trip.state === 'confirmed' || (trip.state === 'issue' && trip.state_before_issue === 'confirmed')) && passengers.every(x => x.passenger_step === 0)
  const removable = b.status === 'confirmed' && [0, 2].includes(b.passenger_step) && next.id !== 'cancel'
  const submitted = b.status === 'submitted'
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
        <ReasonAction busy={busy} title="ยกเลิกคำขอ" placeholder="เช่น ผู้จองแจ้งยกเลิกทางโทรศัพท์" button="ยกเลิกคำขอ" onRun={note => act(b, 'cancel', note)} />
      </>}
      {/* เปิดเป็นครั้ง ๆ แบบตารางออกรถเดิม — ฟอร์มจำ revision ตอนเปิดไว้เตือนเมื่อมีคนแก้ทับ
          บันทึกแล้วปิดทันที ไม่งั้นฟอร์มจะเตือน "ข้อมูลเปลี่ยน" จากการบันทึกของตัวเอง */}
      {tripOpen && !scheduling && <button type="button" className={buttonClass} disabled={busy} onClick={() => setScheduling(true)}>แจ้งรถล่าช้า / ปรับเวลาประมาณการ</button>}
      {tripOpen && scheduling && <ScheduleUpdate key={trip.id} trip={trip} busy={busy} onUpdate={async (...args) => { const saved = await onUpdateSchedule(...args); if (saved) setScheduling(false); return saved }} />}
      {trip && next.id !== 'docs' && <TripFundDocs trip={trip} busy={busy} onRecordLetter={onRecordLetter} onPrintLetter={onPrintLetter} />}
      {trip?.state === 'completed' && next.id !== 'docs' && <OdometerForm trip={trip} trips={workspace.trips} busy={busy} onSave={onOdometer} />}
      {removable && <ReasonAction busy={busy} title="นำรายนี้ออกจากเที่ยว" hint="ใช้เมื่อประสานแล้วว่าไม่เดินทาง ผู้เดินทางคนอื่นในเที่ยวไม่เปลี่ยน · ถ้าเป็นคนสุดท้ายและรถยังไม่ออก ระบบคืนช่วงเวลารถให้ด้วย" placeholder="เช่น ผู้ป่วยแจ้งเลื่อนนัด" button="นำออกจากเที่ยว" onRun={remove} />}
      {releasable && <ReasonAction busy={busy} title="คืนคิวทั้งเที่ยว" hint="ผู้เดินทางทุกคนในเที่ยวนี้กลับไปเป็น “รอยืนยันรถ” เพื่อจัดรถใหม่" placeholder="เช่น รถเสีย ต้องจัดรถใหม่" button="คืนคิวทั้งเที่ยว" onRun={note => act(trip, 'release', note)} />}
    </div>
  </details>
}

function BookingSheet({ row, rows, workspace, problem, busy, error, isAdmin, onClose, onReload, onConfirm, onJoin, onOpen, onAction, onRemove, onAmend, onRecordLetter, onPrintLetter, onOdometer, onUpdateSchedule, onSettings }) {
  const { booking: b, trip, stage, next, group } = row
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
  const readyReturn = b.status === 'confirmed' && b.passenger_step === 2 && b.return_mode !== 'one_way' && !b.return_ready
  return <Sheet wide title={b.patient_name} subtitle={`${issue ? 'เหตุขัดข้อง' : STAGES[stage].label} · เลขที่ ${ref(b.id)}`} onClose={onClose} onReload={onReload} busy={busy}>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</div>}
    {showProblem && <ProblemBox key={JSON.stringify(problem.plan.errors)} row={row} problem={problem} rows={rows} workspace={workspace} busy={busy} isAdmin={isAdmin}
      onConfirm={onConfirm} onJoin={onJoin} onOpen={onOpen} act={act} onReload={onReload} onSettings={onSettings} />}
    {/* งานที่ต้องทำของแถวขึ้นก่อนรายละเอียด — แผ่นเปิดเพราะกดปุ่มนั้นมา จอมือถือจะได้ไม่ต้องเลื่อนหา */}
    {next.id === 'confirm' && !showProblem && <button type="button" className="min-h-12 w-full rounded-xl px-4 text-base font-bold text-white disabled:opacity-50" style={{ backgroundColor: next.color }} disabled={busy} onClick={() => onConfirm(row)}>{actionLabel(row)}</button>}
    {next.id === 'cancel' && (soloRelease
      ? <ReasonAction busy={busy} primary title="ผู้จองขอยกเลิก" hint="เที่ยวนี้มีผู้เดินทางคนเดียว ยกเลิกแล้วช่วงเวลารถว่างให้คนอื่นจองได้ทันที" defaultReason="ผู้จองขอยกเลิก" button="ยกเลิกให้ตามที่ขอ" onRun={note => act(trip, 'release', note)} />
      : removable
        ? <ReasonAction busy={busy} primary title="ผู้จองขอยกเลิก" hint="นำผู้เดินทางรายนี้ออกจากเที่ยว ผู้เดินทางคนอื่นไม่เปลี่ยน" defaultReason="ผู้จองขอยกเลิก" button="ยกเลิกให้ตามที่ขอ" onRun={remove} />
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
    <Facts booking={b} trip={trip} others={others} />
    <MoreActions row={row} workspace={workspace} busy={busy} onConfirm={onConfirm} act={act} remove={remove} onAmend={onAmend}
      onRecordLetter={onRecordLetter} onPrintLetter={onPrintLetter} onOdometer={onOdometer} onUpdateSchedule={onUpdateSchedule} />
  </Sheet>
}

export default function BookingInbox({ workspace, busy, error, isAdmin, action, created, onClearCreated, onConfirm, onJoin, onAction, onRemove, onAmend, onRecordLetter, onPrintLetter, onOdometer, onUpdateSchedule, onReload, onSettings }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)
  const [problem, setProblem] = useState(null)
  const rows = buildRows(workspace)
  const words = search.trim().toLowerCase()
  const shown = rows.filter(r => (filter === 'all' || r.stage === filter) && (!words || haystack(r).includes(words)))
  const count = id => id === 'all' ? rows.length : rows.filter(r => r.stage === id).length
  const open = rows.find(r => r.booking.id === openId)
  const createdRow = created && rows.find(r => r.booking.id === created.id)

  // กดยืนยันจากแถวหรือจากแผ่น: ผ่าน = จบในคลิกเดียว · ติดปัญหา = เปิดแผ่นของแถวนั้นพร้อมปุ่มแก้
  // ไม่สำเร็จเพราะเครือข่าย/ข้อมูลเปลี่ยน = เปิดแผ่นให้เห็นข้อความผิดพลาดตรงหน้า (ไม่ต้องเลื่อนขึ้นไปหา)
  async function confirmRow(row, options = {}) {
    const ids = options.ids || (row.booking.requested_trip_id ? [row.booking.id] : row.group.map(b => b.id))
    const out = await onConfirm(ids, options)
    if (out?.confirmed) {
      setProblem(null); setOpenId(null)
      if (created && out.ids.includes(created.id)) onClearCreated()
      return
    }
    if (out?.plan) setProblem({ bookingId: row.booking.id, ids: out.ids, plan: out.plan, joins: out.joins || [], helper: options.helper || '' })
    setOpenId(row.booking.id)
  }
  // ชนคิว → ไปคันเดียวกับเที่ยวที่ยืนยันแล้ว สำเร็จแล้วปิดแผ่น ไม่สำเร็จคงแผ่นไว้ให้เห็นข้อความผิดพลาด
  async function joinRow(row, option) {
    if (await onJoin(row.booking, option.trip, option.plan)) { setProblem(null); setOpenId(null) }
  }
  function press(row) {
    if (row.next.id === 'confirm') return confirmRow(row)
    setProblem(null); setOpenId(row.booking.id)
  }
  const close = () => { setOpenId(null); setProblem(null) }

  const pills = <Pills value={filter} onChange={setFilter} label="กรองคำขอรถ" items={PILLS.map(([id, label, color]) => ({ id, label, color, count: count(id) }))} />
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
            const { booking: b, trip, group } = row
            const pickupAt = trip?.estimated_pickup_at || trip?.plan?.pickup_at
            const shade = index % 2 === 0 ? '#fff' : '#f5f8fc'
            return <tr key={b.id} data-booking={b.id} className="cursor-pointer align-top transition-colors" style={{ backgroundColor: shade }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'} onMouseLeave={e => e.currentTarget.style.backgroundColor = shade}
              onClick={() => { setProblem(null); setOpenId(b.id) }}>
              <td className="border-r border-gray-200 px-2 py-2.5 text-center text-xs text-gray-500">{index + 1}</td>
              <td className="whitespace-nowrap border-r border-gray-200 px-2 py-2.5 text-center"><span className="block font-semibold">{whenLabel(b.appointment_at)}</span><span className="block">{clockOf(b.appointment_at)} น.</span>{pickupAt && b.status !== 'cancelled' && <span className="block text-[11px] text-gray-500">รถมารับ {clockOf(pickupAt)}</span>}</td>
              <td className="border-r border-gray-200 px-2 py-2.5"><span className="font-semibold">{b.patient_name}</span><span className="block text-[11px] text-gray-500">{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน</span>{b.status === 'submitted' && group.length > 1 && <span className="block text-[11px] font-semibold text-sky-800">ไปด้วยกันกับ {group.filter(x => x.id !== b.id).map(x => x.patient_name).join(', ')}</span>}</td>
              <td className="border-r border-gray-200 px-2 py-2.5"><span className="block max-w-[260px] truncate" title={b.route_label}>{b.route_label}</span><span className="block max-w-[260px] truncate text-[11px] text-gray-500" title={b.pickup}>รับที่ {b.pickup}</span><span className="block text-[11px] text-gray-500">{RETURN_MODES[b.return_mode]}{Number.isFinite(b.pickup_lat) && <span className="text-emerald-700"> · 📍 มีหมุด</span>}</span></td>
              <td className="border-r border-gray-200 px-2 py-2.5 text-center"><StatusChips row={row} /></td>
              <td className="sticky right-0 z-10 px-2 py-2.5 text-center shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.15)]" style={{ background: 'inherit' }}><RowButton row={row} busy={busy} onPress={press} /></td>
            </tr>
          })}</tbody>
        </table>
      </div>}
      <div className="space-y-3 md:hidden">{shown.map(row => {
        const { booking: b, trip, group } = row
        const pickupAt = trip?.estimated_pickup_at || trip?.plan?.pickup_at
        return <article key={b.id} data-booking={b.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" onClick={() => { setProblem(null); setOpenId(b.id) }}>
          <div className="flex items-start justify-between gap-2"><h3 className="font-bold">{b.patient_name}</h3><StatusChips row={row} /></div>
          <p><strong>{whenLabel(b.appointment_at)} {clockOf(b.appointment_at)} น.</strong> · {b.route_label}</p>
          <p className="text-sm text-slate-600">จุดรับ: {b.pickup}{Number.isFinite(b.pickup_lat) ? ' · 📍 มีหมุด' : ''}</p>
          <p className="text-sm text-slate-600">{MOBILITY[b.mobility]} · ผู้ติดตาม {b.companions} คน{pickupAt && b.status !== 'cancelled' ? ` · รถมารับ ${clockOf(pickupAt)} น.` : ''}</p>
          {b.status === 'submitted' && group.length > 1 && <p className="text-sm font-semibold text-sky-800">ไปด้วยกันกับ {group.filter(x => x.id !== b.id).map(x => x.patient_name).join(', ')}</p>}
          <RowButton row={row} busy={busy} onPress={press} full />
        </article>
      })}</div>
    </div>
    {open && <BookingSheet key={open.booking.id} row={open} rows={rows} workspace={workspace} problem={problem?.bookingId === open.booking.id ? problem : null}
      busy={busy} error={error} isAdmin={isAdmin} onClose={close} onReload={onReload} onConfirm={confirmRow} onJoin={joinRow}
      onOpen={id => { setProblem(null); setOpenId(id) }} onAction={onAction} onRemove={onRemove} onAmend={onAmend} onRecordLetter={onRecordLetter}
      onPrintLetter={onPrintLetter} onOdometer={onOdometer} onUpdateSchedule={onUpdateSchedule} onSettings={() => { close(); onSettings() }} />}
  </ListCard>
}
