// ห้องผู้บริหารแบบเรียบ — ข้อมูลเชิงรุก (สรุปวันนี้ · ภัยที่กำลังมา · ปัญหาซ้ำซาก · กำหนดตามระเบียบ) — src/lib/execSimpleInsights.js
//   ชั้นแรก: ฟังก์ชัน pure ของจริง (เกณฑ์ขอบ 35.0/35.1 · 37.5/37.6/75.1 · นับวันถอยหลัง · จัดลำดับ/โควตา · สรุป ≤ 3 บรรทัด)
//   ชั้นสอง: อ่านซอร์ส — ฮุกไม่มี interval/ไม่ดึงเกินรอบ · ไม่มีข้อมูลส่วนบุคคล · ทุกแถวมีกฎ (rule) · สายไฟในหน้าจอ
// ไม่ต่อเน็ต ไม่ใช้บัญชี · โซนเวลาเครื่องตั้งเป็นต่างประเทศ: โค้ดที่อ่านเวลาจากเครื่องแทนเวลาไทยจะพังในเคสข้ามวัน
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.TZ = 'America/Los_Angeles'

const I = await import('../src/lib/execSimpleInsights.js')
const { normalizeForecast } = await import('../src/lib/tmdForecast.js')
const { normalizeComplaintsSummary } = await import('../src/lib/executiveData.js')
const { simpleAlertWords } = await import('../src/lib/execSimpleView.js')

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const bkk = (day, hhmm) => new Date(`${day}T${hhmm}:00+07:00`)
const SHAPE_KEYS = ['id', 'kind', 'tone', 'what', 'count', 'unit', 'showCount', 'detail', 'rule', 'target', 'words']
const seen = [] // insight ทุกตัวที่เทสต์สร้าง — ตรวจรูปร่าง + rule ไม่ว่างตอนท้าย
const keep = (it) => { if (it) seen.push(it); return it }

// ── ภัย: ฝนหนัก ──────────────────────────────────────────────────────────────

const NOW = bkk('2026-11-15', '10:30')
const forecastOf = (rains, dailyFetchedAt = '2026-11-15T09:00:00+07:00') => normalizeForecast({
  daily: rains.map((rain, i) => ({ time: `2026-11-${String(15 + i).padStart(2, '0')}T00:00:00+07:00`, rain, tc_max: 30, tc_min: 22, cond: 3 })),
  daily_fetched_at: dailyFetchedAt,
})

test('ฝนหนัก: ขอบ 35.0 ไม่ขึ้น · 35.1 ขึ้นสีส้ม (พรุ่งนี้) · 90.1 สีแดง · ไม่มีพยากรณ์ = null', () => {
  assert.equal(I.heavyRainInsight(forecastOf([0, 35.0, 10]), NOW), null, '35.0 = ฝนปานกลาง ยังไม่ถึงเกณฑ์')
  const amber = keep(I.heavyRainInsight(forecastOf([0, 35.1, 10]), NOW))
  assert.equal(amber.id, 'hazard:heavy_rain')
  assert.equal(amber.kind, 'hazard')
  assert.equal(amber.tone, 'amber')
  assert.equal(amber.what, 'พยากรณ์ฝนหนักพรุ่งนี้ (16 พ.ย.)')
  assert.equal(amber.count, 35.1)
  assert.equal(amber.unit, 'มม.')
  assert.equal(amber.detail, 'ที่มา: กรมอุตุนิยมวิทยา · เป็นพยากรณ์ ยังไม่ใช่เหตุที่เกิดแล้ว')
  assert.deepEqual(amber.target, { path: '/water-situation' })
  assert.equal(amber.words.go, 'ดูพยากรณ์และสถานการณ์น้ำ')
  assert.ok(amber.brief.includes('พรุ่งนี้ (16 พ.ย.) พยากรณ์ฝนหนัก 35.1 มม. — ควรเตรียมรับมือ'))
  const red = keep(I.heavyRainInsight(forecastOf([0, 0, 90.1]), NOW))
  assert.equal(red.tone, 'red')
  assert.ok(red.what.startsWith('พยากรณ์ฝนหนัก'))
  assert.equal(I.heavyRainInsight(null, NOW), null)
  assert.equal(I.heavyRainInsight(forecastOf([null, null, null]), NOW), null, 'null ไม่ใช่ฝนหนัก')
})

test('ฝนหนัก: ปัดมม. 1 ตำแหน่ง · เกินวันนี้+2 วันไม่นับ · ชุดรายวันเก่าเกิน 12 ชม. = null (ไม่พูดถึงพยากรณ์ที่ไม่เป็นปัจจุบัน)', () => {
  assert.equal(keep(I.heavyRainInsight(forecastOf([0, 42.46, 0]), NOW)).count, 42.5)
  assert.equal(I.heavyRainInsight(forecastOf([0, 0, 0, 80]), NOW), null, 'วันที่ 4 อยู่นอกช่วง 3 วัน')
  assert.equal(I.heavyRainInsight(forecastOf([40, 0, 0], '2026-11-14T21:00:00+07:00'), NOW), null, 'ดึงมา 13.5 ชม. ก่อน = เก่า')
  assert.ok(I.heavyRainInsight(forecastOf([40, 0, 0], '2026-11-14T23:00:00+07:00'), NOW), 'ดึงมา 11.5 ชม. ยังใช้ได้')
  assert.ok(I.heavyRainInsight(forecastOf([40, 0, 0]), NOW).what.includes('วันนี้ (15 พ.ย.)'))
})

// ── ภัย: ฝุ่น ────────────────────────────────────────────────────────────────

const TENANT = { province: 'จังหวัดแพร่', latitude: 18.14, longitude: 100.14 }
const station = (id, name, pm25, over = {}) => ({
  id, name, area: `ต.ทดสอบ อ.เมือง, แพร่`, province: 'แพร่', lat: 18.14, lon: 100.14, pm25, aqi: 80, aqiPollutant: 'PM25',
  measuredAt: '2026-11-15T09:00:00+07:00', ...over,
})
const feedOf = (...stations) => ({ source: 'Air4Thai', stations })

