// ผังน้ำเคลื่อนไหว — ตรรกะ + ความสอดคล้องของข้อมูลผัง + ข้อความบังคับ (src/lib/waterDiagram/*, WaterDiagram.jsx/css)
// จุดที่ต้องไม่พลาด: (1) โครงสร้างที่ผังระบุชำรุด/แผนก่อสร้าง/ไม่ระบุทิศ ห้ามวิ่ง (2) ค่าว่าง/ค้างห้ามกลายเป็นตัวเลขหรือ "ปกติ"
// (3) ชื่อห้วยที่ยังไม่ยืนยันกับ อบต. ห้ามโผล่ (4) คำกำกับว่าไม่ใช่น้ำไหลจริงห้ามหาย (5) รายการสายน้ำกับผังต้องอ้างของที่มีจริง
// รันด้วย: node tests/water-diagram.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SMALL_RESERVOIRS } from '../src/lib/smallReservoirs.js'
import {
  DIAGRAM_PREVIEW_SCOPES, DIAGRAM_STATUSES, EDGE_STYLES, WATER_DIAGRAM_TENANTS, chipWidth, diagramTenant, isAnimated, isShimmer, liveBadges,
  resolveDiagram,
} from '../src/lib/waterDiagram/model.js'
import { DIAGRAMS, diagramById } from '../src/lib/waterDiagram/diagrams.js'
import { THUNGKAEW_BINDS } from '../src/lib/waterDiagram/thungkaew.js'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ── ทะเบียน อปท. และการเลือกผัง ──
{
  assert.deepEqual(Object.keys(WATER_DIAGRAM_TENANTS).sort(), ['demo', 'tamnaktham', 'thungkaew'])
  assert.deepEqual(Object.keys(DIAGRAMS).sort(), ['tamnaktham', 'thungkaew'])
  assert.equal(diagramTenant('thungkaew').scope, '')
  assert.equal(diagramTenant('tamnaktham').scope, '')
  assert.equal(diagramTenant('demo').scope, 'ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต', 'demo ต้องบอกว่าเป็นข้อมูลของทุ่งแค้ว')
  for (const other of ['namlao', '', undefined, null, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(diagramTenant(other), null, `${other} ต้องไม่เห็นผัง`)
    assert.equal(resolveDiagram(other, 'thungkaew'), null, `${other} ต้องไม่เห็นผังแม้ใส่ ?diagram=`)
  }
  // ทุก อปท. ในทะเบียนชี้ผังที่มีจริง · แต่ละ อปท. ได้ผังของตัวเอง
  for (const [slug, tenant] of Object.entries(WATER_DIAGRAM_TENANTS)) assert.ok(diagramById(tenant.diagram), `${slug}: ผัง ${tenant.diagram} ไม่มี`)
  assert.equal(resolveDiagram('thungkaew').diagram, 'thungkaew')
  assert.equal(resolveDiagram('tamnaktham').diagram, 'tamnaktham')
  assert.equal(resolveDiagram('demo').diagram, 'thungkaew', 'demo ค่าเริ่มต้น = ผังทุ่งแค้ว')

  // ดูผังอื่นด้วย ?diagram= ได้เฉพาะ demo — อปท. จริงต้องไม่ถูกเปลี่ยนผังด้วย URL
  assert.deepEqual(resolveDiagram('demo', 'tamnaktham'), { diagram: 'tamnaktham', scope: 'ข้อมูลจริงของตำหนักธรรม ใช้สาธิต' })
  assert.equal(resolveDiagram('demo', 'thungkaew').scope, 'ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต')
  assert.equal(resolveDiagram('thungkaew', 'tamnaktham').diagram, 'thungkaew', 'อปท. จริงเมินพารามิเตอร์ ?diagram=')
  assert.equal(resolveDiagram('tamnaktham', 'thungkaew').diagram, 'tamnaktham')
  for (const bad of ['namlao', 'nope', '', null, undefined, '__proto__', 'constructor', 'toString']) {
    assert.equal(resolveDiagram('demo', bad).diagram, 'thungkaew', `demo + ?diagram=${bad} ต้องกลับไปผังเริ่มต้น`)
  }
  // ผังที่ดูตัวอย่างได้ต้องมีป้ายบอกว่าข้อมูลของ อปท. ไหนครบทุกผัง
  assert.deepEqual(Object.keys(DIAGRAM_PREVIEW_SCOPES).sort(), Object.keys(DIAGRAMS).sort())
  for (const scope of Object.values(DIAGRAM_PREVIEW_SCOPES)) assert.match(scope, /^ข้อมูลจริงของ.+ ใช้สาธิต$/)

  // อ่างเล็กที่ผังใช้ต้องอยู่ใน อปท. กลุ่มเดียวกับการ์ด PR1 (ไม่งั้นผังแสดงค่าอ่างที่การ์ดด้านบนไม่แสดง)
  const smallTenants = read('src/lib/smallReservoirs.js').match(/SMALL_RESERVOIR_TENANTS = \{[\s\S]*?\n\}/)[0]
  for (const [slug, tenant] of Object.entries(WATER_DIAGRAM_TENANTS)) {
    if (diagramById(tenant.diagram).smallReservoirs.length > 0) assert.ok(smallTenants.includes(`${slug}:`), `${slug} ต้องอยู่ใน SMALL_RESERVOIR_TENANTS ด้วย (ผังมีอ่างเล็ก)`)
  }
}

// ── สไตล์เส้น: ระยะเลื่อนต่อรอบต้องเท่าความยาวลาย ไม่งั้นวนแล้วกระตุก ──
{
  for (const [cls, style] of Object.entries(EDGE_STYLES)) {
    if (!style.dash) continue
    const sum = style.dash.split(/\s+/).map(Number).reduce((a, b) => a + b, 0)
    assert.equal(style.period, sum, `${cls}: period ${style.period} ≠ ผลรวมลาย ${sum}`)
    assert.ok(style.dur > 0)
  }
}

// ── กฎการวิ่ง (ตรรกะล้วน) ──
{
  const edge = (cls, status = 'existing') => ({ kind: 'edge', cls, status })
  for (const cls of ['main', 'big', 'branch', 'river']) {
    assert.equal(isAnimated(edge(cls)), true, `${cls} ที่มีตามผังต้องวิ่ง`)
    for (const status of ['repair', 'planned', 'unknown']) assert.equal(isAnimated(edge(cls, status)), false, `${cls} สถานะ ${status} ห้ามวิ่ง`)
  }
  assert.equal(isAnimated({ kind: 'edge', cls: 'main' }), true, 'ไม่ระบุ status = existing')
  for (const cls of ['minor', 'canal', 'plan']) assert.equal(isAnimated(edge(cls)), false, `${cls} ไม่วิ่ง (ลูกศรนิ่ง/ระยิบ/เส้นประแดง)`)
  assert.equal(isShimmer(edge('canal')), true)
  assert.equal(isShimmer(edge('canal', 'unknown')), false)
  assert.equal(isShimmer(edge('main')), false)
  for (const notEdge of [null, undefined, {}, { kind: 'weir' }, { kind: 'repair', status: 'repair' }]) assert.equal(isAnimated(notEdge), false)
}

// ── ข้อมูลผังแต่ละตำบล ──
// ความคาดหวังต่อผัง: นับของสำคัญตามผังต้นฉบับ — ข้อมูลหายไปครึ่งหนึ่งต้องไม่ผ่านเงียบๆ
const EXPECT = {
  thungkaew: {
    min: { edge: 50, weir: 25, text: 55 },
    count: { reservoir: 3, pond: 3, supply: 2, repair: 2, pump: 2, gate: 1, slot: 4 },
    animated: [15, 30],
    small: ['50', '30'],
    stations: [['thungkaew', 'rain', 'RES038'], ['thungkaew', 'waterlevel', 'YOM003']],
    unconfirmed: ['ห้วยจำค่า', 'ห้วยย่าเฟย'], // ชื่อห้วย 4 เส้นกลางผังที่ยังไม่มีใครยืนยัน (ป้ายผังเขียนตะแคง)
    mustSay: 'ห้วย 4 เส้น',
  },
  tamnaktham: {
    min: { edge: 8, weir: 10, text: 25 },
    count: { reservoir: 0, pond: 0, supply: 1, pump: 3, gate: 3, bridge: 3, outline: 3, slot: 1 },
    animated: [3, 3], // น้ำแม่คำมี + คลองชลประทาน + แม่น้ำยม (ลูกศรทิศเดียวในผัง) — ลำห้วยสาขาลูกศรนิ่ง
    small: [],
    stations: [['tamnaktham', 'waterlevel', 'Y.38']],
    unconfirmed: [],
    mustSay: null,
  },
}
const KINDS = new Set(['frame', 'outline', 'text', 'edge', 'weir', 'bridge', 'reservoir', 'pond', 'gate', 'supply', 'pump', 'house', 'school', 'repair', 'planBox', 'chip', 'slot', 'catch'])
// edge/outline ใช้เฉพาะคำสั่งสัมบูรณ์ M / L / H / V / Z
function pathPoints(d) {
  const tokens = d.trim().replace(/([MLHVZ])/g, ' $1 ').trim().split(/[\s,]+/)
  const points = []
  let last = [0, 0]
  for (let i = 0; i < tokens.length;) {
    const cmd = tokens[i]
    assert.ok(/^[MLHVZ]$/.test(cmd), `path "${d}": อ่านคำสั่งไม่ได้ที่ "${cmd}"`)
    i += 1
    if (cmd === 'Z') continue
    if (cmd === 'H') last = [Number(tokens[i++]), last[1]]
    else if (cmd === 'V') last = [last[0], Number(tokens[i++])]
    else last = [Number(tokens[i++]), Number(tokens[i++])]
    points.push(last)
  }
  return points
}

for (const [diagramId, diagram] of Object.entries(DIAGRAMS)) {
  const expect = EXPECT[diagramId]
  assert.ok(expect, `ผัง ${diagramId} ยังไม่มีความคาดหวังใน EXPECT — เพิ่มตัวเลขตามผังต้นฉบับ`)
  const { elements, viewBox, binds, lanes } = diagram
  const at = text => `[${diagramId}] ${text}`
  const inBox = (x, y, label) => {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), at(`${label}: พิกัดไม่ใช่ตัวเลข`))
    assert.ok(x >= 0 && x <= viewBox.w && y >= 0 && y <= viewBox.h, at(`${label}: (${x}, ${y}) อยู่นอกกรอบ ${viewBox.w}×${viewBox.h}`))
  }

  // ฟิลด์ที่หน้าเว็บใช้แสดงที่มา — ขาดแล้วหน้าจะแสดงค่าว่างหรือพัง
  for (const field of ['id', 'title', 'sourceTitle', 'sourceDate', 'drawnLabel', 'sourceUrl', 'ariaSummary']) assert.ok(diagram[field], at(`ขาดฟิลด์ ${field}`))
  assert.equal(diagram.id, diagramId)
  assert.deepEqual(diagram.viewBox, { w: 2000, h: 1125 }, at('ระบบพิกัดต้องตรงกับภาพต้นฉบับ'))
  assert.match(diagram.sourceDate, /ไฟล์ลงวันที่ .+ 2567/, at('ต้องบอกอายุของผังต้นฉบับ'))
  assert.ok(Array.isArray(diagram.omitted), at('omitted ต้องเป็นอาร์เรย์ (ว่างได้)'))
  assert.deepEqual(diagram.smallReservoirs, expect.small, at('อ่างเล็กที่ผังแสดงค่าสด'))
  assert.ok(diagram.smallReservoirs.length <= 2, at('หน้าจอเรียก useReservoirReport ตายตัว 2 ช่อง — ผังมีอ่างเล็กได้ไม่เกิน 2'))

  // id ไม่ซ้ำ · ชนิดรู้จัก · พิกัดอยู่ในกรอบ
  const ids = elements.filter(el => el.id).map(el => el.id)
  assert.equal(new Set(ids).size, ids.length, at(`id ซ้ำ: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`))
  elements.forEach((el, index) => {
    assert.ok(KINDS.has(el.kind), at(`element #${index}: ชนิด ${el.kind} ไม่รู้จัก`))
    const label = `${el.kind}${el.id ? `#${el.id}` : ` [${index}]`}`
    if (el.kind === 'edge') {
      assert.ok(EDGE_STYLES[el.cls], at(`${label}: cls ${el.cls} ไม่รู้จัก`))
      assert.ok(DIAGRAM_STATUSES.includes(el.status), at(`${label}: status ${el.status}`))
      for (const [x, y] of pathPoints(el.d)) inBox(x, y, label)
    } else if (el.kind === 'outline') {
      assert.ok(['tambon', 'village'].includes(el.cls), at(`${label}: cls ${el.cls}`))
      for (const [x, y] of pathPoints(el.d)) inBox(x, y, label)
    } else if (el.x !== undefined) {
      inBox(el.x, el.y, label)
      if (el.w !== undefined && el.h !== undefined && el.kind !== 'weir') inBox(el.x + el.w, el.y + el.h, `${label} (มุมล่างขวา)`)
    }
    if (el.kind === 'weir' && el.status !== undefined) assert.ok(DIAGRAM_STATUSES.includes(el.status), at(`${label}: status ${el.status}`))
  })
  const count = kind => elements.filter(el => el.kind === kind).length
  for (const [kind, n] of Object.entries(expect.min)) assert.ok(count(kind) >= n, at(`${kind} ${count(kind)} < ${n}`))
  for (const [kind, n] of Object.entries(expect.count)) assert.equal(count(kind), n, at(`${kind} ต้องมี ${n}`))

  // กับข้อมูลจริง: ของที่ผังระบุชำรุด/แผนก่อสร้าง/ไม่ระบุทิศ ไม่มีเส้นวิ่งเลย
  for (const el of elements) {
    if (['repair', 'planned', 'unknown'].includes(el.status)) assert.equal(isAnimated(el), false, at(`${el.id ?? el.kind}: ${el.status} ห้ามวิ่ง`))
    if (el.kind === 'pump' || el.kind === 'planBox') assert.equal(el.status, 'planned', at(`${el.id}: ต้องเป็นแผนก่อสร้าง`))
    if (el.kind === 'repair') assert.equal(el.status, 'repair')
    if (el.kind === 'edge' && el.cls === 'plan') assert.equal(el.status, 'planned', at(`${el.id}: เส้นแดงต้องเป็นแผนก่อสร้าง`))
  }
  const animated = elements.filter(isAnimated)
  assert.ok(animated.length >= expect.animated[0] && animated.length <= expect.animated[1],
    at(`เส้นวิ่ง ${animated.length} เส้น — นอกช่วง ${expect.animated.join('–')} (มือถือรุ่นเก่าหน่วง/ข้อมูลหาย)`))

  // ช่องค่าสด · สายน้ำ · แหล่งค่า
  const slots = elements.filter(el => el.kind === 'slot').map(el => el.id).sort()
  assert.deepEqual(slots, Object.keys(binds).sort(), at('ช่องบนผังกับ bind ต้องตรงกัน'))
  for (const [slot, bind] of Object.entries(binds)) {
    if (bind.type === 'small-dam') {
      assert.ok(Object.hasOwn(SMALL_RESERVOIRS, bind.id), at(`${slot}: อ่าง ${bind.id} ไม่อยู่ใน SMALL_RESERVOIRS`))
      assert.ok(diagram.smallReservoirs.includes(bind.id), at(`${slot}: อ่าง ${bind.id} ต้องอยู่ใน smallReservoirs ของผัง ไม่งั้นหน้าไม่ดึงรายงาน`))
    } else assert.ok(bind.code, at(`${slot}: ต้องมีรหัสสถานี`))
  }
  for (const id of diagram.smallReservoirs) assert.ok(Object.values(binds).some(b => b.type === 'small-dam' && b.id === id), at(`อ่าง ${id} อยู่ใน smallReservoirs แต่ไม่มีช่องผูก`))
  // รหัสสถานีต้องตรงกับที่ seed ให้ อปท. นั้นจริง (ไม่งั้นป้ายขึ้น "ไม่มีค่าในระบบ" ตลอดโดยไม่มีใครรู้)
  const seed = read('supabase/migrations/20260918160000_water_situation_seed_tenants.sql')
  for (const [slug, type, code] of expect.stations) assert.ok(seed.includes(`('${slug}', '${type}', '${code}'`), at(`${slug} ต้องมีสถานี ${type} ${code} ใน seed`))
  for (const bind of Object.values(binds).filter(b => b.code)) {
    assert.ok(expect.stations.some(([, , code]) => code === bind.code), at(`bind ${bind.code} ไม่อยู่ในรายการสถานีที่ตรวจกับ seed ใน EXPECT`))
  }

  const idSet = new Set(ids)
  const laneIds = lanes.map(lane => lane.id)
  assert.equal(new Set(laneIds).size, laneIds.length, at('lane id ซ้ำ'))
  for (const lane of lanes) {
    assert.ok(lane.title && lane.items.length > 0, at(`${lane.id}: ต้องมีชื่อและรายการ`))
    lane.items.forEach(item => {
      assert.ok(item.name, at(`${lane.id}: รายการไม่มีชื่อ`))
      for (const ref of item.refs ?? []) assert.ok(idSet.has(ref), at(`${lane.id} / ${item.name}: อ้าง ${ref} ที่ไม่มีบนผัง`))
      for (const slot of item.live ?? []) assert.ok(slots.includes(slot), at(`${lane.id} / ${item.name}: ช่องค่าสด ${slot} ไม่มี`))
      for (const tag of item.tags ?? []) assert.ok(['na', 'plan', 'fix'].includes(tag.k), at(`${item.name}: ชนิดแท็ก ${tag.k}`))
      // รายการที่อ้างของแผนก่อสร้าง/ชำรุด ต้องบอกสถานะเดียวกับบนผัง (ไม่ให้รายการเขียนเหมือนใช้งานได้ปกติ)
      const states = new Set((item.refs ?? []).map(ref => elements.find(el => el.id === ref)?.status).filter(s => s && s !== 'existing'))
      for (const state of states) assert.equal(item.status, state, at(`${item.name}: ผังระบุ ${state} แต่รายการไม่บอก`))
      // และกลับกัน: รายการที่บอกว่าแผนก่อสร้าง/ชำรุด ต้องมีป้ายแท็กบอกตรงๆ ไม่ใช่แค่สีจุด
      if (item.status === 'planned') assert.ok((item.tags ?? []).some(tag => tag.k === 'plan'), at(`${item.name}: แผนก่อสร้างต้องมีแท็ก`))
      if (item.status === 'repair') assert.ok((item.tags ?? []).some(tag => tag.k === 'fix'), at(`${item.name}: ชำรุดต้องมีแท็ก`))
    })
  }
  // ทุกค่าสดต้องไปโผล่ในรายการสายน้ำด้วย (โหมดข้อความต้องไม่ขาดข้อมูลเทียบกับผังภาพ)
  const liveInLanes = new Set(lanes.flatMap(lane => lane.items.flatMap(item => item.live ?? [])))
  assert.deepEqual([...liveInLanes].sort(), slots, at('ค่าสดบนผังทุกช่องต้องอยู่ในรายการสายน้ำ'))
  // ทุกสิ่งที่ผังภาพมีและมี id ต้องอยู่ในรายการสายน้ำ (ผู้อ่านจอ/โหมดรายการเห็นครบเท่าผังภาพ)
  const referenced = new Set(lanes.flatMap(lane => lane.items.flatMap(item => item.refs ?? [])))
  const STRUCTURE = new Set(['reservoir', 'pond', 'gate', 'supply', 'pump', 'bridge', 'repair', 'planBox'])
  for (const el of elements.filter(el => STRUCTURE.has(el.kind) && el.id)) assert.ok(referenced.has(el.id), at(`${el.kind}#${el.id} มีบนผังแต่ไม่อยู่ในรายการสายน้ำ`))

  // ชื่อที่ยังไม่ยืนยันกับ อบต. ต้องไม่โผล่ (ห้ามเดาชื่อ)
  const allText = [
    ...elements.filter(el => el.kind === 'text' || el.kind === 'chip').map(el => el.t),
    ...lanes.flatMap(lane => [lane.title, ...lane.items.flatMap(item => [item.name, item.sub ?? '', ...(item.tags ?? []).map(tag => tag.t)])]),
  ]
  for (const name of expect.unconfirmed) assert.ok(!allText.some(text => text.includes(name)), at(`"${name}" ยังไม่ยืนยันกับ อบต. ห้ามขึ้นหน้า`))
  if (diagramId === 'thungkaew') assert.ok(!allText.includes('ห้วยจำ'), 'ป้าย "ห้วยจำ" (เส้นที่ 4) ยังไม่ยืนยัน')
  if (expect.mustSay) {
    assert.ok(allText.some(text => text.includes(expect.mustSay)), at(`ต้องบอกว่า "${expect.mustSay}"`))
    assert.ok(diagram.omitted.some(text => text.includes('ไม่ขอเดาชื่อ')), at('ของที่ไม่ใส่ชื่อเพราะอ่านไม่ชัด ต้องบอกในกล่องที่มา (omitted)'))
  }
  // ของที่วาดต่างจากต้นฉบับต้องบอกเหตุผลในกล่องที่มา: เขตหมู่บ้านที่เปลี่ยนสีเป็นเทา
  if (elements.some(el => el.kind === 'outline' && el.cls === 'village')) {
    assert.ok(diagram.omitted.some(text => text.includes('เขตหมู่บ้าน') && text.includes('เทา')), at('เขตหมู่บ้านวาดเป็นสีเทา ต้องบอกเหตุผลใน omitted'))
  }
}

