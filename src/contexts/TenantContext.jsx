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

  // Path mode: smartlocal.vercel.app/namlao/...
  const segment = pathname.split('/').filter(Boolean)[0]
  return segment ?? null
}

function applyTheme(hexColor) {
  const root = document.documentElement
  root.style.setProperty('--color-primary', hexColor)

  // สร้าง hover shade (darken ~15%) โดยไม่ต้องพึ่ง library
  const r = parseInt(hexColor.slice(1, 3), 16)
  const g = parseInt(hexColor.slice(3, 5), 16)
  const b = parseInt(hexColor.slice(5, 7), 16)
  const darken = (v) => Math.max(0, Math.floor(v * 0.85)).toString(16).padStart(2, '0')
  root.style.setProperty('--color-primary-dark', `#${darken(r)}${darken(g)}${darken(b)}`)
  root.style.setProperty('--color-primary-rgb', `${r}, ${g}, ${b}`)
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
      const { data, error: dbError } = await supabase
        .from('municipalities')
        .select('id, slug, name, org_type, province, theme_color, logo_url, developer_name, website_url, facebook_url')
        .eq('slug', slug)
        .single()

      if (dbError || !data) {
        setError(`ไม่พบหน่วยงานรหัส "${slug}" ในระบบ`)
        setLoading(false)
        return
      }

      setTenant(data)
      setTerminology(TERMINOLOGY[data.org_type] ?? TERMINOLOGY['อบต.'])
      applyTheme(data.theme_color ?? '#1d4ed8')
      document.title = data.name
      setLoading(false)
    }

    fetchTenant()
  }, [])

  return (
    <TenantContext.Provider value={{ tenant, terminology, loading, error }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant ต้องใช้ภายใน TenantProvider')
  return ctx
}