test('ฝุ่น: 37.5 ไม่ขึ้น · 37.6 ขึ้นสีส้ม · 75 ยังส้ม · 75.1 แดง · ค่า/ข้อความถูกต้อง', () => {
  assert.equal(I.pm25Insight(feedOf(station('a', 'สถานีหนึ่ง', 37.5)), TENANT, NOW), null)
  const amber = keep(I.pm25Insight(feedOf(station('a', 'สถานีหนึ่ง', 37.6)), TENANT, NOW))
  assert.equal(amber.tone, 'amber')
  assert.equal(amber.id, 'hazard:pm25')
  assert.equal(amber.what, 'ฝุ่น PM2.5 เริ่มมีผลกระทบต่อสุขภาพ')
  assert.equal(amber.count, 37.6)
  assert.equal(amber.unit, 'มคก./ลบ.ม.')
  assert.ok(amber.detail.startsWith('สถานี สถานีหนึ่ง · ค่าเฉลี่ย 24 ชม. · วัดเมื่อ '))
  assert.deepEqual(amber.target, { path: '/pm25' })
  assert.equal(amber.words.go, 'ดูสถานการณ์ PM2.5')
  assert.equal(keep(I.pm25Insight(feedOf(station('a', 'ก', 75)), TENANT, NOW)).tone, 'amber')
  const red = keep(I.pm25Insight(feedOf(station('a', 'ก', 75.1)), TENANT, NOW))
  assert.equal(red.tone, 'red')
  assert.equal(red.what, 'ฝุ่น PM2.5 มีผลกระทบต่อสุขภาพ')
})

test('ฝุ่น: สถานีเก่าเกิน 3 ชม./ค่าว่าง = ไม่เตือนจากค่าเก่า · ข้ามไปสถานีถัดไปที่สด · ไม่มีสถานี/ฟีดเสีย = null', () => {
  const old = station('a', 'เก่า', 120, { measuredAt: '2026-11-15T06:00:00+07:00' }) // 4.5 ชม. ก่อน
  assert.equal(I.pm25Insight(feedOf(old), TENANT, NOW), null)
  assert.equal(I.pm25Insight(feedOf(station('a', 'ว่าง', null)), TENANT, NOW), null)
  // สถานีใกล้สุดเก่า → ใช้สถานีถัดไปตามระยะที่สด (ตรรกะเดียวกับหน้า PM2.5)
  const near = station('a', 'ใกล้แต่เก่า', 120, { measuredAt: '2026-11-15T05:00:00+07:00' })
  const far = station('b', 'ไกลแต่สด', 50, { lat: 18.3, lon: 100.3 })
  const picked = keep(I.pm25Insight(feedOf(near, far), TENANT, NOW))
  assert.ok(picked.detail.includes('ไกลแต่สด'))
  assert.equal(picked.count, 50)
  assert.equal(I.pm25Insight(feedOf(), TENANT, NOW), null)
  assert.equal(I.pm25Insight(null, TENANT, NOW), null)
  assert.equal(I.pm25Insight({ stations: 'x' }, TENANT, NOW), null)
  // ข้ามจังหวัด/ไกลเกิน 150 กม. ไม่นับ
  assert.equal(I.pm25Insight(feedOf(station('a', 'ไกลมาก', 90, { province: 'เชียงราย', lat: 20.5, lon: 100.2 })), { ...TENANT, province: 'จังหวัดอุบลราชธานี' }, NOW), null)
})

// ── ปัญหาซ้ำซาก ──────────────────────────────────────────────────────────────

const complaintsOf = (groups) => normalizeComplaintsSummary({ repeat: { days: 90, min: 3, groups } })
const G = (label, village, n) => ({ category: label, label, village, n })

test('ปัญหาซ้ำซาก: ไม่มีกลุ่ม/ข้อมูลว่าง = null · มีกลุ่ม → 3 กลุ่มแรกใน detail · count = จำนวนกลุ่มทั้งหมด · แนะนำไม่ใช่คำสั่ง', () => {
  assert.equal(I.repeatInsight(complaintsOf([])), null)
  assert.equal(I.repeatInsight(null), null)
  assert.equal(I.repeatInsight(normalizeComplaintsSummary(null)), null)
  const it = keep(I.repeatInsight(complaintsOf([G('ไฟฟ้าส่องสว่าง', 'หมู่ 5', 6), G('ถนนชำรุด', 'หมู่ 2', 4), G('น้ำท่วม', 'หมู่ 7', 3), G('ขยะ', 'หมู่ 1', 3)])))
  assert.equal(it.id, 'pattern:repeat')
  assert.equal(it.kind, 'pattern')
  assert.equal(it.tone, 'amber')
  assert.equal(it.what, 'ปัญหาเดิมเกิดซ้ำในหมู่บ้านเดียวกัน (90 วัน)')
  assert.equal(it.count, 4)
  assert.equal(it.unit, 'จุด')
  assert.equal(it.detail, 'หมู่ 5 · ไฟฟ้าส่องสว่าง 6 เรื่อง · หมู่ 2 · ถนนชำรุด 4 เรื่อง · หมู่ 7 · น้ำท่วม 3 เรื่อง')
  assert.ok(!it.detail.includes('ขยะ'), 'แสดงแค่ 3 กลุ่มแรก')
  assert.equal(it.hint, 'แจ้งซ้ำหลายครั้ง อาจควรพิจารณาแก้ถาวร เช่น ตั้งเป็นโครงการ')
  assert.deepEqual(it.target, { module: 'complaints' })
  assert.equal(it.words.go, 'ดูคำร้อง')
  assert.ok(it.rule.includes('ตั้งแต่ 3 เรื่องขึ้นไปใน 90 วันล่าสุด'))
})

// ── กำหนดตามระเบียบ ──────────────────────────────────────────────────────────

const DEV = { id: 'd1', year_from: 2566, year_to: 2570, status: 'published', is_current: true }
const ids = (list) => list.map((x) => x.id)
const evalReport = (today, evaluation = null, devPlan = DEV) => planDeadlineInsights({ devPlan, opPlan: null, evaluation, today }).find((x) => x.id === 'deadline:eval_report')
const { planDeadlineInsights } = I

