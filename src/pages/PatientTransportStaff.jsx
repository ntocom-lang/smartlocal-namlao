import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart2, CalendarDays, Car, Inbox, RefreshCw, Settings, Users, X } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import BookingForm from '../components/patientTransport/BookingForm'
import CommunityBookingForm from '../components/patientTransport/CommunityBookingForm'
import BookingInbox from '../components/patientTransport/BookingInbox'
import StaffBookingCalendar from '../components/patientTransport/StaffBookingCalendar'
import TransportSettings from '../components/patientTransport/TransportSettings'
import { TabBar } from '../components/patientTransport/StaffShell'
import { QueueReport, DriverTrips } from '../components/patientTransport/BookingOperations'
import { buildBookingRequestFormHtml, buildBookingForwardLetterHtml, buildTripMonthReportHtml, buildPatientPrintLoadingHtml, writeAndPrint } from '../lib/patientTransportPrint'
import { buildCommunityRequestFormHtml, buildCommunityForwardLetterHtml } from '../lib/communityTransportPrint'
import { SIGNATORY_REGISTRY_SELECT, SIGNATORY_SCOPE, pickSignatory, signatoryName, signatoryTitle } from '../lib/documentSignatories'
import { resolvePatientRequestSignatories } from '../lib/patientRequestSignatories'
import usePatientBooking from '../hooks/usePatientBooking'
import { TRIP_STATUS, WORKSPACE_ROW_LIMIT, workspaceTruncated, dayPending, thaiDayAfter, buttonClass, primaryClass, clockOf, driverSteps, joinCandidates, pickupForBooking, isCommunity, bookingName, bookingLetterMoment, servicePeriodReport } from '../lib/patientBooking'

/**
 * หน้าทำงานของเจ้าหน้าที่ — คำขอรถ · ปฏิทิน · งานคนขับ · รายงาน · ตั้งค่า
 *
 * เจ้าของระบบสั่ง 2569-09-21 ให้ง่ายแบบกล่องงาน "คำร้อง/คำขอบริการ" (ทดลองของจริงแล้วงงทุกฝั่ง)
 * แท็บ "ตารางออกรถ · คิวรอจัดแผน · เที่ยวเดินรถ" รวมเป็นกล่อง "คำขอรถ" กล่องเดียว (BookingInbox.jsx)
 * 1 แถว = 1 คำขอ ปุ่มเดียวบอกงานถัดไป และ "ยืนยันรถ" จบในคลิกเดียว
 *
 * แยกจากหน้าประชาชน (/patient-transport) ที่ใช้ component และ RPC ชุดเดียวกัน ไม่ใช่ระบบจองคนละชุด
 * route นี้อยู่ใต้ RequireAuth staffOnly แล้ว และยังตรวจบทบาทจาก patient_booking_workspace ซ้ำที่นี่
 * เพราะสิทธิ์ของโมดูลนี้ (ผู้จัดคิว/คนขับ) มาจากทะเบียนของระบบจอง ไม่ใช่จาก role ของบัญชีอย่างเดียว
 */
