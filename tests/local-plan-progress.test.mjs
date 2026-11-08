// ตรรกะแท็บ "ติดตามผล" (src/lib/localPlanProgress.js) — คำนวณล้วน ไม่ใช้เน็ต ไม่แตะข้อมูลจริง ข้อมูลทั้งหมดเป็นข้อมูลสมมติ
//   node tests/local-plan-progress.test.mjs
// ตั้งโซนเวลาเครื่องเป็นต่างประเทศก่อน import — โค้ดที่เผลออ่านวันจากโซนเครื่องจะเพี้ยนให้เห็น
import assert from 'node:assert/strict'

process.env.TZ = 'America/Los_Angeles'
const P = await import('../src/lib/localPlanProgress.js')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// ── ชุดข้อมูลสมมติ ─────────────────────────────────────────────────────────

const plan = (id, kind, revision_no, status = 'published', fiscal_year = 2570) => ({ id, kind, revision_no, status, fiscal_year })
const row = (id, op_plan_id, over = {}) => ({ id, op_plan_id, origin_item_id: null, sort_order: 10, item_name: `รายการ ${id}`, ...over })
const ids = list => list.map(r => r.id)

// ── lineageOf ─────────────────────────────────────────────────────────────

test('lineageOf: ต้นสาย = id ตัวเอง · แถวที่คัดมา = origin_item_id', () => {
  assert.equal(P.lineageOf({ id: 'a', origin_item_id: null }), 'a')
  assert.equal(P.lineageOf({ id: 'b', origin_item_id: 'a' }), 'a')
  assert.equal(P.lineageOf({ id: 'c' }), 'c')
  assert.equal(P.lineageOf(null), null)
})

// ── effectiveItemSet ──────────────────────────────────────────────────────

test('effectiveItemSet: ฉบับหลักอย่างเดียว', () => {
  const plans = [plan('m', 'main', 0)]
  const items = [row('i1', 'm', { sort_order: 20 }), row('i2', 'm', { sort_order: 10 })]
  assert.deepEqual(ids(P.effectiveItemSet(plans, items, 2570)), ['i2', 'i1'], 'เรียงตาม sort_order ในฉบับ')
})

test('effectiveItemSet: หลัก + เพิ่มเติม = รวมกัน · ปีอื่นไม่ปน', () => {
  const plans = [plan('m', 'main', 0), plan('s1', 'supplement', 1), plan('other', 'main', 0, 'published', 2571)]
  const items = [row('i1', 'm'), row('i2', 'm'), row('n1', 's1'), row('x', 'other')]
  assert.deepEqual(ids(P.effectiveItemSet(plans, items, 2570)), ['i1', 'i2', 'n1'])
  assert.deepEqual(ids(P.effectiveItemSet(plans, items, 2571)), ['x'])
})

test('effectiveItemSet: หลัก + เพิ่มเติม + แก้ไข (แก้ไขคัดชุดรวม) → เพิ่มเติมก่อนหน้าไม่ถูกนับซ้ำ', () => {
  const plans = [plan('m', 'main', 0), plan('s1', 'supplement', 1), plan('a2', 'amendment', 2)]
  const items = [
    row('i1', 'm'), row('i2', 'm'), row('n1', 's1'),
    // ฉบับแก้ไขคัดชุดรวม: แถวใหม่ชี้ต้นสาย (origin) กลับไปที่แถวเดิม
    row('a-i1', 'a2', { origin_item_id: 'i1', item_name: 'ชื่อที่แก้ใน i1' }), row('a-i2', 'a2', { origin_item_id: 'i2' }), row('a-n1', 'a2', { origin_item_id: 'n1' }),
  ]
  const out = P.effectiveItemSet(plans, items, 2570)
  assert.deepEqual(ids(out), ['a-i1', 'a-i2', 'a-n1'], 'ต้องมีแค่ 3 รายการจากฉบับแก้ไข ไม่ซ้ำกับ main/supplement')
  assert.equal(out[0].item_name, 'ชื่อที่แก้ใน i1')
  assert.deepEqual(out.map(P.lineageOf), ['i1', 'i2', 'n1'], 'สายตรงกับต้นสายเดิม — ผลที่กดไว้ตามมา')
})

test('effectiveItemSet: ฉบับเพิ่มเติมที่ทำ "หลัง" ฉบับแก้ไข นับต่อจากฐาน', () => {
  const plans = [plan('m', 'main', 0), plan('a1', 'amendment', 1), plan('s2', 'supplement', 2), plan('s3', 'supplement', 3)]
  const items = [row('i1', 'm'), row('a-i1', 'a1', { origin_item_id: 'i1' }), row('n2', 's2'), row('n3', 's3')]
  assert.deepEqual(ids(P.effectiveItemSet(plans, items, 2570)), ['a-i1', 'n2', 'n3'])
})

