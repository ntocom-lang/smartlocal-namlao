// ใบ "สรุปค่าที่วัดได้ช่วงเหตุการณ์น้ำ-ฝน" (เฟส 3 · PR 3.3) — A4 แนวตั้ง พิมพ์จากหน้า "เหตุการณ์น้ำ-ฝน" ของเจ้าหน้าที่
//
// ใบนี้เป็น "สรุปข้อมูลที่ระบบจดไว้" ไม่ใช่เอกสารทางราชการใดๆ — ไม่ใช่ประกาศ ไม่ใช่รายงานสถานการณ์สาธารณภัย
// ไม่ประเมินความเสียหาย ไม่ตัดสินสิทธิ์ของใคร (คำกำกับท้ายใบบอกไว้ ห้ามตัดออก) ⚠️ ถ้า อบต. จะใช้ใบนี้แนบรายงานทางการ
// แบบเอกสาร/ผู้ลงนามต้องเป็นไปตามระเบียบฉบับปัจจุบัน — ต้องยืนยันกับฉบับปัจจุบัน ไม่ได้อ้างมาตราใดไว้ที่นี่
//
// ข้อมูลทุกอย่างมาจากหน้ารายละเอียดที่โหลดอยู่แล้ว (get_water_event) ไม่เพิ่มช่องกรอกให้เจ้าหน้าที่:
//   ผู้จัดทำ = บัญชีที่ล็อกอินอยู่ · ผู้รับทราบ = ปลัดจากทะเบียนผู้ลงนามกลางเดิม (ไม่ได้ตั้ง = เส้นประให้เขียนมือ)
//   ช่องลงนามเป็นปากกาล้วน ไม่มีลายมือชื่ออิเล็กทรอนิกส์ — และไม่ใช้คำว่า "รับรอง" เพราะระบบไม่ควรทำให้ดูเหมือน
//   มีผู้มีอำนาจรับรองความเสียหาย (ผู้รับทราบ = รับทราบว่ามีข้อมูลชุดนี้เท่านั้น)
//
// ไม่มีข้อมูลส่วนบุคคลของประชาชนในใบ (ชื่อสถานี/ค่าวัด/ข้อความ สสน. ล้วน) แต่ชื่อสถานีกับข้อความ สสน. มาจากภายนอก
// ทุกค่าจึงต้องผ่าน esc() ก่อนลง HTML (ใบพิมพ์เขียนผ่าน document.write)
//
// หลายหน้าได้: 11–12 สถานีหรือข้อความเตือนยาวไหลไปหน้า 2 ได้ ใช้ขอบกระดาษจริงของ @page (govPageCss แบบไม่ซ่อนหัวท้าย
// เหมือน complaintListPrint) ไม่ใช่ padding ของ .sheet — padding มีผลแค่หัวหน้าแรก/ท้ายหน้าสุดท้าย หน้ากลางจะไม่มีขอบ

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss,
} from './govDocStyle.js'
import { govNameBlank, govSignBlockCss, govSignRow, govSplitActingTitle } from './govSignBlock.js'
import { pickSignatory, signatoryName, signatoryTitle } from './documentSignatories.js'
import { orgClerkTitle } from './orgTerms.js'
import { LEVEL_WATCH_M, RAIN_VERY_HEAVY_MM } from './waterSituation.js'
import {
  WATER_EVENTS_DISCLAIMER,
  chartGapMs, closeReasonText, eventSpan, openReasonLines, sparkline, stationSummaries,
  thaiDateTime, warningRows,
} from './waterEvents.js'

// ตารางรายสถานีคุมขนาดตัวอักษรเองที่ 12pt — ⚠️ ข้อยกเว้น "ขนาดตัวอักษร" ตามมาตรฐานเอกสารราชการของระบบ (ฟอนต์/ระยะบรรทัด/
// font-size-adjust ยังมาจาก govDocStyle.js ตามเดิม): เหตุการณ์จริงมีได้ 11–12 สถานี (น้ำเลา 11 · demo 12) ที่ 14pt ทั้งตาราง
// กินไป 3 หน้า ทั้งที่ผู้อ่านต้องการเห็นภาพรวมในแผ่นเดียว · เนื้อความ หัวข้อ และช่องลงนามยังเป็น 14pt
const TABLE_FONT_PT = '12pt'

