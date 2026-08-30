import { supabase } from './supabase'

function normalizePersonnel(rows) {
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name ?? row.full_name ?? '',
    title: row.title ?? row.position_name ?? '',
    role: row.role ?? 'staff',
    photo_url: row.photo_url ?? row.avatar_url ?? null,
    phone: row.phone ?? null,
    display_order: row.display_order ?? row.sort_order ?? 999,
  }))
}

async function legacyStaffFallback(municipalityId) {
  const result = await supabase
    .from('staff')
    .select('*')
    .eq('municipality_id', municipalityId)
    .eq('is_active', true)
    .order('display_order')

  return {
    data: normalizePersonnel(result.data),
    error: result.error,
    source: 'legacy_staff',
  }
}

/**
 * สมุดรายชื่อสำหรับหน้าเว็บประชาชน
 * RPC ไม่ส่งเบอร์โทรศัพท์จาก profiles ออกสู่ anonymous users
 * และ fallback ตาราง staff เดิมจะใช้ระหว่างที่ อปท. ยังผูก profiles.position_id ไม่ครบ
 *
 * fallback ต้องครอบ 2 กรณี ไม่ใช่แค่กรณีเดียว:
 *   1. RPC error       — ฟังก์ชันยังไม่ถูก deploy ลง DB
 *   2. RPC คืน 0 แถว   — deploy แล้วแต่ อปท. นี้ยังไม่ได้ผูก position_id ให้ใคร
 * เดิมเช็คแค่ข้อ 1 พอฟังก์ชันถูก deploy ขึ้นไป อปท. ที่ยังไม่ได้ผูกตำแหน่งจะได้ 0 แถว
 * แบบ "สำเร็จ" ระบบเลยเลิกใช้ตาราง staff ทันทีทั้งที่ยังมีข้อมูลอยู่ → หน้าบุคลากรว่างเปล่า
 * โดยไม่มี error ให้เห็น (ยืนยันแล้วว่าจะเกิดกับ tamnaktham: staff 2 คน แต่ profiles 0)
 */
export async function fetchPublicPersonnel(municipalityId) {
  if (!municipalityId) return { data: [], error: null, source: 'none' }

  const result = await supabase.rpc('get_public_personnel_directory', {
    p_municipality_id: municipalityId,
  })
  if (!result.error) {
    const rows = normalizePersonnel(result.data)
    if (rows.length > 0) return { data: rows, error: null, source: 'profiles' }
    console.warn('[personnelDirectory] public RPC returned no rows; using legacy staff fallback')
  } else {
    console.warn('[personnelDirectory] public RPC unavailable; using legacy staff fallback:', result.error.message)
  }

  return legacyStaffFallback(municipalityId)
}
