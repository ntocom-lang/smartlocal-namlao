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

function signatureBlock({ role, name = '', title = '', suffix = '' }) {
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
    ${title ? `<div class="signature-row"><span></span><span class="signature-title">${esc(title)}</span><span></span></div>` : ''}
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

// ช่อง "ผู้อำนวยการกอง/หัวหน้ากอง" พิมพ์เฉพาะชื่อ ไม่พิมพ์บรรทัดตำแหน่งใต้ชื่อ:
// ป้ายบทบาทบนเส้นลงนามระบุว่าเป็นหัวหน้ากองอยู่แล้ว การเติมอีกบรรทัดทั้งซ้ำความหมาย
// และดันความสูงรวมจนใบเกิน 1 หน้า A4 ซึ่งเป็นข้อบังคับของแบบฟอร์มนี้
// ยังไม่ได้ตั้งผู้ลงนามของกองนั้น = เว้นว่างให้เซ็นสด ห้ามเดาชื่อแทน
export function resolveDeptHead(signatory) {
  return {
    name: signatory?.manual_name?.trim()
      || signatory?.profile?.full_name?.trim()
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
  const requestedAt = thaiDateParts(trip?.created_at)
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
  <title>ใบขออนุญาตใช้รถส่วนกลาง</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet">
  <style>
    /* ทั้งใบต้องจบใน 1 หน้า A4 เท่าต้นฉบับกระดาษ ตัวเลขระยะห่างด้านล่างถูกไล่ให้ความสูงรวม
       ไม่เกินพื้นที่พิมพ์แล้ว ถ้าจะเพิ่มบรรทัด/ระยะห่าง ต้องวัดใหม่ทุกครั้ง
       @page = ขอบตอนพิมพ์จากเว็บ; .sheet padding = ขอบตอนดูบนจอ ห้ามซ้อนกันตอน print */
    @page { size: A4 portrait; margin: 1.2cm 1.8cm 0.9cm 1.8cm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    .sheet {
      width: 210mm;
      padding: 1.2cm 1.8cm 0.9cm 1.8cm;
      color: #000;
      font-family: "TH Sarabun New", "Sarabun", sans-serif;
      font-size: 14pt;
      line-height: 1.25;
      background: #fff;
    }
    @media print {
      .sheet { width: auto; padding: 0; }
    }
    p { margin: 0; }
    .form-no { text-align: right; font-weight: 400; }
    h1 { margin: 2pt 0 0; text-align: center; font-size: 16pt; font-weight: 700; line-height: 1.25; white-space: nowrap; }
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
    .requester-line .indent { margin-left: 2.8cm; }
    .requester-line .fill:last-child { flex: 1.25; }
    .continuation { height: 1.15em; border-bottom: 1px dotted #333; }
    .signatures { margin-top: 34pt; }
    .signature {
      width: 82%;
      margin: 14pt 0 0 auto;
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
    .signature-role { text-align: left; }
    .signature-name-row { margin-top: 2pt; }
    .signature-name, .signature-title { position: relative; text-align: center; }
    .signature-name.is-blank { display: flex; justify-content: space-between; width: 100%; }
    .signature-suffix { position: absolute; left: 100%; top: 0; margin-left: 4px; white-space: nowrap; }
    .decision { margin-top: 32pt; page-break-inside: avoid; }
    .decision .signature { margin-top: 30pt; }
    .audit-note { margin-top: 8pt; font-size: 8pt; line-height: 1.25; color: #444; }
  </style>
</head>
<body>
<div class="sheet">
  <div class="form-no">แบบ 3</div>
  <h1>ใบขออนุญาตใช้รถส่วนกลาง ทะเบียนรถ <span class="field field-medium${filledClass(plate)}">${fillText(plate)}</span></h1>

  <p class="date-line">วันที่ <span class="field${filledClass(requestedAt.day)}">${fillText(requestedAt.day)}</span>
    เดือน <span class="field field-medium${filledClass(requestedAt.month)}">${fillText(requestedAt.month)}</span>
    พ.ศ. <span class="field${filledClass(requestedAt.year)}">${fillText(requestedAt.year)}</span></p>
  <p class="body-line">เรียน&nbsp;&nbsp;${esc(organizationHeadTitle(tenant))}</p>

  <div class="line-row requester-line"><span class="indent">ข้าพเจ้า</span>
    <span class="fill${filledClass(requesterName)}">${fillText(requesterName)}</span>
    <span>ตำแหน่ง</span><span class="fill${filledClass(requesterPosition)}">${fillText(requesterPosition)}</span></div>
  <div class="line-row"><span>ขออนุญาตใช้รถยนต์ไปที่</span><span class="fill${filledClass(destination)}">${fillText(destination)}</span></div>
  ${destination ? '' : '<div class="continuation"></div>'}
  <div class="line-row"><span>เพื่อ</span><span class="fill${filledClass(purpose)}">${fillText(purpose)}</span></div>
  ${purpose ? '' : '<div class="continuation"></div>'}
  <div class="line-row"><span>ในท้องที่</span><span class="fill${filledClass(trip?.destination_locality)}">${fillText(trip?.destination_locality)}</span>
    <span>จังหวัด</span><span class="fill fill-narrow${filledClass(destinationProvince)}">${fillText(destinationProvince)}</span>
    <span>มีคนนั่ง</span><span class="fill fill-tiny${filledClass(passengers)}">${fillText(passengers)}</span><span>คน</span></div>
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
    ${signatureBlock({ role: 'ผู้อำนวยการกอง/หัวหน้ากอง', name: deptHead?.name || '', suffix: 'หรือผู้แทน' })}
  </div>

  <div class="decision">
    <div class="line-row">
      <span>ความเห็นของผู้มีอำนาจสั่งใช้รถ&nbsp;&nbsp;(${approved ? '✓' : '&nbsp;'}) อนุมัติ&nbsp;&nbsp;(${rejected ? '✓' : '&nbsp;'}) ไม่อนุมัติ เพราะ</span>
      <span class="fill${filledClass(rejectReason)}">${fillText(rejectReason)}</span>
    </div>
    ${rejectReason ? '' : '<div class="continuation"></div>'}
    ${signatureBlock({ role: 'ผู้มีอำนาจสั่งใช้รถ', name: authority.name, title: authority.title })}
  </div>

  ${trip?.backdated_reason ? `<p class="audit-note">บันทึกการใช้รถย้อนหลัง เหตุผล: ${esc(trip.backdated_reason)}</p>` : ''}
</div>
</body>
</html>`
}
