// ขอบเขตตำบลของ อปท. (public/boundaries/<slug>.geojson) + ตรวจว่าหมุดอยู่ในเขตหรือไม่
//
// ใช้เตือนประชาชนเมื่อปักหมุดนอกเขต (เจ้าของระบบอนุมัติแนวทาง "เตือนอย่างเดียว ไม่บล็อก" 2569-10-20)
// ทำงานในเครื่องผู้ใช้ทั้งหมด — พิกัดที่ผู้ใช้เลือกไม่ถูกส่งไปไหนและไม่ถูกบันทึก (PDPA ไม่เพิ่มความเสี่ยง)
//
// ⚠️ ไฟล์ขอบเขตเป็นแนวอ้างอิงเชิงภูมิสารสนเทศ (ชุด OCHA ต้นทางกรมแผนที่ทหาร) ไม่ใช่แนวเขตตามประกาศจัดตั้ง อปท.
//    ซึ่งเป็นตัวที่มีผลทางกฎหมาย ผลจากไฟล์นี้จึงใช้ได้แค่ "เตือน" ห้ามใช้ปฏิเสธคำขอหรือตัดสินสิทธิ์ใดๆ
//    และข้อความที่แสดงผู้ใช้ต้องใช้คำว่า "ดูเหมือน" ไม่ยืนยันว่านอกเขตจริง
//
// ทุกกรณีที่ตรวจไม่ได้ (ไม่มีไฟล์ · โหลดไม่สำเร็จ · รูปแบบไม่ถูก · พิกัดเสีย) คืน null = "ไม่รู้" ผู้เรียกต้องถือว่า
// ไม่ต้องเตือน — ตรวจพลาดแล้วเตือนมั่วแย่กว่าไม่เตือน เพราะประชาชนจะเลิกเชื่อคำเตือนทุกครั้ง

/**
 * หมุดที่อยู่นอกเส้นไม่เกินระยะนี้ไม่เตือน — เป็นสมมติฐาน (ไม่ได้วัดจากข้อมูลจริง) ที่รองรับ 2 อย่าง:
 * แนวเส้นในชุดข้อมูลอ้างอิงอาจเหลื่อมจากแนวจริง และ GPS มือถือคลาดเคลื่อนได้หลายสิบเมตร
 * ปรับได้ที่นี่ที่เดียว
 */
export const OUTSIDE_TOLERANCE_M = 300

// เมตรต่อ 1 องศา = รัศมีเฉลี่ยโลก 6,371 กม. × π / 180 (ผิดไม่เกิน ~0.5% ที่ละติจูดไทย ซึ่งพอสำหรับคำว่า "ประมาณ")
const M_PER_DEG = 111_195

/** @type {Map<string, Promise<object|null>>} */
const cache = new Map()

/** ดึงรายการ polygon (แต่ละอันคือรายการวง [lng,lat][]) ออกจาก GeoJSON ทุกรูปแบบที่ใช้จริง; ไม่มีรูปที่ใช้ได้ = null */
function polygonsOf(geojson) {
  const geometries = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'FeatureCollection') node.features?.forEach(walk)
    else if (node.type === 'Feature') walk(node.geometry)
    else if (node.type === 'Polygon' || node.type === 'MultiPolygon') geometries.push(node)
  }
  walk(geojson)

  const polygons = []
  for (const g of geometries) {
    const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    if (!Array.isArray(list)) continue
    for (const rings of list) {
      if (!Array.isArray(rings)) continue
      const clean = rings.filter(r => Array.isArray(r) && r.length >= 4)
      if (clean.length) polygons.push(clean)
    }
  }
  return polygons.length ? polygons : null
}

