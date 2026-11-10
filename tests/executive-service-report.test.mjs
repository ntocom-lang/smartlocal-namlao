// Pure-logic test: ใบ "สรุปผลการให้บริการประชาชน" ของห้องผู้บริหาร เฟส E3-1
//   - ตัวช่วยช่วงเวลา (src/lib/executiveReportPeriods.js)
//   - ใบพิมพ์ HTML (src/lib/executiveServiceReportPrint.js)
// ใช้เวลาคงที่ทุกเคส ไม่ขึ้นกับนาฬิกาจริงหรือโซนเวลาเครื่อง · ไม่ต่อเน็ต/ฐานข้อมูล
// ไม่วัดกล่องช่องลงนามที่นี่ (วัดด้วย assertSignBlockStandard ใน tests/lib/signBlockChecks.mjs แยกต่างหาก)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ตั้งโซนเวลาเครื่องเป็นที่อื่นก่อน import — ถ้าโค้ดพึ่ง TZ เครื่อง วันที่ไทยเพี้ยนและเทสต์ล้ม
process.env.TZ = 'America/Los_Angeles'

const {
  EXEC_REPORT_MONTH_COUNT, EXEC_REPORT_QUARTER_COUNT, execReportDefaultPeriod, execReportMonthOptions, execReportPeriodOptions,
  execReportQuarterOptions, findExecReportPeriod,
} = await import('../src/lib/executiveReportPeriods.js')
const { EXEC_REPORT_ALERT_SPEC, EXEC_REPORT_FORMULA_SPEC, buildExecServiceReportHtml, execReportFormulaItems } = await import('../src/lib/executiveServiceReportPrint.js')
const { buildExecModel, EXEC_RATING_SOURCES } = await import('../src/lib/executiveData.js')
const EXEC_REGISTRY_MODULE = await import('../src/lib/executiveRegistry.js')
const { EXECUTIVE_REGISTRY } = EXEC_REGISTRY_MODULE
const { orgClerkTitle, orgHeadTitle } = await import('../src/lib/orgTerms.js')
const { govNameBlank } = await import('../src/lib/govSignBlock.js')
const { addDays } = await import('../src/lib/complaintReportPeriods.js')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}
// 12:00 น. ไทย = 05:00Z
const at = (iso) => new Date(`${iso}T05:00:00Z`)

// ═════════════════════════ ช่วงเวลา ═════════════════════════

test('ค่าเริ่มต้นรายเดือน = เดือนที่เพิ่งจบ · to = วันสุดท้ายของเดือนจริง (ไม่ใช่วันนี้)', () => {
  const p = execReportDefaultPeriod('month', at('2026-11-10'))
  assert.deepEqual({ kind: p.kind, label: p.label, from: p.from, to: p.to }, { kind: 'month', label: 'ตุลาคม 2569', from: '2026-10-01', to: '2026-10-31' })
  assert.equal(p.rangeText, '1 – 31 ต.ค. 2569')
  assert.equal(execReportDefaultPeriod('month', at('2026-11-30')).label, 'ตุลาคม 2569', 'วันสุดท้ายของเดือนปัจจุบัน เดือนนั้นยังไม่จบ')
  assert.equal(execReportDefaultPeriod('month', at('2026-12-01')).to, '2026-11-30', '1 ธ.ค. → พ.ย. (30 วัน)')
})

test('ขอบปี: ม.ค. → ค่าเริ่มต้นคือ ธ.ค. ปีก่อน (ข้ามปี พ.ศ.) · ธ.ค. → พ.ย.', () => {
  const jan = execReportDefaultPeriod('month', at('2027-01-05'))
  assert.deepEqual([jan.label, jan.from, jan.to], ['ธันวาคม 2569', '2026-12-01', '2026-12-31'])
  const jan26 = execReportDefaultPeriod('month', at('2026-01-31'))
  assert.deepEqual([jan26.label, jan26.from, jan26.to], ['ธันวาคม 2568', '2025-12-01', '2025-12-31'])
  const dec = execReportDefaultPeriod('month', at('2026-12-31'))
  assert.deepEqual([dec.label, dec.to], ['พฤศจิกายน 2569', '2026-11-30'])
})

test('กุมภาพันธ์: ปีอธิกสุรทิน 29 วัน / ปีปกติ 28 วัน', () => {
  assert.equal(execReportDefaultPeriod('month', at('2024-03-10')).to, '2024-02-29')
  assert.equal(execReportDefaultPeriod('month', at('2025-03-10')).to, '2025-02-28')
})

