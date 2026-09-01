import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, LocateFixed, MapPin, Search, X, Loader2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTenant } from '../../contexts/TenantContext'
import LeafletMapCanvas from './LeafletMapCanvas'

const validPoint = point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))

export default function LeafletMapPicker({
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
  placeholder = 'ค้นหาบ้านเลขที่ ชื่อสถานที่ หรือถนนในประเทศไทย...',
}) {
  const { tenant } = useTenant()
  const mapRef = useRef(null)
  const isMountedRef = useRef(true)
  const autoLocateAttemptedRef = useRef(false)
  const pendingAutoCoordRef = useRef(null)
  const debounceTimerRef = useRef(null)

  const [locating, setLocating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [showResults, setShowResults] = useState(false)

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
    selectedRef.current = location
    setSelected(location)
    onLocationSelect?.(location)
  }, [onLocationSelect])

  // Reverse Geocode using OpenStreetMap Nominatim with debouncing & Thai language
  const reverseGeocode = useCallback(point => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&zoom=18&addressdetails=1&accept-language=th`,
          { headers: { 'User-Agent': 'SmartLocal-GIS/1.1' } }
        )
        if (res.ok) {
          const data = await res.json()
          const raw = data.display_name || ''
          // Clean up excessively long OSM string
          const formatted = raw ? raw.split(',').slice(0, 4).join(',').trim() : `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
          commitSelection({ ...point, address: formatted })
        } else {
          commitSelection({ ...point, address: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` })
        }
      } catch (err) {
        console.warn('[LeafletMapPicker] Reverse geocoding failed:', err)
        commitSelection({ ...point, address: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` })
      }
    }, 450)
  }, [commitSelection])

  // Search places in Thailand via Nominatim
  async function handleSearch(e) {
    if (e) e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return

    setSearching(true)
    setShowResults(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=th&limit=5&accept-language=th`,
        { headers: { 'User-Agent': 'SmartLocal-GIS/1.1' } }
      )
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data || [])
      } else {
        setSearchResults([])
      }
    } catch (err) {
      console.warn('[LeafletMapPicker] Place search error:', err)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  function handleSelectPlace(item) {
    const next = {
      lat: Number(item.lat),
      lng: Number(item.lon),
      address: item.display_name || searchQuery,
    }
    setShowResults(false)
    setSearchQuery(item.display_name?.split(',')[0] || searchQuery)
    if (mapRef.current) {
      mapRef.current.setView([next.lat, next.lng], 17)
    }
    commitSelection(next)
  }

  // HTML5 GPS Geolocation
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
          mapRef.current.setView([point.lat, point.lng], 18)
        }
        reverseGeocode(point)
        setLocating(false)
      },
      err => {
        if (!isMountedRef.current) return
        setLocating(false)
        if (!silent) {
          if (err?.code === 1) alert('ยังไม่ได้อนุญาตให้เว็บไซต์ใช้ตำแหน่ง กรุณาเปิดสิทธิ์ Location ในตั้งค่าเบราว์เซอร์')
          else if (err?.code === 3) alert('ค้นหาตำแหน่งนานเกินไป กรุณาเปิด GPS แล้วลองใหม่ในที่โล่ง')
          else alert('อ่านตำแหน่งปัจจุบันไม่สำเร็จ กรุณาเปิด GPS แล้วลองใหม่')
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    )
  }, [commitSelection, reverseGeocode])

  const handleMapReady = useCallback((map) => {
    mapRef.current = map
    if (readOnly) return

    if (pendingAutoCoordRef.current) {
      map.setView([pendingAutoCoordRef.current.lat, pendingAutoCoordRef.current.lng], 18)
      reverseGeocode(pendingAutoCoordRef.current)
    } else if (!initialPos?.address) {
      const center = map.getCenter()
      if (center) {
        reverseGeocode({ lat: center.lat, lng: center.lng })
      }
    }

    if (fixedCenterPin) {
      map.on('moveend', () => {
        const center = map.getCenter()
        if (!center) return
        const point = { lat: center.lat, lng: center.lng }
        const prev = selectedRef.current
        const distanceMoved = Math.hypot(point.lat - prev.lat, point.lng - prev.lng)
        if (distanceMoved > 0.00008) {
          reverseGeocode(point)
        }
      })
    }
  }, [readOnly, fixedCenterPin, initialPos?.address, reverseGeocode])

  useEffect(() => {
    isMountedRef.current = true
    if (!readOnly && autoLocate && !skipGeolocation && !validPoint(initialPos) && !autoLocateAttemptedRef.current) {
      autoLocateAttemptedRef.current = true
      locateMe(true)
    }
    return () => {
      isMountedRef.current = false
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [readOnly, autoLocate, skipGeolocation, initialPos, locateMe])

  const picker = (
    <div className={isModal ? 'flex h-full min-h-0 flex-col bg-white' : 'w-full space-y-3'}>
      {/* Search Header */}
      <div className={`relative flex items-center gap-2 ${isModal ? 'shrink-0 border-b border-gray-100 p-3' : ''}`}>
        {!readOnly && (
          <form onSubmit={handleSearch} className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowResults(true)}
                placeholder={placeholder}
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800 shadow-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setSearchResults([]); setShowResults(false) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={searching}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-all hover:border-blue-300 hover:text-blue-600 active:scale-95 disabled:opacity-50"
              title="ค้นหาข้อความ"
            >
              {searching ? <Loader2 size={16} className="animate-spin text-blue-600" /> : <Search size={17} />}
            </button>
          </form>
        )}
        {isModal && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100"
            aria-label="ปิด"
          >
            <X size={20} />
          </button>
        )}

        {/* Autocomplete Dropdown */}
        {showResults && searchResults.length > 0 && (
          <div className="absolute left-3 right-14 top-full z-50 mt-1 max-h-60 overflow-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
            {searchResults.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectPlace(item)}
                className="flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left text-xs transition-colors hover:bg-blue-50/80"
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-blue-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-800 line-clamp-1">{item.name || item.display_name?.split(',')[0]}</p>
                  <p className="text-[11px] text-gray-500 line-clamp-2">{item.display_name}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map Canvas */}
      <div className={isModal ? 'relative min-h-0 flex-1' : 'relative overflow-hidden rounded-2xl border border-gray-200 shadow-sm'}>
        <LeafletMapCanvas
          center={selected}
          zoom={zoom}
          mapTypeId="hybrid"
          boundaryGeoJson={showBoundary ? undefined : false}
          className={isModal ? 'w-full h-full min-h-[360px]' : mapClassName}
          onMapClick={readOnly ? undefined : (point) => {
            if (mapRef.current) mapRef.current.panTo([point.lat, point.lng])
            reverseGeocode(point)
          }}
          onMapReady={handleMapReady}
          markers={(readOnly || !fixedCenterPin) && validPoint(selected) ? [{ id: 'selected-location', position: selected, color: '#ef4444', scale: 17, title: 'ตำแหน่งที่เลือก' }] : []}
        />

        {/* GPS Locate Button */}
        {!readOnly && (
          <button
            type="button"
            onClick={() => locateMe(false)}
            disabled={locating}
            className="absolute bottom-12 left-3 z-10 flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-lg transition-transform active:scale-95 disabled:opacity-70"
            title="ไปยังตำแหน่งปัจจุบันของฉัน"
            aria-label="ตำแหน่งปัจจุบันของฉัน"
          >
            <LocateFixed size={16} className={locating ? 'animate-pulse' : ''} />
            {locating ? 'กำลังหาตำแหน่ง...' : 'ตำแหน่งของฉัน'}
          </button>
        )}

        {/* Center Pin Indicator */}
        {!readOnly && fixedCenterPin && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center">
            <div className="relative text-red-600 transition-transform active:scale-110 drop-shadow-xl">
              <MapPin size={42} className="fill-red-600 text-white" />
            </div>
            <div className="mt-[-6px] h-2 w-4 rounded-full bg-black/35 blur-[1px]" />
          </div>
        )}
      </div>

      {/* Footer Address Info */}
      <div className={`flex items-center gap-3 bg-white ${isModal ? 'shrink-0 border-t border-gray-100 p-3' : 'rounded-xl border border-gray-200 p-3'}`}>
        <MapPin size={20} className="shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-800">{selected.address || 'ตำแหน่งที่เลือกบนแผนที่'}</p>
          <p className="font-mono text-[11px] text-gray-400">{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</p>
        </div>
        {isModal && onConfirm && (
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
          >
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
