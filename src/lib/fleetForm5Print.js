// แบบ 5 รายงานการสูญหาย/ความเสียหายยานพาหนะ — ระเบียบกระทรวงมหาดไทยว่าด้วยการใช้และรักษา
// ยานพาหนะขององค์กรปกครองส่วนท้องถิ่น พ.ศ. ๒๕๖๙ ข้อ ๑๘ (ใช้บังคับ 17 มี.ค. 2569)
// ลำดับหัวข้อ/ถ้อยคำต้องตรงแบบท้ายระเบียบ · แบบต้นฉบับไม่มีช่องลงนาม — คงตามต้นฉบับ
// (เจ้าของระบบเลือก 2026-10-18)
//
// ข้อมูลมาจาก fleet_incidents + fleet_incident_people ที่ผู้ดูแลยานพาหนะกรอกไว้ในระบบ
// ช่องที่ยังไม่ได้กรอกพิมพ์เป็นเส้นประให้เขียนมือได้ (ทางสำรอง) — พิมพ์ซ้ำได้ทุกเมื่อ
// ผู้บาดเจ็บ/พยานเว้นที่ไว้อย่างน้อย 2 คนตามแบบ มีมากกว่านั้นพิมพ์ครบทุกคน

import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, GOV_PAGE_MARGIN, govDocFontCss, govEServiceOriginText, govPageCss, govPagePadding } from './govDocStyle.js'
import { MONTHS_TH } from './thaiDate.js'
import { defaultAddressee } from './fleetFuelMemoPrint.js'

export const FORM5_MIN_PEOPLE_ROWS = 2

export const INCIDENT_KIND_LABEL = { damage: 'ความเสียหาย', loss: 'สูญหาย' }

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

// date-only ของ Postgres ไม่มี timezone — แยกสตริงเอง ห้าม new Date('YYYY-MM-DD')
function dateParts(iso) {
  const match = String(iso ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return { day: Number(match[3]), month: MONTHS_TH[Number(match[2]) - 1] ?? '', year: Number(match[1]) + 543 }
}

export function form5DateText(iso) {
  const parts = dateParts(iso)
  return parts ? `${parts.day} ${parts.month} ${parts.year}` : ''
}

export function form5TimeText(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/)
  return match ? `${match[1].padStart(2, '0')}.${match[2]}` : ''
}

export function form5SpeedText(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('th-TH', { maximumFractionDigits: 1 }) : ''
}

// บุคคลตามบทบาท เรียงตามลำดับที่กรอก · ผู้บาดเจ็บ/พยานเติมแถวว่างให้ครบขั้นต่ำของแบบ
export function form5People(people, role, minRows = 0) {
  const rows = (people ?? [])
    .filter(person => person?.role === role)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  while (rows.length < minRows) rows.push(null)
  return rows
}

function fill(value, cls = '') {
  const text = clean(value)
  return `<span class="fill${cls ? ` ${cls}` : ''}">${esc(text)}</span>`
}

function label(text) {
  return `<span class="lbl">${esc(text)}</span>`
}

// บรรทัดแบบ "ป้าย ....ค่า.... ป้าย ....ค่า...." — ค่าว่าง = เส้นประให้เขียนมือ
function line(parts, cls = '') {
  return `<div class="line${cls ? ` ${cls}` : ''}">${parts.join('')}</div>`
}

// ข้อความยาว (ความเสียหาย/เหตุเกิดจาก/ผลคดี) ตัดหลายบรรทัดได้ ขีดเส้นประใต้ทุกบรรทัดที่เขียน
// ว่าง = เส้นประตามจำนวนบรรทัดในแบบ
function longField(title, value, { blankLines = 2, bold = false } = {}) {
  const titleHtml = bold ? `<b>${esc(title)}</b>` : esc(title)
  const text = String(value ?? '').trim()
  if (text) {
    return `<div class="long"><span class="lbl">${titleHtml}</span><span class="long-text">${esc(text)}</span></div>`
  }
  const extra = Array.from({ length: Math.max(0, blankLines - 1) }, () => line([fill('')])).join('')
  return line([`<span class="lbl">${titleHtml}</span>`, fill('')]) + extra
}

// แถวบุคคล (ผู้บาดเจ็บ/พยาน) — แบบมีบรรทัดต่อที่อยู่ใต้แต่ละคน เว้นไว้เฉพาะช่องที่ยังว่าง
// ช่องที่กรอกแล้วไม่ต้องมีเส้นเปล่าให้เขียนเพิ่ม (ข้อมูลมาจากระบบ)
function personBlock(person, nameLabel, addressLabel) {
  const row = line([
    label(nameLabel), fill(person?.full_name, 'w-name'),
    label('อายุ'), fill(person?.age ?? '', 'w-age'), label(`ปี ${addressLabel}`), fill(person?.address),
  ])
  return person ? row : row + line([fill('')])
}

