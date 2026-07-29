import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Wind } from 'lucide-react'
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
    updatedAt: null,
  })
  const loading = result.requestKey !== requestKey
  const weather = loading ? null : result.weather
  const pm25 = loading ? null : result.pm25
  const updatedAt = loading ? null : result.updatedAt

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
          updatedAt: wData?.current?.time ?? aqData?.current?.time ?? new Date().toISOString(),
        })
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          console.warn('Weather widget error:', err)
          setResult({ requestKey, weather: null, pm25: null, updatedAt: null })
        }
      })

    return () => controller.abort()
  }, [lat, lon, requestKey, tenantId])

  const info   = weather ? getWeatherInfo(weather.code) : null
  const pmInfo = pm25 != null ? getPm25Info(pm25) : null
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    : null

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
      className="relative w-full overflow-hidden group border border-white/80 shadow-[0_8px_24px_rgba(15,118,110,0.10)] hover:shadow-[0_10px_28px_rgba(37,99,235,0.16)] active:scale-[0.99] transition-all"
      title={`ข้อมูลประมาณการ Open-Meteo${updatedLabel ? ` · อัปเดต ${updatedLabel} น.` : ''}`}
      style={{
        background: 'linear-gradient(135deg, rgba(239,246,255,0.98) 0%, rgba(224,242,254,0.98) 38%, rgba(236,253,245,0.98) 68%, rgba(255,247,237,0.98) 100%)',
        borderRadius: 'var(--radius-card, 1rem)',
        backdropFilter: 'var(--blur-card, blur(4px))',
      }}
    >
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-500 via-emerald-400 to-amber-400" />
      <div className="absolute -top-8 -left-6 w-24 h-24 rounded-full bg-blue-400/10 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 right-2 w-28 h-28 rounded-full bg-amber-300/15 blur-2xl pointer-events-none" />

      <div className="relative flex items-stretch min-h-[58px]">
        {/* คอลัมน์ 1 — ฝุ่น PM2.5 */}
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2">
        {pmInfo ? (
          <>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-white/75 shadow-sm border border-white/80"
              style={{ color: pmInfo.color }}>
              <Wind size={16} strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-base font-bold leading-none" style={{ color: pmInfo.color }}>
                {pm25}
              </span>
              <span className="text-[11px] text-gray-600 dark:text-gray-300">μg/m³</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: pmInfo.color }} />
              <span className="text-[11px] font-semibold truncate" style={{ color: pmInfo.color }}>
                {pmInfo.label}
              </span>
              <span className="text-[10px] text-slate-500 ml-0.5 shrink-0">PM2.5</span>
            </div>
            </div>
          </>
        ) : (
          <span className="text-xs text-gray-600 dark:text-gray-300">ไม่มีข้อมูลฝุ่น</span>
        )}
        </div>

        {/* Divider */}
        <div className="w-px bg-white/90 shadow-[1px_0_0_rgba(148,163,184,0.16)] my-2" />

        {/* คอลัมน์ 2 — พยากรณ์อากาศ */}
        <div className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2">
        {weather && info ? (
          <>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-amber-100 to-sky-100 shadow-sm border border-white/80">
              <span className="text-lg leading-none">{info.icon}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1">
                <span className="text-base font-bold text-slate-800 leading-none">
                  {weather.temp}°
                </span>
                <span className="text-xs text-slate-600 truncate">
                  {info.label}
                </span>
              </div>
              <div className="flex items-center gap-0.5 mt-0.5
                              text-sky-700 group-hover:text-blue-700 transition-colors">
                <span className="text-[11px] font-medium truncate">อากาศ{shortName}</span>
              </div>
            </div>
            <ChevronRight size={13} className="text-sky-500 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </>
        ) : (
          <span className="text-xs text-gray-600 dark:text-gray-300">ไม่มีข้อมูลอากาศ</span>
        )}
        </div>
      </div>
    </Link>
  )
}
