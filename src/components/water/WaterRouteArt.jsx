import { CHIP_TONES } from '../../lib/waterDiagram/model'
import {
  ISLAND_THICKNESS, islandShape, labelPosition, pillFor, pillWidth, pinPosition, smoothPath, wavePath,
} from '../../lib/waterDiagram/route'

// แผนภาพเส้นทางน้ำ — ภาพประกอบเวกเตอร์ที่วาดจากข้อมูล (src/lib/waterDiagram/routes/*.js) ไม่ใช้รูปสำเร็จ ไม่มีค่าที่ใส่มือ
// ⚠️ ไม่ใช่แผนที่ ไม่มีเข็มทิศ · เส้นวิ่งเฉพาะ stream.flow (ผังวาดลูกศร) · ค่าสดทุกตัวมาจาก badges (liveBadges) ไม่ลงสีตามระดับน้ำ
// แอนิเมชันอยู่ใน WaterDiagram.css (คลาส wr-*) ใช้ปุ่มหยุด/นอกจอ/ลดการเคลื่อนไหวชุดเดียวกับผังเดิม

const FONT = "Sarabun,'Noto Sans Thai','Leelawadee UI',sans-serif"
const SOIL_DRIP = '#7a5233'

function Tree({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="2" rx="7" ry="2.4" fill="#000" opacity=".13" />
      <rect x="-1.7" y="-6" width="3.4" height="8" fill="#8b5e3c" />
      <circle cx="0" cy="-13" r="8" fill="#3f9d45" />
      <circle cx="-4.5" cy="-9" r="5.6" fill="#5cb860" />
      <circle cx="4.5" cy="-10" r="5" fill="#368f3c" />
    </g>
  )
}

function Cloud({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity=".95">
      <ellipse cx="0" cy="0" rx="34" ry="11" fill="#fff" />
      <ellipse cx="-14" cy="-7" rx="16" ry="11" fill="#fff" />
      <ellipse cx="10" cy="-10" rx="19" ry="13" fill="#fff" />
    </g>
  )
}

function IslandShadow({ island, th }) {
  const { shadow } = islandShape(island, th)
  return <ellipse cx={shadow.cx} cy={shadow.cy} rx={shadow.rx} ry={shadow.ry} fill="url(#wr-shadow)" />
}

function IslandBody({ island, th }) {
  const { x, y, rx, ry } = island
  const shape = islandShape(island, th)
  return (
    <g>
      {shape.drips.map(d => <path key={d} d={d} fill={SOIL_DRIP} />)}
      <path d={shape.side} fill="url(#wr-soil)" />
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="url(#wr-grass)" />
      <ellipse cx={x} cy={y} rx={rx - 5} ry={ry - 3} fill="none" stroke="#fff" strokeOpacity=".38" strokeWidth="1.5" />
    </g>
  )
}

// อ่างเก็บน้ำ: ผืนน้ำ + สันเขื่อนรูปพระจันทร์เสี้ยวด้านล่าง · na = ไม่มีข้อมูลในระบบ (ขอบประเทา ไม่ลงสีน้ำ)
function Lake({ x, y, rx, ry, na }) {
  if (na) {
    return (
      <g>
        <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#e6edf3" stroke="#94a3b8" strokeWidth="2.2" strokeDasharray="5 4" />
        <path d={`M${x - rx * 0.8} ${y + ry * 0.55} Q${x} ${y + ry * 1.5} ${x + rx * 0.8} ${y + ry * 0.55}`} fill="none" stroke="#cbd5e1" strokeWidth="6" strokeLinecap="round" />
      </g>
    )
  }
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="url(#wr-lake)" stroke="#fff" strokeWidth="3" />
      <path d={`M${x - rx * 0.5} ${y - ry * 0.35} q${rx * 0.25} -${ry * 0.45} ${rx * 0.6} -${ry * 0.1}`} fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="2.4" strokeLinecap="round" />
      <path d={`M${x - rx * 0.85} ${y + ry * 0.5} Q${x} ${y + ry * 1.55} ${x + rx * 0.85} ${y + ry * 0.5}`} fill="none" stroke="#d6c19a" strokeWidth="7" strokeLinecap="round" />
      <path d={`M${x - rx * 0.85} ${y + ry * 0.38} Q${x} ${y + ry * 1.43} ${x + rx * 0.85} ${y + ry * 0.38}`} fill="none" stroke="#efe2c4" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  )
}

