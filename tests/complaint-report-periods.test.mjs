// ช่วงรายวัน / รายสัปดาห์ / รายไตรมาส ของหน้า /reports/complaints (src/lib/complaintReportPeriods.js)
//   คำนวณล้วน ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต · ส่วนท้ายตรวจว่าหน้า ComplaintStats ต่อเข้ากับช่วงเหล่านี้จริง
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// ตั้งโซนเวลาเครื่องเป็นต่างประเทศ: ถ้าโค้ดอ่านวันจากเวลาเครื่องแทนเวลาไทย เคสข้ามวัน/ข้ามปีด้านล่างจะพัง
process.env.TZ = 'America/Los_Angeles'
const P = await import('../src/lib/complaintReportPeriods.js')
const { monthPeriod, summarizeMonth } = await import('../src/lib/complaintMonthlySummary.js')
const { buildComplaintMonthlyHtml } = await import('../src/lib/complaintMonthlyPrint.js')
const {
  DAY_OPTION_COUNT, PERIOD_PARAMS, QUARTER_OPTION_COUNT, WEEK_OPTION_COUNT,
  bangkokIsoDate, dayParamFromInput, dayPeriod, fiscalYearPeriod, isCurrentPeriod, lastFullDay, lastFullQuarter, lastFullWeek,
  mondayOf, parseDayParam, parsePeriodParams, parseQuarterParam, parseWeekParam, periodTrend,
  quarterPeriod, recentQuarterOptions, recentWeekOptions, thaiDateRange, weekPeriod,
} = P

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

const NOW = new Date('2026-10-29T05:00:00Z') // พฤหัสบดี 29 ต.ค. 2569 เที่ยงเวลาไทย
// 00:30 วันที่ 1 ต.ค. เวลาไทย = ยังเป็น 30 ก.ย. ที่ลอสแอนเจลิส และ UTC
const EARLY_OCT = new Date('2026-09-30T17:30:00Z')

test('วันที่ตามเวลาไทย ไม่ใช่เวลาเครื่อง/UTC', () => {
  assert.equal(bangkokIsoDate(NOW), '2026-10-29')
  assert.equal(bangkokIsoDate(EARLY_OCT), '2026-10-01')
  assert.equal(bangkokIsoDate('2026-10-28T17:10:00Z'), '2026-10-29', 'created_at หลังเที่ยงคืนไทยต้องเป็นวันใหม่')
})

test('รายวัน: ป้าย พ.ศ. + ชื่อวัน · ค่าในลิงก์ · วันที่ไม่มีจริง/อนาคต/ไกลเกินเป็น null', () => {
  const day = parseDayParam('2569-10-28', NOW)
  assert.deepEqual([day.kind, day.from, day.to, day.key, day.label, day.rangeText],
    ['day', '2026-10-28', '2026-10-28', '2569-10-28', 'วันที่ 28 ตุลาคม 2569', 'วันพุธ'])
  assert.equal(parseDayParam('2569-10-29', NOW).key, '2569-10-29', 'วันนี้เปิดได้')
  for (const bad of ['2569-10-30', '2570-01-01', '2569-04-31', '2569-02-29', '2569-13-01', '2569-1-5', '28-10-2569', '', null, undefined, '2569-10']) {
    assert.equal(parseDayParam(bad, NOW), null, String(bad))
  }
  assert.equal(parseDayParam('2567-02-29', NOW), null, '29 ก.พ. 2567 มีจริง แต่ไกลเกินช่วงย้อนหลัง')
  assert.equal(dayPeriod('2024-02-29').key, '2567-02-29', 'ปีอธิกสุรทินแปลง พ.ศ. ถูก')
  assert.equal(parseDayParam(dayPeriod(P.earliestDay(NOW)).key, NOW)?.from, P.earliestDay(NOW), 'วันแรกของช่วงเปิดได้')
  assert.equal(parseDayParam(dayPeriod(P.addDays(P.earliestDay(NOW), -1)).key, NOW), null)
  assert.ok(DAY_OPTION_COUNT >= 730, 'ย้อนได้อย่างน้อย 2 ปีเท่าโหมดรายเดือน')
  assert.equal(lastFullDay(NOW).key, '2569-10-28', 'ค่าตั้งต้น = เมื่อวาน')
  assert.equal(lastFullDay(EARLY_OCT).key, '2569-09-30', 'เมื่อวานตามเวลาไทย')
})

