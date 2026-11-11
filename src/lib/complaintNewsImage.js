// ภาพ "ข่าวประชาสัมพันธ์ผลการดำเนินงาน" ของคำร้องที่ดำเนินการแล้ว — เจ้าหน้าที่ดาวน์โหลด/แชร์ลง LINE หรือเพจ
// (เจ้าของระบบอนุมัติ 2569-11-11) PNG 1080×1350 ขึ้นไป วาดเป็นสตริง SVG แบบเดียวกับภาพสรุปรายเดือน
// และใช้ตัวตัดบรรทัด/ตัววัดข้อความ/ตัวแปลงเป็น PNG ชุดเดียวกัน (ภาพที่เห็นบนหน้าจอ = ภาพที่ดาวน์โหลด)
//
// ⚠️ PDPA: model รับเฉพาะฟิลด์ที่ระบุใน buildNewsModel — ไม่มีชื่อ เบอร์ บ้านเลขที่ พิกัด หรือรายละเอียดเรื่องของผู้แจ้ง
//    (complaint ที่ส่งเข้ามาอ่านแค่ village ระดับหมู่ ไว้ร่างข้อความ) เทสต์ล็อกไว้ด้วยข้อมูลผู้แจ้งปลอม
// ⚠️ ไม่ใส่เบอร์โทร: ในฐานข้อมูลไม่มีฟิลด์เบอร์ของกอง ห้ามแต่งข้อมูล
// ข้อความทุกค่า esc() ก่อนฝังใน SVG · URL ภาพรับเฉพาะ data:image/ ที่ผู้เรียกโหลดมาเอง (ภาพ private ต้องผ่าน fetchImageAsDataUrl)
//
// บล็อกผู้บริหาร (ไม่บังคับ) มุมขวาของแถบหัว: รูป + ป้ายชื่อ/ตำแหน่ง — ชื่อ/ตำแหน่ง/รูปมาจาก RPC complaint_news_branding
// (ผู้ลงนามช่องนายกคนปัจจุบัน) ผู้เรียกโหลดรูปเป็น data:image/ เอง · ไม่ส่ง executive = ภาพเหมือนเดิมทุกพิกเซล
//
// ไฟล์นี้ต้องไม่แตะ DOM ตอนโหลดโมดูล — เทสต์รันด้วย node (ตัววัดข้อความส่งเข้ามาจากผู้เรียก)

import { FONT_STACK, IMAGE_WIDTH, wrapLines } from './complaintMonthlyInfographic.js'
import { QUIET_MODULES, qrLayout } from './qrSvg.js'
import { workingDaysBetween } from './workingDays.js'

export { FONT_STACK, IMAGE_WIDTH, createCanvasMeasure, svgDataUrl, svgToPngFile } from './complaintMonthlyInfographic.js'

export const NEWS_MIN_HEIGHT = 1350
export const MAX_NEWS_PHOTOS = 4
// ภาพข่าวรวม: เลือกได้ไม่เกินกี่เรื่องต่อภาพ (ฝั่งผู้บริหารเรียก RPC ทีละเรื่อง จึงจำกัดไว้)
export const MAX_BATCH_ITEMS = 12

const MARGIN = 64
const CONTENT_W = IMAGE_WIDTH - MARGIN * 2
const ORANGE = '#c2410c'
const INK = '#1f2937'
const MUTED = '#4b5563'
const GAP = 16
// แถวป้ายหมู่ใต้รูปของภาพข่าวรวม
const CAPTION_H = 52
// บล็อกผู้บริหารมุมขวาแถบหัว (แบบร่างที่เจ้าของรับรอง): กรอบรูป ~150×180 + ป้ายขาวใต้รูป
const EXEC_PHOTO_W = 150
const EXEC_PHOTO_H = 180
const EXEC_PLATE_W = 280
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const num = n => Math.round(n * 100) / 100

// วันตามเวลาไทย (UTC+7) — ไม่พึ่ง ICU/โซนเวลาเครื่อง เพื่อให้วันที่ในภาพเท่ากันทุกเครื่อง
function bangkokParts(value) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  const shifted = new Date(time + 7 * 3600 * 1000)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() }
}

