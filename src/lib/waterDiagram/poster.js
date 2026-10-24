// ตรรกะล้วน (ไม่มี React) ของโปสเตอร์ "ภาพนำเสนอ A4" ของแผนภาพเส้นทางน้ำ — วาดด้วย src/components/water/WaterRoutePoster.jsx
// ข้อมูลตำแหน่งต่อตำบลอยู่ใน route.poster (เช่น routes/namlao.poster.js) · ชื่อจุด/สถานะ/กลุ่ม/เส้นวิ่งมาจาก route เดิมเสมอ ไม่เขียนซ้ำ
//
// ⚠️ กติกาเดียวกับแผนภาพบนหน้าเว็บ (เทสต์ posterIssues ตรึง): เส้นวิ่ง/หัวลูกศรเฉพาะลำที่ route.streams ระบุ · ไม่มีเข็มทิศ ·
//    ค่าสดผ่าน liveBadges เท่านั้น · ช่องค่าสดที่ผูกไว้ต้องปรากฏบนโปสเตอร์ครบ · แผนก่อสร้างไม่เคลื่อนไหว

import { chipWidth } from './model.js'
import { routeItems } from './route.js'
import { govPageCss, govPagePadding } from '../govDocStyle.js'

export const POSTER_THEMES = ['dark', 'light']
export const POSTER_PRINT_SIZE = 'A4 landscape'

// วันที่-เวลาของข้อมูลสดบนภาพ/แผ่นรายการ (พ.ศ. เวลาไทย)
export const posterDateTime = now => new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok',
}).format(new Date(now))
export const POSTER_ZONE_TONES = ['a2', 'a3', 'a4']

// เลย์เอาต์หัวโปสเตอร์ (ซ้าย → ขวา: ชื่อตำบล · กล่องคำอธิบายสัญลักษณ์ · แถบตัวเลขชิดขวา) — ชื่อตำบลยาว (ตำหนักธรรม) ย่อตัวอักษรและดันกล่องคำอธิบายไปทางขวา
// ไม่ให้ทับกัน · fits = กล่องคำอธิบายไม่ชนแถบตัวเลข (posterIssues ตรวจ)
export const POSTER_HEADER = { titleX: 46, sizeLong: 46, size: 58, longVisible: 10, legendMinX: 344, legendW: 246, gap: 24, tilesRight: 1092, tileStep: 124 }
export function posterHeader(route) {
  const h = POSTER_HEADER
  const visible = (chipWidth(route.title, 100) - 22) / 56 // จำนวนตัวอักษรที่เห็น (ไม่นับสระ/วรรณยุกต์ลอย) ตามสูตรเดียวกับความกว้างป้าย
  const titleSize = visible > h.longVisible ? h.sizeLong : h.size
  // 0.52 ของขนาดตัวอักษรต่อตัว = ความกว้างหัวเรื่องที่วัดจากภาพจริง (ตัวหนา 800) — เล็กกว่าค่า 0.56 ของป้ายเพราะหัวเรื่องไม่มีขอบป้าย · วัดซ้ำด้วยเบราว์เซอร์ในเทสต์
  const titleEnd = h.titleX + Math.ceil(visible * titleSize * 0.52)
  const legendX = Math.max(h.legendMinX, Math.ceil(titleEnd + h.gap))
  const tilesX = h.tilesRight - posterTiles(posterStats(route)).length * h.tileStep
  return { titleSize, titleEnd, legendX, legendW: h.legendW, tilesX, fits: legendX + h.legendW + 4 <= tilesX }
}

// ข้อความบังคับบนโปสเตอร์ — ต้นฉบับอยู่ใน WaterDiagram.jsx (คำกำกับของส่วนแผนภาพ) เทสต์ตรวจทั้งสองที่ว่ามีคำเหล่านี้ครบ
export const POSTER_DISCLAIMER = [
  'ภาพประกอบทิศทางน้ำตามผัง ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง',
  'โครงสร้างที่ผังระบุว่าชำรุดหรือแผนก่อสร้างจะไม่เคลื่อนไหว',
  'ไม่ใช่แผนที่ ตำแหน่ง ทิศ และมาตราส่วนไม่ตรงจริง',
]

