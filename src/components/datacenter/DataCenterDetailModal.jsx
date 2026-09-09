import { useState } from 'react'
import {
  X, MapPin, ExternalLink, Calendar, Building2, Copy, Check, Pencil,
  Image as ImageIcon, FileText, Globe, Route, Eye, EyeOff, Maximize2
} from 'lucide-react'
import CategoryIcon from './CategoryIcon'
import LeafletMapCanvas from '../common/LeafletMapCanvas'
import { resolveEntryEmoji, resolveGroupEmoji, isIconImage } from '../../lib/dataCenterGroupIcon'

function withAlpha(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return `rgba(100, 116, 139, ${alpha})`
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) || 0
  const g = parseInt(h.substring(2, 4), 16) || 0
  const b = parseInt(h.substring(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatThaiDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  const timeStr = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  return `${dateStr} เวลา ${timeStr} น.`
}

export default function DataCenterDetailModal({
  entry,
  isOpen,
  onClose,
  onEdit,
  onViewOnMap,
  onToggleStatus,
  departments = [],
  groupIconOverrides = {},
  theme = 'light',
  groupMeta = null,
}) {
  const [copied, setCopied] = useState(false)
  const [previewPhoto, setPreviewPhoto] = useState(null)
  const [statusUpdating, setStatusUpdating] = useState(false)

  const isLight = theme === 'light'

  // ค้นหาชื่อกอง/สำนักจาก summary.departments
  const deptId = entry?.department_id
  const departmentName = deptId
    ? departments.find(d => d.department_id === deptId || d.id === deptId)?.name || 'ไม่ทราบชื่อกอง'
    : 'ส่วนกลาง / ไม่ระบุกอง'

  if (!isOpen || !entry) return null

  const isActive = entry.status !== 'archived'
  const entryEmoji = resolveEntryEmoji(entry.group_name, entry.category, groupIconOverrides)
  const groupEmoji = resolveGroupEmoji(entry.group_name, groupIconOverrides)

  const hasCoords = entry.latitude != null && entry.longitude != null &&
    !isNaN(Number(entry.latitude)) && !isNaN(Number(entry.longitude))
  const lat = hasCoords ? Number(entry.latitude) : 13.7563
  const lng = hasCoords ? Number(entry.longitude) : 100.5018

  const isRoute = Array.isArray(entry.route_points) && entry.route_points.length >= 2
  const routePoints = isRoute ? entry.route_points : []
  const routeColor = entry.route_color || '#3b82f6'

  const mapCenter = { lat, lng }
  const markers = hasCoords && !isRoute ? [{
    id: entry.id,
    position: { lat, lng },
    tooltip: entry.name || '',
    color: groupMeta?.bg || '#0284c7',
    label: isIconImage(entryEmoji) ? '' : entryEmoji,
    iconUrl: isIconImage(entryEmoji) ? entryEmoji : null,
    shape: 'circle',
    scale: 11,
  }] : []

  const polylines = isRoute ? [{
    id: entry.id,
    path: routePoints,
    color: routeColor,
    weight: 5,
    opacity: 0.9,
  }] : []

  function handleCopyCoords() {
    if (!hasCoords) return
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleToggleStatusClick() {
    if (!onToggleStatus) return
    setStatusUpdating(true)
    try {
      await onToggleStatus(entry)
    } finally {
      setStatusUpdating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="datacenter-detail-title"
        className={`w-full max-w-2xl max-h-[92vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden transition-all ${
          isLight
            ? 'bg-white/95 border-slate-200 text-slate-800 shadow-slate-900/10'
            : 'bg-slate-900/95 border-cyan-500/30 text-white shadow-cyan-950/60'
        }`}>

        {/* ── Modal Header ── */}
        <div className={`p-4 sm:p-5 border-b flex items-start justify-between gap-3 ${
          isLight ? 'bg-slate-50/80 border-slate-200' : 'bg-slate-950/70 border-cyan-500/20'
        }`}>
          <div className="flex items-center gap-3.5 min-w-0">
            <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center text-2xl shrink-0 shadow-sm ${
              isLight ? 'bg-white border-slate-200 shadow-slate-100' : 'bg-slate-800/90 border-cyan-500/40'
            }`}>
              <CategoryIcon value={entryEmoji} alt="" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {entry.group_name && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border"
                    style={{
                      backgroundColor: withAlpha(groupMeta?.bg || '#0284c7', 0.12),
                      color: groupMeta?.bg || '#0284c7',
                      borderColor: withAlpha(groupMeta?.bg || '#0284c7', 0.35)
                    }}>
                    <CategoryIcon value={groupEmoji} alt="" className="text-[12px]" />
                    <span>{entry.group_name}</span>
                  </span>
                )}
                {entry.category && (
                  <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-lg border ${
                    isLight ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}>
                    {entry.category}
                  </span>
                )}
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                  isActive
                    ? (isLight ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400')
                    : (isLight ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-slate-800 border-slate-700 text-slate-400')
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                  {isActive ? 'ใช้งาน' : 'ไม่ใช้งาน'}
                </span>
              </div>
              <h2 id="datacenter-detail-title" className={`text-base sm:text-lg font-black truncate tracking-wide ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}>
                {entry.name || '(ไม่มีชื่อ)'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className={`p-2 rounded-xl border transition-colors shrink-0 ${
              isLight
                ? 'bg-white border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700'
            }`}>
            <X size={17} />
          </button>
        </div>

        {/* ── Modal Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 text-xs sm:text-sm">

          {/* Quick Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* กอง/สำนัก */}
            <div className={`p-3 rounded-2xl border ${
              isLight ? 'bg-slate-50/70 border-slate-200/90' : 'bg-slate-950/50 border-slate-800'
            }`}>
              <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                <Building2 size={14} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
                <span className="text-[11px] font-bold">กอง/สำนักที่รับผิดชอบ</span>
              </div>
              <p className={`font-bold truncate text-xs sm:text-[13px] ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                {departmentName}
              </p>
            </div>

            {/* พิกัด GIS */}
            <div className={`p-3 rounded-2xl border ${
              isLight ? 'bg-slate-50/70 border-slate-200/90' : 'bg-slate-950/50 border-slate-800'
            }`}>
              <div className="flex items-center justify-between gap-1 text-slate-400 mb-1">
                <div className="flex items-center gap-1.5">
                  <MapPin size={14} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
                  <span className="text-[11px] font-bold">พิกัด GIS</span>
                </div>
                {hasCoords && (
                  <button
                    type="button"
                    onClick={handleCopyCoords}
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border transition-all ${
                      copied
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        : isLight
                          ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}>
                    {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                  </button>
                )}
              </div>
              <p className={`font-mono font-bold text-xs sm:text-[13px] truncate ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                {isRoute
                  ? `เส้นทาง ${routePoints.length} จุด`
                  : hasCoords ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '—'}
              </p>
            </div>

            {/* วันที่บันทึก */}
            <div className={`p-3 rounded-2xl border ${
              isLight ? 'bg-slate-50/70 border-slate-200/90' : 'bg-slate-950/50 border-slate-800'
            }`}>
              <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                <Calendar size={14} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
                <span className="text-[11px] font-bold">บันทึกเมื่อ</span>
              </div>
              <p className={`font-bold text-xs sm:text-[13px] truncate ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                {formatThaiDateTime(entry.created_at)}
              </p>
            </div>
          </div>

          {/* รายละเอียดเพิ่มเติม */}
          <div className={`p-4 rounded-2xl border space-y-2 ${
            isLight ? 'bg-slate-50/50 border-slate-200' : 'bg-slate-950/40 border-slate-800'
          }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText size={15} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
                <h3 className="font-extrabold text-xs tracking-wide">รายละเอียดและคำอธิบาย</h3>
              </div>
              {entry.external_url && (
                <a
                  href={entry.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors ${
                    isLight
                      ? 'bg-white border-sky-200 text-sky-700 hover:bg-sky-50'
                      : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20'
                  }`}>
                  <Globe size={12} />
                  <span>เปิดลิงก์ภายนอก</span>
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
            {entry.description ? (
              <p className={`whitespace-pre-wrap leading-relaxed text-xs sm:text-[13px] pt-1 ${
                isLight ? 'text-slate-700' : 'text-slate-300'
              }`}>
                {entry.description}
              </p>
            ) : (
              <p className="text-xs italic text-slate-400 py-1">
                ไม่ได้ระบุรายละเอียดเพิ่มเติมสำหรับสถานที่นี้
              </p>
            )}
          </div>

          {/* แผนที่พิกัด GIS Preview */}
          <div className={`rounded-2xl border overflow-hidden ${
            isLight ? 'border-slate-200 bg-white' : 'border-cyan-500/20 bg-slate-950'
          }`}>
            <div className={`px-4 py-2.5 border-b flex items-center justify-between gap-2 text-xs font-bold ${
              isLight ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-slate-950/80 border-cyan-500/20 text-cyan-300'
            }`}>
              <div className="flex items-center gap-2">
                <Globe size={14} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
                <span>ตำแหน่งบนแผนที่ GIS</span>
                {isRoute && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono bg-blue-500/10 border-blue-500/30 text-blue-400">
                    <Route size={10} /> เส้นทาง {routePoints.length} จุด
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {hasCoords && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}>
                    <ExternalLink size={11} />
                    <span>Google Maps</span>
                  </a>
                )}
                {onViewOnMap && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onViewOnMap(entry)
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                      isLight
                        ? 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
                        : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20'
                    }`}>
                    <MapPin size={11} />
                    <span>ดูบนแผนที่ระบบ</span>
                  </button>
                )}
              </div>
            </div>

            <div className="h-48 sm:h-56 w-full relative">
              {hasCoords ? (
                <LeafletMapCanvas
                  center={mapCenter}
                  zoom={isRoute ? 14 : 16}
                  mapTypeId="hybrid"
                  markers={markers}
                  polylines={polylines}
                  fitBounds={isRoute}
                  className="w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
                  <MapPin size={24} className="opacity-40" />
                  <p className="text-xs">ไม่มีข้อมูลพิกัด GIS ที่ถูกต้อง</p>
                </div>
              )}
            </div>
          </div>

          {/* คลังรูปภาพสถานที่ (Photo Gallery) */}
          <div className={`p-4 rounded-2xl border space-y-3 ${
            isLight ? 'bg-slate-50/50 border-slate-200' : 'bg-slate-950/40 border-slate-800'
          }`}>
            <div className="flex items-center gap-2">
              <ImageIcon size={15} className={isLight ? 'text-sky-600' : 'text-cyan-400'} />
              <h3 className="font-extrabold text-xs tracking-wide">
                รูปภาพสถานที่ ({entry.photo_urls?.length || 0})
              </h3>
            </div>
            {entry.photo_urls?.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {entry.photo_urls.map((url, i) => (
                  <div
                    key={url}
                    onClick={() => setPreviewPhoto(url)}
                    className="group relative h-28 sm:h-32 rounded-xl overflow-hidden border border-slate-200/80 bg-slate-100 cursor-pointer shadow-sm hover:shadow-md transition-all">
                    <img
                      src={url}
                      alt={`${entry.name} ภาพที่ ${i + 1}`}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-slate-950/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                      <Maximize2 size={18} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-slate-400">
                <ImageIcon size={28} className="mx-auto mb-1.5 opacity-30" />
                <p className="text-xs">ไม่มีรูปภาพแนบสำหรับรายการนี้</p>
              </div>
            )}
          </div>

        </div>

        {/* ── Modal Footer Actions ── */}
        <div className={`p-3.5 sm:p-4 border-t flex flex-wrap items-center justify-between gap-2.5 ${
          isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-950/80 border-cyan-500/20'
        }`}>
          <div>
            {onToggleStatus && (
              <button
                type="button"
                onClick={handleToggleStatusClick}
                disabled={statusUpdating}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors disabled:opacity-50 ${
                  isActive
                    ? isLight
                      ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    : isLight
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20'
                }`}>
                {isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                <span>{isActive ? 'ปิดใช้งานรายการนี้' : 'เปิดใช้งานรายการนี้'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onViewOnMap && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onViewOnMap(entry)
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-700 hover:border-sky-400 hover:text-sky-700'
                    : 'bg-slate-800 border-slate-700 text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300'
                }`}>
                <MapPin size={13} />
                <span>ดูบนแผนที่</span>
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onEdit(entry)
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                  isLight
                    ? 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
                    : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20'
                }`}>
                <Pencil size={13} />
                <span>แก้ไขข้อมูล</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                isLight
                  ? 'bg-slate-200/80 border-slate-300 text-slate-700 hover:bg-slate-300'
                  : 'bg-slate-700 border-slate-600 text-white hover:bg-slate-600'
              }`}>
              ปิด
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox Preview Modal for Enlarged Photo */}
      {previewPhoto && (
        <div
          onClick={() => setPreviewPhoto(null)}
          className="fixed inset-0 z-60 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <img
              src={previewPhoto}
              alt="รูปภาพขนาดเต็ม"
              className="max-h-[82vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/20"
            />
            <div className="mt-3 flex items-center gap-3">
              <a
                href={previewPhoto}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-colors">
                <ExternalLink size={13} />
                <span>เปิดรูปในแท็บใหม่</span>
              </a>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="px-3.5 py-1.5 rounded-xl bg-white text-slate-900 text-xs font-bold hover:bg-slate-100 transition-colors">
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
