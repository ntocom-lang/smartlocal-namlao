// ภาพอินโฟกราฟิกสรุปรายเดือน (src/lib/complaintMonthlyInfographic.js + complaintCategoryIcons.js)
//   ชั้นแรก: คำนวณล้วนใน node (ตัววัดข้อความจำลอง) — ตัวเลข/เส้นโค้ง/การ escape/ไอคอนครบทุกหมวดมาตรฐาน
//   ชั้นสอง: รันตัววาดใน Chrome จริงด้วยตัววัด canvas ของเบราว์เซอร์ — ข้อความต้องไม่ล้นขอบ/ไม่ทับกัน
//            ภาพโหลดเป็น <img> ได้ แปลงเป็น PNG ได้และมีพื้นทึบ โค้ดที่ฝังมากับชื่อ อปท./หมวดไม่ทำงาน
// ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต (บล็อกทุก request ในเบราว์เซอร์)
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { bundleInfographic, YALA_APRIL, LIGHT_BREAKDOWN } from './lib/infographicBrowser.mjs'

process.env.TZ = 'America/Los_Angeles'
const Info = await import('../src/lib/complaintMonthlyInfographic.js')
const Sum = await import('../src/lib/complaintMonthlySummary.js')
const Icons = await import('../src/lib/complaintCategoryIcons.js')
const { STANDARD_CATEGORY_LABEL } = await import('../src/lib/complaintCategoryLabels.js')
const Qr = await import('../src/lib/qrSvg.js')
// ไลบรารีตัวเดียวกับที่ตัววาดใช้ — เทสต์ใช้เมทริกซ์ของมันเป็น "เฉลย" แล้วตรวจว่าที่วาดลงภาพตรงกันทุกโมดูล
const { create: createQr } = await import('qrcode')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const NOW = new Date('2026-10-18T05:00:00Z')
const APRIL = Sum.monthPeriod(2569, 4)
// ตัววัดจำลองสำหรับ node: ความกว้างตามจำนวนตัวอักษร (ตัวหนากว้างกว่า) — ชั้นสองใช้ของจริง
const measure = (value, size, bold) => value.length * size * (bold ? 0.62 : 0.55)
const rowsOf = spec => Object.entries(spec).flatMap(([category, n]) => Array.from({ length: n }, () => ({ category })))
const labelOf = code => YALA_APRIL.labels[code] ?? `หมวด ${code}`
const summarize = (over = {}) => Sum.summarizeMonth({
  stats: YALA_APRIL.stats, rows: rowsOf(YALA_APRIL.categories), labelOf,
  tenantName: 'เทศบาลตำบลสาธิต', period: APRIL, now: NOW, ...over,
})
// ข้อความทั้งภาพต่อกันเป็นสายเดียวไม่มีช่องว่าง — ประโยคยาวถูกตัดเป็นหลาย <text> ตามความกว้าง จึงตรวจทีละ <text> ไม่ได้
const plain = svg => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1]).join('').replace(/\s+/g, '')
const has = (svg, phrase) => plain(svg).includes(phrase.replace(/\s+/g, ''))
const render = (summary, tenantName = 'เทศบาลตำบลสาธิต') =>
  Info.buildInfographicSvg(Info.buildInfographicModel(summary, { tenantName }), measure)

await test('โมเดล: สัดส่วนชิ้นวงกลมรวมเป็น 1 สีไล่ตามลำดับ และ "หมวดที่เหลือ" ใช้สีเทา', () => {
  const model = Info.buildInfographicModel(summarize(), { tenantName: 'ก' })
  assert.equal(model.slices.length, 5)
  assert.equal(model.slices[0].start, 0)
  assert.ok(Math.abs(model.slices.at(-1).end - 1) < 1e-9)
  for (let i = 1; i < model.slices.length; i++) assert.ok(Math.abs(model.slices[i].start - model.slices[i - 1].end) < 1e-9, 'ชิ้นต้องต่อกันไม่มีช่อง')
  assert.deepEqual(model.slices.map(s => s.color), Info.SLICE_COLORS.slice(0, 5))
  assert.deepEqual([model.resolved.percent, model.ongoing.percent], [94.9, 5.1])

  const spec = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`c${i}`, 11 - i]))
  const many = Info.buildInfographicModel(Sum.summarizeMonth({
    stats: { total: 66, resolved: 66 }, rows: rowsOf(spec), labelOf, tenantName: 'ก', period: APRIL, now: NOW,
  }), { tenantName: 'ก' })
  assert.equal(many.slices.at(-1).color, Info.REST_COLOR)
  assert.equal(many.slices.at(-1).code, null)
})

await test('เส้นโค้งวงแหวน: ชิ้นปกติ ชิ้นเล็ก และเต็มวง ต้องไม่มี NaN', () => {
  for (const [start, end] of [[0, 0.3333], [0.97, 1], [0.2, 0.9], [0, 1], [0, 0.0001]]) {
    const d = Info.donutSlicePath(264, 300, 172, 106, start, end)
    assert.ok(!/NaN|undefined|Infinity/.test(d), `${start}-${end}: ${d}`)
    assert.ok(d.startsWith('M') && d.trim().endsWith('Z'))
  }
  // เต็มวงแยกเป็น 2 ส่วนโค้ง × 2 วง (นอก+ใน) — ส่วนโค้ง 360° เส้นเดียวเบราว์เซอร์วาดเป็นว่าง
  assert.equal((Info.donutSlicePath(0, 0, 10, 5, 0, 1).match(/A /g) ?? []).length, 4)
})

await test('ตัดบรรทัด: ทุกบรรทัดไม่เกินความกว้าง ข้อความว่างได้ศูนย์บรรทัด คำเดียวยาวเกินถูกตัดกลางคำ', () => {
  const text = 'แจ้งเรื่องร้องทุกข์ร้องเรียนเกี่ยวกับการจัดเก็บเศษกิ่งไม้และใบไม้ในพื้นที่สาธารณะ'
  const lines = Info.wrapLines(text, 400, 30, true, measure)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.ok(measure(line, 30, true) <= 400, line)
  assert.equal(lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''), 'ตัดแล้วห้ามอักษรหาย')
  assert.deepEqual(Info.wrapLines('   ', 400, 30, false, measure), [])
  // เคสจริงจากหน้าจอ: เครื่องหมายปิดวงเล็บห้ามขึ้นบรรทัดใหม่คนเดียว (ความกว้างพอดีถึงก่อน ")" )
  const label = 'กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)'
  const tight = (label.length - 1) * 30 * 0.62
  for (const line of Info.wrapLines(label, tight, 30, true, measure)) {
    assert.ok(!/^[)ๆฯ.,]/.test(line), `บรรทัดขึ้นต้นด้วยเครื่องหมายปิด: "${line}"`)
  }
  const long = Info.wrapLines('ก'.repeat(80), 200, 30, false, measure)
  assert.ok(long.length > 1 && long.every(line => measure(line, 30, false) <= 200))
})

