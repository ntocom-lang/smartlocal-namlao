import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ChevronLeft, Pencil, Loader2, X, Eye, EyeOff } from 'lucide-react'
import { compressImage } from '../lib/imageUtils'
import { useAuth } from '../contexts/AuthContext'
import { NAME_TITLES, splitThaiFullName, joinThaiFullName } from '../lib/thaiName'

const ROLE_LABEL = {
  superadmin: 'Super Admin',
  admin:      'แอดมินระบบ',
  officer:    'ธุรการกอง',
  technician: 'ปฏิบัติงาน',
  staff:      'เจ้าหน้าที่',
  viewer:     'ผู้บริหาร',
  council:    'สภาเทศบาล',
  citizen:    'ประชาชน',
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const { role: contextRole } = useAuth()
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState({ full_name: '', phone: '', role: '', id_card: '' })
  const [nameParts, setNameParts] = useState({ title: '', first: '', last: '' })
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [editName, setEditName] = useState(false)
  const [editPhone, setEditPhone] = useState(false)
  const [editIdCard, setEditIdCard] = useState(false)
  const [isGoogleLinked, setIsGoogleLinked] = useState(false)
  const [isLineLinked, setIsLineLinked] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
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
        .select('full_name, phone, avatar_url, role, id_card')
        .eq('id', s.user.id)
        .single()

      if (p) {
        const fullName = p.full_name || meta?.full_name || ''
        setProfile({
          full_name: fullName,
          phone: p.phone || meta?.phone || '',
          role: p.role || '',
          id_card: p.id_card || '',
        })
        setNameParts(splitThaiFullName(fullName))
        setAvatarUrl(p.avatar_url || meta?.avatar_url || meta?.picture || null)
      } else {
        const fullName = meta?.full_name || ''
        setProfile({
          full_name: fullName,
          phone: meta?.phone || '',
          role: '',
        })
        setNameParts(splitThaiFullName(fullName))
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [navigate])

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
      })
    setSaving(false)
    if (err) { setError('บันทึกไม่สำเร็จ: ' + err.message); return }
    setMsg('บันทึกข้อมูลเรียบร้อยแล้ว')
    setEditName(false)
    setEditPhone(false)
    setEditIdCard(false)
  }

  // ใช้ supabase.auth.updateUser({password}) แบบเดียวกับ ResetPasswordPage.jsx — ต้องมี session ที่
  // login อยู่แล้วเท่านั้น (หน้านี้เช็ค session ตอนโหลดอยู่แล้ว ไม่มี session เด้งไป /auth ก่อนถึงตรงนี้)
  // ไม่ได้บังคับให้กรอกรหัสผ่านเดิมก่อน (Supabase ไม่มี endpoint ยืนยันรหัสเดิมแบบตรงๆ ให้ใช้ ต้องทำ
  // reauth flow เพิ่มเองถ้าต้องการเข้มกว่านี้) — พฤติกรรมเดียวกับหน้า "ลืมรหัสผ่าน" เดิมที่มีอยู่แล้ว
  async function handleChangePassword() {
    setError('')
    setMsg('')
    if (newPassword.length < 6) { setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return }
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
    await supabase.auth.signOut()
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
  }

  async function handleGoogleLink() {
    await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
  }

  async function handleLineLink() {
    await supabase.auth.linkIdentity({
      provider: 'custom:line',
      options: { redirectTo: window.location.href },
    })
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center px-4 py-4 text-white"
           style={{ background: 'linear-gradient(90deg, var(--color-primary-dark), var(--color-primary))' }}>
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ChevronLeft size={24} />
        </button>
        <h1 className="flex-1 text-center font-semibold text-base">ข้อมูลผู้ใช้</h1>
        <div className="w-8" />
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-gray-800">ข้อมูลบัญชีของฉัน</h1>
          <p className="text-xs text-gray-400 mt-0.5">จัดการข้อมูลส่วนตัวและความปลอดภัย</p>
        </div>
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
          <ChevronLeft size={15} />
          ย้อนกลับ
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 md:py-8 pb-28 md:pb-8 space-y-4">
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
            <button onClick={() => fileRef.current?.click()}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center border border-gray-200 hover:bg-gray-50 active:scale-95 transition-all">
              <Pencil size={14} className="text-blue-600" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
          <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full cursor-pointer hover:bg-blue-100 transition-colors"
                onClick={() => fileRef.current?.click()}>
            คลิกเพื่อเปลี่ยนรูปโปรไฟล์
          </span>
        </div>

        {/* Fields */}
        <div className="bg-white rounded-2xl divide-y divide-gray-100 shadow-xs overflow-hidden">
          {/* ชื่อ-สกุล */}
          <div className="px-5 py-4">
            {editName ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">ชื่อ-สกุล</span>
                  <button onClick={() => setEditName(false)} className="text-blue-400">
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
                <button onClick={() => setEditName(true)} className="ml-2 text-blue-400">
                  <Pencil size={16} />
                </button>
              </div>
            )}
          </div>

          {/* ตำแหน่ง (read-only — map จาก role) */}
          <div className="flex items-center px-5 py-4 gap-3">
            <span className="text-sm text-gray-700 flex-1">ตำแหน่ง</span>
            <span className="text-sm font-medium text-right truncate max-w-50"
                  style={{ color: 'var(--color-primary)' }}>
              {roleLabel}
            </span>
          </div>

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
            <button onClick={() => setEditPhone((v) => !v)} className="ml-2 text-blue-400">
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
            <button onClick={() => setEditIdCard((v) => !v)} className="ml-2 text-blue-400">
              <Pencil size={16} />
            </button>
          </div>
        </div>

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
                onClick={handleGoogleLink}
                className="text-xs text-gray-500 border border-gray-200 px-3 py-1 rounded-full hover:bg-gray-50 transition-colors"
              >
                เชื่อมต่อ
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
                onClick={handleLineLink}
                className="text-xs text-gray-500 border border-gray-200 px-3 py-1 rounded-full hover:bg-gray-50 transition-colors"
              >
                เชื่อมต่อ
              </button>
            )}
          </div>

          <div className="flex items-center px-5 py-4 justify-between">
            <span className="text-sm text-gray-700">อีเมล</span>
            <span className="text-sm text-gray-500 text-right truncate max-w-56">{session?.user?.email}</span>
          </div>

          {/* เปลี่ยนรหัสผ่าน */}
          <div className="px-5 py-4">
            {showChangePassword ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">เปลี่ยนรหัสผ่าน</span>
                  <button onClick={() => { setShowChangePassword(false); setNewPassword(''); setConfirmPassword(''); setError('') }} className="text-blue-400">
                    <X size={16} />
                  </button>
                </div>
                <div className="relative">
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)"
                    autoComplete="new-password"
                    autoFocus
                    className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 pr-9 outline-none"
                  />
                  <button type="button" onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
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

        {/* Message */}
        {msg && <p className="text-xs text-emerald-600 text-center font-semibold bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl">{msg}</p>}
        {error && <p className="text-xs text-red-500 text-center font-semibold bg-red-50 border border-red-200 p-2.5 rounded-xl">{error}</p>}

        {/* Actions */}
        <div className="space-y-2 pt-2">
          {(editName || editPhone || editIdCard) && (
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
    </div>
  )
}