test('effectiveItemSet: ฉบับแก้ไขตัดรายการออก → ไม่ฟื้นกลับ', () => {
  const plans = [plan('m', 'main', 0), plan('s1', 'supplement', 1), plan('a2', 'amendment', 2)]
  const items = [row('i1', 'm'), row('i2', 'm'), row('n1', 's1'), row('a-i1', 'a2', { origin_item_id: 'i1' })]   // i2 และ n1 ถูกตัดออก
  assert.deepEqual(ids(P.effectiveItemSet(plans, items, 2570)), ['a-i1'])
})

test('effectiveItemSet: ฉบับเพิ่มเติมที่ไม่ได้ถูกคัดเข้าฉบับแก้ไข (ครั้งที่ต่ำกว่าฐาน) ถูกข้ามแม้ยังมีรายการ', () => {
  const plans = [plan('m', 'main', 0), plan('s1', 'supplement', 1), plan('a2', 'amendment', 2)]
  const items = [row('i1', 'm'), row('n1', 's1'), row('a-i1', 'a2', { origin_item_id: 'i1' })]
  assert.equal(ids(P.effectiveItemSet(plans, items, 2570)).includes('n1'), false)
})

test('effectiveItemSet: publishedOnly — ร่างล่าสุดถูกข้าม · ไม่มีฉบับประกาศ = ว่าง', () => {
  const plans = [plan('m', 'main', 0), plan('a1', 'amendment', 1, 'draft')]
  const items = [row('i1', 'm'), row('a-i1', 'a1', { origin_item_id: 'i1', item_name: 'ร่าง' })]
  const out = P.effectiveItemSet(plans, items, 2570, { publishedOnly: true })
  assert.deepEqual(ids(out), ['i1'], 'ฉบับแก้ไขที่ยังเป็นร่างต้องไม่มีผลต่อการติดตามผล')
  assert.deepEqual(P.effectiveItemSet([plan('d', 'main', 0, 'draft')], [row('x', 'd')], 2570, { publishedOnly: true }), [])
})

test('effectiveItemSet: publishedOnly=false รวมร่างล่าสุด แต่ข้ามร่างที่ไม่ใช่ล่าสุด', () => {
  const plans = [plan('m', 'main', 0), plan('s1', 'supplement', 1, 'draft'), plan('s2', 'supplement', 2, 'draft')]
  const items = [row('i1', 'm'), row('n1', 's1'), row('n2', 's2')]
  assert.deepEqual(ids(P.effectiveItemSet(plans, items, 2570, { publishedOnly: false })), ['i1', 'n2'], 'ร่างค้าง s1 ไม่ใช่ล่าสุด ต้องถูกข้าม')
  assert.deepEqual(ids(P.effectiveItemSet(plans, items, 2570)), ['i1'], 'ค่าเริ่มต้นคือ publishedOnly')
})

test('effectivePlans: ลำดับ ฐานก่อนแล้วเพิ่มเติมตามครั้งที่ · ไม่มีฉบับหลักแต่มีเพิ่มเติม ก็ยังได้เพิ่มเติม', () => {
  const plans = [plan('s2', 'supplement', 2), plan('m', 'main', 0), plan('s1', 'supplement', 1)]
  assert.deepEqual(P.effectivePlans(plans, 2570).map(p => p.id), ['m', 's1', 's2'])
  assert.deepEqual(P.effectivePlans([plan('s1', 'supplement', 1)], 2570).map(p => p.id), ['s1'])
  assert.deepEqual(P.effectivePlans([], 2570), [])
  assert.deepEqual(P.effectivePlans(null, 2570), [])
})

test('publishedFiscalYears: เฉพาะปีที่มีฉบับประกาศ ใหม่→เก่า ไม่ซ้ำ', () => {
  const plans = [plan('a', 'main', 0, 'published', 2569), plan('b', 'supplement', 1, 'published', 2569), plan('c', 'main', 0, 'draft', 2571), plan('d', 'main', 0, 'published', 2570)]
  assert.deepEqual(P.publishedFiscalYears(plans), [2570, 2569])
  assert.deepEqual(P.publishedFiscalYears(null), [])
})

// ── civilStatusOf ─────────────────────────────────────────────────────────

