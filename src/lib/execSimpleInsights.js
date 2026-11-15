// "ข้อมูลเชิงรุก" ของห้องผู้บริหารแบบเรียบ — ภัยที่กำลังมา · ปัญหาซ้ำซาก · กำหนดตามระเบียบ · สรุปวันนี้ (ไม่เกิน 3 บรรทัด)
// ฟังก์ชันบริสุทธิ์ล้วน (ไม่ import React/supabase เทสต์ด้วย node ได้) · เทสต์: npm run test:exec-insights
//
// หลักที่ห้ามผิด
//   - ไม่ใช้ AI/LLM — ทุกข้อความมาจาก "กฎ" ตายตัวที่อธิบายและตรวจย้อนได้ · ทุก insight มี `rule` ภาษาคน (ขึ้นเป็นปุ่ม "วิธีคิด" ให้ สตง./ป.ป.ช. ตรวจ)
//   - ค่าอ่านไม่ได้/ข้อมูลเก่า = null (ไม่ขึ้นแถว) ห้ามอ้างว่า "ไม่มีเรื่อง" จากข้อมูลที่ไม่ครบ
//   - ไม่มีชื่อผู้ร้อง/ข้อความอิสระ (PDPA) — มีแต่ตัวเลข ชื่อหมวด ชื่อหมู่ ชื่อสถานีตรวจวัด
//   - เตือนเท่านั้น ไม่ใช่คำสั่ง · ไม่มีปุ่มอนุมัติ · ไม่สร้างงานให้เจ้าหน้าที่
//
// รูปเดียวกันของทุก insight:
//   { id, kind: 'hazard'|'deadline'|'pattern', tone: 'red'|'amber', what, count, unit, showCount, detail, rule,
//     target: { module?, path? }, words: { what, unit, go } }
//   + ฟิลด์เสริม (เพิ่มเฉพาะบางชนิด): brief (ข้อความบรรทัด "สรุปวันนี้") · hint (ข้อความแนะนำใต้แถว) · daysLeft (ไว้เรียงลำดับกำหนดการ)

import { nextHeavyRainDay } from './tmdForecast.js'
import { PM25_LEVELS, formatMeasuredAt, isFresh, nearbyStations, pm25Level } from './pm25.js'
import { daysBetween, devPlanAmendWindow, opPlanDeadline, warningText, CLOSING_DAYS, OP_PLAN_DAYS, PLAN_AMEND_MIN_DAYS, SOON_DAYS } from './localPlanDeadlines.js'
import { EVALUATION_ANNOUNCE_DAYS, EVALUATION_SOON_DAYS, evaluationDeadlines, evaluationWarningText } from './localPlanProgress.js'
import { fiscalYearBounds } from './fiscalYear.js'
import { fiscalYearOfIso } from './localPlanView.js'
import { thaiShortDate } from './complaintReportPeriods.js'
import { execNf } from './executiveData.js'
import { EXEC_SIMPLE_MAJOR_ALERTS, EXEC_SIMPLE_MAX_MAJOR, simpleAlertWords } from './execSimpleView.js'

/** ชื่อหมวดของข้อมูลเชิงรุก (ใช้แทนชื่อเมนูในทะเบียน ตอนขึ้นเป็น "เรื่องเล็ก") */
export const EXEC_INSIGHT_KIND_LABELS = Object.freeze({ hazard: 'ภัยที่กำลังมา', deadline: 'กำหนดตามระเบียบ', pattern: 'ปัญหาซ้ำซาก' })

/** ป้ายหมวดของแถวใน ② — สัญญาณเตือนจากทะเบียน = ชื่อเมนู · ข้อมูลเชิงรุก = ชื่อหมวดข้างบน · ไม่มี = null */
export const execKnowLabel = (item) => item?.entry?.label ?? EXEC_INSIGHT_KIND_LABELS[item?.kind] ?? null

