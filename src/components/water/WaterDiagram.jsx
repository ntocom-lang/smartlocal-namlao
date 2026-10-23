import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ExternalLink, Map as MapIcon, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react'
import './WaterDiagram.css'
import { useReservoirReport } from './useReservoirReport'
import { diagramById } from '../../lib/waterDiagram/diagrams'
import { originalDiagramUrl } from '../../lib/waterDiagram/originalFiles'
import { CHIP_TONES, EDGE_STYLES, chipWidth, isAnimated, isShimmer, liveBadges, resolveDiagram } from '../../lib/waterDiagram/model'
import { routeKinds } from '../../lib/waterDiagram/route'
import WaterRouteArt from './WaterRouteArt'
import WaterRouteList from './WaterRouteList'

// ภาพนำเสนอ A4 (โปสเตอร์) — ผังที่มี route.poster แสดงภาพนี้แทนภาพเกาะลอย · โหลดเฉพาะเมื่อผังนั้นถูกเปิด
const WaterRoutePosterPanel = lazy(() => import('./WaterRoutePoster'))
// รายการจุดแบบแผ่น A4 (จอ ≥ 1024px ของผังที่มี poster) — ใช้ร่วมกับหน้าต่างพิมพ์
const WaterRouteListSheet = lazy(() => import('./WaterRouteListSheet'))

const BLUE = '#4472c4'
const DARK = '#1f3864'
const RED = '#b91c1c'
const MODE_KEY = 'water-diagram-mode'
const MIN_ZOOM = 1
const MAX_ZOOM = 3
const MAP_MIN_WIDTH = 820
const FONT = "Sarabun,'Noto Sans Thai','Leelawadee UI',sans-serif"

// เก็บโหมดที่เลือกไว้ในแท็บนี้ — storage ใช้ไม่ได้ (โหมดส่วนตัว/ปิดคุกกี้) ต้องไม่ทำหน้าพัง
function readStoredMode() {
  try {
    const value = window.sessionStorage.getItem(MODE_KEY)
    return value === 'map' || value === 'lanes' ? value : null
  } catch { return null }
}
function storeMode(mode) {
  try { window.sessionStorage.setItem(MODE_KEY, mode) } catch { /* จำไม่ได้ก็เลือกใหม่ทุกครั้ง */ }
}
function initialMode() {
  return readStoredMode() ?? (window.matchMedia?.('(min-width: 768px)').matches ? 'map' : 'lanes')
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches))
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return undefined
    const onChange = event => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function Chip({ x, y, text, size = 19, tone }) {
  const style = CHIP_TONES[tone] ?? CHIP_TONES.na
  const width = chipWidth(text, size)
  return (
    <g>
      <rect x={x} y={y} width={width} height={32} rx={16} fill="#fff" stroke={style.stroke} strokeWidth={2.5} strokeDasharray={style.dash ? '5 4' : undefined} />
      <text x={x + width / 2} y={y + 22} textAnchor="middle" fontSize={size} fontWeight={700} fill={style.ink}>{text}</text>
    </g>
  )
}

function Edge({ el }) {
  const style = EDGE_STYLES[el.cls]
  const width = el.w ?? style.width
  const stroke = style.red ? RED : style.dark ? DARK : BLUE
  return (
    <>
      <path d={el.d} fill="none" stroke={stroke} strokeWidth={width} strokeLinejoin="round"
        strokeDasharray={style.red ? '14 10' : undefined}
        markerEnd={el.arrow ? `url(#wd-${style.marker})` : undefined}
        markerStart={el.both ? `url(#wd-${style.marker}S)` : undefined} />
      {isAnimated(el) && (
        <path className="wd-flow" d={el.d} strokeWidth={Math.max(2, width / 3)} strokeDasharray={style.dash}
          style={{ '--dur': `${style.dur}s`, '--period': `${style.period}px` }} />
      )}
      {isShimmer(el) && <path className="wd-shimmer" d={el.d} fill="none" stroke="#fff" strokeWidth={3} strokeOpacity={0.7} strokeDasharray="2 18" />}
    </>
  )
}

