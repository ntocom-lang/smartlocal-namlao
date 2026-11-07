// ใบ "รายงานผลการก่อสร้างประจำสัปดาห์" — A4 แนวตั้ง พิมพ์จากโมดูลโครงการก่อสร้าง (เมนูกองช่าง ฝั่งเจ้าหน้าที่)
//
// โครงตามไฟล์ต้นแบบที่เจ้าของระบบส่งมา 2569-11-06 (6 ส่วน): ① บันทึกข้อความ+สรุป ② ข้อมูลโครงการ ③ ผลการดำเนินงาน ④ กำลังคน/เครื่องจักร/อากาศ
// ⑤ บันทึกประจำวัน+ปัญหา+ลงนาม ⑥ กราฟเทียบแผน — แต่ข้อมูลทุกช่องมาจากที่บันทึกไว้ในระบบ ไม่ต้องพิมพ์ซ้ำ ใบนี้พิมพ์ย้อนหลังสัปดาห์ไหนก็ได้
//
// ⚠️ ใบนี้ "สรุปจากข้อมูลที่ผู้ควบคุมงานบันทึกในระบบ" ไม่ใช่แบบที่กฎหมายหรือระเบียบกำหนด (ต้นฉบับเป็นแบบของส่วนราชการอื่น) —
//    ถ้า อปท. จะใช้เป็นเอกสารทางการ แบบ/ผู้ลงนาม/หน้าที่ผู้ควบคุมงานต้องเป็นไปตามระเบียบจัดซื้อจัดจ้างฉบับปัจจุบัน (ต้องยืนยันกับฉบับปัจจุบัน
//    ไม่ได้อ้างมาตราใดไว้ที่นี่) คำกำกับท้ายใบบอกไว้ ห้ามตัดออก
// ⚠️ "เร็ว/ช้า" เทียบกับ "แผนที่ตั้งในระบบ" (แผนสะสมคำนวณเชิงเส้นจากวันเริ่ม–สิ้นสุดของแต่ละรายการ) ไม่ใช่แผนตามสัญญา — ถ้อยคำบนใบต้องเขียนอย่างนั้น
// ⚠️ ระบบไม่คำนวณค่าปรับ ขยายเวลา หรืองวดเงิน ใบนี้จึงไม่มีตัวเลขเหล่านั้น (ค่าปรับต่อวันตามสัญญาไม่พิมพ์)
//
// ตัวเลขผลงานมาจาก `sheet` (buildReportSheet หรือ frozen ของฉบับที่ล็อกแล้ว) — ฉบับที่ล็อกพิมพ์ย้อนหลังได้เลขเดิมเสมอ
// ทุกค่าที่มาจากฐานข้อมูลต้องผ่าน esc() ก่อนลง HTML (เขียนผ่าน document.write) · หลายหน้าได้ ใช้ขอบ @page จริง ไม่ใช้ padding ของ .sheet

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss,
} from './govDocStyle.js'
import { govNameBlank, govSignBlockCss, govSignRow } from './govSignBlock.js'
import { thaiDateFromDateInput } from './thaiDate.js'
import { thaiDateRange, thaiShortDate } from './complaintReportPeriods.js'
import { PEOPLE_GROUPS, WEATHER_ROWS, formatPct, periodDates } from './constructionReport.js'
import { addMobileCloseButton } from './printWindowClose.js'

// ตารางคุมขนาดตัวอักษรเองที่ 12pt — ⚠️ ข้อยกเว้น "ขนาดตัวอักษร" ตามมาตรฐานเอกสารราชการของระบบ (ฟอนต์/ระยะบรรทัด/font-size-adjust
// ยังมาจาก govDocStyle.js ตามเดิม): ตารางผลงาน 9 คอลัมน์และตารางรายวัน 7 วันต้องอยู่ในพื้นที่พิมพ์ 160 มม. ที่ 14pt คอลัมน์ไม่พอ
// เนื้อความ หัวข้อ และช่องลงนามยังเป็น 14pt
const TABLE_FONT_PT = '12pt'

