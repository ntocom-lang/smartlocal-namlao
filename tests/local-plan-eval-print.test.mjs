// ใบรายงานติดตามและประเมินผลแผนการดำเนินงาน (src/lib/localPlanEvalPrint.js) — ตรวจเนื้อหา/escape/มาตรฐาน govDocStyle ด้วย node ล้วน
// ข้อมูลทั้งหมดเป็นข้อมูลสมมติ (ชื่อกอง/โครงการสมมติ ไม่ใช่แผนของ อปท. ใด) — ไม่ล็อกอิน ไม่แตะฐานข้อมูล
//   node tests/local-plan-eval-print.test.mjs   (npm run test:local-plan:print)
import assert from 'node:assert/strict'
import {
  GOV_FONT_SIZE, GOV_FONT_SIZE_ADJUST, GOV_FONT_STACK, GOV_PAGE_MARGIN_LANDSCAPE, govPageCss,
} from '../src/lib/govDocStyle.js'
import { buildEvalPrintHtml, completionText } from '../src/lib/localPlanEvalPrint.js'
import { buildProgressRows } from '../src/lib/localPlanProgress.js'

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const tenant = { name: 'เทศบาลตำบลสาธิต', district: 'อำเภอเมืองสมมติ', province: 'จังหวัดสมมติ' }
const departments = [{ id: 'd-eng', name: 'กองช่าง' }, { id: 'd-edu', name: 'กองการศึกษา' }]
const projects = [
  { id: 'p1', strategy: 'ยุทธศาสตร์ที่ 1 โครงสร้างพื้นฐาน' },
  { id: 'p2', strategy: 'ยุทธศาสตร์ที่ 2 สังคม' },
]
const items = [
  { id: 'a', item_name: 'ก่อสร้างถนน คสล. สายทดสอบ', department_id: 'd-eng', dev_project_id: 'p1', amount: 500000, source: 'local' },
  { id: 'b', item_name: 'อบรมอาชีพ', department_id: 'd-edu', dev_project_id: 'p2', amount: 20000, source: 'local' },
  { id: 'c', item_name: 'โครงการของหน่วยงานอื่น', department_id: null, dev_project_id: null, amount: null, source: 'external', external_agency: 'แขวงทางหลวงสมมติ' },
]
const rowsOf = (over = {}) => buildProgressRows({
  items, projects,
  progressByLineage: { b: { status: 'done', done_on: '2027-01-20', reason: null } },
  civilByRef: { p1: { stage: 'closed', stage_changed_at: '2027-05-10T05:00:00Z' } },
  ...over,
})
const evaluation = {
  disbursed_total: 123456.5, disbursed_as_of: '2027-09-30', disbursed_source: 'ระบบ e-LAAS',
  observations: 'ข้อสังเกตทดสอบ\nบรรทัดสอง', recommendations: 'ข้อเสนอแนะทดสอบ',
}
const build = (over = {}) => buildEvalPrintHtml({ tenant, fiscalYear: 2570, evaluation, rows: rowsOf(), departments, asOf: '2027-10-05', ...over })

// ตัดเฉพาะแท็ก <thead>…</thead> ของตารางรายโครงการ (class="grid proj")
const projectHead = html => {
  const start = html.indexOf('<table class="grid proj">')
  const from = html.indexOf('<thead>', start)
  return html.slice(from, html.indexOf('</thead>', from))
}

test('มาตรฐานใบพิมพ์: ฟอนต์/ขนาด/font-size-adjust/@page มาจาก govDocStyle · แนวนอน A4 · ขอบเป็น padding (hideBrowserHeader)', () => {
  const html = build()
  assert.ok(html.includes(`font-family: ${GOV_FONT_STACK};`), 'ฟอนต์ต้องมาจาก GOV_FONT_STACK')
  assert.ok(html.includes(`font-size: ${GOV_FONT_SIZE};`), 'ขนาดต้องมาจาก GOV_FONT_SIZE (14pt)')
  assert.ok(html.includes(`font-size-adjust: ${GOV_FONT_SIZE_ADJUST};`), 'ต้องมี font-size-adjust')
  assert.ok(html.includes(govPageCss({ size: 'A4 landscape', hideBrowserHeader: true })), '@page ต้องมาจาก govPageCss')
  assert.ok(html.includes('size: A4 landscape'))
  assert.equal(/@page\s*\{[^}]*size:\s*A4\s*portrait/i.test(html), false)
  // ขอบกระดาษแนวนอน (บน ขวา ล่าง ซ้าย) ต้องปรากฏเป็นค่าเดียวกับมาตรฐาน — แยกเป็นรายด้านใน padding/spacer
  const [top, right, bottom, left] = GOV_PAGE_MARGIN_LANDSCAPE.split(/\s+/)
  assert.ok(html.includes(`td.space-top { height: ${top}; }`))
  assert.ok(html.includes(`td.space-bottom { height: ${bottom}; }`))
  assert.ok(html.includes(`padding: 0 ${right} 0 ${left};`))
  assert.ok(html.includes('fonts.googleapis.com'), 'ต้องโหลดฟอนต์สำรอง Sarabun (GOV_FONT_LINK)')
})

