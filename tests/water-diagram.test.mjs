// ผังน้ำเคลื่อนไหว — ตรรกะ + ความสอดคล้องของข้อมูลผัง + ข้อความบังคับ (src/lib/waterDiagram/*, WaterDiagram.jsx/css)
// จุดที่ต้องไม่พลาด: (1) โครงสร้างที่ผังระบุชำรุด/แผนก่อสร้าง/ไม่ระบุทิศ ห้ามวิ่ง (2) ค่าว่าง/ค้างห้ามกลายเป็นตัวเลขหรือ "ปกติ"
// (3) ชื่อห้วยที่ยังไม่ยืนยันกับ อบต. ห้ามโผล่ (4) คำกำกับว่าไม่ใช่น้ำไหลจริงห้ามหาย (5) รายการสายน้ำกับผังต้องอ้างของที่มีจริง
// รันด้วย: node tests/water-diagram.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SMALL_RESERVOIRS } from '../src/lib/smallReservoirs.js'
import {
  DIAGRAM_STATUSES, EDGE_STYLES, WATER_DIAGRAM_TENANTS, chipWidth, diagramTenant, isAnimated, isShimmer, liveBadges,
} from '../src/lib/waterDiagram/model.js'
import { THUNGKAEW_BINDS, THUNGKAEW_DIAGRAM, THUNGKAEW_LANES } from '../src/lib/waterDiagram/thungkaew.js'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const { elements, viewBox } = THUNGKAEW_DIAGRAM

// ── ทะเบียน อปท. ──
{
  assert.deepEqual(Object.keys(WATER_DIAGRAM_TENANTS).sort(), ['demo', 'thungkaew'])
  assert.ok(diagramTenant('thungkaew'))
  assert.equal(diagramTenant('thungkaew').scope, '')
  assert.equal(diagramTenant('demo').scope, 'ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต', 'demo ต้องบอกว่าเป็นข้อมูลของทุ่งแค้ว')
  for (const other of ['namlao', 'tamnaktham', '', undefined, null, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(diagramTenant(other), null, `${other} ต้องไม่เห็นผัง`)
  }
  // อ่างเล็กที่ผังใช้ต้องอยู่ใน อปท. กลุ่มเดียวกับการ์ด PR1 (ไม่งั้นผังแสดงค่าอ่างที่การ์ดด้านบนไม่แสดง)
  const smallTenants = read('src/lib/smallReservoirs.js').match(/SMALL_RESERVOIR_TENANTS = \{[\s\S]*?\n\}/)[0]
  for (const slug of Object.keys(WATER_DIAGRAM_TENANTS)) assert.ok(smallTenants.includes(`${slug}:`), `${slug} ต้องอยู่ใน SMALL_RESERVOIR_TENANTS ด้วย`)
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

// ── ข้อมูลผัง: id ไม่ซ้ำ · ชนิดรู้จัก · พิกัดอยู่ในกรอบ ──
const KINDS = new Set(['frame', 'text', 'edge', 'weir', 'reservoir', 'pond', 'gate', 'supply', 'pump', 'house', 'school', 'repair', 'planBox', 'chip', 'slot', 'catch'])
const inBox = (x, y, label) => {
  assert.ok(Number.isFinite(x) && Number.isFinite(y), `${label}: พิกัดไม่ใช่ตัวเลข`)
  assert.ok(x >= 0 && x <= viewBox.w && y >= 0 && y <= viewBox.h, `${label}: (${x}, ${y}) อยู่นอกกรอบ ${viewBox.w}×${viewBox.h}`)
}
// edge ใช้เฉพาะคำสั่งสัมบูรณ์ M / L / H
function pathPoints(d) {
  const tokens = d.trim().split(/[\s,]+/)
  const points = []
  let last = [0, 0]
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]
    const match = /^([MLH])(.*)$/.exec(token)
    assert.ok(match, `path "${d}": อ่านคำสั่งไม่ได้ที่ "${token}"`)
    const [, cmd, rest] = match
    const nums = []
    if (rest !== '') nums.push(Number(rest))
    i += 1
    const need = cmd === 'H' ? 1 : 2
    while (nums.length < need) nums.push(Number(tokens[i++]))
    last = cmd === 'H' ? [nums[0], last[1]] : [nums[0], nums[1]]
    points.push(last)
  }
  return points
}
{
  const ids = elements.filter(el => el.id).map(el => el.id)
  assert.equal(new Set(ids).size, ids.length, `id ซ้ำ: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`)
  elements.forEach((el, index) => {
    assert.ok(KINDS.has(el.kind), `element #${index}: ชนิด ${el.kind} ไม่รู้จัก`)
    const label = `${el.kind}${el.id ? `#${el.id}` : ` [${index}]`}`
    if (el.kind === 'edge') {
      assert.ok(EDGE_STYLES[el.cls], `${label}: cls ${el.cls} ไม่รู้จัก`)
      assert.ok(DIAGRAM_STATUSES.includes(el.status), `${label}: status ${el.status}`)
      for (const [x, y] of pathPoints(el.d)) inBox(x, y, label)
    } else if (el.x !== undefined) {
      inBox(el.x, el.y, label)
      if (el.w !== undefined && el.h !== undefined && el.kind !== 'weir') inBox(el.x + el.w, el.y + el.h, `${label} (มุมล่างขวา)`)
    }
  })
  // นับของสำคัญตามผังต้นฉบับ — ข้อมูลหายไปครึ่งหนึ่งต้องไม่ผ่านเงียบๆ (ผังหลักมีอ่าง 3 · หนอง 3 · ประปา 2 · ชำรุด 2 · สถานีสูบ 2)
  const count = kind => elements.filter(el => el.kind === kind).length
  assert.ok(count('edge') >= 50, `เส้น ${count('edge')} < 50`)
  assert.ok(count('weir') >= 25 && count('text') >= 55, `ฝาย ${count('weir')} / ป้าย ${count('text')} น้อยเกินไป`)
  for (const [kind, n] of [['reservoir', 3], ['pond', 3], ['supply', 2], ['repair', 2], ['pump', 2], ['gate', 1], ['slot', 4]]) assert.equal(count(kind), n, `${kind} ต้องมี ${n}`)
}

