// ปริมาณการเบิกใช้น้ำมันเชื้อเพลิง — สมุดคุมรายคัน ตามแบบฟอร์มกระดาษที่ อปท. ใช้อยู่
// (ลำดับคอลัมน์/ข้อความหัวตารางต้องตรงต้นฉบับ ห้ามเติมช่องที่ไม่มีบนกระดาษ)
//
// ต่างจาก fleetFuelPrint.js ที่พิมพ์ "รายการเดียวเต็มหน้า" — ใบนี้คือหน้าสมุดคุมที่ลงหลาย
// รายการต่อกันทั้งช่วงเวลา แล้วเติมแถวว่างให้เต็มหน้าเหมือนกระดาษเปล่าที่รอเขียนมือ

import { FUEL_LABEL } from './fleetAssets.js'
import { GOV_FONT_LINK, GOV_PAGE_MARGIN, govDocFontCss, govPageCss } from './govDocStyle.js'

// A4 แนวตั้ง พื้นที่พิมพ์สูง 276 มม. (297 − ขอบบน 12 − ขอบล่าง 9)
//
// ⚠️ ค่านี้วัดจากของจริงในเบราว์เซอร์ ห้ามคำนวณเอาเองจากขนาดฟอนต์ — ครั้งแรกประเมินไว้
// 25 แถว แล้ววัดได้ 289 มม. ล้นพื้นที่พิมพ์ไป 13 มม. (หัวเรื่อง 4 บรรทัด + หัวตาราง 2 แถว
// ที่ 16pt กินที่มากกว่าที่คิด) 22 แถววัดได้ 259.5 มม. เหลือเผื่อ ~16 มม.
//
// ที่เผื่อไว้นั้นจำเป็น เพราะ height ของ td เป็นแค่ "ขั้นต่ำ" — แถวที่หมายเหตุยาวจนขึ้น
// 2–3 บรรทัดจะสูงกว่าแถวปกติหลายมิลลิเมตร ถ้าเผื่อไม่พอ ตารางจะไหลไปกินหน้าถัดไป
// เดือนที่หมายเหตุยาวหลายแถวติดกันจะล้นไปหน้าถัดไปแทนการถูกตัดทิ้ง (ดู @media print)
//
// แถวรวมยอด "แทนที่" แถวว่างแถวสุดท้าย (ไม่ได้เพิ่มแถวใหม่) ความสูงรวมต่อหน้าจึงคงที่
export const FUEL_LEDGER_ROWS_PER_PAGE = 22

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// วันที่บนกระดาษต้นฉบับเขียนย่อ ว/ด/ป พ.ศ. 2 หลัก (เช่น 4/7/69) ไม่ใช่รูปแบบเต็ม
// date-only ของ Postgres ไม่มี timezone จึงแยกสตริงเอง ห้าม new Date('YYYY-MM-DD')
// เพราะเป็น UTC เที่ยงคืน = ได้วันก่อนหน้าในเขตเวลาไทย
export function ledgerDateText(iso) {
  const match = String(iso ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const beYear = Number(match[1]) + 543
  return `${Number(match[3])}/${Number(match[2])}/${String(beYear).slice(-2)}`
}

function numText(value, digits = 2) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return number.toLocaleString('th-TH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function ledgerFuelTypeLabel(record) {
  if (record?.fuel_type === 'other') {
    return String(record.fuel_other_name ?? '').trim() || 'อื่น ๆ'
  }
  return FUEL_LABEL[record?.fuel_type] || String(record?.fuel_type ?? '').trim()
}

function recordCost(record) {
  if (record?.total_cost !== null && record?.total_cost !== undefined && record?.total_cost !== '') {
    const stored = Number(record.total_cost)
    if (Number.isFinite(stored)) return stored
  }
  const liters = Number(record?.liters)
  const price = Number(record?.price_per_liter)
  if (Number.isFinite(liters) && Number.isFinite(price)) return liters * price
  return 0
}

export function ledgerTotals(records) {
  return (records ?? []).reduce((acc, record) => {
    const liters = Number(record?.liters)
    return {
      liters: acc.liters + (Number.isFinite(liters) ? liters : 0),
      cost: acc.cost + recordCost(record),
    }
  }, { liters: 0, cost: 0 })
}

function sortRecords(records) {
  return [...(records ?? [])].sort((a, b) => {
    const aKey = String(a?.filled_at ?? '')
    const bKey = String(b?.filled_at ?? '')
    if (aKey !== bKey) return aKey < bKey ? -1 : 1
    // เติมหลายครั้งในวันเดียวกันต้องเรียงคงที่ทุกครั้งที่พิมพ์ ไม่งั้นเอกสารสองใบที่พิมพ์
    // คนละรอบจะสลับบรรทัดกันเอง ผู้ตรวจสอบเทียบกับใบที่เก็บแฟ้มไว้แล้วจะดูเหมือนถูกแก้
    return String(a?.created_at ?? a?.id ?? '').localeCompare(String(b?.created_at ?? b?.id ?? ''))
  })
}

export function paginateFuelLedger(records, rowsPerPage = FUEL_LEDGER_ROWS_PER_PAGE) {
  const sorted = sortRecords(records)
  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage))
  const pages = Array.from({ length: pageCount }, (_, page) => {
    const slice = sorted.slice(page * rowsPerPage, (page + 1) * rowsPerPage)
    const rows = slice.map(record => ({ record }))
    while (rows.length < rowsPerPage) rows.push({ record: null })
    return rows
  })
  // หน้าสุดท้ายเต็มพอดี = ไม่มีแถวว่างให้แทนที่ด้วยแถวรวม ต้องเปิดหน้าใหม่
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
      <th rowspan="2" class="c-date">วัน/เดือน/ปี</th>
      <th rowspan="2" class="c-doc">ใบส่งของ</th>
      <th rowspan="2" class="c-type">ประเภท</th>
      <th rowspan="2" class="c-price">ราคา/หน่วย</th>
      <th colspan="2">การเติมน้ำมันเชื้อเพลิง</th>
      <th rowspan="2" class="c-note">หมายเหตุ</th>
    </tr>
    <tr>
      <th class="c-liters">จำนวน/ลิตร</th>
      <th class="c-baht">จำนวน(บาท)</th>
    </tr>
  </thead>`
}

function dataRow(row, totals) {
  if (row.total) {
    return `<tr class="total">
      <td colspan="4" class="total-label">รวมทั้งสิ้น</td>
      <td>${esc(numText(totals.liters, 2))}</td>
      <td>${esc(numText(totals.cost, 2))}</td>
      <td></td>
    </tr>`
  }
  const record = row.record
  if (!record) {
    // แถวว่างไม่มีเนื้อหาให้ตัดบรรทัด จึงตั้งให้สูงกว่าแถวข้อมูลได้อย่างปลอดภัย
    // ใช้ดันตารางให้ลงไปเต็มพื้นที่พิมพ์เวลาช่วงนั้นมีรายการน้อย แทนที่จะเหลือขาวเป็นแผ่น
    return `<tr class="blank-filler">
      <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
    </tr>`
  }
  return `<tr>
    <td>${esc(ledgerDateText(record.filled_at))}</td>
    <td class="left"><span class="cell">${esc(String(record.receipt_no ?? '').trim())}</span></td>
    <td>${esc(ledgerFuelTypeLabel(record))}</td>
    <td>${esc(numText(record.price_per_liter, 2))}</td>
    <td>${esc(numText(record.liters, 2))}</td>
    <td>${esc(numText(recordCost(record), 2))}</td>
    <td class="left"><span class="cell cell--clamp">${esc(String(record.notes ?? '').trim())}</span></td>
  </tr>`
}

export function ledgerVehicleTitle(vehicle) {
  const name = String(vehicle?.name ?? '').trim()
  const plate = String(vehicle?.license_plate ?? vehicle?.asset_code ?? '').trim()
  if (!name && !plate) return ''
  if (!plate) return name
  return `${name} หมายเลขทะเบียน ${plate}`
}

function sheet({ vehicleLine, periodLabel, orgName, rows, totals }) {
  return `<section class="sheet">
    ${orgName ? `<p class="org">${esc(orgName)}</p>` : ''}
    <h1>ปริมาณการเบิกใช้น้ำมันเชื้อเพลิง</h1>
    ${vehicleLine ? `<p class="vehicle">${esc(vehicleLine)}</p>` : ''}
    ${periodLabel ? `<p class="period">${esc(periodLabel)}</p>` : ''}
    <table>
      <colgroup>
        <col class="c-date"><col class="c-doc"><col class="c-type"><col class="c-price">
        <col class="c-liters"><col class="c-baht"><col class="c-note">
      </colgroup>
      ${tableHeader()}
      <tbody>
        ${rows.map(row => dataRow(row, totals)).join('')}
      </tbody>
    </table>
  </section>`
}

export function buildFleetFuelLedgerHtml({ vehicle, records = [], periodLabel = '', orgName = '' }) {
  const vehicleLine = ledgerVehicleTitle(vehicle)
  const totals = ledgerTotals(records)
  const pages = paginateFuelLedger(records)
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>ปริมาณการเบิกใช้น้ำมันเชื้อเพลิง ${esc(vehicleLine)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      color: #000;
      /* ตารางนี้ 7 คอลัมน์ กว้างพอใช้ 16pt ได้ทั้งใบ จึงใช้มาตรฐานกลางเต็มรูปแบบ
         ไม่ต้องขอยกเว้นขนาดตัวอักษรเหมือนแบบ 4 (12 คอลัมน์แนวนอน) */
      ${govDocFontCss()}
      background: #fff;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      padding: ${GOV_PAGE_MARGIN};
      overflow: hidden;
    }
    .sheet + .sheet { page-break-before: always; }
    @media print {
      html, body { height: auto; }
      .sheet {
        width: auto;
        min-height: 0;
        height: auto;
        padding: 0;
      }
      /* ตั้งใจไม่ตัดด้วย max-height + overflow:hidden แบบแบบ 4 — ใบนี้เป็นเอกสารการเงิน
         ที่ใช้สอบยันกับใบเสร็จ ถ้าเดือนไหนหมายเหตุยาวหลายแถวจนตารางสูงเกินหน้า การตัดทิ้ง
         จะทำให้ "รายการเติมน้ำมันหายไปเงียบๆ" โดยไม่มีสัญญาณเตือน ยอมให้ล้นไปหน้าถัดไป
         (ได้หน้าเกินมาบ้าง) ดีกว่ายอมให้ข้อมูลหาย — เคสปกติวัดได้ 259.5 มม. จบหน้าเดียวอยู่แล้ว
         หัวตารางซ้ำทุกหน้า และแถวเดียวห้ามถูกตัดครึ่งคาบสองหน้า */
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
    }
    .org { margin: 0; text-align: center; font-size: 14pt; }
    h1 { margin: 2pt 0 0; text-align: center; font-size: 18pt; font-weight: 700; line-height: 1.15; }
    .vehicle { margin: 0; text-align: center; font-weight: 700; }
    .period { margin: 0 0 4pt; text-align: center; font-size: 14pt; }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #000;
      vertical-align: middle;
      text-align: center;
    }
    th { font-weight: 700; line-height: 1.15; padding: 1px 3px; }
    /* height เป็นแค่ "ขั้นต่ำ" ของ td — แถวที่ใบส่งของ/หมายเหตุยาวเกินคอลัมน์จะตัดขึ้น
       บรรทัดใหม่แล้วสูงกว่านี้เอง ข้อมูลจึงไม่หายแม้แลกกับพิมพ์ได้น้อยแถวลงต่อหน้า
       ⚠️ ต้องตั้งค่าไว้ ไม่ปล่อยให้สูงตามเนื้อหาล้วน เพราะ <td></td> ของแถวว่างไม่มี
       line box ให้ยึด จะเหลือแค่ padding แล้วตารางกลายเป็นแถบหนา-บางสลับกัน */
    td { height: 8mm; padding: 1mm 4px; line-height: 1.2; }
    tr.blank-filler td { height: 8.6mm; }
    td.left { text-align: left; }
    td.left .cell { display: block; white-space: normal; overflow-wrap: break-word; }
    /* หมายเหตุเป็นข้อความอิสระที่ยาวได้ไม่จำกัด กันไว้ 2 บรรทัดไม่ให้แถวเดียวดันทั้งหน้าล้น
       ⚠️ ยาวเกิน 3 บรรทัดจะถูกตัดด้วย "…" — ช่องหมายเหตุบนใบต้นฉบับเจตนาให้เขียนสั้น
       ข้อความเต็มยังอ่านได้ในระบบเสมอ ส่วนใบส่งของ (เลขที่เอกสาร) ไม่ clamp เพราะต้อง
       อ่านครบทุกหลักเวลาสอบยันกับใบเสร็จ */
    /* หมายเหตุเล็กกว่าช่องอื่น 3pt — ยกเว้นเฉพาะ "ขนาดตัวอักษร" ของช่องนี้ช่องเดียว
       (ฟอนต์/ขอบกระดาษยังเป็นมาตรฐานกลาง) ที่ 16pt ข้อความ 3 บรรทัดดันแถวสูง 22 มม.
       เกือบสามเท่าแถวปกติ พิมพ์ได้น้อยแถวลงมากและเสี่ยงล้นหน้า */
    td.left .cell--clamp {
      font-size: 13pt;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tr.total td {
      font-weight: 700;
      background: #ececec;
      border-top: 2px solid #000;
      height: 8.6mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tr.total .total-label { text-align: right; padding-right: 12px; letter-spacing: 0.06em; }
    col.c-date { width: 12%; }
    col.c-doc { width: 22%; }
    col.c-type { width: 11%; }
    col.c-price { width: 12%; }
    col.c-liters { width: 13%; }
    col.c-baht { width: 15%; }
    col.c-note { width: 15%; }
  </style>
</head>
<body>
${pages.map(rows => sheet({ vehicleLine, periodLabel, orgName, rows, totals })).join('\n')}
</body>
</html>`
}
