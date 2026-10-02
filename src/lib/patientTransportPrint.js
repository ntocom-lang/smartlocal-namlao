import { reportPeriod, reportDateLabel } from './patientReportPeriod.js'
// ใบพิมพ์ของคำขอ "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย" — 2 ใบที่ใช้คู่กัน เรียงตามลำดับเรื่อง
//   1. ใบคำขอรถรับ-ส่งผู้ป่วย จากประชาชนถึงนายก อปท. (ผู้ป่วยคนละ 1 ใบ)
//   2. หนังสือนำส่ง (หนังสือภายนอก) จาก อปท. ถึงประธานหน่วยงานผู้จัดรถ ซึ่งแนบใบคำขอไปด้วย
// ⚠️ ลำดับแผ่นตอนพิมพ์ = ลำดับนี้: ใบคำขอทุกใบก่อน หนังสือนำส่งเป็นแผ่นสุดท้าย (เจ้าของระบบสั่ง 2569-10-01
// "ประชาชนแจ้งนายก → นายกส่งต่อกองทุน") เดิมพิมพ์หนังสือนำส่งก่อน ห้ามสลับกลับเองโดยไม่ถาม
// — ประกอบที่ packetBody() จุดเดียว เทสต์ packet-prints-request-before-letter กันไว้
// ⚠️ ใบคำขอเขียนเป็นประโยค ไม่ใช่ตาราง (เจ้าของระบบสั่ง 2569-10-01) — ถ้อยคำอยู่ใน formSheet และถูกล็อกไว้ตัวอักษรต่อ
// ตัวอักษรที่เทสต์ request-form-is-prose-not-table ห้ามเปลี่ยนกลับเป็นตารางหรือแก้ประโยคเองโดยไม่ให้เจ้าของระบบเห็นก่อน
//
// ⚠️ รูปแบบหนังสือภายนอก (ตำแหน่งครุฑ/ช่อง "ที่"/ที่อยู่หัวขวา/คำลงท้าย) คัดจากคู่มืองานสารบรรณ
// ของส่วนราชการที่อ้างระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ อีกทอดหนึ่ง **ยังไม่ได้เปิด
// ตัวบทต้นฉบับยืนยัน** ก่อนใช้กับหนังสือที่ออกจริงต้องให้เจ้าหน้าที่สารบรรณตรวจรูปแบบก่อน
// โดยเฉพาะขนาดครุฑ (ใช้ 3 ซม. ตามที่คู่มือทั่วไประบุสำหรับหนังสือภายนอก ต่างจากบันทึกข้อความ
// ที่ระบบนี้ใช้ 1.5 ซม.) และระยะเยื้องของคำลงท้าย
//
// ⚠️ ใบคำขอรับสวัสดิการ **ไม่ใช่แบบฟอร์มของกองทุนใดกองทุนหนึ่ง** — ลอกโครงจากแบบตัวอย่างกลาง
// "ใบคำขอรับสวัสดิการ" ที่ พอช. เผยแพร่เป็นชุดข้อมูลเปิด (หมวด 1 เสียชีวิต / 2 เยี่ยมไข้ /
// 3 ทุนการศึกษา / 4 รับขวัญบุตร / 5 อื่นๆ) ซึ่งไม่มีหมวดรถรับ-ส่งผู้ป่วย ใบนี้ตัดช่องติ๊กหมวดออก
// เหลือเรื่องรถรับ-ส่งผู้ป่วยเรื่องเดียว เพราะระบบเปิดรับเรื่องนี้เรื่องเดียว (สั่งตัด 2569-09-18)
// กองทุนแต่ละแห่งมีระเบียบและแบบฟอร์มของตนเอง ถ้ากองทุนปลายทางมีแบบของตัวเองต้องใช้แบบนั้นแทน
// (เดิมมีย่อหน้าท้ายใบบอกเรื่องนี้ เจ้าของระบบสั่งลบออก 2569-10-02 — เจ้าหน้าที่ที่ส่งเรื่องเป็นคนรู้เอง
// ว่ากองทุนปลายทางใช้แบบไหน ไม่ต้องพิมพ์บอกบนกระดาษที่ส่งออกไป)
//
// ⚠️ ใบคำขอไม่มีกล่อง "สำหรับคณะกรรมการกองทุน" (ความเห็น / อนุมัติ–ไม่อนุมัติ / ช่องลงนามประธานและเหรัญญิก) แล้ว
// เจ้าของระบบสั่งตัด 2569-10-01: ใบนี้ยื่นต่อนายก เรื่องจบที่นายก ยังไม่ไปถึงกองทุน
// ห้ามใส่กลับเองโดยไม่ถาม — เทสต์ request-form-has-no-fund-committee-box กันไว้
// ประโยค "การพิจารณาเป็นอำนาจของคณะกรรมการกองทุน มิใช่ของ อปท." ตัดออกด้วยเหตุผลเดียวกัน (สั่งวันเดียวกัน)
// และย่อหน้ากำกับที่มาของแบบทั้งย่อหน้าถูกลบตามคำสั่ง 2569-10-02 — เทสต์ form-has-no-template-note กันไว้
//
// ⚠️ การลงชื่อ (เจ้าของระบบสั่ง 2569-10-01)
//   ใบคำขอ       — ชื่อผู้แจ้งอยู่บนเส้นทุกกรณี บรรทัดกำกับบอกตามจริงว่าคำขอเข้ามาทางไหน (ดู formSheet)
//   หนังสือนำส่ง — นายกเซ็นปากกา ระบบพิมพ์ให้แค่ชื่อในวงเล็บ + ตำแหน่ง จากทะเบียนผู้ลงนามกลาง
//                  ห้ามพิมพ์ชื่อนายกเป็นลายมือชื่อ: นายกไม่ได้ทำอะไรในระบบตอนพิมพ์ จะกลายเป็นระบบลงนาม
//                  แทนผู้มีอำนาจบนหนังสือที่ส่งออกนอก อปท. — เทสต์ letter-signer-from-registry-never-auto-signed กันไว้

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText,
  govPageCss, govPagePadding,
} from './govDocStyle.js'
import {
  GOV_SIGN_LINE_W_WIDE, govNameBlank, govSignBlockCss, govSignRow,
} from './govSignBlock.js'
import { orgHeadTitle, orgNameParts, orgOfficeName } from './orgTerms.js'
import { pickupSentence } from './pickupText.js'
import { MONTHS_TH, thaiDateFromDateInput } from './thaiDate.js'
import {
  APPOINTMENT_KINDS, MOBILITY_LEVELS, REQUESTER_RELATIONS, TRIP_TYPES, optionLabel,
} from './patientTransport.js'
import { RETURN_MODES as BOOKING_RETURN_MODES, TRIP_STATUS, thaiDay, monthReportSummary, bookingLetter } from './patientBooking.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

// ช่องกรอก — มีค่าเป็นข้อความ inline ธรรมดา ไม่มีเส้นประใต้ (ต่างจากใบยืมพัสดุ/ใบน้ำประปา)
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

// ช่องลงนามใช้ของกลาง govSignBlock.js — ของเดิมเป็นสำเนาของแบบก่อน PR #142 ที่ให้แกนยืด
// ตามเนื้อหา ทำให้เส้นในแต่ละช่องยาวไม่เท่ากัน (กติกาข้อ 1 ของมาตรฐานห้ามไว้)
const SIGN_LINE_W = '44mm'      // วงเล็บเว้นชื่อผู้ลงนามหนังสือนำส่ง (ค่าเดิมของใบนี้)
const REQUESTER_LINE_W = GOV_SIGN_LINE_W_WIDE  // ช่องผู้ยื่นคำขอกลางใบ

function signatureName(name, width = SIGN_LINE_W) {
  const value = String(name ?? '').trim()
  return value ? `(${esc(value)})` : govNameBlank(width)
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
  /* ช่องที่ระบบกรอกค่าให้แล้วไม่ต้องมีเส้นประ — เส้นประมีไว้ให้เขียนมือ ค่าที่พิมพ์แล้วไม่ต้องเขียนทับ
     (เจ้าของระบบสั่ง 2569-09-18) เส้นประเหลือเฉพาะ .fill-blank ที่ว่างจริง */
  .fill-value { padding: 0 1mm; }
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

${govSignBlockCss()}
  .two-col { display: flex; gap: 8mm; break-inside: avoid; page-break-inside: avoid; }
  .two-col > div { flex: 1 1 0; min-width: 0; }
  /* 10pt: บรรทัดกำกับการลงชื่อผ่านระบบ ต้องอ่านออกแต่ไม่แย่งน้ำหนักกับชื่อผู้ลงนาม */
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 2mm; }
  /* แถบเตือนของหน้าต่างพิมพ์ (ดู signerNotice) — เห็นบนจอเท่านั้น ไม่ลงกระดาษ
     ซ่อนเป็นค่าตั้งต้นแล้วเปิดเฉพาะ screen: ตอนพิมพ์จึงไม่กินที่และไม่ดันหนังสือตกหน้า 2 */
  .screen-note { display: none; }
  @media screen {
    .screen-note {
      display: block; margin: 3mm; padding: 2mm 4mm;
      border: 1px solid #b45309; background: #fef3c7; color: #78350f;
    }
  }`
}

// ---------------------------------------------------------------------------
// หนังสือนำส่ง (หนังสือภายนอก) — แผ่นสุดท้ายของชุดเอกสาร
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
  .letter-no:empty { min-width: 45mm; }
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
  .letter-sign p { text-align: center; }`
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// ที่อยู่มี "<คำนำหน้า><ชื่อ>" อยู่แล้วหรือยัง — ต้องมีคำนำหน้าด้วย "แพร่" ใน "อำเภอเมืองแพร่" จึงไม่นับเป็นจังหวัด
const mentions = (text, prefixes, name) =>
  new RegExp(`(^|\\s)(${prefixes})\\s*${escapeRegExp(name)}(?=\\s|$)`).test(text)

