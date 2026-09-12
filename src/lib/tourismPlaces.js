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

// ─── ปุ่มบริการออนไลน์ (สั่งซื้อ / จอง / Line / เว็บไซต์) ─────────────────────────
//
// คอลัมน์ online_url เป็นช่องข้อความเปล่าที่ทั้งเจ้าหน้าที่และร้านค้าพิมพ์เอง ของจริงใน DB
// จึงไม่ใช่ URL เสมอไป — เท่าที่เจอมี "0983819257" (เบอร์โทรล้วน) กับ "ld.0876084038"
// (Line ID) ซึ่งเดิมถูกยัดลง href ดิบๆ เบราว์เซอร์ตีเป็น relative path แล้วพาไป
// /tourism/0983819257 ที่ไม่มี route รองรับ ผลคือ "กดปุ่มสั่งซื้อแล้วได้หน้าขาว"
//
// ฟังก์ชันนี้จึงเดาเจตนาจากรูปแบบข้อความแทนที่จะเชื่อว่าเป็น URL และถ้าเดาไม่ออกจริงๆ
// ให้ตกไปใช้เบอร์โทรของร้าน ดีกว่าปล่อยปุ่มที่กดแล้วไปหน้าเปล่า
//
// ⚠️ ด่านความปลอดภัย: ต้องกรอง scheme ที่นี่จุดเดียว เพราะ online_url มาจากฟอร์ม
// ลงทะเบียนร้านค้าฝั่งประชาชน (BusinessRegisterPage) ค่าอย่าง "javascript:..." หรือ
// "data:text/html,..." ที่หลุดการอนุมัติไปจะกลายเป็นปุ่มรันสคริปต์บนเว็บ อปท. ทันที
// allowlist เท่านั้น ห้ามเปลี่ยนเป็น blocklist

const SAFE_SCHEMES = ['http:', 'https:', 'tel:', 'line:']

// LINE ID ตามข้อกำหนดของ LINE: a-z 0-9 . _ - ยาว 4-20 ตัว
const LINE_ID_RE = /^[a-z0-9._-]{4,20}$/i

