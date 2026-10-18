// แบบ 6 รายละเอียดการซ่อมบำรุง — สมุดรายการซ่อมบำรุงรายคัน
// ตามแบบท้ายระเบียบกระทรวงมหาดไทยว่าด้วยการใช้และรักษายานพาหนะขององค์กรปกครองส่วนท้องถิ่น
// พ.ศ. ๒๕๖๙ ข้อ ๒๑ (ใช้บังคับ 17 มี.ค. 2569) — ลำดับคอลัมน์/หัวตารางต้องตรงแบบท้ายระเบียบ
//
// ข้อมูลมาจาก fleet_maintenance ที่เจ้าหน้าที่บันทึกอยู่แล้ว ไม่ต้องกรอกอะไรเพิ่ม ยกเว้น 2 จุด
// ที่ตั้งใจไว้ (เจ้าของระบบเลือก 2026-10-17):
//   · "วันตรวจรับ" ระบบไม่มีข้อมูล → เว้นว่างให้กรรมการตรวจรับเขียนเอง (ไม่เดาจากวันที่ซ่อม
//     เพราะวันตรวจรับคือวันที่รับงานจริง เป็นคนละวันกับวันส่งซ่อมได้)
//   · แบบท้ายระเบียบ "ไม่มีช่องวันที่ซ่อม" → ใส่วันที่ซ่อมไว้ในช่องหมายเหตุ ไม่งั้นผู้ตรวจสอบ
//     จับคู่รายการกับใบเสร็จ/ฎีกาไม่ได้

import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, GOV_PAGE_MARGIN, govDocFontCss, govEServiceOriginText, govPageCss, govPagePadding } from './govDocStyle.js'

// A4 แนวตั้ง พื้นที่พิมพ์สูง 276 มม. — วัดจากของจริงในเบราว์เซอร์ (tests/fleet-form6-print.test.mjs)
// ห้ามคำนวณเองจากขนาดฟอนต์ เครื่องที่ไม่มีฟอนต์ราชการใช้ฟอนต์สำรองที่ font-size-adjust ขยายให้
// เท่ากัน ตัวอักษรจึงกว้างกว่าที่คิด: รายการซ่อม ~68 ตัวอักษร (ยาวสุดในข้อมูลจริง) = 3 บรรทัด
// แถวละ ~16 มม. → 12 แถวสูง ~195 มม. พอดีพื้นที่ใต้หัวตาราง (~219 มม.) โดยเหลือเผื่อ
// height ของ td เป็นแค่ขั้นต่ำ แถวที่ยาวกว่านั้นจะสูงขึ้นเองแล้วไหลไปหน้าถัดไปแทนการถูกตัด
// (เอกสารการเงิน ห้ามให้รายการหายเงียบๆ)
export const FORM6_ROWS_PER_PAGE = 12

