import assert from 'node:assert/strict'
import test from 'node:test'
import { measurementTime, nearbyStations, normalizeStations, pm25Level } from '../src/lib/pm25.js'
import { airQualityResponse } from '../worker/airQuality.js'

test('normalizes Air4Thai PM25 values and rejects missing/negative measurements', () => {
  const stations = normalizeStations({ stations: [
    { stationID: 'a1', nameTH: 'สถานี A', areaTH: 'ต.เมือง, แพร่', lat: '18', long: '100', AQILast: { date: '2026-09-20', time: '09:00', PM25: { value: '21.4' }, AQI: { aqi: '52', param: 'PM25' } } },
    { stationID: 'a2', nameTH: 'สถานี B', areaTH: 'ต.เมือง, แพร่', AQILast: { PM25: { value: '-1' } } },
  ] })
  assert.equal(stations[0].pm25, 21.4)
  assert.equal(stations[0].province, 'แพร่')
  assert.equal(stations[1].pm25, null)
  assert.equal(pm25Level(21.4).label, 'ดี')
})

test('does not silently accept rolled calendar dates', () => {
  assert.equal(measurementTime('2026-02-30', '09:00'), null)
  assert.match(measurementTime('2026-09-20', '09:00'), /^2026-09-20T02:00:00\.000Z$/)
})

test('prefers stations in the tenant province and caps the list', () => {
  const stations = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, province: i < 8 ? 'แพร่' : 'น่าน', lat: 18 + i / 100, lon: 100, pm25: 10, measuredAt: null }))
  const result = nearbyStations(stations, { province: 'แพร่', latitude: 18, longitude: 100 })
  assert.equal(result.inProvince, true)
  assert.equal(result.stations.length, 8)
})

test('Worker fetch succeeds with the supported manual redirect policy and reuses its cache', async () => {
  let cached, calls = 0
  const cache = { match: async () => cached?.clone(), put: async (_key, response) => { cached = response.clone() } }
  const request = new Request('https://example.test/api/air-quality')
  const now = Date.parse('2026-09-20T02:05:00Z')
  const fetcher = async (url, options) => {
    calls++
    assert.equal(url, 'https://air4thai.pcd.go.th/services/getNewAQI_JSON.php')
    assert.equal(options.redirect, 'manual', 'Cloudflare Workers does not implement redirect: error')
    return Response.json({ stations: [{ stationID: '69t', nameTH: 'สถานีทดสอบ', areaTH: 'ต.ทดสอบ, แพร่', lat: '18', long: '100', AQILast: { date: '2026-09-20', time: '09:00', PM25: { value: '8.5' } } }] })
  }
  const first = await airQualityResponse(request, { cache, fetcher, now })
  assert.equal(first.status, 200)
  assert.equal((await first.json()).stations[0].pm25, 8.5)
  const second = await airQualityResponse(request, { cache, fetcher, now: now + 60000 })
  assert.equal(second.status, 200)
  assert.equal(calls, 1)
})

test('Worker rejects upstream redirects without following them, and preserves dated fallback data', async () => {
  const request = new Request('https://example.test/api/air-quality')
  const now = Date.parse('2026-09-20T03:00:00Z')
  const fetcher = async (_url, options) => {
    assert.equal(options.redirect, 'manual')
    return new Response(null, { status: 302, headers: { Location: 'https://other.example/' } })
  }
  const empty = await airQualityResponse(request, { cache: {}, fetcher, now })
  assert.equal(empty.status, 503)
  const cached = { source: 'Air4Thai', fetchedAt: '2026-09-20T02:00:00Z', stations: [{ id: '69t', pm25: 8.5 }] }
  const fallback = await airQualityResponse(request, { cache: { match: async () => Response.json(cached) }, fetcher, now })
  assert.equal(fallback.status, 200)
  const body = await fallback.json()
  assert.equal(body.refreshFailed, true)
  assert.equal(body.fetchedAt, cached.fetchedAt)
  const expired = await airQualityResponse(request, { cache: { match: async () => Response.json(cached) }, fetcher, now: now + 24 * 3600000 })
  assert.equal(expired.status, 503)
})
