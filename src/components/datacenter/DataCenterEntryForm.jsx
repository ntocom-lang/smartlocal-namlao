import { useState, useEffect } from 'react'
import { MapPin, Loader2, X, Image as ImageIcon, Trash2, Route } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageUtils'

const ROUTE_COLORS = [
  { hex: '#3b82f6', label: 'น้ำเงิน' }, { hex: '#22c55e', label: 'เขียว' },
  { hex: '#ef4444', label: 'แดง' }, { hex: '#f97316', label: 'ส้ม' },
  { hex: '#a855f7', label: 'ม่วง' }, { hex: '#eab308', label: 'เหลือง' },
]

// ตัวอย่างกลุ่ม/ประเภทเริ่มต้น — ไม่ตายตัว พิมพ์ชื่อใหม่ในฟอร์มก็สร้างหมวดใหม่ได้ทันที
const SEED_GROUPS = {
  'สาธารณสุข': ['โรงพยาบาลรัฐ', 'โรงพยาบาลเอกชน', 'คลินิกรัฐ', 'คลินิกเอกชน', 'โรงพยาบาลสัตว์', 'ศูนย์บริการสาธารณสุข'],
  'สถานที่สำคัญ': ['สถานีรถไฟฟ้า', 'สถานีบริการน้ำมัน', 'สถานีชาร์จรถไฟฟ้า', 'สถานีดับเพลิง', 'หน่วยงานราชการ', 'สถานที่ทางศาสนา'],
  'สถานประกอบการ': ['คอนโด', 'ร้านอาหาร', 'ตลาดเอกชน', 'ร้านค้าทั่วไป', 'ร้านสะดวกซื้อ'],
  'การจัดการขยะ': ['จุดทิ้งขยะอันตราย', 'จุดทิ้งขยะติดเชื้อ', 'จุดทิ้งขยะชิ้นใหญ่', 'จุดทิ้งขยะกำพร้า', 'ธนาคารขยะ'],
  'สถานศึกษา': ['โรงเรียน', 'แหล่งเรียนรู้ภูมิปัญญาท้องถิ่น', 'แหล่งเรียนรู้พอเพียง'],
  'โครงสร้างพื้นฐาน': ['คลอง', 'สถานีสูบน้ำ', 'บ่อสูบน้ำ', 'เสาไฟส่องสว่าง', 'ป้ายบอกชื่อซอย', 'จุดประปาหัวแดง', 'ฝาท่อระบายน้ำ'],
  'สถานที่หลบภัย': [],
}

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function DataCenterEntryForm({ tenant, profile, initialGroup, editingEntry, onSaved, onCancel }) {
  const isEditing = !!editingEntry
  const canDelete = isEditing && (profile?.role === 'admin' || profile?.role === 'superadmin')

  const [existing, setExisting] = useState([]) // {group_name, category} ที่เคยมีจริงในเทศบาลนี้
  const [form, setForm] = useState(() => editingEntry
    ? {
        group_name: editingEntry.group_name ?? '', category: editingEntry.category ?? '', name: editingEntry.name ?? '',
        description: editingEntry.description ?? '', latitude: editingEntry.latitude ?? '', longitude: editingEntry.longitude ?? '', address: '',
      }
    : { group_name: initialGroup ?? '', category: '', name: '', description: '', latitude: '', longitude: '', address: '' })
  const [existingPhotoUrls, setExistingPhotoUrls] = useState(editingEntry?.photo_urls ?? [])
  const [images, setImages] = useState([]) // รูปใหม่ที่เพิ่งเลือกในเซสชันนี้ ยังไม่อัปโหลด
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [PickerComp, setPickerComp] = useState(null)

  // โหมด "เส้นทาง" (เช่น ถนนสายหลัก) — วาดเป็นเส้นแทนปักหมุดจุดเดียว
  const [isRoute, setIsRoute] = useState(() => (editingEntry?.route_points?.length ?? 0) >= 2)
  const [routePoints, setRoutePoints] = useState(editingEntry?.route_points ?? [])
  const [routeColor, setRouteColor] = useState(editingEntry?.route_color ?? '#3b82f6')
  const [PolylinePickerComp, setPolylinePickerComp] = useState(null)

  useEffect(() => {
    if (isRoute && !PolylinePickerComp) {
      import('../InlinePolylinePicker').then(mod => setPolylinePickerComp(() => mod.default))
    }
  }, [isRoute, PolylinePickerComp])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('data_center_entries').select('group_name, category').eq('municipality_id', tenant.id)
      .then(({ data }) => setExisting(data ?? []))
  }, [tenant?.id])

  function openPicker() {
    if (!PickerComp) {
      import('../MapPicker').then(mod => { setPickerComp(() => mod.default); setShowPicker(true) })
    } else {
      setShowPicker(true)
    }
  }

  function handlePickerConfirm({ lat, lng, address }) {
    setForm(f => ({ ...f, latitude: lat, longitude: lng, address: address || f.address }))
    setShowPicker(false)
  }

  async function handleImageChange(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const room = 5 - existingPhotoUrls.length - images.length
    const items = await Promise.all(files.slice(0, room).map(async file => {
      const compressed = await compressImage(file, 1600)
      return { file: compressed, preview: URL.createObjectURL(compressed) }
    }))
    setImages(prev => [...prev, ...items].slice(0, room))
    e.target.value = ''
  }
  function removeNewImage(i) { setImages(prev => prev.filter((_, idx) => idx !== i)) }
  function removeExistingPhoto(url) { setExistingPhotoUrls(prev => prev.filter(u => u !== url)) }

  async function uploadImages(entryId) {
    const urls = []
    for (const item of images) {
      const ext = item.file.name?.split('.').pop() || 'jpg'
      const path = `data-center/${entryId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('complaint-attachments').upload(path, item.file, { upsert: false })
      if (!error) urls.push(supabase.storage.from('complaint-attachments').getPublicUrl(path).data.publicUrl)
    }
    return urls
  }

  const groupOptions = Array.from(new Set([...Object.keys(SEED_GROUPS), ...existing.map(e => e.group_name)])).sort((a, b) => a.localeCompare(b, 'th'))
  const categoryOptions = Array.from(new Set([
    ...(SEED_GROUPS[form.group_name] ?? []),
    ...existing.filter(e => e.group_name === form.group_name).map(e => e.category),
  ])).sort((a, b) => a.localeCompare(b, 'th'))

  const canSave = form.group_name.trim() && form.category.trim() && form.name.trim()
    && (isRoute ? routePoints.length >= 2 : form.latitude !== '' && form.longitude !== '')
  const photoCount = existingPhotoUrls.length + images.length

  async function handleSave() {
    if (!canSave || !tenant?.id) return
    setSaving(true)
    // เส้นทาง: เก็บจุดกึ่งกลางไว้ที่ latitude/longitude เดิม ให้ fitBounds/popup positioning ที่มีอยู่แล้วใช้ได้ต่อ
    const routeMid = isRoute ? routePoints[Math.floor(routePoints.length / 2)] : null
    const payload = {
      municipality_id: tenant.id,
      group_name: form.group_name.trim(),
      category: form.category.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      latitude: isRoute ? routeMid.lat : Number(form.latitude),
      longitude: isRoute ? routeMid.lng : Number(form.longitude),
      route_points: isRoute ? routePoints : null,
      route_color: isRoute ? routeColor : null,
    }

    if (isEditing) {
      const newUrls = images.length > 0 ? await uploadImages(editingEntry.id) : []
      const { error } = await supabase.from('data_center_entries')
        .update({ ...payload, photo_urls: [...existingPhotoUrls, ...newUrls], updated_at: new Date().toISOString() })
        .eq('id', editingEntry.id)
      setSaving(false)
      if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
      onSaved?.()
      return
    }

    const { data, error } = await supabase.from('data_center_entries').insert({ ...payload, created_by: profile?.id ?? null }).select('id').single()
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); setSaving(false); return }
    if (images.length > 0) {
      const urls = await uploadImages(data.id)
      if (urls.length > 0) await supabase.from('data_center_entries').update({ photo_urls: urls }).eq('id', data.id)
    }
    setSaving(false)
    onSaved?.()
  }

  async function handleDelete() {
    if (!editingEntry || deleting) return
    if (!window.confirm(`ลบ "${editingEntry.name}" ออกจากศูนย์ข้อมูลดิจิทัล? การลบนี้ย้อนกลับไม่ได้`)) return
    setDeleting(true)
    const { error } = await supabase.from('data_center_entries').delete().eq('id', editingEntry.id)
    setDeleting(false)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    onSaved?.()
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-800">{isEditing ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูลใหม่'}</h1>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 font-semibold">ยกเลิก</button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">กลุ่มหลัก *</label>
            <input type="text" list="dce-groups" value={form.group_name}
              onChange={e => setForm(f => ({ ...f, group_name: e.target.value, category: '' }))}
              className={inputCls} placeholder="เช่น สาธารณสุข" />
            <datalist id="dce-groups">{groupOptions.map(g => <option key={g} value={g} />)}</datalist>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">ประเภทย่อย *</label>
            <input type="text" list="dce-categories" value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className={inputCls} placeholder="เช่น โรงพยาบาลรัฐ" />
            <datalist id="dce-categories">{categoryOptions.map(c => <option key={c} value={c} />)}</datalist>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">ชื่อสถานที่ *</label>
          <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className={inputCls} placeholder="เช่น โรงพยาบาลน้ำเลา" />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">รายละเอียด</label>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={3} className={inputCls + ' resize-none'} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-gray-500 block">พิกัด *</label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 cursor-pointer">
              <input type="checkbox" checked={isRoute}
                onChange={e => { setIsRoute(e.target.checked); setRoutePoints(editingEntry?.route_points ?? []) }}
                className="rounded border-gray-300" />
              <Route size={13} /> เป็นเส้นทาง (ถนน)
            </label>
          </div>

          {isRoute ? (
            PolylinePickerComp ? (
              <>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs text-gray-500 shrink-0">สีเส้นทาง:</span>
                  {ROUTE_COLORS.map(({ hex, label }) => (
                    <button key={hex} type="button" title={label} onClick={() => setRouteColor(hex)}
                      className="w-6 h-6 rounded-full transition-all"
                      style={{ backgroundColor: hex, outline: routeColor === hex ? `3px solid ${hex}` : '2px solid transparent', outlineOffset: '2px' }} />
                  ))}
                </div>
                <PolylinePickerComp
                  value={routePoints}
                  onChange={setRoutePoints}
                  color={routeColor}
                  defaultCenter={tenant?.latitude && tenant?.longitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
                />
              </>
            ) : (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
            )
          ) : form.latitude !== '' ? (
            <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-3 py-2.5 text-xs text-indigo-700 font-semibold">
              <span>{Number(form.latitude).toFixed(6)}, {Number(form.longitude).toFixed(6)}{form.address && ` — ${form.address}`}</span>
              <button onClick={openPicker} className="text-indigo-500 underline shrink-0 ml-2">แก้ไข</button>
            </div>
          ) : (
            <button onClick={openPicker}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-xl px-3 py-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors">
              <MapPin size={16} /> ปักหมุดตำแหน่ง
            </button>
          )}
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">รูปภาพ (สูงสุด 5 รูป)</label>
          <div className="flex flex-wrap gap-2">
            {existingPhotoUrls.map(url => (
              <div key={url} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button onClick={() => removeExistingPhoto(url)} className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                  <X size={10} className="text-white" />
                </button>
              </div>
            ))}
            {images.map((img, i) => (
              <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200">
                <img src={img.preview} alt="" className="w-full h-full object-cover" />
                <button onClick={() => removeNewImage(i)} className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                  <X size={10} className="text-white" />
                </button>
              </div>
            ))}
            {photoCount < 5 && (
              <label className="w-16 h-16 rounded-xl border border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors">
                <ImageIcon size={18} className="text-gray-300" />
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageChange} />
              </label>
            )}
          </div>
        </div>
      </div>

      <button onClick={handleSave} disabled={!canSave || saving}
        className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm active:scale-[0.98] transition-all"
        style={{ backgroundColor: '#1e293b' }}>
        {saving ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
        {isEditing ? 'บันทึกการแก้ไข' : 'บันทึก'}
      </button>

      {canDelete && (
        <button onClick={handleDelete} disabled={deleting}
          className="w-full py-3 rounded-2xl font-semibold text-red-600 border border-red-200 flex items-center justify-center gap-2 disabled:opacity-50 text-sm hover:bg-red-50 transition-colors">
          {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={15} />}
          ลบข้อมูลนี้
        </button>
      )}

      {showPicker && PickerComp && (
        <PickerComp
          initialPos={form.latitude !== '' ? { lat: Number(form.latitude), lng: Number(form.longitude) } : null}
          fallbackPos={tenant?.latitude && tenant?.longitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
          skipGeolocation
          fixedCenterPin={false}
          onConfirm={handlePickerConfirm}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
