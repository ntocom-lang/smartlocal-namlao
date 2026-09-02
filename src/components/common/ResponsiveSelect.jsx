import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Check, ChevronDown } from 'lucide-react'

/**
 * ResponsiveSelect
 * ดรอปดาวน์ที่ปรับแต่งให้เหมาะกับขนาดหน้าจอ:
 * - Desktop (md ขึ้นไป): แสดงเป็น <select> มาตรฐาน รวดเร็ว เข้าถึงง่าย รองรับ Playwright อัตโนมัติ
 * - Mobile (< md): แสดงเป็น Bottom Sheet ลอยผ่าน createPortal ระดับ z-[9999] ป้องกันปุ่มอื่นลอยทับ
 *   พร้อมช่องค้นหา, การเว้นช่องว่างที่สบายตา (padding/safe area), และป้องกันข้อความล้นตกขอบ (กันเกิน)
 */
export default function ResponsiveSelect({
  value,
  onChange,
  options = [],
  placeholder = '— เลือก —',
  modalTitle,
  searchPlaceholder = 'ค้นหา...',
  disabled = false,
  className = '',
  name,
  id,
  required = false,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectRef = useRef(null)
  const searchInputRef = useRef(null)

  // ดึง option ที่ถูกเลือกอยู่ในปัจจุบัน
  const selectedOpt = useMemo(() => {
    if (value === undefined || value === null || value === '') return null
    return options.find(o => String(o.value) === String(value)) ?? null
  }, [options, value])

  // กรองรายการตามคำค้นหา (ค้นหาทั้ง title, label, subtitle, badge)
  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(opt => {
      const matchLabel = (opt.label || '').toLowerCase().includes(q)
      const matchTitle = (opt.title || '').toLowerCase().includes(q)
      const matchSub = (opt.subtitle || '').toLowerCase().includes(q)
      const matchBadge = (opt.badge || '').toLowerCase().includes(q)
      return matchLabel || matchTitle || matchSub || matchBadge
    })
  }, [options, search])

  // เมื่อเปิด sheet บนมือถือ ให้ล็อกการเลื่อนของพื้นหลัง และ focus ช่องค้นหา
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      const timer = setTimeout(() => {
        searchInputRef.current?.focus()
      }, 150)
      return () => {
        clearTimeout(timer)
        document.body.style.overflow = originalOverflow
      }
    } else {
      setSearch('')
    }
  }, [isOpen])

  // รองรับการกด ESC เพื่อปิด Bottom Sheet
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  function handleSelect(optValue) {
    if (disabled) return
    if (selectRef.current) {
      selectRef.current.value = optValue
    }
    if (onChange) {
      onChange({ target: { value: optValue, name } })
    }
    setIsOpen(false)
  }

  function handleNativeChange(e) {
    if (onChange) {
      onChange(e)
    }
  }

  const sheetTitle = modalTitle || placeholder.replace(/^[—\-\s]+|[—\-\s]+$/g, '') || 'เลือกรายการ'

  return (
    <div className="relative w-full">
      {/* ── Desktop: Native <select> (Visible on md and up) ── */}
      <select
        ref={selectRef}
        id={id}
        name={name}
        value={value ?? ''}
        onChange={handleNativeChange}
        disabled={disabled}
        required={required}
        className={`hidden md:block w-full px-3 py-2.5 text-xs md:text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer ${
          disabled ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''
        } ${className}`}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label ?? opt.title}
          </option>
        ))}
      </select>

      {/* ── Mobile Trigger Button (Visible on mobile < md) ── */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(true)}
        className={`md:hidden w-full px-3.5 py-2.5 text-xs text-left bg-white border border-gray-200 rounded-xl flex items-center justify-between gap-2 transition-all cursor-pointer ${
          disabled
            ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
            : 'active:bg-gray-50 hover:border-gray-300'
        } ${className}`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`truncate ${selectedOpt ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
            {selectedOpt ? (selectedOpt.title || selectedOpt.label) : placeholder}
          </span>
          {selectedOpt?.badge && (
            <span className="shrink-0 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium border border-blue-100">
              {selectedOpt.badge}
            </span>
          )}
        </div>
        <ChevronDown size={15} className="text-gray-400 shrink-0" />
      </button>

      {/* ── Hidden select on mobile for form accessibility / DOM query fallback ── */}
      <select
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? ''}
        onChange={() => {}}
        className="md:hidden sr-only pointer-events-none"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label ?? opt.title}
          </option>
        ))}
      </select>

      {/* ── Mobile Bottom Sheet (Portal ไปที่ document.body ลอยเหนือทุกปุ่มและไม่ถูก Modal ดัก) ── */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 backdrop-blur-xs p-0 animate-fade-in"
          style={{ overscrollBehavior: 'contain' }}
        >
          {/* Backdrop แตะเพื่อปิด */}
          <div
            className="absolute inset-0"
            onClick={() => setIsOpen(false)}
            aria-label="ปิดหน้าต่างตัวเลือก"
          />

          {/* Sheet Container: ปรับความสูงไม่เกิน 75vh เพื่อให้เห็นบริบทพื้นหลังด้านบนและไม่ชนขอบบน */}
          <div
            className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[75vh] animate-slide-up z-10 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Grab handle indicator ด้านบน */}
            <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mt-3 mb-1 shrink-0" />

            {/* Sheet Header: ล็อกด้านบนเสมอ (sticky/shrink-0) ไม่ถูกเลื่อนหาย */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white shrink-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <h3 className="text-sm font-black text-gray-800 truncate">
                  {sheetTitle}
                </h3>
                <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold shrink-0 border border-blue-100">
                  {filteredOptions.length} รายการ
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 -mr-1 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search Input: ล็อกด้านบนและเว้นระยะอย่างเหมาะสม */}
            {options.length > 4 && (
              <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/70 shrink-0">
                <div className="relative">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Options List: เว้นช่องว่างขอบข้าง และเว้นด้านล่าง (pb-28) ป้องกันปุ่มอื่นหรือขอบจอด้านล่างบัง */}
            <div
              className="overflow-y-auto px-4 py-3 space-y-2 flex-1 overscroll-contain"
              style={{
                paddingBottom: 'max(7rem, env(safe-area-inset-bottom, 2.5rem))',
              }}
            >
              {/* ตัวเลือกเริ่มต้น / ล้างค่า (ถ้ามี placeholder และไม่ได้ค้นหา) */}
              {placeholder && !search && (
                <button
                  type="button"
                  onClick={() => handleSelect('')}
                  className={`w-full text-left px-4 py-3 rounded-2xl text-xs flex items-center justify-between border transition-all ${
                    !value
                      ? 'bg-blue-50/80 border-blue-200 text-blue-800 font-bold'
                      : 'bg-gray-50/50 border-gray-200 text-gray-500 hover:bg-gray-100/70'
                  }`}
                >
                  <span className="font-medium">{placeholder}</span>
                  {!value && (
                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
                      <Check size={12} strokeWidth={2.5} />
                    </div>
                  )}
                </button>
              )}

              {filteredOptions.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-400">
                  <p>ไม่พบข้อมูลที่ตรงกับ <span className="font-semibold text-gray-600">"{search}"</span></p>
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="mt-2 text-blue-600 font-medium underline text-[11px]"
                  >
                    ล้างคำค้นหา
                  </button>
                </div>
              ) : (
                filteredOptions.map(opt => {
                  const isSelected = String(opt.value) === String(value)
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => handleSelect(opt.value)}
                      className={`w-full text-left p-3.5 rounded-2xl text-xs flex items-center justify-between gap-3 border transition-all ${
                        isSelected
                          ? 'bg-blue-50/90 border-blue-300 text-blue-950 font-bold shadow-xs'
                          : 'bg-white border-gray-150 hover:border-gray-300 hover:bg-blue-50/30 active:bg-gray-100 text-gray-800'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[13px] leading-snug break-words ${
                              isSelected ? 'font-bold text-blue-900' : 'font-semibold text-gray-800'
                            }`}
                          >
                            {opt.title || opt.label}
                          </span>
                          {opt.badge && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-gray-100 text-gray-700 border border-gray-200 shrink-0">
                              {opt.badge}
                            </span>
                          )}
                          {opt.warning && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                              {opt.warning}
                            </span>
                          )}
                        </div>
                        {opt.subtitle && (
                          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2 break-words font-normal">
                            {opt.subtitle}
                          </p>
                        )}
                      </div>
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                          <Check size={12} strokeWidth={2.5} />
                        </div>
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-gray-300 shrink-0" />
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
