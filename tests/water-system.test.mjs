// ระบบน้ำของตำบล (ฤดูแล้ง เฟส 5 · PR 5.2 น้ำเลา + PR 5.3 ตำหนักธรรม/ทุ่งแค้ว) — ตรรกะ + ความสอดคล้องของทะเบียน + ข้อความบังคับ + ล็อกว่าไม่เพิ่มงานเจ้าหน้าที่
// ดีไซน์ฉบับปิด: docs/water-system.md · รันด้วย: node tests/water-system.test.mjs
// 2569-10-24 เจ้าของระบบสั่งจัดระเบียบ 2 แท็บ: ส่วน "ระบบน้ำของตำบล" ท้ายแท็บสถานการณ์ถูกรวมเข้าแท็บ "ผังน้ำตำบล" — เหลือ "ก่อนถึงตำบล/ไหลต่อไปที่" ใต้ภาพ
//   (WaterDiagramEdges.jsx) ขั้น "ในตำบล" ตัดออก (ซ้ำกับภาพ) · คำกำกับ/อายุผัง/ที่มาไปรวมกับของผังน้ำตำบล · ป้ายความสัมพันธ์บนการ์ดอ่าง/ระดับน้ำยังอยู่แท็บสถานการณ์ · ข้อมูล inside ยังเก็บในทะเบียน (ไม่แสดง)
//
// จุดที่ต้องไม่พลาด:
//  (1) อปท. ที่ไม่มีระบบไม่เห็นหัวข้อนี้ · ?system= ใช้ได้เฉพาะ demo · ตำหนักธรรม/ทุ่งแค้วเห็นระบบของตัวเอง ไม่เห็นของน้ำเลา
//  (2) ทะเบียน: ทุกโหนดมีที่มา · id ไม่ซ้ำ · ความสัมพันธ์ของอ่าง/สถานีครบ ตรงกับโหนด · ไม่มีความจุจากผัง · ไม่มีคำต้องห้าม
//  (3) การ์ดแนวโน้มอ่างกับกล่อง "ผังต้นฉบับมี แต่เราไม่ได้ใส่" ถูกตัดออกจากหน้า (เจ้าของระบบสั่ง 2026-10-19) — ล็อกไม่ให้กลับมา · ข้อมูล omitted ยังอยู่ในทะเบียนให้ อบต. ยืนยัน
//  (4) อายุผังคำนวณเอง (30 เดือน ไม่ใช่ 17) · แถบเหลืองที่ 36 เดือน
//  (5) ไม่มีช่องกรอก/ฟอร์มในส่วนนี้ · ปุ่มมีแค่ย่อ/ขยายรายการ
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  NODE_KINDS, NODE_ROLES, NODE_STATUSES, NO_LIVE_TEXT, RELATIONS, RELATION_KEYS, STALE_DIAGRAM_MONTHS, SYSTEMS, SYSTEM_DISCLAIMER,
  SYSTEM_DISCLAIMER_LINE, SYSTEM_PREVIEW_SCOPES, UPSTREAM_DEPTH_NOTE, WATER_SYSTEM_TENANTS,
  ageText, diagramAge, liveState, monthsBetween, relationOf, resolveSystem, systemById, systemCountsText,
  systemTenant, thaiDate,
} from '../src/lib/waterSystem/model.js'
import { NAMLAO_SYSTEM } from '../src/lib/waterSystem/namlao.js'
import { TAMNAKTHAM_SYSTEM } from '../src/lib/waterSystem/tamnaktham.js'
import { THUNGKAEW_SYSTEM } from '../src/lib/waterSystem/thungkaew.js'
import { NAMLAO_DIAGRAM } from '../src/lib/waterDiagram/namlao.js'
import { TAMNAKTHAM_DIAGRAM } from '../src/lib/waterDiagram/tamnaktham.js'
import { THUNGKAEW_DIAGRAM } from '../src/lib/waterDiagram/thungkaew.js'
import { SMALL_RESERVOIRS } from '../src/lib/smallReservoirs.js'
import { diagramById } from '../src/lib/waterDiagram/diagrams.js'
import { resolveDiagram } from '../src/lib/waterDiagram/model.js'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ── 1) ใครเห็นระบบ ──
{
  assert.deepEqual(Object.keys(WATER_SYSTEM_TENANTS).sort(), ['demo', 'namlao', 'tamnaktham', 'thungkaew'])
  assert.deepEqual(Object.keys(SYSTEMS), ['namlao', 'tamnaktham', 'thungkaew'])
  assert.equal(systemTenant('namlao').scope, '')
  assert.equal(systemTenant('tamnaktham').scope, ''); assert.equal(systemTenant('thungkaew').scope, '')
  assert.equal(systemTenant('demo').scope, 'ข้อมูลจริงของน้ำเลา ใช้สาธิต', 'demo ต้องบอกว่าเป็นข้อมูลจริงของน้ำเลา')
  for (const other of ['cmu', '', undefined, null, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(systemTenant(other), null, `${other} ต้องไม่เห็นระบบน้ำ`)
    assert.equal(resolveSystem(other, 'namlao'), null, `${other} ต้องไม่เห็นแม้ใส่ ?system=`)
  }
  assert.deepEqual(resolveSystem('namlao'), { system: 'namlao', scope: '' })
  assert.deepEqual(resolveSystem('tamnaktham'), { system: 'tamnaktham', scope: '' }, 'ตำหนักธรรมเห็นระบบของตัวเอง')
  assert.deepEqual(resolveSystem('thungkaew'), { system: 'thungkaew', scope: '' }, 'ทุ่งแค้วเห็นระบบของตัวเอง')
  assert.deepEqual(resolveSystem('demo'), { system: 'namlao', scope: 'ข้อมูลจริงของน้ำเลา ใช้สาธิต' })
  assert.deepEqual(resolveSystem('demo', 'namlao'), { system: 'namlao', scope: SYSTEM_PREVIEW_SCOPES.namlao })
  assert.deepEqual(resolveSystem('demo', 'tamnaktham'), { system: 'tamnaktham', scope: SYSTEM_PREVIEW_SCOPES.tamnaktham }, 'demo ดูระบบตำหนักธรรมได้ผ่าน ?system=')
  assert.deepEqual(resolveSystem('demo', 'thungkaew'), { system: 'thungkaew', scope: SYSTEM_PREVIEW_SCOPES.thungkaew })
  for (const id of ['tamnaktham', 'thungkaew']) assert.match(SYSTEM_PREVIEW_SCOPES[id], /ตัวอย่างบนสนามซ้อม/, `${id}: ป้ายบน demo ต้องบอกว่าเป็นตัวอย่าง`)
  // อปท. จริงเมิน ?system= เสมอ — ห้ามเห็นระบบของที่อื่น/ติดป้ายสาธิต
  for (const slug of ['namlao', 'tamnaktham', 'thungkaew']) {
    for (const asked of ['namlao', 'tamnaktham', 'thungkaew', 'nope']) {
      assert.deepEqual(resolveSystem(slug, asked), { system: slug, scope: '' }, `${slug} + ?system=${asked} ต้องเมิน`)
    }
  }
  for (const bad of ['cmu', 'nope', '', null, undefined, '__proto__', 'constructor', 'toString']) {
    assert.equal(resolveSystem('demo', bad).system, 'namlao', `demo + ?system=${bad} ต้องกลับค่าเริ่มต้น`)
    assert.equal(resolveSystem('namlao', bad).system, 'namlao')
  }
  assert.equal(systemById('namlao'), NAMLAO_SYSTEM)
  assert.equal(systemById('tamnaktham'), TAMNAKTHAM_SYSTEM); assert.equal(systemById('thungkaew'), THUNGKAEW_SYSTEM)
  for (const bad of ['nope', '', null, undefined, '__proto__', 'constructor']) assert.equal(systemById(bad), null)
  console.log('✓ ทะเบียน: น้ำเลา/ตำหนักธรรม/ทุ่งแค้ว เห็นระบบของตัวเอง + demo · อปท. อื่น/คีย์ prototype ไม่เห็น · ?system= ถูกเมินนอก demo')
}

// ── 2) ความสอดคล้องของทะเบียน ──
const sys = NAMLAO_SYSTEM
const allNodes = [...sys.upstream, ...sys.inside, ...sys.downstream]
{
  const ids = allNodes.map(n => n.id)
  assert.equal(new Set(ids).size, ids.length, 'id โหนดต้องไม่ซ้ำ')
  const sourceIds = new Set(sys.sources.map(s => s.id))
  assert.ok(sourceIds.has(sys.id), 'ต้องมีผังตำบลของตัวเองใน sources (ใช้คำนวณอายุ)')
  assert.ok(sourceIds.has('province'), 'ต้องมีผังจังหวัดใน sources')
  for (const s of sys.sources) assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/, `${s.id}: วันที่ผังต้องเป็น YYYY-MM-DD`)
  for (const n of allNodes) {
    assert.ok(NODE_KINDS.includes(n.kind), `${n.id}: kind ${n.kind}`)
    assert.ok(NODE_ROLES.includes(n.role), `${n.id}: role ${n.role}`)
    assert.ok(NODE_STATUSES.includes(n.status), `${n.id}: status ${n.status}`)
    assert.ok(sourceIds.has(n.source), `${n.id}: ต้องมีที่มา (source ${n.source} ไม่อยู่ใน sources)`)
    assert.ok(n.name && n.name.trim().length > 0, `${n.id}: ต้องมีชื่อ`)
  }
  for (const n of sys.upstream) assert.equal(n.role, 'upstream', `${n.id}: ขั้น "ก่อนถึงตำบล" ต้อง role upstream`)
  for (const n of sys.downstream) assert.equal(n.role, 'downstream', `${n.id}: ขั้น "ไหลต่อ" ต้อง role downstream`)
  for (const n of sys.inside) assert.ok(['inside', 'upstream'].includes(n.role), `${n.id}: ในตำบล = inside หรืออ่างต้นสาย (upstream)`)
  // ความสัมพันธ์ที่ผังไม่ยืนยัน = status unconfirmed เท่านั้น ห้ามติดป้ายว่ามีอยู่ชัดๆ
  for (const n of allNodes.filter(x => /^(up-unknown|down-link)$/.test(x.id))) assert.equal(n.status, 'unconfirmed')
  assert.ok(allNodes.some(n => n.status === 'planned'), 'แผนก่อสร้างของผังต้องไม่หาย')
  assert.ok(allNodes.filter(n => n.status === 'planned').every(n => !/^(?:ปกติ|มีน้ำไหล)/.test(n.name)))
  // จำนวนแผนก่อสร้างที่แสดงบนหน้า ต้องตรงกับโหนด (โหนด "ฝายตามแผน 3 แห่ง" นับเป็น 3 รายการ)
  const plannedItems = allNodes.filter(n => n.status === 'planned').reduce((sum, n) => sum + Number(/(\d+)\s*แห่ง/.exec(n.name)?.[1] ?? 1), 0)
  assert.equal(sys.counts.planned, plannedItems, 'จำนวนแผนก่อสร้างในสรุปต้องตรงกับโหนด')
  console.log('✓ ทะเบียน: id ไม่ซ้ำ · ทุกโหนดมีที่มา/ชนิด/บทบาท/สถานะที่ถูกต้อง · ขั้นตรงบทบาท · ที่ไม่ยืนยันเป็น unconfirmed · แผนก่อสร้างไม่หาย')
}