/**
 * บรรทัดที่อยู่ใต้ชื่อสำนักงานบนหัวหนังสือ
 *
 * municipalities.address ของทุก อปท. (ณ 2026-09-24) มีอำเภอ จังหวัด รหัสไปรษณีย์ครบในช่องเดียว
 * ของเดิมเติม "อำเภอ… จังหวัด…" จากช่องแยกต่อท้ายเสมอ หนังสือทุกใบจึงขึ้นซ้ำ (เจ้าของระบบเห็นบน demo)
 * หลักเดียวกับ waterSupplyRequestPrint: ไม่แก้ถ้อยคำที่แอดมินพิมพ์ (ไม่ขยายคำย่อ ต./อ./จ. ไม่ย้ายรหัสไปรษณีย์)
 *  - แอดมินขึ้นบรรทัดเองไว้ → ใช้ตามนั้น
 *  - บรรทัดเดียว → แบ่งก่อน "อำเภอ"/"อ." เป็น 2 บรรทัดตามรูปหนังสือ (เลขที่ หมู่ ตำบล / อำเภอ จังหวัด)
 *  - เติมอำเภอ/จังหวัดจากช่องแยกเฉพาะที่ที่อยู่ยังไม่มี
 */
function senderAddressLines(tenant) {
  const district = String(tenant?.district ?? '').trim().replace(/^(อำเภอ|อ\.)\s*/, '')
  const province = String(tenant?.province ?? '').trim().replace(/^(จังหวัด|จ\.)\s*/, '')
  let lines = String(tenant?.address ?? '').split('\n').map(part => part.trim()).filter(Boolean)
  if (lines.length === 1) {
    const at = lines[0].search(/\s(อำเภอ|อ\.)/)
    if (at > 0) lines = [lines[0].slice(0, at).trim(), lines[0].slice(at).trim()]
  }
  const whole = lines.join(' ')
  const districtText = district && !mentions(whole, 'อำเภอ|อ\\.', district) ? `อำเภอ${district}` : ''
  const provinceText = province && !mentions(whole, 'จังหวัด|จ\\.', province) ? `จังหวัด${province}` : ''
  // ขาดอำเภอ = ที่อยู่จบแค่ตำบล ขึ้นบรรทัดใหม่ · ขาดแค่จังหวัด = ต่อท้ายบรรทัดอำเภอ
  if (districtText || !lines.length) lines.push([districtText, provinceText].filter(Boolean).join(' '))
  else if (provinceText) lines[lines.length - 1] = `${lines[lines.length - 1]} ${provinceText}`
  return lines.filter(Boolean)
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
 * @param {string} [args.referenceNo] เลขอ้างอิงคำขอ (8 ตัวแรกของ request id)
 * @param {string} [args.emblemUrl] URL เต็มของตราครุฑ
 */
function letterSheet({
  header, form = {}, parent = {}, tenant,
  mayor = null, referenceNo = '', emblemUrl = '',
  passengerSummary = '', attachmentCount = 1, attachmentTitle = 'ใบคำขอรถรับ-ส่งผู้ป่วย',
}) {
  const orgName = tenant?.name?.trim() || 'หน่วยงาน'
  const mayorTitle = mayor?.title?.trim() || orgHeadTitle(tenant)
  const senderAddress = senderAddressLines(tenant)
  const letterNo = String(header?.forward_letter_no ?? '').trim()

  const patientName = textOr(form.patient_name, parent?.requester_name)
  const patientAge = form.patient_age != null && form.patient_age !== ''
    ? ` อายุ ${form.patient_age} ปี` : ''
  const destination = [form.destination, form.destination_detail]
    .map(part => String(part ?? '').trim()).filter(Boolean).join(' ')
  const mobility = optionLabel(MOBILITY_LEVELS, header?.mobility ?? form.mobility)
  const consentDate = header?.consent_at
    ? appointmentDateOnly(header.consent_at)
    : appointmentDateOnly(form.consent_at)

  // "ผ่านระบบบริการอิเล็กทรอนิกส์" เขียนได้เฉพาะคำขอที่ผู้ยื่นส่งเข้าระบบเอง — คำขอของระบบจองคิวที่เจ้าหน้าที่
  // รับจองแทน (หรือไม่รู้ช่องทาง) ตัดวลีนี้ออก ไม่เติมคำใหม่ ไม่งั้นหนังสือที่นายกลงนามขัดกับใบคำขอที่แนบ
  // ซึ่งเขียนว่าเจ้าหน้าที่รับจองแทนทางโทรศัพท์ (เจ้าของระบบอนุมัติ 2569-10-01)
  // ชุดเอกสารของคำขอแบบเดิม (channel online/counter) ได้ถ้อยคำเท่าเดิมทุกตัวอักษร
  const viaEService = !['booking', 'booking_staff'].includes(form?.signed_by?.channel)

  // ย่อหน้าแรกให้ข้อมูลเท่าที่ผู้รับต้องใช้ตัดสินใจจัดรถ รายละเอียดที่เหลืออยู่ในใบแนบ
  // (หลัก data minimization — ไม่ยกทุกช่องมาไว้ในหนังสือที่เวียนผ่านหลายมือ)
  const para1 = passengerSummary || `ด้วย ${textOr(parent?.requester_name, 'ผู้ยื่นคำขอ')} ได้ยื่นคำขอต่อ${orgName} `
    + `${viaEService ? 'ผ่านระบบบริการอิเล็กทรอนิกส์ ' : ''}ตามเลขอ้างอิง ${referenceNo || '-'} `
    + `เพื่อขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย สำหรับ ${patientName || '-'}${patientAge} `
    + `ไปยัง ${destination || '-'} ในวันที่ ${appointmentText(header?.appointment_at) || '-'} `
    + `${mobility ? `ลักษณะการเคลื่อนไหวของผู้ป่วย ${mobility} ` : ''}`
    + 'รายละเอียดปรากฏตามสิ่งที่ส่งมาด้วย'

  const para2 = `${orgName}ได้ตรวจสอบคำขอแล้ว เห็นว่าเป็นกรณีที่มิใช่เหตุฉุกเฉิน `
    + `จึงขอความอนุเคราะห์มายังท่าน เพื่อโปรดพิจารณาให้ความช่วยเหลือตามระเบียบของ`
    + `${header?.partner_name_snapshot ?? 'หน่วยงานของท่าน'} และแจ้งผลการพิจารณาให้${orgName}ทราบ `
    + 'เพื่อจะได้แจ้งผู้ยื่นคำขอทราบต่อไป'

  const para3 = 'ทั้งนี้ ผู้ยื่นคำขอได้ให้ความยินยอมเป็นการเฉพาะให้เปิดเผยข้อมูลตามคำขอนี้แก่ท่าน'
    // ไม่พิมพ์รหัสรุ่นข้อความยินยอม (เช่น patient-booking-v1) — เป็นรหัสภายใน ผู้รับหนังสืออ่านไม่รู้เรื่อง
    // เจ้าของระบบสั่งตัด 2026-09-24 · หลักฐานว่ายินยอมกับข้อความรุ่นไหนยังเก็บใน consent_version ของคำขอ
    + `${consentDate ? ` เมื่อวันที่ ${consentDate}` : ''} `
    + 'จึงขอความร่วมมือให้ใช้ข้อมูลดังกล่าวเพื่อการพิจารณาและจัดรถตามคำขอนี้เท่านั้น '
    + `ไม่เปิดเผยต่อบุคคลอื่น และหยุดใช้ข้อมูลเมื่อเสร็จภารกิจ หากผู้ยื่นคำขอถอนความยินยอม ${orgName}`
    + 'จะแจ้งให้ท่านทราบโดยเร็ว'

  return `<div class="sheet">
  <div class="emblem">${emblemUrl
    ? `<img src="${esc(emblemUrl)}" alt="" onerror="this.style.display='none'">`
    : ''}</div>

  <div class="letter-head">
    <p class="letter-no">${letterNo ? field('ที่', letterNo, '45mm') : ''}</p>
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
  <p class="kv kv--wide"><span class="bold">สิ่งที่ส่งมาด้วย</span>&nbsp;&nbsp;${esc(attachmentTitle)}&nbsp;&nbsp;จำนวน ${attachmentCount} ฉบับ</p>

  <p class="body-para">${esc(para1)}</p>
  <p class="body-para">${esc(para2)}</p>
  <p class="body-para">${esc(para3)}</p>
  <p class="closing">จึงเรียนมาเพื่อโปรดพิจารณาให้ความอนุเคราะห์ จะขอบคุณยิ่ง</p>

  <p class="regards">ขอแสดงความนับถือ</p>
  <div class="letter-sign sign-block">
    <p>${signatureName(mayor?.name)}</p>
    <p>${esc(mayorTitle)}</p>
  </div>

  <!-- ⚠️ ไม่มีบล็อก "ส่วนราชการเจ้าของเรื่อง / โทร. / โทรสาร" ท้ายหนังสือ โดยเจตนา — เจ้าของระบบสั่งตัดออก
       2026-09-24 หลังรับทราบว่าเป็นองค์ประกอบของหนังสือภายนอกตามระเบียบงานสารบรรณ (ยังไม่ได้เปิดตัวบทยืนยัน)
       ผู้รับติดต่อกลับได้จากที่อยู่หัวหนังสือ · ห้ามใส่กลับเองโดยไม่ถาม และห้ามเอาเบอร์ของหน่วยงานปลายทาง
       มาใส่ท้ายหนังสือ (เคยกิน 2 บรรทัดจนใบตกหน้า 2) — เทสต์ letter-has-no-owner-block กันไว้ -->

  <div class="origin">${esc(govEServiceOriginText(orgName))}</div>
</div>`
}

// ---------------------------------------------------------------------------
// ใบคำขอรถรับ-ส่งผู้ป่วยถึงนายก อปท. (ปรับจากแบบตัวอย่างกลางของ พอช.) — พิมพ์ก่อนหนังสือนำส่ง
// ---------------------------------------------------------------------------
function formCss() {
  return `
  /* เลขอ้างอิงระบบและวันที่อยู่มุมซ้าย ไม่ใช่เลขทะเบียนรับหนังสือ
     เจ้าของระบบสั่งตัดช่อง "คำขอเลขที่…" 2569-10-02 เพื่อลดช่องกรอกที่ไม่จำเป็น
     11pt เป็นข้อยกเว้นเดิมเฉพาะข้อมูลอ้างอิง เนื้อความใช้มาตรฐานร่วมจาก govDocStyle */
  .request-refs { font-size: 11pt; line-height: 1.4; }
  .request-refs p { margin: 0; }
  .form-title { text-align: center; font-size: 1.15em; font-weight: 700; margin: 5mm 0 1mm; }
  .form-fund { text-align: center; margin: 0 0 5mm; }
  /* เนื้อความเป็นย่อหน้าประโยค ไม่ใช่ตาราง (เจ้าของระบบสั่ง 2569-10-01) — ทุกย่อหน้าใช้ 14pt ตามมาตรฐาน
     ไม่มีข้อยกเว้นขนาดตัวอักษร 13pt ของตารางเดิมแล้ว
     ⚠️ ห้ามเปลี่ยนเป็น text-align: justify — ประโยคไทยยืดได้เฉพาะตรงช่องว่าง บรรทัดที่มีช่องว่างน้อย
     จะถูกยืดเป็นรูโหว่กลางประโยค (เหตุผลเต็มอยู่ที่ waterSupplyRequestPrint.js) */
  .form-para { text-indent: 2.5cm; text-align: left; margin-top: 3mm; }
  .evidence { margin-top: 4mm; }
  .form-closing { margin-top: 4mm; }
  /* คำลงท้ายอยู่กึ่งกลางหน้า แนวเดียวกับช่องลงนามผู้ยื่นที่จัดกลางหน้า (.center-row) */
  .form-regards { text-align: center; margin-top: 6mm; }
  .request-sign { margin-top: 8mm; break-inside: avoid; }
`
}

// ใบแนบคำขอรับสวัสดิการถึงกองทุน แยกจากใบคำขอประชาชนถึงนายกซึ่งยังเป็นแบบประโยค
// ใช้ฟอนต์/ขอบกระดาษและช่องลงนามร่วมเหมือนทุกใบ ไม่ตั้งขนาดฟอนต์ใหม่เฉพาะตาราง
function fundFormCss() {
  return `
  .fund-header { position: relative; }
  .fund-title { text-align: center; font-weight: 700; margin-bottom: 1mm; }
  .fund-reference { position: absolute; top: 0; right: 0; }
  .fund-name { text-align: center; margin-bottom: 2mm; }
  .fund-written { margin-bottom: 2mm; }
  .fund-written-place { display: flex; justify-content: flex-end; align-items: baseline; gap: 1.5mm; max-width: 90mm; margin-left: auto; }
  .fund-written-label, .fund-written-date { white-space: nowrap; }
  .fund-written-office { min-width: 0; text-align: right; overflow-wrap: anywhere; }
  .fund-written-date { text-align: center; margin-top: 3mm; }
  .fund-intro { text-indent: 2.5cm; margin-top: 2mm; }
  .fund-details { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 2mm; }
  .fund-details th, .fund-details td { border: 1px solid #000; padding: 0.7mm 1.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  .fund-details th { width: 32mm; font-weight: normal; }
  .fund-evidence { margin-top: 2mm; }
  .fund-request-sign { margin-top: 3mm; }
  /* ชื่อยาวให้คำต่อท้ายขึ้นบรรทัดใหม่ แกนชื่อและวงเล็บยังใช้ govSignBlock เดิม */
  .fund-request-sign .sign-row { flex-wrap: wrap; }
  .fund-committee { border: 1px solid #000; padding: 2mm; margin-top: 3mm; break-inside: avoid; }
  .fund-opinion { display: inline-block; width: calc(100% - 18mm); border-bottom: 1px dotted #000; }
  .fund-decision-reason { display: inline-block; width: 78mm; border-bottom: 1px dotted #000; }
  .fund-committee .two-col { margin-top: 3mm; }
  `
}

function fundFormSheet({ header, form = {}, parent = {}, tenant, referenceNo = '', docDate = '' }) {
  const requesterName = textOr(parent?.requester_name)
  const fundName = textOr(header?.partner_name_snapshot, 'กองทุนเจ้าของรถ')
  const recipient = textOr(header?.recipient_title_snapshot, `ประธาน${fundName}`)
  const patientName = textOr(form.patient_name, requesterName)
  const patientAge = form.patient_age != null && form.patient_age !== '' ? ` อายุ ${form.patient_age} ปี` : ''
  const destination = [form.destination, form.destination_detail].map(value => textOr(value)).filter(Boolean).join(' ')
  const appointmentKind = form.appointment_kind === 'other' ? textOr(form.appointment_kind_note) : optionLabel(APPOINTMENT_KINDS, form.appointment_kind)
  const relation = form.requester_relation === 'other' ? textOr(form.requester_relation_note) : optionLabel(REQUESTER_RELATIONS, form.requester_relation)
  const travel = [optionLabel(TRIP_TYPES, form.trip_type), `ผู้ติดตาม ${Number(form.companions) || 0} คน`, textOr(form.return_note)].filter(Boolean).join(' · ')
  const coordinator = [requesterName, relation, parent?.requester_phone ? `โทร. ${parent.requester_phone}` : ''].filter(Boolean).join(' · ')
  const rows = [
    ['ผู้ป่วย', patientName + patientAge],
    ['จุดรับ', pickupSentence(form.pickup_address, form.pickup_landmark)],
    ['ปลายทาง', destination],
    ['วันเวลานัด', appointmentText(header?.appointment_at)],
    ['ประเภทการนัด', appointmentKind],
    ['การเคลื่อนไหว', optionLabel(MOBILITY_LEVELS, header?.mobility ?? form.mobility)],
    ['การเดินทาง', travel],
    ['ผู้ประสานงาน', coordinator],
  ]
  return `<div class="sheet fund-form-sheet">
  <div class="fund-header">
    <p class="fund-title">ใบคำขอรับสวัสดิการ</p>
    <p class="fund-reference">เลขที่คำขอ ${esc(referenceNo)}</p>
  </div>
  <p class="fund-name">${esc(fundName)}</p>
  <div class="fund-written">
    <p class="fund-written-place"><span class="fund-written-label">เขียนที่</span><span class="fund-written-office">${esc(orgOfficeName(tenant))}</span></p>
    <p class="fund-written-date">วันที่ ${line(letterDateText(docDate), '36mm')}</p>
  </div>
  <p class="kv"><span class="bold">เรื่อง</span>&nbsp;&nbsp;ขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย</p>
  <p class="kv"><span class="bold">เรียน</span>&nbsp;&nbsp;${esc(recipient)}</p>
  <p class="fund-intro">ข้าพเจ้า ${line(requesterName, REQUESTER_LINE_W)} ${field('สมาชิกกองทุนเลขที่', form.fund_member_no, '32mm')}</p>
  <p>${field('ที่อยู่', parent?.requester_address, '70mm')} ${field('โทรศัพท์', parent?.requester_phone, '30mm')} มีความประสงค์ขอความอนุเคราะห์รถรับ-ส่งผู้ป่วยจากกองทุน รายละเอียดตามตารางท้ายนี้</p>
  <table class="fund-details"><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(value) || '&nbsp;'}</td></tr>`).join('')}</tbody></table>
  <!-- หลักฐานเป็นช่องให้ระบุตามที่กองทุนกำหนด ไม่บังคับแนบหรือเพิ่มการเก็บข้อมูลในระบบ -->
  <p class="fund-evidence">หลักฐาน ${box()} ใบนัดแพทย์ ${box()} อื่นๆ ${line('', '25mm')}</p>
  <div class="sign-block center-row fund-request-sign">${govSignRow({
    width: REQUESTER_LINE_W, grow: true, role: 'ผู้ยื่นคำขอ', signed: requesterName ? esc(requesterName) : '',
    below: [signatureName(requesterName, REQUESTER_LINE_W)],
  })}</div>
  <div class="fund-committee sign-block">
    <p class="bold">สำหรับคณะกรรมการกองทุน</p>
    <p>ความเห็น <span class="fund-opinion">&nbsp;</span></p>
    <p>${box()} อนุมัติ ${box()} ไม่อนุมัติ เพราะ <span class="fund-decision-reason">&nbsp;</span></p>
    <div class="two-col">
      <div>${govSignRow({ below: [govNameBlank(), 'ประธานคณะกรรมการกองทุน'] })}</div>
      <div>${govSignRow({ below: [govNameBlank(), 'เหรัญญิก / พยาน'] })}</div>
    </div>
  </div>
  <p class="origin">${esc(govEServiceOriginText(tenant?.name?.trim() || 'หน่วยงาน'))}</p>
  </div>`
}

/**
 * ใบคำขอรถรับ-ส่งผู้ป่วย ยื่นต่อ อปท. เพื่อประสานกองทุนเจ้าของรถ
 *
 * ช่องลงนาม "ผู้ยื่นคำขอ" — ใบนี้ **พิมพ์ชื่อผู้ยื่นบนเส้นทุกกรณี** (เจ้าของระบบสั่ง 2569-09-10)
 * ต่างจากใบอื่นในระบบที่เว้นเส้นไว้เมื่อเจ้าหน้าที่คีย์แทน เหตุผลคือใบนี้ไม่ได้เป็นหลักฐาน
 * ผูกพันความรับผิดของผู้ยื่น แต่เป็นใบขอความอนุเคราะห์ถึงนายก ชื่อบนเส้นจึงทำ
 * หน้าที่ระบุตัวผู้ขอ ไม่ใช่การรับรองว่าลงลายมือชื่อแล้ว
 *
 * ⚠️ ใต้ชื่อผู้ยื่น **ไม่มีบรรทัดกำกับ ทุกช่องทาง** (form.signed_by.channel) — เจ้าของระบบสั่งตัด 2569-10-02
 *   เลือกแบบ ข "ตัดทุกแบบ" หลังรับทราบผลแล้ว ต่อจากที่ตัดบรรทัดของใบที่ยื่นออนไลน์ไปก่อนหน้า (#376)
 *   เดิมมี: ยื่นออนไลน์ "ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service เมื่อ…" (ตัดแล้วใน #376) · เจ้าหน้าที่รับจองแทนทางโทรศัพท์
 *   "เจ้าหน้าที่รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์ เมื่อ…" · เจ้าหน้าที่คีย์แทนที่เคาน์เตอร์ (ระบบคำขอแบบเดิม) "…โปรดลงลายมือชื่อ
 *   รับรองทับชื่อข้างต้น" · ไม่รู้ช่องทาง "จัดทำจากข้อมูลการจองรถ…" — 3 แบบหลังตัดในงานนี้
 *   ผลที่เจ้าของระบบรับทราบก่อนสั่ง: กระดาษไม่บอกว่าชื่อบนเส้นเป็นการลงชื่อผ่านระบบหรือเจ้าหน้าที่รับจองแทน ไม่บอกเวลา และใบที่
 *   เจ้าหน้าที่รับจองแทนหน้าตาเหมือนใบที่ผู้แจ้งยื่นเอง · ใครยื่น/รับจองแทนเมื่อไร ดูได้ที่ "ประวัติการดำเนินการ" ในระบบ
 *   สถานะทางกฎหมายของชื่อพิมพ์แทนลายมือชื่อ ยังไม่ได้เปิดตัวบทยืนยัน (ต้องยืนยันกับกฎหมายธุรกรรมทางอิเล็กทรอนิกส์ฉบับปัจจุบัน)
 *   ห้ามใส่บรรทัดกำกับกลับเองโดยไม่ถาม — เทสต์ request-form-has-no-signed-note กันไว้
 *   ช่องทางของคำขอยังส่งมาเหมือนเดิม: หนังสือนำส่งใช้เลือกวลี "ผ่านระบบบริการอิเล็กทรอนิกส์" (letterSheet)
 *
 * ⚠️ ท้ายใบ **ไม่มีบรรทัดที่มา** ("ผ่านระบบ E-Service <อปท.> · เลขอ้างอิง …") โดยเจตนา — เจ้าของระบบสั่งเก็บไว้ที่เดียวคือ
 *   ใต้ชื่อแบบ (.form-fund) แล้วลบท้ายใบ 2569-10-02 (แบบ ก) เพราะพิมพ์ซ้ำ 2 ครั้ง · เลขอ้างอิงที่เคยต่อท้ายบรรทัดนั้นอยู่ที่
 *   มุมซ้ายบน ("คำขอผ่าน E-Service <เลขอ้างอิง>") ทุกช่องทางอยู่แล้ว จึงไม่สูญเสียข้อมูลที่ใช้ค้นเรื่องกลับ
 *   ห้ามใส่บรรทัดท้ายใบกลับเองโดยไม่ถาม — เทสต์ request-form-has-no-signed-note กันไว้
 *
 * ⚠️ กองทุนเป็นองค์กรภายนอก อาจมีระเบียบของตนที่ต้องการลายมือชื่อสด — ถ้ากองทุนไม่รับ
 * ชื่อพิมพ์ ให้ผู้ยื่นเซ็นทับบนใบที่พิมพ์ออกมา ระบบไม่ได้รับรองแทนกองทุน
 */
function formSheet({
  header, form = {}, parent = {}, tenant, referenceNo = '', docDate = '',
}) {
  const orgName = tenant?.name?.trim() || 'หน่วยงาน'
  const requesterName = textOr(parent?.requester_name)
  const isSelf = (form.requester_relation ?? 'self') === 'self'

  // ── เนื้อความเป็นประโยค ไม่ใช่ตาราง (เจ้าของระบบสั่ง 2569-10-01 "ไม่ต้องใช้แบบตาราง ให้เป็นประโยคดีกว่า") ──
  // ข้อมูลชุดเดียวกับตารางเดิมทุกรายการ เรียงเป็น 2 ย่อหน้า: (1) ใครขออะไรให้ใคร (2) นัดที่ไหน เมื่อไร รับที่ไหน เดินทางอย่างไร
  // กติกาของประโยค
  //  - ข้อมูลหลักที่ประโยคขาดไม่ได้ (ชื่อผู้ป่วย ปลายทาง วันเวลานัด จุดรับ) ใช้ line(): มีค่า = พิมพ์ค่า ไม่มี = เส้นประให้เขียนมือ
  //  - ข้อมูลเสริมที่ระบบไม่มี (ที่อยู่ผู้ยื่น อายุ ประเภทการนัด จุดสังเกต ความเกี่ยวข้อง) ตัดทั้งวลีออก ไม่ทิ้งป้ายลอยอย่าง
  //    "อายุ  ปี" หรือ "ที่อยู่ ......" ไว้ — คำขอจากระบบจองคิวไม่ได้เก็บช่องเหล่านี้ และไม่มีใครมาเขียนเติมบนใบที่ลงชื่อออนไลน์
  //    ⚠️ ห้ามเอาจุดรับไปเติมเป็นที่อยู่ผู้ยื่น — ผู้จองแทนไม่ได้อยู่บ้านเดียวกับผู้ป่วยเสมอไป
  //  - ผู้ป่วยยื่นเองใช้ "ข้าพเจ้า" ตลอดทั้งใบ ยื่นแทนใช้ "ผู้ป่วย" — ไม่งั้นใบที่ผู้ป่วยเขียนเองอ่านเหมือนพูดถึงคนอื่น
  //  - คำที่ห้ามขาดกลางบรรทัดครอบด้วย .nb: ตัวตัดคำภาษาไทยของเบราว์เซอร์แยก "ผู้|ป่วย" "มี|ความประสงค์" และ
  //    คำนำหน้ากับชื่อ ("นาง|สมศรี") ได้ ซึ่งในตารางไม่เคยเห็นเพราะแต่ละช่องสั้น พอเป็นประโยคยาวจะขาดกลางคำจริง
  const clean = raw => String(raw ?? '').trim()
  const nb = html => `<span class="nb">${html}</span>`
  // ชื่อคน: ตัดบรรทัดได้เฉพาะตรงช่องว่างระหว่างชื่อกับนามสกุล ไม่มีชื่อ = เส้นประให้เขียนมือ
  const personName = (raw, width) => (clean(raw)
    ? `<span class="fill-value">${clean(raw).split(/\s+/).map(word => nb(esc(word))).join(' ')}</span>`
    : line('', width))
  const PATIENT = nb('ผู้ป่วย')
  // ผู้ป่วยยื่นเอง = "ข้าพเจ้า" คือผู้ป่วย — แต่ถ้าชื่อผู้ป่วยในคำขอไม่ตรงกับชื่อผู้ยื่น (ข้อมูลขัดกัน) ต้องพิมพ์ชื่อผู้ป่วยแยก
  // ไม่งั้นชื่อผู้ป่วยหายไปจากใบทั้งใบ (ตารางเดิมมีแถว "ผู้ป่วย" ของตัวเองเสมอ)
  const sameName = (a, b) => clean(a).replace(/\s+/g, ' ') === clean(b).replace(/\s+/g, ' ')
  const selfPatient = isSelf && (!clean(form.patient_name) || sameName(form.patient_name, requesterName))
  const who = selfPatient ? 'ข้าพเจ้า' : PATIENT

  // ความเกี่ยวข้องกับผู้ป่วย — "อื่นๆ" ใช้ข้อความที่ผู้ยื่นระบุเอง ไม่พิมพ์คำว่า "อื่นๆ" ลงในประโยค
  const relationNote = clean(form.requester_relation_note)
  const relationText = isSelf ? ''
    : form.requester_relation === 'other' ? relationNote
    : [optionLabel(REQUESTER_RELATIONS, form.requester_relation), relationNote && `(${relationNote})`].filter(Boolean).join(' ')
  const age = form.patient_age != null && form.patient_age !== '' ? ` อายุ ${esc(form.patient_age)} ปี` : ''

  // ประเภทการนัด — "อื่นๆ" ใช้ข้อความที่ระบุเองเช่นกัน · ระบบจองคิวไม่ได้เก็บช่องนี้ จึงไม่มีวลีนี้ในใบ
  const kindNote = clean(form.appointment_kind_note)
  const purpose = form.appointment_kind === 'other' ? kindNote
    : [optionLabel(APPOINTMENT_KINDS, form.appointment_kind), kindNote].filter(Boolean).join(' ')
  const destination = [form.destination, form.destination_detail].map(clean).filter(Boolean).join(' ')
  const landmark = clean(form.pickup_landmark)
  const mobility = optionLabel(MOBILITY_LEVELS, header?.mobility ?? form.mobility)
  const companions = Number(form.companions) || 0
  const tripLabel = optionLabel(TRIP_TYPES, form.trip_type)
  // ระบบจองคิวส่ง "ขาไปอย่างเดียว" มาทั้งสองช่อง — ไม่พิมพ์ซ้ำในวงเล็บ
  const returnNote = clean(form.return_note) === tripLabel ? '' : clean(form.return_note)
  // เวลา "14.00 น." ในข้อความที่ผู้ยื่นพิมพ์เอง ห้ามขาดคนละบรรทัดระหว่างตัวเลขกับ "น." (รับ html ที่ escape แล้ว)
  const keepTimes = html => html.replace(/\d{1,2}[.:]\d{2}\s?น\./g, time => nb(time))
  // ขากลับของระบบจองคิวเป็นป้ายสั้น ("รอรับกลับ") ทั้งวงเล็บต้องอยู่บรรทัดเดียว — ข้อความยาวที่พิมพ์เองตัดบรรทัดได้ตามปกติ
  const returnText = !returnNote ? ''
    : returnNote.length <= 20 ? ` ${nb(`(${esc(returnNote)})`)}` : ` (${keepTimes(esc(returnNote))})`

  const requestPara = [
    `ข้าพเจ้า ${personName(requesterName, '65mm')}`,
    form.fund_member_no && field('สมาชิกกองทุนเลขที่', form.fund_member_no, '32mm'),
    clean(parent?.requester_address) && field('ที่อยู่', parent.requester_address, '80mm'),
    clean(parent?.requester_phone) && `โทรศัพท์ <span class="fill-value">${nb(esc(clean(parent.requester_phone)))}</span>`,
    form.beneficiary_of_name && `ในฐานะผู้รับผลประโยชน์ของ ${personName(form.beneficiary_of_name)}${
      form.beneficiary_of_member_no ? ` สมาชิกเลขที่ <span class="fill-value">${esc(form.beneficiary_of_member_no)}</span>` : ''}`,
    // วงเล็บท้ายความเกี่ยวข้อง ("ญาติ (บุตรสาว)") ต้องเว้นวรรคก่อน "ของผู้ป่วย"
    relationText && `เป็น${esc(relationText)}${relationText.endsWith(')') ? ' ' : ''}ของ${PATIENT}`,
    `${nb('มีความประสงค์')}ขอให้${esc(orgName)}ประสานขอความอนุเคราะห์${nb('รถรับ-ส่งผู้ป่วย')}จาก${esc(header?.partner_name_snapshot || 'กองทุนเจ้าของรถ')}`,
    selfPatient ? `สำหรับข้าพเจ้าซึ่งเป็น${nb('ผู้ป่วยเอง')}${age}` : `สำหรับ ${personName(form.patient_name, '65mm')}${age}`,
  ].filter(Boolean).join(' ')

  // วันเวลานัดไม่ตัดบรรทัดกลางค่า — "5 ตุลาคม 2569 เวลา" ท้ายบรรทัดแล้ว "08.00 น." ไปอยู่บรรทัดใหม่ อ่านพลาดง่าย
  const appointment = appointmentText(header?.appointment_at)
  const travelPara = [
    `${who}มีนัดที่ ${line(destination, '70mm')} ในวันที่ ${
      appointment ? `<span class="fill-value nb">${esc(appointment)}</span>` : line('', '55mm')}`,
    purpose && `เพื่อ${keepTimes(esc(purpose))}`,
    // pickupSentence ตัดส่วนที่แทรกมา (ชื่ออังกฤษ รหัสทางหลวง จุลภาค " · ") ให้อ่านเป็นประโยคไทย — ดู pickupText.js
    `จึงขอให้รถมารับที่ ${line(pickupSentence(form.pickup_address), '80mm')}${landmark ? ` (${nb('จุดสังเกต')} ${esc(landmark)})` : ''}`,
    // เงื่อนไขการเดินทางต่อด้วย "โดย" ให้อ่านเป็นประโยคเดียวกับคำขอให้มารับ ไม่ใช่ข้อความลอยต่อท้าย
    `โดย${[mobility && `${who}${esc(mobility)}`, companions > 0 ? `มีผู้ติดตาม ${companions} คน` : 'ไม่มีผู้ติดตาม']
      .filter(Boolean).join(' ')}`,
    tripLabel && `และขอเดินทาง${nb(esc(tripLabel))}${returnText}`,
  ].filter(Boolean).join(' ')

  return `<div class="sheet">
  <!-- ⚠️ ไม่มีบรรทัด "เขียนที่" โดยเจตนา — เจ้าของระบบสั่งใช้หัวใบแบบเดียวกับใบคำร้อง 2569-10-02 (วันที่ย้ายมาเป็น "ลงวันที่"
       ใต้เลขอ้างอิง) ห้ามใส่กลับเองโดยไม่ถาม — เทสต์ form-header-follows-complaint-layout กันไว้ -->
  <div class="request-refs">
    <div>
      <p class="form-no">คำขอผ่าน E-Service ${line(referenceNo, '26mm')}</p>
      <p class="form-date">ลงวันที่ ${line(letterDateText(docDate), '36mm')}</p>
    </div>
  </div>
  <p class="form-title">ใบคำขอรถรับ-ส่งผู้ป่วย</p>
  <p class="form-fund">${esc(govEServiceOriginText(orgName))}</p>

  <p class="kv"><span class="bold">เรื่อง</span>&nbsp;&nbsp;ขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย</p>
  <p class="kv"><span class="bold">เรียน</span>&nbsp;&nbsp;${esc(orgHeadTitle(tenant))}</p>

  <p class="form-para form-request">${requestPara}</p>
  <!-- ⚠️ ไม่พิมพ์ช่องติ๊กหมวด 1–5 ของแบบ พอช. (เสียชีวิต/เยี่ยมไข้/ทุนการศึกษา/รับขวัญบุตร/อื่นๆ)
       เจ้าของระบบสั่งตัดออก 2569-09-18 เพราะระบบเปิดรับเรื่องรถรับ-ส่งผู้ป่วยเรื่องเดียว
       ช่องหมวดอื่นทำให้ผู้อ่านเข้าใจว่ายื่นเรื่องอื่นผ่านระบบได้ เปิดหมวดใหม่เมื่อไรค่อยคิดใหม่ -->
  <!-- ⚠️ ไม่มีตารางรายละเอียด โดยเจตนา — เจ้าของระบบสั่ง 2569-10-01 ให้เขียนเป็นประโยค ห้ามเปลี่ยนกลับเป็นตารางเองโดยไม่ถาม
       เทสต์ request-form-is-prose-not-table กันไว้ -->
  <p class="form-para form-travel">${travelPara}</p>

  <!-- รายการติ๊กด้วยปากกา ไม่ใช่ประโยค จึงชิดซ้ายไม่ย่อหน้า — ย่อหน้า 2.5 ซม. แล้วเส้น "อื่นๆ" ตกไปอยู่บรรทัดใหม่ลอยๆ
       ⚠️ ไม่มีช่อง "สำเนาบัตรประชาชนผู้ป่วย" โดยเจตนา — เจ้าของระบบสั่งตัดออก 2569-10-02 เหลือ ใบนัดแพทย์ กับ อื่นๆ
       ห้ามใส่กลับเองโดยไม่ถาม — เทสต์ evidence-line-has-no-id-copy กันไว้ -->
  <p class="evidence">หลักฐาน&nbsp;&nbsp;${box()} ใบนัดแพทย์&nbsp;&nbsp;${box()} อื่นๆ ${line('', '24mm')}</p>

  <!-- คำลงท้ายแบบเดียวกับแบบคำร้องใบอื่นของระบบที่ประชาชนยื่นต่อนายก (ใบขอรับการช่วยเหลือ ใบเก็บขนขยะ) -->
  <p class="form-para form-closing">จึงเรียนมาเพื่อโปรดพิจารณาให้ความอนุเคราะห์</p>
  <p class="form-regards">ขอแสดงความนับถือ</p>

  <div class="sign-block center-row request-sign">
    ${govSignRow({
      width: REQUESTER_LINE_W,
      // grow: ช่องเดี่ยวที่มีคำต่อท้าย ชื่อยาวกว่าแกนต้องดันคำต่อท้ายออก ไม่ใช่พิมพ์ทับ
      grow: true,
      role: 'ผู้ยื่นคำขอ',
      // พิมพ์ชื่อบนเส้นทุกกรณี — ไม่มีชื่อจริงๆ (คำขอเก่าที่ไม่ได้กรอก) จึงตกไปเป็นเส้นให้เขียนมือ
      signed: requesterName ? esc(requesterName) : '',
      below: [signatureName(requesterName, REQUESTER_LINE_W)],
    })}
    <!-- ⚠️ ใต้ชื่อไม่มีบรรทัดกำกับ ทุกช่องทาง — เจ้าของระบบสั่งตัด 2569-10-02 ดูคำอธิบายหัวฟังก์ชัน -->
  </div>

  <!-- ⚠️ ไม่มีกล่อง "สำหรับคณะกรรมการกองทุน" (ความเห็น / อนุมัติ–ไม่อนุมัติ / ช่องลงนามประธานและเหรัญญิก) โดยเจตนา —
       เจ้าของระบบสั่งตัดออก 2569-10-01 เพราะใบนี้ยื่นต่อนายก เรื่องจบที่นายก ยังไม่ไปถึงกองทุน
       ห้ามใส่กลับเองโดยไม่ถาม — เทสต์ request-form-has-no-fund-committee-box กันไว้

       ⚠️ ท้ายใบจบที่ช่องลงชื่อ ไม่มีย่อหน้าอื่นต่อท้าย — เจ้าของระบบสั่งลบย่อหน้าที่บอกว่าลอกโครงมาจากแบบตัวอย่างกลาง
       ของ พอช. และให้ใช้แบบของกองทุนถ้ากองทุนมีแบบของตนเอง ออกจากทุกใบ 2569-10-02 (ย่อหน้ายาวกินที่และไม่ใช่ข้อความ
       ที่ผู้รับต้องอ่าน) · และลบบรรทัดที่มา "ผ่านระบบ E-Service <อปท.>" ท้ายใบ เหลือที่เดียวใต้ชื่อแบบ (ดูหัวฟังก์ชัน)
       ห้ามใส่กลับเองโดยไม่ถาม — เทสต์ pdpa-note-present-and-form-has-no-template-note กันไว้ -->
