// ตรรกะล้วน (ไม่มี React) ของโปสเตอร์ "ภาพนำเสนอ A4" ของแผนภาพเส้นทางน้ำ — วาดด้วย src/components/water/WaterRoutePoster.jsx
// ข้อมูลตำแหน่งต่อตำบลอยู่ใน route.poster (เช่น routes/namlao.poster.js) · ชื่อจุด/สถานะ/กลุ่ม/เส้นวิ่งมาจาก route เดิมเสมอ ไม่เขียนซ้ำ
//
// ⚠️ กติกาเดียวกับแผนภาพบนหน้าเว็บ (เทสต์ posterIssues ตรึง): เส้นวิ่ง/หัวลูกศรเฉพาะลำที่ route.streams ระบุ · ไม่มีเข็มทิศ ·
//    ค่าสดผ่าน liveBadges เท่านั้น · ช่องค่าสดที่ผูกไว้ต้องปรากฏบนโปสเตอร์ครบ · แผนก่อสร้างไม่เคลื่อนไหว

import { routeItems } from './route.js'
import { govPageCss, govPagePadding } from '../govDocStyle.js'

export const POSTER_THEMES = ['dark', 'light']
export const POSTER_PRINT_SIZE = 'A4 landscape'
export const POSTER_ZONE_TONES = ['a2', 'a3', 'a4']

// ข้อความบังคับบนโปสเตอร์ — ต้นฉบับอยู่ใน WaterDiagram.jsx (คำกำกับของส่วนแผนภาพ) เทสต์ตรวจทั้งสองที่ว่ามีคำเหล่านี้ครบ
export const POSTER_DISCLAIMER = [
  'ภาพประกอบทิศทางน้ำตามผัง ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง',
  'โครงสร้างที่ผังระบุว่าชำรุดหรือแผนก่อสร้างจะไม่เคลื่อนไหว',
  'ไม่ใช่แผนที่ ตำแหน่ง ทิศ และมาตราส่วนไม่ตรงจริง',
]

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
//  gauges = จำนวนช่องค่าสดที่ผูกไว้ (อ่าง/ฝน/ระดับน้ำ) ไม่ได้แปลว่ามีค่าทุกช่องตอนนี้
export function posterStats(route) {
  const stops = route.stops
  const lanes = new Set(stops.map(s => s.group).filter(g => typeof g === 'string' && /^สายที่ \d/.test(g)))
  const planned = stops.filter(s => s.status === 'planned').reduce((sum, s) => sum + Math.max(1, (s.props ?? []).filter(p => p.t === 'ghost').length), 0)
  const gauges = new Set(stops.flatMap(s => s.live ?? []))
  return { points: stops.length + (route.river ? 1 : 0), lanes: lanes.size, planned, gauges: gauges.size }
}

// แถวในการ์ด "ค่าวัดล่าสุด" — เฉพาะจุดที่ผูกช่องค่าสด · ข้อความมาจาก badge (ไม่คิดเอง) · ซ้ำเดิม/ค้าง/ไม่มีค่า ต้องบอกตรงๆ
export function posterLiveRows(route, badges = {}) {
  const rows = []
  for (const stop of routeItems(route)) {
    for (const slot of stop.live ?? []) {
      const badge = badges[slot]
      if (!badge) continue
      const value = badge.tone === 'stale' ? 'ไม่มีค่าใหม่' : (badge.short ?? badge.text)
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
    const stop = route.stops.find(s => s.n === n)
    if (stop.status === 'planned') {
      if (!node.stem || !inBox(...node.stem)) bad(`จุด ${n}: แผนก่อสร้างต้องมี stem (เส้นประแดงไปลำน้ำ)`)
    } else if (node.stem) bad(`จุด ${n}: เฉพาะแผนก่อสร้างที่มี stem`)
  }
  for (const key of Object.keys(poster.nodes ?? {})) if (!stopNums.includes(Number(key))) bad(`มีโนด ${key} ที่ไม่มีจุดนี้ในผัง`)

  // ช่องค่าสด: ที่ผังผูกไว้ต้องมี ring/pill บนโปสเตอร์ครบ ไม่เกิน ไม่ขาด และอยู่บนจุดที่ผังผูกช่องนั้นจริง
  const routeSlots = new Map()
  for (const stop of route.stops) for (const slot of stop.live ?? []) routeSlots.set(slot, stop.n)
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
  for (const [slot, n] of routeSlots) if (posterSlots.get(slot) !== n) bad(`ช่องค่าสด ${slot} (จุด ${n}) ไม่ปรากฏบนโปสเตอร์ที่จุดเดียวกัน`)
  for (const [slot, n] of posterSlots) if (!routeSlots.has(slot)) bad(`โปสเตอร์แสดงช่อง ${slot} (จุด ${n}) ที่ผังไม่ได้ผูกไว้`)

  // ลำน้ำ: ทุกลำใน route.streams ต้องมีบนโปสเตอร์และ flow ตรงกัน · เส้นตกแต่งต้องไม่วิ่ง
  const streams = poster.streams ?? []
  const ids = new Set()
  for (const s of streams) {
    if (ids.has(s.id)) bad(`ลำน้ำ ${s.id} ซ้ำ`)
    ids.add(s.id)
    if (!Array.isArray(s.pts) || s.pts.length < 2 || !s.pts.every(p => inBox(p[0], p[1]))) bad(`ลำน้ำ ${s.id}: จุดต้องอยู่ในกรอบ ≥ 2 จุด`)
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

  const river = poster.river
  if (route.river && !(river && inBox(river.x, river.y) && inBox(river.x + river.w, river.y + river.h))) bad('แถบลำน้ำปลายทางต้องอยู่ในกรอบ')
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
  [data-poster-toolbar], [data-poster-hint] { display: none !important; }
  [data-poster-stage] { display: block !important; padding: 0 !important; overflow: visible !important; }
  [data-poster-sheet] { width: 297mm !important; min-width: 0 !important; max-width: none !important; height: 208mm !important; aspect-ratio: auto !important; border-radius: 0 !important; box-shadow: none !important; box-sizing: border-box; padding: ${govPagePadding({ size: POSTER_PRINT_SIZE })}; margin: 0 !important; overflow: hidden; break-inside: avoid; background: #fff; }
  [data-poster-sheet] svg { width: 100%; height: 100%; display: block; }
}`
}
