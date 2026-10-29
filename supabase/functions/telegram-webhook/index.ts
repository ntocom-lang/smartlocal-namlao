// telegram-webhook — ผูก Telegram ส่วนตัวของบุคลากร (ข้อ 3b ตั้งค่าแจ้งเตือน, เจ้าของระบบอนุมัติ 2569-10-29)
//
// ⚠️ deploy ด้วย --no-verify-jwt เสมอ: Telegram ยิง update มาโดยไม่มี JWT (ยืนยันตัวด้วยหัว
//    X-Telegram-Bot-Api-Secret-Token = HMAC ของ bot token) ถ้าลืม เกตเวย์ตอบ 401 แล้ว Telegram เลิกส่งเงียบๆ
//    คำขอจากหน้าเว็บ (action) ตรวจ JWT เองในไฟล์นี้
// Secrets: TELEGRAM_BOT_TOKEN (ตัวเดียวกับ notify-telegram ไม่ต้องตั้งใหม่)
//
// ทางเข้า 2 ทาง
// 1) Telegram → มีหัว secret: /start <โทเคน> ผูกบัญชี · /stop เลิกผูก · บล็อกบอต = เลิกผูก
//    · บอตถูกเพิ่ม/ออกจากกลุ่ม หรือมีข้อความในกลุ่ม → จดลง telegram_seen_chats (แทน getUpdates ที่ใช้ไม่ได้อีก)
//    ตอบ 200 เสมอเมื่อ secret ถูก (ตอบอย่างอื่น Telegram จะยิง update เดิมซ้ำเรื่อยๆ)
// 2) หน้าเว็บ → Authorization: Bearer <JWT> + {action}
//    link   : บุคลากรขอลิงก์ t.me/<บอต>?start=<โทเคน> (จำกัด 5 ครั้ง/15 นาที)
//    status : superadmin ดูสถานะ webhook ของบอต
//    setup  : superadmin ตั้ง webhook มาที่ฟังก์ชันนี้ — ถ้าบอตตั้ง webhook ไว้ที่อื่นอยู่แล้วจะไม่ทับ เว้นแต่ส่ง force

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage } from '../_shared/telegram.ts'
import {
  ALLOWED_UPDATES, LINK_REPLY, LINK_TOKEN_TTL_MS, LINK_TOKEN_WINDOW_MS, canLinkTelegram, classifyUpdate, deepLink,
  linkAllowed, linkReply, newLinkToken, safeEqual, sha256Hex, webhookSecret, webhookState, webhookUrl,
} from '../_shared/telegramLink.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type Admin = ReturnType<typeof createClient>

async function telegramApi(method: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  return { ok: response.ok && result.ok === true, result: result.result as Record<string, unknown> | undefined, description: result.description }
}

// ชื่อบอตไม่เปลี่ยนระหว่างที่ instance ยังอยู่ — จำไว้ ไม่เรียก getMe ทุกครั้งที่มีคนกดเชื่อม
let botUsername: string | null = null
async function getBotUsername(): Promise<string | null> {
  if (botUsername) return botUsername
  const me = await telegramApi('getMe')
  botUsername = me.ok && typeof me.result?.username === 'string' ? me.result.username : null
  return botUsername
}

async function reply(chatId: number, text: string) {
  const result = await sendTelegramMessage(String(chatId), text, BOT_TOKEN as string)
  if (!result.ok) console.error('telegram-webhook reply failed:', result.error)
}

async function handleUpdate(admin: Admin, update: unknown) {
  const action = classifyUpdate(update)
  if (action.kind === 'start') {
    const { data, error } = await admin.rpc('telegram_link_consume', {
      p_token_hash: await sha256Hex(action.token), p_chat_id: action.chatId, p_display: action.display,
    })
    if (error) {
      console.error('telegram_link_consume failed:', error.message)
      await reply(action.chatId, 'ระบบเชื่อมบัญชีขัดข้อง ลองใหม่อีกครั้งภายหลัง')
      return
    }
    await reply(action.chatId, linkReply(data))
    return
  }
  if (action.kind === 'start_bare') {
    await reply(action.chatId, LINK_REPLY.bare)
    return
  }
  if (action.kind === 'stop' || action.kind === 'blocked') {
    const { data, error } = await admin.from('telegram_user_links').delete().eq('chat_id', action.chatId).select('user_id')
    if (error) console.error('telegram unlink failed:', error.message)
    // บล็อกบอตแล้วส่งข้อความกลับไม่ได้ (Telegram ตอบ 403) — ตอบเฉพาะ /stop
    if (action.kind === 'stop') await reply(action.chatId, data?.length ? LINK_REPLY.stopped : LINK_REPLY.notLinked)
    return
  }
  if (action.kind === 'group') {
    const now = new Date().toISOString()
    const row: Record<string, unknown> = {
      chat_id: action.chatId, chat_type: action.chatType, title: action.title, last_seen_at: now,
    }
    if (action.botStatus) row.bot_status = action.botStatus
    if (action.migratedTo) row.migrated_to_chat_id = action.migratedTo
    const { error } = await admin.from('telegram_seen_chats').upsert(row, { onConflict: 'chat_id' })
    if (error) console.error('telegram_seen_chats upsert failed:', error.message)
  }
}

