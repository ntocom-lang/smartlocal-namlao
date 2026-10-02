// ใบ "รายงานผลการปฏิบัติงานตามคำร้อง" ของเมนู ผลการปฏิบัติงาน — A4 แนวนอน
//   หน้า 1: สรุป 3 มิติรายหมวดตามส่วนที่ 1 ของแบบประเมินผลการปฏิบัติงาน + ช่องลงนาม
//   หน้าแนบ: รายการคำร้องที่เป็นหลักฐาน (แล้วเสร็จ / ค้าง ณ สิ้นช่วง / ไม่ทราบวันแล้วเสร็จ)
//
// ใบนี้เป็น "ข้อมูลประกอบ" ไม่ใช่ผลการประเมิน — ไม่มีคะแนน ไม่มีระดับผล ผู้ประเมินเทียบกับ
// ค่าเป้าหมายตามข้อตกลงการปฏิบัติราชการเอง (บรรทัดหมายเหตุบอกไว้ ห้ามตัดออก)
//
// ไม่มีข้อมูลส่วนบุคคลของผู้ร้อง (ชื่อ เบอร์ รายละเอียด ที่อยู่) ตรวจย้อนได้จากเลขที่คำร้อง
// หมู่บ้านกับลักษณะปัญหาเป็นข้อความที่ประชาชนพิมพ์ได้ ทุกค่าจึงต้องผ่าน esc()

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText,
  govPageCss, govPagePadding,
} from './govDocStyle.js'
import { govNameBlank, govSignBlockCss, govSignRow } from './govSignBlock.js'
import { pickSignatory, signatoryName, signatoryTitle } from './documentSignatories.js'
import { CHANNEL_LABELS, DIMENSION_LABELS, thaiShortDate } from './staffPerformance.js'
import { printableCategoryLabel } from './complaintCategoryLabels.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

/**
 * ผู้รับรองบนใบ: หัวหน้ากองของเจ้าตัว · ถ้าเจ้าตัวเป็นหัวหน้ากองเองหรือกองยังไม่ตั้งหัวหน้า ใช้ปลัด
 * rows = ทะเบียน document_signatories ที่มี profile_id ติดมา
 */
export function pickCertifier(rows, { departmentId = null, personId = null } = {}) {
  const head = departmentId ? pickSignatory(rows, { role: 'department_head', departmentId }) : null
  const row = head && !(personId && head.profile_id === personId)
    ? head
    : pickSignatory(rows, { role: 'clerk' })
  if (!row) return null
  const name = signatoryName(row)
  return name ? { name, title: signatoryTitle(row) } : null
}

const DASH = '–'
const rate = value => (value == null ? '' : ` (${value}%)`)
const count = (numerator, denominator) => (denominator ? `${numerator}/${denominator}` : DASH)

function summaryCells(group) {
  const { quantity, quality, benefit } = group
  const onTimeBase = benefit.onTime + benefit.late + benefit.openPastDue
  return [
    quantity.completed,
    quantity.received ? `${quantity.receivedDone}/${quantity.received}${rate(quantity.receivedDoneRate)}` : DASH,
    quantity.openAtEnd,
    quantity.completed ? `${count(quality.notReopened, quantity.completed)}${rate(quality.notReopenedRate)}` : DASH,
    quality.ratingCount ? `${quality.ratingAverage} (${quality.ratingCount})` : DASH,
    onTimeBase ? `${count(benefit.onTime, onTimeBase)}${rate(benefit.onTimeRate)}` : DASH,
    benefit.medianWorkingDays ?? DASH,
  ]
}

const OPEN_STATUS_LABELS = { received: 'รับเรื่องแล้ว', in_progress: 'กำลังดำเนินการ' }
const DUE_RESULT_LABELS = { on_time: 'ทันกำหนด', late: 'เกินกำหนด', no_due: 'ไม่มีกำหนด' }

function itemNotes(item) {
  const notes = []
  if (item.reopened) notes.push('ผู้ร้องเปิดเรื่องกลับ')
  if (item.closedOnBehalfBy) notes.push(`ปิดงานแทนโดย ${item.closedOnBehalfBy}`)
  if (item.rating != null) notes.push(`คะแนนผู้ร้อง ${item.rating}/5`)
  if (item.channel === 'oss_counter') notes.push(`รับแจ้งที่${CHANNEL_LABELS.oss_counter}`)
  if (item.dateAnomaly) notes.push('วันที่แล้วเสร็จก่อนวันรับเรื่อง')
  return notes.join(' · ')
}

