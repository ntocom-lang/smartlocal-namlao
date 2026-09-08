import { GOV_FONT_LINK, govDocFontCss, govPageCss } from './govDocStyle.js'
import { orgHeadTitle, orgNameParts, orgOfficeName } from './orgTerms.js'
import { MONTHS_TH, thaiDateFromDateInput, thaiDateTimeText } from './thaiDate.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

// ช่องกรอกในแบบฟอร์ม — กติกาเดียวกับใบเก็บขนขยะ (wasteCollectionRequestPrint.js)
//   มีค่า : ข้อความธรรมดา display:inline เท่านั้น ห้าม inline-block ในย่อหน้า justify
//           เพราะจะถูก shrink-to-fit เป็นความกว้างที่เหลือของบรรทัด แล้วเกิดช่องว่างค้าง
//           กลางประโยคข้างละ ~13 มม.
//   ว่าง  : กล่องเส้นประกว้างตาม width ให้ผู้ยื่นเขียนด้วยปากกาได้
function line(value, width = '36mm', { nowrap = false } = {}) {
  const content = String(value ?? '').trim()
  if (content) {
    return `<span class="fill-value${nowrap ? ' fill-value--nowrap' : ''}">${esc(content)}</span>`
  }
  return `<span class="fill-blank" style="min-width:${width}">&nbsp;</span>`
}

/**
 * ครอบทีละคำด้วย nowrap โดยยังแตกบรรทัดที่ "ช่องว่าง" ได้ตามปกติ
 *
 * ใช้กับค่าที่มีหลายคำและยาว (ชื่อ-สกุล, วันที่ไทย) — ครอบ nowrap ทั้งก้อนจะทำให้ก้อนยาว
 * ~60 มม. ต่อท้ายบรรทัดไม่ได้ แล้วทิ้งช่องว่างท้ายบรรทัดก่อนหน้าเป็นรูใหญ่ ส่วนถ้าปล่อยอิสระ
 * เบราว์เซอร์จะตัดคำไทยตามพจนานุกรมแล้วได้ "กาศเก/ษม" กลางชื่อคน ซึ่งรับไม่ได้บนเอกสารราชการ
 */
function wordSafe(value) {
  return String(value ?? '').trim().split(/\s+/)
    .map(word => `<span class="nb">${esc(word)}</span>`)
    .join(' ')
}

/**
 * ป้ายชื่อช่อง + ช่องกรอก มัดไว้ด้วยกันไม่ให้ขึ้นบรรทัดคั่นกลาง
 *
 * ⚠️ ทำไมต้องมี (เคสจริงที่เจอจากการเรนเดอร์ใบเปล่า): กล่องเส้นประเป็น inline-block
 * แตกกลางกล่องไม่ได้ พอที่เหลือท้ายบรรทัดไม่พอ เบราว์เซอร์จะดันทั้งกล่องลงบรรทัดถัดไป
 * ทิ้งป้ายชื่อค้างท้ายบรรทัดเดิม — ใบเปล่าที่เจ้าหน้าที่พิมพ์ไว้แจกจึงออกมาเป็น
 * "…อายุ" จบบรรทัด แล้วบรรทัดใหม่ขึ้นต้นด้วยเส้นประลอยๆ อ่านไม่รู้ว่าช่องไหนของอะไร
 *
 * มัดเฉพาะตอน "ช่องว่าง" เท่านั้น ตอนมีค่าใช้โหมดใดโหมดหนึ่งตามชนิดของค่า:
 *   tight  — ป้ายเขียนติดค่าตามธรรมเนียมราชการ ("ตำบลสาธิต") ทั้งก้อน nowrap
 *   words  — ค่าหลายคำที่ยาว (ชื่อ-สกุล, วันที่ไทย) แตกได้ที่ช่องว่าง แต่ละคำไม่ขาด
 *   nowrap — ค่าที่ห้ามขาดกลางเด็ดขาดและสั้นพอ (เบอร์โทรที่มีขีดกลางคั่น)
 *   ปกติ   — ไหลอิสระ ใช้กับตัวเลขสั้นๆ (บ้านเลขที่, หมู่ที่, อายุ)
 *
 * @param {string} label ข้อความนำหน้าช่อง — ต้องเป็นข้อความคงที่ในไฟล์นี้เท่านั้น (ไม่ได้ escape)
 * @param {string} [suffix] หน่วยท้ายช่อง เช่น "ปี" ให้ติดไปกับกลุ่มด้วย จะได้ไม่ตกไปอยู่บรรทัดถัดไปลำพัง
 */
