import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import {
  Plus, ArrowLeft, Pencil, Trash2, Flag, Users, Trophy,
  AlertTriangle, CheckSquare, UserCheck, FileText, ImagePlus,
  Globe, Lock, ChevronDown, Loader2, X, Calendar, Link2,
} from 'lucide-react'

const STATUS_CFG = {
  planning:  { label: 'วางแผน',         bg: '#f3f4f6', text: '#374151' },
  active:    { label: 'ดำเนินการอยู่',   bg: '#d1fae5', text: '#065f46' },
  completed: { label: 'เสร็จสิ้น',       bg: '#dbeafe', text: '#1e40af' },
  suspended: { label: 'ระงับชั่วคราว',   bg: '#fef3c7', text: '#92400e' },
}

const UPDATE_TYPES = [
  { value: 'milestone',  label: 'เหตุการณ์สำคัญ',     Icon: Flag,          color: '#7c3aed', bg: '#ede9fe' },
  { value: 'meeting',    label: 'ประชุม',               Icon: Users,         color: '#0891b2', bg: '#e0f2fe' },
  { value: 'achievement',label: 'ความสำเร็จ',           Icon: Trophy,        color: '#d97706', bg: '#fef3c7' },
  { value: 'issue',      label: 'ปัญหา/อุปสรรค',       Icon: AlertTriangle, color: '#dc2626', bg: '#fee2e2' },
  { value: 'decision',   label: 'การตัดสินใจ',          Icon: CheckSquare,   color: '#059669', bg: '#d1fae5' },
  { value: 'personnel',  label: 'เปลี่ยนแปลงบุคลากร',  Icon: UserCheck,     color: '#db2777', bg: '#fce7f3' },
  { value: 'other',      label: 'อื่นๆ',                Icon: FileText,      color: '#6b7280', bg: '#f3f4f6' },
]

function getUpdateTypeCfg(t) { return UPDATE_TYPES.find(u => u.value === t) ?? UPDATE_TYPES[UPDATE_TYPES.length - 1] }

async function compressImage(file, maxSize = 1200) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(b => resolve(b ?? file), 'image/jpeg', 0.82)
    }
    img.src = URL.createObjectURL(file)
  })
}

async function uploadPhoto(file, projectId) {
  const ext  = file.name.split('.').pop()
  const path = `org-projects/${projectId}/${Date.now()}.${ext}`
  const compressed = await compressImage(file)
  const { error } = await supabase.storage.from('complaint-attachments').upload(path, compressed)
  if (error) return null
  const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
  return data.publicUrl
}

// ─── Project Form ────────────────────────────────────────────────────────────

function ProjectForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    title: '', subtitle: '', category: '', description: '',
    status: 'active', start_date: '', end_date: '',
    cover_image_url: '', is_public: true,
    ...(initial ?? {}),
  })
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-500 mb-1">ชื่อโครงการ *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400"
            placeholder="ชื่อโครงการ" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">คำอธิบายสั้น</label>
          <input value={form.subtitle} onChange={e => set('subtitle', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400"
            placeholder="คำอธิบายสั้นๆ 1 บรรทัด" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">หมวดหมู่ (กำหนดเอง)</label>
          <input value={form.category} onChange={e => set('category', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400"
            placeholder="เช่น พัฒนาชุมชน, การศึกษา, สิ่งแวดล้อม" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">สถานะ</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none">
            {Object.entries(STATUS_CFG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">วันเริ่มต้น</label>
          <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">วันสิ้นสุด (เว้นว่างถ้ายังไม่จบ)</label>
          <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-500 mb-1">URL รูปปก (ถ้ามี)</label>
          <input value={form.cover_image_url} onChange={e => set('cover_image_url', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400"
            placeholder="https://..." />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-500 mb-1">ภาพรวมโครงการ (wiki)</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            rows={6}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400 resize-y"
            placeholder="เขียนเล่าที่มา เป้าหมาย วิธีดำเนินงาน ข้อมูลสำคัญที่คนใหม่ต้องรู้..." />
        </div>
        <div className="md:col-span-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div onClick={() => set('is_public', !form.is_public)}
              className={`w-10 h-6 rounded-full flex items-center transition-colors ${form.is_public ? 'bg-emerald-500' : 'bg-gray-300'}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${form.is_public ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <span className="text-sm text-gray-700 flex items-center gap-1">
              {form.is_public
                ? <><Globe size={14} className="text-emerald-500" /> แสดงต่อสาธารณะ</>
                : <><Lock size={14} className="text-gray-400" /> ภายในเท่านั้น</>}
            </span>
          </label>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button onClick={() => onSave(form)} disabled={saving || !form.title.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          บันทึก
        </button>
        <button onClick={onCancel} disabled={saving}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">
          ยกเลิก
        </button>
      </div>
    </div>
  )
}

// ─── Timeline Entry Form ──────────────────────────────────────────────────────

function UpdateForm({ projectId, municipalityId, onSaved, onCancel }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ update_type: 'milestone', title: '', body: '', update_date: today, link_url: '' })
  const [photos, setPhotos] = useState([])
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function addPhotos(e) {
    const files = Array.from(e.target.files ?? [])
    setPhotos(prev => [...prev, ...files].slice(0, 5))
    e.target.value = ''
  }

  async function handleSave() {
    if (!form.title.trim()) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    let photoUrls = []
    for (const f of photos) {
      const url = await uploadPhoto(f, projectId)
      if (url) photoUrls.push(url)
    }
    const { error } = await supabase.from('org_project_updates').insert({
      project_id: projectId,
      municipality_id: municipalityId,
      update_type: form.update_type,
      title: form.title.trim(),
      body: form.body.trim() || null,
      update_date: form.update_date,
      photos: photoUrls,
      link_url: form.link_url.trim() || null,
      created_by: session?.user?.id ?? null,
    })
    setSaving(false)
    if (!error) {
      setForm({ update_type: 'milestone', title: '', body: '', update_date: today, link_url: '' })
      setPhotos([])
      onSaved()
    }
  }

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
      <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">+ เพิ่มรายการในไทม์ไลน์</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">ประเภท</label>
          <select value={form.update_type} onChange={e => set('update_type', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none">
            {UPDATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">วันที่เกิดขึ้น</label>
          <input type="date" value={form.update_date} onChange={e => set('update_date', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-500 mb-1">หัวข้อ *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400"
            placeholder="สรุปสั้นๆ เช่น ประชุมคณะทำงานครั้งที่ 1" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-500 mb-1">รายละเอียด</label>
          <textarea value={form.body} onChange={e => set('body', e.target.value)} rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400 resize-y"
            placeholder="เล่าเรื่องราว บันทึกผล หรือสิ่งที่ตัดสินใจ..." />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-500 mb-1">ลิ้งก์อ้างอิง (ถ้ามี)</label>
          <div className="relative">
            <Link2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={form.link_url} onChange={e => set('link_url', e.target.value)}
              className="w-full pl-8 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-400"
              placeholder="https://..." />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          <ImagePlus size={13} /> แนบรูป ({photos.length}/5)
          <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
        </label>
        {photos.map((f, i) => (
          <div key={i} className="flex items-center gap-1 text-xs text-gray-600 bg-white border border-gray-200 px-2 py-1 rounded-lg">
            {f.name.slice(0, 16)}
            <button onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}><X size={10} /></button>
          </div>
        ))}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <button onClick={onCancel} disabled={saving}
              className="px-3 py-1.5 rounded-xl text-sm font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
              ยกเลิก
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !form.title.trim()}
            className="px-4 py-1.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : null} บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Timeline Entry Card ──────────────────────────────────────────────────────

function UpdateCard({ upd, onDelete, onSaved, canDelete }) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft({
      update_type: upd.update_type,
      title: upd.title,
      body: upd.body ?? '',
      update_date: upd.update_date ?? '',
      link_url: upd.link_url ?? '',
    })
    setIsEditing(true)
  }
  function cancelEdit() { setIsEditing(false) }
  function set(k, v) { setDraft(d => ({ ...d, [k]: v })) }

  async function saveEdit() {
    if (!draft.title.trim()) return
    setSaving(true)
    const { error } = await supabase.from('org_project_updates').update({
      update_type: draft.update_type,
      title: draft.title.trim(),
      body: draft.body.trim() || null,
      update_date: draft.update_date || upd.update_date,
      link_url: draft.link_url?.trim() || null,
    }).eq('id', upd.id)
    setSaving(false)
    if (!error) { setIsEditing(false); onSaved?.() }
  }

  const cfg = getUpdateTypeCfg(isEditing ? draft.update_type : upd.update_type)
  const Icon = cfg.Icon
  const d = upd.update_date ? new Date(upd.update_date + 'T00:00:00') : null
  const dateStr = d ? d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : ''

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: cfg.bg }}>
          <Icon size={15} style={{ color: cfg.color }} />
        </div>
        <div className="w-px flex-1 bg-gray-200 mt-1" />
      </div>
      <div className="pb-4 flex-1 min-w-0">
        {isEditing ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">ประเภท</label>
                <select value={draft.update_type} onChange={e => set('update_type', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none">
                  {UPDATE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1">วันที่</label>
                <input type="date" value={draft.update_date} onChange={e => set('update_date', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 bg-white focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">หัวข้อ</label>
              <input value={draft.title} onChange={e => set('title', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">รายละเอียด</label>
              <textarea value={draft.body} onChange={e => set('body', e.target.value)} rows={3}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:border-emerald-400 resize-y" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1">ลิ้งก์อ้างอิง</label>
              <div className="relative">
                <Link2 size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={draft.link_url} onChange={e => set('link_url', e.target.value)}
                  className="w-full pl-6 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 bg-white focus:outline-none focus:border-emerald-400"
                  placeholder="https://..." />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={cancelEdit} disabled={saving}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors">
                ยกเลิก
              </button>
              <button onClick={saveEdit} disabled={saving || !draft.title.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-1">
                {saving ? <Loader2 size={11} className="animate-spin" /> : null} บันทึก
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cfg.color }}>{cfg.label}</span>
                <span className="text-[10px] text-gray-400 ml-2">{dateStr}</span>
              </div>
              <div className="flex gap-0.5 shrink-0">
                <button onClick={startEdit}
                  className="p-1 text-gray-300 hover:text-blue-500 transition-colors">
                  <Pencil size={11} />
                </button>
                {canDelete && (
                  <button onClick={() => onDelete(upd.id)}
                    className="p-1 text-gray-300 hover:text-red-400 transition-colors">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </div>
            <p className="font-semibold text-gray-800 text-sm mt-0.5">{upd.title}</p>
            {upd.body && <p className="text-gray-600 text-xs mt-1 whitespace-pre-wrap leading-relaxed">{upd.body}</p>}
            {upd.link_url && (
              <a href={upd.link_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 mt-1.5 text-xs text-blue-600 hover:underline">
                <Link2 size={11} /> {upd.link_url.replace(/^https?:\/\//, '').slice(0, 50)}
              </a>
            )}
            {upd.photos?.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {upd.photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer">
                    <img src={url} className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({ project, updateCount, onClick }) {
  const s = STATUS_CFG[project.status] ?? STATUS_CFG.active
  const d = project.start_date ? new Date(project.start_date + 'T00:00:00') : null
  const dateStr = d ? d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short' }) : null
  return (
    <button onClick={onClick}
      className="w-full text-left rounded-2xl overflow-hidden border border-gray-200 hover:border-emerald-300 hover:shadow-md transition-all group bg-white">
      {project.cover_image_url ? (
        <img src={project.cover_image_url} className="w-full h-32 object-cover group-hover:brightness-95 transition-all" />
      ) : (
        <div className="w-full h-32 flex items-center justify-center text-3xl"
          style={{ background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)' }}>
          📋
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
          {!project.is_public && <Lock size={12} className="text-gray-400 mt-0.5 shrink-0" />}
        </div>
        <p className="font-bold text-gray-800 text-sm leading-snug mt-2 line-clamp-2">{project.title}</p>
        {project.subtitle && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{project.subtitle}</p>}
        <div className="flex items-center justify-between mt-3 text-[10px] text-gray-400">
          <span>{project.category || '—'}</span>
          <span className="flex items-center gap-1">
            <Calendar size={10} />{dateStr ?? 'ไม่ระบุวัน'}
          </span>
        </div>
        {updateCount > 0 && (
          <p className="text-[10px] text-emerald-600 mt-1">{updateCount} รายการในไทม์ไลน์</p>
        )}
      </div>
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OrgProjectAdmin({ tenant }) {
  const [projects, setProjects]   = useState([])
  const [updateCounts, setUpdateCounts] = useState({})
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(null)  // project object
  const [updates, setUpdates]     = useState([])
  const [updLoading, setUpdLoading] = useState(false)
  const [tab, setTab]             = useState('overview')  // 'overview' | 'timeline'
  const [showForm, setShowForm]       = useState(false)
  const [showUpdateForm, setShowUpdateForm] = useState(false)
  const [editMode, setEditMode]       = useState(false)
  const [saving, setSaving]           = useState(false)

  const loadProjects = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data } = await supabase.from('org_projects')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('sort_order').order('created_at', { ascending: false })
    setProjects(data ?? [])
    // count updates per project
    const { data: counts } = await supabase.from('org_project_updates')
      .select('project_id')
      .in('project_id', (data ?? []).map(p => p.id))
    const c = {}
    ;(counts ?? []).forEach(r => { c[r.project_id] = (c[r.project_id] ?? 0) + 1 })
    setUpdateCounts(c)
    setLoading(false)
  }, [tenant?.id])

  const loadUpdates = useCallback(async (projectId) => {
    setUpdLoading(true)
    const { data } = await supabase.from('org_project_updates')
      .select('*').eq('project_id', projectId)
      .order('update_date', { ascending: false }).order('created_at', { ascending: false })
    setUpdates(data ?? [])
    setUpdLoading(false)
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  async function handleSaveProject(form) {
    if (!form.title.trim()) return
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (selected && editMode) {
      const { error } = await supabase.from('org_projects').update({
        ...form,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        cover_image_url: form.cover_image_url || null,
        updated_at: new Date().toISOString(),
      }).eq('id', selected.id)
      if (!error) {
        const updated = { ...selected, ...form }
        setSelected(updated)
        setProjects(prev => prev.map(p => p.id === selected.id ? updated : p))
        setEditMode(false)
      }
    } else {
      const id = crypto.randomUUID()
      const { error } = await supabase.from('org_projects').insert({
        id,
        municipality_id: tenant.id,
        created_by: session?.user?.id ?? null,
        ...form,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        cover_image_url: form.cover_image_url || null,
      })
      if (!error) {
        setShowForm(false)
        loadProjects()
      }
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!window.confirm('ลบโครงการนี้? ไทม์ไลน์ทั้งหมดจะถูกลบด้วย')) return
    await supabase.from('org_projects').delete().eq('id', id)
    setSelected(null)
    loadProjects()
  }

  async function handleDeleteUpdate(id) {
    if (!window.confirm('ลบรายการนี้?')) return
    await supabase.from('org_project_updates').delete().eq('id', id)
    loadUpdates(selected.id)
  }

  function openProject(p) {
    setSelected(p)
    setTab('overview')
    setEditMode(false)
    setShowUpdateForm(false)
    loadUpdates(p.id)
  }

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (selected) {
    const s = STATUS_CFG[selected.status] ?? STATUS_CFG.active
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => setSelected(null)}
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 truncate">{selected.title}</p>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>
          </div>
          <button onClick={() => setEditMode(e => !e)}
            className="p-2 rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
            <Pencil size={16} />
          </button>
          <button onClick={() => handleDelete(selected.id)}
            className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={16} />
          </button>
        </div>

        {/* Cover image */}
        {selected.cover_image_url && !editMode && (
          <img src={selected.cover_image_url} className="w-full h-48 object-cover rounded-2xl" />
        )}

        {/* Tabs */}
        {!editMode && (
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            {[['overview', 'ภาพรวม'], ['timeline', 'ไทม์ไลน์']].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {label}
                {key === 'timeline' && updates.length > 0 && (
                  <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 px-1.5 rounded-full">{updates.length}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Edit form */}
        {editMode && (
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <ProjectForm initial={selected} onSave={handleSaveProject}
              onCancel={() => setEditMode(false)} saving={saving} />
          </div>
        )}

        {/* Overview tab */}
        {!editMode && tab === 'overview' && (
          <div className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
              {selected.category && (
                <div>
                  <p className="text-xs text-gray-400 font-semibold">หมวดหมู่</p>
                  <p className="text-sm text-gray-700">{selected.category}</p>
                </div>
              )}
              {(selected.start_date || selected.end_date) && (
                <div>
                  <p className="text-xs text-gray-400 font-semibold">ระยะเวลา</p>
                  <p className="text-sm text-gray-700">
                    {selected.start_date ? new Date(selected.start_date + 'T00:00:00').toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'ไม่ระบุ'}
                    {' — '}
                    {selected.end_date ? new Date(selected.end_date + 'T00:00:00').toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'ปัจจุบัน'}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-400 font-semibold mb-0.5">การมองเห็น</p>
                <p className="text-sm flex items-center gap-1">
                  {selected.is_public
                    ? <><Globe size={13} className="text-emerald-500" /> สาธารณะ</>
                    : <><Lock size={13} className="text-gray-400" /> ภายในเท่านั้น</>}
                </p>
              </div>
            </div>
            {selected.description && (
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <p className="text-xs text-gray-400 font-semibold mb-2">ภาพรวมโครงการ</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{selected.description}</p>
              </div>
            )}
          </div>
        )}

        {/* Timeline tab */}
        {!editMode && tab === 'timeline' && (
          <div className="space-y-3">
            {showUpdateForm ? (
              <UpdateForm
                projectId={selected.id}
                municipalityId={tenant.id}
                onSaved={() => { setShowUpdateForm(false); loadUpdates(selected.id) }}
                onCancel={() => setShowUpdateForm(false)}
              />
            ) : (
              <button
                onClick={() => setShowUpdateForm(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-2 border-dashed border-emerald-300 text-emerald-600 text-sm font-semibold hover:bg-emerald-50 transition-colors">
                <Plus size={16} /> เพิ่มรายการในไทม์ไลน์
              </button>
            )}
            {updLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
            ) : updates.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">ยังไม่มีรายการ — กดปุ่มด้านบนเพื่อเพิ่ม</p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                {updates.map(u => (
                  <UpdateCard key={u.id} upd={u}
                    onDelete={handleDeleteUpdate} onSaved={() => loadUpdates(selected.id)} canDelete={true} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-800 text-lg">โครงการองค์กร</h2>
          <p className="text-xs text-gray-400">บันทึกเรื่องราวและบริหารโครงการระยะยาว</p>
        </div>
        <button onClick={() => setShowForm(f => !f)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors">
          <Plus size={16} /> สร้างโครงการ
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="font-semibold text-gray-700 mb-3">โครงการใหม่</p>
          <ProjectForm onSave={handleSaveProject}
            onCancel={() => setShowForm(false)} saving={saving} />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-semibold">ยังไม่มีโครงการ</p>
          <p className="text-sm mt-1">กดปุ่ม "สร้างโครงการ" เพื่อเริ่มต้น</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <ProjectCard key={p.id} project={p}
              updateCount={updateCounts[p.id] ?? 0}
              onClick={() => openProject(p)} />
          ))}
        </div>
      )}
    </div>
  )
}