// หมวดบรรทัดแรก ลักษณะปัญหาบรรทัดที่สอง — ปล่อยให้ตัดเองแล้วคำไทยขาดกลางคำ เช่น "เสา / เอียง"
function subjectHtml(item, categoryLabels) {
  // printableCategoryLabel: รหัสหมวดดิบ (water_repair) ต้องไม่หลุดลงใบที่ใช้ประกอบการประเมิน — ดู complaintCategoryLabels.js
  const category = esc(item.category ? printableCategoryLabel(item.category, categoryLabels[item.category] ?? item.category) : '')
  return item.issueType ? `${category}<br>${esc(item.issueType)}` : category
}

function thaiDateTime(value) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(value)
}

function pageCss() {
  // แนวนอนเจาะรูด้านบน: govPageCss/govPagePadding เลือกขอบ 3/2/1/2 ซม. ให้เอง
  // พื้นที่พิมพ์สูงเพียง 170 มม. — หน้า 1 จบได้ไม่เกิน 7 หมวด (วัดจริง 204.4 จาก 208 มม. เทสต์เลย์เอาต์ล็อกไว้)
  return `
  ${govPageCss({ size: 'A4 landscape', hideBrowserHeader: true })}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #000; ${govDocFontCss()} }
  .sheet { width: 297mm; min-height: 210mm; padding: ${govPagePadding({ size: 'A4 landscape' })}; }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  @media print { .sheet { width: auto; min-height: 208mm; } }
  p { margin: 0; }
  .report-title { text-align: center; font-weight: 700; font-size: 1.1em; }
  .report-sub { text-align: center; }
  .who { margin: 0 0 1.5mm; }
  table { width: 100%; border-collapse: collapse; }
  /* fixed + ความกว้างรายคอลัมน์ (colgroup): แถวไม่สูงเกินจนหน้า 1 ล้น และตัวเลขไม่ล้นทับเส้น
     ช่อง "x/y (z%)" กว้างพอสำหรับเลข 2 หลัก ถ้าเกินให้ตัดขึ้นบรรทัดแทนที่จะล้นช่องข้างๆ */
  table.summary, table.completed { table-layout: fixed; }
  table.summary td.num { white-space: normal; }
  th, td { border: 1px solid #000; padding: 0.6mm 1.2mm; vertical-align: top; }
  th { font-weight: 700; text-align: center; }
  td.num { text-align: center; white-space: nowrap; }
  tfoot td { font-weight: 700; }
  /* ตารางยาวขึ้นหน้าใหม่ได้ แต่หัวตารางต้องซ้ำทุกหน้าและแถวห้ามขาดกลาง */
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .notes { margin-top: 1.5mm; }
  .notes p { padding-left: 4mm; text-indent: -4mm; }
  .two-col { display: flex; gap: 8mm; break-inside: avoid; page-break-inside: avoid; }
  .two-col > div { flex: 1 1 0; min-width: 0; }
  .report-sign { margin-top: 3mm; }
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 2mm; }
  .list-title { font-weight: 700; margin: 3mm 0 1mm; }
${govSignBlockCss()}`
}

function summaryTable(summary, categoryLabels) {
  const rows = summary.byCategory.map(group => `<tr>
      <td>${esc(group.category ? printableCategoryLabel(group.category, categoryLabels[group.category] ?? group.category) : '')}</td>
      ${summaryCells(group).map(value => `<td class="num">${esc(value)}</td>`).join('')}
    </tr>`).join('\n')
  const total = summary.byCategory.length > 1
    ? `<tfoot><tr><td>รวมทุกหมวด</td>${summaryCells(summary.total).map(value => `<td class="num">${esc(value)}</td>`).join('')}</tr></tfoot>`
    : ''
  return `<table class="summary">
    <colgroup><col style="width:72mm"><col style="width:18mm"><col style="width:33mm"><col style="width:20mm">
      <col style="width:33mm"><col style="width:24mm"><col style="width:34mm"><col style="width:23mm"></colgroup>
    <thead>
      <tr><th rowspan="2">หมวดคำร้อง</th><th colspan="3">${esc(DIMENSION_LABELS.quantity)}</th>
        <th colspan="2">${esc(DIMENSION_LABELS.quality)}</th><th colspan="2">${esc(DIMENSION_LABELS.benefit)}</th></tr>
      <tr><th>แล้วเสร็จ</th><th>รับ/เสร็จ<br>ในช่วง</th><th>ค้างสิ้นช่วง</th>
        <th>ไม่ถูกเปิดกลับ</th><th>คะแนน<br>(เรื่อง)</th>
        <th>ทันกำหนด</th><th>วันทำการ*</th></tr>
    </thead>
    <tbody>
${rows || `<tr><td colspan="8" class="num">ไม่มีคำร้องในช่วงนี้</td></tr>`}
    </tbody>
    ${total}
  </table>`
}

