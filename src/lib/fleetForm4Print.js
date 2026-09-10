// แบบ 4 บันทึกการใช้รถ — รายคัน รายเดือน ตามแบบฟอร์มกระดาษ
// (ลำดับคอลัมน์/ข้อความหัวตารางต้องตรงต้นฉบับ ห้ามเติมช่องที่ไม่มีบนกระดาษ)

import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, GOV_PAGE_MARGIN_LANDSCAPE, govDocFontIdentityCss, govEServiceOriginText, govPageCss, govPagePadding } from './govDocStyle.js'

// ⚠️ 13 แถว/หน้า เป็นค่าที่พอดีกับ "แถวว่าง" (8.8mm) บนพื้นที่พิมพ์แนวนอน 170mm เท่านั้น
// ใช้เป็นเพดานจำนวนแถวและใช้กับเอกสารเปล่าที่ไม่มีข้อมูลให้วัด — จำนวนแถวจริงต่อหน้า
// ตอนนี้คำนวณจากความสูงของข้อมูลแต่ละแถว ดู paginateForm4Trips()
//
// ที่มาของการเปลี่ยน: 13 ถูกคำนวณจากแถวว่างล้วน แต่แถวข้อมูลที่ชื่อยาวจนตัดเป็น 2 บรรทัด
// สูง 11.1mm ไม่ใช่ 8.8mm — 13 แถวแบบนั้นวัดได้ 187.9mm ล้นพื้นที่ 170mm อยู่ 17.9mm
// แล้วถูก overflow:hidden ตัดหายเงียบๆ (เคสข้อมูลความยาวปกติ 130.2mm ไม่ล้น)
export const FORM4_ROWS_PER_PAGE = 13

/* ── งบความสูงต่อหน้า ─────────────────────────────────────────────────────
   ทุกค่าวัดจากเบราว์เซอร์จริงบนความกว้างพื้นที่พิมพ์ 257mm (A4 แนวนอน หักขอบ 2+2 ซม.)
   ห้ามแก้จากการกะ ให้วัดใหม่ทุกครั้งที่แตะหัวเรื่อง/หัวตาราง/ขนาดฟอนต์ในตาราง */
const PRINT_AREA_MM = 170      // พื้นที่พิมพ์แนวตั้ง A4 แนวนอน หักขอบบน 3 ซม. ล่าง 1 ซม.
const HEADING_MM = 23.6        // "แบบ 4" + ชื่อเรื่อง + ทะเบียน + ประจำเดือน
const THEAD_MM = 19.2          // หัวตาราง 2 ชั้น (ป้ายกำกับยาวถึง 4 บรรทัด)
const ORIGIN_LINE_MM = 7.5     // บรรทัดกำกับที่มาใต้ตาราง
const TOTAL_ROW_MM = 9.4       // แถว "รวมระยะทางทั้งสิ้น"
const BLANK_ROW_MM = 8.8       // แถวว่างที่ใช้ดันตารางให้เต็มหน้า (ดู tr.blank-filler td)
const ROW_BASE_MM = 6.7        // แถวข้อมูลที่ทุกช่องจบใน 1 บรรทัด
const ROW_LINE_MM = 4.4        // ความสูงที่เพิ่มต่อ 1 บรรทัดที่ล้นมา (วัดได้ 11.1mm ที่ 2 บรรทัด)

/* เผื่อไว้กันฟอนต์ต่างเครื่อง — เครื่อง อปท. ส่วนใหญ่ไม่ได้ลงชุดฟอนต์ราชการ ตกไปใช้
   TH Sarabun New หรือ Sarabun ที่ metric ไม่เท่ากันเป๊ะ และค่าประมาณความสูงแถวเองก็มี
   ความคลาดเคลื่อนในตัว ถ้าตั้งงบพอดีเป๊ะ เคสหนักสุดวัดได้ 170.2mm ล้นไป 0.2mm ทันที */
const SAFETY_MM = 3

// งบสำหรับแถวข้อมูลล้วน — แถวรวมยอดหักเพิ่มเฉพาะหน้าที่มีมันจริง
const ROWS_BUDGET_MM = PRINT_AREA_MM - HEADING_MM - THEAD_MM - ORIGIN_LINE_MM - SAFETY_MM  // 116.7mm

/* ความกว้างช่องข้อความ (mm) = สัดส่วนคอลัมน์ × 257mm หัก padding ซ้าย/ขวาของ td.left
   (1mm 3px → ~0.8mm ต่อข้าง) — อ่านจาก FORM4_COL_PCT ที่เดียวกับ CSS <col> จึงไม่มีวันเพี้ยนกัน */
const PRINT_WIDTH_MM = 257

