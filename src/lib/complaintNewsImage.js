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

import { __iconNode as cameraIcon } from 'lucide-react/dist/esm/icons/camera.mjs'
import { __iconNode as checkIcon } from 'lucide-react/dist/esm/icons/check.mjs'
import { __iconNode as clipboardCheckIcon } from 'lucide-react/dist/esm/icons/clipboard-check.mjs'
import { __iconNode as clockIcon } from 'lucide-react/dist/esm/icons/clock.mjs'
import { iconNodeForCategory } from './complaintCategoryIcons.js'
import { FONT_STACK, IMAGE_WIDTH, iconSvg, wrapLines } from './complaintMonthlyInfographic.js'
import { newsThemeFor } from './departmentColors.js'
import { QUIET_MODULES, qrLayout } from './qrSvg.js'
import { workingDaysBetween } from './workingDays.js'

export { FONT_STACK, IMAGE_WIDTH, createCanvasMeasure, svgDataUrl, svgToPngFile } from './complaintMonthlyInfographic.js'

export const NEWS_MIN_HEIGHT = 1350
// เพดานความสูง = A4 แนวตั้งที่ความกว้างภาพ (สัดส่วน 297/210) → 1527 px · เจ้าของระบบสั่ง 2569-11-12 ให้ภาพข่าวจบแผ่นเดียวเมื่อพิมพ์ A4
// ข้อความข่าวที่ยาวมากอาจยังล้นได้ → ผู้เรียกดู fitsA4 ในผลลัพธ์ของ buildNewsSvg (ไม่ตัดข้อความทิ้งเอง)
export const NEWS_MAX_HEIGHT = Math.floor(IMAGE_WIDTH * 297 / 210)
// ช่องรูปเตี้ยสุดตอนบีบให้พอดี A4 — ต่ำกว่านี้รูปงานดูไม่รู้เรื่อง · 1–2 รูป (ช่องกว้าง ~470–950 px) ไม่ต่ำกว่า 300
// 3–4 รูป (ตาราง 2 แถว) ลดถึง 200 เพราะ 2 แถวที่ 300 ไม่มีทางพอดี A4 แม้ตัดของประกอบหมด
export const NEWS_PHOTO_MIN_H = 300
export const NEWS_GRID_MIN_H = 200
// แถวเดียวของ 3–4 รูป (ใช้เมื่อ 2×2 ไม่พอที่) สูง 200–320 px
const NEWS_ROW_MIN_H = 200
const NEWS_ROW_NATURAL_H = 320
export const MAX_NEWS_PHOTOS = 4
// ภาพข่าวรวม: เลือกได้ไม่เกินกี่เรื่องต่อภาพ (ฝั่งผู้บริหารเรียก RPC ทีละเรื่อง จึงจำกัดไว้)
export const MAX_BATCH_ITEMS = 12
// แถบท้าย: มี QR/ลิงก์ = ชวนแจ้งเรื่อง · ปิด QR/ลิงก์ = ขอบคุณ — บรรทัด "มุ่งสู่เมืองอัจฉริยะ" ขึ้นทั้งสองแบบ (เจ้าของระบบสั่ง 2569-11-11)
export const NEWS_FOOTER_INVITE = 'พบปัญหาในชุมชน แจ้งเราได้ตลอด 24 ชม.'
export const NEWS_FOOTER_SMART_CITY = 'ร่วมกันดูแลชุมชน มุ่งสู่เมืองอัจฉริยะ (Smart City)'
export const NEWS_FOOTER_THANKS = Object.freeze(['ขอบคุณทุกการแจ้งปัญหาจากประชาชน', NEWS_FOOTER_SMART_CITY])

const MARGIN = 64
const CONTENT_W = IMAGE_WIDTH - MARGIN * 2
// สีธีมตามกอง (departmentColors.js newsThemeFor) — model.theme ไม่มี/ผิดรูป = ส้มชุดเดิม · ป้าย "ดำเนินการแล้ว" คงเขียว (สถานะ ไม่ใช่สีกอง)
const STATUS_GREEN = '#15803d'
// ทองของเส้นใต้แถบหัวและขอบป้ายนายก — คงที่ทุกธีม
const GOLD = '#f5c242'
const INK = '#1f2937'
const MUTED = '#4b5563'
const GAP = 16
// แถวป้ายหมู่ใต้รูปของภาพข่าวรวม
const CAPTION_H = 52
// บล็อกผู้บริหารมุมขวาแถบหัว (เจ้าของสั่ง 2569-11-11 ให้เด่นแบบภาพข่าวต้นฉบับ อบต.): รูปตัดพื้นหลังตัวใหญ่ไม่มีกรอบขาว
// ยืนชิดก้นกล่อง แล้วป้ายชื่อขอบทองทับช่วงล่างของรูป (ซ่อนรอยตัดลำตัว) · ผู้เรียกตัดพื้นหลังมาเอง (prepareExecutivePhoto)
// 2569-11-12 เจ้าของสั่งให้รูปใหญ่ขึ้น + แสงออร่าให้เด่น นูน สง่า: 300 → 370 (กว้างกว่าป้าย 25 px ต่อข้าง ยังไม่ชนข้อความหัวที่เว้นไว้ 28 px)
// ป้ายทับช่วงล่างมากขึ้น (52 → 60) ให้แถบหัวสูงขึ้นน้อยที่สุด
// 2569-11-12 (รอบหลัง) เจ้าของสั่งลดลงอีกหน่อย 370 → 340 (กว้างกว่าป้าย 10 px ต่อข้าง)
const EXEC_PHOTO_W = 340
const EXEC_PHOTO_H = 340
const EXEC_PHOTO_TOP = 26
const EXEC_PLATE_OVERLAP = 60
// ออร่า: วงแสงสีขาวรอบศีรษะ (SVG radialGradient) + ขอบเรืองสีขาวตามรูปทรงคน 2 ชั้น
// ขอบเรืองวาดลงในไฟล์ PNG ของรูปเอง (prepareExecutivePhoto → execRimPlan) ไม่ใช้ SVG mask/filter/<use>
// เพราะ iPhone Safari วาด mask + <use> ใน SVG ที่เปิดผ่าน <img> ไม่เหมือน Chrome (#711) — canvas 2D วาดเหมือนกันทุกเบราว์เซอร์
// รัศมีเป็นหน่วยของภาพข่าว (รูปขนาดเต็ม EXEC_PHOTO_W) · ย่อรูปตามขั้น NEWS_FIT_LEVELS แล้วขอบเรืองย่อตามสัดส่วนเอง
const EXEC_RIM_RINGS = [{ radius: 9, alpha: 0.55 }, { radius: 4, alpha: 0.95 }]
const EXEC_RIM_DIRS = 24
const EXEC_PLATE_W = 320
const EXEC_PLATE_PAD_X = 22
const EXEC_PLATE_PAD_Y = 11 // 16 → 11 (ย่อป้ายตามที่เจ้าของสั่ง 2569-11-12)
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
// แถบขั้นตอน 4 จุด: "ดำเนินการ" ไม่ใช่ "ลงพื้นที่" เพราะบางหมวดไม่ได้ลงพื้นที่จริง
export const NEWS_STEP_LABELS = Object.freeze(['แจ้งเรื่อง', 'รับเรื่อง', 'ดำเนินการ', 'เสร็จสิ้น'])
// ป้ายมุมรูป: ต้องตรงความจริง — รูปผู้แจ้ง = ก่อน, รูปผลงานของเจ้าหน้าที่ = หลัง
export const NEWS_PHOTO_KIND_LABELS = Object.freeze({ before: 'ก่อนดำเนินการ', after: 'หลังดำเนินการ' })

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

/** "3 พ.ย. 2569" ตามเวลาไทย — อ่านวันไม่ได้คืนสตริงว่าง (ไม่เดา) */
export function thaiShortDate(value) {
  const parts = bangkokParts(value)
  return parts ? `${parts.day} ${THAI_MONTHS_SHORT[parts.month]} ${parts.year + 543}` : ''
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

const HEX = /^#[0-9a-f]{6}$/i

/** ชุดสีธีมที่ใช้ได้จริง — ไม่ครบ 4 สี/ไม่ใช่ hex 6 หลัก = ส้มชุดเดิม (กันค่าแปลกหลุดเข้า SVG) */
function normalizeTheme(theme) {
  const fallback = newsThemeFor(null)
  if (!theme || typeof theme !== 'object') return fallback
  return ['base', 'deep', 'soft', 'ink'].every(key => HEX.test(theme[key])) ? { base: theme.base, deep: theme.deep, soft: theme.soft, ink: theme.ink } : fallback
}

/** รหัสหมวด (ใช้เลือกไอคอน) — ไม่มี/ว่าง = ไม่วาดไอคอน ไม่เดา */
const normalizeCategoryCode = code => (typeof code === 'string' && code.trim() ? code.trim() : '')

/** 4 จุด: วันที่ขึ้นเฉพาะจุดแรก (วันยื่น) กับจุดสุดท้าย (วันปิดงาน) · สองจุดกลางไม่มีข้อมูลวัน จึงไม่ใส่ ไม่เดา */
function buildSteps(createdAt, closedAt) {
  return NEWS_STEP_LABELS.map((label, i) => ({ label, date: i === 0 ? thaiShortDate(createdAt) : i === 3 ? thaiShortDate(closedAt) : '' }))
}

/**
 * @param {{
 *   complaint?: { village?: string, created_at?: string, due_date?: string, closed_at?: string },
 *   tenantName?: string, departmentName?: string, categoryLabel?: string, categoryCode?: string,
 *   finishNote?: string, closedAt?: string, createdAt?: string, dueDate?: string,
 *   showStatus?: boolean, showDuration?: boolean, headline?: string, detail?: string, reportUrl?: string,
 *   executive?: { name?: string | null, title?: string | null } | null,
 *   theme?: { base: string, deep: string, soft: string, ink: string } | null,
 * }} input
 */
export function buildNewsModel({
  complaint = null, tenantName = '', departmentName = '', categoryLabel = '', categoryCode = '', finishNote = '',
  closedAt, createdAt, dueDate, showStatus = true, showDuration, headline, detail, reportUrl = '', executive = null, theme = null,
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
    theme: normalizeTheme(theme),
    categoryCode: normalizeCategoryCode(categoryCode),
    steps: buildSteps(created, closed),
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
export function buildBatchNewsModel({ items = [], tenantName = '', departmentName = '', categoryLabel = '', categoryCode = '', showStatus = true, showDuration, headline, detail, reportUrl = '', executive = null, theme = null } = {}) {
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
    tenantName, departmentName, categoryLabel, categoryCode, closedAt, showStatus, showDuration: false, detail, reportUrl, executive, theme,
    headline: headline ?? draftBatchHeadline({ departmentName, tenantName, categoryLabel, count: rows.length, villages }),
  })
  return {
    ...model,
    // ภาพรวมหลายเรื่อง วันยื่น/วันปิดต่างกัน — แสดงครบ 4 จุดแต่ไม่ใส่วันที่ ไม่เลือกวันใดวันหนึ่งแทนทั้งกลุ่ม
    steps: NEWS_STEP_LABELS.map(label => ({ label, date: '' })),
    showDuration: allOnTime && (showDuration ?? true),
    durationLabel: allOnTime ? (maxDays === 0 ? 'เสร็จในวันที่ยื่นทุกเรื่อง' : `ใช้เวลาไม่เกิน ${maxDays} วันทำการ`) : '',
    count: rows.length,
    villages,
  }
}

const imageUrlOk = value => typeof value === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(value)

/**
 * ข้อความในป้ายชื่อ/ตำแหน่ง: ย่อขนาดจาก maxSize ลงทีละ 1 จนจบบรรทัดเดียว (เคสจริง: "แปง"/"เลา" ตกไปยืนบรรทัดสองคนเดียว)
 * ถึง minSize แล้วยังไม่พอ = ตัด 2 บรรทัดที่ช่องว่างให้สองบรรทัดยาวใกล้กันที่สุด · ไม่มีช่องว่างที่ใช้ได้ = ตัดตามคำ (wrapLines)
 */
export function fitPlateText(value, width, maxSize, minSize, bold, measure) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  for (let size = maxSize; size >= minSize; size -= 1) {
    if (measure(text, size, bold) <= width) return { size, bold, lines: [text] }
  }
  const words = text.split(' ')
  let best = null
  for (let i = 1; i < words.length; i += 1) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    const widths = pair.map(line => measure(line, minSize, bold))
    if (Math.max(...widths) > width) continue
    const diff = Math.abs(widths[0] - widths[1])
    if (!best || diff < best.diff) best = { diff, lines: pair }
  }
  return { size: minSize, bold, lines: best ? best.lines : wrapLines(text, width, minSize, bold, measure) }
}

