import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Inbox, FileText, CheckSquare, BarChart2, LogOut,
  ChevronRight, X, Clock, CheckCircle2, XCircle, Loader2,
  Plus, Phone, MapPin, User, AlignLeft, Calendar, Hash, RefreshCw,
  Printer,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

// ─── Config ───────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'residence_cert',  label: '🏠 ใบรับรองการอยู่อาศัย' },
  { value: 'personal_cert',   label: '👤 หนังสือรับรองบุคคล' },
  { value: 'conduct_cert',    label: '✅ หนังสือรับรองความประพฤติ' },
  { value: 'tax_notice',      label: '💰 ใบแจ้งชำระภาษีที่ดินและสิ่งปลูกสร้าง' },
  { value: 'other',           label: '📝 คำขออื่นๆ' },
]

const STATUS = {
  pending:    { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', Icon: Clock },
  processing: { label: 'กำลังดำเนินการ', color: '#3b82f6', bg: '#dbeafe', Icon: RefreshCw },
  completed:  { label: 'เสร็จสิ้น',      color: '#10b981', bg: '#d1fae5', Icon: CheckCircle2 },
  rejected:   { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', Icon: XCircle },
}

const MODULES = [
  { key: 'inbox',   label: 'กล่องงาน',  Icon: Inbox,       color: '#3b82f6' },
  { key: 'docs',    label: 'เอกสาร',    Icon: FileText,    color: '#8b5cf6' },
  { key: 'approve', label: 'อนุมัติ',   Icon: CheckSquare, color: '#10b981' },
  { key: 'report',  label: 'รายงาน',    Icon: BarChart2,   color: '#f59e0b' },
]

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

function dateTH(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Shared components ────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS[status]
  if (!s) return null
  const SIcon = s.Icon
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.color }}>
      <SIcon size={10} /> {s.label}
    </span>
  )
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2 text-gray-700">
      <span className="text-gray-400 shrink-0 mt-0.5">{icon}</span>
      <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs flex-1 leading-relaxed">{value}</span>
    </div>
  )
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({ req, onClick }) {
  const docType = DOC_TYPES.find(d => d.value === req.document_type)
  const emoji = docType?.label.match(/^(\S+)/)?.[1] ?? '📄'
  const docLabel = docType?.label.replace(/^\S+\s*/, '') ?? req.document_type

  return (
    <button onClick={onClick}
      className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md active:scale-[0.99] transition-all flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl bg-blue-50">
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <p className="text-sm font-bold text-gray-800 truncate">{req.requester_name}</p>
          <StatusBadge status={req.status} />
        </div>
        <p className="text-xs text-gray-500 truncate">{docLabel}</p>
        {req.purpose && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{req.purpose}</p>
        )}
        <p className="text-[11px] text-gray-300 mt-1.5">{dateTH(req.created_at)}</p>
      </div>
      <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
    </button>
  )
}

// ─── Task Detail Sheet ────────────────────────────────────────────────────────

