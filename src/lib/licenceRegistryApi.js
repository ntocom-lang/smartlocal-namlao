// ชั้นเรียกฐานข้อมูลของเมนู "ทะเบียนใบอนุญาต" (หน้าจอไม่เรียก supabase ตรงๆ)
// ฐานข้อมูล: supabase/migrations/20261208100000_licence_registry_tables.sql + 20261208100100_licence_registry_rls_rpc.sql
//
// ⚠️ ทุก query กรอง municipality_id เองเสมอ (RLS กันข้าม อปท. อยู่แล้ว แต่ superadmin อ่านได้ทุก อปท.)
// ⚠️ PostgREST ตัดผลลัพธ์ที่ 1,000 แถว: ทะเบียนอาจเกิน จึงอ่านผ่าน fetchAll() ที่ไล่ทีละหน้า
// ⚠️ รับเงิน/ยกเลิกรับเงิน/เปลี่ยนสถานะ ต้องผ่าน RPC เท่านั้น — UPDATE ตรงๆ ถูก trigger ปฏิเสธ (ข้อความไทยจากฐานแสดงตรงๆ)
// ⚠️ ข้อมูลมีชื่อผู้ประกอบการ (PDPA) — อ่านได้เฉพาะ licence_is_manager() ตาม RLS ห้ามนำไปแสดงนอกหน้านี้
import { supabase } from './supabase'
import { IMPORT_BATCH_SIZE, chunk } from './licenceRegistry'

const PAGE = 1000

async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return { data: rows, error: null }
  }
}

/**
 * ข้อความผิดพลาดภาษาไทยที่เจ้าหน้าที่อ่านรู้เรื่อง
 * trigger/RPC ของฐานข้อมูลส่งข้อความไทยมาเองอยู่แล้ว (เช่น "ชำระหลังใบอนุญาตสิ้นอายุ …") → แสดงตรงๆ
 */
export function friendlyError(error) {
  if (!error) return ''
  const message = String(error.message ?? '')
  const code = error.code
  const isThai = /[฀-๿]/.test(message)
  if (isThai && ['42501', '23514', '22023', '22001', '23503', '23505', 'P0002'].includes(code)) return message
  if (code === '42501' || /row-level security/i.test(message)) return 'คุณไม่มีสิทธิ์ทำรายการนี้ (เมนูนี้สำหรับกองที่ถือเรื่องใบอนุญาต)'
  if (code === '23505') return 'มีข้อมูลนี้อยู่แล้ว (เลขที่ใบอนุญาต/ชื่อประเภท/เลขใบเสร็จซ้ำ)'
  if (code === '23503') return 'ลบไม่ได้เพราะมีข้อมูลอื่นอ้างถึงอยู่ (เช่น ใบที่มีประวัติรับค่าธรรมเนียม หรือประเภทที่ยังมีใบอยู่ในทะเบียน) — ใบที่เลิกใช้ให้เปลี่ยนสถานะเป็นเลิกกิจการแทน'
  if (code === 'PGRST205' || code === '42P01') return 'ระบบยังไม่ได้ติดตั้งตารางของเมนูนี้ในฐานข้อมูล — แจ้งผู้ดูแลระบบ'
  if (code === 'PT429') return 'ทำรายการถี่เกินไป — รอสักครู่แล้วลองใหม่'
  if (isThai) return message
  return 'บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบ'
}

// ── สิทธิ์ ───────────────────────────────────────────────────────────────────────────

const boolResult = ({ data, error }) => (error ? { value: false, error } : { value: data === true, error: null })
/** ผู้จัดการทะเบียน (superadmin / admin / เจ้าหน้าที่กองที่ถือเรื่อง) */
export const fetchIsManager = async municipalityId => boolResult(await supabase.rpc('licence_is_manager', { p_municipality_id: municipalityId }))
/** ตั้งค่าได้ (superadmin / admin ของ อปท.) */
export const fetchIsAdmin = async municipalityId => boolResult(await supabase.rpc('licence_is_admin', { p_municipality_id: municipalityId }))

/** วันนี้ตามเวลาไทยจากฐาน (ใช้กับหน้าจอที่ต้องตรงกับตัวตัดสินของ RPC) */
export async function fetchLicenceToday() {
  const { data, error } = await supabase.rpc('licence_today')
  return { today: error ? null : data, error }
}

// ── ค่าตั้ง ─────────────────────────────────────────────────────────────────────────

