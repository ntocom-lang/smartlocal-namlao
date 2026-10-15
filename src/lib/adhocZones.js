// ตัวช่วยล้วน (ไม่แตะ React/DB) ของ "วงรัศมีเรื่องเฉพาะกิจ" — ตาราง adhoc_impact_zones (20261012120000)
// ใช้ร่วมกันระหว่างฟอร์มกำหนดวง แผงรายการ และตัววาดบนแผนที่ และมีเทสต์ล็อกไว้ (tests/adhoc-zones.test.mjs)
//
// ⚠️ ค่าขอบเขตด้านล่างต้องตรงกับ CHECK ของตาราง (adhoc_impact_zones_radii) — ถ้าแก้ที่นี่ต้องแก้ migration ด้วย
//    และกลับกัน ฝั่ง DB เป็นด่านจริง ฝั่งนี้มีไว้ให้หน้าจอไม่ปล่อยค่าที่ DB จะปฏิเสธ

// ⚠️ ถ้อยคำเป็นกลางโดยตั้งใจ: จุดนี้คือ "จุดที่เจ้าหน้าที่ตั้งสมมติฐานว่าอาจเกี่ยวข้อง" ไม่ใช่ผลตรวจวัดหรือข้อสรุปว่าเป็นต้นเหตุ
// และรัศมีคือระยะอ้างอิงที่เจ้าหน้าที่กำหนด ไม่ใช่เขตผลกระทบที่พิสูจน์แล้ว — อย่าเปลี่ยนเป็นคำที่ฟันธง
export const ZONE_DISCLAIMER = 'จุดและรัศมีเป็นระยะอ้างอิงที่เจ้าหน้าที่กำหนด ไม่ใช่ผลตรวจวัดหรือข้อสรุปว่าเป็นต้นเหตุ'

export const MIN_RADIUS_M = 50
export const MAX_RADIUS_M = 20000
export const MAX_RINGS = 6
export const DEFAULT_RADII_M = [1000, 2000]
// ปุ่มลัดในฟอร์ม — ที่เหลือพิมพ์เองเป็นกิโลเมตร
export const QUICK_RADII_M = [500, 1000, 2000, 3000, 5000]

// อ่านระยะที่ผู้ใช้พิมพ์เป็นกิโลเมตร ("1", "1.5", "0,5" และเลขไทย) → เมตร (จำนวนเต็ม) หรือ null ถ้าใช้ไม่ได้
export function kmToMeters(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const ascii = raw
    .replace(/[๐-๙]/g, ch => String(ch.charCodeAt(0) - 0x0e50))
    .replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(ascii)) return null
  const meters = Math.round(Number(ascii) * 1000)
  if (!Number.isFinite(meters) || meters < MIN_RADIUS_M || meters > MAX_RADIUS_M) return null
  return meters
}

// จัดรายการรัศมีให้พร้อมบันทึก: เฉพาะค่าที่ใช้ได้ ตัดซ้ำ เรียงน้อย→มาก ไม่เกิน MAX_RINGS วง
export function normalizeRadii(list) {
  const out = Array.from(new Set(
    (Array.isArray(list) ? list : [])
      .map(Number)
      .filter(n => Number.isFinite(n))
      .map(n => Math.round(n))
      .filter(n => n >= MIN_RADIUS_M && n <= MAX_RADIUS_M),
  )).sort((a, b) => a - b)
  return out.slice(0, MAX_RINGS)
}

// "500 ม." / "1 กม." / "1.5 กม." / "2.25 กม."
export function formatRadius(meters) {
  const m = Math.round(Number(meters))
  if (!Number.isFinite(m)) return ''
  if (m < 1000) return `${m} ม.`
  const km = Math.round((m / 1000) * 100) / 100
  return `${km} กม.`
}

