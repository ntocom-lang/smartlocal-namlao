import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, CheckCircle2, Copy, Download, Droplets, Loader2, MapPin, Printer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { NAME_TITLES, splitThaiFullName } from '../lib/thaiName'
import { generateDraftPdfBlob } from '../lib/generateDraftPdf'
import { thaiDateFromDateInput, todayStr } from '../lib/thaiDate'
import { tenantDefaultSubdistrict } from '../lib/tenantSubdistrict'
import { buildWaterSupplyRequestHtml } from '../lib/waterSupplyRequestPrint'

// โหลดเมื่อผู้ใช้กดเปิดแผนที่เท่านั้น — leaflet + ชั้น tile หนักเกินกว่าจะให้ทุกคนที่เปิด
// หน้ายื่นคำขอดาวน์โหลดไปเปล่าๆ ทั้งที่การปักหมุดเป็นตัวเลือกเสริม (เหมือนใบเก็บขนขยะ)
const InlineMapPicker = lazy(() => import('../components/InlineMapPicker'))

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200'

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
 * แบบคำขออนุญาตใช้น้ำประปา — โครงเดียวกับ WasteCollectionRequestWizard
 *
 * เก็บข้อมูลให้ครบตามใบพิมพ์ (waterSupplyRequestPrint.js) โดยแยก "ที่อยู่ผู้ยื่น" ออกจาก
 * "สถานที่ติดตั้งมาตรวัดน้ำ" ตามต้นฉบับ ซึ่งมีช่องบ้านเลขที่ 2 ชุด — เคสจริงที่ต่างกันมีเยอะ
 * (ขอมิเตอร์ให้บ้านที่กำลังสร้าง, แปลงเกษตร, บ้านเช่าที่เจ้าของอยู่คนละหลัง) ถ้ารวบเป็นชุดเดียว
 * จะกรอกไม่ได้และช่างประปาจะไปติดตั้งผิดหลัง
 */