await test('SVG: ขนาด 1080 กว้าง ไม่ต่ำกว่า 1350 สูง พื้นขาวเป็นองค์ประกอบแรก และมีตัวเลขสำคัญ', () => {
  const { svg, width, height } = render(summarize())
  assert.equal(width, 1080)
  assert.ok(height >= 1350)
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(svg.includes('fill="#ffffff"/>'), 'ต้องมีพื้นทึบ ไม่งั้น PNG โปร่งใส')
  for (const expected of ['สรุปเรื่องร้องเรียน', 'เดือนเมษายน 2569', '>39<', '94.9%', '5.1%', '37 เรื่อง', 'ไฟฟ้าสาธารณะ', 'ร้อยละ 33.3']) {
    assert.ok(svg.includes(expected), `ไม่พบ ${expected}`)
  }
})

await test('ไม่มีข้อมูลส่วนบุคคลและไม่มีรายเรื่อง: ภาพมีแต่ยอดรวม', () => {
  const { svg } = render(summarize())
  for (const banned of ['เบอร์', 'ที่อยู่', 'ผู้แจ้ง', 'ชื่อ-สกุล', 'ref_no', 'ES-69', 'พิกัด']) {
    // "พิกัด" ปรากฏได้เฉพาะในประโยคปฏิเสธเท่านั้น — ใบปัจจุบันไม่มีคำนี้เลย
    assert.ok(!svg.includes(banned), `ภาพไม่ควรมี "${banned}"`)
  }
  assert.ok(has(svg, 'ไม่มีข้อมูลระบุตัวบุคคลและไม่แสดงรายเรื่อง'))
})

await test('แท็กในชื่อ อปท. และชื่อหมวดออกมาเป็นตัวอักษร ไม่มีองค์ประกอบแปลกปลอมใน SVG', () => {
  const payloads = [`<img src=x onerror="window.__pwned='img'">`, `<script>window.__pwned='s'</script>`, `</text><script>1</script>`, `" onload="x`]
  const summary = Sum.summarizeMonth({
    stats: { total: 4, resolved: 4 }, rows: rowsOf({ a: 1, b: 1, c: 1, d: 1 }),
    labelOf: code => payloads['abcd'.indexOf(code)], tenantName: payloads[0], period: APRIL, now: NOW,
  })
  const { svg } = render(summary, payloads[1])
  for (const tag of ['<img', '<script', 'onload="x', '<foreignObject']) assert.ok(!svg.includes(tag), `พบ ${tag} ใน SVG`)
  assert.ok(svg.includes('&lt;img src=x'))
  assert.ok(svg.includes('&lt;script&gt;'))
})

await test('เดือนที่ไม่มีเรื่อง: วงแหวนว่าง + ข้อความบอกตรงๆ ไม่มีชิ้นวงกลม', () => {
  const { svg } = render(summarize({ stats: { total: 0 }, rows: [] }))
  assert.ok(has(svg, 'ไม่มีเรื่องร้องเรียนที่รับผ่านระบบในเดือนนี้'))
  // (คลื่นของแถบหัวภาพก็เป็น <path d="M…"> จึงเช็คจากลายเซ็นของชิ้นวงกลม/ไอคอนแทน)
  assert.ok(!svg.includes('fill-rule="evenodd"') && !svg.includes('stroke-linecap="round"'), 'ไม่มีไอคอน/ชิ้นวงกลมของหมวด')
  assert.ok(svg.includes('0%'))
})

await test('รายการถูกตัดที่ LIMIT: ไม่วาดวงกลม (กันเลขเพี้ยน) แต่ยังมียอดรวมจริงและผลดำเนินงาน', () => {
  const { svg } = render(summarize({ stats: { total: 1500, resolved: 1200, in_progress: 300 }, rows: rowsOf({ light: 1000 }) }))
  assert.ok(has(svg, 'ไม่แสดงสัดส่วนตามหมวด'))
  assert.ok(svg.includes('80%') && svg.includes('1,200 เรื่อง'))
  assert.ok(!svg.includes('fill-rule="evenodd"'), 'ห้ามวาดชิ้นวงกลมเมื่อนับหมวดไม่ครบ')
})

await test('หมวดเดียว 100%: วาดวงแหวนเต็มวง ไม่มี NaN', () => {
  const { svg } = render(summarize({ stats: { total: 6, resolved: 6 }, rows: rowsOf({ light: 6 }) }))
  assert.ok(!/NaN/.test(svg))
  assert.ok(svg.includes('ร้อยละ 100'))
})

await test('ไอคอน: ทุกหมวดมาตรฐานของระบบมีไอคอนเฉพาะ · หมวดที่ อปท. ตั้งเองได้ไอคอนกลาง · หมวดที่เหลือได้จุดไข่ปลา', () => {
  const missing = Object.keys(STANDARD_CATEGORY_LABEL).filter(code => !Icons.KNOWN_ICON_CODES.includes(code))
  assert.deepEqual(missing, [], `หมวดมาตรฐานที่ยังไม่มีไอคอน: ${missing.join(', ')}`)
  const fallback = Icons.iconNodeForCategory('cat_custom_1')
  const rest = Icons.iconNodeForCategory(null)
  assert.notEqual(fallback, rest)
  assert.equal(Icons.iconNodeForCategory('cat_other_2'), fallback)
  for (const code of [...Icons.KNOWN_ICON_CODES, 'cat_custom_1', null]) {
    const node = Icons.iconNodeForCategory(code)
    assert.ok(Array.isArray(node) && node.length > 0, `ไอคอนว่าง: ${code}`)
    for (const [tag, attrs] of node) assert.ok(typeof tag === 'string' && attrs && typeof attrs === 'object')
  }
})

await test('รายการย่อยในภาพ: วาดใต้หมวดไฟฟ้าพร้อมจุดสีเดียวกับหมวด · หมวดอื่นไม่มี · ภาพสูงขึ้นตามจำนวนบรรทัด', () => {
  const plainImage = render(summarize())
  const withItems = render(summarize({ issueBreakdown: LIGHT_BREAKDOWN }))
  for (const phrase of ['ไฟดับทั้งดวง 6 เรื่อง', 'ไฟกระพริบ 3 เรื่อง', 'สายไฟชำรุด 2 เรื่อง', 'เสาเอียง/ชำรุด 1 เรื่อง', 'ไม่ระบุลักษณะ 1 เรื่อง']) {
    assert.ok(has(withItems.svg, phrase), `ไม่พบ ${phrase}`)
    assert.ok(!has(plainImage.svg, phrase), `ภาพที่ไม่มีข้อมูลย่อยต้องไม่มี ${phrase}`)
  }
  // ไอคอน lucide บางตัว (เช่น เครื่องหมายคำถามของหมวดอื่นๆ) ก็มี <circle> จึงนับเฉพาะจุดนำหน้ารัศมี 3.5
  assert.equal((withItems.svg.match(/<circle [^>]*r="3\.5"/g) ?? []).length, 5, 'จุดนำหน้ารายการย่อย 5 จุด')
  assert.ok(withItems.height > plainImage.height)
  const purple = Info.SLICE_COLORS[0]
  assert.equal((withItems.svg.match(new RegExp(`<circle [^>]*r="3\.5" fill="${purple}"`, 'g')) ?? []).length, 5, 'จุดสีเดียวกับชิ้นวงกลมของหมวดไฟฟ้า')
})