/** "10 พฤศจิกายน 2569" — ค่าที่อ่านวันไม่ได้คืนสตริงว่าง */
export function thaiLongDate(value) {
  const parts = bangkokParts(value)
  return parts ? `${parts.day} ${THAI_MONTHS[parts.month]} ${parts.year + 543}` : ''
}

const dayKey = parts => `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`

/** "2026-11-10" ตามเวลาไทย — อ่านวันไม่ได้คืนสตริงว่าง */
export function bangkokDayKey(value) {
  const parts = bangkokParts(value)
  return parts ? dayKey(parts) : ''
}

/**
 * ติ๊ก "ใช้เวลา N วันทำการ" ให้เองเมื่อเสร็จทันกำหนด (ไม่มีกำหนด = ทัน) · เกินกำหนด = ไม่ติ๊กไว้ก่อน
 * เจ้าหน้าที่เปลี่ยนเองได้ — ภาพที่ลงเพจไม่ควรเอาตัวเลขที่ดูช้าขึ้นไปโดยไม่มีใครตัดสิน
 */
export function defaultShowDuration({ closedAt, dueDate } = {}) {
  const due = dueDate ? String(dueDate).slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return true
  const closed = bangkokParts(closedAt)
  if (!closed) return false
  return dayKey(closed) <= due
}

/** หมวดที่ห้ามทำภาพข่าวตายตัว (ไม่พึ่งธงในตารางหมวดซึ่งแอดมินแก้ได้) — ชุดเดียวกับ exec_complaint_news_base */
export const NEWS_BLOCKED_CATEGORIES = Object.freeze(['odor', 'corruption'])

/**
 * หมวดนี้ทำภาพข่าวได้ไหม — กติกาเดียวกับ exec_complaint_news_base (20261119100100) ปิดตายเมื่อไม่แน่ใจ:
 * ไม่รู้จักหมวด (ยังโหลดไม่เสร็จ/ไม่มีแถว) = ไม่ได้ · หมวดอ่อนไหว (requires_manual_intake) / เฉพาะกิจ = ไม่ได้
 * @param {string} category
 * @param {Record<string, { is_adhoc?: boolean, requires_manual_intake?: boolean }>} categoryMeta
 */
export function newsCategoryAllowed(category, categoryMeta) {
  if (!category || NEWS_BLOCKED_CATEGORIES.includes(category)) return false
  const meta = categoryMeta?.[category]
  if (!meta) return false
  return meta.requires_manual_intake === false && meta.is_adhoc === false
}

/**
 * ผลของ RPC complaint_news_branding → เติม photo_url จาก photo_file_id (ฐานข้อมูลเก็บแค่ file id ของ Drive
 * ไม่เก็บ URL ที่มีโดเมนโปรเจกต์) · id ผิดรูปแบบ = ไม่มีรูป
 * @param {{ mayor_name?: string|null, mayor_title?: string|null, photo_file_id?: string|null } | null} data
 * @param {string} supabaseUrl
 */
export function withNewsPhotoUrl(data, supabaseUrl) {
  if (!data || typeof data !== 'object') return null
  const id = typeof data.photo_file_id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(data.photo_file_id) ? data.photo_file_id : null
  const base = String(supabaseUrl ?? '').replace(/\/+$/, '')
  return { ...data, photo_url: id && base ? `${base}/functions/v1/drive-file?id=${id}` : null }
}

/** ระดับหมู่เท่านั้น ("หมู่ 3") — ข้อความอื่นในช่องหมู่บ้านอาจมีรายละเอียดที่ไม่ควรขึ้นเพจ จึงไม่ดึงมา */
export function villageLevel(village) {
  const text = String(village ?? '').trim()
  const match = /^(\d{1,2})$/.exec(text) ?? /หมู่(?:ที่)?\s*(\d{1,2})/.exec(text)
  return match ? `หมู่ ${Number(match[1])}` : ''
}

/** ร่างข้อความข่าว — เจ้าหน้าที่แก้ได้ในกล่องก่อนสร้างภาพ */
export function draftHeadline({ departmentName = '', tenantName = '', categoryLabel = '', village = '' } = {}) {
  const dept = String(departmentName ?? '').trim()
  const tenant = String(tenantName ?? '').trim()
  const who = [dept, tenant].filter(Boolean).join(' ') || 'หน่วยงาน'
  const topic = String(categoryLabel ?? '').trim()
  const place = villageLevel(village)
  return `${who} ลงพื้นที่ดำเนินการเรื่อง${topic}${place ? ` ${place}` : ''} ตามที่ประชาชนแจ้งผ่านระบบ E-Service`
}

