import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const TenantContext = createContext(null)

// คำเรียกตำแหน่งตาม org_type
const TERMINOLOGY = {
  'เทศบาลนคร':  termSet('นายกเทศมนตรี', 'รองนายกเทศมนตรี', 'สมาชิกสภาเทศบาล', 'ประธานสภาเทศบาล', 'ปลัดเทศบาล'),
  'เทศบาลเมือง': termSet('นายกเทศมนตรี', 'รองนายกเทศมนตรี', 'สมาชิกสภาเทศบาล', 'ประธานสภาเทศบาล', 'ปลัดเทศบาล'),
  'เทศบาลตำบล': termSet('นายกเทศมนตรี', 'รองนายกเทศมนตรี', 'สมาชิกสภาเทศบาล', 'ประธานสภาเทศบาล', 'ปลัดเทศบาล'),
  'เทศบาล':     termSet('นายกเทศมนตรี', 'รองนายกเทศมนตรี', 'สมาชิกสภาเทศบาล', 'ประธานสภาเทศบาล', 'ปลัดเทศบาล'),
  'อบต.':       termSet('นายก อบต.', 'รองนายก อบต.', 'สมาชิกสภา อบต.', 'ประธานสภา อบต.', 'ปลัด อบต.'),
}

function termSet(mayor, deputyMayor, council, councilPresident, clerk) {
  return { mayor, deputyMayor, council, councilPresident, clerk }
}

function detectTenantSlug() {
  // Dev override ผ่าน env var
  if (import.meta.env.VITE_TENANT_SLUG) return import.meta.env.VITE_TENANT_SLUG

  const { hostname, pathname } = window.location
  const parts = hostname.split('.')
  const excluded = ['www', 'app', 'admin', 'localhost']

  // Subdomain: namlao.smartlocal.th — ต้องเป็น custom domain เท่านั้น
  // ไม่นับ xxx.vercel.app หรือ localhost
  const isCustomDomain =
    !hostname.endsWith('.vercel.app') &&
    hostname !== 'localhost' &&
    !hostname.match(/^\d/)   // ไม่ใช่ IP

  if (isCustomDomain && parts.length >= 2 && !excluded.includes(parts[0])) {
    return parts[0]
  }

  // Vercel project name: smartlocal-{slug}.vercel.app
  if (hostname.endsWith('.vercel.app')) {
    const match = parts[0].match(/^smartlocal-(.+)$/)
    if (match) return match[1]
  }

  // Path mode: smartlocal.vercel.app/namlao/...
  const segment = pathname.split('/').filter(Boolean)[0]
  return segment ?? null
}

const ORG_ABBR = {
  'เทศบาลนคร':  { abbr: 'ทน.', strip: 'เทศบาลนคร' },
  'เทศบาลเมือง': { abbr: 'ทม.', strip: 'เทศบาลเมือง' },
  'เทศบาลตำบล': { abbr: 'ทต.', strip: 'เทศบาลตำบล' },
  'อบต.':        { abbr: 'อบต.', strip: 'องค์การบริหารส่วนตำบล' },
}

function autoShortName(tenant) {
  if (tenant.pwa_short_name) return tenant.pwa_short_name
  const map = ORG_ABBR[tenant.org_type]
  if (!map) return tenant.name
  const location = tenant.name.replace(map.strip, '').trim()
  return map.abbr + location
}

