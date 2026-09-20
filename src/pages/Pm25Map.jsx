import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPinned } from 'lucide-react'
import { createStreetLayer } from '../lib/mapTiles'
import { distanceKm, formatMeasuredAt, isFresh, pm25Level } from '../lib/pm25'
import { validCoordinates } from '../lib/pm25Details'

export default function Pm25Map({ stations, tenant, now }) {
  const container = useRef(null)
  const previousView = useRef(null)
  const [tileFailed, setTileFailed] = useState(false)
  const lat = tenant?.latitude, lon = tenant?.longitude
  useEffect(() => {
    if (!container.current || !validCoordinates(lat, lon)) return
    const map = L.map(container.current, { scrollWheelZoom: false }).setView([Number(lat), Number(lon)], 9)
    const layer = createStreetLayer().addTo(map)
    let errors = 0
    layer.on('tileerror', () => { errors++; if (errors >= 3) setTileFailed(true) })
    const points = [[Number(lat), Number(lon)]]
    const orgLabel = document.createElement('span'); orgLabel.textContent = tenant.name || 'ที่ตั้งหน่วยงาน'
    L.marker(points[0], { icon: L.divIcon({ className: 'pm25-org-pin', html: '<span>อปท.</span>', iconSize: [44, 44], iconAnchor: [22, 22] }), title: tenant.name || 'ที่ตั้งหน่วยงาน' }).addTo(map).bindPopup(orgLabel)
    const nearby = stations.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)).map(s => ({ ...s, distance: distanceKm(lat, lon, s) })).filter(s => s.distance !== null && s.distance <= 150).sort((a, b) => a.distance - b.distance).slice(0, 12)
    nearby.forEach(s => {
      const fresh = isFresh(s, now)
      const level = fresh ? pm25Level(s.pm25) : null
      const color = level?.color || '#687986'
      const value = s.pm25 === null ? '—' : s.pm25.toFixed(1)
      const label = `${s.name} · ${value} µg/m³ · ${level?.label || 'ไม่มีค่าปัจจุบัน'}`
      const content = document.createElement('div')
      for (const text of [s.name, s.area, `${value} µg/m³ · เฉลี่ย 24 ชั่วโมง`, level?.label || 'ไม่มีค่าปัจจุบัน', formatMeasuredAt(s.measuredAt), `ห่างจาก อปท. ${s.distance.toFixed(1)} กม. (แนวเส้นตรง)`]) { const p = document.createElement('p'); p.textContent = text; content.append(p) }
      L.marker([s.lat, s.lon], { title: label, alt: label, icon: L.divIcon({ className: 'pm25-station-pin', html: `<span style="border-color:${color};color:${color}">${value}</span>`, iconSize: [48, 44], iconAnchor: [24, 22] }) }).addTo(map).bindPopup(content)
      points.push([s.lat, s.lon])
    })
    const savedView = previousView.current
    if (savedView && savedView.lat === lat && savedView.lon === lon) map.setView(savedView.center, savedView.zoom)
    else if (points.length > 1) map.fitBounds(points, { padding: [35, 35], maxZoom: 11 })
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container.current)
    return () => { previousView.current = { lat, lon, center: map.getCenter(), zoom: map.getZoom() }; observer.disconnect(); map.remove() }
  }, [stations, lat, lon, tenant?.name, now])
  return <section className="pm25-panel" id="pm25-map"><div className="pm25-section-heading"><MapPinned size={20} /><h2>แผนที่สถานีรอบพื้นที่</h2></div><p className="pm25-muted">แตะจุดเพื่อดูค่าฝุ่นและเวลาตรวจวัด · สูงสุด 12 สถานีในระยะ 150 กม.</p>{validCoordinates(lat, lon) ? <><div ref={container} className="pm25-map-canvas" aria-label="แผนที่สถานีตรวจวัด PM2.5 และที่ตั้งหน่วยงาน" />{tileFailed && <p className="pm25-notice">ภาพแผนที่บางส่วนโหลดไม่สำเร็จ ยังดูรายละเอียดจากจุดสถานีหรือรายการด้านบนได้</p>}<p className="pm25-muted">กรอบสีน้ำเงินคือ อปท. · ตัวเลขเป็นค่าเฉลี่ย 24 ชั่วโมง (µg/m³) · สีเทาคือไม่มีค่าปัจจุบัน</p></> : <p className="pm25-notice">ยังไม่มีพิกัดหน่วยงานสำหรับเปิดแผนที่</p>}</section>
}
