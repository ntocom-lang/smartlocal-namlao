// ── ให้รูปหน้าเว็บวิ่งผ่านแคชของ Cloudflare แทนการดึงจาก Supabase ทุกครั้ง ───────────────────────────────
//
// ทำไม: โควตา Cached Egress ของ Supabase เป็นของทั้ง org และนับทุกไบต์ที่ส่งออก — รูปหน้าแรกถูกดึงจาก Supabase ตรงๆ ทุกครั้งที่
// เครื่องใหม่/เบราว์เซอร์ในแอป LINE เปิดเว็บ (2026-10-04 เกินโควตาแล้วโดนตัดทั้งระบบ, NOTES.md ข้อ 15) ฝั่ง Worker มี /_img/ ให้แล้ว
// (worker/imageProxy.js, PR #426) ไฟล์นี้คือฝั่งหน้าเว็บที่ "เปลี่ยน URL ตอนแสดงผล" ให้ไปเรียกตัวนั้น
//
// หลักความปลอดภัย (ห้ามผ่อน):
//   1) เปลี่ยนเฉพาะตอนเรนเดอร์ — URL ในฐานข้อมูลไม่ถูกแตะ เปลี่ยนกลับ = revert PR เดียวจบ
//   2) เปลี่ยนเฉพาะโฮสต์ *.rk-networks.com บนบันเดิล production (localhost/โดเมน .workers.dev/DEV ใช้ URL เดิม ไม่ต้องมี Worker)
//   3) เปลี่ยนเฉพาะ URL ที่ Worker จะยอมให้ผ่านอยู่แล้ว (ALLOWED เป็นสำเนาของ ALLOWED_STORAGE ใน worker/imageProxy.js —
//      tests/edge-image.test.mjs เทียบสองไฟล์ให้ ถ้าแก้ที่หนึ่งแล้วลืมอีกที่ เทสต์แดง)
//      ⚠️ complaint-attachments ผ่านเฉพาะ posts/ tourism/ staff/ — โฟลเดอร์อื่นคือรูปแนบคำร้องของประชาชน (PDPA) ห้ามเพิ่ม '*'
//   4) ถ้า /_img/ ตอบ error (Worker ล่ม/โควตา Worker เต็ม/รูปไม่มี) → ตัวสำรองด้านล่างชี้ <img> กลับ URL เดิมให้เอง 1 ครั้ง
//   5) คืน URL แบบเต็ม (https://โฮสต์ปัจจุบัน/_img/...) ไม่ใช่ path สัมพัทธ์ — หน้าต่างพิมพ์ที่เปิดด้วย document.write และ
//      fetch() ของไอคอนแอปใช้ได้เหมือนกัน และ StaffDashboard ตรวจ /^https?:\/\// ก่อนใส่โลโก้ลงใบพิมพ์
//
// ห้ามเอารูปที่ไม่จำเป็นมาผ่านที่นี่: รูปทุกใบที่ผ่าน /_img/ นับโควตา Worker 100,000 คำขอ/วัน (static asset ไม่นับ)

const ROUTE = '/_img/'
const HOST_SUFFIX = '.rk-networks.com'
const STORAGE_PREFIX = '/storage/v1/object/public/'
const DRIVE_PATH = '/functions/v1/drive-file'