test('รายเดือน 12 รายการ เรียงใหม่→เก่า ต่อเนื่องไม่ขาดไม่ซ้อน และไม่มีเดือนปัจจุบัน', () => {
  const now = at('2026-11-10')
  const list = execReportMonthOptions(now)
  assert.equal(list.length, EXEC_REPORT_MONTH_COUNT)
  assert.equal(list[0].label, 'ตุลาคม 2569')
  assert.equal(list.at(-1).label, 'พฤศจิกายน 2568')
  for (let i = 0; i < list.length - 1; i++) assert.equal(addDays(list[i + 1].to, 1), list[i].from, `${list[i + 1].label} ต่อกับ ${list[i].label}`)
  assert.ok(list.every((p) => p.to < '2026-11-10' && p.kind === 'month'), 'to ไม่ถึงวันนี้ทุกช่วง')
  assert.equal(new Set(list.map((p) => p.key)).size, 12)
})

test('ค่าเริ่มต้นรายไตรมาส = ไตรมาสปีงบที่เพิ่งจบ · ข้ามปีปฏิทินและปีงบ', () => {
  const q = (iso) => { const p = execReportDefaultPeriod('quarter', at(iso)); return [p.label, p.from, p.to] }
  assert.deepEqual(q('2026-11-10'), ['ไตรมาสที่ 4 ปีงบประมาณ 2569', '2026-07-01', '2026-09-30'])
  assert.deepEqual(q('2027-01-05'), ['ไตรมาสที่ 1 ปีงบประมาณ 2570', '2026-10-01', '2026-12-31'], 'ไตรมาส 1 คร่อมปีปฏิทิน (ต.ค.–ธ.ค.) จบ ธ.ค.')
  assert.deepEqual(q('2027-04-01'), ['ไตรมาสที่ 2 ปีงบประมาณ 2570', '2027-01-01', '2027-03-31'])
  assert.deepEqual(q('2027-07-15'), ['ไตรมาสที่ 3 ปีงบประมาณ 2570', '2027-04-01', '2027-06-30'])
  assert.deepEqual(q('2027-10-01'), ['ไตรมาสที่ 4 ปีงบประมาณ 2570', '2027-07-01', '2027-09-30'], '1 ต.ค. ขึ้นปีงบใหม่ ไตรมาส 4 ปีงบก่อนเพิ่งจบ')
})

test('รายไตรมาส 8 รายการ ต่อเนื่องกัน ไม่มีไตรมาสปัจจุบัน', () => {
  const list = execReportQuarterOptions(at('2026-11-10'))
  assert.equal(list.length, EXEC_REPORT_QUARTER_COUNT)
  for (let i = 0; i < list.length - 1; i++) assert.equal(addDays(list[i + 1].to, 1), list[i].from)
  assert.ok(list.every((p) => p.to < '2026-11-10' && p.kind === 'quarter'))
  assert.equal(list.at(-1).label, 'ไตรมาสที่ 1 ปีงบประมาณ 2568')
})

test('วันที่ตามปฏิทินไทย ไม่ใช่ UTC/โซนเครื่อง (เครื่องตั้ง Los Angeles): 00:30 น. ไทยของ 1 พ.ย. ถือว่าเป็น พ.ย. แล้ว', () => {
  assert.equal(execReportDefaultPeriod('month', new Date('2026-10-31T17:30:00Z')).label, 'ตุลาคม 2569', '1 พ.ย. 00:30 ไทย → เดือนที่เพิ่งจบคือ ต.ค.')
  assert.equal(execReportDefaultPeriod('month', new Date('2026-10-31T16:59:00Z')).label, 'กันยายน 2569', '31 ต.ค. 23:59 ไทย ยังอยู่ ต.ค. → ก.ย.')
  // 1 ต.ค. 00:30 ไทย = 30 ก.ย. 17:30 UTC — ขึ้นไตรมาส 1 ปีงบใหม่แล้ว ไตรมาสที่เพิ่งจบคือ ไตรมาส 4
  assert.equal(execReportDefaultPeriod('quarter', new Date('2026-09-30T17:30:00Z')).label, 'ไตรมาสที่ 4 ปีงบประมาณ 2569')
})

test('findExecReportPeriod / ชนิดไม่รู้จัก', () => {
  const now = at('2026-11-10')
  const key = execReportMonthOptions(now)[3].key
  assert.equal(findExecReportPeriod('month', key, now)?.key, key)
  assert.equal(findExecReportPeriod('month', 'month:2000-01', now), null)
  assert.equal(findExecReportPeriod('quarter', key, now), null, 'key ของเดือนไม่ใช่ไตรมาส')
  assert.throws(() => execReportPeriodOptions('week', now), /ไม่รู้จัก/)
})

// ═════════════════════════ ใบพิมพ์ ═════════════════════════

const TODAY = '2026-11-10'
const MONTH = execReportDefaultPeriod('month', at(TODAY))
const QUARTER = execReportDefaultPeriod('quarter', at(TODAY))
const SCRIPT = '<script>alert(1)</script>'