</div>`
}

// ---------------------------------------------------------------------------
// ผู้เรียกใช้
// ---------------------------------------------------------------------------
function page(title, css, body) {
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${GOV_FONT_LINK}
<style>${sharedCss()}${css}
/* อยู่กับ viewport แม้เลื่อนดูเอกสารหลายหน้า และไม่เปลี่ยน layout ของกระดาษ */
.print-window-tools { position: fixed; top: 8px; right: 12px; z-index: 100; }
.print-window-close { min-height: 44px; padding: 8px 16px; border: 1px solid #a8b9cc;
  border-radius: 10px; background: #fff; color: #16324f; font: inherit; font-weight: 700;
  cursor: pointer; box-shadow: 0 2px 8px #16324f26; }
.print-window-close:focus-visible { outline: 3px solid #0284c7; outline-offset: 2px; }
@media print { .print-window-tools { display: none !important; } }
</style>
</head><body>
${body}
<div class="print-window-tools"><button type="button" class="print-window-close" onclick="window.close()"><span aria-hidden="true">×</span> ปิดหน้าต่าง</button></div>
</body></html>`
}

// หน้าต่างเปิดก่อนดึงข้อมูล เพื่อไม่โดน popup blocker; ปิดได้ทันทีระหว่างรอเครือข่าย
export function buildPatientPrintLoadingHtml() {
  return page('กำลังเตรียมเอกสาร', '.print-loading { padding: 72px 24px 24px; }', '<p class="print-loading" role="status">กำลังเตรียมเอกสาร...</p>')
}

