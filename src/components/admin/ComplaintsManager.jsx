import { useEffect, useState, useCallback, useRef } from 'react'
import MapPicker from '../MapPicker'
import {
  ClipboardList, Clock, Loader2, CheckCircle2, XCircle, AlertCircle,
  ChevronRight, ChevronLeft, Filter, Search, Phone, Trash2, Wrench,
  MapPin, X, FileText, AlignLeft, Camera, ChevronDown,
  Shield, Printer, Users, RefreshCw, AlertTriangle, Building2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { notifyTelegram } from '../../lib/notifyTelegram'
import { compressImage } from '../../lib/imageUtils'
import { logAction } from '../../lib/auditLog'
import { fetchComplaintPrivateDetail, fetchRoleScopedComplaints } from '../../lib/complaintPrivacy'
import { buildCouncilComplaintHtml } from '../../lib/councilFormPrint'
import { generateDraftPdfBlob } from '../../lib/generateDraftPdf'
import { uploadFile, resolvePrivateFileUrl, isPrivateDriveRef, driveFileIdFromRef, toReliableImageUrl } from '../../lib/driveStorage'
import { fetchAssignableStaff, groupStaffByDepartment, ROLE_LABELS } from '../../lib/staffRoster'
import { fetchPersonnelSignatories } from '../../lib/personnelDirectory'
import OssIntakeForm from './OssIntakeForm'
import OdorFieldsDisplay, { OdorAckBadge } from '../complaints/OdorFieldsDisplay'

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
let CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าสาธารณะ',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ต้นไม้/สวนสาธารณะ',
  noise: 'เหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', building: 'ตรวจสอบอาคาร',
  mosquito: 'พ่นยุง', canal: 'ลอกคลอง',
  animals: 'สุนัขจรจัด', water_supply: 'สนับสนุนน้ำอุปโภค',
  borrow_equipment: 'ยืมพัสดุ', grievance: 'ร้องทุกข์/ร้องเรียน',
  corruption: 'แจ้งการทุจริต', tax: 'ภาษีและค่าธรรมเนียม',
  disease: 'ควบคุมโรคติดต่อ', other: 'อื่นๆ',
}
let CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', water_supply: '🚿',
  borrow_equipment: '📦', grievance: '📣', disease: '🏥', other: '📝',
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
    <div className="flex min-h-16 items-center gap-2.5 rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
           style={{ backgroundColor: `${color}20` }}>
        <Icon size={18} strokeWidth={2.1} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-extrabold leading-none text-slate-800">{value}</p>
        <p className="mt-1 truncate text-[10px] font-medium leading-none text-slate-500">{label}</p>
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