// ── 3) ความสัมพันธ์ของอ่าง/สถานีระดับน้ำ (D4) ──
{
  const keys = Object.keys(sys.relations)
  assert.deepEqual(keys.sort(), ['dam:304', 'dam:305', 'waterlevel:YOM003'], 'น้ำเลาเห็นอ่าง 305/304 และสถานีระดับน้ำ YOM003 — ทุกตัวต้องมีป้ายความสัมพันธ์')
  for (const [key, value] of Object.entries(sys.relations)) {
    assert.ok(RELATION_KEYS.includes(value.relation), `${key}: ความสัมพันธ์ ${value.relation}`)
    if (['side', 'unspecified'].includes(value.relation)) assert.ok(value.note && value.note.length > 30, `${key}: ป้ายสายข้างเคียง/ผังไม่ระบุต้องมีคำอธิบายในการ์ด`)
  }
  assert.equal(relationOf(sys, 'dam', '305').label, 'ต้นน้ำของตำบล')
  assert.equal(relationOf(sys, 'dam', '304').label, 'สายข้างเคียง')
  assert.equal(relationOf(sys, 'waterlevel', 'YOM003').label, 'ผังไม่ระบุ')
  assert.equal(relationOf(sys, 'dam', '999'), null, 'สถานีที่ไม่ได้ระบุ = ไม่มีป้าย (การ์ดคงเดิม)')
  assert.equal(relationOf(null, 'dam', '305'), null, 'อปท. ที่ไม่มีระบบ = ไม่มีป้าย')
  // โหนดที่ผูกสถานีต้องสอดคล้องกับป้ายของสถานีนั้น
  for (const n of allNodes.filter(x => x.bind && x.bind.type === 'dam')) {
    assert.equal(sys.relations[`dam:${n.bind.code}`].relation, n.role, `${n.id}: บทบาทโหนดต้องตรงป้ายของ dam:${n.bind.code}`)
  }
  // แม่ถางต้องไม่ถูกจัดเป็นต้นน้ำของน้ำเลา (ผังบ้านเวียงวาดเป็นสายเหนือของบ้านเวียง → น้ำแม่หล่าย)
  assert.notEqual(sys.relations['dam:304'].relation, 'upstream')
  assert.ok(!allNodes.some(n => n.bind?.type === 'dam' && n.bind.code === '304' && ['upstream', 'inside'].includes(n.role)))
  assert.match(sys.relations['dam:304'].note, /น้ำแม่หล่าย/)
  assert.deepEqual(Object.keys(RELATIONS).sort(), ['downstream', 'inside', 'side', 'unspecified', 'upstream'])
  console.log('✓ ความสัมพันธ์: 305 ต้นน้ำ · 304 สายข้างเคียง (ผังบ้านเวียง → น้ำแม่หล่าย) · YOM003 ผังไม่ระบุ · บทบาทโหนดตรงป้าย · ไม่มีป้ายเมื่อไม่ระบุ')
}

