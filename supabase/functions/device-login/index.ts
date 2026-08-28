// Supabase Edge Function: device-login
// Deploy: supabase functions deploy device-login
// เอกสารออกแบบ: docs/device-qr-login-design.md
//
// ล็อกอินด้วยรหัสจากมือถือ สำหรับเจ้าหน้าที่ที่ต้องไปใช้ PC เครื่องอื่นในสำนักงาน
// PC แสดงรหัส 6 หลัก + เลข 2 หลัก → เจ้าหน้าที่กรอกรหัสในแอปมือถือที่ล็อกอินอยู่แล้ว
// → แตะเลขที่ตรงกับจอ PC
// → PC เอา verifier ที่เก็บไว้ในแรมตัวเองมาแลก magic-link token → verifyOtp เป็น session
//
// เหตุผลที่ต้องเป็น edge function ไม่ใช่ plpgsql RPC: ขั้นตอน claim ต้องเรียก
// auth.admin.generateLink() ซึ่งใช้ได้เฉพาะ service_role ฝั่งเซิร์ฟเวอร์เท่านั้น
// และตาราง device_login_requests ถูก revoke จาก anon/authenticated ทั้งหมดโดยตั้งใจ
//
// สิ่งที่ห้ามหลุดออกจากฟังก์ชันนี้เด็ดขาด:
//   - match_number (ต้องรู้จากจอ PC เท่านั้น ไม่งั้นตัวกันการสวมรอยไร้ผล)
//   - verifier_hash
//   - token_hash ให้ผู้เรียกที่พิสูจน์ verifier ไม่ได้

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// เจ้าหน้าที่เท่านั้น ประชาชนไม่มีเหตุต้องล็อกอินบน PC สำนักงาน — ยิ่งเปิดกว้างยิ่งเพิ่มพื้นที่ถูกโจมตี
const STAFF_ROLES = new Set(['superadmin', 'admin', 'officer', 'technician', 'staff', 'viewer', 'council'])

// เพดานการยิงผิด: แตะเลขผิดหรือส่ง verifier ผิด = ปิดคำขอทิ้งทันที ไม่ให้เดาซ้ำ
// (มีเลขให้เลือก 3 ตัว ถ้าปล่อยให้ลองซ้ำได้ โอกาสเดาถูกจะไต่จาก 1/3 ขึ้นไปเรื่อยๆ)
const MAX_ATTEMPTS = 1
const REQUEST_TTL_SECONDS = 300
// หลังมือถืออนุมัติ ต่ออายุให้ PC มีเวลามา claim แม้รหัสจะใกล้หมดอายุพอดี
const CLAIM_GRACE_SECONDS = 60
const RATE_LIMIT_WINDOW_MINUTES = 10
const RATE_LIMIT_MAX_STARTS = 20

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function randomInt(minInclusive: number, maxInclusive: number) {
  const span = maxInclusive - minInclusive + 1
  const bytes = new Uint32Array(1)
  // ตัดค่าที่ทำให้การ mod เอนเอียง (modulo bias) ทิ้ง แล้วสุ่มใหม่ — เลข 2 หลักนี้คือตัวกัน
  // การสวมรอย (หลอกให้เจ้าหน้าที่อนุมัติเครื่องของคนร้าย) ถ้ามันเดาง่ายกว่าที่ควร
  // มาตรการทั้งหมดก็อ่อนลงตาม
  const limit = Math.floor(0xffffffff / span) * span
  let value = 0
  do {
    crypto.getRandomValues(bytes)
    value = bytes[0]
  } while (value >= limit)
  return minInclusive + (value % span)
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// เทียบแบบเวลาคงที่ กันการงัดค่าทีละไบต์จากเวลาตอบกลับ
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function clientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  const first = forwarded.split(',')[0]?.trim()
  return first || null
}

