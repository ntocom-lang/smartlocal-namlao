// ปุ่ม "ปิดหน้าต่าง" บนหน้าต่างใบพิมพ์ — เฉพาะอุปกรณ์สัมผัส (มือถือ/แท็บเล็ต)
//
// เจ้าของระบบแจ้ง 2569-10-25: บนมือถือกด "พิมพ์ใบขอใช้รถ (แบบ 3)" / "พิมพ์บันทึกรับรอง (แบบ สก. ๑)" แล้วปิดไม่ได้
// สาเหตุ: ปุ่มพิมพ์เปิดใบด้วย window.open เป็นแท็บใหม่ บนมือถือแท็บนั้นเป็นหน้าเอกสารล้วน ไม่มีแถบปิด/ย้อนกลับ
// (บนคอมพิวเตอร์หน้าต่าง pop-up มีปุ่ม X ของระบบปฏิบัติการอยู่แล้ว) — ใบรถรับ-ส่งผู้ป่วยแก้ไว้แล้วใน #375
// ด้วยปุ่มบนจอ แต่ใบยานพาหนะยังไม่มี
//
// ⚠️ ทำไมปุ่มติดขอบขวาบนธรรมดา (position: fixed; right: 10px) ใช้ไม่ได้ — วัดจริงแล้วหลุดจอ:
//   หน้าเอกสารที่เขียนด้วย document.write ไม่มี <meta name="viewport"> (ใบรถรับ-ส่งผู้ป่วยมี ใบยานพาหนะไม่มี)
//   มือถือจึงจัดหน้ากว้าง ~980px แล้วย่อลงมา: ขอบขวาของหน้าจัดวางอยู่ x=970 แต่ส่วนที่มองเห็นจริงกว้างราว 764 (ย่อ 0.51 เท่า)
//   ปุ่มที่ x=835–970 อยู่นอกจอ ส่วนที่เห็นก็ถูกย่อจนเล็กกว่านิ้ว · ทางแก้: สคริปต์เล็กๆ จัดตำแหน่ง+ขนาดปุ่มตามส่วนที่มองเห็นจริง
//   (visualViewport) ให้อยู่มุมซ้ายบนของหน้าจอเสมอ ขนาดบนจอคงที่ ไม่ว่าผู้ใช้จะบีบซูมเข้า/ออก
//   (ไม่เติม viewport meta ให้หน้าเอกสาร — จะทำให้ใบ A4 กว้าง 794px ล้นจอ 390px ต้องเลื่อนแนวนอนอ่าน)
//
// ทำไมใช้ (hover: none) and (pointer: coarse) ไม่ใช้ความกว้างจอ: เงื่อนไข max-width ไม่ตรงบนมือถือจริง (viewport เสมือน ~980px)
//   สัมผัส = ไม่มีเมาส์ ซึ่งแยกมือถือจากคอมพิวเตอร์ได้ตรงกว่า (เจ้าของระบบสั่ง "เฉพาะมือถือ" — คอมพิวเตอร์ไม่เห็นปุ่มนี้)
// ปุ่มไม่ติดไปกับกระดาษ: @media print ซ่อน และอยู่นอกกล่องเนื้อหา (position: fixed) จึงไม่กระทบเลย์เอาต์ใบ/จำนวนหน้า

export const PRINT_WINDOW_CLOSE_CLASS = 'print-window-close-touch'

const CSS = `<style data-print-window-close>
.${PRINT_WINDOW_CLOSE_CLASS} { display: none; }
@media screen and (hover: none) and (pointer: coarse) {
  .${PRINT_WINDOW_CLOSE_CLASS} { display: block; position: fixed; left: 8px; top: 8px; z-index: 2147483647; transform-origin: 0 0; }
  .${PRINT_WINDOW_CLOSE_CLASS} button {
    min-width: 44px; min-height: 44px; padding: 8px 18px; border: 2px solid #0f172a; border-radius: 999px;
    background: #fff; color: #0f172a; font: 700 16px/1.2 sans-serif; box-shadow: 0 2px 10px #0f172a40;
  }
}
@media print { .${PRINT_WINDOW_CLOSE_CLASS} { display: none !important; } }
</style>`

// จัดปุ่มให้อยู่มุมซ้ายบนของ "ส่วนที่มองเห็น" และขนาดบนจอคงที่ — fixed อ้างอิง layout viewport ซึ่งไม่ใช่ส่วนที่มองเห็นเมื่อหน้าถูกย่อ/ซูม
// ปรับซ้ำตอน load ด้วย: สเกลย่อพอดีจอ (shrink-to-fit) มือถือคิดหลังจัดหน้าเสร็จ ตอนสคริปต์รันครั้งแรกยังเป็น 1
const FIT_SCRIPT = `<script>(function(){var w=document.querySelector('.${PRINT_WINDOW_CLOSE_CLASS}'),v=window.visualViewport;`
  + `if(!w||!v||!window.matchMedia('(hover: none) and (pointer: coarse)').matches)return;`
  + `function fit(){var s=1/v.scale;w.style.left=(v.offsetLeft+8*s)+'px';w.style.top=(v.offsetTop+8*s)+'px';w.style.transform='scale('+s+')'}`
  + `fit();v.addEventListener('resize',fit);v.addEventListener('scroll',fit);window.addEventListener('load',fit);window.addEventListener('resize',fit)})()</script>`

const BUTTON = `<div class="${PRINT_WINDOW_CLOSE_CLASS}"><button type="button" onclick="window.close()"><span aria-hidden="true">×</span> ปิดหน้าต่าง</button></div>${FIT_SCRIPT}`

// html = เอกสารเต็ม หรือชิ้นส่วนที่ไม่มี <head>/<body> (เช่น หน้า "กำลังเตรียมใบพิมพ์") — ใส่ซ้ำไม่ได้ผล (เรียกกี่ครั้งก็มีปุ่มเดียว)
export function addMobileCloseButton(html) {
  const source = String(html ?? '')
  if (source.includes(PRINT_WINDOW_CLOSE_CLASS)) return source
  const withStyle = /<\/head>/i.test(source)
    ? source.replace(/<\/head>/i, `${CSS}</head>`)
    : source.replace(/^(\s*<!doctype[^>]*>)?/i, match => `${match}${CSS}`)
  // </body> ตัวสุดท้าย — ข้อความของใบ (ที่ผู้ใช้กรอก) ถูก escape แล้ว แต่ใช้ตัวท้ายสุดไว้ก่อนกันพลาดกับสตริงใน script
  const bodyEnd = withStyle.toLowerCase().lastIndexOf('</body>')
  return bodyEnd >= 0
    ? `${withStyle.slice(0, bodyEnd)}${BUTTON}${withStyle.slice(bodyEnd)}`
    : `${withStyle}${BUTTON}`
}
