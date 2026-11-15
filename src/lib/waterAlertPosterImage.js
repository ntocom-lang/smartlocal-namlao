// วาด "ภาพแชร์แจ้งเตือนน้ำ-ฝน" 1080×1350 ลง canvas → PNG (ข้อมูลมาจาก buildPosterModel ใน waterAlertPoster.js)
// เบราว์เซอร์เท่านั้น (ใช้ document/canvas/FontFace) — ส่วนตัดสินใจ/ประกอบข้อมูลอยู่ในไฟล์ที่ทดสอบด้วย node ได้
//
// ⚠️ Canvas 2D ล้วน: ห้ามวาด SVG ที่มี feTurbulence/feDisplacementMap/filter ลง canvas และห้ามใช้ ctx.filter
//    — Safari/iPhone วาดไม่เหมือน Chrome (ภาพข่าว #711 เคยพลาดเรื่องนี้) และเราไม่มี WebKit ให้ทดสอบ
//    ลายเมฆ/น้ำ/ฟองจึงใช้ gradient + path + สุ่มแบบ seed คงที่ (ผลซ้ำได้ ภาพเดิมได้ไฟล์เดิม)
// ⚠️ ตราจาก URL ต้องผ่าน fetchImageAsDataUrl (data URL) ก่อนวาด ไม่งั้น canvas ติด tainted แล้ว toBlob ล้ม
//    โหลดตราไม่ได้ = วาดต่อโดยไม่มีตรา ห้ามล้ม
// ⚠️ ข้อความไทยทุกก้อนวัดด้วย measureText แล้วตัดบรรทัด (wrapLines ใช้ Intl.Segmenter ถ้ามี) / ย่อขนาด / ตัดท้าย "…"
//    ไม่ให้ล้นกรอบ — ที่ย่อจนสุดแล้วยังล้นถูกบันทึกใน layout.issues (เทสต์ต้องว่าง)

import { fetchImageAsDataUrl } from './driveStorage.js'
import { FONT_STACK, wrapLines } from './complaintMonthlyInfographic.js'
import { NEWS_FONT_FAMILY, loadNewsFont } from './newsFont.js'
import { NEUTRAL_HEAD, POSTER_HEIGHT, POSTER_WIDTH, RAIN_SCALE_MAX, readableTextOn } from './waterAlertPoster.js'
import { RAIN_LEVELS, damLevel } from './waterSituation.js'

const W = POSTER_WIDTH
const H = POSTER_HEIGHT
const MARGIN = 44
const CONTENT_W = W - MARGIN * 2
const RED = '#e3121b'
const NAVY = '#0b2a6b'
const INK = '#0f2350'
const DIM = '#4a5f86'

/* ───────── ฟอนต์ ───────── */

// Kanit (ฝังในแอป ผ่าน newsFont.js) สำหรับหัวข้อ/ตัวเลข · Sarabun (แอปโหลดจาก index.html) สำหรับเนื้อความ
// ฟอนต์ไหนโหลดไม่ได้ก็ตกไปตัวถัดไปในชุด (ไม่พัง) — ต้องรอให้พร้อมก่อนวัด/วาด ไม่งั้นตัดบรรทัดด้วยฟอนต์ผิดตัว
export async function preparePosterFonts() {
  let kanit = null
  try { kanit = await loadNewsFont() } catch { /* โหลดไม่ได้ = ใช้ Sarabun/ฟอนต์ระบบ */ }
  try {
    if (typeof document !== 'undefined' && document.fonts?.load) {
      await Promise.all(['400', '500', '600', '700'].map(weight => document.fonts.load(`${weight} 20px Sarabun`, 'กขค ก้ำ 0123').catch(() => null)))
      await document.fonts.ready
    }
  } catch { /* ใช้ฟอนต์ระบบ */ }
  const display = `${kanit ? `'${NEWS_FONT_FAMILY}', ` : ''}'Kanit', 'Sarabun', ${FONT_STACK}`
  const body = `'Sarabun', ${FONT_STACK}`
  return { display, body, kanitLoaded: Boolean(kanit) }
}

/* ───────── ตัวช่วยวาด ───────── */

function makeRng(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

const rgba = (hex, alpha) => {
  const n = parseInt(String(hex).replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function rrPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0)
  ctx.lineTo(x + w, y + h - radius)
  ctx.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2)
  ctx.lineTo(x + radius, y + h)
  ctx.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI)
  ctx.lineTo(x, y + radius)
  ctx.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5)
  ctx.closePath()
}

function poly(ctx, points) {
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  stops.forEach(([o, c]) => g.addColorStop(o, c))
  return g
}

// แสงฟุ้งทรงรี (radial gradient ยืดด้วย transform) — ใช้แทน blur/filter ที่ Safari ไม่รองรับบน canvas
function glow(ctx, cx, cy, rx, ry, stops) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(rx, ry)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  stops.forEach(([o, c]) => g.addColorStop(o, c))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function hazardStripe(ctx, x, y, w, h, period = 48) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = '#ffc400'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#1d1d1d'
  const half = period / 2
  for (let sx = x - h - period; sx < x + w + h; sx += period) {
    poly(ctx, [[sx, y + h], [sx + half, y + h], [sx + half + h, y], [sx + h, y]])
    ctx.fill()
  }
  ctx.restore()
}

/* ───────── วัด/ตัดข้อความ ───────── */

function measurer(ctx, family) {
  return (text, size, bold) => {
    ctx.font = `${bold ? 700 : 400} ${size}px ${family}`
    return ctx.measureText(text).width
  }
}

function textWidth(ctx, text, weight, size, family) {
  ctx.font = `${weight} ${size}px ${family}`
  return ctx.measureText(text).width
}

// ตัดท้ายด้วย "…" ให้พอดี (ไม่ทิ้งสระหน้า เ แ โ ใ ไ ไว้ท้ายคำ)
function ellipsize(ctx, text, weight, size, family, maxW) {
  let t = String(text)
  if (textWidth(ctx, t, weight, size, family) <= maxW) return t
  while (t.length > 1 && textWidth(ctx, `${t}…`, weight, size, family) > maxW) t = t.slice(0, -1)
  return `${t.replace(/[เแโใไ\s]+$/u, '')}…`
}

// บรรทัดเดียว: ย่อขนาดทีละ 1px จนพอดี (ไม่ต่ำกว่า minSize) ยังล้น = ตัดท้าย "…" · บันทึกใน issues เมื่อยังล้นจริง
function fitOne(ctx, text, family, weight, maxW, size, minSize, issues, tag) {
  let s = size
  while (s > minSize && textWidth(ctx, text, weight, s, family) > maxW) s -= 1
  const t = ellipsize(ctx, text, weight, s, family, maxW)
  const width = textWidth(ctx, t, weight, s, family)
  if (width > maxW + 0.5) issues.push(`${tag}: ล้นกรอบ ${Math.round(width)} > ${Math.round(maxW)}`)
  return { text: t, size: s, width }
}

// ข้อความที่มีช่วงเน้น (runs: [{ t, em|b }]) → บรรทัดของ segment [{ text, em }]
function richLines(ctx, runs, family, maxW, sizeStart, sizeMin, maxLines, issues, tag) {
  let text = ''
  const flags = []
  for (const run of runs) {
    for (const ch of String(run.t)) {
      if (/\s/.test(ch)) { if (!text || text.endsWith(' ')) continue; text += ' '; flags.push(false); continue }
      text += ch
      flags.push(Boolean(run.em || run.b))
    }
  }
  text = text.trimEnd()
  const meas = measurer(ctx, family)
  let size = sizeStart
  let lines = wrapLines(text, maxW, size, true, meas)
  while (lines.length > maxLines && size > sizeMin) { size -= 1; lines = wrapLines(text, maxW, size, true, meas) }
  let truncated = false
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    truncated = true
  }
  let cursor = 0
  const out = lines.map((line, index) => {
    const isLast = index === lines.length - 1
    let base = line
    let ellipsis = false
    if (truncated && isLast) {
      base = ellipsize(ctx, line, 700, size, family, maxW)
      ellipsis = base.endsWith('…') && base !== line
      if (ellipsis) base = base.slice(0, -1)
    }
    const at = text.indexOf(base, cursor)
    const segs = []
    if (at < 0) segs.push({ text: base, em: false })
    else {
      cursor = at + base.length
      let cur = ''
      let curFlag = flags[at]
      for (let i = 0; i < base.length; i++) {
        const flag = flags[at + i]
        if (flag !== curFlag && cur) { segs.push({ text: cur, em: curFlag }); cur = '' }
        curFlag = flag
        cur += base[i]
      }
      if (cur) segs.push({ text: cur, em: curFlag })
    }
    if (ellipsis) segs.push({ text: '…', em: false })
    return segs
  })
  for (const segs of out) {
    const width = segs.reduce((sum, seg) => sum + textWidth(ctx, seg.text, 700, size, family), 0)
    if (width > maxW + 0.5) issues.push(`${tag}: บรรทัดล้นกรอบ ${Math.round(width)} > ${Math.round(maxW)}`)
  }
  return { size, lines: out, truncated }
}

