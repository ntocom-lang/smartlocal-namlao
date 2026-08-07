import addressData from '@riz007/thai-address-data/data.json'

// ข้อมูลจังหวัด/อำเภอ/ตำบลทั้งประเทศ (77 จังหวัด, 7,436 รายการ) จาก @riz007/thai-address-data
// (MIT, ที่มาจาก thailand-geography-json ฐานข้อมูลอ้างอิงที่ใช้กันแพร่หลายในวงการนักพัฒนาไทย)
// ใช้ทำ dropdown เลือกที่อยู่แบบลำดับชั้น (จังหวัด → อำเภอ → ตำบล) กันผู้ใช้พิมพ์ชื่อผิด/ไม่ตรงชื่อ
// ทางการ (ตรวจแล้ว เช่น อำเภอเมืองแพร่ ชื่อทางการคือ "เมืองแพร่" ไม่ใช่แค่ "เมือง" ที่คนมักพิมพ์กัน)
//
// ไม่มี "หมู่ที่" ในชุดข้อมูลนี้ (กรมการปกครองไม่ได้แยกเป็นทางการระดับนี้ ผูกกับพื้นที่จริงมากกว่าชื่อ)
// ต้องให้ผู้ใช้กรอกเป็นตัวเลขแยกต่างหากเสมอ

export const THAI_PROVINCES = [...new Set(addressData.map((r) => r.province))].sort((a, b) => a.localeCompare(b, 'th'))

export function thaiDistrictsOf(province) {
  if (!province) return []
  return [...new Set(addressData.filter((r) => r.province === province).map((r) => r.district))].sort((a, b) => a.localeCompare(b, 'th'))
}

export function thaiSubdistrictsOf(province, district) {
  if (!province || !district) return []
  return addressData
    .filter((r) => r.province === province && r.district === district)
    .map((r) => r.subdistrict)
    .sort((a, b) => a.localeCompare(b, 'th'))
}
