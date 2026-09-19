import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, CloudRain, Dam, ExternalLink,
  MapPin, RefreshCw, Waves,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useVisibleRefresh } from '../hooks/useVisibleRefresh'
import {
  DAM_LEVELS, DAM_STALE_HOURS, STATION_STALE_HOURS, SYNC_STALE_HOURS, bankText, damLevel, damTrend,
  buildAlerts, dataDayText, distanceText, ewsAlert, formatMcm, formatMm, isStale, mapUrl, measuredAtText, rainLevel,
  safeColor, stationPlace, toNum, waterTrend,
} from '../lib/waterSituation'

// ข้อมูลในฐานเปลี่ยนชั่วโมงละครั้ง (thaiwater-sync) — ถามซ้ำถี่กว่านี้ก็ไม่ได้ของใหม่ เปลืองโควตาฟรีเปล่า
const REFRESH_MS = 5 * 60 * 1000
const THAIWATER_URL = 'https://www.thaiwater.net'
const EWS_URL = 'https://ews.dwr.go.th/'

function fetchSituation(municipalityId) {
  return supabase.rpc('get_public_water_situation', { _municipality_id: municipalityId })
}

/**
 * สถานการณ์น้ำ-ฝน — ฝั่งประชาชน (ไม่ต้องล็อกอิน)
 *
 * แสดงค่าจากสถานีตรวจวัดของคลังข้อมูลน้ำแห่งชาติ (ThaiWater, สสน.) ที่ตั้งค่าไว้ต่อ อปท.
 * ใน water_station_config — ระบบดึงให้เองทุกชั่วโมง ไม่มีเจ้าหน้าที่คนไหนต้องกรอกหรือกดอะไร
 * หน้านี้อ่านจากฐานข้อมูลเราเท่านั้น ไม่ยิงไปต้นทาง (ต้นทางส่งข้อมูลทั้งประเทศก้อนละหลาย MB)
 *
 * ตั้งใจไม่แปลความสถานการณ์เอง: ป้าย "น้ำปกติ/น้ำมาก" มาจากเกณฑ์ของต้นทาง ส่วนป้ายฝนเทียบเกณฑ์
 * กรมอุตุนิยมวิทยา และเขียนกำกับชัดว่าไม่ใช่ประกาศเตือนภัยของหน่วยงาน
 */
