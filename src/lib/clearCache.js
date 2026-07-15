// ล้าง service worker + Cache Storage แล้วโหลดหน้าใหม่จาก network
// ไม่แตะ localStorage — จะลบ session ล็อกอินของผู้ใช้ไปด้วย
export async function clearCacheAndReload() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } finally {
    // query string ใหม่ทุกครั้ง → บังคับ browser ดึงหน้าจาก network แทนการใช้ disk cache
    window.location.href = `${window.location.pathname}?v=${Date.now()}`
  }
}