export const MAINTENANCE_TYPE_LABEL = {
  routine: 'บำรุงรักษา',
  oil_change: 'เปลี่ยนถ่ายน้ำมัน',
  repair: 'ซ่อมแซม',
  inspection: 'ตรวจสภาพ',
  tire: 'ยาง',
  battery: 'แบตเตอรี่',
  emission: 'ตรวจวัดมลพิษ',
  other: 'อื่นๆ',
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// date-only ของ Postgres ไม่มี timezone — แยกสตริงเอง ห้าม new Date('YYYY-MM-DD')
// (UTC เที่ยงคืน = วันก่อนหน้าในเขตเวลาไทย) รูปแบบย่อ ว/ด/ปป พ.ศ. แบบสมุดที่เขียนมือ
export function form6DateText(iso) {
  const match = String(iso ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  return `${Number(match[3])}/${Number(match[2])}/${String(Number(match[1]) + 543).slice(-2)}`
}

// แบบ 6 แยกช่อง "บาท" กับ "สต." — คิดเป็นสตางค์จำนวนเต็มก่อนแยก กันทศนิยมลอยตัว
// (เช่น 1999.95 * 100 = 199994.99999 ถ้าปัดลงตรงๆ จะได้ 94 สตางค์)
export function splitBahtSatang(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const cents = Math.round(number * 100)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return {
    baht: sign + Math.floor(abs / 100).toLocaleString('th-TH'),
    satang: String(abs % 100).padStart(2, '0'),
  }
}

function meterText(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : ''
}

export function form6ItemText(record) {
  const description = String(record?.description ?? '').trim()
  if (description) return description
  return MAINTENANCE_TYPE_LABEL[record?.maintenance_type] || ''
}

// หมายเหตุ = วันที่ซ่อม (แบบท้ายระเบียบไม่มีช่องนี้) — ใส่แค่วันที่ คอลัมน์แคบ ใส่ประเภทด้วย
// แล้วแถวสูง 3 บรรทัดจนพิมพ์ได้น้อยแถวลงมาก ประเภทดูได้จาก "รายการซ่อม" อยู่แล้ว
export function form6NoteText(record) {
  const date = form6DateText(record?.service_date)
  return date ? `ซ่อม ${date}` : ''
}

export function form6Total(records) {
  const cents = (records ?? []).reduce((sum, record) => {
    const number = Number(record?.cost)
    return sum + (Number.isFinite(number) ? Math.round(number * 100) : 0)
  }, 0)
  return cents / 100
}

function sortRecords(records) {
  return [...(records ?? [])].sort((a, b) => {
    const aKey = String(a?.service_date ?? '')
    const bKey = String(b?.service_date ?? '')
    if (aKey !== bKey) return aKey < bKey ? -1 : 1
    // ซ่อมหลายรายการวันเดียวกันต้องเรียงคงที่ทุกครั้งที่พิมพ์ ใบที่พิมพ์คนละรอบจะได้ตรงกัน
    return String(a?.created_at ?? a?.id ?? '').localeCompare(String(b?.created_at ?? b?.id ?? ''))
  })
}

// แถวรวมยอด "แทนที่" แถวว่างแถวสุดท้าย ความสูงต่อหน้าจึงคงที่ · หน้าสุดท้ายเต็มพอดี = เปิดหน้าใหม่
export function paginateForm6(records, rowsPerPage = FORM6_ROWS_PER_PAGE) {
  const sorted = sortRecords(records)
  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage))
  const pages = Array.from({ length: pageCount }, (_, page) => {
    const rows = sorted.slice(page * rowsPerPage, (page + 1) * rowsPerPage)
      .map((record, index) => ({ record, no: page * rowsPerPage + index + 1 }))
    while (rows.length < rowsPerPage) rows.push({ record: null })
    return rows
  })
  const lastPage = pages[pages.length - 1]
  if (lastPage[lastPage.length - 1].record) {
    pages.push(Array.from({ length: rowsPerPage }, () => ({ record: null })))
  }
  const footer = pages[pages.length - 1]
  footer[footer.length - 1] = { record: null, total: true }
  return pages
}

function tableHeader() {
  return `<thead>
    <tr>
      <th rowspan="2" class="c-no">ลำดับ<br>ที่</th>
      <th rowspan="2" class="c-meter">เลขระยะทาง<br>เมื่อเข้าซ่อม</th>
      <th rowspan="2" class="c-item">รายการซ่อม</th>
      <th colspan="2">จำนวนเงิน</th>
      <th rowspan="2" class="c-place">สถานที่ซ่อม</th>
      <th rowspan="2" class="c-accept">วัน<br>ตรวจรับ</th>
      <th rowspan="2" class="c-note">หมายเหตุ</th>
    </tr>
    <tr>
      <th class="c-baht">บาท</th>
      <th class="c-satang">สต.</th>
    </tr>
  </thead>`
}

function dataRow(row, total) {
  if (row.total) {
    const money = splitBahtSatang(total)
    return `<tr class="total">
      <td colspan="3" class="total-label">รวม</td>
      <td class="num">${esc(money?.baht ?? '')}</td>
      <td class="num">${esc(money?.satang ?? '')}</td>
      <td></td><td></td><td></td>
    </tr>`
  }
  const record = row.record
  if (!record) {
    return `<tr class="blank-filler"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`
  }
  const money = splitBahtSatang(record.cost)
  return `<tr>
    <td>${row.no}</td>
    <td class="num">${esc(meterText(record.odometer))}</td>
    <td class="left">${esc(form6ItemText(record))}</td>
    <td class="num">${esc(money?.baht ?? '')}</td>
    <td class="num">${esc(money?.satang ?? '')}</td>
    <td class="left">${esc(String(record.vendor ?? '').trim())}</td>
    <td></td>
    <td class="left note">${esc(form6NoteText(record))}</td>
  </tr>`
}

function sheet({ vehicle, periodLabel, orgName, rows, total }) {
  const name = String(vehicle?.name ?? '').trim()
  const plate = String(vehicle?.license_plate ?? vehicle?.asset_code ?? '').trim()
  return `<section class="sheet">
    <p class="form-no">แบบ 6</p>
    <h1>รายละเอียดการซ่อมบำรุง</h1>
    <p class="vehicle">ยานพาหนะ <span class="fill">${esc(name)}</span>
      หมายเลขทะเบียน <span class="fill">${esc(plate)}</span></p>
    ${periodLabel ? `<p class="period">${esc(periodLabel)}</p>` : ''}
    <table>
      <colgroup>
        <col class="c-no"><col class="c-meter"><col class="c-item"><col class="c-baht"><col class="c-satang">
        <col class="c-place"><col class="c-accept"><col class="c-note">
      </colgroup>
      ${tableHeader()}
      <tbody>${rows.map(row => dataRow(row, total)).join('')}</tbody>
    </table>
    <div class="eservice-origin">${esc(govEServiceOriginText(orgName))}</div>
  </section>`
}

