import jsPDF from 'jspdf'
import 'html2canvas' // jsPDF's .html() renders through this internally

// แปลง HTML string (เช่นจาก buildCouncilComplaintHtml) เป็น PDF blob จริง
// แทนที่จะเปิดแค่หน้าต่างพิมพ์ (window.print) เหมือนจุดอื่นในระบบ — ต้องได้ไฟล์จริง
// เพื่อเก็บเข้า storage และให้แอดมินโหลดไปยื่น GDCC e-Office ได้
export function generateDraftPdfBlob(html) {
  // ห้ามใช้ left:-9999px ซ่อน container — jsPDF .html() คำนวณตำแหน่งข้อความจาก
  // getBoundingClientRect() ของ viewport ตรงๆ ถ้า container อยู่นอกจอ ข้อความทั้งหมด
  // จะถูกวาดไปไกลนอกขอบเขต MediaBox ทำให้ PDF ออกมาว่างเปล่า (ไม่มี error ให้เห็น)
  // ต้องคง left/top ไว้ที่ 0 แล้วซ่อนด้วย z-index ต่ำกว่าเนื้อหาอื่นแทน
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:0;top:0;width:210mm;background:#fff;z-index:-1;pointer-events:none;'
  container.innerHTML = html
  document.body.appendChild(container)

  return new Promise((resolve, reject) => {
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      doc.html(container, {
        html2canvas: { scale: 2 },
        x: 0,
        y: 0,
        callback: (d) => {
          document.body.removeChild(container)
          resolve(d.output('blob'))
        },
      })
    } catch (err) {
      reject(err)
    }
  }).catch((err) => {
    if (container.parentNode) document.body.removeChild(container)
    throw err
  })
}
