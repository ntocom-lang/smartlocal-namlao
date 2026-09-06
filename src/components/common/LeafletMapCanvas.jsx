import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTenant } from '../../contexts/TenantContext'
import { createStreetLayer, createSatelliteLayer, createHybridLabelLayer } from '../../lib/mapTiles'

const isPoint = point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))

// L.divIcon / bindPopup รับ "HTML string" ไม่ใช่ JSX — React ไม่ได้ escape ให้ ค่าที่เอามาต่อสตริง
// (title/subtitle/label/สีหมุด/iconUrl) หลายจอมาจากข้อมูลที่ประชาชนกรอกเอง เช่น ชื่อร้านในทะเบียน
// พาณิชย์ หรือหัวเรื่องเรื่องร้องเรียน ถ้าไม่ escape = stored XSS บนเว็บราชการ
// (markerData.infoHtml ยังปล่อยดิบตามเดิม เพราะเป็น HTML ที่โค้ดฝั่งเราประกอบเองทั้งก้อน
//  ผู้เรียกต้องรับผิดชอบ escape เนื้อหาที่ผู้ใช้กรอกก่อนส่งเข้ามา)
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const escapeAttr = escapeHtml

// กัน javascript: / data:text/html ที่ฝังมาทาง iconUrl แล้วกลายเป็นช่องรันสคริปต์
const safeUrl = value => {
  const raw = String(value ?? '').trim()
  return /^(https?:|\/|data:image\/)/i.test(raw) ? raw : ''
}

// สีถูกยัดลง style="" ตรงๆ ปล่อยดิบจะปิด attribute แล้วแทรก tag ต่อได้ จึงรับเฉพาะรูปแบบสีที่รู้จัก
const safeColor = value => {
  const raw = String(value ?? '').trim()
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i.test(raw) ? raw : '#ef4444'
}

/**
 * Leaflet Open-Source Map Canvas ($0 Budget / 100% Free)
 * Drop-in replacement for GoogleMapCanvas with zero API key requirement.
 */
