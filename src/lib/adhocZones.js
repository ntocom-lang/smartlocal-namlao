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