function Element({ el, badges }) {
  switch (el.kind) {
    case 'frame': return <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="#fbfdff" stroke="#4d7c0f" strokeWidth={3} strokeDasharray="3 7" />
    case 'text': return (
      <text x={el.x} y={el.y} textAnchor={el.a ?? 'middle'} fontSize={el.s ?? 21} fontWeight={el.w ?? 400} fill={el.f ?? '#111827'}
        transform={el.r ? `rotate(${el.r} ${el.x} ${el.y})` : undefined}>{el.t}</text>
    )
    case 'edge': return <Edge el={el} />
    case 'outline': return el.cls === 'tambon'
      ? <path d={el.d} fill="none" stroke="#4d7c0f" strokeWidth={3} strokeDasharray="3 7" />
      : <path d={el.d} fill="none" stroke="#94a3b8" strokeWidth={el.w ?? 3} strokeDasharray="10 8" />
    case 'weir': {
      // ฝาย: ดำ = มีตามผัง · แดงทึบ = แผนก่อสร้าง (ไม่เคลื่อนไหว) · t = ความหนา (ขีดบางของฝายเล็กในผัง)
      const thick = el.t ?? 12
      const fill = el.status === 'planned' ? RED : '#111'
      return el.o === 'v'
        ? <rect x={el.x - thick / 2} y={el.y - el.w / 2} width={thick} height={el.w} fill={fill} />
        : <rect x={el.x - el.w / 2} y={el.y - thick / 2} width={el.w} height={thick} fill={fill} />
    }
    case 'bridge': return (
      // สะพาน ")(" คร่อมลำน้ำ — o = h: ลำน้ำไหลแนวนอน (วงเล็บตั้ง) · v: ลำน้ำไหลแนวตั้ง (หมุน 90°)
      <g transform={el.o === 'v' ? `rotate(90 ${el.x} ${el.y})` : undefined} fill="none" stroke="#111" strokeWidth={6} strokeLinecap="round">
        <path d={`M${el.x - 15} ${el.y - 20} Q${el.x - 3} ${el.y} ${el.x - 15} ${el.y + 20}`} />
        <path d={`M${el.x + 15} ${el.y - 20} Q${el.x + 3} ${el.y} ${el.x + 15} ${el.y + 20}`} />
      </g>
    )
    case 'reservoir': return (
      <path d={`M${el.x} ${el.y - el.s} L${el.x + el.s * (el.sx ?? 1)} ${el.y + el.s * 0.8} L${el.x - el.s * (el.sx ?? 1)} ${el.y + el.s * 0.8} Z`}
        fill={el.status === 'planned' ? RED : '#111827'} transform={el.r ? `rotate(${el.r} ${el.x} ${el.y})` : undefined} />
    )
    case 'pond': return <circle cx={el.x} cy={el.y} r={el.r} fill="#5b9bd5" stroke="#2f6aa8" strokeWidth={3} />
    case 'source': return <ellipse cx={el.x} cy={el.y} rx={el.r ?? 14} ry={el.ry ?? el.r ?? 14} fill="#111" />
    case 'catch': return <circle cx={el.x} cy={el.y} r={el.r} fill="#e9d5ff55" stroke="#7c3aed" strokeWidth={3} strokeDasharray="3 5" />
    case 'gate': {
      const half = el.s ?? 22
      return <path d={`M${el.x} ${el.y - half} l${half} ${half} l-${half} ${half} l-${half} -${half} Z`} fill="#7c3aed" stroke="#5b21b6" strokeWidth={half < 12 ? 2 : 3} />
    }
    case 'supply': {
      const half = el.s ?? 22
      return (
        <>
          <rect x={el.x - half} y={el.y - half} width={half * 2} height={half * 2} fill="#fff" stroke={BLUE} strokeWidth={3} />
          <path d={`M${el.x - half} ${el.y - half}L${el.x + half} ${el.y + half}M${el.x + half} ${el.y - half}L${el.x - half} ${el.y + half}`} stroke={BLUE} strokeWidth={3} />
        </>
      )
    }
    case 'pump': {
      const radius = el.s ?? 27
      return (
        <>
          <circle cx={el.x} cy={el.y} r={radius} fill="#fff" stroke={RED} strokeWidth={3.5} strokeDasharray="7 5" />
          <text x={el.x} y={el.y + radius * 0.37} textAnchor="middle" fontSize={Math.round(radius * 1.1)} fill={RED}>P</text>
        </>
      )
    }
    case 'house': return <path d={`M${el.x - 26} ${el.y + 4} L${el.x} ${el.y - 24} L${el.x + 26} ${el.y + 4} Z M${el.x - 18} ${el.y + 4} H${el.x + 18} V${el.y + 24} H${el.x - 18} Z`} fill={BLUE} opacity={0.85} />
    case 'school': return (
      <g fill="#111">
        <rect x={el.x} y={el.y} width={14} height={30} />
        <rect x={el.x + 18} y={el.y - 10} width={14} height={40} />
        <rect x={el.x + 36} y={el.y} width={14} height={30} />
      </g>
    )
    case 'repair': return <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="url(#wd-hatch)" stroke={RED} strokeWidth={2.5} />
    case 'planBox': return (
      <>
        <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="none" stroke={RED} strokeWidth={4} strokeDasharray="8 5" />
        <text x={el.x + 62} y={el.y + 23} textAnchor="start" fontSize={16} fontWeight={700} fill={RED}>{el.label}</text>
      </>
    )
    case 'chip': return <Chip x={el.x} y={el.y} text={el.t} size={el.s} tone={el.tone} />
    case 'slot': {
      const badge = badges[el.id]
      return badge ? <Chip x={el.x} y={el.y} text={badge.text} size={el.s} tone={badge.tone} /> : null
    }
    default: return null
  }
}

