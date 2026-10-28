import { useState, useEffect, useRef } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { supabase, signOutSafely, getSessionResilient } from '../lib/supabase'
import { ChevronRight, FileSignature, Pencil, Loader2, X, Eye, EyeOff, Smartphone } from 'lucide-react'
import { compressImage } from '../lib/imageUtils'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { NAME_TITLES, splitThaiFullName, joinThaiFullName } from '../lib/thaiName'
import { THAI_PROVINCES, thaiDistrictsOf, thaiSubdistrictsOf } from '../lib/thaiAddress'
import { tenantDefaultSubdistrict } from '../lib/tenantSubdistrict'
import ActiveSessions from '../components/profile/ActiveSessions'
import AccountPageLayout from '../components/profile/AccountPageLayout'
import { validateNewPassword, PASSWORD_HINT } from '../lib/passwordPolicy'
import { toHttps } from '../lib/basename'
import { activeOrgTerms } from '../lib/orgTerms'

// role ที่ใช้การเข้าสู่ระบบด้วย QR ได้ ต้องตรงกับ STAFF_ROLES ใน edge function device-login
const STAFF_ROLES = ['superadmin', 'admin', 'officer', 'technician', 'staff', 'viewer', 'council']

const ROLE_LABEL = {
  superadmin: 'Super Admin',
  admin:      'แอดมินระบบ',
  officer:    'หัวหน้ากอง',
  technician: 'ปฏิบัติงาน',
  staff:      'เจ้าหน้าที่',
  viewer:     'ผู้บริหาร',
  // getter เพราะคำเรียกสภาเปลี่ยนตาม org_type และค่านี้ยังไม่พร้อมตอน import — ดู src/lib/orgTerms.js
  get council() { return activeOrgTerms().councilOrg },
  citizen:    'ประชาชน',
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const { hash, search } = useLocation()
  const isSecurity = hash === '#security' || new URLSearchParams(search).get('tab') === 'security'
  const { role: contextRole, profileLoading, profileError, refreshProfile } = useAuth()
  const { tenant } = useTenant()
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState({
    full_name: '', phone: '', role: '', id_card: '',
    address_province: '', address_district: '', address_subdistrict: '', address_moo: '', address_detail: '',
  })
  const [nameParts, setNameParts] = useState({ title: '', first: '', last: '' })
  const [savedProfile, setSavedProfile] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [editName, setEditName] = useState(false)
  const [editPhone, setEditPhone] = useState(false)
  const [editIdCard, setEditIdCard] = useState(false)
  const [editAddress, setEditAddress] = useState(false)
  const [isGoogleLinked, setIsGoogleLinked] = useState(false)
  const [isLineLinked, setIsLineLinked] = useState(false)
  const [linking, setLinking] = useState('')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const fileRef = useRef()
  const securityRef = useRef(null)

  // ลิงก์เมนูบัญชีพามายังส่วนที่เกี่ยวข้องโดยตรง ไม่เปิดฟอร์มเปลี่ยนรหัสผ่านให้เอง
  useEffect(() => {
    if (loading || hash !== '#security') return
    securityRef.current?.scrollIntoView({ block: 'start' })
    securityRef.current?.focus({ preventScroll: true })
  }, [loading, hash])

  useEffect(() => {
    // getSessionResilient: เน็ตสะดุดตอนต่ออายุ token ต้องไม่พาออกจากระบบ (ดูเหตุผลที่ src/lib/supabase.js)
    getSessionResilient().then(async ({ data }) => {
      const s = data.session
      if (!s) { navigate('/auth'); return }
      setSession(s)

      const meta = s.user.user_metadata
      setAvatarUrl(meta?.avatar_url || meta?.picture || null)
      const providers = s.user.app_metadata?.providers ?? []
      setIsGoogleLinked(providers.includes('google'))
      setIsLineLinked(providers.includes('custom:line'))

      const { data: p } = await supabase
        .from('profiles')
        .select('full_name, phone, avatar_url, role, id_card, address_province, address_district, address_subdistrict, address_moo, address_detail')
        .eq('id', s.user.id)
        .single()

      // ยังไม่เคยตั้งที่อยู่มาก่อน (บัญชีใหม่/ยังไม่ได้กรอก) — ตั้งค่าเริ่มต้นจากจังหวัด/อำเภอ/ตำบลของ
      // เทศบาลเจ้าของเว็บเอง (tenant.province/district + tenantDefaultSubdistrict) เพราะผู้ใช้ส่วนใหญ่
      // ของแต่ละเทศบาลมักอยู่ในพื้นที่นั้นจริง — ไม่ได้ hardcode ชื่อจังหวัดตายตัว เทศบาลอื่นที่ใช้ระบบ
      // เดียวกันจะได้ค่าเริ่มต้นถูกต้องตามพื้นที่ตัวเอง (สูตรเดียวกับที่ AdminDashboard.jsx ใช้)
      if (p) {
        const fullName = p.full_name || meta?.full_name || ''
        const loadedProfile = {
          full_name: fullName,
          phone: p.phone || meta?.phone || '',
          role: p.role || '',
          id_card: p.id_card || '',
          address_province: p.address_province || tenant?.province || '',
          address_district: p.address_district || tenant?.district || '',
          address_subdistrict: p.address_subdistrict || tenantDefaultSubdistrict(tenant),
          address_moo: p.address_moo || '',
          address_detail: p.address_detail || '',
        }
        setProfile(loadedProfile)
        setSavedProfile(JSON.stringify(loadedProfile))
        setNameParts(splitThaiFullName(fullName))
        setAvatarUrl(p.avatar_url || meta?.avatar_url || meta?.picture || null)
      } else {
        const fullName = meta?.full_name || ''
        const loadedProfile = {
          full_name: fullName,
          phone: meta?.phone || '',
          role: '',
          id_card: '',
          address_province: tenant?.province || '', address_district: tenant?.district || '',
          address_subdistrict: tenantDefaultSubdistrict(tenant), address_moo: '', address_detail: '',
        }
        setProfile(loadedProfile)
        setSavedProfile(JSON.stringify(loadedProfile))
        setNameParts(splitThaiFullName(fullName))
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [navigate, tenant?.province, tenant?.district])

  function setNamePart(key, value) {
    setNameParts(prev => {
      const next = { ...prev, [key]: value }
      setProfile(p => ({ ...p, full_name: joinThaiFullName(next.title, next.first, next.last) }))
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setMsg('')
    setError('')
    if (profile.id_card && !/^\d{13}$/.test(profile.id_card)) {
      setError('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก')
      setSaving(false)
      return
    }
    const { error: err } = await supabase
      .from('profiles')
      .upsert({
        id: session.user.id,
        full_name: profile.full_name,
        phone: profile.phone,
        id_card: profile.id_card || null,
        address_province: profile.address_province || null,
        address_district: profile.address_district || null,
        address_subdistrict: profile.address_subdistrict || null,
        address_moo: profile.address_moo || null,
        address_detail: profile.address_detail || null,
      })
    setSaving(false)
    if (err) { setError('บันทึกไม่สำเร็จ: ' + err.message); return }
    setMsg('บันทึกข้อมูลเรียบร้อยแล้ว')
    setSavedProfile(JSON.stringify(profile))
    setEditName(false)
    setEditPhone(false)
    setEditIdCard(false)
    setEditAddress(false)
    refreshProfile?.()
  }

  // แสดงที่อยู่รวมเป็นบรรทัดเดียว รูปแบบเดียวกับ formatStructuredAddress ใน AdminDashboard.jsx
  // (หน้าแอดมินที่แก้ที่อยู่สมาชิกแทนได้) — คงรูปแบบให้ตรงกันทั้งสองที่
  function formatAddress(p) {
    const parts = []
    if (p.address_detail) parts.push(p.address_detail)
    if (p.address_moo) parts.push(`หมู่ ${p.address_moo}`)
    if (p.address_subdistrict) parts.push(`ต.${p.address_subdistrict}`)
    if (p.address_district) parts.push(`อ.${p.address_district}`)
    if (p.address_province) parts.push(`จ.${p.address_province}`)
    return parts.join(' ') || null
  }

  // ใช้ supabase.auth.updateUser({password}) แบบเดียวกับ ResetPasswordPage.jsx — ต้องมี session ที่
  // login อยู่แล้วเท่านั้น (หน้านี้เช็ค session ตอนโหลดอยู่แล้ว ไม่มี session เด้งไป /auth ก่อนถึงตรงนี้)
  // ไม่ได้บังคับให้กรอกรหัสผ่านเดิมก่อน (Supabase ไม่มี endpoint ยืนยันรหัสเดิมแบบตรงๆ ให้ใช้ ต้องทำ
  // reauth flow เพิ่มเองถ้าต้องการเข้มกว่านี้) — พฤติกรรมเดียวกับหน้า "ลืมรหัสผ่าน" เดิมที่มีอยู่แล้ว
  async function handleChangePassword() {
    setError('')
    setMsg('')
    const passwordError = validateNewPassword(newPassword)
    if (passwordError) { setError(passwordError); return }
    if (newPassword !== confirmPassword) { setError('รหัสผ่านไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง'); return }
    setChangingPassword(true)
    const { error: err } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)
    if (err) { setError('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + err.message); return }
    setMsg('เปลี่ยนรหัสผ่านสำเร็จแล้ว')
    setShowChangePassword(false)
    setNewPassword('')
    setConfirmPassword('')
  }

  async function handleLogout() {
    await signOutSafely('/')
    navigate('/')
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return

    if (avatarUrl?.startsWith('blob:')) URL.revokeObjectURL(avatarUrl)
    setAvatarUrl(URL.createObjectURL(file))
    setSaving(true)
    setMsg('')
    setError('')

    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${session.user.id}/avatar.${ext}`

    const compressed = await compressImage(file, 400)
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, compressed, { upsert: true })

    if (upErr) {
      console.error('Storage upload error:', upErr)
      setError('อัปโหลดรูปไม่สำเร็จ: ' + upErr.message)
      setSaving(false)
      return
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

    await supabase.from('profiles').upsert({ id: session.user.id, avatar_url: publicUrl })
    setAvatarUrl(publicUrl)
    setMsg('อัปโหลดรูปโปรไฟล์สำเร็จ')
    setSaving(false)
    refreshProfile?.()
  }

  // ของเดิม await แล้วทิ้งค่าที่คืนมาทั้งก้อน ไม่ดู error ไม่มีสปินเนอร์ ไม่มีข้อความ ผู้ใช้กดแล้ว
  // ไม่มีอะไรเกิดขึ้นเลย แยกไม่ออกว่าเน็ตช้า กดไม่โดน หรือระบบพัง แล้วก็กดซ้ำไปเรื่อยๆ
  //
  // linkIdentity คืน { error } เมื่อ API ปฏิเสธ (เช่น identity นั้นผูกกับผู้ใช้รายอื่นอยู่แล้ว หรือ
  // "Allow manual linking" ถูกปิดในโปรเจกต์) และ reject ได้ด้วยเมื่อเน็ตหลุด/ชน timeout ของ
  // fetchWithTimeout ต้องครอบทั้งสองแบบ — รูปเดียวกับ startOAuth ใน AuthPage.jsx
  //
  // สำเร็จ = เบราว์เซอร์กำลัง redirect ออกไปหน้า provider จึง return ทิ้งสปินเนอร์ค้างไว้ตามเดิม
  // การเคลียร์ค่าท้ายฟังก์ชันจึงมีผลเฉพาะตอนไปต่อไม่ได้เท่านั้น
  async function linkProvider(provider, label) {
    setMsg('')
    setError('')
    setLinking(provider)
    try {
      const { error: err } = await supabase.auth.linkIdentity({
        provider,
        // toHttps: ถ้าหน้านี้เปิดแบบ http:// Supabase จะปฏิเสธ redirectTo แล้วส่งไป Site URL (น้ำเลา)
        options: { redirectTo: toHttps(window.location.href) },
      })
      if (!err) return

      const message = String(err.message ?? '')
      // เคสที่ผู้ใช้เจอบ่อยสุด: เคยสมัครไว้อีกบัญชีด้วย provider เดียวกันโดยไม่รู้ตัว
      // ต้องบอกทางออกให้ด้วย ไม่ใช่แค่บอกว่าไม่สำเร็จ เพราะเขาแก้เองไม่ได้
      if (/already|exists|duplicate|linked/i.test(message)) {
        setError(`บัญชี ${label} นี้ถูกใช้ผูกกับผู้ใช้รายอื่นในระบบอยู่แล้ว หากเป็นบัญชีของท่านเอง กรุณาติดต่อเจ้าหน้าที่เพื่อรวมบัญชี`)
      } else if (/manual linking|not enabled|disabled/i.test(message)) {
        setError(`ระบบยังไม่เปิดให้เชื่อมต่อบัญชี ${label} กรุณาแจ้งผู้ดูแลระบบ`)
      } else {
        setError(`เชื่อมต่อ ${label} ไม่สำเร็จ: ${message}`)
      }
    } catch (err) {
      console.error(`[profile] linkIdentity(${provider}) ล้มเหลว:`, err?.message ?? err)
      setError(`เชื่อมต่อ ${label} ไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่`)
    }
    setLinking('')
  }

  // คงลิงก์/บุ๊กมาร์กเดิมให้ไปหน้าจัดการเฉพาะ โดยไม่เริ่มโหลดคลังในหน้าโปรไฟล์
  if (hash === '#signature' && !profileLoading && !profileError && STAFF_ROLES.includes(contextRole)) {
    return <Navigate to="/staff/my-signatures" state={{ returnTo: '/profile' }} replace />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    )
  }

  const displayName = profile.full_name || session?.user?.email?.split('@')[0] || 'ผู้ใช้'
  const roleLabel = ROLE_LABEL[contextRole ?? profile.role] ?? 'ประชาชนทั่วไป'
  const profileDirty = Boolean(savedProfile) && savedProfile !== JSON.stringify(profile)

  return (
    <AccountPageLayout active={isSecurity ? 'security' : 'account'} title={isSecurity ? 'ความปลอดภัยของฉัน' : 'ข้อมูลบัญชีของฉัน'}
      hasUnsavedChanges={profileDirty || Boolean(newPassword || confirmPassword)}
      busy={saving || changingPassword || Boolean(linking)}>
      <div className="mx-auto max-w-xl space-y-4 [&_button]:min-h-11 [&_button]:min-w-11 [&_input:not([type=file])]:min-h-11 [&_select]:min-h-11" data-profile-panel={isSecurity ? 'security' : 'account'}>
        {!isSecurity && <>
        {/* Avatar */}
        <div className="flex flex-col items-center gap-2 mb-2">
          <div className="relative">
            {avatarUrl ? (
              <img src={avatarUrl} alt=""
                onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling.style.display = 'flex'; }}
                className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md" />
            ) : null}
            <div className={`w-24 h-24 rounded-full bg-blue-100 text-blue-600 border-4 border-white shadow-md ${avatarUrl ? 'hidden' : 'flex'} items-center justify-center text-3xl font-bold`}>
              {(displayName || '?')[0]?.toUpperCase()}
            </div>
            <button onClick={() => fileRef.current?.click()} aria-label="เปลี่ยนรูปโปรไฟล์"
              className="absolute bottom-0 right-0 h-11 w-11 rounded-full bg-white shadow-md flex items-center justify-center border border-gray-200 hover:bg-gray-50 active:scale-95 transition-all">
              <Pencil size={14} className="text-blue-600" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
          <button type="button" className="min-h-11 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full hover:bg-blue-100 transition-colors"
                onClick={() => fileRef.current?.click()}>
            คลิกเพื่อเปลี่ยนรูปโปรไฟล์
          </button>
        </div>

        {/* Fields */}
        <div className="bg-white rounded-2xl divide-y divide-gray-100 shadow-xs overflow-hidden">
          {/* ชื่อ-สกุล */}
          <div className="px-5 py-4">
            {editName ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">ชื่อ-สกุล</span>
                  <button onClick={() => setEditName(false)} aria-label="ปิดช่องแก้ไขชื่อ-สกุล" className="flex items-center justify-center text-blue-400">
                    <Pencil size={16} />
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <select value={nameParts.title} onChange={(e) => setNamePart('title', e.target.value)}
                    className="w-20 shrink-0 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none">
                    <option value="">เลือก</option>
                    {NAME_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input value={nameParts.first} onChange={(e) => setNamePart('first', e.target.value)}
                    placeholder="ชื่อ" autoFocus
                    className="flex-1 min-w-0 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none" />
                  <input value={nameParts.last} onChange={(e) => setNamePart('last', e.target.value)}
                    placeholder="นามสกุล"
                    className="flex-1 min-w-0 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-700 flex-1">ชื่อ-สกุล</span>
                <span className="text-sm text-gray-500 flex-1 text-right truncate">{profile.full_name || 'ยังไม่ได้ระบุ'}</span>
                <button onClick={() => setEditName(true)} aria-label="แก้ไขชื่อ-สกุล" className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-blue-400">
                  <Pencil size={16} />
                </button>
              </div>
            )}
          </div>

          {/* สิทธิ์ใช้งาน (read-only — map จาก role) */}
          <div className="flex items-center px-5 py-4 gap-3">
            <span className="text-sm text-gray-700 flex-1">สิทธิ์ใช้งาน</span>
            <span className="text-sm font-medium text-right truncate max-w-50"
                  style={{ color: 'var(--color-primary)' }}>
              {roleLabel}
            </span>
          </div>

          {/* เข้าสู่ระบบบน PC เครื่องอื่นโดยไม่ต้องพิมพ์รหัสผ่านทิ้งไว้บนเครื่องนั้น */}
          {STAFF_ROLES.includes(contextRole ?? profile.role) && (
            <button
              onClick={() => navigate('/device-login')}
              className="w-full flex items-center px-5 py-4 gap-3 text-left active:bg-gray-50 transition-colors"
            >
              <Smartphone size={16} className="text-gray-400" />
              <span className="text-sm text-gray-700 flex-1">เข้าสู่ระบบบนคอมพิวเตอร์</span>
              <ChevronRight size={16} className="text-gray-300" />
            </button>
          )}

          {/* เบอร์โทร */}
          <div className="flex items-center px-5 py-4 gap-3">
            <span className="text-sm text-gray-700 flex-1">เบอร์โทรศัพท์</span>
            {editPhone ? (
              <input
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                className="text-sm text-gray-800 bg-white border-b border-gray-300 outline-none text-right flex-1 max-w-40"
                type="tel"
                autoFocus
              />
            ) : (
              <span className="text-sm text-gray-500 flex-1 text-right">{profile.phone || 'ยังไม่ได้ระบุ'}</span>
            )}
            <button onClick={() => setEditPhone((v) => !v)} aria-label="แก้ไขเบอร์โทรศัพท์" className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-blue-400">
              <Pencil size={16} />
            </button>
          </div>

          {/* เลขบัตรประชาชน */}
          <div className="flex items-center px-5 py-4 gap-3">
            <div className="flex-1">
              <span className="text-sm text-gray-700">เลขบัตรประชาชน</span>
              {!profile.id_card && (
                <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                  ยืนยันตัวตน
                </span>
              )}
            </div>
            {editIdCard ? (
              <input
                value={profile.id_card}
                onChange={(e) => setProfile((p) => ({ ...p, id_card: e.target.value }))}
                className="text-sm text-gray-800 bg-white border-b border-gray-300 outline-none text-right flex-1 max-w-44 font-mono"
                type="text"
                maxLength={13}
                placeholder="13 หลัก"
                autoFocus
              />
            ) : (
              <span className="text-sm text-gray-500 font-mono text-right">
                {profile.id_card
                  ? `${profile.id_card.slice(0, 1)}-${profile.id_card.slice(1, 5)}-${profile.id_card.slice(5, 10)}-${profile.id_card.slice(10, 12)}-${profile.id_card.slice(12)}`
                  : 'ยังไม่ได้ระบุ'}
              </span>
            )}
            <button onClick={() => setEditIdCard((v) => !v)} aria-label="แก้ไขเลขบัตรประชาชน" className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-blue-400">
              <Pencil size={16} />
            </button>
          </div>

          {/* ที่อยู่ */}
          <div className="px-5 py-4">
            {editAddress ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-700">ที่อยู่</span>
                  <button onClick={() => setEditAddress(false)} aria-label="ปิดช่องแก้ไขที่อยู่" className="flex items-center justify-center text-blue-400">
                    <Pencil size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {/* จังหวัด → อำเภอ → ตำบล เลือกเป็นลำดับชั้นจากข้อมูลจริงทั้งประเทศ (77 จังหวัด) กัน
                      พิมพ์ชื่อผิด/ไม่ตรงชื่อทางการ — เปลี่ยนจังหวัดแล้วต้องล้างอำเภอ/ตำบลเดิมทิ้งเสมอ
                      (อำเภอเดิมอาจไม่มีอยู่ในจังหวัดใหม่) เปลี่ยนอำเภอก็ต้องล้างตำบลเดิมทิ้งเช่นกัน */}
                  <select value={profile.address_province}
                    onChange={(e) => setProfile((p) => ({ ...p, address_province: e.target.value, address_district: '', address_subdistrict: '' }))}
                    className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none">
                    <option value="">เลือกจังหวัด</option>
                    {THAI_PROVINCES.map((prov) => <option key={prov} value={prov}>{prov}</option>)}
                  </select>
                  <select value={profile.address_district}
                    onChange={(e) => setProfile((p) => ({ ...p, address_district: e.target.value, address_subdistrict: '' }))}
                    disabled={!profile.address_province}
                    className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none disabled:opacity-50">
                    <option value="">เลือกอำเภอ</option>
                    {thaiDistrictsOf(profile.address_province).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={profile.address_subdistrict}
                    onChange={(e) => setProfile((p) => ({ ...p, address_subdistrict: e.target.value }))}
                    disabled={!profile.address_district}
                    className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none disabled:opacity-50">
                    <option value="">เลือกตำบล</option>
                    {thaiSubdistrictsOf(profile.address_province, profile.address_district).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input value={profile.address_moo}
                    onChange={(e) => setProfile((p) => ({ ...p, address_moo: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                    placeholder="หมู่ที่"
                    className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none" />
                </div>
                <input value={profile.address_detail} onChange={(e) => setProfile((p) => ({ ...p, address_detail: e.target.value }))}
                  placeholder="บ้านเลขที่ / รายละเอียดที่อยู่อื่นๆ"
                  className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none" />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-700 flex-1">ที่อยู่</span>
                <span className="text-sm text-gray-500 flex-1 text-right truncate">{formatAddress(profile) || 'ยังไม่ได้ระบุ'}</span>
                <button onClick={() => setEditAddress(true)} aria-label="แก้ไขที่อยู่" className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-blue-400">
                  <Pencil size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-5 py-4 text-sm shadow-xs"><span className="text-gray-700">อีเมล</span><span className="min-w-0 break-all text-gray-500">{session?.user?.email}</span></div>
        </>}

        {isSecurity && <>
        {/* บัญชีที่เชื่อมต่อ */}
        <div className="bg-white rounded-2xl divide-y divide-gray-100 shadow-xs overflow-hidden">
          <div className="flex items-center px-5 py-4 justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-red-100 text-red-500 flex items-center justify-center font-bold text-xs">
                G
              </div>
              <span className="text-sm text-gray-700">Google</span>
            </div>
            {isGoogleLinked ? (
              <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                เชื่อมต่อแล้ว
              </span>
            ) : (
              <button
                onClick={() => linkProvider('google', 'Google')}
                disabled={linking !== ''}
                className="text-xs text-gray-500 border border-gray-200 px-3 py-1 rounded-full hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {linking === 'google' ? 'กำลังเปิด...' : 'เชื่อมต่อ'}
              </button>
            )}
          </div>

          <div className="flex items-center px-5 py-4 justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px]">
                LINE
              </div>
              <span className="text-sm text-gray-700">LINE</span>
            </div>
            {isLineLinked ? (
              <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                เชื่อมต่อแล้ว
              </span>
            ) : (
              <button
                onClick={() => linkProvider('custom:line', 'LINE')}
                disabled={linking !== ''}
                className="text-xs text-gray-500 border border-gray-200 px-3 py-1 rounded-full hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {linking === 'custom:line' ? 'กำลังเปิด...' : 'เชื่อมต่อ'}
              </button>
            )}
          </div>

          <div className="flex items-center px-5 py-4 justify-between">
            <span className="text-sm text-gray-700">อีเมล</span>
            <span className="text-sm text-gray-500 text-right truncate max-w-56">{session?.user?.email}</span>
          </div>

          {/* เปลี่ยนรหัสผ่าน */}
          <div ref={securityRef} id="security" tabIndex={-1} aria-labelledby="account-security-title" className="scroll-mt-4 px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400">
            <h2 id="account-security-title" className="mb-3 text-sm font-bold text-gray-800">ความปลอดภัย</h2>
            {showChangePassword ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">เปลี่ยนรหัสผ่าน</span>
                  <button onClick={() => { setShowChangePassword(false); setNewPassword(''); setConfirmPassword(''); setError('') }} aria-label="ยกเลิกการเปลี่ยนรหัสผ่าน" className="flex items-center justify-center text-blue-400">
                    <X size={16} />
                  </button>
                </div>
                <div className="relative">
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder={`รหัสผ่านใหม่ (${PASSWORD_HINT})`}
                    autoComplete="new-password"
                    autoFocus
                    className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 pr-9 outline-none"
                  />
                  <button type="button" onClick={() => setShowNewPassword((v) => !v)} aria-label={showNewPassword ? 'ซ่อนรหัสผ่านใหม่' : 'แสดงรหัสผ่านใหม่'}
                    className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center justify-center text-gray-400">
                    {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <input
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder="ยืนยันรหัสผ่านใหม่"
                  autoComplete="new-password"
                  className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none"
                />
                <button
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                  className="w-full py-2.5 rounded-xl font-semibold text-white text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {changingPassword && <Loader2 size={14} className="animate-spin" />}
                  ยืนยันเปลี่ยนรหัสผ่าน
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">รหัสผ่าน</span>
                <button onClick={() => setShowChangePassword(true)}
                  className="text-xs text-blue-600 font-semibold border border-blue-200 px-3 py-1 rounded-full hover:bg-blue-50 transition-colors">
                  เปลี่ยนรหัสผ่าน
                </button>
              </div>
            )}
          </div>
        </div>

        <ActiveSessions />
        </>}

        {/* ทางลัดเท่านั้น: หน้าโปรไฟล์ไม่โหลดข้อมูลหรือรูปจากคลังลายเซ็น */}
        {!isSecurity && STAFF_ROLES.includes(contextRole ?? profile.role) && (
          <Link to="/staff/my-signatures" state={{ returnTo: '/profile' }} data-profile-signatures
            className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xs hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            <FileSignature size={20} className="shrink-0 text-slate-500" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-800">ลายเซ็นของฉัน</span><span className="mt-1 block text-xs text-slate-500">จัดการภาพลายเซ็น รหัสลงนาม และประวัติในหน้าเฉพาะ</span></span>
            <ChevronRight size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
          </Link>
        )}

        {/* Message */}
        {msg && <p className="text-xs text-emerald-600 text-center font-semibold bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl">{msg}</p>}
        {error && <p className="text-xs text-red-500 text-center font-semibold bg-red-50 border border-red-200 p-2.5 rounded-xl">{error}</p>}

        {/* Actions */}
        <div className="space-y-2 pt-2">
          {profileDirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 rounded-xl font-semibold text-white shadow-md transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              บันทึกการเปลี่ยนแปลง
            </button>
          )}

          <button
            onClick={handleLogout}
            className="w-full py-3 rounded-xl font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors text-sm"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </AccountPageLayout>
  )
}
