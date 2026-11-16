// ตัวอ่านไฟล์ GIS / Google Earth ทุกรูปแบบสำหรับ "นำเข้า" ของศูนย์รวมข้อมูลดิจิทัล
// (KML, KMZ, GeoJSON, GPX, CSV, Shapefile .zip) — ล้วน ไม่แตะ React/Supabase รันใน node ได้ (ใช้ในเทสต์)
//
// ทำไมแยกออกมาจากหน้าจอ: parser เดิมอยู่ในโมดัลและอ่านได้แค่จุด/เส้นแบบพื้นฐาน
//  - ไฟล์ Google Earth จริงมี Folder ซ้อนหลายชั้น, MultiGeometry, Polygon, gx:Track, สีใน StyleMap ฯลฯ
//    ที่ตัวเดิมทิ้งหรืออ่านผิด (เช่น Polygon หมุดไปตกที่ "จุดกลางลำดับ" ของขอบเขต ไม่ใช่ใจกลางพื้นที่)
//  - โครง Folder ในไฟล์คือข้อมูลจัดหมวดที่เจ้าหน้าที่ทำไว้แล้ว ถ้าอ่านมาจัดหมวดให้อัตโนมัติ
//    คนก็แค่ตรวจตารางจับคู่ครั้งเดียว ไม่ต้องไล่แก้ทีละจุด (หลัก "ระบบทำเองก่อน คนตรวจ")
//
// กติกาที่เทสต์ล็อกไว้: ใช้เฉพาะ getElementsByTagName/childNodes/localName/getAttribute/textContent
// (ไม่ใช้ querySelector/innerHTML) เพื่อให้ @xmldom/xmldom ใน node อ่านได้เหมือนเบราว์เซอร์

import JSZip from 'jszip'
import { normalizeName, tidyName, mergeOptions, findOption } from './dataCenterPicker.js'

// ── ค่าคงที่ ─────────────────────────────────────────────────────────────────

// กรอบประเทศไทยแบบหยาบ — ไว้กันพิกัดสลับ lat/lng, ไฟล์ที่ไม่ใช่ WGS84 หรือไฟล์ของพื้นที่อื่นหลุดเข้าแผนที่ อปท.
export const THAILAND_BOUNDS = { latMin: 5, latMax: 21, lngMin: 97, lngMax: 106 }

export const MAX_ROUTE_POINTS = 500       // เกินนี้ลดจุดก่อนเก็บ (route_points เป็น jsonb ทุกแถว)
export const SIMPLIFY_TOLERANCE_M = 2     // ลดจุดโดยเส้นไม่เคลื่อนเกิน ~2 เมตร
export const DUPLICATE_METERS = 10
export const MAX_DESCRIPTION_CHARS = 4000
export const NO_FOLDER_KEY = '(ไม่มีโฟลเดอร์)'
export const DEFAULT_ROUTE_COLOR = '#3b82f6'
// เพดานกันเบราว์เซอร์ค้าง (อ่านทั้งไฟล์ในหน่วยความจำ) และกันฐานแผนฟรี 500 MB โตพรวดจากการนำเข้าครั้งเดียว
// ไฟล์ Google Earth ของ อปท. ทั้งตำบลปกติไม่ถึง 10 MB / ไม่กี่พันจุด — เกินนี้ให้แบ่งไฟล์นำเข้าเป็นรอบ
export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMPORT_ITEMS = 5000
export const MAX_PHOTOS_PER_ENTRY = 5     // เท่ากับฟอร์มเพิ่มข้อมูลเดิม (DataCenterEntryForm)
export const MAX_PHOTOS_PER_IMPORT = 300  // อัปโหลดทีละรูปผ่าน edge function ไฟล์ละ ~1–2 วินาที 300 รูปก็ราว 5 นาทีแล้ว

const EARTH_M_PER_DEG = 111320
const PLACEHOLDER_NAME = /^(untitled(\s+(placemark|path|polygon|line|point|feature))?(\s*\d+)?|ไม่มีชื่อ|unnamed)$/i

// ── ตัวช่วยตัวเลข/พิกัด ───────────────────────────────────────────────────────

const round7 = n => Math.round(n * 1e7) / 1e7

function validWgs84(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

function inThailand(lat, lng) {
  const b = THAILAND_BOUNDS
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax
}

export function haversineMeters(a, b) {
  const R = 6371008.8
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Douglas–Peucker (วนลูปด้วย stack ไม่ใช้ recursion — เส้นหลายหมื่นจุดไม่ล้น call stack)
// ฉายแบบ equirectangular เป็นเมตร พอสำหรับระดับตำบล
// ถ้าลดแล้วเหลือน้อยกว่า minPoints (เส้น 2 / พื้นที่ 4) คืนค่าเดิม — ไม่ปล่อยให้เส้นเหลือจุดเดียว
export function simplifyLine(points, toleranceM = SIMPLIFY_TOLERANCE_M, minPoints = 2) {
  const n = points.length
  if (n <= minPoints) return points
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / n
  const kx = EARTH_M_PER_DEG * Math.cos(lat0 * Math.PI / 180)
  const ky = EARTH_M_PER_DEG
  const xs = points.map(p => p.lng * kx)
  const ys = points.map(p => p.lat * ky)

  const distToSeg = (i, s, e) => {
    const dx = xs[e] - xs[s]
    const dy = ys[e] - ys[s]
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((xs[i] - xs[s]) * dx + (ys[i] - ys[s]) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(xs[i] - (xs[s] + t * dx), ys[i] - (ys[s] + t * dy))
  }

  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = 0
    let idx = -1
    for (let i = s + 1; i < e; i += 1) {
      const d = distToSeg(i, s, e)
      if (d > maxD) { maxD = d; idx = i }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  const out = points.filter((_, i) => keep[i])
  return out.length < minPoints ? points : out
}

function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i].lat, yj = ring[j].lat
    if ((yi > pt.lat) !== (yj > pt.lat)) {
      const x = ring[i].lng + (pt.lat - yi) * (ring[j].lng - ring[i].lng) / (yj - yi)
      if (pt.lng < x) inside = !inside
    }
  }
  return inside
}

// จุดกึ่งกลางพื้นที่ (centroid แบบถ่วงน้ำหนักด้วยพื้นที่)
// - พื้นที่ ~0 (เส้นตรง/จุดซ้อน) → ค่าเฉลี่ยของจุด
// - รูปเว้า centroid อาจหลุดออกนอกรูป → ใช้กลางช่วงที่กว้างสุดของเส้นตัดแนวนอน
//   เพื่อให้หมุดอยู่ "ในพื้นที่" จริงเสมอ (หมุดอยู่นอกแปลงทำให้ผู้ใช้คลิกแล้วไม่เห็นว่าหมายถึงที่ไหน)
export function polygonCentroid(ring) {
  const pts = ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat &&
    ring[0].lng === ring[ring.length - 1].lng ? ring.slice(0, -1) : ring.slice()
  const mean = () => ({
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  })
  if (pts.length < 3) return mean()

  // ลบจุดอ้างอิงออกก่อนคูณ เพื่อกันเลขใหญ่ลดความแม่นยำ
  const ox = pts[0].lng, oy = pts[0].lat
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length
    const xi = pts[i].lng - ox, yi = pts[i].lat - oy
    const xj = pts[j].lng - ox, yj = pts[j].lat - oy
    const cross = xi * yj - xj * yi
    a += cross
    cx += (xi + xj) * cross
    cy += (yi + yj) * cross
  }
  a /= 2
  if (Math.abs(a) < 1e-12) return mean()
  const c = { lat: oy + cy / (6 * a), lng: ox + cx / (6 * a) }
  if (pointInRing(c, pts)) return c

  const xsAt = []
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length
    const yi = pts[i].lat, yj = pts[j].lat
    if ((yi > c.lat) !== (yj > c.lat)) {
      xsAt.push(pts[i].lng + (c.lat - yi) * (pts[j].lng - pts[i].lng) / (yj - yi))
    }
  }
  xsAt.sort((p, q) => p - q)
  let best = null
  for (let i = 0; i + 1 < xsAt.length; i += 2) {
    if (!best || xsAt[i + 1] - xsAt[i] > best[1] - best[0]) best = [xsAt[i], xsAt[i + 1]]
  }
  return best ? { lat: c.lat, lng: (best[0] + best[1]) / 2 } : mean()
}

