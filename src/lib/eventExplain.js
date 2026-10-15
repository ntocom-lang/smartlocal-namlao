// คำอธิบาย "ใครเห็น / ใครแก้ได้" ของกิจกรรมในปฏิทิน — ตรรกะล้วน ห้าม import supabase (เทสต์ node import ตรง)
//
// เกิดจากคำถามซ้ำๆ ของเจ้าหน้าที่ที่ลงกิจกรรม: "ติ๊กกลุ่มนี้ใครเห็น" / "ทำไมแก้ไม่ได้" / "ทำไมเปิดไม่ได้"
// หน้าจอเดิมเงียบ (ปุ่มหายเฉยๆ, คำอธิบายอยู่แค่ตอนเอาเมาส์ชี้) ไฟล์นี้เก็บถ้อยคำกับกติกาไว้จุดเดียว
//
// กติกาต้องตรงกับฝั่งเซิร์ฟเวอร์ ถ้าฝั่งนั้นเปลี่ยนต้องแก้ไฟล์นี้ + tests/event-explain.test.mjs ตาม
//   - เปิดรายละเอียด: list_events_for_staff → can_view_detail (migration 20261001120100)
//       สาธารณะ / admin / ผู้ลง / หัวหน้ากองของกิจกรรม / ผู้รับมอบหมาย / บทบาทตรงกับกลุ่มเป้าหมาย
//       คนที่เปิดไม่ได้ยังเห็นแถว (ชื่อ วัน เวลา สถานที่) แค่ถูกตัด description + ไฟล์แนบ + ผู้รับมอบหมาย
//   - แก้/ลบ: policy "staff update events" / "staff delete events" (migration 20260801220558)
//       superadmin / admin ของ อปท. / ผู้ลง (created_by) / หัวหน้ากองของกิจกรรม (can_manage_event_department)
import { audienceMeta } from './personalEvents.js'

const ADMIN_ROLES = ['admin', 'superadmin']

// ต้องเหมือนกันทุกจุดที่ขึ้นปุ่มแก้ไข/ลบ — เดิมเขียนซ้ำ 4 จุดแล้วหลุดกันเอง (หน้าต่างรายละเอียดลืมหัวหน้ากอง
// ทั้งที่ตารางให้) รายการส่วนตัว ("เฉพาะฉัน") โหลดมาเฉพาะของเจ้าของ created_by จึงเป็นเจ้าของเสมอ
export function canEditEvent(ev, role, userId, scope) {
  if (!ev) return false
  if (ADMIN_ROLES.includes(role)) return true
  if (userId && ev.created_by === userId) return true
  if (ev.is_personal === true) return false
  return !!scope?.is_dept_head && !!scope?.department_id && ev.department_id === scope.department_id
}

// บรรทัดเดียวเหนือรายการ — ขึ้นเฉพาะเมื่อมีกิจกรรมที่ผู้ใช้แก้ไม่ได้ (ปุ่มของรายการนั้นหายไป)
export const EDIT_RULE_NOTE =
  'ปุ่มแก้ไข/ลบ มีเฉพาะกิจกรรมที่คุณลงเอง · หัวหน้ากองแก้ไขของกองตนได้ · ผู้ดูแลระบบแก้ได้ทุกรายการ'

// ในหน้าต่างรายละเอียดของกิจกรรมที่แก้ไม่ได้ (ชื่อผู้ลงมีอยู่ในหน้าต่างนั้นแล้ว)
export const EDIT_BLOCKED_NOTE =
  'แก้ไข/ลบกิจกรรมนี้ไม่ได้ — แก้ได้เฉพาะผู้ลงกิจกรรม หัวหน้ากองที่ดูแล หรือผู้ดูแลระบบ'

// กิจกรรมที่เปิดรายละเอียดไม่ได้ (can_view_detail เป็น false) — บอกว่ากลุ่มไหนเปิดได้ จะได้รู้ว่าไปถามใคร
export function lockedDetailNote(ev) {
  const labels = (ev?.audiences ?? [])
    .map((v) => audienceMeta(v)?.label)
    .filter(Boolean)
  return labels.length
    ? `เปิดดูรายละเอียดได้เฉพาะ: ${labels.join(' / ')}`
    : 'เปิดดูรายละเอียดไม่ได้'
}

// ข้อความใต้ปุ่มกลุ่มเป้าหมายในฟอร์ม — เปลี่ยนตามที่ติ๊ก
//   tone: 'none' = ยังไม่เลือก · 'public' = เผยแพร่สาธารณะ · 'internal' = เฉพาะบุคลากรภายใน
const WHO = { staff: 'เจ้าหน้าที่และช่าง' }

export function audienceHint(audiences) {
  const list = Array.isArray(audiences) ? audiences : []
  if (list.length === 0) {
    return { tone: 'none', text: 'ยังไม่ได้เลือกกลุ่ม — ต้องเลือกอย่างน้อย 1 กลุ่มจึงจะบันทึกได้' }
  }
  if (list.includes('public')) {
    return {
      tone: 'public',
      text: 'ประชาชนทุกคนเห็นกิจกรรมนี้บนเว็บไซต์ รวมถึงคนที่ยังไม่ล็อกอิน (ทั้งรายละเอียดและไฟล์แนบ) — ห้ามใส่ข้อมูลส่วนบุคคล',
    }
  }
  const who = list.map((v) => WHO[v] ?? audienceMeta(v)?.label).filter(Boolean)
  return {
    tone: 'internal',
    text: `เปิดดูรายละเอียดและไฟล์แนบได้: ${who.join(' / ')} (รวมผู้ลงกิจกรรม หัวหน้ากองที่ดูแล และผู้ดูแลระบบ) · `
      + 'บุคลากรกลุ่มอื่นเห็นแค่ชื่อ วัน เวลา สถานที่ จึงไม่ควรใส่เรื่องที่ไม่อยากให้เพื่อนร่วมงานเห็นไว้ในชื่อกิจกรรม · ประชาชนไม่เห็น',
  }
}