// ── 4) ข้อความต้องห้ามในทะเบียน (ไม่คัดลอกความจุ · ไม่พยากรณ์ · ไม่ให้คำสั่ง/คำรับรอง) ──
{
  const dump = JSON.stringify(sys)
  for (const word of ['รับรอง', 'อพยพ', 'มาตรา', 'พยากรณ์', 'คาดว่า', 'จะท่วม', 'ปลอดภัย', 'เตือนภัย', 'ประกาศเขต', 'ช่วยเหลือ', 'อนุมัติ', 'สั่งการ', 'ปกติ', 'กรุณา']) {
    assert.ok(!dump.includes(word), `ทะเบียนห้ามมีคำว่า "${word}"`)
  }
  assert.ok(!/\d+(?:\.\d+)?\s*ล้าน\s*ลบ\.?ม/.test(dump), 'ห้ามมีความจุ/ปริมาตรอ่างจากผัง (ผังขัดกับรายงานจริง)')
  assert.ok(!/จุ\s*\d/.test(dump), 'ห้ามมี "จุ N" (ความจุตามผัง)')
  for (const name of ['แม่ถอน', 'แม่หยวก', 'แม่คำมี', 'ปางจ๊าว']) assert.ok(!dump.includes(name), `${name} ไม่ใช่สายของน้ำเลา ห้ามโผล่ในระบบนี้`)
  assert.equal(sys.omitted.length >= 4, true)
  for (const item of sys.omitted) assert.ok(item.reason.length > 5, `"${item.name}" ต้องมีเหตุผลที่ไม่ได้ใส่`)
  assert.ok(sys.omitted.some(o => /ความจุ/.test(o.name)), 'ต้องบอกว่าไม่ได้ใส่ความจุ พร้อมเหตุผล')
  console.log('✓ ถ้อยคำทะเบียน: ไม่มีความจุจากผัง/คำพยากรณ์/คำรับรอง/คำสั่ง · ผังมีแต่ไม่ได้ใส่ มีเหตุผลทุกข้อ')
}

// ── 5) คำกำกับบังคับ + อายุผัง ──
{
  assert.deepEqual(SYSTEM_DISCLAIMER, ['ไม่ใช่ประกาศ', 'ไม่บอกเวลาน้ำถึง', 'ไม่ได้แสดงว่ามีน้ำไหลจริง', 'ไม่ได้รับรองว่าปลอดภัย'])
  assert.equal(SYSTEM_DISCLAIMER_LINE, 'ไม่ใช่ประกาศ · ไม่บอกเวลาน้ำถึง · ไม่ได้แสดงว่ามีน้ำไหลจริง · ไม่ได้รับรองว่าปลอดภัย')
  assert.equal(UPSTREAM_DEPTH_NOTE, 'ต้นน้ำอยู่ไกลกว่านี้ ผังที่ใช้ไม่ครอบคลุม')
  assert.equal(NO_LIVE_TEXT, 'ไม่มีค่าสดในระบบ')

  // อายุผัง: ผังน้ำเลาลง 30 เม.ย. 2567 (2024-04-30) → 18 ต.ค. 2569 = 29 เดือน ("2 ปี 5 เดือน") — ไม่ใช่ 17 เดือนที่เคยจดผิด
  const now = Date.parse('2026-10-18T05:00:00Z')
  assert.equal(monthsBetween('2024-04-30', now), 29)
  assert.equal(ageText(29), '2 ปี 5 เดือน'); assert.equal(ageText(24), '2 ปี'); assert.equal(ageText(5), '5 เดือน'); assert.equal(ageText(null), '')
  const age = diagramAge(sys, now)
  assert.equal(age.months, 29); assert.equal(age.text, '2 ปี 5 เดือน'); assert.equal(age.dateText, '30 เม.ย. 2567'); assert.equal(age.stale, false)
  assert.equal(thaiDate('2025-08-08'), '8 ส.ค. 2568')
  assert.equal(thaiDate('x'), ''); assert.equal(thaiDate(undefined), '')
  assert.equal(STALE_DIAGRAM_MONTHS, 36)
  // ขอบแถบเหลือง: 35 เดือน ไม่ขึ้น · 36 ขึ้น
  const fake = { id: 'x', sources: [{ id: 'x', date: '2023-10-18' }] }
  assert.equal(diagramAge(fake, Date.parse('2026-10-17T05:00:00Z')).stale, false, '35 เดือน (วันก่อนครบ) ยังไม่ขึ้นแถบ')
  assert.equal(diagramAge(fake, Date.parse('2026-10-18T05:00:00Z')).stale, true, 'ครบ 36 เดือนขึ้นแถบเหลือง')
  assert.equal(diagramAge({ id: 'x', sources: [] }, now), null)
  console.log('✓ คำกำกับบังคับครบ · อายุผัง 29 เดือน = "2 ปี 5 เดือน" · แถบเหลืองที่ 36 เดือนพอดี')
}

