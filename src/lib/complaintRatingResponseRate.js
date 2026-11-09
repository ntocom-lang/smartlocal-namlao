// อัตราตอบแบบประเมินความพึงพอใจคำร้อง รายเดือน — ตรรกะล้วน (ไม่มี React/supabase)
// ใช้กับรายงานในเมนู "ผลประเมินความพึงพอใจ" (RatingResponseRateReport.jsx) และใบพิมพ์ (ratingResponseRatePrint.js)
//
// ทำไมมี: ใบสมัครรางวัลเลิศรัฐ (ประเภทตอบโจทย์ตรงใจ) ต้องมีตัวเลข "คำร้องที่ปิดแล้ว กี่เรื่องมีผู้ประเมิน"
// แยกตามที่มาของคะแนน — คะแนนที่ สท. กดแทน / ที่เดาเลขอ้างอิงเอา ไม่ใช่เสียงของผู้รับบริการตัวจริง
//
// ⚠️ ไฟล์นี้ต้องไม่ import supabase หรือ basename (ใช้ import.meta.env) — เทสต์รันด้วย node ตรงๆ
// ⚠️ ไม่อ่านนาฬิกาเอง (now ส่งเข้ามา) และไม่พึ่ง timezone ของเครื่อง — เดือนคิดตามเวลาไทย (UTC+7 ไม่มี DST)

const THAI_OFFSET_MS = 7 * 60 * 60 * 1000

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// สถานะที่นับว่า "ปิดเรื่องแล้ว" (ตัวหาร) — ต้องมี closed_at ด้วย
export const CLOSED_STATUSES = ['closed', 'completed']

// บทบาทฝั่งเจ้าหน้าที่ — ผู้ยื่นที่เป็นบทบาทเหล่านี้ไม่ใช่ "ประชาชนทั่วไป"
export const STAFF_ROLES = ['superadmin', 'admin', 'officer', 'viewer', 'staff', 'technician']

export const SUBMITTER_GROUPS = ['council', 'citizen', 'anonymous', 'staff', 'unknown']

export const SOURCE_KEYS = ['verified', 'via_link', 'proxy', 'linked_anon']

// ที่มาของคะแนนมี 5 แบบ น้ำหนักความน่าเชื่อถือไม่เท่ากัน (ย้ายมาจาก AdminDashboard.jsx — พฤติกรรมเดิมทุกกรณี)
//   verified    — ผูกกับคำร้อง และผู้ให้คะแนนคือผู้ยื่นคำร้องที่ล็อกอินแล้ว (ตรวจสอบย้อนกลับได้)
//                 ⚠️ เรื่องที่ สท. ยื่นแทนชาวบ้าน คะแนนชุดนี้คือความเห็นของ สท. ไม่ใช่ของชาวบ้าน
//   via_link    — ผู้ถือลิงก์ติดตามเรื่อง /t/<โทเคน> (ชาวบ้านที่ผู้ยื่นส่งลิงก์ให้) ไม่ได้ล็อกอิน
//   proxy       — สท. ถามชาวบ้านแล้วบันทึกแทน (rate_complaint_on_behalf, 20261111100100) คนกดคือ สท.
//   linked_anon — ผูกกับคำร้อง แต่ให้คะแนนผ่านการค้นด้วยเลขอ้างอิงโดยไม่ล็อกอิน (เลขเรียง เดาได้ เชื่อถือต่ำสุด)
//   general     — แบบประเมินภาพรวมหน่วยงาน (หน้า /satisfaction) ไม่ผูกคำร้อง ไม่ระบุตัวตนโดยเจตนา
// ลำดับตรวจ: proxy ก่อน via_link (CHECK ในฐานข้อมูลกันไม่ให้เป็นทั้งคู่อยู่แล้ว)
export function ratingSource(r) {
  if (r.rated_by_proxy) return 'proxy'
  if (!r.complaint_id) return 'general'
  if (r.is_verified) return 'verified'
  return r.via_link ? 'via_link' : 'linked_anon'
}

/**
 * ผู้ยื่นคำร้องเป็นใคร (อ่านจากบทบาทของบัญชี "ปัจจุบัน")
 * council = สท. · citizen = ประชาชนที่ล็อกอิน · anonymous = ไม่ล็อกอิน (user_id ว่าง) · staff = เจ้าหน้าที่
 * unknown = มี user_id แต่หาบทบาทไม่ได้ (RLS ไม่คืน/บัญชีถูกลบ/บทบาทที่ไม่รู้จัก) — ไม่เดาให้เป็นประชาชน
 * @param {{ user_id?: string|null }} complaint
 * @param {Map<string,string>|Record<string,string>|null|undefined} roleById
 */
