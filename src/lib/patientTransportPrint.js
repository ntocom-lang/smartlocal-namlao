// ใบพิมพ์ของคำขอ "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย" — 2 ใบที่ใช้คู่กัน
//   1. หนังสือนำส่ง (หนังสือภายนอก) จาก อปท. ถึงประธานหน่วยงานผู้จัดรถ
//   2. ใบคำขอรับสวัสดิการ ที่แนบไปกับหนังสือนำส่ง
//
// ⚠️ รูปแบบหนังสือภายนอก (ตำแหน่งครุฑ/ช่อง "ที่"/ที่อยู่หัวขวา/คำลงท้าย) คัดจากคู่มืองานสารบรรณ
// ของส่วนราชการที่อ้างระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ อีกทอดหนึ่ง **ยังไม่ได้เปิด
// ตัวบทต้นฉบับยืนยัน** ก่อนใช้กับหนังสือที่ออกจริงต้องให้เจ้าหน้าที่สารบรรณตรวจรูปแบบก่อน
// โดยเฉพาะขนาดครุฑ (ใช้ 3 ซม. ตามที่คู่มือทั่วไประบุสำหรับหนังสือภายนอก ต่างจากบันทึกข้อความ
// ที่ระบบนี้ใช้ 1.5 ซม.) และระยะเยื้องของคำลงท้าย
//
// ⚠️ ใบคำขอรับสวัสดิการ **ไม่ใช่แบบฟอร์มของกองทุนใดกองทุนหนึ่ง** — ลอกโครงจากแบบตัวอย่างกลาง
// "ใบคำขอรับสวัสดิการ" ที่ พอช. เผยแพร่เป็นชุดข้อมูลเปิด (หมวด 1 เสียชีวิต / 2 เยี่ยมไข้ /
// 3 ทุนการศึกษา / 4 รับขวัญบุตร / 5 อื่นๆ) ซึ่งไม่มีหมวดรถรับ-ส่งผู้ป่วย เรื่องนี้จึงลงข้อ 5
// กองทุนแต่ละแห่งมีระเบียบและแบบฟอร์มของตนเอง ถ้ากองทุนปลายทางมีแบบของตัวเองต้องใช้แบบนั้นแทน
// (บรรทัดกำกับท้ายใบบอกเรื่องนี้ไว้แล้ว ห้ามตัดออก)
//
// ⚠️ ช่องลงนามของคณะกรรมการกองทุน (ประธาน/เหรัญญิก/พยาน) ต้องว่างเสมอทุกกรณี — คนเหล่านั้น
// ไม่ได้อยู่ในระบบนี้และยังไม่ได้พิจารณาอะไรตอนพิมพ์ใบ

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText,
  govPageCss, govPagePadding,
} from './govDocStyle.js'
import { orgHeadTitle, orgNameParts, orgOfficeName } from './orgTerms.js'
import { MONTHS_TH, thaiDateFromDateInput } from './thaiDate.js'
import {
  APPOINTMENT_KINDS, MOBILITY_LEVELS, REQUESTER_RELATIONS, TRIP_TYPES, optionLabel,
} from './patientTransport.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

// ช่องกรอก — กติกาเดียวกับใบยืมพัสดุ/ใบน้ำประปา: มีค่าเป็นข้อความ inline ธรรมดา
// ว่างเป็นเส้นประให้เขียนด้วยปากกา (ห้าม inline-block ในย่อหน้าที่ไหลต่อเนื่อง)
function line(value, width = '40mm') {
  const content = String(value ?? '').trim()
  if (content) return `<span class="fill-value">${esc(content)}</span>`
  return `<span class="fill-blank" style="min-width:${width}">&nbsp;</span>`
}

/** ป้ายชื่อช่อง + ช่องกรอก มัดไว้ด้วยกันไม่ให้ขึ้นบรรทัดคั่นกลาง (label เป็นข้อความคงที่ในไฟล์นี้) */
function field(label, value, width = '40mm') {
  const content = String(value ?? '').trim()
  if (content) return `${label} <span class="fill-value">${esc(content)}</span>`
  return `<span class="field-blank">${label}&nbsp;<span class="fill-blank" style="min-width:${width}">&nbsp;</span></span>`
}

/**
 * ช่องติ๊ก — วาดด้วย border ไม่ใช้อักขระ ☐ (U+2610) เพราะ THSarabunPSK ไม่มี glyph ตัวนี้
 * เครื่องที่ลงฟอนต์ราชการจะได้กล่องสี่เหลี่ยมทึบหรือช่องว่างเปล่าแทน
 */
function box(checked = false) {
  return `<span class="box${checked ? ' box--on' : ''}"></span>`
}