const FOLLOW_UP = 'เตือนเท่านั้น ไม่บล็อก · ต้องยืนยันกับระเบียบฉบับปัจจุบัน'
const toMs = (now) => (now instanceof Date ? now.getTime() : Number(now))
const round1 = (n) => Math.round(n * 10) / 10
// ตัวเลขทศนิยม 1 ตำแหน่งแบบไทย — 42.5 · 40 (ไม่เติม .0)
const nf1 = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 1 })

// ───────────────────────── ภัยที่กำลังมา ─────────────────────────

/** เกณฑ์ฝนหนัก (> 35 มม./24 ชม.) อ้างจาก RAIN_LEVELS ผ่าน nextHeavyRainDay — ไม่เขียนเกณฑ์ซ้ำที่นี่ */
export const HEAVY_RAIN_RULE = 'พยากรณ์ฝนรายวันของกรมอุตุนิยมวิทยา (จุดกริดของ อปท.) เกิน 35 มม./24 ชม. ในวันนี้ถึงอีก 2 วัน — เกณฑ์เดียวกับแจ้งเตือน Telegram · ข้อมูลเก่ากว่า 12 ชม. ไม่แสดง'

/**
 * พยากรณ์ฝนหนักใน 3 วัน (วันนี้ + 2 วัน) — กฎเดียวกับป้ายหน้าน้ำ (#732) และแจ้ง Telegram ของ tmd-sync
 * @param {object|null} forecast  ผล normalizeForecast (src/lib/tmdForecast.js)
 * @param {Date|number} now
 * @returns {object|null} null = ไม่มีฝนหนักในช่วงนี้ / ไม่มีพยากรณ์ / พยากรณ์เก่าเกิน 12 ชม. (ไม่พูดถึงข้อมูลที่ไม่เป็นปัจจุบัน)
 */
export function heavyRainInsight(forecast, now = new Date()) {
  const next = nextHeavyRainDay(forecast, now)
  if (!next || !Number.isFinite(next.mm)) return null
  const mm = round1(next.mm)
  const what = `พยากรณ์ฝนหนัก${next.when}`
  return {
    id: 'hazard:heavy_rain',
    kind: 'hazard',
    tone: next.level?.key === 'veryHeavy' ? 'red' : 'amber',
    what,
    count: mm,
    unit: 'มม.',
    showCount: true,
    detail: 'ที่มา: กรมอุตุนิยมวิทยา · เป็นพยากรณ์ ยังไม่ใช่เหตุที่เกิดแล้ว',
    rule: HEAVY_RAIN_RULE,
    brief: `${next.when} พยากรณ์ฝนหนัก ${nf1(mm)} มม. — ควรเตรียมรับมือ`,
    target: { path: '/water-situation' },
    words: { what, unit: 'มม.', go: 'ดูพยากรณ์และสถานการณ์น้ำ' },
  }
}

export const PM25_RULE = 'ค่า PM2.5 เฉลี่ย 24 ชม. จาก Air4Thai (กรมควบคุมมลพิษ) สถานีใกล้ อปท. ที่วัดภายใน 3 ชม. เกิน 37.5 มคก./ลบ.ม. (เกณฑ์สีส้ม "เริ่มมีผลกระทบต่อสุขภาพ")'

/**
 * ฝุ่น PM2.5 — สถานีแรกตามระยะที่มีค่าและวัดภายใน 3 ชม. (ตรรกะเลือกเดียวกับหน้า PM2.5 ของประชาชน)
 * ไม่มีสถานีที่ข้อมูลสด = null (ไม่เตือนจากค่าเก่า) · ขึ้นเมื่อ > 37.5 เท่านั้น · > 75 = แดง
 * @param {{ stations?: object[] }|null} feed  ผล /api/air-quality
 * @param {object|null} tenant  ต้องมี province / latitude / longitude (nearbyStations ใช้)
 */