// ── ผังเฉพาะตัว ──
{
  const thungkaew = DIAGRAMS.thungkaew
  const canal = thungkaew.elements.find(el => el.id === 'canal-right')
  assert.equal(canal.cls, 'canal', 'คลองสองทิศ ไม่ระบุทิศ ต้องไม่วิ่ง')
  assert.equal(isAnimated(canal), false)
  // เส้นแรกของห้วย 4 เส้นถูกตัดที่รางส่งน้ำชำรุด: ช่วงที่ชำรุดต้องไม่มีเส้นวิ่งผ่าน
  const repair = thungkaew.elements.find(el => el.id === 'repair-canal')
  for (const el of thungkaew.elements.filter(isAnimated).filter(e => e.id?.startsWith('creek4-a'))) {
    for (const [x, y] of pathPoints(el.d)) assert.ok(!(x >= repair.x && x <= repair.x + repair.w && y > repair.y && y < repair.y + repair.h), `${el.id}: เส้นวิ่งผ่านกลางรางส่งน้ำชำรุด`)
  }
  // ตำหนักธรรม: ฝาย/สถานีสูบแผนก่อสร้างต้องเป็นสีแดงเท่าที่ผังต้นฉบับระบุ (ไม่เพิ่มเอง ไม่ตัดออก)
  const tamnaktham = DIAGRAMS.tamnaktham
  assert.deepEqual(tamnaktham.elements.filter(el => el.kind === 'weir' && el.status === 'planned').map(el => el.id).sort(), ['weir-1', 'weir-12'])
  assert.deepEqual(tamnaktham.elements.filter(el => el.kind === 'pump').map(el => el.id).sort(), ['pump-1', 'pump-2', 'pump-3'])
  // น้ำแม่คำมีกับคลองชลประทานตัดกัน ผังไม่ระบุว่าเชื่อมกัน → ต้องบอกในรายการ ไม่เขียนเหมือนน้ำถ่ายเข้าคลอง
  const crossing = tamnaktham.lanes.flatMap(lane => lane.items).filter(item => item.name.includes('ตัดผ่าน'))
  assert.ok(crossing.length >= 2, 'ทั้งสายน้ำแม่คำมีและสายคลองต้องพูดถึงจุดตัดกัน')
  for (const item of crossing) assert.ok(item.sub?.includes('ไม่ระบุว่า'), `${item.name}: ต้องบอกว่าผังไม่ระบุว่าคลองรับน้ำจากน้ำแม่คำมี`)
}

