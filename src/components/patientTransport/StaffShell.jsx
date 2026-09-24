import { useEffect } from 'react'
import { Printer, RefreshCw, Search, X } from 'lucide-react'

/**
 * โครงหน้าทำงานของโมดูลรถรับ-ส่งผู้ป่วย — ใช้รูปแบบเดียวกับ "คำร้อง" และ "ยานพาหนะ"
 *
 * เจ้าหน้าที่ใช้สองโมดูลนั้นทุกวัน การให้โมดูลนี้มีภาษาหน้าจอของตัวเองทำให้ต้องเรียนใหม่ทั้งชุด
 * (เมนูปุ่มกลมซ้อนกันหลายชั้น ไม่มีช่องค้นหา ไม่มีจำนวนรายการ เปิดเรื่องแล้วสลับทั้งหน้า)
 * ไฟล์นี้จึงคัดโครงมาจาก FleetPage.jsx (แถบแท็บ) และ ComplaintsManager.jsx (กล่องรายการ + แผ่นลอยทับ)
 * ถ้าสองโมดูลนั้นเปลี่ยนรูปแบบ ให้ตามมาแก้ที่นี่ด้วย
 */

// แถบแท็บขีดเส้นใต้ + ไอคอน — คัดจาก TabBar ของ FleetPage.jsx
export function TabBar({ tab, setTab, tabs, highlight, busy }) {
  return <nav className="mb-4 flex items-center overflow-x-auto border-b border-gray-200 bg-white" style={{ scrollbarWidth: 'none' }} aria-label="งานรถรับส่งผู้ป่วย">
    {tabs.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={tab === id} disabled={busy}
      data-help-highlight={highlight === id ? 'true' : undefined}
      className={`flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-bold transition-colors disabled:opacity-50 ${highlight === id ? 'ring-4 ring-amber-400 ring-offset-2' : ''}`}
      style={{ borderColor: tab === id ? 'var(--color-primary)' : 'transparent', color: tab === id ? 'var(--color-primary)' : '#9ca3af' }}
      onClick={() => setTab(id)}>
      <Icon size={14} />{label}
    </button>)}
  </nav>
}

// กล่องรายการ: หัวแถบกรมท่าบอกจำนวน + แถบเครื่องมือ (ค้นหา/ปุ่มหลัก) + ป้ายกรอง — คัดจาก ComplaintsManager.jsx
export function ListCard({ title, count, search, onSearch, searchLabel = 'ค้นหา', action, pills, children }) {
  return <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:rounded-none">
    <div className="hidden items-center justify-between border-b border-gray-200 px-5 py-2.5 md:flex" style={{ backgroundColor: '#1a3a5c' }}>
      <h2 className="text-[13px] font-bold tracking-wide text-white">{title}</h2>
      <span className="rounded px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}>{count} รายการ</span>
    </div>
    {(onSearch || action || pills) && <div className="space-y-3.5 border-b border-gray-200 px-4 py-4 sm:px-5 md:bg-[#f5f8fc]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="w-full shrink-0 font-semibold text-gray-700 md:hidden">{title} ({count})</h2>
        {onSearch && <div className="relative min-w-0 flex-1 basis-0 md:max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => onSearch(e.target.value)} placeholder={`${searchLabel}...`} aria-label={searchLabel} maxLength={100}
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900" />
        </div>}
        {action}
      </div>
      {pills}
    </div>}
    {children}
  </section>
}

// ป้ายกรองพร้อมจุดสีและจำนวน — รูปแบบเดียวกับแท็บสถานะของคำร้อง
export function Pills({ value, onChange, items, label }) {
  return <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={label}>
    {items.map(({ id, label: text, count, color }) => {
      const active = value === id
      return <button key={id} type="button" aria-pressed={active} onClick={() => onChange(id)}
        className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'border-transparent text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
        style={active ? { backgroundColor: 'var(--color-primary)' } : {}}>
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: active ? 'rgba(255,255,255,0.85)' : color || '#94a3b8' }} />
        {text}
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${active ? 'bg-white/25' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
      </button>
    })}
  </div>
}

// แผ่นรายละเอียดลอยทับ — ปิดแล้วกลับมาที่แถวเดิมทันที ไม่สลับทั้งหน้า (กติกาเดียวกับคำร้อง)
// onReload: ปุ่มโหลดข้อมูลล่าสุดของหน้าอยู่หลังแผ่น กดไม่ถึง แผ่นที่มีช่องกรอกจึงต้องมีปุ่มของตัวเอง
// (ร่างที่กรอกค้างไว้ต้องอยู่รอดเมื่อโหลดข้อมูลใหม่ ระบบถึงจะเตือนได้ว่ามีคนแก้ค่าระหว่างที่กรอก)
// onPrint = ปุ่ม "พิมพ์" บนหัวแผ่น ข้างปุ่มโหลดใหม่ — ส่งมาเฉพาะแผ่นที่มีเอกสารให้พิมพ์จริง
// มีป้ายคำว่า "พิมพ์" ไม่ใช่ไอคอนเปล่า เพราะเจ้าหน้าที่หลายคนไม่รู้จักรูปเครื่องพิมพ์ (ปุ่มกลมอีก 2 ปุ่มเป็นสัญลักษณ์ที่ใช้กันทั่วไป)
export function Sheet({ title, subtitle, onClose, onReload, onPrint, printLabel = 'พิมพ์', busy, wide, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="fixed inset-0 z-60 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
    <div className={`relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}>
      <div className="relative shrink-0 px-5 pb-5 pt-6" style={{ background: 'linear-gradient(135deg,#1a3a5c,#2d5f8a)' }}>
        <div className="absolute right-4 top-4 flex items-center gap-2">
          {onPrint && <button type="button" onClick={onPrint} disabled={busy} aria-label={printLabel} title={printLabel}
            className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-bold text-gray-700 shadow-lg transition-transform hover:bg-gray-100 active:scale-95 disabled:opacity-50">
            <Printer size={17} strokeWidth={2.5} aria-hidden="true" />พิมพ์
          </button>}
          {onReload && <button type="button" onClick={onReload} disabled={busy} aria-label="โหลดข้อมูลล่าสุด" title="โหลดข้อมูลล่าสุด"
            className="flex size-9 items-center justify-center rounded-full bg-white shadow-lg transition-transform hover:bg-gray-100 active:scale-95 disabled:opacity-50">
            <RefreshCw size={17} className={`text-gray-700 ${busy ? 'animate-spin' : ''}`} strokeWidth={2.5} />
          </button>}
          <button type="button" onClick={onClose} aria-label="ปิด"
            className="flex size-9 items-center justify-center rounded-full bg-white shadow-lg transition-transform hover:bg-gray-100 active:scale-95">
            <X size={20} className="text-gray-700" strokeWidth={2.5} />
          </button>
        </div>
        <div className={onPrint ? (onReload ? 'pr-44' : 'pr-32') : onReload ? 'pr-24' : 'pr-12'}>
          {subtitle && <p className="text-xs font-medium text-white/70">{subtitle}</p>}
          <h3 className="mt-0.5 text-base font-bold leading-tight text-white">{title}</h3>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">{children}</div>
    </div>
  </div>
}