export function pm25Insight(feed, tenant, now = new Date()) {
  const nowMs = toMs(now)
  const area = nearbyStations(Array.isArray(feed?.stations) ? feed.stations : [], tenant)
  const station = area.stations.find((s) => s.pm25 !== null && isFresh(s, nowMs))
  if (!station) return null
  const orangeFrom = PM25_LEVELS[2].max // 37.5 — ขอบบนของ "ปานกลาง"
  const redFrom = PM25_LEVELS[3].max // 75 — ขอบบนของ "เริ่มมีผลกระทบต่อสุขภาพ"
  if (!(station.pm25 > orangeFrom)) return null
  const level = pm25Level(station.pm25)
  if (!level) return null
  const value = round1(station.pm25)
  const what = `ฝุ่น PM2.5 ${level.label}`
  return {
    id: 'hazard:pm25',
    kind: 'hazard',
    tone: station.pm25 > redFrom ? 'red' : 'amber',
    what,
    count: value,
    unit: 'มคก./ลบ.ม.',
    showCount: true,
    detail: `สถานี ${station.name} · ค่าเฉลี่ย 24 ชม. · วัดเมื่อ ${formatMeasuredAt(station.measuredAt)}`,
    rule: PM25_RULE,
    brief: `${what} ${nf1(value)} มคก./ลบ.ม. — ควรเฝ้าระวัง`,
    target: { path: '/pm25' },
    words: { what, unit: 'มคก./ลบ.ม.', go: 'ดูสถานการณ์ PM2.5' },
  }
}

// ───────────────────────── ปัญหาซ้ำซาก ─────────────────────────

/** ข้อความแนะนำใต้แถว (ไม่ใช่คำสั่ง — ผู้บริหารตัดสินเอง ระบบไม่สร้างโครงการให้) */
export const REPEAT_HINT = 'แจ้งซ้ำหลายครั้ง อาจควรพิจารณาแก้ถาวร เช่น ตั้งเป็นโครงการ'

/**
 * ปัญหาซ้ำซากรายหมู่บ้าน — ใช้ผลที่ฐานคำนวณให้แล้ว (executive_overview.complaints.repeat · ไม่มี SQL ใหม่)
 * @param {{ repeat?: { days: number, min: number, groups: Array<{ label: string, village: string, n: number }> } }|null} complaints  ผล normalizeComplaintsSummary
 */
export function repeatInsight(complaints) {
  const repeat = complaints?.repeat
  const groups = Array.isArray(repeat?.groups) ? repeat.groups.filter((g) => g && g.n > 0) : []
  if (groups.length === 0) return null
  const days = repeat.days
  const min = repeat.min
  const what = `ปัญหาเดิมเกิดซ้ำในหมู่บ้านเดียวกัน (${days} วัน)`
  const top = groups.slice(0, 3).map((g) => `${g.village} · ${g.label} ${execNf(g.n)} เรื่อง`)
  return {
    id: 'pattern:repeat',
    kind: 'pattern',
    tone: 'amber',
    what,
    count: groups.length,
    unit: 'จุด',
    showCount: true,
    detail: top.join(' · '),
    hint: REPEAT_HINT,
    rule: `คำร้องหมวดเดียวกันในหมู่บ้านเดียวกัน ตั้งแต่ ${min} เรื่องขึ้นไปใน ${days} วันล่าสุด (ไม่นับเรื่องที่ปฏิเสธ หมวดเฉพาะกิจ และหมวดที่ต้องรับเรื่องเอง/อ่อนไหว) · ชื่อหมู่บ้านนับเฉพาะที่เป็นเลขหมู่หรือตรงกับทะเบียนสถานที่ · ระบบแค่ชี้ ผู้บริหารตัดสินเอง`,
    target: { module: 'complaints' },
    words: { what, unit: 'จุด', go: 'ดูคำร้อง' },
  }
}

// ───────────────────────── กำหนดตามระเบียบ (แผนพัฒนาท้องถิ่น) ─────────────────────────

