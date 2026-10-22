// QR เปิดแผนที่ข้างย่อหน้า "พิกัด" ของใบคำขอในงานบริการประชาชน (ขอเก็บขนขยะ · ขอยกเลิกเก็บขนขยะ · ขอใช้น้ำประปา · เปลี่ยนมาตร · ยกเลิกใช้น้ำ)
//
// เจ้าของระบบสั่ง 2569-10-21: ผู้บริหารที่รับกระดาษต้องสแกนแล้วเปิดแผนที่ได้เลย (ใบเหล่านี้พิมพ์ตัวเลขพิกัดอยู่แล้ว แต่ต้องพิมพ์ลงแอปเอง)
// ใช้ลิงก์รูปแบบเดียวกับใบคำร้อง (councilFormPrint.js, #549) และปุ่ม "เปิดแผนที่" ในหน้าเจ้าหน้าที่ — ไม่ใช้ API/คีย์ ไม่มีค่าใช้จ่าย
// ตัวสร้าง QR คือ qrSvg.js ตัวเดียวกับภาพสรุปเรื่องร้องเรียนรายเดือน (เวกเตอร์ฝังในใบ ไม่โหลดอะไรจากเครือข่าย)
//
// กติกา:
//   - ไม่ได้ปักหมุด / พิกัดผิดรูป (ไม่ใช่ตัวเลข นอกช่วง 0,0) = คืนย่อหน้าเดิมทุกตัวอักษร (ไม่มี QR ไม่มีบรรทัดว่างคาใบ)
//   - ไม่แก้ถ้อยคำของย่อหน้าเดิม — ใบเหล่านี้ลอกจากแบบฟอร์มต้นฉบับ ที่เพิ่มคือ QR + บรรทัดกำกับสั้นๆ ข้างย่อหน้าเท่านั้น
//   - QR วางชิดขวาของย่อหน้า ไม่ใช่ต่อท้ายเป็นบล็อกใหม่: ใบเหล่านี้ต้องจบ 1 แผ่นพร้อมช่องลงนามเจ้าหน้าที่ (npm run test:staff-sign)
//     ที่ว่างที่กินเพิ่มจึงเป็นแค่ส่วนที่ QR สูงกว่าย่อหน้า + ย่อหน้าแคบลงตามความกว้างของ QR ไม่ใช่ความสูงเต็ม QR
//
// ไฟล์นี้ต้องไม่แตะ DOM — เทสต์รันด้วย node

import { QUIET_MODULES, qrLayout } from './qrSvg.js'

export const MAP_QR_HINT = 'สแกนเปิดแผนที่'

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])

/** พิกัดที่ใช้ได้จริง หรือ null — ใช้เกณฑ์เดียวกับใบคำร้อง (ช่วงละติจูด/ลองจิจูด และ 0,0 = ไม่ได้ปัก) */
export function mapPinOf(point) {
  if (point == null || point.lat == null || point.lng == null || point.lat === '' || point.lng === '') return null
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

/** ลิงก์เปิดแผนที่ — รูปแบบเดียวกับใบคำร้องและปุ่มในหน้าเจ้าหน้าที่ (ทศนิยม 6 ตำแหน่ง ≈ 0.1 ม.) */
export function mapLinkOf(pin) {
  return `https://maps.google.com/?q=${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`
}

/** @returns {string} <svg> ของ QR (ดำบนขาว พร้อมขอบสงบ) หรือ '' เมื่อไม่มีพิกัด/สร้างไม่ได้ */
export function mapQrSvg(point) {
  const pin = mapPinOf(point)
  if (!pin) return ''
  const qr = qrLayout(mapLinkOf(pin), 1000) // ด้านจริงกำหนดด้วย CSS (18mm) ตรงนี้ใช้แค่เมทริกซ์
  if (!qr) return ''
  const box = qr.size + QUIET_MODULES * 2
  return `<svg class="map-point__qr" viewBox="0 0 ${box} ${box}" role="img" aria-label="QR code เปิดตำแหน่งในแผนที่"><rect width="${box}" height="${box}" fill="#fff"/><path transform="translate(${QUIET_MODULES} ${QUIET_MODULES})" d="${qr.d}" fill="#000"/></svg>`
}

export function govMapQrCss() {
  return `
    /* QR เปิดแผนที่ชิดขวาข้างย่อหน้าพิกัด (govMapQr.js) — ระยะล่างเท่าย่อหน้าปกติของใบ (4mm · โหมดเจ้าหน้าที่ 3mm)
       ⚠️ QR 18mm + คำกำกับ 8.5pt ใต้ QR (ไม่ใช่บรรทัดคำอธิบายใต้ย่อหน้า): วัดบนใบยกเลิกเก็บขนขยะเคสหนักสุดแล้ว
       บรรทัดคำอธิบายแยกกินที่ว่างก่อนตกหน้า 2 จาก 11mm เหลือ -1mm (ล้น) แบบนี้เหลือ 3mm — ห้ามเพิ่มบรรทัดใต้ย่อหน้า */
    .map-point { display: flex; align-items: center; gap: 3mm; margin: 0 0 4mm; break-inside: avoid; page-break-inside: avoid; }
    .map-point__text { flex: 1 1 auto; min-width: 0; }
    .map-point .map-point__text .point-copy { margin-bottom: 0; }
    .map-point__qr-wrap { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; }
    .map-point__qr { width: 18mm; height: 18mm; }
    .map-point__hint { margin: 0; font-size: 8.5pt; line-height: 1.1; white-space: nowrap; color: #333; }
    .sheet--staff .map-point { margin-bottom: 3mm; }`
}

/**
 * @param {object} args
 * @param {string} args.pointHtml ย่อหน้าพิกัดเดิมของใบ (`<p class="point-copy">…</p>`) — ไม่ถูกแก้
 * @param {{ lat?: unknown, lng?: unknown } | null | undefined} args.point จุดที่ปักหมุด (data.collection_point / data.meter_point)
 * @param {string} [args.hint]
 */
export function govPointWithMapQr({ pointHtml, point, hint = MAP_QR_HINT }) {
  const svg = mapQrSvg(point)
  if (!svg) return pointHtml
  return `<div class="map-point"><div class="map-point__text">${pointHtml}</div><div class="map-point__qr-wrap">${svg}<span class="map-point__hint">${escapeHtml(hint)}</span></div></div>`
}