test('ไม่เขียน font-family/font-size/@page margin ซ้ำเอง: font-family มีที่เดียว และไม่มี font-size อื่นนอกจากมาตรฐาน', () => {
  const html = build()
  assert.equal((html.match(/font-family:/g) ?? []).length, 1)
  // font-size ที่อนุญาต: 14pt มาตรฐาน · 11pt บรรทัดกำกับที่มา (GOV_ESERVICE_ORIGIN_CSS) · inherit ของหัวเรื่อง
  const sizes = [...html.matchAll(/font-size:\s*([^;]+);/g)].map(m => m[1].trim())
  assert.ok(sizes.every(s => ['14pt', '11pt', 'inherit'].includes(s)), `font-size แปลกปลอม: ${sizes.join(', ')}`)
  assert.equal((html.match(/@page/g) ?? []).length, 1)
})

test('ไม่มีช่องลงนาม', () => {
  const html = build()
  assert.equal(/sign|ลงชื่อ|ลงนาม|\(\s*\.{3,}/.test(html), false)
})

test('ตารางรายโครงการ: ไม่มีคอลัมน์เบิกจ่าย · หัวคอลัมน์ครบ 6 ตามที่กำหนด', () => {
  const head = projectHead(build())
  assert.equal(head.includes('เบิกจ่าย'), false, 'หัวตารางรายโครงการห้ามมีคำว่าเบิกจ่าย')
  assert.deepEqual([...head.matchAll(/<th>([^<]*)<\/th>/g)].map(m => m[1]),
    ['ลำดับ', 'โครงการ/กิจกรรม', 'ผู้รับผิดชอบ', 'งบตามแผน (บาท)', 'ผลดำเนินการ', 'ไตรมาสที่แล้วเสร็จ / เหตุผล'])
})

test('ยอดเบิกจ่ายรวมช่องเดียว: "ณ วันที่ … ที่มา …" · ไม่มียอด = ระบุว่ายังไม่ได้บันทึก (ไม่แต่งตัวเลข)', () => {
  const html = build()
  assert.ok(html.includes('ยอดเบิกจ่ายรวมทั้งปี 123,456.50 บาท ณ วันที่ 30 ก.ย. 2570 ที่มา ระบบ e-LAAS'))
  assert.equal((html.match(/เบิกจ่าย/g) ?? []).length, 1, 'คำว่าเบิกจ่ายต้องอยู่ในย่อหน้ายอดรวมที่เดียว')
  const none = build({ evaluation: null })
  assert.ok(none.includes('ยอดเบิกจ่ายรวมทั้งปี — ยังไม่ได้บันทึก'))
  assert.equal(/\d,\d{3}\.\d{2} บาท ณ/.test(none), false)
})

test('เนื้อหา: หัว อปท. ปีงบ · ตารางสรุปตามยุทธศาสตร์ · รายโครงการ ผลดำเนินการ ไตรมาส เหตุผล · ข้อสังเกต/ข้อเสนอแนะ · ข้อมูล ณ วันที่', () => {
  const html = build()
  assert.ok(html.includes('รายงานติดตามและประเมินผลแผนการดำเนินงาน'))
  assert.ok(html.includes('ประจำปีงบประมาณ พ.ศ. 2570'))
  assert.ok(html.includes('เทศบาลตำบลสาธิต อำเภอเมืองสมมติ จังหวัดสมมติ'), 'คำนำหน้าอำเภอ/จังหวัดซ้ำไม่ได้')
  assert.ok(html.includes('ยุทธศาสตร์ที่ 1 โครงสร้างพื้นฐาน'))
  assert.ok(html.includes('ไม่ระบุ'), 'รายการที่ไม่ผูกทะเบียนอยู่กลุ่มไม่ระบุ')
  assert.ok(html.includes('ก่อสร้างถนน คสล. สายทดสอบ'))
  assert.ok(html.includes('แขวงทางหลวงสมมติ'), 'โครงการหน่วยงานอื่นแสดงชื่อหน่วยงาน')
  assert.ok(html.includes('ข้อสังเกตทดสอบ') && html.includes('ข้อเสนอแนะทดสอบ'))
  assert.ok(html.includes('ข้อมูล ณ วันที่ 5/10/2570'))
  assert.ok(html.includes('ผ่านระบบ E-Service เทศบาลตำบลสาธิต'))
  // ก่อสร้างปิดแล้ว 10 พ.ค. 2570 → ไตรมาส 3 (เม.ย.–มิ.ย.) ติดคำว่าโดยประมาณ · อบรมอาชีพเสร็จ 20 ม.ค. 2570 → ไตรมาส 2
  assert.ok(html.includes('ไตรมาส 3 · 10 พ.ค. 2570 (โดยประมาณ ตามขั้นงานก่อสร้าง)'))
  assert.ok(html.includes('ไตรมาส 2 · 20 ม.ค. 2570'))
})

test('completionText: เสร็จนอกปีงบ → ไม่ยัดไตรมาส · ไม่ได้ทำ = เหตุผล · ยังไม่ทำ/กำลังทำ = ว่าง', () => {
  assert.equal(completionText({ status: 'done', doneOn: '2027-10-02', approxDate: false }, 2570), '2 ต.ค. 2570')
  assert.equal(completionText({ status: 'not_done', reason: '  ไม่มี   งบ ' }, 2570), 'ไม่มี งบ')
  assert.equal(completionText({ status: 'in_progress' }, 2570), '')
  assert.equal(completionText({ status: 'none' }, 2570), '')
  assert.equal(completionText(null, 2570), '')
  assert.equal(completionText({ status: 'done', doneOn: null, approxDate: false }, 2570), 'ไม่ระบุวันที่')
})

test('escape: ชื่อ อปท./โครงการ/กอง/ยุทธศาสตร์/เหตุผล/ข้อสังเกต/ที่มา ที่มี < > " \' & ไม่หลุดเป็น tag', () => {
  const evil = '<script>alert(1)</script> "x" \'y\' & <img src=x onerror=alert(2)>'
  const html = buildEvalPrintHtml({
    tenant: { name: evil, district: '"><b>', province: '</td><i>' },
    fiscalYear: 2570,
    evaluation: { ...evaluation, observations: evil, recommendations: evil, disbursed_source: evil },
    rows: buildProgressRows({
      items: [
        { id: 'x', item_name: evil, department_id: 'd-evil', dev_project_id: 'px', amount: 1, source: 'local' },
        { id: 'y', item_name: 'ปกติ', department_id: null, dev_project_id: null, amount: 1, source: 'external', external_agency: evil },
        { id: 'z', item_name: 'ไม่ทำ', department_id: null, dev_project_id: null, amount: 1, source: 'local' },
      ],
      projects: [{ id: 'px', strategy: evil }],
      progressByLineage: { z: { status: 'not_done', reason: evil } },
      civilByRef: {},
    }),
    departments: [{ id: 'd-evil', name: evil }], asOf: '2027-10-05',
  })
  assert.equal(/<script/i.test(html), false, 'มี <script จากข้อมูลหลุดออกมา')
  assert.equal(/<img/i.test(html), false, 'มี <img จากข้อมูลหลุดออกมา')
  assert.equal(/<b>|<i>/.test(html), false, 'ชื่ออำเภอ/จังหวัดหลุดเป็น tag')
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot; &#039;y&#039; &amp; &lt;img'), 'ต้อง escape ครบทั้ง 5 ตัว')
})

test('ข้อมูลว่าง: ไม่มีรายการ/ไม่มี evaluation ยังสร้างใบได้ ไม่พัง', () => {
  const html = buildEvalPrintHtml({ tenant: null, fiscalYear: null, evaluation: null, rows: [], departments: [], asOf: '' })
  assert.ok(html.includes('— ไม่มีรายการ —'))
  assert.equal((html.match(/<script/g) ?? []).length, 0)
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('ผ่านระบบ E-Service'))
  assert.equal(html.includes('ข้อมูล ณ วันที่'), false)
})

test('ความกว้างคอลัมน์รวม 257 มม. (= พื้นที่พิมพ์แนวนอน) ทั้งสองตาราง', () => {
  const html = build()
  const sum = prefix => [...html.matchAll(new RegExp(`col\\.${prefix}-[a-z]+ \\{ width: ([\\d.]+)mm; \\}`, 'g'))].reduce((n, m) => n + Number(m[1]), 0)
  // ตารางสรุป: s-name + s-n ×5 + s-amt + s-pct (s-n กำหนดความกว้างครั้งเดียวแต่ใช้ 5 คอลัมน์)
  const width = name => Number(html.match(new RegExp(String.raw`col\.${name} \{ width: ([\d.]+)mm; \}`))[1])
  assert.equal(width('s-name') + width('s-n') * 5 + width('s-amt') + width('s-pct'), 257, 'ตารางสรุป')
  assert.equal(sum('p'), 257, 'ตารางรายโครงการ')
  assert.equal(html.match(/<col class="s-n">/g).length, 5)
})

console.log(`\nlocal-plan-eval-print: ${cases} cases passed`)
