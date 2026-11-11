// ตรรกะของแท็บ "ติดตามผล" (เมนูแผนพัฒนาท้องถิ่น) — pure function ล้วน ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกาเครื่อง (ทดสอบด้วย node ตรงๆ)
//
// ที่มาของข้อมูล (ฐานข้อมูล R1-A: 20261110100000 / 20261110100100)
//   - ผลดำเนินการเก็บตาม "สาย" ของรายการ (lineage = coalesce(origin_item_id, id)) ไม่ใช่ id แถว — ฉบับแก้ไขคัดรายการเป็นแถวใหม่
//     แต่ผลที่กองกดไว้ต้องตามสายไปด้วย · ไม่มีแถวผล = ยังไม่ได้ดำเนินการ
//   - รายการที่ผูกทะเบียนโครงการ (dev_project_id) ซึ่งกองช่างผูกกับโครงการก่อสร้างไว้ → ใช้ "ขั้นของโครงการก่อสร้าง" เป็นผล
//     กองกดเองไม่ได้ (ไม่ให้กรอกซ้ำ 2 ที่) · ขั้นที่ได้เป็นข้อเท็จจริงที่กองช่างบันทึกอยู่แล้ว ระบบแค่แปลเป็นผลดำเนินการ
//   - "เตือนเท่านั้น ไม่ตัดสินแทนคน": ระบบไม่ลงนาม/ไม่ประเมินผลแทนคณะกรรมการ (ข้อ 29) แค่รวมตัวเลขและนับวันให้
import { addDays, bangkokIsoDate, thaiShortDate } from './complaintReportPeriods.js'
import { STAGE_LABELS } from './constructionLifecycle.js'
import { fiscalYearBounds } from './fiscalYear.js'
import { calendarToFiscalMonth, quarterOfFiscalMonth, toAsciiDigits } from './localPlanCalendar.js'
import { daysBetween } from './localPlanDeadlines.js'

export const PROGRESS_LABELS = {
  none: 'ยังไม่ดำเนินการ',
  in_progress: 'กำลังดำเนินการ',
  done: 'แล้วเสร็จ',
  not_done: 'ไม่ได้ดำเนินการ',
}

/** ข้อความเตือนใต้ช่องข้อความอิสระ (เหตุผล/หมายเหตุ) — เลขบัตร/เบอร์/ชื่อประชาชนห้ามอยู่ในแผนที่เปิดให้เจ้าหน้าที่หลายกองอ่าน (PDPA) */
export const PDPA_FREE_TEXT_WARNING = 'ห้ามใส่ชื่อ-สกุล เลขบัตรประชาชน เบอร์โทร ของประชาชนในเหตุผล/หมายเหตุ'

const isoDay = v => String(v ?? '').slice(0, 10)
const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(isoDay(v))
const textOrNull = v => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

// ── สายของรายการ ─────────────────────────────────────────────────────────────

/** สายของรายการ = id ของรายการต้นสาย · แถวต้นสายเองไม่มี origin_item_id */
export const lineageOf = item => item?.origin_item_id ?? item?.id ?? null

// ── ชุดรายการที่ "มีผลทั้งปี" ─────────────────────────────────────────────────

function candidatePlans(opPlans, fiscalYear, publishedOnly) {
  const year = (opPlans ?? []).filter(p => Number(p.fiscal_year) === Number(fiscalYear))
  if (publishedOnly) return year.filter(p => p.status === 'published')
  // ไม่จำกัดเฉพาะที่ประกาศ: ข้ามฉบับร่างที่ไม่ใช่ฉบับล่าสุดของปี (ปกติมีร่างได้ครั้งละฉบับเดียว — กันฉบับร่างค้างเก่าปนเข้ามา)
  const latest = year.reduce((a, b) => (a === null || Number(b.revision_no) > Number(a.revision_no) ? b : a), null)
  return year.filter(p => p.status === 'published' || (latest && p.id === latest.id))
}