/** ติดตามและประเมินผลแผนพัฒนา: เริ่มเตือนเมื่อเหลือไม่เกินกี่วัน / เลิกเตือนเมื่อเลยกำหนดเกินกี่วัน (เตือนค้างทั้งปีไม่มีประโยชน์) */
export const EVAL_REPORT_WARN_DAYS = 60
export const EVAL_REPORT_GIVE_UP_DAYS = 90

const PLAN_GO = 'ดูแผนพัฒนา'
const deadlineInsight = ({ id, tone, what, daysLeft, rule }) => ({
  id: `deadline:${id}`,
  kind: 'deadline',
  tone,
  what,
  count: daysLeft,
  unit: 'วัน',
  showCount: false, // ข้อความหัวแถวบอกจำนวนวันอยู่แล้ว
  detail: null,
  rule,
  daysLeft,
  target: { module: 'local-plan' },
  words: { what, unit: '', go: PLAN_GO },
})

const OP_PLAN_RULE = `ระเบียบ มท. ว่าด้วยการจัดทำแผนพัฒนาขององค์กรปกครองส่วนท้องถิ่น ข้อ 27: จัดทำแผนการดำเนินงานให้แล้วเสร็จภายใน ${OP_PLAN_DAYS} วันนับแต่วันตั้งต้น (เช่น วันประกาศใช้ข้อบัญญัติ/เทศบัญญัติงบประมาณ) · ระบบนับวันปฏิทิน ไม่นับวันตั้งต้น · ขึ้นเมื่อเหลือไม่เกิน ${SOON_DAYS} วัน ครบกำหนดวันนี้ หรือเลยกำหนดโดยยังไม่ประกาศ · ${FOLLOW_UP}`
const DEV_AMEND_RULE = `ระเบียบ มท. ว่าด้วยการจัดทำแผนพัฒนาขององค์กรปกครองส่วนท้องถิ่น ข้อ 22: แผนพัฒนาเหลืออายุไม่ถึง ${PLAN_AMEND_MIN_DAYS} วัน ห้ามเพิ่มเติม/เปลี่ยนแปลง · ระบบถือว่าแผนสิ้นอายุ 30 ก.ย. ของปีสุดท้ายของแผน · ขึ้นเมื่อเหลือไม่เกิน ${CLOSING_DAYS} วันก่อนถึงวันสุดท้ายที่แก้ได้ · ${FOLLOW_UP}`
const EVAL_ANNOUNCE_RULE = `ระเบียบ มท. ว่าด้วยการจัดทำแผนพัฒนาขององค์กรปกครองส่วนท้องถิ่น (ฉบับที่ 3) ข้อ 29(3): ประกาศผลการติดตามและประเมินผลภายใน ${EVALUATION_ANNOUNCE_DAYS} วันนับแต่วันที่ผู้บริหารเสนอสภา/คณะกรรมการพัฒนา · ระบบนับวันปฏิทิน ไม่นับวันเสนอ · ขึ้นเมื่อเหลือไม่เกิน ${EVALUATION_SOON_DAYS} วัน ครบกำหนดวันนี้ หรือเลยกำหนดโดยยังไม่ประกาศ · ${FOLLOW_UP}`
const EVAL_REPORT_RULE = `ระเบียบ มท. ว่าด้วยการจัดทำแผนพัฒนาขององค์กรปกครองส่วนท้องถิ่น (ฉบับที่ 3) พ.ศ. 2561 ข้อ 29(3) / 30(5): ติดตามและประเมินผลอย่างน้อยปีละ 1 ครั้ง ภายในเดือนธันวาคม · ระบบถือว่าปีที่ประเมินคือปีงบที่เพิ่งจบ กำหนดคือ 31 ธ.ค. หลังปีงบนั้นสิ้นสุด และ "ทำแล้ว" เมื่อมีวันที่คณะกรรมการรายงานผู้บริหาร · ขึ้นเมื่อเหลือไม่เกิน ${EVAL_REPORT_WARN_DAYS} วัน หรือเลยกำหนดไม่เกิน ${EVAL_REPORT_GIVE_UP_DAYS} วัน (หลังนั้นเลิกเตือน) · ${FOLLOW_UP}`

