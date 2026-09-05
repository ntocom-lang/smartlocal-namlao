import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, CheckCircle2, Copy, Download, Loader2, MapPin, Printer, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { NAME_TITLES, splitThaiFullName } from '../lib/thaiName'
import { generateDraftPdfBlob } from '../lib/generateDraftPdf'
import { thaiDate, thaiDateFromDateInput, todayStr } from '../lib/thaiDate'
import { tenantDefaultSubdistrict } from '../lib/tenantSubdistrict'
import { buildWasteCollectionRequestHtml } from '../lib/wasteCollectionRequestPrint'

// โหลดเมื่อผู้ใช้กดเปิดแผนที่เท่านั้น — leaflet + ชั้น tile หนักเกินกว่าจะให้ทุกคนที่เปิด
// หน้ายื่นคำขอดาวน์โหลดไปเปล่าๆ ทั้งที่การปักหมุดเป็นตัวเลือกเสริม
const InlineMapPicker = lazy(() => import('../components/InlineMapPicker'))

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-200'

// ประเภทสถานที่กับจำนวนถังเป็นตัวกำหนดอัตราค่าธรรมเนียมตามข้อบัญญัติท้องถิ่น (บ้านพักอาศัย
// คิดรายครัวเรือน ส่วนร้านค้า/สถานประกอบการคิดตามปริมาณขยะหรือจำนวนถัง) ถ้าไม่ถามตั้งแต่
// ยื่นคำขอ เจ้าหน้าที่ต้องโทรถามกลับทุกรายก่อนออกใบแจ้งหนี้
const PLACE_TYPES = [
  'บ้านพักอาศัย',
  'ร้านค้า/ร้านอาหาร',
  'สถานประกอบการ/โรงงาน',
  'หน่วยงาน/สถานศึกษา',
  'อื่นๆ',
]

function addressPart(address, prefix) {
  if (!address) return ''
  const match = String(address).match(new RegExp(`${prefix}\\s*([^\\s]+)`))
  return match?.[1]?.trim() || ''
}

function tenantAddressDefaults(tenant) {
  return {
    subdistrict: tenantDefaultSubdistrict(tenant) || addressPart(tenant?.address, 'ตำบล'),
    district: tenant?.district?.trim() || addressPart(tenant?.address, 'อำเภอ'),
    province: tenant?.province?.trim() || addressPart(tenant?.address, 'จังหวัด'),
  }
}

function Field({ label, required, children, className = '' }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-semibold text-gray-500">
        {label}{required && <span className="text-cyan-600"> *</span>}
      </label>
      {children}
    </div>
  )
}