/**
 * ฉบับที่ "มีผล" ของปีงบ: ฐาน = ฉบับหลัก/แก้ไข (kind main|amendment) ที่ครั้งที่สูงสุด + ทุกฉบับเพิ่มเติม (supplement) ที่ครั้งที่สูงกว่าฐาน
 * เหตุผล: ฉบับแก้ไขคัดชุดรายการรวมทั้งปี (ฉบับหลัก + เพิ่มเติมก่อนหน้า) ไปเป็นของตัวเองแล้ว ฉบับเพิ่มเติมก่อนหน้าจึงไม่นับซ้ำ
 * ฉบับเพิ่มเติมที่ทำ "หลัง" ฉบับแก้ไข มีเฉพาะรายการใหม่ จึงต้องนับต่อจากฐาน
 * publishedOnly = true → นับเฉพาะฉบับที่ประกาศแล้ว (แท็บติดตามผล) · false → รวมฉบับร่างล่าสุดด้วย (ใช้ตอนคัดรายการทำฉบับถัดไป)
 * คืนเรียงตามครั้งที่ (ฐานก่อน)
 */
export function effectivePlans(opPlans, fiscalYear, { publishedOnly = true } = {}) {
  const candidates = candidatePlans(opPlans, fiscalYear, publishedOnly)
  const bases = candidates.filter(p => p.kind === 'main' || p.kind === 'amendment')
  const base = bases.reduce((a, b) => (a === null || Number(b.revision_no) > Number(a.revision_no) ? b : a), null)
  const floor = base ? Number(base.revision_no) : -1
  const supplements = candidates.filter(p => p.kind === 'supplement' && Number(p.revision_no) > floor)
    .sort((a, b) => Number(a.revision_no) - Number(b.revision_no))
  return base ? [base, ...supplements] : supplements
}

/**
 * ชุดรายการที่มีผลทั้งปี — items = รายการเต็มของฉบับต่างๆ (ต้องมี op_plan_id) · รายการเดียวกันหลายฉบับ (สายเดียวกัน) เอาแถวจากฉบับครั้งที่สูงสุด
 * ลำดับ: ตามฉบับ (ฐานก่อน) แล้วตาม sort_order ในฉบับนั้น · รายการที่ฉบับแก้ไขตัดออกแล้วไม่ฟื้นกลับ (ฐานใหม่ไม่มีมัน)
 */
