// ตรรกะฝั่งหน้าจอของเมนู "แผนพัฒนาท้องถิ่น" (src/lib/localPlanView.js) — คำนวณล้วน ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   node tests/local-plan-view.test.mjs
// ตั้งโซนเวลาเครื่องเป็นต่างประเทศก่อน import — โค้ดที่เผลออ่านวันจากนาฬิกา/โซนเครื่องจะเพี้ยนให้เห็น
import assert from 'node:assert/strict'

process.env.TZ = 'America/Los_Angeles'
const V = await import('../src/lib/localPlanView.js')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// ── menuLabel ──────────────────────────────────────────────────────────────

test('menuLabel: ช่วงปีอ่านจากข้อมูล ไม่ฝังปี · ไม่มีแผน/ปีไม่ครบ → ชื่อเปล่า', () => {
  assert.equal(V.menuLabel({ year_from: 2571, year_to: 2575 }), 'แผนพัฒนาท้องถิ่น (พ.ศ.2571-2575)')
  assert.equal(V.menuLabel({ year_from: 2576, year_to: 2580 }), 'แผนพัฒนาท้องถิ่น (พ.ศ.2576-2580)')
  assert.equal(V.menuLabel({ year_from: 2571, year_to: 2571 }), 'แผนพัฒนาท้องถิ่น (พ.ศ.2571)')
  assert.equal(V.menuLabel({ year_from: '2571', year_to: '2575' }), 'แผนพัฒนาท้องถิ่น (พ.ศ.2571-2575)')
  assert.equal(V.menuLabel(null), 'แผนพัฒนาท้องถิ่น')
  assert.equal(V.menuLabel(undefined), 'แผนพัฒนาท้องถิ่น')
  assert.equal(V.menuLabel({}), 'แผนพัฒนาท้องถิ่น')
  assert.equal(V.menuLabel({ year_from: 2571 }), 'แผนพัฒนาท้องถิ่น')
  assert.equal(V.menuLabel({ year_from: null, year_to: null }), 'แผนพัฒนาท้องถิ่น')
})

test('fiscalYearOfIso: ต.ค.–ธ.ค. = ปีงบถัดไป · ม.ค.–ก.ย. = ปีงบเดียวกับปี พ.ศ.', () => {
  assert.equal(V.fiscalYearOfIso('2026-09-30'), 2569)
  assert.equal(V.fiscalYearOfIso('2026-10-01'), 2570)
  assert.equal(V.fiscalYearOfIso('2026-12-31'), 2570)
  assert.equal(V.fiscalYearOfIso('2027-01-01'), 2570)
  assert.equal(V.fiscalYearOfIso('bad'), null)
  assert.equal(V.fiscalYearOfIso(undefined), null)
})

// ── เลขฉบับ ────────────────────────────────────────────────────────────────

const OP = [
  { id: 'a', fiscal_year: 2570, kind: 'main', revision_no: 0, status: 'published' },
  { id: 'b', fiscal_year: 2570, kind: 'supplement', revision_no: 1, status: 'published' },
  { id: 'c', fiscal_year: 2570, kind: 'amendment', revision_no: 2, status: 'draft' },
  { id: 'd', fiscal_year: 2571, kind: 'main', revision_no: 0, status: 'draft' },
]

test('nextRevisionNo: ไม่มีฉบับ = 0 · ไม่ซ้ำข้ามชนิด (UNIQUE อปท.+ปีงบ+revision_no) · แยกรายปี', () => {
  assert.equal(V.nextRevisionNo([], 2570), 0)
  assert.equal(V.nextRevisionNo(null, 2570), 0)
  assert.equal(V.nextRevisionNo(OP, 2569), 0)
  assert.equal(V.nextRevisionNo(OP, 2570), 3)
  assert.equal(V.nextRevisionNo(OP, 2571), 1)
  assert.equal(V.nextRevisionNo(OP, '2570'), 3)
})

