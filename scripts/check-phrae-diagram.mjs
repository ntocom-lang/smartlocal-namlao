// ตรวจว่า "ผังน้ำ" ต้นฉบับของศูนย์บริหารจัดการน้ำจังหวัดแพร่ที่ระบบ "ระบบน้ำของตำบล" ถอดข้อมูลไว้ ยังเป็นไฟล์เดิมหรือไม่
//   npm run check:phrae-diagram        (มือ · อ่านอย่างเดียว · ยิง ~5 คำขอไปที่ phraepao.go.th)
// ถ้าศูนย์ฯ อัปโหลดผังใหม่ ชื่อไฟล์ผังตำบลจะเปลี่ยน (มีเวลาอัปโหลดอยู่ในชื่อ) และผังจังหวัดจะเปลี่ยน ETag/ขนาด/วันที่แก้ —
// เมื่อเจอ ให้เปิดผังใหม่เทียบกับทะเบียน src/lib/waterSystem/ แล้วถอดซ้ำ (ดู docs/water-system.md หัวข้อ "ผังต้นฉบับเปลี่ยน")
// ค่าที่คาดหวังจดไว้เมื่อ 2569-10-18 — แก้ตารางด้านล่างเมื่อถอดผังใหม่แล้ว
import process from 'node:process'

const BASE = 'https://www.phraepao.go.th/officechief/water/'
const UA = { 'User-Agent': 'Mozilla/5.0 (SmartLocal diagram check)' }

// ไฟล์ที่ใช้ถอด — id ตรงกับ sources ในทะเบียนรายตำบล
const FILES = [
  { id: 'province', name: 'ผังน้ำจังหวัดแพร่', path: 'img/map-water1.jpg', lastModified: 'Fri, 08 Aug 2025 08:45:20 GMT', etag: '"546a22c6408dc1:0"', length: 10465970 },
  { id: 'namlao', name: 'ผังน้ำตำบลน้ำเลา', path: 'upload_diagram_subd/171202098020240430_133004.jpg', lastModified: 'Tue, 30 Apr 2024 06:30:04 GMT', etag: '"0befad5c79ada1:0"', length: 766810 },
  { id: 'banwiang', name: 'ผังน้ำตำบลบ้านเวียง', path: 'upload_diagram_subd/209891918320240430_134701.jpg', lastModified: 'Tue, 30 Apr 2024 06:47:01 GMT', etag: '"80a02834ca9ada1:0"', length: 552145 },
  { id: 'maelai', name: 'ผังน้ำตำบลแม่หล่าย', path: 'upload_diagram_subd/51079892120240509_005055.jpg', lastModified: 'Wed, 08 May 2024 17:50:55 GMT', etag: '"80a9604670a1da1:0"', length: 422445 },
]

// หน้ารายการผังระดับตำบล: ชื่อตำบล → ไฟล์ปัจจุบัน (ถ้าศูนย์ฯ เปลี่ยนไฟล์ ชื่อไฟล์ในแถวนี้จะเปลี่ยน)
const TAMBON_ROWS = [
  { tambon: 'ตำบลน้ำเลา', file: '171202098020240430_133004.jpg' },
  { tambon: 'ตำบลบ้านเวียง', file: '209891918320240430_134701.jpg' },
  { tambon: 'ตำบลแม่หล่าย', file: '51079892120240509_005055.jpg' },
]

const problems = []
const note = (ok, text) => { console.log(`${ok ? '✓' : '✗'} ${text}`); if (!ok) problems.push(text) }

for (const file of FILES) {
  try {
    const response = await fetch(BASE + file.path, { method: 'HEAD', headers: UA })
    if (!response.ok) { note(false, `${file.name}: ตอบ ${response.status} (ไฟล์ถูกย้าย/ลบ?)`); continue }
    const lastModified = response.headers.get('last-modified')
    const etag = response.headers.get('etag')
    const length = Number(response.headers.get('content-length'))
    const same = lastModified === file.lastModified && etag === file.etag && length === file.length
    note(same, same ? `${file.name}: ไฟล์เดิม (${file.lastModified})` : `${file.name}: ไฟล์เปลี่ยน — วันที่แก้ ${lastModified} (เดิม ${file.lastModified}) · ขนาด ${length} (เดิม ${file.length})`)
  } catch (error) {
    note(false, `${file.name}: ติดต่อต้นทางไม่ได้ (${error.message})`)
  }
}

try {
  const html = await (await fetch(BASE + 'view_diagram_district.php', { headers: UA })).text()
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1])
  for (const expected of TAMBON_ROWS) {
    const row = rows.find(r => r.includes(expected.tambon) || r.replace(/<[^>]+>/g, ' ').includes(expected.tambon))
    const current = row && /downloadimg\.php\?file=([^"'&\s]+)/.exec(row)?.[1]
    note(current === expected.file, current === expected.file
      ? `${expected.tambon}: ใช้ไฟล์เดิมในหน้ารายการ`
      : `${expected.tambon}: ไฟล์ในหน้ารายการเปลี่ยนเป็น ${current ?? '(ไม่พบแถว)'} (เดิม ${expected.file})`)
  }
} catch (error) {
  note(false, `หน้ารายการผังตำบล: ติดต่อต้นทางไม่ได้ (${error.message})`)
}

if (problems.length) {
  console.log(`\n⚠️ พบความเปลี่ยนแปลง/ปัญหา ${problems.length} ข้อ — เปิดผังใหม่เทียบกับทะเบียน src/lib/waterSystem/ แล้วถอดซ้ำ (docs/water-system.md)`)
  process.exit(1)
}
console.log('\n✅ ผังต้นฉบับยังเป็นไฟล์เดิมทั้งหมด')
