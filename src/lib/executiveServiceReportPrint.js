// ใบ "สรุปผลการให้บริการประชาชน" รายเดือน/รายไตรมาส — A4 แนวตั้ง · ห้องผู้บริหาร เฟส E3-1
// รายงานประกอบการประชุมผู้บริหาร: ตัวเลขล้วนจาก executive_overview (ไม่มีชื่อผู้ร้อง/ผู้ประเมิน/ความเห็น/รายละเอียดรายเรื่อง — PDPA)
//
// ไฟล์นี้เป็นฟังก์ชันล้วน: ไม่อ่านนาฬิกา (today ส่งเข้ามา) ไม่ import supabase/React — เทสต์รันด้วย node ตรงๆ
// ตัวเลขทุกตัวมาจาก model (buildExecModel) + deriveExec ของ executiveData.js ตัวเดียวกับหน้าห้องผู้บริหาร
// สูตรคัดตรงจากทะเบียน executiveRegistry.js (execFormulas) ไม่เขียนถ้อยคำเอง — พิมพ์เป็น "ภาคผนวก" แผ่นใหม่หลังช่องลงนาม
//
// ⚠️ กติกาของใบนี้ (เจ้าของระบบอนุมัติ)
//   - % ทันกำหนด แยกสองแถว "คำร้อง (วันทำการ)" กับ "คำขอ (วันปฏิทิน)" ห้ามรวมเป็นค่าเดียว (กำหนดนับต่างหน่วยวัน)
//   - คะแนนแยกที่มาตามรายงาน #681 · เสียงผู้รับบริการตัวจริงเป็นตัวหลัก · ไม่รวมค่าที่ยืนยันตัวผู้ให้คะแนนไม่ได้เป็นค่าเฉลี่ยเดียว
//   - ส่วนที่ข้อมูลโหลดไม่ได้ = "ไม่มีข้อมูล" ห้ามเป็น 0 (ช่องที่คำนวณไม่ได้ = "—")
//   - ยอดค้างอยู่ (ส่วนที่ 5) คือ ณ วันที่พิมพ์ ไม่ใช่ ณ สิ้นช่วง
//   - ห้ามอ้างเลขข้อ/ชื่อตัวชี้วัดของเกณฑ์ประเมินภายนอก ยังไม่ได้เทียบกับคู่มือฉบับจริง — เขียนแค่ "รายงานประกอบการประชุมผู้บริหาร"
//   - ช่องลงนามใช้ govSignBlock.js (ผู้จัดทำเว้นว่าง ระบบไม่รู้ตัวผู้จัดทำจริง · ปลัด เสนอ · นายก ทราบ)
// ค่าจากข้อมูล (ชื่อ อปท./กอง/ผู้ลงนาม) ผ่าน esc() ทุกจุด (document.write)

import {
  GOV_ESERVICE_ORIGIN_CSS, GOV_FONT_LINK, govDocFontCss, govEServiceOriginText, govPageCss, govPagePadding,
} from './govDocStyle.js'
import { GOV_SIGN_LINE_W, govNameBlank, govSignBlockCss, govSignRow, govSplitActingTitle } from './govSignBlock.js'
import { orgClerkTitle, orgHeadTitle } from './orgTerms.js'
import { thaiShortDate } from './complaintReportPeriods.js'
import { deriveExec, execFormulas, execNf, execPercent } from './executiveData.js'
import { EXECUTIVE_REGISTRY, isPhaseLive } from './executiveRegistry.js'
import { addMobileCloseButton } from './printWindowClose.js'

// ขอบกระดาษแนวตั้ง "บน ขวา ล่าง ซ้าย" แยกเป็นรายด้านไว้ใช้กับแถวเว้นระยะ (ขอบมาจาก padding ไม่ใช่ @page — ดู govPagePadding)
const [PAD_TOP, PAD_RIGHT, PAD_BOTTOM, PAD_LEFT] = govPagePadding({ size: 'A4 portrait' }).split(/\s+/)

const NO_DATA = 'ไม่มีข้อมูล'
const DASH = '—'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

const ok = (model, field) => model?.[field]?.state === 'ok'
const dataOf = (model, field) => (ok(model, field) ? model[field].data : null)

