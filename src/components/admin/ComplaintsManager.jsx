import { useEffect, useState, useCallback, useRef } from 'react'
import MapPicker from '../MapPicker'
import {
  ClipboardList, Clock, Loader2, CheckCircle2, XCircle, AlertCircle,
  ChevronRight, ChevronLeft, Filter, Search, Phone, Trash2, Wrench,
  MapPin, X, FileText, AlignLeft, Camera, ChevronDown,
  Shield, Printer, Users, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { notifyTelegram } from '../../lib/notifyTelegram'
import { compressImage } from '../../lib/imageUtils'
import { logAction } from '../../lib/auditLog'

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS = {
  new:         { label: 'คำร้องใหม่',      color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   color: '#0ea5e9', bg: '#e0f2fe', text: '#0369a1' },
  in_progress: { label: 'กำลังดำเนินการ',  color: '#8b5cf6', bg: '#ede9fe', text: '#5b21b6' },
  done:        { label: 'ดำเนินการแล้ว',   color: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
  closed:      { label: 'ปิดเรื่องแล้ว',   color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',          color: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
  // backward compat
  pending:     { label: 'คำร้องใหม่',      color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  completed:   { label: 'ดำเนินการแล้ว',   color: '#3b82f6', bg: '#dbeafe', text: '#1e40af' },
}
const STATUS_FLOW = ['new', 'received', 'in_progress', 'done', 'closed']
const STATUS_FLOW_LABEL = {
  new:         { label: 'คำร้องใหม่',      desc: 'ประชาชนส่งคำร้องเข้าระบบ' },
  received:    { label: 'รับเรื่องแล้ว',   desc: 'เจ้าหน้าที่รับเรื่องแล้ว' },
  in_progress: { label: 'กำลังดำเนินการ',  desc: 'เจ้าหน้าที่ลงพื้นที่ดำเนินการ' },
  done:        { label: 'ดำเนินการแล้ว',   desc: 'เจ้าหน้าที่ดำเนินการเสร็จแล้ว' },
  closed:      { label: 'ปิดเรื่องแล้ว',   desc: 'ปิดเรื่องและแจ้งผลประชาชนแล้ว' },
}
const DEPARTMENTS = ['สำนักปลัด', 'กองช่าง', 'กองการศึกษา', 'กองคลัง']
const NEXT_ACTION = {
  new:         { label: 'รับเรื่อง',        next: 'received' },
  received:    { label: 'เริ่มดำเนินการ',   next: 'in_progress' },
  in_progress: { label: 'ดำเนินการแล้ว',    next: 'done' },
  done:        { label: 'ปิดเรื่อง',         next: 'closed' },
}
const CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าสาธารณะ',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', building: 'ตรวจสอบอาคาร',
  mosquito: 'พ่นยุง', canal: 'ลอกคลอง',
  animals: 'สุนัขจรจัด', water_supply: 'สนับสนุนน้ำอุปโภค',
  borrow_equipment: 'ยืมพัสดุ', grievance: 'ร้องทุกข์/ร้องเรียน',
  corruption: 'แจ้งการทุจริต', tax: 'ภาษีและค่าธรรมเนียม',
  other: 'อื่นๆ',
}
const CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', water_supply: '🚿',
  borrow_equipment: '📦', grievance: '📣', other: '📝',
}
const STATUS_MAIN = ['new', 'received', 'in_progress', 'done', 'closed', 'rejected']

function addWorkingDays(date, days) {
  const d = new Date(date)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return d.toISOString().slice(0, 10)
}

function slaDaysLeft(dueDateStr) {
  if (!dueDateStr) return null
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const due = new Date(dueDateStr); due.setHours(0, 0, 0, 0)
  return Math.round((due - now) / 86400000)
}

function SlaBadge({ dueDate, status }) {
  if (!dueDate || status === 'done' || status === 'closed' || status === 'rejected') return null
  const days = slaDaysLeft(dueDate)
  if (days === null) return null
  const color = days < 0 ? { bg: '#fee2e2', text: '#991b1b' }
    : days <= 5 ? { bg: '#fef3c7', text: '#92400e' }
    : { bg: '#d1fae5', text: '#065f46' }
  const label = days < 0 ? `เกินกำหนด ${Math.abs(days)} วัน`
    : days === 0 ? 'ครบกำหนดวันนี้'
    : `เหลือ ${days} วัน`
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
          style={{ backgroundColor: color.bg, color: color.text }}>
      ⏱ {label}
    </span>
  )
}
const FILTER_TABS = ['ทั้งหมด', ...STATUS_MAIN.map((k) => STATUS[k].label)]
const FILTER_KEYS = [null, ...STATUS_MAIN]

const PRIORITY = {
  urgent: { label: '🔴 เร่งด่วน', short: 'เร่งด่วน', color: '#ef4444', bg: '#fee2e2', text: '#991b1b', order: 0 },
  normal: { label: '🟡 ปกติ',     short: 'ปกติ',     color: '#f59e0b', bg: '#fef3c7', text: '#92400e', order: 1 },
  low:    { label: '🟢 ต่ำ',      short: 'ต่ำ',      color: '#10b981', bg: '#d1fae5', text: '#065f46', order: 2 },
}

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

function PriorityBadge({ priority }) {
  if (!priority || priority === 'normal') return null
  const p = PRIORITY[priority]
  if (!p) return null
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
          style={{ backgroundColor: p.bg, color: p.text }}>
      {p.short}
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
  const currentIdx = STATUS_FLOW.indexOf(normalizeActionStatus(status))
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

function QuickStatusChange({ id, currentStatus, onUpdate, loading }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(currentStatus)
  const [note, setNote] = useState('')

  function handleOpen() { setSel(currentStatus || 'new'); setNote(''); setOpen(true) }
  function handleSave() {
    if (sel !== currentStatus) onUpdate(id, sel, [], note.trim() || null)
    setOpen(false)
  }

  return (
    <>
      <button onClick={handleOpen} disabled={loading === id}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50">
        <ChevronDown size={11} /> สถานะ
      </button>
      {open && (
        <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/40"
             onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-80 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการเปลี่ยนสถานะ</p>
            <p className="text-xs text-gray-500 mb-3">เลือกสถานะที่ต้องการเปลี่ยนเป็น</p>
            <select value={sel} onChange={(e) => setSel(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 mb-3">
              {Object.entries(STATUS).filter(([k]) => ['new','in_progress','done','closed','rejected'].includes(k)).map(([key, s]) => (
                <option key={key} value={key}>{s.label}</option>
              ))}
            </select>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 mb-3" />
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={loading === id}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                ยืนยัน
              </button>
              <button onClick={() => setOpen(false)}
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

const LEGACY_STATUS = { pending: 'new', completed: 'done', received: 'received' }
function normalizeActionStatus(s) { return LEGACY_STATUS[s] ?? s ?? 'new' }

function ActionButton({ status, id, onUpdate, loading }) {
  const action = NEXT_ACTION[normalizeActionStatus(status)]
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState('')
  if (!action) return null
  function handleConfirm() {
    setConfirm(false)
    onUpdate(id, action.next, [], note.trim() || null)
    setNote('')
  }
  return (
    <>
      <button onClick={() => setConfirm(true)} disabled={loading === id}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        {loading === id ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}
        {action.label}
      </button>
      {confirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => { setConfirm(false); setNote('') }}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-80 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการเปลี่ยนสถานะ</p>
            <p className="text-xs text-gray-500 mb-3">ต้องการ <span className="font-medium text-gray-800">"{action.label}"</span> ใช่หรือไม่?</p>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 mb-3" />
            <div className="flex gap-2">
              <button onClick={handleConfirm} disabled={loading === id}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                ยืนยัน
              </button>
              <button onClick={() => { setConfirm(false); setNote('') }}
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

function ComplaintDetailModal({ complaint: c, onClose, onUpdate, updating, technicians, onAssign, onPriority, currentUserRole, onDelete }) {
  const { tenant } = useTenant()
  const [assigning, setAssigning] = useState(false)
  const [showCloseJob, setShowCloseJob] = useState(false)
  const [pendingPhotos, setPendingPhotos] = useState([])
  const [closeNote, setCloseNote] = useState('')
  const [closeUploading, setCloseUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [overrideConfirm, setOverrideConfirm] = useState(null)
  const [nearbyList, setNearbyList] = useState([])
  const [showPinEdit, setShowPinEdit] = useState(false)
  const [savingPin, setSavingPin] = useState(false)

  async function handleSavePin({ lat, lng }) {
    setSavingPin(true)
    const { error } = await supabase
      .from('complaints')
      .update({ latitude: lat, longitude: lng })
      .eq('id', c.id)
    setSavingPin(false)
    if (!error) setShowPinEdit(false)
  }

  useEffect(() => {
    if (!c.latitude || !tenant?.id) return
    supabase.rpc('complaints_near', {
      _lat: c.latitude, _lng: c.longitude, _radius_m: 300, _municipality_id: tenant.id,
    }).then(({ data }) => {
      if (data) setNearbyList(data.filter((n) => n.id !== c.id).slice(0, 5))
    })
  }, [c.id, c.latitude])

  async function handleDelete() {
    if (!window.confirm(`ลบคำร้องนี้ออกจากระบบ?\n\nการลบไม่สามารถย้อนกลับได้`)) return
    setDeleting(true)
    await logAction({
      action: 'delete', resourceType: 'complaint',
      resourceId: c.id,
      resourceLabel: `[${c.ref_no ?? c.id.slice(0, 8)}] ${c.description?.slice(0, 60) ?? ''}`,
      municipalityId: tenant?.id,
      metadata: { category: c.category, status: c.status, reporter: c.reporter_name },
    })
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
    const num = c.ref_no ?? '—'
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
      const compressed = await compressImage(item.file, 1200)
      const { error } = await supabase.storage
        .from('complaint-attachments')
        .upload(path, compressed, { upsert: false })
      if (!error) {
        const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    }
    setCloseUploading(false)
    onUpdate(c.id, 'done', urls, closeNote.trim() || null)
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
                {c.ref_no ?? '—'}
              </p>
              {c.due_date && (
                <div className="mt-1">
                  <SlaBadge dueDate={c.due_date} status={c.status} />
                </div>
              )}
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

          {technicians?.length > 0 && c.status !== 'closed' && c.status !== 'completed' && c.status !== 'rejected' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">มอบหมายเจ้าหน้าที่</p>
              <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
                <div className="flex items-center gap-3">
                  <Wrench size={16} className="text-orange-500 shrink-0" />
                  <div className="flex-1">
                    {c.assigned_to
                      ? <p className="text-sm font-semibold text-gray-800">{technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ผู้รับผิดชอบ'}</p>
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
                    <option value="">— เลือกผู้รับผิดชอบ —</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
                    ))}
                  </select>
                  {assigning && <Loader2 size={14} className="animate-spin text-orange-400 shrink-0" />}
                </div>

                {/* Priority selector */}
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-orange-100">
                  <p className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                    ⚡ ความเร่งด่วน
                  </p>
                  <div className="flex gap-1.5">
                    {Object.entries(PRIORITY).map(([k, p]) => {
                      const active = (c.priority ?? 'normal') === k
                      return (
                        <button key={k} type="button"
                          onClick={() => onPriority(c.id, k)}
                          className="px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all border"
                          style={active
                            ? { backgroundColor: p.bg, color: p.text, borderColor: p.color }
                            : { backgroundColor: '#f9fafb', color: '#9ca3af', borderColor: '#e5e7eb' }}>
                          {p.short}
                        </button>
                      )
                    })}
                  </div>
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
                  <>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                        <MapPin size={15} className="text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-gray-400">พิกัด</p>
                        <p className="text-sm font-medium text-gray-800">
                          {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                        </p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <a href={`https://maps.google.com/?q=${c.latitude},${c.longitude}`}
                          target="_blank" rel="noreferrer"
                          className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded-lg">เปิดแผนที่</a>
                        <button type="button"
                          onClick={() => setShowPinEdit(true)}
                          className="text-xs font-semibold px-2 py-1 rounded-lg bg-orange-100 text-orange-700">
                          แก้ไขหมุด
                        </button>
                      </div>
                    </div>
                    {showPinEdit && (
                      <div className="fixed inset-0 z-9999">
                        <MapPicker
                          initialPos={{ lat: c.latitude, lng: c.longitude }}
                          fallbackPos={{ lat: c.latitude, lng: c.longitude }}
                          onConfirm={handleSavePin}
                          onClose={() => setShowPinEdit(false)}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {nearbyList.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle size={13} /> คำร้องใกล้เคียงในรัศมี 300 ม. ({nearbyList.length})
              </p>
              <div className="bg-amber-50 rounded-2xl divide-y divide-amber-100 overflow-hidden border border-amber-100">
                {nearbyList.map((n) => (
                  <div key={n.id} className="flex items-center gap-3 px-4 py-2.5">
                    <MapPin size={13} className="text-amber-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{n.subject}</p>
                      <p className="text-xs text-gray-400">
                        {Math.round(n.distance_m)} ม. · {n.ref_no ?? '—'} · {{ new: 'รอรับเรื่อง', in_progress: 'กำลังดำเนินการ', done: 'เสร็จสิ้น', closed: 'ปิดเรื่อง' }[n.status] ?? n.status}
                      </p>
                    </div>
                  </div>
                ))}
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
                <CheckCircle2 size={12} /> ดำเนินการแล้ว
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
            <div className="space-y-3">
              {(c.status === 'done' || c.status === 'completed') && (
                <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle2 size={15} className="text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-green-800">ช่างรายงานว่าดำเนินการแล้ว</p>
                    <p className="text-[11px] text-green-600 mt-0.5">กรุณาตรวจสอบผลงานและกด "ปิดเรื่อง" เพื่อแจ้งประชาชน</p>
                  </div>
                </div>
              )}
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
            </div>
          )}

          {(currentUserRole === 'superadmin' || currentUserRole === 'admin' || currentUserRole === 'officer') && (
            <div className={`mt-3 pt-3 border-t border-dashed ${currentUserRole === 'superadmin' ? 'border-purple-200' : 'border-gray-200'}`}>
              <p className={`text-[13px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1 ${currentUserRole === 'superadmin' ? 'text-purple-400' : 'text-gray-400'}`}>
                <Shield size={10} /> {currentUserRole === 'superadmin' ? 'Superadmin — แก้ไขสถานะ' : 'เปลี่ยนสถานะ (Admin)'}
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
export default function ComplaintsManager({ tenant, currentUserRole, openComplaintId }) {
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
  const [filterPriority, setFilterPriority]       = useState('')
  const [filterDepartment, setFilterDepartment]   = useState('')
  const [selectedComplaint, setSelectedComplaint] = useState(null)
  const [technicians, setTechnicians]             = useState([])

  const fetchTechnicians = useCallback(async () => {
    if (!tenant?.id) return
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, department, is_dept_head')
      .eq('municipality_id', tenant.id)
      .in('role', ['technician', 'officer'])
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

  useEffect(() => {
    if (!openComplaintId || complaints.length === 0) return
    const found = complaints.find(c => c.id === openComplaintId)
    if (found) setSelectedComplaint(found)
  }, [complaints, openComplaintId])

  async function assignTechnician(complaintId, technicianId) {
    const newStatus = technicianId ? 'in_progress' : 'new'
    const { error } = await supabase
      .from('complaints')
      .update({ assigned_to: technicianId, status: newStatus })
      .eq('id', complaintId)
    if (!error) {
      setComplaints((prev) => prev.map((c) =>
        c.id === complaintId ? { ...c, assigned_to: technicianId, status: newStatus } : c
      ))
      if (selectedComplaint?.id === complaintId)
        setSelectedComplaint((prev) => ({ ...prev, assigned_to: technicianId, status: newStatus }))
    }
  }

  function handleDeleteComplaint(id) {
    setComplaints((prev) => prev.filter((c) => c.id !== id))
  }

  async function updatePriority(complaintId, priority) {
    await supabase.from('complaints').update({ priority }).eq('id', complaintId)
    setComplaints(prev => prev.map(c => c.id === complaintId ? { ...c, priority } : c))
    if (selectedComplaint?.id === complaintId) setSelectedComplaint(prev => ({ ...prev, priority }))
  }

  async function updateStatus(id, nextStatus, workPhotos = [], techNote = null) {
    setUpdating(id)
    const payload = { status: nextStatus }
    if (workPhotos.length > 0) payload.work_photos = workPhotos
    if (techNote) payload.technician_note = techNote
    if (nextStatus === 'in_progress') payload.due_date = addWorkingDays(new Date(), 15)
    if (nextStatus === 'closed') payload.closed_at = new Date().toISOString()
    const { error } = await supabase.from('complaints').update(payload).eq('id', id)
    if (error) {
      console.error('update status error:', error.message)
    } else {
      setComplaints((prev) =>
        prev.map((c) => c.id === id
          ? { ...c, status: nextStatus, ...(payload.due_date ? { due_date: payload.due_date } : {}), ...(workPhotos.length > 0 ? { work_photos: workPhotos } : {}) }
          : c)
      )

      const c = complaints.find(x => x.id === id)

      supabase.from('complaint_timeline').insert({
        complaint_id: id,
        status: nextStatus,
        note: techNote ?? null,
        actor_name: null,
      }).then()

      if (nextStatus === 'closed' && c?.user_id) {
        supabase.functions.invoke('send-push', {
          body: {
            user_id: c.user_id,
            title: 'คำร้องของคุณปิดเรื่องแล้ว',
            body: `คำร้อง${CATEGORY_LABEL[c?.category] ?? c?.category ?? ''} ดำเนินการเสร็จสิ้นแล้ว`,
            url: '/my-complaints',
          },
        }).catch(() => {})
      }

      const catLabel = CATEGORY_LABEL[c?.category] ?? c?.category ?? ''
      notifyTelegram(tenant?.telegram_group_id,
        `🔄 <b>อัปเดตสถานะคำร้อง</b>\nประเภท: ${catLabel}\nสถานะ: ${STATUS[nextStatus]?.label ?? nextStatus}${techNote ? `\nหมายเหตุ: ${techNote}` : ''}`
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
      const num = c.ref_no ?? '—'
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


  const normalizeStatus = (s) => {
    if (s === 'pending') return 'new'
    if (s === 'received') return 'in_progress'
    if (s === 'completed') return 'done'
    return s
  }

  const filtered = complaints.filter((c) => {
    const ns = normalizeStatus(c.status)
    const matchStatus = FILTER_KEYS[filterTab] ? ns === FILTER_KEYS[filterTab] : true
    const matchSearch = search === '' ||
      (c.detail ?? '').includes(search) ||
      (CATEGORY_LABEL[c.category] ?? '').includes(search) ||
      (c.phone ?? '').includes(search) ||
      (c.reporter_name ?? '').includes(search) ||
      (c.profiles?.full_name ?? '').includes(search)
    const matchCategory   = filterCategory === '' || c.category === filterCategory
    const matchVillage    = filterVillage === '' || (c.village || c.location_name || '') === filterVillage
    const matchTech       = filterTechnician === '' ||
      (filterTechnician === '__none__' ? !c.assigned_to : c.assigned_to === filterTechnician)
    const matchPriority   = filterPriority === '' || (c.priority ?? 'normal') === filterPriority
    const matchDepartment = filterDepartment === '' || (c.department ?? '') === filterDepartment
    return matchStatus && matchSearch && matchCategory && matchVillage && matchTech && matchPriority && matchDepartment
  }).sort((a, b) => {
    const pa = PRIORITY[a.priority ?? 'normal']?.order ?? 1
    const pb = PRIORITY[b.priority ?? 'normal']?.order ?? 1
    return pa !== pb ? pa - pb : new Date(b.created_at) - new Date(a.created_at)
  })

  const baseFiltered = complaints.filter((c) => {
    const matchStatus = FILTER_KEYS[filterTab] ? normalizeStatus(c.status) === FILTER_KEYS[filterTab] : true
    const matchSearch = search === '' ||
      (c.detail ?? '').includes(search) ||
      (CATEGORY_LABEL[c.category] ?? '').includes(search) ||
      (c.phone ?? '').includes(search) ||
      (c.reporter_name ?? '').includes(search) ||
      (c.profiles?.full_name ?? '').includes(search)
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
      .map(([id, count]) => ({ id, name: technicians.find(t => t.id === id)?.full_name ?? 'ผู้รับผิดชอบ', count }))
      .sort((a, b) => b.count - a.count)
    return { opts, unassignedCount: unassigned.length }
  })()

  const perPage             = complaintsPerPage === 'all' ? filtered.length : complaintsPerPage
  const complaintTotalPages = perPage > 0 ? Math.max(1, Math.ceil(filtered.length / perPage)) : 1
  const complaintStartIdx   = (complaintPage - 1) * perPage
  const paginatedFiltered   = complaintsPerPage === 'all' ? filtered : filtered.slice(complaintStartIdx, complaintStartIdx + perPage)

  useEffect(() => { setComplaintPage(1) }, [filterTab, search, complaintsPerPage, filterCategory, filterVillage, filterTechnician, filterPriority])

  const counts = STATUS_MAIN.reduce((acc, k) => {
    acc[k] = complaints.filter((c) => normalizeStatus(c.status) === k).length
    return acc
  }, {})

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Refresh */}
      <div className="flex justify-end">
        <button onClick={fetchComplaints} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 md:rounded text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50 rounded-xl">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีเฟรช
        </button>
      </div>

      {/* Stat cards — mobile grid / PC formal bar */}
      <div className="grid grid-cols-2 md:hidden gap-3">
        <StatCard label="ทั้งหมด"         value={complaints.length}         icon={ClipboardList} color="#64748b" />
        <StatCard label="คำร้องใหม่"      value={counts.new ?? 0}           icon={Clock}         color="#f59e0b" />
        <StatCard label="กำลังดำเนินการ"  value={counts.in_progress ?? 0}   icon={AlertCircle}   color="#8b5cf6" />
        <StatCard label="ปิดเรื่องแล้ว"   value={counts.closed ?? 0}        icon={CheckCircle2}  color="#10b981" />
      </div>
      {/* PC stat bar */}
      <div className="hidden md:flex border border-gray-200 rounded-none bg-white divide-x divide-gray-200 shadow-sm">
        {[
          { label: 'คำร้องทั้งหมด',    value: complaints.length,          color: '#1a3a5c', bg: '#eef2f7' },
          { label: 'คำร้องใหม่',       value: counts.new ?? 0,            color: '#b45309', bg: '#fef3c7' },
          { label: 'กำลังดำเนินการ',  value: counts.in_progress ?? 0,    color: '#6d28d9', bg: '#ede9fe' },
          { label: 'ดำเนินการแล้ว',   value: counts.done ?? 0,            color: '#1d4ed8', bg: '#dbeafe' },
          { label: 'ปิดเรื่องแล้ว',   value: counts.closed ?? 0,          color: '#065f46', bg: '#d1fae5' },
          { label: 'ปฏิเสธ',           value: counts.rejected ?? 0,        color: '#991b1b', bg: '#fee2e2' },
        ].map(s => (
          <div key={s.label} className="flex-1 px-4 py-3 text-center" style={{ backgroundColor: s.bg }}>
            <p className="text-2xl font-bold leading-none" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[10px] font-semibold mt-1" style={{ color: s.color }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Table section */}
      <div className="bg-white rounded-2xl md:rounded-none shadow-sm border border-gray-200 overflow-hidden">
        {/* PC section title bar */}
        <div className="hidden md:flex items-center justify-between px-5 py-2.5 border-b border-gray-200"
          style={{ backgroundColor: '#1a3a5c' }}>
          <h2 className="text-[13px] font-bold text-white tracking-wide">รายการคำร้องประชาชน</h2>
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}>
            {filtered.length} รายการ
          </span>
        </div>
        <div className="px-5 pt-4 pb-3 border-b border-gray-200 md:bg-[#f5f8fc]">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="font-semibold text-gray-700 flex-1 md:hidden">รายการคำร้อง</h2>
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
                      {complaints.filter((c) => normalizeStatus(c.status) === FILTER_KEYS[i]).length}
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
              <option value="">ผู้รับผิดชอบทั้งหมด ({baseFiltered.length})</option>
              <option value="__none__">ยังไม่มอบหมาย ({techOptions.unassignedCount})</option>
              {techOptions.opts.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.count})</option>
              ))}
            </select>

            <select value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">ทุกกอง</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d} ({complaints.filter(c => c.department === d).length})</option>
              ))}
            </select>

            <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}>
              <option value="">ความเร่งด่วนทั้งหมด</option>
              {Object.entries(PRIORITY).map(([k, p]) => (
                <option key={k} value={k}>{p.short} ({complaints.filter(c => (c.priority ?? 'normal') === k).length})</option>
              ))}
            </select>

            {(filterCategory || filterVillage || filterTechnician || filterPriority || filterDepartment || filterTab !== 0 || search) && (
              <button
                onClick={() => { setFilterCategory(''); setFilterVillage(''); setFilterTechnician(''); setFilterPriority(''); setFilterDepartment(''); setFilterTab(0); setSearch('') }}
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
                <div key={c.id} className="px-4 py-3.5 space-y-2 cursor-pointer"
                     onClick={() => setSelectedComplaint(c)}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-gray-800 text-sm leading-snug">
                      <span className="text-gray-400 font-mono font-normal mr-1">{complaintStartIdx + i + 1}.</span>
                      {CATEGORY_LABEL[c.category] ?? c.category}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <PriorityBadge priority={c.priority} />
                      <StatusBadge status={c.status} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.ref_no && (
                      <span className="text-[10px] text-gray-400 font-mono">{c.ref_no}</span>
                    )}
                    <SlaBadge dueDate={c.due_date} status={c.status} />
                  </div>
                  {c.subject && <p className="text-xs text-gray-600 truncate">{c.subject}</p>}
                  <p className="text-xs text-gray-400 truncate">{c.detail}</p>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      <span>{new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                      {(c.village || c.location_name) && (
                        <span className="flex items-center gap-1">
                          <MapPin size={10} className="shrink-0" />
                          {c.village || c.location_name}
                        </span>
                      )}
                      {c.assigned_to && (
                        <span className="flex items-center gap-1 text-blue-500">
                          <Wrench size={10} className="shrink-0" />
                          {technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ผู้รับผิดชอบ'}
                        </span>
                      )}
                    </div>
                    {NEXT_ACTION[c.status] && currentUserRole !== 'viewer' && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <ActionButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ backgroundColor: '#2c5282' }}>
                    <th className="px-3 py-2.5 text-center text-[11px] font-bold text-white border-r border-white/10 w-10">ที่</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10 w-20">เลขที่</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ประเภทคำร้อง</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">สถานที่</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">วันที่ยื่น</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ผู้แจ้ง</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ผู้รับผิดชอบ</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ความเร่งด่วน</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">สถานะ</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold text-white">การดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paginatedFiltered.map((c, i) => (
                    <tr key={c.id}
                      className="cursor-pointer transition-colors"
                      style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f5f8fc'}
                      onClick={() => setSelectedComplaint(c)}>
                      <td className="px-3 py-2 text-center text-xs text-gray-500 border-r border-gray-200">{complaintStartIdx + i + 1}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap border-r border-gray-200">
                        {c.ref_no ? c.ref_no.replace(/^[A-Z]+-/, '') : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-800 text-xs whitespace-nowrap border-r border-gray-200">
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap border-r border-gray-200">
                        {(c.village || c.location_name)
                          ? <span className="flex items-center gap-1"><MapPin size={10} className="text-gray-400 shrink-0" />{c.village || c.location_name}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap border-r border-gray-200">
                        {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 border-r border-gray-200 min-w-[110px]">
                        {(() => {
                          const name = c.reporter_name || c.profiles?.full_name
                          const phone = c.phone || c.profiles?.phone
                          return (
                            <div className="flex flex-col gap-0.5">
                              {name
                                ? <span className="text-xs font-medium text-gray-700 truncate max-w-[120px]">{name}</span>
                                : <span className="text-gray-300 text-xs">ไม่ระบุ</span>}
                              {phone && (
                                <a href={`tel:${phone}`} onClick={e => e.stopPropagation()}
                                  className="text-[10px] text-blue-500 hover:underline">{phone}</a>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap border-r border-gray-200">
                        {c.assigned_to
                          ? <span className="flex items-center gap-1 text-blue-700 font-medium"><Wrench size={10} className="shrink-0" />{technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ผู้รับผิดชอบ'}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 border-r border-gray-200">
                        {c.priority && c.priority !== 'normal'
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap border"
                              style={{ backgroundColor: PRIORITY[c.priority]?.bg, color: PRIORITY[c.priority]?.text, borderColor: PRIORITY[c.priority]?.color + '40' }}>
                              {PRIORITY[c.priority]?.short}
                            </span>
                          : <span className="text-gray-300 text-xs">ปกติ</span>}
                      </td>
                      <td className="px-3 py-2 border-r border-gray-200">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
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
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-gray-200 md:bg-[#f5f8fc]">
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
          onPriority={updatePriority}
          currentUserRole={currentUserRole ?? 'staff'}
          onDelete={handleDeleteComplaint}
        />
      )}
    </div>
  )
}
