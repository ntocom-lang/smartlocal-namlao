import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'

// ใช้ร่วมเมนูซ้าย PC/ลิ้นชักมือถือ โดยไม่เปลี่ยนการกรองสิทธิ์ของผู้เรียก
export default function CollapsibleNavGroup({ label, activeKey, workCount = 0, workError = false, children }) {
  const contentId = useId()
  const [choice, setChoice] = useState(null)
  // เปิดเมื่อเข้ามาทำงานในกอง หรือเพิ่งมีงานรอ ผู้ใช้ยังยุบเองได้ในบริบทเดิม
  const autoKey = JSON.stringify([activeKey ?? null, workCount > 0, workError])
  // ทิ้งการยุบของบริบทเก่า เพื่อให้งานชุดใหม่เปิดได้อีกหลังงานเดิมหมดแล้ว
  if (choice && choice.autoKey !== autoKey) setChoice(null)
  const expanded = choice?.autoKey === autoKey ? choice.expanded : Boolean(activeKey) || workCount > 0 || workError

  return (
    <div data-department-nav={label} className="mb-2">
      <button type="button" aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setChoice({ autoKey, expanded: !expanded })}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60">
        <ChevronRight size={16} aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">{label}</span>
        {workCount > 0 && (
          <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
            {workCount > 99 ? '99+' : workCount}<span className="sr-only"> รายการรอ</span>
          </span>
        )}
        {workError && <span role="status" className="shrink-0 text-[10px] font-normal text-amber-300">ตรวจงานไม่ได้</span>}
        <span className="shrink-0 text-[10px] font-normal text-white/60">{expanded ? 'ซ่อน' : 'แสดง'}</span>
      </button>
      <div id={contentId} hidden={!expanded} className="space-y-0.5">
        {children}
      </div>
    </div>
  )
}
