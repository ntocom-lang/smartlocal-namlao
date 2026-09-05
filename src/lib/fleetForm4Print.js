// แบบ 4 บันทึกการใช้รถ — รายคัน รายเดือน ตามแบบฟอร์มกระดาษ
// (ลำดับคอลัมน์/ข้อความหัวตารางต้องตรงต้นฉบับ ห้ามเติมช่องที่ไม่มีบนกระดาษ)

import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, GOV_PAGE_MARGIN_LANDSCAPE, govDocFontIdentityCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'

// ⚠️ 13 แถว/หน้า ไม่ใช่ตัวเลขที่เลือกเอาสวย — เป็นค่าที่พอดีกับพื้นที่พิมพ์แนวนอน 170mm
// หลังย้ายขอบเข้าแฟ้มไปด้านบน 3 ซม. เมื่อ 2569-09-05 (เดิม 14 แถว ตอนพื้นที่ยังเป็น 189mm)
// เคสหนักสุดที่ 14 แถววัดได้ 170.8mm ล้นออกนอกกระดาษ ห้ามเพิ่มกลับโดยไม่รัน
// tests/fleet-form4-layout.test.mjs
export const FORM4_ROWS_PER_PAGE = 13

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

export function paginateForm4Trips(trips, rowsPerPage = FORM4_ROWS_PER_PAGE) {
  const sorted = sortForm4Trips(trips)
  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage))
  const pages = Array.from({ length: pageCount }, (_, page) => {
    const slice = sorted.slice(page * rowsPerPage, (page + 1) * rowsPerPage)
    const rows = slice.map((trip, index) => ({
      seq: page * rowsPerPage + index + 1,
      trip,
    }))
    while (rows.length < rowsPerPage) {
      rows.push({ seq: page * rowsPerPage + rows.length + 1, trip: null })
    }
    return rows
  })
  const lastPage = pages[pages.length - 1]
  if (lastPage[lastPage.length - 1].trip) {
    pages.push(Array.from({ length: rowsPerPage }, (_, index) => ({
      seq: pages.length * rowsPerPage + index + 1,
      trip: null,
    })))
  }
  const footer = pages[pages.length - 1]
  footer[footer.length - 1] = { seq: '', trip: null, total: true }
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
    ${govPageCss({ size: 'A4 landscape' })}
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
      html, body { height: auto; overflow: hidden; }
      .sheet {
        width: auto;
        min-height: 0;
        height: auto;
        max-height: 170mm;
        padding: 0;
        overflow: hidden;
        page-break-inside: avoid;
      }
      /* ห้ามให้ thead ไปโผล่หน้า 2 ตอนตารางล้นแค่เศษมิลลิเมตร */
      thead { display: table-row-group; }
      table { page-break-inside: avoid; }
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
    /* กว้างขึ้นกว่าเดิมเฉพาะคอลัมน์ที่มีข้อความยาวจริง (c-user/c-drv/c-dest) โดยหักมาจาก
       คอลัมน์ตัวเลข/วันที่ที่มีที่ว่างเหลือ (c-odo/c-date/c-time/c-sum/c-seq/c-note)
       c-user กว้างกว่า c-dest/c-drv อีกนิด (2026-09-05: เจอชื่อผู้ใช้รถจริงขึ้นบรรทัดใหม่
       ทั้งที่ค่าเดิมกว้างพอสำหรับเทสต์แล้ว — เครื่องเจ้าหน้าที่จริงวัดความกว้างตัวอักษรต่างจาก
       ที่วัดได้ในเครื่องมือทดสอบ จึงเผื่อคอลัมน์นี้ไว้มากกว่าคอลัมน์อื่นเล็กน้อยเป็นพิเศษ) */
    col.c-seq { width: 3%; }
    col.c-date { width: 6.8%; }
    col.c-time { width: 5%; }
    col.c-user { width: 16%; }
    col.c-dest { width: 15%; }
    col.c-odo { width: 6.2%; }
    col.c-sum { width: 6%; }
    col.c-drv { width: 14%; }
    col.c-note { width: 10%; }
  </style>
</head>
<body>
${pages.map(rows => sheet({ title, plate, periodLabel, rows, monthlyTotal, originText })).join('\n')}
</body>
</html>`
}
