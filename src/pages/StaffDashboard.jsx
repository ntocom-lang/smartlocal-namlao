import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Inbox, FileText, CheckSquare, BarChart2, LogOut,
  ChevronRight, X, Clock, CheckCircle2, XCircle, Loader2,
  Plus, Phone, MapPin, User, AlignLeft, Calendar, Hash, RefreshCw,
  Printer, PenLine, Search, Download, Wrench, Home, CalendarDays, TrendingUp, Archive, Images,
} from 'lucide-react'
import CivilProjectAdmin from '../components/admin/CivilProjectAdmin'
import CivilProjectReport from '../components/admin/CivilProjectReport'
import MapDashboardAdmin from '../components/admin/MapDashboardAdmin'
import EventsManager from '../components/admin/EventsManager'
import ComplaintsManager from '../components/admin/ComplaintsManager'
import ReportManager from '../components/admin/ReportManager'
import DocumentArchive from '../components/admin/DocumentArchive'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { notifyTelegram } from '../lib/notifyTelegram'

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

const MODULE_GROUPS = [
  {
    group: 'บริการประชาชน',
    items: [
      { key: 'inbox',      label: 'กล่องงาน', Icon: Inbox,        color: '#3b82f6' },
      { key: 'docs',       label: 'คำขอเอกสาร',   Icon: FileText,     color: '#8b5cf6' },
      { key: 'complaints', label: 'คำร้อง',   Icon: BarChart2,    color: '#ef4444' },
    ],
  },
  {
    group: 'งานภายใน',
    items: [
      { key: 'events',   label: 'กิจกรรม', Icon: CalendarDays, color: '#10b981' },
      { key: 'approve',  label: 'อนุมัติ',  Icon: CheckSquare,  color: '#f97316' },
      { key: 'projects', label: 'โครงการ', Icon: Wrench,       color: '#7c3aed' },
    ],
  },
  {
    group: 'ข้อมูลและรายงาน',
    items: [
      { key: 'docs-archive',  label: 'คลังเอกสาร',     Icon: Archive,    color: '#0f766e' },
      { key: 'photo-album',  label: 'อัลบั้มกิจกรรม', Icon: Images,     color: '#1877f2', externalUrl: 'https://m.facebook.com/groups/2193529028125946/media/albums' },
      { key: 'map',          label: 'แผนที่',          Icon: MapPin,     color: '#0891b2' },
      { key: 'report',       label: 'รายงาน',          Icon: TrendingUp, color: '#f59e0b' },
    ],
  },
]
const MODULES = MODULE_GROUPS.flatMap(g => g.items)

const APPROVAL_TYPES = [
  { value: 'expense_claim',  label: '💰 เบิกจ่ายค่าใช้จ่าย',        requiresSign: true  },
  { value: 'budget_request', label: '📊 ขออนุมัติงบประมาณ',          requiresSign: true  },
  { value: 'procurement',    label: '🛒 จัดซื้อจัดจ้าง',             requiresSign: true  },
  { value: 'leave_request',  label: '📅 คำขอลา',                     requiresSign: false },
  { value: 'overtime',       label: '⏰ ขออนุมัติทำงานล่วงเวลา',      requiresSign: false },
  { value: 'other_quick',    label: '📝 อื่นๆ (ไม่ต้องลงนาม)',        requiresSign: false },
  { value: 'other_sign',     label: '✍️ อื่นๆ (ต้องลงนาม)',           requiresSign: true  },
]

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

const ROLE_TH = {
  staff:      'เจ้าหน้าที่เอกสาร',
  officer:    'เจ้าหน้าที่',
  technician: 'ช่างเทคนิค',
  admin:      'ผู้ดูแลระบบ',
  superadmin: 'Super Admin',
  viewer:     'ผู้บริหาร',
  council:    'สภาเทศบาล',
}

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

