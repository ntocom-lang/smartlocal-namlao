// ตัวช่วยของหน้า "เหตุการณ์น้ำ-ฝน" ฝั่งเจ้าหน้าที่ (src/components/staff/WaterEventsPanel.jsx) — ฟังก์ชันล้วน ทดสอบได้ใน node
// (tests/water-events-ui.test.mjs)
//
// ข้อมูลมาจาก list_water_events() / get_water_event() (supabase/migrations/20261017100000) ซึ่งอ่านตารางที่
// water_event_tick() จดไว้เอง — ไฟล์นี้แค่จัดรูปแบบการแสดงผล ไม่ประเมินเหตุการณ์ ไม่เขียนอะไรกลับ
//
// กติกาที่ต้องไม่หลุด:
//   - ค่าว่าง = "ไม่มีค่า" ห้ามกลายเป็น 0 / "ปกติ" (ระดับน้ำว่างห้ามกลายเป็น "เสมอตลิ่ง")
//   - เส้นกราฟไม่ลากข้ามช่วงที่สถานีไม่ส่งค่า (ตัดเส้น ไม่เติมค่าให้)
//   - ไม่ประเมินความเสียหาย/ไม่ตัดสินว่าเป็นภัย — เป็นแค่ "ค่าที่วัดได้ตามที่ระบบจดไว้"
//   - ข้อความจากหน่วยงานอื่น (สสน.) ส่งต่อตามต้นฉบับ ไม่ตัดแต่ง
import {
  DAM_SAME_MIN_REPORTS, DAM_STALE_HOURS, LEVEL_WATCH_M, RAIN_VERY_HEAVY_MM, STATION_STALE_HOURS,
  bankText, damLevel, formatMcm, formatMm, measuredAtText, rainLevel, toNum,
} from './waterSituation.js'

const TZ = 'Asia/Bangkok'
const HOUR_MS = 60 * 60 * 1000

// ระบบตรวจทุกชั่วโมง (นาทีที่ 20) — เงียบเกินนี้ถือว่าพลาดรอบ (ยอมพลาดได้ 2 รอบก่อนเตือน)
export const RECORDER_LATE_HOURS = 3

export const WATER_EVENTS_DISCLAIMER =
  'ตัวเลขทั้งหมดคือค่าที่สถานีวัดได้ตามที่ระบบจดไว้ ไม่ใช่การประเมินความเสียหาย การประกาศภัย หรือคำสั่งของหน่วยงาน · ช่องที่สถานีไม่ส่งค่าแสดงว่า "ไม่มีค่า" ไม่ใช่ 0'

// เกณฑ์ที่ระบบเปิดเหตุการณ์ — ตัวเลขดึงจาก waterSituation.js (tests/water-events.test.mjs เทียบกับ SQL ให้อยู่แล้ว)
export const WATER_EVENT_CRITERIA = [
  `ฝนสะสม 24 ชม. ตั้งแต่ ${RAIN_VERY_HEAVY_MM} มม. ขึ้นไป (ฝนหนักมาก ตามเกณฑ์กรมอุตุนิยมวิทยา)`,
  `ระดับน้ำต่ำกว่าตลิ่งไม่เกิน ${LEVEL_WATCH_M} ม. (ขั้นเฝ้าระวังขึ้นไป ตามเกณฑ์กรมชลประทาน)`,
  'สถานีเตือนภัยระดับ 2–3',
  'ข้อความเตือนของ สสน. ที่ระบุอำเภอและจังหวัดเดียวกับหน่วยงาน',
]
export const WATER_EVENT_CRITERIA_NOTES = [
  'อ่างเก็บน้ำไม่ใช้เปิดเหตุการณ์ เพราะอยู่ชั้น "น้ำมาก" ได้เป็นเดือนในฤดูฝน',
  'ระบบปิดเหตุการณ์เองเมื่อค่าไม่เข้าเกณฑ์ต่อเนื่อง 24 ชม. ไม่มีใครต้องกดปิดหรือกรอกอะไร',
]

const TYPE_ORDER = ['rain', 'waterlevel', 'dam', 'ews']
const TYPE_LABEL = { rain: 'สถานีวัดฝน', waterlevel: 'สถานีวัดระดับน้ำ', dam: 'อ่างเก็บน้ำ', ews: 'สถานีเตือนภัย' }