export function buildFleetForm6Html({ vehicle, records = [], periodLabel = '', orgName = '' }) {
  const total = form6Total(records)
  const pages = paginateForm6(records)
  const plate = String(vehicle?.license_plate ?? vehicle?.asset_code ?? '').trim()
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>แบบ 6 รายละเอียดการซ่อมบำรุง ${esc(plate)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { color: #000; ${govDocFontCss()} background: #fff; }
    .sheet { width: 210mm; min-height: 297mm; padding: ${GOV_PAGE_MARGIN}; overflow: hidden; }
    .sheet + .sheet { page-break-before: always; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 4mm; text-align: center; }
    @media print {
      html, body { height: auto; }
      .sheet { width: auto; min-height: 0; height: auto; padding: ${govPagePadding()}; }
      /* ไม่ตัดด้วย overflow — รายการซ่อมยาวผิดปกติให้ไหลไปหน้าถัดไป ดีกว่ารายการหายเงียบๆ */
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
    }
    p { margin: 0; }
    .form-no { text-align: right; }
    h1 { margin: 0; text-align: center; font-size: 18pt; font-weight: 700; line-height: 1.2; }
    .vehicle { margin-top: 4pt; }
    .vehicle .fill { display: inline-block; min-width: 30mm; border-bottom: 1px dotted #333; padding: 0 4px; }
    .period { margin: 2pt 0 4pt; text-align: center; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 4pt; }
    th, td { border: 1px solid #000; vertical-align: middle; text-align: center; overflow-wrap: anywhere; }
    /* ตาราง 12pt — ยกเว้นเฉพาะ "ขนาดตัวอักษร" ตามที่มาตรฐานกลางเปิดช่องไว้ (แบบเดียวกับแบบ 4)
       8 คอลัมน์ในพื้นที่ 160 มม.: วัดจริงที่ 14pt รายการซ่อมยาว ~60 ตัวอักษร (ค่าเฉลี่ยข้อมูลจริง)
       ตัด 3 บรรทัด + หมายเหตุ 3 บรรทัด แถวละ ~23 มม. พิมพ์ได้ไม่ถึง 10 แถวต่อหน้า
       ที่ 12pt รายการซ่อมเหลือ 2 บรรทัด · ฟอนต์และขอบกระดาษยังเป็นมาตรฐานกลาง */
    table { font-size: 12pt; }
    /* หัวตาราง 11pt + จุดตัดบรรทัดกำหนดเอง (<br>) — ปล่อยเบราว์เซอร์ตัดเองได้ "เลขระยะ|ทาง"
       คอลัมน์ลำดับแคบสุด (9.6 มม.) วัดแล้ว "ลำดับ" ที่ 11pt ล้นเส้นตาราง จึงย่อเฉพาะหัวช่องนี้ */
    th { font-size: 11pt; font-weight: 700; line-height: 1.15; padding: 1px 2px; }
    th.c-no { font-size: 10pt; }
    td { height: 11mm; padding: 1mm 3px; line-height: 1.12; }
    /* แถวว่างสูงพอเขียนมือ 2 บรรทัด และดันตารางให้เต็มหน้าเหมือนสมุดเปล่า */
    tr.blank-filler td { height: 15mm; }
    td.left { text-align: left; }
    td.num { text-align: right; }
    tr.total td { font-weight: 700; background: #ececec; border-top: 2px solid #000;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr.total .total-label { text-align: right; padding-right: 10px; }
    /* รายการซ่อมได้ที่มากที่สุด (59 มม.) — ข้อความยาวสุดในข้อมูลจริง ~68 ตัวอักษร = 3 บรรทัด */
    col.c-no { width: 6%; }
    col.c-meter { width: 12%; }
    col.c-item { width: 37%; }
    col.c-baht { width: 9%; }
    col.c-satang { width: 5%; }
    col.c-place { width: 13%; }
    col.c-accept { width: 8%; }
    col.c-note { width: 10%; }
  </style>
</head>
<body>
${pages.map(rows => sheet({ vehicle, periodLabel, orgName, rows, total })).join('\n')}
</body>
</html>`
}