// อธิบายเครื่องที่ขอเข้าใช้งานให้เจ้าหน้าที่อ่านรู้เรื่อง ไม่ใช่โชว์ user agent ดิบ
function describeDevice(userAgent: string) {
  const ua = userAgent.toLowerCase()
  let os = 'ไม่ทราบระบบปฏิบัติการ'
  if (ua.includes('windows')) os = 'Windows'
  else if (ua.includes('android')) os = 'Android'
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iPhone/iPad'
  else if (ua.includes('mac os')) os = 'Mac'
  else if (ua.includes('linux')) os = 'Linux'

  let browser = 'ไม่ทราบเบราว์เซอร์'
  if (ua.includes('edg/')) browser = 'Edge'
  else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome'
  else if (ua.includes('firefox/')) browser = 'Firefox'
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari'

  return { os, browser }
}

function cleanText(value: unknown, maxLength = 400) {
  return String(value ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const body = await req.json() as Record<string, unknown>
    const action = String(body.action ?? '')

    // ── 1. PC ขอคำขอใหม่ ────────────────────────────────────────────────────
    if (action === 'start') {
      const ip = clientIp(req)
      if (ip) {
        const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString()
        const { count } = await admin
          .from('device_login_requests')
          .select('id', { count: 'exact', head: true })
          .eq('requester_ip', ip)
          .gte('created_at', since)
        if ((count ?? 0) >= RATE_LIMIT_MAX_STARTS) {
          return json({ ok: false, error: 'ขอรหัสถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' }, 429)
        }
      }

      const code = randomHex(16)          // 128 bit — ฝั่ง PC เก็บไว้เองสำหรับขั้น claim
      const verifier = randomHex(32)      // 256 bit — อยู่แต่ในแรมของ PC เครื่องนี้
      const matchNumber = randomInt(10, 99)

      const decoys = new Set<number>()
      while (decoys.size < 2) {
        const candidate = randomInt(10, 99)
        if (candidate !== matchNumber) decoys.add(candidate)
      }

      const expiresAt = new Date(Date.now() + REQUEST_TTL_SECONDS * 1000).toISOString()
      const verifierHash = await sha256Hex(verifier)
      const userAgent = cleanText(req.headers.get('user-agent'), 400)

      // รหัสสั้นสำหรับกรอกมือ (ทางเข้าสำรองเมื่อสแกนไม่ได้ เช่น iOS ที่ล็อกอินไว้ใน PWA
      // ซึ่งแยก storage จาก Safari ที่แอปกล้องเปิดให้) — unique index กันชนไว้อีกชั้น
      // จึงวนสุ่มใหม่ได้เมื่อบังเอิญไปตรงกับคำขอที่ยังค้างอยู่
      let shortCode = ''
      let inserted = false
      for (let attempt = 0; attempt < 5; attempt += 1) {
        shortCode = String(randomInt(100000, 999999))
        const { error } = await admin.from('device_login_requests').insert({
          code,
          short_code: shortCode,
          verifier_hash: verifierHash,
          match_number: matchNumber,
          decoy_numbers: [...decoys],
          requester_ip: ip,
          requester_user_agent: userAgent,
          expires_at: expiresAt,
        })
        if (!error) { inserted = true; break }
        // ชนเฉพาะ short_code เท่านั้นที่ควรลองใหม่ ปัญหาอื่นให้เลิกทันที
        if (!String(error.message ?? '').includes('idx_device_login_requests_short_code')) break
      }
      if (!inserted) return json({ ok: false, error: 'ไม่สามารถเริ่มการเข้าสู่ระบบได้' }, 500)

      return json({
        ok: true,
        code,
        verifier,
        match_number: matchNumber,
        short_code: shortCode,
        expires_at: expiresAt,
      })
    }

    // ── 2/3. มือถือดูรายละเอียด แล้วอนุมัติ ──────────────────────────────────
    if (action === 'info' || action === 'approve') {
      // เข้าได้ 2 ทาง: รหัสสั้น 6 หลักที่เจ้าหน้าที่กรอกเอง หรือ code 32 hex (เผื่อไว้สำหรับ
      // ลิงก์ตรงในอนาคต) — ทั้งคู่ใช้ได้แค่ขั้นนี้ ฝั่ง PC ที่มาแลก session ยังต้องพิสูจน์ด้วย verifier เสมอ
      const byCode = isHex(body.code, 32)
      const shortCode = String(body.short_code ?? '').trim()
      const byShortCode = /^[0-9]{6}$/.test(shortCode)
      if (!byCode && !byShortCode) return json({ ok: false, error: 'รหัสไม่ถูกต้อง' }, 400)

      const authorization = req.headers.get('Authorization') ?? ''
      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: authorization ? { Authorization: authorization } : {} },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: authData } = await authClient.auth.getUser()
      const approverId = authData.user?.id ?? null
      if (!approverId) return json({ ok: false, error: 'กรุณาเข้าสู่ระบบบนมือถือก่อน' }, 401)

      const { data: profile } = await admin
        .from('profiles')
        .select('role, full_name, municipality_id')
        .eq('id', approverId)
        .maybeSingle()

      if (!profile || !STAFF_ROLES.has(profile.role)) {
        return json({
          ok: false,
          error: 'การเข้าสู่ระบบด้วยรหัสจากมือถือ ใช้ได้เฉพาะบัญชีเจ้าหน้าที่เท่านั้น',
        }, 403)
      }

      const columns = 'id, status, match_number, decoy_numbers, requester_ip, requester_user_agent, expires_at, attempt_count'
      const lookup = admin.from('device_login_requests').select(columns)
      const { data: request } = byCode
        ? await lookup.eq('code', body.code).maybeSingle()
        : await lookup.eq('short_code', shortCode).maybeSingle()

      if (!request) return json({ ok: false, error: 'ไม่พบคำขอนี้ กรุณาขอรหัสใหม่ที่หน้าจอคอมพิวเตอร์' }, 404)
      if (request.status !== 'pending') {
        return json({ ok: false, error: 'คำขอนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่ที่หน้าจอคอมพิวเตอร์' }, 409)
      }
      if (new Date(request.expires_at).getTime() < Date.now()) {
        await admin.from('device_login_requests').update({ status: 'expired' }).eq('id', request.id)
        return json({ ok: false, error: 'รหัสหมดอายุแล้ว กรุณากดขอรหัสใหม่ที่หน้าจอคอมพิวเตอร์' }, 410)
      }

      const device = describeDevice(request.requester_user_agent ?? '')

      if (action === 'info') {
        return json({
          ok: true,
          device: { os: device.os, browser: device.browser, ip: request.requester_ip },
          // สลับลำดับทุกครั้ง และไม่บอกว่าตัวไหนถูก — ผู้อนุมัติต้องอ่านเลขจากจอ PC เท่านั้น
          numbers: shuffle([request.match_number, ...request.decoy_numbers]),
          expires_at: request.expires_at,
          approver_name: profile.full_name,
        })
      }

      // action === 'approve'
      const pick = Number(body.pick)
      if (!Number.isInteger(pick) || pick < 10 || pick > 99) {
        return json({ ok: false, error: 'กรุณาเลือกตัวเลขที่ตรงกับหน้าจอคอมพิวเตอร์' }, 400)
      }

      if (pick !== request.match_number) {
        const attempts = request.attempt_count + 1
        await admin
          .from('device_login_requests')
          .update({
            attempt_count: attempts,
            status: attempts >= MAX_ATTEMPTS ? 'denied' : 'pending',
          })
          .eq('id', request.id)
        return json({
          ok: false,
          error: 'ตัวเลขไม่ตรงกับหน้าจอคอมพิวเตอร์ ยกเลิกคำขอนี้แล้วเพื่อความปลอดภัย'
            + ' หากคุณไม่ได้เป็นผู้ขอเข้าสู่ระบบ แปลว่ามีคนพยายามใช้บัญชีคุณ',
        }, 403)
      }

      // ล็อกด้วย status='pending' ใน WHERE — กันสองคนกดอนุมัติคำขอเดียวกันพร้อมกัน
      const { data: approved } = await admin
        .from('device_login_requests')
        .update({
          status: 'approved',
          approved_user_id: approverId,
          municipality_id: profile.municipality_id,
          approved_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + CLAIM_GRACE_SECONDS * 1000).toISOString(),
        })
        .eq('id', request.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()

      if (!approved) return json({ ok: false, error: 'คำขอนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่ที่หน้าจอคอมพิวเตอร์' }, 409)

      // ผู้ตรวจสอบต้องตามได้ว่า session บนเครื่องนั้นเกิดจากการอนุมัติของใคร จากเครื่องไหน เมื่อไร
      await admin.from('audit_logs').insert({
        municipality_id: profile.municipality_id,
        actor_id: approverId,
        actor_name: profile.full_name,
        actor_role: profile.role,
        action: 'device_login_approve',
        resource_type: 'device_login',
        resource_id: request.id,
        resource_label: `${device.os} / ${device.browser}`,
        metadata: {
          requester_ip: request.requester_ip,
          requester_user_agent: request.requester_user_agent,
        },
      })

      return json({ ok: true })
    }

    // ── 4. PC มาแลก token ───────────────────────────────────────────────────
    if (action === 'claim') {
      if (!isHex(body.code, 32)) return json({ ok: false, error: 'รหัสไม่ถูกต้อง' }, 400)
      if (!isHex(body.verifier, 64)) return json({ ok: false, error: 'รหัสยืนยันเครื่องไม่ถูกต้อง' }, 400)
      const code = body.code

      const { data: request } = await admin
        .from('device_login_requests')
        .select('id, status, verifier_hash, approved_user_id, expires_at, attempt_count')
        .eq('code', code)
        .maybeSingle()

      if (!request) return json({ ok: false, error: 'not found', status: 'expired' }, 404)

      // ตรวจ verifier ก่อนเสมอ แม้คำขอจะยัง pending — การยิง verifier ผิดคือความพยายามสวมรอย
      // ไม่ใช่การ poll ตามปกติ ต้องนับและตัดจบทันที
      if (!timingSafeEqual(await sha256Hex(body.verifier), request.verifier_hash)) {
        const attempts = request.attempt_count + 1
        await admin
          .from('device_login_requests')
          .update({ attempt_count: attempts, status: attempts >= MAX_ATTEMPTS ? 'denied' : request.status })
          .eq('id', request.id)
        return json({ ok: false, error: 'รหัสยืนยันเครื่องไม่ถูกต้อง', status: 'denied' }, 403)
      }

      if (request.status === 'denied') return json({ ok: false, status: 'denied' }, 403)
      if (request.status === 'claimed') return json({ ok: false, status: 'claimed' }, 409)
      if (new Date(request.expires_at).getTime() < Date.now()) {
        await admin.from('device_login_requests').update({ status: 'expired' }).eq('id', request.id)
        return json({ ok: false, status: 'expired' }, 410)
      }
      if (request.status !== 'approved') return json({ ok: true, status: 'pending' })

      // ปิดคำขอเป็น claimed ก่อนสร้าง token — ถ้าสอง request ยิงพร้อมกัน จะมีแค่อันเดียวที่ผ่าน
      const { data: claimed } = await admin
        .from('device_login_requests')
        .update({ status: 'claimed', claimed_at: new Date().toISOString() })
        .eq('id', request.id)
        .eq('status', 'approved')
        .select('id, approved_user_id')
        .maybeSingle()

      if (!claimed) return json({ ok: false, status: 'claimed' }, 409)

      const { data: userData } = await admin.auth.admin.getUserById(claimed.approved_user_id)
      const email = userData.user?.email ?? ''
      if (!email) {
        return json({
          ok: false,
          status: 'no_email',
          error: 'บัญชีนี้ไม่มีอีเมลในระบบ จึงใช้การเข้าสู่ระบบด้วยรหัสจากมือถือไม่ได้'
            + ' กรุณาให้ผู้ดูแลระบบตั้งอีเมลเข้าสู่ระบบให้ก่อน',
        }, 422)
      }

      // generateLink สร้าง token อย่างเดียว ไม่ได้ส่งอีเมลออกไปหาใคร — token มีอายุสั้นและ
      // ถูกส่งกลับให้เฉพาะเครื่องที่พิสูจน์ verifier ได้แล้วเท่านั้น จึงไม่เคยถูกเก็บลงตาราง
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      })
      const tokenHash = linkData?.properties?.hashed_token
      if (linkError || !tokenHash) {
        return json({ ok: false, error: 'ไม่สามารถสร้าง session ได้ กรุณาลองใหม่' }, 500)
      }

      return json({ ok: true, status: 'approved', token_hash: tokenHash })
    }

    return json({ ok: false, error: 'unknown action' }, 400)
  } catch (_error) {
    return json({ ok: false, error: 'unexpected error' }, 500)
  }
})
