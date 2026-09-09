import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'
import { orgClerkTitle, orgHeadTitle, orgNameParts } from './orgTerms.js'
import { MONTHS_TH, thaiDateTimeText } from './thaiDate.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

// ช่องกรอกในแบบฟอร์ม — กติกาเดียวกับใบขออนุญาตใช้น้ำประปาและใบคำร้องช่วยเหลือ
//   มีค่า : ข้อความธรรมดา display:inline เท่านั้น ห้าม inline-block ในย่อหน้าที่ไหลต่อเนื่อง
//   ว่าง  : กล่องเส้นประกว้างตาม width ให้เขียนด้วยปากกาได้
function line(value, width = '40mm') {
  const content = String(value ?? '').trim()
  if (content) return `<span class="fill-value">${esc(content)}</span>`
  return `<span class="fill-blank" style="min-width:${width}">&nbsp;</span>`
}

/**
 * ป้ายชื่อช่อง + ช่องกรอก มัดไว้ด้วยกันไม่ให้ขึ้นบรรทัดคั่นกลาง
 * @param {string} label ข้อความคงที่ในไฟล์นี้เท่านั้น (ไม่ได้ escape)
 */
function field(label, value, width = '40mm') {
  const content = String(value ?? '').trim()
  if (content) return `${label} <span class="fill-value">${esc(content)}</span>`
  return `<span class="field-blank">${label}&nbsp;<span class="fill-blank" style="min-width:${width}">&nbsp;</span></span>`
}

/**
 * ชื่อหน่วยงาน/กองกลางย่อหน้า — ต้องแยก "คำนำหน้า + ชื่อท้องถิ่น" แล้วยอมให้ขึ้นบรรทัดใหม่
 * ได้เฉพาะรอยต่อนั้นจุดเดียว ไม่งั้นเบราว์เซอร์ตัดกลางคำได้ "…ตำบลโป่งตาลอ" ค้างท้ายบรรทัด
 * (เหตุผลเต็มอยู่ที่ orgNameParts ใน orgTerms.js)
 */
function orgNameHtml(nameOrTenant) {
  const { prefix, locality } = orgNameParts(nameOrTenant)
  if (!locality) return `<span class="nb">${esc(prefix)}</span>`
  return `<span class="nb">${esc(prefix)}</span><span class="nb">${esc(locality)}</span>`
}

/** แยกวัน/เดือน/พ.ศ. — ใบนี้พิมพ์ "วันที่.....เดือน.......พ.ศ......" เป็นสามช่องแยกตามต้นฉบับ */
function thaiDateParts(value) {
  if (!value) return { day: '', month: '', year: '' }
  const at = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(at.getTime())) return { day: '', month: '', year: '' }
  return {
    day: String(at.getDate()),
    month: MONTHS_TH[at.getMonth()] ?? '',
    year: String(at.getFullYear() + 543),
  }
}

function thaiDateText(value) {
  const { day, month, year } = thaiDateParts(value)
  return day ? `${day} ${month} พ.ศ. ${year}` : ''
}

// จำนวนแถวต่อหน้าตามต้นฉบับ — ใบจริงมีตาราง 7 แถวพอดี ใบที่มีของไม่เกิน 7 รายการต้องพิมพ์
// ออกมาหน้าตาเหมือนต้นฉบับเป๊ะ จึงต้องเติมแถวว่างให้ครบ ไม่ใช่ปล่อยตารางสั้นกุด
const ROWS_PER_PAGE = 7

/**
 * ผู้ลงนาม: ชื่อที่พิมพ์ในวงเล็บมาจากทะเบียนผู้ลงนามกลาง (document_signatories)
 * ⚠️ ห้าม hardcode ชื่อจาก PDF ต้นฉบับเด็ดขาด — ชื่อในไฟล์ต้นฉบับเป็นของ อบต. หนึ่งเท่านั้น
 * ทะเบียนว่างให้พิมพ์เป็นเส้นจุดไว้เขียนมือ ส่วนบรรทัดตำแหน่งตกไปใช้ชื่อตำแหน่งตามประเภท
 * หน่วยงาน (เทศบาลได้ "ปลัดเทศบาลตำบล…/นายกเทศมนตรีตำบล…" อัตโนมัติ)
 */
function signatureName(signatory) {
  const name = signatory?.name?.trim()
  return name ? `(${esc(name)})` : '(..................................................)'
}

