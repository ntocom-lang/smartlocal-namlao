import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowRight, ArrowUp, ChevronDown, Cloud, CloudDrizzle, CloudLightning, CloudRain, CloudRainWind, CloudSun, Cloudy,
  ExternalLink, MapPin, Snowflake, Sun, Thermometer, ThermometerSnowflake, ThermometerSun,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh'
import {
  SMART_CITY_COLORS, SMART_CITY_LOCAL_WORDS, SMART_CITY_TAG, TMD_SOURCE_DOC_URL, TMD_SOURCE_NAME, TMD_SOURCE_TEXT,
  conditionInfo, dailyRainLevel, dayHeading, daysRangeText, fetchTmdForecast, fetchedAtText, forecastFreshness, gridText,
  hourText, hourlyRainSummary, rainLegend, rainText, tempRound, upcomingDays, upcomingHours, windDirection, windKmh,
} from '../../lib/tmdForecast'

// พยากรณ์เปลี่ยนทุก 3 ชม. (tmd-sync) — ถามซ้ำถี่กว่านี้ไม่ได้ของใหม่
const REFRESH_MS = 15 * 60 * 1000
// ฝนรายชั่วโมงขั้นต่ำของสเกลแท่ง (มม./ชม.) — ไม่ให้ฝนปรอยๆ 0.3 มม. ดูสูงเท่าฝนหนัก
const HOURLY_SCALE_FLOOR_MM = 5

const COND_ICONS = {
  Sun, CloudSun, Cloud, Cloudy, CloudDrizzle, CloudRain, CloudRainWind, CloudLightning, Snowflake,
  ThermometerSnowflake, Thermometer, ThermometerSun,
}
// สีไอคอนสภาพอากาศ (ตกแต่งอย่างเดียว — ความหมายอยู่ที่ข้อความใต้ไอคอนเสมอ ไม่พึ่งสี)
const COND_TONE = {
  Sun: 'text-amber-500', CloudSun: 'text-amber-500', Cloud: 'text-slate-500', Cloudy: 'text-slate-500',
  CloudDrizzle: 'text-sky-600', CloudRain: 'text-blue-600', CloudRainWind: 'text-blue-700', CloudLightning: 'text-violet-600',
  Snowflake: 'text-cyan-600', ThermometerSnowflake: 'text-cyan-600', Thermometer: 'text-sky-600', ThermometerSun: 'text-red-600',
}

/**
 * คาดหมายสภาวะอากาศ 7 วันข้างหน้า (ตารางแบบภาพคาดหมายของกรมอุตุนิยมวิทยา แต่ใช้คำง่ายๆ) — ฝั่งประชาชน ไม่ต้องล็อกอิน
 *
 * อ่านจากฐานข้อมูลเราเท่านั้น (RPC get_public_tmd_forecast) ไม่ยิงไปกรมจากเบราว์เซอร์ · ไม่ฝัง iframe/สคริปต์ภายนอก
 * ไม่มีข้อมูล/โหลดไม่สำเร็จ/อปท. ยังไม่ได้ดึง = ไม่แสดงการ์ดเลย (ส่วนเสริม ไม่ทำให้หน้าพัง ไม่ขึ้น error)
 * โหลดรอบแรกขนานกับ RPC สถานการณ์ของหน้า ไม่บล็อกส่วนอื่น
 *
 * ที่มาแสดงเสมอ (เจ้าของระบบสั่ง 2569-11-15): ชื่อกรม + ลิงก์เอกสาร + เวลาที่ดึง + จุดกริด — ชื่อกรมเป็นข้อความที่มาเท่านั้น
 * ห้ามใช้โลโก้กรมอุตุฯ/Digital Platform ของกรมในการ์ด (เลียนแบบตราหน่วยงานอื่น) · ตราในแถบหัวเป็นของ อปท. เอง
 * ป้ายระดับฝนใช้เกณฑ์ 24 ชม. ของกรม (RAIN_LEVELS) กับรายวันเท่านั้น · ไม่มี "โอกาสเกิดฝน %" เพราะเราไม่มีข้อมูลนี้ (ห้ามเดา)
 */
