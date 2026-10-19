// ใบ "สรุปเรื่องร้องเรียน/ร้องทุกข์ประจำเดือน" — A4 แนวตั้ง 1 แผ่น พิมพ์จากหน้า /reports/complaints โหมดรายเดือน
//
// ใบนี้เป็น "สรุปข้อมูลจากระบบ" ไม่ใช่เอกสารรับรองทางราชการ จึงไม่มีช่องลงนาม
// (เจ้าของระบบสั่ง 2569-10-18: ทำทุกอย่างในระบบ พิมพ์แค่เมื่อต้องใช้กระดาษ)
//
// ไม่มีข้อมูลส่วนบุคคลใดเลย — มีแต่ยอดรวมจาก RPC สาธารณะ (ชื่อ เบอร์ รายละเอียด หมู่บ้าน พิกัดไม่เคยถูกส่งมา)
// และ "ไม่มีตารางทีละเรื่อง" ตามที่เจ้าของระบบอนุมัติ: ตารางแบบนั้นระบุสถานที่และผู้ถูกร้องเรียนได้
// ชื่อ อปท. กับชื่อหมวดมาจากฐานข้อมูลที่แอดมินแก้ได้ ทุกค่าจึงต้องผ่าน esc()

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText,
  govPageCss, govPagePadding,
} from './govDocStyle.js'
import { formatCount, formatDecimal, formatPercent } from './complaintMonthlySummary.js'
import { QUIET_MODULES, qrLayout } from './qrSvg.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function pageCss() {
  // แนวตั้งเจาะรูด้านซ้าย: govPageCss/govPagePadding เลือกขอบ 1.2/2/0.9/3 ซม. ให้เอง
  // ขอบกระดาษย้ายมาเป็น padding ของ .sheet (hideBrowserHeader) เพื่อไม่ให้เบราว์เซอร์วาดหัว/ท้ายกระดาษทับ
  return `
  ${govPageCss({ size: 'A4 portrait', hideBrowserHeader: true })}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #000; ${govDocFontCss()} }
  .sheet { width: 210mm; min-height: 297mm; padding: ${govPagePadding({ size: 'A4 portrait' })}; }
  @media print { .sheet { width: auto; min-height: 295mm; } }
  p { margin: 0; }
  .title { text-align: center; font-weight: 700; font-size: 1.15em; }
  .sub { text-align: center; }
  .narrative { margin-top: 1.5mm; text-indent: 1.25cm; }
  .title + .sub + .narrative { margin-top: 4mm; }
  .section { margin: 4mm 0 1mm; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #000; padding: 0.4mm 2mm; vertical-align: top; }
  th { font-weight: 700; text-align: center; }
  td.num { text-align: center; white-space: nowrap; }
  tfoot td { font-weight: 700; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .notes { margin-top: 2mm; }
  .notes p { padding-left: 5mm; text-indent: -5mm; }
  .notes p.section { padding-left: 0; text-indent: 0; margin-top: 0; }
  .report { display: flex; align-items: center; gap: 4mm; margin-top: 3mm; break-inside: avoid; page-break-inside: avoid; }
  .report svg { flex: none; width: 24mm; height: 24mm; }
  .report-title { font-weight: 700; }
  .report .origin { text-align: left; margin-top: 1mm; }
  .report-url { overflow-wrap: anywhere; }
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 4mm; }`
}

function statusTable(summary) {
  const rows = [
    ['รับเรื่องทั้งหมด', summary.total, summary.total ? 100 : 0],
    ['ดำเนินการแล้วเสร็จ', summary.resolved, summary.resolvedPercent],
    ['อยู่ระหว่างดำเนินการ (รวมที่รอรับเรื่อง)', summary.ongoing, summary.ongoingPercent],
    ['ไม่รับเรื่อง/ยกเลิก', summary.rejected, summary.rejectedPercent],
  ]
  const avg = summary.avgDays != null
    ? `<tr><td colspan="3">ระยะเวลาเฉลี่ยจากรับเรื่องถึงดำเนินการแล้ว (เฉพาะเรื่องที่เสร็จ) ${esc(formatDecimal(summary.avgDays))} วัน</td></tr>`
    : ''
  return `<table>
    <colgroup><col><col style="width:30mm"><col style="width:20mm"></colgroup>
    <thead><tr><th>ผลการดำเนินงาน</th><th>จำนวน (เรื่อง)</th><th>ร้อยละ</th></tr></thead>
    <tbody>
${rows.map(([label, count, percent]) => `<tr><td>${esc(label)}</td><td class="num">${esc(formatCount(count))}</td><td class="num">${esc(formatPercent(percent))}</td></tr>`).join('\n')}
${avg}
    </tbody>
  </table>`
}

