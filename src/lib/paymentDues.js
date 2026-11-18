// รับชำระเงิน · ยอดค้าง (ขั้น 1C / E4 PR1) — ฟังก์ชันบริสุทธิ์ของหน้าจอ (ไม่ import supabase/React เทสต์ด้วย node ได้)
// ฐานข้อมูล: supabase/migrations/20261211100000_payment_dues_tables.sql + 20261211100100_payment_dues_rls_rpc.sql
//
// หลักของโมดูลนี้: ระบบสร้างยอด/คำนวณ/ปิดยอดตามกฎ ส่วน "ใบเสร็จรับเงิน" ออกโดยหน่วยงานคลัง/e-LAAS เท่านั้น
//   ระบบเก็บแค่เลขที่ใบเสร็จที่เจ้าหน้าที่กรอก · ไม่ยกเว้น/ลดยอดเอง · ค่าปรับเป็นยอดที่ "เสนอ" ให้เจ้าหน้าที่ยืนยันหรือแก้
// สูตรค่าปรับ/ชำระช้ายืมจาก licenceRegistry.js (suggestSurcharge / isLateAnnual) ห้ามเขียนซ้ำที่นี่

import { addDays, daysBetween, isLateAnnual, previewFeeResult, remainingText, suggestSurcharge, todayBangkok } from './licenceRegistry.js'
import { generateBillPaymentPayload, generatePromptPayPayload } from './promptpay.js'

export const PAYMENT_MODULE_KEY = 'payment-dues'

/** ช่องทางรับชำระ (ค่าตรงกับ CHECK ของฐาน) · other = ใช้เฉพาะตอนบันทึกเลขใบเสร็จ ไม่ใช่ช่องที่ อปท. เปิดให้ผู้ชำระ */
export const CHANNEL_LABEL = Object.freeze({
  counter: 'ชำระที่ อปท. (เคาน์เตอร์)',
  promptpay: 'QR พร้อมเพย์',
  bill_payment: 'QR Bill Payment (ข้ามธนาคาร)',
  other: 'อื่นๆ',
})
/** ลำดับช่องทางที่ อปท. เปิดได้ (ค่าเริ่มต้นปิดทุกช่อง) */
export const CHANNEL_IDS = Object.freeze(['counter', 'promptpay', 'bill_payment'])
export const channelLabel = value => CHANNEL_LABEL[value] ?? '—'

export const SOURCE_LABEL = Object.freeze({ licence: 'ค่าธรรมเนียมใบอนุญาต' })
export const KIND_LABEL = Object.freeze({ renewal: 'ต่ออายุ', annual: 'รายปี' })
export const kindLabel = kind => KIND_LABEL[kind] ?? '—'

/** เลขที่ยอดของบริการนำร่อง = ใบอนุญาตเท่านั้น (ฐานจำกัดไว้ที่ 'licence') */
export const PAYMENT_SOURCES = Object.freeze(['licence'])

export const ACCOUNT_BANNER_DAYS = 30

// ── ช่องทาง ───────────────────────────────────────────────────────────────────────────

/** ช่องทางที่ อปท. เปิดอยู่ (ตามค่าตั้ง) — ไม่มีค่าตั้ง = ไม่มีช่องไหนเปิด */
export function enabledChannels(settings) {
  if (!settings) return []
  return CHANNEL_IDS.filter(id => settings[`${id}_enabled`] === true)
}

/** บริการนี้ใช้ช่องไหนได้จริง = ช่องที่ตั้งให้บริการนี้ ∩ ช่องที่เปิดอยู่ */
export function usableChannels(settings, source) {
  if (!settings) return []
  const mapped = settings.source_channels?.[source]
  if (!Array.isArray(mapped)) return []
  const on = new Set(enabledChannels(settings))
  return CHANNEL_IDS.filter(id => mapped.includes(id) && on.has(id))
}

/** บริการนี้ e-LAAS ออกใบแจ้งหนี้ให้อยู่แล้วหรือไม่ — ใช่ = ระบบไม่สร้าง QR ซ้ำ แต่ยังติดตามยอดค้างให้ */
export const isElaasInvoice = (settings, source) => Array.isArray(settings?.elaas_invoice_sources) && settings.elaas_invoice_sources.includes(source)