export default function WaterSituationPage() {
  const navigate = useNavigate()
  const { tenant, loading: tenantLoading } = useTenant()
  const tenantId = tenant?.id
  const [data, setData] = useState(null)        // null = ยังไม่เคยโหลดสำเร็จ
  const [loadError, setLoadError] = useState(false)
  const [checkedAt, setCheckedAt] = useState(null)

  // รอบที่โหลดพลาดแต่เคยมีข้อมูลแล้ว ให้แสดงของเดิมต่อ — ตัวเตือน "ข้อมูลไม่เป็นปัจจุบัน" ทำงานเองถ้าค้างนาน
  const applyResult = useCallback((result, error) => {
    setCheckedAt(Date.now())
    setLoadError(Boolean(error))
    if (!error) setData(result ?? { stations: [] })
  }, [])

  useEffect(() => {
    if (!tenantId) return
    let alive = true
    fetchSituation(tenantId)
      .then(({ data: result, error }) => { if (alive) applyResult(result, error) })
      .catch(() => { if (alive) applyResult(null, true) })
    return () => { alive = false }
  }, [tenantId, applyResult])

  const refresh = useCallback(() => {
    if (!tenantId) return
    fetchSituation(tenantId)
      .then(({ data: result, error }) => applyResult(result, error))
      .catch(() => applyResult(null, true))
  }, [tenantId, applyResult])

  useVisibleRefresh(refresh, { intervalMs: REFRESH_MS, enabled: Boolean(tenantId) })

  const stations = data?.stations ?? []
  const rain = stations.filter(s => s.station_type === 'rain')
  const levels = stations.filter(s => s.station_type === 'waterlevel')
  const dams = stations.filter(s => s.station_type === 'dam')
  // สถานะสถานีเตือนภัยของกรมทรัพยากรน้ำ ไม่มีแถวของตัวเองบนหน้า — ติดเป็นป้ายบนแถวฝนรหัสเดียวกัน
  // (สถานีเตือนภัยในรัศมี 10 กม. ทุกแห่งเป็นสถานีฝนที่แสดงอยู่แล้ว ตรวจ 2569-09-19) + แถบเตือนบนสุด
  const ews = stations.filter(s => s.station_type === 'ews')
  const ewsByCode = new Map(ews.map(s => [s.station_code, s]))
  const loading = tenantLoading || Boolean(tenantId && data === null && !loadError)

  return (
    <div className="max-w-lg mx-auto pb-28 md:pb-8">
      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label="ย้อนกลับ"
            className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">สถานการณ์น้ำ-ฝน</h1>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center gap-3 px-4 pt-8 pb-5 border-b border-gray-100 mb-2">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0 bg-sky-100">🌧️</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">สถานการณ์น้ำ-ฝน</h1>
          <p className="text-sm text-gray-500 mt-0.5">ปริมาณฝนและระดับน้ำจากสถานีตรวจวัดใกล้พื้นที่</p>
        </div>
      </div>

      <div className="px-4 pt-1 md:pt-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />)}
          </div>
        ) : data === null ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <p>โหลดข้อมูลสถานการณ์น้ำไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p>
            <button onClick={refresh}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold text-rose-700 border border-rose-200">
              <RefreshCw size={15} /> ลองใหม่
            </button>
          </div>
        ) : stations.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
            <CloudRain size={32} className="mx-auto text-gray-300" />
            <p className="mt-2 text-sm font-semibold text-gray-700">ยังไม่ได้ตั้งค่าสถานีตรวจวัดของหน่วยงานนี้</p>
            <a href={THAIWATER_URL} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-700">
              ดูสถานการณ์น้ำทั่วประเทศที่ thaiwater.net <ExternalLink size={12} />
            </a>
          </div>
        ) : (
          <>
            <SyncStatus syncedAt={data.synced_at} now={checkedAt} refreshFailed={loadError} />
            <AlertBanner rain={rain} ews={ews} warnings={data.warnings} homeAmphoe={tenant?.district} now={checkedAt}
              tenantName={tenant?.name} />
            {rain.length > 0 && (
              <RainSection stations={rain} ewsByCode={ewsByCode} homeAmphoe={tenant?.district} now={checkedAt} />
            )}
            {levels.length > 0 && <WaterLevelSection stations={levels} homeAmphoe={tenant?.district} now={checkedAt} />}
            {dams.length > 0 && <DamSection stations={dams} homeAmphoe={tenant?.district} now={checkedAt} />}
            <SourceNote tenantName={tenant?.name} />
          </>
        )}
      </div>
    </div>
  )
}

function SyncStatus({ syncedAt, now, refreshFailed }) {
  if (!syncedAt) {
    // ตั้งค่าสถานีแล้วแต่ระบบยังไม่เคยดึงสำเร็จ (เพิ่งเปิดใช้ หรือ Edge Function ยังไม่ได้ deploy)
    return (
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
        ระบบกำลังเริ่มดึงข้อมูลจากสถานี ตัวเลขจะขึ้นภายใน 1 ชั่วโมง
      </div>
    )
  }
  if (isStale(syncedAt, now, SYNC_STALE_HOURS)) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <AlertTriangle size={17} className="mt-0.5 shrink-0" />
        <p>
          ระบบดึงข้อมูลได้ล่าสุดเมื่อ <span className="font-semibold">{measuredAtText(syncedAt, now)}</span>{' '}
          ตัวเลขด้านล่างอาจไม่เป็นปัจจุบัน ตรวจสอบค่าล่าสุดได้ที่{' '}
          <a href={THAIWATER_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline">thaiwater.net</a>
        </p>
      </div>
    )
  }
  return (
    <p className="flex items-center gap-1.5 px-1 text-xs text-gray-500">
      <RefreshCw size={13} className="shrink-0" />
      อัปเดตล่าสุด {measuredAtText(syncedAt, now)} · ระบบดึงข้อมูลเองทุกชั่วโมง
      {refreshFailed && <span className="text-amber-700">· รอบล่าสุดโหลดไม่สำเร็จ แสดงข้อมูลเดิม</span>}
    </p>
  )
}