/** ชื่อหน่วยงานที่ยอมให้ขึ้นบรรทัดใหม่ได้เฉพาะรอยต่อ "คำนำหน้า|ชื่อท้องถิ่น" (ดู orgNameParts) */
function orgNameHtml(nameOrTenant) {
  const { prefix, locality } = orgNameParts(nameOrTenant)
  if (!locality) return `<span class="nb">${esc(prefix)}</span>`
  return `<span class="nb">${esc(prefix)}</span><span class="nb">${esc(locality)}</span>`
}

/** "10 กันยายน 2569" สำหรับบรรทัดวันที่กลางหน้าของหนังสือภายนอก */
function letterDateText(value) {
  const iso = String(value ?? '').slice(0, 10)
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  return `${Number(match[3])} ${MONTHS_TH[Number(match[2]) - 1]} ${Number(match[1]) + 543}`
}

/** วันเวลานัด "12 กันยายน 2569 เวลา 08.30 น." — timestamptz จาก DB แสดงตามเวลาเครื่องผู้พิมพ์ */
function appointmentText(value) {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  const hh = String(at.getHours()).padStart(2, '0')
  const mm = String(at.getMinutes()).padStart(2, '0')
  return `${at.getDate()} ${MONTHS_TH[at.getMonth()]} ${at.getFullYear() + 543} เวลา ${hh}.${mm} น.`
}

function appointmentDateOnly(value) {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return `${at.getDate()} ${MONTHS_TH[at.getMonth()]} ${at.getFullYear() + 543}`
}

/**
 * บล็อกลงนาม — เส้นจุดคือแกน บรรทัดใต้ต้องอยู่กึ่งกลาง "ของเส้น" ไม่ใช่กึ่งกลางคอลัมน์
 * (เหตุผลเต็มอยู่ที่ signRow() ใน assetBorrowPrint.js ซึ่งแก้จากใบพิมพ์จริงมาแล้ว)
 */
function signRow({ width = '55mm', role = '', below = [], signed = '' }) {
  return `<div class="sign-row">
      <span class="sign-label">ลงชื่อ</span>
      <span class="sign-axis">
        ${signed
          ? `<span class="sign-signed" style="min-width:${width}">${signed}</span>`
          : `<span class="sign-line" style="min-width:${width}">&nbsp;</span>`}
${below.map(text => `        <span class="sign-below">${text}</span>`).join('\n')}
      </span>
      ${role ? `<span class="sign-role">${role}</span>` : ''}
    </div>`
}

function signatureName(name) {
  const value = String(name ?? '').trim()
  return value ? `(${esc(value)})` : '(..................................................)'
}

// ที่อยู่ผู้ยื่น/ผู้ป่วยที่กรอกมาเป็นข้อความอิสระอยู่แล้ว ไม่ต้องประกอบใหม่จากรายช่อง
function textOr(value, fallback = '') {
  const content = String(value ?? '').trim()
  return content || fallback
}

// ---------------------------------------------------------------------------
// CSS ที่ใช้ร่วมกันทั้งสองใบ — ฟอนต์/ขอบกระดาษมาจาก govDocStyle.js ที่เดียว
// ห้ามเขียน font-family / font-size / @page margin ซ้ำในไฟล์นี้ (กติกาโปรเจกต์)
// ---------------------------------------------------------------------------
function sharedCss() {
  return `
  ${govPageCss({ hideBrowserHeader: true })}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #000; ${govDocFontCss()} }
  /* กล่อง 1 หน้ากระดาษ — ขอบกระดาษย้ายมาเป็น padding เพราะ @page margin เป็น 0
     (ไม่งั้นเบราว์เซอร์เหลือที่วาดหัว/ท้ายกระดาษของตัวเอง) ดู govPagePadding() */
  .sheet { width: 210mm; min-height: 297mm; padding: ${govPagePadding()}; }
  /* ใบที่ 2 ขึ้นหน้าใหม่เสมอ ไม่พึ่งการปัดเศษความสูงของใบแรก */
  .sheet + .sheet { break-before: page; page-break-before: always; }
  @media print {
    /* 295mm = พื้นที่พิมพ์ 274mm + ขอบบน 12mm + ขอบล่าง 9mm (box-sizing นับ padding รวมแล้ว)
       เผื่อ 2mm กันปัดเศษไปเปิดหน้าเปล่า — เหตุผลเดียวกับ fleetFuelMemoPrint.js */
    .sheet { width: auto; min-height: 295mm; }
  }
  p { margin: 0; }
  .para { text-align: left; }
  .indent { display: inline-block; width: 2.5cm; }
  .fill-value { border-bottom: 1px dotted #000; padding: 0 1mm; }
  .fill-blank { display: inline-block; border-bottom: 1px dotted #000; }
  .field-blank { white-space: nowrap; }
  .nb { white-space: nowrap; }
  .center { text-align: center; }
  .bold { font-weight: 700; }

  /* ช่องติ๊กวาดเอง — 3.4mm คือขนาดที่ปากกาลูกลื่นกาเครื่องหมายลงได้จริงโดยไม่ล้นกรอบ */
  .box {
    display: inline-block; width: 3.4mm; height: 3.4mm; border: 1px solid #000;
    margin-right: 1mm; vertical-align: -0.3mm;
  }
  /* ข้อที่ระบบติ๊กให้แล้ว — ใช้ gradient วาดกากบาทแทน glyph ✓ ที่ THSarabunPSK ไม่มี */
  .box--on {
    background:
      linear-gradient(to top right, transparent calc(50% - 0.35mm), #000 50%, transparent calc(50% + 0.35mm)),
      linear-gradient(to bottom right, transparent calc(50% - 0.35mm), #000 50%, transparent calc(50% + 0.35mm));
  }

  /* บล็อกลงนาม (โครงเดียวกับ assetBorrowPrint.js — อย่าแก้ทีละใบให้เพี้ยนกัน) */
  .sign-row { display: flex; align-items: flex-start; }
  .sign-axis { display: flex; flex-direction: column; align-items: center; flex: 0 1 auto; min-width: 0; }
  .sign-line { border-bottom: 1px dotted #000; display: inline-block; }
  .sign-axis > .sign-line { align-self: stretch; }
  .sign-label, .sign-role { white-space: nowrap; }
  .sign-role { margin-left: 1mm; }
  .sign-below { text-align: center; }
  .sign-signed { text-align: center; font-weight: 700; }
  .sign-block { break-inside: avoid; page-break-inside: avoid; }
  .center-row .sign-row { justify-content: center; }
  .two-col { display: flex; gap: 8mm; break-inside: avoid; page-break-inside: avoid; }
  .two-col > div { flex: 1 1 0; min-width: 0; }
  /* 10pt: บรรทัดกำกับการลงชื่อผ่านระบบ ต้องอ่านออกแต่ไม่แย่งน้ำหนักกับชื่อผู้ลงนาม */
  .signed-note { margin: 1mm 0 0; font-size: 10pt; color: #333; line-height: 1.2; text-align: center; }
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 2mm; }`
}

