import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Check, CheckCircle2, Copy, Download, HandHeart, Loader2, Plus, Printer, Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { NAME_TITLES, splitThaiFullName } from '../lib/thaiName'
import { generateDraftPdfBlob } from '../lib/generateDraftPdf'
import { tenantDefaultSubdistrict } from '../lib/tenantSubdistrict'
import {
  NEED_MAX_CHARS, PROBLEM_MAX_CHARS, buildPublicAssistanceRequestHtml,
} from '../lib/publicAssistancePrint'

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-rose-200'

// เพดานจำนวนแถวที่กรอกในระบบได้ — 2 หน้าแนบท้าย (33 × 2) พอสำหรับเหตุที่ อปท. รับเรื่องเอง
// ถ้ามีผู้เดือดร้อนมากกว่านี้จริง (อุทกภัยทั้งตำบล) เป็นงานที่ต้องตั้งศูนย์ช่วยเหลือและใช้บัญชี
// ของ อปท. เอง ไม่ใช่คำร้องรายบุคคลผ่านแอป — ให้พิมพ์ใบเปล่าไปเก็บรายชื่อต่อด้วยปากกาแทน
const MAX_AFFECTED_ROWS = 66

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
 * แบบคำร้องขอรับการช่วยเหลือประชาชน — โครงเดียวกับ WaterSupplyRequestWizard
 *
 * เก็บข้อมูลให้ครบตามใบพิมพ์ (publicAssistancePrint.js) โดยมีของที่ใบอื่นไม่มี 2 อย่าง:
 *   1. ช่องบรรยาย 2 ช่องที่มีเพดานตัวอักษรตายตัว — ใบพิมพ์เป็นกล่องเส้นประความสูงคงที่
 *      ข้อความยาวเกินจะล้นทับบล็อกถัดไปเงียบๆ เพดานจึงต้องบังคับตั้งแต่ตอนกรอก
 *      ไม่ใช่ไปตัดตอนพิมพ์ (ผู้ยื่นต้องรู้ตัวว่าเขียนได้อีกกี่ตัวอักษร)
 *   2. บัญชีผู้ได้รับความเดือดร้อน — ข้อมูลของ "บุคคลที่สาม" ที่ไม่ได้กดยินยอมในระบบเอง
 *
 * ⚠️ PDPA: บัญชีแนบท้ายเก็บได้เฉพาะ ชื่อ-สกุล / บ้านเลขที่ / หมู่ที่ / หมายเหตุ ตามที่ต้นฉบับ
 * ต้องการเท่านั้น ห้ามเพิ่มช่องเลขบัตรประชาชนหรือเบอร์โทรของคนในบัญชีเด็ดขาด — คนเหล่านี้
 * ไม่ได้เป็นผู้ใช้ระบบ ไม่ได้ยืนยันตัวตน และไม่มีทางถอนความยินยอมผ่านแอปได้
 *
 * ⚠️ ใบนี้เป็น "คำร้อง" การช่วยเหลือจริงต้องผ่านขั้นตอนตามระเบียบกระทรวงมหาดไทยว่าด้วย
 * ค่าใช้จ่ายเพื่อช่วยเหลือประชาชนตามอำนาจหน้าที่ของ อปท. — ห้ามเขียนข้อความใดในหน้าจอนี้
 * ที่ทำให้ประชาชนเข้าใจว่ายื่นแล้วได้รับความช่วยเหลือแน่นอน
 */
