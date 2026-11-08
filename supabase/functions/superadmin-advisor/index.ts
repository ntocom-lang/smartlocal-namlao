// Supabase Edge Function: superadmin-advisor — ที่ปรึกษา AI (Gemini) เฉพาะ Super Admin
// Deploy (ต้องระบุชื่อเสมอ ห้ามรัน `supabase functions deploy` แบบไม่ระบุชื่อ — บอทเก่าจะกลับมา):
//   supabase functions deploy superadmin-advisor
// Secrets: GEMINI_API_KEY (ตัวเดิมของระบบ — เจ้าของระบบอนุมัติ 2569-11-08) · SUPABASE_URL / ANON / SERVICE_ROLE (มีให้เอง)
//
// ── สิทธิ์ ─────────────────────────────────────────────────────────────────────────
// verify_jwt ของแพลตฟอร์มไม่พอ เพราะ anon key ก็เป็น JWT ที่อยู่ในบันเดิลสาธารณะ
// จึงตรวจเองทุกครั้ง: token ต้องเป็นผู้ใช้จริง (auth.getUser) และ profiles.role = 'superadmin' — ไม่ใช่ก็ 403 ก่อนแตะ Google
//
// ── โควตา ─────────────────────────────────────────────────────────────────────────
// Google คิดโควตาต่อ project ไม่ใช่ต่อ key จึงคุมเองอีกชั้น: สวิตช์ปิดทั้งระบบ + เพดานคำถาม/วัน (advisor_settings)
// นับจาก advisor_messages role = 'user' ตั้งแต่เที่ยงคืนเวลาไทย
//
// ── ข้อมูลที่ส่งออกนอกระบบ ───────────────────────────────────────────────────────
// เฟส 1 ไม่แนบข้อมูลจากฐานข้อมูลเลย ส่งเฉพาะสิ่งที่ผู้ใช้พิมพ์ + ประวัติของบทสนทนานั้น (อ่านจากฐาน ไม่เชื่อที่ client ส่งมา)
// ปิดบังเลขบัตร 13 หลัก/เบอร์โทรก่อนส่งทุกครั้ง แล้วเก็บฉบับที่ปิดบังแล้ว (= ของที่ออกไปจริง) เป็นบันทึกย้อนตรวจ
// ห้าม console.log เนื้อข้อความ — log ของ Edge Function ไม่ได้อยู่ใต้ RLS

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  bangkokDayStartIso, buildContents, extractReply, HISTORY_LIMIT, maskPersonalData, MODEL_PATTERN, systemPrompt, validateRequest,
} from '../_shared/advisorCore.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_TIMEOUT_MS = 90_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// key ส่งทาง header ไม่ต่อท้าย URL (URL ไปค้างใน log ของทางผ่าน) · 503 = Google โหลดสูงชั่วคราว ลองใหม่เอง 2 ครั้ง
async function callGemini(model: string, body: unknown, retries = 2): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY as string },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    })
    if (res.status !== 503 || attempt >= retries) return res
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }

  try {
    // ── 1) ผู้เรียกต้องเป็น superadmin ──
    const authorization = req.headers.get('Authorization') ?? ''
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authorization ? { Authorization: authorization } : {} },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData } = await authClient.auth.getUser()
    const callerId = authData.user?.id ?? null
    if (!callerId) return json({ ok: false, error: 'ต้องเข้าสู่ระบบก่อน' }, 401)

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: caller, error: callerErr } = await admin.from('profiles').select('role').eq('id', callerId).maybeSingle()
    if (callerErr) return json({ ok: false, error: 'ตรวจสิทธิ์ไม่สำเร็จ' }, 500)
    if (caller?.role !== 'superadmin') return json({ ok: false, error: 'เมนูนี้ใช้ได้เฉพาะ Super Admin' }, 403)

    // ── 2) ตรวจข้อความ ──
    let body: unknown = null
    try { body = await req.json() } catch { /* ตรวจต่อด้านล่าง */ }
    const input = validateRequest(body)
    if (!input.ok) return json({ ok: false, error: input.error }, 400)

    // ── 3) สวิตช์ + เพดานต่อวัน ──
    const { data: settings, error: settingsErr } = await admin.from('advisor_settings')
      .select('enabled, model, daily_cap').eq('id', 1).maybeSingle()
    if (settingsErr || !settings) return json({ ok: false, error: 'ไม่พบการตั้งค่าที่ปรึกษา AI (ยังไม่ได้รัน migration?)' }, 500)
    if (!settings.enabled) return json({ ok: false, error: 'ที่ปรึกษา AI ปิดอยู่ — เปิดได้ที่แท็บตั้งค่า' }, 403)
    if (!MODEL_PATTERN.test(String(settings.model))) return json({ ok: false, error: 'ชื่อโมเดลในการตั้งค่าไม่ถูกต้อง' }, 500)
    if (!GEMINI_API_KEY) return json({ ok: false, error: 'ยังไม่ได้ตั้ง GEMINI_API_KEY' }, 500)

    const { count: usedToday, error: countErr } = await admin.from('advisor_messages')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user').gte('created_at', bangkokDayStartIso())
    if (countErr) return json({ ok: false, error: 'นับยอดใช้งานวันนี้ไม่สำเร็จ' }, 500)
    const used = usedToday ?? 0
    if (used >= settings.daily_cap) {
      return json({ ok: false, error: `ครบเพดาน ${settings.daily_cap} คำถามของวันนี้แล้ว (ปรับได้ที่แท็บตั้งค่า)`, used_today: used, daily_cap: settings.daily_cap }, 429)
    }

    // ── 4) ประวัติของบทสนทนานี้ (เฉพาะของผู้เรียก) ──
    const { data: historyDesc, error: histErr } = await admin.from('advisor_messages')
      .select('role, content').eq('user_id', callerId).eq('conversation_id', input.conversationId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_LIMIT)
    if (histErr) return json({ ok: false, error: 'อ่านประวัติบทสนทนาไม่สำเร็จ' }, 500)
    const history = (historyDesc ?? []).reverse()

    // ── 5) ปิดบังข้อมูลส่วนบุคคล แล้วถาม Gemini ──
    const { text: safeText, masked } = maskPersonalData(input.message)
    const res = await callGemini(settings.model, {
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: buildContents(history, safeText),
    })
    if (!res.ok) {
      const status = res.status
      const detail = await res.json().catch(() => ({})) as { error?: { message?: string } }
      console.error('gemini error', status, detail?.error?.message ?? '')
      if (status === 429) return json({ ok: false, error: 'โควตาฟรีของ Google เต็มชั่วคราว ลองใหม่อีกสักครู่' }, 429)
      if (status === 503) return json({ ok: false, error: 'Google มีผู้ใช้หนาแน่น ลองใหม่อีกสักครู่' }, 502)
      if (status === 404) return json({ ok: false, error: `ไม่พบโมเดล ${settings.model} — แก้ชื่อโมเดลที่แท็บตั้งค่า` }, 502)
      return json({ ok: false, error: `Google ตอบผิดพลาด (HTTP ${status})` }, 502)
    }
    const reply = extractReply(await res.json())
    if (!reply.ok) return json({ ok: false, error: reply.reason }, 502)

    // ── 6) บันทึกทั้งคำถาม (ฉบับปิดบังแล้ว) และคำตอบ — บันทึกหลังได้คำตอบ ประวัติจะไม่มีคำถามค้างไร้คำตอบ ──
    const now = Date.now()
    const { error: insertErr } = await admin.from('advisor_messages').insert([
      { conversation_id: input.conversationId, user_id: callerId, role: 'user', content: safeText, model: settings.model, masked_count: masked, created_at: new Date(now).toISOString() },
      { conversation_id: input.conversationId, user_id: callerId, role: 'model', content: reply.text, model: settings.model, created_at: new Date(now + 1).toISOString() },
    ])
    if (insertErr) console.error('advisor insert failed:', insertErr.message)

    return json({ ok: true, reply: reply.text, masked, used_today: used + 1, daily_cap: settings.daily_cap, saved: !insertErr })
  } catch (error) {
    const timeout = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.error('superadmin-advisor failed:', timeout ? 'timeout' : String(error))
    return json({ ok: false, error: timeout ? 'AI ใช้เวลาตอบนานเกินไป ลองถามให้สั้นลง' : 'ระบบขัดข้อง ลองใหม่อีกครั้ง' }, timeout ? 504 : 500)
  }
})
