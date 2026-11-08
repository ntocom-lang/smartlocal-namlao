// กำหนดเวลาตามระเบียบของเมนู "แผนพัฒนาท้องถิ่น" — คำนวณล้วนจากสตริงวันที่ 'YYYY-MM-DD' ไม่ใช้เน็ต
//
// ทั้งไฟล์นี้ "เตือนเท่านั้น ไม่บล็อก": ระเบียบกำหนดเวลาไว้ แต่การเกินกำหนดไม่ได้ทำให้แผนเป็นโมฆะในระบบ
// (หน้าจอแสดงแถบเตือน เจ้าหน้าที่ตัดสินเอง) และทุกตัวเลขข้างล่างมาจากตัวบทที่ต้องยืนยันกับฉบับปัจจุบันก่อนอ้างเป็นทางการ
// ฟังก์ชันที่ต้องรู้ "วันนี้" รับ today เป็น ISO string เสมอ (ค่าเริ่มต้น = วันที่เวลาไทย) ห้ามอ่านจากนาฬิกาเครื่องเอง
import { fiscalYearBounds } from './fiscalYear.js'
import { addDays, bangkokIsoDate, thaiShortDate } from './complaintReportPeriods.js'
import { holidayName, isWorkingDay } from './workingDays.js'

const MS_PER_DAY = 86_400_000
const isoDay = v => String(v).slice(0, 10)
const toUtcMs = iso => Date.parse(`${isoDay(iso)}T00:00:00Z`)

/** จำนวนวันจาก a ไป b (b - a) เป็นวันปฏิทิน · ผ่าน UTC จึงไม่โดน DST/โซนเวลาเครื่อง */
export function daysBetween(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY)
}

// ── แผนการดำเนินงาน: ครบ 30 วันนับจากวันตั้งต้น ──────────────────────────────────

// ระเบียบ มท. ว่าด้วยการจัดทำแผนพัฒนาขององค์กรปกครองส่วนท้องถิ่น พ.ศ. 2548 แก้ไขเพิ่มเติม (ฉบับที่ 2) พ.ศ. 2559 ข้อ 27:
// ให้จัดทำแผนการดำเนินงานให้แล้วเสร็จภายใน 30 วัน นับแต่วันที่ประกาศใช้ข้อบัญญัติ/เทศบัญญัติงบประมาณ ฯลฯ (วันตั้งต้น = basis_on)
// สมมติฐาน: นับวันปฏิทิน ไม่นับวันประกาศ (วันแรก) — ต้องยืนยันกับตัวบท/หลัก ป.พ.พ. ว่าด้วยระยะเวลา ฉบับปัจจุบัน
//   (basis_on 15 ต.ค. → ครบ 14 พ.ย.) · วันครบกำหนดตรงวันหยุด: ไม่เลื่อน แค่ติดธง dueIsHoliday ให้หน้าจอบอกเจ้าหน้าที่
export const OP_PLAN_DAYS = 30

/** เหลือไม่เกินกี่วันถึงขึ้นสถานะ 'soon' (เหลือ 1–7 วัน) */
export const SOON_DAYS = 7

// ชื่อฐานของวันตั้งต้น (local_op_plans.basis) — เขียนกลางๆ "ข้อบัญญัติ/เทศบัญญัติ" ใช้ได้ทั้ง อบต. และเทศบาล
export const BASIS_LABELS = {
  annual_budget: 'ประกาศใช้ข้อบัญญัติ/เทศบัญญัติงบประมาณรายจ่ายประจำปี',
  supplementary_budget: 'ประกาศใช้ข้อบัญญัติ/เทศบัญญัติงบประมาณรายจ่ายเพิ่มเติม',
  accumulated_fund: 'อนุมัติจ่ายขาดเงินสะสม',
  external_notice: 'ได้รับแจ้งแผนงาน/โครงการจากหน่วยงานอื่น',
}

