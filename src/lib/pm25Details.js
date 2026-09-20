import { measurementTime, nonnegative } from './pm25.js'

const HOUR = 3600000
const DAY = 24 * HOUR
export const thaiDate = ms => new Date(ms + 7 * HOUR).toISOString().slice(0, 10)
export const validCoordinates = (lat, lon) => lat !== null && lat !== undefined && lat !== '' && lon !== null && lon !== undefined && lon !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Number(lat) >= 5 && Number(lat) <= 21 && Number(lon) >= 97 && Number(lon) <= 106

export function normalizeHistory(payload, stationId, now = Date.now()) {
  const station = payload?.stations?.find(s => s.stationID === stationId)
  if (payload?.result !== 'OK' || !Array.isArray(station?.data) || station.data.length > 500) throw new Error('Invalid station history')
  const values = new Map()
  for (const row of station.data) {
    const parts = /^([0-9-]{10}) ([0-9:]{8})$/.exec(row.DATETIMEDATA || '')
    const at = parts ? measurementTime(parts[1], parts[2]) : null
    const time = Date.parse(at)
    if (!Number.isFinite(time) || time > now || time < now - 9 * DAY || time % HOUR !== 0) continue
    // Duplicate timestamps are ambiguous; do not silently choose a value.
    values.set(time, values.has(time) ? null : nonnegative(row.PM25))
  }
  return [...values].sort(([a], [b]) => a - b).map(([time, value]) => ({ time, value }))
}

export function historySummary(points, now = Date.now()) {
  const valid = points.filter(p => Number.isFinite(p.time) && p.time <= now && nonnegative(p.value) !== null)
  const latest = valid.length ? Math.max(...valid.map(p => p.time)) : null
  const values = new Map(points.map(p => [p.time, nonnegative(p.value)]))
  const end = Math.floor(now / HOUR) * HOUR
  const hourly = Array.from({ length: 24 }, (_, i) => ({ time: end - (23 - i) * HOUR, value: values.get(end - (23 - i) * HOUR) ?? null }))
  const todayStart = Date.parse(`${thaiDate(now)}T00:00:00+07:00`)
  const mean = times => {
    const samples = times.map(t => values.get(t))
    const count = samples.filter(v => v !== null && v !== undefined).length
    return { value: count === times.length && count > 0 ? samples.reduce((a, b) => a + b, 0) / count : null, count, expected: times.length }
  }
  const daily = Array.from({ length: 7 }, (_, i) => {
    const start = todayStart - (6 - i) * DAY
    const hours = i === 6 ? Math.max(0, Math.min(24, latest === null ? 0 : Math.floor((latest - start) / HOUR) + 1)) : 24
    return { time: start, ...mean(Array.from({ length: hours }, (_, j) => start + j * HOUR)), partial: i === 6 }
  })
  let comparison = null
  if (latest !== null && latest >= todayStart && now - latest < 3 * HOUR) {
    const hours = Math.floor((latest - todayStart) / HOUR) + 1
    const a = mean(Array.from({ length: hours }, (_, i) => todayStart + i * HOUR))
    const b = mean(Array.from({ length: hours }, (_, i) => todayStart - DAY + i * HOUR))
    if (a.value !== null && b.value !== null) comparison = { today: a.value, yesterday: b.value, difference: a.value - b.value, hours, through: latest }
  }
  return { hourly, daily, comparison, latest, stale: latest === null || now - latest >= 3 * HOUR }
}

// GISTDA currently serializes Thai wall time with a Z suffix. Determine the offset
// from its separate human-readable date/time, rather than blindly trusting that Z.
export function gistdaClock(raw, metadata) {
  const parts = /^(?:\w+ )?(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(metadata?.dateEng || '')
  const month = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(parts?.[2]) + 1
  if (!parts || !month) return null
  const clock = String(metadata?.timeEng || '').padStart(5, '0')
  const reference = measurementTime(`${parts[3]}-${String(month).padStart(2, '0')}-${parts[1].padStart(2, '0')}`, clock)
  const source = Date.parse(raw)
  if (!reference || !Number.isFinite(source)) return null
  const delta = source - Date.parse(reference)
  if (delta !== 0 && delta !== 7 * HOUR) return null
  return { offset: delta, reference }
}
export function normalizeLocation(payload) {
  const d = payload?.data
  if (payload?.status !== 200 || !d?.loc || !/^\d{4}$/.test(String(d.loc.ap_idn)) || !/^\d{6}$/.test(String(d.loc.tb_idn))) throw new Error('Invalid GISTDA location')
  const last = d.graphHistory24hrs?.at(-1)
  const clock = gistdaClock(last?.[1], d.datetimeEng)
  return { districtId: String(d.loc.ap_idn), subdistrictId: String(d.loc.tb_idn),
    district: String(d.loc.ap_tn || '').slice(0, 100), province: String(d.loc.pv_tn || '').slice(0, 100),
    subdistrict: String(d.loc.tb_tn || '').slice(0, 100), measuredAt: clock?.reference || null }
}
export function normalizeTambons(payload, districtId) {
  if (payload?.status !== 200 || !Array.isArray(payload.data) || payload.data.length > 100) throw new Error('Invalid GISTDA subdistricts')
  const clock = gistdaClock(payload.data[0]?.dt, payload.datetimeEng)
  const seen = new Set()
  return payload.data.flatMap(row => {
    const id = String(row.tb_idn)
    if (!/^\d{6}$/.test(id) || !id.startsWith(districtId) || seen.has(id)) return []
    seen.add(id)
    const time = Date.parse(row.dt)
    return [{ id, name: String(row.tb_tn || id).slice(0, 100), hourly: nonnegative(row.pm25), average24: nonnegative(row.pm25Avg24hr),
      measuredAt: clock && Number.isFinite(time) ? new Date(time - clock.offset).toISOString() : null }]
  }).sort((a, b) => a.name.localeCompare(b.name, 'th'))
}