function TaskDetailSheet({ req, onClose, onUpdate, acting, tenant }) {
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
        {req.status === 'completed' && (
          <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
            <button onClick={() => {
              const html = buildDocHTML({ req, tenant, docDate: new Date().toISOString().slice(0, 10) })
              const w = window.open('', '_blank', 'width=860,height=1100')
              if (!w) return
              w.document.write(html)
              w.document.close()
              setTimeout(() => { w.focus(); w.print() }, 400)
            }}
              className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all"
              style={{ backgroundColor: '#8b5cf6' }}>
              <Printer size={16} /> พิมพ์ / บันทึกเป็น PDF
            </button>
          </div>
        )}
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
            <label className="text-xs font-semibold text-gray-500 mb-2 block">ประเภทเอกสาร</label>
            <div className="grid grid-cols-2 gap-2">
              {DOC_TYPES.map(d => {
                const [emoji, ...rest] = d.label.split(' ')
                const isSel = form.document_type === d.value
                return (
                  <button key={d.value} type="button"
                    onClick={() => setForm(p => ({ ...p, document_type: d.value }))}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-xs font-semibold transition-all active:scale-95"
                    style={isSel
                      ? { borderColor: '#3b82f6', backgroundColor: '#eff6ff', color: '#1d4ed8' }
                      : { borderColor: '#e5e7eb', backgroundColor: '#fff', color: '#6b7280' }}>
                    <span className="text-base shrink-0">{emoji}</span>
                    <span className="leading-snug">{rest.join(' ')}</span>
                  </button>
                )
              })}
            </div>
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
  const [requests, setRequests]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState('pending')
  const [selected, setSelected]   = useState(null)
  const [acting, setActing]       = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [search, setSearch]       = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  function reload() {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('document_requests')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRequests(data ?? []); setLoading(false) })
  }

  useEffect(() => { reload() }, [tenant?.id, refreshKey])

  useEffect(() => {
    if (!tenant?.id) return
    const ch = supabase.channel(`inbox-${tenant.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'document_requests',
        filter: `municipality_id=eq.${tenant.id}`,
      }, payload => setRequests(prev => [payload.new, ...prev]))
      .subscribe()
    return () => supabase.removeChannel(ch)
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
    const req = requests.find(r => r.id === id)
    notifyTelegram(tenant?.telegram_group_id,
      `🔄 <b>อัปเดตสถานะคำขอเอกสาร</b>\nประเภท: ${req?.document_type ?? ''}\nผู้ขอ: ${req?.requester_name ?? ''}\nสถานะ: ${STATUS[newStatus]?.label ?? newStatus}${staffNote ? `\nหมายเหตุ: ${staffNote}` : ''}`
    )
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
  const byTab    = activeTab === 'all' ? requests : requests.filter(r => r.status === activeTab)
  const filtered = search.trim()
    ? byTab.filter(r => {
        const q = search.toLowerCase()
        const docLabel = (DOC_TYPES.find(d => d.value === r.document_type)?.label ?? '').toLowerCase()
        return r.requester_name?.toLowerCase().includes(q) || docLabel.includes(q)
      })
    : byTab

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">กล่องงาน</h2>
          <p className="text-xs text-gray-400 mt-0.5">คำขอเอกสารจากประชาชน</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setRefreshKey(k => k + 1)} disabled={loading}
            className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors disabled:opacity-40"
            title="รีเฟรช">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
            style={{ backgroundColor: '#3b82f6' }}>
            <Plus size={14} /> สร้างคำขอ
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ หรือประเภทเอกสาร..."
          className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        )}
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
          <p className="text-sm font-semibold text-gray-400">{search ? 'ไม่พบคำขอที่ค้นหา' : 'ไม่มีรายการ'}</p>
          <p className="text-xs text-gray-300 mt-1">{search ? `"${search}"` : 'ลองเลือกแท็บอื่น'}</p>
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
          onUpdate={handleUpdate} acting={acting} tenant={tenant} />
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

// ─── Signature Pad ────────────────────────────────────────────────────────────

function SignaturePad({ onConfirm, onCancel }) {
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasContent, setHasContent] = useState(false)

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect()
    const src  = e.touches ? e.touches[0] : e
    return {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    }
  }
  function startDraw(e) {
    e.preventDefault()
    const canvas = canvasRef.current
    const pos = getPos(e, canvas)
    const ctx = canvas.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    setIsDrawing(true)
    setHasContent(true)
  }
  function continueDraw(e) {
    if (!isDrawing) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  function endDraw() { setIsDrawing(false) }
  function clearPad() {
    canvasRef.current.getContext('2d').clearRect(0, 0, 600, 180)
    setHasContent(false)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-500 text-center">ลงลายมือชื่อในกรอบด้านล่าง</p>
      <div className="border-2 border-dashed border-gray-300 rounded-2xl overflow-hidden relative bg-white">
        <canvas ref={canvasRef} width={600} height={180}
          className="w-full touch-none cursor-crosshair block"
          onMouseDown={startDraw} onMouseMove={continueDraw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={continueDraw} onTouchEnd={endDraw} />
        {!hasContent && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-gray-400">ลากเพื่อเขียนลายเซ็น</p>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={clearPad}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          ล้าง
        </button>
        <button onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
          ยกเลิก
        </button>
        <button onClick={() => onConfirm(canvasRef.current.toDataURL('image/png'))} disabled={!hasContent}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity flex items-center justify-center gap-1.5"
          style={{ backgroundColor: '#10b981' }}>
          <PenLine size={14} /> ยืนยันลงนาม
        </button>
      </div>
    </div>
  )
}

// ─── Approval Card ────────────────────────────────────────────────────────────

function ApprovalCard({ req, onClick }) {
  const type = APPROVAL_TYPES.find(t => t.value === req.request_type)
  const emoji = type?.label.match(/^(\S+)/)?.[1] ?? '📋'
  const typeLabel = type?.label.replace(/^\S+\s*/, '') ?? req.request_type
  const ASTATUS = {
    pending:  { label: 'รออนุมัติ',   color: '#f59e0b', bg: '#fef3c7' },
    approved: { label: 'อนุมัติแล้ว', color: '#10b981', bg: '#d1fae5' },
    rejected: { label: 'ไม่อนุมัติ',  color: '#ef4444', bg: '#fee2e2' },
  }
  const s = ASTATUS[req.status] ?? ASTATUS.pending
  return (
    <button onClick={onClick}
      className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left hover:shadow-md active:scale-[0.99] transition-all flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50 text-xl">{emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <p className="text-sm font-bold text-gray-800 truncate">{req.title}</p>
          <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ backgroundColor: s.bg, color: s.color }}>{s.label}</span>
        </div>
        <p className="text-xs text-gray-500 truncate">{typeLabel}</p>
        {req.amount != null && (
          <p className="text-xs font-semibold text-emerald-600 mt-0.5">
            {Number(req.amount).toLocaleString()} บาท
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          {req.requires_signature && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">
              <PenLine size={9} /> ต้องลงนาม
            </span>
          )}
          <p className="text-[11px] text-gray-300">{dateTH(req.created_at)}</p>
        </div>
      </div>
      <ChevronRight size={16} className="text-gray-300 shrink-0 mt-1" />
    </button>
  )
}

// ─── Approve Sheet ────────────────────────────────────────────────────────────

function ApproveSheet({ req, approverProfile, onClose, onApproved }) {
  const [note, setNote]           = useState('')
  const [step, setStep]           = useState('confirm') // 'confirm' | 'sign'
  const [acting, setActing]       = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const type = APPROVAL_TYPES.find(t => t.value === req.request_type)
  const isActive = req.status === 'pending'

  async function doApprove(signatureData) {
    setActing(true)
    const now = new Date().toISOString()
    await supabase.from('approval_requests').update({
      status:         'approved',
      approved_by:    approverProfile?.id   ?? null,
      approver_name:  approverProfile?.full_name ?? null,
      approved_at:    now,
      approver_note:  note || null,
      signature_data: signatureData ?? null,
      updated_at:     now,
    }).eq('id', req.id)
    setActing(false)
    onApproved(req.id, 'approved')
    onClose()
  }

  async function doReject() {
    if (!rejectReason.trim()) return
    setActing(true)
    const now = new Date().toISOString()
    await supabase.from('approval_requests').update({
      status:        'rejected',
      approved_by:   approverProfile?.id ?? null,
      approver_name: approverProfile?.full_name ?? null,
      approved_at:   now,
      approver_note: rejectReason,
      updated_at:    now,
    }).eq('id', req.id)
    setActing(false)
    onApproved(req.id, 'rejected')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-xl md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">

        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500"><X size={18} /></button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 truncate">{req.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-400 truncate">{type?.label ?? req.request_type}</span>
              {req.requires_signature && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 flex items-center gap-1 shrink-0">
                  <PenLine size={9} /> ต้องลงนาม
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">รายละเอียดคำขอ</p>
            {req.description && <InfoRow icon={<AlignLeft size={14} />} label="รายละเอียด"    value={req.description} />}
            {req.amount != null && <InfoRow icon={<Hash size={14} />}   label="จำนวนเงิน"   value={`${Number(req.amount).toLocaleString()} บาท`} />}
            {req.department && <InfoRow icon={<User size={14} />}       label="หน่วยงาน"    value={req.department} />}
            {req.requester_name && <InfoRow icon={<User size={14} />}   label="ผู้ขออนุมัติ" value={req.requester_name} />}
            <InfoRow icon={<Calendar size={14} />} label="วันที่" value={dateTH(req.created_at)} />
          </div>

          {isActive && step === 'confirm' && !showReject && (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">บันทึกผู้อนุมัติ</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                placeholder="เงื่อนไข หมายเหตุ หรือข้อสังเกต..."
                className={inputCls + ' resize-none'} />
            </div>
          )}

          {step === 'sign' && (
            <SignaturePad
              onConfirm={doApprove}
              onCancel={() => setStep('confirm')} />
          )}

          {isActive && showReject && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-bold text-red-700">ระบุเหตุผลที่ไม่อนุมัติ</p>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2}
                placeholder="งบเกินวงเงิน / เอกสารไม่ครบ / อื่นๆ..."
                className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white resize-none focus:outline-none" />
              <div className="flex gap-2">
                <button onClick={() => setShowReject(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-600">
                  ยกเลิก
                </button>
                <button onClick={doReject} disabled={acting || !rejectReason.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white disabled:opacity-50">
                  {acting ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'ยืนยัน'}
                </button>
              </div>
            </div>
          )}

          {!isActive && req.approver_note && (
            <div className={`rounded-xl p-3.5 ${req.status === 'rejected' ? 'bg-red-50' : 'bg-emerald-50'}`}>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-1"
                style={{ color: req.status === 'rejected' ? '#dc2626' : '#059669' }}>
                {req.status === 'rejected' ? 'เหตุผลที่ไม่อนุมัติ' : 'บันทึกผู้อนุมัติ'}
              </p>
              <p className="text-sm leading-relaxed"
                style={{ color: req.status === 'rejected' ? '#b91c1c' : '#047857' }}>
                {req.approver_note}
              </p>
              {req.approver_name && (
                <p className="text-xs mt-1.5" style={{ color: req.status === 'rejected' ? '#ef4444' : '#10b981' }}>
                  โดย {req.approver_name} · {dateTH(req.approved_at)}
                </p>
              )}
            </div>
          )}

          {/* Show signature image if signed */}
          {req.signature_data && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">ลายมือชื่อผู้อนุมัติ</p>
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50 p-2">
                <img src={req.signature_data} alt="ลายเซ็น" className="max-h-24 mx-auto" />
              </div>
            </div>
          )}
        </div>

        {isActive && step === 'confirm' && !showReject && (
          <div className="px-4 pb-6 pt-3 border-t border-gray-100 space-y-2 shrink-0">
            {req.requires_signature ? (
              <button onClick={() => setStep('sign')}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all"
                style={{ backgroundColor: '#10b981' }}>
                <PenLine size={16} /> ลงนามอนุมัติ
              </button>
            ) : (
              <button onClick={() => doApprove(null)} disabled={acting}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition-all disabled:opacity-50"
                style={{ backgroundColor: '#10b981' }}>
                {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                อนุมัติ
              </button>
            )}
            <button onClick={() => setShowReject(true)}
              className="w-full py-2.5 rounded-2xl font-semibold text-red-500 bg-red-50 hover:bg-red-100 text-sm transition-colors flex items-center justify-center gap-2">
              <XCircle size={16} /> ไม่อนุมัติ
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── New Approval Sheet ───────────────────────────────────────────────────────

const EMPTY_APPR = { request_type: 'expense_claim', title: '', description: '', amount: '', department: '' }

function NewApprovalSheet({ tenant, staffProfile, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_APPR)
  const [saving, setSaving] = useState(false)
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const reqType = APPROVAL_TYPES.find(t => t.value === form.request_type)

  async function handleCreate() {
    if (!form.title.trim()) return
    setSaving(true)
    const { data } = await supabase.from('approval_requests').insert({
      municipality_id:    tenant.id,
      request_type:       form.request_type,
      requires_signature: reqType?.requiresSign ?? false,
      title:              form.title.trim(),
      description:        form.description.trim() || null,
      amount:             form.amount ? Number(form.amount) : null,
      department:         form.department.trim() || null,
      created_by:         staffProfile?.id ?? null,
      requester_name:     staffProfile?.full_name ?? null,
      status:             'pending',
    }).select().single()
    setSaving(false)
    if (data) { onCreated(data); onClose() }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-xl md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500"><X size={18} /></button>
          <p className="font-bold text-gray-800">สร้างคำขออนุมัติ</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ประเภทคำขอ</label>
            <select value={form.request_type} onChange={set('request_type')} className={inputCls}>
              {APPROVAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {reqType && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${reqType.requiresSign ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
              {reqType.requiresSign
                ? <><PenLine size={12} /> ต้องผู้บริหารลงนาม</>
                : <><CheckCircle2 size={12} /> กดอนุมัติได้เลย — ไม่ต้องลงนาม</>}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">หัวข้อ / เรื่อง *</label>
            <input type="text" value={form.title} onChange={set('title')}
              placeholder="เช่น เบิกค่าน้ำมัน เดือนมิถุนายน 2568" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">รายละเอียด</label>
            <textarea value={form.description} onChange={set('description')} rows={3}
              placeholder="รายละเอียดเพิ่มเติม รายการ เหตุผล..." className={inputCls + ' resize-none'} />
          </div>
          {reqType?.requiresSign && (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">จำนวนเงิน (บาท)</label>
              <input type="number" min="0" value={form.amount} onChange={set('amount')}
                placeholder="0.00" className={inputCls} />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">กอง / หน่วยงาน</label>
            <input type="text" value={form.department} onChange={set('department')}
              placeholder="กองคลัง, กองช่าง, สำนักปลัด..." className={inputCls} />
          </div>
        </div>
        <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
          <button onClick={handleCreate} disabled={saving || !form.title.trim()}
            className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm active:scale-[0.98] transition-all"
            style={{ backgroundColor: '#10b981' }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            สร้างคำขออนุมัติ
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Approve Module ───────────────────────────────────────────────────────────

function ApproveModule({ tenant, staffProfile }) {
  const [requests, setRequests]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [filterStatus, setFilterStatus] = useState('pending')
  const [selected, setSelected]     = useState(null)
  const [showAdd, setShowAdd]       = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('approval_requests')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRequests(data ?? []); setLoading(false) })
  }, [tenant?.id])

  function handleApproved(id, newStatus) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r))
  }

  const TABS = [
    { key: 'pending',  label: 'รออนุมัติ' },
    { key: 'approved', label: 'อนุมัติแล้ว' },
    { key: 'all',      label: 'ทั้งหมด' },
  ]
  const counts = {
    pending:  requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    all:      requests.length,
  }
  const filtered      = filterStatus === 'all' ? requests : requests.filter(r => r.status === filterStatus)
  const pendingList   = filtered.filter(r => r.status === 'pending')
  const needsSign     = pendingList.filter(r => r.requires_signature)
  const quickApprove  = pendingList.filter(r => !r.requires_signature)
  const donePending   = filtered.filter(r => r.status !== 'pending')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">อนุมัติ</h2>
          <p className="text-xs text-gray-400 mt-0.5">คำขออนุมัติและลงนาม</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
          style={{ backgroundColor: '#10b981' }}>
          <Plus size={14} /> สร้างคำขอ
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setFilterStatus(t.key)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all"
            style={filterStatus === t.key
              ? { backgroundColor: '#10b981', color: '#fff' }
              : { backgroundColor: '#f1f5f9', color: '#64748b' }}>
            {t.label}
            {counts[t.key] > 0 && (
              <span className="text-[10px] font-bold px-1 rounded-full"
                style={filterStatus === t.key
                  ? { backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff' }
                  : { backgroundColor: '#e2e8f0', color: '#64748b' }}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-200" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <CheckSquare size={44} className="mb-3 opacity-20" />
          <p className="text-sm font-semibold text-gray-400">ไม่มีคำขออนุมัติ</p>
          <p className="text-xs text-gray-300 mt-1">กด "+ สร้างคำขอ" เพื่อเพิ่มรายการ</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filterStatus === 'pending' && needsSign.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <PenLine size={13} className="text-amber-500" />
                <p className="text-xs font-bold text-amber-600">ต้องลงนาม ({needsSign.length})</p>
              </div>
              {needsSign.map(req => (
                <ApprovalCard key={req.id} req={req} onClick={() => setSelected(req)} />
              ))}
            </div>
          )}
          {filterStatus === 'pending' && quickApprove.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <CheckCircle2 size={13} className="text-emerald-500" />
                <p className="text-xs font-bold text-emerald-600">กดอนุมัติได้เลย ({quickApprove.length})</p>
              </div>
              {quickApprove.map(req => (
                <ApprovalCard key={req.id} req={req} onClick={() => setSelected(req)} />
              ))}
            </div>
          )}
          {filterStatus !== 'pending' && (
            <div className="space-y-2">
              {filtered.map(req => <ApprovalCard key={req.id} req={req} onClick={() => setSelected(req)} />)}
            </div>
          )}
          {filterStatus === 'pending' && donePending.length > 0 && (
            <div className="space-y-2">
              {donePending.map(req => <ApprovalCard key={req.id} req={req} onClick={() => setSelected(req)} />)}
            </div>
          )}
        </div>
      )}

      {selected && (
        <ApproveSheet req={selected} approverProfile={staffProfile}
          onClose={() => setSelected(null)} onApproved={handleApproved} />
      )}
      {showAdd && (
        <NewApprovalSheet tenant={tenant} staffProfile={staffProfile}
          onClose={() => setShowAdd(false)}
          onCreated={r => setRequests(prev => [r, ...prev])} />
      )}
    </div>
  )
}

// ─── Report Module ────────────────────────────────────────────────────────────

function ReportModule({ tenant }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod]   = useState('month')

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    let query = supabase
      .from('document_requests')
      .select('document_type, status, created_at')
      .eq('municipality_id', tenant.id)
    if (period !== 'all') {
      const since = new Date()
      if (period === 'week') since.setDate(since.getDate() - 7)
      else { since.setDate(1); since.setHours(0, 0, 0, 0) }
      query = query.gte('created_at', since.toISOString())
    }
    query.then(({ data }) => { setRows(data ?? []); setLoading(false) })
  }, [tenant?.id, period])

  const total    = rows.length
  const byStatus = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {})
  const byType   = rows.reduce((acc, r) => { acc[r.document_type] = (acc[r.document_type] ?? 0) + 1; return acc }, {})

  function exportCSV() {
    if (!rows.length) return
    const BOM = '﻿'
    const headers = ['ประเภทเอกสาร', 'สถานะ', 'วันที่ยื่น']
    const lines = rows.map(r => {
      const typeLabel   = DOC_TYPES.find(d => d.value === r.document_type)?.label.replace(/^\S+\s*/, '') ?? r.document_type
      const statusLabel = STATUS[r.status]?.label ?? r.status
      const date        = new Date(r.created_at).toLocaleDateString('th-TH')
      return [typeLabel, statusLabel, date].map(v => `"${v}"`).join(',')
    })
    const csv  = BOM + [headers.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `รายงาน-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const PERIODS = [
    { key: 'week',  label: '7 วัน' },
    { key: 'month', label: 'เดือนนี้' },
    { key: 'all',   label: 'ทั้งหมด' },
  ]
  const statCards = [
    { label: 'ทั้งหมด',     count: total,                    color: '#64748b', bg: '#f1f5f9' },
    { label: 'รอดำเนินการ', count: byStatus.pending    ?? 0, color: '#f59e0b', bg: '#fef3c7' },
    { label: 'กำลังดำเนิน', count: byStatus.processing ?? 0, color: '#3b82f6', bg: '#dbeafe' },
    { label: 'เสร็จสิ้น',   count: byStatus.completed  ?? 0, color: '#10b981', bg: '#d1fae5' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-800">รายงาน</h2>
          <p className="text-xs text-gray-400 mt-0.5">สรุปสถิติการออกเอกสาร</p>
        </div>
        <button onClick={exportCSV} disabled={!rows.length}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-600 hover:bg-amber-100 disabled:opacity-40 transition-colors">
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Period picker */}
      <div className="flex gap-2">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
            style={period === p.key
              ? { backgroundColor: '#f59e0b', color: '#fff' }
              : { backgroundColor: '#f1f5f9', color: '#64748b' }}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-200" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-2.5">
            {statCards.map(s => (
              <div key={s.label} className="rounded-2xl p-4 shadow-sm border border-gray-100"
                style={{ backgroundColor: s.bg }}>
                <p className="text-3xl font-bold" style={{ color: s.color }}>{s.count}</p>
                <p className="text-xs font-semibold mt-1" style={{ color: s.color }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Breakdown by type */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-sm font-bold text-gray-700 mb-3">แยกตามประเภทเอกสาร</p>
            {total === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">ไม่มีข้อมูลในช่วงเวลานี้</p>
            ) : (
              <div className="space-y-3">
                {DOC_TYPES
                  .filter(d => byType[d.value])
                  .sort((a, b) => (byType[b.value] ?? 0) - (byType[a.value] ?? 0))
                  .map(d => {
                    const count = byType[d.value] ?? 0
                    const pct   = total > 0 ? (count / total * 100) : 0
                    return (
                      <div key={d.value}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-600 truncate max-w-[72%]">{d.label}</span>
                          <span className="text-xs font-bold text-gray-800">{count} ครั้ง</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: '#f59e0b' }} />
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>

          {/* Completion rate */}
          {total > 0 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-4">
              <div>
                <p className="text-3xl font-bold text-emerald-600">
                  {Math.round((byStatus.completed ?? 0) / total * 100)}%
                </p>
                <p className="text-xs font-semibold text-emerald-500 mt-0.5">อัตราดำเนินการสำเร็จ</p>
              </div>
              <div className="flex-1 text-right">
                <p className="text-xs text-emerald-600">{byStatus.completed ?? 0} จาก {total} คำขอ</p>
                {(byStatus.rejected ?? 0) > 0 && (
                  <p className="text-xs text-red-400 mt-0.5">ปฏิเสธ {byStatus.rejected} ครั้ง</p>
                )}
              </div>
            </div>
          )}
        </>
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

// ─── Complaints Module (staff-side) ───────────────────────────────────────────

const C_STATUS = {
  pending:     { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7' },
  received:    { label: 'รับเรื่องแล้ว',  color: '#3b82f6', bg: '#dbeafe' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#8b5cf6', bg: '#ede9fe' },
  completed:   { label: 'เสร็จสิ้น',     color: '#10b981', bg: '#d1fae5' },
  rejected:    { label: 'ปฏิเสธ',        color: '#ef4444', bg: '#fee2e2' },
}
const C_NEXT = {
  pending:     { label: 'รับเรื่อง',       next: 'received' },
  received:    { label: 'เริ่มดำเนินการ', next: 'in_progress' },
  in_progress: { label: 'ปิดงาน',         next: 'completed' },
}
const C_CAT = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง', trash: 'ขยะ/ความสะอาด',
  water: 'น้ำประปา', flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', other: 'อื่นๆ',
}

function ComplaintsStaffModule({ tenant, staffId }) {
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [updating, setUpdating]     = useState(null)

  useEffect(() => { fetchAll() }, [tenant?.id])

  async function fetchAll() {
    if (!tenant?.id) return
    setLoading(true)
    const { data } = await supabase.from('complaints')
      .select('*, profiles(full_name, phone)')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
    setComplaints(data ?? [])
    setLoading(false)
  }

  async function advanceStatus(id, next) {
    setUpdating(id)
    await supabase.from('complaints').update({ status: next, updated_at: new Date().toISOString() }).eq('id', id)
    setComplaints(prev => prev.map(c => c.id === id ? { ...c, status: next } : c))
    setUpdating(null)
  }

  const filtered = complaints.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return (c.description ?? '').toLowerCase().includes(q) || (C_CAT[c.category] ?? '').toLowerCase().includes(q) || (c.profiles?.full_name ?? '').toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-gray-800">คำร้องประชาชน</h2>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all','pending','received','in_progress','completed','rejected'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${filterStatus === s ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200'}`}
            style={filterStatus === s ? { backgroundColor: C_STATUS[s]?.color ?? 'var(--color-primary)' } : {}}>
            {s === 'all' ? 'ทั้งหมด' : C_STATUS[s]?.label ?? s}
            {s === 'all' && ` (${complaints.length})`}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาคำร้อง..."
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400 text-sm">ไม่พบคำร้อง</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const st = C_STATUS[c.status]
            const nx = C_NEXT[c.status]
            const date = new Date(c.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
            return (
              <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: st?.bg, color: st?.color }}>{st?.label}</span>
                      <span className="text-xs text-gray-400">{C_CAT[c.category] ?? c.category}</span>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{date}</span>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">{c.description}</p>
                    {c.profiles?.full_name && <p className="text-xs text-gray-400 mt-1">👤 {c.profiles.full_name}</p>}
                  </div>
                  {nx && (
                    <button onClick={() => advanceStatus(c.id, nx.next)} disabled={updating === c.id}
                      className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--color-primary)' }}>
                      {updating === c.id ? '...' : nx.label}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StaffReportWrapper({ tenant }) {
  const [complaints, setComplaints] = useState([])
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('complaints').select('*, profiles(full_name, phone)').eq('municipality_id', tenant.id).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, email').eq('municipality_id', tenant.id).eq('role', 'technician'),
    ]).then(([{ data: c }, { data: t }]) => {
      setComplaints(c ?? [])
      setTechnicians(t ?? [])
      setLoading(false)
    })
  }, [tenant?.id])
  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
  return <ReportManager complaints={complaints} tenant={tenant} technicians={technicians} />
}

// ─── Staff Home Dashboard ─────────────────────────────────────────────────────

function StaffHomeModule({ visibleGroups, setActiveModule, pendingCount, staffName }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-800">สวัสดี{staffName ? `, ${staffName}` : ''} 👋</h2>
        <p className="text-sm text-gray-400 mt-0.5">เลือกเมนูที่ต้องการดำเนินการ</p>
      </div>
      {visibleGroups.map(({ group, items }) => (
        <div key={group}>
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">{group}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map(({ key, label, Icon, color, externalUrl }) => (
              <button
                key={key}
                onClick={() => externalUrl ? window.open(externalUrl, '_blank') : setActiveModule(key)}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col items-start gap-3 text-left hover:shadow-md active:scale-95 transition-all">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                     style={{ backgroundColor: color + '18' }}>
                  <Icon size={20} style={{ color }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-700">{label}</p>
                  {key === 'inbox' && pendingCount > 0 && (
                    <p className="text-xs font-semibold mt-0.5" style={{ color: '#ef4444' }}>{pendingCount} รายการรอ</p>
                  )}
                  {externalUrl && (
                    <p className="text-[10px] text-gray-400 mt-0.5">เปิดใน Facebook ↗</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StaffDashboard() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [activeModule, setActiveModule] = useState('home')

  const enabledKeys = tenant?.enabled_modules ?? MODULES.map(m => m.key)
  const visibleGroups = MODULE_GROUPS
    .map(g => ({ ...g, items: g.items.filter(m => enabledKeys.includes(m.key)) }))
    .filter(g => g.items.length > 0)
  const visibleModules = visibleGroups.flatMap(g => g.items)
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
    Promise.all([
      supabase.from('document_requests')
        .select('id', { count: 'exact', head: true })
        .eq('municipality_id', tenant.id)
        .eq('status', 'pending'),
      supabase.from('approval_requests')
        .select('id', { count: 'exact', head: true })
        .eq('municipality_id', tenant.id)
        .eq('status', 'pending'),
    ]).then(([docs, approvals]) => {
      setPendingCount((docs.count ?? 0) + (approvals.count ?? 0))
    })
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
          <button onClick={() => navigate('/')} className="flex items-center gap-3 w-full text-left hover:opacity-80 transition-opacity">
            <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0"
              style={!tenant?.logo_url ? { background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' } : {}}>
              {tenant?.logo_url
                ? <img src={tenant.logo_url} alt="" className="w-full h-full object-cover" />
                : <span className="flex items-center justify-center w-full h-full text-white text-base">🏛️</span>}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-800 truncate">{tenant?.name ?? 'Staff Portal'}</p>
              <p className="text-xs font-semibold text-blue-500">ระบบเจ้าหน้าที่</p>
            </div>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          <button onClick={() => setActiveModule('home')}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-all mb-2"
            style={activeModule === 'home' ? { backgroundColor: '#3b82f618', color: '#3b82f6' } : { color: '#94a3b8' }}>
            <Home size={16} strokeWidth={activeModule === 'home' ? 2.2 : 1.5} />
            <span className="flex-1 text-left text-xs">หน้าหลัก</span>
          </button>
          {visibleGroups.map(({ group, items }) => (
            <div key={group} className="mb-4">
              <p className="px-3 mb-1 text-[9px] font-bold uppercase tracking-widest text-gray-400">{group}</p>
              <div className="space-y-0.5">
                {items.map(({ key, label, Icon, color, externalUrl }) => {
                  const isActive = activeModule === key
                  const badge    = key === 'inbox' && pendingCount > 0 ? pendingCount : null
                  return (
                    <button key={key} onClick={() => externalUrl ? window.open(externalUrl, '_blank') : setActiveModule(key)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all"
                      style={isActive
                        ? { backgroundColor: color + '18', color }
                        : { color: '#64748b' }}>
                      <Icon size={17} strokeWidth={isActive ? 2.2 : 1.5} />
                      <span className="flex-1 text-left">{label}</span>
                      {badge && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white bg-amber-400">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
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
                <p className="text-[10px] text-gray-400">{ROLE_TH[profile.role] ?? profile.role}</p>
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
          <button onClick={() => navigate('/')}
            className="w-8 h-8 rounded-xl overflow-hidden shrink-0 active:opacity-70 transition-opacity"
            style={!tenant?.logo_url ? { background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' } : {}}>
            {tenant?.logo_url
              ? <img src={tenant.logo_url} alt="" className="w-full h-full object-cover" />
              : <span className="flex items-center justify-center w-full h-full text-white">🏛️</span>}
          </button>
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
              {activeModule === 'home' ? 'หน้าหลัก' : visibleModules.find(m => m.key === activeModule)?.label}
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
          {activeModule === 'home'       && <StaffHomeModule visibleGroups={visibleGroups} setActiveModule={setActiveModule} pendingCount={pendingCount} staffName={profile?.full_name} />}
          {activeModule === 'inbox'      && <InboxModule tenant={tenant} staffId={profile?.id} />}
          {activeModule === 'docs'       && <DocsModule tenant={tenant} staffId={profile?.id} />}
          {activeModule === 'complaints' && <ComplaintsManager tenant={tenant} currentUserRole={profile?.role ?? 'staff'} />}
          {activeModule === 'events'     && <EventsManager tenant={tenant} currentUserRole={profile?.role ?? 'staff'} />}
          {activeModule === 'approve'    && <ApproveModule tenant={tenant} staffProfile={profile} />}
          {activeModule === 'projects'   && <CivilProjectAdmin tenant={tenant} currentUserRole={profile?.role ?? 'staff'} />}
          {activeModule === 'map'        && <MapDashboardAdmin tenant={tenant} currentUserRole={profile?.role ?? 'staff'} onNavigate={() => {}} />}
          {activeModule === 'report'     && <StaffReportWrapper tenant={tenant} />}
          {activeModule === 'docs-archive' && <DocumentArchive tenant={tenant} profile={profile} />}

        </main>

        {/* Mobile bottom nav — horizontal scroll, 72px per item */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-lg z-20 safe-bottom">
          <div className="flex overflow-x-auto" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
            {/* หน้าหลัก */}
            <button onClick={() => setActiveModule('home')}
              className="flex flex-col items-center gap-1 pt-2 pb-3 relative transition-colors shrink-0"
              style={{ width: 72 }}>
              {activeModule === 'home' && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-blue-500" />
              )}
              <Home size={21} strokeWidth={activeModule === 'home' ? 2.2 : 1.5}
                style={{ color: activeModule === 'home' ? '#3b82f6' : '#94a3b8' }} />
              <span className="text-[10px] font-semibold"
                style={{ color: activeModule === 'home' ? '#3b82f6' : '#94a3b8' }}>หน้าหลัก</span>
            </button>
            {visibleModules.map(({ key, label, Icon, color, externalUrl }) => {
              const isActive = activeModule === key
              const badge    = key === 'inbox' && pendingCount > 0 ? pendingCount : null
              return (
                <button key={key} onClick={() => externalUrl ? window.open(externalUrl, '_blank') : setActiveModule(key)}
                  className="flex flex-col items-center gap-1 pt-2 pb-3 relative transition-colors shrink-0"
                  style={{ width: 72 }}>
                  {isActive && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                      style={{ backgroundColor: color }} />
                  )}
                  <div className="relative">
                    <Icon size={21} strokeWidth={isActive ? 2.2 : 1.5}
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
