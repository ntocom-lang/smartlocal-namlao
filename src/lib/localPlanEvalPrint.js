// ใบ "รายงานติดตามและประเมินผลแผนการดำเนินงาน" ประจำปีงบประมาณ (เมนูแผนพัฒนาท้องถิ่น แท็บติดตามผล) — A4 แนวนอน
//
// เนื้อหา: หัว (ชื่อ อปท.) · ตารางสรุปตามยุทธศาสตร์ · ยอดเบิกจ่ายรวมช่องเดียว (ณ วันที่ … ที่มา …) · ตารางรายโครงการ · ข้อสังเกต/ข้อเสนอแนะ
//   - ตารางรายโครงการ "ไม่มีคอลัมน์เบิกจ่าย" (เจ้าของระบบเลือก 2569-11-08: ยอดเบิกจ่ายเป็นตัวเลขรวมทั้งปีจาก e-LAAS ช่องเดียว)
//   - "ไม่มีช่องลงนาม" (เจ้าของตัดสิน — ข้อ 29(1) ให้คณะกรรมการกำหนดรูปแบบรายงานเอง ไม่มีแบบกลางที่ระเบียบบังคับ)
//   - ตารางสรุปคำนวณจากแผน+ผลตอนพิมพ์ ไม่เก็บซ้ำ · ข้อสังเกต/ข้อเสนอแนะเป็นข้อความที่คณะกรรมการเขียน ระบบไม่เขียนแทน
//
// มาตรฐานใบพิมพ์: ฟอนต์/ขนาด/ขอบ/@page มาจาก govDocStyle.js ทั้งหมด (14pt ทั้งใบ ไม่มีข้อยกเว้นเรื่องขนาดตัวอักษร — ตารางมีไม่เกิน 8 คอลัมน์ พอดี 257 มม.)
// เลย์เอาต์ตามใบแนวนอนของระบบ (localPlanPrint.js): @page margin เป็น 0 (ซ่อนหัวกระดาษของเบราว์เซอร์) ขอบทุกหน้ามาจากแถวเว้นระยะ thead/tfoot
// ของตารางห่อนอก · ไม่อ่านนาฬิกา (asOf ส่งเข้ามา) · ผลเป็นสตริงเอกสารทั้งหน้า ผู้เรียกเปิดหน้าต่างเอง (openOpPlanPrintWindow ของ localPlanPrint.js)
//
// ⚠️ ค่าจากข้อมูลทุกตัว (ชื่อ อปท./โครงการ/กอง/ยุทธศาสตร์/เหตุผล/ข้อสังเกต) ผ่าน esc() — ห้าม document.write ค่าดิบ
import { thaiShortDate } from './complaintReportPeriods.js'
import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss, govPagePadding,
} from './govDocStyle.js'
import { PROGRESS_LABELS, quarterOfDate, summarize } from './localPlanProgress.js'
import { formatBaht } from './localPlanView.js'

const [PAD_TOP, PAD_RIGHT, PAD_BOTTOM, PAD_LEFT] = govPagePadding({ size: 'A4 landscape' }).split(/\s+/)

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const isBlank = v => v === null || v === undefined || v === ''
const isoDay = v => String(v ?? '').slice(0, 10)
const dateText = v => (/^\d{4}-\d{2}-\d{2}$/.test(isoDay(v)) ? thaiShortDate(isoDay(v)) : '')
const money = v => (isBlank(v) ? '' : formatBaht(v))
// ป้ายสถานะ 3 คำที่ยาวเกินช่องแคบ ให้ขึ้นบรรทัดใหม่ตรงรอยต่อของคำ (ไม่ปล่อยให้เบราว์เซอร์ตัดกลางคำ "ดำเนิน|การ") — ป้ายเป็นค่าคงที่ในระบบ ไม่ใช่ข้อมูลผู้ใช้
const statusLabelHtml = label => esc(label).replace(/(ยังไม่|กำลัง|ไม่ได้)(ดำเนินการ)/, '$1<br>$2')

function placeLine(tenant) {
  const district = clean(tenant?.district).replace(/^(อำเภอ|อ\.)\s*/, '')
  const province = clean(tenant?.province).replace(/^(จังหวัด|จ\.)\s*/, '')
  return [clean(tenant?.name), district && `อำเภอ${district}`, province && `จังหวัด${province}`].filter(Boolean).join(' ')
}