/**
 * ติดตามและประเมินผลประจำปี — ขึ้นเมื่อเหลือ ≤ 60 วัน หรือเลยกำหนดไม่เกิน 90 วัน และยังไม่มีวันที่รายงาน/เสนอ
 * ⚠️ ตัวบท (ข้อ 29(3) / 30(5) ระเบียบ มท. ว่าด้วยการจัดทำแผนพัฒนา อปท. (ฉบับที่ 3) พ.ศ. 2561) อ่านจากสำเนาที่ อปท. เผยแพร่
 *    ยังไม่ได้เทียบราชกิจจานุเบกษา — ต้องยืนยันกับฉบับปัจจุบัน
 * สมมติฐาน: ปีที่ประเมิน = ปีงบที่เพิ่งจบ (ปีงบปัจจุบัน − 1) · "ทำแล้ว" = ปีนั้นมีแถวประเมินที่มี reported_to_exec_on หรือ presented_on
 * @returns {object|null}
 */
function evalReportInsight(evaluation, today) {
  const fy = fiscalYearOfIso(today) - 1
  const done = evaluation?.fiscal_year === fy && Boolean(evaluation?.reported_to_exec_on || evaluation?.presented_on)
  if (done) return null
  const dueOn = `${fiscalYearBounds(fy).endCE}-12-31`
  const daysLeft = daysBetween(today, dueOn)
  if (daysLeft > EVAL_REPORT_WARN_DAYS || daysLeft < -EVAL_REPORT_GIVE_UP_DAYS) return null
  const by = `ภายใน ${thaiShortDate(dueOn)}`
  const lead = `ติดตามและประเมินผลแผนพัฒนา ปีงบ ${fy}`
  let what
  if (daysLeft > 0) what = `${lead} — เหลือ ${daysLeft} วัน (${by})`
  else if (daysLeft === 0) what = `${lead} — ครบกำหนดวันนี้ (${by})`
  else what = `${lead} — เลยกำหนดมา ${-daysLeft} วัน (${by})`
  return deadlineInsight({ id: 'eval_report', tone: daysLeft < 0 ? 'red' : 'amber', what, daysLeft, rule: EVAL_REPORT_RULE })
}

/**
 * นับถอยหลังกำหนดตามระเบียบของแผนพัฒนา — ใช้สูตรของเมนูแผนพัฒนาเดิมทั้งหมด (localPlanDeadlines / localPlanProgress) ไม่มีสูตรใหม่ยกเว้นข้อ 29(3)/30(5)
 * เรียง: เลยกำหนดก่อน แล้ววันใกล้สุดก่อน · อินพุตไม่มี (null/undefined) = ไม่คืนตัวนั้น (ไม่เดา)
 *   evaluation: undefined = ยังไม่รู้ (ไม่คืนตัว eval_report) · null = อ่านแล้วไม่มีแถวของปีงบที่ประเมิน (= ยังไม่ทำ)
 *   ตัว eval_report ต้องมี devPlan (อปท. ที่ใช้เมนูแผนพัฒนาจริง) ไม่งั้นเตือนอปท. ที่ไม่ได้ใช้เมนูนี้
 * @param {{ devPlan?: object|null, opPlan?: object|null, evaluation?: object|null, today: string }} input  today = YYYY-MM-DD เวลาไทย
 */
