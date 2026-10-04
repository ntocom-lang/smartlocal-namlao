// ── ตัวกันรูปจาก Supabase Storage สำหรับเทสต์ E2E ที่ยิงเว็บจริง/dev server ที่ต่อ DB จริง ─────────────
//
// ทำไม: วัดจาก edge_logs ของ Supabase เมื่อ 2026-10-04 พบ HeadlessChrome จาก IP เดียวโหลดรูปสาธารณะ 336 MB ในวันที่ 28 ก.ย.
// (39% ของ Cached Egress ทั้งวัน) และ 48% ของ 24 ชม. ล่าสุด — เบราว์เซอร์ที่เปิดใหม่แคชว่าง ทุกหน้าที่ขึ้นเฮดเดอร์/หน้าแรก
// ดึงโลโก้ + แบนเนอร์ + รูปข่าวเต็มชุด ~3.6 MB ต่อรอบ โควตา Cached Egress เป็นของทั้ง org: เกินแล้วทุกโปรเจกต์ตอบ 402
// (เหตุการณ์ 2026-10-04) ส่วนเทสต์ E2E ไม่ได้ดูเนื้อรูปเลย — ตรวจสิทธิ์ ปุ่ม และข้อความเท่านั้น
//
// ทำอะไร: รูป (resourceType 'image') ที่ชี้ /storage/v1/object/public/ ของ *.supabase.co ถูกตอบด้วยพิกเซล 1x1 แทนการยิงเครือข่าย
//  - ไม่ใช้ abort: abort ทำให้ onerror/รูปสำรองในแอปทำงานและ console เต็มไปด้วย net::ERR_FAILED ที่เทสต์บางชุดนับเป็นข้อผิดพลาด
//  - fetch()/XHR ที่ชี้ Storage ไม่แตะ (route.fallback) เพราะแอปบางจุดอ่านไฟล์จริง เช่นสร้างไอคอนแอปจากโลโก้
//  - ไฟล์ที่เก็บบน Drive ผ่าน /functions/v1/drive-file ไม่ใช่ Cached Egress จึงไม่กรอง
//
// ใช้กับสคริปต์ที่เปิดผู้เช่าซึ่งเก็บรูปบน Supabase Storage (น้ำเลา ตำหนักธรรม ทุ่งแค้ว) — ตอนนี้คือ post-deploy-smoke
// (มีเทสต์กันถูกถอดออกใน tests/storage-image-block.test.mjs) · สคริปต์ Playwright ชั่วคราวที่เปิดผู้เช่าเหล่านี้ (เว็บจริงหรือ
// dev server แบบ namlao.localhost:<พอร์ต>) ก็ต้องเรียกเอง
// ไม่ต้องใช้กับ demo — รูปของ demo อยู่บน Drive (ผ่าน /functions/v1/drive-file) ชุด E2E 10 ชุดที่ยิง demo จึงไม่แตะ Storage
// ห้ามใช้เมื่อต้องเห็นรูปจริง: screenshot-local-build, verify-local-build, เทสต์เลย์เอาต์ที่วัดขนาดรูป
//
// ข้อจำกัด: ต้องเรียกกับทุกหน้าที่เปิดเอง (page.route ครอบเฉพาะหน้านั้น); route ปิดแคช HTTP ของ Chrome แต่รับได้
// เพราะที่เหลือคือ JS ของเว็บ (Cloudflare) กับ REST (ไม่แคชอยู่แล้ว) ไม่ใช่ Cached Egress ของ Supabase

// PNG 1x1 โปร่งใส — เทสต์ยืนยันว่า Chrome ถอดรหัสได้จริง (naturalWidth = 1)
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
)

/** @param {URL} url */
export function isPublicStorageUrl(url) {
  return url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/')
}

/** @param {import('playwright').Page | import('playwright').BrowserContext} target */
export async function blockStorageImages(target) {
  await target.route(isPublicStorageUrl, route => {
    const request = route.request()
    const type = request.resourceType()
    // ไอคอนแท็บ (<link rel="icon">) ที่เบราว์เซอร์ดึงเองมี resourceType 'other' ไม่ใช่ 'image' แต่ Accept ขึ้นต้น image/
    // (วัดจริง 2026-10-04: รอบแรกที่เช็กแค่ 'image' โลโก้ 543 KB หลุดไป 2 ครั้งต่อการเปิดหน้าแรก) ส่วน fetch() ของแอปใช้
    // Accept */* จึงไม่ถูกกรอง
    const wantsImage = type === 'image' || (type === 'other' && /^\s*image\//.test(request.headers().accept ?? ''))
    return wantsImage ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }) : route.fallback()
  })
}
