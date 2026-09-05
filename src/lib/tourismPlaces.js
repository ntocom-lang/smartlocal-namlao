// ─── ตัวช่วยกลางของโมดูล "เที่ยว กิน พัก ชอป บริการ" ─────────────────────────────
//
// แยกออกมาจาก TourismPage.jsx เพราะตรรกะ "ตอนนี้ร้านเปิดอยู่ไหม" กับการคำนวณระยะทาง
// เป็นโค้ดบริสุทธิ์ที่ต้องเทสต์ได้โดยไม่ต้อง mount React (ดู tests/tourism-hours.test.mjs)
// และหน้ารายละเอียด/หลังบ้านต้องใช้ตัวเดียวกัน ไม่งั้นป้าย "เปิดอยู่" ของ 2 หน้าจะไม่ตรงกัน

export const TOURISM_CATS = [
  { key: 'travel',  label: 'เที่ยว',  emoji: '🏛️', color: '#1d4ed8', bg: '#dbeafe' },
  { key: 'food',    label: 'กิน',     emoji: '🍽️', color: '#d97706', bg: '#fef3c7' },
  { key: 'stay',    label: 'พัก',     emoji: '🏨', color: '#7c3aed', bg: '#ede9fe' },
  { key: 'shop',    label: 'ชอป',     emoji: '🛍️', color: '#15803d', bg: '#dcfce7' },
  { key: 'service', label: 'บริการ',  emoji: '🔧', color: '#dc2626', bg: '#fee2e2' },
]

export function catOf(key) {
  return TOURISM_CATS.find(c => c.key === key) ?? null
}

// ลำดับต้องตรงกับ Date.prototype.getDay() (0 = อาทิตย์)
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const DAY_LABEL_TH = {
  sun: 'อาทิตย์', mon: 'จันทร์', tue: 'อังคาร', wed: 'พุธ',
  thu: 'พฤหัสบดี', fri: 'ศุกร์', sat: 'เสาร์',
}

// ─── พิกัด ────────────────────────────────────────────────────────────────────

// อ่านพิกัดจากคอลัมน์ latitude/longitude ก่อน ถ้ายังไม่มี (ยังไม่ได้รัน migration
// 20260906110000 หรือแถวเก่าที่ backfill ไม่ติด) ค่อยแกะจาก maps_url แบบ ?q=lat,lng
// ที่ตอนอนุมัติคำขอเคยเก็บไว้ — หน้าเว็บจึงใช้ "ใกล้ฉัน" ได้ทันทีโดยไม่ต้องรอ DB
export function parseCoords(place) {
  const lat = Number(place?.latitude)
  const lng = Number(place?.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng }
  }
  const m = /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(place?.maps_url ?? '')
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (Number.isFinite(a) && Number.isFinite(b)) return { lat: a, lng: b }
  }
  return null
}