test('civilStatusOf: ครบ 12 ขั้น', () => {
  const at = '2026-12-31T20:00:00Z'   // = 1 ม.ค. 2027 ตามเวลาไทย (03:00)
  assert.equal(P.civilStatusOf('budgeted', at), null)
  assert.equal(P.civilStatusOf('designing', at), null)
  for (const stage of ['procuring', 'contracted', 'started', 'construction', 'final_inspection', 'suspended']) {
    assert.deepEqual(P.civilStatusOf(stage, at), { status: 'in_progress', doneOn: null, approxDate: false, reason: null }, stage)
  }
  for (const stage of ['warranty', 'closed']) {
    assert.deepEqual(P.civilStatusOf(stage, at), { status: 'done', doneOn: '2027-01-01', approxDate: true, reason: null }, stage)
  }
  assert.deepEqual(P.civilStatusOf('cancelled', at), { status: 'not_done', doneOn: null, approxDate: false, reason: 'ยกเลิก (ก่อนทำสัญญา)' })
  assert.deepEqual(P.civilStatusOf('terminated', at), { status: 'not_done', doneOn: null, approxDate: false, reason: 'บอกเลิกสัญญา' })
  assert.equal(P.civilStatusOf('weird', at), null, 'ขั้นที่ไม่รู้จัก = ไม่เดา')
  assert.equal(P.civilStatusOf(undefined, at), null)
})

test('civilStatusOf: วันแล้วเสร็จเป็นวันที่ไทย (ไม่ใช่ UTC/โซนเครื่อง) · เวลาเสียไม่พัง', () => {
  assert.equal(P.civilStatusOf('closed', '2026-03-31T18:30:00Z').doneOn, '2026-04-01')   // 01:30 ไทย
  assert.equal(P.civilStatusOf('closed', '2026-03-31T16:30:00Z').doneOn, '2026-03-31')   // 23:30 ไทย
  assert.equal(P.civilStatusOf('warranty', 'not a date').doneOn, null)
  assert.equal(P.civilStatusOf('warranty', null).doneOn, null)
})

// ── pickCivilStage / civilStageMap ────────────────────────────────────────

test('pickCivilStage: หลายแถวเลือก stage_changed_at ล่าสุด · ว่าง = null', () => {
  const rows = [
    { registry_ref: 'r', stage: 'closed', stage_changed_at: '2026-01-01T00:00:00Z' },
    { registry_ref: 'r', stage: 'construction', stage_changed_at: '2026-06-01T00:00:00Z' },
    { registry_ref: 'r', stage: 'started', stage_changed_at: '2026-03-01T00:00:00Z' },
  ]
  assert.equal(P.pickCivilStage(rows).stage, 'construction')
  assert.equal(P.pickCivilStage([]), null)
  assert.equal(P.pickCivilStage(null), null)
  assert.equal(P.pickCivilStage([{ stage: 'a', stage_changed_at: null }, { stage: 'b', stage_changed_at: '2026-01-01T00:00:00Z' }]).stage, 'b')
})

test('civilStageMap: จัดกลุ่มตามทะเบียนแล้วเลือกล่าสุดต่อกลุ่ม', () => {
  const map = P.civilStageMap([
    { registry_ref: 'r1', stage: 'started', stage_changed_at: '2026-02-01T00:00:00Z' },
    { registry_ref: 'r1', stage: 'closed', stage_changed_at: '2026-09-01T00:00:00Z' },
    { registry_ref: 'r2', stage: 'procuring', stage_changed_at: '2026-02-01T00:00:00Z' },
    { registry_ref: null, stage: 'x', stage_changed_at: '2026-02-01T00:00:00Z' },
  ])
  assert.deepEqual(Object.keys(map).sort(), ['r1', 'r2'])
  assert.equal(map.r1.stage, 'closed')
})

// ── resolveItemStatus ─────────────────────────────────────────────────────

test('resolveItemStatus: ผูกก่อสร้างและพบขั้น → ใช้ขั้น (civil) แม้กองกดเองไว้', () => {
  const item = { id: 'i', dev_project_id: 'p1' }
  const civilByRef = { p1: { stage: 'closed', stage_changed_at: '2026-08-15T05:00:00Z' } }
  const manual = { status: 'in_progress', started_on: '2026-02-01', done_on: null, reason: null, note: 'x' }
  const r = P.resolveItemStatus({ item, progress: manual, civilByRef })
  assert.equal(r.source, 'civil')
  assert.equal(r.status, 'done')
  assert.equal(r.doneOn, '2026-08-15')
  assert.equal(r.approxDate, true)
  assert.equal(r.stage, 'closed')
  assert.equal(r.civilLinkedNoStage, false)
})

test('resolveItemStatus: ขั้นยังไม่เริ่ม (budgeted) = ยังไม่ดำเนินการ แต่ยังถือว่ามาจากก่อสร้าง', () => {
  const r = P.resolveItemStatus({ item: { id: 'i', dev_project_id: 'p1' }, civilByRef: { p1: { stage: 'budgeted', stage_changed_at: '2026-01-01T00:00:00Z' } } })
  assert.equal(r.status, 'none')
  assert.equal(r.source, 'civil')
})

