import { ArrowDown, ArrowUp, ChevronRight, Info, Loader2, Minus, RefreshCw, TriangleAlert } from 'lucide-react'
import { execNf } from '../../../lib/executiveData'

// ชิ้นส่วนร่วมของห้องผู้บริหาร — ภาษาหน้าจอ/สี/ขนาดเดียวกับหน้าแรกเจ้าหน้าที่ (StaffOperationalDashboard):
// การ์ดขาว ขอบ slate-200 มุม rounded-2xl หัวข้อ text-sm font-bold ข้อความช่วย text-[10px]/[11px] slate-400/500

// สีประจำโซน — เจ้าของระบบขอ 2569-11-10 ให้ "เรื่องใครเรื่องมัน" แยกสัดส่วนด้วยสี/พื้นหลัง ดูง่ายทุกอุปกรณ์
// เขียนชื่อคลาสเต็มทุกตัว (Tailwind สแกนเฉพาะสตริงเต็ม ห้ามประกอบชื่อคลาสจากตัวแปร)
// โซนใหม่ในเฟสถัดไปเพิ่มสีที่นี่ · ไม่ระบุ tone = slate
const EXEC_TONES = Object.freeze({
  decision: { panel: 'border-amber-200 bg-amber-50/70', chip: 'bg-amber-500 text-white', title: 'text-amber-950', note: 'text-amber-800/70' },
  service: { panel: 'border-sky-200 bg-sky-50/70', chip: 'bg-sky-600 text-white', title: 'text-sky-950', note: 'text-sky-800/70' },
  schedule: { panel: 'border-emerald-200 bg-emerald-50/70', chip: 'bg-emerald-600 text-white', title: 'text-emerald-950', note: 'text-emerald-800/70' },
  alert: { panel: 'border-rose-200 bg-rose-50/70', chip: 'bg-rose-600 text-white', title: 'text-rose-950', note: 'text-rose-800/70' },
  plan: { panel: 'border-indigo-200 bg-indigo-50/70', chip: 'bg-indigo-600 text-white', title: 'text-indigo-950', note: 'text-indigo-800/70' },
  dept: { panel: 'border-cyan-200 bg-cyan-50/70', chip: 'bg-cyan-600 text-white', title: 'text-cyan-950', note: 'text-cyan-800/70' },
  area: { panel: 'border-teal-200 bg-teal-50/70', chip: 'bg-teal-600 text-white', title: 'text-teal-950', note: 'text-teal-800/70' },
  report: { panel: 'border-violet-200 bg-violet-50/70', chip: 'bg-violet-600 text-white', title: 'text-violet-950', note: 'text-violet-800/70' },
  slate: { panel: 'border-slate-200 bg-slate-50', chip: 'bg-slate-600 text-white', title: 'text-slate-900', note: 'text-slate-500' },
})

/**
 * กล่องของแต่ละโซน (พื้นสีประจำโซน + หัวมีไอคอนสี) — id ใช้ผูก aria-labelledby และเลือกสีจาก EXEC_TONES
 * compact = หัวเล็ก/ระยะแคบ สำหรับโซนแถวบนสุด (รอตัดสินใจ/กำหนดการ) — เจ้าของระบบขอ 2026-11-11 ให้กินที่น้อยลง
 * นายกจะได้เห็นเรื่องเลยกำหนด/สัญญาณเตือนที่อยู่ถัดลงไปโดยไม่ต้องเลื่อนไกล
 */
