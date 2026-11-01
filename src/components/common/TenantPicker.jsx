import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, FlaskConical, Landmark, Loader2, RefreshCw } from 'lucide-react'
import { supabase, initialAuthParams } from '../../lib/supabase'
import { toReliableImageUrl } from '../../lib/driveStorage'
import {
  CHANGE_TENANT_PARAM, PLATFORM_APP_NAME, VIA_APP_PATH,
  autoOpenSlug, fetchActiveTenants, forgetRememberedTenant, isPlatformHost, readRememberedTenant, rememberTenant,
  tenantArea, tenantHref,
} from '../../lib/platform'

// หน้า "เลือกหน่วยงานของท่าน" — แสดงแทนหน้า error เมื่อเปิดเว็บที่ไม่ระบุหน่วยงาน
// (www.rk-networks.com, ที่อยู่ที่พิมพ์ผิด ฯลฯ)
//
// ที่มา: 2026-10-02 ประชาชนทุ่งแค้วเข้าด้วย LINE แล้วถูกพาไปลงจอดเว็บน้ำเลา เพราะ redirect ที่ผิดถอยไปใช้
// Site URL ของ Supabase เดิมที่ชี้น้ำเลา จึงเปลี่ยน Site URL เป็น www.rk-networks.com ซึ่งไม่มี อปท.
// ผู้ใช้ที่หลุดมาตรงนี้ต้องมีทางกลับบ้านตัวเอง ไม่ใช่เจอข้อความ "ไม่พบรหัสหน่วยงาน กรุณาติดต่อผู้ดูแลระบบ"
// ที่ผู้สูงอายุแก้เองไม่ได้
//
// ไม่ผูกสังกัดใครทั้งสิ้น: หน้านี้ไม่มี tenant จึงไม่มีโค้ดไหนเติม municipality_id ให้บัญชี (checkAndFixProfile
// ทำงานเฉพาะเมื่อมี tenant) การเลือกหน่วยงานคือการไปเปิดเว็บของหน่วยงานนั้น แล้วเข้าสู่ระบบที่นั่นอีกครั้ง
//
// บนโดเมนของแอปจากสโตร์ (app.rk-networks.com — ดู src/lib/platform.js) หน้านี้คือหน้าแรกของแอป จึงทำเพิ่ม 3 อย่าง:
//   1. จำหน่วยงานที่เลือก ครั้งต่อไปพาเข้าเว็บ อปท. เอง (?change=1 จากเมนู "เปลี่ยนหน่วยงาน" = ขอเลือกใหม่)
//   2. แสดงหน่วยงานสาธิตท้ายรายการพร้อมป้าย ไว้ให้ผู้ตรวจแอปของสโตร์ลองใช้
//   3. ลิงก์หน้ากลาง (นโยบาย / ลบบัญชี / ช่วยเหลือ) ที่สโตร์ต้องให้เปิดได้จากในแอป
// โดเมนอื่น (www, subdomain พิมพ์ผิด) ทำงานเหมือนเดิมทุกอย่าง

function TenantLogo({ url }) {
  const [failed, setFailed] = useState(false)
  const src = url ? toReliableImageUrl(url) : null
  if (!src || failed) {
    return (
      <span className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
        <Landmark size={24} />
      </span>
    )
  }
  return (
    <img src={src} alt="" onError={() => setFailed(true)}
      className="w-12 h-12 rounded-xl object-contain bg-white border border-gray-100 shrink-0" />
  )
}

