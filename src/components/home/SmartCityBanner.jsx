import { useNavigate } from 'react-router-dom'
import { useTenant } from '../../contexts/TenantContext'
import { MapPin, MapPinned, ChevronRight } from 'lucide-react'

// แบนเนอร์ "[ชื่อ อปท.] SMART CITY" — ภาพแผนที่ผังเมือง isometric 3 มิติ + อาคารเล็กๆ + หมุด วาดเองล้วนๆ
// ด้วย SVG + ไอคอน MapPin จาก lucide-react (MIT license, เป็น dependency เดิมของโปรเจกต์อยู่แล้ว)
// ไม่ใช้ภาพสำเร็จรูป/ภาพสต็อกจากที่ไหนเลย เนื้อหา/ลิงก์ชี้ไปที่ระบบ GIS ของเราเองที่มีจริง (/data-center/public)
//
// ระบบพิกัด isometric มาตรฐาน (2:1): grid cell (col, row) แต่ละใบเป็นสี่เหลี่ยมข้าวหลามตัด (diamond)
//   isoX = originX + (col - row) * (tileW / 2)
//   isoY = originY + (col + row) * (tileH / 2)
// อาคาร = ยกพื้นสี่เหลี่ยมข้าวหลามตัดเดิมขึ้นไปตามความสูง h แล้ววาด 3 หน้า (หลังคา/ผนังซ้าย/ผนังขวา)
const TILE_W = 30
const TILE_H = 16
const ORIGIN_X = 110
const ORIGIN_Y = 22

