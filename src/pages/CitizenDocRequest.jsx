import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileText, CheckCircle2, Loader2, Copy, Check, ChevronRight, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { notifyTelegram } from '../lib/notifyTelegram'
import { NAME_TITLES, splitThaiFullName, joinThaiFullName } from '../lib/thaiName'

// ที่อยู่ผู้ยื่นคำขอ = ที่อยู่ในเขตของหน่วยงานเสมอ (ระบบนี้แยกตามหน่วยงาน ใครหน่วยงานนั้น)
// เลยไม่ต้องให้ประชาชนพิมพ์ตำบล/อำเภอ/จังหวัดเอง ให้กรอกแค่บ้านเลขที่ แล้วต่อท้ายด้วย
// ตำบล/อำเภอ/จังหวัดของหน่วยงานที่ fix ไว้ — logic แกะชื่อตำบลจาก tenant.name เหมือนกับ
// bareSubdistrictName ใน src/lib/councilFormPrint.js (ใช้ได้เฉพาะ เทศบาลตำบล/อบต. เพราะ
// สองแบบนี้เท่านั้นที่ปกครองพื้นที่ตรงกับชื่อตำบลเดียวกันเป๊ะ)
const SUBDISTRICT_STRIP = {
  'เทศบาลตำบล': 'เทศบาลตำบล',
  'อบต.': 'องค์การบริหารส่วนตำบล',
}
function bareSubdistrictName(tenant) {
  const strip = SUBDISTRICT_STRIP[tenant?.org_type]
  if (!strip || !tenant?.name) return ''
  return tenant.name.replace(strip, '').trim()
}
function tenantAddressSuffix(tenant) {
  const subdistrict = bareSubdistrictName(tenant)
  return [
    subdistrict  ? `ตำบล${subdistrict}`     : null,
    tenant?.district ? `อำเภอ${tenant.district}` : null,
    tenant?.province ? `จังหวัด${tenant.province}` : null,
  ].filter(Boolean).join(' ')
}