// ── 6) ค่าสดของโหนด ──
{
  const dam305 = sys.inside.find(n => n.id === 'in-dam-305')
  const st = (type, code, extra = {}) => ({ station_type: type, station_code: code, recorded_at: '2026-10-17T17:00:00+00:00', ...extra })
  assert.equal(liveState(dam305, [st('dam', '305', { dam_storage_mcm: 6.76 })]), 'live')
  assert.equal(liveState(dam305, [st('dam', '305', { dam_storage_mcm: null })]), 'none', 'ไม่มีปริมาตร = ไม่มีค่าสด (ไม่ใช่ 0)')
  assert.equal(liveState(dam305, [st('dam', '305', { dam_storage_mcm: 0 })]), 'live', 'ปริมาตร 0 จริง = มีค่า')
  assert.equal(liveState(dam305, [st('dam', '305', { dam_storage_mcm: 6, recorded_at: null })]), 'none')
  assert.equal(liveState(dam305, []), 'none', 'ไม่มีสถานีในระบบ = ไม่มีค่าสด')
  assert.equal(liveState(dam305, null), 'none')
  const rain = sys.inside.find(n => n.id === 'in-rain-stn0911')
  assert.equal(liveState(rain, [st('rain', 'STN0911', { rain_24h_mm: 0 })]), 'live', 'ฝน 0 มม. จริงคือมีค่า')
  assert.equal(liveState(rain, [st('rain', 'STN0911', { rain_24h_mm: null })]), 'none')
  assert.equal(liveState(sys.inside.find(n => n.id === 'in-res-others'), []), 'none', 'อ่างที่ไม่ผูกสถานี = ไม่มีค่าสดในระบบ')
  assert.equal(liveState(sys.inside.find(n => n.id === 'in-dam-mkp2'), []), null, 'อ่างแผนก่อสร้างยังไม่มี = ไม่ขึ้นป้ายค่าสด')
  assert.equal(liveState(sys.inside.find(n => n.id === 'in-weirs'), []), null, 'ฝายไม่ใช่ของที่วัดได้ ไม่ขึ้นป้าย')
  assert.equal(liveState(null, []), null)
  console.log('✓ ค่าสดโหนด: มีค่า=live · ไม่มี/ว่าง=ไม่มีค่าสดในระบบ (0 จริงยังเป็น live) · ฝาย/แผนก่อสร้างไม่ขึ้นป้าย')
}

// ── 7) ตัดออกจากหน้า (เจ้าของระบบสั่ง 2026-10-19): การ์ดแนวโน้มอ่าง 30 วัน + กล่อง "ผังต้นฉบับมี แต่เราไม่ได้ใส่" ──
//   เหตุผล: การ์ดแนวโน้มซ้ำกับการ์ดอ่างเดิมของหน้า (ป้ายต้นน้ำ + ปริมาตรอยู่ที่นั่นแล้ว) · กล่อง "ไม่ได้ใส่" เป็นภาษาเทคนิคเกินไปสำหรับชาวบ้าน
{
  const code = read('src/components/water/WaterDiagramEdges.jsx').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.equal(existsSync(new URL('../src/components/water/WaterSystem.jsx', import.meta.url)), false, 'WaterSystem.jsx ถูกแทนด้วย WaterDiagramEdges.jsx (รวมเข้าแท็บผังน้ำตำบลแล้ว)')
  for (const gone of ['DamTrendCard', 'TrendChart', 'TrendPanel', 'useDamHistory', 'get_public_dam_history', 'data-related-dam', 'data-trend', 'data-system-omitted', 'omitted',
    'ผังต้นฉบับมี แต่เราไม่ได้ใส่', 'ดูตัวเลขล่าสุดของอ่างนี้', 'แนวโน้มปริมาณน้ำในอ่าง']) {
    assert.ok(!code.includes(gone), `หน้าห้ามมี "${gone}" อีก (ตัดออกตามที่เจ้าของระบบสั่ง)`)
  }
  assert.equal(existsSync(new URL('../src/components/water/useDamHistory.js', import.meta.url)), false, 'ไม่ดึงประวัติอ่างอีก → ไม่มีตัวดึง')
  const model = read('src/lib/waterSystem/model.js')
  for (const gone of ['damTrendSummary', 'trendChart', 'trendFactText', 'TREND_WINDOW_DAYS', 'TREND_MIN_DAYS', 'systemHasDams', 'bangkokISODate', 'DAM_GAP_MS']) {
    assert.ok(!model.includes(gone), `model ห้ามเหลือโค้ดแนวโน้มอ่างที่ไม่มีใครใช้: ${gone}`)
  }
  // รายการ "ที่ผังมีแต่ไม่ได้ใส่" ยังเก็บในทะเบียนเป็นบันทึกให้ อบต. ยืนยัน (ไม่ขึ้นหน้าเว็บ)
  for (const system of Object.values(SYSTEMS)) assert.ok(system.omitted.length >= 4, `${system.id}: ยังต้องเก็บรายการที่ผังมีแต่ไม่ได้ใส่ไว้ในทะเบียน`)
  console.log('✓ ตัดออกจากหน้า: การ์ดแนวโน้มอ่าง + กล่อง "ไม่ได้ใส่" + ตัวดึงประวัติอ่าง + โค้ดแนวโน้มใน model · ข้อมูล omitted ยังอยู่ในทะเบียน')
}

