// String-level checks for src/lib/staffPerformancePrint.js — no browser, no database.
// Layout (page fit, sign block geometry) is measured separately in staff-performance-layout.test.mjs.
import assert from 'node:assert/strict'

process.env.TZ = 'America/Los_Angeles'
const { buildStaffPerformanceHtml, pickCertifier } = await import('../src/lib/staffPerformancePrint.js')
const { normalizePerformanceRows, summarizePerformance, DIMENSION_LABELS } = await import('../src/lib/staffPerformance.js')
const { setHolidayRows } = await import('../src/lib/workingDays.js')
setHolidayRows([])

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const row = (n, fields = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  ref_no: `ES-69-${String(n).padStart(4, '0')}`,
  category: 'light', issue_type: 'ไฟดับทั้งดวง', village: 'หมู่ 1', channel: 'citizen_online',
  status: 'closed', is_confidential: false, created_at: '2026-05-01T02:00:00Z', received_at: null,
  first_done_at: null, closed_at: null, finish_recorded: true, due_date: null, resolved_by_name: null,
  rating: null, reopen_count: 0,
  // RPC จริงไม่คืนคอลัมน์เหล่านี้ ใส่ไว้เพื่อพิสูจน์ว่าใบพิมพ์ไม่หยิบฟิลด์ที่ไม่รู้จักไปแสดง
  detail: '[TEST] secret detail', phone: '[TEST] secret phone', reporter_name: '[TEST] secret reporter',
  ...fields,
})

const ROWS = [
  row(1, { created_at: '2026-09-01T02:00:00Z', closed_at: '2026-09-03T03:00:00Z', due_date: '2026-09-05', rating: 4 }),
  row(2, { finish_recorded: false, created_at: '2026-06-01T02:00:00Z', closed_at: '2026-06-10T08:00:00Z', first_done_at: '2026-06-08T03:00:00Z', due_date: '2026-06-09' }),
  row(3, { created_at: '2026-05-05T02:00:00Z', closed_at: '2026-05-15T03:00:00Z', due_date: '2026-05-10', village: '<img src=x onerror=alert(1)>' }),
  row(4, { status: 'received', finish_recorded: false, created_at: '2026-03-30T02:00:00Z', due_date: '2026-04-02' }),
  row(5, { category: 'road', created_at: '2026-08-17T02:00:00Z', closed_at: '2026-08-20T03:00:00Z', resolved_by_name: 'นาย ก & <ข>' }),
  row(6, { finish_recorded: false }),
  row(7, { is_confidential: true, category: 'corruption', ref_no: null, village: null, issue_type: null, closed_at: '2026-08-01T03:00:00Z' }),
  row(8, { status: 'rejected', finish_recorded: false, created_at: '2026-05-05T02:00:00Z' }),
]
const LABELS = { light: 'ไฟฟ้าสาธารณะ', road: 'ถนน & ทางเท้า' }
const TENANT = { name: 'องค์การบริหารส่วนตำบลทดสอบ' }
const PERSON = { name: 'นายช่าง ทดสอบ', title: 'ผู้ช่วยช่างไฟฟ้า', departmentName: 'กองช่าง' }
const summary = summarizePerformance(normalizePerformanceRows(ROWS), { from: '2026-04-01', to: '2026-09-30', today: '2026-09-27' })
const html = buildStaffPerformanceHtml({
  tenant: TENANT, person: PERSON, periodLabel: 'รอบการประเมินที่ 2 ปีงบประมาณ พ.ศ. 2569', summary,
  categoryLabels: LABELS, certifier: { name: 'นายหัวหน้า กองช่าง', title: 'ผู้อำนวยการกองช่าง' },
  scopeNote: 'นับเฉพาะคำร้องของ <กองช่าง>', printedAt: new Date('2026-09-27T07:05:00Z'),
})

test('certifier is the department head, or the clerk when the person is the head or no head is set', () => {
  const registry = [
    { signatory_role: 'department_head', department_id: 'dept-works', profile_id: 'p-head', custom_label: null,
      manual_name: null, title_override: null, effective_from: null, effective_to: null,
      profile: { full_name: 'นายหัวหน้า กองช่าง', job_title: 'ผู้อำนวยการกองช่าง' } },
    { signatory_role: 'department_head', department_id: 'dept-old', profile_id: 'p-old', custom_label: null,
      manual_name: 'นายหมดวาระ', title_override: null, effective_from: null, effective_to: '2020-01-01' },
    { signatory_role: 'clerk', department_id: null, profile_id: null, custom_label: null,
      manual_name: 'นายปลัด ทดสอบ', title_override: 'ปลัดองค์การบริหารส่วนตำบล', effective_from: null, effective_to: null },
  ]
  assert.deepEqual(pickCertifier(registry, { departmentId: 'dept-works', personId: 'p-staff' }),
    { name: 'นายหัวหน้า กองช่าง', title: 'ผู้อำนวยการกองช่าง' })
  assert.equal(pickCertifier(registry, { departmentId: 'dept-works', personId: 'p-head' }).name, 'นายปลัด ทดสอบ')
  assert.equal(pickCertifier(registry, { departmentId: 'dept-other', personId: 'p-staff' }).name, 'นายปลัด ทดสอบ')
  assert.equal(pickCertifier(registry, { departmentId: 'dept-old', personId: 'p-staff' }).name, 'นายปลัด ทดสอบ')
  assert.equal(pickCertifier([], { departmentId: 'dept-works' }), null)
})

