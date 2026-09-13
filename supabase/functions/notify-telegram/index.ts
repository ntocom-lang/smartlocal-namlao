// Supabase Edge Function: notify-telegram
// Deploy: supabase functions deploy notify-telegram
// Secret required: TELEGRAM_BOT_TOKEN

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, type TelegramSendResult } from '../_shared/telegram.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const notificationSpecs = {
  complaint_created: { table: 'complaints', resourceType: 'complaint', access: 'public_create' },
  complaint_status_updated: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  document_request_created: { table: 'document_requests', resourceType: 'document_request', access: 'public_create' },
  document_request_status_updated: { table: 'document_requests', resourceType: 'document_request', access: 'staff' },
  building_permit_created: { table: 'document_requests', resourceType: 'document_request', access: 'public_create' },
  event_created: { table: 'events', resourceType: 'event', access: 'event_create' },
  fee_verified: { table: 'document_requests', resourceType: 'document_request', access: 'staff' },
  technician_received: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  technician_in_progress: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  technician_closed: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  fleet_trip_bumped: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_fuel_created: { table: 'fleet_fuel_records', resourceType: 'fleet_fuel', access: 'staff' },
} as const

type NotificationType = keyof typeof notificationSpecs

type DeliveryRow = {
  id: string
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  attempt_count: number
  updated_at: string
  claim_token: string | null
}

type ClaimResult = {
  claimed: boolean
  duplicate?: boolean
  inProgress?: boolean
  delivery: DeliveryRow
  claimToken: string | null
}

const INTERNAL_ROLES = new Set([
  'superadmin', 'admin', 'officer', 'viewer', 'council', 'staff', 'technician', 'kamnan',
])

// ต้องตรงกับ AUDIENCE_LABEL ใน src/lib/orgTerms.js — คำเรียกสภาเปลี่ยนตาม municipalities.org_type
// ("สภาเทศบาล" / "สภา อบต." / "สภา อบจ.") ฝั่ง edge function ไม่มี TenantContext จึงต้องอ่าน
// org_type จาก DB เองแล้วส่งเข้ามาเป็นพารามิเตอร์
const COUNCIL_ORG_BY_TYPE: Record<string, string> = {
  'เทศบาลนคร': 'สภาเทศบาล',
  'เทศบาลเมือง': 'สภาเทศบาล',
  'เทศบาลตำบล': 'สภาเทศบาล',
  'เทศบาล': 'สภาเทศบาล',
  'อบต.': 'สภา อบต.',
  'อบจ.': 'สภา อบจ.',
}
const DEFAULT_COUNCIL_ORG = COUNCIL_ORG_BY_TYPE['อบต.']

function audienceLabels(orgType: unknown): Record<string, string> {
  return {
    public: 'ประชาชน',
    staff: 'เจ้าหน้าที่',
    management: 'ผู้บริหาร',
    council: COUNCIL_ORG_BY_TYPE[String(orgType ?? '')] ?? DEFAULT_COUNCIL_ORG,
  }
}

type Labelled = { emoji: string; label: string }

// ⚠️ นี่คือ **ค่าสำรอง** เท่านั้น — ชื่อกับอีโมจิตัวจริงอยู่ในตาราง complaint_categories ราย อปท.
// แต่ละ อปท. ตั้งเองไม่เหมือนกัน (น้ำเลา light = 💡 "ไฟฟ้าสาธารณะ" / ตำหนักธรรม light = ⚡)
// ของเดิม hardcode ค่าพวกนี้อย่างเดียวจึงขึ้นชื่อไม่ตรงกับเว็บมาตลอด เช่น น้ำเลาตั้งชื่อ road ว่า
// "ซ่อมแซมถนน" แต่ Telegram ขึ้น "ถนน/ทางสาธารณะ" — ตอนนี้อ่านจาก DB ก่อน แล้วค่อยตกมาที่นี่
// ใช้เมื่อคำร้องเก่าไม่มี category_id (ยังมีจริงในระบบ) ค่าตรงกับ CATEGORY_LABEL/CATEGORY_EMOJI
// ใน src/components/admin/ComplaintsManager.jsx
const COMPLAINT_CATEGORY_FALLBACK: Record<string, Labelled> = {
  road: { emoji: '🛣️', label: 'ถนน/ทางสาธารณะ' },
  light: { emoji: '💡', label: 'ไฟฟ้าสาธารณะ' },
  trash: { emoji: '🗑️', label: 'ขยะ/ความสะอาด' },
  water: { emoji: '🚰', label: 'น้ำประปา' },
  flood: { emoji: '🌊', label: 'น้ำท่วม/ระบายน้ำ' },
  tree: { emoji: '🌳', label: 'ต้นไม้/สวนสาธารณะ' },
  noise: { emoji: '📢', label: 'เหตุรำคาญ' },
  drain: { emoji: '🕳️', label: 'ท่อระบายน้ำ' },
  waste_water: { emoji: '💧', label: 'น้ำเสีย' },
  building: { emoji: '🏗️', label: 'ตรวจสอบอาคาร' },
  mosquito: { emoji: '🦟', label: 'พ่นยุง' },
  canal: { emoji: '🏞️', label: 'ลอกคลอง' },
  animals: { emoji: '🐕', label: 'สุนัขจรจัด' },
  water_supply: { emoji: '🚿', label: 'สนับสนุนน้ำอุปโภค' },
  borrow_equipment: { emoji: '📦', label: 'ยืมพัสดุ' },
  grievance: { emoji: '📣', label: 'ร้องทุกข์/ร้องเรียน' },
  corruption: { emoji: '⚖️', label: 'แจ้งการทุจริต' },
  tax: { emoji: '📋', label: 'ภาษีและค่าธรรมเนียม' },
  disease: { emoji: '🏥', label: 'ควบคุมโรคติดต่อ' },
  odor: { emoji: '💨', label: 'กลิ่นเหม็นรบกวน (มลพิษทางอากาศ)' },
  other: { emoji: '📝', label: 'อื่นๆ' },
}

