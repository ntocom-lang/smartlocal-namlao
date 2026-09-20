import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart2, CalendarDays, Car, Inbox, RefreshCw, Route, Settings, Users } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import BookingHelp from '../components/patientTransport/BookingHelp'
import BookingDaySchedule from '../components/patientTransport/BookingDaySchedule'
import BookingForm from '../components/patientTransport/BookingForm'
import BookingSettings from '../components/patientTransport/BookingSettings'
import { TabBar } from '../components/patientTransport/StaffShell'
import { PendingQueue, QueueReport, TripBoard, DriverTrips } from '../components/patientTransport/BookingOperations'
import { buildTripForwardLetterHtml, buildTripMonthReportHtml } from '../lib/patientTransportPrint'
import { SIGNATORY_REGISTRY_SELECT, SIGNATORY_SCOPE, pickSignatory, signatoryName, signatoryTitle } from '../lib/documentSignatories'
import usePatientBooking from '../hooks/usePatientBooking'
import { buttonClass, primaryClass } from '../lib/patientBooking'

/**
 * หน้าทำงานของเจ้าหน้าที่ — ตารางออกรถ คิวรอจัดแผน เที่ยวเดินรถ งานคนขับ รายงาน และตั้งค่า
 *
 * แยกจากหน้าประชาชน (/patient-transport) ที่ใช้ component และ RPC ชุดเดียวกัน ไม่ใช่ระบบจองคนละชุด
 * route นี้อยู่ใต้ RequireAuth staffOnly แล้ว และยังตรวจบทบาทจาก patient_booking_workspace ซ้ำที่นี่
 * เพราะสิทธิ์ของโมดูลนี้ (ผู้จัดคิว/คนขับ) มาจากทะเบียนของระบบจอง ไม่ใช่จาก role ของบัญชีอย่างเดียว
 *
 * เมนูเป็นแถบแท็บชั้นเดียวแบบโมดูลยานพาหนะ และทุกหน้ารายการใช้กล่องเดียวกับ "คำร้อง"
 * (ค้นหา ป้ายกรองพร้อมจำนวน ตารางราชการ แล้วเปิดเรื่องเป็นแผ่นลอยทับ) — ดู StaffShell.jsx
 */
