// ภาพอินโฟกราฟิก "สรุปเรื่องร้องเรียนประจำเดือน" — ภาพเดียวที่เจ้าหน้าที่ดาวน์โหลด/แชร์ไปลง LINE หรือ Facebook
// (แนวเดียวกับที่เทศบาลนครยะลาทำมือทุกเดือน แต่ระบบวาดให้เองจากตัวเลขรวม ไม่มีอะไรให้เจ้าหน้าที่กรอก)
//
// ภาพเป็นสตริง SVG ก้อนเดียว: หน้าเว็บแสดงผ่าน <img src="data:image/svg+xml"> และปุ่มดาวน์โหลดแปลงสตริงเดียวกัน
// เป็น PNG — ภาพที่เห็นกับภาพที่ได้จึงมาจากตัววาดตัวเดียว ไม่มีทางหน้าตาต่างกัน
//   <img> + SVG ไม่รันสคริปต์ใดๆ แม้ข้อความที่ฝังมาจะมีแท็ก (ชื่อ อปท./ชื่อหมวดแก้ได้โดยแอดมิน) และทุกค่ายัง esc() ซ้ำ
//
// ข้อมูลในภาพ: ยอดรวม ร้อยละ ชื่อหมวด ชื่อ อปท. เท่านั้น — ไม่มีชื่อ เบอร์ ที่อยู่ พิกัดผู้แจ้ง และไม่มีรายเรื่อง
// ไอคอนเป็นของ lucide ไม่ใช้มาสคอต/ภาพประกอบของ อปท. ใด (เป็นอัตลักษณ์ของเขา)
//
// ฟอนต์: SVG ที่ถูกโหลดเป็นภาพใช้ได้เฉพาะฟอนต์ในเครื่อง (เว็บฟอนต์ไม่ติดมา) จึงระบุชุดที่มีอักษรไทยในแต่ละระบบ
// และ "วัดความกว้างข้อความด้วย canvas ชุดฟอนต์เดียวกัน" ก่อนตัดบรรทัด — ข้อความไทยไม่มีช่องว่างคั่นคำ
// ต้องตัดตามขอบเขตคำ (Intl.Segmenter) ไม่งั้นคำขาดกลางพยางค์
//
// ไฟล์นี้ต้องไม่แตะ DOM ตอนโหลดโมดูล — เทสต์รันด้วย node (ตัววัดข้อความส่งเข้ามาจากผู้เรียก)

import { __iconNode as checkIcon } from 'lucide-react/dist/esm/icons/check.mjs'
import { __iconNode as clockIcon } from 'lucide-react/dist/esm/icons/clock.mjs'
import { __iconNode as sparklesIcon } from 'lucide-react/dist/esm/icons/sparkles.mjs'
import { __iconNode as mapPinIcon } from 'lucide-react/dist/esm/icons/map-pin.mjs'
import { __iconNode as listIcon } from 'lucide-react/dist/esm/icons/list-ordered.mjs'
import { iconNodeForCategory } from './complaintCategoryIcons.js'
import { formatCount, formatPercent } from './complaintMonthlySummary.js'
import { QUIET_MODULES, qrLayout } from './qrSvg.js'
import { SMART_CITY_TAGLINE, smartCityMarkSvg } from './smartCityMark.js'

export const IMAGE_WIDTH = 1080
// 4:5 — ขนาดที่ Facebook/Instagram ไม่ครอปในฟีด ถ้าเนื้อหายาวกว่านี้ภาพจะสูงขึ้นเอง (ไม่ตัดข้อความทิ้ง)
export const IMAGE_MIN_HEIGHT = 1350
export const FONT_STACK = "Tahoma, 'Leelawadee UI', 'Noto Sans Thai', Thonburi, 'Sukhumvit Set', Arial, sans-serif"

const MARGIN = 64
// รายการย่อยใต้หมวด: ระยะเยื้องจากชื่อหมวด และระยะระหว่างบรรทัด
const SUB_INDENT = 22
const SUB_STEP = 34
const CONTENT_W = IMAGE_WIDTH - MARGIN * 2
const INK = '#16324f'
const MUTED = '#52647a'
// การ์ดผลการดำเนินงาน: ไล่สีอ่อน 2 จุด (from → to) + สีตัวอักษร/ไอคอน (fg) — ตัวอักษร fg บนพื้นทั้งสองจุดผ่าน 4.5:1
const PANEL = {
  resolved: { from: '#f0fdf4', to: '#d1fae5', fg: '#047857' },
  ongoing: { from: '#fffbeb', to: '#fde9b8', fg: '#92400e' },
}

// ── ชุดพรีเมียม (เจ้าของสั่ง 2569-11-17 "เพิ่มความพรีเมียมเต็มที่") — แนวเดียวกับภาพข่าว (complaintNewsImage.js)
// การ์ดขาวมุมมน + เงานุ่ม 2 ชั้น (สี่เหลี่ยมเลื่อนลง ไม่ใช้ SVG filter — Safari/การแปลง PNG วาดไม่ตรง) · แถบทอง · แสงฟุ้ง
// ทุกอย่างวาดด้วยรูปทรง + ไล่สีล้วน ตายตัว ไม่สุ่ม
const GOLD = '#f5c242'
const SHADOW = '#0f172a'
const CARD_X = 40
const CARD_W = IMAGE_WIDTH - CARD_X * 2
// โลโก้ อปท. มุมซ้ายของแถบหัว: วงกลมขาวขอบทอง (รูปถูกครอปเป็นวงกลมใน)
const LOGO_R = 64
const LOGO_PAD = 9

/** การ์ดมุมมน + เงานุ่ม 2 ชั้น (ชุดเดียวกับภาพข่าว) */
function softCard(x, y, w, h, r, fill, extra = '') {
  return `<rect x="${num(x)}" y="${num(y + 10)}" width="${num(w)}" height="${num(h)}" rx="${r}" fill="${SHADOW}" fill-opacity="0.05"/>`
    + `<rect x="${num(x)}" y="${num(y + 3)}" width="${num(w)}" height="${num(h)}" rx="${r}" fill="${SHADOW}" fill-opacity="0.07"/>`
    + `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${r}" fill="${fill}"${extra}/>`
}

// โลโก้ต้องเป็นรูปที่หน้าเว็บแปลงเป็น PNG/JPEG data URL แล้วเท่านั้น (prepareLogoDataUrl) — กันสตริงแปลกปลอม/ลิงก์ภายนอก
// (SVG ที่โหลดเป็น <img> ดึงไฟล์ภายนอกไม่ได้อยู่แล้ว และ data:image/svg ซ้อนสคริปต์ได้ จึงไม่รับ)
export const logoDataUrlOk = value => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)

// สีชิ้นวงกลม: ชุดเดียวกับภาพสรุปรถรับ-ส่งผู้ป่วย (ReportInfographic) เพื่อให้ภาพของระบบเดียวกันหน้าตาเข้ากัน
// ทุกสีให้ไอคอนสีขาวชัดเกิน 3:1 (เกณฑ์ของกราฟิกที่ไม่ใช่ตัวอักษร) ส่วนตัวอักษรอยู่บนพื้นขาวเสมอ ไม่ทับชิ้นวงกลม
export const SLICE_COLORS = ['#7c3aed', '#ea580c', '#0891b2', '#db2777', '#b45309', '#0f766e', '#4f46e5']
export const REST_COLOR = '#64748b'

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const num = n => Math.round(n * 100) / 100