export const CONSTRUCTION_REPORT_DISCLAIMER = 'เอกสารนี้สรุปจากข้อมูลที่ผู้ควบคุมงานบันทึกไว้ในระบบ ไม่ใช่แบบที่กฎหมายหรือระเบียบกำหนด · '
  + 'ป้าย "เร็ว/ช้า" เทียบกับแผนที่ตั้งในระบบ (แผนสะสมคำนวณเชิงเส้นจากวัน เริ่ม–สิ้นสุดของแต่ละรายการ และปรับเฉพาะสัปดาห์ได้) ไม่ใช่แผนตามสัญญา · '
  + 'ระบบไม่คำนวณค่าปรับ การขยายเวลา หรืองวดเงิน'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

const dateText = iso => thaiDateFromDateInput(iso)
const blank = (width = '30mm') => `<span class="blank" style="min-width:${width}">&nbsp;</span>`
const orBlank = (value, width) => (String(value ?? '').trim() ? esc(value) : blank(width))
const money = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? '' : Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const num = value => (value === null || value === undefined || value === '' ? '' : String(value))
const dash = value => (String(value ?? '').trim() ? esc(value) : '–')

function pageCss() {
  return `
  ${govPageCss()}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #000; ${govDocFontCss()} -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* จอ: กรอบกว้าง 160mm เท่าพื้นที่พิมพ์ · พิมพ์: ใช้ขอบกระดาษจริงจาก @page */
  .sheet { max-width: 160mm; margin: 8mm auto; }
  @media print { .sheet { max-width: none; margin: 0; } }
  p { margin: 0; }
  .pg + .pg { break-before: page; page-break-before: always; }
  .blank { display: inline-block; border-bottom: 1px dotted #000; }
  .draft-note { text-align: center; font-weight: 700; border: 1px solid #000; padding: 0.4mm 2mm; margin-bottom: 1.5mm; }
  .head { display: flex; align-items: center; gap: 12mm; margin-bottom: 1.5mm; }
  .emblem { width: 15mm; height: 15mm; flex: none; }
  .emblem img { width: 100%; height: 100%; object-fit: contain; }
  .head h1 { margin: 0; font-size: 1.5em; font-weight: 700; flex: 1; text-align: center; padding-right: 27mm; }
  .field { margin: 0.4mm 0; }
  .field-row { display: flex; gap: 6mm; }
  .field-row .left { flex: 1 1 0; } .field-row .right { flex: 1 1 0; }
  .rule { border: 0; border-top: 1px solid #000; margin: 1mm 0 1.5mm; }
  .doc-title { text-align: center; font-weight: 700; font-size: 1.1em; margin: 0 0 1.5mm; }
  .sec { font-weight: 700; margin: 2mm 0 0.6mm; break-after: avoid; page-break-after: avoid; }
  .body-line { margin: 0.6mm 0; }
  .indent { padding-left: 8mm; }
  table { width: 100%; border-collapse: collapse; }
  table.grid { table-layout: fixed; font-size: ${TABLE_FONT_PT}; margin: 0.6mm 0 1.5mm; }
  table.grid th, table.grid td { border: 1px solid #000; padding: 0.5mm 1.2mm; vertical-align: top; overflow-wrap: anywhere; }
  table.grid th { font-weight: 700; text-align: center; }
  table.grid td.c { text-align: center; } table.grid td.r { text-align: right; }
  table.grid tr.total td { font-weight: 700; }
  table.kv { margin: 0.6mm 0 1.5mm; }
  table.kv td { vertical-align: top; padding: 0.2mm 0; }
  table.kv td.k { width: 36mm; white-space: nowrap; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .sum { display: flex; border: 1px solid #000; margin: 1mm 0; }
  .sum > div { flex: 1 1 0; padding: 1mm 2mm; } .sum > div + div { border-left: 1px solid #000; }
  .sum .t { font-weight: 700; text-align: center; text-decoration: underline; }
  .sum table.grid { margin: 0.6mm 0 0; }
  .bar-row { margin: 0 0 2.2mm; break-inside: avoid; page-break-inside: avoid; }
  .bar-title { font-size: ${TABLE_FONT_PT}; font-weight: 700; }
  .bar { display: flex; align-items: center; gap: 2mm; font-size: ${TABLE_FONT_PT}; margin-top: 0.4mm; }
  .bar .lab { width: 22mm; flex: none; }
  .bar .track { flex: 1 1 0; height: 3.4mm; border: 1px solid #000; position: relative; }
  .bar .fill { height: 100%; }
  .bar .val { width: 14mm; text-align: right; flex: none; }
  .fill.plan { background: #c8c8c8; } .fill.actual { background: #1f1f1f; } .fill.week { background: #7a7a7a; }
  .stat { display: flex; gap: 3mm; margin: 1mm 0 2mm; }
  .stat > div { flex: 1 1 0; border: 1px solid #000; padding: 1mm 2mm; text-align: center; }
  .stat b { display: block; font-size: 1.15em; }
  .report-sign { margin-top: 3mm; display: flex; gap: 4mm; break-inside: avoid; page-break-inside: avoid; }
  .report-sign > div { flex: 1 1 0; min-width: 0; }
  .sign-right { display: flex; justify-content: flex-end; margin-top: 3mm; padding-right: 8mm; break-inside: avoid; page-break-inside: avoid; }
  .notes { margin-top: 3mm; font-size: ${TABLE_FONT_PT}; }
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 2mm; }
${govSignBlockCss()}`
}