export function effectiveItemSet(opPlans, items, fiscalYear, { publishedOnly = true } = {}) {
  const plans = effectivePlans(opPlans, fiscalYear, { publishedOnly })
  const byLineage = new Map()
  for (const plan of plans) {
    const rows = (items ?? []).filter(i => i.op_plan_id === plan.id)
      .sort((a, b) => (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || String(a.id).localeCompare(String(b.id)))
    for (const row of rows) byLineage.set(lineageOf(row), row)   // Map คงตำแหน่งแรก ค่าล่าสุดชนะ
  }
  return [...byLineage.values()]
}

/** ปีงบที่มีแผนการดำเนินงานฉบับประกาศแล้วอย่างน้อย 1 ฉบับ (ใหม่→เก่า) — บันทึกผลได้เฉพาะปีเหล่านี้ */
export function publishedFiscalYears(opPlans) {
  return [...new Set((opPlans ?? []).filter(p => p.status === 'published').map(p => Number(p.fiscal_year)))].sort((a, b) => b - a)
}

// ── ขั้นโครงการก่อสร้าง → ผลดำเนินการ ─────────────────────────────────────────

/**
 * ขั้นของโครงการก่อสร้าง (12 ขั้นของ civil_projects.stage) → ผลดำเนินการ · ขั้นที่ยังไม่เริ่ม/ไม่รู้จัก → null (นับเป็นยังไม่ดำเนินการ)
 *   procuring…suspended → กำลังดำเนินการ · warranty/closed → แล้วเสร็จ · cancelled/terminated → ไม่ได้ดำเนินการ (เหตุผล = ชื่อขั้น)
 * วันแล้วเสร็จของ warranty/closed = วันที่ (เวลาไทย) ที่โครงการเข้าขั้นนั้น — ไม่ใช่วันตรวจรับจริง จึงติดธง approxDate ให้หน้าจอบอกว่าประมาณ
 *   (ตรวจรับงวดสุดท้ายแล้วเข้า warranty เป็นข้อเท็จจริงที่กองช่างบันทึก แต่วันที่ระบบประทับอาจเลื่อนจากวันจริง)
 */
export function civilStatusOf(stage, stageChangedAt) {
  switch (stage) {
    case 'procuring': case 'contracted': case 'started': case 'construction': case 'final_inspection': case 'suspended':
      return { status: 'in_progress', doneOn: null, approxDate: false, reason: null }
    case 'warranty': case 'closed': {
      const t = stageChangedAt ? new Date(stageChangedAt) : null
      return { status: 'done', doneOn: t && !Number.isNaN(t.getTime()) ? bangkokIsoDate(t) : null, approxDate: true, reason: null }
    }
    case 'cancelled': case 'terminated':
      return { status: 'not_done', doneOn: null, approxDate: false, reason: STAGE_LABELS[stage] }
    default:
      return null   // budgeted, designing, และขั้นที่ไม่รู้จัก
  }
}

/** หลายแถวของทะเบียนโครงการเดียว (โครงการก่อสร้างหลายตัวผูกอันเดียว) → เลือกแถวที่เปลี่ยนขั้นล่าสุด · ว่าง → null */
export function pickCivilStage(rows) {
  let best = null
  let bestMs = -Infinity
  for (const row of rows ?? []) {
    const ms = Date.parse(row?.stage_changed_at)
    const value = Number.isNaN(ms) ? -Infinity : ms
    if (best === null || value > bestMs) { best = row; bestMs = value }
  }
  return best
}

/** ผลของ RPC local_plan_civil_stages → { [registry_ref]: แถวล่าสุด } */
export function civilStageMap(rows) {
  const groups = {}
  for (const row of rows ?? []) if (row?.registry_ref) (groups[row.registry_ref] ??= []).push(row)
  return Object.fromEntries(Object.entries(groups).map(([ref, list]) => [ref, pickCivilStage(list)]))
}

const lookup = (map, key) => (map instanceof Map ? map.get(key) : map?.[key]) ?? null
const hasKey = (set, key) => (set instanceof Set ? set.has(key) : Array.isArray(set) ? set.includes(key) : false)

/**
 * ผลของ 1 รายการ: ขั้นก่อสร้าง (ถ้าผูกและพบขั้นของปีนั้น) > ผลที่กองกดเอง > ยังไม่ดำเนินการ
 * item = แถวรายการ (dev_project_id) · progress = แถว local_op_item_progress ของสายนี้ (หรือ null) · civilByRef = ผลของ civilStageMap (ปีที่ดู)
 * linkedRefs = ทะเบียนโครงการทุกตัวที่ถูกโครงการก่อสร้างผูกไว้ (ทุกปี) — ไว้บอกว่า "ผูกแล้วแต่ไม่พบโครงการก่อสร้างของปีงบนี้" (ไม่ส่ง = ไม่รู้ ก็ไม่เตือน)
 * คืน { status: 'none'|'in_progress'|'done'|'not_done', doneOn, reason, startedOn, note, source: 'civil'|'manual'|'none', approxDate, stage, civilLinkedNoStage }
 */
export function resolveItemStatus({ item, progress = null, civilByRef = null, linkedRefs = null } = {}) {
  const ref = item?.dev_project_id ?? null
  const civilRow = ref ? lookup(civilByRef, ref) : null
  if (civilRow) {
    const c = civilStatusOf(civilRow.stage, civilRow.stage_changed_at)
    return {
      status: c?.status ?? 'none', doneOn: c?.doneOn ?? null, reason: c?.reason ?? null, startedOn: null, note: null,
      source: 'civil', approxDate: c?.approxDate ?? false, stage: civilRow.stage, civilLinkedNoStage: false,
    }
  }
  const civilLinkedNoStage = Boolean(ref) && hasKey(linkedRefs, ref)
  if (progress) {
    return {
      status: progress.status, doneOn: progress.done_on ?? null, reason: progress.reason ?? null,
      startedOn: progress.started_on ?? null, note: progress.note ?? null,
      source: 'manual', approxDate: false, stage: null, civilLinkedNoStage,
    }
  }
  return { status: 'none', doneOn: null, reason: null, startedOn: null, note: null, source: 'none', approxDate: false, stage: null, civilLinkedNoStage }
}

/**
 * ใครกดผลได้ — ตรงกับ RLS (ผู้จัดการแผน · officer/staff ของกองที่ถือรายการ) + กดไม่ได้เมื่อผลมาจากงานก่อสร้าง (ไม่ให้กรอกซ้ำ)
 * ตัวบังคับจริงคือ RLS ปุ่มที่ซ่อนเป็นแค่ความสะดวก
 */
export function canRecordProgress({ isManager, role, myDepartmentId, item, resolved } = {}) {
  if (!item || resolved?.source === 'civil') return false
  if (isManager) return true
  return (role === 'officer' || role === 'staff') && Boolean(myDepartmentId) && Boolean(item.department_id) && item.department_id === myDepartmentId
}

// ── ไตรมาส ───────────────────────────────────────────────────────────────

/**
 * ไตรมาส 1–4 ของวันที่ในปีงบ (พ.ศ.) · วันที่นอกปีงบนั้น/รูปแบบผิด → null (ไม่ยัดเข้าไตรมาสใกล้เคียง — เช่น เสร็จหลังสิ้นปีงบ)
 * ต.ค.–ธ.ค. = ไตรมาส 1 · ม.ค.–มี.ค. = 2 · เม.ย.–มิ.ย. = 3 · ก.ค.–ก.ย. = 4
 */
export function quarterOfDate(isoDate, fiscalYearBE) {
  if (!isIso(isoDate) || !Number.isInteger(Number(fiscalYearBE))) return null
  const iso = isoDay(isoDate)
  const { from, to } = fiscalYearBounds(fiscalYearBE)
  if (iso < from || iso > to) return null
  return quarterOfFiscalMonth(calendarToFiscalMonth(Number(iso.slice(5, 7))))
}

/**
 * ตรวจฟอร์มผลให้ตรงกับฐานข้อมูล → ข้อความไทย หรือ '' ถ้าผ่าน 
 *  done → ต้องมีวันแล้วเสร็จ (CHECK status='done' ⇔ done_on) · not_done → ต้องมีเหตุผล · วันที่ต้องไม่เกินวันนี้ (trigger)
 *  วันแล้วเสร็จต้องไม่ก่อน 1 ต.ค. ของปีงบ (trigger) และไม่ก่อนวันเริ่ม (CHECK date_order)
 */
export function validateProgressForm(form, { fiscalYear, today }) {
  if (form.status === 'none') return ''
  if (form.started_on && form.started_on > today) return 'วันเริ่มต้องไม่เกินวันนี้ (บันทึกสิ่งที่ทำแล้วเท่านั้น)'
  if (form.status === 'done') {
    if (!form.done_on) return 'แล้วเสร็จ ต้องระบุวันที่แล้วเสร็จ (ใช้คิดไตรมาส)'
    if (form.done_on > today) return 'วันที่แล้วเสร็จต้องไม่เกินวันนี้'
    if (form.done_on < fiscalYearBounds(fiscalYear).from) return `วันที่แล้วเสร็จอยู่ก่อนเริ่มปีงบประมาณ ${fiscalYear} (${thaiShortDate(fiscalYearBounds(fiscalYear).from)})`
    if (form.started_on && form.done_on < form.started_on) return 'วันที่แล้วเสร็จต้องไม่ก่อนวันเริ่ม'
  }
  if (form.status === 'not_done' && !form.reason.trim()) return 'ไม่ได้ดำเนินการ ต้องระบุเหตุผล'
  return ''
}

// ── แถวสำหรับตาราง/สรุป ──────────────────────────────────────────────────────

/**
 * รายการที่มีผล + ผลของแต่ละรายการ + ยุทธศาสตร์ (จาก local_dev_plan_projects.strategy ของ dev_project_id) · แถวละ 1 รายการ
 * progressByLineage = { [lineage_id]: แถวผล } · projects = ทะเบียนโครงการ
 * ยุทธศาสตร์ = ข้อความอิสระที่นักวิเคราะห์กรอก (ยังไม่มีรหัสยุทธศาสตร์ในฐานข้อมูล) → trim แล้วว่างนับเป็นไม่ระบุ
 */
export function buildProgressRows({ items, projects, progressByLineage, civilByRef, linkedRefs } = {}) {
  const projectById = new Map((projects ?? []).map(p => [p.id, p]))
  return (items ?? []).map(item => {
    const lineage = lineageOf(item)
    const project = item.dev_project_id ? (projectById.get(item.dev_project_id) ?? null) : null
    const resolved = resolveItemStatus({ item, progress: progressByLineage?.[lineage] ?? null, civilByRef, linkedRefs })
    return { item, lineage, project, strategy: textOrNull(project?.strategy), departmentId: item.department_id ?? null, amount: item.amount ?? null, resolved }
  })
}

const NO_GROUP_LABEL = 'ไม่ระบุ'

const emptyCount = () => ({ total: 0, none: 0, in_progress: 0, done: 0, not_done: 0, cents: 0 })
function addTo(count, row) {
  count.total += 1
  count[row.resolved?.status ?? 'none'] += 1
  count.cents += row.amount === null || row.amount === undefined || row.amount === '' ? 0 : Math.round(Number(row.amount) * 100)
}
const finish = (key, label, c) => ({
  key, label, total: c.total, none: c.none, in_progress: c.in_progress, done: c.done, not_done: c.not_done,
  amount: c.cents / 100, donePct: c.total ? Math.round((c.done / c.total) * 1000) / 10 : 0,
})

/**
 * สรุปตามยุทธศาสตร์หรือกอง → { groups: [{ key, label, total, none, in_progress, done, not_done, amount, donePct }], totals }
 * rows = ผลของ buildProgressRows · donePct = แล้วเสร็จ ÷ ทั้งหมด (นับรายการ ไม่ถ่วงเงิน) ปัด 1 ทศนิยม
 * groupBy 'department': ต้องส่ง departments [{ id, name }] เพื่อเรียงตามทะเบียนกองและแปลงชื่อ · ไม่มีกอง/ไม่พบกอง → "ไม่ระบุ" ไว้ท้าย
 * groupBy 'strategy': เรียงตามชื่อ (ตัวเลขนำหน้าเรียงตามค่า) · ไม่มีโครงการ/ไม่มียุทธศาสตร์ → "ไม่ระบุ" ไว้ท้าย
 */
export function summarize(rows, { groupBy = 'strategy', departments = [] } = {}) {
  const deptName = new Map((departments ?? []).map(d => [d.id, d.name]))
  const keyOf = row => {
    if (groupBy === 'department') return row.departmentId && deptName.has(row.departmentId) ? row.departmentId : null
    return row.strategy ?? null
  }
  const groups = new Map()
  const totals = emptyCount()
  for (const row of rows ?? []) {
    const key = keyOf(row)
    if (!groups.has(key)) groups.set(key, emptyCount())
    addTo(groups.get(key), row)
    addTo(totals, row)
  }
  const order = key => (groupBy === 'department' ? (departments ?? []).findIndex(d => d.id === key) : 0)
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    return groupBy === 'department' ? order(a) - order(b) : String(a).localeCompare(String(b), 'th', { numeric: true })
  })
  return {
    groups: keys.map(key => finish(key, key === null ? NO_GROUP_LABEL : (groupBy === 'department' ? deptName.get(key) : key), groups.get(key))),
    totals: finish('all', 'รวม', totals),
  }
}