export function planDeadlineInsights({ devPlan, opPlan, evaluation, today }) {
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return []
  const out = []

  if (opPlan) {
    const r = opPlanDeadline(opPlan, today)
    if (r.state === 'soon' || r.state === 'due_today' || r.state === 'overdue') {
      out.push(deadlineInsight({ id: 'op_plan', tone: r.state === 'overdue' ? 'red' : 'amber', what: warningText(r), daysLeft: r.daysLeft, rule: OP_PLAN_RULE }))
    }
  }

  if (devPlan) {
    const r = devPlanAmendWindow(devPlan, today)
    if (r && r.state === 'closing') {
      out.push(deadlineInsight({ id: 'dev_amend', tone: 'amber', what: warningText(r), daysLeft: r.daysToCutoff, rule: DEV_AMEND_RULE }))
    }
  }

  if (evaluation) {
    const r = evaluationDeadlines(evaluation, today)
    if (r.state === 'soon' || r.state === 'due_today' || r.state === 'overdue') {
      out.push(deadlineInsight({ id: 'eval_announce', tone: r.state === 'overdue' ? 'red' : 'amber', what: evaluationWarningText(r), daysLeft: r.daysLeft, rule: EVAL_ANNOUNCE_RULE }))
    }
  }

  if (devPlan && evaluation !== undefined) {
    const r = evalReportInsight(evaluation, today)
    if (r) out.push(r)
  }

  return out.filter((it) => it.what).sort((a, b) => a.daysLeft - b.daysLeft)
}

// ───────────────────────── จัดลำดับหัวข้อ ② ─────────────────────────

const WATER_EVENT_ALERT_ID = 'water-situation:event_open'
const NO_PUBLISHED_PLAN_ID = 'local-plan:no_published_plan'
const OP_PLAN_DEADLINE_ID = 'deadline:op_plan'

/**
 * จัดลำดับหัวข้อ ② "เรื่องที่ควรรู้"
 *   hazards  = ภัยที่กำลังมา (ฝน/ฝุ่น) ขึ้นบนสุดเสมอ ไม่นับโควตา
 *   overdue5 = แถวช้าเกิน 5 วันทำการ เป็นแถวของตัวเอง ไม่นับโควตา (พฤติกรรมเดิม)
 *   featured = แถวเด่น ไม่เกิน max (3): สัญญาณเตือนสำคัญจากทะเบียน (ลำดับเดิม) → กำหนดที่เลยแล้ว (แดง) → ปัญหาซ้ำซาก → กำหนดที่เหลือ
 *   minor    = ที่ล้นโควตา + เรื่องเล็กเดิม (หน้าจอบอก "มีเรื่องเล็กอีก N เรื่อง" ไม่ซ่อนเงียบ)
 * เมื่อมี deadline:op_plan แล้ว ตัดสัญญาณ local-plan:no_published_plan ของทะเบียนออก (เรื่องเดียวกัน ไม่ให้ซ้ำ)
 * @param {{
 *   hazards?: object[], overdue5?: object|null, major?: object[], minor?: object[], deadlines?: object[], repeat?: object|null, max?: number,
 * }} input  major/minor = ผล splitSimpleAlerts
 * @returns {{ hazards: object[], overdue5: object|null, featured: object[], minor: object[], total: number }}
 */
export function composeKnowRows({ hazards = [], overdue5 = null, major = [], minor = [], deadlines = [], repeat = null, max = EXEC_SIMPLE_MAX_MAJOR } = {}) {
  const hazardList = hazards.filter(Boolean)
  const deadlineList = deadlines.filter(Boolean)
  const dropPlan = deadlineList.some((d) => d.id === OP_PLAN_DEADLINE_ID)

  const registry = [...major, ...minor].filter((it) => !(dropPlan && it.id === NO_PUBLISHED_PLAN_ID))
  const registryMajor = registry.filter((it) => EXEC_SIMPLE_MAJOR_ALERTS.includes(it.id))
  const redDeadlines = deadlineList.filter((d) => d.tone === 'red')
  const otherDeadlines = deadlineList.filter((d) => d.tone !== 'red')

  const ordered = [...registryMajor, ...redDeadlines, ...(repeat ? [repeat] : []), ...otherDeadlines]
  const limit = Math.max(0, Number.isFinite(max) ? max : EXEC_SIMPLE_MAX_MAJOR)
  const featured = ordered.slice(0, limit)
  const overflow = ordered.slice(limit)

  // ล้นโควตาจากกลุ่ม insight ขึ้นก่อน แล้วตามด้วยรายการทะเบียนที่เหลือ (คงลำดับความรุนแรงเดิม)
  const overflowInsights = overflow.filter((it) => !registry.includes(it))
  const registryRest = registry.filter((it) => !featured.includes(it))
  const minorOut = [...overflowInsights, ...registryRest]

  return {
    hazards: hazardList,
    overdue5: overdue5 ?? null,
    featured,
    minor: minorOut,
    total: hazardList.length + (overdue5 ? 1 : 0) + featured.length + minorOut.length,
  }
}

