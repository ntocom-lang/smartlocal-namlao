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
  assert.ok(!svg.includes('<path d="M'), 'ไม่มีไอคอน/ชิ้นวงกลมของหมวด')
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
  const build = (name) => page.evaluate(({ spec }) => {
    const { Info, Sum } = InfoBundle
    const rows = Object.entries(spec.sample.categories).flatMap(([category, n]) => Array.from({ length: n }, () => ({ category })))
    const summary = Sum.summarizeMonth({
      stats: spec.sample.stats, rows, labelOf: c => spec.sample.labels[c] ?? c,
      tenantName: spec.tenant, period: Sum.monthPeriod(2569, 4), issueBreakdown: spec.breakdown ?? null,
      now: new Date('2026-10-18T05:00:00Z'), lock: spec.lock ?? null,
    })
    const model = Info.buildInfographicModel(summary, { tenantName: spec.tenant })
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
      return { name: file.name, type: file.type, size: file.size, w: bitmap.width, h: bitmap.height, topLeft: pixel(2, 2), bottomRight: pixel(w - 3, h - 3), body: pixel(w - 30, 600) }
    }, { markup: svg, w: width, h: height })
    assert.equal(result.type, 'image/png')
    assert.equal(result.name, 'complaints-2569-04.png')
    assert.ok(result.size > 20000, `ไฟล์เล็กผิดปกติ ${result.size} ไบต์ (ภาพว่าง?)`)
    assert.deepEqual([result.w, result.h], [width, height])
    assert.deepEqual(result.topLeft, [22, 50, 79, 255], 'มุมบนซ้ายต้องเป็นสีหัวภาพทึบ')
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
} finally {
  await browser.close()
}

console.log(`\n${cases} cases passed`)
