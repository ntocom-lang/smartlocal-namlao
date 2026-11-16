// ชนิดรูปทรงของรายการในศูนย์รวมข้อมูลดิจิทัล: 'point' (หมุด) | 'line' (เส้นทาง) | 'polygon' (พื้นที่ระบายสี)
// ใช้ฟังก์ชันนี้ทุกจุดที่ต้องแยก "พื้นที่" ออกจาก "เส้นทาง" — ห้ามเช็ค route_points เองทีละที่
//
// คอลัมน์ shape เพิ่มทีหลัง (migration 20261130100000): แถวเดิมเป็น NULL ⇒ อนุมานแบบเดียวกับ SQL
// route_points เป็น array ≥2 จุด = 'line' นอกนั้น 'point' · ก่อนรัน SQL หน้าเว็บยังไม่มี shape ก็ใช้ได้ (ได้ผลเท่าเดิม)
// polygon ต้องมีอย่างน้อย 3 จุด ไม่งั้นวาดพื้นที่ไม่ได้ ⇒ ถอยเป็น line (≥2) หรือ point

export const POLYGON_MIN_POINTS = 3

export function entryShape(entry) {
  const pts = Array.isArray(entry?.route_points) ? entry.route_points.length : 0
  const shape = entry?.shape
  if (shape === 'polygon') {
    if (pts >= POLYGON_MIN_POINTS) return 'polygon'
    return pts >= 2 ? 'line' : 'point'
  }
  if (shape === 'line') return pts >= 2 ? 'line' : 'point'
  if (shape === 'point') return 'point'
  // ไม่มี shape (แถวเดิม) หรือค่าแปลก → อนุมานจากจุดเส้นทาง
  return pts >= 2 ? 'line' : 'point'
}
