import { useMemo, useState } from 'react'
import { Loader2, MapPin, X, Plus, Search, Trash2 } from 'lucide-react'
import { categoryNameOf } from '../../lib/complaintCategoryLabels.js'
import {
  DEFAULT_RADII_M, QUICK_RADII_M, MAX_RINGS, MIN_RADIUS_M, MAX_RADIUS_M,
  kmToMeters, normalizeRadii, formatRadius, ringColor, validZoneCoords, ZONE_DISCLAIMER,
} from '../../lib/adhocZones'
import { normalizeName } from '../../lib/dataCenterPicker'
import OptionPickerSheet from './OptionPickerSheet'

// ฟอร์มเพิ่ม/แก้ "จุดต้นทาง + วงรัศมี" ของเรื่องเฉพาะกิจ (เช่น ฟาร์มที่ถูกร้องเรียนเรื่องกลิ่น)
//
// จุดต้นทางได้ 2 ทาง: เลือกจากสถานที่ที่ลงไว้ในศูนย์ข้อมูลแล้ว (ไม่ต้องกรอกซ้ำ) หรือปักหมุดเอง
// ทั้งสองทางคัดลอกพิกัดมาเก็บในตารางวงรัศมีเอง — ไม่แก้/ไม่เผยแพร่สถานที่ในศูนย์ข้อมูล (ซึ่งประชาชนเห็นได้)
// ที่ถูกวางวงรัศมีนี้ จึงไม่มีทางที่ฟาร์มในแผนที่สาธารณะจะถูกติดป้ายว่าอยู่ระหว่างตรวจสอบ
//
// ⚠️ ชื่อที่แสดง (label) ต้องเป็นกลาง — ฟอร์มเตือนผู้กรอกตรงช่อง และ audit log เก็บชื่อนี้ไว้ทุกครั้งที่แก้
// z-1100: อยู่เหนือแผงสรุปแบบ bottom sheet ของแผนที่มือถือ (z-1001) · ตัวปักหมุด (LeafletMapPicker) เป็น z-9999 อยู่เหนือเสมอ

const Z_FORM = 'z-1100'
const Z_PICKER = 'z-1200'
const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200'

const isFarmish = e => /ฟาร์ม|เลี้ยง|โรงงาน|โรงเรือน/.test(`${e.name} ${e.category} ${e.group}`)