test('resolveItemStatus: ยกเลิก/บอกเลิกจากก่อสร้าง → ไม่ได้ดำเนินการ พร้อมเหตุผลเป็นชื่อขั้น', () => {
  const r = P.resolveItemStatus({ item: { id: 'i', dev_project_id: 'p1' }, civilByRef: { p1: { stage: 'terminated', stage_changed_at: '2026-05-01T00:00:00Z' } } })
  assert.deepEqual([r.status, r.reason, r.source], ['not_done', 'บอกเลิกสัญญา', 'civil'])
})

test('resolveItemStatus: ไม่มีขั้นก่อสร้าง → ใช้ผลที่กองกด (manual) · ไม่มีเลย = none', () => {
  const item = { id: 'i', dev_project_id: 'p1' }
  const manual = { status: 'done', started_on: '2026-02-01', done_on: '2026-05-05', reason: null, note: 'เสร็จ' }
  const r = P.resolveItemStatus({ item, progress: manual, civilByRef: {} })
  assert.deepEqual([r.status, r.source, r.doneOn, r.startedOn, r.note], ['done', 'manual', '2026-05-05', '2026-02-01', 'เสร็จ'])
  const none = P.resolveItemStatus({ item, progress: null, civilByRef: {} })
  assert.deepEqual([none.status, none.source], ['none', 'none'])
  assert.equal(P.resolveItemStatus({ item: { id: 'x', dev_project_id: null }, civilByRef: { p1: { stage: 'closed' } } }).source, 'none', 'ไม่ผูกทะเบียน = ไม่มีวันได้ผลก่อสร้าง')
  assert.equal(P.resolveItemStatus({}).status, 'none')
})

test('resolveItemStatus: civilLinkedNoStage — ผูกแล้ว (อยู่ใน linkedRefs) แต่ปีนี้ไม่พบขั้น → เตือน และยังใช้ผลที่กองกด', () => {
  const item = { id: 'i', dev_project_id: 'p1' }
  const r = P.resolveItemStatus({ item, progress: null, civilByRef: {}, linkedRefs: new Set(['p1']) })
  assert.equal(r.civilLinkedNoStage, true)
  assert.equal(r.source, 'none')
  const manual = P.resolveItemStatus({ item, progress: { status: 'in_progress' }, civilByRef: {}, linkedRefs: ['p1'] })
  assert.deepEqual([manual.civilLinkedNoStage, manual.source], [true, 'manual'])
  assert.equal(P.resolveItemStatus({ item, progress: null, civilByRef: {}, linkedRefs: new Set(['other']) }).civilLinkedNoStage, false)
  assert.equal(P.resolveItemStatus({ item, progress: null, civilByRef: {} }).civilLinkedNoStage, false, 'ไม่รู้ = ไม่เตือน')
})

test('resolveItemStatus: civilByRef เป็น Map ก็ใช้ได้', () => {
  const r = P.resolveItemStatus({ item: { id: 'i', dev_project_id: 'p1' }, civilByRef: new Map([['p1', { stage: 'construction' }]]) })
  assert.deepEqual([r.status, r.source], ['in_progress', 'civil'])
})

// ── canRecordProgress ─────────────────────────────────────────────────────

test('canRecordProgress: ผู้จัดการได้ทุกกอง · officer/staff เฉพาะกองตัวเอง · ที่เหลือไม่ได้', () => {
  const item = { id: 'i', department_id: 'd1' }
  const manual = { source: 'manual' }
  assert.equal(P.canRecordProgress({ isManager: true, role: 'admin', item, resolved: manual }), true)
  assert.equal(P.canRecordProgress({ isManager: false, role: 'officer', myDepartmentId: 'd1', item, resolved: manual }), true)
  assert.equal(P.canRecordProgress({ isManager: false, role: 'staff', myDepartmentId: 'd1', item, resolved: manual }), true)
  assert.equal(P.canRecordProgress({ isManager: false, role: 'staff', myDepartmentId: 'd2', item, resolved: manual }), false, 'ข้ามกอง')
  assert.equal(P.canRecordProgress({ isManager: false, role: 'technician', myDepartmentId: 'd1', item, resolved: manual }), false)
  assert.equal(P.canRecordProgress({ isManager: false, role: 'viewer', myDepartmentId: 'd1', item, resolved: manual }), false)
  assert.equal(P.canRecordProgress({ isManager: false, role: 'officer', myDepartmentId: null, item, resolved: manual }), false)
  assert.equal(P.canRecordProgress({ isManager: false, role: 'officer', myDepartmentId: 'd1', item: { id: 'i', department_id: null }, resolved: manual }), false, 'รายการไม่มีกอง กองใดก็ไม่ใช่เจ้าของ')
  assert.equal(P.canRecordProgress({ isManager: true, item: null }), false)
})