/**
 * @param {ReturnType<import('./complaintMonthlySummary.js').summarizeMonth>} summary
 * @param {{ tenantName?: string, reportUrl?: string, logoDataUrl?: string | null }} [options]
 *   reportUrl: ลิงก์หน้าแจ้งเรื่องของ อปท. (เต็ม มี https://) — ใส่แล้วท้ายภาพมี QR + ข้อความชวนแจ้งเรื่อง ไม่ใส่ = ไม่มีกล่องนี้
 *   logoDataUrl: โลโก้ อปท. (data URL ที่ผ่าน prepareLogoDataUrl) — ไม่มี/ผิดรูป = แถบหัวแบบเดิม ข้อความกึ่งกลาง ไม่มีวงโลโก้
 */
export function buildInfographicModel(summary, { tenantName = '', reportUrl = '', logoDataUrl = null } = {}) {
  const total = summary.total
  let cumulative = 0
  const slices = summary.categories.map((category, index) => {
    const start = total > 0 ? cumulative / total : 0
    cumulative += category.count
    return {
      code: category.code,
      subItems: category.subItems ?? [],
      label: category.label,
      count: category.count,
      percent: category.percent,
      color: category.code === null ? REST_COLOR : SLICE_COLORS[index % SLICE_COLORS.length],
      start,
      end: total > 0 ? cumulative / total : 0,
    }
  })
  const notes = [
    ...summary.notes.filter(note => !note.startsWith('ไม่แสดงสัดส่วนตามหมวด')),
    'แหล่งข้อมูล: ระบบ e-Service SmartLocal · ไม่มีข้อมูลระบุตัวบุคคลและไม่แสดงรายเรื่อง',
  ]
  return {
    title: 'สรุปเรื่องร้องเรียน',
    // ชื่อช่วงบนแถบหัว (ตัวเหลือง) — วัน/สัปดาห์/ไตรมาสได้ชื่อของตัวเองจาก summarizeMonth ชื่อคีย์ month* คงไว้เพราะเทสต์อ่านอยู่
    monthLabel: summary.periodTitle ?? `เดือน${summary.period.label}`,
    monthKey: summary.period.key,
    periodThisOne: summary.periodThisOne ?? 'เดือนนี้',
    tenantName: tenantName || 'หน่วยงาน',
    total,
    // true = เจ้าหน้าที่ตัดบางหมวดออก — วงกลมเขียน "รวม" ไม่ใช่ "รวมทั้งสิ้น" (หมายเหตุท้ายภาพมาจาก summary.notes)
    partial: summary.excludesHidden === true,
    slices,
    categoriesComplete: summary.categoriesComplete,
    resolved: { count: summary.resolved, percent: summary.resolvedPercent },
    ongoing: { count: summary.ongoing, percent: summary.ongoingPercent },
    rejected: { count: summary.rejected, percent: summary.rejectedPercent },
    parked: { count: summary.parked ?? 0, percent: summary.parkedPercent ?? 0 },
    reportUrl: String(reportUrl ?? '').trim(),
    logo: logoDataUrlOk(logoDataUrl) ? logoDataUrl : null,
    // อันดับ 1–5 (summarizeMonth) — ไม่มี/ว่าง = ไม่มีการ์ดนั้น
    areaRanking: summary.areaRanking?.length ? summary.areaRanking : null,
    typeRanking: summary.typeRanking?.length ? summary.typeRanking : null,
    notes,
    asOf: summary.asOf,
  }
}

/**
 * ตัดข้อความเป็นบรรทัดตามความกว้างจริง — ตัดที่ขอบเขตคำ คำเดียวยาวเกินความกว้างจึงตัดกลางคำ (กรณีสุดวิสัยเท่านั้น)
 * @param {string} value
 * @param {number} maxWidth
 * @param {number} size
 * @param {boolean} bold
 * @param {(text: string, size: number, bold: boolean) => number} measure
 */
export function wrapLines(value, maxWidth, size, bold, measure) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return []
  // Intl.Segmenter ไม่มีใน Firefox ก่อน 125 — ถอยไปตัดทีละอักษร (ตัดกลางคำได้ แต่ภาพยังออก ไม่ล้ม)
  const segment = (value, granularity) => (typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('th', { granularity }).segment(value)].map(part => part.segment)
    : Array.from(value))
  // เครื่องหมายปิด/ๆ/ฯ ที่ถูกแยกเป็นคำของตัวเอง ต้องติดคำก่อนหน้า ไม่ปล่อยให้ขึ้นบรรทัดใหม่โดดเดี่ยว
  // (เคสจริง: "กลิ่นเหม็นรบกวน (มลพิษทางอากาศ" แล้ว ")" ลงไปยืนบรรทัดถัดไปคนเดียว)
  const words = []
  for (const part of segment(text, 'word')) {
    if (words.length && /^[)\]}”’"'ๆฯ.,;:!?…%]+$/u.test(part)) words[words.length - 1] += part
    else words.push(part)
  }
  const lines = []
  let line = ''
  const push = () => { if (line.trim()) lines.push(line.trim()); line = '' }
  for (const word of words) {
    if (measure(line + word, size, bold) <= maxWidth) { line += word; continue }
    push()
    if (measure(word, size, bold) <= maxWidth) { line = word.trimStart(); continue }
    for (const piece of segment(word, 'grapheme')) {
      if (measure(line + piece, size, bold) > maxWidth) push()
      line += piece
    }
  }
  push()
  return lines
}

function arcPoint(cx, cy, radius, fraction) {
  const angle = fraction * Math.PI * 2 - Math.PI / 2
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
}

/** ชิ้นวงแหวน (donut) จากเศษส่วน start→end ของวงกลม — เต็มวงต้องแยกเป็น 2 ครึ่ง เพราะส่วนโค้ง 360° วาดไม่ได้ */
export function donutSlicePath(cx, cy, outer, inner, start, end) {
  if (end - start >= 0.9999) {
    const ring = (r, sweep) => `M ${num(cx - r)} ${num(cy)} A ${r} ${r} 0 1 ${sweep} ${num(cx + r)} ${num(cy)} A ${r} ${r} 0 1 ${sweep} ${num(cx - r)} ${num(cy)} Z`
    return `${ring(outer, 1)} ${ring(inner, 0)}`
  }
  const large = end - start > 0.5 ? 1 : 0
  const [x1, y1] = arcPoint(cx, cy, outer, start)
  const [x2, y2] = arcPoint(cx, cy, outer, end)
  const [x3, y3] = arcPoint(cx, cy, inner, end)
  const [x4, y4] = arcPoint(cx, cy, inner, start)
  return `M ${num(x1)} ${num(y1)} A ${outer} ${outer} 0 ${large} 1 ${num(x2)} ${num(y2)} L ${num(x3)} ${num(y3)} A ${inner} ${inner} 0 ${large} 0 ${num(x4)} ${num(y4)} Z`
}

const ICON_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'])

