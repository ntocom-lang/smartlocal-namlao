// ระบบน้ำของตำบล (ฤดูแล้ง เฟส 5 · PR 5.2) — ตรรกะ + ความสอดคล้องของทะเบียน + ข้อความบังคับ + ล็อกว่าไม่เพิ่มงานเจ้าหน้าที่
// ดีไซน์ฉบับปิด: docs/water-system.md · รันด้วย: node tests/water-system.test.mjs
//
// จุดที่ต้องไม่พลาด:
//  (1) อปท. ที่ไม่มีระบบไม่เห็นหัวข้อนี้ · ?system= ใช้ได้เฉพาะ demo
//  (2) ทะเบียน: ทุกโหนดมีที่มา · id ไม่ซ้ำ · ความสัมพันธ์ของอ่าง/สถานีครบ ตรงกับโหนด · ไม่มีความจุจากผัง · ไม่มีคำต้องห้าม
//  (3) แนวโน้มอ่าง: ค่าว่างไม่เป็น 0 · ไม่ลากเส้นข้ามช่องว่าง · ไม่ครบ 7 วัน = "กำลังเก็บ" · ไม่มีคำพยากรณ์
//  (4) อายุผังคำนวณเอง (30 เดือน ไม่ใช่ 17) · แถบเหลืองที่ 36 เดือน
//  (5) ไม่มีช่องกรอก/ฟอร์มในส่วนนี้ · ปุ่มมีแค่ย่อ/ขยายรายการ
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  NODE_KINDS, NODE_ROLES, NODE_STATUSES, NO_LIVE_TEXT, RELATIONS, RELATION_KEYS, STALE_DIAGRAM_MONTHS, SYSTEMS, SYSTEM_DISCLAIMER,
  SYSTEM_DISCLAIMER_LINE, SYSTEM_PREVIEW_SCOPES, TREND_MIN_DAYS, TREND_WINDOW_DAYS, UPSTREAM_DEPTH_NOTE, WATER_SYSTEM_TENANTS,
  ageText, bangkokISODate, damTrendSummary, diagramAge, liveState, monthsBetween, relationOf, resolveSystem, systemById, systemTenant,
  thaiDate, trendChart, trendFactText,
} from '../src/lib/waterSystem/model.js'
import { NAMLAO_SYSTEM } from '../src/lib/waterSystem/namlao.js'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const DAY = 86_400_000
const bkkMidnight = iso => Date.parse(`${iso}T00:00:00+07:00`)

