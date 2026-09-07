import { GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'
import { orgHeadTitle } from './orgTerms.js'
import { MONTHS_TH, thaiDateFromDateInput } from './thaiDate.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

// ช่องกรอกในแบบฟอร์ม — กติกาเดียวกับใบขอรับบริการ (wasteCollectionRequestPrint.js)
//   มีค่า : ข้อความธรรมดา display:inline เท่านั้น ห้าม inline-block ในย่อหน้า justify
//           เพราะจะถูก shrink-to-fit เป็นความกว้างที่เหลือของบรรทัด แล้วเกิดช่องว่างค้าง
//           กลางประโยคข้างละ ~13 มม.
//   ว่าง  : กล่องเส้นประกว้างตาม width ให้เจ้าหน้าที่/ผู้ยื่นเขียนด้วยปากกาได้
function line(value, width = '36mm', { nowrap = false } = {}) {
  const content = String(value ?? '').trim()
  if (content) {
    return `<span class="fill-value${nowrap ? ' fill-value--nowrap' : ''}">${esc(content)}</span>`
  }
  return `<span class="fill-blank" style="min-width:${width}">&nbsp;</span>`
}

function fullName(person) {
  return `${person?.title || ''}${person?.first || ''} ${person?.last || ''}`.trim()
}

/**
 * เหตุผลการยกเลิกที่จะพิมพ์ลงใบ — ต้นฉบับของ อบต.ทุ่งแค้ว พิมพ์ "ไม่มีคนอยู่บ้าน" ไว้ตายตัว
 * ระบบเปลี่ยนเป็นตัวเลือก เพราะเหตุผลเป็นข้อมูลที่กองสาธารณสุขต้องใช้ตัดสินว่าให้ยกเลิกถาวร
 * (ย้ายออก/รื้อถอน) หรือพักชั่วคราว (ไม่มีคนอยู่บ้าน) — คนละผลกับทะเบียนลูกหนี้ค่าธรรมเนียม
 */
export function cancelReasonText(form) {
  const reason = String(form?.cancel_reason ?? '').trim()
  if (reason === 'อื่นๆ') return String(form?.cancel_reason_other ?? '').trim()
  return reason
}

/**
 * ข้อความกำกับการลงชื่อทางอิเล็กทรอนิกส์ — "7 กันยายน พ.ศ. 2569 เวลา 10.32 น."
 *
 * ใช้เวลาเครื่องของผู้พิมพ์ตีความ ISO string โดยตั้งใจ (เหตุผลเดียวกับ toDateStr ใน thaiDate.js)
 * คืนค่าว่างเมื่อ parse ไม่ได้ ให้ผู้เรียกตัดบรรทัดกำกับทิ้งแทนการพิมพ์ "Invalid Date"
 */
export function signedAtText(value) {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  const hh = String(at.getHours()).padStart(2, '0')
  const mm = String(at.getMinutes()).padStart(2, '0')
  return `${at.getDate()} ${MONTHS_TH[at.getMonth()]} พ.ศ. ${at.getFullYear() + 543} เวลา ${hh}.${mm} น.`
}

/**
 * ใบแจ้งขอยกเลิกการเก็บขนขยะมูลฝอย 1 หน้า A4 แนวตั้ง
 *
 * ลอกโครงจากแบบฟอร์มต้นฉบับที่ อบต.ทุ่งแค้ว ใช้จริง (ผู้ใช้ส่งภาพต้นฉบับมา 2569-09-07)
 * — ลำดับย่อหน้า ตำแหน่งช่องลงนาม และการไหลของประโยคต้องตรงกับต้นฉบับ เพราะเจ้าหน้าที่
 * คุ้นกับหน้าตาใบนี้อยู่แล้ว
 *
 * ต่างจากต้นฉบับ 4 จุด ทุกจุดผู้ใช้สั่งเอง (2569-09-07):
 *   1. ถ้อยคำ "ขออนุญาตยกเลิก" → "ขอยกเลิก" ทั้งใบ และช่องลงนามเป็น "ผู้ยื่นคำร้อง"
 *      การเลิกใช้บริการเป็นการแสดงเจตนาของผู้รับบริการ ไม่ใช่เรื่องที่ต้องขออนุญาต อปท.
 *      (ต่างจากใบขอรับบริการที่ผู้ใช้ยืนยันให้คงคำว่า "ขออนุญาต" ไว้ตามต้นฉบับ — อย่าไล่
 *      เปลี่ยนใบนั้นตาม ใบนั้นตัดสินใจไปแล้วคนละครั้งกัน)
 *   2. ตำบล/อำเภอ/จังหวัด ดึงจากหน่วยงานที่ล็อกอินอยู่ ไม่ฝัง "ทุ่งแค้ว/หนองม่วงไข่/แพร่"
 *      เพราะระบบใช้ร่วมกันหลาย อปท.
 *   3. เพิ่มโทรศัพท์ — เจ้าหน้าที่ต้องโทรยืนยันก่อนถอนถังและปิดยอดค่าธรรมเนียม
 *   4. เพิ่มย่อหน้ารับทราบเรื่องค่าธรรมเนียมค้างชำระ (ดูคอมเมนต์ที่ย่อหน้านั้น)
 *
 * ⚠️ ช่องลงนามมี 2 โหมด ห้ามรวบเป็นโหมดเดียว:
 *   online  — ผู้ยื่นล็อกอินยืนยันตัวตนเอง พิมพ์ชื่อเป็นลายเซ็นได้ พร้อมบรรทัดกำกับวันเวลา
 *             และเลขอ้างอิงเป็นร่องรอยว่าใครลงชื่อ
 *   counter — เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์/รับแจ้งทางโทรศัพท์ ผู้ยื่น "ไม่ได้" ยืนยันตัวตน
 *             ในระบบ จึงต้องเว้นที่ว่างให้เซ็นด้วยปากกาเสมอ พิมพ์ชื่อแทนไม่ได้เด็ดขาด
 *
 * ⚠️ สถานะทางกฎหมายของการพิมพ์ชื่อแทนลายมือชื่อ: อ้างอิงหลักลายมือชื่ออิเล็กทรอนิกส์ตาม
 * พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ ประกอบ พ.ร.บ.การปฏิบัติราชการทางอิเล็กทรอนิกส์
 * — ยังไม่ได้เปิดตัวบทยืนยันรายมาตรา ถ้า อปท. จะยึดใบนี้เป็นหลักฐานปิดยอดลูกหนี้
 * ต้องให้นิติกร/กองคลังตรวจตัวบทฉบับปัจจุบันก่อน
 *
 * ข้อมูลใน form มาจาก permit_form_data (ชื่อคอลัมน์ legacy ของ document_requests)
 * form_type = 'waste_collection_cancel' ใช้แยกรูปแบบข้อมูลนี้ออกจากใบขอรับบริการและแบบ ข.๑
 */
export function buildWasteCollectionCancelHtml({ form, tenant, thDate, referenceNo = '', signedAt = '' }) {
  const data = form || {}
  const applicant = data.applicant || {}
  // ผู้ใช้บริการที่จะถูกยกเลิกอาจเป็นคนละคนกับผู้ยื่น (ลูกยื่นแทนพ่อแม่ที่ย้ายไปอยู่กับญาติ
  // เป็นเคสที่ต้นฉบับออกแบบมารองรับตั้งแต่แรก จึงมีช่องกรอกชื่อซ้ำอีกชุด)
  const subscriber = data.same_as_applicant ? applicant : (data.subscriber || {})
  const applicantName = fullName(applicant)
  const subscriberName = fullName(subscriber)
  const orgName = tenant?.name?.trim() || 'องค์กรปกครองส่วนท้องถิ่น'
  const headTitle = orgHeadTitle(tenant)
  const cancelDate = thaiDateFromDateInput(data.cancel_date)
  const reason = cancelReasonText(data)
  const signedOnline = data.signed_by?.channel === 'online'
  const signedStamp = signedOnline ? signedAtText(signedAt || data.signed_at) : ''

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ใบแจ้งขอยกเลิกการเก็บขนขยะมูลฝอย</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body {
      ${govDocFontCss()}
    }
    .sheet { width: 100%; }
    .title { margin: 6mm 0 7mm; text-align: center; font-weight: 700; }
    .write-at { text-align: right; margin: 0 0 5mm; }
    .date { text-align: center; margin: 0 0 6mm; }
    p { margin: 0 0 4mm; }
    .subject, .to { display: grid; grid-template-columns: 18mm minmax(0, 1fr); }
    /* ย่อหน้าหลักของต้นฉบับไหลต่อเนื่องเป็นข้อความเดียว (ผู้ยื่น → ที่อยู่ → ความประสงค์ →
       ผู้ใช้บริการที่จะยกเลิก → เหตุผล → วันที่มีผล) ห้ามแตกเป็นตาราง จะไม่เหมือนใบที่ใช้อยู่ */
    /* ชิดซ้ายปลายขวาไม่เท่ากัน (ragged right) ตามต้นฉบับที่ อบต. ใช้ ไม่ใช่ justify —
       ประโยคไทยในใบนี้มีช่องว่างน้อยมาก (ยาวติดกันทั้งท่อน) พอบังคับ justify แล้วบรรทัดที่มี
       ช่องว่างจุดเดียวจะถูกยืดจนเป็นรูโหว่กลางประโยค วัดจริงได้ "ทั้งนี้ ⟨ช่องว่าง 45mm⟩ ข้าพเจ้า"
       ในย่อหน้ารับทราบค่าธรรมเนียม · ต่างจากใบขอรับบริการที่ยังใช้ justify ได้เพราะย่อหน้าสั้นกว่า
       และไม่มีก้อน nowrap ยาวๆ อยู่กลางประโยค */
    .body-copy { text-indent: 25mm; text-align: left; }

    .fill-value { white-space: pre-wrap; }
    /* เบอร์โทรมีขีดกลางคั่น เบราว์เซอร์ตัดบรรทัดตรงขีดได้ (เคสจริง "081-" ค้างท้ายบรรทัด
       แล้ว "234-5678" ตกไปบรรทัดถัดไป) ค่าที่ห้ามขาดกลางต้อง nowrap */
    .fill-value--nowrap { white-space: nowrap; }
    /* ชื่อหน่วยงานอยู่กลางประโยคโดยไม่มีช่องว่างคั่น (…ขอให้องค์การบริหารส่วนตำบลทุ่งแค้วดำเนินการ…)
       เบราว์เซอร์ตัดบรรทัดไทยตามพจนานุกรม ชื่อตำบลที่ไม่อยู่ในพจนานุกรมจึงถูกตัดกลางคำ —
       เคสจริงที่วัดได้: "…ตำบลทุ่งแค้" ค้างท้ายบรรทัด แล้ว "วตรวจสอบและแจ้งผล" ขึ้นบรรทัดใหม่
       ห้ามแก้ด้วยการเติมช่องว่างรอบชื่อ ต้นฉบับเขียนติดกันเป็นประโยคเดียว */
    .org-name { white-space: nowrap; }
    .fill-blank {
      display: inline-block;
      padding: 0 .7mm;
      line-height: 1.05;
      vertical-align: baseline;
      border-bottom: 1px dotted #000;
    }

    /* ต้นฉบับไม่มีเส้น "ลงชื่อ" — เว้นที่ว่างระหว่าง "ขอแสดงความนับถือ" กับชื่อในวงเล็บ
       nowrap กันชื่อยาวทำให้ "(" กับ ")" ตกคนละบรรทัด (เคสจริง 25 ตัวอักษรขึ้นไป) */
    .signature { margin: 8mm auto 0; width: 96mm; text-align: center; }
    .signature p { margin: 0 0 2mm; white-space: nowrap; }
    /* โหมด counter เว้น 18 มม. ให้เซ็นด้วยปากกา · โหมด online ใช้ที่ว่างนี้พิมพ์ชื่อลงไปแทน
       จึงเหลือ 6 มม. พอให้ชื่อไม่ติดบรรทัด "ขอแสดงความนับถือ" */
    .signature-space { height: 18mm; }
    .signature-typed { height: 6mm; }
    /* ลายมือชื่ออิเล็กทรอนิกส์ — ตัวหนาให้เห็นว่าเป็นการลงชื่อ ไม่ใช่ชื่อที่พิมพ์ซ้ำเฉยๆ */
    .signed-name { font-weight: 700; }
    /* 10pt: บรรทัดกำกับต้องอ่านออกแต่ต้องไม่แย่งน้ำหนักกับชื่อผู้ลงนาม และต้องไม่ดันใบ
       ตกหน้า 2 · white-space ปกติ (ไม่ nowrap) เพราะข้อความยาวกว่าความกว้างช่องลงนาม */
    .signed-note { margin-top: 3mm; font-size: 10pt; color: #333; white-space: normal; line-height: 1.2; }

    /* 11pt โดยตั้งใจ — บรรทัดนี้ไม่ใช่เนื้อความของหนังสือ แต่เป็นเลขอ้างอิงของระบบที่พิมพ์
       กำกับไว้ให้ตามเรื่องได้ ต้องเล็กกว่าเนื้อความชัดเจนเพื่อไม่ให้สับสนว่าเป็นเลขที่หนังสือ */
    .reference { margin-top: 12mm; font-size: 11pt; color: #333; }

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
    <div class="title">ใบแจ้งขอยกเลิกการเก็บขนขยะมูลฝอย</div>
    <p class="write-at">เขียนที่ ${line(orgName, '52mm')}</p>
    <p class="date">วันที่ ${line(thDate || '', '48mm')}</p>

    <p class="subject"><strong>เรื่อง</strong><span>ขอยกเลิกการเก็บขนขยะมูลฝอย</span></p>
    <p class="to"><strong>เรียน</strong><span>${esc(headTitle)}</span></p>

    <p class="body-copy">
      ข้าพเจ้า ${line(applicantName, '62mm')} อายุ ${line(applicant.age, '14mm')} ปี
      อยู่บ้านเลขที่ ${line(applicant.addr_no, '22mm')} หมู่ ${line(applicant.addr_moo, '12mm')}
      ตำบล ${line(applicant.addr_subdistrict, '27mm')} อำเภอ ${line(applicant.addr_district, '27mm')}
      จังหวัด ${line(applicant.addr_province, '27mm')} โทรศัพท์ ${line(applicant.phone, '30mm', { nowrap: true })}
      มีความประสงค์ขอให้<span class="org-name">${esc(orgName)}</span> ดำเนินการยกเลิกการจัดเก็บขยะมูลฝอยของ
      ${line(subscriberName, '58mm')} อายุ ${line(subscriber.age, '14mm')} ปี
      อยู่บ้านเลขที่ ${line(subscriber.addr_no, '22mm')} หมู่ ${line(subscriber.addr_moo, '12mm')}
      ตำบล ${line(subscriber.addr_subdistrict, '27mm')} อำเภอ ${line(subscriber.addr_district, '27mm')}
      จังหวัด ${line(subscriber.addr_province, '27mm')}
      เนื่องจาก ${line(reason, '52mm')} ตั้งแต่วันที่ ${line(cancelDate, '43mm')} เป็นต้นไป
    </p>

    ${/* ย่อหน้านี้ไม่มีในต้นฉบับ — เพิ่มเพราะการยกเลิกบริการคือการปิดภาระค่าธรรมเนียมรายเดือน
         ถ้าใบไม่ระบุว่าหนี้ที่ค้างอยู่ยังต้องชำระ และไม่ระบุว่าการยกเลิกมีผลเมื่อ อปท. ตรวจสอบแล้ว
         ใบนี้จะกลายเป็นหลักฐานที่ผู้ค้างชำระใช้อ้างว่าปิดยอดแล้วตั้งแต่วันที่ยื่น ซึ่งเป็นประเด็น
         ที่ สตง. ทักได้ทันทีเรื่องการติดตามรายได้ค่าธรรมเนียม */''}
    <p class="body-copy">
      ทั้งนี้ ข้าพเจ้ารับทราบว่าการยกเลิกจะมีผลเมื่อ<span class="org-name">${esc(orgName)}</span>ตรวจสอบและแจ้งผลแล้ว
      และข้าพเจ้ายังคงมีหน้าที่ชำระค่าธรรมเนียมเก็บขนขยะมูลฝอยที่ค้างชำระจนถึงวันที่การยกเลิกมีผลให้ครบถ้วน
    </p>

    <p class="body-copy">จึงเรียนมาเพื่อโปรดพิจารณาดำเนินการต่อไป</p>

    <section class="signature">
      <p>ขอแสดงความนับถือ</p>
      ${signedOnline
        ? `<div class="signature-typed"></div>
      <p class="signed-name">${esc(applicantName)}</p>`
        : '<div class="signature-space"></div>'}
      <p>(${line(applicantName, '48mm')})</p>
      <p>ผู้ยื่นคำร้อง</p>
      ${signedOnline
        ? `<p class="signed-note">ลงชื่อโดยการยืนยันตัวตนผ่านระบบ E-Service${signedStamp ? `<br>${esc(signedStamp)}` : ''}${referenceNo ? ` · เลขอ้างอิง ${esc(referenceNo)}` : ''}</p>`
        : ''}
    </section>

    ${/* บรรทัดกำกับที่มาอยู่ล่างสุดคู่กับเลขอ้างอิง ไม่ใช่ใต้ชื่อเรื่อง — เนื้อใบต้องตรงกับต้นฉบับ
         ห้ามแทรกข้อความของระบบกลางใบ */''}
    <p class="reference">
      ${esc(govEServiceOriginText(tenant))}${referenceNo ? ` &nbsp;|&nbsp; เลขอ้างอิงระบบ: ${esc(referenceNo)}` : ''}
    </p>
  </main>
</body>
</html>`
}
