import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { CategoryIcon } from '../lib/categoryIcon'
import { compressImage } from '../lib/imageUtils'
import { uploadFile, resolvePrivateFileUrl, isPrivateDriveRef, driveFileIdFromRef } from '../lib/driveStorage'
import SatisfactionModal from '../components/SatisfactionModal'
import { workingDaysLeft } from '../lib/workingDays'
import { odorRoutedAt, isAdhocComplaint, ODOR_INTAKE_LABEL } from '../lib/odorIntake'
import {
  ClipboardList, Loader2, ChevronRight, X, MapPin,
  Phone, ArrowLeft, Check, XCircle, Navigation, Camera, AlignLeft,
  ChevronLeft, Clock, Search, ImagePlus, Upload, FileText, CheckCircle2,
} from 'lucide-react'

const MAX_CITIZEN_PHOTOS = 3

const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50, 100]

const STATUS = {
  new:         { label: 'คำร้องใหม่',      bg: '#fef3c7', text: '#92400e' },
  in_progress: { label: 'กำลังดำเนินการ', bg: '#ede9fe', text: '#5b21b6' },
  done:        { label: 'ดำเนินการแล้ว',  bg: '#dbeafe', text: '#1e40af' },
  closed:      { label: 'ปิดเรื่องแล้ว',  bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         bg: '#fee2e2', text: '#991b1b' },
  // backward compat
  pending:     { label: 'คำร้องใหม่',      bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   bg: '#e0f2fe', text: '#0369a1' },
  completed:   { label: 'ปิดเรื่องแล้ว',  bg: '#d1fae5', text: '#065f46' },
}

const STATUS_FLOW = ['new', 'received', 'in_progress', 'done', 'closed']
const STATUS_FLOW_LABEL = {
  new:         { label: 'คำร้องใหม่',      desc: 'คำร้องของคุณถูกส่งเข้าระบบแล้ว' },
  received:    { label: 'รับเรื่องแล้ว',   desc: 'เจ้าหน้าที่รับเรื่องแล้ว' },
  in_progress: { label: 'กำลังดำเนินการ', desc: 'เจ้าหน้าที่ลงพื้นที่ดำเนินการ' },
  done:        { label: 'ดำเนินการแล้ว',  desc: 'เจ้าหน้าที่ดำเนินการเสร็จแล้ว' },
  closed:      { label: 'ปิดเรื่องแล้ว',  desc: 'ปิดเรื่องและแจ้งผลประชาชนแล้ว' },
}

// นับเป็น "วันทำการ" ให้ตรงกับฝั่งเจ้าหน้าที่ (ComplaintsManager) — ประชาชนกับเจ้าหน้าที่
// ต้องเห็นตัวเลขเดียวกัน ไม่งั้นจะเถียงกันว่าเรื่องเกินกำหนดแล้วหรือยัง
function SlaBadge({ dueDate, status }) {
  if (!dueDate || status === 'done' || status === 'closed' || status === 'rejected') return null
  const days = workingDaysLeft(dueDate)
  if (days === null) return null
  const color = days < 0 ? { bg: '#fee2e2', text: '#991b1b' }
    : days <= 5 ? { bg: '#fef3c7', text: '#92400e' }
    : { bg: '#d1fae5', text: '#065f46' }
  const label = days < 0 ? `เกินกำหนด ${Math.abs(days)} วันทำการ`
    : days === 0 ? 'ครบกำหนดวันนี้'
    : `เหลือ ${days} วันทำการ`
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
          style={{ backgroundColor: color.bg, color: color.text }}>
      <Clock size={9} /> {label}
    </span>
  )
}

const DEFAULT_CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ตัดต้นไม้',
  noise: 'แจ้งเหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', suction: 'ดูดสิ่งปฏิกูล',
  manhole: 'ฝาท่อระบายน้ำ', vendor: 'ขายของบนทางสาธารณะ',
  building: 'ตรวจสอบอาคาร', mosquito: 'พ่นยุง',
  pollution: 'กลิ่นควัน/มลพิษ', corruption: 'แจ้งการทุจริต',
  tax: 'ภาษีและค่าธรรมเนียม', canal: 'ลอกคลอง',
  animals: 'สุนัขและแมวจรจัด', disease: 'ควบคุมโรคติดต่อ', other: 'อื่นๆ',
}

const DEFAULT_CATEGORY_EMOJI = {
  road: '🛣️', light: '💡', trash: '🗑️', water: '🚰',
  flood: '🌊', tree: '🌳', noise: '📢', drain: '🕳️',
  waste_water: '💧', suction: '🚛', manhole: '⚙️', vendor: '🏪',
  building: '🏗️', mosquito: '🦟', pollution: '🌫️', corruption: '⚖️',
  tax: '📋', canal: '🏞️', animals: '🐕', disease: '🏥', other: '📝',
}