function TenantCard({ tenant, href, onPick, demo = false }) {
  const area = tenantArea(tenant)
  return (
    <a
      href={href}
      onClick={onPick}
      data-tenant-option={tenant.slug}
      className={`flex items-center gap-4 rounded-2xl border bg-white p-4 min-h-[72px] shadow-sm hover:border-blue-300 active:scale-[0.99] transition-all ${demo ? 'border-dashed border-amber-300' : 'border-gray-100'}`}
    >
      <TenantLogo url={tenant.logo_url} />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-gray-800 leading-snug">{tenant.name}</span>
        {demo ? (
          <span className="block text-sm text-amber-700">ทดลองใช้ — เรื่องที่แจ้งไม่ถึงหน่วยงานจริง</span>
        ) : area && (
          <span className="block text-sm text-gray-500">{area}</span>
        )}
      </span>
      <ChevronRight size={20} className="shrink-0 text-gray-300" />
    </a>
  )
}

export default function TenantPicker({ notice }) {
  const onPlatform = isPlatformHost()
  const wantsChange = onPlatform && new URLSearchParams(window.location.search).has(CHANGE_TENANT_PARAM)

  // 'loading' | 'opening' | 'ready' | 'failed' — เริ่มที่ loading และให้ปุ่มลองใหม่เป็นคนตั้งกลับเป็น loading เอง
  // (ไม่ setState ซ้ำใน effect) attempt คือตัวสั่งให้ effect โหลดใหม่ · opening = กำลังพาเข้าหน่วยงานที่จำไว้
  const [status, setStatus] = useState('loading')
  const [tenants, setTenants] = useState([])
  const [opening, setOpening] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    document.title = `เลือกหน่วยงาน — ${PLATFORM_APP_NAME}`
  }, [])

  useEffect(() => {
    let alive = true
    fetchActiveTenants(supabase).then(
      (list) => {
        if (!alive) return
        if (onPlatform) {
          const remembered = readRememberedTenant()
          const slug = autoOpenSlug({ remembered, tenants: list, wantsChange })
          if (slug) {
            // replace = กดย้อนกลับในเว็บ อปท. ไม่วนกลับมาหน้านี้ (ในแอป กดย้อนจากหน้าแรกของ อปท. = ออกจากแอป)
            setOpening(list.find((t) => t.slug === slug)?.name ?? slug)
            setStatus('opening')
            window.location.replace(tenantHref(slug, VIA_APP_PATH))
            return
          }
          // หน่วยงานที่จำไว้ถูกปิดใช้แล้ว — ลืมทิ้ง ไม่งั้นความจำที่ใช้ไม่ได้จะค้างอยู่ตลอด
          if (remembered && !wantsChange) forgetRememberedTenant()
        }
        setTenants(list)
        setStatus('ready')
      },
      (err) => {
        console.error('[tenant-picker] โหลดรายชื่อหน่วยงานไม่สำเร็จ:', err?.message ?? err)
        if (alive) setStatus('failed')
      },
    )
    return () => { alive = false }
  }, [attempt, onPlatform, wantsChange])

  // ผู้ใช้ที่เพิ่งกลับมาจาก LINE/Google แล้วลงจอดตรงนี้ (มี token ใน URL) ต้องรู้ว่าไม่ใช่ว่าเข้าไม่สำเร็จ
  // แค่เว็บนี้ไม่ใช่เว็บของหน่วยงานใด — session ที่ได้ผูกกับโดเมนนี้ จะไม่ตามไปเว็บหน่วยงาน ต้องกดเข้าสู่ระบบอีกครั้ง
  const justSignedIn = initialAuthParams.hasAccessToken || initialAuthParams.hasCode

  const realTenants = tenants.filter((t) => !t.isDemo)
  const demoTenants = onPlatform ? tenants.filter((t) => t.isDemo) : []
  const hrefOf = (slug) => (onPlatform ? tenantHref(slug, VIA_APP_PATH) : tenantHref(slug))
  // จำไว้ก่อนเบราว์เซอร์ออกจากหน้านี้ (ไม่ preventDefault — ลิงก์ยังพาไปได้แม้เครื่องปิด storage)
  const pick = (slug) => (onPlatform ? () => rememberTenant(slug) : undefined)

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10" data-tenant-picker={onPlatform ? 'app' : 'web'}>
      <div className="mx-auto w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md">
            <Landmark size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">เลือกหน่วยงานของท่าน</h1>
          <p className="mt-1 text-sm text-gray-500">
            {onPlatform
              ? 'เลือกครั้งเดียว ครั้งต่อไปแอปจะเปิดหน่วยงานนี้ให้เอง เปลี่ยนได้ที่เมนูเพิ่มเติม'
              : 'แต่ละหน่วยงานมีเว็บบริการประชาชนของตัวเอง'}
          </p>
        </div>

        {justSignedIn && (
          <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 leading-relaxed">
            ท่านเพิ่งเข้าสู่ระบบ แต่ลิงก์ที่เปิดมาไม่ได้ระบุหน่วยงาน
            กรุณาเลือกหน่วยงานของท่านด้านล่าง แล้วกดเข้าสู่ระบบอีกครั้งที่เว็บของหน่วยงานนั้น
          </div>
        )}

        {notice && !justSignedIn && (
          <p className="mb-4 text-center text-xs text-gray-400">{notice}</p>
        )}

        {(status === 'loading' || status === 'opening') && (
          <div className="flex items-center justify-center gap-2 py-10 text-gray-400" role="status"
            aria-label={status === 'opening' ? 'กำลังเปิดหน่วยงาน' : 'กำลังโหลดรายชื่อหน่วยงาน'}>
            <Loader2 size={20} className="animate-spin" />
            {status === 'opening' ? `กำลังเปิด${opening}...` : 'กำลังโหลดรายชื่อ...'}
          </div>
        )}

        {status === 'failed' && (
          <div className="rounded-2xl border border-red-100 bg-white p-6 text-center">
            <p className="text-sm text-red-500 font-medium">โหลดรายชื่อหน่วยงานไม่สำเร็จ อาจเกิดจากสัญญาณขาดช่วง</p>
            <button
              type="button"
              onClick={() => { setStatus('loading'); setAttempt((n) => n + 1) }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white active:scale-95 transition-all"
            >
              <RefreshCw size={16} /> ลองใหม่
            </button>
          </div>
        )}

        {status === 'ready' && realTenants.length === 0 && (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-gray-500">
            ยังไม่มีรายชื่อหน่วยงาน กรุณาติดต่อผู้ดูแลระบบ
          </p>
        )}

        {status === 'ready' && realTenants.length > 0 && (
          <ul className="space-y-3">
            {realTenants.map((t) => (
              <li key={t.slug}>
                <TenantCard tenant={t} href={hrefOf(t.slug)} onPick={pick(t.slug)} />
              </li>
            ))}
          </ul>
        )}

        {status === 'ready' && demoTenants.length > 0 && (
          <section className="mt-8" aria-labelledby="tenant-picker-demo">
            <h2 id="tenant-picker-demo" className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <FlaskConical size={14} aria-hidden="true" /> ทดลองใช้งาน (ข้อมูลสมมติ)
            </h2>
            <ul className="space-y-3">
              {demoTenants.map((t) => (
                <li key={t.slug}>
                  <TenantCard tenant={t} href={hrefOf(t.slug)} onPick={pick(t.slug)} demo />
                </li>
              ))}
            </ul>
          </section>
        )}

        {onPlatform && status !== 'opening' && (
          <nav aria-label="ข้อมูลของแอป" className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1">
            <Link to="/privacy" className="inline-flex min-h-11 items-center text-sm text-gray-500 underline">นโยบายความเป็นส่วนตัว</Link>
            <Link to="/account/delete" className="inline-flex min-h-11 items-center text-sm text-gray-500 underline">ลบบัญชีผู้ใช้</Link>
            <Link to="/support" className="inline-flex min-h-11 items-center text-sm text-gray-500 underline">ช่วยเหลือและติดต่อ</Link>
          </nav>
        )}
      </div>
    </div>
  )
}
