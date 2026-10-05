// ── พร็อกซีรูปหน้าเว็บผ่านแคชของ Cloudflare (/_img/...) ─────────────────────────────────────────────
//
// ทำไมต้องมี: โควตา Cached Egress ของ Supabase เป็นของทั้ง org และนับทุกไบต์ที่ส่งออก — รูปหน้าแรกของแต่ละ อปท. ถูกดึงจาก
// Supabase ตรงๆ ทุกครั้งที่เครื่องใหม่/เบราว์เซอร์ในแอป LINE เปิดเว็บ (2026-10-04 เกินโควตาแล้วโดนตัดทั้งระบบ, NOTES.md ข้อ 15)
// อปท. เพิ่มขึ้นเท่าไหร่ egress เพิ่มเป็นเส้นตรง ตัวนี้ให้ Cloudflare จำรูปไว้ที่ edge: มาขอซ้ำ Supabase ไม่ถูกแตะเลย
//
// วิธี: client เขียน URL รูปเป็น /_img/<bucket>/<path> (src/lib/edgeImage.js) → Worker เช็ค allowlist → ดึงจาก Supabase
// ครั้งแรก → เก็บใน Cache API (caches.default) → ครั้งต่อไปตอบจากแคช · URL ในฐานข้อมูลไม่เปลี่ยน (ยังเป็น URL Supabase เดิม)
//
// ⚠️ ความปลอดภัย — ที่นี่คือ "พร็อกซี" ถ้าหละหลวมจะกลายเป็นช่องโหว่:
//   1) allowlist แคบ: เฉพาะ bucket รูปแสดงผลสาธารณะ และ complaint-attachments เฉพาะโฟลเดอร์ posts/ tourism/ staff/
//      โฟลเดอร์อื่นของบัคเก็ตนั้นคือ "รูปแนบคำร้องของประชาชน" (ชื่อโฟลเดอร์เป็น UUID ของคำร้อง) ห้ามผ่านเด็ดขาด — PDPA
//   2) ปลายทางตายตัวเป็น Supabase ของโปรเจกต์นี้ (env.VITE_SUPABASE_URL) ไม่รับ host จากผู้ใช้ → ไม่เป็น open proxy / SSRF
//   3) ตอบเฉพาะรูปแรสเตอร์ (png/jpeg/webp/gif/avif) — ห้าม SVG/HTML: ไฟล์ที่ผู้ใช้อัปโหลดถูกเสิร์ฟจาก origin ของเรา
//      ถ้าเป็น SVG/HTML แล้วมีคนเปิดลิงก์ตรงๆ สคริปต์ในไฟล์จะรันใน origin ของเว็บ (XSS) · ใส่ nosniff + CSP sandbox ซ้ำอีกชั้น
//   4) จำกัดขนาด MAX_BYTES กันไฟล์ใหญ่ผิดปกติกิน memory ของ Worker
//
// โควตา Worker แผนฟรี: 100,000 คำขอ/วัน — รูปทุกใบที่ผ่านตัวนี้นับ 1 คำขอ (ต่างจาก static asset ที่ฟรี) เปิดหน้าแรกแบบเย็น ≈ 25 คำขอ
// ห้ามเอารูปที่ไม่จำเป็นมาผ่านตัวนี้ · client มีตัวสำรองชี้กลับ URL เดิมเมื่อ /_img/ ตอบ error (edgeImage.js)
//
// ถ้าวันหนึ่งย้ายไปเก็บบน R2 (ต้องเปิดใช้ R2 ในแดชบอร์ด ซึ่งอาจบังคับผูกบัตร — ผิดนโยบาย $0 จึงยังไม่ทำ) จุดสลับอยู่ที่ฟังก์ชัน
// loadFromOrigin() ที่เดียว ส่วน client/ฐานข้อมูลไม่ต้องแก้

export const IMAGE_ROUTE_PREFIX = '/_img/'

// แคชที่ edge นาน: URL ของระบบเราเปลี่ยนทุกครั้งที่เปลี่ยนรูป (UUID/timestamp ในชื่อไฟล์ หรือ ?v=) ตามกติกา NOTES.md ข้อ 15
export const EDGE_TTL_SECONDS = 7 * 24 * 60 * 60
// เบราว์เซอร์จำสั้นกว่า: ถ้ามีรูปที่ถูกเขียนทับชื่อเดิมโดยไม่เปลี่ยน URL ผู้ใช้จะเห็นของใหม่ภายใน 1 วัน
export const BROWSER_TTL_SECONDS = 24 * 60 * 60
export const MAX_BYTES = 8 * 1024 * 1024
const ORIGIN_TIMEOUT_MS = 8000