function Pond({ x, y, rx, ry }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="url(#wr-pond)" stroke="#fff" strokeWidth="2.6" />
      <path d={`M${x - rx * 0.5} ${y - ry * 0.3} q${rx * 0.3} -${ry * 0.4} ${rx * 0.6} -${ry * 0.08}`} fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" />
      <path d={`M${x + rx * 0.75} ${y + ry * 0.1} l2 -9 M${x + rx * 0.85} ${y + ry * 0.2} l4 -8 M${x + rx * 0.65} ${y + ry * 0.25} l-1 -7`} stroke="#3a8f3f" strokeWidth="2" strokeLinecap="round" fill="none" />
    </g>
  )
}

function Weir({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-18 -2 L18 -2 L22 -8 L-14 -8Z" fill="#eef2f6" />
      <path d="M-18 -2 L18 -2 L18 8 L-18 8Z" fill="#8f9fb1" />
      <path d="M18 -2 L22 -8 L22 2 L18 8Z" fill="#6b7b8e" />
      <path d="M-13 12 h9 M-1 14 h10 M12 12 h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".9" />
    </g>
  )
}

// โครงสร้างตามแผน (ผังวาดสีแดง) — กล่องโปร่งขอบแดงประ ไม่ใช่ของที่มีอยู่
function Ghost({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-17 -2 L0 -11 L17 -2 L17 12 L0 21 L-17 12Z" fill="rgba(255,255,255,.7)" stroke="#dc2626" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M-17 -2 L0 7 L17 -2 M0 7 V21" fill="none" stroke="#dc2626" strokeWidth="1.6" strokeDasharray="4 3" />
    </g>
  )
}

function Pump({ x, y }) {
  return (
    <g>
      <Ghost x={x} y={y} />
      <g transform={`translate(${x} ${y - 18})`}>
        <circle r="10" fill="#fff" stroke="#dc2626" strokeWidth="2" strokeDasharray="3.5 2.5" />
        <text y="5.3" textAnchor="middle" fontSize="14" fontWeight="800" fill="#dc2626" fontFamily={FONT}>P</text>
      </g>
    </g>
  )
}

function Gate({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-22" y="-14" width="7" height="22" fill="#cdd5df" stroke="#8f9fb1" strokeWidth="1.2" />
      <rect x="15" y="-14" width="7" height="22" fill="#cdd5df" stroke="#8f9fb1" strokeWidth="1.2" />
      <rect x="-22" y="-19" width="44" height="7" rx="1.5" fill="#8f9fb1" />
      <path d="M-9 -12 V4 M0 -12 V4 M9 -12 V4" stroke="#6b7b8e" strokeWidth="2" />
      <path d="M0 -42 L9 -33 L0 -24 L-9 -33Z" fill="#7c3aed" stroke="#fff" strokeWidth="1.8" />
    </g>
  )
}

// รางส่งน้ำที่ผังระบุว่าชำรุด: ช่องน้ำมีช่วงลายขีดแดง
function Repair({ x, y }) {
  return (
    <g>
      <rect x={x - 21} y={y - 7} width="42" height="14" rx="2" fill="#63c0f2" stroke="#2a78b5" strokeWidth="2" />
      <rect x={x - 8} y={y - 9} width="16" height="18" fill="url(#wr-hatch)" stroke="#dc2626" strokeWidth="2" />
      <rect x={x - 8} y={y - 9} width="16" height="18" fill="#fff" opacity=".35" />
    </g>
  )
}

// ห้วยหลายเส้นรวมกัน (n เส้น) พร้อมฝายเส้นละ weirs แห่ง
function Creeks({ x, y, n = 4, weirs = 2 }) {
  const xs = Array.from({ length: n }, (_, i) => x + (i - (n - 1) / 2) * 15)
  return (
    <g>
      {xs.map((cx, i) => (
        <path key={cx} d={`M${cx} ${y - 42 + (i % 2) * 4} Q${cx + (i < n / 2 ? 3 : -3)} ${y - 12} ${x + (i - (n - 1) / 2) * 3} ${y + 18}`}
          fill="none" stroke="#63c0f2" strokeWidth="3.4" strokeLinecap="round" />
      ))}
      {xs.flatMap(cx => Array.from({ length: weirs }, (_, k) => (
        <rect key={`${cx}-${k}`} x={cx - 4.5} y={y - 20 + k * 15} width="9" height="3.2" fill="#0f172a" />
      )))}
    </g>
  )
}