function notesBlock(summary, scopeNote) {
  const extra = []
  const legacy = summary.completedItems.filter(item => item.completionSource === 'legacy').length
  if (legacy) extra.push(`† ${legacy} เรื่อง ใช้วันที่จากประวัติการดำเนินงาน (ก่อนมีการบันทึกวันแล้วเสร็จจากปุ่ม "ดำเนินการแล้ว")`)
  if (summary.undatedItems.length) extra.push(`ไม่ทราบวันแล้วเสร็จ ${summary.undatedItems.length} เรื่อง แสดงในรายการแนบ ไม่นับในตาราง`)
  const hidden = summary.confidential.completed + summary.confidential.openAtEnd
  if (hidden) extra.push(`เรื่องที่ต้องปกปิดตามหมวด ${hidden} เรื่อง (แล้วเสร็จ ${summary.confidential.completed}) ไม่แสดงรายละเอียด`)
  if (summary.rejected) extra.push(`ไม่รับเรื่อง ${summary.rejected} เรื่อง`)
  if (summary.holidayYearsMissing.length) {
    extra.push(`ยังไม่มีวันหยุดราชการของปี พ.ศ. ${summary.holidayYearsMissing.map(y => y + 543).join(', ')} ในระบบ วันทำการของปีนั้นตัดเฉพาะเสาร์-อาทิตย์`)
  }
  if (scopeNote) extra.push(scopeNote)
  return `<div class="notes">
    <p>หมายเหตุ ใช้ประกอบแบบประเมินผลการปฏิบัติงาน ส่วนที่ 1 ผลสัมฤทธิ์ของงาน · ผู้ประเมินเทียบกับค่าเป้าหมายตามข้อตกลงและให้คะแนนเอง</p>
    <p>ทันกำหนด = ทันกำหนด ÷ (ทันกำหนด + เกินกำหนด + ค้างที่เลยกำหนด) · *มัธยฐานวันทำการนับจากวันรับเรื่อง ไม่รวมวันหยุดราชการ</p>
${extra.length ? `    <p>${esc(extra.join(' · '))}</p>` : ''}
  </div>`
}

function signBlock(person, certifier) {
  const personBelow = [
    person?.name ? `(${esc(person.name)})` : govNameBlank(),
    person?.title ? `ตำแหน่ง ${esc(person.title)}` : 'ตำแหน่ง ....................',
    'วันที่ ....................',
  ]
  const certifierBelow = [
    certifier?.name ? `(${esc(certifier.name)})` : govNameBlank(),
    certifier?.title ? `ตำแหน่ง ${esc(certifier.title)}` : 'ตำแหน่ง ....................',
    'วันที่ ....................',
  ]
  // บล็อกเดียว 2 คอลัมน์ — เส้นยาวเท่ากันด้วย GOV_SIGN_LINE_W (ไม่ส่ง width เอง)
  return `<div class="two-col report-sign">
    <div>${govSignRow({ role: 'ผู้รายงาน', below: personBelow })}</div>
    <div>${govSignRow({ role: 'ผู้รับรอง', below: certifierBelow })}</div>
  </div>`
}