/**
 * ช่องทางที่ใช้สร้าง QR บนใบแจ้งชำระ: Bill Payment ก่อน ไม่มีก็พร้อมเพย์ · ไม่มี = null
 * ไม่มี QR เมื่อ e-LAAS ออกใบแจ้งหนี้อยู่แล้ว / ช่องไม่เปิด / ยังไม่ได้ใส่รหัสปลายทาง (ไม่เดารหัส)
 */
export function qrChannelFor(settings, source) {
  if (!settings || isElaasInvoice(settings, source)) return null
  const usable = usableChannels(settings, source)
  if (usable.includes('bill_payment') && settings.biller_id) return 'bill_payment'
  if (usable.includes('promptpay') && settings.promptpay_id) return 'promptpay'
  return null
}

/**
 * ตัวเลือกช่องทางบนแผ่นบันทึกเลขใบเสร็จ: ช่องที่ อปท. เปิดให้บริการนี้ + "อื่นๆ"
 * ยังไม่มีช่องใดเปิด → เคาน์เตอร์ (ยังบันทึกเลขใบเสร็จแบบเคาน์เตอร์ได้) + อื่นๆ
 */
export function recordChannelOptions(settings, source) {
  const usable = usableChannels(settings, source)
  return [...(usable.length ? usable : ['counter']), 'other']
}

/** ช่องทางที่เลือกไว้ก่อน: ช่องแรกของรายการ (ไม่ใช่ "อื่นๆ") */
export const defaultRecordChannel = (settings, source) => recordChannelOptions(settings, source)[0]

/** ยังไม่มีค่าตั้งหรือไม่มีช่องทางไหนเปิด — หน้าจอแสดงป้ายบอกแอดมินไปตั้งค่า */
export const needsSettingsNotice = settings => enabledChannels(settings).length === 0

// ── สถานะวันครบกำหนด ──────────────────────────────────────────────────────────────────

/** { days, overdue, text } ของยอดที่รอชำระ · ยอดที่ปิดแล้ว/วันที่ผิดรูป → days null */
export function dueState(due, today) {
  if (!due || due.status !== 'open') return { days: null, overdue: false, text: '' }
  const days = daysBetween(today, due.due_on)
  return { days, overdue: days !== null && days < 0, text: remainingText(days) }
}

// ── ค่าปรับที่เสนอ + ยอด QR ──────────────────────────────────────────────────────────

/** ค่าปรับที่เสนอ (ร้อยละ 20) เฉพาะยอดรายปีที่ชำระหลังวันครบกำหนด — เจ้าหน้าที่ยืนยันหรือแก้ได้ ระบบไม่ตัดสิน */
export function suggestedSurcharge(due, paidOn) {
  if (!due || due.kind !== 'annual') return 0
  return isLateAnnual(paidOn, due.due_on) ? suggestSurcharge(due.amount) : 0
}

/** ยอดที่ผู้ชำระต้องจ่าย ณ วันนั้น = ยอด + ค่าปรับที่เสนอ (ปัดสตางค์) */
export function amountDue(due, paidOn) {
  const surcharge = suggestedSurcharge(due, paidOn)
  return { amount: Number(due?.amount) || 0, surcharge, total: Math.round(((Number(due?.amount) || 0) + surcharge) * 100) / 100 }
}

/**
 * สร้าง QR ของยอดนี้ตามช่องทางที่เปิด → { channel, payload, total, surcharge } หรือ null (ไม่มี QR)
 * ⚠️ Bill Payment: รูปแบบตามเอกสารธนาคาร ต้องลองสแกนกับธนาคารของ อปท. ก่อนเปิดใช้จริง (ดู promptpay.js)
 */
export function buildDueQr(settings, due, today) {
  if (!settings || !due) return null
  const channel = qrChannelFor(settings, due.source)
  if (!channel) return null
  const { total, surcharge } = amountDue(due, today)
  if (!(total > 0)) return null
  const payload = channel === 'bill_payment'
    ? generateBillPaymentPayload({ billerId: settings.biller_id, ref1: due.ref1, amount: total })
    : generatePromptPayPayload(settings.promptpay_id, total)
  return payload ? { channel, payload, total, surcharge } : null
}