function toMs(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

// "20 ต.ค. 69 10:20 น." — ยึดเวลาไทยเสมอ (คนเปิดจากเครื่องที่ตั้ง timezone อื่นต้องเห็นเลขเดียวกัน)
export function thaiDateTime(iso) {
  const ms = toMs(iso)
  if (ms === null || iso === null || iso === undefined) return ''
  const at = new Date(ms)
  const day = at.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ })
  const time = at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
  return `${day} ${time} น.`
}

export function thaiDay(iso) {
  const ms = toMs(iso)
  if (ms === null || iso === null || iso === undefined) return ''
  return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ })
}

// "ไม่ถึง 1 ชม." · "5 ชม." · "2 วัน 3 ชม." · "2 วัน"
export function durationText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const hours = Math.floor(ms / HOUR_MS)
  if (hours < 1) return 'ไม่ถึง 1 ชม.'
  if (hours < 24) return `${hours} ชม.`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `${days} วัน` : `${days} วัน ${rest} ชม.`
}

// สถานะของตัวจด — ใช้แยก "ว่างเพราะสงบ" จาก "ว่างเพราะระบบเงียบ" · ไม่สั่งให้ใครทำอะไร (บอกสถานะเฉยๆ)
export function recorderStatus(recorder, now) {
  const lastOk = recorder?.last_ok_at ?? null
  const lastMs = lastOk ? toMs(lastOk) : null
  if (lastMs === null) {
    return { kind: 'unknown', text: 'ยังไม่มีบันทึกว่าระบบจดเหตุการณ์เคยตรวจ', lastOk: null }
  }
  const nowMs = toMs(now)
  const age = nowMs - lastMs
  if (age > RECORDER_LATE_HOURS * HOUR_MS) {
    return {
      kind: 'late',
      text: `ระบบจดเหตุการณ์ไม่ได้ตรวจมา ${durationText(age)} (ล่าสุด ${thaiDateTime(lastOk)}) — ข้อมูลช่วงนี้อาจไม่ครบ`,
      lastOk,
    }
  }
  return { kind: 'ok', text: `ระบบตรวจล่าสุด ${measuredAtText(lastOk, now)} · ตรวจทุกชั่วโมงเอง`, lastOk }
}

export function isEventOpen(event) {
  return !event?.closed_at
}

export function closeReasonText(reason) {
  if (reason === 'calm') return 'ระบบปิดเอง: ค่าไม่เข้าเกณฑ์ต่อเนื่อง 24 ชม.'
  if (reason === 'data_lost') return 'ระบบปิดเอง: ไม่มีค่าสดเกิน 48 ชม. (ไม่ได้แปลว่าเหตุการณ์จบจริง — สถานีอาจหยุดส่งค่า)'
  if (reason === 'module_off') return 'ระบบปิดเอง: หน่วยงานปิดโมดูลสถานการณ์น้ำ-ฝน'
  return ''
}

// ช่วงเวลาของเหตุการณ์ — เปิดอยู่: นับถึงตอนนี้ · ปิดแล้ว: นับถึงสัญญาณสุดท้าย (ended_at)
export function eventSpan(event, now) {
  const open = isEventOpen(event)
  const start = toMs(event?.opened_at)
  const end = open ? toMs(now) : toMs(event?.ended_at)
  return {
    open,
    startText: thaiDateTime(event?.opened_at),
    endText: open ? '' : thaiDateTime(event?.ended_at),
    duration: start !== null && end !== null ? durationText(end - start) : '',
  }
}

// สาเหตุที่ระบบเปิดเหตุการณ์ — เขียนจาก open_reason ตรงๆ (kind ที่ไม่รู้จักข้ามไป ไม่แสดงรหัสดิบ)
export function triggerText(trigger) {
  if (!trigger || typeof trigger !== 'object') return null
  const name = trigger.station_name ? String(trigger.station_name) : ''
  if (trigger.kind === 'rain') {
    const v = toNum(trigger.value)
    if (v === null) return null
    return `ฝนสะสม 24 ชม. ${formatMm(v)} มม.${name ? ` ที่${name}` : ''}`
  }
  if (trigger.kind === 'waterlevel') {
    const text = bankText(trigger.value)
    if (!text) return null
    return `${name ? `${name} ` : ''}${text}`.trim()
  }
  if (trigger.kind === 'ews') {
    const v = toNum(trigger.value)
    if (v === null) return null
    return `สถานีเตือนภัย${name ? ` ${name}` : ''} ระดับ ${v}`
  }
  if (trigger.kind === 'warning') {
    return `ข้อความเตือนของ สสน.${name ? ` (${name})` : ''}`
  }
  return null
}

