import { shareWaterSituation, summaryStats, toNum, formatMm, formatMcm, rainLevel, damLevel, damTrend, bankText, distanceText, isStale, DAM_STALE_HOURS, STATION_STALE_HOURS, SYNC_STALE_HOURS } from './waterSituation.js'

export const shareDate = value => value && Number.isFinite(new Date(value).getTime())
  ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : 'ไม่ระบุเวลา'

export function waterShareSlides(data, tenant) {
  const { stations } = shareWaterSituation(data, tenant)
  const rain = stations.filter(s => s.station_type === 'rain')
  const slides = [{ kind: 'summary', title: 'สรุปน้ำ–ฝนในพื้นที่', stations }]
  for (let i = 0; i < rain.length; i += 3) slides.push({ kind: 'rain', title: 'ฝนสะสม 24 ชั่วโมง', stations: rain.slice(i, i + 3) })
  for (const kind of ['dam', 'waterlevel']) {
    for (const station of stations.filter(s => s.station_type === kind)) slides.push({ kind, title: station.station_name || 'สถานีไม่ระบุชื่อ', stations: [station] })
  }
  return slides.map((slide, i) => ({ ...slide, index: i + 1, total: slides.length }))
}

// Fixed square compositions, never shrink an entire long page to fit a chat thumbnail.
export async function renderWaterShareSlide(slide, { tenant, now, data, refreshFailed, url }) {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1080
  const c = canvas.getContext('2d')
  if (!c) throw new Error('Canvas unavailable')
  const box = (x, y, w, h, color, r = 28) => { c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill() }
  const text = (value, x, y, size = 30, color = '#475569', bold = false, width = 950) => {
    c.font = `${bold ? 700 : 400} ${size}px Sarabun, sans-serif`; c.fillStyle = color
    c.fillText(String(value), x, y, width)
  }
  const place = s => [s.tambon_name && `ต.${s.tambon_name}`, distanceText(s.distance_km), s.is_primary ? 'ในตำบล' : 'ใกล้เคียง'].filter(Boolean).join(' · ')
  const fresh = (s, hours) => !isStale(s.recorded_at, now, hours) && new Date(s.recorded_at).getTime() <= now
  const percent = s => toNum(s.storage_percent) ?? ((toNum(s.dam_capacity_mcm) ?? 0) > 0 && toNum(s.dam_storage_mcm) !== null ? 100 * toNum(s.dam_storage_mcm) / toNum(s.dam_capacity_mcm) : null)
  box(0, 0, 1080, 1080, '#eef5f9', 0)
  const gradient = c.createLinearGradient(0, 0, 1080, 220)
  gradient.addColorStop(0, '#082f49'); gradient.addColorStop(1, '#0e7490')
  box(0, 0, 1080, 218, gradient, 0)
  text(tenant.name, 48,  50, 28, '#cffafe', true, 830)
  text(`${slide.index}/${slide.total}`, 940, 50, 28, '#ffffff', true, 95)
  text(slide.title, 48, 114, 48, '#ffffff', true)
  text(`สรุป ณ ${shareDate(now)} น. (เวลาไทย)`, 48, 159, 27, '#cffafe')
  text('ในตำบล + สถานีใกล้เคียงไม่เกิน 5 กม. จากสำนักงาน', 48, 196, 25, '#cffafe')
  const syncStale = refreshFailed || isStale(data.synced_at, now, SYNC_STALE_HOURS)
  if (syncStale) text('ข้อมูลอาจไม่เป็นปัจจุบัน • ตรวจสอบเวลาวัด', 48, 252, 28, '#92400e', true)

  if (slide.kind === 'summary') {
    const stats = summaryStats({ rain: slide.stations.filter(s => s.station_type === 'rain'), dams: slide.stations.filter(s => s.station_type === 'dam'), levels: slide.stations.filter(s => s.station_type === 'waterlevel'), now })
    if (stats.rain) {
      box(40, 275, 1000, 225, '#ffffff')
      text('ฝนสะสม 24 ชม. สูงสุดในสถานีที่แสดง', 65, 321, 30, '#0369a1', true)
      text(`${formatMm(stats.rain.mm)} มม.`, 65, 409, 72, '#0f172a', true)
      text(`${stats.rain.station.station_name} · วัด ${shareDate(stats.rain.station.recorded_at)}`, 65, 464, 27)
    }
    const damTop = stats.rain ? 520 : 275
    const dams = slide.stations.filter(s => s.station_type === 'dam')
    box(40, damTop, 1000, 280, '#ffffff')
    text(`อ่างเก็บน้ำในขอบเขต ${dams.length} แห่ง`, 65, damTop + 48, 32, '#4338ca', true)
    dams.slice(0, 3).forEach((s, i) => {
      const p = percent(s), valid = fresh(s, DAM_STALE_HOURS)
      text(s.station_name, 65, damTop + 106 + i * 58, 31, '#0f172a', true, 670)
      text(valid && p !== null ? `${p.toFixed(1)}%` : 'ไม่มีค่าปัจจุบัน', 765, damTop + 106 + i * 58, 34, '#4338ca', true, 235)
    })
    if (!dams.length) text('ไม่มีสถานีอ่างเก็บน้ำในขอบเขตที่กำหนด', 65, damTop + 123,  30)
    if (dams.length > 3) text(`อีก ${dams.length - 3} แห่ง ดูภาพรายละเอียดในชุด`, 65, damTop + 262, 23)
    text('ปริมาณน้ำเทียบความจุ • เวลาวัดและรายละเอียดอยู่ในภาพรายอ่าง',  50, damTop + 318, 25)
    text(stats.bank ? `ระดับน้ำ: ${stats.bank.text} (${stats.bank.station.station_name})` : 'ระดับน้ำ: ไม่มีข้อมูลปัจจุบันสำหรับสรุป',  50, damTop + 374, 30, '#0f766e', true)
  } else if (slide.kind === 'rain') {
    slide.stations.forEach((s, i) => {
      const y = 277 + i * 211, mm = toNum(s.rain_24h_mm), level = rainLevel(mm), valid = fresh(s, STATION_STALE_HOURS)
      box(40, y, 1000, 194, '#ffffff')
      text(s.station_name, 65, y + 44, 34, '#0f172a', true, 650)
      text(place(s), 65, y + 85, 25, '#64748b', false, 670)
      text(mm === null ? 'ไม่มีค่า' : `${formatMm(mm)} มม.`, 760, y + 69, 48, '#0369a1', true, 245)
      text(valid ? level?.label || 'ไม่มีข้อมูล' : 'ข้อมูลเก่า/ไม่ระบุเวลา', 760, y + 113, 23, valid ? '#0369a1' : '#92400e', true, 245)
      text(`วัด ${shareDate(s.recorded_at)} น.`, 65, y + 130, 25)
      box(65, y + 154, 930, 13, '#e2e8f0', 6)
      // All rain slides use the same 100 mm scale; label above-scale readings explicitly.
      if (mm !== null && mm > 0) box(65, y + 154, Math.max(2, Math.min(mm / 100, 1) * 930), 13, valid ? '#0284c7' : '#94a3b8', 6)
    })
    text('แท่งเทียบ 0–100 มม. · ค่าสูงกว่า 100 มม. แสดงเต็มแท่ง ดูตัวเลขกำกับ',  50, 934, 23)
  } else {
    const s = slide.stations[0], isDam = slide.kind === 'dam', valid = fresh(s, isDam ? DAM_STALE_HOURS : STATION_STALE_HOURS)
    text(place(s),  50, 284, 29, '#334155', true)
    text(`ตรวจวัด ${shareDate(s.recorded_at)} น.${valid ? '' : ' · ข้อมูลเก่า/ไม่ระบุเวลา'}`,  50, 325, 25, valid ? '#64748b' : '#92400e')
    box(40, 350, 1000, 275, '#ffffff')
    if (isDam) {
      const p = percent(s), level = damLevel(p), color = valid ? level?.color || '#64748b' : '#94a3b8'
      c.lineWidth = 20; c.strokeStyle = '#e2e8f0'; c.beginPath(); c.arc(220, 487, 102, 0, Math.PI * 2); c.stroke()
      if (p !== null && p >= 0) { c.strokeStyle = color; c.beginPath(); c.arc(220, 487, 102, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(p / 100, 1)); c.stroke() }
      text(p === null ? 'ไม่มีค่า' : `${p.toFixed(1)}%`, 130, 505, 44, '#075985', true, 180)
      text('ปริมาตรน้ำในอ่าง', 390, 406, 32)
      text(`${formatMcm(s.dam_storage_mcm)} / ${formatMcm(s.dam_capacity_mcm)}`, 390, 481, 58, '#0f172a', true, 600)
      text('ล้าน ลบ.ม. · เทียบความจุระดับเก็บกัก', 390, 530, 27)
      text(valid ? level?.label || 'ไม่มีเกณฑ์เปรียบเทียบ' : 'ค่าที่แสดงเป็นข้อมูลเก่า', 390, 582, 32, color, true)
      box(40, 647, 1000, 174, '#ffffff')
      text('น้ำเข้า–ระบายออก (ล้าน ลบ.ม./วัน)', 65, 690, 29, '#075985', true)
      const input = toNum(s.dam_inflow_mcm), output = toNum(s.dam_released_mcm), max = Math.max(input ?? 0, output ?? 0, 0.01)
      for (const [i, label, value, color] of [[0, 'ไหลลงอ่าง', input, '#0284c7'], [1, 'ระบายออก', output, '#d97706']]) {
        const y = 721 + i * 49
        text(label, 65, y + 22, 27); box(290, y, 505,  20, '#e2e8f0', 10)
        if (value > 0) box(290, y, Math.max(2, value / max * 505), 20, color, 10)
        text(formatMcm(value), 845, y + 23, 31, '#0f172a', true, 150)
      }
      const trend = damTrend(s.dam_storage_mcm, s.prev_dam_storage_mcm)
      text(trend && s.prev_recorded_at ? `เทียบข้อมูล ${shareDate(s.prev_recorded_at)} น.` : 'ไม่มีข้อมูลก่อนหน้าสำหรับเทียบแนวโน้ม',  50, 867, 26)
      if (trend && s.prev_recorded_at) text(trend.label,  50, 915, 37, '#075985', true)
    } else {
      text('ระดับน้ำเทียบตลิ่ง', 65, 410,  30, '#0f766e', true)
      text(bankText(s.bank_diff_m) || 'ไม่มีค่าระดับน้ำ', 65, 500, 60, '#0f172a', true)
      text(valid ? s.situation_text || 'ดูค่าตรวจวัดประกอบ' : 'ข้อมูลเก่า โปรดตรวจสอบค่าล่าสุด', 65, 566, 32, valid ? '#0f766e' : '#92400e', true)
      text('ค่าของสถานีนี้ ไม่ใช่ระดับน้ำทุกจุดในหมู่บ้าน',  50, 710,  30)
      text('ติดตามประกาศของหน่วยงานในพื้นที่ควบคู่กัน',  50, 764,  30)
    }
  }
  box(0, 956, 1080, 124, '#e0edf4', 0)
  text('แหล่งข้อมูล: ThaiWater (สสน.) · ไม่ใช่ประกาศเตือนภัยของ อปท.', 40, 989, 23, '#334155', true)
  text('ข้อมูลไม่ครอบคลุมทุกจุด • ไม่มีข้อมูลไม่ได้หมายความว่าสถานการณ์ปกติ', 40, 1022, 22, '#92400e')
  text(url, 40, 1057, 21, '#0369a1')
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG export failed')
  return new File([blob], `water-${String(slide.index).padStart(2, '0')}-${slide.kind}.png`, { type: 'image/png' })
}
