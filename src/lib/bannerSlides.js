// เลือกว่าแบนเนอร์ใบไหนควรมี <img> อยู่ใน DOM ตอนนี้
//
// เดิม BannerSlider ใส่ <img> ของทุกใบลงหน้าแรกพร้อมกัน ใบที่ไม่ได้แสดงแค่ตั้ง opacity 0
// เบราว์เซอร์จึงโหลดครบทุกใบตั้งแต่เปิดเว็บ แบนเนอร์น้ำเลาที่เปิดใช้งาน 6 ใบรวม ~10.7 MB (ไฟล์ PNG
// ใหญ่สุด 4.72 MB) ต่อการเปิดหน้าแรก 1 ครั้ง ทำให้ Cached Egress ของ Supabase ทะลุโควตาแผนฟรี 5 GB
// ภายในรอบบิลเดียว (2026-10-04 ทั้งโปรเจกต์ติด 402) — ตัวเลขนี้คือข้อสันนิษฐานจากโค้ดกับขนาดไฟล์
// ยังไม่ได้ยืนยันด้วย log การเข้าถึงจริง
//
// กติกา: โหลดใบที่กำลังแสดง + ใบถัดไป (เตรียมไว้ให้สไลด์ต่อได้เนียน) + ใบที่เคยแสดงมาแล้ว
// ใบที่ยังไม่ถึงคิวไม่โหลด ผู้ใช้ที่เปิดแล้วออกเลยจึงโหลดแค่ 2 ใบแทนทั้งชุด
export function slideIndexesToLoad(count, active, seen = []) {
  const loaded = new Set()
  if (!Number.isInteger(count) || count <= 0) return loaded
  const current = Number.isInteger(active) ? ((active % count) + count) % count : 0
  loaded.add(current)
  loaded.add((current + 1) % count)
  for (const i of seen) {
    if (Number.isInteger(i) && i >= 0 && i < count) loaded.add(i)
  }
  return loaded
}
