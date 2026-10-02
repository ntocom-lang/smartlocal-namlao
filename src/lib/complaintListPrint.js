import { GOV_FONT_LINK, govDocFontIdentityCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'
import { printableCategoryLabel } from './complaintCategoryLabels.js'

// ⚠️ ชื่อผู้แจ้งกับรายละเอียดเป็นข้อความที่ประชาชนพิมพ์เอง และหน้าต่างพิมพ์เปิดด้วย window.open('')
// ซึ่งอยู่โดเมนเดียวกับระบบ — ค่าที่ต่อดิบเข้า template ถูกเบราว์เซอร์อ่านเป็นแท็กแล้วทำงานในนาม
// เจ้าหน้าที่ที่กดพิมพ์ได้ ทุกค่าจึงต้องผ่าน esc() ก่อนเสมอ (tests/complaint-list-print.test.mjs)
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

/**
 * ใบ "รายการคำร้อง" จากปุ่มพิมพ์ในหน้าจัดการคำร้อง — A4 แนวนอน
 * categoryLabels / statusLabels เป็น map รหัส → ชื่อที่แสดง (หมวดที่ อปท. สร้างเองถูก merge มาแล้ว)
 */
export function buildComplaintListHtml({
  tenant, filterLabel, complaints, categoryLabels = {}, statusLabels = {}, printedAt = new Date(),
}) {
  const thDate = printedAt.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  const rows = complaints.map((c, i) => {
    const d = new Date(c.created_at)
    const num = c.ref_no ?? '—'
    const dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
    // ใบรายการก็พิมพ์ชื่อหมวดเหมือนกัน — รหัสดิบ (water_repair) ต้องไม่หลุดลงกระดาษ (ดู complaintCategoryLabels.js)
    const cat = c.category ? printableCategoryLabel(c.category, categoryLabels[c.category] ?? c.category) : '—'
    const reporter = c.reporter_name || c.profiles?.full_name || '—'
    const status = statusLabels[c.status] ?? c.status
    // ตัดก่อนแล้วค่อย escape — ถ้า escape ก่อน การตัดที่ 60 ตัวอักษรอาจผ่ากลาง &amp; จนเหลือ &am
    const detail = (c.detail ?? '').substring(0, 60) + ((c.detail ?? '').length > 60 ? '...' : '')
    return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="text-align:center">${esc(num)}</td>
        <td>${esc(dateStr)}</td>
        <td>${esc(cat)}</td>
        <td>${esc(reporter)}</td>
        <td>${esc(detail)}</td>
        <td style="text-align:center">${esc(status)}</td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<title>รายการคำร้อง</title>
${GOV_FONT_LINK}
<style>
  ${govPageCss({ size: 'A4 landscape' })}
  /* ตารางคุมขนาดตัวอักษรเองรายคอลัมน์ (12-16px) เพื่อให้คอลัมน์ครบใน A4 แนวนอน
     จึงใช้เฉพาะตัวตนของฟอนต์จากมาตรฐานกลาง ไม่บังคับ 16pt ทั้งใบ */
  body { ${govDocFontIdentityCss()} font-size: 14px; color: #111; }
  h2 { text-align:center; font-size:16px; margin:0 0 4px; }
  p.sub { text-align:center; font-size:13px; color:#555; margin:0 0 16px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { background:#1d4ed8; color:#fff; padding:6px 8px; text-align:center; }
  td { padding:5px 8px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
  tr:nth-child(even) td { background:#f8fafc; }
  .footer { margin-top:12px; font-size:12px; color:#555; text-align:right; }
  @media print { button { display:none; } }
</style></head><body>
<h2>${esc(tenant?.name ?? '')} — รายการคำร้อง</h2>
<p class="sub">ตัวกรอง: ${esc(filterLabel)} &nbsp;|&nbsp; ทั้งหมด ${complaints.length} รายการ &nbsp;|&nbsp; พิมพ์วันที่ ${esc(thDate)}</p>
<table>
  <thead><tr>
    <th style="width:40px">ที่</th>
    <th style="width:80px">เลขที่</th>
    <th style="width:80px">วันที่</th>
    <th style="width:130px">ประเภท</th>
    <th style="width:110px">ผู้แจ้ง</th>
    <th>รายละเอียด</th>
    <th style="width:90px">สถานะ</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">${esc(govEServiceOriginText(tenant))}</div>
</body></html>`
}