// ---------------------------------------------------------------------------
// ใบที่ 1 — หนังสือนำส่ง (หนังสือภายนอก)
// ---------------------------------------------------------------------------
function letterCss() {
  return `
  /* ครุฑกลางหน้า 3 ซม. ตามรูปแบบหนังสือภายนอก (⚠️ ยังไม่ได้ยืนยันกับตัวบท ดูหัวไฟล์)
     ไฟล์: public/images/garuda.svg — ต้องส่ง URL เต็มมาเพราะหน้าต่างพิมพ์เป็น about:blank
     ที่เขียนด้วย document.write พาธแบบ /images/... จะ resolve ไม่เจอ
     ไฟล์หาย = ซ่อนรูป เหลือช่องว่างขนาดเท่ากัน ซึ่งพิมพ์ทับกระดาษหัวจดหมายที่มีครุฑได้พอดี */
  /* กล่องสูง 3 ซม. ตายตัว รูปอยู่ข้างใน — ถ้ารูปโหลดไม่ขึ้นต้องเหลือ "ช่องว่างขนาดเท่าเดิม"
     ไม่ใช่ให้เนื้อความเลื่อนขึ้นมา 3 ซม. (ใบที่พิมพ์ทับกระดาษหัวจดหมายซึ่งมีครุฑอยู่แล้ว
     ต้องวางตรงกันพอดี) เคยผูก onerror ไว้กับ img ที่เป็นตัวกล่องเอง แล้วซ่อนทีเดียวหายทั้งช่อง */
  .emblem { height: 3cm; margin-bottom: 2mm; }
  .emblem img { height: 100%; display: block; margin: 0 auto; }
  .letter-head { display: flex; align-items: flex-start; gap: 6mm; }
  .letter-no { flex: 0 0 auto; }
  /* ที่อยู่ผู้ส่งอยู่หัวขวา ชิดขวาของพื้นที่พิมพ์ ไม่ใช่กึ่งกลาง */
  .sender { flex: 1 1 auto; text-align: right; }
  .letter-date { text-align: center; margin: 3mm 0; }
  /* hanging indent ของ "เรื่อง/เรียน/สิ่งที่ส่งมาด้วย" — บรรทัดต่อไปต้องเยื้องมาตรงกับตัวแรก
     ของเนื้อหา ไม่ใช่ชิดขอบซ้ายทับแนวคำนำ */
  .kv { padding-left: 4.2em; text-indent: -4.2em; }
  .kv--wide { padding-left: 7.6em; text-indent: -7.6em; }
  .body-para { text-indent: 2.5cm; text-align: left; margin-top: 2mm; }
  .closing { text-indent: 2.5cm; margin-top: 2mm; }
  /* คำลงท้ายอยู่ค่อนไปทางขวาของกึ่งกลางกระดาษตามรูปแบบหนังสือภายนอก และต้องอยู่ "แกนเดียว"
     กับบล็อกลงนามข้างล่าง จึงใช้ padding-left เท่ากันแล้วจัดกึ่งกลางทั้งคู่
     ⚠️ ห้ามดันไปขวากว่านี้ — ชื่อตำแหน่งที่ยาวที่สุดที่เจอจริง ("รักษาราชการแทนนายกองค์การ
     บริหารส่วนตำบล…") กว้างเกือบ 95mm ถ้าแกนกลางเลยจุดนี้ไปจะล้นขอบขวากระดาษ */
  .regards { margin: 3mm 0 0; padding-left: 40%; text-align: center; }
  /* 12mm คือที่ว่างเหนือชื่อไว้ให้เซ็นสด — ต่ำกว่านี้ลายเซ็นทับบรรทัดชื่อในวงเล็บ
     (บันทึกข้อความของระบบใช้ 8mm เป็นค่าต่ำสุด ใบนี้เผื่อขึ้นเพราะเป็นหนังสือที่ส่งออกนอก อปท.)
     ⚠️ ห้ามลดค่านี้เพื่อให้ใบจบหน้าเดียว ต้องไปหาที่จากส่วนอื่นแทน */
  .letter-sign { margin-top: 12mm; padding-left: 40%; }
  .letter-sign p { text-align: center; }
  /* ส่วนราชการเจ้าของเรื่อง + เบอร์โทร อยู่ท้ายใบชิดซ้าย ตัวเท่าเนื้อความ */
  .owner { margin-top: 6mm; }`
}