function field(label, value, width = '36mm', { nowrap = false, suffix = '', tight = false, words = false } = {}) {
  const content = String(value ?? '').trim()
  const tail = suffix ? ` ${suffix}` : ''
  if (content) {
    // tight = ป้ายชื่อเขียนติดค่าตามธรรมเนียมหนังสือราชการไทย ("ตำบลสาธิต" ไม่ใช่ "ตำบล สาธิต")
    // ต้นฉบับพิมพ์ ตำบล/อำเภอ/จังหวัด ติดกับชื่อไว้ตายตัวอยู่แล้ว พอระบบเปลี่ยนเป็นช่องกรอก
    // แล้วเว้นวรรคตามรูปแบบช่องอื่น ใบที่พิมพ์ออกเลยอ่านเป็น "ตำบล สาธิต" ซึ่งผิดธรรมเนียม
    // ครอบ nowrap ทั้งก้อนด้วย — ชื่ออำเภอเคยถูกตัดเป็น "อำเภอ เมือง / แพร่" คนละบรรทัดมาแล้ว
    if (tight) return `<span class="field-tight">${label}${esc(content)}</span>${tail}`
    if (words) return `${label} <span class="fill-value">${wordSafe(content)}</span>${tail}`
    return `${label} ${line(content, width, { nowrap })}${tail}`
  }
  return `<span class="field-blank">${label}&nbsp;<span class="fill-blank" style="min-width:${width}">&nbsp;</span>${tail}</span>`
}

/**
 * ชื่อหน่วยงานสำหรับวางกลางประโยค — แตกบรรทัดได้เฉพาะรอยต่อ "คำนำหน้า|ชื่อท้องถิ่น" จุดเดียว
 * (ดูเหตุผลเต็มที่ orgNameParts ใน orgTerms.js) ส่วนแต่ละก้อนครอบ nowrap ไว้ ห้ามตัดกลางคำ
 */
function orgNameHtml(tenant) {
  const { prefix, locality } = orgNameParts(tenant)
  if (!locality) return `<span class="org-name"><span>${esc(prefix)}</span></span>`
  // ห้ามมีช่องว่างหรือขึ้นบรรทัดระหว่างสอง span — ต้องอ่านติดกันเป็นคำเดียวเมื่ออยู่บรรทัดเดียวกัน
  return `<span class="org-name"><span>${esc(prefix)}</span><wbr><span>${esc(locality)}</span></span>`
}

/**
 * พิกัดจุดติดตั้งมาตรวัดน้ำ → ข้อความสำหรับใบพิมพ์
 *
 * พิกัดมาก่อนชื่อสถานที่เสมอ เพราะเป็นค่าที่ช่างพิมพ์ลงแอปนำทางได้ตรงๆ ส่วนชื่อจาก Nominatim
 * เป็นข้อมูลช่วยจำ
 *
 * ⚠️ ตัดที่ "รอยจุลภาค" ไม่ใช่ตัดตามจำนวนตัวอักษรดิบ — ของจริงที่ Nominatim คืนมายาว 95 ตัวอักษร
 * ("ถนน…, ตำบล…, อำเภอ…, จังหวัด…, ภาคเหนือ, 54170, ประเทศไทย") ตัดที่ตัวอักษรที่ 40 ตรงๆ
 * จะได้ "…, ประ…" ค้างกลางคำบนเอกสารราชการ (เจอจริงในใบที่ผู้ใช้พิมพ์ออกมา 2569-09-07)
 */
