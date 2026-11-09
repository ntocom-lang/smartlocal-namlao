// ใบพิมพ์ "รายงานอัตราการตอบแบบประเมินความพึงพอใจ เรื่องร้องเรียน/ร้องทุกข์ รายเดือน" — A4 แนวนอน
// แนบใบสมัครรางวัลเลิศรัฐ (ประเภทตอบโจทย์ตรงใจ) · ตรรกะนับอยู่ที่ complaintRatingResponseRate.js
// ไม่มีช่องลงนาม (รายงานข้อมูลจากระบบ ไม่ใช่หนังสือที่ต้องลงนาม)
//
// เลย์เอาต์ตามใบแนวนอนของระบบ (localPlanPrint.js): @page margin เป็น 0 (ซ่อนหัวกระดาษของเบราว์เซอร์) ขอบบน/ล่างของ
// "ทุกหน้า" มาจากแถวเว้นระยะใน thead/tfoot ของตารางห่อนอก · หัวตารางข้อมูลซ้ำทุกหน้า (thead { display: table-header-group })
//
// ⚠️ ค่าที่มาจากข้อมูล (ชื่อ อปท.) ผ่าน esc() · ไฟล์นี้ไม่อ่านนาฬิกา (asOfText ส่งเข้ามา) · ผลเป็นสตริงเอกสารทั้งหน้า
import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, GOV_FONT_SIZE, GOV_LINE_HEIGHT, govDocFontIdentityCss, govEServiceOriginText, govPageCss, govPagePadding,
} from './govDocStyle.js'
import { avgText, cellText, submittersText } from './complaintRatingResponseRate.js'
import { addMobileCloseButton } from './printWindowClose.js'

// ขอบกระดาษแนวนอนตามมาตรฐาน "บน ขวา ล่าง ซ้าย" แยกเป็นรายด้านไว้ใช้กับแถวเว้นระยะ
const [PAD_TOP, PAD_RIGHT, PAD_BOTTOM, PAD_LEFT] = govPagePadding({ size: 'A4 landscape' }).split(/\s+/)

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// หมายเหตุนิยามท้ายใบ — ข้อความเดียวกับใต้ตารางบนหน้าจอ (RatingResponseRateReport.jsx ใช้ชุดนี้ด้วย)
export const RESPONSE_RATE_NOTES = [
  'นับตามเดือนที่ปิดเรื่อง (closed_at เวลาไทย) ตัวหาร = คำร้องที่ปิดแล้ว ไม่รวมหมวดเฉพาะกิจ · ร้อยละทุกช่องเทียบกับจำนวน "ปิดแล้ว" ของเดือนนั้น',
  'ตัวเลขของเดือนก่อนๆ ขยับได้ เพราะผู้ใช้ให้คะแนนย้อนหลังได้หลังปิดเรื่อง',
  '"ผู้ยื่นเอง" ในเรื่องที่ สท. ยื่นแทน คือความเห็นของ สท. ไม่ใช่ของผู้รับบริการ · "สท. บันทึกแทน" คนกดคือ สท. ที่สอบถามผู้รับบริการแล้วบันทึกให้',
  '"เลขอ้างอิง" คือให้คะแนนโดยค้นด้วยเลขอ้างอิงโดยไม่ล็อกอิน ยืนยันตัวผู้ให้คะแนนไม่ได้',
  '"เสียงผู้รับบริการตัวจริง" = เรื่องที่มีคะแนนผ่านลิงก์ติดตาม หรือผู้ยื่นที่เป็นประชาชนให้คะแนนเอง (ไม่นับ สท. บันทึกแทน / เลขอ้างอิง / ผู้ยื่นที่เป็น สท. หรือเจ้าหน้าที่)',
  'บทบาทของผู้ยื่นอ่านจากบัญชีปัจจุบัน หากมีการเปลี่ยนบทบาทภายหลัง (เช่น สท. หมดวาระ) เรื่องเก่าจะย้ายกลุ่มตาม · "ประเมินภาพรวม" ไม่ผูกคำร้อง จึงไม่คิดร้อยละ',
]

