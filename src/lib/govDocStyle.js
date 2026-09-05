// มาตรฐานการพิมพ์หนังสือราชการภาษาไทย — แหล่งเดียวของทั้งระบบ
//
// อ้างอิง: หนังสือสำนักนายกรัฐมนตรี ที่ นร ๐๑๐๖/ว ๒๐๑๙ เรื่อง คำอธิบายการพิมพ์หนังสือราชการ
// ภาษาไทยด้วยโปรแกรมการพิมพ์ในเครื่องคอมพิวเตอร์ (ออกตามระเบียบสำนักนายกรัฐมนตรี
// ว่าด้วยงานสารบรรณ พ.ศ. ๒๕๒๖) — ฟอนต์ TH SarabunPSK ขนาด ๑๖ พอยต์ ระยะบรรทัด ๑ เท่า
// ขอบซ้าย ๓ ซม. ขอบขวา ๒ ซม. (พื้นที่พิมพ์ ๑๖ ซม. พอดีบนกระดาษ A4 กว้าง ๒๑ ซม.)
//
// ⚠️ ค่าข้างต้นคัดมาจากคู่มือของส่วนราชการหลายแห่งที่อ้าง ว ๒๐๑๙ อีกทอด ยังไม่ได้ยืนยัน
// กับตัวบทต้นฉบับ ถ้าจะอ้างอิงเป็นทางการต้องเปิด ว ๒๐๑๙ ฉบับจริงก่อน
// ขอบบน/ขอบล่างไม่พบข้อกำหนดยืนยัน จึงใช้ค่าที่ทำให้เอกสารจบใน 1 หน้าเป็นหลัก
//
// ทำไมต้องมี font-size-adjust: เครื่องเจ้าหน้าที่ อปท. ส่วนใหญ่ไม่ได้ลงชุดฟอนต์ราชการ
// ถ้าไม่คุมไว้ เอกสารใบเดียวกันจะพิมพ์ออกมาคนละขนาดระหว่างเครื่องที่ลงกับไม่ได้ลง
// และใบที่ออกแบบให้จบ 1 หน้าพอดีจะหลุดไปหน้า 2 — ค่า 0.45 คือ x-height ของ THSarabunPSK
// วัดจริงบน Chrome แล้ว THSarabunPSK กับ Sarabun ให้ความสูงเอกสารเท่ากันเป๊ะ
//
// ⚠️ ชื่อ family ต้องเป็น "THSarabunPSK" ติดกันไม่มีเว้นวรรค — Windows ลงทะเบียนชื่อนี้
// เขียน "TH SarabunPSK" แบบมีเว้นวรรคจะหาไม่เจอแล้วตกไปใช้ฟอนต์ระบบเงียบๆ
// (วัดได้ x-height 0.34 = fallback ไม่ใช่ 0.45 ของฟอนต์จริง)

export const GOV_FONT_STACK = '"THSarabunPSK", "TH Sarabun New", "Sarabun", sans-serif'

// x-height ของ THSarabunPSK — ใช้บังคับให้ฟอนต์ที่ตกมาแทนพิมพ์ออกมาขนาดเท่ากัน
export const GOV_FONT_SIZE_ADJUST = 0.45

export const GOV_FONT_SIZE = '16pt'

// ระยะบรรทัด: ระเบียบระบุ "1 เท่า (Single)" ซึ่งใน Word คิดจาก metric ของฟอนต์
// ไม่ใช่ 1.0 ตรงตัว — ตั้ง 1.25 เพราะ line-height: 1 ในเบราว์เซอร์จะตัดวรรณยุกต์
// กับสระบน/ล่างของภาษาไทยหายไป
export const GOV_LINE_HEIGHT = 1.25

// ขอบกระดาษ A4 แนวตั้ง: บน ขวา ล่าง ซ้าย
// ซ้าย 3 ซม. เผื่อที่หนีบแฟ้ม/รูเจาะไม่ทับตัวหนังสือ · ขวา 2 ซม. ตามมาตรฐาน
export const GOV_PAGE_MARGIN = '1.2cm 2cm 0.9cm 3cm'

// Sarabun เป็นตัวสำรองตัวแรกเมื่อเครื่องไม่มีฟอนต์ราชการ จึงต้องโหลดมาด้วยเสมอ
export const GOV_FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
  + '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet">'

/**
 * บล็อก CSS ตัวอักษรตามมาตรฐาน สำหรับวางใน selector ที่เป็นกล่องเนื้อหาของเอกสาร
 * (body หรือ .sheet) — ไม่รวมสี/พื้นหลัง เพื่อให้แต่ละใบกำหนดเองได้
 *
 * @param {object} [opts]
 * @param {string} [opts.fontSize] ใช้ค่าอื่นได้เฉพาะเอกสารตาราง/แบบพิมพ์ที่ 16pt แล้วไม่พอ
 *   และต้องเขียนเหตุผลกำกับไว้ที่จุดเรียกใช้เสมอ
 * @param {number} [opts.lineHeight]
 * @param {string} [opts.indent] ระยะย่อหน้า ถ้าไม่ระบุจะไม่ใส่
 */
