// ข้อมูลตัวอย่างของใบรายงานผลการก่อสร้างประจำสัปดาห์ (ใช้ร่วมเทสต์ใบพิมพ์ + เลย์เอาต์) — ตัวเลขหลักคือเคสทองคำจากไฟล์ต้นแบบ
// (จริง 8.40% · แผน 10.25% · ช้า 1.9%) สัปดาห์ที่ 1 ช่วง 1–7 ส.ค. 2569
import { buildReportSheet, freezeSheet } from '../../src/lib/constructionReport.js'

export const TENANT = { name: 'องค์การบริหารส่วนตำบลทดสอบ' }
export const PRINTED_AT = new Date(2026, 7, 8, 9, 30)
export const CONTRACT_DATES = { start_date: '2026-08-01', end_date: '2026-11-28', extended_until: null }

const NAMES = [
  'งานเตรียมพื้นที่และงานดินตัด/ถม', 'งานชั้นรองพื้นทาง (Subbase)', 'งานชั้นพื้นทาง (Base Course)',
  'งานผิวทางคอนกรีตเสริมเหล็ก (คสล.)', 'งานผิวทางลาดยาง (Asphalt)', 'งานไหล่ทาง รางระบายน้ำ และเครื่องหมายจราจร',
]
const WEIGHTS = [15, 15, 15, 30, 15, 10]
const BASE = [15, 10, 5, 0, 0, 0]
const WEEK = [0, 5, 5, 8, 0, 0]
const PLAN = [15, 15, 12, 10, 5, 2]

export function fixture({ extraItems = 0, crewRows = 3, logRows = 3, long = false, final = true, withPeople = true, dayCount = 7, evil = '' } = {}) {
  const items = NAMES.map((name, i) => ({
    id: `i${i}`, name: long ? `${name} ${'ต่อเนื่องหลายช่วงถนนสายหลักและสายรอง '.repeat(2)}` : name,
    weight_pct: WEIGHTS[i], sort_order: i + 1, plan_start: null, plan_end: null,
  }))
  // รายการเสริมให้ตารางไหลหลายหน้า — แบ่งสัดส่วนจากรายการแรกให้รวมยังเป็น 100
  for (let n = 0; n < extraItems; n++) {
    items.push({ id: `x${n}`, name: `รายการเสริมที่ ${n + 1}`, weight_pct: 0, sort_order: 100 + n, plan_start: null, plan_end: null })
  }
  const progress = Object.fromEntries(items.map((item, i) => [item.id, { base: BASE[i] ?? 0, week: WEEK[i] ?? 0, plan: PLAN[i] ?? 0 }]))
  const day = n => new Date(Date.parse('2026-08-01T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
  const dates = Array.from({ length: dayCount }, (_, i) => day(i))
  const name = text => `${text}${evil}`
  const report = {
    id: 'r1', project_id: 'p1', week_no: 1, report_no: null, status: final ? 'final' : 'draft',
    period_start: dates[0], period_end: dates[dates.length - 1],
    memo_no: name('มท 0123/45'), memo_date: '2026-08-08', memo_to: name('ผู้อำนวยการกองช่าง'),
    progress,
    crew: Array.from({ length: crewRows }, (_, i) => ({ name: name(`ช่างกลุ่มที่ ${i + 1}`), days: dates.map((_, d) => (d % 7) + 1) })),
    machinery: [{ name: name('รถบดถนน (Road Roller)'), days: dates.map(() => 1) }],
    weather: Object.fromEntries(dates.map((d, i) => [d, i % 3 === 2 ? ['clear', 'light'] : ['clear']])),
    daily_log: Array.from({ length: logRows }, (_, i) => ({
      date: i === 0 ? dates[0] : (i % 2 ? '' : dates[Math.min(i, dayCount - 1)]),
      detail: name(`ผู้รับจ้างดำเนินการงานชั้นพื้นทาง กม.0+${i}00 ${long ? 'รายละเอียดยาวมากต่อเนื่องหลายบรรทัด '.repeat(6) : ''}`), note: i ? '-' : name('หมายเหตุ'),
    })),
    issues: { problems: name('ฝนตกช่วงบ่าย'), solution: name('เลื่อนงานเทคอนกรีต'), other: '' },
    finance: { advance_amount: 150000, advance_pct: 15, budget_rows: [{ year: '2570', installments_total: 4, inspected: 0, paid: 0, remaining: 4 }] },
    frozen: null,
  }
  const project = {
    id: 'p1', title: name('ถนน คสล. สายบ้านหนองทดสอบ หมู่ 3'), project_no: '69-001', project_type: 'road',
    location_desc: name('ซอยข้างวัด หมู่ 3 ต.ทดสอบ'), contract_no: '12/2569', contractor_name: name('ห้างหุ้นส่วนจำกัดทดสอบก่อสร้าง'),
    contract_amount: 1250000, start_date: CONTRACT_DATES.start_date, end_date: CONTRACT_DATES.end_date,
  }
  const contract = {
    contract_date: '2026-07-28', extended_until: null, fine_per_day: 1250, installments_total: 4, designer_name: name('กองช่าง อปท.ทดสอบ'),
    attach_no: '3', attach_date: '2026-07-28',
    spec: { road_type: 'คสล. และลาดยาง', length_km: 1.25, width_m: 5, sections: [{ name: 'กม.0+000–0+500', length_km: 0.5, surface: 'คสล.' }, { name: 'กม.0+500–1+250', length_km: 0.75, surface: 'ลาดยาง' }] },
  }
  const person = (grp, i, duty, position, nameText) => ({ grp, sort_order: i, name: nameText ? name(nameText) : '', position_title: position, duty })
  const people = withPeople ? [
    person('committee', 1, 'ประธานกรรมการ', 'ปลัด อบต.', 'นายประธาน ตรวจการ'),
    person('committee', 2, 'กรรมการ', 'หัวหน้าส่วนการคลัง', 'นางสาวกรรมการ สอง'),
    person('supervisor', 1, 'หัวหน้าผู้ควบคุมงาน', 'นายช่างโยธาชำนาญงาน', 'นายหัวหน้า ควบคุมงาน'),
    person('supervisor', 2, 'ผู้ควบคุมงานด้านงานทาง', 'นายช่างโยธา', 'นายสอง ควบคุมงาน'),
    person('supervisor', 3, 'ผู้ควบคุมงานด้านงานดิน', 'ผู้ช่วยช่างโยธา', 'นายสาม ควบคุมงาน'),
    person('contractor_rep', 1, 'ผู้จัดการโครงการ', 'วิศวกรโยธา', 'นายผู้แทน ผู้รับจ้าง'),
  ] : []
  const sheet = buildReportSheet({ items, reports: [report], report, contract: { ...CONTRACT_DATES, extended_until: null } })
  if (final) report.frozen = freezeSheet(sheet)
  return { tenant: TENANT, project, contract, people, report, sheet, items, departmentName: 'กองช่าง', emblemUrl: 'https://example.test/images/garuda.svg', printedAt: PRINTED_AT }
}

// รูปแบบเดียวกับที่ fetchBundle() คืนจากฐานข้อมูล (มีรหัสแถวของรายการงาน/บุคคล) — ใช้เทสต์หน้าจอ
export function bundleOf(f = fixture()) {
  return {
    projectId: f.project.id,
    contract: { project_id: f.project.id, ...f.contract },
    items: f.items.map(item => ({ ...item, project_id: f.project.id })),
    people: f.people.map((p, i) => ({ id: `person-${i}`, project_id: f.project.id, profile_id: null, ...p })),
    reports: [f.report],
  }
}