test('ช่องเลือกวันที่ (ค.ศ.) → ค่าในลิงก์ (พ.ศ.) · ว่าง/อนาคตไม่เปลี่ยนหน้า', () => {
  assert.equal(dayParamFromInput('2026-10-01', NOW), '2569-10-01')
  assert.equal(dayParamFromInput('', NOW), null)
  assert.equal(dayParamFromInput('2026-10-30', NOW), null)
  assert.equal(dayParamFromInput('2569-10-01', NOW), null, 'ค่าที่เป็น พ.ศ. อยู่แล้วคือปีอนาคต')
})

test('รายสัปดาห์: จันทร์–อาทิตย์ · ข้ามเดือน/ข้ามปี · ต้องเป็นวันจันทร์', () => {
  assert.equal(mondayOf('2026-10-29'), '2026-10-26')
  assert.equal(mondayOf('2026-10-26'), '2026-10-26', 'วันจันทร์เป็นวันแรกของตัวเอง')
  assert.equal(mondayOf('2026-11-01'), '2026-10-26', 'วันอาทิตย์อยู่ท้ายสัปดาห์ ไม่ใช่หัวสัปดาห์ถัดไป')
  const week = parseWeekParam('2569-10-26', NOW)
  assert.deepEqual([week.from, week.to, week.label], ['2026-10-26', '2026-11-01', 'สัปดาห์ 26 ต.ค. – 1 พ.ย. 2569'])
  assert.equal(weekPeriod('2026-10-05').rangeText, '5 – 11 ต.ค. 2569', 'เดือนเดียวกันไม่พูดเดือนซ้ำ')
  assert.equal(weekPeriod('2025-12-29').rangeText, '29 ธ.ค. 2568 – 4 ม.ค. 2569', 'ข้ามปีบอกปีทั้งสองฝั่ง')
  assert.equal(parseWeekParam('2569-10-27', NOW), null, 'วันอังคารไม่ใช่หัวสัปดาห์')
  assert.equal(parseWeekParam('2569-11-02', NOW), null, 'สัปดาห์อนาคต')
  assert.equal(parseWeekParam('2569-02-30', NOW), null)
  const options = recentWeekOptions(WEEK_OPTION_COUNT, NOW)
  assert.equal(options.length, WEEK_OPTION_COUNT)
  assert.equal(options[0].key, '2569-10-26', 'เริ่มที่สัปดาห์ปัจจุบัน')
  assert.equal(options[1].key, '2569-10-19')
  assert.equal(new Set(options.map(o => o.key)).size, WEEK_OPTION_COUNT)
  assert.ok(options.every(o => parseWeekParam(o.key, NOW)?.key === o.key), 'ทุกตัวเลือกต้องเปิดผ่านลิงก์ได้')
  assert.equal(parseWeekParam(P.weekPeriod(P.addDays(options.at(-1).from, -7)).key, NOW), null, 'เก่ากว่าตัวเลือกสุดท้าย')
  assert.equal(lastFullWeek(NOW).key, '2569-10-19')
})

test('รายไตรมาส: ตามปีงบประมาณ · ไตรมาส 1 อยู่ปีปฏิทินก่อน · ข้ามปีงบ', () => {
  const q1 = quarterPeriod(2570, 1)
  assert.deepEqual([q1.from, q1.to, q1.key], ['2026-10-01', '2026-12-31', '2570-1'])
  assert.equal(q1.label, 'ไตรมาสที่ 1 ปีงบประมาณ 2570')
  assert.equal(q1.rangeText, '1 ต.ค. – 31 ธ.ค. 2569')
  assert.equal(q1.optionLabel, 'ไตรมาส 1/2570 (ต.ค.–ธ.ค. 2569)')
  assert.equal(quarterPeriod(2570, 2).optionLabel, 'ไตรมาส 2/2570 (ม.ค.–มี.ค. 2570)')
  assert.deepEqual([quarterPeriod(2569, 4).from, quarterPeriod(2569, 4).to], ['2026-07-01', '2026-09-30'])

  const options = recentQuarterOptions(QUARTER_OPTION_COUNT, NOW)
  assert.deepEqual(options.slice(0, 5).map(o => o.key), ['2570-1', '2569-4', '2569-3', '2569-2', '2569-1'])
  assert.equal(options.length, QUARTER_OPTION_COUNT)
  assert.equal(recentQuarterOptions(1, EARLY_OCT)[0].key, '2570-1', '1 ต.ค. เวลาไทย = ไตรมาส 1 ของปีงบใหม่แล้ว')
  assert.equal(recentQuarterOptions(1, new Date('2026-05-15T05:00:00Z'))[0].key, '2569-3')
  assert.equal(lastFullQuarter(NOW).key, '2569-4')
  for (const bad of ['2570-2', '2571-1', '2570-0', '2570-5', '2570', '2570-1-1', '', null]) {
    assert.equal(parseQuarterParam(bad, NOW), null, String(bad))
  }
  assert.equal(parseQuarterParam(options.at(-1).key, NOW)?.key, options.at(-1).key)
  assert.equal(parseQuarterParam('2568-1', NOW), null, 'เก่ากว่า 8 ไตรมาส')
})