/**
 * หนังสือนำส่งจาก อปท. ถึงหน่วยงานผู้จัดรถ
 *
 * ⚠️ ย่อหน้าที่ 3 (ความยินยอม PDPA) ห้ามตัดออก — เป็นการแจ้งผู้รับข้อมูลว่าได้ข้อมูลมาโดยอาศัย
 * ความยินยอมของเจ้าของข้อมูล และขอบเขตที่ใช้ได้แค่ไหน ถ้าไม่มีบรรทัดนี้ อปท. ส่งข้อมูลสุขภาพ
 * ออกไปโดยไม่มีเงื่อนไขกำกับเลย
 *
 * @param {object} args
 * @param {object} args.header  แถวจาก patient_transport_requests
 * @param {object} [args.form]  document_requests.permit_form_data (snapshot ตอนยื่น)
 * @param {object} [args.parent] แถวจาก document_requests (ชื่อ/เบอร์/ที่อยู่ผู้ยื่น)
 * @param {object} args.tenant
 * @param {{name?: string, title?: string}} [args.mayor] ผู้ลงนามบทบาท mayor จากทะเบียนกลาง
 * @param {string} [args.departmentName] กองเจ้าของเรื่อง = บรรทัด "ส่วนราชการเจ้าของเรื่อง"
 * @param {string} [args.referenceNo] เลขอ้างอิงคำขอ (8 ตัวแรกของ request id)
 * @param {string} [args.emblemUrl] URL เต็มของตราครุฑ
 */
