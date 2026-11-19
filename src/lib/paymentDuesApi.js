// ชั้นเรียกฐานข้อมูลของเมนู "รับชำระเงิน" (หน้าจอไม่เรียก supabase ตรงๆ)
// ฐานข้อมูล: supabase/migrations/20261211100000_payment_dues_tables.sql + 20261211100100_payment_dues_rls_rpc.sql
//
// ⚠️ เขียนทุกอย่างผ่าน RPC เท่านั้น (ตารางเปิดอ่านอย่างเดียวตาม RLS) · ข้อความ error ภาษาไทยจากฐานแสดงตรงๆ (friendlyError)
// ⚠️ รายการยอดมีชื่อผู้ประกอบการ (PDPA): อ่านผ่าน payment_list_dues ที่ตรวจสิทธิ์แล้ว — ที่อยู่ส่งมาเฉพาะผู้จัดการทะเบียน
import { supabase } from './supabase'
import { fetchIsAdmin, fetchIsManager, friendlyError as licenceFriendlyError } from './licenceRegistryApi'
import { formToRpcArgs } from './paymentDues'

/** ข้อความผิดพลาดภาษาไทย — แนวเดียวกับเมนูทะเบียนใบอนุญาต แต่ข้อความสิทธิ์ชี้มาที่เมนูนี้ */
export function friendlyError(error) {
  if (!error) return ''
  const message = String(error.message ?? '')
  const isThai = /[฀-๿]/.test(message)
  if (error.code === '42501' && !isThai) return 'คุณไม่มีสิทธิ์ทำรายการนี้ (เมนูนี้สำหรับกองที่ถือเรื่องใบอนุญาต หรือกองคลังที่แอดมินเปิดสิทธิ์ไว้)'
  if (error.code === 'PGRST205' || error.code === '42P01') return 'ระบบยังไม่ได้ติดตั้งตารางรายการเงินเข้าในฐานข้อมูล — แจ้งผู้ดูแลระบบ'
  if (error.code === 'PGRST202' || error.code === '42883') return 'ระบบยังไม่ได้ติดตั้งฟังก์ชันของเมนูนี้ในฐานข้อมูล — แจ้งผู้ดูแลระบบ'
  return licenceFriendlyError(error)
}

const boolResult = ({ data, error }) => (error ? { value: false, error } : { value: data === true, error: null })

// ── สิทธิ์ ───────────────────────────────────────────────────────────────────────────
/** ผู้ดูแลยอดค้าง (ผู้จัดการทะเบียนใบอนุญาต หรือกองคลังที่เปิดตัวเลือก) */
export const fetchCanHandle = async municipalityId => boolResult(await supabase.rpc('payment_can_handle', { p_municipality_id: municipalityId }))
/** กองคลังที่ อปท. เปิดตัวเลือกให้บันทึกเลขใบเสร็จ (ไม่เห็นที่อยู่ ยกเลิกยอดไม่ได้) */
export const fetchIsFinance = async municipalityId => boolResult(await supabase.rpc('payment_is_finance', { p_municipality_id: municipalityId }))
/** ผู้จัดการทะเบียนใบอนุญาต = ยกเลิกยอดได้ · ใช้ฟังก์ชันของทะเบียนตรงๆ */
export const fetchIsRegistryManager = fetchIsManager
/** แอดมิน = ตั้งค่ารับเงินได้ */
export const fetchIsPaymentAdmin = fetchIsAdmin

// ── ค่าตั้ง ───────────────────────────────────────────────────────────────────────────
const SETTINGS_COLS = 'municipality_id, counter_enabled, promptpay_enabled, bill_payment_enabled, promptpay_id, biller_id, bank_name, payee_name, '
  + 'source_channels, elaas_invoice_sources, due_lead_days, finance_department_id, finance_can_record, account_changed_at, updated_at'

/** ไม่มีแถว = ยังไม่ได้ตั้งค่า (ไม่รับเงินทุกช่องทาง) — ไม่ใช่ error */
export async function fetchPaymentSettings(municipalityId) {
  const { data, error } = await supabase.from('payment_settings').select(SETTINGS_COLS)
    .eq('municipality_id', municipalityId).maybeSingle()
  return { settings: data ?? null, error }
}