export function govDocFontCss({ fontSize = GOV_FONT_SIZE, lineHeight = GOV_LINE_HEIGHT } = {}) {
  return [
    `font-family: ${GOV_FONT_STACK};`,
    `font-size: ${fontSize};`,
    `font-size-adjust: ${GOV_FONT_SIZE_ADJUST};`,
    `line-height: ${lineHeight};`,
  ].join('\n      ')
}

/**
 * กฎ @page ตามมาตรฐาน — ใช้กับเอกสาร A4 แนวตั้งที่เป็นหนังสือ/รายงาน
 * เอกสารตารางแนวนอนหรือแบบพิมพ์ที่ต้องลอกเลย์เอาต์ต้นฉบับให้ส่ง margin เอง
 */
export function govPageCss({ size = 'A4 portrait', margin = GOV_PAGE_MARGIN } = {}) {
  return `@page { size: ${size}; margin: ${margin}; }`
}

/**
 * เฉพาะ "ตัวตนของฟอนต์" — ใช้กับเอกสารตาราง/แบบพิมพ์ที่คุมขนาดตัวอักษรเองรายช่อง
 * (บังคับ 16pt ทั้งใบแล้วคอลัมน์ไม่พอ) แต่ยังต้องพิมพ์ออกมาเท่ากันทุกเครื่อง
 * font-size-adjust ยังทำงานกับทุกขนาดที่ลูกกำหนดเอง จึงได้ความสม่ำเสมอข้ามเครื่องเหมือนกัน
 */
export function govDocFontIdentityCss() {
  return [
    `font-family: ${GOV_FONT_STACK};`,
    `font-size-adjust: ${GOV_FONT_SIZE_ADJUST};`,
  ].join('\n      ')
}

/**
 * บรรทัดกำกับที่มาของเอกสาร — ให้คนที่ถือกระดาษรู้ว่าออกมาจากระบบ E-Service ของ อปท. ใด
 * ไม่ใช่เอกสารที่พิมพ์เองจากที่อื่น
 *
 * ต้องเรียกจากที่นี่ที่เดียวทุกใบ ห้ามพิมพ์ข้อความนี้ซ้ำในไฟล์ปลายทาง — ถ้าแต่ละใบเขียนเอง
 * จะเพี้ยนกันทีละใบเหมือนที่เคยเกิดกับ ComplaintsManager ที่เขียนว่า "ออกจากระบบบริการ
 * ออนไลน์ SmartLocal" โดยไม่มีชื่อ อปท. เลย
 *
 * ⚠️ ผลลัพธ์เป็น "ข้อความดิบ" ยังไม่ได้ escape — ชื่อ อปท. มาจากฐานข้อมูลที่แอดมินแก้ได้
 * ไฟล์ปลายทางที่แปะลง HTML ต้องส่งผ่านฟังก์ชัน escape ของตัวเองเสมอ
 *
 * รับได้ทั้ง object tenant และชื่อหน่วยงานเป็นสตริง เพราะใบฝั่งยานพาหนะบางใบรับมาแค่
 * orgName ไม่ได้รับ tenant ทั้งก้อน (เช่น buildFleetFuelLedgerHtml)
 *
 * @param {{ name?: string } | string | null | undefined} tenantOrName
 */
// หน้าตาของบรรทัดกำกับที่มา — คุมแค่ "ขนาดกับสี" ไว้ตรงกลาง ส่วนตำแหน่ง (กลาง/ชิดขวา/
// ระยะห่าง) ปล่อยให้แต่ละใบกำหนดเอง เพราะเลย์เอาต์ท้ายใบไม่เหมือนกัน
// 11pt เท่ากับบรรทัดอ้างอิงระบบในใบอื่น — เล็กกว่าเนื้อความของหนังสือชัดเจนพอที่จะไม่ถูกอ่าน
// ปนกัน แต่ยังไม่เล็กจนเจ้าหน้าที่สูงอายุอ่านไม่ออก
export const GOV_ESERVICE_ORIGIN_CSS = 'font-size: 11pt; color: #555;'

export function govEServiceOriginText(tenantOrName) {
  const name = (typeof tenantOrName === 'string' ? tenantOrName : tenantOrName?.name)?.trim()
  return name ? `ผ่านระบบ E-Service ${name}` : 'ผ่านระบบ E-Service'
}
