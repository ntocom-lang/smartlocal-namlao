import { supabase } from './supabase'

// cache actor info for 60s เพื่อไม่ต้อง query DB ทุกครั้ง
let _cache = null
let _cacheExpiry = 0

async function getActor() {
  if (_cache && Date.now() < _cacheExpiry) return _cache
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()
  _cache = {
    id: user.id,
    name: profile?.full_name || user.email || 'unknown',
    role: profile?.role || 'unknown',
  }
  _cacheExpiry = Date.now() + 60_000
  return _cache
}

/**
 * บันทึก action ลง audit_logs
 * @param {object} opts
 * @param {string} opts.action        — 'delete' | 'update_status' | 'approve' | 'reject' | 'assign'
 * @param {string} opts.resourceType  — 'complaint' | 'event' | 'document_request' | 'document' | ...
 * @param {string} opts.resourceId    — id ของ record
 * @param {string} opts.resourceLabel — ชื่อ/หัวข้อของ record (เพื่อแสดงในหน้า audit)
 * @param {string} opts.municipalityId
 * @param {object} [opts.metadata]    — snapshot หรือข้อมูลเพิ่มเติม
 */
export async function logAction({ action, resourceType, resourceId, resourceLabel, municipalityId, metadata }) {
  try {
    const actor = await getActor()
    if (!actor || !municipalityId) return
    const { error } = await supabase.from('audit_logs').insert({
      municipality_id: municipalityId,
      actor_id:        actor.id,
      actor_name:      actor.name,
      actor_role:      actor.role,
      action,
      resource_type:   resourceType,
      resource_id:     String(resourceId),
      resource_label:  resourceLabel ?? null,
      metadata:        metadata ?? null,
    })
    // ยังไม่ block UI เหมือนเดิม แต่ต้องไม่เงียบสนิท
    // เคสจริง: RLS ปฏิเสธ insert ของ superadmin (municipality_id = null) มาตั้งแต่ migration 068
    // ทุก action ของบัญชีที่มีอำนาจสูงสุดจึงไม่ถูกบันทึกเลย และไม่มีใครรู้เพราะ error ถูกกลืนทิ้ง
    if (error) console.warn('[auditLog] บันทึกร่องรอยการใช้งานไม่สำเร็จ:', error.message, { action, resourceType, resourceId })
  } catch (err) {
    console.warn('[auditLog] บันทึกร่องรอยการใช้งานไม่สำเร็จ:', err?.message ?? err)
  }
}

export function clearActorCache() {
  _cache = null
  _cacheExpiry = 0
}