// เติมเอกสารลงหน้าต่างที่เปิดไว้แล้ว และเด้งหน้าต่างพิมพ์ของเบราว์เซอร์ให้เอง เหมือนปุ่มพิมพ์ทุกจุดในระบบ
// (หน้าคำร้อง/ใบคำขอฝั่งประชาชน) — เจ้าของระบบแจ้ง 2569-10-02 ว่ากดพิมพ์ใบคำขอรถรับ-ส่งฝั่งเจ้าหน้าที่แล้วหน้าต่างพิมพ์ไม่เด้ง
// หน่วงไว้ให้ฟอนต์ราชการโหลดก่อน ไม่งั้นตัวอย่างก่อนพิมพ์ขึ้นฟอนต์สำรองแล้วขนาดเพี้ยน (ค่า 400ms เท่าปุ่มพิมพ์จุดอื่น)
// ไม่พิมพ์ถ้าเจ้าหน้าที่ปิดหน้าต่างระหว่างรอไปแล้ว — ปุ่ม "ปิดหน้าต่าง" ในเอกสารมีไว้ให้ปิดได้ทุกเมื่อ
export const PRINT_DIALOG_DELAY_MS = 400
export function writeAndPrint(win, html, delayMs = PRINT_DIALOG_DELAY_MS) {
  win.document.open()
  win.document.write(html)
  win.document.close()
  setTimeout(() => {
    if (win.closed) return
    win.focus()
    win.print()
  }, delayMs)
}

