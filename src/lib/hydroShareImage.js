import { HYDRO_STATIONS, hydroSummary, hydroSegments, hydroDate, deltaText } from './hydroHourly.js'
export async function renderHydroShareImage(slide, { tenant, now, url }) {
  await document.fonts.ready
  const report = slide.report, station = HYDRO_STATIONS[report.station]
  const { latest, stale, one, three } = hydroSummary(report, now)
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1080
  const c = canvas.getContext('2d')
  if (!c) throw new Error('Canvas unavailable')
  const box = (x,y,w,h,color) => { c.fillStyle=color; c.beginPath(); c.roundRect(x,y,w,h,24); c.fill() }
  const text = (value,x,y,size=28,color='#475569',bold=false,width=960) => { c.font=`${bold?700:400} ${size}px Sarabun, sans-serif`; c.fillStyle=color; c.fillText(value,x,y,width) }
  const num = value => value == null ? 'ไม่มีค่า' : value.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})
  c.fillStyle='#edf6fb'; c.fillRect(0,0,1080,1080)
  const gradient=c.createLinearGradient(0,0,1080,230);gradient.addColorStop(0,'#082f49');gradient.addColorStop(1,'#0e7490');c.fillStyle=gradient;c.fillRect(0,0,1080,230)
  text(tenant.name,44,48,27,'#cffafe',true,830);text(`${slide.index}/${slide.total}`,944,48,27,'#fff',true,90)
  text(`${report.station} · ${station.name}`,44,107,43,'#fff',true)
  text(`${station.river} · ต.${station.tambon} อ.${station.district} จ.${station.province}`,44,154,27,'#cffafe')
  text(report.profile.scope,44,198,27,'#a5f3fc',true)
  box(36,250,1008,205,'#fff')
  text(stale?'ข้อมูลอาจไม่เป็นปัจจุบัน · ค่าล่าสุดที่ได้รับ':'ระดับน้ำล่าสุด ณ สถานี',60,293,29,stale?'#92400e':'#0369a1',true)
  text(`${num(latest?.level)} ม.`,60,389,76,'#0f172a',true,540)
  text('น้ำไหลผ่าน',660,323,27,'#6d28d9',true,340)
  text(`${num(latest?.discharge)}`,660,379,46,'#6d28d9',true,340)
  text('ลูกบาศก์เมตร/วินาที',660,420,25,'#64748b',false,340)
  text(latest?`วัด ${hydroDate(latest.at)} น. (เวลาไทย)`:'ไม่ระบุเวลาตรวจวัด',60,436,24)
  box(36,474,490,116,'#e0f2fe');box(546,474,498,116,'#e6fffa')
  text('เทียบ 1 ชั่วโมงก่อน',60,514,26,'#0369a1',true,435);text(deltaText(one),60,559,34,'#075985',true,435)
  text('เทียบ 3 ชั่วโมงก่อน',570,514,26,'#0f766e',true,440);text(deltaText(three),570,559,34,'#115e59',true,440)
  box(36,608,1008,250,'#fff');text('ระดับน้ำย้อนหลัง 24 ชั่วโมง (ม.)',60,648,27,'#0f172a',true)
  const start=now-24*3600000, rows=report.points.filter(p=>p.at>=start&&p.at<=now), values=rows.filter(p=>p.level!==null)
  if(values.length){
    const low=Math.min(...values.map(p=>p.level))-.1,high=Math.max(...values.map(p=>p.level))+.1
    const x=p=>125+(p.at-start)/(24*3600000)*860,y=p=>792-(p.level-low)/(high-low)*108
    for(const fraction of [0,.5,1]){const yy=792-fraction*108;c.strokeStyle='#e2e8f0';c.lineWidth=1;c.beginPath();c.moveTo(125,yy);c.lineTo(985,yy);c.stroke();text((low+fraction*(high-low)).toFixed(2),52,yy+7,20,'#64748b',false,65)}
    for(const segment of hydroSegments(rows)){c.strokeStyle='#0284c7';c.lineWidth=4;c.beginPath();segment.forEach((p,i)=>i?c.lineTo(x(p),y(p)):c.moveTo(x(p),y(p)));c.stroke();for(const p of segment){c.fillStyle='#0284c7';c.beginPath();c.arc(x(p),y(p),3,0,Math.PI*2);c.fill()}}
    const clock=t=>new Date(t).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'})
    text(`24 ชม.ก่อน ${clock(start)}`,125,829,20);text(`ถึง ${clock(now)} น.`,820,829,20,'#64748b',false,180)
  }else text('ไม่มีข้อมูลในช่วงนี้',60,747,32)
  text('ค่าที่เสาวัด ไม่ใช่ความลึกน้ำท่วมในหมู่บ้าน',44,898,27,'#075985',true)
  text('กราฟขาดเมื่อข้อมูลไม่ต่อเนื่อง · ไม่ใช่การพยากรณ์หรือประกาศเตือนภัย',44,937,24)
  c.fillStyle='#dcebf3';c.fillRect(0,962,1080,118)
  text('แหล่งข้อมูล: ศูนย์อุทกวิทยาชลประทานภาคเหนือตอนบน กรมชลประทาน',40,996,22,'#334155',true)
  text('ติดตามประกาศในพื้นที่ควบคู่กัน · ไม่มีข้อมูลไม่ได้หมายความว่าปลอดภัย',40,1030,22,'#92400e')
  text(url,40,1064,20,'#0369a1')
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
  if(!blob) throw new Error('PNG export failed')
  return new File([blob],`water-${String(slide.index).padStart(2,'0')}-hydro-${report.station}.png`,{type:'image/png'})
}