/** บล็อกผู้บริหาร: ไม่มีทั้งชื่อและตำแหน่ง = ไม่มีบล็อก (null) · ผู้เรียกใส่ชื่อตำแหน่งสำรองมาให้แล้ว */
function normalizeExecutive(executive) {
  const name = String(executive?.name ?? '').trim()
  const title = String(executive?.title ?? '').trim()
  return name || title ? { name, title } : null
}

/**
 * @param {{
 *   complaint?: { village?: string, created_at?: string, due_date?: string, closed_at?: string },
 *   tenantName?: string, departmentName?: string, categoryLabel?: string,
 *   finishNote?: string, closedAt?: string, createdAt?: string, dueDate?: string,
 *   showStatus?: boolean, showDuration?: boolean, headline?: string, detail?: string, reportUrl?: string,
 *   executive?: { name?: string | null, title?: string | null } | null,
 * }} input
 */
export function buildNewsModel({
  complaint = null, tenantName = '', departmentName = '', categoryLabel = '', finishNote = '',
  closedAt, createdAt, dueDate, showStatus = true, showDuration, headline, detail, reportUrl = '', executive = null,
} = {}) {
  const closed = closedAt ?? complaint?.closed_at
  const created = createdAt ?? complaint?.created_at
  const due = dueDate ?? complaint?.due_date
  const days = closed && created ? workingDaysBetween(created, closed) : null
  const durationKnown = days !== null && days >= 0
  const wantDuration = showDuration ?? defaultShowDuration({ closedAt: closed, dueDate: due })
  const text = (value, fallback) => (value === undefined || value === null ? fallback : String(value).trim())
  return {
    tenantName: String(tenantName ?? '').trim() || 'หน่วยงาน',
    headline: text(headline, draftHeadline({ departmentName, tenantName, categoryLabel, village: complaint?.village })),
    detail: text(detail, String(finishNote ?? '').trim()),
    dateText: thaiLongDate(closed),
    showStatus: !!showStatus,
    // ไม่รู้ระยะเวลา (ไม่มีวันยื่น/วันปิด) = ไม่แสดง ไม่เดาตัวเลข
    showDuration: !!wantDuration && durationKnown,
    durationLabel: durationKnown ? (days === 0 ? 'เสร็จในวันที่ยื่น' : `ใช้เวลา ${days} วันทำการ`) : '',
    reportUrl: String(reportUrl ?? '').trim(),
    executive: normalizeExecutive(executive),
  }
}

// ───────── ภาพข่าวรวม (หลายเรื่องหมวดเดียวกัน เสร็จวันเดียวกัน → ภาพเดียว) ─────────

/**
 * จัดกลุ่มเรื่องที่เป็นตัวเลือกภาพข่าวรวม: "วันปิดงาน (เวลาไทย) + หมวดเดียวกัน"
 * ผู้เรียกคำนวณ day ('YYYY-MM-DD') กับ categoryKey มาให้ — ข้อมูลที่ไม่ครบ (ไม่มี id/วัน/หมวด) ถูกข้าม ไม่เดา
 * เรียง: กลุ่มที่มี ≥2 เรื่อง (ทำภาพรวมได้จริง) ขึ้นก่อน → วันล่าสุดก่อน → กลุ่มใหญ่ก่อน · ลำดับเรื่องในกลุ่มคงตามที่ส่งมา
 * @param {{ id: string, day: string, categoryKey: string }[]} items
 * @returns {{ key: string, day: string, categoryKey: string, items: object[] }[]}
 */
export function groupNewsCandidates(items) {
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const day = String(item?.day ?? '')
    const categoryKey = String(item?.categoryKey ?? '')
    if (!item?.id || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !categoryKey) continue
    const key = `${day}|${categoryKey}`
    if (!map.has(key)) map.set(key, { key, day, categoryKey, items: [] })
    map.get(key).items.push(item)
  }
  const rank = group => (group.items.length >= 2 ? 0 : 1)
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)
    || b.items.length - a.items.length || (a.key < b.key ? -1 : 1))
}