// ── ป้ายค่าสด ──
{
  const now = Date.parse('2026-10-14T05:00:00Z') // 14 ต.ค. 2569 12:00 เวลาไทย
  const ago = hours => new Date(now - hours * 3_600_000).toISOString()
  const report = (days, pcts) => ({
    id: '50', name: 'อ่างเก็บน้ำห้วยยอย', capacity: 0.3,
    rows: pcts.map((pct, i) => ({ d: new Date(now + 7 * 3_600_000 - (days + i * 7) * 86_400_000).toISOString().slice(0, 10), pct, vol: pct * 0.003 })),
  })
  const entry = (rep, extra = {}) => ({ report: rep, failed: false, done: true, ...extra })
  const stationOf = (type, code, extra) => ({ station_type: type, station_code: code, station_name: 'หนองม่วงไข่', distance_km: 4.8, recorded_at: ago(0.5), ...extra })
  const binds = THUNGKAEW_BINDS
  const badges = (reports, stations) => liveBadges({ binds, reports, stations, now })
  const TONES = new Set(['ok', 'warn', 'stale', 'na'])

  // อ่างเล็ก
  let b = badges({ 50: entry(report(2, [73.2, 71.5, 70])), 30: entry(report(2, [76.79, 75, 74])) }, [])
  assert.deepEqual([b['dam-50'].tone, b['dam-50'].text], ['ok', 'อ่าง 73.2%'])
  assert.equal(b['dam-30'].text, 'อ่าง 76.8%')
  assert.ok(b['dam-50'].detail.startsWith('73.2% · รายงาน '), b['dam-50'].detail)
  b = badges({ 50: entry(report(30, [73.2, 71.5])), 30: entry(report(2, [76.79, 75])) }, [])
  assert.equal(b['dam-50'].tone, 'stale', 'รายงานเก่ากว่า 14 วัน = ค้าง')
  assert.ok(b['dam-50'].text.includes('ไม่มีรายงานใหม่') && b['dam-50'].detail.includes('ไม่มีรายงานใหม่ตั้งแต่'))
  b = badges({ 50: entry(report(2, [73.2, 73.2, 73.2, 73.2])), 30: entry(report(2, [70, 71])) }, [])
  assert.equal(b['dam-50'].tone, 'warn', 'ตัวเลขซ้ำเดิมตั้งแต่ 3 รายงาน')
  assert.ok(b['dam-50'].text.includes('ตัวเลขซ้ำเดิม'))
  b = badges({ 50: entry(report(2, [73.2, 70]), { failed: true }), 30: undefined }, [])
  assert.ok(b['dam-50'].detail.includes('ดึงข้อมูลใหม่ไม่สำเร็จ แสดงของเดิม'), 'ดึงใหม่ล้มแต่มีของเดิม ต้องบอก')
  assert.equal(b['dam-50'].tone, 'ok')
  assert.equal(b['dam-30'].tone, 'na', 'ยังไม่มีรายการของอ่างนี้ = ไม่มีค่า')
  b = badges({ 50: { report: null, failed: true, done: true }, 30: { report: null, failed: false, done: false } }, [])
  assert.deepEqual([b['dam-50'].tone, b['dam-50'].text], ['na', 'ยังโหลดค่าไม่ได้'], 'Worker ล่ม ไม่เคยมีของเดิม')
  assert.equal(b['dam-30'].text, 'กำลังโหลด')
  b = badges({ 50: entry({ id: '50', rows: [{ d: '2026-10-06', pct: null, vol: 1 }] }), 30: entry({ id: '30', rows: [] }) }, [])
  assert.equal(b['dam-50'].tone, 'na', '% ว่างต้องไม่กลายเป็น 0%')
  assert.ok(!b['dam-50'].text.includes('0%'))
  assert.equal(b['dam-30'].tone, 'na')

  // ฝน
  b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: 12.5 })])
  assert.deepEqual([b['rain-RES038'].tone, b['rain-RES038'].text], ['ok', 'ฝน 12.5 มม.'])
  assert.ok(b['rain-RES038'].detail.includes('ฝนปานกลาง'), 'ใช้ป้ายฝนเดิมของ rainLevel')
  b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: 0 })])
  assert.equal(b['rain-RES038'].text, 'ฝน 0 มม.', 'ฝน 0 มม. ที่วัดได้จริงต้องแสดงเป็น 0')
  b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: 12.5, recorded_at: ago(3.1) })])
  assert.equal(b['rain-RES038'].tone, 'stale', 'ค้างเกิน 3 ชม. ตามเกณฑ์เดิม')
  assert.ok(!b['rain-RES038'].text.includes('12.5'), 'ค่าที่ค้างห้ามโชว์เป็นค่าปัจจุบัน')
  b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: 12.5, recorded_at: ago(2.9) })])
  assert.equal(b['rain-RES038'].tone, 'ok')
  for (const empty of [null, undefined, '']) {
    b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: empty })])
    assert.equal(b['rain-RES038'].tone, 'na', `rain ว่าง (${empty}) ต้องไม่กลายเป็น 0`)
    assert.equal(b['rain-RES038'].text, 'ไม่มีค่าในระบบ')
  }
  b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: 5, recorded_at: null })])
  assert.equal(b['rain-RES038'].tone, 'na', 'ไม่มีเวลาวัด = ไม่เชื่อค่า')
  b = badges({}, [stationOf('waterlevel', 'RES038', { rain_24h_mm: 5 })])
  assert.equal(b['rain-RES038'].tone, 'na', 'รหัสเดียวกันคนละชนิดต้องไม่ปนกัน')

  // ระดับน้ำ: ข้อเท็จจริงของสถานี + ระยะ ไม่ลงสี ไม่ "ปกติ"
  b = badges({}, [stationOf('waterlevel', 'YOM003', { bank_diff_m: 4.55 })])
  assert.deepEqual([b['level-YOM003'].tone, b['level-YOM003'].text], ['ok', 'หนองม่วงไข่ ห่าง 4.8 กม. · ต่ำกว่าตลิ่ง 4.55 ม.'])
  for (const diff of [4.55, 0.5, 0, -0.3]) {
    b = badges({}, [stationOf('waterlevel', 'YOM003', { bank_diff_m: diff })])
    assert.equal(b['level-YOM003'].tone, 'ok', 'ระดับน้ำไม่ลงโทนสถานการณ์ (ไม่มีเกณฑ์ที่หน้าผัง)')
    assert.ok(!/ปกติ|ปลอดภัย|เฝ้าระวัง|วิกฤติ/.test(b['level-YOM003'].text + b['level-YOM003'].detail), `ห้ามตีความสถานการณ์ (diff ${diff})`)
  }
  assert.ok(badges({}, [stationOf('waterlevel', 'YOM003', { bank_diff_m: 0 })])['level-YOM003'].text.includes('เสมอตลิ่ง'))
  b = badges({}, [stationOf('waterlevel', 'YOM003', { bank_diff_m: 4.55, recorded_at: ago(4) })])
  assert.equal(b['level-YOM003'].tone, 'stale')
  assert.ok(!b['level-YOM003'].text.includes('ตลิ่ง'), 'ค่าที่ค้างห้ามโชว์')
  for (const empty of [null, undefined, '']) {
    b = badges({}, [stationOf('waterlevel', 'YOM003', { bank_diff_m: empty })])
    assert.equal(b['level-YOM003'].tone, 'na', `bank_diff_m ว่าง (${empty}) ห้ามกลายเป็น 0 = เสมอตลิ่ง`)
  }
  b = badges({}, [stationOf('waterlevel', 'YOM003', { bank_diff_m: 4.55, distance_km: null })])
  assert.equal(b['level-YOM003'].text, 'หนองม่วงไข่ · ต่ำกว่าตลิ่ง 4.55 ม.', 'ไม่มีระยะ = ไม่เขียนระยะ (ไม่เดา)')

  // ไม่มีสถานี/ข้อมูลผิดรูป
  for (const stations of [[], null, undefined, 'x', [null], [{}]]) {
    b = liveBadges({ binds, reports: {}, stations, now })
    assert.equal(b['rain-RES038'].text, 'ไม่มีค่าในระบบ')
    assert.equal(b['level-YOM003'].text, 'ไม่มีค่าในระบบ')
  }
  assert.deepEqual(liveBadges({ binds: { x: { type: 'unknown' } }, now }), { x: { tone: 'na', text: 'ไม่มีค่าในระบบ', detail: 'ไม่มีค่าในระบบ' } })
  assert.deepEqual(liveBadges({ now }), {})
  for (const badge of Object.values(badges({ 50: entry(report(2, [70, 69])) }, [stationOf('rain', 'RES038', { rain_24h_mm: 1 })]))) {
    assert.ok(TONES.has(badge.tone) && badge.text && badge.detail)
  }
}