// จุดบนเส้นที่ระยะสะสมถึงครึ่งความยาว — หมุดของเส้นต้อง "อยู่บนเส้น" (ค่าเฉลี่ยจุดของเส้นโค้งหลุดออกนอกเส้น)
function lineMidpoint(pts) {
  let total = 0
  const cum = [0]
  for (let i = 1; i < pts.length; i += 1) {
    total += haversineMeters(pts[i - 1], pts[i])
    cum.push(total)
  }
  const half = total / 2
  let best = 0
  for (let i = 0; i < pts.length; i += 1) {
    if (Math.abs(cum[i] - half) < Math.abs(cum[best] - half)) best = i
  }
  return pts[best]
}

function closeRing(pts) {
  const first = pts[0], last = pts[pts.length - 1]
  if (first.lat === last.lat && first.lng === last.lng) return pts
  return [...pts, { lat: first.lat, lng: first.lng }]
}

// ── ตัวช่วย XML ──────────────────────────────────────────────────────────────

const lname = node => String(node.localName || node.nodeName || '').split(':').pop()

function childList(node) {
  const out = []
  const cn = node.childNodes
  if (!cn) return out
  for (let i = 0; i < cn.length; i += 1) {
    const c = cn[i] ?? cn.item?.(i)
    if (c && c.nodeType === 1) out.push(c)
  }
  return out
}

function childByName(node, name) {
  return childList(node).find(c => lname(c) === name) ?? null
}

function childText(node, name) {
  const c = childByName(node, name)
  return c ? String(c.textContent ?? '').trim() : ''
}

function parseXml(xmlText, opts = {}) {
  const Impl = opts.DOMParserImpl ?? globalThis.DOMParser
  if (!Impl) throw new Error('สภาพแวดล้อมนี้อ่านไฟล์ XML ไม่ได้ (ไม่มี DOMParser)')
  const clean = String(xmlText ?? '').replace(/^\uFEFF/, '').trimStart()
  let doc
  try {
    doc = new Impl().parseFromString(clean, 'text/xml')
  } catch {
    throw new Error('โครงสร้างไฟล์ไม่ถูกต้อง หรือไม่ใช่ XML ที่สมบูรณ์')
  }
  if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('โครงสร้างไฟล์ไม่ถูกต้อง หรือไม่ใช่ XML ที่สมบูรณ์')
  }
  return doc
}

// ── HTML → ข้อความ (คำอธิบายใน KML มักเป็น HTML) ─────────────────────────────
// ห้ามเอา HTML จากไฟล์ที่ผู้ใช้อัปโหลดไปฝังหน้า (XSS) จึงแปลงเป็นข้อความล้วนก่อนเก็บ

const BLOCK_TAGS = new Set(['br', 'p', 'div', 'tr', 'li', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return named[e.toLowerCase()] ?? m
  })
}

function tidyLines(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n') // บรรทัดว่างจากแท็กบล็อกซ้อนกัน (</tr><tr>) ไม่มีความหมาย ยุบให้เหลือขึ้นบรรทัดเดียว
    .trim()
}

export function htmlToText(html) {
  const src = String(html ?? '')
  if (!src.trim()) return ''
  if (!/[<&]/.test(src)) return tidyLines(src)

  if (typeof globalThis.DOMParser === 'function') {
    const doc = new globalThis.DOMParser().parseFromString(src, 'text/html')
    let out = ''
    const walk = node => {
      const cn = node.childNodes
      for (let i = 0; i < cn.length; i += 1) {
        const c = cn[i]
        if (c.nodeType === 3) {
          out += c.nodeValue
        } else if (c.nodeType === 1) {
          const tag = String(c.nodeName).toLowerCase()
          if (tag === 'script' || tag === 'style') continue
          const block = BLOCK_TAGS.has(tag)
          if (block) out += '\n'
          walk(c)
          if (block) out += '\n'
          else if (tag === 'td' || tag === 'th') out += ' '
        }
      }
    }
    walk(doc.body ?? doc)
    return tidyLines(out)
  }

  const text = src
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|ul|ol|table|h[1-6])\s*>/gi, '\n')
    .replace(/<(p|div|tr|li|ul|ol|table|h[1-6])(\s[^>]*)?>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
  return tidyLines(decodeEntities(text))
}

