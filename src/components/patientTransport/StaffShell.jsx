import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Printer, RefreshCw, Search, X } from 'lucide-react'
import { PAGE_SIZES, PAGE_SIZE_DEFAULT } from '../../lib/patientBooking'

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

// หัวกลุ่มของส่วน ใช้ทั้งตาราง (PC) และการ์ด (มือถือ) — เป็น span เพราะอยู่ใน h3 ได้
// toggle = ปุ่มพับ/แสดงของส่วนเสร็จแล้ว/ยกเลิก (ลูกศรซ่อนจากโปรแกรมอ่านจอ ชื่อปุ่มจึงเป็นคำล้วน)
// มือถือปุ่มลงบรรทัดใหม่เต็มความกว้างแบบปุ่มในการ์ด — ถ้าอยู่บรรทัดเดียวกัน ชื่อส่วนถูกบีบจนขึ้น 2 บรรทัดที่จอ 390px
export function SectionBand({ label, bar, tint, ink, count, rounded, toggle }) {
  return <span className={`flex flex-wrap items-center gap-2 px-3 text-sm font-bold ${toggle ? 'py-2 md:py-1' : 'py-2'} ${rounded ? 'rounded-xl' : ''}`} style={{ backgroundColor: tint, color: ink, borderLeft: `5px solid ${bar}` }}>
    <span className="whitespace-nowrap">{label}</span><span className="whitespace-nowrap rounded-full border bg-white px-2 py-0.5 text-xs" style={{ borderColor: bar }}>{count} รายการ</span>
    {toggle && <button type="button" aria-expanded={toggle.open} onClick={toggle.onToggle} className="ml-auto min-h-11 whitespace-nowrap rounded-xl border bg-white px-3 text-sm font-bold hover:bg-slate-50 max-md:w-full md:min-h-9" style={{ borderColor: bar, color: ink }}>
      {toggle.open ? 'ซ่อนรายการ' : 'แสดงรายการ'}<span aria-hidden="true"> {toggle.open ? '▴' : '▾'}</span></button>}
  </span>
}