// สีวง: วงในเข้ม วงนอกจาง (วงซ้อนกัน ตัวเลขยิ่งใกล้ต้นทางยิ่งเป็นพื้นที่ที่น่ากังวลกว่า)
// ใช้เฉดแดง→ส้ม→เหลือง คงที่ตามลำดับวง ไม่สุ่ม ไม่ผูกกับค่าตัวเลข ผู้ใช้จึงจำสีตามลำดับได้
const RING_PALETTE = ['#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#0d9488']
export function ringColor(index) {
  return RING_PALETTE[Math.max(0, Math.min(RING_PALETTE.length - 1, index))]
}

// ⚠️ ห้ามใช้ Number() ตรงๆ กับพิกัด — Number(null) และ Number('') คืน 0 ซึ่ง Number.isFinite ผ่าน
// พิกัดว่างจึงกลายเป็นจุดที่ละติจูด 0 กลางอ่าวกินี (กับดักเดียวกับ toCoord ใน src/lib/odorAnalytics.js)
// ช่วงค่าตรงกับ CHECK adhoc_impact_zones_lat/lng ของตาราง — นอกช่วงนี้ DB ก็ไม่รับอยู่แล้ว
const toCoord = v => (v == null || v === '' ? NaN : Number(v))
export function validZoneCoords(latitude, longitude) {
  const lat = toCoord(latitude)
  const lng = toCoord(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < 5 || lat > 21 || lng < 96 || lng > 106) return null
  return { lat, lng }
}

// ระดับซูมที่ให้วงนอกสุดพอดีจอ (ครึ่งวงประมาณ 200 พิกเซล) — กดชื่อเรื่องในแผงแล้วแผนที่เลื่อน+ซูมไปดูวงให้เอง
// เมตรต่อพิกเซลที่ซูม z = 156543.03 × cos(ละติจูด) / 2^z · ปัดลงให้วงไม่ล้นจอ · ล็อกช่วง 8–17 กันซูมสุดโต่ง
export function zoomForRadius(latitude, radiusM) {
  const lat = toCoord(latitude)
  const r = toCoord(radiusM)
  if (!Number.isFinite(lat) || !Number.isFinite(r) || r <= 0) return 14
  const z = Math.log2((200 * 156543.03 * Math.cos((lat * Math.PI) / 180)) / r)
  return Math.max(8, Math.min(17, Math.floor(z)))
}

export const zoneHideKey = zoneId => `z:${zoneId}`
export const ringHideKey = (zoneId, radiusM) => `r:${zoneId}:${radiusM}`

// รายการวงที่จะวาดบนแผนที่ — ข้ามเรื่องที่ปิดแล้ว (is_active=false), เรื่องที่ผู้ใช้ปิดส่วนตัว, และวงที่ปิดรายวง
// layerOn=false → ไม่วาดอะไรเลย · ส่งคืนทั้ง "วง" (circles) และ "หมุดจุดต้นทาง" (pins)
export function buildZoneOverlays(zones, { layerOn = true, hidden = new Set(), formatter = formatRadius } = {}) {
  const circles = []
  const pins = []
  if (!layerOn) return { circles, pins }

  for (const zone of Array.isArray(zones) ? zones : []) {
    if (!zone || zone.is_active === false) continue
    if (hidden.has(zoneHideKey(zone.id))) continue
    const coords = validZoneCoords(zone.latitude, zone.longitude)
    if (!coords) continue
    const { lat, lng } = coords

    pins.push({ id: `zone-${zone.id}`, zone, position: { lat, lng } })

    const radii = normalizeRadii(zone.radii_m)
    // วาดวงใหญ่ก่อนเพื่อให้วงเล็กซ้อนอยู่ด้านบน — กดและมองเห็นวงในได้เสมอ
    radii.map((radius, index) => ({ radius, index }))
      .sort((a, b) => b.radius - a.radius)
      .forEach(({ radius, index }) => {
        if (hidden.has(ringHideKey(zone.id, radius))) return
        const color = ringColor(index)
        circles.push({
          id: `zone-${zone.id}-${radius}`,
          center: { lat, lng },
          radius,
          color,
          fillColor: color,
          fillOpacity: 0.07,
          weight: 2,
          dashArray: true,
          label: formatter(radius),
          // วงในอยู่ทิศเหนือ วงถัดไปเอียง 40° ต่อวง ให้ป้ายแต่ละวงไม่ทับกัน (ดู LeafletMapCanvas)
          labelAngle: index * 40,
        })
      })
  }
  return { circles, pins }
}