// สีของแถบบน-ล่าง (ดู framedMessage()) แยกตาม "กองที่รับผิดชอบ" ให้เจ้าหน้าที่กวาดตาหางานของกองตัวเอง
// ⚠️ Telegram Bot API กำหนดสีตัวอักษร/พื้นหลังไม่ได้ อีโมจิสี่เหลี่ยมสีคือวิธีที่ให้ "สี" ได้จริง
// (custom emoji ในข้อความที่บอทส่งเข้ากลุ่มใช้ได้โดยไม่ต้อง Premium แต่ก็เป็นแค่อักขระหนึ่งตัว
// ไม่ใช่พื้นหลัง และต้องหา emoji-id จากชุดสติกเกอร์ภายนอกมาผูก ไม่คุ้มเมื่อเทียบกับอีโมจิมาตรฐาน)
//
// อ่านจาก departments.color (คีย์ที่แอดมินเลือกในหน้าจัดการกอง หรือ trigger เติมให้ตอนสร้างกอง)
// เดิมผูกกับ departments.code มาตรฐาน แต่ อปท. ที่สร้างกองเองได้ code เป็น dept_* ทุกกอง
// (ตำหนักธรรม/ทุ่งแค้ว) เลยได้ ⬜ เหมือนกันหมด ใช้แยกกองไม่ได้
// ⚠️ คีย์ต้องตรงกับ DEPARTMENT_COLORS ใน src/lib/departmentColors.js และ CHECK departments_color_check
// ⚠️ ห้าม deploy ไฟล์นี้ก่อน apply migration 20260913100000 — select คอลัมน์ color ที่ยังไม่มีทำให้
// query คำร้อง/คำขอพัง และการแจ้งเตือนทุกประเภทที่อิงสองตารางนี้หยุดส่งทั้งระบบ
const DEPARTMENT_COLOR_EMOJI: Record<string, string> = {
  red: '🟥',
  orange: '🟧',
  yellow: '🟨',
  green: '🟩',
  blue: '🟦',
  purple: '🟪',
  brown: '🟫',
  black: '⬛',
  white: '⬜',
}
const DEFAULT_DEPARTMENT_COLOR = '⬜'

// ต้องตรงกับ STATUS ใน src/components/admin/ComplaintsManager.jsx ทุกคำ
const COMPLAINT_STATUS_LABEL: Record<string, string> = {
  new: 'คำร้องใหม่', pending: 'คำร้องใหม่',
  received: 'รับเรื่องแล้ว',
  in_progress: 'กำลังดำเนินการ',
  done: 'ดำเนินการแล้ว', completed: 'ดำเนินการแล้ว',
  closed: 'ปิดเรื่องแล้ว',
  rejected: 'ปฏิเสธ',
}

// ต้องตรงกับ BASE_DOCUMENT_TYPES ใน src/lib/documentTypes.js ทุกคำ (รวมอีโมจินำหน้า) — edge
// function ไม่ได้ import โมดูลฝั่ง client จึงต้องคัดลอกมาไว้ที่นี่ เพิ่มประเภทใหม่ต้องแก้ 2 ที่
// residence_cert / personal_cert ถอดออกจากลิสต์ยื่นใหม่แล้ว แต่คำขอเก่ายังอยู่ในระบบและยัง
// เปลี่ยนสถานะได้ ถ้าไม่คงไว้ที่นี่ข้อความแจ้งเตือนจะขึ้นค่าดิบ 'personal_cert'
// เก็บอีโมจิแยกจากชื่อ เพราะอีโมจิถูกยกไปไว้หัวข้อความ ส่วนบรรทัด "เรื่อง:" แสดงชื่อล้วน
// ⚠️ ห้ามรวมเป็นสตริงเดียวแล้วมาตัดทีหลัง — อีโมจิหลายตัวเป็น grapheme หลาย code point
// (🏗️ = U+1F3D7 + VS16) slice/split ผิดแล้วจะได้อักขระพิการโผล่ในกลุ่ม
const DOCUMENT_TYPE: Record<string, Labelled> = {
  tax_notice: { emoji: '🏦', label: 'ค่าธรรมเนียม/ภาษี' },
  waste_collection: { emoji: '🗑️', label: 'ค่าธรรมเนียมขยะ' },
  waste_collection_request: { emoji: '🚛', label: 'ขอรับบริการเก็บขนขยะมูลฝอย' },
  waste_collection_cancel: { emoji: '🚫', label: 'ขอยกเลิกการเก็บขนขยะมูลฝอย' },
  water_supply_request: { emoji: '🚰', label: 'ขออนุญาตใช้น้ำประปา' },
  public_assistance_request: { emoji: '🤝', label: 'ขอรับการช่วยเหลือประชาชน' },
  asset_borrow_request: { emoji: '📦', label: 'ขอยืมพัสดุ/ครุภัณฑ์' },
  patient_transport_request: { emoji: '🚑', label: 'ขออนุเคราะห์รถรับ-ส่งผู้ป่วย' },
  building_permit: { emoji: '🏗️', label: 'ขออนุญาตก่อสร้างบ้าน' },
  residence_cert: { emoji: '📄', label: 'ใบรับรองการอยู่อาศัย' },
  personal_cert: { emoji: '📄', label: 'หนังสือรับรองบุคคล' },
}

