// ใบพิมพ์ของวงจรโครงการก่อสร้าง 5 ใบ (P8–P12) — A4 แนวตั้ง 14pt จบ 1 แผ่น ทุกใบ "ร่างจากข้อมูลในระบบ" ไม่ใช่แบบที่ระเบียบกำหนด
//
//   P8  buildInstallmentCertificateHtml  ใบรับรองผลการปฏิบัติงาน (ปุ่มที่แถวงวด — มอบให้ผู้รับจ้าง จึงไม่พิมพ์คำว่า "ร่าง" ลงกระดาษ)
//   P9  buildChangeRequestMemoHtml       บันทึกเสนอขยายเวลา / งดค่าปรับ / ลดค่าปรับ (บันทึกข้อความ ภายใน)
//   P10 buildContractAmendMemoHtml       บันทึกเสนอแก้ไขสัญญา (บันทึกข้อความ ภายใน)
//   P11 buildWarrantyInspectionReportHtml รายงานผลตรวจความชำรุดบกพร่องก่อนครบประกัน (บันทึกข้อความ ภายใน)
//   P12 buildDefectNoticeLetterHtml      หนังสือแจ้งให้ผู้รับจ้างแก้ไขความชำรุดบกพร่อง (หนังสือภายนอก)
//
// ⚠️ หลักของไฟล์นี้: "ระบบไม่ตัดสินแทนคน" — ช่องผลตรวจ วันที่ตรวจ ผลพิจารณา ผลการเปรียบเทียบ ขอบเขตการอนุมัติ
//    พิมพ์เป็นช่องติ๊ก (ว่าง) + เส้นประให้กรอกมือเสมอ แม้ในฐานข้อมูลจะบันทึกผลไว้แล้ว (inspection_result / decision / result ฯลฯ ไม่ถูกอ่านมาพิมพ์)
//    ใบเหล่านี้เวียนเซ็นด้วยปากกา ไม่มีการลงลายมือชื่ออิเล็กทรอนิกส์
// ⚠️ ถ้อยคำอ้างข้อกฎหมายคัดตามที่เจ้าของระบบอนุมัติแล้ว (ที่มา: ระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ
//    พ.ศ. 2560 · หนังสือ กค (กวจ) 0405.2/ว 117 · 0405.4/ว 681) ห้ามแต่งข้ออ้างเพิ่ม · "ต้องตรวจกับฉบับปัจจุบันก่อนใช้" อยู่ในใบตามที่กำหนด
// ช่องลงนามใช้ govSignBlock.js / govStaffSignBlock.js เท่านั้น · ฟอนต์/ขอบกระดาษมาจาก govDocStyle.js
// ช่องติ๊ก วาดด้วย border (ไม่ใช้อักขระ ☐ เพราะ THSarabunPSK ไม่มี glyph นี้ — เหตุเดียวกับ patientTransportPrint.js)
// ทุกค่าที่มาจากฐานข้อมูลผ่าน esc() ก่อนลง HTML (เขียนผ่าน document.write)

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss,
} from './govDocStyle.js'
import { govNameBlank, govSignBlockCss, govSignRow, govSplitActingTitle } from './govSignBlock.js'
import { govStaffSignBlockCss, govStaffSignBlockHtml } from './govStaffSignBlock.js'
import { orgClerkTitle, orgHeadTitle } from './orgTerms.js'
import { thaiDateFromDateInput } from './thaiDate.js'
import { daysBetween } from './constructionReport.js'
import { CHANGE_KINDS, GUARANTEE_TYPES, RULES } from './constructionLifecycle.js'
import { addMobileCloseButton } from './printWindowClose.js'
import {
  SIGNATORY_REGISTRY_SELECT, SIGNATORY_SCOPE, pickSignatory, signatoryMoment, signatoryName, signatoryTitle,
} from './documentSignatories.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