// สะพาน: พื้นสะพาน + ราวกั้น + เสา
function Bridge({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-24 4 L24 4 L24 10 L-24 10Z" fill="#6b7b8e" />
      <path d="M-24 -2 L24 -2 L24 4 L-24 4Z" fill="#dbe2ea" />
      <path d="M-22 -2 V-11 M-8 -2 V-11 M8 -2 V-11 M22 -2 V-11" stroke="#8f9fb1" strokeWidth="2" />
      <path d="M-22 -11 H22" stroke="#8f9fb1" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M-17 10 v7 M17 10 v7" stroke="#6b7b8e" strokeWidth="3.2" />
    </g>
  )
}

// ระบบประปา: ถังน้ำบนขาตั้ง (สีฟ้า ไม่ใช้สีแดงเพราะแดงในแผนภาพนี้หมายถึงแผนก่อสร้างเท่านั้น)
function Supply({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-9 -3 L-12 17 M9 -3 L12 17 M-10.5 7 H10.5" stroke="#6b7b8e" strokeWidth="3" strokeLinecap="round" fill="none" />
      <rect x="-15" y="-21" width="30" height="19" rx="6" fill="#5bb4ec" stroke="#fff" strokeWidth="2.2" />
      <path d="M0 -17 C4 -12 5.5 -9.5 5.5 -7.5 A5.5 5.5 0 0 1 -5.5 -7.5 C-5.5 -9.5 -4 -12 0 -17Z" fill="#fff" opacity=".92" />
    </g>
  )
}

// หมู่บ้าน: บ้าน 3 หลัง (หลังคาสีน้ำตาล ไม่ใช้สีแดง)
function Village({ x, y }) {
  const house = (dx, dy, k, roof) => (
    <g key={dx} transform={`translate(${x + dx} ${y + dy}) scale(${k})`}>
      <rect x="-9" y="-6" width="18" height="13" fill="#f6e7c8" stroke="#fff" strokeWidth="1.2" />
      <path d="M-12.5 -6 L0 -17 L12.5 -6Z" fill={roof} />
      <rect x="-2.6" y="0" width="5.2" height="7" fill="#8b5e3c" />
    </g>
  )
  return <g>{house(-21, 5, 0.9, '#8a6a4a')}{house(1, 0, 1.05, '#7a5c3e')}{house(25, 6, 0.85, '#9a7b57')}</g>
}

function Prop({ p }) {
  switch (p.t) {
    case 'lake': return <Lake x={p.x} y={p.y} rx={p.rx} ry={p.ry} na={p.na} />
    case 'pond': return <Pond x={p.x} y={p.y} rx={p.rx} ry={p.ry} />
    case 'weir': return <Weir x={p.x} y={p.y} s={p.s} />
    case 'ghost': return <Ghost x={p.x} y={p.y} />
    case 'pump': return <Pump x={p.x} y={p.y} />
    case 'gate': return <Gate x={p.x} y={p.y} />
    case 'repair': return <Repair x={p.x} y={p.y} />
    case 'creeks': return <Creeks x={p.x} y={p.y} n={p.n} weirs={p.weirs} />
    case 'bridge': return <Bridge x={p.x} y={p.y} s={p.s} />
    case 'supply': return <Supply x={p.x} y={p.y} />
    case 'village': return <Village x={p.x} y={p.y} />
    default: return null
  }
}

