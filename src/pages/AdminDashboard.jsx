import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import {
  RefreshCw, ClipboardList, Clock, Loader2,
  CheckCircle2, XCircle, AlertCircle, ChevronRight,
  Filter, Search, Phone, Trash2, Plus, PhoneCall, LogOut, Users, Shield, MapPin, GripVertical,
  X, FileText, AlignLeft, Image, Calendar, Hash, Home, LayoutGrid, Tag, ChevronUp, ChevronDown, Pencil, Wrench, Camera,
  TrendingUp, AlertTriangle, Printer,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  pending:     { label: 'รอดำเนินการ',    color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   color: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#8b5cf6', bg: '#ede9fe', text: '#5b21b6' },
  completed:   { label: 'เสร็จสิ้น',      color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         color: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
}

const STATUS_FLOW = ['pending', 'received', 'in_progress', 'completed']
const STATUS_FLOW_LABEL = {
  pending:     { label: 'รอดำเนินการ',    desc: 'ประชาชนส่งคำร้องเข้าระบบ' },
  received:    { label: 'รับเรื่องแล้ว',   desc: 'เจ้าหน้าที่รับเรื่องและตรวจสอบ' },
  in_progress: { label: 'กำลังดำเนินการ', desc: 'อยู่ระหว่างดำเนินการแก้ไข' },
  completed:   { label: 'เสร็จสิ้น',      desc: 'ดำเนินการเสร็จสิ้นเรียบร้อย' },
}

const NEXT_ACTION = {
  pending:     { label: 'รับเรื่อง',       next: 'received' },
  received:    { label: 'เริ่มดำเนินการ', next: 'in_progress' },
  in_progress: { label: 'ปิดงาน',         next: 'completed' },
}

const CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', other: 'อื่นๆ',
}

const CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', other: '📝',
}

const FILTER_TABS = ['ทั้งหมด', ...Object.values(STATUS).map((s) => s.label)]
const FILTER_KEYS = [null, ...Object.keys(STATUS)]

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
           style={{ backgroundColor: `${color}20` }}>
        <Icon size={22} style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-800 leading-none">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.pending
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
          style={{ backgroundColor: s.bg, color: s.text }}>
      {s.label}
    </span>
  )
}

