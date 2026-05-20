import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { getWeatherInfo, getPm25Info, WEATHER_LAT, WEATHER_LON } from '../../lib/weatherUtils'

export default function WeatherWidget() {
  const [weather, setWeather] = useState(null)
  const [pm25, setPm25] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
        `&current=temperature_2m,weather_code&timezone=Asia%2FBangkok`
      ).then(r => r.json()),
      fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
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
  }, [])

  const info   = weather ? getWeatherInfo(weather.code) : null
  const pmInfo = pm25 != null ? getPm25Info(pm25) : null

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 bg-white/85 dark:bg-gray-800/85 backdrop-blur-sm
                      border border-gray-200/70 dark:border-gray-700/60 rounded-2xl px-4 py-3
                      shadow-sm text-gray-400 text-sm">
        <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        <span>กำลังโหลด...</span>
      </div>
    )
  }

  if (!weather) return null

  return (
    <Link
      to="/weather"
      className="inline-flex bg-white/85 dark:bg-gray-800/85 backdrop-blur-sm
                 border border-gray-200/70 dark:border-gray-700/60 rounded-2xl
                 shadow-sm hover:shadow-md active:scale-98 transition-all overflow-hidden group"
    >
      {/* คอลัมน์ 1 — พยากรณ์อากาศ */}
      <div className="flex flex-col items-start px-3.5 py-2.5 leading-tight">
        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mb-1">
          พยากรณ์อากาศ
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-xl">{info.icon}</span>
          <span className="text-base font-bold text-gray-800 dark:text-white">{weather.temp}°</span>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{info.label}</p>
        <div className="flex items-center gap-0.5 mt-1 text-gray-400 dark:text-gray-500
                        group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
          <span className="text-[10px]">อากาศน้ำเลา</span>
          <ChevronRight size={10} />
        </div>
      </div>

      {/* Divider */}
      <div className="w-px bg-gray-200/80 dark:bg-gray-700/60 my-2.5" />

      {/* คอลัมน์ 2 — ฝุ่น PM2.5 */}
      <div className="flex flex-col items-start px-3.5 py-2.5 leading-tight">
        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mb-1">
          ฝุ่น PM2.5
        </p>
        {pmInfo ? (
          <>
            <div className="flex items-end gap-1">
              <span className="text-base font-bold" style={{ color: pmInfo.color }}>{pm25}</span>
              <span className="text-[10px] text-gray-400 mb-0.5">μg/m³</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: pmInfo.color }} />
              <span className="text-[11px]" style={{ color: pmInfo.color }}>{pmInfo.label}</span>
            </div>
          </>
        ) : (
          <span className="text-[11px] text-gray-400 mt-1">ไม่มีข้อมูล</span>
        )}
      </div>
    </Link>
  )
}
