import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function LineCallback() {
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const storedState = sessionStorage.getItem('line_oauth_state')
    const redirectUri = sessionStorage.getItem('line_oauth_redirect_uri')
      || `${window.location.origin}/auth/line/callback`
    const returnTo = sessionStorage.getItem('line_oauth_from') || '/'

    async function handleCallback() {
      if (!code || !state || state !== storedState) {
        setError('การยืนยันตัวตนล้มเหลว กรุณาลองใหม่')
        return
      }

      sessionStorage.removeItem('line_oauth_state')
      sessionStorage.removeItem('line_oauth_redirect_uri')
      sessionStorage.removeItem('line_oauth_from')

      const { data, error: fnErr } = await supabase.functions.invoke('line-auth', {
        body: { code, redirect_uri: redirectUri },
      })

      if (fnErr || data?.error) {
        console.error('line-auth error:', fnErr || data?.error)
        setError('เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่')
        return
      }

      const { error: otpErr } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: 'email',
      })

      if (otpErr) {
        console.error('verifyOtp error:', otpErr)
        setError('ไม่สามารถสร้าง session ได้ กรุณาลองใหม่')
        return
      }

      // กลับไปยัง URL เดิม (รวม slug หน่วยงาน) — AppShell จะ upsert profile เอง
      window.location.replace(returnTo)
    }

    handleCallback()
  }, [])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-4xl mb-4">😕</div>
          <p className="text-gray-700 font-medium mb-2">เข้าสู่ระบบไม่สำเร็จ</p>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <button
            onClick={() => window.history.back()}
            className="px-6 py-3 rounded-xl text-white text-sm font-medium"
            style={{ backgroundColor: 'var(--color-primary, #2563eb)' }}
          >
            กลับไปหน้าเข้าสู่ระบบ
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-gray-200 rounded-full animate-spin mx-auto mb-4"
             style={{ borderTopColor: '#06C755' }} />
        <p className="text-gray-500 text-sm">กำลังเข้าสู่ระบบด้วย LINE...</p>
      </div>
    </div>
  )
}
