// ผังน้ำเคลื่อนไหว — ตรรกะ + ความสอดคล้องของข้อมูลผัง + ข้อความบังคับ (src/lib/waterDiagram/*, WaterDiagram.jsx/css)
// จุดที่ต้องไม่พลาด: (1) โครงสร้างที่ผังระบุชำรุด/แผนก่อสร้าง/ไม่ระบุทิศ ห้ามวิ่ง (2) ค่าว่าง/ค้างห้ามกลายเป็นตัวเลขหรือ "ปกติ"
// (3) ชื่อห้วยที่ยังไม่ยืนยันกับ อบต. ห้ามโผล่ (4) คำกำกับว่าไม่ใช่น้ำไหลจริงห้ามหาย (5) รายการสายน้ำกับผังต้องอ้างของที่มีจริง
// รันด้วย: node tests/water-diagram.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SMALL_RESERVOIRS } from '../src/lib/smallReservoirs.js'
import {
  CHIP_TONES, DIAGRAM_PREVIEW_SCOPES, DIAGRAM_STATUSES, EDGE_STYLES, WATER_DIAGRAM_TENANTS, chipWidth, diagramTenant, isAnimated, isShimmer, liveBadges,
  resolveDiagram,
} from '../src/lib/waterDiagram/model.js'
import {
  ISLAND_THICKNESS, PROP_KINDS, islandShape, labelPosition, pillFor, pillWidth, pinPosition, routeIssues, routeItems, routeKinds, smoothPath, wavePath,
} from '../src/lib/waterDiagram/route.js'
import { DIAGRAMS, diagramById } from '../src/lib/waterDiagram/diagrams.js'
import { THUNGKAEW_BINDS } from '../src/lib/waterDiagram/thungkaew.js'
import { NAMLAO_ROUTE } from '../src/lib/waterDiagram/routes/namlao.js'
import {
  POSTER_DISCLAIMER, POSTER_PRINT_SIZE, POSTER_THEMES, posterIcon, posterIssues, posterLiveRows, posterOmittedNames, posterPrintCss, posterStats,
} from '../src/lib/waterDiagram/poster.js'
import { GOV_PAGE_MARGIN_LANDSCAPE, govPageCss } from '../src/lib/govDocStyle.js'
import { LIST_SHEET_COLUMNS, LIST_SHEET_MM, balanceRanges, listColumns, listItemWeight } from '../src/lib/waterDiagram/listSheet.js'
import { ORIGINAL_DIAGRAM_FILES, ORIGINAL_FILE_BASE, originalDiagramUrl } from '../src/lib/waterDiagram/originalFiles.js'
import { SYSTEMS, thaiDate } from '../src/lib/waterSystem/model.js'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ── ทะเบียน อปท. และการเลือกผัง ──
{
  assert.deepEqual(Object.keys(WATER_DIAGRAM_TENANTS).sort(), ['demo', 'namlao', 'tamnaktham', 'thungkaew'])
  assert.deepEqual(Object.keys(DIAGRAMS).sort(), ['namlao', 'tamnaktham', 'thungkaew'])
  assert.equal(diagramTenant('thungkaew').scope, '')
  assert.equal(diagramTenant('tamnaktham').scope, '')
  assert.equal(diagramTenant('namlao').scope, '')
  assert.equal(diagramTenant('demo').scope, 'ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต', 'demo ต้องบอกว่าเป็นข้อมูลของทุ่งแค้ว')
  for (const other of ['cmu', '', undefined, null, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(diagramTenant(other), null, `${other} ต้องไม่เห็นผัง`)
    assert.equal(resolveDiagram(other, 'thungkaew'), null, `${other} ต้องไม่เห็นผังแม้ใส่ ?diagram=`)
  }
  // ทุก อปท. ในทะเบียนชี้ผังที่มีจริง · แต่ละ อปท. ได้ผังของตัวเอง
  for (const [slug, tenant] of Object.entries(WATER_DIAGRAM_TENANTS)) assert.ok(diagramById(tenant.diagram), `${slug}: ผัง ${tenant.diagram} ไม่มี`)
  assert.equal(resolveDiagram('thungkaew').diagram, 'thungkaew')
  assert.equal(resolveDiagram('tamnaktham').diagram, 'tamnaktham')
  assert.equal(resolveDiagram('namlao').diagram, 'namlao')
  assert.equal(resolveDiagram('demo').diagram, 'thungkaew', 'demo ค่าเริ่มต้น = ผังทุ่งแค้ว')

  // ดูผังอื่นด้วย ?diagram= ได้เฉพาะ demo — อปท. จริงต้องไม่ถูกเปลี่ยนผังด้วย URL
  assert.deepEqual(resolveDiagram('demo', 'tamnaktham'), { diagram: 'tamnaktham', scope: 'ข้อมูลจริงของตำหนักธรรม ใช้สาธิต' })
  assert.equal(resolveDiagram('demo', 'thungkaew').scope, 'ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต')
  assert.equal(resolveDiagram('thungkaew', 'tamnaktham').diagram, 'thungkaew', 'อปท. จริงเมินพารามิเตอร์ ?diagram=')
  assert.equal(resolveDiagram('tamnaktham', 'thungkaew').diagram, 'tamnaktham')
  assert.equal(resolveDiagram('namlao', 'thungkaew').diagram, 'namlao', 'น้ำเลา (อปท. ที่ใช้งานจริง) ต้องไม่ถูกเปลี่ยนผังด้วย URL')
  assert.equal(resolveDiagram('namlao', 'tamnaktham').diagram, 'namlao')
  assert.deepEqual(resolveDiagram('demo', 'namlao'), { diagram: 'namlao', scope: 'ข้อมูลจริงของน้ำเลา ใช้สาธิต' })
  for (const bad of ['cmu', 'nope', '', null, undefined, '__proto__', 'constructor', 'toString']) {
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
  namlao: {
    min: { edge: 25, weir: 30, text: 55 },
    count: { reservoir: 5, source: 7, pond: 0, supply: 0, pump: 0, repair: 0, chip: 1, slot: 3 },
    animated: [8, 12], // ลำน้ำแม่คำปอง + ลำน้ำแม่ถาง + ลำห้วยที่ผังวาดยาวมีหัวลูกศร (ลำห้วยสั้นลูกศรนิ่ง)
    small: [],
    stations: [['namlao', 'dam', '305'], ['namlao', 'rain', 'STN0911'], ['namlao', 'rain', 'RES040']],
    unconfirmed: [],
    mustSay: null,
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
const KINDS = new Set(['frame', 'outline', 'source', 'text', 'edge', 'weir', 'bridge', 'reservoir', 'pond', 'gate', 'supply', 'pump', 'house', 'school', 'repair', 'planBox', 'chip', 'slot', 'catch'])
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
      assert.ok(['tambon', 'village', 'boundary'].includes(el.cls), at(`${label}: cls ${el.cls}`))
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
  // seed ของสถานีกระจายหลายไฟล์: ไฟล์ที่ขึ้นต้นแถวด้วย ('slug', 'type', 'code' · ไฟล์ฐานของน้ำเลา/demo ที่ขึ้นต้นด้วย ('type', 'code' แล้วใช้กับ slug ในคำสั่งเดียวกัน
  const seeds = ['20260918160000_water_situation_seed_tenants', '20260918180300_water_situation_seed_dams', '20260918150300_water_situation_seed']
    .map(name => ({ name, text: read(`supabase/migrations/${name}.sql`) }))
  const seeded = (slug, type, code) => seeds.some(({ text }) =>
    new RegExp(`\\('${slug}',\\s*'${type}',\\s*'${code}'`).test(text)
    || (new RegExp(`\\('${type}',\\s*'${code}'`).test(text) && new RegExp(`slug IN \\([^)]*'${slug}'`).test(text)))
  for (const [slug, type, code] of expect.stations) assert.ok(seeded(slug, type, code), at(`${slug} ต้องมีสถานี ${type} ${code} ใน seed`))
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
  const STRUCTURE = new Set(['reservoir', 'pond', 'gate', 'supply', 'pump', 'bridge', 'repair', 'planBox', 'source'])
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
    const villageNote = diagram.omitted.find(text => text.includes('เขตหมู่บ้าน'))
    assert.ok(villageNote, at('เขตหมู่บ้านที่ผังวาดเส้นประแดง ต้องบอกใน omitted ว่าวาดต่างหรือไม่ได้วาด'))
    if (diagram.route) assert.ok(villageNote.includes('ไม่ได้ใส่ในแผนภาพ'), at('ผังที่มีแผนภาพเส้นทางน้ำ: เขตหมู่บ้านไม่ได้วาด ต้องบอกว่าไม่ได้ใส่'))
    else assert.ok(villageNote.includes('เทา'), at('เขตหมู่บ้านวาดเป็นสีเทา ต้องบอกเหตุผลใน omitted'))
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
  // น้ำเลา: แผนก่อสร้าง = อ่างแม่คำปอง ตอน 2 + ฝาย 3 แท่ง เท่าที่ผังต้นฉบับระบุสีแดง (ไม่เพิ่มเอง ไม่ตัดออก)
  const namlao = DIAGRAMS.namlao
  assert.deepEqual(namlao.elements.filter(el => el.kind === 'weir' && el.status === 'planned').map(el => el.id).sort(), ['weir-p1', 'weir-p2', 'weir-p3'])
  assert.deepEqual(namlao.elements.filter(el => el.kind === 'reservoir' && el.status === 'planned').map(el => el.id), ['res-mkp2'])
  // พื้นที่ลายขีดแดง: ห้ามตีความ — ไม่ใช่ชนิด repair (ชำรุด) และข้อความบนผัง/ป้าย/ชื่อรายการห้ามเขียนว่าแล้ง/ท่วม (ไม่งั้นบอกประชาชนว่าที่ดินตรงนั้นเสี่ยง)
  assert.equal(namlao.elements.filter(el => el.kind === 'repair').length, 0)
  const area = namlao.elements.find(el => el.id === 'area-unknown')
  assert.equal(area.kind, 'outline', 'พื้นที่ลายขีดแดงต้องเป็นกรอบเส้นประเทาเท่านั้น')
  const namlaoTexts = [
    ...namlao.elements.filter(el => el.kind === 'text' || el.kind === 'chip').map(el => el.t),
    ...namlao.lanes.flatMap(lane => lane.items.map(item => item.name)),
  ]
  for (const text of namlaoTexts) assert.ok(!/แล้ง|ท่วม/.test(text), `"${text}": ห้ามเขียนว่าแล้ง/ท่วม บนผัง (ผังต้นฉบับไม่ระบุความหมายของลายขีดแดง)`)
  for (const item of namlao.lanes.flatMap(lane => lane.items).filter(item => /แล้ง|ท่วม/.test(item.sub ?? ''))) assert.ok(item.sub.includes('ไม่ตีความ'), `${item.name}: พูดถึงแล้ง/ท่วมได้เฉพาะเพื่อบอกว่าไม่ตีความ`)
  assert.ok(namlao.omitted.some(text => text.includes('ลายขีดแดง') && text.includes('ไม่ตีความ')), 'ต้องบอกในกล่องที่มาว่าไม่ตีความลายขีดแดง')
  assert.ok(namlao.omitted.some(text => text.includes('เส้นขอบเขต') && text.includes('ไม่ได้ใส่ในแผนภาพ') && text.includes('สีแดงในผังนี้ใช้หมายถึงแผนก่อสร้าง')), 'เส้นขอบเขตไม่ได้วาด ต้องบอกเหตุผล')
  assert.ok(namlao.omitted.some(text => text.includes('YOM003') && text.includes('นอกตำบล')), 'ต้องบอกว่าไม่แสดงระดับน้ำ YOM003 เพราะนอกตำบล')
  // ค่าสดของน้ำเลาต้องเป็นของในตำบล: ไม่มีระดับน้ำ YOM003 (14.1 กม. นอกตำบล) และไม่มีอ่างเล็กของ อบจ.
  assert.deepEqual(Object.keys(namlao.binds).sort(), ['dam-305', 'rain-RES040', 'rain-STN0911'])
  assert.ok(!Object.values(namlao.binds).some(bind => bind.type === 'level' || bind.type === 'small-dam'))
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

  // อ่างขนาดกลางจากสถานี (dam-station): ไม่ลงสี ค้าง/ซ้ำ/ว่าง/เกิน 100% ต้องบอกตรงๆ
  {
    const damBinds = { 'dam-305': { type: 'dam-station', code: '305' } }
    const damOf = extra => ({ station_type: 'dam', station_code: '305', station_name: 'อ่างเก็บน้ำแม่คำปอง', distance_km: 3.6, recorded_at: ago(2), storage_percent: 84.5, dam_storage_mcm: 5.71, dam_capacity_mcm: 6.76, ...extra })
    const dam = stations => liveBadges({ binds: damBinds, reports: {}, stations, now })['dam-305']
    let d = dam([damOf({})])
    assert.deepEqual([d.tone, d.text], ['ok', 'อ่าง 84.5%'])
    assert.ok(d.detail.includes('อ่างเก็บน้ำแม่คำปอง') && d.detail.includes('84.5% ของความจุที่ระดับเก็บกัก') && d.detail.includes('5.71/6.76 ล้าน ลบ.ม.'), d.detail)
    assert.ok(!/ปกติ|ปลอดภัย|น้ำมาก|เฝ้าระวัง|วิกฤติ/.test(d.text + d.detail), 'ไม่ตีความชั้นสถานการณ์ของอ่าง')
    d = dam([damOf({ storage_percent: 100.4 })])
    assert.equal(d.text, 'อ่าง 100.4%')
    assert.ok(d.detail.includes('มากกว่า 100% = เกินความจุที่ระดับเก็บกักปกติ'), 'เกิน 100% ต้องอธิบายเองบนหน้า ไม่ให้ประชาชนต้องถามว่าตัวเลขผิดไหม')
    d = dam([damOf({ storage_percent: 100 })])
    assert.ok(!d.detail.includes('มากกว่า 100%'))
    d = dam([damOf({ dam_same_count: 3, dam_same_since: ago(60), dam_same_capped: false })])
    assert.deepEqual([d.tone, d.text], ['warn', 'อ่าง 84.5% · ตัวเลขซ้ำเดิม'], 'ตัวเลขซ้ำเดิมตั้งแต่ 3 รายงาน')
    assert.ok(d.detail.includes('ใช้ตัวเลขนี้อย่างระมัดระวัง'))
    d = dam([damOf({ dam_same_count: 2 })])
    assert.equal(d.tone, 'ok', 'ซ้ำ 2 รายงานยังไม่ติดป้าย (เกณฑ์เดียวกับหน้าหลัก)')
    d = dam([damOf({ recorded_at: ago(49), dam_same_count: 9 })])
    assert.deepEqual([d.tone, d.text], ['stale', 'อ่าง 84.5% · ไม่มีรายงานใหม่'], 'ค้างเกิน 48 ชม. (ข้อมูลรายวัน) และค้างแล้วไม่ขึ้น "ซ้ำเดิม" ซ้อน')
    d = dam([damOf({ recorded_at: ago(47) })])
    assert.equal(d.tone, 'ok')
    for (const empty of [null, undefined, '']) {
      d = dam([damOf({ storage_percent: empty })])
      assert.deepEqual([d.tone, d.text], ['na', 'ไม่มีค่าในระบบ'], `% ว่าง (${empty}) ห้ามกลายเป็น 0%`)
    }
    assert.equal(dam([damOf({ storage_percent: -1 })]).tone, 'na')
    assert.equal(dam([damOf({ recorded_at: null })]).tone, 'na', 'ไม่มีวันที่ = ไม่เชื่อค่า')
    assert.equal(dam([{ ...damOf({}), station_type: 'rain' }]).tone, 'na', 'รหัสเดียวกันคนละชนิดต้องไม่ปนกัน')
    assert.equal(dam([]).text, 'ไม่มีค่าในระบบ')
    assert.equal(dam(null).text, 'ไม่มีค่าในระบบ')
  }

  // ฝน
  b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: 12.5 })])
  assert.deepEqual([b['rain-RES038'].tone, b['rain-RES038'].text], ['ok', 'ฝน 12.5 มม.'])
  assert.ok(b['rain-RES038'].detail.includes('ฝนปานกลาง'), 'ใช้ป้ายฝนเดิมของ rainLevel')
  assert.ok(b['rain-RES038'].detail.includes('สถานีหนองม่วงไข่ ห่าง 4.8 กม.'), 'รายละเอียดฝนต้องบอกชื่อสถานีและระยะ (ประชาชนถามเสมอว่าวัดที่ไหน)')
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
  assert.deepEqual(liveBadges({ binds: { x: { type: 'unknown' } }, now }), { x: { tone: 'na', text: 'ไม่มีค่าในระบบ', detail: 'ไม่มีค่าในระบบ', short: 'ไม่มีค่า' } })
  assert.deepEqual(liveBadges({ now }), {})

  // short/note สำหรับป้ายบนแผนภาพเส้นทางน้ำ (เพิ่มจาก text/detail เดิม) — ค้าง/ซ้ำเดิม/ไม่มีค่าต้องไม่กลายเป็นค่าปกติ
  {
    const sn = badge => [badge.short, badge.note ?? null]
    b = badges({ 50: entry(report(2, [73.2, 71.5, 70])), 30: entry(report(2, [76.79, 75, 74])) }, [])
    assert.deepEqual(sn(b['dam-50']), ['73.2%', null])
    assert.deepEqual(sn(b['dam-30']), ['76.8%', null])
    b = badges({ 50: entry(report(30, [73.2, 71.5])), 30: undefined }, [])
    assert.deepEqual(sn(b['dam-50']), ['73.2%', 'ไม่มีรายงานใหม่'], 'รายงานค้าง = ยังเห็นเลขเดิมแต่มีหมายเหตุ')
    assert.deepEqual(sn(b['dam-30']), ['กำลังโหลด', null])
    b = badges({ 50: entry(report(2, [73.2, 73.2, 73.2, 73.2])), 30: entry(report(2, [70, 71])) }, [])
    assert.deepEqual(sn(b['dam-50']), ['73.2%', 'ตัวเลขซ้ำเดิม'])
    b = badges({ 50: { report: null, failed: true, done: true } }, [])
    assert.deepEqual(sn(b['dam-50']), ['ไม่มีค่า', 'โหลดไม่ได้'], 'Worker ล่ม ไม่เคยมีของเดิม = ไม่มีเลข')
    b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: 0 }), stationOf('waterlevel', 'YOM003', { bank_diff_m: 6.02 })])
    assert.deepEqual(sn(b['rain-RES038']), ['ฝน 0 มม.', null], 'ฝน 0 ที่วัดได้จริงแสดงเป็น 0')
    assert.deepEqual(sn(b['level-YOM003']), ['ต่ำกว่าตลิ่ง 6.02 ม.', null])
    b = badges({}, [stationOf('rain', 'RES038', { rain_24h_mm: 12.5, recorded_at: ago(4) }), stationOf('waterlevel', 'YOM003', { bank_diff_m: 6.02, recorded_at: ago(4) })])
    assert.deepEqual(sn(b['rain-RES038']), ['ฝน', 'ไม่มีค่าใหม่'])
    assert.deepEqual(sn(b['level-YOM003']), ['ระดับน้ำ', 'ไม่มีค่าใหม่'])
    assert.ok(!sn(b['rain-RES038']).join(' ').includes('12.5') && !sn(b['level-YOM003']).join(' ').includes('6.02'), 'ค่าที่ค้างห้ามโผล่ในข้อความสั้น')
    b = badges({}, [])
    assert.deepEqual(sn(b['rain-RES038']), ['ไม่มีค่า', null])
    assert.deepEqual(sn(b['level-YOM003']), ['ไม่มีค่า', null])
    const damBinds = { d: { type: 'dam-station', code: '305' } }
    const damOf = extra => ({ station_type: 'dam', station_code: '305', station_name: 'อ่างแม่คำปอง', distance_km: 3.6, recorded_at: ago(2), storage_percent: 84.5, ...extra })
    const damShort = extra => sn(liveBadges({ binds: damBinds, reports: {}, stations: [damOf(extra)], now }).d)
    assert.deepEqual(damShort({}), ['84.5%', null])
    assert.deepEqual(damShort({ dam_same_count: 3, dam_same_since: ago(60), dam_same_capped: false }), ['84.5%', 'ตัวเลขซ้ำเดิม'])
    assert.deepEqual(damShort({ recorded_at: ago(49) }), ['84.5%', 'ไม่มีรายงานใหม่'])
    assert.deepEqual(damShort({ storage_percent: null }), ['ไม่มีค่า', null])
  }
  for (const badge of Object.values(badges({ 50: entry(report(2, [70, 69])) }, [stationOf('rain', 'RES038', { rain_24h_mm: 1 })]))) {
    assert.ok(TONES.has(badge.tone) && badge.text && badge.detail)
  }
}