/** คอลัมน์ "ไตรมาสที่เสร็จ / เหตุผล" ของรายโครงการ — แล้วเสร็จ: ไตรมาส + วันที่ · ไม่ได้ดำเนินการ: เหตุผล · อื่นๆ: ว่าง */
export function completionText(resolved, fiscalYear) {
  if (!resolved) return ''
  if (resolved.status === 'done') {
    const q = quarterOfDate(resolved.doneOn, fiscalYear)
    const date = dateText(resolved.doneOn)
    const approx = resolved.approxDate ? ' (โดยประมาณ ตามขั้นงานก่อสร้าง)' : ''
    if (q) return `ไตรมาส ${q}${date ? ` · ${date}` : ''}${approx}`
    return `${date || 'ไม่ระบุวันที่'}${approx}`
  }
  if (resolved.status === 'not_done') return clean(resolved.reason)
  return ''
}

function summaryTable(rows, departments, groupBy, firstHeader) {
  const { groups, totals } = summarize(rows, { groupBy, departments })
  const line = g => `<tr${g.key === 'all' ? ' class="total"' : ''}>
      <td class="l">${esc(g.label)}</td><td>${g.total}</td><td>${g.none}</td><td>${g.in_progress}</td><td>${g.done}</td><td>${g.not_done}</td>
      <td class="r">${esc(formatBaht(g.amount))}</td><td>${esc(g.donePct.toFixed(1))}</td>
    </tr>`
  return `<table class="grid sum">
    <colgroup><col class="s-name"><col class="s-n"><col class="s-n"><col class="s-n"><col class="s-n"><col class="s-n"><col class="s-amt"><col class="s-pct"></colgroup>
    <thead><tr>
      <th>${esc(firstHeader)}</th><th>ทั้งหมด</th><th>${statusLabelHtml(PROGRESS_LABELS.none)}</th><th>${statusLabelHtml(PROGRESS_LABELS.in_progress)}</th>
      <th>${statusLabelHtml(PROGRESS_LABELS.done)}</th><th>${statusLabelHtml(PROGRESS_LABELS.not_done)}</th><th>งบตามแผน (บาท)</th><th>ร้อยละที่แล้วเสร็จ</th>
    </tr></thead>
    <tbody>${groups.map(line).join('')}${groups.length ? line(totals) : '<tr class="empty"><td colspan="8">— ไม่มีรายการ —</td></tr>'}</tbody>
  </table>`
}

function projectTable(rows, departments, fiscalYear) {
  const deptName = new Map((departments ?? []).map(d => [d.id, d.name]))
  const body = rows.map((row, i) => {
    const { item, resolved } = row
    const who = item.source === 'external' ? clean(item.external_agency) : clean(deptName.get(row.departmentId))
    return `<tr>
      <td>${i + 1}</td><td class="l">${esc(clean(item.item_name))}</td><td class="l">${esc(who)}</td>
      <td class="r">${esc(money(item.amount))}</td><td>${statusLabelHtml(PROGRESS_LABELS[resolved?.status ?? 'none'])}</td>
      <td class="l">${esc(completionText(resolved, fiscalYear))}</td>
    </tr>`
  }).join('')
  // หัวคอลัมน์ไม่มีคำว่าเบิกจ่าย โดยตั้งใจ (ดูหัวไฟล์) — เทสต์ตรวจ
  return `<table class="grid proj">
    <colgroup><col class="p-no"><col class="p-name"><col class="p-who"><col class="p-amt"><col class="p-st"><col class="p-note"></colgroup>
    <thead><tr><th>ลำดับ</th><th>โครงการ/กิจกรรม</th><th>ผู้รับผิดชอบ</th><th>งบตามแผน (บาท)</th><th>ผลดำเนินการ</th><th>ไตรมาสที่แล้วเสร็จ / เหตุผล</th></tr></thead>
    <tbody>${body || '<tr class="empty"><td colspan="6">— ไม่มีรายการ —</td></tr>'}</tbody>
  </table>`
}

function textBlock(title, value) {
  const text = String(value ?? '').trim()
  return `<div class="block"><p class="h">${esc(title)}</p><p class="free">${text ? esc(text) : '—'}</p></div>`
}

/**
 * ใบรายงานติดตามและประเมินผล 1 ปีงบ → สตริง HTML ทั้งหน้า
 * tenant = { name, district, province } · fiscalYear = ปีงบ พ.ศ. · evaluation = แถว local_plan_evaluations หรือ null
 * rows = ผลของ buildProgressRows (รายการที่มีผลทั้งปี + ผลแต่ละรายการ) · departments = [{ id, name }] · asOf = 'YYYY-MM-DD' เวลาไทย
 */