export function ExecSection({ id, title, Icon, note, aside, children, className = '', compact = false }) {
  const tone = EXEC_TONES[id] ?? EXEC_TONES.slate
  return (
    <section data-exec-zone={id} aria-labelledby={`exec-${id}-title`}
      className={`min-w-0 rounded-3xl border shadow-sm ${compact ? 'space-y-2 p-2.5 sm:p-3' : 'space-y-3 p-3 sm:p-4'} ${tone.panel} ${className}`}>
      <div className={`flex items-start ${compact ? 'gap-2' : 'gap-2.5'}`}>
        {Icon && (
          <span className={`flex shrink-0 items-center justify-center shadow-sm ${compact ? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-xl'} ${tone.chip}`}>
            <Icon size={compact ? 15 : 18} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 id={`exec-${id}-title`} className={`font-black leading-tight ${compact ? 'text-sm' : 'text-base'} ${tone.title}`}>{title}</h2>
          {note && <p className={`text-[11px] leading-snug ${tone.note}`}>{note}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** หัวของกล่องย่อยในโซน (แถบสีซ้าย) */
export function SubHead({ children, tone = 'border-sky-500 text-sky-950' }) {
  return <h3 className={`border-l-4 pl-2 text-sm font-bold ${tone}`}>{children}</h3>
}

/**
 * ประตูของการ์ดที่มาจาก executive_overview: กำลังโหลด / เรียกไม่ได้ทั้งก้อน / การ์ดนี้โหลดไม่ได้ → ขึ้นเฉพาะการ์ดนี้
 * โมดูลปิด (missing) หรือบัญชีไม่มีสิทธิ์ (forbidden — Home ขึ้นแจ้งทีเดียวที่หัวหน้า) = ไม่วาดอะไร
 * @param {{ ov: { status: string, reload: () => void, model: object }, name: string, label: string, children: (data: object) => any }} props
 */
export function SummaryGate({ ov, name, label, children }) {
  if (ov.status === 'loading') return <LoadingLine text={`กำลังโหลด${label}…`} />
  if (ov.status === 'error') return <SectionError text={`โหลด${label}ไม่ได้`} onRetry={ov.reload} />
  if (ov.status !== 'ok') return null
  const part = ov.model?.[name]
  if (!part || part.state === 'missing') return null
  if (part.state === 'error') return <SectionError text={`โหลด${label}ไม่ได้`} onRetry={ov.reload} />
  return children(part.data)
}

/** ปุ่ม ⓘ — กดเปิด/ปิดสูตรคำนวณ (ผู้ใช้ต้องกดเองถึงเห็น ไม่รกหน้า) · พื้นที่กดไม่เล็กกว่า 28px */
export function InfoButton({ active, onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={active} aria-label={`วิธีคำนวณ: ${label}`}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-slate-500 hover:bg-slate-100 active:scale-95 ${active ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-transparent'}`}>
      <Info size={14} aria-hidden="true" />
    </button>
  )
}

/** กล่องสูตรคำนวณ — items: [{ who, formula, source }] มาจากทะเบียน (executiveRegistry.js) ตรงๆ ไม่แก้ถ้อยคำ */
export function FormulaPanel({ title, items }) {
  if (!items || items.length === 0) return null
  return (
    <div role="note" data-exec-formula className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
      <p className="font-bold">วิธีคำนวณ: {title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it) => (
          <li key={`${it.who}:${it.formula}`} className="leading-snug">
            {it.who && <span className="font-semibold">{it.who}: </span>}
            {it.formula}
            {it.source && <span className="block text-[10px] text-sky-800/70">ที่มา: {it.source}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LoadingLine({ text = 'กำลังโหลด…' }) {
  return (
    <div role="status" className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
      <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {text}
    </div>
  )
}

/** ส่วนนี้โหลดไม่ได้ — แจ้งเฉพาะส่วนนี้ พร้อมปุ่มลองใหม่ (ส่วนอื่นของหน้าไม่กระทบ) */
export function SectionError({ text = 'โหลดไม่ได้', onRetry }) {
  return (
    <div role="alert" data-exec-error className="flex min-h-12 flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{text}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 active:scale-95">
          <RefreshCw size={13} aria-hidden="true" /> ลองใหม่
        </button>
      )}
    </div>
  )
}

const DELTA_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus }
const DELTA_WORD = { up: 'มากกว่า', down: 'น้อยกว่า', flat: 'เท่ากับ' }

/**
 * ลูกศรเทียบช่วงก่อน — สีเทากลางเสมอ ไม่ใช้เขียว/แดง: "เรื่องใหม่เพิ่ม" หรือ "ยังไม่เสร็จเพิ่ม" ไม่ได้แปลว่าดีหรือแย่ในตัว
 * (ผู้อ่านตีความเอง) · ไม่ใช่สีอย่างเดียวที่บอก — มีทั้งลูกศรและข้อความ
 */
export function DeltaLine({ cmp, unit = '' }) {
  if (!cmp) return null
  const Icon = DELTA_ICON[cmp.dir]
  return (
    <p data-exec-delta={cmp.dir} className="mt-0.5 flex items-center gap-0.5 text-[10px] leading-tight text-slate-500">
      <Icon size={11} className="shrink-0" aria-hidden="true" />
      <span>
        {cmp.dir === 'flat' ? DELTA_WORD.flat : `${DELTA_WORD[cmp.dir]} ${Math.abs(cmp.diff).toLocaleString('th-TH')}${unit}`}
        {cmp.pct != null && cmp.dir !== 'flat' ? ` (${cmp.pct > 0 ? '+' : ''}${cmp.pct}%)` : ''}
      </span>
    </p>
  )
}

// สีไอคอนในไทล์ตามโซน (ชื่อคลาสเต็ม — Tailwind ไม่สแกนคลาสที่ประกอบจากตัวแปร)
const TILE_ICON_TONE = Object.freeze({
  area: 'bg-teal-100 text-teal-700',
  report: 'bg-violet-100 text-violet-700',
  context: 'bg-slate-200 text-slate-600',
})

/** ไทล์ลิงก์ไปเมนู/หน้าเดิม (ไม่มีตัวเลข) — Icon ส่งเข้ามาจากผู้เรียก (ไม่สร้างคอมโพเนนต์จากชื่อไอคอนระหว่าง render) */
export function Tile({ Icon, label, sub, onClick, testId, tone }) {
  return (
    <button type="button" data-exec-tile={testId} onClick={onClick}
      className="flex min-h-14 items-center gap-3 rounded-2xl border border-white bg-white px-3 py-2 text-left shadow-sm hover:bg-slate-50 active:scale-[0.99]">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TILE_ICON_TONE[tone] ?? 'bg-slate-100 text-slate-600'}`}><Icon size={19} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-800">{label}</span>
        {sub && <span className="block truncate text-[11px] text-slate-500">{sub}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden="true" />
    </button>
  )
}

// ───────────────────────── กราฟ ─────────────────────────

// สีกราฟอยู่ที่ execChart.js (ไฟล์คอมโพเนนต์ export ค่าคงที่ไม่ได้ — react-refresh)
const sharePct = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0)

/**
 * แท่งแบ่งสัดส่วน 1 แท่ง (ส่วนของทั้งหมด) + คำอธิบายสีพร้อมจำนวน/ร้อยละ — ใช้แทนกราฟวงกลม
 * (ส่วนที่ค่าใกล้กันบนวงกลมแยกด้วยตาไม่ออก และวงกลมกินความสูงบนมือถือ แท่งเดียวสูง 12px อ่านได้ทันที)
 * ช่องว่าง 2px คั่นทุกส่วน · ส่วนที่เป็น 0 ไม่วาดบนแท่งแต่ยังอยู่ในคำอธิบาย (เห็นว่าเป็น 0 ไม่ใช่หายไป)
 * @param {{ parts: Array<{ key: string, label: string, value: number, color: string }>, label: string, testId?: string }} props
 */
export function SplitBar({ parts, label, testId }) {
  const total = parts.reduce((t, p) => t + (p.value > 0 ? p.value : 0), 0)
  return (
    <div data-exec-split={testId} className="space-y-1.5">
      {total > 0 && (
        <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${execNf(p.value)}`).join(' · ')}`}
          className="flex h-3 gap-0.5 overflow-hidden rounded-full">
          {parts.filter((p) => p.value > 0).map((p) => (
            <span key={p.key} title={`${p.label} ${execNf(p.value)} (${sharePct(p.value, total)}%)`} className="min-w-1 basis-0"
              style={{ flexGrow: p.value, backgroundColor: p.color }} />
          ))}
        </div>
      )}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
        {parts.map((p) => (
          <li key={p.key} data-exec-split-part={p.key} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
            <span>{p.label}</span>
            <span className={`font-bold tabular-nums ${p.value > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{execNf(p.value)}</span>
            {total > 0 && p.value > 0 && <span className="text-slate-400">({sharePct(p.value, total)}%)</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
