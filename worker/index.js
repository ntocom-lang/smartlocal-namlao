// SSR shell บน Cloudflare Workers — ฉีด <title> กับ og: tag ให้ตรงกับ อปท. ที่เจ้าของ
// subdomain นั้นเป็น พอร์ตมาจาก api/ssr.js (Vercel) ตรรกะเหมือนเดิมทุกข้อ
// เปลี่ยนแค่ที่มาของไฟล์ shell กับวิธีฉีด tag — ดู docs/hosting-and-domains.md
//
// ทำไม request ส่วนใหญ่ไม่วิ่งมาถึงที่นี่: dist/ ถูก serve เป็น static asset ซึ่ง Cloudflare
// ไม่คิดเงินและไม่เรียก Worker เลย มีแต่ route ของ SPA (ที่ไม่ตรงกับไฟล์ไหนใน dist)
// เท่านั้นที่ตกมาถึง เพราะ scripts/postbuild.js เปลี่ยนชื่อ index.html เป็น _template.html
// ไว้แล้ว จึงไม่มีไฟล์ไหน match เส้นทางอย่าง /auth หรือ /admin
//
// ห้ามตั้ง run_worker_first: true ใน wrangler.jsonc เด็ดขาด — จะทำให้ทุกไฟล์ JS/CSS/รูป
// วิ่งผ่านที่นี่ เผาโควตา 100,000 ครั้ง/วันทิ้งโดยไม่ได้อะไรกลับมา

const SHELL_PATH = '/_template.html'

// นามสกุลของ "ไฟล์" ที่เบราว์เซอร์เอาไปใช้ตรงๆ ไม่ใช่หน้าเว็บ
// ใช้เป็น allowlist ไม่ใช่กฎ "มีจุด = ไฟล์" เพราะ route ของ SPA มีจุดได้
// แล้วจะกลายเป็น 404 ทั้งที่เป็นหน้าจริง
const FILE_EXTENSIONS = new Set([
  'js', 'mjs', 'css', 'map', 'json', 'webmanifest',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp4', 'webm', 'mp3', 'wav', 'ogg',
  'pdf', 'txt', 'xml', 'csv', 'zip', 'wasm',
])

// request นี้ขอ "ไฟล์" หรือขอ "หน้าเว็บ"
//
// ต้องแยกให้ออก เพราะ not_found_handling: "none" ส่งทุก path ที่ไม่ตรงไฟล์ไหน
// มาที่ worker เหมือนกันหมด ถ้าตอบ HTML shell กลับไปให้ทุกอัน request ที่ขอ
// /assets/index-<hash>.js ของ build เก่าจะได้ HTML กลับไปพร้อมสถานะ 200
// เบราว์เซอร์เอา HTML ไปรันเป็น JS แล้วตายด้วย "Unexpected token '<'" — หน้าขาว
//
// เกิดได้ทุกครั้งที่ deploy: vite ล้าง dist/ ทุกรอบ ชื่อไฟล์เปลี่ยน hash
// แต่ HTML เก่ายังถูก cache ไว้ (max-age=300) และยังชี้ไปที่ชื่อไฟล์ชุดเดิม
// ตอบ 404 ตรงๆ ดีกว่า — เบราว์เซอร์กับ workbox รู้จักจัดการ 404
// ส่วน HTML ที่ปลอมเป็น JS ไม่มีใครดักได้
function isFileRequest(pathname) {
  if (pathname.startsWith('/assets/')) return true
  const last = pathname.split('/').pop() || ''
  const dot = last.lastIndexOf('.')
  if (dot <= 0) return false
  return FILE_EXTENSIONS.has(last.slice(dot + 1).toLowerCase())
}

// anon key ปลอดภัยที่จะ embed — ถูก expose ใน client bundle อยู่แล้วทุก deployment
const FALLBACK_SUPABASE_URL = 'https://umxssfahtuprnztlytdd.supabase.co'
const FALLBACK_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHNzZmFodHVwcm56dGx5dGRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NDI0MzAsImV4cCI6MjA5NDAxODQzMH0.SeQTZHWIAPx0XdQ_xK_BNhHjDVd8CeDdwK2NyXdof7E'