// export ให้ภาพข่าว (complaintNewsImage.js) ใช้ตัววาดไอคอนชุดเดียวกัน ไม่เขียนซ้ำ
export function iconSvg(node, x, y, size) {
  const shapes = node
    .filter(([tag]) => ICON_TAGS.has(tag))
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs)
      .filter(([name]) => name !== 'key')
      .map(([name, value]) => `${esc(name)}="${esc(value)}"`).join(' ')}/>`)
    .join('')
  return `<g transform="translate(${num(x)} ${num(y)}) scale(${num(size / 24)})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`
}

// สีแถบหัวภาพ: พื้นเขียวเข้ม + คลื่นมุมซ้าย 2 ชั้น (เขียวมะนาว) + เดือนสีเหลือง — เจ้าของเลือกโทนเขียวตามภาพอ้างอิง 2569-10-19
// คอนทราสต์ตัวอักษรบนพื้นนี้ (คำนวณแล้ว): ขาว 9.1:1 · เหลือง 6.5:1 — ทั้งคู่เกินเกณฑ์ตัวอักษรทั่วไป 4.5:1
export const HEADER_BG = '#14532d'
export const MONTH_COLOR = '#ffd54a'
const WAVE_BACK = { fill: '#a3e635', opacity: 0.5 }
const WAVE_FRONT = { fill: '#d9f99d', opacity: 0.38 }
// แถบท้ายภาพ (หมายเหตุ/แหล่งข้อมูล + Smart City Local) — สูงอย่างน้อยเท่านี้ ให้เครื่องหมายย่อได้ราว 0.65 ยังอ่านออก
// หมายเหตุยาวเกินจะย่อตัวอักษรก่อน (FOOT_NOTE_SIZES) ยังไม่พอค่อยให้แถบสูงขึ้น — ไม่ตัดข้อความทิ้ง
const FOOTER_BAND_H = 200
const FOOT_NOTE_SIZES = [24, 23, 22, 21, 20, 19, 18]
const FOOT_NOTE_COLOR = '#dcfce7'
// แคปซูลคำขวัญใต้ชื่อ อปท. ในแถบหัว (เจ้าของสั่ง 2569-11-17 ย้ายจากแถบท้าย แล้วสั่งย่อ: ห้ามเด่นกว่าชื่อ อปท.)
const CAPSULE_H = 38
const CAPSULE_TEXT = 20
const CAPSULE_ICON = 20
// ชื่อ อปท. ในแถบหัว — ใหญ่กว่าคำขวัญชัดเจน (36 vs 20) เป็นตัวเด่นอันดับสองรองจากชื่อเรื่อง
export const TENANT_SIZE = 36
const GOLD_LIGHT = '#fde68a'

/**
 * แถบหัวภาพ: คลื่นมุมซ้ายบน + จุดไข่ปลามุมขวาบน ชื่อเรื่อง (ขาว) กับเดือน (เหลือง) บรรทัดเดียวกันกลางภาพ
 * ใต้ลงมาเป็นชื่อ อปท. มีเส้นขีดสองข้าง — คลื่น/จุดเป็นรูปทรงที่เราวาดเอง (ไม่ใช่งานศิลป์ของ อปท. ใด)
 *
 * ชื่อเรื่อง+เดือนยาวเกินความกว้าง (เดือนยาวๆ เช่น กุมภาพันธ์ + ปี) ลดขนาดตัวอักษรลงจนพอดีบรรทัดเดียว (ต่ำสุด 42 · มีโลโก้ 36)
 * ยังไม่พอก็แยกเป็น 2 บรรทัด — ข้อความทุกชิ้นวัดด้วยตัววัดชุดเดียวกับที่ใช้ตัดบรรทัด จึงไม่ล้นขอบ
 * ชื่อ อปท. ยาวหลายบรรทัดได้ (เส้นขีดสองข้างวาดเฉพาะเมื่อชื่ออยู่บรรทัดเดียวและมีที่พอ)
 */