await test('รายการอนุญาตใน SQL = ISSUE_TYPES_BY_CATEGORY ในฟอร์ม ทุกหมวด ทุกตัวอักษร (กันสองที่เพี้ยนกัน)', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261018140000_complaint_issue_breakdown_fy.sql', import.meta.url), 'utf8')
  const form = await readFile(new URL('../src/pages/CitizenForm.jsx', import.meta.url), 'utf8')
  const fromSql = {}
  for (const [, category, label] of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([^']+)'\s*\)/g)) (fromSql[category] ??= []).push(label)
  const block = form.match(/const ISSUE_TYPES_BY_CATEGORY = \{([\s\S]*?)\r?\n\}/)
  assert.ok(block, 'หา ISSUE_TYPES_BY_CATEGORY ในฟอร์มไม่เจอ (เปลี่ยนรูปแบบไฟล์? ปรับเทสต์นี้ตาม)')
  const fromForm = {}
  for (const [, category, list] of block[1].matchAll(/([a-z_]+):\s*\[([^\]]*)\]/g)) fromForm[category] = [...list.matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.ok(Object.keys(fromForm).length >= 1 && Object.keys(fromSql).length >= 1)
  assert.deepEqual(fromSql, fromForm, 'รายการลักษณะปัญหาใน SQL กับในฟอร์มไม่ตรงกัน — ต้องแก้ migration ใหม่ (ไฟล์ใหม่ ห้ามแก้ไฟล์ที่ apply แล้ว) หรือแก้ฟอร์มให้ตรง')
  // หน้ารายงานดึงยอดเฉพาะหมวดเดียว — ถ้าฟอร์มเพิ่มหมวดที่สองต้องเพิ่มการดึงที่หน้ารายงานด้วย
  const page = await readFile(new URL('../src/pages/ComplaintStats.jsx', import.meta.url), 'utf8')
  const pageCategory = page.match(/const ISSUE_BREAKDOWN_CATEGORY = '([a-z_]+)'/)?.[1]
  assert.deepEqual(Object.keys(fromForm), [pageCategory], 'หมวดที่ฟอร์มมีลักษณะปัญหา ≠ หมวดที่หน้ารายงานดึงยอดย่อย')
})

// ── "แจ้งเรื่อง/ติดตามเรื่อง" (ทางต่อให้ชาวบ้านหลังอ่านภาพ) + ภาพต้องไม่มีระยะเวลาเฉลี่ย ──
const REPORT_URL = 'https://namlao.rk-networks.com/complaint'
const withAvg = avg => summarize({ stats: { ...YALA_APRIL.stats, avg_days: avg } })
const renderWith = (summary, reportUrl) =>
  Info.buildInfographicSvg(Info.buildInfographicModel(summary, { tenantName: 'เทศบาลตำบลสาธิต', reportUrl }), measure)
const RUN = /M(\d+) (\d+)h(\d+)v1h-\d+z/g

await test('QR: path ที่วาดตรงกับเมทริกซ์ของไลบรารีทุกโมดูล · ไม่มีคำสั่งอื่นปน · โมดูลเป็นจำนวนเต็ม ขอบสงบ 4 โมดูล', () => {
  const layout = Qr.qrLayout(REPORT_URL, 252)
  const expected = createQr(REPORT_URL, { errorCorrectionLevel: 'M' }).modules
  assert.equal(layout.size, expected.size)
  assert.equal(layout.d.replace(RUN, ''), '', 'path มีคำสั่งนอกเหนือจากเส้นโมดูลดำ')
  // ตัวอ่านนี้เขียนแยกจากตัวสร้าง path (อ่านกลับจากสตริงจริง ไม่ใช่เรียกฟังก์ชันเดิมซ้ำ)
  const grid = Array.from({ length: layout.size }, () => Array(layout.size).fill(false))
  for (const [, x, y, run] of layout.d.matchAll(RUN)) for (let i = 0; i < Number(run); i++) grid[Number(y)][Number(x) + i] = true
  let wrong = 0
  for (let row = 0; row < layout.size; row++) for (let col = 0; col < layout.size; col++) if (grid[row][col] !== !!expected.get(row, col)) wrong++
  assert.equal(wrong, 0, `โมดูลไม่ตรง ${wrong} จุด`)
  assert.ok(Number.isInteger(layout.module) && layout.module >= 6, `โมดูล ${layout.module}px เล็กไป — สแกนจากภาพบนจอไม่ติด`)
  assert.equal(layout.side, layout.module * (layout.size + Qr.QUIET_MODULES * 2))
  assert.ok(layout.side <= 252)
  assert.equal(Qr.QUIET_MODULES, 4)
})

await test('QR: ข้อความว่าง/ยาวเกินความจุ/กรอบเล็กเกินไป = null (ผู้เรียกข้ามกล่อง QR ไม่ล้ม)', () => {
  for (const bad of ['', '   ', null, undefined]) assert.equal(Qr.qrLayout(bad, 252), null)
  assert.equal(Qr.qrLayout(`https://x.test/${'a'.repeat(2500)}`, 252), null, 'เกินความจุ QR สูงสุด')
  assert.equal(Qr.qrLayout(REPORT_URL, 20), null, 'โมดูลต่ำกว่า 1px')
  assert.ok(Qr.qrLayout('https://ตัวอย่าง.ไทย/แจ้งเรื่อง', 252), 'ลิงก์ที่มีอักษรไทยต้องเข้ารหัสได้')
})