// bucket → โฟลเดอร์ระดับบนที่อนุญาต ('*' = ทั้งบัคเก็ต)
export const ALLOWED_STORAGE = {
  'municipality-assets': '*', // โลโก้ แบนเนอร์ หัวเว็บ QR
  logos: '*',
  'complaint-attachments': ['posts', 'tourism', 'staff'], // ⚠️ ห้ามเพิ่ม '*' — ที่เหลือคือรูปคำร้องประชาชน
}

const RASTER_TYPE = /^image\/(png|jpe?g|webp|gif|avif)(;|$)/i
const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/
const VERSION = /^\d{1,16}$/

// เซกเมนต์ของ path ต้องไม่ว่าง ไม่มีแบ็กสแลช และไม่มีอักขระควบคุม (ตรวจด้วยรหัสตัวอักษร — regex ช่วงควบคุมโดน no-control-regex)
function isSafeSegment(segment) {
  if (!segment) return false
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i)
    if (code < 0x20 || code === 0x7f || segment[i] === '\\') return false
  }
  return true
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
  })
}

/**
 * แปลง path ของ /_img/ เป็น URL ปลายทางที่ Supabase และ "คีย์แคช" ที่ปลอดภัย (คืน null = ไม่อนุญาต)
 *   /_img/<bucket>/<path...>[?v=123]   → {origin}/storage/v1/object/public/<bucket>/<path...>
 *   /_img/drive-file?id=<id>[&v=123]   → {origin}/functions/v1/drive-file?id=<id>   (รูปที่เก็บบน Google Drive)
 * ตัด query ทุกตัวที่ไม่ใช่ v ทิ้ง — กัน cache key ถูกขยายด้วยพารามิเตอร์มั่วจนแคชบวมหรือเลี่ยงแคชได้
 */
export function resolveImageRequest(pathname, search, supabaseOrigin) {
  if (typeof pathname !== 'string' || !pathname.startsWith(IMAGE_ROUTE_PREFIX)) return null
  const rest = pathname.slice(IMAGE_ROUTE_PREFIX.length)
  if (!rest || rest.length > 600) return null

  const params = new URLSearchParams(search || '')
  const version = params.get('v')
  if (version !== null && !VERSION.test(version)) return null

  if (rest === 'drive-file') {
    const id = params.get('id')
    if (!id || !DRIVE_ID.test(id)) return null
    const keyQuery = `id=${id}${version !== null ? `&v=${version}` : ''}`
    return {
      upstream: `${supabaseOrigin}/functions/v1/drive-file?id=${id}`,
      key: `${IMAGE_ROUTE_PREFIX}drive-file?${keyQuery}`,
    }
  }

  // ปฏิเสธตั้งแต่ตัวอักษร: ห้ามมี %2e %2f %5c (หลบ .. หรือ / ที่ถูก decode ทีหลัง) และ // หรือ . / .. เป็นเซกเมนต์
  if (/%2e|%2f|%5c|%00/i.test(rest) || rest.includes('//')) return null
  const segments = rest.split('/')
  if (segments.length < 2) return null
  if (segments.some(s => s === '.' || s === '..' || !isSafeSegment(s))) return null

  const [bucket, top] = segments
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_STORAGE, bucket)) return null
  const allowedTop = ALLOWED_STORAGE[bucket]
  if (allowedTop !== '*' && (segments.length < 3 || !allowedTop.includes(top))) return null

  const path = segments.join('/')
  return {
    upstream: `${supabaseOrigin}/storage/v1/object/public/${path}`,
    key: `${IMAGE_ROUTE_PREFIX}${path}${version !== null ? `?v=${version}` : ''}`,
  }
}