function drawRich(ctx, lines, x, y, lineH, size, family, { color, emColor, weight = 600, emWeight = 700 }) {
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  lines.forEach((segs, i) => {
    let cx = x
    for (const seg of segs) {
      ctx.font = `${seg.em ? emWeight : weight} ${size}px ${family}`
      ctx.fillStyle = seg.em ? emColor : color
      ctx.fillText(seg.text, cx, y + i * lineH + lineH / 2)
      cx += ctx.measureText(seg.text).width
    }
  })
}

function drawText(ctx, text, x, cy, { font, color, align = 'left', shadow = null }) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  if (shadow) { ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur }
  ctx.fillText(text, x, cy)
  if (shadow) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0 }
}

/* ───────── ไอคอน (วาดด้วย path ในกรอบ 40×40) ───────── */

function drawIcon(ctx, kind, x, y, size, ink) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 40, size / 40)
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'pct') {
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(20, 20, 16, 0, Math.PI * 2); ctx.stroke()
    ctx.globalAlpha = 1
    ctx.lineWidth = 4
    ctx.beginPath(); ctx.arc(20, 20, 16, 0.3, Math.PI * 1.3); ctx.stroke()
    ctx.font = `700 13px sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('%', 20, 21)
  } else if (kind === 'vol') {
    ctx.beginPath()
    ctx.moveTo(20, 4)
    ctx.bezierCurveTo(26, 12, 31, 17, 31, 23)
    ctx.arc(20, 23, 11, 0, Math.PI, false)
    ctx.bezierCurveTo(9, 17, 14, 12, 20, 4)
    ctx.fill()
  } else if (kind === 'inn') {
    ctx.lineWidth = 3
    ctx.beginPath()
    ;[14, 24].forEach(yy => {
      ctx.moveTo(4, yy); ctx.quadraticCurveTo(12, yy - 6, 20, yy); ctx.quadraticCurveTo(28, yy + 6, 36, yy)
    })
    ctx.moveTo(20, 30); ctx.lineTo(20, 38)
    ctx.moveTo(15, 33); ctx.lineTo(20, 38); ctx.lineTo(25, 33)
    ctx.stroke()
  } else if (kind === 'out') {
    rrPath(ctx, 5, 6, 30, 16, 3); ctx.fill()
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(12, 26); ctx.lineTo(12, 34); ctx.moveTo(20, 26); ctx.lineTo(20, 36); ctx.moveTo(28, 26); ctx.lineTo(28, 34)
    ctx.stroke()
  } else if (kind === 'rain') {
    ctx.beginPath()
    ctx.arc(14, 16, 6.5, 0, Math.PI * 2)
    ctx.arc(22, 14, 8.5, 0, Math.PI * 2)
    ctx.arc(29.5, 19, 5.5, 0, Math.PI * 2)
    ctx.rect(11, 17, 19, 6)
    ctx.fill()
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(13, 27); ctx.lineTo(11, 33); ctx.moveTo(21, 27); ctx.lineTo(19, 33); ctx.moveTo(29, 27); ctx.lineTo(27, 33)
    ctx.stroke()
  }
  ctx.restore()
}

function drawSiren(ctx, x, y, size) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 100, size / 100)
  ctx.shadowColor = 'rgba(255,60,40,1)'
  ctx.shadowBlur = 26
  ctx.strokeStyle = '#ff2a2a'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(50, 6); ctx.lineTo(50, 16)
  ctx.moveTo(18, 18); ctx.lineTo(25, 25)
  ctx.moveTo(82, 18); ctx.lineTo(75, 25)
  ctx.moveTo(6, 48); ctx.lineTo(16, 48)
  ctx.moveTo(84, 48); ctx.lineTo(94, 48)
  ctx.stroke()
  ctx.fillStyle = '#ff2a2a'
  ctx.beginPath()
  ctx.moveTo(26, 74); ctx.lineTo(26, 52); ctx.arc(50, 52, 24, Math.PI, 0); ctx.lineTo(74, 74)
  ctx.closePath(); ctx.fill()
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.beginPath()
  ctx.moveTo(34, 70); ctx.lineTo(34, 54); ctx.arc(50, 54, 16, Math.PI, Math.PI * 1.5)
  ctx.stroke()
  ctx.fillStyle = '#1d2b4f'
  rrPath(ctx, 18, 74, 64, 14, 4); ctx.fill()
  ctx.restore()
}

function drawWarnTriangle(ctx, x, y, w, h) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(w / 100, h / 90)
  ctx.fillStyle = RED
  ctx.strokeStyle = '#1a0306'
  ctx.lineWidth = 5
  ctx.lineJoin = 'round'
  poly(ctx, [[50, 4], [96, 86], [4, 86]])
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#fff'
  rrPath(ctx, 45, 30, 10, 32, 4); ctx.fill()
  ctx.beginPath(); ctx.arc(50, 72, 6, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

function drawMegaphone(ctx, x, y, w, h) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(w / 120, h / 100)
  ctx.fillStyle = RED
  poly(ctx, [[14, 40], [32, 40], [84, 14], [84, 86], [32, 60], [14, 60]])
  ctx.fill()
  ctx.fillStyle = '#fff'
  rrPath(ctx, 8, 38, 12, 24, 4); ctx.fill()
  poly(ctx, [[34, 60], [42, 90], [56, 90], [48, 60]]); ctx.fill()
  ctx.strokeStyle = RED
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(96, 34); ctx.lineTo(108, 26); ctx.moveTo(98, 50); ctx.lineTo(112, 50); ctx.moveTo(96, 66); ctx.lineTo(108, 74)
  ctx.stroke()
  ctx.restore()
}

function drawPin(ctx, x, y, size) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = '#ff4b4b'
  ctx.beginPath()
  ctx.moveTo(5, 10)
  ctx.arc(12, 10, 7, Math.PI, 0)
  ctx.bezierCurveTo(19, 15.8, 12, 22, 12, 22)
  ctx.bezierCurveTo(12, 22, 5, 15.8, 5, 10)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath(); ctx.arc(12, 10, 2.6, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

/* ───────── ภาพประกอบอ่าง/ฝน 392×232 ───────── */

/* ── ชิ้นส่วนแผงขาว (แผงเกณฑ์ + แผงฝน) แบบพรีเมียม — Canvas 2D ล้วน ไม่ใช้ filter (Safari) ── */
// ผสมสีเข้าหาขาว (t > 0) หรือดำ (t < 0)
function shade(hex, t) {
  const n = parseInt(String(hex).replace('#', ''), 16)
  const target = t > 0 ? 255 : 0
  const k = Math.abs(t)
  const mix = c => Math.round(c + (target - c) * k)
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`
}

// สีตัวอักษรบนพื้นขาวที่ยังบอกระดับได้ — เหลือง/ฟ้าอ่อนตามเกณฑ์อ่านไม่ออกบนขาว จึงหรี่ลงก่อน
const inkOf = hex => shade(hex, -0.38)

const ACCENT_W = 16

// พื้นแผงไล่ขาว → เทาฟ้าอ่อน + ขอบแดงจาง (ขอบเดิม)
function panelCard(ctx, y, h) {
  ctx.fillStyle = linear(ctx, 0, y, 0, y + h, [[0, '#ffffff'], [1, '#eef3fa']])
  rrPath(ctx, MARGIN, y, CONTENT_W, h, 18); ctx.fill()
  ctx.strokeStyle = 'rgba(255,59,59,0.55)'; ctx.lineWidth = 2
  rrPath(ctx, MARGIN + 1, y + 1, CONTENT_W - 2, h - 2, 17); ctx.stroke()
}

// หัวแผง: แถบแดงแนวตั้งหน้าหัวข้อ
function panelHeading(ctx, fit, x, cy, display) {
  ctx.fillStyle = linear(ctx, 0, cy - 12, 0, cy + 12, [[0, '#ff4d4d'], [1, '#c4000f']])
  rrPath(ctx, x, cy - 12, 6, 24, 3); ctx.fill()
  drawText(ctx, fit.text, x + ACCENT_W, cy, { font: `700 ${fit.size}px ${display}`, color: NAVY })
}

// แถบสีแบบเม็ดยา: ไล่สีบนสว่าง-ล่างเข้ม + แสงเงาครึ่งบน
function glossyBar(ctx, x, y, w, h, r, hex) {
  if (w <= 0) return
  ctx.save()
  rrPath(ctx, x, y, w, h, r); ctx.clip()
  ctx.fillStyle = linear(ctx, 0, y, 0, y + h, [[0, shade(hex, 0.22)], [0.55, hex], [1, shade(hex, -0.2)]])
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = linear(ctx, 0, y, 0, y + h / 2, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0.08)']])
  rrPath(ctx, x + 3, y + 2, Math.max(0, w - 6), h * 0.42, Math.min(r, h * 0.21)); ctx.fill()
  ctx.restore()
}

// วงกลมจางสีระดับ + หยดฝน
function drawRainDrop(ctx, cx, cy, hex) {
  ctx.fillStyle = rgba(hex, 0.18)
  ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = linear(ctx, 0, cy - 9, 0, cy + 9, [[0, shade(hex, 0.1)], [1, shade(hex, -0.25)]])
  ctx.beginPath()
  ctx.arc(cx, cy + 3, 6, -0.25, Math.PI + 0.25)
  ctx.lineTo(cx, cy - 9)
  ctx.closePath(); ctx.fill()
}


const ILLUS_W = 392
const ILLUS_H = 232

