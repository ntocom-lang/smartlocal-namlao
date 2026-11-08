// เรียกใช้งาน "ที่ปรึกษา AI" (เฉพาะ Super Admin) — Edge Function superadmin-advisor + ตาราง advisor_*
// ฟังก์ชัน pure (จัดกลุ่ม/คำนวณเที่ยงคืนไทย/ตรวจค่า) อยู่ที่ advisorHelpers.js เพื่อให้เทสต์ใน node ได้
import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'
import { bangkokDayStartIso, groupConversations } from './advisorHelpers'

export { bangkokDayStartIso, groupConversations }

const ADVISOR_TIMEOUT_MS = 120000
const LOAD_LIMIT = 1000 // PostgREST คืนได้สูงสุด 1000 แถวแล้วตัดเงียบ (NOTES ข้อ 14)

// ⚠️ ห้ามใช้ supabase.functions.invoke — client ใน supabase.js ครอบ fetch ด้วย timeout 25 วิ
// แต่คำตอบ AI ยาวอาจใช้เวลาเกินนั้น จึง fetch เองพร้อม timeout 120 วิ
export async function sendAdvisorMessage({ conversationId, message }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ADVISOR_TIMEOUT_MS)
  let res
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/superadmin-advisor`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversation_id: conversationId, message }),
      signal: controller.signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('รอคำตอบนานเกิน 2 นาที กรุณาลองใหม่อีกครั้ง', { cause: e })
    throw new Error('เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', { cause: e })
  } finally {
    clearTimeout(timer)
  }

  let data = null
  try { data = await res.json() } catch { /* ไม่ใช่ JSON — ใช้ข้อความสำรองด้านล่าง */ }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `ที่ปรึกษา AI ตอบกลับผิดปกติ (รหัส ${res.status})`)
  }
  return data
}

// 1000 แถวล่าสุดของตัวเอง (RLS กรองให้เหลือของ superadmin คนนี้อยู่แล้ว) → รายการบทสนทนา
export async function loadConversations() {
  const { data, error } = await supabase
    .from('advisor_messages')
    .select('id, conversation_id, role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(LOAD_LIMIT)
  if (error) throw new Error(error.message)
  return groupConversations(data ?? [])
}

export async function loadMessages(conversationId) {
  const { data, error } = await supabase
    .from('advisor_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function deleteConversation(conversationId) {
  const { error } = await supabase.from('advisor_messages').delete().eq('conversation_id', conversationId)
  if (error) throw new Error(error.message)
}

export async function loadSettings() {
  const { data, error } = await supabase
    .from('advisor_settings')
    .select('enabled, model, daily_cap, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// เขียนได้เฉพาะ 3 คอลัมน์นี้ (updated_at/updated_by ถูก trigger ประทับเอง)
export async function saveSettings({ enabled, model, daily_cap }) {
  const { data, error } = await supabase
    .from('advisor_settings')
    .update({ enabled, model: String(model).trim(), daily_cap: Number(daily_cap) })
    .eq('id', 1)
    .select('enabled, model, daily_cap, updated_at')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('บันทึกไม่สำเร็จ (ไม่มีสิทธิ์หรือไม่พบแถวตั้งค่า)')
  return data
}

// ยอดที่ผู้ใช้คนนี้ถามวันนี้ (นับแถว role = 'user' ตั้งแต่เที่ยงคืนเวลาไทย)
export async function countToday() {
  const { count, error } = await supabase
    .from('advisor_messages')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'user')
    .gte('created_at', bangkokDayStartIso(new Date()))
  if (error) throw new Error(error.message)
  return count ?? 0
}