/**
 * บล็อกลงนามหนึ่งจุด — "เส้นจุดคือแกน" บรรทัดที่อยู่ใต้มัน (วงเล็บชื่อ ชื่อตำแหน่ง)
 * ต้องอยู่กึ่งกลางบนแกนเดียวกันเสมอ ไม่ใช่กึ่งกลางของคอลัมน์
 *
 * ⚠️ ผู้ใช้ระบบสั่งแก้ 2569-09-09 หลังเห็นใบพิมพ์จริง — ของเดิมเป็น <p> สองย่อหน้าแยกกัน
 * บรรทัดบนชิดซ้าย บรรทัดล่าง text-align:center ของ "คอลัมน์" ซึ่งไม่ใช่แกนของเส้นจุด
 * เพราะเส้นจุดถูกดันไปทางขวาด้วยคำว่า "ลงชื่อ" (~10 มม.) และมีคำต่อท้ายกินที่ทางขวาอีก
 * วงเล็บจึงเยื้องไปทางซ้ายของเส้นจุดทุกช่อง ยกเว้นช่อง "ผู้ยืม" ที่บังเอิญถูกเพราะทั้งก้อน
 * อยู่ใน .center — วิธีแก้คือมัดเส้นจุดกับบรรทัดใต้ไว้ในกล่องเดียวกันแล้วจัดกึ่งกลาง
 * (เทคนิคเดียวกับ .cell-sign-row/.cell-sign-name ใน publicAssistancePrint.js)
 *
 * @param {object} args
 * @param {string} [args.width] ความกว้างเส้นจุด — ไล่ไว้รายจุดตามที่ว่างของคอลัมน์นั้น
 * @param {string} [args.role]  คำต่อท้ายบรรทัดบน เช่น 'ผู้ยืม' (ไม่มีก็เว้นว่าง)
 * @param {string[]} [args.below] บรรทัดใต้เส้นจุด เรียงบนลงล่าง (escape มาแล้ว)
 * @param {string} [args.signed] ชื่อที่พิมพ์แทนลายมือชื่อ (โหมด online เท่านั้น escape มาแล้ว)
 *   มีค่า = ไม่พิมพ์เส้นจุด เพราะลงชื่อแล้ว ไม่มีที่ให้เซ็นซ้ำ
 */
function signRow({ width = '55mm', role = '', below = [], signed = '' }) {
  return `<div class="sign-row">
      <span class="sign-label">ลงชื่อ</span>
      <span class="sign-axis">
        <!-- ⚠️ ต้องมี &nbsp; ข้างใน — span ว่างที่มีแต่ border-bottom สูง 0 พอเอามาวางใน
             flex column แล้วเส้นจุดจะลอยทับบรรทัดวงเล็บ ไม่ได้เป็นบรรทัดของตัวเอง
             (ตอนเป็น inline อยู่ในย่อหน้าเดิมมันได้ความสูงจาก line box ของย่อหน้า) -->
        ${signed
          ? `<span class="sign-signed" style="min-width:${width}">${signed}</span>`
          : `<span class="sign-line" style="min-width:${width}">&nbsp;</span>`}
${below.map(text => `        <span class="sign-below">${text}</span>`).join('\n')}
      </span>
      ${role ? `<span class="sign-role">${role}</span>` : ''}
    </div>`
}