const scoreCell = cell => `${esc(cellText(cell))}${cell.n > 0 ? `<span class="avg">เฉลี่ย ${esc(avgText(cell.avg))}</span>` : ''}`

function row(label, r, cls = '') {
  return `<tr class="${cls}">
    <td class="mon">${esc(label)}</td>
    <td class="closed">${esc(r.closed)}<span class="sub">${esc(submittersText(r.submitters))}</span></td>
    <td>${scoreCell(r.verified)}</td>
    <td>${scoreCell(r.via_link)}</td>
    <td>${scoreCell(r.proxy)}</td>
    <td>${scoreCell(r.linked_anon)}</td>
    <td>${esc(cellText(r.anyRated))}</td>
    <td class="genuine">${scoreCell(r.genuine)}</td>
    <td>${r.general.n > 0 ? `${esc(r.general.n)}<span class="avg">เฉลี่ย ${esc(avgText(r.general.avg))}</span>` : '–'}</td>
  </tr>`
}

/**
 * ใบรายงาน → สตริง HTML ทั้งหน้า
 * @param {{ result: { months: object[], total: object }, tenant?: { name?: string }, asOfText?: string }} input
 *   result = ผลของ buildMonthlyResponseRate (เรียงเก่า→ใหม่ ใบพิมพ์กลับเป็นล่าสุดอยู่บนเหมือนหน้าจอ) · asOfText = 'D/M/YYYY HH:MM' เวลาไทย
 */