function headerBand(model, measure) {
  // มีโลโก้ = ข้อความกึ่งกลางในเขตขวาของวงโลโก้ · ไม่มี = กึ่งกลางภาพ (แบบเดิม ตำแหน่งทุกอย่างเท่าเดิม)
  const regionLeft = model.logo ? MARGIN + LOGO_R * 2 + 28 : MARGIN
  // ขวากันที่ไว้ 130px ให้ลายจุดมุมขวาบนเหมือนแบบไม่มีโลโก้ (ตัวอักษรไม่ทับจุด)
  const regionRight = model.logo ? IMAGE_WIDTH - 130 : IMAGE_WIDTH - MARGIN
  const cx = model.logo ? (regionLeft + regionRight) / 2 : IMAGE_WIDTH / 2
  const gap = 20
  const titleWidth = size => measure(model.title, size, true)
  const monthWidth = size => measure(model.monthLabel, size, true)
  const oneLineWidth = size => titleWidth(size) + gap + monthWidth(size)
  // กว้างสุดของบรรทัดเดียว: เหลือที่ว่างสองข้าง 130px ให้คลื่น/จุดไข่ปลาไม่ทับตัวอักษร (ชื่อเรื่องแบบยะลากินราว 2 ใน 3 ของแถบ)
  const maxLine = model.logo ? regionRight - regionLeft : IMAGE_WIDTH - 130 * 2
  // มีโลโก้ เขตข้อความแคบลง ~190px — ยอมย่อได้ถึง 36 (ยังเป็นตัวใหญ่สุดในภาพ) ดีกว่าแตกเป็น 2 บรรทัดแล้วหัวภาพสูงขึ้น
  const minSize = model.logo ? 36 : 42
  let size = 58
  while (size > minSize && oneLineWidth(size) > maxLine) size -= 2
  const oneLine = oneLineWidth(size) <= maxLine

  const texts = []
  const addText = (x, y, value, { size: fontSize, fill, anchor = 'start' }) => {
    texts.push(`<text x="${num(x)}" y="${num(y)}" font-size="${fontSize}" font-weight="700" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`)
  }
  let baseline = 46 + Math.round(size * 0.95)
  if (oneLine) {
    const startX = cx - oneLineWidth(size) / 2
    addText(startX, baseline, model.title, { size, fill: '#ffffff' })
    addText(startX + titleWidth(size) + gap, baseline, model.monthLabel, { size, fill: MONTH_COLOR })
  } else {
    baseline = 46 + 50
    addText(cx, baseline, model.title, { size: 52, fill: '#ffffff', anchor: 'middle' })
    baseline += 62
    addText(cx, baseline, model.monthLabel, { size: 46, fill: MONTH_COLOR, anchor: 'middle' })
  }

  const tenantLines = wrapLines(model.tenantName, regionRight - regionLeft, TENANT_SIZE, true, measure)
  baseline += 68
  // เส้นประดับสองข้างชื่อ อปท. (เจ้าของสั่งเพิ่มความพรีเมียม 2569-11-17): เส้นทองไล่จางออกด้านนอก + เพชรทองที่ปลายด้านชื่อ
  // วาดเฉพาะเมื่อชื่ออยู่บรรทัดเดียวและมีที่พอ (ชื่อยาวหลายบรรทัด = ไม่มีเส้น เหมือนเดิม)
  const rules = []
  for (const [index, line] of tenantLines.entries()) {
    addText(cx, baseline, line, { size: TENANT_SIZE, fill: '#ffffff', anchor: 'middle' })
    if (tenantLines.length === 1) {
      const half = measure(line, TENANT_SIZE, true) / 2
      const gapToText = 26
      const length = Math.min(120, cx - half - gapToText - regionLeft)
      if (length >= 30) {
        const lineY = baseline - 13
        for (const [side, from, to] of [['l', cx - half - gapToText - length, cx - half - gapToText], ['r', cx + half + gapToText, cx + half + gapToText + length]]) {
          const tip = side === 'l' ? to : from
          rules.push(`<rect x="${num(from)}" y="${num(lineY - 1.5)}" width="${num(to - from)}" height="3" fill="url(#info-rule-${side})" data-tenant-rule="${side}"/>`
            + `<rect x="${num(tip - 5)}" y="${num(lineY - 5)}" width="10" height="10" fill="${GOLD}" transform="rotate(45 ${num(tip)} ${num(lineY)})"/>`)
        }
      }
    }
    if (index < tenantLines.length - 1) baseline += Math.round(TENANT_SIZE * 1.4)
  }
  const ruleGradients = `<linearGradient id="info-rule-l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${GOLD}" stop-opacity="0"/><stop offset="1" stop-color="${GOLD}"/></linearGradient>`
    + `<linearGradient id="info-rule-r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${GOLD}"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></linearGradient>`
  // แคปซูล "มุ่งสู่เมืองอัจฉริยะ (Smart City)" แบบเรียบเป็นบรรทัดรอง: พื้นขาวโปร่ง 10% + เงาแก้วจางครึ่งบน + ขอบทองบาง
  // + ไอคอนประกายและตัวอักษรทองอ่อน — เจ้าของสั่งย่อ (เดิมแคปซูลทองทึบเด่นกว่าชื่อ อปท.) · ทองอ่อนบนเขียวเข้ม > 4.5:1
  const capTextW = measure(SMART_CITY_TAGLINE, CAPSULE_TEXT, true)
  const capW = Math.min(regionRight - regionLeft, 18 + CAPSULE_ICON + 9 + capTextW + 20)
  const capX = cx - capW / 2
  const capY = baseline + 20
  const capR = CAPSULE_H / 2
  const capsule = `<g data-smart-city-tag="1">`
    + `<rect x="${num(capX)}" y="${num(capY)}" width="${num(capW)}" height="${CAPSULE_H}" rx="${capR}" fill="#ffffff" fill-opacity="0.1" stroke="${GOLD}" stroke-opacity="0.85" stroke-width="1.5"/>`
    + `<rect x="${num(capX + 5)}" y="${num(capY + 3)}" width="${num(capW - 10)}" height="${CAPSULE_H / 2 - 3}" rx="${CAPSULE_H / 4 - 1.5}" fill="#ffffff" fill-opacity="0.08"/>`
    + iconSvg(sparklesIcon, capX + 18, capY + (CAPSULE_H - CAPSULE_ICON) / 2, CAPSULE_ICON).replace('stroke="#ffffff"', `stroke="${GOLD_LIGHT}"`)
    + '</g>'
  const capGradient = ruleGradients
  addText(capX + 18 + CAPSULE_ICON + 9, capY + CAPSULE_H / 2 + 7, SMART_CITY_TAGLINE, { size: CAPSULE_TEXT, fill: GOLD_LIGHT })
  const height = Math.max(capY + CAPSULE_H + 28, model.logo ? LOGO_R * 2 + 44 : 0)

  // คลื่นซ้ายบน (2 ชั้น) — สัดส่วนตามความสูงแถบ
  const h = height
  const wave = (width, { fill, opacity }, depth) => {
    const px = value => num(value * width / 270)
    const py = value => num(h * value * depth)
    return `<path d="M0 0H${width}C${px(250)} ${py(0.2)} ${px(190)} ${py(0.27)} ${px(130)} ${py(0.34)}C${px(70)} ${py(0.42)} ${px(24)} ${py(0.57)} 0 ${py(0.79)}Z" fill="${fill}" fill-opacity="${opacity}"/>`
  }
  // จุดไข่ปลามุมขวาบน: ใหญ่ที่ขอบขวาบนแล้วเล็กลงไปทางซ้ายและลง
  const dots = []
  const columns = 8
  const rows = 6
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const radius = 3.6 * (1 - column / columns) * (1 - (row / rows) * 0.75)
      if (radius < 0.8) continue
      dots.push(`<circle cx="${IMAGE_WIDTH - 22 - column * 18}" cy="${16 + row * 18}" r="${num(radius)}"/>`)
    }
  }
  // แสงฟุ้งจางกลางแถบ + วงกลมจางมุมขวา (bokeh) อยู่ใต้คลื่น/จุด/ตัวอักษร · ไม่แตะกลางขอบบนและมุมบนซ้าย (เทสต์อ่านสีพื้นตรงนั้น)
  const glow = `<radialGradient id="info-head-glow" gradientUnits="userSpaceOnUse" cx="${num(cx)}" cy="${num(height * 0.62)}" r="${num(height * 1.4)}"><stop offset="0" stop-color="#4ade80" stop-opacity="0.32"/><stop offset="1" stop-color="#4ade80" stop-opacity="0"/></radialGradient>`
  const decor = `<rect y="${num(height * 0.2)}" width="${IMAGE_WIDTH}" height="${num(height * 0.8)}" fill="url(#info-head-glow)"/>`
    + `<circle cx="${IMAGE_WIDTH * 0.84}" cy="${num(height * 1.05)}" r="${IMAGE_WIDTH * 0.17}" fill="#ffffff" fill-opacity="0.06"/>`
    + `<circle cx="${IMAGE_WIDTH * 0.97}" cy="${num(height * 0.7)}" r="${IMAGE_WIDTH * 0.09}" fill="#ffffff" fill-opacity="0.05"/>`
  let logo = ''
  if (model.logo) {
    const lcx = MARGIN + LOGO_R
    const lcy = (height - 6) / 2
    const inner = LOGO_R - LOGO_PAD
    logo = `<g data-tenant-logo="1"><circle cx="${lcx}" cy="${num(lcy + 5)}" r="${LOGO_R}" fill="${SHADOW}" fill-opacity="0.3"/>`
      + `<circle cx="${lcx}" cy="${num(lcy)}" r="${LOGO_R}" fill="#ffffff" stroke="${GOLD}" stroke-width="5"/>`
      + `<clipPath id="info-logo-clip"><circle cx="${lcx}" cy="${num(lcy)}" r="${inner}"/></clipPath>`
      + `<image href="${esc(model.logo)}" x="${lcx - inner}" y="${num(lcy - inner)}" width="${inner * 2}" height="${inner * 2}" preserveAspectRatio="xMidYMid meet" clip-path="url(#info-logo-clip)"/></g>`
  }
  const markup = `<defs><clipPath id="header-clip"><rect width="${IMAGE_WIDTH}" height="${num(height)}"/></clipPath>${glow}${capGradient}</defs>`
    + `<rect width="${IMAGE_WIDTH}" height="${num(height)}" fill="${HEADER_BG}"/>`
    + `<g clip-path="url(#header-clip)" aria-hidden="true">${decor}${wave(270, WAVE_BACK, 1)}${wave(170, WAVE_FRONT, 0.66)}<g fill="#ffffff" fill-opacity="0.5">${dots.join('')}</g></g>`
    // แถบทองบางใต้แถบหัว (แบบภาพข่าว)
    + `<rect y="${num(height - 6)}" width="${IMAGE_WIDTH}" height="6" fill="${GOLD}" data-gold-band="header"/>`
    // ตัวอักษรในแคปซูลอยู่ท้าย texts — ต้องวาดหลังพื้นแคปซูล
    + logo + rules.join('') + capsule + texts.join('')
  return { markup, height }
}