// แถบแบ่งหน้าท้ายตาราง — หน้าตาเดียวกับแท็บคำร้อง (เลือกจำนวนต่อหน้า + ก่อนหน้า/เลขหน้า/ถัดไป) ใช้ร่วมกล่องคำขอรถและงานคนขับ
// ขึ้นเมื่อรายการเกินค่าตั้งต้น (20) เท่านั้น — เลือก "ทั้งหมด" แล้วแถบต้องยังอยู่ ไม่งั้นเปลี่ยนกลับไม่ได้ จึงวัดจาก total ไม่ใช่จำนวนหน้า
// การตัดหน้า (กรอบเที่ยวเดียวกันไม่ถูกตัดคร่อม) อยู่ที่ paginate() ใน lib/patientBooking.js · ปุ่มสูง 44px บนมือถือ
export function Pager({ total, from, to, page, pages, perPage, onPage, onPerPage }) {
  if (total <= PAGE_SIZE_DEFAULT) return null
  const numbers = Array.from({ length: pages }, (_, i) => i + 1)
    .filter(n => pages <= 7 || n === 1 || n === pages || Math.abs(n - page) <= 1)
    .reduce((out, n, i, all) => (i > 0 && n - all[i - 1] > 1 ? [...out, '…', n] : [...out, n]), [])
  const button = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 md:min-h-9 md:min-w-9'
  return <nav aria-label="แบ่งหน้ารายการ" className="flex flex-col items-center justify-between gap-3 border-t border-gray-200 pt-4 sm:flex-row">
    <label className="flex flex-wrap items-center justify-center gap-2 text-xs text-gray-500">แสดง
      <select aria-label="จำนวนรายการต่อหน้า" value={perPage} onChange={e => onPerPage(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        className="min-h-11 rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 md:min-h-9">
        {PAGE_SIZES.map(n => <option key={n} value={n}>{n} รายการ</option>)}<option value="all">ทั้งหมด</option>
      </select>
      <span className="text-gray-400">({from}–{to} จาก {total})</span>
    </label>
    {pages > 1 && <div className="flex flex-wrap items-center justify-center gap-1.5">
      <button type="button" className={button} aria-label="หน้าก่อนหน้า" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
      {numbers.map((n, i) => n === '…' ? <span key={`gap-${i}`} className="px-1 text-gray-400" aria-hidden="true">…</span>
        : <button key={n} type="button" className={`${button} ${n === page ? '!border-transparent !bg-[#1a3a5c] !text-white' : ''}`} aria-label={`หน้า ${n}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>)}
      <button type="button" className={button} aria-label="หน้าถัดไป" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
    </div>}
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
// มือถือ (< md) เป็นการ์ดตัวเลข (ตัวเลขบน ชื่อล่าง) เห็นครบในจอเดียว เหมือนหน้าคำร้อง — เดิมเป็นแถวเลื่อน
// แนวนอนที่ป้ายหลังๆ ตกขอบจอโดยไม่มีอะไรบอกว่าเลื่อนได้ คลาสปกติคือหน้าตาบน PC ของเดิม มือถือปรับด้วย max-md: เท่านั้น
// ตัวเลขใช้ color ของป้ายตรงๆ — ชุดที่ส่งมาตอนนี้เป็นเฉด 600–700 ตัวเลขใหญ่หนาอ่านบนพื้นขาวได้
// ถ้าจะส่งเฉด 500 (เช่นเขียว #10b981) มาใช้ ต้องเพิ่มเฉดเข้มแยกแบบ STATUS.text ของคำร้อง
// 4 ป้ายใช้ 2×2 ไม่ให้เหลือการ์ดใบเดียวโดดในแถวที่สอง
// text-balance: ชื่อยาวที่ต้องขึ้นสองบรรทัดจะถูกแบ่งให้ยาวพอๆ กัน — ไม่มีมันจอ 360px ได้ "แล้วเสร็จในช่วง / นี้"
// และ "ไม่ทราบวันแล้ว / เสร็จ" (ผลการปฏิบัติงาน) มีแล้วได้ "แล้วเสร็จ / ในช่วงนี้" · "ไม่ทราบวัน / แล้วเสร็จ"
const TILE_COLS = { 1: 'max-md:grid-cols-1', 2: 'max-md:grid-cols-2', 4: 'max-md:grid-cols-2' }
export function Pills({ value, onChange, items, label }) {
  return <div className={`flex flex-wrap gap-1.5 max-md:grid ${TILE_COLS[items.length] ?? 'max-md:grid-cols-3'}`} role="group" aria-label={label}>
    {items.map(({ id, label: text, count, color }) => {
      const active = value === id
      return <button key={id} type="button" aria-pressed={active} onClick={() => onChange(id)}
        className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors max-md:min-h-15 max-md:flex-col max-md:justify-center max-md:gap-1 max-md:px-0.5 max-md:py-2 max-md:text-center max-md:leading-tight max-md:text-balance ${active ? 'border-transparent text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
        style={active ? { backgroundColor: 'var(--color-primary)' } : {}}>
        <span className="size-1.5 shrink-0 rounded-full max-md:hidden" style={{ backgroundColor: active ? 'rgba(255,255,255,0.85)' : color || '#94a3b8' }} />
        {text}
        {/* ตัวเลขอยู่หลังชื่อใน DOM (โปรแกรมอ่านหน้าจออ่านชื่อก่อน) มือถือยกขึ้นไว้บนด้วย order-first */}
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none max-md:order-first max-md:p-0 max-md:bg-transparent max-md:text-xl max-md:font-extrabold ${active ? 'bg-white/25' : 'bg-gray-100 text-gray-500 max-md:text-[color:var(--num-color)]'}`}
          style={{ '--num-color': color || '#334155' }}>{count}</span>
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