// ลำน้ำ: ขอบเข้ม + น้ำ + ลายสว่างวิ่ง (เฉพาะ flow) · flow = มีหัวลูกศรปลายทางด้วย ให้ดูทิศได้แม้ผู้ใช้ตั้งค่าลดการเคลื่อนไหว
function Stream({ st }) {
  const d = smoothPath(st.pts)
  const w = st.w ?? 9.5
  return (
    <g data-stream={st.id} data-flow={st.flow ? 'true' : 'false'}>
      <path d={d} fill="none" stroke="#2a78b5" strokeWidth={w + 4.5} strokeLinecap="round" strokeLinejoin="round" markerEnd={st.flow ? 'url(#wr-arrow)' : undefined} />
      <path d={d} fill="none" stroke="#63c0f2" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
      <path className={st.flow ? 'wr-flow' : 'wr-hl'} d={d} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={st.flow ? '3 11' : undefined} />
    </g>
  )
}

function Pill({ cx, cy, size = 15.5, main, note, tone }) {
  const style = CHIP_TONES[tone] ?? CHIP_TONES.na
  const width = pillWidth(main, size)
  const height = size + 9
  return (
    <g data-pill={tone}>
      <rect x={cx - width / 2} y={cy - height / 2} width={width} height={height} rx={height / 2} fill="#fff"
        stroke={style.stroke} strokeWidth="2.4" strokeDasharray={style.dash ? '5 4' : undefined} />
      <text x={cx} y={cy + size * 0.35} textAnchor="middle" fontSize={size} fontWeight="700" fill={style.ink} fontFamily={FONT}>{main}</text>
      {note && (
        <text x={cx} y={cy + height / 2 + 13} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={style.ink} fontFamily={FONT}
          stroke="#fff" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">{note}</text>
      )}
    </g>
  )
}

function Pin({ n, x, y }) {
  return (
    <g data-pin={n}>
      <circle cx={x} cy={y} r="14.5" fill="#0f172a" stroke="#fff" strokeWidth="3" />
      <text x={x} y={y + (n > 9 ? 5.5 : 6.3)} textAnchor="middle" fontSize={n > 9 ? 15.5 : 17.5} fontWeight="800" fill="#fff" fontFamily={FONT}>{n}</text>
    </g>
  )
}

function Label({ text, x, y }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize="14.5" fontWeight="700" fill="#0f172a" fontFamily={FONT}
      stroke="#fff" strokeWidth="4.5" paintOrder="stroke" strokeLinejoin="round">{text}</text>
  )
}

// แม่น้ำตามขอบล่าง: ตลิ่งหญ้า + ผนังดิน + ผืนน้ำคลื่นเลื่อน · ตัววัด "ต่ำกว่าตลิ่ง" แสดงเฉพาะตอนมีค่าสด (ไม่มีค่า = ไม่วาดลูกศรบอกระยะ)
function River({ route, badges }) {
  const { w, h } = route.viewBox
  const { top } = route.river
  const water = top + 44
  const surface = top + 48
  const floor = h - 6
  const pill = route.river.slot ? pillFor({ slot: route.river.slot }, badges) : null
  return (
    <g data-river>
      <rect x="0" y={top} width={w} height="16" fill="url(#wr-grass)" />
      <rect x="0" y={top + 16} width={w} height="30" fill="url(#wr-wall)" />
      <path d={`M0 ${top + 16} H${w}`} stroke="#fff" strokeOpacity=".4" strokeWidth="2" />
      <rect className="wr-shim" x="0" y={water} width={w} height={h - water} fill="url(#wr-river)" />
      <g clipPath="url(#wr-clip-river)">
        <g className="wr-wave" style={{ '--p': '28px' }}><path d={wavePath(0, w, surface, floor + 6)} fill="#8fdcff" opacity=".55" /></g>
        <g className="wr-wave wr-wave-b" style={{ '--p': '28px' }}><path d={wavePath(0, w, surface + 9, floor + 6)} fill="#bdeaff" opacity=".3" /></g>
      </g>
      {route.streams.filter(s => s.river).map(s => {
        const [x] = s.pts[s.pts.length - 1]
        return <path key={s.id} className="wr-fall" d={`M${x} ${top + 17} V${surface}`} stroke="#fff" strokeWidth="7" strokeLinecap="round" opacity=".85" strokeDasharray="3 11" fill="none" />
      })}
      <Pin n={route.river.n} x={30} y={top + 82} />
      <text x="54" y={top + 89} fontSize="21" fontWeight="800" fill="#fff" fontFamily={FONT}>{route.river.name}</text>
      {pill?.tone === 'ok' && (
        <g aria-hidden="true">
          <path d={`M222 ${top + 17} V${top + 46}`} stroke="#fff" strokeWidth="2.2" />
          <path d={`M216 ${top + 25} L222 ${top + 17} L228 ${top + 25} M216 ${top + 38} L222 ${top + 46} L228 ${top + 38}`} stroke="#fff" strokeWidth="2.2" fill="none" />
        </g>
      )}
      {pill && <Pill cx={pill.tone === 'ok' ? 310 : 330} cy={top + 31} size={15} main={pill.main} note={pill.note} tone={pill.tone} />}
    </g>
  )
}

