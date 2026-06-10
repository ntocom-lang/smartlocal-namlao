import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Search, X, LocateFixed, Layers } from 'lucide-react'
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

async function searchPlace(query, center) {
  const params = new URLSearchParams({
    q: query, format: 'json', limit: 5,
    'accept-language': 'th', countrycodes: 'th',
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  return res.json()
}

export default function InlineMapPicker({ value, onChange, defaultCenter }) {
  const center = defaultCenter ?? { lat: 18.1448, lng: 100.1167 }
  const [flyTarget, setFlyTarget]       = useState(null)
  const [tileMode, setTileMode]         = useState('satellite')
  const [searchQuery, setSearchQuery]   = useState('')
  const [searchResults, setResults]     = useState([])
  const [searching, setSearching]       = useState(false)
  const searchTimeout = useRef(null)

  function handlePin({ lat, lng }) {
    onChange({ lat, lng })
  }

  function handleSearchChange(e) {
    const q = e.target.value
    setSearchQuery(q)
    clearTimeout(searchTimeout.current)
    if (!q.trim()) { setResults([]); return }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true)
      const results = await searchPlace(q, center)
      setResults(results)
      setSearching(false)
    }, 600)
  }

  function selectResult(r) {
    const target = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) }
    setFlyTarget(target)
    onChange(target)
    setSearchQuery(r.display_name.split(',')[0])
    setResults([])
  }

  function handleMyLocation() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const target = { lat: coords.latitude, lng: coords.longitude }
      setFlyTarget(target)
      onChange(target)
    })
  }

  const tile = TILES[tileMode]

  return (
    <div className="space-y-2">
      <p className="text-xs text-blue-600 bg-blue-50 rounded-xl px-3 py-2 flex items-center gap-1.5">
        📍 คลิกบนแผนที่เพื่อปักหมุดที่ตั้งโครงการ
      </p>
      <div className="relative rounded-2xl overflow-hidden border border-gray-200" style={{ height: 300 }}>
        {/* Search bar overlay */}
        <div className="absolute top-2 left-2 right-2 z-[400] pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 bg-white rounded-xl shadow border border-gray-100 px-3 py-1.5">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="ค้นหาสถานที่..."
              className="flex-1 text-sm text-gray-700 placeholder-gray-400 outline-none bg-transparent"
            />
            {searching && <span className="text-[10px] text-gray-400">กำลังค้นหา…</span>}
            {searchQuery && !searching && (
              <button onClick={() => { setSearchQuery(''); setResults([]) }}>
                <X size={14} className="text-gray-400" />
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="pointer-events-auto mt-1 bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
              {searchResults.map(r => (
                <button key={r.place_id} onClick={() => selectResult(r)}
                  className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 border-b border-gray-50 last:border-0 line-clamp-1">
                  {r.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="absolute right-2 top-2 z-[400] flex flex-col gap-1.5">
          <button onClick={handleMyLocation}
            className="w-8 h-8 bg-white rounded-lg shadow border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors">
            <LocateFixed size={15} className="text-gray-600" />
          </button>
          <button onClick={() => setTileMode(m => m === 'street' ? 'satellite' : 'street')}
            className="w-8 h-8 bg-white rounded-lg shadow border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors">
            <Layers size={15} className="text-gray-600" />
          </button>
        </div>

        <MapContainer
          center={value ? [value.lat, value.lng] : [center.lat, center.lng]}
          zoom={13}
          style={{ width: '100%', height: '100%' }}
          zoomControl={true}>
          <TileLayer url={tile.url} attribution={tile.attribution} />
          <ClickHandler onPin={handlePin} />
          <FlyTo target={flyTarget} />
          {value?.lat && (
            <Marker position={[value.lat, value.lng]} icon={pinIcon} />
          )}
        </MapContainer>
      </div>
    </div>
  )
}