/** รายชื่อหมู่ไม่ซ้ำ เรียงตามเลขหมู่ ("หมู่ 3", "หมู่ 5") — ค่าที่ไม่ใช่ระดับหมู่ถูกข้าม */
export function villageList(villages) {
  const seen = new Map()
  for (const village of villages ?? []) {
    const label = villageLevel(village)
    if (label) seen.set(label, Number(label.replace(/\D+/g, '')))
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label)
}

/** ร่างข้อความข่าวของภาพรวม — เจ้าหน้าที่แก้ได้ในกล่องก่อนสร้างภาพ */
export function draftBatchHeadline({ departmentName = '', tenantName = '', categoryLabel = '', count = 0, villages = [] } = {}) {
  const who = [String(departmentName ?? '').trim(), String(tenantName ?? '').trim()].filter(Boolean).join(' ') || 'หน่วยงาน'
  const topic = String(categoryLabel ?? '').trim()
  const places = villages.length ? ` (${villages.join(', ')})` : ''
  return `${who} ลงพื้นที่ดำเนินการเรื่อง${topic} จำนวน ${count} จุด${places} ตามที่ประชาชนแจ้งผ่านระบบ E-Service`
}

/**
 * ข้อความ "และอีก N จุด" ใต้ตารางรูป (รูปแสดงได้ไม่เกิน MAX_NEWS_PHOTOS) · หมู่ของจุดที่ไม่มีรูปต่อท้ายในวงเล็บ
 * ไม่มีจุดเกิน = สตริงว่าง
 */
export function batchMoreText(moreCount, hiddenVillages = []) {
  const n = Number(moreCount)
  if (!Number.isFinite(n) || n <= 0) return ''
  const places = hiddenVillages.length ? ` (${hiddenVillages.join(', ')})` : ''
  return `และอีก ${n} จุด${places}`
}

/**
 * model ของภาพรวม — ใช้ buildNewsModel เดิม แล้วทับส่วนระยะเวลาด้วยกติกาของภาพรวม:
 * ป้ายเวลา "ซ่อน" ยกเว้นทันกำหนดทุกเรื่อง (และรู้ระยะเวลาครบทุกเรื่อง) → "ใช้เวลาไม่เกิน N วันทำการ" (N = ค่าสูงสุดของกลุ่ม)
 * มีเรื่องเกินกำหนดแม้เรื่องเดียว = ไม่มีป้าย ติ๊กเองก็ไม่ได้ (ภาพที่ลงเพจไม่ควรเอาตัวเลขที่ดูช้าขึ้นไปโดยไม่มีใครตัดสิน)
 * @param {{ items?: { village?: string, createdAt?: string, closedAt?: string, dueDate?: string }[] } & Parameters<typeof buildNewsModel>[0]} input
 */
export function buildBatchNewsModel({ items = [], tenantName = '', departmentName = '', categoryLabel = '', showStatus = true, showDuration, headline, detail, reportUrl = '', executive = null } = {}) {
  const rows = Array.isArray(items) ? items : []
  const villages = villageList(rows.map(row => row?.village))
  const times = rows.map(row => new Date(row?.closedAt).getTime()).filter(Number.isFinite)
  const closedAt = times.length ? new Date(Math.max(...times)).toISOString() : undefined
  const stats = rows.map(row => ({
    days: row?.closedAt && row?.createdAt ? workingDaysBetween(row.createdAt, row.closedAt) : null,
    onTime: defaultShowDuration({ closedAt: row?.closedAt, dueDate: row?.dueDate }),
  }))
  const allOnTime = rows.length > 0 && stats.every(item => item.days !== null && item.days >= 0 && item.onTime)
  const maxDays = allOnTime ? Math.max(...stats.map(item => item.days)) : 0
  const model = buildNewsModel({
    tenantName, departmentName, categoryLabel, closedAt, showStatus, showDuration: false, detail, reportUrl, executive,
    headline: headline ?? draftBatchHeadline({ departmentName, tenantName, categoryLabel, count: rows.length, villages }),
  })
  return {
    ...model,
    showDuration: allOnTime && (showDuration ?? true),
    durationLabel: allOnTime ? (maxDays === 0 ? 'เสร็จในวันที่ยื่นทุกเรื่อง' : `ใช้เวลาไม่เกิน ${maxDays} วันทำการ`) : '',
    count: rows.length,
    villages,
  }
}