export function openReasonLines(openReason, limit = 3) {
  const triggers = Array.isArray(openReason?.triggers) ? openReason.triggers : []
  const lines = triggers.map(triggerText).filter(Boolean)
  if (lines.length === 0) return { lines: [], more: 0 }
  return { lines: lines.slice(0, limit), more: Math.max(0, lines.length - limit) }
}

// ─────────────────────────── รายการเหตุการณ์ ───────────────────────────

// หัวการ์ดของเหตุการณ์หนึ่งในรายการ
export function eventCard(event, now) {
  const span = eventSpan(event, now)
  const reason = openReasonLines(event?.open_reason)
  const peaks = []
  const rain = toNum(event?.peak_rain_24h_mm)
  if (rain !== null) peaks.push(`ฝนสะสม 24 ชม. สูงสุด ${formatMm(rain)} มม.`)
  const bank = toNum(event?.min_bank_diff_m)
  if (bank !== null) peaks.push(`ใกล้ตลิ่งที่สุด: ${bankText(bank)}`)
  return {
    id: event?.id,
    open: span.open,
    statusLabel: span.open ? 'กำลังเกิดเหตุการณ์' : 'จบแล้ว',
    startText: span.startText,
    endText: span.endText,
    duration: span.duration,
    closeText: closeReasonText(event?.close_reason),
    reasonLines: reason.lines,
    reasonMore: reason.more,
    peaks,
    stationsCount: Number(event?.stations_count) || 0,
    readingsCount: Number(event?.readings_count) || 0,
    warningsCount: Number(event?.warnings_count) || 0,
  }
}

// ─────────────────────────── กราฟเส้นเล็ก ───────────────────────────

