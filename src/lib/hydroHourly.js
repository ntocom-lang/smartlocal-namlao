// Hydro-1 public hourly report, verified 2026-09-23. Gauge readings must never
// be written to ThaiWater waterlevel_msl: the vertical reference differs.
export const HYDRO_SOURCE = 'https://www.hydro-1.net/Data/HD-04/houly/water_today_search.php'
export const HYDRO_STATIONS = {
  'Y.20': { name: 'บ้านห้วยสัก', river: 'แม่น้ำยม', tambon: 'เตาปูน', district: 'สอง', province: 'แพร่' },
  'Y.38': { name: 'บ้านแม่คำมีตำหนักธรรม', river: 'น้ำแม่คำมี', tambon: 'ตำหนักธรรม', district: 'หนองม่วงไข่', province: 'แพร่' },
}
// Explicit tenant selection; proximity alone does not establish a flood pathway.
export const HYDRO_TENANTS = {
  thungkaew: { station: 'Y.20', label: 'สถานีเฝ้าระวังที่ทุ่งแค้วติดตาม', note: 'ติดตามแม่น้ำยมที่บ้านห้วยสัก ควบคู่กับระดับน้ำหนองม่วงไข่และฝนในพื้นที่', scope: 'สถานีเฝ้าระวังนอกพื้นที่' },
  tamnaktham: { station: 'Y.38', label: 'ระดับน้ำรายชั่วโมงในตำบล', note: 'สถานีบ้านแม่คำมีตำหนักธรรม วัดน้ำแม่คำมีในตำบล ใช้คู่กับฝนและประกาศในพื้นที่', scope: 'สถานีในตำบลตำหนักธรรม' },
  namlao: { station: 'Y.38', label: 'ระดับน้ำรายชั่วโมงประกอบการติดตาม', note: 'สถานีอยู่ตำบลตำหนักธรรม ใช้เป็นข้อมูลประกอบ ส่วนข้อมูลหลักของน้ำเลาคือฝนและอ่างแม่คำปอง–แม่ถาง', scope: 'ข้อมูลประกอบนอกพื้นที่' },
  demo: { station: 'Y.20', label: 'ตัวอย่างรายงานระดับน้ำรายชั่วโมง', note: 'ข้อมูลจริงจากบ้านห้วยสัก ใช้สาธิตรูปแบบ ไม่ใช่สถานีในตำบลสาธิต', scope: 'ข้อมูลสถานีจริงสำหรับสาธิต' },
}
export const thaiDay = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 10)
export const hydroDate = value => new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
const months = 'มกราคม กุมภาพันธ์ มีนาคม เมษายน พฤษภาคม มิถุนายน กรกฎาคม สิงหาคม กันยายน ตุลาคม พฤศจิกายน ธันวาคม'.split(' ')
export function hydroTimestamp(date, time) {
  const d = String(date).trim().match(/^วันที่\s+(\d{1,2})\s+(\S+)\s+(\d{4})$/)
  const t = String(time).trim().match(/^(\d{1,2})[.:](\d{2})\s*น\.$/)
  if (!d || !t) return null
  const year = Number(d[3]) - 543, month = months.indexOf(d[2]), day = Number(d[1]), hour = Number(t[1]), minute = Number(t[2])
  if (year < 2000 || month < 0 || day < 1 || hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null
  const base = Date.UTC(year, month, day)
  if (new Date(base).getUTCMonth() !== month) return null
  return base + (hour - 7) * 3600000 + minute * 60000
}
const numeric = value => typeof value === 'number' || typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) ? (Number.isFinite(Number(value)) ? Number(value) : null) : null
export function normalizeHydro(raw, code, now) {
  const station = HYDRO_STATIONS[code]
  if (!station || !Array.isArray(raw) || raw.length > 2000) throw new Error('Invalid report')
  const points = new Map()
  for (const row of raw) {
    if (row.station_name !== station.name || row.water_name !== station.river || row.address1 !== station.tambon || row.address2 !== station.district || row.address3 !== station.province) throw new Error('Station mismatch')
    const at = hydroTimestamp(row.date, row.time), level = numeric(row.level), discharge = numeric(row.dischg)
    if (at === null || at > now || at < now - 96 * 3600000) continue
    // Keep missing samples to break chart lines. Zero is a measured value.
    points.set(at, { at, level: level !== null && level >= -20 && level <= 100 ? level : null, discharge: discharge !== null && discharge >= 0 && discharge <= 100000 ? discharge : null })
  }
  return [...points.values()].sort((a, b) => a.at - b.at)
}
export function hydroSummary(report, now = Date.now()) {
  const points = (report?.points || []).filter(p => p.at <= now)
  const latest = points.at(-1)
  const stale = !latest || now - latest.at > 3 * 3600000 || report.refreshFailed || now - Date.parse(report.fetchedAt) > 2 * 3600000
  const delta = hours => {
    const prior = latest && points.find(p => p.at === latest.at - hours * 3600000)
    return !stale && latest?.level != null && prior?.level != null ? Math.round((latest.level - prior.level) * 100) : null
  }
  return { latest, stale: Boolean(stale), one: delta(1), three: delta(3) }
}
export const deltaText = cm => cm === null ? 'ข้อมูลไม่พอเปรียบเทียบ' : cm === 0 ? 'ทรงตัว' : `${cm > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(cm)} ซม.`
export function hydroSegments(points) {
  const segments = []; let segment = []
  for (const p of points) {
    if (p.level === null || segment.length && p.at - segment.at(-1).at > 90 * 60000) { if (segment.length) segments.push(segment); segment = [] }
    if (p.level !== null) segment.push(p)
  }
  if (segment.length) segments.push(segment)
  return segments
}