function letterSheet({
  header, form = {}, parent = {}, tenant,
  mayor = null, departmentName = '', referenceNo = '', emblemUrl = '',
}) {
  const orgName = tenant?.name?.trim() || 'หน่วยงาน'
  const mayorTitle = mayor?.title?.trim() || orgHeadTitle(tenant)
  const senderAddress = [
    tenant?.address,
    [tenant?.district && `อำเภอ${tenant.district}`, tenant?.province && `จังหวัด${tenant.province}`]
      .filter(Boolean).join(' '),
  ].map(part => String(part ?? '').trim()).filter(Boolean)

  const patientName = textOr(form.patient_name, parent?.requester_name)
  const patientAge = form.patient_age != null && form.patient_age !== ''
    ? ` อายุ ${form.patient_age} ปี` : ''
  const destination = [form.destination, form.destination_detail]
    .map(part => String(part ?? '').trim()).filter(Boolean).join(' ')
  const mobility = optionLabel(MOBILITY_LEVELS, header?.mobility ?? form.mobility)
  const consentDate = header?.consent_at
    ? appointmentDateOnly(header.consent_at)
    : appointmentDateOnly(form.consent_at)

  // ย่อหน้าแรกให้ข้อมูลเท่าที่ผู้รับต้องใช้ตัดสินใจจัดรถ รายละเอียดที่เหลืออยู่ในใบแนบ
  // (หลัก data minimization — ไม่ยกทุกช่องมาไว้ในหนังสือที่เวียนผ่านหลายมือ)
  const para1 = `ด้วย ${textOr(parent?.requester_name, 'ผู้ยื่นคำขอ')} ได้ยื่นคำขอต่อ${orgName} `
    + `ผ่านระบบบริการอิเล็กทรอนิกส์ ตามเลขอ้างอิง ${referenceNo || '-'} `
    + `เพื่อขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย สำหรับ ${patientName || '-'}${patientAge} `
    + `ไปยัง ${destination || '-'} ในวันที่ ${appointmentText(header?.appointment_at) || '-'} `
    + `${mobility ? `ลักษณะการเคลื่อนไหวของผู้ป่วย ${mobility} ` : ''}`
    + 'รายละเอียดปรากฏตามสิ่งที่ส่งมาด้วย'

  const para2 = `${orgName}ได้ตรวจสอบคำขอแล้ว เห็นว่าเป็นกรณีที่มิใช่เหตุฉุกเฉิน `
    + `จึงขอความอนุเคราะห์มายังท่าน เพื่อโปรดพิจารณาให้ความช่วยเหลือตามระเบียบของ`
    + `${header?.partner_name_snapshot ?? 'หน่วยงานของท่าน'} และแจ้งผลการพิจารณาให้${orgName}ทราบ `
    + 'เพื่อจะได้แจ้งผู้ยื่นคำขอทราบต่อไป'

  const para3 = 'ทั้งนี้ ผู้ยื่นคำขอได้ให้ความยินยอมเป็นการเฉพาะให้เปิดเผยข้อมูลตามคำขอนี้แก่ท่าน'
    + `${consentDate ? ` เมื่อวันที่ ${consentDate}` : ''}`
    + `${header?.consent_version ? ` (ข้อความยินยอมรุ่น ${header.consent_version})` : ''} `
    + 'จึงขอความร่วมมือให้ใช้ข้อมูลดังกล่าวเพื่อการพิจารณาและจัดรถตามคำขอนี้เท่านั้น '
    + `ไม่เปิดเผยต่อบุคคลอื่น และหยุดใช้ข้อมูลเมื่อเสร็จภารกิจ หากผู้ยื่นคำขอถอนความยินยอม ${orgName}`
    + 'จะแจ้งให้ท่านทราบโดยเร็ว'

  return `<div class="sheet">
  <div class="emblem">${emblemUrl
    ? `<img src="${esc(emblemUrl)}" alt="" onerror="this.style.display='none'">`
    : ''}</div>

  <div class="letter-head">
    <p class="letter-no">${field('ที่', header?.forward_letter_no, '45mm')}</p>
    <div class="sender">
      <p>${orgNameHtml(orgOfficeName(tenant))}</p>
${senderAddress.map(part => `      <p>${esc(part)}</p>`).join('\n')}
    </div>
  </div>

  <p class="letter-date">${
    header?.forward_letter_date
      ? esc(thaiDateFromDateInput(header.forward_letter_date))
      : `${line('', '18mm')} ${line('', '32mm')} ${line('', '22mm')}`
  }</p>

  <p class="kv"><span class="bold">เรื่อง</span>&nbsp;&nbsp;ขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย</p>
  <p class="kv"><span class="bold">เรียน</span>&nbsp;&nbsp;${esc(header?.recipient_title_snapshot ?? '')}</p>
  <p class="kv kv--wide"><span class="bold">สิ่งที่ส่งมาด้วย</span>&nbsp;&nbsp;ใบคำขอรับสวัสดิการ (รถรับ-ส่งผู้ป่วย)&nbsp;&nbsp;จำนวน 1 ฉบับ</p>

  <p class="body-para">${esc(para1)}</p>
  <p class="body-para">${esc(para2)}</p>
  <p class="body-para">${esc(para3)}</p>
  <p class="closing">จึงเรียนมาเพื่อโปรดพิจารณาให้ความอนุเคราะห์ จะขอบคุณยิ่ง</p>

  <p class="regards">ขอแสดงความนับถือ</p>
  <div class="letter-sign sign-block">
    <p>${signatureName(mayor?.name)}</p>
    <p>${esc(mayorTitle)}</p>
  </div>

  <!-- ⚠️ บล็อกนี้คือ "ส่วนราชการเจ้าของเรื่อง" ของผู้ส่ง ห้ามเอาเบอร์ของหน่วยงานปลายทางมาใส่
       (เคยใส่แล้วกินไป 2 บรรทัดจนใบตกหน้า 2 และผิดรูปแบบหนังสือด้วย — เบอร์ของกองทุน
       อยู่ในทะเบียนหน่วยงานฝั่งเจ้าหน้าที่อยู่แล้ว) -->
  <div class="owner">
    <p>${esc(textOr(departmentName, 'สำนักปลัด'))}</p>
    ${tenant?.phone ? `<p>โทร. ${esc(tenant.phone)}</p>` : '<p>โทร. ......................................</p>'}
    ${tenant?.fax ? `<p>โทรสาร ${esc(tenant.fax)}</p>` : ''}
  </div>

  <div class="origin">${esc(govEServiceOriginText(orgName))}</div>
</div>`
}

