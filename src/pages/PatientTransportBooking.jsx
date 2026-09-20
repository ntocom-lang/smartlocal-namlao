import { useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Wrench } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import BookingHelp from '../components/patientTransport/BookingHelp'
import BookingCalendar from '../components/patientTransport/BookingCalendar'
import BookingForm from '../components/patientTransport/BookingForm'
import { BookingCards } from '../components/patientTransport/BookingOperations'
import usePatientBooking from '../hooks/usePatientBooking'
import { buttonClass, primaryClass, clockTime } from '../lib/patientBooking'

/**
 * หน้าประชาชนของบริการรถรับส่งผู้ป่วย — จอง ดูวันว่าง และติดตามการจองของตัวเองเท่านั้น
 *
 * รูปแบบหน้ายกมาจากแท็บ "การใช้รถ" ของโมดูลยานพาหนะ ซึ่งเจ้าหน้าที่ใช้ได้คล่องโดยไม่ต้องสอน:
 * ปุ่มทำงานอยู่บนสุด ถัดลงมาเป็นรายการของตัวเองพร้อมสถานะ แล้วจึงเป็นประวัติ
 * ของเดิมแยกเป็น 3 แท็บ (หน้าบริการ / ดูตารางรถ / การจองของฉัน) ผู้ใช้ต้องรู้ก่อนว่าตัวเองควรอยู่แท็บไหน
 *
 * งานของเจ้าหน้าที่ (ตารางออกรถ จัดคิว งานคนขับ ตั้งค่า) อยู่ที่ /staff/patient-transport
 * เจ้าหน้าที่ที่เปิดหน้านี้ต้องเห็นหน้าประชาชนตามปกติ มีเพียงลิงก์เล็กไปหน้าทำงาน ไม่ใช่สลับหน้าให้เอง
 * เพราะเจ้าหน้าที่ก็จองรถให้ครอบครัวตัวเองได้ และต้องอยู่ใต้กติกาเดียวกับประชาชนคนอื่น
 */
