import fs from 'fs'

function osmToGeoJSON(osmData) {
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
        features.push({
          type: 'Feature',
          id: elem.id,
          properties: {
            id: elem.id,
            name: elem.tags?.name || elem.tags?.['name:th'] || (elem.tags?.highway ? `ถนน ${elem.tags.highway}` : null) || (elem.tags?.waterway ? `สายน้ำ ${elem.tags.waterway}` : null) || 'เส้นทาง GIS',
            highway: elem.tags?.highway || null,
            waterway: elem.tags?.waterway || null,
            ref: elem.tags?.ref || null,
            surface: elem.tags?.surface || null,
          },
          geometry: {
            type: 'LineString',
            coordinates: coordinates,
          },
        })
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
  console.log('Fetching GIS data from Overpass API...')
  
  // Nam Lao / Tamnak Tham bounding box in Rong Kwang / Phrae:
  // Lat: 18.10 to 18.25, Lng: 100.08 to 100.28
  const bbox = '18.08,100.08,18.26,100.28'

  const roadQuery = `[out:json][timeout:90];(way["highway"](${bbox}););out body;>;out skel qt;`
  const waterQuery = `[out:json][timeout:90];(way["waterway"](${bbox}););out body;>;out skel qt;`

  try {
    console.log('1/2 Fetching Road Networks...')
    const roadJson = await queryOverpass(roadQuery)
    const roadGeoJson = osmToGeoJSON(roadJson)
    fs.writeFileSync('scratch/เส้นทางถนน_ตำบลน้ำเลา_ตำหนักธรรม.geojson', JSON.stringify(roadGeoJson, null, 2), 'utf-8')
    console.log(`Saved scratch/เส้นทางถนน_ตำบลน้ำเลา_ตำหนักธรรม.geojson with ${roadGeoJson.features.length} features`)

    console.log('2/2 Fetching Waterway Networks...')
    const waterJson = await queryOverpass(waterQuery)
    const waterGeoJson = osmToGeoJSON(waterJson)
    fs.writeFileSync('scratch/เส้นทางสายน้ำ_ตำบลน้ำเลา_ตำหนักธรรม.geojson', JSON.stringify(waterGeoJson, null, 2), 'utf-8')
    console.log(`Saved scratch/เส้นทางสายน้ำ_ตำบลน้ำเลา_ตำหนักธรรม.geojson with ${waterGeoJson.features.length} features`)

    console.log('ALL GIS FILES FETCHED SUCCESSFULLY!')
  } catch (err) {
    console.error('Error fetching GIS:', err)
  }
}

run()
