import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTenant } from '../../contexts/TenantContext'
import GoogleMapCanvas from './GoogleMapCanvas'

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
  mapClassName = 'w-full h-80 min-h-[320px]',
  placeholder = 'ค้นหาบ้านเลขที่ ชื่อสถานที่ หรือถนน...',
}) {
  const { tenant } = useTenant()
  const inputRef = useRef(null)
  const mapRef = useRef(null)
  const googleRef = useRef(null)
  const autocompleteListenerRef = useRef(null)
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

  const commitSelection = useCallback(location => {
    setSelected(location)
    onLocationSelect?.(location)
  }, [onLocationSelect])

  const reverseGeocode = useCallback(point => {
    const google = googleRef.current
    if (!google) {
      commitSelection({ ...point, address: '' })
      return
    }
    new google.maps.Geocoder().geocode({ location: point, language: 'th', region: 'TH' }, (results, status) => {
      commitSelection({ ...point, address: status === 'OK' ? (results?.[0]?.formatted_address || '') : '' })
    })
  }, [commitSelection])

  const handleMapReady = useCallback((map, google) => {
    mapRef.current = map
    googleRef.current = google
    if (readOnly) return

    // Reverse geocode initial tenant position if no initial address
    if (!initialPos?.address) {
      const center = map.getCenter()
      if (center) {
        reverseGeocode({ lat: center.lat(), lng: center.lng() })
      }
    }

    if (fixedCenterPin) {
      map.addListener('idle', () => {
        const center = map.getCenter()
        if (!center) return
        const point = { lat: center.lat(), lng: center.lng() }
        const distanceMoved = Math.hypot(point.lat - selected.lat, point.lng - selected.lng)
        if (distanceMoved > 0.00005) {
          reverseGeocode(point)
        }
      })
    }

    if (!inputRef.current) return

    autocompleteListenerRef.current?.remove?.()
    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'th' },
      fields: ['geometry', 'name', 'formatted_address'],
    })
    autocomplete.bindTo('bounds', map)
    autocompleteListenerRef.current = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      const location = place?.geometry?.location
      if (!location) return
      const next = {
        lat: location.lat(),
        lng: location.lng(),
        address: place.formatted_address || place.name || '',
      }
      map.panTo(next)
      map.setZoom(17)
      commitSelection(next)
    })
  }, [commitSelection, readOnly, reverseGeocode, selected.lat, selected.lng, initialPos?.address, fixedCenterPin])

  useEffect(() => () => autocompleteListenerRef.current?.remove?.(), [])

  function locateMe() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(position => {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude }
      mapRef.current?.panTo(point)
      mapRef.current?.setZoom(18)
      reverseGeocode(point)
      setLocating(false)
    }, () => {
      setLocating(false)
      alert('ไม่สามารถอ่านตำแหน่งปัจจุบันได้ กรุณาอนุญาต Location ในเบราว์เซอร์')
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 })
  }

  function handleSearchSubmit(e) {
    if (e) e.preventDefault()
    const query = inputRef.current?.value?.trim()
    if (!query || !googleRef.current) return
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

  const picker = (
    <div className={isModal ? 'flex h-full min-h-0 flex-col bg-white' : 'w-full space-y-3'}>
      <div className={`flex items-center gap-2 ${isModal ? 'shrink-0 border-b border-gray-100 p-3' : ''}`}>
        {!readOnly && (
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600" title="ค้นหา">
              <Search size={17} />
            </button>
            <input ref={inputRef} type="search" placeholder={placeholder}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSubmit(e) }}
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </form>
        )}
        {!readOnly && (
          <button type="button" onClick={locateMe} disabled={locating}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-blue-600 shadow-sm disabled:opacity-50"
            title="ตำแหน่งปัจจุบัน">
            <LocateFixed size={18} className={locating ? 'animate-pulse' : ''} />
          </button>
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
          className={isModal ? 'w-full h-full min-h-[360px]' : mapClassName}
          onMapClick={readOnly ? undefined : (point) => {
            if (!fixedCenterPin) {
              reverseGeocode(point)
            } else {
              mapRef.current?.panTo(point)
            }
          }}
          onMapReady={handleMapReady}
          markers={(readOnly || !fixedCenterPin) && validPoint(selected) ? [{ id: 'selected-location', position: selected, color: '#ef4444', scale: 17, title: 'ตำแหน่งที่เลือก' }] : []}
        />
        {!readOnly && fixedCenterPin && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center">
            <div className="mb-1.5 flex items-center gap-1.5 rounded-full bg-gray-900/90 px-3 py-1 text-xs font-bold text-white shadow-lg backdrop-blur-xs">
              <span>เลื่อนแผนที่ให้หมุดตรงตำแหน่ง</span>
            </div>
            <div className="relative text-red-600 transition-transform active:scale-110 drop-shadow-xl">
              <MapPin size={42} className="fill-red-600 text-white" />
            </div>
            <div className="mt-[-6px] h-2 w-4 rounded-full bg-black/35 blur-[1px]" />
          </div>
        )}
        {!readOnly && !fixedCenterPin && (
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-slate-900/85 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-xs">
            <span>👇 แตะบนแผนที่ตรงจุดที่ต้องการเพื่อปักหมุด</span>
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
