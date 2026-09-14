// ใบประชาสัมพันธ์ "ตารางวันเก็บขยะ" สำหรับติดบอร์ดหมู่บ้าน/หอกระจายข่าว — A4 แนวตั้ง
//
// ⚠️ พิมพ์เป็น "กฎ" (ทุกวันพฤหัสบดี) ไม่พิมพ์วันที่ — ใบที่ติดไว้จึงไม่หมดอายุเมื่อเดือนเปลี่ยน
// เจ้าหน้าที่ไม่ต้องพิมพ์ใหม่ทุกเดือน ส่วนการงด/เลื่อนรายครั้งให้ QR พาไปดูหน้า /waste ที่อัปเดตเอง
// ต้องพิมพ์ใหม่เฉพาะวันที่เปลี่ยนกฎจริงเท่านั้น
//
// ⚠️ เป็นใบประชาสัมพันธ์ ไม่ใช่ "ประกาศ อปท." ตามระเบียบงานสารบรรณ — จึงไม่มีเลขที่ประกาศและ
// ช่องลงนาม และหัวเรื่องจงใจไม่ใช้คำว่า "ประกาศ" ถ้า อปท. ต้องการออกเป็นประกาศทางการ
// ต้องทำตามรูปแบบประกาศในระเบียบงานสารบรรณ (ต้องยืนยันกับฉบับปัจจุบัน) ไม่ใช่ใช้ใบนี้แทน
//
// ฟังก์ชันนี้ไม่สร้าง QR เอง รับ data URL เข้ามา — ไฟล์นี้จึงเป็นสตริงล้วน รันเทสต์ใน Node ได้
import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontIdentityCss, govEServiceOriginText, govPageCss,
} from './govDocStyle.js'
import {
  HOLIDAY_POLICIES, WASTE_TYPES, describeRule, mooListText, thaiLongDate, timeText,
} from './wasteSchedule.js'

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// ของที่ประชาชนถามบ่อยว่า "อันนี้ขยะอันตรายไหม" — คำแนะนำการแยกทั่วไป ไม่ได้อ้างระเบียบ
export const HAZARDOUS_EXAMPLES = [
  'หลอดไฟทุกชนิด', 'ถ่านไฟฉาย แบตเตอรี่', 'กระป๋องสเปรย์', 'ภาชนะใส่สารเคมี ยาฆ่าแมลง',
  'ยาหมดอายุ', 'เครื่องใช้ไฟฟ้าชำรุดขนาดเล็ก',
]

export const HAZARDOUS_HANDLING = [
  'แยกใส่ถุงหรือกล่องต่างหาก ห้ามปนกับขยะทั่วไป',
  'ห้ามทุบหรือแกะหลอดไฟ ถ่าน และแบตเตอรี่',
  'เก็บให้พ้นมือเด็ก แล้วนำออกมาเฉพาะวันที่รถขยะอันตรายมาเก็บ',
]

// ไม่พิมพ์ชื่อบ้านโดยตั้งใจ — ชื่อบ้านทำให้ช่องหมู่ตกหลายบรรทัดจน 9 รอบล้นเป็น 2 แผ่น
// (วัดจริง: แถวละ ~29 มม.) ชาวบ้านรู้เลขหมู่ของตัวเองอยู่แล้ว ชื่อบ้านมีให้ดูในหน้า /waste
function scheduleRows(schedules, showPolicyPerRow) {
  return schedules.map((s) => {
    const subs = [
      showPolicyPerRow ? HOLIDAY_POLICIES[s.holiday_policy]?.short : '',
      s.note ?? '',
    ].filter(Boolean)
    return `
      <tr>
        <td class="rule">${esc(describeRule(s))}${subs.map(t => `<div class="sub">${esc(t)}</div>`).join('')}</td>
        <td class="moo">${esc(mooListText(s.moo_nos))}</td>
        <td class="time">${esc(timeText(s) || '—')}</td>
      </tr>`
  }).join('')
}

function section(type, schedules) {
  const rows = schedules.filter(s => s.waste_type === type)
  if (rows.length === 0) return ''
  const meta = WASTE_TYPES[type]
  // นโยบายวันหยุดเหมือนกันทุกรอบ (กรณีส่วนใหญ่) → พิมพ์บรรทัดเดียวใต้หัวข้อ ไม่ซ้ำทุกแถว
  const policies = [...new Set(rows.map(s => s.holiday_policy))]
  const shared = policies.length === 1 ? HOLIDAY_POLICIES[policies[0]]?.short : ''
  return `
    <section class="block">
      <h2 style="border-color:${meta.color}; color:${meta.color}">${esc(meta.label)}${shared ? `<span class="policy">${esc(shared)}</span>` : ''}</h2>
      <table>
        <thead>
          <tr><th class="rule">วันที่รถออกเก็บ</th><th class="moo">หมู่</th><th class="time">เวลา</th></tr>
        </thead>
        <tbody>${scheduleRows(rows, !shared)}</tbody>
      </table>
    </section>`
}