/** บันทึกค่าตั้ง (แอดมินเท่านั้น — ฐานลงประวัติ + ประทับการเปลี่ยนบัญชีให้เอง) */
export async function savePaymentSettings(municipalityId, form) {
  const { data, error } = await supabase.rpc('payment_save_settings', formToRpcArgs(municipalityId, form))
  return { settings: data ?? null, error }
}

// ── ยอดค้าง ───────────────────────────────────────────────────────────────────────────

/** ให้ระบบปรับยอดค้างตามกฎ (สร้าง/ปิด/ปรับอัตรา) — เรียกเองตอนเปิดเมนู · รันซ้ำได้ ไม่สร้างซ้ำ */
export async function syncLicenceDues(municipalityId) {
  const { data, error } = await supabase.rpc('payment_sync_licence_dues', { p_municipality_id: municipalityId })
  return { result: data ?? null, error }
}

/**
 * รายการยอด status = open|paid|lapsed|cancelled|closed|all
 * ฐานคืน { rows, total, truncated, limit } — เพดาน 2,000 แถว (รอชำระเรียงตามวันครบกำหนด · ที่ปิดแล้วใหม่สุดก่อน)
 * truncated = มีมากกว่าที่ส่งมา หน้าจอต้องบอก ห้ามตัดเงียบ (NOTES ข้อ 14)
 */
export async function listDues(municipalityId, status = 'all') {
  const { data, error } = await supabase.rpc('payment_list_dues', { p_municipality_id: municipalityId, p_status: status })
  return {
    dues: Array.isArray(data?.rows) ? data.rows : [],
    total: Number(data?.total ?? 0),
    truncated: data?.truncated === true,
    error,
  }
}

/** บันทึกเลขใบเสร็จของยอด → ฐานขยายวันของใบให้เองผ่าน licence_record_fee (ด่านเดิมทุกข้อ) */
export async function recordReceipt({ dueId, paidOn, amount, receiptNo, channel, surcharge, noMaterialChange }) {
  const { data, error } = await supabase.rpc('payment_record_receipt', {
    p_due_id: dueId,
    p_paid_on: paidOn,
    p_amount: Number(amount),
    p_receipt_no: String(receiptNo ?? '').trim(),
    p_channel: channel,
    p_surcharge: Number(surcharge) || 0,
    p_no_material_change: Boolean(noMaterialChange),
  })
  return { result: data ?? null, error }
}

/** ยกเลิกยอด (ผู้จัดการทะเบียนเท่านั้น ต้องมีเหตุผล) */
export async function cancelDue(dueId, reason) {
  const { error } = await supabase.rpc('payment_cancel_due', { p_due_id: dueId, p_reason: String(reason ?? '').trim() })
  return { error }
}

// ── เงินเข้าจากธนาคาร (ขั้น 1C / E4 PR2) ───────────────────────────────────────────────
// ฐานข้อมูล: supabase/migrations/20261212100000_payment_bank_match_tables.sql + 20261212100100_payment_bank_match_rpc.sql
// ⚠️ ไม่ส่งชื่อ/เลขบัญชีผู้โอนขึ้นฐาน (เจ้าของระบบตัดสิน) — แถวที่ส่งมีแค่ { txn_at, amount, ref1, ref2, bank_ref } (paymentBankImport.js)
// ⚠️ ตารางพวกนี้มาจาก migration ที่อาจยังไม่ได้รันที่ อปท. นั้น — ผู้เรียกต้องไม่ให้ error ตรงนี้ลากแท็บเดิมของเมนูพังตาม

/** สถานะรายการเงินเข้า (ค่าตรงกับ CHECK ของฐาน) */
export const BANK_STATUSES = Object.freeze(['unmatched', 'matched', 'receipted', 'not_ours'])

/** บันทึกการจับคู่คอลัมน์ของไฟล์ธนาคาร (ครั้งเดียวต่อ อปท. ต่อชนิดไฟล์) → mapping ทั้งก้อนของ อปท. */
export async function saveBankMapping(municipalityId, fileKind, mapping) {
  const { data, error } = await supabase.rpc('payment_save_bank_mapping', { p_municipality_id: municipalityId, p_file_kind: fileKind, p_mapping: mapping })
  return { mapping: data ?? null, error }
}

/**
 * นำเข้าแถวเงินเข้า (≤ 5,000 แถว/ครั้ง · แถวผิดแถวเดียว = ฐานปฏิเสธทั้งชุดพร้อม "แถวที่ N")
 * → { result: { import_id, rows, inserted, duplicates, auto_matched, unmatched }, error }
 */