export default function PatientTransportStaff({ onBack } = {}) {
  const { tenant } = useTenant()
  const { session, profileName } = useAuth()
  const uid = session?.user?.id
  const [selectedView, setView] = useState(null)
  const [calendarBookingId, setCalendarBookingId] = useState(null)
  const [created, setCreated] = useState(null)
  const [intakeService, setIntakeService] = useState('patient')
  const { current, info, workspace, error, setError, notice, setNotice, busy, reload, mutate, task, op } = usePatientBooking(tenant?.id, uid, 'patient_booking_workspace')
  const tenantId = tenant?.id
  const isCoordinator = ['admin', 'coordinator'].includes(workspace?.role)
  const isAdmin = workspace?.role === 'admin'
  const isDriver = isAdmin || workspace?.role === 'driver' || (isCoordinator && !!uid && workspace?.settings?.driver_id === uid) || workspace?.trips?.some(t => t.driver_id === uid)
  const allowed = isCoordinator || isDriver
  const view = selectedView ?? (isCoordinator ? 'inbox' : 'driver')
  // Count only this account's unfinished driver work: trips not finished + days waiting for the end-of-day odometer
  // (เลขไมล์เหมาเป็นวัน 20261008100200 — นับวันละ 1 เหมือน patient_booking_staff_work_badge ไม่ใช่เที่ยวละ 1)
  const recentFrom = thaiDayAfter(-30)
  const driverWorkCount = (workspace?.trips || []).filter(t => (isAdmin || t.driver_id === uid) && t.state !== 'cancelled' && t.state !== 'completed').length
    + (workspace?.odometer?.days || []).filter(d => (isAdmin || d.mine) && d.date >= recentFrom && dayPending(d)).length
  const tabs = [
    { id: 'inbox', label: 'คำขอรถ', Icon: Inbox, show: isCoordinator },
    { id: 'calendar', label: 'ปฏิทิน', Icon: CalendarDays, show: isCoordinator },
    { id: 'driver', label: 'งานคนขับ', Icon: Car, show: isCoordinator || isDriver },
    { id: 'report', label: 'รายงาน', Icon: BarChart2, show: isCoordinator },
    { id: 'settings', label: 'ตั้งค่า', Icon: Settings, show: isAdmin },
  ].filter(t => t.show)
  // ข้อความผลลัพธ์หายเองใน 5 วินาที (ตั้งค่าในตัวจับเวลา ไม่ใช่ใน effect ตรง ๆ)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])
  // ฝังในแดชบอร์ดเจ้าหน้าที่ (เมนูบน/ซ้ายของหน้าเจ้าหน้าที่ครอบอยู่แล้ว) — กติกาเดียวกับ FleetPage
  // หัวโมดูลและปุ่มย้อนกลับมาจากโครงหน้าเจ้าหน้าที่ หน้านี้จึงไม่วาดซ้ำเมื่อ embedded
  const embedded = !!onBack
  // ⚠️ p_op ต้องส่งทุกครั้ง — กันเน็ตหลุดแล้วยิงซ้ำ (ขาดไปแล้วปุ่มพังเงียบใน #244)
  function deleteBooking(row, reason) {
    const args = { p_booking: row.booking.id, p_revision: row.booking.revision, p_trip_revision: row.trip?.revision ?? null, p_docs_revision: row.trip?.docs_revision ?? null, p_reason: reason.trim() }
    return mutate('patient_booking_delete', { ...args, p_op: op(`delete:${JSON.stringify(args)}`) }, 'ลบคำขอแล้ว และปรับคิวรถเรียบร้อย')
  }
  function action(entity, name, note = '') {
    const args = { p_entity: entity.id, p_revision: entity.revision, p_action: name, p_note: note }
    return mutate('patient_booking_action', { ...args, p_op: op(JSON.stringify(args)) }, 'บันทึกแล้ว และแจ้งสถานะในระบบให้ผู้เกี่ยวข้อง')
  }
  function amendArgs(booking, values, reason) {
    const args = { p_id: booking.id, p_revision: booking.revision, p_data: values, p_note: reason }
    return { ...args, p_op: op(JSON.stringify(args)) }
  }
  const amend = (booking, values, reason) => mutate(isCommunity(booking) ? 'patient_booking_amend_community' : 'patient_booking_amend', amendArgs(booking, values, reason), 'แก้ข้อมูลตามที่ประสานแล้ว พร้อมเก็บประวัติ')
  const updatePickup = (booking, pickup, lat, lng) => {
    const args = { p_id: booking.id, p_revision: booking.revision, p_pickup: pickup, p_lat: lat, p_lng: lng, p_verified: true }
    return mutate('patient_booking_update_pickup', { ...args, p_op: op(`pickup:${JSON.stringify(args)}`) }, 'แก้จุดรับแล้ว · ผู้จองและคนขับเห็นข้อมูลล่าสุดในระบบ')
  }
  // ยืนยันรถคลิกเดียว = ตรวจแผน แล้วยืนยันต่อทันทีถ้าไม่มีปัญหา (คำสั่งเดิม 2 ตัว ใต้ล็อกเดียว)
  // ติดปัญหา → คืนแผนให้กล่องเปิดแผ่นแก้ · ปุ่มแก้ส่ง verifyArea/helper/amend/separate มาแล้วยืนยันต่อในรอบเดียว
  // ⚠️ ยังเป็นเจ้าหน้าที่กดเองทุกครั้ง ระบบไม่ยืนยันแทน (การยืนยันรถคือการตัดสินให้บริการแก่ประชาชน)
  // ⚠️ ฐานข้อมูลคำนวณแผนซ้ำใต้ล็อกตอนยืนยัน แผนเปลี่ยนระหว่างทาง = ปฏิเสธทั้งรายการ ไม่ยืนยันแผนเก่า
  function confirm(ids, { helper = '', verifyArea = false, separate = false, amend: change = null } = {}) {
    const names = ids.map(id => bookingName(workspace.bookings.find(b => b.id === id))).filter(Boolean).join(', ')
    return task(async call => {
      if (change) await call(isCommunity(change.booking) ? 'patient_booking_amend_community' : 'patient_booking_amend', amendArgs(change.booking, change.values, change.reason))
      if (verifyArea) {
        for (const b of workspace.bookings.filter(row => ids.includes(row.id) && !row.in_area)) {
          if (isCommunity(b)) throw new Error('คำขอชุมชนต้องทบทวนจุดรับและข้อความการใช้ข้อมูลหลังประสานผู้จองก่อนยืนยัน')
          await call('patient_booking_amend', amendArgs(b,
            { appointment_at: b.appointment_at, return_at: b.return_at, route_id: b.route_id, pickup: b.pickup, in_area: true, return_mode: b.return_mode }, 'เจ้าหน้าที่ตรวจแล้วว่าจุดรับอยู่ในเขตพื้นที่'))
        }
      }
      const requested = !separate && ids.length === 1 && workspace.bookings.find(b => b.id === ids[0])?.requested_trip_id
      const plan = requested
        ? await call('patient_booking_preview_join', { p_booking: ids[0] })
        : await call('patient_booking_preview', { p_ids: ids, p_helper: helper })
      if (plan.errors?.length) {
        // ชนเที่ยวที่ยืนยันแล้ว: ลองแผน "ไปคันเดียวกัน" ไว้ก่อน (อ่านอย่างเดียว ไม่จองอะไร)
        // ปุ่มแก้จะได้บอกเวลารถออกรับใหม่ของผู้เดินทางเดิมก่อนกด · ลองไม่ได้ก็ยังมีทางแก้อื่นครบ
        const joins = []
        if (!requested && plan.errors.includes('ทับช่วงรถหรือคนขับของเที่ยวที่ยืนยันแล้ว')) {
          for (const trip of joinCandidates(plan, workspace.trips, workspace.settings?.routes)) {
            try {
              const multi = ids.length > 1
              joins.push({ trip, ids, plan: await call(multi ? 'patient_booking_preview_multiwave' : 'patient_booking_preview_into_trip',
                multi ? { p_ids: ids, p_trip: trip.id } : { p_booking: ids[0], p_trip: trip.id }) })
            }
            catch (e) {
              // A single rider with a different appointment also needs a second vehicle run.
              if (ids.length === 1 && String(e.message).includes('รอบรับหลายรอบ')) {
                try { joins.push({ trip, ids, plan: await call('patient_booking_preview_multiwave', { p_ids: ids, p_trip: trip.id }) }); continue }
                catch (multiError) { joins.push({ trip, error: multiError.message || '', code: multiError.code }); continue }
              }
              joins.push({ trip, error: e.message || '', code: e.code })
            }
          }
        }
        return { ids, plan, joins }
      }
      if (requested) await call('patient_booking_confirm_join', { p_op: op(JSON.stringify(plan)), p_booking: ids[0], p_expected: plan })
      else await call('patient_booking_confirm', { p_id: op(JSON.stringify({ ids, plan, helper })), p_ids: ids, p_expected: plan, p_helper: helper })
      return { ids, plan, confirmed: true }
    }, out => out?.confirmed ? `ยืนยันรถแล้ว · ${names} · รถมารับประมาณ ${clockOf(out.plan.pickup_at)} น. ผู้จองและคนขับเห็นในระบบแล้ว` : '')
  }
  // ชนคิว → ให้ไปคันเดียวกับเที่ยวที่ยืนยันแล้ว (20260921120000) ฐานข้อมูลคำนวณแผนซ้ำใต้ล็อก
  // แผนเปลี่ยนระหว่างทาง = ปฏิเสธทั้งก้อน · ระบบแจ้งเวลาใหม่ให้ผู้เดินทางทุกคนและคนขับเอง
  // ⚠️ ความยินยอม "นั่งร่วมกับผู้ป่วยอื่น" ของทุกคนในเที่ยวยังบังคับที่ฐานข้อมูล เจ้าหน้าที่ข้ามไม่ได้
  function joinIntoTrip(bookings, trip, plan) {
    const ids = bookings.map(b => b.id)
    const multi = !!plan.multiwave
    const args = multi ? { p_ids: ids, p_trip: trip.id, p_expected: plan } : { p_booking: ids[0], p_trip: trip.id, p_expected: plan }
    return task(async call => {
      await call(multi ? 'patient_booking_confirm_multiwave' : 'patient_booking_confirm_into_trip', { ...args, p_op: op(JSON.stringify(args)) })
      return { joined: true }
    }, `ยืนยันรถแล้ว · ${bookings.map(b => b.patient_name).join(', ')} · ${multi ? 'จัดรถรับหลายรอบ' : 'ไปคันเดียวกับเที่ยวเดิม'} · รถมารับ ${bookings.map(b => clockOf(pickupForBooking({ plan }, b))).join(', ')} น. ระบบแจ้งทุกคนแล้ว`)
  }
  // นำผู้เดินทางออกจากเที่ยว — ถ้าเป็นคนสุดท้ายและรถยังไม่ออก คืนคิวเที่ยวที่ว่างแล้วให้ในรอบเดียวกัน
  // ไม่งั้นเที่ยวว่างค้างกันเวลารถไว้ และกล่องคำขอรถมองไม่เห็นเพราะไม่เหลือคำขอในเที่ยวนั้น
  function removePassenger(booking, trip, note) {
    return task(async call => {
      const args = { p_entity: booking.id, p_revision: booking.revision, p_action: 'cancel_passenger', p_note: note }
      await call('patient_booking_action', { ...args, p_op: op(JSON.stringify(args)) })
      const others = workspace.bookings.filter(b => b.trip_id === trip?.id && b.status === 'confirmed' && b.id !== booking.id)
      if (trip && !others.length && (trip.state === 'confirmed' || (trip.state === 'issue' && trip.state_before_issue === 'confirmed'))) {
        const release = { p_entity: trip.id, p_revision: trip.revision, p_action: 'release', p_note: note }
        await call('patient_booking_action', { ...release, p_op: op(JSON.stringify(release)) })
      }
    }, 'นำออกจากเที่ยวแล้ว และแจ้งผู้เกี่ยวข้องในระบบ')
  }
  // คนขับ: ออกรถหนึ่งคำสั่ง กลับแล้วหนึ่งคำสั่งแบบ atomic รวมผู้เดินทางทั้งเที่ยว
  // อ่านสถานะล่าสุดก่อนบันทึก: ผลตอบกลับหาย กดซ้ำได้โดยไม่บันทึกจบเที่ยวซ้ำ
  // เที่ยวไปอยู่ขั้นอื่นแล้ว (บันทึกไปแล้วแต่ผลไม่กลับมา/เจ้าหน้าที่หยุดเที่ยว) = หยุด ไม่กดข้ามขั้นให้เอง
  // ⚠️ p_op ทุกคำสั่ง (#244) · ฐานข้อมูลตรวจ revision และบันทึกทั้งเที่ยวใน transaction เดียว
  const TRIP_ORDER = ['confirmed', 'outbound', 'hospital', 'returning', 'completed']
  function advanceTrip(trip, label) {
    return task(async call => {
      const fresh = await call('patient_booking_workspace', {})
      const latest = fresh?.trips?.find(t => t.id === trip.id)
      if (!latest) throw new Error('ไม่พบเที่ยวนี้แล้ว กรุณาโหลดข้อมูลล่าสุด')
      if (latest.driver_id !== trip.driver_id) throw new Error('คนขับประจำเที่ยวเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก')
      if (latest.state !== trip.state) return { moved: latest.state, ahead: TRIP_ORDER.indexOf(latest.state) > TRIP_ORDER.indexOf(trip.state) }
      const [step] = driverSteps(latest)
      if (!step) throw new Error('เที่ยวนี้ยังไม่พร้อมบันทึก กรุณาตรวจสถานะล่าสุด')
      const args = { p_entity: latest.id, p_revision: latest.revision, p_action: step.action, p_note: '' }
      await call('patient_booking_action', { ...args, p_op: op(JSON.stringify(args)) })
      return { done: true }
    }, out => {
      if (out?.moved) return out.ahead ? 'ขั้นนี้บันทึกไว้แล้ว หน้าจอแสดงขั้นถัดไปให้แล้ว' : `สถานะเที่ยวเปลี่ยนเป็น “${TRIP_STATUS[out.moved] || out.moved}” แล้ว ตรวจหน้าจออีกครั้ง`
      return label.includes('จบ') ? `บันทึกแล้ว · ${label} — เลขไมล์ใส่ครั้งเดียวตอนรถกลับถึงกองทุนหลังจบเที่ยวสุดท้ายของวัน` : `บันทึกแล้ว · ${label}`
    })
  }
  // เอกสารถึงกองทุน: ผู้รับหนังสือจากทะเบียนหน่วยงานรับเรื่องต่อ + ผู้ลงนามจากทะเบียนกลาง
  // (ทะเบียนเดียวกับหนังสือนำส่งของระบบเดิม ผู้ดูแลไม่ต้องตั้งค่าซ้ำ)
  // at = เวลาของเอกสาร ได้นายกที่ดำรงตำแหน่งตอนนั้น (เปลี่ยนนายกแล้วเอกสารเก่าต้องคงชื่อเดิม เจ้าของระบบสั่ง 2569-10-06)
  // ไม่ส่ง = นายกวันนี้ (สรุปตามช่วงเวลาออกตอนกดพิมพ์) · ไม่กรอง is_active — ต้องมีแถวที่ปิดไปแล้วด้วย ถึงจะหาผู้ลงนาม ณ เวลาของเอกสารได้ (pickSignatory แบบมี at)
  async function fundContext(at = null) {
    const partnerId = workspace?.settings?.partner_id
    const [partnerRes, signRes] = await Promise.all([
      partnerId ? supabase.from('referral_partners').select('name, recipient_title, address, phone').eq('id', partnerId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('document_signatories').select(SIGNATORY_REGISTRY_SELECT).eq('municipality_id', tenantId).eq('document_type', SIGNATORY_SCOPE),
    ])
    if (partnerRes.error) throw partnerRes.error
    const mayorRow = pickSignatory(signRes.data ?? [], { role: 'mayor', at })
    return { partner: partnerRes.data, mayor: mayorRow ? { name: signatoryName(mayorRow), title: signatoryTitle(mayorRow) } : null }
  }
  // ช่องลงนามท้ายใบคำขอถึงนายก (ผอ.กองสวัสดิการสังคม / ปลัด / นายก) — ชื่อดึงจากทะเบียน "ผู้ลงนามเอกสาร" เหมือนใบคำขอบริการอื่น
  // (loadPrintSignatories ใน StaffDashboard.jsx) โหลดตอนกดพิมพ์ ไม่ใช่ตอนเปิดรายการ · กองที่ถือเรื่อง: กองสวัสดิการสังคม ถ้าไม่มีใช้สำนักปลัด
  // อ่านไม่ได้หรือยังไม่ได้ตั้งผู้ลงนาม = ช่องลงนามเปล่าให้เขียนมือ ไม่ใช่ไม่มีช่อง และไม่ขวางการพิมพ์ (ใบเวียนเซ็นด้วยปากกาทุกใบ)
  async function requestSignContext(at = null) {
    const [deptRes, signRes] = await Promise.all([
      supabase.from('departments').select('id,code,name').eq('municipality_id', tenantId).order('sort_order'),
      supabase.from('document_signatories').select(SIGNATORY_REGISTRY_SELECT).eq('municipality_id', tenantId).eq('document_type', SIGNATORY_SCOPE),
    ])
    return resolvePatientRequestSignatories({ departments: deptRes.data ?? [], registry: signRes.data ?? [], at })
  }
  // เปิดหน้าต่างทันทีตอนกด แล้วค่อยเติมเนื้อหาหลังโหลดข้อมูล — เปิดหลัง await เบราว์เซอร์จะบล็อกเป็นป๊อปอัป
  async function printInNewWindow(build, failText, beforePrint) {
    const win = window.open('', '_blank', 'width=1100,height=900')
    if (!win) { setError('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาตป๊อปอัปของเว็บนี้'); return }
    win.document.write(buildPatientPrintLoadingHtml()); win.document.close()
    try {
      if (beforePrint && !await beforePrint()) { if (!win.closed) win.close(); return }
      if (win.closed) return
      const html = await build()
      if (win.closed) return
      writeAndPrint(win, html)
    } catch (e) {
      if (win.closed) return
      win.close(); setError(`${failText}: ${e.message || 'กรุณาลองใหม่'}`)
    }
  }
  // สองปุ่มพิมพ์เอกสารแยกรายคน: ใบคำขอประชาชนถึงนายก และหนังสือนายกถึงกองทุน
  const printBooking = booking => ({ ...booking, purpose_label: workspace?.community_rules?.activities?.find(a => a.code === booking.purpose_code)?.label || booking.purpose_code })
  // ผู้ลงนามของทั้งชุด (ใบคำขอ + หนังสือนำส่ง) = ตอนบันทึกเลขหนังสือ ยังไม่บันทึก = คนปัจจุบัน (bookingLetterMoment)
  const printLetter = (booking, beforePrint) => printInNewWindow(async () => (isCommunity(booking) ? buildCommunityForwardLetterHtml : buildBookingForwardLetterHtml)({
    tenant, trip: workspace.trips.find(t => t.id === booking.trip_id), booking: printBooking(booking),
    ...(await fundContext(bookingLetterMoment(booking, workspace.trips.find(t => t.id === booking.trip_id)))),
    // ต้องเป็น URL เต็ม หน้าต่างพิมพ์เป็น about:blank พาธ /images/... จะ resolve ไม่เจอ
    emblemUrl: `${window.location.origin}/images/garuda.svg`,
  }), 'เตรียมหนังสือนำส่งไม่สำเร็จ', beforePrint)
  // ใบคำขอพิมพ์แยกได้ทั้งก่อนและหลังยืนยันรถ โดยใช้ข้อมูลเที่ยวปัจจุบันเมื่อมีแล้ว
  const printRequest = booking => printInNewWindow(async () => (isCommunity(booking) ? buildCommunityRequestFormHtml : buildBookingRequestFormHtml)({
    tenant, booking: printBooking(booking), trip: workspace.trips.find(t => t.id === booking.trip_id),
    ...(await fundContext(bookingLetterMoment(booking, workspace.trips.find(t => t.id === booking.trip_id)))),
    // ใบคำขอชุมชนเป็นเอกสารร่างอีกชุด ไม่อยู่ในคำสั่งช่องลงนาม 3 ตำแหน่ง
    ...(isCommunity(booking) ? {} : await requestSignContext(bookingLetterMoment(booking, workspace.trips.find(t => t.id === booking.trip_id)))),
  }), 'เตรียมใบคำขอไม่สำเร็จ')
  const printPeriod = (period, service) => printInNewWindow(async () => {
    const [data, context] = await Promise.all([servicePeriodReport(async (name, args) => {
      const result = await supabase.rpc(name, { p_muni: tenantId, ...args }); if (result.error) throw result.error; return result.data
    }, period.from, period.to, service), fundContext()])
    return buildTripMonthReportHtml({ tenant, report: data, period, partner: context.partner })
  }, 'เตรียมสรุปตามช่วงเวลาไม่สำเร็จ')
  // เลขไมล์เหมาเป็นวัน: day = แถวของวันนั้น (revision 0 = ยังไม่เคยบันทึก) · ค่าเก่าทับค่าใหม่ไม่ได้ ฐานข้อมูลตอบ "เปลี่ยนแล้ว" แล้วโหลดใหม่
  const recordOdometer = (day, start, end, issue, reason) => mutate('patient_booking_save_day_odometer', { p_day: day.date, p_revision: day.revision ?? 0, p_start: start, p_end: end, p_issue: issue, p_note: reason }, 'บันทึกเลขไมล์ประจำวันแล้ว')
  const reassignDriver = ({ trip, day, fromDriver, driver, expected, midtrip }) => mutate('patient_booking_reassign_driver', {
    p_op: op(`driver-cover:${JSON.stringify({ trip, day, fromDriver, driver, expected, midtrip })}`),
    p_trip: trip, p_day: day, p_from_driver: fromDriver, p_driver: driver, p_expected: expected, p_midtrip: midtrip,
  }, 'เปลี่ยนคนขับแล้ว · ผู้เกี่ยวข้องได้รับแจ้ง กรุณาตรวจเอกสารล่าสุด')
  // เลขหนังสือแยกรายคน (20261002130100) — ส่ง letter_revision ที่หน้าจอเห็นมาด้วย ไม่ตรง = มีคนแก้ไปก่อน ฐานข้อมูลปฏิเสธ
  const recordLetter = (booking, letterNo, letterDate) => mutate('patient_booking_record_booking_letter', { p_booking: booking.id, p_letter_revision: booking.letter_revision ?? 0, p_letter_no: letterNo, p_letter_date: letterDate }, 'บันทึกเลขหนังสือนำส่งแล้ว')
  const reschedule = args => task(call => call('patient_booking_reschedule', { ...args, p_op: op(`reschedule:${JSON.stringify(args)}`) }), out => out?.saved ? 'เปลี่ยนวันเวลาแล้ว ปฏิทินและงานคนขับใช้คิวใหม่แล้ว' : '')
  const updateSchedule = (trip, revision, publicNotice, pickup, back) => mutate('patient_booking_update_schedule', { p_trip: trip, p_revision: revision, p_notice: publicNotice, p_pickup: pickup, p_return: back }, 'บันทึกประกาศและเวลาประมาณการแล้ว')
  // ปุ่มหลักของกล่อง อยู่ในแถบเครื่องมือที่เดียวกับปุ่ม "รับแจ้งที่เคาน์เตอร์" ของคำร้อง
  // จอมือถือใช้ชื่อสั้น ไม่งั้นปุ่มเบียดช่องค้นหาจนเหลือแค่ไอคอน
  const intakeButton = <button className={primaryClass} disabled={busy || !info?.enabled} onClick={() => setView('book')}><span className="sm:hidden">+ รับจองแทน</span><span className="hidden sm:inline">+ รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์</span></button>
  return <div className={embedded ? 'text-slate-900' : 'mx-auto min-h-screen max-w-5xl bg-white px-4 py-6 text-slate-900'}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{!embedded && <Link to="/staff" className={`${buttonClass} inline-flex items-center`}>← หน้าเจ้าหน้าที่</Link>}<Link to="/patient-transport" className={`${buttonClass} inline-flex items-center gap-2`}><Users size={16} />หน้าประชาชน</Link></div><button className={`${buttonClass} inline-flex items-center gap-2`} onClick={reload} disabled={busy}><RefreshCw size={16} />โหลดข้อมูลล่าสุด</button></div>
    {!embedded && <header className="mb-4"><p className="text-sm font-semibold text-sky-800">{tenant?.name} · งานเจ้าหน้าที่</p><h1 className="mt-1 text-2xl font-bold">รถรับส่งผู้ป่วย</h1></header>}
    {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
    {!current && !error && <p role="status">กำลังโหลดข้อมูลงาน…</p>}
    {/* บัญชีเจ้าหน้าที่ที่ไม่ได้อยู่ในทะเบียนผู้จัดคิว/คนขับของโมดูลนี้ ใช้บริการฝั่งประชาชนได้ตามปกติ */}
    {current && !allowed && <div className="rounded-xl bg-amber-50 p-4"><p className="font-semibold">บัญชีนี้ยังไม่ได้รับมอบหมายงานรถรับส่งผู้ป่วย</p>
      <p className="mt-2 text-sm">ให้ผู้ดูแลเพิ่มบัญชีนี้เป็นผู้จัดคิวหรือคนขับในหน้าตั้งค่าก่อน ระหว่างนี้ใช้หน้าประชาชนเพื่อจองรถได้ตามปกติ</p>
      <Link to="/patient-transport" className={`${primaryClass} mt-4 inline-flex items-center`}>ไปหน้าประชาชน</Link></div>}
    {current && allowed && <>
      {isDriver && view !== 'driver' && driverWorkCount > 0 && <section aria-label="งานคนขับรอดำเนินการ" className="mb-4 flex flex-col gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-slate-950 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500"><Car size={24} aria-hidden="true" /></span><div><p className="font-bold">มีงานคนขับ {driverWorkCount} รายการ</p><p className="text-sm">เที่ยวที่ต้องไปหรือวันที่รอเลขไมล์ปิดวัน</p></div></div>
        <button type="button" className="min-h-12 w-full rounded-xl bg-amber-500 px-5 py-3 text-center font-bold text-slate-950 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 disabled:opacity-50 sm:w-auto" disabled={busy} onClick={() => { setCalendarBookingId(null); setView('driver') }}>ไปแท็บงานคนขับ →</button>
      </section>}
      <div className="[&>nav]:flex-wrap [&>nav]:overflow-visible [&>nav>button]:min-h-11 [&>nav>button]:px-3 sm:[&>nav>button]:px-4"><TabBar tab={view} setTab={tab => { setCalendarBookingId(null); setView(tab) }} tabs={tabs} busy={busy} /></div>
      {!info?.enabled && <p className="mb-4 rounded-xl bg-amber-50 p-4">{isAdmin ? 'ยังไม่เปิดรับจองออนไลน์ ตั้งค่ารถ คนขับ ผู้จัดคิว เส้นทางและเวลาให้บริการในแท็บ “ตั้งค่า” ก่อนเปิดบริการ' : 'ยังไม่เปิดรับจองออนไลน์ ให้ผู้ดูแลตั้งค่ารถและเปิดบริการก่อน'}</p>}
      {/* ฐานข้อมูลส่งรายการให้หน้านี้ได้ไม่เกิน WORKSPACE_ROW_LIMIT คำขอ/เที่ยว ตัดคำขอที่นัดไกลสุดทิ้งก่อน — ถึงเพดานแล้วต้องบอก ห้ามหายเงียบ (ดู workspaceTruncated) */}
      {['inbox', 'calendar', 'driver'].includes(view) && workspaceTruncated(workspace) && <div role="alert" className="mb-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950">
        <p className="font-bold">รายการเกินที่หน้านี้แสดงได้</p>
        <p className="text-sm">หน้านี้แสดงได้สูงสุด {WORKSPACE_ROW_LIMIT.toLocaleString('th-TH')} คำขอและ {WORKSPACE_ROW_LIMIT.toLocaleString('th-TH')} เที่ยว ตอนนี้ถึงเพดานแล้ว คำขอที่นัดไกลที่สุดอาจไม่แสดง ข้อมูลในระบบยังอยู่ครบ กรุณาแจ้งผู้ดูแลระบบ</p>
      </div>}
      {(view === 'inbox' || (view === 'calendar' && calendarBookingId)) && isCoordinator && <BookingInbox key={calendarBookingId || 'inbox'} workspace={{ ...workspace, public_info: info }} busy={busy} error={error} isAdmin={isAdmin} action={intakeButton}
        detailOnly={view === 'calendar'} initialOpenId={calendarBookingId} onCloseBooking={() => setCalendarBookingId(null)}
        currentUserId={uid} onOpenDriver={() => { setCalendarBookingId(null); setView('driver') }}
        created={created} onClearCreated={() => setCreated(null)} onDelete={deleteBooking} onConfirm={confirm} onJoin={joinIntoTrip} onAction={action} onRemove={removePassenger} onAmend={amend} onUpdatePickup={updatePickup}
        onRecordLetter={recordLetter} onPrintLetter={printLetter} onPrintRequest={printRequest} onOdometer={recordOdometer} onReschedule={reschedule} onUpdateSchedule={updateSchedule}
        onReload={reload} onSettings={() => setView('settings')} />}
      {view === 'calendar' && isCoordinator && <StaffBookingCalendar workspace={workspace} onOpenBooking={setCalendarBookingId} />}
      {view === 'report' && isCoordinator && <QueueReport workspace={workspace} busy={busy} onPeriodReport={printPeriod} />}
      {/* รับจองแทนมีที่นี่ที่เดียว และส่ง p_staff_entry ให้ฐานข้อมูลบันทึกว่าเป็นการรับเรื่องแทน
          ส่งแล้วกลับกล่องคำขอพร้อมแถบ "ยืนยันรถเลย" — ไม่ต้องไล่หาแถวที่เพิ่งรับเอง */}
      {view === 'book' && isCoordinator && info?.enabled && <>
        {info.community?.enabled && <div role="group" aria-label="เลือกบริการรับจองแทน" className="my-4 flex flex-wrap gap-2"><button type="button" className={intakeService === 'patient' ? primaryClass : buttonClass} onClick={() => setIntakeService('patient')}>รับจองผู้ป่วย</button><button type="button" className={intakeService === 'community' ? primaryClass : buttonClass} onClick={() => setIntakeService('community')}>รับจองชุมชน</button></div>}
        {intakeService === 'community' ? info.community?.enabled ? <CommunityBookingForm submitError={error} tenantId={tenantId} info={info} staffEntry busy={busy} onBack={() => setView('inbox')}
          onSubmit={(id, payload) => mutate('patient_booking_submit_community', { p_id: id, p_data: payload, p_staff: true }, '', data => { setCreated({ id: String(data || id), name: bookingName({ ...payload, service_type: 'community' }) }); setView('inbox') })} />
          : <section role="status" className="space-y-3 rounded-xl bg-amber-50 p-4"><p>บริการชุมชนปิดรับคำขอใหม่แล้ว คำขอที่รับไว้ยังดำเนินต่อได้</p><button className={buttonClass} onClick={() => setView('inbox')}>กลับไปดูคำขอรถ</button></section>
          : <BookingForm submitError={error} tenantId={tenantId} info={info} profileName={profileName} profilePhone={workspace?.my_profile?.phone} staffEntry busy={busy} onBack={() => setView('inbox')}
        onSubmit={(id, payload, tripId) => mutate(tripId ? 'patient_booking_submit_join' : 'patient_booking_submit', { p_id: id, p_data: payload, p_staff_entry: true, ...(tripId ? { p_trip: tripId } : {}) }, '', data => { setCreated({ id: String(data || id), name: payload.patient_name }); setView('inbox') })} />}
      </>}
      {view === 'driver' && (isCoordinator || isDriver) && <DriverTrips workspace={workspace} uid={uid} isAdmin={isAdmin} canAssign={isCoordinator} busy={busy} error={error} contactPhone={info?.contact_phone} onAdvance={advanceTrip} onAction={action} onOdometer={recordOdometer} onReassign={reassignDriver} />}
      {view === 'settings' && isAdmin && <TransportSettings workspace={workspace} busy={busy}
        onSavePatient={(revision, form) => mutate('patient_booking_save_settings', { p_revision: revision, p_data: form }, 'บันทึกค่าตั้งต้นแล้ว')}
        onSaveCommunity={(revision, form) => mutate('patient_booking_save_community_rules', { p_revision: revision, p_data: form }, 'บันทึกกฎบริการชุมชนแล้ว')} />}
      {workspace?.limited && <p className="mt-4 rounded-xl bg-amber-50 p-3">รายการเกินขอบเขตหน้าจอ กรุณาติดต่อผู้ดูแลก่อนจัดคิวเพิ่มเติม</p>}
    </>}
    {/* ผลของการกดอยู่ติดขอบล่างจอ — กดจากแถวท้ายตารางแล้วยังเห็นว่าสำเร็จ ไม่ต้องเลื่อนขึ้นไปหา
        หายเองใน 5 วินาที และกดทะลุได้ (pointer-events-none) ไม่บังปุ่มใหญ่ของคนขับที่อยู่ข้างใต้ */}
    {notice && <div role="status" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl items-start gap-3 rounded-xl bg-emerald-700 p-4 text-white shadow-2xl">
      <p className="min-w-0 flex-1">{notice}</p>
      <button type="button" className="pointer-events-auto shrink-0 rounded-full p-1 hover:bg-white/20" aria-label="ปิดข้อความ" onClick={() => setNotice('')}><X size={18} /></button>
    </div>}
  </div>
}
