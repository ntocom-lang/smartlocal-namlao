// ตรรกะฝั่งหน้าจอของเมนู "แผนพัฒนาท้องถิ่น" — pure function ล้วน ไม่แตะฐานข้อมูล ไม่อ่านนาฬิกาเครื่อง (ทดสอบได้ด้วย node ตรงๆ)
//
// แยกจากคอมโพเนนต์เพราะกติกาพวกนี้ (ใครแก้อะไรได้ ฉบับถัดไปเลขอะไร คำเตือนอะไรขึ้น) ต้องตรวจย้อนได้ด้วยเทสต์
// ตัวบังคับจริงของสิทธิ์/การล็อกคือ RLS + trigger ในฐานข้อมูล (20261109100200) — ที่นี่แค่ทำให้หน้าจอไม่เสนอปุ่มที่กดแล้วล้ม
// ทุกฟังก์ชันที่ต้องรู้ "วันนี้" รับ today เป็น ISO string เสมอ
import { bangkokIsoDate } from './complaintReportPeriods.js'
import { devPlanAmendWindow, opPlanDeadline, warningText } from './localPlanDeadlines.js'

export const MENU_BASE_LABEL = 'แผนพัฒนาท้องถิ่น'

/**
 * ชื่อเมนู: "แผนพัฒนาท้องถิ่น (พ.ศ.2571-2575)" · ไม่มีแผน/ปีไม่ครบ → "แผนพัฒนาท้องถิ่น"
 * ช่วงปีอ่านจากข้อมูลแผนเสมอ ห้ามฝังปีในโค้ด (แผนฉบับถัดไปจะเปลี่ยนช่วงปีเอง)
 */
export function menuLabel(plan) {
  const from = Number(plan?.year_from)
  const to = Number(plan?.year_to)
  if (!plan || !Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to <= 0) return MENU_BASE_LABEL
  return from === to ? `${MENU_BASE_LABEL} (พ.ศ.${from})` : `${MENU_BASE_LABEL} (พ.ศ.${from}-${to})`
}

// ── ฉบับของแผนการดำเนินงาน ───────────────────────────────────────────────────

/**
 * ครั้งที่ของฉบับถัดไปในปีงบนี้ = ครั้งที่สูงสุดที่มี + 1 (ไม่มีฉบับเลย = 0 คือฉบับหลัก)
 * ฐานข้อมูลบังคับ UNIQUE (อปท., ปีงบ, revision_no) ข้ามชนิดฉบับ — เพิ่มเติมครั้งที่ 1 แล้วแก้ไขจึงเป็นครั้งที่ 2
 */
export function nextRevisionNo(opPlans, fiscalYear) {
  const nums = (opPlans ?? []).filter(p => Number(p.fiscal_year) === Number(fiscalYear)).map(p => Number(p.revision_no))
  return nums.length ? Math.max(...nums) + 1 : 0
}

/** ฉบับหลัก / เพิ่มเติมครั้งที่ n / แก้ไขครั้งที่ n */
export function versionLabel(opPlan) {
  if (!opPlan || opPlan.kind === 'main') return 'ฉบับหลัก'
  const n = Number(opPlan.revision_no)
  if (opPlan.kind === 'supplement') return `เพิ่มเติมครั้งที่ ${n}`
  if (opPlan.kind === 'amendment') return `แก้ไขครั้งที่ ${n}`
  return 'ฉบับหลัก'
}

/** ปีงบประมาณ (พ.ศ.) ของวันที่ ISO 'YYYY-MM-DD' — คำนวณจากสตริง ไม่ผ่านโซนเวลาเครื่อง · ต.ค.–ธ.ค. นับเป็นปีงบถัดไป */
export function fiscalYearOfIso(iso) {
  const year = Number(String(iso).slice(0, 4))
  const month = Number(String(iso).slice(5, 7))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null
  return year + 543 + (month >= 10 ? 1 : 0)
}

/** ฉบับล่าสุดของปีงบ (revision_no สูงสุด) — null ถ้าไม่มี */
export function latestOpPlan(opPlans, fiscalYear) {
  const list = (opPlans ?? []).filter(p => Number(p.fiscal_year) === Number(fiscalYear))
  return list.length ? list.reduce((a, b) => (Number(b.revision_no) > Number(a.revision_no) ? b : a)) : null
}

// ── สิทธิ์แก้รายการ (ตรงกับ trigger local_op_plan_items_guard) ────────────────────