const imageUrlOk = value => typeof value === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(value)

/**
 * ตารางรูป: 1 รูปเต็มกว้าง · 2 รูปแบ่งครึ่ง · 3–4 รูปตาราง 2×2 — คืนกรอบ [{x,y,w,h}] เทียบมุมซ้ายบนของกริด
 * captionH = ความสูงแถวป้ายใต้รูปของแต่ละแถว (0 = ไม่มีป้าย ผลเหมือนเดิมทุกพิกเซล)
 */
export function photoCells(count, captionH = 0) {
  const half = (CONTENT_W - GAP) / 2
  if (count <= 0) return { cells: [], height: 0 }
  if (count === 1) return { cells: [{ x: 0, y: 0, w: CONTENT_W, h: 600 }], height: 600 + captionH }
  if (count === 2) return { cells: [0, 1].map(i => ({ x: i * (half + GAP), y: 0, w: half, h: 520 })), height: 520 + captionH }
  const h = 360
  const rowStep = h + GAP + captionH
  const cells = Array.from({ length: Math.min(count, 4) }, (_, i) => ({ x: (i % 2) * (half + GAP), y: Math.floor(i / 2) * rowStep, w: half, h }))
  // 3 รูป: รูปที่ 3 เต็มกว้างแถวล่าง ไม่ให้มุมขวาล่างว่างเป็นช่องโหว่
  if (count === 3) cells[2] = { x: 0, y: rowStep, w: CONTENT_W, h }
  return { cells, height: h * 2 + GAP + captionH * 2 }
}

/**
 * @param {ReturnType<typeof buildNewsModel>} model
 * @param {(text: string, size: number, bold: boolean) => number} measure
 * @param {{ logoDataUrl?: string | null, photoDataUrls?: (string | null)[], executivePhotoDataUrl?: string | null,
 *   photoCaptions?: string[], moreText?: string }} [assets]
 *   photoCaptions = ป้ายใต้รูป (ภาพรวม: หมู่) เรียงตรงกับ photoDataUrls · moreText = "และอีก N จุด" ใต้ตารางรูป
 * @returns {{ svg: string, width: number, height: number, photoCount: number }}
 */