/**
 * แบบพิมพ์ "ใบยืมพัสดุ/ครุภัณฑ์" (บย.)
 *
 * ⚠️ ช่องลงนาม "ผู้ยืม" มี 2 โหมด ห้ามรวบเป็นโหมดเดียว (กติกาเดียวกับใบน้ำประปา ใบเก็บขนขยะ
 * และใบขอรับการช่วยเหลือ — ดู waterSupplyRequestPrint.js):
 *   online  — ผู้ยืมล็อกอินยืนยันตัวตนแล้วยื่นเอง (form.signed_by.channel === 'online')
 *             พิมพ์ชื่อบนเส้นเป็นลายมือชื่ออิเล็กทรอนิกส์ได้ พร้อมบรรทัดกำกับวันเวลาและ
 *             เลขอ้างอิงเป็นร่องรอยว่าใครลงชื่อเมื่อไร
 *   counter — เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ ผู้ยืม "ไม่ได้" ยืนยันตัวตนในระบบ ต้องเว้นเส้น
 *             ให้เซ็นด้วยปากกาเสมอ พิมพ์ชื่อบนเส้นแทนไม่ได้เด็ดขาด
 *   คำขอเก่าที่ไม่มี signed_by ตกมาที่โหมด counter — ถูกแล้ว ระบบย้อนหลังไปอ้างว่าเขาลงชื่อ
 *   ทางอิเล็กทรอนิกส์ไม่ได้
 *
 * ⚠️ ช่องลงนามของ "เจ้าหน้าที่" (ผู้รับของ ผู้จ่ายของ ผู้ส่งคืน ผู้รับคืน ปลัด นายก) ต้องว่างเสมอ
 * ทุกกรณี — คนเหล่านี้ยังไม่ได้ทำอะไรในระบบตอนพิมพ์ใบ ชื่อในวงเล็บของปลัด/นายกคือ
 * "ชื่อผู้ที่จะมาลงนาม" ตามแบบราชการ ไม่ใช่ตัวลายเซ็น
 *
 * ⚠️ สถานะทางกฎหมายของการพิมพ์ชื่อแทนลายมือชื่อ: อ้างอิงหลักลายมือชื่ออิเล็กทรอนิกส์ตาม
 * พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ ประกอบ พ.ร.บ.การปฏิบัติราชการทางอิเล็กทรอนิกส์
 * — ยังไม่ได้เปิดตัวบทยืนยันรายมาตรา ใบนี้ผูกพันความรับผิดกรณีของชำรุด/สูญหาย ถ้า อปท.
 * จะยึดเป็นหลักฐานเรียกค่าเสียหาย ต้องให้นิติกรตรวจตัวบทฉบับปัจจุบันก่อน
 *
 * ⚠️ ต้นฉบับไม่มีวันที่ออกเอกสารและไม่มีบรรทัด "เขียนที่" ต่างจากใบคำร้องอื่นทั้งหมดในระบบ
 * ห้ามคัดหัวกระดาษของ publicAssistancePrint/waterSupplyRequestPrint มาใส่
 *
 * ⚠️ บล็อกท้ายใบของต้นฉบับเขียนตายตัวว่า "คืนในสภาพที่ใช้การได้เรียบร้อยและครบถ้วน"
 * ถ้าของชำรุด/สูญหายจริง เจ้าหน้าที่ลงนามในบล็อกนั้นไม่ได้ จึงเพิ่มบรรทัดหมายเหตุใต้บล็อก
 * เฉพาะกรณีที่มี damaged/lost เท่านั้น ใบปกติยังเหมือนต้นฉบับทุกประการ
 *
 * @param {object} args
 * @param {object} args.header  แถวจาก asset_borrow_requests
 * @param {object[]} args.items แถวจาก asset_borrow_items
 * @param {object} [args.form]  permit_form_data (snapshot ตอนยื่น) ใช้ชื่อ/ตำแหน่ง/ที่อยู่ผู้ยืม
 * @param {object} args.tenant
 * @param {string} [args.departmentName] กองเจ้าของพัสดุ = ช่อง "ไปจากส่วนราชการ"
 * @param {{name?: string, title?: string}} [args.clerk] ผู้ลงนามบทบาท clerk
 * @param {{name?: string, title?: string}} [args.mayor] ผู้ลงนามบทบาท mayor
 * @param {string} [args.referenceNo] เลขอ้างอิงคำขอ ใช้เป็นร่องรอยคู่กับลายมือชื่ออิเล็กทรอนิกส์
 */