test('versionLabel: ฉบับหลัก / เพิ่มเติมครั้งที่ n / แก้ไขครั้งที่ n', () => {
  assert.equal(V.versionLabel(OP[0]), 'ฉบับหลัก')
  assert.equal(V.versionLabel(OP[1]), 'เพิ่มเติมครั้งที่ 1')
  assert.equal(V.versionLabel(OP[2]), 'แก้ไขครั้งที่ 2')
  assert.equal(V.versionLabel(null), 'ฉบับหลัก')
})

test('latestOpPlan: revision_no สูงสุดของปี', () => {
  assert.equal(V.latestOpPlan(OP, 2570).id, 'c')
  assert.equal(V.latestOpPlan(OP, 2571).id, 'd')
  assert.equal(V.latestOpPlan(OP, 2575), null)
})

// ── canEditItem ────────────────────────────────────────────────────────────

test('canEditItem: ผู้จัดการแก้ได้หมด · กองของแถวแก้เดือน+หมายเหตุ · คนอื่น/ฉบับประกาศแล้ว แก้ไม่ได้', () => {
  const draft = { status: 'draft' }
  const item = { id: 'i1', department_id: 'D1' }
  assert.deepEqual(V.canEditItem({ isManager: true, role: 'staff', myDepartmentId: 'D9', item, opPlan: draft }), { months: true, note: true, all: true })
  assert.deepEqual(V.canEditItem({ isManager: false, role: 'officer', myDepartmentId: 'D1', item, opPlan: draft }), { months: true, note: true, all: false })
  assert.deepEqual(V.canEditItem({ isManager: false, role: 'staff', myDepartmentId: 'D1', item, opPlan: draft }), { months: true, note: true, all: false })
  const none = { months: false, note: false, all: false }
  assert.deepEqual(V.canEditItem({ isManager: false, role: 'staff', myDepartmentId: 'D2', item, opPlan: draft }), none)
  assert.deepEqual(V.canEditItem({ isManager: false, role: 'viewer', myDepartmentId: 'D1', item, opPlan: draft }), none)
  assert.deepEqual(V.canEditItem({ isManager: false, role: 'technician', myDepartmentId: 'D1', item, opPlan: draft }), none)
  // ไม่มีกองของตัวเอง/แถวไม่มีกอง: ไม่ใช่ "กองเดียวกัน" (undefined === undefined ต้องไม่ผ่าน)
  assert.deepEqual(V.canEditItem({ isManager: false, role: 'staff', myDepartmentId: null, item: { department_id: null }, opPlan: draft }), none)
  assert.deepEqual(V.canEditItem({ isManager: false, role: 'staff', myDepartmentId: undefined, item: {}, opPlan: draft }), none)
  // ประกาศแล้วแช่แข็งทุกคน รวมผู้จัดการ
  assert.deepEqual(V.canEditItem({ isManager: true, role: 'admin', myDepartmentId: 'D1', item, opPlan: { status: 'published' } }), none)
  assert.deepEqual(V.canEditItem({ isManager: false, role: 'staff', myDepartmentId: 'D1', item, opPlan: { status: 'published' } }), none)
  assert.deepEqual(V.canEditItem({ isManager: true, role: 'admin', item: null, opPlan: draft }), none)
  assert.deepEqual(V.canEditItem({ isManager: true, role: 'admin', item, opPlan: null }), none)
})

// ── applyMonthClick ────────────────────────────────────────────────────────

test('applyMonthClick: เริ่ม → จบ · กดจบก่อนเริ่มสลับให้ · เดือนเดียวกัน = ช่วง 1 เดือน', () => {
  assert.deepEqual(V.applyMonthClick(null, 3), { pending: 3, commit: null })
  assert.deepEqual(V.applyMonthClick(undefined, 3), { pending: 3, commit: null })
  assert.deepEqual(V.applyMonthClick(3, 7), { pending: null, commit: { from: 3, to: 7 } })
  assert.deepEqual(V.applyMonthClick(7, 3), { pending: null, commit: { from: 3, to: 7 } })
  assert.deepEqual(V.applyMonthClick(5, 5), { pending: null, commit: { from: 5, to: 5 } })
  assert.deepEqual(V.applyMonthClick(1, 12), { pending: null, commit: { from: 1, to: 12 } })
  // เดือนผิด: ไม่เปลี่ยนสถานะ ไม่บันทึก
  assert.deepEqual(V.applyMonthClick(null, 0), { pending: null, commit: null })
  assert.deepEqual(V.applyMonthClick(4, 13), { pending: 4, commit: null })
  assert.deepEqual(V.applyMonthClick(4, 'x'), { pending: 4, commit: null })
})

