// ตรรกะล้วนของแจ้งเตือน Telegram "รายการแผนการดำเนินงานที่ถึงกำหนดแต่ยังไม่บันทึกผล" (local-plan-monthly-reminder)
//
// แยกออกมาจาก index.ts เพราะไฟล์นั้นต้อง import จากเน็ต (deno.land / esm.sh) เทสต์ใน node รันตรงๆ ไม่ได้
// ไฟล์นี้จึงห้าม import อะไรนอกจาก ./telegram.ts และห้ามใช้ Deno.* — tests/local-plan-monthly-reminder.test.mjs โหลดไปรันจริง
//
// ⚠️ ชุดรายการที่มีผล + การหาสายรายการ "ต้องเท่ากับ" src/lib/localPlanProgress.js (effectivePlans / effectiveItemSet /
//    lineageOf / resolveItemStatus) ซึ่งเป็นตัวที่แท็บ "ติดตามผล" ใช้ — Edge Function ดึงไฟล์นอก supabase/functions
//    ไม่ได้จึงต้องมีสองชุด เทสต์รันทั้งสองฝั่งด้วยข้อมูลชุดเดียวกันแล้วเทียบผล แก้ฝั่งไหนต้องแก้อีกฝั่งด้วย

import { escapeHtml } from './telegram.ts'

export const NOTIFICATION_TYPE = 'local_plan_monthly_due'

// ต้องตรงกับ MONTHS_TH_FULL ใน complaintMonthlyReminder.ts
export const MONTHS_TH_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