export default function WasteCollectionRequestWizard({ tenant, session, onBack, staffId, onDone }) {
  const navigate = useNavigate()
  const tenantAddress = tenantAddressDefaults(tenant)
  const [saving, setSaving] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [done, setDone] = useState(null)
  const [form, setForm] = useState(() => ({
    form_type: 'waste_collection_request',
    form_version: 1,
    applicant: {
      title: '', first: '', last: '', age: '', phone: '', id_card: '',
      addr_no: '', addr_moo: '',
      addr_subdistrict: tenantAddress.subdistrict,
      addr_district: tenantAddress.district,
      addr_province: tenantAddress.province,
    },
    place_type: PLACE_TYPES[0],
    bin_count: '1',
    // จุดวางถังจากแผนที่ — null จนกว่าผู้ใช้จะกด "ใช้ตำแหน่งนี้" ยืนยันเอง
    collection_point: null,
    service_start_date: todayStr(),
    fee_terms_accepted: false,
  }))
  const [mapOpen, setMapOpen] = useState(false)
  // ตำแหน่งที่กำลังเล็งอยู่บนแผนที่ ยังไม่ใช่ค่าที่บันทึก
  const [pendingPoint, setPendingPoint] = useState(null)

  useEffect(() => {
    if (!session) return
    supabase.from('profiles')
      .select('full_name, phone, id_card, address_detail, address_moo')
      .eq('id', session.user.id)
      .single()
      .then(({ data: profile }) => {
        if (!profile) return
        const { title, first, last } = splitThaiFullName(profile.full_name)
        setForm(current => ({
          ...current,
          applicant: {
            ...current.applicant,
            title,
            first,
            last,
            phone: profile.phone ?? '',
            id_card: profile.id_card ?? '',
            addr_no: profile.address_detail ?? '',
            addr_moo: profile.address_moo ?? '',
            // พื้นที่บริการยึดข้อมูล อปท. เป็นค่าเริ่มต้นตามแบบคำขอ ไม่ดึงที่อยู่โปรไฟล์
            // ซึ่งอาจเป็นที่อยู่นอกเขต ผู้ใช้ยังแก้ไขสามช่องนี้เองได้ในฟอร์ม
          },
        }))
      })
  }, [session])

  const setApplicant = key => event => {
    const value = event.target.value
    setForm(current => ({
      ...current,
      applicant: { ...current.applicant, [key]: value },
    }))
  }

  const applicant = form.applicant
  const applicantName = `${applicant.title}${applicant.first} ${applicant.last}`.trim()
  const age = Number(applicant.age)
  const binCount = Number(form.bin_count)
  const phoneDigits = applicant.phone.replace(/\D/g, '')
  // เลขบัตร 13 หลักไม่ตรวจ checksum โดยเจตนา — ให้ตรงกับด่านยืนยันตัวตนใน CitizenDocRequest
  // ที่ใช้ /^\d{13}$/ ถ้าเข้มกว่ากันจะเกิดเคสที่ผ่านด่านแรกมาแล้วแต่มาตกที่ฟอร์มนี้
  const idCardDigits = applicant.id_card.replace(/\D/g, '')
  const isValid = Boolean(
    applicant.title
    && applicant.first.trim()
    && applicant.last.trim()
    && Number.isInteger(age) && age >= 1 && age <= 120
    && applicant.addr_no.trim()
    && applicant.addr_moo.trim()
    && applicant.addr_subdistrict.trim()
    && applicant.addr_district.trim()
    && applicant.addr_province.trim()
    && phoneDigits.length >= 9 && phoneDigits.length <= 15
    && idCardDigits.length === 13
    && PLACE_TYPES.includes(form.place_type)
    && Number.isInteger(binCount) && binCount >= 1 && binCount <= 50
    && /^\d{4}-\d{2}-\d{2}$/.test(form.service_start_date)
    && form.fee_terms_accepted
  )

  async function handleSubmit() {
    if (!isValid || saving) return
    setSaving(true)
    const id = crypto.randomUUID()
    const submittedForm = {
      ...form,
      applicant: { ...applicant, age, id_card: idCardDigits },
      bin_count: binCount,
      fee_terms_accepted_at: new Date().toISOString(),
    }
    const requesterAddress = [
      `บ้านเลขที่ ${applicant.addr_no.trim()}`,
      `หมู่ที่ ${applicant.addr_moo.trim()}`,
      `ตำบล${applicant.addr_subdistrict.trim()}`,
      `อำเภอ${applicant.addr_district.trim()}`,
      `จังหวัด${applicant.addr_province.trim()}`,
    ].join(' ')

    // permit_form_data เป็นชื่อคอลัมน์ legacy แต่เป็น JSONB ที่ RLS เดิมอนุญาตให้อ่านเฉพาะ
    // เจ้าของคำขอ/เจ้าหน้าที่ตามกอง ใช้ form_type แยกจากข้อมูลแบบ ข.๑ โดยไม่เพิ่ม schema ใหม่
    const { error } = await supabase.from('document_requests').insert({
      id,
      municipality_id: tenant?.id,
      document_type: 'waste_collection_request',
      requester_name: applicantName,
      // ต่างจากคำขอประเภทอื่นตรงที่ต้องมีเลขบัตรเสมอ — คำขอนี้สร้างภาระผูกพันค่าธรรมเนียม
      // รายเดือน ต้องผูกกับตัวบุคคลในทะเบียนลูกหนี้ได้ ไม่ใช่แค่ชื่อกับที่อยู่
      requester_id_card: idCardDigits,
      requester_phone: applicant.phone.trim(),
      requester_address: requesterAddress,
      // purpose ถูกโชว์ดิบๆ ในตารางเจ้าหน้าที่และหน้า "เอกสารของฉัน" จึงต้องเป็นวันที่ไทย
      // (พ.ศ.) ไม่ใช่ค่าดิบ YYYY-MM-DD ของ <input type="date"> ซึ่งเป็น ค.ศ.
      purpose: `ขอรับบริการเก็บขนขยะมูลฝอย (${form.place_type}) ตั้งแต่วันที่ ${thaiDateFromDateInput(form.service_start_date)}`,
      status: 'pending',
      user_id: session?.user?.id ?? null,
      assigned_to: staffId ?? null,
      fee_amount: null,
      payment_status: 'not_required',
      payment_slip_url: null,
      permit_form_data: submittedForm,
    })
    setSaving(false)
    if (error) {
      alert(`ส่งคำขอไม่สำเร็จ: ${error.message}`)
      return
    }
    notifyTelegram('document_request_created', id)
    setDone({ ref: id.slice(0, 8).toUpperCase(), form: submittedForm })
  }

  function buildPrintHtml() {
    return buildWasteCollectionRequestHtml({
      form: done.form,
      tenant,
      thDate: thaiDate(new Date().toISOString()),
      referenceNo: done.ref,
    })
  }

  function handlePrint() {
    const printWindow = window.open('', '_blank', 'width=860,height=1100')
    if (!printWindow) return
    printWindow.document.write(buildPrintHtml())
    printWindow.document.close()
    setTimeout(() => { printWindow.focus(); printWindow.print() }, 400)
  }

  async function handleDownloadPdf() {
    setPdfBusy(true)
    try {
      const blob = await generateDraftPdfBlob(buildPrintHtml())
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `คำขอเก็บขนขยะ-${done.ref}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setPdfBusy(false)
    }
  }

  // ต้องล็อกอินเฉพาะบริการนี้ (ประเภทอื่นยังยื่นแบบ guest ได้ตามเดิม) เพราะ RLS ของ
  // document_requests อ่านคืนได้เฉพาะแถวที่ user_id = auth.uid() — guest ที่ยื่นสำเร็จจะได้
  // เลขอ้างอิงมาแต่เปิดดูสถานะไม่ได้เลย ทั้งที่คำขอนี้เป็นเรื่องที่ต้องตามยาว (นัดสำรวจพื้นที่
  // แล้วเริ่มเก็บ) ไม่ใช่คำขอครั้งเดียวจบ · staffId มีค่าเมื่อเจ้าหน้าที่กรอกแทนที่เคาน์เตอร์
  if (!session && !staffId) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-50">
            <Trash2 size={30} className="text-cyan-700" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-gray-800">เข้าสู่ระบบก่อนยื่นคำขอ</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-500">
            บริการนี้มีค่าธรรมเนียมรายเดือนและต้องนัดเจ้าหน้าที่สำรวจพื้นที่
            จึงต้องเข้าสู่ระบบเพื่อให้ท่านติดตามสถานะได้ตลอดจนเริ่มเก็บขน
          </p>
          <button type="button"
            onClick={() => navigate('/auth', { state: { from: '/doc-request?type=waste_collection_request' } })}
            className="w-full rounded-2xl bg-cyan-700 py-3.5 text-sm font-bold text-white">
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

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-800">ยื่นคำขอสำเร็จ</h2>
          <p className="mb-5 text-sm leading-relaxed text-gray-500">
            เจ้าหน้าที่จะตรวจสอบพื้นที่และติดต่อกลับผ่านหมายเลขโทรศัพท์ที่แจ้งไว้
          </p>
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
            <button type="button" onClick={handlePrint}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-700 py-3.5 text-sm font-bold text-white">
              <Printer size={16} /> พิมพ์ใบแจ้งขออนุญาต
            </button>
            <button type="button" onClick={handleDownloadPdf} disabled={pdfBusy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 py-3.5 text-sm font-bold text-cyan-800 disabled:opacity-50">
              {pdfBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {pdfBusy ? 'กำลังสร้างไฟล์' : 'ดาวน์โหลด PDF'}
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
          <Trash2 size={21} className="shrink-0 text-cyan-700" />
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-800">ขอรับบริการเก็บขนขยะมูลฝอย</p>
            <p className="text-xs text-gray-400">กรอกข้อมูลตามใบแจ้งขออนุญาต</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 pb-28 md:px-8 md:pb-8">
        <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-xs leading-relaxed text-cyan-900">
          ใช้สำหรับแจ้งให้ อปท. เริ่มจัดเก็บขยะจากบ้านหรือสถานที่ตามที่ระบุ ไม่ใช่การแจ้งปัญหาขยะตกค้าง
        </div>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">ข้อมูลผู้ขอรับบริการ</p>
          <div className="grid grid-cols-12 gap-2">
            <Field label="คำนำหน้า" required className="col-span-4 sm:col-span-3">
              <select value={applicant.title} onChange={setApplicant('title')} className={inputCls}>
                <option value="">เลือก</option>
                {NAME_TITLES.map(title => <option key={title} value={title}>{title}</option>)}
              </select>
            </Field>
            <Field label="ชื่อ" required className="col-span-8 sm:col-span-4">
              <input value={applicant.first} onChange={setApplicant('first')} className={inputCls} />
            </Field>
            <Field label="นามสกุล" required className="col-span-8 sm:col-span-3">
              <input value={applicant.last} onChange={setApplicant('last')} className={inputCls} />
            </Field>
            <Field label="อายุ (ปี)" required className="col-span-4 sm:col-span-2">
              <input type="number" inputMode="numeric" min="1" max="120" value={applicant.age}
                onChange={setApplicant('age')} className={inputCls} />
            </Field>
          </div>
          <Field label="หมายเลขโทรศัพท์สำหรับติดต่อ" required>
            <input type="tel" inputMode="tel" value={applicant.phone} onChange={setApplicant('phone')}
              placeholder="08x-xxx-xxxx" className={inputCls} />
          </Field>
          <Field label="เลขประจำตัวประชาชน 13 หลัก" required>
            <input type="text" inputMode="numeric" maxLength={13} value={applicant.id_card}
              onChange={event => setForm(current => ({
                ...current,
                applicant: { ...current.applicant, id_card: event.target.value.replace(/\D/g, '').slice(0, 13) },
              }))}
              placeholder="เช่น 1234567890123" className={`${inputCls} tracking-widest`} />
            <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
              ใช้ผูกกับทะเบียนผู้ชำระค่าธรรมเนียมเก็บขนขยะ ไม่เปิดเผยต่อสาธารณะตาม พ.ร.บ. PDPA
            </p>
          </Field>
        </section>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">สถานที่ขอรับบริการ</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="บ้านเลขที่" required>
              <input value={applicant.addr_no} onChange={setApplicant('addr_no')} className={inputCls} />
            </Field>
            <Field label="หมู่ที่" required>
              <input value={applicant.addr_moo} onChange={setApplicant('addr_moo')} className={inputCls} />
            </Field>
            <Field label="ตำบล" required>
              <input value={applicant.addr_subdistrict} onChange={setApplicant('addr_subdistrict')} className={inputCls} />
            </Field>
            <Field label="อำเภอ" required>
              <input value={applicant.addr_district} onChange={setApplicant('addr_district')} className={inputCls} />
            </Field>
            <Field label="จังหวัด" required className="col-span-2">
              <input value={applicant.addr_province} onChange={setApplicant('addr_province')} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="ประเภทสถานที่" required className="col-span-2">
              <select value={form.place_type}
                onChange={event => setForm(current => ({ ...current, place_type: event.target.value }))}
                className={inputCls}>
                {PLACE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="จำนวนถัง (ใบ)" required>
              <input type="number" inputMode="numeric" min="1" max="50" value={form.bin_count}
                onChange={event => setForm(current => ({ ...current, bin_count: event.target.value }))}
                className={inputCls} />
            </Field>
          </div>
          <Field label="ปักหมุดจุดวางถังบนแผนที่">
            {/* ห้ามบันทึกจุดที่แผนที่เล็งอยู่ตอนเปิดโดยอัตโนมัติ — LeafletMapPicker จะยิง
                onLocationSelect ตั้งแต่ mount ด้วยจุดกึ่งกลางเริ่มต้น (ที่ตั้งสำนักงาน อปท.)
                ถ้ารับค่านั้นเลย ทุกคำขอจะได้หมุดปลอมที่ชี้ไปสำนักงาน ซึ่งแย่กว่าไม่มีหมุด
                เพราะพนักงานเก็บขนจะเชื่อแล้วขับไปผิดที่ ต้องให้กด "ใช้ตำแหน่งนี้" ยืนยันเสมอ */}
            {form.collection_point ? (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-cyan-700" />
                  <div className="min-w-0 flex-1">
                    {form.collection_point.address && (
                      <p className="text-xs leading-snug text-cyan-900">{form.collection_point.address}</p>
                    )}
                    <p className="mt-0.5 font-mono text-[11px] text-cyan-700">
                      {form.collection_point.lat.toFixed(6)}, {form.collection_point.lng.toFixed(6)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex gap-3">
                  <button type="button"
                    onClick={() => { setPendingPoint(form.collection_point); setMapOpen(true) }}
                    className="text-xs font-semibold text-cyan-700 underline">แก้ไขตำแหน่ง</button>
                  <button type="button"
                    onClick={() => setForm(current => ({ ...current, collection_point: null }))}
                    className="text-xs font-semibold text-red-500 underline">ลบหมุด</button>
                </div>
              </div>
            ) : mapOpen ? (
              <div className="space-y-2">
                <Suspense fallback={
                  <div className="flex h-80 items-center justify-center rounded-xl bg-gray-50 text-sm text-gray-400">
                    <Loader2 size={16} className="mr-2 animate-spin" /> กำลังโหลดแผนที่
                  </div>
                }>
                  <InlineMapPicker
                    value={pendingPoint}
                    onChange={point => setPendingPoint(point)}
                    defaultCenter={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
                  />
                </Suspense>
                <div className="flex gap-2">
                  <button type="button" disabled={!pendingPoint}
                    onClick={() => {
                      setForm(current => ({
                        ...current,
                        collection_point: {
                          lat: Number(pendingPoint.lat),
                          lng: Number(pendingPoint.lng),
                          address: pendingPoint.address ?? '',
                        },
                      }))
                      setMapOpen(false)
                    }}
                    className="flex-1 rounded-xl bg-cyan-700 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                    ใช้ตำแหน่งนี้
                  </button>
                  <button type="button" onClick={() => { setMapOpen(false); setPendingPoint(null) }}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-500">
                    ยกเลิก
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setMapOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-300 bg-cyan-50/50 py-3 text-sm font-semibold text-cyan-700">
                <MapPin size={15} /> เปิดแผนที่เพื่อปักหมุด
              </button>
            )}
            <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
              ไม่บังคับ — ช่วยให้พนักงานเก็บขนหาจุดวางถังได้ตรงจุด เลื่อนแผนที่ให้หมุดตรงจุดที่ต้องการแล้วกด "ใช้ตำแหน่งนี้"
            </p>
          </Field>
          <Field label="วันที่ต้องการเริ่มให้จัดเก็บ" required>
            <input type="date" min={todayStr()} value={form.service_start_date}
              onChange={event => setForm(current => ({ ...current, service_start_date: event.target.value }))}
              className={inputCls} />
          </Field>
        </section>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <input type="checkbox" checked={form.fee_terms_accepted}
            onChange={event => setForm(current => ({ ...current, fee_terms_accepted: event.target.checked }))}
            className="mt-1 h-5 w-5 shrink-0 accent-cyan-700" />
          <span className="text-sm leading-relaxed text-amber-900">
            {/* ถ้อยคำตรงกับที่พิมพ์ลงใบเป๊ะ — สิ่งที่ติ๊กยอมรับบนจอต้องเป็นข้อความเดียวกับ
                ที่ลงนามบนกระดาษ ไม่งั้นเถียงกันภายหลังได้ว่าตกลงอะไรไว้ */}
            ข้าพเจ้ายินยอมชำระค่าบริการเก็บขนขยะมูลฝอยและปฏิบัติตามข้อบัญญัติท้องถิ่นที่กำหนดทุกประการ
          </span>
        </label>

        <button type="button" onClick={handleSubmit} disabled={!isValid || saving}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-700 py-4 text-sm font-bold text-white shadow-sm disabled:opacity-40">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
          {saving ? 'กำลังส่งคำขอ' : 'ยืนยันและส่งคำขอ'}
        </button>
      </div>
    </div>
  )
}