function peopleOf(people, grp) {
  return (people ?? []).filter(p => p.grp === grp).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

// ช่องลงนาม: มีชื่อ = วงเล็บชื่อ · ไม่มีชื่อ = วงเล็บเว้นให้เขียนมือ (ใบต้องเวียนเซ็นได้เสมอ)
// roleBelow: ตำแหน่งในสัญญา (เช่น "ผู้ควบคุมงานของผู้ว่าจ้าง") ยาวราว 42mm — วางต่อท้ายเส้นในบล็อกสองคอลัมน์ (คอลัมน์ละ ~78mm) ไม่พอ
// (เส้น 40mm + "ลงชื่อ" + คำต่อท้ายเกินคอลัมน์ ล้นขอบขวาและคำต่อท้ายแต่ละช่องเริ่มคนละแนว) จึงย้ายลงเป็นบรรทัดใต้เส้นตามที่ govSignRow รองรับ
function signRow(person, role, { roleBelow = false } = {}) {
  const title = person?.position_title
  const below = [person?.name ? `(${esc(person.name)})` : govNameBlank()]
  if (title) below.push(esc(title))
  if (roleBelow) return govSignRow({ below: [...below, esc(role)] })
  return govSignRow({ role: esc(role), below })
}

function pageOne({ tenant, project, contract, report, sheet, people, departmentName, emblemUrl }) {
  const overall = sheet.overall
  const timing = sheet.timing
  const spec = contract?.spec ?? {}
  const supervisors = peopleOf(people, 'supervisor')
  const head = supervisors.find(p => /หัวหน้า/.test(p.duty ?? '')) ?? supervisors[0]
  const department = [departmentName || 'กองช่าง', tenant?.name].filter(Boolean).join(' ')
  const subject = `รายงานผลการก่อสร้างประจำสัปดาห์${spec.road_type ? ` (ประเภทถนน ${spec.road_type})` : ''}`
  const finance = report.finance ?? {}
  const budgetRows = (finance.budget_rows ?? []).length ? finance.budget_rows : [{}]
  const sections = (spec.sections ?? []).filter(s => s.name || s.length_km || s.surface)
  const remaining = timing
    ? (timing.remainingDays < 0 ? `เกินกำหนด ${timing.overdueDays} วัน` : `${timing.remainingDays} วัน (${timing.remainingPct.toFixed(1)}%)`)
    : '–'
  return `<section class="pg">
  ${report.status === 'final' ? '' : '<p class="draft-note">ฉบับร่าง — ยังไม่ล็อกรายงาน ตัวเลขอาจเปลี่ยน</p>'}
  <div class="head"><div class="emblem">${emblemUrl ? `<img src="${esc(emblemUrl)}" alt="" onerror="this.style.display='none'">` : ''}</div><h1>บันทึกข้อความ</h1></div>
  <p class="field"><b>ส่วนราชการ</b>&nbsp;&nbsp;${esc(department)}</p>
  <div class="field-row">
    <p class="field left"><b>ที่</b>&nbsp;&nbsp;${orBlank(report.memo_no, '38mm')}</p>
    <p class="field right"><b>วันที่</b>&nbsp;&nbsp;${report.memo_date ? esc(dateText(report.memo_date)) : blank('38mm')}</p>
  </div>
  <p class="field"><b>เรื่อง</b>&nbsp;&nbsp;${esc(subject)}</p>
  <p class="field"><b>เรียน</b>&nbsp;&nbsp;${orBlank(report.memo_to, '90mm')}</p>
  <hr class="rule">
  <p class="body-line">รายงานครั้งที่ ${esc(report.report_no ?? report.week_no)} สัปดาห์ที่ ${esc(report.week_no)} ระหว่างวันที่ ${esc(thaiDateRange(report.period_start, report.period_end))}</p>
  <p class="body-line">โครงการ ${esc(project.title)}</p>
  <p class="body-line">สถานที่ก่อสร้าง ${orBlank(project.location_desc, '60mm')}</p>
  <p class="body-line">ตามสัญญาจ้างเลขที่ ${orBlank(project.contract_no, '30mm')} ลงวันที่ ${contract?.contract_date ? esc(dateText(contract.contract_date)) : blank('34mm')}
    บันทึกแนบท้ายที่ ${orBlank(contract?.attach_no, '18mm')} ลงวันที่ ${contract?.attach_date ? esc(dateText(contract.attach_date)) : blank('34mm')}</p>
  ${spec.road_type || spec.length_km || spec.width_m
    ? `<p class="body-line">ลักษณะและขอบเขตงาน ${esc(spec.road_type || '')}${spec.length_km ? ` ความยาวทั้งหมด ${esc(spec.length_km)} กม.` : ''}${spec.width_m ? ` ความกว้าง ${esc(spec.width_m)} ม.` : ''}</p>` : ''}
  ${sections.map((s, i) => `<p class="body-line indent">${i + 1}. ช่วงถนน ${esc(s.name)}${s.length_km ? ` ความยาว ${esc(s.length_km)} กม.` : ''}${s.surface ? ` ผิวทาง ${esc(s.surface)}` : ''}</p>`).join('\n  ')}

  <p class="doc-title" style="margin-top:2mm">การปฏิบัติงาน และเงินงบประมาณและการเบิกจ่าย</p>
  <div class="sum">
    <div>
      <p class="t">% ผลงานก่อสร้าง</p>
      <table class="grid"><thead><tr><th>แผน (ที่ตั้งในระบบ)</th><th>ผลงาน</th><th>เร็ว/ช้า</th></tr></thead>
        <tbody><tr><td class="c">${esc(formatPct(overall.plan))}</td><td class="c"><b>${esc(formatPct(overall.actual))}</b></td><td class="c">${esc(overall.label.text)}</td></tr></tbody></table>
      <p class="body-line">ระยะเวลาก่อสร้างคงเหลือ ${esc(remaining)}</p>
      <p class="body-line">แผนตามเวลา ${esc(formatPct(timing?.planPct))}${timing ? ` (${esc(timing.label.text)})` : ''}</p>
      <p class="body-line">ค่าจ้างล่วงหน้า ${finance.advance_amount ? esc(money(finance.advance_amount)) : '–'} บาท${finance.advance_pct ? ` (${esc(finance.advance_pct)}%)` : ''}</p>
    </div>
    <div>
      <p class="t">เงินงบประมาณ และการเบิกจ่าย</p>
      <table class="grid"><thead><tr><th>ปีงบประมาณ</th><th>งวดทั้งหมด</th><th>ตรวจรับแล้ว</th><th>เบิกจ่ายแล้ว</th><th>คงเหลือ</th></tr></thead>
        <tbody>${budgetRows.map(r => `<tr><td class="c">${dash(r.year)}</td><td class="c">${dash(r.installments_total)}</td><td class="c">${dash(r.inspected)}</td><td class="c">${dash(r.paid)}</td><td class="c">${dash(r.remaining)}</td></tr>`).join('')}</tbody></table>
    </div>
  </div>
  <p class="body-line" style="margin-top:3mm;text-align:right;padding-right:8mm">จึงเรียนมาเพื่อโปรดทราบ</p>
  <div class="sign-right sign-block">${signRow(head, 'หัวหน้าผู้ควบคุมงาน')}</div>
</section>`
}

function pageTwo({ project, contract, people, tenant }) {
  const supervisors = peopleOf(people, 'supervisor')
  const kv = [
    ['โครงการ', project.title],
    ['สถานที่ก่อสร้าง', project.location_desc],
    ['สัญญาเลขที่', project.contract_no],
    ['ลงวันที่', contract?.contract_date ? dateText(contract.contract_date) : ''],
    ['เริ่มสัญญา วันที่', project.start_date ? dateText(project.start_date) : ''],
    ['สิ้นสุดสัญญา วันที่', project.end_date ? dateText(project.end_date) : ''],
    ['ต่อสัญญาถึง', contract?.extended_until ? dateText(contract.extended_until) : ''],
    ['ราคาค่าก่อสร้าง', project.contract_amount ? `${money(project.contract_amount)} บาท` : ''],
    ['จำนวนงวดงาน', contract?.installments_total ? `${contract.installments_total} งวด` : ''],
    ['เจ้าของโครงการ', tenant?.name],
    ['ผู้ออกแบบ', contract?.designer_name],
    ['ผู้รับจ้าง', project.contractor_name],
    ['ผู้ควบคุมงาน', supervisors.map(p => p.name).filter(Boolean).join(', ')],
  ]
  const table = group => {
    const rows = peopleOf(people, group.key)
    return `<p class="sec">${esc(group.title)}</p>
  <table class="grid"><colgroup><col style="width:10mm"><col style="width:58mm"><col style="width:44mm"><col></colgroup>
    <thead><tr><th>ลำดับ</th><th>ชื่อ-นามสกุล</th><th>${esc(group.positionLabel)}</th><th>หน้าที่</th></tr></thead>
    <tbody>${(rows.length ? rows : [{}]).map((p, i) => `<tr><td class="c">${i + 1}</td><td>${dash(p.name)}</td><td>${dash(p.position_title)}</td><td>${dash(p.duty)}</td></tr>`).join('')}</tbody></table>`
  }
  return `<section class="pg">
  <p class="doc-title">ข้อมูลโครงการ</p>
  <p class="sec">รายละเอียดของสัญญา</p>
  <table class="kv">${kv.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${String(v ?? '').trim() ? esc(v) : blank('60mm')}</td></tr>`).join('')}</table>
  ${PEOPLE_GROUPS.map(table).join('\n  ')}
