// แบบ ข.๑ สำหรับพิมพ์เป็นแบบร่าง 3 หน้า A4
// ผู้ขอต้องลงลายมือชื่อและยื่นเอกสาร/แบบแปลนให้เจ้าพนักงานท้องถิ่นตรวจตามขั้นตอนจริง
// ช่องของเจ้าหน้าที่ ผู้ออกแบบ ผู้ควบคุมงาน และจำนวนชุดเอกสารเว้นไว้ให้กรอกภายหลัง

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function line(value, width = '28mm') {
  const content = value === null || value === undefined || value === '' ? '&nbsp;' : esc(value)
  return `<span class="fill-line" style="min-width:${width}">${content}</span>`
}

function checkbox(checked) {
  return `<span class="checkbox" aria-hidden="true">${checked ? '✓' : ''}</span>`
}

function field(label, value, width) {
  return `<span class="nowrap">${label}${line(value, width)}</span>`
}

function addressLines(address, firstLabel = 'เลขที่') {
  const data = address || {}
  return `
    <p class="form-row">
      ${field(firstLabel, data.addr_no, '14mm')}
      ${field('ตรอก/ซอย', data.addr_soi, '25mm')}
      ${field('ถนน', data.addr_road, '27mm')}
      ${field('หมู่ที่', data.addr_moo, '12mm')}
    </p>
    <p class="form-row">
      ${field('ตำบล/แขวง', data.addr_subdistrict, '29mm')}
      ${field('อำเภอ/เขต', data.addr_district, '29mm')}
      ${field('จังหวัด', data.addr_province, '29mm')}
    </p>`
}

function contactLine(address) {
  const data = address || {}
  return `<p class="form-row">
    ${field('รหัสไปรษณีย์', data.addr_zipcode, '19mm')}
    ${field('โทรศัพท์', data.phone, '31mm')}
    ${field('โทรสาร', data.fax, '31mm')}
  </p>`
}

const LAND_DOCUMENTS = ['โฉนดที่ดิน', 'น.ส.๓', 'น.ส.๓ ก.', 'ส.ค.๑', 'อื่น ๆ']

function normalizedLandType(value) {
  return String(value || '').replace(/\s/g, '').replace(/\.$/, '')
}

function landLines(land) {
  const data = land || {}
  const selected = normalizedLandType(data.land_doc_type)
  const options = LAND_DOCUMENTS.map(label => {
    const key = normalizedLandType(label)
    const checked = selected === key
    const detail = checked && key === 'อื่นๆ' && data.land_doc_type_other
      ? ` ${line(data.land_doc_type_other, '17mm')}`
      : ''
    return `<span class="nowrap">${checkbox(checked)} ${label}${detail}</span>`
  }).join('')

  const owner = data.land_owner_same ? 'ผู้ขออนุญาต' : data.land_owner_name
  return `
    <p class="form-row land-options"><span>ในที่ดิน</span>${options}${field('เลขที่', data.land_doc_no, '24mm')}</p>
    <p>เป็นที่ดินของ ${line(owner, '76mm')}</p>`
}

function pageNumber(number) {
  return `<div class="page-number">${number}</div>`
}

function officeBox() {
  return `<div class="top-area">
    <div></div>
    <div class="office-column">
      <div class="form-code">แบบ ข. ๑</div>
      <div class="office-box">
        <div class="office-title">สำหรับเจ้าหน้าที่</div>
        <div>เลขรับที่ ${line('', '40mm')}</div>
        <div>วันที่ ${line('', '45mm')}</div>
        <div>ลงชื่อ ${line('', '35mm')} ผู้รับคำขอ</div>
      </div>
    </div>
  </div>`
}

function buildingItem(number, building, suffix = '') {
  const kind = suffix ? building[`kind${suffix}`] : building.kind
  const count = suffix ? building[`count${suffix}`] : building.count
  const purpose = suffix ? building[`use${suffix}`] : building.use
  const parkingCount = suffix ? building[`parking_count${suffix}`] : building.parking_count

  return `<div class="building-item">
    <p class="form-row">
      <span>(${number})</span>
      ${field('ชนิด', kind, '44mm')}
      ${field('จำนวน', count, '18mm')}
      ${field('เพื่อใช้เป็น', purpose, '43mm')}
    </p>
    <p class="building-detail">
      โดยมีที่จอดรถ ที่กลับรถ และทางเข้าออกของรถ จำนวน ${line(parkingCount, '13mm')} คัน
    </p>
  </div>`
}

function checklistItem(number, text, tail = '') {
  return `<p class="checklist-item"><span>(${number})</span><span>${text}${tail}</span></p>`
}

