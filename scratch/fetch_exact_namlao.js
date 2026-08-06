import fs from 'fs'

async function getNamLaoBoundary() {
  console.log('1. Fetching exact boundary of ตำบลน้ำเลา from Nominatim / OpenStreetMap...')
  const searchUrl = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent('ตำบลน้ำเลา อำเภอร้องกวาง') + '&format=json&polygon_geojson=1'
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': 'SmartLocal-GIS/1.0' }
  })
  const results = await res.json()
  console.log('Search results:', results.map(r => ({ name: r.display_name, lat: r.lat, lon: r.lon, type: r.type, geojsonType: r.geojson?.type })))

  if (!results.length) {
    throw new Error('Not found')
  }

  const match = results[0]
  console.log('Boundary Polygon found:', match.display_name)
  console.log('Bounding Box:', match.boundingbox) // [south, north, west, east]
  return match
}

getNamLaoBoundary().catch(console.error)
