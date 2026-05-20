import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, MapPin } from 'lucide-react'
import { getWeatherInfo, WEATHER_LAT, WEATHER_LON } from '../lib/weatherUtils'
import { useTenant } from '../contexts/TenantContext'

const DAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function formatDay(dateStr, index) {
  if (index === 0) return 'วันนี้'
  if (index === 1) return 'พรุ่งนี้'
  const d = new Date(dateStr)
  return `${DAYS_TH[d.getDay()]}ที่ ${d.getDate()} ${MONTHS_TH[d.getMonth()]}`
}

async function fetchWeather(lat, lon) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=Asia%2FBangkok&forecast_days=7`
  )
  return res.json()
}

function WeatherContent({ data, locationName }) {
  const currentInfo = getWeatherInfo(data.current.weather_code)
  return (
    <>
      {/* Current weather card */}
      <div className="mx-4 mt-4 rounded-2xl p-5 text-white shadow-lg"
           style={{ background: 'linear-gradient(135deg, #4a7c6f 0%, #2d5a4f 100%)' }}>
        <div className="flex items-center gap-1.5 text-white/70 text-sm mb-3">
          <MapPin size={13} />
          <span>{locationName}</span>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-end gap-2">
              <span className="text-5xl font-thin">
                {Math.round(data.current.temperature_2m * 10) / 10}
              </span>
              <span className="text-2xl font-light mb-1">°C</span>
            </div>
            <p className="text-white/85 text-base mt-1">{currentInfo.label}</p>
          </div>
          <span className="text-6xl">{currentInfo.icon}</span>
        </div>
        <div className="flex gap-4 mt-4 pt-3 border-t border-white/20 text-sm text-white/75">
          <span>สูงสุด {Math.round(data.daily.temperature_2m_max[0] * 10) / 10}°</span>
          <span>ต่ำสุด {Math.round(data.daily.temperature_2m_min[0] * 10) / 10}°</span>
        </div>
      </div>

      {/* 7-day list */}
      <div className="mx-4 mt-4 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm
                      divide-y divide-gray-100 dark:divide-gray-700/60">
        {data.daily.time.map((dateStr, i) => {
          const info = getWeatherInfo(data.daily.weather_code[i])
          const max = Math.round(data.daily.temperature_2m_max[i] * 10) / 10
          const min = Math.round(data.daily.temperature_2m_min[i] * 10) / 10
          return (
            <div key={dateStr}
                 className={`flex items-center px-5 py-4 gap-3
                   ${i === 0 ? 'bg-gray-50/80 dark:bg-gray-700/30' : ''}`}>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-32 shrink-0">
                {formatDay(dateStr, i)}
              </span>
              <span className="text-2xl shrink-0">{info.icon}</span>
              <div className="flex-1 text-right">
                <p className="text-sm font-semibold text-gray-800 dark:text-white">
                  {min}° / {max}°
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{info.label}</p>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-4 border-gray-200 rounded-full animate-spin"
           style={{ borderTopColor: '#4a7c6f' }} />
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="text-center py-20">
      <p className="text-4xl mb-3">⛅</p>
      <p className="text-gray-500">{message}</p>
      <p className="text-gray-400 text-sm mt-1">กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต</p>
    </div>
  )
}

export default function WeatherPage() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [activeTab, setActiveTab] = useState(0)

  const lat = tenant?.latitude  ?? WEATHER_LAT
  const lon = tenant?.longitude ?? WEATHER_LON
  const localName = tenant?.name ?? 'พื้นที่'

  // Tab 0 — พื้นที่หน่วยงาน (จาก tenant)
  const [localData, setLocalData] = useState(null)
  const [localLoading, setLocalLoading] = useState(true)
  const [localError, setLocalError] = useState(false)

  // Tab 1 — ตำแหน่งจาก IP
  const [ipData, setIpData] = useState(null)
  const [ipLocation, setIpLocation] = useState(null)
  const [ipLoading, setIpLoading] = useState(false)
  const [ipError, setIpError] = useState(false)
  const [ipFetched, setIpFetched] = useState(false)

  useEffect(() => {
    if (!tenant) return
    fetchWeather(lat, lon)
      .then(setLocalData)
      .catch(() => setLocalError(true))
      .finally(() => setLocalLoading(false))
  }, [lat, lon, tenant])

  const fetchIpWeather = useCallback(async () => {
    if (ipFetched) return
    setIpFetched(true)
    setIpLoading(true)
    try {
      const geoRes = await fetch('https://ipapi.co/json/')
      const geo = await geoRes.json()
      if (!geo.latitude) throw new Error('no coords')
      setIpLocation({ city: geo.city || geo.region || 'ตำแหน่งของคุณ', region: geo.region })
      const weather = await fetchWeather(geo.latitude, geo.longitude)
      setIpData(weather)
    } catch {
      setIpError(true)
    } finally {
      setIpLoading(false)
    }
  }, [ipFetched])

  function handleTabChange(tab) {
    setActiveTab(tab)
    if (tab === 1) fetchIpWeather()
  }

  const shortName = tenant?.name
    ?.replace(/^(เทศบาลนคร|เทศบาลเมือง|เทศบาลตำบล|เทศบาล|องค์การบริหารส่วนตำบล|อบต\.)\s*/, '')
    ?? 'พื้นที่'

  const tabs = [
    { label: `📍 ${shortName}` },
    { label: '🌐 ตำแหน่งของฉัน' },
  ]

  return (
    <div className="max-w-lg mx-auto min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-4 text-white shadow-md"
           style={{ background: 'linear-gradient(135deg, #4a7c6f 0%, #2d5a4f 100%)' }}>
        <button onClick={() => navigate(-1)}
                className="p-1.5 rounded-xl hover:bg-white/20 active:bg-white/30 transition-colors">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-bold text-lg">พยากรณ์อากาศ</h1>
      </div>

      {/* Tabs */}
      <div className="flex mx-4 mt-4 gap-2">
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => handleTabChange(i)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              activeTab === i
                ? 'text-white shadow-md'
                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 shadow-sm hover:text-gray-700'
            }`}
            style={activeTab === i ? { background: 'linear-gradient(135deg, #4a7c6f 0%, #2d5a4f 100%)' } : {}}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 0 — พื้นที่หน่วยงาน */}
      {activeTab === 0 && (
        localLoading ? <LoadingSpinner /> :
        localError   ? <ErrorState message="ไม่สามารถโหลดข้อมูลได้" /> :
        localData    ? <WeatherContent data={localData} locationName={localName} /> :
        null
      )}

      {/* Tab 1 — IP location */}
      {activeTab === 1 && (
        ipLoading ? <LoadingSpinner /> :
        ipError   ? <ErrorState message="ไม่สามารถระบุตำแหน่งจาก IP ได้" /> :
        ipData    ? (
          <WeatherContent
            data={ipData}
            locationName={ipLocation ? `${ipLocation.city}${ipLocation.region && ipLocation.region !== ipLocation.city ? `, ${ipLocation.region}` : ''}` : 'ตำแหน่งของคุณ'}
          />
        ) : null
      )}

      <p className="text-center text-xs text-gray-400 dark:text-gray-600 py-5">
        ข้อมูลจาก Open-Meteo.com · อัปเดตทุก 1 ชั่วโมง
      </p>
    </div>
  )
}