// สัญลักษณ์ที่ข้อมูลโปสเตอร์ระบุเองได้ (node.icon) เมื่อสัญลักษณ์ที่ตัดสินจาก props ไม่ตรงกับตัวจุด:
//  canal = จุดที่คลองตัดผ่านน้ำแม่คำมี (props มีแต่สะพานข้างคลอง ซึ่งจะทำให้โนดถูกวาดเป็นสะพานทั้งที่จุดนี้คือคลอง)
export const POSTER_ICON_OVERRIDES = ['canal']

// สัญลักษณ์ในโนด: ตัดสินจาก props ของจุด (ไม่กำหนดมือรายหมายเลข) — แผนก่อสร้าง = กล่องแดงประเสมอ ไม่วาดฝาย/อ่างเหมือนของที่มีอยู่
export function posterIcon(stop) {
  if (stop.status === 'planned') return { kind: 'plan' }
  const props = stop.props ?? []
  const of = type => props.filter(p => p.t === type)
  const creeks = of('creeks')[0]
  if (creeks) return { kind: 'creeks', n: creeks.n }
  for (const kind of ['village', 'supply', 'bridge', 'gate']) if (of(kind).length) return { kind }
  const lakes = of('lake')
  if (lakes.length) return { kind: 'lake', na: lakes.every(l => l.na === true) }
  const ponds = of('pond')
  const weirs = of('weir')
  if (ponds.length && !weirs.length) return { kind: 'pond', n: ponds.length }
  if (weirs.length) return { kind: 'weir', n: weirs.length }
  return { kind: 'plain' }
}

// ตัวเลขบนหัวโปสเตอร์ — คำนวณจากข้อมูลผังทุกครั้ง ไม่พิมพ์ตัวเลขตายตัว
//  points = จุดทั้งหมดรวมลำน้ำปลายทาง · lanes = สายน้ำที่ผังตั้งชื่อ "สายที่ N" · planned = จำนวน "โครงสร้าง" แผนก่อสร้าง (ฝาย 2 แห่งในจุดเดียวนับ 2)
//  repairs = จำนวนจุดที่ผังระบุว่าชำรุด
//  gauges = จำนวนช่องค่าสดที่ผูกไว้ (อ่าง/ฝน/ระดับน้ำ รวมช่องของแม่น้ำปลายทาง) ไม่ได้แปลว่ามีค่าทุกช่องตอนนี้
export function posterStats(route) {
  const stops = route.stops
  const lanes = new Set(stops.map(s => s.group).filter(g => typeof g === 'string' && /^สายที่ \d/.test(g)))
  const planned = stops.filter(s => s.status === 'planned').reduce((sum, s) => sum + Math.max(1, (s.props ?? []).filter(p => p.t === 'ghost').length), 0)
  const repairs = stops.filter(s => s.status === 'repair').length
  const gauges = new Set(routeItems(route).flatMap(s => s.live ?? []))
  return { points: stops.length + (route.river ? 1 : 0), lanes: lanes.size, planned, repairs, gauges: gauges.size }
}

// แถบตัวเลขหัวโปสเตอร์: [[ตัวเลข, ป้าย]] — "จุดสำคัญ" มีเสมอ ที่เหลือขึ้นเมื่อผังนั้นมีจริง (ผังที่ไม่ได้แบ่งเป็น "สายที่ N" ไม่ขึ้น "0 สายน้ำ")
// ไม่เกิน 4 ช่อง (พื้นที่ข้างคำอธิบายสัญลักษณ์) — posterIssues ตรวจ
export const POSTER_TILES_MAX = 4
export function posterTiles(stats) {
  return [
    [stats.points, 'จุดสำคัญ'],
    stats.lanes > 0 && [stats.lanes, 'สายน้ำในผัง'],
    stats.planned > 0 && [stats.planned, 'แผนก่อสร้าง'],
    stats.repairs > 0 && [stats.repairs, 'ชำรุดตามผัง'],
    stats.gauges > 0 && [stats.gauges, 'จุดวัดค่า'],
  ].filter(Boolean)
}

