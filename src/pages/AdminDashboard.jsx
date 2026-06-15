import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import {
  RefreshCw, ClipboardList, Clock, Loader2,
  CheckCircle2, XCircle, AlertCircle, ChevronRight, ChevronLeft,
  Filter, Search, Phone, Trash2, Plus, PhoneCall, LogOut, Users, Shield, MapPin, GripVertical,
  X, FileText, AlignLeft, Image, Calendar, Hash, Home, LayoutGrid, Tag, ChevronUp, ChevronDown, Pencil, Wrench, Camera, Luggage,
  TrendingUp, AlertTriangle, Printer, UserCircle2, CalendarDays, Paperclip, BookOpen, Bell, BellOff, ExternalLink, BarChart2, Settings, Store, Star, Download, Banknote
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { usePushNotification } from '../hooks/usePushNotification'
import MapDashboardAdmin from '../components/admin/MapDashboardAdmin'
import CivilProjectAdmin from '../components/admin/CivilProjectAdmin'
import CivilProjectReport from '../components/admin/CivilProjectReport'
import SystemSettingsAdmin from '../components/admin/SystemSettingsAdmin'
import FeeSettingsAdmin from '../components/admin/FeeSettingsAdmin'
import BusinessRegistrationAdmin from '../components/admin/BusinessRegistrationAdmin'
import EventsManagerComponent from '../components/admin/EventsManager'
import ReportManagerComponent from '../components/admin/ReportManager'
import ModuleManager from '../components/admin/ModuleManager'

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
  road: '', light: '', trash: '', water: '',
  flood: '', tree: '', noise: '', drain: '',
  waste_water: '', suction: '', manhole: '', vendor: '',
  building: '', mosquito: '', pollution: '', corruption: '',
  tax: '', canal: '', animals: '', other: '',
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

function StatusStepper({ status, note }) {
  if (status === 'rejected') {
    return (
      <div className="flex items-start gap-3 p-4 bg-red-50 rounded-2xl border border-red-100">
        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
          <XCircle size={20} className="text-red-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-red-700">คำร้องถูกปฏิเสธ</p>
          {note
            ? <p className="text-xs text-red-600 mt-1 leading-relaxed">เหตุผล: {note}</p>
            : <p className="text-xs text-red-400 mt-0.5">ระบบยุติการดำเนินการคำร้องนี้</p>
          }
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
                  <span className="ml-2 text-[13px] font-medium px-1.5 py-0.5 rounded-full"
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
  const [confirm, setConfirm] = useState(false)
  if (!action) return null
  return (
    <>
      <button onClick={() => setConfirm(true)} disabled={loading === id}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        {loading === id
          ? <Loader2 size={12} className="animate-spin" />
          : <ChevronRight size={12} />}
        {action.label}
      </button>
      {confirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setConfirm(false)}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-72 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการเปลี่ยนสถานะ</p>
            <p className="text-xs text-gray-500 mb-4">ต้องการ <span className="font-medium text-gray-800">"{action.label}"</span> ใช่หรือไม่?</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirm(false); onUpdate(id, action.next) }}
                disabled={loading === id}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                ยืนยัน
              </button>
              <button onClick={() => setConfirm(false)}
                className="flex-1 py-2 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function RejectButton({ status, id, onUpdate, loading }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  if (status === 'completed' || status === 'rejected') return null

  function handleConfirm() {
    if (!reason.trim()) { setErr('กรุณาระบุเหตุผลการปฏิเสธ'); return }
    onUpdate(id, 'rejected', [], reason.trim())
    setOpen(false)
    setReason('')
    setErr('')
  }

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={loading === id}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50">
        <XCircle size={12} /> ปฏิเสธ
      </button>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => { setOpen(false); setReason(''); setErr('') }}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-80 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2">
              <XCircle size={14} className="text-red-500" /> ปฏิเสธคำร้อง
            </p>
            <p className="text-xs text-gray-500 mb-3">กรุณาระบุเหตุผลที่ปฏิเสธคำร้องนี้</p>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setErr('') }}
              rows={3}
              placeholder="เช่น ไม่อยู่ในความรับผิดชอบ, ข้อมูลไม่ครบถ้วน..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-red-200"
            />
            {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
            <div className="flex gap-2 mt-3">
              <button onClick={handleConfirm} disabled={loading === id}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                ยืนยันปฏิเสธ
              </button>
              <button onClick={() => { setOpen(false); setReason(''); setErr('') }}
                className="flex-1 py-2 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
  const [overrideConfirm, setOverrideConfirm] = useState(null)

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

    const hasAttachments = (c.attachments ?? []).length > 0
    const hasWorkPhotos = (c.work_photos ?? []).length > 0

    const imgStyle = 'width:calc(25% - 5px);height:90px;object-fit:cover;border-radius:5px;border:1px solid #e5e7eb;display:inline-block;vertical-align:top'
    const renderPhotos = (urls) =>
      `<div style="display:flex;flex-wrap:wrap;gap:6px">${urls.map(u => `<img src="${u}" style="${imgStyle}">`).join('')}</div>`

    const photoSectionHtml = (hasAttachments || hasWorkPhotos) ? `
<p style="margin:16px 0 6px;font-weight:600;font-size:14px">ภาพประกอบ</p>
${hasAttachments ? `<div style="margin-bottom:10px">
  <div style="font-weight:600;font-size:12px;margin-bottom:4px;color:#374151">ก่อนดำเนินการ (${c.attachments.length} รูป)</div>
  ${renderPhotos(c.attachments)}
</div>` : ''}
${hasWorkPhotos ? `<div>
  <div style="font-weight:600;font-size:12px;margin-bottom:4px;color:#374151">หลังดำเนินการ (${c.work_photos.length} รูป)</div>
  ${renderPhotos(c.work_photos)}
</div>` : ''}` : ''

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

${photoSectionHtml}

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
  const categoryEmoji = CATEGORY_EMOJI[c.category] || ''
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
              <p className="text-white/60 text-[13px] uppercase tracking-wider">เลขที่คำร้อง</p>
              <p className="text-white font-black text-lg tracking-wider mt-0.5 font-mono">
                {c.complaint_number ? (() => { const d = new Date(c.created_at); const yy = String(d.getFullYear()+543).slice(-2); const mm = String(d.getMonth()+1).padStart(2,'0'); return `${yy}${mm}${String(c.complaint_number).padStart(3,'0')}` })() : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-[13px] uppercase tracking-wider">ยื่นเมื่อ</p>
              <p className="text-white/90 text-xs font-medium mt-0.5">{dateStr} น.</p>
            </div>
          </div>
        </div>

        {/* scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5 bg-white">
          {/* status stepper */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">ความคืบหน้า</p>
            <StatusStepper status={c.status} note={c.technician_note} />
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
                      <p className="text-[13px] text-gray-400">สถานที่</p>
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
                      <p className="text-[13px] text-gray-400">เบอร์โทรติดต่อ</p>
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
                      <p className="text-[13px] text-gray-400">พิกัด</p>
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
                ก่อนดำเนินการ ({attachments.length})
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
                <Camera size={12} /> หลังดำเนินการ ({c.work_photos.length})
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
              <RejectButton status={c.status} id={c.id} onUpdate={(id, next, wp = [], note = null) => { onUpdate(id, next, wp, note); onClose() }} loading={updating} />
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
              <ActionButton status={c.status} id={c.id} onUpdate={(id, next, wp = [], note = null) => { onUpdate(id, next, wp, note); onClose() }} loading={updating} />
              <RejectButton status={c.status} id={c.id} onUpdate={(id, next, wp = [], note = null) => { onUpdate(id, next, wp, note); onClose() }} loading={updating} />
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
              <p className="text-[13px] font-semibold text-purple-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Shield size={10} /> Superadmin — แก้ไขสถานะ
              </p>
              <div className="flex items-center gap-2">
                <FixedSelect
                  value={c.status}
                  onChange={(val) => setOverrideConfirm(val)}
                  options={Object.entries(STATUS).map(([key, s]) => ({ value: key, label: s.label }))}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Superadmin override confirm dialog */}
      {overrideConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setOverrideConfirm(null)}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-72 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการเปลี่ยนสถานะ</p>
            <p className="text-xs text-gray-500 mb-4">
              เปลี่ยนเป็น <span className="font-medium text-gray-800">"{STATUS[overrideConfirm]?.label}"</span> ใช่หรือไม่?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { onUpdate(c.id, overrideConfirm, []); setOverrideConfirm(null); onClose() }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                ยืนยัน
              </button>
              <button onClick={() => setOverrideConfirm(null)}
                className="flex-1 py-2 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="text-gray-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-gray-800 font-medium mt-0.5 wrap-break-word">{value}</p>
      </div>
    </div>
  )
}

// ─── User Manager ─────────────────────────────────────────────────────────────
const ROLE_LABELS = {
  superadmin:  { label: 'Super Admin',   color: '#7c3aed', bg: '#ede9fe' },
  admin:       { label: 'แอดมินระบบ',   color: '#1d4ed8', bg: '#dbeafe' },
  officer:     { label: 'แอดมินกอง',    color: '#0891b2', bg: '#e0f2fe' },
  technician:  { label: 'ปฏิบัติงาน',   color: '#d97706', bg: '#fef3c7' },
  staff:       { label: 'เจ้าหน้าที่',  color: '#0ea5e9', bg: '#e0f2fe' },
  viewer:      { label: 'ผู้บริหาร',    color: '#059669', bg: '#d1fae5' },
  council:     { label: 'สภาเทศบาล',    color: '#f59e0b', bg: '#fff7ed' },
  citizen:     { label: 'ประชาชน',       color: '#374151', bg: '#f3f4f6' },
}

