// บังคับ https ทุกหน้าเว็บ — กันการสมัคร/เข้าสู่ระบบด้วย LINE/Google หลุดไปเป็นบัญชีของ อปท. อื่น
//
// เหตุการณ์จริง (2026-10-02): ประชาชนทุ่งแค้วสมัครด้วย LINE แล้วบัญชีไปอยู่ อปท. น้ำเลา
// ต้นเหตุ: โดเมน อปท. ทุกแห่งเปิดได้ทาง http:// ตรงๆ (ตอบ 200 ไม่ redirect) พอผู้ใช้เปิดเว็บแบบ
// http://thungkaew.rk-networks.com (พิมพ์เอง ลิงก์เก่า QR ข้อความในไลน์) หน้า login ส่ง
// redirectTo = http://thungkaew.rk-networks.com/ ให้ Supabase ซึ่ง Redirect URLs ของโปรเจกต์อนุญาต
// เฉพาะ https:// — พอไม่ตรง Supabase ไม่ error แต่ "ถอยไปใช้ Site URL" ซึ่งคือ
// https://smartlocal-namlao.vercel.app แล้วผู้ใช้ไปลงจอดที่เว็บน้ำเลา ระบบเติม municipality_id
// ตามโดเมนที่ไปลงจอด (checkAndFixProfile ใน src/App.jsx) บัญชีจึงถูกผูกเข้า อปท. ผิดแห่งอย่างเงียบๆ
// ทดสอบแล้ว: redirect_to แบบ http:// ของทุกโดเมนถูกเปลี่ยนไป Site URL ส่วน https:// ผ่านหมด
//
// ทำที่ Worker เพราะ request หน้าเว็บ (HTML) ผ่านที่นี่เสมอ (dist/ ไม่มี index.html ดู
// scripts/postbuild.js) ถ้าหน้าไม่ถูกโหลดผ่าน http แอปก็ไม่มีวันสร้าง redirectTo แบบ http ได้
// ทางเลือกคือเปิด "Always Use HTTPS" ที่ Cloudflare ซึ่งได้ผลเหมือนกัน — ทำที่นี่เพราะอยู่ใน repo
// ย้อนตรวจได้ และไม่ขึ้นกับว่าใครเคยไปปิดสวิตช์นั้นไว้

// เครื่องตัวเอง (wrangler dev) ไม่มี https ต้องปล่อยผ่าน ไม่งั้นพัฒนาในเครื่องไม่ได้
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * @returns {Response | null} คำตอบ redirect ไป https ถ้า request นี้เป็น http บนโดเมนจริง ไม่งั้น null
 */
export function httpsRedirectResponse(request) {
  const url = new URL(request.url)
  if (url.protocol !== 'http:') return null
  if (LOCAL_HOSTNAMES.has(url.hostname)) return null

  url.protocol = 'https:'
  // พอร์ต http แบบกำหนดเอง (เช่น :8080) ไม่มีความหมายบน https ของ production ล้างทิ้งไม่ให้ได้ลิงก์เสีย
  url.port = ''

  // GET/HEAD ใช้ 301 (เบราว์เซอร์จำผลได้) ส่วน method อื่นต้อง 308 เพื่อคง method + body เดิม
  const safeMethod = request.method === 'GET' || request.method === 'HEAD'
  return new Response(null, {
    status: safeMethod ? 301 : 308,
    headers: { Location: url.href, 'Cache-Control': 'public, max-age=86400' },
  })
}
