import { ArrowDown, ArrowUp, Info, Loader2, Minus, RefreshCw, TriangleAlert } from 'lucide-react'

// ชิ้นส่วนร่วมของห้องผู้บริหาร — ภาษาหน้าจอ/สี/ขนาดเดียวกับหน้าแรกเจ้าหน้าที่ (StaffOperationalDashboard):
// การ์ดขาว ขอบ slate-200 มุม rounded-2xl หัวข้อ text-sm font-bold ข้อความช่วย text-[10px]/[11px] slate-400/500

// สีประจำโซน — เจ้าของระบบขอ 2569-11-10 ให้ "เรื่องใครเรื่องมัน" แยกสัดส่วนด้วยสี/พื้นหลัง ดูง่ายทุกอุปกรณ์
// เขียนชื่อคลาสเต็มทุกตัว (Tailwind สแกนเฉพาะสตริงเต็ม ห้ามประกอบชื่อคลาสจากตัวแปร)
// โซนใหม่ในเฟสถัดไปเพิ่มสีที่นี่ · ไม่ระบุ tone = slate
const EXEC_TONES = Object.freeze({
  decision: { panel: 'border-amber-200 bg-amber-50/70', chip: 'bg-amber-500 text-white', title: 'text-amber-950', note: 'text-amber-800/70' },
  service: { panel: 'border-sky-200 bg-sky-50/70', chip: 'bg-sky-600 text-white', title: 'text-sky-950', note: 'text-sky-800/70' },
  schedule: { panel: 'border-emerald-200 bg-emerald-50/70', chip: 'bg-emerald-600 text-white', title: 'text-emerald-950', note: 'text-emerald-800/70' },
  area: { panel: 'border-teal-200 bg-teal-50/70', chip: 'bg-teal-600 text-white', title: 'text-teal-950', note: 'text-teal-800/70' },
  report: { panel: 'border-violet-200 bg-violet-50/70', chip: 'bg-violet-600 text-white', title: 'text-violet-950', note: 'text-violet-800/70' },
  slate: { panel: 'border-slate-200 bg-slate-50', chip: 'bg-slate-600 text-white', title: 'text-slate-900', note: 'text-slate-500' },
})

/** กล่องของแต่ละโซน (พื้นสีประจำโซน + หัวมีไอคอนสี) — id ใช้ผูก aria-labelledby และเลือกสีจาก EXEC_TONES */
export function ExecSection({ id, title, Icon, note, aside, children, className = '' }) {
  const tone = EXEC_TONES[id] ?? EXEC_TONES.slate
  return (
    <section data-exec-zone={id} aria-labelledby={`exec-${id}-title`}
      className={`min-w-0 space-y-3 rounded-3xl border p-3 shadow-sm sm:p-4 ${tone.panel} ${className}`}>
      <div className="flex items-start gap-2.5">
        {Icon && (
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm ${tone.chip}`}>
            <Icon size={18} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 id={`exec-${id}-title`} className={`text-base font-black leading-tight ${tone.title}`}>{title}</h2>
          {note && <p className={`text-[11px] leading-snug ${tone.note}`}>{note}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
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
export function DeltaLine({ cmp }) {
  if (!cmp) return null
  const Icon = DELTA_ICON[cmp.dir]
  return (
    <p data-exec-delta={cmp.dir} className="mt-0.5 flex items-center gap-0.5 text-[10px] leading-tight text-slate-500">
      <Icon size={11} className="shrink-0" aria-hidden="true" />
      <span>
        {cmp.dir === 'flat' ? DELTA_WORD.flat : `${DELTA_WORD[cmp.dir]} ${Math.abs(cmp.diff).toLocaleString('th-TH')}`}
        {cmp.pct != null && cmp.dir !== 'flat' ? ` (${cmp.pct > 0 ? '+' : ''}${cmp.pct}%)` : ''}
      </span>
    </p>
  )
}
