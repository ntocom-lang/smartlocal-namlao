import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CHANGE_TENANT_PARAM, PLATFORM_APP_NAME, fetchActiveTenants } from '../lib/platform'
import { buildPlatformPrivacyPolicy } from '../lib/privacyPolicy'
import { buildPlatformAccountDeletion, buildPlatformDownload, buildPlatformSupport } from '../lib/platformInfo'
import { InfoArticle } from './PrivacyPolicyPage'

// หน้ากลางบนโดเมนของแอป (app.rk-networks.com/privacy, /account/delete, /support, /download)
// 3 หน้าแรกคือ URL ที่กรอกในสโตร์ · /download ให้ลองติดตั้งก่อนขึ้นสโตร์ — แสดงแทนหน้าเลือกหน่วยงานเฉพาะ path เหล่านี้
// (App.jsx) เนื้อหาอยู่ที่ privacyPolicy.js / platformInfo.js
const BUILDERS = {
  privacy: buildPlatformPrivacyPolicy,
  'account-delete': buildPlatformAccountDeletion,
  support: buildPlatformSupport,
  download: buildPlatformDownload,
}
// หน้าที่ไม่แสดงรายชื่อหน่วยงาน ไม่ต้องยิงฐานข้อมูล (หน้าติดตั้งต้องเปิดได้แม้ฐานข้อมูลช้า)
const NEEDS_TENANTS = new Set(['privacy', 'account-delete', 'support'])

const FOOTER_LINKS = [
  { to: `/?${CHANGE_TENANT_PARAM}=1`, label: 'เลือกหน่วยงาน' },
  { to: '/download', label: 'ติดตั้งแอป' },
  { to: '/privacy', label: 'นโยบายความเป็นส่วนตัว' },
  { to: '/account/delete', label: 'ลบบัญชีผู้ใช้' },
  { to: '/support', label: 'ช่วยเหลือและติดต่อ' },
]

export default function PlatformInfoPage({ kind }) {
  // 'loading' | 'ready' | 'failed' — ปุ่มลองใหม่ตั้งกลับเป็น loading เอง attempt คือตัวสั่งให้ effect โหลดใหม่
  const [status, setStatus] = useState('loading')
  const [tenants, setTenants] = useState([])
  const [attempt, setAttempt] = useState(0)
  const needsTenants = NEEDS_TENANTS.has(kind)

  useEffect(() => {
    if (!needsTenants) return undefined
    let alive = true
    fetchActiveTenants(supabase).then(
      (list) => { if (alive) { setTenants(list); setStatus('ready') } },
      (err) => {
        console.error('[platform] โหลดรายชื่อหน่วยงานไม่สำเร็จ:', err?.message ?? err)
        if (alive) setStatus('failed')
      },
    )
    return () => { alive = false }
  }, [attempt, needsTenants])

  const doc = useMemo(() => BUILDERS[kind](tenants), [kind, tenants])

  useEffect(() => {
    document.title = `${doc.title} — ${PLATFORM_APP_NAME}`
  }, [doc.title])

  const footer = (
    <nav aria-label="หน้าอื่นของแอป" className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2">
      {FOOTER_LINKS.filter((link) => link.to !== `/${kind === 'account-delete' ? 'account/delete' : kind}`).map((link) => (
        <Link key={link.to} to={link.to} className="inline-flex min-h-11 items-center text-sm font-semibold underline"
          style={{ color: 'var(--color-primary)' }}>
          {link.label}
        </Link>
      ))}
    </nav>
  )

  return (
    <InfoArticle
      doc={doc}
      eyebrow={`แอป ${PLATFORM_APP_NAME}`}
      attr={kind === 'privacy' ? 'privacy' : 'platform'}
      version={kind === 'privacy'}
      toc={kind === 'privacy'}
      orgsStatus={needsTenants ? status : 'ready'}
      onRetry={() => { setStatus('loading'); setAttempt((n) => n + 1) }}
      footer={footer}
    />
  )
}
