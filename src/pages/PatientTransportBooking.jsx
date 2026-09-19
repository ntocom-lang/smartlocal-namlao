import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Home, Hospital, RefreshCw } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import BookingCalendar from '../components/patientTransport/BookingCalendar'
import BookingForm from '../components/patientTransport/BookingForm'
import BookingSettings from '../components/patientTransport/BookingSettings'
import { BookingCards, CoordinatorQueue, DriverTrips } from '../components/patientTransport/BookingOperations'
import { buildTripForwardLetterHtml, buildTripMonthReportHtml } from '../lib/patientTransportPrint'
import { SIGNATORY_REGISTRY_SELECT, SIGNATORY_SCOPE, pickSignatory, signatoryName, signatoryTitle } from '../lib/documentSignatories'
import { buttonClass, primaryClass, clockTime, orgAbbr } from '../lib/patientBooking'

export default function PatientTransportBooking() {
  const { tenant } = useTenant()
  const { session, profileName } = useAuth()
  const uid = session?.user?.id
  const [view, setView] = useState('home')
  const [bookingSeed, setBookingSeed] = useState({})
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const sequence = useRef(0)
  const lock = useRef(false)
  const operations = useRef(new Map())
  const tenantId = tenant?.id
  const reload = useCallback(() => {
    if (!tenantId) return
    const generation = ++sequence.current
    return Promise.all([
        supabase.rpc('patient_booking_info', { p_muni: tenantId }),
        uid ? supabase.rpc('patient_booking_workspace', { p_muni: tenantId }) : Promise.resolve({ data: null }),
      ]).then(([publicResult, privateResult]) => {
      if (generation !== sequence.current) return
      if (publicResult.error || privateResult.error) throw publicResult.error || privateResult.error
      setData({ tenantId, uid, info: publicResult.data, workspace: privateResult.data })
      setError('')
    }).catch(e => {
      if (generation !== sequence.current) return
      setData(null)
      setError(['PGRST202', '42883'].includes(e.code) ? 'ระบบจองรถยังไม่ได้เปิดติดตั้ง กรุณาใช้ช่องทางรับเรื่องเดิมหรือติดต่อเจ้าหน้าที่' : `โหลดข้อมูลไม่สำเร็จ: ${e.message || 'กรุณาลองใหม่'}`)
    })
  }, [tenantId, uid])
  useEffect(() => {
    const requestSequence = sequence
    reload()
    const refresh = () => { if (document.visibilityState === 'visible' && !lock.current) reload() }
    // Visible session only; no new paid realtime service or background polling.
    const timer = uid ? window.setInterval(refresh, 60000) : null
    window.addEventListener('focus', refresh)
    return () => { requestSequence.current++; if (timer) clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [reload, uid])
  const current = data?.tenantId === tenantId && data?.uid === uid ? data : null
  const info = current?.info
  const workspace = current?.workspace
  const isCoordinator = ['admin', 'coordinator'].includes(workspace?.role)
  const isAdmin = workspace?.role === 'admin'
  const isDriver = workspace?.role === 'driver' || workspace?.trips?.some(t => t.driver_id === uid)
  function op(key) { if (!operations.current.has(key)) operations.current.set(key, crypto.randomUUID()); return operations.current.get(key) }
  async function mutate(name, args, success, after) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await supabase.rpc(name, { p_muni: tenantId, ...args })
      if (result.error) throw result.error
      setNotice(success); setPreview(null)
      if (after) after(result.data)
      await reload()
      return true
    } catch (e) { if (e.message?.includes('เปลี่ยนแล้ว')) await reload(); setError(`ยังไม่ยืนยันผลสำเร็จ: ${e.message || 'เครือข่ายขัดข้อง กรุณาลองใหม่ด้วยรายการเดิม'}`); return false }
    finally { lock.current = false; setBusy(false) }
  }
  function action(entity, name, note = '') {
    const args = { p_entity: entity.id, p_revision: entity.revision, p_action: name, p_note: note }
    return mutate('patient_booking_action', { ...args, p_op: op(JSON.stringify(args)) }, 'บันทึกแล้ว และแจ้งสถานะในระบบให้ผู้เกี่ยวข้อง')
  }
  // เอกสารถึงกองทุน: ผู้รับหนังสือจากทะเบียนหน่วยงานรับเรื่องต่อ + ผู้ลงนามจากทะเบียนกลาง
  // (ทะเบียนเดียวกับหนังสือนำส่งของระบบเดิม ผู้ดูแลไม่ต้องตั้งค่าซ้ำ)
  async function fundContext() {
    const partnerId = workspace?.settings?.partner_id
    const [partnerRes, signRes] = await Promise.all([
      partnerId ? supabase.from('referral_partners').select('name, recipient_title, address, phone').eq('id', partnerId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('document_signatories').select(SIGNATORY_REGISTRY_SELECT).eq('municipality_id', tenantId).eq('document_type', SIGNATORY_SCOPE).eq('is_active', true),
    ])
    if (partnerRes.error) throw partnerRes.error
    const mayorRow = pickSignatory(signRes.data ?? [], { role: 'mayor' })
    return { partner: partnerRes.data, mayor: mayorRow ? { name: signatoryName(mayorRow), title: signatoryTitle(mayorRow) } : null }
  }
  // เปิดหน้าต่างทันทีตอนกด แล้วค่อยเติมเนื้อหาหลังโหลดข้อมูล — เปิดหลัง await เบราว์เซอร์จะบล็อกเป็นป๊อปอัป
  async function printInNewWindow(build, failText) {
    const win = window.open('', '_blank', 'width=1100,height=900')
    if (!win) { setError('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาตป๊อปอัปของเว็บนี้'); return }
    try { win.document.write(await build()); win.document.close() } catch (e) { win.close(); setError(`${failText}: ${e.message || 'กรุณาลองใหม่'}`) }
  }
  const printLetter = trip => printInNewWindow(async () => buildTripForwardLetterHtml({
    tenant, trip, bookings: workspace.bookings, ...(await fundContext()),
    // ต้องเป็น URL เต็ม หน้าต่างพิมพ์เป็น about:blank พาธ /images/... จะ resolve ไม่เจอ
    emblemUrl: `${window.location.origin}/images/garuda.svg`,
  }), 'เตรียมหนังสือนำส่งไม่สำเร็จ')
  const printMonth = month => printInNewWindow(async () => {
    const [{ data, error: failure }, context] = await Promise.all([supabase.rpc('patient_booking_month_report', { p_muni: tenantId, p_month: month }), fundContext()])
    if (failure) throw failure
    return buildTripMonthReportHtml({ tenant, report: data, partner: context.partner })
  }, 'เตรียมสรุปรายเดือนไม่สำเร็จ')
  const recordOdometer = (trip, start, end, issue, reason) => mutate('patient_booking_save_odometer', { p_trip: trip.id, p_docs_revision: trip.docs_revision, p_start: start, p_end: end, p_issue: issue, p_note: reason }, 'บันทึกเลขไมล์แล้ว')
  async function inspect(ids, helper) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const { data: plan, error: failure } = await supabase.rpc(workspace.bookings.find(b => b.id === ids[0])?.requested_trip_id ? 'patient_booking_preview_join' : 'patient_booking_preview', workspace.bookings.find(b => b.id === ids[0])?.requested_trip_id ? { p_muni: tenantId, p_booking: ids[0] } : { p_muni: tenantId, p_ids: ids, p_helper: helper })
      if (failure) throw failure
      setPreview(plan)
    } catch (e) { setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="mx-auto min-h-screen max-w-5xl bg-white px-4 py-6 text-slate-900">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link to="/" className={`${buttonClass} inline-flex items-center`}>← หน้าหลัก</Link><button className={`${buttonClass} inline-flex items-center gap-2`} onClick={reload} disabled={busy}><RefreshCw size={16} />โหลดข้อมูลล่าสุด</button></div>
    <header className="mb-5"><p className="text-sm font-semibold text-sky-800">{tenant?.name} · ดูแลใกล้บ้าน</p><h1 className="mt-1 text-2xl font-bold">รถรับส่งผู้ป่วย</h1></header>
    {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
    {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4">{notice}</p>}
    {!current && !error && <p role="status">กำลังโหลดบริการ…</p>}
    {current && <>
      <nav className="mb-5 flex flex-wrap gap-2" aria-label="งานรถรับส่งผู้ป่วย">
        {[['home', 'หน้าบริการ', true], ['calendar', 'ดูตารางรถ', !!info?.enabled], ['mine', 'การจองของฉัน', !!uid], ['queue', 'จัดคิว', isCoordinator], ['driver', 'งานคนขับ', isDriver], ['settings', 'ตั้งค่า', isAdmin]].filter(([, , allowed]) => allowed).map(([key, label]) => <button key={key} className={view === key ? primaryClass : buttonClass} onClick={() => { setView(key); setPreview(null) }} disabled={busy}>{label}</button>)}
      </nav>
      {view === 'home' && <>
        <section className="grid gap-6 rounded-2xl bg-sky-50 p-5 sm:grid-cols-2 sm:p-8"><div><p className="text-sm font-semibold text-sky-800">บริการสำหรับทุกคนในเขตพื้นที่</p><h2 className="my-3 text-3xl font-bold leading-snug">ถึงวันนัด<br />ให้เราช่วยพาไป</h2><p>จองไปโรงพยาบาลใกล้เคียง ญาติหรือผู้ดูแลจองแทนได้ ไม่ต้องใช้เลขสมาชิกกองทุน</p>
          {info?.enabled ? <><p className="mt-3 text-sm">วันราชการ {clockTime(info.office_start)}–{clockTime(info.office_end)} · ตามปฏิทินหน่วยงาน</p><div className="mt-5 flex flex-wrap gap-3">{uid ? <button className={primaryClass} onClick={() => { setBookingSeed({}); setView('book') }}>ขอจองรถรับส่ง</button> : <Link to="/auth" state={{ from: '/patient-transport' }} className={`${primaryClass} inline-flex items-center`}>เข้าสู่ระบบเพื่อจองรถ</Link>}<button className={buttonClass} onClick={() => setView('calendar')}>ดูวันว่าง / ขอร่วมเที่ยว</button><button className={buttonClass} onClick={() => setView('mine')}>ติดตามการจอง</button></div></> : <><p className="mt-3 text-sm">ยื่นคำขอได้ทางนี้ เจ้าหน้าที่ {orgAbbr()} ตรวจคำขอ ประสานรถของกองทุน แล้วแจ้งผลให้ทราบ</p><div className="mt-5 flex flex-wrap gap-3"><Link to="/doc-request?type=patient_transport_request" className={`${primaryClass} inline-flex items-center`}>ยื่นคำขอรถรับ-ส่งผู้ป่วย</Link><Link to="/my-docs" className={`${buttonClass} inline-flex items-center`}>ติดตามคำขอ</Link></div></>}
        </div><div className="space-y-5 rounded-2xl bg-white p-5">{[[Home, 'รับจากจุดที่แจ้ง', 'ระบุบ้านและจุดสังเกต'], [Hospital, 'ไปโรงพยาบาลตามนัด', 'รองรับรถเข็น/เปลตามความพร้อมของรถ'], [CalendarDays, 'มีแผนรับกลับ', 'รอรับกลับ หรือกลับมารับภายหลัง']].map(([Icon, title, detail]) => <div key={title} className="flex gap-3"><Icon className="shrink-0 text-sky-800" size={25} /><div><h3 className="font-bold">{title}</h3><p className="text-sm text-slate-600">{detail}</p></div></div>)}</div></section>
        <p className="mt-4 rounded-xl bg-amber-50 p-4">เจ็บป่วยฉุกเฉิน <a href="tel:1669" className="font-bold underline">โทร 1669</a> อย่ารอคิวจองรถ</p>
      </>}
      {view === 'calendar' && info?.enabled && <BookingCalendar tenantId={tenantId} info={info} uid={uid} onBook={seed => { setBookingSeed(seed); setView('book') }} />}
      {view === 'book' && uid && info?.enabled && <BookingForm tenantId={tenantId} initial={bookingSeed} info={info} profileName={profileName} profilePhone={workspace?.my_profile?.phone} staffEntry={isCoordinator} busy={busy} onBack={() => setView('home')} onSubmit={(id, payload) => mutate(bookingSeed.requested_trip_id ? 'patient_booking_submit_join' : 'patient_booking_submit', { p_id: id, p_data: payload, ...(bookingSeed.requested_trip_id ? { p_trip: bookingSeed.requested_trip_id } : {}) }, 'รับคำขอแล้ว รอเจ้าหน้าที่ยืนยันรถ', () => setView('mine'))} />}
      {view === 'mine' && (uid ? <BookingCards bookings={workspace?.bookings.filter(b => b.created_by === uid) || []} trips={workspace?.trips || []} busy={busy} onAction={action} /> : <Link to="/auth" className={primaryClass}>เข้าสู่ระบบเพื่อติดตามการจอง</Link>)}
      {view === 'queue' && isCoordinator && <><button className={`${buttonClass} mb-4`} disabled={busy || !info?.enabled} onClick={() => { setBookingSeed({}); setView('book') }}>รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์</button>
        <CoordinatorQueue workspace={workspace} busy={busy} preview={preview} clearPreview={() => setPreview(null)} onAction={action} onPreview={inspect}
          onRecordLetter={(trip, letterNo, letterDate) => mutate('patient_booking_record_letter', { p_trip: trip.id, p_docs_revision: trip.docs_revision, p_letter_no: letterNo, p_letter_date: letterDate }, 'บันทึกเลขหนังสือนำส่งแล้ว')}
          onPrintLetter={printLetter} onOdometer={recordOdometer} onMonthReport={printMonth}
          onAmend={(booking, values, reason) => { const args = { p_id: booking.id, p_revision: booking.revision, p_data: values, p_note: reason }; return mutate('patient_booking_amend', { ...args, p_op: op(JSON.stringify(args)) }, 'แก้ข้อมูลตามที่ประสานแล้ว พร้อมเก็บประวัติ') }}
          onConfirm={(ids, plan, helper) => plan.join_trip_id ? mutate('patient_booking_confirm_join', { p_op: op(JSON.stringify(plan)), p_booking: plan.join_booking_id, p_expected: plan }, 'ยืนยันร่วมเที่ยวแล้ว แจ้งแผนล่าสุดให้ผู้เดินทางและคนขับ') : mutate('patient_booking_confirm', { p_id: op(JSON.stringify({ ids, plan, helper })), p_ids: ids, p_expected: plan, p_helper: helper }, 'ยืนยันเที่ยวแล้ว ผู้จองและคนขับเห็นข้อมูลในระบบ')} /></>}
      {view === 'driver' && isDriver && <DriverTrips workspace={workspace} uid={uid} busy={busy} onAction={action} onOdometer={recordOdometer} />}
      {view === 'settings' && isAdmin && <BookingSettings key={workspace.settings?.revision || 'new'} workspace={workspace} busy={busy} onSave={(revision, form) => mutate('patient_booking_save_settings', { p_revision: revision, p_data: { ...form, holidays: form.holidays.map(d => d.trim()).filter(Boolean) } }, 'บันทึกค่าตั้งต้นแล้ว')} />}
      {workspace?.limited && <p className="mt-4 rounded-xl bg-amber-50 p-3">รายการเกินขอบเขตหน้าจอ กรุณาติดต่อผู้ดูแลก่อนจัดคิวเพิ่มเติม</p>}
      {workspace?.notices?.length > 0 && <details className="mt-6 rounded-xl border border-slate-200 p-4"><summary className="min-h-11 cursor-pointer font-semibold">แจ้งเตือนการเดินทาง ({workspace.notices.length})</summary>{workspace.notices.map(n => <p key={n.id} className="border-t border-slate-100 py-3">{n.message}</p>)}</details>}
    </>}
    <footer className="mt-6 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-sm"><Link to="/my-docs" className="inline-flex min-h-11 items-center text-sky-800 underline">ประวัติคำขอที่ยื่นผ่านเอกสารของฉัน</Link>{info?.contact_phone && <a className="inline-flex min-h-11 items-center text-sky-800 underline" href={`tel:${info.contact_phone}`}>ติดต่อเจ้าหน้าที่ {info.contact_phone}</a>}</footer>
  </div>
}
