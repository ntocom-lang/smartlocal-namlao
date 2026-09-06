// ส่งผู้ใช้ออกไปเบราว์เซอร์ที่ล็อกอิน Google/LINE ได้จริง
//
// ที่ต้องมีไฟล์นี้: ตรรกะเดียวกันถูกใช้สองจุดที่ไกลกัน — InAppBrowserGate (เด้งออกจาก webview
// ของ LINE/Facebook) กับ AuthPage (ผู้ใช้เปิดจาก QR มาโผล่ใน Mi/Vivo Browser ตรงๆ ซึ่งไม่ใช่
// webview จึงไม่ผ่าน gate) ถ้าปล่อยให้ต่างคนต่างประกอบ intent:// เอง วันหน้าแก้ที่เดียวแล้ว
// อีกที่ค้างของเก่า เป็นกับดักแบบเดียวกับ detectTenantSlug/computeBasename ที่เคยพังมาแล้ว

export const CHROME_PKG = 'com.android.chrome'

/**
 * เปิด URL ปัจจุบันในเบราว์เซอร์อื่นบน Android — pkg = null คือปล่อยให้ระบบเลือก default browser
 *
 * ต้องเจาะจง Chrome เป็นตัวแรกเสมอ: Mi / Vivo / Oppo / Samsung Browser ไม่มีคุกกี้
 * accounts.google.com ค้างอยู่ และมักบล็อกการเด้ง scheme line:// ผลคือทั้ง Google และ LINE
 * ตกไปหน้าให้กรอกอีเมล+รหัสผ่าน ซึ่งประชาชนส่วนใหญ่จำรหัส Google ไม่ได้ และบัญชี LINE
 * จำนวนมากไม่เคยตั้งรหัสผ่านไว้เลย → สมัครไม่จบสักราย
 * Chrome บน Android ผูกกับบัญชีในเครื่องอยู่แล้ว จึงขึ้นหน้า "เลือกบัญชี" ให้เลย และเป็นตัวเดียว
 * ในกลุ่มนี้ที่ยิง beforeinstallprompt → ปุ่ม "ติดตั้งแอป" กลับมาโผล่ด้วย
 *
 * ห้ามใส่ S.browser_fallback_url ชี้กลับ URL เดิมเป็นทางสำรอง: เครื่องที่ไม่มี Chrome จะโหลด URL
 * นั้นใน webview เดิม (LINE) แล้ววนกลับเข้า gate ยิง intent ซ้ำไม่รู้จบ — ให้ผู้เรียกไล่ทีละขั้นเอง
 */
export function openInAndroidBrowser(pkg = CHROME_PKG) {
  const withoutScheme = window.location.href.replace(/^https?:\/\//, '')
  const pkgPart = pkg ? `package=${pkg};` : ''
  window.location.href =
    `intent://${withoutScheme}#Intent;scheme=https;action=android.intent.action.VIEW;${pkgPart}end`
}

// LINE มีกลไกเปิดเบราว์เซอร์นอกของตัวเอง ใช้เป็นบันไดขั้นรองเมื่อ intent ที่ล็อก package ไม่ทำงาน
export function openLineExternalBrowser() {
  const sep = window.location.search ? '&' : '?'
  window.location.replace(window.location.href + sep + 'openExternalBrowser=1')
}

// เบราว์เซอร์ประจำเครื่องยี่ห้อต่างๆ ที่ฐาน Chromium เหมือนกันแต่ไม่ใช่ Chrome จึงไม่มี session
// ของบัญชี Google ในเครื่อง — UA ของทุกตัวมีคำว่า Chrome/ อยู่ด้วย เช็คด้วย Chrome/ อย่างเดียว
// จึงตอบผิดหมด ต้องคัดชื่อยี่ห้อออกก่อน (ลำดับเดียวกับที่ deviceLabel.js อธิบายไว้)
const OEM_BROWSERS =
  /SamsungBrowser\/|MiuiBrowser\/|HeyTapBrowser\/|OppoBrowser\/|VivoBrowser\/|HuaweiBrowser\/|UCBrowser\/|MQQBrowser\/|EdgA\/|OPR\/|YaBrowser\//i

/**
 * Android ที่เปิดอยู่ในเบราว์เซอร์ประจำเครื่อง (ไม่ใช่ Chrome และไม่ใช่ webview)
 *
 * webview ตัดออกเพราะเป็นงานของ InAppBrowserGate ซึ่งเด้งออกให้อัตโนมัติอยู่แล้ว
 * ที่นี่คือเคสสแกน QR ด้วยแอปกล้องแล้วระบบเปิด default browser ให้ตรงๆ — ไม่มีอะไรจับได้เลย
 * จนกว่าผู้ใช้จะกดปุ่มล็อกอิน
 *
 * Brave/Chromium อื่นที่ปลอม UA เป็น Chrome เป๊ะๆ จะถูกนับเป็น Chrome (ตรวจจาก UA ไม่ได้)
 * ผู้ใช้กลุ่มนั้นยังกรอกรหัสผ่านเข้าระบบได้ตามปกติ ไม่ได้เสียทางเข้า
 */
export function isAndroidNonChrome() {
  const ua = navigator.userAgent || ''
  if (!/Android/i.test(ua)) return false
  if (/; wv\)/i.test(ua)) return false
  if (!/Chrome\//i.test(ua)) return true      // Firefox และเบราว์เซอร์นอกสาย Chromium
  return OEM_BROWSERS.test(ua)
}