/**
 * @param {ReturnType<typeof buildInfographicModel>} model
 * @param {(text: string, size: number, bold: boolean) => number} measure วัดความกว้างข้อความ (px) ด้วยชุดฟอนต์ FONT_STACK
 * @returns {{ svg: string, width: number, height: number }}
 */
export function buildInfographicSvg(model, measure) {
  const parts = []
  const text = (x, y, value, { size = 28, bold = false, fill = INK, anchor = 'start' } = {}) => {
    parts.push(`<text x="${num(x)}" y="${num(y)}" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`)
  }
  // หลายบรรทัด: คืนค่า y ของ "บรรทัดถัดไป" (baseline ถัดจากบรรทัดสุดท้าย) เพื่อวางของถัดไปต่อ
  const block = (x, y, value, maxWidth, options = {}) => {
    const size = options.size ?? 28
    const step = Math.round(size * 1.4)
    let cursor = y
    for (const line of wrapLines(value, maxWidth, size, !!options.bold, measure)) {
      text(x, cursor, line, options)
      cursor += step
    }
    return cursor
  }
  const rect = (x, y, width, height, fill, radius = 0) => {
    parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="${radius}" fill="${fill}"/>`)
  }
  // หัวข้อส่วน: แถบสีเขียวไล่เฉดแนวตั้งนำหน้า + ตัวหนา
  const defs = []
  defs.push(`<linearGradient id="info-accent" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="${HEADER_BG}"/></linearGradient>`)
  const heading = (y, value) => {
    parts.push(`<rect x="${MARGIN}" y="${num(y - 31)}" width="8" height="38" rx="4" fill="url(#info-accent)"/>`)
    text(MARGIN + 22, y, value, { size: 36, bold: true })
  }

  // ── หัวภาพ ──
  const header = headerBand(model, measure)
  parts.push(header.markup)
  const headerHeight = header.height

  // ── ส่วนที่ 1: สัดส่วนตามหมวด (ในการ์ดขาวเงานุ่ม — ขนาดการ์ดรู้หลังวาดเนื้อหา จึงจองช่องไว้ก่อน) ──
  const card1Top = headerHeight + 30
  const card1Slot = parts.push('') - 1
  let y = card1Top + 64
  heading(y, 'สัดส่วนเรื่องร้องเรียน จำแนกตามหมวด')
  y += 32
  const R = 172
  const r = 106
  if (model.total === 0) {
    const cy = y + R + 10
    parts.push(`<circle cx="${MARGIN + 200}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="#e2e8f0" stroke-width="${R - r}"/>`)
    text(MARGIN + 200, cy + 12, '0', { size: 80, bold: true, anchor: 'middle' })
    text(MARGIN + 200, cy + 54, 'เรื่อง', { size: 28, fill: MUTED, anchor: 'middle' })
    y = block(MARGIN + 440, cy - 8, `ไม่มีเรื่องร้องเรียนที่รับผ่านระบบใน${model.periodThisOne}`, CONTENT_W - 440, { size: 32, bold: true, fill: MUTED })
    y = Math.max(y, cy + R) + 56
  } else if (!model.categoriesComplete) {
    y = block(MARGIN, y + 36, 'ไม่แสดงสัดส่วนตามหมวด เพราะจำนวนเรื่องมากเกินกว่าที่ดึงมาคำนวณได้ในครั้งเดียว', CONTENT_W, { size: 30, fill: MUTED }) + 20
  } else {
    const legendX = MARGIN + 392
    const iconBox = 52
    const textX = legendX + iconBox + 20
    const textW = IMAGE_WIDTH - MARGIN - textX
    const rows = model.slices.map(slice => {
      const labelLines = wrapLines(slice.label, textW, 30, true, measure)
      // รายการย่อย (ลักษณะปัญหา) เยื้องเข้าไปใต้บรรทัดยอดของหมวด — ตัดบรรทัดเองเพราะชื่อยาวได้
      const subLines = slice.subItems.map(item => wrapLines(`${item.label} ${formatCount(item.count)} เรื่อง`, textW - SUB_INDENT, 25, false, measure))
      const subHeight = subLines.reduce((sum, lines) => sum + lines.length * SUB_STEP, 0)
      const height = Math.max(iconBox, labelLines.length * 40 + 32 + (subHeight ? subHeight + 4 : 0)) + 18
      return { slice, labelLines, subLines, height }
    })
    const legendHeight = rows.reduce((sum, row) => sum + row.height, 0) - 18
    const contentHeight = Math.max(R * 2, legendHeight)
    const cx = MARGIN + R
    const cy = y + contentHeight / 2
    // เงานุ่มใต้วงแหวน + แกนกลางไล่สีขาว→เทาอ่อน (ให้วงกลมดูนูน)
    defs.push(`<radialGradient id="info-donut-core" cx="0.5" cy="0.4" r="0.6"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef2f6"/></radialGradient>`)
    parts.push(`<circle cx="${num(cx)}" cy="${num(cy + 8)}" r="${(R + r) / 2}" fill="none" stroke="${SHADOW}" stroke-opacity="0.07" stroke-width="${R - r + 6}"/>`)
    for (const { slice } of rows) {
      if (slice.count <= 0) continue
      parts.push(`<path d="${donutSlicePath(cx, cy, R, r, slice.start, slice.end)}" fill="${slice.color}" fill-rule="evenodd" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>`)
    }
    parts.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${r - 8}" fill="url(#info-donut-core)"/>`)
    text(cx, cy - 56, model.partial ? 'รวม' : 'รวมทั้งสิ้น', { size: 28, fill: MUTED, anchor: 'middle' })
    text(cx, cy + 32, formatCount(model.total), { size: 84, bold: true, anchor: 'middle' })
    text(cx, cy + 80, 'เรื่อง', { size: 28, fill: MUTED, anchor: 'middle' })
    let rowY = y + (contentHeight - legendHeight) / 2
    for (const { slice, labelLines, subLines, height } of rows) {
      rect(legendX, rowY, iconBox, iconBox, slice.color, 14)
      parts.push(iconSvg(iconNodeForCategory(slice.code), legendX + 10, rowY + 10, 32))
      let lineY = rowY + 24
      for (const line of labelLines) { text(textX, lineY, line, { size: 30, bold: true }); lineY += 40 }
      text(textX, lineY - 8, `${formatCount(slice.count)} เรื่อง · ร้อยละ ${formatPercent(slice.percent)}`, { size: 27, fill: MUTED })
      let subY = lineY - 8 + SUB_STEP
      for (const lines of subLines) {
        // จุดนำหน้าเฉพาะบรรทัดแรกของแต่ละรายการ บรรทัดต่อเยื้องเท่ากัน
        parts.push(`<circle cx="${textX + 7}" cy="${subY - 8}" r="3.5" fill="${slice.color}"/>`)
        for (const line of lines) { text(textX + SUB_INDENT, subY, line, { size: 25, fill: INK }); subY += SUB_STEP }
      }
      rowY += height
    }
    y += contentHeight + 44
  }

  // ปิดการ์ดส่วนที่ 1 — ทุกแบบ (ไม่มีเรื่อง/ไม่ครบ/ปกติ) จบด้วยระยะเว้นของตัวเองอยู่แล้ว ขอบล่างการ์ดอยู่ใต้เนื้อหา ~28px
  const card1Bottom = y - 16
  parts[card1Slot] = softCard(CARD_X, card1Top, CARD_W, card1Bottom - card1Top, 28, '#ffffff', ' data-card="categories"')
  y = card1Bottom + 76

  // ── ส่วนที่ 2: ผลการดำเนินงาน — การ์ดไล่สี + ไอคอนในวงกลม + แถบความคืบหน้าตามร้อยละ ──
  heading(y, 'ผลการดำเนินงาน')
  y += 30
  const cardW = (CONTENT_W - 24) / 2
  const cardH = 244
  for (const [index, card] of [
    { key: 'resolved', label: 'ดำเนินการแล้วเสร็จ', data: model.resolved, palette: PANEL.resolved, icon: checkIcon },
    { key: 'ongoing', label: 'อยู่ระหว่างดำเนินการ', data: model.ongoing, palette: PANEL.ongoing, icon: clockIcon },
  ].entries()) {
    const x = MARGIN + index * (cardW + 24)
    const percent = model.total ? card.data.percent : 0
    defs.push(`<linearGradient id="info-kpi-${card.key}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${card.palette.from}"/><stop offset="1" stop-color="${card.palette.to}"/></linearGradient>`)
    parts.push(softCard(x, y, cardW, cardH, 24, `url(#info-kpi-${card.key})`, ` data-kpi="${card.key}"`))
    const badgeR = 30
    const badgeX = x + cardW - 26 - badgeR
    const badgeY = y + 26 + badgeR
    parts.push(`<g data-kpi-icon="1"><circle cx="${num(badgeX)}" cy="${num(badgeY + 3)}" r="${badgeR}" fill="${SHADOW}" fill-opacity="0.12"/>`
      + `<circle cx="${num(badgeX)}" cy="${num(badgeY)}" r="${badgeR}" fill="${card.palette.fg}"/>`
      + iconSvg(card.icon, badgeX - 17, badgeY - 17, 34) + '</g>')
    text(x + 28, y + 52, card.label, { size: 30, bold: true, fill: card.palette.fg })
    text(x + 28, y + 136, `${formatPercent(percent)}%`, { size: 80, bold: true, fill: card.palette.fg })
    text(x + 28, y + 188, `${formatCount(card.data.count)} เรื่อง`, { size: 30, fill: card.palette.fg })
    const barW = cardW - 56
    parts.push(`<rect x="${num(x + 28)}" y="${num(y + 210)}" width="${num(barW)}" height="12" rx="6" fill="#ffffff" fill-opacity="0.75"/>`)
    if (percent > 0) parts.push(`<rect x="${num(x + 28)}" y="${num(y + 210)}" width="${num(Math.max(12, barW * Math.min(percent, 100) / 100))}" height="12" rx="6" fill="${card.palette.fg}" data-kpi-bar="${card.key}"/>`)
  }
  y += cardH
  // ภาพนี้ "ไม่แสดงระยะเวลาเฉลี่ย" โดยเจตนา (เจ้าของระบบสั่ง 2569-10-19 หลังเห็น "8.9 วัน" ของน้ำเลา: ภาพที่ลงกลุ่มชาวบ้าน
  // เห็นแค่ตัวเลขเดียวแล้วถูกตีความเป็น "ช้า" โดยไม่เห็นบริบท) ค่านี้ยังอยู่ในหน้ารายงานและใบ A4 ที่มีคำอธิบายครบ
  // เทสต์ล็อกไว้ว่าภาพไม่มีข้อความนี้ ถ้าจะนำกลับมาต้องให้เจ้าของระบบสั่งใหม่
  // เรื่องที่ขึ้นทะเบียนรอดำเนินการไม่อยู่ในสองช่องบน (ไม่ใช่งานค้างและไม่ใช่เสร็จ) — บอกในบรรทัดเดียวให้ตัวเลขครบยอดรวม
  if (model.parked.count > 0) {
    y += 44
    text(MARGIN, y, `ขึ้นทะเบียนรอดำเนินการ ${formatCount(model.parked.count)} เรื่อง (ร้อยละ ${formatPercent(model.parked.percent)})`, { size: 28, fill: MUTED })
  }
  if (model.rejected.count > 0) {
    y += 44
    text(MARGIN, y, `ไม่รับเรื่อง/ยกเลิก ${formatCount(model.rejected.count)} เรื่อง (ร้อยละ ${formatPercent(model.rejected.percent)})`, { size: 28, fill: MUTED })
  }

  // ── อันดับพื้นที่ / ประเภทเรื่อง (เจ้าของสั่ง 2569-11-17 ตามภาพอ้างอิง TOP 10 · แทนที่กล่อง QR ที่เอาออกจากภาพ) ──
  // การ์ดขาวเงานุ่ม หัวการ์ดแถบเขียวไล่เฉด + ไอคอน · อันดับในวงกลมสีเหรียญ (ทอง/เงิน/ทองแดง แล้วเขียว) · แถบยาวตามสัดส่วนอันดับ 1
  // มีสองการ์ด = แบ่งครึ่ง · มีการ์ดเดียว (เช่น ยังไม่ได้รัน SQL พื้นที่) = เต็มความกว้าง
  const rankCards = [
    model.areaRanking && { key: 'area', title: 'พื้นที่ที่ร้องเรียนมากที่สุด', icon: mapPinIcon, items: model.areaRanking },
    model.typeRanking && { key: 'type', title: 'ประเภทที่ร้องเรียนมากที่สุด', icon: listIcon, items: model.typeRanking },
  ].filter(Boolean)
  if (rankCards.length) {
    y += 48
    const gapX = 24
    const cardW = rankCards.length === 2 ? (CONTENT_W - gapX) / 2 : CONTENT_W
    const PAD = 24
    const HEAD_H = 62
    const BADGE_R = 19
    const LABEL = 26
    const GROUP = 21
    const ROW_GAP = 16
    defs.push(`<linearGradient id="info-rank-head" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${HEADER_BG}"/><stop offset="1" stop-color="#15803d"/></linearGradient>`)
    // จัดวางทุกการ์ดก่อน (ตัดบรรทัดชื่อ) แล้วใช้ความสูงของการ์ดที่สูงสุด ให้สองการ์ดสูงเท่ากัน
    const laid = rankCards.map(card => {
      const max = Math.max(...card.items.map(item => item.count))
      const rows = card.items.map(item => {
        const countText = `${formatCount(item.count)} เรื่อง`
        const countW = measure(countText, 24, true)
        const labelW = cardW - PAD * 2 - BADGE_R * 2 - 14 - countW - 16
        const labelLines = wrapLines(item.label, labelW, LABEL, true, measure)
        const groupLines = item.group ? wrapLines(item.group, labelW, GROUP, false, measure) : []
        const textH = labelLines.length * Math.round(LABEL * 1.3) + groupLines.length * Math.round(GROUP * 1.3)
        return { item, countText, labelLines, groupLines, height: Math.max(BADGE_R * 2, textH) + 14, ratio: max > 0 ? item.count / max : 0 }
      })
      const bodyH = rows.reduce((sum, row) => sum + row.height, 0) + (rows.length - 1) * ROW_GAP
      return { card, rows, bodyH }
    })
    const cardH = HEAD_H + PAD + Math.max(...laid.map(entry => entry.bodyH)) + PAD
    const MEDAL = ['#d4a017', '#94a3b8', '#b7703a']
    for (const [index, { card, rows }] of laid.entries()) {
      const x = MARGIN + index * (cardW + gapX)
      parts.push(softCard(x, y, cardW, cardH, 24, '#ffffff', ` data-rank="${card.key}"`))
      // หัวการ์ด: มุมบนมนตามการ์ด มุมล่างเหลี่ยม (สี่เหลี่ยมมนทับด้วยสี่เหลี่ยมเหลี่ยมครึ่งล่าง)
      defs.push(`<clipPath id="info-rank-clip-${card.key}"><rect x="${num(x)}" y="${num(y)}" width="${num(cardW)}" height="${cardH}" rx="24"/></clipPath>`)
      parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(cardW)}" height="${HEAD_H}" fill="url(#info-rank-head)" clip-path="url(#info-rank-clip-${card.key})"/>`
        + `<rect x="${num(x)}" y="${num(y + HEAD_H - 4)}" width="${num(cardW)}" height="4" fill="${GOLD}"/>`)
      parts.push(iconSvg(card.icon, x + PAD, y + (HEAD_H - 4 - 30) / 2, 30).replace('stroke="#ffffff"', `stroke="${GOLD_LIGHT}"`))
      text(x + PAD + 30 + 12, y + HEAD_H / 2 + 9, card.title, { size: 27, bold: true, fill: '#ffffff' })
      let rowY = y + HEAD_H + PAD
      for (const [rank, row] of rows.entries()) {
        const badgeCx = x + PAD + BADGE_R
        const badgeCy = rowY + BADGE_R
        const medal = MEDAL[rank] ?? '#15803d'
        parts.push(`<circle cx="${num(badgeCx)}" cy="${num(badgeCy + 2)}" r="${BADGE_R}" fill="${SHADOW}" fill-opacity="0.12"/>`
          + `<circle cx="${num(badgeCx)}" cy="${num(badgeCy)}" r="${BADGE_R}" fill="${medal}" stroke="#ffffff" stroke-width="2"/>`)
        text(badgeCx, badgeCy + 8, String(rank + 1), { size: 22, bold: true, fill: '#ffffff', anchor: 'middle' })
        const labelX = x + PAD + BADGE_R * 2 + 14
        let lineY = rowY + Math.round(LABEL * 0.98)
        for (const line of row.labelLines) { text(labelX, lineY, line, { size: LABEL, bold: true }); lineY += Math.round(LABEL * 1.3) }
        for (const line of row.groupLines) { text(labelX, lineY - 4, line, { size: GROUP, fill: MUTED }); lineY += Math.round(GROUP * 1.3) }
        text(x + cardW - PAD, rowY + Math.round(LABEL * 0.98), row.countText, { size: 24, bold: true, fill: HEADER_BG, anchor: 'end' })
        // แถบสัดส่วนเทียบอันดับ 1 ใต้แถว (ราง + แถบสีเหรียญ)
        const barY = rowY + row.height - 6
        const barW = cardW - PAD - (labelX - x)
        parts.push(`<rect x="${num(labelX)}" y="${num(barY)}" width="${num(barW)}" height="6" rx="3" fill="#e2e8f0"/>`
          + `<rect x="${num(labelX)}" y="${num(barY)}" width="${num(Math.max(6, barW * row.ratio))}" height="6" rx="3" fill="${medal}"/>`)
        rowY += row.height + ROW_GAP
      }
    }
    y += cardH
  }

  // ── ชวนแจ้งเรื่อง ──
  // ภาพที่ถูกแชร์ลง LINE/Facebook หรือพิมพ์ติดบอร์ดหมู่บ้านคือช่องทางที่ถึงชาวบ้านจริง — อ่านจบแล้วต้องรู้ว่าแจ้งที่ไหน
  // สร้าง QR ไม่ได้ (ลิงก์ผิดรูป) ก็ยังมีกล่องนี้ แต่เหลือเฉพาะลิงก์เป็นตัวอักษร ภาพไม่ล้ม
  if (model.reportUrl) {
    y += 48
    const PAD = 28
    const qr = qrLayout(model.reportUrl, 232)
    const textX = MARGIN + PAD + (qr ? qr.side + 32 : 0)
    const textW = IMAGE_WIDTH - MARGIN - PAD - textX
    const slots = [
      { size: 36, bold: true, fill: INK, lines: wrapLines('แจ้งเรื่อง · ติดตามเรื่องของท่าน', textW, 36, true, measure) },
      { size: 28, bold: false, fill: MUTED, lines: wrapLines(qr ? 'สแกน QR หรือเข้าที่' : 'เข้าที่', textW, 28, false, measure) },
      { size: 30, bold: true, fill: INK, lines: wrapLines(model.reportUrl.replace(/^https?:\/\//i, ''), textW, 30, true, measure) },
    ]
    const stepOf = slot => Math.round(slot.size * 1.4)
    const textHeight = slots.reduce((sum, slot) => sum + slot.lines.length * stepOf(slot), 0)
    const boxH = Math.max(qr ? qr.side : 0, textHeight) + PAD * 2
    // การ์ดไล่สีเขียวอ่อน→ฟ้าอ่อน ขอบเขียวจาง (เข้าชุดกับแถบหัว/ท้าย)
    defs.push(`<linearGradient id="info-qr-card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0fdf4"/><stop offset="1" stop-color="#ecfeff"/></linearGradient>`)
    parts.push(softCard(MARGIN, y, CONTENT_W, boxH, 24, 'url(#info-qr-card)', ' stroke="#bbf7d0" stroke-width="2" data-card="report"'))
    if (qr) {
      // พื้นขาวของ QR (รวมขอบสงบ) วางบนกล่องสีฟ้าอ่อน — QR ต้องดำบนขาวเสมอ ห้ามให้สีกล่องมาเป็นพื้นของ QR
      parts.push(`<g transform="translate(${MARGIN + PAD} ${num(y + (boxH - qr.side) / 2)})"><rect width="${qr.side}" height="${qr.side}" fill="#ffffff"/><path transform="translate(${QUIET_MODULES * qr.module} ${QUIET_MODULES * qr.module}) scale(${qr.module})" d="${qr.d}" fill="#000000" shape-rendering="crispEdges"/></g>`)
    }
    let lineTop = y + (boxH - textHeight) / 2
    for (const slot of slots) {
      for (const line of slot.lines) {
        text(textX, lineTop + Math.round(slot.size * 1.05), line, { size: slot.size, bold: slot.bold, fill: slot.fill })
        lineTop += stepOf(slot)
      }
    }
    y += boxH
  }

  // ── แถบท้าย: เขียวเข้มชุดเดียวกับแถบหัว · หมายเหตุ/แหล่งข้อมูล/วันที่ข้อมูลซ้าย + คำ "Smart City Local" ขวา
  // (เจ้าของสั่ง 2569-11-17: คำขวัญขึ้นไปอยู่ใต้ชื่อ อปท. แล้วเอาหมายเหตุมาไว้แทน ข้อความเยอะให้ย่อตัวอักษร)
  // ขึ้นทุกภาพไม่ว่าจะเปิด QR หรือไม่ · ภาพเนื้อหาสั้นให้แถบชิดก้นภาพ (ไม่ลอยกลางพื้น)
  const noteTexts = [...model.notes, `ข้อมูล ณ วันที่ ${model.asOf}`]
  // กันที่ขวาไว้ ~330px ให้เครื่องหมายย่อได้ราว 0.6 ขึ้นไป
  const noteW = CONTENT_W - 330
  const notePad = 34
  const layoutAt = size => {
    const step = Math.round(size * 1.38)
    const blocks = noteTexts.map(note => wrapLines(note, noteW, size, false, measure))
    const height = blocks.reduce((sum, lines) => sum + lines.length * step, 0) + (blocks.length - 1) * 6
    return { size, step, blocks, height }
  }
  // ตัวใหญ่สุดที่พอดีแถบสูงขั้นต่ำ · ย่อถึง 18 แล้วยังไม่พอ = ใช้ 18 แล้วให้แถบสูงขึ้นตามข้อความ
  const noteRoom = FOOTER_BAND_H - notePad * 2
  const notes = FOOT_NOTE_SIZES.map(layoutAt).find(layout => layout.height <= noteRoom) ?? layoutAt(FOOT_NOTE_SIZES.at(-1))
  const bandH = Math.max(FOOTER_BAND_H, notes.height + notePad * 2)
  const bandTop = Math.max(y + 48, IMAGE_MIN_HEIGHT - bandH)
  const height = Math.ceil(bandTop + bandH)
  defs.push(`<linearGradient id="info-page-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f3ec"/><stop offset="1" stop-color="#f7fbf8"/></linearGradient>`)
  {
    const glowCx = IMAGE_WIDTH - MARGIN - 165
    const glowCy = bandTop + bandH / 2
    // พื้นเขียวเข้ม + แสงฟุ้งหลังคำ Smart City Local + วงกลมจางมุมซ้ายล่าง + แถบทองบน (กลับด้านกับแถบหัว)
    // มุมขวาล่างยังเป็นสีพื้นล้วน (เทสต์อ่านพิกเซลตรงนั้น)
    defs.push(`<clipPath id="info-foot-clip"><rect y="${num(bandTop)}" width="${IMAGE_WIDTH}" height="${num(bandH)}"/></clipPath>`
      + `<radialGradient id="info-foot-glow" gradientUnits="userSpaceOnUse" cx="${glowCx}" cy="${num(glowCy)}" r="190"><stop offset="0" stop-color="#4ade80" stop-opacity="0.35"/><stop offset="1" stop-color="#4ade80" stop-opacity="0"/></radialGradient>`)
    parts.push(`<rect y="${num(bandTop)}" width="${IMAGE_WIDTH}" height="${num(bandH)}" fill="${HEADER_BG}" data-footer-band="1"/>`
      + `<g clip-path="url(#info-foot-clip)" aria-hidden="true">`
      + `<circle cx="${glowCx}" cy="${num(glowCy)}" r="190" fill="url(#info-foot-glow)"/>`
      + `<circle cx="${IMAGE_WIDTH * 0.12}" cy="${num(bandTop + bandH * 1.25)}" r="${IMAGE_WIDTH * 0.2}" fill="#ffffff" fill-opacity="0.06"/></g>`
      + `<rect y="${num(bandTop)}" width="${IMAGE_WIDTH}" height="6" fill="${GOLD}" data-gold-band="footer"/>`)
    // หมายเหตุจัดกึ่งกลางแนวตั้งในแถบ · แต่ละข้อขึ้นบรรทัดใหม่ เว้น 6px ระหว่างข้อ
    let lineTop = bandTop + 3 + (bandH - notes.height) / 2
    for (const lines of notes.blocks) {
      for (const line of lines) {
        text(MARGIN, lineTop + Math.round(notes.size * 1.02), line, { size: notes.size, fill: FOOT_NOTE_COLOR })
        lineTop += notes.step
      }
      lineTop += 6
    }
    const markX = MARGIN + noteW + 24
    const markH = Math.min(bandH - 30, 200)
    const mark = smartCityMarkSvg(defs, markX, glowCy - markH / 2, IMAGE_WIDTH - 40 - markX, markH, measure)
    if (mark) parts.push(mark)
  }

  // พื้นขาวเต็มภาพเป็นองค์ประกอบแรกสุด — PNG ที่ไม่มีพื้นจะโปร่งใส แล้วตัวอักษรสีเข้มกลายเป็นดำบนดำในแอปโหมดมืด
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}" font-family="${FONT_STACK}" role="img" aria-label="${esc(`สรุปเรื่องร้องเรียน ${model.monthLabel} ${model.tenantName} ${model.partial ? 'จำนวน' : 'รวม'} ${model.total} เรื่อง`)}"><title>${esc(`${model.title} ${model.monthLabel}`)}</title>${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<rect width="${IMAGE_WIDTH}" height="${height}" fill="#ffffff"/><rect width="${IMAGE_WIDTH}" height="${height}" fill="url(#info-page-bg)" data-backdrop="1"/>${parts.join('')}</svg>`
  return { svg, width: IMAGE_WIDTH, height }
}

/**
 * ตัววัดข้อความด้วย canvas ชุดฟอนต์เดียวกับภาพ — ใช้ในเบราว์เซอร์เท่านั้น
 * @param {string} [fontStack] ต้องตรงกับ font-family ของ SVG ที่จะวาด (ภาพข่าวส่งชุดที่มี Kanit นำหน้า — newsFont.js)
 */
export function createCanvasMeasure(fontStack = FONT_STACK) {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  return (value, size, bold) => {
    context.font = `${bold ? 700 : 400} ${size}px ${fontStack}`
    return context.measureText(value).width
  }
}

/**
 * แปลงโลโก้ (data URL ชนิดใดก็ได้ที่เบราว์เซอร์ถอดได้ รวม SVG) เป็น PNG ขนาดไม่เกิน 360px — เบราว์เซอร์เท่านั้น
 * ฝังในภาพเป็น PNG เสมอ: ไฟล์เล็ก ไม่มีสคริปต์ และผ่าน logoDataUrlOk · ถอดไม่ได้ = null (ภาพออกได้ แค่ไม่มีโลโก้)
 */
export async function prepareLogoDataUrl(dataUrl) {
  try {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl })
    const w = image.naturalWidth || 360
    const h = image.naturalHeight || 360
    const scale = Math.min(1, 360 / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const out = canvas.toDataURL('image/png')
    return logoDataUrlOk(out) ? out : null
  } catch {
    return null
  }
}

export const svgDataUrl = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** แปลงสตริง SVG เป็นไฟล์ PNG — เบราว์เซอร์เท่านั้น */
export async function svgToPngFile(svg, width, height, fileName) {
  const image = new Image()
  image.decoding = 'async'
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = () => reject(new Error('Cannot load SVG'))
    image.src = svgDataUrl(svg)
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.drawImage(image, 0, 0, width, height)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Cannot create PNG')
  return new File([blob], fileName, { type: 'image/png' })
}