const text = value => String(value ?? '').trim()
const has = value => text(value) !== ''
const dateText = iso => thaiDateFromDateInput(iso)
const blank = (width = '30mm') => `<span class="blank" style="min-width:${width}">&nbsp;</span>`
const orBlank = (value, width) => (has(value) ? esc(text(value)) : blank(width))
const dateOrBlank = (iso, width = '34mm') => (dateText(iso) ? esc(dateText(iso)) : blank(width))
const isNum = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
const money = value => (isNum(value)
  ? Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
const moneyOrBlank = (value, width = '30mm') => (isNum(value) ? esc(money(value)) : blank(width))
// สาเหตุ/รายละเอียดที่พิมพ์กลางประโยค — ตัดขึ้นบรรทัดใหม่ของผู้กรอกให้เป็นช่องว่าง ไม่ให้ดันเลย์เอาต์
const oneLine = value => esc(text(value).replace(/\s*\n\s*/g, ' '))
const box = () => '<span class="box"></span>'
const dots = count => '.'.repeat(count)

/** ค่าเริ่มต้นเมื่อโหลดผู้ลงนามไม่ได้/ยังไม่ได้ตั้ง — ใบต้องพิมพ์ได้เสมอ (ได้เส้นประ + ชื่อตำแหน่งสำรอง) */
export const EMPTY_SIGNATORIES = Object.freeze({ department_head: null, clerk: null, mayor: null })

// ── ฟังก์ชันล้วน ─────────────────────────────────────────────────────────────

/**
 * เทียบวันที่เหตุสิ้นสุดกับวันที่หน่วยงานได้รับหนังสือขอ (ข้อ 182: แจ้งภายใน 15 วัน)
 * นับวันปฏิทิน นับถัดจากวันที่เหตุสิ้นสุด · within = receivedOn ≤ causeEndedOn + 15 · ขาดวันใดวันหนึ่ง (หรือรูปแบบไม่ใช่วันที่) = null
 * ข้อเท็จจริงจากตัวเลขเท่านั้น ระบบไม่วินิจฉัยว่าเข้าเหตุหรือไม่ (คนตัดสิน)
 */
export function changeNoticeTiming({ causeEndedOn, receivedOn } = {}) {
  const days = daysBetween(causeEndedOn, receivedOn)
  if (days === null) return null
  return { days, within: days <= RULES.changeRequestDays }
}

/** ตรวจความชำรุดบกพร่องก่อนครบประกันภายในกี่วัน — ว 117 ข้อ 3: ระยะประกัน ≥ 6 เดือน = 30 วัน · < 6 เดือน = 15 วัน · ไม่ทราบระยะ = null */
export function warrantyLeadDays(months) {
  if (months === null || months === undefined || months === '' || !Number.isFinite(Number(months))) return null
  return Number(months) >= 6 ? RULES.warrantyLeadLong : RULES.warrantyLeadShort
}

/** หนังสือแจ้งผู้ค้ำประกัน: หนังสือค้ำประกัน (ธนาคาร/อิเล็กทรอนิกส์) หรือยังไม่ระบุชนิด = พิมพ์บรรทัดสำเนาเรียน · ชนิดอื่น = ไม่พิมพ์ */
export function needsGuarantorCopy(guaranteeType) {
  return !has(guaranteeType) || guaranteeType === 'bank_guarantee' || guaranteeType === 'e_guarantee'
}

// ── ชิ้นส่วนร่วม ─────────────────────────────────────────────────────────────

function pageCss() {
  return `
  ${govPageCss()}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #000; ${govDocFontCss()} -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* จอ: กรอบกว้าง 160mm เท่าพื้นที่พิมพ์ · พิมพ์: ใช้ขอบกระดาษจริงจาก @page */
  .sheet { max-width: 160mm; margin: 8mm auto; }
  @media print { .sheet { max-width: none; margin: 0; } .screen-only { display: none !important; } }
  p { margin: 0; }
  .blank { display: inline-block; border-bottom: 1px dotted #000; }
  /* ป้ายเตือนบนจอ (ไม่ลงกระดาษ) — ใบนี้เห็นบนจอเท่านั้น ไม่กินที่และไม่ดันใบตกหน้า 2 */
  .screen-only { border: 1px solid #b45309; background: #fffbeb; padding: 1.5mm 3mm; margin-bottom: 4mm; font-size: 0.85em; }
  .head { display: flex; align-items: center; gap: 12mm; margin-bottom: 1mm; }
  .emblem { width: 15mm; height: 15mm; flex: none; }
  .emblem img { width: 100%; height: 100%; object-fit: contain; }
  .head h1 { margin: 0; font-size: 1.5em; font-weight: 700; flex: 1; text-align: center; padding-right: 27mm; }
  .field { margin: 0.3mm 0; }
  .field-row { display: flex; gap: 6mm; }
  .field-row .left { flex: 1 1 0; } .field-row .right { flex: 1 1 0; }
  /* hanging indent ของ "เรื่อง/เรียน" — บรรทัดต่อไปเยื้องมาตรงกับตัวแรกของเนื้อหา */
  .kv { padding-left: 4.2em; text-indent: -4.2em; }
  .rule { border: 0; border-top: 1px solid #000; margin: 0.8mm 0 1.2mm; }
  .doc-title { text-align: center; font-weight: 700; font-size: 1.3em; margin: 0 0 1.5mm; }
  .written { margin-left: auto; width: 80mm; margin-bottom: 1.5mm; }
  .para { text-indent: 10mm; margin-top: 0.8mm; }
  .sec { font-weight: 700; margin-top: 1mm; break-after: avoid; page-break-after: avoid; }
  .lead { font-weight: 700; }
  .opt { padding-left: 14mm; text-indent: -5mm; margin-top: 0.3mm; }
  .opt-flow { padding-left: 10mm; margin-top: 0.3mm; }
  .box { display: inline-block; width: 3.4mm; height: 3.4mm; border: 1px solid #000; margin-right: 1mm; vertical-align: -0.3mm; }
  .fill-line { display: flex; align-items: flex-end; margin-top: 0.6mm; }
  .fill-line .fl { flex: 1 1 0; border-bottom: 1px dotted #000; height: 1.05em; margin-left: 1mm; }
  .detail p { text-indent: 10mm; margin-top: 0.3mm; overflow-wrap: anywhere; }
  /* กรรมการตรวจรับ: 3 คนต่อแถว (พื้นที่ 160mm หาร 3 ≈ 53mm · เส้น 40mm + "ลงชื่อ" ลงพอดี) กรรมการเกิน 3 คนขึ้นแถวใหม่ */
  .committee { display: grid; grid-template-columns: repeat(3, 1fr); row-gap: 1mm; margin-top: 2mm; }
  .committee .center-row { padding-top: 6mm; }
  /* ชิดซ้ายของคอลัมน์ (ไม่ใช่กลางคอลัมน์) — ชื่อกรรมการยาวล้นแกนสองข้างเท่ากัน คอลัมน์ที่ 3 จึงไม่ล้นขอบขวา 160mm (วัดแล้วกลางคอลัมน์ล้น 3px) */
  .committee .center-row .sign-row { justify-content: flex-start; }
  .sign-single { display: flex; justify-content: flex-end; padding-right: 40mm; margin-top: 1mm; }
  .sign-single .center-row { padding-top: 6mm; }
  .order-group, .close-group { break-inside: avoid; page-break-inside: avoid; }
  .page-two { break-before: page; page-break-before: always; }
  .page-no { text-align: center; margin-bottom: 2mm; }
  @media screen { .page-two { margin-top: 10mm; border-top: 1px dashed #999; padding-top: 4mm; } }
  .footnote { font-size: 11pt; margin-top: 2mm; color: #333; }
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 2mm; }
  /* หนังสือภายนอก (P12) — ครุฑกลางบน ที่/ที่อยู่ ชื่อตามรูปแบบเดียวกับหนังสือนำส่งรถรับ-ส่งผู้ป่วย */
  .emblem-center { height: 24mm; margin-bottom: 1mm; }
  .emblem-center img { height: 100%; display: block; margin: 0 auto; }
  .letter-head { display: flex; align-items: flex-start; gap: 6mm; }
  .letter-head .sender { flex: 1 1 auto; text-align: right; }
  .letter-date { text-align: center; margin: 1.5mm 0; }
  .letter-sign { padding-left: 40%; margin-top: 1mm; }
  .letter-sign .center-row { padding-top: 10mm; }
  .regards { margin: 2mm 0 0; padding-left: 40%; text-align: center; }
  .copy-to { margin-top: 1.5mm; }
  .letter-foot { margin-top: 2mm; }
${govSignBlockCss()}
${govStaffSignBlockCss()}`
}

function documentHtml({ title, bodyHtml, tenant, printedAt, withOrigin = true }) {
  const origin = originTextOf(tenant, printedAt)
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
${GOV_FONT_LINK}
<style>${pageCss()}
</style>
</head><body>
<div class="sheet sheet--staff">
${bodyHtml}
${withOrigin ? `  <div class="origin">${esc(origin)}</div>` : ''}
</div>
</body></html>`
}

const emblemImg = emblemUrl => (emblemUrl
  ? `<img src="${esc(emblemUrl)}" alt="" onerror="this.style.display='none'">` : '')

const originTextOf = (tenant, printedAt) => {
  const iso = `${printedAt.getFullYear()}-${String(printedAt.getMonth() + 1).padStart(2, '0')}-${String(printedAt.getDate()).padStart(2, '0')}`
  return `พิมพ์เมื่อ ${thaiDateFromDateInput(iso)} · ${govEServiceOriginText(tenant)}`
}

const orgName = tenant => text(tenant?.name) || 'หน่วยงาน'

/** หัวบันทึกข้อความ (ครุฑ + ส่วนราชการ + ที่/วันที่ + เรื่อง + เรียน) — ที่/วันที่ เว้นให้กรอกมือ */
function memoHead({ tenant, departmentName, subject, emblemUrl }) {
  const department = [text(departmentName) || 'กองช่าง', text(tenant?.name)].filter(Boolean).join(' ')
  return `  <div class="head"><div class="emblem">${emblemImg(emblemUrl)}</div><h1>บันทึกข้อความ</h1></div>
  <p class="field"><b>ส่วนราชการ</b>&nbsp;&nbsp;${esc(department)}</p>
  <div class="field-row">
    <p class="field left"><b>ที่</b>&nbsp;&nbsp;${blank('38mm')}</p>
    <p class="field right"><b>วันที่</b>&nbsp;&nbsp;${blank('38mm')}</p>
  </div>
  <p class="field kv"><b>เรื่อง</b>&nbsp;&nbsp;${subject}</p>
  <p class="field kv"><b>เรียน</b>&nbsp;&nbsp;${esc(orgHeadTitle(tenant))}</p>
  <hr class="rule">`
}

/** "ตามสัญญาจ้างเลขที่ X ลงวันที่ Y <อปท.> ได้ตกลงจ้าง <ผู้รับจ้าง> ดำเนินโครงการ <title> วงเงิน Z บาท" */
function contractOpening({ tenant, project, contract }) {
  return `ตามสัญญาจ้างเลขที่ ${orBlank(project?.contract_no, '28mm')} ลงวันที่ ${dateOrBlank(contract?.contract_date)} ${esc(orgName(tenant))} ได้ตกลงจ้าง ${orBlank(project?.contractor_name, '50mm')} ดำเนินโครงการ ${orBlank(project?.title, '60mm')} วงเงินค่าจ้าง ${moneyOrBlank(project?.contract_amount)} บาท`
}

function committeeOf(people) {
  return (people ?? []).filter(p => p?.grp === 'committee').sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

/** ช่องลงนามกรรมการตรวจรับพัสดุทุกคน (ชื่อในวงเล็บ + หน้าที่ใต้เส้น) · ไม่มีรายชื่อ = 3 แถวเปล่า ประธานกรรมการ/กรรมการ/กรรมการ */
function committeeBlock(people) {
  const list = committeeOf(people)
  const rows = list.length ? list : [{ duty: 'ประธานกรรมการ' }, { duty: 'กรรมการ' }, { duty: 'กรรมการ' }]
  const cell = person => {
    const below = [has(person.name) ? `(${esc(text(person.name))})` : govNameBlank()]
    const role = text(person.duty) || text(person.position_title)
    if (role) below.push(esc(role))
    return `    <div class="center-row">${govSignRow({ below })}</div>`
  }
  return `  <div class="committee sign-block">
${rows.map(cell).join('\n')}
  </div>`
}

/** ช่องลงนามเดี่ยวชิดขวา (ผู้ตรวจสอบ/ผู้รับรอง) — below = บรรทัดใต้เส้น (escape มาแล้ว) */
function singleSign(below) {
  return `  <div class="sign-single sign-block"><div class="center-row">${govSignRow({ below })}</div></div>`
}

/** ความเห็น/คำสั่งของผู้มีอำนาจ — ช่องติ๊ก + เส้นประว่างให้กรอกมือ */
function commandBlock(orderHtml) {
  return `  <div class="sign-block" style="break-inside:avoid">
    <p class="fill-line"><span>ความเห็น/คำสั่ง</span><span class="fl"></span></p>
    <p class="field" style="margin-top:0.6mm">${orderHtml}</p>
  </div>`
}

const staffBlock = ({ signatories, tenant, departmentName }) => govStaffSignBlockHtml({
  signatories: signatories ?? EMPTY_SIGNATORIES, tenant, departmentName: text(departmentName),
})

function signerLines(person, fallbackTitle) {
  return [
    has(person?.name) ? `(${esc(text(person.name))})` : govNameBlank(),
    ...govSplitActingTitle(person?.title || fallbackTitle).map(esc),
  ]
}

const screenNote = html => `  <div class="screen-only">${html}</div>`
const footnote = textValue => `  <p class="footnote">${esc(textValue)}</p>`

// ── P8 ใบรับรองผลการปฏิบัติงาน ────────────────────────────────────────────────

export const INSTALLMENT_CERT_SCREEN_NOTE = 'ถ้าพิมพ์ใบตรวจรับจากระบบ e-GP แล้ว ไม่ต้องใช้ใบนี้ — ห้ามมีสองฉบับ · ร่างจากข้อมูลในระบบ ต้องตรวจกับระเบียบฉบับปัจจุบันก่อนใช้ · '
  + 'ตรวจรับแล้วคณะกรรมการรายงานหัวหน้าหน่วยงานภายใน 2 วันทำการ (หนังสือ กค (กวจ) 0405.4/ว 681 ลว. 8 ต.ค. 2568) · '
  + 'ที่มา ระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 ข้อ 176(5)–(7) และข้อ 181'

export function buildInstallmentCertificateHtml({
  tenant, project, contract = null, installment = {}, people = [], printedAt = new Date(),
} = {}) {
  const no = installment?.installment_no
  const total = Number(contract?.installments_total)
  const whole = Number.isFinite(total) && total > 0 && Number(no) === total
  const scope = whole ? '(ทั้งหมด)' : `(เฉพาะงวดที่ ${esc(no)})`
  const pct = isNum(installment?.work_pct) ? `ร้อยละ ${esc(Number(installment.work_pct))}` : `ร้อยละ ${blank('14mm')}`
  const body = `${screenNote(esc(INSTALLMENT_CERT_SCREEN_NOTE))}
  <p class="doc-title">ใบรับรองผลการปฏิบัติงาน</p>
  <p class="doc-title" style="font-size:1em;margin-top:-1mm">${scope}</p>
  <div class="written">
    <p>เขียนที่ ${esc(orgName(tenant))}</p>
    <p>วันที่ ${blank('50mm')}</p>
  </div>
  <p class="para">${contractOpening({ tenant, project, contract })} แบ่งการจ่ายเงินเป็น ${contract?.installments_total ? esc(contract.installments_total) : blank('12mm')} งวด</p>
  <p class="para">ผู้รับจ้างได้ส่งมอบงานงวดที่ ${esc(no)} (${pct} จำนวนเงิน ${moneyOrBlank(installment?.amount, '28mm')} บาท) ตามหนังสือส่งมอบงาน เลขรับ ${orBlank(installment?.delivery_ref_no, '28mm')} ลงวันที่ ${dateOrBlank(installment?.delivered_on)} กำหนดส่งมอบตามสัญญา ${dateOrBlank(installment?.due_on)}</p>
  <p class="para">คณะกรรมการตรวจรับพัสดุได้ตรวจผลงานกับแบบรูปรายการละเอียดและข้อกำหนดในสัญญาแล้ว เมื่อวันที่ ${blank('40mm')} ผลการตรวจ</p>
  <p class="opt">${box()}ถูกต้องครบถ้วนเป็นไปตามแบบรูปรายการละเอียดและข้อกำหนดในสัญญา ให้ถือว่าผู้รับจ้างส่งมอบงานครบถ้วนตั้งแต่วันที่ผู้รับจ้างส่งงานจ้างนั้น</p>
  <p class="opt">${box()}ไม่เป็นไปตามแบบรูปรายการละเอียดและข้อกำหนดในสัญญา เนื่องจาก ${blank('70mm')}</p>
  <p class="para">${box()}ผู้รับจ้างส่งมอบงานล่าช้ากว่ากำหนด หน่วยงานสงวนสิทธิ์การเรียกค่าปรับตามสัญญา</p>
  <p class="para">ใบรับรองนี้ทำขึ้นอย่างน้อย 2 ฉบับ มอบให้ผู้รับจ้าง 1 ฉบับ และเจ้าหน้าที่ 1 ฉบับ เพื่อทำการเบิกจ่ายเงิน และรายงานให้${esc(orgHeadTitle(tenant))}ทราบ</p>
${committeeBlock(people)}
  <p class="fill-line" style="margin-top:3mm"><span>ความเห็นแย้ง (ถ้ามี)</span><span class="fl"></span></p>
  <p class="fill-line"><span class="fl" style="margin-left:0"></span></p>`
  return documentHtml({
    title: `ใบรับรองผลการปฏิบัติงาน งวดที่ ${text(no)} ${text(project?.title)}`, bodyHtml: body, tenant, printedAt,
  })
}

// ── P9 บันทึกเสนอขยายเวลา / งดค่าปรับ / ลดค่าปรับ ───────────────────────────────

export const CHANGE_REQUEST_FOOTNOTE = 'ที่มา: พ.ร.บ.การจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 มาตรา 102 · ระเบียบกระทรวงการคลังฯ พ.ศ. 2560 ข้อ 182 · '
  + 'นับ 15 วันเป็นวันปฏิทินจากวันที่รับหนังสือที่บันทึกในระบบ · ระบบไม่วินิจฉัยว่าเข้าเหตุหรือไม่ · '
  + 'ถ้างานพัสดุหรือ e-GP ทำบันทึกนี้แล้ว ไม่ต้องใช้ใบนี้ · ร่างจากข้อมูลในระบบ ต้องตรวจกับระเบียบฉบับปัจจุบันก่อนใช้'

const LATE_NOTICE_SENTENCE = 'ทั้งนี้ หากมิได้แจ้งภายในเวลาที่กำหนด คู่สัญญาจะยกมากล่าวอ้างในภายหลังมิได้ '
  + 'เว้นแต่กรณีเหตุเกิดจากความผิดหรือความบกพร่องของหน่วยงานของรัฐซึ่งมีหลักฐานชัดแจ้ง หรือหน่วยงานของรัฐทราบดีอยู่แล้วตั้งแต่ต้น'

/** ประโยคข้อเท็จจริงเรื่องกำหนด 15 วัน — ขาดวัน/วันที่รับหนังสือก่อนวันที่เหตุสิ้นสุด = ให้ผู้ตรวจนับเอง (ไม่เดา) */
function timingSentence(change) {
  const timing = changeNoticeTiming({ causeEndedOn: change?.cause_ended_on, receivedOn: change?.request_received_on })
  if (!timing || timing.days < 0) {
    return `ยังไม่ได้บันทึกวันที่ครบถ้วนหรือวันที่ไม่สอดคล้องกัน ต้องตรวจนับเอง ${blank('50mm')}`
  }
  return `นับถัดจากวันที่เหตุสิ้นสุดถึงวันที่ได้รับหนังสือ รวม ${esc(timing.days)} วัน ซึ่ง${timing.within ? 'อยู่ภายใน' : 'เกิน'} ${RULES.changeRequestDays} วัน ตามที่ข้อ 182 กำหนด`
}

// P9/P10 ยาว 2 แผ่นเสมอ (เจ้าของระบบเลือก 2569-11-08): ช่องลงนามกลาง ผอ./ปลัด/นายก (~55mm, ที่ว่างเหนือเส้น 18mm ตาม #622/#644)
// + กรรมการ 3 คน ใส่แผ่นเดียวไม่พอ → บังคับขึ้นแผ่นที่ 2 ที่ "ความเห็น/คำสั่ง" พร้อมเลขหน้า "- ๒ -" แบบบันทึกข้อความหลายแผ่น
// ⚠️ ห้ามปล่อยให้เบราว์เซอร์ตัดหน้าเอง: บรรทัด flex ของ "ความเห็น/คำสั่ง" ถูกแบ่งข้ามหน้า สระ/วรรณยุกต์ "ั่" ตกค้างท้ายแผ่นแรก (เจอจริง)
// ผู้รับรองของ P10 (extraSignHtml) ขึ้นต้นแผ่น 2 ก่อนความเห็น/คำสั่ง — ไว้แผ่น 1 แล้วเกินพื้นที่ ~3mm กลายเป็น 3 แผ่น (วัดจริง)
function memoBody({ tenant, people, signatories, departmentName, emblemUrl, subject, mainHtml, orderHtml, extraSignHtml = '' }) {
  return `${memoHead({ tenant, departmentName, subject, emblemUrl })}
${mainHtml}
  <div class="close-group">
    <p class="para">จึงเรียนมาเพื่อโปรดพิจารณา</p>
${committeeBlock(people)}
  </div>
  <div class="order-group page-two">
    <p class="page-no">- ๒ -</p>
${extraSignHtml}
${commandBlock(orderHtml)}
${staffBlock({ signatories, tenant, departmentName })}
  </div>`
}

export function buildChangeRequestMemoHtml({
  tenant, project, contract = null, change = {}, people = [], signatories = null, departmentName = '', emblemUrl = '', printedAt = new Date(),
} = {}) {
  const kind = CHANGE_KINDS[change?.kind] ?? CHANGE_KINDS.extend_time
  const subject = `ขออนุมัติ${esc(kind)} โครงการ ${esc(text(project?.title))}`
  const dueDate = contract?.extended_until || project?.end_date
  const requested = isNum(change?.requested_days) ? esc(Number(change.requested_days)) : blank('14mm')
  const main = `  <p class="sec">1. เรื่องเดิม</p>
  <p class="para">${contractOpening({ tenant, project, contract })} กำหนดแล้วเสร็จ ${dateOrBlank(dueDate)} อัตราค่าปรับวันละ ${moneyOrBlank(contract?.fine_per_day, '22mm')} บาท</p>
  <p class="sec">2. ข้อเท็จจริง</p>
  <p class="para">ผู้รับจ้างมีหนังสือ (เลขที่ ${orBlank(change?.ref_no, '24mm')} ลงวันที่ ${dateOrBlank(change?.ref_date)}) ซึ่งหน่วยงานได้รับเมื่อวันที่ ${dateOrBlank(change?.request_received_on)} ขอ${esc(kind)} จำนวน ${requested} วัน เนื่องจาก ${has(change?.cause) ? oneLine(change.cause) : blank('70mm')} และเหตุดังกล่าวสิ้นสุดลงเมื่อวันที่ ${dateOrBlank(change?.cause_ended_on)}</p>
  <p class="para">${timingSentence(change)} ${esc(LATE_NOTICE_SENTENCE)}</p>
  <p class="sec">3. ข้อพิจารณาของคณะกรรมการตรวจรับพัสดุ</p>
  <p class="opt-flow">เหตุดังกล่าว ${box()}เกิดจากความผิดหรือความบกพร่องของหน่วยงานของรัฐ ${box()}เหตุสุดวิสัย ${box()}เกิดจากพฤติการณ์อันหนึ่งอันใดที่คู่สัญญาไม่ต้องรับผิดตามกฎหมาย ${box()}เหตุอื่นตามที่กำหนดในกฎกระทรวง ${box()}ไม่เข้ากรณีข้างต้น</p>
  <p class="opt-flow">เห็นควร ${box()}ให้${esc(kind)} จำนวน ${blank('18mm')} วัน ${box()}ไม่ให้ เนื่องจาก ${blank('50mm')}</p>`
  const body = memoBody({
    tenant, people, signatories, departmentName, emblemUrl, subject, mainHtml: main,
    orderHtml: `คำสั่ง ${box()}อนุมัติ ${blank('18mm')} วัน ${box()}ไม่อนุมัติ`,
  })
  return documentHtml({
    title: `${kind} ${text(project?.title)}`, bodyHtml: `${body}\n${footnote(CHANGE_REQUEST_FOOTNOTE)}`, tenant, printedAt, withOrigin: false,
  })
}

// ── P10 บันทึกเสนอแก้ไขสัญญา ──────────────────────────────────────────────────

export const CONTRACT_AMEND_FOOTNOTE = 'ที่มา: พ.ร.บ.การจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 มาตรา 97 และ 98 (ต้องยืนยันกับฉบับปัจจุบัน) · '
  + 'ระเบียบกระทรวงการคลังฯ พ.ศ. 2560 ข้อ 165 · ระบบไม่วินิจฉัยว่าแก้ไขได้หรือไม่ · ร่างจากข้อมูลในระบบ ต้องตรวจกับระเบียบฉบับปัจจุบันก่อนใช้'

export function buildContractAmendMemoHtml({
  tenant, project, contract = null, change = {}, people = [], signatories = null, departmentName = '', emblemUrl = '', printedAt = new Date(),
} = {}) {
  const subject = `ขออนุมัติแก้ไขสัญญาจ้างเลขที่ ${orBlank(project?.contract_no, '28mm')} โครงการ ${esc(text(project?.title))}`
  const dueDate = contract?.extended_until || project?.end_date
  const items = []
  if (isNum(change?.amount_change) && Number(change.amount_change) !== 0) {
    const delta = Number(change.amount_change)
    const base = isNum(project?.contract_amount) ? Number(project.contract_amount) : null
    items.push(`วงเงิน${delta > 0 ? 'เพิ่ม' : 'ลด'} ${esc(money(Math.abs(delta)))} บาท (วงเงินตามสัญญาเดิม ${base === null ? blank('26mm') : esc(money(base))} บาท เป็น ${base === null ? blank('26mm') : esc(money(base + delta))} บาท)`)
  }
  if (change?.new_end_date) items.push(`วันสิ้นสุดสัญญาใหม่ ${dateOrBlank(change.new_end_date)}`)
  if (has(change?.note)) items.push(oneLine(change.note))
  const itemsHtml = items.length
    ? items.map(item => `  <p class="opt">- ${item}</p>`).join('\n')
    : `  <p class="opt">- ${blank('90mm')}</p>`
  const main = `  <p class="sec">1. เรื่องเดิม</p>
  <p class="para">${contractOpening({ tenant, project, contract })} กำหนดแล้วเสร็จ ${dateOrBlank(dueDate)} อัตราค่าปรับวันละ ${moneyOrBlank(contract?.fine_per_day, '22mm')} บาท</p>
  <p class="sec">2. เหตุที่ต้องแก้ไข และรายการที่ขอแก้ไข</p>
  <p class="para">เหตุที่ต้องแก้ไข ${has(change?.cause) ? oneLine(change.cause) : blank('80mm')}</p>
  <p class="opt-flow" style="padding-left:10mm">รายการที่ขอแก้ไข</p>
${itemsHtml}
  <p class="sec">3. ข้อพิจารณาของคณะกรรมการตรวจรับพัสดุ</p>
  <p class="opt">${box()}การแก้ไขอยู่ภายในขอบข่ายแห่งวัตถุประสงค์เดิมของสัญญา</p>
  <p class="opt">${box()}ได้เปรียบเทียบคุณภาพหรือรายละเอียดของงาน รวมทั้งราคาของงานตามสัญญากับที่จะทำการแก้ไขแล้ว ผลการเปรียบเทียบ ${blank('60mm')}</p>
  <p class="opt">${box()}เป็นงานเกี่ยวกับความมั่นคงแข็งแรงหรืองานเทคนิคเฉพาะอย่าง ซึ่งได้รับการรับรองจากวิศวกร สถาปนิก หรือผู้ทรงคุณวุฒิแล้ว ตามช่องรับรองด้านล่าง</p>
  <p class="sec">4. การลงนามและเผยแพร่</p>
  <p class="para">เมื่อผู้มีอำนาจอนุมัติแล้ว ให้หัวหน้าหน่วยงานของรัฐเป็นผู้ลงนามในสัญญาที่ได้แก้ไข และเผยแพร่การแก้ไขสัญญาในระบบเครือข่ายสารสนเทศของกรมบัญชีกลาง วันที่เผยแพร่ ${dateOrBlank(change?.egp_published_on, '40mm')}</p>`
  const certifier = singleSign([govNameBlank(), 'ผู้รับรอง (วิศวกร/สถาปนิก/ผู้ทรงคุณวุฒิ)', `เลขทะเบียนใบอนุญาต ${dots(10)}`])
  const body = memoBody({
    tenant, people, signatories, departmentName, emblemUrl, subject, mainHtml: main, extraSignHtml: certifier,
    orderHtml: `คำสั่ง ${box()}อนุมัติ ${box()}ไม่อนุมัติ`,
  })
  return documentHtml({
    title: `บันทึกเสนอแก้ไขสัญญา ${text(project?.title)}`, bodyHtml: `${body}\n${footnote(CONTRACT_AMEND_FOOTNOTE)}`, tenant, printedAt, withOrigin: false,
  })
}

// ── P11 รายงานผลตรวจความชำรุดบกพร่องก่อนครบประกัน ───────────────────────────────

export const WARRANTY_REPORT_FOOTNOTE = 'ที่มา: ระเบียบกระทรวงการคลังฯ พ.ศ. 2560 ข้อ 184–186 · หนังสือ กค (กวจ) 0405.2/ว 117 ลว. 12 มี.ค. 2562 · '
  + 'ผลตรวจกรอกโดยผู้ตรวจสอบ ระบบไม่ตัดสิน · ร่างจากข้อมูลในระบบ ต้องตรวจกับระเบียบฉบับปัจจุบันก่อนใช้'

/** guarantee_type='none' → "ไม่มีหลักประกันสัญญา" · ชนิดอื่นพิมพ์ชนิด เลขที่ จำนวนเงิน (ค่าว่าง = เส้นประ) */
function guaranteeText(contract) {
  const type = contract?.guarantee_type
  if (type === 'none') return 'ไม่มีหลักประกันสัญญา'
  const label = GUARANTEE_TYPES[type]
  return `หลักประกันสัญญา ${label ? esc(label) : blank('34mm')} เลขที่ ${orBlank(contract?.guarantee_ref, '30mm')} จำนวน ${moneyOrBlank(contract?.guarantee_amount, '26mm')} บาท`
}

/**
 * @param {object} args.warranty  { start, end, months } จาก warrantyWindow(bundle) ถ้ามี — ใช้เติมเมื่อสัญญาไม่ได้บันทึกวันที่ไว้ตรงๆ
 */
export function buildWarrantyInspectionReportHtml({
  tenant, project, contract = null, warranty = null, signatories = null, departmentName = '', emblemUrl = '', printedAt = new Date(),
} = {}) {
  const sig = signatories ?? EMPTY_SIGNATORIES
  const months = contract?.warranty_months ?? warranty?.months ?? null
  const start = contract?.warranty_starts_on || warranty?.start || ''
  const end = contract?.warranty_ends_on || warranty?.end || ''
  const lead = warrantyLeadDays(months)
  const subject = `รายงานผลการตรวจสอบความชำรุดบกพร่องก่อนสิ้นสุดระยะเวลาการประกัน โครงการ ${esc(text(project?.title))}`
  const body = `${memoHead({ tenant, departmentName, subject, emblemUrl })}
  <p class="para">${contractOpening({ tenant, project, contract })} ซึ่งกำหนดระยะเวลาประกันความชำรุดบกพร่อง ${isNum(months) ? esc(Number(months)) : blank('14mm')} เดือน ตั้งแต่ ${dateOrBlank(start)} ถึง ${dateOrBlank(end)} ${guaranteeText(contract)}</p>
  <p class="para">หนังสือคณะกรรมการวินิจฉัยปัญหาการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ ที่ กค (กวจ) 0405.2/ว 117 ลงวันที่ 12 มีนาคม 2562 ข้อ 3 กำหนดให้ผู้มีหน้าที่รับผิดชอบตรวจสอบความชำรุดบกพร่องของพัสดุก่อนสิ้นสุดระยะเวลาการประกันภายใน ${lead === null ? `${dots(5)}` : esc(lead)} วัน และรายงานให้หัวหน้าหน่วยงานของรัฐทราบ</p>
  <p class="sec">ผลการตรวจสอบ เมื่อวันที่ ${blank('40mm')}</p>
  <p class="opt-flow">${box()}ไม่พบความชำรุดบกพร่อง &nbsp;&nbsp;${box()}พบความชำรุดบกพร่อง ดังนี้</p>
  <p class="fill-line"><span class="fl"></span></p>
  <p class="fill-line"><span class="fl"></span></p>
  <p class="fill-line"><span class="fl"></span></p>
  <p class="para">กรณีพบความชำรุดบกพร่อง เห็นควรแจ้งให้ผู้รับจ้างเข้าดำเนินการแก้ไขหรือซ่อมแซมก่อนสิ้นสุดระยะเวลาการประกัน พร้อมกับแจ้งให้ผู้ค้ำประกัน (ถ้ามี) ทราบด้วย · กรณีไม่พบ เห็นควรดำเนินการคืนหลักประกันสัญญาต่อไป</p>
  <p class="para">จึงเรียนมาเพื่อโปรดทราบและพิจารณา</p>
${singleSign([govNameBlank(), 'หัวหน้าหน่วยงานผู้ครอบครองพัสดุ หรือผู้ได้รับมอบหมาย'])}
  <div class="sign-block" style="break-inside:avoid;margin-top:1mm">
    <p class="fill-line"><span>ความเห็นปลัด</span><span class="fl"></span></p>
    <div class="sign-single sign-block"><div class="center-row">${govSignRow({ below: signerLines(sig.clerk, orgClerkTitle(tenant)) })}</div></div>
  </div>
  <div class="sign-block" style="break-inside:avoid;margin-top:1mm">
    <p class="field">คำสั่งนายก ${box()}ทราบ ${box()}ให้แจ้งผู้รับจ้างแก้ไข ${box()}ให้คืนหลักประกัน</p>
    <div class="sign-single sign-block"><div class="center-row">${govSignRow({ below: signerLines(sig.mayor, orgHeadTitle(tenant)) })}</div></div>
  </div>
${footnote(WARRANTY_REPORT_FOOTNOTE)}`
  return documentHtml({
    title: `รายงานผลตรวจความชำรุดบกพร่อง ${text(project?.title)}`, bodyHtml: body, tenant, printedAt, withOrigin: false,
  })
}

// ── P12 หนังสือแจ้งแก้ไขความชำรุดบกพร่อง (หนังสือภายนอก) ───────────────────────────

export const DEFECT_NOTICE_SCREEN_NOTE = 'ร่างจากข้อมูลในระบบ — ตรวจถ้อยคำกับเงื่อนไขในสัญญาและงานพัสดุก่อนส่ง · '
  + 'ที่มา ระเบียบกระทรวงการคลังฯ พ.ศ. 2560 ข้อ 185 · ว 117 ข้อ 3'

/** ที่อยู่หัวหนังสือ — ใช้ municipalities.address ที่ tenant ถืออยู่แล้ว (ไม่ query คอลัมน์ใหม่) ว่าง = เส้นประ */
function senderAddressLines(tenant) {
  return String(tenant?.address ?? '').split('\n').map(part => part.trim()).filter(Boolean)
}

export function buildDefectNoticeLetterHtml({
  tenant, project, contract = null, defect = {}, signatories = null, departmentName = '', emblemUrl = '', printedAt = new Date(),
} = {}) {
  const sig = signatories ?? EMPTY_SIGNATORIES
  const address = senderAddressLines(tenant)
  const details = text(defect?.detail).split('\n').map(line => line.trim()).filter(Boolean)
  const warrantyEnd = contract?.warranty_ends_on
  const fixBy = defect?.fix_due_on
    ? `ภายในวันที่ ${esc(dateText(defect.fix_due_on))}`
    : `ภายใน ${blank('14mm')} วัน นับถัดจากวันที่ได้รับหนังสือนี้`
  const copy = needsGuarantorCopy(contract?.guarantee_type)
    ? `  <p class="copy-to">สำเนาเรียน ${blank('50mm')} (ผู้ค้ำประกัน ตามหลักประกันเลขที่ ${orBlank(contract?.guarantee_ref, '30mm')}) เพื่อโปรดทราบ</p>`
    : ''
  const body = `${screenNote(esc(DEFECT_NOTICE_SCREEN_NOTE))}
  <div class="emblem-center">${emblemImg(emblemUrl)}</div>
  <div class="letter-head">
    <p>ที่ ${blank('45mm')}</p>
    <div class="sender">
      <p>${esc(orgName(tenant))}</p>
${(address.length ? address : [null]).map(line => `      <p>${line === null ? blank('60mm') : esc(line)}</p>`).join('\n')}
    </div>
  </div>
  <p class="letter-date">${blank('18mm')} ${blank('32mm')} ${blank('22mm')}</p>
  <p class="field kv"><b>เรื่อง</b>&nbsp;&nbsp;แจ้งให้แก้ไขความชำรุดบกพร่อง</p>
  <p class="field kv"><b>เรียน</b>&nbsp;&nbsp;${orBlank(project?.contractor_name, '70mm')}</p>
  <p class="field kv"><b>อ้างถึง</b>&nbsp;&nbsp;สัญญาจ้างเลขที่ ${orBlank(project?.contract_no, '28mm')} ลงวันที่ ${dateOrBlank(contract?.contract_date)}</p>
  <p class="para">ตามที่ ${orBlank(project?.contractor_name, '50mm')} ได้ทำสัญญาจ้างกับ${esc(orgName(tenant))} ดำเนินโครงการ ${orBlank(project?.title, '60mm')} ตามสัญญาที่อ้างถึง ซึ่งกำหนดให้ผู้รับจ้างรับประกันความชำรุดบกพร่องของงานจ้าง เป็นระยะเวลา ${isNum(contract?.warranty_months) ? esc(Number(contract.warranty_months)) : blank('14mm')} เดือน สิ้นสุดวันที่ ${dateOrBlank(warrantyEnd)} นั้น</p>
  <p class="para">${esc(orgName(tenant))} ได้ตรวจสอบเมื่อวันที่ ${dateOrBlank(defect?.inspected_on)} พบความชำรุดบกพร่อง ดังนี้</p>
  <div class="detail">
${(details.length ? details : ['']).map(line => `    <p>${line ? esc(line) : blank('120mm')}</p>`).join('\n')}
  </div>
  <p class="para">จึงขอให้ท่านเข้าดำเนินการแก้ไขหรือซ่อมแซมให้ใช้การได้ดีดังเดิม ${fixBy} ตามเงื่อนไขในสัญญา หากท่านไม่ดำเนินการภายในกำหนด ${esc(orgName(tenant))} จะพิจารณาดำเนินการตามสิทธิที่มีอยู่ตามสัญญาต่อไป</p>
  <p class="para">จึงเรียนมาเพื่อโปรดดำเนินการ</p>
  <p class="regards">ขอแสดงความนับถือ</p>
  <div class="letter-sign sign-block"><div class="center-row">${govSignRow({ below: signerLines(sig.mayor, orgHeadTitle(tenant)) })}</div></div>
  <div class="letter-foot">
    <p>${departmentName ? esc(text(departmentName)) : blank('50mm')}</p>
    <p>โทร. ${blank('40mm')}</p>
  </div>
${copy}`
  return documentHtml({
    title: `หนังสือแจ้งแก้ไขความชำรุดบกพร่อง ${text(project?.title)}`, bodyHtml: body, tenant, printedAt,
  })
}

// ── หน้าต่างพิมพ์ + ผู้ลงนาม ──────────────────────────────────────────────────

/**
 * โหลดชื่อกองของโครงการ + ผู้ลงนาม ผอ.กอง/ปลัด/นายก จากทะเบียนกลาง (scope เดียวกับ loadPrintSignatories ใน StaffDashboard)
 * ผู้ลงนาม ณ ตอนพิมพ์ (ใบยังไม่เสร็จ = คนที่ดำรงตำแหน่งตอนนี้) · อ่านไม่ได้/ไม่มีแถว = null → ใบพิมพ์เส้นประ + ชื่อตำแหน่งสำรอง
 * ไม่ throw — ใบต้องพิมพ์ได้เสมอ · supabase โหลดแบบ dynamic เพื่อให้ builder ข้างบนทดสอบใน node ได้
 */
export async function loadLifecycleSignatories({ municipalityId, departmentId = null } = {}) {
  const empty = { departmentName: '', signatories: { ...EMPTY_SIGNATORIES } }
  if (!municipalityId) return empty
  try {
    const { supabase } = await import('./supabase.js')
    const [departments, registry] = await Promise.all([
      departmentId
        ? supabase.from('departments').select('id,name').eq('municipality_id', municipalityId).eq('id', departmentId)
        : Promise.resolve({ data: [] }),
      supabase.from('document_signatories').select(SIGNATORY_REGISTRY_SELECT)
        .eq('municipality_id', municipalityId).eq('document_type', SIGNATORY_SCOPE),
    ])
    const rows = registry.data ?? []
    const at = signatoryMoment()
    const toSignatory = row => (row ? { name: signatoryName(row), title: signatoryTitle(row) } : null)
    return {
      departmentName: departments.data?.[0]?.name ?? '',
      signatories: {
        department_head: toSignatory(pickSignatory(rows, { role: 'department_head', departmentId: departmentId ?? null, at })),
        clerk: toSignatory(pickSignatory(rows, { role: 'clerk', at })),
        mayor: toSignatory(pickSignatory(rows, { role: 'mayor', at })),
      },
    }
  } catch {
    return empty
  }
}

/**
 * เปิดหน้าต่างพิมพ์ — เปิดก่อน await ทุกอย่าง (กัน pop-up blocker บนมือถือ) แล้วโหลดผู้ลงนาม แล้วเขียนใบ + สั่งพิมพ์
 * @param {(ctx: { signatories: object, departmentName: string, emblemUrl: string }) => string} buildFn
 * @param {{ municipalityId?: string, departmentId?: string|null }} [scope]
 */
export async function openLifecyclePrint(buildFn, scope = {}) {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) {
    alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    return false
  }
  win.document.open()
  win.document.write(addMobileCloseButton('<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>กำลังเตรียมเอกสาร</title></head><body><p role="status" style="padding:72px 24px">กำลังเตรียมเอกสาร...</p></body></html>'))
  win.document.close()
  const { departmentName, signatories } = await loadLifecycleSignatories(scope)
  if (win.closed) return false
  const html = buildFn({ signatories, departmentName, emblemUrl: `${window.location.origin}/images/garuda.svg` })
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
