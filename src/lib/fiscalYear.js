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

// ตัวเลือกปีงบสำหรับหน้ารายงานสาธารณะ (ปีงบปัจจุบัน → ย้อนหลัง) เรียงใหม่→เก่า
// ใช้แทนการไปไล่หาปีที่มีข้อมูลจริงจาก DB เพราะหน้ารายงานต้องแสดงปีงบที่ผู้ตรวจ ITA ขอ
// ได้เสมอแม้ปีนั้นจะยังไม่มีคำร้องสักรายการ (ต้องเห็นเลข 0 ไม่ใช่หาตัวเลือกไม่เจอ)
export function recentFiscalYears(count = 5, date = new Date()) {
  const current = fiscalYearOf(date)
  return Array.from({ length: count }, (_, i) => current - i)
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
// ปีงบ พ.ศ. → วันเริ่ม/สิ้นสุดแบบ YYYY-MM-DD (ไม่ใช้ Date เที่ยงคืน UTC)
export function fiscalYearBounds(fiscalYearBE) {
  const endCE = Number(fiscalYearBE) - 543
  const startCE = endCE - 1
  return {
    fiscalYearBE: Number(fiscalYearBE),
    startCE,
    endCE,
    from: `${startCE}-10-01`,
    to: `${endCE}-09-30`,
  }
}

// ไตรมาสงบประมาณ อปท.: 1=ต.ค.–ธ.ค. 2=ม.ค.–มี.ค. 3=เม.ย.–มิ.ย. 4=ก.ค.–ก.ย.
export const FISCAL_QUARTERS = [
  { value: 1, label: 'ไตรมาส 1 (ต.ค.–ธ.ค.)', short: 'ต.ค.–ธ.ค.' },
  { value: 2, label: 'ไตรมาส 2 (ม.ค.–มี.ค.)', short: 'ม.ค.–มี.ค.' },
  { value: 3, label: 'ไตรมาส 3 (เม.ย.–มิ.ย.)', short: 'เม.ย.–มิ.ย.' },
  { value: 4, label: 'ไตรมาส 4 (ก.ค.–ก.ย.)', short: 'ก.ค.–ก.ย.' },
]

export function fiscalQuarterOf(date = new Date()) {
  const month = date.getMonth() // 0-11
  if (month >= 9) return 1
  if (month <= 2) return 2
  if (month <= 5) return 3
  return 4
}

export function fiscalQuarterBounds(fiscalYearBE, quarter) {
  const { startCE, endCE } = fiscalYearBounds(fiscalYearBE)
  const q = Number(quarter)
  if (q === 1) return { from: `${startCE}-10-01`, to: `${startCE}-12-31` }
  if (q === 2) return { from: `${endCE}-01-01`, to: `${endCE}-03-31` }
  if (q === 3) return { from: `${endCE}-04-01`, to: `${endCE}-06-30` }
  return { from: `${endCE}-07-01`, to: `${endCE}-09-30` }
}

export const FISCAL_MONTHS_TH = [
  { label: 'ต.ค.',  month: 10 }, { label: 'พ.ย.', month: 11 }, { label: 'ธ.ค.', month: 12 },
  { label: 'ม.ค.',  month: 1 },  { label: 'ก.พ.', month: 2 },  { label: 'มี.ค.', month: 3 },
  { label: 'เม.ย.', month: 4 },  { label: 'พ.ค.', month: 5 },  { label: 'มิ.ย.', month: 6 },
  { label: 'ก.ค.',  month: 7 },  { label: 'ส.ค.', month: 8 },  { label: 'ก.ย.', month: 9 },
]