function listTables(summary, categoryLabels) {
  const parts = []
  if (summary.completedItems.length) {
    parts.push(`<p class="list-title">1. คำร้องที่แล้วเสร็จในช่วงนี้ ${summary.completedItems.length} เรื่อง</p>
  <table class="list completed">
    <colgroup><col style="width:13mm"><col style="width:25mm"><col style="width:50mm"><col style="width:28mm">
      <col style="width:27mm"><col style="width:31mm"><col style="width:14mm"><col style="width:23mm"><col></colgroup>
    <thead><tr><th>ลำดับ</th><th>เลขที่</th><th>หมวด / ลักษณะปัญหา</th><th>หมู่บ้าน</th><th>วันที่รับเรื่อง</th>
      <th>วันที่แล้วเสร็จ</th><th>วันทำการ</th><th>ผลเทียบกำหนด</th><th>หมายเหตุ</th></tr></thead>
    <tbody>
${summary.completedItems.map((item, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="num">${esc(item.refNo ?? '')}</td>
      <td>${subjectHtml(item, categoryLabels)}</td>
      <td>${esc(item.village ?? '')}</td>
      <td class="num">${esc(thaiShortDate(item.receivedDate))}</td>
      <td class="num">${esc(thaiShortDate(item.completedDate))}${item.completionSource === 'legacy' ? ' †' : ''}</td>
      <td class="num">${esc(item.workingDays ?? DASH)}</td>
      <td class="num">${esc(DUE_RESULT_LABELS[item.dueResult] ?? '')}</td>
      <td>${esc(itemNotes(item))}</td>
    </tr>`).join('\n')}
    </tbody>
  </table>`)
  }
  if (summary.openItems.length) {
    parts.push(`<p class="list-title">${parts.length + 1}. คำร้องที่ค้าง ณ สิ้นช่วง ${summary.openItems.length} เรื่อง</p>
  <table class="list">
    <thead><tr><th>ลำดับ</th><th>เลขที่</th><th>หมวด / ลักษณะปัญหา</th><th>หมู่บ้าน</th><th>วันที่รับเรื่อง</th>
      <th>วันครบกำหนด</th><th>สถานะ</th><th>หมายเหตุ</th></tr></thead>
    <tbody>
${summary.openItems.map((item, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="num">${esc(item.refNo ?? '')}</td>
      <td>${subjectHtml(item, categoryLabels)}</td>
      <td>${esc(item.village ?? '')}</td>
      <td class="num">${esc(thaiShortDate(item.receivedDate))}</td>
      <td class="num">${esc(item.dueDate ? thaiShortDate(item.dueDate) : DASH)}${item.pastDue ? ' (เลยกำหนด)' : ''}</td>
      <td class="num">${esc(item.finishedAfterPeriod ? `เสร็จ ${thaiShortDate(item.completedDate)}` : (OPEN_STATUS_LABELS[item.status] ?? item.status))}</td>
      <td>${esc(itemNotes(item))}</td>
    </tr>`).join('\n')}
    </tbody>
  </table>`)
  }
  if (summary.undatedItems.length) {
    parts.push(`<p class="list-title">${parts.length + 1}. คำร้องที่แล้วเสร็จแต่ไม่ทราบวันแล้วเสร็จ ${summary.undatedItems.length} เรื่อง (ไม่นับในตาราง)</p>
  <table class="list">
    <thead><tr><th>ลำดับ</th><th>เลขที่</th><th>หมวด / ลักษณะปัญหา</th><th>หมู่บ้าน</th><th>วันที่รับเรื่อง</th><th>หมายเหตุ</th></tr></thead>
    <tbody>
${summary.undatedItems.map((item, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="num">${esc(item.refNo ?? '')}</td>
      <td>${subjectHtml(item, categoryLabels)}</td>
      <td>${esc(item.village ?? '')}</td>
      <td class="num">${esc(thaiShortDate(item.receivedDate))}</td>
      <td>${esc(itemNotes(item))}</td>
    </tr>`).join('\n')}
    </tbody>
  </table>`)
  }
  return parts.join('\n')
}

/**
 * @param {object} args
 * @param {{ name?: string }} args.tenant
 * @param {{ name?: string, title?: string, departmentName?: string }} args.person
 * @param {string} args.periodLabel  จาก performancePeriodRange().label
 * @param {string} [args.categoryLabel] หมวดที่กรอง ไม่ส่ง = ทุกหมวด
 * @param {object} args.summary      จาก summarizePerformance()
 * @param {Record<string, string>} [args.categoryLabels]
 * @param {{ name: string, title?: string } | null} [args.certifier] จาก pickCertifier()
 * @param {string} [args.scopeNote]  เช่น หัวหน้ากองพิมพ์ของลูกน้อง = นับเฉพาะคำร้องของกอง
 * @param {Date} [args.printedAt]
 */
export function buildStaffPerformanceHtml({
  tenant, person, periodLabel, categoryLabel = '', summary, categoryLabels = {},
  certifier = null, scopeNote = '', printedAt = new Date(),
}) {
  const origin = `ข้อมูล ณ ${thaiDateTime(printedAt)} น. · ${govEServiceOriginText(tenant)}`
  const who = [
    `ชื่อ-สกุล ${person?.name || '-'}`,
    person?.title ? `ตำแหน่ง ${person.title}` : '',
    person?.departmentName ? `สังกัด ${person.departmentName}` : '',
  ].filter(Boolean).join('   ')
  const hasList = summary.completedItems.length + summary.openItems.length + summary.undatedItems.length > 0
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(`รายงานผลการปฏิบัติงานตามคำร้อง ${person?.name ?? ''}`)}</title>
${GOV_FONT_LINK}
<style>${pageCss()}
</style>
</head><body>
<div class="sheet landscape">
  <p class="report-title">รายงานผลการปฏิบัติงานตามคำร้อง ${esc(tenant?.name ?? '')}</p>
  <p class="report-sub">${esc(periodLabel)}${categoryLabel ? ` · เฉพาะหมวด${esc(categoryLabel)}` : ''}</p>
  <p class="who">${esc(who)}</p>
  ${summaryTable(summary, categoryLabels)}
  ${notesBlock(summary, scopeNote)}
  ${signBlock(person, certifier)}
  <div class="origin">${esc(origin)}</div>
</div>
${hasList ? `<div class="sheet landscape">
  <p class="report-title">รายการคำร้องประกอบรายงานผลการปฏิบัติงาน</p>
  <p class="report-sub">${esc(person?.name ?? '')} · ${esc(periodLabel)}</p>
  ${listTables(summary, categoryLabels)}
  <div class="origin">${esc(origin)}</div>
</div>` : ''}
</body></html>`
}