// ───────────────────────── สรุปวันนี้ ─────────────────────────

export const EXEC_BRIEFING_RULE = 'ระบบเรียบเรียงจากตัวเลขในหน้านี้ตามลำดับ: เรื่องรอท่าน → ภัยที่กำลังมา → เรื่องช้า/ผิดปกติ → ข่าวดี → กำหนดการ ไม่เกิน 3 บรรทัด · ใช้กฎตายตัว ไม่ใช้ AI'
export const EXEC_BRIEFING_MAX_LINES = 3

const briefOfInsight = (it) => (typeof it.brief === 'string' && it.brief ? it.brief : it.what)

/**
 * สรุปวันนี้ ไม่เกิน 3 บรรทัด — เรียบเรียงจากตัวเลขที่หน้านี้มีอยู่แล้ว (ไม่ดึงข้อมูลเพิ่ม)
 * ready = false (ข้อมูลหลักยังโหลด/พัง/ตรวจไม่ครบ) → null ไม่ขึ้นกล่อง — ห้ามสรุปว่า "เรียบร้อย" จากข้อมูลไม่ครบ
 * @param {{
 *   ready: boolean,
 *   sign?: { status?: string, total?: number, over2wd?: number },
 *   decisions?: number,
 *   hazards?: object[],
 *   waterEventOpen?: { count: number }|null,
 *   overdue5?: { count: number }|null,
 *   featured?: object[],
 *   service?: { complaintPct?: number|null, satAvg?: number|null },
 *   schedule?: { todayCount?: number, nextTime?: string|null },
 * }} input
 * @returns {Array<{ id: string, tone: 'blue'|'red'|'amber'|'green', text: string, target: 's1'|'s2'|'s3'|'s4' }>|null}
 */