// เจ้าของระบบสั่ง 2569-10-19: ภาพที่ลงกลุ่มชาวบ้านต้องไม่โชว์ระยะเวลาเฉลี่ย (เห็นเลขเดียวแล้วถูกตีความว่า "ช้า") —
// ค่านี้ยังอยู่ในหน้ารายงานและใบ A4 ที่มีคำอธิบายครบ เทสต์นี้กันการเอากลับมาโดยไม่ตั้งใจ
await test('ภาพไม่มีระยะเวลาเฉลี่ยในทุกกรณี (ค่าปกติ/0/ไม่มีค่า/ใหญ่ผิดปกติ) · ความสูงภาพไม่ขึ้นกับค่านั้น · ใบสรุปยังถือค่าไว้ให้ใบ A4', () => {
  const baseline = renderWith(summarize(), REPORT_URL)
  for (const avg of [3.4, 8.9, 0, 120, null, undefined, NaN]) {
    const summary = withAvg(avg)
    const { svg, height } = renderWith(summary, REPORT_URL)
    for (const phrase of ['ใช้เวลาเฉลี่ย', 'ระยะเวลาเฉลี่ย', 'เฉลี่ยจากแจ้งเรื่อง', 'นับเฉพาะเรื่องที่เสร็จ']) {
      assert.ok(!has(svg, phrase), `avg_days=${String(avg)}: ภาพมี "${phrase}"`)
    }
    // ตัวเลขตามด้วย "วัน" (ไม่ใช่ "วันที่") = ระยะเวลาเป็นวัน ต้องไม่มีในภาพ
    assert.ok(!/\d(?:\.\d+)?วัน(?!ที่)/.test(plain(svg)), `avg_days=${String(avg)}: มีตัวเลขจำนวนวันในภาพ`)
    assert.equal(height, baseline.height, `avg_days=${String(avg)}: ความสูงเปลี่ยน`)
    assert.ok(!('avgDays' in Info.buildInfographicModel(summary, {})), 'โมเดลภาพต้องไม่แบกค่านี้')
  }
  assert.equal(withAvg(8.9).avgDays, 8.9, 'ใบสรุปต้องยังมีค่านี้ (ใบ A4 กับหน้ารายงานใช้)')
})

await test('กล่อง "แจ้งเรื่อง · ติดตามเรื่องของท่าน": ไม่ส่งลิงก์ = ไม่มีกล่อง · ส่งแล้ว = QR (ดำบนขาว) + ลิงก์ตัวอักษรไม่มี https://', () => {
  const plainImage = renderWith(summarize(), '')
  assert.ok(!plainImage.svg.includes('crispEdges') && !has(plainImage.svg, 'สแกน QR'), 'ไม่มีลิงก์ต้องไม่มีกล่อง')
  const withQr = renderWith(summarize(), REPORT_URL)
  assert.ok(has(withQr.svg, 'แจ้งเรื่อง · ติดตามเรื่องของท่าน') && has(withQr.svg, 'สแกน QR หรือเข้าที่'))
  assert.ok(has(withQr.svg, 'namlao.rk-networks.com/complaint') && !has(withQr.svg, 'https://'))
  assert.equal(withQr.svg.split('shape-rendering="crispEdges"').length - 1, 1)
  assert.ok(/<path transform="translate\(\d+ \d+\) scale\(\d+\)" d="M[^"]+" fill="#000000"/.test(withQr.svg), 'QR ต้องดำล้วน')
  assert.ok(withQr.height > plainImage.height)
  // ภาพของเดือนที่ล็อก/สด ตัวเลขเหมือนเดิม ต่างแค่กล่องเพิ่ม — ลิงก์ไม่ปนกับข้อมูลในภาพ
  assert.equal(plain(withQr.svg).includes('namlao'), true)
})

await test('กล่อง QR: ลิงก์ที่มีแท็ก/เครื่องหมายคำพูดถูกหนีอักขระ · สร้าง QR ไม่ได้ก็ยังเหลือลิงก์ตัวอักษร (ไม่ล้ม)', () => {
  const evil = renderWith(summarize(), 'https://x.test/"><script>window.__pwned=1</script>')
  assert.ok(!evil.svg.includes('<script'), 'ลิงก์หลุดเป็นโค้ด')
  assert.ok(evil.svg.includes('&lt;script&gt;') || evil.svg.includes('&quot;&gt;'), 'ลิงก์ต้องออกมาเป็นตัวอักษรที่ถูกหนี')
  const tooLong = renderWith(summarize(), `https://x.test/${'a'.repeat(2500)}`)
  assert.ok(!tooLong.svg.includes('crispEdges') && has(tooLong.svg, 'เข้าที่') && !has(tooLong.svg, 'สแกน QR'))
  assert.ok(has(tooLong.svg, 'แจ้งเรื่อง · ติดตามเรื่องของท่าน'))
})

await test('ไม่มีข้อมูลส่วนบุคคลแม้มีกล่อง QR: ลิงก์ชี้หน้าแจ้งเรื่องสาธารณะ ไม่มีพารามิเตอร์ติดตาม', () => {
  const { svg } = renderWith(withAvg(3.4), REPORT_URL)
  for (const banned of ['เบอร์', 'ที่อยู่', 'ผู้แจ้ง', 'ชื่อ-สกุล', 'ref_no', 'ES-69', 'พิกัด', 'token', '?']) {
    assert.ok(!plain(svg).includes(banned), `ภาพไม่ควรมี "${banned}"`)
  }
})

// ── แถบหัวภาพ (แนวเดียวกับภาพอ้างอิงที่เจ้าของเลือก: ชื่อเรื่องขาว + เดือนเหลืองบรรทัดเดียว · ชื่อ อปท. มีเส้นขีดสองข้าง ·
//    คลื่นซ้ายบน · จุดไข่ปลาขวาบน · โทนเขียว) ──
const textsOf = svg => [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="(\d+)" font-weight="\d+" fill="(#[0-9a-f]+)" text-anchor="(\w+)">([^<]*)<\/text>/g)]
  .map(([, x, y, size, fill, anchor, value]) => ({ x: Number(x), y: Number(y), size: Number(size), fill, anchor, value }))
const headerHeightOf = svg => Number(svg.match(/<rect width="1080" height="([\d.]+)" fill="#14532d"\/>/)?.[1])
const rulesOf = svg => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="2" fill="#ffffff" fill-opacity="0.85"\/>/g)]
  .map(([, x, y, width]) => ({ x: Number(x), y: Number(y), width: Number(width) }))
// ตัววัดจำลองแบบแคบ (พอให้ชื่อเรื่อง+เดือนปกติลดขนาดลงมาแต่ยังเป็นบรรทัดเดียว) กับแบบกว้าง (บังคับให้ต้องแยก 2 บรรทัด)
const narrow = (value, size, bold) => value.length * size * (bold ? 0.45 : 0.4)
const wide = (value, size, bold) => value.length * size * (bold ? 0.62 : 0.55)
const renderMeasured = (summary, measurer, tenantName = 'เทศบาลตำบลสาธิต') =>
  Info.buildInfographicSvg(Info.buildInfographicModel(summary, { tenantName }), measurer)
