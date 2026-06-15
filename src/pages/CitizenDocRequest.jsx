import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, FileText, CheckCircle2, Loader2, Copy, Check, ChevronRight, ShieldCheck, Upload, CreditCard, ImageIcon } from 'lucide-react'
import QRCode from 'react-qr-code'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { notifyTelegram } from '../lib/notifyTelegram'
import { generatePromptPayPayload } from '../lib/promptpay'

const DOC_TYPES = [
  {
    value:   'residence_cert',
    label:   'ใบรับรองการอยู่อาศัย',
    emoji:   '🏠',
    desc:    'ยืนยันที่อยู่อาศัยในเขต เพื่อยื่นเอกสารต่างๆ',
    color:   '#2563eb',
    bg:      '#eff6ff',
    border:  '#bfdbfe',
  },
  {
    value:   'personal_cert',
    label:   'หนังสือรับรองบุคคล',
    emoji:   '👤',
    desc:    'รับรองตัวตนและสถานะการอยู่ในทะเบียนราษฎร',
    color:   '#7c3aed',
    bg:      '#f5f3ff',
    border:  '#ddd6fe',
  },
  {
    value:   'conduct_cert',
    label:   'หนังสือรับรองความประพฤติ',
    emoji:   '✅',
    desc:    'ไม่มีประวัติอาชญากรรม เหมาะสำหรับสมัครงาน',
    color:   '#059669',
    bg:      '#ecfdf5',
    border:  '#a7f3d0',
  },
  {
    value:   'tax_notice',
    label:   'ชำระภาษีที่ดินและสิ่งปลูกสร้าง',
    emoji:   '🏦',
    desc:    'ชำระภาษีที่ดินและสิ่งปลูกสร้างประจำปีผ่านระบบออนไลน์',
    color:   '#d97706',
    bg:      '#fffbeb',
    border:  '#fde68a',
  },
  {
    value:   'waste_collection',
    label:   'ชำระค่าธรรมเนียมเก็บขนขยะ',
    emoji:   '🗑️',
    desc:    'ชำระค่าธรรมเนียมเก็บและขนขยะมูลฝอยผ่านระบบออนไลน์',
    color:   '#0891b2',
    bg:      '#ecfeff',
    border:  '#a5f3fc',
  },
  {
    value:   'other',
    label:   'คำขออื่นๆ',
    emoji:   '📝',
    desc:    'เอกสารอื่นๆ ระบุรายละเอียดในแบบฟอร์ม',
    color:   '#64748b',
    bg:      '#f8fafc',
    border:  '#e2e8f0',
  },
]

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function CitizenDocRequest() {
  const navigate  = useNavigate()
  const { tenant } = useTenant()
  const [session, setSession]     = useState(undefined)
  const [selected, setSelected]   = useState(null)
  const [form, setForm]           = useState({ requester_name: '', requester_id_card: '', requester_phone: '', requester_address: '', purpose: '' })
  const [saving, setSaving]       = useState(false)
  const [done, setDone]           = useState(null)
  const [copied, setCopied]       = useState(false)
  // ── payment step ────────────────────────────────────────────────────────────
  const [showPayment, setShowPayment] = useState(false)  // true = กำลังแสดงหน้าชำระ
  const [slipFile, setSlipFile]       = useState(null)
  const [slipPreview, setSlipPreview] = useState(null)
  const [slipUploading, setSlipUploading] = useState(false)
  // ── identity verification gate ──────────────────────────────────────────────
  const [needsIdCard, setNeedsIdCard]   = useState(null) // null=loading, true=needs verify, false=ok
  const [verifyInput, setVerifyInput]   = useState('')
  const [verifyError, setVerifyError]   = useState('')
  const [verifySaving, setVerifySaving] = useState(false)
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        supabase.from('profiles').select('full_name, phone, id_card').eq('id', data.session.user.id).single()
          .then(({ data: p }) => {
            if (p) {
              setForm(f => ({
                ...f,
                requester_name:    p.full_name ?? '',
                requester_phone:   p.phone     ?? '',
                requester_id_card: p.id_card   ?? '',
              }))
              setNeedsIdCard(!p.id_card)
            } else {
              setNeedsIdCard(false)
            }
          })
      } else {
        setNeedsIdCard(false) // guest — กรอกเองในฟอร์ม
      }
    })
  }, [])

  async function handleVerifyIdCard() {
    const v = verifyInput.trim()
    if (!/^\d{13}$/.test(v)) {
      setVerifyError('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก')
      return
    }
    setVerifySaving(true)
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: session.user.id, id_card: v }, { onConflict: 'id' })
    setVerifySaving(false)
    if (error) { setVerifyError('บันทึกไม่สำเร็จ กรุณาลองใหม่'); return }
    setForm(f => ({ ...f, requester_id_card: v }))
    setNeedsIdCard(false)
  }

  const feeAmount = selected ? ((tenant?.fee_schedule ?? {})[selected.value] ?? 0) : 0
  const requiresPayment = feeAmount > 0 && !!tenant?.promptpay_id

  // ขั้นที่ 1: ตรวจว่าต้องชำระหรือไม่ — ถ้าใช่ไปหน้าชำระก่อน
  function handleFormNext() {
    if (!form.requester_name.trim() || !form.requester_phone.trim()) return
    if (requiresPayment) { setShowPayment(true); return }
    handleSubmit(null) // ไม่มีค่าธรรมเนียม ส่งตรง
  }

  function handleSlipChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSlipFile(file)
    setSlipPreview(URL.createObjectURL(file))
  }

  async function handleSubmit(slipUrl) {
    setSaving(true)
    const { data } = await supabase.from('document_requests').insert({
      municipality_id:   tenant?.id,
      document_type:     selected.value,
      requester_name:    form.requester_name.trim(),
      requester_id_card: form.requester_id_card.trim() || null,
      requester_phone:   form.requester_phone.trim() || null,
      requester_address: form.requester_address.trim() || null,
      purpose:           form.purpose.trim() || null,
      status:            'pending',
      user_id:           session?.user?.id ?? null,
      fee_amount:        feeAmount || null,
      payment_status:    feeAmount > 0 ? (slipUrl ? 'uploaded' : 'pending') : 'not_required',
      payment_slip_url:  slipUrl ?? null,
    }).select().single()
    setSaving(false)
    if (data) {
      notifyTelegram(tenant?.telegram_group_id,
        `📄 <b>คำขอเอกสารใหม่</b>\nประเภท: ${selected.label}\nผู้ขอ: ${form.requester_name.trim()}\nเบอร์: ${form.requester_phone?.trim() || '-'}${feeAmount > 0 ? `\n💰 ค่าธรรมเนียม: ${feeAmount} บาท${slipUrl ? ' (แนบสลิปแล้ว)' : ' (รอชำระ)'}` : ''}`
      )
      setDone({ ref: data.id.slice(0, 8).toUpperCase() })
    }
  }

  async function handlePaymentSubmit() {
    let slipUrl = null
    if (slipFile) {
      setSlipUploading(true)
      const ext = slipFile.name.split('.').pop()
      const slipPath = `${tenant?.id ?? 'org'}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('payment-slips').upload(slipPath, slipFile, { upsert: false })
      if (!error) slipUrl = slipPath  // store path, not public URL (bucket is private)
      setSlipUploading(false)
    }
    await handleSubmit(slipUrl)
  }

  if (session === undefined || needsIdCard === null) return null

  // ─── Payment Screen ────────────────────────────────────────────────────────
  if (showPayment && selected) {
    const qrPayload = generatePromptPayPayload(tenant.promptpay_id, feeAmount)
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
          <button onClick={() => setShowPayment(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500">
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="font-bold text-gray-800">ชำระค่าธรรมเนียม</p>
            <p className="text-xs text-gray-400">สแกน QR แล้วอัปโหลดสลิป</p>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-5 pb-12 space-y-4">

          {/* Amount banner */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
              <CreditCard size={22} className="text-white" />
            </div>
            <div>
              <p className="text-xs text-emerald-600 font-semibold">{selected.label}</p>
              <p className="text-2xl font-black text-emerald-700">{feeAmount.toLocaleString()} บาท</p>
              <p className="text-xs text-emerald-500 mt-0.5">ค่าธรรมเนียมออกเอกสาร</p>
            </div>
          </div>

          {/* QR Code */}
          {qrPayload && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center gap-4">
              <p className="text-sm font-bold text-gray-700">สแกนด้วยแอปธนาคาร / เป๋าตัง / True Money</p>
              <div className="p-4 bg-white rounded-2xl border-2 border-gray-100 shadow-inner">
                <QRCode value={qrPayload} size={180} />
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400">PromptPay</p>
                <p className="text-sm font-bold text-gray-700 font-mono tracking-widest mt-0.5">
                  {tenant.promptpay_id}
                </p>
                <p className="text-xl font-black text-gray-800 mt-1">{feeAmount.toLocaleString()} บาท</p>
              </div>
            </div>
          )}

          {/* Upload slip */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
            <p className="text-sm font-bold text-gray-700">อัปโหลดหลักฐานการชำระเงิน</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              ถ่ายภาพหน้าจอยืนยันการโอน แล้วอัปโหลดที่นี่<br/>
              <span className="text-amber-500">* สามารถข้ามและชำระภายหลังได้ที่หน้า "เอกสารของฉัน"</span>
            </p>

            <label className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${slipFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'}`}>
              {slipPreview ? (
                <img src={slipPreview} alt="slip preview" className="max-h-40 rounded-lg object-contain" />
              ) : (
                <>
                  <ImageIcon size={28} className="text-gray-300" />
                  <p className="text-sm text-gray-500">แตะเพื่อเลือกรูปสลิป</p>
                  <p className="text-xs text-gray-400">รองรับ JPG, PNG, PDF</p>
                </>
              )}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleSlipChange} />
            </label>

            {slipFile && (
              <div className="flex items-center gap-2 bg-emerald-50 rounded-xl px-3 py-2">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                <p className="text-xs text-emerald-700 truncate">{slipFile.name}</p>
              </div>
            )}
          </div>

          {/* Submit buttons */}
          <button
            onClick={handlePaymentSubmit}
            disabled={saving || slipUploading}
            className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {(saving || slipUploading) ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {slipUploading ? 'กำลังอัปโหลดสลิป...' : saving ? 'กำลังส่งคำขอ...' : slipFile ? 'ส่งคำขอพร้อมหลักฐานการชำระ' : 'ส่งคำขอ (ชำระภายหลัง)'}
          </button>

          <p className="text-xs text-gray-400 text-center leading-relaxed">
            หากไม่อัปโหลดสลิป เจ้าหน้าที่จะติดต่อเพื่อยืนยันการชำระก่อนดำเนินการ
          </p>
        </div>
      </div>
    )
  }

  // ─── Identity Verification Gate ───────────────────────────────────────────
  if (needsIdCard) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-7 w-full max-w-sm">
          <div className="flex flex-col items-center text-center gap-3 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
              <ShieldCheck size={32} className="text-blue-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-800">ยืนยันตัวตนก่อนใช้บริการ</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              กรอกเลขบัตรประชาชน 13 หลัก<br />
              เพื่อยืนยันตัวตนตามมาตรฐาน LPA ๑.๒<br />
              <span className="text-xs text-gray-400">บันทึกครั้งเดียว ใช้ได้ตลอด</span>
            </p>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              value={verifyInput}
              onChange={e => {
                setVerifyInput(e.target.value.replace(/\D/g, '').slice(0, 13))
                setVerifyError('')
              }}
              placeholder="เช่น 1234567890123"
              maxLength={13}
              className="w-full px-4 py-4 text-center text-xl font-bold tracking-widest border-2 rounded-2xl focus:outline-none transition-colors text-gray-900 bg-white"
              style={{ borderColor: verifyError ? '#ef4444' : verifyInput.length === 13 ? 'var(--color-primary)' : '#e5e7eb' }}
              autoFocus
            />
            {verifyError && <p className="text-xs text-red-500 text-center">{verifyError}</p>}

            <button
              onClick={handleVerifyIdCard}
              disabled={verifySaving || verifyInput.length !== 13}
              className="w-full py-4 rounded-2xl font-bold text-white text-sm disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {verifySaving ? 'กำลังบันทึก...' : 'ยืนยันตัวตนและดำเนินการต่อ'}
            </button>

            <p className="text-xs text-gray-400 text-center leading-relaxed pt-1">
              ข้อมูลนี้ใช้เพื่อยืนยันตัวตนเท่านั้น<br />
              ไม่เปิดเผยต่อสาธารณะตาม พ.ร.บ. PDPA
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Success screen ────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">ยื่นคำขอสำเร็จ</h2>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            เจ้าหน้าที่จะดำเนินการและติดต่อกลับ<br />
            ผ่านเบอร์มือถือที่ท่านให้ไว้ ภายใน 1–3 วันทำการ
          </p>
          <div className="bg-gray-50 rounded-2xl p-4 mb-6">
            <p className="text-xs text-gray-400 mb-1.5">หมายเลขอ้างอิง</p>
            <p className="text-2xl font-bold tracking-widest text-gray-800">{done.ref}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(done.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="flex items-center gap-1.5 mx-auto mt-2.5 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              {copied ? 'คัดลอกแล้ว!' : 'คัดลอกเลขอ้างอิง'}
            </button>
          </div>
          <button onClick={() => navigate('/')}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            กลับหน้าหลัก
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 1: Doc type picker ───────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="font-bold text-gray-800">ยื่นคำขอเอกสาร</p>
            <p className="text-xs text-gray-400">เลือกประเภทเอกสารที่ต้องการ</p>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-5 pb-12 space-y-4">

          {!session && (
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
              <FileText size={16} className="text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-700">เข้าสู่ระบบเพื่อติดตามสถานะคำขอ</p>
                <p className="text-xs text-blue-500 mt-0.5">ยื่นโดยไม่ล็อกอินก็ได้ แต่จะติดตามสถานะได้ยากขึ้น</p>
                <Link to="/auth" state={{ from: '/doc-request' }}
                  className="inline-block mt-1.5 text-xs font-semibold text-blue-600 underline">
                  เข้าสู่ระบบ / สมัครสมาชิก →
                </Link>
              </div>
            </div>
          )}

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">เลือกเอกสารที่ต้องการ</p>

          <div className="space-y-2.5">
            {DOC_TYPES.map(d => (
              <button key={d.value} onClick={() => setSelected(d)}
                className="w-full bg-white rounded-2xl border shadow-sm p-4 text-left flex items-center gap-4 active:scale-[0.98] hover:shadow-md transition-all"
                style={{ borderColor: d.border }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
                  style={{ backgroundColor: d.bg }}>
                  {d.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold leading-tight" style={{ color: d.color }}>{d.label}</p>
                  <p className="text-xs text-gray-400 mt-1 leading-snug">{d.desc}</p>
                </div>
                <ChevronRight size={18} className="text-gray-300 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ─── Step 2: Form ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => setSelected(null)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xl shrink-0">{selected.emoji}</span>
          <div className="min-w-0">
            <p className="font-bold text-gray-800 leading-tight truncate">{selected.label}</p>
            <p className="text-xs text-gray-400">กรอกข้อมูลผู้ยื่นคำขอ</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 pb-12 space-y-4">

        {/* Selected doc badge */}
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 border"
          style={{ backgroundColor: selected.bg, borderColor: selected.border }}>
          <span className="text-2xl">{selected.emoji}</span>
          <div>
            <p className="text-sm font-bold" style={{ color: selected.color }}>{selected.label}</p>
            <p className="text-xs mt-0.5" style={{ color: selected.color, opacity: 0.7 }}>{selected.desc}</p>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3.5">
          <p className="text-sm font-bold text-gray-700">ข้อมูลผู้ยื่นคำขอ</p>

          {/* ชื่อ-สกุล */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อ-สกุล *</label>
            <input type="text" value={form.requester_name} onChange={set('requester_name')}
              placeholder="นายสมชาย ใจดี" className={inputCls} />
          </div>

          {/* เลขบัตรประชาชน */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-semibold text-gray-500">เลขบัตรประจำตัวประชาชน</label>
              {session && form.requester_id_card && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                  <CheckCircle2 size={9} /> ยืนยันแล้ว
                </span>
              )}
            </div>
            {session && form.requester_id_card ? (
              <div className={inputCls + ' bg-gray-50 text-gray-500 cursor-default select-none tracking-widest'}>
                {form.requester_id_card.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
              </div>
            ) : (
              <input type="text" inputMode="numeric"
                value={form.requester_id_card}
                onChange={e => setForm(p => ({ ...p, requester_id_card: e.target.value.replace(/\D/g, '').slice(0, 13) }))}
                placeholder="1-xxxx-xxxxx-xx-x" maxLength={13} className={inputCls} />
            )}
          </div>

          {/* เบอร์โทร */}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">เบอร์โทรศัพท์ *</label>
            <input type="tel" inputMode="numeric" value={form.requester_phone} onChange={set('requester_phone')}
              placeholder="08x-xxx-xxxx" className={inputCls} />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ที่อยู่ปัจจุบัน</label>
            <textarea value={form.requester_address} onChange={set('requester_address')} rows={2}
              placeholder="บ้านเลขที่ หมู่ที่ ตำบล อำเภอ จังหวัด..."
              className={inputCls + ' resize-none'} />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">วัตถุประสงค์</label>
            <input type="text" value={form.purpose} onChange={set('purpose')}
              placeholder="เช่น เพื่อยื่นกู้ธนาคาร, สมัครงาน, เรียนต่อ"
              className={inputCls} />
          </div>
        </div>

        {/* Submit */}
        <button onClick={handleSubmit}
          disabled={saving || !form.requester_name.trim() || !form.requester_phone.trim()}
          className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          {saving ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
          {saving ? 'กำลังส่งคำขอ...' : 'ยื่นคำขอเอกสาร'}
        </button>

        <p className="text-xs text-gray-400 text-center leading-relaxed">
          เจ้าหน้าที่จะดำเนินการและแจ้งผลทางโทรศัพท์<br />ภายใน 1–3 วันทำการ
        </p>
      </div>
    </div>
  )
}
