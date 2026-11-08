// ใบพิมพ์ "แผนการดำเนินงาน" ประจำปีงบประมาณ (เมนูแผนพัฒนาท้องถิ่น) — A4 แนวนอน
//
// หน้า 1 = ปก (ชื่อเรื่อง ปีงบ ฉบับ ชื่อ อปท.) · หน้าถัดไป = ตารางแบบฉบับกระดาษ:
//   ที่ | โครงการ/กิจกรรม | งบประมาณ (บาท) | ไตรมาส 1–4 แยก 12 เดือน (ต.ค.–ก.ย.) | ผู้รับผิดชอบ
// ช่วงเดือนของรายการ = ลูกศรสองหัวคร่อมช่องเดือนเริ่ม–สิ้นสุด (แบบเดียวกับตารางบนหน้าจอ)
// ไม่มีช่องลงนามบนใบนี้ (เจ้าของระบบอนุมัติแผน) · ฉบับร่างมีคำว่า "(ร่าง)" บนปก ฉบับประกาศแล้วไม่มี
//
// เลย์เอาต์ตามใบแนวนอนของระบบ (fleetCustodianRegisterPrint.js): ขอบบน/ล่างของ "ทุกหน้า" มาจากแถวเว้นระยะใน thead/tfoot
// ของตารางห่อนอก เพราะ @page margin เป็น 0 (ซ่อนหัวกระดาษของเบราว์เซอร์) — padding ของกล่องหน้ามีผลแค่หน้าแรก
// ลูกศรทำด้วย "เส้นขอบ" (border) ไม่ใช่สีพื้น เพราะเครื่องผู้ใช้อาจปิดพิมพ์พื้นหลัง (printBackground) แล้วลูกศรจะหาย
//
// ⚠️ ค่าที่มาจากข้อมูลทุกตัวผ่าน esc() · ไฟล์นี้ไม่อ่านนาฬิกา (asOf ส่งเข้ามา) · ผลเป็นสตริงเอกสารทั้งหน้า ผู้เรียกเปิดหน้าต่างเอง
import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, GOV_FONT_SIZE, GOV_LINE_HEIGHT, govDocFontIdentityCss, govEServiceOriginText, govPageCss, govPagePadding,
} from './govDocStyle.js'
import { fiscalMonthLabel, fiscalMonthToCalendar, spanLabel, validateSpan } from './localPlanCalendar.js'
import { formatBaht, sortItems, sumAmount, versionLabel } from './localPlanView.js'
import { addMobileCloseButton } from './printWindowClose.js'

// ขอบกระดาษแนวนอนตามมาตรฐาน "บน ขวา ล่าง ซ้าย" แยกเป็นรายด้านไว้ใช้กับแถวเว้นระยะ (ค่าเดียวกับใบแนวนอนอื่น)
const [PAD_TOP, PAD_RIGHT, PAD_BOTTOM, PAD_LEFT] = govPagePadding({ size: 'A4 landscape' }).split(/\s+/)

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const isBlank = v => v === null || v === undefined || v === ''

function placeLine(tenant) {
  const district = clean(tenant?.district).replace(/^(อำเภอ|อ\.)\s*/, '')
  const province = clean(tenant?.province).replace(/^(จังหวัด|จ\.)\s*/, '')
  return [clean(tenant?.name), district && `อำเภอ${district}`, province && `จังหวัด${province}`].filter(Boolean).join(' ')
}

/**
 * หัวเดือน 12 ช่อง เรียง ต.ค.→ก.ย. พร้อมปี พ.ศ. 2 หลัก : ต.ค.–ธ.ค. = ปี (fiscalYear − 1) · ม.ค.–ก.ย. = ปี fiscalYear
 * → [{ month (1–12 ของปีงบ), label: 'ต.ค.', yearBE: 2568, text: 'ต.ค.68' }]
 */
export function monthHeaderLabels(fiscalYear) {
  return MONTHS.map(month => {
    const cal = fiscalMonthToCalendar(month, fiscalYear)
    const label = fiscalMonthLabel(month)
    return { month, label, yearBE: cal?.yearBE ?? null, text: cal ? `${label}${String(cal.yearBE).slice(-2)}` : label }
  })
}

