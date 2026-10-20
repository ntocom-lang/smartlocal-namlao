// ทะเบียนคุมยานพาหนะส่วนกลาง — เอกสารแนบท้ายคำสั่งของ อปท. ที่ระบุว่ารถแต่ละคันอยู่ในครอบครองของ
// หน่วยงานไหน และใครเป็นผู้รับผิดชอบควบคุม/ดูแล (ต้นฉบับตัวอย่าง: อบต.ทุ่งแค้ว คำสั่งที่ 401/2569
// เจ้าของระบบสั่งเพิ่ม 2026-10-20)
//
// ⚠️ ไม่ใช่แบบ ๑–๖ ท้ายระเบียบ มท. ยานพาหนะ อปท. พ.ศ. ๒๕๖๙ (แบบ ๑/๒ อยู่ใน fleetRegisterPrint.js)
// เป็นเอกสารแนบคำสั่งของ อปท. เอง ที่มาทางระเบียบยังต้องยืนยัน จึงห้ามใส่เลขข้อของระเบียบบนใบนี้
//
// ข้อมูลมาจาก fleet_vehicles ทั้งหมด ไม่มีการกรอกเพิ่มตอนพิมพ์
//
// บรรทัดหัว "เอกสารแนบท้ายคำสั่ง… ที่ …… ลงวันที่ ……" เจ้าของระบบสั่งเอาออกก่อน (2026-10-20) — เลขคำสั่งออกจาก
// งานสารบรรณ ไม่อยู่ในระบบ ถ้าจะเอากลับมาให้พิมพ์เป็นเส้นประให้เขียนเอง ห้ามเดาเลข/วันที่ให้
//
// ระบบไม่เลือก "ผู้รับผิดชอบ" ให้ — การมอบหมายเป็นคำสั่งของผู้บริหาร (ดุลพินิจ) ระบบเก็บตามที่คำสั่งระบุ
// ช่องที่ยังไม่กรอกพิมพ์เป็นช่องว่าง
//
// ตารางไหลข้ามหน้าเอง (หัวตารางซ้ำทุกหน้า) ไม่ตัดแถวทิ้ง — รถที่ยังไม่ระบุหน่วยงานผู้ครอบครอง
// อยู่กลุ่มท้ายสุด ไม่หายจากทะเบียนเงียบๆ

import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss, govPagePadding } from './govDocStyle.js'
import { govDepartmentHeadTitle } from './govStaffSignBlock.js'
import { ORG_TERMS } from './orgTerms.js'

export const UNASSIGNED_GROUP_KEY = 'unassigned'

// ขอบกระดาษแนวนอนตามมาตรฐาน "บน ขวา ล่าง ซ้าย" (3cm 2cm 1cm 2cm) แยกเป็นรายด้านไว้ใช้กับแถวเว้นระยะ
const [PAD_TOP, PAD_RIGHT, PAD_BOTTOM, PAD_LEFT] = govPagePadding({ size: 'A4 landscape' }).split(/\s+/)

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

// ชื่อหน่วยงานแบบย่อท้ายหัวกลุ่ม ("องค์การบริหารส่วนตำบลทุ่งแค้ว" → "อบต.ทุ่งแค้ว")
// ตัดสินจากชื่อหน่วยงาน ไม่ใช่ org_type เพราะ org_type ของข้อมูลเก่าบางแถวว่างหรือไม่ระบุระดับ
// ไม่รู้จักคำนำหน้า = ใช้ชื่อเต็ม ถูกกว่าการเดาตัวย่อ
export function orgShortName(orgName) {
  const name = clean(orgName)
  for (const terms of Object.values(ORG_TERMS)) {
    if (terms.abbr && terms.strip && name.startsWith(terms.strip)) {
      return `${terms.abbr}${name.slice(terms.strip.length).trim()}`
    }
  }
  return name
}

// สถานะที่หน้าจอเรียก "ปลดประจำการ" (inactive) และ "ปลดระวาง" (retired) — รถที่ออกจากการใช้งานแล้ว
const OUT_OF_SERVICE = new Set(['inactive', 'retired'])