export async function fetchSettings(municipalityId) {
  const { data, error } = await supabase.from('licence_settings')
    .select('municipality_id, owner_department_id, remind_days, updated_at')
    .eq('municipality_id', municipalityId).maybeSingle()
  return { settings: data ?? null, error }
}

export async function saveSettings(municipalityId, { ownerDepartmentId, remindDays }) {
  const { error } = await supabase.from('licence_settings').upsert({
    municipality_id: municipalityId,
    owner_department_id: ownerDepartmentId || null,
    remind_days: remindDays,
  }, { onConflict: 'municipality_id' })
  return { error }
}

// ── ประเภท ──────────────────────────────────────────────────────────────────────────

const TYPE_COLS = 'id, municipality_id, category, name, doc_kind, validity_months, renewal_by_fee, ordinance_ref, legal_basis, renewal_window_days, default_fee, external_url, external_label, is_active, sort_order'

export async function fetchTypes(municipalityId) {
  const { data, error } = await supabase.from('licence_types').select(TYPE_COLS)
    .eq('municipality_id', municipalityId).order('sort_order').order('name')
  return { types: data ?? [], error }
}

const numOrNull = v => (v === '' || v == null ? null : Number(v))
const textOrNull = v => (String(v ?? '').trim() || null)

function typePayload(f) {
  return {
    category: f.category,
    name: String(f.name).trim(),
    validity_months: f.category === 'other' ? numOrNull(f.validity_months) : null,
    renewal_by_fee: Boolean(f.renewal_by_fee),
    ordinance_ref: textOrNull(f.ordinance_ref),
    legal_basis: textOrNull(f.legal_basis),
    renewal_window_days: numOrNull(f.renewal_window_days),
    default_fee: numOrNull(f.default_fee),
    external_url: textOrNull(f.external_url),
    external_label: textOrNull(f.external_label),
    is_active: f.is_active !== false,
    sort_order: Number(f.sort_order) || 0,
  }
}

export async function insertType(municipalityId, f) {
  // doc_kind / validity_months / renewal_by_fee ของหมวดที่ไม่ใช่ other ฐานข้อมูลคำนวณจากหมวดซ้ำเสมอ (trigger) — ส่งค่าเริ่มต้นไปให้ผ่าน CHECK
  const base = typePayload(f)
  const row = { municipality_id: municipalityId, ...base,
    doc_kind: f.category === 'food_notice' ? 'notice_certificate' : 'licence',
    validity_months: f.category === 'food_notice' ? null : (base.validity_months ?? 12) }
  const { data, error } = await supabase.from('licence_types').insert(row).select(TYPE_COLS).single()
  return { type: data, error }
}

