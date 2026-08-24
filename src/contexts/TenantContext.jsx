import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toReliableImageUrl } from '../lib/driveStorage'

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

    // favicon แท็บเบราว์เซอร์ — index.html hardcode /logo.png (โลโก้ namlao ตัวเดิมสมัย single-tenant)
    // ไว้เป็นค่าเริ่มต้นก่อน JS โหลดเสร็จ ทุก tenant deploy จากโค้ดชุดเดียวกันเลยเห็นโลโก้เดียวกันหมดถ้า
    // ไม่มาแก้ href ตรงนี้ทับหลัง fetch tenant เสร็จ — แก้ทั้ง rel="icon" และ "shortcut icon" (บาง
    // เบราว์เซอร์ใช้ tag คนละอันกัน)
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(el => {
      el.href = tenant.logo_url
    })
  }
}

export function applyTheme(hexColor, uiStyle = 'default') {
  const root = document.documentElement

  // kledkaew theme ใช้เขียวเสมอ ไม่ว่า DB จะกำหนดสีอะไร
  const effectiveColor = uiStyle === 'kledkaew' ? '#059669' : hexColor

  root.style.setProperty('--color-primary', effectiveColor)

  // สร้าง hover shade (darken ~15%) โดยไม่ต้องพึ่ง library
  const r = parseInt(effectiveColor.slice(1, 3), 16)
  const g = parseInt(effectiveColor.slice(3, 5), 16)
  const b = parseInt(effectiveColor.slice(5, 7), 16)
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
          .select('id, slug, name, org_type, province, district, theme_color, layout_theme, ui_style, theme_presets, show_posts_highlight, logo_url, header_image_url, header_image_mode, category_icon_style, smart_city_image_url, developer_name, website_url, facebook_url, line_oa_url, phone, fax, address, email, internal_extensions, latitude, longitude, system_name, system_subtitle, pwa_short_name, enabled_modules, telegram_group_id, promptpay_id, fee_schedule, qr_code_url, qr_label, bank_name, bank_account_no, bank_account_name')
          .eq('slug', slug)
          .single()

        clearTimeout(timerId)
        if (timedOut) return

        if (dbError || !data) {
          setError(`ไม่พบหน่วยงานรหัส "${slug}" ในระบบ`)
          setLoading(false)
          return
        }

        // Google fields were added later than the core tenant schema. Read separately so an environment that
        // hasn't applied that migration can still load the whole app.
        // เฉพาะ google_maps_api_key เท่านั้นที่ต้องส่งให้ browser จริง (Google Maps JS SDK ต้องใช้ฝั่ง client
        // ป้องกันด้วย HTTP referrer restriction บน Google Cloud Console ไม่ใช่การซ่อน) — ส่วน
        // google_cloud_email/google_project_id เป็นข้อมูลอ้างอิงสำหรับแอดมินเท่านั้น ไม่ต้องส่งให้ผู้เยี่ยมชมทุกคน
        // (เดิมดึงมาด้วย ทำให้ทุกคนที่เปิดเว็บเห็นอีเมล/project id ของ Google Cloud ผ่าน Network tab — แก้แล้ว
        // ดู GoogleMapsSettings.jsx ซึ่งดึง 2 ฟิลด์นี้เองตอนแอดมินเปิดหน้าตั้งค่าแทน)
        const { data: googleConfig, error: googleConfigError } = await supabase
          .from('municipalities')
          .select('google_maps_api_key')
          .eq('id', data.id)
          .maybeSingle()
        const merged = googleConfigError ? data : { ...data, ...googleConfig }
        // แก้ logo_url/header_image_url ที่อาจเป็น URL Drive แบบเก่า (uc?id= หรือ lh3...=s0) ที่ถูก
        // Chromium/Edge บล็อกด้วย ORB เวลาฝังเป็น <img> — ดู toReliableImageUrl ใน driveStorage.js
        // แก้ตรงจุดเดียวตรงนี้ ครอบคลุมทุกที่ในแอปที่อ่าน tenant.logo_url / tenant.header_image_url
        // จาก useTenant() (Header/BottomNav ของทุกธีม, PWA manifest ฯลฯ) โดยไม่ต้องแก้ทีละไฟล์
        const resolvedTenant = {
          ...merged,
          logo_url: toReliableImageUrl(merged.logo_url),
          header_image_url: toReliableImageUrl(merged.header_image_url),
          smart_city_image_url: toReliableImageUrl(merged.smart_city_image_url),
        }

        setTenant(resolvedTenant)
        setTerminology(TERMINOLOGY[resolvedTenant.org_type] ?? TERMINOLOGY['อบต.'])
        applyTheme(resolvedTenant.theme_color ?? '#1d4ed8', resolvedTenant.ui_style)
        document.title = resolvedTenant.name
        try { injectPWAManifest(resolvedTenant) } catch (_) {}
        try {
          localStorage.setItem('sl_slug', resolvedTenant.slug)
          localStorage.setItem('sl_tenant_name', resolvedTenant.name)
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