// ── เรียงลำดับ ─────────────────────────────────────────────────────────────

test('reorderItems: ตั้งลำดับใหม่ 10,20,… และคืนเฉพาะแถวที่เปลี่ยน', () => {
  const items = [{ id: 'a', sort_order: 10 }, { id: 'b', sort_order: 20 }, { id: 'c', sort_order: 30 }]
  assert.deepEqual(V.reorderItems(items, 'b', 'up'), [{ id: 'b', sort_order: 10 }, { id: 'a', sort_order: 20 }])
  assert.deepEqual(V.reorderItems(items, 'b', 'down'), [{ id: 'c', sort_order: 20 }, { id: 'b', sort_order: 30 }])
  assert.deepEqual(V.reorderItems(items, 'a', 'up'), [])
  assert.deepEqual(V.reorderItems(items, 'c', 'down'), [])
  assert.deepEqual(V.reorderItems(items, 'zzz', 'up'), [])
})

test('reorderItems: นำเข้ามา sort_order เป็น 0 ทุกแถว — เลื่อนแล้วต้องขยับจริง (สลับค่าเฉยๆ จะไม่ขยับ)', () => {
  const items = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 0 }, { id: 'c', sort_order: 0 }]
  const changes = V.reorderItems(items, 'c', 'up')
  // ลำดับใหม่ a, c, b → 10, 20, 30 · a ยังเป็น 0 → เปลี่ยนเป็น 10 ด้วย
  assert.deepEqual(changes, [{ id: 'a', sort_order: 10 }, { id: 'c', sort_order: 20 }, { id: 'b', sort_order: 30 }])
})

test('sortItems: sort_order → seq_no (ว่างไว้ท้าย) · ไม่แก้ array เดิม', () => {
  const input = [
    { id: 'x', sort_order: 0, seq_no: null, item_name: 'ก' },
    { id: 'y', sort_order: 0, seq_no: 2, item_name: 'ข' },
    { id: 'z', sort_order: 0, seq_no: 1, item_name: 'ค' },
    { id: 'w', sort_order: -5, seq_no: 9, item_name: 'ง' },
  ]
  assert.deepEqual(V.sortItems(input).map(i => i.id), ['w', 'z', 'y', 'x'])
  assert.deepEqual(input.map(i => i.id), ['x', 'y', 'z', 'w'])
})

test('nextSeqNo: max+1 · ว่างเริ่ม 1', () => {
  assert.equal(V.nextSeqNo([]), 1)
  assert.equal(V.nextSeqNo([{ seq_no: null }]), 1)
  assert.equal(V.nextSeqNo([{ seq_no: 3 }, { seq_no: null }, { seq_no: 7 }]), 8)
})

// ── เงิน ───────────────────────────────────────────────────────────────────

test('formatBaht / abbrevBaht', () => {
  assert.equal(V.formatBaht(1234567.5), '1,234,567.50')
  assert.equal(V.formatBaht(0), '0.00')
  assert.equal(V.formatBaht('500000'), '500,000.00')
  assert.equal(V.formatBaht(null), '—')
  assert.equal(V.formatBaht(''), '—')
  assert.equal(V.formatBaht('abc'), '—')
  assert.equal(V.abbrevBaht(1_200_000), '1.2 ล้าน')
  assert.equal(V.abbrevBaht(1_234_567), '1.23 ล้าน')
  assert.equal(V.abbrevBaht(10_000_000), '10 ล้าน')
  assert.equal(V.abbrevBaht(500_000), '500,000')
  assert.equal(V.abbrevBaht(999_999.5), '999,999.50')
  assert.equal(V.abbrevBaht(null), '—')
})