test('ช่วงที่ยังไม่จบ (มีวันนี้อยู่ในช่วง)', () => {
  assert.equal(isCurrentPeriod(dayPeriod('2026-10-29'), NOW), true)
  assert.equal(isCurrentPeriod(dayPeriod('2026-10-28'), NOW), false)
  assert.equal(isCurrentPeriod(weekPeriod('2026-10-26'), NOW), true)
  assert.equal(isCurrentPeriod(quarterPeriod(2570, 1), NOW), true)
  assert.equal(isCurrentPeriod(quarterPeriod(2569, 4), NOW), false)
})

test('อ่านจากลิงก์: เลือกช่วงเดียว ค่าผิดตกเป็น null (หน้ากลับโหมดปีงบ)', () => {
  const from = query => name => new URLSearchParams(query).get(name)
  assert.deepEqual(PERIOD_PARAMS, { quarter: 'q', week: 'w', day: 'd' })
  assert.equal(parsePeriodParams(from('q=2570-1'), NOW)?.kind, 'quarter')
  assert.equal(parsePeriodParams(from('w=2569-10-19'), NOW)?.kind, 'week')
  assert.equal(parsePeriodParams(from('d=2569-10-28'), NOW)?.kind, 'day')
  assert.equal(parsePeriodParams(from('q=abc&d=2569-10-28'), NOW)?.kind, 'day', 'ค่าที่ผิดข้ามไปตัวถัดไป')
  assert.equal(parsePeriodParams(from('fy=2569'), NOW), null)
  assert.equal(parsePeriodParams(from('d=2570-01-01'), NOW), null)
})

test('ช่วงวันที่แบบย่อ', () => {
  assert.equal(thaiDateRange('2026-10-01', '2026-12-31'), '1 ต.ค. – 31 ธ.ค. 2569')
  assert.equal(thaiDateRange('2026-10-05', '2026-10-11'), '5 – 11 ต.ค. 2569')
})

test('กราฟสัปดาห์: 7 วันครบแม้เป็น 0 · นับวันตามเวลาไทย · ข้ามเรื่องนอกช่วง', () => {
  const rows = [
    { created_at: '2026-10-26T02:00:00Z' }, // จ. 26
    { created_at: '2026-10-26T16:59:00Z' }, // 23:59 จ. 26 เวลาไทย
    { created_at: '2026-10-26T17:00:00Z' }, // 00:00 อ. 27 เวลาไทย
    { created_at: '2026-11-01T10:00:00Z' }, // อา. 1
    { created_at: '2026-11-01T17:30:00Z' }, // จ. 2 เวลาไทย = นอกช่วง
    { created_at: '2026-10-25T16:00:00Z' }, // 23:00 อา. 25 = สัปดาห์ก่อน
  ]
  const trend = periodTrend(weekPeriod('2026-10-26'), rows)
  assert.deepEqual(trend.map(b => b.label), ['จ. 26', 'อ. 27', 'พ. 28', 'พฤ. 29', 'ศ. 30', 'ส. 31', 'อา. 1'])
  assert.deepEqual(trend.map(b => b.count), [2, 1, 0, 0, 0, 0, 1])
})

