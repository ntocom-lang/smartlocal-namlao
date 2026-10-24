// ตรรกะล้วนของ "ผังน้ำตำบล" (src/components/water/WaterRouteArt.jsx + WaterRouteList.jsx) — ทดสอบใน node (tests/water-diagram.test.mjs)
//
// แผนภาพนี้เป็น "ภาพประกอบ" ของผังที่ศูนย์ฯ แพร่วาดไว้ ไม่ใช่แผนที่ (เจ้าของระบบสั่ง 2569-10-21 ให้ไม่ซ้ำกับผังต้นฉบับ):
// เกาะลอย 1 จุด = 1 หมายเลข · ตำแหน่ง/ทิศ/มาตราส่วนไม่ตรงจริง · เกาะกับต้นไม้ที่ไม่มีหมายเลขเป็นของตกแต่ง ไม่ได้หมายถึงสิ่งใดในพื้นที่
//
// หลักกันภาพหลอก (สืบจากผังเดิม ดู model.js):
//  1) เส้นที่วิ่ง = เฉพาะที่ผังต้นฉบับวาดลูกศรทิศน้ำ (flow: true) และห้ามวิ่งผ่านจุดที่ผังระบุว่าแผนก่อสร้าง/ชำรุด
//  2) ค่าสดมาจาก liveBadges เท่านั้น (ค้าง/ซ้ำเดิม/ไม่มีค่า ต้องแสดงตามจริง) ไม่ลงสีตามระดับน้ำ
//  3) ไม่มีเข็มทิศ — ผังต้นฉบับไม่ระบุทิศ
//  4) ของที่ผังมีแต่ไม่ได้วาด ต้องอยู่ใน omitted ของผัง (กล่องที่มา)

import { CHIP_TONES, DIAGRAM_STATUSES, chipWidth } from './model.js'

// ชนิดของสิ่งที่วางบนเกาะ (props) — เพิ่มชนิดใหม่ต้องเพิ่มทั้งที่นี่และใน WaterRouteArt.jsx
export const PROP_KINDS = ['lake', 'pond', 'weir', 'ghost', 'pump', 'gate', 'repair', 'creeks', 'bridge', 'supply', 'village']

// เกาะแต่ละเกาะหนา th และมีเงา — ใช้คำนวณทั้งตอนวาดและตอนเช็กว่าเกาะไม่ทับกัน
export const ISLAND_THICKNESS = 14