test('ติดตามและประเมินผลประจำปี: 1 พ.ย. 2569 เหลือ 60 วัน ขึ้น · 31 ต.ค. ไม่ขึ้น · ทำแล้วไม่ขึ้น', () => {
  const r = keep(evalReport('2026-11-01'))
  assert.ok(r, '60 วันพอดีต้องขึ้น')
  assert.equal(r.kind, 'deadline')
  assert.equal(r.tone, 'amber')
  assert.equal(r.what, 'ติดตามและประเมินผลแผนพัฒนา ปีงบ 2569 — เหลือ 60 วัน (ภายใน 31 ธ.ค. 2569)')
  assert.equal(r.daysLeft, 60)
  assert.deepEqual(r.target, { module: 'local-plan' })
  assert.equal(r.words.go, 'ดูแผนพัฒนา')
  assert.equal(evalReport('2026-10-31'), undefined, '61 วัน ยังไม่ขึ้น')
  assert.ok(evalReport('2026-12-31'), 'วันสุดท้ายยังขึ้น')
  assert.ok(evalReport('2026-12-31').what.includes('ครบกำหนดวันนี้'))
  assert.equal(evalReport('2026-11-20', { fiscal_year: 2569, reported_to_exec_on: '2026-11-10', presented_on: null }), undefined, 'คณะกรรมการรายงานผู้บริหารแล้ว = ทำแล้ว')
  assert.equal(evalReport('2026-11-20', { fiscal_year: 2569, reported_to_exec_on: null, presented_on: '2026-11-18' }), undefined, 'เสนอสภาแล้ว = ทำแล้ว')
  assert.ok(evalReport('2026-11-20', { fiscal_year: 2569, reported_to_exec_on: null, presented_on: null }), 'มีแถวแต่ยังไม่มีวันที่ = ยังไม่ทำ')
  assert.ok(evalReport('2026-11-20', { fiscal_year: 2568, reported_to_exec_on: '2025-12-01' }), 'แถวของปีงบอื่นไม่นับ')
  assert.ok(evalReport('2026-11-20', null), 'ไม่มีแถว = ยังไม่ทำ')
})

test('ติดตามและประเมินผลประจำปี: 15 ม.ค. 2570 เลย 15 วัน แดง · 15 เม.ย. 2570 เลิกเตือน (เลย 90 วัน) · ไม่มีแผนพัฒนา/ไม่รู้ข้อมูล = ไม่เตือน', () => {
  const late = keep(evalReport('2027-01-15'))
  assert.equal(late.tone, 'red')
  assert.equal(late.what, 'ติดตามและประเมินผลแผนพัฒนา ปีงบ 2569 — เลยกำหนดมา 15 วัน (ภายใน 31 ธ.ค. 2569)')
  assert.ok(evalReport('2027-03-31'), 'เลย 90 วันพอดียังขึ้น')
  assert.equal(evalReport('2027-04-01'), undefined, 'เลย 91 วัน เลิกเตือน')
  assert.equal(evalReport('2027-04-15'), undefined)
  assert.equal(evalReport('2026-11-20', null, null), undefined, 'ไม่มีแผนพัฒนา = อปท. นี้ไม่ได้ใช้เมนูแผน ไม่เตือน')
  assert.equal(planDeadlineInsights({ devPlan: DEV, opPlan: null, evaluation: undefined, today: '2026-11-20' }).length, 0, 'evaluation undefined = ยังไม่รู้ ไม่เดา')
  assert.deepEqual(planDeadlineInsights({ devPlan: null, opPlan: null, evaluation: null, today: '2026-11-20' }), [])
  assert.deepEqual(planDeadlineInsights({ devPlan: DEV, opPlan: null, evaluation: null, today: 'x' }), [])
})

test('แผนการดำเนินงาน (ข้อ 27): เหลือ ≤ 7 วัน = ส้ม · วันนี้ = ส้ม · เลยกำหนด = แดง · ยังเหลือมาก/ประกาศแล้ว/ไม่มีวันตั้งต้น = ไม่ขึ้น', () => {
  const op = (over = {}) => ({ basis: 'annual_budget', basis_on: '2026-10-15', status: 'draft', published_on: null, extended_due_on: null, ...over })
  const at = (today, opPlan) => planDeadlineInsights({ devPlan: null, opPlan, evaluation: undefined, today }).find((x) => x.id === 'deadline:op_plan')
  // ตั้งต้น 15 ต.ค. → ครบ 14 พ.ย. (ข้อ 27 นับ 30 วัน)
  const soon = keep(at('2026-11-10', op()))
  assert.equal(soon.tone, 'amber')
  assert.equal(soon.daysLeft, 4)
  assert.ok(soon.what.includes('ใกล้ครบกำหนดจัดทำแผนการดำเนินงาน (ข้อ 27): เหลือ 4 วัน'))
  assert.ok(at('2026-11-07', op()), 'เหลือ 7 วัน = ขึ้น')
  assert.equal(at('2026-11-06', op()), undefined, 'เหลือ 8 วัน = ยังไม่ขึ้น')
  assert.ok(at('2026-11-14', op()).what.startsWith('วันนี้ครบกำหนดจัดทำแผนการดำเนินงาน'))
  const over = keep(at('2026-11-20', op()))
  assert.equal(over.tone, 'red')
  assert.ok(over.what.includes('เกินกำหนดจัดทำแผนการดำเนินงาน (ข้อ 27) มา 6 วัน'))
  assert.equal(at('2026-11-20', op({ status: 'published', published_on: '2026-11-01' })), undefined, 'ประกาศแล้ว')
  assert.equal(at('2026-11-20', op({ basis_on: null })), undefined, 'ไม่มีวันตั้งต้น = คำนวณไม่ได้ ไม่เดา')
  assert.equal(at('2026-11-20', op({ extended_due_on: '2026-12-31' })), undefined, 'ขยายเวลาแล้วยังไม่ถึง')
  assert.equal(at('2026-11-20', null), undefined)
})

test('แผนพัฒนา (ข้อ 22) ขึ้นเฉพาะ "ใกล้ปิดหน้าต่างแก้" · ประกาศผลประเมิน (ข้อ 29(3)) ขึ้นเมื่อ ≤ 5 วัน/เลยกำหนด', () => {
  const amend = (today, devPlan = DEV) => planDeadlineInsights({ devPlan, opPlan: null, evaluation: undefined, today }).find((x) => x.id === 'deadline:dev_amend')
  // แผนสิ้นอายุ 30 ก.ย. 2570 (2027-09-30) → วันสุดท้ายที่แก้ได้ = 2027-04-03
  const a = keep(amend('2027-03-20'))
  assert.equal(a.tone, 'amber')
  assert.equal(a.daysLeft, 14)
  assert.ok(a.what.includes('เหลือ 14 วัน จะถึงวันสุดท้ายที่เพิ่มเติม/เปลี่ยนแปลงแผนพัฒนาได้'))
  assert.equal(amend('2027-01-01'), undefined, 'open = ไม่ขึ้น')
  assert.equal(amend('2027-05-01'), undefined, 'closed = ไม่ใช่ข้อมูลล่วงหน้า ไม่ขึ้นแถวเตือนนี้')
  const ann = (today, evaluation) => planDeadlineInsights({ devPlan: DEV, opPlan: null, evaluation, today }).find((x) => x.id === 'deadline:eval_announce')
  const ev = { fiscal_year: 2569, presented_on: '2026-12-10', announced_on: null, reported_to_exec_on: '2026-12-01' } // ครบ 25 ธ.ค.
  const soon = keep(ann('2026-12-22', ev))
  assert.equal(soon.daysLeft, 3)
  assert.ok(soon.what.includes('ใกล้ครบกำหนดประกาศผลการติดตามและประเมินผล (ข้อ 29(3)): เหลือ 3 วัน'))
  assert.equal(ann('2026-12-19', ev), undefined, 'เหลือ 6 วัน ยังไม่ขึ้น')
  assert.equal(ann('2026-12-22', { ...ev, announced_on: '2026-12-20' }), undefined, 'ประกาศแล้ว')
  assert.equal(keep(ann('2026-12-30', ev)).tone, 'red')
  assert.equal(ann('2026-12-30', { fiscal_year: 2569, presented_on: null }), undefined, 'ไม่มีวันเสนอ = คำนวณไม่ได้')
})

