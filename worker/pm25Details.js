import { normalizeHistory, normalizeLocation, normalizeTambons, thaiDate, validCoordinates } from '../src/lib/pm25Details.js'

const TEN_MINUTES = 600000
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store', 'X-Content-Type-Options': 'nosniff' } })

async function upstream(url, fetcher) {
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('Upstream unavailable')
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('Response too large')
  return JSON.parse(text)
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
  const key = `https://smartlocal.ntocom.workers.dev/api/pm25-details-v1/${kind}/${kind === 'history' ? station : location}`
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
      result = { source: 'GISTDA', area, tambons: normalizeTambons(tambons, area.districtId) }
    }
    const body = { ...result, fetchedAt: new Date(now).toISOString() }
    try { await cache?.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } })) } catch { /* Data remains usable without cache. */ }
    return reply({ ...body, refreshFailed: false })
  } catch {
    if (cached && age >= 0 && age < 86400000) return reply({ ...cached, refreshFailed: true })
    return reply({ error: 'PM25_DETAILS_UNAVAILABLE' }, 503)
  }
}
