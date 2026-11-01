// แอปจากสโตร์ — ส่วนที่ Worker ต้องเสิร์ฟให้ (แยกจาก worker/index.js เพื่อให้เทสต์และสคริปต์ build แอป import ได้)
//
// แอป Android เป็น Trusted Web Activity (TWA) ห่อด้วย Bubblewrap (scripts/twa-build.mjs): ข้างในคือ Chrome
// เปิดเว็บโดเมนกลาง app.rk-networks.com แล้วพาเข้าเว็บ อปท. (src/lib/platform.js)
// Chrome จะแสดงเต็มจอ (ไม่มีแถบที่อยู่เว็บ) ก็ต่อเมื่อทุกโดเมนที่แอปเปิดยืนยันว่าแอปนี้เป็นของเจ้าของเดียวกัน
// ผ่านไฟล์ /.well-known/assetlinks.json — ทุก *.rk-networks.com เสิร์ฟจาก Worker ตัวเดียว จึงตอบไฟล์เดียวกันทุกโดเมน

// ชื่อ package ของแอป — ⚠️ ตั้งแล้วเปลี่ยนไม่ได้ตลอดอายุแอปบน Play และ อปท. ทุกแห่งระบุชื่อนี้ในหนังสืออนุญาต
// ที่ส่งให้ Google (เจ้าของระบบอนุมัติ 2569-11-01) · ใช้ขีดไม่ได้ จึงเป็น rknetworks ไม่ใช่ rk-networks
export const ANDROID_PACKAGE_ID = 'com.rknetworks.smartlocal'

// ลายนิ้วมือ SHA-256 ของใบรับรองที่เซ็นแอป (ข้อมูลสาธารณะ ไม่ใช่ความลับ) — Chrome เทียบกับแอปที่เปิดอยู่
//   1. upload key (D:\keys\smartlocal-upload.jks บนเครื่องนักพัฒนา สร้าง 2569-11-01) — APK ที่ลงเครื่องเองตอนทดสอบ
//   2. app signing key ของ Google Play — ยังไม่มี เติมหลังสร้างแอปใน Play Console (หน้า App integrity)
//      ⚠️ ลืมเติม = แอปที่โหลดจาก Play มีแถบที่อยู่เว็บโผล่ทุกหน้า แม้ APK ทดสอบจะเต็มจอปกติ
export const ANDROID_CERT_FINGERPRINTS = Object.freeze([
  '91:5E:5E:10:CB:A6:9E:44:AB:19:AE:2A:68:76:D1:F8:08:26:D4:7F:2B:81:76:6A:3A:C3:FB:28:AF:C8:37:16',
])

export const ASSET_LINKS_PATH = '/.well-known/assetlinks.json'

export function assetLinks() {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: ANDROID_PACKAGE_ID,
      sha256_cert_fingerprints: [...ANDROID_CERT_FINGERPRINTS],
    },
  }]
}

export function assetLinksResponse() {
  return new Response(JSON.stringify(assetLinks()), {
    headers: {
      'Content-Type': 'application/json',
      // Google ตรวจไฟล์นี้ตอนติดตั้ง/อัปเดตแอป ไม่ได้ทุกครั้งที่เปิด — 1 ชั่วโมงพอให้เติมลายนิ้วมือแล้วมีผลเร็ว
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

// ── ข้อมูลแอปของโดเมนกลาง (/manifest.webmanifest บน app.*) ─────────────────────────────
// โดเมน อปท. ได้ manifest ราย อปท. จาก worker/index.js ส่วนโดเมนกลางไม่มี อปท. เดิมจึงตอบ 404
// Bubblewrap อ่านชื่อ สี และไอคอนของแอปจากไฟล์นี้ และ Chrome ใช้ทำหน้าจอเปิดแอป
export const PLATFORM_APP_NAME = 'SmartLocal' // ต้องตรงกับ src/lib/platform.js (เทสต์ตรวจคู่กัน)
export const PLATFORM_THEME_COLOR = '#1d4ed8' // สีพื้นของไอคอน public/icons/app-icon.svg

// ไอคอนกลางของระบบ (อาคารราชการพื้นน้ำเงิน) — แอปเดียวใช้ร่วมทุก อปท. จึงใช้ตราของแห่งใดแห่งหนึ่งไม่ได้
// maskable = พื้นเต็มกรอบ ภาพย่อเข้าวงกลางที่ Android ไม่ขลิบ (public/icons/app-icon-maskable.svg)
export const PLATFORM_ICONS = Object.freeze([
  { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/icons/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
])

// ป้ายหน้าสุดของโดเมนกลาง — ตรงกับ isPlatformHost ใน src/lib/platform.js
export function isPlatformHostname(hostname) {
  return typeof hostname === 'string' && hostname.split('.')[0] === 'app'
}

export function buildPlatformManifest() {
  return {
    // id ตรึงตัวตนของแอป เปลี่ยนเมื่อไหร่ = เบราว์เซอร์มองเป็นคนละแอป
    id: '/',
    name: PLATFORM_APP_NAME,
    short_name: PLATFORM_APP_NAME,
    description: 'บริการประชาชนออนไลน์ขององค์กรปกครองส่วนท้องถิ่น',
    lang: 'th',
    dir: 'ltr',
    theme_color: PLATFORM_THEME_COLOR,
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/',
    scope: '/',
    icons: PLATFORM_ICONS.map((icon) => ({ ...icon })),
  }
}