export type DueMonth = {
  key: string          // 2569-10 (พ.ศ. ปฏิทิน) — ใช้เป็นคีย์กันส่งซ้ำ
  label: string        // ตุลาคม 2569
  fiscalYear: number   // ปีงบ พ.ศ. ที่เดือนนี้อยู่ (ต.ค. 2569 → 2570)
  fiscalMonth: number  // เดือนที่ของปีงบ 1 = ต.ค. … 12 = ก.ย.
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * เดือนที่ "เพิ่งจบ" ตามเวลาไทย ณ เวลา now + ปีงบ/เดือนที่ของมัน — cron ยิงวันที่ 1 08:45 น. เวลาไทย
 * นับถึงสิ้นเดือนที่เพิ่งจบ: รายการที่เดือนเริ่ม ≤ เดือนนั้น ถือว่า "ถึงกำหนด" แล้ว
 * วันที่ 1 ต.ค. → เดือนที่จบคือ ก.ย. (เดือนที่ 12 ของปีงบเก่า) ⇒ รอบนี้ตามรายการของปีงบที่เพิ่งปิด ก่อนรายงานผล ธ.ค.
 */
export function previousMonthBangkok(now: Date): DueMonth {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .formatToParts(now)
  const ceYearNow = Number(parts.find((p) => p.type === 'year')?.value)
  const monthNow = Number(parts.find((p) => p.type === 'month')?.value)
  const index = ceYearNow * 12 + (monthNow - 1) - 1
  const ceYear = Math.floor(index / 12)
  const month = (index % 12) + 1
  const beYear = ceYear + 543
  return {
    key: `${beYear}-${pad2(month)}`,
    label: `${MONTHS_TH_FULL[month - 1]} ${beYear}`,
    fiscalYear: month >= 10 ? beYear + 1 : beYear,
    fiscalMonth: month >= 10 ? month - 9 : month + 3,
  }
}

// ── ชุดรายการที่มีผลทั้งปี (สำเนาของ src/lib/localPlanProgress.js — ดูหัวไฟล์) ────────────

export type OpPlan = { id: string; fiscal_year: number | string; kind: string; revision_no: number | string; status: string }
export type OpItem = {
  id: string
  op_plan_id: string
  origin_item_id?: string | null
  department_id?: string | null
  dev_project_id?: string | null
  month_from?: number | string | null
  month_to?: number | string | null
  sort_order?: number | string | null
}

export const lineageOf = (item: { id?: string | null; origin_item_id?: string | null } | null | undefined) =>
  item?.origin_item_id ?? item?.id ?? null

/** ฉบับที่มีผลของปีงบ (เฉพาะที่ประกาศแล้ว): ฐาน main|amendment ครั้งที่สูงสุด + ฉบับเพิ่มเติมที่ครั้งที่สูงกว่าฐาน */
export function effectivePlans(opPlans: OpPlan[], fiscalYear: number): OpPlan[] {
  const candidates = (opPlans ?? [])
    .filter((p) => Number(p.fiscal_year) === Number(fiscalYear) && p.status === 'published')
  const bases = candidates.filter((p) => p.kind === 'main' || p.kind === 'amendment')
  const base = bases.reduce<OpPlan | null>((a, b) => (a === null || Number(b.revision_no) > Number(a.revision_no) ? b : a), null)
  const floor = base ? Number(base.revision_no) : -1
  const supplements = candidates.filter((p) => p.kind === 'supplement' && Number(p.revision_no) > floor)
    .sort((a, b) => Number(a.revision_no) - Number(b.revision_no))
  return base ? [base, ...supplements] : supplements
}

/** รายการที่มีผลทั้งปี — สายเดียวกันหลายฉบับเอาแถวจากฉบับครั้งที่สูงสุด */
export function effectiveItemSet(opPlans: OpPlan[], items: OpItem[], fiscalYear: number): OpItem[] {
  const plans = effectivePlans(opPlans, fiscalYear)
  const byLineage = new Map<string | null, OpItem>()
  for (const plan of plans) {
    const rows = (items ?? []).filter((i) => i.op_plan_id === plan.id)
      .sort((a, b) => (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || String(a.id).localeCompare(String(b.id)))
    for (const row of rows) byLineage.set(lineageOf(row), row)
  }
  return [...byLineage.values()]
}

// ── กติกา "ถึงกำหนด" (เจ้าของระบบเลือก 2569-11-09) ───────────────────────────────

export type DueKind = 'not_started' | 'past_end'

const monthOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null
}

/**
 * รายการนี้ต้องเตือนไหม ณ สิ้นเดือนที่ fiscalMonth ของปีงบ
 *   status = ผลที่กองกดเอง ('none' = ยังไม่กดเลย) · civilLinked = ผูกโครงการก่อสร้างและพบโครงการของปีงบนี้
 *   - ผูกก่อสร้าง → ไม่เตือน (ระบบดึงผลจากงานก่อสร้างให้ กองกดเองไม่ได้ — canRecordProgress)
 *   - ไม่ระบุเดือน → ไม่เตือน (ไม่มีกำหนดให้นับ)
 *   - 'none' และเดือนเริ่ม ≤ เดือนที่จบ → not_started "ถึงกำหนดแล้วแต่ยังไม่บันทึกผล"
 *   - 'in_progress' และเดือนสิ้นสุด ≤ เดือนที่จบ → past_end "เลยเดือนสิ้นสุดแล้วแต่ยังไม่ปิดผล"
 *   - done / not_done → บันทึกครบแล้ว ไม่เตือน
 */
export function dueKindOf(
  input: { item: OpItem; status: string; civilLinked: boolean; fiscalMonth: number },
): DueKind | null {
  if (input.civilLinked) return null
  const from = monthOf(input.item.month_from)
  if (from === null) return null
  const to = monthOf(input.item.month_to) ?? from
  if (input.status === 'none') return from <= input.fiscalMonth ? 'not_started' : null
  if (input.status === 'in_progress') return to <= input.fiscalMonth ? 'past_end' : null
  return null
}

export type Department = { id: string; name: string | null; sort_order?: number | string | null }
export type DeptCount = { departmentId: string | null; name: string; notStarted: number; pastEnd: number }

export const NO_DEPARTMENT_LABEL = 'ยังไม่ระบุกอง'

/**
 * นับรายการที่ต้องเตือนแยกกอง
 * progressByLineage: { [lineage_id]: status } ของปีงบนั้น · civilRefs: ทะเบียนโครงการที่มีโครงการก่อสร้างของปีงบนั้นผูกอยู่
 * เรียงตามทะเบียนกอง (sort_order แล้วชื่อ) · ไม่มีกอง/กองถูกลบ → "ยังไม่ระบุกอง" ไว้ท้าย (ให้นักวิเคราะห์ไปใส่กอง)
 */
export function countDueByDepartment(input: {
  opPlans: OpPlan[]
  items: OpItem[]
  fiscalYear: number
  fiscalMonth: number
  progressByLineage: Record<string, string>
  civilRefs: Set<string>
  departments: Department[]
}): DeptCount[] {
  const deptById = new Map((input.departments ?? []).map((d) => [d.id, d]))
  const counts = new Map<string | null, DeptCount>()
  for (const item of effectiveItemSet(input.opPlans, input.items, input.fiscalYear)) {
    const lineage = lineageOf(item)
    const status = (lineage && input.progressByLineage[lineage]) || 'none'
    const civilLinked = Boolean(item.dev_project_id) && input.civilRefs.has(String(item.dev_project_id))
    const kind = dueKindOf({ item, status, civilLinked, fiscalMonth: input.fiscalMonth })
    if (!kind) continue
    const dept = item.department_id ? deptById.get(item.department_id) ?? null : null
    const key = dept ? dept.id : null
    let row = counts.get(key)
    if (!row) {
      row = { departmentId: key, name: dept?.name?.trim() || NO_DEPARTMENT_LABEL, notStarted: 0, pastEnd: 0 }
      counts.set(key, row)
    }
    if (kind === 'not_started') row.notStarted += 1
    else row.pastEnd += 1
  }
  const order = (r: DeptCount) => {
    const d = r.departmentId ? deptById.get(r.departmentId) : null
    return d ? Number(d.sort_order ?? 0) : Number.MAX_SAFE_INTEGER
  }
  return [...counts.values()].sort((a, b) =>
    (order(a) - order(b)) || (a.departmentId === null ? 1 : b.departmentId === null ? -1 : a.name.localeCompare(b.name, 'th')))
}

/**
 * ข้อความเข้ากลุ่ม Telegram ของ อปท. — มีแต่ชื่อกองกับจำนวนรายการ ไม่มีชื่อบุคคล ไม่มีชื่อรายการ
 * ⚠️ ไม่ใส่ลิงก์เข้าระบบ: เจ้าของระบบสั่งถอดลิงก์ท้ายข้อความแจ้งเตือนแล้ว (#160) จึงบอกทางเข้าเมนูเป็นตัวหนังสือแทน
 * คืน null เมื่อไม่มีรายการต้องเตือน (ไม่ส่งข้อความ "ครบแล้ว" — ไม่มีอะไรให้ทำ)
 */
export function buildDueMessage(input: { tenantName: unknown; month: DueMonth; counts: DeptCount[] }): string | null {
  const rows = (input.counts ?? []).filter((r) => r.notStarted + r.pastEnd > 0)
  if (rows.length === 0) return null
  const fmt = (n: number) => n.toLocaleString('th-TH')
  const totalNotStarted = rows.reduce((s, r) => s + r.notStarted, 0)
  const totalPastEnd = rows.reduce((s, r) => s + r.pastEnd, 0)
  const lines = rows.map((r) => {
    const parts: string[] = []
    if (r.notStarted > 0) parts.push(`ยังไม่บันทึกผล ${fmt(r.notStarted)}`)
    if (r.pastEnd > 0) parts.push(`เลยกำหนดเสร็จ ${fmt(r.pastEnd)}`)
    return `• ${escapeHtml(r.name, 80)} — ${parts.join(' · ')}`
  })
  const totals: string[] = []
  if (totalNotStarted > 0) totals.push(`ถึงกำหนดแต่ยังไม่บันทึกผล ${fmt(totalNotStarted)} รายการ`)
  if (totalPastEnd > 0) totals.push(`เลยเดือนสิ้นสุดแต่ยังเป็น "กำลังดำเนินการ" ${fmt(totalPastEnd)} รายการ`)
  const m = input.month
  return [
    `📋 <b>แผนการดำเนินงานปีงบประมาณ ${m.fiscalYear}: รายการที่ยังไม่บันทึกผล</b>`,
    escapeHtml(input.tenantName, 120),
    `นับถึงสิ้นเดือน${escapeHtml(m.label, 40)} (เดือนที่ ${m.fiscalMonth} ของปีงบ)`,
    '',
    ...lines,
    '',
    ...totals,
    'บันทึกผลได้ที่เมนู "แผนพัฒนาท้องถิ่น" → แท็บ "ติดตามผล"',
    'รายการที่ผูกโครงการก่อสร้างไว้ ระบบดึงผลให้เอง ไม่นับในข้อความนี้',
  ].join('\n').slice(0, 3500)
}

/** กันส่งซ้ำรายเดือนต่อ อปท. (unique ของ notification_deliveries คือ อปท. + ช่องทาง + คีย์นี้) */
export function idempotencyKey(monthKey: string): string {
  return `local_plan_monthly:${monthKey}`
}

/** slug ที่ใช้กรองตอนทดสอบ (only_slug) — รูปแบบเดียวกับโฮสต์ของ อปท. · ผิดรูป = null */
export function validSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s) && s.length <= 63 ? s : null
}

// เปรียบเทียบเวลาคงที่ — แบบเดียวกับ complaintMonthlyReminder.ts
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}