// เส้นโค้งลื่นผ่านจุดที่กำหนด (Catmull-Rom → Bézier) — จุดต้องมีอย่างน้อย 2 จุด
export function smoothPath(points) {
  if (!Array.isArray(points) || points.length < 2) return ''
  const r = n => Math.round(n * 100) / 100
  let d = `M${r(points[0][0])} ${r(points[0][1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] || p2
    d += ` C${r(p1[0] + (p2[0] - p0[0]) / 6)} ${r(p1[1] + (p2[1] - p0[1]) / 6)},${r(p2[0] - (p3[0] - p1[0]) / 6)} ${r(p2[1] - (p3[1] - p1[1]) / 6)},${r(p2[0])} ${r(p2[1])}`
  }
  return d
}

// รูปเกาะ: ด้านข้างดิน (วงรีล่างสองชั้น) + ผิวหญ้า + "หยดดิน" ใต้เกาะให้ดูลอย
export function islandShape({ x, y, rx, ry }, th = ISLAND_THICKNESS) {
  const bottom = u => y + th + ry * Math.sqrt(Math.max(0, 1 - (u / rx) ** 2))
  const drips = [[-0.46, 13], [0.04, 19], [0.5, 10]].map(([k, h]) => {
    const u = rx * k
    const yy = bottom(u)
    return `M${x + u - 8} ${yy - 2} L${x + u + 8} ${yy - 2} L${x + u} ${yy + h}Z`
  })
  return {
    side: `M${x - rx} ${y} A${rx} ${ry} 0 0 0 ${x + rx} ${y} L${x + rx} ${y + th} A${rx} ${ry} 0 0 1 ${x - rx} ${y + th}Z`,
    drips,
    shadow: { cx: x, cy: y + th + ry + 24, rx: rx * 0.85, ry: ry * 0.6 },
  }
}

// ลูกคลื่นน้ำ: เส้นคลื่นกว้างเกินกรอบ 60 หน่วยทั้งสองข้าง เพื่อให้เลื่อนได้ 1 คาบ (period) วนต่อเนื่องไม่เห็นรอยขาด
export function wavePath(x0, x1, y, floor, period = 28) {
  let d = `M${x0 - 60} ${y}`
  for (let x = x0 - 60; x < x1 + 60; x += period) d += ` q${period / 4} -5 ${period / 2} 0 t${period / 2} 0`
  return `${d} V${floor} H${x0 - 60}Z`
}

// ชนิดสัญลักษณ์ที่แผนภาพนี้ใช้จริง — ให้คำอธิบายสัญลักษณ์ใต้ภาพขึ้นเฉพาะที่ผังนั้นมี (ไม่โชว์ของที่ไม่มีในภาพ)
// 'planned' = มีจุดแผนก่อสร้าง · 'flow' = มีเส้นวิ่ง · 'na' = ป้ายขอบประ (ไม่มีค่า/ค้าง/ไม่ระบุ) ซึ่งเกิดได้ทุกผังที่มีป้ายค่าสด จึงมีเสมอ
export function routeKinds(route) {
  const kinds = new Set(['na'])
  for (const stop of route.stops) {
    if (stop.status === 'planned') kinds.add('planned')
    for (const prop of stop.props ?? []) {
      kinds.add(prop.t)
      if (prop.t === 'creeks' && prop.weirs > 0) kinds.add('weir')
    }
  }
  if ((route.streams ?? []).some(st => st.flow)) kinds.add('flow')
  return kinds
}

export const pinPosition = stop => ({ x: stop.island.x - stop.island.rx + 10, y: stop.island.y - 4 })
export const labelPosition = stop => ({ x: stop.island.x, y: stop.island.y - stop.island.ry - 10 - (stop.labelUp ?? 0) })

/**
 * ป้ายค่าสดบนภาพ: คืน { main, note, tone } หรือ null ถ้าไม่มีช่องนี้ใน badges
 * main = ข้อความสั้นจาก liveBadges (short) · note = หมายเหตุใต้ป้าย เฉพาะซ้ำเดิม/ค้าง/โหลดไม่ได้ · tone ใช้สีตาม CHIP_TONES
 */
export function pillFor(pill, badges) {
  if (pill.slot) {
    const badge = badges?.[pill.slot]
    if (!badge) return null
    return { main: badge.short ?? badge.text, note: badge.note ?? null, tone: badge.tone }
  }
  return { main: pill.text, note: null, tone: pill.tone }
}

// ความกว้างป้ายตามตัวหนังสือ (หน่วยพิกัดภาพ) — ใช้สูตรเดียวกับผังเดิม
export const pillWidth = (text, size) => chipWidth(text, size)

// จุดทั้งหมดที่ต้องมีหมายเลข (เกาะ + แม่น้ำ) เรียงตามหมายเลข — ใช้กับรายการจุด
export function routeItems(route) {
  const river = route.river ? [{ ...route.river, isRiver: true }] : []
  return [...route.stops, ...river].sort((a, b) => a.n - b.n)
}

/**
 * ตรวจความถูกต้องของข้อมูลเส้นทาง — คืนรายการปัญหา (ว่าง = ผ่าน) · เทสต์เรียกกับทุกผังที่มี route
 * binds = ตารางช่องค่าสดของผัง (diagram.binds)
 */
export function routeIssues(route, binds = {}) {
  const issues = []
  const bad = text => issues.push(text)
  const { w, h } = route.viewBox ?? {}
  if (!(w > 0 && h > 0)) return ['viewBox ต้องมี w และ h']
  const finite = (...nums) => nums.every(Number.isFinite)
  const inBox = (x, y) => finite(x, y) && x >= 0 && x <= w && y >= 0 && y <= h

  // หมายเลข: 1..N ต่อเนื่อง ไม่ซ้ำ · แม่น้ำเป็นเลขสุดท้าย
  const nums = route.stops.map(s => s.n)
  nums.forEach((n, i) => { if (n !== i + 1) bad(`หมายเลขต้องเรียง 1..N ต่อเนื่อง (ตำแหน่งที่ ${i + 1} คือ ${n})`) })
  if (!route.river || route.river.n !== route.stops.length + 1) bad('แม่น้ำต้องเป็นหมายเลขสุดท้าย (จำนวนจุด + 1)')
  for (const key of ['eyebrow', 'title', 'place', 'heading']) if (!route[key]) bad(`ขาดฟิลด์ ${key}`)

  const usedSlots = new Set()
  const markSlot = (slot, where) => {
    usedSlots.add(slot)
    if (!Object.hasOwn(binds, slot)) bad(`${where}: ช่องค่าสด ${slot} ไม่อยู่ใน binds`)
  }

  const islands = []
  for (const stop of route.stops) {
    const tag = `จุด ${stop.n}`
    if (!stop.name || !stop.label) bad(`${tag}: ต้องมี name (รายการ) และ label (ชื่อบนภาพ)`)
    if (!DIAGRAM_STATUSES.includes(stop.status)) bad(`${tag}: status ${stop.status} ไม่ถูกต้อง`)
    const { x, y, rx, ry } = stop.island ?? {}
    if (!finite(x, y, rx, ry) || rx <= 0 || ry <= 0) { bad(`${tag}: เกาะต้องมี x y rx ry เป็นตัวเลข`); continue }
    if (x - rx < 0 || x + rx > w) bad(`${tag}: เกาะล้นกรอบด้านข้าง`)
    if (y + ry + ISLAND_THICKNESS + 20 > h) bad(`${tag}: เกาะเลยกรอบด้านล่าง`)
    const label = labelPosition(stop)
    if (label.y < 14) bad(`${tag}: ชื่อบนภาพออกนอกกรอบด้านบน`)
    islands.push({ id: tag, ...stop.island })

    // จุดที่ผังระบุว่าแผนก่อสร้าง/ชำรุด ต้องบอกในรายการและบนภาพ ไม่ปล่อยให้ดูเหมือนของที่มีอยู่
    const kinds = (stop.tags ?? []).map(t => t.k)
    if (stop.status === 'planned' && !kinds.includes('plan')) bad(`${tag}: แผนก่อสร้างต้องมีแท็ก plan ในรายการ`)
    if (stop.status === 'repair' && !kinds.includes('fix')) bad(`${tag}: ชำรุดต้องมีแท็ก fix ในรายการ`)
    if (stop.status !== 'existing' && !(stop.pills ?? []).some(p => p.text && (p.tone === 'plan' || p.tone === 'fix'))) bad(`${tag}: ${stop.status} ต้องมีป้ายบนภาพ`)

    for (const prop of stop.props ?? []) {
      if (!PROP_KINDS.includes(prop.t)) bad(`${tag}: ชนิดสิ่งที่วาง ${prop.t} ไม่รู้จัก`)
      if (!inBox(prop.x, prop.y)) bad(`${tag}: ${prop.t} อยู่นอกกรอบ`)
      if (stop.status === 'planned' && prop.t === 'weir') bad(`${tag}: จุดแผนก่อสร้างห้ามวาดฝายเป็นของที่มีอยู่`)
    }
    for (const tree of stop.trees ?? []) if (!inBox(tree[0], tree[1])) bad(`${tag}: ต้นไม้อยู่นอกกรอบ`)
    for (const pill of stop.pills ?? []) {
      if (!inBox(pill.x, pill.y)) bad(`${tag}: ป้ายอยู่นอกกรอบ`)
      if (pill.slot) markSlot(pill.slot, `${tag} ป้าย`)
      else if (!pill.text || !Object.hasOwn(CHIP_TONES, pill.tone)) bad(`${tag}: ป้ายคงที่ต้องมี text และ tone ที่รู้จัก`)
    }
    for (const slot of stop.live ?? []) markSlot(slot, `${tag} รายการ`)
  }

  for (const c of route.clouds ?? []) if (!inBox(c[0], c[1])) bad('เมฆอยู่นอกกรอบ')
  for (const [i, d] of (route.deco ?? []).entries()) {
    const { x, y, rx, ry } = d.island ?? {}
    if (!finite(x, y, rx, ry)) { bad(`เกาะตกแต่ง ${i + 1}: ต้องมี x y rx ry`); continue }
    if (x - rx < 0 || x + rx > w) bad(`เกาะตกแต่ง ${i + 1}: ล้นกรอบด้านข้าง`)
    islands.push({ id: `เกาะตกแต่ง ${i + 1}`, ...d.island })
    for (const tree of d.trees ?? []) if (!inBox(tree[0], tree[1])) bad(`เกาะตกแต่ง ${i + 1}: ต้นไม้อยู่นอกกรอบ`)
  }

  // เกาะต้องไม่ทับกัน (ประมาณด้วยวงรีรวมความหนา)
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      const a = islands[i]
      const b = islands[j]
      const nx = (a.x - b.x) / (a.rx + b.rx)
      const ny = (a.y - b.y) / (a.ry + b.ry + ISLAND_THICKNESS)
      if (nx * nx + ny * ny < 1) bad(`${a.id} ทับกับ ${b.id}`)
    }
  }

  // แม่น้ำ
  const river = route.river ?? {}
  if (!finite(river.top) || river.top <= 0 || river.top + 60 > h) bad('river.top ต้องอยู่ในกรอบและเหลือที่ให้ผืนน้ำ')
  // slot ค่าสดของแม่น้ำใส่หรือไม่ใส่ก็ได้ (แม่น้ำปลายทางของบางตำบลไม่มีสถานีวัด) แต่ถ้าใส่ต้องอยู่ใน binds
  if (!river.name) bad('แม่น้ำต้องมี name')
  if (river.slot) markSlot(river.slot, 'แม่น้ำ')
  for (const slot of river.live ?? []) markSlot(slot, 'รายการแม่น้ำ')

  // ลำน้ำ
  const byNumber = new Map(route.stops.map(s => [s.n, s]))
  const ids = new Set()
  for (const st of route.streams ?? []) {
    if (ids.has(st.id)) bad(`ลำน้ำ ${st.id} id ซ้ำ`)
    ids.add(st.id)
    if (!Array.isArray(st.pts) || st.pts.length < 2 || !st.pts.every(p => inBox(p[0], p[1]))) bad(`ลำน้ำ ${st.id}: จุดต้องมี ≥ 2 และอยู่ในกรอบ`)
    for (const n of st.touches ?? []) if (!byNumber.has(n)) bad(`ลำน้ำ ${st.id}: touches อ้างจุด ${n} ที่ไม่มี`)
    if (st.flow) {
      // ห้ามวิ่งผ่านจุดที่ผังระบุว่าแผนก่อสร้าง/ชำรุด (น้ำยังไม่ไหลที่นั่น)
      for (const n of st.touches ?? []) {
        const s = byNumber.get(n)
        if (s && s.status !== 'existing') bad(`ลำน้ำ ${st.id}: วิ่งผ่านจุด ${n} ที่เป็น ${s.status}`)
      }
      if (!(st.touches?.length > 0)) bad(`ลำน้ำ ${st.id}: เส้นวิ่งต้องระบุ touches (ผังวาดลูกศรที่จุดไหน)`)
    }
    if (st.river) {
      const last = st.pts[st.pts.length - 1]
      if (Math.abs(last[1] - (river.top + 17)) > 4) bad(`ลำน้ำ ${st.id}: ต้องไหลลงขอบตลิ่งที่ y ≈ ${river.top + 17}`)
    }
  }

  // ทุกช่องค่าสดใน binds ต้องถูกใช้ (ไม่มีค่าที่ผูกไว้แต่ไม่ขึ้นหน้า)
  for (const slot of Object.keys(binds)) if (!usedSlots.has(slot)) bad(`ช่องค่าสด ${slot} ผูกไว้แต่ไม่ขึ้นในแผนภาพ/รายการ`)
  return issues
}
