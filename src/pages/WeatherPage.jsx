import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, MapPin } from 'lucide-react'
import { getWeatherInfo, WEATHER_LAT, WEATHER_LON } from '../lib/weatherUtils'

const DAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function formatDay(dateStr, index) {
  if (index === 0) return 'วันนี้'
  if (index === 1) return 'พรุ่งนี้'
  const d = new Date(dateStr)
  return `${DAYS_TH[d.getDay()]}ที่ ${d.getDate()} ${MONTHS_TH[d.getMonth()]}`
}

export default function WeatherPage() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
      `&current=temperature_2m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&timezone=Asia%2FBangkok&forecast_days=7`
    )
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const currentInfo = data ? getWeatherInfo(data.current.weather_code) : null

  return (
    <div className="max-w-lg mx-auto min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-4 text-white shadow-md"
           style={{ background: 'linear-gradient(135deg, #4a7c6f 0%, #2d5a4f 100%)' }}>
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-xl hover:bg-white/20 active:bg-white/30 transition-colors"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-bold text-lg">พยากรณ์อากาศ</h1>
      </div>

      {/* Current weather card */}
      {data && currentInfo && (
        <div className="mx-4 mt-4 rounded-2xl p-5 text-white shadow-lg"
             style={{ background: 'linear-gradient(135deg, #4a7c6f 0%, #2d5a4f 100%)' }}>
          <div className="flex items-center gap-1.5 text-white/70 text-sm mb-3">
            <MapPin size={13} />
            <span>ตำบลน้ำเลา อ.ร้องกวาง จ.แพร่</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-thin">{Math.round(data.current.temperature_2m * 10) / 10}</span>
                <span className="text-2xl font-light mb-1">°C</span>
              </div>
              <p className="text-white/85 text-base mt-1">{currentInfo.label}</p>
            </div>
            <span className="text-6xl">{currentInfo.icon}</span>
          </div>
          {data.daily && (
            <div className="flex gap-4 mt-4 pt-3 border-t border-white/20 text-sm text-white/75">
              <span>สูงสุด {Math.round(data.daily.temperature_2m_max[0] * 10) / 10}°</span>
              <span>ต่ำสุด {Math.round(data.daily.temperature_2m_min[0] * 10) / 10}°</span>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-gray-200 rounded-full animate-spin"
               style={{ borderTopColor: '#4a7c6f' }} />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">⛅</p>
          <p className="text-gray-500">ไม่สามารถโหลดข้อมูลได้</p>
          <p className="text-gray-400 text-sm mt-1">กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต</p>
        </div>
      )}

      {/* 7-day forecast */}
      {data?.daily && (
        <div className="mx-4 mt-4 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm divide-y divide-gray-100 dark:divide-gray-700/60">
          {data.daily.time.map((dateStr, i) => {
            const info = getWeatherInfo(data.daily.weather_code[i])
            const max = Math.round(data.daily.temperature_2m_max[i] * 10) / 10
            const min = Math.round(data.daily.temperature_2m_min[i] * 10) / 10
            return (
              <div
                key={dateStr}
                className={`flex items-center px-5 py-4 gap-3 ${i === 0 ? 'bg-gray-50/80 dark:bg-gray-700/30' : ''}`}
              >
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
      )}

      <p className="text-center text-xs text-gray-400 dark:text-gray-600 py-5">
        ข้อมูลจาก Open-Meteo.com · อัปเดตทุก 1 ชั่วโมง
      </p>
    </div>
  )
}
