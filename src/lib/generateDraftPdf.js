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
import { GOV_PAGE_MARGIN } from './govDocStyle.js'

export async function generateDraftPdfBlob(html, options = {}) {
  // ห้ามใช้ left:-9999px ซ่อน container — jsPDF คำนวณตำแหน่งบางส่วนจาก
  // getBoundingClientRect() ของ viewport ตรงๆ ถ้า container อยู่นอกจอ เนื้อหา
  // จะถูกวาดไปไกลนอกขอบเขต MediaBox ทำให้ PDF ออกมาว่างเปล่า (ไม่มี error ให้เห็น)
  // ต้องคง left/top ไว้ที่ 0 แล้วซ่อนด้วย z-index ต่ำกว่าเนื้อหาอื่นแทน
  //
  // padding ค่าเริ่มต้นต้องเท่ากับ @page margin ของเอกสารที่ส่งเข้ามา จึงอ่านจาก
  // GOV_PAGE_MARGIN (มาตรฐานกลางใน govDocStyle.js) ตัวเดียวกับที่ buildCouncilComplaintHtml ใช้ —
  // @page margin มีผลเฉพาะตอน print จริงเท่านั้น (ปุ่ม "พิมพ์") ไม่มีผลกับ html2canvas
  // ที่ capture DOM แบบปกติ ถ้าไม่ใส่ padding เอง เนื้อหาจะกว้างเต็ม 210mm ชิดขอบ
  // ไม่เหมือนไฟล์ที่พิมพ์จริง ต้อง sync ค่าไว้ด้วยกันเสมอถ้าแก้ margin ใน @page
  // เอกสารที่จัด margin ในตัว HTML แล้ว (เช่น แบบ 3 มี .sheet) ส่ง padding: '0'
  const padding = options.padding ?? GOV_PAGE_MARGIN
  const container = document.createElement('div')
  container.style.cssText = `position:fixed;left:0;top:0;width:210mm;padding:${padding};box-sizing:border-box;background:#fff;z-index:-1;pointer-events:none;`
  container.innerHTML = html
  document.body.appendChild(container)

  try {
    await Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise(resolve => setTimeout(resolve, 1500)),
    ])
    // เอกสารหลายหน้าที่ระบุ data-pdf-page มีขนาด A4 และจุดตัดหน้าของตัวเอง
    // จับภาพทีละหน้าเพื่อไม่ให้ jsPDF ตัดบรรทัดคาบระหว่างหน้า
    const explicitPages = [...container.querySelectorAll('[data-pdf-page]')]
    if (explicitPages.length > 0) {
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      for (let index = 0; index < explicitPages.length; index += 1) {
        const canvas = await html2canvas(explicitPages[index], {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
        })
        if (index > 0) pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297)
      }
      return pdf.output('blob')
    }

    const target = container.querySelector('.sheet') || container
    const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true })

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
