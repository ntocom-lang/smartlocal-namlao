// แผ่น "ภาพประกอบคำร้อง" ต่อท้ายใบคำร้อง — เจ้าของระบบสั่ง 2569-10-22 (ซ่อมแซมถนนทางการเกษตร:
// เจ้าหน้าที่ต้องใช้ภาพแนบใบคำร้องเป็นหลักฐานประกอบการเบิก)
//
// ตั้งใจให้เป็น "แผ่นแยก" ต่อจากใบเดิม ไม่ยัดรูปลงหน้าเดียวกัน: ใบเดิมใช้พื้นที่ 208–242 มม. จาก 276 มม.
// (วัดจริง 2569-10-22) รูป 2 ภาพต้องการราว 62 มม. จึงดันบล็อกลงนามล้นไปหน้า 2
//
// ฟังก์ชันในไฟล์นี้เป็น pure (ไม่แตะเครือข่าย/DOM) รับรูปที่โหลดเสร็จแล้วจาก printPhotos.js
//   รูปแต่ละใบ = { src: 'data:image/…', width, height } หรือ { src: null } เมื่อโหลดไม่สำเร็จ
// ⚠️ รูปที่โหลดไม่ได้ต้องพิมพ์เป็นกรอบ "โหลดภาพนี้ไม่สำเร็จ" ห้ามตัดทิ้งเงียบๆ — เอกสารประกอบการเบิกที่ภาพขาด
//    โดยที่คนพิมพ์ไม่รู้ตัวแย่กว่ากรอบแจ้งตรงๆ ให้พิมพ์ซ้ำ
// หมวดที่ไม่มีรูปเลย (เช่น ยังไม่มีภาพหลังดำเนินการ) ไม่พิมพ์ทั้งหัวข้อ — เจ้าของระบบสั่ง 2569-10-22 หลังเห็นใบจริง
//    (ต่างจาก "รูปที่มีแต่โหลดไม่ได้" ซึ่งยังพิมพ์เป็นกรอบแจ้ง เพราะมีรูปอยู่จริงแต่ขาดไป)
//
// เลย์เอาต์ภาพ: "แถวตามสัดส่วนจริงของแต่ละภาพ" (เจ้าของระบบเลือก 2569-10-22 หลังเห็นใบจริงมีแถบขาวข้างภาพแนวตั้ง)
//   เดิมวางทุกภาพในกรอบ 4:3 ตายตัว → ภาพที่ถ่ายตั้งแนวตั้งเหลือแถบว่างสองข้าง และเล็กลงเหลือ ~29 มม.
//   กรอบขนาดตายตัวทำให้ "ภาพเต็มกรอบโดยไม่ตัดภาพ" ไม่ได้ ถ้าสัดส่วนไม่ตรง — จึงให้กรอบตามภาพแทน:
//   ทุกภาพในแถวสูงเท่ากัน กว้างตามสัดส่วนจริง เติมเต็มความกว้างแถว ไม่ครอบตัด (ห้ามใช้ cover: ภาพแนวตั้งโดนตัดบน-ล่าง
//   ราวครึ่งหนึ่ง ส่วนถนนที่ชำรุดซึ่งเป็นหลักฐานอยู่ท้ายภาพมักหาย)

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// จำนวนภาพต่อแถว: 3 ภาพเรียงแถวเดียว (ก่อน 3 + หลัง 3 ต้องจบแผ่นเดียว — ฟอร์มประชาชนจำกัด 3 รูป)
// ที่เหลือใช้ 2 ภาพต่อแถวให้ภาพใหญ่ขึ้น และเลี่ยงภาพโดดเดี่ยว 1 ใบท้ายแถว (4 ภาพ = 2×2)
export function photoSheetColumns(count) {
  return count === 3 || count >= 5 ? 3 : 2
}

const ROW_GAP_MM = 5
// เพดานความสูงแถว: ภาพเดี่ยวหรือคู่ภาพแนวตั้งถ้าปล่อยเต็มความกว้าง 160 มม. จะสูงเกิน 120 มม. ดันแผ่นล้นหน้า
// 85 มม. = ภาพแนวตั้งก่อน 2 + หลัง 2 ยังจบแผ่นเดียว (วัดจริง ดู tests/complaint-photo-sheet.test.mjs)
export const PHOTO_ROW_MAX_HEIGHT_MM = 85
// รูปที่ไม่รู้ขนาด (โหลดไม่ได้ / อ่านขนาดไม่ได้) ใช้สัดส่วนกรอบเดิม 4:3
const FALLBACK_ASPECT = 4 / 3

export function photoAspect(photo) {
  const width = Number(photo?.width)
  const height = Number(photo?.height)
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : FALLBACK_ASPECT
}

