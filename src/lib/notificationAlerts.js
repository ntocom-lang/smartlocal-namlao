// ข้อความ + การจับ "รายการใหม่" ของกระดิ่งแจ้งเตือนในแอป — ตรรกะล้วน เทสต์ด้วย node (tests/notification-device-prefs.test.mjs)
//
// ใช้ร่วมกันระหว่างหน้ารายการแจ้งเตือน (NotificationsPage) กับป๊อปอัป/เสียง/สั่นตอนมีรายการใหม่ (NotificationsContext)
// ป๊อปอัปไม่ใส่ชื่อหมวด — ขึ้นกลางจอโดยไม่มีใครกด คนข้างๆ เห็นได้ (เรื่องลับอย่างทุจริตต้องไม่โผล่เอง)

export const CITIZEN_STATUS_MSG = {
  received:    'เจ้าหน้าที่รับเรื่องของคุณแล้ว',
  in_progress: 'เจ้าหน้าที่อยู่ระหว่างดำเนินการ',
  done:        'เจ้าหน้าที่ดำเนินการเสร็จแล้ว 🎉',
  completed:   'เจ้าหน้าที่ดำเนินการเสร็จแล้ว 🎉',
  closed:      'ดำเนินการแล้ว ✅ ถ้ายังไม่เรียบร้อยแจ้งกลับได้ภายใน 7 วัน',
  rejected:    'ขออภัย คำร้องของคุณถูกปฏิเสธ',
}

export const STAFF_STATUS_MSG = {
  new:         'มีคำร้องใหม่รอรับเรื่อง',
  pending:     'มีคำร้องใหม่รอรับเรื่อง',
  received:    'งานรอเริ่มดำเนินการ',
  in_progress: 'งานกำลังดำเนินการ',
  done:        'ดำเนินการแล้ว',
  completed:   'ดำเนินการแล้ว',
}

// ป๊อปอัปครั้งละไม่เกินนี้ — คำร้องเข้ามาพร้อมกันหลายเรื่องดูรวมในกระดิ่ง ไม่ให้กล่องท่วมจอ
export const MAX_ALERTS_AT_ONCE = 2
// รายการที่ "เพิ่งเปลี่ยน" ต้องอัปเดตไม่เก่ากว่ารอบดึงก่อนหน้าเกินนี้ — กันของเก่าที่หลุดเข้ามาในรายการ 50 อันดับแรก
// เด้งเป็นของใหม่ · เผื่อไว้ 5 นาทีเพราะนาฬิกาเครื่องเจ้าหน้าที่อาจเดินไม่ตรงกับเวลาในฐานข้อมูล
const FRESH_SLACK_MS = 5 * 60 * 1000

export const notificationKey = (item) => `${item.id}_${item.status}`

/** เลขที่แบบเดียวกับที่หน้ารายการแจ้งเตือนแสดง: ปี พ.ศ. 2 หลัก + เดือน + ลำดับ 3 หลัก */
export function complaintShortRef(item) {
  if (!item?.complaint_number) return null
  const created = new Date(item.created_at)
  const yy = String(created.getFullYear() + 543).slice(-2)
  const mm = String(created.getMonth() + 1).padStart(2, '0')
  return `${yy}${mm}${String(item.complaint_number).padStart(3, '0')}`
}

/**
 * รายการที่ต้องเด้งเตือน = มีในรอบดึงนี้แต่ไม่มีในรอบก่อน + ยังไม่อ่าน + เพิ่งอัปเดต
 * previous = null คือรอบแรกหลังเปิดหน้า/เปลี่ยนบัญชี — ไม่เด้ง (ของค้างเดิมดูในกระดิ่ง ไม่ใช่ของใหม่)
 */
export function freshUnreadItems(previous, items, { readKeys = new Set(), clearedAt = 0 } = {}) {
  if (!previous) return []
  return items.filter((item) => {
    const key = notificationKey(item)
    if (previous.keys.has(key) || readKeys.has(key)) return false
    const updatedAt = Date.parse(item.updated_at)
    return Number.isFinite(updatedAt) && updatedAt > clearedAt && updatedAt >= previous.at - FRESH_SLACK_MS
  })
}

export function alertText(item, audience) {
  // งานหมวดอื่น (ฟีดงานของฉัน) ประกอบข้อความไว้แล้วใน notificationFeed.js — ไม่มีชื่อคน/รายละเอียด
  if (item?._kind && item._kind !== 'complaint') return { title: item.title, body: item.body }
  const messages = audience === 'staff' ? STAFF_STATUS_MSG : CITIZEN_STATUS_MSG
  const ref = complaintShortRef(item)
  return {
    title: messages[item.status] ?? (audience === 'staff' ? 'มีความเคลื่อนไหวในคำร้อง' : 'คำร้องของคุณมีความคืบหน้า'),
    body: ref ? `คำร้องเลขที่ ${ref}` : 'แตะเปิดดูเพื่อดูรายละเอียด',
  }
}
