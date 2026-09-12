import {
  GOV_SIGN_LINE_W, govNameBlank, govSignBlockCss, govSignRow,
} from './govSignBlock.js'
import { FUEL_LABEL, assetIdentifier, meterUnitShort } from './fleetAssets.js'
import { fuelRecordAmount } from './fleetFuelAmount.js'
import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, GOV_PAGE_MARGIN, govDocFontCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'

const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatBEDate(iso) {
  const match = String(iso ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return `${day} ${MONTHS_TH[month - 1]} พ.ศ. ${year + 543}`
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

export function fuelTypeLabel(record) {
  if (record?.fuel_type === 'other') {
    return String(record.fuel_other_name ?? '').trim() || 'อื่น ๆ'
  }
  return FUEL_LABEL[record?.fuel_type] || String(record?.fuel_type ?? '').trim()
}

function row(label, value) {
  const text = String(value ?? '').trim()
  return `<tr>
    <th>${esc(label)}</th>
    <td class="${text ? 'is-filled' : ''}">${text ? esc(text) : ''}</td>
  </tr>`
}

// ⚠️ ของเดิมจัดกึ่งกลาง "ของบล็อก" ทั้งเส้นและวงเล็บ วงเล็บจึงเยื้องไปทางซ้ายของเส้น
// ครึ่งหนึ่งของคำว่า "ลงชื่อ" (~5mm) — อาการเดียวกับที่เจ้าของระบบจับได้จากใบยืมพัสดุ
// ที่พิมพ์ออกกระดาษ ของกลางมัดเส้นกับบรรทัดใต้ไว้บนแกนเดียวกัน
function signature(role, name) {
  const inner = String(name ?? '').trim()
  return `<div class="sign center-row">
    ${govSignRow({
      width: GOV_SIGN_LINE_W,
      below: [inner ? `(${esc(inner)})` : govNameBlank(GOV_SIGN_LINE_W), esc(role)],
    })}
  </div>`
}

export function buildFleetFuelRecordHtml({ record, tenant }) {
  const org = String(tenant?.name ?? '').trim() || 'หน่วยงาน'
  const vehicle = record?.fleet_vehicles || record?.vehicle
  const plate = assetIdentifier(vehicle)
  const vehicleName = String(vehicle?.name ?? '').trim()
  const unit = meterUnitShort(vehicle)
  const liters = numText(record?.liters, 3)
  const price = numText(record?.price_per_liter, 2)
  // ยอดตามบิลมาก่อนยอดคำนวณเสมอ (ดู fleetFuelAmount.js) — null = ไม่มีข้อมูลพอจะบอกยอด
  const amount = fuelRecordAmount(record)
  const cost = amount === null ? '' : amount
  const odometer = record?.odometer == null || record?.odometer === ''
    ? ''
    : `${numText(record.odometer, 0)} ${unit}`
  const efficiency = record?.efficiency_kml == null || record?.efficiency_kml === ''
    ? ''
    : `${numText(record.efficiency_kml, 2)} กม./ลิตร`
  const driver = record?.driver?.full_name || ''
  const recorder = record?.creator?.full_name || ''
  const tank = record?.full_tank === false ? 'ไม่เต็มถัง' : 'เต็มถัง'
  const anomaly = record?.is_anomaly
    ? `ผิดปกติ${record.anomaly_reason ? ` — ${record.anomaly_reason}` : ''}`
    : 'ปกติ'

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>บันทึกการเติมน้ำมันเชื้อเพลิง ${esc(plate)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      padding: ${GOV_PAGE_MARGIN};
      color: #000;
      ${govDocFontCss()}
      background: #fff;
    }
    @media print { .sheet { width: auto; min-height: auto; padding: 0; } }
    h1 { margin: 2pt 0 0; text-align: center; font-size: 18pt; font-weight: 700; }
    .org { margin: 0; text-align: center; font-size: 14pt; }
    table { width: 100%; border-collapse: collapse; margin-top: 14pt; }
    th, td { border: 1px solid #000; padding: 5px 8px; vertical-align: middle; }
    th {
      width: 38%;
      text-align: left;
      font-weight: 400;
      background: #f3f3f3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    td { font-weight: 700; min-height: 1.3em; }
    td:not(.is-filled) { height: 1.35em; }
    .total th, .total td { font-size: 16pt; background: #ececec; }
    .signs {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-top: 36pt;
    }
    .sign { text-align: center; }
${govSignBlockCss()}
    /* 9em เดิมไล่ไว้ตอนตัวอักษร 14pt พอขยายเป็น 16pt ตามมาตรฐาน 3 คอลัมน์รวมกัน
       กว้าง 608px เกินพื้นที่พิมพ์ 605px ทำให้ช่องขวาสุดถูกตัด — 8.5em พอดีไม่ล้น */

    .note { margin-top: 16pt; font-size: 11pt; color: #444; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 5mm; text-align: center; }
  </style>
</head>
<body>
<div class="sheet">
  <p class="org">${esc(org)}</p>
  <h1>บันทึกการเติมน้ำมันเชื้อเพลิง</h1>
  <table>
    ${row('วันที่เติม', formatBEDate(record?.filled_at))}
    ${row('ยานพาหนะ', vehicleName)}
    ${row('หมายเลขทะเบียน', plate === '—' ? '' : plate)}
    ${row('ผู้ใช้รถ', driver)}
    ${row('เลขไมล์ / ค่ามิเตอร์', odometer)}
    ${row('ชนิดเชื้อเพลิง', fuelTypeLabel(record))}
    ${row('ปริมาณ', liters ? `${liters} ลิตร` : '')}
    ${row('ราคาต่อลิตร', price ? `${price} บาท` : '')}
    <tr class="total"><th>รวมเป็นเงิน</th><td class="${cost === '' ? '' : 'is-filled'}">${cost === '' ? '' : `${esc(numText(cost, 2))} บาท`}</td></tr>
    ${row('ลักษณะการเติม', tank)}
    ${row('สถานีบริการ / ปั๊ม', record?.fuel_station)}
    ${row('เลขที่ใบรับสินค้า/ใบส่งของ', record?.receipt_no)}
    ${row('อัตราสิ้นเปลือง', efficiency)}
    ${row('ผลการตรวจสอบ', anomaly)}
    ${row('หมายเหตุ', record?.notes)}
  </table>
  <div class="signs">
    ${signature('ผู้ใช้รถ', driver)}
    ${signature('ผู้บันทึก', recorder)}
    ${signature('หัวหน้ากอง/ผู้แทน', '')}
  </div>
  ${record?.receipt_url ? '<p class="note">มีสำเนาใบเสร็จแนบในระบบ</p>' : ''}
  <div class="eservice-origin">${esc(govEServiceOriginText(tenant))}</div>
</div>
</body>
</html>`
}