// ต้องตรงกับ STATUS ใน src/pages/MyDocRequests.jsx — คนละชุดกับ COMPLAINT_STATUS_LABEL
// (คำขอเอกสารใช้ pending/processing/completed/rejected ส่วนคำร้องใช้ new/received/in_progress/...)
const DOCUMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'รอดำเนินการ',
  processing: 'กำลังดำเนินการ',
  completed: 'เสร็จสิ้น',
  rejected: 'ปฏิเสธ',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function escapeHtml(value: unknown, maxLength = 500) {
  return cleanText(value, maxLength)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatThaiDate(dateValue: unknown) {
  const value = cleanText(dateValue, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const date = new Date(`${value}T00:00:00+07:00`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok',
  })
}

// วัน+เวลาโซนไทย ใช้กับ timestamptz (created_at/updated_at) — ต่างจาก formatThaiDate()
// ที่รับเฉพาะ date 'YYYY-MM-DD' เพราะ event_date/filled_at เป็นชนิด date ไม่มีเวลา
function formatThaiDateTime(value: unknown) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return ''
  const text = date.toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
  })
  return `${text} น.`
}

// ❌ ห้ามใส่ลิงก์เข้าระบบท้ายข้อความ — เจ้าของระบบสั่งถอดออก 2569-09-12 หลังเห็นของจริง
// ในกลุ่ม (เคยมี `🔗 https://<slug>.rk-networks.com/staff`) ถ้าจะเพิ่มกลับต้องถามก่อน
// กองที่รับผิดชอบ มาจาก department_id ที่ trigger ตั้งให้ตอนสร้างคำขอ/คำร้อง
function departmentOf(resource: Record<string, unknown>) {
  return (resource.department ?? null) as { name?: string; color?: string } | null
}

function departmentName(resource: Record<string, unknown>) {
  return cleanText(departmentOf(resource)?.name, 80)
}

// คีย์ที่ไม่รู้จักหรือว่าง (กองเก่าก่อนมี trigger, รายการที่ยังไม่ผูกกอง) ได้ ⬜ ไม่ใช่ข้อความพัง
// ใช้ lookup ในแมปเท่านั้น ห้ามต่อค่าจาก DB เข้าข้อความตรงๆ แม้ CHECK จะกันไว้แล้วก็ตาม
function departmentColor(resource: Record<string, unknown>) {
  return DEPARTMENT_COLOR_EMOJI[String(departmentOf(resource)?.color ?? '')] ?? DEFAULT_DEPARTMENT_COLOR
}

// แถบสีเต็มบรรทัดเหนือหัวข้อ — เจ้าของระบบขอ "พื้นหลังสี" บนบรรทัดหัวข้อ (2569-09-13) แต่
// Telegram ทำไม่ได้: ตรวจกับ Bot API 10.3 แล้ว HTML รองรับเฉพาะ tag ในรายการ ไม่มีสีตัวอักษร/พื้นหลัง
// และ Rich Message block ทั้ง 27 แบบไม่มีฟิลด์สี ของที่มีพื้นหลังสีจริงมีแค่ปุ่ม (style 3 สี) ซึ่งไม่พอ
// กับ 6 กอง อยู่ใต้ข้อความ และต้องผูกลิงก์/callback — จึงเรียงสี่เหลี่ยมสีเต็มบรรทัดแทนให้ดูเป็นแถบ
// ⚠️ 10 ช่องคือความกว้างที่ไม่ตัดบรรทัดบนจอมือถือแคบ (~360px) เพิ่มจำนวนแล้วแถบจะหักเป็น 2 บรรทัด
// ⚠️ พรีวิว push notification ยุบขึ้นบรรทัดเป็นช่องว่าง แถบนี้จึงกินที่ต้นพรีวิวไป 10 ตัวอักษร
// เจ้าของระบบขอ "กรอบสีรอบข้อความ" ต่อ (2569-09-13) — ทำไม่ได้ด้วยเหตุผลเดียวกัน จึงปิดท้ายด้วย
// แถบสีเดียวกันอีกเส้นให้ข้อความถูกประกบบน-ล่าง แยกใบชัดเวลาเรียงติดกันในกลุ่ม
// ไม่ทำขอบซ้าย (สี่เหลี่ยมนำหน้าทุกบรรทัด) เพราะบรรทัดยาวที่ตัดลงบรรทัดใหม่บนมือถือจะไม่มีสี่เหลี่ยม
// ขอบจึงขาดเป็นช่วง ส่วนขอบขวาทำไม่ได้เลยเพราะแต่ละบรรทัดยาวไม่เท่ากัน
const COLOR_BAND_WIDTH = 10

// ❌ ห้ามใส่แฮชแท็กชื่อกองภาษาไทย — เคยใส่ (#161) แล้วเห็นของจริงในกลุ่มว่า Telegram ตัดแท็กทันที
// ที่เจอสระบน/ล่างหรือวรรณยุกต์ "#สำนักปลัด" เหลือ "#สำน" ตามด้วย "ักปลัด" เป็นข้อความธรรมดา
// (ฝั่งเรากรองอักขระถูกแล้ว แต่ตัวแยกแท็กของ Telegram ไม่นับ combining mark ไทย แก้ฝั่งเราไม่ได้)
// ชื่อย่อก็ใช้แทนไม่ได้: บาง อปท. ตั้งชื่อย่อเป็น "ช่าง"/"ศึกษา" ซึ่งมีสระ และบางกองไม่มีชื่อย่อ
// ส่วน "อ้างอิง: #a1b2c3d4" ยังเป็นแท็กได้ปกติเพราะเป็นอักษรอังกฤษกับตัวเลขล้วน

