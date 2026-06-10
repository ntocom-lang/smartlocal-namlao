import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Search, X, LocateFixed, Layers, Maximize2, Minimize2, Undo2, Trash2 } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

const TILES = {
  street:    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri' },
}

function haversine(a, b) {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function totalDist(pts) {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i])
  return d
}

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} กม.` : `${Math.round(m)} เมตร`
}

function RouteHandler({ onAdd, onUndo }) {
  useMapEvents({
    click(e) { onAdd({ lat: e.latlng.lat, lng: e.latlng.lng }) },
    contextmenu(e) { e.originalEvent.preventDefault(); onUndo() },
  })
  return null
}

function FlyController({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 15, { duration: 0.8 })
  }, [target, map])
  return null
}

async function searchPlace(query) {
  const params = new URLSearchParams({ q: query, format: 'json', limit: 5, 'accept-language': 'th', countrycodes: 'th' })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  return res.json()
}

function SearchBar({ onSelect }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const timeout = useRef(null)

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    clearTimeout(timeout.current)
    if (!q.trim()) { setResults([]); return }
    timeout.current = setTimeout(async () => {
      setLoading(true)
      setResults(await searchPlace(q))
      setLoading(false)
    }, 600)
  }

  function pick(r) {
    onSelect({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) })
    setQuery(r.display_name.split(',')[0])
    setResults([])
  }

  return (
    <div className="pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 bg-white rounded-xl shadow border border-gray-100 px-3 py-1.5">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input type="text" value={query} onChange={handleChange} placeholder="ค้นหาสถานที่..."
          className="flex-1 text-sm text-gray-900 bg-white placeholder-gray-400 outline-none" />
        {loading && <span className="text-[10px] text-gray-400">ค้นหา…</span>}
        {query && !loading && (
          <button type="button" onClick={() => { setQuery(''); setResults([]) }}>
            <X size={14} className="text-gray-400" />
          </button>
        )}
      </div>
      {results.length > 0 && (
        <div className="pointer-events-auto mt-1 bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
          {results.map(r => (
            <button type="button" key={r.place_id} onClick={() => pick(r)}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 border-b border-gray-50 last:border-0 line-clamp-1">
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CoordCard({ label, color, pt }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
        <span className={`w-2.5 h-2.5 rounded-full inline-block ${color}`} />
        {label}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-gray-400">ละติจูด (Lat)</p>
          <p className="text-xs font-mono text-gray-800">{pt.lat.toFixed(7)}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400">ลองจิจูด (Lng)</p>
          <p className="text-xs font-mono text-gray-800">{pt.lng.toFixed(7)}</p>
        </div>
      </div>
    </div>
  )
}

export default function InlinePolylinePicker({ value = [], onChange, defaultCenter, color = '#3b82f6', dashArray = null }) {
  const center = defaultCenter ?? { lat: 18.1448, lng: 100.1167 }
  const [tileMode, setTileMode]     = useState('street')
  const [fullscreen, setFullscreen] = useState(false)
  const [flyTarget, setFlyTarget]   = useState(null)

  const [multiplier, setMultiplier] = useState(1.0)

  const tile       = TILES[tileMode]
  const mapCenter  = value[0] ? [value[0].lat, value[0].lng] : [center.lat, center.lng]
  const dist       = totalDist(value)
  const start      = value[0]
  const end        = value.length > 1 ? value[value.length - 1] : null

  function addPoint(pt)    { onChange([...value, pt]) }
  function removePoint(i)  { onChange(value.filter((_, j) => j !== i)) }
  function undo()          { if (value.length > 0) onChange(value.slice(0, -1)) }
  function clear()         { onChange([]) }
  function handleSearch(pt){ setFlyTarget(pt) }

  function handleMyLocation() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setFlyTarget({ lat: coords.latitude, lng: coords.longitude })
    })
  }

  function markerFill(i) {
    if (i === 0) return '#22c55e'
    if (i === value.length - 1 && value.length > 1) return '#ef4444'
    return color
  }

  const mapCore = (
    <>
      <TileLayer key={tileMode} url={tile.url} attribution={tile.attribution} />
      <RouteHandler onAdd={addPoint} onUndo={undo} />
      <FlyController target={flyTarget} />
      {value.length >= 2 && (
        <Polyline positions={value.map(p => [p.lat, p.lng])}
          pathOptions={{ color, weight: 5, opacity: 0.85, ...(dashArray && { dashArray }) }} />
      )}
      {null}
    </>
  )

  const controls = (isFS) => (
    <div className="absolute right-2 top-2 z-1000 flex flex-col gap-1.5">
      <button type="button" onClick={() => setFullscreen(!isFS)}
        className="w-8 h-8 bg-white rounded-lg shadow border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors">
        {isFS ? <Minimize2 size={15} className="text-gray-600" /> : <Maximize2 size={15} className="text-gray-600" />}
      </button>
      <button type="button" onClick={handleMyLocation}
        className="w-8 h-8 bg-white rounded-lg shadow border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors">
        <LocateFixed size={15} className="text-gray-600" />
      </button>
      <button type="button" onClick={() => setTileMode(m => m === 'street' ? 'satellite' : 'street')}
        className="w-8 h-8 bg-white rounded-lg shadow border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors">
        <Layers size={15} className="text-gray-600" />
      </button>
    </div>
  )

  return (
    <div className="space-y-2">
      {/* Action bar */}
      <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2 text-xs text-blue-700 flex-wrap">
        <span className="flex-1">คลิกซ้ายบนแผนที่เพื่อเพิ่มจุด | คลิกขวาเพื่อลบจุดล่าสุด ({value.length} จุด)</span>
        <button type="button" onClick={undo} disabled={!value.length}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50 shrink-0">
          <Undo2 size={12} /> ย้อนกลับ
        </button>
        <button type="button" onClick={clear} disabled={!value.length}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 text-red-600 disabled:opacity-40 hover:bg-red-100 shrink-0">
          <Trash2 size={12} /> ล้าง
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 px-1">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> จุดเริ่มต้น</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> จุดสิ้นสุด</span>
        {value.length > 2 && <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> จุดกลาง</span>}
      </div>

      {/* Inline map */}
      <div className="relative rounded-2xl border border-gray-200" style={{ height: 300 }}>
        <div className="absolute inset-0 rounded-2xl overflow-hidden">
          <MapContainer center={mapCenter} zoom={13} style={{ width: '100%', height: '100%' }} zoomControl>
            {mapCore}
          </MapContainer>
        </div>
        <div className="absolute top-2 left-11 z-1000 w-52">
          <SearchBar onSelect={handleSearch} />
        </div>
        {controls(false)}
      </div>

      {value.length > 0 && (
        <p className="text-xs text-gray-400 px-1">คลิกที่ marker เพื่อลบจุดนั้น</p>
      )}

      {/* Summary cards */}
      {value.length >= 2 && (
        <div className="grid grid-cols-3 gap-3">
          <CoordCard label="จุดเริ่มต้นโครงการ" color="bg-green-500" pt={start} />
          <CoordCard label="จุดสิ้นสุดโครงการ" color="bg-red-500" pt={end} />
          <div className="bg-white rounded-xl border border-gray-100 p-3">
            <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">📐 ระยะทางรวม</p>
            <p className="text-lg font-bold text-blue-600 leading-tight">{fmtDist(dist)}</p>
            <p className="text-[10px] text-gray-400 mb-2">ตามแผนที่</p>

            <div className="border-t border-gray-100 pt-2">
              <p className="text-[10px] text-gray-500 mb-1.5">ค่าคูณระยะ (สำรอง/ม้วนสาย):</p>
              <div className="flex items-center gap-1 flex-wrap mb-1.5">
                {[1.0, 1.1, 1.15, 1.2, 1.5].map(m => (
                  <button key={m} type="button" onClick={() => setMultiplier(m)}
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors"
                    style={Math.abs(multiplier - m) < 0.001
                      ? { backgroundColor: '#3b82f6', color: 'white' }
                      : { backgroundColor: '#f1f5f9', color: '#475569' }}>
                    ×{m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400">กำหนดเอง ×</span>
                <input type="number" min="1" step="0.01" value={multiplier}
                  onChange={e => setMultiplier(Math.max(1, parseFloat(e.target.value) || 1))}
                  className="w-14 text-xs text-center border border-gray-200 rounded-lg px-1.5 py-0.5 text-gray-900 bg-white outline-none focus:ring-1 focus:ring-blue-300" />
              </div>
              {multiplier > 1 && (
                <div className="mt-2 pt-1.5 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400">ระยะสายที่ต้องใช้จริง</p>
                  <p className="text-base font-bold text-orange-500">{fmtDist(dist * multiplier)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen portal */}
      {fullscreen && createPortal(
        <div className="fixed inset-0 z-9999 flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white shrink-0 gap-3">
            <span className="text-sm font-semibold">🛣️ วาดแนวเส้นทางโครงการ</span>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={undo} disabled={!value.length}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-40 transition-colors">
                <Undo2 size={13} /> ย้อนกลับ
              </button>
              <button type="button" onClick={clear} disabled={!value.length}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-red-200 text-sm disabled:opacity-40 transition-colors">
                <Trash2 size={13} /> ล้าง
              </button>
              <button type="button" onClick={() => setFullscreen(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors">
                <Minimize2 size={14} /> ย่อ
              </button>
            </div>
          </div>
          <div className="relative flex-1">
            <div className="absolute inset-0">
              <MapContainer center={mapCenter} zoom={15} style={{ width: '100%', height: '100%' }} zoomControl>
                {mapCore}
              </MapContainer>
            </div>
            <div className="absolute top-2 left-11 z-1000 w-64">
              <SearchBar onSelect={handleSearch} />
            </div>
            {controls(true)}
          </div>
          {value.length >= 2 && (
            <div className="shrink-0 bg-gray-900 text-white px-4 py-2.5 flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{start.lat.toFixed(6)}, {start.lng.toFixed(6)}</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{end.lat.toFixed(6)}, {end.lng.toFixed(6)}</span>
              <span className="ml-auto font-bold text-blue-400">{fmtDist(dist)}</span>
              <button type="button" onClick={() => setFullscreen(false)}
                className="px-4 py-1.5 rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: '#7c3aed' }}>
                ยืนยัน
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
