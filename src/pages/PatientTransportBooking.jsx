import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, RefreshCw, Wrench } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import BookingForm from '../components/patientTransport/BookingForm'
import { BookingCards } from '../components/patientTransport/BookingOperations'
import usePatientBooking from '../hooks/usePatientBooking'
import { buttonClass, primaryClass, clockTime } from '../lib/patientBooking'

/**
 * หน้าประชาชนของบริการรถรับส่งผู้ป่วย — ขอรถ และติดตามคำขอของตัวเองเท่านั้น
 *
 * รูปแบบหน้ายกมาจาก "คำร้อง" กับ "คำขอบริการ" ตามที่เจ้าของระบบสั่ง 2569-09-21
 * (ทดลองของจริงหลายรอบแล้วสรุปว่าของเดิมยากและงงทุกฝั่ง): ปุ่มขอรับบริการปุ่มใหญ่ปุ่มเดียวบนสุด
 * ถัดลงมาเป็นคำขอของตัวเองพร้อมแถบขั้นตอน แล้วจึงเป็นประวัติ · ไม่มีแท็บให้เลือกก่อนทำอะไรได้
 * หน้าปฏิทิน "ดูวันว่าง" ถอดออกแล้ว เพราะฟอร์มขึ้นเฉพาะวันและเวลาที่รถว่างจริงอยู่แล้ว
 *
 * งานของเจ้าหน้าที่ (คำขอรถ งานคนขับ รายงาน ตั้งค่า) อยู่ที่ /staff/patient-transport
 * เจ้าหน้าที่ที่เปิดหน้านี้ต้องเห็นหน้าประชาชนตามปกติ มีเพียงลิงก์เล็กไปหน้าทำงาน เพราะเจ้าหน้าที่
 * ก็จองรถให้ครอบครัวตัวเองได้ และต้องอยู่ใต้กติกาเดียวกับประชาชนคนอื่น
 */
