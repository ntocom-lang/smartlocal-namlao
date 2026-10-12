import { useState } from 'react'
import { Loader2, MapPin, X, Trash2, ShieldAlert } from 'lucide-react'
import { validZoneCoords, formatRadius } from '../../lib/adhocZones'
import {
  AFFECTED_KINDS, AFFECTED_NOTE_MAX, AFFECTED_NOTICE, affectedNoteProblem, ringOfPoint,
} from '../../lib/adhocAffected'

// ฟอร์มเพิ่ม/แก้ "ผู้ได้รับผลกระทบ" (พิกัดบุคคล) รอบจุดต้นทางหนึ่งจุด — เก็บแค่ ชนิด + พิกัด + หมายเหตุสั้น
//
// ⚠️ ไม่มีช่องชื่อ เบอร์โทร หรือเลขบัตรโดยตั้งใจ และหมายเหตุที่มีตัวเลขติดกันยาวถูกกันทั้งฝั่งนี้และ DB
// ฟอร์มเตือนผู้กรอกตรงช่องหมายเหตุ ไม่ซ่อนไว้ในตัวหนังสือเล็กท้ายหน้า
//
// พิกัดปักจากแผนที่เท่านั้น (ไม่มี "เลือกจากศูนย์ข้อมูล" เหมือนจุดต้นทาง) — ที่อยู่บ้านคนไม่ควรไปปะปนกับสถานที่สาธารณะ
// ที่ประชาชนเห็นได้ในศูนย์ข้อมูล · z-1100 อยู่เหนือแผงสรุปมือถือ (z-1001) · ตัวปักหมุดเป็น z-9999 อยู่เหนือเสมอ

const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-200'