// ── 9) ทุกระบบ: ความสอดคล้องของทะเบียน (ตำหนักธรรม · ทุ่งแค้ว ใช้กติกาเดียวกับน้ำเลา) ──
const FORBIDDEN_WORDS = ['รับรอง', 'อพยพ', 'มาตรา', 'พยากรณ์', 'คาดว่า', 'จะท่วม', 'ปลอดภัย', 'เตือนภัย', 'ประกาศเขต', 'ช่วยเหลือ', 'อนุมัติ', 'สั่งการ', 'ปกติ', 'กรุณา']
{
  for (const system of Object.values(SYSTEMS)) {
    const tag = system.id
    const nodes = [...system.upstream, ...system.inside, ...system.downstream]
    const ids = nodes.map(n => n.id)
    assert.equal(new Set(ids).size, ids.length, `${tag}: id โหนดต้องไม่ซ้ำ`)
    const sourceIds = new Set(system.sources.map(s => s.id))
    assert.ok(sourceIds.has(system.id) && sourceIds.has('province'), `${tag}: ต้องมีผังตำบลของตัวเองและผังจังหวัดใน sources`)
    for (const s of system.sources) assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/, `${tag}/${s.id}: วันที่ผังต้องเป็น YYYY-MM-DD`)
    assert.ok(system.tambon && system.amphoe && system.summary.length > 30, `${tag}: ต้องมีชื่อตำบล/อำเภอ/สรุป`)
    assert.ok(system.originalUrl.startsWith('https://www.phraepao.go.th/officechief/water/'), `${tag}: ลิงก์ผังต้นฉบับต้องเป็นของศูนย์ฯ`)
    for (const n of nodes) {
      assert.ok(NODE_KINDS.includes(n.kind), `${tag}/${n.id}: kind ${n.kind}`)
      assert.ok(NODE_ROLES.includes(n.role), `${tag}/${n.id}: role ${n.role}`)
      assert.ok(NODE_STATUSES.includes(n.status), `${tag}/${n.id}: status ${n.status}`)
      assert.ok(sourceIds.has(n.source), `${tag}/${n.id}: source ${n.source} ไม่อยู่ใน sources`)
      assert.ok(n.name && n.name.trim().length > 0 && typeof n.note === 'string', `${tag}/${n.id}: ต้องมีชื่อและ note (ว่างได้)`)
      assert.ok(n.bind === null || (n.bind.type && n.bind.code), `${tag}/${n.id}: bind ต้องเป็น null หรือ { type, code }`)
    }
    for (const n of system.upstream) assert.equal(n.role, 'upstream', `${tag}/${n.id}: ขั้นก่อนถึงตำบลต้อง role upstream`)
    for (const n of system.downstream) assert.equal(n.role, 'downstream', `${tag}/${n.id}: ขั้นไหลต่อต้อง role downstream`)
    for (const n of system.inside) assert.ok(['inside', 'upstream'].includes(n.role), `${tag}/${n.id}: ในตำบล = inside หรืออ่างต้นสาย`)
    for (const n of nodes.filter(x => x.status === 'unconfirmed')) assert.ok(n.note.length >= 20, `${tag}/${n.id}: ที่ผังไม่ยืนยันต้องบอกเหตุผล`)
    assert.ok(nodes.some(n => n.status === 'planned'), `${tag}: แผนก่อสร้างของผังต้องไม่หาย`)
    const plannedItems = nodes.filter(n => n.status === 'planned').reduce((sum, n) => sum + Number(/(\d+)\s*(?:แห่ง|จุด)/.exec(n.name)?.[1] ?? 1), 0)
    assert.equal(system.counts.planned, plannedItems, `${tag}: จำนวนแผนก่อสร้างในสรุปต้องตรงกับโหนด`)
    for (const n of nodes.filter(x => x.status === 'planned' || x.status === 'repair')) assert.ok(!/^(?:ปกติ|มีน้ำไหล)/.test(n.name), `${tag}/${n.id}`)

    // ถ้อยคำ: ไม่คัดลอกความจุ · ไม่พยากรณ์ · ไม่รับรอง/สั่งการ
    const dump = JSON.stringify(system)
    for (const word of FORBIDDEN_WORDS) assert.ok(!dump.includes(word), `${tag}: ทะเบียนห้ามมีคำว่า "${word}"`)
    assert.ok(!/\d+(?:\.\d+)?\s*ล้าน\s*ลบ\.?ม/.test(dump), `${tag}: ห้ามมีความจุ/ปริมาตรอ่างจากผัง`)
    assert.ok(!/จุ\s*\d/.test(dump), `${tag}: ห้ามมี "จุ N" (ความจุตามผัง)`)
    assert.ok(system.omitted.length >= 4, `${tag}: ผังมีแต่ไม่ได้ใส่ อย่างน้อย 4 ข้อ`)
    for (const item of system.omitted) assert.ok(item.name && item.reason.length > 5, `${tag}: "${item.name}" ต้องมีเหตุผลที่ไม่ได้ใส่`)
    assert.ok(system.omitted.some(o => /ความจุ/.test(o.name)), `${tag}: ต้องบอกว่าไม่ได้ใส่ความจุ พร้อมเหตุผล`)

    // ความสัมพันธ์
    for (const [key, value] of Object.entries(system.relations)) {
      assert.ok(RELATION_KEYS.includes(value.relation), `${tag}/${key}: ความสัมพันธ์ ${value.relation}`)
      assert.match(key, /^(dam|waterlevel):\S+$/, `${tag}: คีย์ความสัมพันธ์ต้องเป็น ชนิด:รหัส`)
      if (['side', 'unspecified'].includes(value.relation)) assert.ok(value.note && value.note.length > 30, `${tag}/${key}: ป้ายสายข้างเคียง/ผังไม่ระบุต้องมีคำอธิบาย`)
    }
    // โหนดที่ผูกอ่างกลาง/สถานีระดับน้ำ ต้องมีป้ายของสถานีนั้น และบทบาทต้องตรงกัน
    for (const n of nodes.filter(x => x.bind && ['dam', 'waterlevel'].includes(x.bind.type))) {
      const rel = system.relations[`${n.bind.type}:${n.bind.code}`]
      assert.ok(rel, `${tag}/${n.id}: สถานี ${n.bind.type}:${n.bind.code} ต้องมีป้ายความสัมพันธ์`)
      assert.equal(rel.relation, n.role, `${tag}/${n.id}: บทบาทโหนดต้องตรงป้ายของสถานี`)
    }
    // อายุผัง: คำนวณจากไฟล์ผังตำบลเอง
    const age = diagramAge(system, Date.parse('2026-10-18T05:00:00Z'))
    assert.ok(age && age.months >= 24 && age.months <= 36, `${tag}: อายุผัง ${age?.months}`)
  }
  console.log('✓ ทุกระบบ: id ไม่ซ้ำ · ที่มา/ชนิด/บทบาท/สถานะถูกต้อง · ที่ไม่ยืนยันมีเหตุผล · แผนก่อสร้างไม่หาย · ไม่มีความจุ/คำต้องห้าม · ป้ายสถานีครบและตรงบทบาท')
}