export function buildNewsSvg(model, measure, { logoDataUrl = null, photoDataUrls = [], executivePhotoDataUrl = null, photoCaptions = [], moreText = '' } = {}) {
  // จับคู่รูปกับป้ายก่อนกรอง — รูปที่ใช้ไม่ได้ถูกตัดทิ้งพร้อมป้ายของมันเอง ป้ายไม่เลื่อนไปติดรูปอื่น
  const entries = (photoDataUrls ?? [])
    .map((url, i) => ({ url, caption: String(photoCaptions?.[i] ?? '').trim() }))
    .filter(entry => imageUrlOk(entry.url))
    .slice(0, MAX_NEWS_PHOTOS)
  const photos = entries.map(entry => entry.url)
  const captionH = entries.some(entry => entry.caption) ? CAPTION_H : 0
  const parts = []
  const text = (x, y, value, { size = 28, bold = false, fill = INK, anchor = 'start' } = {}) => {
    parts.push(`<text x="${num(x)}" y="${num(y)}" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`)
  }
  // หลายบรรทัด: คืน baseline ถัดจากบรรทัดสุดท้าย
  const block = (x, y, value, maxWidth, options = {}) => {
    const size = options.size ?? 28
    const step = Math.round(size * (options.lineHeight ?? 1.4))
    let cursor = y
    for (const line of wrapLines(value, maxWidth, size, !!options.bold, measure)) {
      text(x, cursor, line, options)
      cursor += step
    }
    return cursor
  }

  // ── แถบหัวสีส้ม ขอบล่างมน ──
  const logoR = 72
  const logoCx = MARGIN + logoR
  const textX = MARGIN + logoR * 2 + 32
  // บล็อกผู้บริหารมุมขวา (ถ้าเปิด) — ข้อความหัวแคบลงไม่ให้ทับ
  const exec = model.executive
  const execPhoto = exec && imageUrlOk(executivePhotoDataUrl) ? executivePhotoDataUrl : null
  const execPlateLines = exec ? {
    name: exec.name ? wrapLines(exec.name, EXEC_PLATE_W - 32, 28, true, measure) : [],
    title: exec.title ? wrapLines(exec.title, EXEC_PLATE_W - 32, 24, false, measure) : [],
  } : null
  const execPlateH = execPlateLines
    ? 16 + execPlateLines.name.length * 36 + execPlateLines.title.length * 32 + 16
    : 0
  const execPhotoTop = 40
  const execPlateTop = execPhoto ? execPhotoTop + EXEC_PHOTO_H + 8 + 12 : execPhotoTop + 4
  const execBottom = exec ? (execPlateH ? execPlateTop + execPlateH : execPhotoTop + EXEC_PHOTO_H + 8) : 0
  const textW = IMAGE_WIDTH - MARGIN - textX - (exec ? EXEC_PLATE_W + 28 : 0)
  let titleSize = 68
  while (titleSize > 44 && measure('ข่าวประชาสัมพันธ์', titleSize, true) > textW) titleSize -= 2
  const headerTexts = []
  const headerText = (x, y, value, { size, bold = false, opacity = 1 }) => {
    headerTexts.push(`<text x="${num(x)}" y="${num(y)}" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="#ffffff" fill-opacity="${opacity}">${esc(value)}</text>`)
  }
  let baseline = 58 + 26
  let leadSize = 28
  while (leadSize > 22 && measure('ผลการดำเนินงานผ่านระบบ E-Service', leadSize, false) > textW) leadSize -= 1
  headerText(textX, baseline, 'ผลการดำเนินงานผ่านระบบ E-Service', { size: leadSize, opacity: 0.92 })
  baseline += Math.round(titleSize * 1.1)
  headerText(textX, baseline, 'ข่าวประชาสัมพันธ์', { size: titleSize, bold: true })
  baseline += 20
  for (const line of wrapLines(model.tenantName, textW, 34, true, measure)) {
    baseline += 48
    headerText(textX, baseline, line, { size: 34, bold: true })
  }
  const headerH = Math.max(baseline + 52, logoR * 2 + 116, exec ? execBottom + 44 : 0)
  const rad = 44
  parts.push(`<path d="M0 0H${IMAGE_WIDTH}V${num(headerH - rad)}A${rad} ${rad} 0 0 1 ${IMAGE_WIDTH - rad} ${num(headerH)}H${rad}A${rad} ${rad} 0 0 1 0 ${num(headerH - rad)}Z" fill="${ORANGE}"/>`)
  const logoCy = headerH / 2 - 4
  parts.push(`<circle cx="${logoCx}" cy="${num(logoCy)}" r="${logoR}" fill="#ffffff"/>`)
  if (imageUrlOk(logoDataUrl)) {
    const inner = logoR - 8
    parts.push(`<defs><clipPath id="news-logo-clip"><circle cx="${logoCx}" cy="${num(logoCy)}" r="${inner}"/></clipPath></defs>`
      + `<image href="${esc(logoDataUrl)}" x="${logoCx - inner}" y="${num(logoCy - inner)}" width="${inner * 2}" height="${inner * 2}" preserveAspectRatio="xMidYMid meet" clip-path="url(#news-logo-clip)"/>`)
  }
  parts.push(headerTexts.join(''))
  if (exec) {
    // ป้ายขาวมุมมนชิดขอบขวาของพื้นที่เนื้อหา · รูปอยู่กึ่งกลางป้าย (ไม่มีรูป = ป้ายอย่างเดียว)
    const plateX = IMAGE_WIDTH - MARGIN - EXEC_PLATE_W
    const centerX = plateX + EXEC_PLATE_W / 2
    if (execPhoto) {
      const px = centerX - EXEC_PHOTO_W / 2
      parts.push(`<rect x="${num(px - 4)}" y="${execPhotoTop - 4}" width="${EXEC_PHOTO_W + 8}" height="${EXEC_PHOTO_H + 8}" rx="26" fill="#ffffff"/>`
        + `<defs><clipPath id="news-exec-clip"><rect x="${num(px)}" y="${execPhotoTop}" width="${EXEC_PHOTO_W}" height="${EXEC_PHOTO_H}" rx="22"/></clipPath></defs>`
        + `<image href="${esc(execPhoto)}" x="${num(px)}" y="${execPhotoTop}" width="${EXEC_PHOTO_W}" height="${EXEC_PHOTO_H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#news-exec-clip)"/>`)
    }
    if (execPlateH) {
      parts.push(`<rect x="${num(plateX)}" y="${num(execPlateTop)}" width="${EXEC_PLATE_W}" height="${num(execPlateH)}" rx="22" fill="#ffffff"/>`)
      let top = execPlateTop + 16
      for (const line of execPlateLines.name) {
        text(centerX, top + 28, line, { size: 28, bold: true, fill: INK, anchor: 'middle' })
        top += 36
      }
      for (const line of execPlateLines.title) {
        text(centerX, top + 23, line, { size: 24, fill: MUTED, anchor: 'middle' })
        top += 32
      }
    }
  }

  // ── ป้ายเม็ดยา ──
  let y = headerH + 48
  const pills = []
  if (model.showStatus) pills.push({ label: 'ดำเนินการแล้ว', bg: '#15803d', fg: '#ffffff' })
  if (model.showDuration && model.durationLabel) pills.push({ label: model.durationLabel, bg: '#ffedd5', fg: '#9a3412' })
  if (pills.length) {
    const pillH = 60
    let x = MARGIN
    let rowTop = y
    for (const pill of pills) {
      const width = Math.ceil(measure(pill.label, 30, true)) + 56
      if (x > MARGIN && x + width > MARGIN + CONTENT_W) { x = MARGIN; rowTop += pillH + 14 }
      parts.push(`<rect x="${num(x)}" y="${num(rowTop)}" width="${width}" height="${pillH}" rx="${pillH / 2}" fill="${pill.bg}"/>`)
      text(x + width / 2, rowTop + 40, pill.label, { size: 30, bold: true, fill: pill.fg, anchor: 'middle' })
      x += width + 16
    }
    y = rowTop + pillH + 40
  }

  // ── วันที่ · ข้อความข่าว · รายละเอียด ──
  if (model.dateText) {
    text(MARGIN, y + 8, `วันที่ ${model.dateText}`, { size: 30, bold: true, fill: ORANGE })
    y += 56
  }
  if (model.headline) y = block(MARGIN, y + 14, model.headline, CONTENT_W, { size: 40, bold: true, fill: INK, lineHeight: 1.45 }) + 6
  if (model.detail) y = block(MARGIN, y + 20, model.detail, CONTENT_W, { size: 30, fill: MUTED, lineHeight: 1.45 }) + 6

  // ── รูป (ครอปแบบ cover มุมมน) ──
  if (photos.length) {
    y += 28
    const grid = photoCells(photos.length, captionH)
    const defs = []
    grid.cells.forEach((cell, i) => {
      const cx = MARGIN + cell.x
      const cy = y + cell.y
      defs.push(`<clipPath id="news-photo-${i}"><rect x="${num(cx)}" y="${num(cy)}" width="${num(cell.w)}" height="${num(cell.h)}" rx="22"/></clipPath>`)
      parts.push(`<rect x="${num(cx)}" y="${num(cy)}" width="${num(cell.w)}" height="${num(cell.h)}" rx="22" fill="#e5e7eb"/>`
        + `<image href="${esc(photos[i])}" x="${num(cx)}" y="${num(cy)}" width="${num(cell.w)}" height="${num(cell.h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#news-photo-${i})"/>`)
      const caption = entries[i].caption
      if (caption) {
        // ป้ายหมู่กึ่งกลางใต้รูป — ยาวเกินความกว้างช่องใช้บรรทัดแรกที่ตัดแล้ว (ไม่ล้นไปทับรูปข้างเคียง)
        const fitted = measure(caption, 30, true) > cell.w ? (wrapLines(caption, cell.w, 30, true, measure)[0] ?? '') : caption
        text(cx + cell.w / 2, cy + cell.h + 38, fitted, { size: 30, bold: true, fill: ORANGE, anchor: 'middle' })
      }
    })
    parts.push(`<defs>${defs.join('')}</defs>`)
    y += grid.height
  }
  // ภาพรวม: "และอีก N จุด" ใต้ตารางรูป (จุดที่เกิน 4 ช่อง) — ไม่ทับลงบนรูป
  if (moreText) y = block(MARGIN, y + 48, moreText, CONTENT_W, { size: 32, bold: true, fill: ORANGE, lineHeight: 1.4 })

  // ── แถบท้ายสีส้ม ──
  // ไม่มีเบอร์โทรและไม่มีชื่อกองผู้จัดทำ: ฐานไม่มีฟิลด์เบอร์ และเจ้าของระบบสั่งตัดข้อความ "จัดทำโดย" ออก
  const PAD = 36
  const qr = model.reportUrl ? qrLayout(model.reportUrl, 220) : null
  const footTextX = MARGIN + (qr ? qr.side + 36 : 0)
  const footTextW = IMAGE_WIDTH - MARGIN - footTextX
  const slots = [
    { size: 36, bold: true, lines: wrapLines('พบปัญหาในชุมชน แจ้งเราได้ตลอด 24 ชม.', footTextW, 36, true, measure), opacity: 1 },
  ]
  if (model.reportUrl) {
    slots.push({ size: 28, bold: false, lines: wrapLines(qr ? 'สแกน QR หรือเข้าที่' : 'เข้าที่', footTextW, 28, false, measure), opacity: 0.92 })
    slots.push({ size: 30, bold: true, lines: wrapLines(model.reportUrl.replace(/^https?:\/\//i, ''), footTextW, 30, true, measure), opacity: 1 })
  }
  const stepOf = slot => Math.round(slot.size * 1.4)
  const footTextH = slots.reduce((sum, slot) => sum + slot.lines.length * stepOf(slot), 0)
  const footH = Math.max(qr ? qr.side : 0, footTextH) + PAD * 2
  const footTop = Math.max(y + 56, NEWS_MIN_HEIGHT - footH)
  const height = Math.ceil(footTop + footH)
  const frad = 44
  parts.push(`<path d="M0 ${height}V${num(footTop + frad)}A${frad} ${frad} 0 0 1 ${frad} ${num(footTop)}H${IMAGE_WIDTH - frad}A${frad} ${frad} 0 0 1 ${IMAGE_WIDTH} ${num(footTop + frad)}V${height}Z" fill="${ORANGE}"/>`)
  if (qr) {
    // QR ดำบนพื้นขาว (รวมขอบสงบ) เสมอ ห้ามให้สีแถบมาเป็นพื้นของ QR
    parts.push(`<g transform="translate(${MARGIN} ${num(footTop + (footH - qr.side) / 2)})"><rect width="${qr.side}" height="${qr.side}" rx="10" fill="#ffffff"/><path transform="translate(${QUIET_MODULES * qr.module} ${QUIET_MODULES * qr.module}) scale(${qr.module})" d="${qr.d}" fill="#000000" shape-rendering="crispEdges"/></g>`)
  }
  let lineTop = footTop + (footH - footTextH) / 2
  for (const slot of slots) {
    for (const line of slot.lines) {
      parts.push(`<text x="${num(footTextX)}" y="${num(lineTop + Math.round(slot.size * 1.05))}" font-size="${slot.size}" font-weight="${slot.bold ? 700 : 400}" fill="#ffffff" fill-opacity="${slot.opacity}">${esc(line)}</text>`)
      lineTop += stepOf(slot)
    }
  }

  // พื้นขาวเต็มภาพเป็นองค์ประกอบแรกสุด — PNG ไม่มีพื้นจะโปร่งใสแล้วตัวอักษรเข้มกลายเป็นดำบนดำในแอปโหมดมืด
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}" font-family="${FONT_STACK}" role="img" aria-label="${esc(`ข่าวประชาสัมพันธ์ ${model.tenantName}`)}"><title>${esc(`ข่าวประชาสัมพันธ์ ${model.tenantName}`)}</title><rect width="${IMAGE_WIDTH}" height="${height}" fill="#ffffff"/>${parts.join('')}</svg>`
  return { svg, width: IMAGE_WIDTH, height, photoCount: photos.length }
}

/** ข้อความสำหรับคัดลอก/แนบตอนแชร์ — ข้อความข่าว + รายละเอียด (+ ลิงก์แจ้งเรื่อง) */
export function newsShareText(model) {
  return [model.headline, model.detail, model.reportUrl ? `แจ้งเรื่อง/ติดตามเรื่อง: ${model.reportUrl}` : '']
    .filter(Boolean).join('\n\n')
}
