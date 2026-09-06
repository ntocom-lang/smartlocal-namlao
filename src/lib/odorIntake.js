// "ระบบรับเรื่องแล้วเมื่อไหร่" ของคำร้องหมวดเฉพาะกิจ — ใช้ร่วมทุกหน้าที่แสดงสถานะหมวดนี้
// (MyComplaints ฝั่งประชาชน, ตารางแอดมิน/ผู้รับผิดชอบ, บ็อปอัพรายละเอียด, หมุดแผนที่ผู้บริหาร)
//
// เดิมสายงานนี้ให้ผู้รับผิดชอบกดปุ่ม "รับทราบ" เอง แล้วเก็บ extra_data.acknowledged_at/by
// ตอนนี้ระบบรับเรื่องให้อัตโนมัติตั้งแต่ยื่น (trigger route_adhoc_complaint ใน
// supabase/migrations/20260908100000_odor_auto_route.sql) เก็บที่ extra_data.routed_at
//
// ⚠️ ทำไมไม่เขียนทับ acknowledged_at ให้เป็นคีย์เดียวจบ
//   acknowledged_by คือหลักฐานว่า "คนไหนรับเรื่องนี้ไปดำเนินการ" ถ้าระบบเขียนแทน = ประชาชนเห็นว่า
//   มีเจ้าหน้าที่รับทราบทั้งที่ไม่มีใครเปิดดู และเวลาสอบข้อเท็จจริงจะมีหลักฐานชี้ไปที่คนที่ไม่เกี่ยว
//   คีย์เก่าจึงคงไว้ตามเดิมสำหรับเรื่องที่เคยมีคนกดจริง แค่เลิกใช้เป็นสถานะหลัก
//
// ลำดับที่ใช้: routed_at → acknowledged_at (คำร้องที่เคยมีคนกดจริงในสายงานเก่า)
//
// ⚠️ fallbackToCreated ต้องเปิดเฉพาะที่ "รู้แน่แล้วว่าคำร้องนี้เป็นหมวดเฉพาะกิจ" เท่านั้น
//   คีย์ทั้งสองตัวมีเฉพาะหมวดเฉพาะกิจ หน้าที่แสดงคำร้องคละหมวด (MyComplaints ของประชาชน) จึงใช้
//   "การมีคีย์อยู่" เป็นตัวแยกว่าแถวไหนเป็นหมวดเฉพาะกิจ โดยไม่ต้อง query complaint_categories เพิ่ม
//   ถ้าเผลอ fallback ไป created_at ที่นั่น คำร้องหมวดปกติทุกใบจะขึ้นป้าย "ระบบรับเรื่องแล้ว" ทั้งที่
//   ยังรอแอดมินกดรับเรื่องอยู่จริง = โกหกประชาชนตรงๆ
//   ส่วนหน้าที่มีแต่คำร้อง odor (ตาราง/บ็อปอัพของเจ้าหน้าที่) เปิด fallback ได้ ไว้กันหน้าต่าง deploy
//   ที่บันเดิลใหม่ขึ้นก่อนไมเกรชันหรือ backfill ยังไม่จบ — created_at ก็ยังเป็นคำตอบที่จริงอยู่ดี
function odorRoutedAt(complaint, { fallbackToCreated = false } = {}) {
  const raw = complaint?.extra_data?.routed_at
    ?? complaint?.extra_data?.acknowledged_at
    ?? (fallbackToCreated ? complaint?.created_at : null)
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

// แถวนี้เป็นคำร้องหมวดเฉพาะกิจหรือไม่ — ใช้ในหน้าที่แสดงคำร้องคละหมวดเพื่อซ่อนของที่ใช้ไม่ได้กับ
// สายงานนี้ (แถบความคืบหน้า 5 ขั้น และตัวนับ SLA) โดยไม่ต้อง query complaint_categories เพิ่ม
//
// ⚠️ ทำไมของพวกนั้นต้องซ่อน: หมวดเฉพาะกิจ "ไม่แตะ complaints.status เลย" ตลอดสายงาน
//   - แถบความคืบหน้า: จะค้างที่ "คำร้องใหม่" ตลอดกาล อีก 4 ขั้นไม่มีวันสว่าง แม้เจ้าหน้าที่จะ
//     ลงพื้นที่จัดการจบไปแล้ว และยังขัดกับป้าย "ระบบรับเรื่องแล้ว" ที่อยู่เหนือมันเอง
//   - ตัวนับ SLA: SlaBadge คืน null เฉพาะตอน status เป็น done/closed/rejected ซึ่งหมวดนี้ไม่มี
//     วันไปถึง พ้นกำหนดเมื่อไหร่ป้ายจะพลิกเป็น "เกินกำหนด N วันทำการ" แล้วนับขึ้นไม่มีวันหยุด
//     = ระบบของ อปท. ประกาศต่อประชาชนเองว่าตัวเองทำงานเกินกำหนด บนเรื่องที่ออกแบบมาไม่มีขั้นปิด
function isAdhocComplaint(complaint) {
  return odorRoutedAt(complaint) != null
}

// ข้อความสถานะมาตรฐาน — รวมไว้ที่เดียวเพราะเคยแก้ป้ายทำนองนี้แล้วตกหล่นหน้าใดหน้าหนึ่งมาแล้ว
const ODOR_INTAKE_LABEL = 'ระบบรับเรื่องแล้ว'

// ใช้กับหน้าที่แสดงเฉพาะคำร้อง odor เท่านั้น (เปิด fallback ให้ในตัว)
function odorIntakeText(complaint, { withTime = true } = {}) {
  const at = odorRoutedAt(complaint, { fallbackToCreated: true })
  if (!at || !withTime) return ODOR_INTAKE_LABEL
  return `${ODOR_INTAKE_LABEL} · ${at.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}`
}

export { odorRoutedAt, isAdhocComplaint, odorIntakeText, ODOR_INTAKE_LABEL }
