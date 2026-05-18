import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2, LogOut, MapPin, Phone, X, RefreshCw,
  CheckCircle2, Image, AlignLeft, ChevronRight, Wrench,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const STATUS = {
  pending:     { label: 'รอดำเนินการ',    bg: '#fef3c7', text: '#92400e' },
  received:    { label: 'รับเรื่องแล้ว',   bg: '#dbeafe', text: '#1e40af' },
  in_progress: { label: 'กำลังดำเนินการ', bg: '#ede9fe', text: '#5b21b6' },
  completed:   { label: 'เสร็จสิ้น',      bg: '#d1fae5', text: '#065f46' },
  rejected:    { label: 'ปฏิเสธ',         bg: '#fee2e2', text: '#991b1b' },
}

const NEXT_ACTION = {
  pending:     { label: 'รับงาน',      next: 'received' },
  received:    { label: 'เริ่มดำเนินการ', next: 'in_progress' },
  in_progress: { label: 'ปิดงาน',     next: 'completed' },
}

const CATEGORY_LABEL = {
  road: 'ซ่อมแซมถนน', light: 'ไฟฟ้าสาธารณะ',
  trash: 'ขยะ/ความสะอาด', water: 'น้ำประปา',
  flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ตัดต้นไม้',
  noise: 'แจ้งเหตุรำคาญ', drain: 'ท่อระบายน้ำ',
  waste_water: 'น้ำเสีย', suction: 'ดูดสิ่งปฏิกูล',
  manhole: 'ฝาท่อระบายน้ำ', vendor: 'ขายของบนทางสาธารณะ',
  building: 'ตรวจสอบอาคาร', mosquito: 'พ่นยุง',
  pollution: 'กลิ่นควัน/มลพิษ', corruption: 'แจ้งการทุจริต',
  tax: 'ภาษีและค่าธรรมเนียม', canal: 'ลอกคลอง',
  animals: 'สุนัขและแมวจรจัด', water_supply: 'สนับสนุนน้ำอุปโภค',
  borrow_equipment: 'ยืมพัสดุ', grievance: 'ร้องทุกข์/ร้องเรียน',
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

// ── badge helpers ────────────────────────────────────────────────────────────
function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem('sl_tech_seen') ?? '[]')) }
  catch { return new Set() }
}

function markSeen(id) {
  const seen = getSeenIds()
  seen.add(id)
  localStorage.setItem('sl_tech_seen', JSON.stringify([...seen]))
}

function emitTechBadge(list) {
  const seen = getSeenIds()
  const count = list.filter(c => c.status !== 'completed' && !seen.has(c.id)).length
  localStorage.setItem('sl_tech_new', String(count))
  window.dispatchEvent(new CustomEvent('tech-badge-update', { detail: count }))
}

const STATUS_FLOW = ['pending', 'received', 'in_progress', 'completed']
const STATUS_FLOW_LABEL = {
  pending:     { label: 'รอดำเนินการ',    desc: 'คำร้องของคุณถูกส่งเข้าระบบแล้ว' },
  received:    { label: 'รับเรื่องแล้ว',   desc: 'เจ้าหน้าที่รับทราบและตรวจสอบ' },
  in_progress: { label: 'กำลังดำเนินการ', desc: 'อยู่ระหว่างดำเนินการแก้ไข' },
  completed:   { label: 'เสร็จสิ้น',      desc: 'ดำเนินการเสร็จสิ้นเรียบร้อย' },
}

function StatusStepper({ status }) {
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
                     ? { backgroundColor: '#2563eb', borderColor: '#2563eb' }
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
                     style={{ backgroundColor: i < currentIdx ? '#2563eb' : '#e5e7eb', minHeight: '28px' }} />
              )}
            </div>
            <div className={`pb-5 pt-0.5 ${isLast ? 'pb-0' : ''}`}>
              <p className={`text-sm font-semibold ${done ? 'text-gray-800' : 'text-gray-300'}`}>
                {info.label}
                {isCurrent && (
                  <span className="ml-2 text-[13px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    ปัจจุบัน
                  </span>
                )}
              </p>
              <p className={`text-xs mt-0.5 ${done ? 'text-gray-400' : 'text-gray-200'}`}>{info.desc}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}