test('canRecordProgress: ผลมาจากงานก่อสร้าง → กดเองไม่ได้ แม้เป็นผู้จัดการ', () => {
  const item = { id: 'i', department_id: 'd1' }
  assert.equal(P.canRecordProgress({ isManager: true, role: 'admin', item, resolved: { source: 'civil' } }), false)
  assert.equal(P.canRecordProgress({ isManager: false, role: 'officer', myDepartmentId: 'd1', item, resolved: { source: 'civil' } }), false)
  assert.equal(P.canRecordProgress({ isManager: true, role: 'admin', item, resolved: { source: 'none' } }), true)
})

// ── quarterOfDate ─────────────────────────────────────────────────────────

test('quarterOfDate: ขอบ ต.ค./ธ.ค./ม.ค./ก.ย. และไตรมาส 2–3', () => {
  assert.equal(P.quarterOfDate('2026-10-01', 2570), 1)
  assert.equal(P.quarterOfDate('2026-12-31', 2570), 1)
  assert.equal(P.quarterOfDate('2027-01-01', 2570), 2)
  assert.equal(P.quarterOfDate('2027-03-31', 2570), 2)
  assert.equal(P.quarterOfDate('2027-04-01', 2570), 3)
  assert.equal(P.quarterOfDate('2027-06-30', 2570), 3)
  assert.equal(P.quarterOfDate('2027-07-01', 2570), 4)
  assert.equal(P.quarterOfDate('2027-09-30', 2570), 4)
})

test('quarterOfDate: นอกปีงบ/รูปแบบผิด → null (ไม่ยัดเข้าไตรมาสใกล้เคียง)', () => {
  assert.equal(P.quarterOfDate('2026-09-30', 2570), null, 'วันสุดท้ายของปีงบก่อนหน้า')
  assert.equal(P.quarterOfDate('2027-10-01', 2570), null, 'วันแรกของปีงบถัดไป')
  assert.equal(P.quarterOfDate('x', 2570), null)
  assert.equal(P.quarterOfDate(null, 2570), null)
  assert.equal(P.quarterOfDate('2027-01-01', 'abc'), null)
  assert.equal(P.quarterOfDate('2027-01-01T10:00:00Z', 2570), 2, 'ตัดส่วนเวลาทิ้ง')
})

// ── validateProgressForm ──────────────────────────────────────────────────

test('validateProgressForm: ตรงกับ CHECK/trigger — done ต้องมีวัน · not_done ต้องมีเหตุผล · วันไม่เกินวันนี้/ไม่ก่อนปีงบ/ไม่ก่อนวันเริ่ม', () => {
  const ctx = { fiscalYear: 2570, today: '2027-03-15' }
  const f = over => ({ status: 'in_progress', started_on: '', done_on: '', reason: '', note: '', ...over })
  assert.equal(P.validateProgressForm(f({ status: 'none' }), ctx), '')
  assert.equal(P.validateProgressForm(f({}), ctx), '')
  assert.match(P.validateProgressForm(f({ status: 'done' }), ctx), /วันที่แล้วเสร็จ/)
  assert.equal(P.validateProgressForm(f({ status: 'done', done_on: '2027-03-15' }), ctx), '')
  assert.match(P.validateProgressForm(f({ status: 'done', done_on: '2027-03-16' }), ctx), /ไม่เกินวันนี้/)
  assert.match(P.validateProgressForm(f({ status: 'done', done_on: '2026-09-30' }), ctx), /ก่อนเริ่มปีงบประมาณ 2570/)
  assert.equal(P.validateProgressForm(f({ status: 'done', done_on: '2026-10-01' }), ctx), '', 'วันแรกของปีงบผ่าน')
  assert.match(P.validateProgressForm(f({ status: 'done', started_on: '2027-02-01', done_on: '2027-01-15' }), ctx), /ไม่ก่อนวันเริ่ม/)
  assert.match(P.validateProgressForm(f({ started_on: '2027-04-01' }), ctx), /วันเริ่ม/)
  assert.match(P.validateProgressForm(f({ status: 'not_done' }), ctx), /เหตุผล/)
  assert.match(P.validateProgressForm(f({ status: 'not_done', reason: '   ' }), ctx), /เหตุผล/)
  assert.equal(P.validateProgressForm(f({ status: 'not_done', reason: 'ไม่ได้รับจัดสรรงบ' }), ctx), '')
})

// ── buildProgressRows / summarize ─────────────────────────────────────────