// แถวจาก RPC adhoc_zone_counts ([{ zone_id, radius_m, complaint_count }]) → Map<zoneId, Map<radius, count>>
export function indexCounts(rows) {
  const byZone = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.zone_id) continue
    if (!byZone.has(row.zone_id)) byZone.set(row.zone_id, new Map())
    byZone.get(row.zone_id).set(Number(row.radius_m), Number(row.complaint_count) || 0)
  }
  return byZone
}

// ── ค่าที่ผู้ใช้ปิดไว้ (ส่วนตัวในเบราว์เซอร์ ไม่กระทบคนอื่น) ──────────────────────────────
// เก็บรายการคีย์ที่ "ปิด" ไม่ใช่ที่ "เปิด" — เรื่อง/วงใหม่ที่เพิ่มทีหลังต้องขึ้นเองโดยไม่ต้องมีใครไปเปิด
// storage ส่งเข้ามาเพื่อทดสอบได้ · อ่าน/เขียนพังต้องไม่ทำให้หน้าล้ม (โหมดส่วนตัว/ปิด storage)
export const HIDDEN_STORAGE_KEY = 'dc-adhoc-zones-hidden'
export const LAYER_STORAGE_KEY = 'dc-adhoc-zones-layer'

export function readHiddenKeys(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(HIDDEN_STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter(k => typeof k === 'string').slice(0, 500) : [])
  } catch {
    return new Set()
  }
}

export function writeHiddenKeys(storage, keys) {
  try {
    storage?.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(Array.from(keys).slice(0, 500)))
  } catch { /* ignore */ }
}