// คำอธิบายสัญลักษณ์: แสดงเฉพาะที่ผังนั้นมีจริง (when) — ผังไม่มีอ่างก็ไม่มีบรรทัดอ่าง · ทุกสัญลักษณ์ที่วาดต้องมีคำอธิบาย ไม่ให้ใครต้องถาม
const has = (diagram, kind, pick = () => true) => diagram.elements.some(el => el.kind === kind && pick(el))
const LEGEND = [
  { key: 'flow', when: () => true, text: 'น้ำไหลตามทิศลูกศร (เส้นวิ่ง)', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M2 8H26" stroke={BLUE} strokeWidth="6" /><path d="M2 8H26" stroke="#fff" strokeWidth="2" strokeDasharray="4 8" strokeOpacity=".9" /><path d="M26 2L34 8L26 14Z" fill={BLUE} /></svg>
  ) },
  { key: 'minor', when: diagram => has(diagram, 'edge', el => el.cls === 'minor'), text: 'ลำห้วยสาขา (ลูกศรนิ่ง)', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M2 8H26" stroke={BLUE} strokeWidth="3" /><path d="M26 3L34 8L26 13Z" fill={BLUE} /></svg>
  ) },
  { key: 'weir', when: diagram => has(diagram, 'weir', el => el.status !== 'planned'), text: 'ฝาย', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><rect x="12" y="1" width="10" height="14" fill="#111" /></svg> },
  { key: 'planWeir', when: diagram => has(diagram, 'weir', el => el.status === 'planned'), text: 'แท่งแดง = ฝายแผนก่อสร้าง ไม่เคลื่อนไหว', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><rect x="12" y="1" width="10" height="14" fill={RED} /></svg> },
  { key: 'planReservoir', when: diagram => has(diagram, 'reservoir', el => el.status === 'planned'), text: 'สามเหลี่ยมแดง = อ่างแผนก่อสร้าง ไม่เคลื่อนไหว', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M17 1L31 15H3Z" fill={RED} /></svg> },
  { key: 'reservoir', when: diagram => has(diagram, 'reservoir', el => el.status !== 'planned'), text: 'อ่างเก็บน้ำ', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M17 1L31 15H3Z" fill="#111" /></svg> },
  { key: 'source', when: diagram => has(diagram, 'source'), text: 'แหล่งน้ำ', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><ellipse cx="17" cy="8" rx="7" ry="7" fill="#111" /></svg> },
  { key: 'pond', when: diagram => has(diagram, 'pond'), text: 'หนอง', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><circle cx="17" cy="8" r="7" fill="#5b9bd5" /></svg> },
  { key: 'gate', when: diagram => has(diagram, 'gate'), text: 'ประตูระบายน้ำ', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M17 1L26 8L17 15L8 8Z" fill="#7c3aed" stroke="#5b21b6" strokeWidth="1.5" /></svg> },
  { key: 'bridge', when: diagram => has(diagram, 'bridge'), text: 'สะพาน', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><g fill="none" stroke="#111" strokeWidth="3" strokeLinecap="round"><path d="M12 2Q16 8 12 14" /><path d="M22 2Q18 8 22 14" /></g></svg>
  ) },
  { key: 'supply', when: diagram => has(diagram, 'supply'), text: 'ระบบประปา', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><rect x="9" y="1" width="14" height="14" fill="#fff" stroke={BLUE} strokeWidth="1.5" /><path d="M9 1L23 15M23 1L9 15" stroke={BLUE} strokeWidth="1.5" /></svg>
  ) },
  { key: 'pump', when: diagram => has(diagram, 'pump'), text: 'วงกลมประแดง = สถานีสูบน้ำแผนก่อสร้าง ไม่เคลื่อนไหว', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><circle cx="17" cy="8" r="6.5" fill="#fff" stroke={RED} strokeWidth="2" strokeDasharray="4 3" /></svg>
  ) },
  { key: 'plan', when: diagram => has(diagram, 'edge', el => el.cls === 'plan'), text: 'เส้นประแดง = แผนก่อสร้าง ไม่เคลื่อนไหว', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M2 8H32" stroke={RED} strokeWidth="3" strokeDasharray="7 5" /></svg>
  ) },
  { key: 'repair', when: diagram => has(diagram, 'repair'), text: 'ลายขีดแดง = ชำรุดตามผัง ไม่เคลื่อนไหว', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true">
      <defs><pattern id="wd-legend-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff" /><path d="M0 0V6" stroke={RED} strokeWidth="2.5" /></pattern></defs>
      <rect x="8" y="2" width="18" height="12" fill="url(#wd-legend-hatch)" stroke={RED} strokeWidth="2" />
    </svg>
  ) },
  { key: 'tambon', when: diagram => has(diagram, 'outline', el => el.cls === 'tambon'), text: 'จุดเขียว = เขตตำบล', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M2 8H32" stroke="#4d7c0f" strokeWidth="3" strokeDasharray="3 5" /></svg>
  ) },
  { key: 'boundary', when: diagram => has(diagram, 'outline', el => el.cls === 'boundary'), text: 'เส้นประเทา = เขตตามผัง (ตำบล/หมู่บ้าน/พื้นที่)', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M2 8H32" stroke="#94a3b8" strokeWidth="3" strokeDasharray="8 6" /></svg>
  ) },
  { key: 'village', when: diagram => has(diagram, 'outline', el => el.cls === 'village'), text: 'เส้นประเทา = เขตหมู่บ้าน', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M2 8H32" stroke="#94a3b8" strokeWidth="3" strokeDasharray="8 6" /></svg>
  ) },
  { key: 'na', when: () => true, text: 'ขอบประ = ไม่มีค่า · ไม่มีรายงานใหม่ · ไม่ระบุ', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><rect x="1" y="2" width="30" height="12" rx="6" fill="#fff" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" /></svg>
  ) },
]

