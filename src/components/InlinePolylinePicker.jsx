import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, LocateFixed, MapPin, Maximize2, Minimize2, Redo2, Search, Trash2, Undo2, X } from 'lucide-react'
import LeafletMapCanvas from './common/LeafletMapCanvas'
import { searchPlaces } from '../lib/nominatim'

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

// ระยะจากจุด p ถึงช่วงเส้น a-b — โปรเจกต์ lat/lng แบบระนาบตรงๆ (ไม่ทำ geodesic) แม่นพอสำหรับหาช่วงที่
// ใกล้ที่สุดในระยะทางระดับตำบล/อำเภอที่เส้นทางพวกนี้ยาวไม่เกินหลักสิบกิโล คลาดเคลื่อนน้อยมากจนไม่มีผล
function distanceToSegment(p, a, b) {
  const dx = b.lng - a.lng, dy = b.lat - a.lat
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return haversine(p, a)
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return haversine(p, { lat: a.lat + t * dy, lng: a.lng + t * dx })
}

// หาว่าจุดที่คลิกขวาโดนใกล้ "ช่วงเส้น" ไหนที่สุด (ดัชนี 0 = ช่วงระหว่างจุดที่ 1-2) — ใช้แทนตำแหน่ง
// event.edge ของ Google ที่ใช้ไม่ได้เพราะเส้นไม่ได้เปิด editable
function nearestSegmentIndex(point, path) {
  let best = 0, bestDist = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const d = distanceToSegment(point, path[i], path[i + 1])
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

export default function InlinePolylinePicker({ value = [], onChange, defaultCenter, color = '#3b82f6', dashArray = null }) {
  const mapRef = useRef(null)
  const searchAbortRef = useRef(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [redoStack, setRedoStack] = useState([])
  // เมนูคำสั่งตอนคลิกขวา — คลิกขวาพื้นที่ว่าง = เมนู "เพิ่มจุดตรงนี้", คลิกขวาที่หมุดเดิม = เมนู "ลบจุดนี้"
  const [contextMenu, setContextMenu] = useState(null) // { x, y, type: 'add'|'delete', point?, index? } | null

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

  const handleMapReady = useCallback(map => {
    mapRef.current = map
  }, [])

  // ค้นหาสถานที่ด้วย Nominatim — ต้องให้ผู้ใช้กดค้นหาเอง (submit) ไม่ยิงทุกตัวอักษร
  // เพราะ Nominatim สาธารณะจำกัด 1 req/วินาที และห้าม autocomplete ตาม usage policy
  async function handleSearch(e) {
    e?.preventDefault()
    const q = searchQuery.trim()
    if (!q) return

    // ยกเลิกคำค้นก่อนหน้าที่ยังค้างอยู่ กันผลลัพธ์เก่ามาถึงทีหลังแล้วทับผลใหม่
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller

    setSearching(true)
    try {
      const results = await searchPlaces(q, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (!results.length) {
        setSearchResults([])
        setSearchError('ไม่พบสถานที่ที่ค้นหา ลองใช้ชื่อตำบล/อำเภอ หรือชื่อสถานที่สำคัญใกล้เคียง')
        return
      }
      setSearchError('')
      setSearchResults(results)
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }

  function handleSelectPlace(place) {
    setSearchResults([])
    setSearchQuery(place.shortLabel)
    mapRef.current?.setView([place.lat, place.lng], 17)
  }

  useEffect(() => () => searchAbortRef.current?.abort(), [])

  const handleMarkerDragEnd = useCallback((markerData, newPos) => {
    const idx = markerData.index
    if (typeof idx === 'number' && idx >= 0 && idx < value.length) {
      const next = [...value]
      next[idx] = { lat: Number(newPos.lat), lng: Number(newPos.lng) }
      commit(next)
    }
  }, [value, commit])

  // คลิกขวาพื้นที่ว่าง → เมนู "เพิ่มจุดต่อท้าย" | คลิกขวาที่หมุดเดิม → เมนู "ลบจุดนี้" | คลิกขวาบนเส้นทาง
  // (ระหว่างจุดสองจุด) → เมนู "แทรกจุดตรงนี้" กลางเส้น — เดิมคลิกขวาทำ "ย้อนกลับ" ทันทีโดยไม่ถาม
  // ลบได้แค่จุดสุดท้าย เปลี่ยนมาเป็นเมนูให้เลือกชัดเจน ลบ/แทรกจุดกลางๆ ได้ด้วย
  const handleMapRightClick = useCallback((point, screen) => {
    if (!screen) return
    setContextMenu({ x: screen.clientX, y: screen.clientY, type: 'add', point })
  }, [])

  const handleFeatureRightClick = useCallback((markerData, screen) => {
    if (!screen || typeof markerData.index !== 'number') return
    setContextMenu({ x: screen.clientX, y: screen.clientY, type: 'delete', index: markerData.index })
  }, [])

  // หาช่วงเส้น (0 = ระหว่างจุดที่ 1-2, 1 = ระหว่างจุดที่ 2-3 ฯลฯ) ที่ใกล้จุดคลิกที่สุดเอง (Google ไม่บอก
  // ให้ตรงๆ เพราะเส้นไม่ได้เปิด editable) แทรกจุดใหม่ที่ตำแหน่ง segIdx+1 คือหลังจุดต้นของช่วงนั้นพอดี
  const handlePolylineRightClick = useCallback((_lineData, point, screen) => {
    if (!screen || !point || value.length < 2) return
    const segIdx = nearestSegmentIndex(point, value)
    setContextMenu({ x: screen.clientX, y: screen.clientY, type: 'insert', index: segIdx + 1, point })
  }, [value])

  function confirmContextMenu() {
    if (!contextMenu) return
    if (contextMenu.type === 'add') {
      addPoint(contextMenu.point)
    } else if (contextMenu.type === 'insert') {
      const pt = { lat: Number(contextMenu.point.lat), lng: Number(contextMenu.point.lng) }
      const next = [...value]
      next.splice(contextMenu.index, 0, pt)
      commit(next)
      setRedoStack([])
    } else {
      commit(value.filter((_, i) => i !== contextMenu.index))
    }
    setContextMenu(null)
  }

  useEffect(() => {
    if (!contextMenu) return
    const onKeyDown = e => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [contextMenu])

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
    title: index === 0 ? 'จุดเริ่มต้น (ลากเพื่อย้าย, คลิกขวาเพื่อลบ)' : index === value.length - 1 ? 'จุดสิ้นสุด (ลากเพื่อย้าย, คลิกขวาเพื่อลบ)' : `จุดที่ ${index + 1} (ลากเพื่อย้าย, คลิกขวาเพื่อลบ)`,
  }))
  const polylines = value.length >= 2 ? [{ id: 'editing-route', path: value, color, weight: 5, dashArray }] : []

  const content = (
    <div className={fullscreen ? 'flex h-full min-h-0 flex-col bg-white' : 'overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm'}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 p-3">
        <form onSubmit={handleSearch} className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSearchError('') }}
            placeholder="ค้นหาสถานที่ แล้วกด Enter..."
            className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-9 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {searching && (
            <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-blue-600" />
          )}

          {/* ผลค้นหา — คลิกแล้วเลื่อนแผนที่ไปจุดนั้น ไม่ได้เพิ่มหมุดให้เอง
              เพราะเครื่องมือนี้ให้ผู้ใช้คลิกวางจุดเส้นทางเองทีละจุด */}
          {searchResults.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
              {searchResults.map((place, idx) => (
                <li key={`${place.lat},${place.lng},${idx}`}>
                  <button
                    type="button"
                    onClick={() => handleSelectPlace(place)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-blue-50"
                  >
                    <MapPin size={13} className="mt-0.5 shrink-0 text-blue-500" />
                    <span className="line-clamp-2">{place.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searchError && (
            <p className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 shadow-sm">
              {searchError}
            </p>
          )}
        </form>
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
          <span>เมนูเพิ่ม/แทรก/ลบจุด (คลิกขวาบนเส้น = แทรกจุดกลางเส้น)</span>
          <span className="mx-0.5 text-blue-300">|</span>
          <span className="inline-flex items-center rounded-md bg-emerald-600 px-2 py-0.5 font-bold text-white shadow-xs">กดลากหมุด</span>
          <span>ย้ายตำแหน่งจุด</span>
          <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 font-bold text-blue-700">({value.length} จุด)</span>
        </div>
        <div className="font-bold text-blue-950">
          ระยะทางรวม <span className="font-mono text-sm text-blue-700">{distanceLabel}</span>
        </div>
      </div>
      <LeafletMapCanvas
        center={initialCenter}
        zoom={17}
        mapTypeId="hybrid"
        markers={markers}
        polylines={polylines}
        fitBounds={false}
        onMapClick={addPoint}
        onMapRightClick={handleMapRightClick}
        onFeatureRightClick={handleFeatureRightClick}
        onPolylineRightClick={handlePolylineRightClick}
        onMarkerDragEnd={handleMarkerDragEnd}
        onMapReady={handleMapReady}
        className={fullscreen ? 'w-full min-h-0 flex-1' : 'w-full h-[420px] min-h-[360px]'}
      />
    </div>
  )

  // เมนูคำสั่งลอยตรงจุดคลิกขวา — portal ไป document.body เสมอ กันโดน overflow/z-index ของฟอร์มที่ครอบอยู่บัง
  const menu = contextMenu && createPortal(
    <>
      <div className="fixed inset-0 z-9998" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null) }} />
      <div className="fixed z-9999 min-w-42.5 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
        style={{ left: contextMenu.x, top: contextMenu.y }}>
        {contextMenu.type === 'add' && (
          <button type="button" onClick={confirmContextMenu}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-blue-50">
            <MapPin size={14} className="text-blue-600" /> เพิ่มจุดต่อท้าย
          </button>
        )}
        {contextMenu.type === 'insert' && (
          <button type="button" onClick={confirmContextMenu}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
            <MapPin size={14} className="text-emerald-600" /> แทรกจุดตรงนี้ (ระหว่างจุดที่ {contextMenu.index} และ {contextMenu.index + 1})
          </button>
        )}
        {contextMenu.type === 'delete' && (
          <button type="button" onClick={confirmContextMenu}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50">
            <Trash2 size={14} /> ลบจุดที่ {contextMenu.index + 1}
          </button>
        )}
        <button type="button" onClick={() => setContextMenu(null)}
          className="flex w-full items-center gap-2 border-t border-gray-100 px-3.5 py-2 text-left text-xs font-medium text-gray-400 hover:bg-gray-50">
          <X size={14} /> ยกเลิก
        </button>
      </div>
    </>,
    document.body,
  )

  if (!fullscreen) return <>{content}{menu}</>
  return <>{createPortal(<div className="fixed inset-0 z-9999 bg-white">{content}</div>, document.body)}{menu}</>
}