// ── Ref1 ──────────────────────────────────────────────────────────────────────────────

/** หลักตรวจ Luhn ของเลขฐาน 10 (ตรงกับ payment_luhn_digit ของฐาน: นับจากขวา หลักขวาสุดของ "ตัวเลขก่อนหลักตรวจ" คูณ 2) */
export function luhnCheckDigit(digits) {
  const text = String(digits ?? '')
  if (!/^\d+$/.test(text)) return null
  let sum = 0
  for (let i = 0; i < text.length; i += 1) {
    const d = Number(text[text.length - 1 - i])
    sum += i % 2 === 0 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d
  }
  return String((10 - (sum % 10)) % 10)
}

/** Ref1 ถูกรูป: 12 หลัก และหลักสุดท้ายคือหลักตรวจ Luhn ของ 11 หลักแรก */
export function isValidRef1(ref1) {
  const text = String(ref1 ?? '')
  return /^\d{12}$/.test(text) && luhnCheckDigit(text.slice(0, 11)) === text[11]
}

/** แบ่งกลุ่มอ่านง่าย 1234 5678 9012 (ไม่ใช่ 12 หลักไม่แตะ) */
export const formatRef1 = ref1 => (/^\d{12}$/.test(String(ref1 ?? '')) ? String(ref1).replace(/(\d{4})(?=\d)/g, '$1 ') : String(ref1 ?? ''))

// ── ค้นหา ─────────────────────────────────────────────────────────────────────────────

const text = value => String(value ?? '').toLocaleLowerCase('th-TH')

/**
 * ค้นชื่อร้าน/ผู้ประกอบการ/เลขใบ/Ref1 → { rows, ref1Typo }
 * ref1Typo = คำค้นเป็นเลข 12 หลักที่หลักตรวจ Luhn ไม่ผ่าน (พิมพ์ผิดแน่ๆ) — ยังค้นต่อให้ แต่บอกเจ้าหน้าที่
 */
export function searchDues(rows, query) {
  const raw = String(query ?? '').trim()
  if (!raw) return { rows, ref1Typo: false }
  const q = text(raw)
  const digits = raw.replace(/[\s-]/g, '')
  const ref1Typo = /^\d{12}$/.test(digits) && !isValidRef1(digits)
  const found = rows.filter(row => text(row.business_name).includes(q) || text(row.holder_name).includes(q)
    || text(row.licence_no).includes(q) || String(row.ref1 ?? '').includes(digits || raw))
  return { rows: found, ref1Typo }
}

/** แท็บ → สถานะที่ขอจากฐาน: รอชำระ=open · ชำระแล้ว=paid · ปิดแล้ว=lapsed+cancelled (ขอ 'all' แล้วกรองหน้าจอ) */
export const TAB_STATUSES = Object.freeze({ open: ['open'], paid: ['paid'], closed: ['lapsed', 'cancelled'] })
export const filterByTab = (rows, tab) => rows.filter(row => (TAB_STATUSES[tab] ?? []).includes(row.status))

/** ข้อความสถานะของยอดที่ปิดแล้ว */
export const CLOSED_LABEL = Object.freeze({ lapsed: 'หมดสิทธิ์ต่ออายุ', cancelled: 'ยกเลิกยอด' })

// ── ผลการปรับยอดอัตโนมัติ ─────────────────────────────────────────────────────────────

/** ข้อความสรุปสั้นๆ หลังระบบปรับยอด — ไม่มีอะไรเปลี่ยน = [] (ไม่แสดงอะไร ไม่รบกวน) */
export function describeSync(result) {
  if (!result) return []
  const lines = []
  if (result.created > 0) lines.push(`ระบบสร้างยอดค้างใหม่ ${result.created} รายการ (ใบที่ใกล้ครบกำหนดภายใน ${result.lead_days ?? '—'} วัน)`)
  if (result.paid > 0) lines.push(`ปิดยอดที่มีรายการรับเงินในทะเบียนแล้ว ${result.paid} รายการ`)
  if (result.lapsed > 0) lines.push(`ยอดที่ชำระไม่ได้แล้วตามกฎ ${result.lapsed} รายการ (ดูเหตุผลที่แท็บ "ปิดแล้ว")`)
  if (result.updated > 0) lines.push(`ปรับยอดตามอัตราค่าธรรมเนียมใหม่ ${result.updated} รายการ — ใบแจ้งชำระที่พิมพ์ไปแล้วให้พิมพ์ใหม่`)
  return lines
}