// ── 1) ใครเห็นระบบ ──
{
  assert.deepEqual(Object.keys(WATER_SYSTEM_TENANTS).sort(), ['demo', 'namlao'])
  assert.deepEqual(Object.keys(SYSTEMS), ['namlao'])
  assert.equal(systemTenant('namlao').scope, '')
  assert.equal(systemTenant('demo').scope, 'ข้อมูลจริงของน้ำเลา ใช้สาธิต', 'demo ต้องบอกว่าเป็นข้อมูลจริงของน้ำเลา')
  for (const other of ['tamnaktham', 'thungkaew', 'cmu', '', undefined, null, '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(systemTenant(other), null, `${other} ต้องไม่เห็นระบบน้ำ`)
    assert.equal(resolveSystem(other, 'namlao'), null, `${other} ต้องไม่เห็นแม้ใส่ ?system=`)
  }
  assert.deepEqual(resolveSystem('namlao'), { system: 'namlao', scope: '' })
  assert.deepEqual(resolveSystem('demo'), { system: 'namlao', scope: 'ข้อมูลจริงของน้ำเลา ใช้สาธิต' })
  assert.deepEqual(resolveSystem('demo', 'namlao'), { system: 'namlao', scope: SYSTEM_PREVIEW_SCOPES.namlao })
  assert.deepEqual(resolveSystem('namlao', 'namlao'), { system: 'namlao', scope: '' }, 'อปท. จริงเมิน ?system= — ไม่ติดป้ายสาธิต')
  for (const bad of ['cmu', 'nope', '', null, undefined, '__proto__', 'constructor', 'toString']) {
    assert.equal(resolveSystem('demo', bad).system, 'namlao', `demo + ?system=${bad} ต้องกลับค่าเริ่มต้น`)
    assert.equal(resolveSystem('namlao', bad).system, 'namlao')
  }
  assert.equal(systemById('namlao'), NAMLAO_SYSTEM)
  for (const bad of ['nope', '', null, undefined, '__proto__', 'constructor']) assert.equal(systemById(bad), null)
  console.log('✓ ทะเบียน: เฉพาะ namlao + demo เห็นระบบน้ำ · อปท. อื่น/คีย์ prototype ไม่เห็น · ?system= ถูกเมินนอก demo')
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
  assert.equal(bangkokISODate(Date.parse('2026-10-11T17:00:00Z')), '2026-10-12', 'เที่ยงคืนไทย = 17:00 UTC ของวันก่อน ห้ามตัดวันที่จาก UTC')
  console.log('✓ คำกำกับบังคับครบ · อายุผัง 29 เดือน = "2 ปี 5 เดือน" · แถบเหลืองที่ 36 เดือนพอดี · วันที่ไทยไม่เพี้ยนจาก UTC')
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

// ── 7) แนวโน้มอ่าง ──
{
  const day = (iso, extra = {}) => ({ recorded_at: new Date(bkkMidnight(iso)).toISOString(), storage_percent: 90, storage_mcm: 6.0, capacity_mcm: 6.76, ...extra })
  const isoDay = n => bangkokISODate(bkkMidnight('2026-10-01') + n * DAY)
  const series = (n, f = i => ({})) => Array.from({ length: n }, (_, i) => day(isoDay(i), f(i)))

  assert.deepEqual(damTrendSummary(undefined), { state: 'none', days: 0 })
  assert.deepEqual(damTrendSummary([]), { state: 'none', days: 0 })
  assert.deepEqual(damTrendSummary([{ recorded_at: 'ไม่ใช่วันที่' }]), { state: 'none', days: 0 })

  const six = damTrendSummary(series(6))
  assert.equal(six.state, 'building'); assert.equal(six.needDays, 1); assert.equal(six.days, 6)
  assert.equal(damTrendSummary(series(1)).needDays, TREND_MIN_DAYS - 1)
  assert.equal(damTrendSummary(series(TREND_MIN_DAYS)).state, 'ready', `ครบ ${TREND_MIN_DAYS} วันพอดีต้องแสดง`)
  // ห่างกัน 8 วันแต่มีแค่ 2 แถว ไม่ใช่แนวโน้ม
  const sparse = damTrendSummary([day('2026-10-01'), day('2026-10-09')])
  assert.equal(sparse.state, 'building'); assert.equal(sparse.needDays, 5)
  assert.equal(TREND_WINDOW_DAYS, 30)

  // ค่าลดลง: ข้อเท็จจริง ไม่พยากรณ์
  const down = damTrendSummary(series(10, i => ({ storage_percent: 100 - i * 2, storage_mcm: 6.76 - i * 0.1 })))
  assert.equal(down.state, 'ready'); assert.equal(down.facts.dir, 'down'); assert.equal(down.facts.mcm, 0.9)
  assert.equal(down.facts.pctOfCapacity, 13.3)
  assert.equal(trendFactText(down.facts), '10 วันที่ผ่านมา ปริมาณน้ำในอ่างลดลง 0.9 ล้าน ลบ.ม. (13.3% ของความจุ)')
  assert.equal(damTrendSummary(series(8, i => ({ storage_mcm: 4 + i * 0.5 }))).facts.dir, 'up')
  const flat = damTrendSummary(series(8))
  assert.equal(flat.facts.dir, 'flat'); assert.equal(trendFactText(flat.facts), '8 วันที่ผ่านมา ปริมาณน้ำในอ่างเท่าเดิม')
  assert.equal(trendFactText(null), '')
  for (const text of [trendFactText(down.facts), trendFactText(flat.facts)]) {
    for (const word of ['เหลืออีก', 'จะหมด', 'จะเต็ม', 'คาด', 'พยากรณ์', 'วันที่น้ำ']) assert.ok(!text.includes(word), `ข้อความแนวโน้มห้ามมี "${word}"`)
  }

  // ค่าว่างไม่เป็น 0 · 0 จริงยังเป็น 0
  const blank = damTrendSummary(series(8, i => (i === 3 ? { storage_percent: null } : {})))
  assert.equal(blank.chart.segments, 1, 'ค่า % ว่าง 1 วันไม่ทำให้เส้นขาด (ไม่ใช่ช่องว่างเกิน 48 ชม.) และไม่เป็น 0')
  assert.ok(blank.chart.min >= 90, 'ค่าว่างต้องไม่ถูกนับเป็น 0')
  const zero = damTrendSummary(series(8, i => (i === 7 ? { storage_percent: 0 } : {})))
  assert.equal(zero.chart.min, 0, '0% จริงต้องเป็น 0')
  assert.equal(damTrendSummary(series(8, () => ({ storage_percent: null }))).state, 'none', 'ไม่มี % สักแถว = ไม่วาดกราฟ')

  // ช่องว่างเกิน 48 ชม. ตัดเส้น ไม่ลากข้าม
  const gap = damTrendSummary([...series(4), ...Array.from({ length: 4 }, (_, i) => day(isoDay(8 + i)))])
  assert.equal(gap.state, 'ready'); assert.equal(gap.chart.segments, 2, 'ข้อมูลหาย 4 วันต้องตัดเส้นเป็น 2 ช่วง')
  // สเกลกราฟคงที่ 0–100% ไม่ขยายตามข้อมูล (ลดลง 9% ต้องไม่ดูเหมือนเทลงหมดถัง) · เกิน 100 ขยายเพดานเท่าที่ต้อง
  const c90 = damTrendSummary(series(8, () => ({ storage_percent: 90 }))).chart
  assert.equal(c90.top, 100); assert.match(c90.paths[0], /^M5 11\.2 /, '90% ต้องอยู่ที่ 90% ของความสูงที่ใช้ได้ (y = 72 - 5 - 0.9 × 62 = 11.2)')
  const c50 = damTrendSummary(series(8, () => ({ storage_percent: 50 }))).chart
  assert.match(c50.paths[0], /^M5 36 /, '50% ต้องอยู่กึ่งกลาง')
  assert.equal(damTrendSummary(series(8, () => ({ storage_percent: 120 }))).chart.top, 120, 'ค่าเกิน 100 ขยายเพดานตามจริง ไม่ตัดทิ้ง')
  assert.equal(trendChart([]), null); assert.equal(trendChart(null), null)
  const lone = trendChart([{ t: 1, v: 40 }]); assert.equal(lone.paths.length, 0); assert.equal(lone.dots.length, 1)
  // เรียงเวลาเอง
  assert.equal(damTrendSummary(series(8).reverse()).state, 'ready')
  console.log('✓ แนวโน้มอ่าง: <7 วัน=กำลังเก็บ (นับวันที่ต่างกัน) · ครบ 7 แสดง · ข้อเท็จจริงลด/เพิ่ม/เท่าเดิม ไม่มีคำพยากรณ์ · ค่าว่างไม่เป็น 0 · ตัดเส้นที่ช่องว่าง')
}

// ── 8) ส่วนหน้าจอ: ไม่เพิ่มงานเจ้าหน้าที่ + ต่อหน้าถูกจุด ──
{
  const comp = read('src/components/water/WaterSystem.jsx')
  const code = comp.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  for (const tag of ['<input', '<textarea', '<select', '<form', 'contentEditable', 'contenteditable', 'onSubmit']) {
    assert.ok(!code.includes(tag), `ส่วนนี้อ่านอย่างเดียว ห้ามมี ${tag}`)
  }
  const buttons = [...code.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(m => m[0])
  assert.ok(buttons.length >= 1 && buttons.every(b => b.includes('type="button"') && b.includes('setOpen(')), 'ปุ่มมีแค่ย่อ/ขยายรายการ')
  assert.ok(!/supabase\.from|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(code), 'ห้ามเขียนข้อมูล')
  assert.ok(code.includes('SYSTEM_DISCLAIMER_LINE'), 'ต้องแสดงคำกำกับบังคับ')
  assert.ok(code.includes('UPSTREAM_DEPTH_NOTE') && code.includes('NO_LIVE_TEXT'))
  assert.ok(code.includes('data-system-omitted') && code.includes('data-system-source'), 'ต้องมีกล่อง "ผังมีแต่ไม่ได้ใส่" และ "ที่มา"')
  for (const word of ['เหลืออีก', 'จะหมด', 'พยากรณ์ว่า', 'ปกติดี', 'ปลอดภัยแล้ว']) assert.ok(!code.includes(word), `คอมโพเนนต์ห้ามมี "${word}"`)

  const hook = read('src/components/water/useDamHistory.js')
  assert.ok(hook.includes("'get_public_dam_history'") && hook.includes('TREND_WINDOW_DAYS'), 'เรียกฟังก์ชันประวัติอ่าง 30 วันเท่านั้น')
  assert.ok((hook.match(/supabase\.rpc\(/g) || []).length === 1, 'เรียกครั้งเดียวต่อการเปิดหน้า')
  assert.ok(!hook.includes('setInterval'), 'อ่างส่งรายวัน ไม่ต้องถามถี่')

  const page = read('src/pages/WaterSituationPage.jsx')
  assert.ok(/const WaterSystem = lazy\(\(\) => import\('\.\.\/components\/water\/WaterSystem'\)\)/.test(page), 'WaterSystem ต้องโหลดแบบ lazy')
  assert.ok(!/^import WaterSystem/m.test(page), 'ห้าม import WaterSystem ตรงๆ (อปท. ที่ไม่มีระบบไม่ควรโหลดโค้ดนี้)')
  assert.ok(page.includes("resolveSystem(tenant?.slug, searchParams.get('system'))"))
  assert.ok(/\{waterSystem && \(\s*<Suspense fallback=\{null\}>\s*<WaterSystem/.test(page), 'ส่วนนี้ขึ้นเฉพาะ อปท. ที่มีระบบ')
  assert.equal(page.split('system={waterSystem}').length - 1, 2, 'ส่ง system ให้ทั้งส่วนอ่างและส่วนระดับน้ำ เพื่อติดป้ายความสัมพันธ์')
  assert.ok(page.includes("relationOf(system, 'dam', s.station_code)") && page.includes("relationOf(system, 'waterlevel', s.station_code)"))
  assert.ok(page.includes('id={`water-dam-${s.station_code}`}'), 'การ์ดอ่างต้องมีจุดยึดให้ลิงก์จากส่วนระบบน้ำ')
  // ภาพแชร์ (snapshot) ต้องไม่เปลี่ยน — ไม่ส่ง system
  assert.ok(/<DamSection stations=\{dams\} homeAmphoe=\{tenant\.district\} now=\{now\} snapshot \/>/.test(page), 'การ์ดสำหรับภาพแชร์ต้องคงเดิม')
  // ตัวกรอง Y.38 ของน้ำเลายังอยู่ (ไม่แตะ)
  assert.ok(page.includes("s.station_code === 'Y.38'"))
  console.log('✓ หน้าจอ: อ่านอย่างเดียว (ไม่มี input/form/เขียนข้อมูล · ปุ่มแค่ย่อ/ขยาย) · lazy เฉพาะ อปท. ที่มีระบบ · เรียกประวัติครั้งเดียว · ภาพแชร์ไม่เปลี่ยน')
}

console.log('\n✅ water-system: ผ่านทุกข้อ')
