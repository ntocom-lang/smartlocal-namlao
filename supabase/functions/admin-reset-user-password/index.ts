// Supabase Edge Function: admin-reset-user-password
// Deploy: supabase functions deploy admin-reset-user-password
//
// ตั้งรหัสผ่านชั่วคราวให้ผู้ใช้ สำหรับเคส "ประชาชนลืมรหัสผ่าน แล้วเดินมาที่สำนักงาน"
//
// ── ทำไมต้องมีฟังก์ชันนี้ ────────────────────────────────────────────────────
// ก่อนหน้านี้ระบบไม่มีทางกู้บัญชีเลยสักทาง:
//   • บัญชีเบอร์โทร  — หน้า "ลืมรหัสผ่าน" ปฏิเสธตรงๆ ("กรุณาติดต่อเจ้าหน้าที่")
//                      แต่เจ้าหน้าที่ก็ไม่มีเครื่องมืออะไรให้ใช้จริง
//   • บัญชีอีเมล     — ส่งลิงก์รีเซ็ตออกไป แต่ built-in SMTP ของ Supabase ปฏิเสธการส่งไปยัง
//                      อีเมลที่ไม่ได้อยู่ในทีมของโปรเจกต์ ประชาชนจึงไม่มีวันได้รับ (พังแบบเงียบ)
// และสมัครใหม่ก็ไม่ได้เพราะเบอร์/อีเมลเดิมถูกใช้ไปแล้ว = ลืมรหัสผ่านแล้วเสียบัญชีถาวร
//
// ── ทำไมต้องเป็น edge function ──────────────────────────────────────────────
// เปลี่ยนรหัสผ่านของ "คนอื่น" ต้องใช้ auth.admin.updateUserById ซึ่งใช้ได้เฉพาะ service_role
// ฝั่งเซิร์ฟเวอร์ ทำจาก client หรือ plpgsql RPC ไม่ได้ (เหมือน admin-update-login-email)
//
// ── ข้อจำกัดที่ต้องยอมรับ (ตั้งใจ ไม่ใช่ลืม) ────────────────────────────────
// 1. ผู้ดูแลระบบเห็นรหัสชั่วคราวที่ตั้งให้ จึงล็อกอินเป็นผู้ใช้คนนั้นได้จนกว่าเจ้าตัวจะเปลี่ยนเอง
//    เลี่ยงไม่ได้ในรูปแบบ "บอกปากเปล่าที่เคาน์เตอร์" — คุมด้วย audit log ทุกครั้งแทน
// 2. Supabase ไม่มีกลไก "บังคับเปลี่ยนรหัสตอนล็อกอินครั้งแรก" รหัสชั่วคราวจึงใช้ได้เรื่อยๆ
//    จนกว่าเจ้าตัวจะไปเปลี่ยนที่หน้าโปรไฟล์เอง — จึงสุ่มให้ยาวพอ (10 ตัว) ไม่ใช่รหัสสั้นๆ
//
// สิทธิ์: ใช้ชุดเดียวกับ admin-update-login-email ทุกข้อ — ผู้เรียกต้องเป็น admin/superadmin,
// ทำกับตัวเองไม่ได้, แตะบัญชี superadmin ไม่ได้, admin แตะ admin ด้วยกันไม่ได้,
// และ admin ทำได้เฉพาะคนใน อปท. ของตัวเอง

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ตัดตัวอักษร/ตัวเลขที่อ่านออกเสียงแล้วสับสนทิ้ง (i l o กับ 0 1) เพราะรหัสนี้ถูกส่งต่อด้วยการ
// "บอกปากเปล่า" ที่เคาน์เตอร์เป็นหลัก ผู้ใช้กลุ่มใหญ่ของระบบคือผู้สูงอายุ
const LETTERS = 'abcdefghjkmnpqrstuvwxyz'
const DIGITS = '23456789'
const LETTER_COUNT = 6
const DIGIT_COUNT = 4

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