test('header shows who, which period and the evaluation note', () => {
  assert.ok(html.includes('รายงานผลการปฏิบัติงานตามคำร้อง องค์การบริหารส่วนตำบลทดสอบ'))
  assert.ok(html.includes('ชื่อ-สกุล นายช่าง ทดสอบ   ตำแหน่ง ผู้ช่วยช่างไฟฟ้า   สังกัด กองช่าง'))
  assert.ok(html.includes('รอบการประเมินที่ 2 ปีงบประมาณ พ.ศ. 2569'))
  assert.ok(html.includes('ผู้ประเมินเทียบกับค่าเป้าหมายตามข้อตกลงและให้คะแนนเอง'))
  assert.ok(html.includes('ส่วนที่ 1 ผลสัมฤทธิ์ของงาน'))
  for (const label of Object.values(DIMENSION_LABELS)) assert.ok(html.includes(label), label)
})

test('summary cells show counts with their base and percentage', () => {
  assert.ok(html.includes('<td class="num">2/4 (50%)</td>'), 'ทันกำหนดของหมวดไฟฟ้า')
  assert.ok(html.includes('<td class="num">3/3 (100%)</td>'), 'ไม่ถูกเปิดเรื่องกลับ')
  assert.ok(html.includes('<td class="num">4 (1)</td>'), 'คะแนนผู้ร้อง (จำนวนเรื่อง)')
  assert.ok(html.includes('<td>รวมทุกหมวด</td>'), 'มี 2 หมวดต้องมีแถวรวม')
})

test('every citizen-typed or admin-typed value is escaped', () => {
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(html.includes('ถนน &amp; ทางเท้า'))
  assert.ok(html.includes('ปิดงานแทนโดย นาย ก &amp; &lt;ข&gt;'))
  assert.ok(html.includes('นับเฉพาะคำร้องของ &lt;กองช่าง&gt;'))
})

test('no complainant personal data reaches the paper', () => {
  assert.ok(!html.includes('secret'))
  assert.ok(!html.includes('corruption'))
})

test('legacy dates, undated, confidential and rejected complaints are explained', () => {
  assert.ok(html.includes('8 มิ.ย. 2569 †'))
  assert.ok(html.includes('† 1 เรื่อง ใช้วันที่จากประวัติการดำเนินงาน'))
  assert.ok(html.includes('ไม่ทราบวันแล้วเสร็จ 1 เรื่อง แสดงในรายการแนบ ไม่นับในตาราง'))
  assert.ok(html.includes('คำร้องที่แล้วเสร็จแต่ไม่ทราบวันแล้วเสร็จ 1 เรื่อง'))
  assert.ok(html.includes('เรื่องที่ต้องปกปิดตามหมวด 1 เรื่อง'))
  assert.ok(html.includes('ไม่รับเรื่อง 1 เรื่อง'))
})

test('attachment lists: finished, still open at the end, and past due marks', () => {
  assert.ok(html.includes('1. คำร้องที่แล้วเสร็จในช่วงนี้ 4 เรื่อง'))
  assert.ok(html.includes('2. คำร้องที่ค้าง ณ สิ้นช่วง 1 เรื่อง'))
  assert.ok(html.includes('2 เม.ย. 2569 (เลยกำหนด)'))
  assert.ok(html.includes('ข้อมูล ณ 27 ก.ย. 2569'))
  assert.ok(html.includes('ผ่านระบบ E-Service องค์การบริหารส่วนตำบลทดสอบ'))
})

test('sign block: reporter with name, certifier blank lines when unknown', () => {
  assert.ok(html.includes('(นายช่าง ทดสอบ)'))
  assert.ok(html.includes('(นายหัวหน้า กองช่าง)'))
  const blank = buildStaffPerformanceHtml({ tenant: TENANT, person: PERSON, periodLabel: 'x', summary, certifier: null })
  assert.match(blank, /\(\.{20,}\)/)
  assert.ok(blank.includes('ตำแหน่ง ....................'))
})

test('a person with no work prints one page without attachments or total row', () => {
  const empty = summarizePerformance([], { from: '2026-04-01', to: '2026-09-30', today: '2026-09-27' })
  const out = buildStaffPerformanceHtml({ tenant: TENANT, person: PERSON, periodLabel: 'x', summary: empty })
  assert.equal(out.match(/class="sheet landscape"/g).length, 1)
  assert.ok(out.includes('ไม่มีคำร้องในช่วงนี้'))
  assert.ok(!out.includes('รวมทุกหมวด'))
})

test('missing holiday years are warned on the paper', () => {
  const next = summarizePerformance(normalizePerformanceRows(ROWS), { from: '2026-10-01', to: '2027-03-31', today: '2026-10-05' })
  const out = buildStaffPerformanceHtml({ tenant: TENANT, person: PERSON, periodLabel: 'x', summary: next })
  assert.ok(out.includes('ยังไม่มีวันหยุดราชการของปี พ.ศ. 2570 ในระบบ'))
})

console.log(`All ${cases} staff performance print checks passed`)
