// ตัวช่วยของทะเบียนผู้ขายน้ำมัน ใช้ร่วมกันระหว่างหน้าตั้งค่าผู้ขายกับฟอร์มบันทึกเชื้อเพลิง
// (แยกออกจากไฟล์คอมโพเนนต์เพราะ react-refresh ไม่ให้ไฟล์คอมโพเนนต์ export อย่างอื่นปนมา)

// เลขผู้เสียภาษีบนใบกำกับภาษีพิมพ์เว้นวรรค/ขีดคั่นมาหลายแบบ เก็บลง DB เป็นตัวเลขล้วน
// (constraint ฝั่ง DB บังคับ 13 หลักพอดี) ไม่งั้นผู้ขายรายเดียวกันจะซ้ำเพราะรูปแบบต่างกัน
export function normalizeTaxId(value) {
  return String(value ?? '').replace(/\D/g, '')
}

// ป้ายชื่อผู้ขายที่ใช้ทั้งใน dropdown และบนเอกสารที่พิมพ์ — ต้องเป็นข้อความเดียวกันทุกที่
// ไม่งั้นเจ้าหน้าที่เทียบกับใบกำกับภาษีแล้วสับสนว่าเป็นคนละราย
export function vendorLabel(vendor) {
  if (!vendor) return ''
  const name = String(vendor.name ?? '').trim()
  const branch = String(vendor.branch ?? '').trim()
  if (!name) return ''
  return branch ? `${name} (สาขา ${branch})` : name
}
