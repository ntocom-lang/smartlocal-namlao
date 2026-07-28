import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Loader2, CheckCircle2, Printer, Download, Copy, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { NAME_TITLES, splitThaiFullName } from '../lib/thaiName'
import { buildBuildingPermitHtml } from '../lib/buildingPermitPrint'
import { generateDraftPdfBlob } from '../lib/generateDraftPdf'
import { thaiDate } from '../lib/thaiDate'

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200'
const LAND_DOC_TYPES = ['โฉนดที่ดิน', 'น.ส.๓', 'น.ส.๓ก', 'ส.ค.๑', 'อื่นๆ']
const REQUEST_TYPES = ['ก่อสร้างอาคาร', 'ดัดแปลงอาคาร', 'รื้อถอนอาคาร', 'เคลื่อนย้ายอาคาร']
const STEP_LABELS = ['ผู้ขออนุญาต', 'ที่ตั้ง/ที่ดิน', 'ลักษณะอาคาร', 'ตรวจสอบ']

function emptySite() {
  return {
    addr_no: '', addr_soi: '', addr_road: '', addr_moo: '',
    addr_subdistrict: '', addr_district: '', addr_province: '',
    building_owner_same: true, building_owner_name: '',
    land_doc_type: '', land_doc_type_other: '', land_doc_no: '',
    land_owner_same: true, land_owner_name: '',
  }
}

function Field({ label, required, children, className = '' }) {
  return (
    <div className={className}>
      <label className="text-xs font-semibold text-gray-500 mb-1 block">{label}{required && <span className="text-violet-500"> *</span>}</label>
      {children}
    </div>
  )
}

