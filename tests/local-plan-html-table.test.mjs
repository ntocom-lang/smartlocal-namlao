// ตัวคลี่ตาราง HTML ที่มี merge (colspan/rowspan) ของการนำเข้าแผนการดำเนินงาน (src/lib/htmlTableGrid.js)
// node ล้วน ไม่ใช้ DOM — ส่วน readHtmlTables ที่ต้องใช้ DOMParser ทดสอบในเบราว์เซอร์จริงที่ tests/local-plan-print.test.mjs
// ข้อมูลทั้งหมดเป็นข้อมูลสมมติ  node tests/local-plan-html-table.test.mjs
import assert from 'node:assert/strict'

const G = await import('../src/lib/htmlTableGrid.js')
const T = await import('../src/lib/tabularImport.js')
const I = await import('../src/lib/localPlanImport.js')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const c = (text, colspan, rowspan) => ({ text, ...(colspan === undefined ? {} : { colspan }), ...(rowspan === undefined ? {} : { rowspan }) })

test('colspan: คัดข้อความลงทุกช่องที่รวมแนวนอน', () => {
  const out = G.expandSpans([[c('A', 2), c('B')], [c('1'), c('2'), c('3')]])
  assert.deepEqual(out.rows, [['A', 'A', 'B'], ['1', '2', '3']])
  assert.deepEqual(out.merged, { rowspan: false, colspan: true })
  assert.equal(out.truncated, false)
})

test('rowspan: คัดข้อความลงทุกแถวที่รวมแนวตั้ง และแถวถัดไปข้ามช่องที่ถูกจอง', () => {
  const out = G.expandSpans([[c('A', 1, 2), c('B')], [c('C')]])
  assert.deepEqual(out.rows, [['A', 'B'], ['A', 'C']])
  assert.deepEqual(out.merged, { rowspan: true, colspan: false })
})

test('colspan + rowspan พร้อมกันในเซลล์เดียว', () => {
  const out = G.expandSpans([[c('X', 2, 2), c('Y')], [c('Z')]])
  assert.deepEqual(out.rows, [['X', 'X', 'Y'], ['X', 'X', 'Z']])
  assert.deepEqual(out.merged, { rowspan: true, colspan: true })
})

test('rowspan ซ้อนกับ colspan ของอีกช่อง (หัวตารางแบบไตรมาส)', () => {
  const out = G.expandSpans([[c('H', 1, 2), c('Q', 3)], [c('a'), c('b'), c('c')]])
  assert.deepEqual(out.rows, [['H', 'Q', 'Q', 'Q'], ['H', 'a', 'b', 'c']])
})

test('ช่องที่ถูกจองอยู่ท้ายแถวถูกเติมแม้แถวนั้นไม่มีเซลล์ครบ', () => {
  assert.deepEqual(G.expandSpans([[c('A', 1, 2), c('B', 1, 2)], []]).rows, [['A', 'B'], ['A', 'B']])
  assert.deepEqual(G.expandSpans([[c('A', 1, 2), c('B', 1, 2)], [c('C')]]).rows, [['A', 'B', ''], ['A', 'B', 'C']])
})

test('แถวยาวไม่เท่ากันถูกเติม "" ให้กว้างเท่ากัน · ข้อความยังไม่ normalize', () => {
  const out = G.expandSpans([[c('a'), c('b'), c('c')], [c(' x y ')], []])
  assert.deepEqual(out.rows, [['a', 'b', 'c'], [' x y ', '', ''], ['', '', '']])
})

test('ไม่มีตาราง/แถวว่าง → กริดว่าง ไม่ throw', () => {
  for (const input of [[], null, undefined]) {
    const out = G.expandSpans(input)
    assert.deepEqual(out, { rows: [], merged: { rowspan: false, colspan: false }, truncated: false, clippedColumns: false })
  }
})

test('span ผิดรูป (0, -1, "abc", ว่าง, ทศนิยม) = 1 ; ค่าใหญ่ถูกจำกัด', () => {
  const out = G.expandSpans([[c('a', 0, 0), c('b', -1, -1), c('c', 'abc', 'abc'), c('d', '', ''), c('e', '2px', '1.9')]])
  // 'e' colspan "2px" → 2 (อ่านเลขนำหน้าเหมือนเบราว์เซอร์) · rowspan "1.9" → 1
  assert.deepEqual(out.rows, [['a', 'b', 'c', 'd', 'e', 'e']])
  assert.deepEqual(out.merged, { rowspan: false, colspan: true })

  const huge = G.expandSpans([[c('H', 99999, 99999)], [c('x')], [c('y')]])
  assert.equal(huge.rows.length, 3, 'rowspan ไม่เกินแถวที่เหลือ (ไม่ทำให้เกิดแถวใหม่)')
  const width = huge.rows[0].length
  assert.ok(huge.rows.every(r => r.length === width && width <= G.MAX_COLUMNS), 'ทุกแถวกว้างเท่ากันและไม่เกิน MAX_COLUMNS')
  assert.ok(huge.rows.every(r => r.slice(0, G.MAX_COLSPAN).every(v => v === 'H')), `colspan จำกัดที่ ${G.MAX_COLSPAN} ช่อง และ rowspan คลุมครบ 3 แถว`)
  assert.equal(huge.rows[0][G.MAX_COLSPAN], '', 'colspan 99999 ไม่ลามเกิน MAX_COLSPAN')
  assert.deepEqual([huge.rows[1][G.MAX_COLSPAN], huge.rows[2][G.MAX_COLSPAN]], ['x', 'y'], 'เซลล์ถัดไปวางหลังช่องที่ถูกจองตามอัลกอริทึม HTML')
})

