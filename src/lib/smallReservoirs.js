// อ่างเก็บน้ำขนาดเล็ก — รายงานของศูนย์บริหารจัดการทรัพยากรน้ำจังหวัดแพร่ (ผังน้ำออนไลน์แพร่ phraepao.go.th)
//
// ต้นทางเป็นหน้า HTML ตารางล้วน ไม่มี API ไม่มีพิกัด ไม่ระบุเงื่อนไขการใช้ (ตรวจ 2569-10-14/15):
//   /officechief/water/views_r_id.php?id_dam=N  → 1 อ่างต่อ 1 หน้า เรียงใหม่→เก่า ราว 180 แถว
//   อ่างขนาดเล็กอัปเดตรายสัปดาห์ด้วยมือ (ทุกอ่างลงวันที่เดียวกัน) · ข้อมูลจริงมีเรื่องที่ต้องกันไว้:
//   - ⚠️ ป้ายสถานการณ์ของต้นทาง ("เกณฑ์น้ำดี/มาก") ไม่สอดคล้องกับตัวเลขบางรายงาน (ห้วยปุย 46.05% ขึ้นว่า
//     "น้ำมาก" แต่ 87.35% ขึ้นว่า "น้ำดี") → ไม่อ่านและไม่ส่งต่อป้ายนั้นเลย ใช้ % อย่างเดียว
//   - ปริมาตรปัดทศนิยม 2 ตำแหน่ง จึงคลาดจาก % ได้ถึง ~3.4 จุด (วัดจากข้อมูลจริง 357 แถว) ด่านตรวจใช้ 6 จุด
//   - ตัวเลขซ้ำเดิมเป็นสัปดาห์ๆ ได้ (ห้วยยอยซ้ำ 82.27% ถึง 20 รายงานติดกัน 1 ต.ค. 2567 – 11 ก.พ. 2568)
//   - มีแถววันที่ผิด (เช่น 18/06/0004 ที่อ่างอื่น) และชื่อซ้ำวันที่ → ทิ้งแถวนั้น ไม่เดา
//
// ไฟล์นี้ไม่มี import จาก React/DOM — Worker (worker/phraeReservoir.js) กับหน้าเว็บใช้ตัวเดียวกัน
// เหมือน src/lib/hydroHourly.js · ผลที่ส่งต่อมีแต่ { d, pct, vol } ต่อรายงาน ไม่มีข้อความจากต้นทาง
import { thaiDay } from './hydroHourly.js'

export const RESERVOIR_SOURCE = 'https://www.phraepao.go.th/officechief/water/map_water_r.php'
export const reservoirReportUrl = id => `https://www.phraepao.go.th/officechief/water/views_r_id.php?id_dam=${id}`

// ตัวตนอ่างตามต้นทาง — ชื่อต้องตรงเป๊ะ ไม่งั้นถือว่าหน้าเปลี่ยนหรือเปิดผิดอ่าง (เหมือน HYDRO_STATIONS)
// ห้ามรับ id จากผู้ใช้นอกรายการนี้ · จะเพิ่มอ่างต้องตรวจชื่อกับหน้าต้นทางก่อนทุกครั้ง
export const SMALL_RESERVOIRS = {
  50: { name: 'อ่างเก็บน้ำห้วยยอย' },
  30: { name: 'อ่างเก็บน้ำห้วยปุย' },
}

// อ่างที่แสดงต่อ อปท. — เลือกชัดเจน ไม่เดาจากระยะ (ต้นทางไม่มีพิกัด)
//   thungkaew: ห้วยยอยกับห้วยปุ่ยอยู่ในผังน้ำตำบลทุ่งแค้ว (เจ้าของระบบสั่ง 2569-10-14)
//   demo: ใช้ข้อมูลจริงของทุ่งแค้วเป็นตัวอย่างบนสนามซ้อม (แบบเดียวกับ HYDRO_TENANTS.demo) ไม่ใช่อ่างของตำบลสาธิต
export const SMALL_RESERVOIR_TENANTS = {
  thungkaew: { ids: ['50', '30'], scope: 'อยู่ในผังน้ำตำบล' },
  demo: { ids: ['50', '30'], scope: 'ข้อมูลจริงของทุ่งแค้ว ใช้สาธิต' },
}