/** ร้อยละ: null = ขีด (ตัวหาร 0) */
const pctText = (p) => (p == null ? DASH : `${Number(p).toLocaleString('th-TH')}%`)
/** คะแนนเฉลี่ย 1 ตำแหน่ง: null = ขีด (ไม่มีคะแนน ห้ามเป็น 0) */
const avgText = (a) => (a == null ? DASH : Number(a).toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))

// ───────────────────────── สูตรท้ายใบ ─────────────────────────

/**
 * [คีย์รายการในทะเบียน, id ของ kpi] ของตัวเลขทุกตัวที่ใบนี้พิมพ์ — เรียงตามส่วนของใบ
 * สูตรคัดจากทะเบียนตรงๆ (execFormulas) · เทสต์ตรวจว่าทุกคู่หาเจอในทะเบียน (ไม่งั้นสูตรของตัวเลขที่พิมพ์หายเงียบ)
 */
export const EXEC_REPORT_FORMULA_SPEC = Object.freeze([
  ['complaints', 'new'], ['inbox', 'new'],
  ['complaints', 'on_time_pct'], ['inbox', 'on_time_pct'],
  ['complaints', 'channel'], ['inbox', 'entered'],
  ['complaints', 'satisfaction'], ['complaints', 'response_rate'],
  ['src:satisfaction', 'by_source'], ['src:satisfaction', 'general'],
  ['performance', 'dept_open'], ['performance', 'dept_overdue'], ['performance', 'dept_done'], ['performance', 'dept_rating'],
  ['complaints', 'overdue'], ['complaints', 'unassigned'], ['inbox', 'overdue'],
])

/** กฎ "เลยกำหนดเกิน 5 วันทำการ" (alert ในทะเบียน ไม่ใช่ kpi — execFormulas ไม่ครอบ) ที่ใบนี้พิมพ์ตัวเลขของมันในส่วนที่ 5 */
export const EXEC_REPORT_ALERT_SPEC = Object.freeze([['complaints', 'overdue_5wd'], ['inbox', 'overdue_5wd']])

export function execReportFormulaItems(registry = EXECUTIVE_REGISTRY) {
  const items = []
  for (const [entryKey, kpiId] of EXEC_REPORT_FORMULA_SPEC) {
    const entry = registry.find((e) => e.key === entryKey)
    const kpi = entry?.kpis.find((k) => k.id === kpiId)
    const [found] = entry ? execFormulas([entry], kpiId) : []
    if (kpi && found) items.push({ label: `${entry.label} · ${kpi.label}`, formula: found.formula, source: found.source ?? '' })
  }
  for (const [entryKey, alertId] of EXEC_REPORT_ALERT_SPEC) {
    const entry = registry.find((e) => e.key === entryKey)
    const alert = entry?.alerts.find((a) => a.id === alertId && isPhaseLive(a.phase))
    if (alert) items.push({ label: `${entry.label} · ${alert.label}`, formula: alert.rule, source: '' })
  }
  return items
}

// ───────────────────────── ส่วนของใบ ─────────────────────────

const noDataRow = (cols) => `<tr><td colspan="${cols}" class="nodata">${NO_DATA}</td></tr>`
const noDataText = `<span class="nodata">${NO_DATA}</span>`

