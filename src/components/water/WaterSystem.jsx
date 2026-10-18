import { useState } from 'react'
import { ExternalLink, Waves } from 'lucide-react'
import RelationPill from './RelationPill'
import { useDamHistory } from './useDamHistory'
import {
  NO_LIVE_TEXT, STALE_DIAGRAM_MONTHS, SYSTEM_DISCLAIMER_LINE, TREND_MIN_DAYS, UPSTREAM_DEPTH_NOTE, bangkokISODate, damTrendSummary, diagramAge, liveState,
  relationOf, resolveSystem, systemById, thaiDate, trendFactText,
} from '../../lib/waterSystem/model'
import { DAM_STALE_HOURS, damSameInfo, damSameText, dataDayText, distanceText, isStale, stationPlace, toNum } from '../../lib/waterSituation'

// ส่วน "ระบบน้ำของตำบล" บน /water-situation (ดีไซน์ฉบับปิด docs/water-system.md) — อ่านอย่างเดียว ไม่มีช่องกรอก
//   ก่อนถึงตำบล → ในตำบล → ไหลต่อไปที่ + การ์ดแหล่งน้ำที่เกี่ยวข้อง (ค่าสด + แนวโน้ม 30 วันของอ่างต้นน้ำ) + "ผังมีแต่เราไม่ได้ใส่" + ที่มา/อายุผัง
// ค่าสดมาจาก stations ที่หน้าโหลดอยู่แล้ว · แนวโน้มมาจาก get_public_dam_history (เรียกครั้งเดียว) · ไม่พยากรณ์ ไม่บอกเวลาน้ำถึง

const KIND_ICON = { stream: '≋', reservoir: '▲', weir: '┃', canal: '≋', pond: '◯', pump: 'Ⓟ', supply: '⊠', gauge: '◉', rain: '◉' }
const COLLAPSED_COUNT = 3

function Tag({ tone, children }) {
  const tones = {
    live: 'border-emerald-400 bg-emerald-50 text-emerald-800',
    none: 'border-gray-300 bg-gray-100 text-gray-600',
    plan: 'border-red-300 bg-red-50 text-red-700',
    unk: 'border-amber-300 bg-amber-50 text-amber-900',
  }
  return <span className={`ml-1.5 inline-block whitespace-nowrap rounded-full border px-2 py-0 align-middle text-[11px] font-bold ${tones[tone]}`}>{children}</span>
}

function NodeItem({ node, stations }) {
  const live = liveState(node, stations)
  const dashed = node.status === 'planned' ? 'border-dashed border-red-300 text-red-800'
    : node.status === 'unconfirmed' ? 'border-dashed border-amber-400 bg-amber-50'
      : 'border-gray-200'
  return (
    <li data-node={node.id} data-status={node.status} className={`flex items-start gap-2 rounded-xl border bg-white px-2.5 py-1.5 text-sm ${dashed}`}>
      <span aria-hidden="true" className="mt-0.5 w-5 shrink-0 text-center font-bold text-sky-700">{KIND_ICON[node.kind] ?? '•'}</span>
      <span className="min-w-0">
        <span className="font-semibold text-gray-900">{node.name}</span>
        {node.status === 'planned' && <Tag tone="plan">แผนก่อสร้าง</Tag>}
        {node.status === 'repair' && <Tag tone="plan">ชำรุด/ซ่อมแซม</Tag>}
        {node.status === 'unconfirmed' && <Tag tone="unk">ผังไม่ระบุ</Tag>}
        {live === 'live' && <Tag tone="live">ค่าสด</Tag>}
        {live === 'none' && <Tag tone="none">{NO_LIVE_TEXT}</Tag>}
        {node.note && <span className="block text-xs leading-snug text-gray-500">{node.note}</span>}
      </span>
    </li>
  )
}

function Step({ index, title, nodes, stations, footnote, lead }) {
  const [open, setOpen] = useState(false)
  const shown = open ? nodes : nodes.slice(0, COLLAPSED_COUNT)
  return (
    <div data-step={index} className="rounded-2xl border border-gray-200 bg-white p-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-sky-800">
        <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-700 text-xs text-white">{index}</span>
        {title}
      </h3>
      {lead && <p className="mt-1 text-xs leading-snug text-gray-600">{lead}</p>}
      <ul className="mt-2 space-y-1.5">
        {shown.map(node => <NodeItem key={node.id} node={node} stations={stations} />)}
      </ul>
      {nodes.length > COLLAPSED_COUNT && (
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
          className="mt-1 inline-flex min-h-[44px] items-center text-sm font-bold text-sky-700">
          {open ? 'ย่อรายการ' : `ดูทั้งหมด ${nodes.length} รายการ`}
        </button>
      )}
      {footnote && <p className="mt-1 text-xs text-gray-500">{footnote}</p>}
    </div>
  )
}