function DiagramMap({ diagram, badges, zoom }) {
  const { w, h } = diagram.viewBox
  return (
    <div className="wd-mapbox rounded-2xl border border-slate-300 bg-white">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" fontFamily={FONT}
        style={{ width: `max(${zoom * 100}%, ${Math.round(zoom * MAP_MIN_WIDTH)}px)` }}
        aria-label={`${diagram.title} ${diagram.ariaSummary} ดูรายละเอียดทั้งหมดได้ในโหมดสายน้ำ (รายการ)`}>
        <defs>
          {[['aM', BLUE, 26], ['aB', BLUE, 36], ['aR', DARK, 44], ['aS', BLUE, 17], ['aP', RED, 18]].map(([id, fill, size]) => (
            <marker key={id} id={`wd-${id}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth={size} markerHeight={size} markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 0L10 5L0 10Z" fill={fill} />
            </marker>
          ))}
          <marker id="wd-aMS" viewBox="0 0 10 10" refX="3" refY="5" markerWidth="26" markerHeight="26" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10Z" fill={BLUE} />
          </marker>
          <pattern id="wd-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#fff" /><path d="M0 0V8" stroke={RED} strokeWidth="3" />
          </pattern>
        </defs>
        {diagram.elements.map((el, index) => <Element key={el.id ?? `${el.kind}-${index}`} el={el} badges={badges} />)}
      </svg>
    </div>
  )
}

function DiagramLanes({ diagram, badges }) {
  return (
    <div className="space-y-3">
      {diagram.lanes.map(lane => (
        <div key={lane.id} className="wd-lane rounded-2xl border border-sky-200 bg-white px-3.5 py-3">
          <h3 className="mb-2 text-sm font-bold text-sky-900">{lane.title}</h3>
          <ol>
            {lane.items.map((item, index) => (
              <LaneItem key={`${lane.id}-${index}`} item={item} badges={badges} last={index === lane.items.length - 1} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

function LaneItem({ item, badges, last }) {
  const live = (item.live ?? []).map(slot => ({ slot, badge: badges[slot] })).filter(entry => entry.badge)
  const kind = item.status === 'planned' ? 'wd-plan' : item.status === 'repair' ? 'wd-fix' : ''
  return (
    <>
      <li className={kind}>
        <span className="wd-dot" aria-hidden="true" />
        {item.name}
        {(item.tags ?? []).map(tag => <span key={tag.t} className={`wd-tag wd-t-${tag.k}`}>{tag.t}</span>)}
        {live.map(({ slot, badge }) => <span key={slot} className={`wd-tag wd-t-${badge.tone}`}>{badge.detail}</span>)}
        {item.sub && <span className="wd-sub">{item.sub}</span>}
      </li>
      {!last && <li className="wd-next" aria-hidden="true"><span className="wd-bob">⇣</span></li>}
    </>
  )
}

const BUTTON = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-400 bg-white px-3.5 text-sm font-bold text-slate-700 hover:bg-slate-50'

// บรรทัดคำบรรยายใต้หัว — ล็อกแต่ละวลีไม่ให้ตัดกลางคำ (ไทยไม่มีช่องว่างคั่นคำ) แต่ต้องสั้นพอจะไม่ล้นจอแคบ — วลีเดียวยาว 60 ตัวอักษรเคยถูกตัดขอบขวาที่ 390px
function HeadingCaption({ scope, className }) {
  return (
    <p className={className}>
      <span className="whitespace-nowrap">ทิศทางน้ำตามผัง</span> ·{' '}
      <span className="whitespace-nowrap">ศูนย์บริหารจัดการทรัพยากรน้ำจังหวัดแพร่</span> ·{' '}
      <span className="whitespace-nowrap">วาดใหม่</span>
      {scope && <> · <span className="whitespace-nowrap font-semibold text-gray-600">{scope}</span></>}
    </p>
  )
}

// หัวโปสเตอร์ของแผนภาพเส้นทางน้ำ — อยู่บนสุดของส่วนนี้ ก่อนปุ่ม/คำกำกับ/แท็บ (เจ้าของระบบสั่ง: สวยแล้วต้องให้เห็นก่อน)
// เป็น h2 จริงของส่วนนี้ (ชื่อที่โปรแกรมอ่านจอใช้ = "เส้นทางน้ำ ตำบล…")
function RouteBanner({ route, scope }) {
  return (
    <header data-route-banner className="wr-poster rounded-3xl border border-sky-100 bg-gradient-to-b from-sky-50 to-white px-3 pb-4 pt-5 text-center shadow-sm lg:px-7 lg:pt-7">
      <h2 id="water-diagram-title">
        <span className="block text-[22px] font-semibold tracking-wide text-slate-600 lg:text-3xl">{route.eyebrow}</span>
        <span className="block text-[40px] font-extrabold leading-[1.1] text-sky-950 lg:text-6xl">{route.title}</span>
      </h2>
      <p className="mt-1.5 text-[13px] text-slate-500 lg:text-[15px]">{route.place}</p>
      <HeadingCaption scope={scope} className="mt-1 text-xs text-gray-500" />
    </header>
  )
}

// ── แผนภาพเส้นทางน้ำ (ผังที่มี route) — แทนผังเคลื่อนไหวเดิมของ อปท. นั้น (เจ้าของระบบสั่ง 2569-10-21) ──
const ROUTE_LEGEND = [
  { key: 'lake', text: 'อ่างเก็บน้ำ', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><ellipse cx="17" cy="7" rx="11" ry="6" fill="#5bb4ec" stroke="#fff" strokeWidth="1.5" /><path d="M8 10Q17 16 26 10" fill="none" stroke="#d6c19a" strokeWidth="3" strokeLinecap="round" /></svg>
  ) },
  { key: 'weir', text: 'ฝาย', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M9 6L25 6L28 2L12 2Z" fill="#eef2f6" /><rect x="9" y="6" width="16" height="7" fill="#8f9fb1" /></svg> },
  { key: 'pond', text: 'หนอง', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><ellipse cx="17" cy="8" rx="10" ry="6" fill="#5b9bd5" stroke="#fff" strokeWidth="1.5" /></svg> },
  { key: 'gate', text: 'ประตูระบายน้ำ', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M17 1L26 8L17 15L8 8Z" fill="#7c3aed" stroke="#5b21b6" strokeWidth="1.5" /></svg> },
  { key: 'bridge', text: 'สะพาน', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M5 9L29 9L29 12L5 12Z" fill="#6b7b8e" /><path d="M5 6L29 6L29 9L5 9Z" fill="#dbe2ea" /><path d="M7 6V2M17 6V2M27 6V2M7 2H27" stroke="#8f9fb1" strokeWidth="1.6" fill="none" /></svg> },
  { key: 'supply', text: 'ระบบประปา', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M12 9L10 15M22 9L24 15" stroke="#6b7b8e" strokeWidth="2" fill="none" /><rect x="9" y="1" width="16" height="9" rx="3.5" fill="#5bb4ec" /></svg> },
  { key: 'village', text: 'หมู่บ้าน', icon: <svg viewBox="0 0 34 16" aria-hidden="true"><rect x="6" y="8" width="9" height="7" fill="#f6e7c8" /><path d="M4 8L10.5 2L17 8Z" fill="#8a6a4a" /><rect x="19" y="8" width="9" height="7" fill="#f6e7c8" /><path d="M17 8L23.5 2L30 8Z" fill="#7a5c3e" /></svg> },
  { key: 'plan', text: 'กล่องแดงประ = แผนก่อสร้าง ไม่เคลื่อนไหว', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M9 4L17 1L25 4V12L17 15L9 12Z" fill="#fff" stroke={RED} strokeWidth="1.8" strokeDasharray="3 2.5" /></svg>
  ) },
  { key: 'repair', text: 'ลายขีดแดง = ชำรุดตามผัง ไม่เคลื่อนไหว', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true">
      <defs><pattern id="wd-route-legend-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff" /><path d="M0 0V6" stroke={RED} strokeWidth="2.5" /></pattern></defs>
      <rect x="8" y="2" width="18" height="12" fill="url(#wd-route-legend-hatch)" stroke={RED} strokeWidth="2" />
    </svg>
  ) },
  { key: 'flow', text: 'เส้นวิ่ง + หัวลูกศร = ผังต้นฉบับวาดลูกศรทิศน้ำไว้', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><path d="M2 8H25" stroke="#2a78b5" strokeWidth="7" strokeLinecap="round" /><path d="M2 8H25" stroke="#63c0f2" strokeWidth="4" strokeLinecap="round" /><path d="M24 2L33 8L24 14Z" fill="#1d5f94" /></svg>
  ) },
  { key: 'na', text: 'ขอบประ = ไม่มีค่า · ไม่มีรายงานใหม่ · ไม่ระบุ', icon: (
    <svg viewBox="0 0 34 16" aria-hidden="true"><rect x="1" y="2" width="30" height="12" rx="6" fill="#fff" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" /></svg>
  ) },
]

// ที่มา + ของที่ผังต้นฉบับมีแต่ไม่ได้วาด + ลิงก์ผังต้นฉบับ — ผังที่มี route เก็บไว้ในแท็บ "ที่มา" (ผังเดิมแสดงท้ายส่วนเหมือนเดิม)
function SourceBox({ diagram, tenantName }) {
  return (
    <div className="rounded-2xl border border-slate-300 bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-600" data-diagram-source>
      <p>
        <b>ที่มา:</b> {diagram.sourceTitle} ของศูนย์บริหารจัดการทรัพยากรน้ำจังหวัดแพร่
        ({diagram.sourceDate}) — วาดใหม่ ไม่ได้คัดลอกภาพ ไม่ได้เป็นผลงานของ{tenantName || 'หน่วยงาน'} ·
        สถานะโครงสร้างอาจเปลี่ยนไปหลังทำผัง · ป้ายตัวเลขบนผังคือค่าจากสถานี/รายงานตามที่ระบุ ไม่ใช่ประกาศเตือนภัย
      </p>
      {diagram.omitted?.length > 0 && (
        <div className="mt-1.5" data-diagram-omitted>
          <p className="font-semibold">ที่ผังต้นฉบับมีแต่เราวาดต่างไป หรือไม่ได้วาด:</p>
          <ul className="ml-4 list-disc">
            {diagram.omitted.map(text => <li key={text}>{text}</li>)}
          </ul>
        </div>
      )}
      <a href={originalDiagramUrl(diagram.id, diagram.sourceUrl)} target="_blank" rel="noopener noreferrer" data-original-link
        className="mt-1 inline-flex min-h-[44px] items-center gap-1 font-semibold text-blue-700">
        ดูผังต้นฉบับ <ExternalLink size={12} />
      </a>
    </div>
  )
}

// จอ ≥ 1024px รายการอยู่ข้างภาพอยู่แล้ว จึงไม่มีแท็บ "รายการจุด" (ใช้ breakpoint เดียวกับ lg: ของ Tailwind)
const WIDE_QUERY = '(min-width: 1024px)'

// ── แผนภาพเส้นทางน้ำแบ่ง 3 แท็บ: แผนภาพ (ชื่อ + ภาพ + สัญลักษณ์) · รายการจุด · ที่มา — มือถือไม่ต้องเลื่อนยาวเกือบ 3,000px ──
// แผงที่ไม่ได้เลือกใช้ display:none (ไม่ใช่แค่ซ่อนตา) ภาพที่ซ่อนจึงไม่วิ่งแอนิเมชันกินแบตและผู้ใช้โปรแกรมอ่านจอไม่ต้องอ่านซ้ำ
// คำอธิบายสัญลักษณ์ข้อไหนต้องขึ้น = ผังนั้นมีสัญลักษณ์นั้นจริง (routeKinds) — ไม่โชว์ของที่ไม่มีในภาพ
const ROUTE_LEGEND_NEEDS = { lake: 'lake', weir: 'weir', pond: 'pond', gate: 'gate', bridge: 'bridge', supply: 'supply', village: 'village', plan: 'planned', repair: 'repair', flow: 'flow', na: 'na' }

function RouteView({ route, badges, diagram, tenantName, now }) {
  const hasPoster = Boolean(route.poster)
  const legend = ROUTE_LEGEND.filter(item => routeKinds(route).has(ROUTE_LEGEND_NEEDS[item.key]))
  const [tab, setTab] = useState('art')
  const [wide, setWide] = useState(() => Boolean(window.matchMedia?.(WIDE_QUERY).matches))
  const uid = useId()
  const stopCount = route.stops.length + 1
  const ariaLabel = `${route.heading} ภาพประกอบ ${stopCount} จุด ไม่ตรงตำแหน่ง ทิศ และมาตราส่วนจริง ดูรายละเอียดทั้งหมดในรายการจุดที่มีหมายเลข`

  // ขยายจอจนรายการขึ้นข้างภาพแล้ว แต่แท็บค้างที่ "รายการจุด" (ซึ่งถูกซ่อนบนจอกว้าง) → กลับมาที่แผนภาพ
  useEffect(() => {
    const query = window.matchMedia?.(WIDE_QUERY)
    if (!query) return undefined
    const settle = () => {
      setWide(query.matches)
      if (query.matches) setTab(current => (current === 'list' ? 'art' : current))
    }
    query.addEventListener('change', settle)
    return () => query.removeEventListener('change', settle)
  }, [])

  const tabs = [
    { key: 'art', label: <><span className="lg:hidden">แผนภาพ</span><span className="hidden lg:inline">แผนภาพและรายการ</span></> },
    { key: 'list', label: `รายการจุด (${stopCount})`, extra: 'lg:hidden' },
    { key: 'source', label: 'ที่มา' },
  ]

  // ลูกศรซ้าย/ขวา/Home/End ย้ายระหว่างแท็บ (เฉพาะแท็บที่เห็นอยู่ — แท็บ "รายการจุด" ซ่อนบนจอกว้าง)
  function onKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')].filter(button => button.offsetParent !== null)
    const at = buttons.indexOf(document.activeElement)
    if (at < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus()
    buttons[next].click()
  }

  return (
    <div data-route-tabs className="space-y-3">
      <div role="tablist" aria-label="ส่วนของแผนภาพเส้นทางน้ำ" onKeyDown={onKeyDown}
        className="flex divide-x divide-slate-300 overflow-hidden rounded-xl border border-slate-400 lg:max-w-md">
        {tabs.map(({ key, label, extra }) => {
          const active = tab === key
          return (
            <button key={key} type="button" role="tab" id={`${uid}-tab-${key}`} aria-selected={active} aria-controls={`${uid}-panel-${key}`}
              tabIndex={active ? 0 : -1} onClick={() => setTab(key)}
              className={`min-h-[44px] flex-1 px-2 text-sm font-bold leading-tight ${extra ?? ''} ${active ? 'bg-sky-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>
          )
        })}
      </div>

      <div data-route-view className={`wr-poster overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-b from-sky-50 to-white px-3 py-4 shadow-sm lg:px-7 lg:py-6 ${tab === 'source' ? 'hidden' : ''}`}>
        {/* จอใหญ่: รายการซ้าย ภาพขวา (เหมือนภาพอ้างอิงที่เจ้าของระบบส่งมา) · สัญลักษณ์/หมายเหตุเต็มแถวล่าง
            มือถือ: แท็บ "แผนภาพ" เรียงภาพ → สัญลักษณ์ → หมายเหตุ · แท็บ "รายการจุด" เห็นเฉพาะรายการ · ชื่อใหญ่อยู่ที่ RouteBanner บนสุดของส่วน */}
        {/* ผังที่มีโปสเตอร์: ภาพนำเสนอเต็มความกว้างอยู่บน · จอกว้าง (≥ 1024px) รายการจุดอยู่ใต้ภาพเป็นแผ่น A4 3 คอลัมน์ตามสายน้ำ · มือถือ/แท็บเล็ตใช้รายการเดิมในแท็บ "รายการจุด" (แผ่น A4 แนวนอนบนจอแคบเล็กเกินอ่าน) · คำอธิบายสัญลักษณ์อยู่ในภาพเอง */}
        <div className={`grid gap-3 ${hasPoster ? '' : 'lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-x-7'}`}>
          <div role="tabpanel" id={`${uid}-panel-art`} aria-labelledby={`${uid}-tab-art`} className={tab === 'art' ? 'contents' : 'hidden'}>
            {hasPoster ? (
              <Suspense fallback={<div className="grid place-items-center rounded-2xl bg-slate-100 text-sm text-slate-500" style={{ aspectRatio: '1123 / 794' }} aria-busy="true">กำลังโหลดภาพนำเสนอ…</div>}>
                <WaterRoutePosterPanel route={route} diagram={diagram} badges={badges} now={now} />
              </Suspense>
            ) : (
              <>
                <div className="lg:col-start-2 lg:row-start-1 lg:max-w-[640px]"><WaterRouteArt route={route} badges={badges} ariaLabel={ariaLabel} /></div>
                <ul className="wd-legend m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 px-0.5 text-xs text-slate-600 lg:col-span-2 lg:row-start-2" data-route-legend>
                  {legend.map(item => <li key={item.key} className="inline-flex items-center gap-1.5">{item.icon}{item.text}</li>)}
                </ul>
              </>
            )}
          </div>
          <div role="tabpanel" id={`${uid}-panel-list`} aria-labelledby={`${uid}-tab-list`}
            className={`${tab === 'list' ? '' : 'hidden lg:block'} ${hasPoster ? '' : 'lg:col-start-1 lg:row-start-1'}`}>
            {hasPoster && wide ? (
              <Suspense fallback={<WaterRouteList route={route} badges={badges} />}>
                <WaterRouteListSheet route={route} diagram={diagram} badges={badges} now={now} />
              </Suspense>
            ) : <WaterRouteList route={route} badges={badges} />}
          </div>
        </div>
      </div>

      <div role="tabpanel" id={`${uid}-panel-source`} aria-labelledby={`${uid}-tab-source`} className={tab === 'source' ? '' : 'hidden'}>
        <SourceBox diagram={diagram} tenantName={tenantName} />
      </div>
    </div>
  )
}

function DiagramBody({ diagram, scope, tenantName, stations, now }) {
  const route = diagram.route ?? null
  const root = useRef(null)
  const [mode, setMode] = useState(initialMode)
  const [paused, setPaused] = useState(false)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const reducedMotion = useReducedMotion()
  // ดึงรายงานอ่างเล็กเหมือนการ์ดด้านบน — Worker จำคำตอบ 6 ชม. ที่ edge อยู่แล้ว ไม่ไปต้นทางซ้ำ
  // ผังไม่มีอ่างเล็ก (เช่นตำหนักธรรม) = id เป็น null ไม่ดึงอะไร · hook ต้องถูกเรียกจำนวนเท่าเดิมทุกครั้ง จึงตายตัว 2 ช่อง (เทสต์กันไม่ให้ผังมีเกิน 2)
  const [smallA = null, smallB = null] = diagram.smallReservoirs ?? []
  const reportA = useReservoirReport(smallA)
  const reportB = useReservoirReport(smallB)

  const badges = useMemo(
    () => liveBadges({
      binds: diagram.binds,
      reports: { ...(smallA === null ? {} : { [smallA]: reportA }), ...(smallB === null ? {} : { [smallB]: reportB }) },
      stations, now,
    }),
    [diagram.binds, smallA, smallB, reportA, reportB, stations, now],
  )

  // หยุดเส้นน้ำเมื่อผังอยู่นอกจอหรือแท็บถูกซ่อน (ไม่กินแบตเปล่า) ด้วย data attribute ไม่ re-render · ไม่แตะ Supabase/auth (NOTES §7)
  // เก็บสองเงื่อนไขแยกกันแล้วรวมทุกครั้ง — แท็บกลับมาแล้วตัวสังเกตจอไม่ยิงซ้ำ ถ้าเก็บเป็นค่าเดียวผังจะค้างหยุดตลอด
  useEffect(() => {
    const el = root.current
    if (!el) return undefined
    let inView = true
    const apply = () => {
      if (document.hidden || !inView) el.dataset.offscreen = 'true'
      else delete el.dataset.offscreen
    }
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => { inView = entries[entries.length - 1].isIntersecting; apply() })
      : null
    observer?.observe(el)
    document.addEventListener('visibilitychange', apply)
    apply()
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', apply) }
  }, [])

  function chooseMode(next) {
    setMode(next)
    storeMode(next)
  }

  return (
    <section id="water-diagram" ref={root} className={`wd-root mt-4 space-y-3 ${paused ? 'wd-paused' : ''}`} aria-labelledby="water-diagram-title">
      {route ? <RouteBanner route={route} scope={scope} /> : (
        <div className="water-section-heading flex items-start gap-2.5 px-1" style={{ background: 'linear-gradient(110deg,#ccfbf1,#f0fdfa)' }}>
          <MapIcon size={19} className="mt-0.5 shrink-0 text-teal-700" />
          <div>
            <h2 id="water-diagram-title" className="text-sm font-bold text-gray-800">{diagram.title}</h2>
            <HeadingCaption scope={scope} className="text-xs text-gray-500" />
          </div>
        </div>
      )}

      {reducedMotion && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          เครื่องของคุณตั้งค่าให้ลดการเคลื่อนไหว — เส้นน้ำจึงหยุดนิ่ง ดูทิศทางจากลูกศรได้
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!route && <span className="inline-flex overflow-hidden rounded-xl border border-slate-400" role="group" aria-label="โหมดแสดงผัง">
          {[['lanes', 'สายน้ำ (รายการ)'], ['map', 'ผังภาพ']].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => chooseMode(value)}
              className={`min-h-[44px] px-3.5 text-sm font-bold ${mode === value ? 'bg-sky-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </span>}
        <button type="button" className={BUTTON} aria-pressed={paused} onClick={() => setPaused(value => !value)}>
          {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? 'เล่นเคลื่อนไหว' : 'หยุดเคลื่อนไหว'}
        </button>
        {!route && mode === 'map' && (
          <span className="inline-flex gap-2">
            <button type="button" className={BUTTON} aria-label="ย่อผัง" disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom(value => Math.max(MIN_ZOOM, value - 0.5))}><ZoomOut size={16} /></button>
            <button type="button" className={BUTTON} aria-label="ขยายผัง" disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom(value => Math.min(MAX_ZOOM, value + 0.5))}><ZoomIn size={16} /></button>
          </span>
        )}
      </div>

      {/* คำกำกับบังคับ — ห้ามเอาออก: ผังนี้ไม่ได้บอกว่าตอนนี้มีน้ำไหลจริง (เทสต์ตรวจข้อความนี้) */}
      <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-slate-700" data-diagram-disclaimer>
        <b>ภาพประกอบทิศทางน้ำตามผัง ({diagram.drawnLabel})</b> ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง — ฝาย คลอง หนอง ไม่มีเครื่องวัด
        · โครงสร้างที่ผังระบุว่าชำรุดหรือแผนก่อสร้าง<b>จะไม่เคลื่อนไหว</b>
        {route && <> · <b>ไม่ใช่แผนที่</b> ตำแหน่ง ทิศ และมาตราส่วนไม่ตรงจริง · เกาะและต้นไม้เป็นภาพประกอบ ไม่ได้หมายถึงสิ่งก่อสร้างหรือพื้นที่จริง</>}
      </p>

      {route ? <RouteView route={route} badges={badges} diagram={diagram} tenantName={tenantName} now={now} /> : mode === 'map' ? <DiagramMap diagram={diagram} badges={badges} zoom={zoom} /> : <DiagramLanes diagram={diagram} badges={badges} />}

      {!route && mode === 'map' && (
        <ul className="wd-legend m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 px-0.5 text-xs text-slate-600">
          {LEGEND.filter(item => item.when(diagram)).map(item => <li key={item.key} className="inline-flex items-center gap-1.5">{item.icon}{item.text}</li>)}
        </ul>
      )}

      {!route && <SourceBox diagram={diagram} tenantName={tenantName} />}

    </section>
  )
}

/**
 * ผังน้ำตำบลเคลื่อนไหว — แสดงเฉพาะ อปท. ใน WATER_DIAGRAM_TENANTS (ตอนนี้ thungkaew · tamnaktham · demo) แต่ละแห่งได้ผังของตัวเอง
 * เส้นวิ่ง = ทิศน้ำตามผังที่ศูนย์ฯ แพร่วาดไว้ ไม่ใช่การวัดว่าน้ำไหล · ค่าสดบนผังมีเฉพาะที่ผูกไว้ในข้อมูลผัง (อ่างเล็ก ฝน ระดับน้ำ)
 * ไม่ส่งเข้า Telegram/แถบหน้าแรก/ภาพแชร์ · ไม่มีฐานข้อมูล/RPC ใหม่ (ข้อมูลผังเป็นไฟล์ในโค้ด)
 * previewId (จาก ?diagram=) ใช้ได้เฉพาะ demo ดูผังอื่นด้วยข้อมูลจริงก่อนเปิดให้ อปท. จริง
 */
export default function WaterDiagram({ slug, tenantName, stations, now, previewId }) {
  const resolved = resolveDiagram(slug, previewId)
  const diagram = resolved ? diagramById(resolved.diagram) : null
  if (!diagram) return null
  return <DiagramBody key={diagram.id} diagram={diagram} scope={resolved.scope} tenantName={tenantName} stations={stations} now={now} />
}