// ⚠️ หมวดเฉพาะกิจ (กลิ่นเหม็นรบกวน) ไม่แตะ complaints.status เลยตลอดสายงาน status จึงค้างที่
// ค่าตั้งต้นตลอดกาล แล้วแบดจ์จะขึ้น "คำร้องใหม่" เคียงข้างป้าย "ระบบรับเรื่องแล้ว" ที่อยู่ติดกัน
// — ผู้แจ้งอ่านได้ว่าระบบขัดแย้งกันเอง หรือแย่กว่านั้นคือ "รับเรื่องไปแล้วแต่ยังไม่มีใครทำ"
// ในเมื่อสายงานนี้ไม่มีขั้นสถานะให้ไล่ ป้าย "ระบบรับเรื่องแล้ว" (AckBadge) คือความคืบหน้า
// ทั้งหมดที่มีจริง แบดจ์สถานะจึงไม่ควรมีอยู่ ไม่ใช่แค่เปลี่ยนข้อความ
//
// ⚠️ ซ่อนเฉพาะตอนที่ status "ยังไม่เคยขยับ" เท่านั้น ห้ามซ่อนทุกกรณี — guard_adhoc_complaint_write
//   เปิดทางให้ admin/superadmin แก้ status ของหมวดเฉพาะกิจได้ (ตอนนี้ยังไม่มีปุ่มในหน้าจอ
//   แต่ยิง API ตรงได้) ถ้ามีคนสั่งปิดเรื่องจริง ผู้แจ้งต้องได้เห็น ไม่ใช่ถูกกลืนหายเพราะกฎนี้
function StatusBadge({ complaint }) {
  const status = complaint?.status
  if (isAdhocComplaint(complaint) && (STATUS_COMPAT[status] ?? status) === 'new') return null
  const s = STATUS[status] ?? STATUS.new
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
          style={{ backgroundColor: s.bg, color: s.text }}>
      {s.label}
    </span>
  )
}

const STATUS_COMPAT = { pending: 'new', done: 'done', completed: 'closed' }

// หมวดเฉพาะกิจ (complaint_categories.is_adhoc เช่น กลิ่นเหม็นรบกวน) ส่งตรงถึงผู้รับผิดชอบและ
// "ไม่แตะ status เลย" ตลอดสายงาน — ผู้แจ้งจึงเห็น "คำร้องใหม่" ค้างตลอดกาลแม้เรื่องถึงมือคนรับผิดชอบ
// ไปแล้ว ซึ่งอ่านได้เป็น "ไม่มีใครสนใจเรื่องของฉัน" ความคืบหน้าจริงของสายงานนี้อยู่ที่
// extra_data.routed_at (เขียนโดย trigger route_adhoc_complaint ฝั่งเซิร์ฟเวอร์เท่านั้น)
// หรือ acknowledged_at ของเรื่องเก่าที่เคยมีเจ้าหน้าที่กดรับทราบจริงในสายงานก่อนหน้า
// ใช้การมีอยู่ของคีย์เป็นสัญญาณ ไม่ต้อง query complaint_categories เพิ่มเพื่อถาม is_adhoc
// ⚠️ ห้ามเปิด fallbackToCreated ที่นี่เด็ดขาด หน้านี้แสดงคำร้องคละหมวด หมวดปกติจะขึ้นป้ายผิดทั้งหมด
//
// ข้อความคือ "ระบบรับเรื่องแล้ว" ไม่ใช่ "เจ้าหน้าที่รับทราบแล้ว" อย่างเดิม — ตั้งแต่เปลี่ยนมาให้ระบบ
// รับเรื่องอัตโนมัติ ไม่มีเจ้าหน้าที่คนใดกดอะไรเลย ป้ายเดิมจึงเป็นคำกล่าวอ้างที่ไม่มีคนอยู่เบื้องหลัง
function AckBadge({ complaint, withTime = false }) {
  const at = odorRoutedAt(complaint)
  if (!at) return null
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-lime-100 text-lime-800">
      <CheckCircle2 size={12} />
      {ODOR_INTAKE_LABEL}
      {withTime && ` · ${at.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}`}
    </span>
  )
}

const RATING_FACE = {
  5: { emoji: '😄', label: 'ยอดเยี่ยม' },
  4: { emoji: '😊', label: 'ดี' },
  3: { emoji: '😐', label: 'พอสมควร' },
  2: { emoji: '😢', label: 'แย่' },
  1: { emoji: '😡', label: 'แย่มาก' },
}

function isClosed(status) {
  return status === 'closed' || status === 'completed'
}

// localStorage เข้าถึงไม่ได้ในโหมดส่วนตัวของบางเบราว์เซอร์ (throw ตั้งแต่ getItem) — ห้ามให้
// หน้าคำร้องทั้งหน้าพังเพราะแค่จำไม่ได้ว่าเคยประเมินไปแล้ว
function satDone(id) {
  try { return localStorage.getItem(`sat_done_${id}`) === '1' } catch { return false }
}
function markSatDone(id) {
  try { localStorage.setItem(`sat_done_${id}`, '1') } catch { /* ไม่จำก็ไม่เป็นไร ฝั่ง DB กันซ้ำอยู่แล้ว */ }
}

// เด้งประเมินเองเฉพาะเรื่องที่เพิ่งปิดไม่นาน — ตอนฟีเจอร์นี้ขึ้นระบบมีคำร้องที่ปิดเรื่องแล้ว
// ค้างอยู่จำนวนหนึ่ง ถ้าไม่จำกัดช่วงเวลา ผู้ใช้จะโดนป็อปอัพย้อนหลังเรื่องที่จำไม่ได้แล้ว
// ซึ่งได้คะแนนที่ไม่สะท้อนอะไรและกวนผู้ใช้ฟรีๆ ปุ่มประเมินในหน้ารายละเอียดยังเปิดไว้เสมอ
// คนที่อยากให้คะแนนเรื่องเก่ายังทำได้
const SAT_PROMPT_WINDOW_DAYS = 30

