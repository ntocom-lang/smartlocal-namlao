import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LocateFixed, Maximize2, Minimize2, Redo2, Search, Trash2, Undo2 } from 'lucide-react'
import GoogleMapCanvas from './common/GoogleMapCanvas'

function haversine(a, b) {
  const radius = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function totalDistance(points) {
  return points.reduce((total, point, index) => index ? total + haversine(points[index - 1], point) : 0, 0)
}

export default function InlinePolylinePicker({ value = [], onChange, defaultCenter, color = '#3b82f6', dashArray = null }) {
  const inputRef = useRef(null)
  const mapRef = useRef(null)
  const autocompleteListenerRef = useRef(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [redoStack, setRedoStack] = useState([])

  const initialCenter = useMemo(() => {
    if (value.length) return value[0]
    if (defaultCenter) return defaultCenter
    return { lat: 18.1448, lng: 100.1167 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = useCallback(next => {
    onChange?.(next)
  }, [onChange])

  function addPoint(point) {
    const pt = { lat: Number(point.lat), lng: Number(point.lng) }
    commit([...value, pt])
    setRedoStack([])
  }

  function undo() {
    if (!value.length) return
    const remaining = value.slice(0, -1)
    setRedoStack(stack => [value[value.length - 1], ...stack])
    commit(remaining)
  }

  function redo() {
    if (!redoStack.length) return
    commit([...value, redoStack[0]])
    setRedoStack(stack => stack.slice(1))
  }

  function locateMe() {
    navigator.geolocation?.getCurrentPosition(position => {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude }
      mapRef.current?.panTo(point)
      mapRef.current?.setZoom(18)
    }, () => alert('ไม่สามารถอ่านตำแหน่งปัจจุบันได้ กรุณาอนุญาต Location ในเบราว์เซอร์'), {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    })
  }

  const handleMapReady = useCallback((map, google) => {
    mapRef.current = map
    if (!inputRef.current) return
    autocompleteListenerRef.current?.remove?.()
    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'th' },
      fields: ['geometry', 'name', 'formatted_address'],
    })
    autocomplete.bindTo('bounds', map)
    autocompleteListenerRef.current = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (!place?.geometry?.location) return
      map.panTo(place.geometry.location)
      map.setZoom(17)
    })
  }, [])

  useEffect(() => () => autocompleteListenerRef.current?.remove?.(), [])

  const handleMarkerDragEnd = useCallback((markerData, newPos) => {
    const idx = markerData.index
    if (typeof idx === 'number' && idx >= 0 && idx < value.length) {
      const next = [...value]
      next[idx] = { lat: Number(newPos.lat), lng: Number(newPos.lng) }
      commit(next)
    }
  }, [value, commit])

  const distance = totalDistance(value)
  const distanceLabel = distance >= 1000 ? `${(distance / 1000).toFixed(2)} กม.` : `${Math.round(distance)} ม.`
  const markers = value.map((point, index) => ({
    id: `route-point-${index}`,
    position: point,
    index,
    draggable: true,
    color: index === 0 ? '#22c55e' : index === value.length - 1 ? '#ef4444' : '#ffffff',
    labelColor: index === 0 || index === value.length - 1 ? '#ffffff' : '#2563eb',
    label: String(index + 1),
    labelSize: '10px',
    scale: index === 0 || index === value.length - 1 ? 11 : 8,
    title: index === 0 ? 'จุดเริ่มต้น (ลากเพื่อขยับย้ายตำแหน่งได้)' : index === value.length - 1 ? 'จุดสิ้นสุด (ลากเพื่อขยับย้ายตำแหน่งได้)' : `จุดที่ ${index + 1} (ลากเพื่อขยับย้ายตำแหน่งได้)`,
  }))
  const polylines = value.length >= 2 ? [{ id: 'editing-route', path: value, color, weight: 5, dashArray }] : []

  const content = (
    <div className={fullscreen ? 'flex h-full min-h-0 flex-col bg-white' : 'overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm'}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input ref={inputRef} type="search" placeholder="ค้นหาสถานที่บน Google Maps..."
            className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
        </div>
        <button type="button" onClick={locateMe} className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-blue-600" title="ตำแหน่งปัจจุบัน"><LocateFixed size={16} /></button>
        <button type="button" onClick={undo} disabled={!value.length} className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 disabled:opacity-30" title="ย้อนกลับ"><Undo2 size={16} /></button>
        <button type="button" onClick={redo} disabled={!redoStack.length} className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 disabled:opacity-30" title="ทำซ้ำ"><Redo2 size={16} /></button>
        <button type="button" onClick={() => { commit([]); setRedoStack([]) }} disabled={!value.length} className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-500 disabled:opacity-30" title="ล้างเส้นทาง"><Trash2 size={16} /></button>
        <button type="button" onClick={() => setFullscreen(state => !state)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600" title={fullscreen ? 'ย่อแผนที่' : 'ขยายเต็มจอ'}>
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50 px-3.5 py-2 text-xs text-blue-900">
        <div className="flex flex-wrap items-center gap-1.5 font-medium">
          <span className="inline-flex items-center rounded-md bg-blue-600 px-2 py-0.5 font-bold text-white shadow-xs">คลิกซ้าย</span>
          <span>เพิ่มจุด</span>
          <span className="mx-0.5 text-blue-300">|</span>
          <span className="inline-flex items-center rounded-md bg-amber-600 px-2 py-0.5 font-bold text-white shadow-xs">คลิกขวา</span>
          <span>ยกเลิก</span>
          <span className="mx-0.5 text-blue-300">|</span>
          <span className="inline-flex items-center rounded-md bg-emerald-600 px-2 py-0.5 font-bold text-white shadow-xs">กดลากหมุด</span>
          <span>ย้ายตำแหน่งจุด</span>
          <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 font-bold text-blue-700">({value.length} จุด)</span>
        </div>
        <div className="font-bold text-blue-950">
          ระยะทางรวม <span className="font-mono text-sm text-blue-700">{distanceLabel}</span>
        </div>
      </div>
      <GoogleMapCanvas
        center={initialCenter}
        zoom={17}
        mapTypeId="hybrid"
        markers={markers}
        polylines={polylines}
        fitBounds={false}
        onMapClick={addPoint}
        onMapRightClick={undo}
        onMarkerDragEnd={handleMarkerDragEnd}
        onMapReady={handleMapReady}
        className={fullscreen ? 'w-full min-h-0 flex-1' : 'w-full h-[420px] min-h-[360px]'}
      />
    </div>
  )

  if (!fullscreen) return content
  return createPortal(<div className="fixed inset-0 z-9999 bg-white">{content}</div>, document.body)
}
