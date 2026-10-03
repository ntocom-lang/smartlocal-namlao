// คลิกปุ่มที่ปิดหน้าต่างตัวเอง (window.close()) แล้วยืนยันว่าหน้าต่างปิดจริง
//
// ทำไมต้องมี: ปุ่ม "ปิดหน้าต่าง" ของหน้าต่างพิมพ์ (patientTransportPrint.js) สั่ง window.close()
// เพจจึงหายไปทั้งที่ Playwright ยังคลิกไม่เสร็จได้ → locator.click โยน "Target page, context or browser
// has been closed" แล้วเทสต์ล้มทั้งที่ระบบทำงานถูก — เกิดสุ่มบน CI (Linux) ตั้งแต่รอบแรกที่เปิดใช้ (#409)
// และไม่เคยเกิดในเครื่อง Windows จึงไล่หาในเครื่องไม่เจอ
//
// รูปแบบเดิม Promise.all([page.waitForEvent('close'), button.click()]) ไม่พอ: click ที่โยน error
// ทำให้ Promise.all ล้มทั้งก้อน ต้องรับ error นั้นเฉพาะเมื่อเพจปิดไปแล้วจริงเท่านั้น
// (error อื่น เช่น ปุ่มหาไม่เจอ/ถูกบัง ยังต้องล้มตามเดิม)

/**
 * @param {import('playwright').Page} page เพจที่จะถูกปิด
 * @param {import('playwright').Locator} button ปุ่มในเพจนั้นที่สั่ง window.close()
 */
export async function clickToClosePage(page, button) {
  const closed = page.waitForEvent('close')
  // ถ้า click ล้มจริง (ปุ่มหาไม่เจอ ฯลฯ) closed จะค้างแล้วหมดเวลาทีหลัง — ต้องมีคนรับ rejection นั้น
  // ไม่งั้น Node ล้มทั้งโปรเซสด้วย unhandled rejection แทนที่จะรายงาน error ที่ถูกต้อง (await closed ด้านล่างยังล้มตามปกติ)
  closed.catch(() => {})
  await button.click().catch(error => { if (!page.isClosed()) throw error })
  await closed
}
