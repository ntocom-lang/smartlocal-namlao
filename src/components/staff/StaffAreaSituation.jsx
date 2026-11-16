import { ChevronRight, CloudRain, Wind } from 'lucide-react'
import { TMD_SOURCE_NAME, rainText } from '../../lib/tmdForecast'

// การ์ด "สถานการณ์ในพื้นที่วันนี้" ของหน้าแรกเจ้าหน้าที่ — ฝนพยากรณ์ 3 วัน + ฝุ่น PM2.5 สถานีใกล้ อปท.
// ตรรกะเลือกข้อมูล/ตัดข้อมูลเก่าอยู่ที่ src/lib/staffAreaSituation.js (buildAreaSituation) · ข้อมูลมาจาก useStaffHomeHazards (แคชระดับโมดูล)
// แสดงเฉพาะแถวที่มีข้อมูลจริง ไม่ขึ้นค่าเดา

const AIR_SOURCE_NAME = 'Air4Thai กรมควบคุมมลพิษ'
const nf1 = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 1 })

const INSIGHT_TONES = {
  red: 'border-red-200 bg-red-50 text-red-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
}

function RainRow({ rows, insight }) {
  return (
    <div data-home-area-rain>
      <p className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700">
        <CloudRain size={14} className="text-sky-600" aria-hidden="true" /> ฝนพยากรณ์ {rows.length} วัน
      </p>
      {insight && (
        <p data-home-area-rain-alert className={`mb-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${INSIGHT_TONES[insight.tone] ?? INSIGHT_TONES.amber}`}>
          {insight.what} {nf1(insight.count)} มม.
        </p>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {rows.map((row) => (
          <div key={row.time} className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-center">
            <p className="truncate text-xs font-semibold text-slate-600">{row.label}</p>
            <p className="text-lg font-black tabular-nums leading-tight text-slate-900">
              {rainText(row.mm)}<span className="ml-0.5 text-[11px] font-semibold text-slate-500">มม.</span>
            </p>
            <p className={`truncate rounded-md px-1 text-[11px] font-semibold ${row.level?.chip ?? 'bg-slate-100 text-slate-500'}`}>{row.level?.label ?? 'ไม่มีค่า'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function DustRow({ row, emphasised }) {
  const { level } = row
  return (
    <div data-home-area-dust className="rounded-xl border px-3 py-2"
      style={{ borderColor: emphasised ? level.color : '#e2e8f0', backgroundColor: emphasised ? level.fill : '#ffffff' }}>
      <p className="mb-0.5 flex items-center gap-1 text-xs font-bold text-slate-700">
        <Wind size={14} className="text-slate-500" aria-hidden="true" /> ฝุ่น PM2.5
      </p>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-2xl font-black tabular-nums" style={{ color: level.color }}>{nf1(row.value)}</span>
        <span className="text-[11px] font-semibold text-slate-500">มคก./ลบ.ม.</span>
        <span className="min-w-0 truncate text-xs font-bold" style={{ color: level.color }}>{level.label}</span>
      </div>
      <p className="truncate text-[11px] text-slate-500">สถานี {row.name} · ค่าเฉลี่ย 24 ชม.</p>
    </div>
  )
}

/**
 * @param {{ model: ReturnType<typeof buildAreaSituation>, settled: boolean, onOpenWater?: () => void }} props
 *   model ว่าง (ไม่มีทั้งฝน ฝุ่น และลิงก์) = ไม่แสดงการ์ด · ยังไม่ settled = skeleton บาง 1 กล่อง
 */
export default function StaffAreaSituation({ model, settled, onOpenWater }) {
  const hasData = Boolean(model.rainRow || model.dustRow)
  if (!settled && !hasData) {
    return <div data-home-area-loading role="status" aria-label="กำลังโหลดสถานการณ์ในพื้นที่" className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
  }
  if (!hasData && !onOpenWater) return null

  const sources = [model.rainRow && TMD_SOURCE_NAME, model.dustRow && AIR_SOURCE_NAME].filter(Boolean)
  return (
    <section data-home-area aria-labelledby="home-area-title" className="space-y-2">
      <div className="flex items-start gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><CloudRain size={15} aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id="home-area-title" className="text-sm font-bold text-slate-800">สถานการณ์ในพื้นที่วันนี้</h2>
          <p className="text-[11px] text-slate-500">ฝนพยากรณ์และฝุ่นละอองใกล้พื้นที่ · เตือนเท่านั้น</p>
        </div>
      </div>
      {model.rainRow && <RainRow rows={model.rainRow} insight={model.rainInsight} />}
      {model.dustRow && <DustRow row={model.dustRow} emphasised={Boolean(model.dustInsight)} />}
      {onOpenWater && (
        <button type="button" data-home-area-water onClick={onOpenWater}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-left text-xs font-bold text-sky-800 hover:bg-sky-50 active:scale-[0.99]">
          <span className="min-w-0 flex-1">ดูสถานการณ์น้ำ–ฝนทั้งหมด</span>
          <ChevronRight size={15} className="shrink-0 opacity-60" aria-hidden="true" />
        </button>
      )}
      {sources.length > 0 && (
        <p className="text-[11px] leading-snug text-slate-500">
          ที่มา: {model.rainRow ? `${TMD_SOURCE_NAME} (แบบจำลอง NWP)` : ''}{model.rainRow && model.dustRow ? ' · ' : ''}{model.dustRow ? AIR_SOURCE_NAME : ''}
        </p>
      )}
    </section>
  )
}
