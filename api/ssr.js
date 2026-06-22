const { readFileSync } = require('fs')
const { join } = require('path')

// anon key ปลอดภัยที่จะ embed — ถูก expose ใน client bundle อยู่แล้วทุก deployment
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://umxssfahtuprnztlytdd.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHNzZmFodHVwcm56dGx5dGRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NDI0MzAsImV4cCI6MjA5NDAxODQzMH0.SeQTZHWIAPx0XdQ_xK_BNhHjDVd8CeDdwK2NyXdof7E'

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

function detectSlug(host) {
  if (process.env.VITE_TENANT_SLUG) return process.env.VITE_TENANT_SLUG
  if (!host) return null
  const match = host.match(/^smartlocal-(.+?)\.vercel\.app$/)
  if (match) return match[1]
  if (!host.endsWith('.vercel.app') && host !== 'localhost' && !/^\d/.test(host)) {
    const parts = host.split('.')
    const excluded = ['www', 'app', 'admin']
    if (parts.length >= 2 && !excluded.includes(parts[0])) return parts[0]
  }
  return null
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

module.exports = async (req, res) => {
  let html
  try {
    html = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8')
  } catch {
    res.status(500).send('Build output not found')
    return
  }

  try {
    const slug = detectSlug(req.headers.host)
    if (slug) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/municipalities?slug=eq.${encodeURIComponent(slug)}&select=name,logo_url,org_type,pwa_short_name`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
          signal: AbortSignal.timeout(5000),
        }
      )
      if (r.ok) {
        const [tenant] = await r.json()
        if (tenant) {
          const shortName = escapeHtml(autoShortName(tenant))
          const fullName  = escapeHtml(tenant.name)
          const desc      = 'ระบบศูนย์รวมข้อมูลดิจิทัลเพื่อการพัฒนาอย่างยั่งยืน'
          const logoUrl   = tenant.logo_url || ''
          const siteUrl   = `https://${req.headers.host}/`

          const ogTags = [
            `<title>${shortName}</title>`,
            `<meta name="description" content="${desc}" />`,
            `<meta property="og:type" content="website" />`,
            `<meta property="og:url" content="${siteUrl}" />`,
            `<meta property="og:title" content="${shortName}" />`,
            `<meta property="og:description" content="${desc}" />`,
            `<meta property="og:site_name" content="${fullName}" />`,
            logoUrl ? `<meta property="og:image" content="${logoUrl}" />` : '',
            logoUrl ? `<link rel="icon" type="image/png" href="${logoUrl}" />` : '',
            logoUrl ? `<link rel="shortcut icon" href="${logoUrl}" />` : '',
            logoUrl ? `<link rel="apple-touch-icon" href="${logoUrl}" />` : '',
          ].filter(Boolean).join('\n    ')

          html = html
            .replace(/<title>[^<]*<\/title>/, '')
            .replace(/<link rel="icon"[^>]*>/g, '')
            .replace(/<link rel="shortcut icon"[^>]*>/g, '')
            .replace(/<link rel="apple-touch-icon"[^>]*>/g, '')
            .replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${ogTags}`)
        }
      }
    }
  } catch { /* fallback: serve original html */ }

  res.setHeader('Content-Type', 'text/html; charset=UTF-8')
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
  res.end(html)
}
