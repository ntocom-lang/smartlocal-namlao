// บันทึกข้อความ — รายงานการใช้น้ำมันเชื้อเพลิงและหล่อลื่นรายเดือน (สรุปทุกคันในใบเดียว)
//
// เลย์เอาต์หัวเรื่องตามระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ (ส่วนราชการ / ที่ / วันที่ /
// เรื่อง / เส้นคั่น / เรียน) ⚠️ ระยะเยื้องและขนาดครุฑยังไม่ได้ยืนยันกับตัวบทต้นฉบับ
// ค่าที่ใช้อยู่คัดจากใบจริงที่ อปท. ใช้งาน ถ้าจะอ้างอิงเป็นทางการต้องเปิดระเบียบฉบับจริงก่อน
//
// ตัวเลขทุกช่องในตารางคำนวณจากข้อมูลที่บันทึกไว้ในระบบ ไม่มีการเดาหรือเติมค่าแทนช่องว่าง
// ช่องที่ไม่มีข้อมูลพิมพ์เป็นขีด "-" ให้เขียนมือ เพราะเป็นเอกสารประกอบการตรวจสอบการเบิกจ่าย

import { GOV_FONT_LINK, GOV_PAGE_MARGIN, govDocFontCss, govPageCss } from './govDocStyle.js'
import { MONTHS_TH } from './thaiDate.js'

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function numText(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('th-TH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

// ปริมาณลิตรกับอัตราที่กำหนดพิมพ์ "เท่าที่มีนัยสำคัญ" ตามใบต้นฉบับ — 45 ไม่ใช่ 45.00
// แต่ 3.90 ยังคงทศนิยมไว้ เพราะเป็นค่าที่กรอกมาแบบนั้นจริง
// (อัตราที่ใช้จริงต่างออกไป: บังคับ 2 ตำแหน่งเสมอ เพราะเป็นผลหารที่ต้องเทียบกันได้ทุกแถว)
function flexNum(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return number.toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

// "3 เดือน สิงหาคม พ.ศ. 2569" ตามรูปแบบช่องวันที่ของบันทึกข้อความ
export function memoDateText(iso) {
  const match = String(iso ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  return `${Number(match[3])} เดือน ${MONTHS_TH[Number(match[2]) - 1]} พ.ศ. ${Number(match[1]) + 543}`
}

// ชื่อผู้บริหารตามประเภท อปท. — ใช้เป็นค่าเริ่มต้นของช่อง "เรียน" เท่านั้น
// เจ้าหน้าที่แก้ทับได้เสมอในกล่องก่อนพิมพ์ (บาง อปท. เรียนผ่านปลัดก่อน)
export function defaultAddressee(orgName) {
  const name = String(orgName ?? '').trim()
  if (!name) return ''
  const rules = [
    ['องค์การบริหารส่วนจังหวัด', 'นายกองค์การบริหารส่วนจังหวัด'],
    ['องค์การบริหารส่วนตำบล', 'นายกองค์การบริหารส่วนตำบล'],
    ['เทศบาลนคร', 'นายกเทศมนตรีนคร'],
    ['เทศบาลเมือง', 'นายกเทศมนตรีเมือง'],
    ['เทศบาลตำบล', 'นายกเทศมนตรีตำบล'],
  ]
  for (const [prefix, title] of rules) {
    if (name.startsWith(prefix)) return `${title}${name.slice(prefix.length).trim()}`
  }
  return `นายก${name}`
}

// ชื่อเดือน+ปี พ.ศ. ของช่วงที่เลือก ใช้เติมในหัวเรื่องและย่อหน้าเนื้อความ
// รับเฉพาะช่วงที่เป็น "เดือนเดียวเต็มเดือน" ถ้าไม่ใช่จะคืนค่าว่างให้ผู้เรียกใช้ label เดิมแทน
export function memoMonthLabel(from, to) {
  const start = String(from ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const end = String(to ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!start || !end) return ''
  if (start[1] !== end[1] || start[2] !== end[2]) return ''
  if (Number(start[3]) !== 1) return ''
  const lastDay = new Date(Number(start[1]), Number(start[2]), 0).getDate()
  if (Number(end[3]) !== lastDay) return ''
  return `${MONTHS_TH[Number(start[2]) - 1]} พ.ศ. ${Number(start[1]) + 543}`
}

const MONTHS_TH_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function shortDateText(iso) {
  const match = String(iso ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  return `${Number(match[3])} ${MONTHS_TH_SHORT[Number(match[2]) - 1]}`
}

function tripDistanceKm(trip) {
  const stored = Number(trip?.distance_km)
  if (Number.isFinite(stored) && String(trip?.distance_km ?? '') !== '') return stored
  const start = Number(trip?.odometer_start)
  const end = Number(trip?.odometer_end)
  if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(end - start, 0)
  return 0
}

function fuelCost(record) {
  const stored = Number(record?.total_cost)
  if (Number.isFinite(stored) && String(record?.total_cost ?? '') !== '') return stored
  const liters = Number(record?.liters)
  const price = Number(record?.price_per_liter)
  if (Number.isFinite(liters) && Number.isFinite(price)) return liters * price
  return 0
}

/**
 * รวมข้อมูลรายคันสำหรับตารางในบันทึกข้อความ
 *
 * ระยะทางมาจากผลรวมทริปที่สถานะ "เสร็จสิ้น" ในช่วงที่เลือก — แหล่งเดียวกับแบบ 4
 * บันทึกการใช้รถที่พิมพ์คู่กัน ตัวเลขในเอกสารสองใบจึงตรงกันเสมอและสอบยันย้อนได้
 * ⚠️ เดือนที่เจ้าหน้าที่ไม่ได้บันทึกทริปจะได้ระยะทาง 0 ทั้งที่รถวิ่งจริง ต้องไล่บันทึก
 * ทริปให้ครบก่อนพิมพ์ ไม่ใช่ไปแก้ตัวเลขบนกระดาษ
 *
 * แสดงเฉพาะคันที่ "มีการใช้งานหรือมีการเบิกจ่าย" ในช่วงนั้น ตรงกับข้อความในย่อหน้า
 * ที่ระบุจำนวนคัน — รถที่จอดนิ่งทั้งเดือนไม่ต้องขึ้นในรายงาน
 */
export function buildMemoRows({ vehicles = [], trips = [], fuel = [], typeLabels = {} }) {
  const stats = new Map()
  const pick = id => {
    if (!stats.has(id)) {
      stats.set(id, { distance: 0, liters: 0, cost: 0, lastTrip: '', lastFuel: '' })
    }
    return stats.get(id)
  }
  for (const trip of trips ?? []) {
    if (!trip?.vehicle_id) continue
    const item = pick(trip.vehicle_id)
    item.distance += tripDistanceKm(trip)
    const day = String(trip.trip_date ?? '')
    if (day > item.lastTrip) item.lastTrip = day
  }
  for (const record of fuel ?? []) {
    if (!record?.vehicle_id) continue
    const item = pick(record.vehicle_id)
    const liters = Number(record.liters)
    item.liters += Number.isFinite(liters) ? liters : 0
    item.cost += fuelCost(record)
    const day = String(record.filled_at ?? '')
    if (day > item.lastFuel) item.lastFuel = day
  }

  return (vehicles ?? [])
    .map(vehicle => {
      const item = stats.get(vehicle.id)
      if (!item) return null
      if (item.distance <= 0 && item.liters <= 0) return null
      const label = String(vehicle.name ?? '').trim()
        || typeLabels[vehicle.vehicle_type]
        || String(vehicle.vehicle_type ?? '').trim()
      const plate = String(vehicle.license_plate ?? vehicle.asset_code ?? '').trim()
      // หมายเหตุกำกับอัตราที่ใช้จริง — ใบต้นฉบับเขียนไว้เมื่อวันใช้รถกับวันเติมน้ำมันไม่ตรงกัน
      // เพราะน้ำมันที่เติมวันหนึ่งถูกใช้ข้ามไปอีกช่วง ทำให้อัตราของเดือนนั้นไม่ใช่ค่าจริงเป๊ะ
      let rateNote = ''
      if (item.liters <= 0) {
        rateNote = '(ไม่มีการเบิกน้ำมันในช่วงนี้)'
      } else if (item.lastTrip && item.lastFuel && item.lastTrip !== item.lastFuel) {
        rateNote = `(ใช้รถถึง ${shortDateText(item.lastTrip)} เติมน้ำมัน ${shortDateText(item.lastFuel)})`
      }
      return {
        vehicleText: plate ? `${label} ทะเบียน ${plate}` : label,
        distanceKm: item.distance,
        liters: item.liters,
        cost: item.cost,
        standardRate: vehicle.fuel_rate_standard_kml ?? null,
        actualRate: item.liters > 0 ? item.distance / item.liters : null,
        rateNote,
      }
    })
    .filter(Boolean)
}

function rateCell(row) {
  const actual = row?.actualRate
  const note = String(row?.rateNote ?? '').trim()
  if (actual === null || actual === undefined || !Number.isFinite(Number(actual))) {
    return note ? `-<span class="rate-note">${esc(note)}</span>` : '-'
  }
  const value = numText(actual, 2)
  return note ? `${value}<span class="rate-note">${esc(note)}</span>` : value
}

function tableRow(row, index) {
  return `<tr>
    <td class="c-seq">${index + 1}</td>
    <td class="left"><span class="cell">${esc(row.vehicleText)}</span></td>
    <td>${esc(numText(row.distanceKm, 0))}</td>
    <td>${esc(numText(row.liters, 2))}</td>
    <td>${esc(row.cost ? numText(row.cost, 0) : '-')}</td>
    <td>${row.standardRate === null || row.standardRate === undefined || row.standardRate === ''
      ? '-'
      : `${esc(flexNum(row.standardRate))} <span class="unit">กม./ลิตร</span>`}</td>
    <td>${rateCell(row)}</td>
  </tr>`
}

// ช่องลงนามบนใบจริงเยื้องกันเป็นขั้นบันได ไม่ใช่เรียง 3 คอลัมน์เท่ากัน
// (พัสดุชิดซ้าย · ปลัดเยื้องขวา · นายกอยู่ล่างค่อนซ้าย) จึงคุมด้วย margin-left รายบล็อก
function signatureBlock(sign, offsetClass) {
  if (!sign) return ''
  const name = String(sign.name ?? '').trim()
  const title = String(sign.title ?? '').trim()
  if (!name && !title) return ''
  return `<div class="sign ${offsetClass}">
    <p class="sign-name">${name ? `(${esc(name)})` : '(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)'}</p>
    <p class="sign-title">${esc(title)}</p>
  </div>`
}

export function buildFleetFuelMemoHtml({
  orgName = '',
  logoUrl = '',
  department = '',
  docNumber = '',
  docDate = '',
  monthLabel = '',
  addressee = '',
  rows = [],
  signatures = {},
}) {
  const org = String(orgName ?? '').trim() || 'หน่วยงาน'
  const periodText = String(monthLabel ?? '').trim()
  const subject = 'รายงานการใช้น้ำมันเชื้อเพลิงและหล่อลื่นสำหรับรถยนต์และรถจักรยานยนต์ส่วนกลางของทางราชการ'
  const bodyText = `${org} มีรถยนต์และรถจักรยานยนต์ส่วนกลาง จำนวน ${rows.length} คัน `
    + 'ซึ่งมีการใช้งานและมีการเบิกจ่ายน้ำมันเชื้อเพลิงและหล่อลื่น จึงขอรายงานระยะทาง '
    + 'ปริมาณการใช้น้ำมันเชื้อเพลิงและหล่อลื่น เพื่อใช้ในการปฏิบัติงานราชการ'
    + `${periodText ? ` ประจำเดือน ${periodText}` : ''} ดังนี้`

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>บันทึกข้อความ รายงานการใช้น้ำมันเชื้อเพลิง${periodText ? ` ${periodText}` : ''}</title>
  ${GOV_FONT_LINK}
  <style>
    ${govPageCss()}
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      color: #000;
      ${govDocFontCss()}
      background: #fff;
    }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      padding: ${GOV_PAGE_MARGIN};
      /* คอลัมน์ flex เพื่อให้บล็อกลงนามดันตัวเองลงไปอยู่ท้ายหน้าด้วย margin-top:auto
         (ดู .signs) — ดันด้วยระยะตายตัวไม่ได้ เพราะเคส 7 คันเหลือที่แค่ 7.7 มม.
         ใส่เกินนั้นเอกสารหลุดไปหน้า 2 ทันที ส่วน อปท. ที่มีรถ 3 คันจะเหลือที่ว่างเกือบครึ่งหน้า
         วิธีนี้ให้ผลถูกทั้งสองเคสโดยไม่ต้องตั้งค่าแยก */
      display: flex;
      flex-direction: column;
    }
    @media print {
      /* 274mm = พื้นที่พิมพ์ 276 มม. หัก 2 มม. กันปัดเศษไปเปิดหน้า 2 เปล่าๆ
         ต้องมีความสูงที่แน่นอนตรงนี้ margin-top:auto ของบล็อกลงนามถึงจะมีที่ให้ดัน */
      .sheet { width: auto; min-height: 274mm; padding: 0; }
      thead { display: table-header-group; }
    }
    .head { display: flex; align-items: center; gap: 12mm; }
    /* ครุฑสูง 1.5 ซม. ตามรูปแบบบันทึกข้อความ — ไม่มีไฟล์ครุฑในระบบ ใช้ตราหน่วยงานที่ อปท.
       อัปโหลดไว้แทนถ้ามี ไม่มีก็เว้นที่ว่างขนาดเท่ากันไว้ให้พิมพ์ทับกระดาษหัวจดหมายได้พอดี */
    .emblem { width: 15mm; height: 15mm; flex: none; }
    .emblem img { width: 100%; height: 100%; object-fit: contain; }
    /* 22pt ไม่ใช่ 29pt ตามแบบฟอร์มบันทึกข้อความมาตรฐาน — วัดจากใบจริงของ อปท. แล้วหัวเรื่อง
       สูงราว 20–22pt ที่ 29pt หัวเรื่องใหญ่จนผิดสัดส่วนกับเนื้อความเมื่อวางเทียบกับใบต้นฉบับ
       และกินที่แนวตั้งที่ต้องเอาไปเว้นให้ช่องลงนาม */
    h1 { flex: 1; margin: 0; text-align: center; font-size: 22pt; font-weight: 700; }
    .field { margin: 0; }
    .field b { font-weight: 700; }
    .field-row { display: flex; margin: 0; }
    .field-row .left-col { flex: 1; }
    .field-row .right-col { width: 46%; }
    .subject-cont { margin: 0; padding-left: 3.2em; }
    /* ชื่อเรื่องยาวเกิน 1 บรรทัดเสมอ — บรรทัดต่อไปต้องเยื้องมาตรงกับตัวอักษรแรกของชื่อเรื่อง
       ไม่ใช่ชิดขอบซ้ายทับแนวคำว่า "เรื่อง" (hanging indent ตามรูปแบบหนังสือราชการ) */
    .field--hang { padding-left: 3.2em; text-indent: -3.2em; }
    .rule {
      border: none;
      border-top: 1px dotted #000;
      margin: 3pt 0 4pt;
    }
    /* ไม่ใช้ justify — ภาษาไทยไม่มีเว้นวรรคระหว่างคำ เบราว์เซอร์จึงยืดช่องว่างที่มีอยู่ไม่กี่จุด
       จนเกิดรูโหว่กลางบรรทัด (เห็นชัดในย่อหน้าที่มีชื่อหน่วยงานยาวๆ) ชิดซ้ายอ่านง่ายกว่า */
    .body-text { margin: 0; text-indent: 2.5cm; }
    /* ⚠️ ข้อยกเว้น "ขนาดตัวอักษร" เฉพาะตาราง (เนื้อความของหนังสือยังเป็น 16pt ตามมาตรฐาน)
       7 คอลัมน์ที่ต้องมีทั้งชื่อรถยาวๆ ทะเบียน และตัวเลข 5 ช่อง ถ้าบังคับ 16pt ทั้งตาราง
       ใบของ อปท. ที่มีรถ 7 คันจะสูง 354 มม. (วัดจริง) ล้นพื้นที่พิมพ์ 276 มม. ไปหน้า 2
       ทั้งที่ใบต้นฉบับจบหน้าเดียว — 11pt (หัวตาราง 10.5pt) ทำให้เคสจริง 7 คันจบใน 1 หน้า
       พร้อมช่องลงนามแบบขั้นบันได 3 ชั้นและที่เซ็น 8 มม. ครบทุกคน
       เหลือที่เผื่อราว 8 มม. ⚠️ ตัวเลขนี้วัดจากใบจริงของเทศบาลตำบลน้ำเลา ถ้าจะขยับขนาด
       ต้องวัดความสูงรวมใหม่ทุกครั้ง อย่าเดา
       font-size-adjust สืบทอดมาจาก .sheet อยู่แล้ว ขนาดที่ตั้งเองนี้จึงยังพิมพ์เท่ากันทุกเครื่อง
       อปท. ที่มีรถมากกว่านี้จะไหลไปหน้า 2 เองอย่างถูกต้อง (หัวตารางซ้ำ แถวไม่แตกกลาง) */
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-top: 6pt;
      font-size: 11pt;
    }
    th, td {
      border: 1px solid #000;
      vertical-align: middle;
      text-align: center;
      padding: 1mm 3px;
    }
    th { font-weight: 700; line-height: 1.15; font-size: 10.5pt; }
    td { height: 7mm; line-height: 1.2; }
    /* แถวเดียวห้ามถูกตัดครึ่งคาบสองหน้า และบล็อกลงนามต้องอยู่ด้วยกันทั้งชุด
       (ชื่อโผล่หน้าหนึ่ง ตำแหน่งไปอีกหน้า = เอกสารใช้ไม่ได้) */
    tr { page-break-inside: avoid; }
    .signs { page-break-inside: avoid; }
    td.left { text-align: left; }
    td.left .cell { display: block; white-space: normal; overflow-wrap: break-word; }
    /* หมายเหตุใต้อัตราที่ใช้จริง (เช่น "ใช้รถถึง 31 ก.ค. เติมน้ำมัน 15 ก.ค.") เป็นคำอธิบาย
       กำกับตัวเลข ไม่ใช่เนื้อความของหนังสือ บนใบจริงจึงเขียนตัวเล็กกว่า — ยกเว้นเฉพาะ
       "ขนาดตัวอักษร" ของช่องนี้ ฟอนต์/ขอบกระดาษยังเป็นค่ามาตรฐานกลางทั้งใบ */
    .rate-note { display: block; font-size: 8pt; line-height: 1.05; }
    /* หน่วยห้ามตัดกลางคำเป็น "กม./" ขึ้นบรรทัดใหม่ "ลิตร" — ตัดทั้งก้อนหลังตัวเลขแทน */
    .unit { white-space: nowrap; }
    col.c-seq { width: 7%; }
    col.c-vehicle { width: 35%; }
    col.c-dist { width: 9%; }
    col.c-liters { width: 9%; }
    col.c-baht { width: 10%; }
    col.c-std { width: 15%; }
    col.c-actual { width: 15%; }
    .closing { margin: 8pt 0 0; text-indent: 2.5cm; }
    /* ตัวคั่นที่ "ยืดได้แต่มีเพดาน" — ดันช่องลงนามลงมาได้มากสุด 20 มม. เมื่อหน้ายังโล่ง
       แล้วหดเองเมื่อรถเยอะจนหน้าเริ่มเต็ม (เคส 7 คันเหลือที่ยืดแค่ ~5 มม.)
       ใช้ margin-top:auto เฉยๆ ไม่ได้ เพราะจะดันไปติดขอบล่างสุดทุกครั้ง เอกสารที่มีรถ
       ไม่กี่คันจะเหลือช่องว่างกลางหน้าเป็นแผ่นใหญ่ ดูเหมือนพิมพ์ตกหล่น */
    .sign-gap { flex: 1 1 auto; max-height: 20mm; }
    .signs { margin-top: 6pt; }
    /* ช่องลงนามเยื้องลงเป็นขั้นบันได 3 ชั้นตามใบต้นฉบับ (พัสดุซ้าย · ปลัดขวา · นายกซ้ายล่างสุด)
       ไม่ใช่จับพัสดุกับปลัดมาไว้แถวเดียวกัน — เคยทำแบบนั้นเพื่อประหยัดที่แนวตั้ง แต่วางเทียบกับ
       ใบจริงแล้วผิดรูปทันที ที่แนวตั้งที่ต้องใช้เพิ่มไปเอาคืนจากหัวเรื่อง (29→22pt) กับตาราง
       (12→11pt) แทน */
    .sign { text-align: center; width: 46%; }
    /* ชื่อ/ตำแหน่งผู้ลงนาม 14pt ไม่ใช่ 16pt ของเนื้อความ — ยกเว้นเฉพาะขนาดตัวอักษรของบล็อกนี้
       เพื่อคืนที่แนวตั้งให้ช่องเซ็น 8 มม. ยังอยู่ครบทั้ง 3 ชั้นโดยเอกสารไม่หลุดหน้า 2
       (ใบต้นฉบับก็เขียนชื่อผู้ลงนามเล็กกว่าเนื้อความเล็กน้อยเช่นกัน) */
    .sign p { margin: 0; font-size: 14pt; }
    /* เว้นที่ว่างเหนือชื่อไว้ให้เซ็นสด — บันทึกข้อความไม่มีเส้น "ลงชื่อ ____" บนใบต้นฉบับ
       ⚠️ 8 มม. คือความสูงที่ลายเซ็นคนไทยทั่วไปเขียนได้โดยไม่ทับตัวหนังสือ (7 มม. ยังฝืด)
       ลดค่านี้เพื่อให้เอกสารจบหน้าเดียวไม่ได้ ต้องไปหาที่จากส่วนอื่นแทน */
    .sign-name { margin-top: 8mm !important; }
    .sign--left { margin-left: 4%; }
    .sign--right { margin-left: 52%; }
    .sign--bottom { margin-left: 2%; }
  </style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div class="emblem">${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ''}</div>
    <h1>บันทึกข้อความ</h1>
  </div>
  <p class="field"><b>ส่วนราชการ</b>&nbsp;&nbsp;${esc(department)}</p>
  <div class="field-row">
    <p class="field left-col"><b>ที่</b>&nbsp;&nbsp;${esc(docNumber)}</p>
    <p class="field right-col"><b>วันที่</b>&nbsp;&nbsp;${esc(memoDateText(docDate))}</p>
  </div>
  <p class="field field--hang"><b>เรื่อง</b>&nbsp;&nbsp;${esc(subject)}</p>
  ${periodText ? `<p class="subject-cont">ประจำเดือน ${esc(periodText)}</p>` : ''}
  <hr class="rule">
  <p class="field"><b>เรียน</b>&nbsp;&nbsp;${esc(addressee)}</p>
  <p class="body-text">${esc(bodyText)}</p>
  <table>
    <colgroup>
      <col class="c-seq"><col class="c-vehicle"><col class="c-dist">
      <col class="c-liters"><col class="c-baht"><col class="c-std"><col class="c-actual">
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2" class="c-seq">ลำดับ</th>
        <th rowspan="2" class="c-vehicle">ประเภทรถ เลขทะเบียน</th>
        <th rowspan="2" class="c-dist">ระยะทาง<br>(กม.)</th>
        <th colspan="2">ปริมาณการใช้น้ำมัน<br>เชื้อเพลิง</th>
        <th colspan="2">อัตราสิ้นเปลือง</th>
      </tr>
      <tr>
        <th class="c-liters">(ลิตร)</th>
        <th class="c-baht">(บาท)</th>
        <th class="c-std">อัตราที่กำหนด</th>
        <th class="c-actual">อัตราที่ใช้จริง</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(tableRow).join('')}
    </tbody>
  </table>
  <p class="closing">จึงเรียนมาเพื่อโปรดทราบ</p>
  <div class="sign-gap"></div>
  <div class="signs">
    ${signatureBlock(signatures.supply, 'sign--left')}
    ${signatureBlock(signatures.clerk, 'sign--right')}
    ${signatureBlock(signatures.mayor, 'sign--bottom')}
  </div>
</div>
</body>
</html>`
}