// ประกอบข้อความทั้งใบ: แถบสีกอง / <อีโมจิ> <หัวเรื่อง> / เนื้อหา / แถบสีกอง
// บรรทัดเนื้อหาที่เป็นค่าว่างถูกตัดทิ้ง ไม่เหลือหัวข้อค้างหรือบรรทัดเปล่า
function framedMessage(resource: Record<string, unknown>, emoji: string, title: string, body: string[]) {
  const band = departmentColor(resource).repeat(COLOR_BAND_WIDTH)
  return [band, `${emoji} <b>${title}</b>`, ...body.filter(Boolean), band].join('\n')
}

// ชื่อ+อีโมจิหมวดคำร้อง: ใช้ค่าจากตาราง complaint_categories ของ อปท. นั้นก่อนเสมอ
// (embed มาทาง category_id) คำร้องเก่าที่ category_id ยังว่างค่อยตกมาที่แมปสำรอง
function complaintCategory(complaint: Record<string, unknown>): Labelled {
  const fromDb = complaint.category_ref as { label?: string; emoji?: string } | null
  const label = cleanText(fromDb?.label, 60)
  if (label) return { emoji: cleanText(fromDb?.emoji, 8) || '📝', label }
  const fallback = COMPLAINT_CATEGORY_FALLBACK[String(complaint.category ?? '')]
  if (fallback) return fallback
  return { emoji: '📝', label: cleanText(complaint.category, 60) || 'อื่นๆ' }
}

// ประเภทที่ อปท. เพิ่มเองผ่านแท็บ "ประเภทคำขอเอกสาร" เก็บใน municipalities.fee_schedule._custom_types
// (ดู customDocumentTypes() ใน src/lib/documentTypes.js) ไม่ได้อยู่ใน DOCUMENT_TYPE
function documentType(value: unknown, feeSchedule: unknown): Labelled {
  const key = String(value ?? '')
  if (DOCUMENT_TYPE[key]) return DOCUMENT_TYPE[key]
  const customTypes = (feeSchedule as { _custom_types?: unknown } | null)?._custom_types
  if (Array.isArray(customTypes)) {
    const hit = customTypes.find((t) => String((t as Record<string, unknown>)?.value ?? '') === key) as
      Record<string, unknown> | undefined
    if (hit) return { emoji: cleanText(hit.emoji, 8) || '📋', label: cleanText(hit.label, 80) || key }
  }
  return { emoji: '📋', label: cleanText(key, 60) || 'ไม่ระบุประเภท' }
}

// ชื่อเต็มพร้อมอีโมจินำหน้า เทียบเท่า BASE_DOCUMENT_TYPES.label ฝั่ง client — เทสต์ใช้ตัวนี้
// เทียบกันทีละประเภทกันชื่อเพี้ยน ตัวข้อความจริงเรียก documentType() แล้วแยกอีโมจิไปไว้หัวข้อ
function documentTypeLabel(value: unknown, feeSchedule: unknown) {
  const { emoji, label } = documentType(value, feeSchedule)
  return `${emoji} ${label}`
}

// document_requests ไม่มีเลขที่คำขอแบบ complaints.ref_no — ใช้ 8 ตัวแรกของ uuid ให้เจ้าหน้าที่
// จับคู่กับรายการในระบบได้ พอสำหรับปริมาณคำขอระดับ อปท. (หลักพันใบ/ปี)
function shortRef(id: unknown) {
  return cleanText(id, 8)
}

function buildEventMessage(event: Record<string, unknown>, orgType: unknown) {
  const AUDIENCE_LABELS = audienceLabels(orgType)
  const audiences = Array.isArray(event.audiences)
    ? event.audiences.map((value) => AUDIENCE_LABELS[String(value)] ?? cleanText(value, 40)).filter(Boolean)
    : []
  const date = formatThaiDate(event.event_date)
  const startTime = cleanText(event.event_time, 5)
  const endTime = cleanText(event.end_time, 5)
  const time = event.is_all_day || !/^\d{2}:\d{2}$/.test(startTime)
    ? ''
    : `${startTime}${/^\d{2}:\d{2}$/.test(endTime) ? ` – ${endTime}` : ''} น.`

  return [
    `📅 <b>กิจกรรมใหม่</b>${audiences.length ? ` [${escapeHtml(audiences.join(', '), 160)}]` : ''}`,
    `<b>${escapeHtml(event.title, 300) || 'ไม่ระบุชื่อกิจกรรม'}</b>`,
    date ? `📆 ${escapeHtml(date, 120)}` : '',
    time ? `⏰ ${escapeHtml(time, 30)}` : '',
    event.location ? `📍 ${escapeHtml(event.location, 200)}` : '',
    event.description ? `📝 ${escapeHtml(event.description, 120)}` : '',
  ].filter(Boolean).join('\n').slice(0, 1800)
}

