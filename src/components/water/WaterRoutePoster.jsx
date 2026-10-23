import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import './WaterRoutePoster.css'
import { CHIP_TONES } from '../../lib/waterDiagram/model'
import { pillFor, pillWidth, smoothPath } from '../../lib/waterDiagram/route'
import {
  POSTER_DISCLAIMER, POSTER_THEMES, posterIcon, posterLiveRows, posterOmittedNames, posterPrintCss, posterStats,
} from '../../lib/waterDiagram/poster'
import { GOV_FONT_SIZE_ADJUST, GOV_FONT_STACK } from '../../lib/govDocStyle'

// โปสเตอร์ "ภาพนำเสนอ A4" ของแผนภาพเส้นทางน้ำ — ภาพประกอบอินโฟกราฟิกแนวนอนแผ่นเดียว ไว้ดูบนจอ/พิมพ์ไปนำเสนอ
// ข้อมูล: ตำแหน่งจาก route.poster · ชื่อ/สถานะ/เส้นวิ่งจาก route เดิม · ค่าสดจาก badges (liveBadges) เท่านั้น
// ⚠️ ไม่ใช่แผนที่ · ไม่มีเข็มทิศ · เส้นที่มีหัวลูกศร/วิ่งต้องเป็นลำที่ผังวาดลูกศรเท่านั้น (posterIssues ตรวจ)

const THEME_LABELS = { dark: 'ธีมมืด', light: 'ธีมสว่าง (ประหยัดหมึก)' }

// ── สัญลักษณ์ในโนด (ตัดสินจาก posterIcon) ──
function WeirIcon({ n }) {
  return (
    <g>
      <rect x="-11" y="-8" width="22" height="5" rx="1.5" fill="#e2e8f0" />
      <rect x="-11" y="-2" width="22" height="5" rx="1.5" fill="#94a3b8" />
      <path d="M-11 7Q-6 4 -2 7T7 7T11 7" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
      {n > 1 && (
        <g transform="translate(13 9)">
          <rect x="-9" y="-7" width="18" height="13" rx="6.5" className="wp-chip" />
          <text y="3.5" textAnchor="middle" fontSize="10" fontWeight="800" className="wp-ink">×{n}</text>
        </g>
      )}
    </g>
  )
}

function Icon({ icon, u }) {
  switch (icon.kind) {
    case 'weir': return <WeirIcon n={icon.n} />
    case 'lake':
      return (
        <g>
          <ellipse cx="0" cy="1" rx="13" ry="8" fill={icon.na ? 'none' : u('water')} stroke={icon.na ? '#94a3b8' : '#e0f2fe'} strokeWidth="1.8" strokeDasharray={icon.na ? '3 2.5' : undefined} />
          {!icon.na && <path d="M-9 1Q-5 -2 -1 1T7 1" fill="none" stroke="#fff" strokeWidth="1.4" opacity=".85" />}
        </g>
      )
    case 'pond':
      return (
        <g>
          {Array.from({ length: icon.n }, (_, i) => (
            <ellipse key={i} cx={icon.n === 1 ? 0 : (i - (icon.n - 1) / 2) * 11} cy={icon.n === 1 ? 2 : i % 2 ? 5 : 0}
              rx={icon.n === 1 ? 12 : 6} ry={icon.n === 1 ? 6 : 3.4} fill={u('water')} stroke="#e0f2fe" strokeWidth="1.2" />
          ))}
        </g>
      )
    case 'creeks':
      return (
        <g stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" fill="none">
          {Array.from({ length: Math.min(icon.n, 9) }, (_, i) => {
            const x = (i - (Math.min(icon.n, 9) - 1) / 2) * 6
            return <path key={i} d={`M${x} -9Q${x / 2} 0 0 9`} />
          })}
        </g>
      )
    case 'village':
      return (
        <g>
          <rect x="-12" y="0" width="10" height="8" fill="#fde68a" /><path d="M-14 0L-7 -7L0 0Z" fill="#b45309" />
          <rect x="1" y="-2" width="12" height="10" fill="#fef3c7" /><path d="M-1 -2L7 -10L15 -2Z" fill="#92400e" />
        </g>
      )
    case 'gate': return <path d="M0 -10L10 0L0 10L-10 0Z" fill="#7c3aed" stroke="#c4b5fd" strokeWidth="1.5" />
    case 'bridge':
      return <g><rect x="-12" y="-2" width="24" height="4" fill="#dbe2ea" /><rect x="-12" y="2" width="24" height="3" fill="#6b7b8e" /><path d="M-9 -2V-8M0 -2V-8M9 -2V-8" stroke="#dbe2ea" strokeWidth="1.6" /></g>
    case 'supply':
      return <g><rect x="-8" y="-9" width="16" height="9" rx="3" fill="#38bdf8" /><path d="M-6 0L-9 9M6 0L9 9" stroke="#94a3b8" strokeWidth="2" /></g>
    case 'plan':
      return (
        <g style={{ stroke: 'var(--plan)' }} strokeWidth="1.8" fill="none" strokeLinejoin="round">
          <path d="M0 -10L9 -5V5L0 10L-9 5V-5Z" strokeDasharray="3 2.2" />
          <path d="M0 0V10M0 0L9 -5M0 0L-9 -5" opacity=".8" />
        </g>
      )
    default: return null
  }
}

