// ทะเบียนข้อมูลผังรายตำบล (ข้อมูลล้วน ไม่มีตรรกะ) — ตรรกะอยู่ model.js · ใครเห็นผังไหนอยู่ที่ WATER_DIAGRAM_TENANTS ใน model.js
// เพิ่มผังใหม่: ไฟล์ข้อมูลใหม่ 1 ไฟล์ + 1 บรรทัดที่นี่ + 1 แถวใน WATER_DIAGRAM_TENANTS (ดู docs/water-diagram.md)
import { THUNGKAEW_DIAGRAM } from './thungkaew.js'
import { TAMNAKTHAM_DIAGRAM } from './tamnaktham.js'

export const DIAGRAMS = {
  [THUNGKAEW_DIAGRAM.id]: THUNGKAEW_DIAGRAM,
  [TAMNAKTHAM_DIAGRAM.id]: TAMNAKTHAM_DIAGRAM,
}

export function diagramById(id) {
  return Object.hasOwn(DIAGRAMS, id || '') ? DIAGRAMS[id] : null
}