/* ความกว้างคอลัมน์ (% ของพื้นที่พิมพ์ 257mm) — แหล่งเดียวของทั้ง CSS <col> และตัวประมาณ
   ความสูงแถว (ของเดิมเขียนแยกสองที่แล้วคอมเมนต์ไว้ว่า "ต้องตรงกันเสมอ" ซึ่งพังเงียบได้ง่าย)
   วันที่/เวลา/เลขไมล์มี 2 คอลัมน์ (ออก/กลับ) รวมทั้งหมดต้องได้ 100 พอดี

   ⚠️ ปรับเมื่อ 2569-09-10 จากข้อมูลจริง: แถว "นางสาวสุพัตรา กล้าสันเทียะ / ร้านค้า หมู่ 3 หมู่ 4และ
   หมู่ 7" ต้องขึ้น 2 บรรทัดทั้งที่ขาดอีกนิดเดียว ขณะที่หมายเหตุ (ส่วนใหญ่ว่าง) เหลือที่ 13mm
   วัดความกว้างที่แต่ละช่องต้องใช้จริงบนกระดาษ 257mm แล้วย้ายที่จากช่องที่เหลือไปให้ช่องข้อความ
     ลำดับ 3→2.2  เวลา 5→4.2  รวมระยะทาง 6→5.5  หมายเหตุ 10→6.5
     ผู้ใช้รถ 16→17  สถานที่ไป 15→17  พนักงานขับรถ 14→15.8
     วันที่ 6.8→7.6 — ของเดิม "29/12/2569" "30/12/2569" ล้นทะลุเส้นขอบเซลล์อยู่แล้ว
   ผลที่วัดได้: แถวในภาพ (ผู้ใช้รถ/สถานที่ไป/คนขับ) จบบรรทัดเดียวทุกช่อง แถวสูง 11.1→6.7mm
   ผู้ใช้รถต้องไม่แคบกว่าช่องข้อความอื่น — เคยเจอชื่อจริงขึ้น 2 บรรทัดบนเครื่องเจ้าหน้าที่ทั้งที่
   ผ่านเทสต์ (2026-09-05) จึงไม่เอาสถานที่ไปขึ้นไปถึง 17.5% แม้จะให้ปลายทาง 2 หมู่บ้านจบบรรทัดเดียว
   ห้ามบีบ:
     • เลขไมล์ (odo) — หัว "ระยะทางเมื่อรถ/กลับถึง/หน่วยงาน/สำนักงาน" ใช้ 5 บรรทัดซึ่งเป็นเพดาน
       ของหัวตาราง บีบอีกนิดหัวจะขึ้นบรรทัดที่ 6 แล้ว THEAD_MM สูงขึ้นทั้งตาราง
     • รวมระยะทาง (sum) — ต่ำกว่า 5.3% หัว "ระยะทาง" ถูกตัดกลางคำเป็น "ระยะ/ทาง" (ลองที่ 4.8%
       แล้วเห็นในภาพ ตัวเลขไม่ฟ้องเพราะหัวตารางยังไม่สูงขึ้น) ตั้ง 5.5% เผื่อเครื่องจริงที่ตัวอักษร
       กว้างกว่าเครื่องทดสอบ ส่วนที่คืนให้ช่องนี้หักจากพนักงานขับรถ (คนขับเป็นเจ้าหน้าที่ประจำ
       ไม่กี่คน ชื่อไม่แปรผันเท่าผู้ใช้รถ และยังกว้างกว่าค่าเดิม 14% อยู่)
     • หมายเหตุ — ต่ำกว่านี้ข้อความจริงจะถูกตัด "…" เร็วเกินไป (clamp 2 บรรทัด)
   ⚠️ แก้ค่านี้แล้วต้องรัน tests/fleet-form4-layout.test.mjs และวัด THEAD_MM ใหม่ทุกครั้ง
      และต้องดูภาพหัวตารางด้วย — การตัดคำกลางหัวตารางไม่ทำให้ตัวเลขใดเปลี่ยน */
export const FORM4_COL_PCT = {
  seq: 2.2, date: 7.6, time: 4.2, user: 17, dest: 17, odo: 6.2, sum: 5.5, drv: 15.8, note: 6.5,
}

const colMm = key => (PRINT_WIDTH_MM * FORM4_COL_PCT[key]) / 100 - 1.6
const TEXT_COL_MM = {
  user: colMm('user'),   // ผู้ใช้รถ — ห้าม clamp ชื่อต้องครบเสมอ
  dest: colMm('dest'),   // สถานที่ไป — clamp 2 บรรทัด
  drv:  colMm('drv'),    // พนักงานขับรถ — ห้าม clamp
  note: colMm('note'),   // หมายเหตุ — clamp 2 บรรทัด
}

