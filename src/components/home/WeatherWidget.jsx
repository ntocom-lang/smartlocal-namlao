import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { getWeatherInfo, getPm25Info, WEATHER_LAT, WEATHER_LON } from '../../lib/weatherUtils'
import { useTenant } from '../../contexts/TenantContext'

export default function WeatherWidget() {
  const { tenant } = useTenant()
  const [weather, setWeather] = useState(null)
  const [pm25, setPm25] = useState(null)
  const [loading, setLoading] = useState(true)

  const lat = tenant?.latitude  ?? WEATHER_LAT
  const lon = tenant?.longitude ?? WEATHER_LON

  // ตัดคำนำหน้าหน่วยงานออก เหลือแค่ชื่อสั้นๆ
  const shortName = tenant?.name
    ?.replace(/^(เทศบาลนคร|เทศบาลเมือง|เทศบาลตำบล|เทศบาล|องค์การบริหารส่วนตำบล|อบต\.)\s*/, '')
    ?? 'ท้องถิ่น'

  useEffect(() => {
    if (!tenant) return
    setLoading(true)
    Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code&timezone=Asia%2FBangkok`
      ).then(r => r.json()),
      fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
        `&current=pm2_5&timezone=Asia%2FBangkok`
      ).then(r => r.json()),
    ])
      .then(([wData, aqData]) => {
        setWeather({
          temp: Math.round(wData.current.temperature_2m * 10) / 10,
          code: wData.current.weather_code,
        })
        const raw = aqData.current?.pm2_5
        if (raw != null) setPm25(Math.round(raw * 10) / 10)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [lat, lon, tenant])

  const info   = weather ? getWeatherInfo(weather.code) : null
  const pmInfo = pm25 != null ? getPm25Info(pm25) : null

  if (loading) {
    return (
      <div className="w-full flex items-center gap-2 bg-white/85 dark:bg-gray-800/85 backdrop-blur-sm
                      border border-gray-200/70 dark:border-gray-700/60 rounded-2xl px-4 py-3
                      shadow-sm text-gray-400 text-sm">
        <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        <span>กำลังโหลดข้อมูลอากาศ...</span>
      </div>
    )
  }

  if (!weather) return null

  return (
    <Link
      to="/weather"
      className="w-full flex items-stretch bg-white/85 dark:bg-gray-800/85 backdrop-blur-sm
                 border border-gray-200/70 dark:border-gray-700/60 rounded-2xl shadow-sm
                 hover:shadow-md active:scale-[0.99] transition-all overflow-hidden group"
    >
      {/* คอลัมน์ 1 — ฝุ่น PM2.5 */}
      <div className="flex-1 flex items-center justify-center px-3 py-2">
        {pmInfo ? (
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold leading-none" style={{ color: pmInfo.color }}>
                {pm25}
              </span>
              <span className="text-[11px] text-gray-400">μg/m³</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: pmInfo.color }} />
              <span className="text-[11px] font-medium" style={{ color: pmInfo.color }}>
                {pmInfo.label}
              </span>
              <span className="text-[11px] text-gray-400 ml-0.5">· PM2.5</span>
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-gray-400">ไม่มีข้อมูลฝุ่น</span>
        )}
      </div>

      {/* Divider */}
      <div className="w-px bg-gray-200/80 dark:bg-gray-700/60 my-3" />

      {/* คอลัมน์ 2 — พยากรณ์อากาศ */}
      <div className="flex-1 flex items-center justify-center gap-2.5 px-3 py-2">
        <span className="text-2xl shrink-0">{info.icon}</span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-gray-800 dark:text-white leading-none">
              {weather.temp}°
            </span>
            <span className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
              {info.label}
            </span>
          </div>
          <div className="flex items-center gap-0.5 mt-0.5
                          text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
            <span className="text-[11px]">พยากรณ์อากาศ{shortName}</span>
            <ChevronRight size={11} />
          </div>
        </div>
      </div>
    </Link>
  )
}