</section>`
}

function pageThree({ report, sheet }) {
  const rows = sheet.items
  return `<section class="pg">
  <p class="doc-title">ผลการดำเนินงานก่อสร้าง</p>
  <p class="body-line">ระหว่างวันที่ ${esc(thaiDateRange(report.period_start, report.period_end))} (สัปดาห์ที่ ${esc(report.week_no)})</p>
  <table class="grid"><colgroup><col style="width:8mm"><col><col style="width:13mm"><col style="width:15mm"><col style="width:16mm"><col style="width:14mm"><col style="width:15mm"><col style="width:22mm"><col style="width:17mm"></colgroup>
    <thead><tr><th>ที่</th><th>รายการงาน</th><th>สัดส่วน (%)</th><th>ก่อนหน้า (%)</th><th>สัปดาห์นี้ (%)</th><th>สะสม (%)</th><th>แผนสะสม (%)</th><th>เร็ว/ช้า</th><th>ผลถ่วงน้ำหนัก (%)</th></tr></thead>
    <tbody>
${rows.map((r, i) => `      <tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td class="c">${esc(num(r.weight))}</td><td class="c">${esc(num(r.prev))}</td><td class="c">${esc(num(r.week))}</td><td class="c"><b>${esc(num(r.cum))}</b></td><td class="c">${r.plan === null ? '–' : esc(num(r.plan))}</td><td class="c">${esc(r.label.text)}</td><td class="c">${esc(r.weighted.toFixed(2))}</td></tr>`).join('\n')}
      <tr class="total"><td></td><td>รวมถ่วงน้ำหนัก</td><td class="c">100</td><td class="c">${esc(sheet.overall.prev.toFixed(2))}</td><td class="c">${esc(sheet.overall.week.toFixed(2))}</td><td class="c">${esc(sheet.overall.actual.toFixed(2))}</td><td class="c">${sheet.overall.plan === null ? '–' : esc(sheet.overall.plan.toFixed(2))}</td><td class="c">${esc(sheet.overall.label.text)}</td><td class="c">${esc(sheet.overall.actual.toFixed(2))}</td></tr>
    </tbody></table>
  <p class="notes">แผนสะสมเป็นแผนที่ตั้งในระบบ (คำนวณเชิงเส้นจากวันเริ่ม–สิ้นสุดของแต่ละรายการ หรือที่ผู้ควบคุมงานแก้ทับเฉพาะสัปดาห์นี้) ไม่ใช่แผนตามสัญญา</p>