// ── จับคู่โครงการก่อสร้าง ↔ ทะเบียนโครงการ ───────────────────────────────────────

/** ชื่อโครงการเทียบกันได้: เลขไทย→อารบิก · ตัดช่องว่าง/เครื่องหมาย · ตัดคำนำ "โครงการ" · ตัวพิมพ์เล็ก */
export function normalizeProjectName(name) {
  return toAsciiDigits(String(name ?? '')).normalize('NFC').toLowerCase()
    .replace(/[\s\u200b]+/g, '')
    .replace(/^โครงการ/, '')
    .replace(/[()[\]{}"'“”‘’.,;:\-–—_/\\]/g, '')
}

function bigrams(s) {
  const chars = [...s]
  const out = new Map()
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i] + chars[i + 1]
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** สัมประสิทธิ์ Dice ของ bigram 0–1 (สตริงเท่ากันเป๊ะ = 1 · สั้นกว่า 2 ตัวอักษรและไม่เท่ากัน = 0) */
export function diceSimilarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const ga = bigrams(a)
  const gb = bigrams(b)
  let na = 0
  let nb = 0
  let hit = 0
  for (const n of ga.values()) na += n
  for (const n of gb.values()) nb += n
  if (!na || !nb) return 0
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0)
  return (2 * hit) / (na + nb)
}

