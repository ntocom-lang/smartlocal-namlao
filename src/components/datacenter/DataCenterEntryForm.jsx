import { useState, useEffect } from 'react'
import { MapPin, Loader2, X, Image as ImageIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageUtils'

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

export default function DataCenterEntryForm({ tenant, profile, initialGroup, onSaved, onCancel }) {
  const [existing, setExisting] = useState([]) // {group_name, category} ที่เคยมีจริงในเทศบาลนี้
  const [form, setForm] = useState({ group_name: initialGroup ?? '', category: '', name: '', description: '', latitude: '', longitude: '', address: '' })
  const [images, setImages] = useState([])
  const [saving, setSaving] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [PickerComp, setPickerComp] = useState(null)

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
    const items = await Promise.all(files.slice(0, 5 - images.length).map(async file => {
      const compressed = await compressImage(file, 1600)
      return { file: compressed, preview: URL.createObjectURL(compressed) }
    }))
    setImages(prev => [...prev, ...items].slice(0, 5))
    e.target.value = ''
  }
  function removeImage(i) { setImages(prev => prev.filter((_, idx) => idx !== i)) }

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

  const canSave = form.group_name.trim() && form.category.trim() && form.name.trim() && form.latitude !== '' && form.longitude !== ''

  async function handleSave() {
    if (!canSave || !tenant?.id) return
    setSaving(true)
    const payload = {
      municipality_id: tenant.id,
      group_name: form.group_name.trim(),
      category: form.category.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      created_by: profile?.id ?? null,
    }
    const { data, error } = await supabase.from('data_center_entries').insert(payload).select('id').single()
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); setSaving(false); return }
    if (images.length > 0) {
      const urls = await uploadImages(data.id)
      if (urls.length > 0) await supabase.from('data_center_entries').update({ photo_urls: urls }).eq('id', data.id)
    }
    setSaving(false)
    onSaved?.()
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-800">เพิ่มข้อมูลใหม่</h1>
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
          <label className="text-xs font-semibold text-gray-500 mb-1 block">พิกัด *</label>
          {form.latitude !== '' ? (
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
            {images.map((img, i) => (
              <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200">
                <img src={img.preview} alt="" className="w-full h-full object-cover" />
                <button onClick={() => removeImage(i)} className="absolute top-0.5 right-0.5 bg-black/50 rounded-full p-0.5">
                  <X size={10} className="text-white" />
                </button>
              </div>
            ))}
            {images.length < 5 && (
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
        บันทึก
      </button>

      {showPicker && PickerComp && (
        <PickerComp
          initialPos={form.latitude !== '' ? { lat: Number(form.latitude), lng: Number(form.longitude) } : null}
          fallbackPos={tenant?.latitude && tenant?.longitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
          onConfirm={handlePickerConfirm}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
