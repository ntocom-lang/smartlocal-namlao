// แบบ 1 / แบบ 2 ทะเบียนยานพาหนะ — ระเบียบกระทรวงมหาดไทยว่าด้วยการใช้และรักษายานพาหนะ
// ขององค์กรปกครองส่วนท้องถิ่น พ.ศ. ๒๕๖๙ ข้อ ๗ (ใช้บังคับ 17 มี.ค. 2569)
//   แบบ 1 = รถยนต์ประจำตำแหน่ง · แบบ 2 = ยานพาหนะส่วนกลาง
// ลำดับคอลัมน์/หัวตารางต้องตรงแบบท้ายระเบียบ ห้ามเติมช่องที่ไม่มีบนแบบ
//
// ข้อมูลมาจาก fleet_vehicles ทั้งหมด ไม่มีการกรอกเพิ่มตอนพิมพ์ — ช่องที่ยังไม่ได้กรอกในระบบ
// พิมพ์เป็นช่องว่าง (เจ้าของระบบตั้งแนวทาง 2026-10-18: ทำในระบบ พิมพ์เมื่อไรก็ได้)
// รถที่จำหน่ายแล้วยังอยู่ในทะเบียนพร้อมวันจำหน่าย เพราะข้อ ๗ ให้แสดงหลักฐานการจำหน่ายจ่ายโอนด้วย
//
// ตารางไหลข้ามหน้าเอง (หัวตารางซ้ำทุกหน้า) ไม่ตัดแถวทิ้ง — ทะเบียนทรัพย์สินห้ามมีรายการหายเงียบๆ

import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss, govPagePadding } from './govDocStyle.js'

// ขอบกระดาษแนวนอนตามมาตรฐาน "บน ขวา ล่าง ซ้าย" (3cm 2cm 1cm 2cm) แยกเป็นรายด้านไว้ใช้กับแถวเว้นระยะ
// (ดูคอมเมนต์ .sheet ใน buildFleetRegisterHtml ว่าทำไมไม่ใช้ padding บน/ล่างของ .sheet)
const [PAD_TOP, PAD_RIGHT, PAD_BOTTOM, PAD_LEFT] = govPagePadding({ size: 'A4 landscape' }).split(/\s+/)

export const REGISTER_FORMS = {
  position: {
    formNo: 'แบบ 1',
    category: 'ประเภทรถยนต์ประจำตำแหน่ง',
    registerOf: 'ทะเบียนรถยนต์ของ',
    nameHeader: 'ชื่อของรถยนต์',
  },
  central: {
    formNo: 'แบบ 2',
    category: 'ประเภทยานพาหนะส่วนกลาง',
    registerOf: 'ทะเบียนยานพาหนะของ',
    nameHeader: 'ชื่อของยานพาหนะ',
  },
}

// แบบ 1 ก่อนแบบ 2 ตามลำดับเลขแบบ
export const REGISTER_FORM_ORDER = ['position', 'central']

