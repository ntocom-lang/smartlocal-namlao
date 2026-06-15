import { useState, useEffect } from 'react'
import { Luggage, Store, Star, RefreshCw, Loader2, Plus, Camera, Pencil, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import BusinessRegistrationAdmin from './BusinessRegistrationAdmin'

const TOUR_CATS = [
  { key: 'travel',  label: 'เที่ยว', emoji: '🏛️', color: '#d97706' },
  { key: 'food',    label: 'กิน',    emoji: '🍽️', color: '#10b981' },
  { key: 'stay',    label: 'พัก',    emoji: '🏨', color: '#3b82f6' },
  { key: 'shop',    label: 'ชอบ',   emoji: '🛍️', color: '#ec4899' },
  { key: 'service', label: 'บริการ', emoji: '🔧', color: '#dc2626' },
]

async function compressImage(file, maxPx = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new window.Image()
      img.onload = () => {
        const scale = img.naturalWidth > maxPx ? maxPx / img.naturalWidth : 1
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.naturalWidth  * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })), 'image/jpeg', quality)
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

const EMPTY_FORM = { name: '', category: 'travel', description: '', phone: '', address: '', maps_url: '', service_type: 'offline', online_service: 'order', online_url: '', has_delivery: false }

export function TourismReviewsAdmin({ tenant }) {
  const [reviews, setReviews] = useState([])
  const [places,  setPlaces]  = useState([])
  const [loading, setLoading] = useState(true)
  const [filterRating, setFilterRating] = useState(0)
  const [deleting, setDeleting] = useState(null)

  async function fetchData() {
    if (!tenant?.id) return
    setLoading(true)
    const [{ data: rv }, { data: pl }] = await Promise.all([
      supabase.from('tourism_reviews').select('*').eq('municipality_id', tenant.id).order('created_at', { ascending: false }),
      supabase.from('tourism_places').select('id, name').eq('municipality_id', tenant.id),
    ])
    setReviews(rv ?? [])
    setPlaces(pl ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [tenant?.id])

  const placeMap = Object.fromEntries((places ?? []).map(p => [p.id, p.name]))

  async function handleDelete(id) {
    if (!window.confirm('ลบรีวิวนี้ออกจากระบบ?')) return
    setDeleting(id)
    await supabase.from('tourism_reviews').delete().eq('id', id)
    setDeleting(null)
    setReviews(prev => prev.filter(r => r.id !== id))
  }

  const filtered = filterRating > 0 ? reviews.filter(r => r.rating === filterRating) : reviews
  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '—'

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Star size={18} style={{ color: '#f59e0b' }} />
            รีวิวสถานที่ท่องเที่ยว
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{reviews.length} รีวิว · คะแนนเฉลี่ย {avgRating}</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {[0,5,4,3,2,1].map(r => (
            <button key={r} onClick={() => setFilterRating(r)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${filterRating === r ? 'text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              style={filterRating === r ? { backgroundColor: '#f59e0b' } : {}}>
              {r === 0 ? 'ทั้งหมด' : `${r}★`}
            </button>
          ))}
        </div>
        <button onClick={fetchData} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">ไม่พบรีวิว</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const date = new Date(r.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-semibold tracking-wider" style={{ color: '#f59e0b' }}>
                      {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="font-semibold text-gray-700">{placeMap[r.place_id] ?? '—'}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-500">{r.reviewer_name ?? 'ไม่ระบุชื่อ'}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400">{date}</span>
                  </div>
                  {r.comment && <p className="text-sm text-gray-600 mt-1 leading-snug">{r.comment}</p>}
                </div>
                <button onClick={() => handleDelete(r.id)} disabled={deleting === r.id}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors shrink-0">
                  {deleting === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function TourismManager({ tenant }) {
  const [places, setPlaces]             = useState([])
  const [loading, setLoading]           = useState(true)
  const [sheet, setSheet]               = useState(null)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [saving, setSaving]             = useState(false)
  const [uploadingFor, setUploadingFor] = useState(null)
  const [mgTab, setMgTab]               = useState('places')
  const [pendingCount, setPendingCount]  = useState(0)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('tourism_places').select('*').eq('municipality_id', tenant.id)
      .order('display_order')
      .then(({ data }) => { setPlaces(data ?? []); setLoading(false) })
  }, [tenant?.id])

  useEffect(() => {
    if (!tenant?.id) return
    supabase.from('business_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('municipality_id', tenant.id)
      .eq('status', 'pending')
      .then(({ count }) => setPendingCount(count ?? 0))
  }, [tenant?.id])

  const sheetPlace = sheet && sheet !== 'add' ? places.find(p => p.id === sheet) : null
  const sheetAllImgs = sheetPlace ? [sheetPlace.image_url, ...(sheetPlace.gallery ?? [])].filter(Boolean) : []

  function openAdd() { setForm(EMPTY_FORM); setSheet('add') }
  function openEdit(place) { setForm({ name: place.name, category: place.category, description: place.description || '', phone: place.phone || '', address: place.address || '', maps_url: place.maps_url || '', service_type: place.service_type || 'offline', online_service: place.online_service || 'order', online_url: place.online_url || '', has_delivery: place.has_delivery ?? false }); setSheet(place.id) }
  function closeSheet() { setSheet(null) }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const onlineFields = form.service_type !== 'offline'
      ? { service_type: form.service_type, online_service: form.online_service, online_url: form.online_url.trim() || null, has_delivery: form.has_delivery }
      : { service_type: 'offline', online_service: null, online_url: null, has_delivery: false }
    if (sheet === 'add') {
      const { data } = await supabase.from('tourism_places').insert({
        municipality_id: tenant.id, name: form.name.trim(), category: form.category,
        description: form.description.trim() || null, phone: form.phone.trim() || null,
        address: form.address.trim() || null, maps_url: form.maps_url.trim() || null,
        is_active: true, display_order: places.length, gallery: [], ...onlineFields,
      }).select().single()
      if (data) { setPlaces(prev => [...prev, data]); setSheet(data.id) }
    } else {
      await supabase.from('tourism_places').update({
        name: form.name.trim(), category: form.category,
        description: form.description.trim() || null, phone: form.phone.trim() || null,
        address: form.address.trim() || null, maps_url: form.maps_url.trim() || null, ...onlineFields,
      }).eq('id', sheet)
      setPlaces(prev => prev.map(p => p.id === sheet ? { ...p, ...form, ...onlineFields } : p))
      closeSheet()
    }
    setSaving(false)
  }

  async function toggleActive(place, e) {
    e.stopPropagation()
    await supabase.from('tourism_places').update({ is_active: !place.is_active }).eq('id', place.id)
    setPlaces(prev => prev.map(p => p.id === place.id ? { ...p, is_active: !p.is_active } : p))
  }

  async function handleDelete() {
    if (!sheetPlace || !window.confirm(`ลบ "${sheetPlace.name}" ออกจากรายการ?`)) return
    await supabase.from('tourism_places').delete().eq('id', sheetPlace.id)
    setPlaces(prev => prev.filter(p => p.id !== sheetPlace.id))
    closeSheet()
  }

  const MAX_IMAGES = 5

  async function uploadImages(placeId, files) {
    const place = places.find(p => p.id === placeId)
    if (!place) return
    const current = [place.image_url, ...(place.gallery ?? [])].filter(Boolean).length
    const allowed = files.slice(0, Math.max(0, MAX_IMAGES - current))
    if (allowed.length === 0) return
    setUploadingFor(placeId)
    for (const rawFile of allowed) {
      const compressed = await compressImage(rawFile)
      const path = `tourism/${placeId}/photo_${Date.now()}.jpg`
      const { error } = await supabase.storage.from('complaint-attachments').upload(path, compressed, { upsert: true })
      if (error) continue
      const { data: urlData } = supabase.storage.from('complaint-attachments').getPublicUrl(path)
      const url = urlData.publicUrl
      await supabase.from('tourism_places').select('image_url, gallery').eq('id', placeId).single()
        .then(async ({ data: fresh }) => {
          if (!fresh?.image_url) {
            await supabase.from('tourism_places').update({ image_url: url }).eq('id', placeId)
            setPlaces(prev => prev.map(p => p.id === placeId ? { ...p, image_url: url } : p))
          } else {
            const gallery = [...(fresh.gallery ?? []), url]
            await supabase.from('tourism_places').update({ gallery }).eq('id', placeId)
            setPlaces(prev => prev.map(p => p.id === placeId ? { ...p, gallery } : p))
          }
        })
    }
    setUploadingFor(null)
  }

  async function removeImage(url) {
    const place = sheetPlace
    if (!place) return
    if (place.image_url === url) {
      const gallery = place.gallery ?? []
      const newPrimary = gallery[0] ?? null
      const newGallery = gallery.slice(1)
      await supabase.from('tourism_places').update({ image_url: newPrimary, gallery: newGallery }).eq('id', place.id)
      setPlaces(prev => prev.map(p => p.id === place.id ? { ...p, image_url: newPrimary, gallery: newGallery } : p))
    } else {
      const newGallery = (place.gallery ?? []).filter(u => u !== url)
      await supabase.from('tourism_places').update({ gallery: newGallery }).eq('id', place.id)
      setPlaces(prev => prev.map(p => p.id === place.id ? { ...p, gallery: newGallery } : p))
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'
  const isAdd = sheet === 'add'

  return (
    <div className="space-y-4">
      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 pb-3 border-b border-gray-100">
        <button onClick={() => setMgTab('places')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl transition-colors"
          style={mgTab === 'places' ? { backgroundColor: 'var(--color-primary)', color: '#fff' } : { color: '#64748b' }}>
          <Luggage size={14} /> สถานที่ทั้งหมด
        </button>
        <button onClick={() => setMgTab('requests')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-xl transition-colors"
          style={mgTab === 'requests' ? { backgroundColor: '#d97706', color: '#fff' } : { color: '#64748b' }}>
          <Store size={14} /> คำขอลงทะเบียน
          {pendingCount > 0 && (
            <span className="ml-1 text-[11px] font-bold px-1.5 rounded-full bg-red-500 text-white">{pendingCount}</span>
          )}
        </button>
        {mgTab === 'places' && (
          <button onClick={openAdd}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={15} /> เพิ่มรายการใหม่
          </button>
        )}
      </div>

      {mgTab === 'requests' ? (
        <BusinessRegistrationAdmin tenant={tenant} />
      ) : loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-300" size={28} /></div>
      ) : places.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">ยังไม่มีรายการ</p>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-2">
            {places.map(place => {
              const cat = TOUR_CATS.find(c => c.key === place.category)
              const imgCount = [place.image_url, ...(place.gallery ?? [])].filter(Boolean).length
              return (
                <div key={place.id}
                  className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-opacity ${!place.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3 p-3">
                    <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center text-xl">
                      {place.image_url ? <img src={place.image_url} alt="" className="w-full h-full object-cover" /> : (cat?.emoji || '')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="inline-block text-[11px] font-bold px-1.5 py-0.5 rounded-md text-white mb-0.5"
                            style={{ backgroundColor: cat?.color ?? '#64748b' }}>
                        {cat?.emoji} {cat?.label}
                      </span>
                      <p className="text-sm font-semibold text-gray-800 truncate">{place.name}</p>
                      <p className="text-xs text-gray-400">{imgCount} รูป · {place.is_active ? 'แสดงอยู่' : 'ซ่อนอยู่'}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={e => toggleActive(place, e)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${place.is_active ? 'bg-green-400' : 'bg-gray-300'}`}>
                        {place.is_active ? '✓' : '—'}
                      </button>
                      <button onClick={() => openEdit(place)}
                        className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                        <Pencil size={14} className="text-blue-500" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 w-16">ลำดับ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ชื่อสถานที่</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">ประเภท</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 w-20">รูปภาพ</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 w-24">สถานะ</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 w-28">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {places.map((place, i) => {
                  const cat = TOUR_CATS.find(c => c.key === place.category)
                  const imgCount = [place.image_url, ...(place.gallery ?? [])].filter(Boolean).length
                  return (
                    <tr key={place.id} className={`hover:bg-gray-50 transition-colors ${!place.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center text-base">
                            {place.image_url ? <img src={place.image_url} alt="" className="w-full h-full object-cover" /> : (cat?.emoji || '')}
                          </div>
                          <span className="font-medium text-gray-800">{place.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md text-white"
                          style={{ backgroundColor: cat?.color ?? '#64748b' }}>
                          {cat?.emoji} {cat?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">{imgCount} รูป</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={e => toggleActive(place, e)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full ${place.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {place.is_active ? 'แสดงอยู่' : 'ซ่อนอยู่'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => openEdit(place)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="แก้ไข">
                            <Pencil size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── Bottom Sheet ─── */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={closeSheet}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full bg-white rounded-t-3xl shadow-2xl max-h-[92vh] flex flex-col"
               onClick={e => e.stopPropagation()}>

            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-gray-100">
              <h3 className="font-bold text-gray-800">
                {isAdd ? 'เพิ่มรายการใหม่' : `แก้ไข: ${sheetPlace?.name ?? ''}`}
              </h3>
              <button onClick={closeSheet} className="p-1.5 rounded-xl hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {!isAdd && (
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                    รูปภาพ ({sheetAllImgs.length}/{MAX_IMAGES})
                    {uploadingFor === sheetPlace?.id && <span className="ml-2 text-blue-500 normal-case font-normal">กำลังอัปโหลด...</span>}
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                    {sheetAllImgs.map((url, idx) => (
                      <div key={url} className="relative shrink-0 w-24 h-24">
                        <img src={url} alt="" className="w-full h-full object-cover rounded-xl" />
                        {idx === 0 && <span className="absolute bottom-1 left-1 text-[9px] bg-yellow-400 text-white px-1.5 py-0.5 rounded-full font-bold">หลัก</span>}
                        <button onClick={() => removeImage(url)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shadow">
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                    ))}
                    {sheetAllImgs.length < MAX_IMAGES && (
                      <label className={`shrink-0 w-24 h-24 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${uploadingFor === sheetPlace?.id ? 'opacity-50 cursor-wait border-gray-200' : 'border-gray-300 hover:border-blue-400'}`}>
                        {uploadingFor === sheetPlace?.id
                          ? <Loader2 size={20} className="animate-spin text-gray-400" />
                          : <><Camera size={20} className="text-gray-400" /><span className="text-[11px] text-gray-400">เพิ่มรูป</span></>}
                        <input type="file" accept="image/*" multiple className="hidden"
                          disabled={uploadingFor === sheetPlace?.id}
                          onChange={e => uploadImages(sheetPlace.id, [...e.target.files])} />
                      </label>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">รูปแรก = รูปหน้าปก · รูปใหญ่ถูกบีบอัตโนมัติ</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">ข้อมูล</p>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="ชื่อสถานที่ / ร้านอาหาร / ที่พัก *" className={inputCls} />
                <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inputCls}>
                  {TOUR_CATS.map(c => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
                </select>
                <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="คำอธิบาย / ข้อมูลน่าสนใจ / ประวัติความเป็นมา..." rows={4}
                  className={inputCls + ' resize-none'} />
                <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="เบอร์โทรศัพท์" className={inputCls} />
                <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                  placeholder="ที่อยู่ / หมู่ที่ / ตำบล" className={inputCls} />
                <input value={form.maps_url} onChange={e => setForm(p => ({ ...p, maps_url: e.target.value }))}
                  placeholder="ลิงก์ Google Maps" className={inputCls} />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">บริการออนไลน์</p>
                <div className="flex flex-col gap-1.5">
                  {[
                    { v: 'offline',     label: '📍 ออฟไลน์ (มีหน้าร้าน)' },
                    { v: 'online',      label: '⚡ ออนไลน์ + มีหน้าร้าน' },
                    { v: 'online_only', label: '🏪 ตลาดออนไลน์ (ไม่มีหน้าร้าน)' },
                  ].map(({ v, label }) => {
                    const colors = v === 'online' ? { bg: '#dcfce7', color: '#15803d', border: '#86efac' }
                                 : v === 'online_only' ? { bg: '#ede9fe', color: '#7c3aed', border: '#c4b5fd' }
                                 : { bg: '#f1f5f9', color: '#374151', border: '#e2e8f0' }
                    const active = form.service_type === v
                    return (
                      <button key={v} type="button"
                        onClick={() => setForm(p => ({ ...p, service_type: v }))}
                        className="py-2 px-3 rounded-xl text-sm font-semibold border text-left transition-all"
                        style={active
                          ? { backgroundColor: colors.bg, color: colors.color, borderColor: colors.border }
                          : { backgroundColor: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}>
                        {label}
                      </button>
                    )
                  })}
                </div>
                {form.service_type !== 'offline' && (
                  <div className="space-y-2 p-3 bg-green-50 rounded-xl border border-green-100">
                    <select value={form.online_service} onChange={e => setForm(p => ({ ...p, online_service: e.target.value }))} className={inputCls}>
                      <option value="order">🛒 สั่งซื้อสินค้า</option>
                      <option value="book">📅 จองที่พัก / บริการ</option>
                      <option value="line">💬 ติดต่อผ่าน Line</option>
                      <option value="website">🌐 เว็บไซต์</option>
                    </select>
                    <input value={form.online_url} onChange={e => setForm(p => ({ ...p, online_url: e.target.value }))}
                      placeholder="ลิงก์ / Line ID / URL" className={inputCls} />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.has_delivery}
                        onChange={e => setForm(p => ({ ...p, has_delivery: e.target.checked }))}
                        className="w-4 h-4 rounded accent-green-500" />
                      <span className="text-sm text-gray-700">🛵 มีบริการส่งถึงบ้าน</span>
                    </label>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pb-2">
                <button onClick={handleSave} disabled={saving || !form.name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {isAdd ? 'เพิ่มรายการ' : 'บันทึก'}
                </button>
                {!isAdd && (
                  <button onClick={handleDelete}
                    className="px-4 py-3 rounded-xl bg-red-50 text-red-500 text-sm font-semibold">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