export default function TmdForecastCard({ tenantId, tenantName, logoUrl, now }) {
  const [state, setState] = useState({ tenantId: null, forecast: null })

  const load = useCallback(() => {
    if (!tenantId) return
    fetchTmdForecast(supabase, tenantId).then(({ forecast, error }) => {
      // โหลดพลาดรอบนี้แต่เคยได้ของ อปท. เดิมแล้ว = คงของเดิมไว้ (ป้ายเหลืองเตือนความเก่าเอง) · ไม่มีข้อมูลจริง = เคลียร์
      setState(prev => (error && prev.tenantId === tenantId ? prev : { tenantId, forecast }))
    })
  }, [tenantId])

  // รอบแรกครั้งเดียวต่อ อปท. (StrictMode เรียก effect ซ้ำตอน dev)
  const loadedFor = useRef(null)
  useEffect(() => {
    if (!tenantId || loadedFor.current === tenantId) return
    loadedFor.current = tenantId
    load()
  }, [tenantId, load])
  useVisibleRefresh(load, { intervalMs: REFRESH_MS, enabled: Boolean(tenantId) })

  const forecast = state.tenantId === tenantId ? state.forecast : null
  if (!forecast) return null
  return <TmdForecastView forecast={forecast} tenantName={tenantName} logoUrl={logoUrl} now={now} />
}

// แยกส่วนแสดงผลออกมา ให้ถ่ายภาพ/ทดสอบด้วยข้อมูลจำลองได้โดยไม่ต้องต่อฐานข้อมูล
export function TmdForecastView({ forecast, tenantName, logoUrl, now }) {
  const days = upcomingDays(forecast.daily, now)
  const hours = upcomingHours(forecast.hourly, now)
  if (days.length === 0 && hours.length === 0) return null
  const { stale, fetchedAt } = forecastFreshness(forecast, now)

  return (
    <section data-tmd-forecast aria-label="คาดหมายสภาวะอากาศ 7 วันข้างหน้า" className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <Header days={days} tenantName={tenantName} logoUrl={logoUrl} />

      {stale && (
        <p data-tmd-stale role="status" className="mx-4 mt-3 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {fetchedAt
            ? `พยากรณ์ชุดนี้ดึงเมื่อ ${fetchedAtText(fetchedAt, now)} อาจไม่เป็นปัจจุบัน`
            : 'ไม่ทราบเวลาที่ดึงพยากรณ์ชุดนี้ อาจไม่เป็นปัจจุบัน'}
        </p>
      )}

      {days.length > 0 && <DayTable days={days} now={now} />}
      {days.length > 0 && <Legend />}
      {hours.length > 0 && <HourlyStrip hours={hours} />}
      <SourceBox forecast={forecast} tenantName={tenantName} now={now} />
    </section>
  )
}

