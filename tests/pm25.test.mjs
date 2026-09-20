import assert from 'node:assert/strict'
import test from 'node:test'
import { measurementTime, nearbyStations, normalizeStations, pm25Level } from '../src/lib/pm25.js'

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