/**
 * ช่องเดือนของ 1 รายการ → สตริง <td> ที่รวมกันได้ 12 ช่องพอดี (นับ colspan)
 * มีช่วงเดือนที่ถูกต้อง → ช่องว่างก่อนช่วง + <td colspan=ความยาวช่วง> ที่มีลูกศรสองหัว + ช่องว่างหลังช่วง
 * ไม่มีเดือน / ช่วงผิดรูป (ใส่ข้างเดียว ย้อนกลับ นอก 1–12) → 12 ช่องว่าง (ไม่เดาช่วงให้)
 */
export function monthCellsHtml(item) {
  const empty = n => '<td class="mc"></td>'.repeat(n)
  const from = item?.month_from
  const to = item?.month_to
  if (isBlank(from) || isBlank(to) || validateSpan(from, to) !== null) return empty(12)
  const a = Number(from)
  const b = Number(to)
  const label = esc(spanLabel(a, b))
  return `${empty(a - 1)}<td class="mc span-cell" colspan="${b - a + 1}"><div class="span" role="img" aria-label="${label}"><i class="ah l"></i><i class="ln"></i><i class="ah r"></i></div></td>${empty(12 - b)}`
}

/** ผู้รับผิดชอบ : โครงการของหน่วยงานอื่นใช้ชื่อหน่วยงานที่กรอกไว้ · ไม่งั้นชื่อกองจากทะเบียนของ อปท. นี้ (ไม่เจอ/ไม่ระบุ = ว่าง) */
export function responsibleOf(item, departments) {
  if (item?.source === 'external') return clean(item.external_agency)
  const dept = (departments ?? []).find(d => d.id === item?.department_id)
  return clean(dept?.name)
}

function itemRow(item) {
  return `<tr class="item">
    <td class="no">${isBlank(item.seq_no) ? '' : esc(item.seq_no)}</td>
    <td class="name">${esc(clean(item.item_name))}</td>
    <td class="amt">${isBlank(item.amount) ? '' : esc(formatBaht(item.amount))}</td>
    ${monthCellsHtml(item)}
    <td class="who">${esc(item._who)}</td>
  </tr>`
}

function tableHead(fiscalYear) {
  const quarters = [1, 2, 3, 4].map(q => `<th colspan="3" class="qh">ไตรมาส ${q}</th>`).join('')
  const labels = monthHeaderLabels(fiscalYear)
  // ปี พ.ศ. แยกเป็นแถวบนสุด (ต.ค.–ธ.ค. = ปีงบ−1 คร่อม 3 ช่อง · ม.ค.–ก.ย. = ปีงบ คร่อม 9 ช่อง) ช่องเดือนจึงเหลือแค่ชื่อเดือน
  // ตัวอักษรใหญ่พออ่านได้ (เดิมใส่ปีท้ายชื่อเดือน "เม.ย.69" ต้องย่อเหลือ 8pt ซึ่งเล็กเกินอ่าน)
  const years = [labels[0].yearBE, labels[3].yearBE]
  const yearRow = years.every(Number.isFinite)
    ? `<th colspan="3" class="yh">พ.ศ. ${esc(years[0])}</th><th colspan="9" class="yh">พ.ศ. ${esc(years[1])}</th>`
    : '<th colspan="12" class="yh"></th>'
  const months = labels.map(m => `<th class="mh">${esc(m.label)}</th>`).join('')
  return `<thead>
      <tr>
        <th rowspan="3" class="c-h">ที่</th>
        <th rowspan="3" class="c-h">โครงการ/กิจกรรม</th>
        <th rowspan="3" class="c-h">งบประมาณ<br>(บาท)</th>
        ${yearRow}
        <th rowspan="3" class="c-h">ผู้รับผิดชอบ</th>
      </tr>
      <tr>${quarters}</tr>
      <tr>${months}</tr>
    </thead>`
}

function tableBody(items, departments) {
  if (!items.length) return '<tr class="empty"><td colspan="16">— ยังไม่มีรายการ —</td></tr>'
  const rows = items.map(item => itemRow({ ...item, _who: responsibleOf(item, departments) })).join('\n')
  const total = `<tr class="total">
    <td colspan="2" class="sum-label">รวม ${items.length} รายการ</td>
    <td class="amt">${esc(formatBaht(sumAmount(items)))}</td>
    <td colspan="13"></td>
  </tr>`
  return `${rows}\n${total}`
}