/** ป้ายเตือนใบที่ยังไม่ได้ตั้งอัตราค่าธรรมเนียม (ระบบข้ามไม่สร้างยอด) — ไม่มี = '' */
export function describeSkipped(result) {
  const n = Number(result?.skipped_no_fee) || 0
  return n > 0 ? `มี ${n} ใบที่ยังไม่ได้ตั้งอัตราค่าธรรมเนียม — ตั้งที่เมนูทะเบียนใบอนุญาต` : ''
}

// ── ป้ายเตือนเปลี่ยนบัญชีรับเงิน ──────────────────────────────────────────────────────

const bangkokDateOf = value => {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : todayBangkok(d)
}

/** บัญชีรับเงินถูกเปลี่ยนภายใน 30 วัน → { date (ISO), days } · ไม่เข้าเงื่อนไข = null */
export function accountChangeBanner(settings, today) {
  if (!settings?.account_changed_at) return null
  const date = bangkokDateOf(settings.account_changed_at)
  if (!date) return null
  const days = daysBetween(date, today)
  return days !== null && days >= 0 && days <= ACCOUNT_BANNER_DAYS ? { date, days } : null
}

// ── ฟอร์มตั้งค่า ──────────────────────────────────────────────────────────────────────

const cleanId = value => String(value ?? '').replace(/[\s-]/g, '')
// พร้อมเพย์ของ อปท. = เลขประจำตัวผู้เสียภาษีของหน่วยงาน (ขึ้นต้น 0) เท่านั้น — เบอร์มือถือ/เลขบัตรประชาชนเป็นของบุคคล (ตรงกับฐาน)
const PROMPTPAY_RE = /^0[0-9]{12}$/
const BILLER_RE = /^[0-9]{15}$/

/** ค่าตั้งจากฐาน (หรือ null) → ค่าในฟอร์ม · ไม่มีแถว = ปิดทุกช่อง (ค่าเริ่มต้นปลอดภัย) */
export function settingsToForm(settings) {
  const mapped = Array.isArray(settings?.source_channels?.licence) ? settings.source_channels.licence : []
  return {
    counter: settings?.counter_enabled === true,
    promptpay: settings?.promptpay_enabled === true,
    billPayment: settings?.bill_payment_enabled === true,
    promptpayId: settings?.promptpay_id ?? '',
    billerId: settings?.biller_id ?? '',
    bankName: settings?.bank_name ?? '',
    payeeName: settings?.payee_name ?? '',
    licenceChannels: CHANNEL_IDS.filter(id => mapped.includes(id)),
    elaasLicence: isElaasInvoice(settings, 'licence'),
    leadDays: String(settings?.due_lead_days ?? 60),
    financeCanRecord: settings?.finance_can_record === true,
    financeDepartmentId: settings?.finance_department_id ?? '',
  }
}