function withinPromptWindow(closedAt) {
  // closed_at เป็น NULL ในคำร้องเก่าที่ปิดก่อนระบบเริ่มบันทึกเวลาปิดเรื่อง — ถือว่าพ้นช่วงไปแล้ว
  if (!closedAt) return false
  const t = new Date(closedAt).getTime()
  if (Number.isNaN(t)) return false
  return Date.now() - t <= SAT_PROMPT_WINDOW_DAYS * 86400000
}

function findUnrated(list) {
  return list.find(c =>
    isClosed(c.status) &&
    c.rating == null &&
    withinPromptWindow(c.closed_at) &&
    !satDone(c.id)
  ) ?? null
}

function StatusStepper({ status }) {
  const normalized = STATUS_COMPAT[status] ?? status
  if (normalized === 'rejected') {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 rounded-2xl border border-red-100">
        <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
          <XCircle size={20} className="text-red-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-red-700">คำร้องถูกปฏิเสธ</p>
          <p className="text-xs text-red-400 mt-0.5">เจ้าหน้าที่ไม่สามารถดำเนินการได้</p>
        </div>
      </div>
    )
  }

  const currentIdx = STATUS_FLOW.indexOf(normalized)

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
                  <Check size={14} className="text-white" />
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

function DetailSheet({ complaint: c, onClose, onAttachmentsChange, onRate, catLabel = DEFAULT_CATEGORY_LABEL, catEmoji = DEFAULT_CATEGORY_EMOJI }) {
  const { tenant } = useTenant()
  const [newPhotos, setNewPhotos] = useState([]) // { file, preview }
  const [uploading, setUploading] = useState(false)
  const [freshAttachments, setFreshAttachments] = useState(null) // null = not fetched yet
  const [finalDocUrl, setFinalDocUrl] = useState(null)
  const photosRef = useRef([])
  useEffect(() => { photosRef.current = newPhotos }, [newPhotos])
  useEffect(() => () => photosRef.current.forEach(p => URL.revokeObjectURL(p.preview)), [])

  useEffect(() => {
    setNewPhotos([])
    setFreshAttachments(null)
    if (!c?.id) return
    supabase.from('complaints').select('attachments').eq('id', c.id).single()
      .then(({ data }) => { if (data) setFreshAttachments(data.attachments ?? []) })
  }, [c?.id])

  // เอกสารฉบับสมบูรณ์ (ลงนามจาก GDCC e-Office แล้ว) — แสดงเฉพาะฉบับนี้เท่านั้น
  // draft_pdf_path เป็นไฟล์ภายในสำหรับแอดมินไปยื่นเซ็นเท่านั้น ไม่โชว์ให้ประชาชนเห็น
  // final_document_path อาจเป็น path เก่าของ Supabase Storage (คำร้องเก่าก่อนย้ายระบบ) หรือ
  // marker 'drive:fileId' ของใหม่ (คำร้องที่อัปโหลดหลังย้ายไป Google Drive) ต้องเช็คแล้วดึงคนละทาง
  useEffect(() => {
    setFinalDocUrl(null)
    if (!c?.final_document_path) return
    let revoke = null
    if (isPrivateDriveRef(c.final_document_path)) {
      resolvePrivateFileUrl(driveFileIdFromRef(c.final_document_path))
        .then(({ url }) => { if (url) { revoke = url; setFinalDocUrl(url) } })
    } else {
      supabase.storage.from('official-documents').createSignedUrl(c.final_document_path, 1800)
        .then(({ data }) => setFinalDocUrl(data?.signedUrl ?? null))
    }
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [c?.final_document_path])

  function handlePhotoPick(e) {
    const existing = (c?.attachments ?? []).length
    const slots = MAX_CITIZEN_PHOTOS - existing - newPhotos.length
    if (slots <= 0) return
    const MAX_MB = 25
    const picked = Array.from(e.target.files)
      .filter(f => {
        if (f.size > MAX_MB * 1024 * 1024) { alert(`ไฟล์ "${f.name}" ใหญ่เกิน ${MAX_MB} MB`); return false }
        return true
      })
      .slice(0, slots)
    setNewPhotos(prev => [...prev, ...picked.map(f => ({ file: f, preview: URL.createObjectURL(f) }))])
    e.target.value = ''
  }

  function removeNewPhoto(idx) {
    setNewPhotos(prev => { URL.revokeObjectURL(prev[idx].preview); return prev.filter((_, i) => i !== idx) })
  }

  async function handleUpload() {
    if (!c?.id || newPhotos.length === 0 || uploading) return
    setUploading(true)
    const uploaded = []
    for (const { file } of newPhotos) {
      try {
        let compressed
        try {
          compressed = await compressImage(file, undefined, 0.85)
        } catch {
          compressed = await compressImage(file, 640, 0.65)
        }
        const { url, error } = await uploadFile('complaint-attachments', compressed, {
          subject: c.id,
          filename: `${crypto.randomUUID()}.jpg`,
          municipality: tenant?.slug,
        })
        if (error) throw error
        uploaded.push(url)
      } catch {}
    }
    if (uploaded.length > 0) {
      const base = freshAttachments ?? (c.attachments ?? [])
      const merged = [...base, ...uploaded]
      const { data: ok, error } = await supabase.rpc('attach_complaint_photos', {
        p_complaint_id: c.id,
        p_urls: merged,
      })
      if (!error && ok) {
        setFreshAttachments(merged)
        onAttachmentsChange?.(c.id, merged)
      } else {
        console.error('[attach_photos]', error?.message ?? 'attach_failed')
      }
    }
    newPhotos.forEach(p => URL.revokeObjectURL(p.preview))
    setNewPhotos([])
    setUploading(false)
  }

  if (!c) return null
  const categoryLabel = catLabel[c.category] ?? c.category
  const categoryEmoji = catEmoji[c.category] ?? '📄'
  const dateStr = new Date(c.created_at).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[93dvh] flex flex-col overflow-hidden">

        {/* gradient header */}
        <div className="shrink-0 px-5 pt-6 pb-5 relative"
             style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, color-mix(in srgb, var(--color-primary) 70%, #7c3aed) 100%)' }}>
          <button onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors">
            <X size={16} />
          </button>

          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
              <CategoryIcon emoji={categoryEmoji} size={28} style={tenant?.category_icon_style} />
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
              <p className="text-white/60 text-[13px] uppercase tracking-wider">เลขที่อ้างอิง</p>
              <p className="text-white font-black text-xl tracking-wider mt-0.5 font-mono">
                {c.ref_no ?? '—'}
              </p>
              {/* หมวดเฉพาะกิจไม่มีขั้นปิดงาน ตัวนับจะพลิกเป็น "เกินกำหนด" แล้วนับขึ้นตลอดไป
                  แม้เจ้าหน้าที่จัดการจบแล้ว จึงไม่แสดงเลย (ดูเหตุผลเต็มใน lib/odorIntake.js) */}
              {c.due_date && !isAdhocComplaint(c) && (
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

        {/* scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-5">

          {/* status stepper */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">ความคืบหน้า</p>
            {/* สายงานเฉพาะกิจไม่มีขั้นสถานะให้ไล่ — บอกตรงๆ ว่าระบบรับเรื่องเข้ามาแล้วเมื่อไหร่
                แทนที่จะปล่อยให้ stepper ค้างที่ "คำร้องใหม่" เป็นข้อมูลเดียวที่ผู้แจ้งได้เห็น */}
            {odorRoutedAt(c) && (
              <div className="mb-3 flex items-center gap-2 rounded-2xl border border-lime-200 bg-lime-50 px-3 py-2.5">
                <AckBadge complaint={c} withTime />
              </div>
            )}
            {/* หมวดเฉพาะกิจไม่ไล่ status เลย stepper จะค้างที่ "คำร้องใหม่" ตลอดกาล และขัดกับ
                ป้าย "ระบบรับเรื่องแล้ว" ด้านบน — ป้ายนั้นคือความคืบหน้าทั้งหมดที่สายงานนี้มีจริง */}
            {!isAdhocComplaint(c) && <StatusStepper status={c.status} />}
          </div>

          {/* ประเมินความพึงพอใจ — ทางเข้าสำรองเมื่อป็อปอัพหลังปิดเรื่องไม่ได้เด้ง
              (ผู้แจ้งไม่ได้เปิดแอปค้างไว้ตอนเจ้าหน้าที่ปิดเรื่อง ซึ่งเป็นเคสส่วนใหญ่) */}
          {isClosed(c.status) && (c.rating != null || onRate) && (
            <div className="rounded-2xl border p-4"
                 style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
              {c.rating != null ? (
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">{RATING_FACE[c.rating]?.emoji ?? '🙂'}</span>
                  <div>
                    <p className="text-sm font-bold text-green-800">
                      ประเมินแล้ว: {RATING_FACE[c.rating]?.label ?? `${c.rating} คะแนน`}
                    </p>
                    <p className="text-xs text-green-600 mt-0.5">ขอบคุณที่ให้ความเห็นกับเรา</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm font-bold text-green-800">คำร้องนี้ปิดเรื่องแล้ว</p>
                  <p className="text-xs text-green-600 mt-0.5 mb-3">
                    ขอเวลาสักครู่ให้คะแนนความพึงพอใจการให้บริการ
                  </p>
                  <button onClick={() => onRate(c.id)}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-transform active:scale-95"
                    style={{ backgroundColor: '#16a34a' }}>
                    ประเมินความพึงพอใจ
                  </button>
                </>
              )}
            </div>
          )}

          {/* เอกสารฉบับสมบูรณ์ (ลงนามจาก GDCC e-Office แล้ว) */}
          {c.final_document_path && (
            <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100 space-y-1.5">
              <p className="text-xs font-semibold text-indigo-700">เอกสารฉบับสมบูรณ์</p>
              {c.official_receipt_no && (
                <p className="text-xs text-gray-500">เลขรับหนังสือ: <span className="font-semibold text-gray-700">{c.official_receipt_no}</span></p>
              )}
              <a href={finalDocUrl ?? '#'} target="_blank" rel="noopener noreferrer"
                onClick={(e) => { if (!finalDocUrl) e.preventDefault() }}
                className="inline-flex items-center gap-1.5 mt-1 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-colors"
                style={{ backgroundColor: '#6366f1', opacity: finalDocUrl ? 1 : 0.5 }}>
                <FileText size={13} />
                {finalDocUrl ? 'ดูเอกสารฉบับสมบูรณ์' : 'กำลังโหลด...'}
              </a>
            </div>
          )}

          {/* location + phone */}
          {(c.location_name || c.village || c.phone || c.latitude) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">ข้อมูลติดต่อ</p>
              <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden">
                {(c.location_name || c.village) && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                      <MapPin size={15} className="text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-gray-400">สถานที่เกิดเหตุ</p>
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
                      <p className="text-sm font-medium text-gray-800">{c.phone}</p>
                    </div>
                    <span className="text-xs text-green-600 font-medium shrink-0">โทร</span>
                  </a>
                )}
                {c.latitude && (
                  <a href={`https://maps.google.com/?q=${c.latitude},${c.longitude}`}
                     target="_blank" rel="noreferrer"
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <Navigation size={15} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-gray-400">พิกัดสถานที่</p>
                      <p className="text-sm font-medium text-gray-800">
                        {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                      </p>
                    </div>
                    <span className="text-xs text-blue-600 font-medium shrink-0">เปิดแผนที่</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* detail */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดปัญหา</p>
            <div className="bg-gray-50 rounded-2xl px-4 py-3">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.detail}</p>
            </div>
          </div>

          {/* citizen attachments — ใช้ freshAttachments (fetch ใหม่ตอนเปิด) เพื่อแก้กรณี list โหลดก่อน upload เสร็จ */}
          {(attDisplay => (attDisplay.length > 0 || onAttachmentsChange) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รูปภาพจากท่าน</p>

              {attDisplay.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {attDisplay.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer"
                       className="aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
                      <img src={url} alt={`รูป ${i + 1}`} className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {newPhotos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {newPhotos.map((p, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden border-2 border-dashed border-blue-300 bg-blue-50">
                      <img src={p.preview} alt="" className="w-full h-full object-cover" />
                      {!uploading && (
                        <button onClick={() => removeNewPhoto(i)}
                          className="absolute top-1 right-1 bg-black/55 rounded-full p-0.5 active:scale-90">
                          <X size={12} className="text-white" />
                        </button>
                      )}
                      {uploading && (
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                          <Loader2 size={16} className="animate-spin text-white" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {onAttachmentsChange && attDisplay.length + newPhotos.length < MAX_CITIZEN_PHOTOS && (
                <div className="relative w-full">
                  <div className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-gray-300 text-gray-500 text-xs font-medium pointer-events-none">
                    <ImagePlus size={14} /> แนบรูปภาพ
                  </div>
                  <input type="file" accept="image/*" multiple onChange={handlePhotoPick}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                </div>
              )}

              {newPhotos.length > 0 && (
                <button onClick={handleUpload} disabled={uploading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-all active:scale-95"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  {uploading
                    ? <><Loader2 size={15} className="animate-spin" /> กำลังอัปโหลด...</>
                    : <><Upload size={15} /> แนบรูปภาพ {newPhotos.length} รูป</>}
                </button>
              )}
            </div>
          ))(freshAttachments ?? (c.attachments ?? []))}

          {/* work photos - after */}
          {(c.work_photos ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Camera size={11} /> หลังดำเนินการ ({c.work_photos.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {c.work_photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-green-200 bg-green-50 flex items-center justify-center shadow-sm">
                    <img src={url} alt={`ผลงาน ${i + 1}`} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* technician note */}
          {c.technician_note && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlignLeft size={11} /> บันทึกจากเจ้าหน้าที่
              </p>
              <div className="bg-green-50 rounded-2xl px-4 py-3 border border-green-100">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.technician_note}</p>
              </div>
            </div>
          )}


        </div>

        {/* footer */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose}
            className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MyComplaints() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const openId = searchParams.get('id')
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [catLabel, setCatLabel] = useState(DEFAULT_CATEGORY_LABEL)
  const [catEmoji, setCatEmoji] = useState(DEFAULT_CATEGORY_EMOJI)

  function handleAttachmentsChange(id, newAttachments) {
    setComplaints(prev => prev.map(c => c.id === id ? { ...c, attachments: newAttachments } : c))
    setSelected(prev => prev?.id === id ? { ...prev, attachments: newAttachments } : prev)
  }
  const [session, setSession] = useState(undefined)
  const [showSat, setShowSat] = useState(false)
  const [satComplaintId, setSatComplaintId] = useState(null)
  // เด้งแบบอัตโนมัติได้ครั้งเดียวต่อการเปิดหน้า — ผู้ใช้ที่กด "ข้าม" ไปแล้วไม่ควรโดนซ้ำ
  // ทุกครั้งที่ effect โหลดใหม่ (openId เปลี่ยนก็ทำให้ load() วิ่งอีกรอบ)
  const satAutoShownRef = useRef(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)

  // anon search
  const [refInput, setRefInput]       = useState('')
  const [searching, setSearching]     = useState(false)
  const [searchResult, setSearchResult] = useState(null)
  const [searched, setSearched]       = useState(false)
  // แยก "ยิงถี่เกินไป" ออกจาก "ไม่พบ" — get_complaint_by_ref มี rate limit แล้ว
  // (20260905190000) ถ้าเหมารวมเป็นไม่พบ ผู้ใช้จะนึกว่าเรื่องตัวเองหายไปจากระบบ
  const [searchError, setSearchError] = useState(null)

  const perPage = itemsPerPage === 'all' ? complaints.length : itemsPerPage
  const totalPages = perPage > 0 ? Math.max(1, Math.ceil(complaints.length / perPage)) : 1
  const startIdx = (currentPage - 1) * perPage
  const paginatedComplaints = itemsPerPage === 'all' ? complaints : complaints.slice(startIdx, startIdx + perPage)

  useEffect(() => { setCurrentPage(1) }, [itemsPerPage])

  function goToPage(page) {
    const p = Math.max(1, Math.min(page, totalPages))
    setCurrentPage(p)
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
  }, [])

  // ดึงหมวดหมู่ที่ Admin สร้างเองจาก DB มา merge กับค่า default
  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('complaint_categories').select('value, label, emoji').eq('municipality_id', tenant.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const lblMap = { ...DEFAULT_CATEGORY_LABEL }
          const emoMap = { ...DEFAULT_CATEGORY_EMOJI }
          for (const c of data) {
            lblMap[c.value] = c.label
            if (c.emoji) emoMap[c.value] = c.emoji
          }
          setCatLabel(lblMap)
          setCatEmoji(emoMap)
        }
      })
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id || !session?.user?.id) return
    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase
          .from('complaints')
          .select('*')
          .eq('municipality_id', tenant.id)
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
        const list = data ?? []
        setComplaints(list)
        if (openId) setSelected(list.find((c) => c.id === openId) ?? null)

        // เดิมป็อปอัพประเมินเด้งจาก realtime ช่องทางเดียว คือต้องเปิดหน้านี้ค้างไว้พอดีตอน
        // เจ้าหน้าที่กดปิดเรื่อง ซึ่งแทบไม่เกิดขึ้นจริง — push แจ้ง "คำร้องของคุณปิดเรื่องแล้ว"
        // พาผู้ใช้มาที่ /my-complaints หลังจากนั้น แล้วไม่มีอะไรถามเลย
        const unrated = findUnrated(list)
        if (unrated && !satAutoShownRef.current) {
          satAutoShownRef.current = true
          setSatComplaintId(unrated.id)
          setShowSat(true)
        }
      } catch {}
      finally { setLoading(false) }
    }
    load()
  }, [tenant?.id, session?.user?.id, openId])

  // Realtime: เมื่อ admin ปิดเรื่อง → เด้ง modal ทันที
  useEffect(() => {
    if (!tenant?.id || !session?.user?.id) return
    const userId = session.user.id
    const channel = supabase
      .channel(`complaints-closed-${tenant.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'complaints',
        filter: `municipality_id=eq.${tenant.id}`,
      }, ({ new: updated }) => {
        setComplaints(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
        // ใช้ช่วงเวลาเดียวกับตอนโหลดรายการ — UPDATE ไม่ได้แปลว่าเพิ่งปิดเรื่อง แอดมินแก้อย่างอื่น
        // (เช่นแนบเอกสาร) ในคำร้องเก่าที่ปิดไปนานแล้วก็ยิง event นี้เหมือนกัน
        if (
          updated.user_id === userId &&
          isClosed(updated.status) &&
          updated.rating == null &&
          withinPromptWindow(updated.closed_at) &&
          !satDone(updated.id)
        ) {
          setSatComplaintId(updated.id)
          setShowSat(true)
        }
      })
      // DELETE (แอดมินลบคำร้องทิ้ง) — ถ้าไม่ดัก ประชาชนจะยังเห็นเรื่องที่ถูกลบไปแล้วจนกว่าจะรีเฟรช
      // payload ของ DELETE มีแค่ primary key (replica identity ของตารางเป็นค่า default ซึ่งจงใจไม่
      // เปลี่ยนเป็น full เพราะจะทำให้ข้อมูลเต็มแถวหลุดไปหา subscriber ทุกคนโดยไม่ผ่าน RLS)
      // จึงใส่ filter municipality_id ไม่ได้และเช็ค user_id ไม่ได้ — กรองด้วย "id นี้อยู่ในรายการ
      // ที่โหลดมาหรือเปล่า" แทน ซึ่งเป็นรายการของผู้ใช้คนนี้อยู่แล้ว
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'complaints' },
        ({ old }) => {
          const deletedId = old?.id
          if (!deletedId) return
          setComplaints(prev => prev.some(c => c.id === deletedId)
            ? prev.filter(c => c.id !== deletedId)
            : prev)
          // ถ้ากำลังเปิดบ็อปอัพให้คะแนนของเรื่องที่เพิ่งถูกลบ ต้องปิดทิ้ง ไม่งั้นกดส่งคะแนนแล้ว error
          setSatComplaintId(cur => {
            if (cur !== deletedId) return cur
            queueMicrotask(() => setShowSat(false))
            return null
          })
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tenant?.id, session?.user?.id])

  async function handleRefSearch() {
    const ref = refInput.trim().toUpperCase()
    if (!ref || !tenant?.id) return
    setSearching(true); setSearched(true); setSearchResult(null); setSearchError(null)
    const { data, error } = await supabase.rpc('get_complaint_by_ref', {
      _ref_no: ref, _municipality_id: tenant.id,
    })
    if (error) {
      // PT429 = โควตาการค้นหาต่อ IP เต็ม ไม่ใช่ว่าไม่มีเรื่องนี้ในระบบ
      setSearchError(error.code === 'PT429'
        ? (error.message || 'ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่')
        : 'ค้นหาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      setSearching(false)
      return
    }
    const row = data?.[0] ?? null
    setSearchResult(row)
    setSearching(false)
    // ผู้แจ้งที่ไม่ได้ล็อกอินก็ต้องได้ประเมิน — can_rate คำนวณฝั่งเซิร์ฟเวอร์ (ปิดเรื่องแล้ว
    // และยังไม่เคยมีคะแนนของผู้ไม่ล็อกอินผูกกับเรื่องนี้) คะแนนกลุ่มนี้ถูกเก็บเป็น unverified
    // ไม่ปนกับตัวเลขที่ใช้อ้างอิงทางราชการ เพราะ ref_no เดาได้และไม่มี rate limit
    if (row?.can_rate && !satDone(row.id)) {
      setSatComplaintId(row.id)
      setShowSat(true)
    }
  }

  function handleRated(id, rating, verified) {
    markSatDone(id)
    // คะแนนของผู้ไม่ล็อกอินไม่ได้ลง complaints.rating (unverified) จึงอัปเดตแค่ can_rate
    // ไม่งั้นการ์ดจะโชว์ "ประเมินแล้ว: ..." ทั้งที่ค่าจริงในฐานข้อมูลยังว่าง
    const patch = verified ? { rating, can_rate: false } : { can_rate: false }
    setComplaints(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
    setSelected(prev => prev?.id === id ? { ...prev, ...patch } : prev)
    setSearchResult(prev => prev?.id === id ? { ...prev, ...patch } : prev)
  }

  function openRating(id) {
    setSatComplaintId(id)
    setShowSat(true)
  }

  function closeRating() {
    if (satComplaintId) markSatDone(satComplaintId)
    setShowSat(false)
    setSatComplaintId(null)
  }

  if (session === undefined) return (
    <div className="flex justify-center py-24">
      <Loader2 size={28} className="animate-spin text-gray-300" />
    </div>
  )

  // ── Anon: show search UI ───────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500">
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="font-bold text-gray-800">ติดตามคำร้อง</p>
            <p className="text-xs text-gray-400">ค้นหาด้วยเลขอ้างอิงที่ได้รับ</p>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-5 pb-12 space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center space-y-2">
            <p className="text-sm font-bold text-blue-700">เข้าสู่ระบบเพื่อดูคำร้องทั้งหมด</p>
            <p className="text-xs text-blue-500">หรือค้นหาด้วยเลขอ้างอิงด้านล่าง</p>
            <button onClick={() => navigate('/auth', { state: { from: '/my-complaints' } })}
              className="px-5 py-2 rounded-xl font-bold text-sm text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              เข้าสู่ระบบ
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
            <p className="text-sm font-bold text-gray-700">ค้นหาด้วยเลขอ้างอิง</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              เลขที่ได้รับหลังยื่นคำร้อง เช่น <span className="font-mono font-semibold">NL-001-2568</span>
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={refInput}
                onChange={e => { setRefInput(e.target.value.toUpperCase()); setSearched(false) }}
                placeholder="NL-001-2568"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 font-mono tracking-widest uppercase"
                onKeyDown={e => e.key === 'Enter' && handleRefSearch()}
              />
              <button onClick={handleRefSearch} disabled={searching || !refInput.trim()}
                className="px-4 py-2.5 rounded-xl font-semibold text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                ค้นหา
              </button>
            </div>

            {searchError && !searching && (
              <p className="text-xs text-amber-600">{searchError}</p>
            )}

            {searched && !searching && !searchResult && !searchError && (
              <p className="text-xs text-red-500">ไม่พบเลขอ้างอิงนี้ ลองตรวจสอบอีกครั้ง</p>
            )}

            {searchResult && (
              <div
                onClick={() => setSelected(searchResult)}
                className="bg-gray-50 rounded-2xl border border-gray-100 p-4 cursor-pointer hover:bg-gray-100 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="flex items-center gap-1.5 font-bold text-gray-800 text-sm">
                    <CategoryIcon emoji={catEmoji[searchResult.category] ?? '📄'} size={16} style={tenant?.category_icon_style} />
                    {catLabel[searchResult.category] ?? searchResult.category}
                  </p>
                  {/* หมวดเฉพาะกิจ StatusBadge จะคืน null ที่นี่ AckBadge จึงต้องมีคู่กันเสมอ
                      ไม่งั้นค้นด้วยเลขที่คำร้องแล้วจะไม่เหลือป้ายบอกสถานะอะไรเลยสักอัน */}
                  <span className="flex items-center gap-1.5 shrink-0">
                    <StatusBadge complaint={searchResult} />
                    <AckBadge complaint={searchResult} />
                  </span>
                </div>
                {searchResult.subject && <p className="text-xs text-gray-500 mb-1">{searchResult.subject}</p>}
                <p className="text-xs text-gray-400 font-mono">{searchResult.ref_no}</p>
              </div>
            )}
          </div>
        </div>

        {selected && (
          <DetailSheet complaint={selected} onClose={() => setSelected(null)}
            onRate={selected.can_rate ? openRating : undefined}
            catLabel={catLabel} catEmoji={catEmoji} />
        )}

        {showSat && (
          <SatisfactionModal
            complaintId={satComplaintId}
            onRated={handleRated}
            onClose={closeRating}
          />
        )}
      </div>
    )
  }

  // ── Logged-in: full list ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>
      {showSat && (
        <SatisfactionModal
          complaintId={satComplaintId}
          onRated={handleRated}
          onClose={closeRating}
        />
      )}
      {/* PC header */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-gray-800">คำร้องของฉัน</h1>
          <p className="text-xs text-gray-400 mt-0.5">ติดตามสถานะคำร้องที่ยื่น — {complaints.length} รายการ</p>
        </div>
        <button onClick={() => navigate('/complaint')}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <ClipboardList size={15} />
          ร้องเรียน/ร้องทุกข์ใหม่
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-5 pb-24 md:py-6 md:pb-8 md:px-8">
      {/* Mobile header */}
      <div className="md:hidden flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-gray-800">คำร้องของฉัน</h1>
          <p className="text-xs text-gray-400">ติดตามสถานะคำร้องที่ยื่น</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={28} className="animate-spin text-gray-300" />
        </div>
      ) : complaints.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <ClipboardList size={48} className="mb-3 opacity-20" />
          <p className="font-medium text-gray-500">ยังไม่มีคำร้อง</p>
          <p className="text-sm mt-1">กดร้องเรียน/ร้องทุกข์ เพื่อแจ้งปัญหา</p>
          <button onClick={() => navigate('/complaint')}
            className="mt-5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            ร้องเรียน/ร้องทุกข์
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {paginatedComplaints.map((c, i) => (
              <div key={c.id}
                onClick={() => setSelected(c)}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 cursor-pointer hover:shadow-md active:scale-[0.99] transition-all">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gray-50">
                    <CategoryIcon emoji={catEmoji[c.category] ?? '📄'} size={22} style={tenant?.category_icon_style} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="font-semibold text-gray-800 text-sm truncate">
                        <span className="text-gray-400 font-mono font-normal mr-1">{startIdx + i + 1}.</span>
                        {catLabel[c.category] ?? c.category}
                      </p>
                      <ChevronRight size={14} className="text-gray-300 shrink-0" />
                    </div>
                    {c.subject && (
                      <p className="text-xs text-gray-500 truncate">{c.subject}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <StatusBadge complaint={c} />
                      <AckBadge complaint={c} />
                      {!isAdhocComplaint(c) && <SlaBadge dueDate={c.due_date} status={c.status} />}
                      {c.ref_no && (
                        <span className="text-[11px] text-gray-400 font-mono">{c.ref_no}</span>
                      )}
                      {c.latitude && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 border border-orange-100" title="มีพิกัด GPS">
                          <MapPin size={10} /> พิกัด
                        </span>
                      )}
                      {c.attachments && c.attachments.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100" title="มีภาพประกอบ">
                          <Camera size={10} /> {c.attachments.length} ภาพ
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-gray-300 mt-1.5">
                      {new Date(c.created_at).toLocaleDateString('th-TH', {
                        day: '2-digit', month: 'short', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })} น.
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex flex-col items-center gap-3 mt-6">
            {/* Page size selector */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>แสดง</span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:border-transparent cursor-pointer"
                style={{ '--tw-ring-color': 'var(--color-primary)' }}>
                {ITEMS_PER_PAGE_OPTIONS.map(n => (
                  <option key={n} value={n}>{n} รายการ</option>
                ))}
                <option value="all">ทั้งหมด</option>
              </select>
              <span className="text-gray-400">
                ({startIdx + 1}–{Math.min(startIdx + perPage, complaints.length)} จาก {complaints.length})
              </span>
            </div>

            {/* Page buttons */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1.5">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft size={16} />
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => {
                    if (totalPages <= 7) return true
                    if (p === 1 || p === totalPages) return true
                    if (Math.abs(p - currentPage) <= 1) return true
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
                        onClick={() => goToPage(p)}
                        className={`min-w-[36px] h-9 rounded-xl text-sm font-semibold transition-all ${
                          currentPage === p
                            ? 'text-white shadow-md'
                            : 'text-gray-500 hover:bg-gray-100 border border-gray-200'
                        }`}
                        style={currentPage === p ? { backgroundColor: 'var(--color-primary)' } : undefined}>
                        {p}
                      </button>
                    )
                  )}

                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {selected && (
        <DetailSheet
          complaint={selected}
          onClose={() => setSelected(null)}
          onAttachmentsChange={handleAttachmentsChange}
          onRate={selected.rating == null && isClosed(selected.status) ? openRating : undefined}
          catLabel={catLabel}
          catEmoji={catEmoji}
        />
      )}
      </div>
    </div>
  )
}