const BASE_DOC_TYPES = [
  {
    value:   'tax_notice',
    label:   'ค่าธรรมเนียม/ภาษี',
    emoji:   '🏦',
    desc:    'สอบถามยอดภาษีที่ดินและสิ่งปลูกสร้าง / ภาษีป้าย',
    color:   '#d97706',
    bg:      '#fffbeb',
    border:  '#fde68a',
  },
  {
    value:   'waste_collection',
    label:   'ค่าธรรมเนียมเก็บขนขยะ',
    emoji:   '🗑️',
    desc:    'สอบถามค่าธรรมเนียมเก็บและขนขยะมูลฝอยผ่านระบบออนไลน์',
    color:   '#0891b2',
    bg:      '#ecfeff',
    border:  '#a5f3fc',
  },
]

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function CitizenDocRequest() {
  const navigate  = useNavigate()
  const [searchParams] = useSearchParams()
  const { tenant } = useTenant()
  const allDocTypes = useMemo(() => {
    const extras = (tenant?.fee_schedule?._custom_types || []).map(t => ({
      value:  t.value,
      label:  t.label,
      emoji:  t.emoji || '📋',
      desc:   'บริการเพิ่มเติมของ อปท.',
      color:  '#6366f1',
      bg:     '#eef2ff',
      border: '#c7d2fe',
    }))
    return [...BASE_DOC_TYPES, ...extras]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant])
  const [session, setSession]     = useState(undefined)
  const [selected, setSelected]   = useState(() => {
    const t = searchParams.get('type')
    return t ? (BASE_DOC_TYPES.find(d => d.value === t) ?? null) : null
  })
  const [form, setForm]           = useState({ name_title: '', name_first: '', name_last: '', requester_id_card: '', requester_phone: '', requester_address: '', purpose: '' })
  const [saving, setSaving]       = useState(false)
  const [done, setDone]           = useState(null)
  const [copied, setCopied]       = useState(false)

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
              const { title, first, last } = splitThaiFullName(p.full_name)
              setForm(f => ({
                ...f,
                name_title:        title,
                name_first:        first,
                name_last:         last,
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

  // แสดงยอดค่าธรรมเนียม/ภาษีเป็นข้อมูลอ้างอิงเท่านั้น — ป้องกันการทุจริต ห้ามเก็บเงิน
  // ผ่านแอปเด็ดขาดทุกประเภทเอกสาร ประชาชนต้องไปชำระที่เทศบาลเองเสมอ (ไม่มีหน้าชำระ/
  // สแกน QR/แนบสลิปในระบบนี้อีกต่อไป)
  const feeAmount = selected ? ((tenant?.fee_schedule ?? {})[selected.value] ?? 0) : 0
  // tax_notice/waste_collection ไม่ใช่การขอออกเอกสารเหมือนประเภทอื่น เป็นแค่ "สอบถามยอด" —
  // ข้อความในฟอร์ม (หัวข้อ, ขั้นตอน, ปุ่ม) ต้องไม่พูดถึงการออกเอกสาร/โอนเงินผ่านแอป
  const isFeeInquiry = selected?.value === 'tax_notice' || selected?.value === 'waste_collection'
  // tax_notice มี 2 เรื่องย่อยให้เลือก (ภาษีที่ดินฯ / ภาษีป้าย) เลยต้องมี dropdown —
  // waste_collection มีเรื่องเดียว ไม่ต้องให้กรอก/เลือกเลย ระบุให้ตรงๆ ไปเลย
  const hasInquiryOptions = selected?.value === 'tax_notice'
  const isSingleTopicInquiry = selected?.value === 'waste_collection'
  const WASTE_PURPOSE = 'สอบถามค่าธรรมเนียมเก็บและขนขยะมูลฝอย'
  const addressSuffix = tenantAddressSuffix(tenant)
  const fullName = joinThaiFullName(form.name_title, form.name_first, form.name_last)

  function handleFormNext() {
    if (!form.name_first.trim() || !form.name_last.trim() || !form.requester_phone.trim()) return
    if (isFeeInquiry && !isSingleTopicInquiry && !form.purpose.trim()) return
    handleSubmit()
  }

  async function handleSubmit() {
    setSaving(true)
    const { data, error } = await supabase.from('document_requests').insert({
      municipality_id:   tenant?.id,
      document_type:     selected.value,
      requester_name:    fullName,
      requester_id_card: form.requester_id_card.trim() || null,
      requester_phone:   form.requester_phone.trim() || null,
      requester_address: [form.requester_address.trim(), addressSuffix].filter(Boolean).join(' ') || null,
      purpose:           isSingleTopicInquiry ? WASTE_PURPOSE : (form.purpose.trim() || null),
      status:            'pending',
      user_id:           session?.user?.id ?? null,
      fee_amount:        feeAmount || null,
      payment_status:    'not_required', // ป้องกันการทุจริต — ไม่เก็บเงินผ่านแอป ไปชำระที่เทศบาลเสมอ
      payment_slip_url:  null,
    }).select().single()
    setSaving(false)
    if (error) { alert('ส่งคำขอไม่สำเร็จ: ' + error.message); return }
    if (data) {
      notifyTelegram(tenant?.telegram_group_id,
        `📄 <b>คำขอเอกสารใหม่</b>\nประเภท: ${selected.label}\nผู้ขอ: ${fullName}\nเบอร์: ${form.requester_phone?.trim() || '-'}${feeAmount > 0 ? `\n💰 ค่าธรรมเนียมโดยประมาณ: ${feeAmount} บาท (ชำระที่เทศบาล)` : ''}`
      )
      setDone({ ref: data.id.slice(0, 8).toUpperCase() })
    }
  }

  if (session === undefined || needsIdCard === null) return null

  // ─── Identity Verification Gate ───────────────────────────────────────────
  if (needsIdCard) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
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
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
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
      <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>
        {/* Mobile header */}
        <div className="md:hidden sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="font-bold text-gray-800">E-SERVICE งานบริการประชาชน</p>
            <p className="text-xs text-gray-400">เลือกประเภทเอกสารที่ต้องการ</p>
          </div>
        </div>

        {/* PC header */}
        <div className="hidden md:block">
          <div className="px-8 py-1.5 flex items-center justify-between border-b"
            style={{ backgroundColor: '#dce8f5', borderColor: '#b8cfea' }}>
            <p className="text-[11px] text-gray-600">
              ระบบบริการอิเล็กทรอนิกส์ › {tenant?.name ?? ''} ›{' '}
              <span className="font-semibold text-gray-700">E-SERVICE งานบริการประชาชน</span>
            </p>
            <p className="text-[11px] text-gray-500">
              {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="px-8 py-3 bg-white border-b border-gray-200 shadow-sm">
            <h1 className="text-base font-bold text-gray-800">E-SERVICE งานบริการประชาชน</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">{tenant?.name} — เลือกประเภทเอกสารที่ต้องการ</p>
          </div>
        </div>

        <div className="max-w-lg md:max-w-4xl mx-auto px-4 md:px-8 py-5 md:py-6 pb-28 md:pb-8 space-y-4">

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

          {/* Mobile: vertical list | PC: 2-column grid */}
          <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 md:gap-3">
            {allDocTypes.map(d => (
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
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>
      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
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

      {/* PC header */}
      <div className="hidden md:block">
        <div className="px-8 py-1.5 flex items-center justify-between border-b"
          style={{ backgroundColor: '#dce8f5', borderColor: '#b8cfea' }}>
          <p className="text-[11px] text-gray-600">
            ระบบบริการอิเล็กทรอนิกส์ › {tenant?.name ?? ''} › ขอเอกสาร ›{' '}
            <span className="font-semibold text-gray-700">{selected.label}</span>
          </p>
          <p className="text-[11px] text-gray-500">
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="px-8 py-3 flex items-center gap-3 bg-white border-b border-gray-200 shadow-sm">
          <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-base font-bold text-gray-800">{selected.label}</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">กรอกข้อมูลผู้ยื่นคำขอ</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg md:max-w-4xl mx-auto px-4 md:px-8 py-5 md:py-6 pb-28 md:pb-8 space-y-4 md:grid md:grid-cols-[1fr_340px] md:gap-6 md:space-y-0 md:items-start">

        {/* Left column — form */}
        <div className="space-y-4">
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

            {/* คำนำหน้า / ชื่อ / นามสกุล — แถวเดียวกัน */}
            <div className="flex gap-2">
              <div className="w-20 shrink-0">
                <label className="text-xs font-semibold text-gray-500 mb-1 block">คำนำหน้า *</label>
                <select value={form.name_title} onChange={set('name_title')} className={inputCls}>
                  <option value="">เลือก</option>
                  {NAME_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อ *</label>
                <input type="text" value={form.name_first} onChange={set('name_first')}
                  placeholder="สมชาย" className={inputCls} />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-xs font-semibold text-gray-500 mb-1 block">นามสกุล *</label>
                <input type="text" value={form.name_last} onChange={set('name_last')}
                  placeholder="ใจดี" className={inputCls} />
              </div>
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
              <div className="flex items-center gap-2">
                <input type="text" value={form.requester_address} onChange={set('requester_address')}
                  placeholder="บ้านเลขที่"
                  className={inputCls.replace('w-full', 'w-28 shrink-0')} />
                {addressSuffix && (
                  <p className="text-xs text-gray-400 truncate">{addressSuffix}</p>
                )}
              </div>
            </div>

            {!isSingleTopicInquiry && (
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">
                  {isFeeInquiry ? 'รายละเอียดที่ต้องการสอบถาม *' : 'วัตถุประสงค์'}
                </label>
                {hasInquiryOptions ? (
                  <select value={form.purpose} onChange={set('purpose')} className={inputCls}>
                    <option value="">— เลือกรายการที่ต้องการสอบถาม —</option>
                    <option value="สอบถามยอดภาษีที่ดินและสิ่งปลูกสร้าง">สอบถามยอดภาษีที่ดินและสิ่งปลูกสร้าง</option>
                    <option value="สอบถามยอดภาษีป้าย">สอบถามยอดภาษีป้าย</option>
                  </select>
                ) : (
                  <input type="text" value={form.purpose} onChange={set('purpose')}
                    placeholder="เช่น เพื่อยื่นกู้ธนาคาร, สมัครงาน, เรียนต่อ"
                    className={inputCls} />
                )}
              </div>
            )}
          </div>

          {/* Submit */}
          <button onClick={handleFormNext}
            disabled={saving || !form.name_first.trim() || !form.name_last.trim() || !form.requester_phone.trim() || (isFeeInquiry && !form.purpose.trim())}
            className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
            {saving ? 'กำลังส่งคำขอ...' : (isFeeInquiry ? 'สอบถามยอด' : 'ยื่นคำขอ')}
          </button>

          <p className="text-xs text-gray-400 text-center leading-relaxed">
            {isFeeInquiry
              ? (session
                  ? <>ติดตามสถานะและรับการแจ้งเตือนได้ที่เมนู เอกสารของฉัน<br />ภายใน 1–3 วันทำการ — ชำระได้ที่เทศบาลเท่านั้น</>
                  : <>เจ้าหน้าที่จะตรวจสอบยอดและแจ้งกลับทางโทรศัพท์<br />ภายใน 1–3 วันทำการ — ชำระได้ที่เทศบาลเท่านั้น</>)
              : (session
                  ? <>ติดตามสถานะและรับการแจ้งเตือนได้ที่เมนู เอกสารของฉัน<br />ภายใน 1–3 วันทำการ</>
                  : <>เจ้าหน้าที่จะดำเนินการและแจ้งผลทางโทรศัพท์<br />ภายใน 1–3 วันทำการ</>)}
          </p>
        </div>

        {/* Right column — info panel (PC only) */}
        <div className="hidden md:flex flex-col gap-4">
          {/* Fee info */}
          {isFeeInquiry ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-1">
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">ค่าธรรมเนียม</p>
              <p className="text-2xl font-bold text-emerald-800">ฟรี</p>
              <p className="text-xs text-emerald-600">แจ้งยอด แล้วชำระที่เทศบาล</p>
            </div>
          ) : feeAmount > 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">ค่าธรรมเนียม</p>
              <p className="text-2xl font-bold text-amber-800">{feeAmount.toLocaleString()} <span className="text-base font-normal">บาท</span></p>
              <p className="text-xs text-amber-600">โอนเงินผ่านบัญชีธนาคาร หลังยื่นคำขอ</p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-1">ค่าธรรมเนียม</p>
              <p className="text-sm font-semibold text-emerald-700">ไม่มีค่าธรรมเนียม</p>
            </div>
          )}

          {/* Process steps */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">ขั้นตอนการดำเนินการ</p>
            {(isFeeInquiry ? [
              { step: '1', label: 'ส่งคำถาม', desc: 'กรอกแบบฟอร์มและส่งข้อมูล' },
              { step: '2', label: 'เจ้าหน้าที่ตรวจสอบ', desc: 'ตรวจสอบยอดภาษี/ค่าธรรมเนียม' },
              { step: '3', label: 'แจ้งยอดชำระ', desc: 'แจ้งยอด แล้วชำระที่เทศบาล' },
            ] : [
              { step: '1', label: 'ยื่นคำขอ', desc: 'กรอกแบบฟอร์มและส่งเอกสาร' },
              { step: '2', label: 'เจ้าหน้าที่รับเรื่อง', desc: 'ตรวจสอบและดำเนินการ' },
              { step: '3', label: 'รับเอกสาร', desc: 'ดาวน์โหลดหรือรับที่สำนักงาน' },
            ]).map(({ step, label, desc }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5"
                  style={{ backgroundColor: '#1a3a5c' }}>{step}</div>
                <div>
                  <p className="text-sm font-semibold text-gray-700">{label}</p>
                  <p className="text-xs text-gray-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Timeline note */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
            <p className="text-xs font-bold text-blue-700 mb-1">ระยะเวลาดำเนินการ</p>
            <p className="text-sm font-semibold text-blue-800">1–3 วันทำการ</p>
            <p className="text-xs text-blue-500 mt-1">
              {session ? 'ติดตามสถานะ และรับการแจ้งเตือนได้ที่เมนู เอกสารของฉัน' : 'เจ้าหน้าที่จะติดต่อกลับผ่านเบอร์โทรที่ท่านให้ไว้'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