/** ตรวจฟอร์มก่อนส่ง (ตัวบังคับจริงคือฐาน) → ข้อความไทยของข้อผิดพลาดแรก หรือ '' */
export function validateSettingsForm(form) {
  const promptpayId = cleanId(form.promptpayId)
  const billerId = cleanId(form.billerId)
  if (promptpayId && !PROMPTPAY_RE.test(promptpayId)) return 'พร้อมเพย์ของ อปท. ต้องเป็นเลขประจำตัวผู้เสียภาษีของหน่วยงาน 13 หลัก (ขึ้นต้นด้วย 0) — ใช้เบอร์มือถือหรือเลขบัตรประชาชนไม่ได้'
  if (billerId && !BILLER_RE.test(billerId)) return 'รหัสผู้รับชำระ (Biller ID) ต้องเป็นเลข 15 หลัก'
  if (form.promptpay && !promptpayId) return 'เปิด QR พร้อมเพย์ต้องใส่เลขพร้อมเพย์ของ อปท.'
  if (form.billPayment && !billerId) return 'เปิด QR Bill Payment ต้องใส่รหัสผู้รับชำระ (Biller ID)'
  if ((form.promptpay || form.billPayment) && !String(form.payeeName ?? '').trim()) {
    return 'ใส่ชื่อบัญชีผู้รับ — พิมพ์บนใบแจ้งชำระให้ผู้ชำระตรวจกับชื่อที่แอปธนาคารแสดงก่อนกดจ่าย'
  }
  const lead = Number(form.leadDays)
  if (String(form.leadDays).trim() === '' || !Number.isInteger(lead) || lead < 1 || lead > 180) return 'สร้างยอดล่วงหน้าได้ 1–180 วัน'
  if (form.financeCanRecord && !form.financeDepartmentId) return 'เลือกกองคลังที่จะให้บันทึกเลขใบเสร็จได้'
  return ''
}

/** ฟอร์ม → พารามิเตอร์ของ payment_save_settings (13 ตัว) */
export function formToRpcArgs(municipalityId, form) {
  return {
    p_municipality_id: municipalityId,
    p_counter_enabled: Boolean(form.counter),
    p_promptpay_enabled: Boolean(form.promptpay),
    p_bill_payment_enabled: Boolean(form.billPayment),
    p_promptpay_id: cleanId(form.promptpayId) || null,
    p_biller_id: cleanId(form.billerId) || null,
    p_bank_name: String(form.bankName ?? '').trim() || null,
    p_payee_name: String(form.payeeName ?? '').trim() || null,
    p_source_channels: { licence: CHANNEL_IDS.filter(id => form.licenceChannels?.includes(id)) },
    p_elaas_invoice_sources: form.elaasLicence ? ['licence'] : [],
    p_due_lead_days: Number(form.leadDays),
    p_finance_department_id: form.financeDepartmentId || null,
    p_finance_can_record: Boolean(form.financeCanRecord),
  }
}

/** บัญชีปลายทางในฟอร์มต่างจากที่บันทึกไว้หรือไม่ — ใช่ = ขึ้นกล่องยืนยันก่อนบันทึก (เปลี่ยนบัญชีคือจุดโกงที่ง่ายที่สุด) */
export function accountChanged(settings, form) {
  const norm = value => String(value ?? '').trim()
  const next = [cleanId(form.promptpayId), cleanId(form.billerId), norm(form.bankName), norm(form.payeeName)]
  if (!settings) return next.some(Boolean)
  const prev = [cleanId(settings.promptpay_id), cleanId(settings.biller_id), norm(settings.bank_name), norm(settings.payee_name)]
  return next.some((value, i) => value !== prev[i])
}

// ── ผลล่วงหน้าตอนบันทึกเลขใบเสร็จ ─────────────────────────────────────────────────────

/**
 * "ใบจะใช้ได้ถึง …" / "ครบกำหนดครั้งถัดไป …" คำนวณจากรอบของยอดเอง ด้วยสูตรเดียวกับแผ่นบันทึกรับค่าธรรมเนียมของทะเบียน (previewFeeResult)
 *   ต่ออายุ: วันหมดอายุเดิม = period_from − 1 วัน · ต้องรู้ validity_months ของประเภท → ส่ง type มา
 *            (ผู้จัดการทะเบียนเท่านั้นอ่านประเภทได้ · ไม่มี type = ไม่แสดงผลล่วงหน้า ไม่เดาอายุใบ)
 *   รายปี  : วันครบกำหนดเดิม = period_from → ครบกำหนดถัดไป +12 เดือน
 */
export function receiptPreview(due, type) {
  if (!due) return null
  if (due.kind === 'renewal') {
    if (!type) return null
    return previewFeeResult({ kind: 'renewal', licence: { expires_on: addDays(due.period_from, -1) }, type })
  }
  return previewFeeResult({ kind: 'annual', licence: { next_fee_due_on: due.period_from }, type })
}