// ── แผนภาพเส้นทางน้ำ (ผังที่มี route) — ข้อมูล · ตัวตรวจ · ป้ายค่าสด · คำกำกับ · แอนิเมชัน ──
{
  const withRoute = Object.entries(DIAGRAMS).filter(([, diagram]) => diagram.route).map(([id]) => id)
  assert.deepEqual(withRoute.slice().sort(), ['namlao', 'tamnaktham', 'thungkaew'], 'ทุกผังของ อปท. ที่มีผังน้ำใช้แผนภาพเส้นทางน้ำ (ทุ่งแค้ว #551 · ตำหนักธรรม + น้ำเลา)')

  // วลีอ้างอิงรายจุด: ทุกจุดต้องมาจากรายการสายน้ำ (lanes) ของผังที่ตรวจแล้ว ไม่เขียนจุดที่ผังไม่มี
  // ค่าเป็นอาร์เรย์ = ทุกวลีต้องอยู่ทั้งในข้อมูลสายน้ำและในชื่อ/คำอธิบายของจุด (จุดที่รวมหลายรายการ)
  const ANCHORS_BY_ID = {
    thungkaew: {
      1: ['อ่างเก็บน้ำห้วยเฮือ'], 2: ['ฝายซอยซีเมนต์'], 3: ['อ่างเก็บน้ำห้วยยอย'], 4: ['ฝายกำนันอำพร'], 5: ['โครงสร้างตามแผน'], 6: ['หนองน้อย'], 7: ['ประตูน้ำ'],
      8: ['ห้วย 4 เส้น'], 9: ['รางส่งน้ำชำรุด'], 10: ['สถานีสูบน้ำพลังงานแสงอาทิตย์'], 11: ['หนองใหม่ก่อ'], 12: ['อ่างห้วยปุ่ย'], 13: ['ฝายปู่อ๋วน'], 14: ['แม่น้ำยม'],
    },
    tamnaktham: {
      1: ['น้ำแม่คำมี'], 2: ['ฝายเวียงม่วง'], 3: ['ฝายแม่คำมีหมู่ 1'], 4: ['ฝายแม่คำมี ม.5', 'ห้วยเคี่ยน'], 5: ['สถานีสูบน้ำ (ใกล้ห้วยเคี่ยน)'], 6: ['สะพานข้ามน้ำแม่คำมี'],
      7: ['ประตูระบายน้ำ'], 8: ['สถานีสูบน้ำ (ฝั่งตะวันออก)'], 9: ['คลองชลประทานแม่ยมฝั่งซ้าย', 'ตัดผ่านน้ำแม่คำมี', 'ท่อลอดห้วยลึก'],
      10: ['ฝายแม่คำมี ม.3', 'ร่องซิง', 'ห้วยหาด'], 11: ['สถานีสูบน้ำ (บ่อบาดาล)'], 12: ['ฝายแม่คำมีหมู่ 12'], 13: ['ร่องปู่แจ้'], 14: ['ระบบประปา (หมู่ 1)'], 15: ['แม่น้ำยม'],
    },
    namlao: {
      1: ['ต้นน้ำแม่คำปอง', 'ห้วยฝั่งตะวันตกตอนบน 4 สาย', 'ห้วยฝั่งตะวันออกตอนบน 5 สาย'], 2: ['อ่างแม่คำปอง ตอน 2'], 3: ['อ่างเก็บน้ำแม่คำปอง'], 4: ['ฝายลุ่มบุญแจ่ม'],
      5: ['ฝายบนลำน้ำ 2 แห่ง'], 6: ['ห้วยดงแก้ว', 'ห้วยหล่าย'], 7: ['ฝายบนห้วยหล่าย 1 แห่ง'], 8: ['ฝายลุ่มวัดบุญแจ่ม', 'ฝายหนองเฮ่ย'],
      9: ['ห้วยคอกผา', 'ห้วยเตาปูน'], 10: ['ลำห้วยไม่ระบุชื่อ 3 สาย'], 11: ['ลำห้วยทรายขาว', 'อ่างห้วยทรายขาว', 'อ่างเด่นควาย'], 12: ['ลำห้วยหิน'],
      13: ['ห้วยขึม (ม.3)', 'ฝายและอ่างห้วยขึม'], 14: ['อ่างห้วยขึมโยธินฯ'], 15: ['ทางน้ำแยกจากห้วยขึม', 'ห้วยน้ำชำ'], 16: ['ลำห้วยฝายอบจ', 'ฝายอบจ 6 แห่งเรียงซ้อน'],
      17: ['สระหนองสะเลียม'], 18: ['ลำห้วยฝายท่าเรือ'], 19: ['สระ 50 ไร่'], 20: ['หมู่ 1 บุญแจ่ม'], 21: ['ลำน้ำแม่ถาง'],
    },
  }

  for (const id of withRoute) {
    const diagram = DIAGRAMS[id]
    const route = diagram.route
    assert.deepEqual(routeIssues(route, diagram.binds), [], id + ': ข้อมูลเส้นทางต้องผ่านตัวตรวจ')
    const items = routeItems(route)
    assert.deepEqual(items.map(item => item.n), items.map((_, i) => i + 1), id + ': หมายเลขเรียง 1..N ต่อเนื่อง')
    assert.equal(items.at(-1).isRiver, true, id + ': แม่น้ำเป็นจุดสุดท้าย')

    const lanesText = JSON.stringify(diagram.lanes)
    const anchors = ANCHORS_BY_ID[id]
    assert.equal(Object.keys(anchors).length, items.length, id + ': วลีอ้างอิงต้องครบทุกจุด')
    for (const item of items) {
      const own = item.name + ' ' + (item.sub ?? '')
      for (const anchor of anchors[item.n] ?? assert.fail(id + ' จุด ' + item.n + ' ยังไม่มีวลีอ้างอิงผัง (ANCHORS_BY_ID)')) {
        assert.ok(lanesText.includes(anchor), id + ' จุด ' + item.n + ': "' + anchor + '" ไม่อยู่ในรายการสายน้ำของผัง')
        // ทุ่งแค้วจุด 9: ผังเขียน "รางส่งน้ำชำรุด (ตัดคลอง)" ในรายการ จุดในแผนภาพเขียน "รางส่งน้ำ (ตัดคลอง)" + แท็กชำรุด
        if (id === 'thungkaew' && item.n === 9) assert.ok(own.includes('รางส่งน้ำ'), 'จุด 9 ต้องตรงรายการ "รางส่งน้ำชำรุด (ตัดคลอง)" ในผัง')
        else assert.ok(own.includes(anchor), id + ' จุด ' + item.n + ': ชื่อ/คำอธิบายต้องมี "' + anchor + '"')
      }
    }

    // สถานะแผนก่อสร้าง/ชำรุดต้องตรงกับรายการสายน้ำของผังทั้งสองทาง (ไม่ตกหล่น ไม่เพิ่มเอง)
    const laneItems = diagram.lanes.flatMap(lane => lane.items)
    for (const stop of route.stops.filter(s => s.status !== 'existing')) {
      const item = laneItems.find(it => it.name.includes(anchors[stop.n][0]))
      assert.ok(item && item.status === stop.status, id + ' จุด ' + stop.n + ': ผังต้องระบุ ' + stop.status + ' เหมือนกัน')
    }
    for (const item of laneItems.filter(it => it.status && it.status !== 'existing' && !it.name.startsWith('แผนก่อสร้างทั้งหมด'))) {
      // แผนก่อสร้าง/ชำรุดที่ไม่ได้ใส่ในแผนภาพ (เช่น สถานีสูบน้ำไฟฟ้าของทุ่งแค้ว) ต้องบอกในกล่องที่มา (omitted) ไม่ปล่อยให้หายเงียบ
      const covered = route.stops.some(s => s.status === item.status && anchors[s.n].some(a => item.name.includes(a)))
        || diagram.omitted.some(text => text.includes(item.name.split(' ')[0]))
      assert.ok(covered, id + ': "' + item.name + '" ผังระบุ ' + item.status + ' แต่ไม่มีจุดตรงกันในแผนภาพและไม่ได้บอกใน omitted')
    }

    // ชื่อห้วยที่ยังไม่ยืนยันกับ อบต. ห้ามโผล่ในแผนภาพ
    const routeText = JSON.stringify(route)
    for (const name of ['ห้วยจำค่า', 'ห้วยย่าเฟย', 'ห้วยจำ"']) assert.ok(!routeText.includes(name), '"' + name + '" ยังไม่ยืนยันกับ อบต. ห้ามขึ้นหน้า')
    // ลายขีดแดง/แล้ง/ท่วม: ไม่ตีความ (ผังต้นฉบับไม่นิยามความหมาย)
    assert.ok(!/แล้ง|ท่วม/.test(routeText), id + ': ห้ามเขียนว่าแล้ง/ท่วมในแผนภาพ')
    // ทุกจุดมีรายการ/ป้ายค่าสดตรงกับ binds ของผัง · หัวข้อกลุ่ม (ถ้ามี) ต้องตรงชื่อสายในผัง
    const laneTitles = new Set(diagram.lanes.map(lane => lane.title))
    const groups = items.map(item => item.group).filter(Boolean)
    if (groups.length > 0) {
      assert.equal(groups.length, items.length, id + ': ถ้ากำหนดกลุ่ม ทุกจุดต้องมีกลุ่ม')
      for (const group of new Set(groups.slice(0, -1))) assert.ok(laneTitles.has(group), id + ': กลุ่ม "' + group + '" ไม่ตรงชื่อสายในผัง')
      const order = [...new Set(groups)]
      assert.deepEqual(groups, order.flatMap(g => groups.filter(x => x === g)), id + ': จุดของแต่ละกลุ่มต้องเรียงติดกัน')
    }
  }

  // ของในผังที่ไม่ได้ใส่ในแผนภาพ ต้องบอกในกล่องที่มา (รายผัง)
  {
    const said = (id, words) => words.every(word => DIAGRAMS[id].omitted.some(text => text.includes(word)))
    for (const id of withRoute) assert.ok(DIAGRAMS[id].omitted.some(text => text.includes('ตำแหน่งฝาย') && text.includes('ผังต้นฉบับ')), id + ': ต้องบอกว่าตำแหน่งฝาย/ห้วยไม่ตรงจริง ดูที่ผังต้นฉบับ')
    assert.ok(said('thungkaew', ['คลองชลประทานฝายแม่ยมฝั่งขวา', 'ประปาหมู่ 1', 'สถานีสูบน้ำไฟฟ้า', 'ผนัง สจ.']), 'ทุ่งแค้ว: ของใน "โครงสร้างอื่นในผัง" ที่ไม่ได้ใส่ต้องบอก')
    assert.ok(said('tamnaktham', ['เขตตำบล', 'เขตหมู่บ้าน', 'ห้วยหาด', 'ประตูระบายน้ำเล็ก']), 'ตำหนักธรรม: เขต/ห้วยหาด/ประตูเล็กที่รวมหรือไม่ได้วาดต้องบอก')
    assert.ok(said('namlao', ['ลายขีดแดง', 'ไม่ตีความ', 'เส้นขอบเขต', 'ห้วยเหล็ก · ห้วยวัว', 'YOM003', '28 รายการเป็น 20 จุด']), 'น้ำเลา: ลายขีดแดง/เขต/ห้วยเหล็ก-วัว/YOM003/การย่อรายการต้องบอก')
  }

  // ทุ่งแค้ว: สถานะตามผัง
  {
    const route = DIAGRAMS.thungkaew.route
    assert.equal(route.stops.length, 13)
    assert.deepEqual(route.stops.filter(s => s.status === 'planned').map(s => s.n), [5, 10], 'แผนก่อสร้าง = โครงสร้างตามแผน + สถานีสูบน้ำพลังงานแสงอาทิตย์')
    assert.deepEqual(route.stops.filter(s => s.status === 'repair').map(s => s.n), [9], 'ชำรุด = รางส่งน้ำ')
    assert.deepEqual(route.streams.filter(s => s.flow).map(s => s.id).sort(), ['hue-divert', 'mid-creeks', 'mid-ponds'], 'เส้นวิ่งเฉพาะที่ผังวาดลูกศรทิศน้ำ')
    for (const stop of route.stops.filter(s => s.status !== 'existing')) {
      assert.ok(stop.pills.some(p => p.text && (p.tone === 'plan' || p.tone === 'fix')), 'จุด ' + stop.n + ' ต้องมีป้ายแผน/ชำรุดบนภาพ')
      assert.ok(!stop.props.some(p => p.t === 'weir'), 'จุด ' + stop.n + ' ห้ามวาดฝายเป็นของที่มีอยู่')
    }
    assert.equal(route.stops[0].props[0].na, true, 'อ่างห้วยเฮือไม่มีข้อมูล = ผืนน้ำขอบประเทา ไม่ลงสีน้ำ')
    assert.deepEqual(new Set(route.stops.flatMap(s => (s.live ?? []))).size, 3, 'ค่าสดในรายการ: dam-50 · rain-RES038 · dam-30 (แม่น้ำแยกที่ river.live)')
    assert.deepEqual(route.river.live, ['level-YOM003'])
  }

  // ตำหนักธรรม: สถานะตามผัง · เส้นวิ่ง · ค่าสด
  {
    const { route, binds } = DIAGRAMS.tamnaktham
    assert.equal(route.stops.length, 14)
    assert.deepEqual(route.stops.filter(s => s.status === 'planned').map(s => s.n), [3, 5, 8, 11, 12], 'แผนก่อสร้าง = ฝายหมู่ 1 · สถานีสูบน้ำ 3 จุด · ฝายหมู่ 12 (สีแดงในผังต้นฉบับ)')
    assert.equal(route.stops.filter(s => s.status === 'repair').length, 0)
    for (const stop of route.stops.filter(s => s.status === 'planned')) {
      assert.ok(stop.pills.some(p => p.text === 'แผน' && p.tone === 'plan'), 'จุด ' + stop.n + ' ต้องมีป้ายแผนบนภาพ')
      assert.ok(!stop.props.some(p => p.t === 'weir'), 'จุด ' + stop.n + ' ห้ามวาดฝายเป็นของที่มีอยู่')
    }
    assert.deepEqual(route.stops.filter(s => s.props.some(p => p.t === 'pump')).map(s => s.n), [5, 8, 11], 'สถานีสูบน้ำทั้ง 3 จุดเป็นแผนก่อสร้างทั้งหมด')
    assert.deepEqual(route.streams.filter(s => s.flow).map(s => s.id).sort(), ['canal', 'mkm'], 'เส้นวิ่ง = น้ำแม่คำมี + คลองชลประทาน (ผังวาดลูกศร) · ลำห้วยสาขาลูกศรนิ่ง · แม่น้ำยมแค่คลื่น')
    assert.deepEqual(route.streams.find(s => s.id === 'canal').touches, [9])
    assert.deepEqual(Object.keys(binds), ['level-Y.38'], 'ค่าสดมีช่องเดียว: ระดับน้ำ Y.38 (ไม่มีฝนในตำบล)')
    assert.deepEqual(route.stops[0].live, ['level-Y.38'])
    assert.ok(!route.river.slot && !route.river.live, 'แม่น้ำยมไม่มีสถานีวัด ห้ามผูกค่าสดให้ดูเหมือนวัดแม่น้ำยม')
    assert.ok(!JSON.stringify(route).includes('ฝน'), 'ตำหนักธรรมไม่มีสถานีฝนในตำบล')
  }

  // น้ำเลา: สถานะตามผัง · เส้นวิ่ง · ค่าสด · อ่างที่ไม่มีข้อมูล
  {
    const { route, binds } = DIAGRAMS.namlao
    assert.equal(route.stops.length, 20)
    assert.deepEqual(route.stops.filter(s => s.status === 'planned').map(s => s.n), [2, 5, 7], 'แผนก่อสร้าง = อ่างแม่คำปอง ตอน 2 · ฝายบนลำน้ำ 2 แห่ง · ฝายบนห้วยหล่าย 1 แห่ง (สีแดงในผังต้นฉบับ)')
    for (const stop of route.stops.filter(s => s.status === 'planned')) {
      assert.ok(stop.pills.some(p => p.text === 'แผน' && p.tone === 'plan'), 'จุด ' + stop.n + ' ต้องมีป้ายแผนบนภาพ')
      assert.ok(!stop.props.some(p => p.t === 'weir' || p.t === 'lake'), 'จุด ' + stop.n + ' ห้ามวาดฝาย/อ่างเป็นของที่มีอยู่')
    }
    assert.deepEqual(route.streams.filter(s => s.flow).map(s => s.id).sort(), ['hin', 'hsk', 'khuem', 'mkp', 'obj', 'sra50', 'tao', 'thare'], 'เส้นวิ่ง = ลำน้ำแม่คำปอง + ห้วยสาขาที่ผังวาดเป็นลำหลัก/ลำห้วยมีลูกศร (เท่ากับเส้นวิ่งของผังเดิม ยกเว้นลำน้ำแม่ถางที่เป็นแม่น้ำ)')
    assert.deepEqual(Object.keys(binds).sort(), ['dam-305', 'rain-RES040', 'rain-STN0911'])
    const liveOf = n => route.stops[n - 1].live
    assert.deepEqual([liveOf(3), liveOf(14), liveOf(20)], [['dam-305'], ['rain-RES040'], ['rain-STN0911']])
    assert.ok(!route.river.slot && !route.river.live, 'ไม่ใส่ระดับน้ำ YOM003 (นอกตำบล 14.1 กม.) — ลำน้ำแม่ถางไม่มีค่าสด')
    assert.ok(!JSON.stringify(route).includes('YOM003'))
    // อ่างที่ไม่มีในรายการอ่างเล็กของ อบจ. = ผืนน้ำขอบประเทา + แท็กไม่มีข้อมูล (ห้ามวาดเหมือนมีน้ำ)
    for (const n of [11, 14]) {
      const stop = route.stops[n - 1]
      assert.ok(stop.props.filter(p => p.t === 'lake').every(p => p.na === true), 'จุด ' + n + ': อ่างไม่มีข้อมูลต้องวาดขอบประเทา')
      assert.ok(stop.tags.some(tag => tag.k === 'na'), 'จุด ' + n + ': ต้องมีแท็กไม่มีข้อมูลในระบบ')
    }
    assert.ok(route.stops[2].props.every(p => !p.na), 'อ่างแม่คำปองมีค่าสด (dam-305) วาดเป็นผืนน้ำปกติ')
    assert.equal(route.river.group, 'ปลายน้ำ')
  }

  // ตัวตรวจต้องจับของเสียได้จริง (กันตัวตรวจหลวม)
  {
    const diagram = DIAGRAMS.thungkaew
    const run = mutate => {
      const route = structuredClone(diagram.route)
      const binds = structuredClone(diagram.binds)
      mutate(route, binds)
      return routeIssues(route, binds)
    }
    assert.deepEqual(run(() => {}), [], 'ข้อมูลเดิมผ่าน')
    const cases = [
      ['หมายเลขซ้ำ', route => { route.stops[3].n = 3 }, /หมายเลข/],
      ['แม่น้ำไม่ใช่เลขสุดท้าย', route => { route.river.n = 20 }, /แม่น้ำต้องเป็นหมายเลขสุดท้าย/],
      ['เส้นวิ่งผ่านจุดแผนก่อสร้าง', route => { route.streams.find(s => s.id === 'mid-pump').flow = true }, /วิ่งผ่านจุด 10/],
      ['เส้นวิ่งไม่ระบุ touches', route => { delete route.streams.find(s => s.id === 'hue-divert').touches }, /ต้องระบุ touches/],
      ['จุดแผนก่อสร้างไม่มีแท็กในรายการ', route => { route.stops[4].tags = [] }, /แผนก่อสร้างต้องมีแท็ก plan/],
      ['จุดแผนก่อสร้างไม่มีป้ายบนภาพ', route => { route.stops[4].pills = [] }, /ต้องมีป้ายบนภาพ/],
      ['จุดชำรุดไม่มีแท็ก', route => { route.stops[8].tags = [] }, /ชำรุดต้องมีแท็ก fix/],
      ['ฝายบนจุดแผนก่อสร้าง', route => { route.stops[4].props.push({ t: 'weir', x: 150, y: 620, s: 1 }) }, /ห้ามวาดฝายเป็นของที่มีอยู่/],
      ['ช่องค่าสดไม่อยู่ใน binds', route => { route.stops[2].pills[0].slot = 'dam-99' }, /ไม่อยู่ใน binds/],
      ['bind ที่ไม่ขึ้นหน้า', (route, binds) => { binds['dam-77'] = { type: 'small-dam', id: '77' } }, /ผูกไว้แต่ไม่ขึ้น/],
      ['เกาะทับกัน', route => { route.stops[3].island.x = 186; route.stops[3].island.y = 745 }, /ทับกับ/],
      ['เกาะล้นกรอบ', route => { route.stops[11].island.x = 470 }, /ล้นกรอบด้านข้าง/],
      ['ชนิดสิ่งที่วางไม่รู้จัก', route => { route.stops[0].props.push({ t: 'ufo', x: 10, y: 10 }) }, /ไม่รู้จัก/],
      ['ป้ายคงที่ไม่มี tone', route => { delete route.stops[4].pills[0].tone }, /ต้องมี text และ tone/],
      ['ลำน้ำไม่ถึงตลิ่ง', route => { route.streams.find(s => s.id === 'yoi').pts.at(-1)[1] = 700 }, /ไหลลงขอบตลิ่ง/],
      ['ลำน้ำอยู่นอกกรอบ', route => { route.streams[1].pts[0][0] = -5 }, /อยู่ในกรอบ/],
      ['touches อ้างจุดที่ไม่มี', route => { route.streams[0].touches.push(99) }, /ที่ไม่มี/],
      ['ลำน้ำ id ซ้ำ', route => { route.streams[1].id = route.streams[0].id }, /id ซ้ำ/],
      ['status ผิด', route => { route.stops[0].status = 'maybe' }, /status/],
      ['ไม่มีชื่อบนภาพ', route => { delete route.stops[0].label }, /label/],
      ['ชื่อบนภาพออกนอกกรอบ', route => { route.stops[2].island.y = 30 }, /ชื่อบนภาพออกนอกกรอบ/],
      ['ต้นไม้นอกกรอบ', route => { route.stops[0].trees.push([900, 10, 1]) }, /ต้นไม้อยู่นอกกรอบ/],
      ['ไม่มีชื่อแม่น้ำ', route => { delete route.river.name }, /แม่น้ำต้องมี name/],
      // ช่องค่าสดของแม่น้ำไม่บังคับ (ตำหนักธรรม/น้ำเลาไม่มีสถานีบนแม่น้ำปลายทาง) แต่ที่ผูกไว้ใน binds ต้องขึ้นหน้าเสมอ
      ['ถอดช่องค่าสดแม่น้ำออกแต่ binds ยังผูกไว้', route => { delete route.river.slot; delete route.river.live }, /level-YOM003 ผูกไว้แต่ไม่ขึ้น/],
    ]
    for (const [name, mutate, expected] of cases) {
      const issues = run(mutate)
      assert.ok(issues.some(issue => expected.test(issue)), 'ตัวตรวจต้องจับ "' + name + '" ได้ (ได้ ' + JSON.stringify(issues) + ')')
    }
    assert.deepEqual(routeIssues({ viewBox: {}, stops: [], streams: [] }), ['viewBox ต้องมี w และ h'])
  }

  // ป้ายค่าสดบนภาพ: ใช้ short/note จาก liveBadges · ไม่มีช่อง = ไม่วาดป้าย · ป้ายคงที่ใช้ tone ที่รู้จัก
  {
    const badge = { tone: 'stale', text: 'อ่าง 73.2% · ไม่มีรายงานใหม่', detail: 'x', short: '73.2%', note: 'ไม่มีรายงานใหม่' }
    assert.deepEqual(pillFor({ slot: 'dam-50' }, { 'dam-50': badge }), { main: '73.2%', note: 'ไม่มีรายงานใหม่', tone: 'stale' })
    assert.equal(pillFor({ slot: 'dam-50' }, {}), null)
    assert.equal(pillFor({ slot: 'dam-50' }, undefined), null)
    assert.deepEqual(pillFor({ text: 'แผน', tone: 'plan' }, {}), { main: 'แผน', note: null, tone: 'plan' })
    assert.deepEqual(pillFor({ slot: 'a' }, { a: { tone: 'ok', text: 'ฝน 0 มม.', detail: 'x' } }), { main: 'ฝน 0 มม.', note: null, tone: 'ok' }, 'ไม่มี short ใช้ text')
    for (const tone of ['ok', 'warn', 'stale', 'na', 'plan', 'fix']) assert.ok(CHIP_TONES[tone], 'โทนป้าย ' + tone)
    assert.equal(CHIP_TONES.ok.dash, false)
    assert.equal(CHIP_TONES.stale.dash, true, 'ค้าง = ขอบประ')
    assert.equal(CHIP_TONES.na.dash, true, 'ไม่มีค่า = ขอบประ')
    assert.equal(pillWidth('73.2%', 17), chipWidth('73.2%', 17))
  }

  // เรขาคณิต
  {
    assert.equal(smoothPath([[0, 0]]), '')
    assert.equal(smoothPath(undefined), '')
    const d = smoothPath([[0, 0], [10, 20]])
    assert.ok(d.startsWith('M0 0 C') && d.endsWith('10 20'), d)
    assert.equal((smoothPath([[0, 0], [10, 10], [20, 0], [30, 10]]).match(/C/g) ?? []).length, 3, 'จุด n → เส้นโค้ง n-1')
    const shape = islandShape({ x: 100, y: 100, rx: 50, ry: 20 })
    assert.equal(shape.drips.length, 3)
    assert.ok(shape.side.includes(String(100 + ISLAND_THICKNESS)), 'ด้านข้างหนาตาม ISLAND_THICKNESS')
    assert.ok(shape.shadow.cy > 100 + ISLAND_THICKNESS + 20, 'เงาอยู่ใต้เกาะ')
    assert.ok(wavePath(0, 480, 934, 1004).startsWith('M-60 934'), 'คลื่นกว้างเกินกรอบ 60 หน่วย เลื่อน 1 คาบได้ไม่เห็นรอยขาด')
    assert.deepEqual(pinPosition({ island: { x: 100, y: 100, rx: 50, ry: 20 } }), { x: 60, y: 96 })
    assert.deepEqual(labelPosition({ island: { x: 100, y: 100, rx: 50, ry: 20 }, labelUp: 5 }), { x: 100, y: 65 })
    assert.deepEqual(PROP_KINDS.slice().sort(), ['bridge', 'creeks', 'gate', 'ghost', 'lake', 'pond', 'pump', 'repair', 'supply', 'village', 'weir'])
    // routeKinds: คำอธิบายสัญลักษณ์ขึ้นเฉพาะที่ผังใช้จริง
    const kindsOf = route => [...routeKinds(route)].sort()
    assert.deepEqual(kindsOf({ stops: [], streams: [] }), ['na'], 'ผังว่างมีแค่ขอบประ (ป้ายไม่มีค่า)')
    assert.deepEqual(kindsOf({ stops: [{ status: 'planned', props: [{ t: 'ghost' }, { t: 'creeks', weirs: 2 }, { t: 'bridge' }] }], streams: [{ flow: true }] }), ['bridge', 'creeks', 'flow', 'na', 'planned', 'weir', 'ghost'].sort())
    assert.ok(!routeKinds({ stops: [{ status: 'existing', props: [{ t: 'creeks', weirs: 0 }] }], streams: [{ flow: false }] }).has('weir'), 'ห้วยไม่มีฝายไม่ทำให้ขึ้นคำอธิบายฝาย')
    assert.ok(!routeKinds({ stops: [], streams: [{ flow: false }] }).has('flow'), 'ไม่มีเส้นวิ่ง = ไม่ขึ้นคำอธิบายเส้นวิ่ง')
  }

  // ซอร์สหน้าจอ: คำกำกับ · ไม่ลงสีสถานการณ์ · ไม่มีเข็มทิศ · แอนิเมชันเฉพาะ flow · หยุด/นอกจอ/ลดการเคลื่อนไหวครอบทุกแอนิเมชัน
  {
    const art = read('src/components/water/WaterRouteArt.jsx')
    const list = read('src/components/water/WaterRouteList.jsx')
    const view = read('src/components/water/WaterDiagram.jsx')
    const css = read('src/components/water/WaterDiagram.css')
    const code = text => text.split('\n').filter(line => !line.trim().startsWith('//')).join('\n') // ตรวจเฉพาะโค้ด ไม่รวมคอมเมนต์ที่เขียนว่า "ไม่มีเข็มทิศ"
    assert.ok(!/compass|เข็มทิศ|เหนือ/i.test(code(art + list)), 'ภาพไม่วาดเข็มทิศ/ทิศเหนือ (ผังต้นฉบับไม่ระบุทิศ)')
    // เจ้าของระบบสั่ง 2569-10-22 "ไม่มีเข็มทิศก็ไม่ต้องแสดง" → ไม่มีกล่องหมายเหตุเข็มทิศ แต่คำกำกับบังคับยังบอกว่า "ไม่ใช่แผนที่ ตำแหน่ง ทิศ และมาตราส่วนไม่ตรงจริง"
    assert.ok(!code(view).includes('ไม่มีเข็มทิศ') && !view.includes('data-route-note'), 'ห้ามแสดงกล่องหมายเหตุ "ไม่มีเข็มทิศ" (ถอดตามคำสั่งเจ้าของระบบ)')
    assert.ok(view.includes('ไม่ใช่แผนที่') && view.includes('ตำแหน่ง ทิศ และมาตราส่วนไม่ตรงจริง'), 'คำกำกับบังคับต้องบอกว่าทิศไม่ตรงจริง')
    for (const hex of ['#003CFA', '#FFC000', '#00B050', '#FF0000', '#C70000']) assert.ok(!(art + list).toUpperCase().includes(hex.toUpperCase()), 'ห้ามลงสีระดับอ่างทางการบนแผนภาพ ' + hex + ' (ป้ายใช้โทนเดิมของผัง)')
    assert.match(art, /import \{ CHIP_TONES \} from '\.\.\/\.\.\/lib\/waterDiagram\/model'/, 'ป้ายใช้โทนเดียวกับผังเดิม')
    assert.ok(!/const CHIP_TONES/.test(view), 'CHIP_TONES อยู่ที่ model.js ที่เดียว')
    assert.ok(!/Math\.random|Date\.now|new Date/.test(art), 'ภาพต้องวาดเหมือนเดิมทุกครั้ง (ไม่สุ่ม ไม่ผูกเวลา)')
    assert.match(art, /className=\{st\.flow \? 'wr-flow' : 'wr-hl'\}/, 'ลายวิ่งเฉพาะลำน้ำที่ flow')
    assert.match(art, /strokeDasharray=\{st\.flow \? '3 11' : undefined\}/)
    assert.match(art, /markerEnd=\{st\.flow \? 'url\(#wr-arrow\)' : undefined\}/, 'เส้นวิ่งมีหัวลูกศร (ดูทิศได้แม้ลดการเคลื่อนไหว) ลำน้ำที่ไม่วิ่งไม่มีหัวลูกศร (ไม่เดาทิศ)')
    assert.ok((art.match(/wr-flow/g) ?? []).length === 1, 'wr-flow ใช้จุดเดียว (Stream)')
    assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(art + list))
    assert.ok(!/from ['"][^'"]*supabase[^'"]*['"]/.test(art + list) && !/\.rpc\(|supabase\.from\(/.test(art + list), 'ภาพ/รายการไม่เรียกฐานข้อมูลเอง')
    for (const kind of PROP_KINDS) assert.ok(art.includes("case '" + kind + "'"), 'WaterRouteArt ต้องวาดชนิด ' + kind)
    // ทุกสัญลักษณ์ที่ใช้ในข้อมูลมีคำอธิบายในหน้า
    const LEGEND_TEXT = { lake: "text: 'อ่างเก็บน้ำ'", pond: "text: 'หนอง'", weir: "text: 'ฝาย'", gate: "text: 'ประตูระบายน้ำ'", ghost: 'แผนก่อสร้าง ไม่เคลื่อนไหว', pump: 'แผนก่อสร้าง ไม่เคลื่อนไหว', repair: 'ชำรุดตามผัง ไม่เคลื่อนไหว', bridge: "text: 'สะพาน'", supply: "text: 'ระบบประปา'", village: "text: 'หมู่บ้าน'" }
    const used = new Set(Object.values(DIAGRAMS).filter(d => d.route).flatMap(d => d.route.stops.flatMap(s => s.props.map(p => p.t))))
    for (const kind of used) if (LEGEND_TEXT[kind]) assert.ok(view.includes(LEGEND_TEXT[kind]), 'สัญลักษณ์ ' + kind + ' ไม่มีคำอธิบายใน ROUTE_LEGEND')
    assert.ok(view.includes('ขอบประ = ไม่มีค่า · ไม่มีรายงานใหม่ · ไม่ระบุ') && view.includes('เส้นวิ่ง + หัวลูกศร'), 'คำอธิบายขอบประ/เส้นวิ่ง')
    // มุมมองใหม่ซ่อนปุ่มสลับโหมด/ซูม (ภาพพอดีจอ) แต่คงปุ่มหยุด · ผังเดิมของ อปท. อื่นยังทำงานเหมือนเดิม
    assert.ok(view.includes('const route = diagram.route ?? null'))
    assert.match(view, /\{!route && <span className="inline-flex overflow-hidden rounded-xl border border-slate-400" role="group" aria-label="โหมดแสดงผัง">/)
    assert.match(view, /\{!route && mode === 'map' && \(\s*<span className="inline-flex gap-2">/)
    assert.ok(view.includes("{route ? <RouteView route={route} badges={badges} diagram={diagram} tenantName={tenantName} now={now} /> : mode === 'map' ?"))
    // แท็บ: แผนภาพ · รายการจุด · ที่มา (หน้ามือถือยาวเกือบ 3,000px — เจ้าของระบบสั่งแบ่งแท็บ 2569-10-21)
    assert.match(view, /role="tablist"/)
    assert.equal((view.match(/role="tabpanel"/g) ?? []).length, 3, 'ต้องมี 3 แผง (แผนภาพ · รายการ · ที่มา)')
    assert.match(view, /key: 'art'[\s\S]*key: 'list'[\s\S]*key: 'source'/, 'ลำดับแท็บ: แผนภาพ → รายการจุด → ที่มา')
    assert.ok(view.includes("{ key: 'list', label: `รายการจุด (${stopCount})`, extra: 'lg:hidden' }"), 'จอกว้างรายการอยู่ข้างภาพแล้ว ไม่ต้องมีแท็บรายการ')
    assert.ok(view.includes("useState('art')"), 'เปิดมาที่แท็บแผนภาพ')
    assert.ok(view.includes("className={tab === 'art' ? 'contents' : 'hidden'}") && view.includes("tab === 'source' ? '' : 'hidden'"), 'แผงที่ไม่ได้เลือกต้อง display:none (ไม่วิ่งแอนิเมชัน ไม่ซ้ำให้โปรแกรมอ่านจอ)')
    assert.ok(view.includes('{!route && <SourceBox diagram={diagram} tenantName={tenantName} />}'), 'ผังเดิมยังแสดงกล่องที่มาท้ายส่วน')
    assert.equal((view.match(/<SourceBox diagram=\{diagram\} tenantName=\{tenantName\} \/>/g) ?? []).length, 2, 'กล่องที่มา: ท้ายผังเดิม + แท็บที่มาของผังที่มี route')
    assert.ok(view.includes("event.key === 'ArrowRight'") && view.includes("'Home', 'End'"), 'ใช้ลูกศรซ้าย/ขวา/Home/End สลับแท็บได้')
    // หัวโปสเตอร์ "เส้นทางน้ำ · ตำบล…" อยู่บนสุดของส่วน ก่อนปุ่มหยุด/คำกำกับบังคับ/แท็บ (เจ้าของระบบสั่ง 2569-10-22: สวยแล้วต้องให้เห็นก่อน)
    assert.ok(view.includes('{route ? <RouteBanner route={route} scope={scope} /> : ('), 'ผังที่มี route ใช้หัวโปสเตอร์')
    assert.ok(view.includes('<h2 id="water-diagram-title" className="text-sm font-bold text-gray-800">{diagram.title}</h2>'), 'ผังเดิมยังใช้หัวเดิม')
    {
      const at = needle => { const i = view.indexOf(needle); assert.ok(i >= 0, 'ไม่พบ ' + needle); return i }
      assert.ok(at('<RouteBanner route={route} scope={scope} />') < at('data-diagram-disclaimer') && at('data-diagram-disclaimer') < at('<RouteView route={route}'),
        'ลำดับต้องเป็น หัวโปสเตอร์ → คำกำกับบังคับ → แท็บ/แผนภาพ')
      const banner = view.slice(at('function RouteBanner'), at('// ── แผนภาพเส้นทางน้ำ (ผังที่มี route)'))
      assert.match(banner, /<h2 id="water-diagram-title"[\s\S]*route\.eyebrow[\s\S]*route\.title/, 'หัวโปสเตอร์คือ h2 ของส่วนนี้')
      const routeView = view.slice(at('function RouteView'), at('function DiagramBody'))
      assert.ok(!/route\.eyebrow|route\.title/.test(routeView), 'ชื่อใหญ่ต้องอยู่ที่หัวโปสเตอร์เท่านั้น ไม่ซ้ำในแผง')
      assert.equal((view.match(/id="water-diagram-title"/g) ?? []).length, 2, 'h2 มี 2 ทางเลือก (โปสเตอร์ · ผังเดิม) เลือกทางเดียวต่อครั้ง')
    }
    assert.ok(view.includes('<b>ไม่ใช่แผนที่</b> ตำแหน่ง ทิศ และมาตราส่วนไม่ตรงจริง'), 'ต้องบอกว่าไม่ใช่แผนที่')
    for (const klass of ['.wr-flow', '.wr-fall', '.wr-wave', '.wr-shim']) {
      assert.ok(css.includes('.wd-root.wd-paused ' + klass), klass + ' ต้องหยุดเมื่อกดปุ่มหยุด')
      assert.ok(css.includes('.wd-root[data-offscreen] ' + klass), klass + ' ต้องหยุดเมื่อนอกจอ/แท็บซ่อน')
    }
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (const klass of ['.wr-flow', '.wr-fall', '.wr-wave', '.wr-shim']) assert.ok(reduce.slice(0, 400).includes(klass), klass + ' ต้องปิดเมื่อลดการเคลื่อนไหว')
    assert.ok(css.includes('stroke-dashoffset: -14') && /strokeDasharray=\{st\.flow \? '3 11'/.test(art), 'ระยะเลื่อน 14 = ความยาวลาย 3 + 11 วนต่อเนื่องไม่กระตุก')
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

// ── ปุ่ม "ดูผังต้นฉบับ" ต้องพาไปที่ไฟล์ภาพของตำบลตัวเองโดยตรง ไม่ใช่หน้ารวมของทั้งจังหวัด ──
// (เจ้าของระบบสั่ง 2569-10-21: กดแล้วเด้งไปหน้ารวมของจังหวัดแพร่ ประชาชนต้องหาผังตำบลเอง)
{
  const PROVINCE_PAGE = 'https://www.phraepao.go.th/officechief/water/map_water_r.php'
  const BASE = 'https://www.phraepao.go.th/officechief/water/upload_diagram_subd/'
  assert.equal(ORIGINAL_FILE_BASE, BASE)
  // ทุกผังมีลิงก์ตรงของตัวเอง และมีครบเท่ากับทะเบียนผัง/ระบบน้ำ (ตำบลใหม่ลืมเพิ่ม = เทสต์แดง ไม่ใช่ตกไปหน้ารวมเงียบๆ)
  assert.deepEqual(Object.keys(ORIGINAL_DIAGRAM_FILES).sort(), Object.keys(DIAGRAMS).sort())
  assert.deepEqual(Object.keys(ORIGINAL_DIAGRAM_FILES).sort(), Object.keys(SYSTEMS).sort())

  // ตรึงคู่ ตำบล ↔ ไฟล์ ที่ตรวจจากหน้ารวม map_water_r.php เมื่อ 2026-10-21 (ป้ายชื่อตำบลตามด้วย popup ของไฟล์นั้น)
  // ทุ่งแค้วกับตำหนักธรรมลงวันที่เดียวกัน (9 พ.ค. 2567) การสลับไฟล์กันจึงจับด้วยวันที่ไม่ได้ ต้องตรึงชื่อไฟล์ไว้
  // เปลี่ยนไฟล์เป็นฉบับใหม่ = แก้ตรงนี้ด้วยมือหลังเปิดหน้ารวมดูแล้วเท่านั้น
  assert.deepEqual(
    Object.fromEntries(Object.entries(ORIGINAL_DIAGRAM_FILES).map(([id, e]) => [id, e.file])),
    {
      thungkaew: '66598230820240509_181654.jpg',
      tamnaktham: '82389834520240509_182321.jpg',
      namlao: '171202098020240430_133004.jpg',
    },
  )

  const seen = new Set()
  for (const [id, entry] of Object.entries(ORIGINAL_DIAGRAM_FILES)) {
    const url = originalDiagramUrl(id, PROVINCE_PAGE)
    assert.equal(url, `${BASE}${entry.file}`, `${id}: ต้องได้ลิงก์ไฟล์ภาพของตำบลนี้`)
    assert.notEqual(url, PROVINCE_PAGE, `${id}: ต้องไม่ใช่หน้ารวมของจังหวัด`)
    assert.ok(!seen.has(entry.file), `${id}: ใช้ไฟล์ซ้ำกับตำบลอื่น`)
    seen.add(entry.file)
    // <เลขสุ่ม><YYYYMMDD>_<HHMMSS>.jpg — วันที่ในชื่อไฟล์ต้องตรงกับวันที่ผังที่เราประกาศบนหน้า
    // (กันเปลี่ยนไฟล์เป็นฉบับใหม่แล้วลืมแก้วันที่ที่บอกประชาชนว่าผังนี้อายุเท่าไร)
    const m = /^\d+(\d{4})(\d{2})(\d{2})_\d{6}\.jpg$/.exec(entry.file)
    assert.ok(m, `${id}: รูปแบบชื่อไฟล์ผิด ${entry.file}`)
    assert.equal(`${m[1]}-${m[2]}-${m[3]}`, entry.date, `${id}: วันที่ในชื่อไฟล์ไม่ตรง date ที่ลงทะเบียน`)
    assert.ok(DIAGRAMS[id].sourceDate.includes(thaiDate(entry.date)), `${id}: sourceDate บนหน้า (${DIAGRAMS[id].sourceDate}) ไม่ตรงวันที่ในชื่อไฟล์ ${thaiDate(entry.date)}`)
    const own = SYSTEMS[id].sources.find(s => s.id === id)
    assert.equal(own?.date, entry.date, `${id}: sources[].date ของส่วนระบบน้ำไม่ตรงวันที่ในชื่อไฟล์`)
  }

  // ตำบลที่ไม่มีไฟล์ลงทะเบียน (รวมคีย์แปลกๆ) ต้องตกไปลิงก์หน้ารวมเท่านั้น ห้ามได้ undefined หรือค่าจาก prototype
  for (const other of ['cmu', '', undefined, null, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(originalDiagramUrl(other, PROVINCE_PAGE), PROVINCE_PAGE, `${String(other)} ต้องใช้ลิงก์สำรอง`)
  }

  // สองหน้าจอที่มีปุ่มนี้ต้องใช้ตัวเลือกลิงก์เดียวกัน ไม่ชี้ sourceUrl/originalUrl ตรงๆ
  const diagramJsx = read('src/components/water/WaterDiagram.jsx')
  const systemJsx = read('src/components/water/WaterSystem.jsx')
  assert.ok(diagramJsx.includes('href={originalDiagramUrl(diagram.id, diagram.sourceUrl)}'), 'WaterDiagram.jsx ต้องลิงก์ผังต้นฉบับผ่าน originalDiagramUrl')
  assert.ok(systemJsx.includes('href={originalDiagramUrl(system.id, system.originalUrl)}'), 'WaterSystem.jsx ต้องลิงก์ผังต้นฉบับผ่าน originalDiagramUrl')
  assert.ok(!/href=\{diagram\.sourceUrl\}/.test(diagramJsx) && !/href=\{system\.originalUrl\}/.test(systemJsx), 'ห้ามกลับไปชี้หน้ารวมตรงๆ')
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
  // แท็บ "เส้นทางน้ำ" บนสุดของหน้า: เกิดเมื่อ อปท. อยู่ในทะเบียนผัง + มีข้อมูลสถานีแล้วเท่านั้น (เงื่อนไขเดียวกับที่เคยแสดงส่วนผัง) · ผังอยู่ในแผงของแท็บนั้น
  assert.match(page, /const tabsOn = Boolean\(diagramTenant\(tenant\?\.slug\)\) && !loading && data !== null && stations\.length > 0/)
  assert.match(page, /\{tabsOn && \(\s*<div id="water-panel-route" role="tabpanel"[\s\S]*?<WaterDiagram /, 'WaterDiagram ต้องอยู่ในแผงแท็บเส้นทางน้ำที่ขึ้นเมื่อ tabsOn')
  assert.equal((page.match(/<WaterDiagram /g) ?? []).length, 1, 'หน้าเรียก WaterDiagram จุดเดียว')
  assert.match(page, /const activeTab = tabsOn \? tab : 'situation'/, 'ไม่มีแท็บ = หน้าเดิม (สถานการณ์เสมอ)')
  assert.match(page, /hidden=\{activeTab !== 'situation'\}/, 'แท็บสถานการณ์ซ่อนด้วย hidden (ยังเมาท์ไว้ ไม่โหลดข้อมูลซ้ำ)')
  assert.match(page, /\{activeTab === 'route' && \(\s*<AlertBanner /, 'แถบแจ้งเตือนต้องขึ้นบนแท็บเส้นทางน้ำด้วย')
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

// ── โปสเตอร์ "ภาพนำเสนอ A4" (poster.js · routes/namlao.poster.js · WaterRoutePoster.jsx) ──
{
  const clone = () => structuredClone(NAMLAO_ROUTE)
  assert.deepEqual(posterIssues(NAMLAO_ROUTE), [], 'ข้อมูลโปสเตอร์น้ำเลาต้องผ่านตัวตรวจ')
  assert.deepEqual(posterIssues({ ...NAMLAO_ROUTE, poster: undefined }), ['route ไม่มี poster'])

  // ตัวเลขบนหัวโปสเตอร์คำนวณจากผัง: 21 จุด (20 + แม่น้ำ) · 4 สายในผัง · 4 โครงสร้างแผนก่อสร้าง (อ่าง 1 + ฝาย 3 · จุดเดียวมีฝาย 2) · 3 ช่องค่าสด
  assert.deepEqual(posterStats(NAMLAO_ROUTE), { points: 21, lanes: 4, planned: 4, gauges: 3 })

  // สัญลักษณ์ตัดสินจาก props ไม่ใช่เลขจุด: แผนก่อสร้าง = ghost เสมอ · อ่างไม่มีข้อมูล = lake na
  const icon = n => posterIcon(NAMLAO_ROUTE.stops.find(stop => stop.n === n))
  assert.deepEqual([2, 5, 7].map(icon), Array(3).fill({ kind: 'plan' }))
  assert.deepEqual(icon(1), { kind: 'creeks', n: 9 })
  assert.deepEqual(icon(8), { kind: 'weir', n: 5 })
  assert.deepEqual(icon(11), { kind: 'lake', na: true })
  assert.deepEqual(icon(14), { kind: 'lake', na: true })
  assert.deepEqual(icon(17), { kind: 'pond', n: 3 })
  assert.deepEqual(icon(20), { kind: 'village' })

  // ลำน้ำ: เส้นวิ่ง/หัวลูกศรต้องตรงกับผังทุกเส้น (ไม่เดาทิศ) · เส้นตกแต่งห้ามวิ่ง
  {
    const bad = clone(); bad.poster.streams.find(x => x.id === 'un').flow = true
    assert.ok(posterIssues(bad).some(t => t.includes('ลำน้ำ un') && t.includes('flow ต้องตรงกับผัง')), 'ทำห้วยลูกศรนิ่งให้วิ่ง ต้องถูกจับ')
    const bad2 = clone(); bad2.poster.streams.find(x => x.id === 'tao').flow = false
    assert.ok(posterIssues(bad2).some(t => t.includes('ลำน้ำ tao')), 'ทำลำที่ผังวาดลูกศรให้นิ่ง ต้องถูกจับ')
    const bad3 = clone(); bad3.poster.streams.find(x => x.id === 'tw0').flow = true
    assert.ok(posterIssues(bad3).some(t => t.includes('เส้นตกแต่งห้ามวิ่ง')), 'เส้นตกแต่งวิ่งไม่ได้')
    const bad4 = clone(); bad4.poster.streams = bad4.poster.streams.filter(x => x.id !== 'hin')
    assert.ok(posterIssues(bad4).some(t => t.includes('ลำน้ำ hin ของผังไม่ปรากฏ')), 'ลำน้ำของผังหายจากโปสเตอร์ ต้องถูกจับ')
    const bad5 = clone(); bad5.poster.streams.push({ id: 'ghostflow', pts: [[100, 100], [200, 200]], flow: true, w: 6 })
    assert.ok(posterIssues(bad5).some(t => t.includes('ghostflow')), 'เส้นแต่งเองที่ไม่ใช่ deco ต้องถูกจับ')
  }
  // โนด/ช่องค่าสด/โซน/การ์ด
  {
    const bad = clone(); delete bad.poster.nodes[9]
    assert.ok(posterIssues(bad).some(t => t.includes('จุด 9: ไม่มีตำแหน่ง')), 'จุดหาย')
    const bad2 = clone(); delete bad2.poster.nodes[14].pill
    assert.ok(posterIssues(bad2).some(t => t.includes('rain-RES040')), 'ช่องค่าสดที่ผังผูกไว้หายจากโปสเตอร์ ต้องถูกจับ')
    const bad3 = clone(); bad3.poster.nodes[4].pill = { slot: 'rain-RES040', x: 10, y: 10 }
    assert.ok(posterIssues(bad3).length > 0, 'ช่องค่าสดไปอยู่ผิดจุด ต้องถูกจับ')
    const bad4 = clone(); delete bad4.poster.nodes[5].stem
    assert.ok(posterIssues(bad4).some(t => t.includes('จุด 5') && t.includes('stem')), 'แผนก่อสร้างต้องมี stem')
    const bad5 = clone(); bad5.poster.zones[0].group = 'สายที่ 9 · ที่ไม่มีในผัง'
    assert.ok(posterIssues(bad5).some(t => t.includes('group ไม่ตรง')), 'โซนต้องตรงกับสายในผัง')
    const bad6 = clone(); bad6.poster.callouts[0].lines[0].names.push('ห้วยที่ไม่มีในผัง')
    assert.ok(posterIssues(bad6).some(t => t.includes('ห้วยที่ไม่มีในผัง')), 'ห้ามเขียนชื่อห้วยที่ผังไม่มี')
    const bad7 = clone(); bad7.poster.nodes[3].x = 5000
    assert.ok(posterIssues(bad7).some(t => t.includes('นอกกรอบ')), 'โนดนอกกรอบ')
  }

  // การ์ดค่าวัดล่าสุด: ข้อความจาก badge เท่านั้น · ค้าง/ไม่มีค่าบอกตรงๆ · หมายเหตุซ้ำกับค่าไม่พิมพ์สองรอบ
  {
    const badges = {
      'dam-305': { tone: 'warn', short: '100%', note: 'ตัวเลขซ้ำเดิม', text: 'x', detail: 'x' },
      'rain-RES040': { tone: 'stale', short: 'ฝน', note: 'ไม่มีค่าใหม่', text: 'x', detail: 'x' },
      'rain-STN0911': { tone: 'ok', short: 'ฝน 12.5 มม.', text: 'x', detail: 'x' },
    }
    const rows = posterLiveRows(NAMLAO_ROUTE, badges)
    assert.deepEqual(rows.map(r => r.slot), ['dam-305', 'rain-RES040', 'rain-STN0911'])
    assert.equal(rows[0].value, '100%'); assert.equal(rows[0].note, 'ตัวเลขซ้ำเดิม')
    assert.equal(rows[1].value, 'ไม่มีค่าใหม่'); assert.equal(rows[1].note, null, 'ค้าง: หมายเหตุซ้ำกับค่า ไม่พิมพ์ซ้ำ')
    assert.equal(rows[2].value, 'ฝน 12.5 มม.')
    assert.deepEqual(posterLiveRows(NAMLAO_ROUTE, {}), [], 'ไม่มี badge = ไม่มีแถว (ไม่เดาเป็น 0)')
  }
  assert.deepEqual(posterOmittedNames({ omitted: ['ชื่อ ก — เหตุผลยาว', 'ชื่อ ข'] }), ['ชื่อ ก', 'ชื่อ ข'])

  // ข้อความบังคับบนโปสเตอร์ + ไม่มีเข็มทิศ
  assert.equal(POSTER_DISCLAIMER.length, 3)
  for (const needed of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'ไม่ใช่แผนที่', 'ทิศ']) assert.ok(POSTER_DISCLAIMER.join(' ').includes(needed), `ข้อความบังคับขาด "${needed}"`)
  assert.deepEqual(POSTER_THEMES, ['dark', 'light'])

  // หน้าพิมพ์ใช้ตัวกลาง govDocStyle: A4 แนวนอน · ขอบแนวนอนของระบบ · ซ่อนหัวท้ายกระดาษด้วย padding · แผ่นเดียว
  {
    const css = posterPrintCss()
    assert.equal(POSTER_PRINT_SIZE, 'A4 landscape')
    assert.ok(css.includes(govPageCss({ size: POSTER_PRINT_SIZE, hideBrowserHeader: true })), 'ต้องใช้ govPageCss ตัวกลาง ไม่เขียน @page เอง')
    assert.ok(css.includes(GOV_PAGE_MARGIN_LANDSCAPE), 'ขอบกระดาษต้องเป็นค่าแนวนอนของระบบ')
    assert.match(css, /html, body \{ background: #fff !important/, 'พื้นหลังหน้าเว็บ (สีธีม อปท.) ต้องไม่ติดไปเป็นแถบสีท้ายกระดาษเมื่อเปิดพิมพ์พื้นหลัง')
    assert.match(css, /@media print/); assert.match(css, /body > \*:not\(\[data-poster-overlay\]\) \{ display: none/, 'พิมพ์เฉพาะโปสเตอร์ ซ่อนหน้าเว็บที่เหลือ')
    assert.match(css, /\[data-poster-toolbar\][^}]*display: none/, 'ปุ่มไม่ติดไปบนกระดาษ')
    assert.match(css, /height: 208mm/, 'กล่องหน้าต้องเตี้ยกว่า 210mm เล็กน้อย ไม่ล้นเป็นแผ่นที่สอง')
    assert.ok(!/@page[^}]*margin: (?!0)/.test(css), 'margin ของ @page ต้องเป็น 0 (ขอบย้ายไปเป็น padding)')
  }

  // ซอร์ส: ไม่เข็มทิศ · ไม่สุ่ม/ไม่ผูกเวลาเครื่อง · ฟอนต์ราชการจากตัวกลาง · หัวลูกศรขนาดคงที่ · ปุ่มขึ้นเฉพาะผังที่มี poster · โหลดแบบ lazy
  {
    const poster = read('src/components/water/WaterRoutePoster.jsx')
    const posterLib = read('src/lib/waterDiagram/poster.js')
    const view = read('src/components/water/WaterDiagram.jsx')
    const code = text => text.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
    assert.ok(!/compass|เข็มทิศ|ทิศเหนือ/i.test(code(poster + posterLib)), 'โปสเตอร์ไม่วาดเข็มทิศ/ทิศเหนือ')
    assert.ok(!/Math\.random|Date\.now/.test(poster + posterLib), 'โปสเตอร์ไม่สุ่ม ไม่อ่านเวลาเครื่องเอง (เวลาข้อมูลมาจาก now ที่หน้าส่งมา)')
    assert.match(poster, /GOV_FONT_STACK/); assert.match(poster, /fontSizeAdjust: String\(GOV_FONT_SIZE_ADJUST\)/, 'font-size-adjust ต้องเป็นสตริง (เลขเปล่า React เขียนเป็น 0.45px แล้วเบราว์เซอร์ทิ้ง)')
    assert.ok(!/font-family:/.test(posterLib.replace(/\/\/.*$/gm, '')), 'ห้ามเขียน font-family ซ้ำใน CSS หน้าพิมพ์ (ใช้ตัวกลาง)')
    assert.match(poster, /markerUnits="userSpaceOnUse"/, 'หัวลูกศรต้องไม่ขยายตามความหนาเส้น')
    assert.match(poster, /markerEnd=\{stream\.flow \? u\('arrow'\) : undefined\}/, 'หัวลูกศรเฉพาะเส้น flow')
    assert.ok(!/id="wpg-|url\(#wpg-/.test(poster), 'id/url ของ defs ต้องผูกกับ useId ของภาพใบนั้น — ภาพอยู่ในหน้า 1 ใบ + ในหน้าต่างพิมพ์ 1 ใบพร้อมกันได้ id ห้ามซ้ำ')
    assert.match(poster, /const uid = useId\(\)\.replace\(\/:\/g, ''\)/, 'ภาพต้องมี uid ของตัวเอง')
    assert.match(poster, /className=\{stream\.flow \? 'wp-flow' : undefined\}/, 'ลายวิ่งเฉพาะเส้น flow')
    assert.match(read('src/components/water/WaterRoutePoster.css'), /@media \(prefers-reduced-motion: reduce\), print/, 'ลายวิ่งหยุดเมื่อลดการเคลื่อนไหวและตอนพิมพ์')
    // น้ำเลา: ภาพนำเสนอแทนภาพเกาะลอยในหน้าเลย (เจ้าของระบบสั่ง 2569-10-23) — ผังที่ไม่มี route.poster ยังใช้ภาพเกาะลอยเดิม
    assert.match(view, /const WaterRoutePosterPanel = lazy\(\(\) => import\('\.\/WaterRoutePoster'\)\)/, 'ภาพนำเสนอโหลดแบบ lazy (เฉพาะผังที่มี poster)')
    assert.ok(view.includes('const hasPoster = Boolean(route.poster)'), 'ใช้ภาพนำเสนอเฉพาะผังที่มี route.poster')
    assert.match(view, /\{hasPoster \? \(\s*<Suspense fallback=\{[\s\S]*?\}>\s*<WaterRoutePosterPanel route=\{route\} diagram=\{diagram\} badges=\{badges\} now=\{now\} \/>\s*<\/Suspense>\s*\) : \(\s*<>\s*<div[^>]*><WaterRouteArt /, 'ผังที่มี poster แสดงภาพนำเสนอแทน WaterRouteArt · ผังอื่นยังใช้ภาพเกาะลอย')
    assert.ok(!/setPosterOpen|posterOpen|Presentation/.test(view), 'ปุ่มเปิดภาพนำเสนอย้ายเข้าไปอยู่เหนือภาพ (ในคอมโพเนนต์ภาพ) ไม่ใช่แถวปุ่มบนสุดของส่วนอีกแล้ว')
    assert.match(poster, /export default function WaterRoutePosterPanel\(/, 'ส่งออก default เป็นภาพในหน้า (WaterDiagram โหลดจุดเดียว)')
    assert.match(poster, /\{open && <WaterRoutePosterDialog /, 'หน้าต่างพิมพ์เปิดเฉพาะเมื่อกดปุ่ม')
    assert.match(poster, /<button type="button"[\s\S]*?data-poster-open>/, 'ปุ่มพิมพ์/บันทึก PDF อยู่เหนือภาพ')
    assert.match(poster, /role="region"[^>]*tabIndex=\{0\}/, 'กรอบภาพที่เลื่อนแนวนอนได้ต้องโฟกัสด้วยคีย์บอร์ดได้')
    const diagramCss = read('src/components/water/WaterDiagram.css')
    assert.ok(diagramCss.includes('.wd-root.wd-paused .wp-flow') && diagramCss.includes('.wd-root[data-offscreen] .wp-flow'), 'ปุ่มหยุดเคลื่อนไหวและตัวหยุดตอนนอกจอต้องหยุดลายวิ่งของภาพนำเสนอด้วย')
    assert.ok(!read('src/lib/waterDiagram/routes/tamnaktham.js').includes('poster:') && !read('src/lib/waterDiagram/routes/thungkaew.js').includes('poster:'), 'ตำหนักธรรม/ทุ่งแค้วยังไม่มีโปสเตอร์ (ทำเฉพาะน้ำเลาก่อน)')
    assert.match(read('src/lib/waterDiagram/routes/namlao.js'), /poster: NAMLAO_POSTER,/)
  }

  // ═══ แผ่นรายการจุด A4 (listSheet.js) ═══
  // บีบรายการเป็นคอลัมน์: ช่วงติดกัน ครอบคลุมทุกหน่วยครั้งเดียว และหนักสุดเบาสุดเท่าที่แบ่งได้ (เทียบกับวิธีไล่ทุกรอยตัด)
  {
    const bruteMax = (weights, k) => {
      const n = weights.length
      let best = Infinity
      const go = (from, left, curMax) => {
        if (left === 1) { best = Math.min(best, Math.max(curMax, weights.slice(from).reduce((a, b) => a + b, 0))); return }
        for (let cut = from + 1; cut <= n - (left - 1); cut++) go(cut, left - 1, Math.max(curMax, weights.slice(from, cut).reduce((a, b) => a + b, 0)))
      }
      go(0, k, 0)
      return best
    }
    let seed = 7
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (let round = 0; round < 60; round++) {
      const n = 3 + Math.floor(rand() * 7)
      const weights = Array.from({ length: n }, () => 1 + Math.floor(rand() * 12))
      const ranges = balanceRanges(weights, 3)
      assert.equal(ranges.length, 3)
      assert.equal(ranges[0][0], 0); assert.equal(ranges[2][1], n)
      for (let i = 1; i < 3; i++) assert.equal(ranges[i][0], ranges[i - 1][1], 'ช่วงต้องติดกัน ไม่ซ้อน ไม่เว้น')
      for (const [from, to] of ranges) assert.ok(to > from, 'ทุกคอลัมน์ต้องมีอย่างน้อย 1 หน่วยเมื่อหน่วย ≥ คอลัมน์')
      const heaviest = Math.max(...ranges.map(([from, to]) => weights.slice(from, to).reduce((a, b) => a + b, 0)))
      assert.equal(heaviest, bruteMax(weights, 3), `น้ำหนักที่หนักสุดต้องเบาที่สุดเท่าที่เป็นไปได้ (${weights})`)
    }
    assert.deepEqual(balanceRanges([5, 5], 3), [[0, 1], [1, 2], [2, 2]], 'หน่วยน้อยกว่าคอลัมน์ = คอลัมน์ท้ายว่าง')
    assert.deepEqual(balanceRanges([], 3), [[0, 0], [0, 0], [0, 0]])
  }

  // น้ำเลา: คอลัมน์ละสายตามผัง (1–8 | 9–15 | 16–21) ไม่ฉีกกลุ่ม หัวข้อกลุ่มตามหลังกลุ่มเดิม · ครบทุกจุดครั้งเดียวตามลำดับ
  {
    const badges = {
      'dam-305': { tone: 'warn', detail: 'อ่างเก็บน้ำแม่คำปอง ห่าง 3.6 กม. · 100.4% มากกว่า 100% = เกินความจุที่ระดับเก็บกักปกติ · ตัวเลขชุดนี้ซ้ำเดิมทุกวันมา 8 วัน ตั้งแต่ 16 ต.ค. — ต้นทางอาจยังไม่ได้ปรับข้อมูล ใช้ตัวเลขนี้อย่างระมัดระวัง' },
      'rain-RES040': { tone: 'ok', detail: 'ฝนสะสม 24 ชม. 0 มม. · ไม่มีฝน · สถานีอ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนา ห่าง 2.9 กม. · วัดเมื่อ 19:22 น.' },
      'rain-STN0911': { tone: 'ok', detail: 'ฝนสะสม 24 ชม. 12.5 มม. · ฝนปานกลาง · สถานีบ้านบุญแจ่ม ห่าง 2.6 กม. · วัดเมื่อ 19:22 น.' },
    }
    const cols = listColumns(NAMLAO_ROUTE, badges)
    assert.equal(cols.length, LIST_SHEET_COLUMNS)
    const numbers = col => col.units.flatMap(unit => unit.items.map(item => item.n))
    assert.deepEqual(cols.map(numbers), [[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15], [16, 17, 18, 19, 20, 21]], 'คอลัมน์ละสาย/กลุ่มสายที่ติดกัน')
    assert.deepEqual(cols.flatMap(numbers), Array.from({ length: 21 }, (_, i) => i + 1), 'ทุกจุดครั้งเดียว เรียงตามหมายเลข')
    assert.deepEqual(cols.map(col => col.units.map(unit => unit.heading)), [
      [NAMLAO_ROUTE.stops[0].group], [NAMLAO_ROUTE.stops[8].group, NAMLAO_ROUTE.stops[10].group],
      [NAMLAO_ROUTE.stops[15].group, NAMLAO_ROUTE.stops[19].group, NAMLAO_ROUTE.river.group],
    ], 'หัวข้อกลุ่มขึ้นหนึ่งครั้งต่อกลุ่ม อยู่คอลัมน์เดียวกับจุดแรกของกลุ่ม')
    const weights = cols.map(col => col.weight)
    assert.ok(Math.max(...weights) <= Math.min(...weights) * 1.35, `คอลัมน์ต้องสูงใกล้กัน (${weights.map(w => w.toFixed(1))})`)
    // ข้อความค่าสดยาวทำให้น้ำหนักคอลัมน์ของจุดนั้นเพิ่ม (ไม่ใช่ตัวเลขตายตัวต่อจุด)
    assert.ok(listItemWeight(NAMLAO_ROUTE.stops[2], badges) > listItemWeight(NAMLAO_ROUTE.stops[2], {}) + 2, 'ค่าสดยาวต้องถ่วงน้ำหนัก')
    // ผังไม่มีกลุ่ม/มีกลุ่มเดียว: แบ่งทีละจุดให้ใช้ 3 คอลัมน์ได้ (หัวข้อขึ้นที่จุดแรกเท่านั้น)
    const flat = { ...NAMLAO_ROUTE, stops: NAMLAO_ROUTE.stops.map(({ group, ...rest }) => rest), river: (({ group, ...rest }) => rest)(NAMLAO_ROUTE.river) }
    const flatCols = listColumns(flat, {})
    assert.ok(flatCols.every(col => col.units.length > 0), 'ผังไม่มีกลุ่ม: ยังกระจายเป็น 3 คอลัมน์')
    assert.deepEqual(flatCols.flatMap(numbers), Array.from({ length: 21 }, (_, i) => i + 1))
    assert.ok(flatCols.every(col => col.units.every(unit => unit.heading === null)), 'ผังไม่มีกลุ่ม = ไม่มีหัวข้อ')
    const two = { ...NAMLAO_ROUTE, stops: NAMLAO_ROUTE.stops.map(stop => ({ ...stop, group: stop.n <= 10 ? 'ก' : 'ข' })), river: { ...NAMLAO_ROUTE.river, group: 'ข' } }
    const twoCols = listColumns(two, {})
    assert.deepEqual(twoCols.flatMap(col => col.units.filter(unit => unit.heading).map(unit => unit.heading)), ['ก', 'ข'], 'กลุ่มน้อยกว่าคอลัมน์: หัวข้อกลุ่มขึ้นที่จุดแรกของกลุ่มเท่านั้น')
  }

  // ขนาดแผ่นตรงกับพื้นที่พิมพ์จริงของใบพิมพ์ (กล่องหน้า 208 มม. − ขอบบน 3 ซม. − ขอบล่าง 1 ซม. · กว้าง 297 − 2 × 2 ซม.)
  {
    const [top, side, bottom] = GOV_PAGE_MARGIN_LANDSCAPE.split(' ').map(value => Number.parseFloat(value) * 10)
    assert.deepEqual(LIST_SHEET_MM, { w: 297 - 2 * side, h: 208 - top - bottom }, 'LIST_SHEET_MM ต้องเท่าพื้นที่พิมพ์ที่ posterPrintCss ให้')
    const css = posterPrintCss()
    assert.match(css, /\[data-poster-sheet\]:not\(\[data-poster-sheet-list\]\) \{ break-after: page; \}/, 'แผ่นที่ 1 ขึ้นหน้าใหม่ก่อนแผ่นรายการ')
    assert.match(css, /\[data-poster-label\][^}]*display: none/, 'ป้าย "แผ่นที่ N" ไม่ติดไปบนกระดาษ')
    assert.match(css, /\[data-poster-page\] \{ width: auto !important; min-width: 0 !important; max-width: none !important; margin: 0 !important; \}/, 'กรอบหน้าบนจอ (กลางหน้า กว้างขั้นต่ำ 900px) ไม่ติดไปบนกระดาษ')
  }

  // ซอร์สของแผ่นรายการ: ขนาดตัวอักษรเป็น cqw ทั้งหมด (ไม่มี px/pt ตายตัว) · สัดส่วนจาก LIST_SHEET_MM · ฟอนต์ราชการ · ข้อความบังคับท้ายแผ่น · ไม่แตะฐานข้อมูล
  {
    const sheetSrc = read('src/components/water/WaterRouteListSheet.jsx')
    const sheetCss = read('src/components/water/WaterRouteListSheet.css')
    const view = read('src/components/water/WaterDiagram.jsx')
    const poster = read('src/components/water/WaterRoutePoster.jsx')
    const cssCode = sheetCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const sizes = [...cssCode.matchAll(/font-size:\s*([^;}]+)/g)].map(match => match[1].trim())
    assert.ok(sizes.length >= 8, 'ต้องมีขนาดตัวอักษรหลายระดับ')
    assert.deepEqual(sizes.filter(size => !/^[\d.]+cqw$/.test(size)), [], 'ขนาดตัวอักษรของแผ่นต้องเป็น cqw ทั้งหมด (ย่อ/ขยายตามความกว้างแผ่น เห็นบนจอเหมือนที่พิมพ์)')
    assert.match(cssCode, /container-type:\s*inline-size/, 'cqw ต้องอ้างความกว้างของแผ่น ไม่ใช่ของหน้าจอ')
    assert.match(cssCode, new RegExp(`aspect-ratio:\\s*${LIST_SHEET_MM.w}\\s*/\\s*${LIST_SHEET_MM.h}`), 'สัดส่วนแผ่นต้องเท่า LIST_SHEET_MM')
    assert.match(cssCode, /\.wl-live[^}]*border-radius:\s*0\.6cqw/, 'ค่าสดหลายบรรทัดเป็นกล่องมุมมน ไม่ใช่แคปซูล')
    assert.match(sheetSrc, /listColumns\(route, badges\)/); assert.match(sheetSrc, /GOV_FONT_STACK/)
    assert.match(sheetSrc, /fontSizeAdjust: String\(GOV_FONT_SIZE_ADJUST\)/, 'font-size-adjust ต้องเป็นสตริง')
    assert.ok(sheetSrc.includes('POSTER_DISCLAIMER[0]') && sheetSrc.includes('POSTER_DISCLAIMER[2]') && sheetSrc.includes('posterDateTime(now)'), 'ท้ายแผ่นต้องมีคำกำกับบังคับ + เวลาข้อมูลสด')
    assert.ok(sheetSrc.includes('data-route-list') && sheetSrc.includes('data-group') && sheetSrc.includes('role="presentation"') && sheetSrc.includes('data-stop={item.n}'), 'โครงรายการเดิม (เทสต์/โปรแกรมอ่านจอใช้)')
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|Math\.random|Date\.now/.test(sheetSrc), 'แผ่นวาดเหมือนเดิมทุกครั้ง ไม่สุ่ม ไม่ผูกเวลาเครื่อง')
    assert.ok(!/from ['"][^'"]*supabase[^'"]*['"]/.test(sheetSrc) && !/\.rpc\(|supabase\.from\(/.test(sheetSrc), 'แผ่นรายการไม่เรียกฐานข้อมูลเอง')
    // หน้าเว็บ: จอ ≥ 1024px ของผังที่มีโปสเตอร์ใช้แผ่น · นอกนั้นรายการเดิม · โหลดแบบ lazy
    assert.match(view, /const WaterRouteListSheet = lazy\(\(\) => import\('\.\/WaterRouteListSheet'\)\)/, 'แผ่นรายการโหลดแบบ lazy')
    assert.match(view, /\{hasPoster && wide \? \(\s*<Suspense fallback=\{<WaterRouteList route=\{route\} badges=\{badges\} \/>\}>\s*<WaterRouteListSheet route=\{route\} diagram=\{diagram\} badges=\{badges\} now=\{now\} \/>/, 'แผ่นเฉพาะผังที่มีโปสเตอร์บนจอกว้าง · ระหว่างโหลดใช้รายการเดิม')
    assert.ok(view.includes("const WIDE_QUERY = '(min-width: 1024px)'") && view.includes('setWide(query.matches)'), 'ย่อ/ขยายจอแล้วสลับแผ่น/รายการเดิมตามขอบเขต 1024px')
    assert.ok(!/wide=\{hasPoster\}/.test(view) && !read('src/components/water/WaterRouteList.jsx').includes('wide'), 'โหมด wide เดิมของรายการถูกถอด (แผ่นรายการแทนแล้ว)')
    assert.ok(!read('src/components/water/WaterDiagram.css').includes('wr-list--wide'), 'CSS ของโหมด wide เดิมต้องไม่เหลือ')
    // หน้าต่างพิมพ์: 2 แผ่น (โปสเตอร์ + รายการจุด) แผ่นรายการสว่างเสมอ
    assert.match(poster, /<section data-poster-page className="wp-page" aria-label="แผ่นที่ 1 ภาพนำเสนอ">/)
    assert.match(poster, /<div data-poster-sheet data-poster-sheet-list className="wp-sheet">\s*<WaterRouteListSheet route=\{route\} diagram=\{diagram\} badges=\{badges\} now=\{now\} \/>/, 'แผ่นที่ 2 ของใบพิมพ์คือแผ่นรายการ')
  }
}

console.log('✅ water-diagram: ผ่านทุกข้อ')
