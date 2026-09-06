// สรุปและวิเคราะห์คำร้องหมวด "กลิ่นเหม็นรบกวน" — คำนวณล้วน ไม่มี JSX
//
// แยกจาก component เพราะใช้ 3 ที่ที่เรนเดอร์คนละแบบ: แผงรายงานของผู้รับผิดชอบ, แท็ปเฉพาะกิจของ
// แอดมิน และใบพิมพ์ A4 (สร้าง HTML ดิบด้วย string) — ถ้าเขียนรวมในไฟล์ component ใบพิมพ์จะเรียกไม่ได้
// (และ react-refresh ห้ามไฟล์ component export ค่าที่ไม่ใช่ component อยู่แล้ว)
//
// ⚠️ ข้อจำกัดที่ต้องรู้ก่อนเอาตัวเลขไปใช้ตัดสินใจ
//   1. ทุกตัวเลขคือ "คำร้องที่ประชาชนแจ้งเข้ามา" ไม่ใช่ระดับกลิ่นที่วัดได้จริง พื้นที่ที่คนไม่รู้จัก
//      ระบบหรือไม่มีสมาร์ตโฟนจะดูเหมือนไม่มีปัญหา (reporting bias) — ห้ามอ่านว่า "หมู่นี้ไม่มีกลิ่น"
//   2. ยังไม่มีที่บันทึกผลการตรวจสอบ จึงวัดได้แค่ "ขาเข้า" วัดไม่ได้ว่าจัดการได้แค่ไหน
//   3. ทิศทางลมเป็นค่าที่ผู้แจ้งกรอกเอง และคำถามไม่ได้ระบุว่าหมายถึงลมพัดมาจากทิศนั้นหรือพัดไปทางนั้น
//      ใช้ประกอบการตั้งข้อสังเกตได้ ห้ามใช้ชี้แหล่งกำเนิดเดี่ยวๆ (ดูหมายเหตุที่ติดไปกับผลลัพธ์)

import { ODOR_TIME_RANGES, odorIncidentRangeOf } from './odorTimeRanges.js'
import { ODOR_INTENSITY_LEVELS, ODOR_SEVERE_FROM, HEALTH_EFFECT_NONE } from './odorOptions.js'

// ต่ำกว่านี้ถือว่ากลุ่มตัวอย่างเล็กเกินกว่าจะพูดเป็นสัดส่วน — 2 ใน 3 เรื่อง = 67% อ่านแล้วเข้าใจผิด
// ว่าเป็นแนวโน้มของพื้นที่ ทั้งที่เพิ่มอีกเรื่องเดียวตัวเลขก็พลิก จึงแสดงเป็นจำนวนดิบแทน
const ODOR_SMALL_SAMPLE = 20

const locationOf = (c) => c.location_name || c.village || 'ไม่ระบุสถานที่'
const intensityOf = (c) => {
  const v = Number(c?.extra_data?.odor_intensity)
  return Number.isFinite(v) ? v : null
}
const healthOf = (c) => {
  const v = c?.extra_data?.health_effect
  return v && v !== HEALTH_EFFECT_NONE ? v : null
}
const dateOf = (c) => {
  if (!c?.created_at) return null
  const d = new Date(c.created_at)
  return Number.isNaN(d.getTime()) ? null : d
}

const mean = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null)
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10)