function categoryTable(summary) {
  if (!summary.categoriesComplete) return ''
  if (!summary.categories.length) return ''
  const sum = summary.categories.reduce((total, c) => total + c.count, 0)
  return `<p class="section">สัดส่วนเรื่องที่รับ จำแนกตามหมวด</p>
  <table>
    <colgroup><col style="width:11mm"><col><col style="width:30mm"><col style="width:20mm"></colgroup>
    <thead><tr><th>ที่</th><th>หมวด</th><th>จำนวน (เรื่อง)</th><th>ร้อยละ</th></tr></thead>
    <tbody>
${summary.categories.map((c, i) => `<tr><td class="num">${i + 1}</td><td>${esc(c.label)}</td><td class="num">${esc(formatCount(c.count))}</td><td class="num">${esc(formatPercent(c.percent))}</td></tr>`).join('\n')}
    </tbody>
    <tfoot><tr><td></td><td>รวม</td><td class="num">${esc(formatCount(sum))}</td><td class="num">${esc(formatPercent(summary.total ? 100 : 0))}</td></tr></tfoot>
  </table>`
}

// ท้ายใบ: ช่อง "แจ้งเรื่อง/ติดตามเรื่อง" พร้อม QR — ใบที่ติดบอร์ดหมู่บ้านต้องบอกชาวบ้านได้ว่าแจ้งที่ไหน
// บรรทัดแหล่งที่มา (origin) ย้ายเข้ามาอยู่ในช่องนี้ ไม่ใช่เพิ่มต่อท้าย: ใบที่หมวดเยอะมีที่ว่างเหลือไม่ถึง 1 ซม.
// QR 24 มม. + บรรทัดข้อความข้างๆ กินที่เพิ่มราว 1.7 ซม. แทนที่จะเป็น 3.2 ซม. ถ้าวางต่อท้าย (วัดแล้ว ดูเทสต์)
// QR เป็นเวกเตอร์ฝังในใบ (ไม่โหลดอะไรจากเครือข่าย) สร้างไม่ได้ก็เหลือลิงก์ตัวอักษร ใบไม่ล้ม
// ไม่ส่งลิงก์ = บรรทัดแหล่งที่มาเดิมกลางใบเหมือนก่อนมีช่องนี้
function tailBlock(reportUrl, origin) {
  const url = String(reportUrl ?? '').trim()
  if (!url) return `<div class="origin">${esc(origin)}</div>`
  const qr = qrLayout(url, 1000) // ด้านจริงของใบกำหนดด้วย CSS (24mm) ตรงนี้ใช้แค่เมทริกซ์
  const box = qr ? qr.size + QUIET_MODULES * 2 : 0
  const svg = qr
    ? `<svg viewBox="0 0 ${box} ${box}" role="img" aria-label="QR code ลิงก์หน้าแจ้งเรื่อง"><rect width="${box}" height="${box}" fill="#fff"/><path transform="translate(${QUIET_MODULES} ${QUIET_MODULES})" d="${qr.d}" fill="#000"/></svg>`
    : ''
  return `<div class="report">
    ${svg}
    <div><p class="report-title">แจ้งเรื่อง/ติดตามเรื่องของท่าน</p><p class="report-url">${qr ? 'สแกน QR หรือเข้าที่ ' : 'เข้าที่ '}${esc(url.replace(/^https?:\/\//i, ''))}</p><p class="origin">${esc(origin)}</p></div>
  </div>`
}

/**
 * @param {object} args
 * @param {{ name?: string }} args.tenant
 * @param {ReturnType<import('./complaintMonthlySummary.js').summarizeMonth>} args.summary
 * @param {string} [args.reportUrl] ลิงก์หน้าแจ้งเรื่อง — ใส่แล้วท้ายใบมี QR + ข้อความชวนแจ้งเรื่อง
 */
export function buildComplaintMonthlyHtml({ tenant, summary, reportUrl = '' }) {
  const month = summary.period.label
  const origin = `${govEServiceOriginText(tenant)} · ข้อมูล ณ วันที่ ${summary.asOf}`
  const notes = [
    ...summary.notes,
    'ร้อยละปัดทศนิยม 1 ตำแหน่ง ผลรวมอาจไม่เท่า 100 พอดี',
    'สรุปนี้ไม่มีข้อมูลระบุตัวบุคคลและไม่แสดงรายเรื่อง',
  ]
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(`สรุปเรื่องร้องเรียนประจำเดือน${month}`)}</title>
${GOV_FONT_LINK}
<style>${pageCss()}
</style>
</head><body>
<div class="sheet">
  <p class="title">สรุปเรื่องร้องเรียน/ร้องทุกข์ประจำเดือน${esc(month)}</p>
  <p class="sub">${esc(tenant?.name ?? '')}</p>
${summary.sentences.map(sentence => `  <p class="narrative">${esc(sentence)}</p>`).join('\n')}
  <p class="section">ผลการดำเนินงาน</p>
  ${statusTable(summary)}
  ${categoryTable(summary)}
  <div class="notes">
    <p class="section">หมายเหตุ</p>
${notes.map((note, i) => `    <p>${i + 1}. ${esc(note)}</p>`).join('\n')}
  </div>
  ${tailBlock(reportUrl, origin)}
</div>
</body></html>`
}