// ── กฎการวิ่ง ──
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

  // กับข้อมูลจริง: ของที่ผังระบุชำรุด/แผนก่อสร้าง/ไม่ระบุทิศ ไม่มีเส้นวิ่งเลย
  for (const el of elements) {
    if (['repair', 'planned', 'unknown'].includes(el.status)) assert.equal(isAnimated(el), false, `${el.id ?? el.kind}: ${el.status} ห้ามวิ่ง`)
    if (el.kind === 'pump' || el.kind === 'planBox') assert.equal(el.status, 'planned', `${el.id}: ต้องเป็นแผนก่อสร้าง`)
    if (el.kind === 'repair') assert.equal(el.status, 'repair')
    if (el.kind === 'edge' && el.cls === 'plan') assert.equal(el.status, 'planned', `${el.id}: เส้นแดงต้องเป็นแผนก่อสร้าง`)
  }
  const canal = elements.find(el => el.id === 'canal-right')
  assert.equal(canal.cls, 'canal', 'คลองสองทิศ ไม่ระบุทิศ ต้องไม่วิ่ง')
  assert.equal(isAnimated(canal), false)
  const animated = elements.filter(isAnimated)
  assert.ok(animated.length >= 15 && animated.length <= 30, `เส้นวิ่ง ${animated.length} เส้น — เกินช่วงที่ตั้งใจ (มือถือรุ่นเก่าหน่วง)`)
  // เส้นแรกของห้วย 4 เส้นถูกตัดที่รางส่งน้ำชำรุด: ช่วงที่ชำรุดต้องไม่มีเส้นวิ่งผ่าน
  const repair = elements.find(el => el.id === 'repair-canal')
  for (const el of animated.filter(e => e.id?.startsWith('creek4-a'))) {
    for (const [x, y] of pathPoints(el.d)) assert.ok(!(x >= repair.x && x <= repair.x + repair.w && y > repair.y && y < repair.y + repair.h), `${el.id}: เส้นวิ่งผ่านกลางรางส่งน้ำชำรุด`)
  }
}

