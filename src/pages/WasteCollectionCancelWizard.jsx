import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, CheckCircle2, Copy, Download, Loader2, Printer, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { NAME_TITLES, splitThaiFullName } from '../lib/thaiName'
import { generateDraftPdfBlob } from '../lib/generateDraftPdf'
import { thaiDate, thaiDateFromDateInput, todayStr } from '../lib/thaiDate'
import { tenantDefaultSubdistrict } from '../lib/tenantSubdistrict'
import { buildWasteCollectionCancelHtml, cancelReasonText } from '../lib/wasteCollectionCancelPrint'

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-rose-200'

// เหตุผลการยกเลิก — ไม่ใช่ข้อความประดับ กองสาธารณสุขใช้ตัดสินว่าถอนถังออกเลย (ย้ายออก/
// รื้อถอน) หรือแค่พักการจัดเก็บไว้ก่อน (ไม่มีคนอยู่บ้านชั่วคราว) และกองคลังใช้ตัดสินว่า
// จะปิดทะเบียนลูกหนี้หรือพักยอด ต้นฉบับของ อบต.ทุ่งแค้ว พิมพ์ "ไม่มีคนอยู่บ้าน" ไว้ตายตัว
// จึงวางไว้เป็นตัวเลือกแรกให้ตรงกับใบที่เจ้าหน้าที่คุ้นอยู่
const CANCEL_REASONS = [
  'ไม่มีคนอยู่บ้าน',
  'ย้ายออกจากพื้นที่',
  'รื้อถอน/ขายบ้าน',
  'กำจัดขยะเองแล้ว',
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
        {label}{required && <span className="text-rose-600"> *</span>}
      </label>
      {children}
    </div>
  )
}

/**
 * แบบคำร้องขอยกเลิกการเก็บขนขยะมูลฝอย — คู่แฝดของ WasteCollectionRequestWizard
 *
 * เก็บข้อมูลให้ครบตามใบพิมพ์ (wasteCollectionCancelPrint.js) โดยแยก "ผู้ยื่นคำร้อง" ออกจาก
 * "ผู้ใช้บริการที่จะยกเลิก" ตามต้นฉบับ — ต้นฉบับออกแบบมารองรับกรณียื่นแทน (ลูกยื่นแทนพ่อแม่
 * ที่ย้ายไปอยู่กับญาติ, ผู้จัดการนิติบุคคลยื่นแทนเจ้าของบ้านเช่า) ถ้ารวบเป็นคนเดียวจะกรอกไม่ได้
 */