test('กำหนดหลายตัว: เรียงเลยกำหนดก่อน แล้ววันใกล้สุดก่อน · ทุกตัวมี rule ที่ระบุ "เตือนเท่านั้น ไม่บล็อก" + ต้องยืนยันกับระเบียบฉบับปัจจุบัน', () => {
  const op = { basis: 'annual_budget', basis_on: '2026-10-15', status: 'draft' } // ครบ 14 พ.ย.
  const list = planDeadlineInsights({ devPlan: DEV, opPlan: op, evaluation: null, today: '2026-11-10' }) // op เหลือ 4 · eval_report เหลือ 51
  assert.deepEqual(ids(list), ['deadline:op_plan', 'deadline:eval_report'])
  const list2 = planDeadlineInsights({ devPlan: DEV, opPlan: op, evaluation: null, today: '2026-11-20' }) // op เลย 6 · eval_report เหลือ 41
  assert.deepEqual(ids(list2), ['deadline:op_plan', 'deadline:eval_report'])
  assert.equal(list2[0].tone, 'red')
  for (const it of [...list, ...list2]) {
    keep(it)
    assert.ok(it.rule.includes('เตือนเท่านั้น ไม่บล็อก'), it.id)
    assert.ok(it.rule.includes('ต้องยืนยันกับระเบียบฉบับปัจจุบัน'), it.id)
    assert.equal(it.showCount, false)
  }
})

// ── จัดลำดับหัวข้อ ② ─────────────────────────────────────────────────────────

const reg = (id, label = 'เมนู') => ({ id, count: 2, unit: 'เรื่อง', showCount: true, entry: { label } })
const ins = (id, tone = 'amber', kind = 'deadline') => ({ id, kind, tone, what: id, count: 1, unit: '', showCount: false, detail: null, rule: 'กฎ', target: {}, words: { what: id, unit: '', go: 'ดู' } })

test('composeKnowRows: ภัยขึ้นบนสุดและไม่กินโควตา · overdue5 แถวของตัวเอง ไม่กินโควตา', () => {
  const k = I.composeKnowRows({
    hazards: [ins('hazard:heavy_rain', 'red', 'hazard'), ins('hazard:pm25', 'amber', 'hazard')],
    overdue5: { count: 4, items: [] },
    major: [reg('complaints:low_rating'), reg('projects:behind'), reg('water-situation:event_open')],
    minor: [reg('fleet:incidents')],
  })
  assert.deepEqual(ids(k.hazards), ['hazard:heavy_rain', 'hazard:pm25'])
  assert.equal(k.featured.length, 3, 'โควตา 3 ไม่รวมภัยและเรื่องช้า 5 วันทำการ')
  assert.deepEqual(ids(k.featured), ['complaints:low_rating', 'projects:behind', 'water-situation:event_open'])
  assert.deepEqual(ids(k.minor), ['fleet:incidents'])
  assert.equal(k.overdue5.count, 4)
  assert.equal(k.total, 2 + 1 + 3 + 1)
})

test('composeKnowRows: ลำดับโควตา = ทะเบียนเดิม → กำหนดแดง → ซ้ำซาก → กำหนดที่เหลือ · ส่วนล้นไป minor (ไม่หาย) ก่อนเรื่องเล็กเดิม', () => {
  const red = ins('deadline:op_plan', 'red')
  const amber = ins('deadline:dev_amend', 'amber')
  const repeat = ins('pattern:repeat', 'amber', 'pattern')
  // ไม่มีของทะเบียน: แดง → ซ้ำซาก → ที่เหลือ
  let k = I.composeKnowRows({ deadlines: [amber, red], repeat })
  assert.deepEqual(ids(k.featured), ['deadline:op_plan', 'pattern:repeat', 'deadline:dev_amend'])
  assert.deepEqual(k.minor, [])
  // ทะเบียนเต็มโควตา: ล้นทั้งหมดไป minor (insight ก่อน แล้วตามด้วยเรื่องเล็กเดิม)
  k = I.composeKnowRows({ major: [reg('complaints:low_rating'), reg('projects:behind'), reg('projects:contract_past')], minor: [reg('fleet:incidents')], deadlines: [amber, red], repeat })
  assert.deepEqual(ids(k.featured), ['complaints:low_rating', 'projects:behind', 'projects:contract_past'])
  assert.deepEqual(ids(k.minor), ['deadline:op_plan', 'pattern:repeat', 'deadline:dev_amend', 'fleet:incidents'])
  assert.equal(k.total, 3 + 4)
  // ทะเบียน 2 แถว: เหลือที่ให้ 1 → กำหนดแดง
  k = I.composeKnowRows({ major: [reg('complaints:low_rating'), reg('projects:behind')], deadlines: [amber, red], repeat })
  assert.deepEqual(ids(k.featured), ['complaints:low_rating', 'projects:behind', 'deadline:op_plan'])
  assert.deepEqual(ids(k.minor), ['pattern:repeat', 'deadline:dev_amend'])
  // max กำหนดเองได้
  assert.equal(I.composeKnowRows({ major: [reg('complaints:low_rating'), reg('projects:behind')], max: 1 }).featured.length, 1)
})

