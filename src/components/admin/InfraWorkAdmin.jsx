import { useEffect, useState, useCallback } from 'react'
import {
  MapPin, Plus, ChevronDown, Image, X, Loader2, RefreshCw, Trash2, Pencil, CheckCircle2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import MapPicker from '../MapPicker'

const TODAY = new Date().toISOString().slice(0, 10)

const INFRA_CATEGORIES = [
  { value: 'road',       label: '🛣️  ถนน/ทางหลวง' },
  { value: 'drain',      label: '🕳️  ระบบระบายน้ำ' },
  { value: 'bridge',     label: '🌉  สะพาน/คลอง' },
  { value: 'light',      label: '💡  ไฟฟ้า' },
  { value: 'waterway',   label: '🏞️  ลำเหมือง' },
  { value: 'building',   label: '🏗️  อาคาร' },
  { value: 'irrigation', label: '💧  ชลประทาน' },
  { value: 'other',      label: '📝  อื่นๆ' },
]

const EMPTY_FORM = { title: '', category: 'road', budget: '', location_name: '', work_date: TODAY, description: '' }

export default function InfraWorkAdmin({ tenant, currentUserRole }) {
  const [infraTab, setInfraTab]         = useState('new_project')
  const [showInfraMap, setShowInfraMap] = useState(false)
  const [infraWorks, setInfraWorks]     = useState([])
  const [loading, setLoading]           = useState(false)
  const [filterTab, setFilterTab]       = useState('all')

  // ─── Create form state ───────────────────────────────────────────────────
  const [showNewForm, setShowNewForm]     = useState(false)
  const [newForm, setNewForm]             = useState({ ...EMPTY_FORM })
  const [newGeo, setNewGeo]               = useState({ lat: null, lng: null })
  const [newPhotos, setNewPhotos]         = useState([])
  const [newSubmitting, setNewSubmitting] = useState(false)
  const [newError, setNewError]           = useState(null)

  const [showRepairForm, setShowRepairForm]     = useState(false)
  const [repairForm, setRepairForm]             = useState({ ...EMPTY_FORM })
  const [repairGeo, setRepairGeo]               = useState({ lat: null, lng: null })
  const [repairPhotos, setRepairPhotos]         = useState([])
  const [repairSubmitting, setRepairSubmitting] = useState(false)
  const [repairError, setRepairError]           = useState(null)

  // ─── Edit (เพิ่มรายละเอียด) ─────────────────────────────────────────────
  const [editWork, setEditWork]         = useState(null)  // record being edited
  const [editForm, setEditForm]         = useState({})
  const [editPhotos, setEditPhotos]     = useState([])    // new photos to add
  const [editSubmitting, setEditSubmit] = useState(false)
  const [editError, setEditError]       = useState(null)

  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const isReadOnly = currentUserRole === 'viewer' || currentUserRole === 'council'
  const canDelete  = currentUserRole === 'admin' || currentUserRole === 'superadmin'

  const fetchWorks = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('infrastructure_works')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('work_date', { ascending: false })
      .limit(200)
    setInfraWorks(data ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { fetchWorks() }, [fetchWorks])

  async function uploadPhotos(photos, id) {
    const urls = []
    for (const item of photos) {
      const ext = item.file.name.split('.').pop()
      const path = `infra/${id}/${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('complaint-attachments').upload(path, item.file)
      if (!error) {
        const { data } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    }
    return urls
  }

  function addPhotos(setFn) {
    return (e) => {
      const files = Array.from(e.target.files ?? [])
      const items = files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))
      setFn((prev) => [...prev, ...items].slice(0, 5))
      e.target.value = ''
    }
  }

  async function submitWork(workType, form, geo, photos, setSubmitting, setError, resetForm, resetGeo, resetPhotos, closeForm) {
    if (!form.title.trim()) { setError('กรุณาระบุชื่องาน / โครงการ'); return }
    if (!geo.lat)           { setError('กรุณาเลือกพิกัดตำแหน่งบนแผนที่ก่อนบันทึก'); return }
    setError(null)
    setSubmitting(true)
    const { data: { session } } = await supabase.auth.getSession()
    const id = crypto.randomUUID()
    const photoUrls = await uploadPhotos(photos, id)
    const { error: dbErr } = await supabase.from('infrastructure_works').insert({
      id,
      municipality_id: tenant.id,
      created_by:      session.user.id,
      work_type:       workType,
      title:           form.title.trim(),
      category:        form.category,
      description:     form.description?.trim() || null,
      budget:          form.budget ? parseFloat(form.budget) : null,
      location_name:   form.location_name?.trim() || null,
      work_date:       form.work_date,
      latitude:        geo.lat,
      longitude:       geo.lng,
      photos:          photoUrls,
      status:          'completed',
    })
    setSubmitting(false)
    if (dbErr) { setError(`บันทึกไม่สำเร็จ: ${dbErr.message}`); return }
    resetForm()
    resetGeo({ lat: null, lng: null })
    resetPhotos([])
    closeForm(false)
    fetchWorks()
  }

  // ─── Edit existing record (ธุรการเพิ่มรายละเอียด) ────────────────────────
  function openEdit(w) {
    setEditWork(w)
    setEditForm({
      title:         w.title,
      budget:        w.budget ?? '',
      location_name: w.location_name ?? '',
      work_date:     w.work_date,
      description:   w.description ?? '',
    })
    setEditPhotos([])
    setEditError(null)
  }

  async function saveEdit(e) {
    e.preventDefault()
    if (!editForm.title.trim()) { setEditError('กรุณาระบุชื่องาน'); return }
    setEditError(null)
    setEditSubmit(true)
    const newUrls = await uploadPhotos(editPhotos, editWork.id)
    const mergedPhotos = [...(editWork.photos ?? []), ...newUrls]
    const { error: dbErr } = await supabase
      .from('infrastructure_works')
      .update({
        title:         editForm.title.trim(),
        budget:        editForm.budget ? parseFloat(editForm.budget) : null,
        location_name: editForm.location_name?.trim() || null,
        work_date:     editForm.work_date,
        description:   editForm.description?.trim() || null,
        photos:        mergedPhotos,
      })
      .eq('id', editWork.id)
    setEditSubmit(false)
    if (dbErr) { setEditError(`บันทึกไม่สำเร็จ: ${dbErr.message}`); return }
    setEditWork(null)
    fetchWorks()
  }

  async function deleteWork(id) {
    await supabase.from('infrastructure_works').delete().eq('id', id)
    setDeleteConfirm(null)
    fetchWorks()
  }

  const displayed = filterTab === 'all' ? infraWorks : infraWorks.filter(w => w.work_type === filterTab)
  const needsDetail = (w) => !w.budget && !w.description

  return (
    <div className="space-y-5">

      {/* MapPicker overlay */}
      {showInfraMap && (
        <MapPicker
          initialPos={
            infraTab === 'new_project'
              ? (newGeo.lat ? { lat: newGeo.lat, lng: newGeo.lng } : null)
              : (repairGeo.lat ? { lat: repairGeo.lat, lng: repairGeo.lng } : null)
          }
          onConfirm={({ lat, lng, address }) => {
            if (infraTab === 'new_project') {
              setNewGeo({ lat, lng })
              if (address && !newForm.location_name) setNewForm(p => ({ ...p, location_name: address }))
            } else {
              setRepairGeo({ lat, lng })
              if (address && !repairForm.location_name) setRepairForm(p => ({ ...p, location_name: address }))
            }
            setShowInfraMap(false)
          }}
          onClose={() => setShowInfraMap(false)}
        />
      )}

      {/* Edit modal */}
      {editWork && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <div>
                <p className="font-bold text-gray-800">เพิ่มรายละเอียดงาน</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[240px]">{editWork.title}</p>
              </div>
              <button onClick={() => setEditWork(null)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={saveEdit} className="p-5 space-y-3">
              <input type="text" value={editForm.title}
                onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} required
                placeholder="ชื่องาน / โครงการ"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />

              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={editForm.budget}
                  onChange={e => setEditForm(p => ({ ...p, budget: e.target.value }))}
                  placeholder="งบประมาณ (บาท)"
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                <input type="date" value={editForm.work_date}
                  onChange={e => setEditForm(p => ({ ...p, work_date: e.target.value }))}
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>

              <input type="text" value={editForm.location_name}
                onChange={e => setEditForm(p => ({ ...p, location_name: e.target.value }))}
                placeholder="ชื่อสถานที่ / หมู่บ้าน"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />

              <textarea value={editForm.description}
                onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} rows={3}
                placeholder="รายละเอียดงาน เช่น spec วัสดุ งบแยกหมวด หมายเหตุสัญญา"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300" />

              {/* รูปเดิม */}
              {(editWork.photos ?? []).length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">รูปที่มีอยู่แล้ว</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {editWork.photos.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-200 rounded-xl px-4 py-2.5 hover:bg-gray-50 transition-colors">
                <Image size={14} className="text-gray-400" />
                <span className="text-xs text-gray-500">เพิ่มรูปภาพ (ไม่เกิน 5 รูป)</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos(setEditPhotos)} />
              </label>
              {editPhotos.length > 0 && (
                <div className="grid grid-cols-5 gap-1.5">
                  {editPhotos.map((p, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                      <img src={p.preview} alt="" className="w-full h-full object-cover" />
                      <button type="button"
                        onClick={() => setEditPhotos(prev => prev.filter((_, j) => j !== i))}
                        className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                        <X size={9} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {editError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{editError}</p>}

              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={editSubmitting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#7c3aed' }}>
                  {editSubmitting
                    ? <><Loader2 size={13} className="animate-spin" /> กำลังบันทึก...</>
                    : <><CheckCircle2 size={14} /> บันทึกรายละเอียด</>}
                </button>
                <button type="button" onClick={() => setEditWork(null)}
                  className="px-4 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 shadow-xl max-w-xs w-full space-y-4">
            <p className="font-bold text-gray-800">ลบรายการนี้?</p>
            <p className="text-sm text-gray-500 truncate">{deleteConfirm.title}</p>
            <div className="flex gap-2">
              <button onClick={() => deleteWork(deleteConfirm.id)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600">
                ลบ
              </button>
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <MapPin size={16} className="text-violet-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-800">งานโยธา (GPS)</h2>
            <p className="text-xs text-gray-400">ช่างปักหมุดหน้างาน · ธุรการบันทึกรายละเอียด</p>
          </div>
        </div>
        <button onClick={fetchWorks} disabled={loading}
          className="p-2 rounded-xl border border-gray-200 bg-white text-gray-400 hover:bg-gray-50 transition-colors disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* รายการที่รอเพิ่มรายละเอียด (alert) */}
      {!isReadOnly && infraWorks.some(needsDetail) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
          <span className="font-bold">⚠️ มี {infraWorks.filter(needsDetail).length} รายการ</span> ที่ช่างปักหมุดไว้แต่ยังไม่มีรายละเอียด
          — กดปุ่ม ✏️ เพื่อเพิ่มงบประมาณ รายละเอียด และรูปภาพ
        </div>
      )}

      {/* New record form — สำหรับธุรการที่ต้องการบันทึกเองทั้งหมด */}
      {!isReadOnly && (
        <>
          <div className="flex bg-gray-100 rounded-2xl p-1">
            <button
              onClick={() => { setInfraTab('new_project'); setShowRepairForm(false) }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                infraTab === 'new_project' ? 'bg-white shadow-sm text-violet-700' : 'text-gray-500'
              }`}>
              🏗️ โครงการใหม่
            </button>
            <button
              onClick={() => { setInfraTab('repair'); setShowNewForm(false) }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                infraTab === 'repair' ? 'bg-white shadow-sm text-cyan-700' : 'text-gray-500'
              }`}>
              🔧 งานซ่อม
            </button>
          </div>

          {/* ══ TAB: โครงการใหม่ ══ */}
          {infraTab === 'new_project' && (
            <>
              <button
                onClick={() => setShowNewForm(v => !v)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                style={{ backgroundColor: '#7c3aed' }}>
                {showNewForm ? <ChevronDown size={14} /> : <Plus size={14} />}
                {showNewForm ? 'ซ่อนฟอร์ม' : '🏗️ บันทึกโครงการใหม่'}
              </button>

              {showNewForm && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    submitWork(
                      'new_project', newForm, newGeo, newPhotos,
                      setNewSubmitting, setNewError,
                      () => setNewForm({ ...EMPTY_FORM }),
                      setNewGeo, setNewPhotos, setShowNewForm
                    )
                  }}
                  className="bg-white rounded-2xl border border-violet-100 shadow-sm p-4 space-y-3">

                  <div className="flex flex-wrap gap-1.5">
                    {INFRA_CATEGORIES.map((cat) => (
                      <button key={cat.value} type="button"
                        onClick={() => setNewForm(p => ({ ...p, category: cat.value }))}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all"
                        style={newForm.category === cat.value
                          ? { backgroundColor: '#7c3aed', color: '#fff', borderColor: '#7c3aed' }
                          : { backgroundColor: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }}>
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  <input type="text" value={newForm.title}
                    onChange={e => setNewForm(p => ({ ...p, title: e.target.value }))} required
                    placeholder="ชื่อโครงการ เช่น ก่อสร้างถนน คสล. หมู่ที่ 5"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />

                  <div className={`rounded-xl border p-3 ${newGeo.lat ? 'bg-green-50 border-green-200' : 'bg-violet-50 border-violet-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin size={13} className={newGeo.lat ? 'text-green-600' : 'text-violet-600'} />
                      <span className="text-xs font-bold text-gray-700">พิกัด GPS ตำแหน่งโครงการ</span>
                      <span className="ml-auto text-[10px] font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">* บังคับ</span>
                    </div>
                    <button type="button" onClick={() => { setInfraTab('new_project'); setShowInfraMap(true) }}
                      className={`w-full py-2 rounded-lg text-xs font-medium border transition-all ${
                        newGeo.lat ? 'bg-white border-green-200 text-green-700' : 'bg-white border-violet-200 text-violet-700'
                      }`}>
                      {newGeo.lat
                        ? `📍 ${newGeo.lat.toFixed(5)}, ${newGeo.lng.toFixed(5)} — กดแก้ไข`
                        : '📍 กดเลือกตำแหน่งบนแผนที่'}
                    </button>
                  </div>

                  <input type="text" value={newForm.location_name}
                    onChange={e => setNewForm(p => ({ ...p, location_name: e.target.value }))}
                    placeholder="ชื่อสถานที่ / หมู่บ้าน"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />

                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={newForm.budget}
                      onChange={e => setNewForm(p => ({ ...p, budget: e.target.value }))}
                      placeholder="งบประมาณ (บาท)"
                      className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                    <input type="date" value={newForm.work_date}
                      onChange={e => setNewForm(p => ({ ...p, work_date: e.target.value }))}
                      className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-300" />
                  </div>

                  <textarea value={newForm.description}
                    onChange={e => setNewForm(p => ({ ...p, description: e.target.value }))} rows={2}
                    placeholder="รายละเอียด spec วัสดุ หมายเหตุสัญญา"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300" />

                  <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-200 rounded-xl px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <Image size={14} className="text-gray-400" />
                    <span className="text-xs text-gray-500">รูปภาพแนบ (ไม่เกิน 5 รูป)</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos(setNewPhotos)} />
                  </label>
                  {newPhotos.length > 0 && (
                    <div className="grid grid-cols-5 gap-1.5">
                      {newPhotos.map((p, i) => (
                        <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                          <img src={p.preview} alt="" className="w-full h-full object-cover" />
                          <button type="button"
                            onClick={() => setNewPhotos(prev => prev.filter((_, j) => j !== i))}
                            className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                            <X size={9} className="text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {newError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{newError}</p>}

                  <div className="flex gap-2">
                    <button type="submit" disabled={newSubmitting}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                      style={{ backgroundColor: '#7c3aed' }}>
                      {newSubmitting
                        ? <><Loader2 size={13} className="animate-spin" /> กำลังบันทึก...</>
                        : '🏗️ บันทึกโครงการ'}
                    </button>
                    <button type="button" onClick={() => setShowNewForm(false)}
                      className="px-4 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">
                      ยกเลิก
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* ══ TAB: งานซ่อม ══ */}
          {infraTab === 'repair' && (
            <>
              <button
                onClick={() => setShowRepairForm(v => !v)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                style={{ backgroundColor: '#0891b2' }}>
                {showRepairForm ? <ChevronDown size={14} /> : <Plus size={14} />}
                {showRepairForm ? 'ซ่อนฟอร์ม' : '🔧 บันทึกงานซ่อม'}
              </button>

              {showRepairForm && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    submitWork(
                      'repair', repairForm, repairGeo, repairPhotos,
                      setRepairSubmitting, setRepairError,
                      () => setRepairForm({ ...EMPTY_FORM }),
                      setRepairGeo, setRepairPhotos, setShowRepairForm
                    )
                  }}
                  className="bg-white rounded-2xl border border-cyan-100 shadow-sm p-4 space-y-3">

                  <div className="flex flex-wrap gap-1.5">
                    {INFRA_CATEGORIES.map((cat) => (
                      <button key={cat.value} type="button"
                        onClick={() => setRepairForm(p => ({ ...p, category: cat.value }))}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all"
                        style={repairForm.category === cat.value
                          ? { backgroundColor: '#0891b2', color: '#fff', borderColor: '#0891b2' }
                          : { backgroundColor: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }}>
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  <input type="text" value={repairForm.title}
                    onChange={e => setRepairForm(p => ({ ...p, title: e.target.value }))} required
                    placeholder="ชื่องานซ่อม เช่น ซ่อมไฟกิ่งดับ หน้าโรงเรียน"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-300" />

                  <div className={`rounded-xl border p-3 ${repairGeo.lat ? 'bg-green-50 border-green-200' : 'bg-cyan-50 border-cyan-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin size={13} className={repairGeo.lat ? 'text-green-600' : 'text-cyan-600'} />
                      <span className="text-xs font-bold text-gray-700">พิกัด GPS จุดที่ซ่อม</span>
                      <span className="ml-auto text-[10px] font-bold text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full">* บังคับ</span>
                    </div>
                    <button type="button" onClick={() => { setInfraTab('repair'); setShowInfraMap(true) }}
                      className={`w-full py-2 rounded-lg text-xs font-medium border transition-all ${
                        repairGeo.lat ? 'bg-white border-green-200 text-green-700' : 'bg-white border-cyan-200 text-cyan-700'
                      }`}>
                      {repairGeo.lat
                        ? `📍 ${repairGeo.lat.toFixed(5)}, ${repairGeo.lng.toFixed(5)} — กดแก้ไข`
                        : '📍 กดเลือกตำแหน่งบนแผนที่'}
                    </button>
                  </div>

                  <input type="text" value={repairForm.location_name}
                    onChange={e => setRepairForm(p => ({ ...p, location_name: e.target.value }))}
                    placeholder="ชื่อสถานที่ / หมู่บ้าน"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-300" />

                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={repairForm.budget}
                      onChange={e => setRepairForm(p => ({ ...p, budget: e.target.value }))}
                      placeholder="ค่าซ่อม (บาท)"
                      className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-300" />
                    <input type="date" value={repairForm.work_date}
                      onChange={e => setRepairForm(p => ({ ...p, work_date: e.target.value }))}
                      className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-300" />
                  </div>

                  <textarea value={repairForm.description}
                    onChange={e => setRepairForm(p => ({ ...p, description: e.target.value }))} rows={2}
                    placeholder="รายละเอียดการซ่อม เช่น เปลี่ยนหลอด LED 18W 2 ดวง"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-300" />

                  <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-200 rounded-xl px-4 py-2.5 hover:bg-gray-50 transition-colors">
                    <Image size={14} className="text-gray-400" />
                    <span className="text-xs text-gray-500">รูปก่อน-หลังซ่อม (ไม่เกิน 5 รูป)</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos(setRepairPhotos)} />
                  </label>
                  {repairPhotos.length > 0 && (
                    <div className="grid grid-cols-5 gap-1.5">
                      {repairPhotos.map((p, i) => (
                        <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                          <img src={p.preview} alt="" className="w-full h-full object-cover" />
                          <button type="button"
                            onClick={() => setRepairPhotos(prev => prev.filter((_, j) => j !== i))}
                            className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                            <X size={9} className="text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {repairError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{repairError}</p>}

                  <div className="flex gap-2">
                    <button type="submit" disabled={repairSubmitting}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                      style={{ backgroundColor: '#0891b2' }}>
                      {repairSubmitting
                        ? <><Loader2 size={13} className="animate-spin" /> กำลังบันทึก...</>
                        : '🔧 บันทึกงานซ่อม'}
                    </button>
                    <button type="button" onClick={() => setShowRepairForm(false)}
                      className="px-4 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 hover:bg-gray-200">
                      ยกเลิก
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </>
      )}

      {/* ─── รายการทั้งหมด ─── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            รายการงานโยธา ({displayed.length})
          </p>
          <div className="flex gap-1">
            {['all', 'new_project', 'repair'].map((tab) => (
              <button key={tab} onClick={() => setFilterTab(tab)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                  filterTab === tab ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200'
                }`}>
                {tab === 'all' ? 'ทั้งหมด' : tab === 'new_project' ? '🏗️ ใหม่' : '🔧 ซ่อม'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={22} className="animate-spin text-gray-300" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <MapPin size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">ยังไม่มีรายการงานโยธา</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {displayed.map((w, i) => {
              const isNew  = w.work_type === 'new_project'
              const noData = needsDetail(w)
              return (
                <div key={w.id}
                  className={`flex items-center gap-3 px-4 py-3 ${i < displayed.length - 1 ? 'border-b border-gray-50' : ''} ${noData ? 'bg-amber-50/40' : ''}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${isNew ? 'bg-violet-50' : 'bg-cyan-50'}`}>
                    {isNew ? '🏗️' : '🔧'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-gray-800 truncate">{w.title}</p>
                      {noData && <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full shrink-0">รอรายละเอียด</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {w.location_name || '—'} · {new Date(w.work_date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
                      {w.budget ? ` · ${Number(w.budget).toLocaleString('th-TH')} ฿` : ''}
                    </p>
                    {w.latitude && (
                      <p className="text-[10px] text-gray-300 mt-0.5 font-mono">
                        📍 {Number(w.latitude).toFixed(5)}, {Number(w.longitude).toFixed(5)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isReadOnly && (
                      <button onClick={() => openEdit(w)}
                        className="p-1.5 rounded-lg hover:bg-violet-50 text-gray-400 hover:text-violet-600 transition-colors">
                        <Pencil size={13} />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => setDeleteConfirm(w)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
