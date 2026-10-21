// ลิงก์ตรงไปยัง "ไฟล์ภาพผังต้นฉบับ" รายตำบลบนเว็บศูนย์บริหารจัดการทรัพยากรน้ำจังหวัดแพร่ (อบจ.แพร่)
// ปุ่ม "ดูผังต้นฉบับ" ใช้ที่นี่ — ประชาชนกดแล้วเห็นผังตำบลของตัวเองเลย ไม่ต้องไปหาในหน้ารวมของทั้งจังหวัด
// (หน้ารวม map_water_r.php เปิดผังตำบลด้วย pop-up ที่ไม่มีที่อยู่เฉพาะ จึงลิงก์ลงตำบลไม่ได้ ต้องลิงก์ที่ไฟล์ภาพ)
//
// ⚠️ ชื่อไฟล์มีเวลาที่อัปโหลดฝังอยู่ (<เลขสุ่ม><YYYYMMDD>_<HHMMSS>.jpg) — ถ้า อบจ. อัปโหลดผังใหม่ ชื่อจะเปลี่ยน
// ลิงก์เดิมอาจเป็น 404 ทั้งที่หน้ารวมยังใช้ได้ วิธีหาชื่อใหม่ดู docs/water-diagram.md · ตำบลที่ไม่มีแถวที่นี่ใช้ลิงก์หน้ารวมแทน
// ตรวจเมื่อ 2026-10-21: ทั้ง 3 ไฟล์ตอบ 200 เป็นภาพ JPEG และวันที่ไฟล์ (Last-Modified) ตรงกับ date ด้านล่าง
//
// date = วันที่ในชื่อไฟล์ (ค.ศ.) — เทสต์บังคับให้ตรงกับวันที่ผังที่เราประกาศบนหน้า (sourceDate / sources[].date)
export const ORIGINAL_FILE_BASE = 'https://www.phraepao.go.th/officechief/water/upload_diagram_subd/'

export const ORIGINAL_DIAGRAM_FILES = {
  thungkaew: { file: '66598230820240509_181654.jpg', date: '2024-05-09' },
  tamnaktham: { file: '82389834520240509_182321.jpg', date: '2024-05-09' },
  namlao: { file: '171202098020240430_133004.jpg', date: '2024-04-30' },
}

/** ลิงก์ของผังตำบล id นี้ · ไม่มีไฟล์ที่ลงทะเบียนไว้ = คืน fallbackUrl (ลิงก์หน้ารวมของจังหวัด) */
export function originalDiagramUrl(id, fallbackUrl) {
  if (!Object.hasOwn(ORIGINAL_DIAGRAM_FILES, id || '')) return fallbackUrl
  return `${ORIGINAL_FILE_BASE}${ORIGINAL_DIAGRAM_FILES[id].file}`
}