test('composeKnowRows: มี deadline:op_plan แล้ว ตัด local-plan:no_published_plan ของทะเบียนออก (เรื่องเดียวกัน) · ไม่มี op_plan = คงไว้', () => {
  const npp = reg('local-plan:no_published_plan', 'แผนพัฒนาท้องถิ่น')
  let k = I.composeKnowRows({ major: [reg('complaints:low_rating'), npp], deadlines: [ins('deadline:op_plan', 'red')] })
  assert.ok(![...k.featured, ...k.minor].some((x) => x.id === 'local-plan:no_published_plan'))
  assert.deepEqual(ids(k.featured), ['complaints:low_rating', 'deadline:op_plan'])
  // อยู่ใน minor ก็ตัด
  k = I.composeKnowRows({ minor: [npp], deadlines: [ins('deadline:op_plan', 'amber')] })
  assert.ok(![...k.featured, ...k.minor].some((x) => x.id === 'local-plan:no_published_plan'))
  // กำหนดอย่างอื่น (ไม่ใช่ op_plan) ไม่ตัด
  k = I.composeKnowRows({ major: [npp], deadlines: [ins('deadline:dev_amend')] })
  assert.ok(ids(k.featured).includes('local-plan:no_published_plan'))
  k = I.composeKnowRows({ major: [npp] })
  assert.ok(ids(k.featured).includes('local-plan:no_published_plan'))
})

test('composeKnowRows: ของทะเบียนที่ล้นจากโควตาเดิมของ splitSimpleAlerts กลับมาเป็นแถวเด่นเมื่อมีที่ว่าง (หลังตัด no_published_plan) · ไม่มีอะไร = ว่างหมด total 0', () => {
  const npp = reg('local-plan:no_published_plan')
  const fourth = reg('projects:contract_past')
  // split เดิมให้ major = 3 ตัวแรก (รวม npp) และ fourth ไปอยู่ minor
  const k = I.composeKnowRows({ major: [reg('complaints:low_rating'), npp, reg('projects:behind')], minor: [fourth], deadlines: [ins('deadline:op_plan', 'red')] })
  assert.deepEqual(ids(k.featured), ['complaints:low_rating', 'projects:behind', 'projects:contract_past'])
  assert.deepEqual(ids(k.minor), ['deadline:op_plan'])
  const empty = I.composeKnowRows({})
  assert.deepEqual(empty, { hazards: [], overdue5: null, featured: [], minor: [], total: 0 })
  assert.equal(I.composeKnowRows({ hazards: [null, undefined] }).total, 0)
})

test('ป้ายหมวด (execKnowLabel): ทะเบียน = ชื่อเมนู · insight = ชื่อหมวดภาษาคน · simpleAlertWords ใช้ item.words ก่อนถ้ามี (ของเดิมไม่เปลี่ยน)', () => {
  assert.equal(I.execKnowLabel(reg('x', 'ยานพาหนะ')), 'ยานพาหนะ')
  assert.equal(I.execKnowLabel(ins('a', 'amber', 'hazard')), 'ภัยที่กำลังมา')
  assert.equal(I.execKnowLabel(ins('a', 'amber', 'deadline')), 'กำหนดตามระเบียบ')
  assert.equal(I.execKnowLabel(ins('a', 'amber', 'pattern')), 'ปัญหาซ้ำซาก')
  assert.equal(I.execKnowLabel({}), null)
  assert.deepEqual(simpleAlertWords(ins('deadline:op_plan')), { what: 'deadline:op_plan', unit: '', go: 'ดู' })
  assert.equal(simpleAlertWords({ id: 'projects:behind', entry: { label: 'โครงการ' } }).what, 'โครงการก่อสร้างช้ากว่าแผน')
})

// ── สรุปวันนี้ ───────────────────────────────────────────────────────────────

const BASE = {
  ready: true,
  sign: { status: 'ok', total: 0, over2wd: 0 },
  decisions: 0,
  hazards: [],
  waterEventOpen: null,
  overdue5: null,
  featured: [],
  service: { complaintPct: null, satAvg: null },
  schedule: { todayCount: 0, nextTime: null },
}
const briefing = (over) => I.buildBriefing({ ...BASE, ...over })
const lineIds = (lines) => lines.map((l) => l.id)

test('สรุปวันนี้: ไม่ ready (ข้อมูลหลักยังโหลด/พัง) = null · ตรวจใบรอลงนามไม่ได้/กำลังโหลด = null · ไม่มีอินพุต = null', () => {
  assert.equal(I.buildBriefing({ ...BASE, ready: false }), null)
  assert.equal(I.buildBriefing({ ...BASE, ready: undefined }), null)
  assert.equal(I.buildBriefing(null), null)
  assert.equal(briefing({ sign: { status: 'error' } }), null, 'ห้ามสรุปว่าเรียบร้อยจากข้อมูลที่ตรวจไม่ได้')
  assert.equal(briefing({ sign: { status: 'loading' } }), null)
})

test('สรุปวันนี้: ไม่มีอะไรเลย = บรรทัดเขียวบรรทัดเดียว · ไม่มีใบลงนาม (โมดูลปิด) ก็เป็นบรรทัดเขียวได้', () => {
  assert.deepEqual(briefing({}), [{ id: 'all-clear', tone: 'green', text: 'วันนี้ไม่มีเรื่องรอท่าน และไม่พบเรื่องผิดปกติ', target: 's1' }])
  assert.deepEqual(lineIds(briefing({ sign: { status: 'none' } })), ['all-clear'])
})

test('สรุปวันนี้: บรรทัดเรื่องรอท่าน — ตัดส่วนที่เป็น 0 · เกิน 2 วันทำการ = สีส้ม · ไม่มี = สีน้ำเงิน', () => {
  const both = briefing({ sign: { status: 'ok', total: 3, over2wd: 1 }, decisions: 2 })[0]
  assert.equal(both.id, 'wait')
  assert.equal(both.target, 's1')
  assert.equal(both.tone, 'amber')
  assert.equal(both.text, 'มีเอกสารรอท่านลงนาม 3 ฉบับ (รอเกิน 2 วันทำการ 1 ฉบับ) และเรื่องรอพิจารณาอีก 2 เรื่อง')
  const sign = briefing({ sign: { status: 'ok', total: 3, over2wd: 0 } })[0]
  assert.equal(sign.text, 'มีเอกสารรอท่านลงนาม 3 ฉบับ')
  assert.equal(sign.tone, 'blue')
  const dec = briefing({ decisions: 5 })[0]
  assert.equal(dec.text, 'มีเรื่องรอท่านพิจารณา 5 เรื่อง')
  assert.equal(dec.tone, 'blue')
})