// ต้องตรงกับ ALLOWED_STORAGE ใน worker/imageProxy.js (มีเทสต์เทียบ)
export const EDGE_ALLOWED_STORAGE = {
  'municipality-assets': '*',
  logos: '*',
  'complaint-attachments': ['posts', 'tourism', 'staff'],
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/
const VERSION = /^\d{1,16}$/

// supabaseOrigin ต้องอ่านแบบไม่พังเมื่อไม่มี import.meta.env (เทสต์รันใน Node ล้วน)
function readSupabaseOrigin() {
  try { return new URL(import.meta.env?.VITE_SUPABASE_URL).origin } catch { return '' }
}
const SUPABASE_ORIGIN = readSupabaseOrigin()

function currentContext() {
  const loc = typeof window !== 'undefined' ? window.location : null
  return {
    supabaseOrigin: SUPABASE_ORIGIN,
    hostname: loc?.hostname ?? '',
    origin: loc?.origin ?? '',
    dev: Boolean(import.meta.env?.DEV),
  }
}

function enabled(ctx) {
  return !ctx.dev && Boolean(ctx.supabaseOrigin) && Boolean(ctx.origin) && ctx.hostname.endsWith(HOST_SUFFIX)
}

function parse(url) {
  try { return new URL(url) } catch { return null }
}

/**
 * URL รูปบน Supabase (Storage สาธารณะ หรือ drive-file) → URL ผ่านแคช edge ของเรา · อย่างอื่นคืนค่าเดิมทุกกรณี
 * ปลอดภัยเรียกซ้ำ (URL ที่เป็น /_img/ อยู่แล้วไม่เข้าเงื่อนไข) และรับค่าที่ไม่ใช่สตริง (null/undefined) ได้
 * @param {*} url
 * @param {{supabaseOrigin:string, hostname:string, origin:string, dev:boolean}} [ctx] ใส่เองเฉพาะตอนเทสต์
 */
export function edgeImageUrl(url, ctx = currentContext()) {
  if (typeof url !== 'string' || !url || !enabled(ctx)) return url
  const u = parse(url)
  if (!u || u.origin !== ctx.supabaseOrigin) return url

  const version = u.searchParams.get('v')
  const versionQuery = version !== null && VERSION.test(version) ? version : null

  if (u.pathname === DRIVE_PATH) {
    const id = u.searchParams.get('id')
    if (!id || !DRIVE_ID.test(id)) return url
    return `${ctx.origin}${ROUTE}drive-file?id=${id}${versionQuery ? `&v=${versionQuery}` : ''}`
  }

  if (!u.pathname.startsWith(STORAGE_PREFIX)) return url
  const rest = u.pathname.slice(STORAGE_PREFIX.length)
  // กติกาเดียวกับ Worker: ห้าม %2e %2f %5c %00, ห้าม //, ห้าม . / .. เป็นเซกเมนต์ — ไม่ผ่านก็ปล่อยใช้ URL เดิม
  if (!rest || /%2e|%2f|%5c|%00/i.test(rest) || rest.includes('//')) return url
  const segments = rest.split('/')
  if (segments.length < 2 || segments.some(s => !s || s === '.' || s === '..')) return url
  const [bucket, top] = segments
  if (!Object.prototype.hasOwnProperty.call(EDGE_ALLOWED_STORAGE, bucket)) return url
  const allowedTop = EDGE_ALLOWED_STORAGE[bucket]
  if (allowedTop !== '*' && (segments.length < 3 || !allowedTop.includes(top))) return url

  return `${ctx.origin}${ROUTE}${rest}${versionQuery ? `?v=${versionQuery}` : ''}`
}

/**
 * ย้อนกลับของ edgeImageUrl — ใช้ตอน /_img/ ตอบ error ให้กลับไปขอจาก Supabase ตรงเหมือนเดิม (คืน null = ไม่ใช่ URL /_img/)
 */
export function originalImageUrl(url, ctx = currentContext()) {
  if (typeof url !== 'string' || !ctx.supabaseOrigin || !ctx.origin) return null
  const u = parse(url)
  if (!u || u.origin !== ctx.origin || !u.pathname.startsWith(ROUTE)) return null
  const rest = u.pathname.slice(ROUTE.length)
  const version = u.searchParams.get('v')
  const versionQuery = version !== null && VERSION.test(version) ? version : null

  if (rest === 'drive-file') {
    const id = u.searchParams.get('id')
    if (!id || !DRIVE_ID.test(id)) return null
    return `${ctx.supabaseOrigin}${DRIVE_PATH}?id=${id}${versionQuery ? `&v=${versionQuery}` : ''}`
  }
  if (!rest) return null
  return `${ctx.supabaseOrigin}${STORAGE_PREFIX}${rest}${versionQuery ? `?v=${versionQuery}` : ''}`
}

/** ตัวแปลงสำหรับรายการรูป (เช่นแกลเลอรี) — ค่าที่ไม่ใช่สตริงผ่านไปเฉยๆ */
export function edgeImageUrls(urls, ctx = currentContext()) {
  return Array.isArray(urls) ? urls.map(u => edgeImageUrl(u, ctx)) : urls
}

/**
 * ตัวสำรอง: <img> ใดที่โหลด /_img/ ไม่สำเร็จ ให้ชี้กลับ URL เดิมของ Supabase 1 ครั้ง (ไม่วนซ้ำ)
 * ผูกที่ document แบบ capture เพราะ error ของ <img> ไม่ bubble — ครอบทุกจุดในแอปโดยไม่ต้องแก้ทีละ component
 * ไม่ครอบ CSS background-image / <link rel=icon> (ไม่มี error event ให้จับ) — จุดพวกนั้นถ้า Worker ล่มจะเห็นภาพไม่ขึ้น
 * ไม่ถึงกับเว็บพัง (ดูหมายเหตุที่ TenantContext)
 * @returns {() => void} ฟังก์ชันถอดตัวดักออก (ใช้ในเทสต์)
 */
export function installEdgeImageFallback(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return () => {}
  const onError = event => {
    const el = event.target
    if (!el || el.tagName !== 'IMG' || el.dataset?.edgeFallback) return
    const original = originalImageUrl(el.currentSrc || el.src)
    if (!original) return
    el.dataset.edgeFallback = '1'
    el.src = original
  }
  doc.addEventListener('error', onError, true)
  return () => doc.removeEventListener('error', onError, true)
}