// นับตามคีย์แล้วเรียงจากมากไปน้อย
function tally(items, getKey) {
  const map = new Map()
  for (const it of items) {
    const k = getKey(it)
    if (k == null || k === '') continue
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

// เดือนแบบ พ.ศ. ย่อ ("ก.ย. 69") — ใช้ th-TH ซึ่งแปลงปีให้เองอยู่แล้ว ไม่ต้องบวก 543 เอง
const monthLabel = (d) => d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * สรุปคำร้องกลิ่นเหม็นเป็นก้อนข้อมูลเดียวสำหรับเรนเดอร์
 * @param {Array} complaints คำร้องหมวด odor (ผ่านตัวกรองมาแล้วหรือยังไม่ผ่านก็ได้)
 * @returns ก้อนสรุป — ทุกฟิลด์ pct เป็น null เมื่อกลุ่มตัวอย่างเล็กกว่า ODOR_SMALL_SAMPLE
 */
export function buildOdorSummary(complaints) {
  const rows = Array.isArray(complaints) ? complaints : []
  const total = rows.length
  const smallSample = total < ODOR_SMALL_SAMPLE
  // คืน pct เป็น null เมื่อข้อมูลน้อย เพื่อให้ทุกที่ที่เรนเดอร์ "ไม่มีเปอร์เซ็นต์ให้แสดง" โดยอัตโนมัติ
  // ไม่ต้องไปจำกฎนี้ซ้ำในแต่ละหน้า
  const pctOf = (n) => (smallSample || total === 0 ? null : Math.round((n / total) * 1000) / 10)

  const dates = rows.map(dateOf).filter(Boolean).sort((a, b) => a - b)
  const intensities = rows.map(intensityOf).filter((v) => v != null)

  const timeRanges = ODOR_TIME_RANGES.map((r) => {
    const count = rows.filter((c) => odorIncidentRangeOf(c) === r.value).length
    return { value: r.value, label: r.label, count, pct: pctOf(count) }
  })

  const intensityDist = ODOR_INTENSITY_LEVELS.map((lv) => {
    const count = rows.filter((c) => intensityOf(c) === lv.value).length
    return { level: lv.value, label: lv.label, count, pct: pctOf(count) }
  })
  const severeCount = rows.filter((c) => (intensityOf(c) ?? 0) >= ODOR_SEVERE_FROM).length

  // จุดร้อน: นับรายพื้นที่ พร้อมความรุนแรงเฉลี่ยและช่วงเวลาที่พบบ่อยที่สุดของพื้นที่นั้น
  // (ช่วงเวลารายพื้นที่คือสิ่งที่เอาไปจัดเวรลงตรวจได้จริง ต่างจากช่วงเวลารวมทั้ง อปท.)
  const locations = tally(rows, locationOf).map(({ key, count }) => {
    const inArea = rows.filter((c) => locationOf(c) === key)
    const topRange = tally(inArea, odorIncidentRangeOf)[0]
    return {
      name: key,
      count,
      pct: pctOf(count),
      avgIntensity: round1(mean(inArea.map(intensityOf).filter((v) => v != null))),
      severeCount: inArea.filter((c) => (intensityOf(c) ?? 0) >= ODOR_SEVERE_FROM).length,
      topTimeRangeLabel: ODOR_TIME_RANGES.find((r) => r.value === topRange?.key)?.label ?? null,
    }
  })

  const withSymptom = rows.filter((c) => healthOf(c) != null)
  const health = {
    count: withSymptom.length,
    pct: pctOf(withSymptom.length),
    byOption: tally(withSymptom, healthOf).map(({ key, count }) => ({ label: key, count })),
  }

  // แนวโน้มรายเดือน: ไล่ต่อเนื่องจากเดือนแรกที่มีข้อมูลถึงเดือนล่าสุด เติมเดือนที่ไม่มีเรื่องเป็น 0
  // ถ้าข้ามเดือนว่างทิ้ง กราฟจะดูเหมือนแจ้งสม่ำเสมอทั้งที่เว้นไป 3 เดือน
  const months = []
  if (dates.length) {
    const cursor = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1)
    const last = dates[dates.length - 1]
    const stop = new Date(last.getFullYear(), last.getMonth(), 1)
    const byMonth = new Map()
    for (const d of dates) byMonth.set(monthKey(d), (byMonth.get(monthKey(d)) ?? 0) + 1)
    // กันลูปไม่รู้จบถ้าวันที่เพี้ยน (created_at ที่ปีเกินจริงจากเครื่องที่ตั้งนาฬิกาผิด)
    for (let guard = 0; cursor <= stop && guard < 120; guard += 1) {
      months.push({ key: monthKey(cursor), label: monthLabel(cursor), count: byMonth.get(monthKey(cursor)) ?? 0 })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  // ทิศลมนับเฉพาะกลุ่มที่รุนแรง (4-5) เพราะกลุ่มนี้คือเรื่องที่ต้องออกไปหาต้นตอจริงๆ
  const severeRows = rows.filter((c) => (intensityOf(c) ?? 0) >= ODOR_SEVERE_FROM)
  const wind = tally(severeRows, (c) => c?.extra_data?.wind_direction)
    .map(({ key, count }) => ({ label: key, count }))

  const summary = {
    total,
    smallSample,
    smallSampleThreshold: ODOR_SMALL_SAMPLE,
    firstAt: dates[0] ?? null,
    lastAt: dates[dates.length - 1] ?? null,
    timeRanges,
    intensity: {
      avg: round1(mean(intensities)),
      answered: intensities.length,
      dist: intensityDist,
      severeCount,
      severePct: pctOf(severeCount),
      severeFrom: ODOR_SEVERE_FROM,
    },
    health,
    locations,
    months,
    wind,
  }
  summary.observations = buildOdorObservations(summary)
  return summary
}

/**
 * ข้อสังเกตอัตโนมัติเป็นประโยคภาษาไทย — ใช้ทั้งบนหน้าจอและในใบพิมพ์
 * เขียนเฉพาะข้อที่ข้อมูลรองรับจริง ไม่เติมประโยคกลางๆ ให้ดูเยอะ และไม่สรุปสาเหตุแทนเจ้าหน้าที่
 */
export function buildOdorObservations(s) {
  const out = []
  if (!s.total) return out

  const topRange = [...s.timeRanges].sort((a, b) => b.count - a.count)[0]
  if (topRange && topRange.count > 0) {
    out.push(`ช่วงเวลาที่ถูกแจ้งมากที่สุดคือ${topRange.label} จำนวน ${topRange.count} เรื่อง เป็นช่วงที่ควรจัดเวรลงพื้นที่ตรวจสอบ`)
  }

  const top = s.locations[0]
  if (top && top.count >= 3) {
    const areaAvg = top.avgIntensity != null ? ` ความรุนแรงเฉลี่ย ${top.avgIntensity} จาก 5` : ''
    const areaTime = top.topTimeRangeLabel ? ` ช่วงเวลาที่พบบ่อยในพื้นที่นี้คือ${top.topTimeRangeLabel}` : ''
    out.push(`พื้นที่ที่ถูกแจ้งมากที่สุดคือ ${top.name} จำนวน ${top.count} เรื่อง${areaAvg}${areaTime}`)
  }

  if (s.intensity.severeCount > 0) {
    out.push(`มี ${s.intensity.severeCount} เรื่องที่ผู้แจ้งประเมินความรุนแรงระดับ ${s.intensity.severeFrom} ขึ้นไป (เริ่มมีผลต่อร่างกาย ไม่ใช่แค่รำคาญ) ควรจัดลำดับตรวจสอบก่อน`)
  }

  if (s.health.count > 0) {
    const opts = s.health.byOption.slice(0, 3).map((o) => `${o.label} ${o.count} ราย`).join(', ')
    out.push(`ผู้แจ้ง ${s.health.count} รายระบุว่ามีอาการทางกาย (${opts}) หากพบซ้ำในพื้นที่เดียวกันควรประสานงานสาธารณสุขร่วมตรวจสอบ`)
  }

  // เทียบ 2 เดือนล่าสุดที่จบแล้ว ไม่เอาเดือนปัจจุบันที่ยังนับไม่ครบมาเทียบกับเดือนเต็ม
  const closed = s.months.filter((m) => m.key !== monthKey(new Date()))
  if (closed.length >= 2) {
    const prev = closed[closed.length - 2]
    const latest = closed[closed.length - 1]
    const diff = latest.count - prev.count
    if (diff !== 0) {
      const dir = diff > 0 ? 'เพิ่มขึ้น' : 'ลดลง'
      out.push(`จำนวนเรื่องเดือน${latest.label} (${latest.count} เรื่อง) ${dir}จากเดือน${prev.label} (${prev.count} เรื่อง) ${Math.abs(diff)} เรื่อง`)
    }
  }

  const topWind = s.wind[0]
  if (topWind && s.intensity.severeCount >= 3) {
    out.push(`ในกลุ่มเรื่องที่รุนแรง ผู้แจ้งระบุทิศทางลมว่า "${topWind.label}" มากที่สุด ${topWind.count} เรื่อง เป็นค่าที่ผู้แจ้งกรอกเอง ใช้ประกอบเท่านั้น ยังชี้แหล่งกำเนิดไม่ได้`)
  }

  if (s.smallSample) {
    out.push(`ข้อมูลยังมีเพียง ${s.total} เรื่อง (ต่ำกว่า ${s.smallSampleThreshold}) ตัวเลขข้างต้นจึงแสดงเป็นจำนวนดิบ ยังสรุปเป็นสัดส่วนหรือแนวโน้มของพื้นที่ไม่ได้`)
  }

  out.push('ตัวเลขทั้งหมดคือเรื่องที่ประชาชนแจ้งเข้ามา ไม่ใช่ผลตรวจวัดกลิ่น และระบบยังไม่มีการบันทึกผลการตรวจสอบ จึงยังประเมินไม่ได้ว่าแก้ไขปัญหาได้มากน้อยเพียงใด')
  return out
}


// ── หมุดบนแผนที่ (ปัดพิกัดลงกริด) ──────────────────────────────────────────────
//
// ⚠️ ทำไมต้องปัดกริด ไม่ใช้พิกัดดิบ
//   พิกัดที่ผู้แจ้งปักมาส่วนใหญ่คือบ้านตัวเอง ไม่ใช่ตัวโรงงาน/ฟาร์มที่เป็นต้นเหตุ การกางหมุดดิบ
//   บนแผงรายงานจึงเท่ากับชี้หลังคาเรือนของคนที่ร้องเรียนเพื่อนบ้าน ให้ทุกคนที่เปิดแผงนี้เห็นพร้อมกัน
//   ทั้งที่การเปิดดูข้อมูลรายเรื่อง (ชื่อ/เบอร์/พิกัด) ผ่านบ็อปอัพยังถูกบันทึก audit log ว่าใครดูของใคร
//   — แผนที่จะข้ามด่านนั้นไปทั้งหมดถ้าปล่อยพิกัดดิบ
//   เป้าหมายของแผนที่นี้คือหา "แหล่งกำเนิดกลิ่น" ซึ่งความละเอียดระดับ 100 ม. เพียงพอแล้ว
//   ⚠️ กริดลดความเสี่ยง ไม่ได้ทำให้ระบุตัวไม่ได้ — ถ้าในเซลล์นั้นมีบ้านหลังเดียวก็ยังรู้ว่าใคร
//     จึงไม่ควรเอาแผนที่นี้ไปเปิดให้ role ที่กว้างกว่าที่เห็นรายการคำร้องอยู่แล้ว
//
// ⚠️ ห้ามเปลี่ยนเป็น heatmap ไล่สี — ข้อมูลจริงตอนนี้อยู่ระดับหลักหน่วยถึงหลักสิบเรื่องต่อ อปท.
//   การเกลี่ยสีจากคำร้องไม่กี่ใบจะวาด "จุดร้อน" ที่มาจากเรื่องเดียว แล้วมีคนเอาไปอ้างสั่งการจริง
//   1 วง = 1 เซลล์กริด นับได้ด้วยตา คือรูปแบบเดียวที่ซื่อสัตย์กับขนาดข้อมูลชุดนี้
const ODOR_GRID_METERS = 100

// ความยาว 1 องศาละติจูดโดยประมาณ (WGS84) — ค่ามาตรฐานที่ใช้กันทั่วไป ไม่ต้องพึ่งไลบรารี geo
const METERS_PER_DEG_LAT = 111320

// กรอบประเทศไทยแบบหยาบ ใช้กันพิกัดขยะ (GPS อ่านพลาดเป็น 0,0 หรือค่าที่ผู้ใช้ลากหมุดหลุด)
// ไม่ใช่การตรวจเขตปกครอง — จุดเดียวที่หลุดออกไปทำให้ fitBounds ซูมออกไปครึ่งโลกจนแผนที่ใช้ไม่ได้เลย
// นับแยกไว้แล้วรายงานจำนวนออกไปด้วย ไม่กลืนหายเงียบๆ
const TH_BOUNDS = { minLat: 5, maxLat: 21, minLng: 96, maxLng: 106 }

// ⚠️ ห้ามใช้ Number() ตรงๆ กับพิกัด — Number(null) และ Number('') คืน 0 ซึ่ง Number.isFinite ผ่าน
// คำร้องที่ไม่มีพิกัดจะกลายเป็นจุดที่ละติจูด 0 แล้วถูกนับเป็น 'พิกัดนอกกรอบ' แทน 'ไม่มีพิกัด'
// ทำให้ข้อความใต้แผนที่บอกสาเหตุผิด (เจอตอนทดสอบจริง ไม่ใช่การป้องกันไว้ก่อนแบบลอยๆ)
const toCoord = (v) => (v == null || v === '' ? NaN : Number(v))

/**
 * รวมคำร้องกลิ่นเป็นหมุดตามเซลล์กริด สำหรับวาดบนแผนที่
 * @param {Array} complaints คำร้องหมวด odor
 * @param {{gridMeters?: number}} options ขนาดเซลล์เป็นเมตร (ค่าเริ่มต้น 100)
 * @returns ก้อนหมุด + จำนวนที่ลงแผนที่ไม่ได้ (แยกเหตุผล) เพื่อให้ผู้อ่านรู้ว่าแผนที่ไม่ครบตรงไหน
 */
export function buildOdorPoints(complaints, { gridMeters = ODOR_GRID_METERS } = {}) {
  const rows = Array.isArray(complaints) ? complaints : []
  const step = Number(gridMeters) > 0 ? Number(gridMeters) : ODOR_GRID_METERS
  const latStep = step / METERS_PER_DEG_LAT

  let missingCoords = 0
  let outOfRange = 0
  const cells = new Map()

  for (const c of rows) {
    const lat = toCoord(c?.latitude)
    const lng = toCoord(c?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { missingCoords += 1; continue }
    if (lat < TH_BOUNDS.minLat || lat > TH_BOUNDS.maxLat
      || lng < TH_BOUNDS.minLng || lng > TH_BOUNDS.maxLng) { outOfRange += 1; continue }

    // ปัดลงกริดโดยอ้างจุดกำเนิด (0,0) เสมอ ห้ามอ้างค่าเฉลี่ยของชุดข้อมูล — เซลล์จะได้คงที่
    // เพิ่มคำร้องใหม่เข้ามาแล้วหมุดเดิมไม่ขยับ (ถ้าอ้างค่าเฉลี่ย ทั้งแผนที่จะเลื่อนทุกครั้งที่มีเรื่องใหม่
    // แล้วเจ้าหน้าที่ที่จำตำแหน่งจุดกระจุกไว้จะอ่านว่าแหล่งกำเนิดย้ายที่ ทั้งที่ไม่มีอะไรย้าย)
    const latIdx = Math.floor(lat / latStep)
    const cellLat = (latIdx + 0.5) * latStep
    // 1 องศาลองจิจูดสั้นลงตามละติจูด — ใช้ cellLat (ไม่ใช่ lat ดิบ) เพื่อให้ทุกจุดในแถบละติจูดเดียวกัน
    // ได้ขนาดเซลล์เท่ากันเป๊ะ ไม่งั้นสองจุดที่คนละฝั่งของเส้นแบ่งจะคำนวณ step ต่างกันนิดเดียวแล้วเหลื่อม
    const lngStep = step / (METERS_PER_DEG_LAT * Math.max(0.01, Math.cos((cellLat * Math.PI) / 180)))
    const lngIdx = Math.floor(lng / lngStep)
    const cellLng = (lngIdx + 0.5) * lngStep

    const key = `${latIdx}:${lngIdx}`
    if (!cells.has(key)) cells.set(key, { key, lat: cellLat, lng: cellLng, items: [] })
    cells.get(key).items.push(c)
  }

  const points = [...cells.values()].map((cell) => {
    const intensities = cell.items.map(intensityOf).filter((v) => v != null)
    const dates = cell.items.map(dateOf).filter(Boolean).sort((a, b) => a - b)
    return {
      key: cell.key,
      lat: cell.lat,
      lng: cell.lng,
      count: cell.items.length,
      severeCount: intensities.filter((v) => v >= ODOR_SEVERE_FROM).length,
      maxIntensity: intensities.length ? Math.max(...intensities) : null,
      avgIntensity: round1(mean(intensities)),
      firstAt: dates[0] ?? null,
      latestAt: dates[dates.length - 1] ?? null,
      // ทิศทางลม/ช่วงเวลา เป็นคำตอบ structured ล้วน ไม่ใช่ free-text ที่ผู้แจ้งพิมพ์เอง
      // จึงเอาขึ้น popup ได้โดยไม่ทำให้แผงนี้กลายเป็นที่เปิดเผยข้อมูลผู้แจ้ง
      timeRanges: tally(cell.items, odorIncidentRangeOf),
      winds: tally(cell.items, (c) => c?.extra_data?.wind_direction),
    }
  }).sort((a, b) => b.count - a.count
    || (b.maxIntensity ?? 0) - (a.maxIntensity ?? 0)
    || a.key.localeCompare(b.key))

  return {
    gridMeters: step,
    points,
    total: rows.length,
    mapped: rows.length - missingCoords - outOfRange,
    missingCoords,
    outOfRange,
    // ใช้ไล่ขนาดวงกลม — ต่ำสุด 1 เสมอ กัน 0/0 ตอนไม่มีหมุดเลย
    maxCount: points.reduce((m, p) => Math.max(m, p.count), 1),
    smallSample: rows.length < ODOR_SMALL_SAMPLE,
    smallSampleThreshold: ODOR_SMALL_SAMPLE,
  }
}

export { ODOR_SMALL_SAMPLE, ODOR_GRID_METERS }