export default function PatientTransportBooking() {
  const { tenant } = useTenant()
  const { session, profileName } = useAuth()
  const uid = session?.user?.id
  const [view, setView] = useState('home')
  const [done, setDone] = useState('')
  // หน้านี้โหลดเฉพาะข้อมูลสาธารณะกับคำขอของผู้ใช้เอง ไม่ว่าผู้เปิดจะมีบทบาทอะไร
  const { current, info, workspace, error, notice, busy, reload, mutate, op } = usePatientBooking(tenant?.id, uid, 'patient_booking_mine')
  const tenantId = tenant?.id
  const isStaff = ['admin', 'coordinator', 'driver'].includes(workspace?.role)
  const bookings = workspace?.bookings || []
  const active = bookings.filter(b => ['submitted', 'confirmed'].includes(b.status))
  const past = bookings.filter(b => !['submitted', 'confirmed'].includes(b.status))
  // ค่าที่ใช้เติมฟอร์มให้ = คำขอล่าสุดที่ผู้ใช้คนนี้จองเอง (คนไปตามนัดประจำจะได้ไม่ต้องกรอกซ้ำทุกครั้ง)
  // ⚠️ ข้ามคำขอที่เจ้าหน้าที่รับจองแทน (entry_channel 'staff') — ถ้าหยิบมาเติม เจ้าหน้าที่ที่จองให้ตัวเองจะได้ชื่อ เบอร์
  // และจุดรับของคนที่โทรมาแทน (PDPA) · ตั้งแต่ 20260922120000 ฐานข้อมูลไม่ส่งคำขอกลุ่มนี้มาแล้ว กรองซ้ำไว้กันพลาด
  const lastBooking = bookings.filter(b => b.entry_channel !== 'staff')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  // ⚠️ p_op ต้องส่งทุกครั้ง — patient_booking_action บังคับ operation id ไว้กันเน็ตหลุดแล้วยิงซ้ำ
  // (ขาดไปแล้ว PostgREST ตอบ PGRST202 "Could not find the function" ปุ่มยกเลิก/พร้อมกลับใช้ไม่ได้)
  function action(entity, name, note = '') {
    const args = { p_entity: entity.id, p_revision: entity.revision, p_action: name, p_note: note }
    return mutate('patient_booking_action', { ...args, p_op: op(JSON.stringify(args)) },
      'บันทึกแล้ว และแจ้งสถานะในระบบให้ผู้เกี่ยวข้อง')
  }
  return <div className="mx-auto min-h-screen max-w-3xl bg-slate-100 px-4 py-6 text-slate-900">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link to="/" className={`${buttonClass} inline-flex items-center`}>← หน้าหลัก</Link><button className={`${buttonClass} inline-flex items-center gap-2`} onClick={reload} disabled={busy}><RefreshCw size={16} />โหลดข้อมูลล่าสุด</button></div>
    <header className="mb-5"><p className="text-sm font-semibold text-sky-800">{tenant?.name} · ดูแลใกล้บ้าน</p><h1 className="mt-1 text-2xl font-bold">รถรับส่งผู้ป่วย</h1></header>
    {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
    {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4">{notice}</p>}
    {!current && !error && <p role="status">กำลังโหลดบริการ…</p>}
    {current && <section className="space-y-5" aria-label="บริการรถรับส่งผู้ป่วย">
      {/* ลิงก์เล็กสำหรับบัญชีสองบทบาท ไม่ใช่การพาออกจากหน้าประชาชนเอง */}
      {isStaff && <Link to="/staff/patient-transport" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-sky-800 underline"><Wrench size={16} />ไปหน้าทำงานเจ้าหน้าที่</Link>}

      {view === 'done' && <section aria-label="ส่งคำขอสำเร็จ" className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <CheckCircle2 size={44} className="mx-auto text-emerald-600" />
        <h2 className="text-xl font-bold">ส่งคำขอสำเร็จ</h2>
        <div className="rounded-2xl bg-white p-4"><p className="text-xs text-slate-500">เลขที่คำขอ — บันทึกไว้เพื่อติดตาม</p>
          <p className="text-2xl font-black tracking-widest">{done.slice(0, 8).toUpperCase()}</p></div>
        <p>เจ้าหน้าที่จะตรวจคิวรถและยืนยันให้ สถานะจะขึ้นในหน้านี้ หากต้องประสานเพิ่มจะโทรตามเบอร์ที่แจ้งไว้</p>
        <button className={`${primaryClass} w-full text-base`} onClick={() => setView('home')}>ดูคำขอของฉัน</button>
      </section>}

      {view === 'home' && <>
        {/* ปุ่มขอรับบริการปุ่มใหญ่ปุ่มเดียวบนสุดแบบหน้าคำขอบริการ ไม่ต้องเลือกแท็บก่อนถึงจะทำอะไรได้ */}
        {info?.enabled ? <>
          {uid
            ? <button disabled={busy} className="min-h-16 w-full rounded-2xl bg-sky-800 px-4 text-lg font-bold text-white disabled:opacity-50" onClick={() => setView('book')}>🚐 ขอรถไปโรงพยาบาล</button>
            : <Link to="/auth" state={{ from: '/patient-transport' }} className="flex min-h-16 w-full items-center justify-center rounded-2xl bg-sky-800 px-4 text-lg font-bold text-white">เข้าสู่ระบบเพื่อขอรถ</Link>}
          <p className="text-sm text-slate-600">รับ–ส่งไปโรงพยาบาลตามนัด ญาติหรือผู้ดูแลจองแทนได้ ไม่ต้องใช้เลขสมาชิกกองทุน · ให้บริการวันราชการ {clockTime(info.office_start)}–{clockTime(info.office_end)} ตามปฏิทินหน่วยงาน</p>
        </> : <>
          <p className="rounded-xl bg-slate-50 p-4">หน่วยงานยังไม่เปิดรับจองรถออนไลน์ กรุณาติดต่อเจ้าหน้าที่เพื่อสอบถามบริการ</p>
          {isStaff && <p className="text-sm">เปิดบริการได้ที่ <Link to="/staff/patient-transport" className="font-semibold text-sky-800 underline">หน้าทำงานเจ้าหน้าที่</Link></p>}
        </>}
        <p className="rounded-xl bg-amber-50 p-4">เจ็บป่วยฉุกเฉิน <a href="tel:1669" className="font-bold underline">โทร 1669</a> อย่ารอคิวจองรถ</p>
        {uid ? <section aria-label="คำขอของฉัน" className="space-y-3">
          <h2 className="text-lg font-bold">คำขอของฉัน ({active.length})</h2>
          <BookingCards bookings={active} trips={workspace?.trips || []} busy={busy} onAction={action} />
          {/* ประวัติเรียงต่อด้านล่าง ไม่ต้องกดเปิด — ผู้จองรายหนึ่งมีไม่กี่รายการ
              (ระบบส่งมาเฉพาะที่ยังเดินอยู่กับ 30 วันล่าสุด) */}
          {past.length > 0 && <>
            <h2 className="pt-2 text-lg font-bold">ประวัติการจอง ({past.length})</h2>
            <BookingCards bookings={past} trips={workspace?.trips || []} busy={busy} onAction={action} />
          </>}
        </section> : <p className="text-sm text-slate-600">เข้าสู่ระบบแล้วจะเห็นคำขอของตัวเองและสถานะรถที่นี่</p>}
      </>}

      {/* หน้านี้จองในนามตัวเองเสมอ — การรับจองแทนของเจ้าหน้าที่อยู่ในหน้าทำงานและส่งธง p_staff_entry */}
      {view === 'book' && uid && info?.enabled && <BookingForm submitError={error} tenantId={tenantId} info={info}
        profileName={profileName} profilePhone={workspace?.my_profile?.phone} lastBooking={lastBooking} staffEntry={false}
        busy={busy} onBack={() => setView('home')}
        onSubmit={(id, payload) => mutate('patient_booking_submit', { p_id: id, p_data: payload, p_staff_entry: false }, '',
          data => { setDone(String(data || id)); setView('done') })} />}
    </section>}
    <footer className="mt-6 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-sm"><Link to="/my-docs" className="inline-flex min-h-11 items-center text-sky-800 underline">ติดตามคำขอที่เคยยื่นไว้</Link>{info?.contact_phone && <a className="inline-flex min-h-11 items-center text-sky-800 underline" href={`tel:${info.contact_phone}`}>ติดต่อเจ้าหน้าที่ {info.contact_phone}</a>}</footer>
  </div>
}