// ⚠️ PDPA — ข้อความที่ส่งเข้ากลุ่ม Telegram ออกไปอยู่บนเซิร์ฟเวอร์ของผู้ให้บริการภายนอก ลบย้อนหลัง
// ไม่ได้จริง และไม่ผ่านการควบคุมสิทธิ์ของระบบ จึงใส่ได้เฉพาะข้อมูลที่ระบุตัวบุคคลไม่ได้
// (ประเภทเรื่อง/กอง/วันเวลา/เลขอ้างอิง) ห้ามใส่ reporter_name, phone, requester_* หรือรายละเอียด
// ที่ประชาชนพิมพ์มา — ให้กดลิงก์เข้าไปดูในระบบตามสิทธิ์แทน
// complaints.village เป็นช่องสถานที่เกิดเหตุที่ประชาชนกรอกเอง เจ้าของระบบตัดสินใจให้ใส่
// 2569-09-12 เพราะเจ้าหน้าที่ต้องรู้ว่าเรื่องอยู่ตรงไหนก่อนจะตัดสินใจว่าใครออกพื้นที่
// รูปแบบของทุกใบ (ดู framedMessage()): แถบสีกอง / <อีโมจิประเภทเรื่อง> <หัวเรื่อง> / เนื้อหา / แถบสีกอง
// อีโมจิประเภทอยู่หัวข้อความอย่างเดียว บรรทัด "ประเภท:/เรื่อง:" จึงแสดงชื่อล้วน ไม่ใส่ซ้ำ
// ข้อยกเว้นเดียวคือ fee_verified ที่ใช้ 💰 เพราะสาระของใบนั้นคือเงิน ไม่ใช่ชนิดเอกสาร
function buildComplaintCreatedMessage(complaint: Record<string, unknown>) {
  const category = complaintCategory(complaint)
  const department = departmentName(complaint)
  const submittedAt = formatThaiDateTime(complaint.created_at)
  return framedMessage(complaint, category.emoji, 'มีคำร้องใหม่', [
    complaint.ref_no ? `เลขที่: ${escapeHtml(complaint.ref_no, 40)}` : '',
    `ประเภท: ${escapeHtml(category.label, 60)}`,
    complaint.village ? `สถานที่: ${escapeHtml(complaint.village, 120)}` : '',
    department ? `ส่งถึง: ${escapeHtml(department, 80)}` : '',
    submittedAt ? `แจ้งเมื่อ: ${escapeHtml(submittedAt, 60)}` : '',
  ])
}

function buildComplaintStatusMessage(complaint: Record<string, unknown>) {
  const category = complaintCategory(complaint)
  const status = COMPLAINT_STATUS_LABEL[String(complaint.status)] ?? cleanText(complaint.status, 60)
  const department = departmentName(complaint)
  const updatedAt = formatThaiDateTime(complaint.updated_at ?? complaint.created_at)
  return framedMessage(complaint, category.emoji, 'อัปเดตสถานะคำร้อง', [
    complaint.ref_no ? `เลขที่: ${escapeHtml(complaint.ref_no, 40)}` : '',
    `ประเภท: ${escapeHtml(category.label, 60)}`,
    complaint.village ? `สถานที่: ${escapeHtml(complaint.village, 120)}` : '',
    `สถานะ: <b>${escapeHtml(status, 60)}</b>`,
    department ? `ส่งถึง: ${escapeHtml(department, 80)}` : '',
    updatedAt ? `อัปเดตเมื่อ: ${escapeHtml(updatedAt, 60)}` : '',
  ])
}

// เดิมคำขอเอกสารทั้ง 4 ชนิดใช้ข้อความตายตัวบรรทัดเดียว ("มีคำขอเอกสารใหม่ / กรุณาเข้าสู่ระบบ...")
// เหมือนกันหมด ผู้ดูแลที่เห็นในกลุ่มแยกไม่ออกว่าใบไหนเรื่องอะไร ต้องไล่เปิดระบบทุกครั้ง
function buildDocumentRequestCreatedMessage(
  request: Record<string, unknown>,
  feeSchedule: unknown,
  headingText = 'มีคำขอเอกสารใหม่',
) {
  const type = documentType(request.document_type, feeSchedule)
  const department = departmentName(request)
  const submittedAt = formatThaiDateTime(request.created_at)
  const fee = Number(request.fee_amount ?? 0) > 0 ? formatAmount(request.fee_amount, 2) : null
  return framedMessage(request, type.emoji, headingText, [
    `เรื่อง: ${escapeHtml(type.label, 100)}`,
    department ? `ส่งถึง: ${escapeHtml(department, 80)}` : '',
    submittedAt ? `ยื่นเมื่อ: ${escapeHtml(submittedAt, 60)}` : '',
    fee ? `ค่าธรรมเนียม: ${escapeHtml(fee, 20)} บาท` : '',
    `อ้างอิง: #${escapeHtml(shortRef(request.id), 8)}`,
  ])
}

function buildDocumentRequestStatusMessage(request: Record<string, unknown>, feeSchedule: unknown) {
  const type = documentType(request.document_type, feeSchedule)
  const status = DOCUMENT_STATUS_LABEL[String(request.status)] ?? cleanText(request.status, 60)
  const department = departmentName(request)
  const updatedAt = formatThaiDateTime(request.updated_at ?? request.created_at)
  return framedMessage(request, type.emoji, 'อัปเดตสถานะคำขอเอกสาร', [
    `เรื่อง: ${escapeHtml(type.label, 100)}`,
    `สถานะ: <b>${escapeHtml(status, 60)}</b>`,
    department ? `ส่งถึง: ${escapeHtml(department, 80)}` : '',
    updatedAt ? `อัปเดตเมื่อ: ${escapeHtml(updatedAt, 60)}` : '',
    `อ้างอิง: #${escapeHtml(shortRef(request.id), 8)}`,
  ])
}

function buildFeeVerifiedMessage(request: Record<string, unknown>, feeSchedule: unknown) {
  const type = documentType(request.document_type, feeSchedule)
  const department = departmentName(request)
  const amount = formatAmount(request.fee_amount, 2)
  const verifiedAt = formatThaiDateTime(request.payment_verified_at ?? request.updated_at)
  return framedMessage(request, '💰', 'ตรวจสอบค่าธรรมเนียมแล้ว', [
    `เรื่อง: ${escapeHtml(type.label, 100)}`,
    amount ? `จำนวนเงิน: <b>${escapeHtml(amount, 20)} บาท</b>` : '',
    department ? `ส่งถึง: ${escapeHtml(department, 80)}` : '',
    verifiedAt ? `ตรวจสอบเมื่อ: ${escapeHtml(verifiedAt, 60)}` : '',
    `อ้างอิง: #${escapeHtml(shortRef(request.id), 8)}`,
  ])
}