// ── สี KML (aabbggrr) → #rrggbb ──────────────────────────────────────────────
// KML เรียงสีกลับกับ CSS และมี alpha นำหน้า — ถ้าเอาไปใช้ตรงๆ เส้นสีแดงจะกลายเป็นสีน้ำเงิน
export function kmlColorToHex(value) {
  const s = String(value ?? '').trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{8}$/.test(s)) return `#${s.slice(6, 8)}${s.slice(4, 6)}${s.slice(2, 4)}`
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s.slice(4, 6)}${s.slice(2, 4)}${s.slice(0, 2)}`
  return null
}

// ── ตัวสะสมผลลัพธ์ ───────────────────────────────────────────────────────────

function createCollector() {
  return {
    items: [],
    skipped: { overlay: 0, model: 0, networkLink: 0, invalidCoord: 0, outsideThailand: 0, empty: 0 },
    columns: new Set(),
    warnings: [],
    utmWarned: false,
    // นับเฉพาะรูปของรายการที่ผ่านด่านพิกัดแล้วจริง (นับตอน push) — รายการที่ถูกข้ามไม่ทำให้ตัวเลขเกินจริง
    photos: { overLimit: 0, remote: 0, missing: 0 },
    readPhoto: null,
  }
}

function cleanName(raw) {
  const s = tidyName(raw)
  return PLACEHOLDER_NAME.test(s) ? '' : s
}

// ใส่รูปทรง 1 ชิ้นลงผล — ตรวจพิกัด/นอกประเทศ/ลดจุด ที่นี่ที่เดียวทุกรูปแบบไฟล์
function pushGeom(col, base, geom) {
  const raw = geom.coords
  const pts = []
  let bad = false
  for (const c of raw) {
    const lat = Number(c.lat)
    const lng = Number(c.lng)
    if (!validWgs84(lat, lng)) { bad = true; break }
    pts.push({ lat: round7(lat), lng: round7(lng) })
  }
  const needed = geom.shape === 'point' ? 1 : geom.shape === 'line' ? 2 : 3
  if (bad || pts.length < needed) {
    col.skipped.invalidCoord += 1
    // ค่าเกิน ±180 ส่วนใหญ่คือพิกัด UTM (หน่วยเมตร) — บอกสาเหตุให้ผู้ใช้ไปแปลงก่อน ไม่ใช่แค่ "พิกัดผิด"
    if (!col.utmWarned && raw.some(c => Math.abs(Number(c.lng)) > 180 || Math.abs(Number(c.lat)) > 90)) {
      col.utmWarned = true
      col.warnings.push('พบพิกัดที่มีค่าเกินช่วงละติจูด/ลองจิจูด (อาจเป็นระบบพิกัด UTM) — ระบบอ่านเฉพาะ WGS84 กรุณาแปลงไฟล์เป็น WGS84 ก่อน (ถ้าเป็น Shapefile ให้แนบไฟล์ .prj มาใน zip)')
    }
    return
  }

  let shape = geom.shape
  let latitude, longitude
  let route = null
  if (shape === 'point') {
    latitude = pts[0].lat
    longitude = pts[0].lng
  } else if (shape === 'line') {
    route = pts.length > MAX_ROUTE_POINTS ? simplifyLine(pts, SIMPLIFY_TOLERANCE_M, 2) : pts
    const m = lineMidpoint(route)
    latitude = m.lat
    longitude = m.lng
  } else {
    const ring = closeRing(pts)
    route = ring.length > MAX_ROUTE_POINTS ? simplifyLine(ring, SIMPLIFY_TOLERANCE_M, 4) : ring
    const c = polygonCentroid(route)
    latitude = round7(c.lat)
    longitude = round7(c.lng)
  }
  if (!inThailand(latitude, longitude)) {
    col.skipped.outsideThailand += 1
    return
  }

  const attributes = base.attributes ?? {}
  for (const k of Object.keys(attributes)) col.columns.add(k)
  col.items.push({
    key: `i${col.items.length}`,
    name: base.name ?? '',
    description: base.description ?? '',
    attributes,
    latitude,
    longitude,
    route_points: route,
    shape,
    route_color: base.route_color ?? null,
    folderPath: base.folderPath ?? [],
    groupHint: base.groupHint ?? '',
    categoryHint: base.categoryHint ?? '',
    photoRefs: base.photo?.refs ?? [],
  })
  if (base.photo) {
    col.photos.overLimit += base.photo.overLimit
    col.photos.remote += base.photo.remote
    col.photos.missing += base.photo.missing
  }
}

// หลายชิ้นจากแหล่งเดียว (MultiGeometry / Multi*) → "ชื่อ (ส่วนที่ n)"
function pushParts(col, base, geoms) {
  const baseName = cleanName(base.name)
  geoms.forEach((g, i) => {
    const name = geoms.length > 1 && baseName ? `${baseName} (ส่วนที่ ${i + 1})` : baseName
    pushGeom(col, { ...base, name }, g)
  })
}

// ชื่อว่าง/ชื่อเริ่มต้นของโปรแกรม → "<ประเภทย่อยจากโฟลเดอร์ หรือ สถานที่> ลำดับที่ n"
function finishResult(col) {
  const counters = new Map()
  for (const it of col.items) {
    if (it.name) continue
    const label = it.folderPath[it.folderPath.length - 1] || it.categoryHint || 'สถานที่'
    const n = (counters.get(label) ?? 0) + 1
    counters.set(label, n)
    it.name = `${label} ลำดับที่ ${n}`
  }
  return {
    items: col.items,
    skipped: col.skipped,
    columns: Array.from(col.columns),
    warnings: col.warnings,
    photos: { total: col.items.reduce((n, it) => n + it.photoRefs.length, 0), ...col.photos },
    // อ่านรูปจากไฟล์ต้นทางตอนอัปโหลดจริง (KMZ เท่านั้น) — ไม่เก็บ blob ทุกรูปไว้ใน state ให้กินหน่วยความจำ
    readPhoto: col.readPhoto,
  }
}

// ── KML ──────────────────────────────────────────────────────────────────────

function parseCoordinateList(text) {
  const out = []
  const tokens = String(text ?? '').replace(/,\s+/g, ',').trim().split(/\s+/)
  for (const t of tokens) {
    if (!t) continue
    const p = t.split(',')
    out.push({ lng: parseFloat(p[0]), lat: parseFloat(p[1]) })
  }
  return out
}

function parseTrackCoords(trackNode) {
  const out = []
  for (const c of childList(trackNode)) {
    if (lname(c) !== 'coord') continue
    const p = String(c.textContent ?? '').trim().split(/\s+/)
    out.push({ lng: parseFloat(p[0]), lat: parseFloat(p[1]) })
  }
  return out
}

function collectKmlGeoms(node, out, counters) {
  for (const c of childList(node)) {
    switch (lname(c)) {
      case 'Point': {
        const pts = parseCoordinateList(childText(c, 'coordinates'))
        out.push({ shape: 'point', coords: pts.slice(0, 1) })
        break
      }
      case 'LineString':
      case 'LinearRing':
        out.push({ shape: 'line', coords: parseCoordinateList(childText(c, 'coordinates')) })
        break
      case 'Polygon': {
        const outer = childByName(c, 'outerBoundaryIs')
        const ring = outer ? childByName(outer, 'LinearRing') : null
        out.push({ shape: 'polygon', coords: ring ? parseCoordinateList(childText(ring, 'coordinates')) : [] })
        break
      }
      case 'Track':
        out.push({ shape: 'line', coords: parseTrackCoords(c) })
        break
      case 'MultiTrack':
      case 'MultiGeometry':
        collectKmlGeoms(c, out, counters)
        break
      case 'Model':
        counters.model += 1
        break
      default:
        break
    }
  }
}

function buildStyleIndex(doc) {
  const styles = new Map()
  const maps = new Map()
  const grab = (tag, into) => {
    const list = doc.getElementsByTagName(tag)
    for (let i = 0; i < list.length; i += 1) {
      const id = list[i].getAttribute('id')
      if (id) into.set(id, list[i])
    }
  }
  grab('Style', styles)
  grab('StyleMap', maps)
  return { styles, maps }
}

// Style → StyleMap(pair key=normal) → Style, ไล่ตามลิงก์ styleUrl ได้ไม่เกิน 4 ชั้นกันวนลูป
function resolveStyleNode(node, idx, depth = 0) {
  if (!node || depth > 4) return null
  const name = lname(node)
  if (name === 'Style') return node
  if (name === 'StyleMap') {
    const pairs = childList(node).filter(c => lname(c) === 'Pair')
    const normal = pairs.find(p => childText(p, 'key') === 'normal') ?? pairs[0]
    if (!normal) return null
    const inline = childByName(normal, 'Style')
    if (inline) return inline
    return resolveStyleUrl(childText(normal, 'styleUrl'), idx, depth + 1)
  }
  return null
}

function resolveStyleUrl(url, idx, depth = 0) {
  const id = String(url ?? '').trim().replace(/^.*#/, '')
  if (!id) return null
  return resolveStyleNode(idx.styles.get(id) ?? idx.maps.get(id) ?? null, idx, depth)
}

function placemarkStyle(pm, idx) {
  const inline = childByName(pm, 'Style')
  if (inline) return inline
  const inlineMap = childByName(pm, 'StyleMap')
  if (inlineMap) return resolveStyleNode(inlineMap, idx)
  return resolveStyleUrl(childText(pm, 'styleUrl'), idx)
}

function styleColor(style, shape) {
  if (!style || shape === 'point') return null
  const colorOf = tag => {
    const s = childByName(style, tag)
    return s ? kmlColorToHex(childText(s, 'color')) : null
  }
  return shape === 'polygon' ? (colorOf('PolyStyle') ?? colorOf('LineStyle')) : colorOf('LineStyle')
}

// gx_media_links = ลิงก์รูปภายนอกที่ Google My Maps ใส่มาให้ — ไม่ใช่ข้อมูลของสถานที่ จึงไม่เอาลง attributes
// (ไม่งั้นกลายเป็นคอลัมน์ให้ติ๊กเก็บ แล้ว URL ยาวๆ ไปลงรายละเอียดบนแผนที่สาธารณะ) ส่งแยกไปนับเป็นรูปภายนอก
function readExtendedData(pm) {
  const attrs = {}
  const mediaLinks = []
  const ext = childByName(pm, 'ExtendedData')
  if (!ext) return { attrs, mediaLinks }
  const put = (k, v) => {
    const key = tidyName(k)
    const val = String(v ?? '').trim()
    if (!key || !val) return
    if (key.toLowerCase() === 'gx_media_links') mediaLinks.push(...val.split(/[\s,]+/).filter(Boolean))
    else attrs[key] = val
  }
  for (const c of childList(ext)) {
    const n = lname(c)
    if (n === 'Data') {
      put(c.getAttribute('name'), childText(c, 'value'))
    } else if (n === 'SchemaData') {
      for (const s of childList(c)) {
        if (lname(s) === 'SimpleData') put(s.getAttribute('name'), s.textContent)
      }
    }
  }
  return { attrs, mediaLinks }
}

// ── รูปที่แนบใน KMZ ──────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i
const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

// อ่าน src ของ <img> จาก HTML ดิบ — ต้องทำ "ก่อน" htmlToText เพราะแปลงเป็นข้อความแล้วแท็กหายหมด
export function extractImgSrcs(html) {
  const out = []
  const re = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  const text = String(html ?? '')
  let m
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (raw) out.push(decodeEntities(raw))
  }
  return out
}

const normKey = p => String(p).normalize('NFC').toLowerCase()

// ดัชนีรูปใน zip: ชื่อ (NFC + ตัวพิมพ์เล็ก) → ชื่อจริงใน zip — Google Earth บน Windows/Mac ไม่สนตัวพิมพ์ แต่ zip สนตัวพิมพ์
export function buildZipImageIndex(names) {
  const idx = new Map()
  for (const n of names) {
    if (!IMAGE_EXT.test(n) || n.includes('__MACOSX') || n.endsWith('/')) continue
    const k = normKey(n)
    if (!idx.has(k)) idx.set(k, n)
  }
  return idx
}

export function isRemoteSrc(src) {
  const s = String(src).trim()
  return /^(https?:)?\/\//i.test(s) || /^data:/i.test(s)
}

// แปลง src ใน description เป็นชื่อไฟล์จริงใน zip — คืน null ถ้าหาไม่เจอ/ไม่ปลอดภัย
// - ตัด ./ นำหน้า, query/hash, ถอด %20/ไทยที่ encode (ห่อ try: % เดี่ยวๆ ทำ decodeURIComponent โยน error)
// - resolve เทียบโฟลเดอร์ของ .kml; ".." ที่พาออกนอก zip = ปฏิเสธ (ไฟล์ผู้ใช้อัปโหลดมา ห้ามเดินออกนอกกล่อง)
export function resolveZipImagePath(src, kmlDir, zipIndex) {
  let s = String(src ?? '').trim()
  if (!s || isRemoteSrc(s) || /^[a-z][a-z0-9+.-]*:/i.test(s)) return null
  s = s.replace(/[?#].*$/, '').replace(/\\/g, '/')
  try { s = decodeURIComponent(s) } catch { /* คงตามเดิม */ }
  const parts = s.startsWith('/') ? [] : String(kmlDir ?? '').split('/').filter(Boolean)
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(seg)
  }
  if (parts.length === 0) return null
  return zipIndex?.get(normKey(parts.join('/'))) ?? null
}

// รวมรูปของ Placemark เดียว: ไม่ซ้ำ ไม่เกิน MAX_PHOTOS_PER_ENTRY ที่เหลือนับ overLimit
// รูปภายนอก (http) กับ gx_media_links ที่ชี้ URL เดียวกันนับครั้งเดียว
function collectPhotos(rawDescription, mediaLinks, ctx) {
  const found = new Set()
  const remote = new Set()
  const missing = new Set()
  const names = [] // ข้อความที่อาจค้างในคำอธิบาย (ไว้ตัดทิ้ง)
  for (const src of extractImgSrcs(rawDescription)) {
    if (isRemoteSrc(src)) { remote.add(src); continue }
    const path = ctx ? resolveZipImagePath(src, ctx.kmlDir, ctx.zipIndex) : null
    if (path) { found.add(path); names.push(src, path, path.split('/').pop()) } else missing.add(normKey(src))
  }
  for (const u of mediaLinks ?? []) remote.add(u)
  const all = Array.from(found)
  return {
    refs: all.slice(0, MAX_PHOTOS_PER_ENTRY),
    overLimit: Math.max(0, all.length - MAX_PHOTOS_PER_ENTRY),
    remote: remote.size,
    missing: missing.size,
    names,
  }
}

// ชื่อไฟล์รูปที่หลุดมาเป็นบรรทัดข้อความเปล่าๆ (เช่น alt/ลิงก์ที่มีแค่ชื่อไฟล์) ไม่มีประโยชน์ต่อคนอ่าน — ตัดบรรทัดนั้นทิ้ง
function stripPhotoNames(text, names) {
  if (!text || names.length === 0) return text
  const set = new Set(names.map(n => normKey(tidyName(n))))
  return text.split('\n').filter(l => !set.has(normKey(tidyName(l)))).join('\n').trim()
}

export function parseKml(xmlText, opts = {}) {
  const doc = parseXml(xmlText, opts)
  const idx = buildStyleIndex(doc)
  const col = createCollector()

  const handlePlacemark = (pm, folderPath) => {
    const geoms = []
    const counters = { model: 0 }
    collectKmlGeoms(pm, geoms, counters)
    col.skipped.model += counters.model
    if (geoms.length === 0) {
      if (counters.model === 0) col.skipped.empty += 1
      return
    }
    const style = placemarkStyle(pm, idx)
    const rawDesc = childText(pm, 'description')
    const ext = readExtendedData(pm)
    const photo = collectPhotos(rawDesc, ext.mediaLinks, opts.photoCtx)
    const base = {
      name: childText(pm, 'name'),
      description: stripPhotoNames(htmlToText(rawDesc), photo.names),
      attributes: ext.attrs,
      folderPath,
    }
    // สีผูกกับชนิดรูปทรงของแต่ละชิ้น (เส้นใช้ LineStyle พื้นที่ใช้ PolyStyle)
    const baseName = cleanName(base.name)
    geoms.forEach((g, i) => {
      const name = geoms.length > 1 && baseName ? `${baseName} (ส่วนที่ ${i + 1})` : baseName
      // MultiGeometry ที่แตกเป็นหลายส่วน ให้รูปติดแค่ส่วนที่ 1 — ไม่งั้นรูปเดียวถูกอัปโหลดซ้ำทุกแถว
      pushGeom(col, { ...base, name, route_color: styleColor(style, g.shape), photo: i === 0 ? photo : null }, g)
    })
  }

  const walk = (node, folderPath) => {
    for (const c of childList(node)) {
      switch (lname(c)) {
        case 'kml':
        case 'Document':
          walk(c, folderPath)
          break
        case 'Folder': {
          const nm = tidyName(childText(c, 'name'))
          walk(c, nm ? [...folderPath, nm] : folderPath)
          break
        }
        case 'Placemark':
          handlePlacemark(c, folderPath)
          break
        case 'GroundOverlay':
        case 'PhotoOverlay':
        case 'ScreenOverlay':
          col.skipped.overlay += 1
          break
        case 'NetworkLink':
          col.skipped.networkLink += 1
          break
        default:
          break
      }
    }
  }
  walk(doc, [])
  return finishResult(col)
}

function pickKmlFromZip(zip) {
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && !n.includes('__MACOSX'))
  const top = names.filter(n => !n.includes('/') && n.toLowerCase().endsWith('.kml'))
  return top.find(n => n.toLowerCase() === 'doc.kml') ?? top[0] ?? null
}

export async function parseKmz(data, opts = {}) {
  const zip = await JSZip.loadAsync(data)
  const name = pickKmlFromZip(zip)
  if (!name) throw new Error('ไม่พบไฟล์ .kml ภายในไฟล์ KMZ นี้')
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir)
  const zipIndex = buildZipImageIndex(names)
  const kmlDir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''
  const result = parseKml(await zip.files[name].async('string'), { ...opts, photoCtx: { kmlDir, zipIndex } })
  result.readPhoto = async ref => {
    const entry = zip.files[ref]
    if (!entry || !IMAGE_EXT.test(ref)) throw new Error('ไม่พบรูปในไฟล์ KMZ')
    const bytes = await entry.async('uint8array')
    const fileName = ref.split('/').pop()
    const ext = fileName.split('.').pop().toLowerCase()
    return new File([bytes], fileName, { type: IMAGE_MIME[ext] ?? 'application/octet-stream' })
  }
  return result
}

// ── GeoJSON (และผลจาก Shapefile) ─────────────────────────────────────────────

const NAME_KEYS = ['name', 'title', 'ชื่อ', 'ชื่อสถานที่']
const DESC_KEYS = ['description', 'desc', 'remark', 'รายละเอียด', 'หมายเหตุ']
const GROUP_KEYS = ['group_name', 'group', 'กลุ่ม', 'กลุ่มหลัก']
const CATEGORY_KEYS = ['category', 'type', 'ประเภท', 'ประเภทย่อย']
const COLOR_KEYS = ['route_color', 'stroke']

// หาค่าจากชื่อคอลัมน์โดยไม่สนตัวพิมพ์ — คืน { value, key } เพื่อรู้ว่าคอลัมน์ไหนถูกใช้แล้ว (ไม่ซ้ำลงรายการเก็บ)
function pickProp(props, keys) {
  const wanted = new Set(keys)
  for (const k of Object.keys(props)) {
    if (!wanted.has(k.trim().toLowerCase())) continue
    const v = props[k]
    if (v === null || v === undefined || typeof v === 'object') continue
    const s = String(v).trim()
    if (s) return { value: s, key: k }
  }
  return { value: '', key: null }
}

function propsToAttributes(props, usedKeys) {
  const out = {}
  for (const [k, v] of Object.entries(props)) {
    if (usedKeys.has(k)) continue
    if (v === null || v === undefined) continue
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v).trim()
    const key = tidyName(k)
    if (key && s) out[key] = s
  }
  return out
}

const pos = c => ({ lng: Number(Array.isArray(c) ? c[0] : NaN), lat: Number(Array.isArray(c) ? c[1] : NaN) })
const posList = list => (Array.isArray(list) ? list.map(pos) : [])

function geojsonParts(geometry, out = []) {
  if (!geometry || typeof geometry !== 'object') return out
  const { type, coordinates, geometries } = geometry
  switch (type) {
    case 'Point':
      out.push({ shape: 'point', coords: [pos(coordinates)] })
      break
    case 'MultiPoint':
      for (const c of Array.isArray(coordinates) ? coordinates : []) out.push({ shape: 'point', coords: [pos(c)] })
      break
    case 'LineString':
      out.push({ shape: 'line', coords: posList(coordinates) })
      break
    case 'MultiLineString':
      for (const l of Array.isArray(coordinates) ? coordinates : []) out.push({ shape: 'line', coords: posList(l) })
      break
    case 'Polygon':
      out.push({ shape: 'polygon', coords: posList(Array.isArray(coordinates) ? coordinates[0] : []) })
      break
    case 'MultiPolygon':
      for (const p of Array.isArray(coordinates) ? coordinates : []) {
        out.push({ shape: 'polygon', coords: posList(Array.isArray(p) ? p[0] : []) })
      }
      break
    case 'GeometryCollection':
      for (const g of Array.isArray(geometries) ? geometries : []) geojsonParts(g, out)
      break
    default:
      break
  }
  return out
}

function addGeoJsonInto(col, obj, folderPath = []) {
  const features = []
  const collect = o => {
    if (!o || typeof o !== 'object') return
    if (o.type === 'FeatureCollection') (o.features ?? []).forEach(collect)
    else if (o.type === 'Feature') features.push(o)
    else if (o.type) features.push({ type: 'Feature', geometry: o, properties: {} })
  }
  if (Array.isArray(obj)) obj.forEach(collect)
  else collect(obj)

  for (const f of features) {
    const parts = geojsonParts(f.geometry)
    if (parts.length === 0) { col.skipped.empty += 1; continue }
    const props = f.properties && typeof f.properties === 'object' ? f.properties : {}
    const nameP = pickProp(props, NAME_KEYS)
    const descP = pickProp(props, DESC_KEYS)
    const groupP = pickProp(props, GROUP_KEYS)
    const catP = pickProp(props, CATEGORY_KEYS)
    const colorP = pickProp(props, COLOR_KEYS)
    const used = new Set([nameP.key, descP.key, groupP.key, catP.key, colorP.key].filter(Boolean))
    pushParts(col, {
      name: nameP.value,
      description: descP.value,
      attributes: propsToAttributes(props, used),
      folderPath,
      groupHint: tidyName(groupP.value),
      categoryHint: tidyName(catP.value),
      route_color: /^#[0-9a-f]{6}$/i.test(colorP.value) ? colorP.value.toLowerCase() : null,
    }, parts)
  }
}

export function parseGeoJson(input) {
  let obj = input
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input.replace(/^\uFEFF/, ''))
    } catch {
      throw new Error('ไฟล์ GeoJSON ไม่ถูกต้อง (อ่านเป็น JSON ไม่ได้)')
    }
  }
  const col = createCollector()
  addGeoJsonInto(col, obj, [])
  return finishResult(col)
}

// ── GPX ──────────────────────────────────────────────────────────────────────

export function parseGpx(xmlText, opts = {}) {
  const doc = parseXml(xmlText, opts)
  const col = createCollector()
  const root = doc.documentElement

  const meta = node => {
    const desc = childText(node, 'desc')
    const cmt = childText(node, 'cmt')
    return {
      name: childText(node, 'name'),
      description: [desc, cmt].filter(Boolean).join('\n'),
      categoryHint: tidyName(childText(node, 'type')),
    }
  }
  const ptOf = n => ({ lat: parseFloat(n.getAttribute('lat')), lng: parseFloat(n.getAttribute('lon')) })

  for (const c of childList(root)) {
    const kind = lname(c)
    if (kind === 'wpt') {
      pushParts(col, { ...meta(c), attributes: {} }, [{ shape: 'point', coords: [ptOf(c)] }])
    } else if (kind === 'trk') {
      const segs = childList(c).filter(s => lname(s) === 'trkseg')
        .map(s => ({ shape: 'line', coords: childList(s).filter(p => lname(p) === 'trkpt').map(ptOf) }))
      if (segs.length === 0) { col.skipped.empty += 1; continue }
      pushParts(col, { ...meta(c), attributes: {} }, segs)
    } else if (kind === 'rte') {
      const coords = childList(c).filter(p => lname(p) === 'rtept').map(ptOf)
      if (coords.length === 0) { col.skipped.empty += 1; continue }
      pushParts(col, { ...meta(c), attributes: {} }, [{ shape: 'line', coords }])
    }
  }
  return finishResult(col)
}

// ── CSV ──────────────────────────────────────────────────────────────────────

// RFC4180: ฟิลด์ขึ้นต้นด้วย " ได้ มี "" แทน " และขึ้นบรรทัดใหม่ในฟิลด์ได้ — ตัวเดิมตัดที่ ' กับ " ทิ้งหมด ชื่อที่มีเครื่องหมายคำพูดเพี้ยน
function parseDelimited(text, delim) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let fieldStart = true
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && fieldStart) { quoted = true; fieldStart = false }
    else if (ch === delim) { row.push(field); field = ''; fieldStart = true }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldStart = true
    } else { field += ch; fieldStart = false }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

function guessDelimiter(text) {
  const head = text.split(/\r?\n/).find(l => l.trim() !== '') ?? ''
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let q = false
  for (const ch of head) {
    if (ch === '"') q = !q
    else if (!q && ch in counts) counts[ch] += 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ','
}

const CSV_LAT = ['lat', 'latitude', 'ละติจูด']
const CSV_LNG = ['lng', 'lon', 'long', 'longitude', 'ลองจิจูด']

export function parseCsv(csvText) {
  const text = String(csvText ?? '').replace(/^\uFEFF/, '')
  const delim = guessDelimiter(text)
  const rows = parseDelimited(text, delim)
  if (rows.length < 2) throw new Error('ไฟล์ CSV ไม่มีข้อมูลเพียงพอ (ต้องมีบรรทัดหัวตารางและอย่างน้อย 1 แถว)')

  const headers = rows[0].map(h => h.trim())
  const keyOf = h => h.toLowerCase()
  const find = list => headers.findIndex(h => list.includes(keyOf(h)))
  const latIdx = find(CSV_LAT)
  const lngIdx = find(CSV_LNG)
  if (latIdx === -1 || lngIdx === -1) {
    throw new Error('ไม่พบคอลัมน์ละติจูด/ลองจิจูดใน CSV (ต้องมีหัวคอลัมน์ lat และ lng หรือ ละติจูด และ ลองจิจูด)')
  }
  const nameIdx = find(NAME_KEYS)
  const descIdx = find(DESC_KEYS)
  const groupIdx = find(GROUP_KEYS)
  const catIdx = find(CATEGORY_KEYS)
  const used = new Set([latIdx, lngIdx, nameIdx, descIdx, groupIdx, catIdx])

  // ไฟล์ที่ใช้ ; หรือ tab ในไทย/ยุโรปมักเขียนทศนิยมเป็นจุลภาค (13,75) — แปลงให้เมื่อไม่ได้ใช้ , เป็นตัวคั่น
  const num = s => {
    const t = String(s ?? '').trim()
    return parseFloat(delim === ',' ? t : t.replace(',', '.'))
  }

  const col = createCollector()
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]
    const latRaw = String(cells[latIdx] ?? '').trim()
    const lngRaw = String(cells[lngIdx] ?? '').trim()
    if (!latRaw && !lngRaw) { col.skipped.empty += 1; continue }
    const attributes = {}
    headers.forEach((h, i) => {
      if (used.has(i) || !h) return
      const v = String(cells[i] ?? '').trim()
      if (v) attributes[h] = v
    })
    pushParts(col, {
      name: nameIdx === -1 ? '' : cells[nameIdx] ?? '',
      description: descIdx === -1 ? '' : String(cells[descIdx] ?? '').trim(),
      attributes,
      groupHint: groupIdx === -1 ? '' : tidyName(cells[groupIdx]),
      categoryHint: catIdx === -1 ? '' : tidyName(cells[catIdx]),
    }, [{ shape: 'point', coords: [{ lat: num(latRaw), lng: num(lngRaw) }] }])
  }
  return finishResult(col)
}

// ── Shapefile (.zip ที่มี .shp/.dbf/.prj) ────────────────────────────────────

function geojsonHasProjectedCoords(obj) {
  let found = false
  const scan = c => {
    if (found || !Array.isArray(c)) return
    if (typeof c[0] === 'number') {
      if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) found = true
      return
    }
    c.forEach(scan)
  }
  const visit = g => {
    if (!g || found) return
    if (g.type === 'GeometryCollection') (g.geometries ?? []).forEach(visit)
    else scan(g.coordinates)
  }
  const layers = Array.isArray(obj) ? obj : [obj]
  for (const l of layers) (l?.features ?? []).forEach(f => visit(f?.geometry))
  return found
}

// แปลงผลจาก shpjs (GeoJSON 1 ชั้น หรืออาร์เรย์ของหลายชั้น) เป็นผลนำเข้า — แยกออกมาให้เทสต์ได้โดยไม่ต้องมีไฟล์ .shp จริง
// หลายชั้น → ใช้ชื่อชั้นเป็นโฟลเดอร์ (ชั้นเดียวไม่ใส่ เพื่อให้ hint จากคอลัมน์ในตารางใช้งานได้)
export function shapefileGeoJsonToResult(geojson, { hasPrj = true } = {}) {
  if (!hasPrj && geojsonHasProjectedCoords(geojson)) {
    throw new Error('พิกัดใน Shapefile นี้ไม่ใช่ละติจูด/ลองจิจูด — ต้องใส่ไฟล์ .prj มาใน zip ด้วย (ไฟล์ที่บอกระบบพิกัด) ระบบจึงจะแปลงเป็นพิกัด GPS ให้ได้')
  }
  const layers = Array.isArray(geojson) ? geojson : [geojson]
  const col = createCollector()
  for (const layer of layers) {
    const layerName = tidyName(String(layer?.fileName ?? '').split('/').pop())
    addGeoJsonInto(col, layer, layers.length > 1 && layerName ? [layerName] : [])
  }
  return finishResult(col)
}

// opts.parseZip ใช้แทน shpjs ในเทสต์ — ของจริง import แบบ dynamic เฉพาะตอนผู้ใช้เลือกไฟล์ .zip
// เพื่อไม่ให้ shpjs + proj4 (ใหญ่กว่า parser อื่นรวมกัน) ติดไปกับบันเดิลหลักของทุกหน้า
export async function parseZipArchive(data, opts = {}) {
  const zip = await JSZip.loadAsync(data)
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && !n.includes('__MACOSX'))
  const has = ext => names.some(n => n.toLowerCase().endsWith(ext))

  if (has('.shp')) {
    let parseZip = opts.parseZip
    if (!parseZip) {
      const mod = await import('shpjs')
      parseZip = mod.parseZip ?? mod.default
    }
    let geojson
    try {
      const buf = data instanceof ArrayBuffer ? data : await zip.generateAsync({ type: 'arraybuffer' })
      geojson = await parseZip(buf)
    } catch (err) {
      throw new Error(`อ่านไฟล์ Shapefile ไม่สำเร็จ: ${err?.message ?? err}`, { cause: err })
    }
    return shapefileGeoJsonToResult(geojson, { hasPrj: has('.prj') })
  }

  const readAs = async (ext, parse) => {
    const n = names.find(x => x.toLowerCase().endsWith(ext))
    return parse(await zip.files[n].async('string'))
  }
  if (has('.kml')) {
    const kml = pickKmlFromZip(zip) ?? names.find(n => n.toLowerCase().endsWith('.kml'))
    return parseKml(await zip.files[kml].async('string'), opts)
  }
  if (has('.geojson')) return readAs('.geojson', parseGeoJson)
  if (has('.gpx')) return readAs('.gpx', t => parseGpx(t, opts))
  if (has('.csv')) return readAs('.csv', parseCsv)
  if (has('.json')) return readAs('.json', parseGeoJson)
  throw new Error('ไม่พบไฟล์ที่รองรับใน zip (ต้องมี .shp พร้อม .dbf และ .prj หรือไฟล์ .kml/.geojson)')
}

// ── ทางเข้าเดียวจากหน้าจอ ────────────────────────────────────────────────────

// ไฟล์ CSV จาก Excel ภาษาไทยมักเป็น Windows-874 ไม่ใช่ UTF-8 — ถอดแบบเข้มก่อน ไม่ผ่านค่อยลอง 874
// ไม่งั้นชื่อสถานที่ไทยกลายเป็นตัวถามทั้งไฟล์
function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    try {
      return new TextDecoder('windows-874').decode(buffer)
    } catch {
      return new TextDecoder('utf-8').decode(buffer)
    }
  }
}

export async function parseGisFile(file, opts = {}) {
  const name = String(file?.name ?? '').toLowerCase()
  if (Number(file?.size) > MAX_FILE_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกิน ${MAX_FILE_BYTES / 1024 / 1024} MB — แบ่งโฟลเดอร์ใน Google Earth แล้วส่งออกทีละส่วน`)
  }
  const buf = await file.arrayBuffer()
  if (name.endsWith('.kml')) return parseKml(decodeText(buf), opts)
  if (name.endsWith('.kmz')) return parseKmz(buf, opts)
  if (name.endsWith('.geojson') || name.endsWith('.json')) return parseGeoJson(decodeText(buf))
  if (name.endsWith('.gpx')) return parseGpx(decodeText(buf), opts)
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCsv(decodeText(buf))
  if (name.endsWith('.zip')) return parseZipArchive(buf, opts)
  if (name.endsWith('.shp')) {
    throw new Error('Shapefile ประกอบด้วยหลายไฟล์ — ให้บีบ .shp พร้อม .dbf และ .prj เป็นไฟล์ .zip ไฟล์เดียวแล้วเลือกไฟล์ .zip')
  }
  throw new Error('รูปแบบไฟล์ไม่รองรับ (รองรับ .kml .kmz .geojson .json .gpx .csv .txt .zip)')
}

