import { GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, GOV_PAGE_MARGIN, govDocFontCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'
import { GOV_SIGN_LINE_W_WIDE, govNameBlank, govSignBlockCss, govSignRow, govSplitActingTitle } from './govSignBlock.js'

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ค่าในช่องที่ความกว้างมาจาก flex (.fill) ต้องคืนสตริงว่างเมื่อไม่มีข้อมูล ห้ามคืนจุดไข่ปลา
// ยาวๆ เพราะจุดจะดันช่องให้กว้างเกินบรรทัดแล้วตกบรรทัด (เจอจริง: "ในท้องที่ ... จังหวัด"
// ตกลงไปคนละบรรทัดกับต้นฉบับ) ช่องว่างใช้เส้นประจาก border-bottom ช่องที่มีค่าแล้วไม่ขีด
function fillText(value) {
  const text = String(value ?? '').trim()
  return text ? esc(text) : ''
}

function filledClass(value) {
  return String(value ?? '').trim() ? ' is-filled' : ''
}

function thaiDateParts(value) {
  if (!value) return { day: '', month: '', year: '', time: '' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { day: '', month: '', year: '', time: '' }
  const base = { timeZone: 'Asia/Bangkok' }
  const part = (options, type) => new Intl.DateTimeFormat('th-TH-u-ca-buddhist', options)
    .formatToParts(date).find(item => item.type === type)?.value || ''
  return {
    day: part({ ...base, day: 'numeric' }, 'day'),
    month: new Intl.DateTimeFormat('th-TH', { ...base, month: 'long' }).format(date),
    year: part({ ...base, year: 'numeric' }, 'year'),
    time: new Intl.DateTimeFormat('th-TH', {
      ...base, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date),
  }
}

function organizationHeadTitle(tenant) {
  const name = tenant?.name?.trim() || 'หน่วยงาน'
  if (tenant?.org_type === 'อบต.' || name.startsWith('องค์การบริหารส่วนตำบล')) {
    return `นายก${name}`
  }
  // คงคำว่า นคร/เมือง/ตำบล ไว้ เช่น "เทศบาลตำบลน้ำเลา" → "นายกเทศมนตรีตำบลน้ำเลา"
  const locality = name.replace(/^เทศบาล\s*/, '').trim()
  return locality ? `นายกเทศมนตรี${locality}` : 'นายกเทศมนตรี'
}

function profilePosition(profile) {
  return profile?.job_title?.trim() || profile?.position?.name?.trim() || ''
}

function meterText(value) {
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? esc(number.toLocaleString('th-TH')) : ''
}

// dateRow = บรรทัด "......... (วัน เดือน ปี)" ใต้ลายเซ็น ตามแบบ 3 ท้ายระเบียบ มท. พ.ศ. ๒๕๖๙
// (ผู้อำนวยการสำนัก/กอง และผู้มีอำนาจสั่งใช้ ต้องลงวันที่กำกับลายเซ็นของตัวเอง)
function signatureBlock({ role, name = '', title = '', suffix = '', dateRow = false }) {
  const inner = String(name ?? '').trim()
  const nameText = inner
    ? `(${esc(inner)})`
    : '<span>(</span><span>)</span>'
  return `<div class="signature">
    <div class="signature-row">
      <span>(ลงชื่อ)</span>
      <span class="signature-line"></span>
      <span class="signature-role">${esc(role)}</span>
    </div>
    <div class="signature-row signature-name-row">
      <span></span>
      <span class="signature-name${inner ? '' : ' is-blank'}">${nameText}${suffix ? `<span class="signature-suffix"> ${esc(suffix)}</span>` : ''}</span>
      <span></span>
    </div>
    ${title ? `<div class="signature-row"><span></span><span class="signature-title"><span class="signature-title-text">${govSplitActingTitle(title).map(esc).join('<br>')}</span></span><span></span></div>` : ''}
    ${dateRow ? `<div class="signature-row signature-date-row">
      <span></span>
      <span class="signature-line"></span>
      <span class="signature-role">(วัน เดือน ปี)</span>
    </div>` : ''}
  </div>`
}

// ผู้มีอำนาจสั่งใช้รถต้องมาจาก "ผู้ลงนามที่ อปท. ตั้งค่าไว้" (document_signatories บทบาท mayor)
// ไม่ใช่บัญชีที่กดอนุมัติในระบบ — คนกดอนุมัติในระบบอาจเป็นผู้ดูแลระบบยานพาหนะที่ไม่ได้เป็น
// ผู้มีอำนาจสั่งใช้รถตามคำสั่งมอบอำนาจ ถ้าพิมพ์ชื่อคนกดลงช่องนั้นคือระบุตัวผู้มีอำนาจผิด
// ยังไม่ได้ตั้งค่า = เว้นว่างให้เซ็นสด ห้ามเดาชื่อแทน
// role บอกว่าช่องนี้ถูกตั้งให้เป็นนายกหรือปลัด — สำคัญตรง fallback ของตำแหน่ง:
// organizationHeadTitle(tenant) คืน "นายกเทศมนตรี..." ซึ่งใช้ได้เฉพาะกรณีนายกเท่านั้น
// ถ้าเอามาเติมให้ปลัดที่ยังไม่ได้ตั้งชื่อตำแหน่ง เอกสารจะระบุตำแหน่งผู้ลงนามผิดตัว
// ปลัดที่ไม่มีตำแหน่งในโปรไฟล์จึงเว้นว่างไว้ให้เขียนสด ห้ามเดาแทน
export function resolveOrderAuthority(signatory, tenant, role = 'mayor') {
  const name = signatory?.manual_name?.trim()
    || signatory?.profile?.full_name?.trim()
    || ''
  const title = signatory?.title_override?.trim()
    || profilePosition(signatory?.profile)
    || (role === 'mayor' ? organizationHeadTitle(tenant) : '')
  return { name, title }
}

// ช่อง "ผู้อำนวยการสำนัก/กอง" ใช้ชื่อตำแหน่งที่ อปท. ระบุไว้ในทะเบียนเป็นป้ายบทบาท
// บนเส้นลงนามแทนคำกลางๆ ของแบบฟอร์ม — ระบุตรงตัวกว่าและไม่ได้เพิ่มบรรทัดใหม่
// (การพิมพ์ตำแหน่งเป็นบรรทัดที่สองใต้ชื่อจะดันความสูงจนใบเกิน 1 หน้า A4 ซึ่งเป็น
// ข้อบังคับของแบบฟอร์มนี้ จึงแทนที่ป้ายเดิมแทนการเพิ่ม)
// ยังไม่ได้ตั้งผู้ลงนามของกองนั้น = เว้นว่างให้เซ็นสดและคงป้ายกลางไว้ ห้ามเดาชื่อแทน
export function resolveDeptHead(signatory) {
  return {
    name: signatory?.manual_name?.trim()
      || signatory?.profile?.full_name?.trim()
      || '',
    title: signatory?.title_override?.trim()
      || profilePosition(signatory?.profile)
      || '',
  }
}

export function buildFleetTripRequestHtml({ trip, tenant, orderAuthority = null, deptHead = null }) {
  // requester ผูกกับ requested_by (ผู้ขอตัวจริง) แล้ว — ทริปเก่าที่ยังไม่ถูก backfill ถอยไปใช้ผู้บันทึก
  const requesterName = trip?.requester?.full_name || trip?.creator?.full_name || ''
  const requesterPosition = trip?.requester_position || profilePosition(trip?.requester)
  const driverName = trip?.driver?.full_name || ''
  const approverName = trip?.approver?.full_name || ''
  const vehiclePlate = trip?.vehicle?.license_plate || trip?.vehicle?.asset_code || ''
  // document_date = วันที่เอกสารที่แก้ไขได้ตอนบันทึกย้อนหลัง ไม่มีค่า (รายการเดิม/ขอใช้รถตามปกติ)
  // ให้ถอยไปใช้ created_at เหมือนเดิม — created_at เองต้องคงเป็นเวลาบันทึกจริงเพื่อ audit เสมอ
  const requestedAt = thaiDateParts(trip?.document_date || trip?.created_at)
  // หลังเริ่ม/จบทริปต้องใช้เวลาปฏิบัติจริงก่อน ส่วนรายการที่ยังไม่ออกเดินทางใช้เวลาตามคำขอ
  const departure = thaiDateParts(trip?.started_at || trip?.planned_departure)
  const returned = thaiDateParts(trip?.returned_at || trip?.planned_return)
  const passengers = Number.isInteger(Number(trip?.passengers)) ? Number(trip.passengers) : ''
  const destinationProvince = String(trip?.destination_province || '').replace(/^จังหวัด\s*/, '')
  const authority = orderAuthority?.name || orderAuthority?.title
    ? orderAuthority
    : { name: '', title: organizationHeadTitle(tenant) }
  // รายการย้อนหลังถูกสร้างเป็น completed โดยไม่มีขั้นอนุมัติ ห้ามติ๊ก “อนุมัติ” ให้เอง
  const approved = Boolean(trip?.approved_by || approverName)
    && ['approved', 'in_progress', 'completed'].includes(trip?.status)
  const rejected = trip?.status === 'rejected'
  const destination = String(trip?.destination || '').trim()
  const purpose = String(trip?.purpose || '').trim()
  const rejectReason = rejected ? String(trip?.reject_reason || '').trim() : ''
  const plate = String(vehiclePlate || '').trim()
  const odoStart = meterText(trip?.odometer_start)
  const odoEnd = meterText(trip?.odometer_end)
  const distance = meterText(trip?.distance_km)

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>ใบขออนุญาตใช้ยานพาหนะส่วนกลาง/รถรับรอง</title>
  ${GOV_FONT_LINK}
  <style>
    /* ทั้งใบต้องจบใน 1 หน้า A4 เท่าต้นฉบับกระดาษ ตัวเลขระยะห่างด้านล่างถูกไล่ให้ความสูงรวม
       ไม่เกินพื้นที่พิมพ์แล้ว ถ้าจะเพิ่มบรรทัด/ระยะห่าง ต้องวัดใหม่ทุกครั้ง
       @page = ขอบตอนพิมพ์จากเว็บ; .sheet padding = ขอบตอนดูบนจอ ห้ามซ้อนกันตอน print */
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    .sheet {
      width: 210mm;
      padding: ${GOV_PAGE_MARGIN};
      color: #000;
      ${govDocFontCss()}
      background: #fff;
    }
    @media print {
      .sheet { width: auto; padding: 0; }
    }
    p { margin: 0; }
    .form-no { text-align: right; font-weight: 400; }
    h1 { margin: 2pt 0 0; text-align: center; font-size: 18pt; font-weight: 700; line-height: 1.25; white-space: nowrap; }
    .date-line { margin-top: 12pt; text-align: right; }
    .body-line { margin-top: 6pt; }
    .field { display: inline-block; min-width: 74px; border-bottom: 1px dotted #333; padding: 0 6px 1px; text-align: center; }
    .field-medium { min-width: 130px; }
    .line-row { display: flex; align-items: baseline; gap: 6px; margin-top: 5pt; }
    .line-row .fill { flex: 1; min-width: 0; min-height: 1.15em; border-bottom: 1px dotted #333; padding: 0 6px 1px; }
    .line-row .fill-narrow { flex: 0.6; }
    .line-row .fill-tiny { flex: 0 0 58px; text-align: center; }
    .field.is-filled, .fill.is-filled, .line-row .fill.is-filled { border-bottom: none; }
    .requester-line { margin-top: 8pt; }
    .requester-line .indent { margin-left: 1.6cm; }
    .requester-line .fill:last-child { flex: 1.25; }
    .continuation { height: 1.15em; border-bottom: 1px dotted #333; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 5mm; text-align: center; }
    /* ระยะห่างบล็อกลายเซ็นถูกบีบลงหลังขยายตัวอักษรเป็น 16pt ตามมาตรฐาน —
       ส่วนนี้ไม่ใช่ค่าที่ระเบียบกำหนด จึงยืดหยุ่นได้ ต่างจากขอบกระดาษกับขนาดฟอนต์
       ห้ามเพิ่มกลับโดยไม่วัดใหม่ ใบต้องจบใน 1 หน้าแม้ชื่อตำแหน่งยาวสุด */
    .signatures { margin-top: 22pt; }
    .signature {
      width: 92%;
      margin: 11pt 0 0 auto;
      page-break-inside: avoid;
      display: grid;
      grid-template-columns: max-content 1fr 13em;
      column-gap: 6px;
    }
    .signatures .signature:first-child { margin-top: 0; }
    .signature-row {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      align-items: end;
      white-space: nowrap;
    }
    .signature-row > * { min-width: 0; }
    .signature-line { height: 1.15em; border-bottom: 1px dotted #333; }
    /* ป้ายบทบาทเดิมเป็นคำกลางความยาวคงที่ จึงอยู่ในคอลัมน์ 13em ได้พอดีตลอด
       ตอนนี้เป็นชื่อตำแหน่งจริงที่ อปท. พิมพ์เอง ยาวได้ถึง 250 ตัวอักษร ถ้าคง nowrap
       ที่สืบจาก .signature-row ไว้ ข้อความจะล้นออกนอกขอบกระดาษแล้วหายไปเงียบๆ
       บนเอกสารที่เอาไปให้เซ็น — ยอมให้ตัดบรรทัดแทน */
    /* pre-line: ป้ายผู้มีอำนาจสั่งใช้ยาวเกินคอลัมน์ ตัดบรรทัดเองตามคำที่กำหนด (
) ไม่ให้เบราว์เซอร์ตัดกลางคำ "ส่วน|กลาง" */
    .signature-role { text-align: left; white-space: pre-line; overflow-wrap: anywhere; }
    .signature-name-row { margin-top: 2pt; }
    .signature-date-row { margin-top: 2pt; }
    .plate-line { margin-top: 2pt; text-align: center; }
    .signature-name, .signature-title { position: relative; text-align: center; }
    /* ตำแหน่งใต้ชื่อผู้มีอำนาจ: ตำแหน่ง "รักษาราชการแทน" ยาวได้ถึง ~175 มม. แต่คอลัมน์เส้นกว้างแค่ ~67 มม. และสืบ nowrap
       มาจากแถว ข้อความที่ล้นจึงชิดซ้ายของคอลัมน์แล้วหลุดออกนอกกระดาษทางขวา (วัดแล้วล้น 9–42 มม.) — ตัดเป็น 2 บรรทัดหลังคำว่า
       "รักษาราชการแทน" (govSplitActingTitle) แล้วจัดกึ่งกลางบนเส้นด้วย flex (ล้นเท่ากันสองข้าง ต่างจาก text-align ที่ชิดซ้ายแล้วล้นขวา)
       กล่องข้อความไม่หด (flex: 0 0 auto) และกว้างสุด 118 มม. = 2 × ระยะจากแกนเส้น (~60.6 มม.) ถึงขอบซ้ายพื้นที่พิมพ์
       ตำแหน่งที่ยังยาวกว่านั้นให้ตัดบรรทัดตามช่องว่างแทนการล้น
       ⚠️ ห้ามตั้ง width: max-content ที่ .signature-title เอง — คอลัมน์เส้น (1fr) จะถูกดันกว้างตามข้อความแล้วเส้นยาวผิดแบบ
       (ค่าความกว้างที่ไม่ใช่ auto ทำให้ min-width: 0 ของแถวไม่มีผลต่อการคิดขนาดแทร็ก) */
    .signature-title { display: flex; justify-content: center; white-space: normal; }
    .signature-title-text { flex: 0 0 auto; max-width: 118mm; }
    .signature-name.is-blank { display: flex; justify-content: space-between; width: 100%; }
    .signature-suffix { position: absolute; left: 100%; top: 0; margin-left: 4px; white-space: nowrap; }
    .decision { margin-top: 22pt; page-break-inside: avoid; }
    .decision .signature { margin-top: 16pt; }
  </style>
</head>
<body>
<div class="sheet">
  <div class="form-no">แบบ 3</div>
  <!-- หัวเรื่องและถ้อยคำหลักตามแบบ 3 ท้ายระเบียบกระทรวงมหาดไทยว่าด้วยการใช้และรักษายานพาหนะ
       ขององค์กรปกครองส่วนท้องถิ่น พ.ศ. ๒๕๖๙ (ใช้บังคับ 17 มี.ค. 2569 แทนฉบับ 2548)
       ช่องที่แบบท้ายระเบียบไม่มี (ทะเบียนรถ ท้องที่/จังหวัด เลขไมล์ ผู้ขับรถ ช่องติ๊กความเห็น)
       คงไว้ตามที่ อปท. ใช้อยู่ — ตัดออกเมื่อนิติกรของ อปท. ยืนยันเท่านั้น -->
  <h1>ใบขออนุญาตใช้ยานพาหนะส่วนกลาง/รถรับรอง</h1>
  <p class="plate-line">ทะเบียนรถ <span class="field field-medium${filledClass(plate)}">${fillText(plate)}</span></p>

  <p class="date-line">วันที่ <span class="field${filledClass(requestedAt.day)}">${fillText(requestedAt.day)}</span>
    เดือน <span class="field field-medium${filledClass(requestedAt.month)}">${fillText(requestedAt.month)}</span>
    พ.ศ. <span class="field${filledClass(requestedAt.year)}">${fillText(requestedAt.year)}</span></p>
  <p class="body-line">เรียน&nbsp;&nbsp;${esc(organizationHeadTitle(tenant))}</p>

  <div class="line-row requester-line"><span class="indent">ข้าพเจ้า</span>
    <span class="fill${filledClass(requesterName)}">${fillText(requesterName)}</span>
    <span>ตำแหน่ง</span><span class="fill${filledClass(requesterPosition)}">${fillText(requesterPosition)}</span></div>
  <div class="line-row"><span>ขออนุญาตใช้ยานพาหนะส่วนกลาง/รถรับรอง ไปที่</span><span class="fill${filledClass(destination)}">${fillText(destination)}</span></div>
  ${destination ? '' : '<div class="continuation"></div>'}
  <div class="line-row"><span>เพื่อ</span><span class="fill${filledClass(purpose)}">${fillText(purpose)}</span>
    <span>มีคนนั่ง</span><span class="fill fill-tiny${filledClass(passengers)}">${fillText(passengers)}</span><span>คน</span></div>
  ${purpose ? '' : '<div class="continuation"></div>'}
  <div class="line-row"><span>ในท้องที่</span><span class="fill${filledClass(trip?.destination_locality)}">${fillText(trip?.destination_locality)}</span>
    <span>จังหวัด</span><span class="fill fill-narrow${filledClass(destinationProvince)}">${fillText(destinationProvince)}</span></div>
  <p class="body-line">ในวันที่ <span class="field${filledClass(departure.day)}">${fillText(departure.day)}</span>
    เดือน <span class="field field-medium${filledClass(departure.month)}">${fillText(departure.month)}</span>
    พ.ศ. <span class="field${filledClass(departure.year)}">${fillText(departure.year)}</span>
    เวลา <span class="field${filledClass(departure.time)}">${fillText(departure.time)}</span> น.</p>
  <p class="body-line">กลับวันที่ <span class="field${filledClass(returned.day)}">${fillText(returned.day)}</span>
    เดือน <span class="field field-medium${filledClass(returned.month)}">${fillText(returned.month)}</span>
    พ.ศ. <span class="field${filledClass(returned.year)}">${fillText(returned.year)}</span>
    เวลา <span class="field${filledClass(returned.time)}">${fillText(returned.time)}</span> น.</p>
  <div class="line-row body-line">
    <span>เลขไมล์ขาไป</span><span class="fill${filledClass(odoStart)}">${odoStart}</span>
    <span>เลขไมล์ขากลับ</span><span class="fill${filledClass(odoEnd)}">${odoEnd}</span>
  </div>
  <p class="body-line">รวมระยะทาง <span class="field${filledClass(distance)}">${distance}</span> กิโลเมตร</p>

  <div class="signatures">
    ${signatureBlock({ role: 'ผู้ขออนุญาต', name: requesterName })}
    ${signatureBlock({ role: 'ผู้ขับรถ', name: driverName })}
    ${signatureBlock({
      role: deptHead?.title?.trim() || 'ผู้อำนวยการสำนัก/กอง',
      name: deptHead?.name || '',
      // "หรือผู้แทน" มีไว้เผื่อตอนที่ป้ายเป็นคำกลางและยังไม่รู้ว่าใครจะเซ็น
      // พอทะเบียนระบุทั้งชื่อและตำแหน่งมาแล้วก็ไม่ต้องเผื่ออีก คงไว้เฉพาะกรณียังไม่ได้ตั้ง
      suffix: deptHead?.title?.trim() ? '' : 'หรือผู้แทน',
      dateRow: true,
    })}
  </div>

  <div class="decision">
    <div class="line-row">
      <span>ความเห็นของผู้มีอำนาจสั่งใช้ยานพาหนะ&nbsp;&nbsp;(${approved ? '✓' : '&nbsp;'}) อนุมัติ&nbsp;&nbsp;(${rejected ? '✓' : '&nbsp;'}) ไม่อนุมัติ เพราะ</span>
      <span class="fill${filledClass(rejectReason)}">${fillText(rejectReason)}</span>
    </div>
    ${rejectReason ? '' : '<div class="continuation"></div>'}
    ${signatureBlock({ role: 'ผู้มีอำนาจสั่งใช้ยานพาหนะ\nส่วนกลาง/รถรับรอง', name: authority.name, title: authority.title, dateRow: true })}
  </div>
  <div class="eservice-origin">${esc(govEServiceOriginText(tenant))}</div>
</div>
</body>
</html>`
}

// ── แบบ สก. ๑ บันทึกรับรองการใช้ยานพาหนะส่วนกลาง (กรณีผู้บริหารท้องถิ่นเป็นผู้ขอใช้) ──────────
// ต้นฉบับ: แบบที่ อบต.ทุ่งแค้วใช้ เจ้าของระบบส่งมา 2569-10-18 — ไม่อยู่ในแบบ ๑–๖ ท้ายระเบียบ มท.
// ว่าด้วยการใช้และรักษายานพาหนะของ อปท. พ.ศ. ๒๕๖๙ ที่ระบบมีตัวบทอยู่ ที่มาทางระเบียบยังต้องยืนยัน
// กับฉบับปัจจุบัน/หนังสือสั่งการ จึงเรียกแค่ชื่อแบบ ห้ามเติมเลขข้อระเบียบลงใบเอง
// เจ้าของระบบเลือก 2569-10-18: ใช้เฉพาะนายก (ไม่รวมรองนายก) และพิมพ์ "คู่" กับแบบ 3 ไม่ได้แทน

// "นายก..." = นายกเทศมนตรี/นายก อบต. · รองนายก/ผู้ช่วยนายก ไม่ขึ้นต้นด้วยคำนี้จึงไม่เข้าเอง
const MAYOR_POSITION = /^นายก(?!รัฐมนตรี)/

export function isMayorPosition(text) {
  return MAYOR_POSITION.test(String(text ?? '').trim())
}

// ตำแหน่งที่กรอกในคำขอชนะตำแหน่งในโปรไฟล์ (ชุดเดียวกับที่พิมพ์ลงแบบ 3) — ระบบดูผิดเมื่อไร
// เจ้าหน้าที่แก้ช่อง "ตำแหน่งผู้ขอใช้รถ" ให้ตรงความจริง ใบก็ตามมาเอง ไม่ต้องมีช่องติ๊กแยก
export function tripRequesterIsMayor(trip) {
  return isMayorPosition(trip?.requester_position?.trim() || profilePosition(trip?.requester))
}

export function buildFleetSk1Html({ trip, tenant }) {
  const name = String(trip?.requester?.full_name || trip?.creator?.full_name || '').trim()
  const position = String(trip?.requester_position || profilePosition(trip?.requester) || '').trim()
  const writtenAt = String(tenant?.name || '').trim()
  // ใบนี้เขียนว่า "ได้ใช้" = รับรองหลังใช้รถแล้ว วันที่หัวใบจึงเป็นวันที่รถกลับจริง
  // ยังไม่กลับ = เว้นให้เขียนเอง ห้ามใช้วันกลับตามแผนเพราะจะรับรองล่วงหน้าในสิ่งที่ยังไม่เกิด
  const certifiedAt = thaiDateParts(trip?.returned_at)
  // ช่วงเวลาที่ใช้รถใช้ชุดเดียวกับแบบ 3 (เวลาจริงก่อน ไม่มีค่อยใช้ตามคำขอ) สองใบจะได้ไม่ขัดกัน
  const departure = thaiDateParts(trip?.started_at || trip?.planned_departure)
  const returned = thaiDateParts(trip?.returned_at || trip?.planned_return)
  const plate = String(trip?.vehicle?.license_plate || trip?.vehicle?.asset_code || '').trim()
  const province = String(trip?.destination_province || '').replace(/^จังหวัด\s*/, '').trim()
  // ต้นฉบับมีช่อง "เดินทางไปยัง" ช่องเดียว (ไม่มีท้องที่/จังหวัดแยกแบบแบบ 3) จึงรวมเป็นข้อความเดียว
  const destination = [trip?.destination, trip?.destination_locality, province ? `จังหวัด${province}` : '']
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ')
  const purpose = String(trip?.purpose || '').trim()
  const signBelow = [
    name ? `(${esc(name)})` : govNameBlank(GOV_SIGN_LINE_W_WIDE),
    // ผู้รับรองคือผู้ขอคนเดียวกัน — ตำแหน่งใต้ชื่อใช้ตำแหน่งของผู้ขอ ไม่มีค่อยใช้ชื่อตำแหน่งนายกของ อปท.
    ...govSplitActingTitle(position || organizationHeadTitle(tenant)).map(esc),
    // วันที่ลงนามผู้ลงนามเขียนเองเสมอ (ต้นฉบับเว้นจุดไว้) ห้ามเติมวันที่พิมพ์แทน
    'วันที่............ เดือน....................... ปี...............',
  ]
  // บรรทัดที่มีข้อความแล้วพิมพ์ "ไหลต่อ" เป็นย่อหน้า (ล้นแล้วขึ้นบรรทัดใหม่ชิดขอบซ้ายเหมือนพิมพ์ดีด)
  // ห้ามใช้ช่อง flex แบบแบบ 3 กับบรรทัดที่ป้ายยาว — "ได้ใช้ยานพาหนะส่วนกลาง หมายเลขทะเบียน …
  // เดินทางไปยัง" กินที่เกือบเต็มบรรทัด ช่องสถานที่เหลือไม่กี่มม. ข้อความตัดทีละตัวจนใบยาว 2 หน้า (วัดจริง)
  // ยังไม่มีข้อมูล = เส้นจุดเต็มบรรทัด + บรรทัดต่อ ตามต้นฉบับ
  // keep = ห้ามตัดกลางคำ (ชื่อคน/ชื่อตำแหน่ง/ทะเบียน) — ตัวตัดคำไทยของเบราว์เซอร์ไม่รู้จักชื่อเฉพาะ
  // เคยตัด "…ตำบลทุ่งแค้|ว" (วัดจริง) ไม่พอบรรทัดให้ขึ้นบรรทัดใหม่ทั้งก้อนแทน
  const slot = (value, blankWidth, keep = false) => {
    const text = String(value ?? '').trim()
    return text
      ? `<span class="val${keep ? ' keep' : ''}">${esc(text)}</span>`
      : `<span class="dots" style="width:${blankWidth}"></span>`
  }
  const requesterRow = position
    ? `<p class="flow first">ข้าพเจ้า ${slot(name, '60mm', true)} <span class="pair">ตำแหน่ง ${slot(position, '', true)}</span></p>`
    : `<div class="line-row"><span class="indent">ข้าพเจ้า</span><span class="fill${filledClass(name)}">${fillText(name)}</span>
      <span>ตำแหน่ง</span><span class="fill"></span></div>`
  const destinationRow = destination
    ? `<p class="flow">ได้ใช้ยานพาหนะส่วนกลาง หมายเลขทะเบียน ${slot(plate, '28mm', true)} เดินทางไปยัง ${slot(destination)}</p>`
    : `<div class="line-row"><span>ได้ใช้ยานพาหนะส่วนกลาง หมายเลขทะเบียน</span><span class="fill fill-plate${filledClass(plate)}">${fillText(plate)}</span>
      <span>เดินทางไปยัง</span><span class="fill"></span></div>
    <div class="continuation"></div>`
  const purposeRow = purpose
    ? `<p class="flow">เพื่อ ${slot(purpose)}</p>`
    : `<div class="line-row"><span>เพื่อ</span><span class="fill"></span></div>
    <div class="continuation"></div>`
  const dateFields = (label, parts) => `<span>${label}</span>`
    + `<span class="fill fill-day${filledClass(parts.day)}">${fillText(parts.day)}</span>`
    + `<span>เดือน</span><span class="fill fill-month${filledClass(parts.month)}">${fillText(parts.month)}</span>`
    + `<span>พ.ศ.</span><span class="fill fill-year${filledClass(parts.year)}">${fillText(parts.year)}</span>`
    + `<span>เวลา</span><span class="fill fill-time${filledClass(parts.time)}">${fillText(parts.time)}</span><span>น.</span>`

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>แบบ สก. ๑ บันทึกรับรองการใช้ยานพาหนะส่วนกลาง</title>
  ${GOV_FONT_LINK}
  <style>
    /* เลย์เอาต์ลอกตามต้นฉบับ (หัวใบชิดขวา · เนื้อความเต็มบรรทัด · ช่องลงนามเดี่ยวค่อนขวา)
       ใบต้องจบ 1 หน้า A4 — เพิ่มบรรทัด/ระยะห่างแล้วต้องวัดใหม่ (npm run test:fleet:sk1) */
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    .sheet {
      width: 210mm;
      padding: ${GOV_PAGE_MARGIN};
      color: #000;
      ${govDocFontCss()}
      background: #fff;
    }
    @media print {
      .sheet { width: auto; padding: 0; }
    }
    p { margin: 0; }
    .form-no { text-align: right; font-weight: 700; }
    h1 { margin: 14pt 0 0; text-align: center; font-size: 18pt; font-weight: 700; line-height: 1.25; }
    h1 span { display: block; white-space: nowrap; }
    .head { margin: 14pt 0 0 78mm; }
    .line-row { display: flex; align-items: baseline; gap: 6px; margin-top: 7pt; }
    .line-row > span:not(.fill) { white-space: nowrap; }
    .line-row .fill { flex: 1; min-width: 0; min-height: 1.15em; border-bottom: 1px dotted #333; padding: 0 6px 1px; }
    .line-row .fill.is-filled { border-bottom: none; }
    .line-row .fill-day { flex: 0.7; text-align: center; }
    .line-row .fill-month { flex: 1.6; text-align: center; }
    .line-row .fill-year { flex: 0.9; text-align: center; }
    .line-row .fill-time { flex: 1; text-align: center; }
    .line-row .fill-plate { flex: 0 0 28mm; text-align: center; }
    .body { margin-top: 14pt; }
    .indent { margin-left: 2cm; }
    .continuation { height: 1.15em; margin-top: 7pt; border-bottom: 1px dotted #333; }
    .flow { margin-top: 7pt; }
    .flow.first { text-indent: 2cm; }
    .flow .val { padding: 0 4px; }
    .flow .keep { white-space: nowrap; }
    /* ป้าย "ตำแหน่ง" ต้องไปกับค่าของมัน ไม่ค้างท้ายบรรทัดบนแล้วค่าไปขึ้นบรรทัดล่าง */
    .flow .pair { white-space: nowrap; }
    .flow .dots { display: inline-block; height: 1.15em; border-bottom: 1px dotted #333; vertical-align: bottom; }
    /* ต้นฉบับวางบรรทัดนี้กลางหน้า ไม่ได้ย่อหน้า — ใส่ย่อหน้า 2 ซม. แล้วตกบรรทัดเมื่อเครื่องไม่มีฟอนต์ราชการ */
    .certify { margin-top: 7pt; text-align: center; }
    ${govSignBlockCss()}
    /* แกนเส้นลงนามอยู่ค่อนขวาตามต้นฉบับ ("(ลงชื่อ)" เริ่มราว 58 มม. จากขอบพื้นที่พิมพ์) */
    .sign-area { margin-top: 22mm; padding-left: 58mm; }
    .sign-below { margin-top: 2pt; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 12mm; text-align: center; }
  </style>
</head>
<body>
<div class="sheet">
  <div class="form-no">แบบ สก. ๑</div>
  <h1><span>บันทึกรับรองการใช้ยานพาหนะส่วนกลาง</span><span>(กรณีผู้บริหารท้องถิ่นเป็นผู้ขอใช้ยานพาหนะส่วนกลาง)</span></h1>

  <div class="head">
    <div class="line-row"><span>เขียนที่</span><span class="fill${filledClass(writtenAt)}">${fillText(writtenAt)}</span></div>
    <div class="line-row"><span>วันที่</span><span class="fill fill-day${filledClass(certifiedAt.day)}">${fillText(certifiedAt.day)}</span>
      <span>เดือน</span><span class="fill fill-month${filledClass(certifiedAt.month)}">${fillText(certifiedAt.month)}</span>
      <span>พ.ศ.</span><span class="fill fill-year${filledClass(certifiedAt.year)}">${fillText(certifiedAt.year)}</span></div>
  </div>

  <div class="body">
    ${requesterRow}
    ${destinationRow}
    ${purposeRow}
    <div class="line-row">${dateFields('ในวันที่', departure)}</div>
    <div class="line-row">${dateFields('ถึงวันที่', returned)}</div>
    <p class="certify">ขอรับรองว่า รายละเอียดการใช้ยานพาหนะส่วนกลางในครั้งนี้ เป็นความจริงทุกประการ</p>
  </div>

  <div class="sign-area sign-block">
    ${govSignRow({ width: GOV_SIGN_LINE_W_WIDE, label: '(ลงชื่อ)', role: 'ผู้บริหารท้องถิ่น', below: signBelow })}
  </div>
  <div class="eservice-origin">${esc(govEServiceOriginText(tenant))}</div>
</div>
</body>
</html>`
}