export function buildEvalPrintHtml({ tenant = null, fiscalYear = null, evaluation = null, rows = [], departments = [], asOf = '' } = {}) {
  const orgName = clean(tenant?.name)
  const fy = Number.isFinite(Number(fiscalYear)) ? Number(fiscalYear) : ''
  const origin = govEServiceOriginText(orgName)
  const asOfMatch = String(asOf ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  const asOfText = asOfMatch ? `${Number(asOfMatch[3])}/${Number(asOfMatch[2])}/${Number(asOfMatch[1]) + 543}` : ''
  const hasTotal = evaluation && !isBlank(evaluation.disbursed_total)
  const disbursed = hasTotal
    ? `ยอดเบิกจ่ายรวมทั้งปี ${esc(formatBaht(evaluation.disbursed_total))} บาท ณ วันที่ ${esc(dateText(evaluation.disbursed_as_of))}${clean(evaluation.disbursed_source) ? ` ที่มา ${esc(clean(evaluation.disbursed_source))}` : ''}`
    : 'ยอดเบิกจ่ายรวมทั้งปี — ยังไม่ได้บันทึก'

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>รายงานติดตามและประเมินผลแผนการดำเนินงาน ปีงบประมาณ ${esc(fy)} ${esc(orgName)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ size: 'A4 landscape', hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { color: #000; ${govDocFontCss()} background: #fff; }
    .sheet { width: 297mm; min-height: 210mm; padding: 0 ${PAD_RIGHT} 0 ${PAD_LEFT}; }
    table.page { width: 100%; border-collapse: collapse; }
    table.page > thead > tr > td, table.page > tbody > tr > td, table.page > tfoot > tr > td { border: 0; padding: 0; text-align: left; vertical-align: top; }
    td.space-top { height: ${PAD_TOP}; }
    td.space-bottom { height: ${PAD_BOTTOM}; }
    h1 { margin: 0; font-size: inherit; font-weight: 700; text-align: center; }
    .title p { margin: 0; text-align: center; font-weight: 700; }
    .h { margin: 4mm 0 1mm; font-weight: 700; }
    .block { break-inside: avoid; page-break-inside: avoid; }
    .block .h { margin-top: 3mm; }
    .free { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    p.disb { margin: 3mm 0 0; font-weight: 700; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 3mm; text-align: center; }
    table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.grid th, table.grid td { border: 1px solid #000; padding: 0.8mm 1.2mm; text-align: center; vertical-align: middle; line-height: 1.15; overflow-wrap: anywhere; }
    table.grid th { font-weight: 700; }
    table.grid td.l { text-align: left; }
    table.grid td.r { text-align: right; }
    table.grid tr.total td { font-weight: 700; }
    table.grid tr.empty td { color: #555; padding: 4mm; }
    table.grid thead { display: table-header-group; }
    table.grid tr { break-inside: avoid; page-break-inside: avoid; }
    /* ความกว้างรวม 257 มม. (= พื้นที่พิมพ์แนวนอน) */
    col.s-name { width: 47mm; } col.s-n { width: 28mm; } col.s-amt { width: 36mm; } col.s-pct { width: 34mm; }
    col.p-no { width: 14mm; } col.p-name { width: 90mm; } col.p-who { width: 44mm; } col.p-amt { width: 33mm; } col.p-st { width: 28mm; } col.p-note { width: 48mm; }
    @media print { html, body { height: auto; } .sheet { width: auto; min-height: 0; height: auto; } }
  </style>
</head>
<body>
<section class="sheet">
<table class="page">
  <thead><tr><td class="space-top"></td></tr></thead>
  <tfoot><tr><td class="space-bottom"></td></tr></tfoot>
  <tbody><tr><td>
  <div class="title">
    <h1>รายงานติดตามและประเมินผลแผนการดำเนินงาน</h1>
    <p>ประจำปีงบประมาณ พ.ศ. ${esc(fy)}</p>
    <p>${esc(placeLine(tenant))}</p>
  </div>

  <p class="h">สรุปผลการดำเนินงานตามยุทธศาสตร์</p>
  ${summaryTable(rows, departments, 'strategy', 'ยุทธศาสตร์')}
  <p class="disb">${disbursed}</p>

  <p class="h">ผลการดำเนินงานรายโครงการ/กิจกรรม</p>
  ${projectTable(rows, departments, fy)}

  ${textBlock('ข้อสังเกต', evaluation?.observations)}
  ${textBlock('ข้อเสนอแนะ', evaluation?.recommendations)}
  <div class="eservice-origin">${esc(origin)}${asOfText ? ` · ข้อมูล ณ วันที่ ${esc(asOfText)}` : ''}</div>
  </td></tr></tbody>
</table>
</section>
</body>
</html>`
}