// ---------------------------------------------------------------------------
// ใบที่ 2 — ใบคำขอรับสวัสดิการ (โครงจากแบบตัวอย่างกลางของ พอช.)
// ---------------------------------------------------------------------------
function formCss() {
  return `
  /* เลขที่คำขอวางทับมุมขวาบนบนบรรทัดเดียวกับชื่อแบบ ไม่กินบรรทัดของตัวเอง — ที่แนวตั้ง
     ของใบนี้เหลือไม่ถึง 10mm จึงเอาคืนทุกบรรทัดที่เอาคืนได้โดยไม่เสียความหมาย */
  .form-head { position: relative; }
  .form-no { position: absolute; right: 0; top: 0; margin: 0; }
  .form-title { text-align: center; font-size: 1.15em; font-weight: 700; margin: 1mm 0 0; }
  .form-fund { text-align: center; margin: 0 0 2mm; }
  .written-at { text-align: right; }
  .form-para { text-indent: 2.5cm; text-align: left; margin-top: 2mm; }
  /* รายการหมวดสวัสดิการตามแบบ พอช. — เรียงไหลได้ ไม่ล็อกคอลัมน์ เพราะชื่อหมวดยาวไม่เท่ากัน */
  .choices { margin: 1.5mm 0 0; padding-left: 2.5cm; }
  .choices p { margin: 0.6mm 0; }
  /* ตารางรายละเอียดการเดินทาง — ขยายจากข้อ 5 "อื่นๆ" ของแบบต้นฉบับซึ่งมีแค่บรรทัดเดียว
     ⚠️ ข้อยกเว้น "ขนาดตัวอักษร" ตามกติกาโปรเจกต์: 13pt เฉพาะในตาราง เพราะช่องค่าเหลือกว้าง
     ~120mm ถ้าใช้ 14pt ที่อยู่จุดรับซึ่งยาวเป็นปกติ (บ้านเลขที่+หมู่+ตำบล+อำเภอ+จังหวัด
     พร้อมจุดสังเกต) ตัดเป็น 3 บรรทัดแทน 2 ทำให้ใบสูงเกินหน้าเดียว ฟอนต์และ font-size-adjust
     ยังสืบทอดจาก body จึงพิมพ์ออกมาเท่ากันทุกเครื่องเหมือนเดิม
     ⚠️ วัดจริงแล้วใบนี้เหลือที่เผื่อไม่ถึง 10mm — เพิ่มแถวหรือขยาย padding ต้องรัน
     tests/patient-transport-layout.test.mjs ใหม่ทุกครั้ง */
  table { width: 100%; border-collapse: collapse; margin: 1.5mm 0; font-size: 13pt; }
  th, td { border: 1px solid #000; padding: 0.4mm 2mm; vertical-align: top; text-align: left; }
  th { width: 34mm; font-weight: 400; background: #f4f4f4; }
  .evidence { margin-top: 1.5mm; }
  .committee { border: 1px solid #000; padding: 1.5mm 2mm; margin-top: 2.5mm; break-inside: avoid; }
  .committee p { margin: 0.4mm 0; }
  .note-template { margin-top: 1.5mm; font-size: 11pt; color: #333; line-height: 1.2; }`
}

/**
 * ใบคำขอรับสวัสดิการ (รถรับ-ส่งผู้ป่วย)
 *
 * ⚠️ ช่องลงนาม "ผู้ยื่นคำขอ" มี 2 โหมด เหมือนใบอื่นทั้งระบบ ห้ามรวบเป็นโหมดเดียว
 *   online  — ผู้ยื่นล็อกอินยืนยันตัวตนแล้วยื่นเอง (form.signed_by.channel === 'online')
 *             พิมพ์ชื่อบนเส้นเป็นลายมือชื่ออิเล็กทรอนิกส์ พร้อมบรรทัดกำกับเวลาและเลขอ้างอิง
 *   counter — เจ้าหน้าที่คีย์แทนที่เคาน์เตอร์ ต้องเว้นเส้นให้เซ็นด้วยปากกาเสมอ
 *   ⚠️ กองทุนเป็นองค์กรภายนอก อาจมีระเบียบของตนที่ต้องการลายมือชื่อสด — ถ้ากองทุนไม่รับ
 *   ลายมือชื่ออิเล็กทรอนิกส์ ให้ผู้ยื่นเซ็นทับบนใบที่พิมพ์ออกมา ระบบไม่ได้รับรองแทนกองทุน
 */
