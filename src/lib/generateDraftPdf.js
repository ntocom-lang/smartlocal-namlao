import jsPDF from 'jspdf'
import 'html2canvas' // jsPDF's .html() renders through this internally

// แปลง HTML string (เช่นจาก buildCouncilComplaintHtml) เป็น PDF blob จริง
// แทนที่จะเปิดแค่หน้าต่างพิมพ์ (window.print) เหมือนจุดอื่นในระบบ — ต้องได้ไฟล์จริง
// เพื่อเก็บเข้า storage และให้แอดมินโหลดไปยื่น GDCC e-Office ได้
export function generateDraftPdfBlob(html) {
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;left:-9999px;top:0;width:210mm;background:#fff;'
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