async function handleAction(req: Request, admin: Admin, body: Record<string, unknown>) {
  const authClient = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData } = await authClient.auth.getUser()
  const userId = authData.user?.id
  if (!userId) return json({ ok: false, error: 'unauthorized' }, 401)
  const { data: profile } = await admin.from('profiles').select('id,role').eq('id', userId).maybeSingle()
  const role = profile?.role

  if (body.action === 'link') {
    if (!canLinkTelegram(role)) return json({ ok: false, error: 'บัญชีนี้ไม่ได้รับงานมอบหมาย จึงไม่ต้องเชื่อม Telegram' }, 403)
    const since = new Date(Date.now() - LINK_TOKEN_WINDOW_MS).toISOString()
    const { count, error: countError } = await admin.from('telegram_link_tokens')
      .select('token_hash', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', since)
    if (countError) return json({ ok: false, error: 'ตรวจจำนวนครั้งไม่สำเร็จ' }, 500)
    if (!linkAllowed(count)) return json({ ok: false, error: 'ขอลิงก์บ่อยเกินไป รอสักครู่แล้วลองใหม่' }, 429)
    const username = await getBotUsername()
    if (!username) return json({ ok: false, error: 'ติดต่อบอต Telegram ไม่ได้' }, 502)

    // ลิงก์ที่หมดอายุเกิน 1 วันไม่มีประโยชน์แล้ว เก็บกวาดตอนมีคนขอลิงก์ใหม่ (ไม่ต้องมี cron)
    await admin.from('telegram_link_tokens').delete().lt('expires_at', new Date(Date.now() - 86_400_000).toISOString())
    const token = newLinkToken()
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString()
    const { error: insertError } = await admin.from('telegram_link_tokens').insert({
      token_hash: await sha256Hex(token), user_id: userId, expires_at: expiresAt,
    })
    if (insertError) return json({ ok: false, error: 'สร้างลิงก์ไม่สำเร็จ' }, 500)
    return json({ ok: true, url: deepLink(username, token), bot: username, expires_at: expiresAt })
  }

  if (body.action === 'status' || body.action === 'setup') {
    if (role !== 'superadmin') return json({ ok: false, error: 'เฉพาะผู้ดูแลระบบสูงสุด' }, 403)
    const expected = webhookUrl(SUPABASE_URL as string)
    const info = await telegramApi('getWebhookInfo')
    if (!info.ok) return json({ ok: false, error: 'ติดต่อบอต Telegram ไม่ได้' }, 502)
    const state = webhookState(info.result ?? null, expected)
    if (body.action === 'status') return json({ ok: true, ...state, bot: await getBotUsername() })

    if (state.other && body.force !== true) {
      return json({ ok: false, error: `บอตตั้ง webhook ไว้ที่ ${state.otherHost} อยู่แล้ว ยังไม่ได้ทับ`, ...state }, 409)
    }
    const set = await telegramApi('setWebhook', {
      url: expected,
      secret_token: await webhookSecret(BOT_TOKEN as string),
      allowed_updates: ALLOWED_UPDATES,
      max_connections: 5,
    })
    if (!set.ok) return json({ ok: false, error: String(set.description ?? 'ตั้ง webhook ไม่สำเร็จ').slice(0, 200) }, 502)
    const after = await telegramApi('getWebhookInfo')
    return json({ ok: true, ...webhookState(after.result ?? null, expected), bot: await getBotUsername() })
  }

  return json({ ok: false, error: 'unknown action' }, 400)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (Number(req.headers.get('content-length') ?? 0) > 65536) return json({ ok: false, error: 'request too large' }, 413)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }
  if (!BOT_TOKEN) return json({ ok: false, error: 'Telegram bot is not configured' }, 503)

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const telegramSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token')

  try {
    if (telegramSecret !== null) {
      if (!safeEqual(telegramSecret, await webhookSecret(BOT_TOKEN))) return json({ ok: false, error: 'unauthorized' }, 401)
      const update = await req.json().catch(() => null)
      await handleUpdate(admin, update)
      return json({ ok: true })
    }
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body.action !== 'string') return json({ ok: false, error: 'invalid request' }, 400)
    return await handleAction(req, admin, body)
  } catch (error) {
    console.error('telegram-webhook failed:', error)
    // update ที่ secret ถูกแต่ประมวลผลพัง: ตอบ 200 ไม่ให้ Telegram ยิงซ้ำวนไม่จบ (ผู้ใช้กดเชื่อมใหม่ได้)
    return telegramSecret !== null ? json({ ok: true }) : json({ ok: false, error: 'internal error' }, 500)
  }
})