// โดเมนที่ไม่มี scheme เช่น "www.facebook.com/xxx" — ส่วนท้ายสุดต้องเป็นตัวอักษร 2 ตัวขึ้นไป
// (TLD) เงื่อนไขนี้คือตัวแยก "ld.0876084038" (Line ID) ออกจากโดเมนจริง ถ้าดูแค่ว่ามีจุด
// จะได้ https://ld.0876084038 ซึ่งพังเงียบอีกแบบหนึ่ง
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(?=$|[/?#])/i

// เบอร์โทรไทย: 0 นำหน้า ตามด้วยอีก 8-9 หลัก (เบอร์บ้าน 9 หลัก / มือถือ 10 หลัก)
const TH_PHONE_RE = /^0\d{8,9}$/

function digitsOnly(s) {
  return String(s ?? '').replace(/[\s\-().]/g, '')
}

function safeUrl(raw) {
  try {
    const u = new URL(raw)
    if (!SAFE_SCHEMES.includes(u.protocol)) return null
    return u
  } catch {
    return null
  }
}

// คืน { href, kind, source } หรือ null ถ้าไม่มีช่องทางไหนใช้ได้เลย
//   kind   — 'web' | 'line' | 'phone' ใช้เลือกข้อความบนปุ่มให้ตรงกับสิ่งที่จะเกิดขึ้นจริง
//   source — 'online_url' (ค่าที่ร้านกรอก) | 'phone' (ตกมาใช้เบอร์ร้านแทน)
export function resolveServiceUrl(place) {
  const raw = String(place?.online_url ?? '').trim()

  const fallback = () => {
    const tel = digitsOnly(place?.phone)
    if (!TH_PHONE_RE.test(tel)) return null
    return { href: `tel:${tel}`, kind: 'phone', source: 'phone' }
  }

  if (!raw) return fallback()

  // 1) มี scheme มาแล้ว — ผ่าน allowlist เท่านั้น
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const u = safeUrl(raw)
    if (!u) return fallback()
    if (u.protocol === 'tel:') return { href: u.href, kind: 'phone', source: 'online_url' }
    if (u.protocol === 'line:' || /(^|\.)line\.me$/i.test(u.hostname)) {
      return { href: u.href, kind: 'line', source: 'online_url' }
    }
    return { href: u.href, kind: 'web', source: 'online_url' }
  }

  // 2) protocol-relative "//example.com/x"
  if (raw.startsWith('//')) {
    const u = safeUrl(`https:${raw}`)
    return u ? { href: u.href, kind: 'web', source: 'online_url' } : fallback()
  }

  // 3) Line Official Account — "@bannrimyom"
  if (raw.startsWith('@') && LINE_ID_RE.test(raw.slice(1))) {
    return { href: `https://line.me/R/ti/p/${raw}`, kind: 'line', source: 'online_url' }
  }

  // 4) เบอร์โทรล้วน — "0983819257" หรือ "098-381-9257"
  const tel = digitsOnly(raw)
  if (TH_PHONE_RE.test(tel)) {
    return { href: `tel:${tel}`, kind: 'phone', source: 'online_url' }
  }

  // 5) โดเมนที่ลืมใส่ scheme — "www.facebook.com/xxx"
  if (BARE_DOMAIN_RE.test(raw)) {
    const u = safeUrl(`https://${raw}`)
    if (u) return { href: u.href, kind: 'web', source: 'online_url' }
  }

  // 6) Line ID ล้วน — "ld.0876084038", "riimyom"
  if (LINE_ID_RE.test(raw)) {
    return { href: `https://line.me/R/ti/p/~${raw}`, kind: 'line', source: 'online_url' }
  }

  // เดาไม่ออก (เช่นข้อความไทย "ทักไลน์ได้เลย") — อย่าเดามั่ว ใช้เบอร์ร้านแทน
  return fallback()
}

// ป้ายบนปุ่มต้องบอกสิ่งที่จะเกิดขึ้นจริงเมื่อกด ไม่ใช่เจตนาที่ร้านตั้งไว้
// ร้าน OTOP ระดับตำบลส่วนใหญ่ตั้ง online_service = 'order' แต่กรอกเบอร์โทรหรือ Line ID
// ไม่ใช่ลิงก์ร้านค้า ถ้าปล่อยให้ปุ่มเขียนว่า "สั่งซื้อเลย" แล้วเด้งไปหน้าโทรออก
// คนกดจะงงว่ากดผิดปุ่มหรือเปล่า
//
// คืน null เมื่อ kind === 'web' เพราะกรณีนั้นป้ายเดิมของแต่ละหน้าถูกต้องอยู่แล้ว
export function serviceChannelLabel(onlineService, kind, { short = false } = {}) {
  if (kind === 'phone') {
    if (onlineService === 'order') return short ? 'โทรสั่ง' : 'โทรสั่งซื้อ'
    if (onlineService === 'book')  return short ? 'โทรจอง' : 'โทรจอง'
    return short ? 'โทร' : 'โทรติดต่อร้าน'
  }
  if (kind === 'line') {
    // การ์ดในหน้ารวมเรียง 2 คอลัมน์ ปุ่มแบ่งกัน 3 อัน เหลือที่ปุ่มละ ~55px เท่านั้น
    // 'ทัก LINE' ตกบรรทัดเป็น 2 แถว ดันการ์ดสูงไม่เท่ากัน ไอคอนแชทหน้าคำสื่อความหมายครบอยู่แล้ว
    if (short) return 'LINE'
    if (onlineService === 'order') return 'สั่งซื้อทาง LINE'
    if (onlineService === 'book')  return 'จองทาง LINE'
    return 'ติดต่อทาง LINE'
  }
  return null
}

// ─── ตัวช่วยฝั่งฟอร์ม ─────────────────────────────────────────────────────────
//
// ช่องกรอกเขียนว่า "ลิงก์ / Line ID / URL" ซึ่งเชิญให้พิมพ์อะไรลงไปก็ได้ คนกรอกจึงไม่มีทาง
// รู้เลยว่าค่าที่ใส่จะกลายเป็นปุ่มแบบไหน จนกว่าจะมีคนกดแล้วเจอปัญหา — ฟังก์ชันนี้มีไว้ให้
// ฟอร์มบอกล่วงหน้าได้ว่า "ปุ่มจะพาไปที่ไหน"
//
// จงใจไม่บล็อกการบันทึกสำหรับค่าที่อ่านไม่ออก เพราะถ้ากติกาข้างบนพลาดเคสไหน เจ้าหน้าที่จะ
// บันทึกร้านไม่ได้เลยและไม่รู้ว่าทำไม ปุ่มเสียหนึ่งปุ่มยังทนได้ แต่บันทึกข้อมูลไม่ได้คือ
// ระบบใช้งานไม่ได้ ที่บล็อกจริงมีอย่างเดียวคือ scheme ที่เป็นช่องทางโจมตี ไม่ใช่การพิมพ์ผิด
const DANGEROUS_SCHEME_RE = /^(javascript|data|vbscript|file|blob):/i

export function describeServiceUrl(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return { status: 'empty' }

  // เบราว์เซอร์ตัด whitespace กับอักขระควบคุมในกลาง URL ทิ้งก่อนตีความ scheme
  // "java<tab>script:..." จึงรันได้จริง ต้องเทียบกับค่าที่ยุบแล้วเท่านั้น
  // ตัดด้วย charCode แทน regex เพราะ regex ที่มีอักขระควบคุมติด lint (no-control-regex)
  const collapsed = Array.from(value).filter(ch => ch.charCodeAt(0) > 0x20).join('')
  if (DANGEROUS_SCHEME_RE.test(collapsed)) return { status: 'blocked' }

  const link = resolveServiceUrl({ online_url: value })
  if (!link) return { status: 'unknown' }
  return { status: 'ok', href: link.href, kind: link.kind }
}

// ด่านเดียวที่บล็อกการบันทึกจริง — ใช้ร่วมกันทั้ง 3 ฟอร์มที่มีช่อง online_url
export function serviceUrlBlocked(raw) {
  return describeServiceUrl(raw).status === 'blocked'
}
