// Air4Thai PM25 values are rolling 24-hour means; never mix with model/current-hour data.
export const AIR4THAI_URL = 'https://air4thai.pcd.go.th/webV3/#/Home'
export const PM25_STALE_MS = 3 * 60 * 60 * 1000
export const PM25_LEVELS = [
  { max: 15, label: 'ดีมาก', color: '#1685ac', fill: '#e5f5fc', range: '0–15' },
  { max: 25, label: 'ดี', color: '#4a792c', fill: '#edf6e6', range: '15.1–25' },
  { max: 37.5, label: 'ปานกลาง', color: '#997300', fill: '#fff7d5', range: '25.1–37.5' },
  { max: 75, label: 'เริ่มมีผลกระทบต่อสุขภาพ', color: '#b95c17', fill: '#fff0e4', range: '37.6–75' },
  { max: Infinity, label: 'มีผลกระทบต่อสุขภาพ', color: '#bb354b', fill: '#fdecef', range: '75.1 ขึ้นไป' },
]
export function nonnegative(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}
function coordinate(value, limit) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null
}
export function measurementTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}(:\d{2})?$/.test(time || '')) return null
  const text = `${date}T${time.length === 5 ? `${time}:00` : time}+07:00`
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) return null
  // Reject impossible calendar dates, which Date.parse otherwise silently rolls over.
  if (new Date(ms + 7 * 3600000).toISOString().slice(0, 19) !== text.slice(0, 19)) return null
  return new Date(ms).toISOString()
}
export function normalizeStations(payload) {
  if (!Array.isArray(payload?.stations) || payload.stations.length > 2000) throw new Error('Invalid Air4Thai response')
  const seen = new Set()
  return payload.stations.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const id = String(raw.stationID ?? '')
    if (!/^[a-zA-Z0-9_-]{1,30}$/.test(id) || seen.has(id)) return []
    seen.add(id)
    const last = raw.AQILast || {}
    const area = String(raw.areaTH ?? '').slice(0, 200)
    return [{ id, name: String(raw.nameTH || id).slice(0, 200), area,
      province: area.includes(',') ? area.split(',').pop().trim() : '',
      lat: coordinate(raw.lat, 90), lon: coordinate(raw.long, 180),
      pm25: nonnegative(last.PM25?.value), aqi: nonnegative(last.AQI?.aqi),
      aqiPollutant: String(last.AQI?.param ?? '').slice(0, 20),
      measuredAt: measurementTime(last.date, last.time) }]
  })
}
export function isFresh(station, now = Date.now()) {
  const measured = Date.parse(station?.measuredAt)
  return Number.isFinite(measured) && now - measured >= -10 * 60000 && now - measured < PM25_STALE_MS
}
export function pm25Level(value) {
  const n = nonnegative(value)
  return n === null ? null : PM25_LEVELS.find(level => n <= level.max)
}
export function distanceKm(lat, lon, station) {
  const a = coordinate(lat, 90), b = coordinate(lon, 180)
  if (a === null || b === null || station.lat === null || station.lon === null) return null
  const rad = n => n * Math.PI / 180
  const h = Math.sin(rad(station.lat - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(station.lat)) * Math.sin(rad(station.lon - b) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}
export function nearbyStations(stations, tenant) {
  const province = String(tenant?.province ?? '').replace(/^จังหวัด\s*/, '').trim()
  const all = stations.map(s => ({ ...s, distance: distanceKm(tenant?.latitude, tenant?.longitude, s) }))
  const local = province ? all.filter(s => s.province === province) : []
  const pool = local.length ? local : all.filter(s => s.distance !== null && s.distance <= 150)
  return { inProvince: local.length > 0, stations: pool.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name, 'th')).slice(0, 8) }
}
export function formatMeasuredAt(value) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(time) + ' น.' : 'ไม่ทราบเวลาตรวจวัด'
}