/* ความกว้างเฉลี่ยต่อตัวอักษรที่ 10.5pt — วัดจริงจากข้อความไทยหลายแบบได้ 1.29–1.73 mm/ตัว
   (แปรผันเพราะสระบน/ล่างและวรรณยุกต์ไม่กินความกว้าง) ใช้ค่าที่สูงกว่าทุกตัวอย่างที่วัดได้
   เพื่อให้ประมาณ "สูงกว่าจริง" ไว้ก่อน — ประมาณเกินแล้วได้หน้าเพิ่มยังดีกว่าประมาณขาด
   แล้วเนื้อหาล้นออกนอกกระดาษ */
const MM_PER_CHAR = 1.75

/**
 * ประมาณความสูงของแถวข้อมูล 1 แถว (มม.) จากความยาวข้อความในช่องที่ตัดบรรทัดได้
 *
 * เป็นการประมาณ ไม่ใช่การวัด — ตอนสร้าง HTML ยังไม่มี DOM ให้วัดจริง จึงต้องเผื่อไว้เสมอ
 * และมีกันชนอีกชั้นที่ CSS: .sheet ตอนพิมพ์ไม่ได้ครอบ overflow:hidden ไว้แล้ว ถ้าประมาณพลาด
 * เนื้อหาจะไหลไปหน้าถัดไปแทนที่จะถูกตัดหายเงียบๆ
 */
export function estimateForm4RowHeightMm(trip) {
  const lines = (value, colMm, maxLines = Infinity) => {
    const text = String(value ?? '').trim()
    if (!text) return 1
    return Math.min(Math.max(1, Math.ceil((text.length * MM_PER_CHAR) / colMm)), maxLines)
  }
  const maxLines = Math.max(
    lines(trip?.requester?.full_name, TEXT_COL_MM.user),
    lines(trip?.destination, TEXT_COL_MM.dest, 2),
    lines(trip?.driver?.full_name, TEXT_COL_MM.drv),
    lines(remarkText(trip), TEXT_COL_MM.note, 2),
  )
  return ROW_BASE_MM + (maxLines - 1) * ROW_LINE_MM
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim())
}

function isTimeOnly(value) {
  return /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(String(value ?? '').trim())
}

