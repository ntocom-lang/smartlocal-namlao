// ค้นหา/แปลงพิกัดเป็นที่อยู่ด้วย OpenStreetMap Nominatim — ฟรี ไม่ต้องใช้ API key
// ใช้แทน Google Places Autocomplete + Geocoding ที่ถอดออกไปแล้ว
//
// ⚠️ ข้อจำกัดของ Nominatim สาธารณะที่ต้องรู้ (nominatim.org/release-docs/latest/api/Faq)
//   - เพดานจริงคือ 1 request/วินาที ต่อ IP และ "ห้าม" ยิงแบบ autocomplete ทุกตัวอักษร
//     โค้ดที่เรียกต้องให้ผู้ใช้กดค้นหาเอง หรือ debounce อย่างต่ำ ~800ms เสมอ
//   - ระบุตัวตนแอปทาง Referer (เบราว์เซอร์ส่งให้เอง) ตั้ง User-Agent จากฝั่ง JS ไม่ได้
//     เพราะเป็น forbidden header name — fetch จะเมินทิ้งเงียบๆ ไม่ต้องพยายามใส่
//   - ถ้าโดน rate limit จะได้ HTTP 429 ให้ถือว่า "ไม่พบผล" ไม่ใช่ error ที่ต้องเด้งใส่ผู้ใช้
//   ถ้าวันหนึ่งผู้ใช้เยอะจนโดนบล็อก IP ทางออกที่ยังฟรีคือ self-host Nominatim หรือ Photon
//   (ทั้งคู่ open-source) ไม่ใช่ย้ายกลับไป Google ที่คิดเงินต่อ request

const BASE = 'https://nominatim.openstreetmap.org'
const COMMON = 'format=json&accept-language=th'

/**
 * ค้นหาสถานที่ในประเทศไทย
 * @param {string} query คำค้น
 * @param {{ signal?: AbortSignal, limit?: number }} [opts]
 * @returns {Promise<Array<{ lat: number, lng: number, label: string, shortLabel: string }>>}
 *          คืน [] เสมอเมื่อค้นไม่เจอ/เน็ตล่ม/โดน rate limit — ผู้เรียกไม่ต้อง try/catch ซ้ำ
 */
export async function searchPlaces(query, { signal, limit = 5 } = {}) {
  const q = String(query ?? '').trim()
  if (!q) return []

  try {
    const res = await fetch(
      `${BASE}/search?${COMMON}&q=${encodeURIComponent(q)}&countrycodes=th&limit=${limit}`,
      { signal }
    )
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []

    // กรองแถวที่พิกัดใช้ไม่ได้ทิ้ง ไม่งั้น map.setView([NaN, NaN]) จะทำแผนที่ค้างทั้งจอ
    return data
      .map(item => ({
        lat: Number(item.lat),
        lng: Number(item.lon),
        label: item.display_name || q,
        shortLabel: item.display_name?.split(',')[0]?.trim() || q,
      }))
      .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
  } catch (err) {
    // AbortError = ผู้ใช้พิมพ์คำใหม่ทับ ไม่ใช่ความผิดพลาด ไม่ต้องรก console
    if (err?.name !== 'AbortError') console.warn('[nominatim] search failed:', err)
    return []
  }
}

/**
 * แปลงพิกัดเป็นที่อยู่ภาษาไทย
 * @returns {Promise<string>} คืน '' เมื่อหาไม่ได้
 */
export async function reverseGeocode(lat, lng, { signal } = {}) {
  const latNum = Number(lat)
  const lngNum = Number(lng)
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return ''

  try {
    const res = await fetch(
      `${BASE}/reverse?${COMMON}&lat=${latNum}&lon=${lngNum}&zoom=18&addressdetails=1`,
      { signal }
    )
    if (!res.ok) return ''
    const data = await res.json()
    return data?.display_name || ''
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('[nominatim] reverse failed:', err)
    return ''
  }
}
