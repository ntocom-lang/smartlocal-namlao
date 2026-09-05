import { GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'
import { thaiDateFromDateInput } from './thaiDate.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

// ช่องกรอกในแบบฟอร์ม — มีสองสถานะเท่านั้น
//   มีค่า : พิมพ์เป็นข้อความธรรมดา (display:inline) ห้ามเป็น inline-block เด็ดขาด
//           เพราะ inline-block ในย่อหน้า text-align:justify จะถูก shrink-to-fit เป็นความกว้าง
//           ที่เหลือของบรรทัด (วัดจริงได้กล่อง 217px ทั้งที่ข้อความ 118px) แล้ว text-align:center
//           จะดันค่าไปกลางกล่อง เกิดช่องว่างค้างกลางประโยคข้างละ ~13 มม.
//   ว่าง  : กล่อง inline-block เส้นประ กว้างตาม width ที่กำหนด ให้เขียนด้วยปากกาได้
function line(value, width = '36mm', { nowrap = false } = {}) {
  const content = String(value ?? '').trim()
  if (content) {
    return `<span class="fill-value${nowrap ? ' fill-value--nowrap' : ''}">${esc(content)}</span>`
  }
  return `<span class="fill-blank" style="min-width:${width}">&nbsp;</span>`
}

// จุดวางถังที่ปักหมุดไว้ → ข้อความสำหรับใบพิมพ์
// พิกัดต้องมาก่อนชื่อสถานที่เสมอ เพราะเป็นค่าที่พนักงานเก็บขนพิมพ์ลงแอปนำทางได้ตรงๆ
// ส่วนชื่อจาก Nominatim เป็นข้อมูลช่วยจำ ยาวได้ไม่จำกัด (ของจริงที่เจอ 95 ตัวอักษร
// "ถนน..., ตำบล..., อำเภอ..., จังหวัด..., ภาคเหนือ, 54170, ประเทศไทย") จึงตัดที่ 40
// ตัวอักษร ชื่อเต็มยังดูได้ในแดชบอร์ดเจ้าหน้าที่พร้อมปุ่มนำทาง
export function collectionPointText(point) {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  const address = String(point?.address ?? '').trim()
  if (!address) return coords
  const shortAddress = address.length > 40 ? `${address.slice(0, 40)}…` : address
  return `${coords} (${shortAddress})`
}

function organizationHeadTitle(tenant) {
  const name = tenant?.name?.trim() || 'หน่วยงาน'
  if (tenant?.org_type === 'อบต.' || name.startsWith('องค์การบริหารส่วนตำบล')) {
    return `นายก${name}`
  }
  const locality = name.replace(/^เทศบาล\s*/, '').trim()
  return locality ? `นายกเทศมนตรี${locality}` : 'นายกเทศมนตรี'
}

/**
 * ใบแจ้งขออนุญาตเก็บขนขยะมูลฝอย 1 หน้า A4
 *
 * ลอกโครงจากแบบฟอร์มต้นฉบับที่ อบต.ทุ่งแค้ว ใช้จริง (ผู้ใช้ส่งไฟล์ต้นฉบับมาให้ 2569-09-05)
 * — ถ้อยคำ ลำดับย่อหน้า และช่องลงนามต้องตรงกับต้นฉบับ เจ้าหน้าที่คุ้นกับใบนี้อยู่แล้ว
 *
 * ⚠️ ห้ามแก้ "ขออนุญาต" เป็น "คำขอรับบริการ" — เคยเสนอไปแล้วด้วยเหตุผลว่าใบอนุญาตเก็บ ขน
 * สิ่งปฏิกูลหรือมูลฝอยตาม พ.ร.บ.การสาธารณสุขฯ เป็นใบอนุญาตของผู้ประกอบการ คนละเรื่องกับ
 * ประชาชนขอรับบริการ แต่ต้นฉบับของ อปท. ใช้คำนี้จริง ผู้ใช้ยืนยันให้คงไว้ตามต้นฉบับ
 *
 * ส่วนที่เพิ่มจากต้นฉบับมี 2 อย่างเท่านั้น ตามที่ผู้ใช้สั่ง:
 *   - โทรศัพท์ → เจ้าหน้าที่ต้องโทรนัดสำรวจพื้นที่กลับ
 *   - พิกัดจุดวางถัง → พนักงานเก็บขนกดนำทางได้
 * ฟิลด์อื่นที่ระบบเก็บ (เลขบัตร ประเภทสถานที่ จำนวนถัง) จงใจไม่พิมพ์ลงใบ ให้ดูในแดชบอร์ด
 *
 * ที่อยู่ในต้นฉบับฝัง "ตำบลทุ่งแค้ว อำเภอหนองม่วงไข่ จังหวัดแพร่" ไว้ตายตัว ที่นี่เปลี่ยนเป็น
 * ค่าตามหน่วยงานที่ล็อกอินอยู่ เพราะระบบใช้ร่วมกันหลาย อปท.
 *
 * ข้อมูลใน form มาจาก permit_form_data ซึ่งเป็นชื่อคอลัมน์ legacy ของ document_requests;
 * form_type ใช้แยกรูปแบบข้อมูลนี้ออกจากแบบ ข.๑ อย่างชัดเจน
 */
export function buildWasteCollectionRequestHtml({ form, tenant, thDate, referenceNo = '' }) {
  const data = form || {}
  const applicant = data.applicant || {}
  const applicantName = `${applicant.title || ''}${applicant.first || ''} ${applicant.last || ''}`.trim()
  const requestDate = thDate || ''
  const serviceStartDate = thaiDateFromDateInput(data.service_start_date)
  const orgName = tenant?.name?.trim() || 'องค์กรปกครองส่วนท้องถิ่น'
  const headTitle = organizationHeadTitle(tenant)
  const collectionPoint = collectionPointText(data.collection_point)

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ใบแจ้งขออนุญาตเก็บขนขยะมูลฝอย</title>
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
    .body-copy { text-indent: 25mm; text-align: justify; }
    /* ย่อหน้าหลักของต้นฉบับไหลต่อเนื่องเป็นข้อความเดียว (ชื่อ → อายุ → ที่อยู่ → ความประสงค์
       → วันที่เริ่ม) ห้ามแตกเป็นตาราง เพราะจะไม่เหมือนใบที่เจ้าหน้าที่ใช้อยู่ */
    .point-copy { text-indent: 25mm; }

    .fill-value { white-space: pre-wrap; }
    /* เบอร์โทรมีขีดกลางคั่น เบราว์เซอร์ตัดบรรทัดตรงขีดได้ (เจอจริง "081-" ค้างท้ายบรรทัด
       แล้ว "234-5678" ตกไปบรรทัดถัดไป) ค่าที่ห้ามขาดกลางต้อง nowrap */
    .fill-value--nowrap { white-space: nowrap; }
    .fill-blank {
      display: inline-block;
      padding: 0 .7mm;
      line-height: 1.05;
      vertical-align: baseline;
      border-bottom: 1px dotted #000;
    }

    /* ต้นฉบับไม่มีเส้น "ลงชื่อ" — เว้นที่ว่างระหว่าง "ขอแสดงความนับถือ" กับชื่อในวงเล็บ
       ให้เซ็นทับ จึงคง signature-space ไว้ 18 มม. (ต้นฉบับเว้นประมาณ 2 ซม.)
       ส่วน nowrap เป็นการแก้บั๊ก ไม่ใช่การเปลี่ยนแบบ: ชื่อยาวเคยทำให้ "(" กับ ")"
       ตกไปคนละบรรทัดจนอ่านไม่รู้เรื่อง (เคสจริง "นางสาวประกายมาศ ศรีวิชัยเลิศสกุล") */
    .signature { margin: 8mm auto 0; width: 96mm; text-align: center; }
    .signature p { margin: 0 0 2mm; white-space: nowrap; }
    .signature-space { height: 18mm; }

    /* 11pt โดยตั้งใจ — บรรทัดนี้ไม่ใช่เนื้อความของหนังสือ แต่เป็นเลขอ้างอิงของระบบที่พิมพ์
       กำกับไว้ให้ตามเรื่องได้ ต้องเล็กกว่าเนื้อความชัดเจนเพื่อไม่ให้อ่านสับสนว่าเป็นเลขที่หนังสือ
       (ลดจาก 12pt ตอนที่เนื้อความยังเป็น 16pt — พอเนื้อความเหลือ 14pt ระยะห่างเดิมแคบเกินไป) */
    .reference { margin-top: 14mm; font-size: 11pt; color: #333; }

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
    <div class="title">ใบแจ้งขออนุญาตเก็บขนขยะมูลฝอย</div>
    <p class="write-at">เขียนที่ ${line(orgName, '52mm')}</p>
    <p class="date">วันที่ ${line(requestDate, '48mm')}</p>

    <p class="subject"><strong>เรื่อง</strong><span>ขออนุญาตเก็บขนขยะมูลฝอย</span></p>
    <p class="to"><strong>เรียน</strong><span>${esc(headTitle)}</span></p>

    <p class="body-copy">
      ข้าพเจ้า ${line(applicantName, '62mm')} อายุ ${line(applicant.age, '14mm')} ปี
      บ้านเลขที่ ${line(applicant.addr_no, '22mm')} ม. ${line(applicant.addr_moo, '12mm')}
      ตำบล ${line(applicant.addr_subdistrict, '27mm')} อำเภอ ${line(applicant.addr_district, '27mm')}
      จังหวัด ${line(applicant.addr_province, '27mm')} โทรศัพท์ ${line(applicant.phone, '30mm', { nowrap: true })}
      มีความประสงค์ให้${esc(orgName)}ดำเนินการเก็บขนขยะมูลฝอย
      ตั้งแต่วันที่ ${line(serviceStartDate, '43mm')} เป็นต้นไป
    </p>

    ${collectionPoint ? `<p class="point-copy">จุดวางถังตามพิกัดแผนที่ ${line(collectionPoint)}</p>` : ''}

    <p class="body-copy">
      โดยข้าพเจ้ายินยอมชำระค่าบริการเก็บขนขยะมูลฝอยและปฏิบัติตามข้อบัญญัติท้องถิ่นที่กำหนดทุกประการ
    </p>

    <p class="body-copy">จึงเรียนมาเพื่อโปรดพิจารณาดำเนินการต่อไป</p>

    <section class="signature">
      <p>ขอแสดงความนับถือ</p>
      <div class="signature-space"></div>
      <p>(${line(applicantName, '48mm')})</p>
      <p>ผู้ขออนุญาต</p>
    </section>

    ${/* บรรทัดกำกับที่มาอยู่ล่างสุดคู่กับเลขอ้างอิง ไม่ใช่ใต้ชื่อเรื่องแบบใบคำร้อง —
         เนื้อใบนี้ต้องตรงกับต้นฉบับ อบต.ทุ่งแค้ว ห้ามแทรกข้อความเพิ่มกลางใบ */''}
    <p class="reference">
      ${esc(govEServiceOriginText(tenant))}${referenceNo ? ` &nbsp;|&nbsp; เลขอ้างอิงระบบ: ${esc(referenceNo)}` : ''}
    </p>
  </main>
</body>
</html>`
}
