import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Search, X, LocateFixed, Layers, Maximize2, Minimize2 } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

const TILES = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
}

const pinIcon = L.divIcon({
  className: '',
  html: `<div style="width:28px;height:28px;background:#ef4444;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
})

function ClickHandler({ onPin }) {
  useMapEvents({ click(e) { onPin(e.latlng) } })
  return null
}

function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], map.getZoom(), { duration: 0.8 })
  }, [target, map])
  return null
}

async function searchPlace(query) {
  const params = new URLSearchParams({
    q: query, format: 'json', limit: 5,
    'accept-language': 'th', countrycodes: 'th',
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  return res.json()
}

function SearchBar({ onSelect }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const timeout = useRef(null)

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    clearTimeout(timeout.current)
    if (!q.trim()) { setResults([]); return }
    timeout.current = setTimeout(async () => {
      setSearching(true)
      const data = await searchPlace(q)
      setResults(data)
      setSearching(false)
    }, 600)
  }

  function selectResult(r) {
    onSelect({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) })
    setQuery(r.display_name.split(',')[0])
    setResults([])
  }

  return (
    <div className="pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 bg-white rounded-xl shadow border border-gray-100 px-3 py-1.5">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="ค้นหาสถานที่..."
          className="flex-1 text-sm text-gray-900 bg-white placeholder-gray-400 outline-none"
        />
        {searching && <span className="text-[10px] text-gray-400">กำลังค้นหา…</span>}
        {query && !searching && (
          <button type="button" onClick={() => { setQuery(''); setResults([]) }}>
            <X size={14} className="text-gray-400" />
          </button>
        )}
      </div>
      {results.length > 0 && (
        <div className="pointer-events-auto mt-1 bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
          {results.map(r => (
            <button type="button" key={r.place_id} onClick={() => selectResult(r)}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 border-b border-gray-50 last:border-0 line-clamp-1">
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function InlineMapPicker({ value, onChange, defaultCenter }) {
  const center = defaultCenter ?? { lat: 18.1448, lng: 100.1167 }
  const [flyTarget, setFlyTarget]   = useState(null)
  const [tileMode, setTileMode]     = useState('satellite')
  const [fullscreen, setFullscreen] = useState(false)

  const mapCenter = value ? [value.lat, value.lng] : [center.lat, center.lng]
  const tile = TILES[tileMode]

  function handlePin({ lat, lng }) {
    setFlyTarget({ lat, lng })
    onChange({ lat, lng })
  }

  function handleSelect(target) {
    setFlyTarget(target)
    onChange(target)
  }

  function handleMyLocation() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      handlePin({ lat: coords.latitude, lng: coords.longitude })
    })
  }

  const controls = (isFullscreen) => (
    <div className="absolute right-2 top-2 z-1000 flex flex-col gap-1.5">
      <button type="button" onClick={() => isFullscreen ? setFullscreen(false) : setFullscreen(true)}
        className="w-8 h-8 bg-white rounded-lg shadow border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors">
        {isFullscreen ? <Minimize2 size={15} className="text-gray-600" /> : <Maximize2 size={15} className="text-gray-600" />}
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
      <p className="text-xs text-blue-600 bg-blue-50 rounded-xl px-3 py-2 flex items-center gap-1.5">
        📍 คลิกบนแผนที่เพื่อปักหมุดที่ตั้งโครงการ
      </p>

      {/* Inline map */}
      <div className="relative rounded-2xl border border-gray-200" style={{ height: 300 }}>
        {/* MapContainer only gets Leaflet layers — no DOM overlays inside */}
        <div className="absolute inset-0 rounded-2xl overflow-hidden">
          <MapContainer center={mapCenter} zoom={13} style={{ width: '100%', height: '100%' }} zoomControl>
            <TileLayer key={tileMode} url={tile.url} attribution={tile.attribution} />
            <ClickHandler onPin={handlePin} />
            <FlyTo target={flyTarget} />
            {value?.lat && <Marker position={[value.lat, value.lng]} icon={pinIcon} />}
          </MapContainer>
        </div>
        {/* Overlays are siblings to the map — no event bubbling into Leaflet */}
        <div className="absolute top-2 left-11 z-1000 w-52">
          <SearchBar onSelect={handleSelect} />
        </div>
        {controls(false)}
      </div>

      {/* Fullscreen portal */}
      {fullscreen && createPortal(
        <div className="fixed inset-0 z-9999 flex flex-col bg-black">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white shrink-0">
            <span className="text-sm font-semibold">📍 เลือกที่ตั้งโครงการ</span>
            <button type="button" onClick={() => setFullscreen(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors">
              <Minimize2 size={14} /> ย่อแผนที่
            </button>
          </div>
          <div className="relative flex-1">
            <div className="absolute inset-0">
              <MapContainer center={mapCenter} zoom={15} style={{ width: '100%', height: '100%' }} zoomControl>
                <TileLayer key={tileMode} url={tile.url} attribution={tile.attribution} />
                <ClickHandler onPin={handlePin} />
                <FlyTo target={flyTarget} />
                {value?.lat && <Marker position={[value.lat, value.lng]} icon={pinIcon} />}
              </MapContainer>
            </div>
            <div className="absolute top-2 left-2 right-[52px] z-1000">
              <SearchBar onSelect={handleSelect} />
            </div>
            {controls(true)}
          </div>
          {value?.lat && (
            <div className="shrink-0 bg-gray-900 text-white px-4 py-2.5 flex items-center gap-2">
              <span className="text-xs font-mono opacity-70">{value.lat.toFixed(7)}, {value.lng.toFixed(7)}</span>
              <button type="button" onClick={() => setFullscreen(false)}
                className="ml-auto px-4 py-1.5 rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: '#7c3aed' }}>
                ยืนยันพิกัด
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