export async function importBankRows(municipalityId, fileKind, fileName, rows) {
  const { data, error } = await supabase.rpc('payment_import_bank_rows', {
    p_municipality_id: municipalityId, p_file_kind: fileKind, p_file_name: fileName, p_rows: rows,
  })
  return { result: data ?? null, error }
}

/**
 * รายการเงินเข้า status = unmatched|matched|receipted|not_ours|all
 * ฐานคืน { rows, total, truncated, limit } (เพดาน 2,000 แถว ใหม่สุดก่อน) · truncated = มีมากกว่าที่ส่งมา หน้าจอต้องบอก ห้ามตัดเงียบ
 * แถวมี due{...} (ที่ผูกอยู่) · candidates[] + suggested_due_id (เฉพาะ unmatched) · hint (เหตุที่ Ref1 ไม่ถูกจับคู่เอง)
 */
export async function listBankTxns(municipalityId, status = 'unmatched') {
  const { data, error } = await supabase.rpc('payment_list_bank_txns', { p_municipality_id: municipalityId, p_status: status })
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    total: Number(data?.total ?? 0),
    truncated: data?.truncated === true,
    limit: Number(data?.limit ?? 0),
    error,
  }
}

/** คนยืนยันคู่ (เงินเข้า ↔ ยอดค้าง) → { result: { txn_id, due_id, paid_on, amount, channel } } · ยอดยังรอชำระจนกรอกเลขใบเสร็จ */
export async function matchBankTxn(txnId, dueId) {
  const { data, error } = await supabase.rpc('payment_match_bank_txn', { p_txn_id: txnId, p_due_id: dueId })
  return { result: data ?? null, error }
}

/** ยกเลิกคู่ / ถอนการระบุว่าไม่ใช่เงินของระบบนี้ (matched / not_ours → unmatched) ต้องมีเหตุผล 3–1000 ตัวอักษร */
export async function resetBankTxn(txnId, reason) {
  const { error } = await supabase.rpc('payment_reset_bank_txn', { p_txn_id: txnId, p_reason: String(reason ?? '').trim() })
  return { error }
}

/** ระบุว่าเงินเข้ารายการนี้ไม่ใช่เงินของบริการในระบบนี้ (เช่น รายได้อื่น) ต้องมีเหตุผล — ไม่ใช่การยกหนี้ */
export async function markBankTxnNotOurs(txnId, reason) {
  const { error } = await supabase.rpc('payment_mark_bank_txn_not_ours', { p_txn_id: txnId, p_reason: String(reason ?? '').trim() })
  return { error }
}

/**
 * การแจ้งผู้บริหารเมื่อบัญชีรับเงินเปลี่ยน — แถวล่าสุดของคิว (1 แถวต่อเหตุการณ์ account_change) ผู้ดูแลยอดอ่านได้ตาม RLS
 * ไม่มี chat id ในตาราง (มีแค่สถานะ + สรุปผลส่ง) · ตารางยังไม่มี/อ่านไม่ได้ = alert null (ไม่ใช่ error ที่ต้องโชว์ — แค่ไม่มีบรรทัดสถานะ)
 */
export async function fetchLatestAccountAlert(municipalityId) {
  const { data, error } = await supabase.from('payment_account_alerts')
    .select('event_id, status, attempts, delivery_note, sent_at, created_at')
    .eq('municipality_id', municipalityId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { alert: error ? null : (data ?? null), error }
}

/**
 * การจับคู่คอลัมน์ไฟล์ธนาคารที่บันทึกไว้ { bill_payment?: {...}, account?: {...} } — อ่านแยกจาก fetchPaymentSettings (ไม่เพิ่มคอลัมน์ใน SETTINGS_COLS)
 * เพราะคอลัมน์นี้มากับ migration ของ PR2 — ฐานที่ยังไม่รัน select คอลัมน์นี้ไม่ได้ ห้ามลากค่าตั้งเดิมของเมนูพังตาม · อ่านไม่ได้ = {} (ให้ระบบเดาจากหัวตาราง)
 */
export async function fetchBankMapping(municipalityId) {
  const { data, error } = await supabase.from('payment_settings').select('bank_file_mapping').eq('municipality_id', municipalityId).maybeSingle()
  const value = data?.bank_file_mapping
  return { mapping: !error && value && typeof value === 'object' && !Array.isArray(value) ? value : {}, error }
}