// ช่องที่ "ห้ามหลุดลงใบ" ใส่ไว้ใน fixture ตั้งใจ — ชื่อหมู่บ้าน/ข้อความรายเรื่อง/ความเห็น/ชื่อคน
const SECRET_WORDS = ['บ้านดอนลับ', 'ถนนชำรุดซ้ำ', 'นายแอบอ้าง ผู้ร้อง', 'ความเห็นลับของผู้ประเมิน', 'ยื่นขอรับเงินช่วยเหลือเพราะน้ำท่วมบ้าน']

const rawSummaries = () => ({
  complaints: {
    ok: true,
    data: {
      period: { total: 12, citizen_online: 9, oss_counter: 3, confidential: 1, adhoc: 0 },
      villages: [{ village: 'บ้านดอนลับ', n: 3 }], villages_unlisted: 1,
      on_time: { completed: 8, on_time: 6, late: 2, no_due: 0, open_past_due: 2, undated: 0 },
      backlog: [
        { s: 'new', due: '2026-11-02', c: '2026-11-02', u: true, n: 1 },
        { s: 'received', due: '2026-11-05', c: '2026-10-30', u: false, n: 3 },
        { s: 'in_progress', due: '2026-11-20', c: '2026-10-12', u: false, n: 2 },
      ],
      parked: { n: 1, by_reason: { budget: 1 } },
      repeat: { days: 90, min: 3, groups: [{ category: 'road', label: 'ถนนชำรุดซ้ำ', village: 'บ้านดอนลับ', n: 5 }] },
      reporter_name: 'นายแอบอ้าง ผู้ร้อง', comment: 'ความเห็นลับของผู้ประเมิน',
    },
  },
  doc_requests: {
    ok: true,
    data: {
      by_type: [
        { t: 'tax_notice', total: 20, pending: 3, processing: 2, completed: 14, rejected: 1, avg_days: 2.5 },
        { t: 'building_permit', total: 5, pending: 1, processing: 0, completed: 4, rejected: 0, avg_days: 6 },
      ],
      on_time: { by_type: [
        { t: 'tax_notice', completed: 14, on_time: 12, late: 2, no_due: 0, open_past_due: 1, undated: 0 },
        { t: 'building_permit', completed: 4, on_time: 4, late: 0, no_due: 0, open_past_due: 0, undated: 0 },
      ] },
      backlog: [{ t: 'tax_notice', s: 'pending', due: '2026-11-01', c: '2026-10-25', n: 2 }, { t: 'tax_notice', s: 'processing', due: '2026-11-20', c: '2026-11-05', n: 1 }],
      entered: { citizen: 15, council: 2, staff: 7, unknown: 1 },
      purpose: 'ยื่นขอรับเงินช่วยเหลือเพราะน้ำท่วมบ้าน',
    },
  },
  satisfaction: {
    ok: true,
    data: {
      closed: 10, any_rated: 6,
      sources: {
        verified: { complaints: 2, sum: 9, cnt: 2 }, via_link: { complaints: 3, sum: 12, cnt: 3 },
        proxy: { complaints: 1, sum: 5, cnt: 1 }, linked_anon: { complaints: 0, sum: 0, cnt: 0 },
      },
      genuine: { complaints: 5, sum: 21, cnt: 5 }, // เฉลี่ย 4.2 · ทุกที่มารวม (9+12+5)/6 = 4.3 ต้องไม่โผล่เป็นค่าเดียว
      general: { n: 4, sum: 17 },
      low: { proxy: 1 },
      by_dept: [{ dept: 'd1', closed: 6, genuine_sum: 10, genuine_cnt: 2, all_sum: 14, all_cnt: 3 }],
    },
  },
  departments: {
    ok: true,
    data: {
      departments: [
        { id: 'd1', name: 'กองช่าง', short_name: 'ช่าง', complaints: { open: 4, overdue: 2, parked: 0, done: 3 }, docs: { open: 1, overdue: 0, done: 5 } },
        { id: 'd2', name: `${SCRIPT}กองคลัง`, short_name: null, complaints: { open: 0, overdue: 0, parked: 0, done: 0 }, docs: { open: 2, overdue: 1, done: 0 } },
        { id: null, name: null, complaints: { open: 1, overdue: 0, parked: 0, done: 0 }, docs: { open: 0, overdue: 0, done: 0 } },
      ],
    },
  },
})

const TENANT = { name: `เทศบาลตำบลทดสอบ ${SCRIPT}` }
const build = (overrides = {}) => buildExecServiceReportHtml({
  model: buildExecModel(rawSummaries()), today: TODAY, period: MONTH, tenant: TENANT,
  signatories: { clerk: { name: 'นายสมชาย ใจดี', title: 'ปลัดเทศบาล' }, mayor: { name: `นายก ${SCRIPT}`, title: 'นายกเทศมนตรี' } },
  ...overrides,
})
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const bodyOf = (html) => html.slice(html.indexOf('<body>'))
const count = (text, needle) => text.split(needle).length - 1
// ตัวแบ่งส่วนของใบ: ปิดท้าย (หมายเหตุ + ช่องลงนาม) และภาคผนวกสูตร — ใช้ชื่อ class ใน body (คำว่า "ภาคผนวก" มีในหมายเหตุด้วย)
const CLOSING = '<div class="closing">'
const APPENDIX = '<div class="appendix">'

