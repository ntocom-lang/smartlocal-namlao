import { useState } from 'react'
import { Target, Eye, EyeOff, Pencil, Plus, X, ChevronDown, ChevronRight, MapPin } from 'lucide-react'
import { categoryNameOf } from '../../lib/complaintCategoryLabels.js'
import { ZONE_DISCLAIMER, formatRadius, normalizeRadii, ringColor, zoneHideKey, ringHideKey } from '../../lib/adhocZones'

// ส่วนแสดง/จัดการ "วงรัศมีเรื่องเฉพาะกิจ" บนแผนที่ศูนย์ข้อมูลฝั่งเจ้าหน้าที่ — มี 2 ชิ้น:
//   AdhocZonesPanel: รายการเรื่องในแถบขวา/แผงล่างมือถือ พร้อมสวิตช์เปิด-ปิดรายเรื่อง/รายวง
//   AdhocZoneCard:   การ์ดลอยตอนกดหมุดจุดต้นทางบนแผนที่
//
// ถ้อยคำของ ZONE_DISCLAIMER อยู่ใน src/lib/adhocZones.js (ไฟล์คอมโพเนนต์ส่งออกค่าคงที่ปนไม่ได้ — react-refresh)


const categoryLabels = categories => Object.fromEntries((categories ?? []).map(c => [c.value, c.label]))

// ชิปรัศมีหนึ่งวง: สีตรงกับวงบนแผนที่ · กดเพื่อเปิด/ปิดวงนั้น (ส่วนตัว ไม่กระทบคนอื่น)
function RingChip({ zoneId, radius, index, count, hidden, onToggle, disabled }) {
  const off = hidden.has(ringHideKey(zoneId, radius)) || disabled
  const color = ringColor(index)
  return (
    <button type="button" aria-pressed={!off} disabled={disabled}
      onClick={() => onToggle(ringHideKey(zoneId, radius))}
      aria-label={`${off ? 'แสดง' : 'ซ่อน'}วงรัศมี ${formatRadius(radius)}`}
      className="flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors active:scale-95"
      style={off
        ? { backgroundColor: '#f9fafb', borderColor: '#e5e7eb', color: '#9ca3af' }
        : { backgroundColor: `${color}14`, borderColor: color, color }}>
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: off ? '#d1d5db' : color }} />
      {formatRadius(radius)}
      {count != null && <span className={off ? 'font-normal' : 'font-bold'}>· {count} เรื่อง</span>}
    </button>
  )
}

