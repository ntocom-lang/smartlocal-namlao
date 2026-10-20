import { surveyPercent } from '../../lib/survey'

// แท่งผลรายตัวเลือก — แสดงจำนวนคนจริงคู่เปอร์เซ็นต์เสมอ (ตอบน้อยเปอร์เซ็นต์อย่างเดียวหลอกตา)
// เปอร์เซ็นต์คิดจากผลรวมของตัวเลือกที่แสดง ไม่ใช้ยอดแยกต่างหาก ผลรวมจึงเท่า 100 ± ปัดเศษเสมอ
// mineId = ตัวเลือกที่เครื่องนี้จำว่าผู้ใช้เลือก (เซิร์ฟเวอร์ไม่รู้ ตั้งใจ) — ไฮไลต์เฉพาะเครื่องที่ตอบ
export default function SurveyResultBars({ options, mineId = null }) {
  const sum = options.reduce((acc, o) => acc + (o.count ?? 0), 0)
  if (sum === 0) {
    return <p className="text-sm text-gray-500">ยังไม่มีผู้ตอบ</p>
  }
  return (
    <ul className="space-y-3">
      {options.map(o => {
        const count = o.count ?? 0
        const pct = surveyPercent(count, sum)
        const isMine = mineId && o.id === mineId
        return (
          <li key={o.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-gray-800 break-words min-w-0">
                {o.label}
                {isMine && <span className="ml-2 text-[11px] font-bold whitespace-nowrap" style={{ color: 'var(--color-primary)' }}>คำตอบของคุณ</span>}
              </span>
              <span className="tabular-nums text-gray-500 whitespace-nowrap text-xs">{count} คน · {pct}%</span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: isMine ? 'var(--color-primary)' : '#94a3a0' }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
