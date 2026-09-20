import { normalizeStations } from '../src/lib/pm25.js'

const SOURCE = 'https://air4thai.pcd.go.th/services/getNewAQI_JSON.php'
const CACHE_KEY = 'https://smartlocal.ntocom.workers.dev/api/air-quality-cache-v1'
const FRESH_MS = 10 * 60 * 1000
const RETAIN_MS = 24 * 60 * 60 * 1000
let pending = null

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
}

// Fixed upstream and cache key: no query-driven SSRF, no per-tenant duplicate upstream fetches.
// Cache API is already available on Workers Free; no KV, database or paid service required.
export async function airQualityResponse(request, { cache = globalThis.caches?.default, fetcher = fetch, now = Date.now() } = {}) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } })
  let cached = null
  try {
    const hit = await cache?.match(CACHE_KEY)
    if (hit) cached = await hit.json()
  } catch { /* Cache failure must not prevent a fresh upstream read. */ }
  const age = cached ? now - Date.parse(cached.fetchedAt) : Infinity
  if (age >= 0 && age < FRESH_MS) return json({ ...cached, refreshFailed: false })
  try {
    if (!pending) {
      pending = (async () => {
        // Workers accepts only follow/manual. Reject redirects via !response.ok below
        // so upstream cannot redirect this fixed-source proxy to an arbitrary host.
        const response = await fetcher(SOURCE, { signal: AbortSignal.timeout(12000), redirect: 'manual', headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error('Air4Thai unavailable')
        if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('Response too large')
        const text = await response.text()
        if (text.length > 2_000_000) throw new Error('Response too large')
        const stations = normalizeStations(JSON.parse(text))
        if (!stations.length) throw new Error('Empty station feed')
        const data = { source: 'Air4Thai', fetchedAt: new Date(now).toISOString(), stations }
        try { await cache?.put(CACHE_KEY, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } })) } catch { /* Still serve verified upstream data. */ }
        return data
      })()
    }
    return json({ ...await pending, refreshFailed: false })
  } catch (error) {
    console.error('Air4Thai fetch failed:', error.name, error.message)
    if (cached && age >= 0 && age < RETAIN_MS) return json({ ...cached, refreshFailed: true })
    return json({ error: 'AIR4THAI_UNAVAILABLE' }, 503)
  } finally { pending = null }
}