export default function PatientTransportStaff({ onBack } = {}) {
  const { tenant } = useTenant()
  const { session, profileName } = useAuth()
  const uid = session?.user?.id
  const [selectedView, setView] = useState(null)
  const [helpTarget, setHelpTarget] = useState(null)
  const [preview, setPreview] = useState(null)
  const { current, info, workspace, error, setError, notice, busy, setBusy, lockRef, reload, mutate, op } = usePatientBooking(tenant?.id, uid, 'patient_booking_workspace')
  const tenantId = tenant?.id
  const isCoordinator = ['admin', 'coordinator'].includes(workspace?.role)
  const isAdmin = workspace?.role === 'admin'
  const isDriver = workspace?.role === 'driver' || (isCoordinator && !!uid && workspace?.settings?.driver_id === uid) || workspace?.trips?.some(t => t.driver_id === uid)
  const allowed = isCoordinator || isDriver
  const view = selectedView ?? (isCoordinator ? 'schedule' : 'driver')
  const tabs = [
    { id: 'schedule', label: 'ตารางออกรถ', Icon: CalendarDays, show: isCoordinator },
    { id: 'queue', label: 'คิวรอจัดแผน', Icon: Inbox, show: isCoordinator },
    { id: 'trips', label: 'เที่ยวเดินรถ', Icon: Route, show: isCoordinator },
    { id: 'driver', label: 'งานคนขับ', Icon: Car, show: isDriver },
    { id: 'report', label: 'รายงาน', Icon: BarChart2, show: isCoordinator },
    { id: 'settings', label: 'ตั้งค่า', Icon: Settings, show: isAdmin },
  ].filter(t => t.show)
  // ฝังในแดชบอร์ดเจ้าหน้าที่ (เมนูบน/ซ้ายของหน้าเจ้าหน้าที่ครอบอยู่แล้ว) — กติกาเดียวกับ FleetPage
  // หัวโมดูลและปุ่มย้อนกลับมาจากโครงหน้าเจ้าหน้าที่ หน้านี้จึงไม่วาดซ้ำเมื่อ embedded
  const embedded = !!onBack
  function go(next) { setView(next); setPreview(null) }
  function run(name, args, success, after) { setPreview(null); return mutate(name, args, success, after) }
  function action(entity, name, note = '') {
    const args = { p_entity: entity.id, p_revision: entity.revision, p_action: name, p_note: note }
    return run('patient_booking_action', { ...args, p_op: op(JSON.stringify(args)) }, 'บันทึกแล้ว และแจ้งสถานะในระบบให้ผู้เกี่ยวข้อง')
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
  const recordOdometer = (trip, start, end, issue, reason) => run('patient_booking_save_odometer', { p_trip: trip.id, p_docs_revision: trip.docs_revision, p_start: start, p_end: end, p_issue: issue, p_note: reason }, 'บันทึกเลขไมล์แล้ว')
  async function inspect(ids, helper) {
    if (lockRef.current) return
    lockRef.current = true; setBusy(true); setError('')
    try {
      const joinRequest = workspace.bookings.find(b => b.id === ids[0])?.requested_trip_id
      const { data: plan, error: failure } = await supabase.rpc(joinRequest ? 'patient_booking_preview_join' : 'patient_booking_preview',
        joinRequest ? { p_muni: tenantId, p_booking: ids[0] } : { p_muni: tenantId, p_ids: ids, p_helper: helper })
      if (failure) throw failure
      setPreview(plan)
    } catch (e) { setError(e.message) }
    finally { lockRef.current = false; setBusy(false) }
  }
  // ปุ่มหลักของกล่องคิว อยู่ในแถบเครื่องมือที่เดียวกับปุ่ม "รับแจ้งที่เคาน์เตอร์" ของคำร้อง
  const intakeButton = <button className={primaryClass} disabled={busy || !info?.enabled} onClick={() => go('book')}>รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์</button>
  return <div className={embedded ? 'text-slate-900' : 'mx-auto min-h-screen max-w-5xl bg-white px-4 py-6 text-slate-900'}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{!embedded && <Link to="/staff" className={`${buttonClass} inline-flex items-center`}>← หน้าเจ้าหน้าที่</Link>}<Link to="/patient-transport" className={`${buttonClass} inline-flex items-center gap-2`}><Users size={16} />หน้าประชาชน</Link></div><button className={`${buttonClass} inline-flex items-center gap-2`} onClick={reload} disabled={busy}><RefreshCw size={16} />โหลดข้อมูลล่าสุด</button></div>
    {!embedded && <header className="mb-4"><p className="text-sm font-semibold text-sky-800">{tenant?.name} · งานเจ้าหน้าที่</p><h1 className="mt-1 text-2xl font-bold">รถรับส่งผู้ป่วย — จัดคิวและเดินรถ</h1></header>}
    {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
    {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4">{notice}</p>}
    {!current && !error && <p role="status">กำลังโหลดข้อมูลงาน…</p>}
    {/* บัญชีเจ้าหน้าที่ที่ไม่ได้อยู่ในทะเบียนผู้จัดคิว/คนขับของโมดูลนี้ ใช้บริการฝั่งประชาชนได้ตามปกติ */}
    {current && !allowed && <div className="rounded-xl bg-amber-50 p-4"><p className="font-semibold">บัญชีนี้ยังไม่ได้รับมอบหมายงานรถรับส่งผู้ป่วย</p>
      <p className="mt-2 text-sm">ให้ผู้ดูแลเพิ่มบัญชีนี้เป็นผู้จัดคิวหรือคนขับในหน้าตั้งค่าก่อน ระหว่างนี้ใช้หน้าประชาชนเพื่อจองรถได้ตามปกติ</p>
      <Link to="/patient-transport" className={`${primaryClass} mt-4 inline-flex items-center`}>ไปหน้าประชาชน</Link></div>}
    {current && allowed && <>
      <BookingHelp key={`${tenantId}/${uid}/${workspace?.role}/${!!info?.enabled}`} enabled={!!info?.enabled} coordinator={isCoordinator} driver={isDriver} admin={isAdmin} signedIn busy={busy} onHighlight={setHelpTarget} />
      <TabBar tab={view} setTab={go} tabs={tabs} highlight={helpTarget} busy={busy} />
      {!info?.enabled && <p className="mb-4 rounded-xl bg-amber-50 p-4">{isAdmin ? 'ยังไม่เปิดรับจองออนไลน์ ตั้งค่ารถ คนขับ ผู้จัดคิว เส้นทางและเวลาให้บริการในแท็บ “ตั้งค่า” ก่อนเปิดบริการ' : 'ยังไม่เปิดรับจองออนไลน์ ให้ผู้ดูแลตั้งค่ารถและเปิดบริการก่อน'}</p>}
      {view === 'schedule' && isCoordinator && <BookingDaySchedule workspace={workspace} busy={busy} onQueue={() => go('queue')} onUpdate={(trip, revision, notice2, pickup, back) => run('patient_booking_update_schedule', { p_trip: trip, p_revision: revision, p_notice: notice2, p_pickup: pickup, p_return: back }, 'บันทึกประกาศและเวลาประมาณการแล้ว')} />}
      {view === 'queue' && isCoordinator && <PendingQueue workspace={workspace} busy={busy} preview={preview} clearPreview={() => setPreview(null)} onPreview={inspect} action={intakeButton} onAction={action}
        onAmend={(booking, values, reason) => { const args = { p_id: booking.id, p_revision: booking.revision, p_data: values, p_note: reason }; return run('patient_booking_amend', { ...args, p_op: op(JSON.stringify(args)) }, 'แก้ข้อมูลตามที่ประสานแล้ว พร้อมเก็บประวัติ') }}
        onConfirm={(ids, plan, helper) => plan.join_trip_id ? run('patient_booking_confirm_join', { p_op: op(JSON.stringify(plan)), p_booking: plan.join_booking_id, p_expected: plan }, 'ยืนยันร่วมเที่ยวแล้ว แจ้งแผนล่าสุดให้ผู้เดินทางและคนขับ') : run('patient_booking_confirm', { p_id: op(JSON.stringify({ ids, plan, helper })), p_ids: ids, p_expected: plan, p_helper: helper }, 'ยืนยันเที่ยวแล้ว ผู้จองและคนขับเห็นข้อมูลในระบบ')} />}
      {view === 'trips' && isCoordinator && <TripBoard workspace={workspace} busy={busy} onAction={action} onReload={reload}
        onRecordLetter={(trip, letterNo, letterDate) => run('patient_booking_record_letter', { p_trip: trip.id, p_docs_revision: trip.docs_revision, p_letter_no: letterNo, p_letter_date: letterDate }, 'บันทึกเลขหนังสือนำส่งแล้ว')}
        onPrintLetter={printLetter} onOdometer={recordOdometer} />}
      {view === 'report' && isCoordinator && <QueueReport workspace={workspace} busy={busy} onMonthReport={printMonth} />}
      {/* รับจองแทนมีที่นี่ที่เดียว และส่ง p_staff_entry ให้ฐานข้อมูลบันทึกว่าเป็นการรับเรื่องแทน */}
      {view === 'book' && isCoordinator && info?.enabled && <BookingForm submitError={error} tenantId={tenantId} initial={{}} info={info} profileName={profileName} profilePhone={workspace?.my_profile?.phone} staffEntry busy={busy} onBack={() => go('queue')} onSubmit={(id, payload) => run('patient_booking_submit', { p_id: id, p_data: payload, p_staff_entry: true }, 'รับคำขอแทนแล้ว รอตรวจแผนและยืนยันรถ', () => go('queue'))} />}
      {view === 'driver' && isDriver && <DriverTrips workspace={workspace} uid={uid} busy={busy} onAction={action} onOdometer={recordOdometer} />}
      {view === 'settings' && isAdmin && <BookingSettings key={workspace.settings?.revision || 'new'} workspace={workspace} busy={busy} onSave={(revision, form) => run('patient_booking_save_settings', { p_revision: revision, p_data: form }, 'บันทึกค่าตั้งต้นแล้ว')} />}
      {workspace?.limited && <p className="mt-4 rounded-xl bg-amber-50 p-3">รายการเกินขอบเขตหน้าจอ กรุณาติดต่อผู้ดูแลก่อนจัดคิวเพิ่มเติม</p>}
      {workspace?.notices?.length > 0 && <details className="mt-6 rounded-xl border border-slate-200 p-4"><summary className="min-h-11 cursor-pointer font-semibold">แจ้งเตือนการเดินทาง ({workspace.notices.length})</summary>{workspace.notices.map(n => <p key={n.id} className="border-t border-slate-100 py-3">{n.message}</p>)}</details>}
    </>}
  </div>
}