// แถวในการ์ด "ค่าวัดล่าสุด" — เฉพาะจุดที่ผูกช่องค่าสด · ข้อความมาจาก badge (ไม่คิดเอง) · ซ้ำเดิม/ค้าง/ไม่มีค่า ต้องบอกตรงๆ
export function posterLiveRows(route, badges = {}) {
  const rows = []
  for (const stop of routeItems(route)) {
    for (const slot of stop.live ?? []) {
      const badge = badges[slot]
      if (!badge) continue
      // ระดับน้ำ (level-*): ใช้ข้อความเต็มที่มีชื่อสถานี + ระยะ — สถานีอยู่ห่างตำบล ผู้อ่านต้องรู้ว่าตัวเลขมาจากไหน (ข้อความของ liveBadges ไม่คิดเอง)
      const value = slot.startsWith('level-') ? badge.text : badge.tone === 'stale' ? 'ไม่มีค่าใหม่' : (badge.short ?? badge.text)
      // หมายเหตุที่ซ้ำกับค่าที่แสดงอยู่แล้ว (เช่น ค้าง = "ไม่มีค่าใหม่" ทั้งค่าและหมายเหตุ) ไม่พิมพ์สองรอบ
      rows.push({ slot, n: stop.n, label: stop.label, tone: badge.tone, value, note: badge.note && badge.note !== value ? badge.note : null })
    }
  }
  return rows
}

// ชื่อที่ไม่ได้วาด (ก่อนเครื่องหมาย " — " ของรายการ omitted) — ขึ้นบรรทัดท้ายโปสเตอร์ ให้คนถือกระดาษรู้ว่าอะไรไม่อยู่ในภาพ
export function posterOmittedNames(diagram) {
  return (diagram.omitted ?? []).map(text => String(text).split(' — ')[0].trim()).filter(Boolean)
}

// ตำแหน่งตามความยาวเส้น: ระยะสะสมจากต้นเส้นถึงจุดบนเส้นที่ใกล้จุด (px, py) ที่สุด — ใช้ตรวจว่าจุดเรียงตามทิศน้ำ
function alongPolyline(pts, px, py) {
  let best = { d: Infinity, at: 0 }
  let run = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const len = Math.hypot(bx - ax, by - ay)
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (len * len)))
    const d = Math.hypot(ax + t * (bx - ax) - px, ay + t * (by - ay) - py)
    if (d < best.d - 1e-9) best = { d, at: run + t * len }
    run += len
  }
  return best.at
}