/**
 * กำหนดจัดทำแผนการดำเนินงาน (ข้อ 27)
 * opPlan: { basis, basis_on, extended_due_on, status, published_on } (คอลัมน์ของ local_op_plans)
 * state:
 *   no_basis          ยังไม่มี basis_on → คำนวณไม่ได้ (ทุกช่องอื่นเป็น null/false)
 *   open              เหลือมากกว่า SOON_DAYS วัน
 *   soon              เหลือ 1–SOON_DAYS วัน
 *   due_today         ครบกำหนดวันนี้
 *   overdue           เลยกำหนดและยังไม่ประกาศ
 *   published_on_time ประกาศแล้ว published_on <= dueOn
 *   published_late    ประกาศแล้ว published_on > dueOn
 * dueOn = extended_due_on (ถ้าขยายเวลา) มิฉะนั้น baseDueOn · daysLeft เป็น null เมื่อประกาศแล้ว (ไม่มีความหมายแล้ว)
 */
export function opPlanDeadline(opPlan, today = bangkokIsoDate()) {
  const plan = opPlan || {}
  const basisLabel = BASIS_LABELS[plan.basis] ?? null
  if (!plan.basis_on) {
    return {
      state: 'no_basis', dueOn: null, baseDueOn: null, extended: false,
      daysLeft: null, dueIsHoliday: false, holidayName: null, basisLabel,
    }
  }
  const baseDueOn = addDays(isoDay(plan.basis_on), OP_PLAN_DAYS)
  const extended = Boolean(plan.extended_due_on)
  const dueOn = extended ? isoDay(plan.extended_due_on) : baseDueOn
  const dueIsHoliday = !isWorkingDay(dueOn)
  const holiday = holidayName(dueOn)

  const published = plan.status === 'published' && Boolean(plan.published_on)
  let state
  let daysLeft = null
  if (published) {
    state = isoDay(plan.published_on) <= dueOn ? 'published_on_time' : 'published_late'
  } else {
    daysLeft = daysBetween(isoDay(today), dueOn)
    if (daysLeft < 0) state = 'overdue'
    else if (daysLeft === 0) state = 'due_today'
    else if (daysLeft <= SOON_DAYS) state = 'soon'
    else state = 'open'
  }
  return { state, dueOn, baseDueOn, extended, daysLeft, dueIsHoliday, holidayName: holiday, basisLabel }
}

// ── แผนพัฒนา: ห้ามเพิ่มเติม/เปลี่ยนแปลงเมื่อแผนเหลืออายุไม่ถึง 180 วัน ──────────────────

// ข้อ 22 (ระเบียบฉบับที่ 2 พ.ศ. 2559): แผนเหลืออายุไม่ถึง 180 วัน ห้ามเพิ่มเติม/เปลี่ยนแปลง
// สมมติฐาน: แผนสิ้นอายุ 30 ก.ย. ของ year_to — ยังไม่มีตัวบทยืนยัน (ต้องเปิดข้อ 22 ฉบับปัจจุบัน)
export const PLAN_AMEND_MIN_DAYS = 180

/** เหลือไม่เกินกี่วันถึงวันสุดท้ายที่แก้ได้ ถึงขึ้นสถานะ 'closing' */
export const CLOSING_DAYS = 30

/**
 * หน้าต่างเวลาที่แก้แผนพัฒนาได้ (ข้อ 22)
 * devPlan: { year_from, year_to } (พ.ศ. ปีงบ)
 *
 * วิธีนับ: อายุที่เหลือ ณ วัน d = จำนวนวันจาก d ถึง planEndsOn (daysBetween(d, planEndsOn))
 *   วันสุดท้ายที่ยังแก้ได้ = วันที่อายุเหลือ "พอดี 180 วัน" = planEndsOn - 180 วัน (lastAmendOn)
 *   วันถัดไปอายุเหลือ 179 วัน (< 180) → ห้ามแก้ (closed)
 * state:
 *   not_started  ยังไม่ถึง 1 ต.ค. ของ year_from (ยังแก้ได้ ไม่ใช่ error — แค่แผนยังไม่เริ่มมีผล)
 *   open         แก้ได้ และเหลือมากกว่า CLOSING_DAYS วันถึงเส้น
 *   closing      แก้ได้ แต่เหลือ 0–CLOSING_DAYS วันถึงเส้น (0 = วันนี้เป็นวันสุดท้าย)
 *   closed       เลยเส้น 180 วันแล้ว แต่แผนยังไม่หมดอายุ
 *   expired      เลย planEndsOn
 */