export default function WaterSupplyRequestWizard({ tenant, session, onBack, staffId, onDone }) {
  const navigate = useNavigate()
  const tenantAddress = tenantAddressDefaults(tenant)
  const [saving, setSaving] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [done, setDone] = useState(null)
  const [form, setForm] = useState(() => ({
    form_type: 'water_supply_request',
    form_version: 1,
    applicant: {
      title: '', first: '', last: '', age: '', phone: '', id_card: '',
      addr_no: '', addr_moo: '',
      addr_subdistrict: tenantAddress.subdistrict,
      addr_district: tenantAddress.district,
      addr_province: tenantAddress.province,
    },
    // ค่าเริ่มต้นเป็น true เพราะเคสส่วนใหญ่คือเจ้าบ้านขอมิเตอร์ให้บ้านตัวเอง — บังคับกรอกซ้ำทุกราย
    // จะได้ข้อมูลผิดมากกว่าถูก (คนกรอกลวกจะพิมพ์ที่อยู่เดิมซ้ำโดยไม่ดูว่าถามคนละที่)
    same_as_applicant: true,
    site: {
      addr_no: '', addr_moo: '',
      addr_subdistrict: tenantAddress.subdistrict,
      addr_district: tenantAddress.district,
      addr_province: tenantAddress.province,
    },
    service_start_date: todayStr(),
    // จุดที่ขอให้มาติดตั้งมาตรวัดน้ำ — null จนกว่าผู้ใช้จะกด "ใช้ตำแหน่งนี้" ยืนยันเอง
    meter_point: null,
    meter_ack: false,
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
            // ตำบล/อำเภอ/จังหวัดยึดข้อมูล อปท. ตามแบบคำขอ ไม่ดึงที่อยู่โปรไฟล์ซึ่งอาจอยู่นอกเขต
          },
        }))
      })
  }, [session])

  const setApplicant = key => event => {
    const value = event.target.value
    setForm(current => ({ ...current, applicant: { ...current.applicant, [key]: value } }))
  }

  const setSite = key => event => {
    const value = event.target.value
    setForm(current => ({ ...current, site: { ...current.site, [key]: value } }))
  }

  const applicant = form.applicant
  const site = form.same_as_applicant ? applicant : form.site
  const applicantName = `${applicant.title}${applicant.first} ${applicant.last}`.trim()
  const age = Number(applicant.age)
  const phoneDigits = applicant.phone.replace(/\D/g, '')
  // เลขบัตร 13 หลักไม่ตรวจ checksum โดยเจตนา — ให้ตรงกับด่านยืนยันตัวตนใน CitizenDocRequest
  // ที่ใช้ /^\d{13}$/ ถ้าเข้มกว่ากันจะเกิดเคสที่ผ่านด่านแรกมาแล้วแต่มาตกที่ฟอร์มนี้
  const idCardDigits = applicant.id_card.replace(/\D/g, '')

  const siteValid = form.same_as_applicant || Boolean(
    form.site.addr_no.trim()
    && form.site.addr_moo.trim()
    && form.site.addr_subdistrict.trim()
    && form.site.addr_district.trim()
    && form.site.addr_province.trim()
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
    && siteValid
    && /^\d{4}-\d{2}-\d{2}$/.test(form.service_start_date)
    && form.meter_ack
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
      // คัดลอกที่อยู่ผู้ยื่นมาเป็นสถานที่ติดตั้งเมื่อติ๊กว่าที่เดียวกัน — เก็บเฉพาะช่องที่อยู่
      // ไม่คัดชื่อ/อายุ/เลขบัตรตามมา ใบพิมพ์และแดชบอร์ดไม่ได้ใช้ค่าเหล่านั้นของช่องนี้เลย
      // เก็บซ้ำใน JSONB มีแต่เพิ่มพื้นที่รั่วของข้อมูลส่วนบุคคล (PDPA — เก็บเท่าที่จำเป็น)
      site: form.same_as_applicant
        ? {
          addr_no: applicant.addr_no,
          addr_moo: applicant.addr_moo,
          addr_subdistrict: applicant.addr_subdistrict,
          addr_district: applicant.addr_district,
          addr_province: applicant.addr_province,
        }
        : { ...form.site },
      meter_ack_at: submittedAt,
      signed_at: submittedAt,
      signed_by: {
        channel,
        name: applicantName,
        user_id: channel === 'online' ? (session?.user?.id ?? null) : null,
        entered_by_staff_id: staffId ?? null,
      },
    }
    // ที่อยู่ที่บันทึกลงคอลัมน์หลักคือ "จุดติดตั้งมาตรวัดน้ำ" ไม่ใช่ที่อยู่ผู้ยื่น — คนที่อ่านค่านี้คือ
    // ช่างประปาที่ต้องไปเดินท่อ และกองคลังที่ต้องออกใบแจ้งหนี้ตามหลังมาตร ทั้งสองงานอ้างสถานที่ติดตั้ง
    const serviceAddress = [
      `บ้านเลขที่ ${site.addr_no.trim()}`,
      `หมู่ที่ ${site.addr_moo.trim()}`,
      `ตำบล${site.addr_subdistrict.trim()}`,
      `อำเภอ${site.addr_district.trim()}`,
      `จังหวัด${site.addr_province.trim()}`,
    ].join(' ')

    const { error } = await supabase.from('document_requests').insert({
      id,
      municipality_id: tenant?.id,
      document_type: 'water_supply_request',
      requester_name: applicantName,
      // ต้องมีเลขบัตรเสมอ — คำขอนี้เปิดทะเบียนผู้ใช้น้ำและผูกค่าประกันมาตรกับตัวบุคคล
      // ไม่ใช่แค่ชื่อกับที่อยู่
      requester_id_card: idCardDigits,
      requester_phone: applicant.phone.trim(),
      requester_address: serviceAddress,
      // purpose ถูกโชว์ดิบๆ ในตารางเจ้าหน้าที่และหน้า "เอกสารของฉัน" จึงต้องเป็นวันที่ไทย (พ.ศ.)
      // ไม่ใช่ค่าดิบ YYYY-MM-DD ของ <input type="date"> ซึ่งเป็น ค.ศ.
      purpose: `ขออนุญาตใช้น้ำประปา ตั้งแต่วันที่ ${thaiDateFromDateInput(form.service_start_date)}`,
      status: 'pending',
      user_id: session?.user?.id ?? null,
      assigned_to: staffId ?? null,
      // ค่าประกันมาตร/ค่าติดตั้งไม่ตั้งไว้ล่วงหน้า — อัตราต่างกันตามขนาดมาตรและระยะท่อที่ต้องเดิน
      // ซึ่งรู้หลังช่างออกไปสำรวจ ระบบนี้ไม่รับชำระเงินอยู่แล้ว ให้เจ้าหน้าที่แจ้งยอดทีหลัง
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
    setDone({ ref: id.slice(0, 8).toUpperCase(), form: submittedForm, signedAt: submittedAt })
  }

  function buildPrintHtml() {
    return buildWaterSupplyRequestHtml({
      form: done.form,
      tenant,
      docDate: done.signedAt,
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
      anchor.download = `คำขอใช้น้ำประปา-${done.ref}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setPdfBusy(false)
    }
  }

  // ต้องล็อกอินด้วยเหตุผลเดียวกับใบขอรับบริการเก็บขนขยะ (RLS อ่านคืนได้เฉพาะแถวที่
  // user_id = auth.uid() ผู้ยื่นแบบ guest จะตามสถานะไม่ได้เลย) และอีกข้อ: คำขอนี้เปิดทะเบียน
  // ผู้ใช้น้ำผูกค่าประกันมาตรกับตัวบุคคล ถ้ายื่นได้โดยไม่ยืนยันตัวตน ใครก็ขอมิเตอร์ในชื่อคนอื่นได้
  if (!session && !staffId) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50">
            <Droplets size={30} className="text-sky-700" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-gray-800">เข้าสู่ระบบก่อนยื่นคำขอ</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-500">
            คำขอใช้น้ำประปาเปิดทะเบียนผู้ใช้น้ำในชื่อของท่านและผูกกับค่าประกันมาตร
            จึงต้องเข้าสู่ระบบเพื่อยืนยันตัวตนผู้ยื่นและให้ท่านติดตามสถานะได้
          </p>
          <button type="button"
            onClick={() => navigate('/auth', { state: { from: '/doc-request?type=water_supply_request' } })}
            className="w-full rounded-2xl bg-sky-700 py-3.5 text-sm font-bold text-white">
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
            เจ้าหน้าที่จะติดต่อกลับเพื่อนัดสำรวจจุดติดตั้งและแจ้งค่าประกันมาตร/ค่าติดตั้ง
            ก่อนดำเนินการต่อไป
          </p>
          {/* ย้ำเรื่องสำเนาที่ต้องนำไปยื่น — ระบบยังไม่มีช่องแนบไฟล์ ถ้าไม่บอกซ้ำตรงนี้
              ประชาชนจะคิดว่ายื่นออนไลน์แล้วจบ แล้วเรื่องค้างที่กองช่างรอเอกสาร */}
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-xs leading-relaxed text-amber-900">
            <p className="mb-1.5 font-bold">เอกสารที่ต้องนำไปยื่นที่สำนักงาน</p>
            <p>1. สำเนาบัตรประจำตัวประชาชน จำนวน 1 ฉบับ</p>
            <p>2. สำเนาทะเบียนบ้าน จำนวน 1 ฉบับ</p>
            <p>3. แผนผังที่ตั้ง จำนวน 1 ฉบับ</p>
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
            <button type="button" onClick={handlePrint}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-700 py-3.5 text-sm font-bold text-white">
              <Printer size={16} /> พิมพ์แบบคำขออนุญาตใช้น้ำประปา
            </button>
            <button type="button" onClick={handleDownloadPdf} disabled={pdfBusy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 py-3.5 text-sm font-bold text-sky-800 disabled:opacity-50">
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
          <Droplets size={21} className="shrink-0 text-sky-700" />
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-800">ขออนุญาตใช้น้ำประปา</p>
            <p className="text-xs text-gray-400">กรอกข้อมูลตามแบบคำขออนุญาตใช้น้ำประปา</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 pb-28 md:px-8 md:pb-8">
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs leading-relaxed text-sky-900">
          ใช้ขอติดตั้งมาตรวัดน้ำและเปิดใช้น้ำประปาของ อปท. สำหรับบ้านหรือสถานที่ที่ยังไม่มีมาตร
          ไม่ใช่การแจ้งน้ำไม่ไหล ท่อแตก หรือขอย้าย/เปลี่ยนมาตรเดิม
        </div>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">ข้อมูลผู้ขออนุญาต</p>
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
          <Field label="เบอร์โทรศัพท์สำหรับติดต่อ" required>
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
              ใช้เปิดทะเบียนผู้ใช้น้ำและผูกค่าประกันมาตรกับตัวผู้ขอ ไม่เปิดเผยต่อสาธารณะตาม พ.ร.บ. PDPA
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
          <p className="text-sm font-bold text-gray-700">สถานที่ที่ขอติดตั้งมาตรวัดน้ำ</p>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5">
            <input type="checkbox" checked={form.same_as_applicant}
              onChange={event => setForm(current => ({ ...current, same_as_applicant: event.target.checked }))}
              className="h-4 w-4 accent-sky-700" />
            <span className="text-sm text-gray-700">เป็นที่อยู่เดียวกับผู้ขออนุญาต</span>
          </label>

          {!form.same_as_applicant && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="บ้านเลขที่" required>
                <input value={form.site.addr_no} onChange={setSite('addr_no')} className={inputCls} />
              </Field>
              <Field label="หมู่ที่" required>
                <input value={form.site.addr_moo} onChange={setSite('addr_moo')} className={inputCls} />
              </Field>
              <Field label="ตำบล" required>
                <input value={form.site.addr_subdistrict} onChange={setSite('addr_subdistrict')} className={inputCls} />
              </Field>
              <Field label="อำเภอ" required>
                <input value={form.site.addr_district} onChange={setSite('addr_district')} className={inputCls} />
              </Field>
              <Field label="จังหวัด" required className="col-span-2">
                <input value={form.site.addr_province} onChange={setSite('addr_province')} className={inputCls} />
              </Field>
            </div>
          )}

          <Field label="ขอเริ่มใช้น้ำประปาตั้งแต่วันที่" required>
            <input type="date" min={todayStr()} value={form.service_start_date}
              onChange={event => setForm(current => ({ ...current, service_start_date: event.target.value }))}
              className={inputCls} />
          </Field>

          <Field label="ปักหมุดจุดที่ขอให้ติดตั้งมาตรวัดน้ำ">
            {/* ห้ามบันทึกจุดที่แผนที่เล็งอยู่ตอนเปิดโดยอัตโนมัติ — LeafletMapPicker ยิง
                onLocationSelect ตั้งแต่ mount ด้วยจุดกึ่งกลางเริ่มต้น (ที่ตั้งสำนักงาน อปท.)
                ถ้ารับค่านั้นเลย ทุกคำขอจะได้หมุดปลอมที่ชี้ไปสำนักงาน ซึ่งแย่กว่าไม่มีหมุด
                เพราะช่างจะเชื่อแล้วขับไปผิดที่ ต้องให้กด "ใช้ตำแหน่งนี้" ยืนยันเสมอ */}
            {form.meter_point ? (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-sky-700" />
                  <div className="min-w-0 flex-1">
                    {form.meter_point.address && (
                      <p className="text-xs leading-snug text-sky-900">{form.meter_point.address}</p>
                    )}
                    <p className="mt-0.5 font-mono text-[11px] text-sky-700">
                      {form.meter_point.lat.toFixed(6)}, {form.meter_point.lng.toFixed(6)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex gap-3">
                  <button type="button"
                    onClick={() => { setPendingPoint(form.meter_point); setMapOpen(true) }}
                    className="text-xs font-semibold text-sky-700 underline">แก้ไขตำแหน่ง</button>
                  <button type="button"
                    onClick={() => setForm(current => ({ ...current, meter_point: null }))}
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
                        meter_point: {
                          lat: Number(pendingPoint.lat),
                          lng: Number(pendingPoint.lng),
                          address: pendingPoint.address ?? '',
                        },
                      }))
                      setMapOpen(false)
                    }}
                    className="flex-1 rounded-xl bg-sky-700 py-2.5 text-sm font-bold text-white disabled:opacity-40">
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
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-sky-300 bg-sky-50/50 py-3 text-sm font-semibold text-sky-700">
                <MapPin size={15} /> เปิดแผนที่เพื่อปักหมุด
              </button>
            )}
            <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
              ไม่บังคับ — ช่วยให้ช่างประปาประเมินระยะเดินท่อและหาจุดติดตั้งได้ตรง
              โดยเฉพาะบ้านในซอยที่ไม่มีป้ายหรือแปลงที่ยังไม่มีเลขที่บ้าน
              เลื่อนแผนที่ให้หมุดตรงจุดที่จะติดตั้งแล้วกด "ใช้ตำแหน่งนี้"
            </p>
          </Field>
        </section>

        {/* ระบบยังไม่มีช่องแนบไฟล์ในคำขอเอกสาร ต้องบอกตั้งแต่ก่อนกดส่งว่ายังต้องเอาสำเนาไปยื่น
            ไม่งั้นประชาชนคิดว่าจบแล้ว แล้วเรื่องค้างรอเอกสารโดยไม่มีใครรู้ */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-600">
          <p className="mb-1.5 text-sm font-bold text-gray-700">สิ่งที่ต้องนำไปยื่นที่สำนักงาน</p>
          <p>1. สำเนาบัตรประจำตัวประชาชน จำนวน 1 ฉบับ</p>
          <p>2. สำเนาทะเบียนบ้าน จำนวน 1 ฉบับ</p>
          <p>3. แผนผังที่ตั้ง จำนวน 1 ฉบับ</p>
          <p className="mt-2 text-[11px] text-gray-400">
            ระบบยังไม่รองรับการแนบไฟล์ในคำขอนี้ กรุณานำสำเนาไปยื่นเมื่อเจ้าหน้าที่นัดสำรวจจุดติดตั้ง
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <input type="checkbox" checked={form.meter_ack}
            onChange={event => setForm(current => ({ ...current, meter_ack: event.target.checked }))}
            className="mt-1 h-5 w-5 shrink-0 accent-sky-700" />
          <span className="text-sm leading-relaxed text-amber-900">
            {/* ถ้อยคำตรงกับประโยคที่ขีดเส้นใต้บนใบพิมพ์เป๊ะ — สิ่งที่ติ๊กยอมรับบนจอต้องเป็นข้อความ
                เดียวกับที่ลงชื่อบนกระดาษ ไม่งั้นเถียงกันภายหลังได้ว่าตกลงอะไรไว้
                (กติกาเดียวกับใบขอรับบริการ/ยกเลิกเก็บขนขยะ) */}
            ข้าพเจ้าขอใช้มาตรวัดน้ำที่ทาง อปท. จัดหาให้
            และยินยอมชำระเงินค่าน้ำประปาและปฏิบัติตามระเบียบข้อบังคับของ อปท. ทุกประการ
          </span>
        </label>

        {/* บอกให้ชัดตั้งแต่ก่อนกดส่งว่าใบที่พิมพ์ออกจะมีชื่อเป็นลายมือชื่อแล้ว ไม่ต้องเซ็นซ้ำ —
            ไม่งั้นประชาชนพิมพ์ใบออกมาแล้วไม่แน่ใจว่าต้องเซ็นอีกไหม เจ้าหน้าที่ก็ตอบไม่ตรงกัน */}
        {session && !staffId && (
          <p className="px-1 text-[11px] leading-relaxed text-gray-500">
            เมื่อกดยืนยัน ระบบจะลงชื่อ “{applicantName || 'ชื่อผู้ขออนุญาต'}” ในแบบคำขอให้อัตโนมัติ
            โดยอ้างอิงการยืนยันตัวตนของบัญชีที่เข้าสู่ระบบ พร้อมวันเวลาและเลขอ้างอิง
          </p>
        )}
        {staffId && (
          <p className="px-1 text-[11px] leading-relaxed text-gray-500">
            กรอกแทนที่เคาน์เตอร์ — ใบที่พิมพ์ออกจะเว้นช่องลงนามไว้ ต้องให้ผู้ขอลงลายมือชื่อด้วยปากกาเสมอ
          </p>
        )}

        <button type="button" onClick={handleSubmit} disabled={!isValid || saving}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-700 py-4 text-sm font-bold text-white shadow-sm disabled:opacity-40">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
          {saving ? 'กำลังส่งคำขอ' : 'ยืนยันและส่งคำขอ'}
        </button>
      </div>
    </div>
  )
}