export async function updateType(id, municipalityId, f) {
  const base = typePayload(f)
  const row = { ...base,
    doc_kind: f.category === 'food_notice' ? 'notice_certificate' : 'licence',
    validity_months: f.category === 'food_notice' ? null : (base.validity_months ?? 12) }
  const { error } = await supabase.from('licence_types').update(row).eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

export async function deleteType(id, municipalityId) {
  const { error } = await supabase.from('licence_types').delete().eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

// ── ทะเบียนใบ ───────────────────────────────────────────────────────────────────────

const LICENCE_COLS = 'id, municipality_id, licence_type_id, licence_no, business_name, sub_type, holder_name, holder_phone, address, village, area_sqm, fee_amount, issued_on, expires_on, next_fee_due_on, status, status_from, status_until, status_order_ref, status_reason, note, import_batch, created_at, updated_at'

export async function fetchLicences(municipalityId) {
  const { data, error } = await fetchAll(() => supabase.from('licences').select(LICENCE_COLS)
    .eq('municipality_id', municipalityId).order('id'))
  return { licences: data ?? [], error }
}

function licencePayload(f) {
  return {
    licence_type_id: f.licence_type_id,
    licence_no: textOrNull(f.licence_no),
    business_name: String(f.business_name).trim(),
    sub_type: textOrNull(f.sub_type),
    holder_name: String(f.holder_name).trim(),
    holder_phone: textOrNull(f.holder_phone),
    address: textOrNull(f.address),
    village: textOrNull(f.village),
    area_sqm: numOrNull(f.area_sqm),
    fee_amount: numOrNull(f.fee_amount),
    issued_on: f.issued_on || null,
    expires_on: f.expires_on || null,
    next_fee_due_on: f.next_fee_due_on || null,
    note: textOrNull(f.note),
  }
}

export async function insertLicence(municipalityId, f) {
  const { data, error } = await supabase.from('licences').insert({ municipality_id: municipalityId, ...licencePayload(f) })
    .select(LICENCE_COLS).single()
  return { licence: data, error }
}

/** แก้ข้อมูลใบ — ไม่ส่งวันหมดอายุ/วันครบกำหนด/ประเภท เมื่อใบมีรายการรับเงินแล้ว (ฐานข้อมูลห้ามแก้ตรงๆ ต้องผ่าน RPC) */
export async function updateLicence(id, municipalityId, f, { lockDates = false } = {}) {
  const row = licencePayload(f)
  if (lockDates) { delete row.expires_on; delete row.next_fee_due_on; delete row.licence_type_id }
  const { error } = await supabase.from('licences').update(row).eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

export async function deleteLicence(id, municipalityId) {
  const { error } = await supabase.from('licences').delete().eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

// ── นำเข้า Excel ────────────────────────────────────────────────────────────────────

/**
 * นำเข้าชุดละ 200 แถว (หนึ่งก้อน = หนึ่งคำสั่ง INSERT = สำเร็จทั้งก้อนหรือล้มทั้งก้อน) · ทั้งไฟล์ใช้ import_batch เดียวกัน
 * ก้อนไหนล้ม → หยุดทันที (ก้อนก่อนหน้าบันทึกไปแล้ว ยกเลิกทั้งชุดได้ด้วย cancelImportBatch)
 * @returns {{ batchId: string, inserted: number, error: object|null, failedAt: number|null }}
 */
export async function importLicences(municipalityId, payloads, onProgress) {
  const batchId = crypto.randomUUID()
  let inserted = 0
  const groups = chunk(payloads, IMPORT_BATCH_SIZE)
  for (let i = 0; i < groups.length; i += 1) {
    const rows = groups[i].map(p => ({ ...p, municipality_id: municipalityId, import_batch: batchId }))
    const { error } = await supabase.from('licences').insert(rows)
    if (error) return { batchId, inserted, error, failedAt: i * IMPORT_BATCH_SIZE + 2 }
    inserted += rows.length
    onProgress?.(inserted, payloads.length)
  }
  return { batchId, inserted, error: null, failedAt: null }
}

/** ยกเลิกทั้งชุดนำเข้า = ลบแถวของชุดนั้น (ใบที่มีรายการรับเงินแล้วลบไม่ได้ — ฐานข้อมูลปฏิเสธทั้งคำสั่ง) */
export async function cancelImportBatch(municipalityId, batchId) {
  const { error, count } = await supabase.from('licences').delete({ count: 'exact' })
    .eq('municipality_id', municipalityId).eq('import_batch', batchId)
  return { deleted: count ?? 0, error }
}

// ── ประวัติ ─────────────────────────────────────────────────────────────────────────

export async function fetchHistory(licenceId) {
  const [events, payments] = await Promise.all([
    supabase.from('licence_events').select('id, entity, action, changes, reason, actor, created_at')
      .eq('licence_id', licenceId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200),
    supabase.from('licence_fee_payments')
      .select('id, kind, paid_on, amount, surcharge, receipt_no, period_from, period_to, no_material_change, voided_at, void_reason, created_at')
      .eq('licence_id', licenceId).order('created_at', { ascending: false }).order('id', { ascending: false }),
  ])
  return { events: events.data ?? [], payments: payments.data ?? [], error: events.error ?? payments.error ?? null }
}

// ── RPC (ส่งครบทุก argument เสมอ — PostgREST เลือกฟังก์ชันจากชุดชื่อ argument) ────────────

export async function recordFee({ licenceId, kind, paidOn, amount, receiptNo, surcharge, noMaterialChange }) {
  const { data, error } = await supabase.rpc('licence_record_fee', {
    p_licence_id: licenceId,
    p_kind: kind,
    p_paid_on: paidOn,
    p_amount: Number(amount),
    p_receipt_no: String(receiptNo ?? '').trim(),
    p_surcharge: Number(surcharge) || 0,
    p_no_material_change: Boolean(noMaterialChange),
  })
  return { result: data ?? null, error }
}

export async function voidFee({ paymentId, reason }) {
  const { error } = await supabase.rpc('licence_void_fee', { p_payment_id: paymentId, p_reason: String(reason ?? '').trim() })
  return { error }
}

export async function setStatus({ licenceId, status, reason, orderRef, from, until }) {
  const { error } = await supabase.rpc('licence_set_status', {
    p_licence_id: licenceId,
    p_status: status,
    p_reason: String(reason ?? '').trim(),
    p_order_ref: textOrNull(orderRef),
    p_from: from || null,
    p_until: until || null,
  })
  return { error }
}
