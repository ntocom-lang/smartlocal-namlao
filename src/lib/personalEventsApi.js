// รายการส่วนตัวในปฏิทิน ("🔒 เฉพาะฉัน") — ส่วนที่คุยกับฐานข้อมูล
// แยกจาก personalEvents.js (ตรรกะล้วนที่เทสต์ node import ตรง) และจากไฟล์คอมโพเนนต์
// (lint react-refresh ห้ามไฟล์คอมโพเนนต์ export ฟังก์ชันธรรมดา)
//
// อ่าน/เขียนตาราง personal_events ตรงๆ ได้ เพราะ RLS ให้เห็นเฉพาะแถวของตัวเองอยู่แล้ว
// กติกา 100 รายการ/ล่วงหน้า 1 ปี บังคับที่ trigger personal_events_guard (migration 20261001150100)
//
// ⚠️ ห้ามเรียก notifyTelegram / logAction กับรายการพวกนี้ — กลุ่ม Telegram และหน้าประวัติของแอดมิน
// จะเห็นชื่อรายการที่เจ้าของตั้งใจให้เห็นคนเดียว
import { supabase } from './supabase'
import { todayStr } from './thaiDate'
import { toPersonalEvent } from './personalEvents'

const COLUMNS = 'id, owner_id, municipality_id, title, description, event_date, end_date, event_time, end_time, location, category, repeat_yearly, created_at, updated_at'

// ดึงทั้งหมดในคำสั่งเดียวได้เสมอ: เพดาน 100 รายการต่อคนต่อ อปท. ต่ำกว่าเพดาน 1,000 แถวของ PostgREST
// (docs/ai/NOTES.md ข้อ 14) กรอง owner_id ซ้ำกับ RLS เพื่อให้ใช้ index (owner_id, municipality_id, event_date)
export async function loadPersonalEvents(tenantId, userId) {
  if (!tenantId || !userId) return { rows: [], error: null }
  const { data, error } = await supabase
    .from('personal_events')
    .select(COLUMNS)
    .eq('municipality_id', tenantId)
    .eq('owner_id', userId)
    .order('event_date', { ascending: true })
  if (error) return { rows: [], error }
  const today = todayStr()
  return { rows: (data ?? []).map((row) => toPersonalEvent(row, today)), error: null }
}

// payload มาจาก personalPayload() — ไม่ส่ง owner_id (ฐานข้อมูลใส่ auth.uid() เอง และตรึงไว้ตอนแก้)
// คืน error ของ PostgREST ตามเดิม (มี .code = PE001/PE002 เมื่อชนกติกา และ .message เป็นภาษาไทย)
export async function savePersonalEvent({ id = null, tenantId, payload }) {
  const query = id
    ? supabase.from('personal_events').update(payload).eq('id', id)
    : supabase.from('personal_events').insert({ ...payload, municipality_id: tenantId })
  const { data, error } = await query.select('id')
  if (error) return { id: null, error }
  // แก้ไขแล้วได้ 0 แถว = RLS กรองออก (ไม่ใช่ของตัวเอง หรือถูกลบไปแล้วจากอีกแท็บ)
  if (!data?.length) return { id: null, error: { message: 'ไม่พบรายการนี้แล้ว อาจถูกลบไปก่อนหน้า กรุณาโหลดหน้าใหม่' } }
  return { id: data[0].id, error: null }
}

export async function deletePersonalEvent(id) {
  const { error } = await supabase.from('personal_events').delete().eq('id', id)
  return { error }
}
