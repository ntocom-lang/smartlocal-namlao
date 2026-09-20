import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Wind, MapPin, RadioTower, Clock3, ExternalLink, RefreshCw, Info, ChartNoAxesCombined, Building2, Trees, CloudSun } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { useVisibleRefresh } from '../hooks/useVisibleRefresh'
import { AIR4THAI_URL, PM25_LEVELS, formatMeasuredAt, isFresh, nearbyStations, pm25Level } from '../lib/pm25'
import './Pm25Page.css'
import Pm25Details from './Pm25Details'

const Pm25Map = lazy(() => import('./Pm25Map'))

const NEUTRAL = { color: '#687986', fill: '#edf1f4' }
const number = value => value === null || value === undefined ? '—' : value.toLocaleString('th-TH', { maximumFractionDigits: 1 })
const distance = value => value === null ? 'ไม่มีพิกัดสำหรับคำนวณระยะห่าง' : `ห่างจาก อปท. ${number(value)} กม. (แนวเส้นตรง)`

export default function Pm25Page() {
  const { tenant, loading: tenantLoading } = useTenant()
  const [feed, setFeed] = useState(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(true)
  const [now, setNow] = useState(Date.now)
  const [selection, setSelection] = useState({ tenantId: null, stationId: '' })
  const active = useRef(null)
  const mounted = useRef(false)
  const refresh = useCallback(async () => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    setBusy(true)
    try {
      const response = await fetch('/api/air-quality', { signal: controller.signal })
      if (!response.ok) throw new Error('Unavailable')
      const data = await response.json()
      if (data?.source !== 'Air4Thai' || !Array.isArray(data.stations)) throw new Error('Invalid feed')
      if (mounted.current) { setFeed(data); setFailed(Boolean(data.refreshFailed)) }
    } catch {
      if (mounted.current && active.current === controller) setFailed(true)
    } finally {
      clearTimeout(timeout)
      if (active.current === controller) {
        active.current = null
        if (mounted.current) { setBusy(false); setNow(Date.now()) }
      }
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    const initialRefresh = setTimeout(() => { void refresh() }, 0)
    const ageTimer = setInterval(() => setNow(Date.now()), 60000)
    return () => { mounted.current = false; clearTimeout(initialRefresh); clearInterval(ageTimer); active.current?.abort(); active.current = null }
  }, [refresh])
  useVisibleRefresh(refresh, { intervalMs: 10 * 60 * 1000 })

  const area = nearbyStations(feed?.stations || [], tenant)
  const chosenId = selection.tenantId === tenant?.id ? selection.stationId : ''
  const station = area.stations.find(s => s.id === chosenId)
    || area.stations.find(s => s.pm25 !== null && isFresh(s, now)) || area.stations[0]
  const fresh = isFresh(station, now)
  const level = fresh ? pm25Level(station?.pm25) : null
  const tone = level || NEUTRAL
  const barMax = Math.max(37.5, ...area.stations.map(s => s.pm25 ?? 0))

  return <div className="pm25-page">
    <header className="pm25-cover">
      <div className="pm25-cover-copy">
        <Link to="/more" className="pm25-back"><ArrowLeft size={18} />เมนูบริการ</Link>
        <p className="pm25-eyebrow"><Wind size={17} /> สิ่งแวดล้อมใกล้คุณ</p>
        <h1>สถานการณ์ PM2.5</h1>
        <p>ติดตามค่าฝุ่นและคุณภาพอากาศ<br />จากสถานีตรวจวัดใกล้พื้นที่</p>
        <span className="pm25-area"><MapPin size={15} />{tenant?.name || 'กำลังระบุพื้นที่'}</span>
      </div>
      <div className="pm25-landscape" aria-hidden="true"><CloudSun className="pm25-sun" /><Wind className="pm25-breeze" /><div className="pm25-city"><Trees /><Building2 /><Building2 /><Trees /></div></div>
    </header>
    <main className="pm25-content">
      <div className="pm25-sync"><p><RadioTower size={16} />Air4Thai · กรมควบคุมมลพิษ</p><button type="button" onClick={refresh} disabled={busy}><RefreshCw size={16} className={busy ? 'pm25-spin' : ''} />{busy ? 'กำลังโหลด' : 'ตรวจข้อมูลล่าสุด'}</button></div>
      {failed && <div role="status" className="pm25-notice">{feed ? 'รอบล่าสุดดึงข้อมูลไม่สำเร็จ กำลังแสดงข้อมูลที่รับได้ก่อนหน้า กรุณาตรวจสอบเวลาตรวจวัด' : 'โหลดข้อมูลฝุ่นไม่สำเร็จ กรุณาลองอีกครั้ง หรือเปิด Air4Thai ด้านล่าง'}</div>}
      {tenantLoading || (!feed && busy) ? <section className="pm25-panel pm25-loading" role="status"><Wind size={36} /><p>กำลังโหลดข้อมูลจากสถานีตรวจวัด…</p></section> : !station ? <section className="pm25-panel pm25-empty"><RadioTower size={36} /><h2>{feed ? 'ยังไม่มีสถานีอ้างอิงในพื้นที่ที่ระบุ' : 'ยังแสดงค่าฝุ่นไม่ได้'}</h2><p>ระบบค้นสถานีในจังหวัดก่อน แล้วจึงค้นสถานีในระยะ 150 กม. จากพิกัดหน่วยงาน</p><p>ข้อมูลที่ขาดจะไม่ถูกแทนด้วยศูนย์</p><SourceLink /></section> : <>
        {!area.inProvince && <div className="pm25-notice">ไม่พบสถานีในจังหวัดที่ตั้งค่าไว้ แสดงสถานีใกล้พิกัดหน่วยงานในระยะ 150 กม.</div>}
        {!fresh && <div className="pm25-notice" role="status">ข้อมูลสถานีนี้ไม่เป็นปัจจุบัน หรือไม่ทราบเวลาตรวจวัด · {formatMeasuredAt(station.measuredAt)} กรุณาตรวจข้อมูลล่าสุดที่ Air4Thai</div>}
        <div className="pm25-primary-grid">
          <section className="pm25-panel pm25-hero" style={{ '--pm-color': tone.color, '--pm-fill': tone.fill }}>
            <div className="pm25-section-heading"><Wind size={20} /><h2>ฝุ่นจากสถานีอ้างอิง</h2></div>
            <div className="pm25-gauge"><span>PM2.5 · เฉลี่ย 24 ชั่วโมง</span><strong data-testid="pm25-value">{number(station.pm25)}</strong><span>ไมโครกรัม/ลบ.ม. (µg/m³)</span><b className="pm25-level">{!fresh ? 'ข้อมูลไม่เป็นปัจจุบัน' : level?.label || 'ไม่มีค่าฝุ่น'}</b></div>
            <h3>{station.name}</h3><p className="pm25-muted">{station.area}</p><p className="pm25-distance"><MapPin size={15} />{distance(station.distance)}</p>
            <div className="pm25-scale" aria-label="ระดับฝุ่น PM2.5 เฉลี่ย 24 ชั่วโมง">{PM25_LEVELS.map(l => <div key={l.label}><i style={{ backgroundColor: l.color }} /><span>{l.label}</span><small>{l.range}</small></div>)}</div>
            <p className="pm25-muted pm25-caption">หน่วย µg/m³ · ค่าที่สถานีอาจต่างจากบริเวณบ้านของคุณ</p>
          </section>
          <section className="pm25-panel pm25-source">
            <div className="pm25-section-heading"><RadioTower size={20} /><h2>รู้ที่มาของตัวเลข</h2></div>
            <label className="pm25-label" htmlFor="pm25-station">เลือกสถานีอ้างอิง{area.inProvince && tenant?.province ? ` · ${tenant.province}` : ''}</label>
            <select id="pm25-station" value={station.id} onChange={e => setSelection({ tenantId: tenant?.id, stationId: e.target.value })}>{area.stations.map(s => <option key={s.id} value={s.id}>{s.name}{s.distance === null ? '' : ` (${number(s.distance)} กม.)`}</option>)}</select>
            <div className="pm25-fact"><Clock3 /><div><b>เวลาตรวจวัด</b><p>{formatMeasuredAt(station.measuredAt)}</p><small>ข้อมูลสถานีเฉลี่ยย้อนหลัง 24 ชั่วโมง</small></div></div>
            <div className="pm25-fact"><RefreshCw /><div><b>ระบบรับข้อมูล</b><p>{formatMeasuredAt(feed.fetchedAt)}</p><small>ตรวจใหม่ทุก 10 นาทีขณะเปิดหน้า</small></div></div>
            <div className="pm25-fact"><Info /><div><b>ดัชนีคุณภาพอากาศ (AQI)</b><p><strong className="pm25-aqi">{number(station.aqi)}</strong>{!fresh && ' · ข้อมูลเก่า'}</p><small>AQI เป็นดัชนี ไม่มีหน่วย µg/m³{station.aqiPollutant && ` · มลพิษหลัก ${station.aqiPollutant === 'PM25' ? 'PM2.5' : station.aqiPollutant}`}</small></div></div>
            <div className="pm25-actions"><SourceLink />{station.lat !== null && station.lon !== null && <a href={`https://www.openstreetmap.org/?mlat=${station.lat}&mlon=${station.lon}#map=13/${station.lat}/${station.lon}`} target="_blank" rel="noopener noreferrer"><MapPin size={16} />ตำแหน่งสถานี</a>}</div>
          </section>
        </div>
        <Pm25Details station={station} now={now} />
        <Suspense fallback={<section className="pm25-panel" role="status">กำลังเตรียมแผนที่สถานี…</section>}>
          <Pm25Map stations={feed.stations} tenant={tenant} now={now} />
        </Suspense>
        <section className="pm25-panel">
          <div className="pm25-section-heading"><ChartNoAxesCombined size={20} /><h2>เทียบสถานี{area.inProvince ? 'ในจังหวัด' : 'ใกล้พื้นที่'}</h2><span className="pm25-count">{area.stations.length} สถานี</span></div>
          <p className="pm25-muted">ค่าเฉลี่ย 24 ชั่วโมง · µg/m³ · เวลาตรวจวัดอาจต่างกัน</p>
          <div className="pm25-stations">{area.stations.map(s => {
            const current = isFresh(s, now)
            const color = current ? pm25Level(s.pm25)?.color || NEUTRAL.color : NEUTRAL.color
            return <button key={s.id} className="pm25-station-row" aria-pressed={s.id === station.id} onClick={() => setSelection({ tenantId: tenant?.id, stationId: s.id })}>
              <div className="pm25-station-top"><div><b>{s.name}</b><small>{distance(s.distance)}</small></div><strong style={{ color }}>{number(s.pm25)}<small>µg/m³</small></strong></div>
              <div className="pm25-bar-track" aria-hidden="true"><span style={{ width: `${(s.pm25 ?? 0) / barMax * 100}%`, backgroundColor: color }} /></div>
              <div className="pm25-station-bottom"><span>{!current ? 'ข้อมูลเก่า / ไม่ทราบเวลา' : pm25Level(s.pm25)?.label || 'ไม่มีค่าฝุ่น'}</span><span>{formatMeasuredAt(s.measuredAt)}</span></div>
            </button>
          })}</div>
        </section>
      </>}
      <Pm25Details mode="area" tenant={tenant} now={now} />
      <div>
        <section className="pm25-panel"><div className="pm25-section-heading"><Info size={20} /><h2>อ่านค่าฝุ่นให้เข้าใจ</h2></div><details><summary>PM2.5 กับ AQI ต่างกันอย่างไร</summary><p>PM2.5 คือความเข้มข้นของฝุ่น หน่วย µg/m³ ส่วน AQI เป็นดัชนีที่ประเมินจากสารมลพิษหลายชนิด จึงเป็นคนละตัวเลขและใช้แทนกันไม่ได้</p></details><details><summary>ทำไมค่าฝุ่นจึงไม่ตรงกับบางแอป</summary><p>หน้านี้ใช้ค่าเฉลี่ย 24 ชั่วโมงจากสถานี Air4Thai ค่ารายชั่วโมง ค่าจากแบบจำลอง และค่าจากสถานีคนละแห่งอาจแตกต่างกัน ควรเทียบช่วงเฉลี่ยและเวลาก่อนเสมอ</p></details><details><summary>เมื่อข้อมูลเก่าหรือไม่มีสถานี</summary><p>เมื่อค่ามีอายุ 3 ชั่วโมงขึ้นไปหรือเวลาไม่ถูกต้อง ระบบจะแสดงสีเทาและแจ้งข้อมูลเก่า หากจังหวัดไม่มีสถานีจะค้นจากพิกัด อปท. ในระยะ 150 กม. เจ้าหน้าที่แก้จังหวัดและพิกัดได้ในข้อมูลหน่วยงาน</p></details></section>
      </div>
      <footer className="pm25-footer"><p>ข้อมูลตรวจวัด: กรมควบคุมมลพิษ (Air4Thai) · ระบบเลือกสถานีอ้างอิงให้อัตโนมัติ</p><p>ระดับสีใช้เกณฑ์ PM2.5 เฉลี่ย 24 ชั่วโมงของกรมควบคุมมลพิษ ไม่ใช่ประกาศเตือนภัยของ อปท.</p><a href={AIR4THAI_URL} target="_blank" rel="noopener noreferrer">ตรวจสอบข้อมูลและคำแนะนำสุขภาพจากต้นทาง<ExternalLink size={14} /></a></footer>
    </main>
  </div>
}

function SourceLink() {
  return <a className="pm25-source-link" href={AIR4THAI_URL} target="_blank" rel="noopener noreferrer">เปิด Air4Thai<ExternalLink size={16} /></a>
}
