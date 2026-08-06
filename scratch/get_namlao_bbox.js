import fs from 'fs'

const raw = fs.readFileSync('public/boundaries/namlao.geojson', 'utf-8')
const data = JSON.parse(raw)

let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity

function scanCoords(coords) {
  if (typeof coords[0] === 'number') {
    const lng = coords[0], lat = coords[1]
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  } else {
    for (const c of coords) scanCoords(c)
  }
}

scanCoords(data.features ? data.features[0].geometry.coordinates : data.geometry.coordinates)

console.log('Nam Lao Polygon Bounding Box:')
console.log(`minLat: ${minLat}, maxLat: ${maxLat}`)
console.log(`minLng: ${minLng}, maxLng: ${maxLng}`)
console.log(`Overpass BBOX format (minLat,minLng,maxLat,maxLng): ${minLat},${minLng},${maxLat},${maxLng}`)
