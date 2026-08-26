import { Check, X, Loader2, RotateCcw } from 'lucide-react'
import { ICON_PALETTE } from '../../lib/dataCenterGroupIcon'

// ตัวเลือกไอคอนของกลุ่มหลัก/ประเภทย่อยในศูนย์ข้อมูลดิจิทัล — ใช้ร่วมกันทั้งหน้า "จัดการหมวดหมู่"
// (ธีมสว่างปกติ) และ popover บนหัวข้อหน้ารายการ (ธีมไซเบอร์เข้ม) เพื่อไม่ให้ 2 ที่มีชุดอิโมจิคนละชุดอีก
//
// value ว่าง = ใช้ไอคอนอัตโนมัติ (ลบ override ทิ้ง) — ปุ่ม "อัตโนมัติ" ตั้ง value เป็น '' ให้
// autoEmoji = ไอคอนที่ระบบจะเลือกให้ถ้าไม่ตั้งเอง ต้องส่งมาด้วยเสมอ เพราะตอนกด "อัตโนมัติ" ช่องจะว่าง
// ถ้าไม่โชว์ตัวอย่างไว้ ผู้ใช้จะไม่รู้ว่ากดแล้วได้อะไรและนึกว่าปุ่มไม่ทำงาน
export default function GroupIconPicker({
  value, saving, onChange, onConfirm, onCancel, autoEmoji = '📍', isLight = true, className = '',
}) {
  const isAuto = !value.trim()
  const inputCls = isLight
    ? 'border-slate-300 bg-white text-slate-800 focus:ring-blue-200'
    : 'border-cyan-500/30 bg-slate-900 text-white focus:ring-cyan-500/30'
  const labelCls = isLight ? 'text-slate-400' : 'text-cyan-200/50'
  const cellBase = 'w-8 h-8 rounded-lg border text-base leading-none flex items-center justify-center transition-colors'
  const cellIdle = isLight
    ? 'border-transparent hover:bg-blue-50 hover:border-blue-200'
    : 'border-transparent hover:bg-cyan-500/15 hover:border-cyan-500/40'
  const cellActive = isLight
    ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200'
    : 'border-cyan-400 bg-cyan-500/20 ring-2 ring-cyan-500/30'

  return (
    <div className={`mt-2 ${className}`}>
      <div className="flex items-center gap-1.5">
        {/* ช่องนี้เป็น "ตัวอย่างไอคอนที่จะบันทึก" ในตัว — โหมดอัตโนมัติจะโชว์ autoEmoji แบบจางๆ
            ให้เห็นว่าจะได้อะไร แทนที่จะเป็นช่องว่างเปล่าที่ดูเหมือนปุ่มไม่ทำงาน */}
        <div className="relative shrink-0 w-16">
          <input value={value} maxLength={8} onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel() }}
            aria-label="อิโมจิที่เลือก (พิมพ์หรือวางเองก็ได้)"
            className={`w-full border rounded-lg px-2 py-1 text-lg text-center focus:outline-none focus:ring-2 ${inputCls}`} />
          {isAuto && (
            <span aria-hidden className="absolute inset-0 flex items-center justify-center text-lg opacity-40 pointer-events-none">
              {autoEmoji}
            </span>
          )}
        </div>
        <button type="button" onClick={() => onChange('')}
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${
            isAuto
              ? (isLight ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-cyan-400 bg-cyan-500/20 text-cyan-200')
              : (isLight ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-cyan-500/30 text-cyan-200/80 hover:bg-cyan-500/10')
          }`}>
          <RotateCcw size={11} /> อัตโนมัติ
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onConfirm} disabled={saving}
          className="shrink-0 p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50" aria-label="บันทึกไอคอน">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          className={`shrink-0 p-1.5 rounded-lg ${isLight ? 'hover:bg-slate-100 text-slate-400' : 'hover:bg-slate-700 text-slate-400'}`} aria-label="ยกเลิก">
          <X size={13} />
        </button>
      </div>

      <p className={`text-[10px] mt-1.5 ${labelCls}`}>
        {isAuto
          ? <>โหมดอัตโนมัติ — ระบบจะใช้ <span className="text-sm align-middle">{autoEmoji}</span> ตามชื่อหมวด · กด ✓ เพื่อบันทึก</>
          : <>เลือก <span className="text-sm align-middle">{value}</span> อยู่ · กด ✓ เพื่อบันทึก (ยังไม่บันทึกจนกว่าจะกด)</>}
      </p>

      <div className={`mt-1.5 max-h-52 overflow-y-auto rounded-xl border p-2 ${
        isLight ? 'border-slate-200 bg-slate-50/60' : 'border-cyan-500/20 bg-slate-900/60'
      }`}>
        {ICON_PALETTE.map(section => (
          <div key={section.label} className="mb-2 last:mb-0">
            <p className={`text-[10px] font-bold mb-1 ${labelCls}`}>{section.label}</p>
            <div className="flex flex-wrap gap-1">
              {section.emojis.map(emoji => (
                <button key={emoji} type="button" onClick={() => onChange(emoji)} title={emoji}
                  className={`${cellBase} ${value === emoji ? cellActive : cellIdle}`}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
