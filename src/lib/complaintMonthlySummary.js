// สรุปเรื่องร้องเรียนรายเดือน (หน้า /reports/complaints โหมด "รายเดือน" + ใบพิมพ์ A4)
//
// ที่มา: เทศบาลนครยะลาเผยแพร่ "สรุปเรื่องร้องเรียนประจำเดือน" เป็น PDF ทุกเดือนซึ่งทำด้วยมือ
// (ดูแผนเฟส 1 ที่เจ้าของระบบอนุมัติ 2569-10-18) ที่นี่ให้ระบบคำนวณจาก RPC สาธารณะที่มีอยู่แล้ว
// (complaint_stats_fy / complaints_public_fy รับช่วงวันที่ใดก็ได้ ไม่คืนชื่อ เบอร์ รายละเอียด หมู่บ้าน พิกัด)
//
// ⚠️ ข้อความสรุปมาจากแม่แบบตายตัว ไม่ใช้ AI และ "ไม่ประเมินผลงานตัวเอง" (ไม่มีคำว่าน่าพอใจ/ดีเยี่ยม)
// มีแต่ตัวเลขกับลำดับ เพื่อให้ตรวจย้อนได้ทุกคำ
//
// ⚠️ ร้อยละแล้วเสร็จ = สถานะ "ปัจจุบัน" ของเรื่องที่รับในเดือนนั้น ไม่ใช่สถานะ ณ สิ้นเดือน
// เดือนที่ปิดไปแล้วจึงขยับได้ถ้ามีเรื่องแล้วเสร็จทีหลัง — ใบที่พิมพ์ต้องบอกวันที่ของข้อมูลเสมอ
// เฟส 2: เจ้าหน้าที่กด "ล็อกตัวเลข" ได้ (ตาราง complaint_monthly_snapshots, migration 20261019140000) ชุดที่ล็อกส่งเข้ามาทาง
// categoryCounts/lock — "ณ วันที่" เป็นวันที่ล็อก ดู complaintMonthlyLock.js
//
// ไฟล์นี้ต้องไม่ import supabase/React — เทสต์รันด้วย node ตรงๆ

export const MONTHS_TH_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

// หมวดที่แสดงได้ก่อนพับส่วนที่เหลือรวมกัน — ภาพเดียวต้องอ่านได้ (ใบ A4 หน้าเดียวพอดี)
export const MAX_CATEGORY_ROWS = 8

// ตัวเลือกเดือนย้อนหลังกี่เดือน (ใช้ทั้งดรอปดาวน์และเพดานที่ parseMonthParam ยอมรับ)
export const MONTH_OPTION_COUNT = 24

// ชื่อแถวของเรื่องที่ไม่มีลักษณะปัญหา — เรื่องก่อน 2026-08-24, เรื่องที่รับที่เคาน์เตอร์ และค่าที่ฟังก์ชันฐานข้อมูล
// ไม่ยอมส่งออก (นอกรายการอนุญาต) ทั้งหมดมาเป็นแถวนี้ ไม่ซ่อนและไม่เดาเป็นลักษณะอื่น
export const UNSPECIFIED_ISSUE_LABEL = 'ไม่ระบุลักษณะ'

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/
const pad2 = n => String(n).padStart(2, '0')

const numberFormat = new Intl.NumberFormat('th-TH')
export const formatCount = n => numberFormat.format(Number(n) || 0)

// ปัดทศนิยม 1 ตำแหน่ง ไม่ใส่ .0 ท้ายเลขกลม (100 ไม่ใช่ 100.0)
export const formatDecimal = n => (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 1 })
export const formatPercent = formatDecimal
const percentOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)

const daysInMonth = (ceYear, month) => new Date(Date.UTC(ceYear, month, 0)).getUTCDate()

// เดือน/ปีปัจจุบันตามเวลาไทย — เครื่องเจ้าหน้าที่อาจตั้งโซนเวลาอื่น (เทสต์ตั้ง TZ ต่างประเทศ)
function bangkokYearMonth(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .formatToParts(now)
  return { ceYear: Number(parts.find(p => p.type === 'year').value), month: Number(parts.find(p => p.type === 'month').value) }
}

