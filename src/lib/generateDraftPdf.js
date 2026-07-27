import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

// แปลง HTML string (เช่นจาก buildCouncilComplaintHtml) เป็น PDF blob จริง
// แทนที่จะเปิดแค่หน้าต่างพิมพ์ (window.print) เหมือนจุดอื่นในระบบ — ต้องได้ไฟล์จริง
// เพื่อเก็บเข้า storage และให้แอดมินโหลดไปยื่น GDCC e-Office ได้
//
// ใช้ html2canvas rasterize เป็นภาพแล้ว addImage เข้า PDF แทนการเรียก jsPDF's
// .html() ตรงๆ — jsPDF .html() มี text-vectorization pipeline ของตัวเองที่ไม่รู้จัก
// font ที่ประกาศผ่าน CSS (เช่น 'Sarabun') เลย ใช้ font มาตรฐาน Helvetica แทนเสมอ
// ซึ่งไม่มี glyph ภาษาไทย ทำให้ข้อความไทยกลายเป็นสัญลักษณ์มั่ว ส่วน html2canvas
// วาดจากพิกเซลที่เบราว์เซอร์เรนเดอร์จริง (เหมือนปุ่ม "พิมพ์" ที่ใช้ window.print())
// จึงได้ตัวอักษรไทยถูกต้องโดยไม่ต้อง embed font file เพิ่มเลย
export async function generateDraftPdfBlob(html) {
  // ห้ามใช้ left:-9999px ซ่อน container — jsPDF คำนวณตำแหน่งบางส่วนจาก
  // getBoundingClientRect() ของ viewport ตรงๆ ถ้า container อยู่นอกจอ เนื้อหา
  // จะถูกวาดไปไกลนอกขอบเขต MediaBox ทำให้ PDF ออกมาว่างเปล่า (ไม่มี error ให้เห็น)
  // ต้องคง left/top ไว้ที่ 0 แล้วซ่อนด้วย z-index ต่ำกว่าเนื้อหาอื่นแทน
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:0;top:0;width:210mm;background:#fff;z-index:-1;pointer-events:none;'
  container.innerHTML = html
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' })

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    const imgData = canvas.toDataURL('image/jpeg', 0.95)

    // เนื้อหาปกติจะพอดี 1 หน้า A4 แต่ถ้าคำร้องมีรายละเอียดยาวจนล้นหน้า ให้ตัดภาพ
    // ข้ามหน้าโดยขยับตำแหน่ง y ของภาพเดียวกันขึ้นทีละหน้า (มาตรฐาน jsPDF+html2canvas)
    let heightLeft = imgHeight
    let position = 0
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight
    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    return pdf.output('blob')
  } finally {
    if (container.parentNode) document.body.removeChild(container)
  }
}