export const MATCH_MIN_SCORE = 0.5
const MATCH_YEAR_BONUS = 0.1

/**
 * เดาคู่ในทะเบียนให้โครงการก่อสร้าง (ระบบเสนอ คนกดเลือกเอง) — คะแนน = Dice ของชื่อ + โบนัส 0.1 ถ้าโครงการนั้นมีวงเงินของปีงบเดียวกัน (cap 1)
 * civilProject = { title, fiscal_year } · registryProjects = [{ id, official_name, status }] · years = [{ project_id, fiscal_year }]
 * ข้ามโครงการที่ตัดออกจากแผน (dropped) · คืน [{ project, score }] คะแนนมาก→น้อย สูงสุด limit ตัว เฉพาะที่ ≥ minScore
 */
export function suggestRegistryMatches(civilProject, registryProjects, years, { limit = 5, minScore = MATCH_MIN_SCORE } = {}) {
  const name = normalizeProjectName(civilProject?.title)
  if (!name) return []
  const fy = Number(toAsciiDigits(String(civilProject?.fiscal_year ?? '')).trim())
  const yearsOf = new Map()
  for (const y of years ?? []) {
    if (!yearsOf.has(y.project_id)) yearsOf.set(y.project_id, new Set())
    yearsOf.get(y.project_id).add(Number(y.fiscal_year))
  }
  return (registryProjects ?? [])
    .filter(p => p.status !== 'dropped')
    .map(project => {
      const base = diceSimilarity(name, normalizeProjectName(project.official_name))
      const bonus = Number.isInteger(fy) && yearsOf.get(project.id)?.has(fy) ? MATCH_YEAR_BONUS : 0
      return { project, score: Math.round(Math.min(1, base + bonus) * 100) / 100 }
    })
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score || String(a.project.official_name).localeCompare(String(b.project.official_name), 'th'))
    .slice(0, limit)
}