/** ส่วนที่ 1 — ภาพรวม · % ทันกำหนดแยกสองแถว ห้ามรวม */
function overviewSection({ model, derived }) {
  const c = dataOf(model, 'complaints')
  const d = dataOf(model, 'docRequests')
  const complaintTotal = c ? c.period.total : null
  const docTotal = d ? d.byType.reduce((sum, r) => sum + r.total, 0) : null
  const onTimeCell = (o) => {
    if (!o) return [noDataText, '']
    return [esc(o.pct == null ? 'ไม่มีเรื่องให้คำนวณ' : pctText(o.pct)),
      esc(`ทันกำหนด ${execNf(o.onTime)} · เกินกำหนด ${execNf(o.late)} · ค้างที่เลยกำหนด ณ สิ้นช่วง ${execNf(o.openPastDue)}`)]
  }
  const [cPct, cDetail] = onTimeCell(derived.complaintOnTime)
  const [dPct, dDetail] = onTimeCell(derived.docOnTime)
  return `<p class="sec">ส่วนที่ 1 ภาพรวมการให้บริการในช่วง</p>
  <table class="t">
    <colgroup><col style="width:78mm"><col style="width:24mm"><col></colgroup>
    <thead><tr><th>รายการ</th><th>ผล</th><th>รายละเอียด</th></tr></thead>
    <tbody>
      <tr><td>เรื่องร้องเรียนรับใหม่ในช่วง</td><td class="num">${complaintTotal == null ? noDataText : `${esc(execNf(complaintTotal))} เรื่อง`}</td><td></td></tr>
      <tr><td>คำขอบริการ (E-Service) ยื่นในช่วง</td><td class="num">${docTotal == null ? noDataText : `${esc(execNf(docTotal))} เรื่อง`}</td><td></td></tr>
      <tr><td>ร้อยละเสร็จทันกำหนด · คำร้อง (วันทำการ)</td><td class="num">${cPct}</td><td class="small">${cDetail}</td></tr>
      <tr><td>ร้อยละเสร็จทันกำหนด · คำขอ (วันปฏิทิน)</td><td class="num">${dPct}</td><td class="small">${dDetail}</td></tr>
    </tbody>
  </table>
  <p class="small note">ร้อยละทันกำหนดแยกสองแถวโดยตั้งใจ ไม่รวมเป็นค่าเดียว เพราะกำหนดของคำร้องนับเป็นวันทำการ ส่วนกำหนดของคำขอนับเป็นวันปฏิทิน</p>`
}

const ENTERED_LABELS = Object.freeze([
  ['citizen', 'ประชาชนยื่นเอง'], ['council', 'สท. ยื่นให้'], ['staff', 'เจ้าหน้าที่กรอกแทน (เคาน์เตอร์)'], ['unknown', 'ไม่ทราบผู้กรอก'],
])

/** ส่วนที่ 2 — ช่องทาง: คำร้องออนไลน์เทียบเคาน์เตอร์ + คำขอแยกผู้กรอก */
function channelSection({ model }) {
  const c = dataOf(model, 'complaints')
  const d = dataOf(model, 'docRequests')
  const row = (label, n, total) => `<tr><td>${esc(label)}</td><td class="num">${esc(execNf(n))}</td><td class="num">${esc(pctText(execPercent(n, total)))}</td></tr>`
  let body = ''
  if (!c) {
    body += `<tr class="grp"><td colspan="3">คำร้อง/ร้องทุกข์</td></tr>${noDataRow(3)}`
  } else {
    const p = c.period
    const other = Math.max(0, p.total - p.citizen_online - p.oss_counter)
    body += `<tr class="grp"><td colspan="3">คำร้อง/ร้องทุกข์ที่แจ้งในช่วง ${esc(execNf(p.total))} เรื่อง</td></tr>`
    body += row('ออนไลน์ (ประชาชนแจ้งเอง)', p.citizen_online, p.total)
    body += row('รับที่เคาน์เตอร์', p.oss_counter, p.total)
    if (other > 0) body += row('ช่องทางอื่น/ไม่ระบุ', other, p.total)
  }
  if (!d) {
    body += `<tr class="grp"><td colspan="3">คำขอบริการ (E-Service) แยกผู้กรอก</td></tr>${noDataRow(3)}`
  } else {
    const total = ENTERED_LABELS.reduce((sum, [k]) => sum + d.entered[k], 0)
    body += `<tr class="grp"><td colspan="3">คำขอบริการ (E-Service) ที่ยื่นในช่วง แยกผู้กรอก รวม ${esc(execNf(total))} เรื่อง</td></tr>`
    for (const [key, label] of ENTERED_LABELS) body += row(label, d.entered[key], total)
  }
  return `<p class="sec">ส่วนที่ 2 ช่องทางการรับเรื่อง</p>
  <table class="t">
    <colgroup><col><col style="width:30mm"><col style="width:25mm"></colgroup>
    <thead><tr><th>ช่องทาง</th><th>จำนวน (เรื่อง)</th><th>ร้อยละ</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`
}