test('กราฟไตรมาส: รายสัปดาห์ครอบคลุมทั้งไตรมาส · ป้ายสัปดาห์แรกเป็นวันแรกของไตรมาส · ผลรวมเท่าจำนวนเรื่อง', () => {
  const quarter = quarterPeriod(2570, 1) // 1 ต.ค. 2569 = วันพฤหัสบดี
  const rows = [
    { created_at: '2026-10-01T03:00:00Z' },
    { created_at: '2026-10-04T03:00:00Z' }, // อา. 4 ยังอยู่สัปดาห์แรก
    { created_at: '2026-10-05T03:00:00Z' },
    { created_at: '2026-12-31T16:00:00Z' }, // 23:00 31 ธ.ค. เวลาไทย
    { created_at: '2026-12-31T17:00:00Z' }, // 1 ม.ค. เวลาไทย = นอกช่วง
    { created_at: '2026-09-30T16:30:00Z' }, // 23:30 30 ก.ย. = นอกช่วง
  ]
  const trend = periodTrend(quarter, rows)
  assert.equal(trend[0].label, '1 ต.ค.', 'ไม่ใช่ 28 ก.ย. ที่อยู่ก่อนไตรมาส')
  assert.equal(trend[1].label, '5 ต.ค.')
  assert.equal(trend.at(-1).label, '28 ธ.ค.')
  assert.equal(trend.length, 14)
  assert.deepEqual([trend[0].count, trend[1].count, trend.at(-1).count], [2, 1, 1])
  assert.equal(trend.reduce((sum, b) => sum + b.count, 0), 4)
})

test('รายวันไม่มีกราฟ (จุดเดียว)', () => {
  assert.equal(periodTrend(dayPeriod('2026-10-28'), []), null)
})

const page = await readFile(new URL('../src/pages/ComplaintStats.jsx', import.meta.url), 'utf8')