// แถบหัว: ตรา/ชื่อ อปท. + ชื่อการ์ด + ช่วงวันที่ + แคปซูลคำขวัญ Smart City (สไตล์เดียวกับแคปซูลบนภาพแชร์แจ้งเตือนน้ำ-ฝน)
function Header({ days, tenantName, logoUrl }) {
  const range = daysRangeText(days)
  const [logoOk, setLogoOk] = useState(true)
  // เจ้าของสั่ง 2569-11-15 "ขยายให้เด่นชัด ชาวบ้านจะได้รู้ว่าอะไร ที่ไหน" — อะไร = ชื่อการ์ด + ช่วงวันที่ตัวใหญ่
  // ที่ไหน = ป้ายพื้นที่ขาวตัวใหญ่ หมุดแดง แบบป้ายภูมิภาคในภาพคาดหมายอากาศของกรม
  return (
    // จอกว้างพอ: ป้ายพื้นที่ + แคปซูลไปอยู่ขวาของชื่อ (ไม่ทิ้งที่ว่างครึ่งแถบ) · จอแคบ: ตัดลงบรรทัดใหม่เอง (flex-wrap ตามกรอบจริง ไม่ผูก breakpoint)
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 bg-gradient-to-br from-[#0b4a6e] to-[#0e7490] px-4 py-4 text-white sm:px-5">
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
        {logoUrl && logoOk && (
          <img src={logoUrl} alt="" loading="lazy" onError={() => setLogoOk(false)}
            className="h-14 w-14 shrink-0 rounded-full bg-white object-contain p-0.5 shadow sm:h-16 sm:w-16" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold leading-tight sm:text-2xl">คาดหมายสภาวะอากาศ 7 วันข้างหน้า</h2>
          {range && <p className="mt-1 text-base font-bold text-amber-200 sm:text-lg">ระหว่างวันที่ {range}</p>}
        </div>
      </div>
      <div className="flex min-w-0 max-w-full flex-col items-start gap-2.5">
        {tenantName && (
          <p data-tmd-area className="inline-flex max-w-full items-center gap-2 rounded-xl bg-white py-2 pl-2.5 pr-4 text-[#0b4a6e] shadow-md">
            <MapPin size={30} strokeWidth={2.5} className="shrink-0 fill-rose-600 text-white" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-xs font-semibold leading-normal text-slate-500">พื้นที่</span>
              <span className="block text-lg font-extrabold leading-snug sm:text-xl">{tenantName}</span>
            </span>
          </p>
        )}
        <span data-smart-city-tag
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200/70 bg-gradient-to-r from-cyan-600 to-blue-700 px-3.5 py-1.5 text-sm font-bold text-white shadow-[0_0_12px_rgba(0,220,255,0.55)]">
          <svg width="20" height="16" viewBox="0 0 18 14" aria-hidden="true" className="shrink-0">
            <path d="M3 10 L9 3 L15 9" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
            {[[3, 10], [9, 3], [15, 9]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="2.2" fill="#fff" />)}
          </svg>
          {SMART_CITY_TAG}
        </span>
      </div>
    </div>
  )
}

// ตาราง: คอลัมน์ซ้าย = ชื่อแถว (ปักซ้ายตอนเลื่อน) · 1 คอลัมน์ = 1 วัน · มือถือเลื่อนแนวนอนในกรอบตาราง (หน้าไม่ล้น)
function DayTable({ days, now }) {
  const scroller = useRef(null)
  // คำบอก "เลื่อนดูวันถัดไป" ขึ้นเฉพาะตอนตารางกว้างกว่ากรอบจริง (ตัดสินจากความกว้างกรอบ ไม่ใช่ความกว้างหน้าจอ —
  // แท็บเล็ต/จอแคบที่มีเมนูข้างกินที่ กรอบการ์ดแคบกว่าหน้าจอมาก) และหายเมื่อเลื่อนถึงสุดแล้ว
  const [hint, setHint] = useState(false)
  const check = useCallback(() => {
    const el = scroller.current
    if (el) setHint(el.scrollWidth > el.clientWidth + 1 && el.scrollWidth - el.scrollLeft - el.clientWidth >= 8)
  }, [])
  useEffect(() => {
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [check, days.length])

  const label = 'sticky left-0 z-10 w-24 min-w-24 px-2 py-2.5 text-left align-middle text-[13px] font-bold leading-tight'
  const cell = 'border-b border-gray-100 px-1 py-2.5 text-center align-middle'
  return (
    <div className="relative">
      {hint && (
        <p data-tmd-scroll-hint className="flex items-center justify-end gap-1 px-4 pt-2 text-xs font-semibold text-sky-800">
          เลื่อนดูวันถัดไป <ArrowRight size={14} aria-hidden="true" />
        </p>
      )}
      <div ref={scroller} onScroll={check} role="region" aria-label="ตารางพยากรณ์ 7 วัน เลื่อนแนวนอนได้" tabIndex={0}
        className="overflow-x-auto overscroll-x-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600">
        <table data-tmd-days className="w-full min-w-[44rem] table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-24" />
            {days.map(day => <col key={day.time} />)}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-sky-900 px-2 py-2 text-left text-[12px] font-semibold leading-tight text-sky-100">ข้อมูลพยากรณ์</th>
              {days.map(day => {
                const h = dayHeading(day.time, now)
                return (
                  <th key={day.time} scope="col" data-tmd-day-head className={`px-1 py-2 text-center text-white ${h?.isToday ? 'bg-cyan-600' : 'bg-sky-800'}`}>
                    <span className="block text-[15px] font-bold leading-tight">{h?.title}</span>
                    <span className="block text-[12px] font-medium leading-tight text-sky-100">{h?.date}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            <tr data-tmd-row="cond">
              <th scope="row" className={`${label} border-b border-white bg-sky-100 text-sky-950`}>สภาพอากาศ</th>
              {days.map(day => <CondCell key={day.time} day={day} className={cell} />)}
            </tr>
            <tr data-tmd-row="tmax">
              <th scope="row" className={`${label} border-b border-white bg-red-600 text-white`}>อุณหภูมิสูงสุด</th>
              {days.map(day => <TempCell key={day.time} value={day.tcMax} kind="สูงสุด" className={`${cell} bg-red-50 text-red-700`} />)}
            </tr>
            <tr data-tmd-row="tmin">
              <th scope="row" className={`${label} border-b border-white bg-sky-600 text-white`}>อุณหภูมิต่ำสุด</th>
              {days.map(day => <TempCell key={day.time} value={day.tcMin} kind="ต่ำสุด" className={`${cell} bg-sky-50 text-sky-700`} />)}
            </tr>
            <tr data-tmd-row="wind">
              <th scope="row" className={`${label} border-b border-white bg-slate-100 text-slate-900`}>
                ลมกระโชก
                <span className="mt-0.5 block text-[12px] font-medium text-slate-600">แรงสุดของวัน</span>
              </th>
              {days.map(day => <WindCell key={day.time} day={day} className={cell} />)}
            </tr>
            <tr data-tmd-row="rain">
              <th scope="row" className={`${label} bg-blue-100 text-blue-950`}>
                ฝน
                <span className="mt-0.5 block text-[12px] font-medium text-blue-900">รวมทั้งวัน</span>
              </th>
              {days.map(day => <RainCell key={day.time} day={day} className="px-1 py-2.5 text-center align-middle" />)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CondCell({ day, className }) {
  const cond = conditionInfo(day.cond)
  const Icon = cond ? COND_ICONS[cond.icon] : null
  return (
    <td data-tmd-cell="cond" className={className}>
      {cond && Icon ? (
        <>
          <Icon size={34} className={`mx-auto ${COND_TONE[cond.icon] ?? 'text-sky-600'}`} aria-hidden="true" />
          <span className="mt-1 block text-[13px] font-semibold leading-tight text-gray-800">{cond.label}</span>
        </>
      ) : <span className="text-lg font-bold text-gray-500" aria-label="ไม่มีข้อมูลสภาพอากาศ">–</span>}
    </td>
  )
}

function TempCell({ value, kind, className }) {
  const n = tempRound(value)
  return (
    <td data-tmd-cell="temp" className={className}>
      {n === null
        ? <span className="text-xl font-bold" aria-label={`ไม่มีข้อมูลอุณหภูมิ${kind}`}>–</span>
        : <span className="text-2xl font-extrabold leading-none" aria-label={`อุณหภูมิ${kind} ${n} องศาเซลเซียส`}>{n}<span className="text-sm font-bold">°C</span></span>}
    </td>
  )
}

// ⚠️ ws10m รายวันของ NWP = ลม "แรงสุด" ของวัน (ลมกระโชก) ไม่ใช่ลมปกติ — วันธรรมดาขึ้น 30–40 กม./ชม.
// ห้ามจัดระดับด้วย WIND_LEVELS (เกณฑ์ลมปกติจากภาพของกรม) ไม่งั้นขึ้น "ลมแรง" สีแดงทุกวัน ชาวบ้านตกใจเกินเหตุ
// (เจ้าของระบบเลือก 2569-11-15: ป้ายสีกลาง ไม่มีคำระดับ จนกว่าจะได้ลมรายจังหวัดของกรมที่ต้องใช้ uid/ukey)
function WindCell({ day, className }) {
  const kmh = windKmh(day.windMs)
  const dir = windDirection(day.windDir)
  const aria = kmh === null ? 'ไม่มีข้อมูลลม'
    : `ลมกระโชกแรงสุด ${kmh} กิโลเมตรต่อชั่วโมง${dir ? ` พัดมาจากทิศ${dir.from}` : ''}`
  return (
    <td data-tmd-cell="wind" className={className} aria-label={aria}>
      {kmh === null ? <span className="text-lg font-bold text-gray-500">–</span> : (
        <div className="flex flex-col items-center gap-1">
          {/* ลูกศรชี้ไปทางที่ลมพัดไป (พัดมาจาก + 180°) · ถ้าไม่มีทิศ = ไม่วาดลูกศร ไม่เดาเป็นเหนือ */}
          {dir && <ArrowUp size={26} strokeWidth={2.6} className="text-slate-700" style={{ transform: `rotate(${dir.toDeg}deg)` }} data-wind-to={dir.toDeg} aria-hidden="true" />}
          {dir && <span className="text-[12px] font-medium leading-tight text-gray-700">จาก{dir.from}</span>}
          <span data-wind-gust className="rounded-lg bg-slate-100 px-1.5 py-0.5 text-sm font-bold leading-tight text-slate-800">
            {kmh} <span className="text-[12px] font-semibold">กม./ชม.</span>
          </span>
        </div>
      )}
    </td>
  )
}

function RainCell({ day, className }) {
  const level = dailyRainLevel(day.rain)
  return (
    <td data-tmd-cell="rain" className={className}>
      {level ? (
        <>
          <span className={`inline-block rounded-xl px-1.5 py-1 text-[15px] font-bold leading-tight ${level.chip}`}>{level.label}</span>
          <span className="mt-1 block text-[12px] font-medium text-gray-700">{rainText(day.rain)} มม.</span>
        </>
      ) : (
        <>
          <span className="block text-lg font-bold text-gray-500" aria-label="ไม่มีข้อมูลฝน">–</span>
          <span className="block text-[12px] text-gray-600">ไม่มีข้อมูล</span>
        </>
      )}
    </td>
  )
}

// แถบคำอธิบาย: ระดับฝน (ช่วง มม. จาก RAIN_LEVELS) + คำอธิบายลมกระโชก (ไม่จัดระดับ — ดู WindCell)
function Legend() {
  return (
    <div data-tmd-legend className="grid gap-3 border-t border-gray-100 bg-gray-50 px-4 py-3 md:grid-cols-2">
      <div>
        <p className="text-xs font-bold text-gray-700">ระดับฝน (ปริมาณฝนรวมทั้งวัน)</p>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
          {rainLegend().map(({ level, range }) => (
            <li key={level.key} className="flex items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${level.chip}`}>{level.label}</span>
              <span className="text-[12px] text-gray-600">{range}</span>
            </li>
          ))}
        </ul>
      </div>
      <div data-tmd-wind-note>
        <p className="text-xs font-bold text-gray-700">ลมกระโชกแรงสุด</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">
          ความเร็วลมแรงสุดช่วงสั้นๆ ของวันจากแบบจำลอง (กิโลเมตร/ชั่วโมง) ไม่ใช่ลมที่พัดตลอดวัน — ลมปกติมักเบากว่านี้มาก
        </p>
      </div>
    </div>
  )
}

// ฝนรายชั่วโมง 48 ชม. — ส่วนพับใต้ตาราง (ไม่อยู่ในภาพอ้างอิงของกรม แต่เก็บไว้ให้คนที่อยากดูละเอียด)
function HourlyStrip({ hours }) {
  const summary = hourlyRainSummary(hours)
  const known = hours.map(h => h.rain).filter(v => v !== null)
  const scale = Math.max(HOURLY_SCALE_FLOOR_MM, ...known)
  const summaryText = summary.total === null
    ? 'ยังไม่มีค่าฝนรายชั่วโมงในช่วงนี้'
    : summary.total === 0
      ? 'ไม่มีฝนตามพยากรณ์ในช่วงนี้'
      : `ฝนรวมในช่วงนี้ ${rainText(summary.total)} มม.${summary.peak ? ` · ตกแรงสุดราว ${hourText(summary.peak.time)} น. (${rainText(summary.peak.rain)} มม./ชม.)` : ''}`

  return (
    <details data-tmd-hourly className="group border-t border-gray-100">
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-bold text-sky-800 [&::-webkit-details-marker]:hidden">
        <span>ดูฝนรายชั่วโมง {hours.length} ชม. ข้างหน้า</span>
        <ChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-4 pb-3">
        <p className="text-xs text-gray-600">{summaryText}</p>
        <div role="img" aria-label={`แผนภูมิแท่งฝนรายชั่วโมง ${hours.length} ชั่วโมง ${summaryText}`} className="mt-3">
          <div className="flex h-24 items-end gap-px border-b border-gray-200">
            {hours.map(h => <HourBar key={h.time} hour={h} scale={scale} />)}
          </div>
          {/* ป้ายเวลาทุก 6 ชม. (00 06 12 18 น. เวลาไทย) วางกึ่งกลางแท่งเดียวกับที่ชี้ */}
          <div className="flex h-5 gap-px" aria-hidden="true">
            {hours.map(h => (
              <div key={h.time} className="relative min-w-0 flex-1">
                {Number(hourText(h.time).slice(0, 2)) % 6 === 0 && (
                  <span className="absolute left-1/2 top-0.5 -translate-x-1/2 whitespace-nowrap text-[12px] leading-none text-gray-500">{hourText(h.time)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          เวลาไทย · แท่งสูงสุดแทน {rainText(scale)} มม./ชม.
          {summary.missing > 0 && <> · เส้นประ = {summary.missing} ชม. ที่กรมไม่ส่งค่ามา (ไม่ใช่ &quot;ไม่มีฝน&quot;)</>}
        </p>
      </div>
    </details>
  )
}

function HourBar({ hour, scale }) {
  const title = `${hourText(hour.time)} น. · ${hour.rain === null ? 'ไม่มีค่า' : `${rainText(hour.rain)} มม./ชม.`}`
  if (hour.rain === null) {
    // ไม่มีค่า ≠ ไม่มีฝน: วาดเป็นเส้นประโปร่ง ให้ต่างจากแท่ง 0 มม. ชัด
    return <div title={title} className="h-3 min-w-0 flex-1 rounded-sm border border-dashed border-gray-300" />
  }
  const height = hour.rain > 0 ? Math.min(100, Math.max(3, (hour.rain / scale) * 100)) : 0
  return (
    <div title={title} className="flex h-full min-w-0 flex-1 items-end">
      <div className={`w-full rounded-t-sm ${hour.rain > 0 ? 'bg-sky-400' : 'bg-gray-200'}`} style={{ height: hour.rain > 0 ? `${height}%` : '2px' }} />
    </div>
  )
}

// โลโก้ตัวหนังสือ "Smart City Local" แบบเดิมของระบบ (ยกแบบจาก smartCityMarkSvg ใน complaintNewsImage.js — เจ้าของสั่งใช้แบบนี้ 2569-11-15)
// wifi น้ำเงินซ้าย · Smart/Local ไล่น้ำเงิน · City ไล่ส้มทอง · ตัวหนาเอียง -11° ขอบขาวหนา + เงา · หมุดแดงขวา
// เป็น SVG ล้วน (ไม่ใช้ -webkit-text-stroke/filter ที่ Safari กับ Chrome แสดงไม่เหมือนกัน) · แต่ละคำเป็น <text> 3 ชั้น (เงา → ขอบขาว → ไล่สี)
// ล็อกความกว้างรายคำด้วย textLength (spacingAndGlyphs) ให้ตำแหน่งเท่ากันทุกเครื่องแม้ฟอนต์ที่ตกมาแทนกว้างต่างกัน · ไล่สีใช้ userSpaceOnUse (ไม่พึ่ง bbox ของ <text>)
// อยู่บนแถบพื้นเข้มของแถบท้าย เหมือนภาพตัวอย่าง — ขอบขาวหนาทำให้อ่านออกทั้งบนพื้นเข้มและอ่อน
const SC_LAYOUT = [{ x: 54, len: 128 }, { x: 190, len: 84 }, { x: 282, len: 100 }]
const SC_WORDS = SMART_CITY_LOCAL_WORDS.map(([text, fill], i) => ({ text, fill, ...SC_LAYOUT[i] }))
function SmartCityLocalMark() {
  const c = SMART_CITY_COLORS
  const arc = r => `M${(22 - r * 0.74).toFixed(2)} ${(52 - r * 0.67).toFixed(2)}A${r} ${r} 0 0 1 ${(22 + r * 0.74).toFixed(2)} ${(52 - r * 0.67).toFixed(2)}`
  return (
    <svg data-smart-city-local role="img" aria-label="Smart City Local" viewBox="0 0 424 76" className="h-10 w-auto shrink-0" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="tmd-sc-blue" gradientUnits="userSpaceOnUse" x1="0" y1="22" x2="0" y2="60">
          <stop offset="0" stopColor={c.blue[0]} /><stop offset="1" stopColor={c.blue[1]} />
        </linearGradient>
        <linearGradient id="tmd-sc-orange" gradientUnits="userSpaceOnUse" x1="0" y1="22" x2="0" y2="60">
          <stop offset="0" stopColor={c.orange[0]} /><stop offset="0.55" stopColor={c.orange[1]} /><stop offset="1" stopColor={c.orange[2]} />
        </linearGradient>
      </defs>
      <g data-sc-wifi="1">
        {[8, 16, 24].map(r => <path key={r} d={arc(r)} fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" />)}
        {[8, 16, 24].map(r => <path key={`b${r}`} d={arc(r)} fill="none" stroke={c.wifi} strokeWidth="4.5" strokeLinecap="round" />)}
        <circle cx="22" cy="52" r="6.5" fill="#fff" /><circle cx="22" cy="52" r="4" fill={c.wifi} />
      </g>
      {SC_WORDS.map(w => {
        const common = { transform: `translate(${w.x} 56) skewX(-11)`, fontSize: 46, fontWeight: 800, textLength: w.len, lengthAdjust: 'spacingAndGlyphs', fontFamily: 'Arial, Helvetica, sans-serif' }
        return (
          <g key={w.text} data-sc-word={w.text} data-sc-tone={w.fill}>
            <text {...common} dx="2" dy="4" fill={c.shadow} fillOpacity="0.45">{w.text}</text>
            <text {...common} fill="#fff" stroke="#fff" strokeWidth="7" strokeLinejoin="round">{w.text}</text>
            <text {...common} fill={`url(#tmd-sc-${w.fill})`} stroke={c.stroke} strokeWidth="1" strokeLinejoin="round">{w.text}</text>
          </g>
        )
      })}
      <g data-sc-pin="1" transform="translate(406 14)">
        <ellipse cx="0" cy="38" rx="8" ry="2.5" fill={c.shadow} fillOpacity="0.3" />
        <path d="M0 38C-4 29-15 21-15 11A15 15 0 0 1 15 11C15 21 4 29 0 38Z" fill={c.pin} stroke="#fff" strokeWidth="2.5" />
        <circle cx="0" cy="11" r="5.2" fill="#fff" />
      </g>
    </svg>
  )
}

// แถบท้าย: ที่มา (ชื่อกรม + ลิงก์เอกสาร) คู่กับคำ "Smart City Local" แบบที่ภาพของกรมวางเว็บไซต์/เบอร์ไว้แถบท้าย · ใต้แถบ = เวลาที่ดึง/จุดกริด/คำกำกับ
function SourceBox({ forecast, tenantName, now }) {
  const hourlyAt = fetchedAtText(forecast.hourlyFetchedAt, now)
  const dailyAt = fetchedAtText(forecast.dailyFetchedAt, now)
  const hourlyGrid = gridText(forecast.hourlyGrid)
  const dailyGrid = gridText(forecast.dailyGrid)
  const sameGrid = hourlyGrid && hourlyGrid === dailyGrid
  const sameTime = hourlyAt && hourlyAt === dailyAt
  return (
    <div data-tmd-source className="border-t border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-slate-800 px-4 py-2.5 text-white">
        <div className="min-w-0 text-xs leading-relaxed">
          <p><span className="font-bold">ที่มา:</span> {TMD_SOURCE_NAME} — {TMD_SOURCE_TEXT}</p>
          <a href={TMD_SOURCE_DOC_URL} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-sky-200 underline">
            เอกสารข้อมูลพยากรณ์ของกรม (data.tmd.go.th/nwpapi/doc) <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
        <SmartCityLocalMark />
      </div>
      <div className="space-y-1.5 bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
        {(hourlyAt || dailyAt) && (
          <p>
            <span className="font-semibold text-gray-700">ดึงข้อมูลล่าสุด:</span>{' '}
            {sameTime ? hourlyAt : [hourlyAt && `รายชั่วโมง ${hourlyAt}`, dailyAt && `รายวัน ${dailyAt}`].filter(Boolean).join(' · ')}
          </p>
        )}
        {(hourlyGrid || dailyGrid) && (
          <p>
            {sameGrid
              ? `ณ จุดกริด ${hourlyGrid}`
              : [hourlyGrid && `รายชั่วโมง ณ จุดกริด ${hourlyGrid} (ความละเอียดราว 2 กม.)`, dailyGrid && `รายวัน ณ จุดกริด ${dailyGrid} (ความละเอียดราว 18–27 กม.)`].filter(Boolean).join(' · ')}
            {' '}— เป็นค่าของจุดกริดแบบจำลอง ไม่ใช่ค่าวัดจากสถานีหรือพิกัดสำนักงานโดยตรง
          </p>
        )}
        <p>
          พยากรณ์อาจคลาดเคลื่อน <span className="font-semibold text-gray-700">ไม่ใช่ประกาศเตือนภัยของ{tenantName || 'หน่วยงาน'}</span>
        </p>
      </div>
    </div>
  )
}