// เกณฑ์ย่อสำหรับท้ายใบ — ตัวเลขดึงจากค่าจริงชุดเดียวกับที่ SQL/หน้าจอใช้ (waterSituation.js) ไม่เขียนซ้ำ
// ⚠️ ข้อความเต็มของแต่ละข้ออยู่ที่ WATER_EVENT_CRITERIA (หน้าจอ) — ถ้าเพิ่ม/ลบข้อ ต้องแก้ 2 ที่ เทสต์ตรวจจำนวนข้อให้เท่ากัน
const CRITERIA_SHORT = [
  `ฝนสะสม 24 ชม. ตั้งแต่ ${RAIN_VERY_HEAVY_MM} มม.`,
  `ระดับน้ำต่ำกว่าตลิ่งไม่เกิน ${LEVEL_WATCH_M} ม.`,
  'สถานีเตือนภัยระดับ 2–3',
  'ข้อความเตือน สสน. ที่ระบุอำเภอและจังหวัดเดียวกัน',
]
const CRITERIA_NOTES_SHORT = 'อ่างเก็บน้ำไม่ใช้เปิดเหตุการณ์ · ระบบปิดเองเมื่อค่าไม่เข้าเกณฑ์ต่อเนื่อง 24 ชม. ไม่มีใครต้องกดปิดหรือกรอกอะไร'
export const WATER_EVENT_PRINT_CRITERIA_COUNT = CRITERIA_SHORT.length

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

/**
 * ผู้รับทราบบนใบ: ปลัดจากทะเบียนผู้ลงนามกลาง (บทบาท clerk ระดับหน่วยงาน) — ไม่ได้ตั้ง/ไม่มีชื่อ = null (ใบพิมพ์เส้นประ)
 * rows = ทะเบียน document_signatories ที่มี profile ติดมา (loadSignatoryRegistry)
 */
export function pickAcknowledger(rows) {
  const row = pickSignatory(rows, { role: 'clerk' })
  if (!row) return null
  const name = signatoryName(row)
  return name ? { name, title: signatoryTitle(row) } : null
}

function pageCss() {
  return `
  ${govPageCss()}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #fff; color: #000; ${govDocFontCss()} }
  /* จอ: กรอบกว้าง 160mm เท่าพื้นที่พิมพ์ · พิมพ์: ใช้ขอบกระดาษจริงจาก @page */
  .sheet { max-width: 160mm; margin: 8mm auto; }
  @media print { .sheet { max-width: none; margin: 0; } }
  p { margin: 0; }
  .doc-title { text-align: center; font-weight: 700; font-size: 1.1em; }
  .doc-sub { text-align: center; }
  .open-note { margin: 1.5mm 0; padding: 0.8mm 2mm; border: 1px solid #000; font-weight: 700; text-align: center; }
  .sec { font-weight: 700; margin: 2mm 0 0.6mm; break-after: avoid; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; }
  table.kv td { vertical-align: top; padding: 0.2mm 0; }
  table.kv td:first-child { width: 33mm; white-space: nowrap; }
  table.stations { table-layout: fixed; font-size: ${TABLE_FONT_PT}; }
  table.stations th, table.stations td { border: 1px solid #000; padding: 0.6mm 1.2mm; vertical-align: top; }
  table.stations th { font-weight: 700; text-align: center; }
  table.stations td.num { text-align: center; }
  table.stations td.trend { text-align: center; padding: 0.6mm 0.8mm; }
  table.stations td.trend svg { display: block; margin: 0 auto; }
  /* หัวตารางซ้ำทุกหน้า แถวห้ามขาดกลาง */
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .sm { font-size: 0.86em; }
  .sec-sub { font-weight: 400; font-size: 0.86em; }
  .station-name { font-weight: 700; }
  .station-peak { font-weight: 700; }
  .station-kind { font-size: 0.86em; }
  .no-value { margin-top: 1mm; font-size: ${TABLE_FONT_PT}; }
  .warn { margin: 0 0 1mm; padding: 0.4mm 2mm; border: 1px solid #000; break-inside: avoid; page-break-inside: avoid; }
  .warn-head { font-size: 0.86em; }
  .warn-msg { white-space: pre-wrap; overflow-wrap: anywhere; }
  .notes { margin-top: 2mm; }
  .notes ul { margin: 0; padding-left: 5mm; }
  .notes li { margin: 0; }
  .notes p { margin: 0.8mm 0 0; }
  .report-sign { margin-top: 4mm; display: flex; gap: 4mm; break-inside: avoid; page-break-inside: avoid; }
  .report-sign > div { flex: 1 1 0; min-width: 0; }
  .origin { ${GOV_ESERVICE_ORIGIN_CSS} text-align: center; margin-top: 2mm; }
${govSignBlockCss()}`
}