const projects = [
  { id: 'p1', strategy: 'ยุทธศาสตร์ที่ 1 โครงสร้างพื้นฐาน' },
  { id: 'p2', strategy: ' ยุทธศาสตร์ที่ 2 สังคม ' },
  { id: 'p3', strategy: '   ' },
]
const items = [
  { id: 'a', department_id: 'd-eng', dev_project_id: 'p1', amount: '100000.50' },   // ก่อสร้างปิดแล้ว → done
  { id: 'b', department_id: 'd-eng', dev_project_id: 'p1', amount: 50000 },        // manual in_progress
  { id: 'c', department_id: 'd-edu', dev_project_id: 'p2', amount: 20000 },        // manual not_done
  { id: 'd', department_id: null, dev_project_id: 'p3', amount: null },            // ยุทธศาสตร์ว่าง + ไม่มีกอง
  { id: 'e', department_id: 'd-gone', dev_project_id: null, amount: 1000 },        // ไม่ผูกทะเบียน กองที่ไม่อยู่ในรายชื่อ
]
const departments = [{ id: 'd-eng', name: 'กองช่าง' }, { id: 'd-edu', name: 'กองการศึกษา' }]

test('buildProgressRows + summarize: ตามยุทธศาสตร์ — ตัวเลข % งบ และกลุ่ม "ไม่ระบุ" ไว้ท้าย', () => {
  const rows = P.buildProgressRows({
    items, projects,
    progressByLineage: { b: { status: 'in_progress' }, c: { status: 'not_done', reason: 'ไม่มีงบ' } },
    civilByRef: { p1: { stage: 'closed', stage_changed_at: '2026-08-01T00:00:00Z' } },
    linkedRefs: new Set(['p1']),
  })
  // p1 ผูกก่อสร้างทั้ง a และ b → ทั้งสองรายการได้ขั้น closed (done) ตามขั้นของทะเบียน
  assert.deepEqual(rows.map(r => r.resolved.status), ['done', 'done', 'not_done', 'none', 'none'])
  assert.equal(rows[0].strategy, 'ยุทธศาสตร์ที่ 1 โครงสร้างพื้นฐาน')
  assert.equal(rows[1].strategy, 'ยุทธศาสตร์ที่ 1 โครงสร้างพื้นฐาน')
  assert.equal(rows[2].strategy, 'ยุทธศาสตร์ที่ 2 สังคม', 'trim แล้ว')
  assert.equal(rows[3].strategy, null, 'ว่าง = ไม่ระบุ')
  assert.equal(rows[4].strategy, null, 'ไม่ผูกทะเบียน = ไม่ระบุ')

  const s = P.summarize(rows, { groupBy: 'strategy' })
  assert.deepEqual(s.groups.map(g => g.label), ['ยุทธศาสตร์ที่ 1 โครงสร้างพื้นฐาน', 'ยุทธศาสตร์ที่ 2 สังคม', 'ไม่ระบุ'])
  const g1 = s.groups[0]
  assert.deepEqual([g1.total, g1.done, g1.in_progress, g1.none, g1.not_done, g1.donePct], [2, 2, 0, 0, 0, 100])
  assert.equal(g1.amount, 150000.5)
  const gNone = s.groups[2]
  assert.deepEqual([gNone.total, gNone.none, gNone.amount, gNone.donePct], [2, 2, 1000, 0])
  assert.deepEqual([s.totals.total, s.totals.done, s.totals.not_done, s.totals.none, s.totals.amount, s.totals.donePct], [5, 2, 1, 2, 171000.5, 40])
  assert.equal(s.totals.label, 'รวม')
})

test('summarize: ตามกอง — เรียงตามทะเบียนกอง · ไม่มีกอง/กองไม่พบชื่อ → ไม่ระบุ · ผลรวมตรงกับตามยุทธศาสตร์', () => {
  const rows = P.buildProgressRows({ items, projects, progressByLineage: { b: { status: 'in_progress' }, c: { status: 'not_done', reason: 'x' } }, civilByRef: {}, linkedRefs: null })
  const s = P.summarize(rows, { groupBy: 'department', departments })
  assert.deepEqual(s.groups.map(g => g.label), ['กองช่าง', 'กองการศึกษา', 'ไม่ระบุ'])
  assert.deepEqual(s.groups.map(g => g.total), [2, 1, 2], 'รายการ d (ไม่มีกอง) + e (กองไม่อยู่ในรายชื่อ) รวมเป็นไม่ระบุ')
  assert.equal(s.groups[0].in_progress, 1)
  assert.equal(s.groups[1].not_done, 1)
  assert.equal(s.totals.total, P.summarize(rows, { groupBy: 'strategy' }).totals.total)
})