export default function WaterRouteArt({ route, badges, ariaLabel }) {
  const { w, h } = route.viewBox
  const stops = route.stops
  const decos = route.deco ?? []
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel} fontFamily={FONT} className="wr-art block h-auto w-full" data-route-art>
      <defs>
        <linearGradient id="wr-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c4e8a4" /><stop offset="1" stopColor="#8fca74" /></linearGradient>
        <linearGradient id="wr-soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#cc9a6e" /><stop offset="1" stopColor="#8d5f3d" /></linearGradient>
        <linearGradient id="wr-lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8bd6f8" /><stop offset="1" stopColor="#2f8fd1" /></linearGradient>
        <linearGradient id="wr-pond" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7fb9e6" /><stop offset="1" stopColor="#3f86c6" /></linearGradient>
        <linearGradient id="wr-river" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#52c4f6" /><stop offset="1" stopColor="#0a5f95" /></linearGradient>
        <linearGradient id="wr-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b88b62" /><stop offset="1" stopColor="#6f4a2e" /></linearGradient>
        <radialGradient id="wr-shadow"><stop offset="0" stopColor="#0b2f4d" stopOpacity=".26" /><stop offset="1" stopColor="#0b2f4d" stopOpacity="0" /></radialGradient>
        <pattern id="wr-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.6" height="6" fill="#dc2626" /></pattern>
        <clipPath id="wr-clip-river"><rect x="0" y={route.river.top + 42} width={w} height={h - route.river.top - 42} /></clipPath>
        <marker id="wr-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 0L10 5L0 10Z" fill="#1d5f94" />
        </marker>
      </defs>

      {(route.clouds ?? []).map(([x, y, s]) => <Cloud key={`${x}-${y}`} x={x} y={y} s={s} />)}
      {decos.map(d => <IslandShadow key={`sh-${d.island.x}-${d.island.y}`} island={d.island} th={d.island.th ?? ISLAND_THICKNESS} />)}
      {stops.map(s => <IslandShadow key={`sh-${s.n}`} island={s.island} />)}
      {decos.map(d => <IslandBody key={`d-${d.island.x}-${d.island.y}`} island={d.island} th={d.island.th ?? ISLAND_THICKNESS} />)}
      {stops.map(s => <IslandBody key={`i-${s.n}`} island={s.island} />)}

      <River route={route} badges={badges} />
      {route.streams.map(st => <Stream key={st.id} st={st} />)}

      {stops.map(s => (
        <g key={`p-${s.n}`} data-stop={s.n} data-status={s.status}>
          {(s.props ?? []).map((p, i) => <Prop key={`${s.n}-${p.t}-${i}`} p={p} />)}
        </g>
      ))}
      {[...decos.flatMap(d => d.trees ?? []), ...stops.flatMap(s => s.trees ?? [])].map(([x, y, sc]) => <Tree key={`t-${x}-${y}`} x={x} y={y} s={sc} />)}

      {stops.flatMap(s => (s.pills ?? []).map((pill, i) => {
        const resolved = pillFor(pill, badges)
        return resolved ? <Pill key={`${s.n}-pill-${i}`} cx={pill.x} cy={pill.y} size={pill.size} main={resolved.main} note={resolved.note} tone={resolved.tone} /> : null
      }))}
      {stops.map(s => { const p = pinPosition(s); return <Pin key={`pin-${s.n}`} n={s.n} x={p.x} y={p.y} /> })}
      {stops.map(s => { const p = labelPosition(s); return <Label key={`lb-${s.n}`} text={s.label} x={p.x} y={p.y} /> })}
    </svg>
  )
}