export function meterPointText(point) {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  const address = String(point?.address ?? '').trim()
  if (!address) return coords

  const parts = address.split(',').map(part => part.trim()).filter(Boolean)
  const kept = []
  let used = 0
  for (const part of parts) {
    // 48 ตัวอักษร = ความยาวที่ยังพอดีท้ายบรรทัดเดียวกับพิกัด ไม่ดันย่อหน้าพิกัดเป็น 2 บรรทัด
    if (used && used + part.length + 2 > 48) break
    kept.push(part)
    used += part.length + 2
  }
  // ชื่อยาวเกินตั้งแต่ก้อนแรกก็ยังต้องเก็บก้อนแรกไว้ ไม่งั้นได้พิกัดเปล่าทั้งที่ผู้ใช้ปักหมุดมา
  if (kept.length === 0) kept.push(parts[0])
  const shortened = kept.length < parts.length ? `${kept.join(', ')} …` : kept.join(', ')
  return `${coords} (${shortened})`
}

/**
 * แยกวัน/เดือน/พ.ศ. ออกจากกัน — ต้นฉบับของใบนี้พิมพ์ "วันที่.....เดือน.......พ.ศ......"
 * เป็นสามช่องแยก ไม่ใช่วันที่ไทยก้อนเดียวแบบใบเก็บขนขยะ จึงใช้ thaiDate() ตรงๆ ไม่ได้
 *
 * ใช้เวลาเครื่องของผู้พิมพ์ตีความ ISO string โดยตั้งใจ (เหตุผลเดียวกับ toDateStr ใน thaiDate.js)
 * parse ไม่ได้ให้คืนค่าว่างทั้งสามช่อง แล้วใบจะพิมพ์เป็นเส้นประให้เขียนเอง ซึ่งดีกว่า "NaN"
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

/**
 * แบบคำขออนุญาตใช้น้ำประปา 1 หน้า A4 แนวตั้ง
 *
 * ลอกโครงจากแบบฟอร์มต้นฉบับที่ อบต.ทุ่งแค้ว ใช้จริง (ผู้ใช้ส่งภาพต้นฉบับมา 2569-09-07)
 * — ลำดับย่อหน้า บล็อก "สิ่งที่ส่งมาด้วย" และช่องลงนามต้องตรงกับต้นฉบับ เจ้าหน้าที่คุ้นใบนี้อยู่แล้ว
 *
 * ต่างจากต้นฉบับ 4 จุด ทุกจุดมีเหตุผล:
 *   1. ชื่อสำนักงาน/ตำบล/อำเภอ/จังหวัด ดึงจากหน่วยงานที่ล็อกอินอยู่ ไม่ฝัง "ทุ่งแค้ว/หนองม่วงไข่/แพร่"
 *      เพราะระบบใช้ร่วมกันหลาย อปท.
 *   2. เพิ่มย่อหน้าพิกัดจุดติดตั้งมาตรวัดน้ำ (พิมพ์เฉพาะเมื่อผู้ยื่นปักหมุดมา) — ช่างประปาต้องไป
 *      เดินท่อและติดตั้งมาตรหน้างาน พิกัดกดนำทางได้ตรงกว่าบ้านเลขที่ในซอยที่ไม่มีป้าย
 *   3. ช่องลงนามรองรับลายมือชื่ออิเล็กทรอนิกส์ (ดู ⚠️ ข้างล่าง)
 *   4. บรรทัดกำกับการลงชื่อ + เลขอ้างอิงระบบอยู่ใต้ช่องลงชื่อเพียงจุดเดียว
 *
 * ⚠️ ถ้อยคำ "ขอใช้มาตรวัดน้ำที่ทาง…จัดหาให้" — ต้นฉบับที่สแกนมาอ่านได้ไม่ชัดตรงคำนี้
 * ผู้ใช้ยืนยันถ้อยคำนี้เอง (2569-09-07) ห้ามแก้เป็น "มาตรฐาน" หรือคำอื่นโดยไม่ถามเจ้าของระบบก่อน
 * ประโยคนี้ผูกพันเรื่องกรรมสิทธิ์มาตรวัดน้ำและค่าประกันมาตร ไม่ใช่ข้อความประดับ
 *
 * ⚠️ ช่องลงนามมี 2 โหมด ห้ามรวบเป็นโหมดเดียว:
 *   online  — ผู้ยื่นล็อกอินยืนยันตัวตนเอง พิมพ์ชื่อเป็นลายเซ็นได้ พร้อมบรรทัดกำกับวันเวลา
 *             และเลขอ้างอิงเป็นร่องรอยว่าใครลงชื่อ
 *   counter — เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์/รับแจ้งทางโทรศัพท์ ผู้ยื่น "ไม่ได้" ยืนยันตัวตน
 *             ในระบบ จึงต้องเว้นที่ว่างให้เซ็นด้วยปากกาเสมอ พิมพ์ชื่อแทนไม่ได้เด็ดขาด
 *   คำขอเก่าที่ไม่มี signed_by ตกมาที่โหมด counter — ถูกแล้ว ระบบย้อนหลังไปอ้างว่าเขาลงชื่อ
 *   ทางอิเล็กทรอนิกส์ไม่ได้
 *
 * ⚠️ สถานะทางกฎหมายของการพิมพ์ชื่อแทนลายมือชื่อ: อ้างอิงหลักลายมือชื่ออิเล็กทรอนิกส์ตาม
 * พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ ประกอบ พ.ร.บ.การปฏิบัติราชการทางอิเล็กทรอนิกส์
 * — ยังไม่ได้เปิดตัวบทยืนยันรายมาตรา ถ้า อปท. จะยึดใบนี้เป็นหลักฐานผูกพันค่าประกันมาตร
 * ต้องให้นิติกร/กองคลังตรวจตัวบทฉบับปัจจุบันก่อน
 *
 * ⚠️ "สิ่งที่ส่งมาด้วย" 3 รายการยังพิมพ์ไว้ตามต้นฉบับ แต่ระบบยังไม่มีช่องแนบไฟล์ในคำขอเอกสาร
 * (ทั้งแบบ ข.๑ และใบเก็บขนขยะก็ไม่มี) ผู้ยื่นออนไลน์ต้องนำสำเนาไปยื่นที่สำนักงาน — หน้าจอ
 * ยื่นคำขอต้องบอกเรื่องนี้ให้ชัด ห้ามตัดรายการนี้ออกจากใบเพราะเข้าใจว่า "ไม่มีไฟล์แนบก็ไม่ต้องมี"
 *
 * ข้อมูลใน form มาจาก permit_form_data (ชื่อคอลัมน์ legacy ของ document_requests)
 * form_type = 'water_supply_request' ใช้แยกรูปแบบข้อมูลนี้ออกจากใบขยะและแบบ ข.๑
 */