test('ความกว้างรวมไม่เกิน MAX_COLUMNS และบอก clippedColumns', () => {
  const out = G.expandSpans([[c('a', 100), c('b', 100), c('c', 100)]])
  assert.equal(out.rows[0].length, G.MAX_COLUMNS)
  assert.equal(out.rows[0][199], 'b')
  assert.equal(out.clippedColumns, true)
  assert.equal(G.expandSpans([[c('a', 100), c('b', 100)]]).clippedColumns, false, 'พอดี 200 ไม่ถือว่าตัด')
})

test('เกิน MAX_ROWS ตัดทิ้งและ truncated = true · rowspan ที่ปลายไม่ทำให้เกิดแถวเกิน', () => {
  const many = Array.from({ length: T.MAX_ROWS + 5 }, (_, i) => [c(`r${i}`)])
  const out = G.expandSpans(many)
  assert.equal(out.rows.length, T.MAX_ROWS)
  assert.equal(out.truncated, true)
  assert.equal(out.rows[T.MAX_ROWS - 1][0], `r${T.MAX_ROWS - 1}`)

  const edge = Array.from({ length: T.MAX_ROWS }, (_, i) => (i === T.MAX_ROWS - 2 ? [c('S', 1, 99)] : [c(`r${i}`)]))
  const e = G.expandSpans(edge)
  assert.equal(e.rows.length, T.MAX_ROWS)
  assert.equal(e.rows[T.MAX_ROWS - 1][0], 'S', 'rowspan ถูกตัดที่แถวสุดท้ายที่อ่าน')
  assert.equal(e.truncated, false, 'พอดี MAX_ROWS ไม่ถือว่าตัด')
})

// ── ตารางแผนการดำเนินงานแบบหัว 2 แถว (ไตรมาส + เดือน) ที่ merge จริง แล้วป้อนต่อตัวนำเข้า ──────────────────
const MONTHS = ['ต.ค.67', 'พ.ย.67', 'ธ.ค.67', 'ม.ค.68', 'ก.พ.68', 'มี.ค.68', 'เม.ย.68', 'พ.ค.68', 'มิ.ย.68', 'ก.ค.68', 'ส.ค.68', 'ก.ย.68']
const blanks = n => Array.from({ length: n }, () => c(''))
const planTable = [
  [c('ที่', 1, 2), c('โครงการ/กิจกรรม', 1, 2), c('งบประมาณ (บาท)', 1, 2), c('ไตรมาส 1', 3), c('ไตรมาส 2', 3), c('ไตรมาส 3', 3), c('ไตรมาส 4', 3), c('ผู้รับผิดชอบ', 1, 2)],
  MONTHS.map(m => c(m)),
  // โครงการ 1: ต.ค.–ธ.ค. = ลูกศรเดียว merge 3 เดือน ; กอง merge แนวตั้งคลุมโครงการ 1–2
  [c('1'), c('โครงการซ่อมแซมถนนสายหลัก'), c('1,200,000'), c('↔', 3), ...blanks(9), c('กองช่าง', 1, 2)],
  // โครงการ 2: ม.ค.–ก.พ. merge 2 เดือน (ไม่มีช่องกอง — ถูกจองจากแถวบน)
  [c('2'), c('โครงการวางท่อระบายน้ำ'), c('350,000.50'), ...blanks(3), c('↔', 2), ...blanks(7)],
  // โครงการ 3: ทั้งปี merge ครบ 12 เดือน
  [c('3'), c('โครงการอบรมอาสาสมัคร'), c('50,000'), c('↔', 12), c('สำนักปลัด')],
  [c('รวม'), c(''), c('1,600,000.50'), ...blanks(13)],
]
const departments = [{ id: 'd-eng', name: 'กองช่าง', code: 'ช' }, { id: 'd-clerk', name: 'สำนักปลัด', code: 'สป' }]