function TaskDetailSheet({ req, onClose, onUpdate, acting }) {
  const [staffNote, setStaffNote]     = useState(req.staff_notes || '')
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejectReason, setRejectReason]   = useState('')

  const docType  = DOC_TYPES.find(d => d.value === req.document_type)
  const isActive = req.status === 'pending' || req.status === 'processing'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-xl md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <X size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 truncate">{req.requester_name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-400 truncate">{docType?.label ?? req.document_type}</span>
              <StatusBadge status={req.status} />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Requester info */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">ข้อมูลผู้ยื่นคำขอ</p>
            <InfoRow icon={<User size={14} />}     label="ชื่อ-สกุล"      value={req.requester_name} />
            {req.requester_id_card && (
              <InfoRow icon={<Hash size={14} />}     label="เลขบัตร ปชช."  value={req.requester_id_card} />
            )}
            {req.requester_phone && (
              <InfoRow icon={<Phone size={14} />}    label="โทรศัพท์"
                value={<a href={`tel:${req.requester_phone}`} className="text-blue-600 hover:underline">{req.requester_phone}</a>} />
            )}
            {req.requester_address && (
              <InfoRow icon={<MapPin size={14} />}   label="ที่อยู่"        value={req.requester_address} />
            )}
            {req.purpose && (
              <InfoRow icon={<AlignLeft size={14} />} label="วัตถุประสงค์"  value={req.purpose} />
            )}
            <InfoRow icon={<Calendar size={14} />}  label="วันที่ยื่น"     value={dateTH(req.created_at)} />
          </div>

          {/* Staff notes (editable when active) */}
          {isActive && (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">บันทึกเจ้าหน้าที่</label>
              <textarea value={staffNote} onChange={e => setStaffNote(e.target.value)} rows={3}
                placeholder="บันทึกการดำเนินการ, หมายเหตุ, เอกสารที่ต้องการเพิ่มเติม..."
                className={inputCls + ' resize-none'} />
            </div>
          )}
          {req.staff_notes && !isActive && (
            <div className="bg-blue-50 rounded-xl p-3.5">
              <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wide mb-1">บันทึกเจ้าหน้าที่</p>
              <p className="text-sm text-blue-800 leading-relaxed">{req.staff_notes}</p>
            </div>
          )}
          {req.reject_reason && (
            <div className="bg-red-50 rounded-xl p-3.5">
              <p className="text-[11px] font-bold text-red-400 uppercase tracking-wide mb-1">เหตุผลการปฏิเสธ</p>
              <p className="text-sm text-red-700 leading-relaxed">{req.reject_reason}</p>
            </div>
          )}

          {/* Reject confirm block */}
          {confirmReject && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-bold text-red-700">ระบุเหตุผลการปฏิเสธ</p>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2}
                placeholder="เอกสารไม่ครบ / ไม่อยู่ในเขต / เหตุผลอื่นๆ..."
                className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white resize-none focus:outline-none" />
              <div className="flex gap-2">
                <button onClick={() => setConfirmReject(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50">
                  ยกเลิก
                </button>
                <button onClick={() => onUpdate(req.id, 'rejected', staffNote, rejectReason)}
                  disabled={acting || !rejectReason.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white disabled:opacity-50 transition-opacity">
                  {acting ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'ยืนยันปฏิเสธ'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {isActive && !confirmReject && (
          <div className="px-4 pb-6 pt-3 border-t border-gray-100 space-y-2 shrink-0">
            {req.status === 'pending' && (
              <button onClick={() => onUpdate(req.id, 'processing', staffNote, '')} disabled={acting}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all text-sm"
                style={{ backgroundColor: '#3b82f6' }}>
                {acting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                รับเรื่อง — เริ่มดำเนินการ
              </button>
            )}
            {req.status === 'processing' && (
              <button onClick={() => onUpdate(req.id, 'completed', staffNote, '')} disabled={acting}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all text-sm"
                style={{ backgroundColor: '#10b981' }}>
                {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                ดำเนินการเสร็จสิ้น
              </button>
            )}
            <button onClick={() => setConfirmReject(true)} disabled={acting}
              className="w-full py-2.5 rounded-2xl font-semibold text-red-500 bg-red-50 hover:bg-red-100 flex items-center justify-center gap-2 text-sm transition-colors">
              <XCircle size={16} /> ปฏิเสธคำขอ
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── New Request Sheet (walk-in) ──────────────────────────────────────────────

const EMPTY_REQ = {
  document_type: 'residence_cert',
  requester_name: '', requester_id_card: '',
  requester_phone: '', requester_address: '', purpose: '',
}

function NewRequestSheet({ tenant, staffId, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_REQ)
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleCreate() {
    if (!form.requester_name.trim()) return
    setSaving(true)
    const { data } = await supabase.from('document_requests').insert({
      municipality_id:   tenant.id,
      document_type:     form.document_type,
      requester_name:    form.requester_name.trim(),
      requester_id_card: form.requester_id_card.trim() || null,
      requester_phone:   form.requester_phone.trim() || null,
      requester_address: form.requester_address.trim() || null,
      purpose:           form.purpose.trim() || null,
      status:            'pending',
      assigned_to:       staffId ?? null,
    }).select().single()
    setSaving(false)
    if (data) { onCreated(data); onClose() }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-xl md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500"><X size={18} /></button>
          <p className="font-bold text-gray-800">สร้างคำขอ (walk-in / โทรศัพท์)</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ประเภทเอกสาร</label>
            <select value={form.document_type} onChange={set('document_type')} className={inputCls}>
              {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          {[
            { k: 'requester_name',     label: 'ชื่อ-สกุล *',      ph: 'นายสมชาย ใจดี', type: 'text' },
            { k: 'requester_id_card',  label: 'เลขบัตรประชาชน',   ph: '1-xxxx-xxxxx-xx-x', type: 'text' },
            { k: 'requester_phone',    label: 'เบอร์โทรศัพท์',    ph: '08x-xxx-xxxx', type: 'tel' },
          ].map(({ k, label, ph, type }) => (
            <div key={k}>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">{label}</label>
              <input type={type} value={form[k]} onChange={set(k)} placeholder={ph} className={inputCls} />
            </div>
          ))}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ที่อยู่</label>
            <textarea value={form.requester_address} onChange={set('requester_address')} rows={2}
              placeholder="บ้านเลขที่ หมู่ที่ ตำบล..." className={inputCls + ' resize-none'} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">วัตถุประสงค์</label>
            <input type="text" value={form.purpose} onChange={set('purpose')}
              placeholder="เช่น เพื่อยื่นกู้ธนาคาร, เพื่อสมัครงาน" className={inputCls} />
          </div>
        </div>
        <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
          <button onClick={handleCreate} disabled={saving || !form.requester_name.trim()}
            className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm active:scale-[0.98] transition-all"
            style={{ backgroundColor: '#3b82f6' }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            สร้างคำขอ
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Inbox Module ─────────────────────────────────────────────────────────────

function InboxModule({ tenant, staffId }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('pending')
  const [selected, setSelected] = useState(null)
  const [acting, setActing]     = useState(false)
  const [showAdd, setShowAdd]   = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('document_requests')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRequests(data ?? []); setLoading(false) })
  }, [tenant?.id])

  async function handleUpdate(id, newStatus, staffNote, rejectReason) {
    setActing(true)
    await supabase.from('document_requests').update({
      status:        newStatus,
      staff_notes:   staffNote   || null,
      reject_reason: rejectReason || null,
      assigned_to:   staffId,
      updated_at:    new Date().toISOString(),
    }).eq('id', id)
    setRequests(prev => prev.map(r =>
      r.id === id ? { ...r, status: newStatus, staff_notes: staffNote || null } : r
    ))
    setActing(false)
    setSelected(null)
  }

  const TABS = [
    { key: 'pending',    label: 'รอดำเนินการ' },
    { key: 'processing', label: 'กำลังดำเนินการ' },
    { key: 'completed',  label: 'เสร็จสิ้น' },
    { key: 'all',        label: 'ทั้งหมด' },
  ]
  const counts = {
    pending:    requests.filter(r => r.status === 'pending').length,
    processing: requests.filter(r => r.status === 'processing').length,
    completed:  requests.filter(r => r.status === 'completed').length,
    all:        requests.length,
  }
  const filtered = activeTab === 'all' ? requests : requests.filter(r => r.status === activeTab)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">กล่องงาน</h2>
          <p className="text-xs text-gray-400 mt-0.5">คำขอเอกสารจากประชาชน</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
          style={{ backgroundColor: '#3b82f6' }}>
          <Plus size={14} /> สร้างคำขอ
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'รอดำเนินการ', count: counts.pending,    color: '#f59e0b', bg: '#fef3c7' },
          { label: 'กำลังดำเนิน', count: counts.processing, color: '#3b82f6', bg: '#dbeafe' },
          { label: 'เสร็จสิ้น',   count: counts.completed,  color: '#10b981', bg: '#d1fae5' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-3 text-center shadow-sm border border-gray-100">
            <p className="text-2xl font-bold leading-none" style={{ color: s.color }}>{s.count}</p>
            <p className="text-[11px] text-gray-500 mt-1 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
            style={activeTab === t.key
              ? { backgroundColor: '#3b82f6', color: '#fff' }
              : { backgroundColor: '#f1f5f9', color: '#64748b' }}>
            {t.label}
            {counts[t.key] > 0 && (
              <span className="text-[10px] font-bold px-1.5 rounded-full"
                style={activeTab === t.key
                  ? { backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff' }
                  : { backgroundColor: '#e2e8f0', color: '#64748b' }}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-200" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Inbox size={44} className="mb-3 opacity-20" />
          <p className="text-sm font-semibold text-gray-400">ไม่มีรายการ</p>
          <p className="text-xs text-gray-300 mt-1">ลองเลือกแท็บอื่น</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(req => (
            <TaskCard key={req.id} req={req} onClick={() => setSelected(req)} />
          ))}
        </div>
      )}

      {selected && (
        <TaskDetailSheet req={selected} onClose={() => setSelected(null)}
          onUpdate={handleUpdate} acting={acting} />
      )}
      {showAdd && (
        <NewRequestSheet tenant={tenant} staffId={staffId}
          onClose={() => setShowAdd(false)}
          onCreated={r => setRequests(prev => [r, ...prev])} />
      )}
    </div>
  )
}

// ─── Document Templates ───────────────────────────────────────────────────────

const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

function thaiDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTHS_TH[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`
}

const DOC_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,400;0,600;0,700;1,400&display=swap');
  @page { size: A4 portrait; margin: 2.5cm 2cm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Sarabun', 'TH SarabunNew', sans-serif; font-size: 16pt; line-height: 2; color: #000; }
  .header { text-align: center; margin-bottom: 16pt; }
  .header .emblem { font-size: 44pt; display: block; margin-bottom: 4pt; }
  .header h1 { font-size: 18pt; font-weight: 700; }
  .header h2 { font-size: 15pt; font-weight: 400; }
  .doc-title { font-size: 20pt; font-weight: 700; text-align: center;
    text-decoration: underline; margin: 12pt 0 20pt; }
  .meta { text-align: right; margin-bottom: 20pt; font-size: 14pt; }
  .body p { text-indent: 3em; margin-bottom: 10pt; }
  .body .no-indent { text-indent: 0; }
  .closing { text-indent: 3em; margin-top: 8pt; margin-bottom: 40pt; }
  .signature { text-align: center; margin-top: 30pt; }
  .signature .sig-line { border-top: 1px solid #000; width: 200pt; margin: 0 auto 4pt; }
  .signature p { margin: 2pt 0; font-size: 14pt; }
  .footer-note { margin-top: 40pt; font-size: 11pt; color: #555; border-top: 1px solid #ccc; padding-top: 6pt; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
`

const DOC_TITLES = {
  residence_cert: 'หนังสือรับรองการอยู่อาศัย',
  personal_cert:  'หนังสือรับรองบุคคล',
  conduct_cert:   'หนังสือรับรองความประพฤติ',
  tax_notice:     'ใบแจ้งชำระภาษีที่ดินและสิ่งปลูกสร้าง',
  other:          'หนังสือรับรอง',
}

function buildDocBody(req, orgName) {
  const name    = `<strong>${req.requester_name}</strong>`
  const idCard  = req.requester_id_card ? ` เลขบัตรประจำตัวประชาชน ${req.requester_id_card}` : ''
  const addr    = req.requester_address ?? '......................................................................'
  const purpose = req.purpose ? `เพื่อ${req.purpose}` : 'เพื่อใช้เป็นหลักฐาน'

  switch (req.document_type) {
    case 'residence_cert':
      return `<p>ขอรับรองว่า ${name}${idCard} อาศัยอยู่ ณ ${addr} อยู่ในเขต${orgName}จริง</p>
              <p>เอกสารฉบับนี้ออกให้${purpose}</p>`
    case 'personal_cert':
      return `<p>ขอรับรองว่า ${name}${idCard} เป็นบุคคลที่อยู่ในทะเบียนราษฎรของ${orgName} และเป็นผู้มีตัวตนอยู่จริง</p>
              <p>เอกสารฉบับนี้ออกให้${purpose}</p>`
    case 'conduct_cert':
      return `<p>ขอรับรองว่า ${name}${idCard} เป็นผู้มีความประพฤติเรียบร้อย ไม่มีพฤติกรรมเสื่อมเสียหรือประวัติอาชญากรรมแต่อย่างใด ตามที่ปรากฏในทะเบียนของ${orgName}</p>
              <p>เอกสารฉบับนี้ออกให้${purpose}</p>`
    case 'tax_notice':
      return `<p>แจ้งให้ ${name}${idCard} ที่อยู่ ${addr} ทราบว่า มีรายการภาษีที่ดินและสิ่งปลูกสร้างที่ต้องชำระตามรายละเอียดที่ระบุด้านล่าง</p>
              <p class="no-indent" style="margin-left:3em; margin-top:6pt">
                รายละเอียด: ....................................................................................<br/>
                จำนวนเงิน: ...................................... บาท (.................................................)<br/>
                กำหนดชำระ: ..................................................................
              </p>
              ${req.staff_notes ? `<p>หมายเหตุ: ${req.staff_notes}</p>` : ''}`
    default:
      return `<p>${req.purpose ?? 'ตามที่ได้รับการร้องขอ'}</p>
              ${req.staff_notes ? `<p>รายละเอียดเพิ่มเติม: ${req.staff_notes}</p>` : ''}`
  }
}

function buildDocHTML({ req, tenant, docDate }) {
  const orgName = tenant?.name ?? 'หน่วยงาน'
  const title   = DOC_TITLES[req.document_type] ?? DOC_TITLES.other

  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8"><title>${title}</title>
<style>${DOC_CSS}</style>
</head><body>
<div class="header">
  <span class="emblem">🏛️</span>
  <h1>${orgName}</h1>
</div>
<div class="doc-title">${title}</div>
<div class="meta"><p>วันที่ ${thaiDate(docDate)}</p></div>
<div class="body">
  ${buildDocBody(req, orgName)}
</div>
<p class="closing">จึงออกหนังสือรับรองฉบับนี้ให้เพื่อเป็นหลักฐาน</p>
<div class="signature">
  <div class="sig-line"></div>
  <p>(...............................................)</p>
  <p>ผู้มีอำนาจลงนาม</p>
  <p>${orgName}</p>
</div>
<div class="footer-note">
  หมายเลขอ้างอิง: ${req.id?.slice(0, 8)?.toUpperCase() ?? '-'} &nbsp;|&nbsp; ออกโดย ${orgName} &nbsp;|&nbsp; วันที่ ${thaiDate(docDate)}
</div>
</body></html>`
}

// ─── Doc Card ─────────────────────────────────────────────────────────────────

function DocCard({ req, onClick }) {
  const docType  = DOC_TYPES.find(d => d.value === req.document_type)
  const emoji    = docType?.label.match(/^(\S+)/)?.[1] ?? '📄'
  const docLabel = docType?.label.replace(/^\S+\s*/, '') ?? req.document_type
  return (
    <button onClick={onClick}
      className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md active:scale-[0.99] transition-all flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl bg-purple-50">
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-800 truncate">{req.requester_name}</p>
        <p className="text-xs text-gray-500 truncate">{docLabel}</p>
        {req.purpose && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{req.purpose}</p>}
        <p className="text-[11px] text-gray-300 mt-1">{dateTH(req.updated_at)}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Printer size={14} className="text-purple-400" />
        <ChevronRight size={16} className="text-gray-300" />
      </div>
    </button>
  )
}

// ─── Doc Preview Sheet ────────────────────────────────────────────────────────

function DocPreviewSheet({ req, tenant, onClose }) {
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10))
  const docType = DOC_TYPES.find(d => d.value === req.document_type)

  function handlePrint() {
    const html = buildDocHTML({ req, tenant, docDate })
    const w = window.open('', '_blank', 'width=860,height=1100')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  const previewHTML = buildDocHTML({ req, tenant, docDate })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-2xl md:rounded-3xl rounded-t-3xl max-h-[96vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
            <X size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 truncate">{docType?.label ?? req.document_type}</p>
            <p className="text-xs text-gray-400 truncate">{req.requester_name}</p>
          </div>
        </div>

        {/* Date picker */}
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-3 shrink-0">
          <label className="text-xs font-semibold text-gray-500 shrink-0">วันที่ออกเอกสาร</label>
          <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-purple-200" />
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-hidden bg-gray-200 p-3 min-h-0">
          <iframe
            srcDoc={previewHTML}
            className="w-full h-full bg-white rounded-xl shadow-inner border-0"
            title="Document Preview"
            sandbox="allow-same-origin"
          />
        </div>

        {/* Print button */}
        <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
          <button onClick={handlePrint}
            className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all"
            style={{ backgroundColor: '#8b5cf6' }}>
            <Printer size={16} /> พิมพ์ / บันทึก PDF
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Docs Module ──────────────────────────────────────────────────────────────

function DocsModule({ tenant }) {
  const [requests, setRequests]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [filterType, setFilterType] = useState('all')
  const [selected, setSelected]   = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('document_requests')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .then(({ data }) => { setRequests(data ?? []); setLoading(false) })
  }, [tenant?.id])

  const filtered = filterType === 'all'
    ? requests
    : requests.filter(r => r.document_type === filterType)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-800">เอกสารออนไลน์</h2>
        <p className="text-xs text-gray-400 mt-0.5">ออกใบรับรองจากคำขอที่เสร็จสิ้นแล้ว</p>
      </div>

      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {[{ value: 'all', label: 'ทั้งหมด' }, ...DOC_TYPES].map(d => (
          <button key={d.value} onClick={() => setFilterType(d.value)}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
            style={filterType === d.value
              ? { backgroundColor: '#8b5cf6', color: '#fff' }
              : { backgroundColor: '#f1f5f9', color: '#64748b' }}>
            {d.label}
          </button>
        ))}
      </div>

      {/* Tip */}
      <div className="flex items-start gap-2 bg-purple-50 rounded-2xl px-4 py-3">
        <Printer size={14} className="text-purple-400 mt-0.5 shrink-0" />
        <p className="text-xs text-purple-700 leading-relaxed">
          กดที่รายการเพื่อดูตัวอย่างและพิมพ์ใบรับรอง — รองรับเฉพาะคำขอที่ <strong>เสร็จสิ้น</strong> แล้ว
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-200" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <FileText size={44} className="mb-3 opacity-20" />
          <p className="text-sm font-semibold text-gray-400">ไม่มีคำขอที่เสร็จสิ้น</p>
          <p className="text-xs text-gray-300 mt-1">คำขอสถานะ "เสร็จสิ้น" จะแสดงที่นี่</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(req => (
            <DocCard key={req.id} req={req} onClick={() => setSelected(req)} />
          ))}
        </div>
      )}

      {selected && (
        <DocPreviewSheet req={selected} tenant={tenant} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

// ─── Placeholder ──────────────────────────────────────────────────────────────

function Placeholder({ title, desc, Icon }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Icon size={28} className="text-gray-300" />
      </div>
      <h2 className="text-lg font-bold text-gray-500 mb-1">{title}</h2>
      <p className="text-sm text-gray-400 mb-4">{desc}</p>
      <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-blue-50 text-blue-500">
        กำลังพัฒนา
      </span>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StaffDashboard() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [activeModule, setActiveModule] = useState('inbox')
  const [profile, setProfile]           = useState(null)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { navigate('/auth', { state: { from: '/staff' } }); return }
      supabase.from('profiles').select('*').eq('id', data.session.user.id).single()
        .then(({ data: p }) => setProfile(p))
    })
  }, [])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('document_requests')
      .select('id', { count: 'exact', head: true })
      .eq('municipality_id', tenant.id)
      .eq('status', 'pending')
      .then(({ count }) => setPendingCount(count ?? 0))
  }, [tenant?.id])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* ── Desktop Sidebar ────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 bg-white border-r border-gray-100 shadow-sm shrink-0">

        {/* Brand */}
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-base shrink-0"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
              🏛️
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-800 truncate">{tenant?.name ?? 'Staff Portal'}</p>
              <p className="text-xs font-semibold text-blue-500">ระบบเจ้าหน้าที่</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {MODULES.map(({ key, label, Icon, color }) => {
            const isActive = activeModule === key
            const badge    = key === 'inbox' && pendingCount > 0 ? pendingCount : null
            return (
              <button key={key} onClick={() => setActiveModule(key)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={isActive
                  ? { backgroundColor: color + '15', color }
                  : { color: '#64748b' }}>
                <Icon size={18} strokeWidth={isActive ? 2.2 : 1.5} />
                <span className="flex-1 text-left">{label}</span>
                {badge && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white bg-amber-400">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Profile + logout */}
        <div className="px-3 py-4 border-t border-gray-100 space-y-1">
          {profile && (
            <div className="flex items-center gap-2.5 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 shrink-0">
                {profile.full_name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-700 truncate">{profile.full_name ?? 'เจ้าหน้าที่'}</p>
                <p className="text-[10px] text-gray-400">{profile.role}</p>
              </div>
            </div>
          )}
          <button onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-100 transition-colors">
            <LogOut size={16} /> ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 shadow-sm shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
            🏛️
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-800 truncate">{tenant?.name ?? 'Staff Portal'}</p>
            <p className="text-xs text-blue-500 font-semibold">ระบบเจ้าหน้าที่</p>
          </div>
          <button onClick={handleLogout} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 transition-colors">
            <LogOut size={18} />
          </button>
        </header>

        {/* PC page header */}
        <div className="hidden md:flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 shrink-0">
          <div>
            <h1 className="text-base font-bold text-gray-800">
              {MODULES.find(m => m.key === activeModule)?.label}
            </h1>
            {profile && (
              <p className="text-xs text-gray-400 mt-0.5">
                สวัสดี {profile.full_name ?? 'เจ้าหน้าที่'}
              </p>
            )}
          </div>
        </div>

        {/* Main */}
        <main className="flex-1 overflow-y-auto px-4 md:px-6 py-5 pb-24 md:pb-6">
          {activeModule === 'inbox'   && <InboxModule tenant={tenant} staffId={profile?.id} />}
          {activeModule === 'docs'    && <DocsModule tenant={tenant} staffId={profile?.id} />}
          {activeModule === 'approve' && <Placeholder title="อนุมัติ"          desc="Workflow ลงนามสำหรับผู้บริหาร"   Icon={CheckSquare} />}
          {activeModule === 'report'  && <Placeholder title="รายงาน"           desc="สรุปสถิติการออกเอกสารรายเดือน"  Icon={BarChart2} />}
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-lg z-20 safe-bottom">
          <div className="flex">
            {MODULES.map(({ key, label, Icon, color }) => {
              const isActive = activeModule === key
              const badge    = key === 'inbox' && pendingCount > 0 ? pendingCount : null
              return (
                <button key={key} onClick={() => setActiveModule(key)}
                  className="flex-1 flex flex-col items-center gap-1 pt-2 pb-3 relative transition-colors">
                  {isActive && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                      style={{ backgroundColor: color }} />
                  )}
                  <div className="relative">
                    <Icon size={22} strokeWidth={isActive ? 2.2 : 1.5}
                      style={{ color: isActive ? color : '#94a3b8' }} />
                    {badge && (
                      <span className="absolute -top-1 -right-2.5 min-w-[16px] h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center px-1 bg-amber-400">
                        {badge > 9 ? '9+' : badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-semibold" style={{ color: isActive ? color : '#94a3b8' }}>
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}