test('สรุปวันนี้: ลำดับ เรื่องรอท่าน → ภัย → เรื่องช้า · ตัดที่ 3 บรรทัด · ภัยแดงเป็นสีแดง', () => {
  const rain = { id: 'hazard:heavy_rain', tone: 'amber', what: 'พยากรณ์ฝนหนักพรุ่งนี้ (16 พ.ย.)', brief: 'พรุ่งนี้ (16 พ.ย.) พยากรณ์ฝนหนัก 42.5 มม. — ควรเตรียมรับมือ' }
  const dust = { id: 'hazard:pm25', tone: 'red', what: 'ฝุ่น PM2.5 มีผลกระทบต่อสุขภาพ', brief: 'ฝุ่น PM2.5 มีผลกระทบต่อสุขภาพ 80 มคก./ลบ.ม. — ควรเฝ้าระวัง' }
  const lines = briefing({ sign: { status: 'ok', total: 1, over2wd: 0 }, hazards: [rain, dust], waterEventOpen: { count: 1 }, overdue5: { count: 3 }, schedule: { todayCount: 2, nextTime: '09:30' } })
  assert.equal(lines.length, 3)
  assert.deepEqual(lineIds(lines), ['wait', 'hazard:heavy_rain', 'hazard:pm25'])
  assert.equal(lines[1].text, 'พรุ่งนี้ (16 พ.ย.) พยากรณ์ฝนหนัก 42.5 มม. — ควรเตรียมรับมือ')
  assert.equal(lines[1].tone, 'amber')
  assert.equal(lines[2].tone, 'red')
  assert.equal(lines[1].target, 's2')
  // ภัยหนึ่งตัว + เหตุการณ์น้ำ + เรื่องช้า (ไม่มีใบรอ)
  const l2 = briefing({ hazards: [rain], waterEventOpen: { count: 2 }, overdue5: { count: 3 } })
  assert.deepEqual(lineIds(l2), ['hazard:heavy_rain', 'water-event', 'overdue5'])
  assert.equal(l2[1].text, 'มีเหตุการณ์น้ำ–ฝนที่ยังเฝ้าระวังอยู่ 2 เหตุการณ์')
  assert.equal(l2[2].text, 'เรื่องของประชาชนช้ากว่ากำหนดเกิน 5 วันทำการ 3 เรื่อง')
  assert.equal(l2[2].tone, 'red')
  // ภัยไม่มี brief = ใช้ what
  assert.equal(briefing({ hazards: [{ id: 'hazard:x', tone: 'amber', what: 'ข้อความภัย' }] })[0].text, 'ข้อความภัย')
})

test('สรุปวันนี้: ไม่มีเรื่องช้า → แถวเด่นแถวแรก (ไม่ซ้ำเหตุการณ์น้ำที่ขึ้นแล้ว) · แถวเด่นแบบไม่แสดงตัวเลขขึ้นแต่ข้อความ', () => {
  const water = { id: 'water-situation:event_open', count: 2, unit: 'เหตุการณ์', showCount: true, entry: { label: 'น้ำ' } }
  const behind = { id: 'projects:behind', count: 2, unit: 'โครงการ', showCount: true, entry: { label: 'โครงการ' } }
  const l = briefing({ featured: [behind] })
  assert.deepEqual(lineIds(l), ['featured'])
  assert.equal(l[0].text, 'โครงการก่อสร้างช้ากว่าแผน 2 โครงการ')
  assert.equal(l[0].tone, 'amber')
  assert.equal(l[0].target, 's2')
  const noDup = briefing({ waterEventOpen: { count: 2 }, featured: [water, behind] })
  assert.deepEqual(lineIds(noDup), ['water-event', 'featured'])
  assert.equal(noDup[1].text, 'โครงการก่อสร้างช้ากว่าแผน 2 โครงการ')
  const deadline = { ...ins('deadline:op_plan', 'red'), what: 'เกินกำหนดจัดทำแผน', words: { what: 'เกินกำหนดจัดทำแผน', unit: '', go: 'ดู' } }
  const d = briefing({ featured: [deadline] })
  assert.equal(d[0].text, 'เกินกำหนดจัดทำแผน')
  assert.equal(d[0].tone, 'red')
})

test('สรุปวันนี้: ข่าวดีขึ้นเฉพาะเมื่อไม่มีภัย/เรื่องช้า/แถวเด่น · เฉพาะค่าที่มีจริง · ไม่มีทั้งคู่ = ไม่ขึ้น', () => {
  const svc = { complaintPct: 92, satAvg: 4.6 }
  const good = briefing({ service: svc })
  assert.deepEqual(lineIds(good), ['good-news'])
  assert.equal(good[0].text, 'เดือนนี้คำร้องทำเสร็จทันเวลา 92% · ประชาชนพอใจ 4.6 จาก 5')
  assert.equal(good[0].tone, 'green')
  assert.equal(good[0].target, 's3')
  assert.equal(briefing({ service: { complaintPct: 92, satAvg: null } })[0].text, 'เดือนนี้คำร้องทำเสร็จทันเวลา 92%')
  assert.equal(briefing({ service: { complaintPct: null, satAvg: 4.25 } })[0].text, `ประชาชนพอใจ ${Number(4.25).toLocaleString('th-TH', { maximumFractionDigits: 1 })} จาก 5`)
  assert.deepEqual(lineIds(briefing({ service: { complaintPct: null, satAvg: null } })), ['all-clear'])
  assert.deepEqual(lineIds(briefing({ service: { complaintPct: 0, satAvg: null } })), ['good-news'], '0% เป็นค่าจริง ไม่ใช่ไม่มีค่า')
  // มีปัญหา = ไม่เอาข่าวดีมากลบ
  assert.ok(!lineIds(briefing({ service: svc, overdue5: { count: 1 } })).includes('good-news'))
  assert.ok(!lineIds(briefing({ service: svc, hazards: [{ id: 'hazard:x', tone: 'amber', what: 'ภัย' }] })).includes('good-news'))
  assert.ok(!lineIds(briefing({ service: svc, featured: [{ id: 'projects:behind', count: 1, unit: 'โครงการ', showCount: true }] })).includes('good-news'))
  // ข่าวดีอยู่หลังบรรทัดเรื่องรอท่าน
  assert.deepEqual(lineIds(briefing({ service: svc, decisions: 1 })), ['wait', 'good-news'])
})