function formSheet({
  header, form = {}, parent = {}, tenant, referenceNo = '', docDate = '',
}) {
  const orgName = tenant?.name?.trim() || 'หน่วยงาน'
  const signedOnline = form?.signed_by?.channel === 'online'
  const signedStamp = signedOnline ? appointmentText(form?.signed_at) : ''
  const requesterName = textOr(parent?.requester_name)
  const relation = optionLabel(REQUESTER_RELATIONS, form.requester_relation)
  const isSelf = (form.requester_relation ?? 'self') === 'self'

  const appointmentKind = [
    optionLabel(APPOINTMENT_KINDS, form.appointment_kind),
    form.appointment_kind_note,
  ].map(part => String(part ?? '').trim()).filter(Boolean).join(' — ')

  // 8 แถว ไม่ใช่แถวละช่อง — ค่าที่สั้นถูกยุบรวมกับแถวข้างเคียง (ความเกี่ยวข้องไปอยู่กับผู้ประสานงาน
  // ผู้ติดตามไปอยู่กับเที่ยวการเดินทาง) เพราะแถวละ ~7mm ทำให้ใบตกหน้า 2 (วัดจริง 312mm)
  // ⚠️ เพิ่มแถวใหม่ต้องรันเทสต์เลย์เอาต์ก่อนเสมอ
  const rows = [
    ['ผู้ป่วย', [
      textOr(form.patient_name),
      form.patient_age != null && form.patient_age !== '' ? `อายุ ${form.patient_age} ปี` : '',
    ].filter(Boolean).join('  ')],
    ['จุดรับ', [textOr(form.pickup_address), form.pickup_landmark && `(จุดสังเกต ${form.pickup_landmark})`].filter(Boolean).join(' ')],
    // ⚠️ ชื่อช่องต้องจบใน 1 บรรทัดที่ความกว้าง 34mm — "สถานพยาบาลปลายทาง" กับ
    // "ลักษณะการเคลื่อนไหว" ตัด 2 บรรทัดแล้วดันแถวสูงขึ้นแถวละ ~6mm
    ['ปลายทาง', [textOr(form.destination), form.destination_detail].filter(Boolean).join(' ')],
    ['วันเวลานัด', appointmentText(header?.appointment_at)],
    ['ประเภทการนัด', appointmentKind],
    ['การเคลื่อนไหว', optionLabel(MOBILITY_LEVELS, header?.mobility ?? form.mobility)],
    ['การเดินทาง', [
      optionLabel(TRIP_TYPES, form.trip_type),
      `ผู้ติดตาม ${form.companions ?? 0} คน`,
      form.return_note,
    ].filter(Boolean).join(' · ')],
    ['ผู้ประสานงาน', [
      requesterName,
      isSelf ? 'ผู้ป่วยยื่นเอง' : [relation, form.requester_relation_note].filter(Boolean).join(' '),
      parent?.requester_phone && `โทร. ${parent.requester_phone}`,
    ].filter(Boolean).join(' · ')],
  ]

  return `<div class="sheet">
  <div class="form-head">
    <p class="form-no">เลขที่คำขอ ${line(referenceNo, '26mm')}</p>
    <p class="form-title">ใบคำขอรับสวัสดิการ</p>
    <p class="form-fund">${esc(header?.partner_name_snapshot ?? '')}</p>
  </div>

  <!-- แบบต้นฉบับวาง "เขียนที่" กับ "วันที่" คนละบรรทัด แต่ที่แนวตั้งของใบนี้ไม่พอ (วัดจริงแล้ว
       ใบเต็มพอดีหน้า) จึงรวมเป็นบรรทัดเดียวชิดขวา ซึ่งยังอ่านได้ตรงความหมายเดิม -->
  <p class="written-at">${field('เขียนที่', orgOfficeName(tenant), '55mm')}&nbsp;&nbsp;&nbsp;${
    field('วันที่', letterDateText(docDate), '42mm')}</p>

  <p class="kv"><span class="bold">เรื่อง</span>&nbsp;&nbsp;ขอรับสวัสดิการ (ขออนุเคราะห์รถรับ-ส่งผู้ป่วย)</p>
  <p class="kv"><span class="bold">เรียน</span>&nbsp;&nbsp;${esc(header?.recipient_title_snapshot ?? '')}</p>

  <p class="form-para">${field('ข้าพเจ้า', requesterName, '65mm')} ${
    field('สมาชิกกองทุนเลขที่', form.fund_member_no, '32mm')} ${
    field('ที่อยู่', textOr(parent?.requester_address), '80mm')} ${
    field('โทรศัพท์', parent?.requester_phone, '35mm')}${
    form.beneficiary_of_name
      ? ` ในฐานะผู้รับผลประโยชน์ของ <span class="fill-value">${esc(form.beneficiary_of_name)}</span>${
          form.beneficiary_of_member_no ? ` สมาชิกเลขที่ <span class="fill-value">${esc(form.beneficiary_of_member_no)}</span>` : ''}`
      : ''
  } มีความประสงค์ขอรับสวัสดิการจากกองทุน ดังนี้</p>

  <!-- ข้อ 1–4 เป็นหมวดตามแบบตัวอย่างกลางของ พอช. ที่ระบบนี้ไม่ได้รับคำขอ จึงพิมพ์เป็นช่องว่าง
       ไว้ให้กองทุนใช้กับเรื่องอื่นได้ ไม่ตัดออกเพื่อให้ใบยังเทียบกับแบบต้นฉบับได้ -->
  <div class="choices">
    <p>${box()} 1. เสียชีวิต&nbsp;&nbsp;&nbsp;${box()} 2. เยี่ยมไข้&nbsp;&nbsp;&nbsp;${box()} 3. ทุนการศึกษา&nbsp;&nbsp;&nbsp;${box()} 4. รับขวัญบุตร</p>
    <p>${box(true)} 5. อื่นๆ (ระบุ) <span class="fill-value">ขออนุเคราะห์รถรับ-ส่งผู้ป่วย รายละเอียดตามตารางท้ายนี้</span></p>
  </div>

  <table>
${rows.map(([label, value]) => `    <tr><th>${label}</th><td>${value ? esc(value) : '&nbsp;'}</td></tr>`).join('\n')}
  </table>

  <p class="evidence">หลักฐาน&nbsp;&nbsp;${box()} สำเนาบัตรประชาชนผู้ป่วย&nbsp;&nbsp;${box()} ใบนัดแพทย์&nbsp;&nbsp;${box()} อื่นๆ ${line('', '24mm')}</p>

  <div class="sign-block center-row" style="margin-top:3mm">
    ${signRow({
      role: 'ผู้ยื่นคำขอ',
      signed: signedOnline && requesterName ? esc(requesterName) : '',
      below: [signatureName(requesterName)],
    })}
    ${signedOnline
      ? `<p class="signed-note">ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service${
          signedStamp ? ` เมื่อ ${esc(signedStamp)}` : ''}${referenceNo ? ` · เลขอ้างอิง ${esc(referenceNo)}` : ''}</p>`
      : ''}
  </div>

  <!-- ส่วนของกองทุน — ระบบไม่กรอกให้เลยแม้แต่ช่องเดียว คณะกรรมการกองทุนไม่ได้อยู่ในระบบนี้ -->
  <div class="committee">
    <p class="bold">สำหรับคณะกรรมการกองทุน</p>
    <p>ความเห็น ${line('', '135mm')}</p>
    <p>${box()} อนุมัติ&nbsp;&nbsp;&nbsp;${box()} ไม่อนุมัติ เพราะ ${line('', '95mm')}</p>
    <div class="two-col" style="margin-top:3mm">
      <div>${signRow({ width: '44mm', below: ['(...............................................)', 'ประธานคณะกรรมการกองทุน'] })}</div>
      <div>${signRow({ width: '44mm', below: ['(...............................................)', 'เหรัญญิก / พยาน'] })}</div>
    </div>
  </div>

  <p class="note-template">
    จัดทำตามแบบตัวอย่างกลาง "ใบคำขอรับสวัสดิการ" ของสถาบันพัฒนาองค์กรชุมชน (องค์การมหาชน)
    ซึ่งไม่มีหมวดรถรับ-ส่งผู้ป่วย จึงยื่นตามข้อ 5 · หากกองทุนมีแบบของตนเองให้ใช้แบบนั้นแทน
    · การพิจารณาเป็นอำนาจของคณะกรรมการกองทุน มิใช่ของ${esc(orgName)}</p>
  <div class="origin">${esc(govEServiceOriginText(orgName))}</div>
</div>`
}