// รถที่อยู่ในทะเบียนนี้: ยานพาหนะส่วนกลางที่ยังอยู่ในความดูแล
// ไม่รวมรถประจำตำแหน่ง (แบบ ๑) รถที่จำหน่ายแล้ว และรถที่ปลดประจำการ/ปลดระวาง — คำสั่งมอบหมายผู้ดูแล
// ทำกับรถที่ยังใช้งานอยู่ (รถที่ออกจากการใช้งานแล้วยังอยู่ในทะเบียนแบบ ๒ ซึ่งเป็นคนละใบ)
// รถกำลังซ่อม (under_repair) ยังอยู่ในความดูแล จึงอยู่ในทะเบียน
export function isCustodianRegisterVehicle(vehicle) {
  if ((vehicle?.asset_kind ?? 'vehicle') !== 'vehicle') return false
  if (vehicle?.regulation_category === 'position') return false
  if (OUT_OF_SERVICE.has(vehicle?.status)) return false
  if (vehicle?.disposed_date) return false
  return true
}

export function custodianOf(vehicle) {
  return { name: clean(vehicle?.custodian_name), position: clean(vehicle?.custodian_position) }
}

// เรียงตามเลขครุภัณฑ์ตามภาพต้นฉบับ (numeric: "001 49 0001" ก่อน "003 58 0001") คันที่ไม่มีเลขไว้ท้ายกลุ่ม
function sortByAssetCode(vehicles) {
  return [...vehicles].sort((a, b) => {
    const aCode = clean(a?.asset_code)
    const bCode = clean(b?.asset_code)
    if (aCode !== bCode) {
      if (!aCode) return 1
      if (!bCode) return -1
      const byCode = aCode.localeCompare(bCode, 'th', { numeric: true })
      if (byCode) return byCode
    }
    return clean(a?.name).localeCompare(clean(b?.name), 'th')
  })
}

// departments = [{ id, name, sort_order }] ของ อปท. นี้เท่านั้น — id ที่ไม่อยู่ในรายการ
// (กองถูกลบ/ผิด อปท.) ตกกลุ่ม "ยังไม่ระบุ" แทนที่จะแสดงชื่อกองของ อปท. อื่นหรือทำให้รถหาย
export function groupCustodianRegister(vehicles, departments = []) {
  const known = new Map((departments ?? []).map(department => [department.id, department]))
  const byDepartment = new Map()
  const unassigned = []
  for (const vehicle of vehicles ?? []) {
    if (!isCustodianRegisterVehicle(vehicle)) continue
    const department = known.get(vehicle?.custodian_department_id)
    if (!department) {
      unassigned.push(vehicle)
      continue
    }
    if (!byDepartment.has(department.id)) byDepartment.set(department.id, [])
    byDepartment.get(department.id).push(vehicle)
  }
  const groups = [...byDepartment.entries()]
    .map(([id, list]) => ({ key: id, department: known.get(id), vehicles: sortByAssetCode(list) }))
    .sort((a, b) => {
      const bySort = (a.department.sort_order ?? 0) - (b.department.sort_order ?? 0)
      return bySort || clean(a.department.name).localeCompare(clean(b.department.name), 'th')
    })
  if (unassigned.length) groups.push({ key: UNASSIGNED_GROUP_KEY, department: null, vehicles: sortByAssetCode(unassigned) })
  return groups
}