test('sumAmount: ช่องว่างนับ 0 และไม่มีทศนิยมลอย', () => {
  assert.equal(V.sumAmount([{ amount: 0.1 }, { amount: 0.2 }]), 0.3)
  assert.equal(V.sumAmount([{ amount: '100.50' }, { amount: null }, {}]), 100.5)
  assert.equal(V.sumAmount([]), 0)
  assert.equal(V.sumAmount(null), 0)
})

test('parseAmountInput: ว่าง = ไม่ระบุ · ลูกน้ำได้ · ติดลบ/ทศนิยมเกิน/ไม่ใช่เลข = error', () => {
  assert.deepEqual(V.parseAmountInput(''), { value: null, error: '' })
  assert.deepEqual(V.parseAmountInput('  '), { value: null, error: '' })
  assert.deepEqual(V.parseAmountInput(null), { value: null, error: '' })
  assert.deepEqual(V.parseAmountInput('1,200,000'), { value: 1200000, error: '' })
  assert.deepEqual(V.parseAmountInput('0'), { value: 0, error: '' })
  assert.deepEqual(V.parseAmountInput('12.5'), { value: 12.5, error: '' })
  for (const bad of ['-5', '1.234', 'abc', '1e5', '12,34,5x', '10000000000000']) {
    const r = V.parseAmountInput(bad)
    assert.equal(r.value, null, bad)
    assert.ok(r.error, bad)
  }
})

test('yearsSummary: ปี 2 หลักเรียงตามปี', () => {
  assert.equal(V.yearsSummary([{ fiscal_year: 2572, amount: 1_200_000 }, { fiscal_year: 2571, amount: 500_000 }]), '71: 500,000 · 72: 1.2 ล้าน')
  assert.equal(V.yearsSummary([{ fiscal_year: 2571, amount: null }]), '71: —')
  assert.equal(V.yearsSummary([]), '')
  assert.equal(V.yearsSummary(null), '')
})

// ── buildAttention ─────────────────────────────────────────────────────────

const DEV = { year_from: 2571, year_to: 2575, status: 'published' } // แผนสิ้นอายุ 30 ก.ย. 2575 = 2032-09-30 · เส้น 180 วัน = 2032-04-03

test('buildAttention: ไม่มีอะไรผิด → ว่าง · ไม่มีข้อมูลเลย → ว่าง ไม่พัง', () => {
  assert.deepEqual(V.buildAttention({ devPlan: DEV, opPlans: [], items: [], projects: [], today: '2030-01-01' }), [])
  assert.deepEqual(V.buildAttention({ today: '2030-01-01' }), [])
  assert.deepEqual(V.buildAttention(), V.buildAttention({}))
})

test('buildAttention: ข้อ 22 — closing เป็น warn · closed เป็น warn · expired เป็น info', () => {
  const at = today => V.buildAttention({ devPlan: DEV, today })
  assert.deepEqual(at('2032-03-24').map(x => [x.level, x.rule]), [['warn', 'ข้อ 22']])
  assert.match(at('2032-03-24')[0].text, /เหลือ 10 วัน/)
  assert.deepEqual(at('2032-04-03').map(x => x.level), ['warn']) // วันสุดท้าย
  assert.match(at('2032-04-04')[0].text, /ห้ามเพิ่มเติม/)
  assert.deepEqual(at('2032-10-01').map(x => x.level), ['info'])
})