// ---------------------------------------------------------------------------
// ผู้เรียกใช้
// ---------------------------------------------------------------------------
function page(title, css, body) {
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
${GOV_FONT_LINK}
<style>${sharedCss()}${css}
</style>
</head><body>
${body}
</body></html>`
}

/**
 * ชุดเอกสารส่งกองทุน 2 แผ่น (หนังสือนำส่ง + ใบคำขอ) — ปุ่มเดียวของฝั่งเจ้าหน้าที่
 * พิมพ์ทีเดียวได้ครบชุดที่ต้องเข้าแฟ้มคู่กัน ไม่ต้องกด 2 ปุ่มแล้วลืมใบใดใบหนึ่ง
 */
export function buildPatientTransportPacketHtml(args) {
  return page(
    'หนังสือนำส่งและใบคำขอรับสวัสดิการ (รถรับ-ส่งผู้ป่วย)',
    `${letterCss()}${formCss()}`,
    `${letterSheet(args)}\n${formSheet(args)}`,
  )
}

/**
 * ใบคำขอรับสวัสดิการอย่างเดียว — ใช้ฝั่งประชาชน ซึ่งออกหนังสือนำส่งของ อปท. ไม่ได้
 * (หนังสือนำส่งเป็นหนังสือราชการที่ผู้บริหาร อปท. ลงนาม)
 */
export function buildPatientTransportFormHtml(args) {
  return page(
    'ใบคำขอรับสวัสดิการ (รถรับ-ส่งผู้ป่วย)',
    formCss(),
    formSheet(args),
  )
}