export default function PublicAssistanceWizard({ tenant, session, onBack, staffId, onDone }) {
  const navigate = useNavigate()
  const tenantAddress = tenantAddressDefaults(tenant)
  const [saving, setSaving] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [done, setDone] = useState(null)
  const [departments, setDepartments] = useState([])
  const [form, setForm] = useState(() => ({
    form_type: 'public_assistance_request',
    form_version: 1,
    subject: '',
    applicant: {
      title: '', first: '', last: '', phone: '', id_card: '',
      addr_no: '', addr_moo: '',
      addr_subdistrict: tenantAddress.subdistrict,
      addr_district: tenantAddress.district,
      addr_province: tenantAddress.province,
    },
    problem: '',
    need: '',
    affected: [],
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
            // ตำบล/อำเภอ/จังหวัดยึดข้อมูล อปท. ตามแบบคำร้อง ไม่ดึงที่อยู่โปรไฟล์ซึ่งอาจอยู่นอกเขต
          },
        }))
      })
  }, [session])

  // กองของ อปท. ใช้เป็นช่องติ๊ก "ส่วนงานที่รับผิดชอบ" บนใบพิมพ์ — ไม่ใช่ข้อมูลที่ผู้ยื่นกรอก
  // อ่านไม่ได้ก็ไม่เป็นไร ใบจะตกไปใช้ 4 กองตามต้นฉบับแทน (ดู deptBoxes ในไฟล์ใบพิมพ์)
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('departments')
      .select('name')
      .eq('municipality_id', tenant.id)
      .order('name')
      .then(({ data }) => setDepartments(data ?? []))
  }, [tenant?.id])

  const setApplicant = key => event => {
    const value = event.target.value
    setForm(current => ({ ...current, applicant: { ...current.applicant, [key]: value } }))
  }

  const setAffected = (index, key) => event => {
    const value = event.target.value
    setForm(current => ({
      ...current,
      affected: current.affected.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [key]: value } : row
      )),
    }))
  }

  function addAffectedRow() {
    setForm(current => (current.affected.length >= MAX_AFFECTED_ROWS ? current : {
      ...current,
      affected: [...current.affected, { name: '', addr_no: '', addr_moo: '', note: '' }],
    }))
  }

  function removeAffectedRow(index) {
    setForm(current => ({
      ...current,
      affected: current.affected.filter((unused, rowIndex) => rowIndex !== index),
    }))
  }

  const applicant = form.applicant
  const applicantName = `${applicant.title}${applicant.first} ${applicant.last}`.trim()
  const phoneDigits = applicant.phone.replace(/\D/g, '')
  // เลขบัตร 13 หลักไม่ตรวจ checksum โดยเจตนา — ให้ตรงกับด่านยืนยันตัวตนใน CitizenDocRequest
  // ที่ใช้ /^\d{13}$/ ถ้าเข้มกว่ากันจะเกิดเคสที่ผ่านด่านแรกมาแล้วแต่มาตกที่ฟอร์มนี้
  const idCardDigits = applicant.id_card.replace(/\D/g, '')

  // แถวที่กรอกชื่อไว้เท่านั้นที่นับเป็นรายชื่อจริง — แถวเปล่าที่กดเพิ่มแล้วไม่ได้กรอกต้องไม่ถูก
  // นับเข้า "จำนวนผู้เดือดร้อน" บนใบ ไม่งั้นเลขบนใบจะเกินจำนวนคนที่เซ็นในบัญชีแนบท้าย
  const filledAffected = form.affected
    .map(row => ({
      name: row.name.trim(),
      addr_no: row.addr_no.trim(),
      addr_moo: row.addr_moo.trim(),
      note: row.note.trim(),
    }))
    .filter(row => row.name)

  const isValid = Boolean(
    form.subject.trim()
    && applicant.title
    && applicant.first.trim()
    && applicant.last.trim()
    && applicant.addr_no.trim()
    && applicant.addr_moo.trim()
    && applicant.addr_subdistrict.trim()
    && applicant.addr_district.trim()
    && applicant.addr_province.trim()
    && phoneDigits.length >= 9 && phoneDigits.length <= 15
    && idCardDigits.length === 13
    && form.problem.trim()
    && form.need.trim(),
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
      subject: form.subject.trim(),
      applicant: { ...applicant, id_card: idCardDigits },
      problem: form.problem.trim(),
      need: form.need.trim(),
      affected: filledAffected,
      signed_at: submittedAt,
      signed_by: {
        channel,
        name: applicantName,
        user_id: channel === 'online' ? (session?.user?.id ?? null) : null,
        entered_by_staff_id: staffId ?? null,
      },
    }

    const { error } = await supabase.from('document_requests').insert({
      id,
      municipality_id: tenant?.id,
      document_type: 'public_assistance_request',
      requester_name: applicantName,
      // ต้องมีเลขบัตรเสมอ — คำร้องนี้ผูกกับสิทธิ์รับความช่วยเหลือจากงบประมาณของ อปท.
      // เจ้าหน้าที่ต้องตรวจสอบตัวบุคคลและความซ้ำซ้อนได้ (ไม่พิมพ์ลงใบ ดูเหตุผลในไฟล์ใบพิมพ์)
      requester_id_card: idCardDigits,
      requester_phone: applicant.phone.trim(),
      requester_address: [
        `บ้านเลขที่ ${applicant.addr_no.trim()}`,
        `หมู่ที่ ${applicant.addr_moo.trim()}`,
        `ตำบล${applicant.addr_subdistrict.trim()}`,
        `อำเภอ${applicant.addr_district.trim()}`,
        `จังหวัด${applicant.addr_province.trim()}`,
      ].join(' '),
      // purpose ถูกโชว์ดิบๆ ในตารางเจ้าหน้าที่และหน้า "เอกสารของฉัน" จึงใช้ "เรื่อง" ที่ผู้ยื่น
      // เขียนเอง ซึ่งเป็นสิ่งเดียวกับที่เจ้าหน้าที่ต้องอ่านก่อนตัดสินใจว่าจะส่งต่อกองไหน
      purpose: form.subject.trim(),
      status: 'pending',
      user_id: session?.user?.id ?? null,
      assigned_to: staffId ?? null,
      // คำร้องขอความช่วยเหลือไม่มีค่าธรรมเนียม — เป็นการขอรับความช่วยเหลือ ไม่ใช่ขอรับบริการ
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
    return buildPublicAssistanceRequestHtml({
      form: done.form,
      tenant,
      docDate: done.signedAt,
      referenceNo: done.ref,
      signedAt: done.signedAt,
      departments,
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
      anchor.download = `คำร้องขอรับการช่วยเหลือ-${done.ref}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setPdfBusy(false)
    }
  }

  // ต้องล็อกอินด้วยเหตุผลเดียวกับใบขอรับบริการเก็บขนขยะ (RLS อ่านคืนได้เฉพาะแถวที่
  // user_id = auth.uid() ผู้ยื่นแบบ guest จะตามสถานะไม่ได้เลย) และอีกข้อที่หนักกว่า:
  // คำร้องนี้เป็นการขอรับความช่วยเหลือจากงบประมาณในชื่อของผู้ยื่นและมีบัญชีรายชื่อผู้เดือดร้อน
  // แนบท้าย ถ้ายื่นได้โดยไม่ยืนยันตัวตน ใครก็ยื่นในชื่อคนอื่นหรือกรอกรายชื่อชาวบ้านมั่วได้
  if (!session && !staffId) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50">
            <HandHeart size={30} className="text-rose-700" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-gray-800">เข้าสู่ระบบก่อนยื่นคำร้อง</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-500">
            คำร้องขอรับการช่วยเหลือยื่นในชื่อของท่านและมีบัญชีรายชื่อผู้เดือดร้อนแนบท้าย
            จึงต้องเข้าสู่ระบบเพื่อยืนยันตัวตนผู้ยื่นและให้ท่านติดตามสถานะได้
          </p>
          <button type="button"
            onClick={() => navigate('/auth', { state: { from: '/doc-request?type=public_assistance_request' } })}
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
          {/* ⚠️ ห้ามเขียนทำนองว่า "จะได้รับความช่วยเหลือ" — การช่วยเหลือต้องผ่านการพิจารณา
              ตามระเบียบและงบประมาณที่มี ระบบนี้รับเรื่องเท่านั้น */}
          <p className="mb-5 text-sm leading-relaxed text-gray-500">
            เจ้าหน้าที่จะตรวจสอบข้อเท็จจริงและเสนอผู้บริหารพิจารณาตามระเบียบ
            แล้วติดต่อกลับตามเบอร์โทรที่ท่านให้ไว้
          </p>
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-xs leading-relaxed text-amber-900">
            <p className="mb-1.5 font-bold">ถ้ามีผู้เดือดร้อนรายอื่นเพิ่มอีก</p>
            <p>
              พิมพ์คำร้องนี้ออกมา แล้วให้ผู้เดือดร้อนรายอื่นลงชื่อในบัญชีแนบท้าย (หน้า 2)
              ด้วยปากกา แล้วนำมายื่นที่สำนักงาน — ระบบไม่ลงลายมือชื่อแทนผู้อื่นให้
            </p>
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
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-700 py-3.5 text-sm font-bold text-white">
              <Printer size={16} /> พิมพ์คำร้อง + บัญชีแนบท้าย
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

  const problemLeft = PROBLEM_MAX_CHARS - form.problem.length
  const needLeft = NEED_MAX_CHARS - form.need.length

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3 shadow-sm">
        <button type="button" onClick={onBack} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100">
          <ArrowLeft size={18} />
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <HandHeart size={21} className="shrink-0 text-rose-700" />
          <div className="min-w-0">
            <p className="truncate font-bold text-gray-800">ขอรับการช่วยเหลือประชาชน</p>
            <p className="text-xs text-gray-400">กรอกข้อมูลตามแบบคำร้องขอรับการช่วยเหลือประชาชน</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 pb-10 md:px-8">
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-xs leading-relaxed text-rose-900">
          ใช้ยื่นขอรับความช่วยเหลือจาก อปท. กรณีได้รับความเดือดร้อน เช่น สาธารณภัย
          ที่อยู่อาศัยเสียหาย หรือความเดือดร้อนด้านสาธารณูปโภค — เป็นการยื่นคำร้องเพื่อให้
          เจ้าหน้าที่ตรวจสอบและเสนอผู้บริหารพิจารณาตามระเบียบ ไม่ใช่การอนุมัติความช่วยเหลือทันที
        </div>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">เรื่องที่ขอความช่วยเหลือ</p>
          <Field label="เรื่อง" required>
            <input value={form.subject} maxLength={120}
              onChange={event => setForm(current => ({ ...current, subject: event.target.value }))}
              placeholder="เช่น ขอรับการช่วยเหลือกรณีน้ำท่วมบ้านเรือนราษฎร หมู่ที่ 5"
              className={inputCls} />
          </Field>
        </section>

        <section className="space-y-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-700">ข้อมูลผู้ขอความช่วยเหลือ</p>
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
            <Field label="นามสกุล" required className="col-span-12 sm:col-span-5">
              <input value={applicant.last} onChange={setApplicant('last')} className={inputCls} />
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
              ใช้ตรวจสอบตัวบุคคลและความซ้ำซ้อนของการช่วยเหลือ ไม่พิมพ์ลงในใบคำร้อง
              และไม่เปิดเผยต่อสาธารณะตาม พ.ร.บ. PDPA
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
          <p className="text-sm font-bold text-gray-700">รายละเอียดความเดือดร้อน</p>
          <Field label="๑. ปัญหาความเดือดร้อน" required>
            <textarea value={form.problem} rows={5} maxLength={PROBLEM_MAX_CHARS}
              onChange={event => setForm(current => ({ ...current, problem: event.target.value }))}
              placeholder="เกิดอะไรขึ้น เมื่อไร ที่ไหน เสียหายอย่างไร กี่หลังคาเรือน"
              className={inputCls} />
            {/* ตัวนับต้องมองเห็นเสมอ ไม่ใช่เตือนตอนพิมพ์เต็มแล้ว — ใบพิมพ์เป็นกล่องเส้นประ
                ความสูงคงที่ ข้อความเกินเพดานจะล้นทับบล็อกถัดไป จึงตัดที่ maxLength ตั้งแต่ต้น */}
            <p className={`mt-1 text-[11px] ${problemLeft <= 40 ? 'text-rose-600' : 'text-gray-400'}`}>
              เหลือ {problemLeft} ตัวอักษร (เขียนได้เท่าที่พิมพ์ลงในใบคำร้องได้พอดี
              ถ้ามีรายละเอียดมากกว่านี้ให้แนบเอกสารเพิ่มที่สำนักงาน)
            </p>
          </Field>
          <Field label="๒. ความต้องการรับการช่วยเหลือ" required>
            <textarea value={form.need} rows={3} maxLength={NEED_MAX_CHARS}
              onChange={event => setForm(current => ({ ...current, need: event.target.value }))}
              placeholder="ต้องการให้ อปท. ช่วยเหลือเรื่องใด"
              className={inputCls} />
            <p className={`mt-1 text-[11px] ${needLeft <= 30 ? 'text-rose-600' : 'text-gray-400'}`}>
              เหลือ {needLeft} ตัวอักษร
            </p>
          </Field>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-700">บัญชีผู้ได้รับความเดือดร้อน (ถ้ามี)</p>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-400">
                กรอกเฉพาะรายที่ท่านทราบชื่อและได้รับความยินยอมแล้ว — ไม่กรอกก็ได้
                ระบบจะพิมพ์บัญชีแนบท้ายเปล่าให้ไปเก็บลายมือชื่อเองด้วยปากกา
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
              {filledAffected.length} คน
            </span>
          </div>

          {/* ⚠️ PDPA: ห้ามเพิ่มช่องเลขบัตรประชาชน/เบอร์โทรของคนในบัญชี — เขาไม่ได้เป็นผู้ใช้ระบบ
              ไม่ได้ยืนยันตัวตนเอง และถอนความยินยอมผ่านแอปไม่ได้ เก็บเท่าที่ต้นฉบับต้องการเท่านั้น */}
          <div className="rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
            ท่านต้องได้รับความยินยอมจากผู้มีรายชื่อก่อนกรอกข้อมูลของเขาลงในระบบ
            และผู้มีรายชื่อต้องลงลายมือชื่อในบัญชีแนบท้ายด้วยตนเองเมื่อพิมพ์ใบออกมา
          </div>

          {form.affected.map((row, index) => (
            <div key={index} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">ลำดับที่ {index + 1}</span>
                <button type="button" onClick={() => removeAffectedRow(index)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                  <Trash2 size={13} /> ลบ
                </button>
              </div>
              <div className="grid grid-cols-12 gap-2">
                <Field label="ชื่อ-สกุล" className="col-span-12">
                  <input value={row.name} onChange={setAffected(index, 'name')}
                    placeholder="เช่น นายสมชาย ใจดี" className={inputCls} />
                </Field>
                <Field label="บ้านเลขที่" className="col-span-4">
                  <input value={row.addr_no} onChange={setAffected(index, 'addr_no')} className={inputCls} />
                </Field>
                <Field label="หมู่ที่" className="col-span-3">
                  <input value={row.addr_moo} onChange={setAffected(index, 'addr_moo')} className={inputCls} />
                </Field>
                <Field label="หมายเหตุ" className="col-span-5">
                  <input value={row.note} onChange={setAffected(index, 'note')}
                    placeholder="เช่น ผู้สูงอายุ" className={inputCls} />
                </Field>
              </div>
            </div>
          ))}

          {form.affected.length < MAX_AFFECTED_ROWS ? (
            <button type="button" onClick={addAffectedRow}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50">
              <Plus size={15} /> เพิ่มรายชื่อผู้เดือดร้อน
            </button>
          ) : (
            <p className="rounded-xl bg-gray-50 p-3 text-center text-xs text-gray-500">
              กรอกในระบบได้สูงสุด {MAX_AFFECTED_ROWS} รายชื่อ
              หากมีมากกว่านี้ให้พิมพ์บัญชีแนบท้ายเพิ่มแล้วเขียนด้วยปากกา
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-4 text-xs leading-relaxed text-gray-500 shadow-sm">
          {session && !staffId ? (
            <>
              เมื่อกดยืนยัน ระบบจะลงชื่อ “{applicantName || 'ชื่อผู้ขอความช่วยเหลือ'}”
              ในคำร้องให้อัตโนมัติ โดยถือเป็นการลงลายมือชื่อทางอิเล็กทรอนิกส์จากบัญชีที่ท่าน
              ยืนยันตัวตนแล้ว
            </>
          ) : (
            <>
              เจ้าหน้าที่กรอกแทนผู้ยื่น — ใบที่พิมพ์ออกจะเว้นช่องลงชื่อไว้ให้ผู้ขอความช่วยเหลือ
              เซ็นด้วยปากกา ระบบจะไม่พิมพ์ชื่อแทนการลงลายมือชื่อ
            </>
          )}
        </section>
        <button type="button" onClick={handleSubmit} disabled={!isValid || saving}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-700 py-4 text-sm font-bold text-white shadow-sm disabled:opacity-40">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
          {saving ? 'กำลังส่งคำร้อง' : 'ยืนยันและส่งคำร้อง'}
        </button>
      </div>
    </div>
  )
}