// points: [{ t: ms, v: number }] เรียงเวลา · gapMs: ช่องว่างที่ยาวกว่านี้ตัดเส้น (ไม่ลากข้ามช่วงที่ไม่มีค่า)
// คืน { paths: ['M..L..'], dots: [{x,y}] (จุดโดดที่ไม่มีเพื่อนบ้าน), min, max, t0, t1 } หรือ null ถ้าไม่มีจุดเลย
export function sparkline(points, { width = 240, height = 64, pad = 4, gapMs = Infinity, baseline = null } = {}) {
  const pts = (points || []).filter(p => p && Number.isFinite(p.t) && Number.isFinite(p.v))
  if (pts.length === 0) return null
  let min = Math.min(...pts.map(p => p.v))
  let max = Math.max(...pts.map(p => p.v))
  const dataMin = min
  const dataMax = max
  if (baseline !== null) min = Math.min(min, baseline)
  // ค่าคงที่ตลอด: ไม่มีฐานอ้างอิง = วาดเส้นกลางกรอบ (ไม่ให้ดูเหมือนเส้นขอบล่าง) · มีฐาน (ฝน) = เส้นอยู่ฐาน
  if (max === min) { if (baseline === null) { min -= 1; max += 1 } else { max = min + 1 } }
  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const spanT = t1 - t0
  const x = (t) => (spanT === 0 ? width / 2 : pad + ((t - t0) / spanT) * (width - 2 * pad))
  const y = (v) => height - pad - ((v - min) / (max - min)) * (height - 2 * pad)
  const round = (n) => Math.round(n * 10) / 10

  const segments = []
  let current = []
  for (const p of pts) {
    const last = current[current.length - 1]
    if (last && p.t - last.t > gapMs) { segments.push(current); current = [] }
    current.push(p)
  }
  segments.push(current)

  const paths = []
  const dots = []
  for (const seg of segments) {
    if (seg.length === 1) { dots.push({ x: round(x(seg[0].t)), y: round(y(seg[0].v)) }); continue }
    paths.push(seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(x(p.t))} ${round(y(p.v))}`).join(' '))
  }
  return { paths, dots, min: dataMin, max: dataMax, t0, t1, segments: segments.length }
}

// ─────────────────────────── รายละเอียดรายสถานี ───────────────────────────

function readingMs(r) {
  return toMs(r?.t)
}

// ช่วงที่สถานีไม่ส่งค่า (ห่างกันเกินเกณฑ์) — ใช้เกณฑ์ความสดเดียวกับหน้าสาธารณะ (สถานี 3 ชม. · อ่างรายวัน 48 ชม.)
export function stationGaps(readings, thresholdHours, { now = null } = {}) {
  const gaps = []
  const times = (readings || []).map(readingMs).filter(t => t !== null).sort((a, b) => a - b)
  const limit = thresholdHours * HOUR_MS
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > limit) gaps.push({ from: times[i - 1], to: times[i] })
  }
  // เหตุการณ์ยังเปิดอยู่: ค่าล่าสุดเก่าเกินเกณฑ์ = สถานีเงียบอยู่ตอนนี้
  if (now !== null && times.length > 0) {
    const nowMs = toMs(now)
    if (nowMs - times[times.length - 1] > limit) gaps.push({ from: times[times.length - 1], to: nowMs, ongoing: true })
  }
  return gaps
}

export function gapText(gap) {
  const span = durationText(gap.to - gap.from)
  if (gap.ongoing) return `ไม่มีค่าใหม่ตั้งแต่ ${thaiDateTime(gap.from)} (${span})`
  return `ไม่มีค่าช่วง ${thaiDateTime(gap.from)} – ${thaiDateTime(gap.to)} (${span})`
}

// รายงานที่ตัวเลขซ้ำเดิมติดกันยาวสุดกี่ครั้ง — ใช้กับอ่างเท่านั้น (ฝน 0 มม. ซ้ำหลายชั่วโมงเป็นเรื่องปกติ)
export function longestSameRun(readings, keys) {
  let best = 0
  let run = 0
  let prev = null
  for (const r of readings || []) {
    const sig = keys.map(k => (toNum(r?.[k]) === null ? '–' : String(toNum(r[k])))).join('|')
    if (sig === keys.map(() => '–').join('|')) { run = 0; prev = null; continue }
    run = sig === prev ? run + 1 : 1
    prev = sig
    best = Math.max(best, run)
  }
  return best
}

function maxBy(readings, key) {
  let best = null
  for (const r of readings) {
    const v = toNum(r?.[key])
    if (v === null) continue
    if (best === null || v > best.v) best = { v, t: r.t }
  }
  return best
}

function minBy(readings, key) {
  let best = null
  for (const r of readings) {
    const v = toNum(r?.[key])
    if (v === null) continue
    if (best === null || v < best.v) best = { v, t: r.t }
  }
  return best
}

function lastOf(readings, key) {
  for (let i = readings.length - 1; i >= 0; i--) {
    const v = toNum(readings[i]?.[key])
    if (v !== null) return { v, t: readings[i].t }
  }
  return null
}

function seriesOf(readings, key) {
  return readings
    .map(r => ({ t: readingMs(r), v: toNum(r?.[key]) }))
    .filter(p => p.t !== null && p.v !== null)
    .sort((a, b) => a.t - b.t)
}

// สรุปรายสถานีของเหตุการณ์หนึ่ง — เรียงฝน → ระดับน้ำ → อ่าง → สถานีเตือนภัย
// คืนโครง { key, type, typeLabel, name, code, readingsCount, headline, lines[], notes[], gaps[], chart, hasValue,
//          brief: { metric, peakText, peakAt, lastText } }  (brief = รูปย่อ 1 แถวต่อสถานี ใช้กับใบพิมพ์ A4 · ว่าง = ไม่มีค่า ไม่ใช่ 0)
export function stationSummaries(stations, { now = null, open = false } = {}) {
  const list = Array.isArray(stations) ? stations : []
  const out = list.map((s) => {
    const readings = (Array.isArray(s?.readings) ? s.readings : []).filter(r => readingMs(r) !== null)
      .slice().sort((a, b) => readingMs(a) - readingMs(b))
    const type = s?.station_type
    const summary = {
      key: `${type}:${s?.station_code}`,
      type,
      typeLabel: TYPE_LABEL[type] ?? 'สถานี',
      name: s?.station_name || s?.station_code || 'ไม่ทราบชื่อสถานี',
      code: s?.station_code ?? '',
      readingsCount: readings.length,
      headline: '',
      lines: [],
      notes: [],
      gaps: [],
      chart: null,
      chartLabel: '',
      hasValue: false,
      brief: { metric: '', peakText: '', peakAt: '', lastText: '', flags: [] },
    }
    const thresholdHours = type === 'dam' ? DAM_STALE_HOURS : STATION_STALE_HOURS
    const gapList = stationGaps(readings, thresholdHours, { now: open ? now : null })
    summary.gaps = gapList.map(gapText)

    if (type === 'rain') {
      const peak = maxBy(readings, 'rain_24h')
      const hourly = maxBy(readings, 'rain_1h')
      if (peak) {
        const level = rainLevel(peak.v)
        summary.headline = `ฝนสะสม 24 ชม. สูงสุด ${formatMm(peak.v)} มม.${level ? ` (${level.label})` : ''}`
        summary.lines.push(`เมื่อ ${thaiDateTime(peak.t)}`)
        summary.brief.peakText = `${formatMm(peak.v)} มม.${level ? ` (${level.label})` : ''}`
        summary.brief.peakAt = thaiDateTime(peak.t)
      } else {
        summary.headline = 'ไม่มีค่าฝนที่วัดได้'
      }
      if (hourly) summary.lines.push(`ฝนรายชั่วโมงสูงสุด ${formatMm(hourly.v)} มม.`)
      const last = lastOf(readings, 'rain_24h')
      if (last && peak && last.t !== peak.t) {
        summary.lines.push(`ค่าล่าสุดที่จด ${formatMm(last.v)} มม. (${thaiDateTime(last.t)})`)
        summary.brief.lastText = `${formatMm(last.v)} มม. (${thaiDateTime(last.t)})`
      }
      summary.brief.metric = 'ฝนสะสม 24 ชม.'
      summary.chart = seriesOf(readings, 'rain_24h')
      summary.chartLabel = 'ฝนสะสม 24 ชม. (มม.)'
      summary.baseline = 0
    } else if (type === 'waterlevel') {
      const closest = minBy(readings, 'bank_diff')
      const high = maxBy(readings, 'level_msl')
      if (closest) {
        summary.headline = `ใกล้ตลิ่งที่สุด: ${bankText(closest.v)}`
        summary.lines.push(`เมื่อ ${thaiDateTime(closest.t)}`)
        summary.brief.peakText = bankText(closest.v)
        summary.brief.peakAt = thaiDateTime(closest.t)
      } else if (high) {
        summary.headline = `ระดับน้ำสูงสุด ${high.v.toFixed(2)} ม.รทก.`
        summary.brief.peakText = `${high.v.toFixed(2)} ม.รทก.`
        summary.brief.peakAt = thaiDateTime(high.t)
      } else {
        summary.headline = 'ไม่มีค่าระดับน้ำที่วัดได้'
      }
      if (high) summary.lines.push(`ระดับน้ำสูงสุด ${high.v.toFixed(2)} ม.รทก. (${thaiDateTime(high.t)})`)
      const last = lastOf(readings, 'bank_diff')
      if (last && closest && last.t !== closest.t) {
        summary.lines.push(`ค่าล่าสุดที่จด: ${bankText(last.v)} (${thaiDateTime(last.t)})`)
        summary.brief.lastText = `${bankText(last.v)} (${thaiDateTime(last.t)})`
      }
      summary.brief.metric = closest ? 'ระดับน้ำเทียบตลิ่ง (ใกล้ตลิ่งสุด)' : 'ระดับน้ำ'
      summary.chart = seriesOf(readings, 'level_msl')
      summary.chartLabel = 'ระดับน้ำ (ม.รทก.)'
    } else if (type === 'dam') {
      const peak = maxBy(readings, 'storage_pct')
      if (peak) {
        const level = damLevel(peak.v)
        summary.headline = `ปริมาณน้ำสูงสุด ${formatMcm(peak.v)}% ของความจุเก็บกัก${level ? ` (${level.label})` : ''}`
        summary.lines.push(`เมื่อ ${thaiDay(peak.t)}`)
        summary.brief.peakText = `${formatMcm(peak.v)}% ของความจุเก็บกัก${level ? ` (${level.label})` : ''}`
        summary.brief.peakAt = thaiDay(peak.t)
        if (peak.v > 100) {
          summary.notes.push('มากกว่า 100% = เกินความจุที่ระดับเก็บกักปกติ ตามที่ต้นทางรายงาน')
          summary.brief.flags.push('>100% = เกินความจุที่ระดับเก็บกักปกติ')
        }
      } else {
        summary.headline = 'ไม่มีค่าปริมาณน้ำที่วัดได้'
      }
      const volume = maxBy(readings, 'dam_storage')
      if (volume) summary.lines.push(`ปริมาตรสูงสุด ${formatMcm(volume.v)} ล้าน ลบ.ม.`)
      const inflow = maxBy(readings, 'dam_inflow')
      if (inflow) summary.lines.push(`ไหลเข้าสูงสุด ${formatMcm(inflow.v)} ล้าน ลบ.ม.`)
      const released = maxBy(readings, 'dam_released')
      if (released) summary.lines.push(`ระบายสูงสุด ${formatMcm(released.v)} ล้าน ลบ.ม.`)
      const volumeKeys = ['dam_storage', 'dam_inflow', 'dam_released']
      const same = longestSameRun(readings, volumeKeys.some(k => readings.some(r => toNum(r?.[k]) !== null)) ? volumeKeys : ['storage_pct'])
      if (same >= DAM_SAME_MIN_REPORTS) {
        summary.notes.push(`ตัวเลขชุดนี้ซ้ำเดิม ${same} รายงานติดกัน — ต้นทางอาจค้าง`)
        summary.brief.flags.push(`ตัวเลขซ้ำเดิม ${same} รายงาน`)
      }
      summary.brief.metric = 'ปริมาณน้ำในอ่าง'
      summary.chart = seriesOf(readings, 'storage_pct')
      summary.chartLabel = 'ปริมาณน้ำ (% ของความจุเก็บกัก)'
    } else if (type === 'ews') {
      const peak = maxBy(readings, 'sit_level')
      if (peak) {
        const row = readings.find(r => toNum(r?.sit_level) === peak.v && r.sit_text)
        summary.headline = `ระดับเตือนภัยสูงสุด ${peak.v}${row?.sit_text ? ` (${row.sit_text})` : ''}`
        summary.lines.push(`เมื่อ ${thaiDateTime(peak.t)}`)
        summary.brief.peakText = `ระดับ ${peak.v}${row?.sit_text ? ` (${row.sit_text})` : ''}`
        summary.brief.peakAt = thaiDateTime(peak.t)
      } else {
        summary.headline = 'ไม่มีค่าระดับเตือนภัยที่วัดได้'
      }
      summary.brief.metric = 'ระดับเตือนภัย'
    } else {
      summary.headline = 'ชนิดสถานีที่ไม่รู้จัก'
    }
    // hasValue = มีค่าที่วัดได้จริงของตัวชี้วัดหลักของสถานีนี้ (ใบพิมพ์ใช้แยกสถานีที่ไม่มีค่าไปรวมเป็นบรรทัดเดียว ไม่เขียนเป็นแถวว่าง)
    summary.hasValue = type === 'rain' ? maxBy(readings, 'rain_24h') !== null
      : type === 'waterlevel' ? (minBy(readings, 'bank_diff') ?? maxBy(readings, 'level_msl')) !== null
        : type === 'dam' ? maxBy(readings, 'storage_pct') !== null
          : type === 'ews' ? maxBy(readings, 'sit_level') !== null
            : false
    if (summary.chart && summary.chart.length < 2) summary.chart = null
    return summary
  })
  return out.sort((a, b) => {
    const ta = TYPE_ORDER.indexOf(a.type)
    const tb = TYPE_ORDER.indexOf(b.type)
    return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb) || a.name.localeCompare(b.name, 'th')
  })
}

// ความถี่ของจุดข้อมูลเพื่อกำหนดช่องว่างที่ตัดเส้นกราฟ — สถานี 3 ชม. · อ่าง 48 ชม.
export function chartGapMs(type) {
  return (type === 'dam' ? DAM_STALE_HOURS : STATION_STALE_HOURS) * HOUR_MS
}

// ข้อความเตือนที่คัดลอกมาตามต้นฉบับ (เรียงเก่า → ใหม่) — ไม่ตัดแต่ง ไม่แปลความ
export function warningRows(warnings) {
  return (Array.isArray(warnings) ? warnings : [])
    .filter(w => w && typeof w.message === 'string' && w.message.trim() !== '')
    .map(w => ({
      issuedText: thaiDateTime(w.issued_at),
      message: w.message,
      source: [w.station_name, w.tambon_name].filter(Boolean).join(' · '),
    }))
}