// withLength: ใส่เฉพาะตอนรู้ขนาดแน่ (ตอนดึงจากต้นทางมาเอง) — ตอนตอบจากแคชไม่ copy เพราะ edge อาจส่งตัวที่บีบอัดต่างจากที่เก็บ
// ใส่ Content-Length ผิดค่าแล้วเบราว์เซอร์ตัดรูปกลางทาง
function imageHeaders(source, { ttl, state, withLength = false }) {
  const headers = new Headers()
  headers.set('Content-Type', source.get('Content-Type') || 'application/octet-stream')
  const length = source.get('Content-Length')
  if (withLength && length) headers.set('Content-Length', length)
  const etag = source.get('ETag')
  if (etag) headers.set('ETag', etag)
  headers.set('Cache-Control', `public, max-age=${ttl}`)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
  headers.set('Cross-Origin-Resource-Policy', 'same-site')
  headers.set('X-Img-Cache', state)
  return headers
}

// จุดเดียวที่รู้ว่าไฟล์จริงอยู่ที่ไหน — ตอนนี้คือ Supabase (ดูหมายเหตุ R2 ด้านบน)
async function loadFromOrigin(upstream, fetchImpl) {
  const res = await fetchImpl(upstream, {
    headers: { Accept: 'image/*' },
    redirect: 'manual',
    signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
  })
  return res
}

/**
 * @param {Request} request
 * @param {{ VITE_SUPABASE_URL?: string }} env
 * @param {{ waitUntil?: (p: Promise<unknown>) => void } | undefined} ctx
 * @param {{ cache?: Cache, fetchImpl?: typeof fetch, supabaseOrigin: string }} options
 */
export async function imageProxyResponse(request, env, ctx, options) {
  const { cache = caches.default, fetchImpl = fetch, supabaseOrigin } = options
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } })
  }

  const url = new URL(request.url)
  const resolved = resolveImageRequest(url.pathname, url.search, supabaseOrigin)
  if (!resolved) return notFound()

  // คีย์แคชเป็น GET เสมอ (Cache API ไม่เก็บคีย์ HEAD) และใช้ host ของคำขอ — แต่ละ อปท. มีแคชของตัวเอง
  const cacheKey = new Request(new URL(resolved.key, url.origin).toString(), { method: 'GET' })

  const hit = await cache.match(cacheKey)
  if (hit) {
    return new Response(hit.body, {
      status: 200,
      headers: imageHeaders(hit.headers, { ttl: BROWSER_TTL_SECONDS, state: 'HIT' }),
    })
  }

  let origin
  try {
    origin = await loadFromOrigin(resolved.upstream, fetchImpl)
  } catch {
    return new Response('Bad gateway', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }

  if (origin.status === 404 || origin.status === 400) {
    // ไฟล์ไม่มีจริง — จำสั้นๆ ที่เบราว์เซอร์พอ ห้ามเก็บลงแคช edge (ไฟล์อาจอัปโหลดตามมาทีหลังด้วยชื่อเดิม)
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'public, max-age=60' },
    })
  }
  if (!origin.ok || origin.status !== 200) {
    return new Response('Bad gateway', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }

  const type = origin.headers.get('Content-Type') || ''
  if (!RASTER_TYPE.test(type)) {
    // ไม่ใช่รูปแรสเตอร์ (SVG/HTML/PDF/อื่นๆ) — ไม่ผ่านพร็อกซีนี้ ไม่ว่าชื่อไฟล์จะลงท้ายอะไร
    return notFound()
  }
  const declared = Number(origin.headers.get('Content-Length') || 0)
  if (declared > MAX_BYTES) return new Response('Payload too large', { status: 413, headers: { 'Cache-Control': 'no-store' } })

  const body = await origin.arrayBuffer()
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
    return new Response('Bad gateway', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }

  const baseHeaders = new Headers(origin.headers)
  baseHeaders.set('Content-Length', String(body.byteLength))

  // ที่เก็บในแคชใช้ TTL ของ edge ส่วนที่ตอบเบราว์เซอร์ใช้ TTL สั้นกว่า (ดูค่าคงที่ด้านบน)
  const stored = new Response(body, { status: 200, headers: imageHeaders(baseHeaders, { ttl: EDGE_TTL_SECONDS, state: 'STORED', withLength: true }) })
  const putPromise = cache.put(cacheKey, stored).catch(() => {}) // แคชพลาดไม่ควรทำให้รูปไม่ขึ้น
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(putPromise)
  else await putPromise

  return new Response(body, {
    status: 200,
    headers: imageHeaders(baseHeaders, { ttl: BROWSER_TTL_SECONDS, state: 'MISS', withLength: true }),
  })
}