/**
 * ช่วงของเดือน — from/to เป็น YYYY-MM-DD (to = วันสุดท้ายที่นับรวม ตามที่ RPC _fy คาดหวัง)
 * @param {number} beYear ปี พ.ศ.
 * @param {number} month 1-12
 */
export function monthPeriod(beYear, month) {
  const ceYear = beYear - 543
  return {
    key: `${beYear}-${pad2(month)}`,
    beYear,
    ceYear,
    month,
    label: `${MONTHS_TH_FULL[month - 1]} ${beYear}`,
    from: `${ceYear}-${pad2(month)}-01`,
    to: `${ceYear}-${pad2(month)}-${pad2(daysInMonth(ceYear, month))}`,
  }
}

/**
 * อ่านค่า ?m=2569-04 จาก URL — ค่าที่ผิดรูปแบบ/เป็นอนาคต/ไกลเกินคืน null
 * (หน้าตกกลับไปโหมดปีงบ ไม่ใช่หน้าพัง เหมือนที่ useFiscalYearParam ทำกับ ?fy=)
 * @param {string | null | undefined} raw
 * @param {Date} [now]
 */
export function parseMonthParam(raw, now = new Date()) {
  const match = MONTH_PARAM.exec(String(raw ?? ''))
  if (!match) return null
  const beYear = Number(match[1])
  const month = Number(match[2])
  const current = bangkokYearMonth(now)
  const ceYear = beYear - 543
  if (ceYear * 12 + month > current.ceYear * 12 + current.month) return null
  // ย้อนได้ไม่เกินช่วงที่ตัวเลือกให้ (MONTH_OPTION_COUNT) — ปีที่ไกลกว่านั้นไม่มีข้อมูลระบบให้ดึงอยู่แล้ว
  if (ceYear * 12 + month < current.ceYear * 12 + current.month - (MONTH_OPTION_COUNT - 1)) return null
  return monthPeriod(beYear, month)
}


/** ตัวเลือกเดือน เรียงใหม่→เก่า เริ่มที่เดือนปัจจุบัน */
export function recentMonthOptions(count = MONTH_OPTION_COUNT, now = new Date()) {
  const { ceYear, month } = bangkokYearMonth(now)
  const options = []
  for (let i = 0; i < count; i++) {
    const index = ceYear * 12 + (month - 1) - i
    options.push(monthPeriod(Math.floor(index / 12) + 543, (index % 12) + 1))
  }
  return options
}

/** เดือนล่าสุดที่จบครบแล้ว — ค่าตั้งต้นเมื่อกดสลับมาโหมดรายเดือน (เดือนนี้ยังไม่ครบ ตัวเลขยังไม่นิ่ง) */
export function lastFullMonth(now = new Date()) {
  return recentMonthOptions(2, now)[1]
}

export function isCurrentMonth(period, now = new Date()) {
  const current = bangkokYearMonth(now)
  return period.ceYear === current.ceYear && period.month === current.month
}

export function thaiLongDate(now = new Date()) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now)
}