// ── โนดของจุด: วงเรืองแสง + วงกลม + สัญลักษณ์ + หมายเลข (+ ป้าย "แผน" ถ้าแผนก่อสร้าง) ──
function Node({ stop, node, badges, u }) {
  const plan = stop.status === 'planned'
  const na = (stop.tags ?? []).some(tag => tag.k === 'na') || posterIcon(stop).na === true
  const r = node.big ? 38 : node.r ?? 19
  const ringBadge = node.ring ? badges[node.ring] : null
  const ringTone = ringBadge?.tone ?? 'na'
  const pct = ringBadge ? Number.parseFloat(ringBadge.short) : Number.NaN
  const circ = 2 * Math.PI * (r - 6)
  const showFill = Number.isFinite(pct) && (ringTone === 'ok' || ringTone === 'warn')
  const fill = showFill ? circ * Math.min(100, Math.max(0, pct)) / 100 : 0
  const center = ringTone === 'stale' ? 'ค้าง' : ringTone === 'na' ? 'ไม่มีค่า' : ringBadge?.short
  return (
    <g data-poster-node={stop.n} data-status={stop.status} transform={`translate(${node.x} ${node.y})`}>
      <circle r={r + 14} fill={u('glow')} opacity={plan ? 0.35 : 0.9} />
      <circle r={r} className="wp-node" strokeWidth="2.2" strokeDasharray={plan || na ? '4 3' : undefined}
        style={{ stroke: plan ? 'var(--plan)' : na ? 'var(--na)' : 'var(--ring)' }} />
      {node.big ? (
        <g data-poster-ring={node.ring} data-tone={ringTone}>
          <circle r={r - 6} fill="none" stroke="rgba(148,163,184,.3)" strokeWidth="6" strokeDasharray={ringTone === 'stale' || ringTone === 'na' ? '4 4' : undefined} />
          {fill > 0 && (
            <circle r={r - 6} fill="none" stroke={ringTone === 'warn' ? '#d97706' : u('ring')} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${fill} ${circ}`} transform="rotate(-90)" />
          )}
          <text y={ringTone === 'ok' || ringTone === 'warn' ? 7 : 5} textAnchor="middle" fontSize={ringTone === 'ok' || ringTone === 'warn' ? 20 : 14} fontWeight="800" className="wp-ink">{center}</text>
          {ringBadge?.note && (
            <text x={node.label[0] - node.x} y={node.label[1] - node.y + 16} textAnchor={node.label[2]} fontSize="11.5" fontWeight="800" className="wp-lbl"
              style={{ fill: CHIP_TONES[ringTone]?.stroke }}>{ringBadge.note}</text>
          )}
        </g>
      ) : <Icon icon={posterIcon(stop)} u={u} />}
      <g transform={`translate(${-r + 3} ${-r + 3})`}>
        <circle r="11" fill="#0ea5e9" stroke="#fff" strokeWidth="2" />
        <text y="4.4" textAnchor="middle" fontSize={stop.n > 9 ? 12 : 13} fontWeight="800" fill="#fff">{stop.n}</text>
      </g>
      {plan && (
        <g transform={`translate(${r + 20} 0)`}>
          <rect x="-18" y="-10" width="36" height="20" rx="10" className="wp-chip" strokeDasharray="3 2" style={{ stroke: 'var(--plan)' }} />
          <text y="4.5" textAnchor="middle" fontSize="12" fontWeight="800" style={{ fill: 'var(--plan)' }}>แผน</text>
        </g>
      )}
    </g>
  )
}

// ป้ายค่าสดแคปซูลขาว (โทนตาม CHIP_TONES เหมือนป้ายบนแผนภาพ) — ไม่มีค่า/ค้าง = ขอบประเทา บอกตรงๆ
function LivePill({ cx, cy, badge, slot }) {
  const tone = CHIP_TONES[badge.tone] ?? CHIP_TONES.na
  const text = badge.tone === 'stale' ? 'ไม่มีค่าใหม่' : badge.short
  const width = Math.max(92, pillWidth(text, 14) + 26)
  return (
    <g data-poster-pill={slot} data-tone={badge.tone} transform={`translate(${cx} ${cy})`}>
      <rect x={-width / 2} y="-13" width={width} height="26" rx="13" fill="#fff" stroke={tone.stroke} strokeWidth="2.2" strokeDasharray={tone.dash ? '5 4' : undefined} />
      <path d="M-4 -6Q1 2 -4 6Q-9 2 -4 -6Z" transform={`translate(${-width / 2 + 17} 0)`} fill={tone.stroke} opacity=".85" />
      <text x="6" y="5" textAnchor="middle" fontSize="14" fontWeight="800" fill={tone.ink}>{text}</text>
      {badge.note && badge.note !== text && <text y="28" textAnchor="middle" fontSize="11" fontWeight="800" className="wp-lbl" style={{ fill: tone.stroke }}>{badge.note}</text>}
    </g>
  )
}

const thaiDateTime = now => new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok',
}).format(new Date(now))

const CONTOURS = Array.from({ length: 9 }, (_, i) => {
  const y0 = 150 + i * 70
  const a = 18 + (i % 3) * 8
  return `M-20 ${y0} ${Array.from({ length: 13 }, (_, k) => `Q${k * 100 + 50} ${y0 + (k % 2 ? a : -a)} ${k * 100 + 100} ${y0}`).join(' ')}`
})

export function WaterRoutePoster({ route, diagram, badges, now, theme = 'dark' }) {
  // id ของ defs ผูกกับโปสเตอร์ใบนี้ — ในหน้าอาจมี 2 ใบพร้อมกัน (ภาพในหน้า + หน้าต่างพิมพ์) ถ้า id ซ้ำ url(#…) จะชี้ไปใบแรกเสมอ ธีมของอีกใบเพี้ยน
  const uid = useId().replace(/:/g, '')
  const id = name => `${uid}-${name}`
  const u = name => `url(#${uid}-${name})`
  const poster = route.poster
  const { w, h } = poster.viewBox
  const stats = posterStats(route)
  const rows = posterLiveRows(route, badges)
  const stopsByN = new Map(route.stops.map(stop => [stop.n, stop]))
  const omitted = posterOmittedNames(diagram)
  const hasFlow = poster.streams.some(s => s.flow)
  const hasPlan = route.stops.some(s => s.status === 'planned')
  const hasNa = route.stops.some(s => posterIcon(s).na === true || (s.tags ?? []).some(tag => tag.k === 'na'))
  const hasLive = Object.values(poster.nodes).some(n => n.ring || n.pill)
  const legend = [
    hasFlow && { key: 'flow', text: 'เส้นวิ่ง = ผังวาดลูกศรทิศน้ำไว้' },
    hasPlan && { key: 'plan', text: 'กรอบแดงประ = แผนก่อสร้าง ไม่เคลื่อนไหว' },
    hasNa && { key: 'na', text: 'ขอบประเทา = ไม่มีข้อมูลในระบบ' },
    hasLive && { key: 'live', text: 'ป้ายขาว = ค่าวัดจากสถานี' },
  ].filter(Boolean)
  const tiles = [
    [stats.points, 'จุดสำคัญ'], [stats.lanes, 'สายน้ำในผัง'], [stats.planned, 'แผนก่อสร้าง'], [stats.gauges, 'จุดวัดค่า'],
  ]
  const card = poster.callouts?.[0]
  const river = poster.river
  const riverStop = route.river

  return (
    <svg className="wp-poster" data-poster data-theme={theme} viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`ภาพนำเสนอ ${route.heading} ภาพประกอบ ${stats.points} จุด ไม่ตรงตำแหน่ง ทิศ และมาตราส่วนจริง`}
      style={{ fontFamily: GOV_FONT_STACK, fontSizeAdjust: GOV_FONT_SIZE_ADJUST }}>
      <defs>
        <linearGradient id={id('bg')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--bg0)" /><stop offset=".5" stopColor="var(--bg1)" /><stop offset="1" stopColor="var(--bg2)" /></linearGradient>
        <radialGradient id={id('center')}><stop offset="0" stopColor="var(--glow)" stopOpacity=".55" /><stop offset="1" stopColor="var(--glow)" stopOpacity="0" /></radialGradient>
        <radialGradient id={id('glow')}><stop offset=".55" stopColor="var(--glow)" stopOpacity=".55" /><stop offset="1" stopColor="var(--glow)" stopOpacity="0" /></radialGradient>
        <linearGradient id={id('stream')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--w1)" /><stop offset="1" stopColor="var(--w2)" /></linearGradient>
        <linearGradient id={id('water')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7dd3fc" /><stop offset="1" stopColor="#0284c7" /></linearGradient>
        <linearGradient id={id('ring')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#67e8f9" /><stop offset="1" stopColor="#3b82f6" /></linearGradient>
        <linearGradient id={id('title')} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--ink)" /><stop offset="1" stopColor="var(--w1)" /></linearGradient>
        <linearGradient id={id('river')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--riv1)" /><stop offset="1" stopColor="var(--riv2)" /></linearGradient>
        <filter id={id('blur')} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7" /></filter>
        <marker id={id('arrow')} viewBox="0 0 16 16" refX="11" refY="8" markerUnits="userSpaceOnUse" markerWidth="15" markerHeight="15" orient="auto"><path d="M0 0L16 8L0 16Z" fill="#fff" /></marker>
      </defs>

      <rect width={w} height={h} fill={u('bg')} />
      <ellipse cx={w / 2} cy="420" rx="520" ry="330" fill={u('center')} opacity=".5" />
      {CONTOURS.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--contour)" strokeWidth="1.6" />)}

      {/* หัว */}
      <text x="48" y="32" fontSize="16" fontWeight="700" letterSpacing="3" fill="var(--w1)">{route.eyebrow}</text>
      <text x="46" y="92" fontSize="58" fontWeight="800" fill={u('title')}>{route.title}</text>
      <text x="48" y="112" fontSize="12" className="wp-muted">{route.place}</text>

      {/* คำอธิบายสัญลักษณ์ (เฉพาะที่โปสเตอร์ใช้จริง) */}
      <g data-poster-legend>
        <rect x="344" y="22" width="246" height={16 + legend.length * 17} rx="14" className="wp-glass" />
        {legend.map((item, i) => (
          <g key={item.key} transform={`translate(356 ${42 + i * 17})`}>
            {item.key === 'flow' && <><path d="M0 0H18" stroke={u('stream')} strokeWidth="4.5" strokeLinecap="round" /><path d="M18 -5L26 0L18 5Z" fill="var(--w1)" /></>}
            {item.key === 'plan' && <path d="M12 -6L19 -3V4L12 7L5 4V-3Z" fill="none" strokeDasharray="2.5 2" style={{ stroke: 'var(--plan)' }} />}
            {item.key === 'na' && <ellipse cx="12" cy="0" rx="9" ry="5.5" fill="none" strokeDasharray="3 2" style={{ stroke: 'var(--na)' }} />}
            {item.key === 'live' && <rect x="2" y="-6" width="22" height="12" rx="6" fill="#fff" stroke="#0284c7" strokeWidth="1.6" />}
            <text x="30" y="4" fontSize="10.5" className="wp-ink2">{item.text}</text>
          </g>
        ))}
      </g>

      {tiles.map(([value, label], i) => (
        <g key={label} data-poster-tile={label} transform={`translate(${596 + i * 124} 20)`}>
          <rect width="114" height="64" rx="16" className="wp-tile" />
          <text x="57" y="37" textAnchor="middle" fontSize="31" fontWeight="800" fill={u('title')}>{value}</text>
          <text x="57" y="55" textAnchor="middle" fontSize="12" fontWeight="700" className="wp-ink2">{label}</text>
        </g>
      ))}

      {/* การ์ดห้วยตอนบน */}
      {card && (
        <g data-poster-callout={card.id}>
          <rect x={card.x} y={card.y} width={card.w} height={card.h} rx="14" className="wp-glass" />
          <text x={card.x + 14} y={card.y + 18} fontSize="11.5" fontWeight="800" fill="var(--w1)">{card.title}</text>
          {card.lines.map((line, i) => (
            <text key={line.head} x={card.x + 14} y={card.y + 34 + i * 15} fontSize="11" className="wp-ink2">{line.head} {line.names.join(' · ')}</text>
          ))}
          <path d={`M${card.link[0]} ${card.link[1]} L${card.link[2]} ${card.link[3]}`} stroke="var(--glassStroke)" strokeWidth="1.5" strokeDasharray="3 3" />
        </g>
      )}

      {/* การ์ดค่าวัดล่าสุด */}
      {rows.length > 0 && (
        <g data-poster-live-card>
          <rect x="800" y={178 - (30 + rows.length * 16)} width="284" height={30 + rows.length * 16} rx="14" className="wp-glass" />
          <text x="814" y={178 - (30 + rows.length * 16) + 19} fontSize="11.5" fontWeight="800" fill="var(--w1)">ค่าวัดล่าสุดจากสถานี</text>
          {rows.map((row, i) => (
            <text key={row.slot} data-poster-live-row={row.slot} x="814" y={178 - (30 + rows.length * 16) + 36 + i * 16} fontSize="11" className="wp-ink2">
              {row.label}: {row.value}{row.note ? ` · ${row.note}` : ''}
            </text>
          ))}
        </g>
      )}

      {/* โซนแยกสาย */}
      {poster.zones.map(zone => (
        <g key={zone.group} data-poster-zone={zone.tone}>
          <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="18" className="wp-glass" style={{ stroke: `var(--${zone.tone})` }} />
          <rect x={zone.x} y={zone.y + 8} width="5" height={zone.h - 16} rx="2.5" style={{ fill: `var(--${zone.tone})` }} />
          <text x={zone.x + 16} y={zone.y + 20} fontSize="12" fontWeight="800" style={{ fill: `var(--${zone.tone})` }}>{zone.title}</text>
        </g>
      ))}

      {/* ลำน้ำปลายทาง (จุดสุดท้าย) — หัวลูกศรชี้ซ้ายตามผัง */}
      {riverStop && (
        <g data-poster-node={riverStop.n} data-poster-river>
          <rect x={river.x} y={river.y} width={river.w} height={river.h} rx={river.h / 2} fill={u('river')} />
          <path d={`M${river.x + 20} ${river.y + 20}Q${river.x + 50} ${river.y + 12} ${river.x + 80} ${river.y + 20}T${river.x + 140} ${river.y + 20}T${river.x + 200} ${river.y + 20}T${river.x + 260} ${river.y + 20}T${river.x + 320} ${river.y + 20}T${river.x + 380} ${river.y + 20}T${river.x + 440} ${river.y + 20}T${river.x + 500} ${river.y + 20}T${river.x + 560} ${river.y + 20}T${river.x + 620} ${river.y + 20}T${river.x + 680} ${river.y + 20}T${river.x + 740} ${river.y + 20}T${river.x + 800} ${river.y + 20}T${river.x + 860} ${river.y + 20}T${river.x + 920} ${river.y + 20}T${river.x + 980} ${river.y + 20}`}
            fill="none" stroke="#fff" strokeOpacity=".3" strokeWidth="2" />
          <path d={`M${river.x + 56} ${river.y + 20}H${river.x + 10}`} stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
          <path d={`M${river.x + 22} ${river.y + 8}L${river.x + 6} ${river.y + 20}L${river.x + 22} ${river.y + 32}Z`} fill="#fff" />
          <g transform={`translate(${river.x + 90} ${river.y + 20})`}>
            <circle r="13" fill="#0ea5e9" stroke="#fff" strokeWidth="2" />
            <text y="4.8" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff">{riverStop.n}</text>
          </g>
          <text x={river.x + 114} y={river.y + 27} fontSize="19" fontWeight="800" fill="#fff">{riverStop.name}</text>
          <text x={river.x + 262} y={river.y + 25} fontSize="12" fill="#e0f2fe">ปลายทางของลำน้ำแม่คำปอง · หัวลูกศรชี้ไปทางตะวันตกตามผัง</text>
        </g>
      )}

      {/* เส้นประแดงจากแผนก่อสร้างไปลำน้ำ — ไม่ใช่ลำน้ำ ไม่วิ่ง */}
      {Object.entries(poster.nodes).filter(([, node]) => node.stem).map(([n, node]) => (
        <path key={n} data-poster-stem={n} d={`M${node.x} ${node.y} L${node.stem[0]} ${node.stem[1]}`} fill="none" strokeWidth="2.2" strokeDasharray="5 4" opacity=".9" style={{ stroke: 'var(--plan)' }} />
      ))}

      {/* ลำน้ำ: เรืองแสง + ขอบ + สายน้ำ + ลายสว่างวิ่ง (เฉพาะ flow) */}
      {poster.streams.map(stream => {
        const d = smoothPath(stream.pts)
        return (
          <g key={stream.id} data-poster-stream={stream.id} data-flow={stream.flow ? 'true' : 'false'}>
            <path d={d} fill="none" stroke="var(--glow)" strokeWidth={stream.w + 12} strokeLinecap="round" opacity=".75" filter={u('blur')} />
            <path d={d} fill="none" stroke="var(--w3)" strokeWidth={stream.w + 3.5} strokeLinecap="round" markerEnd={stream.flow ? u('arrow') : undefined} />
            <path d={d} fill="none" stroke={u('stream')} strokeWidth={stream.w} strokeLinecap="round" />
            <path d={d} className={stream.flow ? 'wp-flow' : undefined} fill="none" stroke="#fff" strokeOpacity={stream.flow ? 0.95 : 0.35}
              strokeWidth={stream.flow ? 2.2 : 1.6} strokeLinecap="round" strokeDasharray={stream.flow ? '3 12' : undefined} />
          </g>
        )
      })}

      {Object.entries(poster.nodes).map(([n, node]) => <Node key={n} stop={stopsByN.get(Number(n))} node={node} badges={badges} u={u} />)}

      {Object.entries(poster.nodes).map(([n, node]) => (
        <text key={n} x={node.label[0]} y={node.label[1]} textAnchor={node.label[2]} fontSize="13.5" fontWeight="700" className="wp-lbl">
          {node.text ?? stopsByN.get(Number(n)).label}
        </text>
      ))}

      {Object.values(poster.nodes).filter(node => node.pill).map(node => {
        const info = pillFor({ slot: node.pill.slot }, badges)
        return info ? <LivePill key={node.pill.slot} slot={node.pill.slot} cx={node.pill.x} cy={node.pill.y} badge={{ tone: info.tone, short: info.main, note: info.note }} /> : null
      })}

      {/* ท้ายโปสเตอร์ — คำกำกับบังคับ · ที่มา · สิ่งที่ไม่ได้ใส่ */}
      <g data-poster-footer fontSize="10">
        <text x="48" y="767" className="wp-ink2"><tspan fontWeight="800">{POSTER_DISCLAIMER[0]}</tspan> · {POSTER_DISCLAIMER[1]} · {POSTER_DISCLAIMER[2]}</text>
        <text x="48" y="778" className="wp-muted">ที่มา: ผังน้ำศูนย์บริหารจัดการทรัพยากรน้ำจังหวัดแพร่ ({diagram.drawnLabel}) วาดใหม่ · ยังไม่ผ่านการยืนยันโดย อบต. · ข้อมูลสด ณ {thaiDateTime(now)}</text>
        <text x="48" y="789" className="wp-muted">ไม่ได้ใส่ในภาพนี้: {omitted.join(' · ')}</text>
      </g>
    </svg>
  )
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function WaterRoutePosterDialog({ route, diagram, badges, now, onClose }) {
  const [theme, setTheme] = useState(POSTER_THEMES[0])
  const overlay = useRef(null)
  const closeButton = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    const opener = document.activeElement
    closeButton.current?.focus()
    const style = document.createElement('style')
    style.dataset.posterPrint = ''
    style.textContent = posterPrintCss()
    document.head.append(style)
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab') return
      const items = [...overlay.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); style.remove(); opener?.focus?.() }
  }, [])

  return createPortal(
    <div ref={overlay} data-poster-overlay className="wp-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div data-poster-toolbar className="wp-toolbar">
        <p id={titleId} className="wp-title">ภาพนำเสนอ A4 · {route.title}</p>
        <div className="wp-group" role="group" aria-label="ธีมของภาพ">
          {POSTER_THEMES.map(key => (
            <button key={key} type="button" aria-pressed={theme === key} onClick={() => setTheme(key)} className="wp-btn wp-seg">{THEME_LABELS[key]}</button>
          ))}
        </div>
        <button type="button" className="wp-btn wp-primary" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> พิมพ์ / บันทึก PDF</button>
        <button ref={closeButton} type="button" className="wp-btn" onClick={onClose} aria-label="ปิดภาพนำเสนอ"><X size={16} aria-hidden="true" /> ปิด</button>
      </div>
      <p data-poster-hint className="wp-hint">
        ในหน้าต่างพิมพ์เลือกกระดาษ A4 แนวนอน และตั้งระยะขอบเป็น "ไม่มี" · พิมพ์ธีมสว่างจะประหยัดหมึกกว่า · บนมือถือเลื่อนภาพไปทางซ้าย/ขวาได้
      </p>
      <div data-poster-stage className="wp-stage">
        <div data-poster-sheet className="wp-sheet">
          <WaterRoutePoster route={route} diagram={diagram} badges={badges} now={now} theme={theme} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

const PANEL_BUTTON = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-400 bg-white px-3.5 text-sm font-bold text-slate-700 hover:bg-slate-50'

// ภาพนำเสนอที่วางในหน้าแทนภาพเกาะลอย (เจ้าของระบบสั่ง 2569-10-23 "เอาภาพนำเสนอ A4 มาใส่แทนภาพแรกเลย")
// ธีมมืดในหน้า · ปุ่ม "พิมพ์ / บันทึก PDF" เปิดหน้าต่างตัวอย่างหน้ากระดาษ (เลือกธีมสว่างประหยัดหมึกได้) — ตรรกะพิมพ์ที่ตรวจด้วย PDF จริงอยู่ในหน้าต่างนั้น
// มือถือ: ภาพกว้างขั้นต่ำ 900px เลื่อนแนวนอนในกรอบ (กรอบโฟกัสด้วยคีย์บอร์ดได้) · min-w-0 บนกรอบนอก: ไม่งั้นช่องกริดของหน้าขยายตามภาพ 900px แล้วดันทั้งหน้าให้ล้นจอ (เทสต์เลย์เอาต์ 360–768px ตรึงไว้)
export default function WaterRoutePosterPanel({ route, diagram, badges, now }) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  return (
    <div data-poster-panel className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={labelId} className="m-0 px-1 text-sm font-bold text-sky-950">ภาพนำเสนอ · พิมพ์ลงกระดาษ A4 แนวนอนแผ่นเดียวได้</p>
        <button type="button" className={PANEL_BUTTON} onClick={() => setOpen(true)} data-poster-open>
          <Printer size={16} aria-hidden="true" /> พิมพ์ / บันทึก PDF
        </button>
      </div>
      <div data-poster-inline role="region" aria-labelledby={labelId} tabIndex={0} className="wp-inline">
        <div className="wp-inline-sheet">
          <WaterRoutePoster route={route} diagram={diagram} badges={badges} now={now} theme={POSTER_THEMES[0]} />
        </div>
      </div>
      <p className="m-0 px-1 text-xs text-slate-500 lg:hidden">เลื่อนภาพไปทางซ้าย/ขวาเพื่อดูทั้งหมด</p>
      {open && <WaterRoutePosterDialog route={route} diagram={diagram} badges={badges} now={now} onClose={() => setOpen(false)} />}
    </div>
  )
}