</section>`
}

function dayTable(title, rows, dates) {
  const cols = dates.length || 1
  const data = rows.length ? rows : [{ name: '', days: [] }]
  return `<table class="grid"><colgroup><col>${dates.map(() => '<col style="width:14mm">').join('')}</colgroup>
    <thead><tr><th>${esc(title)}</th>${dates.map(d => `<th>${esc(thaiShortDate(d, false))}</th>`).join('')}</tr></thead>
    <tbody>${data.map(r => `<tr><td>${dash(r.name)}</td>${Array.from({ length: cols }, (_, i) => `<td class="c">${r.days?.[i] ? esc(r.days[i]) : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

function pageFour({ report }) {
  const dates = periodDates(report.period_start, report.period_end)
  const weather = report.weather ?? {}
  return `<section class="pg">
  <p class="doc-title">บุคลากร เครื่องจักร และสภาพอากาศ</p>
  <p class="body-line">ระหว่างวันที่ ${esc(thaiDateRange(report.period_start, report.period_end))}</p>
  <p class="sec">กำลังคน (จำนวนคนต่อวัน)</p>
  ${dayTable('ตำแหน่ง/ประเภทแรงงาน', report.crew ?? [], dates)}
  <p class="sec">เครื่องจักร (จำนวนเครื่องต่อวัน)</p>
  ${dayTable('เครื่องจักร', report.machinery ?? [], dates)}
  <p class="sec">ตารางแสดงสภาพอากาศ</p>
  <table class="grid"><colgroup><col>${dates.map(() => '<col style="width:14mm">').join('')}</colgroup>
    <thead><tr><th>สภาพอากาศ</th>${dates.map(d => `<th>${esc(thaiShortDate(d, false))}</th>`).join('')}</tr></thead>
    <tbody>${WEATHER_ROWS.map(row => `<tr><td>${esc(row.group)}${row.label ? ` — ${esc(row.label)}` : ''}</td>${dates.map(d => `<td class="c">${(weather[d] ?? []).includes(row.key) ? '✓' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
</section>`
}

function pageFive({ report, people }) {
  const logs = report.daily_log ?? []
  const issues = report.issues ?? {}
  const supervisors = peopleOf(people, 'supervisor')
  const reps = peopleOf(people, 'contractor_rep')
  const field = (label, value) => `<p class="body-line"><b>${esc(label)}:</b> ${String(value ?? '').trim() ? esc(value) : 'ไม่มี'}</p>`
  return `<section class="pg">
  <p class="doc-title">บันทึกการปฏิบัติงานของผู้รับจ้าง</p>
  <table class="grid"><colgroup><col style="width:34mm"><col><col style="width:26mm"></colgroup>
    <thead><tr><th>วัน เดือน ปี</th><th>รายละเอียดการปฏิบัติงาน</th><th>หมายเหตุ</th></tr></thead>
    <tbody>${(logs.length ? logs : [{}]).map(r => `<tr><td>${r.date ? esc(dateText(r.date)) : ''}</td><td style="white-space:pre-wrap">${dash(r.detail)}</td><td>${dash(r.note)}</td></tr>`).join('')}</tbody></table>
  <p class="sec">สรุปปัญหา อุปสรรค และเหตุการณ์</p>
  ${field('ปัญหา - อุปสรรค', issues.problems)}
  ${field('แนวทางแก้ไข', issues.solution)}
  ${field('เหตุการณ์อื่นๆ', issues.other)}
  <div class="report-sign sign-block">
    <div class="center-row">${signRow(supervisors[0], 'ผู้ควบคุมงานของผู้ว่าจ้าง', { roleBelow: true })}</div>
    <div class="center-row">${signRow(supervisors[1], 'ผู้ควบคุมงานของผู้ว่าจ้าง', { roleBelow: true })}</div>
  </div>
  <div class="report-sign sign-block">
    <div class="center-row">${signRow(supervisors[2], 'ผู้ควบคุมงานของผู้ว่าจ้าง', { roleBelow: true })}</div>
    <div class="center-row">${signRow(reps[0], 'ผู้แทนผู้รับจ้าง', { roleBelow: true })}</div>
  </div>
</section>`
}

const clampPct = n => Math.min(100, Math.max(0, Number(n) || 0))
function pageSix({ report, sheet }) {
  const bar = (cls, label, value) => `<div class="bar"><span class="lab">${esc(label)}</span><span class="track"><span class="fill ${cls}" style="display:block;width:${clampPct(value).toFixed(1)}%"></span></span><span class="val">${value === null ? '–' : esc(`${Number(value).toFixed(1)}%`)}</span></div>`
  const s = sheet.overall
  const t = sheet.timing
  return `<section class="pg">
  <p class="doc-title">กราฟแสดงความก้าวหน้าของงานก่อสร้าง</p>
  <p class="body-line">สัปดาห์ที่ ${esc(report.week_no)} (${esc(thaiDateRange(report.period_start, report.period_end))})</p>
  <div class="stat">
    <div>ผลงานจริงถ่วงน้ำหนัก<b>${esc(formatPct(s.actual))}</b></div>
    <div>แผนที่ตั้งในระบบ<b>${esc(formatPct(s.plan))}</b></div>
    <div>เทียบแผน<b>${esc(s.label.text)}</b></div>
    <div>แผนตามเวลา<b>${esc(formatPct(t?.planPct))}</b></div>
  </div>
  ${sheet.items.map((r, i) => `<div class="bar-row"><p class="bar-title">${i + 1}. ${esc(r.name)} <span style="font-weight:400">(สัดส่วน ${esc(num(r.weight))}%)</span></p>
    ${bar('plan', 'แผนสะสม', r.plan)}${bar('actual', 'จริงสะสม', r.cum)}${bar('week', 'ในสัปดาห์นี้', r.week)}</div>`).join('\n  ')}
  <p class="notes">${esc(CONSTRUCTION_REPORT_DISCLAIMER)}</p>
</section>`
}

/**
 * @param {object} args
 * @param {{ name?: string }} args.tenant
 * @param {object} args.project  แถว civil_projects
 * @param {object|null} args.contract  แถว civil_project_contracts
 * @param {Array} args.people  แถว civil_project_people
 * @param {object} args.report  แถว civil_weekly_reports (ฉบับร่างอาจมีค่าที่ยังไม่บันทึกจากหน้าจอ)
 * @param {object} args.sheet   ตารางผลงาน (buildReportSheet หรือ frozen)
 * @param {string} [args.departmentName]
 * @param {string} [args.emblemUrl]  URL เต็มของ /images/garuda.svg (หน้าต่างพิมพ์ไม่มี base URL)
 * @param {Date} [args.printedAt]
 */
export function buildConstructionReportHtml({ tenant, project, contract = null, people = [], report, sheet, departmentName = '', emblemUrl = '', printedAt = new Date() }) {
  const ctx = { tenant, project, contract, people, report, sheet, departmentName, emblemUrl }
  const origin = `พิมพ์เมื่อ ${thaiDateFromDateInput(`${printedAt.getFullYear()}-${String(printedAt.getMonth() + 1).padStart(2, '0')}-${String(printedAt.getDate()).padStart(2, '0')}`)} · ${govEServiceOriginText(tenant)}`
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(`รายงานผลการก่อสร้างสัปดาห์ที่ ${report.week_no} ${project.title}`)}</title>
${GOV_FONT_LINK}
<style>${pageCss()}
</style>
</head><body>
<div class="sheet">
${pageOne(ctx)}
${pageTwo(ctx)}
${pageThree(ctx)}
${pageFour(ctx)}
${pageFive(ctx)}
${pageSix(ctx)}
  <div class="origin">${esc(origin)}</div>
</div>
</body></html>`
}

// เปิดหน้าต่างก่อนรอข้อมูลใดๆ (ข้อมูลโหลดมาแล้ว) ไม่งั้นเบราว์เซอร์มือถือบล็อก pop-up แล้วรอฟอนต์ราชการก่อนสั่งพิมพ์
// addMobileCloseButton: มือถือเปิดแท็บใหม่แล้วไม่มีปุ่มปิด (เหตุเดียวกับใบยานพาหนะ 2569-10-25)
export function printConstructionReport({ tenant, project, bundle, report, sheet, departmentName = '' }) {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) {
    alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    return
  }
  const html = buildConstructionReportHtml({
    tenant, project, contract: bundle.contract, people: bundle.people, report, sheet, departmentName,
    emblemUrl: `${window.location.origin}/images/garuda.svg`,
  })
  win.document.open()
  win.document.write(addMobileCloseButton(html))
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) await Promise.race([win.document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))])
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    win.focus()
    win.print()
  }, 200)
}
