// แบบ 4 บันทึกการใช้รถ — รายคัน รายเดือน ตามแบบฟอร์มกระดาษ
// (ลำดับคอลัมน์/ข้อความหัวตารางต้องตรงต้นฉบับ ห้ามเติมช่องที่ไม่มีบนกระดาษ)

export const FORM4_ROWS_PER_PAGE = 22

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

function remarkText(trip) {
  const parts = []
  const notes = String(trip?.notes ?? '').trim()
  const backdated = String(trip?.backdated_reason ?? '').trim()
  if (notes) parts.push(notes)
  if (backdated) parts.push(`ย้อนหลัง: ${backdated}`)
  return parts.join(' ')
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
      <th rowspan="2" class="c-seq">ลำดับที่</th>
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
    return `<tr>
      <td class="c-seq"></td>
      <td></td><td></td><td></td><td></td><td></td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
    </tr>`
  }
  const depart = departureParts(trip)
  const returned = returnParts(trip)
  const userName = String(trip.requester?.full_name ?? '').trim()
  const driverName = String(trip.driver?.full_name ?? '').trim()
  return `<tr>
    <td class="c-seq">${row.seq}</td>
    <td>${esc(depart.date)}</td>
    <td>${esc(depart.time)}</td>
    <td class="left">${esc(userName)}</td>
    <td class="left">${esc(String(trip.destination ?? '').trim())}</td>
    <td>${esc(meterText(trip.odometer_start))}</td>
    <td>${esc(returned.date)}</td>
    <td>${esc(returned.time)}</td>
    <td>${esc(meterText(trip.odometer_end))}</td>
    <td>${esc(distanceText(trip))}</td>
    <td class="left">${esc(driverName)}</td>
    <td class="left">${esc(remarkText(trip))}</td>
  </tr>`
}

function sheet({ title, plate, periodLabel, rows, monthlyTotal }) {
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
  </section>`
}

export function buildFleetForm4Html({ vehicle, trips = [], periodLabel = '' }) {
  const title = form4VehicleTitle(vehicle)
  const plate = form4PlateText(vehicle)
  const monthlyTotal = monthlyDistanceKm(trips)
  const pages = paginateForm4Trips(trips)
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>${esc(title)} ${esc(plate)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 landscape; margin: 7mm 9mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      color: #000;
      font-family: "TH Sarabun New", "Sarabun", sans-serif;
      background: #fff;
    }
    .sheet {
      width: 297mm;
      min-height: 210mm;
      padding: 7mm 9mm;
      overflow: hidden;
    }
    .sheet + .sheet { page-break-before: always; }
    @media print {
      html, body { height: auto; overflow: hidden; }
      .sheet {
        width: auto;
        min-height: 0;
        height: auto;
        max-height: 196mm;
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
      font-size: 11pt;
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
    td {
      height: 6.15mm;
      padding: 0 4px;
      line-height: 6.15mm;
      white-space: nowrap;
      overflow: hidden;
    }
    td.left { text-align: left; }
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
    col.c-seq { width: 4.6%; }
    col.c-date { width: 7.8%; }
    col.c-time { width: 5.4%; }
    col.c-user { width: 13%; }
    col.c-dest { width: 15.4%; }
    col.c-odo { width: 8%; }
    col.c-sum { width: 6.6%; }
    col.c-drv { width: 11%; }
    col.c-note { width: 7%; }
  </style>
</head>
<body>
${pages.map(rows => sheet({ title, plate, periodLabel, rows, monthlyTotal })).join('\n')}
</body>
</html>`
}