function drawIllustration(ctx, ox, oy, { pct, rainy }, display, body) {
  const rnd = makeRng(rainy ? 11 : 7)
  const hasDam = pct !== null && pct !== undefined && Number.isFinite(pct)
  const over = hasDam && pct > 100
  ctx.save()
  ctx.translate(ox, oy)
  rrPath(ctx, 0, 0, ILLUS_W, ILLUS_H, 20)
  ctx.clip()

  // ท้องฟ้า: แดงมืดไล่ถึงแสงส้มที่ขอบฟ้า (พายุฝน = เทาน้ำเงิน)
  ctx.fillStyle = linear(ctx, 0, 0, 0, ILLUS_H, rainy
    ? [[0, '#0d121c'], [0.55, '#2b3447'], [1, '#56627a']]
    : [[0, '#160204'], [0.45, '#5c0c0a'], [0.8, '#c2380f'], [1, '#ff8a3a']])
  ctx.fillRect(0, 0, ILLUS_W, ILLUS_H)
  glow(ctx, 243, 84, 196, 76, rainy
    ? [[0, 'rgba(159,178,214,0.35)'], [1, 'rgba(159,178,214,0)']]
    : [[0, 'rgba(255,179,92,0.85)'], [0.4, 'rgba(255,106,31,0.35)'], [1, 'rgba(255,106,31,0)']])

  // เมฆ: กลุ่มก้อนฟุ้ง (radial gradient) สุ่ม seed คงที่ จางลงเมื่อลงใกล้ขอบฟ้า
  const cloud = rainy ? '26,31,43' : '40,6,8'
  for (let i = 0; i < 46; i++) {
    const cy = 2 + rnd() * 100
    const a = (rainy ? 0.5 : 0.46) * Math.max(0, 1 - cy / 125)
    glow(ctx, rnd() * ILLUS_W, cy, 34 + rnd() * 70, 9 + rnd() * 17, [[0, `rgba(${cloud},${a.toFixed(3)})`], [1, `rgba(${cloud},0)`]])
  }
  if (rainy) {
    ctx.save()
    ctx.shadowColor = 'rgba(47,139,255,0.9)'; ctx.shadowBlur = 10
    ctx.fillStyle = 'rgba(234,241,255,0.92)'
    poly(ctx, [[282, 8], [270, 40], [281, 40], [266, 74], [292, 34], [280, 34]])
    ctx.fill()
    ctx.restore()
  }

  // ภูเขา 3 ชั้น + หมอกบังระยะไกล
  ctx.globalAlpha = 0.9
  ctx.fillStyle = linear(ctx, 0, 62, 0, 150, [[0, rainy ? '#4a5468' : '#5a2a2c'], [1, rainy ? '#6c7790' : '#a2493a']])
  poly(ctx, [[0, 112], [34, 86], [62, 98], [104, 62], [140, 88], [176, 70], [214, 92], [250, 66], [292, 90], [330, 74], [392, 98], [392, 150], [0, 150]])
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = linear(ctx, 0, 90, 0, 142, [[0, rgba(rainy ? '#8a97b0' : '#d9774a', 0)], [0.5, rgba(rainy ? '#8a97b0' : '#d9774a', 0.3)], [1, rgba(rainy ? '#8a97b0' : '#d9774a', 0)]])
  ctx.fillRect(0, 90, ILLUS_W, 52)
  ctx.fillStyle = linear(ctx, 0, 96, 0, 160, [[0, rainy ? '#26332e' : '#2b2a22'], [1, rainy ? '#3e5148' : '#4d3a2a']])
  poly(ctx, [[0, 128], [46, 104], [88, 118], [132, 96], [176, 116], [220, 104], [262, 122], [310, 100], [352, 114], [392, 106], [392, 160], [0, 160]])
  ctx.fill()
  ctx.fillStyle = linear(ctx, 0, 118, 0, 170, [[0, '#13261a'], [1, '#0a160e']])
  ctx.beginPath()
  ctx.moveTo(0, 170)
  ctx.lineTo(0, 140)
  for (let x = 0; x <= ILLUS_W; x += 5) {
    const b = 136 - 8 * Math.sin(x / 40) - 4 * Math.sin(x / 13)
    ctx.lineTo(x, b - 3 - rnd() * 7)
    ctx.lineTo(x + 2.5, b + 1)
  }
  ctx.lineTo(ILLUS_W, 170)
  ctx.closePath(); ctx.fill()

  // ผืนน้ำในอ่าง + เขื่อน (ภาพประกอบ ไม่ใช่ค่าวัด — ตัวเลข % อยู่ในป้ายและช่องตัวเลข)
  const dx = 226
  const y100 = 150
  const ys = hasDam ? Math.min(222, Math.max(118, y100 - (pct - 100) * (over ? 4 : 3))) : 160
  ctx.fillStyle = linear(ctx, 0, ys, 0, ILLUS_H, [[0, rainy ? '#3d6b8e' : '#2e6fa0'], [0.35, '#14466e'], [1, '#061a2c']])
  ctx.fillRect(0, ys, dx + 2, ILLUS_H - ys)
  ctx.save()
  ctx.beginPath(); ctx.rect(0, ys, dx + 2, ILLUS_H - ys); ctx.clip()
  ctx.lineWidth = 1
  for (let i = 0; i < 46; i++) {
    const yy = ys + 3 + rnd() * (ILLUS_H - ys)
    const xx = rnd() * dx
    ctx.strokeStyle = `rgba(255,255,255,${(0.05 + rnd() * 0.08).toFixed(3)})`
    ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 10 + rnd() * 40, yy); ctx.stroke()
  }
  glow(ctx, 150, ys + 6, 90, 30, [[0, rgba(rainy ? '#c9d8f0' : '#ffb066', 0.55)], [1, rgba(rainy ? '#c9d8f0' : '#ff7a2a', 0)]])
  for (let i = 0; i < 14; i++) {
    const ry = ys + 4 + i * i * 0.55
    const rx = 20 + rnd() * 190
    ctx.strokeStyle = rgba(rainy ? '#dbe6ff' : '#ffd2a6', Math.max(0.05, 0.55 - i * 0.03))
    ctx.lineWidth = 1.1
    ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + 14 + rnd() * 30, ry); ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.moveTo(0, ys + 0.6); ctx.lineTo(dx, ys + 0.6); ctx.stroke()
  ctx.restore()

  if (hasDam) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.8; ctx.setLineDash([7, 5])
    ctx.beginPath(); ctx.moveTo(0, y100); ctx.lineTo(dx, y100); ctx.stroke()
    ctx.restore()
    ctx.fillStyle = 'rgba(4,14,30,0.72)'
    rrPath(ctx, 104, y100 + 6, 116, 20, 10); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke()
    drawText(ctx, 'ระดับเก็บกัก 100%', 162, y100 + 16.5, { font: `700 12px ${display}`, color: '#fff', align: 'center' })
  }

  // เขื่อนคอนกรีต: สันเขื่อน + ราวกันตก + หน้าเขื่อนด้านท้ายน้ำ
  ctx.fillStyle = linear(ctx, dx, 0, dx + 82, 0, [[0, '#f2f0ea'], [0.5, '#b9b5ab'], [1, '#6f6c66']])
  poly(ctx, [[dx, 112], [dx + 24, 112], [dx + 82, 232], [dx, 232]]); ctx.fill()
  ctx.globalAlpha = 0.55
  ctx.fillStyle = linear(ctx, dx + 14, 112, dx + 82, 232, [[0, '#d8d4ca'], [1, '#8b877e']])
  poly(ctx, [[dx + 24, 112], [dx + 82, 232], [dx + 60, 232], [dx + 14, 120]]); ctx.fill()
  ctx.globalAlpha = 0.45
  ctx.strokeStyle = '#5f5b54'; ctx.lineWidth = 0.8
  for (let st = 0; st < 11; st++) {
    const yy = 122 + st * 10
    const xx = dx + 24 + (yy - 112) * 58 / 120
    ctx.beginPath(); ctx.moveTo(dx + 6 + (yy - 112) * 0.2, yy); ctx.lineTo(xx, yy); ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = '#e9e6df'
  rrPath(ctx, dx - 3, 107, 30, 6, 1.5); ctx.fill()
  ctx.fillStyle = '#cfcac0'
  for (let pp = 0; pp < 7; pp++) ctx.fillRect(dx - 2 + pp * 4.6, 102, 1.2, 6)
  ctx.strokeStyle = '#cfcac0'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(dx - 3, 102.5); ctx.lineTo(dx + 27, 102.5); ctx.stroke()
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(dx, 112, 2, 120)

  // ลำน้ำท้ายอ่าง
  ctx.fillStyle = linear(ctx, dx + 70, 0, ILLUS_W, 0, [[0, '#1d5f8f'], [1, '#0b2d4a']])
  ctx.beginPath()
  ctx.moveTo(dx + 70, 232); ctx.bezierCurveTo(dx + 92, 206, dx + 124, 214, ILLUS_W, 196); ctx.lineTo(ILLUS_W, 232); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = 'rgba(159,208,255,0.5)'; ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.moveTo(dx + 84, 224); ctx.bezierCurveTo(dx + 108, 210, dx + 136, 214, ILLUS_W, 204); ctx.stroke()

  // น้ำล้นทางระบาย + ฟอง + ละออง (เฉพาะอ่างเกิน 100%) — เส้นซ้อนเยื้องเล็กน้อยให้เป็นฟอง ไม่ใช้ displacement filter
  if (over) {
    ctx.lineCap = 'round'
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < 7; k++) {
        const o = k * 3.2
        const j = pass ? (rnd() - 0.5) * 3 : 0
        const p0 = [dx + 2 + o + j, ys + 1]
        const c1 = [dx + 22 + o * 1.6 + j, ys + 4]
        const p1 = [dx + 36 + o * 1.9 + j, 150]
        const c2 = [2 * p1[0] - c1[0], 2 * p1[1] - c1[1]]
        const p2 = [dx + 66 + o * 2.2 + j, 226]
        ctx.strokeStyle = k % 2 ? '#ffffff' : '#cfeaff'
        ctx.globalAlpha = Math.max(0.2, (0.95 - k * 0.06) * (pass ? 0.55 : 1))
        ctx.lineWidth = Math.max(1.2, (5.2 - k * 0.45) * (pass ? 0.6 : 1))
        ctx.beginPath()
        ctx.moveTo(p0[0], p0[1]); ctx.quadraticCurveTo(c1[0], c1[1], p1[0], p1[1]); ctx.quadraticCurveTo(c2[0], c2[1], p2[0], p2[1])
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    glow(ctx, dx + 76, 222, 34, 14, [[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']])
    for (let f = 0; f < 16; f++) {
      ctx.fillStyle = `rgba(255,255,255,${(0.5 + rnd() * 0.5).toFixed(2)})`
      ctx.beginPath(); ctx.arc(dx + 52 + rnd() * 48, 214 + rnd() * 16, 1 + rnd() * 2.6, 0, Math.PI * 2); ctx.fill()
    }
  }

  // บ้านท้ายน้ำ ไฟเปิด
  ;[[322, 172, 1], [354, 164, 0.92]].forEach(([x, y, s]) => {
    glow(ctx, x + 13 * s, y + 8 * s, 18, 14, [[0, 'rgba(255,184,77,0.3)'], [1, 'rgba(255,184,77,0)']])
    ctx.fillStyle = '#3a2a24'; ctx.fillRect(x, y, 26 * s, 18 * s)
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x, y, 26 * s, 18 * s)
    ctx.fillStyle = '#7a1c14'
    poly(ctx, [[x - 4, y], [x + 13 * s, y - 13 * s], [x + 30 * s, y]]); ctx.fill()
    ctx.fillStyle = '#ffd36b'
    ctx.fillRect(x + 5 * s, y + 5 * s, 6 * s, 6 * s); ctx.fillRect(x + 15 * s, y + 5 * s, 6 * s, 6 * s)
  })

  // ป้ายเตือน
  ctx.save()
  ctx.shadowColor = over ? 'rgba(255,42,42,0.9)' : 'rgba(47,139,255,0.9)'; ctx.shadowBlur = 9
  ctx.fillStyle = '#ffc400'; ctx.strokeStyle = '#1a0306'; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'
  poly(ctx, [[370, 112], [390, 148], [350, 148]]); ctx.fill(); ctx.stroke()
  ctx.restore()
  ctx.fillStyle = '#1a0306'
  rrPath(ctx, 368.6, 123, 2.8, 13, 1); ctx.fill()
  ctx.beginPath(); ctx.arc(370, 141.5, 1.9, 0, Math.PI * 2); ctx.fill()

  if (rainy) {
    ctx.lineCap = 'round'
    for (let r = 0; r < 120; r++) {
      const rx = rnd() * ILLUS_W * 1.1
      const ry = rnd() * ILLUS_H
      ctx.strokeStyle = `rgba(219,231,255,${(0.25 + rnd() * 0.45).toFixed(2)})`
      ctx.lineWidth = 0.8 + rnd() * 0.9
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 6, ry + 16); ctx.stroke()
    }
  }

  // ป้าย % ที่ผิวน้ำ — สีตามเกณฑ์ (DAM_LEVELS) เสมอ
  if (hasDam) {
    const tagColor = damLevel(pct)?.color ?? NEUTRAL_HEAD
    ctx.save()
    ctx.shadowColor = over ? 'rgba(255,42,42,0.9)' : 'rgba(47,139,255,0.9)'; ctx.shadowBlur = 8
    ctx.fillStyle = tagColor
    rrPath(ctx, 10, ys - 32, 92, 26, 13); ctx.fill()
    ctx.restore()
    drawText(ctx, `${pct.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, 56, ys - 18.5, { font: `700 16px ${display}`, color: readableTextOn(tagColor), align: 'center' })
    drawText(ctx, 'สันเขื่อน', dx + 12, 96, { font: `700 11px ${body}`, color: 'rgba(255,255,255,0.9)', align: 'center' })
  }

  // ขอบมืด (vignette)
  ctx.save()
  ctx.translate(ILLUS_W / 2, ILLUS_H / 2)
  ctx.scale(ILLUS_W, ILLUS_H)
  const vig = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.75)
  vig.addColorStop(0.55, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vig
  ctx.fillRect(-0.5, -0.5, 1, 1)
  ctx.restore()

  ctx.restore()
  // กรอบขาว
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4
  rrPath(ctx, ox + 2, oy + 2, ILLUS_W - 4, ILLUS_H - 4, 20); ctx.stroke()
  ctx.restore()
}

/* ───────── ตราหน่วยงาน ───────── */

async function loadLogo(url) {
  try {
    const result = await fetchImageAsDataUrl(url, { timeoutMs: 8000 })
    if (result.error || !result.dataUrl) return null
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = result.dataUrl })
    return image.naturalWidth > 0 ? image : null
  } catch {
    return null
  }
}

/* ───────── ตัววาดทั้งภาพ ───────── */

/**
 * วาดภาพทั้งใบ (sync) — คืน layout สำหรับเทสต์: issues (ข้อความที่ย่อสุดแล้วยังล้น) · fits (เนื้อหาไม่ล้นแถบล่าง) · blocks
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} model ผลของ buildPosterModel
 * @param {{ fonts: { display: string, body: string }, logo?: CanvasImageSource | null, tight?: boolean }} resources
 *   tight = บีบ "ระยะเว้น" ในแผงตัวเลข/สเกล/ฝน (ไม่แตะขนาดฟอนต์) — เรียกซ้ำเองเมื่อเนื้อหาล้นแถบล่าง
 */
export function drawWaterAlertPoster(ctx, model, { fonts, logo = null, tight = false }) {
  const { display, body } = fonts
  const issues = []
  const blocks = []
  ctx.save()
  ctx.clearRect(0, 0, W, H)

  /* พื้นหลังมืดแดง-ดำ แบบประกาศฉุกเฉิน */
  ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, '#45000a'], [0.42, '#22030a'], [1, '#120205']])
  ctx.fillRect(0, 0, W, H)
  glow(ctx, 0.12 * W, 0, 760, 460, [[0, 'rgba(255,30,20,0.62)'], [0.66, 'rgba(255,30,20,0)']])
  glow(ctx, 1.05 * W, 0.3 * H, 620, 520, [[0, 'rgba(255,0,0,0.28)'], [0.7, 'rgba(255,0,0,0)']])
  glow(ctx, 0.5 * W, 1.1 * H, 900, 500, [[0, 'rgba(255,60,0,0.22)'], [0.7, 'rgba(255,60,0,0)']])
  hazardStripe(ctx, 0, 0, W, 16)

  /* ── หัวภาพ ── */
  drawSiren(ctx, MARGIN, 40, 104)

  ctx.save()
  const bnText = 'แจ้งเตือน'
  const bnW = 26 + textWidth(ctx, bnText, 700, 66, display) + 40
  ctx.shadowColor = 'rgba(227,18,27,0.35)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8
  ctx.fillStyle = linear(ctx, 154, 0, 154 + bnW, 0, [[0, '#c4000f'], [0.4, RED], [1, '#ff6a00']])
  poly(ctx, [[154, 40], [154 + bnW, 40], [154 + bnW * 0.94, 138], [154, 138]]); ctx.fill()
  ctx.restore()
  drawText(ctx, bnText, 154 + 26, 40 + 49 + 3, { font: `700 66px ${display}`, color: '#fff' })

  const subFit = fitOne(ctx, model.headline.sub, display, 700, 440, 44, 30, issues, 'หัวเรื่อง')
  drawText(ctx, subFit.text, 156, 154 + 24, { font: `700 ${subFit.size}px ${display}`, color: '#fff', shadow: { color: 'rgba(255,80,60,0.6)', blur: 18 } })

  // ป้ายระดับ (จุดแดงเรือง)
  {
    const fit = fitOne(ctx, model.headline.level, display, 700, 470, 26, 18, issues, 'ป้ายระดับ')
    const w = 8 + 30 + 10 + fit.width + 20
    ctx.save()
    ctx.shadowColor = 'rgba(199,0,0,0.5)'; ctx.shadowBlur = 8
    ctx.fillStyle = '#ff1a1a'
    rrPath(ctx, 156, 206, w, 46, 23); ctx.fill()
    ctx.restore()
    glow(ctx, 156 + 8 + 15, 229, 24, 24, [[0.4, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(156 + 8 + 15, 229, 15, 0, Math.PI * 2); ctx.fill()
    drawText(ctx, fit.text, 156 + 8 + 30 + 10, 229 + 2, { font: `700 ${fit.size}px ${display}`, color: '#fff' })
  }

  // ป้ายชื่อพื้นขาวตัวแดง (ชื่ออ่าง/พื้นที่) — กว้างไม่เกินแนวซ้ายของภาพประกอบ ยาวเกินลงเป็น 2 บรรทัด
  const bigMaxW = 588 - 48
  let bigLines
  let bigSize
  {
    let size = 50
    while (size > 34 && textWidth(ctx, model.headline.name, 700, size, display) > bigMaxW) size -= 1
    if (textWidth(ctx, model.headline.name, 700, size, display) <= bigMaxW) { bigLines = [model.headline.name]; bigSize = size }
    else {
      bigSize = 36
      const all = wrapLines(model.headline.name, bigMaxW, bigSize, true, measurer(ctx, display))
      bigLines = all.slice(0, 2)
      // ตัดทิ้งเกิน 2 บรรทัดต้องมี "…" บอกว่าชื่อเต็มอยู่ในคำอธิบายด้านล่าง
      bigLines = bigLines.map((line, i) => (i === bigLines.length - 1 ? ellipsize(ctx, all.length > 2 ? `${line}…` : line, 700, bigSize, display, bigMaxW) : line))
    }
  }
  const bigLineH = Math.round(bigSize * 1.15)
  const bigH = 12 + bigLines.length * bigLineH + 16
  const bigW = 48 + Math.max(...bigLines.map(l => textWidth(ctx, l, 700, bigSize, display)))
  const bigY = bigLines.length > 1 ? 252 : 260
  ctx.save()
  ctx.shadowColor = 'rgba(255,30,20,0.7)'; ctx.shadowBlur = 40
  ctx.fillStyle = '#ff1a1a'
  rrPath(ctx, MARGIN - 5, bigY - 5, bigW + 10, bigH + 10, 20); ctx.fill()
  ctx.restore()
  ctx.fillStyle = '#fff'
  rrPath(ctx, MARGIN, bigY, bigW, bigH, 16); ctx.fill()
  bigLines.forEach((line, i) => drawText(ctx, line, MARGIN + 24, bigY + 12 + i * bigLineH + bigLineH / 2 + 2, { font: `700 ${bigSize}px ${display}`, color: '#c4000f' }))
  const bigBottom = bigY + bigH + 5

  // ป้ายหน่วยงานแบบเหรียญตราทอง มุมขวาบน (เจ้าของอนุมัติ 2026-11-15)
  // ภาษาเดียวกับชื่อ อปท. ในภาพข่าว (#713): พื้นน้ำเงินเข้ม + ชื่อทองไล่เฉด #fff6c2→#ffd54a→#f59e0b ขอบน้ำตาลทอง
  // อยู่ในช่วง y 34–114 เสมอ (ภาพอ่างเริ่ม y 120) · ซ้ายสุดไม่เกินท้ายป้าย "แจ้งเตือน" (~x 490)
  {
    const BY = 34
    const BH = 80
    const nameFit = fitOne(ctx, model.tenantName, display, 700, 400, 27, 17, issues, 'ชื่อหน่วยงาน')
    const subText = 'ระบบข้อมูลน้ำ–ฝน'
    const textW = Math.max(nameFit.width, textWidth(ctx, subText, 500, 16, body))
    const R_MED = 38
    const lead = logo ? 24 + R_MED + 14 : 22
    const w = lead + textW + 24
    const x = W - MARGIN - w
    const cyMid = BY + BH / 2

    // แสงฟุ้งทองหลังป้าย (แทน blur/filter ที่ Safari ไม่รองรับ)
    glow(ctx, x + w / 2, cyMid, w * 0.62, 70, [[0, 'rgba(255,200,60,0.28)'], [1, 'rgba(255,200,60,0)']])
    // กรอบทองไล่เฉด + เงาตกใต้ป้าย
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6
    ctx.fillStyle = linear(ctx, x, BY, x + w, BY + BH, [[0, '#fff1b8'], [0.3, '#d9a21b'], [0.55, '#ffe27a'], [0.8, '#c48a12'], [1, '#ffe9a0']])
    rrPath(ctx, x, BY, w, BH, 20); ctx.fill()
    ctx.restore()
    // พื้นน้ำเงินเข้ม + แสงเคลือบครึ่งบน + แถบเงาเฉียง
    ctx.save()
    rrPath(ctx, x + 3, BY + 3, w - 6, BH - 6, 17); ctx.clip()
    ctx.fillStyle = linear(ctx, 0, BY, 0, BY + BH, [[0, '#14408f'], [0.5, '#0b2a6b'], [1, '#06173d']])
    ctx.fillRect(x, BY, w, BH)
    ctx.fillStyle = linear(ctx, 0, BY, 0, BY + BH * 0.5, [[0, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillRect(x, BY, w, BH * 0.5)
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    poly(ctx, [[x + w * 0.58, BY], [x + w * 0.7, BY], [x + w * 0.6, BY + BH], [x + w * 0.48, BY + BH]]); ctx.fill()
    ctx.restore()
    // เส้นทองบางด้านใน
    ctx.strokeStyle = 'rgba(255,214,90,0.45)'; ctx.lineWidth = 1
    rrPath(ctx, x + 7.5, BY + 7.5, w - 15, BH - 15, 13); ctx.stroke()

    // เหรียญตรา: วงแหวนทอง 2 ชั้น ยื่นล้นขอบซ้ายแบบตราประทับ
    if (logo) {
      const mx = x + 24
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4
      ctx.fillStyle = linear(ctx, mx - R_MED, cyMid - R_MED, mx + R_MED, cyMid + R_MED, [[0, '#fff3c4'], [0.45, '#d9a21b'], [0.7, '#ffe27a'], [1, '#a86f08']])
      ctx.beginPath(); ctx.arc(mx, cyMid, R_MED, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      ctx.fillStyle = '#0b2a6b'
      ctx.beginPath(); ctx.arc(mx, cyMid, R_MED - 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = linear(ctx, mx, cyMid - R_MED, mx, cyMid + R_MED, [[0, '#ffe9a0'], [1, '#c48a12']])
      ctx.beginPath(); ctx.arc(mx, cyMid, R_MED - 6, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(mx, cyMid, R_MED - 8, 0, Math.PI * 2); ctx.fill()
      const r = R_MED - 9
      ctx.save()
      ctx.beginPath(); ctx.arc(mx, cyMid, r, 0, Math.PI * 2); ctx.clip()
      const iw = logo.naturalWidth || logo.width
      const ih = logo.naturalHeight || logo.height
      const scale = Math.max((r * 2) / iw, (r * 2) / ih)
      ctx.drawImage(logo, mx - (iw * scale) / 2, cyMid - (ih * scale) / 2, iw * scale, ih * scale)
      ctx.restore()
    }

    // ชื่อหน่วยงานตัวทอง: เงาดำเลื่อนลง → ทองไล่เฉด → ขอบน้ำตาลทองบาง (ซ้อนข้อความ ไม่ใช้ filter)
    const tx = x + lead
    const nameY = BY + 28
    const nameFont = `700 ${nameFit.size}px ${display}`
    drawText(ctx, nameFit.text, tx, nameY + 2, { font: nameFont, color: 'rgba(0,8,30,0.7)' })
    const half = nameFit.size * 0.6
    drawText(ctx, nameFit.text, tx, nameY, { font: nameFont, color: linear(ctx, 0, nameY - half, 0, nameY + half, [[0, '#fff6c2'], [0.45, '#ffd54a'], [1, '#f59e0b']]) })
    ctx.strokeStyle = 'rgba(138,90,0,0.85)'; ctx.lineWidth = 0.8
    ctx.strokeText(nameFit.text, tx, nameY)
    // เส้นทองคั่น (จางไปทางขวา) + บรรทัดรอง
    ctx.fillStyle = linear(ctx, tx, 0, tx + textW, 0, [[0, 'rgba(255,213,74,0.95)'], [1, 'rgba(255,213,74,0)']])
    ctx.fillRect(tx, BY + 47, textW, 1.5)
    drawText(ctx, subText, tx, BY + 63, { font: `500 16px ${body}`, color: '#f3e6c4' })

    // ประกายดาว 4 แฉกบนกรอบทอง
    const sparkle = (sx, sy, s) => {
      glow(ctx, sx, sy, s * 1.6, s * 1.6, [[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']])
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.moveTo(sx, sy - s)
      ctx.quadraticCurveTo(sx, sy, sx + s, sy)
      ctx.quadraticCurveTo(sx, sy, sx, sy + s)
      ctx.quadraticCurveTo(sx, sy, sx - s, sy)
      ctx.quadraticCurveTo(sx, sy, sx, sy - s)
      ctx.fill()
    }
    sparkle(x + w - 16, BY + 2, 10)
    sparkle(x + w * 0.45, BY + BH - 1, 6)
  }

  drawIllustration(ctx, W - MARGIN - ILLUS_W, 120, model.illustration, display, body)
  const heroBottom = Math.max(120 + ILLUS_H, bigBottom)

  /* ── บล็อกใต้หัวภาพ: สร้าง (วัดความสูง) แล้วเรียงลง ── */
  const stack = []

  // ริบบอนวันที่
  {
    const fit = fitOne(ctx, model.ribbon, display, 700, 760, 27, 18, issues, 'ริบบอนวันที่')
    const h = 44
    stack.push({
      name: 'ribbon', h,
      paint(y) {
        const w = 22 + fit.width + 40
        ctx.fillStyle = '#ffd400'
        poly(ctx, [[MARGIN, y], [MARGIN + w, y], [MARGIN + w * 0.96, y + h], [MARGIN, y + h]]); ctx.fill()
        drawText(ctx, fit.text, MARGIN + 22, y + h / 2 + 2, { font: `700 ${fit.size}px ${display}`, color: '#1a0306' })
      },
    })
  }

  // ย่อหน้าอธิบาย + ประโยควิเคราะห์สถานการณ์ (buildSituationAnalysis) ไม่เกิน 3 บรรทัด
  // ยาวเกิน 3 บรรทัด หรือทั้งภาพล้นแถบล่าง (ตรวจตอนเรียงบล็อกข้างล่าง) → ตัดประโยควิเคราะห์ท้ายสุดทิ้งทีละประโยค
  // ห้ามตัดกลางประโยคด้วย "…" — ประโยคเตือนที่ขาดครึ่งอ่านผิดความหมายได้
  const analysisTotal = model.analysis?.length ?? 0
  const introBlock = n => {
    const local = []
    const runs = model.introFor ? model.introFor(n) : model.intro
    const rich = richLines(ctx, runs, body, CONTENT_W, 23, 18, 3, local, 'คำอธิบาย')
    const lineH = Math.round(rich.size * 1.4)
    return {
      name: 'intro', h: rich.lines.length * lineH, shown: n, truncated: rich.truncated, local,
      paint(y) { drawRich(ctx, rich.lines, MARGIN, y, lineH, rich.size, body, { color: '#fff', emColor: '#ffd400', weight: 700 }) },
    }
  }
  let intro = introBlock(analysisTotal)
  while (intro.truncated && intro.shown > 0) intro = introBlock(intro.shown - 1)
  const introIndex = stack.push(intro) - 1

  // บรรทัดแดง "มีเรื่องอื่นที่ต้องระวังกว่า"
  if (model.otherNote) {
    const rich = richLines(ctx, [{ t: model.otherNote }], body, CONTENT_W - 40, 19, 15, 2, issues, 'เรื่องอื่นที่ต้องระวัง')
    const lineH = Math.round(rich.size * 1.3)
    const h = 14 + rich.lines.length * lineH
    stack.push({
      name: 'otherNote', h,
      paint(y) {
        ctx.fillStyle = '#b0000c'
        rrPath(ctx, MARGIN, y, CONTENT_W, h, 14); ctx.fill()
        ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2; ctx.stroke()
        drawRich(ctx, rich.lines, MARGIN + 20, y + 7, lineH, rich.size, body, { color: '#fff', emColor: '#fff', weight: 700 })
      },
    })
  }

  // ช่องตัวเลข
  {
    const n = model.tiles.length
    const gap = 14
    const tw = (CONTENT_W - gap * (n - 1)) / n
    const headH = 52
    const bodyH = tight ? 80 : 88
    const fits = model.tiles.map(tile => {
      const parts = tile.label.split('\n')
      let size = 19
      const widthOf = s => Math.max(...parts.map(p => textWidth(ctx, p, 600, s, body)))
      while (size > 13 && widthOf(size) > tw - 12 - 40 - 8 - 10) size -= 1
      const lines = parts.map(p => ellipsize(ctx, p, 600, size, body, tw - 12 - 40 - 8 - 10))
      const value = fitOne(ctx, tile.value, display, 700, tw - 16, 44, 26, issues, `ช่องตัวเลข ${tile.key}`)
      const unit = fitOne(ctx, tile.unit, body, 600, tw - 16, 18, 11, issues, `หน่วย ${tile.key}`)
      return { size, lines, value, unit }
    })
    stack.push({
      name: 'tiles', h: headH + bodyH,
      paint(y) {
        model.tiles.forEach((tile, i) => {
          const x = MARGIN + i * (tw + gap)
          const f = fits[i]
          ctx.save()
          ctx.shadowColor = 'rgba(120,20,10,0.3)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8
          ctx.fillStyle = '#fff'
          rrPath(ctx, x, y, tw, headH + bodyH, 18); ctx.fill()
          ctx.restore()
          ctx.save()
          rrPath(ctx, x, y, tw, headH + bodyH, 18); ctx.clip()
          ctx.fillStyle = tile.color
          ctx.fillRect(x, y, tw, headH)
          const ink = readableTextOn(tile.color)
          drawIcon(ctx, tile.icon, x + 12, y + 6, 40, ink)
          f.lines.forEach((line, li) => drawText(ctx, line, x + 12 + 40 + 8, y + headH / 2 + (li - (f.lines.length - 1) / 2) * f.size * 1.18 + 1, { font: `600 ${f.size}px ${body}`, color: ink }))
          ctx.restore()
          ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2
          rrPath(ctx, x + 1, y + 1, tw - 2, headH + bodyH - 2, 17); ctx.stroke()
          drawText(ctx, f.value.text, x + tw / 2, y + headH + 36, { font: `700 ${f.value.size}px ${display}`, color: tile.neutral ? NEUTRAL_HEAD : '#c4000f', align: 'center' })
          drawText(ctx, f.unit.text, x + tw / 2, y + headH + (tight ? 68 : 72), { font: `600 ${f.unit.size}px ${body}`, color: INK, align: 'center' })
        })
      },
    })
  }

  // แถบสเกลเกณฑ์ + หมุดค่าปัจจุบัน
  // แบบพรีเมียม: ช่องที่ค่าอยู่สีเต็ม ช่องอื่นจาง · ป้ายค่ามีหางชี้ลงหมุดวงกลม · ตัวเลขเกณฑ์เป็นป้ายเล็กใต้แถบที่รอยต่อ
  {
    const sc = model.scale
    const h = tight ? 108 : 118
    const L = MARGIN + 18
    const R = MARGIN + CONTENT_W - 18
    const heading = fitOne(ctx, sc.heading, display, 700, CONTENT_W - 36 - ACCENT_W, 21, 15, issues, 'หัวข้อสเกล')
    const x = sc.kind === 'equal'
      ? v => {
        const n = sc.zones.length
        for (let i = 0; i < n; i++) {
          const z = sc.zones[i]
          if (v <= z.to || i === n - 1) return L + (i + Math.min(Math.max((v - z.from) / (z.to - z.from), 0), 1)) * (R - L) / n
        }
        return L
      }
      : v => L + Math.min(Math.max(v, 0), sc.max) / sc.max * (R - L)
    const mark = fitOne(ctx, sc.markLabel, display, 700, 420, 17, 12, issues, 'ป้ายหมุด')
    const activeIndex = Math.max(0, sc.zones.findIndex((z, i) => sc.value <= z.to || i === sc.zones.length - 1))
    // ป้ายเกณฑ์อยู่แถวเดียวกับป้ายตัวเลขที่รอยต่อ → เว้นที่ให้ป้ายตัวเลขซ้าย-ขวาช่องละ ~23px
    const labels = sc.zones.map((z, i) => {
      const x0 = x(z.from) + (i ? 2 : 0)
      const x1 = x(z.to)
      return fitOne(ctx, z.label, body, i === activeIndex ? 700 : 600, Math.max(30, x1 - x0 - 46), 14, 11, issues, `ป้ายเกณฑ์ ${z.label}`)
    })
    stack.push({
      name: 'scale', h,
      paint(y) {
        panelCard(ctx, y, h)
        panelHeading(ctx, heading, L, y + (tight ? 21 : 24), display)
        const y0 = y + (tight ? 64 : 70)
        const bh = 20
        sc.zones.forEach((z, i) => {
          const x0 = x(z.from) + (i ? 2 : 0)
          const x1 = x(z.to)
          const active = i === activeIndex
          ctx.save()
          ctx.globalAlpha = active ? 1 : 0.4
          glossyBar(ctx, x0, y0, x1 - x0, bh, 6, z.color)
          ctx.restore()
          drawText(ctx, labels[i].text, (x0 + x1) / 2, y0 + bh + 13, { font: `${active ? 700 : 600} ${labels[i].size}px ${body}`, color: active ? inkOf(z.color) : DIM, align: 'center' })
        })
        sc.zones.slice(1).forEach(z => {
          const t = String(z.from)
          const tw = textWidth(ctx, t, 600, 13, display) + 12
          const cx = x(z.from)
          ctx.fillStyle = '#e6ecf5'
          rrPath(ctx, cx - tw / 2, y0 + bh + 4, tw, 18, 9); ctx.fill()
          drawText(ctx, t, cx, y0 + bh + 13.5, { font: `600 13px ${display}`, color: INK, align: 'center' })
        })
        // หมุด: วงกลมขาวขอบแดงบนแถบ + ป้ายแดงมีหางชี้ลง
        const m = x(sc.value)
        const cy = y0 + bh / 2
        ctx.save()
        ctx.shadowColor = 'rgba(120,0,10,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2
        ctx.fillStyle = '#fff'
        ctx.beginPath(); ctx.arc(m, cy, 13, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
        ctx.strokeStyle = RED; ctx.lineWidth = 4
        ctx.beginPath(); ctx.arc(m, cy, 11, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = RED
        ctx.beginPath(); ctx.arc(m, cy, 4, 0, Math.PI * 2); ctx.fill()
        const bubH = tight ? 22 : 24
        const bubW = mark.width + 28
        const bubBottom = y0 - 10
        const bx = Math.min(Math.max(m - bubW / 2, L), R - bubW)
        ctx.save()
        ctx.shadowColor = 'rgba(160,0,12,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3
        ctx.fillStyle = linear(ctx, bx, 0, bx + bubW, 0, [[0, '#c4000f'], [1, RED]])
        rrPath(ctx, bx, bubBottom - bubH, bubW, bubH, bubH / 2); ctx.fill()
        ctx.restore()
        ctx.fillStyle = RED
        poly(ctx, [[m - 6, bubBottom - 1], [m + 6, bubBottom - 1], [m, bubBottom + 6]]); ctx.fill()
        drawText(ctx, mark.text, bx + bubW / 2, bubBottom - bubH / 2 + 1, { font: `700 ${mark.size}px ${display}`, color: '#fff', align: 'center' })
      },
    })
  }

  // แผงฝนรายสถานี + ข้อความ สสน. ระดับอำเภอ
  // แบบพรีเมียม: แต่ละแถวมีรางแบ่ง 4 ช่องสีจางของตัวเอง (ไม่ระบายพื้นทั้งคอลัมน์) · แถบเงา + จุดปลาย · ค่าในป้ายสีตามระดับ
  {
    const rain = model.rain
    const inner = CONTENT_W - 36
    const L = MARGIN + 18
    const ROW = tight ? 46 : 52
    const heading = fitOne(ctx, rain.heading, display, 700, inner - ACCENT_W - (rain.chip ? 190 : 0), 21, 14, issues, 'หัวข้อฝน')
    const warnRuns = rain.warning.none
      ? [{ t: `${rain.warning.label}: ` }, { t: rain.warning.text, em: true }]
      : [{ t: `${rain.warning.label}: `, em: true }, { t: `${rain.warning.text}${rain.warning.more > 0 ? ` (และอีก ${rain.warning.more} ข้อความ)` : ''}` }]
    const warn = richLines(ctx, warnRuns, body, inner, 17, 13, 2, issues, 'ข้อความ สสน.')
    const warnLineH = Math.round(warn.size * 1.35)
    const rowsH = rain.rows.length ? rain.rows.length * ROW + (tight ? 20 : 22) : 30
    const h = 12 + 30 + rowsH + 6 + warn.lines.length * warnLineH + 12
    const ICON = 34
    const X0 = L + 460
    const X1 = L + 780
    const TRACK_H = 20
    // สเกลฝนแบบช่องกว้างเท่ากัน — เกณฑ์/สีจาก RAIN_LEVELS (กรมอุตุฯ) ชุดเดียวกับแถบเกณฑ์ด้านบน ไม่ตั้งสีเอง
    const RL_BOUNDS = [0, 10, 35, 90, RAIN_SCALE_MAX]
    const RL = RAIN_LEVELS.slice(1).map((l, i) => [RL_BOUNDS[i], RL_BOUNDS[i + 1], l.bar, l.label.replace(/^ฝน/, '')])
    const px = mm => {
      for (let i = 0; i < RL.length; i++) {
        const z = RL[i]
        if (mm <= z[1] || i === RL.length - 1) return X0 + (i + Math.min(Math.max((mm - z[0]) / (z[1] - z[0]), 0), 1)) * (X1 - X0) / RL.length
      }
      return X0
    }
    const textW = X0 - 16 - (L + ICON)
    const valueMaxW = L + inner - (X1 + 16) - 22
    const rowFits = rain.rows.map(row => {
      const pillW = row.inTambon ? 76 : 0
      const name = fitOne(ctx, row.name, body, 700, textW - pillW, 19, 13, issues, `ชื่อสถานี ${row.name}`)
      const sub = fitOne(ctx, row.sub, body, 500, textW, 15, 11, issues, `รายละเอียดสถานี ${row.name}`)
      const value = fitOne(ctx, `${row.mmText} มม.`, display, 700, valueMaxW, 22, 14, issues, 'ค่าฝน')
      return { name, sub, value, pillW }
    })
    const chip = rain.chip ? fitOne(ctx, rain.chip.label, body, 700, 170, 17, 12, issues, 'ป้ายระดับฝน') : null
    stack.push({
      name: 'rain', h,
      paint(y) {
        panelCard(ctx, y, h)
        panelHeading(ctx, heading, L, y + 12 + 15, display)
        if (chip) {
          const cw = chip.width + 28
          ctx.fillStyle = rain.chip.color
          rrPath(ctx, L + inner - cw, y + 12 + 2, cw, 28, 14); ctx.fill()
          drawText(ctx, chip.text, L + inner - cw / 2, y + 12 + 16, { font: `700 ${chip.size}px ${body}`, color: readableTextOn(rain.chip.color), align: 'center' })
        }
        const top = y + 12 + 30
        if (!rain.rows.length) {
          drawText(ctx, rain.empty ?? '', L, top + 15, { font: `600 17px ${body}`, color: DIM })
        } else {
          const B = rain.rows.length * ROW
          // คำอธิบายช่องใต้ราง: จุดสี + ชื่อระดับ
          RL.forEach(z => {
            const cx = (px(z[0]) + px(z[1])) / 2
            const lw = textWidth(ctx, z[3], 600, 14, body)
            ctx.fillStyle = z[2]
            ctx.beginPath(); ctx.arc(cx - lw / 2 - 4, top + B + 11, 4.5, 0, Math.PI * 2); ctx.fill()
            drawText(ctx, z[3], cx + 5, top + B + 11, { font: `600 14px ${body}`, color: DIM, align: 'center' })
          })
          rain.rows.forEach((row, i) => {
            const f = rowFits[i]
            const ry = top + i * ROW
            const tone = row.color ?? RAIN_LEVELS[0].bar
            if (i > 0) {
              ctx.fillStyle = 'rgba(15,35,80,0.09)'
              ctx.fillRect(L, ry - 3, inner, 1.5)
            }
            drawRainDrop(ctx, L + 14, ry + (tight ? 22 : 24), tone)
            const tx = L + ICON
            drawText(ctx, f.name.text, tx, ry + 14, { font: `700 ${f.name.size}px ${body}`, color: INK })
            if (row.inTambon) {
              const px0 = tx + f.name.width + 10
              ctx.fillStyle = '#dcfce7'
              rrPath(ctx, px0, ry + 3, 66, 24, 12); ctx.fill()
              ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 1.5; ctx.stroke()
              drawText(ctx, 'ในตำบล', px0 + 33, ry + 16, { font: `700 13px ${body}`, color: '#0d7a3e', align: 'center' })
            }
            drawText(ctx, f.sub.text, tx, ry + (tight ? 36 : 38), { font: `500 ${f.sub.size}px ${body}`, color: DIM })
            // ราง 4 ช่องสีจาง
            const ty = ry + 16
            ctx.save()
            rrPath(ctx, X0, ty, X1 - X0, TRACK_H, TRACK_H / 2); ctx.clip()
            ctx.fillStyle = '#eef2f8'
            ctx.fillRect(X0, ty, X1 - X0, TRACK_H)
            RL.forEach((z, zi) => {
              ctx.fillStyle = rgba(z[2], 0.18)
              ctx.fillRect(px(z[0]) + (zi ? 1 : 0), ty, px(z[1]) - px(z[0]) - (zi ? 1 : 0), TRACK_H)
            })
            ctx.restore()
            if (row.mm !== null && row.mm >= 0.1) {
              const end = Math.max(px(row.mm), X0 + TRACK_H)
              glossyBar(ctx, X0, ty, end - X0, TRACK_H, TRACK_H / 2, tone)
              ctx.fillStyle = '#fff'
              ctx.beginPath(); ctx.arc(end - TRACK_H / 2, ty + TRACK_H / 2, 5, 0, Math.PI * 2); ctx.fill()
            } else {
              ctx.fillStyle = '#9aa7bd'
              ctx.beginPath(); ctx.arc(X0 + TRACK_H / 2, ty + TRACK_H / 2, 5, 0, Math.PI * 2); ctx.fill()
            }
            // ค่า มม. ในป้ายสีตามระดับ
            const vw = f.value.width + 22
            const vx = L + inner - vw
            ctx.fillStyle = rgba(tone, 0.14)
            rrPath(ctx, vx, ty - 6, vw, TRACK_H + 12, (TRACK_H + 12) / 2); ctx.fill()
            ctx.strokeStyle = rgba(tone, 0.85); ctx.lineWidth = 2; ctx.stroke()
            drawText(ctx, f.value.text, vx + vw / 2, ty + TRACK_H / 2 + 1, { font: `700 ${f.value.size}px ${display}`, color: inkOf(tone), align: 'center' })
          })
        }
        drawRich(ctx, warn.lines, L, top + rowsH + 6, warnLineH, warn.size, body, { color: DIM, emColor: RED, weight: 600, emWeight: 700 })
      },
    })
  }

  // ข้อควรทำ 3 ข้อ (กรอบเหลือง)
  {
    const iconW = 92
    const textX = MARGIN + 18 + iconW + 14
    const textW = MARGIN + CONTENT_W - 18 - textX
    let size = 19
    let items
    for (;;) {
      items = model.todo.map(runs => richLines(ctx, runs.map(r => ({ t: r.t, em: r.b })), body, textW - 22, size, size, 2, issues, 'ข้อควรทำ'))
      const lines = items.reduce((s, it) => s + it.lines.length, 0)
      if (lines <= 5 || size <= 15) break
      size -= 1
    }
    const lineH = Math.round(size * 1.38)
    const total = items.reduce((s, it) => s + it.lines.length, 0) * lineH + (items.length - 1) * 3
    const h = Math.max(96, 20 + total)
    stack.push({
      name: 'todo', h,
      paint(y) {
        ctx.save()
        ctx.shadowColor = 'rgba(255,212,0,0.35)'; ctx.shadowBlur = 30
        ctx.fillStyle = '#ffd400'
        rrPath(ctx, MARGIN, y, CONTENT_W, h, 18); ctx.fill()
        ctx.restore()
        drawWarnTriangle(ctx, MARGIN + 18, y + (h - 84) / 2, 92, 84)
        let cy = y + (h - total) / 2
        items.forEach(item => {
          ctx.fillStyle = '#1a0306'
          ctx.beginPath(); ctx.arc(textX + 5, cy + lineH / 2, 3.5, 0, Math.PI * 2); ctx.fill()
          drawRich(ctx, item.lines, textX + 22, cy, lineH, size, body, { color: '#1a0306', emColor: '#b0000c', weight: 600, emWeight: 700 })
          cy += item.lines.length * lineH + 3
        })
      },
    })
  }

  // แถบโทรโข่ง + เบอร์ติดต่อ — ไม่มีเบอร์ = ไม่มีแถบนี้ (ห้ามเติมเบอร์สำรอง)
  if (model.phones.length) {
    const h = 100
    const stickW = 214
    const avail = CONTENT_W - 18 - 100 - 14 - stickW - 16
    const gap = 10
    const chipW = Math.min(250, (avail - gap * (model.phones.length - 1)) / model.phones.length)
    const chips = model.phones.map(p => ({
      label: fitOne(ctx, p.label, body, 600, chipW - 24, 15, 11, issues, `ป้ายเบอร์ ${p.label}`),
      number: fitOne(ctx, p.number, display, 700, chipW - 24, 27, 16, issues, `เบอร์ ${p.number}`),
    }))
    stack.push({
      name: 'call', h,
      paint(y) {
        ctx.fillStyle = 'rgba(255,255,255,0.07)'
        rrPath(ctx, MARGIN, y, CONTENT_W, h, 18); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2
        rrPath(ctx, MARGIN + 1, y + 1, CONTENT_W - 2, h - 2, 17); ctx.stroke()
        drawMegaphone(ctx, MARGIN + 14, y + 10, 96, 80)
        const tx = MARGIN + 18 + 100 + 14 - 8
        drawText(ctx, 'สอบถาม / แจ้งเหตุ', tx, y + 22, { font: `700 21px ${display}`, color: '#fff' })
        chips.forEach((chip, i) => {
          const cx = tx + i * (chipW + gap)
          ctx.fillStyle = '#fff'
          rrPath(ctx, cx, y + 38, chipW, 54, 12); ctx.fill()
          ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2; ctx.stroke()
          // ป้าย + เบอร์อยู่กึ่งกลางกรอบ (เจ้าของสั่ง 2026-11-15) — ความกว้างที่ fitOne ไว้ (chipW - 24) ยังเว้นขอบซ้าย-ขวา 12px เท่าเดิม
          drawText(ctx, chip.label.text, cx + chipW / 2, y + 38 + 13, { font: `600 ${chip.label.size}px ${body}`, color: DIM, align: 'center' })
          drawText(ctx, chip.number.text, cx + chipW / 2, y + 38 + 36, { font: `700 ${chip.number.size}px ${display}`, color: '#c4000f', align: 'center' })
        })
        // สติกเกอร์เอียง
        ctx.save()
        ctx.translate(MARGIN + CONTENT_W - 16 - stickW / 2, y + 22)
        ctx.rotate(-6 * Math.PI / 180)
        ctx.shadowColor = 'rgba(227,18,27,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8
        ctx.fillStyle = '#ffd400'
        rrPath(ctx, -stickW / 2, -34, stickW, 68, 14); ctx.fill()
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke()
        drawText(ctx, 'เตรียมพร้อม', 0, -12, { font: `700 25px ${display}`, color: '#1a0306', align: 'center' })
        drawText(ctx, 'รับมือไว้ก่อน', 0, 14, { font: `700 25px ${display}`, color: '#1a0306', align: 'center' })
        ctx.restore()
      },
    })
  }

  /* ── แถบล่าง (ชิดขอบล่าง) ── */
  const footInner = CONTENT_W
  const tags = model.footer.tags ? fitOne(ctx, model.footer.tags, body, 600, 320, 17, 12, issues, 'แฮชแท็ก') : null
  const location = fitOne(ctx, model.footer.location, display, 700, footInner - 38 - (tags ? tags.width + 24 : 0), 22, 14, issues, 'ที่ตั้ง')
  const paras = model.footer.lines.map(line => richLines(ctx, [{ t: line }], body, footInner, 14.5, 12, 3, issues, 'ท้ายภาพ'))
  const footLineH = 20
  const footLines = paras.reduce((s, p) => s + p.lines.length, 0)
  const footH = 8 + 12 + 30 + 4 + footLines * footLineH + 14
  const footTop = H - footH

  // เรียงบล็อก: ช่องว่างระหว่างบล็อกปรับตามที่เหลือ (4–18px) ไม่ให้ล้นแถบล่างหรือทิ้งช่องโหว่
  const top0 = heroBottom + 6
  // ล้นแม้ช่องว่างแคบสุด (4px) → ตัดประโยควิเคราะห์ท้ายสุดทีละประโยค (ย่อหน้าเปิดเดิมยังอยู่ครบ)
  const minBottom = () => top0 + stack.reduce((s, b) => s + b.h, 0) + 4 * (stack.length - 1)
  // ล้นแม้ช่องว่างแคบสุด → วาดใหม่ทั้งภาพแบบ tight ก่อน (บีบระยะเว้น ~34px ฟอนต์เท่าเดิม เบอร์โทรอยู่ครบ)
  // ยังล้นอีกค่อยตัดประโยควิเคราะห์ท้ายสุด (ข้อมูลเตือนสำคัญกว่าระยะเว้น จึงบีบระยะก่อนตัดประโยค)
  if (!tight && minBottom() > footTop - 4) {
    ctx.restore()
    return drawWaterAlertPoster(ctx, model, { fonts: { display, body }, logo, tight: true })
  }
  while (minBottom() > footTop - 4 && stack[introIndex].shown > 0) stack[introIndex] = introBlock(stack[introIndex].shown - 1)
  issues.push(...stack[introIndex].local)
  if (stack[introIndex].truncated) issues.push('คำอธิบาย: ยาวเกิน 3 บรรทัดแม้ไม่มีประโยควิเคราะห์')
  const analysisShown = stack[introIndex].shown
  const sumH = stack.reduce((s, b) => s + b.h, 0)
  const gapRaw = Math.floor((footTop - top0 - sumH - 8) / stack.length)
  const gap = Math.max(4, Math.min(18, gapRaw))
  let y = top0
  for (const block of stack) {
    block.paint(y)
    blocks.push({ name: block.name, y, h: block.h })
    y += block.h + gap
  }
  const contentBottom = y - gap
  const fits = contentBottom <= footTop - 4
  if (!fits) issues.push(`เนื้อหาล้นแถบล่าง ${Math.round(contentBottom)} > ${Math.round(footTop - 4)}`)

  // แถบล่าง
  ctx.fillStyle = '#0c0204'
  ctx.fillRect(0, footTop, W, footH)
  hazardStripe(ctx, 0, footTop, W, 8, 36)
  drawPin(ctx, MARGIN, footTop + 8 + 12 + 2, 28)
  drawText(ctx, location.text, MARGIN + 38, footTop + 8 + 12 + 16, { font: `700 ${location.size}px ${display}`, color: '#fff' })
  if (tags) drawText(ctx, tags.text, W - MARGIN, footTop + 8 + 12 + 16, { font: `600 ${tags.size}px ${body}`, color: '#ffb3a8', align: 'right' })
  let fy = footTop + 8 + 12 + 30 + 4
  paras.forEach(p => {
    drawRich(ctx, p.lines, MARGIN, fy, footLineH, p.size, body, { color: '#e9c9c4', emColor: '#e9c9c4', weight: 500 })
    fy += p.lines.length * footLineH
  })

  ctx.restore()
  return { issues, blocks, footTop, contentBottom, fits, gap, analysisShown, analysisTotal, tight }
}

/**
 * สร้างไฟล์ PNG 1080×1350 จาก model — คืน { blob, file, layout }
 * ตราโหลดไม่ได้ = ไม่มีตรา · ถ้า canvas สร้างไฟล์ไม่ได้ (toBlob ได้ null) โยน Error
 * @param {object} model ผลของ buildPosterModel
 * @param {{ logoUrl?: string | null }} [options]
 */
export async function renderWaterAlertPoster(model, { logoUrl = null } = {}) {
  const fonts = await preparePosterFonts()
  const logo = logoUrl ? await loadLogo(logoUrl) : null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  const layout = drawWaterAlertPoster(ctx, model, { fonts, logo })
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Cannot create PNG')
  const file = new File([blob], model.fileName || 'water-alert.png', { type: 'image/png' })
  return { blob, file, layout: { ...layout, width: canvas.width, height: canvas.height, logoLoaded: Boolean(logo), kanitLoaded: fonts.kanitLoaded } }
}