// ── จัดหมวดจากโฟลเดอร์ ───────────────────────────────────────────────────────

// รายการตัวเลือกหมวดจาก summary.groups ของ RPC data_center_summary:
// groups = [{ group_name, total, categories: [{ category, total }] }]
// ค่า "ดิบ" จากฐานเก็บไว้ตามเดิม (ห้ามเอา tidyName ทับ — ดูหมายเหตุใน dataCenterPicker.mergeOptions)
export function buildCatalog(summary, seedGroups = []) {
  const groups = (summary?.groups ?? [])
    .filter(g => normalizeName(g?.group_name))
    .map(g => ({
      value: g.group_name,
      count: Number(g.total) || 0,
      categories: mergeOptions((g.categories ?? []).map(c => ({ value: c.category, count: Number(c.total) || 0 }))),
    }))
  const dbGroupOptions = mergeOptions(groups.map(g => ({ value: g.value, count: g.count })))
  const groupOptions = mergeOptions(dbGroupOptions, (seedGroups ?? []).map(v => ({ value: v, count: 0 })))
  const categoryOwners = new Map() // ชื่อประเภท (normalize) → รายชื่อกลุ่มดิบที่มีประเภทนี้
  for (const g of groups) {
    for (const c of g.categories) {
      const k = normalizeName(c.value)
      if (!categoryOwners.has(k)) categoryOwners.set(k, [])
      categoryOwners.get(k).push(g.value)
    }
  }
  return { groups, dbGroupOptions, groupOptions, categoryOwners }
}

