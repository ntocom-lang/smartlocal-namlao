import assert from 'node:assert/strict'
import { waterShareSlides } from '../src/lib/waterShareImages.js'

const tenant = { name: 'เทศบาลตำบลน้ำเลา', district: 'ร้องกวาง', province: 'แพร่' }
const rains = Array.from({ length: 7 }, (_, i) => ({ station_type: 'rain', station_code: `R${i}`, station_name: `ฝน ${i}`, distance_km: i / 2 }))
const dam = { station_type: 'dam', station_code: 'D', station_name: 'อ่างในพื้นที่', distance_km: 4.3 }
const levels = { station_type: 'waterlevel', station_code: 'W', station_name: 'ระดับน้ำ', distance_km: 5 }
const result = waterShareSlides({ stations: [...rains, dam, levels, { ...dam, station_code: 'far', distance_km: 5.01 }] }, tenant)
assert.deepEqual(result.map(s => s.kind), ['summary', 'rain', 'rain', 'rain', 'dam', 'waterlevel'])
assert.deepEqual(result.filter(s => s.kind === 'rain').map(s => s.stations.length), [3, 3, 1])
assert.deepEqual(result.slice(1).flatMap(s => s.stations).map(s => s.station_code).sort(), [...rains, dam, levels].map(s => s.station_code).sort())
assert(result.every((s, i) => s.index === i + 1 && s.total === 6))
assert.equal(waterShareSlides({ stations: [] }, tenant).length, 1)
console.log('PASS: square-image grouping, inclusive 5 km, no omitted or duplicated detail stations, numbering, empty summary')