// แถบเตือนบนจอของหน้าต่างพิมพ์ (ไม่ลงกระดาษ) — ชื่อนายกในวงเล็บของหนังสือนำส่งมาจากทะเบียนผู้ลงนามกลาง
// ยังไม่ได้ตั้ง = เว้นวงเล็บว่าง ห้ามเดาชื่อแทน แต่ต้องบอกคนพิมพ์ว่าทำไมว่างและไปตั้งที่ไหน
// (เดิมออกเป็นจุดไข่ปลาเงียบ ๆ เจ้าหน้าที่ไม่รู้ว่าต้องทำอะไร — เจ้าของระบบสั่ง 2569-10-01)
// อยู่ในตัวเอกสาร ไม่ใช่ในหน้าจอเจ้าหน้าที่ เพราะปุ่มพิมพ์มี 3 จุด ทุกจุดต้องเห็นเหมือนกัน
function signerNotice(mayor) {
  if (String(mayor?.name ?? '').trim()) return ''
  return '<div class="screen-note">ยังไม่ได้ตั้งชื่อนายกในเมนู “ผู้ลงนามเอกสาร” หนังสือนำส่งจึงเว้นวงเล็บว่างไว้ให้เขียนชื่อเอง'
    + ' · ผู้ดูแลระบบตั้งได้ที่ แผงควบคุมแอดมิน &gt; ผู้ลงนามเอกสาร (ข้อความนี้ไม่ถูกพิมพ์)</div>\n'
}

