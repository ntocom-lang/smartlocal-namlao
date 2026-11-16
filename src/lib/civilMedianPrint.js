// ชุดเอกสารราคากลางงานก่อสร้าง (กองช่าง) — A4 แนวตั้ง
// ประกอบด้วย 3 แผ่น:
// 1. บันทึกข้อความรายงานผลการกำหนดราคากลาง
// 2. แบบ บก.01 (ตารางแสดงวงเงินงบประมาณที่ได้รับจัดสรรและราคากลางในงานจ้างก่อสร้าง)
// 3. แบบ ปร.6 สรุปราคากลางงานก่อสร้าง
// มาตรฐานการพิมพ์: THSarabunPSK 14pt ตาม src/lib/govDocStyle.js

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
  .pg + .pg { break-before: page; page-break-before: always; margin-top: 10mm; }
  @media print { .pg + .pg { margin-top: 0; } }

  /* หัวบันทึกข้อความ */
  .memo-head { display: flex; align-items: flex-end; position: relative; margin-bottom: 3mm; border-bottom: 2px solid #000; padding-bottom: 2mm; }
  .memo-garuda { width: 22mm; height: 22mm; object-fit: contain; }
  .memo-title { position: absolute; left: 0; right: 0; text-align: center; font-size: 26pt; font-weight: 700; line-height: 1; pointer-events: none; }
  .memo-meta { margin-bottom: 3mm; line-height: 1.4; }
  .memo-meta-row { display: flex; justify-content: space-between; }
  .memo-body { text-align: justify; text-justify: inter-cluster; line-height: 1.45; }
  .memo-p { text-indent: 2.5cm; margin-bottom: 2.5mm; }

  /* ตาราง บก.01 และ ปร.6 */
  .doc-title { text-align: center; font-size: 16pt; font-weight: 700; margin-bottom: 3mm; line-height: 1.3; }
  .doc-subtitle { text-align: center; font-size: 14pt; font-weight: 700; margin-bottom: 4mm; }
  .bordered-table { width: 100%; border-collapse: collapse; margin-top: 3mm; margin-bottom: 3mm; }
  .bordered-table th, .bordered-table td { border: 1px solid #000; padding: 1.5mm 2.5mm; vertical-align: top; }
  .bordered-table th { background-color: #f5f5f5; font-weight: 700; text-align: center; }

  /* กล่องลงนาม */
  .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 6mm; }
  .sign-col { text-align: center; line-height: 1.4; }
  .sign-space { height: 14mm; }
  .mayor-box { margin-top: 6mm; border: 1px solid #000; padding: 3mm; border-radius: 1mm; }
  .origin { margin-top: 5mm; font-size: 10pt; color: #666; text-align: right; }
  `
}

/**
 * แผ่นที่ 1: บันทึกข้อความรายงานผลราคากลาง
 */
function pageOneMemo({ tenant, project, data, emblemUrl }) {
  const committee = data.committee || []
  const president = committee.find(c => c.duty?.includes('ประธาน')) || committee[0]
  const members = committee.filter(c => c !== president)

  return `
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
    <div><b>เรื่อง:</b> รายงานผลการกำหนดราคากลางงานก่อสร้าง โครงการ${esc(project.title)}</div>
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
    <div style="margin-left: 2.5cm; margin-bottom: 2.5mm;">
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
    <div style="margin-left: 2.5cm; margin-bottom: 3mm;">
      <div>๑. ให้ความเห็นชอบราคากลางงานก่อสร้างโครงการดังกล่าว</div>
      <div>๒. อนุมัติให้ส่งเรื่องให้เจ้าหน้าที่พัสดุดำเนินการตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. ๒๕๖๐ ต่อไป</div>
    </div>

    <div class="sign-grid">
      <div></div>
      <div class="sign-col">
        <div class="sign-space"></div>
        <div>(ลงชื่อ).......................................................ประธานกรรมการ</div>
        <div>(${esc(president?.name ? `นาย/นาง/น.ส. ${president.name}` : '.......................................................')})</div>
        <div>${esc(president?.position_title || 'ตำแหน่ง .......................................................')}</div>
      </div>
    </div>

    ${members.length > 0 ? `
    <div class="sign-grid" style="margin-top: 3mm;">
      ${members.slice(0, 2).map(m => `
        <div class="sign-col">
          <div class="sign-space"></div>
          <div>(ลงชื่อ).......................................................กรรมการ</div>
          <div>(${esc(m?.name ? `นาย/นาง/น.ส. ${m.name}` : '.......................................................')})</div>
          <div>${esc(m?.position_title || 'ตำแหน่ง .......................................................')}</div>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="mayor-box">
      <div><b>คำสั่ง / ความเห็นของนายก${esc(tenant?.name || '')}:</b></div>
      <div style="margin-top: 1.5mm; display: flex; gap: 8mm;">
        <div>[ &nbsp; ] เห็นชอบราคากลางและอนุมัติให้ดำเนินการต่อไป</div>
        <div>[ &nbsp; ] อื่นๆ ............................................................</div>
      </div>
      <div style="margin-top: 3mm; text-align: right; padding-right: 15mm;">
        <div>(ลงชื่อ)................................................................</div>
        <div style="margin-top: 1mm;">(................................................................)</div>
        <div>นายก${esc(tenant?.name || '')}</div>
        <div>วันที่ ....../....../............</div>
      </div>
    </div>
  </div>
</section>
`
}

/**
 * แผ่นที่ 2: ตารางแสดงวงเงินงบประมาณและราคากลาง (บก.01)
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
      <td style="width: 32mm; font-weight: 700;">๑. ชื่อโครงการ</td>
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
          <div>๗.๑ ................................................................ (ประธานกรรมการ)</div>
          <div>๗.๒ ................................................................ (กรรมการ)</div>
          <div>๗.๓ ................................................................ (กรรมการ)</div>
        `}
      </td>
    </tr>
  </table>

  <div style="margin-top: 8mm; text-align: center; font-size: 12pt; color: #555;">
    * แบบ บก.๐๑ สำหรับประกาศเปิดเผยราคากลางและการคำนวณราคากลางงานก่อสร้างตามแนวทางของ ป.ป.ช. และกรมบัญชีกลาง *
  </div>
</section>
`
}

/**
 * แผ่นที่ 3: แบบสรุปราคากลางงานก่อสร้าง (ปร.6 สรุป)
 */
function pageThreePr6({ tenant, project, data }) {
  const committee = data.committee || []
  const president = committee.find(c => c.duty?.includes('ประธาน')) || committee[0]
  const members = committee.filter(c => c !== president)

  return `
<section class="pg">
  <div class="doc-title">แบบสรุปราคากลางงานก่อสร้าง (แบบ ปร.๖)</div>
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

  <div style="margin-top: 4mm;">
    <p>คณะกรรมการกำหนดราคากลางได้ตรวจสอบและเห็นชอบร่วมกันให้กำหนดราคากลางตามจำนวนเงินดังกล่าว</p>
  </div>

  <div class="sign-grid" style="margin-top: 6mm;">
    <div></div>
    <div class="sign-col">
      <div class="sign-space"></div>
      <div>(ลงชื่อ).......................................................ประธานกรรมการ</div>
      <div>(${esc(president?.name ? `นาย/นาง/น.ส. ${president.name}` : '.......................................................')})</div>
      <div>${esc(president?.position_title || 'ตำแหน่ง .......................................................')}</div>
    </div>
  </div>

  ${members.length > 0 ? `
  <div class="sign-grid" style="margin-top: 4mm;">
    ${members.map(m => `
      <div class="sign-col">
        <div class="sign-space"></div>
        <div>(ลงชื่อ).......................................................กรรมการ</div>
        <div>(${esc(m?.name ? `นาย/นาง/น.ส. ${m.name}` : '.......................................................')})</div>
        <div>${esc(m?.position_title || 'ตำแหน่ง .......................................................')}</div>
      </div>
    `).join('')}
  </div>` : ''}
</section>
`
}

/**
 * สร้าง HTML สำหรับชุดเอกสารราคากลาง (3 แผ่น)
 */
export function buildCivilMedianHtml({ tenant, project, data, emblemUrl = '', printedAt = new Date() }) {
  const origin = `พิมพ์เมื่อ ${thaiDateFromDateInput(`${printedAt.getFullYear()}-${String(printedAt.getMonth() + 1).padStart(2, '0')}-${String(printedAt.getDate()).padStart(2, '0')}`)} · ${govEServiceOriginText(tenant)}`
  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(`ชุดเอกสารราคากลาง_${project.title}`)}</title>
${GOV_FONT_LINK}
<style>${pageCss()}</style>
</head><body>
<div class="sheet">
  ${pageOneMemo({ tenant, project, data, emblemUrl })}
  ${pageTwoBg01({ tenant, project, data })}
  ${pageThreePr6({ tenant, project, data })}
  <div class="origin">${esc(origin)}</div>
</div>
</body></html>`
}

/**
 * เปิดหน้าต่างและสั่งพิมพ์ชุดเอกสารราคากลาง
 */
export function printCivilMedianDoc({ tenant, project, data }) {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) {
    alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    return
  }
  const html = buildCivilMedianHtml({
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
