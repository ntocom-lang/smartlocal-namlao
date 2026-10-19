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

import { iconNodeForCategory } from './complaintCategoryIcons.js'
import { formatCount, formatDecimal, formatPercent } from './complaintMonthlySummary.js'
import { QUIET_MODULES, qrLayout } from './qrSvg.js'

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
const PANEL = { resolved: { bg: '#e7f7ef', fg: '#047857' }, ongoing: { bg: '#fff5df', fg: '#92400e' } }

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
 * @param {{ tenantName?: string, reportUrl?: string }} [options]
 *   reportUrl: ลิงก์หน้าแจ้งเรื่องของ อปท. (เต็ม มี https://) — ใส่แล้วท้ายภาพมี QR + ข้อความชวนแจ้งเรื่อง ไม่ใส่ = ไม่มีกล่องนี้
 */
export function buildInfographicModel(summary, { tenantName = '', reportUrl = '' } = {}) {
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
    monthLabel: `เดือน${summary.period.label}`,
    monthKey: summary.period.key,
    tenantName: tenantName || 'หน่วยงาน',
    total,
    slices,
    categoriesComplete: summary.categoriesComplete,
    resolved: { count: summary.resolved, percent: summary.resolvedPercent },
    ongoing: { count: summary.ongoing, percent: summary.ongoingPercent },
    rejected: { count: summary.rejected, percent: summary.rejectedPercent },
    // วันเฉลี่ยจากแจ้งถึงเสร็จ (วันตามปฏิทิน นับเฉพาะเรื่องที่เสร็จ) — null เมื่อยังไม่มีเรื่องไหนเสร็จ ต้องไม่กลายเป็น "0 วัน"
    avgDays: summary.avgDays == null || !Number.isFinite(Number(summary.avgDays)) ? null : Number(summary.avgDays),
    reportUrl: String(reportUrl ?? '').trim(),
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

function iconSvg(node, x, y, size) {
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

/**
 * แถบหัวภาพ: คลื่นมุมซ้ายบน + จุดไข่ปลามุมขวาบน ชื่อเรื่อง (ขาว) กับเดือน (เหลือง) บรรทัดเดียวกันกลางภาพ
 * ใต้ลงมาเป็นชื่อ อปท. มีเส้นขีดสองข้าง — คลื่น/จุดเป็นรูปทรงที่เราวาดเอง (ไม่ใช่งานศิลป์ของ อปท. ใด)
 *
 * ชื่อเรื่อง+เดือนยาวเกินความกว้าง (เดือนยาวๆ เช่น กุมภาพันธ์ + ปี) ลดขนาดตัวอักษรลงจนพอดีบรรทัดเดียว (ต่ำสุด 42)
 * ยังไม่พอก็แยกเป็น 2 บรรทัด — ข้อความทุกชิ้นวัดด้วยตัววัดชุดเดียวกับที่ใช้ตัดบรรทัด จึงไม่ล้นขอบ
 * ชื่อ อปท. ยาวหลายบรรทัดได้ (เส้นขีดสองข้างวาดเฉพาะเมื่อชื่ออยู่บรรทัดเดียวและมีที่พอ)
 */
function headerBand(model, measure) {
  const cx = IMAGE_WIDTH / 2
  const gap = 20
  const titleWidth = size => measure(model.title, size, true)
  const monthWidth = size => measure(model.monthLabel, size, true)
  const oneLineWidth = size => titleWidth(size) + gap + monthWidth(size)
  // กว้างสุดของบรรทัดเดียว: เหลือที่ว่างสองข้าง 130px ให้คลื่น/จุดไข่ปลาไม่ทับตัวอักษร (ชื่อเรื่องแบบยะลากินราว 2 ใน 3 ของแถบ)
  const maxLine = IMAGE_WIDTH - 130 * 2
  let size = 58
  while (size > 42 && oneLineWidth(size) > maxLine) size -= 2
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

  const tenantLines = wrapLines(model.tenantName, CONTENT_W, 32, true, measure)
  baseline += 64
  const rules = []
  for (const [index, line] of tenantLines.entries()) {
    addText(cx, baseline, line, { size: 32, fill: '#ffffff', anchor: 'middle' })
    if (tenantLines.length === 1) {
      const half = measure(line, 32, true) / 2
      const length = Math.min(120, cx - half - 20 - MARGIN)
      if (length >= 30) {
        const lineY = baseline - 11
        for (const [from, to] of [[cx - half - 20 - length, cx - half - 20], [cx + half + 20, cx + half + 20 + length]]) {
          rules.push(`<rect x="${num(from)}" y="${num(lineY)}" width="${num(to - from)}" height="2" fill="#ffffff" fill-opacity="0.85"/>`)
        }
      }
    }
    if (index < tenantLines.length - 1) baseline += Math.round(32 * 1.4)
  }
  const height = baseline + 38

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
  const markup = `<defs><clipPath id="header-clip"><rect width="${IMAGE_WIDTH}" height="${num(height)}"/></clipPath></defs>`
    + `<rect width="${IMAGE_WIDTH}" height="${num(height)}" fill="${HEADER_BG}"/>`
    + `<g clip-path="url(#header-clip)" aria-hidden="true">${wave(270, WAVE_BACK, 1)}${wave(170, WAVE_FRONT, 0.66)}<g fill="#ffffff" fill-opacity="0.5">${dots.join('')}</g></g>`
    + rules.join('') + texts.join('')
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

  // ── หัวภาพ ──
  const header = headerBand(model, measure)
  parts.push(header.markup)
  const headerHeight = header.height

  let y = headerHeight + 56

  // ── ส่วนที่ 1: สัดส่วนตามหมวด ──
  text(MARGIN, y, 'สัดส่วนเรื่องร้องเรียน จำแนกตามหมวด', { size: 36, bold: true })
  y += 32
  const R = 172
  const r = 106
  if (model.total === 0) {
    const cy = y + R + 10
    parts.push(`<circle cx="${MARGIN + 200}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="#e2e8f0" stroke-width="${R - r}"/>`)
    text(MARGIN + 200, cy + 12, '0', { size: 80, bold: true, anchor: 'middle' })
    text(MARGIN + 200, cy + 54, 'เรื่อง', { size: 28, fill: MUTED, anchor: 'middle' })
    y = block(MARGIN + 440, cy - 8, 'ไม่มีเรื่องร้องเรียนที่รับผ่านระบบในเดือนนี้', CONTENT_W - 440, { size: 32, bold: true, fill: MUTED })
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
    for (const { slice } of rows) {
      if (slice.count <= 0) continue
      parts.push(`<path d="${donutSlicePath(cx, cy, R, r, slice.start, slice.end)}" fill="${slice.color}" fill-rule="evenodd" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>`)
    }
    text(cx, cy - 56, 'รวมทั้งสิ้น', { size: 28, fill: MUTED, anchor: 'middle' })
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

  // ── ส่วนที่ 2: ผลการดำเนินงาน ──
  text(MARGIN, y, 'ผลการดำเนินงาน', { size: 36, bold: true })
  y += 28
  const cardW = (CONTENT_W - 24) / 2
  const cardH = 224
  for (const [index, card] of [
    { label: 'ดำเนินการแล้วเสร็จ', data: model.resolved, palette: PANEL.resolved },
    { label: 'อยู่ระหว่างดำเนินการ', data: model.ongoing, palette: PANEL.ongoing },
  ].entries()) {
    const x = MARGIN + index * (cardW + 24)
    rect(x, y, cardW, cardH, card.palette.bg, 24)
    text(x + 28, y + 52, card.label, { size: 30, bold: true, fill: card.palette.fg })
    text(x + 28, y + 132, `${formatPercent(model.total ? card.data.percent : 0)}%`, { size: 80, bold: true, fill: card.palette.fg })
    text(x + 28, y + 190, `${formatCount(card.data.count)} เรื่อง`, { size: 30, fill: card.palette.fg })
  }
  y += cardH
  if (model.avgDays !== null) {
    // สิ่งที่ชาวบ้านอยากรู้ที่สุดคือ "แจ้งแล้วนานไหม" ไม่ใช่ร้อยละ — คำกำกับ "นับเฉพาะเรื่องที่เสร็จแล้ว" ห้ามตัด
    // เพราะเรื่องที่ค้างนานไม่ถูกนับ ตัวเลขนี้จึงดูดีกว่าความจริงได้ (ใบ A4 เขียนกำกับไว้เหมือนกัน)
    y += 48
    const step = Math.round(28 * 1.4)
    y = block(MARGIN, y, `ใช้เวลาเฉลี่ยจากแจ้งเรื่องถึงดำเนินการแล้วเสร็จ ${formatDecimal(model.avgDays)} วัน (นับเฉพาะเรื่องที่เสร็จแล้ว)`, CONTENT_W, { size: 28, fill: INK }) - step
  }
  if (model.rejected.count > 0) {
    y += 44
    text(MARGIN, y, `ไม่รับเรื่อง/ยกเลิก ${formatCount(model.rejected.count)} เรื่อง (ร้อยละ ${formatPercent(model.rejected.percent)})`, { size: 28, fill: MUTED })
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
    rect(MARGIN, y, CONTENT_W, boxH, '#eef6fd', 24)
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

  // ── ท้ายภาพ ──
  y += 40
  rect(MARGIN, y, CONTENT_W, 2, '#dbe5ef')
  let noteY = y + 44
  for (const note of model.notes) {
    noteY = block(MARGIN, noteY, note, CONTENT_W, { size: 24, fill: MUTED }) + 6
  }
  noteY = block(MARGIN, noteY, `ข้อมูล ณ วันที่ ${model.asOf}`, CONTENT_W, { size: 24, fill: MUTED })

  const height = Math.max(IMAGE_MIN_HEIGHT, Math.ceil(noteY + 16))
  // พื้นขาวเต็มภาพเป็นองค์ประกอบแรกสุด — PNG ที่ไม่มีพื้นจะโปร่งใส แล้วตัวอักษรสีเข้มกลายเป็นดำบนดำในแอปโหมดมืด
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}" font-family="${FONT_STACK}" role="img" aria-label="${esc(`สรุปเรื่องร้องเรียน ${model.monthLabel} ${model.tenantName} รวม ${model.total} เรื่อง`)}"><title>${esc(`${model.title} ${model.monthLabel}`)}</title><rect width="${IMAGE_WIDTH}" height="${height}" fill="#ffffff"/>${parts.join('')}</svg>`
  return { svg, width: IMAGE_WIDTH, height }
}

/** ตัววัดข้อความด้วย canvas ชุดฟอนต์เดียวกับภาพ — ใช้ในเบราว์เซอร์เท่านั้น */
export function createCanvasMeasure() {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  return (value, size, bold) => {
    context.font = `${bold ? 700 : 400} ${size}px ${FONT_STACK}`
    return context.measureText(value).width
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