// ลำดับแผ่นของชุดเอกสาร: ใบคำขอ (ประชาชน → นายก) ทุกใบก่อน แล้วปิดท้ายด้วยหนังสือนำส่ง (นายก → กองทุน)
// เจ้าของระบบสั่ง 2569-10-01 ให้เรียงตามลำดับเรื่อง — ทั้งสองทางที่พิมพ์ชุดเอกสารต้องประกอบผ่านฟังก์ชันนี้
// แถบเตือนชื่อนายกอยู่บนสุดของหน้าต่างเสมอ ไม่ย้ายตามหนังสือไปท้ายชุด: คนพิมพ์ต้องเห็นทันทีที่หน้าต่างเปิด
function packetBody(mayor, letter, forms) {
  return signerNotice(mayor) + [...forms, letter].join('\n')
}

/**
 * ตัวประกอบชุดเดิมคงไว้สำหรับผู้เรียกเดิมและการตรวจความตรงกันของเนื้อหา
 * หน้าจอเจ้าหน้าที่ใช้ buildPatientTransportFormHtml / buildPatientTransportLetterHtml แยกแล้ว
 */
export function buildPatientTransportPacketHtml(args) {
  return page(
    'ใบคำขอถึงนายกและหนังสือนำส่งกองทุน (รถรับ-ส่งผู้ป่วย)',
    `${letterCss()}${formCss()}`,
    packetBody(args.mayor, letterSheet(args), [formSheet(args)]),
  )
}

