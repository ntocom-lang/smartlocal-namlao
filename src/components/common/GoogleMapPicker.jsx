import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTenant } from '../../contexts/TenantContext'
import GoogleMapCanvas from './GoogleMapCanvas'
import LeafletMapPicker from './LeafletMapPicker'

const validPoint = point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))

export default function GoogleMapPicker({
  defaultLat,
  defaultLng,
  initialPos = null,
  fallbackPos = null,
  zoom = 16,
  onLocationSelect,
  onConfirm,
  onClose,
  readOnly = false,
  modal,
  fixedCenterPin = true,
  showBoundary = false,
  autoLocate = true,
  skipGeolocation = false,
  mapClassName = 'w-full h-80 min-h-[320px]',
  placeholder = 'ค้นหาบ้านเลขที่ ชื่อสถานที่ หรือถนน...',
}) {
  const { tenant } = useTenant()
  const apiKey = (tenant?.google_maps_api_key && tenant.google_maps_api_key.trim()) || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  const storedEngine = typeof window !== 'undefined' ? localStorage.getItem('smartlocal_map_engine') : null
  const effectiveEngine = storedEngine || tenant?.map_engine || 'leaflet'

  if (effectiveEngine === 'leaflet') {
    return (
      <LeafletMapPicker
        defaultLat={defaultLat}
        defaultLng={defaultLng}
        initialPos={initialPos}
        fallbackPos={fallbackPos}
        zoom={zoom}
        onLocationSelect={onLocationSelect}
        onConfirm={onConfirm}
        onClose={onClose}
        readOnly={readOnly}
        modal={modal}
        fixedCenterPin={fixedCenterPin}
        showBoundary={showBoundary}
        autoLocate={autoLocate}
        skipGeolocation={skipGeolocation}
        mapClassName={mapClassName}
        placeholder={placeholder}
      />
    )
  }
  const inputRef = useRef(null)
  const autocompleteHostRef = useRef(null)
  const mapRef = useRef(null)
  const googleRef = useRef(null)
  const autocompleteListenerRef = useRef(null)
  const isMountedRef = useRef(true)
  const autoLocateAttemptedRef = useRef(false)
  const pendingAutoCoordRef = useRef(null)
  const [locating, setLocating] = useState(false)

  const initialLocation = useMemo(() => {
    if (validPoint(initialPos)) return { lat: Number(initialPos.lat), lng: Number(initialPos.lng), address: initialPos.address || '' }
    if (validPoint(fallbackPos)) return { lat: Number(fallbackPos.lat), lng: Number(fallbackPos.lng), address: '' }
    return {
      lat: Number(tenant?.latitude) || Number(defaultLat) || 18.1448,
      lng: Number(tenant?.longitude) || Number(defaultLng) || 100.1167,
      address: '',
    }
  }, [initialPos, fallbackPos, defaultLat, defaultLng, tenant?.latitude, tenant?.longitude])

  const [selected, setSelected] = useState(initialLocation)
  const isModal = modal ?? Boolean(onConfirm || onClose)
  const selectedRef = useRef(initialLocation)

  const commitSelection = useCallback(location => {
    // อัปเดต ref ทันที (synchronous) ก่อน setState เพื่อไม่ให้ listener zoom_changed/idle
    // ของแผนที่อ่านพิกัดเก่าแล้วดึง center กลับที่เดิม
    selectedRef.current = location
    setSelected(location)
    onLocationSelect?.(location)
  }, [onLocationSelect])

  const reverseGeocode = useCallback(point => {
    const google = googleRef.current
    if (!google) {
      commitSelection({ ...point, address: '' })
      return
    }
    try {
      if (google.maps?.Geocoder) {
        new google.maps.Geocoder().geocode({ location: point, language: 'th', region: 'TH' }, (results, status) => {
          if (status === 'OK' && results?.[0]?.formatted_address) {
            commitSelection({ ...point, address: results[0].formatted_address })
          } else {
            commitSelection({ ...point, address: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` })
          }
        })
      } else {
        commitSelection({ ...point, address: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` })
      }
    } catch (err) {
      console.warn('[GoogleMapPicker] Geocoding service fallback:', err)
      commitSelection({ ...point, address: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` })
    }
  }, [commitSelection])

  const locateMe = useCallback((silent = false) => {
    if (!navigator.geolocation) {
      if (!silent) alert('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการอ่านตำแหน่ง')
      return
    }
    if (!window.isSecureContext) {
      if (!silent) alert('ต้องเปิดผ่าน HTTPS หรือ localhost จึงจะอ่านตำแหน่งปัจจุบันได้')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      position => {
        if (!isMountedRef.current) return
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        pendingAutoCoordRef.current = point
        commitSelection({ ...point, address: point.lat.toFixed(6) + ', ' + point.lng.toFixed(6) })
        if (mapRef.current) {
          mapRef.current.panTo(point)
          mapRef.current.setZoom(18)
        }
        reverseGeocode(point)
        setLocating(false)
      },
      err => {
        if (!isMountedRef.current) return
        setLocating(false)
        if (!silent) {
          if (err?.code === 1) alert('ยังไม่ได้อนุญาตให้เว็บไซต์ใช้ตำแหน่ง กรุณาเปิดสิทธิ์ Location ในตั้งค่าเบราว์เซอร์แล้วลองใหม่')
          else if (err?.code === 3) alert('ค้นหาตำแหน่งนานเกินไป กรุณาเปิด GPS แล้วลองใหม่ในที่โล่ง')
          else alert('อ่านตำแหน่งปัจจุบันไม่สำเร็จ กรุณาเปิด GPS แล้วลองใหม่')
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    )
  }, [commitSelection, reverseGeocode])

  const handleMapReady = useCallback((map, google) => {
    mapRef.current = map
    googleRef.current = google
    if (readOnly) return

    if (pendingAutoCoordRef.current) {
      map.panTo(pendingAutoCoordRef.current)
      map.setZoom(18)
      reverseGeocode(pendingAutoCoordRef.current)
    } else if (!initialPos?.address) {
      const center = map.getCenter()
      if (center) {
        reverseGeocode({ lat: center.lat(), lng: center.lng() })
      }
    }

    if (fixedCenterPin) {
      let lastZoom = map.getZoom()

      map.addListener('zoom_changed', () => {
        const prev = selectedRef.current
        if (prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lng)) {
          map.setCenter({ lat: prev.lat, lng: prev.lng })
        }
      })

      map.addListener('idle', () => {
        const currentZoom = map.getZoom()
        const center = map.getCenter()
        if (!center) return

        // If zoom level changed, anchor to exact selected coordinate and skip reverseGeocode
        if (currentZoom !== lastZoom) {
          lastZoom = currentZoom
          const prev = selectedRef.current
          if (prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lng)) {
            map.setCenter({ lat: prev.lat, lng: prev.lng })
          }
          return
        }

        // Only update coordinate when user actually pans/drags the map
        const point = { lat: center.lat(), lng: center.lng() }
        const prev = selectedRef.current
        const distanceMoved = Math.hypot(point.lat - prev.lat, point.lng - prev.lng)
        if (distanceMoved > 0.00008) {
          reverseGeocode(point)
        }
      })
    }

    if (!autocompleteHostRef.current) return

    try {
      const PlaceAutocompleteElement = google.maps?.places?.PlaceAutocompleteElement
      if (PlaceAutocompleteElement) {
        autocompleteListenerRef.current?.remove?.()
        const autocomplete = new PlaceAutocompleteElement({
          includedRegionCodes: ['th'],
          requestedLanguage: 'th',
          requestedRegion: 'TH',
        })
        autocomplete.placeholder = placeholder
        autocomplete.className = 'block w-full'
        autocomplete.style.width = '100%'
        autocomplete.style.colorScheme = 'light'

        const handleSelect = async event => {
          const place = event.placePrediction?.toPlace()
          if (!place) return
          await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'viewport'] })
          const location = place.location
          if (!location) return
          const next = {
            lat: location.lat(),
            lng: location.lng(),
            address: place.formattedAddress || place.displayName || '',
          }
          if (place.viewport) map.fitBounds(place.viewport)
          else {
            map.panTo(next)
            map.setZoom(17)
          }
          commitSelection(next)
        }

        autocomplete.addEventListener('gmp-select', handleSelect)
        autocompleteHostRef.current.replaceChildren(autocomplete)
        inputRef.current = autocomplete
        autocompleteListenerRef.current = {
          remove: () => {
            autocomplete.removeEventListener('gmp-select', handleSelect)
            autocomplete.remove()
            if (inputRef.current === autocomplete) inputRef.current = null
          },
        }
      }
    } catch (err) {
      console.warn('[GoogleMapPicker] PlaceAutocompleteElement init warning:', err)
    }
  }, [commitSelection, readOnly, reverseGeocode, initialPos?.address, fixedCenterPin, placeholder])

  useEffect(() => {
    isMountedRef.current = true
    if (!readOnly && autoLocate && !skipGeolocation && !validPoint(initialPos) && !autoLocateAttemptedRef.current) {
      autoLocateAttemptedRef.current = true
      locateMe(true)
    }
    return () => {
      isMountedRef.current = false
      autocompleteListenerRef.current?.remove?.()
    }
  }, [readOnly, autoLocate, skipGeolocation, initialPos, locateMe])

  function handleSearchSubmit(e) {
    if (e) e.preventDefault()
    const query = inputRef.current?.value?.trim()
    if (!query || !googleRef.current) return
    try {
      if (googleRef.current.maps?.Geocoder) {
        new googleRef.current.maps.Geocoder().geocode({ address: query, region: 'TH' }, (results, status) => {
          if (status === 'OK' && results?.[0]?.geometry?.location) {
            const location = results[0].geometry.location
            const next = {
              lat: location.lat(),
              lng: location.lng(),
              address: results[0].formatted_address || query,
            }
            mapRef.current?.panTo(next)
            mapRef.current?.setZoom(17)
            commitSelection(next)
          } else {
            alert('ไม่พบสถานที่ดังกล่าว กรุณาลองค้นหาด้วยชื่อถนน หรือสถานที่ใกล้เคียง')
          }
        })
      }
    } catch (err) {
      console.warn('[GoogleMapPicker] Search geocode error:', err)
      alert('ไม่สามารถเชื่อมต่อบริการค้นหาที่อยู่ได้ในขณะนี้')
    }
  }

  const picker = (
    <div className={isModal ? 'flex h-full min-h-0 flex-col bg-white' : 'w-full space-y-3'}>
      <div className={`flex items-center gap-2 ${isModal ? 'shrink-0 border-b border-gray-100 p-3' : ''}`}>
        {!readOnly && (
          <form onSubmit={handleSearchSubmit} className="flex min-w-0 flex-1 items-center gap-2">
            <div ref={autocompleteHostRef} className="min-h-10 min-w-0 flex-1 rounded-xl border border-gray-200 bg-white shadow-sm" />
            <button type="submit"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm hover:text-blue-600"
              title="ค้นหาข้อความที่พิมพ์">
              <Search size={17} />
            </button>
          </form>
        )}
        {isModal && onClose && (
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100" aria-label="ปิด">
            <X size={20} />
          </button>
        )}
      </div>

      <div className={isModal ? 'relative min-h-0 flex-1' : 'relative overflow-hidden rounded-2xl border border-gray-200 shadow-sm'}>
        <GoogleMapCanvas
          center={selected}
          zoom={zoom}
          mapTypeId="hybrid"
          boundaryGeoJson={showBoundary ? undefined : false}
          className={isModal ? 'w-full h-full min-h-[360px]' : mapClassName}
          onMapClick={readOnly ? undefined : (point) => {
            mapRef.current?.panTo(point)
            reverseGeocode(point)
          }}
          onMapReady={handleMapReady}
          markers={(readOnly || !fixedCenterPin) && validPoint(selected) ? [{ id: 'selected-location', position: selected, color: '#ef4444', scale: 17, title: 'ตำแหน่งที่เลือก' }] : []}
        />
        {!readOnly && (
          <button type="button" onClick={() => locateMe(false)} disabled={locating}
            className="absolute bottom-12 left-3 z-10 flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-lg transition-transform active:scale-95 disabled:opacity-70"
            title="ไปยังตำแหน่งปัจจุบันของฉัน" aria-label="ตำแหน่งปัจจุบันของฉัน">
            <LocateFixed size={16} className={locating ? 'animate-pulse' : ''} />
            {locating ? 'กำลังหาตำแหน่ง...' : 'ตำแหน่งของฉัน'}
          </button>
        )}
        {!readOnly && fixedCenterPin && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center">
            <div className="relative text-red-600 transition-transform active:scale-110 drop-shadow-xl">
              <MapPin size={42} className="fill-red-600 text-white" />
            </div>
            <div className="mt-[-6px] h-2 w-4 rounded-full bg-black/35 blur-[1px]" />
          </div>
        )}
      </div>

      <div className={`flex items-center gap-3 bg-white ${isModal ? 'shrink-0 border-t border-gray-100 p-3' : 'rounded-xl border border-gray-200 p-3'}`}>
        <MapPin size={20} className="shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-800">{selected.address || 'ตำแหน่งที่เลือกบน Google Maps'}</p>
          <p className="font-mono text-[11px] text-gray-400">{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</p>
        </div>
        {isModal && onConfirm && (
          <button type="button" onClick={() => onConfirm(selected)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700">
            <CheckCircle2 size={16} /> ยืนยันตำแหน่ง
          </button>
        )}
      </div>
    </div>
  )

  if (!isModal) return picker
  return createPortal(
    <div className="fixed inset-0 z-9999 bg-black/45 p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="mx-auto h-full max-w-6xl overflow-hidden bg-white shadow-2xl sm:rounded-2xl">{picker}</div>
    </div>,
    document.body,
  )
}
