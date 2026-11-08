// เรียกใช้งาน "ที่ปรึกษา AI" (เฉพาะ Super Admin) — Edge Function superadmin-advisor + ตาราง advisor_*
// ฟังก์ชัน pure (จัดกลุ่ม/คำนวณเที่ยงคืนไทย/ตรวจค่า) อยู่ที่ advisorHelpers.js เพื่อให้เทสต์ใน node ได้
import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'
import { bangkokDayStartIso, groupConversations } from './advisorHelpers'

export { bangkokDayStartIso, groupConversations }

const ADVISOR_TIMEOUT_MS = 120000
const LOAD_LIMIT = 1000 // PostgREST คืนได้สูงสุด 1000 แถวแล้วตัดเงียบ (NOTES ข้อ 14)

// ⚠️ ห้ามใช้ supabase.functions.invoke — client ใน supabase.js ครอบ fetch ด้วย timeout 25 วิ
// แต่คำตอบ AI ยาวอาจใช้เวลาเกินนั้น จึง fetch เองพร้อม timeout 120 วิ
// overviewDays: 30/90 = แนบภาพรวมระบบ (ตัวเลขรวม) ไปกับคำถามนี้ · ไม่ส่ง = ไม่แนบ
export async function sendAdvisorMessage({ conversationId, message, overviewDays = null }) {
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
      body: JSON.stringify({ conversation_id: conversationId, message, ...(overviewDays ? { overview_days: overviewDays } : {}) }),
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
    // 503 ส่ง notes[] มาด้วย (แต่ละช่องติดอะไร) — แนบไปกับ error ให้หน้าจอแสดงทีละข้อ
    const err = new Error(data?.error || `ที่ปรึกษา AI ตอบกลับผิดปกติ (รหัส ${res.status})`)
    err.status = res.status
    err.notes = Array.isArray(data?.notes) ? data.notes.map(String) : []
    throw err
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
    .select('id, role, content, created_at, provider, slot, model, route_note')
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

// สวิตช์ปิดทั้งเมนู (advisor_settings.enabled) — model/daily_cap ของตารางนี้เลิกใช้แล้วตั้งแต่รอบ 2 (ย้ายไปอยู่ที่ช่อง) ห้ามเขียน/ห้ามเลือกมาแสดง
export async function loadSettings() {
  const { data, error } = await supabase
    .from('advisor_settings')
    .select('enabled, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function saveSettings({ enabled }) {
  const { data, error } = await supabase
    .from('advisor_settings')
    .update({ enabled: Boolean(enabled) })
    .eq('id', 1)
    .select('enabled, updated_at')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('บันทึกไม่สำเร็จ (ไม่มีสิทธิ์หรือไม่พบแถวตั้งค่า)')
  return data
}

// ช่องผู้ให้บริการ 3 ช่อง — ระบุคอลัมน์ชัด (key_secret_id ไม่ได้ขอ และสิทธิ์ก็ไม่ให้อ่านตัว key อยู่แล้ว)
const SLOT_COLUMNS = 'slot, provider, tier, enabled, model, daily_cap, key_last4, key_set_at, key_invalid_at, paused_until, pause_reason, updated_at'

export async function loadSlots() {
  const { data, error } = await supabase
    .from('advisor_provider_slots')
    .select(SLOT_COLUMNS)
    .order('slot', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

// สิทธิ์ UPDATE ของ authenticated มีแค่ enabled / model / daily_cap (+ paused_until/pause_reason คู่กัน) — ห้ามส่งคอลัมน์อื่น
export async function saveSlot(slot, { enabled, model, daily_cap }) {
  const { data, error } = await supabase
    .from('advisor_provider_slots')
    .update({ enabled: Boolean(enabled), model: String(model).trim(), daily_cap })
    .eq('slot', slot)
    .select(SLOT_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('บันทึกไม่สำเร็จ (ไม่มีสิทธิ์หรือไม่พบช่อง)')
  return data
}

// ปลดพัก: ต้องส่งสองคอลัมน์พร้อมกัน (CHECK advisor_provider_slots_pause_pair)
export async function unpauseSlot(slot) {
  const { data, error } = await supabase
    .from('advisor_provider_slots')
    .update({ paused_until: null, pause_reason: null })
    .eq('slot', slot)
    .select(SLOT_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('ปลดพักไม่สำเร็จ (ไม่มีสิทธิ์หรือไม่พบช่อง)')
  return data
}

// ใส่/เปลี่ยน key (p_key ว่าง = ลบ) — key เก็บใน Vault ฝั่งฐานข้อมูล ฟังก์ชันคืนแค่ 4 ตัวท้าย
// ⚠️ ห้ามใส่ { get: true }: GET จะเอา key ไปไว้ใน URL ซึ่งติด log ของ gateway · ค่าเริ่มต้นของ rpc เป็น POST
// ⚠️ ห้าม log/เก็บ key ที่ไหนทั้งสิ้น — error ที่คืนมามีเฉพาะข้อความภาษาไทยจากฐาน (รหัส 22023/42501) ไม่มีค่า key
export async function setSlotKey(slot, key) {
  const { data, error } = await supabase.rpc('advisor_set_slot_key', { p_slot: slot, p_key: key })
  if (error) {
    if (error.code === '22023' || error.code === '42501') throw new Error(error.message)
    throw new Error('บันทึก key ไม่สำเร็จ ลองใหม่อีกครั้ง')
  }
  return { key_last4: data?.key_last4 ?? null }
}