const luminance = hex => {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

await test('หัวภาพ: ชื่อเรื่อง (ขาว) กับเดือน (เหลือง) บรรทัดเดียวกันกึ่งกลางภาพ · ชื่อ อปท. กึ่งกลางพร้อมเส้นขีดสองข้างสมมาตร', () => {
  const { svg } = renderMeasured(summarize(), narrow)
  const [title, month, tenant] = textsOf(svg)
  assert.deepEqual([title.value, title.fill], ['สรุปเรื่องร้องเรียน', '#ffffff'])
  assert.deepEqual([month.value, month.fill], ['เดือนเมษายน 2569', '#ffd54a']) // เหลืองตามภาพอ้างอิง — เขียนค่าตรงๆ ไม่อ้างค่าคงที่ของตัววาด (ไม่งั้นเปลี่ยนสีแล้วเทสต์ไม่รู้)
  assert.equal(title.y, month.y, 'ต้องอยู่บรรทัดเดียวกัน')
  assert.equal(title.size, month.size)
  assert.ok(title.size >= 42 && title.size <= 58, `ขนาด ${title.size}`)
  const left = title.x
  const right = month.x + narrow(month.value, month.size, true)
  assert.ok(Math.abs((left + right) / 2 - 540) < 0.5, 'ทั้งบรรทัดต้องกึ่งกลางภาพ')
  assert.ok(right - left <= 820.5, `บรรทัดกว้าง ${Math.round(right - left)} เกินพื้นที่ที่เว้นให้คลื่น/จุด`)
  assert.deepEqual([tenant.value, tenant.anchor, tenant.x, tenant.fill], ['เทศบาลตำบลสาธิต', 'middle', 540, '#ffffff'])
  const rules = rulesOf(svg)
  assert.equal(rules.length, 2, 'เส้นขีดซ้าย-ขวาของชื่อ อปท.')
  assert.ok(Math.abs((rules[0].x + rules[0].width) - (1080 - rules[1].x)) < 0.5, 'เส้นสองข้างต้องสมมาตรรอบกึ่งกลาง')
  for (const rule of rules) assert.ok(rule.x >= 64 && rule.x + rule.width <= 1080 - 64 + 0.01 && rule.width >= 30 && rule.width <= 120)
})

await test('หัวภาพ: ชื่อเรื่อง+เดือนยาวเกินแถบ → ลดตัวอักษรให้พอดีบรรทัดเดียว (ไม่ต่ำกว่า 42) · ยังไม่พอ → แยก 2 บรรทัดกึ่งกลาง', () => {
  const normalMonth = textsOf(renderMeasured(summarize(), narrow).svg)
  const longMonth = textsOf(renderMeasured(summarize({ period: Sum.monthPeriod(2569, 2) }), narrow).svg) // กุมภาพันธ์ ยาวกว่าเมษายน
  assert.equal(longMonth[1].value, 'เดือนกุมภาพันธ์ 2569')
  assert.ok(longMonth[0].size < normalMonth[0].size && longMonth[0].size >= 42, `${longMonth[0].size} vs ${normalMonth[0].size}`)
  assert.equal(longMonth[0].y, longMonth[1].y, 'ยังอยู่บรรทัดเดียวกัน')
  const right = longMonth[1].x + narrow(longMonth[1].value, longMonth[1].size, true)
  assert.ok(right - longMonth[0].x <= 820.5)

  const stacked = textsOf(renderMeasured(summarize(), wide).svg)
  assert.deepEqual(stacked.slice(0, 2).map(t => [t.value, t.anchor, t.x]), [['สรุปเรื่องร้องเรียน', 'middle', 540], ['เดือนเมษายน 2569', 'middle', 540]])
  assert.ok(stacked[1].y > stacked[0].y + 40, 'เดือนต้องอยู่ใต้ชื่อเรื่อง')
  assert.equal(stacked[1].fill, '#ffd54a')
  for (const t of stacked.slice(0, 2)) assert.ok(wide(t.value, t.size, true) <= 952, `บรรทัดแยกกว้างเกิน: ${t.value}`)
})

await test('หัวภาพ: ชื่อ อปท. ยาวหลายบรรทัด = ไม่มีเส้นขีด วางกึ่งกลางทุกบรรทัด และแถบสูงขึ้นตามบรรทัด', () => {
  const longName = 'องค์การบริหารส่วนตำบลที่มีชื่อยาวมากพอสมควรสำหรับทดสอบการขึ้นบรรทัดใหม่ของข้อความ'
  const short = renderMeasured(summarize(), narrow)
  const long = renderMeasured(summarize(), narrow, longName)
  const tenantTexts = textsOf(long.svg).filter(t => t.size === 32 && t.fill === '#ffffff')
  assert.ok(tenantTexts.length >= 2, 'ชื่อยาวต้องขึ้นหลายบรรทัด')
  assert.ok(tenantTexts.every(t => t.anchor === 'middle' && t.x === 540))
  assert.equal(tenantTexts.map(t => t.value).join('').replace(/\s/g, ''), longName.replace(/\s/g, ''), 'ตัดบรรทัดแล้วห้ามอักษรหาย')
  assert.equal(rulesOf(long.svg).length, 0)
  assert.ok(headerHeightOf(long.svg) >= headerHeightOf(short.svg) + 40)
})

await test('หัวภาพ: คลื่น 2 ชั้นซ้ายบน + จุดไข่ปลาขวาบน อยู่ในกลุ่มซ่อนจากโปรแกรมอ่านจอ ถูกตัดด้วย clip และวาดก่อนตัวอักษร · แถบเตี้ยกว่าแบบเดิม (252)', () => {
  const { svg } = renderMeasured(summarize(), narrow)
  assert.equal(Info.HEADER_BG, '#14532d')
  const height = headerHeightOf(svg)
  assert.ok(height >= 170 && height <= 200, `แถบสูง ${height}px`)
  assert.ok(svg.includes(`<clipPath id="header-clip"><rect width="1080" height="${height}"/></clipPath>`))
  const decor = svg.match(/<g clip-path="url\(#header-clip\)" aria-hidden="true">(.*?)<g fill="#ffffff" fill-opacity="0.5">(.*?)<\/g><\/g>/s)
  assert.ok(decor, 'หากลุ่มคลื่น/จุดไม่เจอ')
  const waves = [...decor[1].matchAll(/<path d="M0 0H(\d+)[^"]*" fill="(#[0-9a-f]+)" fill-opacity="([\d.]+)"\/>/g)]
  assert.deepEqual(waves.map(w => Number(w[1])), [270, 170], 'คลื่น 2 ชั้น ชั้นหลังใหญ่กว่า')
  assert.ok(waves.every(w => Number(w[3]) > 0 && Number(w[3]) < 1), 'คลื่นโปร่งแสง ไม่กลบตัวอักษรที่เลื่อนมาทับ')
  const circles = [...decor[2].matchAll(/<circle cx="(\d+)" cy="(\d+)" r="([\d.]+)"\/>/g)].map(c => ({ x: Number(c[1]), y: Number(c[2]), r: Number(c[3]) }))
  assert.ok(circles.length >= 20, `จุดไข่ปลา ${circles.length} จุด`)
  assert.ok(circles.every(c => c.x >= 940 && c.x <= 1058 && c.y <= height && c.r >= 0.8 && c.r <= 3.6), 'จุดต้องอยู่มุมขวาบน ไม่ลามมาทับชื่อเรื่อง')
  assert.ok(svg.indexOf('aria-hidden="true"') < svg.indexOf('<text'), 'คลื่น/จุดต้องวาดก่อนตัวอักษร (ตัวอักษรอยู่บน)')
})

await test('หัวภาพ: สีตัวอักษรบนพื้นเขียวคอนทราสต์ผ่านเกณฑ์ตัวอักษรทั่วไป 4.5:1 ทั้งสีขาวและสีเหลือง', () => {
  assert.ok(contrast('#ffffff', Info.HEADER_BG) >= 4.5, `ขาว ${contrast('#ffffff', Info.HEADER_BG).toFixed(1)}`)
  assert.ok(contrast(Info.MONTH_COLOR, Info.HEADER_BG) >= 4.5, `เหลือง ${contrast(Info.MONTH_COLOR, Info.HEADER_BG).toFixed(1)}`)
})

// ── ชั้นสอง: Chrome จริง ──
const bundle = await bundleInfographic()
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1500 } })
  await page.route('**/*', route => route.abort())
  await page.setContent('<!doctype html><body style="margin:0"></body>')
  await page.addScriptTag({ content: bundle })

  // สร้างภาพในเบราว์เซอร์ด้วยตัววัด canvas จริง แล้ววางเป็น SVG อินไลน์เพื่อวัดกล่องตัวอักษรจริง
  const CASES = {
    april: { sample: YALA_APRIL, tenant: 'เทศบาลตำบลสาธิต' },
    crowded: {
      // หมวดมากกว่า 8 + ชื่อหมวดยาวมาก + ชื่อ อปท. ยาวหลายบรรทัด + มีเรื่องไม่รับ — เนื้อหายาวที่สุดที่เป็นไปได้จริง
      sample: {
        stats: { total: 1045, open: 40, in_progress: 100, resolved: 890, rejected: 15, avg_days: 12.5 },
        categories: Object.fromEntries([200, 150, 130, 120, 100, 90, 80, 70, 50, 35, 20].map((n, i) => [`c${i}`, n])),
        labels: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`c${i}`, `แจ้งเรื่องร้องทุกข์ร้องเรียนหมวดที่มีชื่อยาวพอสมควร ${i}`])),
      },
      tenant: 'องค์การบริหารส่วนตำบลที่มีชื่อยาวมากพอสมควรสำหรับทดสอบการขึ้นบรรทัดใหม่ของข้อความในแถบหัวภาพ',
    },
    subitems: { sample: YALA_APRIL, tenant: 'เทศบาลตำบลสาธิต', breakdown: LIGHT_BREAKDOWN },
    // ชุดที่ล็อก (เฟส 2): หมายเหตุล็อกยาวกว่าหมายเหตุปกติ + "แก้ไขครั้งที่ N" ต้องไม่ล้น/ทับ แม้เนื้อหายาวสุด
    locked: { sample: YALA_APRIL, tenant: 'เทศบาลตำบลสาธิต', breakdown: LIGHT_BREAKDOWN, lock: { publishedAt: '2026-05-02T01:30:00Z', revision: 1 } },
    lockedCrowded: {
      sample: {
        stats: { total: 1045, open: 40, in_progress: 100, resolved: 890, rejected: 15, avg_days: 12.5 },
        categories: Object.fromEntries([200, 150, 130, 120, 100, 90, 80, 70, 50, 35, 20].map((n, i) => [`c${i}`, n])),
        labels: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`c${i}`, `แจ้งเรื่องร้องทุกข์ร้องเรียนหมวดที่มีชื่อยาวพอสมควร ${i}`])),
      },
      tenant: 'องค์การบริหารส่วนตำบลที่มีชื่อยาวมากพอสมควรสำหรับทดสอบการขึ้นบรรทัดใหม่ของข้อความในแถบหัวภาพ',
      lock: { publishedAt: '2026-05-02T01:30:00Z', revision: 12 },
    },
    subitemsLong: {
      // ชื่อรายการย่อยยาวมาก (ฟอร์มเปลี่ยนรายการในอนาคต) ต้องตัดบรรทัดไม่ล้นขอบ/ไม่ทับรายการถัดไป
      sample: { stats: { total: 14, resolved: 14 }, categories: { light: 14 }, labels: { light: 'ไฟฟ้าสาธารณะ' } },
      tenant: 'เทศบาลตำบลสาธิต',
      breakdown: { category: 'light', rows: [
        { issue_label: 'ไฟดับทั้งดวงบริเวณทางแยกที่มีผู้สัญจรหนาแน่นและต้องการให้ซ่อมโดยด่วน', total: 7 },
        { issue_label: 'เสาไฟเอียงล้มทับสายไฟและต้นไม้ริมทางสาธารณะ', total: 4 },
        { issue_label: 'อื่นๆ', total: 2 }, { issue_label: null, total: 1 },
      ] },
    },
    empty: { sample: { stats: { total: 0 }, categories: {}, labels: {} }, tenant: 'เทศบาลตำบลสาธิต' },
    truncated: { sample: { stats: { total: 1500, resolved: 1200, in_progress: 300 }, categories: { a: 1000 }, labels: { a: 'ไฟฟ้า' } }, tenant: 'เทศบาลตำบลสาธิต' },
    single: { sample: { stats: { total: 6, resolved: 6 }, categories: { light: 6 }, labels: { light: 'ไฟฟ้าสาธารณะ' } }, tenant: 'เทศบาลตำบลสาธิต' },
  }
  // กล่อง "แจ้งเรื่อง/ติดตามเรื่อง" + กล่อง QR: ทุกเคสด้านล่างต้องผ่านการตรวจล้นขอบ/ทับกันเหมือนเคสอื่น
  const WITH_AVG = { ...YALA_APRIL, stats: { ...YALA_APRIL.stats, avg_days: 3.4 } }
  CASES.reported = { sample: WITH_AVG, tenant: 'องค์การบริหารส่วนตำบลน้ำเลา', reportUrl: REPORT_URL }
  CASES.reportedEmpty = { sample: { stats: { total: 0 }, categories: {}, labels: {} }, tenant: 'องค์การบริหารส่วนตำบลทุ่งแค้ว', reportUrl: REPORT_URL }
  // โฮสต์ยาว + มีพาธฐาน — บรรทัดลิงก์ต้องตัดขึ้นบรรทัดใหม่ ไม่ล้มกล่อง
  CASES.reportedLongUrl = { sample: WITH_AVG, tenant: 'เทศบาลตำบลสาธิต', reportUrl: 'https://smartlocal-demonstration-municipality.rk-networks.com/some-long-base-path/complaint' }
  // เดือนที่ชื่อยาวที่สุด (กุมภาพันธ์/พฤศจิกายน/พฤษภาคม + ปี) ต้องพอดีบรรทัดเดียวด้วยฟอนต์จริง ไม่ล้น ไม่ทับคลื่น/จุด
  CASES.longMonthFeb = { sample: WITH_AVG, tenant: 'องค์การบริหารส่วนตำบลน้ำเลา', month: 2 }
  CASES.longMonthNov = { sample: WITH_AVG, tenant: 'เทศบาลตำบลสาธิต', month: 11 }
  CASES.reportedCrowded = { ...CASES.crowded, reportUrl: REPORT_URL }
  CASES.reportedLocked = { ...CASES.lockedCrowded, reportUrl: REPORT_URL }

  const build = (name) => page.evaluate(({ spec }) => {
    const { Info, Sum } = InfoBundle
    const rows = Object.entries(spec.sample.categories).flatMap(([category, n]) => Array.from({ length: n }, () => ({ category })))
    const summary = Sum.summarizeMonth({
      stats: spec.sample.stats, rows, labelOf: c => spec.sample.labels[c] ?? c,
      tenantName: spec.tenant, period: Sum.monthPeriod(2569, spec.month ?? 4), issueBreakdown: spec.breakdown ?? null,
      now: new Date('2026-10-18T05:00:00Z'), lock: spec.lock ?? null,
    })
    const model = Info.buildInfographicModel(summary, { tenantName: spec.tenant, reportUrl: spec.reportUrl ?? '' })
    return Info.buildInfographicSvg(model, Info.createCanvasMeasure())
  }, { spec: CASES[name] })

  for (const name of Object.keys(CASES)) {
    await test(`Chrome (${name}): ข้อความไม่ล้นขอบภาพและไม่ทับกัน`, async () => {
      const { svg, width, height } = await build(name)
      const boxes = await page.evaluate(({ svg: markup }) => {
        document.body.innerHTML = markup
        return [...document.querySelectorAll('svg text')].map(el => {
          const b = el.getBBox()
          return { text: el.textContent, x: b.x, y: b.y, w: b.width, h: b.height }
        })
      }, { svg })
      assert.ok(boxes.length > 8, 'ต้องมีข้อความหลายชิ้น')
      for (const b of boxes) {
        assert.ok(b.x >= 62, `ล้นขอบซ้าย: "${b.text}" x=${b.x}`)
        assert.ok(b.x + b.w <= width - 62, `ล้นขอบขวา: "${b.text}" ขวา=${b.x + b.w}`)
        assert.ok(b.y >= 0 && b.y + b.h <= height, `ล้นขอบบน/ล่าง: "${b.text}"`)
      }
      // ทับกัน: กล่องสองชิ้นที่ซ้อนกันทั้งแนวนอนและแนวตั้งเกิน 8px ถือว่าทับ (ระยะบรรทัดไทยมีวรรณยุกต์เหนือ/ใต้เส้น จึงเผื่อไว้)
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]; const c = boxes[j]
          const overlapX = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x)
          const overlapY = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y)
          assert.ok(!(overlapX > 8 && overlapY > 8), `ข้อความทับกัน: "${a.text}" กับ "${c.text}" (${Math.round(overlapX)}×${Math.round(overlapY)}px)`)
        }
      }
    })
  }

  await test('Chrome: ชื่อเรื่อง+เดือนอยู่บรรทัดเดียวและอยู่ในช่วง 130–950px ด้วยฟอนต์จริง (ไม่ทับคลื่น/จุด) แม้เดือนชื่อยาวสุด', async () => {
    for (const name of ['april', 'longMonthFeb', 'longMonthNov']) {
      const { svg } = await build(name)
      const [title, month] = await page.evaluate(({ svg: markup }) => {
        document.body.innerHTML = markup
        return [...document.querySelectorAll('svg text')].slice(0, 2).map(el => {
          const b = el.getBBox()
          return { text: el.textContent, x: b.x, y: b.y, w: b.width, h: b.height }
        })
      }, { svg })
      assert.equal(title.text, 'สรุปเรื่องร้องเรียน')
      assert.ok(month.text.startsWith('เดือน'))
      assert.ok(Math.abs(title.y - month.y) < 1.5, `${name}: ไม่อยู่บรรทัดเดียวกัน (${title.y} vs ${month.y})`)
      assert.ok(title.x >= 129 && month.x + month.w <= 951, `${name}: บรรทัดกว้างเกินพื้นที่ ${Math.round(title.x)}–${Math.round(month.x + month.w)}`)
      assert.ok(month.x >= title.x + title.w, `${name}: เดือนทับชื่อเรื่อง`)
    }
  })

  await test('ภาพของเดือนที่ล็อก: ท้ายภาพบอกวันที่ล็อก (2 พ.ค.) ไม่ใช่วันที่สร้างภาพ (18 ต.ค.) · มีหมายเหตุล็อกและครั้งที่แก้ไข', async () => {
    const plain = (await build('locked')).svg
    assert.ok(plain.includes('ข้อมูล ณ วันที่ 2 พฤษภาคม 2569'))
    assert.ok(!plain.includes('18 ตุลาคม 2569'))
    assert.ok(plain.includes('ล็อกไว้เมื่อวันที่ 2 พฤษภาคม 2569'))
    const revised = (await build('lockedCrowded')).svg
    assert.ok(revised.includes('แก้ไขครั้งที่ 11'))
    const live = (await build('april')).svg
    assert.ok(live.includes('ข้อมูล ณ วันที่ 18 ตุลาคม 2569') && !live.includes('ล็อกไว้เมื่อ'), 'ภาพตัวเลขสดต้องไม่เปลี่ยน')
  })

  await test('Chrome: ภาพโหลดเป็น <img> ได้ ขนาดตรง และเป็น XML ที่ถูกต้อง', async () => {
    const { svg, width, height } = await build('april')
    const result = await page.evaluate(async ({ markup }) => {
      const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
      const image = new Image()
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('img error')); image.src = InfoBundle.Info.svgDataUrl(markup) })
      return { parserError: !!parsed.querySelector('parsererror'), w: image.naturalWidth, h: image.naturalHeight }
    }, { markup: svg })
    assert.equal(result.parserError, false)
    assert.deepEqual([result.w, result.h], [width, height])
  })

  await test('Chrome: แปลงเป็น PNG ได้ มีพื้นทึบ (ไม่โปร่งใส) และขนาดตรงกับภาพ', async () => {
    const { svg, width, height } = await build('april')
    const result = await page.evaluate(async ({ markup, w, h }) => {
      const file = await InfoBundle.Info.svgToPngFile(markup, w, h, 'complaints-2569-04.png')
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data]
      return { name: file.name, type: file.type, size: file.size, w: bitmap.width, h: bitmap.height, topLeft: pixel(2, 2), topCenter: pixel(540, 3), topRight: pixel(1076, 3), bottomRight: pixel(w - 3, h - 3), body: pixel(w - 30, 600) }
    }, { markup: svg, w: width, h: height })
    assert.equal(result.type, 'image/png')
    assert.equal(result.name, 'complaints-2569-04.png')
    assert.ok(result.size > 20000, `ไฟล์เล็กผิดปกติ ${result.size} ไบต์ (ภาพว่าง?)`)
    assert.deepEqual([result.w, result.h], [width, height])
    // กลางขอบบนไม่มีคลื่น/จุด = สีพื้นแถบหัวภาพล้วน · มุมบนซ้ายเป็นคลื่น (ต้องทึบและไม่ใช่สีพื้น — พิสูจน์ว่าคลื่นถูกวาดลงไฟล์จริง)
    const bg = [1, 3, 5].map(i => parseInt(Info.HEADER_BG.slice(i, i + 2), 16))
    assert.deepEqual(result.topCenter, [...bg, 255], 'กลางขอบบนต้องเป็นสีพื้นหัวภาพทึบ')
    assert.equal(result.topLeft[3], 255, 'มุมบนซ้ายต้องทึบ')
    assert.notDeepEqual(result.topLeft.slice(0, 3), bg, 'มุมบนซ้ายต้องเป็นคลื่น ไม่ใช่สีพื้น')
    assert.equal(result.topRight[3], 255)
    assert.deepEqual(result.bottomRight, [255, 255, 255, 255], 'มุมล่างขวาต้องเป็นขาวทึบ ไม่ใช่โปร่งใส')
  })

  await test('Chrome: โค้ดที่ฝังมากับชื่อ อปท./ชื่อหมวดไม่ทำงาน ทั้งแบบอินไลน์และแบบ <img>', async () => {
    const payload = `<img src=x onerror="window.__pwned='img'"><script>window.__pwned='script'</script>`
    const outcome = await page.evaluate(async ({ payload: bad }) => {
      const { Info, Sum } = InfoBundle
      const summary = Sum.summarizeMonth({
        stats: { total: 2, resolved: 2 }, rows: [{ category: 'x' }, { category: 'y' }], labelOf: () => bad,
        tenantName: bad, period: Sum.monthPeriod(2569, 4), now: new Date('2026-10-18T05:00:00Z'),
      })
      const { svg } = Info.buildInfographicSvg(Info.buildInfographicModel(summary, { tenantName: bad }), Info.createCanvasMeasure())
      document.body.innerHTML = svg
      const image = new Image()
      await new Promise(resolve => { image.onload = resolve; image.onerror = resolve; image.src = Info.svgDataUrl(svg) })
      await new Promise(resolve => setTimeout(resolve, 200))
      return { pwned: window.__pwned ?? null, injected: document.querySelectorAll('svg img, svg script, svg foreignObject').length }
    }, { payload })
    assert.equal(outcome.pwned, null)
    assert.equal(outcome.injected, 0)
  })

  await test('ความสูงตัวอย่างปกติ (5 หมวด) ใกล้ 4:5 ไม่เกิน 1400 — ฟีด Facebook/Instagram ไม่ครอป', async () => {
    const { height } = await build('april')
    assert.ok(height >= 1350 && height <= 1400, `สูง ${height}px`)
  })

  await test('ภาพที่มี QR สูงขึ้นแต่ไม่เกิน 1750 (ตัวอย่างปกติ) — กล่องนี้ห้ามบวมเกินที่ตั้งใจ', async () => {
    const { height } = await build('reported')
    assert.ok(height > 1400 && height <= 1750, `สูง ${height}px`)
  })

  // ตรวจตลอดสายจาก SVG ถึงไฟล์ PNG ที่ดาวน์โหลดจริง: สุ่มสีพิกเซลกลางโมดูลทุกจุดเทียบกับเมทริกซ์ของไลบรารี
  // (ตำแหน่ง/ขนาดโมดูล/ขอบสงบที่คำนวณผิดแม้ 1px ทำให้สแกนไม่ติด แต่ตาคนดูภาพแล้วไม่เห็น)
  await test('Chrome: QR ในไฟล์ PNG ตรงกับเมทริกซ์ทุกโมดูล · ขอบสงบเป็นสีขาว', async () => {
    const { svg, width, height } = await build('reported')
    const found = svg.match(/<g transform="translate\((\d+) ([\d.]+)\)"><rect width="(\d+)" height="\d+" fill="#ffffff"\/><path transform="translate\((\d+) \d+\) scale\((\d+)\)"/)
    assert.ok(found, 'หากลุ่ม QR ในภาพไม่เจอ')
    const [gx, gy, side, quiet, module] = found.slice(1).map(Number)
    const modules = createQr(REPORT_URL, { errorCorrectionLevel: 'M' }).modules
    assert.equal(quiet, module * Qr.QUIET_MODULES)
    assert.equal(side, module * (modules.size + Qr.QUIET_MODULES * 2))
    const sampled = await page.evaluate(async ({ markup, w, h, gx: ox, gy: oy, quiet: q, module: m, size, side: s }) => {
      const file = await InfoBundle.Info.svgToPngFile(markup, w, h, 'q.png')
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
      const luminance = (x, y) => { const [r, g, b] = context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data; return (r + g + b) / 3 }
      const dark = []
      for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) dark.push(luminance(ox + q + col * m + m / 2, oy + q + row * m + m / 2) < 128)
      // วงแหวนขอบสงบ: ขอบนอกสุด 4 มุม + กลางแต่ละด้าน ต้องขาว
      const ring = [[1, 1], [s - 2, 1], [1, s - 2], [s - 2, s - 2], [s / 2, 1], [s / 2, s - 2], [1, s / 2], [s - 2, s / 2]].map(([dx, dy]) => luminance(ox + dx, oy + dy))
      return { dark, ring }
    }, { markup: svg, w: width, h: height, gx, gy, quiet, module, size: modules.size, side })
    let wrong = 0
    for (let row = 0; row < modules.size; row++) for (let col = 0; col < modules.size; col++) {
      if (sampled.dark[row * modules.size + col] !== !!modules.get(row, col)) wrong++
    }
    assert.equal(wrong, 0, `โมดูลในไฟล์ PNG ไม่ตรง ${wrong} จุด`)
    assert.ok(sampled.ring.every(value => value > 250), `ขอบสงบไม่ขาว: ${sampled.ring.join(',')}`)
  })
} finally {
  await browser.close()
}

console.log(`\n${cases} cases passed`)