export default function AdhocAffectedForm({ zone, point, tenant, onSave, onDelete, onClose }) {
  const isEditing = Boolean(point)
  const [kind, setKind] = useState(point?.kind ?? 'residence')
  const [position, setPosition] = useState(() => (point ? validZoneCoords(point.latitude, point.longitude) : null))
  const [note, setNote] = useState(point?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [PickerComp, setPickerComp] = useState(null)
  const [showMapPicker, setShowMapPicker] = useState(false)

  const noteProblem = affectedNoteProblem(note)
  const canSave = Boolean(kind) && Boolean(position) && !noteProblem && !saving
  const origin = validZoneCoords(zone.latitude, zone.longitude)
  const ring = position ? ringOfPoint(zone, { latitude: position.lat, longitude: position.lng }) : null

  function openMapPicker() {
    if (PickerComp) { setShowMapPicker(true); return }
    import('../MapPicker').then(mod => { setPickerComp(() => mod.default); setShowMapPicker(true) })
  }

  function handleMapConfirm({ lat, lng }) {
    const coords = validZoneCoords(lat, lng)
    setShowMapPicker(false)
    if (!coords) { setError('พิกัดที่ปักอยู่นอกประเทศไทย ลองปักใหม่'); return }
    setPosition(coords)
    setError('')
  }

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setError('')
    const result = await onSave({
      zone_id: zone.id, kind, latitude: position.lat, longitude: position.lng, note,
    }, point?.id ?? null)
    setSaving(false)
    if (result?.error) { setError(result.error); return }
    onClose()
  }

  async function remove() {
    if (!window.confirm('ลบจุดผู้ได้รับผลกระทบนี้? การลบนี้ย้อนกลับไม่ได้ (ยังมีบันทึกใน audit log ว่ามีการลบ)')) return
    setSaving(true)
    setError('')
    const result = await onDelete(point.id)
    setSaving(false)
    if (result?.error) { setError(result.error); return }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-1100 flex items-end justify-center md:items-center" role="dialog" aria-modal="true"
      aria-label={isEditing ? 'แก้ไขผู้ได้รับผลกระทบ' : 'เพิ่มผู้ได้รับผลกระทบ'}>
      <button type="button" aria-label="ปิด" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/50" />
      <div className="relative flex max-h-[90vh] w-full flex-col rounded-t-3xl bg-white text-gray-800 shadow-2xl md:max-w-lg md:rounded-2xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
        <div className="flex shrink-0 items-start justify-between gap-2 px-4 pb-2 pt-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold">{isEditing ? 'แก้ไขผู้ได้รับผลกระทบ' : 'เพิ่มผู้ได้รับผลกระทบ'}</h2>
            <p className="truncate text-[11px] text-gray-400">รอบ {zone.label}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
          <p className="flex gap-2 rounded-xl bg-violet-50 px-3 py-2 text-[11px] leading-relaxed text-violet-900">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>{AFFECTED_NOTICE}</span>
          </p>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-500">ชนิด *</p>
            <div className="flex flex-wrap gap-1.5">
              {AFFECTED_KINDS.map(k => (
                <button key={k.value} type="button" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}
                  className={`min-h-10 rounded-full border px-3.5 text-xs font-semibold active:scale-95 ${kind === k.value ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                  {k.emoji} {k.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-500">ตำแหน่ง *</p>
            <button type="button" onClick={openMapPicker}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 text-xs font-bold text-gray-700 active:scale-95">
              <MapPin size={14} /> {position ? 'ปักหมุดใหม่บนแผนที่' : 'ปักหมุดบนแผนที่'}
            </button>
            <p className={`mt-1.5 text-[11px] ${position ? 'text-emerald-700' : 'text-gray-400'}`}>
              {position
                ? `✓ ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}${ring ? (ring.radius != null ? ` · อยู่ในวง ${formatRadius(ring.radius)}` : ' · อยู่นอกวงที่กำหนด') : ''}`
                : 'ยังไม่ได้เลือกตำแหน่ง'}
            </p>
          </div>

          <div>
            <label htmlFor="adhoc-affected-note" className="mb-1.5 block text-xs font-semibold text-gray-500">หมายเหตุสั้น (ไม่บังคับ)</label>
            <textarea id="adhoc-affected-note" value={note} rows={2} onChange={e => setNote(e.target.value)}
              aria-invalid={Boolean(noteProblem)} aria-describedby="adhoc-affected-note-hint"
              className={`${inputCls} resize-none`} placeholder="เช่น ผู้สูงอายุ ได้กลิ่นช่วงเช้า" />
            <p id="adhoc-affected-note-hint" className={`mt-1 text-[11px] leading-relaxed ${noteProblem ? 'text-red-600' : 'text-gray-400'}`}
              role={noteProblem ? 'alert' : undefined}>
              {noteProblem ?? `${Array.from(note).length}/${AFFECTED_NOTE_MAX} ตัวอักษร · ห้ามใส่ชื่อ เบอร์โทร หรือเลขบัตร`}
            </p>
          </div>

          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>

        <div className="shrink-0 space-y-2 border-t border-gray-100 px-4 pt-3">
          <button type="button" onClick={submit} disabled={!canSave}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-800 text-sm font-semibold text-white disabled:opacity-50 active:scale-[0.98]">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isEditing ? 'บันทึกการแก้ไข' : 'บันทึกผู้ได้รับผลกระทบ'}
          </button>
          {isEditing && (
            <button type="button" onClick={remove} disabled={saving}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white text-xs font-bold text-red-600 disabled:opacity-50 active:scale-95">
              <Trash2 size={13} /> ลบจุดนี้
            </button>
          )}
        </div>
      </div>

      {showMapPicker && PickerComp && (
        <PickerComp
          initialPos={position}
          fallbackPos={origin ?? (tenant?.latitude && tenant?.longitude ? { lat: tenant.latitude, lng: tenant.longitude } : null)}
          skipGeolocation
          onConfirm={handleMapConfirm}
          onClose={() => setShowMapPicker(false)}
        />
      )}
    </div>
  )
}