// date-only ของ Postgres ไม่มี timezone — ตีความเป็นปฏิทินไทย (UTC+7)
// ห้าม new Date('YYYY-MM-DD') เพราะเป็น UTC เที่ยงคืน = วันก่อนหน้าในไทย
function parseStamp(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const date = isDateOnly(raw)
    ? new Date(`${raw}T00:00:00+07:00`)
    : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function combineDateAndTime(dateStr, timeStr) {
  const datePart = String(dateStr ?? '').trim()
  const timePart = String(timeStr ?? '').trim()
  if (!isDateOnly(datePart) || !isTimeOnly(timePart)) return null
  return parseStamp(`${datePart}T${timePart}+07:00`)
}

function formatThaiDate(date) {
  if (!date) return ''
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatThaiTime(date) {
  if (!date) return ''
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function meterText(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('th-TH') : ''
}

function tripDistanceKm(trip) {
  if (trip?.distance_km !== null && trip?.distance_km !== undefined && trip?.distance_km !== '') {
    const stored = Number(trip.distance_km)
    if (Number.isFinite(stored)) return stored
  }
  const start = Number(trip?.odometer_start)
  const end = Number(trip?.odometer_end)
  if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(end - start, 0)
  return 0
}

function distanceText(trip) {
  if (trip?.distance_km !== null && trip?.distance_km !== undefined && trip?.distance_km !== '') {
    return meterText(trip.distance_km)
  }
  const start = Number(trip?.odometer_start)
  const end = Number(trip?.odometer_end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return ''
  return meterText(Math.max(end - start, 0))
}

export function monthlyDistanceKm(trips) {
  return (trips ?? []).reduce((sum, trip) => sum + tripDistanceKm(trip), 0)
}

// เหตุผลบันทึกย้อนหลัง (backdated_reason) ไม่พิมพ์ลงแบบ 4 แล้ว — เป็นข้อมูลสำหรับ
// ตรวจสอบภายในระบบเท่านั้น ไม่ใช่ช่องบนกระดาษต้นฉบับ (เดิมเคยต่อท้ายเป็น "ย้อนหลัง: ...")
function remarkText(trip) {
  return String(trip?.notes ?? '').trim()
}

export function form4VehicleTitle(vehicle) {
  const name = String(vehicle?.name ?? '').trim()
  if (!name) return 'บันทึกการใช้รถ'
  return name.startsWith('รถ') ? `บันทึกการใช้${name}` : `บันทึกการใช้รถ ${name}`
}

export function form4PlateText(vehicle) {
  return String(vehicle?.license_plate ?? vehicle?.asset_code ?? '').trim()
}

export function departureParts(trip) {
  const started = parseStamp(trip?.started_at)
  if (started) return { date: formatThaiDate(started), time: formatThaiTime(started) }
  const combined = combineDateAndTime(trip?.trip_date, trip?.depart_time)
  if (combined) return { date: formatThaiDate(combined), time: formatThaiTime(combined) }
  const day = parseStamp(trip?.trip_date)
  return { date: day ? formatThaiDate(day) : '', time: '' }
}

export function returnParts(trip) {
  const returned = parseStamp(trip?.returned_at)
  if (returned) return { date: formatThaiDate(returned), time: formatThaiTime(returned) }
  const combined = combineDateAndTime(trip?.trip_date, trip?.return_time)
  if (combined) return { date: formatThaiDate(combined), time: formatThaiTime(combined) }
  return { date: '', time: '' }
}

function stampKey(trip) {
  const started = parseStamp(trip?.started_at)
  if (started) return started.toISOString()
  const combined = combineDateAndTime(trip?.trip_date, trip?.depart_time)
  if (combined) return combined.toISOString()
  const day = parseStamp(trip?.trip_date)
  return day ? day.toISOString() : ''
}

export function sortForm4Trips(trips) {
  return [...(trips ?? [])].sort((a, b) => {
    const aKey = stampKey(a)
    const bKey = stampKey(b)
    if (aKey !== bKey) return aKey < bKey ? -1 : 1
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
  })
}

/**
 * แบ่งเที่ยวเดินทางลงหน้ากระดาษ
 *
 * ค่าเริ่มต้นแบ่งตาม "ความสูงที่ประมาณได้ของแต่ละแถว" ไม่ใช่จำนวนแถวตายตัว — เดือนที่ชื่อ
 * และปลายทางสั้นจะได้แถวต่อหน้ามากกว่าเดือนที่ยาว ซึ่งเป็นพฤติกรรมที่ถูกต้องกว่าค่าตายตัว
 * ที่พอดีกับเคสหนึ่งแต่ล้นอีกเคสหนึ่ง (13 แถวเคยล้น 17.9mm เมื่อชื่อยาวจนตัด 2 บรรทัดทุกแถว)
 *
 * ส่ง rowsPerPage มาเองได้เมื่อต้องการบังคับจำนวนตายตัว (เทสใช้เพื่อคุมเคสให้แน่นอน)
 */
export function paginateForm4Trips(trips, rowsPerPage = null) {
  const sorted = sortForm4Trips(trips)
  const fixed = Number.isFinite(rowsPerPage) && rowsPerPage > 0

  // จัดเที่ยวลงหน้า: โหมดตายตัวใช้จำนวน โหมดปกติใช้ความสูงสะสมเทียบงบต่อหน้า
  // เพดาน FORM4_ROWS_PER_PAGE ยังคุมอยู่ด้วย เพื่อไม่ให้เดือนที่ข้อมูลสั้นมากอัดแถวจนแน่นผิดรูป
  const chunks = []
  let current = []
  let usedMm = 0
  for (const trip of sorted) {
    const rowMm = estimateForm4RowHeightMm(trip)
    const full = fixed
      ? current.length >= rowsPerPage
      : current.length >= FORM4_ROWS_PER_PAGE || (current.length > 0 && usedMm + rowMm > ROWS_BUDGET_MM)
    if (full) {
      chunks.push(current)
      current = []
      usedMm = 0
    }
    current.push(trip)
    usedMm += rowMm
  }
  if (current.length || chunks.length === 0) chunks.push(current)

  let seq = 0
  const pages = chunks.map(chunk => chunk.map(trip => ({ seq: ++seq, trip })))

  // เติมแถวว่างให้ตารางเต็มหน้า ไม่งั้นเวลาพิมพ์จะเหลือช่องโหว่เป็นแผ่นๆ ใต้ตาราง
  // โหมดตายตัวเติมตามจำนวน ส่วนโหมดปกติเติมเท่าที่งบความสูงเหลือจริง
  const fillPage = (rows, budgetMm, maxRows) => {
    if (fixed) {
      while (rows.length < maxRows) rows.push({ seq: ++seq, trip: null })
      return rows
    }
    let leftMm = budgetMm - rows.reduce((sum, r) => sum + (r.trip ? estimateForm4RowHeightMm(r.trip) : 0), 0)
    while (rows.length < maxRows && leftMm >= BLANK_ROW_MM) {
      rows.push({ seq: ++seq, trip: null })
      leftMm -= BLANK_ROW_MM
    }
    return rows
  }

  // แถวรวมยอดต้องอยู่ท้ายสุดและต้องมีที่พอจริง ถ้าหน้าสุดท้ายเต็มก็เปิดหน้าใหม่ให้มันเดี่ยวๆ
  // (ยอมได้หน้าเกินมา 1 แผ่น ดีกว่ายอดรวมหายไปพร้อมกับส่วนที่ล้น)
  const lastMm = pages[pages.length - 1]
    .reduce((sum, r) => sum + (r.trip ? estimateForm4RowHeightMm(r.trip) : 0), 0)
  if (fixed
    ? pages[pages.length - 1].length >= rowsPerPage
    : lastMm + TOTAL_ROW_MM > ROWS_BUDGET_MM || pages[pages.length - 1].length >= FORM4_ROWS_PER_PAGE) {
    pages.push([])
  }

  pages.forEach((rows, index) => {
    const isLast = index === pages.length - 1
    if (fixed) {
      // โหมดจำนวนตายตัว: เติมเต็มโควตาแล้วแทนแถวว่างใบสุดท้ายด้วยแถวรวม (พฤติกรรมเดิม)
      fillPage(rows, 0, rowsPerPage)
      if (isLast) rows[rows.length - 1] = { seq: '', trip: null, total: true }
      return
    }
    // โหมดคำนวณ: หน้าสุดท้ายกันที่ให้แถวรวมยอดไว้ทั้งงบความสูงและโควตาจำนวนแถว แล้วต่อท้าย
    // (อย่าเติมเต็มก่อนแล้วไปแทนแถวว่างใบสุดท้าย — จะกลายเป็นหักที่ของแถวรวมซ้ำสองรอบ)
    fillPage(
      rows,
      isLast ? ROWS_BUDGET_MM - TOTAL_ROW_MM : ROWS_BUDGET_MM,
      isLast ? FORM4_ROWS_PER_PAGE - 1 : FORM4_ROWS_PER_PAGE,
    )
    if (isLast) rows.push({ seq: '', trip: null, total: true })
  })
  return pages
}

function tableHeader() {
  return `<thead>
    <tr>
      <th rowspan="2" class="c-seq">ที่</th>
      <th colspan="2">ออกเดินทาง</th>
      <th rowspan="2" class="c-user">ผู้ใช้รถ</th>
      <th rowspan="2" class="c-dest">สถานที่ไป</th>
      <th rowspan="2" class="c-odo">ระยะทาง<br>กม/ไมล์<br>เมื่อรถออก<br>เดินทาง</th>
      <th colspan="2">กลับถึงสำนักงาน</th>
      <th rowspan="2" class="c-odo">ระยะทางเมื่อรถ<br>กลับถึง<br>หน่วยงาน/<br>สำนักงาน</th>
      <th rowspan="2" class="c-sum">รวม<br>ระยะทาง<br>กม/ไมล์</th>
      <th rowspan="2" class="c-drv">พนักงานขับรถ</th>
      <th rowspan="2" class="c-note">หมายเหตุ</th>
    </tr>
    <tr>
      <th class="c-date">วันที่</th>
      <th class="c-time">เวลา</th>
      <th class="c-date">วันที่</th>
      <th class="c-time">เวลา</th>
    </tr>
  </thead>`
}

function dataRow(row, monthlyTotal) {
  if (row.total) {
    return `<tr class="total">
      <td colspan="9" class="total-label">รวมระยะทางทั้งสิ้น</td>
      <td class="total-value">${esc(meterText(monthlyTotal))}</td>
      <td colspan="2" class="total-unit">กิโลเมตร</td>
    </tr>`
  }
  const trip = row.trip
  if (!trip) {
    // แถวว่างไม่มีเนื้อหาให้ตัดบรรทัดอยู่แล้ว ปลอดภัยที่จะให้สูงกว่าแถวมีข้อมูลได้เสมอ
    // (ต่างจาก td ทั่วไปที่ height เป็นแค่ขั้นต่ำ) ใช้ดันตารางให้เต็มพื้นที่พิมพ์เวลาข้อมูล
    // เดือนนั้นมีน้อยแถว แทนที่จะเหลือช่องว่างเป็นแผ่นๆ ใต้ตารางเวลาพิมพ์ ดู .blank-filler td
    return `<tr class="blank-filler">
      <td class="c-seq"></td>
      <td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
    </tr>`
  }
  const depart = departureParts(trip)
  const returned = returnParts(trip)
  const userName = String(trip.requester?.full_name ?? trip.creator?.full_name ?? '').trim()
  const driverName = String(trip.driver?.full_name ?? '').trim()
  // ช่องข้อความยาวห่อด้วย .cell ที่ตั้ง white-space:normal ไว้ ขึ้นบรรทัดใหม่ได้เมื่อยาวเกิน
  // ความกว้างคอลัมน์ แทนการตัด/ย่อขนาด (ของเดิมเป็น nowrap+overflow:hidden ล้วน
  // ข้อความยาวจึงถูกตัดหายเงียบๆ กลางคำ) — ชื่อ (clamp:false) ไม่จำกัดบรรทัด ส่วนสถานที่ไป/
  // หมายเหตุ (clamp:true) กันไว้ 2 บรรทัดเพราะเป็นข้อความอิสระที่ยาวไม่จำกัดได้จริง ดู CSS .cell--clamp
  const textCell = (value, { clamp = false } = {}) =>
    `<td class="left"><span class="cell${clamp ? ' cell--clamp' : ''}">${esc(value)}</span></td>`
  return `<tr>
    <td class="c-seq">${row.seq}</td>
    <td>${esc(depart.date)}</td>
    <td>${esc(depart.time)}</td>
    ${textCell(userName)}
    ${textCell(String(trip.destination ?? '').trim(), { clamp: true })}
    <td>${esc(meterText(trip.odometer_start))}</td>
    <td>${esc(returned.date)}</td>
    <td>${esc(returned.time)}</td>
    <td>${esc(meterText(trip.odometer_end))}</td>
    <td>${esc(distanceText(trip))}</td>
    ${textCell(driverName)}
    ${textCell(remarkText(trip), { clamp: true })}
  </tr>`
}

function sheet({ title, plate, periodLabel, rows, monthlyTotal, originText }) {
  return `<section class="sheet">
    <div class="form-no">แบบ 4</div>
    <h1>${esc(title)}</h1>
    <p class="plate">หมายเลขทะเบียน ${esc(plate)}</p>
    ${periodLabel ? `<p class="period">${esc(periodLabel)}</p>` : ''}
    <table>
      <colgroup>
        <col class="c-seq"><col class="c-date"><col class="c-time">
        <col class="c-user"><col class="c-dest"><col class="c-odo">
        <col class="c-date"><col class="c-time"><col class="c-odo">
        <col class="c-sum"><col class="c-drv"><col class="c-note">
      </colgroup>
      ${tableHeader()}
      <tbody>
        ${rows.map(row => dataRow(row, monthlyTotal)).join('')}
      </tbody>
    </table>
    <div class="eservice-origin">${esc(originText)}</div>
  </section>`
}

export function buildFleetForm4Html({ vehicle, trips = [], periodLabel = '', tenant = null }) {
  const title = form4VehicleTitle(vehicle)
  const plate = form4PlateText(vehicle)
  const monthlyTotal = monthlyDistanceKm(trips)
  const pages = paginateForm4Trips(trips)
  // tenant เพิ่งเพิ่มเข้ามาเพื่อพิมพ์บรรทัดกำกับที่มา — ไม่ส่งมาก็ยังพิมพ์ได้ ได้ข้อความ
  // แบบไม่มีชื่อหน่วยงาน (เทสต์เดิมเรียกโดยไม่ส่ง tenant จึงต้องไม่พังเมื่อไม่มีค่า)
  const originText = govEServiceOriginText(tenant)
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>${esc(title)} ${esc(plate)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ size: 'A4 landscape', hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      color: #000;
      /* ตารางแบบ 4 ใช้ขนาดตัวอักษรเดียวกันทั้งตาราง (ไม่บังคับ 16pt ทั้งใบเพราะคอลัมน์
         ไม่พอ) จึงใช้เฉพาะ "ตัวตนของฟอนต์" จากมาตรฐานกลาง — font-size-adjust ยังคุมให้
         ขนาดที่ตั้งเองนี้พิมพ์ออกมาเท่ากันทุกเครื่องเหมือนใบอื่น */
      ${govDocFontIdentityCss()}
      background: #fff;
    }
    .sheet {
      width: 297mm;
      min-height: 210mm;
      padding: ${GOV_PAGE_MARGIN_LANDSCAPE};
      overflow: hidden;
    }
    .sheet + .sheet { page-break-before: always; }
    /* แบบ 4 เป็นตารางแนวนอนที่ overflow:hidden — บรรทัดนี้ต้องอยู่ในพื้นที่ที่เหลือจริง
       ไม่งั้นจะถูกตัดหายเงียบๆ วัดความสูงใหม่ทุกครั้งที่แก้ตาราง */
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 3mm; text-align: center; }
    @media print {
      html, body { height: auto; }
      /* ขอบกระดาษมาจาก padding ของ .sheet ไม่ใช่ margin ของ @page (ซึ่งเป็น 0 เพื่อไม่ให้
         เบราว์เซอร์เหลือที่วาดหัว/ท้ายกระดาษของตัวเอง) จึงคง padding ไว้เหมือนโหมดจอ

         ⚠️ ไม่ครอบ max-height + overflow:hidden แล้ว (ของเดิมตัดที่ 170mm) — จำนวนแถวต่อหน้า
         คำนวณจากความสูงที่ประมาณได้ของข้อมูลจริง (ดู paginateForm4Trips) ซึ่งเป็นการประมาณ
         ไม่ใช่การวัด ถ้าประมาณขาดแล้วยังตัดทิ้งอยู่ เที่ยวเดินทางจะหายจากเอกสารราชการ
         โดยไม่มีสัญญาณเตือน ปล่อยให้ไหลไปหน้าถัดไปแทน — ได้กระดาษเกินมาบ้างยังตรวจสอบได้
         ใช้หลักเดียวกับสมุดคุมน้ำมัน (ดู fleetFuelLedgerPrint.js) */
      .sheet {
        width: auto;
        min-height: 0;
        height: auto;
        padding: ${govPagePadding({ size: 'A4 landscape' })};
      }
      /* หัวตารางต้องซ้ำทุกหน้าเมื่อเนื้อหาไหลข้ามหน้า ไม่งั้นหน้าที่ล้นมาจะเป็นตารางไร้หัว
         อ่านไม่ออกว่าคอลัมน์ไหนคืออะไร (ของเดิมใช้ table-row-group เพื่อกันหัวโผล่หน้า 2
         ตอนตารางล้นเศษมิลลิเมตร ซึ่งไม่จำเป็นแล้วเพราะแบ่งหน้าตามความสูงจริง) */
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
    }
    .form-no { text-align: right; font-size: 14pt; line-height: 1.1; }
    h1 {
      margin: 0;
      text-align: center;
      font-size: 16pt;
      font-weight: 700;
      line-height: 1.15;
    }
    .plate {
      margin: 0;
      text-align: center;
      font-size: 14pt;
      font-weight: 700;
    }
    .period {
      margin: 0 0 3pt;
      text-align: center;
      font-size: 12pt;
      font-weight: 700;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10.5pt;
    }
    th, td {
      border: 1px solid #000;
      vertical-align: middle;
      text-align: center;
    }
    th {
      font-weight: 700;
      font-size: 9.5pt;
      line-height: 1.1;
      padding: 1px 3px;
    }
    th.c-seq, th.c-user, th.c-dest, th.c-drv, th.c-note { white-space: nowrap; }
    /* ทุกช่องข้อมูลขนาดตัวอักษรเท่ากันหมด (10.5pt จาก table ด้านบน) ไม่มีการย่อ/ตัดข้อความ
       รายช่องอีกต่อไป — ชื่อ-นามสกุล/หมายเหตุที่ยาวเกินความกว้างคอลัมน์จะ "ตัดขึ้นบรรทัดใหม่"
       แทนการหด font หรือใส่ "…" (ของเดิมเจอชื่อจริงยาวจนตัดหายกลางคำแม้ย่อสุดแล้ว) แถวที่มี
       ข้อความยาวจะสูงกว่าแถวอื่นได้เพราะ height ด้านล่างเป็นแค่ "ขั้นต่ำ" ไม่ใช่ตายตัว
       (แถวที่ข้อความไม่พอ 1 บรรทัดจะโตเกิน height นี้เอง) ข้อมูลจึงครบเสมอ แลกกับพิมพ์ได้
       น้อยแถว/หน้าลงเมื่อมีชื่อยาวหลายรายการ (ดู FORM4_ROWS_PER_PAGE)
       ⚠️ ต้องตั้ง height ไว้ (ไม่ใช่ปล่อยให้สูงตามเนื้อหาอย่างเดียว) เพราะ <td></td> ที่ไม่มี
       เนื้อหาเลย (แถวว่างที่เติมให้ครบ 1 หน้า) ไม่มี line box ให้ยึด จะเหลือแค่ padding
       (~2mm) สั้นกว่าแถวที่มีข้อมูลมาก (~6.7mm) ทำให้ตารางดูเป็นแถบสลับหนา-บางไม่เป็นระเบียบ */
    td {
      height: 6.4mm;
      padding: 1mm 4px;
      line-height: 1.2;
    }
    /* แถวว่างสูงกว่าแถวข้อมูลได้เสมอโดยไม่เสี่ยงข้อมูลล้นหน้า (ไม่มีเนื้อหาให้ตัดบรรทัด)
       ดันให้สูงขึ้นเป็นพิเศษเพื่อให้ตารางลงไปถึงเกือบสุดพื้นที่พิมพ์แม้เดือนนั้นมีรายการน้อย
       ไม่งั้นตารางจะจบสั้นๆ กลางหน้าเหลือที่ว่างเป็นแผ่นด้านล่าง ดูไม่เหมือนแบบฟอร์มราชการ
       ⚠️ ค่านี้คำนวณจากงบพื้นที่พิมพ์จริง ห้ามตั้งเดาเอง — เดือนที่ข้อมูลเต็มพอดี (14 แถว)
       แถวรวมยอดจะเด้งไปอยู่หน้าถัดไปเดี่ยวๆ (ดู paginateForm4Trips) กลายเป็นหน้าที่มีแต่
       แถวว่าง 13 แถว + แถวรวม 1 แถว หน้านั้นแคบกว่าที่คิด เพราะ thead (หัวตาราง 2 แถว
       ที่มีป้ายกำกับ 4 บรรทัดอย่าง "ระยะทาง/กม/ไมล์/เมื่อรถออก/เดินทาง") กินพื้นที่ไปแล้ว
       ~19mm ต่อหน้า นอกเหนือจากบล็อกหัวเรื่อง
       ⚠️ คำนวณใหม่เมื่อ 2569-09-05 หลังย้ายขอบเข้าแฟ้มของแนวนอนไปด้านบน 3 ซม.
       พื้นที่พิมพ์แนวตั้งลดจาก 189mm เหลือ 170mm งบใหม่ต่อหน้า:
         170 − หัวเรื่อง 23.6 − thead 19.2 − แถวรวม 9.4 − บรรทัดกำกับที่มา 7.5 = 110.3mm
         110.3 ÷ 12 แถวว่าง = 9.19mm/แถว → ตั้ง 8.8mm เผื่อฟอนต์ต่างเครื่อง */
    tr.blank-filler td { height: 8.8mm; }
    td.left { text-align: left; padding: 1mm 3px; }
    td.left .cell {
      display: block;
      white-space: normal;
      overflow-wrap: break-word;
    }
    /* ชื่อ-นามสกุล (ผู้ใช้รถ/พนักงานขับรถ) ไม่จำกัดจำนวนบรรทัดเด็ดขาด ต้องแสดงครบเสมอ
       (ตามที่รายงานมา: ชื่อจริงถูกตัดหายเพราะย่อ font จนคอลัมน์ยังไม่พอ) — สถานที่ไป/หมายเหตุ
       เป็นข้อความอิสระที่ผู้ใช้พิมพ์เองได้ไม่จำกัดความยาว (เคยเจอปลายทางหลายหมู่บ้านคั่นด้วย
       จุลภาคยาวมาก) จึงยังกันไว้ที่ 2 บรรทัดแล้วจบด้วย "…" เพื่อไม่ให้ 1 แถวที่ยาวผิดปกติ
       ดันตารางทั้งหน้าล้นออกไป — 2 บรรทัดกว้างกว่าความยาวจริงที่เจอในข้อมูลทั่วไปมาก
       จึงแทบไม่ตัดอะไรเลยในทางปฏิบัติ ต่างจากชื่อที่ห้ามตัดแม้แต่กรณีเดียว */
    /* .cell--clamp ต้อง specificity เท่ากับ "td.left .cell" ด้านบนเป๊ะ (2 คลาส + 1 element)
       ไม่งั้น display:block ของ base rule จะชนะเสมอไม่ว่าจะเขียนอยู่บรรทัดหลังแค่ไหน
       เขียนแค่ ".cell--clamp" เฉยๆ specificity ต่ำกว่า จะโดนแพ้ overwrite เงียบๆ */
    td.left .cell--clamp {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tr.total td {
      font-weight: 700;
      background: #ececec;
      border-top: 2px solid #000;
      height: 7mm;
      line-height: 7mm;
      font-size: 12pt;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tr.total .total-label {
      text-align: right;
      padding-right: 12px;
      letter-spacing: 0.06em;
    }
    tr.total .total-value { font-size: 13pt; }
    tr.total .total-unit { text-align: left; padding-left: 8px; }
    /* ความกว้างคอลัมน์มาจาก FORM4_COL_PCT ที่เดียว (ตัวประมาณความสูงแถวใช้ค่าเดียวกัน)
       เหตุผลของแต่ละตัวเลขและช่องที่ห้ามบีบ ดูคอมเมนต์ที่ FORM4_COL_PCT ด้านบนของไฟล์
       ⚠️ c-user ต้องไม่แคบกว่า c-dest/c-drv (2026-09-05: เจอชื่อผู้ใช้รถจริงขึ้นบรรทัดใหม่
       ทั้งที่ค่าเดิมกว้างพอสำหรับเทสต์แล้ว — เครื่องเจ้าหน้าที่จริงวัดความกว้างตัวอักษรต่างจาก
       ที่วัดได้ในเครื่องมือทดสอบ จึงเผื่อคอลัมน์นี้ไว้ไม่น้อยกว่าช่องข้อความอื่น) */
    ${Object.entries(FORM4_COL_PCT).map(([key, pct]) => `col.c-${key} { width: ${pct}%; }`).join('\n    ')}
  </style>
</head>
<body>
${pages.map(rows => sheet({ title, plate, periodLabel, rows, monthlyTotal, originText })).join('\n')}
</body>
</html>`
}
