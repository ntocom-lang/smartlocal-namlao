// กราฟเส้นความก้าวหน้ารายสัปดาห์ (SVG ล้วน ไม่ใช้ไลบรารี) — จริงสะสม เทียบแผนที่ตั้งในระบบ และแผนตามเวลา
import { thaiShortDate } from '../../../lib/complaintReportPeriods'

const W = 640
const H = 240
const PAD = { left: 38, right: 14, top: 14, bottom: 34 }

const LINES = [
  { key: 'actual', label: 'ผลงานจริงสะสม', color: '#0369a1', dash: null, width: 2.5 },
  { key: 'plan', label: 'แผนที่ตั้งในระบบ', color: '#b45309', dash: '6 4', width: 2 },
  { key: 'timePlan', label: 'แผนตามเวลา', color: '#475569', dash: '2 4', width: 1.5 },
]

export default function ProgressChart({ series }) {
  if (!series.length) return <p className="rounded-xl bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">ยังไม่มีรายงาน — เริ่มรายงานสัปดาห์แรกเพื่อดูกราฟ</p>
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = i => PAD.left + (series.length === 1 ? innerW / 2 : (innerW * i) / (series.length - 1))
  const y = v => PAD.top + innerH - (Math.min(100, Math.max(0, v)) / 100) * innerH
  const last = series[series.length - 1]
  const labelEvery = Math.max(1, Math.ceil(series.length / 8))
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={`กราฟความก้าวหน้า ${series.length} สัปดาห์ ล่าสุดผลงานจริง ${last.actual.toFixed(2)} เปอร์เซ็นต์${last.plan === null ? '' : ` แผน ${last.plan.toFixed(2)} เปอร์เซ็นต์`}`}>
        {[0, 25, 50, 75, 100].map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{t}%</text>
          </g>
        ))}
        {series.map((p, i) => (i % labelEvery === 0 || i === series.length - 1) && (
          <text key={p.week_no} x={x(i)} y={H - 14} textAnchor="middle" fontSize="11" fill="#6b7280">
            <tspan x={x(i)}>ส.{p.week_no}</tspan><tspan x={x(i)} dy="12" fontSize="9">{thaiShortDate(p.period_end, false)}</tspan>
          </text>
        ))}
        {LINES.map(line => {
          const points = series.map((p, i) => (p[line.key] === null || p[line.key] === undefined ? null : [x(i), y(p[line.key])]))
          // ตัดเส้นตรงช่วงที่ไม่มีค่า (เช่น ยังไม่ตั้งแผน) ไม่ลากข้าม
          const paths = []
          let current = []
          for (const pt of points) {
            if (pt) current.push(pt)
            else if (current.length) { paths.push(current); current = [] }
          }
          if (current.length) paths.push(current)
          return (
            <g key={line.key}>
              {paths.map((pts, n) => (
                <polyline key={n} fill="none" stroke={line.color} strokeWidth={line.width} strokeDasharray={line.dash ?? undefined}
                  strokeLinejoin="round" strokeLinecap="round" points={pts.map(([px, py]) => `${px},${py}`).join(' ')} />
              ))}
              {line.key === 'actual' && points.map((pt, n) => pt && <circle key={n} cx={pt[0]} cy={pt[1]} r="3.5" fill={line.color} />)}
            </g>
          )
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        {LINES.map(line => (
          <span key={line.key} className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke={line.color} strokeWidth={line.width} strokeDasharray={line.dash ?? undefined} /></svg>
            {line.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
