import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'

// ใช้ร่วมเมนูซ้าย PC/ลิ้นชักมือถือ โดยไม่เปลี่ยนการกรองสิทธิ์ของผู้เรียก
export default function CollapsibleNavGroup({ label, items, badges, workErrors, renderItem }) {
  const groupId = useId()
  const [showAll, setShowAll] = useState(false)
  const rows = items.map((item, index) => ({
    item, id: `${groupId}-${index}`,
    hasWork: Number(badges?.[item.key]) > 0,
    hasError: Boolean(workErrors?.[item.key]),
  }))
  const workError = rows.some(row => row.hasError)
  // ปุ่มควบคุมเฉพาะรายการที่ไม่มีงาน รายการมีงาน/ตรวจไม่ได้ยังมองเห็นเสมอ
  // aria-controls รับหลาย ID ได้ จึงคงลำดับเมนูเดิมโดยไม่ทำสำเนาปุ่มซ้ำ
  const controlledIds = rows.filter(row => !row.hasWork && !row.hasError).map(row => row.id).join(' ')

  return (
    <div data-nav-group={label} data-department-nav={label} className="mb-2">
      <button type="button" aria-expanded={showAll} aria-controls={controlledIds || undefined}
        title={showAll ? 'ซ่อนเมนูย่อยที่ไม่มีเรื่อง' : 'แสดงเมนูย่อยทั้งหมด'}
        onClick={() => setShowAll(value => !value)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60">
        <ChevronRight size={16} aria-hidden="true" className={`shrink-0 transition-transform ${showAll ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">{label}</span>
        {workError && <span role="status" className="shrink-0 text-[10px] font-normal text-amber-300">ตรวจงานไม่ได้</span>}
        <span className="shrink-0 text-[10px] font-normal text-white/60">{showAll ? 'ซ่อน' : 'แสดง'}</span>
      </button>
      <div className="space-y-0.5">
        {rows.map(({ item, id, hasWork, hasError }) => (
          <div key={item.key} id={id} data-nav-item={item.key} hidden={!showAll && !hasWork && !hasError}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  )
}
