// ชุดเอกสารราคากลางกองช่าง 3 แผ่นจบ (A4 แนวตั้ง 14pt ตาม src/lib/govDocStyle.js)
// แผ่นที่ 1: บันทึกข้อความรายงานผลการกำหนดราคากลาง (เสนอเห็นชอบ)
// แผ่นที่ 2: ตารางแสดงวงเงินงบประมาณที่ได้รับจัดสรรและราคากลางในงานจ้างก่อสร้าง (บก.01 ป.ป.ช.)
// แผ่นที่ 3: แบบสรุปราคากลางงานก่อสร้างทาง สะพาน และท่อเหลี่ยม (แบบ ปร.๖ กรมบัญชีกลาง)
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
  .pg { page-break-after: always; break-after: page; }
  .pg-last { page-break-after: auto; break-after: auto; }

  /* หัวบันทึกข้อความ */
  .memo-head { display: flex; align-items: flex-end; position: relative; margin-bottom: 1mm; border-bottom: 2px solid #000; padding-bottom: 0.5mm; }
  .memo-garuda { width: 20mm; height: 20mm; object-fit: contain; }
  .memo-title { position: absolute; left: 0; right: 0; text-align: center; font-size: 26pt; font-weight: 700; line-height: 1; pointer-events: none; }
  .memo-meta { margin-bottom: 1mm; line-height: 1.2; }
  .memo-meta-row { display: flex; justify-content: space-between; }
  .memo-body { text-align: justify; text-justify: inter-cluster; line-height: 1.2; }
  .memo-p { text-indent: 1.8cm; margin-bottom: 1mm; }

  /* ตารางแบบ บก.01 และ ปร.6 */
  .doc-title { text-align: center; font-size: 16pt; font-weight: 700; margin-bottom: 2.5mm; }
  .doc-subtitle { text-align: center; font-size: 13pt; margin-bottom: 2.5mm; }
  .bordered-table { width: 100%; border-collapse: collapse; margin-top: 2.5mm; }
  .bordered-table th, .bordered-table td { border: 1px solid #000; padding: 2mm 2.5mm; vertical-align: top; line-height: 1.35; }
  .bordered-table th { background-color: #f3f4f6; text-align: center; font-weight: 700; }

  /* ช่องลงนาม */
  .mayor-box { border: 1px solid #000; padding: 1.5mm 2mm; border-radius: 1mm; line-height: 1.2; margin-top: 2mm; }
  .origin { margin-top: 3mm; font-size: 9pt; color: #666; text-align: right; }
  ${govSignBlockCss()}
  `
}

/**
 * แผ่นที่ 1: บันทึกรายงานผลการกำหนดราคากลาง (เสนอเห็นชอบ)
 */
function pageOneMemo({ tenant, project, data, signatories = null, emblemUrl = '' }) {
  const committee = data.committee || []
  const president = committee.find(c => c.duty?.includes('ประธาน')) || committee[0]
  const members = committee.filter(c => c !== president)

  const mayorName = signatories?.mayor?.name || ''
  const mayorTitle = signatories?.mayor?.title || `นายก${esc(tenant?.name || '')}`

  return `
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
    <div><b>เรื่อง:</b> รายงานผลการคำนวณราคากลางงานก่อสร้าง</div>
  </div>

  <div class="memo-body">
    <p><b>เรียน</b> นายก${esc(tenant?.name || '')}</p>
    
    <p class="memo-p">
      ตามที่ กองช่าง ได้รับอนุมัติให้ดำเนินการจัดทำแบบรูปรายการและประมาณการราคา โครงการ<b>${esc(project.title)}</b>
      ประจำปีงบประมาณ พ.ศ. ${esc(project.fiscal_year || '–')} โดยได้รับจัดสรรงบประมาณเป็นเงินทั้งสิ้น
      <b>${money(project.budget_amount)} บาท (${esc(thaiBahtText(project.budget_amount))})</b>
      ${data.orderNo ? `และตามคำสั่ง${esc(tenant?.name || '')} ที่ ${esc(data.orderNo)} ${data.orderDate ? `ลงวันที่ ${thaiDate(data.orderDate)}` : ''} ได้แต่งตั้งคณะกรรมการกำหนดราคากลาง นั้น` : 'นั้น'}
    </p>
    <p class="memo-p">
      บัดนี้ คณะกรรมการกำหนดราคากลางได้ร่วมกันตรวจสอบแบบรูปรายการงานก่อสร้าง และได้คำนวณราคากลางตามหลักเกณฑ์การคำนวณราคากลางงานก่อสร้างของทางราชการเรียบร้อยแล้ว ปรากฏผลการคำนวณราคากลางดังนี้:
    </p>
    <div style="margin-left: 1.2cm; margin-bottom: 1mm;">
      <div>๑. ค่างานต้นทุน เป็นเงิน <b>${money(data.costAmount)}</b> บาท</div>
      <div>๒. ค่า Factor F เท่ากับ <b>${esc(data.factorF || '–')}</b></div>
      <div>๓. รวมค่าก่อสร้างคำนวณได้ เป็นเงิน <b>${money(data.calcAmount)}</b> บาท</div>
      <div>๔. ราคากลางที่กำหนด (ปัดเศษ) เป็นเงินทั้งสิ้น <b>${money(data.medianAmount)} บาท (${esc(thaiBahtText(data.medianAmount))})</b></div>
    </div>
    <p class="memo-p">
      คณะกรรมการกำหนดราคากลางพิจารณาแล้ว เห็นว่าราคากลางดังกล่าวมีความเหมาะสม ถูกต้องตามหลักเกณฑ์ของทางราชการ และไม่เกินวงเงินงบประมาณที่ได้รับจัดสรร จึงเห็นควรใช้ราคากลางจำนวน <b>${money(data.medianAmount)} บาท</b> เป็นราคากลางในการจัดจ้างก่อสร้างโครงการดังกล่าว
    </p>
    <p class="memo-p">
      จึงเรียนมาเพื่อโปรดพิจารณา:
    </p>
    <div style="margin-left: 1.2cm; margin-bottom: 1mm;">
      <div>๑. ให้ความเห็นชอบราคากลางงานก่อสร้างโครงการดังกล่าว</div>
      <div>๒. อนุมัติให้ส่งเรื่องให้เจ้าหน้าที่พัสดุดำเนินการตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. ๒๕๖๐ ต่อไป</div>
    </div>

    <div class="committee-signs" style="display: flex; flex-direction: column; gap: 2mm; margin-top: 2mm;">
      <div style="display: flex; justify-content: flex-end;">
        ${govSignRow({
    width: GOV_SIGN_LINE_W,
    label: 'ลงชื่อ',
    role: 'ประธานกรรมการ',
    below: [
      president?.name ? `(${esc(president.name)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(president?.position_title || 'ตำแหน่ง .......................................................').map(esc),
    ],
  })}
      </div>

      ${members.length > 0 ? `
      <div class="committee-grid" style="display: grid; grid-template-columns: repeat(${Math.min(members.length, 2)}, 1fr); gap: 2mm;">
        ${members.slice(0, 2).map(m => `
          <div style="display: flex; justify-content: center;">
            ${govSignRow({
    width: GOV_SIGN_LINE_W,
    label: 'ลงชื่อ',
    role: 'กรรมการ',
    below: [
      m?.name ? `(${esc(m.name)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(m?.position_title || 'ตำแหน่ง .......................................................').map(esc),
    ],
  })}
          </div>
        `).join('')}
      </div>` : ''}
    </div>

    <div class="mayor-box">
      <div><b>คำสั่ง / ความเห็นของนายก${esc(tenant?.name || '')}:</b></div>
      <div style="margin-top: 1mm; display: flex; gap: 8mm;">
        <div>[ &nbsp; ] เห็นชอบราคากลางและอนุมัติให้ดำเนินการต่อไป</div>
        <div>[ &nbsp; ] อื่นๆ ............................................................</div>
      </div>
      <div style="margin-top: 1.5mm; display: flex; justify-content: flex-end;">
        ${govSignRow({
    width: GOV_SIGN_LINE_W,
    label: 'ลงชื่อ',
    below: [
      mayorName ? `(${esc(mayorName)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(mayorTitle).map(esc),
      'วันที่ ....../....../............',
    ],
  })}
      </div>
    </div>
  </div>
</section>
`
}

/**
 * แผ่นที่ 2: ตารางแสดงวงเงินงบประมาณและราคากลาง (บก.01 ป.ป.ช.)
 */
function pageTwoBg01({ tenant, project, data }) {
  const committee = data.committee || []

  return `
<section class="pg">
  <div class="doc-title">
    ตารางแสดงวงเงินงบประมาณที่ได้รับจัดสรรและราคากลางในงานจ้างก่อสร้าง
  </div>

  <table class="bordered-table">
    <tr>
      <td style="width: 35mm; font-weight: 700;">๑. ชื่อโครงการ</td>
      <td>
        <b>${esc(project.title)}</b><br>
        / หน่วยงานเจ้าของโครงการ: กองช่าง ${esc(tenant?.name || '')}
      </td>
    </tr>
    <tr>
      <td style="font-weight: 700;">๒. วงเงินงบประมาณ ที่ได้รับจัดสรร</td>
      <td>
        <b>${money(project.budget_amount)} บาท</b> (${esc(thaiBahtText(project.budget_amount))})
      </td>
    </tr>
    <tr>
      <td style="font-weight: 700;">๓. ลักษณะงาน โดยสังเขป</td>
      <td>
        ${esc(data.workScope || project.description || 'ดำเนินงานก่อสร้างตามแบบรูปรายการละเอียดและข้อกำหนดของทางราชการ')}
        ${project.location_desc ? `<br>สถานที่ก่อสร้าง: ${esc(project.location_desc)}` : ''}
      </td>
    </tr>
    <tr>
      <td style="font-weight: 700;">๔. ราคากลางคำนวณ ณ วันที่</td>
      <td>
        <b>${esc(thaiDate(data.docDate))}</b><br>
        เป็นเงินทั้งสิ้น <b>${money(data.medianAmount)} บาท</b> (${esc(thaiBahtText(data.medianAmount))})
      </td>
    </tr>
    <tr>
      <td style="font-weight: 700;">๕. บัญชีประมาณการ ราคากลาง</td>
      <td>
        ๕.๑ แบบแสดงรายการ ปริมาณงาน และราคา (แบบ ปร.๔)<br>
        ๕.๒ แบบสรุปค่าก่อสร้าง (แบบ ปร.๕)<br>
        ๕.๓ แบบสรุปราคากลางงานก่อสร้าง (แบบ ปร.๖)
      </td>
    </tr>
    <tr>
      <td style="font-weight: 700;">๖. แหล่งที่มา ของราคากลาง (ราคาอ้างอิง)</td>
      <td>
        ${esc(data.sourceOfPrice || 'หลักเกณฑ์และวิธีการกำหนดราคากลางงานก่อสร้างของกรมบัญชีกลาง / ราคามาตรฐานสำนักงบประมาณ / บัญชีราคาพาณิชย์จังหวัด')}
      </td>
    </tr>
    <tr>
      <td style="font-weight: 700;">๗. รายชื่อคณะกรรมการ กำหนดราคากลาง</td>
      <td>
        ${committee.length > 0 ? committee.map((c, i) => `
          <div>๗.${i + 1} ${esc(c.name || '–')} ตำแหน่ง ${esc(c.position_title || '–')} (${esc(c.duty || 'กรรมการ')})</div>
        `).join('') : `
          <div>๗.๑ ${govNameBlank('45mm')} (ประธานกรรมการ)</div>
          <div>๗.๒ ${govNameBlank('45mm')} (กรรมการ)</div>
          <div>๗.๓ ${govNameBlank('45mm')} (กรรมการ)</div>
        `}
      </td>
    </tr>
  </table>

  <div style="margin-top: 6mm; text-align: center; font-size: 11pt; color: #555;">
    * แบบ บก.๐๑ สำหรับประกาศเปิดเผยราคากลางและการคำนวณราคากลางงานก่อสร้างตามแนวทางของ ป.ป.ช. และกรมบัญชีกลาง *
  </div>
</section>
`
}

/**
 * แผ่นที่ 3: แบบสรุปราคากลางงานก่อสร้างทาง สะพาน และท่อเหลี่ยม (แบบ ปร.๖ กรมบัญชีกลาง)
 */
function pageThreePr6({ tenant, project, data, origin = '' }) {
  const committee = data.committee || []
  const president = committee.find(c => c.duty?.includes('ประธาน')) || committee[0]
  const members = committee.filter(c => c !== president)

  return `
<section class="pg pg-last">
  <div class="doc-title">แบบสรุปราคากลางงานก่อสร้างทาง สะพาน และท่อเหลี่ยม (แบบ ปร.๖)</div>
  <div class="doc-subtitle">ส่วนราชการ: กองช่าง ${esc(tenant?.name || '')}</div>

  <table style="width: 100%; margin-bottom: 2mm; font-size: 13pt;">
    <tr>
      <td style="width: 50%;"><b>กลุ่มงาน/โครงการ:</b> ${esc(project.title)}</td>
      <td style="width: 50%;"><b>ปีงบประมาณ:</b> ${esc(project.fiscal_year || '–')}</td>
    </tr>
    <tr>
      <td colspan="2"><b>สถานที่ก่อสร้าง:</b> ${esc(project.location_desc || `${project.village || ''} ต.${project.subdistrict || ''} อ.${project.district || ''} จ.${project.province || ''}` || '–')}</td>
    </tr>
    <tr>
      <td colspan="2"><b>คำนวณราคากลางเมื่อวันที่:</b> ${esc(thaiDate(data.docDate))}</td>
    </tr>
  </table>

  <table class="bordered-table">
    <thead>
      <tr>
        <th style="width: 12mm;">ลำดับ</th>
        <th>รายการ</th>
        <th style="width: 32mm;">ค่างานต้นทุน (บาท)</th>
        <th style="width: 24mm;">Factor F</th>
        <th style="width: 35mm;">ค่าก่อสร้างรวม (บาท)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align: center;">๑</td>
        <td>ค่างานตามแบบรูปรายการละเอียด (ปร.๔ / ปร.๕)</td>
        <td style="text-align: right;">${money(data.costAmount)}</td>
        <td style="text-align: center;">${esc(data.factorF || '–')}</td>
        <td style="text-align: right;">${money(data.calcAmount)}</td>
      </tr>
      <tr style="font-weight: 700; background-color: #fafafa;">
        <td colspan="4" style="text-align: right;">รวมค่าก่อสร้างทั้งสิ้น</td>
        <td style="text-align: right;">${money(data.calcAmount)}</td>
      </tr>
      <tr style="font-weight: 700; background-color: #f0fdf4;">
        <td colspan="4" style="text-align: right;">ราคากลางที่กำหนด (ปัดเศษ)</td>
        <td style="text-align: right;">${money(data.medianAmount)}</td>
      </tr>
      <tr>
        <td colspan="5" style="text-align: center; font-weight: 700;">
          (ตัวอักษร: ${esc(thaiBahtText(data.medianAmount))})
        </td>
      </tr>
    </tbody>
  </table>

  <div style="margin-top: 3.5mm;">
    <p>คณะกรรมการกำหนดราคากลางได้ตรวจสอบและเห็นชอบร่วมกันให้กำหนดราคากลางตามจำนวนเงินดังกล่าว</p>
  </div>

  <div class="committee-signs" style="display: flex; flex-direction: column; gap: 2.5mm; margin-top: 5mm;">
    <div style="display: flex; justify-content: flex-end;">
      ${govSignRow({
    width: GOV_SIGN_LINE_W,
    label: 'ลงชื่อ',
    role: 'ประธานกรรมการ',
    below: [
      president?.name ? `(${esc(president.name)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(president?.position_title || 'ตำแหน่ง .......................................................').map(esc),
    ],
  })}
    </div>

    ${members.length > 0 ? `
    <div class="committee-grid" style="display: grid; grid-template-columns: repeat(${Math.min(members.length, 2)}, 1fr); gap: 2.5mm;">
      ${members.map(m => `
        <div style="display: flex; justify-content: center;">
          ${govSignRow({
    width: GOV_SIGN_LINE_W,
    label: 'ลงชื่อ',
    role: 'กรรมการ',
    below: [
      m?.name ? `(${esc(m.name)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(m?.position_title || 'ตำแหน่ง .......................................................').map(esc),
    ],
  })}
        </div>
      `).join('')}
    </div>` : ''}
  </div>
  ${origin ? `<div class="origin">${esc(origin)}</div>` : ''}
</section>
`
}

/**
 * สร้าง HTML สำหรับชุดเอกสารราคากลาง (3 แผ่น)
 */
export function buildCivilMedianHtml({ tenant, project, data, signatories = null, emblemUrl = '', printedAt = new Date() }) {
  const origin = `พิมพ์เมื่อ ${thaiDateFromDateInput(`${printedAt.getFullYear()}-${String(printedAt.getMonth() + 1).padStart(2, '0')}-${String(printedAt.getDate()).padStart(2, '0')}`)} · ${govEServiceOriginText(tenant)}`
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(`ชุดเอกสารราคากลาง_${project.title}`)}</title>
${GOV_FONT_LINK}
<style>${pageCss()}</style>
</head><body>
<div class="sheet">
  ${pageOneMemo({ tenant, project, data, signatories, emblemUrl })}
  ${pageTwoBg01({ tenant, project, data })}
  ${pageThreePr6({ tenant, project, data, origin })}
</div>
</body></html>`
}

/**
 * เปิดหน้าต่างและสั่งพิมพ์ชุดเอกสารราคากลาง — โหลดผู้ลงนามกลางจาก document_signatories
 */
export function printCivilMedianDoc({ tenant, project, data }) {
  return openLifecyclePrint(({ signatories, emblemUrl }) => buildCivilMedianHtml({
    tenant,
    project,
    data,
    signatories,
    emblemUrl,
  }), { municipalityId: tenant?.id, departmentId: project?.department_id })
}
