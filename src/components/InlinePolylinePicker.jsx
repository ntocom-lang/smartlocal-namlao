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

  const center = useMemo(() => value.length
    ? value[Math.floor(value.length / 2)]
    : (defaultCenter || { lat: 18.1448, lng: 100.1167 }), [value, defaultCenter])

  const commit = useCallback(next => {
    onChange?.(next)
  }, [onChange])

  function addPoint(point) {
    commit([...value, { lat: Number(point.lat), lng: Number(point.lng) }])
    setRedoStack([])
  }

  function undo() {
    if (!value.length) return
    setRedoStack(stack => [value[value.length - 1], ...stack])
    commit(value.slice(0, -1))
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

  const distance = totalDistance(value)
  const distanceLabel = distance >= 1000 ? `${(distance / 1000).toFixed(2)} กม.` : `${Math.round(distance)} ม.`
  const markers = value.map((point, index) => ({
    id: `route-point-${index}`,
    position: point,
    color: index === 0 ? '#22c55e' : index === value.length - 1 ? '#ef4444' : '#ffffff',
    labelColor: index === 0 || index === value.length - 1 ? '#ffffff' : '#2563eb',
    label: String(index + 1),
    labelSize: '10px',
    scale: index === 0 || index === value.length - 1 ? 11 : 8,
    title: index === 0 ? 'จุดเริ่มต้น' : index === value.length - 1 ? 'จุดสิ้นสุด' : `จุดที่ ${index + 1}`,
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
      <div className="flex items-center justify-between bg-blue-50 px-3 py-2 text-xs text-blue-800">
        <span>คลิกบนแผนที่ตามแนวเส้นทาง · {value.length} จุด</span>
        <strong>ระยะทาง {distanceLabel}</strong>
      </div>
      <GoogleMapCanvas
        center={center}
        zoom={15}
        mapTypeId="hybrid"
        markers={markers}
        polylines={polylines}
        fitBounds={value.length > 0}
        onMapClick={addPoint}
        onMapReady={handleMapReady}
        className={fullscreen ? 'w-full min-h-0 flex-1' : 'w-full h-[420px] min-h-[360px]'}
      />
    </div>
  )

  if (!fullscreen) return content
  return createPortal(<div className="fixed inset-0 z-9999 bg-white">{content}</div>, document.body)
}
