import { GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'
import { getOrgTerms, orgHeadTitle, orgOfficeName } from './orgTerms.js'
import { MONTHS_TH, thaiDateTimeText } from './thaiDate.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

// ช่องกรอกในแบบฟอร์ม — กติกาเดียวกับใบขออนุญาตใช้น้ำประปา (waterSupplyRequestPrint.js)
//   มีค่า : ข้อความธรรมดา display:inline เท่านั้น ห้าม inline-block ในย่อหน้าที่ไหลต่อเนื่อง
//   ว่าง  : กล่องเส้นประกว้างตาม width ให้ผู้ยื่นเขียนด้วยปากกาได้
function line(value, width = '36mm', { nowrap = false } = {}) {
  const content = String(value ?? '').trim()
  if (content) {
    return `<span class="fill-value${nowrap ? ' fill-value--nowrap' : ''}">${esc(content)}</span>`
  }
  return `<span class="fill-blank" style="min-width:${width}">&nbsp;</span>`
}

/** ครอบทีละคำด้วย nowrap โดยยังแตกบรรทัดที่ช่องว่างได้ (เหตุผลเต็มอยู่ที่ waterSupplyRequestPrint.js) */
function wordSafe(value) {
  return String(value ?? '').trim().split(/\s+/)
    .map(word => `<span class="nb">${esc(word)}</span>`)
    .join(' ')
}

/**
 * ป้ายชื่อช่อง + ช่องกรอก มัดไว้ด้วยกันไม่ให้ขึ้นบรรทัดคั่นกลาง
 * โหมด tight/words/nowrap มีความหมายเดียวกับใบขออนุญาตใช้น้ำประปาทุกประการ
 *
 * @param {string} label ข้อความคงที่ในไฟล์นี้เท่านั้น (ไม่ได้ escape)
 */
function field(label, value, width = '36mm', { nowrap = false, suffix = '', tight = false, words = false } = {}) {
  const content = String(value ?? '').trim()
  const tail = suffix ? ` ${suffix}` : ''
  if (content) {
    if (tight) return `<span class="field-tight">${label}${esc(content)}</span>${tail}`
    if (words) return `${label} <span class="fill-value">${wordSafe(content)}</span>${tail}`
    return `${label} ${line(content, width, { nowrap })}${tail}`
  }
  return `<span class="field-blank">${label}&nbsp;<span class="fill-blank" style="min-width:${width}">&nbsp;</span>${tail}</span>`
}

// ใบนี้ไม่มีชื่อหน่วยงานวางกลางประโยคแบบใบประปา/ใบขยะ (ต้นฉบับอ้างถึงหน่วยงานเฉพาะบรรทัด
// "เรียน" กับช่องตำบล/อำเภอ/จังหวัด) จึงไม่ต้องมี orgNameHtml() — ถ้าวันหนึ่งเพิ่มประโยคที่มี
// ชื่อ อปท. อยู่กลางย่อหน้า ต้องคัด orgNameHtml จาก waterSupplyRequestPrint.js มาด้วย
// ไม่งั้นชื่อตำบลจะถูกเบราว์เซอร์ตัดกลางคำ

/**
 * แยกวัน/เดือน/พ.ศ. — ใบนี้พิมพ์ "วันที่.....เดือน.......พ.ศ......" เป็นสามช่องแยกเหมือนใบประปา
 *
 * ⚠️ คัดมาไว้ในไฟล์นี้เองโดยตั้งใจ ไม่ import ข้ามใบ — ใบพิมพ์แต่ละใบต้องแก้เลย์เอาต์ของตัวเอง
 * ได้โดยไม่กระทบใบอื่น (แนวเดียวกับที่ esc/line/field ซ้ำอยู่ในทุกไฟล์ใบพิมพ์)
 */
export function thaiDateParts(value) {
  const empty = { day: '', month: '', year: '' }
  if (!value) return empty
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return empty
  return {
    day: String(at.getDate()),
    month: MONTHS_TH[at.getMonth()],
    year: String(at.getFullYear() + 543),
  }
}

// เพดานความยาวของสองช่องบรรยายในใบ — ฟอร์มต้องบังคับก่อนบันทึก และเทสต์เลย์เอาต์ใช้ค่านี้
// เป็นเคสยาวสุดที่ต้องยังพิมพ์ลงกล่องเส้นประได้พอดี
//
// ⚠️ ข้อความในกล่องเส้นประวางทับด้วย position: absolute จึงไม่ดันกล่องให้สูงขึ้นเมื่อยาวเกิน
// — มันจะล้นทะลุออกไปทับบล็อกถัดไปเงียบๆ แทน ค่าสองตัวนี้จึงเป็นสิ่งเดียวที่กันไม่ให้ใบพัง
// ห้ามเพิ่มค่าโดยไม่รันเทสต์เลย์เอาต์ซ้ำ (บรรทัดละ ~87 ตัวอักษรที่ 14pt บนพื้นที่พิมพ์ 160 มม.
// วัดจริง 2569-09-08 — ตัวอักษรไทยที่กว้างกว่าค่าเฉลี่ยเช่น ญ ฐ กินที่มากกว่านั้น จึงหักเผื่อไว้)
export const PROBLEM_MAX_CHARS = 360
export const NEED_MAX_CHARS = 180

// จำนวนแถวบัญชีแนบท้ายต่อ 1 หน้า — ต้นฉบับที่ อบต.ทุ่งแค้ว ใช้จริงมี 33 แถว
// คิดจากพื้นที่พิมพ์แนวตั้ง 276 มม. : หัวตาราง 9 มม. + 33 แถว × 7.6 มม. = 260 มม.
// เหลือขอบ 16 มม. เผื่อเครื่องที่ไม่มี THSarabunPSK แล้วตกไปใช้ฟอนต์สำรองที่สูงกว่า
export const ATTACHMENT_ROWS_PER_PAGE = 33

/**
 * จำนวนหน้าบัญชีแนบท้าย — อย่างน้อย 1 หน้าเสมอ แม้ไม่มีรายชื่อในระบบเลย
 *
 * ผู้ใช้ระบบสั่งไว้ (2569-09-08): ยื่นคนเดียวก็ต้องได้หน้า 2 ติดไปด้วย เพราะเคสจริงคือยื่น
 * ออนไลน์คนเดียวก่อน แล้วพิมพ์ใบไปเดินเก็บรายชื่อเพื่อนบ้านที่เดือดร้อนเรื่องเดียวกันเอง
 */
export function attachmentPageCount(rows) {
  const count = Array.isArray(rows) ? rows.length : 0
  return Math.max(1, Math.ceil(count / ATTACHMENT_ROWS_PER_PAGE))
}

/**
 * แบบคำร้องขอรับการช่วยเหลือประชาชน — หน้า 1 คำร้อง + หน้า 2 เป็นต้นไปบัญชีแนบท้าย
 *
 * ลอกโครงจากแบบฟอร์มต้นฉบับที่ อบต.ทุ่งแค้ว ใช้จริง (ผู้ใช้ส่งไฟล์ต้นฉบับมา 2569-09-08)
 * ลำดับย่อหน้า ตารางบล็อกเจ้าหน้าที่ และตารางบัญชีแนบท้ายต้องตรงกับต้นฉบับ
 *
 * ต่างจากต้นฉบับ 4 จุด ทุกจุดมีเหตุผล:
 *   1. ชื่อหน่วยงาน/ตำบล/อำเภอ/จังหวัด ดึงจาก อปท. ที่ล็อกอินอยู่ ไม่ฝัง "ทุ่งแค้ว/หนองม่วงไข่/แพร่"
 *      เพราะระบบใช้ร่วมกันหลาย อปท.
 *   2. ช่อง "ส่วนงานที่รับผิดชอบ" ต้นฉบับพิมพ์ตายตัว 4 กอง — ระบบดึงกองจริงของ อปท. นั้นมาแทน
 *      อปท. ที่ไม่มีกองสวัสดิการสังคมจะได้ไม่มีช่องที่ติ๊กไม่ได้ค้างอยู่บนใบ
 *   3. ช่องลงนามผู้ขอรองรับลายมือชื่ออิเล็กทรอนิกส์ (โหมด online/counter เหมือนใบประปา)
 *   4. ชื่อในวงเล็บของช่องปลัด/นายก เติมจากทะเบียนผู้ลงนามกลางถ้าส่งมา
 *
 * ⚠️ ช่อง "ความคิดเห็น" กับ "คำอนุมัติ/คำสั่ง" เว้นว่างให้เขียนด้วยปากกาเสมอ (ผู้ใช้ระบบสั่งเอง
 * 2569-09-08) ห้ามเปลี่ยนเป็นพิมพ์จากระบบโดยไม่ถามเจ้าของระบบก่อน — ความเห็นของปลัดและ
 * คำสั่งของนายกเป็นการใช้ดุลพินิจรายเรื่อง ไม่ใช่ข้อความสำเร็จรูป
 *
 * ⚠️ ใบนี้เป็น "คำร้อง" ไม่ใช่การอนุมัติให้ความช่วยเหลือ การช่วยเหลือประชาชนของ อปท. มีขั้นตอน
 * ตามระเบียบกระทรวงมหาดไทยว่าด้วยค่าใช้จ่ายเพื่อช่วยเหลือประชาชนตามอำนาจหน้าที่ขององค์กร
 * ปกครองส่วนท้องถิ่น (ศูนย์ช่วยเหลือประชาชน / การประกาศรายชื่อ) — ยังไม่ได้เปิดตัวบทยืนยัน
 * รายข้อ ห้ามให้ระบบสรุปผลการช่วยเหลือแทนคณะกรรมการเด็ดขาด
 *
 * ⚠️ PDPA: บัญชีแนบท้ายเก็บชื่อ-ที่อยู่ของบุคคลที่สามที่ไม่ได้กดยินยอมในระบบเอง จึงเก็บเท่าที่
 * ต้นฉบับต้องการ (ชื่อ-สกุล/บ้านเลขที่/หมู่ที่/หมายเหตุ) ห้ามเพิ่มเลขบัตรประชาชนหรือเบอร์โทร
 * ของคนในบัญชีลงในฟอร์มนี้ไม่ว่ากรณีใด
 *
 * ข้อมูลใน form มาจาก permit_form_data (ชื่อคอลัมน์ legacy ของ document_requests)
 * form_type = 'public_assistance_request' ใช้แยกรูปแบบข้อมูลนี้ออกจากใบอื่น
 *
 * @param {object}   args
 * @param {object}   args.form        permit_form_data ของคำร้อง
 * @param {object}   args.tenant      แถว municipalities ของ อปท. ที่ออกใบ
 * @param {string}   args.docDate     วันที่บนหัวใบ (ISO) = วันที่ยื่น ไม่ใช่วันที่กดพิมพ์
 * @param {string}   [args.referenceNo]
 * @param {string}   [args.signedAt]
 * @param {Array<{name?: string}>} [args.departments] กองจริงของ อปท. สำหรับช่องติ๊กส่วนงาน
 * @param {{clerk?: {name?: string, title?: string}, mayor?: {name?: string, title?: string}}} [args.signatories]
 */
export function buildPublicAssistanceRequestHtml({
  form, tenant, docDate, referenceNo = '', signedAt = '', departments = [], signatories = null,
}) {
  const data = form || {}
  const applicant = data.applicant || {}
  const applicantName = `${applicant.title || ''}${applicant.first || ''} ${applicant.last || ''}`.trim()
  const officeName = orgOfficeName(tenant)
  const headTitle = orgHeadTitle(tenant)
  const clerkTitle = getOrgTerms(tenant?.org_type).clerk
  const { day, month, year } = thaiDateParts(docDate)

  const affected = Array.isArray(data.affected) ? data.affected : []
  // จำนวนผู้เดือดร้อนพิมพ์ลงใบเฉพาะเมื่อผู้ยื่นกรอกรายชื่อมาในระบบแล้วเท่านั้น — ถ้าไม่กรอกเลย
  // ต้องเว้นเป็นเส้นประ เพราะใบจะถูกพิมพ์ไปเดินเก็บรายชื่อเพิ่มด้วยปากกา เลขที่พิมพ์ไว้ล่วงหน้า
  // จะขัดกับบัญชีแนบท้ายทันทีที่มีคนเซ็นเพิ่ม (ตกลงกับผู้ใช้ระบบ 2569-09-08)
  const affectedCount = affected.length > 0 ? String(affected.length) : ''

  const signedOnline = data.signed_by?.channel === 'online'
  const signedStamp = signedOnline ? thaiDateTimeText(signedAt || data.signed_at) : ''

  // ช่องติ๊กส่วนงาน: ต้นฉบับมี 4 ช่องตายตัว ระบบใช้กองจริงของ อปท. — จำกัด 6 ช่องเพราะแถวนี้
  // สูงได้ไม่เกิน 3 บรรทัด (2 คอลัมน์) ถ้าเกินนั้นบล็อกเจ้าหน้าที่จะดันใบตกหน้า 2
  const deptNames = departments.map(item => String(item?.name ?? '').trim()).filter(Boolean)
  // ไม่มีข้อมูลกอง (ใบเปล่าที่พิมพ์ไว้แจกหน้าเคาน์เตอร์) ใช้ 4 ช่องตามต้นฉบับไปก่อน
  const deptBoxes = deptNames.length > 0
    ? deptNames.slice(0, 6)
    : ['สำนักงานปลัด', 'กองคลัง', 'กองช่าง', 'กองสวัสดิการสังคม']
  // เหลือกองที่ตัดออกให้ติ๊กช่อง "อื่น ๆ" แล้วเขียนชื่อกองเอง ดีกว่าตัดหายเงียบๆ จนหาช่องติ๊กไม่เจอ
  const hasMoreDepts = deptNames.length > deptBoxes.length

  const writeLines = (value, count) => `<div class="fill-lines" style="--lines:${count}">
        <div class="fill-lines-bg">${'<span class="dot-line"></span>'.repeat(count)}</div>
        <div class="fill-lines-text">${esc(String(value ?? '').trim())}</div>
      </div>`

  // ⚠️ พิมพ์แค่ "ชื่อ" ในวงเล็บ ไม่พิมพ์ตำแหน่งใต้ชื่อ — ตรงกับต้นฉบับ และเป็นเรื่องความสูงด้วย:
  // ชื่อตำแหน่งเต็ม ("ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว") ยาวกว่าช่องกว้าง ~50 มม. จึงตัดเป็น
  // 2 บรรทัดเสมอ ดันบล็อกเจ้าหน้าที่สูงขึ้น 17 มม. เทียบกับใบเปล่า (วัดจริง 2569-09-08)
  const signBlock = (role, person) => `<div class="cell-sign">
          <div>(ลงชื่อ)<span class="fill-blank" style="min-width:28mm">&nbsp;</span>${role}</div>
          <div class="cell-paren">(${person?.name ? `<span class="fill-value">${wordSafe(person.name)}</span>` : line('', '26mm')})</div>
          <div class="cell-date">${field('วันที่', '', '7mm')} ${field('เดือน', '', '14mm')}<br>${field('พ.ศ.', '', '12mm')}</div>
        </div>`

  const attachmentPages = attachmentPageCount(affected)
  const attachmentHtml = Array.from({ length: attachmentPages }, (unusedPage, pageIndex) => {
    const start = pageIndex * ATTACHMENT_ROWS_PER_PAGE
    const rows = Array.from({ length: ATTACHMENT_ROWS_PER_PAGE }, (unusedRow, rowIndex) => {
      const person = affected[start + rowIndex] || null
      return `<tr>
          <td class="col-no"><div class="cell-clip">${start + rowIndex + 1}</div></td>
          <td class="col-name"><div class="cell-clip">${person ? esc(String(person.name ?? '').trim()) : ''}</div></td>
          <td class="col-addr"><div class="cell-clip">${person ? esc(String(person.addr_no ?? '').trim()) : ''}</div></td>
          <td class="col-moo"><div class="cell-clip">${person ? esc(String(person.addr_moo ?? '').trim()) : ''}</div></td>
          <td class="col-sign"></td>
          <td class="col-note"><div class="cell-clip">${person ? esc(String(person.note ?? '').trim()) : ''}</div></td>
        </tr>`
    }).join('\n        ')
    return `<main class="sheet sheet--attachment" data-pdf-page>
    <table class="roster">
      <thead>
        <tr>
          <th class="col-no">ลำดับที่</th>
          <th class="col-name">ชื่อ-สกุล</th>
          <th class="col-addr">บ้านเลขที่</th>
          <th class="col-moo">หมู่ที่</th>
          <th class="col-sign">ลายมือชื่อ</th>
          <th class="col-note">หมายเหตุ</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </main>`
  }).join('\n  ')

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>แบบคำร้องขอรับการช่วยเหลือประชาชน</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body {
      ${govDocFontCss()}
    }
    .sheet { width: 100%; }
    /* หน้าบัญชีแนบท้ายต้องขึ้นแผ่นใหม่เสมอ แม้ไม่มีรายชื่อในระบบเลย (ดู attachmentPageCount) */
    .sheet--attachment { break-before: page; page-break-before: always; }
    .title { margin: 0 0 2mm; text-align: center; font-weight: 700; }

    /* บล็อก "เขียนที่ + ที่อยู่สำนักงาน" ชิดขวาตามต้นฉบับ — inline-block เพื่อให้ทุกบรรทัด
       เริ่มตรงกันที่ขอบซ้ายของบล็อก ไม่ใช่ชิดขวารายบรรทัดจนขอบซ้ายเป็นฟันปลา */
    .write-at { margin: 0 0 2mm; text-align: right; }
    .write-at-inner { display: inline-block; max-width: 90mm; text-align: left; }
    .write-at-inner p { margin: 0; line-height: 1.15; }
    .date-line { margin: 0 0 3mm; text-align: right; padding-right: 12mm; }

    .subject, .to { display: grid; grid-template-columns: 14mm minmax(0, 1fr); }
    p { margin: 0 0 3mm; }

    /* ⚠️ ห้ามเปลี่ยนเป็น text-align: justify — เหตุผลเต็มอยู่ที่ waterSupplyRequestPrint.js
       (ประโยคไทยยืดได้เฉพาะตรงช่องว่าง บรรทัดที่มีช่องว่างน้อยจะถูกยืดเป็นรูโหว่กลางประโยค) */
    .body-copy { text-indent: 25mm; text-align: left; margin-bottom: 2mm; break-inside: avoid; }
    .section-head { text-indent: 12mm; margin: 0 0 1mm; }
    .closing { text-indent: 25mm; margin: 2mm 0 0; }
    .regards { margin: 0.5mm 0 0; text-align: center; }

    .fill-value { white-space: pre-wrap; }
    .fill-value--nowrap { white-space: nowrap; }
    .field-blank { white-space: nowrap; }
    .org-name { white-space: normal; }
    .org-name > span { white-space: nowrap; }
    .field-tight { white-space: nowrap; }
    .nb { white-space: nowrap; }
    .fill-blank {
      display: inline-block;
      padding: 0 .7mm;
      line-height: 1.05;
      vertical-align: baseline;
      border-bottom: 1px dotted #000;
    }

    /* กล่องบรรทัดเส้นประสำหรับข้อความยาว (ปัญหาความเดือดร้อน / ความต้องการ)
       ⚠️ วาดเส้นเป็น element จริงทีละบรรทัดแล้ววางข้อความทับด้วย absolute — ไม่ใช้
       background-image เพราะเส้นประจาก gradient คุมระยะให้ตรงกับ line-height ไม่ได้ทุกเครื่อง
       พอฟอนต์ตกไปใช้ตัวสำรอง ข้อความจะลอยไม่นั่งบนเส้น
       ข้อความเป็น absolute จึงไม่ดันความสูงกล่อง — ความยาวต้องถูกจำกัดที่ฟอร์มก่อนบันทึก
       (ดู PROBLEM_MAX_CHARS ใน PublicAssistanceWizard.jsx) และมีเทสต์เลย์เอาต์กันข้อความล้น */
    .fill-lines { position: relative; margin: 0 0 2mm; }
    .dot-line { display: block; height: 5.6mm; border-bottom: 1px dotted #000; }
    .fill-lines-text {
      position: absolute; inset: 0;
      /* 12pt: ดูเหตุผลที่ PROBLEM_MAX_CHARS — ระยะบรรทัดยังผูกกับความสูงเส้นประ 5.8 มม. เท่าเดิม
         ข้อความจึงนั่งบนเส้นพอดีเหมือนกระดาษที่เขียนด้วยปากกา */
      font-size: 12pt;
      line-height: 5.6mm;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }

    /* ช่องลงนามผู้ขอความช่วยเหลือ — โครงเดียวกับใบขออนุญาตใช้น้ำประปา
       min-width ไม่ใช่ width เพื่อให้ชื่อยาวดันกล่องแทนที่จะล้นทับคำต่อท้าย */
    .signature { margin: 1.5mm 0 0 auto; width: 118mm; }
    .signature-row { display: flex; align-items: flex-start; white-space: nowrap; }
    .sign-label { display: inline-block; width: 14mm; }
    .signature-name { display: flex; flex: 0 0 auto; min-width: 50mm; flex-direction: column; align-items: stretch; }
    .signature-line, .sign-paren { min-width: 50mm; text-align: center; white-space: nowrap; }
    .sign-paren { margin-top: 2mm; }
    .signature .fill-value { white-space: nowrap; }
    .signed-name { display: block; min-width: 50mm; text-align: center; font-weight: 700; }
    .sign-role { margin-left: 1mm; }
    .signed-note { margin-top: 2mm; font-size: 10pt; color: #333; white-space: normal; line-height: 1.2; }

    /* บล็อกเจ้าหน้าที่ท้ายหน้า 1 — ตารางเส้นจริงตามต้นฉบับ
       ⚠️ 12pt เป็นข้อยกเว้นเรื่อง "ขนาดตัวอักษร" ที่มาตรฐานกลางอนุญาตให้ทำได้ในเอกสารตาราง
       ที่คุมขนาดเองรายช่อง (ฟอนต์และ font-size-adjust ยังเป็นค่ากลางทั้งใบ) — ช่องกว้าง
       ~50 มม./คอลัมน์ ถ้าใช้ 14pt เท่าเนื้อความ บรรทัด "เพื่อพิจารณา/สั่งการต่อไป" และชื่อ
       ตำแหน่งผู้ลงนามจะตัดเป็น 2-3 บรรทัดจนบล็อกดันใบตกหน้า 2 */
    .officer { width: 100%; margin-top: 3mm; border-collapse: collapse; font-size: 11pt; break-inside: avoid; }
    .officer td { border: 1px solid #000; padding: 1mm 1.5mm; vertical-align: top; }
    .officer .cell-head { font-weight: 700; }
    /* ช่องเจ้าหน้าที่ใช้บรรทัดเส้นประที่เตี้ยกว่าเนื้อความหน้าแรก — เขียนด้วยปากกาในช่องแคบ */
    .officer .dot-line { height: 4.2mm; }
    .officer .fill-lines { margin-bottom: 0; }
    .cell-sign { margin-top: 1mm; }
    .cell-paren, .cell-title, .cell-date { margin-top: 1mm; }
    .cell-title { font-size: 11pt; }
    .checkbox { display: inline-block; width: 3.5mm; height: 3.5mm; border: 1px solid #000; margin-right: 1.5mm; vertical-align: -0.3mm; }
    .dept-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5mm 4mm; }
    .result-line { display: flex; align-items: baseline; gap: 1.5mm; white-space: nowrap; }
    .result-line .fill-blank { flex: 1 1 auto; }

    /* บัญชีแนบท้าย — ความกว้างรวม 160 มม. เท่าพื้นที่พิมพ์พอดี
       ⚠️ แก้ความกว้างคอลัมน์ใดต้องหักจากคอลัมน์อื่นเสมอ รวมเกิน 160 มม. เมื่อไร ตารางจะล้น
       ขอบขวาแล้วเส้นกรอบด้านขวาหายไปตอนพิมพ์ */
    .roster { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .roster th, .roster td { border: 1px solid #000; padding: 0 1.5mm; font-size: 12pt; }
    /* ⚠️ ความสูงแถวต้องคงที่เสมอ ห้ามให้เนื้อหาดันแถวสูงขึ้น — ตารางนี้ไล่จำนวนแถวต่อหน้าไว้
       ตายตัว (ATTACHMENT_ROWS_PER_PAGE) ถ้าแถวใดสูงขึ้น แถวท้ายจะหลุดไปหน้าถัดไปทันที
       ชื่อที่ยาวเกินช่องจะถูกตัดท้ายด้วย ellipsis ให้เห็นว่ายังมีต่อ ไม่ใช่หายเงียบ */
    .roster .cell-clip {
      height: 7.6mm; line-height: 7.6mm;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .roster th { height: 9mm; text-align: center; font-weight: 400; white-space: nowrap; }
    .roster td { height: 7.6mm; }
    .roster .col-no { width: 14mm; text-align: center; }
    .roster .col-name { width: 60mm; }
    .roster .col-addr { width: 22mm; text-align: center; }
    .roster .col-moo { width: 15mm; text-align: center; }
    .roster .col-sign { width: 30mm; }
    .roster .col-note { width: 19mm; }

    @media screen {
      body { background: #e5e7eb; padding: 12px; }
      .sheet { width: 210mm; min-height: 297mm; margin: 0 auto 12px; padding: 12mm 20mm 9mm 30mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
    }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <main class="sheet" data-pdf-page>
    <div class="title">แบบคำร้องขอรับการช่วยเหลือประชาชน</div>

    <div class="write-at">
      <div class="write-at-inner">
        <p>เขียนที่ ${esc(officeName)}</p>
      </div>
    </div>

    <p class="date-line">${field('วันที่', day, '16mm')} ${field('เดือน', month, '30mm')} ${field('พ.ศ.', year, '20mm')}</p>

    <p class="subject"><strong>เรื่อง</strong><span>${data.subject ? esc(String(data.subject).trim()) : line('', '80mm')}</span></p>
    <p class="to"><strong>เรียน</strong><span>${esc(headTitle)}</span></p>

    <p class="body-copy">
      ด้วย ${field('ข้าพเจ้า (นาย/นาง/นางสาว)', applicantName, '58mm', { words: true })}
      ${field('อยู่บ้านเลขที่', applicant.addr_no, '22mm')} ${field('หมู่ที่', applicant.addr_moo, '12mm')}
      ${field('ตำบล', applicant.addr_subdistrict, '27mm', { tight: true })} ${field('อำเภอ', applicant.addr_district, '27mm', { tight: true })}
      ${field('จังหวัด', applicant.addr_province, '27mm', { tight: true })}
      พร้อมด้วยผู้ได้รับความเดือดร้อน${field('จำนวน', affectedCount, '14mm', { suffix: 'คน' })} ตามบัญชีแนบท้าย
      มีปัญหาความเดือดร้อนและความต้องการความช่วยเหลือ ดังนี้
    </p>

    <p class="section-head">๑. ปัญหาความเดือดร้อน</p>
    ${writeLines(data.problem, 6)}

    <p class="section-head">๒. ความต้องการรับการช่วยเหลือ</p>
    ${writeLines(data.need, 3)}

    <p class="closing">จึงเรียนมาเพื่อโปรดพิจารณาให้ความช่วยเหลือ</p>
    <p class="regards">ขอแสดงความนับถือ</p>

    <section class="signature">
      <div class="signature-row">
        <span class="sign-label">(ลงชื่อ)</span>
        <div class="signature-name">
          <div class="signature-line">${signedOnline
            ? `<span class="signed-name">${esc(applicantName)}</span>`
            : '<span class="fill-blank" style="min-width:50mm">&nbsp;</span>'}</div>
          <div class="sign-paren">(${line(applicantName, '44mm')})</div>
        </div>
        <span class="sign-role">ผู้ขอความช่วยเหลือ</span>
      </div>
      <p class="signed-note">${signedOnline
        ? `ลงชื่อโดยการยืนยันตัวตน${esc(govEServiceOriginText(tenant))}${signedStamp ? `<br>${esc(signedStamp)}` : ''}`
        : `ยื่นคำร้อง${esc(govEServiceOriginText(tenant))}`}${referenceNo ? ` · เลขอ้างอิง ${esc(referenceNo)}` : ''}</p>
    </section>

    <table class="officer">
      <tr>
        <td>
          <div class="cell-head">สำหรับเจ้าหน้าที่</div>
          <div>เรียน ${esc(headTitle)}</div>
          <div>- เพื่อโปรดทราบ</div>
          <div>- เพื่อพิจารณา/สั่งการต่อไป</div>
          ${signBlock('ผู้รับเรื่อง', null)}
        </td>
        <td>
          <div class="cell-head">ความคิดเห็น${esc(clerkTitle)}</div>
          ${writeLines('', 3)}
          ${signBlock('', signatories?.clerk)}
        </td>
        <td>
          <div class="cell-head">คำอนุมัติ/คำสั่ง</div>
          ${writeLines('', 3)}
          ${signBlock('', signatories?.mayor)}
        </td>
      </tr>
      <tr>
        <td class="cell-head">ส่วนงานที่รับผิดชอบ</td>
        <td colspan="2">
          <div class="dept-grid">
            ${deptBoxes.map(name => `<div><span class="checkbox"></span>${esc(name)}</div>`).join('\n            ')}
            ${hasMoreDepts ? '<div><span class="checkbox"></span>อื่น ๆ</div>' : ''}
          </div>
        </td>
      </tr>
      <tr>
        <td colspan="3">
          <div class="result-line">ผลการดำเนินการ<span class="fill-blank">&nbsp;</span></div>
        </td>
      </tr>
    </table>
  </main>

  ${attachmentHtml}
</body>
</html>`
}