test('summarize: ไม่มีแถว → กลุ่มว่าง รวมเป็น 0 ไม่หารศูนย์', () => {
  const s = P.summarize([], { groupBy: 'strategy' })
  assert.deepEqual(s.groups, [])
  assert.deepEqual([s.totals.total, s.totals.donePct, s.totals.amount], [0, 0, 0])
  assert.equal(P.summarize(null).totals.total, 0)
})

test('summarize: ยอดเงินคิดเป็นสตางค์ ไม่เพี้ยนทศนิยมลอย', () => {
  const rows = [0.1, 0.2, 0.3].map((amount, i) => ({ resolved: { status: 'none' }, strategy: 'ก', departmentId: null, amount, item: { id: i } }))
  assert.equal(P.summarize(rows).totals.amount, 0.6)
})

// ── suggestRegistryMatches ────────────────────────────────────────────────

const registry = [
  { id: 'r1', official_name: 'โครงการก่อสร้างถนน คสล. สายบ้านนาเหนือ หมู่ 3', status: 'active' },
  { id: 'r2', official_name: 'ก่อสร้างถนนคอนกรีตเสริมเหล็ก สายบ้านนาใต้ หมู่ 5', status: 'active' },
  { id: 'r3', official_name: 'โครงการอบรมอาชีพผู้สูงอายุ', status: 'active' },
  { id: 'r4', official_name: 'ก่อสร้างถนน คสล. สายบ้านนาเหนือ หมู่ 3', status: 'dropped' },
]

test('normalizeProjectName: เลขไทย→อารบิก · ตัดช่องว่าง/เครื่องหมาย/คำนำ "โครงการ"', () => {
  assert.equal(P.normalizeProjectName('โครงการ ก่อสร้างถนน หมู่ ๓'), P.normalizeProjectName('ก่อสร้างถนนหมู่3'))
  assert.equal(P.normalizeProjectName('  โครงการ(ทดสอบ)  '), 'ทดสอบ')
  assert.equal(P.normalizeProjectName(null), '')
})

test('suggestRegistryMatches: ชื่อเหมือนต่างเลขไทย/ช่องว่าง/คำนำ → ได้คะแนนสูงสุด · ตัดโครงการที่ตัดออกจากแผน', () => {
  const civil = { title: 'ก่อสร้างถนน คสล.สายบ้านนาเหนือ หมู่ ๓', fiscal_year: '2570' }
  const out = P.suggestRegistryMatches(civil, registry, [])
  assert.equal(out[0].project.id, 'r1')
  assert.ok(out[0].score >= 0.9, `คะแนน ${out[0].score}`)
  assert.equal(out.some(x => x.project.id === 'r4'), false, 'dropped ต้องไม่ถูกเสนอ')
  assert.equal(out.some(x => x.project.id === 'r3'), false, 'ชื่อไม่เกี่ยวต้องต่ำกว่าเกณฑ์')
  assert.deepEqual(out.map(x => x.score), [...out.map(x => x.score)].sort((a, b) => b - a))
})

test('suggestRegistryMatches: โบนัสเมื่อมีวงเงินปีงบเดียวกัน (เรียงลำดับที่ใกล้กันได้) · cap 1', () => {
  const civil = { title: 'ก่อสร้างถนน สายบ้านนาใต้ หมู่ 5', fiscal_year: '๒๕๗๐' }   // ปีเป็นเลขไทยก็อ่านได้
  const base = P.suggestRegistryMatches(civil, registry, [])
  const withYear = P.suggestRegistryMatches(civil, registry, [{ project_id: 'r2', fiscal_year: 2570, amount: 1 }])
  const r2base = base.find(x => x.project.id === 'r2').score
  const r2year = withYear.find(x => x.project.id === 'r2').score
  assert.ok(r2year > r2base, 'ต้องมีโบนัส')
  assert.ok(r2year - r2base <= 0.1 + 1e-9)
  const other = P.suggestRegistryMatches(civil, registry, [{ project_id: 'r2', fiscal_year: 2569, amount: 1 }])
  assert.equal(other.find(x => x.project.id === 'r2').score, r2base, 'ปีงบอื่นไม่ได้โบนัส')
  const exact = P.suggestRegistryMatches({ title: registry[0].official_name, fiscal_year: 2570 }, registry, [{ project_id: 'r1', fiscal_year: 2570 }])
  assert.equal(exact[0].score, 1)
})