// ── 10) ตำหนักธรรม + ทุ่งแค้ว: เรื่องเฉพาะของแต่ละตำบล ──
{
  const T = TAMNAKTHAM_SYSTEM, K = THUNGKAEW_SYSTEM
  const tNodes = [...T.upstream, ...T.inside, ...T.downstream], kNodes = [...K.upstream, ...K.inside, ...K.downstream]
  assert.deepEqual(Object.keys(T.relations).sort(), ['waterlevel:Y.38', 'waterlevel:YOM003'], 'ตำหนักธรรมเห็นสถานีระดับน้ำ Y.38 และ YOM003 (อ่างกลางถูกปิดแล้ว)')
  assert.deepEqual(Object.keys(K.relations), ['waterlevel:YOM003'], 'ทุ่งแค้วเห็นสถานีระดับน้ำ YOM003 ตัวเดียว (ไม่มีอ่างกลาง)')
  assert.equal(relationOf(T, 'waterlevel', 'Y.38').label, 'อยู่ในตำบล')
  assert.equal(relationOf(T, 'waterlevel', 'YOM003').label, 'ผังไม่ระบุ')
  assert.equal(relationOf(K, 'waterlevel', 'YOM003').label, 'ผังไม่ระบุ')
  assert.equal(relationOf(T, 'dam', '305'), null, 'ตำหนักธรรมไม่มีป้ายอ่างแม่คำปอง')
  assert.equal(relationOf(K, 'waterlevel', 'Y.38'), null)
  // ไม่มีอ่างกลาง → ไม่ผูกอ่างกลาง
  for (const [name, system, nodes] of [['ตำหนักธรรม', T, tNodes], ['ทุ่งแค้ว', K, kNodes]]) {
    assert.ok(!Object.keys(system.relations).some(k => k.startsWith('dam:')), `${name}: ห้ามมีป้ายอ่างกลาง`)
    assert.ok(!nodes.some(n => n.bind?.type === 'dam'), `${name}: ห้ามผูกอ่างกลาง`)
  }

  // ตำหนักธรรม: Y.38 ผูกค่าสด · ที่ผังไม่ยืนยัน 3 เรื่อง (ชื่อสาย · อ่างต้นสายตามผังจังหวัด · ต้นคลอง) ต้องเป็น unconfirmed
  assert.deepEqual(tNodes.find(n => n.id === 'in-gauge-y38').bind, { type: 'waterlevel', code: 'Y.38' })
  for (const id of ['up-name-link', 'up-reservoir-province', 'up-canal-source']) assert.equal(tNodes.find(n => n.id === id)?.status, 'unconfirmed', `ตำหนักธรรม/${id}`)
  assert.match(tNodes.find(n => n.id === 'up-name-link').name, /\?$/, 'ชื่อ "น้ำแม่คำมี = ลำห้วยแม่คำมี" ต้องเป็นคำถาม ไม่เขียนยืนยัน')
  // แม่คำปอง/แม่ถางอยู่เฉพาะกล่อง "ไม่ได้ใส่" (ไม่ใช่โหนดของระบบ) · ผังขัดกันเรื่องฝาย ม.12 ต้องบอก
  assert.ok(T.omitted.some(o => /แม่คำปอง/.test(o.name) && /แม่ถาง/.test(o.name)))
  assert.ok(!tNodes.some(n => /แม่คำปอง|แม่ถาง/.test(n.name + n.note)))
  assert.ok(T.omitted.some(o => /ม\.12/.test(o.name) && /ขัดกัน/.test(o.reason)), 'ฝาย ม.12 สองผังสีไม่ตรงกัน ต้องบอก')
  for (const leak of ['ห้วยเฮือ', 'ห้วยยอย', 'ห้วยปุ่ย', 'ห้วยปุย', 'บุญแจ่ม']) assert.ok(!JSON.stringify(T).includes(leak), `ตำหนักธรรมห้ามมี "${leak}" (ของตำบลอื่น)`)

  // ทุ่งแค้ว: อ่างเล็ก 2 แห่งผูก id ตามทะเบียนอ่างเล็ก · เป็นรายงานรายสัปดาห์ ไม่ใช่ค่าสด · อ่างห้วยเฮือไม่มีค่า
  const yoi = kNodes.find(n => n.id === 'in-res-yoi'), pui = kNodes.find(n => n.id === 'in-res-pui'), hue = kNodes.find(n => n.id === 'in-res-hue')
  assert.deepEqual(yoi.bind, { type: 'small-reservoir', code: '50' }); assert.deepEqual(pui.bind, { type: 'small-reservoir', code: '30' })
  for (const n of [yoi, pui]) {
    assert.ok(Object.hasOwn(SMALL_RESERVOIRS, n.bind.code), `${n.id}: รหัสอ่างเล็กต้องอยู่ในทะเบียน`)
    assert.ok(/ไม่ใช่ค่าสด/.test(n.note), `${n.id}: ต้องบอกว่ารายงานรายสัปดาห์ ไม่ใช่ค่าสด`)
    assert.equal(liveState(n, []), null, `${n.id}: อ่างเล็กไม่ขึ้นป้ายค่าสด/ไม่มีค่าสด (มีการ์ดของตัวเองบนหน้า)`)
    assert.equal(liveState(n, [{ station_type: 'dam', station_code: n.bind.code, recorded_at: '2026-10-17T17:00:00+00:00', dam_storage_mcm: 1 }]), null)
  }
  assert.equal(liveState(hue, []), 'none', 'อ่างห้วยเฮือไม่มีรายงาน = ไม่มีค่าสดในระบบ')
  assert.equal(liveState(tNodes.find(n => n.id === 'up-reservoir-province'), []), 'none', 'อ่างต้นสายตามผังจังหวัด = ไม่มีค่าสดในระบบ')
  const st = (type, code, extra = {}) => ({ station_type: type, station_code: code, recorded_at: '2026-10-17T17:00:00+00:00', ...extra })
  const y38 = tNodes.find(n => n.id === 'in-gauge-y38')
  assert.equal(liveState(y38, [st('waterlevel', 'Y.38', { bank_diff_m: 5.1 })]), 'live')
  assert.equal(liveState(y38, [st('waterlevel', 'Y.38', { bank_diff_m: null, waterlevel_msl: null })]), 'none')
  assert.equal(liveState(y38, [st('waterlevel', 'Y.38', { waterlevel_msl: 0 })]), 'live', 'ระดับ 0 จริงคือมีค่า')
  assert.equal(liveState(y38, []), 'none')
  const res038 = kNodes.find(n => n.id === 'in-rain-res038')
  assert.equal(liveState(res038, [st('rain', 'RES038', { rain_24h_mm: 0 })]), 'live'); assert.equal(liveState(res038, []), 'none')
  assert.equal(liveState(kNodes.find(n => n.id === 'in-repair'), []), null, 'รางชำรุดไม่ขึ้นป้าย')
  assert.equal(liveState(kNodes.find(n => n.id === 'in-pumps-planned'), []), null, 'สถานีสูบตามแผนไม่ขึ้นป้าย')
  for (const leak of ['แม่คำปอง', 'แม่ถาง', 'แม่คำมี', 'ปางจ๊าว', 'ตำหนักธรรม']) assert.ok(!JSON.stringify(K).includes(leak), `ทุ่งแค้วห้ามมี "${leak}" (ของตำบลอื่น)`)
  console.log('✓ ตำหนักธรรม: ป้าย Y.38 อยู่ในตำบล/YOM003 ผังไม่ระบุ · ไม่มีอ่างกลาง · ที่ผังไม่ยืนยัน 3 เรื่องเป็น unconfirmed · ฝาย ม.12 ผังขัดกันมีบอก')
  console.log('✓ ทุ่งแค้ว: อ่างเล็กผูก id ตามทะเบียน เป็นรายงานรายสัปดาห์ ไม่ใช่ค่าสด · ฝน RES038 ผูกค่าสด · อ่างห้วยเฮือไม่มีค่า')
}