const SITE_DESCRIPTION = 'ระบบศูนย์รวมข้อมูลดิจิทัลเพื่อการพัฒนาอย่างยั่งยืน'

const ORG_ABBR = {
  'เทศบาลนคร':   { abbr: 'ทน.', strip: 'เทศบาลนคร' },
  'เทศบาลเมือง':  { abbr: 'ทม.', strip: 'เทศบาลเมือง' },
  'เทศบาลตำบล':  { abbr: 'ทต.', strip: 'เทศบาลตำบล' },
  'อบต.':         { abbr: 'อบต.', strip: 'องค์การบริหารส่วนตำบล' },
}

function autoShortName(tenant) {
  if (tenant.pwa_short_name) return tenant.pwa_short_name
  const map = ORG_ABBR[tenant.org_type]
  if (!map) return tenant.name
  return map.abbr + tenant.name.replace(map.strip, '').trim()
}

// ต้องให้ผลตรงกับ detectTenantSlug() ใน src/contexts/TenantContext.jsx เสมอ ถ้าสองที่นี้
// ตีความ hostname ไม่ตรงกัน จะได้หน้าที่ og:tag เป็นของ อปท. หนึ่งแต่เนื้อในเป็นของอีกแห่ง
// (บน *.workers.dev ทั้งคู่จะได้ slug "smartlocal" ซึ่งไม่มีใน DB แล้วถอยไปหน้าเปล่า
// เหมือนกันทั้งคู่ — ตั้งใจไม่ดักกรณีนี้ฝั่งเดียว เพราะความสอดคล้องสำคัญกว่าประหยัด fetch)
//
// ตัวแปรทับชื่อ DEV_TENANT_SLUG ตั้งใจไม่ใช้ชื่อ VITE_TENANT_SLUG แบบฝั่ง client:
// wrangler dev ดูด .env.local เข้ามาเป็น env ให้อัตโนมัติ และในไฟล์นั้นมี
// VITE_TENANT_SLUG=namlao อยู่ (ไว้ให้ Vite dev server ใช้)
// ถ้า worker อ่านชื่อเดียวกัน แล้ววันหนึ่งค่านั้นหลุดขึ้น production ทุก อปท. จะถูกฉีด
// og:tag เป็นน้ำเลาหมดโดยไม่มีอะไรฟ้อง — ผิดแบบเงียบและหาสาเหตุยาก
// ใช้ชื่อที่ชนกันไม่ได้ตั้งแต่แรกถูกกว่ามาไล่ทีหลัง
function detectSlug(hostname, env) {
  if (env.DEV_TENANT_SLUG) return env.DEV_TENANT_SLUG
  if (!hostname) return null

  const match = hostname.match(/^smartlocal-(.+?)\.vercel\.app$/)
  if (match) return match[1]

  if (!hostname.endsWith('.vercel.app') && hostname !== 'localhost' && !/^\d/.test(hostname)) {
    const parts = hostname.split('.')
    const excluded = ['www', 'app', 'admin']
    if (parts.length >= 2 && !excluded.includes(parts[0])) return parts[0]
  }
  return null
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function fetchTenant(slug, env) {
  const supabaseUrl = env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_KEY

  const response = await fetch(
    `${supabaseUrl}/rest/v1/municipalities?slug=eq.${encodeURIComponent(slug)}&select=name,logo_url,org_type,pwa_short_name,theme_color`,
    {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      signal: AbortSignal.timeout(5000),
    }
  )
  if (!response.ok) return null
  const [tenant] = await response.json()
  return tenant ?? null
}

function buildMetaTags(tenant, origin) {
  const shortName = escapeHtml(autoShortName(tenant))
  const fullName  = escapeHtml(tenant.name)
  const desc      = escapeHtml(SITE_DESCRIPTION)
  const siteUrl   = escapeHtml(`${origin}/`)

  // logo_url เป็นค่าที่แอดมินของ อปท. กรอกเองได้ และ HTML ก้อนนี้ถูกแปะแบบ raw
  // จึงต้องบังคับให้เป็น http(s) URL ก่อนเสมอ ไม่งั้นเปิดช่องให้ยัด javascript: หรือ
  // ปิด attribute แล้วแทรก tag ของตัวเองเข้ามา
  const logoUrl = typeof tenant.logo_url === 'string' && /^https?:\/\//.test(tenant.logo_url)
    ? escapeHtml(tenant.logo_url)
    : ''

  return [
    `<meta name="description" content="${desc}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${siteUrl}" />`,
    `<meta property="og:title" content="${fullName}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:site_name" content="${shortName}" />`,
    logoUrl ? `<meta property="og:image" content="${logoUrl}" />` : '',
    logoUrl ? `<meta property="og:image:width" content="512" />` : '',
    logoUrl ? `<meta property="og:image:height" content="512" />` : '',
  ].filter(Boolean).join('\n    ')
}

const MANIFEST_PATH = '/manifest.webmanifest'

// ขนาดจริงของ PNG จาก IHDR — ต้องประกาศใน manifest ให้ตรงของจริง
//
// ของเดิมฝั่ง client hardcode 512x512 ให้โลโก้ทุก อปท. ทั้งที่ของจริงหลายแห่งเป็น 480x480
// Chrome ตรวจไฟล์ที่โหลดมาจริงเทียบกับที่ประกาศ ไม่ตรงแล้วทิ้งไอคอนนั้น พอไม่เหลือไอคอน
// ที่ใช้ได้ เว็บก็กลายเป็น "ติดตั้งไม่ได้" ทั้งที่มีโลโก้อยู่
//
// ไม่ย่อ/ขยายรูปเอง: Cloudflare Image Resizing เป็นบริการเสียเงิน ผิดนโยบายงบ 0 บาท
// อ่านหัวไฟล์ 24 ไบต์แรกพอ แล้วยกเลิก stream ทิ้ง ไม่ต้องโหลดรูปทั้งใบ
async function readPngSize(url) {
  // redirect: manual ไม่ใช่ error — workerd ไม่รองรับค่า error และโยน TypeError ทิ้งทุกครั้ง
  // ("error won't be implemented since it does not make sense at the edge") ซึ่ง catch ข้างล่าง
  // กลืนไว้เงียบๆ ผลคือทุก อปท. ตกไปใช้ไอคอนกลางหมด โลโก้หน่วยงานไม่เคยขึ้นเป็นไอคอนแอปเลย
  // manual คืน response ที่มีสถานะ 30x กลับมาให้ ซึ่ง !res.ok ด้านล่างตัดทิ้งอยู่แล้ว
  // จึงยังไม่ตามลิงก์ต่อไปโฮสต์อื่นเหมือนเดิม
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
const FALLBACK_ICONS = [
  { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
]

// โลโก้เล็กกว่านี้ใช้ไอคอนสำรอง; manifest คงชุด 192/512 สำหรับ install promotion
const MIN_ICON_PX = 192

async function buildIcons(tenant, env) {
  const logoUrl = typeof tenant.logo_url === 'string' && /^https:\/\//.test(tenant.logo_url)
    ? tenant.logo_url
    : ''
  if (!logoUrl) return FALLBACK_ICONS
  // จำกัดปลายทางที่ Worker อ่าน ป้องกัน URL โลโก้พาไปเรียกเครือข่ายอื่น
  let parsedLogo
  try { parsedLogo = new URL(logoUrl) } catch { return FALLBACK_ICONS }
  const trustedOrigin = new URL(env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL).origin
  if (parsedLogo.origin !== trustedOrigin || parsedLogo.username || parsedLogo.password) return FALLBACK_ICONS

  let size = null
  try {
    size = await readPngSize(logoUrl)
  } catch {
    // โลโก้โหลดไม่ได้/ช้าเกิน 3 วิ — ยอมได้ไอคอนกลาง ดีกว่าปล่อยให้ติดตั้งไม่ได้เลย
  }
  if (!size || size.width < MIN_ICON_PX || size.height < MIN_ICON_PX) return FALLBACK_ICONS

  // คงโลโก้ต้นฉบับและขนาดจริง พร้อมไอคอนสำรอง 192/512 ที่ขาดอยู่
  // เบราว์เซอร์อาจเลือกไอคอนกลางเมื่อขนาดโลโก้หน่วยงานไม่ตรงกับขนาดที่ต้องการ
  //
  // purpose ไม่ใส่ maskable: ตราหน่วยงานเป็นวงกลมพื้นโปร่ง ถ้าประกาศว่า maskable
  // Android จะถือว่าเต็มกรอบได้แล้วขลิบขอบตราทิ้ง
  return [...FALLBACK_ICONS.filter(icon => icon.sizes !== `${size.width}x${size.height}`), {
    src: logoUrl,
    sizes: `${size.width}x${size.height}`,
    type: 'image/png',
    purpose: 'any',
  }]
}

async function buildManifest(tenant, env) {
  return {
    // id ตรึงตัวตนของแอปไว้กับ path นี้ เปลี่ยนเมื่อไหร่ = Android มองเป็นคนละแอป
    // แล้วผู้ใช้ที่ติดตั้งไว้แล้วจะได้ไอคอนซ้ำอีกอันบนหน้าจอ
    id: '/',
    name: tenant.name,
    short_name: autoShortName(tenant),
    description: `ระบบศูนย์รวมข้อมูลดิจิทัลเพื่อการพัฒนา${tenant.name}อย่างยั่งยืน`,
    lang: 'th',
    dir: 'ltr',
    theme_color: normalizeHexColor(tenant.theme_color),
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/',
    scope: '/',
    icons: await buildIcons(tenant, env),
  }
}

const DEFAULT_THEME_COLOR = '#1d4ed8'

// theme_color มาจากช่องที่แอดมินกรอกเอง เจอได้ทั้งค่าว่าง hex 3 หลัก ไม่มี # หรือชนิดที่ไม่ใช่
// สตริง — กรองให้เป็นสีที่ใช้ได้ก่อนส่งให้เบราว์เซอร์
// (ตรรกะเดียวกับ normalizeHexColor ใน src/contexts/TenantContext.jsx)
function normalizeHexColor(value) {
  if (typeof value !== 'string') return DEFAULT_THEME_COLOR
  const hex = value.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`
  if (/^[0-9a-fA-F]{3}$/.test(hex)) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  return DEFAULT_THEME_COLOR
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // manifest ต่อ อปท. — ต้องเช็คก่อน isFileRequest() ซึ่งตอบ 404 ให้ทุกนามสกุลไฟล์
    //
    // เสิร์ฟจาก worker ไม่ใช่ไฟล์ static เพราะเนื้อในต่างกันทุก อปท. (ชื่อ โลโก้ สีธีม) แต่
    // deploy จากบันเดิลชุดเดียวกัน ของเดิมฝั่ง client สร้าง manifest เป็น blob: แล้วฉีดเข้า
    // <head> หลัง fetch Supabase เสร็จ HTML ที่ส่งออกไปตอนแรกจึงไม่มี <link rel="manifest">
    // เลย และ อปท. ที่ยังไม่มีโลโก้ได้ icons: [] ซึ่งแปลว่าติดตั้งไม่ได้แน่นอน
    if (url.pathname === MANIFEST_PATH) {
      let tenant = null
      try {
        const slug = detectSlug(url.hostname, env)
        if (slug) tenant = await fetchTenant(slug, env)
      } catch {
        // Supabase ล่ม — ตกไป 404 ด้านล่าง ผู้ใช้ยังเปิดเว็บได้ แค่ติดตั้งไม่ได้ชั่วคราว
      }

      if (!tenant) {
        return new Response('Not found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
        })
      }

      return new Response(JSON.stringify(await buildManifest(tenant, env)), {
        headers: {
          'Content-Type': 'application/manifest+json; charset=UTF-8',
          // 1 ชั่วโมงพอ: manifest เปลี่ยนเฉพาะตอนแอดมินแก้ชื่อ/โลโก้/สีธีม ซึ่งนานๆ ครั้ง
          // และกันไม่ให้ทุก navigation ยิง worker เพิ่มอีกหนึ่งครั้ง (โควตา 100,000 ครั้ง/วัน)
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // มาถึงตรงนี้แปลว่าไม่มีไฟล์ไหนใน dist/ ตรงกับ path นี้ ถ้าเป็น request ที่ขอไฟล์
    // ก็แปลว่าไฟล์นั้นไม่มีอยู่จริง จบตรงนี้ ไม่ต้องแตะ shell หรือยิง Supabase
    if (isFileRequest(url.pathname)) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
      })
    }

    const shell = await env.ASSETS.fetch(new Request(new URL(SHELL_PATH, url)))
    if (!shell.ok) return new Response('Build output not found', { status: 500 })

    // max-age=0 โดยตั้งใจ ห้ามใส่ TTL กลับมา
    //
    // เดิมเป็น max-age=300 แล้วทุก deploy มีหน้าต่างพังจริงราว 5 นาที: vite ล้าง dist ทุกรอบ
    // ชื่อไฟล์ asset เปลี่ยน hash เสมอ ส่วน edge ยังจ่าย HTML เก่าที่ชี้ไฟล์ชุดเดิมอยู่
    // ผู้ใช้ที่เปิดเว็บช่วงนั้นจึงขอไฟล์ที่ไม่มีแล้ว ได้ 404 กลับไป = หน้าขาว
    // (ยืนยันจากของจริง 2026-09-02: หลัง deploy namlao ยังชี้ bundle เก่าที่ถูกลบไปแล้ว
    //  ขณะที่ demo ได้ของใหม่ไปแล้ว — คนละ POP คนละ cache)
    //
    // ราคาที่จ่าย: navigation ทุกครั้งเรียก worker จริง ไม่กิน cache ชั้น edge อีก
    // ยอมรับได้เพราะ static asset (JS/CSS/รูป) ยังไม่ผ่าน worker เลย ตัวที่นับโควตา
    // มีแค่ request หน้าเว็บ ซึ่งของ อปท. ระดับนี้ห่างจากลิมิต 100,000 ครั้ง/วันมาก
    // ถ้าวันหนึ่งใกล้เต็มจริง ให้ไปแก้ที่ scripts/postbuild.js (เก็บ asset รุ่นก่อนไว้)
    // แล้วค่อยใส่ TTL กลับ ไม่ใช่ใส่ TTL ทิ้งไว้เฉยๆ
    const headers = {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    }

    let tenant = null
    try {
      const slug = detectSlug(url.hostname, env)
      if (slug) tenant = await fetchTenant(slug, env)
    } catch {
      // Supabase ล่มหรือช้าเกิน 5 วินาที — ส่ง shell เปล่าไปให้ client ไปโหลดเอง
      // ดีกว่าขึ้นหน้า error ทั้งหน้าเพราะแค่ og:tag หาย
    }

    if (!tenant) return new Response(shell.body, { headers })

    // ฉีดด้วย HTMLRewriter ไม่ใช่ regex แทนที่สตริงแบบของเดิม — ของเดิมผูกกับรูปแบบ
    // output ของ Vite (ต้องมี <meta charset="UTF-8" /> เป๊ะๆ) ซึ่งพังเงียบๆ ได้ถ้า Vite
    // เปลี่ยนวิธี emit HTML ส่วน HTMLRewriter อ่านเป็น HTML จริงและทำงานแบบ streaming
    const rewritten = new HTMLRewriter()
      // ชื่อ อปท. ดิบ ไม่ต้อง escape เอง — setInnerContent escape ให้อยู่แล้ว
      // (ถ้าส่งค่าที่ escape มาแล้วจะกลายเป็น escape ซ้อนจนเห็น &amp; บนแท็บเบราว์เซอร์)
      .on('title', { element(el) { el.setInnerContent(tenant.name) } })
      .on('head', { element(el) { el.append(buildMetaTags(tenant, url.origin), { html: true }) } })
      .transform(shell)

    return new Response(rewritten.body, { headers })
  },
}