function splitThaiDate(thDate) {
  const match = String(thDate || '').trim().match(/^(\d{1,2})\s+(\S+)(?:\s+พ\.ศ\.\s+(\d{4}))?$/)
  return { day: match?.[1] || '', month: match?.[2] || '', year: match?.[3] || '' }
}

export function buildBuildingPermitHtml({ form, tenant, thDate }) {
  const data = form || {}
  const applicant = data.applicant || {}
  const site = data.site || {}
  const moveTo = data.move_to || {}
  const building = data.building || {}
  const applicantName = `${applicant.title || ''}${applicant.first || ''} ${applicant.last || ''}`.trim()
  const date = splitThaiDate(thDate)
  const requestTypes = ['ก่อสร้างอาคาร', 'ดัดแปลงอาคาร', 'รื้อถอนอาคาร', 'เคลื่อนย้ายอาคาร']
  const requestTypeOptions = requestTypes
    .map(type => `<span class="nowrap">${checkbox(data.request_type === type)} ${type}</span>`)
    .join('')

  const movingSection = `<p class="indent">กรณีการเคลื่อนย้ายอาคารไปยังบ้านเลขที่ ${line(moveTo.addr_no, '18mm')}
      ${field('ตรอก/ซอย', moveTo.addr_soi, '26mm')}
      ${field('ถนน', moveTo.addr_road, '27mm')}
      ${field('หมู่ที่', moveTo.addr_moo, '12mm')}</p>
    <p class="form-row">
      ${field('ตำบล/แขวง', moveTo.addr_subdistrict, '29mm')}
      ${field('อำเภอ/เขต', moveTo.addr_district, '29mm')}
      ${field('จังหวัด', moveTo.addr_province, '29mm')}
    </p>
    ${landLines(moveTo)}`

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>แบบ ข.๑ — ${esc(applicantName || 'คำขออนุญาตก่อสร้าง')}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background:#e5e7eb;color:#111;font-family:"TH Sarabun New","Sarabun",Tahoma,sans-serif;font-size:10.5pt;line-height:1.36; }
  .form-page { position:relative;width:210mm;height:297mm;margin:8mm auto;padding:13mm 19mm 12mm;overflow:hidden;background:#fff;page-break-after:always;break-after:page;box-shadow:0 2px 12px rgba(15,23,42,.16); }
  .form-page:last-child { page-break-after:auto;break-after:auto; }
  p { margin:0 0 1.7mm; }
  .nowrap { white-space:nowrap; }
  .fill-line { display:inline-block;min-height:5mm;margin:0 1.1mm;padding:0 .8mm;border-bottom:.3mm dotted #555;vertical-align:baseline;text-align:center;line-height:1.15; }
  .checkbox { display:inline-flex;width:3.7mm;height:3.7mm;margin-right:.6mm;border:.3mm solid #222;align-items:center;justify-content:center;font-size:9pt;line-height:1;vertical-align:-.5mm; }
  .form-row { display:flex;flex-wrap:wrap;align-items:baseline;column-gap:3.2mm;row-gap:1mm; }
  .indent { text-indent:9mm; }
  .top-area { display:grid;grid-template-columns:1fr 60mm;min-height:38mm; }
  .office-column { text-align:right; }
  .form-code { margin:0 1mm 3mm 0; }
  .office-box { width:60mm;padding:2mm 3mm 1.5mm;border:.3mm solid #333;text-align:left;line-height:1.55; }
  .office-title { text-align:center;margin-bottom:.5mm; }
  .document-title { margin:3mm 0 5mm;text-align:center;font-size:12pt;font-weight:400; }
  .written-at { margin-left:auto;width:104mm; }
  .request-options { display:flex;flex-wrap:wrap;gap:1.2mm 5mm;margin:0 0 2mm 9mm; }
  .land-options { column-gap:2.7mm; }
  .page-number { position:absolute;top:7mm;left:0;right:0;text-align:center; }
  .page-content { padding-top:7mm; }
  .building-item { margin:1.2mm 0 2.2mm 9mm; }
  .building-detail { padding-left:9mm; }
  .section { margin-top:2.2mm; }
  .checklist { margin-top:1mm;font-size:9.7pt;line-height:1.25; }
  .checklist-item { display:grid;grid-template-columns:9mm 1fr;margin-bottom:1.2mm; }
  .signature { width:92mm;margin:12mm 0 0 auto;text-align:center; }
  .notes { margin-top:16mm;padding-left:9mm;font-size:9.5pt; }
  .notes p { margin-bottom:1mm; }
  @media print { body { background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact; } .form-page { margin:0;box-shadow:none; } }
</style></head><body>
<section class="form-page" data-pdf-page>
  ${officeBox()}
  <h1 class="document-title">คำขออนุญาตก่อสร้าง ดัดแปลง รื้อถอน หรือเคลื่อนย้ายอาคาร</h1>
  <div class="written-at">
    <p>${field('เขียนที่', tenant?.name || '', '55mm')}</p>
    <p>วันที่ ${line(date.day, '12mm')} เดือน ${line(date.month, '29mm')} พ.ศ. ${line(date.year, '17mm')}</p>
  </div>
  <p class="indent">ข้าพเจ้า ${line(applicantName, '80mm')} เจ้าของอาคารหรือตัวแทนเจ้าของอาคาร</p>
  <p>${checkbox(true)} เป็นบุคคลธรรมดา เลขประจำตัวประชาชน ${line(applicant.id_card, '61mm')}</p>
  ${addressLines(applicant, 'อยู่บ้านเลขที่')}
  ${contactLine(applicant)}
  <p>${checkbox(false)} เป็นนิติบุคคลประเภท ${line('', '48mm')} จดทะเบียนเมื่อ ${line('', '37mm')}</p>
  <p>${field('เลขทะเบียน', '', '42mm')} ${field('มีสำนักงานตั้งอยู่เลขที่', '', '28mm')}</p>
  <p class="form-row">
    ${field('ตรอก/ซอย', '', '25mm')}
    ${field('ถนน', '', '27mm')}
    ${field('หมู่ที่', '', '12mm')}
  </p>
  <p class="form-row">
    ${field('ตำบล/แขวง', '', '29mm')}
    ${field('อำเภอ/เขต', '', '29mm')}
    ${field('จังหวัด', '', '29mm')}
  </p>
  ${contactLine(null)}
  <p>โดยมี ${line('', '78mm')} เป็นผู้มีอำนาจลงชื่อแทนนิติบุคคลผู้ขออนุญาต</p>
  ${addressLines(null, 'อยู่บ้านเลขที่')}
  ${contactLine(null)}
  <p class="section indent">ข้อ ๑ ขอยื่นคำขอรับใบอนุญาตต่อเจ้าพนักงานท้องถิ่น เพื่อทำการ</p>
  <div class="request-options">${requestTypeOptions}</div>
  <p>ที่อาคารจะทำการดังกล่าวตั้งอยู่</p>
  ${addressLines(site)}
  <p>โดยมี ${line(site.building_owner_same ? applicantName : site.building_owner_name, '77mm')} เป็นเจ้าของอาคาร</p>
  ${landLines(site)}
  ${movingSection}
</section>

<section class="form-page" data-pdf-page>
  ${pageNumber('๒')}
  <div class="page-content">
    <p class="indent">ข้อ ๒ เป็นอาคาร</p>
    ${buildingItem('๑', building)}
    ${buildingItem('๒', building, '2')}
    ${buildingItem('๓', building, '3')}
    <p class="indent">ตามแผนผังบริเวณ แบบแปลน รายการประกอบแบบแปลน และรายการคำนวณที่แนบมาพร้อมนี้</p>
    <p class="section indent">ข้อ ๓ มี ${line('', '66mm')} เลขประจำตัวประชาชน ${line('', '45mm')}</p>
    <p class="indent">เลขทะเบียนผู้ประกอบวิชาชีพวิศวกรรมควบคุม เลขที่ ${line('', '42mm')} เป็นผู้ออกแบบและคำนวณ</p>
    <p class="section indent">ข้อ ๔ มี ${line('', '66mm')} เลขประจำตัวประชาชน ${line('', '45mm')}</p>
    <p class="indent">เลขทะเบียนผู้ประกอบวิชาชีพสถาปัตยกรรมควบคุม เลขที่ ${line('', '42mm')} เป็นผู้ออกแบบ</p>
    <p class="section indent">ข้อ ๕ กำหนดแล้วเสร็จใน ${line(data.completion_days, '18mm')} วัน นับแต่วันที่ได้รับใบอนุญาต</p>
    <p class="section indent">ข้อ ๖ ข้าพเจ้าได้แนบเอกสารหลักฐานต่าง ๆ มาพร้อมกับคำขอนี้ด้วยแล้ว ดังนี้</p>
    <div class="checklist">
      ${checklistItem('๑', 'สำเนาเอกสารแสดงการเป็นเจ้าของอาคาร')}
      ${checklistItem('๒', 'หนังสือแสดงความเป็นตัวแทนของเจ้าของอาคาร')}
      ${checklistItem('๓', 'หนังสือแสดงว่าเป็นผู้จัดการหรือผู้แทนซึ่งเป็นผู้ดำเนินกิจการของนิติบุคคล (กรณีนิติบุคคลเป็นผู้ขออนุญาต)')}
      ${checklistItem('๔', 'แผนผังบริเวณ แบบแปลน และรายการประกอบแบบแปลน จำนวน ', `${line('', '12mm')} ชุด ชุดละ ${line('', '12mm')} แผ่น`)}
      ${checklistItem('๕', 'รายการคำนวณหนึ่งชุด จำนวน ', `${line('', '12mm')} แผ่น (กรณีที่เป็นอาคารสาธารณะ อาคารพิเศษ หรืออาคารที่ก่อสร้างด้วยวัสดุถาวรและวัสดุทนไฟเป็นส่วนใหญ่)`)}
      ${checklistItem('๖', 'มาตรการรื้อถอนอาคาร จำนวนหนึ่งชุด ชุดละ ', `${line('', '12mm')} แผ่น (กรณีที่เป็นอาคารสาธารณะ อาคารพิเศษ หรืออาคารที่ก่อสร้างด้วยวัสดุถาวรและวัสดุทนไฟเป็นส่วนใหญ่)`)}
      ${checklistItem('๗', 'หนังสือรับรองของผู้ออกแบบอาคารหรือผู้ออกแบบและคำนวณอาคาร และสำเนาใบอนุญาตเป็นผู้ประกอบวิชาชีพสถาปัตยกรรมควบคุมหรือวิชาชีพวิศวกรรมควบคุม (กรณีที่อาคารมีลักษณะหรือขนาดที่อยู่ในประเภทวิชาชีพสถาปัตยกรรมควบคุมหรือวิชาชีพวิศวกรรมควบคุม ตามกฎหมายว่าด้วยการนั้น แล้วแต่กรณี)')}
      ${checklistItem('๘', `หนังสือแสดงความยินยอมของผู้ควบคุมงาน ชื่อ ${line('', '44mm')} และสำเนาใบอนุญาตเป็นผู้ประกอบวิชาชีพสถาปัตยกรรมควบคุมหรือวิชาชีพวิศวกรรมควบคุม (กรณีที่อาคารมีลักษณะหรือขนาดที่อยู่ในประเภทวิชาชีพสถาปัตยกรรมควบคุมหรือวิชาชีพวิศวกรรมควบคุม ตามกฎหมายว่าด้วยการนั้น แล้วแต่กรณี และมีความประสงค์จะยื่นพร้อมคำขออนุญาตนี้)`)}
      ${checklistItem('๙', 'หนังสือรับรองการได้รับอนุญาตให้เป็นผู้ประกอบวิชาชีพสถาปัตยกรรมควบคุม หรือผู้ประกอบวิชาชีพวิศวกรรมควบคุม ที่ออกโดยสภาสถาปนิกหรือสภาวิศวกร แล้วแต่กรณี จำนวน ', `${line('', '12mm')} แผ่น`)}
      ${checklistItem('๑๐', `ข้อมูล ${LAND_DOCUMENTS.map(label => `${checkbox(normalizedLandType(site.land_doc_type) === normalizedLandType(label))} ${label}`).join(' ')} เลขที่ ${line(site.land_doc_no, '25mm')} (ผู้ยื่นคำขออาจแนบสำเนาเอกสารดังกล่าวมาด้วยก็ได้)`)}
      ${checklistItem('๑๑', `หนังสือยินยอมของเจ้าของที่ดิน ในกรณีที่ก่อสร้างอาคารในที่ดินของผู้อื่น ${checkbox(site.land_owner_same === false)}`)}
    </div>
  </div>
</section>

<section class="form-page" data-pdf-page>
  ${pageNumber('๓')}
  <div class="page-content">
    <p class="checklist-item"><span>(๑๒)</span><span>เอกสารอื่น ๆ (ถ้ามี)</span></p>
    <p>${line('', '155mm')}</p><p>${line('', '155mm')}</p>
    <div class="signature">
      <p>(ลายมือชื่อ) ${line('', '58mm')} ผู้ขออนุญาต</p>
      <p>(${line(applicantName, '60mm')})</p>
    </div>
    <div class="notes">
      <p><strong>หมายเหตุ</strong> ๑. ข้อความใดที่ไม่ต้องการให้ขีดฆ่า</p>
      <p>๒. ใส่เครื่องหมาย ✓ ในช่อง ${checkbox(false)} หน้าข้อความที่ต้องการ</p>
      <p>๓. ในกรณีที่เป็นนิติบุคคล หากข้อบังคับกำหนดให้ต้องประทับตรา ให้ประทับตรานิติบุคคลด้วย</p>
    </div>
  </div>
</section>
</body></html>`
}