// แจ้งเจ้าของการจองรถเดิม เมื่อ admin ใช้สิทธิ์ "จองแทนที่ฉุกเฉิน" ยกเลิกการจองของเขาไปให้ภารกิจด่วนกว่า
function buildFleetTripBumpedMessage(trip: Record<string, unknown>) {
  const vehicle = trip.vehicle as { name?: string } | null
  const driver = trip.driver as { full_name?: string } | null
  const vehicleName = cleanText(vehicle?.name, 100) || 'ไม่ทราบคัน'
  const driverName = cleanText(driver?.full_name, 100) || 'ไม่ทราบชื่อ'
  const reason = cleanText(trip.reject_reason, 400) || 'ไม่ระบุเหตุผล'
  return [
    '🚨 <b>การจองรถถูกยกเลิกเพื่อภารกิจฉุกเฉิน</b>',
    `รถ: ${escapeHtml(vehicleName, 100)}`,
    `ผู้จองเดิม: ${escapeHtml(driverName, 100)}`,
    trip.destination ? `ปลายทาง: ${escapeHtml(trip.destination, 200)}` : '',
    `${escapeHtml(reason, 400)}`,
  ].filter(Boolean).join('\n')
}

// ป้ายชนิดเชื้อเพลิงต้องตรงกับ FUEL_OPTIONS ใน src/lib/fleetAssets.js — edge function
// ไม่ได้ใช้โมดูลฝั่ง client จึงต้องคัดลอกมาไว้ที่นี่ แก้ที่ใดที่หนึ่งแล้วต้องแก้อีกฝั่ง
const FUEL_TYPE_LABEL: Record<string, string> = {
  diesel: 'ดีเซล',
  gasoline: 'เบนซิน',
  gas_lpg: 'แก๊ส LPG',
  electric: 'ไฟฟ้า',
  lubricant: 'น้ำมันหล่อลื่น/ของเหลว',
  other: 'อื่น ๆ',
}

function formatAmount(value: unknown, digits = 2) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num.toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function buildFleetFuelCreatedMessage(record: Record<string, unknown>) {
  const vehicle = record.vehicle as { name?: string; license_plate?: string; meter_unit?: string } | null
  const driver = record.driver as { full_name?: string } | null
  const vehicleName = cleanText(vehicle?.name, 100) || 'ไม่ทราบคัน'
  const plate = cleanText(vehicle?.license_plate, 40)
  // อุปกรณ์บางชนิด (เครื่องตัดหญ้า เครื่องสูบน้ำ) นับเป็นชั่วโมงไม่ใช่กิโลเมตร
  // ค่าใน DB เป็น 'km'/'hour' ต้องแปลงเป็นไทยเอง เทียบเท่า meterUnitShort() ใน src/lib/fleetAssets.js
  const meterUnit = vehicle?.meter_unit === 'hour' ? 'ชม.' : 'กม.'
  const fuelKey = String(record.fuel_type ?? '')
  const fuelLabel = fuelKey === 'other'
    ? cleanText(record.fuel_other_name, 60) || 'อื่น ๆ'
    : FUEL_TYPE_LABEL[fuelKey] ?? null
  const liters = formatAmount(record.liters, 2)
  const pricePerLiter = formatAmount(record.price_per_liter, 2)
  const totalCost = formatAmount(record.total_cost, 2)
  const odometer = formatAmount(record.odometer, 0)
  return [
    '⛽ <b>บันทึกการเติมเชื้อเพลิงใหม่</b>',
    `ยานพาหนะ: ${escapeHtml(vehicleName, 100)}${plate ? ` (${escapeHtml(plate, 40)})` : ''}`,
    record.filled_at ? `วันที่เติม: ${escapeHtml(formatThaiDate(record.filled_at), 60)}` : '',
    fuelLabel ? `ชนิด: ${escapeHtml(fuelLabel, 60)}${record.full_tank ? ' (เต็มถัง)' : ''}` : '',
    liters ? `ปริมาณ: ${escapeHtml(liters, 20)} ลิตร${pricePerLiter ? ` × ${escapeHtml(pricePerLiter, 20)} บาท` : ''}` : '',
    totalCost ? `เป็นเงิน: <b>${escapeHtml(totalCost, 20)} บาท</b>` : '',
    odometer ? `เลขไมล์: ${escapeHtml(odometer, 20)} ${escapeHtml(meterUnit, 20)}` : '',
    driver?.full_name ? `ผู้ใช้รถ: ${escapeHtml(driver.full_name, 100)}` : '',
    record.fuel_station ? `สถานีบริการ: ${escapeHtml(record.fuel_station, 100)}` : '',
    record.receipt_no ? `เลขที่ใบเสร็จ: ${escapeHtml(record.receipt_no, 60)}` : '',
  ].filter(Boolean).join('\n')
}

function isRecent(createdAt: unknown, minutes = 15) {
  const timestamp = new Date(String(createdAt ?? '')).getTime()
  return Number.isFinite(timestamp) && timestamp >= Date.now() - minutes * 60_000
}

function sameMunicipality(profile: Record<string, unknown> | null, resource: Record<string, unknown>) {
  return profile?.role === 'superadmin'
    || (!!profile?.municipality_id && profile.municipality_id === resource.municipality_id)
}