export function buildRatingResponseRateHtml({ result, tenant = null, asOfText = '' } = {}) {
  const orgName = String(tenant?.name ?? '').replace(/\s+/g, ' ').trim()
  const months = [...(result?.months ?? [])].reverse()
  const body = months.length
    ? `${months.map(m => row(m.label, m)).join('\n')}\n${row('รวมทั้งหมด', result.total, 'total')}`
    : '<tr class="empty"><td colspan="9">— ยังไม่มีคำร้องที่ปิดแล้ว —</td></tr>'
  const notes = RESPONSE_RATE_NOTES.map(n => `<li>${esc(n)}</li>`).join('')

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>รายงานอัตราการตอบแบบประเมินความพึงพอใจ ${esc(orgName)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ size: 'A4 landscape', hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    /* ⚠️ ใช้ govDocFontIdentityCss() ไม่ใช่ govDocFontCss() โดยตั้งใจ (ข้อยกเว้นเรื่อง "ขนาดตัวอักษร" ตาม AGENTS.md):
       ตารางมี 9 คอลัมน์ ช่องตัวเลขกว้างเพียง ~25 มม. ข้อความ "12 (85.7%)" ที่ 14pt ตกบรรทัด จึงลดเฉพาะ "ตาราง" (table.rate) เป็น 11pt
       ชื่อเรื่อง/หมายเหตุท้ายใบยังเป็นขนาดมาตรฐาน (GOV_FONT_SIZE) ฟอนต์และ font-size-adjust ยังเป็นค่ากลาง (พิมพ์ออกเท่ากันทุกเครื่อง) */
    body { color: #000; ${govDocFontIdentityCss()} font-size: ${GOV_FONT_SIZE}; line-height: ${GOV_LINE_HEIGHT}; background: #fff; }
    .sheet { width: 297mm; padding: 0 ${PAD_RIGHT} 0 ${PAD_LEFT}; }
    table.page { width: 100%; border-collapse: collapse; }
    table.page > thead > tr > td, table.page > tbody > tr > td, table.page > tfoot > tr > td { border: 0; padding: 0; text-align: left; vertical-align: top; }
    td.space-top { height: ${PAD_TOP}; }
    td.space-bottom { height: ${PAD_BOTTOM}; }
    h1 { margin: 0; text-align: center; font-size: ${GOV_FONT_SIZE}; font-weight: 700; line-height: ${GOV_LINE_HEIGHT}; }
    .org { margin: 0; text-align: center; font-weight: 700; }
    .asof { margin: 0 0 2mm; text-align: center; }
    table.rate { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11pt; line-height: 1.2; }
    table.rate thead { display: table-header-group; }
    table.rate tr { break-inside: avoid; page-break-inside: avoid; }
    table.rate th, table.rate td { border: 1px solid #000; padding: 0.8mm 1.2mm; text-align: center; vertical-align: middle; overflow-wrap: anywhere; }
    table.rate th { font-weight: 700; padding: 1mm 1px; }
    table.rate td.mon { font-weight: 700; white-space: nowrap; }
    table.rate td.genuine { font-weight: 700; }
    table.rate tr.total td { font-weight: 700; border-top: 2px solid #000; }
    table.rate tr.empty td { color: #555; padding: 5mm; }
    table.rate .sub, table.rate .avg { display: block; font-size: 9pt; font-weight: 400; color: #333; }
    /* ความกว้างรวม 257 มม. (= พื้นที่พิมพ์แนวนอน) */
    col.c-mon { width: 22mm; }
    col.c-closed { width: 44mm; }
    col.c-n { width: 28mm; }
    col.c-gen { width: 31mm; }
    col.c-gp { width: 24mm; }
    .notes { margin: 3mm 0 0; padding-left: 5mm; font-size: 11pt; line-height: 1.2; }
    .notes li { margin: 0; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 3mm; text-align: center; }
    @media print {
      html, body { height: auto; }
      .sheet { width: auto; }
    }
  </style>
</head>
<body>
<section class="sheet">
<table class="page">
  <thead><tr><td class="space-top"></td></tr></thead>
  <tfoot><tr><td class="space-bottom"></td></tr></tfoot>
  <tbody><tr><td>
  ${orgName ? `<p class="org">${esc(orgName)}</p>` : ''}
  <h1>รายงานอัตราการตอบแบบประเมินความพึงพอใจ เรื่องร้องเรียน/ร้องทุกข์ รายเดือน</h1>
  <p class="asof">${asOfText ? `ข้อมูล ณ วันที่ ${esc(asOfText)} น.` : ''}</p>
  <table class="rate">
    <colgroup><col class="c-mon"><col class="c-closed"><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-gp"><col class="c-gen"><col class="c-gp"></colgroup>
    <thead>
      <tr>
        <th>เดือนที่ปิดเรื่อง</th>
        <th>ปิดแล้ว (เรื่อง)<span class="sub">ผู้ยื่นแยกตามกลุ่ม</span></th>
        <th>ผู้ยื่นเอง<br>เรื่อง (ร้อยละ)</th>
        <th>ผ่านลิงก์<br>เรื่อง (ร้อยละ)</th>
        <th>สท. บันทึกแทน<br>เรื่อง (ร้อยละ)</th>
        <th>เลขอ้างอิง<br>เรื่อง (ร้อยละ)</th>
        <th>มีคะแนน ≥ 1 ช่อง<br>เรื่อง (ร้อยละ)</th>
        <th>เสียงผู้รับบริการตัวจริง<br>เรื่อง (ร้อยละ)</th>
        <th>ประเมินภาพรวม<br>(ไม่ผูกคำร้อง) ครั้ง</th>
      </tr>
    </thead>
    <tbody>
${body}
    </tbody>
  </table>
  <ul class="notes">${notes}</ul>
  <div class="eservice-origin">${esc(govEServiceOriginText(orgName))}${asOfText ? ` · ข้อมูล ณ วันที่ ${esc(asOfText)} น.` : ''}</div>
  </td></tr></tbody>
</table>
</section>
</body>
</html>`
}

/**
 * เปิดหน้าต่างพิมพ์ (เรียกจากการกดปุ่มโดยตรง — กัน pop-up blocker) ถูกบล็อก → คืน false ผู้เรียกแสดงข้อความ
 * addMobileCloseButton: มือถือเปิดแท็บใหม่แล้วไม่มีปุ่มปิด · รอฟอนต์ก่อนสั่งพิมพ์
 */
export function openRatingResponseRatePrintWindow(html) {
  const win = window.open('', '_blank', 'width=1120,height=760')
  if (!win) return false
  win.document.open()
  win.document.write(addMobileCloseButton(html))
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) await Promise.race([win.document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))])
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    if (win.closed) return
    win.focus()
    win.print()
  }, 200)
  return true
}
