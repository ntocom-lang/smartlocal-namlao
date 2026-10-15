import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Dam, ExternalLink, Minus } from 'lucide-react'
import ReservoirGauge from './ReservoirGauge'
import { formatMcm, formatMm } from '../../lib/waterSituation'
import {
  RESERVOIR_SOURCE, SMALL_RESERVOIRS, SMALL_RESERVOIR_TENANTS,
  formatReportDate, formatReportDay, isReservoirReport, reservoirReportUrl, reservoirSummary,
} from '../../lib/smallReservoirs'

// ข้อมูลเปลี่ยนสัปดาห์ละครั้ง — ถามซ้ำถี่กว่านี้ไม่ได้ของใหม่ (Worker จำคำตอบไว้ 6 ชม. อยู่แล้ว)
const REFRESH_MS = 30 * 60 * 1000
const RELOAD_ON_VISIBLE_MS = 10 * 60 * 1000
// สีกลาง (ไม่ใช่สีสถานการณ์) — ยังไม่ได้ยืนยันว่าเกณฑ์สี DAM_LEVELS ใช้กับอ่างขนาดเล็กได้ ไม่ลงสีเอง
const NEUTRAL_BLUE = '#0284c7'
const QUARTERS = [25, 50, 75]

// ดึงจาก Worker ของเราเอง (/api/small-reservoir) ไม่ผ่าน Supabase — ผูก visibilitychange ได้โดยไม่เกี่ยวกับกับดัก
// "มือถือค้างเพราะ token refresh" ใน NOTES §7 (ตัวนั้นเกิดกับคำสั่ง Supabase ที่ต้องยืนยันตัวตนเท่านั้น)
function useReservoirReport(id) {
  const [state, setState] = useState({ id, report: null, failed: false, done: false })
  useEffect(() => {
    let alive = true
    let lastLoad = 0
    const controller = new AbortController()
    async function load() {
      if (document.hidden) return
      lastLoad = Date.now()
      try {
        const response = await fetch(`/api/small-reservoir?id=${encodeURIComponent(id)}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Unavailable')
        const report = await response.json()
        // ไม่เชื่อ JSON ตรงๆ — ชนิดข้อมูลผิดหรือผิดอ่างให้ถือว่าดึงไม่สำเร็จ
        if (!isReservoirReport(report, id)) throw new Error('Invalid report')
        if (alive) setState({ id, report, failed: Boolean(report.refreshFailed), done: true })
      } catch {
        // ล้มครั้งนี้แต่เคยมีของเดิม → แสดงของเดิมต่อพร้อมป้าย ไม่ล้างทิ้ง
        if (alive && !controller.signal.aborted) setState(prev => ({ id, report: prev.id === id ? prev.report : null, failed: true, done: true }))
      }
    }
    const onVisible = () => { if (!document.hidden && Date.now() - lastLoad > RELOAD_ON_VISIBLE_MS) load() }
    load()
    const timer = setInterval(load, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [id])
  return state
}

// กราฟเส้น % ของ 26 รายงานล่าสุด — วาดค่าตามต้นฉบับตรงๆ ไม่ปรับแก้/ซ่อนค่าโดด (ให้ผู้ดูเห็นเองว่าค่าไหนกระโดด)
// แกนเวลาตามวันที่จริง (รายงานไม่ได้ห่างเท่ากันเสมอ) · แกนตั้ง 0–110% มีเส้น 100% เป็นหลักอ้างอิง ไม่ใช่เกณฑ์สถานการณ์
function ReservoirSpark({ rows }) {
  const series = rows.slice(0, 26).reverse()
  if (series.length < 2) return null
  const W = 300, H = 72, pad = 4, top = 110
  const t0 = Date.parse(series[0].d)
  const span = Date.parse(series[series.length - 1].d) - t0 || 1
  const x = row => pad + ((Date.parse(row.d) - t0) / span) * (W - 2 * pad)
  const y = pct => H - pad - (Math.min(Math.max(pct, 0), top) / top) * (H - 2 * pad)
  const last = series[series.length - 1]
  const pcts = series.map(row => row.pct)
  const label = `ระดับน้ำเป็นเปอร์เซ็นต์ของความจุ ${series.length} รายงานล่าสุด ตั้งแต่ ${formatReportDay(series[0].d)} ถึง ${formatReportDay(last.d)} ต่ำสุด ${formatMm(Math.min(...pcts))}% สูงสุด ${formatMm(Math.max(...pcts))}%`
  return (
    <div className="mt-2">
      <p className="text-[11px] text-gray-500">{series.length} รายงานล่าสุด (ค่าตามต้นฉบับ ไม่ปรับแก้)</p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-1 block h-[72px] w-full" role="img" aria-label={label}>
        <line x1="0" x2={W} y1={y(100)} y2={y(100)} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth="1" />
        <text x={W - 2} y={y(100) - 3} textAnchor="end" fontSize="9" fill="#94a3b8">100%</text>
        <polyline points={series.map(row => `${x(row).toFixed(1)},${y(row.pct).toFixed(1)}`).join(' ')}
          fill="none" stroke={NEUTRAL_BLUE} strokeWidth="2" strokeLinejoin="round" />
        {series.map(row => <circle key={row.d} cx={x(row).toFixed(1)} cy={y(row.pct).toFixed(1)} r="2" fill={NEUTRAL_BLUE} />)}
        <circle cx={x(last).toFixed(1)} cy={y(last.pct).toFixed(1)} r="4" fill="#fff" stroke={NEUTRAL_BLUE} strokeWidth="2.5" />
      </svg>
    </div>
  )
}

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus }
const TREND_CLASS = { up: 'text-sky-700', down: 'text-amber-700', flat: 'text-gray-600' }

function trendText(summary) {
  if (summary.showSame) return 'ตัวเลขซ้ำเดิม เทียบไม่ได้'
  const { trend, previous } = summary
  if (!trend) return 'ยังไม่มีรายงานก่อนหน้าให้เปรียบเทียบ'
  const from = `จากรายงาน ${formatReportDay(previous.d)} (${formatMm(previous.pct)}%)`
  if (trend.dir === 'flat') return `ทรงตัว เมื่อเทียบรายงาน ${formatReportDay(previous.d)} (${formatMm(previous.pct)}%)`
  return `${trend.dir === 'up' ? 'เพิ่มขึ้น' : 'ลดลง'} ${trend.points.toFixed(1)} จุดเปอร์เซ็นต์ ${from}`
}

function ReservoirCardView({ meta, link, scope, report, failed, done, id, now }) {
  if (!done) {
    return <div className="h-40 animate-pulse rounded-2xl bg-gray-100" role="status" aria-label={`กำลังอ่านรายงาน${meta.name}`} data-reservoir-id={id} />
  }
  if (!report) {
    return (
      <div className="water-station-card rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-reservoir-id={id}>
        <p className="text-base font-bold text-gray-900">{meta.name}</p>
        <p className="mt-2 text-sm text-gray-500">ยังโหลดรายงานอ่างนี้ไม่ได้ในตอนนี้ — เปิดรายงานที่ต้นฉบับได้</p>
        <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-blue-700">
          เปิดรายงานต้นฉบับ <ExternalLink size={12} />
        </a>
      </div>
    )
  }
  const summary = reservoirSummary(report, now)
  const { latest, stale, ageDays, showSame } = summary
  const percent = latest.pct
  const barWidth = Math.max(0, Math.min(percent, 100))
  const TrendIcon = TREND_ICON[summary.trend?.dir] ?? Minus
  const dayText = ageDays === 0 ? 'รายงานของวันนี้' : `รายงานวันที่ ${formatReportDate(latest.d)}`
  return (
    <div className="water-station-card rounded-2xl border bg-white p-4 shadow-sm" data-reservoir-id={id}
      style={{ borderColor: stale ? '#f3f4f6' : '#bae6fd' }}>
      <div className="min-w-0">
        <p className="text-base font-bold leading-tight text-gray-900">
          {meta.name}
          {scope && (
            <span className="ml-1.5 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 align-middle text-[10px] font-bold text-emerald-700">{scope}</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {report.capacity != null && <>ความจุ {formatMcm(report.capacity)} ล้าน ลบ.ม. · </>}รายงานรายสัปดาห์
        </p>
      </div>

      {failed && (
        <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          ดึงข้อมูลจากต้นทางไม่สำเร็จ แสดงรายงานที่ดึงไว้ครั้งก่อน ·{' '}
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center font-semibold text-blue-700 underline">เปิดต้นฉบับ</a>
        </p>
      )}
      {showSame && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-snug text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            ตัวเลขซ้ำเดิม {summary.sameCount} รายงานติดกัน{summary.sameCapped ? ' (หรือมากกว่า)' : ''} ตั้งแต่ {formatReportDate(summary.sameSince)}
            {' '}— ต้นทางอาจยังไม่ได้ปรับข้อมูล ใช้ตัวเลขนี้อย่างระมัดระวัง
          </span>
        </p>
      )}

      <div className={`mt-3 ${stale ? 'opacity-50' : ''}`}>
        <div className="water-dam-volume">
          <ReservoirGauge percent={percent} color={NEUTRAL_BLUE} />
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold text-gray-500">ปริมาตรน้ำในอ่าง</p>
            <p className="text-xs text-gray-600">
              <span className="text-lg font-bold text-gray-900">{formatMcm(latest.vol)}</span>
              {report.capacity != null && <> จาก {formatMcm(report.capacity)}</>} ล้าน ลบ.ม.
            </p>
            <p className="mt-1 text-[11px] text-gray-500">เทียบความจุของอ่าง</p>
          </div>
        </div>
        <div className="mt-1.5">
          <div className="relative h-3 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`ปริมาณน้ำในอ่าง ${percent.toFixed(1)}% ของความจุ`}>
            <div className="h-full rounded-full" style={{ width: `${barWidth}%`, backgroundColor: NEUTRAL_BLUE }} />
            {QUARTERS.map(tick => (
              <span key={tick} className="absolute inset-y-0 w-px" aria-hidden="true"
                style={{ left: `${tick}%`, backgroundColor: tick <= barWidth ? 'rgba(255,255,255,0.8)' : 'rgba(120,113,108,0.35)' }} />
            ))}
          </div>
          <div className="relative mt-1 h-3.5 text-[10px] font-semibold text-gray-400" aria-hidden="true">
            {QUARTERS.map(tick => <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${tick}%` }}>{tick}</span>)}
            <span className="absolute right-0">100%</span>
          </div>
        </div>
        <div className="water-metric mt-2 rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-[11px] font-semibold text-gray-500">เทียบกับรายงานก่อนหน้า</p>
          <p className={`inline-flex items-center gap-1 text-sm font-bold ${showSame ? 'text-gray-800' : TREND_CLASS[summary.trend?.dir] ?? 'text-gray-800'}`}>
            {!showSame && summary.trend && <TrendIcon size={15} />} {trendText(summary)}
          </p>
        </div>
        <ReservoirSpark rows={report.rows} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        {stale
          ? <span className="text-amber-700">ไม่มีรายงานใหม่ตั้งแต่ {formatReportDate(latest.d)} (ผ่านมา {ageDays} วัน)</span>
          : showSame
            ? <span className="text-amber-700">{dayText} ใช้ตัวเลขชุดเดิม</span>
            : <span className="text-gray-500">{dayText}{ageDays > 0 && ` · ผ่านมา ${ageDays} วัน`}</span>}
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-blue-700">
          ต้นฉบับ <ExternalLink size={13} />
        </a>
      </div>
    </div>
  )
}