function canRequestNotification(
  spec: typeof notificationSpecs[NotificationType],
  resource: Record<string, unknown>,
  userId: string | null,
  profile: Record<string, unknown> | null,
) {
  const role = String(profile?.role ?? '')
  const isInternal = INTERNAL_ROLES.has(role)

  if (spec.access === 'event_create') {
    if (!userId || !isInternal) return false
    if (role === 'superadmin') return true
    if (role === 'admin' && sameMunicipality(profile, resource)) return true
    return resource.created_by === userId && sameMunicipality(profile, resource)
  }

  if (spec.access === 'staff') {
    return !!userId && isInternal && sameMunicipality(profile, resource)
  }

  if (userId && resource.user_id === userId) return true
  if (userId && isInternal && sameMunicipality(profile, resource)) return true
  return resource.user_id == null && isRecent(resource.created_at)
}

function idempotencyKey(type: NotificationType, resource: Record<string, unknown>) {
  const base = `${type}:${resource.id}`
  if (type === 'complaint_status_updated' || type === 'document_request_status_updated') {
    return `${base}:${cleanText(resource.status, 40)}:${cleanText(resource.updated_at, 40)}`
  }
  if (type === 'fee_verified') {
    return `${base}:${cleanText(resource.fee_amount, 40)}:${cleanText(resource.updated_at, 40)}`
  }
  if (type.startsWith('technician_')) {
    return `${base}:${cleanText(resource.status, 40)}:${cleanText(resource.updated_at, 40)}`
  }
  return base
}

function notificationMatchesResource(type: NotificationType, resource: Record<string, unknown>) {
  if (type === 'building_permit_created') return resource.document_type === 'building_permit'
  if (type === 'fee_verified') return Number(resource.fee_amount ?? 0) > 0
  if (type === 'technician_received') return resource.status === 'received'
  if (type === 'technician_in_progress') return resource.status === 'in_progress'
  if (type === 'technician_closed') return resource.status === 'done' || resource.status === 'completed'
  if (type === 'fleet_trip_bumped') return resource.status === 'cancelled'
  return true
}

async function claimDelivery(
  admin: ReturnType<typeof createClient>,
  values: Record<string, unknown>,
): Promise<ClaimResult> {
  const claimToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const insertValues = { ...values, claim_token: claimToken, status: 'pending', updated_at: now }
  const { data: inserted, error: insertError } = await admin
    .from('notification_deliveries')
    .insert(insertValues)
    .select('id,status,attempt_count,updated_at,claim_token')
    .maybeSingle()

  if (!insertError && inserted) return { claimed: true, delivery: inserted, claimToken }
  if (insertError?.code !== '23505') throw insertError

  const { data: existing, error: existingError } = await admin
    .from('notification_deliveries')
    .select('id,status,attempt_count,updated_at,claim_token')
    .eq('municipality_id', values.municipality_id)
    .eq('channel', values.channel)
    .eq('idempotency_key', values.idempotency_key)
    .maybeSingle()
  if (existingError || !existing) throw existingError ?? new Error('delivery row not found')
  if (existing.status === 'sent') return { claimed: false, duplicate: true, delivery: existing, claimToken: null }

  const stalePending = existing.status === 'pending'
    && new Date(existing.updated_at).getTime() < Date.now() - 2 * 60_000
  if (existing.status === 'pending' && !stalePending) {
    return { claimed: false, inProgress: true, delivery: existing, claimToken: null }
  }

  const { data: reclaimed, error: reclaimError } = await admin
    .from('notification_deliveries')
    .update({
      status: 'pending', claim_token: claimToken, last_error: null,
      requested_by: values.requested_by, updated_at: now,
    })
    .eq('id', existing.id)
    .eq('updated_at', existing.updated_at)
    .select('id,status,attempt_count,updated_at,claim_token')
    .maybeSingle()
  if (reclaimError) throw reclaimError
  if (!reclaimed) return { claimed: false, inProgress: true, delivery: existing, claimToken: null }
  return { claimed: true, delivery: reclaimed, claimToken }
}