// ── 11) สรุปจำนวน + ตรวจกับผังเคลื่อนไหว (กันตัวเลขในทะเบียนลอยจากภาพ) ──
{
  assert.equal(systemCountsText(NAMLAO_SYSTEM.counts), 'อ่าง 4 แห่ง · ฝายประมาณ 40 แห่ง · สระ 4 แห่ง · ห้วยสาขาประมาณ 25 สาย · แผนก่อสร้าง 4 รายการ', 'น้ำเลา: ข้อความเดิมทุกตัวอักษร')
  assert.equal(systemCountsText(TAMNAKTHAM_SYSTEM.counts), 'ฝาย 6 แห่ง · ห้วยสาขา 4 สาย · แผนก่อสร้าง 5 รายการ', 'ตำหนักธรรมไม่มีอ่าง/สระ → ไม่เขียน "อ่าง 0 แห่ง"')
  assert.equal(systemCountsText(THUNGKAEW_SYSTEM.counts), 'อ่าง 3 แห่ง · ฝายประมาณ 27 แห่ง · หนอง 3 แห่ง · ห้วยสาขาประมาณ 23 สาย · แผนก่อสร้าง 3 รายการ')
  assert.equal(systemCountsText({}), ''); assert.equal(systemCountsText(null), ''); assert.equal(systemCountsText(undefined), '')
  assert.equal(systemCountsText({ reservoirs: 0, weirs: 0, ponds: 0, tributaries: 0, planned: 0 }), '', '0 ไม่เขียน')
  assert.equal(systemCountsText({ weirs: '9', reservoirs: null, planned: NaN }), '', 'ค่าที่ไม่ใช่ตัวเลขไม่เขียน')
  assert.equal(systemCountsText({ weirs: 9 }), 'ฝาย 9 แห่ง'); assert.equal(systemCountsText({ weirs: 10 }), 'ฝายประมาณ 10 แห่ง', 'ตั้งแต่ 10 ขึ้นไปเขียน "ประมาณ" (นับจากภาพ)')
  for (const system of Object.values(SYSTEMS)) assert.ok(!/ 0 /.test(` ${systemCountsText(system.counts)} `), `${system.id}: สรุปห้ามมีจำนวน 0`)

  const planned = d => d.elements.filter(e => e.status === 'planned' && ['weir', 'pump', 'reservoir', 'planBox'].includes(e.kind)).length
  const existing = (d, kind) => d.elements.filter(e => e.kind === kind && (e.status ?? 'existing') !== 'planned').length
  for (const [system, diagram] of [[NAMLAO_SYSTEM, NAMLAO_DIAGRAM], [TAMNAKTHAM_SYSTEM, TAMNAKTHAM_DIAGRAM], [THUNGKAEW_SYSTEM, THUNGKAEW_DIAGRAM]]) {
    assert.equal(system.counts.planned, planned(diagram), `${system.id}: แผนก่อสร้างในทะเบียนต้องตรงกับผังเคลื่อนไหว`)
    assert.equal(system.counts.reservoirs ?? 0, existing(diagram, 'reservoir'), `${system.id}: จำนวนอ่างต้องตรงกับผังเคลื่อนไหว`)
  }
  assert.equal(THUNGKAEW_SYSTEM.counts.ponds, existing(THUNGKAEW_DIAGRAM, 'pond'), 'ทุ่งแค้ว: จำนวนหนองตรงกับผังเคลื่อนไหว')
  assert.equal(THUNGKAEW_SYSTEM.counts.weirs, existing(THUNGKAEW_DIAGRAM, 'weir'), 'ทุ่งแค้ว: จำนวนฝายตรงกับผังเคลื่อนไหว')
  console.log('✓ สรุปจำนวน: น้ำเลาข้อความเดิม · ไม่เขียน 0 · เกิน 9 = "ประมาณ" · อ่าง/แผนก่อสร้าง/หนอง/ฝายตรงกับผังเคลื่อนไหว')
}

