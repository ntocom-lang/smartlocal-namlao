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

async function legacyStaffFallback(municipalityId, fields = '*') {
  const result = await supabase
    .from('staff')
    .select(fields)
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
 * และ fallback ตาราง staff เดิมจะใช้เฉพาะระหว่างช่วง deploy migration
 */
export async function fetchPublicPersonnel(municipalityId) {
  if (!municipalityId) return { data: [], error: null, source: 'none' }

  const result = await supabase.rpc('get_public_personnel_directory', {
    p_municipality_id: municipalityId,
  })
  if (!result.error) {
    return { data: normalizePersonnel(result.data), error: null, source: 'profiles' }
  }

  console.warn('[personnelDirectory] public RPC unavailable; using legacy staff fallback:', result.error.message)
  return legacyStaffFallback(municipalityId)
}

/**
 * รายชื่อผู้ดำรงตำแหน่งสำหรับเอกสารภายใน/ลายเซ็น
 * RPC ตรวจว่าผู้เรียกเป็นเจ้าหน้าที่ของเทศบาลเดียวกันหรือ Super Admin
 */
export async function fetchPersonnelSignatories(municipalityId) {
  if (!municipalityId) return { data: [], error: null, source: 'none' }

  const result = await supabase.rpc('get_personnel_signatories', {
    p_municipality_id: municipalityId,
  })
  if (!result.error) {
    return { data: normalizePersonnel(result.data), error: null, source: 'profiles' }
  }

  console.warn('[personnelDirectory] signatory RPC unavailable; using legacy staff fallback:', result.error.message)
  return legacyStaffFallback(municipalityId, 'id,name,title,role,photo_url,phone,display_order')
}
