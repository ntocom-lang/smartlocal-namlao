import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, MapPin, Wind, Droplets, Sun, CalendarDays } from 'lucide-react'
import { getWeatherInfo, WEATHER_LAT, WEATHER_LON } from '../lib/weatherUtils'
import { useTenant } from '../contexts/TenantContext'

const DAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function formatDay(dateStr, index) {
  if (index === 0) return 'วันนี้'
  if (index === 1) return 'พรุ่งนี้'
  const d = new Date(dateStr)
  return DAYS_TH[d.getDay()]
}

async function fetchWeather(lat, lon) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=Asia%2FBangkok&forecast_days=7`
  )
  return res.json()
}

function WeatherContent({ data, locationName }) {
  const currentInfo = getWeatherInfo(data.current.weather_code)
  
  // Calculate overall min and max for the week to draw temperature bars (optional, but makes it premium)
  const weekMin = Math.min(...data.daily.temperature_2m_min)
  const weekMax = Math.max(...data.daily.temperature_2m_max)
  const range = weekMax - weekMin || 1

  return (
    <>
      {/* Premium Current Weather Card */}
      <div className="mx-4 mt-6 rounded-[32px] p-6 text-white shadow-[0_20px_40px_-15px_rgba(5,150,105,0.4)] relative overflow-hidden"
           style={{ background: 'linear-gradient(145deg, #10b981 0%, #064e3b 100%)' }}>
        
        {/* Decorative background elements */}
        <div className="absolute top-[-20%] right-[-10%] w-64 h-64 rounded-full bg-white/10 blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-[-20%] left-[-10%] w-40 h-40 rounded-full bg-emerald-300/20 blur-2xl pointer-events-none"></div>

        <div className="relative z-10 flex items-center justify-center gap-1.5 text-emerald-100 text-sm mb-6 font-medium bg-black/10 w-fit mx-auto px-4 py-1.5 rounded-full backdrop-blur-md">
          <MapPin size={14} />
          <span>{locationName}</span>
        </div>
        
        <div className="relative z-10 flex flex-col items-center mb-6">
          <div className="text-[100px] leading-none drop-shadow-lg mb-2 animate-pulse" style={{ animationDuration: '4s' }}>
            {currentInfo.icon}
          </div>
          <div className="flex items-start">
            <span className="text-7xl font-light tracking-tighter drop-shadow-md">
              {Math.round(data.current.temperature_2m * 10) / 10}
            </span>
            <span className="text-3xl font-light mt-2 ml-1 text-emerald-200">°C</span>
          </div>
          <p className="text-emerald-100 text-xl font-medium mt-2 drop-shadow-sm">{currentInfo.label}</p>
          <div className="flex gap-4 mt-2 text-sm text-emerald-200/90 font-medium">
            <span>สูงสุด: {Math.round(data.daily.temperature_2m_max[0])}°</span>
            <span>ต่ำสุด: {Math.round(data.daily.temperature_2m_min[0])}°</span>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-2 gap-3 mt-6 pt-5 border-t border-white/20">
          <div className="bg-black/10 backdrop-blur-md rounded-2xl p-3 flex items-center gap-3">
            <Wind className="text-emerald-300" size={24} />
            <div>
              <p className="text-[10px] text-emerald-200 uppercase tracking-wider">ความเร็วลม</p>
              <p className="font-bold text-sm">{data.current.wind_speed_10m ?? '-'} <span className="text-xs font-normal text-emerald-200">km/h</span></p>
            </div>
          </div>
          <div className="bg-black/10 backdrop-blur-md rounded-2xl p-3 flex items-center gap-3">
            <Droplets className="text-emerald-300" size={24} />
            <div>
              <p className="text-[10px] text-emerald-200 uppercase tracking-wider">ความชื้น</p>
              <p className="font-bold text-sm">{data.current.relative_humidity_2m ?? '-'} <span className="text-xs font-normal text-emerald-200">%</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* 7-day forecast */}
      <div className="mx-4 mt-8 mb-4 flex items-center gap-2 px-2 text-emerald-900 dark:text-emerald-400">
        <CalendarDays size={18} />
        <h3 className="font-bold text-base">พยากรณ์ล่วงหน้า 7 วัน</h3>
      </div>
      
      <div className="mx-4 mb-8 rounded-[24px] bg-white dark:bg-gray-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-none border border-emerald-50 dark:border-gray-700 overflow-hidden">
        {data.daily.time.map((dateStr, i) => {
          const info = getWeatherInfo(data.daily.weather_code[i])
          const max = Math.round(data.daily.temperature_2m_max[i] * 10) / 10
          const min = Math.round(data.daily.temperature_2m_min[i] * 10) / 10
          
          // Calculate bar positions
          const leftPercent = ((min - weekMin) / range) * 100
          const widthPercent = ((max - min) / range) * 100

          return (
            <div key={dateStr}
                 className={`flex items-center px-5 py-4 gap-4 transition-colors hover:bg-emerald-50 dark:hover:bg-gray-700/50
                   ${i !== 0 ? 'border-t border-emerald-50 dark:border-gray-700/60' : ''}`}>
              <span className={`text-sm w-12 shrink-0 ${i === 0 ? 'font-bold text-emerald-600 dark:text-emerald-400' : 'font-medium text-gray-600 dark:text-gray-300'}`}>
                {formatDay(dateStr, i)}
              </span>
              <div className="flex flex-col items-center w-12 shrink-0">
                <span className="text-2xl drop-shadow-sm">{info.icon}</span>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-6 text-right">{min}°</span>
                <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full relative overflow-hidden">
                  <div className="absolute h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
                       style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}></div>
                </div>
                <span className="text-xs font-bold text-gray-700 dark:text-gray-200 w-6">{max}°</span>
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
    <div className="flex flex-col items-center justify-center py-32 gap-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-4 border-emerald-100 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-emerald-500 rounded-full border-t-transparent animate-spin"></div>
      </div>
      <p className="text-emerald-600 font-medium animate-pulse">กำลังดึงข้อมูลสภาพอากาศ...</p>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="text-center py-20 px-4 bg-white mx-4 mt-6 rounded-[32px] shadow-sm border border-red-100">
      <p className="text-6xl mb-4 opacity-80">⛅</p>
      <p className="text-red-500 font-bold mb-2">{message}</p>
      <p className="text-gray-400 text-sm">กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต<br/>หรืออนุญาตการเข้าถึงตำแหน่งที่ตั้ง</p>
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

  const fetchIpWeather = useCallback(() => {
    if (ipFetched) return
    setIpFetched(true)
    setIpLoading(true)

    if (!navigator.geolocation) {
      setIpError(true)
      setIpLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords
          const [weather, geoRes] = await Promise.all([
            fetchWeather(latitude, longitude),
            fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=th`,
              { headers: { 'Accept-Language': 'th' } }
            ),
          ])
          const geo = await geoRes.json()
          const addr = geo.address ?? {}
          const city =
            addr.city || addr.town || addr.village ||
            addr.suburb || addr.county || addr.state || 'ตำแหน่งของคุณ'
          const region = addr.state ?? ''
          setIpLocation({ city, region })
          setIpData(weather)
        } catch {
          setIpError(true)
        } finally {
          setIpLoading(false)
        }
      },
      () => {
        setIpError(true)
        setIpLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
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
    <div className="max-w-4xl mx-auto min-h-screen bg-emerald-50/30 dark:bg-gray-900 pb-20">

      {/* Mobile Header */}
      <div className="md:hidden sticky top-0 z-50 flex items-center justify-between px-2 py-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-none border-b border-emerald-50 dark:border-gray-800">
        <button onClick={() => navigate(-1)}
                className="p-3 rounded-full text-gray-600 dark:text-gray-300 hover:bg-emerald-50 active:bg-emerald-100 transition-colors">
          <ChevronLeft size={24} />
        </button>
        <h1 className="font-bold text-lg text-emerald-950 dark:text-emerald-50 tracking-wide">สภาพอากาศ</h1>
        <div className="w-12"></div> {/* Spacer for centering */}
      </div>

      {/* PC Header */}
      <div className="hidden md:flex items-center gap-4 px-6 pt-10 pb-6 border-b border-gray-200 dark:border-gray-700 mb-2">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-lg"
             style={{ background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)' }}>
          🌤️
        </div>
        <div>
          <h1 className="text-3xl font-black text-gray-800 dark:text-slate-100 tracking-tight">พยากรณ์อากาศ</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">อัปเดตข้อมูลแบบเรียลไทม์</p>
        </div>
      </div>

      {/* Modern Tabs */}
      <div className="flex mx-4 md:mx-6 mt-6 bg-white dark:bg-gray-800 p-1 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        {tabs.map((t, i) => (
          <button
            key={i}
            onClick={() => handleTabChange(i)}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
              activeTab === i
                ? 'bg-emerald-500 text-white shadow-md transform scale-[1.02]'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
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
          ipError   ? <ErrorState message="ไม่สามารถระบุตำแหน่งของคุณได้" /> :
          ipData    ? (
            <WeatherContent
              data={ipData}
              locationName={ipLocation ? `${ipLocation.city}${ipLocation.region && ipLocation.region !== ipLocation.city ? `, ${ipLocation.region}` : ''}` : 'ตำแหน่งของคุณ'}
            />
          ) : null
        )}
      </div>

      <div className="text-center mt-4">
        <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-widest font-semibold">
          Powered by Open-Meteo
        </p>
      </div>
    </div>
  )
}