function tileCenter(col, row) {
  return { x: ORIGIN_X + (col - row) * (TILE_W / 2), y: ORIGIN_Y + (col + row) * (TILE_H / 2) }
}
function diamond(cx, cy, w = TILE_W, h = TILE_H) {
  const hw = w / 2, hh = h / 2
  return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`
}
function block(col, row, height, colors) {
  const { x: cx, y: cy } = tileCenter(col, row)
  const hw = TILE_W / 2, hh = TILE_H / 2
  const top = cy - height
  return {
    roof:  diamond(cx, top),
    left:  `${cx - hw},${cy} ${cx},${cy + hh} ${cx},${cy + hh - height} ${cx - hw},${cy - height}`,
    right: `${cx + hw},${cy} ${cx},${cy + hh} ${cx},${cy + hh - height} ${cx + hw},${cy - height}`,
    colors,
  }
}

// ผังเมืองเล็กๆ 5x4 ช่อง — 'road' เรียบไปกับพื้น, ตัวเลขคือความสูงตึก (0 = ลานว่าง/สวน ไม่ยกพื้น)
const CITY_LAYOUT = [
  ['bldg2', 'road',  'bldg1', 'park', 'bldg1'],
  ['road',  'road',  'road',  'road', 'road'],
  ['bldg1', 'road',  'bldg3', 'road', 'bldg2'],
  ['park',  'road',  'bldg1', 'road', 'bldg1'],
]
const HEIGHTS = { bldg1: 9, bldg2: 15, bldg3: 21, park: 0, road: 0 }
const PALETTES = [
  { roof: '#93c5fd', left: '#3b82f6', right: '#1d4ed8' },
  { roof: '#c4b5fd', left: '#8b5cf6', right: '#6d28d9' },
  { roof: '#7dd3fc', left: '#0ea5e9', right: '#0369a1' },
]

const TILES = CITY_LAYOUT.flatMap((rowArr, row) =>
  rowArr.map((kind, col) => {
    const { x, y } = tileCenter(col, row)
    if (kind === 'road') return { kind, ground: diamond(x, y), col, row }
    if (kind === 'park') return { kind, ground: diamond(x, y), col, row }
    const h = HEIGHTS[kind]
    return { kind, ground: diamond(x, y), col, row, ...block(col, row, h, PALETTES[(col + row) % PALETTES.length]) }
  })
)
// เรียง depth ให้ตึกที่อยู่ "ใกล้กล้อง" กว่า (col+row มาก) วาดทับตึกที่อยู่ไกลกว่าเสมอ กันมุมซ้อนผิด
TILES.sort((a, b) => (a.col + a.row) - (b.col + b.row))

// หมุด 3 อัน — ปักบนตึกสูงสุด (เห็นชัด, มีเงาลอยจากพื้นตึก) และบนถนน/ลานว่าง 2 จุด
const PIN_TILES = [
  { col: 2, row: 2, color: '#ef4444', size: 24, onRoof: true },  // แดง ปักบนตึกสูงสุด (bldg3)
  { col: 0, row: 3, color: '#22c55e', size: 18, onRoof: false }, // เขียว ปักบนลานว่าง
  { col: 3, row: 1, color: '#3b82f6', size: 18, onRoof: false }, // ฟ้า ปักบนถนน
]

// ตำแหน่งหมุดแบบ % ธรรมดา (ไม่อิง grid) ใช้ตอนพื้นหลังเป็นรูปจริงของแอดมิน — ไม่มีผังตึกให้อิงตำแหน่งแล้ว
const PHOTO_PINS = [
  { color: '#ef4444', left: '55%', top: '35%', size: 26 },
  { color: '#22c55e', left: '72%', top: '55%', size: 20 },
  { color: '#3b82f6', left: '85%', top: '30%', size: 20 },
]

export default function SmartCityBanner() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const photoUrl = tenant?.smart_city_image_url

  return (
    <button onClick={() => navigate('/data-center/public')}
      className="w-full text-left relative rounded-2xl overflow-hidden shadow-lg active:scale-[0.98] transition-transform"
      style={{ background: photoUrl ? undefined : 'linear-gradient(180deg, #0b1a3a 0%, #14285c 55%, #1c3a7a 100%)' }}>
      {photoUrl ? (
        <>
          {/* แอดมินอัปโหลดรูปเองจากแท็บแบรนด์และรูปภาพ — ใช้เป็นพื้นหลังเต็ม เห็นรูปชัดทั้งภาพ ไม่มีเงาคลุม
              กว้างๆ แบบเดิมแล้ว (บังรูปที่แอดมินตั้งใจอัปโหลดมาโชว์) ใช้กล่องทึบเล็กๆ คลุมเฉพาะส่วนตัวหนังสือ
              แทน ให้อ่านออกโดยไม่บังรูปส่วนที่เหลือ คงหมุด GIS ไว้ทับด้านบน */}
          <img src={photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          {/* ไล่เงานุ่มๆ จากซ้าย (โซนตัวหนังสือ) แทนกล่องขอบเหลี่ยม — เนียนไปกับรูป ไม่ตัดเป็นก้อน
              เข้มพอให้อ่านออก แต่บางพอให้เห็นรูปทะลุ ผสมกับ text-shadow ที่ตัวอักษรเองอีกชั้น */}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(100deg, rgba(4,10,28,0.62) 0%, rgba(4,10,28,0.4) 32%, transparent 62%)' }} />
          {PHOTO_PINS.map((p, i) => (
            <div key={i} className="absolute" style={{ left: p.left, top: p.top, transform: 'translate(-50%, -100%)' }}>
              <MapPin size={p.size} fill={p.color} color="#ffffff" strokeWidth={1.5}
                style={{ filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.5))' }} />
            </div>
          ))}
        </>
      ) : (
        /* เส้นกริดพื้นหลังแบบ tech/GIS — เฉพาะตอนไม่มีรูปแอดมิน (ใช้ภาพวาดเองแทน) */
        <div className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'linear-gradient(rgba(96,165,250,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,0.5) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      )}

      <div className="relative z-10 flex items-center gap-3 px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex-1 min-w-0" style={photoUrl ? { textShadow: '0 2px 6px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.9)' } : undefined}>
          <p className="text-cyan-300/80 text-[10px] sm:text-xs font-bold tracking-widest uppercase mb-1">
            ระบบสารสนเทศภูมิศาสตร์เพื่อประชาชน
          </p>
          <h3 className="text-white font-black text-lg sm:text-2xl leading-tight mb-0.5">
            {tenant?.name?.replace(/^(องค์การบริหารส่วนตำบล|เทศบาลตำบล|เทศบาลเมือง|เทศบาลนคร|เทศบาล)/, '').trim() || tenant?.name}
          </h3>
          <p className="relative inline-block font-black text-2xl sm:text-3xl overflow-hidden mb-2 text-cyan-100"
            style={{
              letterSpacing: '0.08em',
              textShadow: '0 2px 6px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.9), 0 0 18px rgba(34,211,238,0.55)',
            }}>
            SMART CITY
            {/* แถบแสงสะท้อนพาดทแยง ให้ความรู้สึกมันวาวแบบตัวอักษรโลหะ/กระจก ขยับวนซ้ำเบาๆ
                (ตั้งใจไม่ใช้ background-clip:text ร่วมกับ filter บนตัวอักษรเดียวกัน — เจอบั๊ก Chrome
                จริงที่ทำให้ตัวอักษรกลายเป็นทึบดำแทนไล่เฉด สีตัวอักษรแบบทึบ + text-shadow เรืองแสงแทน
                ปลอดภัยกว่าและมองเห็นชัดแน่นอนบนทุกพื้นหลัง) */}
            <span className="absolute inset-0 pointer-events-none animate-[shine_3.5s_ease-in-out_infinite]"
              style={{ background: 'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.95) 46%, transparent 62%)' }} />
          </p>
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-white/90">
            <MapPinned size={13} className="text-cyan-300" />
            <span>ดูแผนที่ GIS &amp; ข้อมูลเปิดของ อปท.</span>
            <ChevronRight size={13} />
          </div>
        </div>

        {!photoUrl && (
          /* ผังเมือง isometric 3 มิติ + หมุดปักตำแหน่ง — วาดเองด้วย SVG + lucide MapPin (fallback ตอนไม่มีรูป) */
          <div className="relative shrink-0 w-32 h-28 sm:w-44 sm:h-36" style={{ filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.4))' }}>
            <svg viewBox="0 0 220 140" className="absolute inset-0 w-full h-full">
              {TILES.map((t, i) => {
                if (t.kind === 'road') return <polygon key={i} points={t.ground} fill="#94a3b8" stroke="#f8fafc" strokeWidth="0.6" />
                if (t.kind === 'park') return <polygon key={i} points={t.ground} fill="#65a30d" stroke="#f8fafc" strokeWidth="0.6" />
                return (
                  <g key={i}>
                    <polygon points={t.ground} fill="#00000022" />
                    <polygon points={t.left} fill={t.colors.left} />
                    <polygon points={t.right} fill={t.colors.right} />
                    <polygon points={t.roof} fill={t.colors.roof} stroke="#ffffff55" strokeWidth="0.5" />
                  </g>
                )
              })}
            </svg>
            {PIN_TILES.map((p, i) => {
              const { x, y } = tileCenter(p.col, p.row)
              const tipY = p.onRoof ? y - HEIGHTS.bldg3 : y
              return (
                <div key={i} className="absolute"
                  style={{ left: `${x / 220 * 100}%`, top: `${tipY / 140 * 100}%`, transform: 'translate(-50%, -100%)' }}>
                  <MapPin size={p.size} fill={p.color} color="#ffffff" strokeWidth={1.5}
                    style={{ filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.5))' }} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </button>
  )
}
