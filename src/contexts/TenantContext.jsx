import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { toReliableImageUrl } from '../lib/driveStorage'
import { MANAGED_MODULE_KEYS } from '../lib/staffModules'
import { loadHolidays } from '../lib/holidaysSource'
import { ORG_TERMS, getOrgTerms, setActiveOrgType, DEFAULT_ORG_TYPE } from '../lib/orgTerms'

const TenantContext = createContext(null)

// ลำดับสำคัญมาก: hostname ต้องมาก่อน VITE_TENANT_SLUG เสมอ ห้ามสลับกลับ
//
// ของเดิมเช็ค env var เป็นข้อแรก ซึ่งพังหนักตอนย้ายไป Cloudflare (2026-08-28):
// Vite ฝังค่า env ลงบันเดิลตอน build และ .env.local ในเครื่องนักพัฒนามี
// VITE_TENANT_SLUG=namlao อยู่ พอ build ในเครื่องแทนที่จะ build บน CI แบบเดิม
// minifier เห็นว่า if ข้อแรกเป็นจริงเสมอ เลยลบตรรกะอ่าน hostname ทิ้งทั้งก้อน
// เหลือ `function detectTenantSlug(){return "namlao"}` ผลคือ *ทุก* อปท.
// แสดงข้อมูลของน้ำเลา ซึ่งเป็นข้อมูลจริงของประชาชน
//
// env var มีไว้สำหรับกรณีที่ hostname บอกอะไรไม่ได้จริงๆ เท่านั้น คือ dev server
// ที่รันบน localhost จึงต้องเป็น fallback ท้ายสุด ไม่ใช่ข้อแรก
function detectTenantSlug() {
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

  // build ที่ปักหมุด อปท. ไว้แล้ว (dev server) ต้องเช็คก่อน path mode ไม่ใช่หลัง
  //
  // ต้องตรงกับ computeBasename() ใน src/lib/basename.js ที่คืน '' ทันทีที่เจอ VITE_TENANT_SLUG
  // ของเดิมที่นี่ไล่ path segment ก่อน ทำให้สองไฟล์ตีความ URL เดียวกันคนละแบบ: เปิด
  // http://localhost:5173/complaint ตรงๆ แล้ว slug กลายเป็น "complaint" (ยิง
  // ?slug=eq.complaint ได้ 406) ส่วน router ที่ basename = '' ก็หา route ไม่เจอ ขึ้นหน้าว่าง
  //
  // เงื่อนไข hostname ต้องอยู่หน้าสุดของ if เสมอ ห้ามเหลือแค่ `if (VITE_TENANT_SLUG)` ลอยๆ
  // ไม่งั้น minifier จะมองว่าเป็นจริงเสมอตอน build แล้วลบตรรกะ hostname ข้างบนทิ้งทั้งก้อน
  // (บั๊กจริงตอนย้าย Cloudflare 2026-08-28 ที่ทำให้ทุก อปท. กลายเป็นน้ำเลา)
  const pinnedSlug = import.meta.env.VITE_TENANT_SLUG
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && pinnedSlug) {
    return pinnedSlug
  }

  // Path mode: smartlocal.vercel.app/namlao/... (deployment กลางแบบ path-based เท่านั้น)
  const segment = pathname.split('/').filter(Boolean)[0]
  if (segment) return segment

  return null
}

