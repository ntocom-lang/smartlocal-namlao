import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, FileText, CheckCircle2, Loader2, Copy, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const DOC_TYPES = [
  { value: 'residence_cert',  label: 'ใบรับรองการอยู่อาศัย',                desc: 'ยืนยันที่อยู่อาศัยในเขต เพื่อยื่นเอกสารต่างๆ' },
  { value: 'personal_cert',   label: 'หนังสือรับรองบุคคล',                   desc: 'รับรองตัวตนและสถานะการอยู่ในทะเบียนราษฎร' },
  { value: 'conduct_cert',    label: 'หนังสือรับรองความประพฤติ',              desc: 'ไม่มีประวัติอาชญากรรม เหมาะสำหรับสมัครงาน' },
  { value: 'tax_notice',      label: 'ใบแจ้งชำระภาษีที่ดินและสิ่งปลูกสร้าง', desc: 'สำเนาใบแจ้งภาษีประจำปี' },
  { value: 'other',           label: 'คำขออื่นๆ',                             desc: 'ระบุรายละเอียดในช่อง "วัตถุประสงค์"' },
]

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'
const EMPTY = { document_type: 'residence_cert', requester_name: '', requester_id_card: '', requester_phone: '', requester_address: '', purpose: '' }

export default function CitizenDocRequest() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [session, setSession]   = useState(undefined)
  const [form, setForm]         = useState(EMPTY)
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
    if (!form.requester_name.trim()) return
    setSaving(true)
    const { data } = await supabase.from('document_requests').insert({
      municipality_id:   tenant?.id,
      document_type:     form.document_type,
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
            className="w-full py-3.5 rounded-2xl font-semibold text-white text-sm active:scale-[0.98] transition-all"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            กลับหน้าหลัก
          </button>
        </div>
      </div>
    )
  }

  // ─── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <p className="font-bold text-gray-800">ยื่นคำขอเอกสาร</p>
          <p className="text-xs text-gray-400">บริการออนไลน์ 24 ชั่วโมง</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 pb-12 space-y-5">

        {/* Auth suggestion */}
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

        {/* Doc type selector */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className="text-sm font-bold text-gray-700">เลือกประเภทเอกสาร</p>
          </div>
          <div className="divide-y divide-gray-50">
            {DOC_TYPES.map(d => (
              <button key={d.value} onClick={() => setForm(f => ({ ...f, document_type: d.value }))}
                className="w-full px-4 py-3 text-left flex items-center gap-3 transition-colors hover:bg-gray-50 active:bg-gray-100">
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                  style={form.document_type === d.value
                    ? { borderColor: 'var(--color-primary)', backgroundColor: 'var(--color-primary)' }
                    : { borderColor: '#d1d5db' }}>
                  {form.document_type === d.value && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{d.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">{d.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Requester info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3.5">
          <p className="text-sm font-bold text-gray-700">ข้อมูลผู้ยื่นคำขอ</p>

          {[
            { k: 'requester_name',    label: 'ชื่อ-สกุล *',           ph: 'นายสมชาย ใจดี',  type: 'text' },
            { k: 'requester_id_card', label: 'เลขบัตรประจำตัวประชาชน', ph: '1-xxxx-xxxxx-xx-x', type: 'text' },
            { k: 'requester_phone',   label: 'เบอร์โทรศัพท์ *',        ph: '08x-xxx-xxxx',   type: 'tel' },
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
