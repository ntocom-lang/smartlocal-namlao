// ใบ "ใบแจ้งชำระค่าธรรมเนียม" — A4 แนวตั้ง 1 ใบ/ยอด (เลือกหลายยอดแล้วพิมพ์ = 1 ยอด/หน้า) จากเมนู "รับชำระเงิน"
//
// ไม่ใช่หนังสือราชการและไม่ใช่ใบเสร็จรับเงิน จึงไม่มีช่องลงนาม (เจ้าของระบบสั่ง 2569-11-18)
// ใบเสร็จรับเงินออกโดย อปท. (หน่วยงานคลัง/e-LAAS) เท่านั้น — ระบบนี้ไม่ออกใบเสร็จ
// ไม่ใส่เบอร์โทรผู้ประกอบการ (PDPA เท่าที่จำเป็น) · Ref1 เป็นเลขสุ่ม ไม่ใช่เลขบัตร/เลขใบอนุญาต
//
// QR: Bill Payment ก่อน ไม่มีก็พร้อมเพย์ · e-LAAS ออกใบแจ้งหนี้อยู่แล้ว = ไม่สร้าง QR (กันกองคลังทำสองระบบ)
// ⚠️ ชื่อ อปท./ชื่อบัญชีผู้รับ/ชื่อร้าน/ที่อยู่ มาจากฐานข้อมูลที่แก้ได้ ทุกค่าที่ลง HTML ต้องผ่าน esc() (กัน XSS ในหน้าต่างพิมพ์)
// ⚠️ ค่าปรับร้อยละ 20 เป็นยอดที่ระบบ "เสนอ" เจ้าหน้าที่ยืนยันที่เคาน์เตอร์ (สูตรจาก licenceRegistry.js)

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss, govPagePadding,
} from './govDocStyle.js'
import { SURCHARGE_RATE } from './licenceRegistry.js'
import { QUIET_MODULES, qrLayout } from './qrSvg.js'
import { thaiDateFromDateInput } from './thaiDate.js'
import { amountDue, buildDueQr, formatRef1, isElaasInvoice, usableChannels } from './paymentDues.js'

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const safeLogo = url => (/^https:\/\/[^\s"'<>]+$/i.test(String(url ?? '')) ? String(url) : '')

function pageCss() {
  // แนวตั้งเจาะรูด้านซ้าย: ขอบกระดาษย้ายมาเป็น padding ของ .sheet (hideBrowserHeader) กันเบราว์เซอร์วาดหัว/ท้ายกระดาษทับ
  return `
  ${govPageCss({ size: 'A4 portrait', hideBrowserHeader: true })}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #000; ${govDocFontCss()} }
  .sheet { width: 210mm; min-height: 297mm; padding: ${govPagePadding({ size: 'A4 portrait' })}; }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  @media print { .sheet { width: auto; min-height: 295mm; } }
  p { margin: 0; }
  .head { display: flex; align-items: center; justify-content: center; gap: 4mm; }
  .head img { height: 17mm; width: auto; max-width: 17mm; object-fit: contain; }
  .org { font-size: 1.15em; font-weight: 700; text-align: center; }
  .title { font-size: 1.4em; font-weight: 700; text-align: center; margin-top: 2mm; }
  .date { text-align: right; margin-top: 3mm; }
  .to { margin-top: 3mm; }
  table.info { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  table.info td { padding: 0.6mm 0; vertical-align: top; }
  table.info td.k { width: 38mm; font-weight: 700; white-space: nowrap; }
  .amount { margin-top: 4mm; border: 1.2px solid #000; padding: 2mm 4mm; }
  .amount .row { display: flex; justify-content: space-between; gap: 4mm; }
  .amount .row.total { font-weight: 700; font-size: 1.25em; border-top: 1px solid #000; margin-top: 1mm; padding-top: 1mm; }
  .amount .hint { font-size: 0.85em; color: #333; margin-top: 1mm; }
  .ref { margin-top: 4mm; text-align: center; }
  .ref .label { font-weight: 700; }
  .ref .num { font-size: 26pt; font-weight: 700; letter-spacing: 2px; line-height: 1.2; }
  .ref .note { font-size: 0.85em; color: #333; }
  .pay { margin-top: 4mm; display: flex; align-items: center; gap: 5mm; break-inside: avoid; page-break-inside: avoid; }
  .pay svg { flex: none; width: 44mm; height: 44mm; }
  .pay .t { font-weight: 700; }
  .pay .payee { margin-top: 1mm; }
  .pay .warn { margin-top: 1mm; font-size: 0.9em; }
  .counter { margin-top: 4mm; }
  .counter .t { font-weight: 700; }
  .notice { margin-top: 4mm; border-top: 1px solid #000; padding-top: 2mm; }
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 4mm; }`
}

function qrSvg(payload, label) {
  const qr = qrLayout(payload, 1000) // ด้านจริงกำหนดด้วย CSS (44mm) ตรงนี้ใช้แค่เมทริกซ์
  if (!qr) return ''
  const box = qr.size + QUIET_MODULES * 2
  return `<svg viewBox="0 0 ${box} ${box}" role="img" aria-label="${esc(label)}"><rect width="${box}" height="${box}" fill="#fff"/><path transform="translate(${QUIET_MODULES} ${QUIET_MODULES})" d="${qr.d}" fill="#000"/></svg>`
}

function addressOf(due) {
  const address = String(due.address ?? '').trim()
  const village = String(due.village ?? '').trim()
  if (address && village && !address.includes(village)) return `${address} ${village}`
  return address || village
}

function roundText(due) {
  if (due.kind === 'renewal') return `ต่ออายุใบอนุญาต (รอบใหม่เริ่มวันที่ ${thaiDateFromDateInput(due.period_from) || '—'})`
  return `ค่าธรรมเนียมรายปี (ครบกำหนดวันที่ ${thaiDateFromDateInput(due.due_on) || '—'})`
}

function paySection({ settings, due, qr }) {
  if (isElaasInvoice(settings, due.source)) {
    return `<div class="pay"><div><p class="t">ใบแจ้งหนี้ออกจาก e-LAAS</p><p>ชำระตามใบแจ้งหนี้ที่ อปท. ออกให้ โดยอ้างเลข Ref1 ด้านบน</p></div></div>`
  }
  if (!qr) return ''
  const how = qr.channel === 'bill_payment'
    ? 'สแกน QR เพื่อชำระผ่านแอปธนาคาร (Bill Payment) — ยอดเงินและเลข Ref1 อยู่ใน QR แล้ว'
    : 'สแกน QR เพื่อชำระผ่านแอปธนาคาร (พร้อมเพย์) — ยอดเงินอยู่ใน QR แล้ว'
  const bank = String(settings.bank_name ?? '').trim()
  return `<div class="pay">
    ${qrSvg(qr.payload, 'QR code สำหรับชำระเงิน')}
    <div>
      <p class="t">${esc(how)}</p>
      <p class="payee">ชื่อบัญชีผู้รับ: <b>${esc(settings.payee_name ?? '—')}</b>${bank ? ` (${esc(bank)})` : ''}</p>
      <p class="warn">ก่อนกดจ่าย ให้ตรวจว่าชื่อผู้รับที่แอปธนาคารแสดงตรงกับชื่อบัญชีด้านบน</p>
    </div>
  </div>`
}

function sheetHtml({ tenant, settings, due, today }) {
  const orgName = tenant?.name ?? ''
  const logo = safeLogo(tenant?.logo_url)
  const { amount, surcharge, total } = amountDue(due, today)
  const qr = buildDueQr(settings, due, today)
  const usable = usableChannels(settings, due.source)
  // ไม่มีช่องไหนให้ชำระ (ยังไม่ได้ตั้งค่า/ช่องไม่ครอบคลุม) = ยังชำระที่ อปท. ได้ตามปกติ ใบต้องไม่ออกมาโดยไม่บอกทางชำระ
  const showCounter = usable.includes('counter') || (!qr && !isElaasInvoice(settings, due.source))
  const rate = Math.round(SURCHARGE_RATE * 100)
  const surchargeRows = surcharge > 0
    ? `<div class="row"><span>ค่าธรรมเนียม</span><span>${money(amount)} บาท</span></div>
       <div class="row"><span>ค่าปรับ (ชำระหลังวันครบกำหนด)</span><span>${money(surcharge)} บาท</span></div>`
    : ''
  return `<div class="sheet">
  <div class="head">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<p class="org">${esc(orgName)}</p></div>
  <p class="title">ใบแจ้งชำระค่าธรรมเนียม</p>
  <p class="date">วันที่ ${esc(thaiDateFromDateInput(today))}</p>
  <p class="to">เรียน ${esc(due.holder_name || 'ผู้ประกอบการ')}</p>
  <table class="info"><tbody>
    <tr><td class="k">สถานประกอบการ</td><td>${esc(due.business_name || '—')}</td></tr>
    ${addressOf(due) ? `<tr><td class="k">ที่อยู่</td><td>${esc(addressOf(due))}</td></tr>` : ''}
    <tr><td class="k">ใบที่</td><td>${esc(due.licence_no || '—')} · ${esc(due.type_name || '—')}</td></tr>
    <tr><td class="k">รอบที่ชำระ</td><td>${esc(roundText(due))}</td></tr>
    <tr><td class="k">ชำระภายใน</td><td>${esc(thaiDateFromDateInput(due.due_on) || '—')}</td></tr>
  </tbody></table>
  <div class="amount">
    ${surchargeRows}
    <div class="row total"><span>ยอดที่ต้องชำระ</span><span>${money(total)} บาท</span></div>
    ${surcharge > 0 ? `<p class="hint">ค่าปรับร้อยละ ${rate} เป็นยอดที่ระบบเสนอ เจ้าหน้าที่ยืนยันยอดจริงที่เคาน์เตอร์</p>` : ''}
  </div>
  <div class="ref">
    <p class="label">เลขอ้างอิง (Ref1)</p>
    <p class="num">${esc(formatRef1(due.ref1))}</p>
    <p class="note">แจ้งเลขนี้ทุกครั้งที่ชำระ หรือสอบถามเรื่องการชำระ</p>
  </div>
  ${paySection({ settings, due, qr })}
  ${showCounter ? `<div class="counter"><p class="t">ชำระที่เคาน์เตอร์</p><p>ชำระได้ที่ ${esc(orgName)} ในวันและเวลาราชการ</p></div>` : ''}
  <p class="notice">ใบนี้ไม่ใช่ใบเสร็จรับเงิน ใบเสร็จรับเงินออกโดย ${esc(orgName)}</p>
  <p class="origin">${esc(govEServiceOriginText(tenant))}</p>
</div>`
}

/**
 * @param {object} args
 * @param {{ name?: string, logo_url?: string }} args.tenant
 * @param {object} args.settings  payment_settings ของ อปท. (null = ยังไม่ตั้งค่า → ไม่มี QR มีแต่ทางชำระที่ อปท.)
 * @param {object[]} args.dues    แถวจาก payment_list_dues (ยอดที่รอชำระ) · 1 ยอด = 1 หน้า
 * @param {string} args.today     วันนี้ ISO (เวลาไทย) — ใช้คิดค่าปรับที่เสนอและวันที่ของใบ
 */
export function buildPaymentNoticeHtml({ tenant, settings, dues, today }) {
  const list = Array.isArray(dues) ? dues : []
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(`ใบแจ้งชำระค่าธรรมเนียม ${tenant?.name ?? ''}`.trim())}</title>
${GOV_FONT_LINK}
<style>${pageCss()}
</style>
</head><body>
${list.map(due => sheetHtml({ tenant, settings, due, today })).join('\n')}
</body></html>`
}