export function devPlanAmendWindow(devPlan, today = bangkokIsoDate()) {
  const plan = devPlan || {}
  // ปีว่าง/ไม่ใช่เลข (ฟอร์มยังกรอกไม่ครบ) → null แทนวันที่ 'NaN-09-30' ที่เทียบแล้วได้สถานะผิดเงียบๆ
  if (![plan.year_from, plan.year_to].every(y => Number.isInteger(Number(y)) && y !== null && y !== '')) return null
  const planEndsOn = fiscalYearBounds(plan.year_to).to
  const planStartsOn = fiscalYearBounds(plan.year_from).from
  const lastAmendOn = addDays(planEndsOn, -PLAN_AMEND_MIN_DAYS)
  const now = isoDay(today)
  const daysToCutoff = daysBetween(now, lastAmendOn)
  const daysLeftInPlan = daysBetween(now, planEndsOn)

  let state
  if (now > planEndsOn) state = 'expired'
  else if (now < planStartsOn) state = 'not_started'
  else if (now > lastAmendOn) state = 'closed'
  else if (daysToCutoff <= CLOSING_DAYS) state = 'closing'
  else state = 'open'
  return { state, planEndsOn, lastAmendOn, daysToCutoff, daysLeftInPlan }
}

// ── ข้อความแถบเตือน ──────────────────────────────────────────────────────────

/**
 * ข้อความไทยสั้นๆ สำหรับแถบเตือน (ไม่บล็อก) จากผลของ opPlanDeadline หรือ devPlanAmendWindow
 * ไม่มีอะไรต้องเตือน → null (สถานะปกติ)
 */
export function warningText(result) {
  if (!result || typeof result !== 'object') return null
  if ('planEndsOn' in result) return devPlanWarning(result)
  if ('dueOn' in result) return opPlanWarning(result)
  return null
}

function opPlanWarning(r) {
  const holiday = r.dueIsHoliday
    ? ` · วันครบกำหนดตรงวันหยุด${r.holidayName ? ` (${r.holidayName})` : ''}`
    : ''
  const due = r.dueOn ? thaiShortDate(r.dueOn) : ''
  const ext = r.extended ? ' (ขยายเวลาแล้ว)' : ''
  switch (r.state) {
    case 'no_basis':
      return 'ยังไม่ระบุวันที่ตั้งต้น (เช่น วันประกาศใช้ข้อบัญญัติ/เทศบัญญัติงบประมาณ) จึงคำนวณกำหนด 30 วันตามข้อ 27 ไม่ได้'
    case 'soon':
      return `ใกล้ครบกำหนดจัดทำแผนการดำเนินงาน (ข้อ 27): เหลือ ${r.daysLeft} วัน · ครบ ${due}${ext}${holiday}`
    case 'due_today':
      return `วันนี้ครบกำหนดจัดทำแผนการดำเนินงาน (ข้อ 27) · ${due}${ext}${holiday}`
    case 'overdue':
      return `เกินกำหนดจัดทำแผนการดำเนินงาน (ข้อ 27) มา ${-r.daysLeft} วัน · กำหนด ${due}${ext}${holiday}`
    case 'published_late':
      return `ประกาศแผนการดำเนินงานหลังวันครบกำหนด (ข้อ 27) · กำหนด ${due}${ext}`
    default:
      return null
  }
}

function devPlanWarning(r) {
  const last = thaiShortDate(r.lastAmendOn)
  switch (r.state) {
    case 'closing':
      return r.daysToCutoff === 0
        ? `วันนี้เป็นวันสุดท้ายที่เพิ่มเติม/เปลี่ยนแปลงแผนพัฒนาได้ (ข้อ 22) · หลังจากนี้แผนเหลืออายุไม่ถึง ${PLAN_AMEND_MIN_DAYS} วัน`
        : `เหลือ ${r.daysToCutoff} วัน จะถึงวันสุดท้ายที่เพิ่มเติม/เปลี่ยนแปลงแผนพัฒนาได้ (${last}) ตามข้อ 22`
    case 'closed':
      return `แผนเหลืออายุไม่ถึง ${PLAN_AMEND_MIN_DAYS} วัน (หลัง ${last}) — ข้อ 22 ห้ามเพิ่มเติม/เปลี่ยนแปลง`
    case 'expired':
      return 'แผนพัฒนาฉบับนี้สิ้นอายุแล้ว'
    default:
      return null
  }
}