// ตรวจข้อมูลโปสเตอร์เทียบกับ route — คืนรายการปัญหา (ว่าง = ผ่าน) · เทสต์เรียกกับทุก route ที่มี poster
export function posterIssues(route) {
  const issues = []
  const bad = text => issues.push(text)
  const poster = route.poster
  if (!poster) return ['route ไม่มี poster']
  const { w, h } = poster.viewBox ?? {}
  if (!(w > 0 && h > 0)) return ['poster.viewBox ต้องมี w และ h']
  const finite = (...nums) => nums.every(Number.isFinite)
  const inBox = (x, y) => finite(x, y) && x >= 0 && x <= w && y >= 0 && y <= h

  // โนด: ทุกจุดของผัง (ไม่รวมแม่น้ำ) ต้องมีตำแหน่ง · ไม่มีโนดของจุดที่ไม่มีในผัง
  const stopNums = route.stops.map(s => s.n)
  for (const n of stopNums) {
    const node = poster.nodes?.[n]
    if (!node) { bad(`จุด ${n}: ไม่มีตำแหน่งบนโปสเตอร์`); continue }
    if (!inBox(node.x, node.y)) bad(`จุด ${n}: โนดอยู่นอกกรอบ`)
    const [lx, ly, anchor] = node.label ?? []
    if (!inBox(lx, ly) || !['start', 'middle', 'end'].includes(anchor)) bad(`จุด ${n}: ป้ายชื่อต้องมี [x, y, anchor] ในกรอบ`)
    if (node.icon !== undefined && !POSTER_ICON_OVERRIDES.includes(node.icon)) bad(`จุด ${n}: ชนิดสัญลักษณ์ ${node.icon} ไม่รู้จัก`)
    const stop = route.stops.find(s => s.n === n)
    if (stop.status === 'planned') {
      if (!node.stem || !inBox(...node.stem)) bad(`จุด ${n}: แผนก่อสร้างต้องมี stem (เส้นประแดงไปลำน้ำ)`)
    } else if (node.stem) bad(`จุด ${n}: เฉพาะแผนก่อสร้างที่มี stem`)
  }
  for (const key of Object.keys(poster.nodes ?? {})) if (!stopNums.includes(Number(key))) bad(`มีโนด ${key} ที่ไม่มีจุดนี้ในผัง`)

  // ช่องค่าสด: ที่ผังผูกไว้ต้องมี ring/pill บนโปสเตอร์ครบ ไม่เกิน ไม่ขาด และอยู่บนจุดที่ผังผูกช่องนั้นจริง
  // (รวมช่องของแม่น้ำปลายทาง: ป้ายอยู่ที่ poster.river.pill)
  const routeSlots = new Map()
  for (const item of routeItems(route)) for (const slot of item.live ?? []) routeSlots.set(slot, item.n)
  const posterSlots = new Map()
  const place = (slot, key) => {
    if (posterSlots.has(slot)) bad(`ช่องค่าสด ${slot} ปรากฏบนโปสเตอร์ซ้ำ (จุด ${posterSlots.get(slot)} และ ${key})`)
    posterSlots.set(slot, Number(key))
  }
  for (const [key, node] of Object.entries(poster.nodes ?? {})) {
    if (node.ring) place(node.ring, key)
    if (node.pill) {
      place(node.pill.slot, key)
      if (!inBox(node.pill.x, node.pill.y)) bad(`จุด ${key}: ป้ายค่าสดอยู่นอกกรอบ`)
    }
  }
  if (poster.river?.pill) {
    place(poster.river.pill.slot, route.river?.n)
    if (!inBox(poster.river.pill.x, poster.river.pill.y)) bad('ป้ายค่าสดของแม่น้ำอยู่นอกกรอบ')
  }
  for (const [slot, n] of routeSlots) if (posterSlots.get(slot) !== n) bad(`ช่องค่าสด ${slot} (จุด ${n}) ไม่ปรากฏบนโปสเตอร์ที่จุดเดียวกัน`)
  for (const [slot, n] of posterSlots) if (!routeSlots.has(slot)) bad(`โปสเตอร์แสดงช่อง ${slot} (จุด ${n}) ที่ผังไม่ได้ผูกไว้`)

  // การ์ด "ค่าวัดล่าสุด" ต้องมีตำแหน่งเมื่อผังมีช่องค่าสด (x = ขอบซ้าย · bottom = ขอบล่าง การ์ดโตขึ้นด้านบนตามจำนวนแถว · w = ความกว้าง)
  if (routeSlots.size > 0) {
    const card = poster.liveCard
    if (!(card && inBox(card.x, card.bottom) && Number.isFinite(card.w) && card.w > 0 && card.x + card.w <= w)) bad('ผังที่มีช่องค่าสดต้องกำหนด liveCard { x, bottom, w } ในกรอบ')
  }

  // ลำน้ำ: ทุกลำใน route.streams ต้องมีบนโปสเตอร์และ flow ตรงกัน · เส้นตกแต่งต้องไม่วิ่ง
  const streams = poster.streams ?? []
  const ids = new Set()
  for (const s of streams) {
    if (ids.has(s.id)) bad(`ลำน้ำ ${s.id} ซ้ำ`)
    ids.add(s.id)
    if (!Array.isArray(s.pts) || s.pts.length < 2 || !s.pts.every(p => inBox(p[0], p[1]))) bad(`ลำน้ำ ${s.id}: จุดต้องอยู่ในกรอบ ≥ 2 จุด`)
    if (s.label !== undefined) {
      const text = s.label?.text
      const known = [...route.stops, ...(route.river ? [route.river] : [])].some(item => `${item.name ?? ''} ${item.label ?? ''} ${item.sub ?? ''}`.includes(text ?? ''))
      if (!text || !known) bad(`ลำน้ำ ${s.id}: ป้ายชื่อ "${text}" ไม่อยู่ในชื่อ/คำอธิบายจุดใดของผัง (ไม่เขียนชื่อที่ผังไม่มี)`)
      if (!inBox(s.label?.x, s.label?.y) || !['start', 'middle', 'end'].includes(s.label?.anchor)) bad(`ลำน้ำ ${s.id}: ป้ายชื่อต้องมี x y anchor ในกรอบ`)
    }
    const original = route.streams.find(r => r.id === s.id)
    if (original) {
      if (s.deco) bad(`ลำน้ำ ${s.id}: มีใน route.streams ห้ามเป็น deco`)
      if (Boolean(s.flow) !== Boolean(original.flow)) bad(`ลำน้ำ ${s.id}: flow ต้องตรงกับผัง (${original.flow})`)
    } else {
      if (!s.deco) bad(`ลำน้ำ ${s.id}: ไม่อยู่ใน route.streams ต้องระบุ deco: true`)
      if (s.flow) bad(`ลำน้ำ ${s.id}: เส้นตกแต่งห้ามวิ่ง/มีหัวลูกศร`)
    }
  }
  for (const original of route.streams) if (!ids.has(original.id)) bad(`ลำน้ำ ${original.id} ของผังไม่ปรากฏบนโปสเตอร์`)
  // ทิศของเส้นวิ่ง: ผังระบุลำดับจุดที่น้ำผ่าน (touches) เส้นต้องวาดไล่ตามลำดับนั้น — ถ้าวาดกลับด้าน หัวลูกศรจะชี้ทางตรงข้ามกับที่ผังวาด
  for (const original of route.streams) {
    const drawn = streams.find(s => s.id === original.id)
    const nodes = (original.touches ?? []).map(n => poster.nodes?.[n]).filter(Boolean)
    if (!original.flow || !drawn || !Array.isArray(drawn.pts) || nodes.length < 2) continue
    const at = nodes.map(node => alongPolyline(drawn.pts, node.x, node.y))
    for (let i = 1; i < at.length; i++) {
      if (at[i] + 1 < at[i - 1]) { bad(`ลำน้ำ ${original.id}: จุด ${original.touches[i]} อยู่ก่อนจุด ${original.touches[i - 1]} ตามทิศที่วาดเส้น — ทิศเส้นต้องเรียงตามที่ผังวาดลูกศร`); break }
    }
  }

  // โซน: group ต้องมีในผัง
  const groups = new Set(route.stops.map(s => s.group).filter(Boolean))
  for (const zone of poster.zones ?? []) {
    if (!groups.has(zone.group)) bad(`โซน "${zone.title}": group ไม่ตรงกับชื่อสายในผัง`)
    if (!POSTER_ZONE_TONES.includes(zone.tone)) bad(`โซน "${zone.title}": tone ${zone.tone} ไม่รู้จัก`)
    if (!inBox(zone.x, zone.y) || !inBox(zone.x + zone.w, zone.y + zone.h)) bad(`โซน "${zone.title}": ล้นกรอบ`)
  }

  // การ์ดข้อความ: ชื่อห้วยที่เขียนต้องอยู่ในคำอธิบายจุดที่อ้างถึง (ไม่เขียนชื่อที่ผังไม่มี)
  for (const card of poster.callouts ?? []) {
    const stop = route.stops.find(s => s.n === card.stop)
    if (!stop) { bad(`การ์ด ${card.id}: อ้างจุด ${card.stop} ที่ไม่มี`); continue }
    for (const line of card.lines ?? []) for (const name of line.names ?? []) {
      if (!String(stop.sub ?? '').includes(name)) bad(`การ์ด ${card.id}: ชื่อ "${name}" ไม่อยู่ในคำอธิบายจุด ${card.stop} ของผัง`)
    }
  }

  // แถบลำน้ำปลายทาง: ต้องมีข้อความกำกับ · หัวลูกศรต้องตรงกับที่ผังต้นฉบับระบุ (route.river.sub) และคำกำกับต้องไม่ขัดกับหัวลูกศรที่วาด
  const river = poster.river
  if (route.river) {
    if (!(river && inBox(river.x, river.y) && inBox(river.x + river.w, river.y + river.h))) bad('แถบลำน้ำปลายทางต้องอยู่ในกรอบ')
    else {
      if (!river.caption) bad('แถบลำน้ำปลายทางต้องมีข้อความกำกับ (caption)')
      if (![undefined, null, 'left', 'right'].includes(river.arrow)) bad(`หัวลูกศรแม่น้ำ ${river.arrow} ไม่รู้จัก (left | right | ไม่ใส่)`)
      const sub = String(route.river.sub ?? '')
      const says = { left: /หัวลูกศรชี้ไปทาง(ซ้าย|ตะวันตก)/.test(sub), right: /หัวลูกศรชี้ไปทาง(ขวา|ตะวันออก)/.test(sub) }
      for (const dir of ['left', 'right']) {
        if ((river.arrow === dir) !== says[dir]) bad(river.arrow === dir ? `แม่น้ำวาดหัวลูกศรชี้${dir === 'left' ? 'ซ้าย' : 'ขวา'} แต่ผังต้นฉบับ (route.river.sub) ไม่ได้ระบุทิศนี้` : `ผังต้นฉบับ (route.river.sub) ระบุหัวลูกศรชี้${dir === 'left' ? 'ซ้าย' : 'ขวา'} แต่แม่น้ำบนโปสเตอร์ไม่ได้วาด`)
      }
      const wordsOf = { left: /ซ้าย|ตะวันตก/, right: /ขวา|ตะวันออก/ }
      for (const dir of ['left', 'right']) if (river.arrow !== dir && wordsOf[dir].test(river.caption ?? '')) bad(`คำกำกับแม่น้ำพูดถึงทิศ${dir === 'left' ? 'ซ้าย/ตะวันตก' : 'ขวา/ตะวันออก'} ทั้งที่หัวลูกศรที่วาดไม่ใช่ทิศนี้`)
    }
  }
  if (!posterHeader(route).fits) bad('ชื่อตำบลยาวจนกล่องคำอธิบายสัญลักษณ์ชนแถบตัวเลขหัวโปสเตอร์')
  if (posterTiles(posterStats(route)).length > POSTER_TILES_MAX) bad(`แถบตัวเลขหัวโปสเตอร์เกิน ${POSTER_TILES_MAX} ช่อง`)
  return issues
}