test('ใบสมบูรณ์: ไม่มี undefined/NaN/[object · ครบ 5 ส่วนตามลำดับ · หัวใบมีชื่อ อปท. + ช่วง + ประจำเดือน', () => {
  const html = build()
  assert.doesNotMatch(html, /undefined|NaN|\[object/)
  // ตัวรายงานจบที่ช่องลงนาม · สูตรคำนวณเป็นภาคผนวกแผ่นใหม่ "หลัง" ช่องลงนาม (ผู้ลงนามไม่ต้องลงชื่อท้ายข้อความเชิงเทคนิค)
  const at = ['ส่วนที่ 1 ', 'ส่วนที่ 2 ', 'ส่วนที่ 3 ', 'ส่วนที่ 4 ', 'ส่วนที่ 5 ', CLOSING, 'หมายเหตุ', 'class="exec-sign"', APPENDIX, 'ภาคผนวก หมายเหตุและสูตรคำนวณ'].map((s) => bodyOf(html).indexOf(s))
  assert.ok(at.every((i) => i > 0), `ครบทุกส่วน ${at}`)
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'เรียงลำดับ: 1-5 → หมายเหตุ → ช่องลงนาม → ภาคผนวกสูตร')
  assert.ok(html.includes('.appendix { break-before: page;'), 'ภาคผนวกขึ้นแผ่นใหม่')
  assert.ok(html.includes('ประจำเดือนตุลาคม 2569'))
  assert.ok(html.includes('ช่วงวันที่ 1 – 31 ต.ค. 2569'))
  assert.ok(html.includes('รายงานประกอบการประชุมผู้บริหาร'))
  assert.ok(html.includes('ข้อมูล ณ วันที่ 10 พ.ย. 2569'))
  assert.ok(build({ period: QUARTER }).includes('ประจำไตรมาสที่ 4 ปีงบประมาณ 2569'))
})

test('ไม่อ้างเกณฑ์ประเมินภายนอก: ไม่มีคำว่า ITA / OIT ทั้งใบ', () => {
  for (const html of [build(), build({ model: buildExecModel({}) }), build({ period: QUARTER })]) {
    assert.doesNotMatch(html, /ITA|OIT/)
    assert.doesNotMatch(html, /ใช้แทนการเผยแพร่/)
  }
})

test('esc(): ชื่อ อปท./กอง/ผู้ลงนามที่มี <script> ถูก escape ทุกจุด · ใบไม่มี <script> เลย', () => {
  const html = build()
  assert.ok(!html.includes('<script'), 'ไม่มี tag script หลุด')
  assert.ok(count(html, '&lt;script&gt;alert(1)&lt;/script&gt;') >= 3, 'อปท. (หัวใบ+title) · ชื่อกอง · ชื่อนายก')
  assert.ok(html.includes('(นายสมชาย ใจดี)'))
})

test('PDPA: ไม่มีชื่อบุคคล/ความเห็น/ชื่อหมู่บ้าน/ข้อความรายเรื่องจาก fixture หลุดลงใบ', () => {
  const html = build()
  for (const word of SECRET_WORDS) assert.ok(!html.includes(word), `หลุด: ${word}`)
})

test('% ทันกำหนด 2 แถวแยกกัน: คำร้อง (วันทำการ) 60% · คำขอ (วันปฏิทิน) 84.2% · ไม่มีแถวรวม', () => {
  const html = build()
  // คำร้อง: ทัน 6 ÷ (6+2+2) = 60% · คำขอ: ทัน (12+4) ÷ ((12+4)+(2+0)+(1+0)) = 16/19 = 84.2%
  assert.match(html, /ร้อยละเสร็จทันกำหนด · คำร้อง \(วันทำการ\)<\/td><td class="num">60%<\/td>/)
  assert.match(html, /ร้อยละเสร็จทันกำหนด · คำขอ \(วันปฏิทิน\)<\/td><td class="num">84.2%<\/td>/)
  assert.equal(count(html, 'ร้อยละเสร็จทันกำหนด ·'), 2, 'มีสองแถวเท่านั้น ไม่มีแถวรวม')
  assert.ok(html.includes('ไม่รวมเป็นค่าเดียว'))
  // ค่ารวมสมมติ (6+16) ÷ (10+19) = 75.9% ต้องไม่โผล่
  assert.ok(!html.includes('75.9%'))
})