// รายงานรายสัปดาห์ → เกิน 14 วันถือว่าไม่มีรายงานใหม่ (พลาด 1 สัปดาห์ยังไม่ค้าง)
export const RESERVOIR_STALE_DAYS = 14
// ซ้ำตั้งแต่กี่รายงานถึงขึ้นป้าย — ค่าเดียวกับ DAM_SAME_MIN_REPORTS ของอ่างกลาง (เทสต์เทียบสองค่าให้ตรงกัน)
export const RESERVOIR_SAME_MIN = 3
// % ขยับน้อยกว่านี้ถือว่าทรงตัว (ปริมาตรปัดทศนิยม 2 ตำแหน่ง ขยับต่ำกว่านี้ไม่มีความหมาย)
export const RESERVOIR_TREND_FLAT_PP = 0.5
export const RESERVOIR_MAX_ROWS = 60
export const RESERVOIR_HTML_MAX_CHARS = 300_000
const PERCENT_TOLERANCE_PP = 6
const MIN_YEAR = 2020

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

// ต้นทางใช้ปี ค.ศ. รูป dd/mm/yyyy · ตรวจเป็นวันที่จริงในปฏิทิน ไม่ใช่แค่รูปแบบ
function parseSourceDate(text, today) {
  const m = String(text).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3])
  if (year < MIN_YEAR || year > 2100 || month < 1 || month > 12 || day < 1) return null
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCMonth() !== month - 1) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  // อนุญาตล้ำวันนี้ 1 วัน กันนาฬิกาเลื่อมเขตเวลา · เกินกว่านั้นคือข้อมูลผิด
  return iso <= addDaysIso(today, 1) ? iso : null
}

function addDaysIso(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000)
}

// ตัวเลขปกติเท่านั้น — ต้นทางมีช่องว่างท้าย ("0.280 ") ปน · ไม่รับ "" / "-" / ค่าที่แปลงแล้วเป็น 0 เงียบๆ
function plainNumber(text) {
  const t = String(text).trim()
  return /^\d{1,6}(?:\.\d{1,4})?$/.test(t) ? Number(t) : null
}

function cellTexts(rowHtml) {
  const cells = []
  let pos = 0
  while (cells.length < 12) {
    const open = rowHtml.indexOf('<td', pos)
    if (open < 0) break
    const bodyStart = rowHtml.indexOf('>', open)
    const close = rowHtml.indexOf('</td>', bodyStart)
    if (bodyStart < 0 || close < 0) break
    cells.push(rowHtml.slice(bodyStart + 1, close).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim())
    pos = close + 5
  }
  return cells
}

/**
 * อ่านตารางรายงานอ่างจาก HTML ของต้นทาง → { id, name, capacity, rows: [{ d, pct, vol }] } เรียงใหม่→เก่า
 * โยน Error เมื่อหน้าเปลี่ยนรูป/ผิดอ่าง/ไม่มีแถวที่ใช้ได้ — ไม่เดาให้
 *
 * ⚠️ งบ CPU ของ Worker แผนฟรีคือ 10 ms ต่อคำขอ: ห้ามใช้ regex กวาดทั้งหน้า (94 KB) — ไล่ด้วย indexOf
 *    ทีละแถวแล้วหยุดที่ RESERVOIR_MAX_ROWS (ตัวหน้าเว็บมีราว 180 แถว ใช้แค่ 60 ล่าสุด)
 * HTML ของต้นทางไม่เรียบร้อย: แต่ละแถวปิดด้วย </tr></tr></tr></td> ซ้อนกัน จึงตัดแถวด้วย </tr> ตัวแรกเท่านั้น
 */
