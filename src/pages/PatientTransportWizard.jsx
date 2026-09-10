import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, Loader2, PhoneCall, Printer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { NAME_TITLES, splitThaiFullName } from '../lib/thaiName'
import { toDateStr } from '../lib/thaiDate'
import {
  APPOINTMENT_KINDS, MOBILITY_LEVELS, PATIENT_TRANSPORT_CONSENT_VERSION, PATIENT_TRANSPORT_TYPE,
  REQUESTER_RELATIONS, TRIP_TYPES, buildPatientTransportConsentText,
} from '../lib/patientTransport'
import { buildPatientTransportFormHtml } from '../lib/patientTransportPrint'

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-200'

// ยื่นล่วงหน้าได้ไกลสุดเท่าที่ RPC รับ (create_patient_transport_request) — เกินนี้ใบนัดมักยังไม่ออก
const MAX_AHEAD_DAYS = 180

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toDateStr(date)
}

function Field({ label, required, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-semibold text-gray-500">
        {label}{required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{hint}</p>}
    </div>
  )
}

function ChoiceGroup({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(option => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}
          className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
            value === option.value
              ? 'border-red-600 bg-red-600 text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * คำขออนุเคราะห์รถรับ-ส่งผู้ป่วย — อปท. รับเรื่องแล้วออกหนังสือนำส่งให้หน่วยงานภายนอก
 * (referral_partners เช่น กองทุนสวัสดิการชุมชนตำบล) เป็นผู้พิจารณาและจัดรถเอง
 *
 * ⚠️ ไม่ใช่ช่องทางเรียกรถฉุกเฉิน — ขั้นแรกบังคับตอบว่าไม่ฉุกเฉินก่อนจึงเห็นฟอร์ม และ RPC
 * ปฏิเสธคำขอที่ไม่ได้ยืนยัน is_emergency = false มาเอง (fail closed)
 *
 * ⚠️ PDPA: วันนัด/ประเภทนัด/การเคลื่อนไหวเป็นข้อมูลสุขภาพ (ข้อมูลอ่อนไหว) — ตั้งใจไม่มีช่อง
 * อาการ/ชื่อโรคแบบพิมพ์อิสระ และต้องติ๊กยินยอมที่ระบุชื่อผู้รับข้อมูลก่อนยื่นทุกครั้ง
 *
 * ⚠️ ห้ามเขียนข้อความใดที่ทำให้เข้าใจว่ายื่นแล้วได้รถแน่นอน — หน่วยงานปลายทางพิจารณาตาม
 * ระเบียบของตัวเอง (กองทุนสวัสดิการชุมชนโดยทั่วไปให้สิทธิ์เฉพาะสมาชิก)
 */
export default function PatientTransportWizard({ tenant, session, onBack, staffId, onDone }) {
  const navigate = useNavigate()
  const canUse = Boolean(session || staffId)
  const [partners, setPartners] = useState(null)
  const [partnerId, setPartnerId] = useState('')
  const [emergency, setEmergency] = useState(null)
  const [showBeneficiary, setShowBeneficiary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(null)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({
    title: '', first: '', last: '', phone: '', addr_no: '', addr_moo: '',
    relation: 'self', relation_note: '',
    patient_name: '', patient_age: '',
    fund_member_no: '', beneficiary_of_name: '', beneficiary_of_member_no: '',
    pickup_address: '', pickup_landmark: '',
    destination: '', destination_detail: '',
    appt_date: '', appt_time: '',
    trip_type: 'round_trip', return_note: '',
    appointment_kind: '', appointment_kind_note: '',
    mobility: '', companions: '0',
    consent: false,
  })

  useEffect(() => {
    if (!tenant?.id || !canUse) return undefined
    let cancelled = false
    supabase.from('referral_partners')
      // recipient_title ใช้กับบรรทัด "เรียน" ของใบคำขอที่พิมพ์ทันทีหลังยื่น
      .select('id, name, recipient_title, phone, min_lead_days')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .contains('document_types', [PATIENT_TRANSPORT_TYPE])
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        const list = error ? [] : (data ?? [])
        setPartners(list)
        if (list.length === 1) setPartnerId(list[0].id)
      })
    return () => { cancelled = true }
  }, [tenant?.id, canUse])

  useEffect(() => {
    if (!session) return
    supabase.from('profiles')
      .select('full_name, phone, address_detail, address_moo')
      .eq('id', session.user.id)
      .single()
      .then(({ data: profile }) => {
        if (!profile) return
        const { title, first, last } = splitThaiFullName(profile.full_name)
        setForm(current => ({
          ...current,
          title,
          first,
          last,
          phone: profile.phone ?? '',
          addr_no: profile.address_detail ?? '',
          addr_moo: profile.address_moo ?? '',
        }))
      })
  }, [session])

  const set = key => event => {
    const value = event.target.value
    setForm(current => ({ ...current, [key]: value }))
  }
  const choose = key => value => setForm(current => ({ ...current, [key]: value }))

  const partner = partners?.find(item => item.id === partnerId) ?? null
  const today = toDateStr()
  // เจ้าหน้าที่รับเรื่องแทนหน้าเคาน์เตอร์ได้รับยกเว้นระยะยื่นล่วงหน้า (ตรงกับเงื่อนไขใน RPC)
  // — เคสกระชั้นที่เจ้าหน้าที่ประสานหน่วยงานผู้จัดรถทางโทรศัพท์ไว้แล้ว
  const minDate = addDays(today, staffId ? 0 : (partner?.min_lead_days ?? 3))
  const maxDate = addDays(today, MAX_AHEAD_DAYS)
  const requesterName = `${form.title}${form.first} ${form.last}`.trim()
  const onBehalf = form.relation !== 'self'
  const requesterAddress = [
    form.addr_no.trim() && `บ้านเลขที่ ${form.addr_no.trim()}`,
    form.addr_moo.trim() && `หมู่ที่ ${form.addr_moo.trim()}`,
  ].filter(Boolean).join(' ')
  const consentText = partner
    ? buildPatientTransportConsentText({ tenantName: tenant?.name, partnerName: partner.name, onBehalf })
    : ''
  const phoneDigits = form.phone.replace(/\D/g, '')
  const age = form.patient_age === '' ? null : Number(form.patient_age)

  const isValid = Boolean(
    emergency === 'no'
    && partner
    && form.title && form.first.trim() && form.last.trim()
    && phoneDigits.length >= 9 && phoneDigits.length <= 15
    && (form.relation !== 'other' || form.relation_note.trim())
    && (!onBehalf || form.patient_name.trim())
    && (age === null || (Number.isInteger(age) && age >= 0 && age <= 130))
    && form.pickup_address.trim()
    && form.destination.trim()
    && form.appt_date && form.appt_date >= minDate && form.appt_date <= maxDate
    && form.appt_time
    && form.appointment_kind
    && (form.appointment_kind !== 'other' || form.appointment_kind_note.trim())
    && form.mobility
    && form.consent,
  )

  async function handleSubmit() {
    if (!isValid || saving) return
    setSaving(true)
    setSubmitError('')
    const requestId = crypto.randomUUID()
    // ⚠️ ช่องทางการลงชื่อตัดสินจาก "มี session ของผู้ยื่นเองหรือไม่" เท่านั้น — เจ้าหน้าที่ที่
    // กรอกแทนหน้าเคาน์เตอร์ใช้บัญชีตัวเอง ใบพิมพ์ต้องเว้นช่องให้เซ็นด้วยปากกา ไม่พิมพ์ชื่อแทน
    const channel = session && !staffId ? 'online' : 'counter'

    // แยก payload ออกมาเป็นตัวแปร เพื่อเอาชุดเดียวกันไปสร้างใบพิมพ์ในจอ "ยื่นสำเร็จ" ได้
    // โดยไม่ต้องอ่านกลับจากฐานข้อมูล (ฝั่งเคาน์เตอร์ต้องพิมพ์ใบให้ประชาชนเซ็นทันที)
    const payload = {
      is_emergency: false,
      consent_given: true,
      consent_version: PATIENT_TRANSPORT_CONSENT_VERSION,
      consent_text: consentText,
      staff_entry: Boolean(staffId),
      partner_id: partner.id,
      requester_name: requesterName,
      requester_phone: form.phone.trim(),
      requester_address: requesterAddress,
      requester_relation: form.relation,
      requester_relation_note: form.relation === 'other' ? form.relation_note.trim() : '',
      patient_name: onBehalf ? form.patient_name.trim() : requesterName,
      patient_age: age,
      fund_member_no: form.fund_member_no.trim(),
      beneficiary_of_name: showBeneficiary ? form.beneficiary_of_name.trim() : '',
      beneficiary_of_member_no: showBeneficiary ? form.beneficiary_of_member_no.trim() : '',
      pickup_address: form.pickup_address.trim(),
      pickup_landmark: form.pickup_landmark.trim(),
      destination: form.destination.trim(),
      destination_detail: form.destination_detail.trim(),
      // ระบุ +07:00 ตรงๆ — เวลาที่ผู้ใช้เลือกคือเวลาไทยเสมอ ไม่ว่าเครื่องจะตั้งโซนเวลาอะไรไว้
      appointment_at: `${form.appt_date}T${form.appt_time}:00+07:00`,
      trip_type: form.trip_type,
      return_note: form.trip_type === 'round_trip' ? form.return_note.trim() : '',
      appointment_kind: form.appointment_kind,
      appointment_kind_note: form.appointment_kind === 'other' ? form.appointment_kind_note.trim() : '',
      mobility: form.mobility,
      companions: Number(form.companions) || 0,
      signed_by: {
        channel,
        name: requesterName,
        user_id: channel === 'online' ? (session?.user?.id ?? null) : null,
        entered_by_staff_id: staffId ?? null,
      },
    }

    const { error } = await supabase.rpc('create_patient_transport_request', {
      p_request_id: requestId,
      p_payload: payload,
    })

    setSaving(false)
    if (error) {
      // ข้อความจาก RAISE EXCEPTION ในฟังก์ชันเป็นภาษาไทยอยู่แล้ว แสดงตรงๆ ได้
      setSubmitError(error.message)
      return
    }
    notifyTelegram('document_request_created', requestId)
    // signed_at ฝั่ง DB ถูกตั้งเป็น now() ของเซิร์ฟเวอร์ ที่เก็บไว้ตรงนี้เป็นเวลาของเครื่องผู้ใช้
    // ต่างกันไม่เกินไม่กี่วินาที ใช้ได้เฉพาะกับใบที่พิมพ์ทันทีในจอนี้ ใบที่พิมพ์ภายหลังอ่านค่าจริงจาก DB
    setDone({
      ref: requestId.slice(0, 8).toUpperCase(),
      partnerName: partner.name,
      payload,
      partner,
      signedAt: new Date().toISOString(),
    })
  }

  // ต้องล็อกอิน — มีข้อมูลสุขภาพและต้องให้ความยินยอมส่งต่อหน่วยงานภายนอก จึงต้องรู้ตัวผู้ให้
  // ความยินยอม และให้ผู้ยื่นยกเลิก (ถอนความยินยอม) เองได้จากหน้า "เอกสารของฉัน" (RLS ผูก user_id)
  if (!canUse) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-3xl">🚑</div>
          <h2 className="mb-2 text-lg font-bold text-gray-800">เข้าสู่ระบบก่อนยื่นคำขอ</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-500">
            คำขอนี้มีข้อมูลการรักษาของผู้ป่วยและต้องส่งต่อให้หน่วยงานผู้จัดรถ
            จึงต้องเข้าสู่ระบบเพื่อยืนยันตัวผู้ให้ความยินยอม และให้ท่านติดตามหรือยกเลิกคำขอได้เอง
          </p>
          <button type="button"
            onClick={() => navigate('/auth', { state: { from: `/doc-request?type=${PATIENT_TRANSPORT_TYPE}` } })}
            className="w-full rounded-2xl bg-red-700 py-3.5 text-sm font-bold text-white">
            เข้าสู่ระบบ / สมัครสมาชิก
          </button>
          <button type="button" onClick={onBack}
            className="mt-2 w-full rounded-2xl py-3 text-sm font-semibold text-gray-500">
            ย้อนกลับ
          </button>
        </div>
      </div>
    )
  }

  // พิมพ์ใบคำขอทันทีหลังยื่น — จำเป็นกับกรณีเจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ ซึ่งต้องให้ประชาชน
  // เซ็นชื่อบนใบทันที (ใบโหมดนี้เว้นเส้นลงนามไว้เสมอ ไม่พิมพ์ชื่อแทน)
  // ⚠️ ใบนี้ไม่ใช่หนังสือนำส่งของ อปท. — หนังสือนำส่งออกจากแผงเจ้าหน้าที่หลังตรวจสอบแล้วเท่านั้น
  function handlePrintForm() {
    const w = window.open('', '_blank', 'width=860,height=1100')
    if (!w) return
    w.document.write(buildPatientTransportFormHtml({
      header: {
        partner_name_snapshot: done.partner?.name ?? done.partnerName,
        recipient_title_snapshot: done.partner?.recipient_title ?? '',
        appointment_at: done.payload.appointment_at,
        mobility: done.payload.mobility,
      },
      form: { ...done.payload, signed_at: done.signedAt },
      parent: {
        requester_name: done.payload.requester_name,
        requester_phone: done.payload.requester_phone,
        requester_address: done.payload.requester_address,
      },
      tenant,
      referenceNo: done.ref,
      docDate: done.signedAt,
    }))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-800">ยื่นคำขอสำเร็จ</h2>
          {/* ⚠️ ห้ามเขียนทำนองว่า "ได้รถแล้ว" — ยังต้องผ่านการพิจารณาของหน่วยงานผู้จัดรถ */}
          <p className="mb-5 text-sm leading-relaxed text-gray-500">
            เจ้าหน้าที่จะตรวจสอบข้อมูลแล้วส่งต่อให้ {done.partnerName} พิจารณาตามระเบียบของหน่วยงาน
            ติดตามผลได้ที่หน้า “เอกสารของฉัน”
          </p>
          <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 p-4 text-left text-xs leading-relaxed text-red-900">
            หากผู้ป่วยอาการทรุดลงหรือเกิดเหตุฉุกเฉินระหว่างรอ อย่ารอคำขอนี้ — โทร 1669 ทันที
          </div>
          <div className="mb-5 rounded-2xl bg-gray-50 p-4">
            <p className="mb-1.5 text-xs text-gray-400">หมายเลขอ้างอิง</p>
            <p className="text-2xl font-bold tracking-widest text-gray-800">{done.ref}</p>
            <button type="button"
              onClick={() => { navigator.clipboard.writeText(done.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="mx-auto mt-2.5 flex items-center gap-1.5 text-xs text-blue-600">
              {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกเลขอ้างอิง'}
            </button>
          </div>
          <div className="space-y-2.5">
            {!staffId && (
              <button type="button" onClick={() => navigate('/my-docs')}
                className="w-full rounded-2xl bg-red-700 py-3.5 text-sm font-bold text-white">
                ดูสถานะที่ “เอกสารของฉัน”
              </button>
            )}
            <button type="button" onClick={handlePrintForm}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700">
              <Printer size={15} /> พิมพ์ใบคำขอรับสวัสดิการ
            </button>
            <button type="button" onClick={() => (onDone ? onDone() : navigate('/'))}
              className="w-full rounded-2xl py-3 text-sm font-semibold text-gray-500">
              {onDone ? 'เสร็จสิ้น - กลับไปที่คำขอ' : 'กลับหน้าหลัก'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3 shadow-sm">
        <button type="button" onClick={onBack} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100">
          <ArrowLeft size={18} />
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-xl">🚑</span>
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-800">ขออนุเคราะห์รถรับ-ส่งผู้ป่วย</p>
            <p className="text-xs text-gray-400">สำหรับการเดินทางไปตามนัดที่ไม่ฉุกเฉิน</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 pb-10 md:px-8">
        <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-xs leading-relaxed text-red-900">
          {tenant?.name ?? 'อปท.'} รับคำขอนี้แล้วส่งต่อให้หน่วยงานผู้จัดรถเป็นผู้พิจารณาตามระเบียบของหน่วยงานนั้น
          (กองทุนสวัสดิการชุมชนโดยทั่วไปให้สิทธิ์เฉพาะสมาชิก) — การยื่นคำขอไม่ใช่การยืนยันว่าจะได้รถ
        </div>

        <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">ผู้ป่วยต้องไปโรงพยาบาลด่วนตอนนี้หรือไม่?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setEmergency('yes')}
              className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
                emergency === 'yes' ? 'border-red-600 bg-red-600 text-white' : 'border-red-200 bg-white text-red-700'
              }`}>
              ใช่ ฉุกเฉิน ต้องไปเดี๋ยวนี้
            </button>
            <button type="button" onClick={() => setEmergency('no')}
              className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
                emergency === 'no' ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 bg-white text-gray-700'
              }`}>
              ไม่ฉุกเฉิน เป็นการไปตามนัดล่วงหน้า
            </button>
          </div>
        </section>

        {emergency === 'yes' && (
          <section className="space-y-3 rounded-2xl border-2 border-red-600 bg-white p-5 text-center shadow-sm">
            <AlertTriangle size={30} className="mx-auto text-red-600" />
            <p className="text-base font-bold text-red-700">กรณีฉุกเฉิน โทร 1669 ทันที ไม่ต้องยื่นคำขอนี้</p>
            <p className="text-xs leading-relaxed text-gray-600">
              เช่น หมดสติ หายใจลำบาก เจ็บหน้าอกรุนแรง แขนขาอ่อนแรงทันที เลือดออกไม่หยุด หรือได้รับอุบัติเหตุ
              — ระบบนี้ต้องผ่านเจ้าหน้าที่และหน่วยงานผู้จัดรถหลายขั้น ไม่ทันเหตุฉุกเฉิน
            </p>
            <a href="tel:1669"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-4 text-lg font-bold text-white">
              <PhoneCall size={20} /> โทร 1669
            </a>
          </section>
        )}

        {emergency === 'no' && partners === null && (
          <div className="flex justify-center py-10">
            <Loader2 size={26} className="animate-spin text-gray-300" />
          </div>
        )}

        {emergency === 'no' && partners?.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center text-sm leading-relaxed text-gray-600">
            {tenant?.name ?? 'อปท.'} ยังไม่เปิดรับคำขอนี้ผ่านระบบ กรุณาติดต่อสำนักงานโดยตรง
          </div>
        )}

        {emergency === 'no' && partners?.length > 0 && (
          <>
            {partners.length > 1 && (
              <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <Field label="หน่วยงานผู้จัดรถ" required>
                  <select value={partnerId} onChange={event => setPartnerId(event.target.value)} className={inputCls}>
                    <option value="">เลือกหน่วยงาน</option>
                    {partners.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
              </section>
            )}

            <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-sm font-bold text-gray-700">ผู้ยื่นคำขอ</p>
              <div className="grid grid-cols-12 gap-2">
                <Field label="คำนำหน้า" required className="col-span-4 sm:col-span-3">
                  <select value={form.title} onChange={set('title')} className={inputCls}>
                    <option value="">เลือก</option>
                    {NAME_TITLES.map(title => <option key={title} value={title}>{title}</option>)}
                  </select>
                </Field>
                <Field label="ชื่อ" required className="col-span-8 sm:col-span-4">
                  <input value={form.first} onChange={set('first')} className={inputCls} />
                </Field>
                <Field label="นามสกุล" required className="col-span-12 sm:col-span-5">
                  <input value={form.last} onChange={set('last')} className={inputCls} />
                </Field>
              </div>
              <Field label="เบอร์โทรศัพท์สำหรับติดต่อ" required
                hint="หน่วยงานผู้จัดรถจะโทรนัดเวลารับตามเบอร์นี้">
                <input type="tel" inputMode="tel" value={form.phone} onChange={set('phone')}
                  placeholder="08x-xxx-xxxx" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="บ้านเลขที่">
                  <input value={form.addr_no} onChange={set('addr_no')} className={inputCls} />
                </Field>
                <Field label="หมู่ที่">
                  <input value={form.addr_moo} onChange={set('addr_moo')} className={inputCls} />
                </Field>
              </div>
              <Field label="ความเกี่ยวข้องกับผู้ป่วย" required>
                <ChoiceGroup options={REQUESTER_RELATIONS} value={form.relation} onChange={choose('relation')} />
              </Field>
              {form.relation === 'other' && (
                <Field label="ระบุความเกี่ยวข้อง" required>
                  <input value={form.relation_note} onChange={set('relation_note')} maxLength={100}
                    placeholder="เช่น เพื่อนบ้าน, อสม." className={inputCls} />
                </Field>
              )}
            </section>

            <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-sm font-bold text-gray-700">ผู้ป่วย</p>
              {onBehalf ? (
                <Field label="ชื่อ-สกุลผู้ป่วย" required>
                  <input value={form.patient_name} onChange={set('patient_name')} maxLength={200}
                    placeholder="เช่น นางสมศรี ใจดี" className={inputCls} />
                </Field>
              ) : (
                <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
                  ผู้ป่วย: {requesterName || 'ชื่อผู้ยื่นคำขอ'}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="อายุ (ปี)">
                  <input type="number" inputMode="numeric" min={0} max={130} value={form.patient_age}
                    onChange={set('patient_age')} className={inputCls} />
                </Field>
                <Field label="เลขที่สมาชิกกองทุน (ถ้าทราบ)">
                  <input value={form.fund_member_no} onChange={set('fund_member_no')} maxLength={40}
                    className={inputCls} />
                </Field>
              </div>
              <label className="flex items-start gap-2 text-xs leading-relaxed text-gray-600">
                <input type="checkbox" checked={showBeneficiary}
                  onChange={event => setShowBeneficiary(event.target.checked)} className="mt-0.5" />
                ผู้ป่วยไม่ได้เป็นสมาชิกเอง แต่เป็นผู้รับผลประโยชน์ของสมาชิก
              </label>
              {showBeneficiary && (
                <div className="grid grid-cols-12 gap-2">
                  <Field label="ชื่อสมาชิก" className="col-span-12 sm:col-span-7">
                    <input value={form.beneficiary_of_name} onChange={set('beneficiary_of_name')} maxLength={200}
                      className={inputCls} />
                  </Field>
                  <Field label="เลขที่สมาชิก" className="col-span-12 sm:col-span-5">
                    <input value={form.beneficiary_of_member_no} onChange={set('beneficiary_of_member_no')}
                      maxLength={40} className={inputCls} />
                  </Field>
                </div>
              )}
            </section>

            <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-sm font-bold text-gray-700">การเดินทาง</p>
              <Field label="ที่อยู่จุดรับผู้ป่วย" required>
                <textarea value={form.pickup_address} onChange={set('pickup_address')} rows={2} maxLength={500}
                  placeholder="บ้านเลขที่ หมู่ที่ ซอย/ถนน" className={inputCls} />
              </Field>
              <Field label="จุดสังเกต">
                <input value={form.pickup_landmark} onChange={set('pickup_landmark')} maxLength={300}
                  placeholder="เช่น ตรงข้ามศาลาหมู่บ้าน บ้านรั้วสีเขียว" className={inputCls} />
              </Field>
              <div className="grid grid-cols-12 gap-2">
                <Field label="สถานพยาบาลปลายทาง" required className="col-span-12 sm:col-span-7">
                  <input value={form.destination} onChange={set('destination')} maxLength={200}
                    placeholder="เช่น โรงพยาบาลจังหวัด" className={inputCls} />
                </Field>
                <Field label="แผนก/อาคาร" className="col-span-12 sm:col-span-5">
                  <input value={form.destination_detail} onChange={set('destination_detail')} maxLength={200}
                    className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="วันนัด" required
                  hint={staffId ? null : `ยื่นล่วงหน้าอย่างน้อย ${partner?.min_lead_days ?? 3} วัน`}>
                  <input type="date" value={form.appt_date} min={minDate} max={maxDate}
                    onChange={set('appt_date')} className={inputCls} />
                </Field>
                <Field label="เวลานัด" required>
                  <input type="time" value={form.appt_time} onChange={set('appt_time')} className={inputCls} />
                </Field>
              </div>
              {form.appt_date && form.appt_date < minDate && (
                <p className="text-xs font-semibold text-red-600">
                  วันนัดกระชั้นเกินไป กรุณาติดต่อเจ้าหน้าที่โดยตรง
                </p>
              )}
              <Field label="รูปแบบการเดินทาง" required>
                <ChoiceGroup options={TRIP_TYPES} value={form.trip_type} onChange={choose('trip_type')} />
              </Field>
              {form.trip_type === 'round_trip' && (
                <Field label="หมายเหตุเที่ยวกลับ">
                  <input value={form.return_note} onChange={set('return_note')} maxLength={200}
                    placeholder="เช่น ฟอกไตเสร็จประมาณบ่ายสองโมง" className={inputCls} />
                </Field>
              )}
              <Field label="ประเภทนัด" required>
                <ChoiceGroup options={APPOINTMENT_KINDS} value={form.appointment_kind} onChange={choose('appointment_kind')} />
              </Field>
              {form.appointment_kind === 'other' && (
                <Field label="ระบุประเภทนัด" required hint="ไม่ต้องระบุชื่อโรคหรืออาการ">
                  <input value={form.appointment_kind_note} onChange={set('appointment_kind_note')} maxLength={100}
                    placeholder="เช่น ทำแผล, ตรวจเลือด" className={inputCls} />
                </Field>
              )}
              <Field label="ลักษณะการเคลื่อนไหวของผู้ป่วย" required>
                <ChoiceGroup options={MOBILITY_LEVELS} value={form.mobility} onChange={choose('mobility')} />
              </Field>
              {form.mobility === 'stretcher' && (
                <div className="rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
                  ผู้ป่วยที่ต้องนอนเปลอาจต้องใช้รถพยาบาล หน่วยงานผู้จัดรถอาจรับไม่ได้
                  เจ้าหน้าที่จะแจ้งผลให้ทราบ — ถ้าอาการทรุดลงระหว่างรอ โทร 1669
                </div>
              )}
              <Field label="จำนวนผู้ติดตาม">
                <select value={form.companions} onChange={set('companions')} className={inputCls}>
                  {['0', '1', '2', '3'].map(count => <option key={count} value={count}>{count} คน</option>)}
                </select>
              </Field>
            </section>

            {partner && (
              <section className="space-y-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-gray-700">ความยินยอมส่งต่อข้อมูล</p>
                <label className="flex items-start gap-2.5 text-xs leading-relaxed text-gray-600">
                  <input type="checkbox" checked={form.consent}
                    onChange={event => setForm(current => ({ ...current, consent: event.target.checked }))}
                    className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{consentText}</span>
                </label>
              </section>
            )}

            <section className="rounded-2xl border border-gray-100 bg-white p-4 text-xs leading-relaxed text-gray-500 shadow-sm">
              {session && !staffId ? (
                <>
                  เมื่อกดยืนยัน ระบบจะลงชื่อ “{requesterName || 'ชื่อผู้ยื่นคำขอ'}” ในคำขอให้อัตโนมัติ
                  โดยถือเป็นการลงลายมือชื่อทางอิเล็กทรอนิกส์จากบัญชีที่ท่านยืนยันตัวตนแล้ว
                </>
              ) : (
                <>
                  เจ้าหน้าที่กรอกแทนผู้ยื่น — ใบที่พิมพ์ออกจะเว้นช่องลงชื่อไว้ให้ผู้ยื่นเซ็นด้วยปากกา
                  และต้องให้ผู้ยื่นอ่านข้อความยินยอมข้างบนก่อนติ๊กแทน
                </>
              )}
            </section>

            {submitError && (
              <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{submitError}</p>
            )}

            <button type="button" onClick={handleSubmit} disabled={!isValid || saving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-700 py-4 text-sm font-bold text-white shadow-sm disabled:opacity-40">
              {saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
              {saving ? 'กำลังส่งคำขอ' : 'ยืนยันและส่งคำขอ'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