export function buildWaterSupplyRequestHtml({ form, tenant, docDate, referenceNo = '', signedAt = '' }) {
  const data = form || {}
  const applicant = data.applicant || {}
  const applicantName = `${applicant.title || ''}${applicant.first || ''} ${applicant.last || ''}`.trim()
  const officeName = orgOfficeName(tenant)
  const headTitle = orgHeadTitle(tenant)
  const { day, month, year } = thaiDateParts(docDate)
  const serviceStartDate = thaiDateFromDateInput(data.service_start_date)
  const meterPoint = meterPointText(data.meter_point)
  const orgNameTag = orgNameHtml(tenant)

  // ที่อยู่สำนักงานใต้บรรทัด "เขียนที่" — ต้นฉบับพิมพ์ไว้ 2 บรรทัด (เลขที่+หมู่+ตำบล / อำเภอ+จังหวัด)
  // ค่าใน municipalities.address เป็นข้อความหลายบรรทัดที่แอดมินพิมพ์เอง จึงตัดตามบรรทัดจริง
  // ไม่จัดรูปใหม่ — จัดใหม่แล้วจะเดาผิดกับ อปท. ที่เขียนคนละรูปแบบ
  const officeAddressLines = String(tenant?.address ?? '')
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean)

  // สถานที่ติดตั้ง: ค่าเริ่มต้นคือที่อยู่ผู้ยื่น แต่แยกเก็บไว้คนละชุด เพราะเคสจริงที่ต่างกันมี
  // (ขอมิเตอร์ให้บ้านที่กำลังสร้าง / แปลงเกษตร / บ้านเช่าที่เจ้าของอยู่คนละหลัง)
  const site = data.same_as_applicant ? applicant : (data.site || {})

  const signedOnline = data.signed_by?.channel === 'online'
  const signedStamp = signedOnline ? thaiDateTimeText(signedAt || data.signed_at) : ''

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>แบบคำขออนุญาตใช้น้ำประปา</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body {
      ${govDocFontCss()}
    }
    .sheet { width: 100%; }
    .title { margin: 6mm 0 10mm; text-align: center; font-weight: 700; }

    /* บล็อก "เขียนที่ + ที่อยู่สำนักงาน" ชิดขวาตามต้นฉบับ — ใช้ inline-block เพื่อให้ทุกบรรทัด
       เริ่มตรงกันที่ขอบซ้ายของบล็อก ไม่ใช่ชิดขวารายบรรทัดจนขอบซ้ายเป็นฟันปลา */
    .write-at { margin: 0 0 6mm; text-align: right; }
    /* จำกัดบล็อกไว้ที่ 90 มม. เพื่อให้ที่อยู่สำนักงานบรรทัดยาว (เช่น เลขที่+หมู่+ตำบล+
       อำเภอ+จังหวัด+รหัสไปรษณีย์) ขึ้นบรรทัดใหม่ได้เอง ไม่ลากบล็อกยาวล้ำเข้ากลางหน้า */
    .write-at-inner { display: inline-block; max-width: 90mm; text-align: left; }
    .write-at-inner p { margin: 0; }
    /* บรรทัดวันที่เยื้องจากขอบขวาเข้ามาเล็กน้อยตามต้นฉบับ ไม่ได้ชิดขวาสุดเหมือนบล็อกที่อยู่ */
    .date-line { margin: 0 0 8mm; text-align: right; padding-right: 12mm; }

    .subject, .to { display: grid; grid-template-columns: 18mm minmax(0, 1fr); }
    p { margin: 0 0 4mm; }

    /* สิ่งที่ส่งมาด้วย — คอลัมน์ลำดับ / รายการ / จำนวน ให้ "จำนวน ๑ ฉบับ" ตรงกันทุกบรรทัด
       ตามต้นฉบับ ห้ามใช้ tab หรือ &nbsp; ไล่ระยะ ฟอนต์ต่างเครื่องแล้วเหลื่อมทันที */
    .enclosure { margin: 0 0 6mm; display: grid; grid-template-columns: 30mm minmax(0, 1fr); }
    .enclosure-list { display: grid; grid-template-columns: 7mm minmax(0, 1fr) 30mm; row-gap: 1mm; }
    /* ⚠️ ทุกช่องต้อง nowrap — "จำนวน ๑ ฉบับ" กว้าง ~26 มม. ถ้าคอลัมน์แคบกว่านั้นจะตัดเป็น
       "จำนวน ๑ / ฉบับ" สองบรรทัด แล้วบล็อกสูงขึ้นเท่าตัว (เจอจริงตอนคอลัมน์เป็น 24 มม.)
       ค่า 30 มม. เผื่อฟอนต์สำรองที่กว้างกว่า THSarabunPSK ไว้แล้ว */
    .enclosure-list span { white-space: nowrap; }

    /* ⚠️ ห้ามเปลี่ยนเป็น text-align: justify — ลองแล้วพังจริง (2569-09-07)
       ประโยคไทยยาวติดกันแทบไม่มีช่องว่าง เบราว์เซอร์ยืดได้เฉพาะตรงช่องว่าง บรรทัดที่มีช่องว่าง
       จุดสองจุดจึงถูกยืดจนเป็นรูโหว่กลางประโยค (วัดจริงบนใบของ ทต.สาธิต: "…ตำบลสาธิต ⟨รู⟩
       ตั้งแต่วันที่" และ "ให้ ⟨รู⟩ และยินยอม…") · Chrome ไม่รองรับ text-justify จึงบังคับให้
       ยืดระหว่างตัวอักษรแทนไม่ได้ · ต้นฉบับที่ อบต. ใช้จริงก็ชิดซ้ายปลายขวาไม่เท่ากันอยู่แล้ว
       (เหตุผลเดียวกับ wasteCollectionCancelPrint.js) */
    /* แบ่งเนื้อหาหลักเป็น 3 ย่อหน้า: ข้อมูลผู้ยื่น / รายละเอียดคำขอ / ข้อตกลง
       คงระยะบรรทัด single ตามมาตรฐานกลาง แต่เว้นท้ายย่อหน้า 3 มม. เพื่อไม่ให้ข้อความ
       ทั้งหมดเกาะเป็นก้อนเดียวจนอ่านยาก โดยเฉพาะ อปท. ที่ชื่อหน่วยงานยาว */
    .body-copy { text-indent: 25mm; text-align: left; margin-bottom: 3mm; break-inside: avoid; }
    /* ย่อหน้าพิกัดไม่ใช่ส่วนหนึ่งของย่อหน้าหลัก แต่ย่อหน้าเข้ามาเท่ากันให้อ่านต่อเนื่อง
       ไม่จัดชิดขอบ เพราะเป็นบรรทัดเดียวสั้นๆ justify แล้วจะถูกยืดจนตัวอักษรห่างผิดปกติ */
    .point-copy { text-indent: 25mm; text-align: left; }

    .fill-value { white-space: pre-wrap; }
    /* เบอร์โทรมีขีดกลางคั่น เบราว์เซอร์ตัดบรรทัดตรงขีดได้ (เคสจริง "081-" ค้างท้ายบรรทัด
       แล้ว "234-5678" ตกไปบรรทัดถัดไป) ค่าที่ห้ามขาดกลางต้อง nowrap */
    .fill-value--nowrap { white-space: nowrap; }
    /* ป้ายชื่อช่อง + กล่องเส้นประ ต้องไม่ถูกตัดคั่นกลาง (ดูเหตุผลที่ฟังก์ชัน field())
       กลุ่มที่กว้างสุดคือ "ข้าพเจ้า (นาย/นาง/นางสาว) + 58mm" ≈ 103mm ยังน้อยกว่าพื้นที่พิมพ์ 160mm
       จึงไม่มีทางที่กลุ่มใดจะกว้างเกินบรรทัดจนล้นขอบ */
    .field-blank { white-space: nowrap; }
    /* ชื่อหน่วยงานอยู่กลางประโยคโดยไม่มีช่องว่างคั่น (…ของงานกิจการประปาองค์การบริหารส่วนตำบลทุ่งแค้ว…)
       เบราว์เซอร์ตัดบรรทัดไทยตามพจนานุกรม ชื่อตำบลที่ไม่อยู่ในพจนานุกรมจึงถูกตัดกลางคำ
       ห้ามแก้ด้วยการเติมช่องว่างรอบชื่อ ต้นฉบับเขียนติดกันเป็นประโยคเดียว
       — ตัวครอบต้อง normal เพื่อให้ <wbr> ที่คั่นสองก้อนทำงาน (nowrap ทำให้ <wbr> ถูกเมิน)
         ส่วนแต่ละก้อนครอบ nowrap ห้ามตัดกลางคำ */
    .org-name { white-space: normal; }
    .org-name > span { white-space: nowrap; }
    /* ป้ายชื่อที่เขียนติดค่า (ตำบล/อำเภอ/จังหวัด) ต้องไม่ขาดจากกัน — ดูเหตุผลที่ field() */
    .field-tight { white-space: nowrap; }
    /* ก้อนคำเดี่ยวที่ห้ามขาดกลางคำ แต่ยังแตกบรรทัดที่ช่องว่างได้ (ดู wordSafe()) */
    .nb { white-space: nowrap; }
    .fill-blank {
      display: inline-block;
      padding: 0 .7mm;
      line-height: 1.05;
      vertical-align: baseline;
      border-bottom: 1px dotted #000;
    }

    /* ข้อความที่ต้นฉบับขีดเส้นใต้ + ตัวหนาไว้ — เป็นข้อผูกพันเรื่องมาตรวัดน้ำ ไม่ใช่การเน้นสวยงาม
       ต้องคงการเน้นไว้ ผู้ยื่นจะได้เห็นว่าตกลงอะไรตอนลงชื่อ */
    .meter-clause { font-weight: 700; text-decoration: underline; }

    /* ช่องลงนามของใบนี้เป็นแบบ "ลงชื่อ ____ ผู้ขออนุญาต" แล้ววงเล็บชื่อบรรทัดล่าง
       (ต่างจากใบเก็บขนขยะที่ขึ้นต้นด้วย "ขอแสดงความนับถือ") — ต้นฉบับคนละแบบ ห้ามยกมาใช้ซ้ำกัน
       sign-label กว้างคงที่ เพื่อให้บรรทัดวงเล็บเยื้องมาอยู่ใต้เส้นประพอดี ไม่ใช่กะด้วยช่องว่าง */
    .signature { margin: 18mm 8mm 0 auto; width: 104mm; }
    .signature-row { display: flex; align-items: flex-start; white-space: nowrap; }
    .sign-label { display: inline-block; width: 13mm; }
    /* ⚠️ min-width ไม่ใช่ width — ชื่อที่ยาวกว่ากล่องจะล้นออกไปทับคำว่า "ผู้ขออนุญาต" ที่ต่อท้าย
       (เคสจริง "นางสาวประกายมาศ ศรีวิชัยเลิศสกุล" กว้าง ~62 มม. พิมพ์ทับกันจนอ่านไม่ออก)
       ปล่อยให้กล่องยืดตามชื่อแทน ช่องลงนามกว้างสุด ≈ 13 + 62 + 22 = 97 มม. ยังไม่เกิน 104 มม. */
    /* ชื่อบรรทัดบนและชื่อในวงเล็บอยู่ในกล่องเดียวกัน จึงใช้แกนกึ่งกลางเดียวกันเสมอ
       แม้ชื่อยาวจนกล่องขยายเกิน 54 มม. */
    .signature-name { display: flex; flex: 0 0 auto; min-width: 54mm; flex-direction: column; align-items: stretch; }
    .signature-line, .sign-paren { min-width: 54mm; text-align: center; white-space: nowrap; }
    .sign-paren { margin-top: 2mm; }
    /* ⚠️ .fill-value เป็น pre-wrap (ช่องกรอกทั่วไปต้องคงช่องว่างที่ผู้ใช้พิมพ์) ซึ่งชนะ nowrap
       ของบรรทัดลงชื่อ — ชื่อยาวในวงเล็บจึงถูกตัดขึ้นบรรทัดใหม่ ทั้งที่กล่องจัดกึ่งกลางกว้างแค่
       54 มม. (วัดจริงกับ "นางสาวประกายมาศ ศรีวิชัยเลิศสกุล" เทสต์ signature-block จับได้)
       ปล่อยให้ชื่อล้นออกนอกกล่อง 54 มม. ได้ ดีกว่า "(" กับ ")" ตกคนละบรรทัดจนอ่านไม่รู้เรื่อง */
    .signature .fill-value { white-space: nowrap; }
    /* ลายมือชื่ออิเล็กทรอนิกส์ — ตัวหนาให้เห็นว่าเป็นการลงชื่อ ไม่ใช่ชื่อที่พิมพ์ซ้ำเฉยๆ
       inline-block กว้างเท่าเส้นประเพื่อให้ "ผู้ขออนุญาต" อยู่ตำแหน่งเดียวกับโหมดเซ็นปากกา */
    .signed-name { display: block; min-width: 54mm; text-align: center; font-weight: 700; }
    .sign-role { margin-left: 1mm; }
    /* 10pt: บรรทัดกำกับต้องอ่านออกแต่ต้องไม่แย่งน้ำหนักกับชื่อผู้ลงนาม และต้องไม่ดันใบตกหน้า 2
       white-space ปกติ (ไม่ nowrap) เพราะข้อความยาวกว่าความกว้างช่องลงนาม */
    .signed-note { margin-top: 3mm; font-size: 10pt; color: #333; white-space: normal; line-height: 1.2; }

    @media screen {
      body { background: #e5e7eb; padding: 12px; }
      .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 12mm 20mm 9mm 30mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
    }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <main class="sheet" data-pdf-page>
    <div class="title">แบบคำขออนุญาตใช้น้ำประปา</div>

    <div class="write-at">
      <div class="write-at-inner">
        <p>เขียนที่ ${esc(officeName)}</p>
        ${officeAddressLines.map(part => `<p class="office-address">${esc(part)}</p>`).join('\n        ')}
      </div>
    </div>

    <p class="date-line">${field('วันที่', day, '16mm')} ${field('เดือน', month, '30mm')} ${field('พ.ศ.', year, '20mm')}</p>

    <p class="subject"><strong>เรื่อง</strong><span>ขออนุญาตใช้น้ำประปา</span></p>
    <p class="to"><strong>เรียน</strong><span>${esc(headTitle)}</span></p>

    <div class="enclosure">
      <strong>สิ่งที่ส่งมาด้วย</strong>
      <div class="enclosure-list">
        <span>๑.</span><span>สำเนาบัตรประจำตัวประชาชน</span><span>จำนวน ๑ ฉบับ</span>
        <span>๒.</span><span>สำเนาทะเบียนบ้าน</span><span>จำนวน ๑ ฉบับ</span>
        <span>๓.</span><span>แผนผังที่ตั้ง</span><span>จำนวน ๑ ฉบับ</span>
      </div>
    </div>

    <p class="body-copy">
      ${field('ข้าพเจ้า (นาย/นาง/นางสาว)', applicantName, '58mm', { words: true })} ${field('อายุ', applicant.age, '14mm', { suffix: 'ปี' })}
      ${field('อยู่บ้านเลขที่', applicant.addr_no, '22mm')} ${field('หมู่ที่', applicant.addr_moo, '12mm')}
      ${field('ตำบล', applicant.addr_subdistrict, '27mm', { tight: true })} ${field('อำเภอ', applicant.addr_district, '27mm', { tight: true })}
      ${field('จังหวัด', applicant.addr_province, '27mm', { tight: true })} ${field('เบอร์โทรศัพท์', applicant.phone, '30mm', { nowrap: true })}
    </p>

    <p class="body-copy">
      มีความประสงค์ขออนุญาตใช้น้ำประปาของงานกิจการประปา${orgNameTag}
      ${field('ตั้งแต่วันที่', serviceStartDate, '43mm', { words: true, suffix: 'เป็นต้นไป' })}
      ${field('บริเวณที่ตั้งบ้านเลขที่', site.addr_no, '22mm')} ${field('หมู่ที่', site.addr_moo, '12mm')}
      ${field('ตำบล', site.addr_subdistrict, '27mm', { tight: true })} ${field('อำเภอ', site.addr_district, '27mm', { tight: true })}
      ${field('จังหวัด', site.addr_province, '27mm', { tight: true })}
    </p>

    <p class="body-copy">
      โดยข้าพเจ้า <span class="meter-clause">ขอใช้มาตรวัดน้ำที่ทาง${orgNameTag}จัดหาให้</span>
      และยินยอมชำระเงินค่าน้ำประปาและปฏิบัติตามระเบียบข้อบังคับของ${orgNameTag}ทุกประการ
    </p>

    ${meterPoint ? `<p class="point-copy">จุดติดตั้งมาตรวัดน้ำตามพิกัดแผนที่ ${line(meterPoint)}</p>` : ''}

    <section class="signature">
      <div class="signature-row">
        <span class="sign-label">ลงชื่อ</span>
        <div class="signature-name">
          <div class="signature-line">${signedOnline
            ? `<span class="signed-name">${esc(applicantName)}</span>`
            : `<span class="fill-blank" style="min-width:54mm">&nbsp;</span>`}</div>
          <div class="sign-paren">(${line(applicantName, '44mm')})</div>
        </div>
        <span class="sign-role">ผู้ขออนุญาต</span>
      </div>
      ${signedOnline
        ? `<p class="signed-note">ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service${signedStamp ? `<br>${esc(signedStamp)}` : ''}${referenceNo ? ` · เลขอ้างอิง ${esc(referenceNo)}` : ''}</p>`
        : ''}
    </section>
  </main>
</body>
</html>`
}