export function buildBriefing(input) {
  if (!input || input.ready !== true) return null
  const signStatus = input.sign?.status
  // ตรวจใบรอลงนามไม่ได้ = ไม่รู้ว่ามีหรือไม่ → ไม่สรุป (กันบรรทัดเขียว "ไม่มีเรื่อง" ลวง)
  if (signStatus === 'loading' || signStatus === 'error') return null

  const lines = []

  // 1) เรื่องรอท่าน
  const signTotal = signStatus === 'ok' ? Math.max(0, Number(input.sign?.total) || 0) : 0
  const over2wd = signStatus === 'ok' ? Math.max(0, Number(input.sign?.over2wd) || 0) : 0
  const decisions = Math.max(0, Number(input.decisions) || 0)
  if (signTotal > 0 || decisions > 0) {
    const signText = signTotal > 0 ? `มีเอกสารรอท่านลงนาม ${execNf(signTotal)} ฉบับ${over2wd > 0 ? ` (รอเกิน 2 วันทำการ ${execNf(over2wd)} ฉบับ)` : ''}` : ''
    let text
    if (signText && decisions > 0) text = `${signText} และเรื่องรอพิจารณาอีก ${execNf(decisions)} เรื่อง`
    else if (signText) text = signText
    else text = `มีเรื่องรอท่านพิจารณา ${execNf(decisions)} เรื่อง`
    lines.push({ id: 'wait', tone: over2wd > 0 ? 'amber' : 'blue', text, target: 's1' })
  }

  // 2) ภัยที่กำลังมา + เหตุการณ์น้ำ–ฝนที่ยังเฝ้าระวัง
  const hazards = (input.hazards ?? []).filter(Boolean)
  for (const h of hazards) lines.push({ id: h.id, tone: h.tone === 'red' ? 'red' : 'amber', text: briefOfInsight(h), target: 's2' })
  const water = Number(input.waterEventOpen?.count)
  if (Number.isFinite(water) && water > 0) {
    lines.push({ id: 'water-event', tone: 'amber', text: `มีเหตุการณ์น้ำ–ฝนที่ยังเฝ้าระวังอยู่ ${execNf(water)} เหตุการณ์`, target: 's2' })
  }

  // 3) เรื่องช้า/ผิดปกติ: ช้าเกิน 5 วันทำการ ไม่มีก็แถวเด่นแถวแรก
  const overdueCount = Number(input.overdue5?.count)
  let abnormal = false
  if (Number.isFinite(overdueCount) && overdueCount > 0) {
    lines.push({ id: 'overdue5', tone: 'red', text: `เรื่องของประชาชนช้ากว่ากำหนดเกิน 5 วันทำการ ${execNf(overdueCount)} เรื่อง`, target: 's2' })
    abnormal = true
  } else {
    // แถวเด่นแถวแรก — ข้ามเหตุการณ์น้ำ–ฝนถ้าขึ้นเป็นบรรทัดของตัวเองแล้ว (เรื่องเดียวกัน ไม่ซ้ำ)
    const f = (input.featured ?? []).find((it) => it && !(it.id === WATER_EVENT_ALERT_ID && water > 0))
    if (f) {
      const w = simpleAlertWords(f)
      const withCount = f.showCount !== false && f.count != null && Number.isFinite(Number(f.count))
      lines.push({ id: 'featured', tone: f.tone === 'red' ? 'red' : 'amber', text: withCount ? `${w.what} ${nf1(f.count)}${w.unit ? ` ${w.unit}` : ''}` : w.what, target: 's2' })
      abnormal = true
    }
  }

  // 4) ข่าวดี — เฉพาะเมื่อไม่มีภัย/เรื่องช้า/แถวเด่นเลย (ไม่ใช้ข่าวดีกลบปัญหา)
  if (hazards.length === 0 && !(water > 0) && !abnormal && lines.length < EXEC_BRIEFING_MAX_LINES) {
    const pct = input.service?.complaintPct
    const sat = input.service?.satAvg
    const parts = []
    if (Number.isFinite(pct)) parts.push(`เดือนนี้คำร้องทำเสร็จทันเวลา ${execNf(Math.round(pct))}%`)
    if (Number.isFinite(sat)) parts.push(`ประชาชนพอใจ ${nf1(sat)} จาก 5`)
    if (parts.length > 0) lines.push({ id: 'good-news', tone: 'green', text: parts.join(' · '), target: 's3' })
  }

  // 5) กำหนดการ — ไม่ใส่ชื่อกิจกรรม (มีแต่จำนวน + เวลาถัดไป)
  const todayCount = Math.max(0, Number(input.schedule?.todayCount) || 0)
  if (todayCount > 0 && lines.length < EXEC_BRIEFING_MAX_LINES) {
    const next = typeof input.schedule?.nextTime === 'string' && /^\d{2}:\d{2}/.test(input.schedule.nextTime) ? input.schedule.nextTime.slice(0, 5) : null
    lines.push({ id: 'schedule', tone: 'blue', text: `วันนี้มีกำหนดการ ${execNf(todayCount)} รายการ${next ? ` · ถัดไป ${next} น.` : ''}`, target: 's4' })
  }

  if (lines.length === 0) {
    return [{ id: 'all-clear', tone: 'green', text: 'วันนี้ไม่มีเรื่องรอท่าน และไม่พบเรื่องผิดปกติ', target: 's1' }]
  }
  return lines.slice(0, EXEC_BRIEFING_MAX_LINES)
}
