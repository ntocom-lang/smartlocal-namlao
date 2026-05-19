import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { getWeatherInfo, WEATHER_LAT, WEATHER_LON } from '../../lib/weatherUtils'

export default function WeatherWidget() {
  const [weather, setWeather] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
      `&current=temperature_2m,weather_code&timezone=Asia%2FBangkok`
    )
      .then(r => r.json())
      .then(data => {
        setWeather({
          temp: Math.round(data.current.temperature_2m * 10) / 10,
          code: data.current.weather_code,
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const info = weather ? getWeatherInfo(weather.code) : null

  return (
    <Link
      to="/weather"
      className="inline-flex items-center gap-3 bg-white/85 dark:bg-gray-800/85 backdrop-blur-sm
                 border border-gray-200/70 dark:border-gray-700/60 rounded-2xl px-4 py-2.5
                 shadow-sm hover:shadow-md active:scale-98 transition-all group"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-0.5">
          <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
          <span>กำลังโหลด...</span>
        </div>
      ) : !weather ? (
        <span className="text-gray-400 text-xs">ไม่มีข้อมูลอากาศ</span>
      ) : (
        <>
          <div className="flex flex-col items-start leading-tight">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium mb-0.5">
              อากาศน้ำเลาวันนี้
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-2xl">{info.icon}</span>
              <span className="text-lg font-bold text-gray-800 dark:text-white">{weather.temp}°</span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{info.label}</p>
          </div>
          <div className="flex items-center gap-0.5 text-gray-400 dark:text-gray-500
                          group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors self-end pb-0.5">
            <span className="text-[10px] whitespace-nowrap">พยากรณ์อากาศ</span>
            <ChevronRight size={11} />
          </div>
        </>
      )}
    </Link>
  )
}
