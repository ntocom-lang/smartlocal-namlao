import { ChevronRight, CircleAlert, TriangleAlert } from 'lucide-react'
import { monthOverviewRule, normalizeMonthOverview } from '../../lib/staffMonthOverview'

// การ์ด "ภาพรวมเดือนนี้" บนหน้าแรกเจ้าหน้าที่ — ตัวเลขคำร้องตั้งแต่วันที่ 1 ถึงวันนี้ (เวลาไทย)
// หัวหน้ากอง = ของกองตัวเอง · แอดมิน/Super Admin = ทั้งหน่วยงาน (ขอบเขตตัดสินที่ RPC staff_month_overview ไม่ใช่ที่นี่)
// ตัวเลขล้วน ไม่มีชื่อคน/เลขคำร้อง (PDPA) · ไม่มีปุ่มอนุมัติ/ยืนยัน · ไม่ยุ่งกับไฟเขียว/KPI ของฉัน/สรุปวันนี้
//
// state = ผลของ useHomeRpc (status/data) · renderHeading = ส่งมาจาก StaffOperationalDashboard (ใช้ CardHeading ตัวเดียวกับส่วนอื่น —
// ไม่ import กลับจากไฟล์นั้นเพราะจะเป็นวงกลม) · onOpen = เปิดเมนูคำร้อง

// สีแถบไม่ใช่สัญญาณเดียว: ตัวเลข % กำกับเสมอ (คนตาบอดสี/พิมพ์ขาวดำยังอ่านได้)
function barTone(pct) {
  if (pct >= 80) return { bar: 'bg-emerald-500', text: 'text-emerald-700' }
  if (pct >= 50) return { bar: 'bg-amber-500', text: 'text-amber-700' }
  return { bar: 'bg-red-500', text: 'text-red-700' }
}

function Stat({ testKey, label, value, danger = false }) {
  const alert = danger && value > 0
  return (
    <div data-home-month-stat={testKey} className="min-w-0">
      <span className={`flex items-center gap-1 text-xl font-black leading-tight tabular-nums ${alert ? 'text-red-600' : 'text-slate-900'}`}>
        {alert && <CircleAlert size={16} className="shrink-0" aria-hidden="true" />}
        {value > 999 ? '999+' : value}
      </span>
      <span className="block truncate text-xs font-semibold text-slate-600">{label}</span>
    </div>
  )
}

export default function StaffMonthOverview({ state, renderHeading, onOpen }) {
  if (state.status === 'idle') return null
  if (state.status === 'loading') {
    return (
      <div role="status" data-home-month-loading className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-slate-100">
        <span className="sr-only">กำลังโหลดภาพรวมเดือนนี้</span>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div data-home-month-error className="flex min-h-12 items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <TriangleAlert size={16} className="shrink-0" aria-hidden="true" /> โหลดภาพรวมเดือนนี้ไม่สำเร็จ — เปิดหน้านี้ใหม่อีกครั้ง
      </div>
    )
  }
  const m = normalizeMonthOverview(state.data)
  if (!m) return null // ผลผิดรูป = ไม่แสดงการ์ด (ไม่ใช่งานเร่งด่วน ไม่ต้องเตือน)

  const title = `ภาพรวมเดือนนี้${m.scope === 'department' && m.departmentName ? ` · ${m.departmentName}` : m.scope === 'department' ? '' : ' · ทั้งหน่วยงาน'}`
  const tone = m.onTimePct === null ? null : barTone(m.onTimePct)

  return (
    <section data-home-month aria-labelledby="home-month-title">
      {renderHeading({ id: 'home-month-title', title, desc: m.periodText })}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat testKey="received" label="รับเข้ามา" value={m.received} />
          <Stat testKey="completed" label="เสร็จแล้ว" value={m.completed} />
          <Stat testKey="open" label="ค้างอยู่" value={m.openNow} />
          <Stat testKey="overdue" label="เลยกำหนด" value={m.openPastDue} danger />
        </div>

        <div data-home-month-ontime className="mt-3 border-t border-slate-100 pt-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-700">เสร็จทันกำหนด</span>
            <span className={`text-sm font-black tabular-nums ${tone ? tone.text : 'text-slate-400'}`}>
              {m.onTimePct === null ? '—' : `${m.onTimePct}%`}
            </span>
          </div>
          {m.onTimePct === null ? (
            <p className="mt-1 text-[11px] text-slate-500">ยังไม่มีเรื่องที่ครบกำหนดในเดือนนี้</p>
          ) : (
            <div role="meter" aria-label="ร้อยละเสร็จทันกำหนด" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.onTimePct}
              aria-valuetext={`${m.onTimePct} เปอร์เซ็นต์`} className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${m.onTimePct}%` }} />
            </div>
          )}
        </div>

        <details className="mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-slate-600 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">วิธีคิด</summary>
          <p className="pb-1 text-[11px] leading-relaxed text-slate-600">{monthOverviewRule(m.scope)}</p>
        </details>

        <button type="button" data-home-month-open onClick={onOpen}
          className="mt-1 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.99]">
          <span>ดูคำร้องทั้งหมด</span>
          <ChevronRight size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