/**
 * รายการนี้แก้อะไรได้ — ฉบับที่ประกาศแล้วแช่แข็งทุกคน · ผู้จัดการแก้ได้ทุกช่อง ·
 * officer/staff ของกองในแถวแก้ได้เฉพาะเดือน+หมายเหตุ (ฐานข้อมูลปฏิเสธช่องอื่นอยู่แล้ว)
 * คืน { months, note, all }
 */
export function canEditItem({ isManager, role, myDepartmentId, item, opPlan }) {
  const none = { months: false, note: false, all: false }
  if (!item || !opPlan || opPlan.status === 'published') return none
  if (isManager) return { months: true, note: true, all: true }
  if ((role === 'officer' || role === 'staff') && myDepartmentId && item.department_id && item.department_id === myDepartmentId) {
    return { months: true, note: true, all: false }
  }
  return none
}

// ── กดเดือนบนตาราง: เริ่ม → จบ ────────────────────────────────────────────────

/**
 * ตัวช่วยกดช่องเดือน 2 ครั้งเพื่อกำหนดช่วง · pending = เดือนเริ่มที่รอ (null = ยังไม่ได้กดอะไร)
 * กดครั้งแรก → รอเดือนจบ · กดครั้งที่สอง → ได้ช่วง; กดเดือนจบก่อนเดือนเริ่มให้สลับกันให้เอง (ไม่ปฏิเสธ)
 * คืน { pending, commit } — commit = { from, to } เมื่อได้ช่วงครบ ไม่งั้น null
 */
export function applyMonthClick(pending, month) {
  const m = Number(month)
  if (!Number.isInteger(m) || m < 1 || m > 12) return { pending: pending ?? null, commit: null }
  if (pending === null || pending === undefined) return { pending: m, commit: null }
  const start = Number(pending)
  return { pending: null, commit: m >= start ? { from: start, to: m } : { from: m, to: start } }
}

// ── เรียงลำดับ ───────────────────────────────────────────────────────────────

/**
 * เลื่อนรายการขึ้น/ลง 1 ที่ → คืนเฉพาะแถวที่ sort_order ต้องเปลี่ยน [{ id, sort_order }]
 * ลำดับตั้งใหม่เป็น 10, 20, 30… ทั้งชุด: แถวที่นำเข้ามามี sort_order เท่ากันหมด (0) การสลับค่ากับเพื่อนบ้านจึงไม่ขยับอะไร
 * items ต้องเรียงตามที่แสดงอยู่แล้ว · เลื่อนพ้นปลายแถว/ไม่พบ id → []
 */
export function reorderItems(items, itemId, direction) {
  const list = [...(items ?? [])]
  const i = list.findIndex(x => x.id === itemId)
  const j = direction === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= list.length) return []
  ;[list[i], list[j]] = [list[j], list[i]]
  return list
    .map((x, n) => ({ id: x.id, sort_order: (n + 1) * 10, before: x.sort_order }))
    .filter(x => x.sort_order !== x.before)
    .map(({ id, sort_order }) => ({ id, sort_order }))
}

/** ลำดับแสดงผลของรายการ: sort_order → seq_no (ว่างไว้ท้าย) → ชื่อ — ให้ผลคงที่เมื่อ sort_order เท่ากันหมด */
export function sortItems(items) {
  return [...(items ?? [])].sort((a, b) => {
    const so = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
    if (so) return so
    const sa = a.seq_no ?? Infinity
    const sb = b.seq_no ?? Infinity
    if (sa !== sb) return sa < sb ? -1 : 1
    return String(a.item_name ?? '').localeCompare(String(b.item_name ?? ''), 'th')
  })
}

/** เลขที่ถัดไปของคอลัมน์ "ที่" (max + 1) */
export function nextSeqNo(items) {
  const nums = (items ?? []).map(i => Number(i.seq_no)).filter(Number.isInteger)
  return nums.length ? Math.max(...nums) + 1 : 1
}

// ── เงิน ─────────────────────────────────────────────────────────────────────

const isBlank = v => v === null || v === undefined || v === ''

