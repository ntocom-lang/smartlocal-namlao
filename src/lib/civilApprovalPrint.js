// ใบ "บันทึกข้อความขออนุมัติจัดทำแบบรูปรายการและแต่งตั้งคณะกรรมการกำหนดราคากลาง" (ขั้นต้นเรื่อง กองช่าง)
// A4 แนวตั้ง พิมพ์ตามมาตรฐานราชการ: THSarabunPSK 14pt ตาม src/lib/govDocStyle.js
// ช่องลงนามใช้มาตรฐานกลาง src/lib/govSignBlock.js ตามกติกา AGENTS.md

import {
  GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss,
} from './govDocStyle.js'
import {
  GOV_SIGN_LINE_W, govNameBlank, govSignBlockCss, govSignRow, govSplitActingTitle,
} from './govSignBlock.js'
import { thaiDateFromDateInput } from './thaiDate.js'
import { thaiBahtText } from './thaiBahtText.js'
import { openLifecyclePrint } from './constructionLifecyclePrint.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

const thaiDate = iso => (iso ? thaiDateFromDateInput(iso) : '–')
const money = val => (val === null || val === undefined || val === '' || !Number.isFinite(Number(val))
  ? '–' : Number(val).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

function pageCss() {
  return `
  ${govPageCss()}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #000; ${govDocFontCss()} -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 160mm; margin: 8mm auto; }
  @media print { .sheet { max-width: none; margin: 0; } }
  p { margin: 0; }
  .pg { min-height: auto; }

  /* หัวบันทึกข้อความ */
  .memo-head { display: flex; align-items: flex-end; position: relative; margin-bottom: 1mm; border-bottom: 2px solid #000; padding-bottom: 0.5mm; }
  .memo-garuda { width: 20mm; height: 20mm; object-fit: contain; }
  .memo-title { position: absolute; left: 0; right: 0; text-align: center; font-size: 26pt; font-weight: 700; line-height: 1; pointer-events: none; }
  .memo-meta { margin-bottom: 1mm; line-height: 1.2; }
  .memo-meta-row { display: flex; justify-content: space-between; }
  .memo-body { text-align: justify; text-justify: inter-cluster; line-height: 1.2; }
  .memo-p { text-indent: 1.8cm; margin-bottom: 1mm; }

  /* กล่องลงนาม 3 ลำดับ: ช่างเสนอ -> ปลัดเห็นควร -> นายกอนุมัติ */
  .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3.5mm; margin-top: 1.5mm; border-top: 1px dashed #777; padding-top: 1.5mm; }
  .review-box { border: 1px solid #000; padding: 1mm 2mm; border-radius: 1mm; line-height: 1.2; }
  .origin { margin-top: 1mm; font-size: 9pt; color: #666; text-align: right; }
  ${govSignBlockCss()}
  `
}

/**
 * สร้าง HTML สำหรับบันทึกขออนุมัติโครงการและแบบรูปรายการ
 */
export function buildCivilApprovalHtml({ tenant, project, data, signatories = null, emblemUrl = '', printedAt = new Date() }) {
  const committee = data.committee || []
  const president = committee.find(c => c.duty?.includes('ประธาน')) || committee[0]
  const members = committee.filter(c => c !== president)
  const origin = `พิมพ์เมื่อ ${thaiDateFromDateInput(`${printedAt.getFullYear()}-${String(printedAt.getMonth() + 1).padStart(2, '0')}-${String(printedAt.getDate()).padStart(2, '0')}`)} · ${govEServiceOriginText(tenant)}`

  const proposerName = data.proposerName || signatories?.department_head?.name || ''
  const proposerTitle = data.proposerPosition || signatories?.department_head?.title || 'ผู้อำนวยการกองช่าง / เจ้าหน้าที่ผู้รับผิดชอบ'

  const clerkName = signatories?.clerk?.name || ''
  const clerkTitle = signatories?.clerk?.title || `ปลัด${esc(tenant?.name || '')}`

  const mayorName = signatories?.mayor?.name || ''
  const mayorTitle = signatories?.mayor?.title || `นายก${esc(tenant?.name || '')}`

  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(`บันทึกขออนุมัติโครงการ_${project.title}`)}</title>
${GOV_FONT_LINK}
<style>${pageCss()}</style>
</head><body>
<div class="sheet">
  <section class="pg">
    <div class="memo-head">
      ${emblemUrl ? `<img src="${esc(emblemUrl)}" alt="ตราครุฑ" class="memo-garuda" />` : '<div style="width:20mm;height:20mm;"></div>'}
      <div class="memo-title">บันทึกข้อความ</div>
    </div>
    <div class="memo-meta">
      <div class="memo-meta-row">
        <div><b>ส่วนราชการ:</b> กองช่าง ${esc(tenant?.name || '')}</div>
        <div><b>โทร:</b> ${esc(tenant?.phone || '–')}</div>
      </div>
      <div class="memo-meta-row">
        <div><b>ที่:</b> ${esc(data.docNo || '–')}</div>
        <div><b>วันที่:</b> ${esc(thaiDate(data.docDate))}</div>
      </div>
      <div><b>เรื่อง:</b> ขออนุมัติจัดทำแบบรูปรายการละเอียดงานก่อสร้าง และแต่งตั้งคณะกรรมการกำหนดราคากลาง</div>
    </div>

    <div class="memo-body">
      <p><b>เรียน</b> นายก${esc(tenant?.name || '')}</p>
      
      <p class="memo-p">
        <b>๑. ต้นเรื่องและความจำเป็น:</b> ด้วย กองช่าง ${esc(tenant?.name || '')} ได้ตรวจสอบแผนพัฒนาท้องถิ่น และข้อบัญญัติ/เทศบัญญัติงบประมาณรายจ่าย ประจำปีงบประมาณ พ.ศ. <b>${esc(project.fiscal_year || '–')}</b> ปรากฏโครงการ <b>“${esc(project.title)}”</b> โดยมีวัตถุประสงค์เพื่อแก้ไขปัญหาความเดือดร้อน พัฒนาโครงสร้างพื้นฐาน และอำนวยความสะดวกปลอดภัยให้แก่ประชาชนในพื้นที่ ${esc(project.location_desc || `${project.village ? `หมู่ที่ ${project.village}` : ''} ต.${project.subdistrict || ''}` || 'ในเขตพื้นที่รับผิดชอบ')}
      </p>

      <p class="memo-p">
        <b>๒. ข้อมูลวงเงินงบประมาณ:</b> โครงการดังกล่าวได้รับอนุมัติตั้งงบประมาณไว้ในข้อบัญญัติ/เทศบัญญัติงบประมาณรายจ่าย เป็นเงินทั้งสิ้น <b>${money(project.budget_amount)} บาท (${esc(thaiBahtText(project.budget_amount))})</b>
      </p>

      <p class="memo-p">
        <b>๓. การดำเนินการ:</b> เพื่อให้การดำเนินงานเป็นไปด้วยความเรียบร้อย ถูกต้องตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. ๒๕๖๐ และหลักเกณฑ์การคำนวณราคากลางงานก่อสร้างของทางราชการ กองช่างจึงขอเสนอแนวทางดำเนินการดังนี้:
      </p>
      <div style="margin-left: 1.2cm; margin-bottom: 1mm;">
        <div>๓.๑ มอบหมายเจ้าหน้าที่กองช่างดำเนินการสำรวจ ออกแบบ และจัดทำแบบรูปรายการละเอียดและประมาณการราคา (แบบ ปร.๔, ปร.๕, ปร.๖)</div>
        <div>๓.๒ ขอความเห็นชอบแต่งตั้งคณะกรรมการกำหนดราคากลางงานก่อสร้าง จำนวน ๓ ท่าน ดังนี้:</div>
        <div style="margin-left: 0.6cm; margin-top: 0.5mm;">
          <div>๑) ${esc(president?.name ? president.name : '.......................................................')} ตำแหน่ง ${esc(president?.position_title || '.......................................................')} (ประธานกรรมการ)</div>
          ${members.map((m, i) => `
            <div>${i + 2}) ${esc(m?.name ? m.name : '.......................................................')} ตำแหน่ง ${esc(m?.position_title || '.......................................................')} (กรรมการ)</div>
          `).join('')}
        </div>
      </div>

      <p class="memo-p">
        จึงเรียนมาเพื่อโปรดพิจารณา:
      </p>
      <div style="margin-left: 1.2cm; margin-bottom: 1mm;">
        <div>๑. อนุมัติให้จัดทำแบบรูปรายการละเอียดและประมาณการราคาโครงการดังกล่าว</div>
        <div>๒. เห็นชอบให้แต่งตั้งคณะกรรมการกำหนดราคากลางตามรายนามข้างต้น เพื่อดำเนินการต่อไป</div>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 1.5mm;">
        ${govSignRow({
    width: GOV_SIGN_LINE_W,
    label: 'ลงชื่อ',
    below: [
      proposerName ? `(${esc(proposerName)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(proposerTitle).map(esc),
    ],
  })}
      </div>

      <div class="review-grid">
        <div class="review-box">
          <div><b>ความเห็นของปลัด${esc(tenant?.name || '')}:</b></div>
          <div style="margin-top: 1mm;">[ &nbsp; ] เห็นควรอนุมัติ &nbsp; [ &nbsp; ] อื่นๆ .............................</div>
          <div style="margin-top: 1.5mm; display: flex; justify-content: center;">
            ${govSignRow({
    width: GOV_SIGN_LINE_W,
    label: 'ลงชื่อ',
    below: [
      clerkName ? `(${esc(clerkName)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(clerkTitle).map(esc),
    ],
  })}
          </div>
        </div>
        <div class="review-box">
          <div><b>คำสั่งนายก${esc(tenant?.name || '')}:</b></div>
          <div style="margin-top: 1mm;">[ &nbsp; ] อนุมัติ &nbsp; [ &nbsp; ] ไม่อนุมัติ</div>
          <div style="margin-top: 1.5mm; display: flex; justify-content: center;">
            ${govSignRow({
    width: GOV_SIGN_LINE_W,
    label: 'ลงชื่อ',
    below: [
      mayorName ? `(${esc(mayorName)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(mayorTitle).map(esc),
    ],
  })}
          </div>
        </div>
      </div>
    </div>
    <div class="origin">${esc(origin)}</div>
  </section>
</div>
</body></html>`
}

/**
 * สั่งพิมพ์บันทึกขออนุมัติโครงการ — โหลดผู้ลงนามกลางจาก document_signatories
 */
export function printCivilApprovalDoc({ tenant, project, data }) {
  return openLifecyclePrint(({ signatories, emblemUrl }) => buildCivilApprovalHtml({
    tenant,
    project,
    data,
    signatories,
    emblemUrl,
  }), { municipalityId: tenant?.id, departmentId: project?.department_id })
}
