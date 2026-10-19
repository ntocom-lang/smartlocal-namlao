// QR code เป็นเวกเตอร์ SVG (ไม่ใช่ภาพ data-URL) — ใช้ร่วมกันทั้งภาพอินโฟกราฟิกและใบ A4 ของสรุปเรื่องร้องเรียนรายเดือน
//
// ทำไมเวกเตอร์ + ทำงานแบบ sync: ตัววาดภาพ (buildInfographicSvg) เป็นฟังก์ชันสตริงล้วน รันใน node เทสต์ได้
// ถ้าใช้ QRCode.toDataURL (async) ต้องเปลี่ยนตัววาดทั้งตัวเป็น async ทั้งที่ข้อมูลมีอยู่ในมือแล้ว
// QRCode.create() คืนเมทริกซ์ตรงๆ จึงวาดเป็น path ได้เองและพิมพ์คมที่ทุกขนาด
//
// ไฟล์นี้ต้องไม่แตะ DOM — ข้อความที่เข้ารหัสเป็นลิงก์สาธารณะของ อปท. เท่านั้น (ไม่มีข้อมูลส่วนบุคคล)

import { create } from 'qrcode'

/** ขอบสงบ (quiet zone) ที่มาตรฐาน QR กำหนดอย่างน้อย 4 โมดูล — น้อยกว่านี้เครื่องสแกนบางรุ่นอ่านไม่ออก */
export const QUIET_MODULES = 4

/**
 * @param {string} text
 * @param {number} targetSide ด้านของกรอบรวมขอบสงบ (px) ที่อยากได้ — ผลจริงอาจเล็กลงเล็กน้อย
 * @returns {{ d: string, size: number, module: number, side: number } | null} null = เข้ารหัสไม่ได้ (ข้อความว่าง/ยาวเกิน)
 *   module เป็นจำนวนเต็มเสมอ: ขอบโมดูลที่ตกกลางพิกเซลทำให้ภาพ PNG ซีดเป็นเส้นเทา เครื่องสแกนอ่านยากขึ้น
 */
export function qrLayout(text, targetSide) {
  const value = String(text ?? '').trim()
  if (!value) return null
  let matrix
  try {
    // ระดับแก้ไขข้อผิดพลาด M (~15%): ภาพถูกบีบอัดผ่าน LINE/Facebook แล้วยังสแกนได้ และโมดูลไม่ถี่เกินไปบนกระดาษ
    matrix = create(value, { errorCorrectionLevel: 'M' }).modules
  } catch {
    return null
  }
  const size = matrix.size
  const module = Math.floor(targetSide / (size + QUIET_MODULES * 2))
  if (module < 1) return null

  // รวมโมดูลดำที่ติดกันในแถวเดียวเป็นเส้นเดียว (h{ยาว}) — path สั้นลงหลายเท่า และไม่มีรอยต่อระหว่างโมดูล
  const runs = []
  for (let row = 0; row < size; row += 1) {
    let col = 0
    while (col < size) {
      if (!matrix.get(row, col)) { col += 1; continue }
      const start = col
      while (col < size && matrix.get(row, col)) col += 1
      runs.push(`M${start} ${row}h${col - start}v1h-${col - start}z`)
    }
  }
  return { d: runs.join(''), size, module, side: module * (size + QUIET_MODULES * 2) }
}