function UserManager({ tenant, currentUserRole }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [editingNameId, setEditingNameId] = useState(null)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [editingPositionId, setEditingPositionId] = useState(null)
  const [editingPositionValue, setEditingPositionValue] = useState('')
  const [editingAddressId, setEditingAddressId] = useState(null)
  const [editingAddressValue, setEditingAddressValue] = useState('')
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [editingRoleValue, setEditingRoleValue] = useState('')
  const [viewingUser, setViewingUser] = useState(null)
  const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' })

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
    const needsMuni = ['admin', 'staff', 'technician', 'officer', 'viewer', 'council'].includes(newRole)
    const muni = needsMuni ? (municipalityId || tenant?.id) : null
    const { error } = await supabase.from('profiles').update({ role: newRole, municipality_id: muni }).eq('id', userId)
    if (error) {
      console.error('updateRole failed:', error.message)
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, role: newRole, municipality_id: muni } : u
      ))
      setEditingRoleId(null)
    }
    setSaving(null)
  }

  async function updatePosition(userId) {
    const val = editingPositionValue.trim()
    setSaving(userId)
    const { error } = await supabase.from('profiles').update({ job_title: val || null }).eq('id', userId)
    if (error) {
      alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    } else {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, job_title: val || null } : u))
      setEditingPositionId(null)
    }
    setSaving(null)
  }

  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    const matchSearch = !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phone || '').includes(q)
    const matchRole = !filterRole || u.role === filterRole
    return matchSearch && matchRole
  }).sort((a, b) => {
    const { key, direction } = sortConfig;
    let aVal = '';
    let bVal = '';

    if (key === 'job_title') {
      const aRoleLabel = (ROLE_LABELS[a.role] ?? ROLE_LABELS.citizen).label;
      const bRoleLabel = (ROLE_LABELS[b.role] ?? ROLE_LABELS.citizen).label;
      aVal = aRoleLabel + (a.job_title || '');
      bVal = bRoleLabel + (b.job_title || '');
    } else {
      aVal = a[key] || '';
      bVal = b[key] || '';
    }
    
    // Sort logically for text, case insensitive
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-700 flex items-center gap-2">
          <Users size={16} /> จัดการผู้ใช้งาน
          {!loading && users.length > 0 && (
            <span className="text-xs font-normal text-gray-400">({users.length} คน)</span>
          )}
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
          <option value="">ทุกตำแหน่ง ({users.length})</option>
          {[
            { value: 'citizen',    label: 'ประชาชน' },
            { value: 'staff',      label: 'เจ้าหน้าที่' },
            { value: 'viewer',     label: 'ผู้บริหาร' },
            { value: 'council',    label: 'สภาเทศบาล' },
            { value: 'officer',    label: 'แอดมินกอง' },
            { value: 'technician', label: 'ปฏิบัติงาน' },
            { value: 'admin',      label: 'แอดมินระบบ' },
            ...(currentUserRole === 'superadmin' ? [{ value: 'superadmin', label: 'Super Admin' }] : []),
          ].map(({ value, label }) => {
            const count = users.filter((u) => u.role === value).length
            return count > 0 ? <option key={value} value={value}>{label} ({count})</option> : null
          })}
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
        <>
        <div className="md:hidden divide-y divide-gray-50">
          {filtered.map((u, i) => {
            const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
            const isSelf = false
            return (
              <div key={u.id} className="flex flex-col px-4 py-3 gap-2">
                {/* แถว 1: avatar + ชื่อ + badge */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 font-mono w-5 text-right shrink-0">{i + 1}</span>
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
                    <p className="text-xs text-gray-400 break-all mt-0.5">{u.email || '—'}</p>
                    {u.phone && <p className="text-xs text-gray-500 mt-0.5">📞 {u.phone}</p>}
                    {u.id_card && (
                      <p className="text-xs font-mono text-gray-400 mt-0.5">
                        🪪 {u.id_card.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                      </p>
                    )}
                    {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-gray-400">
                            {u.job_title || <span className="italic text-gray-300">ยังไม่ระบุตำแหน่งงาน</span>}
                          </p>
                          <button
                            onClick={() => { setEditingPositionId(u.id); setEditingPositionValue(u.job_title || '') }}
                            className="text-gray-300 hover:text-gray-500 transition-colors"
                          >
                            <Pencil size={11} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <p className="text-xs text-gray-400">
                            {u.address || <span className="italic text-gray-300">ยังไม่ระบุที่อยู่</span>}
                          </p>
                          <button
                            onClick={() => { setEditingAddressId(u.id); setEditingAddressValue(u.address || '') }}
                            className="text-gray-300 hover:text-gray-500 transition-colors"
                          >
                            <Pencil size={11} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                        style={{ backgroundColor: rs.bg, color: rs.color }}>
                    {rs.label}
                  </span>
                </div>
                {/* แถว 2: dropdown เปลี่ยน role (เฉพาะ admin/superadmin) */}
                {u.role !== 'superadmin' && (currentUserRole === 'superadmin' || currentUserRole === 'admin') && (
                  <div className="flex items-center gap-2 pl-[68px] mt-1 justify-start">
                    {editingRoleId === u.id ? (
                      <>
                        <select
                          value={editingRoleValue}
                          disabled={saving === u.id}
                          onChange={(e) => setEditingRoleValue(e.target.value)}
                          className="text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-gray-700 focus:outline-none bg-gray-50"
                        >
                          <option value="citizen">ประชาชน</option>
                          <option value="staff">เจ้าหน้าที่</option>
                          <option value="viewer">ผู้บริหาร</option>
                          <option value="council">สภาเทศบาล</option>
                          <option value="officer">แอดมินกอง</option>
                          <option value="technician">ปฏิบัติงาน</option>
                          <option value="admin">แอดมินระบบ</option>
                          {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
                        </select>
                        <button onClick={() => updateRole(u.id, editingRoleValue, u.municipality_id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium px-2">ยืนยัน</button>
                        <button onClick={() => setEditingRoleId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                        {saving === u.id && <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}
                      </>
                    ) : (
                      <button onClick={() => { setEditingRoleId(u.id); setEditingRoleValue(u.role) }} className="text-xs text-gray-500 hover:text-gray-700 font-medium px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors whitespace-nowrap">
                        เปลี่ยนบทบาท
                      </button>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 pl-[68px] mt-1">
                  <button onClick={() => setViewingUser(u)} className="text-[11px] text-blue-500 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors">
                    ดูรายละเอียด
                  </button>
                </div>
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
                {editingAddressId === u.id && (
                  <div className="flex items-center gap-2 pl-12">
                    <input
                      autoFocus
                      value={editingAddressValue}
                      onChange={(e) => setEditingAddressValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') updateAddress(u.id); if (e.key === 'Escape') setEditingAddressId(null) }}
                      placeholder="ที่อยู่"
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white text-gray-900"
                    />
                    <button
                      onClick={() => updateAddress(u.id)}
                      disabled={saving === u.id}
                      className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={() => setEditingAddressId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
                    >
                      ยกเลิก
                    </button>
                  </div>
                )}
                {editingPositionId === u.id && (
                  <div className="flex items-center gap-2 pl-12">
                    <input
                      autoFocus
                      value={editingPositionValue}
                      onChange={(e) => setEditingPositionValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') updatePosition(u.id); if (e.key === 'Escape') setEditingPositionId(null) }}
                      placeholder="เช่น นายกเทศมนตรีตำบลน้ำเลา, ช่างโยธา"
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white text-gray-900"
                    />
                    <button
                      onClick={() => updatePosition(u.id)}
                      disabled={saving === u.id}
                      className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={() => setEditingPositionId(null)}
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
        
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 font-medium">ลำดับ</th>
                <th className="px-4 py-3 font-medium cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('full_name')}>
                  <div className="flex items-center gap-1">ชื่อ-นามสกุล {sortConfig.key === 'full_name' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium">เลขบัตรประชาชน</th>
                <th className="px-4 py-3 font-medium cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('phone')}>
                  <div className="flex items-center gap-1">เบอร์โทรศัพท์ {sortConfig.key === 'phone' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium min-w-[140px] cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('address')}>
                  <div className="flex items-center gap-1">ที่อยู่ {sortConfig.key === 'address' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('job_title')}>
                  <div className="flex items-center gap-1">ตำแหน่ง {sortConfig.key === 'job_title' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('created_at')}>
                  <div className="flex items-center gap-1">วันที่ลงทะเบียน {sortConfig.key === 'created_at' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium min-w-[180px]">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((u, i) => {
                const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
                return (
                  <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{i + 1}</td>
                    <td className="px-4 py-3 min-w-[200px]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                             style={{ backgroundColor: rs.color }}>
                          {(u.full_name || u.email || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          {editingNameId === u.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                autoFocus
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') updateName(u.id); if (e.key === 'Escape') setEditingNameId(null) }}
                                placeholder="ชื่อ-นามสกุล"
                                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                              />
                              <button onClick={() => updateName(u.id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">บันทึก</button>
                              <button onClick={() => setEditingNameId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-gray-800">{u.full_name || '—'}</span>
                              {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                                <button onClick={() => { setEditingNameId(u.id); setEditingNameValue(u.full_name || '') }} className="text-gray-300 hover:text-gray-500">
                                  <Pencil size={12} />
                                </button>
                              )}
                            </div>
                          )}
                          <span className="text-xs text-gray-400 truncate">{u.email || u.phone || '—'}</span>
                        </div>
                      </div>
                    </td>
                    {/* เลขบัตรประชาชน */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {u.id_card ? (
                        <span className="text-xs font-mono text-gray-600 tracking-wide">
                          {u.id_card.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                        </span>
                      ) : (
                        <span className="text-xs italic text-gray-300">ยังไม่ยืนยัน</span>
                      )}
                    </td>
                    {/* เบอร์โทรศัพท์ */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600">
                      {u.phone || <span className="italic text-gray-300">ยังไม่ระบุ</span>}
                    </td>
                    {/* ที่อยู่ */}
                    <td className="px-4 py-3">
                      {editingAddressId === u.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editingAddressValue}
                            onChange={(e) => setEditingAddressValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') updateAddress(u.id); if (e.key === 'Escape') setEditingAddressId(null) }}
                            placeholder="ที่อยู่"
                            className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                          />
                          <button onClick={() => updateAddress(u.id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">บันทึก</button>
                          <button onClick={() => setEditingAddressId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs">{u.address || <span className="italic text-gray-300">ยังไม่ระบุ</span>}</span>
                          {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                            <button onClick={() => { setEditingAddressId(u.id); setEditingAddressValue(u.address || '') }} className="text-gray-300 hover:text-gray-500">
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-[180px]">
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: rs.bg, color: rs.color }}>
                          {rs.label}
                        </span>
                        {editingPositionId === u.id ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              autoFocus
                              value={editingPositionValue}
                              onChange={(e) => setEditingPositionValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') updatePosition(u.id); if (e.key === 'Escape') setEditingPositionId(null) }}
                              placeholder="ตำแหน่งงาน"
                              className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                            />
                            <button onClick={() => updatePosition(u.id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">บันทึก</button>
                            <button onClick={() => setEditingPositionId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span>{u.job_title || <span className="italic text-gray-300">ไม่มีตำแหน่ง</span>}</span>
                            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                              <button onClick={() => { setEditingPositionId(u.id); setEditingPositionValue(u.job_title || '') }} className="text-gray-300 hover:text-gray-500">
                                <Pencil size={11} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setViewingUser(u)} className="text-xs text-blue-500 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors whitespace-nowrap">
                          ดูรายละเอียด
                        </button>
                        {u.role !== 'superadmin' && (currentUserRole === 'superadmin' || currentUserRole === 'admin') && (
                          <div className="flex items-center gap-2">
                            {editingRoleId === u.id ? (
                              <>
                                <select
                                  value={editingRoleValue}
                                  disabled={saving === u.id}
                                  onChange={(e) => setEditingRoleValue(e.target.value)}
                                  className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none bg-white cursor-pointer"
                                >
                                  <option value="citizen">ประชาชน</option>
                                  <option value="staff">เจ้าหน้าที่</option>
                                  <option value="viewer">ผู้บริหาร</option>
                                  <option value="council">สภาเทศบาล</option>
                                  <option value="officer">แอดมินกอง</option>
                                  <option value="technician">ปฏิบัติงาน</option>
                                  <option value="admin">แอดมินระบบ</option>
                                  {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
                                </select>
                                <button onClick={() => updateRole(u.id, editingRoleValue, u.municipality_id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">ยืนยัน</button>
                                <button onClick={() => setEditingRoleId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                                {saving === u.id && <Loader2 size={12} className="animate-spin text-gray-400" />}
                              </>
                            ) : (
                              <button onClick={() => { setEditingRoleId(u.id); setEditingRoleValue(u.role) }} className="text-xs text-gray-500 hover:text-gray-700 font-medium px-2 py-1 bg-gray-50 hover:bg-gray-100 rounded transition-colors whitespace-nowrap">
                                เปลี่ยนบทบาท
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>
      )}

      {/* View User Details Modal */}
      {viewingUser && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => setViewingUser(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">รายละเอียดผู้ใช้งาน</h3>
              <button onClick={() => setViewingUser(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white shrink-0"
                     style={{ backgroundColor: (ROLE_LABELS[viewingUser.role] || ROLE_LABELS.citizen).color }}>
                  {(viewingUser.full_name || viewingUser.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">{viewingUser.full_name || '—'}</h4>
                  <span className="text-sm font-medium px-2.5 py-0.5 rounded-full mt-1 inline-block"
                        style={{ backgroundColor: (ROLE_LABELS[viewingUser.role] || ROLE_LABELS.citizen).bg, color: (ROLE_LABELS[viewingUser.role] || ROLE_LABELS.citizen).color }}>
                    {(ROLE_LABELS[viewingUser.role] || ROLE_LABELS.citizen).label}
                  </span>
                </div>
              </div>
              
              <div className="space-y-3">
                {[
                  { label: 'ตำแหน่งงาน',        value: viewingUser.job_title },
                  { label: 'อีเมล',              value: viewingUser.email,   cls: 'break-all' },
                  { label: 'เบอร์โทรศัพท์',      value: viewingUser.phone },
                  {
                    label: 'เลขบัตรประชาชน',
                    value: viewingUser.id_card
                      ? viewingUser.id_card.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')
                      : null,
                    mono: true,
                  },
                  { label: 'ที่อยู่',             value: viewingUser.address, pre: true },
                  {
                    label: 'วันที่ลงทะเบียน',
                    value: viewingUser.created_at
                      ? new Date(viewingUser.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : null,
                  },
                ].map(({ label, value, cls = '', mono, pre }) => (
                  <div key={label}>
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className={`text-sm bg-gray-50 px-3 py-2 rounded-lg ${mono ? 'font-mono tracking-wide' : ''} ${pre ? 'whitespace-pre-wrap' : ''} ${cls} ${value ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                      {value || 'ยังไม่ได้ระบุ'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => setViewingUser(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors text-sm">
                ปิด
              </button>
            </div>
          </div>
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
          <p className="text-[13px] text-gray-400">{c.number}</p>
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
        <>
          {/* Mobile: DnD sortable cards */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={contacts.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="md:hidden bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {contacts.map((c, i) => (
                  <SortableContact key={c.id} c={c} i={i} total={contacts.length}
                    onDelete={deleteContact} onMove={handleMove} onEdit={handleEdit}
                    editingId={editingId} editingForm={editingForm}
                    onEditChange={(field, val) => setEditingForm((p) => ({ ...p, [field]: val }))}
                    onEditSave={saveContactEdit} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">สัญลักษณ์</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ชื่อ / หน่วยงาน</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">เบอร์โทร</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {contacts.map((c, i) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 text-2xl">{c.emoji}</td>
                    <td className="px-4 py-3">
                      {editingId === c.id ? (
                        <input value={editingForm.label} onChange={e => setEditingForm(p => ({ ...p, label: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none w-full max-w-xs" />
                      ) : (
                        <span className="font-medium text-gray-800">{c.label}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === c.id ? (
                        <div className="flex items-center gap-2">
                          <input value={editingForm.number} onChange={e => setEditingForm(p => ({ ...p, number: e.target.value }))}
                            className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none w-32" />
                          <button onClick={saveContactEdit}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-green-500 hover:bg-green-600">บันทึก</button>
                          <button onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 rounded-lg text-xs text-gray-500 border border-gray-200 hover:bg-gray-50">ยกเลิก</button>
                        </div>
                      ) : (
                        <a href={`tel:${c.number}`} className="text-blue-600 hover:underline font-mono">{c.number}</a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => handleEdit(c)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteContact(c.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="ลบ">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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

// ─── Staff Manager ───────────────────────────────────────────────────────────
const STAFF_ROLE_LABEL = {
  mayor: 'นายกเทศมนตรี',
  deputy_mayor: 'รองนายกเทศมนตรี',
  clerk: 'ปลัดเทศบาล',
  staff: 'เจ้าหน้าที่',
}

const EMPTY_STAFF_FORM = { name: '', title: '', role: 'mayor' }

function StaffManager({ tenant }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState(EMPTY_STAFF_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_STAFF_FORM)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase
      .from('staff')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('display_order')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        setStaff(data ?? [])
        setLoading(false)
      })
  }, [tenant?.id])

  async function addStaff() {
    const name = form.name.trim()
    const title = form.title.trim()
    if (!name || !title || !tenant?.id) return
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('staff')
      .insert({ municipality_id: tenant.id, name, title, role: form.role, display_order: staff.length })
      .select()
      .single()
    if (err) {
      setError('เพิ่มไม่สำเร็จ: ' + err.message)
    } else {
      setStaff((prev) => [...prev, data])
      setForm(EMPTY_STAFF_FORM)
      setShowAddForm(false)
    }
    setSaving(false)
  }

  async function saveEdit(id) {
    const name = editForm.name.trim()
    const title = editForm.title.trim()
    if (!name || !title) { setEditingId(null); return }
    const { error: err } = await supabase
      .from('staff')
      .update({ name, title, role: editForm.role })
      .eq('id', id)
    if (err) { setError('แก้ไขไม่สำเร็จ: ' + err.message); return }
    setStaff((prev) => prev.map((s) => s.id === id ? { ...s, name, title, role: editForm.role } : s))
    setEditingId(null)
  }

  async function deleteStaff(id, name) {
    if (!window.confirm(`ลบ "${name}" ออกจากรายชื่อผู้บริหาร?`)) return
    setDeleting(id)
    const { error: err } = await supabase.from('staff').delete().eq('id', id)
    if (err) { setError('ลบไม่สำเร็จ: ' + err.message) }
    else { setStaff((prev) => prev.filter((s) => s.id !== id)) }
    setDeleting(null)
  }

  async function handlePhotoUpload(staffId, file) {
    if (!file) return
    setUploading(staffId)
    setError(null)
    const ext = file.name.split('.').pop().toLowerCase()
    const path = `staff/${staffId}/photo_${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('complaint-attachments')
      .upload(path, file, { upsert: true })
    if (uploadErr) {
      setError('อัปโหลดรูปไม่สำเร็จ: ' + uploadErr.message)
      setUploading(null)
      return
    }
    const { data: urlData } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
    const { error: updateErr } = await supabase
      .from('staff')
      .update({ photo_url: urlData.publicUrl })
      .eq('id', staffId)
    if (updateErr) {
      setError('บันทึกข้อมูลไม่สำเร็จ: ' + updateErr.message)
    } else {
      setStaff((prev) => prev.map((s) => s.id === staffId ? { ...s, photo_url: urlData.publicUrl } : s))
    }
    setUploading(null)
  }

  async function removePhoto(staffId) {
    const { error: updateErr } = await supabase
      .from('staff')
      .update({ photo_url: null })
      .eq('id', staffId)
    if (!updateErr) {
      setStaff((prev) => prev.map((s) => s.id === staffId ? { ...s, photo_url: null } : s))
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-300" /></div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-700 flex items-center gap-2">
          <UserCircle2 size={18} style={{ color: 'var(--color-primary)' }} />
          จัดการรูปผู้บริหาร
        </h2>
        <button
          onClick={() => { setShowAddForm((v) => !v); setForm(EMPTY_STAFF_FORM) }}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl font-medium text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={15} /> เพิ่มบุคลากร
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">⚠️ {error}</div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-800">เพิ่มบุคลากรใหม่</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ชื่อ-นามสกุล *</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="เช่น นายสมชาย ใจดี"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ตำแหน่ง *</label>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="เช่น นายกเทศมนตรีตำบลน้ำเลา"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">ประเภท</label>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none">
              {Object.entries(STAFF_ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">
              ยกเลิก
            </button>
            <button onClick={addStaff} disabled={saving || !form.name.trim() || !form.title.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              บันทึก
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {staff.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          <UserCircle2 size={36} className="mx-auto mb-3 text-gray-200" />
          <p>ยังไม่มีข้อมูลผู้บริหาร</p>
          <p className="text-xs mt-1">กด "เพิ่มบุคลากร" ด้านบนเพื่อเริ่มต้น</p>
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-3">
            {staff.map((person) => (
              <div key={person.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                {editingId === person.id ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">ชื่อ-นามสกุล</label>
                        <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">ตำแหน่ง</label>
                        <input value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                      </div>
                    </div>
                    <select value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                      className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none">
                      {Object.entries(STAFF_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="px-4 py-2 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">ยกเลิก</button>
                      <button onClick={() => saveEdit(person.id)} className="px-4 py-2 text-sm rounded-xl font-medium text-white" style={{ backgroundColor: 'var(--color-primary)' }}>บันทึก</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="shrink-0">
                      {person.photo_url ? (
                        <img src={person.photo_url} alt={person.name} className="w-16 h-16 rounded-full object-cover object-top ring-2 ring-gray-100" />
                      ) : (
                        <div className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-white text-lg"
                          style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
                          {person.name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 text-sm truncate">{person.name}</p>
                      <p className="text-xs text-gray-500 truncate">{person.title}</p>
                      <span className="inline-block text-[13px] px-2 py-0.5 rounded-full mt-1 text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
                        {STAFF_ROLE_LABEL[person.role] ?? person.role}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <label className={`cursor-pointer flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium text-white ${uploading === person.id ? 'opacity-60 cursor-wait' : ''}`}
                        style={{ backgroundColor: 'var(--color-primary)' }}>
                        {uploading === person.id ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                        {person.photo_url ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                          disabled={uploading === person.id}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(person.id, f) }} />
                      </label>
                      <button onClick={() => { setEditingId(person.id); setEditForm({ name: person.name, title: person.title, role: person.role }) }}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">
                        <Pencil size={11} /> แก้ไข
                      </button>
                      {person.photo_url && (
                        <button onClick={() => removePhoto(person.id)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium text-orange-500 border border-orange-200 hover:bg-orange-50">
                          <X size={11} /> ลบรูป
                        </button>
                      )}
                      <button onClick={() => deleteStaff(person.id, person.name)} disabled={deleting === person.id}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50">
                        {deleting === person.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} ลบ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">รูป</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ชื่อ-นามสกุล</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ตำแหน่ง</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {staff.map((person, i) => (
                  <tr key={person.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      {person.photo_url ? (
                        <img src={person.photo_url} alt={person.name} className="w-9 h-9 rounded-full object-cover object-top ring-1 ring-gray-200" />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs"
                          style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
                          {person.name.trim().split(' ').map((w) => w[0]).join('').slice(0, 2)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{person.name}</td>
                    <td className="px-4 py-3 text-gray-600">{person.title}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
                        {STAFF_ROLE_LABEL[person.role] ?? person.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end items-center gap-1.5">
                        <label className={`cursor-pointer flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium text-white ${uploading === person.id ? 'opacity-60 cursor-wait' : ''}`}
                          style={{ backgroundColor: 'var(--color-primary)' }} title={person.photo_url ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}>
                          {uploading === person.id ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                          รูป
                          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                            disabled={uploading === person.id}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(person.id, f) }} />
                        </label>
                        <button onClick={() => { setEditingId(person.id); setEditForm({ name: person.name, title: person.title, role: person.role }) }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteStaff(person.id, person.name)} disabled={deleting === person.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50" title="ลบ">
                          {deleting === person.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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
        <>
          {/* Mobile */}
          <div className="md:hidden space-y-2">
            {locations.map((loc) => (
              <div key={loc.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                <GripVertical size={15} className="text-gray-300 shrink-0" />
                <MapPin size={14} className="text-gray-400 shrink-0" />
                {editingId === loc.id ? (
                  <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => saveEdit(loc.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(loc.id); if (e.key === 'Escape') setEditingId(null) }}
                    className="flex-1 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                ) : (
                  <span className="flex-1 text-sm text-gray-700">{loc.name}</span>
                )}
                <button onClick={() => { setEditingId(loc.id); setEditingName(loc.name) }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                  <Pencil size={14} />
                </button>
                <button onClick={() => deleteLocation(loc.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ชื่อสถานที่เกิดเหตุ</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {locations.map((loc, i) => (
                  <tr key={loc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      {editingId === loc.id ? (
                        <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => saveEdit(loc.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(loc.id); if (e.key === 'Escape') setEditingId(null) }}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:ring-1 w-full max-w-sm"
                          style={{ '--tw-ring-color': 'var(--color-primary)' }} />
                      ) : (
                        <span className="text-sm text-gray-800">{loc.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => { setEditingId(loc.id); setEditingName(loc.name) }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => deleteLocation(loc.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="ลบ">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
        <>
          {/* Mobile: DnD sortable cards */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={cats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="md:hidden space-y-2">
                {cats.map((cat, idx) => (
                  <SortableCatItem key={cat.id} cat={cat} idx={idx} total={cats.length}
                    onDelete={deleteCat} onMove={moveCat} onEdit={editCat} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ป้ายสี</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cats.map((cat, idx) => {
                  const color = COLOR_PRESETS[cat.color_idx ?? 0] ?? COLOR_PRESETS[0]
                  return (
                    <tr key={cat.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {cat.emoji} {cat.label}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: color.color, color: color.textColor }}>
                          {cat.emoji} {cat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => editCat(cat)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => deleteCat(cat.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="ลบ">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
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

  <p style="text-indent:2.5em">ตามที่ ${tenant?.name ?? 'หน่วยงาน'} ได้เปิดให้บริการรับเรื่องร้องทุกข์ผ่านระบบบริการออนไลน์ เพื่ออำนวยความสะดวกแก่ประชาชนนั้น ขอรายงานผลการดำเนินงาน${viewLabel} ดังนี้</p>

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

function ReportManager({ complaints, tenant, technicians = [] }) {
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

  // เทียบเดือนที่แล้ว (เฉพาะ view === 'month')
  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear  = month === 0 ? year - 1 : year
  const prevData  = view === 'month'
    ? complaints.filter(c => { const d = new Date(c.created_at); return d.getMonth() === prevMonth && d.getFullYear() === prevYear })
    : []
  const prevTotal     = prevData.length
  const prevCompleted = prevData.filter(c => c.status === 'completed').length
  const prevRate      = prevTotal > 0 ? Math.round(prevCompleted / prevTotal * 100) : 0
  const prevClosedData = complaints.filter(c => {
    if (c.status !== 'completed') return false
    const d = new Date(c.updated_at)
    return d.getMonth() === prevMonth && d.getFullYear() === prevYear
  })
  const prevAvgDays = prevClosedData.length > 0
    ? Math.round(prevClosedData.reduce((s, c) => s + (new Date(c.updated_at) - new Date(c.created_at)) / 86400000, 0) / prevClosedData.length)
    : null

  // SLA compliance — breakdown ระยะเวลาปิดงาน
  const slaIn3    = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 3).length
  const slaIn7    = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 7).length
  const slaIn14   = closedData.filter(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000 <= 14).length
  const slaOver14 = closedData.length - slaIn14
  const slaRate7  = closedData.length > 0 ? Math.round(slaIn7 / closedData.length * 100) : null

  // ผลงานช่าง — lookup ชื่อจาก technicians array ด้วย assigned_to UUID
  const techMap = {}
  complaints.filter(c => c.status === 'completed' && c.assigned_to).forEach(c => {
    const tech = technicians.find(t => t.id === c.assigned_to)
    const name = tech?.full_name || tech?.email || null
    if (!name) return
    if (!techMap[name]) techMap[name] = { name, completed: 0, totalDays: 0 }
    techMap[name].completed++
    techMap[name].totalDays += (new Date(c.updated_at) - new Date(c.created_at)) / 86400000
  })
  const techLeaderboard = Object.values(techMap)
    .map(t => ({ ...t, avgDays: Math.round(t.totalDays / t.completed) }))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 5)

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
  const catDataAll = Object.entries(catCount)
    .map(([cat, count]) => ({ name: CATEGORY_LABEL[cat] ?? cat, emoji: CATEGORY_EMOJI[cat] ?? '📄', count }))
    .sort((a, b) => b.count - a.count)
  const catData = catDataAll.slice(0, 6)
  const otherCount = catDataAll.slice(6).reduce((s, d) => s + d.count, 0)
  const catPieData = otherCount > 0 ? [...catData, { name: 'อื่นๆ', emoji: '📄', count: otherCount }] : catData

  const CAT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#94a3b8']

  const nowMs = now.getTime()

  // คำร้องค้างนานเกิน 15 วัน
  const overdue = complaints
    .filter(c => !['completed','rejected'].includes(c.status) &&
      (nowMs - new Date(c.created_at)) > 15 * 86400000)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, 6)

  // รับเรื่องแล้ว (received) แต่ช่างยังไม่รับงานต่อเกิน 7 วัน
  const noTechAction = complaints
    .filter(c => c.status === 'received' &&
      (nowMs - new Date(c.updated_at)) > 7 * 86400000)
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
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
          <button onClick={() => {
            const rows = [
              ['เลขที่','วันที่','ผู้ร้อง','โทรศัพท์','ประเภท','รายละเอียด','สถานที่','สถานะ'],
              ...viewData.map(c => [
                c.id.slice(0,8).toUpperCase(),
                new Date(c.created_at).toLocaleDateString('th-TH'),
                c.profiles?.full_name ?? '',
                c.profiles?.phone ?? c.phone ?? '',
                CATEGORY_LABEL[c.category] ?? c.category ?? '',
                (c.description ?? '').replace(/\n/g,' '),
                [c.location_name, c.village].filter(Boolean).join(', '),
                STATUS[c.status]?.label ?? c.status,
              ])
            ]
            const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
            a.download = `คำร้อง_${viewLabel}_${tenant?.name ?? ''}.csv`
            a.click()
          }} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={15} /> Export CSV
          </button>
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
          { label: 'คำร้องที่รับเข้า', value: total,    color: '#64748b', sub: 'รายการ',           delta: view === 'month' ? total - prevTotal : null,                                    unit: '' },
          { label: 'ปิดงานแล้ว',       value: completed, color: '#10b981', sub: 'รายการ',           delta: view === 'month' ? completed - prevCompleted : null,                            unit: '' },
          { label: 'อัตราปิดงาน',      value: `${rate}%`, color: rateColor, sub: rate >= 70 ? '✅ ดี' : rate >= 40 ? '⚠️ ปานกลาง' : '🔴 ต่ำ', delta: view === 'month' && prevTotal > 0 ? rate - prevRate : null, unit: '%' },
          { label: 'เฉลี่ยวันปิดงาน',  value: avgDays !== null ? avgDays : '—', color: '#8b5cf6', sub: avgDays !== null ? 'วัน' : 'ไม่มีข้อมูล', delta: view === 'month' && avgDays !== null && prevAvgDays !== null ? prevAvgDays - avgDays : null, unit: 'วัน' },
        ].map(({ label, value, color, sub, delta, unit }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-2xl font-black leading-none" style={{ color }}>{value}</p>
            <p className="text-[13px] text-gray-400 mt-1">{sub}</p>
            <p className="text-xs font-medium text-gray-600 mt-0.5">{label}</p>
            {delta !== null && (
              <p className={`text-[11px] font-semibold mt-1.5 ${delta > 0 ? 'text-green-500' : delta < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                {delta > 0 ? '↑' : delta < 0 ? '↓' : '='} {delta !== 0 ? `${Math.abs(delta)}${unit} จากเดือนก่อน` : 'เท่าเดิม'}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* SLA compliance */}
      {closedData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock size={14} className="text-blue-500" />
              SLA — ระยะเวลาแก้ไขปัญหา
            </h3>
            {slaRate7 !== null && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${slaRate7 >= 70 ? 'bg-green-50 text-green-600' : slaRate7 >= 40 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-500'}`}>
                {slaRate7 >= 70 ? '✅' : slaRate7 >= 40 ? '⚠️' : '🔴'} {slaRate7}% แก้ภายใน 7 วัน
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '0–3 วัน', count: slaIn3,            color: '#10b981', bg: '#d1fae5', emoji: '🟢' },
              { label: '4–7 วัน', count: slaIn7 - slaIn3,  color: '#3b82f6', bg: '#dbeafe', emoji: '🔵' },
              { label: '8–14 วัน', count: slaIn14 - slaIn7, color: '#f59e0b', bg: '#fef3c7', emoji: '🟡' },
              { label: '15+ วัน',  count: slaOver14,          color: '#ef4444', bg: '#fee2e2', emoji: '🔴' },
            ].map(({ label, count, color, bg, emoji }) => (
              <div key={label} className="rounded-2xl p-4 text-center" style={{ backgroundColor: bg }}>
                <p className="text-xs mb-1">{emoji}</p>
                <p className="text-2xl font-black" style={{ color }}>{count}</p>
                <p className="text-xs font-semibold mt-1" style={{ color }}>{label}</p>
                <p className="text-[11px] mt-0.5" style={{ color, opacity: 0.7 }}>
                  {closedData.length > 0 ? `${Math.round(count / closedData.length * 100)}%` : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Category breakdown — full width */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          {view === 'all' ? 'ประเภทคำร้องทั้งหมด' : view === 'year' ? `ประเภทคำร้องปี ${year + 543}` : `ประเภทคำร้อง${MONTHS_FULL_TH[month]}นี้`}
        </h3>
        {catData.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">ไม่มีข้อมูล</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={catPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={78}
                  dataKey="count"
                  nameKey="name"
                  paddingAngle={2}
                  label={({ cx, cy, midAngle, outerRadius, count }) => {
                    const RADIAN = Math.PI / 180
                    const x = cx + (outerRadius + 14) * Math.cos(-midAngle * RADIAN)
                    const y = cy + (outerRadius + 14) * Math.sin(-midAngle * RADIAN)
                    return (
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                        fontSize={11} fontWeight={700} fill="#374151">
                        {count}
                      </text>
                    )
                  }}
                  labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                >
                  {catPieData.map((_, i) => (
                    <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [`${value} รายการ`, name]}
                  contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2.5 mt-2">
              {catData.map(({ name, emoji, count }, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-700 font-medium flex items-center gap-2 truncate">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CAT_COLORS[i % CAT_COLORS.length] }} />
                      <span>{emoji}</span> {name}
                    </span>
                    <span className="text-gray-500 shrink-0 ml-2 font-semibold">{count}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${count / catData[0].count * 100}%`,
                        backgroundColor: CAT_COLORS[i % CAT_COLORS.length],
                        opacity: 0.75,
                      }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Technician leaderboard */}
      {techLeaderboard.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Wrench size={14} className="text-orange-500" />
            ผลงานช่าง
            <span className="text-xs font-normal text-gray-400 ml-auto">ตลอดทุกช่วงเวลา</span>
          </h3>
          <div className="space-y-3">
            {techLeaderboard.map((t, i) => {
              const medals = ['🥇','🥈','🥉']
              return (
                <div key={t.name} className="flex items-center gap-3">
                  <div className="w-7 text-center text-base shrink-0">{medals[i] ?? `${i + 1}.`}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{t.name}</p>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1.5">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${(t.completed / techLeaderboard[0].completed) * 100}%`, backgroundColor: '#f97316' }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-800">{t.completed} งาน</p>
                    <p className="text-[11px] text-gray-400">เฉลี่ย {t.avgDays} วัน/งาน</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 2-col alert widgets — แสดงเฉพาะ รายเดือน */}
      {view === 'month' && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* รับเรื่องแล้ว แต่ช่างยังไม่รับงาน */}
          <div className="bg-white rounded-2xl border border-orange-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <Clock size={14} className="text-orange-500" />
              รอช่างรับงานเกิน 7 วัน
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 7 วันหลังรับเรื่อง · ทั้งระบบ {noTechAction.length} รายการ</p>
            {noTechAction.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ช่างรับงานทุกรายการแล้ว</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {noTechAction.map(c => {
                  const days = Math.floor((nowMs - new Date(c.updated_at)) / 86400000)
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">
                          {CATEGORY_LABEL[c.category] ?? c.category}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {c.assigned_to_name
                            ? `ช่าง: ${c.assigned_to_name}`
                            : c.assigned_to ? 'มอบหมายแล้ว ยังไม่รับงาน' : 'ยังไม่ได้มอบหมายช่าง'}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-orange-500 shrink-0 bg-orange-50 px-2 py-0.5 rounded-lg">
                        {days} วัน
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* คำร้องค้างเกิน 7 วัน */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              คำร้องค้างเกิน 15 วัน
            </h3>
            <p className="text-xs text-gray-400 mb-4">ค้างเกิน 15 วัน · ทั้งระบบ {overdue.length} รายการ</p>
            {overdue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <CheckCircle2 size={28} className="text-green-400 mb-2" />
                <p className="text-sm text-green-600 font-medium">ไม่มีคำร้องค้าง</p>
              </div>
            ) : (
              <div className="space-y-0 divide-y divide-gray-50">
                {overdue.map(c => {
                  const days = Math.floor((nowMs - new Date(c.created_at)) / 86400000)
                  const s = STATUS[c.status]
                  return (
                    <div key={c.id} className="flex items-center gap-3 py-2.5">
                      <span className="text-lg shrink-0">{CATEGORY_EMOJI[c.category] ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">
                          {CATEGORY_LABEL[c.category] ?? c.category}
                        </p>
                        <span className="text-[13px] px-1.5 py-0.5 rounded-full font-medium"
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
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Events Manager ────────────────────────────────────────────────────────────
const EVENTS_CATEGORIES = ['ประชาสัมพันธ์', 'ประชุม', 'กำหนดการ', 'อบรม', 'อื่นๆ']
const EVENTS_CATEGORY_COLOR = {
  'ประชาสัมพันธ์': '#10b981', 'ประชุม': '#3b82f6', 'กำหนดการ': '#f97316',
  'อบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
}
const AUDIENCE_OPTIONS = [
  { value: 'public',     label: 'ประชาชน',                    color: '#10b981' },
  { value: 'staff',      label: 'เทศบาล (เจ้าหน้าที่)',       color: '#3b82f6' },
  { value: 'management', label: 'ผู้บริหาร',                   color: '#8b5cf6' },
  { value: 'council',    label: 'สภาเทศบาล',                  color: '#f59e0b' },
]

function EventCard({ ev, onEdit, onDelete, deleting }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const color = EVENTS_CATEGORY_COLOR[ev.category] ?? '#6b7280'
  const d = new Date(ev.event_date + 'T00:00:00')
  const dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-3">
      <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: color }}
              >
                {ev.category}
              </span>
              {ev.audience && (() => {
                const aud = AUDIENCE_OPTIONS.find(a => a.value === ev.audience)
                return aud ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                    style={{ color: aud.color, borderColor: aud.color, backgroundColor: aud.color + '18' }}>
                    {ev.audience !== 'public' ? '🔒 ' : '👥 '}{aud.label}
                  </span>
                ) : null
              })()}
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-gray-800 leading-tight">{ev.title}</p>
              {ev.attachment_url && <Paperclip size={12} className="text-gray-400 shrink-0" />}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {dateStr}
              {!ev.is_all_day && ev.event_time
                ? ` · ${ev.event_time.slice(0, 5)}${ev.end_time ? ` – ${ev.end_time.slice(0, 5)}` : ''} น.`
                : ''}
            </p>
            {ev.location && <p className="text-xs text-gray-400 mt-0.5">📍 {ev.location}</p>}
            {ev.creator?.full_name && (
              <p className="text-xs text-gray-400 mt-0.5">✍️ {ev.creator.full_name}</p>
            )}
            {ev.description && (
              <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{ev.description}</p>
            )}
          </div>
          {onEdit && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => onEdit(ev)}
                className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <Pencil size={14} />
              </button>
              {confirmDel ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => { onDelete(ev.id); setConfirmDel(false) }}
                    disabled={deleting === ev.id}
                    className="px-2 py-1 rounded-lg bg-red-500 text-white text-xs font-bold"
                  >
                    {deleting === ev.id ? '...' : 'ลบ'}
                  </button>
                  <button
                    onClick={() => setConfirmDel(false)}
                    className="px-2 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDel(true)}
                  className="p-1.5 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EventsManager({ tenant, currentUserRole }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const emptyForm = { title: '', description: '', event_date: '', event_time: '', end_time: '', end_date: '', location: '', category: 'อื่นๆ', is_all_day: true, audience: 'public', attachment_url: '', attachment_file: null }
  const [form, setForm] = useState(emptyForm)
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterAudience, setFilterAudience] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('upcoming')
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    setCurrentPage(1)
  }, [activeTab, searchQuery, filterMonth, filterCategory, filterAudience, pageSize])

  useEffect(() => { fetchEvents() }, [tenant.id, currentUserRole])

  async function fetchEvents() {
    setLoading(true)
    let query = supabase
      .from('events')
      .select('*, creator:profiles!events_created_by_fkey(full_name)')
      .eq('municipality_id', tenant.id)
      .order('event_date', { ascending: true })
    if (currentUserRole === 'council') {
      query = query.in('audience', ['public', 'staff', 'council'])
    }
    const { data } = await query
    setEvents(data ?? [])
    setLoading(false)
  }

  function openAdd() {
    const today = new Date().toISOString().split('T')[0]
    setForm({ ...emptyForm, event_date: today })
    setEditingEvent(null)
    setShowForm(true)
  }

  function openEdit(ev) {
    setForm({
      title: ev.title,
      description: ev.description ?? '',
      event_date: ev.event_date,
      event_time: ev.event_time ?? '',
      end_date: ev.end_date ?? '',
      location: ev.location ?? '',
      category: ev.category ?? 'อื่นๆ',
      is_all_day: ev.is_all_day ?? true,
      audience: ev.audience ?? 'public',
      attachment_url: ev.attachment_url ?? '',
      attachment_file: null,
      end_time: ev.end_time ?? '',
    })
    setEditingEvent(ev)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.title.trim() || !form.event_date) return
    setSaving(true)

    let attachmentUrl = form.attachment_url || null
    if (form.attachment_file) {
      const file = form.attachment_file
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${tenant.id}/${Date.now()}_${safeName}`
      const { error: upErr } = await supabase.storage
        .from('event-attachments')
        .upload(path, file, { upsert: false })
      if (upErr) {
        setSaving(false)
        setFormError('อัปโหลดไฟล์ไม่สำเร็จ: ' + upErr.message)
        return
      }
      const { data: { publicUrl } } = supabase.storage.from('event-attachments').getPublicUrl(path)
      attachmentUrl = publicUrl
    }

    const payload = {
      municipality_id: tenant.id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      event_date: form.event_date,
      event_time: form.is_all_day ? null : (form.event_time || null),
      end_time: form.is_all_day ? null : (form.end_time || null),
      end_date: form.end_date || null,
      location: form.location.trim() || null,
      category: form.category,
      is_all_day: form.is_all_day,
      audience: form.audience,
      attachment_url: attachmentUrl,
      updated_at: new Date().toISOString(),
    }
    if (editingEvent) {
      await supabase.from('events').update(payload).eq('id', editingEvent.id)
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('events').insert({ ...payload, created_by: user?.id ?? null })
    }
    setSaving(false)
    setShowForm(false)
    fetchEvents()
  }

  async function handleDelete(id) {
    setDeleting(id)
    await supabase.from('events').delete().eq('id', id)
    setDeleting(null)
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  let filteredEvents = events
  if (filterMonth !== 'all') {
    filteredEvents = filteredEvents.filter(e => e.event_date.startsWith(filterMonth))
  }
  if (filterCategory !== 'all') {
    filteredEvents = filteredEvents.filter(e => e.category === filterCategory)
  }
  if (filterAudience !== 'all') {
    filteredEvents = filteredEvents.filter(e => e.audience === filterAudience)
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase()
    filteredEvents = filteredEvents.filter(e => e.title.toLowerCase().includes(q) || (e.description && e.description.toLowerCase().includes(q)))
  }

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const upcoming = filteredEvents.filter((e) => new Date(e.event_date + 'T00:00:00') >= now)
  const past = filteredEvents.filter((e) => new Date(e.event_date + 'T00:00:00') < now)

  const currentList = activeTab === 'upcoming' ? upcoming : [...past].reverse()
  const totalItems = currentList.length
  const totalPages = pageSize === 'all' ? 1 : Math.ceil(totalItems / pageSize)
  const paginatedList = pageSize === 'all' ? currentList : currentList.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-700">ปฏิทินกิจกรรม</h2>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={16} /> เพิ่มกิจกรรม
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อหรือรายละเอียดกิจกรรม..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="min-w-[140px]">
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกเดือน</option>
              {Array.from(new Set(events.map(e => e.event_date.slice(0, 7)))).sort().reverse().map(ym => {
                const [y, m] = ym.split('-')
                const d = new Date(Number(y), Number(m) - 1, 1)
                const label = d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
                return <option key={ym} value={ym}>{label}</option>
              })}
            </select>
          </div>
          <div className="min-w-[140px]">
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกประเภท</option>
              {EVENTS_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div className="min-w-[140px]">
            <select value={filterAudience} onChange={e => setFilterAudience(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">ทุกกลุ่มเป้าหมาย</option>
              {AUDIENCE_OPTIONS.filter((opt) => currentUserRole === 'council' ? opt.value !== 'management' : true).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {(searchQuery || filterMonth !== 'all' || filterCategory !== 'all' || filterAudience !== 'all') && (
            <button onClick={() => { setSearchQuery(''); setFilterMonth('all'); setFilterCategory('all'); setFilterAudience('all'); }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors">
              <X size={16} /> ล้าง
            </button>
          )}
        </div>
      </div>

      {showForm && (
        /* Mobile: bottom sheet  |  Desktop: centered dialog */
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-4 pb-4 md:p-6">
          <div className="w-full max-w-md md:max-w-2xl bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] md:max-h-[88vh] overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="font-bold text-gray-800">
                {editingEvent ? 'แก้ไขกิจกรรม' : 'เพิ่มกิจกรรม'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-xl hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 py-4 space-y-4">

                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อกิจกรรม *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="เช่น ประชุมสภา อบต."
                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">วันที่เริ่ม *</label>
                    <input
                      type="date"
                      value={form.event_date}
                      onChange={(e) => setForm((p) => ({ ...p, event_date: e.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">วันสิ้นสุด</label>
                    <input
                      type="date"
                      value={form.end_date}
                      onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={form.is_all_day}
                      onChange={(e) => setForm((p) => ({ ...p, is_all_day: e.target.checked, event_time: '', end_time: '' }))}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-700">ทั้งวัน</span>
                  </label>
                  {!form.is_all_day && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-1 block">เริ่ม</label>
                        <input
                          type="time"
                          value={form.event_time}
                          onChange={(e) => setForm((p) => ({ ...p, event_time: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      <span className="text-gray-400 text-sm mt-5">–</span>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-1 block">สิ้นสุด</label>
                        <input
                          type="time"
                          value={form.end_time}
                          onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">ประเภทกิจกรรม</label>
                    <div className="flex flex-wrap gap-2">
                      {EVENTS_CATEGORIES.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setForm((p) => ({ ...p, category: cat }))}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
                          style={
                            form.category === cat
                              ? { backgroundColor: EVENTS_CATEGORY_COLOR[cat], color: 'white' }
                              : { backgroundColor: '#f3f4f6', color: '#374151' }
                          }
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">กลุ่มเป้าหมาย</label>
                    <div className="grid grid-cols-2 gap-2">
                      {AUDIENCE_OPTIONS.filter((opt) => currentUserRole === 'council' ? opt.value !== 'management' : true).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setForm((p) => ({ ...p, audience: opt.value }))}
                          className="px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors border"
                          style={
                            form.audience === opt.value
                              ? { backgroundColor: opt.color, color: 'white', borderColor: opt.color }
                              : { backgroundColor: 'white', color: '#374151', borderColor: '#e5e7eb' }
                          }
                        >
                          {opt.value !== 'public' && '🔒 '}{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">สถานที่</label>
                    <input
                      value={form.location}
                      onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                      placeholder="เช่น ห้องประชุมสภา"
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-500 mb-1 block">รายละเอียด</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="รายละเอียดเพิ่มเติม..."
                      rows={3}
                      className="w-full px-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400 resize-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">เอกสารแนบ</label>
                  {form.attachment_url && !form.attachment_file ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                      <Paperclip size={14} className="text-blue-500 shrink-0" />
                      <a href={form.attachment_url} target="_blank" rel="noopener noreferrer"
                        className="flex-1 text-xs text-blue-600 font-medium truncate hover:underline">
                        ดูไฟล์แนบปัจจุบัน
                      </a>
                      <button type="button"
                        onClick={() => setForm((p) => ({ ...p, attachment_url: '' }))}
                        className="p-1 rounded-lg hover:bg-blue-100 text-red-400 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                  ) : form.attachment_file ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-100 rounded-xl">
                      <Paperclip size={14} className="text-green-500 shrink-0" />
                      <span className="flex-1 text-xs text-green-700 font-medium truncate">{form.attachment_file.name}</span>
                      <button type="button"
                        onClick={() => setForm((p) => ({ ...p, attachment_file: null }))}
                        className="p-1 rounded-lg hover:bg-green-100 text-red-400 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
                      <Paperclip size={15} className="text-gray-400 shrink-0" />
                      <span className="text-sm text-gray-400">แนบ PDF หรือรูปภาพ (สูงสุด 20 MB)</span>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                        onChange={(e) => setForm((p) => ({ ...p, attachment_file: e.target.files?.[0] ?? null }))} />
                    </label>
                  )}
                </div>

                {formError && <p className="text-xs text-red-500">{formError}</p>}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 shrink-0">
              <div className="px-6 py-4 flex gap-3">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.title.trim() || !form.event_date}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10 text-gray-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex bg-gray-100 p-1 rounded-xl w-fit">
              <button
                onClick={() => setActiveTab('upcoming')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'upcoming' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                กิจกรรมที่จะมาถึง ({upcoming.length})
              </button>
              <button
                onClick={() => setActiveTab('past')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'past' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                กิจกรรมที่ผ่านมา ({past.length})
              </button>
            </div>

            {paginatedList.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 bg-white px-3 py-2 rounded-xl border border-gray-100 shadow-sm w-fit">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>แสดง</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value="all">ทั้งหมด</option>
                  </select>
                  <span>รายการ</span>
                </div>
                
                {pageSize !== 'all' && totalPages > 1 && (
                  <div className="flex items-center gap-1 border-l pl-4 border-gray-100">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-medium text-gray-700 px-2">
                      หน้า {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            {paginatedList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
                {activeTab === 'upcoming' ? 'ยังไม่มีกิจกรรม กด "เพิ่มกิจกรรม" เพื่อเริ่มต้น' : 'ยังไม่มีกิจกรรมที่ผ่านมา'}
              </div>
            ) : (
              <div className={`space-y-2 ${activeTab === 'past' ? 'opacity-80' : ''}`}>
                {paginatedList.map((ev) => (
                  <EventCard key={ev.id} ev={ev} onEdit={openEdit} onDelete={handleDelete} deleting={deleting} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tourism Manager ───────────────────────────────────────────────────────────
const TOUR_CATS = [
  { key: 'travel',  label: 'เที่ยว', emoji: '🏛️', color: '#d97706' },
  { key: 'food',    label: 'กิน',    emoji: '🍽️', color: '#10b981' },
  { key: 'stay',    label: 'พัก',    emoji: '🏨', color: '#3b82f6' },
  { key: 'shop',    label: 'ชอบ',   emoji: '🛍️', color: '#ec4899' },
  { key: 'service', label: 'บริการ', emoji: '🔧', color: '#dc2626' },
]

async function compressImage(file, maxPx = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        const scale = img.naturalWidth > maxPx ? maxPx / img.naturalWidth : 1
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.naturalWidth  * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })), 'image/jpeg', quality)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

const EMPTY_FORM = { name: '', category: 'travel', description: '', phone: '', address: '', maps_url: '', service_type: 'offline', online_service: 'order', online_url: '', has_delivery: false }

function TourismReviewsAdmin({ tenant }) {
  const [reviews, setReviews] = useState([])
  const [places,  setPlaces]  = useState([])
  const [loading, setLoading] = useState(true)
  const [filterRating, setFilterRating] = useState(0)
  const [deleting, setDeleting] = useState(null)

  async function fetchData() {
    if (!tenant?.id) return
    setLoading(true)
    const [{ data: rv }, { data: pl }] = await Promise.all([
      supabase.from('tourism_reviews').select('*').eq('municipality_id', tenant.id).order('created_at', { ascending: false }),
      supabase.from('tourism_places').select('id, name').eq('municipality_id', tenant.id),
    ])
    setReviews(rv ?? [])
    setPlaces(pl ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [tenant?.id])

  const placeMap = Object.fromEntries((places ?? []).map(p => [p.id, p.name]))

  async function handleDelete(id) {
    if (!window.confirm('ลบรีวิวนี้ออกจากระบบ?')) return
    setDeleting(id)
    await supabase.from('tourism_reviews').delete().eq('id', id)
    setDeleting(null)
    setReviews(prev => prev.filter(r => r.id !== id))
  }

  const filtered = filterRating > 0 ? reviews.filter(r => r.rating === filterRating) : reviews
  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '—'

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Star size={18} style={{ color: '#f59e0b' }} />
            รีวิวสถานที่ท่องเที่ยว
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{reviews.length} รีวิว · คะแนนเฉลี่ย {avgRating}</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {[0,5,4,3,2,1].map(r => (
            <button key={r} onClick={() => setFilterRating(r)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${filterRating === r ? 'text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              style={filterRating === r ? { backgroundColor: '#f59e0b' } : {}}>
              {r === 0 ? 'ทั้งหมด' : `${r}★`}
            </button>
          ))}
        </div>
        <button onClick={fetchData} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">ไม่พบรีวิว</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const date = new Date(r.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-semibold tracking-wider" style={{ color: '#f59e0b' }}>
                      {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="font-semibold text-gray-700">{placeMap[r.place_id] ?? '—'}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-500">{r.reviewer_name ?? 'ไม่ระบุชื่อ'}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400">{date}</span>
                  </div>
                  {r.comment && <p className="text-sm text-gray-600 mt-1 leading-snug">{r.comment}</p>}
                </div>
                <button onClick={() => handleDelete(r.id)} disabled={deleting === r.id}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors shrink-0">
                  {deleting === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TourismManager({ tenant }) {
  const [places, setPlaces]             = useState([])
  const [loading, setLoading]           = useState(true)
  const [sheet, setSheet]               = useState(null)   // null | 'add' | placeId (edit)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [saving, setSaving]             = useState(false)
  const [uploadingFor, setUploadingFor] = useState(null)
  const [mgTab, setMgTab]               = useState('places')
  const [pendingCount, setPendingCount]  = useState(0)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('tourism_places').select('*').eq('municipality_id', tenant.id)
      .order('display_order')
      .then(({ data }) => { setPlaces(data ?? []); setLoading(false) })
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('business_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('municipality_id', tenant.id)
      .eq('status', 'pending')
      .then(({ count }) => setPendingCount(count ?? 0))
  }, [tenant?.id])

  const sheetPlace = sheet && sheet !== 'add' ? places.find(p => p.id === sheet) : null
  const sheetAllImgs = sheetPlace ? [sheetPlace.image_url, ...(sheetPlace.gallery ?? [])].filter(Boolean) : []

  function openAdd() { setForm(EMPTY_FORM); setSheet('add') }
  function openEdit(place) { setForm({ name: place.name, category: place.category, description: place.description || '', phone: place.phone || '', address: place.address || '', maps_url: place.maps_url || '', service_type: place.service_type || 'offline', online_service: place.online_service || 'order', online_url: place.online_url || '', has_delivery: place.has_delivery ?? false }); setSheet(place.id) }
  function closeSheet() { setSheet(null) }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const onlineFields = form.service_type !== 'offline'
      ? { service_type: form.service_type, online_service: form.online_service, online_url: form.online_url.trim() || null, has_delivery: form.has_delivery }
      : { service_type: 'offline', online_service: null, online_url: null, has_delivery: false }
    if (sheet === 'add') {
      const { data } = await supabase.from('tourism_places').insert({
        municipality_id: tenant.id, name: form.name.trim(), category: form.category,
        description: form.description.trim() || null, phone: form.phone.trim() || null,
        address: form.address.trim() || null, maps_url: form.maps_url.trim() || null,
        is_active: true, display_order: places.length, gallery: [], ...onlineFields,
      }).select().single()
      if (data) { setPlaces(prev => [...prev, data]); setSheet(data.id) }
    } else {
      await supabase.from('tourism_places').update({
        name: form.name.trim(), category: form.category,
        description: form.description.trim() || null, phone: form.phone.trim() || null,
        address: form.address.trim() || null, maps_url: form.maps_url.trim() || null, ...onlineFields,
      }).eq('id', sheet)
      setPlaces(prev => prev.map(p => p.id === sheet ? { ...p, ...form, ...onlineFields } : p))
      closeSheet()
    }
    setSaving(false)
  }

  async function toggleActive(place, e) {
    e.stopPropagation()
    await supabase.from('tourism_places').update({ is_active: !place.is_active }).eq('id', place.id)
    setPlaces(prev => prev.map(p => p.id === place.id ? { ...p, is_active: !p.is_active } : p))
  }

  async function handleDelete() {
    if (!sheetPlace || !window.confirm(`ลบ "${sheetPlace.name}" ออกจากรายการ?`)) return
    await supabase.from('tourism_places').delete().eq('id', sheetPlace.id)
    setPlaces(prev => prev.filter(p => p.id !== sheetPlace.id))
    closeSheet()
  }

  const MAX_IMAGES = 5

  async function uploadImages(placeId, files) {
    const place = places.find(p => p.id === placeId)
    if (!place) return
    const current = [place.image_url, ...(place.gallery ?? [])].filter(Boolean).length
    const allowed = files.slice(0, Math.max(0, MAX_IMAGES - current))
    if (allowed.length === 0) return
    setUploadingFor(placeId)
    for (const rawFile of allowed) {
      const compressed = await compressImage(rawFile)
      const path = `tourism/${placeId}/photo_${Date.now()}.jpg`
      const { error } = await supabase.storage.from('complaint-attachments').upload(path, compressed, { upsert: true })
      if (error) continue
      const { data: urlData } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
      const url = urlData.publicUrl
      await supabase.from('tourism_places').select('image_url, gallery').eq('id', placeId).single()
        .then(async ({ data: fresh }) => {
          if (!fresh?.image_url) {
            await supabase.from('tourism_places').update({ image_url: url }).eq('id', placeId)
            setPlaces(prev => prev.map(p => p.id === placeId ? { ...p, image_url: url } : p))
          } else {
            const gallery = [...(fresh.gallery ?? []), url]
            await supabase.from('tourism_places').update({ gallery }).eq('id', placeId)
            setPlaces(prev => prev.map(p => p.id === placeId ? { ...p, gallery } : p))
          }
        })
    }
    setUploadingFor(null)
  }

  async function removeImage(url) {
    const place = sheetPlace
    if (!place) return
    if (place.image_url === url) {
      const gallery = place.gallery ?? []
      const newPrimary = gallery[0] ?? null
      const newGallery = gallery.slice(1)
      await supabase.from('tourism_places').update({ image_url: newPrimary, gallery: newGallery }).eq('id', place.id)
      setPlaces(prev => prev.map(p => p.id === place.id ? { ...p, image_url: newPrimary, gallery: newGallery } : p))
    } else {
      const newGallery = (place.gallery ?? []).filter(u => u !== url)
      await supabase.from('tourism_places').update({ gallery: newGallery }).eq('id', place.id)
      setPlaces(prev => prev.map(p => p.id === place.id ? { ...p, gallery: newGallery } : p))
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'
  const isAdd = sheet === 'add'

  return (
    <div className="space-y-4">
      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 pb-3 border-b border-gray-100">
        <button onClick={() => setMgTab('places')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl transition-colors"
          style={mgTab === 'places' ? { backgroundColor: 'var(--color-primary)', color: '#fff' } : { color: '#64748b' }}>
          <Luggage size={14} /> สถานที่ทั้งหมด
        </button>
        <button onClick={() => setMgTab('requests')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl transition-colors"
          style={mgTab === 'requests' ? { backgroundColor: '#d97706', color: '#fff' } : { color: '#64748b' }}>
          <Store size={14} /> คำขอลงทะเบียน
          {pendingCount > 0 && (
            <span className="ml-1 text-[11px] font-bold px-1.5 rounded-full bg-red-500 text-white">{pendingCount}</span>
          )}
        </button>
        {mgTab === 'places' && (
          <button onClick={openAdd}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={15} /> เพิ่มรายการใหม่
          </button>
        )}
      </div>

      {mgTab === 'requests' ? (
        <BusinessRegistrationAdmin tenant={tenant} />
      ) : loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
      ) : places.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">ยังไม่มีรายการ</p>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-2">
            {places.map(place => {
              const cat = TOUR_CATS.find(c => c.key === place.category)
              const imgCount = [place.image_url, ...(place.gallery ?? [])].filter(Boolean).length
              return (
                <div key={place.id}
                  className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-opacity ${!place.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center text-xl">
                      {place.image_url ? <img src={place.image_url} alt="" className="w-full h-full object-cover" /> : (cat?.emoji || '')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="inline-block text-[11px] font-bold px-1.5 py-0.5 rounded-md text-white mb-0.5"
                            style={{ backgroundColor: cat?.color ?? '#64748b' }}>
                        {cat?.emoji} {cat?.label}
                      </span>
                      <p className="text-sm font-semibold text-gray-800 truncate">{place.name}</p>
                      <p className="text-xs text-gray-400">{imgCount} รูป · {place.is_active ? 'แสดงอยู่' : 'ซ่อนอยู่'}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={e => toggleActive(place, e)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${place.is_active ? 'bg-green-400' : 'bg-gray-300'}`}>
                        {place.is_active ? '✓' : '—'}
                      </button>
                      <button onClick={() => openEdit(place)}
                        className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                        <Pencil size={14} className="text-blue-500" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ชื่อสถานที่</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 w-20">รูปภาพ</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 w-24">สถานะ</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {places.map((place, i) => {
                  const cat = TOUR_CATS.find(c => c.key === place.category)
                  const imgCount = [place.image_url, ...(place.gallery ?? [])].filter(Boolean).length
                  return (
                    <tr key={place.id} className={`hover:bg-gray-50 transition-colors ${!place.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center text-base">
                            {place.image_url ? <img src={place.image_url} alt="" className="w-full h-full object-cover" /> : (cat?.emoji || '')}
                          </div>
                          <span className="font-medium text-gray-800">{place.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md text-white"
                          style={{ backgroundColor: cat?.color ?? '#64748b' }}>
                          {cat?.emoji} {cat?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">{imgCount} รูป</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={e => toggleActive(place, e)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full ${place.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {place.is_active ? 'แสดงอยู่' : 'ซ่อนอยู่'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => openEdit(place)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                            <Pencil size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── Bottom Sheet ─── */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={closeSheet}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full bg-white rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col"
               onClick={e => e.stopPropagation()}>

            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-gray-100">
              <h3 className="font-bold text-gray-800">
                {isAdd ? 'เพิ่มรายการใหม่' : `แก้ไข: ${sheetPlace?.name ?? ''}`}
              </h3>
              <button onClick={closeSheet} className="p-1.5 rounded-xl hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Image gallery (edit mode only) */}
              {!isAdd && (
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                    รูปภาพ ({sheetAllImgs.length}/{MAX_IMAGES})
                    {uploadingFor === sheetPlace?.id && <span className="ml-2 text-blue-500 normal-case font-normal">กำลังอัปโหลด...</span>}
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                    {sheetAllImgs.map((url, idx) => (
                      <div key={url} className="relative shrink-0 w-24 h-24">
                        <img src={url} alt="" className="w-full h-full object-cover rounded-xl" />
                        {idx === 0 && <span className="absolute bottom-1 left-1 text-[9px] bg-yellow-400 text-white px-1.5 py-0.5 rounded-full font-bold">หลัก</span>}
                        <button onClick={() => removeImage(url)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shadow">
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                    ))}
                    {sheetAllImgs.length < MAX_IMAGES && (
                      <label className={`shrink-0 w-24 h-24 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${uploadingFor === sheetPlace?.id ? 'opacity-50 cursor-wait border-gray-200' : 'border-gray-300 hover:border-blue-400'}`}>
                        {uploadingFor === sheetPlace?.id
                          ? <Loader2 size={20} className="animate-spin text-gray-400" />
                          : <><Camera size={20} className="text-gray-400" /><span className="text-[11px] text-gray-400">เพิ่มรูป</span></>}
                        <input type="file" accept="image/*" multiple className="hidden"
                          disabled={uploadingFor === sheetPlace?.id}
                          onChange={e => uploadImages(sheetPlace.id, [...e.target.files])} />
                      </label>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">รูปแรก = รูปหน้าปก · รูปใหญ่ถูกบีบอัตโนมัติ</p>
                </div>
              )}

              {/* Form fields */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">ข้อมูล</p>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="ชื่อสถานที่ / ร้านอาหาร / ที่พัก *" className={inputCls} />
                <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inputCls}>
                  {TOUR_CATS.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
                </select>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="คำอธิบาย / ข้อมูลน่าสนใจ / ประวัติความเป็นมา..." rows={4}
                  className={inputCls + ' resize-none'} />
                <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="เบอร์โทรศัพท์" className={inputCls} />
                <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                  placeholder="ที่อยู่ / หมู่ที่ / ตำบล" className={inputCls} />
                <input value={form.maps_url} onChange={e => setForm(p => ({ ...p, maps_url: e.target.value }))}
                  placeholder="ลิงก์ Google Maps" className={inputCls} />
              </div>

              {/* Online service toggle */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">บริการออนไลน์</p>
                <div className="flex flex-col gap-1.5">
                  {[
                    { v: 'offline',     label: '📍 ออฟไลน์ (มีหน้าร้าน)' },
                    { v: 'online',      label: '⚡ ออนไลน์ + มีหน้าร้าน' },
                    { v: 'online_only', label: '🏪 ตลาดออนไลน์ (ไม่มีหน้าร้าน)' },
                  ].map(({ v, label }) => {
                    const colors = v === 'online' ? { bg: '#dcfce7', color: '#15803d', border: '#86efac' }
                                 : v === 'online_only' ? { bg: '#ede9fe', color: '#7c3aed', border: '#c4b5fd' }
                                 : { bg: '#f1f5f9', color: '#374151', border: '#e2e8f0' }
                    const active = form.service_type === v
                    return (
                      <button key={v} type="button"
                        onClick={() => setForm(p => ({ ...p, service_type: v }))}
                        className="py-2 px-3 rounded-xl text-sm font-semibold border text-left transition-all"
                        style={active
                          ? { backgroundColor: colors.bg, color: colors.color, borderColor: colors.border }
                          : { backgroundColor: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}>
                        {label}
                      </button>
                    )
                  })}
                </div>
                {form.service_type !== 'offline' && (
                  <div className="space-y-2 p-3 bg-green-50 rounded-xl border border-green-100">
                    <select value={form.online_service} onChange={e => setForm(p => ({ ...p, online_service: e.target.value }))} className={inputCls}>
                      <option value="order">🛒 สั่งซื้อสินค้า</option>
                      <option value="book">📅 จองที่พัก / บริการ</option>
                      <option value="line">💬 ติดต่อผ่าน Line</option>
                      <option value="website">🌐 เว็บไซต์</option>
                    </select>
                    <input value={form.online_url} onChange={e => setForm(p => ({ ...p, online_url: e.target.value }))}
                      placeholder="ลิงก์ / Line ID / URL" className={inputCls} />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.has_delivery}
                        onChange={e => setForm(p => ({ ...p, has_delivery: e.target.checked }))}
                        className="w-4 h-4 rounded accent-green-500" />
                      <span className="text-sm text-gray-700">🛵 มีบริการส่งถึงบ้าน</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pb-2">
                <button onClick={handleSave} disabled={saving || !form.name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {isAdd ? 'เพิ่มรายการ' : 'บันทึก'}
                </button>
                {!isAdd && (
                  <button onClick={handleDelete}
                    className="px-4 py-3 rounded-xl bg-red-50 text-red-500 text-sm font-semibold">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
const PAGE_LABELS = {
  complaints: 'รายการคำร้อง',
  staff: 'รูปผู้บริหาร',
  tourism: 'เที่ยว กิน พัก ชอบ',
  'tourism-reviews': 'รีวิวสถานที่',
  events: 'กิจกรรม',
  'doc-requests': 'คำขอเอกสาร',
  report: 'รายงานสรุป',
  'business-register': 'ลงทะเบียนธุรกิจ',
  categories: 'ประเภทคำร้อง',
  'fee-settings': 'ค่าธรรมเนียม',
  assignments: 'ผู้รับผิดชอบ',
  emergency: 'สายด่วน',
  locations: 'สถานที่เกิดเหตุ',
  'system-settings': 'ตั้งค่าระบบ',
  users: 'จัดการผู้ใช้',
  modules: 'จัดการโมดูล',
  map: 'แผนที่คำร้อง',
  'civil-project': 'โครงการโยธา',
  'civil-report': 'รายงานโยธา',
}

export default function AdminDashboard() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const location = useLocation()
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [filterTab, setFilterTab] = useState(0)
  const [search, setSearch] = useState('')
  const [complaintPage, setComplaintPage] = useState(1)
  const [complaintsPerPage, setComplaintsPerPage] = useState(10)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterVillage, setFilterVillage] = useState('')
  const [filterTechnician, setFilterTechnician] = useState('')
  const [activePage, setActivePage] = useState(location.state?.page ?? 'complaints')
  const [currentUserRole, setCurrentUserRole] = useState(null)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [selectedComplaint, setSelectedComplaint] = useState(null)
  const [technicians, setTechnicians] = useState([])

  const { supported: pushSupported, permission: pushPermission, subscribed: pushSubscribed,
          loading: pushLoading, requestAndSubscribe: pushSubscribe, unsubscribe: pushUnsubscribe,
  } = usePushNotification({ userId: currentUserId, municipalityId: tenant?.id })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      setCurrentUserId(data.session.user.id)
      supabase.from('profiles').select('role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          const r = p?.role ?? 'citizen'
          setCurrentUserRole(r)
          if (r === 'viewer' && !location.state?.page) setActivePage('report')
          if (r === 'council' && !location.state?.page) setActivePage('events')
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
    const matchCategory = filterCategory === '' || c.category === filterCategory
    const matchVillage = filterVillage === '' || (c.village || c.location_name || '') === filterVillage
    const matchTech = filterTechnician === '' ||
      (filterTechnician === '__none__' ? !c.assigned_to : c.assigned_to === filterTechnician)
    return matchStatus && matchSearch && matchCategory && matchVillage && matchTech
  })

  // Build options with counts (computed from status+search filtered, before category/village/tech filters)
  const baseFiltered = complaints.filter((c) => {
    const matchStatus = FILTER_KEYS[filterTab] ? c.status === FILTER_KEYS[filterTab] : true
    const matchSearch = search === '' ||
      c.detail.includes(search) ||
      (CATEGORY_LABEL[c.category] ?? '').includes(search) ||
      (c.phone ?? '').includes(search)
    return matchStatus && matchSearch
  })

  const categoryOptions = Object.entries(
    baseFiltered.reduce((acc, c) => { acc[c.category] = (acc[c.category] || 0) + 1; return acc }, {})
  ).sort((a, b) => b[1] - a[1])

  const villageOptions = Object.entries(
    baseFiltered.reduce((acc, c) => {
      const v = c.village || c.location_name
      if (v) acc[v] = (acc[v] || 0) + 1
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1])

  const techOptions = (() => {
    const assigned = baseFiltered.filter(c => c.assigned_to)
    const unassigned = baseFiltered.filter(c => !c.assigned_to)
    const byTech = assigned.reduce((acc, c) => { acc[c.assigned_to] = (acc[c.assigned_to] || 0) + 1; return acc }, {})
    const opts = Object.entries(byTech)
      .map(([id, count]) => ({ id, name: technicians.find(t => t.id === id)?.full_name ?? 'ช่าง', count }))
      .sort((a, b) => b.count - a.count)
    return { opts, unassignedCount: unassigned.length }
  })()

  const perPage = complaintsPerPage === 'all' ? filtered.length : complaintsPerPage
  const complaintTotalPages = perPage > 0 ? Math.max(1, Math.ceil(filtered.length / perPage)) : 1
  const complaintStartIdx = (complaintPage - 1) * perPage
  const paginatedFiltered = complaintsPerPage === 'all' ? filtered : filtered.slice(complaintStartIdx, complaintStartIdx + perPage)

  // Reset to page 1 when any filter changes
  useEffect(() => { setComplaintPage(1) }, [filterTab, search, complaintsPerPage, filterCategory, filterVillage, filterTechnician])

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
<div class="footer">ออกจากระบบบริการออนไลน์ SmartLocal</div>
</body></html>`

    const w = window.open('', '_blank', 'width=1100,height=700')
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }


  return (
    <div className="md:flex md:min-h-screen" style={{ backgroundColor: '#eef2f7' }}>

      {/* ─── Desktop Sidebar — government style ─── */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 sticky top-0 self-start h-screen overflow-y-auto shadow-lg"
        style={{ backgroundColor: '#1a3a5c', borderRight: '1px solid #12293f' }}>
        {/* Brand */}
        <div className="px-4 py-4 border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.38)' }}>แผงควบคุม Admin</p>
          <p className="font-bold text-white text-sm leading-snug">{tenant?.name}</p>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {[
            {
              group: null,
              items: [
                { key: 'home', label: 'หน้าแรก', Icon: Home, color: '#64748b', show: true, isLink: true },
              ],
            },
            {
              group: 'จัดการเนื้อหา',
              items: [
                { key: 'staff',            label: 'รูปผู้บริหาร',       Icon: UserCircle2, color: '#7c3aed', show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
                { key: 'tourism',          label: 'เที่ยว กิน พัก ชอบ', Icon: Luggage,     color: '#d97706', show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
                { key: 'tourism-reviews',  label: 'รีวิวสถานที่',        Icon: Star,         color: '#f59e0b', show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
                { key: 'business-register', label: 'ลงทะเบียนธุรกิจ',   Icon: Store,        color: '#d97706', show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
              ],
            },
            {
              group: 'ตั้งค่าระบบ',
              items: [
                { key: 'categories',  label: 'ประเภทคำร้อง', Icon: Tag,      color: '#d97706', show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
                { key: 'fee-settings', label: 'ค่าธรรมเนียม', Icon: Banknote, color: '#10b981', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                { key: 'assignments', label: 'ผู้รับผิดชอบ', Icon: Wrench,   color: '#d97706', show: currentUserRole !== 'council' },
                { key: 'emergency',   label: 'สายด่วน',       Icon: Phone,    color: '#ef4444', show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
                { key: 'locations',   label: 'สถานที่เกิดเหตุ', Icon: MapPin, color: '#0891b2', show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
                { key: 'system-settings', label: 'ตั้งค่าระบบ',  Icon: Settings,    color: '#3b82f6', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                { key: 'users',           label: 'จัดการผู้ใช้', Icon: Shield,      color: '#7c3aed', show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                { key: 'modules',         label: 'จัดการโมดูล', Icon: LayoutGrid,   color: '#7c3aed', show: currentUserRole === 'superadmin' },
              ],
            },
            {
              group: 'ทรัพยากร',
              items: [
                { key: 'manual', label: 'คู่มือผู้ดูแล', Icon: BookOpen, color: '#059669', show: true, isExternal: true, href: '/manual-admin.html' },
              ],
            },
          ].map(({ group, items }) => {
            const visible = items.filter(i => i.show)
            if (visible.length === 0) return null
            return (
              <div key={group ?? '_top'} className="mb-3">
                {group && (
                  <p className="text-[10px] font-bold uppercase tracking-widest px-3 pt-1 pb-1.5"
                    style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {group}
                  </p>
                )}
                <div className="space-y-0.5">
                  {visible.map(({ key, label, Icon, color, isLink, isExternal, href }) => {
                    const isActive = activePage === key
                    const baseCls = 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors'
                    if (isExternal) return (
                      <a key={key} href={href} target="_blank" rel="noopener noreferrer"
                        className={`${baseCls} font-medium hover:bg-white/10`}
                        style={{ color: 'rgba(255,255,255,0.55)' }}>
                        <Icon size={16} />
                        <span className="flex-1 text-left">{label}</span>
                        <ExternalLink size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                      </a>
                    )
                    if (isLink) return (
                      <button key={key} onClick={() => navigate('/')}
                        className={`${baseCls} font-medium hover:bg-white/10`}
                        style={{ color: 'rgba(255,255,255,0.55)' }}>
                        <Icon size={16} />
                        {label}
                      </button>
                    )
                    return (
                      <button key={key} onClick={() => setActivePage(key)}
                        className={`${baseCls} font-semibold`}
                        style={isActive
                          ? { backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff' }
                          : { color: 'rgba(255,255,255,0.6)' }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)' }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = '' }}>
                        <Icon size={16} style={isActive ? { color: '#fff' } : { color: 'rgba(255,255,255,0.55)' }} />
                        <span className="flex-1 text-left">{label}</span>
                        {isActive && <span className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.6)' }} />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Logout */}
        <div className="px-2 py-3 shrink-0 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <button onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.55)' }}>
            <LogOut size={16} />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <div className="flex-1 min-w-0 px-4 py-4 pb-24 md:py-6 md:pb-8 md:px-8 space-y-4 md:space-y-6">
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

      {/* PC header — government style */}
      <div className="hidden md:block shrink-0 -mx-8 -mt-6 mb-6">
        {/* Breadcrumb strip */}
        <div className="px-8 py-1.5 flex items-center justify-between border-b"
          style={{ backgroundColor: '#dce8f5', borderColor: '#b8cfea' }}>
          <p className="text-[11px] text-gray-600">
            ระบบบริการอิเล็กทรอนิกส์ › {tenant?.name ?? ''} ›{' '}
            <span className="font-semibold text-gray-700">
              {PAGE_LABELS[activePage] ?? activePage}
            </span>
          </p>
          <p className="text-[11px] text-gray-500">
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {/* Title bar */}
        <div className="px-8 py-3 flex items-center justify-between bg-white border-b border-gray-200 shadow-sm">
          <div>
            <h1 className="text-base font-bold text-gray-800">{PAGE_LABELS[activePage] ?? 'แผงควบคุม'}</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">{tenant?.name} — แผงควบคุมผู้ดูแลระบบ</p>
          </div>
          <div className="flex items-center gap-3">
            {activePage === 'complaints' && (
              <button onClick={fetchComplaints} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                รีเฟรช
              </button>
            )}
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: '#1a3a5c' }}>
              A
            </div>
          </div>
        </div>
      </div>

      {/* Page header — mobile only */}
      <div className="md:hidden flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">แผงควบคุมผู้ดูแลระบบ</h1>
          <p className="text-sm text-gray-400 md:hidden">{tenant?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {activePage === 'complaints' && (
            <button onClick={fetchComplaints} disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              รีเฟรช
            </button>
          )}
          <div className="md:hidden flex items-center gap-2">
            <button onClick={() => navigate('/')}
              className="p-2 rounded-xl text-gray-400 border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
              <Home size={15} />
            </button>
            <button onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-500 bg-white hover:bg-red-50 transition-colors">
              <LogOut size={15} />
              ออก
            </button>
          </div>
        </div>
      </div>

      {/* Push notification opt-in banner — complaints page only */}
      {activePage === 'complaints' && pushSupported && pushPermission !== 'denied' && !pushSubscribed && (
        <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-3">
            <Bell size={18} className="text-blue-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800">เปิดการแจ้งเตือนคำร้องใหม่</p>
              <p className="text-xs text-blue-600">รับแจ้งทันทีเมื่อประชาชนส่งคำร้องเข้ามา</p>
            </div>
          </div>
          <button onClick={pushSubscribe} disabled={pushLoading}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
            {pushLoading ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
            เปิดแจ้งเตือน
          </button>
        </div>
      )}
      {activePage === 'complaints' && pushSubscribed && (
        <div className="flex items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-3">
            <Bell size={18} className="text-green-500 shrink-0" />
            <p className="text-sm font-medium text-green-800">เปิดการแจ้งเตือนแล้ว — รับแจ้งคำร้องใหม่อัตโนมัติ</p>
          </div>
          <button onClick={pushUnsubscribe} disabled={pushLoading}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white border border-green-300 text-green-700 text-sm font-medium rounded-xl hover:bg-green-50 transition-colors disabled:opacity-50">
            {pushLoading ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />}
            ปิด
          </button>
        </div>
      )}

      {/* Tab navigation — replaced by sidebar on desktop */}
      <div className="hidden">
        {currentUserRole === 'viewer' && (
          <button onClick={() => setActivePage('report')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'report' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'report' ? { backgroundColor: '#10b981' } : {}}>
            <TrendingUp size={15} /> รายงาน
          </button>
        )}
        {currentUserRole !== 'council' && (
          <button onClick={() => setActivePage('complaints')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'complaints' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'complaints' ? { backgroundColor: 'var(--color-primary)' } : {}}>
            <ClipboardList size={15} /> คำร้อง
          </button>
        )}
        {currentUserRole !== 'viewer' && currentUserRole !== 'council' && (
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
        {currentUserRole !== 'council' && (
          <button onClick={() => setActivePage('assignments')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'assignments' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'assignments' ? { backgroundColor: '#d97706' } : {}}>
            <Wrench size={15} /> ผู้รับผิดชอบ
          </button>
        )}
        {currentUserRole !== 'viewer' && currentUserRole !== 'council' && (
          <button onClick={() => setActivePage('report')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'report' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            style={activePage === 'report' ? { backgroundColor: '#10b981' } : {}}>
            <TrendingUp size={15} /> รายงาน
          </button>
        )}
        <button onClick={() => setActivePage('events')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activePage === 'events' ? 'text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          style={activePage === 'events' ? { backgroundColor: '#10b981' } : {}}>
          <CalendarDays size={15} /> กิจกรรม
        </button>
        {currentUserRole !== 'viewer' && currentUserRole !== 'council' && (
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
          { key: 'complaints', label: 'คำร้อง',  Icon: ClipboardList, activeColor: 'var(--color-primary)', show: currentUserRole !== 'council' && currentUserRole !== 'viewer' },
          { key: 'events',     label: 'กิจกรรม', Icon: CalendarDays,  activeColor: '#10b981',              show: true },
          { key: 'report',     label: 'รายงานคำร้อง',  Icon: TrendingUp,    activeColor: '#10b981',              show: currentUserRole !== 'council' },
          { key: 'map',        label: 'แผนที่',  Icon: MapPin,        activeColor: '#3b82f6',              show: currentUserRole !== 'council' },
          { key: 'more',       label: 'อื่นๆ',   Icon: LayoutGrid,    activeColor: '#6b7280',              show: true },
        ].filter(i => i.show).map(({ key, label, Icon, activeColor }) => {
          const isActive = activePage === key
          return (
            <button
              key={key}
              onClick={() => setActivePage(key)}
              className="relative flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-transform active:scale-90"
            >
              {isActive && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full" style={{ backgroundColor: activeColor }} />
              )}
              <Icon size={22} style={{ color: isActive ? activeColor : '#9ca3af' }} strokeWidth={isActive ? 2.5 : 1.8} />
              <span className="text-[11px] font-semibold leading-tight" style={{ color: isActive ? activeColor : '#9ca3af' }}>
                {label}
              </span>
            </button>
          )
        })}
      </div>

      {activePage === 'events' ? (
        <EventsManagerComponent tenant={tenant} currentUserRole={currentUserRole} />
      ) : activePage === 'report' ? (
        <ReportManagerComponent complaints={complaints} tenant={tenant} technicians={technicians} />
      ) : activePage === 'staff' ? (
        <StaffManager tenant={tenant} />
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
      ) : activePage === 'civil-report' ? (
        <CivilProjectReport tenant={tenant} />
      ) : activePage === 'infra' ? (
        <CivilProjectReport tenant={tenant} />
      ) : activePage === 'map' ? (
        <MapDashboardAdmin tenant={tenant} currentUserRole={currentUserRole}
          onNavigate={(page) => setActivePage(page)} />
      ) : activePage === 'tourism' ? (
        <TourismManager tenant={tenant} />
      ) : activePage === 'tourism-reviews' ? (
        <TourismReviewsAdmin tenant={tenant} />
      ) : activePage === 'business-register' ? (
        <BusinessRegistrationAdmin tenant={tenant} />
      ) : activePage === 'fee-settings' ? (
        <FeeSettingsAdmin tenant={tenant} />
      ) : activePage === 'system-settings' ? (
        <SystemSettingsAdmin tenant={tenant} onUpdateTenant={(updated) => window.location.reload()} />
      ) : activePage === 'more' ? (
        /* ─── อื่นๆ page ─── */
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">เมนูเพิ่มเติม</h2>

          {/* Mobile: icon grid */}
          <div className="md:hidden grid grid-cols-2 gap-3">
            {currentUserRole !== 'viewer' && (
              <button onClick={() => setActivePage('categories')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fef3c7' }}>
                  <Tag size={24} style={{ color: '#d97706' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">ประเภทคำร้อง</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">จัดการหมวดหมู่</p>
                </div>
              </button>
            )}
            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
              <button onClick={() => setActivePage('users')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#ede9fe' }}>
                  <Shield size={24} style={{ color: '#7c3aed' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">จัดการผู้ใช้</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">สิทธิ์และบทบาท</p>
                </div>
              </button>
            )}
            <button onClick={() => setActivePage('assignments')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fef3c7' }}>
                <Wrench size={24} style={{ color: '#d97706' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">ผู้รับผิดชอบ</p>
                <p className="text-[13px] text-gray-400 mt-0.5">มอบหมายประเภทคำร้อง</p>
              </div>
            </button>
            <button onClick={() => setActivePage('emergency')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fee2e2' }}>
                <Phone size={24} style={{ color: '#ef4444' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">สายด่วนฉุกเฉิน</p>
                <p className="text-[13px] text-gray-400 mt-0.5">จัดการเบอร์ติดต่อ</p>
              </div>
            </button>
            <button onClick={() => setActivePage('tourism')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fef3c7' }}>
                <span className="text-2xl">🏛️</span>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">เที่ยว กิน พัก ชอบ</p>
                <p className="text-[13px] text-gray-400 mt-0.5">ท่องเที่ยว ร้านค้า บริการ</p>
              </div>
            </button>
            {currentUserRole !== 'viewer' && currentUserRole !== 'council' && (
              <button onClick={() => setActivePage('tourism-reviews')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fef3c7' }}>
                  <Star size={24} style={{ color: '#f59e0b' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">รีวิวสถานที่</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">ตรวจสอบและลบรีวิว</p>
                </div>
              </button>
            )}
            {currentUserRole !== 'viewer' && currentUserRole !== 'council' && (
              <button onClick={() => setActivePage('business-register')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#fef3c7' }}>
                  <Store size={24} style={{ color: '#d97706' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">ลงทะเบียนธุรกิจ</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">อนุมัติคำขอลงทะเบียน</p>
                </div>
              </button>
            )}
            <button onClick={() => setActivePage('locations')}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#e0f2fe' }}>
                <MapPin size={24} style={{ color: '#0891b2' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">สถานที่เกิดเหตุ</p>
                <p className="text-[13px] text-gray-400 mt-0.5">จัดการหมู่บ้าน / ตำบล</p>
              </div>
            </button>
            {currentUserRole !== 'viewer' && (
              <button onClick={() => setActivePage('staff')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#ede9fe' }}>
                  <UserCircle2 size={24} style={{ color: '#7c3aed' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">รูปผู้บริหาร</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">อัปโหลดรูปนายก/ทีมงาน</p>
                </div>
              </button>
            )}
            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && (
              <button onClick={() => setActivePage('system-settings')}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#dbeafe' }}>
                  <Settings size={24} style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">ตั้งค่าระบบ</p>
                  <p className="text-[13px] text-gray-400 mt-0.5">ชื่อระบบ</p>
                </div>
              </button>
            )}
            <a href="/manual-admin.html" target="_blank" rel="noopener noreferrer"
              className="flex flex-col items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:bg-gray-50 active:scale-95 transition-all text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#d1fae5' }}>
                <BookOpen size={24} style={{ color: '#059669' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-800">คู่มือผู้ดูแล</p>
                <p className="text-[13px] text-gray-400 mt-0.5">คู่มือการใช้งานระบบ</p>
              </div>
            </a>
          </div>

          {/* Desktop: settings table */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">เมนู</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500">คำอธิบาย</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 w-28">เข้าใช้งาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  { key: 'categories',  Icon: Tag,    color: '#d97706', bg: '#fef3c7', label: 'ประเภทคำร้อง', desc: 'จัดการหมวดหมู่คำร้อง',       show: currentUserRole !== 'viewer' },
                  { key: 'assignments', Icon: Wrench, color: '#d97706', bg: '#fef3c7', label: 'ผู้รับผิดชอบ', desc: 'มอบหมายงานตามประเภทคำร้อง', show: currentUserRole !== 'council' },
                  { key: 'emergency',   Icon: Phone,       color: '#ef4444', bg: '#fee2e2', label: 'สายด่วนฉุกเฉิน',  desc: 'จัดการรายชื่อและเบอร์ติดต่อ',     show: currentUserRole !== 'viewer' },
                  { key: 'locations',   Icon: MapPin,      color: '#0891b2', bg: '#e0f2fe', label: 'สถานที่เกิดเหตุ', desc: 'จัดการหมู่บ้าน / ตำบลในพื้นที่',  show: currentUserRole !== 'viewer' },
                  { key: 'tourism',          Icon: Luggage,     color: '#d97706', bg: '#fef3c7', label: 'เที่ยว กิน พัก ชอบ',  desc: 'ท่องเที่ยว ร้านค้า บริการออนไลน์',      show: currentUserRole !== 'viewer' },
                  { key: 'tourism-reviews',  Icon: Star,        color: '#f59e0b', bg: '#fef3c7', label: 'รีวิวสถานที่',       desc: 'ตรวจสอบและลบรีวิวที่ไม่เหมาะสม',     show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
                  { key: 'business-register', Icon: Store,      color: '#d97706', bg: '#fef3c7', label: 'ลงทะเบียนธุรกิจ',   desc: 'อนุมัติ/จัดการคำขอลงทะเบียนธุรกิจ',  show: currentUserRole !== 'viewer' && currentUserRole !== 'council' },
                  { key: 'staff',            Icon: UserCircle2, color: '#7c3aed', bg: '#ede9fe', label: 'รูปผู้บริหาร',       desc: 'อัปโหลดรูปนายก/รองนายก/ทีมงาน',       show: currentUserRole !== 'viewer' },
                  { key: 'system-settings', Icon: Settings,color: '#3b82f6', bg: '#dbeafe', label: 'ตั้งค่าระบบ',    desc: 'ตั้งค่าชื่อระบบและข้อมูลพื้นฐาน',   show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                  { key: 'users',       Icon: Shield,      color: '#7c3aed', bg: '#ede9fe', label: 'จัดการผู้ใช้',    desc: 'สิทธิ์การเข้าถึงและบทบาท',        show: currentUserRole === 'admin' || currentUserRole === 'superadmin' },
                ].filter(r => r.show).map(({ key, Icon, color, bg, label, desc }) => (
                  <tr key={key} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setActivePage(key)}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: bg }}>
                          <Icon size={16} style={{ color }} />
                        </div>
                        <span className="font-semibold text-gray-800">{label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{desc}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button className="flex items-center gap-1.5 ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors">
                        เปิด <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#d1fae5' }}>
                        <BookOpen size={16} style={{ color: '#059669' }} />
                      </div>
                      <span className="font-semibold text-gray-800">คู่มือผู้ดูแล</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">เอกสารการใช้งานระบบสำหรับเจ้าหน้าที่</td>
                  <td className="px-5 py-3.5 text-right">
                    <a href="/manual-admin.html" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors w-fit">
                      เปิด <ExternalLink size={11} />
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : activePage === 'modules' ? (
        <ModuleManager tenant={tenant} />
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
                    <span className={`ml-1 px-1.5 rounded-full text-[13px] font-bold ${
                      filterTab === i ? 'bg-white/25' : 'bg-gray-200 text-gray-600'
                    }`}>
                      {complaints.filter((c) => c.status === FILTER_KEYS[i]).length}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {/* Extra filters row */}
          <div className="flex flex-wrap gap-2 mt-2">
            {/* Category filter */}
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">ประเภททั้งหมด ({baseFiltered.length})</option>
              {categoryOptions.map(([cat, count]) => (
                <option key={cat} value={cat}>{CATEGORY_LABEL[cat] ?? cat} ({count})</option>
              ))}
            </select>

            {/* Village/Location filter */}
            <select
              value={filterVillage}
              onChange={(e) => setFilterVillage(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">สถานที่ทั้งหมด ({baseFiltered.length})</option>
              {villageOptions.map(([v, count]) => (
                <option key={v} value={v}>{v} ({count})</option>
              ))}
            </select>

            {/* Technician filter */}
            <select
              value={filterTechnician}
              onChange={(e) => setFilterTechnician(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">ช่างทั้งหมด ({baseFiltered.length})</option>
              <option value="__none__">ยังไม่มอบหมาย ({techOptions.unassignedCount})</option>
              {techOptions.opts.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.count})</option>
              ))}
            </select>

            {/* Clear all filters button */}
            {(filterCategory || filterVillage || filterTechnician || filterTab !== 0 || search) && (
              <button
                onClick={() => { setFilterCategory(''); setFilterVillage(''); setFilterTechnician(''); setFilterTab(0); setSearch('') }}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 transition-colors flex items-center gap-1">
                <X size={12} />
                ล้างตัวกรองทั้งหมด
              </button>
            )}
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
              {paginatedFiltered.map((c, i) => (
                <div key={c.id} className="px-4 py-4 space-y-2 active:bg-gray-50 cursor-pointer"
                     onClick={() => setSelectedComplaint(c)}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-gray-800 text-sm leading-snug">
                      <span className="text-gray-400 font-mono font-normal mr-1">{complaintStartIdx + i + 1}.</span>
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
                    <th className="px-3 py-2 text-center font-medium w-10">#</th>
                    <th className="px-3 py-2 text-left font-medium">วันที่</th>
                    <th className="px-3 py-2 text-left font-medium">ประเภท</th>
                    <th className="px-3 py-2 text-left font-medium">สถานที่</th>
                    <th className="px-3 py-2 text-left font-medium">ช่าง</th>
                    <th className="px-3 py-2 text-left font-medium">โทรศัพท์</th>
                    <th className="px-3 py-2 text-left font-medium">สถานะ</th>
                    <th className="px-3 py-2 text-left font-medium">การดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paginatedFiltered.map((c, i) => (
                    <tr key={c.id} className="hover:bg-gray-50/70 transition-colors cursor-pointer"
                        onClick={() => setSelectedComplaint(c)}>
                      <td className="px-3 py-1.5 text-center text-xs text-gray-400 font-mono">{complaintStartIdx + i + 1}</td>
                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap text-xs">
                        {new Date(c.created_at).toLocaleDateString('th-TH', {
                          day: '2-digit', month: 'short', year: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                        {(c.village || c.location_name)
                          ? <span className="flex items-center gap-1"><MapPin size={11} className="text-gray-300 shrink-0" />{c.village || c.location_name}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {c.assigned_to
                          ? <span className="flex items-center gap-1 text-blue-600 text-xs font-medium"><Wrench size={11} className="shrink-0" />{technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ช่าง'}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                        {c.phone ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <ActionButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} />
                          <RejectButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-gray-100">
              {/* Page size selector */}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>แสดง</span>
                <select
                  value={complaintsPerPage}
                  onChange={(e) => setComplaintsPerPage(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                  {[10, 20, 50, 100].map(n => (
                    <option key={n} value={n}>{n} รายการ</option>
                  ))}
                  <option value="all">ทั้งหมด</option>
                </select>
                <span className="text-gray-400">
                  ({complaintStartIdx + 1}–{Math.min(complaintStartIdx + perPage, filtered.length)} จาก {filtered.length})
                </span>
              </div>

              {/* Page buttons */}
              {complaintTotalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setComplaintPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                    disabled={complaintPage === 1}
                    className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft size={16} />
                  </button>

                  {Array.from({ length: complaintTotalPages }, (_, i) => i + 1)
                    .filter(p => {
                      if (complaintTotalPages <= 7) return true
                      if (p === 1 || p === complaintTotalPages) return true
                      if (Math.abs(p - complaintPage) <= 1) return true
                      return false
                    })
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...')
                      acc.push(p)
                      return acc
                    }, [])
                    .map((p, idx) =>
                      p === '...' ? (
                        <span key={`dots-${idx}`} className="px-1 text-gray-300 text-sm">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => { setComplaintPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                          className={`min-w-[36px] h-9 rounded-xl text-sm font-semibold transition-all ${
                            complaintPage === p
                              ? 'text-white shadow-md'
                              : 'text-gray-500 hover:bg-gray-100 border border-gray-200'
                          }`}
                          style={complaintPage === p ? { backgroundColor: 'var(--color-primary)' } : undefined}>
                          {p}
                        </button>
                      )
                    )}

                  <button
                    onClick={() => { setComplaintPage(p => Math.min(complaintTotalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                    disabled={complaintPage === complaintTotalPages}
                    className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      </>
      )}
      </div>
    </div>
  )
}
