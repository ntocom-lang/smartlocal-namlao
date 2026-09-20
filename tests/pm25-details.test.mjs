import assert from 'node:assert/strict'
import test from 'node:test'
import { gistdaClock, historySummary, normalizeHistory, normalizeLocation, normalizeTambons, validCoordinates } from '../src/lib/pm25Details.js'
import { pm25DetailsResponse } from '../worker/pm25Details.js'

const now = Date.parse('2026-09-20T03:30:00Z') // 10:30 Thai
const HOUR = 3600000
const row = (date, hour, value) => ({ DATETIMEDATA: `${date} ${String(hour).padStart(2, '0')}:00:00`, PM25: value })
const historyPayload = rows => ({ result: 'OK', stations: [{ stationID: '69t', data: rows }] })
const meta = { dateEng: 'Sunday 20 September 2026', timeEng: '10:00' }
const locationPayload = { status: 200, data: { loc: { ap_idn: 5401, tb_idn: 540104, ap_tn: 'เมืองแพร่', pv_tn: 'แพร่', tb_tn: 'ป่าแดง' }, datetimeEng: meta, graphHistory24hrs: [[9, '2026-09-20T10:00:00.000Z']] } }
const tambonPayload = { status: 200, datetimeEng: meta, data: [{ tb_idn: 540104, tb_tn: 'ป่าแดง', pm25: 9, pm25Avg24hr: 10, dt: '2026-09-20T10:00:00.000Z' }] }

test('hourly history rejects negative, duplicate, impossible and future readings', () => {
  const points = normalizeHistory(historyPayload([row('2026-09-20', 8, 4), row('2026-09-20', 9, -1), row('2026-09-20', 10, 0), row('2026-09-20', 10, 1), row('2026-09-20', 11, 12), row('2026-02-30', 1, 10)]), '69t', now)
  assert.deepEqual(points.map(p => p.value), [4, null, null])
  assert.equal(points[0].time, Date.parse('2026-09-20T01:00:00Z'))
  assert.throws(() => normalizeHistory(historyPayload([]), 'other', now))
})

test('compares matching hours only; missing data or stale histories cannot produce a delta', () => {
  const rows = []
  for (let h = 0; h <= 10; h++) { rows.push(row('2026-09-19', h, 10)); rows.push(row('2026-09-20', h, 20)) }
  const points = normalizeHistory(historyPayload(rows), '69t', now)
  const summary = historySummary(points, now)
  assert.equal(summary.comparison.difference, 10)
  assert.equal(summary.comparison.hours, 11)
  assert.equal(summary.daily.at(-1).expected, 11)
  assert.equal(summary.daily.at(-2).value, null, 'yesterday requires all 24 hours in the daily graph')
  assert.equal(summary.hourly.length, 24)
  assert.equal(historySummary(points.slice(1), now).comparison, null)
  assert.equal(historySummary(points, now + 4 * HOUR).comparison, null)
  assert.equal(historySummary([], now).latest, null)
})

test('GISTDA wall time is verified against metadata; unknown timezone is never guessed', () => {
  assert.equal(gistdaClock('2026-09-20T10:00:00Z', meta).reference, '2026-09-20T03:00:00.000Z')
  assert.equal(gistdaClock('2026-09-20T03:00:00Z', meta).offset, 0, 'support correctly encoded UTC too')
  assert.equal(gistdaClock('2026-09-20T04:00:00Z', meta), null)
  assert.equal(gistdaClock('2026-09-20T10:00:00Z', {}), null)
  assert.equal(normalizeLocation(locationPayload).districtId, '5401')
  const normalized = normalizeTambons(tambonPayload, '5401')[0]
  assert.equal(normalized.measuredAt, '2026-09-20T03:00:00.000Z')
  assert.equal(normalized.hourly, 9)
  assert.equal(normalized.average24, 10)
  assert.equal(normalizeTambons(tambonPayload, '5402').length, 0)
})

test('public proxy validates parameters before sending requests, rejects redirects, and isolates cache keys', async () => {
  let calls = 0
  const cacheStore = new Map()
  const cache = { match: async key => cacheStore.get(key)?.clone(), put: async (key, res) => cacheStore.set(key, res.clone()) }
  const fetcher = async (url, options) => {
    calls++
    assert.equal(options.redirect, 'manual')
    if (url.includes('getHistoryData')) return Response.json(historyPayload([row('2026-09-20', 10, 8)]))
    if (url.includes('getPm25byLocation')) return Response.json(locationPayload)
    if (url.includes('getPm25byTambon')) return Response.json(tambonPayload)
    throw Error('Unexpected URL')
  }
  const request = query => new Request(`https://example.test/api/pm25-details?${query}`)
  for (const query of ['kind=history&station=https://bad.test','kind=area&lat=&lon=100','kind=area&lat=90&lon=100','kind=other']) {
    assert.equal((await pm25DetailsResponse(request(query), { fetcher, cache, now })).status, 400)
  }
  assert.equal(calls, 0)
  const first = await pm25DetailsResponse(request('kind=history&station=69t'), { fetcher, cache, now })
  assert.equal((await first.json()).points[0].value, 8)
  await pm25DetailsResponse(request('kind=history&station=69t'), { fetcher, cache, now })
  assert.equal(calls, 1)
  const area = await pm25DetailsResponse(request('kind=area&lat=18.1&lon=100.2'), { fetcher, cache, now })
  assert.equal((await area.json()).tambons[0].average24, 10)
  assert.equal(calls, 3)
  const failed = async () => new Response(null, { status: 302, headers: { Location: 'https://bad.test/' } })
  const fallback = await pm25DetailsResponse(request('kind=history&station=69t'), { fetcher: failed, cache, now: now + HOUR })
  assert.equal((await fallback.json()).refreshFailed, true)
  assert.equal((await pm25DetailsResponse(request('kind=history&station=69t'), { fetcher: failed, cache, now: now + 25 * HOUR })).status, 503)
  assert.equal((await pm25DetailsResponse(new Request('https://example.test', { method: 'POST' }))).status, 405)
  assert.equal(validCoordinates(null, 100), false)
})