function joinThai(items) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(' ')} และ ${items[items.length - 1]}`
}

/**
 * รายการย่อยใต้หมวด จากฟังก์ชัน complaint_issue_breakdown_fy (ยอดนับที่กรองรายการอนุญาตแล้ว ไม่มีข้อความดิบ)
 * คืน null เมื่อไม่ควรแสดง: ไม่มีข้อมูล · ผลรวมไม่เท่ายอดของหมวด (สองคำสั่งอ่านฐานข้อมูลคนละจังหวะ มีเรื่องเข้ามาคั่นได้
 * ดีกว่าไม่แสดงรอบนี้ แล้วรอบรีเฟรชถัดไปจะตรงเอง) · มีแต่ "ไม่ระบุลักษณะ" (ไม่ได้บอกอะไรเพิ่ม)
 * @param {{ count: number }} category
 * @param {Array<{ issue_label: string | null, total: number | string }>} breakdownRows
 */
function issueSubItems(category, breakdownRows) {
  const items = (breakdownRows ?? [])
    .map(row => ({ label: row.issue_label || UNSPECIFIED_ISSUE_LABEL, count: Number(row.total) || 0, specified: !!row.issue_label }))
    .filter(item => item.count > 0)
  if (!items.length || items.reduce((sum, item) => sum + item.count, 0) !== category.count) return null
  if (!items.some(item => item.specified)) return null
  // ฐานข้อมูลเรียงให้แล้ว (มาก→น้อย ไม่ระบุอยู่ท้าย) — ไม่เรียงซ้ำ เพื่อไม่ให้สองที่เรียงไม่เหมือนกัน
  return items.map(({ label, count }) => ({ label, count }))
}

/**
 * @param {object} args
 * @param {{ total?: number, open?: number, in_progress?: number, resolved?: number, rejected?: number, avg_days?: number | null } | null} args.stats  จาก RPC complaint_stats_fy
 * @param {Array<{ category: string }>} args.rows  จาก complaints_public_fy (มี LIMIT) — ใช้นับหมวดเท่านั้น
 * @param {{ category: string, rows: Array<{ issue_label: string | null, total: number | string }> } | null} [args.issueBreakdown]
 *   ยอดแยกตามลักษณะปัญหาของหมวดเดียว (ตอนนี้ light) — ไม่ส่ง = ไม่มีรายการย่อย
 * @param {(code: string) => string} args.labelOf  ชื่อหมวดภาษาไทย (categoryNameOf) — รหัสดิบห้ามหลุด
 * @param {string} args.tenantName
 * @param {ReturnType<typeof monthPeriod>} args.period
 * @param {Date} [args.now]
 * @param {Array<{ category: string, total: number | string }> | null} [args.categoryCounts]
 *   ยอดรายหมวดที่นับมาแล้ว (ชุดที่ล็อกไว้) — ส่งมา = ใช้แทน rows และถือว่าครบ ไม่ติดเพดานของ rows
 * @param {{ publishedAt: string | Date, revision: number } | null} [args.lock]
 *   ชุดตัวเลขนี้ถูกล็อกไว้ (เฟส 2) — "ณ วันที่" เป็นวันที่ล็อก ไม่ใช่วันที่เปิดดู และหมายเหตุบอกว่าล็อกเมื่อไร
 */
export function summarizeMonth({
  stats, rows, labelOf, tenantName, period, issueBreakdown = null, now = new Date(), categoryCounts = null, lock = null,
}) {
  const total = Number(stats?.total) || 0
  const resolved = Number(stats?.resolved) || 0
  const ongoing = (Number(stats?.open) || 0) + (Number(stats?.in_progress) || 0)
  const rejected = Number(stats?.rejected) || 0

  // นับหมวดได้ก็ต่อเมื่อดึงรายการมาครบทุกเรื่อง — ถ้าถูกตัดที่ LIMIT สัดส่วนจะเพี้ยนเงียบๆ จึงไม่แสดงเลย
  // ชุดที่ล็อกไว้นับมาที่ฐานข้อมูลครบทุกเรื่องแล้ว (GROUP BY ไม่มีเพดาน) จึงไม่ติดเงื่อนไขนี้
  const categoriesComplete = categoryCounts !== null || total === 0 || (rows?.length ?? 0) >= total
  const counts = new Map()
  if (categoryCounts !== null) {
    for (const entry of categoryCounts) counts.set(entry.category, (counts.get(entry.category) ?? 0) + (Number(entry.total) || 0))
  } else if (categoriesComplete) {
    for (const row of rows ?? []) counts.set(row.category, (counts.get(row.category) ?? 0) + 1)
  }
  const sorted = [...counts.entries()]
    .map(([code, count]) => ({ code, label: labelOf(code), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th'))
  const shown = sorted.length > MAX_CATEGORY_ROWS ? sorted.slice(0, MAX_CATEGORY_ROWS - 1) : sorted
  const folded = sorted.slice(shown.length)
  const categories = shown.map(c => {
    const category = { ...c, percent: percentOf(c.count, total) }
    const subItems = issueBreakdown && c.code === issueBreakdown.category ? issueSubItems(c, issueBreakdown.rows) : null
    return subItems ? { ...category, subItems } : category
  })
  if (folded.length) {
    const count = folded.reduce((sum, c) => sum + c.count, 0)
    // ตั้งชื่อ "หมวดที่เหลือ" ไม่ใช้คำว่า "อื่นๆ" เพราะชนกับหมวดจริงชื่อ "อื่นๆ" (รหัส other)
    categories.push({ code: null, label: `หมวดที่เหลือ (${folded.length} หมวด)`, count, percent: percentOf(count, total) })
  }

  const lockedAt = lock ? new Date(lock.publishedAt) : null
  const lockValid = lockedAt !== null && !Number.isNaN(lockedAt.getTime())
  const current = lockValid ? false : isCurrentMonth(period, now)
  // ชุดที่ล็อก: "ณ วันที่" คือวันที่ล็อก (ตัวเลขนิ่งตั้งแต่วันนั้น) — วันที่เปิดดูไม่เกี่ยว
  const asOf = thaiLongDate(lockValid ? lockedAt : now)
  const resolvedPercent = percentOf(resolved, total)

  const sentences = []
  if (total === 0) {
    sentences.push(`ในเดือน${period.label} ไม่มีเรื่องร้องเรียน/ร้องทุกข์ที่รับผ่านระบบ e-Service ของ${tenantName}`)
  } else {
    sentences.push(`ในเดือน${period.label} ${tenantName}รับเรื่องร้องเรียน/ร้องทุกข์ผ่านระบบ e-Service ทั้งหมด ${formatCount(total)} เรื่อง`)
    const top = categories.filter(c => c.code !== null).slice(0, 3)
    if (categoriesComplete && top.length === 1) {
      sentences.push(`ทุกเรื่องอยู่ในหมวด${top[0].label}`)
    } else if (categoriesComplete && top.length > 1) {
      sentences.push(`หมวดที่มีจำนวนเรื่องสูงสุดตามลำดับ ได้แก่ ${joinThai(top.map(c => `${c.label} ${formatCount(c.count)} เรื่อง (ร้อยละ ${formatPercent(c.percent)})`))}`)
    }
    const status = [`ดำเนินการแล้วเสร็จ ${formatCount(resolved)} เรื่อง (ร้อยละ ${formatPercent(resolvedPercent)})`, `อยู่ระหว่างดำเนินการ ${formatCount(ongoing)} เรื่อง`]
    if (rejected) status.push(`ไม่รับเรื่อง/ยกเลิก ${formatCount(rejected)} เรื่อง`)
    sentences.push(joinThai(status))
  }

  const notes = []
  if (lockValid) {
    // ล็อกซ้ำ (revision ≥ 2) = มีการแก้ตัวเลขหลังเผยแพร่ครั้งแรก ต้องบอกให้ผู้อ่านรู้ ไม่ปล่อยให้ดูเหมือนชุดแรก
    const revisionText = Number(lock.revision) > 1 ? ` (แก้ไขครั้งที่ ${Number(lock.revision) - 1})` : ''
    notes.push(`ตัวเลขชุดนี้ล็อกไว้เมื่อวันที่ ${asOf}${revisionText} ร้อยละที่แล้วเสร็จนับจากสถานะ ณ วันนั้นของเรื่องที่รับในเดือนนี้ จึงอาจต่างจากสถานะปัจจุบัน`)
  } else if (total > 0) {
    notes.push(`ร้อยละที่แล้วเสร็จนับจากสถานะ ณ วันที่ ${asOf} ของเรื่องที่รับในเดือนนี้ ตัวเลขอาจเปลี่ยนเมื่อมีเรื่องแล้วเสร็จภายหลัง`)
  }
  if (current) notes.push('เดือนนี้ยังไม่สิ้นสุด ตัวเลขเป็นยอดสะสมจนถึงวันที่ข้างต้น')
  if (!categoriesComplete) notes.push(`ไม่แสดงสัดส่วนตามหมวด เพราะจำนวนเรื่องเกินที่ดึงมาคำนวณได้ในครั้งเดียว (${formatCount(rows?.length ?? 0)} จาก ${formatCount(total)} เรื่อง)`)

  return {
    period,
    total,
    resolved,
    resolvedPercent,
    ongoing,
    ongoingPercent: percentOf(ongoing, total),
    rejected,
    rejectedPercent: percentOf(rejected, total),
    avgDays: stats?.avg_days ?? null,
    categories,
    categoriesComplete,
    narrative: sentences.join(' '),
    sentences,
    notes,
    asOf,
    isCurrentMonth: current,
    locked: lockValid ? { asOf, revision: Number(lock.revision) || 1 } : null,
  }
}