// จับคู่ข้อความที่พิมพ์/อ่านมา กับของเดิม — ตรงแล้วคืนค่าดิบจากฐาน ไม่ตรงคืนชื่อที่ตัดช่องว่างแล้ว + isNew
export function resolvePair(catalog, groupText, categoryText) {
  const g = tidyName(groupText)
  const c = tidyName(categoryText)
  const dbGroup = g ? findOption(catalog.dbGroupOptions, g) : null
  const seedGroup = g && !dbGroup ? findOption(catalog.groupOptions, g) : null
  const group = dbGroup?.value ?? seedGroup?.value ?? g
  const groupIsNew = !!g && !dbGroup

  let category = c
  let categoryIsNew = !!c
  if (c && dbGroup) {
    const entry = catalog.groups.find(x => normalizeName(x.value) === normalizeName(dbGroup.value))
    const hit = entry ? findOption(entry.categories, c) : null
    if (hit) { category = hit.value; categoryIsNew = false }
  }
  return { group, category, groupIsNew, categoryIsNew, isNew: groupIsNew || categoryIsNew }
}

export function folderKeyOf(item) {
  if (item.folderPath?.length) return item.folderPath.join(' › ')
  const hints = [item.groupHint, item.categoryHint].filter(Boolean)
  return hints.length ? `${NO_FOLDER_KEY} › ${hints.join(' › ')}` : NO_FOLDER_KEY
}