/**
 * ใบคำขอถึงนายกอย่างเดียว — ใช้ฝั่งประชาชน ซึ่งออกหนังสือนำส่งของ อปท. ไม่ได้
 * (หนังสือนำส่งเป็นหนังสือราชการที่ผู้บริหาร อปท. ลงนาม)
 */
export function buildPatientTransportFormHtml(args) {
  return page(
    'ใบคำขอรถรับ-ส่งผู้ป่วยถึงนายก อปท.',
    formCss(),
    formSheet(args),
  )
}

// ชุดถึงกองทุนตามภาพที่เจ้าของระบบให้: หนังสือนายก 1 แผ่น + ใบคำขอรับสวัสดิการแนบ 1 แผ่น
// ใบคำขอประชาชนถึงนายกยังพิมพ์จากปุ่มแรกต่างหาก ไม่ใช้แทนใบแนบถึงกองทุน
export function buildPatientTransportLetterHtml(args) {
  return page(
    'หนังสือขอความอนุเคราะห์รถรับ-ส่งผู้ป่วยพร้อมใบคำขอรับสวัสดิการ (2 แผ่น)',
    `${letterCss()}${fundFormCss()}`,
    signerNotice(args.mayor) + letterSheet({ ...args, attachmentTitle: 'ใบคำขอรับสวัสดิการ (รถรับ-ส่งผู้ป่วย)' }) + fundFormSheet(args),
  )
}

// ---------------------------------------------------------------------------
// ระบบจองคิวรถ: ใบคำขอ + หนังสือนำส่งกองทุน "แยกรายคน" (เจ้าของระบบสั่ง 2569-10-02 เลือกแบบ ข: ผู้เดินทางแต่ละคน
// พิมพ์ชุดของตัวเอง เลขที่หนังสือคนละเลข เก็บที่ patient_bookings.forward_letter_no — ดู bookingLetter ใน patientBooking.js)
// หน้าจอเจ้าหน้าที่เรียก buildBookingRequestFormHtml / buildBookingForwardLetterHtml ด้วยคำขอเดียว เพื่อพิมพ์คนละประเภท
// buildTripForwardLetterHtml คงไว้ตรวจความตรงกันกับชุดเดิม แต่ไม่มีปุ่มหน้าจอเรียกพิมพ์ชุดรวมแล้ว
// ข้อมูลที่การจองไม่ได้เก็บ (อายุ/สมาชิก/ประเภทนัด/ที่อยู่ผู้ยื่น) เว้นว่าง ห้ามเดาจากจุดรับ
// บรรทัดกำกับใต้ชื่อผู้ยื่นตามช่องทางที่คำขอเข้ามา (patient_bookings.entry_channel) — ระบุว่าลงชื่อออนไลน์
// เฉพาะคำขอที่ผู้จองล็อกอินยื่นเอง คำขอที่เจ้าหน้าที่รับจองแทนบอกตามจริงว่ารับจองแทน (ดู formSheet)
// หน้าจอเจ้าหน้าที่ (BookingInbox) ยังนับผู้เดินทางในเที่ยวด้วยตัวกรองเดียวกัน
export function tripPassengers(bookings, trip) {
  return (bookings ?? [])
    .filter(b => b.trip_id === trip?.id && ['confirmed', 'completed'].includes(b.status))
    .sort((a, b) => String(a.appointment_at).localeCompare(String(b.appointment_at)))
}

// ข้อมูลของคำขอ 1 ใบสำหรับ formSheet/letterSheet — แหล่งเดียวของทั้งชุดต่อเที่ยว (หลังยืนยันรถ มี trip)
// และใบคำขอเดี่ยวตอนรอยืนยันรถ (trip = null) ใบที่พิมพ์ก่อนยืนยันจึงตรงกับใบในชุดของเที่ยวทุกตัวอักษร
function bookingPacket(args, b, trip) {
  const { partner } = args
  // ⚠️ เทียบค่าตรงตัวทั้งสองทาง ห้ามเขียน "ไม่ใช่ staff = online" — ค่าที่ไม่รู้จักหรือไม่มี ต้องตกไป
  // 'booking' ที่ไม่อ้างอะไรเลย (กติกาเดียวกับทุกใบ: อ้างว่าลงชื่อออนไลน์ได้เมื่อรู้แน่เท่านั้น)
  const channel = b.entry_channel === 'online' ? 'online'
    : b.entry_channel === 'staff' ? 'booking_staff' : 'booking'
  const letter = bookingLetter(b, trip)
  return {
    ...args,
    referenceNo: String(b.id).slice(0, 8).toUpperCase(),
    docDate: b.created_at ? thaiDay(b.created_at) : '',
    header: {
      // เลขของคำขอเอง ไม่มีค่อยใช้เลขของเที่ยว (เที่ยวเก่า) — ว่างได้ ช่อง "ที่" เว้นเส้นประให้เขียนมือ
      forward_letter_no: letter.no || null, forward_letter_date: letter.date || null,
      partner_name_snapshot: textOr(partner?.name, 'กองทุนเจ้าของรถ'),
      recipient_title_snapshot: textOr(partner?.recipient_title, `ประธาน${textOr(partner?.name, 'กองทุนเจ้าของรถ')}`),
      appointment_at: b.appointment_at, mobility: b.mobility,
      consent_at: b.consent_at,
    },
    parent: { requester_name: b.requester_name, requester_phone: b.phone },
    form: {
      patient_name: b.patient_name, pickup_address: b.pickup,
      destination: b.route_label || trip?.plan?.route_label,
      requester_relation: b.relation, companions: b.companions,
      trip_type: b.return_mode === 'one_way' ? 'one_way' : 'round_trip',
      return_note: BOOKING_RETURN_MODES[b.return_mode],
      // created_at = เวลาที่คำขอถูกส่งเข้าระบบ: ผู้จองส่งเอง (online) หรือเจ้าหน้าที่กดบันทึกแทน (staff)
      signed_by: { channel }, signed_at: channel === 'booking' ? null : b.created_at,
    },
  }
}

/**
 * ใบคำขอถึงนายกของคำขอเดียวในระบบจองคิว — พิมพ์ได้ตั้งแต่ยังรอยืนยันรถ
 * เจ้าของระบบสั่ง 2569-10-02 ("รอยืนยันรถ เพิ่มปุ่มพิมพ์ให้ด้วย พิมพ์ในส่วนที่พิมพ์ได้" · เลือกแบบ ก)
 * ยังไม่มีเที่ยว = ยังไม่มีหนังสือนำส่งถึงกองทุน (ไม่มีวันเวลารถและเลขหนังสือ) จึงออกแค่ใบคำขอ ประชาชน → นายก
 * หลังยืนยันรถยังพิมพ์ใบคำขอแยกได้ ใช้เที่ยวปัจจุบันเป็นข้อมูลสำรองเหมือนใบในชุดเดิม
 */
export function buildBookingRequestFormHtml(args) {
  if (!args?.booking) throw new Error('ไม่พบคำขอสำหรับพิมพ์')
  return page(
    'ใบคำขอรถรับ-ส่งผู้ป่วยถึงนายก อปท.',
    formCss(),
    (args.booking.status === 'submitted'
      ? '<div class="screen-note">ยังไม่ยืนยันรถ จึงมีเฉพาะใบคำขอถึงนายก · หนังสือนำส่งกองทุนพิมพ์ได้หลังยืนยันรถจากปุ่มแยก (ข้อความนี้ไม่ถูกพิมพ์)</div>\n'
      : '') + formSheet(bookingPacket(args, args.booking, args.trip ?? null)),
  )
}

// ปุ่มหนังสือของระบบจองคิวรับคำขอเดียวเท่านั้น กันข้อมูลคนอื่นในเที่ยวเดียวกันติดมาด้วย
export function buildBookingForwardLetterHtml(args) {
  const { booking, trip } = args ?? {}
  if (!booking || !trip || booking.trip_id !== trip.id
    || !['confirmed', 'completed'].includes(booking.status) || trip.state === 'cancelled') {
    throw new Error('หนังสือนำส่งกองทุนพิมพ์ได้หลังยืนยันรถในเที่ยวที่ยังไม่ยกเลิก')
  }
  return buildPatientTransportLetterHtml({ ...bookingPacket(args, booking, trip), attachmentCount: 1 })
}

