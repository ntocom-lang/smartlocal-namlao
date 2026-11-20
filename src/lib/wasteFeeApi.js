// ชั้นเรียกฐานข้อมูลของเมนู "ทะเบียนค่าธรรมเนียมขยะ" (หน้าจอไม่เรียก supabase ตรงๆ)
// ฐานข้อมูล: supabase/migrations/20261222100000_waste_fee_tables.sql + 20261222100100_waste_fee_rls_rpc.sql
//           + 20261222100200_waste_fee_settings_table.sql + 20261222100300_waste_fee_sorting_confirmers.sql (ผู้ยืนยันคัดแยก)
//
// ⚠️ ทุก query กรอง municipality_id เองเสมอ (RLS กันข้าม อปท. อยู่แล้ว แต่ superadmin อ่านได้ทุก อปท.)
// ⚠️ PostgREST ตัดผลลัพธ์ที่ 1,000 แถว: ทะเบียนบัญชีอาจเกิน จึงอ่านผ่าน fetchAll() ที่ไล่ทีละหน้า
// ⚠️ ช่วงที่ได้ลดค่ากำจัด (waste_fee_sorting_periods) อ่านได้อย่างเดียว — เขียนผ่าน RPC wfee_set_sorting เท่านั้น
// ⚠️ ข้อมูลมีชื่อผู้ชำระ/เบอร์/บ้านเลขที่ (PDPA) — อ่านได้เฉพาะ wfee_is_manager() ตาม RLS ห้ามนำไปแสดงนอกหน้านี้
import { supabase } from './supabase'
import { IMPORT_BATCH_SIZE, chunk } from './wasteFee'

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
 * trigger/RPC ของฐานข้อมูลส่งข้อความไทยมาเองอยู่แล้ว (เช่น "เริ่มลดได้ตั้งแต่เดือนปัจจุบันเป็นต้นไป …") → แสดงตรงๆ
 */
export function friendlyError(error) {
  if (!error) return ''
  const message = String(error.message ?? '')
  const code = error.code
  const isThai = /[฀-๿]/.test(message)
  if (isThai && ['42501', '23514', '22023', '22001', '23503', '23505', 'P0002'].includes(code)) return message
  if (code === '42501' || /row-level security/i.test(message)) return 'คุณไม่มีสิทธิ์ทำรายการนี้ (เมนูนี้สำหรับกองที่ถือเรื่องค่าธรรมเนียมขยะ)'
  if (code === '23505') {
    if (/effective/i.test(message)) return 'มีรุ่นอัตราที่เริ่มมีผลวันเดียวกันอยู่แล้ว — แก้รุ่นเดิมหรือเลือกวันอื่น'
    return 'มีเลขทะเบียนนี้อยู่ในทะเบียนแล้ว'
  }
  if (code === '23514') return 'ข้อมูลไม่ตรงเงื่อนไขของฐานข้อมูล — ตรวจตัวเลข วันที่ และช่องบังคับอีกครั้ง'
  if (code === 'PGRST205' || code === '42P01') return 'ระบบยังไม่ได้ติดตั้งตารางของเมนูนี้ในฐานข้อมูล — แจ้งผู้ดูแลระบบ'
  if (code === 'PT429') return 'ทำรายการถี่เกินไป — รอสักครู่แล้วลองใหม่'
  if (isThai) return message
  return 'บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบ'
}

// ── สิทธิ์ ───────────────────────────────────────────────────────────────────────────

/** ผู้จัดการทะเบียน (superadmin / admin / เจ้าหน้าที่กองเจ้าของงานขยะ) */
export async function fetchIsManager(municipalityId) {
  const { data, error } = await supabase.rpc('wfee_is_manager', { p_municipality_id: municipalityId })
  return error ? { value: false, error } : { value: data === true, error: null }
}

/** ยืนยัน/เลิกการคัดแยกได้ไหม (ค่าตั้งราย อปท. — ตัวบังคับจริงอยู่ใน wfee_set_sorting) */
export async function fetchCanConfirmSorting(municipalityId) {
  const { data, error } = await supabase.rpc('wfee_can_confirm_sorting', { p_municipality_id: municipalityId })
  return error ? { value: false, error } : { value: data === true, error: null }
}

/** admin/superadmin ของ อปท. นี้ = ตั้งค่าผู้ยืนยันได้ */
export async function fetchIsAdmin(municipalityId) {
  const { data, error } = await supabase.rpc('wfee_is_admin', { p_municipality_id: municipalityId })
  return error ? { value: false, error } : { value: data === true, error: null }
}