/**
 * โหลดไฟล์ขอบเขตของ อปท. ตาม slug (จำผลไว้ ไม่ยิงซ้ำ)
 *
 * Cloudflare ตอบ index.html กลับมาพร้อม HTTP 200 เมื่อไม่มีไฟล์ (SPA fallback) จึงดูแค่ res.ok ไม่พอ —
 * ต้องแปลง JSON ได้และมีรูปที่ใช้ได้จริงด้วย ไม่งั้นถือว่าไม่มีขอบเขต
 * @param {string|undefined|null} slug
 * @returns {Promise<object|null>}
 */
export function loadTenantBoundary(slug) {
  const key = String(slug ?? '').trim()
  // slug ไปต่อเป็น path — รับเฉพาะรูปแบบ slug จริงเพื่อไม่ให้ค่าแปลกปลอม (../ ฯลฯ) หลุดเข้าไปในคำขอ
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(key)) return Promise.resolve(null)

  if (!cache.has(key)) {
    cache.set(key, fetch(`/boundaries/${key}.geojson`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => (polygonsOf(data) ? data : null))
      .catch(() => {
        // ล้มเพราะเครือข่าย/แปลงไม่ได้ — ไม่จำความล้มเหลว เปิดแผนที่ครั้งหน้าลองใหม่ได้
        cache.delete(key)
        return null
      }))
  }
  return cache.get(key)
}

/** จุดอยู่ในรูป polygon หรือไม่ — นับการตัดเส้นรังสีแบบ even-odd ข้ามทุกวง วงนอกกับรูโหว่จึงทำงานถูกพร้อมกัน */
function insidePolygon(lng, lat, rings) {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** ระยะ (เมตร) จากจุดถึงเส้นขอบที่ใกล้ที่สุดของทุก polygon */
function nearestEdgeDistanceM(lng, lat, polygons) {
  const kx = Math.cos((lat * Math.PI) / 180) * M_PER_DEG
  let best = Infinity
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        // ย้ายจุดไปเป็นจุดกำเนิด แล้วแปลงองศาเป็นเมตรรอบละติจูดของจุดนั้น (พอสำหรับระยะระดับตำบล และเป็นค่าประมาณสำหรับระยะไกล)
        const ax = (ring[j][0] - lng) * kx
        const ay = (ring[j][1] - lat) * M_PER_DEG
        const bx = (ring[i][0] - lng) * kx
        const by = (ring[i][1] - lat) * M_PER_DEG
        const dx = bx - ax
        const dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
        const d = Math.hypot(ax + t * dx, ay + t * dy)
        if (d < best) best = d
      }
    }
  }
  return best
}

/**
 * ประเมินหมุดเทียบกับขอบเขต
 * @param {{lat: number|string, lng: number|string}} point
 * @param {object|null|undefined} geojson
 * @param {number} [toleranceM]
 * @returns {{inside: boolean, distanceM: number, warn: boolean} | null} null = ประเมินไม่ได้ (ถือว่าไม่ต้องเตือน)
 *   distanceM = 0 เมื่ออยู่ในเขต · warn = นอกเขตและห่างเส้นเกิน toleranceM
 */
export function evaluatePoint(point, geojson, toleranceM = OUTSIDE_TOLERANCE_M) {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const polygons = polygonsOf(geojson)
  if (!polygons) return null

  const inside = polygons.some(rings => insidePolygon(lng, lat, rings))
  const distanceM = inside ? 0 : nearestEdgeDistanceM(lng, lat, polygons)
  return { inside, distanceM, warn: !inside && distanceM > toleranceM }
}

/** ระยะเป็นข้อความอ่านง่ายสำหรับแสดงผู้ใช้ — ปัดให้สมกับคำว่า "ประมาณ" ไม่โชว์เลขละเอียดเกินจริง */
export function describeDistance(meters) {
  const m = Number(meters)
  if (!Number.isFinite(m) || m < 0) return ''
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} เมตร`
  const km = m / 1000
  return km < 10 ? `${km.toFixed(1)} กม.` : `${Math.round(km).toLocaleString('th-TH')} กม.`
}