test('สรุปวันนี้: กำหนดการขึ้นเมื่อยังมีที่ว่าง · มีจำนวนกับเวลาถัดไป ไม่มีชื่อกิจกรรม · 0 รายการ = ไม่ขึ้น', () => {
  const s = briefing({ schedule: { todayCount: 3, nextTime: '09:30' } })
  assert.deepEqual(lineIds(s), ['schedule'])
  assert.equal(s[0].text, 'วันนี้มีกำหนดการ 3 รายการ · ถัดไป 09:30 น.')
  assert.equal(s[0].target, 's4')
  assert.equal(briefing({ schedule: { todayCount: 1, nextTime: null } })[0].text, 'วันนี้มีกำหนดการ 1 รายการ')
  assert.deepEqual(lineIds(briefing({ schedule: { todayCount: 0, nextTime: '09:30' } })), ['all-clear'])
  // ที่ว่างเต็ม 3 บรรทัดแล้ว = ไม่ขึ้น
  const full = briefing({ sign: { status: 'ok', total: 1, over2wd: 0 }, hazards: [{ id: 'a', tone: 'amber', what: 'ก' }, { id: 'b', tone: 'amber', what: 'ข' }], schedule: { todayCount: 2, nextTime: '09:30' } })
  assert.equal(full.length, 3)
  assert.ok(!lineIds(full).includes('schedule'))
  const code = stripComments(read('src/lib/execSimpleInsights.js'))
  assert.ok(!/schedule\??\.(title|name|events)|ชื่อกิจกรรม/.test(code), 'บรรทัดกำหนดการห้ามมีชื่อกิจกรรม (อาจเป็นเรื่องส่วนตัวของผู้บริหาร)')
})

test('สรุปวันนี้: EXEC_BRIEFING_RULE ตรงถ้อยคำที่อนุมัติ + ไม่เกิน 3 บรรทัดเสมอ', () => {
  assert.equal(I.EXEC_BRIEFING_RULE, 'ระบบวิเคราะห์ตัวเลขในหน้านี้แล้วสรุปตามลำดับความสำคัญ: เรื่องรอท่าน → ภัยที่กำลังมา → เรื่องช้า/ผิดปกติ → ข่าวดี → กำหนดการ ไม่เกิน 3 บรรทัด')
  assert.equal(I.EXEC_BRIEFING_MAX_LINES, 3)
  const many = briefing({
    sign: { status: 'ok', total: 5, over2wd: 2 }, decisions: 3, hazards: [1, 2, 3, 4].map((n) => ({ id: `h${n}`, tone: 'amber', what: `ภัย${n}` })),
    waterEventOpen: { count: 1 }, overdue5: { count: 9 }, schedule: { todayCount: 4, nextTime: '10:00' },
  })
  assert.equal(many.length, 3)
})

// ── ทุก insight ต้องมีกฎ + รูปร่างเดียวกัน ────────────────────────────────────

test('ทุก insight ที่สร้างในเทสต์: รูปร่างครบ · rule ไม่ว่างและเป็นภาษาคน · ไม่มีชื่อผู้ร้อง/ข้อความอิสระ', () => {
  assert.ok(seen.length >= 10, `เก็บ insight ได้ ${seen.length} ตัว`)
  for (const it of seen) {
    for (const key of SHAPE_KEYS) assert.ok(key in it, `${it.id} ขาด ${key}`)
    assert.ok(['hazard', 'deadline', 'pattern'].includes(it.kind), it.id)
    assert.ok(['red', 'amber'].includes(it.tone), it.id)
    assert.ok(typeof it.rule === 'string' && it.rule.trim().length >= 30, `${it.id}: rule ว่าง/สั้นเกิน`)
    assert.ok(!/[a-z_]+\.[a-z_]+|due_date|rpc|select\s/i.test(it.rule), `${it.id}: rule ต้องเป็นภาษาคน ไม่ใช่ชื่อคอลัมน์/โค้ด`)
    assert.ok(it.target && (it.target.module || it.target.path), `${it.id}: ต้องมีปลายทาง`)
    assert.ok(it.words.what && it.words.go, it.id)
    assert.equal(it.words.what, it.what, `${it.id}: words.what ต้องตรง what`)
  }
  assert.ok(I.HEAVY_RAIN_RULE.length > 30 && I.PM25_RULE.length > 30 && I.REPEAT_HINT.length > 10)
})

// ── สายไฟจากซอร์ส ────────────────────────────────────────────────────────────

const NEW_CODE = [
  'src/lib/execSimpleInsights.js',
  'src/hooks/useExecHazards.js',
  'src/hooks/useExecPlanDeadlines.js',
]

