import { HYDRO_STATIONS, normalizeHydro, thaiDay } from '../src/lib/hydroHourly.js'
const HOUR = 3600000
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store', 'X-Content-Type-Options': 'nosniff' } })
export async function hydroHourlyResponse(request, { fetcher = fetch, cache = globalThis.caches?.default, now = Date.now() } = {}) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  const code = new URL(request.url).searchParams.get('station')
  if (!Object.hasOwn(HYDRO_STATIONS, code || '')) return reply({ error: 'INVALID_STATION' }, 400)
  // One canonical key per station across tenants, no user-supplied upstream URL.
  const key = `https://smartlocal.ntocom.workers.dev/api/hydro-hourly-v1/${code}`
  let saved
  try { const hit = await cache?.match(key); if (hit) saved = await hit.json() } catch { /* cache is best effort */ }
  const age = now - Date.parse(saved?.fetchedAt)
  if (saved && age >= 0 && age < HOUR) return reply({ ...saved, refreshFailed: false })
  try {
    const params = new URLSearchParams({ station01: code, datestart: thaiDay(now - 72 * HOUR), dateend: thaiDay(now), callback: 'hydroReport' })
    const response = await fetcher(`https://hydro1.ddns.net/main/information_6/water_today_search_json.php?${params}`, { signal: AbortSignal.timeout(10000), redirect: 'error' })
    if (!response.ok || Number(response.headers.get('content-length')) > 1000000) throw new Error('Upstream unavailable')
    const raw = await response.text()
    if (raw.length > 1000000) throw new Error('Report too large')
    // Parse JSONP as data only. Never execute upstream JavaScript.
    const match = raw.replace(/^\uFEFF/, '').trim().match(/^hydroReport\(([\s\S]*)\);?$/)
    if (!match) throw new Error('Invalid wrapper')
    const points = normalizeHydro(JSON.parse(match[1]), code, now)
    if (!points.length) throw new Error('Empty report')
    const body = { station: code, points, fetchedAt: new Date(now).toISOString() }
    try { await cache?.put(key, Response.json(body, { headers: { 'Cache-Control': 'public, max-age=86400' } })) } catch { /* keep usable response */ }
    return reply({ ...body, refreshFailed: false })
  } catch {
    if (saved && age >= 0 && age < 24 * HOUR) return reply({ ...saved, refreshFailed: true })
    return reply({ error: 'HYDRO_UNAVAILABLE' }, 503)
  }
}