// รวมรายการเป็น "แถวของโฟลเดอร์" สำหรับตารางจับคู่ — เรียงตามลำดับที่พบในไฟล์
export function groupByFolder(items) {
  const map = new Map()
  for (const it of items) {
    const key = folderKeyOf(it)
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        folderPath: it.folderPath ?? [],
        groupHint: it.folderPath?.length ? '' : it.groupHint ?? '',
        categoryHint: it.folderPath?.length ? '' : it.categoryHint ?? '',
        counts: { point: 0, line: 0, polygon: 0 },
        itemKeys: [],
      }
      map.set(key, g)
    }
    g.counts[it.shape] += 1
    g.itemKeys.push(it.key)
  }
  return Array.from(map.values())
}

// เสนอกลุ่ม/ประเภทให้แต่ละโฟลเดอร์ตามกฎตรงไปตรงมา (อธิบายและตรวจย้อนได้ ไม่ใช้ AI):
//  1) โฟลเดอร์ ≥ 2 ชั้น: บนสุด = กลุ่มหลัก ในสุด = ประเภทย่อย
//  2) 1 ชั้น: ชื่อ = ประเภทย่อย; ถ้าประเภทนี้มีใต้กลุ่มเดียวในระบบ → เติมกลุ่มให้
//     ถ้าชื่อตรงกับกลุ่มหลักที่มี → เป็นกลุ่มหลัก ประเภทว่างรอค่าเริ่มต้น
//  3) ไม่มีโฟลเดอร์: ใช้ hint จากคอลัมน์ในไฟล์ ไม่มีค่อยใช้ค่าเริ่มต้นของไฟล์
// folderKeyList = ผลของ groupByFolder(items) → คืน { [key]: { group, category, groupIsNew, categoryIsNew, isNew } }
// ค่าว่าง ('') = ยังไม่มีหมวด ให้เจ้าหน้าที่กรอกในตาราง
export function suggestMapping(folderKeyList, summary, seedGroups = [], fileDefaults = {}) {
  const catalog = buildCatalog(summary, seedGroups)
  const defGroup = tidyName(fileDefaults.group)
  const defCategory = tidyName(fileDefaults.category)
  const out = {}

  for (const f of folderKeyList) {
    let groupText
    let categoryText
    const path = f.folderPath ?? []

    if (path.length >= 2) {
      groupText = path[0]
      categoryText = path[path.length - 1]
    } else if (path.length === 1) {
      const name = path[0]
      const owners = catalog.categoryOwners.get(normalizeName(name)) ?? []
      const asGroup = findOption(catalog.dbGroupOptions, name)
      if (owners.length > 0) {
        categoryText = name
        groupText = owners.length === 1 ? owners[0]
          : owners.find(o => normalizeName(o) === normalizeName(defGroup)) ?? defGroup
      } else if (asGroup) {
        groupText = asGroup.value
        categoryText = defCategory
      } else {
        categoryText = name
        groupText = defGroup
      }
    } else {
      groupText = f.groupHint || ''
      categoryText = f.categoryHint || ''
      if (categoryText && !groupText) {
        const owners = catalog.categoryOwners.get(normalizeName(categoryText)) ?? []
        groupText = owners.length === 1 ? owners[0] : defGroup
      }
      if (!groupText) groupText = defGroup
      if (!categoryText) categoryText = defCategory
    }
    out[f.key] = resolvePair(catalog, groupText, categoryText)
  }
  return out
}