test('หัว ไตรมาส 2 แถว: ตรวจพบหัวและได้ 12 ช่องเดือนครบ', () => {
  const grid = G.expandSpans(planTable)
  assert.equal(grid.rows[0].length, 16)
  assert.deepEqual(grid.rows[0].slice(3, 7), ['ไตรมาส 1', 'ไตรมาส 1', 'ไตรมาส 1', 'ไตรมาส 2'])
  const rows = grid.rows.map(r => r.map(T.normalizeCell))
  const found = I.detectHeaderRows(rows)
  // ตัวคลี่คัดชื่อคอลัมน์ที่ rowspan=2 ลงแถวเดือนด้วย แถวเดือนจึงมีทั้งชื่อคอลัมน์และเดือนครบ → detectHeaderRows เลือกแถวนั้นแถวเดียว
  // (หัว 1 แถวที่เริ่มแถวที่ 2) หรือเลือก 2 แถวก็ได้ ผลเท่ากัน: ข้อมูลเริ่มแถวที่ 3 และได้ชื่อคอลัมน์ + 12 เดือนครบ
  assert.equal(found.headerRowIndex + found.headerRowCount, 2, 'ข้อมูลต้องเริ่มถัดจากแถวเดือน')
  const { mapping, monthColumns } = I.guessMapping(T.mergeHeaderRows(rows, found.headerRowIndex, found.headerRowCount))
  assert.equal(Object.keys(monthColumns).length, 12)
  assert.deepEqual(Object.values(monthColumns).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  assert.equal(mapping[0], 'seq_no')
  assert.equal(mapping[1], 'item_name')
  assert.equal(mapping[2], 'amount')
  assert.equal(mapping[15], 'department')
})

test('เดือนจากเซลล์ลูกศรที่ merge ข้ามเดือน + กองที่ merge แนวตั้งได้ department_id ทุกแถว', () => {
  const grid = G.expandSpans(planTable)
  const rows = grid.rows.map(r => r.map(T.normalizeCell))
  const { headerRowIndex, headerRowCount } = I.detectHeaderRows(rows)
  const { mapping, monthColumns } = I.guessMapping(T.mergeHeaderRows(rows, headerRowIndex, headerRowCount))
  const preview = I.buildImportPreview({ rows, headerRowIndex, headerRowCount, mapping, monthColumns, departments, projects: [], fiscalYearBE: 2568 })
  assert.equal(preview.summary.withErrors, 0, JSON.stringify(preview.items.map(i => i.errors)))
  assert.equal(preview.summary.skippedTotals, 1, 'แถวรวมท้ายตารางไม่ใช่โครงการ')
  const [a, b, d] = preview.items.map(i => i.values)
  assert.deepEqual([a.month_from, a.month_to], [1, 3], 'ต.ค.–ธ.ค.')
  assert.deepEqual([b.month_from, b.month_to], [4, 5], 'ม.ค.–ก.พ.')
  assert.deepEqual([d.month_from, d.month_to], [1, 12], 'ทั้งปี')
  assert.equal(a.department_id, 'd-eng')
  assert.equal(b.department_id, 'd-eng', 'โครงการ 2 ไม่มีช่องกองในตาราง (merge แนวตั้ง) ต้องได้กองจากโครงการ 1')
  assert.equal(d.department_id, 'd-clerk')
  assert.equal(a.amount, 1200000)
  assert.equal(b.amount, 350000.5)
})

test('เทียบกับ text/plain: ถ้าไม่คลี่ merge (ช่องว่าง) กองและเดือนหายจริง — เหตุผลที่ต้องมีตัวคลี่', () => {
  // จำลอง text/plain ของ Excel: เซลล์ merge เหลือค่าที่ช่องบนซ้ายช่องเดียว ที่เหลือว่าง
  const flat = [
    ['ที่', 'โครงการ/กิจกรรม', 'งบประมาณ (บาท)', 'ไตรมาส 1', '', '', 'ไตรมาส 2', '', '', 'ไตรมาส 3', '', '', 'ไตรมาส 4', '', '', 'ผู้รับผิดชอบ'],
    ['', '', '', ...MONTHS, ''],
    ['1', 'โครงการซ่อมแซมถนนสายหลัก', '1,200,000', '↔', '', '', '', '', '', '', '', '', '', '', '', 'กองช่าง'],
    ['2', 'โครงการวางท่อระบายน้ำ', '350,000.50', '', '', '', '↔', '', '', '', '', '', '', '', '', ''],
  ]
  const found = I.detectHeaderRows(flat)
  const { mapping, monthColumns } = I.guessMapping(T.mergeHeaderRows(flat, found.headerRowIndex, found.headerRowCount))
  const preview = I.buildImportPreview({ rows: flat, ...found, mapping, monthColumns, departments, projects: [], fiscalYearBE: 2568 })
  const [a, b] = preview.items.map(i => i.values)
  assert.deepEqual([a.month_from, a.month_to], [1, 1], 'ลูกศร merge 3 เดือน เห็นแค่เดือนเดียว')
  assert.equal(b.department_id, null, 'กองที่ merge แนวตั้งหายในแถวที่ 2')
})

console.log(`\nlocal-plan-html-table: ${cases} cases passed`)
