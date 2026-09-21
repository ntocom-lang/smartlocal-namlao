import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, CloudRain, Dam, ExternalLink,
  MapPin, RefreshCw, Waves,
} from 'lucide-react'
import './WaterSituationPage.css'
import WaterSituationShare from './WaterSituationShare'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useVisibleRefresh } from '../hooks/useVisibleRefresh'
import {
  DAM_LEVELS, DAM_STALE_HOURS, RAIN_VERY_HEAVY_MM, STATION_STALE_HOURS, SYNC_STALE_HOURS, bankText, barPercent,
  channelFill, damLevel, damTicks, damTrend, buildAlerts, dataDayText, distanceText, ewsAlert, flowCompare,
  formatMcm, formatMm, isStale, mapUrl, measuredAtText, rainBarMax, rainLevel, safeColor, stationPlace,
  summaryStats, toNum, waterTrend, localWaterSituation,
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
  const [searchParams] = useSearchParams()
  const localOnly = searchParams.get('scope') === 'local'
  const { tenant, loading: tenantLoading } = useTenant()
  const tenantId = tenant?.id
  const [data, setData] = useState(null)        // null = ยังไม่เคยโหลดสำเร็จ
  const [loadError, setLoadError] = useState(false)
  const [checkedAt, setCheckedAt] = useState(Date.now)

  // อายุข้อมูลต้องเดินต่อแม้ request ค้าง/ออฟไลน์ ไม่ผูกการหมดอายุกับการโหลดสำเร็จ
  useEffect(() => {
    const timer = setInterval(() => setCheckedAt(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

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

  const visibleData = localOnly ? localWaterSituation(data, tenant) : data
  const stations = visibleData?.stations ?? []
  const rain = stations.filter(s => s.station_type === 'rain')
  const levels = stations.filter(s => s.station_type === 'waterlevel')
  const dams = stations.filter(s => s.station_type === 'dam')
  // สถานะสถานีเตือนภัยของกรมทรัพยากรน้ำ ไม่มีแถวของตัวเองบนหน้า — ติดเป็นป้ายบนแถวฝนรหัสเดียวกัน
  // (สถานีเตือนภัยในรัศมี 10 กม. ทุกแห่งเป็นสถานีฝนที่แสดงอยู่แล้ว ตรวจ 2569-09-19) + แถบเตือนบนสุด
  const ews = stations.filter(s => s.station_type === 'ews')
  const ewsByCode = new Map(ews.map(s => [s.station_code, s]))
  const loading = tenantLoading || Boolean(tenantId && data === null && !loadError)

  return (
    // จอกว้าง (lg ขึ้นไป) ขยายเป็น 2 คอลัมน์ — คอลัมน์เดียวกว้าง 512px ทิ้งพื้นที่ว่างสองข้างเกินครึ่งจอ
    // และหน้ายาวราว 3,000px บนจอ 1440 · ต่ำกว่า lg คงคอลัมน์เดียวเหมือนมือถือ
    <div className="water-page max-w-lg lg:max-w-6xl mx-auto pb-28 md:pb-8">
      <header className="water-cover">
        <div className="water-cover-copy">
          <button onClick={() => navigate(-1)} aria-label="ย้อนกลับ" className="water-back md:hidden">
            <ArrowLeft size={20} /> <span>กลับ</span>
          </button>
          <p className="water-eyebrow"><Waves size={16} /> ข้อมูลน้ำใกล้คุณ</p>
          <h1>สถานการณ์น้ำ–ฝน</h1>
          <p className="water-cover-description">ติดตามฝน อ่างเก็บน้ำ และระดับน้ำ<br />{localOnly ? 'เฉพาะสถานีในตำบล ไม่รวมพื้นที่ข้างเคียง' : 'จากสถานีตรวจวัดใกล้พื้นที่'}</p>
          <span className="water-area"><MapPin size={14} /> {tenant?.name || 'สถานีตรวจวัดใกล้พื้นที่'}</span>
        </div>
        <WaterLandscape />
      </header>

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
            <p className="mt-2 text-sm font-semibold text-gray-700">{localOnly ? 'ไม่มีสถานีที่ยืนยันตำบล อำเภอ และจังหวัดตรงกับหน่วยงานนี้ ไม่ได้หมายความว่าสถานการณ์ปกติ' : 'ยังไม่ได้ตั้งค่าสถานีตรวจวัดของหน่วยงานนี้'}</p>
            <a href={THAIWATER_URL} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-sky-700">
              ดูสถานการณ์น้ำทั่วประเทศที่ thaiwater.net <ExternalLink size={12} />
            </a>
          </div>
        ) : (
          <>
            <SyncStatus syncedAt={data.synced_at} now={checkedAt} refreshFailed={loadError} />
            <AlertBanner rain={rain} ews={ews} warnings={visibleData.warnings} homeAmphoe={tenant?.district} now={checkedAt}
              tenantName={tenant?.name} />
            <HeroStats rain={rain} dams={dams} levels={levels} now={checkedAt} />
            <WaterSituationShare tenant={tenant} data={data} now={checkedAt} refreshFailed={loadError} renderCards={WaterShareCards} />
            <nav className="water-section-nav" aria-label="หมวดข้อมูลน้ำ–ฝน">
              {rain.length > 0 && <a href="#water-rain"><CloudRain size={18} /><span>ฝน</span><small>{rain.length} สถานี</small></a>}
              {dams.length > 0 && <a href="#water-dams"><Dam size={18} /><span>อ่างเก็บน้ำ</span><small>{dams.length} แห่ง</small></a>}
              {levels.length > 0 && <a href="#water-levels"><Waves size={18} /><span>ระดับน้ำ</span><small>{levels.length} สถานี</small></a>}
            </nav>
            {/* ซ้าย: ฝน · ขวา: อ่างเก็บน้ำ แล้วระดับน้ำ — มือถือเรียงตามลำดับเดิม ฝน → อ่าง → ระดับน้ำ
                จอ xl ขึ้นไปแยกเป็น 3 คอลัมน์ (xl:contents ปล่อยลูกของกล่องขวาไปเป็นช่องของกริดเอง)
                เพราะพอใส่ภาพตัดขวางแล้วคอลัมน์ขวายาวกว่าซ้ายราว 660px เหลือขาวครึ่งจอ */}
            <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0 xl:grid-cols-3">
              {rain.length > 0 && (
                <RainSection stations={rain} ewsByCode={ewsByCode} homeAmphoe={tenant?.district} now={checkedAt} />
              )}
              {(dams.length > 0 || levels.length > 0) && (
                <div className="space-y-4 xl:contents xl:space-y-0">
                  {dams.length > 0 && <DamSection stations={dams} homeAmphoe={tenant?.district} now={checkedAt} />}
                  {levels.length > 0 && <WaterLevelSection stations={levels} homeAmphoe={tenant?.district} now={checkedAt} />}
                </div>
              )}
            </div>
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
          <a href={THAIWATER_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center font-semibold underline">thaiwater.net</a>
        </p>
      </div>
    )
  }
  return (
    <p className="water-sync flex items-center gap-1.5 px-1 text-xs text-gray-500">
      <RefreshCw size={13} className="shrink-0" />
      อัปเดตล่าสุด {measuredAtText(syncedAt, now)} · ระบบดึงข้อมูลเองทุกชั่วโมง
      {refreshFailed && <span className="text-amber-700">· รอบล่าสุดโหลดไม่สำเร็จ แสดงข้อมูลเดิม</span>}
    </p>
  )
}

// แถบเตือนบนสุดของหน้า — กติกาเดียวกับ Telegram (buildAlerts ↔ water-alert-notify)
// ขึ้นเฉพาะเมื่อมีเรื่องเข้าเกณฑ์ ไม่มีข้อความ "ปกติ" ให้วางใจ — ไม่มีแถบแปลว่าไม่มีเรื่องที่เข้าเกณฑ์
// ไม่ได้แปลว่าปลอดภัย · แต่ละส่วนบอกที่มาของตัวเอง และย้ำว่าไม่ใช่ประกาศของ อปท.
const HERO_COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' }

// สรุป 3 ตัวเลขที่คนเปิดหน้านี้อยากรู้ก่อน — เห็นจบโดยไม่ต้องไล่อ่านทั้งลิสต์
// เป็นการหยิบค่าที่แสดงอยู่ข้างล่างขึ้นมาเน้น ไม่ได้ประเมินสถานการณ์เพิ่ม (summaryStats คุมกติกาไว้ที่เดียว)
function HeroStats({ rain, dams, levels, now }) {
  const stats = summaryStats({ rain, dams, levels, now })
  if (!stats.any) return null

  const cards = []
  if (stats.rain) {
    cards.push({
      key: 'rain', Icon: CloudRain, label: 'ฝนสูงสุด 24 ชม.',
      value: formatMm(stats.rain.mm), unit: 'มม.',
      color: stats.rain.level?.bar ?? '#9ca3af',
      badge: stats.rain.level?.label, caption: stats.rain.station.station_name,
    })
  }
  if (stats.dam) {
    cards.push({
      key: 'dam', Icon: Dam, label: 'น้ำในอ่างเก็บน้ำ',
      value: stats.dam.percent.toLocaleString('th-TH', { maximumFractionDigits: 1 }), unit: '%',
      color: safeColor(stats.dam.level?.color),
      badge: stats.dam.level?.label,
      caption: `${stats.dam.count} อ่างรวมกัน`,
      // ปริมาตรเต็มยาวเกินการ์ดบนมือถือ (กว้างการ์ดละ ~118px) โชว์เฉพาะจอที่กว้างพอ
      detail: `${formatMcm(stats.dam.storage)} จาก ${formatMcm(stats.dam.capacity)} ล้าน ลบ.ม.`,
    })
  }
  if (stats.bank) {
    // ค่าลบ = น้ำสูงกว่าตลิ่ง ป้ายต้องบอกทิศทางเอง เพราะตัวเลขใหญ่โชว์ค่าสัมบูรณ์
    const above = stats.bank.diff < 0
    cards.push({
      key: 'bank', Icon: Waves, label: 'ระดับน้ำใกล้ตลิ่งที่สุด',
      value: Math.abs(stats.bank.diff).toFixed(2), unit: 'ม.',
      color: safeColor(stats.bank.station.situation_color),
      badge: Math.abs(stats.bank.diff) < 0.005 ? 'เสมอตลิ่ง' : above ? 'สูงกว่าตลิ่ง' : 'ต่ำกว่าตลิ่ง',
      caption: `สถานี${stats.bank.station.station_name}`,
    })
  }

  return (
    <div className={`grid gap-2 md:gap-3 ${HERO_COLS[cards.length] ?? 'grid-cols-3'}`}>
      {cards.map(c => (
        <div key={c.key} className={`water-summary water-summary--${c.key} relative overflow-hidden rounded-2xl border border-gray-100 bg-white px-3 py-3 shadow-sm md:px-4`}>
          <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: c.color }} aria-hidden="true" />
          <p className="flex items-center gap-1.5 text-[11px] font-semibold leading-tight text-gray-500 md:text-xs">
            <span className="water-summary-icon"><c.Icon size={19} /></span>
            {c.label}
          </p>
          <p className="mt-1.5 flex items-baseline gap-1 leading-none">
            <span className="text-2xl font-extrabold tracking-tight text-gray-900 md:text-3xl">{c.value}</span>
            <span className="text-xs font-bold text-gray-500 md:text-sm">{c.unit}</span>
          </p>
          {c.badge && (
            <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold md:text-[11px]"
              style={{ backgroundColor: `${c.color}1a`, color: '#1e293b' }}>
              <span className="water-status-dot" style={{ backgroundColor: c.color }} />{c.badge}
            </span>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600 md:text-xs">
            {c.caption}{c.detail && <span className="hidden md:inline"> · {c.detail}</span>}
          </p>
        </div>
      ))}
    </div>
  )
}

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
            <a href={THAIWATER_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-gray-800 underline">
              thaiwater.net <ExternalLink size={12} />
            </a>
            {alerts.ews.length > 0 && (
              <a href={EWS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-gray-800 underline">
                ระบบเตือนภัยของกรมทรัพยากรน้ำ <ExternalLink size={12} />
              </a>
            )}
            <Link to="/emergency" className="inline-flex min-h-[44px] items-center text-gray-800 underline">สายด่วนฉุกเฉิน</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function WaterShareCards({ tenant, data, now }) {
  const { stations } = localWaterSituation(data, tenant)
  const rain = stations.filter(s => s.station_type === 'rain')
  const ews = new Map(stations.filter(s => s.station_type === 'ews').map(s => [s.station_code, s]))
  const cards = stations.filter(s => s.station_type === 'dam' || s.station_type === 'waterlevel')
  return <div className="space-y-3">
    {rain.length > 0 && <RainSection stations={rain} ewsByCode={ews} homeAmphoe={tenant.district} now={now} snapshot />}
    {cards.map(s => s.station_type === 'dam'
      ? <DamCard key={`dam-${s.station_code}`} station={s} homeAmphoe={tenant.district} now={now} />
      : <WaterLevelCard key={`level-${s.station_code}`} station={s} homeAmphoe={tenant.district} now={now} />)}
    {!rain.length && !cards.length && <p className="rounded-xl bg-white p-4 text-sm text-slate-600">ไม่มีสถานีที่ยืนยันพื้นที่ตรงกับตำบลของหน่วยงาน ไม่ใช้ข้อมูลข้างเคียงทดแทน</p>}
  </div>
}

function RainSection({ stations, ewsByCode, homeAmphoe, now, snapshot = false }) {
  // สเกลร่วมของทั้งลิสต์ — คิดครั้งเดียวที่นี่ ไม่ให้แต่ละแถวคิดสเกลของตัวเอง (จะเทียบกันไม่ได้)
  const barMax = rainBarMax(stations)
  return (
    <section id={snapshot ? undefined : 'water-rain'} className="water-rain-panel rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="water-section-heading flex items-start gap-2.5 border-b border-gray-50 px-4 py-3">
        <CloudRain size={19} className="mt-0.5 shrink-0 text-sky-600" />
        <div>
          <h2 className="text-sm font-bold text-gray-800">ปริมาณฝนสะสม 24 ชั่วโมง</h2>
          <p className="text-xs text-gray-500">{snapshot ? 'เฉพาะสถานีในตำบล เรียงจากใกล้สำนักงานไปไกล' : 'สถานีวัดฝนใกล้สำนักงาน เรียงจากใกล้ไปไกล'}</p>
        </div>
      </div>
      <ul className="divide-y divide-gray-50">
        {stations.map(s => (
          <RainRow key={s.station_code} station={s} ews={ewsByCode.get(s.station_code)} homeAmphoe={homeAmphoe}
            now={now} barMax={barMax} />
        ))}
      </ul>
      {snapshot ? <p className="px-4 pb-3 text-[10px] text-gray-500">สเกล 0–{barMax} มม. · เส้นแนวตั้ง: ฝนหนักมาก {RAIN_VERY_HEAVY_MM} มม.</p> : <div className="space-y-1 border-t border-gray-50 px-4 py-3 text-[11px] leading-relaxed text-gray-400">
        <p>
          แท่งเทียบใช้สเกลเดียวกันทุกสถานี <span className="whitespace-nowrap">(0–{barMax} มม.)</span> ·{' '}
          <span className="whitespace-nowrap">เส้นแนวตั้งคือเกณฑ์ฝนหนักมาก {RAIN_VERY_HEAVY_MM} มม.</span>
        </p>
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
      </div>}
    </section>
  )
}

function RainRow({ station: s, ews, homeAmphoe, now, barMax }) {
  const level = rainLevel(s.rain_24h_mm)
  const stale = Boolean(s.recorded_at) && isStale(s.recorded_at, now, STATION_STALE_HOURS)
  const rain1h = toNum(s.rain_1h_mm)
  const meta = [stationPlace(s, homeAmphoe), distanceText(s.distance_km)].filter(Boolean).join(' · ')
  const warning = ewsAlert(ews, now)

  return (
    <li className="flex items-start gap-3 px-4 py-3">
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
        {level && <RainBar mm={s.rain_24h_mm} max={barMax} color={level.bar} dim={stale} />}
      </div>
      {/* คอลัมน์ตัวเลขกว้างคงที่ ไม่งั้นแท่งของแต่ละแถวยาวไม่เท่ากันตามจำนวนหลัก แล้วเทียบด้วยตาไม่ได้ */}
      <div className={`w-20 shrink-0 text-right ${stale ? 'opacity-50' : ''}`}>
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

// แท่งเทียบฝนของสถานีเดียว — สเกลร่วมมาจาก RainSection · ขีดแนวตั้งคือเกณฑ์ฝนหนักมากของกรมอุตุฯ
// ค่าเป็น 0 ก็ยังวาดรางเปล่าไว้ ให้ทุกแถวมีเส้นฐานเดียวกันเทียบกันได้
function RainBar({ mm, max, color, dim }) {
  const width = barPercent(mm, max)
  const threshold = barPercent(RAIN_VERY_HEAVY_MM, max)
  return (
    <div className={`relative mt-2 h-2 overflow-hidden rounded-full bg-gray-100 ${dim ? 'opacity-40' : ''}`}
      role="img" aria-label={`${formatMm(mm)} มิลลิเมตร จากสเกล ${max} มิลลิเมตร`}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${width}%`, backgroundColor: color }} />
      <span className="absolute inset-y-0 w-px bg-gray-400" style={{ left: `${threshold}%` }} aria-hidden="true" />
    </div>
  )
}

function WaterLevelSection({ stations, homeAmphoe, now }) {
  return (
    <section id="water-levels" className="water-level-panel space-y-3">
      <div className="water-section-heading flex items-start gap-2.5 px-1">
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
  const fill = channelFill(percent)
  const level = toNum(s.waterlevel_msl)
  const bank = bankText(s.bank_diff_m)
  const mapHref = mapUrl(s.latitude, s.longitude)
  const meta = [stationPlace(s, homeAmphoe), distanceText(s.distance_km)].filter(Boolean).join(' · ')

  return (
    <div className="water-station-card rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: hasValue && !stale ? `${color}66` : '#f3f4f6' }}>
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
        <div className={`mt-3 ${stale ? 'opacity-50' : ''}`}>
          {/* ต้องมี % ความจุลำน้ำถึงจะวาดภาพตัดขวางได้ ไม่มีก็กลับไปใช้กล่องตัวเลขเหมือนเดิม */}
          {fill !== null && (
            <ChannelCrossSection fill={fill} percent={percent} bankLabel={bank} color={color}
              stationName={s.station_name} />
          )}
          <div className={`grid grid-cols-2 gap-2 ${fill !== null ? 'mt-3' : ''}`}>
            {fill === null && <Metric label="เทียบตลิ่ง" value={bank ?? '–'} />}
            {fill === null && <Metric label="ความจุลำน้ำ" value="–" />}
            <Metric label="แนวโน้ม" value={trend ? (
              <span className={`inline-flex items-center gap-1 ${TREND_STYLE[trend.dir].className}`}>
                <TrendIcon size={15} /> {trend.label}
              </span>
            ) : 'รอข้อมูลรอบถัดไป'}
              hint={trend && s.prev_recorded_at ? `เทียบกับ ${measuredAtText(s.prev_recorded_at, now)}` : null} />
            <Metric label="ระดับน้ำ" value={level !== null ? `${level.toFixed(2)} ม.รทก.` : '–'} />
          </div>
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
            className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-cyan-700">
            <MapPin size={13} /> ตำแหน่งสถานี
          </a>
        )}
      </div>
    </div>
  )
}

// พิกัดในภาพตัดขวาง (viewBox 320×84) — ตลิ่งอยู่ y=16 ท้องน้ำ y=66 ตลิ่งลาดเอียง 1.12 หน่วยนอนต่อ 1 หน่วยตั้ง
const CH = { bankY: 16, bedY: 66, leftTop: 36, rightTop: 284, slope: 1.12 }

// ภาพตัดขวางลำน้ำ — ความสูงของน้ำมาจาก "ความจุลำน้ำ (%)" ที่ต้นทางส่งมาเท่านั้น
// ⚠️ รูปทรงลำน้ำเป็นภาพประกอบให้เทียบสัดส่วนน้ำกับตลิ่งด้วยตา ไม่ใช่หน้าตัดจริงของสถานี
//    (ต้นทางไม่ได้ให้รูปตัด) ตัวเลขจริงจึงต้องกำกับอยู่บนภาพทุกจุด ห้ามให้เหลือแต่รูป
function ChannelCrossSection({ fill, percent, bankLabel, color, stationName }) {
  const gradientId = useId()
  const overCapacity = percent > 100
  // ส่วนเกินวาดเป็นสัญลักษณ์เหนือตลิ่ง ไม่คำนวณความสูงจริงจากเปอร์เซ็นต์ความจุลำน้ำ
  const surfaceY = overCapacity ? 8 : CH.bedY - fill * (CH.bedY - CH.bankY)
  const inset = Math.max(0, surfaceY - CH.bankY) * CH.slope
  const left = CH.leftTop + inset
  const right = CH.rightTop - inset
  const percentText = percent === null ? null : `${Math.round(percent)}%`

  return (
    <div className="overflow-hidden rounded-xl bg-gray-50">
      <div className="relative">
        <svg viewBox="0 0 320 84" className="block w-full" role="img"
          aria-label={`ภาพตัดขวางลำน้ำที่สถานี${stationName} น้ำอยู่ที่ ${percentText ?? '–'} ของความจุลำน้ำ${bankLabel ? ` ${bankLabel}` : ''}`}>
          <defs>
            {/* เนื้อน้ำเป็นสีน้ำเงินคงที่ให้ดูออกว่าเป็นน้ำ — สีสถานการณ์จากต้นทาง (เขียว/เหลือง/แดง)
                ไปอยู่ที่เส้นผิวน้ำกับกรอบการ์ดแทน ถ้าย้อมทั้งก้อนตามสถานะ ภาพจะอ่านเป็นตะไคร่/ดินแทนน้ำ */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#0369a1" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          {/* ตลิ่งสองฝั่ง */}
          <path d={`M0 ${CH.bankY} L${CH.leftTop} ${CH.bankY} L92 ${CH.bedY} L228 ${CH.bedY} L${CH.rightTop} ${CH.bankY} L320 ${CH.bankY} L320 84 L0 84 Z`}
            fill="#e7e5e4" />
          <path d={`M${CH.leftTop} ${CH.bankY} L92 ${CH.bedY} L228 ${CH.bedY} L${CH.rightTop} ${CH.bankY}`}
            fill="none" stroke="#a8a29e" strokeWidth="1.5" strokeLinejoin="round" />
          {/* ผิวน้ำ */}
          {overCapacity && <rect x="8" y={surfaceY} width="304" height={CH.bankY - surfaceY} fill={`url(#${gradientId})`} />}
          <path d={`M${left} ${surfaceY} L92 ${CH.bedY} L228 ${CH.bedY} L${right} ${surfaceY} Z`} fill={`url(#${gradientId})`} />
          <line x1={left} y1={surfaceY} x2={right} y2={surfaceY} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          {/* เส้นระดับตลิ่ง */}
          <line x1="8" y1={CH.bankY} x2="312" y2={CH.bankY} stroke="#78716c" strokeWidth="1" strokeDasharray="5 4" />
        </svg>
        <span className="absolute left-2 top-1 text-[10px] font-semibold text-gray-500">ระดับตลิ่ง</span>
        {bankLabel && (
          <span className="absolute right-2 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">
            {bankLabel}
          </span>
        )}
        {percentText && (
          <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">
            ความจุลำน้ำ {percentText}
          </span>
        )}
      </div>
      <p className="px-2 pb-1.5 text-[10px] text-gray-500">
        {overCapacity && <span className="font-bold text-rose-700">เกินความจุลำน้ำ · </span>}
        ภาพประกอบสัดส่วน ไม่ใช่หน้าตัดจริง
      </p>
    </div>
  )
}

function DamSection({ stations, homeAmphoe, now }) {
  return (
    <section id="water-dams" className="water-dam-panel space-y-3">
      <div className="water-section-heading flex items-start gap-2.5 px-1">
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
    <div className="water-station-card rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: hasValue && !stale ? `${color}66` : '#f3f4f6' }}>
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
          <div className="water-dam-volume">
            {percent !== null && <ReservoirGauge percent={percent} color={color} />}
            <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-500 mb-1">ปริมาตรน้ำในอ่าง</p>
            <p className="text-xs text-gray-600">
              <span className="text-lg font-bold text-gray-900">{formatMcm(storage)}</span>
              {capacity !== null && <> จาก {formatMcm(capacity)}</>} ล้าน ลบ.ม.
            </p>
            <p className="mt-1 text-[11px] text-gray-500">เทียบความจุที่ระดับเก็บกัก</p>
            </div>
          </div>
          {percent !== null && (
            <div className="mt-1.5">
              <div className="relative h-3 overflow-hidden rounded-full bg-gray-100"
                role="img" aria-label={`ปริมาณน้ำในอ่าง ${percent.toFixed(1)}% ของความจุที่ระดับเก็บกัก`}>
                <div className="h-full rounded-full" style={{ width: `${barWidth}%`, backgroundColor: color }} />
                {/* หมุดเกณฑ์ — อยู่บนแถบสีต้องเป็นเส้นขาว อยู่บนรางว่างต้องเป็นเส้นเทา ไม่งั้นมองไม่เห็นข้างใดข้างหนึ่ง */}
                {damTicks().map(tick => (
                  <span key={tick} className="absolute inset-y-0 w-px" aria-hidden="true"
                    style={{ left: `${tick}%`, backgroundColor: tick <= barWidth ? 'rgba(255,255,255,0.8)' : 'rgba(120,113,108,0.35)' }} />
                ))}
              </div>
              <div className="relative mt-1 h-3.5 text-[10px] font-semibold text-gray-400" aria-hidden="true">
                {damTicks().map(tick => (
                  <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${tick}%` }}>{tick}</span>
                ))}
                <span className="absolute right-0">100%</span>
              </div>
            </div>
          )}
          <div className="mt-2 space-y-2">
            <FlowBars inflow={inflow} released={released} />
            <div>
              <Metric label={s.prev_recorded_at ? `ปริมาตรเทียบกับข้อมูลวันที่ ${dataDayText(s.prev_recorded_at, now)}` : 'ปริมาตรเทียบกับข้อมูลก่อนหน้า'} value={trend ? (
                <span className={`inline-flex items-center gap-1 ${TREND_STYLE[trend.dir].className}`}>
                  <TrendIcon size={15} /> {trend.label}
                </span>
              ) : 'ยังไม่มีข้อมูลก่อนหน้าให้เปรียบเทียบ'} />
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
            className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-blue-700">
            <MapPin size={13} /> ตำแหน่งอ่าง
          </a>
        )}
      </div>
    </div>
  )
}

// เทียบน้ำไหลลงอ่างกับน้ำที่ระบายออกในวันเดียวกัน — แท่งยาวกว่าคือฝั่งที่มากกว่า อ่านทิศทางได้โดยไม่ต้องลบเลขเอง
// สเกลเป็นของการ์ดนี้เอง (อ่างคนละขนาดเทียบข้ามการ์ดไม่ได้) ตัวเลขจริงจึงอยู่ท้ายแท่งเสมอ
function FlowBars({ inflow, released }) {
  const flow = flowCompare(inflow, released)
  if (!flow) return null
  const rows = [
    { key: 'in', label: 'ไหลลงอ่าง', value: flow.inflow, percent: flow.inflowPct, color: '#0284c7' },
    { key: 'out', label: 'ระบายออก', value: flow.released, percent: flow.releasedPct, color: '#d97706' },
  ]
  return (
    <div className="water-metric rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-semibold text-gray-500">น้ำเข้า-ออกต่อวัน (ล้าน ลบ.ม.)</p>
      <div className="mt-1.5 space-y-1.5">
        {rows.map(r => (
          <div key={r.key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11px] text-gray-500">{r.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
              <span className="block h-full rounded-full" style={{ width: `${r.percent}%`, backgroundColor: r.color }} />
            </span>
            <span className="w-11 shrink-0 text-right text-[11px] font-bold text-gray-800">
              {r.value === null ? '–' : formatMcm(r.value)}
            </span>
          </div>
        ))}
      </div>
      {flow.netLabel && <p className="mt-1.5 text-[11px] text-gray-500">{flow.netLabel}</p>}
    </div>
  )
}

function Metric({ label, value, hint }) {
  return (
    <div className="water-metric rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-semibold text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-800">{value}</p>
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

function SourceNote({ tenantName }) {
  return (
    <div className="water-source space-y-2 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-xs leading-relaxed text-gray-600">
      <p>
        <span className="font-semibold text-gray-700">ที่มา:</span> คลังข้อมูลน้ำแห่งชาติ (ThaiWater)
        สถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน) และหน่วยงานเจ้าของสถานี
      </p>
      <p>
        เป็นค่าตรวจวัดจากสถานี <span className="font-semibold text-gray-700">ไม่ใช่ประกาศเตือนภัยของ{tenantName || 'หน่วยงาน'}</span>
        {' '}หากเกิดเหตุฉุกเฉินดูเบอร์ติดต่อได้ที่{' '}
        <Link to="/emergency" className="inline-flex min-h-[44px] items-center font-semibold text-sky-700 underline">สายด่วนฉุกเฉิน</Link>
      </p>
      <a href={THAIWATER_URL} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-sky-700">
        ดูข้อมูลทั้งหมดที่ thaiwater.net <ExternalLink size={12} />
      </a>
    </div>
  )
}

// ภาพหัวหน้าเป็นภาพตกแต่ง ไม่ใช้แทนสภาพอากาศหรือภูมิประเทศจริง
function WaterLandscape() {
  return (
    <svg className="water-landscape" viewBox="0 0 480 240" fill="none" aria-hidden="true">
      <circle cx="335" cy="65" r="37" fill="#a5f3fc" opacity=".6" />
      <circle cx="335" cy="65" r="50" stroke="#a5f3fc" opacity=".15" />
      <path d="M0 190L90 72L170 147L258 37L430 192Z" fill="#277994" />
      <path d="M126 200L258 37L283 125L345 167L405 115L480 193V240H126Z" fill="#369eaa" />
      <path d="M218 88L258 37L283 125L256 104L248 78Z" fill="#c1eeee" opacity=".7" />
      <path d="M0 172Q89 139 177 193T350 181T480 169V240H0Z" fill="#14677f" />
      <path d="M0 201Q88 174 164 208T328 199T480 207V240H0Z" fill="#064d69" />
      <path d="M299 171C193 183 383 197 259 215S181 234 208 240H360C284 225 388 214 327 196S268 181 322 171Z" fill="#67e8f9" opacity=".8" />
      <path d="M320 185C289 185 351 197 309 205" stroke="#e0faff" strokeWidth="2" strokeLinecap="round" />
      <path d="M74 61H131C148 61 147 42 135 40C134 23 110 21 104 36C88 28 73 40 78 49C62 48 62 61 74 61Z" fill="#d7f5ff" opacity=".9" />
      <path d="M85 76L80 88M107 76L102 88M129 76L124 88" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" />
      <path d="M377 121V97L392 111V142M407 142V116L422 130V165" stroke="#7edac6" strokeWidth="5" strokeLinecap="round" />
      <path d="M62 195V159M48 177L62 153L76 177Z" fill="#62c6b1" stroke="#62c6b1" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}

function ReservoirGauge({ percent, color }) {
  const id = useId()
  const fill = barPercent(percent, 100)
  return (
    <div className="water-gauge" role="img" aria-label={`น้ำในอ่าง ${formatMm(percent)}% ของความจุที่ระดับเก็บกัก`}>
      <svg viewBox="0 0 112 112" aria-hidden="true">
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#e0f2fe" /><stop offset="1" stopColor="#bae6fd" /></linearGradient></defs>
        <circle cx="56" cy="56" r="42" fill={`url(#${id})`} />
        <circle cx="56" cy="56" r="49" fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="56" cy="56" r="49" fill="none" stroke={color} strokeWidth="6" pathLength="100"
          strokeDasharray={`${fill} 100`} transform="rotate(-90 56 56)" />
        <path d="M25 76Q40 69 56 76T87 76" stroke="#38bdf8" strokeWidth="2" fill="none" />
      </svg>
      <strong>{formatMm(percent)}<small>%</small></strong>
    </div>
  )
}