test('ส่วนที่ 1–2: ยอดรับใหม่ + ช่องทาง (ออนไลน์ 75% / เคาน์เตอร์ 25%) + คำขอแยกผู้กรอก', () => {
  const html = build()
  assert.match(html, /เรื่องร้องเรียนรับใหม่ในช่วง<\/td><td class="num">12 เรื่อง/)
  assert.match(html, /คำขอบริการ \(E-Service\) ยื่นในช่วง<\/td><td class="num">25 เรื่อง/)
  assert.match(html, /ออนไลน์ \(ประชาชนแจ้งเอง\)<\/td><td class="num">9<\/td><td class="num">75%/)
  assert.match(html, /รับที่เคาน์เตอร์<\/td><td class="num">3<\/td><td class="num">25%/)
  assert.match(html, /ประชาชนยื่นเอง<\/td><td class="num">15<\/td><td class="num">60%/)
  assert.match(html, /เจ้าหน้าที่กรอกแทน \(เคาน์เตอร์\)<\/td><td class="num">7<\/td><td class="num">28%/)
})

test('ส่วนที่ 3 ความพึงพอใจ: แยกที่มาครบทุกแถว · เสียงตัวจริง 4.2 เป็นแถวเด่น · ไม่มีค่าเฉลี่ยรวมทุกที่มา · ไม่มีคะแนน = "—"', () => {
  const html = build()
  for (const src of EXEC_RATING_SOURCES) assert.ok(html.includes(`<td>${src.label}</td>`), src.label)
  assert.match(html, /<tr class="strong"><td>เสียงผู้รับบริการตัวจริง<\/td><td class="num">5<\/td><td class="num">4.2<\/td>/)
  assert.match(html, /ผูกคำร้องแต่ไม่ล็อกอิน<\/td><td class="num">0<\/td><td class="num">—<\/td>/)
  assert.match(html, /แบบประเมินภาพรวมหน่วยงาน[^<]*<\/td><td class="num">4<\/td><td class="num">4.3<\/td>/, 'แบบประเมินภาพรวม 17 ÷ 4 = 4.3')
  assert.ok(html.includes('อัตราตอบ 60%'))
  // ค่าเฉลี่ยรวมทุกที่มา (9+12+5)/6 = 4.3 ต้องไม่โผล่ในตารางที่มา — มีเลข 4.3 ได้แค่ในแถวแบบประเมินภาพรวม (นับ 1)
  assert.equal(count(html, '>4.3<'), 1)
})

test('ส่วนที่ 4 รายกอง: 1 แถวต่อกอง ลำดับตามที่ระบบคืน ไม่จัดอันดับ · ไม่ระบุกอง · คะแนนไม่มี = "—"', () => {
  const html = build()
  const table = bodyOf(html).slice(bodyOf(html).indexOf('ส่วนที่ 4 '), bodyOf(html).indexOf('ส่วนที่ 5 '))
  assert.equal(count(table, '<tr><td>'), 3)
  assert.ok(table.indexOf('กองช่าง') < table.indexOf('กองคลัง') && table.indexOf('กองคลัง') < table.indexOf('ไม่ระบุกอง'))
  assert.match(table, /กองช่าง<\/td><td class="num">5<\/td><td class="num">2<\/td><td class="num">8<\/td><td class="num">5.0 \(2 คะแนน\)<\/td>/)
  assert.match(table, /กองคลัง<\/td><td class="num">2<\/td><td class="num">1<\/td><td class="num">0<\/td><td class="num">—<\/td>/)
  assert.doesNotMatch(table, /อันดับที่|ลำดับที่/)
  assert.ok(table.includes('ไม่จัดอันดับ'))
})

test('ส่วนที่ 5 ยอดค้าง: กำกับ "ณ วันที่พิมพ์ ไม่ใช่ ณ สิ้นช่วง" + ตัวเลขตรงสูตร', () => {
  const html = build()
  const sec = bodyOf(html).slice(bodyOf(html).indexOf('ส่วนที่ 5 '), bodyOf(html).indexOf(CLOSING))
  assert.ok(sec.includes('ณ วันที่พิมพ์ 10 พ.ย. 2569 ไม่ใช่ ณ สิ้นช่วง 1 – 31 ต.ค. 2569'))
  // คำร้องค้าง 1+3+2 = 6 · เลยกำหนด (1+3) = 4 · เกิน 5 วันทำการ: 11-02→11-10 = 6 วันทำการ (นับ 1) · 11-05 = 3 (ไม่นับ)
  assert.match(sec, /ค้างอยู่ทั้งหมด<\/td><td class="num">6<\/td><td class="num">3<\/td>/)
  assert.match(sec, /เลยกำหนด<\/td><td class="num">4<\/td><td class="num">2<\/td>/)
  assert.match(sec, /เลยกำหนดเกิน 5 วันทำการ<\/td><td class="num">1<\/td>/)
  assert.match(sec, /ยังไม่มีผู้รับผิดชอบ<\/td><td class="num">1<\/td>/)
  // ค้างแยกตามขั้น/อายุเฉลี่ย (คอขวด) ไม่พิมพ์ในใบ — ดูบนหน้าจอ (กันช่องลงนามตกไปแผ่นที่ 3)
  assert.doesNotMatch(sec, /แยกตามขั้น|อายุเฉลี่ย|ยังไม่รับเรื่อง/)
})