export function readLayerOn(storage) {
  try {
    return storage?.getItem(LAYER_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeLayerOn(storage, on) {
  try {
    storage?.setItem(LAYER_STORAGE_KEY, on ? 'on' : 'off')
  } catch { /* ignore */ }
}

// ป้ายชื่อจุดต้นทาง (ฟาร์ม) ที่แสดงค้างบนแผนที่ — ค่าเริ่มต้น = เปิด เพราะบนมือถือไม่มี hover
// ถ้าไม่แสดงค้างจะไม่มีทางเห็นชื่อฟาร์มจากแผนที่เลย (ต้องกดทีละจุด) · ปิดได้เมื่อป้ายแน่นหรือบังภาพ
export const NAMES_STORAGE_KEY = 'dc-adhoc-zones-names'

export function readNamesOn(storage) {
  try {
    return storage?.getItem(NAMES_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeNamesOn(storage, on) {
  try {
    storage?.setItem(NAMES_STORAGE_KEY, on ? 'on' : 'off')
  } catch { /* ignore */ }
}

// ป้ายชื่อ "สถานที่" (วัด โรงเรียน ร้านอาหาร ฯลฯ จากศูนย์ข้อมูล) — ค่าเริ่มต้น = ปิด ต่างจากป้ายชื่อฟาร์มข้างบน
// เพราะฟาร์มมีไม่กี่จุดและชื่อคือสิ่งที่อยากเห็น แต่สถานที่มีเป็นสิบเป็นร้อย เปิดให้เองแล้วป้ายจะทับกันจนอ่านไม่ออก
// และหน้าแผนที่ที่ประชาชนเคยเห็นจะเปลี่ยนหน้าตาไปเอง · คนที่อยากเห็นกดเปิดเอง เครื่องนั้นจำค่าไว้ (เป็นค่าส่วนตัว)
export const PLACE_NAMES_STORAGE_KEY = 'dc-map-place-names'

export function readPlaceNamesOn(storage) {
  try {
    return storage?.getItem(PLACE_NAMES_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function writePlaceNamesOn(storage, on) {
  try {
    storage?.setItem(PLACE_NAMES_STORAGE_KEY, on ? 'on' : 'off')
  } catch { /* ignore */ }
}

// หมุดไหนติดป้ายชื่อค้างได้ — เฉพาะ "สถานที่" ที่เจ้าหน้าที่กรอกเองในศูนย์ข้อมูล (data_center_entries)
//  - ไม่ติดคำร้อง/คำขอ: ชื่อของมันคือหัวเรื่องที่ประชาชนพิมพ์เอง ซึ่งการ์ดรายละเอียดจงใจไม่แสดง (PDPA) ป้ายค้างบนแผนที่ยิ่งไม่ควรหลุด
//  - ไม่ติดเส้นทางถนน (ไม่ใช่หมุด) และกลุ่ม "ปุ่มลอยบนแผนที่" (กล้องวงจรปิดมีเป็นสิบตัวชื่อซ้ำๆ ติดป้ายแล้วแผนที่รก)
// isFloat ส่งจากผู้เรียก เพราะค่าคงที่ชื่อกลุ่มปุ่มลอยอยู่ในคอมโพเนนต์ ไม่ได้อยู่ในไฟล์นี้
export function canShowPlaceName(entry, isFloat) {
  if (entry?.source_table !== 'data_center_entries') return false
  if (entry.route_points?.length >= 2) return false
  return !isFloat
}

// ── หน้าแรกของแผนที่ฝั่งประชาชน (เจ้าของสั่ง 2569-10-15: ทำให้ประชาชนไม่ต้องถามว่า "หมุดอยู่ไหน") ──
// ปัญหาจริงที่วัดบน namlao มือถือ: เปิดมาหมุด 0 อัน (ทุกประเภทเริ่มปิด) และพอเปิดครบ 17 หมุดจมใต้แผงล่างถึง 11 อัน
// (แผงล่างกิน ~55% ของจอและศูนย์กลางแผนที่ = ศูนย์กลางเทศบาลอยู่ใต้แผงพอดี)
//
// เปิดทุกประเภทให้เองเฉพาะ "หน้าประชาชน" และเฉพาะเมื่อหมุดสถานที่ไม่มากจนรก — อปท. ที่ข้อมูลเยอะกว่าเพดานนี้ยังเริ่มปิดเหมือนเดิม
// (ไปใช้ข้อความชี้ให้กดประเภทแทน) · หน้าเจ้าหน้าที่ไม่ใช้กฎนี้ (เคยชินกับของเดิม + โหมดเฉพาะกิจต้องคงหน้าตาเริ่มต้นไว้)
// เพดาน 60: ตอนวัด namlao 20 · thungkaew 14 · demo 5 — ค่านี้ไม่ใช่ข้อกำหนด ปรับได้ที่เดียวตรงนี้
export const PUBLIC_AUTO_OPEN_MAX_PINS = 60

// hasFocus = กระโดดมาจากปุ่ม "ดูบนแผนที่" ซึ่งต้องเปิดเฉพาะประเภทเป้าหมาย (ห้ามเปิดทุกประเภทแทน)
export function shouldAutoOpenCategories({ isPublic, hasFocus, pinCount, max = PUBLIC_AUTO_OPEN_MAX_PINS }) {
  return Boolean(isPublic) && !hasFocus && Number(pinCount) > 0 && Number(pinCount) <= max
}

// ระยะเผื่อของ fitBounds บนแผนที่ที่มีแผงลอยบังด้านล่าง (px) — base เท่าเดิมของ LeafletMapCanvas (40)
// sheetRect = กรอบแผงล่างตอนนี้ (null ถ้าไม่มี/ซ่อนอยู่ เช่นจอ PC) · เผื่อเฉพาะส่วนที่แผงทับแผนที่จริง
// และกันไม่ให้พื้นที่ที่เหลือมองเห็นต่ำกว่า MIN_VISIBLE (จอเตี้ยมากๆ ถ้าเผื่อเต็มจะไม่เหลือที่ให้ซูม)
export const FIT_BASE_PADDING = 40
const FIT_MIN_VISIBLE_HEIGHT = 140

export function fitPaddingFor(mapRect, sheetRect, base = FIT_BASE_PADDING) {
  const padding = { top: base, right: base, bottom: base, left: base }
  if (!mapRect || !sheetRect) return padding
  const mapHeight = Number(mapRect.bottom) - Number(mapRect.top)
  const covered = Number(mapRect.bottom) - Number(sheetRect.top)
  if (!Number.isFinite(mapHeight) || !Number.isFinite(covered) || covered <= 0) return padding
  const maxInset = Math.max(0, mapHeight - FIT_MIN_VISIBLE_HEIGHT - base * 2)
  padding.bottom = base + Math.round(Math.min(covered, maxInset))
  return padding
}

// ── ค้นหาสถานที่บนแผนที่ + ปุ่ม "ตำแหน่งของฉัน" (เฟส B ของงาน "ให้ประชาชนไม่ต้องถามเรื่องแผนที่", เจ้าของสั่ง 2569-10-15) ──
// ค้นเฉพาะ "สถานที่" ที่เจ้าหน้าที่กรอกในศูนย์ข้อมูล (data_center_entries) ที่โหลดมาอยู่แล้ว — ไม่ยิงคำขอเพิ่ม ไม่เพิ่มงานเจ้าหน้าที่
//  - ไม่ค้นคำร้อง/คำขอ: ชื่อของมันคือหัวเรื่องที่ประชาชนพิมพ์เอง (PDPA) · ไม่ค้นเส้นทางถนน (ไม่ใช่จุด)
//  - ไม่ค้นกลุ่ม "ปุ่มลอยบนแผนที่" (กล้องวงจรปิดมีเป็นสิบตัวชื่อซ้ำๆ + คุมด้วยปุ่มลอยของมันเอง) — isFloat ส่งจากผู้เรียกเพราะค่าคงที่ชื่อกลุ่มอยู่ในคอมโพเนนต์
// พิมพ์หลายคำได้ (ต้องเจอครบทุกคำ) และค้นได้ทั้งชื่อ ประเภท และกลุ่ม — พิมพ์ "วัด" แล้วขึ้นวัดทุกแห่งได้เลย (คนส่วนใหญ่ไม่รู้ชื่อเป๊ะ)
// ลำดับ: ชื่อขึ้นต้นด้วยคำที่พิมพ์ → ชื่อมีคำนั้น → ตรงที่ประเภท/กลุ่มเท่านั้น แล้วเรียงตามชื่อแบบไทย
const hasCoord = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value))
const searchNorm = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

export function searchPlaces(entries, query, { limit = 8, titleOf = e => e?.title ?? e?.name ?? '', isFloat = () => false } = {}) {
  const tokens = searchNorm(query).split(' ').filter(Boolean)
  if (tokens.length === 0 || !Array.isArray(entries)) return []
  const scored = []
  for (const entry of entries) {
    if (entry?.source_table !== 'data_center_entries') continue
    if (entry.route_points?.length >= 2 || isFloat(entry)) continue
    // Number(null) = 0 จะผ่านเป็นพิกัด (0,0) เงียบๆ — ต้องกัน null/ว่างก่อนแปลง
    if (!hasCoord(entry.latitude) || !hasCoord(entry.longitude)) continue
    const title = searchNorm(titleOf(entry))
    if (!title) continue
    const haystack = `${title} ${searchNorm(entry.category)} ${searchNorm(entry.group_name)}`
    if (!tokens.every(token => haystack.includes(token))) continue
    const rank = title.startsWith(tokens[0]) && tokens.every(token => title.includes(token)) ? 0 : tokens.every(token => title.includes(token)) ? 1 : 2
    scored.push({ entry, rank, title })
  }
  scored.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title, 'th'))
  return scored.slice(0, Math.max(0, limit)).map(item => item.entry)
}

// ระยะทางตามผิวโลก (กม.) — ใช้เช็กว่าตำแหน่งของผู้ใช้อยู่ในย่านเทศบาลไหม
export function distanceKm(a, b) {
  const lat1 = Number(a?.lat), lng1 = Number(a?.lng), lat2 = Number(b?.lat), lng2 = Number(b?.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity
  const rad = deg => (deg * Math.PI) / 180
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// ตำแหน่งของผู้ใช้ที่ห่างจากศูนย์กลางเทศบาลเกินนี้ (กม.) จะไม่เลื่อนแผนที่ตามไป — ไม่งั้นกดปุ่มจากต่างจังหวัดแล้วแผนที่หนีไปครึ่งประเทศ
// ผู้ใช้เห็นข้อความบอกเหตุผลแทน · เทศบาลตำบลกว้างไม่เกินสิบกิโลเมตร จึงเผื่อไว้ 30
export const LOCATE_MAX_DISTANCE_KM = 30

export function geolocationErrorMessage(code) {
  if (code === 1) return 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งของเบราว์เซอร์แล้วลองใหม่'
  if (code === 3) return 'หาตำแหน่งไม่ทันเวลา — ลองใหม่อีกครั้งในที่โล่ง'
  return 'หาตำแหน่งของคุณไม่ได้ในตอนนี้ — ลองใหม่อีกครั้ง'
}

// เลื่อนละติจูดของจุดที่จะบินไปให้ต่ำลง px พิกเซลบนหน้าจอ (ที่ระดับซูมนั้น) — มือถือมีแผงล่างทับครึ่งล่างของแผนที่
// จุดกลางแผนที่อยู่ใต้แผง จึงต้องให้กล้องเล็งต่ำกว่าจุดเป้าหมาย จุดเป้าหมายจะได้ขึ้นมาอยู่ในส่วนบนที่ไม่ถูกบัง (กติกาเดียวกับ focusZone)
export function latShiftForPixels(latitude, zoom, px) {
  const lat = Number(latitude), z = Number(zoom), pixels = Number(px)
  if (![lat, z, pixels].every(Number.isFinite) || pixels <= 0) return 0
  const metersPerPx = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
  return (pixels * metersPerPx) / 111320
}

// ── ขอบเขตของ "เรื่องเฉพาะกิจ" บนแผนที่ (เจ้าของสั่ง 2569-10-15: แยกเรื่องใครเรื่องมัน + เป็นของ อปท. ที่เปิดหมวดนี้เท่านั้น) ──
// ทุกอย่างของเรื่องเฉพาะกิจ (ตัวกรอง "เฉพาะกิจ", แผงวงรัศมี, วง/หมุดฟาร์ม, ผู้ได้รับผลกระทบ และปุ่มลอยของมัน)
// ต้องโผล่ต่อเมื่อ (1) อปท. นี้มีหมวดคำร้องเฉพาะกิจที่ "เปิดใช้อยู่" และ (2) ผู้ใช้กดตัวกรอง "เฉพาะกิจ" อยู่
// ข้อ (1) อ่านจากข้อมูลหมวด ไม่ผูกชื่อ อปท. ในโค้ด — อปท. ไหนเปิดหมวดกลิ่นเมื่อไรก็ได้ของครบทันทีโดยไม่ต้องแก้โค้ด
// categoryMeta = แผนที่ value → แถวหมวด (โหลดเฉพาะหมวดที่ is_active) ที่ DataCenterMapView ถืออยู่
export function hasAdhocCategory(categoryMeta) {
  return Object.values(categoryMeta ?? {}).some(category => category?.is_adhoc === true)
}

export function adhocScope(statusFilter, categoryMeta) {
  const available = hasAdhocCategory(categoryMeta)
  return { available, active: available && statusFilter === 'adhoc' }
}

// ตัวเลือกของตัวกรองสถานะ — ซ่อนชิป "เฉพาะกิจ" ใน อปท. ที่ไม่มีหมวดนี้ (กดแล้วไม่มีอะไรให้ดู มีแต่ทำให้งง)
export function visibleStatusOptions(options, adhocAvailable) {
  return (Array.isArray(options) ? options : []).filter(option => adhocAvailable || option?.value !== 'adhoc')
}

// ── ตัวกรองสถานะของแผนที่ศูนย์ข้อมูล (ย้ายมาจาก DataCenterMapView.jsx เพื่อให้เทสต์ล็อกกฎได้) ─────────────
// สถานะจริงในตาราง complaints ใช้ทั้ง 'closed' และ 'done' แทนความหมาย "เสร็จสิ้น"
export const COMPLETED_COMPLAINT_STATUSES = ['closed', 'done']
// ตาราง civil_projects ใช้ status = 'completed' แทนความหมาย "จบงาน"
export const COMPLETED_PROJECT_STATUSES = ['completed']

// คำร้องหมวดเฉพาะกิจ (complaint_categories.is_adhoc, เช่น odor) ไม่เคยเปลี่ยน status ออกจาก 'pending'
// เลย เพราะข้าม status pipeline ปกติทั้งหมด (ใช้ extra_data.acknowledged_at ของตัวเองแทน) — ถ้ากรองด้วย
// เสร็จสิ้นแล้ว/กำลังดำเนินการแบบเดิม จะไม่มีวันขึ้นแท็บ "เสร็จสิ้นแล้ว" แม้จะรับทราบ/จัดการแล้ว
// จึงแยกเป็นแท็บของตัวเอง ไม่ยุ่งกับ completed/in_progress เลย โชว์ทุกเรื่องเฉพาะกิจไม่ว่า status จะเป็นอะไร
export function isAdhocEntry(entry, categoryMeta) {
  return entry?.source_table === 'complaints' && !!categoryMeta?.[entry.category]?.is_adhoc
}

// ใช้กรองเฉพาะแถวจากตาราง complaints/civil_projects เท่านั้น — แหล่งข้อมูลอื่น (data_center_entries ฯลฯ)
// ไม่มีแนวคิด "เสร็จสิ้น/กำลังดำเนินการ" แบบนี้ จึงไม่ถูกกรองด้วยตัวเลือกนี้
//
// โหมด 'adhoc' = คำร้องเฉพาะกิจ + หมุดสถานที่ในศูนย์ข้อมูล (วัด โรงเรียน ฯลฯ) เพื่อให้เปิดดูสถานที่รอบฟาร์มได้
// (เจ้าของสั่ง 2569-10-14) — หมุดสถานที่ผ่านมาถึงตัวกรองชั้นถัดไป ซึ่งเริ่มต้น "ปิด" ทุกประเภทอยู่แล้ว (activeCategories ว่าง)
// หน้าตาเริ่มต้นของโหมดนี้จึงไม่เปลี่ยน · คำร้องที่ไม่ใช่เฉพาะกิจและโครงการยังถูกตัดออกเหมือนเดิม
export function matchesStatusFilter(entry, statusFilter, categoryMeta) {
  if (statusFilter === 'adhoc') return isAdhocEntry(entry, categoryMeta) || entry?.source_table === 'data_center_entries'
  if (statusFilter === 'all') return true
  // แท็บเสร็จสิ้นแล้ว/กำลังดำเนินการ ตัดหมวดเฉพาะกิจออกเสมอ — status ของมันไม่เคยขยับตาม pipeline ปกติ
  // เข้าไปอยู่ผิดที่ผิดทาง (ค้างเป็น "กำลังดำเนินการ" ตลอดกาล) ไปดูที่แท็บ "เฉพาะกิจ" แทน
  if (isAdhocEntry(entry, categoryMeta)) return false
  if (entry.source_table !== 'complaints' && entry.source_table !== 'civil_projects') return true
  const completedSet = entry.source_table === 'complaints' ? COMPLETED_COMPLAINT_STATUSES : COMPLETED_PROJECT_STATUSES
  const isCompleted = completedSet.includes(entry.status)
  return statusFilter === 'completed' ? isCompleted : !isCompleted
}
