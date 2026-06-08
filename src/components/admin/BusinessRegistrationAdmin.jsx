import { useState, useEffect } from 'react'
import {
  Store, CheckCircle2, XCircle, Clock, ChevronRight,
  Phone, MapPin, AlignLeft, X, Loader2, ExternalLink,
  ChevronLeft, Hash, MessageSquare,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

const TABS = [
  { key: 'pending',  label: 'รอดำเนินการ', color: '#f59e0b', bg: '#fef3c7' },
  { key: 'approved', label: 'อนุมัติแล้ว',  color: '#10b981', bg: '#d1fae5' },
  { key: 'rejected', label: 'ปฏิเสธแล้ว',  color: '#ef4444', bg: '#fee2e2' },
]

const BIZ_LABEL = {
  shop:    '🛍️ ร้านค้า',
  food:    '🍽️ อาหาร/ร้านกิน',
  stay:    '🏨 ที่พัก',
  otop:    '🏺 OTOP/ชุมชน',
  tourism: '📍 ท่องเที่ยว',
  service: '🔧 บริการ/ช่าง',
  other:   '📝 อื่นๆ',
}

const BIZ_TO_CAT = {
  shop: 'shop', food: 'food', stay: 'stay',
  tourism: 'travel', otop: 'shop', service: 'shop', other: 'shop',
}

const TOURISM_CATS = [
  { value: 'travel', label: '🏛️ เที่ยว' },
  { value: 'food',   label: '🍽️ กิน' },
  { value: 'stay',   label: '🏨 พัก' },
  { value: 'shop',   label: '🛍️ ชอป / OTOP' },
]

function dateTH(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ status }) {
  const t = TABS.find(t => t.key === status)
  if (!t) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: t.bg, color: t.color }}>
      {status === 'pending'  && <Clock size={10} />}
      {status === 'approved' && <CheckCircle2 size={10} />}
      {status === 'rejected' && <XCircle size={10} />}
      {t.label}
    </span>
  )
}