export default function AdhocZonesPanel({
  zones, counts, categories, canManage, layerOn, onToggleLayer, hidden, onToggleHidden,
  onAdd, onEdit, onFocus, onReopen, selectedZoneId,
}) {
  const [showClosed, setShowClosed] = useState(false)
  const labels = categoryLabels(categories)
  const openZones = zones.filter(z => z.is_active)
  const closedZones = zones.filter(z => !z.is_active)

  return (
    <section aria-label="วงรัศมีเรื่องเฉพาะกิจ" className="border-b border-gray-100 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-gray-700">
          <Target size={14} className="shrink-0 text-red-600" />
          <span className="truncate">วงรัศมีเรื่องเฉพาะกิจ</span>
          {openZones.length > 0 && <span className="rounded-full bg-gray-100 px-1.5 text-[10px] font-bold text-gray-500">{openZones.length}</span>}
        </h3>
        {openZones.length > 0 && (
          <button type="button" onClick={onToggleLayer} aria-pressed={layerOn}
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold active:scale-95"
            style={layerOn
              ? { backgroundColor: '#1e88c7', borderColor: '#1e88c7', color: '#fff' }
              : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#6b7280' }}>
            {layerOn ? <Eye size={13} /> : <EyeOff size={13} />}
            {layerOn ? 'แสดงอยู่' : 'ซ่อนอยู่'}
          </button>
        )}
      </div>

      {openZones.length === 0 && (
        <p className="mt-2 rounded-xl border border-dashed border-gray-200 px-3 py-3 text-[11px] leading-relaxed text-gray-400">
          {canManage
            ? 'ยังไม่มีจุดต้นทาง กด “เพิ่มจุดต้นทาง” เพื่อวางรัศมี 1–2 กม. (หรือกำหนดเอง) รอบฟาร์มที่ถูกร้องเรียน'
            : 'ยังไม่มีการกำหนดวงรัศมี'}
        </p>
      )}

      <ul className="mt-2 space-y-2">
        {openZones.map(zone => {
          const zoneOff = hidden.has(zoneHideKey(zone.id)) || !layerOn
          const radii = normalizeRadii(zone.radii_m)
          const zoneCounts = counts.get(zone.id)
          return (
            <li key={zone.id}
              className={`rounded-xl border p-2.5 transition-colors ${selectedZoneId === zone.id ? 'border-red-300 bg-red-50/40' : 'border-gray-100 bg-white'}`}>
              <div className="flex items-start gap-1.5">
                <button type="button" onClick={() => onToggleHidden(zoneHideKey(zone.id))} aria-pressed={!hidden.has(zoneHideKey(zone.id))}
                  aria-label={`${hidden.has(zoneHideKey(zone.id)) ? 'แสดง' : 'ซ่อน'} ${zone.label} บนแผนที่`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 active:scale-95">
                  {zoneOff ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button type="button" onClick={() => onFocus(zone)}
                  className="flex min-h-9 min-w-0 flex-1 flex-col items-start justify-center text-left">
                  <span className="flex w-full items-center gap-1 text-xs font-bold text-gray-800">
                    <MapPin size={12} className="shrink-0 text-amber-600" />
                    <span className="truncate">{zone.label}</span>
                  </span>
                  <span className="text-[10px] text-gray-400">{categoryNameOf(labels, zone.category)}</span>
                </button>
                {canManage && (
                  <button type="button" onClick={() => onEdit(zone)} aria-label={`แก้ไข ${zone.label}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 active:scale-95">
                    <Pencil size={14} />
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {radii.map((radius, index) => (
                  <RingChip key={radius} zoneId={zone.id} radius={radius} index={index} hidden={hidden}
                    count={zoneCounts ? (zoneCounts.get(radius) ?? 0) : null}
                    onToggle={onToggleHidden} disabled={hidden.has(zoneHideKey(zone.id))} />
                ))}
              </div>
            </li>
          )
        })}
      </ul>

      {canManage && closedZones.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowClosed(v => !v)} aria-expanded={showClosed}
            className="flex min-h-9 items-center gap-1 text-[11px] font-semibold text-gray-400">
            {showClosed ? <ChevronDown size={13} /> : <ChevronRight size={13} />} ปิดเรื่องแล้ว ({closedZones.length})
          </button>
          {showClosed && (
            <ul className="space-y-1.5">
              {closedZones.map(zone => (
                <li key={zone.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-400">
                  <span className="truncate">{zone.label}</span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => onReopen(zone)} className="min-h-8 rounded-lg px-2 font-semibold text-sky-700">เปิดเรื่องอีกครั้ง</button>
                    <button type="button" onClick={() => onEdit(zone)} aria-label={`แก้ไข ${zone.label}`} className="min-h-8 rounded-lg px-2 font-semibold text-gray-500">แก้ไข</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canManage && (
        <button type="button" onClick={onAdd}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-sky-300 bg-sky-50 text-xs font-bold text-sky-700 active:scale-[0.99]">
          <Plus size={14} /> เพิ่มจุดต้นทาง (เช่น ฟาร์ม)
        </button>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-gray-400">{ZONE_DISCLAIMER}</p>
    </section>
  )
}

// การ์ดลอยตอนกดหมุดจุดต้นทางบนแผนที่ — ตำแหน่ง/ขนาดเหมือนการ์ดรายละเอียดหมุดของแผนที่ (ผู้เรียกใส่ className ให้)
export function AdhocZoneCard({ zone, counts, categories, canManage, onClose, onEdit, className = '' }) {
  const radii = normalizeRadii(zone.radii_m)
  const zoneCounts = counts.get(zone.id)
  const labels = categoryLabels(categories)
  return (
    <div className={`rounded-2xl border border-red-200 bg-white p-3 text-xs shadow-2xl ${className}`}>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-bold text-gray-800">
            <MapPin size={14} className="shrink-0 text-amber-600" />
            <span className="truncate">{zone.label}</span>
          </p>
          <p className="text-[11px] text-gray-400">{categoryNameOf(labels, zone.category)} · อยู่ระหว่างตรวจสอบ</p>
        </div>
        <button type="button" onClick={onClose} aria-label="ปิด" className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X size={14} /></button>
      </div>
      {/* วงเรียงเป็นแถวชิป (ไม่ใช่รายการแนวตั้ง) — การ์ดนี้ลอยทับแผนที่ ยิ่งสูงยิ่งบังวงที่กำลังอยากดู
          บนมือถือเหลือแค่หัว + ตัวเลข ส่วนคำอธิบายยาวพับไว้ใต้ "วิธีอ่านตัวเลข" (ข้อความเตือนความเป็นกลางยังอยู่ครบ ไม่หาย) */}
      <ul className="flex flex-wrap gap-1.5">
        {radii.map((radius, index) => (
          <li key={radius} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold"
            style={{ borderColor: ringColor(index), color: ringColor(index), backgroundColor: `${ringColor(index)}14` }}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: ringColor(index) }} />
            {formatRadius(radius)}
            <span className="font-bold text-gray-800">{zoneCounts ? `${zoneCounts.get(radius) ?? 0} เรื่อง` : '—'}</span>
          </li>
        ))}
      </ul>
      <details className="mt-2 text-[10px] leading-relaxed text-gray-400">
        <summary className="cursor-pointer select-none py-1 font-semibold text-gray-500">วิธีอ่านตัวเลข</summary>
        ตัวเลข = จำนวนคำร้องที่ผู้แจ้งปักพิกัดอยู่ในวง (สะสมรวมวงที่เล็กกว่า) เฉพาะเรื่องที่คุณมีสิทธิ์เห็น · {ZONE_DISCLAIMER}
      </details>
      {canManage && (
        <button type="button" onClick={() => onEdit(zone)}
          className="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 font-bold text-gray-700 active:scale-95">
          <Pencil size={13} /> แก้ไขจุดนี้
        </button>
      )}
    </div>
  )
}