const POOL_DEPARTMENT_TEXT = 'ใช้ร่วมทุกกอง'

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
// (UTC เที่ยงคืน = วันก่อนหน้าในเขตเวลาไทย) ใช้ปี พ.ศ. เต็ม 4 หลัก เพราะวันได้มาของรถย้อนไปหลายสิบปีได้
export function registerDateText(iso) {
  const match = String(iso ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  return `${Number(match[3])}/${Number(match[2])}/${Number(match[1]) + 543}`
}

export function registerPriceText(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return number.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ช่อง "แบบ/รุ่นปี/ขนาด (ซีซี)" — แยกบรรทัดตามสามส่วนของหัวช่อง ส่วนที่ไม่มีข้อมูลข้ามไป
// รุ่นปีพิมพ์ตามที่กรอก (ไม่แปลง ค.ศ./พ.ศ. เอง — เดาผิดแล้วทะเบียนทรัพย์สินผิด)
// รถไฟฟ้าไม่มีซีซี ระเบียบข้อ ๙ วัดเป็นกิโลวัตต์ จึงบอกว่าเป็นรถไฟฟ้าแทนการเว้นว่าง
export function registerModelLines(vehicle) {
  const lines = []
  const model = clean([vehicle?.brand, vehicle?.model].filter(Boolean).join(' '))
  if (model) lines.push(model)
  const year = clean(vehicle?.manufacture_year)
  if (year) lines.push(`ปี ${year}`)
  const cc = Number(vehicle?.engine_cc)
  if (Number.isFinite(cc) && cc > 0) lines.push(`${cc.toLocaleString('th-TH')} ซีซี`)
  else if (vehicle?.fuel_type === 'electric') lines.push('ไฟฟ้า')
  return lines
}

// "สังกัดหน่วยงานใด" — รถที่ตั้งเป็นใช้ร่วมทุกกองไม่มีกองในระบบ พิมพ์ตามข้อมูลจริง
// (เจ้าของระบบเลือก 2026-10-18) ไม่เดาว่าเป็นสำนักปลัด
export function registerDepartmentText(vehicle) {
  const department = clean(vehicle?.departments?.name ?? vehicle?.department_name)
  if (department) return department
  return vehicle?.is_pool ? POOL_DEPARTMENT_TEXT : ''
}

// รถที่ปลดประจำการแต่ยังไม่ได้กรอกวันจำหน่าย — บอกไว้ในหมายเหตุ ไม่ให้ดูเหมือนรถที่ยังใช้อยู่
export function registerNoteLines(vehicle) {
  const lines = []
  const code = clean(vehicle?.asset_code)
  if (code) lines.push(`ครุภัณฑ์ ${code}`)
  if (vehicle?.status === 'retired' && !vehicle?.disposed_date) lines.push('ปลดประจำการ')
  return lines
}

export function registerCategoryOf(vehicle) {
  return vehicle?.regulation_category === 'position' ? 'position' : 'central'
}

// เรียงตามวันได้มา (ทะเบียนทรัพย์สินเรียงตามลำดับการได้มา) คันที่ยังไม่กรอกวันได้มาไว้ท้าย
// แล้วจึงเรียงตามเลขครุภัณฑ์/ชื่อ เพื่อให้พิมพ์กี่รอบก็ได้ลำดับเดิม
export function sortRegisterVehicles(vehicles) {
  return [...(vehicles ?? [])].sort((a, b) => {
    const aDate = String(a?.acquired_date ?? '')
    const bDate = String(b?.acquired_date ?? '')
    if (aDate !== bDate) {
      if (!aDate) return 1
      if (!bDate) return -1
      return aDate < bDate ? -1 : 1
    }
    const byCode = clean(a?.asset_code).localeCompare(clean(b?.asset_code), 'th')
    if (byCode) return byCode
    return clean(a?.name).localeCompare(clean(b?.name), 'th')
  })
}

// เฉพาะยานพาหนะ (ข้อ ๕) — แยกตามประเภทตามระเบียบ ไม่ใช่ตาม is_pool
export function groupRegisterVehicles(vehicles) {
  const groups = { position: [], central: [] }
  for (const vehicle of vehicles ?? []) {
    if ((vehicle?.asset_kind ?? 'vehicle') !== 'vehicle') continue
    groups[registerCategoryOf(vehicle)].push(vehicle)
  }
  return { position: sortRegisterVehicles(groups.position), central: sortRegisterVehicles(groups.central) }
}

function lines(list) {
  return list.map(esc).join('<br>')
}

// เลขครุภัณฑ์ห้ามตัดกลางเลข — เบราว์เซอร์ตัดบรรทัดหลังขีดได้ "001-52-" / "001" (เจอในภาพจริง 2026-10-18)
// ห่อด้วย nowrap แทนการเปลี่ยนเป็นขีดไม่ตัดบรรทัด (U+2011) เพราะคัดลอกไปค้นในทะเบียนครุภัณฑ์แล้วจะไม่เจอ
// ช่องหมายเหตุรับได้ ~11 ตัวอักษร (001-52-0001) เลขที่ยาวกว่านั้นยอมให้ตัดบรรทัด ดีกว่าล้นทับเส้นตาราง
const NOWRAP_CODE_MAX = 11

function noteHtml(vehicle) {
  return registerNoteLines(vehicle).map(line => {
    const match = line.match(/^ครุภัณฑ์ (.+)$/)
    if (!match || match[1].length > NOWRAP_CODE_MAX) return esc(line)
    return `ครุภัณฑ์ <span class="nowrap">${esc(match[1])}</span>`
  }).join('<br>')
}

function tableHeader(form) {
  return `<thead>
    <tr>
      <th class="c-no">ลำดับที่</th>
      <th class="c-name">${esc(form.nameHeader)}</th>
      <th class="c-model">แบบ/รุ่นปี/<br>ขนาด (ซีซี)</th>
      <th class="c-plate">หมายเลข<br>ทะเบียน</th>
      <th class="c-dept">สังกัด<br>หน่วยงานใด</th>
      <th class="c-price">ราคา</th>
      <th class="c-date">วันได้มา</th>
      <th class="c-date">วันจำหน่าย</th>
      <th class="c-note">หมายเหตุ</th>
    </tr>
  </thead>`
}

function vehicleRow(vehicle, no) {
  return `<tr>
    <td>${no}</td>
    <td class="left">${esc(clean(vehicle?.name))}</td>
    <td class="left">${lines(registerModelLines(vehicle))}</td>
    <td>${esc(clean(vehicle?.license_plate))}</td>
    <td>${esc(registerDepartmentText(vehicle))}</td>
    <td class="num">${esc(registerPriceText(vehicle?.purchase_price))}</td>
    <td>${esc(registerDateText(vehicle?.acquired_date))}</td>
    <td>${esc(registerDateText(vehicle?.disposed_date))}</td>
    <td class="left note">${noteHtml(vehicle)}</td>
  </tr>`
}

function sheet({ categoryKey, vehicles, orgName, asOfText }) {
  const form = REGISTER_FORMS[categoryKey]
  const body = vehicles.length
    ? vehicles.map((vehicle, index) => vehicleRow(vehicle, index + 1)).join('')
    : `<tr class="empty"><td colspan="9">— ไม่มี${esc(form.category.replace(/^ประเภท/, ''))} —</td></tr>`
  const origin = govEServiceOriginText(orgName)
  return `<section class="sheet" data-form="${esc(categoryKey)}">
  <table class="page">
    <thead><tr><td class="space-top"></td></tr></thead>
    <tfoot><tr><td class="space-bottom"></td></tr></tfoot>
    <tbody><tr><td>
    <p class="form-no">${esc(form.formNo)}</p>
    <h1>${esc(form.category)}</h1>
    <p class="register-of">${esc(form.registerOf)} <span class="fill">${esc(clean(orgName))}</span></p>
    <table class="register">
      <colgroup>
        <col class="c-no"><col class="c-name"><col class="c-model"><col class="c-plate"><col class="c-dept">
        <col class="c-price"><col class="c-date"><col class="c-date"><col class="c-note">
      </colgroup>
      ${tableHeader(form)}
      <tbody>${body}</tbody>
    </table>
    <div class="eservice-origin">${esc(origin)}${asOfText ? ` · ข้อมูล ณ วันที่ ${esc(asOfText)}` : ''}</div>
    </td></tr></tbody>
  </table>
  </section>`
}

// asOf = 'YYYY-MM-DD' ตามเวลาไทย (ส่งเข้ามา ไม่อ่านนาฬิกาในนี้) — พิมพ์ย้อนหลังได้ทุกเมื่อ
// จึงต้องบอกว่าทะเบียนในกระดาษแผ่นนี้เป็นข้อมูล ณ วันไหน
// forms = ['position','central'] ค่าปริยายพิมพ์ทั้งสองแบบ แบบละแผ่น
export function buildFleetRegisterHtml({ vehicles = [], orgName = '', asOf = '', forms = REGISTER_FORM_ORDER }) {
  const groups = groupRegisterVehicles(vehicles)
  const asOfText = registerDateText(asOf)
  const sheets = forms.filter(key => REGISTER_FORMS[key])
    .map(categoryKey => sheet({ categoryKey, vehicles: groups[categoryKey], orgName, asOfText }))
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>ทะเบียนยานพาหนะ แบบ 1 แบบ 2 ${esc(clean(orgName))}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ size: 'A4 landscape', hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { color: #000; ${govDocFontCss()} background: #fff; }
    /* ขอบบน/ล่างของ "ทุกหน้า" มาจากแถวเว้นระยะใน thead/tfoot ของตารางห่อนอก (table.page) ซึ่งเบราว์เซอร์ซ้ำทุกหน้า
       ไม่ใช่ padding ของ .sheet — padding อยู่แค่หน้าแรก ทะเบียนที่ไหลเป็น 2 หน้าจึงเคยได้หน้า 2 ที่หัวตารางชิดขอบบน
       กระดาษ (ตรงรูเจาะแฟ้มของแนวนอน) เพราะ @page margin เป็น 0 ตามมาตรฐานซ่อนหัวกระดาษของเบราว์เซอร์
       (เจ้าของระบบสั่งแก้ 2026-10-20) ค่าขอบมาจาก govPagePadding() ค่าเดียวกับใบอื่น */
    .sheet { width: 297mm; min-height: 210mm; padding: 0 ${PAD_RIGHT} 0 ${PAD_LEFT}; }
    .sheet + .sheet { page-break-before: always; }
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
      table.register tr { page-break-inside: avoid; }
    }
    p { margin: 0; }
    .form-no { text-align: right; }
    h1 { margin: 0; text-align: center; font-size: 14pt; font-weight: 700; line-height: 1.25; }
    .register-of { text-align: center; font-weight: 700; }
    .register-of .fill { display: inline-block; min-width: 60mm; border-bottom: 1px dotted #333; padding: 0 4px; font-weight: 400; }
    table.register { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 4mm; }
    table.register th, table.register td { border: 1px solid #000; vertical-align: top; text-align: center; overflow-wrap: anywhere; }
    table.register th { vertical-align: middle; font-weight: 700; line-height: 1.15; padding: 1mm 2px; }
    table.register td { padding: 1mm 3px; line-height: 1.15; height: 9mm; }
    table.register td.left { text-align: left; }
    table.register td.num { text-align: right; }
    table.register tr.empty td { color: #555; padding: 4mm; }
    .nowrap { white-space: nowrap; }
    /* ความกว้างรวม 100% ของ 257 มม. — วัดจากเบราว์เซอร์ที่ 14pt (2026-10-18) ความกว้างที่ข้อความ
       ต้องใช้ + padding ~2 มม.: วันที่ "30/12/2569" 25.2 · ราคา "1,234,567.89" 27.4 ·
       ทะเบียน "กลพ 7870 แพร่" 30.2 · "ใช้ร่วมทุกกอง" 26.2 · หัว "ลำดับที่" 15.6 ·
       เลขครุภัณฑ์ "001-66-003" 22.6 (+ padding) มม.
       ช่องเหล่านี้ห้ามตัดบรรทัด (อ่านผิดได้) ที่เหลือให้ชื่อ/รุ่นซึ่งตัด 2 บรรทัดได้โดยไม่เสียความหมาย
       ปรับแล้วต้องรัน npm run test:fleet:register */
    col.c-no { width: 6%; }
    col.c-name { width: 15%; }
    col.c-model { width: 15%; }
    col.c-plate { width: 12%; }
    col.c-dept { width: 10.5%; }
    col.c-price { width: 11%; }
    col.c-date { width: 10%; }
    col.c-note { width: 10.5%; }
  </style>
</head>
<body>
${sheets.join('\n')}
</body>
</html>`
}