export default function PatientTransportBooking() {
  const { tenant } = useTenant()
  const { session, profileName } = useAuth()
  const uid = session?.user?.id
  const [view, setView] = useState('home')
  const [helpTarget, setHelpTarget] = useState(null)
  const [bookingSeed, setBookingSeed] = useState({})
  // หน้านี้โหลดเฉพาะข้อมูลสาธารณะกับคำขอของผู้ใช้เอง ไม่ว่าผู้เปิดจะมีบทบาทอะไร
  const { current, info, workspace, error, notice, busy, reload, mutate, op } = usePatientBooking(tenant?.id, uid, 'patient_booking_mine')
  const tenantId = tenant?.id
  const isStaff = ['admin', 'coordinator', 'driver'].includes(workspace?.role)
  const bookings = workspace?.bookings || []
  const active = bookings.filter(b => ['submitted', 'confirmed'].includes(b.status))
  const past = bookings.filter(b => !['submitted', 'confirmed'].includes(b.status))
  // ⚠️ p_op ต้องส่งทุกครั้ง — patient_booking_action บังคับ operation id ไว้กันเน็ตหลุดแล้วยิงซ้ำ
  // (ขาดไปแล้ว PostgREST ตอบ PGRST202 "Could not find the function" ปุ่มยกเลิก/พร้อมกลับใช้ไม่ได้)
  function action(entity, name, note = '') {
    const args = { p_entity: entity.id, p_revision: entity.revision, p_action: name, p_note: note }
    return mutate('patient_booking_action', { ...args, p_op: op(JSON.stringify(args)) },
      'บันทึกแล้ว และแจ้งสถานะในระบบให้ผู้เกี่ยวข้อง')
  }
  // คู่มือแบบ "แนะนำทีละขั้น" วงกรอบสีเหลืองรอบสิ่งที่พูดถึง ต้องรวมคลาสเดิมไว้ ไม่ใช่เขียนทับ
  const highlight = (key, base = '') => helpTarget === key
    ? { className: `${base} ring-4 ring-amber-400 ring-offset-2`, 'data-help-highlight': 'true' }
    : { className: base }
  return <div className="mx-auto min-h-screen max-w-5xl bg-white px-4 py-6 text-slate-900">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link to="/" className={`${buttonClass} inline-flex items-center`}>← หน้าหลัก</Link><button className={`${buttonClass} inline-flex items-center gap-2`} onClick={reload} disabled={busy}><RefreshCw size={16} />โหลดข้อมูลล่าสุด</button></div>
    <header className="mb-5"><p className="text-sm font-semibold text-sky-800">{tenant?.name} · ดูแลใกล้บ้าน</p><h1 className="mt-1 text-2xl font-bold">รถรับส่งผู้ป่วย</h1></header>
    {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
    {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4">{notice}</p>}
    {!current && !error && <p role="status">กำลังโหลดบริการ…</p>}
    {current && <section className="space-y-5" aria-label="บริการรถรับส่งผู้ป่วย">
      {/* ลิงก์เล็กสำหรับบัญชีสองบทบาท ไม่ใช่การพาออกจากหน้าประชาชนเอง */}
      {isStaff && <Link to="/staff/patient-transport" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-sky-800 underline"><Wrench size={16} />ไปหน้าทำงานเจ้าหน้าที่</Link>}
      <BookingHelp key={`${tenantId}/${uid || 'anonymous'}/citizen/${!!info?.enabled}`} enabled={!!info?.enabled} coordinator={false} driver={false} admin={false} signedIn={!!uid} busy={busy} onHighlight={setHelpTarget} />
      {view === 'home' && <>
        {/* ปุ่มทำงานอยู่บนสุดแบบแท็บ "การใช้รถ" — ไม่ต้องเลือกแท็บก่อนถึงจะทำอะไรได้ */}
        {info?.enabled ? <>
          <div className="flex flex-wrap gap-3">
            {uid
              ? <button disabled={busy} onClick={() => { setBookingSeed({}); setView('book') }} {...highlight('home', `${primaryClass} text-base`)}>ขอจองรถรับส่ง</button>
              : <Link to="/auth" state={{ from: '/patient-transport' }} {...highlight('home', `${primaryClass} inline-flex items-center text-base`)}>เข้าสู่ระบบเพื่อจองรถ</Link>}
            <button disabled={busy} onClick={() => setView('calendar')} {...highlight('calendar', `${buttonClass} text-base`)}>ดูวันว่าง</button>
          </div>
          <p className="text-sm text-slate-600">รับ–ส่งไปโรงพยาบาลตามนัด ญาติหรือผู้ดูแลจองแทนได้ ไม่ต้องใช้เลขสมาชิกกองทุน · ให้บริการวันราชการ {clockTime(info.office_start)}–{clockTime(info.office_end)} ตามปฏิทินหน่วยงาน</p>
        </> : <>
          <p className="rounded-xl bg-slate-50 p-4">หน่วยงานยังไม่เปิดรับจองรถออนไลน์ กรุณาติดต่อเจ้าหน้าที่เพื่อสอบถามบริการ</p>
          {isStaff && <p className="text-sm">เปิดบริการได้ที่ <Link to="/staff/patient-transport" className="font-semibold text-sky-800 underline">หน้าทำงานเจ้าหน้าที่</Link></p>}
        </>}
        <p className="rounded-xl bg-amber-50 p-4">เจ็บป่วยฉุกเฉิน <a href="tel:1669" className="font-bold underline">โทร 1669</a> อย่ารอคิวจองรถ</p>
        {uid ? <section aria-label="การจองของฉัน" {...highlight('mine', 'space-y-3')}>
          <h2 className="text-lg font-bold">การจองของฉัน ({active.length})</h2>
          <BookingCards bookings={active} trips={workspace?.trips || []} busy={busy} onAction={action} />
          {/* ประวัติเรียงต่อด้านล่างแบบเดียวกับ "ประวัติการใช้รถ" ของยานพาหนะ ไม่ต้องกดเปิด
              ผู้จองรายหนึ่งมีไม่กี่รายการ (ระบบส่งมาเฉพาะที่ยังเดินอยู่กับ 30 วันล่าสุด) */}
          {past.length > 0 && <>
            <h2 className="pt-2 text-lg font-bold">ประวัติการจอง ({past.length})</h2>
            <BookingCards bookings={past} trips={workspace?.trips || []} busy={busy} onAction={action} />
          </>}
        </section> : <p className="text-sm text-slate-600">เข้าสู่ระบบแล้วจะเห็นการจองของตัวเองและสถานะรถที่นี่</p>}
      </>}
      {view === 'calendar' && info?.enabled && <>
        <button className={buttonClass} onClick={() => setView('home')}>← ย้อนกลับ</button>
        <BookingCalendar tenantId={tenantId} info={info} uid={uid} onBook={seed => { setBookingSeed(seed); setView('book') }} />
      </>}
      {/* หน้านี้จองในนามตัวเองเสมอ — การรับจองแทนของเจ้าหน้าที่อยู่ในหน้าทำงานและส่งธง p_staff_entry */}
      {view === 'book' && uid && info?.enabled && <BookingForm submitError={error} tenantId={tenantId} initial={bookingSeed} info={info} profileName={profileName} profilePhone={workspace?.my_profile?.phone} staffEntry={false} busy={busy} onBack={() => setView('home')} onSubmit={(id, payload) => mutate(bookingSeed.requested_trip_id ? 'patient_booking_submit_join' : 'patient_booking_submit', { p_id: id, p_data: payload, p_staff_entry: false, ...(bookingSeed.requested_trip_id ? { p_trip: bookingSeed.requested_trip_id } : {}) }, 'รับคำขอแล้ว รอเจ้าหน้าที่ยืนยันรถ', () => setView('home'))} />}
      {workspace?.notices?.length > 0 && <details className="rounded-xl border border-slate-200 p-4"><summary className="min-h-11 cursor-pointer font-semibold">แจ้งเตือนการเดินทาง ({workspace.notices.length})</summary>{workspace.notices.map(n => <p key={n.id} className="border-t border-slate-100 py-3">{n.message}</p>)}</details>}
    </section>}
    <footer className="mt-6 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-sm"><Link to="/my-docs" className="inline-flex min-h-11 items-center text-sky-800 underline">ติดตามคำขอที่เคยยื่นไว้</Link>{info?.contact_phone && <a className="inline-flex min-h-11 items-center text-sky-800 underline" href={`tel:${info.contact_phone}`}>ติดต่อเจ้าหน้าที่ {info.contact_phone}</a>}</footer>
  </div>
}
