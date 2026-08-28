import { useRef, useState } from 'react'
import { Check, X, Loader2, RotateCcw, ImagePlus } from 'lucide-react'
import {
  ICON_PALETTE, ICON_UPLOAD_ACCEPT, ICON_IMAGE_MAX_PX,
  fileToIconDataUrl, isIconImage,
} from '../../lib/dataCenterGroupIcon'

// ตัวเลือกไอคอนของกลุ่มหลัก/ประเภทย่อยในศูนย์ข้อมูลดิจิทัล — ใช้ร่วมกันทั้งหน้า "จัดการหมวดหมู่"
// (ธีมสว่างปกติ) และ popover บนหัวข้อหน้ารายการ (ธีมไซเบอร์เข้ม) เพื่อไม่ให้ 2 ที่มีชุดอิโมจิคนละชุดอีก
//
// value ว่าง = ใช้ไอคอนอัตโนมัติ (ลบ override ทิ้ง) — ปุ่ม "อัตโนมัติ" ตั้ง value เป็น '' ให้
// autoEmoji = ไอคอนที่ระบบจะเลือกให้ถ้าไม่ตั้งเอง ต้องส่งมาด้วยเสมอ เพราะตอนกด "อัตโนมัติ" ช่องจะว่าง
// ถ้าไม่โชว์ตัวอย่างไว้ ผู้ใช้จะไม่รู้ว่ากดแล้วได้อะไรและนึกว่าปุ่มไม่ทำงาน
//
// value เป็นได้ 2 แบบ: อิโมจิ (ข้อความสั้น) หรือรูปที่แนบจากเครื่อง (data URL 64x64 ดู
// fileToIconDataUrl ใน src/lib/dataCenterGroupIcon.js) — โหมดรูปจะสลับช่องพิมพ์เป็น thumbnail
// เพราะ data URL ยาวเป็นหมื่นตัวอักษร ยัดใส่ช่อง maxLength=8 ไม่ได้และไม่มีประโยชน์ให้ผู้ใช้แก้มือ
export default function GroupIconPicker({
  value, saving, onChange, onConfirm, onCancel, autoEmoji = '📍', isLight = true, className = '',
}) {
  const fileInputRef = useRef(null)
  const [uploadError, setUploadError] = useState('')
  const [processing, setProcessing] = useState(false)

  const isImage = isIconImage(value)
  const isAuto = !isImage && !value.trim()
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
  const ghostBtn = isLight
    ? 'border-slate-200 text-slate-500 hover:bg-slate-50'
    : 'border-cyan-500/30 text-cyan-200/80 hover:bg-cyan-500/10'
  const activeBtn = isLight
    ? 'border-blue-400 bg-blue-50 text-blue-600'
    : 'border-cyan-400 bg-cyan-500/20 text-cyan-200'

  async function handlePickFile(e) {
    const file = e.target.files?.[0]
    // เคลียร์ค่า input เสมอ ไม่งั้นเลือกไฟล์ "ชื่อเดิม" ซ้ำครั้งที่สอง onChange จะไม่ยิง
    e.target.value = ''
    if (!file) return
    setUploadError('')
    setProcessing(true)
    try {
      onChange(await fileToIconDataUrl(file))
    } catch (err) {
      setUploadError(err?.message || 'แนบไฟล์ไม่สำเร็จ')
    } finally {
      setProcessing(false)
    }
  }

  function clearIcon() {
    onChange('')
    setUploadError('')
  }

  return (
    <div className={`mt-2 ${className}`}>
      <div className="flex items-center gap-1.5">
        {/* ช่องนี้เป็น "ตัวอย่างไอคอนที่จะบันทึก" ในตัว — โหมดอัตโนมัติจะโชว์ autoEmoji แบบจางๆ
            ให้เห็นว่าจะได้อะไร แทนที่จะเป็นช่องว่างเปล่าที่ดูเหมือนปุ่มไม่ทำงาน
            โหมดรูปแนบเปลี่ยนเป็น thumbnail + ปุ่มกากบาทเอารูปออก */}
        {isImage ? (
          <div className={`relative shrink-0 w-16 h-8.5 rounded-lg border flex items-center justify-center ${
            isLight ? 'border-slate-300 bg-white' : 'border-cyan-500/30 bg-slate-900'
          }`}>
            {/* 20px = ความสูง glyph อิโมจิของช่องพิมพ์ที่มันมาแทน (text-lg 18px + ส่วนล้นกล่อง em)
                ให้สลับไปมาระหว่างโหมดอิโมจิกับโหมดรูปแล้วขนาดไม่กระโดด */}
            <img src={value} alt="ไอคอนที่แนบไว้" className="w-5 h-5 object-contain" />
            <button type="button" onClick={clearIcon} aria-label="เอารูปที่แนบออก"
              className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full border flex items-center justify-center ${
                isLight ? 'bg-white border-slate-300 text-slate-500 hover:text-red-600' : 'bg-slate-800 border-cyan-500/40 text-cyan-200 hover:text-red-400'
              }`}>
              <X size={9} />
            </button>
          </div>
        ) : (
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
        )}
        <button type="button" onClick={clearIcon}
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${
            isAuto ? activeBtn : ghostBtn
          }`}>
          <RotateCcw size={11} /> อัตโนมัติ
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={processing || saving}
          title={`แนบไฟล์รูปจากเครื่อง (ย่อเป็น ${ICON_IMAGE_MAX_PX}x${ICON_IMAGE_MAX_PX} px อัตโนมัติ)`}
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-bold transition-colors disabled:opacity-50 ${
            isImage ? activeBtn : ghostBtn
          }`}>
          {processing ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />} แนบไฟล์
        </button>
        <input ref={fileInputRef} type="file" accept={ICON_UPLOAD_ACCEPT} onChange={handlePickFile} className="hidden" />
        <div className="flex-1" />
        <button type="button" onClick={onConfirm} disabled={saving || processing}
          className="shrink-0 p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50" aria-label="บันทึกไอคอน">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          className={`shrink-0 p-1.5 rounded-lg ${isLight ? 'hover:bg-slate-100 text-slate-400' : 'hover:bg-slate-700 text-slate-400'}`} aria-label="ยกเลิก">
          <X size={13} />
        </button>
      </div>

      {uploadError ? (
        <p className="text-[10px] mt-1.5 text-red-500 font-semibold">{uploadError}</p>
      ) : (
        <p className={`text-[10px] mt-1.5 ${labelCls}`}>
          {isImage
            ? <>ใช้รูปที่แนบไว้ (ย่อเป็น PNG {ICON_IMAGE_MAX_PX}x{ICON_IMAGE_MAX_PX} px แล้ว) · กด ✓ เพื่อบันทึก</>
            : isAuto
              ? <>โหมดอัตโนมัติ — ระบบจะใช้ <span className="text-sm align-middle">{autoEmoji}</span> ตามชื่อหมวด · กด ✓ เพื่อบันทึก</>
              : <>เลือก <span className="text-sm align-middle">{value}</span> อยู่ · กด ✓ เพื่อบันทึก (ยังไม่บันทึกจนกว่าจะกด)</>}
        </p>
      )}

      <div className={`mt-1.5 max-h-52 overflow-y-auto rounded-xl border p-2 ${
        isLight ? 'border-slate-200 bg-slate-50/60' : 'border-cyan-500/20 bg-slate-900/60'
      }`}>
        {ICON_PALETTE.map(section => (
          <div key={section.label} className="mb-2 last:mb-0">
            <p className={`text-[10px] font-bold mb-1 ${labelCls}`}>{section.label}</p>
            <div className="flex flex-wrap gap-1">
              {section.emojis.map(emoji => (
                <button key={emoji} type="button" onClick={() => { onChange(emoji); setUploadError('') }} title={emoji}
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