// ── ค่าตั้ง (ผู้ยืนยันการคัดแยก) — ไม่มีแถว = ค่าเริ่มต้น admin + officer · ไฟล์ 20261222100200/100300 ─────

const SETTINGS_COLS = 'municipality_id, sorting_confirmer_roles, sorting_delegation_ref, updated_by, updated_at'

export async function fetchSettings(municipalityId) {
  const { data, error } = await supabase.from('waste_fee_settings').select(SETTINGS_COLS)
    .eq('municipality_id', municipalityId).maybeSingle()
  return { settings: data ?? null, error }
}

/** admin/superadmin เท่านั้น (RLS) · ไม่มีปุ่มลบ — กลับค่าเริ่มต้น = เลือก admin + officer */
export async function saveSettings(municipalityId, { roles, delegationRef }) {
  const payload = {
    municipality_id: municipalityId,
    sorting_confirmer_roles: [...new Set(roles)],
    sorting_delegation_ref: String(delegationRef ?? '').trim() || null,
  }
  const { data, error } = await supabase.from('waste_fee_settings').upsert(payload, { onConflict: 'municipality_id' })
    .select(SETTINGS_COLS).maybeSingle()
  return { settings: data ?? null, error }
}

// ── อัตรา ───────────────────────────────────────────────────────────────────────────

const RATE_COLS = 'id, municipality_id, effective_from, ordinance_ref, basis, base_collect, base_dispose, unit_collect, unit_dispose, big_unit_collect, big_unit_dispose, place_type_rates, sorting_discount, is_example, note, created_at, updated_at'

export async function fetchRates(municipalityId) {
  const { data, error } = await supabase.from('waste_fee_rates').select(RATE_COLS)
    .eq('municipality_id', municipalityId).order('effective_from', { ascending: false })
  return { rates: data ?? [], error }
}

export async function insertRate(municipalityId, payload) {
  const { data, error } = await supabase.from('waste_fee_rates').insert({ municipality_id: municipalityId, ...payload }).select(RATE_COLS).single()
  return { rate: data, error }
}