export function parseReservoirHtml(html, id, now = Date.now()) {
  const meta = Object.hasOwn(SMALL_RESERVOIRS, id) ? SMALL_RESERVOIRS[id] : null
  if (!meta || typeof html !== 'string') throw new Error('Invalid reservoir')
  if (html.length > RESERVOIR_HTML_MAX_CHARS) throw new Error('Report too large')

  const nameHeader = html.indexOf('ชื่ออ่างเก็บน้ำ')
  const dateHeader = html.indexOf('ข้อมูลอัพเดท')
  if (nameHeader < 0 || dateHeader < nameHeader) throw new Error('Layout changed')
  let pos = html.indexOf('<tbody', dateHeader)
  if (pos < 0) throw new Error('Layout changed')
  const tableEnd = html.indexOf('</table>', pos)
  const limit = tableEnd < 0 ? html.length : tableEnd

  const today = thaiDay(now)
  const byDate = new Map()
  let capacity = null
  let capacityDate = ''
  for (let scanned = 0; byDate.size < RESERVOIR_MAX_ROWS && scanned < RESERVOIR_MAX_ROWS * 3; scanned += 1) {
    const start = html.indexOf('<tr', pos)
    if (start < 0 || start >= limit) break
    const stop = html.indexOf('</tr>', start)
    if (stop < 0 || stop > limit) break
    pos = stop + 5

    const cells = cellTexts(html.slice(start, stop))
    if (cells.length < 9) continue
    // แถวของอ่างอื่นในหน้านี้ = เปิดผิดหน้า ไม่ใช่แถวเสีย → หยุดทั้งหมด
    if (cells[0] !== meta.name) throw new Error('Reservoir mismatch')

    const cap = plainNumber(cells[1]), vol = plainNumber(cells[2]), pct = plainNumber(cells[3])
    const d = parseSourceDate(cells[8], today)
    if (!d || cap === null || vol === null || pct === null) continue
    if (cap <= 0 || cap > 100 || vol > cap * 1.5 || pct > 150) continue
    // % กับปริมาตร÷ความจุ ต้องไปทางเดียวกัน — คอลัมน์เลื่อนหรือพิมพ์ผิดชัดๆ ถึงทิ้ง (ไม่ใช่กฎเดาว่าค่าไหนผิด)
    if (Math.abs(pct - (vol / cap) * 100) > PERCENT_TOLERANCE_PP) continue
    if (byDate.has(d)) continue // วันที่ซ้ำ (เจอจริงที่ห้วยปุย) เอาแถวที่อยู่บนก่อน
    byDate.set(d, { d, pct, vol })
    // ความจุเอาของรายงานที่ใหม่ที่สุด (ต้นทางลงเรียงใหม่→เก่า แต่ไม่พึ่งลำดับ)
    if (d > capacityDate) { capacityDate = d; capacity = cap }
  }

  const rows = [...byDate.values()].sort((a, b) => (a.d < b.d ? 1 : -1))
  if (!rows.length) throw new Error('Empty report')
  return { id: String(id), name: meta.name, capacity: capacity ?? null, rows }
}

// ตรวจรูปร่างคำตอบจาก /api/small-reservoir ฝั่งหน้าเว็บ — ไม่เชื่อ JSON ที่ส่งกลับมาตรงๆ
export function isReservoirReport(value, id) {
  return Boolean(value) && value.id === String(id) && Array.isArray(value.rows) && value.rows.length > 0
    && value.rows.length <= RESERVOIR_MAX_ROWS
    && value.rows.every(r => typeof r?.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.d)
      && Number.isFinite(r.pct) && Number.isFinite(r.vol))
}

export function reservoirTrend(latest, previous) {
  if (!latest || !previous) return null
  const diff = latest.pct - previous.pct
  if (Math.abs(diff) < RESERVOIR_TREND_FLAT_PP) return { dir: 'flat', points: Math.abs(diff) }
  return { dir: diff > 0 ? 'up' : 'down', points: Math.abs(diff) }
}

/**
 * สรุปรายงานเป็นข้อเท็จจริงที่หน้าเว็บใช้ตัดสินป้าย
 *  - ซ้ำ = % เท่ารายงานล่าสุดติดกันกี่รายงาน (ปริมาตรปัดหยาบเกินจะเทียบ — % คิดจากปริมาตรละเอียดของต้นทาง)
 *  - showSame ไม่ซ้อนกับ stale: ข้อมูลที่ค้างเกินเกณฑ์มีป้ายของตัวเองอยู่แล้ว (แบบเดียวกับ DamCard)
 *  - ไม่เดาว่ารายงานไหนพิมพ์ผิด: ค่าโดดโชว์ตามต้นฉบับ ให้เห็นในกราฟเอง
 */
export function reservoirSummary(report, now = Date.now()) {
  const rows = report?.rows
  if (!Array.isArray(rows) || !rows.length) return null
  const latest = rows[0]
  const previous = rows[1] ?? null
  const ageDays = Math.max(0, daysBetween(latest.d, thaiDay(now)))
  const stale = ageDays > RESERVOIR_STALE_DAYS
  let sameCount = 1
  while (sameCount < rows.length && rows[sameCount].pct === latest.pct) sameCount += 1
  return {
    latest,
    previous,
    ageDays,
    stale,
    sameCount,
    sameSince: rows[sameCount - 1].d,
    // ซ้ำทุกรายงานที่เก็บไว้ = ของจริงอาจนานกว่านี้
    sameCapped: sameCount === rows.length,
    showSame: !stale && sameCount >= RESERVOIR_SAME_MIN,
    trend: reservoirTrend(latest, previous),
  }
}

// "6 ต.ค. 2569" — วันที่ล้วนจากต้นทางเป็นรายวัน ไม่มีเวลา จึงไม่โชว์เวลาเด็ดขาด
export function formatReportDate(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`
}

export function formatReportDay(iso) {
  const m = String(iso).match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : ''
}
