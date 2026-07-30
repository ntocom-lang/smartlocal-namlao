import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMapEvents, useMap } from 'react-leaflet'
import { Search, X, MapPin, CheckCircle2, LocateFixed, Layers, Maximize2, Minimize2 } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

const LONGDO_KEY = import.meta.env.VITE_LONGDO_KEY

// Longdo tile URL ใช้ได้ใน Leaflet โดยตรง — ไม่ต้องการ SDK
const TILES = {
  normal: {
    url: `https://ms.longdo.com/mmmap/tile.php?zoom={z}&x={x}&y={y}&key=${LONGDO_KEY}`,
    attribution: '&copy; <a href="https://map.longdo.com">Longdo Map</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
}

function MapCenterTracker({ onMoveEnd }) {
  useMapEvents({
    moveend(e) {
      const { lat, lng } = e.target.getCenter()
      onMoveEnd({ lat, lng })
    },
  })
  return null
}

function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], map.getZoom(), { duration: 0.8 })
  }, [target, map])
  return null
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://api.longdo.com/map/services/address?lon=${lng}&lat=${lat}&noelevation=1&key=${LONGDO_KEY}`
    )
    const d = await r.json()
    if (d.error) throw new Error(d.error)
    const parts = [d.aoi, d.road, d.subdistrict, d.district, d.province, d.postcode]
    return parts.filter(Boolean).join(' ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

async function searchPlace(query) {
  const r = await fetch(
    `https://search.longdo.com/mapsearch/json/search?keyword=${encodeURIComponent(query)}&limit=10&key=${LONGDO_KEY}`
  )
  const d = await r.json()
  return (d.data ?? []).map(item => ({
    place_id: item.id ?? `${item.lat}${item.lon}`,
    display_name: [item.name, item.address].filter(Boolean).join(' — '),
    lat: String(item.lat),
    lon: String(item.lon),
  }))
}

export default function MapPicker({ initialPos, fallbackPos, skipGeolocation, onConfirm, onClose }) {
  const defaultPos = initialPos ?? fallbackPos ?? { lat: 18.1448, lng: 100.1167 }
  const [center, setCenter] = useState(defaultPos)
  const [flyTarget, setFlyTarget] = useState(null)
  const [address, setAddress] = useState('')
  const [loadingAddr, setLoadingAddr] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [tileMode, setTileMode] = useState('normal')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const searchTimeout = useRef(null)
  const geocodeTimeout = useRef(null)

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }

  useEffect(() => {
    // skipGeolocation: ใช้ fallbackPos (เช่น พิกัดเทศบาล) เป็นจุดเริ่มเสมอ ไม่ดึง GPS เครื่องมาตั้งต้นให้
    // ใช้ตอนเจ้าหน้าที่ปักหมุดสถานที่ทั่วไปในเขต ต่างจากฟอร์มแจ้งเหตุของประชาชนที่อยากได้ตำแหน่งจริงของผู้แจ้งเป็นค่าเริ่มต้น
    if (!initialPos && !skipGeolocation && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const target = { lat: coords.latitude, lng: coords.longitude }
          setCenter(target)
          setFlyTarget(target)
          fetchAddress(target.lat, target.lng)
        },
        () => fetchAddress(defaultPos.lat, defaultPos.lng)
      )
    } else {
      fetchAddress(defaultPos.lat, defaultPos.lng)
    }
  }, [])

  async function fetchAddress(lat, lng) {
    setLoadingAddr(true)
    setAddress(await reverseGeocode(lat, lng))
    setLoadingAddr(false)
  }

  function handleMoveEnd({ lat, lng }) {
    setCenter({ lat, lng })
    clearTimeout(geocodeTimeout.current)
    geocodeTimeout.current = setTimeout(() => fetchAddress(lat, lng), 400)
  }

  function handleSearchChange(e) {
    const q = e.target.value
    setSearchQuery(q)
    clearTimeout(searchTimeout.current)
    if (!q.trim()) { setSearchResults([]); return }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true)
      setSearchResults(await searchPlace(q))
      setSearching(false)
    }, 600)
  }

  function selectResult(r) {
    const target = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) }
    setFlyTarget(target)
    setAddress(r.display_name)
    setSearchQuery(r.display_name)
    setSearchResults([])
  }

  function handleMyLocation() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const target = { lat: coords.latitude, lng: coords.longitude }
      setFlyTarget(target)
      fetchAddress(target.lat, target.lng)
    })
  }

  const tile = TILES[tileMode]

  return (
    <div className="fixed inset-0 flex flex-col bg-white" style={{ zIndex: 200 }}>
      {/* Search bar */}
      <div className="absolute top-0 left-0 right-0 px-3 pt-3 pb-2 pointer-events-none" style={{ zIndex: 201 }}>
        <div className="pointer-events-auto flex items-center gap-2 bg-white rounded-2xl shadow-lg border border-gray-100 px-3 py-2">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="ค้นหาสถานที่..."
            className="flex-1 text-base text-gray-900 bg-white placeholder-gray-400 outline-none"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchResults([]) }}>
              <X size={16} className="text-gray-400" />
            </button>
          )}
          <button onClick={onClose} className="ml-1 p-1 rounded-full hover:bg-gray-100">
            <X size={18} className="text-gray-600" />
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="pointer-events-auto mt-1 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            {searchResults.map(r => (
              <button
                key={r.place_id}
                onClick={() => selectResult(r)}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-50 last:border-0 line-clamp-1"
              >
                {r.display_name}
              </button>
            ))}
          </div>
        )}
        {searching && (
          <div className="pointer-events-auto mt-1 bg-white rounded-2xl shadow px-4 py-3 text-sm text-gray-400">กำลังค้นหา...</div>
        )}
        {!searching && searchQuery.length > 1 && !searchResults.length && (
          <div className="pointer-events-auto mt-1 bg-white rounded-2xl shadow px-4 py-3 text-sm text-gray-500">
            ไม่พบสถานที่ — ลองระบุให้ชัดขึ้น เช่น{' '}
            <span className="font-medium text-gray-700">"น้ำเลา ร้องกวาง แพร่"</span>
          </div>
        )}
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative', isolation: 'isolate', minHeight: 0 }}>
        <MapContainer
          center={[defaultPos.lat, defaultPos.lng]}
          zoom={15}
          style={{ width: '100%', height: '100%' }}
          zoomControl={false}
        >
          <TileLayer key={tileMode} url={tile.url} attribution={tile.attribution} />
          {tileMode === 'satellite' && (
            <TileLayer
              key="labels"
              url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
              attribution=""
              subdomains="abcd"
            />
          )}
          <MapCenterTracker onMoveEnd={handleMoveEnd} />
          {flyTarget && <FlyTo target={flyTarget} />}
        </MapContainer>
      </div>

      {/* Center pin */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 201 }}>
        <div style={{ transform: 'translateY(-50%)' }}>
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{ bottom: -4, width: 14, height: 7, background: 'rgba(0,0,0,0.22)', borderRadius: '50%', filter: 'blur(3px)' }}
          />
          <svg width="32" height="44" viewBox="0 0 32 44" fill="none">
            <path d="M16 0C7.163 0 0 7.163 0 16c0 10.5 16 28 16 28S32 26.5 32 16C32 7.163 24.837 0 16 0z" fill="#E53E3E" />
            <circle cx="16" cy="16" r="6" fill="white" />
          </svg>
        </div>
      </div>

      {/* Layer toggle */}
      <button
        onClick={() => setTileMode(tileMode === 'normal' ? 'satellite' : 'normal')}
        className="absolute left-4 flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl shadow-lg border border-gray-100 text-xs font-medium text-gray-700 active:scale-95 transition-transform"
        style={{ bottom: '140px', zIndex: 201 }}
      >
        <Layers size={16} className="text-gray-500" />
        {tileMode === 'normal' ? 'ดาวเทียม' : 'แผนที่'}
      </button>

      {/* Fullscreen toggle */}
      <button
        onClick={toggleFullscreen}
        className="absolute right-4 p-3 bg-white rounded-full shadow-lg border border-gray-100 active:scale-95 transition-transform"
        style={{ bottom: '197px', zIndex: 201 }}
      >
        {isFullscreen
          ? <Minimize2 size={20} className="text-gray-600" />
          : <Maximize2 size={20} className="text-gray-600" />}
      </button>

      {/* GPS */}
      <button
        onClick={handleMyLocation}
        className="absolute right-4 p-3 bg-white rounded-full shadow-lg border border-gray-100 active:scale-95 transition-transform"
        style={{ bottom: '140px', zIndex: 201 }}
      >
        <LocateFixed size={20} className="text-blue-500" />
      </button>

      {/* Bottom panel */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] px-4 pt-3 pb-6"
        style={{ zIndex: 201 }}
      >
        <div className="flex items-start gap-2 mb-1.5">
          <MapPin size={16} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-600 leading-snug line-clamp-2">
            {loadingAddr ? 'กำลังโหลดที่อยู่...' : (address || '—')}
          </p>
        </div>
        <p className="text-xs text-gray-400 font-mono mb-3 pl-6">
          {center.lat.toFixed(6)}, {center.lng.toFixed(6)}
        </p>
        <button
          onClick={() => onConfirm({ lat: center.lat, lng: center.lng, address })}
          className="w-full py-3.5 rounded-2xl font-semibold text-white shadow-lg active:scale-95 transition-transform text-sm flex items-center justify-center gap-2"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <CheckCircle2 size={18} />
          ยืนยันตำแหน่ง
        </button>
      </div>

    </div>
  )
}
