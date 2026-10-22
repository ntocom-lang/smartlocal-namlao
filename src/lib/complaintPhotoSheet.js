// แผ่น "ภาพประกอบคำร้อง" ต่อท้ายใบคำร้อง — เจ้าของระบบสั่ง 2569-10-22 (ซ่อมแซมถนนทางการเกษตร:
// เจ้าหน้าที่ต้องใช้ภาพแนบใบคำร้องเป็นหลักฐานประกอบการเบิก)
//
// ตั้งใจให้เป็น "แผ่นแยก" ต่อจากใบเดิม ไม่ยัดรูปลงหน้าเดียวกัน: ใบเดิมใช้พื้นที่ 208–242 มม. จาก 276 มม.
// (วัดจริง 2569-10-22) รูป 2 ภาพต้องการราว 62 มม. จึงดันบล็อกลงนามล้นไปหน้า 2
//
// ฟังก์ชันในไฟล์นี้เป็น pure (ไม่แตะเครือข่าย/DOM) รับรูปที่โหลดเสร็จแล้วจาก printPhotos.js
//   รูปแต่ละใบ = { src: 'data:image/…' } หรือ { src: null } เมื่อโหลดไม่สำเร็จ
// ⚠️ รูปที่โหลดไม่ได้ต้องพิมพ์เป็นกรอบ "โหลดภาพนี้ไม่สำเร็จ" ห้ามตัดทิ้งเงียบๆ — เอกสารประกอบการเบิกที่ภาพขาด
//    โดยที่คนพิมพ์ไม่รู้ตัวแย่กว่ากรอบแจ้งตรงๆ ให้พิมพ์ซ้ำ

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// จำนวนคอลัมน์ต่อหมวด: 3 ภาพเรียงแถวเดียว (ก่อน 3 + หลัง 3 ต้องจบแผ่นเดียว — ฟอร์มประชาชนจำกัด 3 รูป)
// ที่เหลือใช้ 2 คอลัมน์ให้ภาพใหญ่ขึ้น (ภาพละ ~77 มม.) และเลี่ยงภาพโดดเดี่ยว 1 ใบท้ายแถว (4 ภาพ = 2×2)
export function photoSheetColumns(count) {
  return count === 3 || count >= 5 ? 3 : 2
}

export function complaintPhotoSheetCss() {
  return `
  .photo-sheet { break-before: page; page-break-before: always; }
  .photo-sheet .ps-title { text-align: center; font-weight: 700; }
  .photo-sheet .ps-meta { margin-top: 2px; }
  .photo-sheet h2 { font-size: inherit; font-weight: 700; margin: 12px 0 5px; break-after: avoid; page-break-after: avoid; }
  .photo-sheet .ps-grid { display: grid; gap: 5mm; }
  .photo-sheet figure { margin: 0; break-inside: avoid; page-break-inside: avoid; }
  /* object-fit: contain — ไม่ครอบตัดภาพ: ภาพหลักฐานต้องเห็นครบทั้งใบ ภาพแนวตั้งจึงมีขอบข้างตามที่ควรเป็น */
  .photo-sheet .ps-frame { aspect-ratio: 4 / 3; border: 0.3mm solid #888; background: #f4f4f4; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .photo-sheet .ps-frame img { width: 100%; height: 100%; object-fit: contain; display: block; }
  /* 11pt โดยตั้งใจ — คำบรรยายใต้ภาพเป็นข้อความประกอบ ไม่ใช่เนื้อความ (ขนาดเดียวกับบล็อกเลขอ้างอิงมุมกระดาษของใบคำร้อง) */
  .photo-sheet figcaption { text-align: center; font-size: 11pt; line-height: 1.3; margin-top: 1mm; }
  .photo-sheet .ps-failed { text-align: center; font-size: 11pt; line-height: 1.3; padding: 0 3mm; border: 0.3mm dashed #888; width: 100%; height: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
  .photo-sheet .ps-none { margin-top: 2mm; padding: 5mm; border: 0.3mm dashed #999; text-align: center; }
  .photo-sheet .ps-origin { margin-top: 8px; text-align: center; font-size: 11pt; }
`
}

function figuresHtml(list, kind) {
  const cols = photoSheetColumns(list.length)
  const figures = list.map((photo, index) => {
    const caption = `ภาพที่ ${index + 1}`
    const frame = photo?.src
      ? `<div class="ps-frame"><img src="${esc(photo.src)}" alt="${caption} (${kind})"></div>`
      : `<div class="ps-frame"><div class="ps-failed">โหลดภาพนี้ไม่สำเร็จ — กรุณาพิมพ์ใหม่อีกครั้ง</div></div>`
    return `<figure>${frame}<figcaption>${caption}${photo?.src ? '' : ' (ไม่มีภาพ)'}</figcaption></figure>`
  }).join('')
  return `<div class="ps-grid" style="grid-template-columns:repeat(${cols}, 1fr);">${figures}</div>`
}

function sectionHtml(title, list, kind, emptyText) {
  return `<h2>${esc(title)}${list.length ? ` — ${list.length} ภาพ` : ''}</h2>
  ${list.length ? figuresHtml(list, kind) : `<p class="ps-none">${esc(emptyText)}</p>`}`
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
  ${sectionHtml('ภาพก่อนดำเนินการ (ภาพจากผู้แจ้ง)', before, 'ก่อนดำเนินการ', 'ผู้แจ้งไม่ได้แนบภาพ')}
  ${sectionHtml('ภาพหลังดำเนินการ (ภาพจากเจ้าหน้าที่)', after, 'หลังดำเนินการ', 'ยังไม่มีภาพหลังดำเนินการในระบบ')}
  ${originText ? `<p class="ps-origin">${esc(originText)}</p>` : ''}
</section>`
}