// แถบเตือนบนสุดของหน้า — กติกาเดียวกับ Telegram (buildAlerts ↔ water-alert-notify)
// ขึ้นเฉพาะเมื่อมีเรื่องเข้าเกณฑ์ ไม่มีข้อความ "ปกติ" ให้วางใจ — ไม่มีแถบแปลว่าไม่มีเรื่องที่เข้าเกณฑ์
// ไม่ได้แปลว่าปลอดภัย · แต่ละส่วนบอกที่มาของตัวเอง และย้ำว่าไม่ใช่ประกาศของ อปท.
function AlertBanner({ rain, ews, warnings, homeAmphoe, now, tenantName }) {
  const alerts = buildAlerts({ rain, ews, warnings, now })
  if (!alerts.any) return null

  return (
    <div role="alert" className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm font-bold leading-snug text-gray-900">แจ้งเตือนสถานการณ์น้ำ-ฝนใกล้พื้นที่</p>

          {alerts.heavyRain.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-700">ฝนหนักมาก (ตั้งแต่ 90.1 มม. ใน 24 ชม. ตามเกณฑ์กรมอุตุนิยมวิทยา)</p>
              <ul className="mt-1 space-y-1.5">
                {alerts.heavyRain.map(s => (
                  <li key={s.station_code} className="text-sm text-gray-800">
                    <span className="font-semibold">{s.station_name}</span> {formatMm(s.rain_24h_mm)} มม.
                    <span className="block text-xs text-gray-600">
                      {[stationPlace(s, homeAmphoe), distanceText(s.distance_km), `วัดเมื่อ ${measuredAtText(s.recorded_at, now)}`]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alerts.warnings.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-700">
                ข้อความเตือนจาก สสน.{homeAmphoe ? ` ใน อ.${homeAmphoe}` : ''} (ตามต้นฉบับ)
              </p>
              <ul className="mt-1 space-y-1.5">
                {alerts.warnings.map(w => (
                  <li key={`${w.issued_at}|${w.message}`} className="text-sm leading-snug text-gray-800">
                    {w.message}
                    <span className="block text-xs text-gray-600">{measuredAtText(w.issued_at, now)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alerts.ews.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-700">สถานีเตือนภัยน้ำหลาก-ดินถล่ม (กรมทรัพยากรน้ำ)</p>
              <ul className="mt-1 space-y-1.5">
                {alerts.ews.map(({ station: s, alert }) => (
                  <li key={s.station_code} className="flex items-start gap-1.5 text-sm text-gray-800">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: alert.color }} />
                    <span>
                      <span className="font-semibold">{s.station_name}</span> · {alert.text}
                      <span className="block text-xs text-gray-600">
                        {[stationPlace(s, homeAmphoe), distanceText(s.distance_km), `รายงานเมื่อ ${measuredAtText(s.recorded_at, now)}`]
                          .filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs leading-relaxed text-gray-700">
            ข้อมูลจากหน่วยงานที่ระบุไว้ ไม่ใช่ประกาศของ{tenantName || 'หน่วยงาน'} — โปรดติดตามประกาศจากหน่วยงานในพื้นที่
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
            <a href={THAIWATER_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[32px] items-center gap-1 text-gray-800 underline">
              thaiwater.net <ExternalLink size={12} />
            </a>
            {alerts.ews.length > 0 && (
              <a href={EWS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[32px] items-center gap-1 text-gray-800 underline">
                ระบบเตือนภัยของกรมทรัพยากรน้ำ <ExternalLink size={12} />
              </a>
            )}
            <Link to="/emergency" className="inline-flex min-h-[32px] items-center text-gray-800 underline">สายด่วนฉุกเฉิน</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function RainSection({ stations, ewsByCode, homeAmphoe, now }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-start gap-2.5 border-b border-gray-50 px-4 py-3">
        <CloudRain size={19} className="mt-0.5 shrink-0 text-sky-600" />
        <div>
          <h2 className="text-sm font-bold text-gray-800">ปริมาณฝนสะสม 24 ชั่วโมง</h2>
          <p className="text-xs text-gray-500">สถานีวัดฝนใกล้สำนักงาน เรียงจากใกล้ไปไกล</p>
        </div>
      </div>
      <ul className="divide-y divide-gray-50">
        {stations.map(s => (
          <RainRow key={s.station_code} station={s} ews={ewsByCode.get(s.station_code)} homeAmphoe={homeAmphoe} now={now} />
        ))}
      </ul>
      <div className="space-y-1 border-t border-gray-50 px-4 py-3 text-[11px] leading-relaxed text-gray-400">
        <p>
          ป้ายเทียบเกณฑ์ปริมาณฝนของกรมอุตุนิยมวิทยา: ฝนเล็กน้อย 0.1–10 · ฝนปานกลาง 10.1–35 · ฝนหนัก 35.1–90 ·
          ฝนหนักมาก 90.1 มม. ขึ้นไป
        </p>
        {ewsByCode.size > 0 && (
          <p>
            ป้าย &quot;น้ำหลาก-ดินถล่ม&quot; คือสถานะจากระบบเตือนภัยล่วงหน้าของกรมทรัพยากรน้ำ (เฝ้าระวัง · เตรียมพร้อม ·
            วิกฤติ) ขึ้นเฉพาะเมื่อสถานีอยู่ในระดับเตือน
          </p>
        )}
      </div>
    </section>
  )
}

function RainRow({ station: s, ews, homeAmphoe, now }) {
  const level = rainLevel(s.rain_24h_mm)
  const stale = Boolean(s.recorded_at) && isStale(s.recorded_at, now, STATION_STALE_HOURS)
  const rain1h = toNum(s.rain_1h_mm)
  const meta = [stationPlace(s, homeAmphoe), distanceText(s.distance_km)].filter(Boolean).join(' · ')
  const warning = ewsAlert(ews, now)

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight text-gray-800">
          {s.station_name}
          {s.is_primary && (
            <span className="ml-1.5 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 align-middle text-[10px] font-bold text-emerald-700">
              ในตำบล
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">{meta}</p>
        {s.note && <p className="mt-0.5 text-xs text-amber-700">{s.note}</p>}
        {warning && (
          <p className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold text-gray-800 ${warning.stale ? 'opacity-60' : ''}`}
            style={{ borderColor: warning.color }}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: warning.color }} />
            น้ำหลาก-ดินถล่ม: {warning.text} ·{' '}
            {warning.stale ? `ไม่มีรายงานใหม่ตั้งแต่ ${measuredAtText(ews.recorded_at, now)}` : measuredAtText(ews.recorded_at, now)}
          </p>
        )}
        {stale ? (
          <p className="mt-0.5 text-xs text-amber-700">ไม่มีค่าใหม่ตั้งแต่ {measuredAtText(s.recorded_at, now)}</p>
        ) : level && rain1h > 0 ? (
          <p className="mt-0.5 text-xs text-sky-700">ชั่วโมงล่าสุด {formatMm(rain1h)} มม. · วัดเมื่อ {measuredAtText(s.recorded_at, now)}</p>
        ) : level ? (
          <p className="mt-0.5 text-xs text-gray-400">วัดเมื่อ {measuredAtText(s.recorded_at, now)}</p>
        ) : null}
      </div>
      <div className={`shrink-0 text-right ${stale ? 'opacity-50' : ''}`}>
        {level ? (
          <>
            <p className="text-lg font-bold leading-none text-gray-900">
              {formatMm(s.rain_24h_mm)} <span className="text-xs font-semibold text-gray-500">มม.</span>
            </p>
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${level.chip}`}>{level.label}</span>
          </>
        ) : (
          <p className="text-xs text-gray-400">ไม่มีข้อมูลล่าสุด</p>
        )}
      </div>
    </li>
  )
}

function WaterLevelSection({ stations, homeAmphoe, now }) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5 px-1">
        <Waves size={19} className="mt-0.5 shrink-0 text-cyan-600" />
        <div>
          <h2 className="text-sm font-bold text-gray-800">ระดับน้ำในลำน้ำ</h2>
          <p className="text-xs text-gray-500">
            สถานีวัดระดับน้ำที่ใกล้สำนักงานที่สุด อาจอยู่นอกพื้นที่ — ใช้ดูแนวโน้มของลำน้ำ ไม่ใช่ระดับน้ำในหมู่บ้าน
          </p>
        </div>
      </div>
      {stations.map(s => <WaterLevelCard key={s.station_code} station={s} homeAmphoe={homeAmphoe} now={now} />)}
    </section>
  )
}

const TREND_STYLE = {
  up:   { Icon: ArrowUpRight,   className: 'text-amber-700' },
  down: { Icon: ArrowDownRight, className: 'text-sky-700' },
  flat: { Icon: ArrowRight,     className: 'text-gray-600' },
}

function WaterLevelCard({ station: s, homeAmphoe, now }) {
  const hasValue = s.recorded_at && (toNum(s.waterlevel_msl) !== null || toNum(s.storage_percent) !== null)
  const stale = Boolean(s.recorded_at) && isStale(s.recorded_at, now, STATION_STALE_HOURS)
  const color = safeColor(s.situation_color)
  const trend = waterTrend(s.waterlevel_msl, s.prev_waterlevel_msl)
  const TrendIcon = trend ? TREND_STYLE[trend.dir].Icon : null
  const percent = toNum(s.storage_percent)
  const level = toNum(s.waterlevel_msl)
  const bank = bankText(s.bank_diff_m)
  const mapHref = mapUrl(s.latitude, s.longitude)
  const meta = [stationPlace(s, homeAmphoe), distanceText(s.distance_km)].filter(Boolean).join(' · ')

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: hasValue && !stale ? `${color}66` : '#f3f4f6' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {s.river_name && <p className="text-xs font-bold text-cyan-700">{s.river_name}</p>}
          <p className="text-base font-bold leading-tight text-gray-900">
            สถานี{s.station_name}
            {s.is_primary && (
              <span className="ml-1.5 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 align-middle text-[10px] font-bold text-emerald-700">
                ในตำบล
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">{meta}</p>
          {s.note && <p className="mt-0.5 text-xs text-amber-700">{s.note}</p>}
        </div>
        {hasValue && s.situation_text && (
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold text-gray-800 ${stale ? 'opacity-50' : ''}`}
            style={{ borderColor: color }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {s.situation_text}
          </span>
        )}
      </div>

      {hasValue ? (
        <div className={`mt-3 grid grid-cols-2 gap-2 ${stale ? 'opacity-50' : ''}`}>
          <Metric label="เทียบตลิ่ง" value={bank ?? '–'} />
          <Metric label="ความจุลำน้ำ" value={percent !== null ? `${Math.round(percent)}%` : '–'} />
          <Metric label="แนวโน้ม" value={trend ? (
            <span className={`inline-flex items-center gap-1 ${TREND_STYLE[trend.dir].className}`}>
              <TrendIcon size={15} /> {trend.label}
            </span>
          ) : 'รอข้อมูลรอบถัดไป'}
            hint={trend && s.prev_recorded_at ? `เทียบกับ ${measuredAtText(s.prev_recorded_at, now)}` : null} />
          <Metric label="ระดับน้ำ" value={level !== null ? `${level.toFixed(2)} ม.รทก.` : '–'} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-400">ไม่มีข้อมูลล่าสุด</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        {hasValue ? (
          stale
            ? <span className="text-amber-700">ไม่มีค่าใหม่ตั้งแต่ {measuredAtText(s.recorded_at, now)}</span>
            : <span className="text-gray-500">วัดเมื่อ {measuredAtText(s.recorded_at, now)}</span>
        ) : <span />}
        {mapHref && (
          <a href={mapHref} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-[32px] items-center gap-1 font-semibold text-cyan-700">
            <MapPin size={13} /> ตำแหน่งสถานี
          </a>
        )}
      </div>
    </div>
  )
}

function DamSection({ stations, homeAmphoe, now }) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5 px-1">
        <Dam size={19} className="mt-0.5 shrink-0 text-blue-700" />
        <div>
          <h2 className="text-sm font-bold text-gray-800">อ่างเก็บน้ำใกล้พื้นที่</h2>
          {/* ภาษาไทยไม่มีเว้นวรรคระหว่างคำ เบราว์เซอร์ตัดบรรทัดกลางวลีได้ ("ใกล้ไป / ไกล" บนจอ 390px)
              ล็อกแต่ละวลีไว้ ให้ตัดได้เฉพาะช่องว่างระหว่างวลี */}
          <p className="text-xs text-gray-500">
            อ่างเก็บน้ำขนาดกลางของกรมชลประทาน{' '}
            <span className="whitespace-nowrap">เรียงจากใกล้ไปไกล</span> ·{' '}
            <span className="whitespace-nowrap">ข้อมูลรายวัน</span>
          </p>
        </div>
      </div>
      {stations.map(s => <DamCard key={s.station_code} station={s} homeAmphoe={homeAmphoe} now={now} />)}
      <div className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-[11px] leading-relaxed text-gray-500">
        <p>ป้ายเทียบเกณฑ์ % ของความจุที่ระดับเก็บกัก ตามรายงานของ สสน. และกรมชลประทาน:</p>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {DAM_LEVELS.map(l => (
            <li key={l.key} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
              {l.label} {l.range}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function DamCard({ station: s, homeAmphoe, now }) {
  const storage = toNum(s.dam_storage_mcm)
  const capacity = toNum(s.dam_capacity_mcm)
  const percent = toNum(s.storage_percent)
  const inflow = toNum(s.dam_inflow_mcm)
  const released = toNum(s.dam_released_mcm)
  const hasValue = Boolean(s.recorded_at) && storage !== null
  const stale = Boolean(s.recorded_at) && isStale(s.recorded_at, now, DAM_STALE_HOURS)
  const level = damLevel(percent)
  const color = safeColor(level?.color)
  const trend = damTrend(s.dam_storage_mcm, s.prev_dam_storage_mcm)
  const TrendIcon = trend ? TREND_STYLE[trend.dir].Icon : null
  const day = dataDayText(s.recorded_at, now)
  const mapHref = mapUrl(s.latitude, s.longitude)
  const meta = [stationPlace(s, homeAmphoe), distanceText(s.distance_km)].filter(Boolean).join(' · ')
  // แถบยาวได้สุด 100% — เกินความจุเก็บกักให้เต็มแถบ ตัวเลขกับป้ายบอกส่วนที่เกินเอง
  const barWidth = percent !== null ? Math.max(0, Math.min(percent, 100)) : 0

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: hasValue && !stale ? `${color}66` : '#f3f4f6' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-bold leading-tight text-gray-900">
            {s.station_name}
            {s.is_primary && (
              <span className="ml-1.5 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 align-middle text-[10px] font-bold text-emerald-700">
                ในตำบล
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">{meta}</p>
          {s.note && <p className="mt-0.5 text-xs text-amber-700">{s.note}</p>}
        </div>
        {hasValue && level && (
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold text-gray-800 ${stale ? 'opacity-50' : ''}`}
            style={{ borderColor: color }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {level.label}
          </span>
        )}
      </div>

      {hasValue ? (
        <div className={`mt-3 ${stale ? 'opacity-50' : ''}`}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-gray-600">
              <span className="text-lg font-bold text-gray-900">{formatMcm(storage)}</span>
              {capacity !== null && <> จาก {formatMcm(capacity)}</>} ล้าน ลบ.ม.
            </p>
            {percent !== null && (
              <p className="text-lg font-bold text-gray-900">
                {percent.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%
              </p>
            )}
          </div>
          {percent !== null && (
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-gray-100"
              role="img" aria-label={`ปริมาณน้ำในอ่าง ${percent.toFixed(1)}% ของความจุที่ระดับเก็บกัก`}>
              <div className="h-full rounded-full" style={{ width: `${barWidth}%`, backgroundColor: color }} />
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric label="น้ำไหลลงอ่าง/วัน" value={inflow !== null ? `${formatMcm(inflow)} ล้าน ลบ.ม.` : '–'} />
            <Metric label="น้ำระบาย/วัน" value={released !== null ? `${formatMcm(released)} ล้าน ลบ.ม.` : '–'} />
            <div className="col-span-2">
              <Metric label="ปริมาตรเทียบกับเมื่อวาน" value={trend ? (
                <span className={`inline-flex items-center gap-1 ${TREND_STYLE[trend.dir].className}`}>
                  <TrendIcon size={15} /> {trend.label}
                </span>
              ) : 'รอข้อมูลวันถัดไป'}
                hint={trend && s.prev_recorded_at ? `เทียบกับข้อมูลวันที่ ${dataDayText(s.prev_recorded_at, now)}` : null} />
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-400">ไม่มีข้อมูลล่าสุด</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        {hasValue ? (
          stale
            ? <span className="text-amber-700">ไม่มีข้อมูลใหม่ตั้งแต่ {day}</span>
            : <span className="text-gray-500">{day === 'วันนี้' ? 'ข้อมูลของวันนี้' : `ข้อมูลวันที่ ${day}`}</span>
        ) : <span />}
        {mapHref && (
          <a href={mapHref} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-[32px] items-center gap-1 font-semibold text-blue-700">
            <MapPin size={13} /> ตำแหน่งอ่าง
          </a>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-semibold text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-800">{value}</p>
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

function SourceNote({ tenantName }) {
  return (
    <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-xs leading-relaxed text-gray-600">
      <p>
        <span className="font-semibold text-gray-700">ที่มา:</span> คลังข้อมูลน้ำแห่งชาติ (ThaiWater)
        สถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน) และหน่วยงานเจ้าของสถานี
      </p>
      <p>
        เป็นค่าตรวจวัดจากสถานี <span className="font-semibold text-gray-700">ไม่ใช่ประกาศเตือนภัยของ{tenantName || 'หน่วยงาน'}</span>
        {' '}หากเกิดเหตุฉุกเฉินดูเบอร์ติดต่อได้ที่{' '}
        <Link to="/emergency" className="font-semibold text-sky-700 underline">สายด่วนฉุกเฉิน</Link>
      </p>
      <a href={THAIWATER_URL} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-semibold text-sky-700">
        ดูข้อมูลทั้งหมดที่ thaiwater.net <ExternalLink size={12} />
      </a>
    </div>
  )
}