// ── รายการที่ "ถึงกำหนดแต่ยังไม่บันทึกผล" (การ์ดหน้าแรกเจ้าหน้าที่ + ป้ายเมนู) ──────────────────────
//
// ⚠️ สำเนาของ supabase/functions/_shared/localPlanMonthlyReminder.ts (previousMonthBangkok / dueKindOf / countDueByDepartment)
//    ที่ส่งแจ้งเตือน Telegram วันที่ 1 — เจ้าของระบบเลือกกติกาเดียวกัน (2569-11-09) ตัวเลขบนหน้าแรกจึงต้องเท่าข้อความในกลุ่ม
//    Edge Function ดึงไฟล์นอก supabase/functions ไม่ได้จึงต้องมีสองชุด · tests/local-plan-monthly-reminder.test.mjs
//    รันทั้งสองฝั่งด้วยข้อมูลชุดเดียวกันแล้วเทียบผล — แก้ฝั่งไหนต้องแก้อีกฝั่งในงานเดียวกัน
// ⚠️ "ถึงกำหนด" = เดือนเริ่ม/เดือนสิ้นสุดที่ อปท. ตั้งเองในแผนการดำเนินงาน ไม่ใช่กำหนดตามระเบียบ — ห้ามเขียนบนหน้าจอว่า "ผิดระเบียบ/ตามระเบียบ"

