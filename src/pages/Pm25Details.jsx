import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined, MapPinned, RefreshCw, Wind, MapPin, Clock3, Satellite } from 'lucide-react'
import { PM25_LEVELS, formatMeasuredAt, isFresh, pm25Level } from '../lib/pm25'
import { historySummary, validCoordinates } from '../lib/pm25Details'

const valueText = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 1 })
const shortDate = t => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }).format(t)
const hourText = t => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t)

function useDetails(query, now) {
  const [result, setResult] = useState({ key: '', data: null, error: false })
  const [retry, setRetry] = useState(0)
  // Parent clock runs every minute; refresh at most once per ten-minute bucket.
  const bucket = Math.floor(now / 600000)
  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    let alive = true
    const timer = setTimeout(() => controller.abort(), 20000)
    fetch(`/api/pm25-details?${query}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Unavailable'); return response.json() })
      .then(data => { if (alive) setResult({ key: query, data, error: Boolean(data.refreshFailed) }) })
      .catch(() => { if (alive) setResult(previous => ({ key: query, data: previous.key === query ? previous.data : null, error: true })) })
      .finally(() => clearTimeout(timer))
    return () => { alive = false; controller.abort(); clearTimeout(timer) }
  }, [query, bucket, retry])
  return { data: result.key === query ? result.data : null, error: result.key === query && result.error, retry: () => setRetry(n => n + 1) }
}

function Failure({ retry, children }) {
  return <div className="pm25-details-error" role="status"><p>{children}</p><button onClick={retry}><RefreshCw size={16} />ลองใหม่</button></div>
}

function History({ station, now }) {
  const [period, setPeriod] = useState('hourly')
  const request = useDetails(station ? `kind=history&station=${encodeURIComponent(station.id)}` : '', now)
  const summary = historySummary(request.data?.points || [], now)
  const rows = summary[period]
  const comparison = summary.comparison
  const Change = comparison?.difference > 0 ? ArrowUpRight : ArrowDownRight
  return <section className="pm25-panel pm25-history" id="pm25-history">
    <div className="pm25-section-heading"><ChartNoAxesCombined size={20} /><h2>ฝุ่นเปลี่ยนไปอย่างไร</h2></div>
    <p className="pm25-muted">สถานี{station?.name || 'ที่เลือก'} · ข้อมูลตรวจวัด Air4Thai</p>
    {!station ? <p className="pm25-muted">ยังไม่มีสถานีสำหรับแสดงประวัติ</p> : !request.data ? request.error ? <Failure retry={request.retry}>โหลดข้อมูลย้อนหลังไม่ได้ ค่าล่าสุดส่วนบนยังดูได้ตามปกติ</Failure> : <p role="status" className="pm25-details-loading">กำลังโหลดประวัติสถานี…</p> : <>
      {request.error && <p className="pm25-notice">รอบล่าสุดโหลดไม่สำเร็จ แสดงประวัติที่รับได้ก่อนหน้า</p>}
      {summary.stale && <p className="pm25-notice">ประวัติไม่เป็นปัจจุบัน · ล่าสุด {formatMeasuredAt(summary.latest === null ? null : new Date(summary.latest).toISOString())}</p>}
      <div className="pm25-day-comparison" data-testid="pm25-comparison">
        <div><span>วันนี้เทียบเมื่อวาน</span><strong>{comparison ? <><Change size={27} />{Math.abs(comparison.difference) < 0.05 ? 'ใกล้เคียงเดิม' : `${comparison.difference > 0 ? 'เพิ่ม' : 'ลด'} ${valueText(Math.abs(comparison.difference))}`}<small> µg/m³</small></> : 'ข้อมูลยังไม่ครบ'}</strong><small>{comparison ? `เทียบค่าเฉลี่ยช่วง 00:00–${hourText(comparison.through)} น. ของทั้งสองวัน` : 'คำนวณเมื่อมีข้อมูลทุกชั่วโมงในช่วงเดียวกันของทั้งสองวัน'}</small></div>
        {comparison && <div className="pm25-day-pair"><p>วันนี้ <b>{valueText(comparison.today)}</b></p><p>เมื่อวาน <b>{valueText(comparison.yesterday)}</b></p></div>}
      </div>
      <div className="pm25-history-controls" aria-label="ช่วงเวลาของกราฟ"><button aria-pressed={period === 'hourly'} onClick={() => setPeriod('hourly')}>24 ชั่วโมง</button><button aria-pressed={period === 'daily'} onClick={() => setPeriod('daily')}>7 วัน</button></div>
      <p className="pm25-muted">{period === 'hourly' ? 'ค่าฝุ่นรายชั่วโมง (ช่วงเฉลี่ย 1 ชั่วโมง)' : 'ค่าเฉลี่ยรายวันคำนวณจากข้อมูลรายชั่วโมง · วันนี้ยังไม่ครบวัน'} · µg/m³</p>
      <div className="pm25-history-chart" aria-label={`กราฟค่าฝุ่น ${period === 'hourly' ? '24 ชั่วโมง' : '7 วัน'}`}>
        <ResponsiveContainer width="100%" height={245} minWidth={0}><AreaChart data={rows} margin={{ top: 20, right: 12, left: 0, bottom: 5 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="#e1ebee" />
          <XAxis dataKey="time" tickFormatter={period === 'hourly' ? hourText : shortDate} minTickGap={35} tick={{ fontSize: 12, fill: '#546b78' }} axisLine={false} tickLine={false} />
          <YAxis width={40} tick={{ fontSize: 12, fill: '#546b78' }} domain={[0, 'auto']} axisLine={false} tickLine={false} />
          <Tooltip labelFormatter={t => `${shortDate(t)} ${period === 'hourly' ? hourText(t) + ' น.' : ''}`} formatter={v => [`${valueText(v)} µg/m³`, period === 'hourly' ? 'เฉลี่ย 1 ชั่วโมง' : 'เฉลี่ยตามช่วงที่ระบุ']} contentStyle={{ borderRadius: 12, fontSize: 13 }} />
          <Area type="linear" dataKey="value" stroke="#187f98" fill="#e0f1f5" strokeWidth={2.5} connectNulls={false} isAnimationActive={false} />
        </AreaChart></ResponsiveContainer>
      </div>
      <p className="pm25-muted">ช่องว่างคือข้อมูลขาด · ค่ารายชั่วโมงไม่ใช้แทนค่าเฉลี่ย 24 ชั่วโมงในวงกลมด้านบน</p>
      <details className="pm25-history-table"><summary>ดูตัวเลข{period === 'hourly' ? 'รายชั่วโมง' : 'รายวัน'}</summary><div className="pm25-table-scroll"><table><thead><tr><th scope="col">วัน / เวลา</th><th scope="col">PM2.5 (µg/m³)</th><th scope="col">ความครบถ้วน</th></tr></thead><tbody>{[...rows].reverse().map(row => <tr key={row.time}><td>{shortDate(row.time)}{period === 'hourly' && ` ${hourText(row.time)}`}</td><td>{valueText(row.value)}</td><td>{period === 'hourly' ? row.value === null ? 'ไม่มีข้อมูล' : 'มีข้อมูล' : `${row.count}/${row.expected} ชั่วโมง${row.partial ? ' · ยังไม่ครบวัน' : ''}`}</td></tr>)}</tbody></table></div></details>
    </>}
    <a className="pm25-text-link" href="https://air4thai.pcd.go.th/webV3/#/History" target="_blank" rel="noopener noreferrer">ตรวจประวัติที่ Air4Thai ↗</a>
  </section>
}

function Subdistricts({ tenant, now }) {
  const hasLocation = validCoordinates(tenant?.latitude, tenant?.longitude)
  const query = hasLocation ? `kind=area&lat=${Number(tenant.latitude).toFixed(4)}&lon=${Number(tenant.longitude).toFixed(4)}` : ''
  const request = useDetails(query, now)
  const [expanded, setExpanded] = useState(false)
  const area = request.data?.area
  const tambons = request.data?.tambons || []
  const own = tambons.find(t => t.id === area?.subdistrictId)
  const fresh = isFresh(own, now)
  const localLevel = fresh ? pm25Level(own?.average24) : null
  const tone = localLevel || { color: '#687986', fill: '#edf1f4' }
  const rows = [...tambons].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name, 'th'))
  return <section className="pm25-panel pm25-subdistricts" id="pm25-subdistricts" style={{ '--local-color': tone.color, '--local-fill': tone.fill }}>
    <p className="pm25-local-eyebrow"><span>01</span> พื้นที่ของคุณมาก่อน</p>
    <div className="pm25-section-heading"><MapPinned size={20} /><h2>ฝุ่นระดับตำบล</h2><span className="pm25-estimate-tag">ค่าประมาณการ</span></div>
    <p className="pm25-muted">GISTDA · วิเคราะห์ดาวเทียมร่วมกับสถานีภาคพื้นดิน</p>
    {!hasLocation ? <p className="pm25-notice">ยังไม่มีพิกัดหน่วยงานที่ใช้ค้นตำบลได้ เจ้าหน้าที่สามารถตรวจพิกัดในข้อมูลหน่วยงาน</p> : !request.data ? request.error ? <Failure retry={request.retry}>โหลดข้อมูลตำบลไม่ได้ กรุณาลองใหม่หรือดูที่ GISTDA</Failure> : <p role="status" className="pm25-details-loading">กำลังค้นข้อมูลตำบลจากพิกัด อปท.…</p> : <>
      {request.error && <p className="pm25-notice">รอบล่าสุดโหลดไม่สำเร็จ ข้อมูลด้านล่างเป็นชุดก่อนหน้า</p>}
      <div className="pm25-local-hero">
        <div className="pm25-local-place"><span className="pm25-local-location"><MapPin size={16} />ตำบลตามพิกัด อปท.</span><h3>{area.subdistrict}</h3><p>อ.{area.district} จ.{area.province}</p><span className="pm25-local-status">{fresh ? localLevel?.label || 'ยังไม่มีค่าเฉลี่ย' : 'ข้อมูลไม่เป็นปัจจุบัน'}</span><p className="pm25-local-time"><Clock3 size={15} />{formatMeasuredAt(own?.measuredAt)}</p></div>
        <div className="pm25-local-orbit"><div className="pm25-local-reading"><Wind size={26} /><span>PM2.5</span><strong>{valueText(own?.average24)}</strong><span>µg/m³ · เฉลี่ย 24 ชั่วโมง</span><small>ค่าประมาณระดับตำบล</small></div></div>
        <div className="pm25-local-metrics"><div><Clock3 size={19} /><span>ค่ารายชั่วโมง</span><strong>{valueText(own?.hourly)} <small>µg/m³</small></strong></div><div><Satellite size={19} /><span>แหล่งข้อมูล</span><strong>GISTDA</strong><small>แบบจำลองระดับพื้นที่</small></div><div><MapPinned size={19} /><span>ครอบคลุมในอำเภอ</span><strong>{tambons.length} <small>ตำบล</small></strong></div></div>
      </div>
      <div className="pm25-local-scale" aria-label="ระดับ PM2.5 เฉลี่ย 24 ชั่วโมง">{PM25_LEVELS.map(l => <div key={l.label} className={localLevel === l ? 'is-current' : ''}><i style={{ backgroundColor: l.color }} /><b>{l.label}</b><small>{l.range}</small>{localLevel === l && <span>ระดับพื้นที่นี้</span>}</div>)}</div>
      <p className="pm25-muted pm25-local-caption">หน่วย µg/m³ · สีอ้างอิงค่าเฉลี่ย 24 ชั่วโมง · ค่าประมาณอาจต่างจากค่าที่ตรวจวัด ณ จุดจริง</p>
      {!fresh && <p className="pm25-notice">ข้อมูลตำบลไม่เป็นปัจจุบัน หรือไม่มีเวลายืนยัน ไม่ใช้สรุปสถานการณ์ขณะนี้</p>}
      <div className="pm25-local-list-heading"><h3>มองรอบพื้นที่ในอำเภอเดียวกัน</h3><p className="pm25-muted">ใกล้ → ไกลจาก อปท. · ระยะเส้นตรงถึงกึ่งกลางกรอบขอบเขตตำบลโดยประมาณ ไม่ใช่ระยะขับรถ</p></div>
      <div className="pm25-tambon-list">{(expanded ? rows : rows.slice(0, 6)).map(t => {
        const current = isFresh(t, now)
        const level = current ? pm25Level(t.average24) : null
        return <div className={`pm25-tambon-row${t.id === area.subdistrictId ? ' is-own' : ''}`} key={t.id}><div><b>{t.name}{t.id === area.subdistrictId && <small>พื้นที่ตามพิกัด อปท.</small>}</b><small>{Number.isFinite(t.distanceKm) ? `ประมาณ ${valueText(t.distanceKm)} กม. จาก อปท.` : 'ไม่มีพิกัดระยะห่าง · แสดงท้ายรายการ'}</small><span>{current ? level?.label || 'ไม่มีค่าเฉลี่ย' : 'ข้อมูลเก่า / ไม่ทราบเวลา'} · {formatMeasuredAt(t.measuredAt)}</span></div><div><strong style={{ color: level?.color || '#687986' }}>{valueText(t.average24)}</strong><small>เฉลี่ย 24 ชม. · µg/m³</small><small>รายชั่วโมง {valueText(t.hourly)} µg/m³</small></div></div>
      })}</div>
      {rows.length > 6 && <button className="pm25-expand" onClick={() => setExpanded(!expanded)}>{expanded ? 'ย่อรายการ' : `ดูครบ ${rows.length} ตำบล`}</button>}
      <p className="pm25-muted">หากตำบลไม่ตรงพื้นที่ ให้เจ้าหน้าที่ตรวจพิกัดหน่วยงาน ระบบไม่ได้ใช้ตำแหน่งส่วนตัวของผู้เข้าชม</p>
    </>}
    <a className="pm25-text-link" href="https://pm25.gistda.or.th/" target="_blank" rel="noopener noreferrer">ตรวจข้อมูลที่ GISTDA ↗</a>
  </section>
}

export default function Pm25Details({ mode, station, tenant, now }) {
  return mode === 'area' ? <Subdistricts key={tenant?.id} tenant={tenant} now={now} /> : <History key={station?.id} station={station} now={now} />
}
