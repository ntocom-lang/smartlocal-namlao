import { useEffect, useState, useCallback, useRef } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  ClipboardList, Clock, Loader2, CheckCircle2, XCircle, AlertCircle,
  ChevronRight, ChevronLeft, Filter, Search, Phone, Trash2, Wrench,
  MapPin, X, FileText, AlignLeft, Camera, ChevronDown,
  Shield, Printer, Users, RefreshCw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'

// ─── Constants ────────────────────────────────────────────────────────────────
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
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-all mt-1"
                style={done
                  ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' }
                  : { backgroundColor: '#fff', borderColor: '#e5e7eb' }}>
                {done && !isCurrent ? (
                  <CheckCircle2 size={14} className="text-white" />
                ) : isCurrent ? (
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                )}
              </div>
              {!isLast && (
                <div className="w-0.5 flex-1 my-1 rounded-full"
                  style={{ backgroundColor: i < currentIdx ? 'var(--color-primary)' : '#e5e7eb', minHeight: '28px' }} />
              )}
            </div>
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
        {loading === id ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}
        {action.label}
      </button>
      {confirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setConfirm(false)}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-72 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการเปลี่ยนสถานะ</p>
            <p className="text-xs text-gray-500 mb-4">ต้องการ <span className="font-medium text-gray-800">"{action.label}"</span> ใช่หรือไม่?</p>
            <div className="flex gap-2">
              <button onClick={() => { setConfirm(false); onUpdate(id, action.next) }}
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
    setOpen(false); setReason(''); setErr('')
  }
  return (
    <>
      <button onClick={() => setOpen(true)} disabled={loading === id}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50">
        <XCircle size={12} /> ปฏิเสธ
      </button>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
          onClick={() => { setOpen(false); setReason(''); setErr('') }}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-80 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2">
              <XCircle size={14} className="text-red-500" /> ปฏิเสธคำร้อง
            </p>
            <p className="text-xs text-gray-500 mb-3">กรุณาระบุเหตุผลที่ปฏิเสธคำร้องนี้</p>
            <textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} rows={3}
              placeholder="เช่น ไม่อยู่ในความรับผิดชอบ, ข้อมูลไม่ครบถ้วน..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-red-200" />
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
          <div className="absolute bg-white rounded-xl shadow-xl border border-gray-200 py-1"
            style={{
              left: rect.left, width: rect.width,
              ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
            }}
            onClick={e => e.stopPropagation()}>
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Header */}
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
              {c.subject && <p className="text-white/80 text-sm mt-1 leading-snug">{c.subject}</p>}
            </div>
          </div>
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/20">
            <div>
              <p className="text-white/60 text-[13px] uppercase tracking-wider">เลขที่คำร้อง</p>
              <p className="text-white font-black text-lg tracking-wider mt-0.5 font-mono">
                {c.complaint_number ? (() => {
                  const d = new Date(c.created_at)
                  const yy = String(d.getFullYear()+543).slice(-2)
                  const mm = String(d.getMonth()+1).padStart(2,'0')
                  return `${yy}${mm}${String(c.complaint_number).padStart(3,'0')}`
                })() : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-[13px] uppercase tracking-wider">ยื่นเมื่อ</p>
              <p className="text-white/90 text-xs font-medium mt-0.5">{dateStr} น.</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5 bg-white">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">ความคืบหน้า</p>
            <StatusStepper status={c.status} note={c.technician_note} />
          </div>

          {technicians?.length > 0 && c.status !== 'completed' && c.status !== 'rejected' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">มอบหมายให้ช่าง</p>
              <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
                <div className="flex items-center gap-3">
                  <Wrench size={16} className="text-orange-500 shrink-0" />
                  <div className="flex-1">
                    {c.assigned_to
                      ? <p className="text-sm font-semibold text-gray-800">{technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ช่าง'}</p>
                      : <p className="text-sm text-gray-400">ยังไม่ได้มอบหมาย</p>}
                  </div>
                  <select value={c.assigned_to ?? ''}
                    onChange={async (e) => {
                      const val = e.target.value || null
                      setAssigning(true)
                      await onAssign(c.id, val)
                      setAssigning(false)
                    }}
                    disabled={assigning}
                    className="text-xs border border-orange-200 rounded-xl px-2 py-1.5 bg-white text-gray-700 focus:outline-none">
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
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
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

          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดแนบมา</p>
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.detail}</p>
            </div>
          </div>

          {attachments.length > 0 && (
            <div className="space-y-2 pb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                ก่อนดำเนินการ ({attachments.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {attachments.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                    className="aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100 flex items-center justify-center">
                    {/\.(jpg|jpeg|png|gif|webp)$/i.test(url)
                      ? <img src={url} alt={`ไฟล์ ${i + 1}`} className="w-full h-full object-cover" />
                      : <FileText size={22} className="text-gray-400" />}
                  </a>
                ))}
              </div>
            </div>
          )}

          {(c.work_photos ?? []).length > 0 && (
            <div className="space-y-2 pb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Camera size={12} /> หลังดำเนินการ ({c.work_photos.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {c.work_photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                    className="aspect-square rounded-xl overflow-hidden border border-green-200 bg-green-50 flex items-center justify-center">
                    {/\.(jpg|jpeg|png|gif|webp)$/i.test(url)
                      ? <img src={url} alt={`ผลงาน ${i + 1}`} className="w-full h-full object-cover" />
                      : <FileText size={22} className="text-green-400" />}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
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
              <RejectButton status={c.status} id={c.id}
                onUpdate={(id, next, wp = [], note = null) => { onUpdate(id, next, wp, note); onClose() }}
                loading={updating} />
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
                      <button className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5"
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
                <textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} rows={3}
                  placeholder="เช่น เปลี่ยนหลอดไฟ LED 18W จำนวน 2 ดวง, ค่าแรง 500 บาท..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
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
              <ActionButton status={c.status} id={c.id}
                onUpdate={(id, next, wp = [], note = null) => { onUpdate(id, next, wp, note); onClose() }}
                loading={updating} />
              <RejectButton status={c.status} id={c.id}
                onUpdate={(id, next, wp = [], note = null) => { onUpdate(id, next, wp, note); onClose() }}
                loading={updating} />
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

      {overrideConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setOverrideConfirm(null)}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-72 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการเปลี่ยนสถานะ</p>
            <p className="text-xs text-gray-500 mb-4">
              เปลี่ยนเป็น <span className="font-medium text-gray-800">"{STATUS[overrideConfirm]?.label}"</span> ใช่หรือไม่?
            </p>
            <div className="flex gap-2">
              <button onClick={() => { onUpdate(c.id, overrideConfirm, []); setOverrideConfirm(null); onClose() }}
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function ComplaintsManager({ tenant, currentUserRole }) {
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading]       = useState(true)
  const [updating, setUpdating]     = useState(null)
  const [filterTab, setFilterTab]   = useState(0)
  const [search, setSearch]         = useState('')
  const [complaintPage, setComplaintPage]         = useState(1)
  const [complaintsPerPage, setComplaintsPerPage] = useState(10)
  const [filterCategory, setFilterCategory]       = useState('')
  const [filterVillage, setFilterVillage]         = useState('')
  const [filterTechnician, setFilterTechnician]   = useState('')
  const [selectedComplaint, setSelectedComplaint] = useState(null)
  const [technicians, setTechnicians]             = useState([])

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

  useEffect(() => { fetchTechnicians() }, [fetchTechnicians])
  useEffect(() => { fetchComplaints() }, [fetchComplaints])

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

  async function updateStatus(id, nextStatus, workPhotos = [], techNote = null) {
    setUpdating(id)
    const payload = { status: nextStatus }
    if (workPhotos.length > 0) payload.work_photos = workPhotos
    if (techNote) payload.technician_note = techNote
    const { error } = await supabase.from('complaints').update(payload).eq('id', id)
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

  // ─── Derived data ─────────────────────────────────────────────────────────
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
    const matchVillage  = filterVillage === '' || (c.village || c.location_name || '') === filterVillage
    const matchTech     = filterTechnician === '' ||
      (filterTechnician === '__none__' ? !c.assigned_to : c.assigned_to === filterTechnician)
    return matchStatus && matchSearch && matchCategory && matchVillage && matchTech
  })

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
    const assigned   = baseFiltered.filter(c => c.assigned_to)
    const unassigned = baseFiltered.filter(c => !c.assigned_to)
    const byTech     = assigned.reduce((acc, c) => { acc[c.assigned_to] = (acc[c.assigned_to] || 0) + 1; return acc }, {})
    const opts       = Object.entries(byTech)
      .map(([id, count]) => ({ id, name: technicians.find(t => t.id === id)?.full_name ?? 'ช่าง', count }))
      .sort((a, b) => b.count - a.count)
    return { opts, unassignedCount: unassigned.length }
  })()

  const perPage             = complaintsPerPage === 'all' ? filtered.length : complaintsPerPage
  const complaintTotalPages = perPage > 0 ? Math.max(1, Math.ceil(filtered.length / perPage)) : 1
  const complaintStartIdx   = (complaintPage - 1) * perPage
  const paginatedFiltered   = complaintsPerPage === 'all' ? filtered : filtered.slice(complaintStartIdx, complaintStartIdx + perPage)

  useEffect(() => { setComplaintPage(1) }, [filterTab, search, complaintsPerPage, filterCategory, filterVillage, filterTechnician])

  const counts = Object.fromEntries(
    Object.keys(STATUS).map((k) => [k, complaints.filter((c) => c.status === k).length])
  )

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Refresh */}
      <div className="flex justify-end">
        <button onClick={fetchComplaints} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีเฟรช
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="ทั้งหมด"        value={complaints.length}       icon={ClipboardList} color="#64748b" />
        <StatCard label="รอดำเนินการ"    value={counts.pending ?? 0}     icon={Clock}         color="#f59e0b" />
        <StatCard label="กำลังดำเนินการ" value={counts.in_progress ?? 0} icon={AlertCircle}   color="#8b5cf6" />
        <StatCard label="เสร็จสิ้น"      value={counts.completed ?? 0}   icon={CheckCircle2}  color="#10b981" />
      </div>

      {/* Chart + status summary */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-700 text-sm mb-4">สัดส่วนตามสถานะ</h2>
          {statsData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statsData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                     paddingAngle={3} dataKey="value">
                  {statsData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8}
                        formatter={(value) => <span className="text-xs text-gray-600">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

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
        <div className="px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="font-semibold text-gray-700 flex-1">รายการคำร้อง</h2>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาคำร้อง..."
                className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent w-52 text-gray-900 bg-white"
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
                  filterTab === i ? 'text-white' : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
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

          {/* Extra filters */}
          <div className="flex flex-wrap gap-2 mt-2">
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">ประเภททั้งหมด ({baseFiltered.length})</option>
              {categoryOptions.map(([cat, count]) => (
                <option key={cat} value={cat}>{CATEGORY_LABEL[cat] ?? cat} ({count})</option>
              ))}
            </select>

            <select value={filterVillage} onChange={(e) => setFilterVillage(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">สถานที่ทั้งหมด ({baseFiltered.length})</option>
              {villageOptions.map(([v, count]) => (
                <option key={v} value={v}>{v} ({count})</option>
              ))}
            </select>

            <select value={filterTechnician} onChange={(e) => setFilterTechnician(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">ช่างทั้งหมด ({baseFiltered.length})</option>
              <option value="__none__">ยังไม่มอบหมาย ({techOptions.unassignedCount})</option>
              {techOptions.opts.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.count})</option>
              ))}
            </select>

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
                  {c.subject && <p className="text-xs text-gray-600 truncate">{c.subject}</p>}
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
                        {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
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

            {/* Pagination */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-gray-100">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>แสดง</span>
                <select value={complaintsPerPage}
                  onChange={(e) => setComplaintsPerPage(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                  {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} รายการ</option>)}
                  <option value="all">ทั้งหมด</option>
                </select>
                <span className="text-gray-400">
                  ({complaintStartIdx + 1}–{Math.min(complaintStartIdx + perPage, filtered.length)} จาก {filtered.length})
                </span>
              </div>
              {complaintTotalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setComplaintPage(p => Math.max(1, p - 1))} disabled={complaintPage === 1}
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
                        <button key={p} onClick={() => setComplaintPage(p)}
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
                  <button onClick={() => setComplaintPage(p => Math.min(complaintTotalPages, p + 1))}
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

      {/* Detail modal */}
      {selectedComplaint && (
        <ComplaintDetailModal
          complaint={selectedComplaint}
          onClose={() => setSelectedComplaint(null)}
          onUpdate={updateStatus}
          updating={updating}
          technicians={technicians}
          onAssign={assignTechnician}
          currentUserRole={currentUserRole ?? 'staff'}
          onDelete={handleDeleteComplaint}
        />
      )}
    </div>
  )
}
