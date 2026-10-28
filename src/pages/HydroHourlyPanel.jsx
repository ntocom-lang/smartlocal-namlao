import { useEffect, useState } from 'react'
import { Waves, ArrowUpRight, ArrowDownRight, Minus, ExternalLink, Clock3 } from 'lucide-react'
import { HYDRO_SOURCE, HYDRO_STATIONS, hydroDate, hydroSummary, hydroSegments, deltaText } from '../lib/hydroHourly'
import './HydroHourlyPanel.css'
const number = value => value == null ? '—' : value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const clock = at => new Date(at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
function HourlyChart({ points, hours, now }) {
  // ความกว้าง viewBox = ความกว้างที่แสดงจริงของกราฟ (สเกล 1:1) ตัวอักษรในกราฟจึงเป็นขนาด px จริงเสมอ
  // เดิมใช้ viewBox ตายตัว 400/740 ตามความกว้างหน้าจอ แต่กราฟแสดงในคอลัมน์ที่แคบกว่าหน้าจอ (แท็บเล็ต 768px คอลัมน์ ~440px ย่อ 740 → ~0.6 เท่า)
  // ตัวอักษร 16 หน่วยจึงเหลือ ~9.5px ที่แท็บเล็ต และ ~11.8px ที่ 360px (วัดเทียบ ทต.หนองหอย 2569-10-28)
  const [svgEl, setSvgEl] = useState(null)
  const [shown, setShown] = useState(() => (window.matchMedia('(max-width: 640px)').matches ? 330 : 700))
  useEffect(() => {
    if (!svgEl) return undefined
    const read = () => { const w = Math.round(svgEl.getBoundingClientRect().width); if (w > 0) setShown(w) }
    read()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(read)
    observer.observe(svgEl)
    return () => observer.disconnect()
  }, [svgEl])
  // 300 = ต่ำสุดที่ป้ายวันเวลาซ้าย-ขวา (กว้างราว 90px ที่ 13px) ไม่ชนกัน · ต่ำกว่า 520 แสดงป้ายแกนเวลาแค่ต้น-ท้าย
  const width = Math.max(300, shown), plotWidth = width - 100, compact = width < 520

  const rows = points.filter(p => p.at >= now - hours * 3600000 && p.at <= now)
  const values = rows.filter(p => p.level !== null)
  if (!values.length) return <p className="hydro-empty">ยังไม่มีค่าระดับน้ำในช่วงนี้</p>
  const end = now, start = end - hours * 3600000
  const min = Math.floor((Math.min(...values.map(p => p.level)) - 0.1) * 10) / 10
  const max = Math.ceil((Math.max(...values.map(p => p.level)) + 0.1) * 10) / 10
  const x = p => 62 + (p.at - start) / (end - start) * plotWidth
  const y = p => 195 - (p.level - min) / (max - min) * 155
  return <svg ref={setSvgEl} viewBox={`0 0 ${width} 245`} role="img" aria-label={`กราฟระดับน้ำ ${hours} ชั่วโมง แกนตั้ง ${min.toFixed(1)} ถึง ${max.toFixed(1)} เมตร ช่องว่างคือข้อมูลขาด`}>
    {[0, 0.5, 1].map(t => <g key={t}><line x1="62" x2={width - 38} y1={195 - t * 155} y2={195 - t * 155} stroke="#d8e7ef" strokeDasharray="4 5"/><text x="52" y={200 - t * 155} textAnchor="end" fill="#64748b" fontSize="13">{(min + t * (max - min)).toFixed(2)}</text></g>)}
    <text x="62" y="22" fill="#64748b" fontSize="13">ระดับน้ำ (ม.) · แกนปรับตามข้อมูล</text>
    {hydroSegments(rows).map((segment, i) => <g key={i}><polyline points={segment.map(p => `${x(p)},${y(p)}`).join(' ')} fill="none" stroke="#0284c7" strokeWidth="3" strokeLinejoin="round"/>{segment.map(p => <circle key={p.at} cx={x(p)} cy={y(p)} r="3" fill="#0284c7"/>)}</g>)}
    {(compact ? [0, 1] : [0, 0.5, 1]).map(t => <text key={t} x={62 + t * plotWidth} y="228" textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'} fill="#64748b" fontSize="13">{new Date(start + t * (end - start)).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short'})} {clock(start + t * (end - start))}</text>)}
  </svg>
}
export default function HydroHourlyPanel({ profile, report, failed, now }) {
  const [hours, setHours] = useState(24)
  if (!profile) return null
  const station = HYDRO_STATIONS[profile.station]
  const { latest, stale, one, three } = hydroSummary(report, now)
  const Icon = one === null || one === 0 ? Minus : one > 0 ? ArrowUpRight : ArrowDownRight
  return <section className="hydro-panel" aria-label="ระดับน้ำรายชั่วโมง Hydro-1">
    <header className="hydro-head"><div className="hydro-head-icon"><Waves size={28}/></div><div><p className="hydro-eyebrow">HYDRO-1 · กรมชลประทาน</p><h2>{profile.label}</h2></div><span className="hydro-code">{profile.station}</span></header>
    <div className="hydro-content">
      <div className="hydro-station"><h3>{station.name}</h3><span>{station.river} · ต.{station.tambon} อ.{station.district} จ.{station.province}</span><p className="hydro-scope">{profile.scope}</p></div>
      <p className="hydro-explain">{profile.note}</p>
      {!report ? <div role="status" className="hydro-empty">{failed ? 'ยังโหลดรายงานไม่ได้ เปิดรายงานต้นทางเพื่อตรวจสอบได้ด้านล่าง' : 'กำลังอ่านข้อมูลรายชั่วโมง…'}</div> : <>
        {(stale || failed) && <p className="hydro-warning" role="status">ข้อมูลอาจไม่เป็นปัจจุบัน · ค่าด้านล่างเป็นข้อมูลล่าสุดที่ได้รับ โปรดตรวจเวลาวัด</p>}
        <div className="hydro-metrics"><div className="hydro-main-value"><span>{stale || failed ? 'ระดับน้ำล่าสุดที่ได้รับ' : 'ระดับน้ำล่าสุด'}</span><strong>{number(latest?.level)} <small>ม.</small></strong><p>ค่าที่เสาวัดของสถานี ไม่ใช่ความลึกน้ำท่วม</p></div><div className="hydro-trend"><span>เทียบ 1 ชั่วโมงก่อน</span><strong><Icon size={24}/>{deltaText(one)}</strong><p>เทียบ 3 ชั่วโมง: {deltaText(three)}</p></div><div className="hydro-flow"><span>ปริมาณน้ำไหลผ่าน</span><strong>{number(latest?.discharge)}</strong><p>ลูกบาศก์เมตรต่อวินาที</p></div></div>
        <p className="hydro-time"><Clock3 size={16}/>{latest ? `ตรวจวัด ${hydroDate(latest.at)} น.` : 'ไม่มีเวลาตรวจวัด'} · เวลาไทย</p>
        <div className="hydro-chart-title"><h3>น้ำขึ้นหรือลง ดูได้จากเส้นนี้</h3><div role="group" aria-label="ช่วงเวลารายงาน">{[24,72].map(h => <button key={h} type="button" aria-pressed={hours===h} onClick={()=>setHours(h)}>{h} ชั่วโมง</button>)}</div></div>
        <HourlyChart points={report.points} hours={hours} now={now}/>
        <p className="hydro-chart-note">จุดคือค่าตรวจวัด · เส้นขาดเมื่อข้อมูลไม่ต่อเนื่อง · แนวโน้มไม่ใช่การพยากรณ์</p>
        <details className="hydro-table"><summary>ดูตารางรายชั่วโมง</summary><div><table><caption>ข้อมูลย้อนหลัง {hours} ชั่วโมง · เวลาไทย</caption><thead><tr><th>วัน–เวลาวัด</th><th>ระดับน้ำ<br/>(ม.)</th><th>น้ำไหลผ่าน<br/>(ลบ.ม./วินาที)</th></tr></thead><tbody>{report.points.filter(p=>p.at>=now-hours*3600000 && p.at<=now).slice().reverse().map(p=><tr key={p.at}><td>{hydroDate(p.at)}</td><td>{number(p.level)}</td><td>{number(p.discharge)}</td></tr>)}</tbody></table></div></details>
      </>}
      <footer className="hydro-footer"><p>ข้อมูล ณ สถานีนี้ ไม่ได้บอกว่าน้ำท่วมหรือปลอดภัยทุกจุดในตำบล · ติดตามประกาศในพื้นที่ควบคู่กัน</p><a href={HYDRO_SOURCE} target="_blank" rel="noopener noreferrer">เปิดรายงานศูนย์ฯ · เลือก {profile.station}<ExternalLink size={16}/></a><small>แหล่งข้อมูล: ศูนย์อุทกวิทยาชลประทานภาคเหนือตอนบน · ไม่ใช่ประกาศเตือนภัยของ อปท.{report?.fetchedAt && ` · ดึงข้อมูล ${hydroDate(report.fetchedAt)} น.`}</small></footer>
    </div>
  </section>
}