// ─── Image gallery strip ────────────────────────────────────────────────────
function ImageStrip({ images, active, onSelect }) {
  if (!images?.length) return null
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
      {images.map((url, i) => (
        <button key={i} onClick={() => onSelect(i)}
          className={`shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${active === i ? 'border-blue-500' : 'border-transparent'}`}>
          <img src={url} alt="" className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  )
}

// ─── Detail Sheet ────────────────────────────────────────────────────────────
function DetailSheet({ reg, onClose, onApprove, onReject, acting }) {
  const [imgIdx, setImgIdx] = useState(0)
  const [form, setForm] = useState({
    name:           reg.business_name,
    category:       BIZ_TO_CAT[reg.business_type] ?? 'shop',
    description:    reg.description || '',
    phone:          reg.phone || '',
    address:        reg.address || '',
    service_type:   reg.service_type || 'offline',
    online_service: reg.online_service || 'order',
    online_url:     reg.online_url || '',
    has_delivery:   reg.has_delivery ?? false,
  })
  const [confirmReject, setConfirmReject] = useState(false)

  const images = reg.images ?? []
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }))

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
      <div className="bg-white w-full md:max-w-2xl md:rounded-3xl rounded-t-3xl max-h-[94vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500">
            <X size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 truncate">{reg.business_name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-400">{BIZ_LABEL[reg.business_type] ?? reg.business_type}</span>
              <StatusBadge status={reg.status} />
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Images */}
          {images.length > 0 ? (
            <div className="space-y-2">
              <div className="relative h-52 rounded-2xl overflow-hidden bg-gray-100">
                <img src={images[imgIdx]} alt="" className="w-full h-full object-cover" />
                {images.length > 1 && (
                  <>
                    <button onClick={() => setImgIdx(i => Math.max(0, i - 1))} disabled={imgIdx === 0}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center disabled:opacity-20">
                      <ChevronLeft size={16} className="text-white" />
                    </button>
                    <button onClick={() => setImgIdx(i => Math.min(images.length - 1, i + 1))} disabled={imgIdx === images.length - 1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center disabled:opacity-20">
                      <ChevronRight size={16} className="text-white" />
                    </button>
                    <span className="absolute bottom-2 right-3 text-xs text-white bg-black/50 rounded-full px-2 py-0.5">
                      {imgIdx + 1}/{images.length}
                    </span>
                  </>
                )}
              </div>
              <ImageStrip images={images} active={imgIdx} onSelect={setImgIdx} />
            </div>
          ) : (
            <div className="h-32 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
              ไม่มีรูปภาพ
            </div>
          )}

          {/* Submitted info (read-only) */}
          <div className="bg-gray-50 rounded-2xl p-3 space-y-1.5 text-sm">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">ข้อมูลที่ส่งมา</p>
            {reg.phone && (
              <div className="flex items-center gap-2 text-gray-600">
                <Phone size={14} className="text-gray-400 shrink-0" />
                <a href={`tel:${reg.phone}`} className="hover:underline">{reg.phone}</a>
              </div>
            )}
            {reg.line_id && (
              <div className="flex items-center gap-2 text-gray-600">
                <Hash size={14} className="text-gray-400 shrink-0" />
                <span>Line: {reg.line_id}</span>
              </div>
            )}
            {reg.facebook_url && (
              <div className="flex items-center gap-2 text-gray-600">
                <MessageSquare size={14} className="text-gray-400 shrink-0" />
                <a href={reg.facebook_url} target="_blank" rel="noreferrer"
                  className="truncate text-blue-600 hover:underline">{reg.facebook_url}</a>
              </div>
            )}
            {reg.operating_hours && (
              <div className="flex items-center gap-2 text-gray-600">
                <Clock size={14} className="text-gray-400 shrink-0" />
                <span>{reg.operating_hours}</span>
              </div>
            )}
            {reg.latitude && reg.longitude && (
              <a href={`https://maps.google.com/?q=${reg.latitude},${reg.longitude}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-2 text-blue-600 hover:underline">
                <MapPin size={14} className="shrink-0" />
                <span>ดูตำแหน่งบน Google Maps</span>
                <ExternalLink size={12} />
              </a>
            )}
            {reg.address && (
              <div className="flex items-start gap-2 text-gray-600">
                <AlignLeft size={14} className="text-gray-400 shrink-0 mt-0.5" />
                <span className="leading-snug">{reg.address}</span>
              </div>
            )}
            {reg.description && (
              <p className="text-gray-600 leading-relaxed pt-1 border-t border-gray-100">{reg.description}</p>
            )}
            <p className="text-xs text-gray-400 pt-1">ส่งเมื่อ {dateTH(reg.created_at)}</p>
          </div>

          {/* Edit form (only for pending) */}
          {reg.status === 'pending' && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">แก้ไขก่อนเผยแพร่</p>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">ชื่อที่จะแสดงบนเว็บ</label>
                <input value={form.name} onChange={set('name')} className={inputCls} placeholder="ชื่อสถานที่" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">หมวดหมู่ (TourismPage)</label>
                <select value={form.category} onChange={set('category')} className={inputCls}>
                  {TOURISM_CATS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">คำอธิบาย</label>
                <textarea value={form.description} onChange={set('description')} rows={3}
                  className={`${inputCls} resize-none`} placeholder="รายละเอียดสถานที่" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">เบอร์โทร</label>
                <input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="0xx-xxx-xxxx" />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">ที่อยู่</label>
                <textarea value={form.address} onChange={set('address')} rows={2}
                  className={`${inputCls} resize-none`} placeholder="ที่อยู่สถานที่" />
              </div>

              {/* Online toggle */}
              <div>
                <label className="text-xs text-gray-500 mb-1.5 block">บริการออนไลน์</label>
                <div className="flex gap-2 mb-2">
                  {[{ v: 'offline', label: '📍 ออฟไลน์' }, { v: 'online', label: '⚡ ออนไลน์' }].map(({ v, label }) => (
                    <button key={v} type="button"
                      onClick={() => setForm(p => ({ ...p, service_type: v }))}
                      className="flex-1 py-2 rounded-xl text-sm font-semibold border transition-all"
                      style={form.service_type === v
                        ? { backgroundColor: v === 'online' ? '#dcfce7' : '#f1f5f9', color: v === 'online' ? '#15803d' : '#374151', borderColor: v === 'online' ? '#86efac' : '#d1d5db' }
                        : { backgroundColor: '#f8fafc', color: '#94a3b8', borderColor: '#e2e8f0' }}>
                      {label}
                    </button>
                  ))}
                </div>
                {form.service_type === 'online' && (
                  <div className="space-y-2 p-3 bg-green-50 rounded-xl border border-green-100">
                    <select value={form.online_service} onChange={set('online_service')} className={inputCls}>
                      <option value="order">🛒 สั่งซื้อสินค้า</option>
                      <option value="book">📅 จองที่พัก / บริการ</option>
                      <option value="line">💬 ติดต่อผ่าน Line</option>
                      <option value="website">🌐 เว็บไซต์</option>
                    </select>
                    <input value={form.online_url} onChange={set('online_url')}
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
            </div>
          )}
        </div>

        {/* Footer actions */}
        {reg.status === 'pending' && (
          <div className="px-4 pb-6 pt-3 border-t border-gray-100 space-y-2 shrink-0">
            {!confirmReject ? (
              <>
                <button onClick={() => onApprove(form)} disabled={acting || !form.name.trim()}
                  className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-transform text-sm"
                  style={{ backgroundColor: '#10b981' }}>
                  {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  อนุมัติ &amp; เผยแพร่บนเว็บไซต์
                </button>
                <button onClick={() => setConfirmReject(true)} disabled={acting}
                  className="w-full py-3 rounded-2xl font-semibold text-red-500 border border-red-200 text-sm active:scale-95 transition-transform">
                  ปฏิเสธคำขอ
                </button>
              </>
            ) : (
              <div className="bg-red-50 rounded-2xl p-4 space-y-3">
                <p className="text-sm font-semibold text-red-700 text-center">ยืนยันการปฏิเสธ?</p>
                <p className="text-xs text-red-500 text-center">ข้อมูลจะไม่ถูกเผยแพร่และจะถูกทำเครื่องหมายว่าปฏิเสธ</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmReject(false)}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 font-semibold">
                    ยกเลิก
                  </button>
                  <button onClick={onReject} disabled={acting}
                    className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold flex items-center justify-center gap-1 disabled:opacity-50">
                    {acting ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                    ยืนยันปฏิเสธ
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function BusinessRegistrationAdmin({ tenant }) {
  const [regs, setRegs]     = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState('pending')
  const [selected, setSelected] = useState(null)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    supabase
      .from('business_registrations')
      .select('*')
      .eq('municipality_id', tenant.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setRegs(data ?? []); setLoading(false) })
  }, [tenant?.id])

  async function handleApprove(form) {
    if (!selected || acting) return
    setActing(true)
    const images = selected.images ?? []
    const [image_url, ...gallery] = images
    const mapsUrl = (selected.latitude && selected.longitude)
      ? `https://maps.google.com/?q=${selected.latitude},${selected.longitude}`
      : ''

    const onlineFields = form.service_type === 'online'
      ? { service_type: 'online', online_service: form.online_service, online_url: form.online_url.trim() || null, has_delivery: form.has_delivery }
      : { service_type: 'offline', online_service: null, online_url: null, has_delivery: false }

    const { error: insertErr } = await supabase.from('tourism_places').insert({
      municipality_id: tenant.id,
      name:        form.name.trim(),
      category:    form.category,
      description: form.description.trim() || null,
      phone:       form.phone.trim() || null,
      address:     form.address.trim() || null,
      maps_url:    mapsUrl || null,
      image_url:   image_url ?? null,
      gallery:     gallery.length > 0 ? gallery : [],
      is_active:   true,
      display_order: 999,
      ...onlineFields,
    })
    if (insertErr) {
      setActing(false)
      alert('เกิดข้อผิดพลาด: ' + insertErr.message)
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('business_registrations').update({
      status:      'approved',
      approved_by: session?.user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', selected.id)

    setRegs(prev => prev.map(r => r.id === selected.id ? { ...r, status: 'approved' } : r))
    setActing(false)
    setSelected(null)
  }

  async function handleReject() {
    if (!selected || acting) return
    setActing(true)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('business_registrations').update({
      status:      'rejected',
      approved_by: session?.user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', selected.id)
    setRegs(prev => prev.map(r => r.id === selected.id ? { ...r, status: 'rejected' } : r))
    setActing(false)
    setSelected(null)
  }

  const counts = {
    pending:  regs.filter(r => r.status === 'pending').length,
    approved: regs.filter(r => r.status === 'approved').length,
    rejected: regs.filter(r => r.status === 'rejected').length,
  }
  const filtered = regs.filter(r => r.status === tab)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: '#fef3c7' }}>
          <Store size={18} style={{ color: '#d97706' }} />
        </div>
        <div>
          <h2 className="font-bold text-gray-800">คำขอลงทะเบียนธุรกิจ/ท่องเที่ยว</h2>
          {counts.pending > 0 && (
            <p className="text-xs text-amber-600 font-semibold">{counts.pending} รายการรอดำเนินการ</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors"
            style={tab === t.key
              ? { backgroundColor: t.bg, color: t.color }
              : { backgroundColor: '#f1f5f9', color: '#64748b' }}>
            {t.label}
            {counts[t.key] > 0 && (
              <span className="text-[11px] font-bold px-1.5 py-0 rounded-full"
                style={tab === t.key
                  ? { backgroundColor: t.color, color: '#fff' }
                  : { backgroundColor: '#cbd5e1', color: '#475569' }}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-300" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Store size={36} className="mb-3 text-gray-200" />
          <p className="text-sm font-semibold text-gray-400">ไม่มีรายการ{TABS.find(t => t.key === tab)?.label}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(reg => {
            const thumb = reg.images?.[0]
            return (
              <button key={reg.id} onClick={() => setSelected(reg)}
                className="w-full flex items-center gap-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-3 text-left hover:bg-gray-50 active:scale-[0.99] transition-all">
                {/* Thumb */}
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                  {thumb
                    ? <img src={thumb} alt="" className="w-full h-full object-cover" />
                    : <Store size={20} className="text-gray-300" />
                  }
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 truncate text-sm">{reg.business_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{BIZ_LABEL[reg.business_type] ?? reg.business_type}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <StatusBadge status={reg.status} />
                    <span className="text-[11px] text-gray-400">{dateTH(reg.created_at)}</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-300 shrink-0" />
              </button>
            )
          })}
        </div>
      )}

      {/* Detail sheet */}
      {selected && (
        <DetailSheet
          reg={selected}
          onClose={() => setSelected(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          acting={acting}
        />
      )}
    </div>
  )
}
