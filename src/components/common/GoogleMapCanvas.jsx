import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Layers, Loader2, Map as MapIcon } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { loadGoogleMaps } from '../../lib/googleMaps'

const isPoint = point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))

const NAMLAO_DEFAULT_BOUNDARY_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'ขอบเขตตำบลน้ำเลา' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [100.272, 18.258],
          [100.268, 18.265],
          [100.275, 18.280],
          [100.292, 18.290],
          [100.318, 18.296],
          [100.345, 18.298],
          [100.368, 18.292],
          [100.388, 18.280],
          [100.398, 18.265],
          [100.390, 18.248],
          [100.370, 18.240],
          [100.355, 18.232],
          [100.335, 18.225],
          [100.320, 18.221],
          [100.300, 18.228],
          [100.282, 18.224],
          [100.270, 18.228],
          [100.268, 18.242],
          [100.272, 18.258],
        ]],
      },
    },
  ],
}

/**
 * Native Google Maps canvas used by every map surface in SmartLocal.
 * Markers and polylines are plain data so feature pages remain React-driven.
 */
export default function GoogleMapCanvas({
  center,
  zoom = 15,
  mapTypeId = 'roadmap',
  markers = [],
  polylines = [],
  boundaryGeoJson = null,
  fitBounds = false,
  onMapClick,
  onFeatureClick,
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
  const callbacksRef = useRef({ onMapClick, onFeatureClick, onMapReady })
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

  const apiKey = tenant?.google_maps_api_key || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  const safeCenter = useMemo(() => isPoint(center)
    ? { lat: Number(center.lat), lng: Number(center.lng) }
    : {
        lat: Number(tenant?.latitude) || 18.1448,
        lng: Number(tenant?.longitude) || 100.1167,
      }, [center, tenant?.latitude, tenant?.longitude])

  const effectiveBoundaryGeoJson = useMemo(() => {
    if (boundaryGeoJson) return boundaryGeoJson
    if (tenant?.boundary_geojson) return tenant.boundary_geojson
    if (tenant?.slug === 'namlao' || !tenant?.slug) return NAMLAO_DEFAULT_BOUNDARY_GEOJSON
    return null
  }, [boundaryGeoJson, tenant])

  useEffect(() => {
    callbacksRef.current = { onMapClick, onFeatureClick, onMapReady }
  }, [onMapClick, onFeatureClick, onMapReady])

  useEffect(() => {
    let active = true
    if (!apiKey) return undefined
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
        mapTypeControl: false,
        streetViewControl: true,
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
      callbacksRef.current.onMapReady?.(map, google)
      setError('')
      setLoading(false)
      setMapReadyState(prev => prev + 1)
    }).catch(err => {
      if (!active) return
      console.error('[GoogleMapCanvas] Google Maps load failed:', err)
      setError('โหลด Google Maps ไม่สำเร็จ กรุณาตรวจ API Key, Billing และ HTTP Referrer restriction')
      setLoading(false)
    })

    return () => {
      active = false
      overlaysRef.current.forEach(overlay => overlay.setMap?.(null))
      overlaysRef.current = []
      mapRef.current = null
      googleRef.current = null
    }
  // Map options are intentionally applied at creation; feature updates are handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isPoint(safeCenter)) return
    map.setCenter(safeCenter)
    map.setZoom(zoom)
  }, [safeCenter, zoom])

  useEffect(() => {
    mapRef.current?.setMapTypeId(mapTypeId)
  }, [mapTypeId])

  useEffect(() => {
    const map = mapRef.current
    const google = googleRef.current
    if (!map || !google) return

    overlaysRef.current.forEach(overlay => {
      google.maps.event.clearInstanceListeners(overlay)
      overlay.setMap?.(null)
    })
    overlaysRef.current = []

    markers.filter(marker => isPoint(marker.position)).forEach(markerData => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: Number(markerData.position.lat), lng: Number(markerData.position.lng) },
        title: markerData.title || '',
        zIndex: markerData.zIndex,
        icon: markerData.icon || {
          path: 'M 12,2 C 8.13,2 5,5.13 5,9 C 5,14.25 12,22 12,22 C 12,22 19,14.25 19,9 C 19,5.13 15.87,2 12,2 Z',
          fillColor: markerData.color || '#ef4444',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: 2,
          scale: markerData.scale ? (markerData.scale / 10) : 1.6,
          anchor: google.maps ? new google.maps.Point(12, 22) : undefined,
          labelOrigin: google.maps ? new google.maps.Point(12, 9) : undefined,
        },
        label: markerData.label ? {
          text: String(markerData.label),
          fontSize: markerData.labelSize || '15px',
          color: markerData.labelColor || '#ffffff',
          fontWeight: '700',
        } : undefined,
      })
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
            <div style="padding: 6px 8px; font-family: 'Sarabun', sans-serif; min-width: 170px; max-width: 250px;">
              <div style="font-weight: 800; font-size: 14px; color: #0f172a; margin-bottom: 2px; line-height: 1.3;">${titleText}</div>
              ${subtitleText ? `<div style="font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 8px;">${subtitleText}</div>` : ''}
              <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer"
                style="display: inline-flex; align-items: center; gap: 4px; border-radius: 9999px; background-color: #eff6ff; color: #2563eb; padding: 5px 10px; font-size: 11px; font-weight: 700; text-decoration: none;">
                📍 เปิดใน Google Maps
              </a>
            </div>
          `
          infoWindow.setContent(htmlContent)
          infoWindow.open({ map, anchor: marker })
        }
        callbacksRef.current.onFeatureClick?.(markerData)
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
    <div className={`relative overflow-hidden bg-gray-100 ${className}`}>
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
