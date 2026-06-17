import { useState, useEffect, useCallback } from 'react'
import {
  Search, Upload, FileText, ImageIcon, Download, Eye, Trash2, X,
  Clock, Shield, Tag, Loader2, BookOpen, History, AlertCircle,
  Lock, ChevronDown, ChevronUp, Hash,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageUtils'
import { logAction } from '../../lib/auditLog'

// ─── Constants ────────────────────────────────────────────────────────────────

const BUCKET = 'org-documents'

const DEPARTMENTS = [
  { key: 'all',         label: 'ทั้งหมด',        emoji: '📁' },
  { key: 'admin',       label: 'ฝ่ายบริหาร',      emoji: '🏛️', restricted: true },
  { key: 'general',     label: 'สำนักปลัด',       emoji: '📋' },
  { key: 'engineering', label: 'กองช่าง',          emoji: '⚙️' },
  { key: 'education',   label: 'กองการศึกษา',     emoji: '🎓' },
  { key: 'finance',     label: 'กองคลัง',          emoji: '💰' },
]

const DEPT_MAP = Object.fromEntries(DEPARTMENTS.map(d => [d.key, d]))

function visibleDepts(role) {
  if (['admin', 'superadmin', 'viewer'].includes(role)) return DEPARTMENTS.map(d => d.key)
  if (role === 'council') return ['all', 'admin']
  return ['all', 'general', 'engineering', 'education', 'finance'] // staff, technician
}

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ─── DocCard ──────────────────────────────────────────────────────────────────

function DocCard({ doc, onOpen, onDelete, deleting, role }) {
  const isPdf = doc.file_type === 'pdf'
  const canDelete = ['admin', 'superadmin'].includes(role)
  const dept = DEPT_MAP[doc.department]

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex gap-3 hover:shadow-md transition-shadow">
      <div className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-2xl bg-gray-50">
        {isPdf ? '📄' : '🖼️'}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-800 text-sm leading-snug line-clamp-2">{doc.title}</p>
            {doc.doc_number && (
              <p className="text-xs text-gray-400 mt-0.5">เลขที่ {doc.doc_number}</p>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button onClick={() => onOpen(doc)}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors">
              <Eye size={15} />
            </button>
            {canDelete && (
              <button onClick={() => onDelete(doc.id)} disabled={deleting === doc.id}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-red-400 hover:bg-red-50 transition-colors disabled:opacity-40">
                {deleting === doc.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          {dept && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {dept.emoji} {dept.label}
            </span>
          )}
          {doc.doc_date && (
            <span className="text-[10px] text-gray-400">{formatDate(doc.doc_date)}</span>
          )}
          {doc.file_size && (
            <span className="text-[10px] text-gray-300">{formatBytes(doc.file_size)}</span>
          )}
        </div>

        {doc.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {doc.tags.map(t => (
              <span key={t} className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-md">
                #{t}
              </span>
            ))}
          </div>
        )}

        {doc.uploader?.full_name && (
          <p className="text-[10px] text-gray-300 mt-1.5">อัปโหลดโดย {doc.uploader.full_name}</p>
        )}
      </div>
    </div>
  )
}

// ─── ViewerModal ─────────────────────────────────────────────────────────────

function ViewerModal({ item, onClose }) {
  const { doc, signedUrl } = item
  const isPdf = doc.file_type === 'pdf'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900" onClick={e => e.stopPropagation()}>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{doc.title}</p>
          {doc.doc_number && <p className="text-gray-400 text-xs">เลขที่ {doc.doc_number}</p>}
        </div>
        <div className="flex items-center gap-2 ml-3">
          <a href={signedUrl} download={doc.file_name}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors"
            onClick={e => e.stopPropagation()}>
            <Download size={13} /> ดาวน์โหลด
          </a>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden" onClick={e => e.stopPropagation()}>
        {isPdf ? (
          <iframe src={signedUrl} title={doc.title} className="w-full h-full border-0" />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
            <img src={signedUrl} alt={doc.title} className="max-w-full max-h-full object-contain rounded-xl" />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── UploadModal ──────────────────────────────────────────────────────────────

const emptyForm = {
  title: '', doc_number: '', doc_date: '', department: 'general',
  tags: '', description: '', file: null,
}

function UploadModal({ tenantId, uploaderId, allowedDepts, onClose, onSuccess }) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [err, setErr]     = useState('')

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const uploadDepts = DEPARTMENTS.filter(d => d.key !== 'all' && allowedDepts.includes(d.key))

  async function handleSubmit() {
    if (!form.title.trim() || !form.doc_number.trim() || !form.doc_date || !form.file) {
      setErr('กรุณากรอกข้อมูลที่จำเป็นให้ครบ (ชื่อเอกสาร, เลขที่, วันที่, ไฟล์)')
      return
    }

    const file = form.file
    const ext  = file.name.split('.').pop().toLowerCase()
    const isImg = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)
    const isPdf = ext === 'pdf'
    if (!isImg && !isPdf) { setErr('รองรับเฉพาะไฟล์ PDF หรือรูปภาพ'); return }

    setSaving(true)
    setErr('')

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${tenantId}/${form.department}/${Date.now()}_${safeName}`

    const toUpload = await compressImage(file, 1200)
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, toUpload, { upsert: false })
    if (upErr) { setSaving(false); setErr('อัปโหลดไฟล์ไม่สำเร็จ: ' + upErr.message); return }

    const tags = form.tags.split(/[,\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean)

    const { error: dbErr } = await supabase.from('documents').insert({
      municipality_id: tenantId,
      title:           form.title.trim(),
      doc_number:      form.doc_number.trim(),
      doc_date:        form.doc_date,
      department:      form.department,
      tags,
      description:     form.description.trim() || null,
      file_path:       path,
      file_name:       file.name,
      file_type:       isPdf ? 'pdf' : 'image',
      file_size:       file.size,
      uploaded_by:     uploaderId,
    })

    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([path])
      setSaving(false)
      setErr('บันทึกข้อมูลไม่สำเร็จ: ' + dbErr.message)
      return
    }

    setSaving(false)
    onSuccess()
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-4 pb-4 md:p-6">
      <div className="w-full max-w-lg bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="font-bold text-gray-800">อัปโหลดเอกสาร</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">ชื่อเอกสาร *</label>
            <input value={form.title} onChange={set('title')} placeholder="เช่น รายงานการประชุมสภา ครั้งที่ 3/2569" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">เลขที่หนังสือ *</label>
              <input value={form.doc_number} onChange={set('doc_number')} placeholder="นล 0023.1/123" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">วันที่อนุมัติ *</label>
              <input type="date" value={form.doc_date} onChange={set('doc_date')} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">กอง / หน่วยงาน *</label>
            <select value={form.department} onChange={set('department')} className={inputCls}>
              {uploadDepts.map(d => (
                <option key={d.key} value={d.key}>{d.emoji} {d.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">
              แท็กค้นหา <span className="font-normal text-gray-400">(คั่นด้วยเว้นวรรคหรือจุลภาค)</span>
            </label>
            <input value={form.tags} onChange={set('tags')} placeholder="ประชุม คำสั่ง งบประมาณ" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">รายละเอียดเพิ่มเติม</label>
            <textarea value={form.description} onChange={set('description')} rows={2}
              placeholder="สรุปสั้นๆ เพื่อให้ค้นหาได้ง่ายขึ้น"
              className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">ไฟล์เอกสาร * <span className="font-normal text-gray-400">(PDF หรือรูปภาพ)</span></label>
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-2xl py-6 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
              <Upload size={22} className="text-gray-400" />
              <span className="text-sm text-gray-500">
                {form.file ? form.file.name : 'แตะเพื่อเลือกไฟล์'}
              </span>
              {form.file && <span className="text-xs text-gray-400">{formatBytes(form.file.size)}</span>}
              <input type="file" accept=".pdf,image/*" className="hidden"
                onChange={e => setForm(p => ({ ...p, file: e.target.files?.[0] ?? null }))} />
            </label>
          </div>
          {err && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 rounded-xl text-red-600 text-sm">
              <AlertCircle size={15} className="shrink-0" />{err}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          <button onClick={handleSubmit} disabled={saving}
            className="w-full py-3 rounded-2xl text-sm font-bold text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? <span className="flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" />กำลังอัปโหลด...</span> : 'อัปโหลดเอกสาร'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AuditDrawer ──────────────────────────────────────────────────────────────

function AuditDrawer({ tenantId, onClose }) {
  const [logs, setLogs]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchLogs() {
      const { data } = await supabase
        .from('document_access_logs')
        .select('*, document:documents(title, doc_number), user:profiles!document_access_logs_user_id_fkey(full_name)')
        .eq('municipality_id', tenantId)
        .order('accessed_at', { ascending: false })
        .limit(200)
      setLogs(data ?? [])
      setLoading(false)
    }
    fetchLogs()
  }, [tenantId])

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-4 pb-4 md:p-6">
      <div className="w-full max-w-lg bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <History size={18} className="text-purple-500" />
            <h3 className="font-bold text-gray-800">ประวัติการเข้าถึง</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10 text-gray-300"><Loader2 size={22} className="animate-spin" /></div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">ยังไม่มีประวัติ</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {logs.map(log => (
                <div key={log.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-700 truncate">
                        {log.document?.title ?? '(ลบแล้ว)'}
                      </p>
                      <p className="text-xs text-gray-400">{log.user?.full_name ?? '-'}</p>
                    </div>
                    <p className="text-[11px] text-gray-400 shrink-0">
                      {new Date(log.accessed_at).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DocumentArchive({ tenant, profile }) {
  const role      = profile?.role ?? 'staff'
  const canUpload = ['admin', 'superadmin', 'staff'].includes(role)
  const canDelete = ['admin', 'superadmin'].includes(role)
  const canAudit  = ['admin', 'superadmin', 'viewer'].includes(role)
  const allowed   = visibleDepts(role)

  const [docs, setDocs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [activeDept, setActiveDept] = useState('all')
  const [search, setSearch]       = useState('')
  const [viewerItem, setViewerItem] = useState(null)
  const [viewerLoading, setViewerLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showAudit, setShowAudit]  = useState(false)
  const [deleting, setDeleting]   = useState(null)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('documents')
      .select('*, uploader:profiles!documents_uploaded_by_fkey(full_name)')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
    setDocs(data ?? [])
    setLoading(false)
  }, [tenant.id])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // filter
  const filtered = docs.filter(d => {
    if (!allowed.includes(d.department)) return false
    if (activeDept !== 'all' && d.department !== activeDept) return false
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    if (q.startsWith('#')) {
      const tag = q.slice(1)
      return d.tags?.some(t => t.toLowerCase().includes(tag))
    }
    return (
      d.title.toLowerCase().includes(q) ||
      (d.doc_number ?? '').toLowerCase().includes(q) ||
      (d.description ?? '').toLowerCase().includes(q) ||
      d.tags?.some(t => t.toLowerCase().includes(q))
    )
  })

  async function openDoc(doc) {
    setViewerLoading(true)
    await supabase.from('document_access_logs').insert({
      document_id:     doc.id,
      user_id:         profile.id,
      municipality_id: tenant.id,
    })
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 1800)
    setViewerItem({ doc, signedUrl: data?.signedUrl ?? '' })
    setViewerLoading(false)
  }

  async function handleDelete(id) {
    if (!window.confirm('ลบเอกสารนี้? ไม่สามารถกู้คืนได้')) return
    setDeleting(id)
    const doc = docs.find(d => d.id === id)
    await logAction({
      action: 'delete', resourceType: 'document',
      resourceId: id,
      resourceLabel: doc?.title,
      municipalityId: tenant.id,
      metadata: { department: doc?.department, file_type: doc?.file_type, file_path: doc?.file_path },
    })
    await supabase.storage.from(BUCKET).remove([doc.file_path])
    await supabase.from('documents').delete().eq('id', id)
    setDocs(p => p.filter(d => d.id !== id))
    setDeleting(null)
  }

  const tabs = DEPARTMENTS.filter(d => allowed.includes(d.key))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-700">คลังเอกสารดิจิทัล</h2>
        <div className="flex gap-2">
          {canAudit && (
            <button onClick={() => setShowAudit(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-50 text-purple-600 text-xs font-semibold hover:bg-purple-100 transition-colors">
              <History size={14} /> บันทึกการเข้าถึง
            </button>
          )}
          {canUpload && (
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              <Upload size={15} /> อัปโหลด
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ, เลขที่, หรือ #แท็ก..."
          className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-200 shadow-sm" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={15} />
          </button>
        )}
      </div>

      {/* Department tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {tabs.map(d => {
          const count = docs.filter(doc => allowed.includes(doc.department) && (d.key === 'all' || doc.department === d.key)).length
          const active = activeDept === d.key
          return (
            <button key={d.key} onClick={() => setActiveDept(d.key)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border"
              style={active
                ? { backgroundColor: 'var(--color-primary)', color: '#fff', borderColor: 'transparent' }
                : { backgroundColor: '#f9fafb', color: '#64748b', borderColor: '#e5e7eb' }}>
              <span>{d.emoji}</span>
              <span>{d.label}</span>
              <span className={`text-[10px] ${active ? 'opacity-70' : 'text-gray-400'}`}>({count})</span>
              {d.restricted && <Lock size={10} className={active ? 'opacity-70' : 'text-amber-500'} />}
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12 text-gray-300"><Loader2 size={24} className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 text-sm">
          {search ? `ไม่พบเอกสารที่ตรงกับ "${search}"` : 'ยังไม่มีเอกสารในหมวดนี้'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(doc => (
            <DocCard key={doc.id} doc={doc} onOpen={openDoc} onDelete={handleDelete}
              deleting={deleting} role={role} />
          ))}
        </div>
      )}

      {/* Viewer loading overlay */}
      {viewerLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-3 text-white">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">กำลังเปิดเอกสาร...</p>
          </div>
        </div>
      )}

      {/* Viewer */}
      {viewerItem && <ViewerModal item={viewerItem} onClose={() => setViewerItem(null)} />}

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          tenantId={tenant.id}
          uploaderId={profile.id}
          allowedDepts={allowed.filter(k => k !== 'all')}
          onClose={() => setShowUpload(false)}
          onSuccess={() => { setShowUpload(false); fetchDocs() }}
        />
      )}

      {/* Audit drawer */}
      {showAudit && <AuditDrawer tenantId={tenant.id} onClose={() => setShowAudit(false)} />}
    </div>
  )
}