test('หน้า ComplaintStats: แถบเลือกครบ 5 ช่วง ปีงบประมาณมาก่อน (ค่าตั้งต้น ITA) · ช่วงใหม่ส่งเข้า RPC ชุด _fy เดิม', () => {
  const labels = ['ปีงบประมาณ', 'ไตรมาส', 'รายเดือน', 'รายสัปดาห์', 'รายวัน']
  const at = labels.map(label => page.indexOf(`{ label: '${label}'`))
  assert.ok(at.every(i => i > 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'เรียงตามขนาดช่วง')
  assert.ok(page.includes(': selectedPeriod ? { from: selectedPeriod.from, to: selectedPeriod.to }'))
  // ล็อกตัวเลขยังผูกกับ selectedMonth เท่านั้น · ภาพ PNG / ข้อความสรุป / ใบ A4 ใช้ได้ทุกช่วงยกเว้นปีงบ
  assert.ok(page.includes('...(selectedMonth && !isCurrentMonth(selectedMonth) ? [supabase.rpc('))
  assert.ok(page.includes('const showLockPanel = !!selectedMonth &&'))
  // ปีงบประมาณมีสรุปด้วย ("ทุกปีงบประมาณ" ไม่มี เพราะ fiscalRange เป็น null)
  assert.ok(page.includes('() => selectedMonth ?? selectedPeriod ?? (fiscalRange ? fiscalYearPeriod(fiscalYear) : null)'))
  assert.ok(page.includes('onClick={summaryPeriod ? printMonthly : () => window.print()}'))
  // ปุ่ม "พิมพ์หน้านี้" (พิมพ์ทั้งหน้าเว็บ) คู่กับปุ่มใบสรุป A4 เฉพาะโหมดที่มีใบสรุป — "ทุกปีงบประมาณ" มีปุ่มพิมพ์ปุ่มเดียวอยู่แล้ว
  const sheetButton = page.indexOf('onClick={summaryPeriod ? printMonthly')
  const buttonText = '<Printer size={15} /> พิมพ์หน้านี้' // ข้อความในปุ่มจริง ไม่ใช่คำในคอมเมนต์
  const pageButton = page.indexOf(buttonText)
  assert.ok(sheetButton > 0 && pageButton > sheetButton, 'ปุ่มพิมพ์หน้านี้ต้องอยู่หลังปุ่มใบสรุป')
  assert.ok(/\{summaryPeriod && \(\s*<button\s+onClick=\{\(\) => window\.print\(\)\}/.test(page), 'ต้องเรียก window.print() และแสดงเฉพาะเมื่อมี summaryPeriod')
  assert.equal(page.split(buttonText).length - 1, 1, 'ต้องมีปุ่มเดียว')
  assert.ok(page.includes("...(summaryPeriod ? [supabase.rpc('complaint_issue_breakdown_fy'"))
})

test('สรุป/ภาพ/ใบ A4 ของวัน สัปดาห์ ไตรมาส: ถ้อยคำของช่วงนั้น ไม่มีคำว่าเดือนหลุด · รายเดือนคงถ้อยคำเดิม', () => {
  const stats = { total: 6, open: 1, in_progress: 1, resolved: 4, rejected: 0 }
  const rows = [...Array(4)].map(() => ({ category: 'light' })).concat([{ category: 'road' }, { category: 'road' }])
  const labelOf = code => ({ light: 'ไฟฟ้าสาธารณะ', road: 'ถนน' })[code]
  const run = period => summarizeMonth({ stats, rows, labelOf, tenantName: 'เทศบาลตำบลสาธิต', period, now: NOW })

  const quarter = run(quarterPeriod(2569, 4))
  assert.equal(quarter.periodTitle, 'ไตรมาสที่ 4 ปีงบประมาณ 2569')
  assert.equal(quarter.periodNoun, 'ไตรมาส')
  assert.ok(quarter.sentences[0].startsWith('ในไตรมาสที่ 4 ปีงบประมาณ 2569 เทศบาลตำบลสาธิตรับเรื่อง'))
  assert.ok(quarter.notes[0].includes('ของเรื่องที่รับในไตรมาสนี้'))
  assert.equal(quarter.isCurrentMonth, false)

  const week = run(weekPeriod('2026-10-26')) // สัปดาห์ปัจจุบัน
  assert.ok(week.sentences[0].startsWith('ในสัปดาห์ 26 ต.ค. – 1 พ.ย. 2569 '))
  assert.equal(week.isCurrentMonth, true)
  assert.ok(week.notes.includes('สัปดาห์นี้ยังไม่สิ้นสุด ตัวเลขเป็นยอดสะสมจนถึงวันที่ข้างต้น'))

  const pastDay = run(dayPeriod('2026-10-28'))
  assert.ok(pastDay.notes[0].includes('ของเรื่องที่รับในวันดังกล่าว'), 'วันที่ผ่านไปแล้วต้องไม่เรียกว่า "วันนี้"')
  assert.equal(pastDay.isCurrentMonth, false)
  const today = run(dayPeriod('2026-10-29'))
  assert.ok(today.notes.includes('วันนี้ยังไม่สิ้นสุด ตัวเลขเป็นยอดสะสมจนถึงวันที่ข้างต้น'))

  const fiscal = run(fiscalYearPeriod(2570)) // ปีงบปัจจุบัน
  assert.deepEqual([fiscalYearPeriod(2570).from, fiscalYearPeriod(2570).to], ['2026-10-01', '2027-09-30'])
  assert.equal(fiscal.periodTitle, 'ปีงบประมาณ พ.ศ. 2570', 'ต้องตรงกับหัวหน้า (fiscalPeriodParts) ทุกตัวอักษร')
  assert.ok(fiscal.sentences[0].startsWith('ในปีงบประมาณ พ.ศ. 2570 '))
  assert.ok(fiscal.notes.includes('ปีงบประมาณนี้ยังไม่สิ้นสุด ตัวเลขเป็นยอดสะสมจนถึงวันที่ข้างต้น'))
  assert.equal(run(fiscalYearPeriod(2569)).isCurrentMonth, false)
  assert.deepEqual([fiscalYearPeriod(2569).from, fiscalYearPeriod(2569).to], ['2025-10-01', '2026-09-30'])

  for (const summary of [quarter, week, pastDay, today, fiscal]) {
    const words = [...summary.sentences, ...summary.notes].join(' ')
    assert.ok(!words.includes('เดือน'), `คำว่าเดือนหลุด: ${words}`)
    const html = buildComplaintMonthlyHtml({ tenant: { name: 'เทศบาลตำบลสาธิต' }, summary })
    assert.ok(html.includes(`สรุปเรื่องร้องเรียน/ร้องทุกข์ประจำ${summary.periodTitle}`))
    assert.ok(!html.includes('ประจำเดือน'))
  }

  const month = run(monthPeriod(2569, 9))
  assert.equal(month.periodTitle, 'เดือนกันยายน 2569')
  assert.ok(month.sentences[0].startsWith('ในเดือนกันยายน 2569 '))
  assert.ok(month.notes[0].includes('ของเรื่องที่รับในเดือนนี้'))
  assert.ok(buildComplaintMonthlyHtml({ tenant: { name: 'x' }, summary: month }).includes('สรุปเรื่องร้องเรียน/ร้องทุกข์ประจำเดือนกันยายน 2569'))
})

test('หน้า ComplaintStats: เปลี่ยนช่วงล้างค่าช่วงอื่นในลิงก์ทุกครั้ง (ลิงก์มีช่วงเดียว)', () => {
  assert.ok(page.includes("['m', ...Object.values(PERIOD_PARAMS)].forEach(param => params.delete(param))"))
  assert.ok(!page.includes('setMonthParam'), 'ตัวเดิมที่ลบแค่ m ต้องไม่เหลือ')
})

console.log(`\n${cases} cases passed`)
