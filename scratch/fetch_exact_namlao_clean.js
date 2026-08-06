import fs from 'fs'

function pointInPolygon(point, polygon) {
  const x = point[0], y = point[1]
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function pointInMultiPolygon(point, coordinates) {
  for (const poly of coordinates) {
    if (Array.isArray(poly[0][0])) {
      for (const ring of poly) {
        if (pointInPolygon(point, ring)) return true
      }
    } else {
      if (pointInPolygon(point, poly)) return true
    }
  }
  return false
}

function getBoundaryRings(boundaryGeoJson) {
  const rings = []
  const feature = boundaryGeoJson.features ? boundaryGeoJson.features[0] : boundaryGeoJson
  const geom = feature.geometry || feature

  if (geom.type === 'Polygon') {
    rings.push(geom.coordinates)
  } else if (geom.type === 'MultiPolygon') {
    for (const polyCoords of geom.coordinates) {
      rings.push(polyCoords)
    }
  }
  return rings
}

function osmToGeoJSON(osmData, boundaryRings) {
  const nodeMap = new Map()
  const features = []

  for (const elem of osmData.elements || []) {
    if (elem.type === 'node') {
      nodeMap.set(elem.id, [elem.lon, elem.lat])
    }
  }

  for (const elem of osmData.elements || []) {
    if (elem.type === 'way' && elem.nodes && elem.nodes.length >= 2) {
      const coordinates = []
      for (const nodeId of elem.nodes) {
        const coords = nodeMap.get(nodeId)
        if (coords) coordinates.push(coords)
      }
      
      if (coordinates.length >= 2) {
        const isInside = coordinates.some(coord => pointInMultiPolygon(coord, boundaryRings))
        
        if (isInside) {
          const typeLabel = elem.tags?.highway ? 'ถนน' : elem.tags?.waterway ? 'สายน้ำ' : 'เส้นทาง'
          const refName = elem.tags?.ref ? ` (${elem.tags.ref})` : ''
          const name = elem.tags?.name || elem.tags?.['name:th'] || `${typeLabel}${refName}`

          features.push({
            type: 'Feature',
            id: elem.id,
            properties: {
              id: elem.id,
              name: name,
              category: elem.tags?.highway ? 'ถนนสายหลัก' : elem.tags?.waterway ? 'สายน้ำ' : 'โครงสร้างพื้นฐาน',
              highway: elem.tags?.highway || null,
              waterway: elem.tags?.waterway || null,
              ref: elem.tags?.ref || null,
            },
            geometry: {
              type: 'LineString',
              coordinates: coordinates,
            },
          })
        }
      }
    }
  }

  return {
    type: 'FeatureCollection',
    features: features,
  }
}

const SERVERS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
]

async function queryOverpass(query) {
  for (const server of SERVERS) {
    try {
      console.log(`Querying ${server}...`)
      const res = await fetch(server, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'SmartLocal-GIS-Fetcher/1.0',
        },
      })
      if (res.ok) {
        const text = await res.text()
        return JSON.parse(text)
      }
    } catch (e) {
      console.warn(`Server ${server} failed:`, e.message)
    }
  }
  throw new Error('All Overpass servers failed')
}

async function run() {
  console.log('1. Loading exact boundary of ตำบลน้ำเลา...')
  const boundaryRaw = fs.readFileSync('public/boundaries/namlao.geojson', 'utf-8')
  const boundaryGeoJson = JSON.parse(boundaryRaw)
  const boundaryRings = getBoundaryRings(boundaryGeoJson)

  const bbox = '18.22,100.26,18.31,100.43'

  console.log('2. Fetching roads for Nam Lao bbox:', bbox)
  const roadsJson = await queryOverpass(`[out:json][timeout:30];way["highway"](${bbox});out body;>;out skel qt;`)
  const filteredRoads = osmToGeoJSON(roadsJson, boundaryRings)

  console.log(`✅ Filtered Roads: ${filteredRoads.features.length} features strictly inside ตำบลน้ำเลา!`)
  fs.writeFileSync('public/demo-gis/roads_namlao.geojson', JSON.stringify(filteredRoads, null, 2), 'utf-8')

  console.log('3. Fetching waterways for Nam Lao bbox:', bbox)
  const waterJson = await queryOverpass(`[out:json][timeout:30];way["waterway"](${bbox});out body;>;out skel qt;`)
  const filteredWater = osmToGeoJSON(waterJson, boundaryRings)

  console.log(`✅ Filtered Waterways: ${filteredWater.features.length} features strictly inside ตำบลน้ำเลา!`)
  fs.writeFileSync('public/demo-gis/waterways_namlao.geojson', JSON.stringify(filteredWater, null, 2), 'utf-8')

  console.log('DONE!')
}

run().catch(console.error)