export function buildAssetBorrowHtml({
  header, items = [], form = {}, tenant, departmentName = '', clerk = null, mayor = null,
  referenceNo = '',
}) {
  const applicant = form.applicant ?? {}
  const borrowerName = [applicant.title, applicant.first, applicant.last]
    .map(part => String(part ?? '').trim()).filter(Boolean).join(' ')
  const borrowerAddress = [
    applicant.addr_no && `บ้านเลขที่ ${applicant.addr_no}`,
    applicant.addr_moo && `หมู่ที่ ${applicant.addr_moo}`,
    applicant.addr_subdistrict && `ตำบล${applicant.addr_subdistrict}`,
    applicant.addr_district && `อำเภอ${applicant.addr_district}`,
    applicant.addr_province && `จังหวัด${applicant.addr_province}`,
  ].filter(Boolean).join(' ')

  // ลายมือชื่ออิเล็กทรอนิกส์ของผู้ยืม — เงื่อนไขเดียวกับใบน้ำประปา/ขยะ/ช่วยเหลือ
  // ⚠️ ต้องเทียบ channel === 'online' เท่านั้น ห้ามใช้ "มี signed_at ไหม" เป็นตัวตัดสิน
  // ใบที่เจ้าหน้าที่คีย์แทนก็มี signed_at (เวลาที่กดบันทึก) แต่ผู้ยืมไม่ได้ยืนยันตัวตนอะไรเลย
  const signedOnline = form?.signed_by?.channel === 'online'
  const signedStamp = signedOnline ? thaiDateTimeText(form?.signed_at) : ''

  const due = thaiDateParts(header?.return_due_date)
  const problems = items.reduce((sum, item) => sum + (item.damaged_qty ?? 0) + (item.lost_qty ?? 0), 0)

  // เติมแถวว่างให้ครบหน้า — ไม่เกิน 7 รายการต้องได้ตารางเต็ม 7 แถวเหมือนต้นฉบับ
  // เกิน 7 ให้ปัดขึ้นเป็นจำนวนเท่าของ 7 หน้าสุดท้ายจะได้ไม่กุด (ตารางไหลข้ามหน้าเอง
  // โดยหัวตารางซ้ำทุกหน้าผ่าน display: table-header-group)
  const totalRows = Math.max(ROWS_PER_PAGE, Math.ceil(items.length / ROWS_PER_PAGE) * ROWS_PER_PAGE)
  const rows = Array.from({ length: totalRows }, (_, index) => {
    const item = items[index]
    if (!item) return '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>'
    // จำนวนที่พิมพ์คือ "จำนวนที่อนุมัติ" ถ้าพิจารณาแล้ว ไม่ใช่จำนวนที่ขอ — ใบที่เอาไปรับของจริง
    // ต้องตรงกับที่อนุมัติ ไม่งั้นเจ้าหน้าที่จ่ายของตามตัวเลขที่ผู้ยืมขอมาเอง
    const qty = item.approved_qty ?? item.requested_qty
    return `<tr>
      <td class="c">${index + 1}</td>
      <td class="c">${esc(item.asset_code_snapshot ?? '')}</td>
      <td>${esc(item.asset_name_snapshot ?? '')}</td>
      <td class="c qty">${esc(String(qty))} ${esc(item.unit_snapshot ?? '')}</td>
      <td>${esc(item.item_note ?? '')}</td>
    </tr>`
  }).join('\n')

  const clerkTitle = clerk?.title?.trim() || orgClerkTitle(tenant)
  const mayorTitle = mayor?.title?.trim() || orgHeadTitle(tenant)
  const orgShort = tenant?.name?.trim() || 'หน่วยงาน'

  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>ใบยืมพัสดุ/ครุภัณฑ์</title>
${GOV_FONT_LINK}
<style>
  ${govPageCss({ size: 'A4 portrait' })}
  body { margin: 0; background: #fff; color: #000; }
  .sheet {
    ${govDocFontCss()}
  }
  .form-no { text-align: right; margin-bottom: 1mm; }
  h1 { text-align: center; font-size: 1.15em; font-weight: 700; margin: 0 0 2.5mm; }
  /* ⚠️ margin: 0 โดยตั้งใจ — ย่อหน้าหัวใบของต้นฉบับเป็น "ย่อหน้าเดียวที่ไหลต่อเนื่อง"
     ไม่ใช่หลายย่อหน้าแยกกัน ที่แยกเป็น <p> หลายตัวเพราะต้องคุมจุดขึ้นบรรทัดให้ตรงต้นฉบับ
     ใส่ margin คั่นเมื่อไหร่จะได้ระยะบรรทัดกว้างกว่าต้นฉบับ และดันใบตกหน้า 2
     (วัดจริง: margin 1.5mm × 22 ย่อหน้าทั้งใบ = กินไป 33mm) */
  /* ⚠️ ไม่ justify เป็นค่าตั้งต้น — บรรทัดสั้นๆ ในบล็อกลงนาม (เช่น "- ความเห็นปลัด…")
     ที่ตัดสองบรรทัดจะถูกยืดช่องว่างจนขีดนำหน้าลอยห่างจากข้อความ ดูเหมือนพิมพ์ผิด
     ให้ justify เฉพาะย่อหน้าหัวใบซึ่งเป็นข้อความยาวไหลเต็มความกว้างจริงๆ */
  p.para { margin: 0; }
  p.para.justify { text-align: justify; text-justify: inter-word; }
  /* "วันที่" / "ตำแหน่ง" ห้ามถูกหั่นคนละบรรทัด — เคยได้ "วัน" ค้างท้ายบรรทัดแล้ว "ที่….."
     ไปขึ้นบรรทัดใหม่ ซึ่งอ่านแล้วงงว่าเป็นช่องอะไร */
  p.para.nowrap { white-space: nowrap; }
  .indent { display: inline-block; width: 20mm; }
  /* ค่าที่กรอกแล้ว: ต้องเป็น inline ธรรมดา ไม่งั้นย่อหน้าที่ไหลต่อเนื่องจะแตกบรรทัด */
  .fill-value { border-bottom: 1px dotted #000; padding: 0 1mm; }
  .fill-blank { display: inline-block; border-bottom: 1px dotted #000; }
  .field-blank { white-space: nowrap; }
  .nb { white-space: nowrap; }

  /* ⚠️ ข้อยกเว้น "ขนาดตัวอักษร" ตามกติกาโปรเจกต์ — เฉพาะในตารางเท่านั้น เนื้อความนอกตาราง
     ยังเป็น 14pt ตามมาตรฐาน และ font-family/font-size-adjust สืบทอดมาจาก .sheet ทั้งหมด
     จึงยังพิมพ์ออกมาเท่ากันทุกเครื่องเหมือนเดิม
     เหตุผลที่ต้องยกเว้น: พื้นที่พิมพ์กว้าง 160mm ต้องแบ่งให้ ลำดับที่/เลขที่หรือรหัส/รายการ/
     จำนวน/หมายเหตุ ครบ 5 คอลัมน์ตามแบบพิมพ์ต้นฉบับ ช่อง "รายการ" จึงเหลือ 65mm
     ที่ 14pt ใส่ชื่อครุภัณฑ์ได้แค่ ~35 ตัวอักษร ชื่อที่ยาวกว่านั้น (ซึ่งเป็นเรื่องปกติในทะเบียน
     พัสดุ เช่น "เต็นท์ผ้าใบ 4x8 เมตร พร้อมโครงเหล็ก") ตัดเป็น 2 บรรทัดทุกแถว ทำให้ตารางสูง
     จาก 62mm เป็น 110mm และดันใบ 7 รายการตกไปหน้า 2 ทั้งที่ต้นฉบับจบหน้าเดียว
     วัดจริงแล้ว 12pt คือค่าที่ทำให้ชื่อยาวปกติจบบรรทัดเดียวและยังอ่านออกชัด */
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; font-size: 12pt; }
  thead { display: table-header-group; }
  /* 7.5mm ต่อแถวคือค่าต่ำสุดที่ยังเขียนด้วยปากกาได้จริง — ต่ำกว่านี้ช่อง "รายการ" กับ
     "หมายเหตุ" เขียนไม่ลง ส่วนที่ต้องบีบให้ใบจบหน้าเดียวจึงไปบีบระยะย่อหน้าแทน */
  th, td { border: 1px solid #000; padding: 0.5mm 1.5mm; height: 7mm; vertical-align: middle; }
  th { text-align: center; font-weight: 700; }
  td.c { text-align: center; }
  /* สัดส่วนคอลัมน์วัดจากแบบพิมพ์ต้นฉบับ — รวม 100% พอดีในพื้นที่พิมพ์ 16 ซม.
     ⚠️ "จำนวน" ต้องกว้างพอใส่ "12 หลัง" ได้ในบรรทัดเดียว (13% = 20.8mm) ตอนแรกให้ 10.5%
     แล้ววัดจริงพบว่าทุกแถวตัดเป็น 2 บรรทัด ตารางสูงจาก 62mm เป็น 110mm ใบตกหน้า 2 ทันที
     ส่วน "หมายเหตุ" ยอมให้ตัดบรรทัดได้ เพราะโดยปกติเว้นว่างไว้ให้เขียนมือ */
  col.no   { width: 10%; }
  col.code { width: 18.5%; }
  col.name { width: 47.5%; }
  col.qty  { width: 13%; }
  col.note { width: 11%; }
  /* จำนวนกับหน่วยต้องไม่ถูกหั่นคนละบรรทัด */
  td.qty { white-space: nowrap; }

  .sign-line { border-bottom: 1px dotted #000; display: inline-block; min-width: 55mm; }
  .sign-block { break-inside: avoid; page-break-inside: avoid; }

  /* ⚠️ บล็อกลงนาม: บรรทัดใต้เส้นจุด (วงเล็บชื่อ/ชื่อตำแหน่ง) ต้องอยู่ "กึ่งกลางใต้เส้นจุด"
     ไม่ใช่กึ่งกลางของคอลัมน์ — เหตุผลเต็มอยู่ที่ signRow() ด้านบน
     .sign-axis เป็นกล่องเดียวที่ครอบทั้งเส้นจุดและบรรทัดใต้ align-items:center จึงบังคับให้
     ทั้งสองใช้แกนกลางเดียวกันเสมอ แม้ชื่อในวงเล็บจะยาวกว่าเส้นจุด */
  .sign-row { display: flex; align-items: flex-start; }
  /* flex: 0 1 auto + min-width: 0 ให้กล่องกว้างพอดีเนื้อหาและหดตามคอลัมน์ได้
     ถ้าใช้ flex: 1 กล่องจะยืดเต็มคอลัมน์แล้วเส้นจุดถูกดันไปกลางคอลัมน์แทน */
  .sign-axis { display: flex; flex-direction: column; align-items: center; flex: 0 1 auto; min-width: 0; }
  /* เส้นจุดยืดเต็มความกว้างของกล่อง ไม่ใช่แค่ min-width ของตัวเอง — วงเล็บชื่อยาวกว่าเส้น
     เสมอ ถ้าไม่ยืด เส้นจะถูกจัดกึ่งกลางในกล่องที่กว้างตามวงเล็บ แล้วเกิดช่องว่างคั่นระหว่าง
     คำว่า "ลงชื่อ" กับหัวเส้น ดูเหมือนพิมพ์ตกไปหนึ่งช่อง (ต้นฉบับเส้นเริ่มติดคำว่าลงชื่อ)
     min-width ยังทำงานอยู่ เป็นความกว้างขั้นต่ำเมื่อบรรทัดใต้สั้นกว่าเส้น */
  .sign-axis > .sign-line { align-self: stretch; }
  /* ⚠️ nowrap เฉพาะป้ายกำกับสองข้าง ห้ามครอบทั้งแถว — ชื่อตำแหน่งเต็ม
     ("ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว") กว้างกว่าคอลัมน์ ~76 มม. ถ้าห้ามตัดบรรทัดทั้งแถว
     กล่องจะดันล้นขอบขวากระดาษ (เคสจริงที่เทสต์ของใบขอรับการช่วยเหลือจับได้) */
  .sign-label, .sign-role { white-space: nowrap; }
  .sign-role { margin-left: 1mm; }
  /* บรรทัดใต้เส้นจุดต้องตัดคำได้เมื่อยาวเกินคอลัมน์ และจัดกึ่งกลางทุกบรรทัดที่ตัด */
  .sign-below { text-align: center; }
  /* ลายมือชื่ออิเล็กทรอนิกส์ — ตัวหนาให้เห็นว่าเป็นการลงชื่อ ไม่ใช่ชื่อที่พิมพ์ซ้ำเฉยๆ
     (แบบเดียวกับ .signed-name ในใบน้ำประปา/ใบเก็บขนขยะ) และไม่มีเส้นจุดใต้ชื่อ
     เพราะลงชื่อไปแล้ว ไม่ต้องเว้นที่ให้เซ็นซ้ำ */
  .sign-signed { text-align: center; font-weight: 700; }
  /* 10pt: บรรทัดกำกับต้องอ่านออกแต่ไม่แย่งน้ำหนักกับชื่อผู้ลงนาม และต้องไม่ดันใบตกหน้า 2
     เป็นร่องรอยให้ตรวจย้อนได้ว่าใครลงชื่อเมื่อไร — ห้ามตัดออกเวลาบีบพื้นที่ */
  .signed-note { margin: 1mm 0 0; font-size: 10pt; color: #333; line-height: 1.2; text-align: center; }
  /* .sign-row เป็น flex จึงจัดกลางหน้าด้วย text-align ของพ่อไม่ได้ ต้อง justify-content */
  .center-row .sign-row { justify-content: center; }
  .two-col { display: flex; gap: 8mm; break-inside: avoid; page-break-inside: avoid; }
  .two-col > div { flex: 1 1 0; min-width: 0; }
  .center { text-align: center; }
  /* ⚠️ ระยะคั่นถูกบีบลง 2569-09-09 เพื่อชดเชยความสูงที่เพิ่มจากการจัดบรรทัดวงเล็บชื่อ
     ให้อยู่ใต้เส้นจุด: ชื่อตำแหน่งยาว ("ปลัดองค์การบริหารส่วนตำบล…") มีที่ในกล่องแกน
     แค่ ~53mm จึงตัด 2 บรรทัด ทำให้บล็อกปลัด/นายกสูงจาก 37 เป็น 43.5mm และใบหลุด
     งบ 1 หน้า — ชดเชยที่ระยะคั่นตามลำดับความสำคัญ ห้ามไปลดขนาดฟอนต์ */
  .rule { border-top: 1px solid #000; margin: 0.7mm 0 0.4mm; }
  .note-damage { border: 1px solid #000; padding: 1.5mm; margin-top: 2mm; break-inside: avoid; }
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 1mm; }
  /* ระยะคั่นระหว่างบล็อกลงนาม — ใช้ที่เดียวกันทุกจุด ไม่กระจาย inline style */
  .gap { margin-top: 0.8mm; }
</style>
</head><body>
<div class="sheet">

  <div class="form-no">บย.${line(header?.form_no ? String(header.form_no).split('/')[0] : '', '22mm')}/${line(header?.form_no ? (String(header.form_no).split('/')[1] ?? '') : '', '22mm')}</div>

  <h1>ใบยืมพัสดุ/ครุภัณฑ์</h1>

  <!-- ⚠️ ต้องเป็น <p> เดียวที่ไหลต่อเนื่อง ห้ามแตกเป็นหลาย <p> ตามบรรทัดของต้นฉบับ
       ต้นฉบับเป็นย่อหน้าเดียวที่ข้อความไหลไปเรื่อยๆ จุดขึ้นบรรทัดเกิดจากความกว้างกระดาษ
       ไม่ใช่การขึ้นย่อหน้าใหม่ — เคยแตกเป็น 8 <p> แล้ววัดจริงที่ความกว้างพิมพ์ 160mm
       ได้หัวใบสูง 110mm (ต้นฉบับ ~43mm) เพราะค่าที่กรอกยาวดันแต่ละท่อนไปกินบรรทัดของตัวเอง
       แทนที่จะไหลต่อกัน ผลคือใบตกหน้า 2 ทั้งที่มีของแค่ 7 รายการ -->
  <p class="para justify"><span class="indent"></span>${field('ข้าพเจ้า(ชื่อผู้ยืม)', borrowerName, '62mm')} ${field('ตำแหน่ง', header?.borrower_position ?? applicant.position ?? '', '52mm')} ${field('ที่อยู่', borrowerAddress, '110mm')} ได้ยืมสิ่งของตามบัญชีรายการสิ่งของที่ยืมข้างล่างนี้ไปจากส่วนราชการ ${
    departmentName?.trim()
      ? `<span class="fill-value">${orgNameHtml(departmentName)} ${orgNameHtml(tenant)}</span>`
      : '<span class="fill-blank" style="min-width:70mm">&nbsp;</span>'
  } ${field('เพื่อ', header?.purpose ?? '', '86mm')} ${field('ตั้งแต่วันที่', thaiDateText(header?.borrow_start_date), '40mm')} ${field('ข้าพเจ้าจะนำส่งวันที่', due.day, '16mm')} ${field('เดือน', due.month, '34mm')} ${field('พ.ศ.', due.year, '20mm')} หากสิ่งของที่นำมาส่งคืนชำรุดเสียหาย หรือใช้การไม่ได้ หรือสูญหายไป ข้าพเจ้ายินดีจัดการแก้ไขซ่อมแซมให้คงสภาพเดิมโดยเสียค่าใช้จ่ายของตนเอง หรือชดใช้เป็นพัสดุประเภท ชนิด ขนาด ลักษณะ และคุณภาพอย่างเดียวกัน หรือชดใช้เป็นเงินตามราคาที่เป็นอยู่ในขณะที่ยืม ตามหลักเกณฑ์ที่กระทรวงการคลังกำหนด</p>

  <table>
    <colgroup>
      <col class="no"><col class="code"><col class="name"><col class="qty"><col class="note">
    </colgroup>
    <thead>
      <tr><th>ลำดับที่</th><th>เลขที่หรือรหัส</th><th>รายการ</th><th>จำนวน</th><th>หมายเหตุ</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <!-- ช่องผู้ยืมอยู่กลางหน้า จึงห่อ .sign-row ด้วย .center-row ให้ทั้งแถวไปอยู่กลางกระดาษ
       (ตัว .sign-row เป็น flex จึงจัดกลางด้วย text-align ของพ่อไม่ได้)

       ⚠️ ชื่อในวงเล็บดึงจากคำขอออนไลน์ (ชื่อเดียวกับที่พิมพ์ในย่อหน้าหัวใบอยู่แล้ว ไม่ใช่ข้อมูลใหม่)
       ไม่ขัดกับกติกา "ห้ามพิมพ์ชื่อลงบนเส้นลงนาม" ข้างบน — ที่ห้ามคือ "เส้น" ซึ่งยังว่างเสมอ
       ส่วนวงเล็บใต้เส้นคือ "ชื่อผู้ที่จะมาลงนาม" ตามแบบราชการ เหมือนบล็อกปลัด/นายกที่ดึงชื่อ
       จากทะเบียนผู้ลงนามมาพิมพ์อยู่แล้ว
       คำขอที่ไม่มีชื่อผู้ยื่น (เจ้าหน้าที่คีย์แทนแล้วไม่ได้กรอก) ตกไปเป็นเส้นจุดให้เขียนมือ -->
  <div class="sign-block center-row">
    ${signRow({
      role: 'ผู้ยืม',
      signed: signedOnline && borrowerName ? esc(borrowerName) : '',
      below: [signatureName({ name: borrowerName })],
    })}
    ${/* ⚠️ ไม่ใส่ชื่อหน่วยงานในบรรทัดนี้ ทั้งที่ใบน้ำประปา/ใบขยะใส่ — บรรทัดท้ายใบ (.origin)
          บอกชื่อหน่วยงานอยู่แล้ว ใส่ซ้ำทำให้ข้อความยาวจนตัด 2 บรรทัด ดันใบเป็น 271.8mm
          เกินงบ 1 หน้า (วัดจริง 2569-09-09) */''}${signedOnline
      ? `<p class="signed-note">ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service${
          signedStamp ? ` เมื่อ ${esc(signedStamp)}` : ''}${referenceNo ? ` · เลขอ้างอิง ${esc(referenceNo)}` : ''}</p>`
      : ''}
  </div>

  <div class="two-col gap">
    <div>
      <p class="para">- ได้รับของตามรายการข้างต้นแล้ว</p>
      ${signRow({ width: '42mm', role: 'ผู้รับของ', below: ['(........................................................)'] })}
    </div>
    <div>
      <p class="para">- ได้จ่ายของตามรายการข้างต้นแล้ว</p>
      ${signRow({ width: '42mm', role: 'ผู้จ่ายของ', below: ['(.......................................................)'] })}
    </div>
  </div>

  <div class="rule"></div>

  <div class="two-col">
    <div>
      <p class="para">- ความเห็น${esc(clerkTitle)}</p>
      <p class="para" style="font-weight:700">ควรอนุมัติให้ยืมได้</p>
      ${signRow({ width: '40mm', below: [signatureName(clerk), esc(clerkTitle)] })}
    </div>
    <div>
      <p class="para">- ความเห็น${esc(mayorTitle)}</p>
      <p class="para" style="font-weight:700">อนุมัติ</p>
      ${signRow({ width: '36mm', role: 'ผู้ให้ยืม', below: [signatureName(mayor), esc(mayorTitle)] })}
    </div>
  </div>

  <div class="rule"></div>

  <div class="sign-block">
    <p class="para" style="font-weight:700">- ได้รับสิ่งของตามรายการข้างต้นคืนในสภาพที่ใช้การได้เรียบร้อยและครบถ้วน</p>
    <div class="two-col gap">
      <div>
        ${signRow({ width: '34mm', role: 'ผู้ส่งคืน', below: ['(............................................)'] })}
        <p class="para nowrap">วันที่.........เดือน..................พ.ศ.........</p>
      </div>
      <div>
        ${signRow({ width: '34mm', role: 'ผู้รับคืน', below: ['(............................................)'] })}
        <p class="para nowrap">ตำแหน่ง.....................................</p>
        <p class="para nowrap">วันที่.........เดือน..................พ.ศ.........</p>
      </div>
    </div>
  </div>

${problems > 0 ? `  <div class="note-damage">
    <p class="para" style="font-weight:700">หมายเหตุ — ของที่ส่งคืนไม่ครบถ้วนตามข้อความข้างต้น</p>
${items.filter(item => (item.damaged_qty ?? 0) + (item.lost_qty ?? 0) > 0).map(item => `    <p class="para">${esc(item.asset_name_snapshot)} — ชำรุด ${item.damaged_qty} ${esc(item.unit_snapshot)} · สูญหาย ${item.lost_qty} ${esc(item.unit_snapshot)}${item.settlement_note ? ` · ${esc(item.settlement_note)}` : ''}</p>`).join('\n')}
  </div>
` : ''}
  <div class="origin">${esc(govEServiceOriginText(orgShort))}</div>
</div>
</body></html>`
}