function DetailSheet({ complaint: c, onClose, onUpdate, updating }) {
  const [note, setNote] = useState(c.technician_note ?? '')
  const [photos, setPhotos] = useState(c.work_photos ?? [])
  const [uploading, setUploading] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  const action = NEXT_ACTION[c.status]
  const catLabel = CATEGORY_LABEL[c.category] ?? c.category
  const catEmoji = CATEGORY_EMOJI[c.category] ?? '📄'

  async function uploadPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const path = `${c.id}/work_${Date.now()}.${file.name.split('.').pop()}`
    const { error: upErr } = await supabase.storage
      .from('complaint-attachments')
      .upload(path, file, { upsert: false })
    if (!upErr) {
      const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
      const newPhotos = [...photos, data.publicUrl]
      setPhotos(newPhotos)
      await supabase.from('complaints').update({ work_photos: newPhotos }).eq('id', c.id)
    }
    setUploading(false)
    e.target.value = ''
  }

  async function saveNote() {
    setSavingNote(true)
    await supabase.from('complaints').update({ technician_note: note }).eq('id', c.id)
    setSavingNote(false)
  }

  const needsPhoto = c.status === 'in_progress' && photos.length === 0

  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="shrink-0 px-5 pt-6 pb-5"
             style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)' }}>
          <button onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors">
            <X size={16} />
          </button>
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shrink-0">
              {catEmoji}
            </div>
            <div className="flex-1 min-w-0 pr-10">
              <p className="text-white/70 text-xs">งานที่ได้รับมอบหมาย</p>
              <p className="text-white font-bold text-base mt-0.5">{catLabel}</p>
              {c.subject && <p className="text-white/80 text-sm mt-1">{c.subject}</p>}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/20 flex justify-between items-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: STATUS[c.status]?.bg, color: STATUS[c.status]?.text }}>
              {STATUS[c.status]?.label}
            </span>
            <p className="text-white/70 text-xs">
              {new Date(c.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-white">

          {/* ความคืบหน้า */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">ความคืบหน้า</p>
            <StatusStepper status={c.status} />
          </div>

          {/* รายละเอียด */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รายละเอียดปัญหา</p>
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.detail}</p>
            </div>
          </div>

          {/* สถานที่ + โทร */}
          {(c.location_name || c.village || c.phone || c.latitude) && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">จุดเกิดเหตุ</p>
              <div className="bg-gray-50 rounded-2xl divide-y divide-gray-100 overflow-hidden border border-gray-100">
                {(c.location_name || c.village) && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <MapPin size={15} className="text-orange-400 shrink-0" />
                    <p className="text-sm text-gray-700">{c.location_name ?? c.village}</p>
                  </div>
                )}
                {c.phone && (
                  <a href={`tel:${c.phone}`}
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <Phone size={15} className="text-green-500 shrink-0" />
                    <p className="text-sm font-bold text-gray-800 flex-1">{c.phone}</p>
                    <span className="text-xs font-semibold px-2 py-1 bg-green-100 text-green-700 rounded-lg">โทรออก</span>
                  </a>
                )}
                {c.latitude && (
                  <a href={`https://maps.google.com/?q=${c.latitude},${c.longitude}`}
                     target="_blank" rel="noreferrer"
                     className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors">
                    <MapPin size={15} className="text-blue-500 shrink-0" />
                    <p className="text-sm text-gray-700 flex-1">
                      {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                    </p>
                    <span className="text-xs font-semibold px-2 py-1 bg-blue-100 text-blue-700 rounded-lg">แผนที่</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* รูปจากประชาชน */}
          {(c.attachments ?? []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">รูปจากประชาชน</p>
              <div className="grid grid-cols-3 gap-2">
                {c.attachments.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* รูปหลักฐานช่าง */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                รูปหลักฐานการทำงาน {photos.length > 0 && `(${photos.length})`}
              </p>
              {c.status !== 'completed' && c.status !== 'rejected' && (
                <label className="cursor-pointer flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                  {uploading
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Image size={13} />}
                  {uploading ? 'กำลังอัปโหลด...' : 'ถ่ายรูป / เพิ่มรูป'}
                  <input type="file" accept="image/*" capture="environment"
                         className="hidden" onChange={uploadPhoto} disabled={uploading} />
                </label>
              )}
            </div>
            {photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer"
                     className="aspect-square rounded-xl overflow-hidden border border-blue-200 bg-blue-50">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400">
                <div className="text-center">
                  <Image size={24} className="mx-auto mb-1 opacity-50" />
                  <p className="text-xs">ยังไม่มีรูปหลักฐาน</p>
                </div>
              </div>
            )}
          </div>

          {/* บันทึกของช่าง */}
          {c.status !== 'completed' && c.status !== 'rejected' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">บันทึกของช่าง</p>
              <div className="flex gap-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="บันทึกรายละเอียดการดำเนินการ..."
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': '#2563eb' }}
                />
                <button onClick={saveNote} disabled={savingNote}
                        className="self-end px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50">
                  {savingNote ? <Loader2 size={13} className="animate-spin" /> : 'บันทึก'}
                </button>
              </div>
            </div>
          )}

          {/* บันทึกที่บันทึกไว้แล้ว (completed) */}
          {c.status === 'completed' && c.technician_note && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">บันทึกของช่าง</p>
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.technician_note}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {c.status !== 'completed' && c.status !== 'rejected' && (
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 shrink-0 space-y-2">
            {needsPhoto && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
                กรุณาถ่ายรูปหลักฐานก่อนปิดงาน
              </p>
            )}
            {action && (
              <button
                onClick={() => onUpdate(c.id, action.next, action.next === 'completed' ? photos : null, action.next === 'completed' ? note : null)}
                disabled={updating === c.id || (action.next === 'completed' && needsPhoto)}
                className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-98 disabled:opacity-50"
                style={{ backgroundColor: action.next === 'completed' ? '#10b981' : '#2563eb' }}>
                {updating === c.id
                  ? <Loader2 size={16} className="animate-spin mx-auto" />
                  : action.next === 'completed'
                    ? `✅ ${action.label}`
                    : `${action.label} →`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TechnicianDashboard() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [selected, setSelected] = useState(null)
  const [myName, setMyName] = useState('')
  const [seenIds, setSeenIds] = useState(getSeenIds)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('full_name, role').eq('id', data.session.user.id).single()
        .then(({ data: p }) => {
          if (p?.role !== 'technician') navigate('/')
          setMyName(p?.full_name ?? 'ช่าง')
        })
    })
  }, [navigate])

  const fetchComplaints = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) { setLoading(false); return }
    const { data } = await supabase
      .from('complaints')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('assigned_to', session.session.user.id)
      .neq('status', 'rejected')
      .order('created_at', { ascending: false })
    setComplaints(data ?? [])
    emitTechBadge(data ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { fetchComplaints() }, [fetchComplaints])

  async function updateStatus(id, nextStatus, workPhotos = null, techNote = null) {
    setUpdating(id)
    const payload = { status: nextStatus }
    if (workPhotos?.length > 0) payload.work_photos = workPhotos
    if (techNote !== null) payload.technician_note = techNote
    const { error } = await supabase
      .from('complaints')
      .update(payload)
      .eq('id', id)
    if (!error) {
      const updated = complaints.map((c) => c.id === id ? { ...c, ...payload } : c)
      setComplaints(updated)
      emitTechBadge(updated)
      setSelected(null)
    }
    setUpdating(null)
  }

  function handleOpenComplaint(c) {
    markSeen(c.id)
    const updated = getSeenIds()
    setSeenIds(updated)
    emitTechBadge(complaints)
    setSelected(c)
  }

  const pending = complaints.filter((c) => c.status !== 'completed')
  const done = complaints.filter((c) => c.status === 'completed')

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 space-y-6">
      {selected && (
        <DetailSheet
          complaint={selected}
          onClose={() => setSelected(null)}
          onUpdate={updateStatus}
          updating={updating}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">งานของฉัน</h1>
          <p className="text-sm text-gray-400">{myName} · {tenant?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchComplaints} disabled={loading}
            className="p-2 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={async () => { await supabase.auth.signOut(); navigate('/') }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-500 bg-white hover:bg-red-50 transition-colors">
            <LogOut size={14} />
            ออก
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-300" />
        </div>
      ) : complaints.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Wrench size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-500">ยังไม่มีงานที่ได้รับมอบหมาย</p>
          <p className="text-sm mt-1">เมื่อ Admin มอบหมายงานให้ จะแสดงที่นี่</p>
        </div>
      ) : (
        <>
          {/* งานที่ยังค้างอยู่ */}
          {pending.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                งานที่รอดำเนินการ ({pending.length})
              </p>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {pending.map((c, i) => {
                  const s = STATUS[c.status]
                  return (
                    <button key={c.id} onClick={() => handleOpenComplaint(c)}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors active:bg-gray-100 ${i < pending.length - 1 ? 'border-b border-gray-50' : ''}`}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-gray-100">
                        {CATEGORY_EMOJI[c.category] ?? '📄'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          <span className="text-gray-400 font-mono font-normal mr-1">{i + 1}.</span>
                          {CATEGORY_LABEL[c.category] ?? c.category}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{c.detail}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <div className="flex items-center gap-1.5">
                          {!seenIds.has(c.id) && (
                            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                          )}
                          <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: s?.bg, color: s?.text }}>
                            {s?.label}
                          </span>
                        </div>
                        <ChevronRight size={14} className="text-gray-300" />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* งานที่เสร็จแล้ว */}
          {done.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                เสร็จสิ้นแล้ว ({done.length})
              </p>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden opacity-70">
                {done.map((c, i) => (
                  <button key={c.id} onClick={() => handleOpenComplaint(c)}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors ${i < done.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-green-50">
                      {CATEGORY_EMOJI[c.category] ?? '📄'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-600 truncate">
                        <span className="text-gray-400 font-mono font-normal mr-1">{i + 1}.</span>
                        {CATEGORY_LABEL[c.category] ?? c.category}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{c.detail}</p>
                    </div>
                    <CheckCircle2 size={18} className="text-green-500 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