// ต้องตรงกับ MONTHS_TH_FULL ใน supabase/functions/_shared/localPlanMonthlyReminder.ts (เทสต์เทียบให้)
export const MONTHS_TH_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

const pad2 = n => String(n).padStart(2, '0')

/**
 * เดือนที่ "เพิ่งจบ" ตามเวลาไทย ณ เวลา now + ปีงบ/เดือนที่ของมัน — นับถึงสิ้นเดือนนั้น: รายการที่เดือนเริ่ม ≤ เดือนนั้นถือว่า "ถึงกำหนด"
 * ไม่อ่านนาฬิกาเครื่อง (ผู้เรียกส่ง now) · ใช้เวลาไทยเสมอ ไม่ว่าเครื่องตั้งโซนเวลาไหน
 * ⚠️ 1–31 ต.ค.: เดือนที่จบคือ ก.ย. (เดือนที่ 12 ของปีงบที่เพิ่งปิด) ⇒ ยังนับรายการของปีงบเก่าจนถึงสิ้นเดือน ตั้งแต่ 1 พ.ย. จึงย้ายไปปีงบใหม่
 *    ตรงกับ Telegram โดยตั้งใจ (ตามรายการปีที่เพิ่งปิดก่อนรายงานผล ธ.ค.) — ไม่ใช่บั๊ก
 * @returns {{ key: string, label: string, fiscalYear: number, fiscalMonth: number }} key = '2569-10' (พ.ศ. ปฏิทิน-เดือน)
 */
export function previousMonthBangkok(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const ceYearNow = Number(parts.find(p => p.type === 'year')?.value)
  const monthNow = Number(parts.find(p => p.type === 'month')?.value)
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

const dueMonthOf = v => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null
}

/**
 * รายการนี้ต้องเตือนไหม ณ สิ้นเดือนที่ fiscalMonth ของปีงบ → 'not_started' | 'past_end' | null
 *   status = ผลที่กองกดเอง ('none' = ยังไม่กดเลย) · civilLinked = ผูกโครงการก่อสร้างและพบโครงการของปีงบนี้
 *   - ผูกก่อสร้าง → ไม่เตือน (ระบบดึงผลจากงานก่อสร้างให้ กองกดเองไม่ได้ — canRecordProgress)
 *   - ไม่ระบุเดือน → ไม่เตือน · 'none' และเดือนเริ่ม ≤ เดือนที่จบ → not_started · 'in_progress' และเดือนสิ้นสุด ≤ เดือนที่จบ → past_end
 *   - done / not_done → บันทึกครบแล้ว ไม่เตือน
 */
export function dueKindOf({ item, status, civilLinked, fiscalMonth }) {
  if (civilLinked) return null
  const from = dueMonthOf(item?.month_from)
  if (from === null) return null
  const to = dueMonthOf(item?.month_to) ?? from
  if (status === 'none') return from <= fiscalMonth ? 'not_started' : null
  if (status === 'in_progress') return to <= fiscalMonth ? 'past_end' : null
  return null
}

/**
 * นับรายการแผนการดำเนินงานที่ถึงกำหนด (ชุดรายการที่มีผล = ฉบับประกาศแล้วของปีงบ ตาม effectiveItemSet)
 * progressByLineage = { [lineage_id]: สถานะ หรือ แถวผล {status} } · civilRefs = Set/Array ของทะเบียนโครงการที่มีโครงการก่อสร้างของปีงบนั้นผูกอยู่
 * departmentId = null → นับทุกรายการ (ผู้จัดการแผน) · ไม่ null → เฉพาะรายการที่ item.department_id ตรงกัน
 * @returns {{ notStarted: number, pastEnd: number }}
 */
