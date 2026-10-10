import { useEffect, useRef, useState } from 'react'
import { Check, Plus, Search, X } from 'lucide-react'
import { filterOptions, findOption, normalizeName, tidyName } from '../../lib/dataCenterPicker'

// แผ่นค้นหา/เลือกกลุ่มหลักหรือประเภทย่อย — ใช้เมื่อตัวเลือกมีมากเกินกว่าจะวางเป็นปุ่มทั้งหมด (ดู dataCenterPicker.js)
// มือถือเป็นแผ่นเลื่อนขึ้นจากล่าง เดสก์ท็อปเป็นกล่องกลางจอ ความสูงจำกัดและเลื่อนในตัวเอง
// จึงไม่ว่ามีตัวเลือกกี่สิบกี่ร้อยตัวก็ไม่ดันส่วนอื่นของฟอร์มลงไป
//
// การสร้างชื่อใหม่ทำที่นี่ที่เดียว: พิมพ์ชื่อที่ไม่มีในรายการ → ขึ้นแถว "+ สร้าง ..." ส่วนชื่อที่ซ้ำของเดิม
// (ไม่สนช่องว่าง/ตัวพิมพ์) จะไม่มีแถวสร้าง ให้เลือกของเดิมแทน เพื่อไม่ให้เกิดหมวดซ้ำจากการพิมพ์เพี้ยนเล็กน้อย

// รายการที่วาดสูงสุด — กันหน้าค้างถ้าวันหนึ่งมีตัวเลือกเป็นพัน ผู้ใช้พิมพ์ค้นหาเพื่อกรองต่อได้เสมอ
const MAX_ROWS = 200

export default function OptionPickerSheet({ title, options, selected, onPick, onClose, createLabel, emptyHint }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    // เดสก์ท็อปโฟกัสช่องค้นหาให้พิมพ์ได้ทันที — มือถือไม่โฟกัสเอง เพราะคีย์บอร์ดจะบังรายการเกือบหมดจอ
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasQuery = normalizeName(query) !== ''
  const exact = hasQuery ? findOption(options, query) : null
  const filtered = hasQuery ? filterOptions(options, query) : options
  const rows = filtered.slice(0, MAX_ROWS)
  const newName = tidyName(query)
  const canCreate = Boolean(createLabel) && hasQuery && !exact
  const selectedKey = normalizeName(selected)

  // Enter: ตรงตัวเป๊ะ → เลือกของเดิม · เหลือตัวเดียวจากการค้นหา → เลือกตัวนั้น · นอกนั้น → สร้างใหม่
  // (พิมพ์ "ร้าน" ที่มี "ร้านอาหาร" ตัวเดียว คนส่วนใหญ่ตั้งใจเลือกของเดิม จึงไม่สร้างใหม่ทับ — อยากสร้างจริงให้กดแถว "+ สร้าง")
  function submitFromKeyboard() {
    if (exact) return onPick(exact.value)
    if (filtered.length === 1) return onPick(filtered[0].value)
    if (canCreate) return onPick(newName)
  }

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="ปิด" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/50 cursor-default" />
      <div className="relative flex w-full max-h-[80vh] flex-col rounded-t-3xl bg-white text-slate-800 shadow-2xl md:max-w-md md:rounded-2xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <p className="text-sm font-bold">{title}</p>
          <button type="button" onClick={onClose} aria-label="ปิด"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={inputRef} type="text" value={query} inputMode="search" enterKeyHint="done"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitFromKeyboard() } }}
              placeholder={createLabel ? `ค้นหา หรือพิมพ์ชื่อ${createLabel}` : 'ค้นหา'}
              aria-label={`ค้นหา${title}`}
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-slate-400">
            {hasQuery ? `พบ ${filtered.length} จาก ${options.length} รายการ` : `ทั้งหมด ${options.length} รายการ · เรียงตามที่ใช้บ่อยสุด`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-1 space-y-1">
          {canCreate && (
            <button type="button" onClick={() => onPick(newName)}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50 px-3 py-2 text-left text-sm font-semibold text-blue-700 active:scale-[0.99]">
              <Plus size={15} className="shrink-0" />
              <span className="break-words">สร้าง “{newName}” เป็น{createLabel}</span>
            </button>
          )}

          {rows.map(o => {
            const isSelected = normalizeName(o.value) === selectedKey
            return (
              <button key={o.value} type="button" aria-pressed={isSelected} onClick={() => onPick(o.value)}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                  isSelected ? 'border-blue-600 bg-blue-600 font-bold text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}>
                <span className="flex min-w-0 items-center gap-1.5">
                  {isSelected && <Check size={14} className="shrink-0" />}
                  <span className="break-words">{o.value}</span>
                </span>
                {o.count > 0 && (
                  <span className={`shrink-0 font-mono text-xs ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>{o.count}</span>
                )}
              </button>
            )
          })}

          {filtered.length > MAX_ROWS && (
            <p className="px-1 py-2 text-center text-[11px] text-slate-400">แสดง {MAX_ROWS} รายการแรก พิมพ์ค้นหาเพื่อกรองให้แคบลง</p>
          )}
          {filtered.length === 0 && !canCreate && (
            <p className="px-1 py-6 text-center text-xs text-slate-400">
              {hasQuery ? 'ไม่พบรายการที่ตรงกับคำค้น' : (emptyHint ?? (createLabel ? `ยังไม่มีรายการ พิมพ์ชื่อเพื่อสร้าง${createLabel}แรก` : 'ยังไม่มีรายการ'))}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