async function sendTelegram(chatId: string, text: string): Promise<TelegramSendResult> {
  return sendTelegramMessage(chatId, text, BOT_TOKEN as string)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
  if (Number(req.headers.get('content-length') ?? 0) > 4096) {
    return json({ ok: false, error: 'request too large' }, 413)
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: 'server configuration is incomplete' }, 500)
  }

  try {
    const body = await req.json() as Record<string, unknown>
    const notificationType = body.notification_type as NotificationType
    const resourceId = body.resource_id
    if (!(notificationType in notificationSpecs) || !isUuid(resourceId)) {
      return json({ ok: false, error: 'invalid notification_type or resource_id' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const authorization = req.headers.get('Authorization') ?? ''
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authorization ? { Authorization: authorization } : {} },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData } = await authClient.auth.getUser()
    const userId = authData.user?.id ?? null
    const { data: profile } = userId
      ? await admin.from('profiles').select('id,role,municipality_id').eq('id', userId).maybeSingle()
      : { data: null }

    const spec = notificationSpecs[notificationType]
    const selectColumns = spec.table === 'events'
      ? 'id,municipality_id,created_by,created_at,title,description,event_date,event_time,end_time,location,audiences,is_all_day'
      : spec.table === 'complaints'
        ? 'id,municipality_id,user_id,created_at,updated_at,status,category,assigned_to,ref_no,village,department:departments(name,color),category_ref:complaint_categories(label,emoji)'
        : spec.table === 'fleet_trips'
          ? 'id,municipality_id,status,destination,reject_reason,vehicle:fleet_vehicles(name),driver:profiles!fleet_trips_driver_id_fkey(full_name)'
          : spec.table === 'fleet_fuel_records'
            ? 'id,municipality_id,created_at,filled_at,liters,price_per_liter,total_cost,odometer,full_tank,fuel_type,fuel_other_name,fuel_station,receipt_no,vehicle:fleet_vehicles(name,license_plate,meter_unit),driver:profiles!fleet_fuel_records_driver_id_fkey(full_name)'
            : 'id,municipality_id,user_id,created_at,updated_at,status,document_type,fee_amount,payment_verified_at,department:departments(name,color)'
    const { data: resource, error: resourceError } = await admin
      .from(spec.table)
      .select(selectColumns)
      .eq('id', resourceId)
      .maybeSingle()

    if (resourceError) return json({ ok: false, error: 'resource lookup failed' }, 500)
    if (!resource) return json({ ok: false, error: 'resource not found' }, 404)
    if (!notificationMatchesResource(notificationType, resource)) {
      return json({ ok: false, error: 'notification type does not match resource state' }, 422)
    }
    if (!canRequestNotification(spec, resource, userId, profile)) {
      return json({ ok: false, error: 'not authorized for this notification' }, 403)
    }

    const municipalityId = resource.municipality_id
    if (!isUuid(municipalityId)) return json({ ok: false, error: 'resource municipality is invalid' }, 422)
    const { data: municipality, error: municipalityError } = await admin
      .from('municipalities')
      .select('id,telegram_group_id,org_type,fee_schedule')
      .eq('id', municipalityId)
      .maybeSingle()
    if (municipalityError || !municipality) return json({ ok: false, error: 'municipality not found' }, 404)

    const claim = await claimDelivery(admin, {
      municipality_id: municipalityId,
      channel: 'telegram',
      notification_type: notificationType,
      resource_type: spec.resourceType,
      resource_id: resourceId,
      idempotency_key: idempotencyKey(notificationType, resource),
      requested_by: userId,
    })
    if (claim.duplicate) return json({ ok: true, duplicate: true, status: 'sent' })
    if (claim.inProgress || !claim.claimed) return json({ ok: true, duplicate: true, status: 'pending' }, 202)

    // 'skipped' = ช่องทางนี้ไม่ได้ถูกตั้งค่าไว้สำหรับ อปท. นี้ ไม่ใช่ความล้มเหลว
    // ต้องแยกออกจาก 'failed' ให้ชัด ไม่งั้น audit ของ notification_deliveries อ่านไม่ออกว่า
    // แถวไหนคือ "ระบบส่งไม่สำเร็จจริง" กับ "อปท. ไม่ได้เปิดใช้ช่องทางนี้"
    const finish = async (status: 'sent' | 'failed' | 'skipped', values: Record<string, unknown>) => {
      await admin.from('notification_deliveries').update({
        status, claim_token: null, updated_at: new Date().toISOString(), ...values,
      }).eq('id', claim.delivery.id).eq('claim_token', claim.claimToken)
    }

    // อปท. ที่ยังไม่ได้ผูกกลุ่ม Telegram (รวมถึงสนามซ้อม slug='demo' ที่ตั้งใจไม่ผูก) ไม่ใช่ error
    // ของเดิมคืน 422 ทำให้ client log console.error ทุกครั้งที่มีการเปลี่ยนสถานะคำร้อง — E2E
    // อ่านไม่ออกว่าอันไหนคือของพังจริง ต้องคืน 2xx พร้อมธง skipped ให้ client เงียบได้อย่างถูกต้อง
    // ⚠️ เคสตั้งค่าพังจริง (มี group แต่ token/สิทธิ์บอทเสีย) ยังตกไปที่ finish('failed') ตามเดิม
    if (!municipality.telegram_group_id) {
      await finish('skipped', { last_error: 'telegram group is not configured for this municipality' })
      return json({ ok: true, skipped: true, reason: 'not_configured' })
    }
    if (!BOT_TOKEN) {
      await finish('failed', { last_error: 'TELEGRAM_BOT_TOKEN is not configured' })
      return json({ ok: false, error: 'Telegram bot is not configured' }, 500)
    }

    const feeSchedule = municipality.fee_schedule
    const message = notificationType === 'event_created'
      ? buildEventMessage(resource, municipality.org_type)
      : notificationType === 'complaint_created'
        ? buildComplaintCreatedMessage(resource)
        : notificationType === 'complaint_status_updated' || notificationType.startsWith('technician_')
          ? buildComplaintStatusMessage(resource)
          : notificationType === 'fleet_trip_bumped'
            ? buildFleetTripBumpedMessage(resource)
            : notificationType === 'fleet_fuel_created'
              ? buildFleetFuelCreatedMessage(resource)
              : notificationType === 'document_request_created'
                ? buildDocumentRequestCreatedMessage(resource, feeSchedule)
                : notificationType === 'building_permit_created'
                  ? buildDocumentRequestCreatedMessage(resource, feeSchedule, 'มีคำขออนุญาตก่อสร้างใหม่')
                  : notificationType === 'document_request_status_updated'
                    ? buildDocumentRequestStatusMessage(resource, feeSchedule)
                    : notificationType === 'fee_verified'
                      ? buildFeeVerifiedMessage(resource, feeSchedule)
                      : null
    if (!message) {
      await finish('failed', { last_error: 'Notification template is not configured' })
      return json({ ok: false, error: 'notification template is not configured' }, 500)
    }

    const result = await sendTelegram(String(municipality.telegram_group_id), message)
    const totalAttempts = Number(claim.delivery.attempt_count ?? 0) + result.attempts
    if (!result.ok) {
      await finish('failed', { attempt_count: totalAttempts, last_error: result.error })
      return json({ ok: false, status: 'failed', error: result.error }, 502)
    }

    await finish('sent', {
      attempt_count: totalAttempts,
      provider_message_id: result.messageId == null ? null : String(result.messageId),
      last_error: null,
      sent_at: new Date().toISOString(),
    })
    return json({ ok: true, status: 'sent' })
  } catch (error) {
    console.error('notify-telegram failed:', error)
    return json({ ok: false, error: 'internal notification error' }, 500)
  }
})