// ── ช่องค่าสด · สายน้ำ · แหล่งค่า ──
{
  const slots = elements.filter(el => el.kind === 'slot').map(el => el.id).sort()
  assert.deepEqual(slots, Object.keys(THUNGKAEW_BINDS).sort(), 'ช่องบนผังกับ bind ต้องตรงกัน')
  assert.equal(THUNGKAEW_DIAGRAM.binds, THUNGKAEW_BINDS)
  assert.equal(THUNGKAEW_DIAGRAM.lanes, THUNGKAEW_LANES)

  for (const [slot, bind] of Object.entries(THUNGKAEW_BINDS)) {
    if (bind.type === 'small-dam') assert.ok(Object.hasOwn(SMALL_RESERVOIRS, bind.id), `${slot}: อ่าง ${bind.id} ไม่อยู่ใน SMALL_RESERVOIRS`)
    else assert.ok(bind.code, `${slot}: ต้องมีรหัสสถานี`)
  }
  // รหัสสถานีต้องตรงกับที่ seed ให้ทุ่งแค้วจริง (ไม่งั้นป้ายขึ้น "ไม่มีค่าในระบบ" ตลอดโดยไม่มีใครรู้)
  const seed = read('supabase/migrations/20260918160000_water_situation_seed_tenants.sql')
  assert.match(seed, /\('thungkaew', 'rain', 'RES038'/, 'ทุ่งแค้วต้องมีสถานีฝน RES038')
  assert.match(seed, /\('thungkaew', 'waterlevel', 'YOM003'/, 'ทุ่งแค้วต้องมีสถานีระดับน้ำ YOM003')

  const ids = new Set(elements.filter(el => el.id).map(el => el.id))
  const laneIds = THUNGKAEW_LANES.map(lane => lane.id)
  assert.equal(new Set(laneIds).size, laneIds.length)
  for (const lane of THUNGKAEW_LANES) {
    assert.ok(lane.title && lane.items.length > 0, `${lane.id}: ต้องมีชื่อและรายการ`)
    lane.items.forEach(item => {
      assert.ok(item.name, `${lane.id}: รายการไม่มีชื่อ`)
      for (const ref of item.refs ?? []) assert.ok(ids.has(ref), `${lane.id} / ${item.name}: อ้าง ${ref} ที่ไม่มีบนผัง`)
      for (const slot of item.live ?? []) assert.ok(slots.includes(slot), `${lane.id} / ${item.name}: ช่องค่าสด ${slot} ไม่มี`)
      for (const tag of item.tags ?? []) assert.ok(['na', 'plan', 'fix'].includes(tag.k), `${item.name}: ชนิดแท็ก ${tag.k}`)
      // รายการที่อ้างของแผนก่อสร้าง/ชำรุด ต้องบอกสถานะเดียวกับบนผัง (ไม่ให้รายการเขียนเหมือนใช้งานได้ปกติ)
      const states = new Set((item.refs ?? []).map(ref => elements.find(el => el.id === ref)?.status).filter(s => s && s !== 'existing'))
      for (const state of states) assert.equal(item.status, state, `${item.name}: ผังระบุ ${state} แต่รายการไม่บอก`)
    })
  }
  // ทุกค่าสดต้องไปโผล่ในรายการสายน้ำด้วย (โหมดข้อความต้องไม่ขาดข้อมูลเทียบกับผังภาพ)
  const liveInLanes = new Set(THUNGKAEW_LANES.flatMap(lane => lane.items.flatMap(item => item.live ?? [])))
  assert.deepEqual([...liveInLanes].sort(), slots, 'ค่าสดบนผังทุกช่องต้องอยู่ในรายการสายน้ำ')
}

// ── ชื่อที่ยังไม่ยืนยันกับ อบต. ต้องไม่โผล่ (ห้ามเดาชื่อ) ──
{
  const UNCONFIRMED = ['ห้วยจำค่า', 'ห้วยย่าเฟย']
  const allText = [
    ...elements.filter(el => el.kind === 'text' || el.kind === 'chip').map(el => el.t),
    ...THUNGKAEW_LANES.flatMap(lane => [lane.title, ...lane.items.flatMap(item => [item.name, item.sub ?? '', ...(item.tags ?? []).map(tag => tag.t)])]),
  ]
  for (const name of UNCONFIRMED) assert.ok(!allText.some(text => text.includes(name)), `"${name}" ยังไม่ยืนยันกับ อบต. ห้ามขึ้นหน้า`)
  assert.ok(!allText.includes('ห้วยจำ'), 'ป้าย "ห้วยจำ" (เส้นที่ 4) ยังไม่ยืนยัน')
  assert.ok(allText.some(text => text.includes('ห้วย 4 เส้น')), 'ต้องบอกว่ามีห้วย 4 เส้นแต่ชื่อไม่ชัด')
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
  for (const required of ['ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง', 'จะไม่เคลื่อนไหว', 'วาดใหม่ ไม่ได้คัดลอกภาพ', 'ไม่ใช่ประกาศเตือนภัย', 'ดูผังต้นฉบับ', 'data-diagram-disclaimer']) {
    assert.ok(jsx.includes(required), `WaterDiagram.jsx ต้องมี "${required}"`)
  }
  // ตรวจที่ import/การเรียกจริง ไม่ใช่คำในคอมเมนต์ — ผังไม่ผูกกับ Supabase/auth (NOTES §7)
  for (const [name, source] of [['WaterDiagram.jsx', jsx], ['model.js', read('src/lib/waterDiagram/model.js')], ['thungkaew.js', read('src/lib/waterDiagram/thungkaew.js')]]) {
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
  // hook ของอ่างเล็กใช้ร่วมกับการ์ด PR1 จากไฟล์เดียว ไม่ซ้ำ
  assert.match(read('src/components/water/SmallReservoirSection.jsx'), /import \{ useReservoirReport \} from '\.\/useReservoirReport'/)
  assert.match(jsx, /import \{ useReservoirReport \} from '\.\/useReservoirReport'/)
}

console.log('✅ water-diagram: ผ่านทุกข้อ')