function TrendChart({ chart, label }) {
  const { width, height, pad } = chart
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={label}>
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#cbd5e1" strokeWidth="1" />
      <line x1={pad} y1={pad} x2={width - pad} y2={pad} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
      <text x={pad + 1} y={pad + 9} fontSize="9" fill="#94a3b8">{chart.top === 100 ? '100%' : `${chart.top.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`}</text>
      <text x={pad + 1} y={height - pad - 3} fontSize="9" fill="#94a3b8">0%</text>
      {chart.paths.map((d, i) => <path key={i} d={d} fill="none" stroke="#0b6b8f" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />)}
      {chart.dots.map((dot, i) => <circle key={i} cx={dot.x} cy={dot.y} r="3" fill="#0b6b8f" />)}
    </svg>
  )
}

function TrendPanel({ history, code }) {
  if (history.status === 'loading') return <div className="mt-3 h-[72px] animate-pulse rounded-xl bg-gray-100" aria-hidden="true" />
  if (history.status !== 'ok') return null // โหลดไม่สำเร็จ = ซ่อนเฉพาะกราฟ ไม่แสดง error ดิบ
  const dam = history.dams.find(d => d.station_code === code)
  const summary = damTrendSummary(dam?.readings)
  if (summary.state === 'none') {
    return <p data-trend="none" className="mt-3 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500">ยังไม่มีประวัติค่าอ่างนี้ในระบบ</p>
  }
  if (summary.state === 'building') {
    return (
      <p data-trend="building" className="mt-3 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600">
        เริ่มเก็บแนวโน้มเมื่อ {thaiDate(bangkokISODate(Date.parse(summary.since)))} · จะแสดงกราฟเมื่อมีข้อมูลครบ {TREND_MIN_DAYS} วัน (อีก {summary.needDays} วัน)
      </p>
    )
  }
  const factText = trendFactText(summary.facts)
  return (
    <div data-trend="ready" className="mt-3">
      <TrendChart chart={summary.chart} label={`แนวโน้มปริมาณน้ำในอ่าง ${summary.days} วัน ต่ำสุด ${summary.chart.min.toLocaleString('th-TH')}% สูงสุด ${summary.chart.max.toLocaleString('th-TH')}%`} />
      <p className="text-xs text-gray-600">
        {factText ? `${factText} · ` : ''}ค่าที่วัดได้ {summary.chart.min.toLocaleString('th-TH', { maximumFractionDigits: 1 })}–{summary.chart.max.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%
        {' '}· เส้นขาดตรงช่วงที่ไม่มีข้อมูล · ไม่ใช่การพยากรณ์
      </p>
    </div>
  )
}

function RelatedDamCard({ code, station, relation, system, history, now, homeAmphoe }) {
  const percent = toNum(station.storage_percent)
  const hasValue = Boolean(station.recorded_at) && toNum(station.dam_storage_mcm) !== null
  const stale = Boolean(station.recorded_at) && isStale(station.recorded_at, now, DAM_STALE_HOURS)
  const same = hasValue && !stale ? damSameInfo(station) : null
  const day = dataDayText(station.recorded_at, now)
  const meta = [stationPlace(station, homeAmphoe), distanceText(station.distance_km), hasValue ? (day === 'วันนี้' ? 'ข้อมูลของวันนี้' : `ข้อมูลวันที่ ${day}`) : ''].filter(Boolean).join(' · ')
  const wantsTrend = relation.key === 'upstream' || relation.key === 'inside'
  return (
    <div data-related-dam={code} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-bold leading-tight text-gray-900">{station.station_name}</p>
          <p className="mt-0.5 text-xs text-gray-500">{meta}</p>
        </div>
        <RelationPill relation={relation} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        {hasValue && percent !== null && !stale
          ? <span className="text-3xl font-bold text-gray-900">{percent.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%</span>
          : <span className="text-sm text-gray-500">{hasValue && stale ? `ไม่มีข้อมูลใหม่ตั้งแต่ ${day}` : NO_LIVE_TEXT}</span>}
        {hasValue && !stale && <Tag tone="live">ค่าสด</Tag>}
      </div>
      {same && <p className="mt-1 text-xs font-semibold text-amber-800">{damSameText(same, now)} — ต้นทางอาจยังไม่ได้ปรับข้อมูล</p>}
      {relation.note && <p className="mt-2 text-xs leading-snug text-gray-600">{relation.note}</p>}
      {wantsTrend && <TrendPanel history={history} code={code} />}
      {percent !== null && percent > 100 && <p className="mt-1 text-xs text-gray-500">เกิน 100% = เกินความจุที่ระดับเก็บกักปกติ</p>}
      {system && <a href={`#water-dam-${code}`} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-bold text-sky-700">ดูรายละเอียดอ่างนี้ในหัวข้ออ่างเก็บน้ำ ↑</a>}
    </div>
  )
}

export default function WaterSystem({ slug, tenantId, stations, now, previewId, homeAmphoe }) {
  const selection = resolveSystem(slug, previewId)
  const system = selection ? systemById(selection.system) : null
  const history = useDamHistory(tenantId, Boolean(system))
  if (!system) return null

  const age = diagramAge(system, now)
  const related = Object.entries(system.relations)
    .filter(([key]) => key.startsWith('dam:'))
    .map(([key]) => ({ code: key.slice(4), station: (stations || []).find(s => s.station_type === 'dam' && s.station_code === key.slice(4)), relation: relationOf(system, 'dam', key.slice(4)) }))
    .filter(item => item.station && item.relation)

  return (
    <section id="water-system" data-water-system={system.id} className="space-y-3" aria-labelledby="water-system-title">
      <div className="water-section-heading flex items-start gap-2.5 px-1">
        <Waves size={19} className="mt-0.5 shrink-0 text-sky-700" />
        <div>
          <h2 id="water-system-title" className="text-sm font-bold text-gray-800">ระบบน้ำของตำบล{system.tambon}</h2>
          <p className="text-xs text-gray-500">น้ำไหลมาจากไหน ผ่านอะไรในตำบล และไหลต่อไปที่ไหน — ตามผังของศูนย์บริหารจัดการน้ำจังหวัดแพร่</p>
          {selection?.scope && <p className="mt-0.5 text-xs font-semibold text-amber-700">{selection.scope}</p>}
        </div>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900" data-system-disclaimer>
        <b>{SYSTEM_DISCLAIMER_LINE}</b>
        <span className="block text-[11px] text-amber-800">
          ผังตำบลอายุ {age?.text} ({age?.dateText}) · ผังจังหวัด (ไฟล์ {thaiDate(system.sources.find(s => s.id === 'province')?.date)})
        </span>
        {age?.stale && <span data-stale-band className="mt-1 block font-bold">ผังต้นฉบับอายุเกิน {STALE_DIAGRAM_MONTHS / 12} ปี — โครงสร้างอาจเปลี่ยนไปแล้ว</span>}
      </div>

      <p className="px-1 text-xs leading-relaxed text-gray-600">{system.summary}</p>

      <div className="space-y-2 lg:grid lg:grid-cols-3 lg:items-start lg:gap-3 lg:space-y-0">
        <Step index={1} title="ก่อนถึงตำบล" nodes={system.upstream} stations={stations} footnote={UPSTREAM_DEPTH_NOTE} />
        <Step index={2} title="ในตำบล" nodes={system.inside} stations={stations}
          lead={`อ่าง ${system.counts.reservoirs} แห่ง · ฝายประมาณ ${system.counts.weirs} แห่ง · สระ ${system.counts.ponds} แห่ง · ห้วยสาขาประมาณ ${system.counts.tributaries} สาย · แผนก่อสร้าง ${system.counts.planned} รายการ`} />
        <Step index={3} title="ไหลต่อไปที่" nodes={system.downstream} stations={stations} />
      </div>

      {related.length > 0 && (
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {related.map(item => (
            <RelatedDamCard key={item.code} code={item.code} station={item.station} relation={item.relation} system={system}
              history={history} now={now} homeAmphoe={homeAmphoe} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-gray-600" data-system-omitted>
        <p className="font-bold text-gray-800">ผังต้นฉบับมี แต่เราไม่ได้ใส่</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {system.omitted.map(item => <li key={item.name}><span className="font-semibold">{item.name}</span> — {item.reason}</li>)}
        </ul>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-gray-600" data-system-source>
        <p className="font-bold text-gray-800">ที่มาของข้อมูล</p>
        <p className="mt-1">
          ถอดจากผังของศูนย์บริหารจัดการน้ำจังหวัดแพร่ โดยระบบ SmartLocal: {system.sources.map(s => `${s.name} (${s.fileDateOnly ? `ไฟล์ลงวันที่ ${thaiDate(s.date)} ภาพไม่ระบุวันที่` : thaiDate(s.date)})`).join(' · ')}
          {' '}· ยังไม่ผ่านการยืนยันโดย อบต. · ไม่ใช่เอกสารทางราชการ
        </p>
        <a href={system.originalUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-[44px] items-center gap-1 font-bold text-sky-700">
          ดูผังต้นฉบับ <ExternalLink size={12} />
        </a>
      </div>
    </section>
  )
}