// สุ่มแบบตัดค่าที่ทำให้ mod เอนเอียงทิ้ง (modulo bias) — วิธีเดียวกับ device-login
function randomIndex(limit: number) {
  const bytes = new Uint32Array(1)
  const ceiling = Math.floor(0xffffffff / limit) * limit
  let value = 0
  do {
    crypto.getRandomValues(bytes)
    value = bytes[0]
  } while (value >= ceiling)
  return value % limit
}

function generateTempPassword() {
  let out = ''
  for (let i = 0; i < LETTER_COUNT; i += 1) out += LETTERS[randomIndex(LETTERS.length)]
  for (let i = 0; i < DIGIT_COUNT; i += 1) out += DIGITS[randomIndex(DIGITS.length)]
  return out
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }

  try {
    const body = await req.json() as Record<string, unknown>
    const targetUserId = body.user_id
    if (!isUuid(targetUserId)) return json({ ok: false, error: 'invalid user_id' }, 400)

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const authorization = req.headers.get('Authorization') ?? ''
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authorization ? { Authorization: authorization } : {} },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData } = await authClient.auth.getUser()
    const callerId = authData.user?.id ?? null
    if (!callerId) return json({ ok: false, error: 'authentication required' }, 401)

    // ตั้งรหัสของตัวเองให้ไปทำที่หน้าโปรไฟล์ — ที่นั่นเป็นการกระทำของเจ้าของบัญชีเอง
    // ไม่ใช่การใช้อำนาจผู้ดูแลระบบกับคนอื่น จะได้ไม่ปนกันใน audit log
    if (callerId === targetUserId) {
      return json({ ok: false, error: 'เปลี่ยนรหัสผ่านของตัวเองได้ที่หน้าโปรไฟล์' }, 400)
    }

    const { data: caller } = await admin.from('profiles').select('role, municipality_id, full_name')
      .eq('id', callerId).maybeSingle()
    if (!caller || !['admin', 'superadmin'].includes(String(caller.role))) {
      return json({ ok: false, error: 'permission denied' }, 403)
    }

    const { data: target } = await admin.from('profiles').select('role, municipality_id, full_name')
      .eq('id', targetUserId).maybeSingle()
    if (!target) return json({ ok: false, error: 'user not found' }, 404)
    if (target.role === 'superadmin') return json({ ok: false, error: 'cannot modify a superadmin account' }, 403)
    if (caller.role === 'admin' && target.role === 'admin') {
      return json({ ok: false, error: 'only superadmin can manage admin accounts' }, 403)
    }
    if (caller.role === 'admin' && target.municipality_id !== caller.municipality_id) {
      return json({ ok: false, error: 'permission denied: user is outside your municipality' }, 403)
    }

    // สุ่มฝั่งเซิร์ฟเวอร์ ไม่ให้ผู้ดูแลระบบเลือกรหัสเอง — กันการตั้งรหัสง่ายๆ ซ้ำๆ ทุกคน
    // และไม่ต้องส่งรหัสผ่านเข้ามาใน request body
    const password = generateTempPassword()

    const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, { password })
    if (updateError) {
      console.error('updateUserById failed:', updateError.message)
      return json({ ok: false, error: 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่' }, 400)
    }

    // ⚠️ ห้ามเก็บรหัสผ่านลง audit log เด็ดขาด บันทึกแค่ว่าใครทำอะไรกับใครเมื่อไร
    await admin.from('audit_logs').insert({
      municipality_id: target.municipality_id ?? caller.municipality_id,
      actor_id: callerId,
      actor_name: caller.full_name ?? null,
      actor_role: caller.role,
      action: 'admin_reset_user_password',
      resource_type: 'profile',
      resource_id: targetUserId,
      resource_label: target.full_name ?? null,
      metadata: { target_user_id: targetUserId, target_role: target.role },
    })

    return json({ ok: true, password })
  } catch (error) {
    console.error('admin-reset-user-password failed:', error)
    return json({ ok: false, error: 'internal error' }, 500)
  }
})
