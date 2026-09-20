import { distanceKm } from '../src/lib/pm25.js'
import { normalizeHistory, normalizeLocation, normalizeTambons, thaiDate, validCoordinates } from '../src/lib/pm25Details.js'

const TEN_MINUTES = 600000
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store', 'X-Content-Type-Options': 'nosniff' } })

async function upstream(url, fetcher, signal = AbortSignal.timeout(8000)) {
  const response = await fetcher(url, { redirect: 'manual', signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('Upstream unavailable')
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('Response too large')
  return JSON.parse(text)
}

// This GISTDA endpoint labels longitude as lat and latitude as lng.
// Verify both corners against Thailand before accepting its bounding-box midpoint.
export function bboxCenter(payload) {
  const b = payload?.data?.[0]
  if (!b || !validCoordinates(b.minlng, b.minlat) || !validCoordinates(b.maxlng, b.maxlat)) return null
  if (Number(b.minlng) > Number(b.maxlng) || Number(b.minlat) > Number(b.maxlat)) return null
  return { lat: (Number(b.minlng) + Number(b.maxlng)) / 2, lon: (Number(b.minlat) + Number(b.maxlat)) / 2 }
}

async function districtCenters(rows, districtId, fetcher, cache, now) {
  const key = `https://smartlocal.ntocom.workers.dev/api/pm25-centers-v1/${districtId}`
  let saved = {}
  try { const hit = await cache?.match(key); if (hit) { const body = await hit.json(); if (now - body.savedAt >= 0 && now - body.savedAt < 7 * 86400000) saved = body.centers } } catch { /* Read upstream. */ }
  const centers = { ...saved }
  // Bound concurrent requests and total subrequests within the free Worker limit.
  const missing = rows.filter(t => !validCoordinates(centers[t.id]?.lat, centers[t.id]?.lon)).slice(0, 40)
  const signal = AbortSignal.timeout(4000)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (cursor < missing.length && !signal.aborted) {
      const row = missing[cursor++]
      try { const point = bboxCenter(await upstream(`https://pm25.gistda.or.th/rest/getbbox?id=${row.id}`, fetcher, signal)); if (point) centers[row.id] = point } catch { /* Missing coordinates must not hide PM2.5 readings. */ }
    }
  }))
  if (missing.length) try { await cache?.put(key, Response.json({ savedAt: now, centers }, { headers: { 'Cache-Control': 'public, max-age=604800' } })) } catch { /* No persistent storage required. */ }
  return centers
}

// Parameter allowlists and canonical cache keys prevent arbitrary proxy targets.
// No scheduled job, storage binding or paid API is required.
export async function pm25DetailsResponse(request, { fetcher = fetch, cache = globalThis.caches?.default, now = Date.now() } = {}) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  const url = new URL(request.url)
  const kind = url.searchParams.get('kind')
  const station = url.searchParams.get('station')
  const lat = url.searchParams.get('lat'), lon = url.searchParams.get('lon')
  if ((kind === 'history' && !/^[a-zA-Z0-9_-]{1,30}$/.test(station || '')) || (kind === 'area' && !validCoordinates(lat, lon)) || !['history', 'area'].includes(kind)) return reply({ error: 'INVALID_PARAMETERS' }, 400)
  const location = kind === 'area' ? `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}` : ''
  const key = `https://smartlocal.ntocom.workers.dev/api/pm25-details-v2/${kind}/${kind === 'history' ? station : location}`
  let cached
  try { const hit = await cache?.match(key); if (hit) cached = await hit.json() } catch { /* Read upstream if cache is unavailable. */ }
  const age = now - Date.parse(cached?.fetchedAt)
  if (cached && age >= 0 && age < TEN_MINUTES) return reply({ ...cached, refreshFailed: false })
  try {
    let result
    if (kind === 'history') {
      const params = new URLSearchParams({ stationID: station, param: 'PM25', type: 'hr', sdate: thaiDate(now - 6 * 86400000), edate: thaiDate(now), stime: '00', etime: '23' })
      const data = await upstream(`https://air4thai.com/forweb/getHistoryData.php?${params}`, fetcher)
      result = { source: 'Air4Thai', stationId: station, points: normalizeHistory(data, station, now) }
    } else {
      const [latitude, longitude] = location.split(',')
      const data = await upstream(`https://pm25.gistda.or.th/rest/getPm25byLocation?lat=${latitude}&lng=${longitude}`, fetcher)
      const area = normalizeLocation(data)
      const tambons = await upstream(`https://pm25.gistda.or.th/rest/getPm25byTambon?ap_idn=${area.districtId}`, fetcher)
      const rows = normalizeTambons(tambons, area.districtId)
      const centers = await districtCenters(rows, area.districtId, fetcher, cache, now)
      result = { source: 'GISTDA', area, tambons: rows.map(t => ({ ...t, distanceKm: validCoordinates(centers[t.id]?.lat, centers[t.id]?.lon) ? distanceKm(latitude, longitude, centers[t.id]) : null })) }
    }
    const body = { ...result, fetchedAt: new Date(now).toISOString() }
    try { await cache?.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } })) } catch { /* Data remains usable without cache. */ }
    return reply({ ...body, refreshFailed: false })
  } catch {
    if (cached && age >= 0 && age < 86400000) return reply({ ...cached, refreshFailed: true })
    return reply({ error: 'PM25_DETAILS_UNAVAILABLE' }, 503)
  }
}
