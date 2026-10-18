// ยอดเงินของบันทึกการเติมน้ำมัน 1 รายการ — จุดเดียวที่ตัดสินว่า "ยอดที่ถูกต้อง" คือเลขไหน
//
// ต้องมีที่เดียวและเรียกใช้ให้ครบทุกจุด (หน้าจอ, สมุดคุม, บันทึกข้อความสรุป, ใบพิมพ์รายการเดี่ยว,
// CSV) ถ้าใครคำนวณเองซ้ำ เอกสารสองใบที่พิมพ์จากข้อมูลชุดเดียวกันจะให้ยอดต่างกัน แล้วผู้ตรวจสอบ
// จะเห็นเป็นการแก้ตัวเลข
//
// ลำดับความน่าเชื่อถือ
//   1. invoice_total — ยอดที่ปั๊มออกบิลจริง เจ้าหน้าที่กรอกจากกระดาษ เชื่อถือได้ที่สุด
//   2. total_cost    — คอลัมน์ GENERATED = round(liters * price_per_liter, 2) ยอดคำนวณย้อน
//   3. liters * price_per_liter — เผื่อกรณีที่ record ถูกประกอบขึ้นเองในฝั่งแอปโดยยังไม่ผ่าน DB
//
// ทำไม invoice_total ต้องมาก่อน: ปั๊มขายเป็นยอดเงิน (สั่งเติมเต็ม 2,000 บาท) ไม่ได้ขายเป็นลิตร
// ลิตรบนบิลจึงเป็นค่าที่ปัดมาแล้ว คูณกลับไม่เท่ายอดจ่ายจริง
// เคสจริง: 50.25 ล. x 39.80 = 1,999.95 แต่บิลออก 2,000.00 (ดู migration 20260908160000)

function finite(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** ยอดเงินที่ต้องใช้แสดงผลและพิมพ์ — คืน null เมื่อไม่มีข้อมูลพอจะบอกยอดได้ */
export function fuelRecordAmount(record) {
  const invoice = finite(record?.invoice_total)
  if (invoice !== null) return invoice

  const stored = finite(record?.total_cost)
  if (stored !== null) return stored

  const liters = finite(record?.liters)
  const price = finite(record?.price_per_liter)
  if (liters === null || price === null) return null
  return Math.round(liters * price * 100) / 100
}

/**
 * ต้องเตือนให้กรอก "ยอดตามบิล" ก่อนบันทึกไหม (เจ้าของระบบสั่ง 2026-10-18)
 * คืนยอดคำนวณ (บาท) เมื่อควรเตือน ไม่งั้น null
 *
 * เงื่อนไข: ยังไม่กรอกยอดตามบิล และยอดคำนวณจากลิตร × ราคา มีเศษสตางค์
 * เคสจริง กค 9700 12 ต.ค. 2569: 34.4 ล. × 43.60 = 1,499.84 แต่จ่ายจริง 1,500 — ไม่ได้กรอกยอดบิล
 * เอกสารเบิกจึงพิมพ์ 1,499.84 ไม่ตรงบิล
 * เติมเต็มถังที่บิลมีเศษสตางค์จริงก็ถูกถามเหมือนกัน — เจ้าหน้าที่กดยืนยันได้ทันที (ระบบไม่เดายอดให้)
 * ยอดคำนวณเป็นจำนวนเต็มบาทไม่ต้องเตือน: ส่วนใหญ่ตรงบิลอยู่แล้ว
 */
export function fuelInvoiceReminder(record) {
  if (finite(record?.invoice_total) !== null) return null
  const liters = finite(record?.liters)
  const price = finite(record?.price_per_liter)
  if (liters === null || price === null || liters <= 0 || price <= 0) return null
  const cents = Math.round(liters * price * 100)
  return cents % 100 === 0 ? null : cents / 100
}

/** true เมื่อยอดบิลที่กรอกไว้ไม่ตรงกับยอดคำนวณ — ใช้ขึ้นหมายเหตุให้เจ้าหน้าที่เห็นว่าตั้งใจต่างกัน */
export function fuelAmountDiffersFromCalc(record) {
  const invoice = finite(record?.invoice_total)
  const stored = finite(record?.total_cost)
  if (invoice === null || stored === null) return false
  return Math.abs(invoice - stored) >= 0.005
}