test('ไฟล์ใหม่: ไม่มีช่องข้อมูลส่วนบุคคลของผู้ร้อง/ผู้ประเมิน (PDPA) · ไม่เปิดแท็บใหม่ · ไม่มี AI/LLM · lib ไม่ import React/supabase', () => {
  for (const file of NEW_CODE) {
    const code = stripComments(read(file))
    assert.ok(!/reporter_name|complainant|full_name|phone|contact_|requester_name|\.purpose\b|rater|comment\b/i.test(code), `${file}: พบช่องที่อาจเป็นข้อมูลส่วนบุคคล/ข้อความอิสระ`)
    assert.ok(!/window\.open\(|target="_blank"/.test(code), `${file}: ห้ามเปิดแท็บใหม่`)
    assert.ok(!/gemini|openai|anthropic|llm|chat\.completions/i.test(code), `${file}: ห้ามใช้ AI/LLM`)
  }
  const lib = stripComments(read('src/lib/execSimpleInsights.js'))
  assert.ok(!/from 'react'|from '\.\/supabase|supabase/.test(lib), 'lib ต้องบริสุทธิ์ (เทสต์ด้วย node ได้)')
})

test('ฮุกภัย: ไม่มี interval/visible-refresh ของตัวเอง · throttle 30 นาที/10 นาที · ฝุ่นใช้ /api/air-quality + timeout 15 วิ + ตรวจ source · เปลี่ยน อปท. เคลียร์ · unmount ยกเลิก', () => {
  const code = stripComments(read('src/hooks/useExecHazards.js'))
  assert.ok(!/setInterval|useVisibleRefresh/.test(code), 'ต้องพึ่ง tick ของหน้าแม่ (ซึ่งคุม 06–20 น./แท็บมองเห็น) เท่านั้น')
  assert.ok(/HAZARD_FORECAST_MIN_MS = 30 \* 60 \* 1000/.test(code))
  assert.ok(/HAZARD_AIR_MIN_MS = 10 \* 60 \* 1000/.test(code))
  assert.ok(code.includes("fetch('/api/air-quality'"))
  assert.ok(code.includes("data?.source !== 'Air4Thai' || !Array.isArray(data.stations)"))
  assert.ok(/AIR_TIMEOUT_MS = 15_000/.test(code))
  assert.ok(code.includes('fetchTmdForecast(supabase, tenantId)'))
  assert.ok(!/supabase\s*\.\s*from\(/.test(code), 'พยากรณ์ผ่าน RPC ของ tmdForecast.js เท่านั้น')
  assert.ok(code.includes('src.tenantId !== tenantId'), 'เปลี่ยน อปท. ต้องเคลียร์')
  assert.ok(/abort\(\)/.test(code) && /\}, \[\]\)/.test(code), 'ปิดหน้า = ยกเลิก (effect แยก ไม่ยกเลิกทุก tick)')
  assert.ok(/\[active, tenantId, tick\]/.test(code), 'ดึงเมื่อ tick เปลี่ยน')
  // ดึงพลาดไม่ตั้งเวลา (tick ถัดไปลองใหม่) และไม่เคลียร์ค่าเดิม
  assert.ok(code.includes('error && prev.tenantId === tenantId ? prev'))
})

test('ฮุกกำหนดแผน: เลือกเฉพาะคอลัมน์ที่ใช้ · กรอง municipality_id ทุก query · ไม่ select(*) · throttle 30 นาที · ไม่มี interval · ไม่เขียนข้อมูล', () => {
  const code = stripComments(read('src/hooks/useExecPlanDeadlines.js'))
  assert.ok(!/setInterval|useVisibleRefresh/.test(code))
  assert.ok(!/select\('\*'\)|select\(\)/.test(code))
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(code), 'อ่านอย่างเดียว')
  assert.ok(/PLAN_DEADLINES_MIN_MS = 30 \* 60 \* 1000/.test(code))
  assert.equal((code.match(/\.eq\('municipality_id', tenantId\)/g) ?? []).length, 3, 'ทั้ง 3 ตารางต้องกรอง อปท.')
  for (const snippet of [
    "from('local_dev_plans').select('id, year_from, year_to, status, is_current')",
    "from('local_op_plans').select('fiscal_year, kind, status, basis, basis_on, extended_due_on, published_on')",
    "from('local_plan_evaluations').select('fiscal_year, reported_to_exec_on, presented_on, announced_on')",
    ".eq('is_current', true)", ".eq('kind', 'main')", '.eq(\'fiscal_year\', fiscalYear - 1)',
  ]) assert.ok(code.includes(snippet), `ขาด ${snippet}`)
  assert.ok(code.includes("status: 'error'"), 'ดึงพลาดครั้งแรกต้องบอก error ไม่ซ่อนเงียบ')
})

test('หน้าจอ: เรียกฮุกทั้งสองด้วย tick เดิม · ใช้ composeKnowRows + buildBriefing · สรุปวันนี้อยู่ใน es-head ใต้แถบ KPI · ป้ายใหม่รวม insight · ปุ่มไปหน้าอื่นผ่าน resolveLink/leave เดิม', () => {
  const home = stripComments(read('src/components/staff/executive/ExecSimpleHome.jsx'))
  assert.ok(/useExecHazards\(\{ tenant, enabled: hazardsEnabled, tick \}\)/.test(home))
  assert.ok(/useExecPlanDeadlines\(\{ tenantId, today, enabled: planEnabled, tick \}\)/.test(home))
  assert.ok(home.includes("'src:tmd-forecast'") && home.includes("'src:air'") && home.includes("e.key === 'local-plan'"), 'enabled ผูกกับรายการที่ live ในทะเบียน')
  for (const used of ['composeKnowRows', 'buildBriefing', 'heavyRainInsight', 'pm25Insight', 'repeatInsight', 'planDeadlineInsights', 'EXEC_BRIEFING_RULE', 'BriefingBox']) assert.ok(home.includes(used), `ไม่ได้ใช้ ${used}`)
  assert.ok(home.indexOf('<KpiStrip items={kpis} />') < home.indexOf('<BriefingBox') && home.indexOf('<BriefingBox') < home.indexOf('</header>'))
  assert.ok(home.includes('markItems') && home.includes('insightsReady'), 'ป้ายใหม่ต้องรวม insight และรอข้อมูลชุดแรกก่อน')
  assert.ok(home.includes('resolveLink({ link: it.target })'), 'ปลายทางผ่าน resolveLink เดิม (จำตำแหน่งเลื่อน + แถบกลับ)')
  assert.ok(home.includes('data-exec-simple-insight={it.id}'))
  assert.ok(home.includes('know.total'), 'KPI "เรื่องที่ควรรู้" = total ของ composeKnowRows')
  assert.ok(/planDl\.status === 'error' && <LoadFail/.test(home), 'ตรวจกำหนดแผนไม่ได้ต้องบอกตรงๆ')
  assert.ok(/calm2 = ovOk && alerts\.failures\.length === 0 && know\.total === 0/.test(home), 'บรรทัดเขียวต้องคิดรวม insight')
  assert.ok(!home.includes('useExecPlanProgress'))
  const parts = stripComments(read('src/components/staff/executive/ExecSimpleParts.jsx'))
  assert.ok(parts.includes('data-exec-simple-briefing') && parts.includes('data-exec-simple-briefing-line={line.id}'))
  assert.ok(parts.includes('rule={rule}') || parts.includes('<RuleNote text={rule} />'))
  assert.ok(parts.includes('<RuleNote text={rule} />') && parts.includes('export function RuleNote'), 'ทุกแถวต้องมีปุ่มวิธีคิด')
})

test('ไม่แตะส่วนที่งานอื่นดูแล: ทะเบียนผู้บริหาร · ALERT_RULES · EXEC_SIMPLE_MAJOR_ALERTS · หน้าแบบเต็ม ไม่ถูกอ้างแก้ในไฟล์ใหม่', () => {
  const view = read('src/lib/execSimpleView.js')
  assert.ok(view.includes('const w = item?.words ?? EXEC_SIMPLE_ALERT_WORDS[item?.id]'), 'แก้ simpleAlertWords แบบ additive บรรทัดเดียว')
  const lib = read('src/lib/execSimpleInsights.js')
  assert.ok(!lib.includes('executiveRegistry') && !lib.includes('ALERT_RULES'), 'ไม่ผูกกับทะเบียน/ALERT_RULES')
})

test('prebuild + สคริปต์ test:exec-insights เดินสายแล้ว', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['test:exec-insights'], 'node tests/executive-simple-insights.test.mjs')
  assert.ok(pkg.scripts.prebuild.includes('node tests/executive-simple-insights.test.mjs'))
  assert.ok(pkg.scripts.prebuild.includes('node tests/executive-simple-view.test.mjs'), 'ของเดิมยังอยู่')
})

console.log(`\n${cases} cases passed`)
