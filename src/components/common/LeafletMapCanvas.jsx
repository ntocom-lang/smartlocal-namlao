import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  circles = [],
  flyTo = null,
  boundaryGeoJson = null,
  fitBounds = false,
  // ระยะเผื่อของ fitBounds เป็น px: อ็อบเจ็กต์ { top, right, bottom, left } หรือฟังก์ชันที่คืนอ็อบเจ็กต์นั้น (เรียกตอนจะ fit จริง
  // ให้วัดแผงที่ลอยทับแผนที่ ณ ตอนนั้นได้) · ไม่ส่ง = 40 รอบด้านเหมือนเดิมทุกประการ — ผู้เรียกอื่นไม่ต้องแก้อะไร
  fitPadding = null,
  // ตัวเลขที่ผู้เรียกเพิ่มเมื่อ "รูปทรงหน้าเปลี่ยนหลัง fit" (เช่น หัวหน้าโหลดสถิติเสร็จแล้วดันแผนที่ลง ~60px จนแผงลอยทับหมุดต่างจากตอน fit)
  // → fit ใหม่ให้ เฉพาะตอนที่ผู้ใช้ยังไม่ได้แตะแผนที่เอง (ลาก/ซูม/กด) · ผู้เรียกวัดรูปทรงเอง เพราะรู้ว่าอะไรลอยทับแผนที่
  // ไม่ส่ง/0 = ไม่แตะอะไรเลย ผู้เรียกอื่นที่ใช้ fitBounds อยู่ (โครงการ/กลิ่น/เส้นทาง) ทำงานเหมือนเดิม
  refitSignal = 0,
  // false = fit แบบกระโดดทันที ไม่มีอนิเมชัน · ต้องใช้คู่กับ refitSignal: Leaflet ทิ้งคำสั่งเลื่อน/ซูมที่มาระหว่างอนิเมชันซูมกำลังวิ่งอยู่
  // เงียบๆ (และตอนอนิเมชันจบยังลากกล้องไปจุดของคำสั่งแรกทับ) fit ครั้งแรกกับ fit ใหม่ตอนรูปทรงหน้าเปลี่ยนห่างกันไม่กี่ร้อยมิลลิวินาที
  // จึงชนกัน — วัดจริง: ได้ผลเลื่อนไปมาแล้วแต่จังหวะ ไม่ส่ง = อนิเมชันเหมือนเดิม
  fitAnimate = true,
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
  const circleLayersRef = useRef([])
  const geojsonLayerRef = useRef(null)
  const callbacksRef = useRef({ onMapClick, onMapRightClick, onFeatureClick, onFeatureRightClick, onPolylineRightClick, onMarkerDragEnd, onMapReady })
  const lastFitSignatureRef = useRef('')
  const fitPaddingRef = useRef(fitPadding)
  const fitInputRef = useRef({ markers, polylines })
  const fitAnimateRef = useRef(fitAnimate)
  const fitTouchedRef = useRef(false) // ผู้ใช้แตะแผนที่เองแล้วหลัง fit ครั้งล่าสุด → ห้าม fit ทับตอนกรอบเปลี่ยนขนาด
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

  // ต้องอยู่ก่อน effect "Fit Bounds" ด้านล่าง (effect รันตามลำดับที่เขียน) — fitPadding เป็นฟังก์ชันใหม่ทุกครั้งที่ผู้เรียก render
  // จึงเก็บใน ref แทนการใส่ใน dependency ไม่งั้นทุก render จะดึงให้ effect fit รันซ้ำ
  useEffect(() => {
    fitPaddingRef.current = fitPadding
    fitAnimateRef.current = fitAnimate
    fitInputRef.current = { markers, polylines }
  })

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

  // 3b. สั่งกล้องไปจุดที่ระบุ — แยกจาก center/zoom ข้างบนโดยตั้งใจ: center/zoom เป็น "ค่าตั้งต้น" ที่ขยับเมื่อ prop เปลี่ยนจริงเท่านั้น
  // (ผู้ใช้ลากแผนที่ไปที่อื่นแล้ว กดเรื่องเดิมซ้ำ ค่า prop ยังเท่าเดิม กล้องจึงไม่กลับ) ส่วน flyTo ขยับทุกครั้งที่ nonce เปลี่ยน
  // lastFlyRef กันยิงซ้ำตอน re-render ด้วย nonce เดิม
  const lastFlyRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !flyTo || !isPoint(flyTo) || flyTo.nonce === lastFlyRef.current) return
    lastFlyRef.current = flyTo.nonce
    map.setView([Number(flyTo.lat), Number(flyTo.lng)], Number(flyTo.zoom) || map.getZoom(), { animate: true })
  }, [flyTo])

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

      // markerData.nameLabel = ป้ายชื่อที่ "แสดงค้าง" ใต้หมุด (ต่างจาก tooltip ที่ขึ้นแค่ตอนเอาเมาส์ชี้ — บนมือถือไม่มี hover เลย)
      // ผู้เรียกส่งมาเฉพาะหมุดที่อยากให้เห็นชื่อ ไม่ส่ง = หน้าตาหมุดเหมือนเดิมทุกประการ · ป้ายไม่รับการกด (pointer-events: none)
      // เพื่อไม่บังหมุดข้างเคียงที่อยู่ใต้ป้าย · ชื่อมาจากข้อมูลที่ผู้ใช้กรอก จึง escape ทุกครั้ง
      // markerData.nameColor = สีกรอบ/ตัวอักษรของป้าย (ไม่ส่ง = ใช้สีเดียวกับหมุดเหมือนเดิม) — มีไว้ให้หมุดที่สีพื้นอ่อนจงใจ
      // (เช่น สถานศึกษา #93c5fd เพื่อให้อิโมจิเห็นชัด) ส่งสีเข้มมาแทน ไม่งั้นตัวอักษรอ่อนบนพื้นขาวอ่านไม่ออก
      const nameText = markerData.nameLabel ? String(markerData.nameLabel).trim() : ''
      if (nameText) {
        const nameColor = safeColor(markerData.nameColor || color)
        iconHtml = `
          <div style="position: relative; width: ${size}px; height: ${size}px;">
            ${iconHtml}
            <div style="position: absolute; left: 50%; top: 100%; transform: translateX(-50%); margin-top: 3px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(255,255,255,0.95); color: ${nameColor}; border: 1px solid ${nameColor}; border-radius: 6px; padding: 1px 7px; font-size: 12px; font-weight: 700; line-height: 17px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); pointer-events: none;">${escapeHtml(nameText)}</div>
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

  // 5b. Render Circles — วงรัศมี (เช่น 1/2 กม. รอบฟาร์มที่ถูกร้องเรียน)
  // interactive:false โดยตั้งใจ: วงใหญ่คลุมหมุดและพื้นแผนที่ไว้ทั้งก้อน ถ้ารับการกดเอง จะกลืนการกดหมุดข้างใต้
  // และทำให้ onMapClick (กดที่ว่างเพื่อปิดการ์ด) ไม่ทำงานทั้งที่กดในวง
  // รัศมีเป็นเมตรจริง (L.circle ไม่ใช่ circleMarker ที่รัศมีเป็นพิกเซล) จึงยืด/หดตามระดับซูมให้เอง
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    circleLayersRef.current.forEach(l => map.removeLayer(l))
    circleLayersRef.current = []

    circles.filter(c => isPoint(c.center) && Number(c.radius) > 0).forEach(circleData => {
      const center = [Number(circleData.center.lat), Number(circleData.center.lng)]
      const radius = Number(circleData.radius)
      const color = safeColor(circleData.color || '#dc2626')

      const circle = L.circle(center, {
        radius,
        color,
        weight: circleData.weight ?? 2,
        opacity: circleData.opacity ?? 0.9,
        fillColor: safeColor(circleData.fillColor || circleData.color || '#dc2626'),
        fillOpacity: circleData.fillOpacity ?? 0.08,
        dashArray: circleData.dashArray ? '7, 7' : undefined,
        interactive: false,
      })
      circle.addTo(map)
      circleLayersRef.current.push(circle)

      if (circleData.label) {
        // ป้ายอยู่ที่ขอบวง ไม่ใช่กลางวง (กลางวงคือหมุดต้นทางและวงซ้อนกัน) และ "คนละมุม" ตามลำดับวง:
        // วงในอยู่ทิศเหนือ วงถัดไปเอียงไปทางตะวันออกทีละ 40° ถ้าทุกวงใช้ทิศเหนือ ที่ซูมออกวง 500 ม./1 กม./2 กม.
        // จะอยู่ห่างกันไม่กี่พิกเซล ป้ายซ้อนทับกันจนอ่านไม่ออก (เจอตอนทดสอบหน้าจอจริง) · labelAngle ผู้เรียกกำหนดเองได้
        const angle = ((circleData.labelAngle ?? 0) * Math.PI) / 180
        const labelPos = [
          center[0] + (radius * Math.cos(angle)) / 111320,
          center[1] + (radius * Math.sin(angle)) / (111320 * Math.max(0.01, Math.cos((center[0] * Math.PI) / 180))),
        ]
        const labelMarker = L.marker(labelPos, {
          interactive: false,
          keyboard: false,
          zIndexOffset: -500,
          icon: L.divIcon({
            className: 'smartlocal-circle-label',
            iconSize: [0, 0],
            iconAnchor: [0, 0],
            html: `<div style="transform: translate(-50%, -50%); white-space: nowrap; background: rgba(255,255,255,0.94); color: ${color}; border: 1px solid ${color}; border-radius: 9999px; padding: 1px 8px; font-size: 11px; font-weight: 700; line-height: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.25); pointer-events: none;">${escapeHtml(circleData.label)}</div>`,
          }),
        })
        labelMarker.addTo(map)
        circleLayersRef.current.push(labelMarker)
      }
    })
  }, [circles])

  // 6. Fit Bounds — อ่านหมุด/เส้นจาก fitInputRef (อัปเดตทุก render โดย effect ด้านบน) เพื่อให้ effect refitSignal ด้านล่างเรียกซ้ำได้
  // ด้วยข้อมูลล่าสุดโดยไม่ต้องผูกกับ props · force = ข้ามการเทียบ signature (กรอบเปลี่ยนขนาดแต่หมุดชุดเดิม)
  const runFit = useCallback(force => {
    const map = mapRef.current
    if (!map) return
    const { markers: fitMarkers, polylines: fitPolylines } = fitInputRef.current
    const points = [
      ...fitMarkers.map(m => m.position),
      ...fitPolylines.flatMap(l => l.path || []),
    ].filter(isPoint)

    const signature = points.map(p => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`).join('|')
    if (points.length && (force || signature !== lastFitSignatureRef.current)) {
      const bounds = L.latLngBounds(points.map(p => [Number(p.lat), Number(p.lng)]))
      const wanted = typeof fitPaddingRef.current === 'function' ? fitPaddingRef.current() : fitPaddingRef.current
      const pad = { top: 40, right: 40, bottom: 40, left: 40, ...(wanted || {}) }
      map.fitBounds(bounds, { paddingTopLeft: [pad.left, pad.top], paddingBottomRight: [pad.right, pad.bottom], maxZoom: 16, ...(fitAnimateRef.current ? {} : { animate: false }) })
      lastFitSignatureRef.current = signature
      fitTouchedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!fitBounds) return
    runFit(false)
  }, [markers, polylines, fitBounds, runFit])

  // 6b. fit ใหม่เมื่อผู้เรียกบอกว่ารูปทรงหน้าเปลี่ยน (refitSignal) — ยกเว้นผู้ใช้แตะแผนที่เองไปแล้ว ห้ามดึงกล้องกลับ
  // เคสจริง: หน้าแผนที่ประชาชน fit ตอนข้อมูลมาถึง แต่แถบสถิติหัวหน้าโหลดทีหลังดันแผนที่ลง ~60px หมุดเลยเลื่อนไปชิดแผงล่าง
  // (ขนาดของ Leaflet container ไม่เปลี่ยน — มันสูง 70vh ตายตัว — ResizeObserver ที่ตัวแผนที่เองจึงจับไม่ได้ ต้องให้ผู้เรียกบอก)
  useEffect(() => {
    const el = containerRef.current
    if (!fitBounds || !el) return undefined
    const markTouched = () => { fitTouchedRef.current = true }
    const touchEvents = ['pointerdown', 'wheel', 'keydown']
    touchEvents.forEach(name => el.addEventListener(name, markTouched, { passive: true }))
    return () => touchEvents.forEach(name => el.removeEventListener(name, markTouched))
  }, [fitBounds])

  useEffect(() => {
    if (!fitBounds || !refitSignal || fitTouchedRef.current) return
    mapRef.current?.invalidateSize({ animate: false })
    runFit(true)
  }, [refitSignal, fitBounds, runFit])

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