/**
 * อ่างเก็บน้ำขนาดเล็กจากผังน้ำออนไลน์แพร่ — แสดงเฉพาะ อปท. ที่อยู่ใน SMALL_RESERVOIR_TENANTS
 * ไม่ส่งเข้า Telegram/แถบหน้าแรก/ภาพแชร์ ตั้งใจ: รายสัปดาห์ บันทึกด้วยมือ มีค่าผิดโดดและค่าซ้ำเดิม
 * ถ้าเอาไปเตือนจะเตือนผิดบ่อย (บทเรียน #330 — กติกาสำรองที่ถูกจุดชนวนด้วยข้อมูลต้นทางเพี้ยนส่งเตือนผิดเข้ากลุ่มจริงมาแล้ว)
 */
export default function SmallReservoirSection({ slug, tenantName, now }) {
  const tenant = Object.hasOwn(SMALL_RESERVOIR_TENANTS, slug || '') ? SMALL_RESERVOIR_TENANTS[slug] : null
  if (!tenant) return null
  return (
    <section id="water-small-dams" className="water-dam-panel mt-4 space-y-3">
      <div className="water-section-heading flex items-start gap-2.5 px-1">
        <Dam size={19} className="mt-0.5 shrink-0 text-blue-700" />
        <div>
          <h2 className="text-sm font-bold text-gray-800">อ่างเก็บน้ำขนาดเล็ก</h2>
          {/* ล็อกแต่ละวลีไม่ให้เบราว์เซอร์ตัดกลางคำ (ภาษาไทยไม่มีช่องว่างคั่นคำ) เหมือน DamSection */}
          <p className="text-xs text-gray-500">
            <span className="whitespace-nowrap">รายงานรายสัปดาห์</span> ·{' '}
            <span className="whitespace-nowrap">บันทึกด้วยมือ</span> ·{' '}
            <span className="whitespace-nowrap">ศูนย์บริหารจัดการทรัพยากรน้ำจังหวัดแพร่</span>
          </p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {tenant.ids.map(id => <ReservoirCard key={id} id={id} scope={tenant.scope} now={now} />)}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-gray-500">
        <p>
          เปอร์เซ็นต์คิดเทียบความจุของอ่างตามที่ต้นทางรายงาน ระบบ<b>ไม่ใช้ป้าย "น้ำดี/น้ำมาก" ของต้นทาง</b> เพราะป้ายกับตัวเลขไม่สอดคล้องกันบางรายงาน
          และ<b>ไม่ลงสีสถานการณ์เอง</b> · ค่าบันทึกด้วยมือ อาจพิมพ์ผิดหรือซ้ำเดิมได้ · ไม่ใช่ประกาศเตือนภัยของ{tenantName || 'หน่วยงาน'}
        </p>
        <a href={RESERVOIR_SOURCE} target="_blank" rel="noopener noreferrer"
          className="mt-1 inline-flex min-h-[44px] items-center gap-1 font-semibold text-blue-700">
          ดูผังน้ำออนไลน์แพร่ที่ต้นทาง <ExternalLink size={12} />
        </a>
      </div>
    </section>
  )
}

function ReservoirCard({ id, scope, now }) {
  const { report, failed, done } = useReservoirReport(id)
  return <ReservoirCardView meta={SMALL_RESERVOIRS[id]} link={reservoirReportUrl(id)} scope={scope} report={report} failed={failed} done={done} id={id} now={now} />
}
