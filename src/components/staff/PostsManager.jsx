import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { useAuth } from '../../contexts/AuthContext'
import { compressImage } from '../../lib/imageUtils'
import {
  Plus, Trash2, Loader2, Newspaper, Camera, X, Upload,
  Eye, EyeOff, CalendarDays, Pencil, Check, Move,
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
  const [tab, setTab] = useState('news')
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [delConfirm, setDelConfirm] = useState(null)
  const [error, setError] = useState(null)

  const imgRef = useRef(null)
  const dragging = useRef(false)

  const fetchPosts = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('posts')
      .select('id,title,excerpt,image_url,image_position,event_date,is_published,created_at')
      .eq('municipality_id', tenant.id)
      .eq('type', tab)
      .order('created_at', { ascending: false })
    setPosts(data ?? [])
    setLoading(false)
  }, [tenant?.id, tab])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setError(null)
    setShowForm(true)
  }

  function openEdit(p) {
    setEditing(p.id)
    setForm({
      title: p.title ?? '',
      excerpt: p.excerpt ?? '',
      image_url: p.image_url ?? '',
      image_position: p.image_position ?? '50% 50%',
      event_date: p.event_date ?? '',
      is_published: p.is_published ?? true,
    })
    setError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false); setEditing(null); setForm(EMPTY_FORM); setError(null)
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const compressed = await compressImage(file, 1200)
    const ext = file.name.split('.').pop()
    const path = `posts/${tenant.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('complaint-attachments').upload(path, compressed, { upsert: false })
    if (!upErr) {
      const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
      setForm(f => ({ ...f, image_url: data.publicUrl, image_position: '50% 50%' }))
    }
    setUploading(false)
    e.target.value = ''
  }

  // ── Focal point drag ──────────────────────────────────────────────────────
  function calcPos(e) {
    const rect = imgRef.current.getBoundingClientRect()
    const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)))
    const y = Math.round(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)))
    setForm(f => ({ ...f, image_position: `${x}% ${y}%` }))
  }

  function onPointerDown(e) {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    calcPos(e)
  }
  function onPointerMove(e) { if (dragging.current) calcPos(e) }
  function onPointerUp()    { dragging.current = false }

  async function handleSave() {
    if (!form.title.trim()) { setError('กรุณาใส่หัวข้อ'); return }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        municipality_id: tenant.id,
        type: tab,
        title: form.title.trim(),
        excerpt: form.excerpt.trim() || null,
        image_url: form.image_url || null,
        image_position: form.image_position,
        event_date: form.event_date || null,
        is_published: form.is_published,
        created_by: session?.user?.id ?? null,
      }
      let err
      if (editing) {
        ;({ error: err } = await supabase.from('posts').update(payload).eq('id', editing))
      } else {
        ;({ error: err } = await supabase.from('posts').insert(payload))
      }
      if (err) { setError(err.message); return }
      closeForm()
      fetchPosts()
    } catch (e) {
      setError(e?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await supabase.from('posts').delete().eq('id', id)
    setPosts(prev => prev.filter(p => p.id !== id))
    setDelConfirm(null)
  }

  async function togglePublish(p) {
    await supabase.from('posts').update({ is_published: !p.is_published }).eq('id', p.id)
    setPosts(prev => prev.map(x => x.id === p.id ? { ...x, is_published: !x.is_published } : x))
  }

  const fmtDate = (s) => s
    ? new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
    : ''
  const isNews = tab === 'news'

  // parse "x% y%" → { x, y } for focal dot position
  function parseFocal(pos = '50% 50%') {
    const [x = '50%', y = '50%'] = pos.split(' ')
    return { x, y }
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2">
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

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-200 flex items-end sm:items-center justify-center bg-black/40" onClick={closeForm}>
          <div className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-gray-800">{editing ? 'แก้ไข' : 'เพิ่ม'}{isNews ? 'ข่าว' : 'กิจกรรม'}</h3>
              <button onClick={closeForm} className="p-2 rounded-xl hover:bg-gray-100"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Image + Focal drag */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-gray-500">รูปภาพ</p>
                {form.image_url ? (
                  <>
                    {/* Drag area */}
                    <div
                      ref={imgRef}
                      className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 cursor-crosshair select-none touch-none"
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                    >
                      <img src={form.image_url} alt=""
                        className="w-full h-full object-cover pointer-events-none"
                        style={{ objectPosition: form.image_position }} />

                      {/* Focal point dot */}
                      {(() => {
                        const { x, y } = parseFocal(form.image_position)
                        return (
                          <div className="absolute pointer-events-none"
                            style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}>
                            <div className="w-7 h-7 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.4)] bg-white/20" />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-px h-full bg-white/90 absolute" />
                              <div className="h-px w-full bg-white/90 absolute" />
                            </div>
                          </div>
                        )
                      })()}

                      {/* Hint overlay */}
                      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                        <span className="flex items-center gap-1 text-[10px] text-white bg-black/50 rounded-lg px-2 py-0.5">
                          <Move size={10} /> ลากเพื่อตั้งจุดโฟกัส
                        </span>
                      </div>

                      {/* Remove button */}
                      <button
                        className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white hover:bg-black/70 pointer-events-auto"
                        onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, image_url: '', image_position: '50% 50%' })) }}>
                        <X size={12} />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400">ตำแหน่ง: {form.image_position}</p>
                  </>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 cursor-pointer hover:border-blue-300 hover:text-blue-400 transition-colors">
                    {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                    <span className="text-xs">{uploading ? 'กำลังอัปโหลด...' : 'อัปโหลดรูปภาพ'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                  </label>
                )}
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500">หัวข้อ <span className="text-red-500">*</span></label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder={isNews ? 'ชื่อข่าว...' : 'ชื่อกิจกรรม...'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>

              {/* Excerpt (news only) */}
              {isNews && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-500">เนื้อหาย่อ</label>
                  <textarea value={form.excerpt} onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))}
                    rows={3} placeholder="สรุปเนื้อหาข่าวสั้นๆ..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-200" />
                </div>
              )}

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500">วันที่{isNews ? 'ข่าว' : 'กิจกรรม'}</label>
                <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
              </div>

              {/* Published toggle */}
              <label className="flex items-center gap-3 cursor-pointer"
                onClick={() => setForm(f => ({ ...f, is_published: !f.is_published }))}>
                <div className={`w-10 h-5 rounded-full transition-colors relative ${form.is_published ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_published ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-sm font-medium text-gray-700">{form.is_published ? 'เผยแพร่แล้ว' : 'ฉบับร่าง (ซ่อนอยู่)'}</span>
              </label>

              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex gap-2">
              <button onClick={handleSave} disabled={saving || uploading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {saving ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</> : <><Check size={14} /> บันทึก</>}
              </button>
              <button onClick={closeForm} className="px-5 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
          {isNews ? <Newspaper size={36} strokeWidth={1.5} /> : <Camera size={36} strokeWidth={1.5} />}
          <p className="text-sm">ยังไม่มี{isNews ? 'ข่าว' : 'กิจกรรม'} กด "เพิ่ม" เพื่อเริ่มต้น</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map(p => (
            <div key={p.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${!p.is_published ? 'opacity-60' : 'border-gray-100'}`}>
              {p.image_url ? (
                <div className="aspect-video overflow-hidden bg-gray-100">
                  <img src={p.image_url} alt={p.title} className="w-full h-full object-cover"
                    style={{ objectPosition: p.image_position ?? '50% 50%' }} />
                </div>
              ) : (
                <div className="aspect-video bg-gray-100 flex items-center justify-center text-gray-300">
                  {isNews ? <Newspaper size={28} /> : <Camera size={28} />}
                </div>
              )}
              <div className="p-3 space-y-2">
                <p className="text-sm font-semibold text-gray-800 line-clamp-2 leading-snug">{p.title}</p>
                {p.event_date && (
                  <p className="text-[11px] text-gray-400 flex items-center gap-1">
                    <CalendarDays size={10} /> {fmtDate(p.event_date)}
                  </p>
                )}
                <div className="flex items-center gap-1.5 pt-1">
                  <button onClick={() => togglePublish(p)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      p.is_published ? 'bg-green-50 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}>
                    {p.is_published ? <><Eye size={11} /> เผยแพร่</> : <><EyeOff size={11} /> ฉบับร่าง</>}
                  </button>
                  <button onClick={() => openEdit(p)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-blue-50 text-blue-600 hover:bg-blue-100">
                    <Pencil size={11} /> แก้ไข
                  </button>
                  {delConfirm === p.id ? (
                    <>
                      <button onClick={() => handleDelete(p.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-red-500 text-white hover:bg-red-600">
                        ยืนยัน
                      </button>
                      <button onClick={() => setDelConfirm(null)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-gray-100 text-gray-500">
                        ยกเลิก
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setDelConfirm(p.id)} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {delConfirm && (
        <div className="fixed inset-0 z-200 bg-black/30" onClick={() => setDelConfirm(null)} />
      )}
    </div>
  )
}