export function buildFleetForm5Html({ incident = {}, people = [], vehicle = {}, orgName = '' }) {
  const plate = clean(vehicle?.license_plate ?? vehicle?.asset_code)
  const report = dateParts(incident.report_date)
  const addressee = clean(incident.addressee) || defaultAddressee(orgName)
  const otherDriver = form5People(people, 'other_driver')[0] ?? null
  const otherOwner = form5People(people, 'other_owner')[0] ?? null
  const investigator = form5People(people, 'investigator')[0] ?? null
  const injured = form5People(people, 'injured', FORM5_MIN_PEOPLE_ROWS)
  const witnesses = form5People(people, 'witness', FORM5_MIN_PEOPLE_ROWS)

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>แบบ 5 รายงานการสูญหาย/ความเสียหายยานพาหนะ ${esc(plate)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { color: #000; ${govDocFontCss()} background: #fff; }
    .sheet { width: 210mm; min-height: 297mm; padding: ${GOV_PAGE_MARGIN}; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 4mm; text-align: center; }
    @media print {
      html, body { height: auto; }
      /* รายงานที่มีผู้บาดเจ็บ/พยานหลายคนไหลไปหน้าถัดไปได้ ไม่ตัดทิ้ง */
      .sheet { width: auto; min-height: 0; height: auto; padding: ${govPagePadding()}; }
      .line, .long { page-break-inside: avoid; }
    }
    p { margin: 0; }
    .form-no { text-align: right; font-weight: 700; }
    .date { text-align: right; }
    .line { display: flex; align-items: flex-end; gap: 0 4px; min-height: 1.25em; margin-top: 1.5pt; }
    .lbl { white-space: nowrap; }
    .fill { flex: 1 1 0; min-width: 8mm; border-bottom: 1px dotted #333; padding: 0 3px; overflow-wrap: anywhere; }
    .fill.w-name { flex: 2.2 1 0; }
    .fill.w-age { flex: 0 0 12mm; text-align: center; }
    .fill.w-day { flex: 0 0 14mm; text-align: center; }
    .fill.w-month { flex: 0 0 32mm; text-align: center; }
    .fill.w-year { flex: 0 0 16mm; text-align: center; }
    .fill.w-time { flex: 0.6 1 0; }
    .fill.w-short { flex: 0.5 1 0; }
    .date .line { justify-content: flex-end; }
    .long { margin-top: 1.5pt; }
    .long .lbl { margin-right: 4px; }
    .long-text { text-decoration: underline dotted #333; text-underline-offset: 3px; white-space: pre-wrap; overflow-wrap: anywhere; }
    h2 { margin: 5pt 0 0; font-size: 14pt; font-weight: 700; }
    .end { margin-top: 6mm; text-align: center; letter-spacing: 1px; }
  </style>
</head>
<body>
  <section class="sheet">
    <p class="form-no">แบบ 5</p>
    <div class="date">${line([
      label('วันที่'), fill(report?.day ?? '', 'w-day'),
      label('เดือน'), fill(report?.month ?? '', 'w-month'),
      label('พ.ศ.'), fill(report?.year ?? '', 'w-year'),
    ])}</div>
    ${line([label('เรื่อง รายงานการสูญหาย/ความเสียหายยานพาหนะหมายเลขทะเบียน'), fill(plate)])}
    ${line([label('เรียน'), fill(addressee)])}
    ${line([label('เหตุเกิดเมื่อวันที่'), fill(form5DateText(incident.incident_date)), label('เวลา'), fill(form5TimeText(incident.incident_time), 'w-time'), label('น.')])}
    ${line([label('สถานที่เกิดเหตุ'), fill(incident.location), label('(ดังแผนที่สังเขปที่แนบมานี้)')])}
    ${line([label('ความเร็วขณะเกิดเหตุ'), fill(form5SpeedText(incident.speed_kmh)), label('กม./ชม.')])}
    ${line([label('ก่อนเกิดเหตุเดินทางจาก'), fill(incident.origin), label('จะไป'), fill(incident.destination)])}
    ${longField('ความเสียหาย', incident.damage)}

    <h2>ยานพาหนะหรือทรัพย์สินฝ่ายตรงข้าม</h2>
    ${line([label('ยานพาหนะ'), fill(incident.other_vehicle), label('หมายเลขทะเบียน'), fill(incident.other_plate)])}
    ${line([label('ขับขี่โดย'), fill(otherDriver?.full_name, 'w-name'), label('อายุ'), fill(otherDriver?.age ?? '', 'w-age'), label('ปี ใบอนุญาตขับขี่เลขที่'), fill(otherDriver?.license_no)])}
    ${line([label('ที่อยู่ของผู้ขับขี่'), fill(otherDriver?.address)])}
    ${line([label('ชื่อเจ้าของยานพาหนะ'), fill(otherOwner?.full_name)])}
    ${longField('เหตุเกิดจาก', incident.other_cause)}
    ${longField('ความเสียหาย', incident.other_damage, { blankLines: 1 })}

    <h2>ผู้บาดเจ็บ</h2>
    ${injured.map(person => personBlock(person, 'ชื่อ', 'ที่อยู่')).join('')}

    <h2>ผู้สอบสวนและพยาน</h2>
    ${line([label('พนักงานสอบสวนชื่อ'), fill(investigator?.full_name), label('สถานีตำรวจ'), fill(incident.police_station)])}
    ${witnesses.map(person => personBlock(person, 'พยานชื่อ', 'อยู่')).join('')}

    ${longField('ผลของคดี', incident.case_result, { blankLines: 1, bold: true })}
    <p class="end">---------------------------</p>
    <div class="eservice-origin">${esc(govEServiceOriginText(orgName))}</div>
  </section>
</body>
</html>`
}
