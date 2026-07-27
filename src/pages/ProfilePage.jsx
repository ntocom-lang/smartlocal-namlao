import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ChevronLeft, Pencil, Loader2 } from 'lucide-react'
import { compressImage } from '../lib/imageUtils'
import { useAuth } from '../contexts/AuthContext'
import { NAME_TITLES, splitThaiFullName, joinThaiFullName } from '../lib/thaiName'

const ROLE_LABEL = {
  superadmin: 'Super Admin',
  admin:      'แอดมินระบบ',
  officer:    'แอดมินกอง',
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

  // คำนำหน้า/ชื่อ/นามสกุล เก็บแยกไว้แก้ในฟอร์ม แต่ profile.full_name ต้อง sync ตามตลอด
  // เพราะที่อื่นในหน้านี้ (เช่น displayName, ตัวอักษรย่อ avatar) ยังอ่านจาก full_name เฉยๆ
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

    const ext = file.name.split('.').pop()
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
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-sm">
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
              <img src={avatarUrl} alt="avatar"
                className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center text-3xl font-bold text-gray-400 border-4 border-white shadow-md">
                {displayName[0]?.toUpperCase()}
              </div>
            )}
            <button onClick={() => fileRef.current?.click()}
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-white shadow flex items-center justify-center border border-gray-200">
              <Pencil size={13} className="text-gray-600" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
          <span className="text-sm font-medium text-gray-700">แก้ไข</span>
        </div>

        {/* Fields */}
        <div className="bg-white rounded-2xl divide-y divide-gray-100 shadow-sm overflow-hidden">
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
                onChange={(e) => setProfile((p) => ({ ...p, id_card: e.target.value.replace(/\D/g, '').slice(0, 13) }))}
                className="text-sm text-gray-800 bg-white border-b border-gray-300 outline-none text-right flex-1 max-w-44 tracking-widest"
                type="text"
                inputMode="numeric"
                placeholder="x-xxxx-xxxxx-xx-x"
                maxLength={13}
                autoFocus
              />
            ) : (
              <span className="text-sm flex-1 text-right" style={{ color: profile.id_card ? '#6b7280' : '#f59e0b' }}>
                {profile.id_card
                  ? profile.id_card.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')
                  : 'ยังไม่ได้ยืนยัน'}
              </span>
            )}
            <button onClick={() => setEditIdCard((v) => !v)} className="ml-2 text-blue-400">
              <Pencil size={16} />
            </button>
          </div>
        </div>

        {/* Social links */}
        <div className="bg-white rounded-2xl divide-y divide-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center px-5 py-4 gap-3">
            <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
              <path d="M47.5 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h13.2c-.6 3-2.3 5.6-4.9 7.3v6h7.9c4.6-4.3 7.3-10.6 7.3-17.5z" fill="#4285F4"/>
              <path d="M24 48c6.6 0 12.2-2.2 16.2-5.9l-7.9-6c-2.2 1.5-5 2.3-8.3 2.3-6.4 0-11.8-4.3-13.7-10.1H2.1v6.2C6.1 42.7 14.5 48 24 48z" fill="#34A853"/>
              <path d="M10.3 28.3c-.5-1.5-.8-3-.8-4.3s.3-2.8.8-4.3v-6.2H2.1C.8 16.2 0 19.9 0 24s.8 7.8 2.1 10.5l8.2-6.2z" fill="#FBBC05"/>
              <path d="M24 9.5c3.6 0 6.8 1.2 9.3 3.6l6.9-6.9C36.2 2.3 30.6 0 24 0 14.5 0 6.1 5.3 2.1 13.5l8.2 6.2C12.2 13.8 17.6 9.5 24 9.5z" fill="#EA4335"/>
            </svg>
            <span className="text-sm text-gray-700 flex-1">Google</span>
            {isGoogleLinked ? (
              <span className="text-xs text-green-600 bg-green-50 px-3 py-1 rounded-full font-medium">เชื่อมต่อแล้ว</span>
            ) : (
              <button onClick={handleGoogleLink}
                className="text-xs text-white bg-green-500 hover:bg-green-600 px-4 py-1.5 rounded-full font-medium transition-colors">
                เชื่อมต่อ
              </button>
            )}
          </div>

          {/* LINE */}
          <div className="flex items-center px-5 py-4 gap-3">
            <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <rect width="24" height="24" rx="6" fill="#06C755"/>
              <path d="M12 2.5C6.753 2.5 2.5 6.314 2.5 11.027c0 4.218 3.739 7.749 8.79 8.369.342.074.808.226.926.519.106.268.07.686.034.956l-.15.898c-.046.267-.21 1.043.914.569 1.124-.474 6.063-3.572 8.274-6.117C22.413 14.598 21.5 12.9 21.5 11.027c0-4.713-4.253-8.527-9.5-8.527z" fill="white"/>
              <path d="M9.807 9.2H8.8a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2h1.007a.2.2 0 0 0 .2-.2V9.4a.2.2 0 0 0-.2-.2zm5.593 0h-1.007a.2.2 0 0 0-.2.2v1.9l-1.463-2.007A.2.2 0 0 0 12.567 9.2h-1.007a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2H12.567a.2.2 0 0 0 .2-.2v-1.9l1.465 2.008a.2.2 0 0 0 .168.092H15.4a.2.2 0 0 0 .2-.2V9.4a.2.2 0 0 0-.2-.2zm-7.2 0H7a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2h2.2a.2.2 0 0 0 .2-.2v-.8a.2.2 0 0 0-.2-.2H7.8v-2.2a.2.2 0 0 0-.2-.2H7.2zm10 2.4h-1.4v-2.2a.2.2 0 0 0-.2-.2h-.8a.2.2 0 0 0-.2.2v3.2c0 .11.09.2.2.2H17.4a.2.2 0 0 0 .2-.2v-.8a.2.2 0 0 0-.2-.2z" fill="#06C755"/>
            </svg>
            <span className="text-sm text-gray-700 flex-1">LINE</span>
            {isLineLinked ? (
              <span className="text-xs text-green-600 bg-green-50 px-3 py-1 rounded-full font-medium">เชื่อมต่อแล้ว</span>
            ) : (
              <button onClick={handleLineLink}
                className="text-xs text-white px-4 py-1.5 rounded-full font-medium transition-colors active:scale-95"
                style={{ backgroundColor: '#06C755' }}>
                เชื่อมต่อ
              </button>
            )}
          </div>

          {/* อีเมล */}
          <div className="flex items-center px-5 py-4 gap-3">
            <span className="text-sm text-gray-700 flex-1">อีเมล</span>
            <span className="text-sm text-gray-500 text-right truncate max-w-45">{session?.user?.email || '-'}</span>
          </div>
        </div>

        {/* Feedback */}
        {msg && <p className="text-sm text-green-600 text-center">{msg}</p>}
        {error && <p className="text-sm text-red-500 text-center">{error}</p>}

        {/* Buttons */}
        <button onClick={handleSave} disabled={saving}
          className="w-full py-3.5 rounded-2xl text-white font-semibold text-sm transition-all disabled:opacity-60 active:scale-95"
          style={{ background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)' }}>
          {saving ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> กำลังบันทึก...</span> : 'บันทึก'}
        </button>

        <button onClick={handleLogout}
          className="w-full py-3.5 rounded-2xl text-white font-semibold text-sm bg-red-400 hover:bg-red-500 active:scale-95 transition-all">
          ออกจากระบบ
        </button>
      </div>
    </div>
  )
}
