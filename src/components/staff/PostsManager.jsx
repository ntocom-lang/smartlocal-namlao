import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { compressImage } from '../../lib/imageUtils'
import {
  Plus, Trash2, Loader2, Newspaper, Camera, X, Upload,
  Eye, EyeOff, CalendarDays, Pencil, Check, Move, AlertCircle,
  CheckCircle2,
} from 'lucide-react'

const TABS = [
  { key: 'news',     label: 'ข่าวสำคัญ',  Icon: Newspaper },
  { key: 'activity', label: 'ภาพกิจกรรม', Icon: Camera },
]

const EMPTY_FORM = {
  title: '', excerpt: '', image_url: '', image_position: '50% 50%',
  event_date: '', is_published: true,
}

export default function PostsManager() {
  const { tenant } = useTenant()
  const { session } = useAuth()

  const [tab, setTab]               = useState('news')
  const [posts, setPosts]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [fetchError, setFetchError] = useState(null)

  const [showForm, setShowForm]     = useState(false)
  const [editing, setEditing]       = useState(null)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState(null)
  const [saved, setSaved]           = useState(false)

  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const [toggleSet, setToggleSet]   = useState(new Set())
  const [delConfirm, setDelConfirm] = useState(null)
  const [deleting, setDeleting]     = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const imgRef  = useRef(null)
  const dragging = useRef(false)

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchPosts = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    setFetchError(null)
    const { data, error } = await supabase
      .from('posts')
      .select('id,title,excerpt,image_url,image_position,event_date,is_published,created_at,updated_at')
      .eq('municipality_id', tenant.id)
      .eq('type', tab)
      .order('created_at', { ascending: false })
    if (error) setFetchError(error.message)
    else setPosts(data ?? [])
    setLoading(false)
  }, [tenant?.id, tab])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  // ── Form open/close ────────────────────────────────────────────────────────
  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setSaveError(null)
    setSaved(false)
    setUploadError(null)
    setShowForm(true)
  }

  function openEdit(p) {
    setEditing(p.id)
    setForm({
      title:          p.title          ?? '',
      excerpt:        p.excerpt        ?? '',
      image_url:      p.image_url      ?? '',
      image_position: p.image_position ?? '50% 50%',
      event_date:     p.event_date     ?? '',
      is_published:   p.is_published   ?? true,
    })
    setSaveError(null)
    setSaved(false)
    setUploadError(null)
    setShowForm(true)
  }

  function closeForm() {
    if (saving || uploading) return
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setSaveError(null)
    setSaved(false)
    setUploadError(null)
  }

  // ── Image upload ───────────────────────────────────────────────────────────
  async function handleFileUpload(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP)')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('ไฟล์ใหญ่เกิน 10 MB')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const compressed = await compressImage(file, 1200)
      const ext = file.name.split('.').pop()
      const path = `posts/${tenant.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('complaint-attachments').upload(path, compressed, { upsert: false })
      if (upErr) {
        setUploadError('อัปโหลดไม่สำเร็จ: ' + upErr.message)
      } else {
        const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
        setForm(f => ({ ...f, image_url: data.publicUrl, image_position: '50% 50%' }))
      }
    } catch (e) {
      setUploadError('เกิดข้อผิดพลาด: ' + (e?.message ?? 'ลองใหม่อีกครั้ง'))
    } finally {
      setUploading(false)
    }
  }

  function onInputChange(e) {
    handleFileUpload(e.target.files?.[0])
    e.target.value = ''
  }

  function onDragOver(e) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function onDragLeave() { setIsDragOver(false) }

  function onDrop(e) {
    e.preventDefault()
    setIsDragOver(false)
    handleFileUpload(e.dataTransfer.files?.[0])
  }

  // ── Focal point drag ───────────────────────────────────────────────────────
  function calcPos(e) {
    if (!imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left)  / rect.width)  * 100)))
    const y = Math.round(Math.max(0, Math.min(100, ((e.clientY - rect.top)   / rect.height) * 100)))
    setForm(f => ({ ...f, image_position: `${x}% ${y}%` }))
  }

  function onPointerDown(e) {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    calcPos(e)
  }
  function onPointerMove(e) { if (dragging.current) calcPos(e) }
  function onPointerUp()    { dragging.current = false }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.title.trim()) { setSaveError('กรุณาใส่หัวข้อ'); return }
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const payload = {
        municipality_id: tenant.id,
        type:            tab,
        title:           form.title.trim(),
        excerpt:         form.excerpt.trim() || null,
        image_url:       form.image_url      || null,
        image_position:  form.image_position,
        event_date:      form.event_date      || null,
        is_published:    form.is_published,
        created_by:      session?.user?.id   ?? null,
      }
      const q = editing
        ? supabase.from('posts').update(payload).eq('id', editing)
        : supabase.from('posts').insert(payload)
      const { error: err } = await q.abortSignal(ctrl.signal)
      clearTimeout(timer)
      if (err) { setSaveError(err.message); return }
      setSaved(true)
      setTimeout(() => {
        closeForm()
        fetchPosts()
      }, 600)
    } catch (e) {
      clearTimeout(timer)
      setSaveError(
        e?.name === 'AbortError'
          ? 'หมดเวลา 15 วิ — ตรวจสอบ RLS migration 088 ใน Supabase'
          : (e?.message ?? 'เกิดข้อผิดพลาด')
      )
    } finally {
      setSaving(false)
    }
  }

  // ── Publish toggle ─────────────────────────────────────────────────────────
  async function togglePublish(p) {
    if (toggleSet.has(p.id)) return
    setToggleSet(prev => new Set([...prev, p.id]))
    const next = !p.is_published
    setPosts(prev => prev.map(x => x.id === p.id ? { ...x, is_published: next } : x))
    const { error } = await supabase.from('posts').update({ is_published: next }).eq('id', p.id)
    if (error) {
      // rollback
      setPosts(prev => prev.map(x => x.id === p.id ? { ...x, is_published: p.is_published } : x))
    }
    setToggleSet(prev => { const s = new Set(prev); s.delete(p.id); return s })
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(id) {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    const { error } = await supabase.from('posts').delete().eq('id', id)
    if (error) {
      setDeleteError('ลบไม่สำเร็จ: ' + error.message)
    } else {
      setPosts(prev => prev.filter(p => p.id !== id))
      setDelConfirm(null)
    }
    setDeleting(false)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fmtDate = (s) => s
    ? new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
    : ''

  const isNews = tab === 'news'

  function parseFocal(pos = '50% 50%') {
    const [x = '50%', y = '50%'] = pos.split(' ')
    return { x, y }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header row */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === key ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            style={tab === key ? { backgroundColor: 'var(--color-primary)' } : {}}>
            <Icon size={14} /> {label}
          </button>
        ))}
        <button onClick={openNew}
          className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={14} /> เพิ่ม{isNews ? 'ข่าว' : 'กิจกรรม'}
        </button>
      </div>

      {/* Fetch error */}
      {fetchError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">โหลดข้อมูลไม่สำเร็จ</p>
            <p className="text-xs text-red-500 mt-0.5">{fetchError}</p>
          </div>
          <button onClick={fetchPosts} className="ml-auto text-xs underline shrink-0">ลองใหม่</button>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-200 flex items-end sm:items-center justify-center bg-black/40"
          onClick={closeForm}>
          <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-gray-800">
                {editing ? 'แก้ไข' : 'เพิ่ม'}{isNews ? 'ข่าว' : 'กิจกรรม'}
              </h3>
              <button onClick={closeForm} disabled={saving || uploading}
                className="p-2 rounded-xl hover:bg-gray-100 disabled:opacity-40">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* ── รูปภาพ ── */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500">รูปภาพ</p>

                {form.image_url ? (
                  <>
                    {/* Drag-to-reposition */}
                    <div ref={imgRef}
                      className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 cursor-crosshair select-none touch-none"
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}>
                      <img src={form.image_url} alt=""
                        className="w-full h-full object-cover pointer-events-none"
                        style={{ objectPosition: form.image_position }} />

                      {/* Focal crosshair */}
                      {(() => {
                        const { x, y } = parseFocal(form.image_position)
                        return (
                          <div className="absolute pointer-events-none"
                            style={{ left: x, top: y, transform: 'translate(-50%,-50%)' }}>
                            <div className="w-8 h-8 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.5)] bg-white/20 relative">
                              <div className="absolute inset-x-0 top-1/2 h-px bg-white/90 -translate-y-1/2" />
                              <div className="absolute inset-y-0 left-1/2 w-px bg-white/90 -translate-x-1/2" />
                            </div>
                          </div>
                        )
                      })()}

                      {/* Hint */}
                      <div className="absolute bottom-2 left-2 pointer-events-none">
                        <span className="flex items-center gap-1 text-[10px] text-white bg-black/50 rounded-lg px-2 py-0.5">
                          <Move size={9} /> ลากเพื่อตั้งจุดโฟกัส
                        </span>
                      </div>

                      {/* Remove */}
                      <button
                        className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full text-white hover:bg-black/70 pointer-events-auto"
                        onClick={e => {
                          e.stopPropagation()
                          setForm(f => ({ ...f, image_url: '', image_position: '50% 50%' }))
                          setUploadError(null)
                        }}>
                        <X size={12} />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 tabular-nums">
                      โฟกัส: {form.image_position}
                    </p>
                  </>
                ) : (
                  <label
                    className={`flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                      isDragOver
                        ? 'border-blue-400 bg-blue-50 text-blue-500'
                        : 'border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-400'
                    }`}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}>
                    {uploading
                      ? <><Loader2 size={22} className="animate-spin" /><span className="text-xs">กำลังอัปโหลด...</span></>
                      : <><Upload size={22} /><span className="text-xs font-medium">คลิกเพื่อเลือกรูป หรือลากมาวางที่นี่</span>
                          <span className="text-[10px] opacity-60">JPG, PNG, WEBP — ไม่เกิน 10 MB</span></>
                    }
                    <input type="file" accept="image/*" className="hidden"
                      onChange={onInputChange} disabled={uploading} />
                  </label>
                )}

                {uploadError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle size={11} /> {uploadError}
                  </p>
                )}
              </div>

              {/* ── หัวข้อ ── */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500">
                  หัวข้อ <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder={isNews ? 'ชื่อข่าว...' : 'ชื่อกิจกรรม...'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                />
              </div>

              {/* ── เนื้อหาย่อ (news only) ── */}
              {isNews && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-500">เนื้อหาย่อ</label>
                  <textarea
                    value={form.excerpt}
                    onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))}
                    rows={3} placeholder="สรุปเนื้อหาข่าวสั้นๆ..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              )}

              {/* ── วันที่ ── */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500">
                  วันที่{isNews ? 'ข่าว' : 'กิจกรรม'}
                </label>
                <input type="date"
                  value={form.event_date}
                  onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              {/* ── เผยแพร่ toggle ── */}
              <div className="flex items-center gap-3 cursor-pointer"
                onClick={() => setForm(f => ({ ...f, is_published: !f.is_published }))}>
                <div className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${form.is_published ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_published ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-sm font-medium text-gray-700 select-none">
                  {form.is_published ? 'เผยแพร่ทันที' : 'บันทึกเป็นฉบับร่าง'}
                </span>
              </div>

              {/* ── Error / Success ── */}
              {saveError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{saveError}</p>
                </div>
              )}
              {saved && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                  <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                  <p className="text-xs text-green-600 font-medium">บันทึกสำเร็จ!</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex gap-2">
              <button onClick={handleSave} disabled={saving || uploading || saved}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
                style={{ backgroundColor: saved ? '#10b981' : 'var(--color-primary)' }}>
                {saving
                  ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</>
                  : saved
                  ? <><CheckCircle2 size={14} /> บันทึกสำเร็จ</>
                  : <><Check size={14} /> บันทึก</>}
              </button>
              <button onClick={closeForm} disabled={saving}
                className="px-5 py-3 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 disabled:opacity-40">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-300" />
        </div>
      ) : posts.length === 0 && !fetchError ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
          {isNews ? <Newspaper size={40} strokeWidth={1.2} /> : <Camera size={40} strokeWidth={1.2} />}
          <div className="text-center">
            <p className="text-sm font-medium">ยังไม่มี{isNews ? 'ข่าว' : 'กิจกรรม'}</p>
            <p className="text-xs mt-0.5">กด "เพิ่ม{isNews ? 'ข่าว' : 'กิจกรรม'}" เพื่อเริ่มต้นได้เลย</p>
          </div>
          <button onClick={openNew}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={14} /> เพิ่ม{isNews ? 'ข่าว' : 'กิจกรรม'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map(p => (
            <div key={p.id}
              className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-opacity ${
                !p.is_published ? 'opacity-55 border-gray-100' : 'border-gray-100'
              }`}>

              {/* Thumbnail */}
              {p.image_url ? (
                <div className="aspect-video overflow-hidden bg-gray-100 relative">
                  <img src={p.image_url} alt={p.title}
                    className="w-full h-full object-cover"
                    style={{ objectPosition: p.image_position ?? '50% 50%' }} />
                  {!p.is_published && (
                    <div className="absolute top-2 left-2 bg-gray-800/70 text-white text-[10px] font-semibold px-2 py-0.5 rounded-lg">
                      ฉบับร่าง
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-video bg-gray-100 flex items-center justify-center text-gray-300 relative">
                  {isNews ? <Newspaper size={28} /> : <Camera size={28} />}
                  {!p.is_published && (
                    <div className="absolute top-2 left-2 bg-gray-800/70 text-white text-[10px] font-semibold px-2 py-0.5 rounded-lg">
                      ฉบับร่าง
                    </div>
                  )}
                </div>
              )}

              {/* Content */}
              <div className="p-3 space-y-2">
                <p className="text-sm font-semibold text-gray-800 line-clamp-2 leading-snug">{p.title}</p>
                {p.event_date && (
                  <p className="text-[11px] text-gray-400 flex items-center gap-1">
                    <CalendarDays size={10} /> {fmtDate(p.event_date)}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1.5 pt-1">
                  {/* Toggle publish */}
                  <button onClick={() => togglePublish(p)} disabled={toggleSet.has(p.id)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      p.is_published
                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}>
                    {toggleSet.has(p.id)
                      ? <Loader2 size={10} className="animate-spin" />
                      : p.is_published ? <Eye size={11} /> : <EyeOff size={11} />
                    }
                    {p.is_published ? 'เผยแพร่' : 'ฉบับร่าง'}
                  </button>

                  {/* Edit */}
                  <button onClick={() => openEdit(p)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-blue-50 text-blue-600 hover:bg-blue-100">
                    <Pencil size={11} /> แก้ไข
                  </button>

                  {/* Delete */}
                  {delConfirm === p.id ? (
                    <div className="flex items-center gap-1 relative z-10">
                      <button onClick={() => handleDelete(p.id)} disabled={deleting}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">
                        {deleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                        ยืนยันลบ
                      </button>
                      <button onClick={() => { setDelConfirm(null); setDeleteError(null) }} disabled={deleting}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-500 hover:bg-gray-200">
                        ยกเลิก
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setDelConfirm(p.id); setDeleteError(null) }}
                      className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete error toast */}
      {deleteError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-200 bg-red-600 text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
          <AlertCircle size={13} /> {deleteError}
          <button onClick={() => setDeleteError(null)} className="ml-2 opacity-70 hover:opacity-100"><X size={12} /></button>
        </div>
      )}
    </div>
  )
}