// ── 8) ส่วนหน้าจอ: ไม่เพิ่มงานเจ้าหน้าที่ + ต่อหน้าถูกจุด ──
{
  const comp = read('src/components/water/WaterDiagramEdges.jsx')
  const code = comp.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  for (const tag of ['<input', '<textarea', '<select', '<form', 'contentEditable', 'contenteditable', 'onSubmit']) {
    assert.ok(!code.includes(tag), `ส่วนนี้อ่านอย่างเดียว ห้ามมี ${tag}`)
  }
  const buttons = [...code.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(m => m[0])
  assert.ok(buttons.length >= 1 && buttons.every(b => b.includes('type="button"') && b.includes('setOpen(')), 'ปุ่มมีแค่ย่อ/ขยายรายการ')
  assert.ok(!/supabase\.from|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(code), 'ห้ามเขียนข้อมูล')
  assert.ok(code.includes('UPSTREAM_DEPTH_NOTE') && code.includes('NO_LIVE_TEXT'))
  // คำกำกับ/อายุผัง/ที่มา ไม่ซ้ำในส่วนนี้ — มีชุดเดียวที่ WaterDiagram.jsx (เทสต์ด้านล่าง)
  for (const gone of ['SYSTEM_DISCLAIMER', 'data-system-source', 'data-system-disclaimer', 'diagramAge', 'systemCountsText']) assert.ok(!code.includes(gone), `WaterDiagramEdges ห้ามมี ${gone} (รวมไว้ที่ WaterDiagram.jsx แล้ว)`)
  assert.ok(!code.includes('system.inside'), 'ขั้น "ในตำบล" ตัดออกจากหน้าแล้ว (ซ้ำกับภาพ)')
  assert.ok(code.includes('data-edge={edge}') && code.includes('title="ก่อนถึงตำบล"') && code.includes('title="ไหลต่อไปที่"'))
  for (const word of ['เหลืออีก', 'จะหมด', 'พยากรณ์ว่า', 'ปกติดี', 'ปลอดภัยแล้ว']) assert.ok(!code.includes(word), `คอมโพเนนต์ห้ามมี "${word}"`)

  const page = read('src/pages/WaterSituationPage.jsx')
  // แท็บสถานการณ์ไม่มีส่วน "ระบบน้ำของตำบล" อีกแล้ว (ย้ายไปแท็บผังน้ำตำบล) — ระบบน้ำเหลือใช้ติดป้ายความสัมพันธ์บนการ์ดอ่าง/ระดับน้ำเท่านั้น
  assert.ok(!page.includes("components/water/WaterSystem'") && !page.includes('<WaterSystem'), 'หน้าห้าม import/แสดง WaterSystem อีก')
  assert.ok(!page.includes('id="water-system"') && !page.includes('water-system-title'))
  assert.ok(page.includes("resolveSystem(tenant?.slug, searchParams.get('system'))"))
  assert.ok(!/<WaterSystem[^>]*tenantId/.test(page), 'ไม่ต้องส่ง tenantId (ไม่มีอะไรให้ดึง)')
  assert.equal(page.split('system={waterSystem}').length - 1, 2, 'ส่ง system ให้ทั้งส่วนอ่างและส่วนระดับน้ำ เพื่อติดป้ายความสัมพันธ์')
  assert.ok(page.includes("relationOf(system, 'dam', s.station_code)") && page.includes("relationOf(system, 'waterlevel', s.station_code)"))
  assert.ok(page.includes('id={`water-dam-${s.station_code}`}'), 'การ์ดอ่างต้องมีจุดยึดให้ลิงก์จากส่วนระบบน้ำ')
  // ภาพแชร์ (snapshot) ต้องไม่เปลี่ยน — ไม่ส่ง system
  assert.ok(/<DamSection stations=\{dams\} homeAmphoe=\{tenant\.district\} now=\{now\} snapshot \/>/.test(page), 'การ์ดสำหรับภาพแชร์ต้องคงเดิม')
  // ตัวกรอง Y.38 ของน้ำเลายังอยู่ (ไม่แตะ)
  assert.ok(page.includes("s.station_code === 'Y.38'"))
  // หน้าไม่ดึงข้อมูลเพิ่ม (ค่าสดมาจาก stations ที่หน้าโหลดอยู่แล้ว) · สรุปจำนวนมาจากตัวช่วย (ไม่เขียน "อ่าง 0 แห่ง") · ทุกชนิดโหนดมีไอคอน
  assert.ok(!/supabase\.rpc\(|\.rpc\(/.test(code) && !code.includes('supabase'), 'ส่วนระบบน้ำไม่เรียกฐานข้อมูลเอง')
  assert.ok(!/system\.counts\.(reservoirs|weirs|ponds|tributaries|planned)/.test(read('src/components/water/WaterDiagram.jsx')), 'สรุปจำนวนต้องมาจาก systemCountsText')
  const iconKeys = [...(/const KIND_ICON = \{([^}]*)\}/.exec(code)?.[1] ?? '').matchAll(/(\w+):/g)].map(m => m[1])
  assert.deepEqual([...iconKeys].sort(), [...NODE_KINDS].sort(), 'ไอคอนต้องมีครบทุกชนิดโหนด ไม่เกิน ไม่ขาด')
  console.log('✓ หน้าจอ: อ่านอย่างเดียว (ไม่มี input/form/เขียนข้อมูล · ปุ่มแค่ย่อ/ขยาย) · ไม่เรียกฐานข้อมูลเอง · ภาพแชร์ไม่เปลี่ยน')
}

// ── 12) รวมเข้าแท็บ "ผังน้ำตำบล" (เจ้าของระบบสั่ง 2569-10-24): ผังทุกตัวที่มี route มีระบบน้ำคู่กัน · คำกำกับ/อายุผัง/ที่มา/ตัวเลข เหลือชุดเดียว ──
//   เหตุผล: ส่วน "ระบบน้ำของตำบล" ท้ายแท็บสถานการณ์เล่าเรื่องเดียวกับภาพผังน้ำตำบลสองรอบ มีคำกำกับ/ที่มาแยกกันสองชุด และตัวเลขเริ่มไม่ตรงกัน
//   (ทุ่งแค้ว: โปสเตอร์ "แผนก่อสร้าง 2 · ชำรุด 1" แต่ส่วนระบบน้ำ "แผนก่อสร้าง 3 · รางชำรุด 2 จุด" — นับคนละหน่วย)
{
  for (const slug of ['namlao', 'tamnaktham', 'thungkaew']) {
    const diagram = diagramById(resolveDiagram(slug, null).diagram)
    assert.ok(diagram?.route, `${slug}: ผังต้องเป็นแบบมี route`)
    const system = systemById(diagram.id)
    assert.ok(system, `${slug}: ผังที่มี route ต้องมีข้อมูลระบบน้ำ id เดียวกัน (ไม่งั้น "ก่อนถึงตำบล/ไหลต่อไปที่" หาย)`)
    assert.ok(system.upstream.length > 0 && system.downstream.length > 0, `${slug}: ต้องมีทั้งก่อนถึงตำบลและไหลต่อไปที่`)
    assert.ok(diagram.route.title.includes(system.tambon), `${slug}: ผังกับระบบน้ำต้องเป็นตำบลเดียวกัน`)
    // ชื่อผังน้ำตำบลชุดเดียวทั้งหน้า: หัวโปสเตอร์ = "ผังน้ำ" + ชื่อตำบล
    assert.equal(diagram.route.eyebrow, 'ผังน้ำ'); assert.equal(diagram.route.heading, `ผังน้ำตำบล${system.tambon}`)
  }

  const view = read('src/components/water/WaterDiagram.jsx')
  assert.ok(view.includes('<WaterDiagramEdges system={system} stations={stations} />'), 'ก่อนถึงตำบล/ไหลต่อไปที่ ต้องอยู่ใต้ภาพของผังที่มี route')
  // คำกำกับบังคับ: ทุกข้อของ SYSTEM_DISCLAIMER ต้องขึ้นบนหน้า — ข้อ "ไม่ได้แสดงว่ามีน้ำไหลจริง" ผังพูดไว้แล้วในประโยคหลัก ("…ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง") ไม่พูดซ้ำ
  assert.deepEqual(SYSTEM_DISCLAIMER.filter(text => !text.includes('น้ำไหลจริง')), ['ไม่ใช่ประกาศ', 'ไม่บอกเวลาน้ำถึง', 'ไม่ได้รับรองว่าปลอดภัย'])
  assert.ok(view.includes('SYSTEM_DISCLAIMER_EXTRA') && view.includes("SYSTEM_DISCLAIMER.filter(text => !text.includes('น้ำไหลจริง'))"))
  assert.ok(view.includes('ไม่ได้แสดงว่าขณะนี้มีน้ำไหลจริง'), 'ประโยคหลักของผังต้องยังพูดเรื่องน้ำไหลจริง')
  // อายุผัง (คำนวณเอง) + แถบเหลืองเมื่อเกิน 36 เดือน + ที่มาของส่วนต้นน้ำ/ปลายน้ำ + จำนวนที่ผังต้นฉบับวาด
  for (const marker of ['data-diagram-age', 'data-stale-band', 'data-diagram-counts', 'data-diagram-edges-source', 'diagramAge(system, now)', 'STALE_DIAGRAM_MONTHS']) assert.ok(view.includes(marker), `WaterDiagram ต้องมี ${marker}`)
  // เลขชุดเดียว: บรรทัด "ผังต้นฉบับวาดไว้" ไม่นับแผนก่อสร้าง (ตัวเลขแผนก่อสร้างอยู่บนแถบหัวภาพ นับจากผังเดียวกับภาพ)
  assert.ok(view.includes('{ ...system.counts, planned: 0 }'))
  for (const sys of Object.values(SYSTEMS)) assert.ok(!/แผนก่อสร้าง/.test(systemCountsText({ ...sys.counts, planned: 0 })), `${sys.id}: บรรทัดจำนวนที่ผังวาดห้ามมีแผนก่อสร้าง`)
  // ชื่อแท็บ: ใช้ "ผังน้ำตำบล" ชุดเดียวทั้งหน้า (ไม่ปนกับ "เส้นทางน้ำ" เดิม)
  const page = read('src/pages/WaterSituationPage.jsx')
  assert.ok(page.includes("label: 'ผังน้ำตำบล'") && !page.includes("label: 'เส้นทางน้ำ'"))
  console.log('✓ รวมเข้าแท็บผังน้ำตำบล: ผัง route ทุกตัวมีระบบน้ำคู่กัน · คำกำกับบังคับครบชุดเดียว · อายุผัง/ที่มา/จำนวนที่ผังวาด · ชื่อแท็บชุดเดียว')
}

console.log('\n✅ water-system: ผ่านทุกข้อ')
