import { GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss } from './govDocStyle.js'
import { govNameBlank, govSignBlockCss, govSignRow } from './govSignBlock.js'
import { govStaffSignBlockCss, govStaffSignBlockHtml } from './govStaffSignBlock.js'
import { counterEntryOf } from './counterEntry.js'
import { customFormRows, customTypeLabel } from './customFormFields.js'

// ใบคำขอของ "ประเภทคำขอที่ อปท. เพิ่มเอง" ที่มีช่องกรอกเพิ่ม (ตัวสร้างแบบฟอร์มออนไลน์) — A4 แนวตั้ง 1 แผ่น
// ใช้เฉพาะฝั่งเจ้าหน้าที่ (มีช่องลงนาม ผอ./ปลัด/นายก จากทะเบียนผู้ลงนามกลาง) ฝั่งประชาชนไม่มีใบพิมพ์
//
// ⚠️ ทุกค่าที่มาจากผู้ใช้ (ชื่อ ที่อยู่ วัตถุประสงค์ ชื่อช่อง คำตอบ) ผ่าน esc() ก่อนลง HTML เสมอ —
// ผู้ยื่นแบบ guest ใส่ข้อความอะไรก็ได้ และใบนี้ถูกเปิดด้วย document.write ในหน้าต่างของระบบ (XSS)
//
// ขนาดตัวอักษร/ฟอนต์/ขอบกระดาษมาจาก govDocStyle.js ทั้งหมด ห้ามเขียนซ้ำที่นี่

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

/**
 * @param {object} args
 * @param {object} args.req              แถว document_requests (ใช้ requester_*, purpose, permit_form_data, created_by_uid)
 * @param {object} args.tenant
 * @param {string} [args.typeLabel]      ชื่อประเภท (ไม่ส่ง = หาจาก _custom_types ของ tenant · ประเภทถูกลบแล้ว = "บริการเพิ่มเติม")
 * @param {string} [args.thDate]         วันที่ยื่น (ไทย)
 * @param {string} [args.referenceNo]
 * @param {object|null} [args.signatories]  ไม่ส่ง = ไม่มีช่องลงนามเจ้าหน้าที่
 * @param {string} [args.departmentName]
 */
export function buildCustomRequestHtml({
  req, tenant, typeLabel = '', thDate = '', referenceNo = '', signatories = null, departmentName = '',
}) {
  const orgName = tenant?.name?.trim() || 'องค์กรปกครองส่วนท้องถิ่น'
  const label = (typeLabel || '').trim() || customTypeLabel(tenant, req?.document_type)
  const rows = customFormRows(req?.permit_form_data)
  const name = String(req?.requester_name ?? '').trim()
  // ยื่นออนไลน์เอง = พิมพ์ชื่อในวงเล็บไว้ให้ (ผู้ยื่นเซ็นปากกาบนเส้น) · กรอกแทนที่เคาน์เตอร์ = เว้นวงเล็บให้เขียนมือ
  // เพราะคนยื่นไม่ได้ยืนยันตัวตนกับระบบเอง · ไม่อ้างว่าเป็นลายมือชื่ออิเล็กทรอนิกส์ (ฟอร์มนี้ไม่ได้เก็บการลงชื่อ)
  const atCounter = Boolean(counterEntryOf(req))

  const info = [
    ['ชื่อ-สกุล', name],
    ['เลขบัตรประชาชน', req?.requester_id_card],
    ['ที่อยู่', req?.requester_address],
    ['โทรศัพท์', req?.requester_phone],
    ['วัตถุประสงค์', req?.purpose],
  ].filter(([, value]) => String(value ?? '').trim())

  const infoHtml = info.map(([key, value]) => `
      <div class="info-row"><span class="info-key">${esc(key)}</span><span class="info-val">${esc(String(value).trim())}</span></div>`).join('')

  const answersHtml = rows.length ? `
    <table class="answers">
      <thead><tr><th class="q">หัวข้อ</th><th class="a">รายละเอียดที่ผู้ยื่นกรอก</th></tr></thead>
      <tbody>${rows.map(row => `
        <tr><td class="q">${esc(row.label)}</td><td class="a">${esc(row.value)}</td></tr>`).join('')}
      </tbody>
    </table>` : ''

  const signRow = govSignRow({
    label: 'ลงชื่อ',
    role: 'ผู้ยื่นคำขอ',
    grow: true,
    below: [name && !atCounter ? `(${esc(name)})` : govNameBlank()],
  })

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>คำขอ${esc(label)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body {
      ${govDocFontCss()}
    }
    .sheet { width: 100%; }
    .org { text-align: center; font-weight: 700; margin: 2mm 0 0; }
    .title { text-align: center; font-weight: 700; margin: 0 0 4mm; }
    .section-head { font-weight: 700; margin: 0 0 1.5mm; }
    .info-row { display: grid; grid-template-columns: 34mm minmax(0, 1fr); margin: 0 0 1mm; }
    .info-key { white-space: nowrap; }
    .info-val { white-space: pre-wrap; overflow-wrap: anywhere; }

    .answers { width: 100%; border-collapse: collapse; margin: 3mm 0 0; table-layout: fixed; }
    .answers th, .answers td { border: 1px solid #000; padding: 0.6mm 2mm; vertical-align: top; text-align: left; }
    .answers th { font-weight: 700; text-align: center; }
    .answers .q { width: 50mm; }
    .answers .a { white-space: pre-wrap; overflow-wrap: anywhere; }
    .answers tr { break-inside: avoid; page-break-inside: avoid; }

    .applicant-sign { display: flex; justify-content: flex-end; margin: 8mm 0 0; }
    .applicant-sign .sign-row { justify-content: flex-end; }
    /* 11pt โดยตั้งใจ — เลขอ้างอิงของระบบ ไม่ใช่เนื้อความของหนังสือ (เหมือนใบเก็บขนขยะ) */
    .reference { margin-top: 8mm; font-size: 11pt; color: #333; }

    /* โหมดบีบระยะ — ใช้เฉพาะใบที่มีช่องลงนามเจ้าหน้าที่ต่อท้าย (คำขอทุกใบต้องจบแผ่นเดียว)
       บีบเฉพาะ "ระยะเว้นระหว่างบล็อก" ไม่แตะขนาดฟอนต์/ขอบกระดาษ/ถ้อยคำ */
    .sheet--staff .title { margin-bottom: 2mm; }
    .sheet--staff .info-row { margin-bottom: 0.5mm; }
    .sheet--staff .answers { margin-top: 2mm; }
    .sheet--staff .answers th, .sheet--staff .answers td { padding-top: 0.3mm; padding-bottom: 0.3mm; }
    .sheet--staff .applicant-sign { margin-top: 5mm; }
    .sheet--staff .reference { margin-top: 3mm; }
${govSignBlockCss()}
${govStaffSignBlockCss()}

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
  <main class="sheet${signatories ? ' sheet--staff' : ''}" data-pdf-page>
    <div class="org">${esc(orgName)}</div>
    <div class="title">คำขอ${esc(label)}</div>

    <div class="info">${infoHtml}
    </div>
${answersHtml}

    <div class="applicant-sign">
      ${signRow}
    </div>

    <p class="reference">
      ${esc(govEServiceOriginText(tenant))}${thDate ? ` &nbsp;|&nbsp; ยื่นเมื่อ ${esc(thDate)}` : ''}${referenceNo ? ` &nbsp;|&nbsp; เลขอ้างอิงระบบ: ${esc(referenceNo)}` : ''}
    </p>
${govStaffSignBlockHtml({ signatories, tenant, departmentName })}
  </main>
</body>
</html>`
}