// CSS ของหน้าพิมพ์ — ฉีดเข้า <head> เฉพาะตอนเปิดหน้าต่างนี้ (กฎ @page ใช้เป็นราย "เอกสาร" ไม่ผูกกับคลาส จึงไม่ฝังลงไฟล์ CSS ถาวร ไม่งั้นจะไปกระทบการพิมพ์หน้าอื่น)
// ใช้ค่าจากตัวกลาง govDocStyle: ฟอนต์ราชการ + ขอบแนวนอน (3 ซม. บน · 2 ซม. ซ้ายขวา · 1 ซม. ล่าง) + ซ่อนหัว/ท้ายกระดาษของเบราว์เซอร์ด้วย padding
// ⚠️ ข้อยกเว้นเดียว: ขนาดตัวอักษรในภาพเป็นหน่วยของ SVG ตามสัดส่วนภาพ ไม่ใช่ 14pt (เป็นภาพอินโฟกราฟิก ไม่ใช่ตัวเอกสาร) — ข้อความบนกระดาษย่อตามขนาดภาพ
export function posterPrintCss() {
  return `
${govPageCss({ size: POSTER_PRINT_SIZE, hideBrowserHeader: true })}
@media print {
  html, body { background: #fff !important; margin: 0 !important; }
  body > *:not([data-poster-overlay]) { display: none !important; }
  [data-poster-overlay] { position: static !important; inset: auto !important; display: block !important; background: none !important; overflow: visible !important; padding: 0 !important; }
  [data-poster-toolbar], [data-poster-hint], [data-poster-label] { display: none !important; }
  [data-poster-page] { width: auto !important; min-width: 0 !important; max-width: none !important; margin: 0 !important; }
  [data-poster-stage] { display: block !important; padding: 0 !important; overflow: visible !important; }
  [data-poster-sheet] { width: 297mm !important; min-width: 0 !important; max-width: none !important; height: 208mm !important; aspect-ratio: auto !important; border-radius: 0 !important; box-shadow: none !important; box-sizing: border-box; padding: ${govPagePadding({ size: POSTER_PRINT_SIZE })}; margin: 0 !important; overflow: hidden; break-inside: avoid; background: #fff; }
  [data-poster-sheet]:not([data-poster-sheet-list]) { break-after: page; }
  [data-poster-sheet] svg { width: 100%; height: 100%; display: block; }
}`
}