function StatusStepper({ status }) {
  if (status === 'rejected') {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 rounded-2xl border border-red-100">
        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
          <XCircle size={20} className="text-red-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-red-700">คำร้องถูกปฏิเสธ</p>
          <p className="text-xs text-red-400 mt-0.5">ระบบยุติการดำเนินการคำร้องนี้</p>
        </div>
      </div>
    )
  }

  const currentIdx = STATUS_FLOW.indexOf(status)

  return (
    <div className="space-y-0">
      {STATUS_FLOW.map((step, i) => {
        const done = i <= currentIdx
        const isCurrent = i === currentIdx
        const isLast = i === STATUS_FLOW.length - 1
        const info = STATUS_FLOW_LABEL[step]

        return (
          <div key={step} className="flex gap-4">
            {/* line + dot column */}
            <div className="flex flex-col items-center">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-all mt-1"
                style={done
                  ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' }
                  : { backgroundColor: '#fff', borderColor: '#e5e7eb' }}
              >
                {done && !isCurrent ? (
                  <CheckCircle2 size={14} className="text-white" />
                ) : isCurrent ? (
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                )}
              </div>
              {!isLast && (
                <div
                  className="w-0.5 flex-1 my-1 rounded-full"
                  style={{ backgroundColor: i < currentIdx ? 'var(--color-primary)' : '#e5e7eb', minHeight: '28px' }}
                />
              )}
            </div>

            {/* text column */}
            <div className={`pb-5 pt-0.5 ${isLast ? 'pb-0' : ''}`}>
              <p className={`text-sm font-semibold transition-colors ${done ? 'text-gray-800' : 'text-gray-300'}`}>
                {info.label}
                {isCurrent && (
                  <span className="ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)' }}>
                    ปัจจุบัน
                  </span>
                )}
              </p>
              <p className={`text-xs mt-0.5 transition-colors ${done ? 'text-gray-400' : 'text-gray-200'}`}>
                {info.desc}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ActionButton({ status, id, onUpdate, loading }) {
  const action = NEXT_ACTION[status]
  if (!action) return null
  return (
    <button onClick={() => onUpdate(id, action.next)} disabled={loading === id}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
      style={{ backgroundColor: 'var(--color-primary)' }}>
      {loading === id
        ? <Loader2 size={12} className="animate-spin" />
        : <ChevronRight size={12} />}
      {action.label}
    </button>
  )
}

function RejectButton({ status, id, onUpdate, loading }) {
  if (status === 'completed' || status === 'rejected') return null
  return (
    <button onClick={() => onUpdate(id, 'rejected')} disabled={loading === id}
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50">
      <XCircle size={12} /> ปฏิเสธ
    </button>
  )
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="bg-white shadow-lg rounded-xl px-3 py-2 text-sm border border-gray-100">
      <p className="font-medium text-gray-700">{name}</p>
      <p className="text-gray-500">{value} รายการ</p>
    </div>
  )
}

// ─── Fixed-position custom select (ไม่โดน overflow:hidden ของ modal ตัด) ──────
function FixedSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const btnRef = useRef(null)

  function toggle() {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setOpen(o => !o)
  }

  const selected = options.find(o => o.value === value)
  const ITEM_H = 44
  const listH = options.length * ITEM_H + 8
  const spaceBelow = rect ? window.innerHeight - rect.bottom - 8 : 0
  const openUp = rect && spaceBelow < listH

  return (
    <>
      <button ref={btnRef} onClick={toggle} type="button"
        className="flex-1 text-xs border border-purple-200 rounded-xl px-3 py-2 text-gray-700 bg-purple-50 text-left flex items-center justify-between gap-2">
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={12} className="text-purple-400 shrink-0" />
      </button>
      {open && rect && (
        <div className="fixed inset-0 z-[9999]" onClick={() => setOpen(false)}>
          <div
            className="absolute bg-white rounded-xl shadow-xl border border-gray-200 py-1"
            style={{
              left: rect.left,
              width: rect.width,
              ...(openUp
                ? { bottom: window.innerHeight - rect.top + 4 }
                : { top: rect.bottom + 4 }),
            }}
            onClick={e => e.stopPropagation()}
          >
            {options.map(o => (
              <button key={o.value} type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-purple-50 transition-colors ${o.value === value ? 'text-purple-600 font-semibold' : 'text-gray-700'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Complaint Detail Modal ───────────────────────────────────────────────────
function ComplaintDetailModal({ complaint: c, onClose, onUpdate, updating, technicians, onAssign, currentUserRole, onDelete }) {
  const { tenant } = useTenant()
  const [assigning, setAssigning] = useState(false)
  const [showCloseJob, setShowCloseJob] = useState(false)
  const [pendingPhotos, setPendingPhotos] = useState([])
  const [closeNote, setCloseNote] = useState('')
  const [closeUploading, setCloseUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!window.confirm(`ลบคำร้องนี้ออกจากระบบ?\n\nการลบไม่สามารถย้อนกลับได้`)) return
    setDeleting(true)
    const { error } = await supabase.from('complaints').delete().eq('id', c.id)
    setDeleting(false)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    onDelete(c.id)
    onClose()
  }

  if (!c) return null

  function handlePrintComplaint() {
    const d = new Date(c.created_at)
    const thDate = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    const yy = String(d.getFullYear() + 543).slice(-2)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const num = c.complaint_number ? `${yy}${mm}${String(c.complaint_number).padStart(3, '0')}` : '—'
    const reporter = c.reporter_name || c.profiles?.full_name || '—'
    const phone = c.phone || c.profiles?.phone || '—'
    const cat = CATEGORY_LABEL[c.category] ?? c.category ?? '—'
    const statusLabel = STATUS[c.status]?.label ?? c.status
    const location = [c.location_name, c.village].filter(Boolean).join(', ') || '—'
    const assignee = c.assigned_to_name || '—'
    const nowTH = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })

    const workPhotosHtml = (c.work_photos ?? []).length > 0
      ? `<p style="margin:16px 0 6px;font-weight:600">ภาพผลการดำเนินงาน</p>
         <div style="display:flex;flex-wrap:wrap;gap:8px">${(c.work_photos).map(u => `<img src="${u}" style="width:160px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb">`).join('')}</div>`
      : ''

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<title>ใบคำร้อง ${num}</title>
<style>
  @page { size: A4 portrait; margin: 2cm 2cm 2cm 2.5cm; }
  body { font-family: 'Sarabun', sans-serif; font-size: 15px; color: #111; line-height: 1.7; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .title { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
  .sub { font-size: 14px; color: #555; margin-bottom: 20px; }
  table.info { width: 100%; border-collapse: collapse; margin-top: 12px; }
  table.info td { padding: 5px 10px; font-size: 14px; }
  table.info td:first-child { width: 160px; font-weight: 600; color: #374151; }
  .detail-box { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px 16px; margin-top: 8px; font-size: 14px; line-height: 1.8; background: #f9fafb; }
  .badge { display:inline-block; padding:2px 10px; border-radius:99px; font-size:12px; font-weight:700; }
  .footer { margin-top:40px; display:flex; justify-content:flex-end; }
  .sign-block { text-align:center; width:220px; }
  .sign-line { border-top:1px solid #374151; margin-top:48px; padding-top:6px; font-size:13px; }
  @media print { button { display:none; } }
</style></head><body>
<div class="center">
  <div class="title">${tenant?.name ?? 'หน่วยงาน'}</div>
  <div class="sub">ใบบันทึกคำร้องออนไลน์ &nbsp;|&nbsp; เลขที่ ${num}</div>
</div>
<hr style="border:none;border-top:2px solid #1d4ed8;margin:0 0 16px">

<table class="info">
  <tr><td>ประเภทคำร้อง</td><td class="bold">${cat}</td></tr>
  ${c.subject ? `<tr><td>เรื่อง</td><td>${c.subject}</td></tr>` : ''}
  <tr><td>ผู้แจ้ง</td><td>${reporter}</td></tr>
  <tr><td>เบอร์ติดต่อ</td><td>${phone}</td></tr>
  <tr><td>วันที่ยื่นคำร้อง</td><td>${thDate}</td></tr>
  <tr><td>จุดเกิดเหตุ</td><td>${location}</td></tr>
  ${c.latitude ? `<tr><td>พิกัด GPS</td><td>${Number(c.latitude).toFixed(6)}, ${Number(c.longitude).toFixed(6)}</td></tr>` : ''}
  <tr><td>สถานะ</td><td><span class="badge" style="background:${STATUS[c.status]?.bg ?? '#f3f4f6'};color:${STATUS[c.status]?.text ?? '#374151'}">${statusLabel}</span></td></tr>
</table>

<p style="margin:20px 0 6px;font-weight:600">รายละเอียดคำร้อง</p>
<div class="detail-box">${(c.detail ?? '—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>

${workPhotosHtml}

<div class="footer">
  <div class="sign-block">
    <div class="sign-line">
      <div>(............................................)</div>
      <div style="margin-top:2px">ผู้รับคำร้อง</div>
      <div style="color:#555;font-size:12px">วันที่ ${nowTH}</div>
    </div>
  </div>
</div>
</body></html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  async function handleCloseJob() {
    setCloseUploading(true)
    const urls = []
    for (const item of pendingPhotos) {
      const ext = item.file.name.split('.').pop()
      const path = `${c.id}/work_${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('complaint-attachments')
        .upload(path, item.file, { upsert: false })
      if (!error) {
        const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    }
    setCloseUploading(false)
    onUpdate(c.id, 'completed', urls, closeNote.trim() || null)
    onClose()
  }
  const attachments = c.attachments ?? []
  const categoryLabel = CATEGORY_LABEL[c.category] ?? c.category
  const categoryEmoji = CATEGORY_EMOJI[c.category] ?? '📄'
  const dateStr = new Date(c.created_at).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Header - Gradient */}
        <div className="shrink-0 px-5 pt-6 pb-5 relative"
             style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 60%, color-mix(in srgb, var(--color-primary) 70%, #7c3aed) 100%)' }}>
          <button onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors">
            <X size={16} />
          </button>

          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shrink-0">
              {categoryEmoji}
            </div>
            <div className="flex-1 min-w-0 pr-10">
              <p className="text-white/70 text-xs font-medium">ประเภทคำร้อง</p>
              <p className="text-white font-bold text-base leading-tight mt-0.5">{categoryLabel}</p>
              {c.subject && (
                <p className="text-white/80 text-sm mt-1 leading-snug">{c.subject}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/20">
            <div>
              <p className="text-white/60 text-[11px] uppercase tracking-wider">เลขที่คำร้อง</p>
              <p className="text-white font-black text-lg tracking-wider mt-0.5 font-mono">
                {c.complaint_number ? (() => { const d = new Date(c.created_at); const yy = String(d.getFullYear()+543).slice(-2); const mm = String(d.getMonth()+1).padStart(2,'0'); return `${yy}${mm}${String(c.complaint_number).padStart(3,'0')}` })() : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-[11px] uppercase tracking-wider">ยื่นเมื่อ</p>
              <p className="text-white/90 text-xs font-medium mt-0.5">{dateStr} น.</p>
            </div>
          </div>
        </div>

        {/* scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5 bg-white">
          {/* status stepper */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">ความคืบหน้า</p>
            <StatusStepper status={c.status} />
          </div>

          {/* assign technician */}
          {technicians?.length > 0 && c.status !== 'completed' && c.status !== 'rejected' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">มอบหมายให้ช่าง</p>
              <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
                <div className="flex items-center gap-3">
                  <Wrench size={16} className="text-orange-500 shrink-0" />
                  <div className="flex-1">
                    {c.assigned_to ? (
                      <p className="text-sm font-semibold text-gray-800">
                        {technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ช่าง'}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-400">ยังไม่ได้มอบหมาย</p>
                    )}
                  </div>
                  <select
                    value={c.assigned_to ?? ''}
                    onChange={async (e) => {
                      const val = e.target.value || null
                      setAssigning(true)
                      await onAssign(c.id, val)
                      setAssigning(false)
                    }}
                    disabled={assigning}
                    className="text-xs border border-orange-200 rounded-xl px-2 py-1.5 bg-white text-gray-700 focus:outline-none"
                  >
                    <option value="">— เลือกช่าง —</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
                    ))}
                  </select>
                  {assigning && <Loader2 size={14} className="animate-spin text-orange-400 shrink-0" />}
                </div>
              </div>
            </div>
          )}

          {/* contact / origin user */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">ข้อมูลผู้แจ้ง</p>
            <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center shrink-0">
                <Users size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-800">
                  {c.reporter_name || c.profiles?.full_name || 'ไม่ระบุชื่อ'}
                </p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  {c.profiles?.email || c.profiles?.phone || (c.user_id ? `ID: ${c.user_id.slice(0, 8)}` : 'ไม่ได้เข้าสู่ระบบ')}
                </p>
              </div>
            </div>
          </div>

          {/* Location + Phone */}
          {(c.location_name || c.village || c.phone || c.latitude) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">จุดเกิดเหตุและติดต่อ</p>
              <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden border border-gray-100">
                {(c.location_name || c.village) && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                      <MapPin size={15} className="text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-400">สถานที่</p>
                      <p className="text-sm font-medium text-gray-800 truncate">{c.location_name ?? c.village}</p>
                    </div>
                  </div>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`}
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors active:bg-gray-100">
                    <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                      <Phone size={15} className="text-green-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-400">เบอร์โทรติดต่อ</p>
                      <p className="text-sm font-bold text-gray-800">{c.phone}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-1 bg-green-100 text-green-700 rounded-lg shrink-0">โทรออก</span>
                  </a>
                )}
                {c.latitude && (
                  <a href={`https://maps.google.com/?q=${c.latitude},${c.longitude}`}
                     target="_blank" rel="noreferrer"
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <MapPin size={15} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-400">พิกัด</p>
                      <p className="text-sm font-medium text-gray-800">
                        {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded-lg shrink-0">เปิดแผนที่</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* detail */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดแนบมา</p>
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.detail}</p>
            </div>
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="space-y-2 pb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                ไฟล์แนบ ({attachments.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {attachments.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100 flex items-center justify-center">
                    {/\.(jpg|jpeg|png|gif|webp)$/i.test(url) ? (
                      <img src={url} alt={`ไฟล์ ${i + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <FileText size={22} className="text-gray-400" />
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}
          {/* Work photos — admin evidence */}
          {(c.work_photos ?? []).length > 0 && (
            <div className="space-y-2 pb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Camera size={12} /> หลักฐานการทำงาน ({c.work_photos.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {c.work_photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-green-200 bg-green-50 flex items-center justify-center">
                    {/\.(jpg|jpeg|png|gif|webp)$/i.test(url) ? (
                      <img src={url} alt={`ผลงาน ${i + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <FileText size={22} className="text-green-400" />
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action footer for Admin */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0 bg-gray-50">
          {currentUserRole === 'viewer' ? (
            <button onClick={onClose} className="px-4 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors">
              ปิดหน้าต่าง
            </button>
          ) : c.status === 'in_progress' && !showCloseJob ? (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setShowCloseJob(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                <CheckCircle2 size={12} /> ปิดงาน
              </button>
              <RejectButton status={c.status} id={c.id} onUpdate={(id, next) => { onUpdate(id, next, []); onClose() }} loading={updating} />
              {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
                <button onClick={handleDelete} disabled={deleting}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50">
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} ลบคำร้อง
                </button>
              )}
              <button onClick={onClose} className="ml-auto px-4 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors">
                ปิดหน้าต่าง
              </button>
            </div>
          ) : c.status === 'in_progress' && showCloseJob ? (
            <div className="space-y-3 w-full">
              <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                <Camera size={12} /> แนบรูปหลักฐานการทำงาน (ไม่บังคับ)
              </p>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-2xl py-4 cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                <Camera size={20} className="text-gray-400 mb-1" />
                <span className="text-xs text-gray-400">แตะเพื่อเลือกรูป</span>
                <input type="file" accept="image/*" multiple className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files)
                    setPendingPhotos((prev) => [
                      ...prev,
                      ...files.map((f) => ({ file: f, preview: URL.createObjectURL(f) })),
                    ])
                  }} />
              </label>
              {pendingPhotos.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5">
                  {pendingPhotos.map((p, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-200">
                      <img src={p.preview} alt="" className="w-full h-full object-cover" />
                      <button
                        className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5"
                        onClick={() => setPendingPhotos((prev) => prev.filter((_, j) => j !== i))}>
                        <X size={10} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 mb-1.5">
                  <AlignLeft size={12} /> หมายเหตุ / รายการอุปกรณ์ที่ใช้ (ไม่บังคับ)
                </p>
                <textarea
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  rows={3}
                  placeholder="เช่น เปลี่ยนหลอดไฟ LED 18W จำนวน 2 ดวง, ค่าแรง 500 บาท..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleCloseJob} disabled={closeUploading}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  {closeUploading
                    ? <><Loader2 size={14} className="animate-spin" /> กำลังอัปโหลด...</>
                    : <><CheckCircle2 size={14} /> ยืนยันปิดงาน</>}
                </button>
                <button onClick={() => { setShowCloseJob(false); setPendingPhotos([]); setCloseNote('') }}
                  className="px-4 py-2 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <ActionButton status={c.status} id={c.id} onUpdate={(id, next) => { onUpdate(id, next, []); onClose() }} loading={updating} />
              <RejectButton status={c.status} id={c.id} onUpdate={(id, next) => { onUpdate(id, next, []); onClose() }} loading={updating} />
              <button onClick={handlePrintComplaint}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                <Printer size={13} /> พิมพ์
              </button>
              {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
                <button onClick={handleDelete} disabled={deleting}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50">
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} ลบคำร้อง
                </button>
              )}
              <button onClick={onClose} className="ml-auto px-4 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors">
                ปิดหน้าต่าง
              </button>
            </div>
          )}

          {/* Superadmin: override status */}
          {currentUserRole === 'superadmin' && (
            <div className="mt-3 pt-3 border-t border-dashed border-purple-200">
              <p className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Shield size={10} /> Superadmin — แก้ไขสถานะ
              </p>
              <div className="flex items-center gap-2">
                <FixedSelect
                  value={c.status}
                  onChange={(val) => { onUpdate(c.id, val, []); onClose() }}
                  options={Object.entries(STATUS).map(([key, s]) => ({ value: key, label: s.label }))}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="text-gray-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-gray-800 font-medium mt-0.5 wrap-break-word">{value}</p>
      </div>
    </div>
  )
}

// ─── User Manager ─────────────────────────────────────────────────────────────
const ROLE_LABELS = {
  superadmin:  { label: 'Super Admin', color: '#7c3aed', bg: '#ede9fe' },
  admin:       { label: 'แอดมิน',     color: '#1d4ed8', bg: '#dbeafe' },
  technician:  { label: 'ช่าง',       color: '#d97706', bg: '#fef3c7' },
  viewer:      { label: 'ผู้บริหาร',  color: '#059669', bg: '#d1fae5' },
  citizen:     { label: 'สมาชิก',     color: '#374151', bg: '#f3f4f6' },
}

function UserManager({ tenant, currentUserRole }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [editingNameId, setEditingNameId] = useState(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('get_users_with_email', { p_municipality_id: tenant?.id ?? null })
    let list = data ?? []
    setUsers(list)
    setLoading(false)
  }, [tenant?.id, currentUserRole])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function updateName(userId) {
    const name = editingNameValue.trim()
    if (!name) return
    setSaving(userId)
    const { error } = await supabase.from('profiles').update({ full_name: name }).eq('id', userId)
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, full_name: name } : u))
      setEditingNameId(null)
    }
    setSaving(null)
  }

  async function updateRole(userId, newRole, municipalityId) {
    setSaving(userId)
    const needsMuni = newRole === 'admin' || newRole === 'technician' || newRole === 'viewer'
    const muni = needsMuni ? (municipalityId || tenant?.id) : null
    const { error } = await supabase.from('profiles').update({ role: newRole, municipality_id: muni }).eq('id', userId)
    if (error) {
      console.error('updateRole failed:', error.message)
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, role: newRole, municipality_id: muni } : u
      ))
    }
    setSaving(null)
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    const matchSearch = !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phone || '').includes(q)
    const matchRole = !filterRole || u.role === filterRole
    return matchSearch && matchRole
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-700 flex items-center gap-2">
          <Users size={16} /> จัดการผู้ใช้งาน
        </h3>
        <button onClick={fetchUsers} className="text-gray-400 hover:text-gray-600 transition-colors">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* ตัวกรอง */}
      <div className="px-4 py-3 border-b border-gray-50 flex gap-2 flex-wrap">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ, อีเมล, เบอร์..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-blue-400"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="text-xs border border-gray-200 rounded-xl px-2 py-2 text-gray-600 focus:outline-none shrink-0"
        >
          <option value="">ทุกตำแหน่ง</option>
          <option value="citizen">สมาชิก</option>
          <option value="viewer">ผู้บริหาร</option>
          <option value="technician">ช่าง</option>
          <option value="admin">แอดมิน</option>
          {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
        </select>
        {(search || filterRole) && (
          <button
            onClick={() => { setSearch(''); setFilterRole('') }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 border border-gray-200 rounded-xl px-2.5 py-2 transition-colors shrink-0"
          >
            <X size={12} /> ล้าง
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-10 text-gray-400 text-sm">{users.length === 0 ? 'ยังไม่มีผู้ใช้งาน' : 'ไม่พบผู้ใช้ที่ค้นหา'}</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {filtered.map((u) => {
            const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
            const isSelf = false
            return (
              <div key={u.id} className="flex flex-col px-4 py-3 gap-2">
                {/* แถว 1: avatar + ชื่อ + badge */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                       style={{ backgroundColor: rs.color }}>
                    {(u.full_name || u.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-medium text-gray-800 text-sm">{u.full_name || '—'}</p>
                      {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                        <button
                          onClick={() => { setEditingNameId(u.id); setEditingNameValue(u.full_name || '') }}
                          className="text-gray-300 hover:text-gray-500 transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 break-all mt-0.5">{u.email || u.phone || '—'}</p>
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                        style={{ backgroundColor: rs.bg, color: rs.color }}>
                    {rs.label}
                  </span>
                </div>
                {/* แถว 2: dropdown เปลี่ยน role (เฉพาะ admin/superadmin) */}
                {u.role !== 'superadmin' && (currentUserRole === 'superadmin' || currentUserRole === 'admin') && (
                  <div className="flex items-center gap-2 pl-12 justify-end">
                    <select
                      value={u.role}
                      disabled={saving === u.id}
                      onChange={(e) => updateRole(u.id, e.target.value, u.municipality_id)}
                      className="text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-gray-700 focus:outline-none bg-gray-50"
                    >
                      <option value="citizen">สมาชิก</option>
                      <option value="viewer">ผู้บริหาร</option>
                      <option value="technician">ช่าง</option>
                      <option value="admin">แอดมิน</option>
                      {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
                    </select>
                    {saving === u.id && <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}
                  </div>
                )}
                {editingNameId === u.id && (
                  <div className="flex items-center gap-2 pl-12">
                    <input
                      autoFocus
                      value={editingNameValue}
                      onChange={(e) => setEditingNameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') updateName(u.id); if (e.key === 'Escape') setEditingNameId(null) }}
                      placeholder="ชื่อ-นามสกุล"
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white text-gray-900"
                    />
                    <button
                      onClick={() => updateName(u.id)}
                      disabled={saving === u.id}
                      className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={() => setEditingNameId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
                    >
                      ยกเลิก
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Emergency Contacts Manager ───────────────────────────────────────────────
function SortableContact({ c, i, total, onDelete, onMove, onEdit, editingId, editingForm, onEditChange, onEditSave }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  }
  const isEditing = editingId === c.id
  return (
    <div ref={setNodeRef} style={style}
         className={`px-4 py-3 bg-white ${i < total - 1 ? 'border-b border-gray-50' : ''}`}>
      <div className="flex items-center gap-2">
        <button {...attributes} {...listeners}
                className="p-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none shrink-0">
          <GripVertical size={16} />
        </button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
             style={{ backgroundColor: c.bg }}>
          {c.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm">{c.label}</p>
          <p className="text-[11px] text-gray-400">{c.number}</p>
        </div>
        <div className="flex flex-col gap-0">
          <button onClick={() => onMove(i, -1)} disabled={i === 0}
                  className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
            <ChevronUp size={14} />
          </button>
          <button onClick={() => onMove(i, 1)} disabled={i === total - 1}
                  className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
            <ChevronDown size={14} />
          </button>
        </div>
        <a href={`tel:${c.number}`}
           className="p-2 rounded-xl text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors">
          <PhoneCall size={15} />
        </a>
        <button onClick={() => onEdit(c)}
                className="p-2 rounded-xl text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
          <Pencil size={15} />
        </button>
        <button onClick={() => onDelete(c.id)}
                className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 size={15} />
        </button>
      </div>
      {isEditing && (
        <div className="mt-3 ml-12 space-y-2">
          <input
            autoFocus
            value={editingForm.label}
            onChange={(e) => onEditChange('label', e.target.value)}
            placeholder="ชื่อสายด่วน"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
          <input
            value={editingForm.number}
            onChange={(e) => onEditChange('number', e.target.value)}
            placeholder="เบอร์โทร"
            type="tel"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
          <div className="flex gap-2">
            <button onClick={onEditSave}
                    className="px-4 py-1.5 rounded-xl text-sm font-medium text-white"
                    style={{ backgroundColor: 'var(--color-primary)' }}>
              บันทึก
            </button>
            <button onClick={() => onEdit(null)}
                    className="px-4 py-1.5 rounded-xl text-sm font-medium text-gray-500 border border-gray-200">
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const EMERGENCY_EMOJIS = [
  '📞','👮','🚒','🏥','🚑','⚡','💧','🏛️','🪖','🆘',
  '🩺','🛣️','💡','⛽','🌳','🔥','🚔','🚨','🛡️','☎️',
  '📟','🔧','🏗️','🚧','⚠️','🌊','🌪️','🦺','🧯','🔑',
]

function EmergencyManager({ tenant }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ label: '', number: '', emoji: '📞', color: '#1d4ed8', bg: '#dbeafe' })
  const [editingId, setEditingId] = useState(null)
  const [editingForm, setEditingForm] = useState({ label: '', number: '' })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )

  const fetchContacts = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('emergency_contacts')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('display_order')
    setContacts(data ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  async function saveOrder(ordered) {
    await Promise.all(
      ordered.map((c, i) =>
        supabase.from('emergency_contacts').update({ display_order: i + 1 }).eq('id', c.id)
      )
    )
  }

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIdx = contacts.findIndex((c) => c.id === active.id)
    const newIdx = contacts.findIndex((c) => c.id === over.id)
    const next = arrayMove(contacts, oldIdx, newIdx)
    setContacts(next)
    saveOrder(next)
  }

  function handleMove(idx, dir) {
    const next = arrayMove(contacts, idx, idx + dir)
    setContacts(next)
    saveOrder(next)
  }

  function guessEmoji(label) {
    const t = label.toLowerCase()
    if (/ตำรวจ|สภ|สถานีตำรวจ|police/.test(t))          return '👮'
    if (/ดับเพลิง|ไฟไหม้|fire/.test(t))                  return '🚒'
    if (/โรงพยาบาล|พยาบาล|หมอ|แพทย์|hospital/.test(t)) return '🏥'
    if (/กู้ภัย|กู้ชีพ|ambulance|ฉุกเฉิน/.test(t))       return '🚑'
    if (/ไฟฟ้า|pea|การไฟฟ้า/.test(t))                   return '⚡'
    if (/ประปา|น้ำ|water/.test(t))                       return '💧'
    if (/เทศบาล|อบต|อบจ|สำนักงาน/.test(t))              return '🏛️'
    if (/ป่าไม้|สิ่งแวดล้อม|env/.test(t))                return '🌳'
    if (/ทหาร|army|military/.test(t))                    return '🪖'
    if (/ภัยพิบัติ|disaster/.test(t))                    return '🆘'
    if (/สาธารณสุข|อนามัย|health/.test(t))               return '🩺'
    if (/ถนน|ทาง|road/.test(t))                          return '🛣️'
    if (/ไฟ|light|โคม/.test(t))                          return '💡'
    if (/แก๊ส|gas/.test(t))                              return '⛽'
    return '📞'
  }

  async function addContact() {
    if (!form.label.trim() || !form.number.trim()) return
    setSaving(true)
    const { data } = await supabase.from('emergency_contacts').insert({
      municipality_id: tenant.id,
      label: form.label.trim(),
      number: form.number.trim(),
      emoji: form.emoji,
      color: form.color,
      bg: form.bg,
      display_order: contacts.length + 1,
    }).select().single()
    if (data) setContacts((prev) => [...prev, data])
    setForm({ label: '', number: '', emoji: '📞', color: '#1d4ed8', bg: '#dbeafe' })
    setSaving(false)
  }

  async function deleteContact(id) {
    const contact = contacts.find((c) => c.id === id)
    if (!window.confirm(`ลบ "${contact?.label}" ออกจากรายการเบอร์ฉุกเฉิน?`)) return
    await supabase.from('emergency_contacts').delete().eq('id', id)
    setContacts((prev) => prev.filter((c) => c.id !== id))
  }

  function handleEdit(c) {
    if (!c) { setEditingId(null); return }
    setEditingId(c.id)
    setEditingForm({ label: c.label, number: c.number })
  }

  async function saveContactEdit() {
    if (!editingForm.label.trim() || !editingForm.number.trim()) return
    const { error } = await supabase.from('emergency_contacts')
      .update({ label: editingForm.label.trim(), number: editingForm.number.trim() })
      .eq('id', editingId)
    if (error) return
    setContacts((prev) => prev.map((c) => c.id === editingId ? { ...c, ...editingForm } : c))
    setEditingId(null)
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        {showEmojiPicker && <div className="fixed inset-0 z-40" onClick={() => setShowEmojiPicker(false)} />}
        <p className="font-semibold text-gray-700 text-sm">เพิ่มสายด่วนใหม่</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {/* Emoji picker */}
          <div className="relative">
            <button type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
              title="เลือก emoji">
              <span className="text-2xl">{form.emoji}</span>
              <span className="text-xs text-gray-400">เปลี่ยน</span>
            </button>
            {showEmojiPicker && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl p-3 grid grid-cols-6 gap-1.5 w-56">
                {EMERGENCY_EMOJIS.map((e) => (
                  <button key={e} type="button"
                    onClick={() => { setForm((f) => ({ ...f, emoji: e })); setShowEmojiPicker(false) }}
                    className={`text-xl rounded-xl p-1.5 hover:bg-gray-100 transition-colors ${form.emoji === e ? 'bg-blue-50 ring-2 ring-blue-300' : ''}`}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value, emoji: guessEmoji(e.target.value) })}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm col-span-1 text-gray-800"
            placeholder="ชื่อ เช่น ตำรวจ" />
          <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800"
            placeholder="เบอร์โทร เช่น 191" />
          <button onClick={addContact} disabled={saving || !form.label || !form.number}
            className="flex items-center justify-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            เพิ่ม
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          ยังไม่มีข้อมูลสายด่วน — เพิ่มจากแบบฟอร์มด้านบน
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={contacts.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {contacts.map((c, i) => (
                <SortableContact
                  key={c.id}
                  c={c} i={i} total={contacts.length}
                  onDelete={deleteContact}
                  onMove={handleMove}
                  onEdit={handleEdit}
                  editingId={editingId}
                  editingForm={editingForm}
                  onEditChange={(field, val) => setEditingForm((p) => ({ ...p, [field]: val }))}
                  onEditSave={saveContactEdit}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

// ─── Assignment Manager ───────────────────────────────────────────────────────
const DEFAULT_CATS = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ',           emoji: '💡' },
  { value: 'road',             label: 'ซ่อมแซมถนน',             emoji: '🛣️' },
  { value: 'mosquito',         label: 'พ่นยุง',                 emoji: '🦟' },
  { value: 'tree',             label: 'ตัดต้นไม้',              emoji: '🌳' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด',       emoji: '🗑️' },
  { value: 'water_supply',     label: 'สนับสนุนน้ำอุปโภค',      emoji: '🚿' },
  { value: 'borrow_equipment', label: 'ยืมพัสดุ',               emoji: '📦' },
  { value: 'corruption',       label: 'แจ้งการทุจริต',          emoji: '⚖️' },
  { value: 'grievance',        label: 'ร้องทุกข์/ร้องเรียน',    emoji: '📣' },
  { value: 'other',            label: 'อื่นๆ',                  emoji: '📝' },
]

function AssignmentManager({ tenant, readOnly = false }) {
  const [cats, setCats] = useState(DEFAULT_CATS)
  const [techs, setTechs] = useState([])
  const [assignments, setAssignments] = useState({}) // { category: technician_id }
  const [saving, setSaving] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('complaint_categories').select('value,label,emoji').eq('municipality_id', tenant.id).order('sort_order'),
      supabase.from('profiles').select('id,full_name,email').eq('municipality_id', tenant.id).eq('role', 'technician').order('full_name'),
      supabase.from('category_assignments').select('category,technician_id').eq('municipality_id', tenant.id),
    ]).then(([catsRes, techsRes, assignRes]) => {
      if (catsRes.data?.length > 0) setCats(catsRes.data)
      setTechs(techsRes.data ?? [])
      const map = {}
      for (const a of assignRes.data ?? []) map[a.category] = a.technician_id ?? ''
      setAssignments(map)
      setLoading(false)
    })
  }, [tenant?.id])

  async function handleChange(category, technicianId) {
    setSaving(category)
    setAssignments((prev) => ({ ...prev, [category]: technicianId }))
    await supabase.from('category_assignments').upsert({
      municipality_id: tenant.id,
      category,
      technician_id: technicianId || null,
    }, { onConflict: 'municipality_id,category' })
    setSaving(null)
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-300" /></div>

  if (techs.length === 0) return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800 space-y-1">
      <p className="font-semibold">ยังไม่มีช่างในระบบ</p>
      <p className="text-amber-600">ไปที่ "จัดการผู้ใช้" → เปลี่ยน role ผู้ใช้เป็น "ช่าง" ก่อน แล้วกลับมาตั้งค่าที่นี่</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-xs text-blue-700">
        เมื่อประชาชนส่งคำร้อง ระบบจะ <strong>มอบหมายให้ช่างที่ตั้งไว้อัตโนมัติ</strong> ไม่ต้องรอ Admin assign ทีละเรื่อง
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {cats.map((cat, i) => {
          const currentTech = assignments[cat.value] ?? ''
          const isSaving = saving === cat.value
          return (
            <div key={cat.value}
                 className={`flex items-center gap-3 px-4 py-3.5 ${i < cats.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-lg shrink-0">
                {cat.emoji}
              </div>
              <p className="flex-1 text-sm font-medium text-gray-700 min-w-0 truncate">{cat.label}</p>
              <div className="flex items-center gap-2 shrink-0">
                {isSaving && <Loader2 size={13} className="animate-spin text-gray-300" />}
                <select
                  value={currentTech}
                  onChange={(e) => !readOnly && handleChange(cat.value, e.target.value)}
                  disabled={isSaving || readOnly}
                  className={`text-xs border border-gray-200 rounded-xl px-2 py-1.5 bg-white text-gray-700 focus:outline-none max-w-32 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name ? `${t.full_name} (${t.email || ''})` : t.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Location Manager ─────────────────────────────────────────────────────────
function LocationManager({ tenant }) {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')

  async function fetchLocations() {
    if (!tenant?.id) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('locations')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('sort_order')
    if (err) setError('ไม่สามารถโหลดข้อมูลได้: ' + err.message)
    setLocations(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchLocations() }, [tenant?.id])

  async function addLocation() {
    const name = newName.trim()
    if (!name || !tenant?.id) return
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase.from('locations').insert({
      municipality_id: tenant.id,
      name,
      sort_order: locations.length,
    }).select().single()
    if (err) {
      setError('เพิ่มไม่สำเร็จ: ' + err.message)
    } else if (data) {
      setLocations((prev) => [...prev, data])
      setNewName('')
    }
    setSaving(false)
  }

  async function deleteLocation(id) {
    const loc = locations.find((l) => l.id === id)
    if (!window.confirm(`ลบ "${loc?.name}" ออกจากรายการสถานที่?`)) return
    const { error: err } = await supabase.from('locations').delete().eq('id', id)
    if (err) { setError('ลบไม่สำเร็จ: ' + err.message); return }
    setLocations((prev) => prev.filter((l) => l.id !== id))
  }

  async function saveEdit(id) {
    const name = editingName.trim()
    if (!name) { setEditingId(null); return }
    const { error: err } = await supabase.from('locations').update({ name }).eq('id', id)
    if (err) { setError('แก้ไขไม่สำเร็จ: ' + err.message); return }
    setLocations((prev) => prev.map((l) => l.id === id ? { ...l, name } : l))
    setEditingId(null)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
      <h2 className="font-semibold text-gray-700">จัดการสถานที่เกิดเหตุ</h2>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠️ {error}
          {error.includes('does not exist') && (
            <p className="mt-1 text-xs text-red-500">กรุณารัน migration 009 ใน Supabase SQL Editor ก่อน</p>
          )}
        </div>
      )}

      {/* Add form */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addLocation()}
          placeholder="ชื่อสถานที่ เช่น หมู่ 3 บ้านท่าข้าม"
          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
          style={{ '--tw-ring-color': 'var(--color-primary)' }}
        />
        <button
          onClick={addLocation}
          disabled={saving || !newName.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          เพิ่ม
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : locations.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีสถานที่ กรุณาเพิ่มสถานที่ด้านบน</p>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
              <GripVertical size={15} className="text-gray-300 shrink-0" />
              <MapPin size={14} className="text-gray-400 shrink-0" />
              {editingId === loc.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => saveEdit(loc.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(loc.id); if (e.key === 'Escape') setEditingId(null) }}
                  className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}
                />
              ) : (
                <span className="flex-1 text-sm text-gray-700">{loc.name}</span>
              )}
              <button
                onClick={() => { setEditingId(loc.id); setEditingName(loc.name) }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => deleteLocation(loc.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Category Manager ─────────────────────────────────────────────────────────
const COLOR_PRESETS = [
  { color: '#FEF3C7', textColor: '#D97706' },
  { color: '#DBEAFE', textColor: '#2563EB' },
  { color: '#D1FAE5', textColor: '#059669' },
  { color: '#FEE2E2', textColor: '#DC2626' },
  { color: '#E0E7FF', textColor: '#4338CA' },
  { color: '#FDF4FF', textColor: '#7C3AED' },
  { color: '#F3F4F6', textColor: '#374151' },
]

const DEFAULT_SEED = [
  { value: 'light',            label: 'ไฟฟ้าสาธารณะ',              emoji: '💡', color: '#FEF3C7', textColor: '#D97706' },
  { value: 'road',             label: 'ซ่อมแซมถนน',               emoji: '🛣️', color: '#F3F4F6', textColor: '#374151' },
  { value: 'mosquito',         label: 'พ่นยุง',                   emoji: '🦟', color: '#D1FAE5', textColor: '#059669' },
  { value: 'tree',             label: 'ตัดต้นไม้',                emoji: '🌳', color: '#D1FAE5', textColor: '#059669' },
  { value: 'trash',            label: 'ขยะ / ความสะอาด',         emoji: '🗑️', color: '#F3F4F6', textColor: '#374151' },
  { value: 'water_supply',     label: 'สนับสนุนน้ำอุปโภค',        emoji: '🚿', color: '#DBEAFE', textColor: '#2563EB' },
  { value: 'borrow_equipment', label: 'ยืมพัสดุ',                 emoji: '📦', color: '#E0E7FF', textColor: '#4338CA' },
  { value: 'corruption',       label: 'แจ้งการทุจริต',            emoji: '⚖️', color: '#FEE2E2', textColor: '#DC2626' },
  { value: 'grievance',        label: 'แจ้งเรื่องร้องทุกข์ร้องเรียน', emoji: '📣', color: '#FEF3C7', textColor: '#D97706' },
  { value: 'other',            label: 'อื่นๆ',                    emoji: '📝', color: '#E0E7FF', textColor: '#4338CA' },
]

const EMOJI_HINTS = [
  { keywords: ['ไฟ', 'แสงสว่าง', 'ไฟฟ้า'],                   emoji: '💡' },
  { keywords: ['ถนน', 'ทางเท้า', 'ซ่อม', 'ลาดยาง'],          emoji: '🛣️' },
  { keywords: ['ยุง', 'พ่นยุง'],                              emoji: '🦟' },
  { keywords: ['ต้นไม้', 'ตัดต้น', 'กิ่งไม้', 'สวน'],        emoji: '🌳' },
  { keywords: ['ขยะ', 'ความสะอาด', 'มูลฝอย'],                emoji: '🗑️' },
  { keywords: ['ร้องทุกข์', 'ร้องทุกข์ร้องเรียน'],            emoji: '📣' },
  { keywords: ['ทุจริต', 'ร้องเรียน', 'ประพฤติ'],             emoji: '⚖️' },
  { keywords: ['น้ำอุปโภค', 'สนับสนุนน้ำ', 'น้ำดื่ม'],       emoji: '🚿' },
  { keywords: ['ผู้ป่วย', 'รับส่ง', 'พยาบาล', 'รถพยาบาล'],   emoji: '🚑' },
  { keywords: ['พัสดุ', 'ยืม', 'ครุภัณฑ์', 'อุปกรณ์'],       emoji: '📦' },
  { keywords: ['อื่น', 'ทั่วไป'],                             emoji: '📝' },
  { keywords: ['น้ำเสีย', 'บำบัดน้ำ'],                        emoji: '💧' },
  { keywords: ['ท่อ', 'ระบาย', 'คูน้ำ'],                     emoji: '🚰' },
  { keywords: ['ฝาท่อ'],                                      emoji: '🔩' },
  { keywords: ['ดูด', 'สิ่งปฏิกูล', 'บ่อเกรอะ'],             emoji: '🚛' },
  { keywords: ['รำคาญ', 'เสียงดัง', 'เหตุ'],                  emoji: '📢' },
  { keywords: ['ขาย', 'หาบเร่', 'แผงลอย'],                   emoji: '🛒' },
  { keywords: ['อาคาร', 'สิ่งก่อสร้าง', 'ก่อสร้าง'],         emoji: '🏢' },
  { keywords: ['ควัน', 'กลิ่น', 'มลพิษ'],                    emoji: '🌫️' },
  { keywords: ['ภาษี', 'ค่าธรรมเนียม'],                       emoji: '📋' },
  { keywords: ['คลอง', 'ลอก', 'ร่องน้ำ'],                    emoji: '🏞️' },
  { keywords: ['สุนัข', 'แมว', 'สัตว์', 'จรจัด'],            emoji: '🐕' },
  { keywords: ['ไฟป่า', 'เพลิง', 'ไฟไหม้'],                  emoji: '🔥' },
  { keywords: ['จราจร', 'รถติด', 'สัญญาณ'],                   emoji: '🚦' },
  { keywords: ['สาธารณสุข', 'สุขภาพ', 'โรค'],                emoji: '🏥' },
  { keywords: ['เด็ก', 'เยาวชน'],                             emoji: '👦' },
  { keywords: ['ผู้สูงอายุ', 'ผู้พิการ', 'คนชรา'],            emoji: '🧓' },
  { keywords: ['กีฬา', 'สนามกีฬา', 'ออกกำลัง'],              emoji: '⚽' },
  { keywords: ['ศาสนา', 'วัด', 'มัสยิด', 'โบสถ์'],           emoji: '⛩️' },
]

function guessEmoji(label) {
  const text = label.trim()
  if (!text) return null
  for (const { keywords, emoji } of EMOJI_HINTS) {
    if (keywords.some((k) => text.includes(k))) return emoji
  }
  return null
}

function SortableCatItem({ cat, idx, total, onDelete, onMove, onEdit }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id })
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(cat.label)

  function startEdit() { setDraft(cat.label); setIsEditing(true) }
  function cancelEdit() { setDraft(cat.label); setIsEditing(false) }
  function confirmEdit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== cat.label) onEdit(cat.id, trimmed)
    setIsEditing(false)
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); confirmEdit() }
    if (e.key === 'Escape') cancelEdit()
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5"
    >
      {/* drag handle */}
      <button
        {...attributes} {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 rounded text-gray-300 hover:text-gray-500 transition-colors shrink-0 touch-none"
      >
        <GripVertical size={16} />
      </button>
      {/* ปุ่มขึ้น/ลง */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <button onClick={() => onMove(idx, -1)} disabled={idx === 0}
          className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
          <ChevronUp size={13} />
        </button>
        <button onClick={() => onMove(idx, 1)} disabled={idx === total - 1}
          className="p-0.5 rounded text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors">
          <ChevronDown size={13} />
        </button>
      </div>
      <span className="w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0"
        style={{ backgroundColor: cat.color }}>{cat.emoji}</span>

      {/* label — inline edit */}
      {isEditing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={confirmEdit}
          onKeyDown={handleKeyDown}
          className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
          style={{ '--tw-ring-color': 'var(--color-primary)' }}
        />
      ) : (
        <button
          onClick={startEdit}
          className="flex-1 flex items-center gap-1.5 group text-left"
        >
          <span className="text-sm text-gray-700 group-hover:text-gray-900">{cat.label}</span>
          <Pencil size={11} className="text-gray-300 group-hover:text-gray-500 shrink-0 transition-colors" />
        </button>
      )}

      <button onClick={() => onDelete(cat.id)}
        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function CategoryManager({ tenant }) {
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ label: '', emoji: '📝', colorIdx: 6, emojiTouched: false })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  async function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIdx = cats.findIndex((c) => c.id === active.id)
    const newIdx = cats.findIndex((c) => c.id === over.id)
    const reordered = arrayMove(cats, oldIdx, newIdx)
    setCats(reordered)
    await Promise.all(reordered.map((cat, i) =>
      supabase.from('complaint_categories').update({ sort_order: i }).eq('id', cat.id)
    ))
  }

  async function fetchCats() {
    if (!tenant?.id) return
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('complaint_categories')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('sort_order')
    if (err) setError('โหลดข้อมูลไม่ได้: ' + err.message)
    setCats(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchCats() }, [tenant?.id])

  async function addCat() {
    const label = form.label.trim()
    const emoji = form.emoji.trim() || '📝'
    if (!label || !tenant?.id) return
    const value = `cat_${Date.now().toString(36)}`
    setSaving(true)
    setError(null)
    const preset = COLOR_PRESETS[form.colorIdx]
    const { data, error: err } = await supabase.from('complaint_categories').insert({
      municipality_id: tenant.id,
      value,
      label,
      emoji,
      color:      preset.color,
      text_color: preset.textColor,
      sort_order: cats.length,
    }).select().single()
    if (err) {
      setError('เพิ่มไม่สำเร็จ: ' + err.message)
    } else if (data) {
      setCats((prev) => [...prev, data])
      setForm({ label: '', emoji: '📝', colorIdx: 6, emojiTouched: false })
    }
    setSaving(false)
  }

  async function deleteCat(id) {
    const cat = cats.find((c) => c.id === id)
    if (!window.confirm(`ลบประเภท "${cat?.label}" ออกจากระบบ?\n\nคำร้องที่มีอยู่แล้วจะไม่หายไป แต่จะไม่มีประเภทนี้ให้เลือกในอนาคต`)) return
    const { error: err } = await supabase.from('complaint_categories').delete().eq('id', id)
    if (err) { setError('ลบไม่สำเร็จ: ' + err.message); return }
    setCats((prev) => prev.filter((c) => c.id !== id))
  }

  async function editCat(id, newLabel) {
    const { error: err } = await supabase.from('complaint_categories').update({ label: newLabel }).eq('id', id)
    if (err) { setError('แก้ไขไม่สำเร็จ: ' + err.message); return }
    setCats((prev) => prev.map((c) => c.id === id ? { ...c, label: newLabel } : c))
  }

  async function moveCat(idx, dir) {
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= cats.length) return
    const a = cats[idx]
    const b = cats[swapIdx]
    await Promise.all([
      supabase.from('complaint_categories').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('complaint_categories').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    setCats((prev) => {
      const next = [...prev]
      next[idx]     = { ...a, sort_order: b.sort_order }
      next[swapIdx] = { ...b, sort_order: a.sort_order }
      return next.sort((x, y) => x.sort_order - y.sort_order)
    })
  }

  async function seedDefaults() {
    if (!tenant?.id) return
    setSeeding(true)
    setError(null)
    const rows = DEFAULT_SEED.map((d, i) => ({ ...d, text_color: d.textColor, municipality_id: tenant.id, sort_order: i }))
      .map(({ textColor, ...rest }) => rest)
    const { error: err } = await supabase.from('complaint_categories').upsert(rows, { onConflict: 'municipality_id,value' })
    if (err) setError('โหลดค่าเริ่มต้นไม่สำเร็จ: ' + err.message)
    else await fetchCats()
    setSeeding(false)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700">จัดการประเภทคำร้อง</h2>
        {cats.length === 0 && !loading && (
          <button
            onClick={seedDefaults}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {seeding ? <Loader2 size={12} className="animate-spin" /> : <Tag size={12} />}
            โหลดค่าเริ่มต้น
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Add form */}
      <div className="space-y-3 bg-gray-50 rounded-2xl p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">เพิ่มประเภทใหม่</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={form.emoji}
            onChange={(e) => setForm((p) => ({ ...p, emoji: e.target.value, emojiTouched: true }))}
            placeholder="emoji"
            className="w-16 border border-gray-200 rounded-xl px-2 py-2 text-center text-lg bg-white focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
          <input
            type="text"
            value={form.label}
            onChange={(e) => {
              const label = e.target.value
              const suggested = guessEmoji(label)
              setForm((p) => ({
                ...p,
                label,
                emoji: p.emojiTouched ? p.emoji : (suggested ?? p.emoji),
              }))
            }}
            placeholder="ชื่อประเภท เช่น ไฟฟ้าสาธารณะ"
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }}
          />
        </div>
        {/* Color picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">สี:</span>
          {COLOR_PRESETS.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, colorIdx: i }))}
              className="w-6 h-6 rounded-full border-2 transition-transform"
              style={{
                backgroundColor: p.color,
                borderColor: form.colorIdx === i ? p.textColor : 'transparent',
                transform: form.colorIdx === i ? 'scale(1.25)' : 'scale(1)',
              }}
            />
          ))}
          {/* preview */}
          <span
            className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: COLOR_PRESETS[form.colorIdx].color, color: COLOR_PRESETS[form.colorIdx].textColor }}
          >
            {form.emoji || '📝'} {form.label || 'ตัวอย่าง'}
          </span>
        </div>
        <button
          onClick={addCat}
          disabled={saving || !form.label.trim()}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          เพิ่มประเภท
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : cats.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          ยังไม่มีประเภทคำร้อง — กด <strong>โหลดค่าเริ่มต้น</strong> หรือเพิ่มเองด้านบน
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={cats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {cats.map((cat, idx) => (
                <SortableCatItem
                  key={cat.id}
                  cat={cat}
                  idx={idx}
                  total={cats.length}
                  onDelete={deleteCat}
                  onMove={moveCat}
                  onEdit={editCat}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

// ─── Print Report (แบบฟอร์มราชการ) ────────────────────────────────────────────
function handlePrint({ view, month, year, viewLabel, total, completed, rejected, active, rate, avgDays, catData, trend, tenant }) {
  const today = new Date()
  const thaiDate = `${today.getDate()} ${['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'][today.getMonth()]} ${today.getFullYear() + 543}`

  const trendRows = trend.map(t => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.label}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.submitted}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.completed}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${t.submitted - t.completed}</td>
    </tr>`).join('')

  const catRows = catData.map((c, i) => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${i + 1}</td>
      <td style="padding:6px 12px;border:1px solid #ddd">${c.emoji} ${c.name}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${c.count}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${total > 0 ? Math.round(c.count / total * 100) : 0}%</td>
    </tr>`).join('')

  const trendHeader = view === 'month' ? 'สัปดาห์' : view === 'year' ? 'เดือน' : 'ปี'

  const html = `<!DOCTYPE html><html lang="th"><head>
  <meta charset="UTF-8">
  <title>รายงาน ${viewLabel} - ${tenant?.name}</title>
  <style>
    @page { size: A4; margin: 2cm 2.5cm; }
    body { font-family: 'TH Sarabun New', Sarabun, sans-serif; font-size: 16pt; color: #000; line-height: 1.6; }
    h1 { font-size: 20pt; text-align: center; margin: 0 0 4px; }
    .sub { text-align: center; font-size: 14pt; margin-bottom: 20px; }
    .memo { display: grid; grid-template-columns: 120px 1fr; gap: 4px 8px; margin-bottom: 20px; font-size: 15pt; }
    .memo b { font-weight: 600; }
    .section { margin: 16px 0 8px; font-size: 16pt; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 2px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0; }
    .stat-box { border: 1px solid #aaa; padding: 8px 10px; text-align: center; }
    .stat-box .num { font-size: 22pt; font-weight: 900; }
    .stat-box .lbl { font-size: 13pt; }
    table { width: 100%; border-collapse: collapse; font-size: 14pt; margin: 8px 0; }
    th { background: #e8e8e8; padding: 7px 12px; border: 1px solid #ddd; text-align: center; }
    .sign { margin-top: 60px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .sign-box { text-align: center; }
    .sign-line { border-top: 1px solid #000; width: 220px; margin: 60px auto 4px; }
    .sign-label { font-size: 13pt; }
    @media print { button { display: none; } }
  </style>
</head><body>

  <h1>บันทึกข้อความ</h1>
  <p class="sub">รายงานสรุปผลการดำเนินงานการรับเรื่องร้องทุกข์ผ่านระบบออนไลน์</p>

  <div class="memo">
    <b>ส่วนราชการ</b><span>${tenant?.name ?? 'หน่วยงาน'}</span>
    <b>วันที่</b><span>${thaiDate}</span>
    <b>เรื่อง</b><span>รายงานสรุปผลการรับคำร้อง ${viewLabel}</span>
    <b>เรียน</b><span>ผู้บังคับบัญชา</span>
  </div>

  <p style="text-indent:2.5em">ตามที่ ${tenant?.name ?? 'หน่วยงาน'} ได้เปิดให้บริการรับเรื่องร้องทุกข์ผ่านระบบยื่นคำร้องออนไลน์ เพื่ออำนวยความสะดวกแก่ประชาชนนั้น ขอรายงานผลการดำเนินงาน${viewLabel} ดังนี้</p>

  <div class="section">๑. สรุปสถิติคำร้อง</div>
  <div class="stats">
    <div class="stat-box"><div class="num">${total}</div><div class="lbl">คำร้องทั้งหมด</div></div>
    <div class="stat-box"><div class="num" style="color:#10b981">${completed}</div><div class="lbl">ดำเนินการแล้วเสร็จ</div></div>
    <div class="stat-box"><div class="num" style="color:#f59e0b">${active}</div><div class="lbl">อยู่ระหว่างดำเนินการ</div></div>
    <div class="stat-box"><div class="num" style="color:#ef4444">${rejected}</div><div class="lbl">ปฏิเสธคำร้อง</div></div>
  </div>
  <p>อัตราการปิดงาน <b>${rate}%</b>${avgDays !== null ? ` &nbsp;|&nbsp; เฉลี่ยระยะเวลาดำเนินการ <b>${avgDays} วัน</b>` : ''}</p>

  <div class="section">๒. แนวโน้มการรับคำร้อง</div>
  <table>
    <thead><tr>
      <th>${trendHeader}</th><th>คำร้องที่รับ</th><th>ดำเนินการแล้วเสร็จ</th><th>คงค้าง</th>
    </tr></thead>
    <tbody>${trendRows}</tbody>
  </table>

  <div style="page-break-inside:avoid">
  <div class="section">๓. ประเภทคำร้องที่พบบ่อย</div>
  <table>
    <thead><tr><th>ลำดับ</th><th>ประเภทคำร้อง</th><th>จำนวน (ราย)</th><th>คิดเป็น (%)</th></tr></thead>
    <tbody>${catRows || '<tr><td colspan="4" style="text-align:center;padding:12px;border:1px solid #ddd">ไม่มีข้อมูล</td></tr>'}</tbody>
  </table>
  </div>

  <p style="margin-top:16px;text-indent:2.5em">จึงเรียนมาเพื่อโปรดทราบ</p>

  <div class="sign">
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">ผู้รายงาน</div>
      <div class="sign-label">ตำแหน่ง .................................</div>
      <div class="sign-label">วันที่ ${thaiDate}</div>
    </div>
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">ผู้บังคับบัญชา</div>
      <div class="sign-label">ตำแหน่ง .................................</div>
      <div class="sign-label">วันที่ .................................</div>
    </div>
  </div>

</body></html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 500)
}

// ─── Report Manager ───────────────────────────────────────────────────────────
const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
const MONTHS_FULL_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

function ReportManager({ complaints, tenant }) {
  const now = new Date()
  const [view, setView]   = useState('month') // 'month' | 'year' | 'all'
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear]   = useState(now.getFullYear())

  const years = [...new Set(complaints.map(c => new Date(c.created_at).getFullYear()))]
  if (!years.includes(now.getFullYear())) years.push(now.getFullYear())
  years.sort((a, b) => b - a)

  // กรองข้อมูลตาม view
  const viewData = complaints.filter(c => {
    const d = new Date(c.created_at)
    if (view === 'month') return d.getMonth() === month && d.getFullYear() === year
    if (view === 'year')  return d.getFullYear() === year
    return true
  })

  const total     = viewData.length
  const completed = viewData.filter(c => c.status === 'completed').length
  const rejected  = viewData.filter(c => c.status === 'rejected').length
  const active    = total - completed - rejected
  const rate      = total > 0 ? Math.round(completed / total * 100) : 0

  // เฉลี่ยวันปิดงาน
  const closedData = complaints.filter(c => {
    if (c.status !== 'completed') return false
    const d = new Date(c.updated_at)
    if (view === 'month') return d.getMonth() === month && d.getFullYear() === year
    if (view === 'year')  return d.getFullYear() === year
    return true
  })
  const avgDays = closedData.length > 0
    ? Math.round(closedData.reduce((s, c) =>
        s + (new Date(c.updated_at) - new Date(c.created_at)) / 86400000, 0
      ) / closedData.length)
    : null

  // กราฟแนวโน้ม
  const trend = view === 'all'
    ? years.slice().reverse().map(y => {
        const cs = complaints.filter(c => new Date(c.created_at).getFullYear() === y)
        return { label: String(y + 543), submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })
    : view === 'year'
    ? Array.from({ length: 12 }, (_, i) => {
        const cs = complaints.filter(c => {
          const d = new Date(c.created_at)
          return d.getMonth() === i && d.getFullYear() === year
        })
        return { label: MONTHS_TH[i], submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })
    : Array.from({ length: 4 }, (_, i) => {
        const weekStart = i * 7 + 1
        const weekEnd   = i === 3 ? 31 : weekStart + 6
        const cs = complaints.filter(c => {
          const d = new Date(c.created_at)
          return d.getMonth() === month && d.getFullYear() === year && d.getDate() >= weekStart && d.getDate() <= weekEnd
        })
        return { label: `สัปดาห์ ${i + 1}`, submitted: cs.length, completed: cs.filter(c => c.status === 'completed').length }
      })

  // ประเภทคำร้อง
  const catCount = {}
  viewData.forEach(c => { catCount[c.category] = (catCount[c.category] || 0) + 1 })
  const catData = Object.entries(catCount)
    .map(([cat, count]) => ({ name: CATEGORY_LABEL[cat] ?? cat, emoji: CATEGORY_EMOJI[cat] ?? '📄', count }))
    .sort((a, b) => b.count - a.count).slice(0, 6)

  // คำร้องค้างนานเกิน 7 วัน
  const overdue = complaints
    .filter(c => !['completed','rejected'].includes(c.status) &&
      (Date.now() - new Date(c.created_at)) > 7 * 86400000)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, 6)

  const rateColor = rate >= 70 ? '#10b981' : rate >= 40 ? '#f59e0b' : '#ef4444'

  const viewLabel = view === 'month'
    ? `${MONTHS_FULL_TH[month]} ${year + 543}`
    : view === 'year' ? `ปี ${year + 543}`
    : 'ทั้งหมด'

  return (
    <div className="space-y-5 pb-32">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <TrendingUp size={18} style={{ color: 'var(--color-primary)' }} />
            รายงานสรุป
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{viewLabel} · {tenant?.name}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View tabs */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-white text-xs font-medium">
            {[['month','รายเดือน'],['year','รายปี'],['all','ทั้งหมด']].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-2 transition-colors ${view === v ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                style={view === v ? { backgroundColor: 'var(--color-primary)' } : {}}>
                {label}
              </button>
            ))}
          </div>
          {view !== 'all' && (
            <select value={year} onChange={e => setYear(+e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
              {years.map(y => <option key={y} value={y}>{y + 543}</option>)}
            </select>
          )}
          {view === 'month' && (
            <select value={month} onChange={e => setMonth(+e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none">
              {MONTHS_TH.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          )}
          <button onClick={() => handlePrint({ view, month, year, viewLabel, total, completed, rejected, active, rate, avgDays, catData, trend, tenant })}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Printer size={15} /> พิมพ์
          </button>
          {(view !== 'month' || month !== now.getMonth() || year !== now.getFullYear()) && (
            <button onClick={() => { setView('month'); setMonth(now.getMonth()); setYear(now.getFullYear()) }}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium bg-white border border-gray-200 text-gray-400 hover:text-red-500 transition-colors">
              <X size={12} /> ล้าง
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'คำร้องที่รับเข้า',   value: total,    color: '#64748b', sub: 'รายการ' },
          { label: 'ปิดงานแล้ว',         value: completed, color: '#10b981', sub: 'รายการ' },
          { label: 'อัตราปิดงาน',        value: `${rate}%`, color: rateColor, sub: rate >= 70 ? '✅ ดี' : rate >= 40 ? '⚠️ ปานกลาง' : '🔴 ต่ำ' },
          { label: 'เฉลี่ยวันปิดงาน',    value: avgDays !== null ? avgDays : '—', color: '#8b5cf6', sub: avgDays !== null ? 'วัน' : 'ไม่มีข้อมูล' },
        ].map(({ label, value, color, sub }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-2xl font-black leading-none" style={{ color }}>{value}</p>
            <p className="text-[11px] text-gray-400 mt-1">{sub}</p>
            <p className="text-xs font-medium text-gray-600 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {view === 'all' ? 'แนวโน้มรายปี' : view === 'year' ? `แนวโน้มรายเดือน ปี ${year + 543}` : `แนวโน้มรายสัปดาห์ ${MONTHS_FULL_TH[month]} ${year + 543}`}
        </h3>
        {complaints.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trend} barGap={4} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip
                formatter={(val, name) => [val, name === 'submitted' ? 'รับเข้า' : 'เสร็จสิ้น']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }}
              />
              <Legend iconType="circle" iconSize={8}
                formatter={v => <span className="text-xs text-gray-600">{v === 'submitted' ? 'รับเข้า' : 'เสร็จสิ้น'}</span>} />
              <Bar dataKey="submitted" name="submitted" fill="var(--color-primary)" radius={[4,4,0,0]} opacity={0.75} />
              <Bar dataKey="completed" name="completed" fill="#10b981" radius={[4,4,0,0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Category + Overdue */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Category breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            {view === 'all' ? 'ประเภทคำร้องทั้งหมด' : view === 'year' ? `ประเภทคำร้องปี ${year + 543}` : `ประเภทคำร้อง${MONTHS_FULL_TH[month]}นี้`}
          </h3>
          {catData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">ไม่มีข้อมูล</p>
          ) : (
            <div className="space-y-3">
              {catData.map(({ name, emoji, count }, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium flex items-center gap-1.5 truncate">
                      <span>{emoji}</span> {name}
                    </span>
                    <span className="text-gray-400 shrink-0 ml-2 font-semibold">{count}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${count / catData[0].count * 100}%`,
                        backgroundColor: 'var(--color-primary)',
                        opacity: 0.5 + 0.5 * (count / catData[0].count),
                      }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Overdue complaints — แสดงเฉพาะ รายเดือน */}
        {view === 'month' && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            คำร้องค้างเกิน 7 วัน
          </h3>
          <p className="text-xs text-gray-400 mb-4">ทั้งระบบ {overdue.length} รายการ</p>
          {overdue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
              <CheckCircle2 size={28} className="text-green-400 mb-2" />
              <p className="text-sm text-green-600 font-medium">ไม่มีคำร้องค้าง</p>
            </div>
          ) : (
            <div className="space-y-0 divide-y divide-gray-50">
              {overdue.map(c => {
                const days = Math.floor((Date.now() - new Date(c.created_at)) / 86400000)
                const s = STATUS[c.status]
                return (
                  <div key={c.id} className="flex items-center gap-3 py-2.5">
                    <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700 truncate">
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </p>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: s?.bg, color: s?.text }}>
                        {s?.label}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-red-500 shrink-0 bg-red-50 px-2 py-0.5 rounded-lg">
                      {days} วัน
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>}
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [filterTab, setFilterTab] = useState(0)
  const [search, setSearch] = useState('')
  const [activePage, setActivePage] = useState('complaints')
  const [currentUserRole, setCurrentUserRole] = useState(null)
  const [selectedComplaint, setSelectedComplaint] = useState(null)
  const [technicians, setTechnicians] = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          const r = p?.role ?? 'citizen'
          setCurrentUserRole(r)
          if (r === 'viewer') setActivePage('complaints')
          return r
        })
    })
  }, [])

  const fetchTechnicians = useCallback(async () => {
    if (!tenant?.id) return
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('municipality_id', tenant.id)
      .eq('role', 'technician')
      .order('full_name')
    setTechnicians(data ?? [])
  }, [tenant?.id])

  useEffect(() => { fetchTechnicians() }, [fetchTechnicians])

  async function assignTechnician(complaintId, technicianId) {
    const { error } = await supabase
      .from('complaints')
      .update({ assigned_to: technicianId, status: technicianId ? 'received' : 'pending' })
      .eq('id', complaintId)
    if (!error) {
      setComplaints((prev) => prev.map((c) =>
        c.id === complaintId
          ? { ...c, assigned_to: technicianId, status: technicianId ? 'received' : 'pending' }
          : c
      ))
      if (selectedComplaint?.id === complaintId) {
        setSelectedComplaint((prev) => ({
          ...prev,
          assigned_to: technicianId,
          status: technicianId ? 'received' : 'pending',
        }))
      }
    }
  }

  function handleDeleteComplaint(id) {
    setComplaints((prev) => prev.filter((c) => c.id !== id))
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/admin/login')
  }

  const fetchComplaints = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data, error } = await supabase
      .from('complaints')
      .select('*, profiles(full_name, email, phone)')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
    if (error) console.error('fetch complaints error:', error.message)
    setComplaints(data ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { fetchComplaints() }, [fetchComplaints])

  async function updateStatus(id, nextStatus, workPhotos = [], techNote = null) {
    setUpdating(id)
    const payload = { status: nextStatus }
    if (workPhotos.length > 0) payload.work_photos = workPhotos
    if (techNote) payload.technician_note = techNote
    const { error } = await supabase
      .from('complaints')
      .update(payload)
      .eq('id', id)
    if (error) {
      console.error('update status error:', error.message)
    } else {
      setComplaints((prev) =>
        prev.map((c) => c.id === id
          ? { ...c, status: nextStatus, ...(workPhotos.length > 0 ? { work_photos: workPhotos } : {}) }
          : c)
      )
    }
    setUpdating(null)
  }

  // ─── Derived data ──────────────────────────────────────────────────────────
  const statsData = Object.entries(STATUS).map(([key, s]) => ({
    name: s.label,
    value: complaints.filter((c) => c.status === key).length,
    color: s.color,
  })).filter((d) => d.value > 0)

  const filtered = complaints.filter((c) => {
    const matchStatus = FILTER_KEYS[filterTab] ? c.status === FILTER_KEYS[filterTab] : true
    const matchSearch = search === '' ||
      c.detail.includes(search) ||
      (CATEGORY_LABEL[c.category] ?? '').includes(search) ||
      (c.phone ?? '').includes(search)
    return matchStatus && matchSearch
  })

  const counts = Object.fromEntries(
    Object.keys(STATUS).map((k) => [k, complaints.filter((c) => c.status === k).length])
  )

  function handlePrintComplaints() {
    const now = new Date()
    const thDate = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    const filterLabel = FILTER_TABS[filterTab]
    const rows = filtered.map((c, i) => {
      const d = new Date(c.created_at)
      const yy = String(d.getFullYear() + 543).slice(-2)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const num = c.complaint_number ? `${yy}${mm}${String(c.complaint_number).padStart(3, '0')}` : '—'
      const dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
      const cat = CATEGORY_LABEL[c.category] ?? c.category ?? '—'
      const reporter = c.reporter_name || c.profiles?.full_name || '—'
      const status = STATUS[c.status]?.label ?? c.status
      const detail = (c.detail ?? '').substring(0, 60) + ((c.detail ?? '').length > 60 ? '...' : '')
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="text-align:center">${num}</td>
        <td>${dateStr}</td>
        <td>${cat}</td>
        <td>${reporter}</td>
        <td>${detail}</td>
        <td style="text-align:center">${status}</td>
      </tr>`
    }).join('')

    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<title>รายการคำร้อง</title>
<style>
  @page { size: A4 landscape; margin: 1.5cm; }
  body { font-family: 'Sarabun', sans-serif; font-size: 14px; color: #111; }
  h2 { text-align:center; font-size:16px; margin:0 0 4px; }
  p.sub { text-align:center; font-size:13px; color:#555; margin:0 0 16px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { background:#1d4ed8; color:#fff; padding:6px 8px; text-align:center; }
  td { padding:5px 8px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
  tr:nth-child(even) td { background:#f8fafc; }
  .footer { margin-top:12px; font-size:12px; color:#555; text-align:right; }
  @media print { button { display:none; } }
</style></head><body>
<h2>${tenant?.name ?? ''} — รายการคำร้อง</h2>
<p class="sub">ตัวกรอง: ${filterLabel} &nbsp;|&nbsp; ทั้งหมด ${filtered.length} รายการ &nbsp;|&nbsp; พิมพ์วันที่ ${thDate}</p>
<table>
  <thead><tr>
    <th style="width:40px">ที่</th>
    <th style="width:80px">เลขที่</th>
    <th style="width:80px">วันที่</th>
    <th style="width:130px">ประเภท</th>
    <th style="width:110px">ผู้แจ้ง</th>
    <th>รายละเอียด</th>
    <th style="width:90px">สถานะ</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">ออกจากระบบยื่นคำร้องออนไลน์ SmartLocal</div>
</body></html>`

    const w = window.open('', '_blank', 'width=1100,height=700')
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }


  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-24 md:pb-6 space-y-6">
      {/* Detail modal */}
      {selectedComplaint && (
        <ComplaintDetailModal
          complaint={selectedComplaint}
          onClose={() => setSelectedComplaint(null)}
          onUpdate={updateStatus}
          updating={updating}
          technicians={technicians}
          onAssign={assignTechnician}
          currentUserRole={currentUserRole}
          onDelete={handleDeleteComplaint}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">แผงควบคุมเจ้าหน้าที่</h1>
          <p className="text-sm text-gray-400">{tenant?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {activePage === 'complaints' && (
            <button onClick={fetchComplaints} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              รีเฟรช
            </button>
          )}
          <button onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-500 bg-white hover:bg-red-50 transition-colors">
            <LogOut size={15} />
            ออกจากระบบ
          </button>
        </div>
      </div>

      {/* Tab navigation — desktop only */}
      <div className="hidden md:flex gap-2">
        <button onClick={() => setActivePage('complaints')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'complaints' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          style={activePage === 'complaints' ? { backgroundColor: 'var(--color-primary)' } : {}}>
          <ClipboardList size={15} /> คำร้อง
        </button>
        {currentUserRole !== 'viewer' && (
          <button onClick={() => setActivePage('categories')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'categories' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'categories' ? { backgroundColor: '#d97706' } : {}}>
            <Tag size={15} /> ประเภทคำร้อง
          </button>
        )}
        {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
          <button onClick={() => setActivePage('users')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'users' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'users' ? { backgroundColor: '#7c3aed' } : {}}>
            <Shield size={15} /> จัดการผู้ใช้
          </button>
        )}
        <button onClick={() => setActivePage('assignments')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'assignments' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          style={activePage === 'assignments' ? { backgroundColor: '#d97706' } : {}}>
          <Wrench size={15} /> ผู้รับผิดชอบ
        </button>
        {currentUserRole !== 'viewer' && (
          <button onClick={() => setActivePage('more')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'more' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'more' ? { backgroundColor: '#6b7280' } : {}}>
            <LayoutGrid size={15} /> อื่นๆ
          </button>
        )}

      </div>

      {/* ─── Mobile Admin Bottom Tab Bar ─── */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 shadow-[0_-4px_24px_rgba(0,0,0,0.10)] flex items-stretch"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      >
        {[
          { key: 'home',       label: 'หน้าแรก', Icon: Home,          activeColor: '#6b7280' },
          { key: 'complaints', label: 'คำร้อง',  Icon: ClipboardList, activeColor: 'var(--color-primary)' },
          ...(currentUserRole !== 'viewer'
            ? [{ key: 'categories', label: 'ประเภท', Icon: Tag, activeColor: '#d97706' }]
            : []),
          ...(currentUserRole === 'admin' || currentUserRole === 'superadmin'
            ? [{ key: 'users', label: 'ผู้ใช้', Icon: Shield, activeColor: '#7c3aed' }]
            : []),
          { key: 'assignments', label: 'ผู้รับผิดชอบ', Icon: Wrench, activeColor: '#d97706' },
          ...(currentUserRole !== 'viewer'
            ? [{ key: 'more', label: 'อื่นๆ', Icon: LayoutGrid, activeColor: '#6b7280' }]
            : []),
        ].map(({ key, label, Icon, activeColor }) => {
          const isActive = activePage === key
          return (
            <button
              key={key}
              onClick={() => key === 'home' ? navigate('/') : setActivePage(key)}
              className="relative flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-transform active:scale-90"
            >
              {isActive && (
                <span
                  className="absolute top-0 h-0.5 w-8 rounded-full"
                  style={{ backgroundColor: activeColor }}
                />
              )}
              <Icon
                size={22}
                style={{ color: isActive ? activeColor : '#9ca3af' }}
                strokeWidth={isActive ? 2.5 : 1.8}
              />
              <span
                className="text-[11px] font-semibold leading-tight"
                style={{ color: isActive ? activeColor : '#9ca3af' }}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>

      {activePage === 'report' ? (
        <ReportManager complaints={complaints} tenant={tenant} />
      ) : activePage === 'emergency' ? (
        <EmergencyManager tenant={tenant} />
      ) : activePage === 'users' ? (
        <UserManager tenant={tenant} currentUserRole={currentUserRole} />
      ) : activePage === 'locations' ? (
        <LocationManager tenant={tenant} />
      ) : activePage === 'categories' ? (
        <CategoryManager tenant={tenant} />
      ) : activePage === 'assignments' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {currentUserRole !== 'viewer' && (
              <button onClick={() => setActivePage('more')} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
                <ChevronRight size={16} className="rotate-180" />
              </button>
            )}
            <h2 className="font-bold text-gray-700">ผู้รับผิดชอบแต่ละประเภทคำร้อง</h2>
          </div>
          <AssignmentManager tenant={tenant} readOnly={currentUserRole === 'viewer'} />
        </div>
      ) : activePage === 'more' ? (
        /* ─── อื่นๆ page ─── */
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">เมนูเพิ่มเติม</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setActivePage('emergency')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center"
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fee2e2' }}>
                <Phone size={24} style={{ color: '#ef4444' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">สายด่วนฉุกเฉิน</p>
                <p className="text-[11px] text-gray-400 mt-0.5">จัดการเบอร์ติดต่อ</p>
              </div>
            </button>
            <button
              onClick={() => setActivePage('locations')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center"
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#e0f2fe' }}>
                <MapPin size={24} style={{ color: '#0891b2' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">สถานที่เกิดเหตุ</p>
                <p className="text-[11px] text-gray-400 mt-0.5">จัดการหมู่บ้าน / ตำบล</p>
              </div>
            </button>
            <button
              onClick={() => setActivePage('report')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center"
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#d1fae5' }}>
                <TrendingUp size={24} style={{ color: '#10b981' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">รายงานสถิติ</p>
                <p className="text-[11px] text-gray-400 mt-0.5">สรุปผลรายเดือน/ปี</p>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="ทั้งหมด"        value={complaints.length}      icon={ClipboardList} color="#64748b" />
        <StatCard label="รอดำเนินการ"    value={counts.pending ?? 0}    icon={Clock}         color="#f59e0b" />
        <StatCard label="กำลังดำเนินการ" value={counts.in_progress ?? 0} icon={AlertCircle}  color="#8b5cf6" />
        <StatCard label="เสร็จสิ้น"      value={counts.completed ?? 0}  icon={CheckCircle2}  color="#10b981" />
      </div>

      {/* Chart + filter row */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Pie chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 text-sm mb-4">สัดส่วนตามสถานะ</h2>
          {statsData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
              ยังไม่มีข้อมูล
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statsData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                     paddingAngle={3} dataKey="value">
                  {statsData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8}
                        formatter={(value) => <span className="text-xs text-gray-600">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Quick status summary */}
        <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 text-sm mb-4">สรุปสถานะ</h2>
          <div className="space-y-2.5">
            {Object.entries(STATUS).map(([key, s]) => {
              const count = counts[key] ?? 0
              const pct = complaints.length ? Math.round((count / complaints.length) * 100) : 0
              return (
                <div key={key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600">{s.label}</span>
                    <span className="font-semibold text-gray-700">{count} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="h-2 rounded-full transition-all duration-500"
                         style={{ width: `${pct}%`, backgroundColor: s.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Table section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Table header */}
        <div className="px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="font-semibold text-gray-700 flex-1">รายการคำร้อง</h2>
            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาคำร้อง..."
                className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent w-52"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
            <button onClick={handlePrintComplaints}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors shrink-0">
              <Printer size={15} className="text-gray-500" />
              พิมพ์
            </button>
          </div>

          {/* Filter tabs */}
          <div className="flex flex-wrap gap-1 mt-3">
            {FILTER_TABS.map((tab, i) => (
              <button key={i} onClick={() => setFilterTab(i)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterTab === i
                    ? 'text-white'
                    : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                }`}
                style={filterTab === i ? { backgroundColor: 'var(--color-primary)' } : {}}>
                <span className="flex items-center gap-1">
                  <Filter size={10} />
                  {tab}
                  {i > 0 && (
                    <span className={`ml-1 px-1.5 rounded-full text-[11px] font-bold ${
                      filterTab === i ? 'bg-white/25' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {complaints.filter((c) => c.status === FILTER_KEYS[i]).length}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={24} className="animate-spin mr-2" /> กำลังโหลด...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <ClipboardList size={36} className="mb-2 opacity-30" />
            <p className="text-sm">ไม่มีรายการคำร้อง</p>
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-gray-100">
              {filtered.map((c) => (
                <div key={c.id} className="px-4 py-4 space-y-2 active:bg-gray-50 cursor-pointer"
                     onClick={() => setSelectedComplaint(c)}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-gray-800 text-sm leading-snug">
                      {CATEGORY_LABEL[c.category] ?? c.category}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusBadge status={c.status} />
                      <ChevronRight size={14} className="text-gray-300" />
                    </div>
                  </div>
                  {c.subject && (
                    <p className="text-xs text-gray-600 truncate">{c.subject}</p>
                  )}
                  <p className="text-xs text-gray-400 truncate">{c.detail}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-400 pt-1 flex-wrap">
                    <span>{new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                    {c.phone && <span>{c.phone}</span>}
                    {(c.village || c.location_name) && (
                      <span className="flex items-center gap-1">
                        <MapPin size={10} className="shrink-0" />
                        {c.village || c.location_name}
                      </span>
                    )}
                    {c.assigned_to && (
                      <span className="flex items-center gap-1 text-blue-500">
                        <Wrench size={10} className="shrink-0" />
                        {technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ช่าง'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="px-5 py-3 text-left font-medium">วันที่</th>
                    <th className="px-5 py-3 text-left font-medium">ประเภท</th>
                    <th className="px-5 py-3 text-left font-medium">รายละเอียด</th>
                    <th className="px-5 py-3 text-left font-medium">สถานที่</th>
                    <th className="px-5 py-3 text-left font-medium">ช่าง</th>
                    <th className="px-5 py-3 text-left font-medium">โทรศัพท์</th>
                    <th className="px-5 py-3 text-left font-medium">สถานะ</th>
                    <th className="px-5 py-3 text-left font-medium">การดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50/70 transition-colors cursor-pointer"
                        onClick={() => setSelectedComplaint(c)}>
                      <td className="px-5 py-4 text-gray-500 whitespace-nowrap text-xs">
                        {new Date(c.created_at).toLocaleDateString('th-TH', {
                          day: '2-digit', month: 'short', year: '2-digit',
                        })}
                      </td>
                      <td className="px-5 py-4 font-medium text-gray-700 whitespace-nowrap">
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </td>
                      <td className="px-5 py-4 text-gray-500 max-w-xs">
                        <p className="truncate">{c.detail}</p>
                      </td>
                      <td className="px-5 py-4 text-gray-500 whitespace-nowrap">
                        {(c.village || c.location_name)
                          ? <span className="flex items-center gap-1"><MapPin size={11} className="text-gray-300 shrink-0" />{c.village || c.location_name}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        {c.assigned_to
                          ? <span className="flex items-center gap-1 text-blue-600 text-xs font-medium"><Wrench size={11} className="shrink-0" />{technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ช่าง'}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-4 text-gray-500">
                        {c.phone ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <ActionButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} />
                          <RejectButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
              แสดง {filtered.length} จาก {complaints.length} รายการ
            </p>
          </>
        )}
      </div>
      </>
      )}
    </div>
  )
}
