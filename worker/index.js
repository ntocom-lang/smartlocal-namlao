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
// VITE_TENANT_SLUG=namlao อยู่ (ไว้ให้ Vite dev server กับ build ของ Capacitor ใช้)
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
    `${supabaseUrl}/rest/v1/municipalities?slug=eq.${encodeURIComponent(slug)}&select=name,logo_url,org_type,pwa_short_name`,
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    const shell = await env.ASSETS.fetch(new Request(new URL(SHELL_PATH, url)))
    if (!shell.ok) return new Response('Build output not found', { status: 500 })

    const headers = {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
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
