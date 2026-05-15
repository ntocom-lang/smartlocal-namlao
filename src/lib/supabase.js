import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

supabase.auth.onAuthStateChange((event) => {
  if (event === 'TOKEN_REFRESHED') return
  if (event === 'SIGNED_OUT') {
    const path = window.location.pathname
    if (path.startsWith('/admin') && path !== '/admin/login') {
      window.location.href = '/admin/login'
    }
  }
})