// ── กันซ้ำกับของเดิม ─────────────────────────────────────────────────────────

// ชื่อเท่ากัน (normalizeName) + ห่างไม่เกิน meters เมตร = ซ้ำ
// ใช้ตารางกริด (bucket) ตามพิกัด ไม่เทียบทุกคู่ — ไฟล์ 5,000 จุด × ของเดิม 20,000 แถว เทียบเต็มคือ 100 ล้านคู่
export function markDuplicates(items, existing, meters = DUPLICATE_METERS) {
  // เซลล์กว้าง ≥ meters ทั้งแนวละติจูดและลองจิจูด (หาร 0.8 ชดเชย cos(lat) ถึงละติจูด ~37°) แล้วดูเซลล์รอบข้าง 3×3
  const cell = meters / 111000 / 0.8
  const cellOf = v => Math.floor(v / cell)
  const buckets = new Map()
  for (const e of existing ?? []) {
    const lat = Number(e.latitude), lng = Number(e.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const k = `${cellOf(lat)}:${cellOf(lng)}`
    const entry = { n: normalizeName(e.name), lat, lng }
    const list = buckets.get(k)
    if (list) list.push(entry); else buckets.set(k, [entry])
  }

  return items.map(it => {
    const n = normalizeName(it.name)
    const cy = cellOf(it.latitude), cx = cellOf(it.longitude)
    let dup = false
    for (let dy = -1; dy <= 1 && !dup; dy += 1) {
      for (let dx = -1; dx <= 1 && !dup; dx += 1) {
        const list = buckets.get(`${cy + dy}:${cx + dx}`)
        if (!list) continue
        dup = list.some(e => e.n === n && haversineMeters({ lat: it.latitude, lng: it.longitude }, e) <= meters)
      }
    }
    return { ...it, duplicate: dup }
  })
}

// ── PDPA: คอลัมน์ที่น่าจะเป็นข้อมูลส่วนบุคคล ─────────────────────────────────

// รายการนำเข้าขึ้นแผนที่สาธารณะทันที จึงให้ "ไม่เก็บ" เป็นค่าเริ่มต้นสำหรับคอลัมน์ที่ชื่อบ่งว่าเป็นข้อมูลคน
// เป็นแค่การเดาจากชื่อคอลัมน์ — ไม่ใช่การตรวจเนื้อหา คนต้องตัดสินเองเสมอ (จึงมีกล่องเตือน + ติ๊กยืนยัน)
// "name" ล้วนๆ ไม่นับ เพราะเป็นชื่อสถานที่
const PERSONAL_EN_TOKENS = new Set([
  'owner', 'citizen', 'tel', 'telephone', 'phone', 'mobile', 'email', 'mail', 'address', 'surname',
  'firstname', 'lastname', 'fullname',
])
const PERSONAL_EN_COMPACT = ['idcard', 'nationalid', 'citizenid', 'firstname', 'lastname', 'fullname', 'ownername']
const PERSONAL_TH = [
  'ชื่อสกุล', 'ชื่อนามสกุล', 'นามสกุล', 'ชื่อเจ้าของ', 'เจ้าของ', 'ผู้ครอบครอง', 'เลขบัตร', 'บัตรประชาชน',
  'บัตรปชช', 'โทร', 'เบอร์', 'อีเมล', 'ที่อยู่', 'บ้านเลขที่',
]

export function looksPersonalColumn(columnName) {
  const raw = String(columnName ?? '').normalize('NFC').toLowerCase()
  if (!raw.trim()) return false
  // แยกคำภาษาอังกฤษด้วยตัวคั่น (กัน "hotel" ไปติด "tel") แล้วเช็กชุดคำ
  const tokens = raw.split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.some(t => PERSONAL_EN_TOKENS.has(t))) return true
  const compactEn = tokens.join('')
  if (PERSONAL_EN_COMPACT.some(w => compactEn.includes(w))) return true
  const compactTh = raw.replace(/[\s\-_.()/]+/g, '')
  return PERSONAL_TH.some(w => compactTh.includes(w))
}

// คำอธิบาย + บรรทัด "หัวข้อ: ค่า" เฉพาะคอลัมน์ที่เจ้าหน้าที่เลือกเก็บ ตัดรวมไม่เกิน 4000 ตัวอักษร
export function buildDescription(description, attributes, keptColumns) {
  const lines = []
  const d = String(description ?? '').trim()
  if (d) lines.push(d)
  for (const col of keptColumns ?? []) {
    const v = attributes?.[col]
    if (v === undefined || v === null || String(v).trim() === '') continue
    lines.push(`${col}: ${String(v).trim()}`)
  }
  let text = lines.join('\n')
  if (text.length > MAX_DESCRIPTION_CHARS) {
    text = text.slice(0, MAX_DESCRIPTION_CHARS)
    // อย่าตัดกลาง surrogate pair (อีโมจิ) จะได้ตัวอักษรเสียท้ายข้อความ
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
  }
  return text
}