export async function updateRate(id, municipalityId, payload) {
  const { error } = await supabase.from('waste_fee_rates').update(payload).eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

export async function deleteRate(id, municipalityId) {
  const { error } = await supabase.from('waste_fee_rates').delete().eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

// ── ทะเบียนบัญชี ─────────────────────────────────────────────────────────────────────

const ACCOUNT_COLS = 'id, municipality_id, account_no, payer_name, payer_phone, house_no, village, address, place_type, monthly_units, service_from, status, closed_from, closed_reason, note, import_batch, created_at, updated_at'

export async function fetchAccounts(municipalityId) {
  const { data, error } = await fetchAll(() => supabase.from('waste_fee_accounts').select(ACCOUNT_COLS)
    .eq('municipality_id', municipalityId).order('id'))
  return { accounts: data ?? [], error }
}

export async function insertAccount(municipalityId, payload) {
  const { data, error } = await supabase.from('waste_fee_accounts').insert({ municipality_id: municipalityId, ...payload }).select(ACCOUNT_COLS).single()
  return { account: data, error }
}

/** แก้ข้อมูลบัญชี — ไม่ส่งช่องคัดแยก/ปิดบัญชี (ปิดบัญชีใช้ closeAccount/reopenAccount · คัดแยกใช้ setSorting) */
export async function updateAccount(id, municipalityId, payload) {
  const { error } = await supabase.from('waste_fee_accounts').update(payload).eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

export async function deleteAccount(id, municipalityId) {
  const { error } = await supabase.from('waste_fee_accounts').delete().eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

/** เลิกเก็บ: เดือนแรกที่ไม่เก็บ (ปัดเป็นวันที่ 1 โดย trigger) + เหตุผลบังคับ — ลงประวัติให้เอง */
export async function closeAccount(id, municipalityId, { closedFrom, reason }) {
  const { error } = await supabase.from('waste_fee_accounts')
    .update({ status: 'closed', closed_from: closedFrom, closed_reason: String(reason).trim() })
    .eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

/** เปิดเก็บต่อ (แก้กรณีกดเลิกเก็บผิด) — ล้างเดือน/เหตุผลที่เลิกเก็บ ลงประวัติให้เอง */
export async function reopenAccount(id, municipalityId) {
  const { error } = await supabase.from('waste_fee_accounts')
    .update({ status: 'active', closed_from: null, closed_reason: null })
    .eq('id', id).eq('municipality_id', municipalityId)
  return { error }
}

// ── นำเข้า Excel ────────────────────────────────────────────────────────────────────

/**
 * นำเข้าชุดละ 200 แถว (หนึ่งก้อน = หนึ่งคำสั่ง INSERT = สำเร็จทั้งก้อนหรือล้มทั้งก้อน) · ทั้งไฟล์ใช้ import_batch เดียวกัน
 * ก้อนไหนล้ม → หยุดทันที (ก้อนก่อนหน้าบันทึกไปแล้ว ยกเลิกทั้งชุดได้ด้วย cancelImportBatch)
 * @returns {{ batchId: string, inserted: number, error: object|null, failedAt: number|null }}
 */
export async function importAccounts(municipalityId, payloads, onProgress) {
  const batchId = crypto.randomUUID()
  let inserted = 0
  const groups = chunk(payloads, IMPORT_BATCH_SIZE)
  for (let i = 0; i < groups.length; i += 1) {
    const rows = groups[i].map(p => ({ ...p, municipality_id: municipalityId, import_batch: batchId }))
    const { error } = await supabase.from('waste_fee_accounts').insert(rows)
    if (error) return { batchId, inserted, error, failedAt: i * IMPORT_BATCH_SIZE + 1 }
    inserted += rows.length
    onProgress?.(inserted, payloads.length)
  }
  return { batchId, inserted, error: null, failedAt: null }
}

/** ยกเลิกทั้งชุดนำเข้า = ลบแถวของชุดนั้น (ประวัติของแถวที่ลบยังอยู่ — ไม่มีค่าเบอร์/ที่อยู่) */
export async function cancelImportBatch(municipalityId, batchId) {
  const { error, count } = await supabase.from('waste_fee_accounts').delete({ count: 'exact' })
    .eq('municipality_id', municipalityId).eq('import_batch', batchId)
  return { deleted: count ?? 0, error }
}

// ── ประวัติ ─────────────────────────────────────────────────────────────────────────

export async function fetchEvents(entityId) {
  const { data, error } = await supabase.from('waste_fee_events').select('id, entity, action, changes, reason, actor, created_at')
    .eq('entity_id', entityId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200)
  return { events: data ?? [], error }
}

// ── RPC (ส่งครบทุก argument เสมอ — PostgREST เลือกฟังก์ชันจากชุดชื่อ argument) ────────────

/** ช่วงที่ได้ลดค่ากำจัดทั้งหมดของ อปท. (อ่านอย่างเดียว) — ใช้ทำป้าย "ลดค่ากำจัด" ในทะเบียนและประวัติรายบัญชี */
export async function fetchSortingPeriods(municipalityId) {
  const { data, error } = await fetchAll(() => supabase.from('waste_fee_sorting_periods')
    .select('id, municipality_id, account_id, starts_on, ends_on, note, confirmed_by, confirmed_at, ended_by, ended_at, end_note')
    .eq('municipality_id', municipalityId).order('id'))
  return { periods: data ?? [], error }
}

/**
 * ยืนยัน/เลิกการคัดแยกขยะ (ลดค่ากำจัดกึ่งหนึ่ง) — ไม่ย้อนหลัง · ต้องมีเหตุผล · ลงประวัติผู้ยืนยัน
 * on = true: p_from = เดือนเริ่มลด (≥ เดือนนี้) · on = false: p_from = เดือนแรกที่ไม่ลดแล้ว (≥ เดือนหน้า)
 * คืน result = { ok, op: 'start'|'reschedule'|'cancel_stop'|'stop'|'drop_unstarted', starts_on, ends_on, rate_has_discount }
 */
export async function setSorting({ accountId, on, from, note }) {
  const { data, error } = await supabase.rpc('wfee_set_sorting', {
    p_account_id: accountId,
    p_on: Boolean(on),
    p_from: from,
    p_note: String(note ?? '').trim(),
  })
  return { result: data ?? null, error }
}

/** ยอดที่ควรเก็บของบัญชีในเดือนที่กำหนด (ดูอย่างเดียว PR1 ยังไม่สร้างยอดค้าง) — เดือนส่งเป็นวันที่ใดก็ได้ในเดือนนั้น */
export async function fetchAccountMonth(accountId, month) {
  const { data, error } = await supabase.rpc('wfee_account_month', { p_account_id: accountId, p_month: month })
  return { result: data ?? null, error }
}