/** 1234567.5 → "1,234,567.50" · ว่าง → "—" (เขียนตัวคั่นเอง ไม่พึ่ง locale ของเครื่อง) */
export function formatBaht(value) {
  if (isBlank(value)) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`
}

/** ย่อสำหรับแถวรายการ: 1,200,000 → "1.2 ล้าน" · 500,000 → "500,000" · ว่าง → "—" */
export function abbrevBaht(value) {
  if (isBlank(value)) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return `${String(Math.round(n / 10_000) / 100)} ล้าน`
  return formatBaht(n).replace(/\.00$/, '')
}

/** ผลรวมงบ (ช่องว่างนับ 0) ปัดสตางค์เพื่อไม่ให้ทศนิยมลอย */
export function sumAmount(items) {
  const cents = (items ?? []).reduce((sum, i) => sum + (isBlank(i.amount) ? 0 : Math.round(Number(i.amount) * 100)), 0)
  return cents / 100
}

/**
 * อ่านช่องกรอกเงิน → { value: number|null, error: string } · ว่าง = null (ไม่ระบุ) ไม่ใช่ error
 * ตรงกับ numeric(15,2) CHECK >= 0 ของฐานข้อมูล
 */
export function parseAmountInput(raw) {
  const s = String(raw ?? '').replace(/,/g, '').trim()
  if (s === '') return { value: null, error: '' }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { value: null, error: 'งบประมาณต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง' }
  const n = Number(s)
  if (n >= 1e13) return { value: null, error: 'งบประมาณเกินกว่าที่ระบบรับได้' }
  return { value: n, error: '' }
}

/** วงเงินรายปีแบบย่อของโครงการ: "71: 500,000 · 72: 1.2 ล้าน" (ปี พ.ศ. 2 หลัก) · ไม่มีแถวปีเลย → "" */
export function yearsSummary(years) {
  return [...(years ?? [])]
    .sort((a, b) => a.fiscal_year - b.fiscal_year)
    .map(y => `${String(y.fiscal_year).slice(-2)}: ${abbrevBaht(y.amount)}`)
    .join(' · ')
}

// ── แถบ "ต้องดูแล" ───────────────────────────────────────────────────────────

const LEVEL_ORDER = { danger: 0, warn: 1, info: 2 }

/**
 * รวมคำเตือนของหน้าแผนทั้งหมด — "เตือนเท่านั้น ไม่บล็อก" (เจ้าหน้าที่ตัดสินเอง)
 * devPlan  : แผนพัฒนาที่กำลังดู · opPlans: แผนดำเนินงานทุกฉบับของแผนนี้ · items: รายการ (ต้องมี op_plan_id, source, dev_project_id)
 * projects : ทะเบียนโครงการของแผนนี้
 * คืน [{ level: 'danger'|'warn'|'info', text, rule }] เรียงจากเร่งด่วนสุด (ข้อมูลไม่พอ → ไม่เตือน ไม่เดา)
 */
export function buildAttention({ devPlan, opPlans, items, projects, today = bangkokIsoDate() } = {}) {
  const out = []

  // ข้อ 22: เพิ่มเติม/เปลี่ยนแปลงแผนพัฒนา เมื่อแผนเหลืออายุไม่ถึง 180 วัน
  const amend = devPlan ? devPlanAmendWindow(devPlan, today) : null
  const amendText = warningText(amend)
  if (amend && amendText) {
    out.push({ level: amend.state === 'expired' ? 'info' : 'warn', text: amendText, rule: 'ข้อ 22' })
  }

  // ข้อ 27: แผนดำเนินงานฉบับร่างแต่ละฉบับ นับ 30 วัน
  const drafts = (opPlans ?? []).filter(p => p.status === 'draft')
  for (const plan of drafts) {
    const result = opPlanDeadline(plan, today)
    const text = warningText(result)
    if (!text) continue
    const level = result.state === 'overdue' || result.state === 'due_today' ? 'danger'
      : result.state === 'soon' ? 'warn' : 'info'
    out.push({ level, text: `ปีงบ ${plan.fiscal_year} · ${versionLabel(plan)}: ${text}`, rule: 'ข้อ 27' })
  }

  // ข้อ 25: รายการของ อปท. เองในฉบับร่างที่ยังไม่ผูกทะเบียน (ฉบับที่ประกาศแล้วแก้ไม่ได้ จึงไม่นับ)
  const draftIds = new Set(drafts.map(p => p.id))
  const unlinked = (items ?? []).filter(i => draftIds.has(i.op_plan_id) && i.source === 'local' && !i.dev_project_id).length
  if (unlinked > 0) {
    out.push({ level: 'warn', text: `${unlinked} รายการในแผนการดำเนินงาน (ฉบับร่าง) ยังไม่ผูกทะเบียนโครงการ`, rule: 'ข้อ 25' })
  }

  const noDept = (projects ?? []).filter(p => p.status !== 'dropped' && !p.department_id).length
  if (noDept > 0) {
    out.push({ level: 'info', text: `${noDept} โครงการในทะเบียนยังไม่ระบุกองผู้รับผิดชอบ`, rule: 'ทะเบียนโครงการ' })
  }

  return out.map((x, i) => ({ x, i })).sort((a, b) => LEVEL_ORDER[a.x.level] - LEVEL_ORDER[b.x.level] || a.i - b.i).map(({ x }) => x)
}