export default function AdhocZoneForm({ zone, categories, entries, tenant, canDelete, onSave, onDelete, onSetActive, onClose }) {
  const isEditing = Boolean(zone)
  const [category, setCategory] = useState(zone?.category ?? categories[0]?.value ?? '')
  const [label, setLabel] = useState(zone?.label ?? '')
  const [sourceEntryId, setSourceEntryId] = useState(zone?.source_entry_id ?? null)
  const [position, setPosition] = useState(() => (zone ? validZoneCoords(zone.latitude, zone.longitude) : null))
  const [radii, setRadii] = useState(() => normalizeRadii(zone?.radii_m ?? DEFAULT_RADII_M))
  const [customKm, setCustomKm] = useState('')
  const [customError, setCustomError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showEntryPicker, setShowEntryPicker] = useState(false)
  const [PickerComp, setPickerComp] = useState(null)
  const [showMapPicker, setShowMapPicker] = useState(false)

  const labels = useMemo(() => Object.fromEntries(categories.map(c => [c.value, c.label])), [categories])

  // ตัวเลือกสถานที่จากศูนย์ข้อมูล — ที่ดูเป็นฟาร์ม/โรงเรือนขึ้นก่อน แล้วเรียงตามชื่อ · ชื่อซ้ำเติมประเภทต่อท้าย กันเลือกผิดตัว
  const entryOptions = useMemo(() => {
    const sorted = [...entries].sort((a, b) => (isFarmish(b) - isFarmish(a)) || a.name.localeCompare(b.name, 'th'))
    const seen = new Map()
    const options = sorted.map(entry => {
      const base = entry.name
      const n = (seen.get(normalizeName(base)) ?? 0) + 1
      seen.set(normalizeName(base), n)
      return { entry, value: n === 1 ? base : `${base} (${entry.category}${n > 2 ? ` ${n}` : ''})` }
    })
    return options
  }, [entries])

  const sourceEntry = entries.find(e => e.id === sourceEntryId) ?? null
  const canSave = Boolean(category) && label.trim().length > 0 && position && radii.length > 0 && !saving

  function pickEntry(value) {
    const option = entryOptions.find(o => o.value === value)
    if (!option) return
    const coords = validZoneCoords(option.entry.lat, option.entry.lng)
    if (!coords) { setError('สถานที่นี้พิกัดไม่ถูกต้อง เลือกอันอื่นหรือปักหมุดเอง'); return }
    setSourceEntryId(option.entry.id)
    setPosition(coords)
    // ชื่อที่แสดงตั้งต้นจากชื่อสถานที่ — แก้ได้ · ไม่ทับชื่อที่ผู้ใช้พิมพ์ไว้เอง
    setLabel(prev => (prev.trim() ? prev : option.entry.name))
    setError('')
    setShowEntryPicker(false)
  }

  function openMapPicker() {
    if (PickerComp) { setShowMapPicker(true); return }
    import('../MapPicker').then(mod => { setPickerComp(() => mod.default); setShowMapPicker(true) })
  }

  function handleMapConfirm({ lat, lng }) {
    const coords = validZoneCoords(lat, lng)
    if (!coords) { setError('พิกัดที่ปักอยู่นอกประเทศไทย ลองปักใหม่'); setShowMapPicker(false); return }
    setPosition(coords)
    setSourceEntryId(null) // ปักเอง = ไม่ผูกกับสถานที่ในศูนย์ข้อมูลแล้ว
    setError('')
    setShowMapPicker(false)
  }

  function toggleQuick(meters) {
    setRadii(prev => (prev.includes(meters)
      ? prev.filter(r => r !== meters)
      : normalizeRadii([...prev, meters])))
  }

  function addCustom() {
    const meters = kmToMeters(customKm)
    if (meters == null) {
      setCustomError(`พิมพ์เป็นกิโลเมตร ตั้งแต่ ${MIN_RADIUS_M / 1000} ถึง ${MAX_RADIUS_M / 1000} เช่น 1.5`)
      return
    }
    if (radii.includes(meters)) { setCustomError('มีวงนี้อยู่แล้ว'); return }
    if (radii.length >= MAX_RINGS) { setCustomError(`ได้สูงสุด ${MAX_RINGS} วง ลบวงเดิมก่อน`); return }
    setRadii(prev => normalizeRadii([...prev, meters]))
    setCustomKm('')
    setCustomError('')
  }

  async function submit() {
    if (!canSave) return
    setSaving(true)
    setError('')
    const result = await onSave({
      category, label: label.trim(), latitude: position.lat, longitude: position.lng,
      radii_m: radii, source_entry_id: sourceEntryId,
    }, zone?.id ?? null)
    setSaving(false)
    if (result?.error) { setError(result.error); return }
    onClose()
  }

  async function run(action) {
    setSaving(true)
    setError('')
    const result = await action()
    setSaving(false)
    if (result?.error) { setError(result.error); return }
    onClose()
  }

  return (
    <div className={`fixed inset-0 ${Z_FORM} flex items-end justify-center md:items-center`} role="dialog" aria-modal="true"
      aria-label={isEditing ? 'แก้ไขจุดต้นทาง' : 'เพิ่มจุดต้นทาง'}>
      <button type="button" aria-label="ปิด" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/50" />
      <div className="relative flex max-h-[90vh] w-full flex-col rounded-t-3xl bg-white text-gray-800 shadow-2xl md:max-w-lg md:rounded-2xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-4">
          <h2 className="text-sm font-bold">{isEditing ? 'แก้ไขจุดต้นทาง' : 'เพิ่มจุดต้นทาง'}</h2>
          <button type="button" onClick={onClose} aria-label="ปิด"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
          {categories.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-3 text-xs text-amber-800">
              ยังไม่มีหมวดเรื่องเฉพาะกิจ — แอดมินต้องตั้งหมวดคำร้องเป็น “เฉพาะกิจ” ก่อน (เมนูประเภทคำร้อง)
            </p>
          ) : (
            <>
              {categories.length > 1 ? (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-gray-500">เรื่องเฉพาะกิจ</p>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map(c => (
                      <button key={c.value} type="button" aria-pressed={category === c.value} onClick={() => setCategory(c.value)}
                        className={`min-h-10 rounded-full border px-3.5 text-xs font-semibold ${category === c.value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                        {c.emoji ? `${c.emoji} ` : ''}{categoryNameOf(labels, c.value)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500">เรื่อง: <span className="font-bold text-gray-700">{categoryNameOf(labels, category)}</span></p>
              )}

              <div>
                <p className="mb-1.5 text-xs font-semibold text-gray-500">จุดต้นทาง *</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setShowEntryPicker(true)} disabled={entries.length === 0}
                    className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 text-xs font-bold text-gray-700 disabled:opacity-40 active:scale-95">
                    <Search size={14} /> เลือกจากศูนย์ข้อมูล
                  </button>
                  <button type="button" onClick={openMapPicker}
                    className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 text-xs font-bold text-gray-700 active:scale-95">
                    <MapPin size={14} /> ปักหมุดบนแผนที่
                  </button>
                </div>
                <p className={`mt-1.5 text-[11px] ${position ? 'text-emerald-700' : 'text-gray-400'}`}>
                  {position
                    ? `✓ ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}${sourceEntry ? ` · จากศูนย์ข้อมูล: ${sourceEntry.name}` : ' · ปักเอง'}`
                    : 'ยังไม่ได้เลือกจุด'}
                </p>
              </div>

              <div>
                <label htmlFor="adhoc-zone-label" className="mb-1.5 block text-xs font-semibold text-gray-500">ชื่อที่แสดง *</label>
                <input id="adhoc-zone-label" type="text" value={label} maxLength={120} onChange={e => setLabel(e.target.value)}
                  className={inputCls} placeholder="เช่น ฟาร์ม ก. (อยู่ระหว่างตรวจสอบ)" />
                <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                  ใช้ชื่อกลาง — ห้ามใส่ข้อความกล่าวหาหรือสรุปว่าเป็นต้นเหตุ ชื่อนี้ถูกบันทึกใน audit log
                </p>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold text-gray-500">รัศมี (เลือกได้หลายวง สูงสุด {MAX_RINGS})</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_RADII_M.map(m => {
                    const on = radii.includes(m)
                    return (
                      <button key={m} type="button" aria-pressed={on} onClick={() => toggleQuick(m)}
                        disabled={!on && radii.length >= MAX_RINGS}
                        className={`min-h-10 rounded-full border px-3.5 text-xs font-semibold disabled:opacity-40 ${on ? 'border-red-600 bg-red-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                        {formatRadius(m)}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2 flex gap-2">
                  <input type="text" inputMode="decimal" value={customKm} aria-label="กำหนดรัศมีเอง (กิโลเมตร)"
                    onChange={e => { setCustomKm(e.target.value); setCustomError('') }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
                    className={inputCls} placeholder="กำหนดเอง เป็น กม. เช่น 1.5" />
                  <button type="button" onClick={addCustom}
                    className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-sky-300 bg-sky-50 px-3 text-xs font-bold text-sky-700 active:scale-95">
                    <Plus size={14} /> เพิ่มวง
                  </button>
                </div>
                {customError && <p role="alert" className="mt-1 text-[11px] text-red-600">{customError}</p>}

                {radii.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="วงรัศมีที่เลือก">
                    {radii.map((r, i) => (
                      <li key={r} className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold"
                        style={{ borderColor: ringColor(i), color: ringColor(i), backgroundColor: `${ringColor(i)}14` }}>
                        {formatRadius(r)}
                        <button type="button" onClick={() => setRadii(prev => prev.filter(x => x !== r))} aria-label={`ลบวง ${formatRadius(r)}`}
                          className="flex h-6 w-6 items-center justify-center rounded-full active:scale-90"><X size={12} /></button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] text-red-600">ต้องมีอย่างน้อย 1 วง</p>
                )}
              </div>

              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                {ZONE_DISCLAIMER} · ทุกการเพิ่ม/แก้/ลบถูกบันทึกใน audit log
              </p>
            </>
          )}

          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>

        <div className="shrink-0 space-y-2 border-t border-gray-100 px-4 pt-3">
          <button type="button" onClick={submit} disabled={!canSave || categories.length === 0}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-800 text-sm font-semibold text-white disabled:opacity-50 active:scale-[0.98]">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isEditing ? 'บันทึกการแก้ไข' : 'บันทึกจุดต้นทาง'}
          </button>
          {isEditing && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={saving}
                onClick={() => run(() => onSetActive(zone.id, !zone.is_active))}
                className="min-h-11 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 disabled:opacity-50 active:scale-95">
                {zone.is_active ? 'ปิดเรื่อง (ซ่อนจากแผนที่ทุกคน)' : 'เปิดเรื่องอีกครั้ง'}
              </button>
              {canDelete && (
                <button type="button" disabled={saving}
                  onClick={() => { if (window.confirm(`ลบ “${zone.label}” และวงรัศมีทั้งหมดของจุดนี้? การลบนี้ย้อนกลับไม่ได้ (ยังมีบันทึกใน audit log)`)) run(() => onDelete(zone.id)) }}
                  className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white text-xs font-bold text-red-600 disabled:opacity-50 active:scale-95">
                  <Trash2 size={13} /> ลบจุดนี้
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showEntryPicker && (
        <OptionPickerSheet title="เลือกสถานที่จากศูนย์ข้อมูล" zClass={Z_PICKER}
          options={entryOptions.map(o => ({ value: o.value, count: 0 }))}
          selected={sourceEntry ? entryOptions.find(o => o.entry.id === sourceEntry.id)?.value : ''}
          emptyHint="ยังไม่มีสถานที่ในศูนย์ข้อมูล ใช้ปุ่ม “ปักหมุดบนแผนที่” แทน"
          onPick={pickEntry} onClose={() => setShowEntryPicker(false)} />
      )}

      {showMapPicker && PickerComp && (
        <PickerComp
          initialPos={position}
          fallbackPos={tenant?.latitude && tenant?.longitude ? { lat: tenant.latitude, lng: tenant.longitude } : null}
          skipGeolocation
          onConfirm={handleMapConfirm}
          onClose={() => setShowMapPicker(false)}
        />
      )}
    </div>
  )
}
