// คำ "Smart City Local" (ตัวเอียง ไล่สี + wifi + หมุด + ริบบิ้น) เป็นสตริง SVG — ใช้ร่วมกันระหว่าง
//   ภาพข่าวประชาสัมพันธ์ (complaintNewsImage.js) และภาพสรุปเรื่องร้องเรียน (complaintMonthlyInfographic.js)
// แยกไฟล์เพราะภาพข่าว import จากไฟล์ภาพสรุปอยู่แล้ว ถ้าภาพสรุป import กลับจะเป็น import วน
// ออกแบบไว้วางบนพื้นสีเข้ม (คำมีขอบขาวหนา) · id ของ gradient ขึ้นต้น news-sc- คงเดิม (เทสต์ภาพข่าวอ่านอยู่) — ใช้ได้ภาพละครั้ง

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const num = n => Math.round(n * 100) / 100

// คำขวัญคู่กับเครื่องหมาย — "มุ่งสู่" เพราะยังไม่ได้รับรองเป็นเมืองอัจฉริยะ ห้ามเขียนว่าเป็นแล้ว
export const SMART_CITY_TAGLINE = 'มุ่งสู่เมืองอัจฉริยะ (Smart City)'

// ── คำ "Smart City Local" แบบโปสเตอร์อ้างอิง (เจ้าของสั่ง 2569-11-12) ──
// ตัวหนาเอียง ขอบขาว + เงา · Smart/Local ไล่น้ำเงิน City ไล่ส้ม · สัญญาณ wifi + หมุดแผนที่ + เส้นโค้งเขียว + ริบบิ้นข้อความไทย
// วาดด้วยรูปทรง/ข้อความ/ไล่สีล้วน (ไม่ใช้ filter/mask/<use> — Safari) · ออกแบบในกรอบ SC_W × SC_H แล้วย่อลงที่ว่างจริง
export const SC_W = 560
export const SC_H = 262
export const SC_MIN_SCALE = 0.5 // ที่ว่างเล็กกว่านี้ = ไม่วาด (ตัวเล็กจนอ่านไม่ออก ดูรก)
const SC_RIBBON = 'องค์กรปกครองส่วนท้องถิ่น'

export function smartCityMarkSvg(defs, x, y, w, h, measure) {
  // ปัดลง 2 ตำแหน่งก่อนใช้ — num() ใน transform ปัดเป็นทศนิยม 2 ตำแหน่ง ปัดขึ้นแล้วคำล้นที่ว่างได้ ~1 px
  const scale = Math.floor(Math.min(w / SC_W, h / SC_H, 1.1) * 100) / 100
  if (!(scale >= SC_MIN_SCALE)) return ''
  defs.push('<linearGradient id="news-sc-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b8cff"/><stop offset="1" stop-color="#1238a8"/></linearGradient>'
    + '<linearGradient id="news-sc-orange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd23f"/><stop offset="0.55" stop-color="#ff8a00"/><stop offset="1" stop-color="#f05a00"/></linearGradient>'
    + '<linearGradient id="news-sc-green" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7ed957" stop-opacity="0"/><stop offset="0.35" stop-color="#5cc93b"/><stop offset="1" stop-color="#1f9d55"/></linearGradient>'
    + '<linearGradient id="news-sc-ribbon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1e5bd8"/><stop offset="1" stop-color="#0b2f8f"/></linearGradient>')
  // คำเอียง 3 ชั้น: เงาน้ำเงินเข้ม → ขอบขาวหนา → ไล่สี (เอียงรอบเส้นฐานของคำเอง)
  const word = (tx, ty, value, size, fill) => {
    const t = `transform="translate(${num(tx)} ${num(ty)}) skewX(-11)" font-size="${size}" font-weight="700"`
    return `<text ${t} dx="3" dy="6" fill="#0a2470" fill-opacity="0.45">${value}</text>`
      + `<text ${t} fill="#ffffff" stroke="#ffffff" stroke-width="13" stroke-linejoin="round">${value}</text>`
      + `<text ${t} fill="url(#${fill})" stroke="#0b2f8f" stroke-width="1.5">${value}</text>`
  }
  const smartW = measure('Smart', 100, true)
  const cityW = measure('City', 88, true)
  const smartX = 40
  const cityX = 70
  const localX = cityX + cityW + 22
  // สัญญาณ wifi เหนือช่วงท้ายคำ Smart (จุด + โค้ง 3 วง เปิดขึ้นบน)
  const wx = smartX + smartW * 0.62
  const wy = 52
  const arc = r => `<path d="M${num(wx - r * 0.74)} ${num(wy - r * 0.67)}A${r} ${r} 0 0 1 ${num(wx + r * 0.74)} ${num(wy - r * 0.67)}" fill="none" stroke="url(#news-sc-blue)" stroke-width="9" stroke-linecap="round"/>`
  const wifi = `<g data-sc-wifi="1">${[16, 31, 46].map(arc).join('')}<circle cx="${num(wx)}" cy="${wy}" r="7" fill="#1e5bd8"/></g>`
  // หมุดแผนที่สีแดงชิดขวาบน
  const pinX = Math.min(SC_W - 30, smartX + smartW + 42) // ชิดท้ายคำ Smart แบบภาพอ้างอิง
  const pin = `<g transform="translate(${num(pinX)} 40)" data-sc-pin="1"><ellipse cx="0" cy="60" rx="14" ry="4" fill="#0a2470" fill-opacity="0.3"/>`
    + '<path d="M0 60C-6 46-24 34-24 18A24 24 0 0 1 24 18C24 34 6 46 0 60Z" fill="#e53935" stroke="#ffffff" stroke-width="3"/>'
    + '<circle cx="0" cy="18" r="8.5" fill="#ffffff"/></g>'
  // เส้นโค้งเขียวกวาดใต้บรรทัดสอง (แบบภาพอ้างอิง)
  const swoosh = '<path d="M6 214C170 250 410 232 556 128C462 226 228 262 6 232Z" fill="url(#news-sc-green)"/>'
  const ribbonW = Math.min(SC_W - 70, Math.ceil(measure(SC_RIBBON, 30, true)) + 70)
  const ribbonX = SC_W - ribbonW - 6
  const ribbon = `<rect x="${ribbonX}" y="${SC_H - 50}" width="${ribbonW}" height="46" rx="23" fill="url(#news-sc-ribbon)" stroke="#ffffff" stroke-width="3"/>`
    + `<text x="${num(ribbonX + ribbonW / 2)}" y="${SC_H - 17}" font-size="30" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(SC_RIBBON)}</text>`
  const ox = x + (w - SC_W * scale) / 2
  const oy = y + (h - SC_H * scale) / 2
  return `<g transform="translate(${num(ox)} ${num(oy)}) scale(${num(scale)})" data-smart-city-mark="1">`
    + wifi + pin + swoosh + ribbon // ริบบิ้นก่อนคำ — หางตัว y ของ City ทับริบบิ้นแบบภาพอ้างอิง ไม่ถูกริบบิ้นบัง
    + word(smartX, 130, 'Smart', 100, 'news-sc-blue')
    + word(cityX, 206, 'City', 88, 'news-sc-orange')
    + word(localX, 206, 'Local', 88, 'news-sc-blue')
    + '</g>'
}