// ด้านยาวสูงสุดของรูปนายกที่ภาพข่าวใช้จริง (prepareExecutivePhoto ย่อลงเท่านี้ก่อนวาด) — หน้าตั้งค่าอัปโหลดไม่เกินนี้ด้วย
// เก็บใหญ่กว่านี้ไม่ได้ภาพคมขึ้น แต่ไฟล์ PNG ใหญ่ขึ้นเกือบเท่าตัว และทุกครั้งที่เปิดกล่องภาพข่าวต้องดึงผ่าน drive-file (กิน egress)
export const NEWS_EXEC_PHOTO_SIDE = 720

/**
 * แผนวาดขอบเรืองขาวลงในรูปนายก (ผู้เรียกวาดด้วย canvas 2D ใน prepareExecutivePhoto) สำหรับรูปขนาด width×height px
 * คืน { pad, dirs, rings: [{ radius, alpha }] } — pad = ที่เว้นเพิ่มด้านบน/ซ้าย/ขวา (ไม่เว้นด้านล่าง รูปยืนชิดก้นกล่องเหมือนเดิม)
 * radius เป็น px ของรูป คำนวณกลับจากรัศมีหน่วยภาพข่าว (EXEC_RIM_RINGS) ตามมาตราส่วนที่รูปจะถูกย่อลงกล่อง EXEC_PHOTO_W × EXEC_PHOTO_H (meet)
 * วนหาซ้ำเพราะ pad ทำให้รูปทั้งใบใหญ่ขึ้น → มาตราส่วนเล็กลง → รัศมี px ต้องโตขึ้นอีกนิด
 */
export function execRimPlan(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  const outer = Math.max(...EXEC_RIM_RINGS.map(ring => ring.radius))
  let pad = 0
  let scale = 1
  for (let i = 0; i < 4; i += 1) {
    scale = Math.min(EXEC_PHOTO_W / (width + pad * 2), EXEC_PHOTO_H / (height + pad))
    pad = Math.ceil(outer / scale) + 2
  }
  return { pad, dirs: EXEC_RIM_DIRS, rings: EXEC_RIM_RINGS.map(ring => ({ radius: ring.radius / scale, alpha: ring.alpha })) }
}

const OWN_ALPHA_SHARE = 0.01 // จุดโปร่งใส (alpha < 128) ตั้งแต่ 1% ของรูป = ผู้อัปโหลดเตรียมพื้นโปร่งใสมาเอง
const OWN_ALPHA_MIN = 16 // จุดจางกว่านี้ (เงาฟุ้งรอบตัวจากโปรแกรมตัดภาพ) ไม่นับเป็นตัวคนตอนครอป

/**
 * รูปที่มีพื้นโปร่งใสมาเอง (PNG/WebP ที่ตัดพื้นหลังด้วยโปรแกรมอื่นแล้ว) → คืนกรอบส่วนที่มองเห็น {x,y,w,h} ไว้ครอปชิดตัวคน
 * คืน null = รูปทึบทั้งรูป (JPEG / PNG ไม่มีช่องโปร่งใส) ให้ผู้เรียกใช้ cutoutPlainBackground ต่อตามเดิม
 * ไม่แก้ data · เกณฑ์ 1% กันรูปทึบที่มีจุดโปร่งใสหลุดมาแค่ไม่กี่จุดถูกนับว่า "ตัดมาแล้ว"
 * @param {Uint8ClampedArray | Uint8Array} data
 * @param {number} width
 * @param {number} height
 */
