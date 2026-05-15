import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ChevronLeft, Pencil, Loader2 } from 'lucide-react'

export default function ProfilePage() {
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState({ full_name: '', phone: '' })
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
const [editName, setEditName] = useState(false)
  const [editPhone, setEditPhone] = useState(false)
  const [isGoogleLinked, setIsGoogleLinked] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session
      if (!s) { navigate('/auth'); return }
      setSession(s)

      const meta = s.user.user_metadata
      setAvatarUrl(meta?.avatar_url || null)
      setIsGoogleLinked(s.user.app_metadata?.providers?.includes('google') || false)

      const { data: p } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', s.user.id)
        .single()

      if (p) {
        setProfile({
          full_name: p.full_name || meta?.full_name || '',
          phone: p.phone || meta?.phone || '',
        })
      } else {
        setProfile({
          full_name: meta?.full_name || '',
          phone: meta?.phone || '',
        })
      }
      setLoading(false)
    })
  }, [navigate])

  async function handleSave() {
    setSaving(true)
    setMsg('')
    setError('')
    const { error: err } = await supabase
      .from('profiles')
      .upsert({
        id: session.user.id,
        full_name: profile.full_name,
        phone: profile.phone,
      })
    setSaving(false)
    if (err) { setError('บันทึกไม่สำเร็จ: ' + err.message); return }
    setMsg('บันทึกข้อมูลเรียบร้อยแล้ว')
    setEditName(false)
    setEditPhone(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/')
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setAvatarUrl(url)
    // TODO: upload to Supabase Storage if needed
  }

  async function handleGoogleLink() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="flex items-center px-4 py-4 text-white"
           style={{ background: 'linear-gradient(90deg, var(--color-primary-dark), var(--color-primary))' }}>
        <button onClick={() => navigate(-1)} className="p-1 mr-3">
          <ChevronLeft size={24} />
        </button>
        <h1 className="flex-1 text-center font-semibold text-base">ข้อมูลผู้ใช้</h1>
        <div className="w-8" />
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-4">
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
          <div className="flex items-center px-5 py-4 gap-3">
            <span className="text-sm text-gray-700 flex-1">ชื่อ-สกุล</span>
            {editName ? (
              <input
                value={profile.full_name}
                onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))}
                className="text-sm text-gray-800 border-b border-gray-300 outline-none text-right flex-1 max-w-[160px]"
                autoFocus
              />
            ) : (
              <span className="text-sm text-gray-500 flex-1 text-right truncate">{profile.full_name || 'ยังไม่ได้ระบุ'}</span>
            )}
            <button onClick={() => setEditName((v) => !v)} className="ml-2 text-blue-400">
              <Pencil size={16} />
            </button>
          </div>

          {/* เบอร์โทร */}
          <div className="flex items-center px-5 py-4 gap-3">
            <span className="text-sm text-gray-700 flex-1">เบอร์โทรศัพท์</span>
            {editPhone ? (
              <input
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                className="text-sm text-gray-800 border-b border-gray-300 outline-none text-right flex-1 max-w-[160px]"
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
