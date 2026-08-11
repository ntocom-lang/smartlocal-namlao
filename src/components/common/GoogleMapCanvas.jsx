import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Layers, Loader2, Map as MapIcon } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { loadGoogleMaps } from '../../lib/googleMaps'

const isPoint = point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))



/**
 * Native Google Maps canvas used by every map surface in SmartLocal.
 */
export default function GoogleMapCanvas({
  center,
  zoom = 15,
  mapTypeId = 'roadmap',
  mapId,
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
  options = {},
}) {
  const { tenant } = useTenant()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const googleRef = useRef(null)
  const overlaysRef = useRef([])
  const dataFeaturesRef = useRef([])
  const boundaryPolylineRef = useRef(null)
  const infoWindowRef = useRef(null)
  const callbacksRef = useRef({ onMapClick, onMapRightClick, onFeatureClick, onFeatureRightClick, onPolylineRightClick, onMarkerDragEnd, onMapReady })
  const lastFitSignatureRef = useRef('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mapReadyState, setMapReadyState] = useState(0)
  const [activeMapType, setActiveMapType] = useState(mapTypeId)

  function changeMapType(type) {
    setActiveMapType(type)
    if (mapRef.current) {
      mapRef.current.setMapTypeId(type)
    }
  }

  const apiKey = (tenant?.google_maps_api_key && tenant.google_maps_api_key.trim()) || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  const effectiveMapId = mapId || import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'
  const safeCenter = useMemo(() => isPoint(center)
    ? { lat: Number(center.lat), lng: Number(center.lng) }
    : {
        lat: Number(tenant?.latitude) || 18.1448,
        lng: Number(tenant?.longitude) || 100.1167,
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
  
  useEffect(() => {
    let active = true

    if (!apiKey) {
      return () => { active = false }
    }

    loadGoogleMaps(apiKey).then(res => {
      if (!active || !containerRef.current) return
      const google = res?.google || window.google
      googleRef.current = google
      const MapClass = res?.Map || res?.mapsLib?.Map || google?.maps?.Map || window.google?.maps?.Map
      if (!MapClass) throw new Error('Google Maps JS API Map class is not loaded yet')
      const map = new MapClass(containerRef.current, {
        center: safeCenter,
        zoom,
        mapTypeId: activeMapType,
        mapId: effectiveMapId,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        ...options,
      })
      mapRef.current = map
      map.addListener('click', event => {
        callbacksRef.current.onMapClick?.({ lat: event.latLng.lat(), lng: event.latLng.lng() })
      })
      map.addListener('rightclick', event => {
        const point = { lat: event.latLng.lat(), lng: event.latLng.lng() }
        const screen = event.domEvent ? { clientX: event.domEvent.clientX, clientY: event.domEvent.clientY } : null
        event.domEvent?.preventDefault?.()
        callbacksRef.current.onMapRightClick?.(point, screen)
      })
      callbacksRef.current.onMapReady?.(map, google)
      setError('')
      setLoading(false)
      setMapReadyState(prev => prev + 1)
    }).catch(err => {
      if (!active) return
      console.error('[GoogleMapCanvas] Google Maps API unavailable:', err)
      setError('โหลด Google Maps ไม่สำเร็จ กรุณาตรวจ API Key, Billing, API ที่เปิดใช้งาน และ HTTP Referrer restriction')
      setLoading(false)
    })

    return () => {
      active = false
      overlaysRef.current.forEach(overlay => {
        if ('map' in overlay) overlay.map = null
        else overlay.setMap?.(null)
      })
      overlaysRef.current = []
      mapRef.current = null
      googleRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, effectiveMapId])

  const prevZoomRef = useRef(zoom)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (prevZoomRef.current !== zoom) {
      map.setZoom(zoom)
      prevZoomRef.current = zoom
    }
  }, [zoom])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isPoint(safeCenter)) return
    const currentCenter = map.getCenter()
    if (currentCenter) {
      const dist = Math.hypot(safeCenter.lat - currentCenter.lat(), safeCenter.lng - currentCenter.lng())
      if (dist > 0.0003) {
        map.setCenter(safeCenter)
      }
    }
  }, [safeCenter])

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapTypeId)
  }, [mapTypeId])

  useEffect(() => {
    const map = mapRef.current
    const google = googleRef.current
    if (!map || !google) return

    overlaysRef.current.forEach(overlay => {
      google.maps.event.clearInstanceListeners(overlay)
      if (typeof overlay.setMap === 'function') {
        overlay.setMap(null)
      }
      if ('map' in overlay) {
        overlay.map = null
      }
    })
    overlaysRef.current = []

    markers.filter(marker => isPoint(marker.position)).forEach(markerData => {
      const AdvancedMarkerElement = google.maps.marker?.AdvancedMarkerElement
      const PinElement = google.maps.marker?.PinElement
      if (!AdvancedMarkerElement) return

      const isDraggable = Boolean(markerData.draggable)
      const marker = new AdvancedMarkerElement({
        map,
        position: { lat: Number(markerData.position.lat), lng: Number(markerData.position.lng) },
        title: markerData.title || '',
        zIndex: markerData.zIndex,
        gmpClickable: true,
        gmpDraggable: isDraggable,
      })

      if (markerData.iconUrl) {
        const iconWrapper = document.createElement('div')
        const iconSize = markerData.scale ? Math.max(34, markerData.scale * 3) : 44
        iconWrapper.style.width = String(iconSize) + 'px'
        iconWrapper.style.height = String(iconSize) + 'px'
        iconWrapper.style.display = 'flex'
        iconWrapper.style.alignItems = 'center'
        iconWrapper.style.justifyContent = 'center'
        iconWrapper.style.borderRadius = '50%'
        iconWrapper.style.background = markerData.color || '#ef4444'
        iconWrapper.style.border = '3px solid #ffffff'
        iconWrapper.style.boxShadow = '0 3px 10px rgba(15, 23, 42, 0.3)'
        iconWrapper.style.overflow = 'hidden'

        const iconImage = document.createElement('img')
        iconImage.src = markerData.iconUrl
        iconImage.alt = ''
        iconImage.style.width = '72%'
        iconImage.style.height = '72%'
        iconImage.style.objectFit = 'contain'
        iconImage.addEventListener('error', () => {
          iconImage.remove()
          iconWrapper.textContent = markerData.label || '📍'
        })
        iconWrapper.append(iconImage)
        marker.append(iconWrapper)
      } else if (PinElement) {
        marker.append(new PinElement({
          background: markerData.color || '#ef4444',
          borderColor: '#ffffff',
          glyphColor: markerData.labelColor || '#ffffff',
          glyphText: markerData.label ? String(markerData.label) : '',
          scale: markerData.scale ? (markerData.scale / 10) : 1.6,
        }))
      }

      if (isDraggable) {
        const handleDragEnd = (event) => {
          let pos = null
          if (event.latLng) {
            pos = { lat: event.latLng.lat(), lng: event.latLng.lng() }
          } else if (marker.position) {
            const p = marker.position
            pos = {
              lat: typeof p.lat === 'function' ? p.lat() : Number(p.lat),
              lng: typeof p.lng === 'function' ? p.lng() : Number(p.lng),
            }
          }
          if (pos) {
            markerData.onDragEnd?.(pos)
            callbacksRef.current.onMarkerDragEnd?.(markerData, pos)
          }
        }
        marker.addListener('dragend', handleDragEnd)
        marker.addListener('gmp-dragend', handleDragEnd)
      }

      marker.addListener('click', () => {
        if (markerData.title || markerData.infoHtml) {
          const infoWindow = infoWindowRef.current || new google.maps.InfoWindow()
          infoWindowRef.current = infoWindow
          const titleText = markerData.title || ''
          const subtitleText = markerData.subtitle || markerData.entry?.group_name || ''
          const lat = markerData.position.lat
          const lng = markerData.position.lng
          const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

          const htmlContent = markerData.infoHtml || `
            <div style="font-family: 'Sarabun', system-ui, sans-serif; padding: 2px 2px 0 0; min-width: 175px; max-width: 240px; box-sizing: border-box;">
              <div style="font-weight: 800; font-size: 14px; color: #0f172a; line-height: 1.35; margin-bottom: 2px; padding-right: 18px;">${titleText}</div>
              ${subtitleText ? `<div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 10px; line-height: 1.3;">${subtitleText}</div>` : '<div style="margin-bottom: 8px;"></div>'}
              <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer"
                style="display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 12px; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; padding: 7px 12px; font-size: 11px; font-weight: 700; text-decoration: none; box-shadow: 0 2px 8px rgba(37,99,235,0.22); text-align: center; transition: all 0.15s ease;">
                <span>📍 เปิดใน Google Maps</span>
              </a>
            </div>
          `
          infoWindow.setContent(htmlContent)
          infoWindow.open({ map, anchor: marker })
        }
        callbacksRef.current.onFeatureClick?.(markerData)
      })
      // AdvancedMarkerElement เป็น DOM element จริง ไม่ใช่ MVCObject แบบ Marker คลาสสิก — 'rightclick' ผ่าน
      // marker.addListener() ใช้ไม่ได้ (ไม่มี event ชื่อนี้ให้ ไม่ error แค่ไม่ยิงเงียบๆ) ต้องผูกผ่าน
      // native addEventListener('contextmenu', ...) บนตัว element โดยตรงแทน
      marker.addEventListener('contextmenu', event => {
        event.preventDefault()
        const screen = { clientX: event.clientX, clientY: event.clientY }
        if (callbacksRef.current.onFeatureRightClick) {
          callbacksRef.current.onFeatureRightClick(markerData, screen)
          return
        }
        // ไม่มี onFeatureRightClick เจาะจง — เข้ากันได้กับโค้ดเดิมที่คลิกขวาบนหมุดก็ยังนับเป็น
        // คลิกขวาบนแผนที่ทั่วไป (ส่งพิกัดของหมุดนั้นแทนพิกัดจริงจาก event ซึ่งไม่มี latLng ให้)
        callbacksRef.current.onMapRightClick?.(markerData.position, screen)
      })
      overlaysRef.current.push(marker)
    })

    polylines.filter(line => Array.isArray(line.path) && line.path.length >= 2).forEach(lineData => {
      const dashed = Boolean(lineData.dashArray)
      const line = new google.maps.Polyline({
        map,
        path: lineData.path.filter(isPoint).map(point => ({ lat: Number(point.lat), lng: Number(point.lng) })),
        strokeColor: lineData.color || '#2563eb',
        strokeOpacity: dashed ? 0 : (lineData.opacity ?? 0.9),
        strokeWeight: lineData.weight || 4,
        clickable: true,
        icons: dashed ? [{
          icon: {
            path: 'M 0,-1 0,1',
            strokeColor: lineData.color || '#2563eb',
            strokeOpacity: lineData.opacity ?? 0.9,
            strokeWeight: lineData.weight || 4,
            scale: 3,
          },
          offset: '0',
          repeat: '14px',
        }] : undefined,
      })
      line.addListener('click', () => callbacksRef.current.onFeatureClick?.(lineData))
      line.addListener('rightclick', event => {
        const point = event.latLng ? { lat: event.latLng.lat(), lng: event.latLng.lng() } : null
        const screen = event.domEvent ? { clientX: event.domEvent.clientX, clientY: event.domEvent.clientY } : null
        event.domEvent?.preventDefault?.()
        // event.edge (ดัชนีช่วงเส้นที่คลิกโดน) ใช้ได้เฉพาะ Polyline ที่ตั้ง editable: true เท่านั้น — เส้นนี้ตั้งใจ
        // ไม่เปิด editable (กันมือจับลาก/แทรกจุดของ Google เองมาซ้อนกับหมุดเลขกำกับที่ทำเองอยู่แล้ว) จึง
        // undefined เสมอ ปล่อยให้ผู้เรียกใช้ (เช่น InlinePolylinePicker) คำนวณช่วงที่ใกล้ที่สุดเองจากพิกัดแทน
        if (callbacksRef.current.onPolylineRightClick && point) {
          callbacksRef.current.onPolylineRightClick(lineData, point, screen)
          return
        }
        callbacksRef.current.onMapRightClick?.(point, screen)
      })
      overlaysRef.current.push(line)
    })

    if (fitBounds) {
      const points = [
        ...markers.map(marker => marker.position),
        ...polylines.flatMap(line => line.path || []),
      ].filter(isPoint)
      const signature = points.map(point => `${Number(point.lat).toFixed(5)},${Number(point.lng).toFixed(5)}`).join('|')
      if (points.length && signature !== lastFitSignatureRef.current) {
        const bounds = new google.maps.LatLngBounds()
        points.forEach(point => bounds.extend({ lat: Number(point.lat), lng: Number(point.lng) }))
        map.fitBounds(bounds, 48)
        if (points.length === 1) google.maps.event.addListenerOnce(map, 'idle', () => map.setZoom(Math.min(map.getZoom(), 16)))
        lastFitSignatureRef.current = signature
      }
    }
  }, [markers, polylines, fitBounds, mapReadyState])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    dataFeaturesRef.current.forEach(feature => map.data.remove(feature))
    dataFeaturesRef.current = []
    if (boundaryPolylineRef.current) {
      boundaryPolylineRef.current.setMap(null)
      boundaryPolylineRef.current = null
    }

    if (!effectiveBoundaryGeoJson) return
    try {
      dataFeaturesRef.current = map.data.addGeoJson(effectiveBoundaryGeoJson)
      map.data.setStyle({
        strokeOpacity: 0,
        fillColor: '#ef4444',
        fillOpacity: 0.08,
        clickable: false,
      })

      const googleObj = googleRef.current || window.google
      const feature = effectiveBoundaryGeoJson.features?.[0]
      const coords = feature?.geometry?.coordinates?.[0]
      if (googleObj?.maps && Array.isArray(coords) && coords.length >= 3) {
        const ringPath = coords.map(pt => ({ lat: Number(pt[1]), lng: Number(pt[0]) }))
        const dashedBorder = new googleObj.maps.Polyline({
          map,
          path: ringPath,
          strokeColor: '#dc2626',
          strokeOpacity: 0,
          strokeWeight: 3,
          clickable: false,
          zIndex: 10,
          icons: [{
            icon: {
              path: 'M 0,-1 0,1',
              strokeColor: '#dc2626',
              strokeOpacity: 0.95,
              strokeWeight: 3,
              scale: 3,
            },
            offset: '0',
            repeat: '13px',
          }],
        })
        boundaryPolylineRef.current = dashedBorder
      }
    } catch (err) {
      console.warn('[GoogleMapCanvas] Invalid municipality boundary:', err)
    }
  }, [effectiveBoundaryGeoJson, mapReadyState])

  useEffect(() => {
    if (!containerRef.current || !globalThis.ResizeObserver) return undefined
    const observer = new ResizeObserver(() => {
      const map = mapRef.current
      const google = googleRef.current
      if (map && google) google.maps.event.trigger(map, 'resize')
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={`relative overflow-hidden bg-gray-100 ${className}`}
      onContextMenu={(e) => {
        if (callbacksRef.current.onMapRightClick) {
          e.preventDefault()
        }
      }}
    >
      <div ref={containerRef} className="absolute inset-0" aria-label="Google Maps" />

      {!loading && !error && (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-2xl border border-gray-200/80 bg-white/95 p-1 shadow-lg backdrop-blur-xs">
          <button
            type="button"
            onClick={() => changeMapType('roadmap')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all active:scale-95 ${
              activeMapType === 'roadmap'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <MapIcon size={14} />
            <span>แผนที่</span>
          </button>
          <button
            type="button"
            onClick={() => changeMapType('hybrid')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all active:scale-95 ${
              activeMapType === 'hybrid' || activeMapType === 'satellite'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Layers size={14} />
            <span>ดาวเทียม</span>
          </button>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-gray-50/90 text-sm font-semibold text-gray-500">
          <Loader2 size={20} className="animate-spin text-blue-600" /> กำลังโหลด Google Maps...
        </div>
      )}
      {(error || !apiKey) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-5 bg-amber-50 text-amber-800">
          <div className="max-w-md text-center">
            <AlertTriangle size={26} className="mx-auto mb-2 text-amber-600" />
            <p className="text-sm font-bold">ไม่สามารถแสดง Google Maps</p>
            <p className="mt-1 text-xs leading-relaxed">{error || 'ยังไม่ได้ตั้งค่า Google Maps API Key สำหรับหน่วยงานนี้'}</p>
          </div>
        </div>
      )}
    </div>
  )
}