function injectPWAManifest(tenant) {
  const manifest = {
    name: tenant.name,
    short_name: autoShortName(tenant),
    description: `ระบบศูนย์รวมข้อมูลดิจิทัลเพื่อการพัฒนา${tenant.name}อย่างยั่งยืน`,
    theme_color: tenant.theme_color ?? '#1c7cd6',
    background_color: '#ffffff',
    display: 'standalone',
    start_url: window.location.origin + '/',
    scope: window.location.origin + '/',
    icons: tenant.logo_url
      ? [{ src: tenant.logo_url, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
      : [],
  }

  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
  const url = URL.createObjectURL(blob)

  let link = document.querySelector('link[rel="manifest"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'manifest'
    document.head.appendChild(link)
  }
  if (link.href?.startsWith('blob:')) URL.revokeObjectURL(link.href)
  link.href = url

  // iOS Safari ใช้ apple-touch-icon แทน manifest icons
  if (tenant.logo_url) {
    let appleIcon = document.querySelector('link[rel="apple-touch-icon"]')
    if (!appleIcon) {
      appleIcon = document.createElement('link')
      appleIcon.rel = 'apple-touch-icon'
      document.head.appendChild(appleIcon)
    }
    appleIcon.href = tenant.logo_url
  }
}

export function applyTheme(hexColor, uiStyle = 'default') {
  const root = document.documentElement
  root.style.setProperty('--color-primary', hexColor)

  // สร้าง hover shade (darken ~15%) โดยไม่ต้องพึ่ง library
  const r = parseInt(hexColor.slice(1, 3), 16)
  const g = parseInt(hexColor.slice(3, 5), 16)
  const b = parseInt(hexColor.slice(5, 7), 16)
  const darken = (v) => Math.max(0, Math.floor(v * 0.85)).toString(16).padStart(2, '0')
  root.style.setProperty('--color-primary-dark', `#${darken(r)}${darken(g)}${darken(b)}`)
  root.style.setProperty('--color-primary-rgb', `${r}, ${g}, ${b}`)

  // กำหนดตัวแปรสำหรับ Component Style (ui_style)
  switch (uiStyle) {
    case 'rounded':
      root.style.setProperty('--radius-card', '1.5rem')
      root.style.setProperty('--radius-btn', '9999px')
      root.style.setProperty('--shadow-card', '0 4px 14px 0 rgba(0,0,0,0.05)')
      root.style.setProperty('--bg-card', '#ffffff')
      root.style.setProperty('--border-card', '1px solid #f3f4f6')
      root.style.setProperty('--blur-card', 'none')
      break
    case 'glass':
      root.style.setProperty('--radius-card', '1rem')
      root.style.setProperty('--radius-btn', '0.75rem')
      root.style.setProperty('--shadow-card', '0 8px 32px 0 rgba(31, 38, 135, 0.07)')
      root.style.setProperty('--bg-card', 'rgba(255, 255, 255, 0.7)')
      root.style.setProperty('--border-card', '1px solid rgba(255, 255, 255, 0.5)')
      root.style.setProperty('--blur-card', 'blur(12px)')
      break
    case 'minimal':
      root.style.setProperty('--radius-card', '0px')
      root.style.setProperty('--radius-btn', '0px')
      root.style.setProperty('--shadow-card', 'none')
      root.style.setProperty('--bg-card', '#ffffff')
      root.style.setProperty('--border-card', '1px solid #e5e7eb')
      root.style.setProperty('--blur-card', 'none')
      break
    case 'default':
    default:
      root.style.setProperty('--radius-card', '1rem')
      root.style.setProperty('--radius-btn', '0.5rem')
      root.style.setProperty('--shadow-card', '0 1px 2px 0 rgba(0, 0, 0, 0.05)')
      root.style.setProperty('--bg-card', '#ffffff')
      root.style.setProperty('--border-card', '1px solid #f3f4f6')
      root.style.setProperty('--blur-card', 'none')
      break
  }
}

export function TenantProvider({ children }) {
  const [tenant, setTenant] = useState(null)
  const [terminology, setTerminology] = useState(TERMINOLOGY['อบต.'])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const slug = detectTenantSlug()

    if (!slug) {
      setError('ไม่พบรหัสหน่วยงาน กรุณาตรวจสอบ URL หรือตั้งค่า VITE_TENANT_SLUG')
      setLoading(false)
      return
    }

    async function fetchTenant() {
      let timedOut = false
      const timerId = setTimeout(() => {
        timedOut = true
        setError('ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่')
        setLoading(false)
      }, 12000)

      try {
        const { data, error: dbError } = await supabase
          .from('municipalities')
          .select('id, slug, name, org_type, province, theme_color, layout_theme, ui_style, theme_presets, show_posts_highlight, logo_url, header_image_url, developer_name, website_url, facebook_url, line_oa_url, phone, address, latitude, longitude, system_name, system_subtitle, pwa_short_name, enabled_modules, telegram_group_id, promptpay_id, fee_schedule, qr_code_url, qr_label, bank_name, bank_account_no, bank_account_name')
          .eq('slug', slug)
          .single()

        clearTimeout(timerId)
        if (timedOut) return

        if (dbError || !data) {
          setError(`ไม่พบหน่วยงานรหัส "${slug}" ในระบบ`)
          setLoading(false)
          return
        }

        setTenant(data)
        setTerminology(TERMINOLOGY[data.org_type] ?? TERMINOLOGY['อบต.'])
        applyTheme(data.theme_color ?? '#1d4ed8', data.ui_style)
        document.title = data.name
        try { injectPWAManifest(data) } catch (_) {}
        try {
          localStorage.setItem('sl_slug', data.slug)
          localStorage.setItem('sl_tenant_name', data.name)
        } catch (_) {}
        setLoading(false)
      } catch (err) {
        clearTimeout(timerId)
        if (!timedOut) {
          setError(`ไม่พบหน่วยงานรหัส "${slug}" ในระบบ`)
          setLoading(false)
        }
      }
    }

    fetchTenant()
  }, [])

  function patchTenant(fields) {
    setTenant((prev) => prev ? { ...prev, ...fields } : prev)
  }

  return (
    <TenantContext.Provider value={{ tenant, terminology, loading, error, patchTenant }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant ต้องใช้ภายใน TenantProvider')
  return ctx
}