export function complaintPhotoSheetCss() {
  return `
  .photo-sheet { break-before: page; page-break-before: always; }
  .photo-sheet .ps-title { text-align: center; font-weight: 700; }
  .photo-sheet .ps-meta { margin-top: 2px; }
  .photo-sheet h2 { font-size: inherit; font-weight: 700; margin: 12px 0 5px; break-after: avoid; page-break-after: avoid; }
  /* แถวไม่ถูกฉีกครึ่งข้ามหน้า · ความกว้างแถวถูกจำกัดที่ inline (เพดานความสูง) ภาพที่ไม่เต็มความกว้างชิดซ้าย */
  .photo-sheet .ps-row { display: flex; gap: ${ROW_GAP_MM}mm; break-inside: avoid; page-break-inside: avoid; }
  .photo-sheet .ps-row + .ps-row { margin-top: 3mm; }
  .photo-sheet figure { margin: 0; min-width: 0; }
  /* กรอบ = สัดส่วนจริงของภาพ (aspect-ratio inline) จึงไม่มีแถบว่าง · outline แทน border เพื่อไม่ให้ขอบกินสัดส่วนกรอบ */
  .photo-sheet .ps-row img { display: block; width: 100%; height: auto; object-fit: contain; outline: 0.3mm solid #888; }
  /* 11pt โดยตั้งใจ — คำบรรยายใต้ภาพเป็นข้อความประกอบ ไม่ใช่เนื้อความ (ขนาดเดียวกับบล็อกเลขอ้างอิงมุมกระดาษของใบคำร้อง) */
  .photo-sheet figcaption { text-align: center; font-size: 11pt; line-height: 1.3; margin-top: 1mm; }
  .photo-sheet .ps-failed { text-align: center; font-size: 11pt; line-height: 1.3; padding: 0 3mm; border: 0.3mm dashed #888; width: 100%; aspect-ratio: 4 / 3; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
  .photo-sheet .ps-origin { margin-top: 8px; text-align: center; font-size: 11pt; }
`
}

function figureHtml(photo, number, kind) {
  const caption = `ภาพที่ ${number}`
  const aspect = photoAspect(photo).toFixed(4)
  const frame = photo?.src
    ? `<img src="${esc(photo.src)}" alt="${caption} (${kind})" style="aspect-ratio:${aspect};">`
    : `<div class="ps-failed">โหลดภาพนี้ไม่สำเร็จ — กรุณาพิมพ์ใหม่อีกครั้ง</div>`
  // flex-grow ∝ สัดส่วนภาพ + flex-basis 0 → ความกว้างภาพแปรผันตามสัดส่วน ทุกภาพในแถวจึงสูงเท่ากัน
  // ⚠️ คูณ 1000: ถ้าผลรวม flex-grow ของแถว < 1 (ภาพแนวตั้งเดี่ยว = 0.75) เบราว์เซอร์แจกพื้นที่ว่างให้ไม่ครบ
  //    ภาพจะกว้างแค่ 75% ของแถวแล้วสูงไม่ถึงเพดาน (เจอจริงตอนทดสอบ) — เลขใหญ่ทำให้ผลรวมเกิน 1 เสมอ
  return `<figure style="flex:${Math.round(photoAspect(photo) * 1000)} 1 0;">${frame}<figcaption>${caption}${photo?.src ? '' : ' (ไม่มีภาพ)'}</figcaption></figure>`
}

function figuresHtml(list, kind) {
  const perRow = photoSheetColumns(list.length)
  const rows = []
  for (let start = 0; start < list.length; start += perRow) rows.push(list.slice(start, start + perRow))
  return rows.map((row, rowIndex) => {
    const aspectSum = row.reduce((sum, photo) => sum + photoAspect(photo), 0)
    const maxWidth = `calc(${PHOTO_ROW_MAX_HEIGHT_MM}mm * ${aspectSum.toFixed(4)} + ${(row.length - 1) * ROW_GAP_MM}mm)`
    const figures = row.map((photo, index) => figureHtml(photo, rowIndex * perRow + index + 1, kind)).join('')
    return `<div class="ps-row" style="max-width:${maxWidth};">${figures}</div>`
  }).join('')
}

function sectionHtml(title, list, kind) {
  if (!list.length) return ''
  return `<h2>${esc(title)} — ${list.length} ภาพ</h2>
  ${figuresHtml(list, kind)}`
}

// coordinates: ข้อความพิกัดที่ใบคำร้องตัดสินแล้ว ('' = ไม่พิมพ์บรรทัดนี้ — สิทธิ์ปิด/ปิดด้วย includeCoordinates)
// place: ชื่อสถานที่/หมู่บ้าน ('' = ไม่พิมพ์บรรทัดนี้)
export function complaintPhotoSheetHtml({ num, thDate, subject, place = '', coordinates = '', originText = '', before = [], after = [] }) {
  return `<section class="photo-sheet">
  <p class="ps-title">ภาพประกอบคำร้อง</p>
  <p class="ps-meta">คำร้องผ่าน E-Service ${esc(num)} ลงวันที่ ${esc(thDate)}</p>
  <p class="ps-meta">เรื่อง &nbsp;${esc(subject)}</p>
  ${place ? `<p class="ps-meta">สถานที่ &nbsp;${esc(place)}</p>` : ''}
  ${coordinates ? `<p class="ps-meta">พิกัด &nbsp;${esc(coordinates)}</p>` : ''}
  ${sectionHtml('ภาพก่อนดำเนินการ (ภาพจากผู้แจ้ง)', before, 'ก่อนดำเนินการ')}
  ${sectionHtml('ภาพหลังดำเนินการ (ภาพจากเจ้าหน้าที่)', after, 'หลังดำเนินการ')}
  ${originText ? `<p class="ps-origin">${esc(originText)}</p>` : ''}
</section>`
}