export default function WasteCollectionCancelWizard({ tenant, session, onBack, staffId, onDone }) {
  const navigate = useNavigate()
  const tenantAddress = tenantAddressDefaults(tenant)
  const [saving, setSaving] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [done, setDone] = useState(null)
  const [form, setForm] = useState(() => ({
    form_type: 'waste_collection_cancel',
    form_version: 1,
    applicant: {
      title: '', first: '', last: '', age: '', phone: '', id_card: '',
      addr_no: '', addr_moo: '',
      addr_subdistrict: tenantAddress.subdistrict,
      addr_district: tenantAddress.district,
      addr_province: tenantAddress.province,
    },
    // ค่าเริ่มต้นเป็น true เพราะเคสส่วนใหญ่คือเจ้าบ้านยื่นเรื่องของตัวเอง — ให้กรอกซ้ำทุกรายจะ
    // ได้ข้อมูลผิดมากกว่าถูก (คนกรอกลวกจะพิมพ์ชื่อตัวเองซ้ำโดยไม่ดูว่าถามคนละคน)
    same_as_applicant: true,
    subscriber: {
      title: '', first: '', last: '', age: '',
      addr_no: '', addr_moo: '',
      addr_subdistrict: tenantAddress.subdistrict,
      addr_district: tenantAddress.district,
      addr_province: tenantAddress.province,
    },
    cancel_reason: CANCEL_REASONS[0],
    cancel_reason_other: '',
    cancel_date: todayStr(),
    outstanding_ack: false,
  }))

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
            // ตำบล/อำเภอ/จังหวัดยึดข้อมูล อปท. ตามแบบคำขอ ไม่ดึงที่อยู่โปรไฟล์ซึ่งอาจอยู่นอกเขต
          },
        }))
      })
  }, [session])

  const setApplicant = key => event => {
    const value = event.target.value
    setForm(current => ({ ...current, applicant: { ...current.applicant, [key]: value } }))
  }

  const setSubscriber = key => event => {
    const value = event.target.value
    setForm(current => ({ ...current, subscriber: { ...current.subscriber, [key]: value } }))
  }

  const applicant = form.applicant
  const subscriber = form.same_as_applicant ? applicant : form.subscriber
  const applicantName = `${applicant.title}${applicant.first} ${applicant.last}`.trim()
  const age = Number(applicant.age)
  const subscriberAge = Number(subscriber.age)
  const phoneDigits = applicant.phone.replace(/\D/g, '')
  // เลขบัตร 13 หลักไม่ตรวจ checksum โดยเจตนา — ให้ตรงกับด่านยืนยันตัวตนใน CitizenDocRequest
  // ที่ใช้ /^\d{13}$/ ถ้าเข้มกว่ากันจะเกิดเคสที่ผ่านด่านแรกมาแล้วแต่มาตกที่ฟอร์มนี้
  const idCardDigits = applicant.id_card.replace(/\D/g, '')
  const reasonText = cancelReasonText(form)

  const subscriberValid = form.same_as_applicant || Boolean(
    subscriber.title
    && subscriber.first.trim()
    && subscriber.last.trim()
    && Number.isInteger(subscriberAge) && subscriberAge >= 1 && subscriberAge <= 120
    && subscriber.addr_no.trim()
    && subscriber.addr_moo.trim()
    && subscriber.addr_subdistrict.trim()
    && subscriber.addr_district.trim()
    && subscriber.addr_province.trim()
  )

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
    && subscriberValid
    && CANCEL_REASONS.includes(form.cancel_reason)
    && reasonText.trim()
    && /^\d{4}-\d{2}-\d{2}$/.test(form.cancel_date)
    && form.outstanding_ack
  )

  async function handleSubmit() {
    if (!isValid || saving) return
    setSaving(true)
    const id = crypto.randomUUID()
    const submittedAt = new Date().toISOString()
    // ⚠️ ช่องทางการลงชื่อตัดสินจาก "มี session ของผู้ยื่นเองหรือไม่" เท่านั้น — เจ้าหน้าที่ที่
    // กรอกแทนหน้าเคาน์เตอร์ (staffId) ใช้บัญชีของเจ้าหน้าที่เอง ไม่ใช่ของประชาชน ใบที่พิมพ์ออก
    // จึงต้องเว้นช่องให้เซ็นด้วยปากกา ห้ามพิมพ์ชื่อประชาชนเป็นลายมือชื่อแทนเด็ดขาด
    const channel = session && !staffId ? 'online' : 'counter'
    const submittedForm = {
      ...form,
      applicant: { ...applicant, age, id_card: idCardDigits },
      // คัดลอกข้อมูลผู้ยื่นมาเป็นผู้ใช้บริการเมื่อติ๊กว่าคนเดียวกัน แต่ตัดเลขบัตรออก — ใบพิมพ์
      // และหน้าเจ้าหน้าที่ไม่ได้ใช้เลขบัตรของช่องนี้เลย เก็บซ้ำไว้ใน JSONB มีแต่เพิ่มพื้นที่รั่ว
      // ของข้อมูลส่วนบุคคลโดยไม่ได้อะไรกลับมา (PDPA — เก็บเท่าที่จำเป็น)
      subscriber: form.same_as_applicant
        ? {
          title: applicant.title,
          first: applicant.first,
          last: applicant.last,
          age,
          addr_no: applicant.addr_no,
          addr_moo: applicant.addr_moo,
          addr_subdistrict: applicant.addr_subdistrict,
          addr_district: applicant.addr_district,
          addr_province: applicant.addr_province,
        }
        : { ...form.subscriber, age: subscriberAge },
      outstanding_ack_at: submittedAt,
      signed_at: submittedAt,
      signed_by: {
        channel,
        name: applicantName,
        user_id: channel === 'online' ? (session?.user?.id ?? null) : null,
        entered_by_staff_id: staffId ?? null,
      },
    }
    // ที่อยู่ที่บันทึกลงคอลัมน์หลักคือ "จุดที่จะหยุดเก็บ" ไม่ใช่ที่อยู่ผู้ยื่น — คนที่อ่านค่านี้คือ
    // พนักงานที่ต้องไปถอนถังและคนที่ปิดทะเบียนลูกหนี้ ทั้งสองงานอ้างอิงที่อยู่ผู้ใช้บริการ
    const serviceAddress = [
      `บ้านเลขที่ ${subscriber.addr_no.trim()}`,
      `หมู่ที่ ${subscriber.addr_moo.trim()}`,
      `ตำบล${subscriber.addr_subdistrict.trim()}`,
      `อำเภอ${subscriber.addr_district.trim()}`,
      `จังหวัด${subscriber.addr_province.trim()}`,
    ].join(' ')

    const { error } = await supabase.from('document_requests').insert({
      id,
      municipality_id: tenant?.id,
      document_type: 'waste_collection_cancel',
      requester_name: applicantName,
      // ต้องมีเลขบัตรเสมอเหมือนใบขอรับบริการ — คำขอนี้ไปปิดภาระค่าธรรมเนียมในทะเบียนลูกหนี้
      // ต้องผูกกับตัวบุคคลได้ ไม่ใช่แค่ชื่อกับที่อยู่
      requester_id_card: idCardDigits,
      requester_phone: applicant.phone.trim(),
      requester_address: serviceAddress,
      // purpose ถูกโชว์ดิบๆ ในตารางเจ้าหน้าที่และหน้า "เอกสารของฉัน" จึงต้องเป็นวันที่ไทย (พ.ศ.)
      // ไม่ใช่ค่าดิบ YYYY-MM-DD ของ <input type="date"> ซึ่งเป็น ค.ศ.
      purpose: `ขอยกเลิกการเก็บขนขยะมูลฝอย (${reasonText.trim()}) ตั้งแต่วันที่ ${thaiDateFromDateInput(form.cancel_date)}`,
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
      alert(`ส่งคำร้องไม่สำเร็จ: ${error.message}`)
      return
    }
    notifyTelegram('document_request_created', id)
    setDone({ ref: id.slice(0, 8).toUpperCase(), form: submittedForm, signedAt: submittedAt })
  }

  function buildPrintHtml() {
    return buildWasteCollectionCancelHtml({
      form: done.form,
      tenant,
      thDate: thaiDate(new Date().toISOString()),
      referenceNo: done.ref,
      signedAt: done.signedAt,
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
      anchor.download = `คำร้องยกเลิกเก็บขนขยะ-${done.ref}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setPdfBusy(false)
    }
  }

  // ต้องล็อกอินด้วยเหตุผลเดียวกับใบขอรับบริการ (RLS อ่านคืนได้เฉพาะแถวที่ user_id = auth.uid()
  // ผู้ยื่นแบบ guest จะตามสถานะไม่ได้เลย) และเพิ่มอีกข้อ: การยกเลิกไปแตะทะเบียนลูกหนี้
  // ค่าธรรมเนียมของคนอื่นได้ ถ้าเปิดให้ยื่นแบบไม่ยืนยันตัวตน ใครก็ยื่นยกเลิกบ้านคนอื่นได้
  if (!session && !staffId) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50">
            <Trash2 size={30} className="text-rose-700" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-gray-800">เข้าสู่ระบบก่อนยื่นคำร้อง</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-500">
            การยกเลิกจัดเก็บมีผลกับค่าธรรมเนียมของบ้านหลังนั้น
            จึงต้องเข้าสู่ระบบเพื่อยืนยันตัวตนผู้ยื่นและให้ท่านติดตามสถานะได้
          </p>
          <button type="button"
            onClick={() => navigate('/auth', { state: { from: '/doc-request?type=waste_collection_cancel' } })}
            className="w-full rounded-2xl bg-rose-700 py-3.5 text-sm font-bold text-white">
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
          <h2 className="mb-2 text-xl font-bold text-gray-800">ยื่นคำร้องสำเร็จ</h2>
          <p className="mb-5 text-sm leading-relaxed text-gray-500">
            เจ้าหน้าที่จะตรวจสอบและติดต่อกลับก่อนหยุดจัดเก็บ
            การยกเลิกจะมีผลเมื่อได้รับแจ้งผลแล้วเท่านั้น
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
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-700 py-3.5 text-sm font-bold text-white">
              <Printer size={16} /> พิมพ์ใบแจ้งขอยกเลิก
            </button>
            <button type="button" onClick={handleDownloadPdf} disabled={pdfBusy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 py-3.5 text-sm font-bold text-rose-800 disabled:opacity-50">
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
          <Trash2 size={21} className="shrink-0 text-rose-700" />
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-800">ขอยกเลิกการเก็บขนขยะมูลฝอย</p>
            <p className="text-xs text-gray-400">กรอกข้อมูลตามใบแจ้งขอยกเลิก</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 pb-28 md:px-8 md:pb-8">
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-xs leading-relaxed text-rose-900">
          ใช้แจ้งให้ อปท. หยุดจัดเก็บขยะจากบ้านหรือสถานที่ที่เคยขอรับบริการไว้
          ไม่ใช่การแจ้งปัญหาเก็บขยะไม่ตรงเวลาหรือขยะตกค้าง
        </div>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">ข้อมูลผู้ยื่นคำร้อง</p>
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
              ใช้ยืนยันตัวผู้ยื่นกับทะเบียนผู้ชำระค่าธรรมเนียม ไม่เปิดเผยต่อสาธารณะตาม พ.ร.บ. PDPA
            </p>
          </Field>
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
        </section>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">สถานที่ที่ขอให้ยกเลิกการจัดเก็บ</p>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5">
            <input type="checkbox" checked={form.same_as_applicant}
              onChange={event => setForm(current => ({ ...current, same_as_applicant: event.target.checked }))}
              className="h-4 w-4 accent-rose-700" />
            <span className="text-sm text-gray-700">เป็นชื่อและที่อยู่เดียวกับผู้ยื่นคำร้อง</span>
          </label>

          {!form.same_as_applicant && (
            <>
              <div className="grid grid-cols-12 gap-2">
                <Field label="คำนำหน้า" required className="col-span-4 sm:col-span-3">
                  <select value={form.subscriber.title} onChange={setSubscriber('title')} className={inputCls}>
                    <option value="">เลือก</option>
                    {NAME_TITLES.map(title => <option key={title} value={title}>{title}</option>)}
                  </select>
                </Field>
                <Field label="ชื่อ" required className="col-span-8 sm:col-span-4">
                  <input value={form.subscriber.first} onChange={setSubscriber('first')} className={inputCls} />
                </Field>
                <Field label="นามสกุล" required className="col-span-8 sm:col-span-3">
                  <input value={form.subscriber.last} onChange={setSubscriber('last')} className={inputCls} />
                </Field>
                <Field label="อายุ (ปี)" required className="col-span-4 sm:col-span-2">
                  <input type="number" inputMode="numeric" min="1" max="120" value={form.subscriber.age}
                    onChange={setSubscriber('age')} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="บ้านเลขที่" required>
                  <input value={form.subscriber.addr_no} onChange={setSubscriber('addr_no')} className={inputCls} />
                </Field>
                <Field label="หมู่ที่" required>
                  <input value={form.subscriber.addr_moo} onChange={setSubscriber('addr_moo')} className={inputCls} />
                </Field>
                <Field label="ตำบล" required>
                  <input value={form.subscriber.addr_subdistrict} onChange={setSubscriber('addr_subdistrict')} className={inputCls} />
                </Field>
                <Field label="อำเภอ" required>
                  <input value={form.subscriber.addr_district} onChange={setSubscriber('addr_district')} className={inputCls} />
                </Field>
                <Field label="จังหวัด" required className="col-span-2">
                  <input value={form.subscriber.addr_province} onChange={setSubscriber('addr_province')} className={inputCls} />
                </Field>
              </div>
            </>
          )}

          <Field label="เหตุผลที่ขอยกเลิก" required>
            <select value={form.cancel_reason}
              onChange={event => setForm(current => ({ ...current, cancel_reason: event.target.value }))}
              className={inputCls}>
              {CANCEL_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}
            </select>
          </Field>
          {form.cancel_reason === 'อื่นๆ' && (
            <Field label="ระบุเหตุผล" required>
              <input value={form.cancel_reason_other}
                onChange={event => setForm(current => ({ ...current, cancel_reason_other: event.target.value }))}
                placeholder="ข้อความนี้จะถูกพิมพ์ลงในใบคำร้อง" className={inputCls} />
            </Field>
          )}
          <Field label="ขอให้ยกเลิกตั้งแต่วันที่" required>
            <input type="date" min={todayStr()} value={form.cancel_date}
              onChange={event => setForm(current => ({ ...current, cancel_date: event.target.value }))}
              className={inputCls} />
          </Field>
        </section>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <input type="checkbox" checked={form.outstanding_ack}
            onChange={event => setForm(current => ({ ...current, outstanding_ack: event.target.checked }))}
            className="mt-1 h-5 w-5 shrink-0 accent-rose-700" />
          <span className="text-sm leading-relaxed text-amber-900">
            {/* ถ้อยคำตรงกับย่อหน้าที่พิมพ์ลงใบเป๊ะ — สิ่งที่ติ๊กยอมรับบนจอต้องเป็นข้อความเดียวกับ
                ที่ลงชื่อบนกระดาษ ไม่งั้นเถียงกันภายหลังได้ว่าตกลงอะไรไว้ (กติกาเดียวกับใบขอรับบริการ) */}
            ข้าพเจ้ารับทราบว่าการยกเลิกจะมีผลเมื่อ อปท. ตรวจสอบและแจ้งผลแล้ว
            และข้าพเจ้ายังคงมีหน้าที่ชำระค่าธรรมเนียมเก็บขนขยะมูลฝอยที่ค้างชำระจนถึงวันที่การยกเลิกมีผลให้ครบถ้วน
          </span>
        </label>

        {/* บอกให้ชัดตั้งแต่ก่อนกดส่งว่าใบที่พิมพ์ออกจะมีชื่อเป็นลายมือชื่อแล้ว ไม่ต้องเซ็นซ้ำ —
            ไม่งั้นประชาชนพิมพ์ใบออกมาแล้วไม่แน่ใจว่าต้องเซ็นอีกไหม เจ้าหน้าที่ก็ตอบไม่ตรงกัน */}
        {session && !staffId && (
          <p className="px-1 text-[11px] leading-relaxed text-gray-500">
            เมื่อกดยืนยัน ระบบจะลงชื่อ “{applicantName || 'ชื่อผู้ยื่นคำร้อง'}” ในใบคำร้องให้อัตโนมัติ
            โดยอ้างอิงการยืนยันตัวตนของบัญชีที่เข้าสู่ระบบ พร้อมวันเวลาและเลขอ้างอิง
          </p>
        )}
        {staffId && (
          <p className="px-1 text-[11px] leading-relaxed text-gray-500">
            กรอกแทนที่เคาน์เตอร์ — ใบที่พิมพ์ออกจะเว้นช่องลงนามไว้ ต้องให้ผู้ยื่นลงลายมือชื่อด้วยปากกาเสมอ
          </p>
        )}

        <button type="button" onClick={handleSubmit} disabled={!isValid || saving}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-700 py-4 text-sm font-bold text-white shadow-sm disabled:opacity-40">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
          {saving ? 'กำลังส่งคำร้อง' : 'ยืนยันและส่งคำร้อง'}
        </button>
      </div>
    </div>
  )
}
