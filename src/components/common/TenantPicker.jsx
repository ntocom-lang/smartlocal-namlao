import { useEffect, useState } from 'react'
import { ChevronRight, Landmark, Loader2, RefreshCw } from 'lucide-react'
import { supabase, initialAuthParams } from '../../lib/supabase'
import { toReliableImageUrl } from '../../lib/driveStorage'

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

// โดเมนหลักของระบบ — ใช้ตอนเปิดหน้านี้จากที่ที่บอกโดเมนไม่ได้ (localhost, *.vercel.app)
// (ThemeSettingsAdmin.getMuniUrl ใช้ค่าเดียวกันเป็น fallback)
const PLATFORM_DOMAIN = 'rk-networks.com'

// หน่วยงานที่ไม่แสดงให้ประชาชนเลือก: สนามซ้อม (demo = เทศบาลตำบลสาธิต) ใช้ทดสอบกับข้อมูลสมมติเท่านั้น
// ประชาชนที่กดเข้าไปจะสับสนและไปสมัครบัญชีในที่ที่ไม่มีเจ้าหน้าที่จริง
// ฐานข้อมูลไม่มีคอลัมน์บอกว่า อปท. ไหนเป็นของทดสอบ (มีแค่ is_active ซึ่ง demo ก็เป็น true) จึงระบุที่นี่
// ถ้ามีสนามซ้อมเพิ่มในอนาคตต้องมาเติม slug ตรงนี้ หรือเพิ่มคอลัมน์ในฐานข้อมูลแทน
const HIDDEN_SLUGS = new Set(['demo'])

// ลิงก์ไปเว็บของหน่วยงาน — ตัดป้ายชื่อหน้าสุดของโดเมนปัจจุบันออกแล้วต่อ slug ลงไป
// (www.rk-networks.com → slug.rk-networks.com) ตัดป้ายแรกเสมอ ไม่ว่าจะเป็น www หรือ subdomain ที่พิมพ์ผิด
// (thungkaw.rk-networks.com → thungkaew.rk-networks.com) ใช้ https เสมอ เหมือนที่ Worker บังคับ
function tenantHref(slug) {
  const { hostname } = window.location
  const onVendorHost = hostname.endsWith('.vercel.app') || hostname === 'localhost' || hostname === '127.0.0.1' || /^\d/.test(hostname)
  const parts = hostname.split('.')
  const base = !onVendorHost && parts.length >= 3 ? parts.slice(1).join('.') : PLATFORM_DOMAIN
  return `https://${slug}.${base}/`
}

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

// ดึงรายชื่อหน่วยงานที่แสดงให้ประชาชนเลือก — แยกเป็นฟังก์ชันล้วน (ไม่แตะ state) ให้ effect เรียกผ่าน .then
async function fetchPublicTenants() {
  // อ่านเฉพาะคอลัมน์ที่ anon มีสิทธิ์ (municipalities ใช้ column-level grant) และ RLS ให้เห็นเฉพาะ is_active
  // ห้ามเพิ่มคอลัมน์ในลิสต์นี้โดยไม่เช็คสิทธิ์ ไม่งั้นทั้ง query ล้มด้วย 42501
  const { data, error } = await supabase
    .from('municipalities')
    .select('slug, name, org_type, province, district, logo_url')
    .eq('is_active', true)
  if (error) throw error
  return (data ?? [])
    .filter((t) => t.slug && t.name && !HIDDEN_SLUGS.has(t.slug))
    .sort((a, b) => (a.province ?? '').localeCompare(b.province ?? '', 'th') || a.name.localeCompare(b.name, 'th'))
}

export default function TenantPicker({ notice }) {
  // 'loading' | 'ready' | 'failed' — เริ่มที่ loading และให้ปุ่มลองใหม่เป็นคนตั้งกลับเป็น loading เอง
  // (ไม่ setState ซ้ำใน effect) attempt คือตัวสั่งให้ effect โหลดใหม่
  const [status, setStatus] = useState('loading')
  const [tenants, setTenants] = useState([])
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    document.title = 'เลือกหน่วยงาน — SmartLocal'
  }, [])

  useEffect(() => {
    let alive = true
    fetchPublicTenants().then(
      (list) => { if (alive) { setTenants(list); setStatus('ready') } },
      (err) => {
        console.error('[tenant-picker] โหลดรายชื่อหน่วยงานไม่สำเร็จ:', err?.message ?? err)
        if (alive) setStatus('failed')
      },
    )
    return () => { alive = false }
  }, [attempt])

  // ผู้ใช้ที่เพิ่งกลับมาจาก LINE/Google แล้วลงจอดตรงนี้ (มี token ใน URL) ต้องรู้ว่าไม่ใช่ว่าเข้าไม่สำเร็จ
  // แค่เว็บนี้ไม่ใช่เว็บของหน่วยงานใด — session ที่ได้ผูกกับโดเมนนี้ จะไม่ตามไปเว็บหน่วยงาน ต้องกดเข้าสู่ระบบอีกครั้ง
  const justSignedIn = initialAuthParams.hasAccessToken || initialAuthParams.hasCode

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md">
            <Landmark size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">เลือกหน่วยงานของท่าน</h1>
          <p className="mt-1 text-sm text-gray-500">แต่ละหน่วยงานมีเว็บบริการประชาชนของตัวเอง</p>
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

        {status === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-10 text-gray-400" role="status" aria-label="กำลังโหลดรายชื่อหน่วยงาน">
            <Loader2 size={20} className="animate-spin" /> กำลังโหลดรายชื่อ...
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

        {status === 'ready' && tenants.length === 0 && (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-gray-500">
            ยังไม่มีรายชื่อหน่วยงาน กรุณาติดต่อผู้ดูแลระบบ
          </p>
        )}

        {status === 'ready' && tenants.length > 0 && (
          <ul className="space-y-3">
            {tenants.map((t) => (
              <li key={t.slug}>
                <a
                  href={tenantHref(t.slug)}
                  className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 min-h-[72px] shadow-sm hover:border-blue-300 active:scale-[0.99] transition-all"
                >
                  <TenantLogo url={t.logo_url} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-gray-800 leading-snug">{t.name}</span>
                    {(t.district || t.province) && (
                      <span className="block text-sm text-gray-500">
                        {[t.district && `อ.${t.district}`, t.province && `จ.${t.province}`].filter(Boolean).join(' ')}
                      </span>
                    )}
                  </span>
                  <ChevronRight size={20} className="shrink-0 text-gray-300" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