export default function LeafletMapCanvas({
  center,
  zoom = 15,
  mapTypeId = 'hybrid', // 'hybrid' | 'roadmap' | 'satellite'
  markers = [],
  polylines = [],
  boundaryGeoJson = null,
  fitBounds = false,
  onMapClick,
  onMapRightClick,
  onFeatureClick,
  onFeatureRightClick,
  onPolylineRightClick,
  onMarkerDragEnd,
  onMapReady,
  className = 'w-full h-full min-h-[320px]',
}) {
  const { tenant } = useTenant()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const baseLayersRef = useRef({})
  const markerLayersRef = useRef([])
  const polylineLayersRef = useRef([])
  const geojsonLayerRef = useRef(null)
  const callbacksRef = useRef({ onMapClick, onMapRightClick, onFeatureClick, onFeatureRightClick, onPolylineRightClick, onMarkerDragEnd, onMapReady })
  const lastFitSignatureRef = useRef('')
  const fallbackLayersRef = useRef([])
  const [loading, setLoading] = useState(true)
  // derive จาก prop ตรงๆ ไม่เก็บเป็น state ซ้ำ — ไม่มีปุ่มสลับในตัว component แล้ว
  // เก็บเป็น state จะกลายเป็นแหล่งความจริงคู่ขนานที่หลุดจาก prop ได้
  const activeMapType = mapTypeId === 'satellite' || mapTypeId === 'hybrid' ? 'hybrid' : 'roadmap'

  const safeCenter = useMemo(() => {
    if (isPoint(center)) return [Number(center.lat), Number(center.lng)]
    return [
      Number(tenant?.latitude) || 18.1448,
      Number(tenant?.longitude) || 100.1167,
    ]
  }, [center, tenant?.latitude, tenant?.longitude])

  const [fetchedBoundary, setFetchedBoundary] = useState(null)

  useEffect(() => {
    if (boundaryGeoJson === false || boundaryGeoJson === 'none' || boundaryGeoJson) return
    const slug = tenant?.slug || 'namlao'
    let active = true
    fetch(`/boundaries/${slug}.geojson`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (active) setFetchedBoundary(data) })
      .catch(() => { if (active) setFetchedBoundary(null) })
    return () => { active = false }
  }, [boundaryGeoJson, tenant?.slug])

  const effectiveBoundaryGeoJson = useMemo(() => {
    if (boundaryGeoJson === false || boundaryGeoJson === 'none') return null
    if (boundaryGeoJson) return boundaryGeoJson
    if (tenant?.boundary_geojson) return tenant.boundary_geojson
    return fetchedBoundary
  }, [boundaryGeoJson, tenant, fetchedBoundary])

  useEffect(() => {
    callbacksRef.current = { onMapClick, onMapRightClick, onFeatureClick, onFeatureRightClick, onPolylineRightClick, onMarkerDragEnd, onMapReady }
  }, [onMapClick, onMapRightClick, onFeatureClick, onFeatureRightClick, onPolylineRightClick, onMarkerDragEnd, onMapReady])

  // 1. Initialize Map and Tile Layers
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // แหล่ง tile ทั้งหมดอยู่ใน lib/mapTiles.js — ชั้นดาวเทียมมี fallback ในตัว
    // (ArcGIS ที่มี key → Esri legacy → OSM) กันจอขาวเมื่อผู้ให้บริการรายใดรายหนึ่งล่ม
    const streetLayer = createStreetLayer()
    const satelliteTile = createSatelliteLayer()
    const labelTile = createHybridLabelLayer()
    // เก็บทั้งสองชั้นไว้ปลด timer/listener ตอน unmount — ชั้นป้ายชื่อก็มี fallback ในตัวเหมือนกัน
    // (คีย์ที่ไม่มีสิทธิ์ staticbasemaptiles จะได้ 401 แล้วถอยไป endpoint เดิมเอง)
    fallbackLayersRef.current = [satelliteTile, labelTile]

    const hybridGroup = L.layerGroup([satelliteTile, labelTile])

    baseLayersRef.current = {
      roadmap: streetLayer,
      hybrid: hybridGroup,
    }

    const initialLayer = activeMapType === 'hybrid' ? hybridGroup : streetLayer

    const map = L.map(containerRef.current, {
      center: safeCenter,
      zoom,
      zoomControl: false,
      layers: [initialLayer],
      attributionControl: true,
    })

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    map.on('click', e => {
      callbacksRef.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng })
    })

    map.on('contextmenu', e => {
      const point = { lat: e.latlng.lat, lng: e.latlng.lng }
      const screen = e.originalEvent ? { clientX: e.originalEvent.clientX, clientY: e.originalEvent.clientY } : null
      callbacksRef.current.onMapRightClick?.(point, screen)
    })

    mapRef.current = map
    setLoading(false)
    callbacksRef.current.onMapReady?.(map, L)

    return () => {
      // ต้องปลด timer/listener ของ fallback ก่อน map.remove() ไม่งั้น setTimeout 8 วิ
      // ที่ตั้งค้างไว้จะยิงหลัง component ถูก unmount ไปแล้ว
      fallbackLayersRef.current.forEach(layer => layer?.disposeFallback?.())
      fallbackLayersRef.current = []
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2. Switch Map Type
  function changeMapType(type) {
    const map = mapRef.current
    if (!map) return

    const { roadmap, hybrid } = baseLayersRef.current
    if (type === 'hybrid' || type === 'satellite') {
      if (roadmap && map.hasLayer(roadmap)) map.removeLayer(roadmap)
      if (hybrid && !map.hasLayer(hybrid)) map.addLayer(hybrid)
    } else {
      if (hybrid && map.hasLayer(hybrid)) map.removeLayer(hybrid)
      if (roadmap && !map.hasLayer(roadmap)) map.addLayer(roadmap)
    }
  }

  // ปุ่มสลับ แผนที่/ดาวเทียม ถูกถอดออกไปแล้ว ตัวเลือกจึงมาทาง prop อย่างเดียว
  // เดิม mapTypeId ถูกอ่านแค่ตอน mount ผู้เรียกที่เปลี่ยนค่าทีหลังจะไม่มีอะไรเกิดขึ้นเลย
  useEffect(() => {
    changeMapType(activeMapType)
   
  }, [activeMapType])

  // 3. Update Center & Zoom
  useEffect(() => {
    const map = mapRef.current
    if (!map || !isPoint(center)) return
    const current = map.getCenter()
    const dist = Math.hypot(center.lat - current.lat, center.lng - current.lng)
    if (dist > 0.0003) {
      map.panTo([Number(center.lat), Number(center.lng)], { animate: true, duration: 0.5 })
    }
  }, [center])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !zoom) return
    if (map.getZoom() !== zoom) {
      map.setZoom(zoom)
    }
  }, [zoom])

  // 4. Render Markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markerLayersRef.current.forEach(m => map.removeLayer(m))
    markerLayersRef.current = []

    markers.filter(m => isPoint(m.position)).forEach(markerData => {
      const pos = [Number(markerData.position.lat), Number(markerData.position.lng)]
      const isDraggable = Boolean(markerData.draggable)
      const size = Math.max(16, (markerData.scale ?? 10) * 1.8)
      const color = markerData.color || '#ef4444'
      const labelText = markerData.label ? String(markerData.label) : ''

      let iconHtml
      if (markerData.iconUrl) {
        const iconSize = Math.round(size * 1.35)
        iconHtml = `
          <div style="width: ${iconSize}px; height: ${iconSize}px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
            <img src="${escapeAttr(safeUrl(markerData.iconUrl))}" style="width: 100%; height: 100%; object-fit: contain;" alt="" />
          </div>
        `
      } else if (markerData.shape === 'circle') {
        iconHtml = `
          <div style="width: ${size}px; height: ${size}px; border-radius: 50%; background: ${safeColor(color)}; border: 2px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-size: ${Math.round(size * 0.6)}px; line-height: 1; color: #ffffff;">
            ${escapeHtml(labelText)}
          </div>
        `
      } else {
        iconHtml = `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center; transform: translateY(-50%);">
            <div style="background: ${safeColor(color)}; color: #ffffff; width: ${size * 1.3}px; height: ${size * 1.3}px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 2px solid #ffffff; box-shadow: 0 3px 6px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;">
              <span style="transform: rotate(45deg); font-size: ${Math.round(size * 0.6)}px; font-weight: 700;">${escapeHtml(labelText)}</span>
            </div>
            <div style="width: 6px; height: 6px; background: rgba(0,0,0,0.3); border-radius: 50%; margin-top: 2px; filter: blur(1px);"></div>
          </div>
        `
      }

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'smartlocal-custom-marker',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      })

      // markerData.title ทำสองหน้าที่พร้อมกัน: เป็นข้อความ tooltip ตอน hover และเป็น "สวิตช์"
      // สั่งให้ผูก popup ของ Leaflet ด้านล่าง (if (markerData.title || markerData.infoHtml))
      // ผู้เรียกที่มีการ์ดรายละเอียดเป็นของตัวเองจึงส่ง title มาไม่ได้เลย ไม่งั้นได้ popup ซ้อน 2 ชั้น
      // แล้วต้องยอมเสีย tooltip ไปด้วยทั้งที่ไม่เกี่ยวกัน (เคสจริง: แผนที่ data-center)
      //
      // markerData.tooltip จึงเป็นช่องสำหรับ "อยากได้ข้อความ hover แต่ไม่เอา popup" โดยเฉพาะ
      // ใช้ attribute title ของ HTML ตรงๆ ไม่ใช่ L.tooltip เพราะบนมือถือ L.tooltip จะเปิดตอนแตะ
      // แล้วชนกับการ์ดรายละเอียด ส่วน attribute title เบราว์เซอร์แสดงเฉพาะตอน hover ด้วยเมาส์
      const marker = L.marker(pos, {
        icon: customIcon,
        draggable: isDraggable,
        title: markerData.title || markerData.tooltip || '',
        zIndexOffset: markerData.zIndex || 0,
      })

      if (isDraggable) {
        marker.on('dragend', () => {
          const latlng = marker.getLatLng()
          const newPos = { lat: latlng.lat, lng: latlng.lng }
          markerData.onDragEnd?.(newPos)
          callbacksRef.current.onMarkerDragEnd?.(markerData, newPos)
        })
      }

      if (markerData.title || markerData.infoHtml) {
        const titleText = markerData.title || ''
        const subtitleText = markerData.subtitle || markerData.entry?.group_name || ''
        const lat = Number(markerData.position.lat)
        const lng = Number(markerData.position.lng)
        const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

        const htmlContent = markerData.infoHtml || `
          <div style="font-family: 'Sarabun', system-ui, sans-serif; padding: 2px 2px 0 0; min-width: 175px; max-width: 240px; box-sizing: border-box;">
            <div style="font-weight: 800; font-size: 14px; color: #0f172a; line-height: 1.35; margin-bottom: 2px;">${escapeHtml(titleText)}</div>
            ${subtitleText ? `<div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 8px; line-height: 1.3;">${escapeHtml(subtitleText)}</div>` : '<div style="margin-bottom: 6px;"></div>'}
            <a href="${escapeAttr(gmapsUrl)}" target="_blank" rel="noopener noreferrer"
              style="display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 10px; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; padding: 6px 12px; font-size: 11px; font-weight: 700; text-decoration: none; box-shadow: 0 2px 6px rgba(37,99,235,0.22); text-align: center;">
              <span>📍 เปิดพิกัดนำทาง</span>
            </a>
          </div>
        `
        marker.bindPopup(htmlContent, { closeButton: true, maxWidth: 260 })
      }

      marker.on('click', () => {
        callbacksRef.current.onFeatureClick?.(markerData)
      })

      marker.on('contextmenu', e => {
        L.DomEvent.preventDefault(e)
        const screen = e.originalEvent ? { clientX: e.originalEvent.clientX, clientY: e.originalEvent.clientY } : null
        if (callbacksRef.current.onFeatureRightClick) {
          callbacksRef.current.onFeatureRightClick(markerData, screen)
        } else {
          callbacksRef.current.onMapRightClick?.(markerData.position, screen)
        }
      })

      marker.addTo(map)
      markerLayersRef.current.push(marker)
    })
  }, [markers])

  // 5. Render Polylines
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    polylineLayersRef.current.forEach(l => map.removeLayer(l))
    polylineLayersRef.current = []

    polylines.filter(line => Array.isArray(line.path) && line.path.length >= 2).forEach(lineData => {
      const latlngs = lineData.path.filter(isPoint).map(pt => [Number(pt.lat), Number(pt.lng)])
      const dashed = Boolean(lineData.dashArray)

      const polyline = L.polyline(latlngs, {
        color: lineData.color || '#2563eb',
        weight: lineData.weight || 4,
        opacity: lineData.opacity ?? 0.9,
        dashArray: dashed ? '8, 8' : undefined,
      })

      polyline.on('click', () => callbacksRef.current.onFeatureClick?.(lineData))
      polyline.on('contextmenu', e => {
        L.DomEvent.preventDefault(e)
        const point = { lat: e.latlng.lat, lng: e.latlng.lng }
        const screen = e.originalEvent ? { clientX: e.originalEvent.clientX, clientY: e.originalEvent.clientY } : null
        if (callbacksRef.current.onPolylineRightClick) {
          callbacksRef.current.onPolylineRightClick(lineData, point, screen)
        } else {
          callbacksRef.current.onMapRightClick?.(point, screen)
        }
      })

      polyline.addTo(map)
      polylineLayersRef.current.push(polyline)
    })
  }, [polylines])

  // 6. Fit Bounds
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitBounds) return

    const points = [
      ...markers.map(m => m.position),
      ...polylines.flatMap(l => l.path || []),
    ].filter(isPoint)

    const signature = points.map(p => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`).join('|')
    if (points.length && signature !== lastFitSignatureRef.current) {
      const bounds = L.latLngBounds(points.map(p => [Number(p.lat), Number(p.lng)]))
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
      lastFitSignatureRef.current = signature
    }
  }, [markers, polylines, fitBounds])

  // 7. Render Boundary GeoJSON
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (geojsonLayerRef.current) {
      map.removeLayer(geojsonLayerRef.current)
      geojsonLayerRef.current = null
    }

    if (!effectiveBoundaryGeoJson) return

    try {
      const geoLayer = L.geoJSON(effectiveBoundaryGeoJson, {
        style: {
          color: '#dc2626',
          weight: 3,
          dashArray: '6, 6',
          fillColor: '#ef4444',
          fillOpacity: 0.08,
        },
        interactive: false,
      })
      geoLayer.addTo(map)
      geojsonLayerRef.current = geoLayer
    } catch (err) {
      console.warn('[LeafletMapCanvas] Invalid municipality boundary GeoJSON:', err)
    }
  }, [effectiveBoundaryGeoJson])

  // 8. ResizeObserver for Auto Map Invalidation
  useEffect(() => {
    if (!containerRef.current || !globalThis.ResizeObserver) return undefined
    const observer = new ResizeObserver(() => {
      mapRef.current?.invalidateSize()
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      <div ref={containerRef} className="absolute inset-0 z-0" aria-label="Leaflet Map" />

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-slate-50/90 text-sm font-semibold text-slate-500">
          <Loader2 size={20} className="animate-spin text-blue-600" /> กำลังโหลดแผนที่ Open-Source...
        </div>
      )}
    </div>
  )
}