export function submitterGroup(complaint, roleById) {
  const userId = complaint?.user_id
  if (!userId) return 'anonymous'
  const role = roleById instanceof Map ? roleById.get(userId) : roleById?.[userId]
  if (!role) return 'unknown'
  if (role === 'council') return 'council'
  if (role === 'citizen') return 'citizen'
  if (STAFF_ROLES.includes(role)) return 'staff'
  return 'unknown'
}

// ───── เวลาไทย ─────
function toMs(value) {
  if (value == null || value === '') return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

// เดือนตามปฏิทินไทย → { y: ปี ค.ศ., m: 0–11 }
function thaiYearMonth(ms) {
  const d = new Date(ms + THAI_OFFSET_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
}

const monthIndex = ({ y, m }) => y * 12 + m
const monthKeyOf = index => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`

/** 'ต.ค. 2569' — เดือน พ.ศ. จากเลขเดือนรวม (ปี ค.ศ. × 12 + เดือน 0–11) */
export function monthLabelOf(index) {
  return `${THAI_MONTHS_SHORT[index % 12]} ${Math.floor(index / 12) + 543}`
}

/** 'D/M/YYYY' (พ.ศ.) ตามเวลาไทย ของเวลา ms — ใช้เป็น "ข้อมูล ณ วันที่" */
export function thaiDateText(ms) {
  const d = new Date(ms + THAI_OFFSET_MS)
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear() + 543}`
}

/** 'D/M/YYYY HH:MM' (พ.ศ.) ตามเวลาไทย */
export function thaiDateTimeText(ms) {
  const d = new Date(ms + THAI_OFFSET_MS)
  const p = n => String(n).padStart(2, '0')
  return `${thaiDateText(ms)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** 'YYYY-MM-DD' (ค.ศ.) ตามเวลาไทย — ใช้ตั้งชื่อไฟล์ */
export function thaiIsoDate(ms) {
  return new Date(ms + THAI_OFFSET_MS).toISOString().slice(0, 10)
}

// ───── ตัวสะสม ─────
const newCell = () => ({ complaints: new Set(), sum: 0, cnt: 0 })

function newBucket() {
  return {
    closed: 0,
    submitters: { council: 0, citizen: 0, anonymous: 0, staff: 0, unknown: 0 },
    cells: { verified: newCell(), via_link: newCell(), proxy: newCell(), linked_anon: newCell(), genuine: newCell() },
    anyRated: new Set(),
    general: { n: 0, sum: 0 },
  }
}

const pctOf = (n, closed) => (closed > 0 ? (n / closed) * 100 : null)
const avgOf = (sum, cnt) => (cnt > 0 ? sum / cnt : null)

function finalize(bucket) {
  const closed = bucket.closed
  const cell = c => ({ n: c.complaints.size, pct: pctOf(c.complaints.size, closed), avg: avgOf(c.sum, c.cnt) })
  return {
    closed,
    submitters: { ...bucket.submitters },
    verified: cell(bucket.cells.verified),
    via_link: cell(bucket.cells.via_link),
    proxy: cell(bucket.cells.proxy),
    linked_anon: cell(bucket.cells.linked_anon),
    anyRated: { n: bucket.anyRated.size, pct: pctOf(bucket.anyRated.size, closed), avg: null },
    genuine: cell(bucket.cells.genuine),
    general: { n: bucket.general.n, avg: avgOf(bucket.general.sum, bucket.general.n) },
  }
}

/**
 * รวมเป็นรายเดือน (เดือนที่ปิดเรื่อง เวลาไทย) + แถวรวม
 *
 * @param {object} input
 * @param {Array<{id:string,status:string,closed_at:string|null,category:string|null,user_id:string|null,rating:number|null}>} input.complaints
 * @param {Array<{complaint_id:string|null,rating:number,is_verified:boolean,via_link:boolean,rated_by_proxy:boolean,created_at:string}>} input.ratings
 * @param {string[]|Set<string>} [input.adhocValues] ค่า complaint_categories.value ที่ is_adhoc = true (ตัดออกจากตัวหาร ตามกติกา complaint_category_is_adhoc)
 * @param {Map<string,string>|Record<string,string>} [input.roleById]
 * @param {Date|number|string} [input.now]
 * @returns {{ months: Array<object>, total: object, firstMonthLabel: string|null }}
 *   months เรียงเก่า→ใหม่ แต่ละแถว = { key, label, ...ผลของ finalize }
 *
 * "genuine" (เสียงผู้รับบริการตัวจริง) = เรื่องที่มี via_link หรือ (verified และผู้ยื่นเป็น citizen)
 * ไม่นับ proxy (คนกดคือ สท.) · linked_anon (ยืนยันตัวไม่ได้) · verified ของ council/staff/unknown/anonymous
 */
export function buildMonthlyResponseRate({ complaints = [], ratings = [], adhocValues = [], roleById = null, now = Date.now() } = {}) {
  const adhoc = adhocValues instanceof Set ? adhocValues : new Set(adhocValues ?? [])
  const nowMs = toMs(now) ?? Date.now()

  // 1) ตัวหาร: เรื่องที่ปิดแล้ว ไม่ใช่หมวดเฉพาะกิจ
  const denominator = new Map() // id → { month, group, rating }
  for (const c of complaints) {
    if (!c || !CLOSED_STATUSES.includes(c.status)) continue
    const closedMs = toMs(c.closed_at)
    if (closedMs === null) continue
    if (c.category != null && adhoc.has(c.category)) continue
    denominator.set(c.id, { month: monthIndex(thaiYearMonth(closedMs)), group: submitterGroup(c, roleById), legacyRating: c.rating })
  }

  // 2) คะแนนที่ผูกคำร้องในตัวหาร / คะแนนภาพรวม
  const bound = [] // { id, month, source, rating }
  const verifiedIds = new Set()
  const generalRows = [] // { month, rating }
  for (const r of ratings) {
    if (!r) continue
    const source = ratingSource(r)
    if (source === 'general') {
      const ms = toMs(r.created_at)
      if (ms !== null) generalRows.push({ month: monthIndex(thaiYearMonth(ms)), rating: Number(r.rating) })
      continue
    }
    const d = denominator.get(r.complaint_id)
    if (!d) continue // ชี้ไปเรื่องที่ไม่อยู่ในตัวหาร (ยังไม่ปิด/เฉพาะกิจ/ไม่อยู่ในชุดข้อมูล) ไม่นับ
    bound.push({ id: r.complaint_id, month: d.month, group: d.group, source, rating: Number(r.rating) })
    if (source === 'verified') verifiedIds.add(r.complaint_id)
  }
  // legacy: complaints.rating เดิม (ก่อนมีตาราง ratings) ถ้าไม่มีแถว verified ใน ratings ให้นับเป็น verified
  for (const [id, d] of denominator) {
    if (d.legacyRating == null || verifiedIds.has(id)) continue
    const value = Number(d.legacyRating)
    if (!Number.isFinite(value)) continue
    bound.push({ id, month: d.month, group: d.group, source: 'verified', rating: value })
  }

  // 3) ช่วงเดือน: เดือนแรกที่มีเรื่องปิด (หรือมีคะแนนภาพรวมก่อนหน้านั้น) → เดือนปัจจุบัน (หรือเดือนปิดล่าสุดถ้าล้ำอนาคต)
  const lows = [...denominator.values()].map(d => d.month).concat(generalRows.map(g => g.month))
  if (!lows.length) return { months: [], total: finalize(newBucket()), firstMonthLabel: null }
  const first = Math.min(...lows)
  const last = Math.max(monthIndex(thaiYearMonth(nowMs)), ...[...denominator.values()].map(d => d.month), ...generalRows.map(g => g.month))

  const buckets = new Map()
  for (let i = first; i <= last; i++) buckets.set(i, newBucket())
  const total = newBucket()
  // ตัวสะสมของแถวรวมต้องนับเรื่อง "ไม่ซ้ำ" ข้ามเดือน — แต่ 1 เรื่องอยู่ได้เดือนเดียว (เดือนที่ปิด) จึงรวมด้วย Set เดียวกันได้ตรงๆ
  const addTo = (b, fn) => { fn(b); fn(total) }

  for (const d of denominator.values()) {
    addTo(buckets.get(d.month), b => { b.closed++; b.submitters[d.group]++ })
  }
  for (const r of bound) {
    const isGenuine = r.source === 'via_link' || (r.source === 'verified' && r.group === 'citizen')
    addTo(buckets.get(r.month), b => {
      const cell = b.cells[r.source]
      cell.complaints.add(r.id)
      if (Number.isFinite(r.rating)) { cell.sum += r.rating; cell.cnt++ }
      b.anyRated.add(r.id)
      if (isGenuine) {
        b.cells.genuine.complaints.add(r.id)
        if (Number.isFinite(r.rating)) { b.cells.genuine.sum += r.rating; b.cells.genuine.cnt++ }
      }
    })
  }
  for (const g of generalRows) {
    addTo(buckets.get(g.month), b => { b.general.n++; if (Number.isFinite(g.rating)) b.general.sum += g.rating })
  }

  const months = []
  for (let i = first; i <= last; i++) months.push({ key: monthKeyOf(i), label: monthLabelOf(i), ...finalize(buckets.get(i)) })
  return { months, total: finalize(total), firstMonthLabel: monthLabelOf(first) }
}

// ───── แสดงผล ─────
/** 'n (xx%)' — closed = 0 แสดง '–' ไม่หารศูนย์ */
export function cellText(cell) {
  if (!cell) return '–'
  if (cell.pct === null || cell.pct === undefined) return cell.n > 0 ? String(cell.n) : '–'
  return `${cell.n} (${cell.pct.toFixed(1)}%)`
}

export const avgText = avg => (avg === null || avg === undefined ? '–' : avg.toFixed(2))

/** 'สท. 2 · ปชช. 5 · ไม่ล็อกอิน 1' — ตัวหารแยกตามผู้ยื่น (เจ้าหน้าที่/ไม่ทราบ แสดงเมื่อมี) */
export function submittersText(s) {
  const parts = [`สท. ${s.council}`, `ประชาชน ${s.citizen}`, `ไม่ล็อกอิน ${s.anonymous}`]
  if (s.staff) parts.push(`เจ้าหน้าที่ ${s.staff}`)
  if (s.unknown) parts.push(`ไม่ทราบ ${s.unknown}`)
  return parts.join(' · ')
}

// ───── CSV ─────
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const CSV_HEADERS = [
  'เดือนที่ปิดเรื่อง', 'ปิดแล้ว (เรื่อง)', 'ผู้ยื่น: สท.', 'ผู้ยื่น: ประชาชน', 'ผู้ยื่น: ไม่ล็อกอิน', 'ผู้ยื่น: เจ้าหน้าที่', 'ผู้ยื่น: ไม่ทราบ',
  'ผู้ยื่นเอง (เรื่อง)', 'ผู้ยื่นเอง (%)', 'ผ่านลิงก์ (เรื่อง)', 'ผ่านลิงก์ (%)', 'สท. บันทึกแทน (เรื่อง)', 'สท. บันทึกแทน (%)',
  'เลขอ้างอิง (เรื่อง)', 'เลขอ้างอิง (%)', 'มีคะแนนอย่างน้อย 1 ช่อง (เรื่อง)', 'มีคะแนนอย่างน้อย 1 ช่อง (%)',
  'เสียงผู้รับบริการตัวจริง (เรื่อง)', 'เสียงผู้รับบริการตัวจริง (%)', 'คะแนนเฉลี่ย ผู้ยื่นเอง', 'คะแนนเฉลี่ย ผ่านลิงก์', 'คะแนนเฉลี่ย สท. บันทึกแทน',
  'คะแนนเฉลี่ย เลขอ้างอิง', 'คะแนนเฉลี่ย เสียงผู้รับบริการตัวจริง', 'ประเมินภาพรวม ไม่ผูกคำร้อง (ครั้ง)', 'คะแนนเฉลี่ย ภาพรวม',
]

const pctCsv = cell => (cell.pct === null ? '' : cell.pct.toFixed(1))
const avgCsv = avg => (avg === null ? '' : avg.toFixed(2))

function csvRow(label, row) {
  return [
    label, row.closed, row.submitters.council, row.submitters.citizen, row.submitters.anonymous, row.submitters.staff, row.submitters.unknown,
    row.verified.n, pctCsv(row.verified), row.via_link.n, pctCsv(row.via_link), row.proxy.n, pctCsv(row.proxy),
    row.linked_anon.n, pctCsv(row.linked_anon), row.anyRated.n, pctCsv(row.anyRated), row.genuine.n, pctCsv(row.genuine),
    avgCsv(row.verified.avg), avgCsv(row.via_link.avg), avgCsv(row.proxy.avg), avgCsv(row.linked_anon.avg), avgCsv(row.genuine.avg),
    row.general.n, avgCsv(row.general.avg),
  ]
}

/**
 * CSV รายงานอัตราตอบ — ขึ้นต้น BOM ให้ Excel ภาษาไทยอ่านเป็น UTF-8 · เดือนเรียงเก่า→ใหม่ · ท้ายมีแถวรวม
 * @param {{ months: Array<object>, total: object }} result ผลของ buildMonthlyResponseRate
 * @param {{ orgName?: string, asOfText?: string }} [meta] ใส่เป็นบรรทัดหัวไฟล์ (ชื่อ อปท. + ข้อมูล ณ วันที่)
 */
export function responseRateCsv(result, meta = {}) {
  const lines = []
  if (meta.orgName) lines.push([csvCell(meta.orgName), csvCell('อัตราตอบแบบประเมินความพึงพอใจคำร้อง รายเดือน (นับตามเดือนที่ปิดเรื่อง)')].join(','))
  if (meta.asOfText) lines.push(csvCell(`ข้อมูล ณ วันที่ ${meta.asOfText}`))
  lines.push(CSV_HEADERS.map(csvCell).join(','))
  for (const m of result.months) lines.push(csvRow(m.label, m).map(csvCell).join(','))
  lines.push(csvRow('รวม', result.total).map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