// ไฟล์ที่อัปโหลดขึ้น Google Drive (uc?id=... เดิม หรือ lh3.googleusercontent.com/d/... ใหม่) ไม่มีนามสกุล
// ไฟล์ต่อท้าย URL เลย เช็คจาก .jpg/.png ท้าย URL แบบเดิมเลยพังใช้ไม่ได้กับไฟล์เหล่านี้ (เข้าเงื่อนไข "ไม่ใช่
// รูป" เสมอ ทั้งที่จริงเป็นรูป) — ให้เบราว์เซอร์ลองโหลดเป็นรูปดูก่อนเลย พังค่อย fallback เป็นไอคอนไฟล์แทน
function AttachmentThumb({ url, alt, iconClassName }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <FileText size={22} className={iconClassName} />
  return <img src={toReliableImageUrl(url)} alt={alt} className="w-full h-full object-cover" onError={() => setFailed(true)} />
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

const LEGACY_STATUS = { pending: 'new', completed: 'done', received: 'received' }
function normalizeActionStatus(s) { return LEGACY_STATUS[s] ?? s ?? 'new' }

function ActionButton({ status, id, onUpdate, loading, size = 'sm', tenant }) {
  const action = NEXT_ACTION[normalizeActionStatus(status)]
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  if (!action) return null
  const withPhoto = action.next === 'done'
  function handleClose() { setConfirm(false); setNote(''); setPendingFiles([]) }
  async function handleConfirm() {
    if (withPhoto && pendingFiles.length > 0) {
      setUploading(true)
      const urls = []
      for (const f of pendingFiles) {
        const ext = f.name.split('.').pop()
        const compressed = await compressImage(f, 1200)
        const { url, error } = await uploadFile('complaint-attachments', compressed, {
          subject: id,
          filename: `work_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`,
          municipality: tenant?.slug,
        })
        if (!error) urls.push(url)
      }
      setUploading(false)
      onUpdate(id, action.next, urls, note.trim() || null)
    } else {
      onUpdate(id, action.next, [], note.trim() || null)
    }
    handleClose()
  }
  function handleFiles(e) {
    setPendingFiles(prev => [...prev, ...Array.from(e.target.files)])
    e.target.value = ''
  }
  return (
    <>
      <button onClick={() => setConfirm(true)} disabled={loading === id}
        className={size === 'lg'
          ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white whitespace-nowrap shadow-sm transition-all active:scale-95 disabled:opacity-50'
          : size === 'xs'
            ? 'inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-semibold text-white whitespace-nowrap transition-all active:scale-95 disabled:opacity-50'
            : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[13px] font-semibold text-white whitespace-nowrap transition-all active:scale-95 disabled:opacity-50'}
        style={{ backgroundColor: 'var(--color-primary)' }}>
        {loading === id ? <Loader2 size={size === 'lg' ? 15 : 12} className="animate-spin" /> : <ChevronRight size={size === 'lg' ? 15 : 12} />}
        {action.label}
      </button>
      {confirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={handleClose}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-80 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการเปลี่ยนสถานะ</p>
            <p className="text-xs text-gray-500 mb-3">ต้องการ <span className="font-medium text-gray-800">"{action.label}"</span> ใช่หรือไม่?</p>
            {withPhoto && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Camera size={11} /> รูปภาพหลังดำเนินการ (ไม่บังคับ)</p>
                <label className="flex items-center justify-center gap-2 w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-500 cursor-pointer hover:border-blue-300 hover:text-blue-500 transition-colors">
                  <Camera size={13} /> เพิ่มรูปภาพ
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
                </label>
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {pendingFiles.map((f, i) => (
                      <div key={i} className="relative">
                        <img src={URL.createObjectURL(f)} alt="" className="w-14 h-14 object-cover rounded-lg" />
                        <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white leading-none text-[11px]">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 mb-3" />
            <div className="flex gap-2">
              <button onClick={handleConfirm} disabled={loading === id || uploading}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-1"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {uploading ? <><Loader2 size={13} className="animate-spin" /> กำลังอัปโหลด...</> : 'ยืนยัน'}
              </button>
              <button onClick={handleClose}
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

function RejectButton({ status, id, onUpdate, loading, compact = false }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const activeStatuses = ['new', 'pending', 'received', 'in_progress']
  if (!activeStatuses.includes(status)) return null

  function handleConfirm() {
    if (!reason.trim()) { setErr('กรุณาระบุเหตุผลการปฏิเสธ'); return }
    onUpdate(id, 'rejected', [], reason.trim())
    setOpen(false); setReason(''); setErr('')
  }
  return (
    <>
      <button onClick={() => setOpen(true)} disabled={loading === id}
        className={compact
          ? 'inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50 whitespace-nowrap'
          : 'inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50'}>
        <XCircle size={compact ? 11 : 12} /> ปฏิเสธ
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

function AvatarLightbox({ src, name }) {
  const [big, setBig] = useState(false)
  return (
    <>
      <div className="flex justify-center py-4 border-b border-gray-50">
        <img src={src} alt={name} onClick={() => setBig(true)}
          className="w-20 h-20 rounded-full object-cover border-2 border-blue-100 shadow-sm cursor-zoom-in hover:scale-105 transition-transform" />
      </div>
      {big && (
        <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setBig(false)}>
          <img src={src} alt={name}
            className="max-w-[80vw] max-h-[80vh] rounded-2xl shadow-2xl object-contain" />
        </div>
      )}
    </>
  )
}

function ReporterCard({ c }) {
  const [open, setOpen] = useState(false)
  const p = c.profiles
  const name = c.reporter_name || p?.full_name || 'ไม่ระบุชื่อ'
  const phone = c.phone || p?.phone
  const email = p?.email
  const avatar = p?.avatar_url
  const joinDate = p?.created_at ? new Date(p.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) : null
  const isRegistered = !!c.user_id
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">ข้อมูลผู้แจ้ง</p>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full bg-blue-50 rounded-2xl p-4 border border-blue-100 flex items-center gap-3 text-left hover:bg-blue-100 transition-colors">
        <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-blue-100 flex items-center justify-center">
          {avatar
            ? <img src={avatar} alt={name} className="w-full h-full object-cover" />
            : <Users size={18} className="text-blue-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800">{name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {email || phone || (isRegistered ? `ID: ${c.user_id.slice(0, 8)}` : 'ไม่ได้เข้าสู่ระบบ')}
          </p>
        </div>
        <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {avatar && (
            <AvatarLightbox src={avatar} name={name} />
          )}
          <div className="divide-y divide-gray-50">
            {[
              { label: 'ชื่อ-นามสกุล', value: name },
              { label: 'อีเมล', value: email },
              { label: 'เบอร์โทร', value: phone },
              { label: 'สถานะบัญชี', value: isRegistered ? 'ลงทะเบียนแล้ว' : 'Guest (ไม่ได้ล็อกอิน)' },
              { label: 'วันที่สมัคร', value: joinDate },
              { label: 'User ID', value: c.user_id ? c.user_id.slice(0, 16) + '…' : null, mono: true },
            ].filter(r => r.value).map(r => (
              <div key={r.label} className="flex items-start gap-3 px-4 py-2.5">
                <span className="text-xs text-gray-400 w-24 shrink-0 pt-0.5">{r.label}</span>
                <span className={`text-xs text-gray-800 font-medium flex-1 ${r.mono ? 'font-mono' : ''}`}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ComplaintDetailModal({ complaint: c, onClose, onUpdate, updating, technicians, onAssign, onPriority, currentUserRole, currentUserId, onDelete, onPinSave, onDocumentUpdate }) {
  const { tenant, terminology } = useTenant()
  const isAdminRole = ['admin', 'superadmin'].includes(currentUserRole)
  const isTechAssigned = currentUserRole === 'technician' && c.assigned_to === currentUserId
  const canAct = isAdminRole || isTechAssigned
  // staff เห็นหน้าคำร้องเต็มรูปแบบและจัดการเอกสาร GDCC ได้ แต่เปลี่ยนสถานะ/มอบหมายงานไม่ได้
  // (ทุกจุดที่เปลี่ยนสถานะยังผูกกับ canAct/isAdminRole เหมือนเดิม ไม่ได้แก้)
  const canManageDocs = isAdminRole || currentUserRole === 'staff'
  // จัดกลุ่มตามกอง ใช้ render dropdown มอบหมายเป็น <optgroup> — คนหลักสิบ/ร้อยคนจะได้ไม่ต้องไล่หาในลิสต์แบนราบ
  const technicianGroups = groupStaffByDepartment(technicians ?? [])
  const [assigning, setAssigning] = useState(false)
  const [showCloseJob, setShowCloseJob] = useState(false)
  const [pendingPhotos, setPendingPhotos] = useState([])
  const [closeNote, setCloseNote] = useState('')
  const [closeUploading, setCloseUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [overrideConfirm, setOverrideConfirm] = useState(null)
  const [overrideNote, setOverrideNote] = useState('')
  const [nearbyList, setNearbyList] = useState([])
  const [showPinEdit, setShowPinEdit] = useState(false)
  const [savingPin, setSavingPin] = useState(false)
  const [pendingAssign, setPendingAssign] = useState(null)
  const [pendingPriority, setPendingPriority] = useState(null)
  const [extraWorkPhotos, setExtraWorkPhotos] = useState([])
  const [wpUploading, setWpUploading] = useState(false)
  const [docBusy, setDocBusy] = useState(false)
  const [docError, setDocError] = useState(null)
  const [finalDocFile, setFinalDocFile] = useState(null)
  const [receiptNo, setReceiptNo] = useState('')

  async function handleAddWorkPhotos(files) {
    if (!files.length || wpUploading) return
    setWpUploading(true)
    const urls = []
    for (const f of files) {
      const ext = f.name.split('.').pop()
      const compressed = await compressImage(f, 1200)
      const { url, error } = await uploadFile('complaint-attachments', compressed, {
        subject: c.id,
        filename: `work_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`,
        municipality: tenant?.slug,
      })
      if (!error) urls.push(url)
    }
    if (urls.length > 0) {
      const allPhotos = [...(c.work_photos ?? []), ...extraWorkPhotos, ...urls]
      await supabase.from('complaints').update({ work_photos: allPhotos }).eq('id', c.id)
      setExtraWorkPhotos(prev => [...prev, ...urls])
      onUpdate(c.id, c.status, allPhotos)
    }
    setWpUploading(false)
  }

  async function handleSavePin({ lat, lng }) {
    setSavingPin(true)
    const { error } = await supabase
      .from('complaints')
      .update({ latitude: lat, longitude: lng })
      .eq('id', c.id)
    setSavingPin(false)
    if (!error) {
      setShowPinEdit(false)
      onPinSave?.(c.id, lat, lng)
    }
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

  async function handlePrintComplaint() {
    // ต้องเปิดหน้าต่างทันทีแบบ sync ในตอนคลิก ก่อน await ใดๆ — ถ้าเปิดหลัง await
    // เบราว์เซอร์จะตัดขาดจาก user gesture แล้ว popup blocker จะบล็อกเงียบๆ (ไม่ error
    // ให้เห็น) ครั้งแรกอาจหลุดผ่านมาได้ แต่ครั้งต่อไปจะกดไม่ติดเลย
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) {
      alert('เบราว์เซอร์บล็อกป๊อปอัพ กรุณาอนุญาตป๊อปอัพสำหรับเว็บไซต์นี้แล้วลองใหม่')
      return
    }

    const d = new Date(c.created_at)
    const thDate = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    const num = c.ref_no ?? '—'
    const phone = c.phone || c.profiles?.phone || '—'
    const cat = CATEGORY_LABEL[c.category] ?? c.category ?? '—'

    // ใบคำร้องทางการ — ใช้แบบเดียวกันทุกคำร้อง ไม่ว่าผู้แจ้งจะเป็นประชาชนหรือสมาชิกสภา
    const { data: staffList } = await fetchPersonnelSignatories(tenant?.id)
    const html = buildCouncilComplaintHtml({ c, tenant, terminology, num, thDate, cat, phone, staffList })
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  async function handleExportDraftPdf() {
    setDocBusy(true)
    setDocError(null)
    try {
      const d = new Date(c.created_at)
      const thDate = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
      const num = c.ref_no ?? '—'
      const phone = c.phone || c.profiles?.phone || '—'
      const cat = CATEGORY_LABEL[c.category] ?? c.category ?? '—'
      const { data: staffList } = await fetchPersonnelSignatories(tenant?.id)
      const html = buildCouncilComplaintHtml({ c, tenant, terminology, num, thDate, cat, phone, staffList, includeStaffSignatures: false })

      const blob = await generateDraftPdfBlob(html)
      const { url: driveRef, error: upErr } = await uploadFile('official-documents', blob, {
        subject: c.id,
        filename: `draft_${Date.now()}.pdf`,
        municipality: tenant?.slug,
      })
      if (upErr) throw upErr

      const { error: dbErr } = await supabase.from('complaints').update({ draft_pdf_path: driveRef }).eq('id', c.id)
      if (dbErr) throw dbErr

      onDocumentUpdate?.(c.id, { draft_pdf_path: driveRef })

      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${num}_draft.pdf`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      setDocError(err?.message ?? 'สร้าง PDF ไม่สำเร็จ')
    } finally {
      setDocBusy(false)
    }
  }

  async function handleUploadFinalDoc() {
    if (!finalDocFile) { setDocError('กรุณาแนบไฟล์ PDF ฉบับสมบูรณ์'); return }
    if (!receiptNo.trim()) { setDocError('กรุณากรอกเลขรับหนังสือ'); return }
    setDocBusy(true)
    setDocError(null)
    try {
      const { url: driveRef, error: upErr } = await uploadFile('official-documents', finalDocFile, {
        subject: c.id,
        filename: `final_${Date.now()}.pdf`,
        municipality: tenant?.slug,
      })
      if (upErr) throw upErr

      const patch = {
        final_document_path: driveRef,
        official_receipt_no: receiptNo.trim(),
        document_uploaded_at: new Date().toISOString(),
        document_uploaded_by: currentUserId ?? null,
      }
      const { error: dbErr } = await supabase.from('complaints').update(patch).eq('id', c.id)
      if (dbErr) throw dbErr

      onDocumentUpdate?.(c.id, patch)
      setFinalDocFile(null)
    } catch (err) {
      setDocError(err?.message ?? 'บันทึกเอกสารไม่สำเร็จ')
    } finally {
      setDocBusy(false)
    }
  }

  // เอกสารส่วนตัว (official-documents) — path อาจเป็น Supabase Storage path เดิม (คำร้องเก่าก่อนย้าย
  // ระบบ) หรือ marker 'drive:fileId' ของใหม่ ต้องเช็คแล้วดึงคนละทาง
  // เปิดแท็บเปล่าไว้ก่อน sync กับ click event เอง (ไม่รอ await) กัน popup blocker บล็อก — ถ้าเปิดแท็บ
  // หลัง await resolvePrivateFileUrl เบราว์เซอร์จะไม่นับว่ามาจาก user gesture แล้ว
  async function openOfficialDoc(path) {
    const w = window.open('', '_blank')
    if (isPrivateDriveRef(path)) {
      const { url, error } = await resolvePrivateFileUrl(driveFileIdFromRef(path))
      if (error || !url) { w?.close(); alert('เปิดไฟล์ไม่สำเร็จ: ' + (error?.message ?? '')); return }
      if (w) w.location.href = url
      return
    }
    const { data, error } = await supabase.storage.from('official-documents').createSignedUrl(path, 1800)
    if (error || !data?.signedUrl) { w?.close(); alert('เปิดไฟล์ไม่สำเร็จ: ' + (error?.message ?? '')); return }
    if (w) w.location.href = data.signedUrl
  }

  async function handleDownloadFinalDoc() { await openOfficialDoc(c.final_document_path) }
  async function handleDownloadDraftPdf() { await openOfficialDoc(c.draft_pdf_path) }

  async function handleCloseJob() {
    setCloseUploading(true)
    const urls = []
    for (const item of pendingPhotos) {
      const ext = item.file.name.split('.').pop()
      const compressed = await compressImage(item.file, 1200)
      const { url, error } = await uploadFile('complaint-attachments', compressed, {
        subject: c.id,
        filename: `work_${Date.now()}.${ext}`,
        municipality: tenant?.slug,
      })
      if (!error) urls.push(url)
    }
    setCloseUploading(false)
    onUpdate(c.id, 'done', urls, closeNote.trim() || null)
    onClose()
  }

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
            className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white shadow-lg hover:bg-gray-100 active:scale-95 transition-all">
            <X size={20} className="text-gray-700" strokeWidth={2.5} />
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

          {canManageDocs && ['new', 'received'].includes(normalizeActionStatus(c.status)) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">เอกสารทางการ (GDCC e-Office)</p>
              <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100 space-y-3">
                {docError && <p className="text-xs text-red-600 font-medium">{docError}</p>}

                {!c.draft_pdf_path && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Export PDF ฉบับร่างเพื่อนำไปยื่นลงนามที่ GDCC e-Office</p>
                    <button type="button" onClick={handleExportDraftPdf} disabled={docBusy}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-50"
                      style={{ backgroundColor: '#6366f1' }}>
                      {docBusy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                      Export คำร้องเป็น Draft PDF
                    </button>
                  </div>
                )}

                {c.draft_pdf_path && !c.final_document_path && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">Draft PDF ถูกดาวน์โหลดไปแล้ว — หลังได้ PDF ที่ลงนามแล้วจาก GDCC ให้แนบกลับที่นี่</p>
                    <button type="button" onClick={handleDownloadDraftPdf}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-indigo-600 bg-white border border-indigo-200 hover:bg-indigo-50 transition-colors">
                      <RefreshCw size={13} />
                      ดาวน์โหลด Draft PDF ซ้ำ
                    </button>
                    <input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)}
                      placeholder="เลขรับหนังสือ (เลขรับ นล.)"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs text-gray-900 bg-white focus:outline-none focus:border-indigo-400" />
                    <input type="file" accept="application/pdf"
                      onChange={(e) => setFinalDocFile(e.target.files?.[0] ?? null)}
                      className="w-full text-xs text-gray-500" />
                    <button type="button" onClick={handleUploadFinalDoc} disabled={docBusy}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-50"
                      style={{ backgroundColor: '#6366f1' }}>
                      {docBusy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                      บันทึกเอกสารฉบับสมบูรณ์
                    </button>
                  </div>
                )}

                {c.final_document_path && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">เลขรับหนังสือ: <span className="font-semibold text-gray-700">{c.official_receipt_no}</span></p>
                    {c.document_uploaded_at && (
                      <p className="text-[11px] text-gray-400">
                        แนบเมื่อ {new Date(c.document_uploaded_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                    <button type="button" onClick={handleDownloadFinalDoc}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-indigo-600 bg-white border border-indigo-200 hover:bg-indigo-50 transition-colors">
                      <FileText size={13} />
                      ดาวน์โหลดเอกสารฉบับสมบูรณ์
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

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
                  {isAdminRole ? (
                    <>
                      <select value={c.assigned_to ?? ''}
                        onChange={(e) => setPendingAssign(e.target.value || null)}
                        disabled={assigning}
                        className="text-xs border border-orange-200 rounded-xl px-2 py-1.5 bg-white text-gray-700 focus:outline-none">
                        <option value="">— เลือกผู้รับผิดชอบ —</option>
                        {technicianGroups.map((g) => (
                          <optgroup key={g.department_name} label={g.department_name}>
                            {g.members.map((t) => (
                              <option key={t.id} value={t.id}>
                                {(t.full_name || t.email) + (t.is_dept_head ? ' ⭐' : '')} · {ROLE_LABELS[t.role]?.label ?? t.role}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {assigning && <Loader2 size={14} className="animate-spin text-orange-400 shrink-0" />}
                    </>
                  ) : (
                    <span className="text-xs text-gray-400 italic">เฉพาะ Admin</span>
                  )}
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
                          onClick={() => { if ((c.priority ?? 'normal') !== k) setPendingPriority(k) }}
                          className="px-2.5 py-1 rounded-xl text-[13px] font-bold transition-all border"
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

          <ReporterCard c={c} />

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
                {c.latitude ? (
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
                      {canAct && (
                        <button type="button"
                          onClick={() => setShowPinEdit(true)}
                          className="text-xs font-semibold px-2 py-1 rounded-lg bg-orange-100 text-orange-700">
                          แก้ไขหมุด
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  canAct && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-orange-50/50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                          <MapPin size={15} className="text-orange-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-orange-600 font-medium">ยังไม่มีพิกัด GPS</p>
                          <p className="text-xs text-gray-400">ระบุตำแหน่งพิกัดเพื่อแสดงผลบนแผนที่</p>
                        </div>
                      </div>
                      <button type="button"
                        onClick={() => setShowPinEdit(true)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-orange-500 text-white hover:bg-orange-600 transition-colors shrink-0">
                        เพิ่มพิกัด
                      </button>
                    </div>
                  )
                )}
                {showPinEdit && (
                  <div className="fixed inset-0 z-9999">
                    <MapPicker
                      initialPos={c.latitude ? { lat: c.latitude, lng: c.longitude } : null}
                      fallbackPos={tenant?.latitude ? { lat: tenant.latitude, lng: tenant.longitude } : { lat: 18.1448, lng: 100.1167 }}
                      onConfirm={handleSavePin}
                      onClose={() => setShowPinEdit(false)}
                    />
                  </div>
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

          {c.issue_type && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">ลักษณะปัญหา</p>
              <span className="inline-block text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
                {c.issue_type}
              </span>
            </div>
          )}

          {c.category === 'odor' && c.extra_data && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดเพิ่มเติม (กลิ่นเหม็น)</p>
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-1.5 text-sm text-gray-700">
                <p>ระดับความรุนแรง: {c.extra_data.odor_intensity ?? '-'} / 5</p>
                <p>ทิศทางลม: {c.extra_data.wind_direction ?? '-'}</p>
                <p>อาการทางสุขภาพ: {c.extra_data.health_effect ?? 'ไม่มี'}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดแนบมา</p>
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.detail}</p>
            </div>
          </div>

          {(c.attachments ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Camera size={12} /> รูปภาพจากผู้แจ้ง ({c.attachments.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {c.attachments.map((url, i) => (
                  <a key={i} href={toReliableImageUrl(url)} target="_blank" rel="noreferrer"
                    className="aspect-square rounded-xl overflow-hidden border border-blue-100 bg-blue-50 flex items-center justify-center">
                    <AttachmentThumb url={url} alt={`แนบ ${i + 1}`} iconClassName="text-blue-400" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {((c.work_photos ?? []).length > 0 || extraWorkPhotos.length > 0 || isAdminRole) && (
            <div className="space-y-2 pb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Camera size={12} /> หลังดำเนินการ ({(c.work_photos ?? []).length + extraWorkPhotos.length})
              </p>
              {[...(c.work_photos ?? []), ...extraWorkPhotos].length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {[...(c.work_photos ?? []), ...extraWorkPhotos].map((url, i) => (
                    <a key={i} href={toReliableImageUrl(url)} target="_blank" rel="noreferrer"
                      className="aspect-square rounded-xl overflow-hidden border border-green-200 bg-green-50 flex items-center justify-center">
                      <AttachmentThumb url={url} alt={`ผลงาน ${i + 1}`} iconClassName="text-green-400" />
                    </a>
                  ))}
                </div>
              )}
              {isAdminRole && (
                <label className="relative flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-green-300 text-green-600 text-xs font-medium cursor-pointer hover:bg-green-50 transition-colors">
                  {wpUploading
                    ? <><Loader2 size={12} className="animate-spin" /> กำลังอัปโหลด...</>
                    : <><Camera size={12} /> เพิ่มรูปหลักฐาน</>}
                  <input type="file" accept="image/*" multiple className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                    disabled={wpUploading}
                    onChange={(e) => { handleAddWorkPhotos(Array.from(e.target.files)); e.target.value = '' }} />
                </label>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0 bg-gray-50">
          {!canAct ? (
            <div className="flex gap-2">
              <button onClick={handlePrintComplaint}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                <Printer size={13} /> พิมพ์
              </button>
              <button onClick={onClose} className="ml-auto px-4 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors">
                ปิดหน้าต่าง
              </button>
            </div>
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
                    : <><CheckCircle2 size={14} /> ยืนยันดำเนินการแล้ว</>}
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
            <div className="flex gap-2 flex-wrap items-center">
              <ActionButton status={c.status} id={c.id}
                onUpdate={(id, next, wp = [], note = null) => { onUpdate(id, next, wp, note); onClose() }}
                loading={updating} size="lg" tenant={tenant} />
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

          {(currentUserRole === 'superadmin' || currentUserRole === 'admin') && (
            <div className={`mt-3 pt-3 border-t border-dashed ${currentUserRole === 'superadmin' ? 'border-purple-200' : 'border-gray-200'}`}>
              <p className={`text-[13px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1 ${currentUserRole === 'superadmin' ? 'text-purple-400' : 'text-gray-400'}`}>
                <Shield size={10} /> {currentUserRole === 'superadmin' ? 'Superadmin — แก้ไขสถานะ' : 'เปลี่ยนสถานะ (Admin)'}
              </p>
              <div className="flex items-center gap-2">
                <FixedSelect
                  value={c.status}
                  onChange={(val) => { setOverrideNote(''); setOverrideConfirm(val) }}
                  options={STATUS_MAIN.map(key => ({ value: key, label: STATUS[key].label }))}
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
            <p className="text-xs text-gray-500 mb-3">
              เปลี่ยนเป็น <span className="font-medium text-gray-800">"{STATUS[overrideConfirm]?.label}"</span> ใช่หรือไม่?
            </p>
            <textarea value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} rows={2}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 mb-3" />
            <div className="flex gap-2">
              <button onClick={() => { onUpdate(c.id, overrideConfirm, [], overrideNote.trim() || null); setOverrideConfirm(null); setOverrideNote(''); onClose() }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                ยืนยัน
              </button>
              <button onClick={() => { setOverrideConfirm(null); setOverrideNote('') }}
                className="flex-1 py-2 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAssign !== undefined && pendingAssign !== c.assigned_to && pendingAssign !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setPendingAssign(null)}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-72 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการมอบหมาย</p>
            <p className="text-xs text-gray-500 mb-4">
              มอบหมายให้ <span className="font-medium text-gray-800">
                {technicians.find(t => t.id === pendingAssign)?.full_name ?? 'ผู้รับผิดชอบ'}
              </span> ใช่หรือไม่?
            </p>
            <div className="flex gap-2">
              <button onClick={async () => {
                  setAssigning(true)
                  await onAssign(c.id, pendingAssign)
                  setAssigning(false)
                  setPendingAssign(null)
                }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                ยืนยัน
              </button>
              <button onClick={() => setPendingAssign(null)}
                className="flex-1 py-2 rounded-xl text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingPriority && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={() => setPendingPriority(null)}>
          <div className="bg-white rounded-2xl p-5 shadow-xl w-72 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-800 mb-1">ยืนยันการเปลี่ยนความเร่งด่วน</p>
            <p className="text-xs text-gray-500 mb-4">
              เปลี่ยนเป็น <span className="font-medium" style={{ color: PRIORITY[pendingPriority]?.text }}>
                {PRIORITY[pendingPriority]?.label}
              </span> ใช่หรือไม่?
            </p>
            <div className="flex gap-2">
              <button onClick={() => { onPriority(c.id, pendingPriority); setPendingPriority(null) }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                ยืนยัน
              </button>
              <button onClick={() => setPendingPriority(null)}
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
  const { session } = useAuth()
  const tenantId = tenant?.id
  const currentUserId = session?.user?.id
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading]       = useState(true)
  const [openingComplaintId, setOpeningComplaintId] = useState(null)
  const openedExternalComplaintIdRef = useRef(null)
  const [updating, setUpdating]     = useState(null)
  const [filterTab, setFilterTab]   = useState(0)
  // แท็ปแยกต่างหากสำหรับหมวด "กลิ่นเหม็นรบกวน" (เฉพาะกิจ ส่งตรงผู้รับผิดชอบ ไม่ผ่านแอดมิน) — ดูอย่างเดียว
  // ไม่ใช้ FILTER_TABS/filterTab เดิมเพราะ array นั้นชี้ enum สถานะ ไม่ใช่หมวดคำร้อง
  const [odorTabActive, setOdorTabActive] = useState(false)
  const [odorExpandedId, setOdorExpandedId] = useState(null)
  const [search, setSearch]         = useState('')
  const [complaintPage, setComplaintPage]         = useState(1)
  const [complaintsPerPage, setComplaintsPerPage] = useState(10)
  const [filterCategory, setFilterCategory]       = useState('')
  const [filterVillage, setFilterVillage]         = useState('')
  const [filterTechnician, setFilterTechnician]   = useState('')
  const [filterPriority, setFilterPriority]       = useState('')
  const [filterDepartment, setFilterDepartment]   = useState('')
  const [selectedComplaint, setSelectedComplaint] = useState(null)
  const [showOssIntake, setShowOssIntake]         = useState(false)
  const [technicians, setTechnicians]             = useState([])
  const [selectedIds, setSelectedIds]             = useState(() => new Set())
  const [bulkDeleting, setBulkDeleting]           = useState(false)
  const canBulkDelete = ['admin', 'superadmin'].includes(currentUserRole)

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAllVisible(ids) {
    setSelectedIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id))
      if (allSelected) return new Set()
      return new Set(ids)
    })
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (!window.confirm(`ลบคำร้อง ${ids.length} รายการที่เลือกไว้ออกจากระบบ?\n\nการลบไม่สามารถย้อนกลับได้`)) return
    setBulkDeleting(true)
    const { error } = await supabase.from('complaints').delete().in('id', ids)
    setBulkDeleting(false)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    setComplaints(prev => prev.filter(c => !selectedIds.has(c.id)))
    if (selectedComplaint && selectedIds.has(selectedComplaint.id)) setSelectedComplaint(null)
    setSelectedIds(new Set())
  }

  function handlePinSave(complaintId, lat, lng) {
    setComplaints(prev => prev.map(comp => comp.id === complaintId ? { ...comp, latitude: lat, longitude: lng } : comp))
    setSelectedComplaint(prev => prev?.id === complaintId ? { ...prev, latitude: lat, longitude: lng } : prev)
  }

  function handleDocumentPatch(complaintId, patch) {
    setComplaints(prev => prev.map(comp => comp.id === complaintId ? { ...comp, ...patch } : comp))
    setSelectedComplaint(prev => prev?.id === complaintId ? { ...prev, ...patch } : prev)
  }

  // ดึงหมวดหมู่คำร้องที่ Admin สร้างเอง merge เข้า CATEGORY_LABEL/EMOJI
  const [, setCatVer] = useState(0)
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji').eq('municipality_id', tenant.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          for (const c of data) {
            CATEGORY_LABEL[c.value] = c.label
            if (c.emoji) CATEGORY_EMOJI[c.value] = c.emoji
          }
          setCatVer(v => v + 1)
        }
      })
  }, [tenant?.id])

  const fetchTechnicians = useCallback(async () => {
    if (!tenantId) return
    // ใช้ helper กลางร่วมกับหน้า "จัดการประเภทคำร้อง" (AdminDashboard.jsx) กัน pool คนไม่ตรงกันแบบที่
    // เคยเป็นบั๊กมาก่อน (คนที่ตั้งเป็นผู้รับผิดชอบหมวดไว้ไม่โผล่ใน dropdown มอบหมายรายคำร้อง)
    const data = await fetchAssignableStaff(tenantId)
    setTechnicians(data)
  }, [tenantId])

  const fetchComplaints = useCallback(async () => {
    if (!tenantId) return
    const { data, error } = await fetchRoleScopedComplaints(tenantId)
    if (error) console.error('fetch complaints error:', error.message)
    setComplaints(data ?? [])
    setLoading(false)
  }, [tenantId])

  const openComplaint = useCallback(async (complaint) => {
    if (!complaint?.id || openingComplaintId === complaint.id) return
    setOpeningComplaintId(complaint.id)
    const { data, error } = await fetchComplaintPrivateDetail(
      complaint.id,
      'เปิดรายละเอียดจากหน้าจัดการคำร้อง',
    )
    setOpeningComplaintId(null)
    if (error) {
      console.error('fetch complaint private detail error:', error.message)
      const permissionDenied = error.code === '42501'
        || /permission denied|complaint access denied|authenticated profile required/i.test(error.message ?? '')
      alert(permissionDenied
        ? 'ไม่มีสิทธิ์เปิดข้อมูลส่วนบุคคลของคำร้องนี้'
        : `เปิดรายละเอียดคำร้องไม่สำเร็จ${import.meta.env.DEV && error.message ? `\n${error.message}` : ' กรุณาลองใหม่อีกครั้ง'}`)
      return
    }
    if (data) setSelectedComplaint(data)
  }, [openingComplaintId])

  useEffect(() => { queueMicrotask(fetchTechnicians) }, [fetchTechnicians])
  useEffect(() => { queueMicrotask(fetchComplaints) }, [fetchComplaints])

  useEffect(() => {
    if (!tenantId) return
    const ch = supabase.channel(`complaints-mgr-${tenantId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaints' },
        ({ new: row }) => {
          if (row.municipality_id !== tenantId) return
          fetchComplaints()
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'complaints' },
        ({ new: row }) => {
          if (row.municipality_id !== tenantId) return
          fetchComplaints()
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [tenantId, fetchComplaints])

  useEffect(() => {
    if (!openComplaintId) {
      openedExternalComplaintIdRef.current = null
      return
    }
    if (complaints.length === 0 || openedExternalComplaintIdRef.current === openComplaintId) return
    const found = complaints.find(c => c.id === openComplaintId)
    if (found) {
      openedExternalComplaintIdRef.current = openComplaintId
      if (found.category === 'odor') {
        // เฉพาะกิจ ดูอย่างเดียว — ห้ามเปิด ComplaintDetailModal เต็มรูปแบบ (มีปุ่มมอบหมาย/เปลี่ยนสถานะ)
        // ให้สลับไปแท็ปเฉพาะกิจแทน ผู้รับผิดชอบเป็นคนกดรับทราบเอง ไม่ใช่แอดมิน
        queueMicrotask(() => { setOdorTabActive(true); setOdorExpandedId(found.id) })
      } else {
        queueMicrotask(() => openComplaint(found))
      }
    }
  }, [complaints, openComplaintId, openComplaint])

  async function assignTechnician(complaintId, technicianId) {
    // เดิมเช็ค final_document_path แล้วเตือน "ยังไม่ได้แนบ PDF จาก GDCC e-Office" ก่อนมอบหมายงาน —
    // ตัดออกเพราะยังไม่ได้ใช้ระบบ e-Office จริง คำเตือนนี้ไม่เกี่ยวข้อง แค่ทำให้เสียเวลากดยืนยันเปล่าๆ
    const { error } = await supabase
      .from('complaints')
      .update({ assigned_to: technicianId })
      .eq('id', complaintId)
    if (!error) {
      setComplaints((prev) => prev.map((c) =>
        c.id === complaintId ? { ...c, assigned_to: technicianId } : c
      ))
      if (selectedComplaint?.id === complaintId)
        setSelectedComplaint((prev) => ({ ...prev, assigned_to: technicianId }))
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
      } else if (techNote && techNote !== (c?.technician_note ?? '') && c?.user_id) {
        // แจ้งประชาชนเมื่อเจ้าหน้าที่บันทึกข้อความใหม่ (เดิมไม่มี push เลย ต้องเข้าแอปมาเช็คเอง)
        // ไม่แจ้งซ้ำตอนปิดเรื่อง เพราะ branch ด้านบนมี push ของตัวเองอยู่แล้ว
        supabase.functions.invoke('send-push', {
          body: {
            user_id: c.user_id,
            title: 'เจ้าหน้าที่บันทึกข้อความถึงคุณ',
            body: `มีบันทึกใหม่ในคำร้อง${CATEGORY_LABEL[c?.category] ?? c?.category ?? ''}`,
            url: '/my-complaints',
          },
        }).catch(() => {})
      }

      notifyTelegram('complaint_status_updated', id)
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
    if (s === 'completed') return 'done'
    return s
  }

  // หมวด odor เป็นสายงานเฉพาะกิจ ส่งตรงผู้รับผิดชอบ ไม่ผ่านแอดมิน — กันออกจากแท็ปสถานะ/ตัวนับงานปกติทั้งหมด
  // เห็นเฉพาะในแท็ป "เฉพาะกิจ" ด้านล่างเท่านั้น
  const odorComplaints    = complaints.filter((c) => c.category === 'odor')
  const nonOdorComplaints = complaints.filter((c) => c.category !== 'odor')

  const filtered = nonOdorComplaints.filter((c) => {
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

  const baseFiltered = nonOdorComplaints.filter((c) => {
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
    acc[k] = nonOdorComplaints.filter((c) => normalizeStatus(c.status) === k).length
    return acc
  }, {})

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Stat cards — mobile grid / PC formal bar */}
      <div className="grid grid-cols-2 gap-2 md:hidden">
        <StatCard label="ทั้งหมด"         value={nonOdorComplaints.length}  icon={ClipboardList} color="#64748b" />
        <StatCard label="คำร้องใหม่"      value={counts.new ?? 0}           icon={Clock}         color="#f59e0b" />
        <StatCard label="กำลังดำเนินการ"  value={counts.in_progress ?? 0}   icon={AlertCircle}   color="#8b5cf6" />
        <StatCard label="ปิดเรื่องแล้ว"   value={counts.closed ?? 0}        icon={CheckCircle2}  color="#10b981" />
      </div>
      {/* PC stat bar */}
      <div className="hidden md:flex border border-gray-200 rounded-none bg-white divide-x divide-gray-200 shadow-sm">
        {[
          { label: 'คำร้องทั้งหมด',    value: nonOdorComplaints.length,   color: '#1a3a5c', bg: '#eef2f7' },
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
        <div className="px-4 sm:px-5 pt-4 pb-4 border-b border-gray-200 md:bg-[#f5f8fc] space-y-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="w-full shrink-0 font-semibold text-gray-700 md:hidden">รายการคำร้อง</h2>
            <div className="relative min-w-0 flex-1 basis-0 md:max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาคำร้อง..."
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent text-gray-900 bg-white"
                style={{ '--tw-ring-color': 'var(--color-primary)' }} />
            </div>
            <button onClick={handlePrintComplaints} title="พิมพ์"
              className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
              <Printer size={16} className="text-gray-500" />
            </button>
            <button onClick={fetchComplaints} disabled={loading} title="รีเฟรช"
              className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
              <RefreshCw size={15} className={`text-gray-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {['admin', 'superadmin', 'staff'].includes(currentUserRole) && (
              <button onClick={() => setShowOssIntake(true)}
                className="flex min-h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition-colors md:w-auto"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                <ClipboardList size={15} />
                รับแจ้งที่เคาน์เตอร์
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
            {FILTER_TABS.map((tab, i) => {
              const key = FILTER_KEYS[i]
              const active = filterTab === i && !odorTabActive
              const dotColor = key ? (STATUS[key]?.color ?? '#94a3b8') : '#64748b'
              return (
                <button key={i} onClick={() => { setFilterTab(i); setOdorTabActive(false) }}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    active ? 'text-white border-transparent' : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-50'
                  }`}
                  style={active ? { backgroundColor: 'var(--color-primary)' } : {}}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: active ? 'rgba(255,255,255,0.85)' : dotColor }} />
                  {tab}
                  {i > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                      active ? 'bg-white/25' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {nonOdorComplaints.filter((c) => normalizeStatus(c.status) === key).length}
                    </span>
                  )}
                </button>
              )
            })}
            {/* แท็ปเฉพาะกิจ: กลิ่นเหม็นรบกวน — ส่งตรงผู้รับผิดชอบ ไม่ผ่านแอดมิน, ดูอย่างเดียว (ไม่ปนกับ
                แท็ปสถานะข้างบน ไม่ใช้ FILTER_TABS/filterTab เพราะไม่ใช่สถานะ) */}
            {odorComplaints.length > 0 && (
              <button onClick={() => setOdorTabActive(true)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  odorTabActive ? 'text-white border-transparent' : 'text-lime-700 bg-lime-50 border-lime-200 hover:bg-lime-100'
                }`}
                style={odorTabActive ? { backgroundColor: '#65a30d' } : {}}>
                💨 กลิ่นเหม็นรบกวน (เฉพาะกิจ)
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                  odorTabActive ? 'bg-white/25' : 'bg-lime-200 text-lime-800'
                }`}>
                  {odorComplaints.length}
                </span>
              </button>
            )}
          </div>

          {/* Advanced filters */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Filter size={11} /> ตัวกรองเพิ่มเติม
            </p>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              <div className="relative">
                <FileText size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full appearance-none pl-7 pr-7 py-2 rounded-xl border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                  <option value="">ประเภททั้งหมด ({baseFiltered.length})</option>
                  {categoryOptions.map(([cat, count]) => (
                    <option key={cat} value={cat}>{CATEGORY_LABEL[cat] ?? cat} ({count})</option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <MapPin size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select value={filterVillage} onChange={(e) => setFilterVillage(e.target.value)}
                  className="w-full appearance-none pl-7 pr-7 py-2 rounded-xl border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                  <option value="">สถานที่ทั้งหมด ({baseFiltered.length})</option>
                  {villageOptions.map(([v, count]) => (
                    <option key={v} value={v}>{v} ({count})</option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <Users size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select value={filterTechnician} onChange={(e) => setFilterTechnician(e.target.value)}
                  className="w-full appearance-none pl-7 pr-7 py-2 rounded-xl border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                  <option value="">ผู้รับผิดชอบทั้งหมด ({baseFiltered.length})</option>
                  <option value="__none__">ยังไม่มอบหมาย ({techOptions.unassignedCount})</option>
                  {techOptions.opts.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.count})</option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <Building2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)}
                  className="w-full appearance-none pl-7 pr-7 py-2 rounded-xl border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                  <option value="">ทุกกอง ({nonOdorComplaints.length})</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d} ({nonOdorComplaints.filter(c => c.department === d).length})</option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <AlertTriangle size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
                  className="w-full appearance-none pl-7 pr-7 py-2 rounded-xl border border-gray-200 bg-white text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
                  style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                  <option value="">ความเร่งด่วนทั้งหมด</option>
                  {Object.entries(PRIORITY).map(([k, p]) => (
                    <option key={k} value={k}>{p.short} ({nonOdorComplaints.filter(c => (c.priority ?? 'normal') === k).length})</option>
                  ))}
                </select>
              </div>
            </div>

            {(filterCategory || filterVillage || filterTechnician || filterPriority || filterDepartment || filterTab !== 0 || search) && (
              <button
                onClick={() => { setFilterCategory(''); setFilterVillage(''); setFilterTechnician(''); setFilterPriority(''); setFilterDepartment(''); setFilterTab(0); setSearch('') }}
                className="mt-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 transition-colors flex items-center gap-1 w-fit">
                <X size={12} />
                ล้างตัวกรองทั้งหมด
              </button>
            )}
          </div>
        </div>

        {/* Bulk selection toolbar */}
        {canBulkDelete && selectedIds.size > 0 && (
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-red-50 border-y border-red-200">
            <span className="text-xs font-semibold text-red-700">เลือกไว้ {selectedIds.size} รายการ</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedIds(new Set())}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1">
                ยกเลิกเลือก
              </button>
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50">
                {bulkDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {bulkDeleting ? 'กำลังลบ...' : `ลบที่เลือก (${selectedIds.size})`}
              </button>
            </div>
          </div>
        )}

        {/* List */}
        {odorTabActive ? (
          /* แท็ปเฉพาะกิจ — ดูอย่างเดียว ไม่มีปุ่มมอบหมาย/เปลี่ยนสถานะ/ลบ ผู้รับผิดชอบกด "รับทราบ" เองที่
             แดชบอร์ดของตน (OdorAcknowledgePanel) ไม่ใช่หน้านี้ */
          odorComplaints.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <ClipboardList size={36} className="mb-2 opacity-30" />
              <p className="text-sm">ยังไม่มีคำร้องหมวดกลิ่นเหม็นรบกวน</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {odorComplaints.map((c) => {
                const isOpen = odorExpandedId === c.id
                const assignee = technicians.find(t => t.id === c.assigned_to)?.full_name
                return (
                  <div key={c.id} className="px-4 py-3.5">
                    <button type="button" onClick={() => setOdorExpandedId(isOpen ? null : c.id)}
                      className="w-full flex items-center justify-between gap-3 text-left">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{c.reporter_name || 'ไม่ระบุชื่อผู้แจ้ง'}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                          {' · ผู้รับผิดชอบ: '}{assignee ?? 'ยังไม่ได้ตั้งค่า'}
                        </p>
                      </div>
                      <OdorAckBadge complaint={c} />
                    </button>
                    {isOpen && (
                      <div className="mt-3">
                        <OdorFieldsDisplay complaint={c} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : loading ? (
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
                <div key={c.id} className="px-4 py-3.5 space-y-2 cursor-pointer flex items-start gap-2"
                     aria-busy={openingComplaintId === c.id}
                     onClick={() => openComplaint(c)}>
                  {canBulkDelete && (
                    <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 mt-1 shrink-0 cursor-pointer" />
                  )}
                  <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-gray-800 text-sm leading-snug flex items-center gap-1.5 flex-wrap">
                      <span className="text-gray-400 font-mono font-normal mr-1">{complaintStartIdx + i + 1}.</span>
                      {CATEGORY_LABEL[c.category] ?? c.category}
                      {c.latitude && (
                        <span className="text-orange-500 shrink-0" title="มีพิกัด GPS"><MapPin size={11} /></span>
                      )}
                      {c.attachments && c.attachments.length > 0 && (
                        <span className="text-blue-500 shrink-0" title="มีภาพประกอบ"><Camera size={11} /></span>
                      )}
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
                    {NEXT_ACTION[c.status] && (['admin', 'superadmin'].includes(currentUserRole) || (currentUserRole === 'technician' && c.assigned_to === currentUserId)) && (
                      <div onClick={(e) => e.stopPropagation()}>
                        <ActionButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} tenant={tenant} />
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block w-full max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[980px] table-fixed text-sm border-collapse">
                <colgroup>
                  {canBulkDelete && <col style={{ width: 30 }} />}
                  <col style={{ width: 30 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 122 }} />
                  <col style={{ width: 138 }} />
                  <col style={{ width: 76 }} />
                  <col style={{ width: 124 }} />
                  <col style={{ width: 108 }} />
                  <col style={{ width: 68 }} />
                  <col style={{ width: 94 }} />
                  <col style={{ width: 134 }} />
                </colgroup>
                <thead>
                  <tr style={{ backgroundColor: '#2c5282' }}>
                    {canBulkDelete && (
                      <th className="px-2 py-2.5 text-center border-r border-white/10">
                        <input type="checkbox"
                          checked={paginatedFiltered.length > 0 && paginatedFiltered.every(c => selectedIds.has(c.id))}
                          onChange={() => toggleSelectAllVisible(paginatedFiltered.map(c => c.id))}
                          className="w-3.5 h-3.5 cursor-pointer" />
                      </th>
                    )}
                    <th className="px-2 py-2.5 text-center text-[11px] font-bold text-white border-r border-white/10">ที่</th>
                    <th className="px-2 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">เลขที่</th>
                    <th className="px-2 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ประเภทคำร้อง</th>
                    <th className="px-2 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">สถานที่</th>
                    <th className="px-2 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">วันที่ยื่น</th>
                    <th className="px-2 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ผู้แจ้ง</th>
                    <th className="px-2 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">ผู้รับผิดชอบ</th>
                    <th className="px-2 py-2.5 text-left text-[11px] leading-tight font-bold text-white border-r border-white/10">ความเร่งด่วน</th>
                    <th className="px-2 py-2.5 text-left text-[11px] font-bold text-white border-r border-white/10">สถานะ</th>
                    <th className="px-2 py-2.5 text-center text-[11px] font-bold text-white">การดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paginatedFiltered.map((c, i) => (
                    <tr key={c.id}
                      className="cursor-pointer transition-colors"
                      style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f5f8fc' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#dbeafe'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f5f8fc'}
                      aria-busy={openingComplaintId === c.id}
                      onClick={() => openComplaint(c)}>
                      {canBulkDelete && (
                        <td className="px-2 py-2 text-center border-r border-gray-200" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)}
                            className="w-3.5 h-3.5 cursor-pointer" />
                        </td>
                      )}
                      <td className="px-2 py-2 text-center text-xs text-gray-500 border-r border-gray-200">{complaintStartIdx + i + 1}</td>
                      <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap border-r border-gray-200 overflow-hidden text-ellipsis">
                        {c.ref_no ? c.ref_no.replace(/^[A-Z]+-/, '') : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-2 py-2 font-medium text-gray-800 text-xs border-r border-gray-200 overflow-hidden">
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="truncate" title={CATEGORY_LABEL[c.category] ?? c.category}>{CATEGORY_LABEL[c.category] ?? c.category}</span>
                          {c.latitude && (
                            <span className="text-orange-500 shrink-0" title="มีพิกัด GPS"><MapPin size={11} /></span>
                          )}
                          {c.attachments && c.attachments.length > 0 && (
                            <span className="text-blue-500 shrink-0" title="มีภาพประกอบ"><Camera size={11} /></span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-gray-500 text-xs border-r border-gray-200 overflow-hidden">
                        {(c.village || c.location_name)
                          ? <span className="flex min-w-0 items-center gap-1" title={c.village || c.location_name}><MapPin size={10} className="text-gray-400 shrink-0" /><span className="truncate">{c.village || c.location_name}</span></span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-2 py-2 text-gray-500 text-xs whitespace-nowrap border-r border-gray-200">
                        {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="px-2 py-2 border-r border-gray-200 overflow-hidden">
                        {(() => {
                          const name = c.reporter_name || c.profiles?.full_name
                          const phone = c.phone || c.profiles?.phone
                          return (
                            <div className="flex flex-col gap-0.5">
                              {name
                                ? <span className="text-xs font-medium text-gray-700 truncate" title={name}>{name}</span>
                                : <span className="text-gray-300 text-xs">ไม่ระบุ</span>}
                              {phone && (
                                <a href={`tel:${phone}`} onClick={e => e.stopPropagation()}
                                  className="text-[11px] text-blue-500 hover:underline truncate">{phone}</a>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-2 py-2 text-xs border-r border-gray-200 overflow-hidden">
                        {c.assigned_to
                          ? <span className="flex min-w-0 items-center gap-1 text-blue-700 font-medium" title={technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ผู้รับผิดชอบ'}><Wrench size={10} className="shrink-0" /><span className="truncate">{technicians.find((t) => t.id === c.assigned_to)?.full_name ?? 'ผู้รับผิดชอบ'}</span></span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-2 py-2 border-r border-gray-200 overflow-hidden">
                        {c.priority && c.priority !== 'normal'
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap border"
                              style={{ backgroundColor: PRIORITY[c.priority]?.bg, color: PRIORITY[c.priority]?.text, borderColor: PRIORITY[c.priority]?.color + '40' }}>
                              {PRIORITY[c.priority]?.short}
                            </span>
                          : <span className="text-gray-300 text-xs">ปกติ</span>}
                      </td>
                      <td className="px-2 py-2 border-r border-gray-200 overflow-hidden">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {(['admin', 'superadmin'].includes(currentUserRole) || (currentUserRole === 'technician' && c.assigned_to === currentUserId)) && (
                            <>
                              <ActionButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} size="xs" tenant={tenant} />
                              <RejectButton status={c.status} id={c.id} onUpdate={updateStatus} loading={updating} compact />
                            </>
                          )}
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
          currentUserId={currentUserId}
          onDelete={handleDeleteComplaint}
          onPinSave={handlePinSave}
          onDocumentUpdate={handleDocumentPatch}
        />
      )}

      {showOssIntake && (
        <OssIntakeForm
          tenant={tenant}
          categoryLabels={CATEGORY_LABEL}
          onClose={() => { setShowOssIntake(false); fetchComplaints() }}
        />
      )}
    </div>
  )
}