/**
 * @param {object} p
 * @param {{ name?: string }} p.tenant
 * @param {object[]} p.schedules  กฎที่เปิดใช้อยู่
 * @param {string}   p.pageUrl    ลิงก์เต็มของหน้า /waste
 * @param {string}   p.qrDataUrl  data:image/... ของ QR ที่ชี้ไป pageUrl (ว่างได้ = ไม่พิมพ์ QR)
 * @param {string}   p.today      'YYYY-MM-DD' — วันที่ข้อมูล ให้เจ้าหน้าที่รู้ว่าใบที่ติดอยู่เก่าแค่ไหน
 */
export function buildWasteSchedulePosterHtml({ tenant, schedules = [], pageUrl = '', qrDataUrl = '', today }) {
  const hasHazardous = schedules.some(s => s.waste_type === 'hazardous')
  const orgName = tenant?.name?.trim() || ''

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>ตารางวันเก็บขยะ ${esc(orgName)}</title>
${GOV_FONT_LINK}
<style>
  ${govPageCss({ size: 'A4 portrait' })}
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #111;
    /* ข้อยกเว้นขนาดตัวอักษร (กติกา govDocStyle): ใบนี้ติดบอร์ดให้ผู้สูงอายุอ่านจากระยะยืน
       14pt ทั้งใบอ่านไม่ออกจากระยะนั้น จึงคุมขนาดเองรายส่วน แต่ฟอนต์และขอบกระดาษใช้มาตรฐานเดิม */
    ${govDocFontIdentityCss()}
    font-size: 16pt; line-height: 1.25;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  header { text-align: center; margin-bottom: 2mm; }
  header h1 { font-size: 30pt; line-height: 1.05; margin: 0; font-weight: 700; }
  header p { font-size: 16pt; margin: 0; }
  .block { margin-top: 3mm; break-inside: avoid; }
  .block h2 { font-size: 20pt; line-height: 1.1; margin: 0 0 1.5mm; padding-left: 3mm; border-left: 3mm solid; }
  .block h2 .policy { font-size: 13pt; font-weight: 400; color: #333; margin-left: 3mm; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 0.3mm solid #444; padding: 0.6mm 2mm; vertical-align: top; text-align: left; line-height: 1.15; }
  th { font-size: 13pt; background: #f1f1f1; }
  th.rule { width: 50%; } th.moo { width: 28%; } th.time { width: 22%; }
  td.rule { font-size: 17pt; font-weight: 700; }
  td.moo, td.time { font-size: 15pt; }
  .sub { font-size: 12pt; font-weight: 400; color: #444; }
  .tips { display: flex; gap: 4mm; margin-top: 3mm; break-inside: avoid; }
  .tips .box { flex: 1; border: 0.3mm solid #b45309; border-radius: 2mm; padding: 1mm 3mm; }
  .tips h3 { font-size: 14pt; margin: 0; color: #b45309; }
  .tips ul { margin: 0; padding-left: 5mm; font-size: 12pt; line-height: 1.15; }
  .qr { display: flex; align-items: center; gap: 4mm; margin-top: 3mm; padding: 2mm 3mm; border: 0.5mm dashed #444; border-radius: 2mm; break-inside: avoid; }
  .qr img { width: 30mm; height: 30mm; }
  .qr strong { display: block; font-size: 18pt; line-height: 1.1; }
  .qr span { display: block; font-size: 13pt; }
  .qr .url { font-size: 11pt; color: #333; word-break: break-all; }
  footer { margin-top: 4mm; display: flex; justify-content: space-between; ${GOV_ESERVICE_ORIGIN_CSS} }
  .empty { margin-top: 10mm; text-align: center; font-size: 18pt; }
</style>
</head>
<body>
  <header>
    <h1>ตารางวันเก็บขยะ</h1>
    ${orgName ? `<p>${esc(orgName)}</p>` : ''}
  </header>

  ${schedules.length === 0
    ? '<p class="empty">ยังไม่ได้ตั้งรอบเก็บขยะในระบบ</p>'
    : `${section('general', schedules)}${section('hazardous', schedules)}`}

  ${hasHazardous ? `
  <div class="tips">
    <div class="box">
      <h3>อะไรคือขยะอันตราย</h3>
      <ul>${HAZARDOUS_EXAMPLES.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
    <div class="box">
      <h3>เตรียมก่อนวันเก็บ</h3>
      <ul>${HAZARDOUS_HANDLING.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
  </div>` : ''}

  ${pageUrl ? `
  <div class="qr">
    ${qrDataUrl ? `<img src="${esc(qrDataUrl)}" alt="QR Code ตารางวันเก็บขยะ">` : ''}
    <div>
      <strong>สแกนดูวันเก็บครั้งถัดไปของหมู่บ้านท่าน</strong>
      <span>ถ้ามีงดเก็บหรือเลื่อนวัน จะแจ้งไว้ในหน้านี้ทันที</span>
      <span class="url">${esc(pageUrl)}</span>
    </div>
  </div>` : ''}

  <footer>
    <span>${esc(govEServiceOriginText(tenant))}</span>
    ${today ? `<span>ข้อมูล ณ ${esc(thaiLongDate(today))}</span>` : ''}
  </footer>
</body>
</html>`
}