/**
 * ใบแผนการดำเนินงาน 1 ฉบับ (ปก + ตาราง) → สตริง HTML ทั้งหน้า
 * tenant = { name, district, province } · opPlan = { fiscal_year, kind, revision_no, status } · items = แถวของ local_op_plan_items
 * departments = [{ id, name }] ของ อปท. นี้ · asOf = 'YYYY-MM-DD' ตามเวลาไทย (ส่งเข้ามา ไม่อ่านนาฬิกาในนี้)
 */
export function buildOpPlanPrintHtml({ tenant = null, opPlan = null, items = [], departments = [], asOf = '' } = {}) {
  const orgName = clean(tenant?.name)
  const fiscalYear = Number(opPlan?.fiscal_year)
  const sorted = sortItems(items)
  const draft = opPlan?.status === 'draft'
  const version = opPlan && opPlan.kind && opPlan.kind !== 'main' ? versionLabel(opPlan) : ''
  const asOfMatch = String(asOf ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  const asOfText = asOfMatch ? `${Number(asOfMatch[3])}/${Number(asOfMatch[2])}/${Number(asOfMatch[1]) + 543}` : ''
  const origin = govEServiceOriginText(orgName)

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>แผนการดำเนินงาน ปีงบประมาณ ${esc(Number.isFinite(fiscalYear) ? fiscalYear : '')} ${esc(orgName)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ size: 'A4 landscape', hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    /* ⚠️ ใช้ govDocFontIdentityCss() ไม่ใช่ govDocFontCss() โดยตั้งใจ (ข้อยกเว้นเรื่อง "ขนาดตัวอักษร" ตาม AGENTS.md):
       ตารางมีช่องเดือน 12 ช่องกว้างช่องละ ~9.7 มม. ชื่อเดือนที่กว้างสุด ("เม.ย.") ที่ 14pt ล้นช่อง (ปี พ.ศ. ย้ายไปแถวบนสุดแล้ว)
       จึงลดเฉพาะ "หัวเดือน" (th.mh) เป็น 11pt ให้จบบรรทัดเดียว ส่วนชื่อโครงการ ที่ ผู้รับผิดชอบ และงบประมาณ
       ยังเป็นขนาดมาตรฐาน (GOV_FONT_SIZE) ฟอนต์และ font-size-adjust ยังเป็นค่ากลางเหมือนใบอื่น (พิมพ์ออกเท่ากันทุกเครื่อง)
       ปรับค่าที่นี่แล้วต้องรัน npm run test:local-plan:print */
    body { color: #000; ${govDocFontIdentityCss()} font-size: ${GOV_FONT_SIZE}; line-height: ${GOV_LINE_HEIGHT}; background: #fff; }
    .sheet { width: 297mm; min-height: 210mm; padding: 0 ${PAD_RIGHT} 0 ${PAD_LEFT}; }
    .cover { padding-top: calc(${PAD_TOP} + 36mm); text-align: center; break-after: page; page-break-after: always; }
    .cover p { margin: 0; }
    .cover .draft { font-weight: 700; margin-bottom: 4mm; }
    .cover h1 { margin: 0 0 6mm; font-size: ${GOV_FONT_SIZE}; font-weight: 700; line-height: ${GOV_LINE_HEIGHT}; }
    .cover .big { font-weight: 700; }
    .cover .place { margin-top: 12mm; font-weight: 700; }
    table.page { width: 100%; border-collapse: collapse; table-layout: auto; }
    table.page > thead > tr > td, table.page > tbody > tr > td, table.page > tfoot > tr > td { border: 0; padding: 0; text-align: left; vertical-align: top; }
    td.space-top { height: ${PAD_TOP}; }
    td.space-bottom { height: ${PAD_BOTTOM}; }
    .eservice-origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 3mm; text-align: center; }
    @media print {
      html, body { height: auto; }
      .sheet { width: auto; min-height: 0; height: auto; }
      table.plan thead { display: table-header-group; }
      table.plan tr { break-inside: avoid; page-break-inside: avoid; }
    }
    table.plan { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.plan th, table.plan td { border: 1px solid #000; vertical-align: middle; text-align: center; overflow-wrap: anywhere; }
    table.plan th { font-weight: 700; line-height: 1.15; padding: 1mm 1px; }
    /* หัวเดือน: ขนาดเล็กกว่ามาตรฐานเฉพาะช่องนี้ ดูเหตุผลที่ body ด้านบน · nowrap กันตกบรรทัด */
    table.plan th.mh { font-size: 11pt; white-space: nowrap; padding: 1mm 0; overflow: hidden; }
    table.plan td { padding: 0.8mm 1.2mm; line-height: 1.15; }
    table.plan td.mc { padding: 0; }
    table.plan td.name, table.plan td.who { text-align: left; }
    table.plan td.amt { text-align: right; white-space: nowrap; padding: 0.8mm 1.2mm 0.8mm 0.5mm; }
    table.plan td.no { padding-left: 0.4mm; padding-right: 0.4mm; }
    table.plan tr.empty td { color: #555; padding: 5mm; }
    table.plan tr.total td { font-weight: 700; }
    table.plan tr.total td.sum-label { text-align: right; padding-right: 2mm; }
    /* ลูกศรสองหัวคร่อมช่วงเดือน: เส้นกลาง + หัวลูกศร ทำด้วยเส้นขอบล้วน (พิมพ์ออกแน่นอนแม้ปิดพิมพ์พื้นหลัง) */
    .span { display: flex; align-items: center; height: 3.2mm; margin: 0 0.5mm; }
    .span .ln { flex: 1; min-width: 0; height: 0; border-top: 0.45mm solid #000; }
    .span .ah { flex: none; width: 0; height: 0; border-top: 1.4mm solid transparent; border-bottom: 1.4mm solid transparent; }
    .span .ah.l { border-right: 2.2mm solid #000; }
    .span .ah.r { border-left: 2.2mm solid #000; }
    /* ความกว้างรวม 257 มม. (= พื้นที่พิมพ์แนวนอน) : ที่ 9 · โครงการ 64.6 · งบ 33 · เดือน 12×9.7=116.4 · ผู้รับผิดชอบ 34
       งบ 33 มม. = พอสำหรับผลรวมแถวรวมสูงสุดราว 999,999,999.99 บาท (ตัวหนา 14pt วัดจริง 30.4 มม. + ขอบใน 1.7 มม.)
       ปรับแล้วต้องรัน npm run test:local-plan:print */
    col.c-no { width: 9mm; }
    col.c-name { width: 64.6mm; }
    col.c-amt { width: 33mm; }
    col.c-m { width: 9.7mm; }
    col.c-who { width: 34mm; }
  </style>
</head>
<body>
<section class="sheet cover">
  ${draft ? '<p class="draft">(ร่าง)</p>' : ''}
  <h1>แผนการดำเนินงาน</h1>
  <p class="big">ประจำปีงบประมาณ พ.ศ. ${esc(Number.isFinite(fiscalYear) ? fiscalYear : '')}</p>
  ${version ? `<p class="big">${esc(version)}</p>` : ''}
  <p class="place">${esc(placeLine(tenant))}</p>
</section>
<section class="sheet">
<table class="page">
  <thead><tr><td class="space-top"></td></tr></thead>
  <tfoot><tr><td class="space-bottom"></td></tr></tfoot>
  <tbody><tr><td>
  <table class="plan">
    <colgroup><col class="c-no"><col class="c-name"><col class="c-amt">${'<col class="c-m">'.repeat(12)}<col class="c-who"></colgroup>
    ${tableHead(fiscalYear)}
    <tbody>
${tableBody(sorted, departments)}
    </tbody>
  </table>
  <div class="eservice-origin">${esc(origin)}${asOfText ? ` · ข้อมูล ณ วันที่ ${esc(asOfText)}` : ''}</div>
  </td></tr></tbody>
</table>
</section>
</body>
</html>`
}

/**
 * เปิดหน้าต่างพิมพ์ใบแผน (เรียกจากการกดปุ่มโดยตรง — เปิดก่อนทำอย่างอื่นเพื่อกัน pop-up blocker)
 * ถูกบล็อก → คืน false ผู้เรียกแสดงข้อความ · addMobileCloseButton: มือถือเปิดแท็บใหม่แล้วไม่มีปุ่มปิด · รอฟอนต์ก่อนสั่งพิมพ์
 */
export function openOpPlanPrintWindow(html) {
  const win = window.open('', '_blank', 'width=1120,height=760')
  if (!win) return false
  win.document.open()
  win.document.write(addMobileCloseButton(html))
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) await Promise.race([win.document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))])
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    if (win.closed) return
    win.focus()
    win.print()
  }, 200)
  return true
}