test('suggestRegistryMatches: limit 5 · minScore · ชื่อว่าง = ไม่มีข้อเสนอ', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, official_name: `ก่อสร้างถนน คสล. สายบ้านนาเหนือ หมู่ ${i}`, status: 'active' }))
  assert.equal(P.suggestRegistryMatches({ title: 'ก่อสร้างถนน คสล. สายบ้านนาเหนือ หมู่ 3' }, many, []).length, 5)
  assert.equal(P.suggestRegistryMatches({ title: 'ก่อสร้างถนน คสล. สายบ้านนาเหนือ หมู่ 3' }, many, [], { limit: 2 }).length, 2)
  assert.equal(P.suggestRegistryMatches({ title: 'ก่อสร้างถนน' }, many, [], { minScore: 0.99 }).length, 0)
  assert.deepEqual(P.suggestRegistryMatches({ title: '   ' }, registry, []), [])
  assert.deepEqual(P.suggestRegistryMatches(null, registry, []), [])
  assert.deepEqual(P.suggestRegistryMatches({ title: 'x' }, null, null), [])
})

test('diceSimilarity: เท่ากัน = 1 · ไม่มีส่วนร่วม = 0 · สั้นเกินไป = 0', () => {
  assert.equal(P.diceSimilarity('abcd', 'abcd'), 1)
  assert.equal(P.diceSimilarity('abcd', 'wxyz'), 0)
  assert.equal(P.diceSimilarity('a', 'b'), 0)
  assert.equal(P.diceSimilarity('', 'ab'), 0)
  assert.ok(P.diceSimilarity('night', 'nacht') > 0)
})

// ── evaluationDeadlines ───────────────────────────────────────────────────

test('evaluationDeadlines: นับ 15 วันนับแต่วันเสนอ · สถานะทุกแบบ', () => {
  const ev = over => ({ presented_on: '2026-12-01', announced_on: null, ...over })
  assert.equal(P.evaluationDeadlines({}, '2026-12-05').state, 'no_presented')
  assert.equal(P.evaluationDeadlines(null, '2026-12-05').state, 'no_presented')
  const open = P.evaluationDeadlines(ev(), '2026-12-05')
  assert.deepEqual([open.state, open.dueOn, open.daysLeft], ['open', '2026-12-16', 11])
  assert.equal(P.evaluationDeadlines(ev(), '2026-12-11').state, 'soon')
  assert.equal(P.evaluationDeadlines(ev(), '2026-12-10').state, 'open', 'เหลือ 6 วัน ยังไม่ถึง soon')
  assert.equal(P.evaluationDeadlines(ev(), '2026-12-16').state, 'due_today')
  const late = P.evaluationDeadlines(ev(), '2026-12-20')
  assert.deepEqual([late.state, late.daysLeft], ['overdue', -4])
  assert.equal(P.evaluationDeadlines(ev({ announced_on: '2026-12-16' }), '2026-12-30').state, 'announced_on_time')
  assert.equal(P.evaluationDeadlines(ev({ announced_on: '2026-12-17' }), '2026-12-30').state, 'announced_late')
  assert.equal(P.evaluationDeadlines(ev({ presented_on: '2026-12-25' }), '2026-12-30').dueOn, '2027-01-09', 'ข้ามปีปฏิทิน')
})

test('evaluationWarningText: เตือนเฉพาะ soon/due_today/overdue/announced_late · สถานะปกติ = null', () => {
  const ev = over => P.evaluationDeadlines({ presented_on: '2026-12-01', announced_on: null, ...over }, over?.today ?? '2026-12-05')
  assert.equal(P.evaluationWarningText(ev()), null)
  assert.equal(P.evaluationWarningText(P.evaluationDeadlines({}, '2026-12-05')), null)
  assert.match(P.evaluationWarningText(P.evaluationDeadlines({ presented_on: '2026-12-01' }, '2026-12-12')), /เหลือ 4 วัน/)
  assert.match(P.evaluationWarningText(P.evaluationDeadlines({ presented_on: '2026-12-01' }, '2026-12-16')), /วันนี้ครบกำหนด/)
  assert.match(P.evaluationWarningText(P.evaluationDeadlines({ presented_on: '2026-12-01' }, '2026-12-20')), /เกินกำหนด.*4 วัน/)
  assert.match(P.evaluationWarningText(P.evaluationDeadlines({ presented_on: '2026-12-01', announced_on: '2026-12-18' }, '2026-12-30')), /หลังวันครบกำหนด/)
  assert.equal(P.evaluationWarningText(P.evaluationDeadlines({ presented_on: '2026-12-01', announced_on: '2026-12-10' }, '2026-12-30')), null)
})

test('PDPA_FREE_TEXT_WARNING: ข้อความตามที่กำหนด', () => {
  assert.equal(P.PDPA_FREE_TEXT_WARNING, 'ห้ามใส่ชื่อ-สกุล เลขบัตรประชาชน เบอร์โทร ของประชาชนในเหตุผล/หมายเหตุ')
})

console.log(`\nlocal-plan-progress: ${cases} cases passed`)