export function transparentPhotoBox(data, width, height) {
  const n = width * height
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length < n * 4) return null
  let clear = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let p = 0; p < n; p += 1) {
    const a = data[p * 4 + 3]
    if (a < 128) clear += 1
    if (a < OWN_ALPHA_MIN) continue
    const x = p % width
    const y = (p - x) / width
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (clear < n * OWN_ALPHA_SHARE || maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

// ── ตัดพื้นหลังเรียบของรูปนายก (ฉากขาว/ฉากสีเดียวแบบรูปถ่ายติดบัตร) — กติกาตรงไปตรงมา ไม่ใช้ AI ไม่มีค่าใช้จ่าย ──
const CUT_EDGE_TOL = 40 // ขอบบน/ซ้าย/ขวาต้องเป็นสีเดียวกันภายในระยะนี้ (RGB แบบยุคลิด)
const CUT_EDGE_SHARE = 0.8 // ...อย่างน้อย 80% ของจุดบนขอบ ไม่งั้นถือว่าไม่ใช่ฉากเรียบ
const CUT_FILL_TOL = 42 // จุดที่ต่อเนื่องจากขอบและห่างสีฉากไม่เกินนี้ = พื้นหลัง
const CUT_SOFT_LOW = 18 // ขอบตัวคน: ไล่ความทึบจากระยะสีนี้...
const CUT_SOFT_HIGH = 90 // ...ถึงนี้ ให้ขอบนุ่มไม่เป็นฟันเลื่อย

/**
 * ตัดพื้นหลังเรียบออก (ทำให้โปร่งใส) แบบเทลงสีจากขอบภาพ — แก้ data (RGBA) ในที่ แล้วคืนกรอบตัวคน {x,y,w,h}
 * คืน null = ไม่แตะ data และผู้เรียกควรใช้รูปแบบมีกรอบแทน เมื่อ:
 *  - ขอบบน/ซ้าย/ขวาไม่ใช่สีเดียวกัน (ถ่ายนอกสถานที่ ฉากมีลาย)
 *  - ตัดออกน้อย/มากผิดปกติ หรือกลางขอบล่าง (ลำตัว) ถูกตัดไปเกินครึ่ง — เช่น เสื้อขาวบนฉากขาวกลืนกัน
 *    ตัดผิดจนเสื้อหายแย่กว่าไม่ตัด จึงยอมถอยไปใช้กรอบ
 * @param {Uint8ClampedArray | Uint8Array} data
 * @param {number} width
 * @param {number} height
 */
export function cutoutPlainBackground(data, width, height) {
  const n = width * height
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || data.length < n * 4) return null
  const edge = []
  for (let x = 0; x < width; x += 1) edge.push(x)
  for (let y = 1; y < height; y += 1) edge.push(y * width, y * width + width - 1)
  const median = channel => {
    const values = edge.map(p => data[p * 4 + channel]).sort((a, b) => a - b)
    return values[values.length >> 1]
  }
  const bg = [median(0), median(1), median(2)]
  const dist = p => Math.hypot(data[p * 4] - bg[0], data[p * 4 + 1] - bg[1], data[p * 4 + 2] - bg[2])
  if (edge.filter(p => dist(p) <= CUT_EDGE_TOL).length < edge.length * CUT_EDGE_SHARE) return null

  // เทสีจากทุกจุดบนขอบ (รวมขอบล่าง) ที่ใกล้สีฉาก ไปยังจุดข้างเคียง 4 ทิศที่ยังใกล้สีฉาก
  const isBg = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  const seed = p => { if (!isBg[p] && dist(p) <= CUT_FILL_TOL) { isBg[p] = 1; queue[tail++] = p } }
  for (let x = 0; x < width; x += 1) { seed(x); seed((height - 1) * width + x) }
  for (let y = 0; y < height; y += 1) { seed(y * width); seed(y * width + width - 1) }
  while (head < tail) {
    const p = queue[head++]
    const x = p % width
    if (x > 0) seed(p - 1)
    if (x < width - 1) seed(p + 1)
    if (p >= width) seed(p - width)
    if (p < n - width) seed(p + width)
  }
  const share = tail / n
  if (share < 0.05 || share > 0.9) return null
  const bodyFrom = Math.floor(width * 0.35)
  const bodyTo = Math.ceil(width * 0.65)
  let bodyBg = 0
  for (let x = bodyFrom; x < bodyTo; x += 1) bodyBg += isBg[(height - 1) * width + x]
  if (bodyBg > (bodyTo - bodyFrom) / 2) return null

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let p = 0; p < n; p += 1) {
    if (isBg[p]) { data[p * 4 + 3] = 0; continue }
    const x = p % width
    const y = (p - x) / width
    const touchesBg = (x > 0 && isBg[p - 1]) || (x < width - 1 && isBg[p + 1]) || (y > 0 && isBg[p - width]) || (y < height - 1 && isBg[p + width])
    if (touchesBg) {
      const a = Math.min(1, Math.max(0, (dist(p) - CUT_SOFT_LOW) / (CUT_SOFT_HIGH - CUT_SOFT_LOW)))
      data[p * 4 + 3] = Math.round(data[p * 4 + 3] * a)
    }
    if (data[p * 4 + 3] > 0) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * ตารางรูป: 1 รูปเต็มกว้าง · 2 รูปแบ่งครึ่ง · 3–4 รูปตาราง 2×2 — คืนกรอบ [{x,y,w,h}] เทียบมุมซ้ายบนของกริด
 * captionH = ความสูงแถวป้ายใต้รูปของแต่ละแถว (0 = ไม่มีป้าย ผลเหมือนเดิมทุกพิกเซล)
 */
export function photoCells(count, captionH = 0, maxHeight = Infinity, singleMinH = NEWS_PHOTO_MIN_H) {
  const half = (CONTENT_W - GAP) / 2
  if (count <= 0) return { cells: [], height: 0 }
  // maxHeight (ไม่ส่ง = ไม่จำกัด ผลเหมือนเดิมทุกพิกเซล): ย่อความสูงช่องให้ทั้งตารางไม่เกินที่ว่าง แต่ไม่ต่ำกว่า NEWS_PHOTO_MIN_H
  const rows = count <= 2 ? 1 : 2
  const natural = count === 1 ? 600 : count === 2 ? 520 : 360
  const fixed = captionH * rows + (rows - 1) * GAP
  // 3–4 รูป: ถ้าตาราง 2×2 ต่ำกว่า NEWS_GRID_MIN_H (ที่ว่างไม่พอ) เปลี่ยนเป็นแถวเดียวเรียงข้าง (รูปละ ~226–306 px) — เตี้ยกว่า 2 แถวเกือบครึ่ง
  // เลือกตามที่ว่างเท่านั้น: ไม่ส่ง maxHeight = 2×2 เหมือนเดิมทุกพิกเซล
  if (count >= 3 && Math.floor((maxHeight - fixed) / rows) < NEWS_GRID_MIN_H) {
    const n = Math.min(count, 4)
    const w = (CONTENT_W - GAP * (n - 1)) / n
    const rowH = Math.max(NEWS_ROW_MIN_H, Math.min(NEWS_ROW_NATURAL_H, Math.floor(maxHeight - captionH)))
    return { cells: Array.from({ length: n }, (_, i) => ({ x: i * (w + GAP), y: 0, w, h: rowH })), height: rowH + captionH }
  }
  const minH = count <= 2 ? singleMinH : NEWS_GRID_MIN_H
  const h = Math.max(minH, Math.min(natural, Math.floor((maxHeight - fixed) / rows)))
  const height = h * rows + fixed
  if (count === 1) return { cells: [{ x: 0, y: 0, w: CONTENT_W, h }], height }
  if (count === 2) return { cells: [0, 1].map(i => ({ x: i * (half + GAP), y: 0, w: half, h })), height }
  const rowStep = h + GAP + captionH
  const cells = Array.from({ length: Math.min(count, 4) }, (_, i) => ({ x: (i % 2) * (half + GAP), y: Math.floor(i / 2) * rowStep, w: half, h }))
  // 3 รูป: รูปที่ 3 เต็มกว้างแถวล่าง ไม่ให้มุมขวาล่างว่างเป็นช่องโหว่
  if (count === 3) cells[2] = { x: 0, y: rowStep, w: CONTENT_W, h }
  return { cells, height }
}

/** ผสมสี hex 6 หลักกับสีอีกสี (ratio = สัดส่วนของ b) — ใช้ทำสีพื้นหลังอ่อนจากสีธีมโดยไม่เพิ่มตารางสี */
function mixHex(a, b, ratio) {
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map(i => Math.round(channel(a, i) * (1 - ratio) + channel(b, i) * ratio).toString(16).padStart(2, '0')).join('')
}

// ── ชุดตกแต่งแบบอินโฟกราฟิกอ้างอิง (เจ้าของระบบอนุมัติ 2569-11-12) — วาดด้วยรูปทรง+ไล่สีล้วน ไม่ใช้ SVG filter ไม่สุ่ม ──
// ทองตัวอักษรบนแถบหัวสีเข้ม: สว่างกว่า GOLD เพื่อให้ยังอ่านออกบนธีมทอง/น้ำตาล (ตัวหนา ≥ 34 px = ตัวอักษรใหญ่ เกณฑ์ 3:1)
const GOLD_TEXT = '#fde68a'
// แถบทองบางบนสุด / ใต้แถบหัว / เหนือแถบท้าย
const GOLD_BAND = 10
// สีเงาของการ์ด (น้ำเงินเทาเข้ม ความทึบต่ำ) — กลางๆ ใช้ได้กับทุกธีมกอง
const SHADOW = '#0f172a'
const STATUS_GREEN_LIGHT = '#22c55e'
const STATUS_GREEN_DEEP = '#166534'
const BEFORE_AMBER = '#d97706'

/** วงกลมจางขนาดใหญ่ (bokeh) แบบภาพอ้างอิง — [x, y, รัศมี] เป็นสัดส่วนความกว้าง/สูงของแถบ + ความทึบ · clip ด้วยรูปทรงแถบ */
const BOKEH = [[0.86, -0.3, 0.27, 0.09], [1.02, 0.95, 0.19, 0.07], [0.06, 1.2, 0.15, 0.06]]

function bokehSvg(clipId, top, width, height, flip) {
  const circles = BOKEH.map(([fx, fy, fr, opacity]) => {
    const cy = top + (flip ? 1 - fy : fy) * height
    return `<circle cx="${num(fx * width)}" cy="${num(cy)}" r="${num(fr * width)}" fill="#ffffff" fill-opacity="${opacity}"/>`
  }).join('')
  return `<g clip-path="url(#${clipId})" data-bokeh="1">${circles}</g>`
}

/**
 * ออร่ารอบรูปผู้บริหาร (เจ้าของสั่ง 2569-11-12 "เด่นๆ นูนๆ สง่าๆ") — ตายตัว ไม่สุ่ม ไม่ใช้ SVG filter · อยู่ใน clip ของแถบหัว ไม่ล้นลงเนื้อหา
 * 1) วงแสงสีขาวรอบศีรษะ (ขาวนวลตรงกลาง จางออกที่ขอบ) — radialGradient ธรรมดา Safari วาดได้
 * 2) ขอบเรืองสีขาวตามรูปทรงคน — ไม่ได้วาดที่นี่ อยู่ในไฟล์รูปแล้ว (execRimPlan) เพราะ Safari วาด mask/<use> ไม่ตรง Chrome
 * เจ้าของปรับ 2569-11-12: ตัดรัศมีแสง (แฉก) ออก · วงแสงและขอบเรืองเป็นสีขาวทั้งหมด ไม่ใช้ทอง
 */
function execAuraSvg(defs, cx, w, h) {
  const top = EXEC_PHOTO_TOP
  const cy = top + h * 0.36 // ราวศีรษะ (รูปยืนชิดก้นกล่อง หน้าอยู่ราวหนึ่งในสามบน)
  const haloR = w * 0.42 // เจ้าของสั่งให้วงแสงเล็กลง 2569-11-12 (เดิม 0.6) — ฟุ้งแค่รอบศีรษะ-ไหล่
  defs.push(`<radialGradient id="news-exec-halo" gradientUnits="userSpaceOnUse" cx="${num(cx)}" cy="${num(cy)}" r="${num(haloR)}"><stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`)
  return `<g clip-path="url(#news-head-clip)" data-exec-aura="1">`
    + `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(haloR)}" fill="url(#news-exec-halo)"/>`
    + '</g>'
}

// ตึกเมืองเรืองแสงจางมุมขวาของแถบหัว [x, กว้าง, สูง] — ตายตัว ไม่สุ่ม
const BANNER_TOWERS = [[852, 40, 128], [896, 56, 168], [956, 34, 104], [994, 62, 140], [1040, 36, 96]]
// สีกรอบภาพข่าว (แถบหัว + แถบท้าย) = น้ำเงินเข้มแบบแบนเนอร์หน้าแรกของ อปท. — เจ้าของสั่ง 2569-11-12 ให้หัว/ท้ายสีเดียวกัน
// สีกองไม่อยู่ที่กรอบแล้ว ใช้แค่ในเนื้อหา (การ์ดใช้เวลา แถบขั้นตอน ป้ายวันที่ ไอคอนหมวด) ให้รู้ว่าเป็นงานของกองไหน
const FRAME_STOPS = '<stop offset="0" stop-color="#010a4a"/><stop offset="0.6" stop-color="#03207f"/><stop offset="1" stop-color="#0a37b0"/>'

// ── แถบหัวแบบแบนเนอร์ของ อปท. (พื้นน้ำเงินเข้ม) — แสงฟ้าหลังรูปนายก + วงสัญญาณ + ตึกเมืองเรืองแสงจาง ตายตัว ไม่ใช้ filter ──
function bannerGlowSvg(defs, headerH, glowCx) {
  const cy = headerH * 0.45
  defs.push(`<radialGradient id="news-banner-glow" gradientUnits="userSpaceOnUse" cx="${num(glowCx)}" cy="${num(cy)}" r="${num(headerH * 0.75)}"><stop offset="0" stop-color="#3d8bff" stop-opacity="0.75"/><stop offset="0.5" stop-color="#1d5bff" stop-opacity="0.3"/><stop offset="1" stop-color="#1d5bff" stop-opacity="0"/></radialGradient>`)
  const rings = [0.28, 0.42, 0.56, 0.7].map((f, i) => `<circle cx="${num(glowCx)}" cy="${num(cy)}" r="${num(headerH * f)}" fill="none" stroke="#7fb6ff" stroke-opacity="${0.32 - i * 0.06}" stroke-width="2"/>`).join('')
  const towers = BANNER_TOWERS.map(([x, w, h]) => {
    const top = headerH - h * 1.4
    const lights = Array.from({ length: Math.floor(h * 1.4 / 22) }, (_, i) => `<rect x="${x + 6}" y="${num(top + 8 + i * 22)}" width="${w - 12}" height="3" fill="#9fd0ff" fill-opacity="0.35"/>`).join('')
    return `<rect x="${x}" y="${num(top)}" width="${w}" height="${num(h * 1.4)}" fill="#1e4fc4" fill-opacity="0.35"/>${lights}`
  }).join('')
  return `<g clip-path="url(#news-head-clip)" data-banner-glow="1"><rect width="${IMAGE_WIDTH}" height="${num(headerH)}" fill="url(#news-banner-glow)"/>${rings}${towers}</g>`
}

// ── คำขวัญมุมล่างขวา "เทคโนโลยีทันสมัย / บริการเพื่อประชาชน" (เจ้าของสั่ง 2569-11-12 ตามภาพอ้างอิง) ──
// แผ่นเหลืองไล่สีขอบซ้ายโค้ง + เส้นโค้งขาว · ตัวหนาเอียงน้ำเงินเข้ม 2 บรรทัด + เส้นปาดแดงใต้ข้อความ · ไม่ใช้ filter/mask/<use>
export const NEWS_SLOGAN = ['เทคโนโลยีทันสมัย', 'บริการเพื่อประชาชน']
const SLOGAN_W = 360
const SLOGAN_MIN_W = 250
const SLOGAN_ROW_W = 400 // แบบแถวมุมล่างขวา (มี QR + ลิงก์ยาว)
const SLOGAN_ROW_H = 92
const SLOGAN_CURVE = 56 // ความกว้างช่วงโค้งของขอบซ้าย (ข้อความเริ่มหลังช่วงนี้)

function sloganSvg(x, top, w, h, measure) {
  const bottom = top + h
  const textLeft = x + SLOGAN_CURVE
  const textW = w - SLOGAN_CURVE - 30
  let size = 38
  while (size > 20 && (Math.max(...NEWS_SLOGAN.map(line => measure(line, size, true))) > textW || size * 2.6 > h - 20)) size -= 1
  const step = Math.round(size * 1.18)
  const blockH = step + size + 14 // 2 บรรทัด + เส้นปาดแดง
  const first = top + (h - blockH) / 2 + size * 0.95
  const lines = NEWS_SLOGAN.map((line, i) => `<text transform="translate(${num(textLeft)} ${num(first + i * step)}) skewX(-9)" font-size="${size}" font-weight="700" fill="#0b2f8f">${esc(line)}</text>`).join('')
  const lineW = Math.max(...NEWS_SLOGAN.map(line => measure(line, size, true)))
  const swooshY = first + step + size * 0.32
  const swoosh = `<path d="M${num(textLeft + lineW * 0.08)} ${num(swooshY + 6)}Q${num(textLeft + lineW * 0.55)} ${num(swooshY - 4)} ${num(textLeft + lineW * 0.98)} ${num(swooshY - 9)}" fill="none" stroke="#e53935" stroke-width="${num(Math.max(3, size * 0.12))}" stroke-linecap="round"/>`
  const edge = `M${num(x + SLOGAN_CURVE)} ${num(top)}C${num(x + 6)} ${num(top + h * 0.35)} ${num(x + 34)} ${num(top + h * 0.7)} ${num(x)} ${num(bottom)}`
  return `<g data-slogan="1"><linearGradient id="news-slogan-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff176"/><stop offset="1" stop-color="#ffc107"/></linearGradient>`
    + `<path d="${edge}L${IMAGE_WIDTH} ${num(bottom)}L${IMAGE_WIDTH} ${num(top)}Z" fill="url(#news-slogan-gold)"/>`
    + `<path d="${edge}" fill="none" stroke="#ffffff" stroke-width="5"/>`
    + lines + swoosh + '</g>'
}

// ── คำ "Smart City Local" แบบโปสเตอร์อ้างอิง (เจ้าของสั่ง 2569-11-12) ──
// ตัวหนาเอียง ขอบขาว + เงา · Smart/Local ไล่น้ำเงิน City ไล่ส้ม · สัญญาณ wifi + หมุดแผนที่ + เส้นโค้งเขียว + ริบบิ้นข้อความไทย
// วาดด้วยรูปทรง/ข้อความ/ไล่สีล้วน (ไม่ใช้ filter/mask/<use> — Safari) · ออกแบบในกรอบ SC_W × SC_H แล้วย่อลงที่ว่างจริง
const SC_W = 560
const SC_H = 262
const SC_MIN_SCALE = 0.5 // ที่ว่างเล็กกว่านี้ = ไม่วาด (ตัวเล็กจนอ่านไม่ออก ดูรก)
const SC_RIBBON = 'องค์กรปกครองส่วนท้องถิ่น'

function smartCityMarkSvg(defs, x, y, w, h, measure) {
  // ปัดลง 2 ตำแหน่งก่อนใช้ — num() ใน transform ปัดเป็นทศนิยม 2 ตำแหน่ง ปัดขึ้นแล้วคำล้นที่ว่างได้ ~1 px
  const scale = Math.floor(Math.min(w / SC_W, h / SC_H, 1.1) * 100) / 100
  if (!(scale >= SC_MIN_SCALE)) return ''
  defs.push('<linearGradient id="news-sc-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b8cff"/><stop offset="1" stop-color="#1238a8"/></linearGradient>'
    + '<linearGradient id="news-sc-orange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd23f"/><stop offset="0.55" stop-color="#ff8a00"/><stop offset="1" stop-color="#f05a00"/></linearGradient>'
    + '<linearGradient id="news-sc-green" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7ed957" stop-opacity="0"/><stop offset="0.35" stop-color="#5cc93b"/><stop offset="1" stop-color="#1f9d55"/></linearGradient>'
    + '<linearGradient id="news-sc-ribbon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1e5bd8"/><stop offset="1" stop-color="#0b2f8f"/></linearGradient>')
  // คำเอียง 3 ชั้น: เงาน้ำเงินเข้ม → ขอบขาวหนา → ไล่สี (เอียงรอบเส้นฐานของคำเอง)
  const word = (tx, ty, value, size, fill) => {
    const t = `transform="translate(${num(tx)} ${num(ty)}) skewX(-11)" font-size="${size}" font-weight="700"`
    return `<text ${t} dx="3" dy="6" fill="#0a2470" fill-opacity="0.45">${value}</text>`
      + `<text ${t} fill="#ffffff" stroke="#ffffff" stroke-width="13" stroke-linejoin="round">${value}</text>`
      + `<text ${t} fill="url(#${fill})" stroke="#0b2f8f" stroke-width="1.5">${value}</text>`
  }
  const smartW = measure('Smart', 100, true)
  const cityW = measure('City', 88, true)
  const smartX = 40
  const cityX = 70
  const localX = cityX + cityW + 22
  // สัญญาณ wifi เหนือช่วงท้ายคำ Smart (จุด + โค้ง 3 วง เปิดขึ้นบน)
  const wx = smartX + smartW * 0.62
  const wy = 52
  const arc = r => `<path d="M${num(wx - r * 0.74)} ${num(wy - r * 0.67)}A${r} ${r} 0 0 1 ${num(wx + r * 0.74)} ${num(wy - r * 0.67)}" fill="none" stroke="url(#news-sc-blue)" stroke-width="9" stroke-linecap="round"/>`
  const wifi = `<g data-sc-wifi="1">${[16, 31, 46].map(arc).join('')}<circle cx="${num(wx)}" cy="${wy}" r="7" fill="#1e5bd8"/></g>`
  // หมุดแผนที่สีแดงชิดขวาบน
  const pinX = Math.min(SC_W - 30, smartX + smartW + 42) // ชิดท้ายคำ Smart แบบภาพอ้างอิง
  const pin = `<g transform="translate(${num(pinX)} 40)" data-sc-pin="1"><ellipse cx="0" cy="60" rx="14" ry="4" fill="#0a2470" fill-opacity="0.3"/>`
    + '<path d="M0 60C-6 46-24 34-24 18A24 24 0 0 1 24 18C24 34 6 46 0 60Z" fill="#e53935" stroke="#ffffff" stroke-width="3"/>'
    + '<circle cx="0" cy="18" r="8.5" fill="#ffffff"/></g>'
  // เส้นโค้งเขียวกวาดใต้บรรทัดสอง (แบบภาพอ้างอิง)
  const swoosh = '<path d="M6 214C170 250 410 232 556 128C462 226 228 262 6 232Z" fill="url(#news-sc-green)"/>'
  const ribbonW = Math.min(SC_W - 70, Math.ceil(measure(SC_RIBBON, 30, true)) + 70)
  const ribbonX = SC_W - ribbonW - 6
  const ribbon = `<rect x="${ribbonX}" y="${SC_H - 50}" width="${ribbonW}" height="46" rx="23" fill="url(#news-sc-ribbon)" stroke="#ffffff" stroke-width="3"/>`
    + `<text x="${num(ribbonX + ribbonW / 2)}" y="${SC_H - 17}" font-size="30" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(SC_RIBBON)}</text>`
  const ox = x + (w - SC_W * scale) / 2
  const oy = y + (h - SC_H * scale) / 2
  return `<g transform="translate(${num(ox)} ${num(oy)}) scale(${num(scale)})" data-smart-city-mark="1">`
    + wifi + pin + swoosh + ribbon // ริบบิ้นก่อนคำ — หางตัว y ของ City ทับริบบิ้นแบบภาพอ้างอิง ไม่ถูกริบบิ้นบัง
    + word(smartX, 130, 'Smart', 100, 'news-sc-blue')
    + word(cityX, 206, 'City', 88, 'news-sc-orange')
    + word(localX, 206, 'Local', 88, 'news-sc-blue')
    + '</g>'
}

/** การ์ดมุมมน + เงานุ่ม 2 ชั้น (สี่เหลี่ยมเลื่อนลง แทน SVG filter) */
function softCard(x, y, w, h, r, fill = '#ffffff', extra = '') {
  return `<rect x="${num(x)}" y="${num(y + 9)}" width="${num(w)}" height="${num(h)}" rx="${r}" fill="${SHADOW}" fill-opacity="0.05"/>`
    + `<rect x="${num(x)}" y="${num(y + 3)}" width="${num(w)}" height="${num(h)}" rx="${r}" fill="${SHADOW}" fill-opacity="0.08"/>`
    + `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${r}" fill="${fill}"${extra}/>`
}

/** ไอคอน lucide สีใดก็ได้ — iconSvg วาดเส้นขาวเสมอ จึงเปลี่ยนสีเส้นที่กลุ่มนอกสุด */
const iconIn = (node, x, y, size, color) => iconSvg(node, x, y, size).replace('stroke="#ffffff"', `stroke="${color}"`)

/** พื้นหลังทั้งภาพ: ไล่สีเทาอมสีกองอ่อน → ขาว แบบพื้นภาพอ้างอิง (สะอาด ไม่มีลาย ให้การ์ดขาวเงานุ่มเป็นตัวสร้างมิติ) */
function pageBackdrop(width, height, theme) {
  const top = mixHex(theme.soft, '#f1f5f9', 0.55)
  return `<defs><linearGradient id="news-bg-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>`
    + `<rect width="${width}" height="${height}" fill="url(#news-bg-grad)" data-backdrop="1"/>`
}

// ชุดฟอนต์เมื่อมีฟอนต์ฝัง — ใช้ทั้ง font-family ของ SVG และตัววัดข้อความ (createCanvasMeasure) ให้เป็นค่าเดียวกันเสมอ
export const newsFontStack = family => `'${family}', ${FONT_STACK}`

// รับเฉพาะ @font-face ที่เป็น data:font/woff2 ซึ่ง newsFont.js สร้างเอง — กันสตริงแปลกปลอมหลุดเข้า <style> (ปิด </style> แล้วแทรกแท็ก)
function newsFontOk(font) {
  if (!font || typeof font.family !== 'string' || typeof font.css !== 'string') return false
  if (!/^[A-Za-z0-9 ]+$/.test(font.family)) return false
  return /^(@font-face\{font-family:'[A-Za-z0-9 ]+';font-weight:\d{3};src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\('woff2'\);unicode-range:[U+0-9A-Fa-f, -]+;\})+$/.test(font.css)
}

/**
 * @param {ReturnType<typeof buildNewsModel>} model
 * @param {(text: string, size: number, bold: boolean) => number} measure
 * @param {{ logoDataUrl?: string | null, photoDataUrls?: (string | null)[], executivePhotoDataUrl?: string | null,
 *   photoCaptions?: string[], photoKinds?: ('before' | 'after' | null | undefined)[], moreText?: string,
 *   font?: { family: string, css: string } | null }} [assets]
 *   font = ฟอนต์ฝังจาก loadNewsFont() (newsFont.js) — measure ต้องวัดด้วย newsFontStack(font.family) ชุดเดียวกัน · ไม่ส่ง = ฟอนต์ระบบ
 *   photoCaptions = ป้ายใต้รูป (ภาพรวม: หมู่) เรียงตรงกับ photoDataUrls · moreText = "และอีก N จุด" ใต้ตารางรูป
 *   photoKinds = ชนิดรูปเรียงตรงกับ photoDataUrls → ป้ายมุมรูป "ก่อน/หลังดำเนินการ" (ไม่ส่ง/ค่าอื่น = ไม่มีป้าย)
 * @returns {{ svg: string, width: number, height: number, photoCount: number, fitsA4: boolean }}
 */
export function buildNewsSvg(model, measure, assets = {}) {
  // ให้จบ A4 แผ่นเดียว: รูปย่อได้เองถึงขั้นต่ำเสมอ (ใน drawNewsSvg) แล้วถ้ายังล้นค่อยไล่ย่อตัวหนังสือ/รูปนายก/แถบท้ายทีละขั้น (NEWS_FIT_LEVELS)
  // ไม่ตัดแถบขั้นตอนทิ้ง (เจ้าของระบบสั่ง 2569-11-12) · ข้อความข่าวที่ยาวมากเองอาจยังล้น = fitsA4 false (ไม่ตัดข้อความทิ้ง ให้ผู้เรียกเตือนผู้ใช้)
  let result = null
  for (const fit of NEWS_FIT_LEVELS) {
    result = drawNewsSvg(model, measure, assets, fit)
    if (result.fitsA4) break
  }
  return result
}

// 2569-11-12 เจ้าของสั่งรูปนายกใหญ่ขึ้น: ไล่ย่อตัวหนังสือ/รูปงานก่อน รูปนายกลดช้าลง (0.95 → 0.6) และลดเหลือ 0.38 (141 px เท่าขั้นสุดท้ายเดิม) เฉพาะขั้นสุดท้าย
// ทุกขั้นคงแถบขั้นตอน (พร้อมวันที่) ไว้เสมอ — เจ้าของระบบสั่ง 2569-11-12 ให้ย่อรูป/กรอบ/ตัวหนังสือที่ใหญ่เกินแทนการตัดแถบทิ้ง
// t = ตัวคูณขนาดตัวหนังสือ+ระยะห่างของเนื้อหา · exec = ตัวคูณรูปนายก · foot = ตัวคูณแถบท้าย (QR/ข้อความ) · min = ความสูงช่องรูปต่ำสุด (1–2 รูป)
// ต่ำสุด: หัวข้อข่าว 40×0.8 = 32 px · QR 200×0.8 = 160 px (ยังสแกนติด) · รูปนายก 165 px
const NEWS_FIT_LEVELS = Object.freeze([
  { t: 1, exec: 1, foot: 1, min: 300 },
  { t: 0.92, exec: 0.95, foot: 1, min: 280 },
  { t: 0.86, exec: 0.9, foot: 0.9, min: 260 },
  { t: 0.8, exec: 0.85, foot: 0.85, min: 240 },
  { t: 0.8, exec: 0.72, foot: 0.8, min: 220 },
  { t: 0.8, exec: 0.6, foot: 0.8, min: 220 },
  { t: 0.8, exec: 0.41, foot: 0.8, min: 220 }, // ทางสุดท้าย: ภาพรวม 4 รูป + ป้ายหมู่ + "และอีก N จุด" + รูปนายก (รูปนายกเหลือ 139 px ยังเห็นหน้า · ฐาน 340 ตั้งแต่ 2569-11-12 จึงปรับ 0.38→0.41 ไม่สูงกว่าเดิม)
])

function drawNewsSvg(model, measure, { logoDataUrl = null, photoDataUrls = [], executivePhotoDataUrl = null, officePhotoDataUrl = null, photoCaptions = [], photoKinds = [], moreText = '', font = null } = {}, fit = NEWS_FIT_LEVELS[0]) {
  const execPhotoW = Math.round(EXEC_PHOTO_W * fit.exec)
  const execPhotoH = Math.round(EXEC_PHOTO_H * fit.exec)
  const sz = base => Math.round(base * fit.t) // ขนาดตัวหนังสือเนื้อหา
  const gap = base => Math.round(base * fit.t) // ระยะห่างแนวตั้ง
  const theme = normalizeTheme(model.theme)
  // จับคู่รูปกับป้ายก่อนกรอง — รูปที่ใช้ไม่ได้ถูกตัดทิ้งพร้อมป้ายของมันเอง ป้ายไม่เลื่อนไปติดรูปอื่น
  const entries = (photoDataUrls ?? [])
    .map((url, i) => ({ url, caption: String(photoCaptions?.[i] ?? '').trim(), kind: Object.hasOwn(NEWS_PHOTO_KIND_LABELS, photoKinds?.[i]) ? photoKinds[i] : null }))
    .filter(entry => imageUrlOk(entry.url))
    .slice(0, MAX_NEWS_PHOTOS)
    // รูปก่อนดำเนินการขึ้นก่อนเสมอ แล้วค่อยหลังดำเนินการ (เจ้าของระบบสั่ง 2569-11-12) — ผู้เรียกส่งรูปผลงานมาก่อนรูปผู้แจ้ง
    // sort ของ JS คงลำดับเดิมในกลุ่มเดียวกัน (stable) · รูปไม่มีป้ายอยู่กลุ่มเดียวกับ "หลัง" ลำดับเดิมไม่เปลี่ยน
    .sort((x, y) => (x.kind === 'before' ? 0 : 1) - (y.kind === 'before' ? 0 : 1))
  const photos = entries.map(entry => entry.url)
  const captionH = entries.some(entry => entry.caption) ? CAPTION_H : 0
  const parts = []
  const defs = []
  const text = (x, y, value, { size = 28, bold = false, fill = INK, anchor = 'start', opacity = null } = {}) => {
    parts.push(`<text x="${num(x)}" y="${num(y)}" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="${fill}"${opacity === null ? '' : ` fill-opacity="${opacity}"`} text-anchor="${anchor}">${esc(value)}</text>`)
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

  // ── แถบหัว: แถบทองบนสุด + พื้นไล่สีเข้ม + วงกลมจาง + แถบทองใต้หัว (ขอบล่างตรงแบบภาพอ้างอิง) ──
  const logoR = 72
  const logoCx = MARGIN + logoR
  const textX = MARGIN + logoR * 2 + 32
  // บล็อกผู้บริหารมุมขวา (ถ้าเปิด) — ข้อความหัวแคบลงไม่ให้ทับ
  const exec = model.executive
  const execPhoto = exec && imageUrlOk(executivePhotoDataUrl) ? executivePhotoDataUrl : null
  const plateInnerW = EXEC_PLATE_W - EXEC_PLATE_PAD_X * 2
  const execPlateLines = exec ? {
    // เจ้าของสั่ง 2569-11-12 ให้ย่อชื่อ/ตำแหน่งลง ป้ายกินที่ยาวลงมามาก: ชื่อ 32→26 (ต่ำสุด 24→20) ตำแหน่ง 26→21 (20→16) ระยะบรรทัด 1.32→1.24
    // ขนาดต่ำสุดเล็กลงด้วย ชื่อ/ตำแหน่งยาวจึงอยู่บรรทัดเดียวได้บ่อยขึ้น ไม่ตกเป็น 2 บรรทัดจนป้ายสูง
    name: exec.name ? fitPlateText(exec.name, plateInnerW, 26, 20, true, measure) : null,
    title: exec.title ? fitPlateText(exec.title, plateInnerW, 21, 16, false, measure) : null,
  } : null
  const plateStep = slot => Math.round(slot.size * 1.24)
  const execPlateH = execPlateLines
    ? EXEC_PLATE_PAD_Y * 2 + [execPlateLines.name, execPlateLines.title].filter(Boolean)
      .reduce((sum, slot) => sum + slot.lines.length * plateStep(slot), 0)
    : 0
  const execPlateTop = execPhoto ? EXEC_PHOTO_TOP + execPhotoH - EXEC_PLATE_OVERLAP : 44
  const execBottom = exec ? execPlateTop + execPlateH : 0
  const textW = IMAGE_WIDTH - MARGIN - textX - (exec ? EXEC_PLATE_W + 28 : 0)
  let titleSize = 68
  // ขั้นต่ำ 40: ป้ายนายกกว้าง 320 ทำให้ช่องข้อความหัวเหลือ ~428px
  while (titleSize > 40 && measure('ข่าวประชาสัมพันธ์', titleSize, true) > textW) titleSize -= 2
  const headerTexts = []
  const headerText = (x, y, value, { size, bold = false, fill = '#ffffff' }) => {
    headerTexts.push(`<text x="${num(x)}" y="${num(y)}" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="${fill}">${esc(value)}</text>`)
  }
  // ป้ายเม็ดยาสีทอง "ผลการดำเนินงานผ่านระบบ E-Service" (ตัวหนาสีเข้มของธีม บนทอง)
  const lead = 'ผลการดำเนินงานผ่านระบบ E-Service'
  let leadSize = 26
  while (leadSize > 20 && measure(lead, leadSize, true) + 40 > textW) leadSize -= 1
  const leadTop = GOLD_BAND + 30
  const leadH = leadSize + 22
  const leadW = Math.ceil(measure(lead, leadSize, true)) + 40
  let baseline = leadTop + leadH + Math.round(titleSize * 1.05)
  // แถบหัวแบบแบนเนอร์หน้าแรกของ อปท. (เจ้าของส่งแบนเนอร์น้ำเลา 2569-11-12): พื้นน้ำเงินเข้ม หัวข้อขาว ชื่อ อปท. ทอง
  // มีรูปอาคารสำนักงาน = วางอาคารจริงใต้โลโก้ · ไม่มี = พื้นแบนเนอร์อย่างเดียว
  const office = imageUrlOk(officePhotoDataUrl) ? officePhotoDataUrl : null
  headerText(textX, baseline, 'ข่าวประชาสัมพันธ์', { size: titleSize, bold: true })
  baseline += 6
  // ชื่อ อปท. เด่นแบบแบนเนอร์ (เจ้าของสั่ง 2569-11-12): ตัวใหญ่ 54 ย่อจนพอดีบรรทัด (ต่ำสุด 34 แล้วค่อยตัดบรรทัด)
  // สีทองไล่เงา + เงาน้ำเงินดำเลื่อนลง + เส้นขอบน้ำตาลทองบาง — ข้อความซ้อน ไม่ใช้ filter (Safari)
  let tenantSize = 54
  while (tenantSize > 34 && measure(model.tenantName, tenantSize, true) > textW) tenantSize -= 2
  defs.push('<linearGradient id="news-tenant-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c2"/><stop offset="0.45" stop-color="#ffd54a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>')
  for (const line of wrapLines(model.tenantName, textW, tenantSize, true, measure)) {
    baseline += Math.round(tenantSize * 1.3)
    const attrs = `x="${num(textX)}" y="${num(baseline)}" font-size="${tenantSize}" font-weight="700"`
    headerTexts.push(`<text ${attrs} dx="2" dy="4" fill="#000a3a" fill-opacity="0.6">${esc(line)}</text>`
      + `<text ${attrs} fill="url(#news-tenant-gold)" stroke="#8a5a00" stroke-width="1.2" data-tenant-name="1">${esc(line)}</text>`)
  }
  const headerH = Math.max(baseline + 40, GOLD_BAND + logoR * 2 + 80, exec ? execBottom + 36 : 0)
  // แถบหัว = วิวสำนักงานบนฉากฟ้าสว่างแบบโปสเตอร์อ้างอิง (เจ้าของเลือก 2569-11-12 แทนพื้นไล่สีกอง) · สีกองยังอยู่ที่ชื่อ อปท./แถบท้าย/ป้าย
  defs.push(`<linearGradient id="news-head-grad" x1="0" y1="0" x2="1" y2="1">${FRAME_STOPS}</linearGradient>`
    + `<clipPath id="news-head-clip"><rect width="${IMAGE_WIDTH}" height="${num(headerH)}"/></clipPath>`)
  parts.push(`<rect width="${IMAGE_WIDTH}" height="${num(headerH)}" fill="url(#news-head-grad)" data-header="1"/>`
    + bannerGlowSvg(defs, headerH, exec ? IMAGE_WIDTH - MARGIN - EXEC_PLATE_W / 2 : IMAGE_WIDTH - MARGIN - 160)
    + `<rect width="${IMAGE_WIDTH}" height="${GOLD_BAND}" fill="${GOLD}" data-gold-band="top"/>`
    + `<rect y="${num(headerH)}" width="${IMAGE_WIDTH}" height="${GOLD_BAND}" fill="${GOLD}" data-gold-band="header"/>`)
  parts.push(`<rect x="${num(textX)}" y="${num(leadTop)}" width="${leadW}" height="${leadH}" rx="${num(leadH / 2)}" fill="${GOLD}" data-lead-pill="1"/>`)
  headerText(textX + 20, leadTop + Math.round(leadH * 0.7), lead, { size: leadSize, bold: true, fill: theme.deep })
  // โลโก้ในวงขาวขอบทอง (แบบไอคอนวงกลมในภาพอ้างอิง)
  // เจ้าของสั่ง 2569-11-12: กึ่งกลางโลโก้ตรงกับกึ่งกลางกลุ่มข้อความหัว (ป้ายทอง → ชื่อ อปท.) ไม่ใช่กึ่งกลางแถบหัว
  // แถบหัวสูงตามรูปนายก โลโก้เดิมจึงตกต่ำกว่าตัวหนังสือ · ไม่ให้ชิดแถบทองบนเกิน 16 px
  const textMid = (leadTop + baseline + 10) / 2 // +10 = หางสระล่างของบรรทัดสุดท้าย
  const logoCy = Math.max(GOLD_BAND + logoR + 16, textMid)
  parts.push(`<circle cx="${logoCx}" cy="${num(logoCy + 4)}" r="${logoR}" fill="${SHADOW}" fill-opacity="0.22"/>`
    + `<circle cx="${logoCx}" cy="${num(logoCy)}" r="${logoR}" fill="#ffffff" stroke="${GOLD}" stroke-width="6"/>`)
  if (imageUrlOk(logoDataUrl)) {
    const inner = logoR - 10
    defs.push(`<clipPath id="news-logo-clip"><circle cx="${logoCx}" cy="${num(logoCy)}" r="${inner}"/></clipPath>`)
    parts.push(`<image href="${esc(logoDataUrl)}" x="${logoCx - inner}" y="${num(logoCy - inner)}" width="${inner * 2}" height="${inner * 2}" preserveAspectRatio="xMidYMid meet" clip-path="url(#news-logo-clip)"/>`)
  }
  // รูปอาคารสำนักงานจริงใต้โลโก้ ยืนชิดก้นแถบหัว (ตัดพื้นหลัง/ขอบจางมาแล้ว) — ที่ว่างไม่พอ (แถบหัวเตี้ย) = ไม่วาด
  let markLeft = MARGIN
  if (office) {
    const top = logoCy + logoR + 6
    const boxW = textX + 40
    if (headerH - top >= 120) {
      parts.push(`<image href="${esc(office)}" x="0" y="${num(top)}" width="${num(boxW)}" height="${num(headerH - top)}" preserveAspectRatio="xMidYMax meet" clip-path="url(#news-head-clip)" data-office-photo="1"/>`)
      markLeft = boxW
    }
  }
  // ช่องว่างไว้ให้ออร่ารูปผู้บริหาร — วางใต้ข้อความหัว แสงจางจึงไม่ทับตัวหนังสือ
  const auraSlot = parts.push('') - 1
  parts.push(headerTexts.join(''))
  // คำ "Smart City Local" เติมที่ว่างใต้โลโก้/ข้อความหัว (เจ้าของสั่ง 2569-11-12 ตามภาพอ้างอิง) — มีที่ว่างพอเท่านั้น
  // ที่ว่างเกิดจากแถบหัวสูงตามรูปนายก จึงไม่ทำให้ภาพยาวขึ้น ไม่กระทบเพดาน A4
  {
    const top = Math.max(baseline + 18, logoCy + logoR + 14)
    const right = exec ? IMAGE_WIDTH - MARGIN - EXEC_PLATE_W - 24 : IMAGE_WIDTH - MARGIN
    const mark = smartCityMarkSvg(defs, markLeft, top, right - markLeft, headerH - 16 - top, measure)
    if (mark) parts.push(mark)
  }
  if (exec) {
    // ป้ายขาวขอบทองชิดขอบขวาของพื้นที่เนื้อหา · รูปอยู่กึ่งกลางป้าย ยืนชิดก้นกล่องและถูกป้ายทับช่วงล่าง (ไม่มีรูป = ป้ายอย่างเดียว)
    // ไม่มีพื้น/กรอบขาวหลังรูป — รูปที่ตัดพื้นหลังแล้วต้องลอยบนสีแถบหัว · ตัดไม่ได้ ผู้เรียกใส่กรอบมาในรูปเอง
    const plateX = IMAGE_WIDTH - MARGIN - EXEC_PLATE_W
    const centerX = plateX + EXEC_PLATE_W / 2
    if (execPhoto) {
      const px = centerX - execPhotoW / 2
      // วาด <image> ตรงๆ ไม่ผ่าน <use>/mask — ขอบเรืองขาวอยู่ในไฟล์รูปแล้ว (prepareExecutivePhoto) Safari จึงวาดเหมือน Chrome
      defs.push(`<clipPath id="news-exec-clip"><rect x="${num(px)}" y="${EXEC_PHOTO_TOP}" width="${execPhotoW}" height="${execPhotoH}"/></clipPath>`)
      parts[auraSlot] = execAuraSvg(defs, centerX, execPhotoW, execPhotoH)
      parts.push(`<image href="${esc(execPhoto)}" x="${num(px)}" y="${EXEC_PHOTO_TOP}" width="${execPhotoW}" height="${execPhotoH}" preserveAspectRatio="xMidYMax meet" clip-path="url(#news-exec-clip)" data-exec-photo="1"/>`)
    }
    if (execPlateH) {
      // เงาจางใต้ป้าย (สี่เหลี่ยมเลื่อนลง) แทน SVG filter ซึ่งบางเบราว์เซอร์ไม่วาดตอนแปลงเป็น PNG
      parts.push(`<rect x="${num(plateX)}" y="${num(execPlateTop + 6)}" width="${EXEC_PLATE_W}" height="${num(execPlateH)}" rx="26" fill="${theme.deep}" fill-opacity="0.28"/>`
        + `<rect x="${num(plateX)}" y="${num(execPlateTop)}" width="${EXEC_PLATE_W}" height="${num(execPlateH)}" rx="26" fill="#ffffff" stroke="${GOLD}" stroke-width="4"/>`)
      let top = execPlateTop + EXEC_PLATE_PAD_Y
      for (const [slot, fill] of [[execPlateLines.name, INK], [execPlateLines.title, MUTED]]) {
        if (!slot) continue
        for (const line of slot.lines) {
          text(centerX, top + Math.round(slot.size * 1.02), line, { size: slot.size, bold: slot.bold, fill, anchor: 'middle' })
          top += plateStep(slot)
        }
      }
    }
  }

  // ── การ์ดตัวเลข 2 ใบ (แทนป้ายเม็ดยาเดิม): ไล่สี + วงขาวมีไอคอน + ข้อความเล็ก/ตัวเลขใหญ่ ──
  let y = headerH + GOLD_BAND + gap(36)
  const cards = []
  if (model.showStatus) cards.push({ kind: 'status', label: 'สถานะเรื่อง', value: 'ดำเนินการแล้ว', from: STATUS_GREEN_LIGHT, to: STATUS_GREEN_DEEP, icon: checkIcon, iconColor: STATUS_GREEN })
  if (model.showDuration && model.durationLabel) {
    // "ใช้เวลา 5 วันทำการ" → ข้อความเล็ก "ใช้เวลา" + ตัวเลขใหญ่ "5 วันทำการ" · แบบอื่น ("เสร็จในวันที่ยื่น") แสดงทั้งข้อความ
    const split = /^ใช้เวลา\s+(.+)$/.exec(model.durationLabel)
    cards.push({ kind: 'duration', label: split ? 'ใช้เวลา' : 'ระยะเวลา', value: split ? split[1] : model.durationLabel, from: mixHex(theme.base, '#ffffff', 0.2), to: theme.deep, icon: clockIcon, iconColor: theme.base })
  }
  if (cards.length) {
    const cardH = gap(108)
    const cardW = (CONTENT_W - 24) / 2
    cards.forEach((card, i) => {
      const x = MARGIN + i * (cardW + 24)
      defs.push(`<linearGradient id="news-stat-${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${card.from}"/><stop offset="1" stop-color="${card.to}"/></linearGradient>`)
      parts.push(softCard(x, y, cardW, cardH, 26, `url(#news-stat-${i})`, ` data-stat="${card.kind}"`))
      const r = Math.round(cardH * 0.3)
      const cx = x + 24 + r
      const cy = y + cardH / 2
      parts.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${r}" fill="#ffffff"/>`)
      parts.push(iconIn(card.icon, cx - r * 0.62, cy - r * 0.62, r * 1.24, card.iconColor))
      const tx = cx + r + 18
      const tw = x + cardW - 18 - tx
      text(tx, y + cardH * 0.4, card.label, { size: sz(24), fill: '#ffffff', opacity: 0.92 })
      let valueSize = sz(40)
      while (valueSize > sz(26) && measure(card.value, valueSize, true) > tw) valueSize -= 1
      text(tx, y + cardH * 0.8, card.value, { size: valueSize, bold: true, fill: '#ffffff' })
    })
    y += cardH + gap(30)
  }

  // ── แถบขั้นตอน 4 จุด (คงแบบเดิมตามที่เจ้าของเลือก) + มิติ: ลูกบอลไล่สี + จุดสว่าง + เงาใต้วง + เส้นไล่สีมีเงา ในการ์ดขาว ──
  // วันที่ใต้ป้ายมาจาก model.steps เท่านั้น (จุดไหนไม่มีวัน = ไม่ใส่ ไม่เดา)
  const steps = Array.isArray(model.steps) ? model.steps.slice(0, 4) : []
  if (steps.length === 4) {
    const stepR = 20
    const padY = gap(20)
    const boxH = padY * 2 + stepR * 2 + 32 + 28 + 8
    parts.push(softCard(MARGIN, y, CONTENT_W, boxH, 24, '#ffffff', ' data-steps-card="1"'))
    const slotW = CONTENT_W / 4
    const stepCy = y + padY + stepR
    const centers = steps.map((_, i) => MARGIN + slotW * (i + 0.5))
    defs.push(`<radialGradient id="news-step-ball" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="${mixHex(theme.base, '#ffffff', 0.5)}"/><stop offset="0.55" stop-color="${theme.base}"/><stop offset="1" stop-color="${theme.deep}"/></radialGradient>`
      + `<linearGradient id="news-step-line" gradientUnits="userSpaceOnUse" x1="${num(centers[0])}" y1="${num(stepCy)}" x2="${num(centers[3])}" y2="${num(stepCy)}"><stop offset="0" stop-color="${mixHex(theme.base, '#ffffff', 0.3)}"/><stop offset="1" stop-color="${theme.deep}"/></linearGradient>`)
    for (let i = 0; i < 3; i += 1) {
      const x1 = num(centers[i] + stepR)
      const x2 = num(centers[i + 1] - stepR)
      parts.push(`<line x1="${x1}" y1="${num(stepCy + 3)}" x2="${x2}" y2="${num(stepCy + 3)}" stroke="${SHADOW}" stroke-opacity="0.12" stroke-width="8" stroke-linecap="round"/>`
        + `<line x1="${x1}" y1="${num(stepCy)}" x2="${x2}" y2="${num(stepCy)}" stroke="url(#news-step-line)" stroke-width="6" stroke-linecap="round" data-step-line="1"/>`)
    }
    steps.forEach((step, i) => {
      const cx = centers[i]
      parts.push(`<ellipse cx="${num(cx)}" cy="${num(stepCy + stepR + 5)}" rx="${num(stepR * 0.85)}" ry="4.5" fill="${SHADOW}" fill-opacity="0.2" data-step-shadow="1"/>`)
      // วงเรืองแสงจางรอบจุด (วงซ้อนความทึบต่ำ ไม่ใช้ filter)
      parts.push(`<circle cx="${num(cx)}" cy="${num(stepCy)}" r="${stepR + 9}" fill="${theme.base}" fill-opacity="0.14"/>`)
      parts.push(`<circle cx="${num(cx)}" cy="${num(stepCy)}" r="${stepR}" fill="url(#news-step-ball)" data-step-ball="1"/>`)
      // จุดสว่างมุมซ้ายบน = แสงตกกระทบ ให้ดูเป็นทรงกลม
      parts.push(`<ellipse cx="${num(cx - 6)}" cy="${num(stepCy - 9)}" rx="7" ry="4" fill="#ffffff" fill-opacity="0.38"/>`)
      parts.push(iconSvg(checkIcon, cx - 13, stepCy - 13, 26))
      text(cx, stepCy + stepR + 32, step.label, { size: 24, bold: true, fill: INK, anchor: 'middle' })
      if (step.date) text(cx, stepCy + stepR + 32 + 28, step.date, { size: 22, fill: MUTED, anchor: 'middle' })
    })
    y += boxH + gap(28)
  }

  // ── ป้ายวันที่ (แท็กสีอ่อนของธีม + ไอคอนหมวด) · หัวข้อข่าวมีแถบทองแนวตั้งนำหน้า · รายละเอียดในกล่อง callout สีเหลืองอ่อน ──
  // ไอคอนหมวด: มีรหัสหมวดเท่านั้น — หมวดสร้างเองได้ไอคอนกลาง ไม่รู้หมวด = ไม่วาด
  if (model.dateText) {
    const withIcon = !!model.categoryCode
    const tagH = gap(52)
    const dateSize = sz(28)
    const label = `วันที่ ${model.dateText}`
    const iconR = withIcon ? Math.round(tagH / 2) - 5 : 0
    const textStart = withIcon ? 5 + iconR * 2 + 12 : 22
    const tagW = textStart + Math.ceil(measure(label, dateSize, true)) + 22
    parts.push(`<rect x="${MARGIN}" y="${num(y)}" width="${tagW}" height="${tagH}" rx="${num(tagH / 2)}" fill="${theme.soft}" data-date-tag="1"/>`)
    if (withIcon) {
      const bcx = MARGIN + 5 + iconR
      const bcy = y + tagH / 2
      parts.push(`<circle cx="${num(bcx)}" cy="${num(bcy)}" r="${iconR}" fill="${theme.base}" data-category-icon="${esc(model.categoryCode)}"/>`)
      parts.push(iconSvg(iconNodeForCategory(model.categoryCode), bcx - iconR * 0.62, bcy - iconR * 0.62, iconR * 1.24))
    }
    text(MARGIN + textStart, y + Math.round(tagH * 0.68), label, { size: dateSize, bold: true, fill: theme.ink })
    y += tagH + gap(22)
  }
  if (model.headline) {
    const size = sz(40)
    const step = Math.round(size * 1.45)
    const first = y + size
    const after = block(MARGIN + 26, first, model.headline, CONTENT_W - 26, { size, bold: true, fill: INK, lineHeight: 1.45 })
    const last = after - step
    parts.push(`<rect x="${MARGIN}" y="${num(first - size * 0.82)}" width="8" height="${num(last - first + size * 1.02)}" rx="4" fill="${GOLD}" data-headline-bar="1"/>`)
    y = last + gap(20)
  }
  if (model.detail) {
    const size = sz(28)
    const step = Math.round(size * 1.45)
    const pad = gap(18)
    const iconR = 22
    const textX0 = MARGIN + pad + iconR * 2 + 16
    const lines = wrapLines(model.detail, MARGIN + CONTENT_W - pad - textX0, size, false, measure)
    const boxTop = y + gap(10)
    const boxH = Math.max(pad * 2 + iconR * 2, pad * 2 + (lines.length - 1) * step + Math.round(size * 1.15))
    parts.push(softCard(MARGIN, boxTop, CONTENT_W, boxH, 20, '#fefce8', ` stroke="#fde68a" stroke-width="2" data-callout="1"`))
    const icy = boxTop + pad + iconR
    parts.push(`<circle cx="${num(MARGIN + pad + iconR)}" cy="${num(icy)}" r="${iconR}" fill="${GOLD}"/>`)
    parts.push(iconIn(clipboardCheckIcon, MARGIN + pad + iconR - 13, icy - 13, 26, theme.deep))
    let baseline = boxTop + pad + Math.round(size * 0.95)
    for (const line of lines) {
      text(textX0, baseline, line, { size, fill: '#374151' })
      baseline += step
    }
    y = boxTop + boxH
  }

  // ── ขนาดแถบท้าย (คำนวณก่อนส่วนรูป เพราะรูปต้องรู้ว่าเหลือที่ว่างเท่าไรก่อนชนเพดาน A4) ──
  // ไม่มีเบอร์โทรและไม่มีชื่อกองผู้จัดทำ: ฐานไม่มีฟิลด์เบอร์ และเจ้าของระบบสั่งตัดข้อความ "จัดทำโดย" ออก
  // ขั้นบีบ (fit.foot) ย่อทั้ง QR/ช่องไฟ/ตัวหนังสือพร้อมกัน — ต่ำสุด QR 160 px ยังสแกนติด
  const fs = base => Math.round(base * fit.foot)
  const PAD = fs(30)
  const qr = model.reportUrl ? qrLayout(model.reportUrl, fs(200)) : null
  // QR ในการ์ดขาวมุมมน + คำใต้ QR (แบบภาพอ้างอิง)
  const qrPad = fs(12)
  const qrLabel = 'แจ้งเรื่องออนไลน์'
  const qrLabelSize = fs(22)
  const qrCardW = qr ? qr.side + qrPad * 2 : 0
  const qrCardH = qr ? qr.side + qrPad * 2 + Math.round(qrLabelSize * 1.5) : 0
  const footTextX = MARGIN + (qr ? qrCardW + 36 : 0)
  // คำขวัญมุมล่างขวา (เจ้าของสั่ง 2569-11-12 ตามภาพอ้างอิง) บนแผ่นเหลืองขอบโค้ง — กันที่ฝั่งขวาไว้ ข้อความแถบท้ายแคบลง
  // ลิงก์แจ้งเรื่องต้องอยู่บรรทัดเดียว (ตัดกลาง URL แล้วพิมพ์ตามไม่ได้) — ที่ข้างขวาไม่พอ (มี QR + ลิงก์ยาว)
  // = วางแผ่นเหลืองเป็นแถวมุมล่างขวาใต้ข้อความแทน (แถบท้ายสูงขึ้นเท่าแถวนั้น) · คำขวัญขึ้นทุกใบ
  const urlNeedW = model.reportUrl ? Math.ceil(measure(model.reportUrl.replace(/^https?:\/\//i, ''), fs(30), true)) : 0
  const sloganRoom = IMAGE_WIDTH - footTextX - urlNeedW - 24
  const sloganSide = Math.min(fs(SLOGAN_W), sloganRoom) >= fs(SLOGAN_MIN_W)
  const sloganW = sloganSide ? Math.min(fs(SLOGAN_W), sloganRoom) : fs(SLOGAN_ROW_W)
  const sloganRowH = sloganSide ? 0 : fs(SLOGAN_ROW_H)
  const footTextW = IMAGE_WIDTH - MARGIN - footTextX - (sloganSide ? sloganW - MARGIN + 24 : 0)
  // ปิด QR/ลิงก์ (ไม่มี reportUrl) = ข้อความขอบคุณแทน — ไม่ใช้ "แจ้งเราได้ตลอด 24 ชม." เพราะชวนแจ้งโดยไม่บอกช่องทาง
  // ประชาชนจะโทรเข้าสำนักงานแทน (เพิ่มงานเจ้าหน้าที่) · "มุ่งสู่" เมืองอัจฉริยะ: ยังไม่ได้รับรองเป็นเมืองอัจฉริยะ ห้ามเขียนว่าเป็นแล้ว
  // บรรทัดแรกสีทอง (หัวข้อสองสีแบบภาพอ้างอิง)
  const slots = model.reportUrl ? [
    { size: fs(36), bold: true, lines: wrapLines(NEWS_FOOTER_INVITE, footTextW, fs(36), true, measure), opacity: 1, fill: GOLD_TEXT },
    { size: fs(28), bold: false, lines: wrapLines(qr ? 'สแกน QR หรือเข้าที่' : 'เข้าที่', footTextW, fs(28), false, measure), opacity: 0.92 },
    { size: fs(30), bold: true, lines: wrapLines(model.reportUrl.replace(/^https?:\/\//i, ''), footTextW, fs(30), true, measure), opacity: 1 },
    // บรรทัดเล็กสุดท้าย — ข้อความรวม 4 บรรทัดยังสูงไม่เกินการ์ด QR แถบท้ายจึงไม่สูงขึ้น
    { size: fs(26), bold: false, lines: wrapLines(NEWS_FOOTER_SMART_CITY, footTextW, fs(26), false, measure), opacity: 0.92 },
  ] : [
    { size: fs(36), bold: true, lines: wrapLines(NEWS_FOOTER_THANKS[0], footTextW, fs(36), true, measure), opacity: 1, fill: GOLD_TEXT },
    { size: fs(30), bold: false, lines: wrapLines(NEWS_FOOTER_THANKS[1], footTextW, fs(30), false, measure), opacity: 0.95 },
  ]
  const stepOf = slot => Math.round(slot.size * 1.4)
  const footTextH = slots.reduce((sum, slot) => sum + slot.lines.length * stepOf(slot), 0)
  const footH = GOLD_BAND + Math.max(qrCardH, footTextH + (sloganRowH ? sloganRowH + fs(10) : 0)) + PAD * 2

  // ── รูป: การ์ดขาวขอบหนาเงานุ่ม + รูปครอปแบบ cover มุมมน + แท็กสีก่อน/หลังดำเนินการ ──
  if (photos.length) {
    y += gap(36)
    // ที่ว่างของตารางรูป = เพดาน A4 − แถบท้าย − ช่องว่างเหนือแถบท้าย − "และอีก N จุด" (ถ้ามี) − ตำแหน่งปัจจุบัน
    const moreH = moreText ? gap(48) + wrapLines(moreText, CONTENT_W, 32, true, measure).length * Math.round(32 * 1.4) : 0
    const grid = photoCells(photos.length, captionH, NEWS_MAX_HEIGHT - footH - gap(48) - moreH - y, fit.min)
    const frame = 8
    grid.cells.forEach((cell, i) => {
      const cx = MARGIN + cell.x
      const cy = y + cell.y
      parts.push(softCard(cx - frame, cy - frame, cell.w + frame * 2, cell.h + frame * 2, 24, '#ffffff', ' data-photo-card="1"'))
      defs.push(`<clipPath id="news-photo-${i}"><rect x="${num(cx)}" y="${num(cy)}" width="${num(cell.w)}" height="${num(cell.h)}" rx="18"/></clipPath>`)
      parts.push(`<rect x="${num(cx)}" y="${num(cy)}" width="${num(cell.w)}" height="${num(cell.h)}" rx="18" fill="#e5e7eb"/>`
        + `<image href="${esc(photos[i])}" x="${num(cx)}" y="${num(cy)}" width="${num(cell.w)}" height="${num(cell.h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#news-photo-${i})"/>`)
      // แท็กมุมซ้ายบน: ก่อน = ส้มอำพัน · หลัง = เขียวสถานะ + กล้อง + ข้อความขาว · ช่องแคบเกินกว่าจะใส่ข้อความ = เหลือแค่ไอคอนกล้อง ไม่ล้นช่อง
      const kind = entries[i].kind
      if (kind) {
        const label = NEWS_PHOTO_KIND_LABELS[kind]
        const inset = 14
        const badgeH = 44
        const iconSize = 26
        const fullW = 14 + iconSize + 8 + Math.ceil(measure(label, 24, true)) + 18
        const showLabel = fullW <= cell.w - inset * 2
        const badgeW = showLabel ? fullW : 14 + iconSize + 14
        const bg = kind === 'before' ? BEFORE_AMBER : STATUS_GREEN
        parts.push(`<rect x="${num(cx + inset)}" y="${num(cy + inset + 3)}" width="${badgeW}" height="${badgeH}" rx="${badgeH / 2}" fill="${SHADOW}" fill-opacity="0.25"/>`
          + `<rect x="${num(cx + inset)}" y="${num(cy + inset)}" width="${badgeW}" height="${badgeH}" rx="${badgeH / 2}" fill="${bg}" data-photo-kind="${kind}"/>`)
        parts.push(iconSvg(cameraIcon, cx + inset + 14, cy + inset + (badgeH - iconSize) / 2, iconSize))
        if (showLabel) text(cx + inset + 14 + iconSize + 8, cy + inset + 31, label, { size: 24, bold: true, fill: '#ffffff' })
      }
      const caption = entries[i].caption
      if (caption) {
        // ป้ายหมู่กึ่งกลางใต้รูป — ยาวเกินความกว้างช่องใช้บรรทัดแรกที่ตัดแล้ว (ไม่ล้นไปทับรูปข้างเคียง)
        const fitted = measure(caption, 30, true) > cell.w ? (wrapLines(caption, cell.w, 30, true, measure)[0] ?? '') : caption
        text(cx + cell.w / 2, cy + cell.h + 42, fitted, { size: 30, bold: true, fill: theme.base, anchor: 'middle' })
      }
    })
    y += grid.height
  }
  // ภาพรวม: "และอีก N จุด" ใต้ตารางรูป (จุดที่เกิน 4 ช่อง) — ไม่ทับลงบนรูป
  if (moreText) y = block(MARGIN, y + gap(48), moreText, CONTENT_W, { size: 32, bold: true, fill: theme.base, lineHeight: 1.4 })

  // ── แถบท้าย: แถบทองด้านบน + พื้นไล่สีเดียวกับแถบหัว + วงกลมจาง + QR ในการ์ดขาว ──
  const footTop = Math.max(y + gap(48), NEWS_MIN_HEIGHT - footH)
  const height = Math.ceil(footTop + footH)
  const bodyTop = footTop + GOLD_BAND
  defs.push(`<linearGradient id="news-foot-grad" x1="0" y1="0" x2="1" y2="1">${FRAME_STOPS}</linearGradient>`
    + `<clipPath id="news-foot-clip"><rect y="${num(bodyTop)}" width="${IMAGE_WIDTH}" height="${num(height - bodyTop)}"/></clipPath>`)
  // วงกลมจางถูกวางก่อน QR/ข้อความ — ไม่ทับสิ่งที่ต้องสแกนหรืออ่าน (QR ยังเป็นดำบนพื้นขาว)
  parts.push(`<rect y="${num(footTop)}" width="${IMAGE_WIDTH}" height="${GOLD_BAND}" fill="${GOLD}" data-gold-band="footer"/>`
    + `<rect y="${num(bodyTop)}" width="${IMAGE_WIDTH}" height="${num(height - bodyTop)}" fill="url(#news-foot-grad)" data-footer="1"/>`
    + bokehSvg('news-foot-clip', bodyTop, IMAGE_WIDTH, height - bodyTop, true))
  const contentH = footH - GOLD_BAND
  if (qr) {
    // QR ดำบนพื้นขาว (รวมขอบสงบ) เสมอ ห้ามให้สีแถบมาเป็นพื้นของ QR
    const cardY = bodyTop + (contentH - qrCardH) / 2
    parts.push(softCard(MARGIN, cardY, qrCardW, qrCardH, 20, '#ffffff', ' data-qr-card="1"'))
    parts.push(`<g transform="translate(${MARGIN + qrPad} ${num(cardY + qrPad)})"><rect width="${qr.side}" height="${qr.side}" fill="#ffffff"/><path transform="translate(${QUIET_MODULES * qr.module} ${QUIET_MODULES * qr.module}) scale(${qr.module})" d="${qr.d}" fill="#000000" shape-rendering="crispEdges"/></g>`)
    text(MARGIN + qrCardW / 2, cardY + qrPad + qr.side + Math.round(qrLabelSize * 1.1), qrLabel, { size: qrLabelSize, bold: true, fill: theme.deep, anchor: 'middle' })
  }
  // แบบข้าง: แผ่นสูงเต็มแถบท้าย · แบบแถว: แผ่นมุมล่างขวาชิดขอบล่าง ข้อความเลื่อนขึ้นไปอยู่เหนือแผ่น
  const sloganTop = sloganRowH ? height - PAD - sloganRowH : bodyTop
  parts.push(sloganSvg(IMAGE_WIDTH - sloganW, sloganTop, sloganW, height - sloganTop, measure))
  let lineTop = sloganRowH
    ? bodyTop + (contentH - footTextH - sloganRowH - fs(10)) / 2
    : bodyTop + (contentH - footTextH) / 2
  for (const slot of slots) {
    for (const line of slot.lines) {
      parts.push(`<text x="${num(footTextX)}" y="${num(lineTop + Math.round(slot.size * 1.05))}" font-size="${slot.size}" font-weight="${slot.bold ? 700 : 400}" fill="${slot.fill ?? '#ffffff'}" fill-opacity="${slot.opacity}">${esc(line)}</text>`)
      lineTop += stepOf(slot)
    }
  }

  // พื้นขาวเต็มภาพเป็นองค์ประกอบแรกสุด — PNG ไม่มีพื้นจะโปร่งใสแล้วตัวอักษรเข้มกลายเป็นดำบนดำในแอปโหมดมืด
  // ฟอนต์ฝัง (Kanit — newsFont.js) อยู่ใน <style> ของ SVG เอง เพราะ SVG ที่เปิดผ่าน <img> โหลดไฟล์ภายนอกไม่ได้
  const embedded = newsFontOk(font)
  const fontAttr = embedded ? newsFontStack(font.family) : FONT_STACK
  const style = embedded ? `<style>${font.css}</style>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}" font-family="${fontAttr}" role="img" aria-label="${esc(`ข่าวประชาสัมพันธ์ ${model.tenantName}`)}"><title>${esc(`ข่าวประชาสัมพันธ์ ${model.tenantName}`)}</title>${style}<rect width="${IMAGE_WIDTH}" height="${height}" fill="#ffffff"/>${pageBackdrop(IMAGE_WIDTH, height, theme)}<defs>${defs.join('')}</defs>${parts.join('')}</svg>`
  return { svg, width: IMAGE_WIDTH, height, photoCount: photos.length, fitsA4: height <= NEWS_MAX_HEIGHT }
}

/** ข้อความสำหรับคัดลอก/แนบตอนแชร์ — ข้อความข่าว + รายละเอียด (+ ลิงก์แจ้งเรื่อง) */
export function newsShareText(model) {
  return [model.headline, model.detail, model.reportUrl ? `แจ้งเรื่อง/ติดตามเรื่อง: ${model.reportUrl}` : '']
    .filter(Boolean).join('\n\n')
}