function autoShortName(tenant) {
  if (tenant.pwa_short_name) return tenant.pwa_short_name
  // ตั้งใจอ่าน ORG_TERMS ตรงๆ ไม่ผ่าน getOrgTerms() — org_type ที่ไม่รู้จักต้องได้ชื่อเต็ม
  // ไม่ใช่ตกไปใช้ตัวย่อของ อบต. ซึ่งจะได้ชื่อย่อผิดประเภทหน่วยงาน
  const terms = ORG_TERMS[tenant.org_type]
  if (!terms?.abbr) return tenant.name
  const location = tenant.name.replace(terms.strip, '').trim()
  return terms.abbr + location
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

const DEFAULT_THEME_COLOR = '#1d4ed8'

// theme_color มาจากช่องที่แอดมินกรอกเองใน DB จึงไว้ใจรูปแบบไม่ได้ — เจอได้ทั้งค่าว่าง, hex 3 หลัก
// (#059), ไม่มี #, หรือชนิดที่ไม่ใช่สตริงถ้าข้อมูลเพี้ยน ของเดิม slice+parseInt ตรงๆ ทำให้
//   - ค่าว่าง/3 หลัก → parseInt('') = NaN → เซ็ต --color-primary-dark เป็น '#NaNNaNNaN' ทั้งแอป
//   - ไม่ใช่สตริง → .slice โยน TypeError ซึ่งถูก try/catch ของ fetchTenant จับ แล้วขึ้นหน้า
//     "ไม่พบหน่วยงานรหัส ... ในระบบ" ทั้งที่โหลด อปท. สำเร็จแล้ว — สีผิดไม่ควรล้มทั้งแอป
function normalizeHexColor(value) {
  if (typeof value !== 'string') return DEFAULT_THEME_COLOR
  const hex = value.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`
  // hex ย่อ 3 หลัก: #059 → #005599
  if (/^[0-9a-fA-F]{3}$/.test(hex)) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  return DEFAULT_THEME_COLOR
}

export function applyTheme(hexColor, uiStyle = 'default') {
  const root = document.documentElement

  const effectiveColor = normalizeHexColor(hexColor)

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
  const [terminology, setTerminology] = useState(getOrgTerms(DEFAULT_ORG_TYPE))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // ตัวนับรอบการโหลดวันหยุดราชการ — ไม่มีใครอ่านค่านี้ตรงๆ แต่การเปลี่ยนค่ามันบังคับให้
  // ทุก component ที่ใช้ useTenant() เรนเดอร์ใหม่ ตัวเลข "เหลือ N วันทำการ" ที่คำนวณไปแล้ว
  // จากตาราง static จึงถูกคิดใหม่ตามข้อมูลใน DB โดยไม่ต้องแก้ component สักตัว
  const [holidaysVersion, setHolidaysVersion] = useState(0)

  // เรียกซ้ำได้หลังแอดมินบันทึกการแก้ไขวันหยุด เพื่อให้ทั้งแอปเห็นค่าใหม่ทันทีโดยไม่ต้องรีเฟรช
  const reloadHolidays = useCallback(async (municipalityId) => {
    await loadHolidays(municipalityId ?? tenant?.id ?? null)
    setHolidaysVersion(v => v + 1)
  }, [tenant?.id])

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
          .select('id, slug, name, org_type, province, district, theme_color, layout_theme, ui_style, theme_presets, show_posts_highlight, logo_url, header_image_url, header_image_mode, category_icon_style, smart_city_image_url, developer_name, website_url, facebook_url, line_oa_url, phone, fax, address, email, internal_extensions, event_location_presets, latitude, longitude, system_name, system_subtitle, pwa_short_name, enabled_modules, telegram_group_id, promptpay_id, fee_schedule, qr_code_url, qr_label, bank_name, bank_account_no, bank_account_name')
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
        // ต้องตั้งก่อน setTerminology เสมอ — โค้ดนอก React (staffRoster.js ฯลฯ) อ่านค่านี้ผ่าน
        // activeOrgTerms() ไม่ได้ subscribe context จึงไม่มีอะไรมาบังคับลำดับให้
        setActiveOrgType(resolvedTenant.org_type)
        setTerminology(getOrgTerms(resolvedTenant.org_type))
        applyTheme(resolvedTenant.theme_color ?? '#1d4ed8', resolvedTenant.ui_style)
        document.title = resolvedTenant.name
        try { injectPWAManifest(resolvedTenant) } catch {}
        try {
          localStorage.setItem('sl_slug', resolvedTenant.slug)
          localStorage.setItem('sl_tenant_name', resolvedTenant.name)
        } catch {}
        setLoading(false)

        // ตั้งใจไม่ await และไม่กั้น setLoading — หน้าจอต้องขึ้นทันทีตามเดิม ระหว่างรอ
        // ตัวคำนวณจะใช้ตาราง static ในโค้ดไปก่อน พอข้อมูลมาถึงค่อยเรนเดอร์ใหม่ผ่าน holidaysVersion
        loadHolidays(resolvedTenant.id).then(() => setHolidaysVersion(v => v + 1))
      } catch {
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

  // โมดูลนี้เปิดขายให้ อปท. นี้หรือยัง — จุดตัดสินใจเดียวของทั้งระบบ ใช้ทั้งหน้าเจ้าหน้าที่และหน้าประชาชน
  //
  // ต้องตอบ true ระหว่างที่ tenant ยังโหลดไม่เสร็จ (tenant = null) ไม่งั้นทุกหน้าจะกะพริบเป็น
  // "ไม่มีสิทธิ์" หนึ่งเฟรมก่อนข้อมูลมา แล้วตัว <RequireModule> จะเด้งผู้ใช้ออกจากหน้าที่เขาเปิดถูกแล้ว
  // ส่วน enabled_modules = null (แถวเก่าที่ไม่เคยตั้งค่า) แปลว่า "เปิดทุกโมดูล" ตามพฤติกรรมเดิม
  //
  // คีย์ที่ไม่ได้อยู่ในลิสต์ที่ตั้งค่าได้ (MANAGED_MODULE_KEYS) ให้ผ่านเสมอ เพราะไม่มี UI ให้ปิด
  // การเช็คคีย์ที่ไม่มีใครตั้งค่าได้แล้วคืน false เท่ากับปิดฟีเจอร์ทิ้งโดยไม่มีใครเปิดกลับได้
  function isModuleEnabled(key) {
    if (!key) return true
    if (!tenant || !Array.isArray(tenant.enabled_modules)) return true
    if (!MANAGED_MODULE_KEYS.includes(key)) return true
    return tenant.enabled_modules.includes(key)
  }

  return (
    <TenantContext.Provider value={{ tenant, terminology, loading, error, patchTenant, isModuleEnabled, holidaysVersion, reloadHolidays }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant ต้องใช้ภายใน TenantProvider')
  return ctx
}