// รายชื่อผู้รับผิดชอบที่เคยกรอกไว้ ให้ฟอร์มรถเสนอเป็น autocomplete — คนเดียวดูแลหลายคัน
// พิมพ์ชื่อครั้งเดียว ตำแหน่งขึ้นเอง (ชื่อซ้ำกันใช้ตำแหน่งแรกที่ไม่ว่าง)
export function custodianSuggestions(vehicles) {
  const byName = new Map()
  for (const vehicle of vehicles ?? []) {
    const { name, position } = custodianOf(vehicle)
    if (!name) continue
    if (!byName.has(name) || (!byName.get(name) && position)) byName.set(name, position)
  }
  return [...byName.entries()]
    .map(([name, position]) => ({ name, position }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'))
}

// หัวกลุ่มแยกเป็นชิ้น เพื่อให้ชื่อหน่วยงาน/ชื่อย่อ/ตำแหน่งหัวหน้า (keep) ไม่ถูกตัดกลางคำตอนขึ้นบรรทัดใหม่
// ("หัวหน้าสำนัก|ปลัด" ในภาพจริง) — ข้อความล้วนกับ HTML มาจากชิ้นส่วนชุดเดียวกัน
function groupTitleParts({ department, orgName }) {
  if (!department) return [{ text: 'ยานพาหนะส่วนกลาง ที่ยังไม่ได้ระบุหน่วยงานผู้ครอบครอง' }]
  const departmentName = clean(department.name)
  const short = orgShortName(orgName)
  return [
    { text: 'ยานพาหนะส่วนกลาง ที่อยู่ในครอบครองของ' },
    { text: departmentName, keep: true },
    ...(short ? [{ text: ' ' }, { text: short, keep: true }] : []),
    { text: ' (หัวหน้าหน่วยงานผู้ครอบครองยานพาหนะส่วนกลางได้แก่ ' },
    { text: govDepartmentHeadTitle(departmentName), keep: true },
    { text: ')' },
  ]
}

export function groupTitleText(args) {
  return groupTitleParts(args).map(part => part.text).join('')
}

function groupTitleHtml(args) {
  return groupTitleParts(args)
    .map(part => (part.keep ? `<span class="keep">${esc(part.text)}</span>` : esc(part.text)))
    .join('')
}

// ชื่อกับตำแหน่งห้ามถูกตัดกลางคำ — เบราว์เซอร์ตัดคำไทยเองแล้วเจอ "ทุ่งแค้|ว" ในภาพจริง (แบบ สก. ๑)
// ห่อด้วย nowrap ให้ตัดบรรทัดได้เฉพาะระหว่างชื่อกับตำแหน่ง แต่ข้อความยาวผิดปกติปล่อยให้ตัดได้
// ดีกว่าล้นทับเส้นตาราง
const KEEP_MAX = 50
// ช่องเลขครุภัณฑ์รับได้ ~13 ตัวอักษร (001-52-0001) ช่องทะเบียน ~14 (กลพ 7870 แพร่) ยาวกว่านั้นยอมให้ตัดบรรทัด
// ดีกว่าล้นทับช่องข้างๆ (เลขครุภัณฑ์ทดสอบ 25 ตัวอักษรเคยล้นทับชื่อรถ)
const KEEP_CODE_MAX = 13
const KEEP_PLATE_MAX = 14

function keepHtml(text, max = KEEP_MAX) {
  return text.length > max ? esc(text) : `<span class="keep">${esc(text)}</span>`
}

// ชื่อรถ ("ประเภทรถ") ต้องอยู่บรรทัดเดียว ไม่แยกคำ (เจ้าของระบบสั่ง 2026-10-20 จากใบน้ำเลาจริง:
// "รถยนต์นั่งส่วนบุคคลไม่เกิน 7 / คน" ตกบรรทัดเพราะช่องเดิมกว้างแค่ 56 มม.)
// nowrap อย่างเดียวไม่พอ — ชื่อยาวหรือเป็นตัวอักษรอังกฤษล้นทับช่องข้างๆ ได้ จึงนับด้วย "ความกว้างโดยประมาณ" (มม.)
// ไม่ใช่จำนวนตัวอักษร เพราะตัวอักษรไทยไม่ได้กว้างเท่ากัน (สระ/วรรณยุกต์บนล่างไม่กินที่) และตัวอังกฤษกว้างกว่า
// ค่ากว้างต่อตัววัดจากเบราว์เซอร์ที่ 14pt (ไทย 2.78 · a-z 2.25 · A-Z 2.79 · เลข 2.51 · ช่องว่าง 1.73 มม.)
// ประมาณเกินจริงราว 5-9% โดยเจตนา (ชื่อ 31 ตัวอักษรข้างบนวัดจริง 59.2 ได้ประมาณ 64.4) เทสต์เทียบกับค่าจริงทุกครั้ง
// ยาวเกิน NAME_KEEP_MM ปล่อยให้ตัดบรรทัดได้ ดีกว่าล้นทับช่องข้างๆ
const THAI_COMBINING = /[ัิ-ฺ็-๎]/
const THAI_LETTER = /[ก-๛]/
export const NAME_KEEP_MM = 67

export function estimateTextWidthMm(text) {
  let width = 0
  for (const char of String(text ?? '')) {
    if (THAI_COMBINING.test(char)) continue
    if (THAI_LETTER.test(char)) width += 2.78
    else if (/[a-z]/.test(char)) width += 2.25
    else if (/[A-Z]/.test(char)) width += 2.79
    else if (/[0-9]/.test(char)) width += 2.51
    else if (/\s/.test(char)) width += 1.73
    else width += 1.8
  }
  return width
}

function nameHtml(name) {
  return estimateTextWidthMm(name) <= NAME_KEEP_MM ? `<span class="keep">${esc(name)}</span>` : esc(name)
}

function custodianHtml(vehicle) {
  const { name, position } = custodianOf(vehicle)
  const parts = []
  if (name) parts.push(keepHtml(name))
  if (position) parts.push(keepHtml(`ตำแหน่ง ${position}`))
  return parts.join(' ')
}

function vehicleRow(vehicle, no) {
  return `<tr class="vehicle">
    <td>${no}</td>
    <td>${keepHtml(clean(vehicle?.asset_code), KEEP_CODE_MAX)}</td>
    <td class="left">${nameHtml(clean(vehicle?.name))}</td>
    <td>${keepHtml(clean(vehicle?.license_plate), KEEP_PLATE_MAX)}</td>
    <td class="left">${custodianHtml(vehicle)}</td>
  </tr>`
}

function bodyRows(groups, orgName) {
  if (!groups.length) return '<tr class="empty"><td colspan="5">— ไม่มียานพาหนะส่วนกลาง —</td></tr>'
  return groups.map(group => `<tr class="group" data-group="${esc(group.key)}"><td colspan="5">${groupTitleHtml({ department: group.department, orgName })}</td></tr>
${group.vehicles.map((vehicle, index) => vehicleRow(vehicle, index + 1)).join('\n')}`).join('\n')
}

function placeLine(tenant) {
  const district = clean(tenant?.district).replace(/^(อำเภอ|อ\.)\s*/, '')
  const province = clean(tenant?.province).replace(/^(จังหวัด|จ\.)\s*/, '')
  return [clean(tenant?.name), district && `อำเภอ${district}`, province && `จังหวัด${province}`].filter(Boolean).join(' ')
}

// asOf = 'YYYY-MM-DD' ตามเวลาไทย (ส่งเข้ามา ไม่อ่านนาฬิกาในนี้) — พิมพ์ย้อนหลังได้ทุกเมื่อ
// จึงต้องบอกว่าทะเบียนในกระดาษแผ่นนี้เป็นข้อมูล ณ วันไหน
export function buildFleetCustodianRegisterHtml({ vehicles = [], departments = [], tenant = null, asOf = '' }) {
  const orgName = clean(tenant?.name)
  const groups = groupCustodianRegister(vehicles, departments)
  const asOfMatch = String(asOf ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  const asOfText = asOfMatch ? `${Number(asOfMatch[3])}/${Number(asOfMatch[2])}/${Number(asOfMatch[1]) + 543}` : ''
  const origin = govEServiceOriginText(orgName)
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>ทะเบียนคุมยานพาหนะส่วนกลาง ${esc(orgName)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ size: 'A4 landscape', hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { color: #000; ${govDocFontCss()} background: #fff; }
    /* ขอบบน/ล่างของ "ทุกหน้า" มาจากแถวเว้นระยะใน thead/tfoot ของตารางห่อนอก (table.page) ซึ่งเบราว์เซอร์ซ้ำทุกหน้า
       ไม่ใช่ padding ของ .sheet — padding อยู่แค่หน้าแรก ใบที่ไหลเป็น 2 หน้าจะได้หน้า 2 ที่หัวตารางชิดขอบกระดาษ
       (ตรงตำแหน่งรูเจาะแฟ้มของแนวนอน) เพราะ @page margin เป็น 0 ตามมาตรฐานซ่อนหัวกระดาษของเบราว์เซอร์
       ค่าขอบมาจาก govPagePadding() ค่าเดียวกับใบอื่น */
    .sheet { width: 297mm; min-height: 210mm; padding: 0 ${PAD_RIGHT} 0 ${PAD_LEFT}; }
    table.page { width: 100%; border-collapse: collapse; table-layout: auto; }
    table.page > thead > tr > td, table.page > tbody > tr > td, table.page > tfoot > tr > td { border: 0; padding: 0; text-align: left; vertical-align: top; }
    td.space-top { height: ${PAD_TOP}; }
    td.space-bottom { height: ${PAD_BOTTOM}; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 3mm; text-align: center; }
    @media print {
      html, body { height: auto; }
      .sheet { width: auto; min-height: 0; height: auto; }
      /* ทะเบียนยาวเกินหน้าให้ไหลต่อพร้อมหัวตาราง ไม่ตัดแถวกลางคัน (เฉพาะตารางทะเบียน ไม่ใช่ตารางห่อนอกที่ต้องตัดข้ามหน้าได้) */
      table.register thead { display: table-header-group; }
      table.register tr { break-inside: avoid; page-break-inside: avoid; }
      /* หัวกลุ่มห้ามค้างท้ายหน้าโดยไม่มีรถตามหลัง */
      table.register tr.group { break-after: avoid; page-break-after: avoid; }
    }
    p { margin: 0; }
    h1 { margin: 0; text-align: center; font-size: 14pt; font-weight: 700; line-height: 1.25; }
    .place { text-align: center; font-weight: 700; }
    table.register { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 4mm; }
    table.register th, table.register td { border: 1px solid #000; vertical-align: middle; text-align: center; overflow-wrap: anywhere; }
    table.register th { font-weight: 700; line-height: 1.15; padding: 1mm 2px; }
    table.register td { padding: 1mm 3px; line-height: 1.15; height: 8mm; }
    table.register td.left { text-align: left; }
    table.register tr.group td { text-align: left; font-weight: 700; padding: 1.2mm 3px; }
    table.register tr.empty td { color: #555; padding: 4mm; }
    .keep { white-space: nowrap; }
    /* ความกว้างรวม 100% ของ 257 มม. — ช่องเลขครุภัณฑ์/ทะเบียน/ชื่อรถห้ามตัดบรรทัด (อ่านผิดได้ / เจ้าของระบบสั่ง)
       ช่องชื่อรถ 27% (~67 มม.) พอสำหรับ "รถยนต์นั่งส่วนบุคคลไม่เกิน 7 คน" (วัดจริง 59.2 มม.) ดู NAME_KEEP_MM
       ที่เหลือให้ช่องผู้รับผิดชอบ (ชื่อ + "ตำแหน่ง …") ข้อมูลปกติจบบรรทัดเดียว ตำแหน่งยาวมาก
       (เช่น "นักป้องกันและบรรเทาสาธารณภัยชำนาญการ" 38 ตัวอักษร) ตัดเป็น 2 บรรทัดระหว่างชื่อกับตำแหน่ง
       ปรับแล้วต้องรัน npm run test:fleet:custodian */
    col.c-no { width: 5%; }
    col.c-code { width: 12%; }
    col.c-name { width: 27%; }
    col.c-plate { width: 13%; }
    col.c-person { width: 43%; }
  </style>
</head>
<body>
<section class="sheet">
<table class="page">
  <thead><tr><td class="space-top"></td></tr></thead>
  <tfoot><tr><td class="space-bottom"></td></tr></tfoot>
  <tbody><tr><td>
  <h1>ทะเบียนคุมยานพาหนะส่วนกลาง</h1>
  <p class="place">${esc(placeLine(tenant))}</p>
  <table class="register">
    <colgroup><col class="c-no"><col class="c-code"><col class="c-name"><col class="c-plate"><col class="c-person"></colgroup>
    <thead>
      <tr>
        <th>ลำดับ</th>
        <th>หมายเลขพัสดุ</th>
        <th>ประเภทรถ</th>
        <th>เลขทะเบียนรถ</th>
        <th>ผู้รับผิดชอบควบคุม/ดูแลยานพาหนะส่วนกลาง</th>
      </tr>
    </thead>
    <tbody>${bodyRows(groups, orgName)}</tbody>
  </table>
  <div class="eservice-origin">${esc(origin)}${asOfText ? ` · ข้อมูล ณ วันที่ ${esc(asOfText)}` : ''}</div>
  </td></tr></tbody>
</table>
</section>
</body>
</html>`
}