test('ข้อมูลโหลดไม่ได้ (error/missing) = "ไม่มีข้อมูล" ไม่ใช่ 0 — ทุกส่วนที่ใช้ข้อมูลนั้น', () => {
  const raw = rawSummaries()
  raw.complaints = { ok: false, error: 'timeout' }
  delete raw.satisfaction // missing (ไม่ได้ขอ/โมดูลปิด)
  raw.departments = { ok: false, error: 'x' }
  const html = build({ model: buildExecModel(raw) })
  assert.doesNotMatch(html, /undefined|NaN|\[object/)
  assert.match(html, /เรื่องร้องเรียนรับใหม่ในช่วง<\/td><td class="num"><span class="nodata">ไม่มีข้อมูล<\/span><\/td>/)
  assert.match(html, /ร้อยละเสร็จทันกำหนด · คำร้อง \(วันทำการ\)<\/td><td class="num"><span class="nodata">ไม่มีข้อมูล<\/span>/)
  assert.match(html, /ร้อยละเสร็จทันกำหนด · คำขอ \(วันปฏิทิน\)<\/td><td class="num">84.2%/, 'ส่วนที่โหลดได้ยังขึ้นปกติ')
  const sec = (a, b) => bodyOf(html).slice(bodyOf(html).indexOf(a), bodyOf(html).indexOf(b))
  assert.ok(sec('ส่วนที่ 3 ', 'ส่วนที่ 4 ').includes('ไม่มีข้อมูล') && !/อัตราตอบ/.test(sec('ส่วนที่ 3 ', 'ส่วนที่ 4 ')))
  assert.ok(sec('ส่วนที่ 4 ', 'ส่วนที่ 5 ').includes('ไม่มีข้อมูล') && !/<tr><td>/.test(sec('ส่วนที่ 4 ', 'ส่วนที่ 5 ')))
  assert.match(sec('ส่วนที่ 5 ', CLOSING), /ค้างอยู่ทั้งหมด<\/td><td class="num"><span class="nodata">ไม่มีข้อมูล<\/span><\/td><td class="num">3<\/td>/)
  assert.match(sec('ส่วนที่ 2 ', 'ส่วนที่ 3 '), /คำร้อง\/ร้องทุกข์<\/td><\/tr><tr><td colspan="3" class="nodata">ไม่มีข้อมูล/)
})

test('ข้อมูลว่างจริง (ok แต่ไม่มีเรื่อง) ≠ ไม่มีข้อมูล: แสดง 0 เรื่อง และร้อยละคำนวณไม่ได้ = "—" / ไม่มีเรื่องให้คำนวณ', () => {
  const raw = rawSummaries()
  raw.complaints.data.period = { total: 0, citizen_online: 0, oss_counter: 0, confidential: 0, adhoc: 0 }
  raw.complaints.data.on_time = { completed: 0, on_time: 0, late: 0, no_due: 0, open_past_due: 0, undated: 0 }
  const html = build({ model: buildExecModel(raw) })
  assert.match(html, /เรื่องร้องเรียนรับใหม่ในช่วง<\/td><td class="num">0 เรื่อง/)
  assert.match(html, /คำร้อง \(วันทำการ\)<\/td><td class="num">ไม่มีเรื่องให้คำนวณ/)
  assert.match(html, /ออนไลน์ \(ประชาชนแจ้งเอง\)<\/td><td class="num">0<\/td><td class="num">—<\/td>/)
})

test('ไม่มีข้อมูลเลย (model ว่าง/ทุกส่วน error): ใบยังสร้างได้ ครบทุกส่วน ไม่พัง', () => {
  for (const summaries of [{}, Object.fromEntries(['complaints', 'doc_requests', 'satisfaction', 'departments'].map((k) => [k, { ok: false }]))]) {
    const html = build({ model: buildExecModel(summaries), signatories: null })
    assert.doesNotMatch(html, /undefined|NaN|\[object/)
    assert.ok(count(html, 'ไม่มีข้อมูล') >= 8)
    assert.equal(count(html, 'class="sign-row"'), 3)
  }
})

test('ภาคผนวกสูตร: คัดตรงจากทะเบียน executiveRegistry ทุกสูตร (ไม่เขียนเอง) + กฎเลยกำหนดเกิน 5 วันทำการ', () => {
  const html = build()
  const sec = bodyOf(html).slice(bodyOf(html).indexOf(APPENDIX))
  // ใบพิมพ์แทนเฉพาะ "สัญลักษณ์เตือน" (อีโมจิ — เครื่องพิมพ์ไม่มี glyph) ด้วยคำ ถ้อยคำของสูตรคงตามทะเบียน
  const WARNING = new RegExp(`${String.fromCodePoint(0x26A0)}${String.fromCodePoint(0xFE0F)}?[ ]*`, 'g')
  const printed = (text) => esc(text.replace(WARNING, 'ข้อควรระวัง: '))
  assert.ok(EXECUTIVE_REGISTRY.some((e) => e.kpis.some((k) => k.formula.includes(String.fromCodePoint(0x26A0)))), 'ทะเบียนยังมีสัญลักษณ์เตือน (ไม่งั้นเคสนี้ไม่ได้ทดสอบการแทน)')
  // ตรวจเฉพาะภาคผนวก — คอมเมนต์ CSS/HTML ของ govSignBlock.js มีสัญลักษณ์นี้อยู่ (ไม่ถูกพิมพ์)
  assert.ok(!sec.includes(String.fromCodePoint(0x26A0)), 'ไม่มีอีโมจิเตือนหลุดลงสูตรที่พิมพ์')
  assert.ok(sec.includes('ข้อควรระวัง: '))
  const items = execReportFormulaItems()
  assert.equal(items.length, EXEC_REPORT_FORMULA_SPEC.length + EXEC_REPORT_ALERT_SPEC.length, 'ทุกคู่ในสเปกหาเจอในทะเบียน')
  for (const [entryKey, kpiId] of EXEC_REPORT_FORMULA_SPEC) {
    const entry = EXECUTIVE_REGISTRY.find((e) => e.key === entryKey)
    const kpi = entry.kpis.find((k) => k.id === kpiId)
    assert.ok(sec.includes(printed(kpi.formula)), `${entryKey}:${kpiId}`)
    assert.ok(sec.includes(esc(`${entry.label} · ${kpi.label}`)))
  }
  for (const [entryKey, alertId] of EXEC_REPORT_ALERT_SPEC) {
    const alert = EXECUTIVE_REGISTRY.find((e) => e.key === entryKey).alerts.find((a) => a.id === alertId)
    assert.ok(sec.includes(printed(alert.rule)), `${entryKey}:${alertId}`)
  }
  assert.ok(html.includes('ข้อมูลคำนวณจากระบบ ณ เวลาพิมพ์ ตัวเลขของช่วงที่ผ่านมาอาจขยับได้'))
})

test('ช่องลงนาม: 3 ช่อง ผู้จัดทำ(ว่าง)/ปลัด เสนอ/นายก ทราบ ใช้ govSignRow · ชื่อจาก signatories · ไม่ตั้ง = วงเล็บว่าง + ชื่อตำแหน่งสำรอง', () => {
  const named = build()
  assert.equal(count(named, 'class="sign-row"'), 3)
  for (const w of ['ผู้จัดทำ', 'ผู้เสนอ', 'ผู้รับทราบ']) assert.ok(named.includes(`<span class="sign-role">${w}</span>`), w)
  assert.ok(named.includes('(นายสมชาย ใจดี)') && named.includes('ปลัดเทศบาล') && named.includes('นายกเทศมนตรี'))
  assert.equal(count(named, govNameBlank()), 1, 'มีเฉพาะผู้จัดทำที่เว้นว่าง (ไม่ใส่ชื่อ)')

  const blank = build({ signatories: null })
  assert.equal(count(blank, 'class="sign-row"'), 3, 'ไม่ตั้งผู้ลงนาม ช่องไม่หาย')
  assert.equal(count(blank, govNameBlank()), 3)
  assert.ok(blank.includes(esc(orgClerkTitle(TENANT))) && blank.includes(esc(orgHeadTitle(TENANT))), 'ชื่อตำแหน่งสำรองมีชื่อ อปท. (escape แล้ว)')
  // ผู้ลงนามมีแต่ชื่อ ไม่มีตำแหน่ง → ตำแหน่งสำรอง
  assert.ok(build({ signatories: { clerk: { name: 'นายก ข', title: '' }, mayor: null } }).includes(esc(orgClerkTitle(TENANT))))
  // กล่องลงนามไม่แยกหน้า
  assert.match(named, /\.exec-sign \{[^}]*break-inside: avoid/)
})

test('มาตรฐานใบพิมพ์: A4 แนวตั้ง ใช้ govPageCss/govDocFontCss (font-family ครั้งเดียวจากค่ากลาง) · ไม่เขียน @page margin เอง', () => {
  const html = build()
  assert.ok(html.includes('@page { size: A4 portrait; margin: 0; }'))
  assert.equal(count(html, 'font-family'), 1)
  assert.ok(html.includes('"THSarabunPSK"') && html.includes('font-size-adjust: 0.45') && html.includes('font-size: 14pt'))
  assert.equal(count(html, '@page {'), 1)
})

test('ฟังก์ชันล้วน: ผลเหมือนกันทุกครั้ง ไม่ขึ้นกับเวลาที่เรียก', () => {
  const realNow = Date.now
  const a = build()
  Date.now = () => 0
  try { assert.equal(build(), a) } finally { Date.now = realNow }
})

test('ภาคผนวกพิมพ์สูตรเฉพาะรายการที่ขึ้นจอ: อปท. ปิดโมดูลคำขอ/ผลการปฏิบัติงาน = ไม่มีสูตรของโมดูลนั้น', () => {
  const { liveEntries } = EXEC_REGISTRY_MODULE
  const off = new Set(['inbox', 'performance'])
  const entries = liveEntries((key) => !off.has(key))
  const appendix = (html) => bodyOf(html).slice(bodyOf(html).indexOf(APPENDIX))
  const full = appendix(build())
  const partial = appendix(build({ entries }))
  for (const label of ['คำขอบริการ (E-Service) · % เสร็จทันกำหนด', 'ผลการปฏิบัติงาน · งานบริการค้างรายกอง']) {
    assert.ok(full.includes(esc(label)), `ทะเบียนเต็มมี ${label}`)
    assert.ok(!partial.includes(esc(label)), `ปิดโมดูลแล้วไม่มี ${label}`)
  }
  assert.ok(partial.includes(esc('คำร้อง/ร้องทุกข์ · % เสร็จทันกำหนด')), 'โมดูลที่เปิดยังอยู่')
  assert.ok(partial.includes('หมายเหตุ'), 'หมายเหตุอยู่ในภาคผนวกเสมอ')
})

test('ตัวรายงานจบที่ช่องลงนาม: หมายเหตุเต็มอยู่ภาคผนวก · ท้ายตัวรายงานมีบรรทัดชี้ไปภาคผนวก', () => {
  const html = build()
  const closing = bodyOf(html).slice(bodyOf(html).indexOf(CLOSING), bodyOf(html).indexOf(APPENDIX))
  assert.ok(closing.includes('อยู่ในภาคผนวกท้ายรายงาน'))
  assert.ok(!closing.includes('ร้อยละและคะแนนเฉลี่ยปัดทศนิยม'), 'หมายเหตุเต็มไม่อยู่ท้ายตัวรายงาน')
  assert.ok(bodyOf(html).slice(bodyOf(html).indexOf(APPENDIX)).includes('ร้อยละและคะแนนเฉลี่ยปัดทศนิยม'))
})

test('ทั้งใบ 14pt: ไม่มีข้อยกเว้นขนาดตัวอักษร (ไม่ลด .small เป็น 11pt) — AGENTS.md', () => {
  const css = build().slice(0, build().indexOf('</style>'))
  assert.doesNotMatch(css, /\.small\s*\{[^}]*font-size/)
  assert.doesNotMatch(css, /font-size:\s*11pt;\s*line-height/)
})

test('ตัวเลือกไตรมาสมีเดือนกำกับ (optionLabel) · หัวใบยังใช้ label เต็ม', () => {
  const q = execReportDefaultPeriod('quarter', at('2027-01-05'))
  assert.equal(q.label, 'ไตรมาสที่ 1 ปีงบประมาณ 2570')
  assert.match(q.optionLabel, /ต\.ค\./, `optionLabel ต้องบอกเดือน: ${q.optionLabel}`)
  assert.ok(execReportDefaultPeriod('month', at('2027-01-05')).optionLabel, 'รายเดือนก็มี optionLabel (ไม่เป็น undefined ในตัวเลือก)')
})

test('ทุกรายงานแบบ action ในทะเบียนมีตัววาดใน ExecutiveHome.jsx (ไม่งั้นหายจากจอเงียบๆ)', () => {
  const src = readFileSync(new URL('../src/components/staff/executive/ExecutiveHome.jsx', import.meta.url), 'utf8')
  const map = src.match(/const ACTION_REPORTS = Object\.freeze\(\{([^}]*)\}\)/)
  assert.ok(map, 'หา ACTION_REPORTS ไม่เจอ — โครงเปลี่ยน ต้องแก้เทสต์นี้ให้ตาม ไม่ใช่ลบทิ้ง')
  const ids = new Set([...map[1].matchAll(/([A-Za-z_][\w]*)\s*:/g)].map((m) => m[1]))
  const actions = EXECUTIVE_REGISTRY.flatMap((e) => (e.reports ?? []).filter((r) => r.action || !r.path).map((r) => r.id))
  assert.ok(actions.length > 0, 'มีรายการ action อย่างน้อย 1 (service_summary)')
  for (const id of actions) assert.ok(ids.has(id), `รายงาน action "${id}" ไม่มีตัววาดใน ACTION_REPORTS`)
  for (const r of EXECUTIVE_REGISTRY.flatMap((e) => e.reports ?? [])) {
    assert.ok(Boolean(r.path) !== Boolean(r.action), `รายงาน "${r.id}" ต้องมี path หรือ action อย่างใดอย่างหนึ่ง`)
  }
})

console.log(`\nok — ${cases} cases`)
