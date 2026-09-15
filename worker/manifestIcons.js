// ไอคอนใน manifest ต่อ อปท. — แยกจาก worker/index.js เพื่อให้ tests/app-icon.test.mjs import ได้
// (ไฟล์ entry ของ Worker คงไว้แค่ default export ไม่เอาฟังก์ชันภายในไปปนกับ export ของ runtime)

// ขนาดจริงของ PNG จาก IHDR — ต้องประกาศใน manifest ให้ตรงของจริง
//
// ของเดิมฝั่ง client hardcode 512x512 ให้โลโก้ทุก อปท. ทั้งที่ของจริงหลายแห่งเป็น 480x480
// Chrome ตรวจไฟล์ที่โหลดมาจริงเทียบกับที่ประกาศ ไม่ตรงแล้วทิ้งไอคอนนั้น พอไม่เหลือไอคอน
// ที่ใช้ได้ เว็บก็กลายเป็น "ติดตั้งไม่ได้" ทั้งที่มีโลโก้อยู่
//
// ไม่ย่อ/ขยายรูปเอง: Cloudflare Image Resizing เป็นบริการเสียเงิน ผิดนโยบายงบ 0 บาท
// อ่านหัวไฟล์ 24 ไบต์แรกพอ แล้วยกเลิก stream ทิ้ง ไม่ต้องโหลดรูปทั้งใบ
export async function readPngSize(url) {
  // redirect: 'manual' ไม่ใช่ 'error' — workerd ไม่รองรับค่า 'error' และโยน TypeError ทิ้งทุกครั้ง
  // ("'error' won't be implemented since it does not make sense at the edge; use 'manual' and check
  //  the response status code") ยืนยันด้วย wrangler dev จริงแล้ว ไม่ได้เชื่อเอกสาร — หน้า Request ของ
  //  Cloudflare ยังลิสต์ 'error' ไว้ว่าใช้ได้ ซึ่งไม่ตรงกับ runtime
  // เจตนาเดิม (ไม่ตามลิงก์ต่อไปโฮสต์อื่น) ยังอยู่ครบกับ 'manual': มันคืน response 30x กลับมาเฉยๆ
  //  แล้ว !res.ok บรรทัดถัดไปตัดทิ้งเอง
  const res = await fetch(url, { headers: { Range: 'bytes=0-33' }, redirect: 'manual', signal: AbortSignal.timeout(3000) })
  if (!res.ok || !res.body) return null

  const reader = res.body.getReader()
  const head = new Uint8Array(34)
  let filled = 0
  try {
    while (filled < 24) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, head.length - filled)
      head.set(value.subarray(0, take), filled)
      filled += take
    }
  } finally {
    // ปล่อย connection ทิ้งทันที ไม่รอไบต์ที่เหลือของรูป
    reader.cancel().catch(() => {})
  }
  if (filled < 24) return null

  // ลายเซ็น PNG — โลโก้ที่เป็น JPEG/WebP หรือ URL ที่คืน HTML กลับมาจะตกตรงนี้
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!SIGNATURE.every((byte, i) => head[i] === byte)) return null
  if (String.fromCharCode(...head.slice(12, 16)) !== 'IHDR') return null

  const view = new DataView(head.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

// ไอคอนสำรองของระบบ ใช้เมื่อ อปท. ยังไม่ได้อัปโหลดโลโก้ หรือโลโก้เล็กเกินเกณฑ์ของ Chrome
export const FALLBACK_ICONS = [
  { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
]

// โลโก้เล็กกว่านี้ใช้ไอคอนสำรอง; manifest คงชุด 192/512 สำหรับ install promotion
export const MIN_ICON_PX = 192

// จำกัดปลายทางที่ Worker อ่าน ป้องกัน URL ที่แอดมินกรอกพาไปเรียกเครือข่ายอื่น
// (ครอบทั้ง Supabase Storage เดิมและ /functions/v1/drive-file ที่ใช้กับไฟล์บน Drive)
function trustedUrl(value, trustedOrigin) {
  if (typeof value !== 'string' || !/^https:\/\//.test(value)) return ''
  let parsed
  try { parsed = new URL(value) } catch { return '' }
  if (parsed.origin !== trustedOrigin || parsed.username || parsed.password) return ''
  return value
}

// โหลดไม่ได้/ช้าเกิน 3 วิ/ไม่ใช่ PNG → null ให้ผู้เรียกตกไปใช้ของสำรอง
async function safeSize(url, readSize) {
  if (!url) return null
  try {
    return await readSize(url)
  } catch {
    return null
  }
}

// readSize เปิดให้เทสต์ส่งตัวปลอมเข้ามา ไม่ต้องยิงเครือข่ายจริง
export async function buildIcons(tenant, trustedOrigin, readSize = readPngSize) {
  const logoUrl = trustedUrl(tenant.logo_url, trustedOrigin)
  const appIconUrl = trustedUrl(tenant.app_icon_url, trustedOrigin)

  // อ่านพร้อมกัน — manifest ต้องรอทั้งคู่ ยิงทีละตัวเสียเวลาเป็นสองเท่า
  const [logoSize, appIconSize] = await Promise.all([
    safeSize(logoUrl, readSize),
    safeSize(appIconUrl, readSize),
  ])

  let icons = FALLBACK_ICONS
  if (logoSize && logoSize.width >= MIN_ICON_PX && logoSize.height >= MIN_ICON_PX) {
    // คงโลโก้ต้นฉบับและขนาดจริง พร้อมไอคอนสำรอง 192/512 ที่ขาดอยู่
    // เบราว์เซอร์อาจเลือกไอคอนกลางเมื่อขนาดโลโก้หน่วยงานไม่ตรงกับขนาดที่ต้องการ
    //
    // purpose ไม่ใส่ maskable: ตราหน่วยงานเป็นวงกลมพื้นโปร่ง ถ้าประกาศว่า maskable
    // Android จะถือว่าเต็มกรอบได้แล้วขลิบขอบตราทิ้ง — ไอคอน maskable แยกอยู่ด้านล่าง
    const sizes = `${logoSize.width}x${logoSize.height}`
    icons = [...FALLBACK_ICONS.filter(icon => icon.sizes !== sizes), {
      src: logoUrl,
      sizes,
      type: 'image/png',
      purpose: 'any',
    }]
  }

  // ไอคอนที่หน้าตั้งค่าสร้างจากโลโก้ (src/lib/appIcon.js) — Android ใช้ตัวนี้ทำไอคอนบนหน้าจอ
  // ต้องจัตุรัส: maskable ที่ไม่จัตุรัสถูกยืดตอนใส่ mask
  if (appIconSize && appIconSize.width === appIconSize.height && appIconSize.width >= MIN_ICON_PX) {
    icons = [...icons, {
      src: appIconUrl,
      sizes: `${appIconSize.width}x${appIconSize.height}`,
      type: 'image/png',
      purpose: 'maskable',
    }]
  }

  return icons
}