// ── ความกว้างป้าย ──
{
  assert.equal(chipWidth('', 19), 22)
  assert.ok(chipWidth('อ่าง 73.2%', 19) > chipWidth('อ่าง', 19))
  // สระบน/วรรณยุกต์ไทยไม่กินที่ — "ที่" กว้างเท่า "ท"
  assert.equal(chipWidth('ที่', 19), chipWidth('ท', 19), 'สระ+วรรณยุกต์ไม่เพิ่มความกว้าง')
  assert.equal(chipWidth('กี่', 20), chipWidth('ก', 20), 'สระบน+วรรณยุกต์ไม่กินที่')
  assert.ok(chipWidth('หนองม่วงไข่ ห่าง 4.8 กม. · ต่ำกว่าตลิ่ง 4.55 ม.', 15) < 450, 'ป้ายระดับน้ำต้องไม่ล้นไปชนวัตถุข้างเคียง')
}

// ── ข้อความบังคับ · CSS · การต่อเข้าหน้า ──
{
  const jsx = read('src/components/water/WaterDiagram.jsx')
  const css = read('src/components/water/WaterDiagram.css')
  const page = read('src/pages/WaterSituationPage.jsx')
  for (const required of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ดูผังต้นฉบับ', 'data-diagram-disclaimer', 'data-diagram-omitted', 'ที่ผังต้นฉบับมีแต่เราวาดต่างไป หรือไม่ได้วาด']) {
    assert.ok(jsx.includes(required), `WaterDiagram.jsx ต้องมี "${required}"`)
  }
  // ตรวจที่ import/การเรียกจริง ไม่ใช่คำในคอมเมนต์ — ผังไม่ผูกกับ Supabase/auth (NOTES §7)
  for (const [name, source] of [['WaterDiagram.jsx', jsx], ['model.js', read('src/lib/waterDiagram/model.js')], ['diagrams.js', read('src/lib/waterDiagram/diagrams.js')], ['builders.js', read('src/lib/waterDiagram/builders.js')], ['thungkaew.js', read('src/lib/waterDiagram/thungkaew.js')], ['tamnaktham.js', read('src/lib/waterDiagram/tamnaktham.js')]]) {
    assert.ok(!/from ['"][^'"]*supabase[^'"]*['"]/.test(source), `${name}: ห้าม import supabase`)
    assert.ok(!/\.rpc\(|supabase\.from\(/.test(source), `${name}: ห้ามเรียก RPC/ตาราง`)
    assert.ok(!/visibilitychange.*(supabase|auth)/i.test(source), `${name}: ห้ามผูก visibilitychange กับ auth`)
  }
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(jsx), 'ห้าม inject HTML')
  // ลดการเคลื่อนไหว: ปิดแอนิเมชันทุกตัวที่ผังใช้
  const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  for (const klass of ['.wd-flow', '.wd-shimmer', '.wd-bob']) assert.ok(reduce.includes(klass), `${klass} ต้องถูกปิดเมื่อลดการเคลื่อนไหว`)
  assert.match(reduce, /animation: none !important/)
  // หยุดเมื่อกดปุ่ม/นอกจอ ครอบทุกแอนิเมชัน
  for (const selector of ['.wd-root.wd-paused', '.wd-root[data-offscreen]']) {
    for (const klass of ['.wd-flow', '.wd-shimmer', '.wd-bob']) assert.ok(css.includes(`${selector} ${klass}`), `${selector} ${klass}`)
  }
  assert.ok(css.includes('var(--period'), 'keyframes ต้องใช้ระยะต่อรอบจากสไตล์เส้น')
  // ผังโหลดเฉพาะ อปท. ที่อยู่ในทะเบียน และใช้สถานีระดับ อปท. ไม่ตามโหมดแชร์ ?scope=
  assert.match(page, /const WaterDiagram = lazy\(\(\) => import\('\.\.\/components\/water\/WaterDiagram'\)\)/)
  assert.match(page, /diagramTenant\(tenant\?\.slug\) && \(/)
  assert.match(page, /<WaterDiagram [^>]*stations=\{scopedData\?\.stations \?\? \[\]\}/)
  assert.ok(!/<WaterDiagram [^>]*visibleData/.test(page), 'ผังต้องไม่ผูกกับ visibleData (โหมดแชร์)')
  // ?diagram= ส่งต่อให้คอมโพเนนต์ — ตัวตัดสินว่าใครใช้ได้อยู่ที่ resolveDiagram (เฉพาะ demo) ไม่ใช่หน้านี้
  assert.match(page, /previewId=\{searchParams\.get\('diagram'\)\}/)
  assert.match(jsx, /resolveDiagram\(slug, previewId\)/)
  assert.ok(!/THUNGKAEW/.test(jsx), 'WaterDiagram.jsx ต้องไม่ผูกกับผังทุ่งแค้วตายตัว (เลือกผังตามทะเบียน)')
  // hook ของอ่างเล็กใช้ร่วมกับการ์ด PR1 จากไฟล์เดียว ไม่ซ้ำ
  assert.match(read('src/components/water/SmallReservoirSection.jsx'), /import \{ useReservoirReport \} from '\.\/useReservoirReport'/)
  assert.match(jsx, /import \{ useReservoirReport \} from '\.\/useReservoirReport'/)
}

console.log('✅ water-diagram: ผ่านทุกข้อ')
