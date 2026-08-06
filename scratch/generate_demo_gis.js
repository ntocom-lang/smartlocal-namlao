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

  return {
    type: 'FeatureCollection',
    features: features,
  }
}

async function fetchFast(query) {
  const url = 'https://overpass-api.de/api/interpreter'
  const res = await fetch(url, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'SmartLocal/1.0'
    }
  })
  const text = await res.text()
  return JSON.parse(text)
}

async function main() {
  console.log('Fetching Overpass GIS data...')
  
  // Nam Lao / Tamnak Tham bbox: 18.12,100.12,18.23,100.25
  const bbox = '18.12,100.12,18.23,100.25'
  
  try {
    const roadsData = await fetchFast(`[out:json][timeout:60];way["highway"](${bbox});out body;>;out skel qt;`)
    const roadsGeoJSON = osmToGeoJSON(roadsData)
    fs.writeFileSync('scratch/เส้นทางถนน_ตำบลน้ำเลา.geojson', JSON.stringify(roadsGeoJSON, null, 2))
    console.log(`Saved scratch/เส้นทางถนน_ตำบลน้ำเลา.geojson (${roadsGeoJSON.features.length} features)`)
  } catch (e) {
    console.error('Failed roads:', e)
  }
}

main()
