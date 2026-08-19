// ปีงบประมาณราชการไทย: 1 ต.ค. – 30 ก.ย. เรียกชื่อปีตามปีปฏิทินที่ปีงบ "สิ้นสุด" (พ.ศ.)
// เช่น ต.ค. 2568 – ก.ย. 2569 (ค.ศ. 2025–2026) เรียกว่า "ปีงบประมาณ 2569"
// ใช้ร่วมกันทุกจุดที่อ้างอิงปีงบ (FleetVehicleDetail, FleetSetup งบประมาณ, FleetDashboard)
// เพื่อไม่ให้แต่ละหน้าคำนวณเองแล้วเพี้ยนไม่ตรงกัน

// พ.ศ. ของปีงบ จากวันที่ที่กำหนด (ปีปฏิทิน ค.ศ. + 543 ของปีที่ปีงบสิ้นสุด)
export function fiscalYearOf(date = new Date()) {
  const y = date.getFullYear()
  const startCalendarYear = date.getMonth() >= 9 ? y : y - 1 // ต.ค. = getMonth() index 9
  return startCalendarYear + 1 + 543
}

// ช่วงวันที่ ต.ค.–ก.ย. ของปีงบที่ครอบคลุมวันที่ที่กำหนด
export function fiscalYearRange(date = new Date()) {
  const y = date.getFullYear()
  const startCalendarYear = date.getMonth() >= 9 ? y : y - 1
  const from = new Date(startCalendarYear, 9, 1)
  const to   = new Date(startCalendarYear + 1, 8, 30, 23, 59, 59)
  return { from, to, fiscalYearBE: startCalendarYear + 1 + 543 }
}

// เดือนเรียงตามปีงบ (ต.ค.→ก.ย.) พร้อมเลขเดือนปฏิทินจริง (1-12) กำกับแต่ละอัน — ใช้แสดง
// หัวตาราง/กราฟรายเดือนให้ตรงลำดับที่ อปท. คุ้นเคย ไม่ใช่ ม.ค.→ธ.ค. แบบปีปฏิทิน
export const FISCAL_MONTHS_TH = [
  { label: 'ต.ค.',  month: 10 }, { label: 'พ.ย.', month: 11 }, { label: 'ธ.ค.', month: 12 },
  { label: 'ม.ค.',  month: 1 },  { label: 'ก.พ.', month: 2 },  { label: 'มี.ค.', month: 3 },
  { label: 'เม.ย.', month: 4 },  { label: 'พ.ค.', month: 5 },  { label: 'มิ.ย.', month: 6 },
  { label: 'ก.ค.',  month: 7 },  { label: 'ส.ค.', month: 8 },  { label: 'ก.ย.', month: 9 },
]
