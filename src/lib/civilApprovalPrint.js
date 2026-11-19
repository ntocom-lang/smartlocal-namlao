// ใบ "บันทึกข้อความขออนุมัติจัดทำแบบรูปรายการและแต่งตั้งคณะกรรมการกำหนดราคากลาง" (ขั้นต้นเรื่อง กองช่าง)
// A4 แนวตั้ง พิมพ์ตามมาตรฐานราชการ: THSarabunPSK 14pt ตาม src/lib/govDocStyle.js

import {
  GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss,
} from './govDocStyle.js'
import { thaiDateFromDateInput } from './thaiDate.js'
import { thaiBahtText } from './thaiBahtText.js'
import { addMobileCloseButton } from './printWindowClose.js'

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
  .pg { min-height: 250mm; }

  /* หัวบันทึกข้อความ */
  .memo-head { display: flex; align-items: flex-end; position: relative; margin-bottom: 3mm; border-bottom: 2px solid #000; padding-bottom: 2mm; }
  .memo-garuda { width: 22mm; height: 22mm; object-fit: contain; }
  .memo-title { position: absolute; left: 0; right: 0; text-align: center; font-size: 26pt; font-weight: 700; line-height: 1; pointer-events: none; }
  .memo-meta { margin-bottom: 3mm; line-height: 1.4; }
  .memo-meta-row { display: flex; justify-content: space-between; }
  .memo-body { text-align: justify; text-justify: inter-cluster; line-height: 1.45; }
  .memo-p { text-indent: 2.5cm; margin-bottom: 2.5mm; }

  /* กล่องลงนาม 3 ลำดับ: ช่างเสนอ -> ปลัดเห็นควร -> นายกอนุมัติ */
  .sign-section { margin-top: 5mm; }
  .sign-col { text-align: center; line-height: 1.4; }
  .sign-space { height: 12mm; }
  .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 5mm; border-top: 1px dashed #777; pt: 3mm; }
  .review-box { border: 1px solid #000; padding: 2.5mm; border-radius: 1mm; font-size: 12pt; line-height: 1.35; }
  .origin { margin-top: 5mm; font-size: 10pt; color: #666; text-align: right; }
  `
}

/**
 * สร้าง HTML สำหรับบันทึกขออนุมัติโครงการและแบบรูปรายการ
 */
export function buildCivilApprovalHtml({ tenant, project, data, emblemUrl = '', printedAt = new Date() }) {
  const committee = data.committee || []
  const president = committee.find(c => c.duty?.includes('ประธาน')) || committee[0]
  const members = committee.filter(c => c !== president)
  const origin = `พิมพ์เมื่อ ${thaiDateFromDateInput(`${printedAt.getFullYear()}-${String(printedAt.getMonth() + 1).padStart(2, '0')}-${String(printedAt.getDate()).padStart(2, '0')}`)} · ${govEServiceOriginText(tenant)}`

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
      ${emblemUrl ? `<img src="${esc(emblemUrl)}" alt="ตราครุฑ" class="memo-garuda" />` : '<div style="width:22mm;height:22mm;"></div>'}
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
      <div style="margin-left: 2.5cm; margin-bottom: 2mm;">
        <div>๓.๑ มอบหมายเจ้าหน้าที่กองช่างดำเนินการสำรวจ ออกแบบ และจัดทำแบบรูปรายการละเอียดและประมาณการราคา (แบบ ปร.๔, ปร.๕, ปร.๖)</div>
        <div>๓.๒ ขอความเห็นชอบแต่งตั้งคณะกรรมการกำหนดราคากลางงานก่อสร้าง จำนวน ๓ ท่าน ดังนี้:</div>
        <div style="margin-left: 0.8cm; margin-top: 1mm;">
          <div>๑) ${esc(president?.name ? `นาย/นาง/น.ส. ${president.name}` : '.......................................................')} ตำแหน่ง ${esc(president?.position_title || '.......................................................')} (ประธานกรรมการ)</div>
          ${members.map((m, i) => `
            <div>${i + 2}) ${esc(m?.name ? `นาย/นาง/น.ส. ${m.name}` : '.......................................................')} ตำแหน่ง ${esc(m?.position_title || '.......................................................')} (กรรมการ)</div>
          `).join('')}
        </div>
      </div>

      <p class="memo-p">
        จึงเรียนมาเพื่อโปรดพิจารณา:
      </p>
      <div style="margin-left: 2.5cm; margin-bottom: 3mm;">
        <div>๑. อนุมัติให้จัดทำแบบรูปรายการละเอียดและประมาณการราคาโครงการดังกล่าว</div>
        <div>๒. เห็นชอบให้แต่งตั้งคณะกรรมการกำหนดราคากลางตามรายนามข้างต้น เพื่อดำเนินการต่อไป</div>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 4mm;">
        <div class="sign-col" style="min-width: 65mm;">
          <div class="sign-space"></div>
          <div>(ลงชื่อ)................................................................</div>
          <div>(${esc(data.proposerName ? `นาย/นาง/น.ส. ${data.proposerName}` : '................................................................')})</div>
          <div>${esc(data.proposerPosition || 'ผู้อำนวยการกองช่าง / เจ้าหน้าที่ผู้รับผิดชอบ')}</div>
        </div>
      </div>

      <div class="review-grid" style="margin-top: 4mm;">
        <div class="review-box">
          <div><b>ความเห็นของปลัด${esc(tenant?.name || '')}:</b></div>
          <div style="margin-top: 1.5mm;">[ &nbsp; ] เห็นควรอนุมัติ &nbsp; [ &nbsp; ] อื่นๆ .............................</div>
          <div style="margin-top: 4mm; text-align: center;">
            <div>(ลงชื่อ)........................................................</div>
            <div style="margin-top: 1mm;">(........................................................)</div>
            <div>ปลัด${esc(tenant?.name || '')}</div>
          </div>
        </div>
        <div class="review-box">
          <div><b>คำสั่งนายก${esc(tenant?.name || '')}:</b></div>
          <div style="margin-top: 1.5mm;">[ &nbsp; ] อนุมัติ &nbsp; [ &nbsp; ] ไม่อนุมัติ</div>
          <div style="margin-top: 4mm; text-align: center;">
            <div>(ลงชื่อ)........................................................</div>
            <div style="margin-top: 1mm;">(........................................................)</div>
            <div>นายก${esc(tenant?.name || '')}</div>
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
 * สั่งพิมพ์บันทึกขออนุมัติโครงการ
 */
export function printCivilApprovalDoc({ tenant, project, data }) {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) {
    alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    return
  }
  const html = buildCivilApprovalHtml({
    tenant, project, data,
    emblemUrl: `${window.location.origin}/images/garuda.svg`,
  })
  win.document.open()
  win.document.write(addMobileCloseButton(html))
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) {
        await Promise.race([win.document.fonts.ready, new Promise(res => setTimeout(res, 1200))])
      }
    } catch { /* โหลดฟอนต์ไม่ทันพิมพ์ด้วยฟอนต์ระบบ */ }
    win.focus()
    win.print()
  }, 200)
}
