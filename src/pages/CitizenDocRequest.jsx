import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, FileText, CheckCircle2, Loader2, Copy, Check, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

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
    label:   'ใบแจ้งชำระภาษีที่ดิน',
    emoji:   '📋',
    desc:    'สำเนาใบแจ้งภาษีที่ดินและสิ่งปลูกสร้างประจำปี',
    color:   '#d97706',
    bg:      '#fffbeb',
    border:  '#fde68a',
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
  const [session, setSession]   = useState(undefined)
  const [selected, setSelected] = useState(null)   // null = step 1, DOC_TYPES item = step 2
  const [form, setForm]         = useState({ requester_name: '', requester_id_card: '', requester_phone: '', requester_address: '', purpose: '' })
  const [saving, setSaving]     = useState(false)
  const [done, setDone]         = useState(null)
  const [copied, setCopied]     = useState(false)
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        supabase.from('profiles').select('full_name, phone').eq('id', data.session.user.id).single()
          .then(({ data: p }) => {
            if (p) setForm(f => ({ ...f, requester_name: p.full_name ?? '', requester_phone: p.phone ?? '' }))
          })
      }
    })
  }, [])

  async function handleSubmit() {
    if (!form.requester_name.trim() || !selected) return
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
    }).select().single()
    setSaving(false)
    if (data) setDone({ ref: data.id.slice(0, 8).toUpperCase() })
  }

  if (session === undefined) return null

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

          {[
            { k: 'requester_name',    label: 'ชื่อ-สกุล *',             ph: 'นายสมชาย ใจดี',    type: 'text' },
            { k: 'requester_id_card', label: 'เลขบัตรประจำตัวประชาชน',  ph: '1-xxxx-xxxxx-xx-x', type: 'text' },
            { k: 'requester_phone',   label: 'เบอร์โทรศัพท์ *',          ph: '08x-xxx-xxxx',     type: 'tel' },
          ].map(({ k, label, ph, type }) => (
            <div key={k}>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">{label}</label>
              <input type={type} inputMode={type === 'tel' ? 'numeric' : undefined}
                value={form[k]} onChange={set(k)} placeholder={ph} className={inputCls} />
            </div>
          ))}

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