/** ส่วนที่ 3 — ความพึงพอใจ: แยกที่มา + เสียงผู้รับบริการตัวจริง + แบบประเมินภาพรวม (ไม่รวมเป็นค่าเดียว) */
function satisfactionSection({ derived }) {
  const s = derived.satisfaction
  if (!s) return `<p class="sec">ส่วนที่ 3 ความพึงพอใจของผู้รับบริการ</p><p class="nodata">${NO_DATA}</p>`
  const row = (label, n, avg, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${esc(execNf(n))}</td><td class="num">${esc(avgText(avg))}</td></tr>`
  return `<p class="sec">ส่วนที่ 3 ความพึงพอใจของผู้รับบริการ</p>
  <p>คำร้องที่ปิดในช่วง ${esc(execNf(s.closed))} เรื่อง · มีคะแนนอย่างน้อย 1 รายการ ${esc(execNf(s.anyRated))} เรื่อง (อัตราตอบ ${esc(pctText(s.responseRate))})</p>
  <table class="t">
    <colgroup><col><col style="width:32mm"><col style="width:32mm"></colgroup>
    <thead><tr><th>ที่มาของคะแนน (คำร้องที่ปิดในช่วง)</th><th>จำนวนเรื่อง</th><th>คะแนนเฉลี่ย (1–5)</th></tr></thead>
    <tbody>
${s.sources.map((src) => row(src.label, src.complaints, src.avg)).join('\n')}
${row('เสียงผู้รับบริการตัวจริง', s.genuineComplaints, s.genuineAvg, 'strong')}
${row('แบบประเมินภาพรวมหน่วยงาน (ไม่ผูกคำร้อง) — จำนวนครั้ง', s.general.n, s.general.avg)}
    </tbody>
  </table>
  <p class="small note">แยกที่มาของคะแนนไว้ ไม่รวมเป็นค่าเฉลี่ยเดียว — คะแนนจากผู้ที่ไม่ล็อกอินหรือที่ สท. บันทึกแทนยืนยันตัวผู้ให้คะแนนไม่ได้ ตัวเลขที่ใช้เป็นหลักคือ "เสียงผู้รับบริการตัวจริง"</p>`
}

/** ส่วนที่ 4 — รายกอง: 1 แถวต่อกอง ไม่จัดอันดับ ไม่มีชื่อบุคคล (คงลำดับตามที่ระบบคืน) */
function departmentSection({ derived }) {
  const rows = derived.deptRows
  const head = '<p class="sec">ส่วนที่ 4 ภาพรวมรายกอง</p>'
  if (!rows) return `${head}<p class="nodata">${NO_DATA}</p>`
  if (rows.length === 0) return `${head}<p class="nodata">ไม่มีข้อมูลรายกองในช่วงนี้</p>`
  const rating = (r) => (r.rating && r.rating.cnt > 0 ? `${avgText(r.rating.avg)} (${execNf(r.rating.cnt)} คะแนน)` : DASH)
  return `${head}
  <table class="t">
    <colgroup><col><col style="width:20mm"><col style="width:25mm"><col style="width:26mm"><col style="width:31mm"></colgroup>
    <thead><tr><th>กอง</th><th>ค้างอยู่</th><th>เลยกำหนด</th><th>เสร็จในช่วง</th><th>คะแนนเฉลี่ย</th></tr></thead>
    <tbody>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${esc(execNf(r.openTotal))}</td><td class="num">${esc(execNf(r.overdueTotal))}</td><td class="num">${esc(execNf(r.doneTotal))}</td><td class="num">${esc(rating(r))}</td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="small note">หน่วยเป็นเรื่อง (คำร้อง + คำขอรวมกัน) · ค้างอยู่และเลยกำหนดเป็นยอด ณ วันที่พิมพ์ · เสร็จในช่วง = เรื่องที่เสร็จภายในช่วงที่เลือก · คะแนนเฉลี่ยคือเสียงผู้รับบริการตัวจริงของคำร้องที่ปิดในช่วง ("—" = ยังไม่มีคะแนน) · ไม่จัดอันดับ</p>`
}

/**
 * ส่วนที่ 5 — ยอดค้างอยู่ ณ วันที่พิมพ์ (ไม่ขึ้นกับช่วงที่เลือก)
 * พิมพ์เฉพาะ 4 แถวที่ผู้บริหารใช้ตัดสินใจ — ค้างแยกตามขั้น/อายุเฉลี่ย (คอขวด) ดูได้บนหน้าห้องผู้บริหาร ไม่พิมพ์ในใบ:
 * เป็นภาพ ณ วันพิมพ์ ไม่ใช่ผลของช่วง และกินที่จนช่องลงนามตกไปอยู่แผ่นที่ 3 แผ่นเดียวโดดๆ (วัดจริง 2569-11-11)
 */
function backlogSection({ derived, today, period }) {
  const cb = derived.complaintBacklog
  const db = derived.docBacklog
  const cell = (value, fn) => (value ? esc(fn(value)) : noDataText)
  const rowOf = (label, c, d) => `<tr><td>${esc(label)}</td><td class="num">${c}</td><td class="num">${d}</td></tr>`
  return `<p class="sec">ส่วนที่ 5 ยอดค้างอยู่ ณ วันที่พิมพ์</p>
  <p class="small">ยอดนี้นับ ณ วันที่พิมพ์ ${esc(thaiShortDate(today))} ไม่ใช่ ณ สิ้นช่วง ${esc(period.rangeText)} และไม่เปลี่ยนตามช่วงที่เลือก</p>
  <table class="t">
    <colgroup><col style="width:70mm"><col><col></colgroup>
    <thead><tr><th>รายการ (เรื่อง)</th><th>คำร้อง (วันทำการ)</th><th>คำขอ (วันปฏิทิน)</th></tr></thead>
    <tbody>
${rowOf('ค้างอยู่ทั้งหมด', cell(cb, (x) => execNf(x.total)), cell(db, (x) => execNf(x.total)))}
${rowOf('เลยกำหนด', cell(cb, (x) => execNf(x.overdue)), cell(db, (x) => execNf(x.overdue)))}
${rowOf('เลยกำหนดเกิน 5 วันทำการ', cell(cb, (x) => execNf(x.overdue5wd)), cell(db, (x) => execNf(x.overdue5wd)))}
${rowOf('ยังไม่มีผู้รับผิดชอบ', cell(cb, (x) => execNf(x.unassigned)), 'ไม่ได้นับ')}
    </tbody>
  </table>`
}

// สัญลักษณ์เตือนในทะเบียนเป็นอีโมจิ (หน้าจอแสดงได้) — เครื่องพิมพ์/ฟอนต์ราชการไม่มี glyph นี้ พิมพ์ออกมาเป็นกล่องเปล่า
// ใบพิมพ์จึงแทนด้วยคำ "ข้อควรระวัง:" (แทนเฉพาะสัญลักษณ์ ถ้อยคำของสูตรคงตามทะเบียนทุกตัวอักษร)
const WARNING_SIGN = new RegExp(`${String.fromCodePoint(0x26A0)}${String.fromCodePoint(0xFE0F)}?\\s*`, 'g')
const printableFormula = (text) => String(text ?? '').replace(WARNING_SIGN, 'ข้อควรระวัง: ')

/**
 * ภาคผนวก — สูตรคำนวณของทุกตัวเลข (คัดจากทะเบียน) ขึ้นแผ่นใหม่ "หลัง" ช่องลงนาม
 * ตัวรายงาน (ส่วนที่ 1–5 + หมายเหตุ + ช่องลงนาม) จบในตัวเองก่อน: ผู้ลงนามไม่ต้องลงชื่อท้ายข้อความเชิงเทคนิคยาวหน้าครึ่ง
 * และที่ประชุมเลือกพิมพ์เฉพาะตัวรายงานได้ · ภาคผนวกมีไว้ให้ผู้ตรวจ (สตง./ป.ป.ช.) คำนวณซ้ำ
 */
function formulaAppendix({ heading, orgName, entries }) {
  const items = execReportFormulaItems(entries)
  return `<div class="appendix">
  <p class="title">ภาคผนวก หมายเหตุและสูตรคำนวณของตัวเลขในรายงาน</p>
  <p class="sub small">${esc(heading)}${orgName ? ` · ${esc(orgName)}` : ''}</p>
  <p class="sec">หมายเหตุ</p>
  <ol class="small notes">${NOTES.map((n) => `<li>${esc(n)}</li>`).join('')}</ol>
  <p class="sec">สูตรคำนวณ</p>
  <ol class="small formulas">
${items.map((it) => `    <li><b>${esc(it.label)}</b> — ${esc(printableFormula(it.formula))}${it.source ? ` <span class="src">(ที่มา: ${esc(it.source)})</span>` : ''}</li>`).join('\n')}
  </ol>
  </div>`
}

const NOTES = Object.freeze([
  'ตัวเลขสรุปจากระบบ ไม่มีชื่อผู้ร้อง ผู้ประเมิน ความเห็น หรือรายละเอียดรายเรื่อง',
  'ข้อมูลคำนวณจากระบบ ณ เวลาพิมพ์ ตัวเลขของช่วงที่ผ่านมาอาจขยับได้ เช่น เมื่อมีการให้คะแนนย้อนหลังหลังปิดเรื่อง',
  'ช่อง "—" = ไม่มีค่าให้คำนวณ (เช่น ยังไม่มีเรื่องที่เสร็จหรือยังไม่มีคะแนน) ไม่ใช่ศูนย์ · "ไม่มีข้อมูล" = ส่วนนั้นโหลดจากระบบไม่ได้ในขณะพิมพ์ หรือ อปท. ไม่ได้เปิดใช้โมดูลนั้น',
  'ร้อยละและคะแนนเฉลี่ยปัดทศนิยม 1 ตำแหน่ง',
])

// ───────────────────────── ช่องลงนาม ─────────────────────────

/**
 * ผู้จัดทำ (เว้นว่าง) / ปลัด (เสนอ) / นายก (ทราบ) — ใช้ govSignRow() ของกลาง เส้นกว้าง GOV_SIGN_LINE_W ทุกจุด
 * signatories = { clerk, mayor } แต่ละช่อง { name, title } หรือ null (= วงเล็บเว้นชื่อ + ชื่อตำแหน่งสำรอง · ช่องไม่หาย ใบเวียนเซ็นได้เสมอ)
 */
function signBlock({ signatories, tenant }) {
  const cell = (role, below) => `<div class="exec-sign-cell">${govSignRow({ width: GOV_SIGN_LINE_W, role, below })}</div>`
  const person = (p, fallbackTitle) => [
    p?.name ? `(${esc(p.name)})` : govNameBlank(GOV_SIGN_LINE_W),
    ...govSplitActingTitle(p?.title || fallbackTitle).map(esc),
  ]
  return `<section class="exec-sign">
    <div class="exec-sign-row">
      ${cell('ผู้จัดทำ', [govNameBlank(GOV_SIGN_LINE_W)])}
      ${cell('ผู้เสนอ', person(signatories?.clerk, orgClerkTitle(tenant)))}
    </div>
    <div class="exec-sign-row exec-sign-row--last">
      ${cell('ผู้รับทราบ', person(signatories?.mayor, orgHeadTitle(tenant)))}
    </div>
  </section>`
}

// ───────────────────────── ใบทั้งหน้า ─────────────────────────

/**
 * @param {object} input
 * @param {object} input.model    ผลของ buildExecModel (ต้องมี complaints / docRequests / satisfaction / departments)
 * @param {object[]} [input.entries]  รายการที่ขึ้นจอของ อปท. นี้ (liveEntries — โมดูลเปิดอยู่) · ภาคผนวกพิมพ์สูตรเฉพาะรายการเหล่านี้
 *   ไม่ส่ง = ทั้งทะเบียน (เทสต์) · ส่วนของโมดูลที่ปิดได้ "ไม่มีข้อมูล" เพราะหน้าจอไม่ขอคีย์นั้นตั้งแต่ต้น
 * @param {string} input.today    YYYY-MM-DD วันที่พิมพ์ตามเวลาไทย (ฐานข้อมูลคืนมา) — ใช้คิดยอดค้าง/วันทำการและพิมพ์เป็น "ข้อมูล ณ วันที่"
 * @param {{ kind: string, label: string, from: string, to: string, rangeText?: string }} input.period  ผลของ executiveReportPeriods.js
 * @param {{ name?: string }|null} input.tenant
 * @param {{ clerk?: {name?: string, title?: string}|null, mayor?: {name?: string, title?: string}|null }|null} input.signatories
 * @returns {string} HTML ทั้งหน้า
 */
export function buildExecServiceReportHtml({ model, today, period, tenant = null, signatories = null, entries = EXECUTIVE_REGISTRY } = {}) {
  const orgName = String(tenant?.name ?? '').replace(/\s+/g, ' ').trim()
  const derived = deriveExec({ model, today })
  const rangeText = period.rangeText || `${thaiShortDate(period.from)} – ${thaiShortDate(period.to)}`
  const periodForText = { ...period, rangeText }
  const heading = `สรุปผลการให้บริการประชาชน ประจำ${period.kind === 'month' ? 'เดือน' : ''}${period.label}`
  const origin = `${govEServiceOriginText(tenant)} · ข้อมูล ณ วันที่ ${thaiShortDate(today)}`

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>${esc(heading)} ${esc(orgName)}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss({ size: 'A4 portrait', hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { color: #000; ${govDocFontCss()} background: #fff; }
    /* ขอบกระดาษ: @page เป็น 0 (ซ่อนหัว/ท้ายกระดาษของเบราว์เซอร์) ขอบซ้าย/ขวามาจาก padding ของ .sheet
       ขอบบน/ล่างของ "ทุกหน้า" มาจากแถวเว้นระยะใน thead/tfoot ของตารางห่อนอก (ใบนี้ยาวเกิน 1 หน้าได้ — ขอบบนของหน้า 2 ต้องไม่หาย) */
    .sheet { width: 210mm; padding: 0 ${PAD_RIGHT} 0 ${PAD_LEFT}; }
    table.page { width: 100%; border-collapse: collapse; }
    table.page > thead > tr > td, table.page > tbody > tr > td, table.page > tfoot > tr > td { border: 0; padding: 0; text-align: left; vertical-align: top; }
    td.space-top { height: ${PAD_TOP}; }
    td.space-bottom { height: ${PAD_BOTTOM}; }
    @media print { .sheet { width: auto; } }
    p { margin: 0; }
    .title { text-align: center; font-weight: 700; font-size: 1.15em; }
    .sub { text-align: center; }
    .sec { margin: 3mm 0 1mm; font-weight: 700; break-after: avoid; page-break-after: avoid; }
    /* ทั้งใบเป็น 14pt ตาม govDocFontCss() — ไม่มีข้อยกเว้นขนาดตัวอักษร (AGENTS.md: ข้อยกเว้นมีไว้ให้ใบตารางที่คอลัมน์ไม่พอเท่านั้น)
       .small เป็นแค่ป้ายกลุ่มของข้อความกำกับ (หมายเหตุใต้ตาราง/รายละเอียด/สูตร) ไม่ลดขนาด */
    .note { margin-top: 1mm; }
    table.t { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.t th, table.t td { border: 1px solid #000; padding: 0.3mm 2mm; vertical-align: top; overflow-wrap: anywhere; }
    table.t th { font-weight: 700; text-align: center; }
    table.t td.num { text-align: center; }
    table.t tr { break-inside: avoid; page-break-inside: avoid; }
    table.t tr.grp td { font-weight: 700; background: #eee; }
    table.t tr.strong td { font-weight: 700; }
    .nodata { color: #444; }
    td.nodata { text-align: center; }
    /* ภาคผนวกขึ้นแผ่นใหม่เสมอ — ตัวรายงานจบที่ช่องลงนาม */
    .appendix { break-before: page; page-break-before: always; }
    .appendix .sub { margin-bottom: 2mm; }
    .formulas { margin: 0; padding-left: 6mm; }
    .formulas li { margin: 0 0 0.8mm; break-inside: avoid; page-break-inside: avoid; }
    .formulas .src { color: #444; }
    /* หมายเหตุ + ช่องลงนาม + บรรทัดที่มา อยู่หน้าเดียวกันเสมอ — ช่องลงนามไม่ไปอยู่หน้าเดียวโดดๆ ไม่มีหมายเหตุกำกับ และบรรทัดที่มาไม่ตกหน้าเปล่า */
    .closing { break-inside: avoid; page-break-inside: avoid; }
    .notes { margin: 0; padding-left: 5mm; }
    .notes li { margin: 0; }
    ${govSignBlockCss()}
    /* ระยะเหนือเส้นลงนาม 12mm / 14mm ให้เขียนลายมือชื่อเหนือเส้นได้ · ต้องจบในแผ่นเดียวกัน ไม่ตกหน้าครึ่งๆ กลางๆ */
    .exec-sign { margin-top: 4mm; break-inside: avoid; page-break-inside: avoid; }
    .exec-sign-row { display: flex; justify-content: space-between; margin-top: 12mm; }
    .exec-sign-row--last { justify-content: flex-end; margin-top: 14mm; }
    .exec-sign-cell { width: 54%; }
    .exec-sign-row:not(.exec-sign-row--last) .exec-sign-cell:first-child { width: 46%; }
    .origin { ${GOV_ESERVICE_ORIGIN_CSS} margin-top: 3mm; text-align: center; }
  </style>
</head>
<body>
<section class="sheet">
<table class="page">
  <thead><tr><td class="space-top"></td></tr></thead>
  <tfoot><tr><td class="space-bottom"></td></tr></tfoot>
  <tbody><tr><td>
  <p class="title">${esc(heading)}</p>
  ${orgName ? `<p class="sub">${esc(orgName)}</p>` : ''}
  <p class="sub">ช่วงวันที่ ${esc(rangeText)}</p>
  <p class="sub small">รายงานประกอบการประชุมผู้บริหาร · ข้อมูล ณ วันที่ ${esc(thaiShortDate(today))}</p>
  ${overviewSection({ model, derived })}
  ${channelSection({ model })}
  ${satisfactionSection({ derived })}
  ${departmentSection({ derived })}
  ${backlogSection({ derived, today, period: periodForText })}
  <div class="closing">
    <p class="note">หมายเหตุ: ตัวเลขสรุปจากระบบ ณ เวลาพิมพ์ · ความหมายของ "—" กับ "ไม่มีข้อมูล" และสูตรคำนวณของทุกตัวเลขอยู่ในภาคผนวกท้ายรายงาน</p>
    ${signBlock({ signatories, tenant })}
    <div class="origin">${esc(origin)}</div>
  </div>
  ${formulaAppendix({ heading, orgName, entries })}
  </td></tr></tbody>
</table>
</section>
</body>
</html>`
}

// ───────────────────────── หน้าต่างพิมพ์ ─────────────────────────

const PREPARING_HTML = '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>กำลังเตรียมใบพิมพ์</title></head>'
  + '<body><p role="status" style="padding:72px 24px;font:16px/1.5 sans-serif">กำลังเตรียมใบพิมพ์…</p></body></html>'

/**
 * เปิดหน้าต่างใบพิมพ์ "ในจังหวะคลิก" (ก่อนมี await ใดๆ — กัน pop-up blocker) พร้อมหน้า "กำลังเตรียมใบพิมพ์"
 * ถูกบล็อก → null (ผู้เรียกแจ้งผู้ใช้) · มือถือเปิดแท็บใหม่แล้วไม่มีปุ่มปิด จึงใส่ปุ่มปิดมือถือด้วย (printWindowClose.js)
 */
export function openExecReportPreparingWindow() {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) return null
  win.document.open()
  win.document.write(addMobileCloseButton(PREPARING_HTML))
  win.document.close()
  return win
}

/**
 * เขียนใบลงหน้าต่างแล้วสั่งพิมพ์ (รอฟอนต์ก่อน) — ไม่ส่ง win = เปิดหน้าต่างเอง (ต้องเรียกจากการกดปุ่มโดยตรง)
 * ถูกบล็อก/ผู้ใช้ปิดหน้าต่างไปแล้ว → false
 */
export function openExecServiceReportPrintWindow(html, win = null) {
  const target = win ?? window.open('', '_blank', 'width=900,height=1000')
  if (!target || target.closed) return false
  target.document.open()
  target.document.write(addMobileCloseButton(html))
  target.document.close()
  setTimeout(async () => {
    try {
      if (target.document.fonts?.ready) await Promise.race([target.document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1200))])
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    if (target.closed) return
    target.focus()
    target.print()
  }, 200)
  return true
}