// กราฟเส้นเล็กขาวดำต่อสถานี — ตัดเส้นตรงช่วงที่สถานีไม่ส่งค่า (ไม่ลากข้าม) ตัวเลขทุกตัวมาจาก sparkline() ไม่มีข้อความจากภายนอก
function trendSvg(summary) {
  if (!summary.chart) return ''
  const spark = sparkline(summary.chart, {
    width: 100, height: 28, pad: 2, gapMs: chartGapMs(summary.type), baseline: summary.baseline ?? null,
  })
  if (!spark) return ''
  const paths = spark.paths.map(d => `<path d="${d}" fill="none" stroke="#000" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')
  const dots = spark.dots.map(p => `<circle cx="${p.x}" cy="${p.y}" r="1.4" fill="#000"/>`).join('')
  return `<svg viewBox="0 0 100 28" width="22mm" height="6.2mm" role="img" aria-label="${esc(summary.chartLabel)}">`
    + `<rect x="0.5" y="0.5" width="99" height="27" fill="none" stroke="#999" stroke-width="0.6"/>${paths}${dots}</svg>`

}

// แถวละ ~2 บรรทัด (ค่าสูงสุด + เวลา) — เหตุการณ์จริงมีได้ 11–12 สถานี ใบสรุปต้องอยู่ในแผ่นเดียวให้มากที่สุด
// รายละเอียดเต็ม (ฝนรายชั่วโมง ปริมาตรอ่าง ช่วงที่สถานีไม่ส่งค่าทุกช่วง) ดูได้ในหน้า "เหตุการณ์น้ำ-ฝน" ของระบบ
function stationRow(summary, index) {
  const { brief } = summary
  const extras = [
    ...brief.flags,
    ...(summary.gaps.length ? [`ไม่ส่งค่า ${summary.gaps.length} ช่วง (ไม่ใช่ 0)`] : []),
  ]
  return `<tr>
      <td class="num">${index + 1}</td>
      <td><span class="station-name">${esc(summary.name)}</span><br><span class="station-kind">${esc(summary.typeLabel)} · ${esc(brief.metric)}</span></td>
      <td><span class="station-peak">${esc(brief.peakText)}</span><br><span class="sm">${esc([brief.peakAt, ...extras].join(' · '))}</span></td>
      <td>${brief.lastText ? esc(brief.lastText) : '–'}</td>
      <td class="trend">${trendSvg(summary)}</td>
    </tr>`
}

function stationsSection(summaries) {
  const withValue = summaries.filter(s => s.hasValue)
  const without = summaries.filter(s => !s.hasValue)
  const table = withValue.length
    ? `<table class="stations">
    <colgroup><col style="width:11mm"><col style="width:36mm"><col><col style="width:34mm"><col style="width:25mm"></colgroup>
    <thead><tr><th>ลำดับ</th><th>สถานี</th><th>ค่าสูงสุด / ใกล้ตลิ่งที่สุดที่วัดได้</th><th>ค่าล่าสุดที่จด</th><th>แนวโน้ม</th></tr></thead>
    <tbody>
${withValue.map(stationRow).join('\n')}
    </tbody>
  </table>`
    : '<p>ไม่มีสถานีใดมีค่าที่วัดได้ในช่วงที่ระบบจดเหตุการณ์นี้</p>'
  const missing = without.length
    ? `<p class="no-value">สถานีที่ไม่มีค่าที่วัดได้ในช่วงนี้ ${without.length} แห่ง (แสดงว่า "ไม่มีค่า" ไม่ใช่ 0): ${esc(without.map(s => s.name).join(', '))}</p>`
    : ''
  return `${table}\n  ${missing}`
}

function warningsSection(detail) {
  const rows = warningRows(detail.warnings)
  if (!rows.length) return '<p>ไม่มีข้อความเตือนของ สสน. ในช่วงเหตุการณ์นี้</p>'
  return rows.map(w => `<div class="warn">
    <div class="warn-head">${esc(w.issuedText)}${w.source ? ` · ${esc(w.source)}` : ''}</div>
    <div class="warn-msg">${esc(w.message)}</div>
  </div>`).join('\n')
}

function signBlock(preparer, acknowledger, tenant) {
  // ตำแหน่ง "รักษาราชการแทน" ยาวกว่าคอลัมน์ — ตัดเป็น 2 บรรทัดตามกติกากลาง (govSplitActingTitle) ไม่ให้ล้นขอบขวากระดาษ
  const titleLines = (title) => govSplitActingTitle(title).map((line, i) => (i === 0 ? `ตำแหน่ง ${esc(line)}` : esc(line)))
  const below = (person, fallbackTitle) => [
    person?.name ? `(${esc(person.name)})` : govNameBlank(),
    ...(person?.title || fallbackTitle ? titleLines(person?.title || fallbackTitle) : ['ตำแหน่ง ....................']),
    'วันที่ ....................',
  ]
  // บล็อกเดียว 2 คอลัมน์ — เส้นยาวเท่ากันด้วย GOV_SIGN_LINE_W (ไม่ส่ง width เอง) ตามมาตรฐาน govSignBlock.js
  return `<div class="report-sign sign-block">
    <div class="center-row">${govSignRow({ role: 'ผู้จัดทำ', below: below(preparer, '') })}</div>
    <div class="center-row">${govSignRow({ role: 'ผู้รับทราบ', below: below(acknowledger, orgClerkTitle(tenant)) })}</div>
  </div>`
}

/**
 * @param {object} args
 * @param {{ name?: string }} args.tenant
 * @param {object} args.detail  ผลของ get_water_event() ({ now, event, stations, warnings })
 * @param {{ name?: string, title?: string } | null} [args.preparer]     บัญชีที่ล็อกอินอยู่ (ผู้จัดทำ)
 * @param {{ name: string, title?: string } | null} [args.acknowledger]  จาก pickAcknowledger()
 * @param {Date} [args.printedAt]
 */
export function buildWaterEventHtml({ tenant, detail, preparer = null, acknowledger = null, printedAt = new Date() }) {
  const event = detail?.event ?? {}
  const now = printedAt.getTime()
  const span = eventSpan(event, now)
  const summaries = stationSummaries(detail?.stations, { now, open: span.open })
  const reason = openReasonLines(event.open_reason, 10)
  const totalReadings = summaries.reduce((sum, item) => sum + item.readingsCount, 0)
  const ruleVersion = Number(event.open_reason?.rule_version)
  const origin = `ข้อมูล ณ ${thaiDateTime(printedAt.toISOString())} · ${govEServiceOriginText(tenant)}`

  const kv = [
    ['ช่วงเวลา', span.open
      ? `${span.startText} เป็นต้นมา (นาน ${span.duration || '–'}) · ยังไม่สิ้นสุด ณ เวลาที่พิมพ์${event.last_fresh_at ? ` · ค่าสดล่าสุดที่ระบบเห็น ${thaiDateTime(event.last_fresh_at)}` : ''}`
      : `${span.startText} – ${span.endText} (นาน ${span.duration || '–'})`],
    ...(span.open ? [] : [['การปิดเหตุการณ์', closeReasonText(event.close_reason)]]),
  ]
  const reasonCell = reason.lines.length
    ? `${reason.lines.map(line => `• ${esc(line)}`).join('<br>')}${reason.more ? `<br>• และอีก ${reason.more} สัญญาณ` : ''}`
    : 'ไม่มีบันทึกสัญญาณที่เปิดเหตุการณ์'

  return `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<title>${esc(`สรุปค่าที่วัดได้ช่วงเหตุการณ์น้ำ-ฝน ${span.startText}`)}</title>
${GOV_FONT_LINK}
<style>${pageCss()}
</style>
</head><body>
<div class="sheet">
  <p class="doc-title">สรุปค่าที่วัดได้ช่วงเหตุการณ์น้ำ-ฝน</p>
  <p class="doc-sub">${esc(tenant?.name ?? '')}</p>
  ${span.open ? '<p class="open-note" data-open-note>เหตุการณ์ยังไม่สิ้นสุด ณ เวลาที่พิมพ์ — ค่าที่วัดได้อาจเปลี่ยนหลังจากนี้</p>' : ''}

  <p class="sec">1. ช่วงเวลาและเหตุที่ระบบเปิดเหตุการณ์</p>
  <table class="kv">
${kv.map(([label, value]) => `    <tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('\n')}
    <tr><td>เหตุที่ระบบเปิด</td><td>${reasonCell}</td></tr>
  </table>

  <p class="sec">2. ค่าที่วัดได้รายสถานี <span class="sec-sub">(ระบบจดไว้ ${esc(totalReadings.toLocaleString('th-TH'))} ค่า จาก ${summaries.length} สถานี)</span></p>
  ${stationsSection(summaries)}

  <p class="sec">3. ข้อความเตือนของ สสน. ที่ระบุอำเภอและจังหวัดเดียวกับหน่วยงาน (ตามต้นฉบับ ไม่ได้ตัดแต่ง)</p>
  ${warningsSection(detail ?? {})}

  <div class="notes">
    <p><b>เกณฑ์ที่ระบบใช้เปิดเหตุการณ์</b>${Number.isFinite(ruleVersion) ? ` (ชุดที่ ${ruleVersion})` : ''} เมื่อสถานีใดสถานีหนึ่งเข้าข้อใดข้อหนึ่ง: ${esc(CRITERIA_SHORT.join(' · '))} · ${esc(CRITERIA_NOTES_SHORT)}</p>
    <p><b>ที่มาของค่า</b> สถานีวัดน้ำ-ฝนของคลังข้อมูลน้ำแห่งชาติ (ThaiWater · สสน.) ตามที่ตั้งค่าไว้ในระบบ ระบบดึงและจดทุกชั่วโมงเอง ไม่ได้ตรวจสอบกับหน้างาน</p>
    <p><b>หมายเหตุ</b> ${esc(WATER_EVENTS_DISCLAIMER)}</p>
  </div>
  ${signBlock(preparer, acknowledger, tenant)}
  <div class="origin">${esc(origin)}</div>
</div>
</body></html>`
}