export function buildTripForwardLetterHtml(args) {
  const { trip, bookings } = args
  const people = tripPassengers(bookings, trip)
  if (!people.length) throw new Error('ไม่มีคำขอที่ยืนยันแล้วสำหรับพิมพ์ในเที่ยวนี้')
  const packets = people.map(b => bookingPacket(args, b, trip))
  const letter = { ...packets[0], attachmentCount: people.length }
  if (people.length > 1) {
    letter.referenceNo = ''
    letter.header = { ...letter.header, consent_at: null }
    letter.passengerSummary = `ด้วย ${args.tenant?.name || 'หน่วยงาน'} ได้รับคำขอความอนุเคราะห์รถรับ-ส่งผู้ป่วย จำนวน ${people.length} ราย `
      + `เพื่อเดินทางไปยัง ${trip.plan?.route_label || '-'} ในวันที่ ${letterDateText(trip.plan?.date) || '-'} `
      + 'รายละเอียดผู้ยื่นคำขอ ผู้ป่วย และวันเวลานัด ปรากฏตามใบคำขอรถรับ-ส่งผู้ป่วยที่แนบมาครบทุกฉบับ'
  }
  return page(
    'ใบคำขอถึงนายกและหนังสือนำส่งกองทุน (รถรับ-ส่งผู้ป่วย)',
    `${letterCss()}${formCss()}`,
    // ใบคำขอเรียงตามเวลานัดของผู้ป่วย (tripPassengers) แล้วจึงหนังสือนำส่งฉบับเดียวของเที่ยว
    packetBody(args.mayor, letterSheet(letter), packets.map(formSheet)),
  )
}

// ---------------------------------------------------------------------------
// สรุปการใช้รถรายเดือน — A4 แนวนอนเพราะมี 10 คอลัมน์ (แนวตั้งเหลือ 160 มม. ไม่พอที่ 14pt)
// ⚠️ เป็น "แบบสรุปกลาง" ของระบบ ยังไม่ใช่แบบเบิกของกองทุนใด ถ้ากองทุนมีแบบของตัวเองต้องใช้แบบนั้น
// สรุปรายเดือนมีจำนวนผู้เดินทางเท่านั้น ไม่มีชื่อ (รายละเอียดอยู่ในใบคำขอแนบหนังสือรายเที่ยว)
// ---------------------------------------------------------------------------
export function buildTripMonthReportHtml({ tenant, report, partner, period }) {
  const month = String(report?.month ?? '').slice(0, 7)
  const range = period || reportPeriod({ mode: 'month', month })
  if (period && (!report || !Array.isArray(report.trips) || report.from !== range.from || report.to !== range.to)) throw new Error('ช่วงข้อมูลรายงานไม่ตรงกับช่วงที่เลือก กรุณาโหลดใหม่')
  // ยอดรวมนับเฉพาะเที่ยวที่จบแล้ว — เที่ยวที่ยังไม่ได้วิ่ง/ยังวิ่งไม่จบแยกไปตารางท้ายใบ ไม่งั้นใบนี้
  // ถูกอ่านเป็นผลงานจริงทั้งที่รถยังไม่ได้ออก (ผลตรวจ #227 ข้อ 3)
  const all = (report?.trips ?? []).filter(t => t.date >= range.from && t.date <= range.to && t.state !== 'cancelled')
  const trips = all.filter(t => t.state === 'completed')
  const pending = all.filter(t => t.state !== 'completed' && t.state !== 'cancelled')
  const summary = monthReportSummary(all)
  const totalPeople = summary.passengers
  const totalCompanions = summary.companions
  const totalKm = summary.distance
  const rows = trips.map((t, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="num">${esc(letterDateText(t.date))}</td>
      <td>${esc(t.route_label ?? '')}</td>
      <td class="num">${Number(t.passengers || 0)}</td>
      <td class="num">${Number(t.companions || 0)}</td>
      <td class="num">${esc(t.odometer_start ?? '')}</td>
      <td class="num">${esc(t.odometer_end ?? '')}</td>
      <td class="num">${t.odometer_issue ? 'รอตรวจสอบ' : esc(t.distance ?? '')}</td>
      <td>${esc(t.driver_name ?? '')}</td>
      <td class="num">${esc(t.letter_no ?? '')}</td>
    </tr>`).join('\n')
  // รายงานหลายหน้าใช้ @page margins จริงจากค่ากลางทุกหน้า ส่วน padding ใช้เฉพาะ preview
  // margin:0 + sheet padding เดิมมีขอบเฉพาะหน้าแรก ทำให้หน้าต่อไปพิมพ์ชิดขอบบน
  const css = `
  ${govPageCss({ size: 'A4 landscape' })}
  .sheet.landscape { width: 297mm; min-height: 210mm; padding: ${govPagePadding({ size: 'A4 landscape' })}; }
  @media print { .sheet.landscape { width: auto; min-height: 0; padding: 0; margin: 0; } }
  .report-title { text-align: center; font-weight: 700; font-size: 1.1em; }
  .report-sub { text-align: center; margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 0.8mm 1.2mm; vertical-align: top; }
  th { font-weight: 700; text-align: center; }
  td.num { text-align: center; white-space: nowrap; }
  /* ยอดรวมทั้งช่วงแสดงท้ายตารางครั้งเดียว ไม่ซ้ำทุกหน้าจนดูเหมือนยอดรวมรายหน้า */
  tfoot { display: table-row-group; }
  tfoot td { font-weight: 700; }
  /* เดือนที่วิ่งทุกวันทำการได้ ~22 เที่ยว เกินพื้นที่แนวนอน 170 มม. (แบบ 4 ได้ 13 แถว/หน้า) จึงยอมให้
     ขึ้นหน้าใหม่ แต่หัวตารางต้องซ้ำทุกหน้า แถวห้ามขาดกลาง และช่องลงนามห้ามแยกไปคนละหน้ากับยอดรวม */
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .report-sign { margin-top: 8mm; break-inside: avoid; page-break-inside: avoid; }
  .note { margin-top: 2mm; }
  table.pending { margin-top: 1mm; }`
  // ช่องลงนามของกลาง บล็อกเดียว 2 คอลัมน์ — เส้นยาวเท่ากันด้วย GOV_SIGN_LINE_W (ไม่ส่ง width เอง)
  const sign = `<div class="two-col report-sign">
    <div>${govSignRow({ role: 'ผู้จัดทำ', below: [govNameBlank(), 'ตำแหน่ง ....................'] })}</div>
    <div>${govSignRow({ role: 'ผู้ตรวจสอบ', below: [govNameBlank(), 'ตำแหน่ง ....................'] })}</div>
  </div>`
  return page(
    'สรุปการใช้รถรับ-ส่งผู้ป่วย ' + range.label,
    css,
    `<div class="sheet landscape">
  <p class="report-title">สรุปการใช้รถรับ-ส่งผู้ป่วย ${esc(range.label)}</p>
  <p class="report-sub">${esc(reportDateLabel(range.from))} – ${esc(reportDateLabel(range.to))} · ตามวันเดินทาง</p>
  <p class="report-sub">${esc(tenant?.name ?? '')} · รถของ${esc(textOr(partner?.name, 'กองทุนเจ้าของรถ'))}</p>
  <table>
    <thead><tr><th>ลำดับ</th><th>วันที่</th><th>เส้นทาง</th><th>ผู้เดินทาง</th><th>ผู้ติดตาม</th><th>เลขไมล์ออก</th><th>เลขไมล์กลับ</th><th>ระยะทาง (กม.)</th><th>คนขับ</th><th>หนังสือนำส่งที่</th></tr></thead>
    <tbody>
${rows || '<tr><td colspan="10" class="num">ยังไม่มีเที่ยวที่จบในช่วงนี้</td></tr>'}
    </tbody>
    <tfoot><tr><td colspan="3">รวมเที่ยวที่จบแล้ว ${trips.length} เที่ยว</td><td class="num">${totalPeople}</td><td class="num">${totalCompanions}</td><td colspan="2"></td><td class="num">${totalKm}</td><td colspan="2"></td></tr></tfoot>
  </table>
  ${pending.length ? `<p class="note bold">เที่ยวที่ยังไม่จบใน${range.mode === 'month' ? 'เดือน' : 'ช่วง'}นี้ ${pending.length} เที่ยว — ไม่นับรวมในยอดข้างบน</p>
  <table class="pending">
    <thead><tr><th>วันที่</th><th>เส้นทาง</th><th>สถานะ</th><th>ผู้เดินทางตามแผน</th></tr></thead>
    <tbody>
${pending.map(t => `<tr><td class="num">${esc(letterDateText(t.date))}</td><td>${esc(t.route_label ?? '')}</td><td>${esc(TRIP_STATUS[t.state] ?? t.state ?? '')}</td><td class="num">${Number(t.passengers || 0)}</td></tr>`).join('\n')}
    </tbody>
  </table>` : ''}
  ${summary.missingDistance ? `<p class="note">หมายเหตุ: มี ${summary.missingDistance} เที่ยวที่เลขไมล์ยังไม่ครบหรือระยะทางรอตรวจสอบ ระยะทางรวมนับเฉพาะเที่ยวที่ตรวจสอบได้</p>` : ''}
  ${sign}
  <div class="origin">${esc(govEServiceOriginText(tenant?.name || 'หน่วยงาน'))}</div>
</div>`,
  )
}
