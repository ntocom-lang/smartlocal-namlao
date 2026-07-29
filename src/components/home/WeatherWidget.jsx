import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { getWeatherInfo, getPm25Info, WEATHER_LAT, WEATHER_LON } from '../../lib/weatherUtils'
import { useTenant } from '../../contexts/TenantContext'

export default function WeatherWidget() {
  const { tenant } = useTenant()

  const lat = tenant?.latitude  ?? WEATHER_LAT
  const lon = tenant?.longitude ?? WEATHER_LON
  const tenantId = tenant?.id
  const requestKey = `${tenantId ?? 'loading'}:${lat}:${lon}`
  const [result, setResult] = useState({
    requestKey: null,
    weather: null,
    pm25: null,
  })
  const loading = result.requestKey !== requestKey
  const weather = loading ? null : result.weather
  const pm25 = loading ? null : result.pm25

  // ตัดคำนำหน้าหน่วยงานออก เหลือแค่ชื่อสั้นๆ
  const shortName = tenant?.name
    ?.replace(/^(เทศบาลนคร|เทศบาลเมือง|เทศบาลตำบล|เทศบาล|องค์การบริหารส่วนตำบล|อบต\.)\s*/, '')
    ?? 'ท้องถิ่น'

  useEffect(() => {
    if (!tenantId) return
    const controller = new AbortController()

    const fetchWeather = fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&timezone=Asia%2FBangkok`,
      { signal: controller.signal }
    ).then(r => {
      if (!r.ok) throw new Error('Weather fetch failed')
      return r.json()
    }).catch(err => {
      if (err.name !== 'AbortError') console.warn('Weather API Error:', err)
      return null
    })

    const fetchAQI = fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=pm2_5&timezone=Asia%2FBangkok`,
      { signal: controller.signal }
    ).then(r => {
      if (!r.ok) throw new Error('AQI fetch failed')
      return r.json()
    }).catch(err => {
      if (err.name !== 'AbortError') console.warn('AQI API Error:', err)
      return null
    })

    Promise.all([fetchWeather, fetchAQI])
      .then(([wData, aqData]) => {
        if (controller.signal.aborted) return
        const nextWeather = wData?.current
          ? {
            temp: Math.round(wData.current.temperature_2m * 10) / 10,
            code: wData.current.weather_code,
          }
          : null
        const raw = aqData?.current?.pm2_5
        setResult({
          requestKey,
          weather: nextWeather,
          pm25: raw != null ? Math.round(raw * 10) / 10 : null,
        })
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          console.warn('Weather widget error:', err)
          setResult({ requestKey, weather: null, pm25: null })
        }
      })

    return () => controller.abort()
  }, [lat, lon, requestKey, tenantId])

  const info   = weather ? getWeatherInfo(weather.code) : null
  const pmInfo = pm25 != null ? getPm25Info(pm25) : null

  if (loading) {
    return (
      <div className="w-full flex items-center gap-2 px-4 py-3 text-gray-400 text-sm"
           style={{ backgroundColor: 'var(--bg-card, rgba(255,255,255,0.85))', borderRadius: 'var(--radius-card, 1rem)', border: 'var(--border-card, 1px solid rgba(229,231,235,0.7))', boxShadow: 'var(--shadow-card, 0 1px 2px 0 rgba(0,0,0,0.05))', backdropFilter: 'var(--blur-card, blur(4px))' }}>
        <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        <span>กำลังโหลดข้อมูลอากาศ...</span>
      </div>
    )
  }

  if (!weather && pm25 == null) {
    return (
      <div className="w-full flex items-center justify-center px-4 py-3 text-gray-500 text-sm"
           style={{ backgroundColor: 'var(--bg-card, rgba(255,255,255,0.85))', borderRadius: 'var(--radius-card, 1rem)', border: 'var(--border-card, 1px solid rgba(229,231,235,0.7))', boxShadow: 'var(--shadow-card, 0 1px 2px 0 rgba(0,0,0,0.05))', backdropFilter: 'var(--blur-card, blur(4px))' }}>
        <span>ไม่สามารถโหลดข้อมูลสภาพอากาศได้</span>
      </div>
    )
  }

  return (
    <Link
      to="/weather"
      className="w-full flex items-stretch hover:shadow-md active:scale-[0.99] transition-all overflow-hidden group"
      style={{ backgroundColor: 'var(--bg-card, rgba(255,255,255,0.85))', borderRadius: 'var(--radius-card, 1rem)', border: 'var(--border-card, 1px solid rgba(229,231,235,0.7))', boxShadow: 'var(--shadow-card, 0 1px 2px 0 rgba(0,0,0,0.05))', backdropFilter: 'var(--blur-card, blur(4px))' }}
    >
      {/* คอลัมน์ 1 — ฝุ่น PM2.5 */}
      <div className="flex-1 flex items-center justify-center px-3 py-2">
        {pmInfo ? (
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold leading-none" style={{ color: pmInfo.color }}>
                {pm25}
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-300">μg/m³</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: pmInfo.color }} />
              <span className="text-xs font-medium" style={{ color: pmInfo.color }}>
                {pmInfo.label}
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-300 ml-0.5">· PM2.5</span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-gray-600 dark:text-gray-300">ไม่มีข้อมูลฝุ่น</span>
        )}
      </div>

      {/* Divider */}
      <div className="w-px bg-gray-200/80 dark:bg-gray-700/60 my-3" />

      {/* คอลัมน์ 2 — พยากรณ์อากาศ */}
      <div className="flex-1 flex items-center justify-center gap-2.5 px-3 py-2">
        {weather && info ? (
          <>
            <span className="text-2xl shrink-0">{info.icon}</span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-gray-800 dark:text-white leading-none">
                  {weather.temp}°
                </span>
                <span className="text-[13px] text-gray-700 dark:text-gray-200 truncate">
                  {info.label}
                </span>
              </div>
              <div className="flex items-center gap-0.5 mt-0.5
                              text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-white transition-colors">
                <span className="text-xs">พยากรณ์อากาศ{shortName}</span>
                <ChevronRight size={11} />
              </div>
            </div>
          </>
        ) : (
          <span className="text-xs text-gray-600 dark:text-gray-300">ไม่มีข้อมูลอากาศ</span>
        )}
      </div>
    </Link>
  )
}