export function countDueItems({ opPlans, items, fiscalYear, fiscalMonth, progressByLineage = {}, civilRefs = null, departmentId = null } = {}) {
  let notStarted = 0
  let pastEnd = 0
  for (const item of effectiveItemSet(opPlans, items, fiscalYear)) {
    if (departmentId !== null && item.department_id !== departmentId) continue
    const lineage = lineageOf(item)
    const p = lineage ? progressByLineage?.[lineage] : null
    const status = (typeof p === 'string' ? p : p?.status) || 'none'
    const civilLinked = Boolean(item.dev_project_id) && hasKey(civilRefs, String(item.dev_project_id))
    const kind = dueKindOf({ item, status, civilLinked, fiscalMonth })
    if (kind === 'not_started') notStarted += 1
    else if (kind === 'past_end') pastEnd += 1
  }
  return { notStarted, pastEnd }
}

// ── กำหนดเวลารายงานประจำปี (ข้อ 29(3)) ────────────────────────────────────────

/** ประกาศผลภายในกี่วันนับแต่วันที่ผู้บริหารเสนอสภา/คณะกรรมการพัฒนา — ข้อ 29(3) ระเบียบฉบับที่ 3 พ.ศ. 2561 */
export const EVALUATION_ANNOUNCE_DAYS = 15
export const EVALUATION_SOON_DAYS = 5

/**
 * นับวันประกาศผลการติดตามและประเมินผล: ภายใน 15 วันนับแต่วันเสนอ (presented_on) → dueOn
 * สมมติฐาน (เหมือนข้อ 27): นับวันปฏิทิน ไม่นับวันเสนอ — ต้องยืนยันกับตัวบทข้อ 29(3) ฉบับปัจจุบัน · เตือนเท่านั้น ไม่บล็อก
 * state: no_presented (ยังไม่มีวันเสนอ คำนวณไม่ได้) · open · soon · due_today · overdue · announced_on_time · announced_late
 */
export function evaluationDeadlines(evaluation, today = bangkokIsoDate()) {
  const presentedOn = isIso(evaluation?.presented_on) ? isoDay(evaluation.presented_on) : null
  const announcedOn = isIso(evaluation?.announced_on) ? isoDay(evaluation.announced_on) : null
  if (!presentedOn) return { state: 'no_presented', presentedOn: null, dueOn: null, daysLeft: null, announcedOn }
  const dueOn = addDays(presentedOn, EVALUATION_ANNOUNCE_DAYS)
  if (announcedOn) {
    return { state: announcedOn <= dueOn ? 'announced_on_time' : 'announced_late', presentedOn, dueOn, daysLeft: null, announcedOn }
  }
  const daysLeft = daysBetween(isoDay(today), dueOn)
  const state = daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due_today' : daysLeft <= EVALUATION_SOON_DAYS ? 'soon' : 'open'
  return { state, presentedOn, dueOn, daysLeft, announcedOn: null }
}

/** ข้อความแถบเตือนของ evaluationDeadlines · สถานะปกติ (ยังไม่ถึงเวลา/ไม่มีวันเสนอ/ประกาศทันกำหนด) → null */
export function evaluationWarningText(r) {
  if (!r || !r.dueOn) return null
  const due = thaiShortDate(r.dueOn)
  switch (r.state) {
    case 'soon': return `ใกล้ครบกำหนดประกาศผลการติดตามและประเมินผล (ข้อ 29(3)): เหลือ ${r.daysLeft} วัน · ครบ ${due}`
    case 'due_today': return `วันนี้ครบกำหนดประกาศผลการติดตามและประเมินผล (ข้อ 29(3)) · ${due}`
    case 'overdue': return `เกินกำหนดประกาศผลการติดตามและประเมินผล (ข้อ 29(3)) มา ${-r.daysLeft} วัน · กำหนด ${due}`
    case 'announced_late': return `ประกาศผลหลังวันครบกำหนด (ข้อ 29(3)) · กำหนด ${due}`
    default: return null
  }
}
