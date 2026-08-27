// ช่วงเวลาของวันสำหรับหมวดเฉพาะกิจ "กลิ่นเหม็นรบกวน" — ใช้ร่วมกันระหว่างฟอร์มประชาชน (CitizenForm)
// และตารางของแอดมิน/เจ้าหน้าที่ (OdorComplaintTable) ให้ตัวเลือกกับตัวกรองเป็นชุดเดียวกันเสมอ
// วางไว้ใน lib (ไม่ใช่ไฟล์ component) เพราะ react-refresh ห้ามไฟล์ component export ค่าที่ไม่ใช่ component
//
// จงใจเก็บเป็น "ช่วงเวลา" ไม่ใช่ timestamp ละเอียด — ข้อมูลที่เจ้าหน้าที่ใช้จริงคือ "ควรไปดมช่วงไหน"
// ส่วนวันเวลาที่แจ้งมี complaints.created_at อยู่แล้ว เก็บวันเวลาที่พบกลิ่นซ้ำอีกช่องไม่ได้เพิ่มอะไร
const ODOR_TIME_RANGES = [
  { value: 'dawn',      label: 'เช้ามืด (00:01–06:00)',     from: 0,  to: 6 },
  { value: 'morning',   label: 'เช้า (06:01–12:00)',        from: 6,  to: 12 },
  { value: 'afternoon', label: 'บ่าย (12:01–18:00)',        from: 12, to: 18 },
  { value: 'evening',   label: 'ค่ำ/กลางคืน (18:01–24:00)', from: 18, to: 24 },
]

function odorTimeRangeOf(dateStr) {
  if (!dateStr) return null
  const h = new Date(dateStr).getHours()
  return ODOR_TIME_RANGES.find((r) => h >= r.from && h < r.to)?.value ?? null
}

// ช่วงเวลาที่ได้กลิ่นของคำร้องหนึ่ง — ใช้ค่าที่ประชาชนเลือกไว้ก่อน ถ้าไม่มี (คำร้องเก่าที่แจ้งก่อนมีช่องนี้)
// ค่อยเดาจากเวลาที่แจ้ง เพื่อให้ตัวกรองไม่กลายเป็นช่องว่างย้อนหลัง
function odorIncidentRangeOf(complaint) {
  return complaint?.extra_data?.odor_time_range || odorTimeRangeOf(complaint?.created_at)
}

// ป้ายภาษาไทยของช่วงเวลา ใช้ตอนแสดงผลในบ็อปอัพรายละเอียด
function odorTimeRangeLabel(value) {
  return ODOR_TIME_RANGES.find((r) => r.value === value)?.label ?? null
}

export { ODOR_TIME_RANGES, odorTimeRangeOf, odorIncidentRangeOf, odorTimeRangeLabel }