export default function BuildingPermitWizard({ tenant, session, onBack }) {
  const navigate = useNavigate()
  const [step, setStep]       = useState(1)
  const [saving, setSaving]   = useState(false)
  const [done, setDone]       = useState(null) // { ref, form }
  const [copied, setCopied]   = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  const [form, setForm] = useState({
    applicant: {
      title: '', first: '', last: '', id_card: '',
      addr_no: '', addr_soi: '', addr_road: '', addr_moo: '',
      addr_subdistrict: '', addr_district: '', addr_province: '', addr_zipcode: '',
      phone: '', fax: '',
    },
    request_type: 'ก่อสร้างอาคาร',
    site: emptySite(),
    move_to: null,
    building: { kind: '', count: '1', use: '', parking_count: '', parking_use: '' },
    completion_days: '',
  })

  useEffect(() => {
    if (!session) return
    supabase.from('profiles')
      .select('full_name, phone, id_card, address_detail, address_moo, address_subdistrict, address_district, address_province')
      .eq('id', session.user.id).single()
      .then(({ data: p }) => {
        if (!p) return
        const { title, first, last } = splitThaiFullName(p.full_name)
        setForm(f => ({
          ...f,
          applicant: {
            ...f.applicant,
            title, first, last,
            id_card:          p.id_card ?? '',
            phone:             p.phone ?? '',
            addr_no:           p.address_detail ?? '',
            addr_moo:          p.address_moo ?? '',
            addr_subdistrict:  p.address_subdistrict ?? '',
            addr_district:     p.address_district ?? '',
            addr_province:     p.address_province ?? '',
          },
        }))
      })
  }, [session])

  const setApplicant = k => e => setForm(f => ({ ...f, applicant: { ...f.applicant, [k]: e.target.value } }))
  const setSite       = k => e => setForm(f => ({ ...f, site: { ...f.site, [k]: e.target.value } }))
  const setMoveTo     = k => e => setForm(f => ({ ...f, move_to: { ...(f.move_to || emptySite()), [k]: e.target.value } }))
  const setBuilding   = k => e => setForm(f => ({ ...f, building: { ...f.building, [k]: e.target.value } }))

  const applicantName = `${form.applicant.title}${form.applicant.first} ${form.applicant.last}`.trim()
  const isMove = form.request_type === 'เคลื่อนย้ายอาคาร'

  // ── ตรวจฟิลด์บังคับรายขั้นตอน ────────────────────────────────────────────────
  const step1Valid = form.applicant.title && form.applicant.first.trim() && form.applicant.last.trim()
    && /^\d{13}$/.test(form.applicant.id_card) && form.applicant.addr_no.trim()
    && form.applicant.addr_subdistrict.trim() && form.applicant.addr_district.trim()
    && form.applicant.addr_province.trim() && form.applicant.phone.trim()

  const siteOk = s => s.addr_no.trim() && s.addr_subdistrict.trim() && s.addr_district.trim() && s.addr_province.trim()
    && s.land_doc_type && s.land_doc_no.trim()
    && (s.building_owner_same || s.building_owner_name.trim())
    && (s.land_owner_same || s.land_owner_name.trim())

  const step2Valid = siteOk(form.site) && (!isMove || siteOk(form.move_to || emptySite()))

  const step3Valid = form.building.kind.trim() && String(form.building.count).trim()
    && form.building.use.trim() && String(form.completion_days).trim()

  function goNext() {
    if (step === 1 && !step1Valid) return
    if (step === 2 && !step2Valid) return
    if (step === 3 && !step3Valid) return
    if (step === 4) { handleSubmit(); return }
    setStep(s => s + 1)
  }
  function goBack() {
    if (step === 1) { onBack(); return }
    setStep(s => s - 1)
  }

  async function handleSubmit() {
    setSaving(true)
    // สร้าง id เองฝั่ง client แล้ว insert แบบไม่ .select() กลับ — เพราะ RLS SELECT policy ของ
    // document_requests อนุญาตให้อ่านคืนเฉพาะแถวที่ user_id = auth.uid() เท่านั้น ผู้ยื่นแบบ guest
    // (ไม่ล็อกอิน) ไม่มี auth.uid() เลย ถ้าใช้ .select().single() แบบเดิมจะโดน RLS บล็อกตอนอ่านคืน
    // ทำให้ทั้ง transaction ถูก rollback และเจอ error ทั้งที่ข้อมูลถูกต้องทุกอย่าง (ยืนยันด้วยการยิง
    // REST ตรงด้วย anon key จริงระหว่างทดสอบ)
    const id = crypto.randomUUID()
    const addrParts = [
      form.applicant.addr_no && `เลขที่ ${form.applicant.addr_no}`,
      form.applicant.addr_soi && `ตรอก/ซอย${form.applicant.addr_soi}`,
      form.applicant.addr_road && `ถนน${form.applicant.addr_road}`,
      form.applicant.addr_moo && `หมู่ ${form.applicant.addr_moo}`,
      form.applicant.addr_subdistrict && `ตำบล${form.applicant.addr_subdistrict}`,
      form.applicant.addr_district && `อำเภอ${form.applicant.addr_district}`,
      form.applicant.addr_province && `จังหวัด${form.applicant.addr_province}`,
    ].filter(Boolean).join(' ')

    const { error } = await supabase.from('document_requests').insert({
      id,
      municipality_id:    tenant?.id,
      document_type:      'building_permit',
      requester_name:     applicantName,
      requester_id_card:  form.applicant.id_card || null,
      requester_phone:    form.applicant.phone || null,
      requester_address:  addrParts || null,
      purpose:             `${form.building.kind || 'อาคาร'} — ${form.request_type}`,
      status:              'pending',
      user_id:             session?.user?.id ?? null,
      fee_amount:          null,
      payment_status:      'not_required',
      payment_slip_url:    null,
      permit_form_data:    form,
    })
    setSaving(false)
    if (error) { alert('ส่งคำขอไม่สำเร็จ: ' + error.message); return }
    notifyTelegram(tenant?.telegram_group_id,
      `🏗️ <b>คำขอ ข.๑ ใหม่ (${form.request_type})</b>\nผู้ขอ: ${applicantName}\nเบอร์: ${form.applicant.phone || '-'}\nอาคาร: ${form.building.kind || '-'}`
    )
    setDone({ ref: id.slice(0, 8).toUpperCase(), form })
  }

  function handlePrint() {
    const html = buildBuildingPermitHtml({ form: done.form, tenant, thDate: thaiDate(new Date().toISOString()) })
    const w = window.open('', '_blank', 'width=860,height=1100')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  async function handleDownloadPdf() {
    setPdfBusy(true)
    try {
      const html = buildBuildingPermitHtml({ form: done.form, tenant, thDate: thaiDate(new Date().toISOString()) })
      const blob = await generateDraftPdfBlob(html)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `แบบ-ข1-${done.ref}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setPdfBusy(false)
    }
  }

  // ── Header (ใช้ร่วมทุกขั้นตอน) ───────────────────────────────────────────────
  function Header() {
    return (
      <div className="md:hidden sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={goBack} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <p className="font-bold text-gray-800 leading-tight truncate">แบบ ข.๑ — ขั้นตอน {step}/4</p>
          <p className="text-xs text-gray-400">{STEP_LABELS[step - 1]}</p>
        </div>
      </div>
    )
  }

  // ── Success screen ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundColor: '#eef2f7' }}>
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-violet-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">บันทึกข้อมูลสำเร็จ</h2>
          <p className="text-sm text-gray-500 mb-5 leading-relaxed">
            พิมพ์แบบร่าง ข.๑ ด้านล่าง แล้ว<b>ลงลายมือชื่อจริง</b>ก่อนนำไปยื่นที่กองช่าง<br />
            พร้อมเอกสารตัวจริง (บัตรประชาชน, ทะเบียนบ้าน, โฉนดที่ดิน, แบบแปลน)
          </p>

          <div className="bg-violet-50 border border-violet-100 rounded-2xl p-3 mb-5">
            <p className="text-[11px] text-violet-500 leading-relaxed">
              ช่องผู้ออกแบบและคำนวณ / ผู้ควบคุมงาน เว้นว่างไว้ — กรอกด้วยลายมือหน้างาน<br />
              นี่ไม่ใช่การยื่นขออนุญาตที่จบทางกฎหมายผ่านแอป
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 mb-5">
            <p className="text-xs text-gray-400 mb-1.5">หมายเลขอ้างอิง</p>
            <p className="text-2xl font-bold tracking-widest text-gray-800">{done.ref}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(done.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="flex items-center gap-1.5 mx-auto mt-2.5 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              {copied ? 'คัดลอกแล้ว!' : 'คัดลอกเลขอ้างอิง'}
            </button>
          </div>

          <div className="space-y-2.5">
            <button onClick={handlePrint}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              style={{ backgroundColor: '#7c3aed' }}>
              <Printer size={16} /> พิมพ์แบบร่าง ข.๑
            </button>
            <button onClick={handleDownloadPdf} disabled={pdfBusy}
              className="w-full py-3.5 rounded-2xl font-bold text-violet-700 bg-violet-50 border border-violet-200 text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all">
              {pdfBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {pdfBusy ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลด PDF'}
            </button>
            <button onClick={() => navigate('/')}
              className="w-full py-3 rounded-2xl font-semibold text-gray-500 text-sm">
              กลับหน้าหลัก
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>
      <Header />

      <div className="hidden md:block">
        <div className="px-8 py-3 flex items-center gap-3 bg-white border-b border-gray-200 shadow-sm">
          <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-base font-bold text-gray-800">แบบ ข.๑ — {STEP_LABELS[step - 1]}</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">ขั้นตอน {step} จาก 4</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg md:max-w-2xl mx-auto px-4 md:px-8 py-5 pb-28 md:pb-8 space-y-4">

        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex-1 h-1.5 rounded-full transition-colors"
              style={{ backgroundColor: i + 1 <= step ? '#7c3aed' : '#e5e7eb' }} />
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3.5">

          {/* ── Step 1: ผู้ขออนุญาต ─────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <p className="text-sm font-bold text-gray-700">ข้าพเจ้า (ผู้ขออนุญาต)</p>
              <div className="flex gap-2">
                <Field label="คำนำหน้า" required className="w-24 shrink-0">
                  <select value={form.applicant.title} onChange={setApplicant('title')} className={inputCls}>
                    <option value="">เลือก</option>
                    {NAME_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="ชื่อ" required className="flex-1 min-w-0">
                  <input type="text" value={form.applicant.first} onChange={setApplicant('first')} placeholder="สมชาย" className={inputCls} />
                </Field>
                <Field label="นามสกุล" required className="flex-1 min-w-0">
                  <input type="text" value={form.applicant.last} onChange={setApplicant('last')} placeholder="ใจดี" className={inputCls} />
                </Field>
              </div>

              <Field label="เลขประจำตัวประชาชน (13 หลัก)" required>
                <input type="text" inputMode="numeric" value={form.applicant.id_card} maxLength={13}
                  onChange={e => setForm(f => ({ ...f, applicant: { ...f.applicant, id_card: e.target.value.replace(/\D/g, '').slice(0, 13) } }))}
                  placeholder="1-xxxx-xxxxx-xx-x" className={inputCls} />
              </Field>

              <div className="grid grid-cols-4 gap-2">
                <Field label="บ้านเลขที่" required className="col-span-1">
                  <input type="text" value={form.applicant.addr_no} onChange={setApplicant('addr_no')} className={inputCls} />
                </Field>
                <Field label="ตรอก/ซอย" className="col-span-1">
                  <input type="text" value={form.applicant.addr_soi} onChange={setApplicant('addr_soi')} className={inputCls} />
                </Field>
                <Field label="ถนน" className="col-span-1">
                  <input type="text" value={form.applicant.addr_road} onChange={setApplicant('addr_road')} className={inputCls} />
                </Field>
                <Field label="หมู่ที่" className="col-span-1">
                  <input type="text" value={form.applicant.addr_moo} onChange={setApplicant('addr_moo')} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="ตำบล/แขวง" required>
                  <input type="text" value={form.applicant.addr_subdistrict} onChange={setApplicant('addr_subdistrict')} className={inputCls} />
                </Field>
                <Field label="อำเภอ/เขต" required>
                  <input type="text" value={form.applicant.addr_district} onChange={setApplicant('addr_district')} className={inputCls} />
                </Field>
                <Field label="จังหวัด" required>
                  <input type="text" value={form.applicant.addr_province} onChange={setApplicant('addr_province')} className={inputCls} />
                </Field>
                <Field label="รหัสไปรษณีย์">
                  <input type="text" inputMode="numeric" value={form.applicant.addr_zipcode}
                    onChange={e => setForm(f => ({ ...f, applicant: { ...f.applicant, addr_zipcode: e.target.value.replace(/\D/g, '').slice(0, 5) } }))}
                    className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="โทรศัพท์" required>
                  <input type="tel" inputMode="numeric" value={form.applicant.phone} onChange={setApplicant('phone')} placeholder="08x-xxx-xxxx" className={inputCls} />
                </Field>
                <Field label="โทรสาร">
                  <input type="text" value={form.applicant.fax} onChange={setApplicant('fax')} className={inputCls} />
                </Field>
              </div>
            </>
          )}

          {/* ── Step 2: ที่ตั้ง/ที่ดิน ──────────────────────────────────────── */}
          {step === 2 && (
            <>
              <p className="text-sm font-bold text-gray-700">ข้อ ๑ — ประเภทคำขอ</p>
              <div className="grid grid-cols-2 gap-2">
                {REQUEST_TYPES.map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, request_type: t, move_to: t === 'เคลื่อนย้ายอาคาร' ? (f.move_to || emptySite()) : null }))}
                    className="text-left px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors"
                    style={form.request_type === t
                      ? { borderColor: '#7c3aed', backgroundColor: '#f5f3ff', color: '#7c3aed' }
                      : { borderColor: '#e5e7eb', color: '#374151' }}>
                    {t}
                  </button>
                ))}
              </div>

              <p className="text-sm font-bold text-gray-700 pt-2">ที่ตั้งอาคาร</p>
              <div className="grid grid-cols-4 gap-2">
                <Field label="เลขที่" required><input type="text" value={form.site.addr_no} onChange={setSite('addr_no')} className={inputCls} /></Field>
                <Field label="ตรอก/ซอย"><input type="text" value={form.site.addr_soi} onChange={setSite('addr_soi')} className={inputCls} /></Field>
                <Field label="ถนน"><input type="text" value={form.site.addr_road} onChange={setSite('addr_road')} className={inputCls} /></Field>
                <Field label="หมู่ที่"><input type="text" value={form.site.addr_moo} onChange={setSite('addr_moo')} className={inputCls} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="ตำบล/แขวง" required><input type="text" value={form.site.addr_subdistrict} onChange={setSite('addr_subdistrict')} className={inputCls} /></Field>
                <Field label="อำเภอ/เขต" required><input type="text" value={form.site.addr_district} onChange={setSite('addr_district')} className={inputCls} /></Field>
                <Field label="จังหวัด" required><input type="text" value={form.site.addr_province} onChange={setSite('addr_province')} className={inputCls} /></Field>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-600 pt-1">
                <input type="checkbox" checked={form.site.building_owner_same}
                  onChange={e => setForm(f => ({ ...f, site: { ...f.site, building_owner_same: e.target.checked } }))} />
                เจ้าของอาคารคนเดียวกับผู้ขออนุญาต
              </label>
              {!form.site.building_owner_same && (
                <Field label="ชื่อเจ้าของอาคาร" required>
                  <input type="text" value={form.site.building_owner_name} onChange={setSite('building_owner_name')} className={inputCls} />
                </Field>
              )}

              <p className="text-sm font-bold text-gray-700 pt-2">เอกสารสิทธิ์ที่ดิน</p>
              <div className="grid grid-cols-3 gap-1.5">
                {LAND_DOC_TYPES.map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, site: { ...f.site, land_doc_type: t } }))}
                    className="px-2 py-2 rounded-lg border text-xs font-semibold transition-colors"
                    style={form.site.land_doc_type === t
                      ? { borderColor: '#7c3aed', backgroundColor: '#f5f3ff', color: '#7c3aed' }
                      : { borderColor: '#e5e7eb', color: '#374151' }}>
                    {t}
                  </button>
                ))}
              </div>
              {form.site.land_doc_type === 'อื่นๆ' && (
                <input type="text" value={form.site.land_doc_type_other} onChange={setSite('land_doc_type_other')}
                  placeholder="ระบุประเภทเอกสารสิทธิ์" className={inputCls} />
              )}
              <Field label="เลขที่เอกสารสิทธิ์" required>
                <input type="text" value={form.site.land_doc_no} onChange={setSite('land_doc_no')} className={inputCls} />
              </Field>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={form.site.land_owner_same}
                  onChange={e => setForm(f => ({ ...f, site: { ...f.site, land_owner_same: e.target.checked } }))} />
                เจ้าของที่ดินคนเดียวกับเจ้าของอาคาร
              </label>
              {!form.site.land_owner_same && (
                <Field label="ชื่อเจ้าของที่ดิน" required>
                  <input type="text" value={form.site.land_owner_name} onChange={setSite('land_owner_name')} className={inputCls} />
                </Field>
              )}

              {isMove && (
                <>
                  <p className="text-sm font-bold text-gray-700 pt-2">กรณีเคลื่อนย้ายอาคาร — ที่อยู่ใหม่</p>
                  <div className="grid grid-cols-4 gap-2">
                    <Field label="เลขที่" required><input type="text" value={form.move_to?.addr_no || ''} onChange={setMoveTo('addr_no')} className={inputCls} /></Field>
                    <Field label="ตรอก/ซอย"><input type="text" value={form.move_to?.addr_soi || ''} onChange={setMoveTo('addr_soi')} className={inputCls} /></Field>
                    <Field label="ถนน"><input type="text" value={form.move_to?.addr_road || ''} onChange={setMoveTo('addr_road')} className={inputCls} /></Field>
                    <Field label="หมู่ที่"><input type="text" value={form.move_to?.addr_moo || ''} onChange={setMoveTo('addr_moo')} className={inputCls} /></Field>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="ตำบล/แขวง" required><input type="text" value={form.move_to?.addr_subdistrict || ''} onChange={setMoveTo('addr_subdistrict')} className={inputCls} /></Field>
                    <Field label="อำเภอ/เขต" required><input type="text" value={form.move_to?.addr_district || ''} onChange={setMoveTo('addr_district')} className={inputCls} /></Field>
                    <Field label="จังหวัด" required><input type="text" value={form.move_to?.addr_province || ''} onChange={setMoveTo('addr_province')} className={inputCls} /></Field>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {LAND_DOC_TYPES.map(t => (
                      <button key={t} onClick={() => setForm(f => ({ ...f, move_to: { ...(f.move_to || emptySite()), land_doc_type: t } }))}
                        className="px-2 py-2 rounded-lg border text-xs font-semibold transition-colors"
                        style={form.move_to?.land_doc_type === t
                          ? { borderColor: '#7c3aed', backgroundColor: '#f5f3ff', color: '#7c3aed' }
                          : { borderColor: '#e5e7eb', color: '#374151' }}>
                        {t}
                      </button>
                    ))}
                  </div>
                  <Field label="เลขที่เอกสารสิทธิ์ (ที่ดินใหม่)" required>
                    <input type="text" value={form.move_to?.land_doc_no || ''} onChange={setMoveTo('land_doc_no')} className={inputCls} />
                  </Field>
                </>
              )}
            </>
          )}

          {/* ── Step 3: ลักษณะอาคาร ─────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <p className="text-sm font-bold text-gray-700">ข้อ ๒ — ลักษณะอาคาร</p>
              <Field label="ชนิดอาคาร" required>
                <input type="text" value={form.building.kind} onChange={setBuilding('kind')} placeholder="เช่น บ้านพักอาศัย 2 ชั้น" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="จำนวน" required>
                  <input type="text" value={form.building.count} onChange={setBuilding('count')} placeholder="1 หลัง" className={inputCls} />
                </Field>
                <Field label="เพื่อใช้เป็น (อาคาร)" required>
                  <input type="text" value={form.building.use} onChange={setBuilding('use')} placeholder="ที่อยู่อาศัย" className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="ที่จอดรถ (จำนวนคัน)">
                  <input type="text" inputMode="numeric" value={form.building.parking_count}
                    onChange={e => setForm(f => ({ ...f, building: { ...f.building, parking_count: e.target.value.replace(/\D/g, '') } }))}
                    className={inputCls} />
                </Field>
                <Field label="เพื่อใช้เป็น (ที่จอดรถ)">
                  <input type="text" value={form.building.parking_use} onChange={setBuilding('parking_use')} className={inputCls} />
                </Field>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                * ตามแผนผังบริเวณ แบบแปลน รายการประกอบแบบแปลน และรายการคำนวณ — นำเอกสารตัวจริงไปยื่นที่กองช่างแยกต่างหาก (ระบบนี้ยังไม่มีช่องแนบไฟล์)
              </p>

              <p className="text-sm font-bold text-gray-700 pt-2">ข้อ ๕ — กำหนดแล้วเสร็จ</p>
              <Field label="จำนวนวัน นับแต่วันที่ได้รับใบอนุญาต" required>
                <input type="text" inputMode="numeric" value={form.completion_days}
                  onChange={e => setForm(f => ({ ...f, completion_days: e.target.value.replace(/\D/g, '') }))}
                  placeholder="เช่น 180" className={inputCls} />
              </Field>
            </>
          )}

          {/* ── Step 4: ตรวจสอบและยืนยัน ────────────────────────────────────── */}
          {step === 4 && (
            <>
              <p className="text-sm font-bold text-gray-700">ตรวจสอบข้อมูลก่อนส่ง</p>
              <div className="space-y-2 text-xs text-gray-600">
                <SummaryRow label="ผู้ขออนุญาต" value={applicantName} />
                <SummaryRow label="เลขบัตรประชาชน" value={form.applicant.id_card} />
                <SummaryRow label="โทรศัพท์" value={form.applicant.phone} />
                <SummaryRow label="ประเภทคำขอ" value={form.request_type} />
                <SummaryRow label="ที่ตั้งอาคาร" value={[form.site.addr_no && `เลขที่ ${form.site.addr_no}`, form.site.addr_subdistrict && `ตำบล${form.site.addr_subdistrict}`, form.site.addr_district && `อำเภอ${form.site.addr_district}`].filter(Boolean).join(' ')} />
                <SummaryRow label="เอกสารสิทธิ์ที่ดิน" value={`${form.site.land_doc_type || '-'} เลขที่ ${form.site.land_doc_no || '-'}`} />
                <SummaryRow label="ชนิดอาคาร" value={`${form.building.kind || '-'} จำนวน ${form.building.count || '-'} เพื่อใช้เป็น ${form.building.use || '-'}`} />
                <SummaryRow label="กำหนดแล้วเสร็จ" value={form.completion_days ? `${form.completion_days} วัน` : '-'} />
              </div>

              <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 space-y-1.5 mt-2">
                <p className="text-xs font-bold text-violet-700">ก่อนกดยืนยัน โปรดทราบ</p>
                <p className="text-xs text-violet-600 leading-relaxed">
                  ระบบจะสร้างไฟล์ "แบบร่าง ข.๑" ให้พิมพ์ — ช่องผู้ออกแบบและคำนวณ และผู้ควบคุมงาน
                  (มีเลขทะเบียนใบอนุญาตประกอบวิชาชีพ) จะเว้นว่างไว้ให้สถาปนิก/วิศวกรกรอกด้วยลายมือ
                  ท่านต้องลงลายมือชื่อผู้ขออนุญาตด้วยตนเองบนแบบร่างนี้ ก่อนนำไปยื่นที่กองช่างพร้อมเอกสารตัวจริง —
                  นี่ไม่ใช่การยื่นขออนุญาตที่สมบูรณ์ทางกฎหมาย
                </p>
              </div>
            </>
          )}
        </div>

        <button onClick={goNext}
          disabled={saving || (step === 1 && !step1Valid) || (step === 2 && !step2Valid) || (step === 3 && !step3Valid)}
          className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all"
          style={{ backgroundColor: '#7c3aed' }}>
          {saving ? <Loader2 size={18} className="animate-spin" /> : (step === 4 ? <CheckCircle2 size={18} /> : <ChevronRight size={18} />)}
          {saving ? 'กำลังบันทึก...' : step === 4 ? 'ยืนยันและสร้างแบบร่าง' : 'ถัดไป'}
        </button>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 w-32 shrink-0">{label}</span>
      <span className="text-gray-700 flex-1">{value || '-'}</span>
    </div>
  )
}