export function haversineKm(a, b) {
  if (!a || !b) return null
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function formatDistance(km) {
  if (km == null || !Number.isFinite(km)) return null
  if (km < 1) return `${Math.round(km * 1000)} ม.`
  if (km < 10) return `${km.toFixed(1)} กม.`
  return `${Math.round(km)} กม.`
}

// ลิงก์นำทาง — universal URL ของ Google Maps ที่เปิดได้ทั้งแอปและเว็บ ทั้ง iOS/Android
export function directionsUrl(place) {
  const c = parseCoords(place)
  if (c) return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`
  if (place?.maps_url) return place.maps_url
  if (place?.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.address)}`
  return null
}

// ─── เวลาทำการ ────────────────────────────────────────────────────────────────
//
// รูปแบบ opening_hours (jsonb): { "mon": ["08:30","16:30"], "tue": null, ... }
//   - array [เปิด, ปิด]  = เปิดตามเวลานั้น (ปิด <= เปิด แปลว่าคาบเที่ยงคืน เช่น 18:00-01:00)
//   - null               = ปิดทั้งวัน
//   - ไม่มีคีย์วันนั้น    = ไม่ได้ระบุ (ไม่เดาแทนร้าน)

function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

export function fmtMinutes(total) {
  const m = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// undefined = ไม่ได้ระบุ, null = ปิดทั้งวัน, object = ช่วงเปิด (close > 1440 ถ้าข้ามคืน)
function dayRange(oh, dayIdx) {
  const v = oh[DAY_KEYS[dayIdx]]
  if (v === null) return null
  if (!Array.isArray(v) || v.length < 2) return undefined
  const open = toMinutes(v[0])
  const close = toMinutes(v[1])
  if (open == null || close == null) return undefined
  return { open, close: close <= open ? close + 1440 : close }
}

function openLabel(nowMin, closeMin) {
  const left = closeMin - nowMin
  if (left <= 60) return { state: 'closing_soon', label: `ใกล้ปิด · ปิด ${fmtMinutes(closeMin)}` }
  return { state: 'open', label: `เปิดอยู่ · ถึง ${fmtMinutes(closeMin)}` }
}

export function getOpenState(openingHours, now = new Date()) {
  const oh = openingHours
  if (!oh || typeof oh !== 'object' || Array.isArray(oh)) return { state: 'unknown', label: null }
  if (!DAY_KEYS.some(k => k in oh)) return { state: 'unknown', label: null }

  const day = now.getDay()
  const nowMin = now.getHours() * 60 + now.getMinutes()

  // ร้านที่เปิดคาบเที่ยงคืนมาจากเมื่อวาน (เช่น ร้านข้าวต้ม 18:00-01:00) ต้องยังนับว่าเปิด
  const prev = dayRange(oh, (day + 6) % 7)
  if (prev && prev.close > 1440 && nowMin < prev.close - 1440) {
    return openLabel(nowMin + 1440, prev.close)
  }

  const today = dayRange(oh, day)
  if (today && nowMin >= today.open && nowMin < today.close) {
    return openLabel(nowMin, today.close)
  }

  // ปิดอยู่ — หาเวลาเปิดรอบถัดไปภายใน 7 วัน เพื่อบอกว่า "เปิดอีกทีเมื่อไหร่" แทนคำว่าปิดเฉยๆ
  for (let i = 0; i < 8; i += 1) {
    const idx = (day + i) % 7
    const r = dayRange(oh, idx)
    if (!r) continue
    if (i === 0 && nowMin >= r.open) continue
    if (i === 0) return { state: 'closed', label: `ปิดอยู่ · เปิด ${fmtMinutes(r.open)}` }
    if (i === 1) return { state: 'closed', label: `ปิดอยู่ · เปิดพรุ่งนี้ ${fmtMinutes(r.open)}` }
    return { state: 'closed', label: `ปิดอยู่ · เปิดวัน${DAY_LABEL_TH[DAY_KEYS[idx]]} ${fmtMinutes(r.open)}` }
  }
  return { state: 'closed', label: 'ปิดอยู่' }
}

// แปลง opening_hours เป็นรายการ 7 วันสำหรับโชว์ในหน้ารายละเอียด
export function weeklyHours(openingHours) {
  const oh = openingHours
  if (!oh || typeof oh !== 'object' || Array.isArray(oh)) return []
  return DAY_KEYS
    .filter(k => k in oh)
    .map((k) => {
      const v = oh[k]
      if (v === null) return { key: k, label: DAY_LABEL_TH[k], text: 'ปิด', closed: true }
      const open = toMinutes(v?.[0])
      const close = toMinutes(v?.[1])
      if (open == null || close == null) return { key: k, label: DAY_LABEL_TH[k], text: '—', closed: false }
      return { key: k, label: DAY_LABEL_TH[k], text: `${fmtMinutes(open)} - ${fmtMinutes(close)}`, closed: false }
    })
}


// ─── แปลงค่า opening_hours ↔ ตารางกรอก 7 แถวของหลังบ้าน ──────────────────────────

const DEFAULT_HOURS_ROW = { enabled: true, from: '08:30', to: '16:30' }

export function hoursToRows(oh) {
  return DAY_KEYS.map((k) => {
    const v = oh?.[k]
    if (Array.isArray(v) && v.length >= 2) return { enabled: true, from: String(v[0]), to: String(v[1]) }
    // null = ปิด, ไม่มีคีย์ = ยังไม่ได้ระบุ — ทั้งสองกรณีตั้งต้นเป็นปิด ให้เจ้าหน้าที่ติ๊กเปิดเอง
    // จะได้ไม่เผลอประกาศเวลาทำการที่ไม่มีใครยืนยัน
    return { ...DEFAULT_HOURS_ROW, enabled: false }
  })
}

export function rowsToHours(rows) {
  const out = {}
  DAY_KEYS.forEach((k, i) => {
    const r = rows[i]
    out[k] = r?.enabled ? [r.from, r.to] : null
  })
  return out
}

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/

export function rowsAreValid(rows) {
  return rows.every(r => !r.enabled || (TIME_RE.test(r.from) && TIME_RE.test(r.to)))
}

// ─── ค้นหา ────────────────────────────────────────────────────────────────────
//
// ตัดช่องว่าง/ขีดออกทั้งคำค้นและข้อความ เพราะคนพิมพ์ชื่อร้านไทยเว้นวรรคไม่เหมือนกัน
// ("ก๋วยเตี๋ยวเจ๊แดง" กับ "ก๋วยเตี๋ยว เจ๊แดง") ถ้าเทียบตรงๆ จะหาไม่เจอทั้งที่มีอยู่
export function normalizeSearch(s) {
  return String(s ?? '').toLowerCase().replace(/[\s\-_.]+/g, '')
}

export function matchesQuery(place, query) {
  const q = normalizeSearch(query)
  if (!q) return true
  const hay = normalizeSearch([
    place?.name,
    place?.description,
    place?.address,
    place?.village_no ? `หมู่${place.village_no}` : '',
    catOf(place?.category)?.label,
  ].filter(Boolean).join(' '))
  return hay.includes(q)
}