test('buildAttention: ข้อ 27 — เฉพาะฉบับร่าง · เกินกำหนด/ครบวันนี้ = danger · เหลือ ≤7 วัน = warn · ไม่มีฐาน = info', () => {
  const plan = (id, extra) => ({ id, fiscal_year: 2571, kind: 'main', revision_no: 0, status: 'draft', basis: 'annual_budget', ...extra })
  // basis_on 2030-10-15 → ครบ 2030-11-14
  const at = (today, p) => V.buildAttention({ opPlans: [p], today })
  assert.deepEqual(at('2030-10-20', plan('a', { basis_on: '2030-10-15' })), []) // เหลือ 25 วัน = open ไม่เตือน
  const soon = at('2030-11-10', plan('a', { basis_on: '2030-10-15' }))
  assert.deepEqual(soon.map(x => [x.level, x.rule]), [['warn', 'ข้อ 27']])
  assert.match(soon[0].text, /^ปีงบ 2571 · ฉบับหลัก: ใกล้ครบกำหนด.*เหลือ 4 วัน/)
  assert.equal(at('2030-11-14', plan('a', { basis_on: '2030-10-15' }))[0].level, 'danger')
  assert.equal(at('2030-11-20', plan('a', { basis_on: '2030-10-15' }))[0].level, 'danger')
  assert.equal(at('2030-10-20', plan('a', { basis_on: null, basis: null }))[0].level, 'info')
  // ฉบับที่ประกาศแล้ว ไม่เตือน (แม้เลยกำหนด)
  assert.deepEqual(at('2030-11-20', plan('a', { basis_on: '2030-10-15', status: 'published', published_on: '2030-11-01' })), [])
  // ขยายเวลาแล้ว: ใช้กำหนดใหม่
  assert.deepEqual(at('2030-11-20', plan('a', { basis_on: '2030-10-15', extended_due_on: '2030-12-31', extension_ref_no: 'x' })), [])
})

test('buildAttention: ข้อ 25 — นับเฉพาะรายการ local ที่ไม่ผูกทะเบียนในฉบับร่าง', () => {
  const opPlans = [
    { id: 'd1', fiscal_year: 2571, kind: 'main', revision_no: 0, status: 'draft', basis: 'annual_budget', basis_on: '2030-10-15' },
    { id: 'p1', fiscal_year: 2570, kind: 'main', revision_no: 0, status: 'published', published_on: '2029-11-01' },
  ]
  const items = [
    { op_plan_id: 'd1', source: 'local', dev_project_id: null },
    { op_plan_id: 'd1', source: 'local', dev_project_id: null },
    { op_plan_id: 'd1', source: 'local', dev_project_id: 'P' },
    { op_plan_id: 'd1', source: 'external', dev_project_id: null }, // หน่วยงานอื่น ไม่ต้องผูก
    { op_plan_id: 'p1', source: 'local', dev_project_id: null }, // ฉบับประกาศแล้ว แก้ไม่ได้ ไม่นับ
    { op_plan_id: 'ghost', source: 'local', dev_project_id: null }, // ไม่รู้ว่าฉบับไหน ไม่นับ
  ]
  const out = V.buildAttention({ opPlans, items, today: '2030-10-20' })
  assert.deepEqual(out.map(x => [x.level, x.rule, x.text]), [['warn', 'ข้อ 25', '2 รายการในแผนการดำเนินงาน (ฉบับร่าง) ยังไม่ผูกทะเบียนโครงการ']])
})

test('buildAttention: โครงการไม่มีกอง (เฉพาะที่ยังใช้งาน) เป็น info', () => {
  const projects = [
    { id: '1', department_id: null, status: 'active' },
    { id: '2', department_id: null, status: 'dropped' },
    { id: '3', department_id: 'D', status: 'active' },
  ]
  const out = V.buildAttention({ projects, today: '2030-01-01' })
  assert.deepEqual(out.map(x => [x.level, x.text]), [['info', '1 โครงการในทะเบียนยังไม่ระบุกองผู้รับผิดชอบ']])
})

test('buildAttention: เรียง danger → warn → info และคงลำดับเดิมในระดับเดียวกัน', () => {
  const opPlans = [
    { id: 'a', fiscal_year: 2571, kind: 'main', revision_no: 0, status: 'draft', basis: 'annual_budget', basis_on: '2030-10-15' },
    { id: 'b', fiscal_year: 2572, kind: 'main', revision_no: 0, status: 'draft' }, // ไม่มีฐาน = info
  ]
  const out = V.buildAttention({
    devPlan: DEV, opPlans, projects: [{ id: '1', department_id: null, status: 'active' }],
    items: [{ op_plan_id: 'a', source: 'local', dev_project_id: null }], today: '2030-11-20',
  })
  assert.deepEqual(out.map(x => x.level), ['danger', 'warn', 'info', 'info'])
  assert.deepEqual(out.map(x => x.rule), ['ข้อ 27', 'ข้อ 25', 'ข้อ 27', 'ทะเบียนโครงการ'])
})

console.log(`\nlocal-plan-view: ${cases} cases passed`)
