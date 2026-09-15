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
  // ผู้ร้องกด "ยังไม่เรียบร้อย" (reopen_complaint) — คนกดคือเจ้าของเรื่อง ไม่ใช่เจ้าหน้าที่
  complaint_reopened: { table: 'complaints', resourceType: 'complaint', access: 'owner' },
  document_request_created: { table: 'document_requests', resourceType: 'document_request', access: 'public_create' },
  document_request_status_updated: { table: 'document_requests', resourceType: 'document_request', access: 'staff' },
  building_permit_created: { table: 'document_requests', resourceType: 'document_request', access: 'public_create' },
  event_created: { table: 'events', resourceType: 'event', access: 'event_create' },
  fee_verified: { table: 'document_requests', resourceType: 'document_request', access: 'staff' },
  technician_received: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  technician_in_progress: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  technician_closed: { table: 'complaints', resourceType: 'complaint', access: 'staff' },
  fleet_trip_bumped: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_trip_waitlisted: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_fuel_created: { table: 'fleet_fuel_records', resourceType: 'fleet_fuel', access: 'staff' },
  fleet_trip_created: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_trip_approved: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_trip_rejected: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_trip_cancelled: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_trip_departed: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_trip_returned: { table: 'fleet_trips', resourceType: 'fleet_trip', access: 'staff' },
  fleet_vehicle_repair_started: { table: 'fleet_vehicles', resourceType: 'fleet_vehicle', access: 'staff' },
  fleet_vehicle_repair_finished: { table: 'fleet_vehicles', resourceType: 'fleet_vehicle', access: 'staff' },
  fleet_maintenance_created: { table: 'fleet_maintenance', resourceType: 'fleet_maintenance', access: 'staff' },
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

// จุดสีหน้าเส้นคั่นบรรทัดสุดท้าย (ดู framedMessage()) แยกตาม "กองที่รับผิดชอบ" ให้เจ้าหน้าที่กวาดตาหางานของกองตัวเอง
// ⚠️ Telegram Bot API กำหนดสีตัวอักษร/พื้นหลังไม่ได้ อีโมจิสีคือวิธีที่ให้ "สี" ได้จริง
// ใช้วงกลมไม่ใช่สี่เหลี่ยม: เจ้าของระบบขอให้สีกองเล็กที่สุด "เหมือนจุด" (2569-09-13) Telegram ย่อขนาด
// อีโมจิไม่ได้ วงกลมกินพื้นที่สีน้อยกว่าสี่เหลี่ยมในช่องขนาดเท่ากัน และมีครบ 9 สีพอดี
// (custom emoji ในข้อความที่บอทส่งเข้ากลุ่มใช้ได้โดยไม่ต้อง Premium แต่ก็เป็นแค่อักขระหนึ่งตัว
// ไม่ใช่พื้นหลัง และต้องหา emoji-id จากชุดสติกเกอร์ภายนอกมาผูก ไม่คุ้มเมื่อเทียบกับอีโมจิมาตรฐาน)
//
// อ่านจาก departments.color (คีย์ที่แอดมินเลือกในหน้าจัดการกอง หรือ trigger เติมให้ตอนสร้างกอง)
// เดิมผูกกับ departments.code มาตรฐาน แต่ อปท. ที่สร้างกองเองได้ code เป็น dept_* ทุกกอง
// (ตำหนักธรรม/ทุ่งแค้ว) เลยได้สีขาวเหมือนกันหมด ใช้แยกกองไม่ได้
// ⚠️ คีย์ต้องตรงกับ DEPARTMENT_COLORS ใน src/lib/departmentColors.js และ CHECK departments_color_check
// ⚠️ ห้าม deploy ไฟล์นี้ก่อน apply migration 20260913100000 — select คอลัมน์ color ที่ยังไม่มีทำให้
// query คำร้อง/คำขอพัง และการแจ้งเตือนทุกประเภทที่อิงสองตารางนี้หยุดส่งทั้งระบบ
const DEPARTMENT_COLOR_EMOJI: Record<string, string> = {
  red: '🔴',
  orange: '🟠',
  yellow: '🟡',
  green: '🟢',
  blue: '🔵',
  purple: '🟣',
  brown: '🟤',
  black: '⚫',
  white: '⚪',
}
const DEFAULT_DEPARTMENT_COLOR = '⚪'

// ต้องตรงกับ STATUS ใน src/components/admin/ComplaintsManager.jsx ทุกคำ
const COMPLAINT_STATUS_LABEL: Record<string, string> = {
  new: 'คำร้องใหม่', pending: 'คำร้องใหม่',
  received: 'รับเรื่องแล้ว',
  in_progress: 'กำลังดำเนินการ',
  // ตัดขั้น "ปิดเรื่องแล้ว" ออก 2569-09-15 — 'closed' คือ "ดำเนินการแล้ว" ที่ผู้รับผิดชอบกดเอง
  done: 'ดำเนินการแล้ว', completed: 'ดำเนินการแล้ว',
  closed: 'ดำเนินการแล้ว',
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
  water_meter_change: { emoji: '🔧', label: 'ขออนุญาตเปลี่ยนมาตรน้ำประปา' },
  water_supply_cancel: { emoji: '🚱', label: 'ขอยกเลิกใช้น้ำประปา' },
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

// คีย์ที่ไม่รู้จักหรือว่าง (กองเก่าก่อนมี trigger, รายการที่ยังไม่ผูกกอง) ได้ ⚪ ไม่ใช่ข้อความพัง
// ใช้ lookup ในแมปเท่านั้น ห้ามต่อค่าจาก DB เข้าข้อความตรงๆ แม้ CHECK จะกันไว้แล้วก็ตาม
function departmentColor(resource: Record<string, unknown>) {
  return DEPARTMENT_COLOR_EMOJI[String(departmentOf(resource)?.color ?? '')] ?? DEFAULT_DEPARTMENT_COLOR
}

// แถบสีเต็มบรรทัดเหนือหัวข้อ — เจ้าของระบบขอ "พื้นหลังสี" บนบรรทัดหัวข้อ (2569-09-13) แต่
// Telegram ทำไม่ได้: ตรวจกับ Bot API 10.3 แล้ว HTML รองรับเฉพาะ tag ในรายการ ไม่มีสีตัวอักษร/พื้นหลัง
// และ Rich Message block ทั้ง 27 แบบไม่มีฟิลด์สี ของที่มีพื้นหลังสีจริงมีแค่ปุ่ม (style 3 สี) ซึ่งไม่พอ
// กับ 6 กอง อยู่ใต้ข้อความ และต้องผูกลิงก์/callback — จึงเรียงสี่เหลี่ยมสีเต็มบรรทัดแทนให้ดูเป็นแถบ
// เจ้าของระบบขอ "กรอบสีรอบข้อความ" ต่อ (2569-09-13) — ทำไม่ได้ด้วยเหตุผลเดียวกัน จึงปิดท้ายด้วย
// แถบสีเดียวกันอีกเส้นให้ข้อความถูกประกบบน-ล่าง แยกใบชัดเวลาเรียงติดกันในกลุ่ม
// ไม่ทำขอบซ้าย (สี่เหลี่ยมนำหน้าทุกบรรทัด) เพราะบรรทัดยาวที่ตัดลงบรรทัดใหม่บนมือถือจะไม่มีสี่เหลี่ยม
// ขอบจึงขาดเป็นช่วง ส่วนขอบขวาทำไม่ได้เลยเพราะแต่ละบรรทัดยาวไม่เท่ากัน
// เจ้าของระบบขอเปลี่ยนแถบสี่เหลี่ยม 10 ช่องเป็น "เส้นประเล็กๆ" และให้สีกองเล็กเหมือนจุด (2569-09-13)
// ⇒ จุดสีกอง 1 ตัว + เส้นประบาง ┈ (U+2508) เส้นประระบายสีไม่ได้ สีกองจึงเหลือแค่จุดหน้าเส้น
// ⚠️ 12 ขีด: ฟอนต์ส่วนใหญ่วาด ┈ กว้างเต็ม 1em พรีวิวที่จอ 360px 16 ขีดเกือบชนขอบกรอบข้อความ
// กลุ่มที่มีรูปโปรไฟล์ข้างกรอบจะแคบกว่านั้นอีก เพิ่มแล้วเส้นจะหักเป็น 2 บรรทัด
// เจ้าของระบบขอเหลือเส้นเดียว (#166) แล้วย้ายไปไว้ "ล่างสุด" (2569-09-13) เพราะบรรทัดบนมีอีโมจิประเภท
// นำหัวเรื่องอยู่แล้ว ⇒ เส้นทำหน้าที่ปิดท้ายใบ ห้ามกลับไปใส่ไว้บนหรือประกบบน-ล่าง
// ผลพลอยได้: พรีวิว push notification ขึ้นต้นด้วยหัวเรื่องทันที ไม่เสียที่ให้เส้นคั่น 13 ตัวอักษร
const RULE_DASH = '┈'
const RULE_DASH_COUNT = 12

// ❌ ห้ามใส่แฮชแท็กชื่อกองภาษาไทย — เคยใส่ (#161) แล้วเห็นของจริงในกลุ่มว่า Telegram ตัดแท็กทันที
// ที่เจอสระบน/ล่างหรือวรรณยุกต์ "#สำนักปลัด" เหลือ "#สำน" ตามด้วย "ักปลัด" เป็นข้อความธรรมดา
// (ฝั่งเรากรองอักขระถูกแล้ว แต่ตัวแยกแท็กของ Telegram ไม่นับ combining mark ไทย แก้ฝั่งเราไม่ได้)
// ชื่อย่อก็ใช้แทนไม่ได้: บาง อปท. ตั้งชื่อย่อเป็น "ช่าง"/"ศึกษา" ซึ่งมีสระ และบางกองไม่มีชื่อย่อ
// ส่วน "อ้างอิง: #a1b2c3d4" ยังเป็นแท็กได้ปกติเพราะเป็นอักษรอังกฤษกับตัวเลขล้วน

// ประกอบข้อความทั้งใบ: <อีโมจิ> <หัวเรื่อง> / เนื้อหา / เส้นคั่นสีกอง
// บรรทัดเนื้อหาที่เป็นค่าว่างถูกตัดทิ้ง ไม่เหลือหัวข้อค้างหรือบรรทัดเปล่า
function framedMessage(resource: Record<string, unknown>, emoji: string, title: string, body: string[]) {
  const rule = departmentColor(resource) + RULE_DASH.repeat(RULE_DASH_COUNT)
  return [`${emoji} <b>${title}</b>`, ...body.filter(Boolean), rule].join('\n')
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
// รูปแบบของทุกใบ (ดู framedMessage()): <อีโมจิประเภทเรื่อง> <หัวเรื่อง> / เนื้อหา / เส้นคั่นสีกอง
// อีโมจิประเภทอยู่หัวข้อความอย่างเดียว บรรทัด "ประเภท:/เรื่อง:" จึงแสดงชื่อล้วน ไม่ใส่ซ้ำ
// ข้อยกเว้นเดียวคือ fee_verified ที่ใช้ 💰 เพราะสาระของใบนั้นคือเงิน ไม่ใช่ชนิดเอกสาร
// ⚠️ หมวดที่ห้ามเปิดเผยอะไรในกลุ่มเลย — เจ้าของระบบตัดสินใจ 2569-09-15
// กลุ่ม Telegram ของ อปท. คือเจ้าหน้าที่ทุกกองรวมกัน ถ้าขึ้น "แจ้งการทุจริต · สถานที่: หมู่ 3 · ส่งถึง:
// สำนักปลัด" คนในกลุ่มเดาตัวผู้แจ้งได้จากหมู่บ้าน และผู้ถูกร้องอาจอยู่ในกลุ่มนั้นเอง
// ใบใหม่จึงส่งแค่หัวข้อกลางๆ ให้แอดมินเข้าไปดูในระบบ ส่วนการเปลี่ยนสถานะไม่ส่งเลย (ดู handler)
// ผูกด้วยรหัสหมวดมาตรฐาน ใช้ได้ทุก อปท. เพราะรหัส corruption เหมือนกันทุกที่
const CONFIDENTIAL_COMPLAINT_CATEGORIES = new Set(['corruption'])

function isConfidentialComplaint(complaint: Record<string, unknown>) {
  return CONFIDENTIAL_COMPLAINT_CATEGORIES.has(String(complaint.category ?? ''))
}

function buildComplaintCreatedMessage(complaint: Record<string, unknown>) {
  if (isConfidentialComplaint(complaint)) {
    // ไม่ใช้ framedMessage — เส้นคั่นสีกองก็บอกได้ว่าเรื่องไปกองไหน
    return [
      '🔒 <b>มีเรื่องลับรอแอดมินรับเรื่อง</b>',
      'กรุณาเข้าสู่ระบบเพื่อตรวจสอบตามสิทธิ์',
      DEFAULT_DEPARTMENT_COLOR + RULE_DASH.repeat(RULE_DASH_COUNT),
    ].join('\n')
  }
  const category = complaintCategory(complaint)
  const department = departmentName(complaint)
  const submittedAt = formatThaiDateTime(complaint.created_at)
  // ระบบรับเรื่องเองตอน INSERT (20260915100100) — บอกให้แอดมินรู้ว่าใบไหนไม่ต้องทำอะไร
  // ใบที่ยัง pending คือใบที่ระบบรับเองไม่ได้และรอแอดมินจริงๆ
  const intake = complaint.status === 'received'
    ? 'สถานะ: ระบบรับเรื่องและส่งถึงผู้รับผิดชอบแล้ว'
    : complaint.status === 'pending' || complaint.status === 'new'
      ? 'สถานะ: <b>รอแอดมินรับเรื่อง</b>'
      : ''
  return framedMessage(complaint, category.emoji, 'มีคำร้องใหม่', [
    complaint.ref_no ? `เลขที่: ${escapeHtml(complaint.ref_no, 40)}` : '',
    `ประเภท: ${escapeHtml(category.label, 60)}`,
    complaint.village ? `สถานที่: ${escapeHtml(complaint.village, 120)}` : '',
    department ? `ส่งถึง: ${escapeHtml(department, 80)}` : '',
    submittedAt ? `แจ้งเมื่อ: ${escapeHtml(submittedAt, 60)}` : '',
    intake,
  ])
}

// ผู้ร้องแจ้งว่ายังไม่เรียบร้อยภายใน 7 วัน — ไม่ใส่เหตุผลที่ผู้ร้องพิมพ์ (ข้อความอิสระของประชาชน, PDPA)
function buildComplaintReopenedMessage(complaint: Record<string, unknown>) {
  const category = complaintCategory(complaint)
  const department = departmentName(complaint)
  return framedMessage(complaint, '🔁', 'ผู้ร้องแจ้งว่ายังไม่เรียบร้อย', [
    complaint.ref_no ? `เลขที่: ${escapeHtml(complaint.ref_no, 40)}` : '',
    `ประเภท: ${escapeHtml(category.label, 60)}`,
    complaint.village ? `สถานที่: ${escapeHtml(complaint.village, 120)}` : '',
    complaint.status === 'received'
      ? 'สถานะ: ส่งกลับถึงผู้รับผิดชอบเดิมแล้ว'
      : 'สถานะ: <b>รอแอดมินรับเรื่อง</b>',
    department ? `ส่งถึง: ${escapeHtml(department, 80)}` : '',
  ])
}

function buildComplaintStatusMessage(complaint: Record<string, unknown>) {
  const category = complaintCategory(complaint)
  // สถานะ "เปลี่ยน" กลับมาเป็นคำร้องใหม่ได้ทางเดียวคือผู้รับผิดชอบกดส่งคืน (return_complaint_to_intake)
  // ป้าย "คำร้องใหม่" จะอ่านเหมือนมีคนยื่นซ้ำ — บอกให้ตรงว่าเรื่องกลับไปรอแอดมิน
  const status = complaint.status === 'pending' || complaint.status === 'new'
    ? 'ส่งคืนให้แอดมินรับเรื่อง'
    : COMPLAINT_STATUS_LABEL[String(complaint.status)] ?? cleanText(complaint.status, 60)
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
  return framedMessage(trip, '🚨', 'การจองรถถูกยกเลิกเพื่อภารกิจฉุกเฉิน', [
    `รถ: ${escapeHtml(vehicleName, 100)}`,
    `ผู้จองเดิม: ${escapeHtml(driverName, 100)}`,
    trip.destination ? `ปลายทาง: ${escapeHtml(trip.destination, 200)}` : '',
    `${escapeHtml(reason, 400)}`,
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// วงจรคำขอใช้รถ — เจ้าของระบบขอให้แจ้งทุกขั้น (2569-09-13): ยื่นใหม่ / อนุมัติ / ไม่อนุมัติ /
// ยกเลิก / ออกเดินทาง / คืนรถ ⚠️ เป็นข้อความเข้ากลุ่มเดียวกับคำร้อง น้ำเลามีราว 45 ทริป/เดือน
// = 150–180 ข้อความ ถ้ากลุ่มรกเกินไป ทางออกคือแยกกลุ่ม Telegram ของงานรถ ไม่ใช่ตัดข้อความให้สั้นลง
// ชื่อผู้ขอ/ผู้ขับ/ผู้อนุมัติเป็นเจ้าหน้าที่ของ อปท. ไม่ใช่ประชาชน ใส่ได้ตามแนว fleet_trip_bumped
// สีกองใช้กองที่ขอใช้รถ (fleet_trips.department_id) ให้กองนั้นเห็นคำขอของตัวเองในกลุ่ม
// ─────────────────────────────────────────────────────────────────────────────
function vehicleLabel(vehicle: { name?: string; license_plate?: string } | null) {
  const name = cleanText(vehicle?.name, 100) || 'ไม่ทราบคัน'
  const plate = cleanText(vehicle?.license_plate, 40)
  return `${escapeHtml(name, 100)}${plate ? ` (${escapeHtml(plate, 40)})` : ''}`
}

// อุปกรณ์บางชนิด (เครื่องตัดหญ้า เครื่องสูบน้ำ) นับเป็นชั่วโมงไม่ใช่กิโลเมตร
// ค่าใน DB เป็น 'km'/'hour' ต้องแปลงเป็นไทยเอง เทียบเท่า meterUnitShort() ใน src/lib/fleetAssets.js
function meterUnitLabel(vehicle: { meter_unit?: string } | null) {
  return vehicle?.meter_unit === 'hour' ? 'ชม.' : 'กม.'
}

function tripSummaryLines(trip: Record<string, unknown>) {
  const vehicle = trip.vehicle as { name?: string; license_plate?: string } | null
  const driver = trip.driver as { full_name?: string } | null
  const requester = trip.requester as { full_name?: string } | null
  const departure = formatThaiDateTime(trip.planned_departure)
  const returned = formatThaiDateTime(trip.planned_return)
  const department = departmentName(trip)
  return [
    `รถ: ${vehicleLabel(vehicle)}`,
    driver?.full_name ? `ผู้ขับ: ${escapeHtml(driver.full_name, 100)}` : '',
    departure ? `ออก: ${escapeHtml(departure, 60)}` : '',
    returned ? `กลับ: ${escapeHtml(returned, 60)}` : '',
    trip.destination ? `ปลายทาง: ${escapeHtml(trip.destination, 200)}` : '',
    requester?.full_name ? `ผู้ขอ: ${escapeHtml(requester.full_name, 100)}` : '',
    department ? `กอง: ${escapeHtml(department, 80)}` : '',
  ]
}

function tripRef(trip: Record<string, unknown>) {
  return `อ้างอิง: #${escapeHtml(shortRef(trip.id), 8)}`
}

// คำขอใหม่ถูกส่งเป็น pending เสมอ แล้ว DB ตัดสินคิว (fleet_trips_guard_overlap):
// รถว่าง → approved + approval_method='auto' · คิวชน → waitlisted (มีข้อความของตัวเองแล้ว)
function buildFleetTripCreatedMessage(trip: Record<string, unknown>) {
  const autoApproved = trip.status === 'approved' && trip.approval_method === 'auto'
  return framedMessage(trip, autoApproved ? '✅' : '🚗', autoApproved ? 'อนุมัติคิวรถอัตโนมัติ' : 'คำขอใช้รถใหม่ รออนุมัติ', [
    ...tripSummaryLines(trip),
    autoApproved
      ? 'สถานะ: <b>อนุมัติแล้ว</b> (รถว่าง ระบบให้คิวอัตโนมัติ)'
      : 'สถานะ: <b>รออนุมัติ</b>',
    tripRef(trip),
  ])
}

function buildFleetTripApprovedMessage(trip: Record<string, unknown>) {
  const approver = trip.approver as { full_name?: string } | null
  return framedMessage(trip, '✅', 'อนุมัติคำขอใช้รถ', [
    ...tripSummaryLines(trip),
    approver?.full_name ? `ผู้อนุมัติ: ${escapeHtml(approver.full_name, 100)}` : '',
    tripRef(trip),
  ])
}

// ปฏิเสธ/ยกเลิกบังคับกรอกเหตุผลอย่างน้อย 5 ตัวอักษรที่หน้าจอ แต่ข้อมูลเก่าอาจว่าง
// approved_by ใช้เก็บ "ผู้พิจารณา/ผู้ดำเนินการ" ทั้งอนุมัติ ปฏิเสธ และยกเลิก (ดู FleetTrips.jsx)
function buildFleetTripRejectedMessage(trip: Record<string, unknown>) {
  const approver = trip.approver as { full_name?: string } | null
  const reason = cleanText(trip.reject_reason, 400)
  return framedMessage(trip, '❌', 'ไม่อนุมัติคำขอใช้รถ', [
    ...tripSummaryLines(trip),
    `เหตุผล: ${reason ? escapeHtml(reason, 400) : 'ไม่ระบุ'}`,
    approver?.full_name ? `ผู้พิจารณา: ${escapeHtml(approver.full_name, 100)}` : '',
    tripRef(trip),
  ])
}

function buildFleetTripCancelledMessage(trip: Record<string, unknown>) {
  const approver = trip.approver as { full_name?: string } | null
  const reason = cleanText(trip.reject_reason, 400)
  return framedMessage(trip, '🚫', 'ยกเลิกคำขอใช้รถ', [
    ...tripSummaryLines(trip),
    `เหตุผล: ${reason ? escapeHtml(reason, 400) : 'ไม่ระบุ'}`,
    approver?.full_name ? `ผู้ยกเลิก: ${escapeHtml(approver.full_name, 100)}` : '',
    tripRef(trip),
  ])
}

function buildFleetTripDepartedMessage(trip: Record<string, unknown>) {
  const vehicle = trip.vehicle as { name?: string; license_plate?: string; meter_unit?: string } | null
  const driver = trip.driver as { full_name?: string } | null
  const startedAt = formatThaiDateTime(trip.started_at)
  const plannedReturn = formatThaiDateTime(trip.planned_return)
  const meter = formatAmount(trip.odometer_start, 0)
  const department = departmentName(trip)
  return framedMessage(trip, '🚙', 'รถออกเดินทาง', [
    `รถ: ${vehicleLabel(vehicle)}`,
    driver?.full_name ? `ผู้ขับ: ${escapeHtml(driver.full_name, 100)}` : '',
    startedAt ? `ออกเมื่อ: ${escapeHtml(startedAt, 60)}` : '',
    plannedReturn ? `กำหนดกลับ: ${escapeHtml(plannedReturn, 60)}` : '',
    trip.destination ? `ปลายทาง: ${escapeHtml(trip.destination, 200)}` : '',
    meter ? `เลขไมล์ก่อนออก: ${escapeHtml(meter, 20)} ${meterUnitLabel(vehicle)}` : '',
    department ? `กอง: ${escapeHtml(department, 80)}` : '',
    tripRef(trip),
  ])
}

function buildFleetTripReturnedMessage(trip: Record<string, unknown>) {
  const vehicle = trip.vehicle as { name?: string; license_plate?: string; meter_unit?: string } | null
  const driver = trip.driver as { full_name?: string } | null
  const returnedAt = formatThaiDateTime(trip.returned_at)
  const meter = formatAmount(trip.odometer_end, 0)
  // distance_km เป็น generated column (odometer_end - odometer_start) ว่างเมื่อไม่ได้กรอกเลขไมล์
  const distance = trip.distance_km == null ? null : formatAmount(trip.distance_km, 0)
  const department = departmentName(trip)
  return framedMessage(trip, '🏁', 'คืนรถแล้ว', [
    `รถ: ${vehicleLabel(vehicle)}`,
    driver?.full_name ? `ผู้ขับ: ${escapeHtml(driver.full_name, 100)}` : '',
    returnedAt ? `กลับเมื่อ: ${escapeHtml(returnedAt, 60)}` : '',
    trip.destination ? `ปลายทาง: ${escapeHtml(trip.destination, 200)}` : '',
    meter ? `เลขไมล์หลังกลับ: ${escapeHtml(meter, 20)} ${meterUnitLabel(vehicle)}` : '',
    distance ? `ระยะทาง: <b>${escapeHtml(distance, 20)} ${meterUnitLabel(vehicle)}</b>` : '',
    department ? `กอง: ${escapeHtml(department, 80)}` : '',
    tripRef(trip),
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// รถเข้าซ่อม / ซ่อมเสร็จ — ระบบไม่มีใบแจ้งซ่อม สถานะอยู่ที่ fleet_vehicles.status ('under_repair')
// ตั้งจากหน้าแก้ข้อมูลรถ ส่วน fleet_maintenance เป็นประวัติหลังซ่อม (ค่าใช้จ่าย/อู่) ไม่มีสถานะ
// สีกองใช้กองเจ้าของรถ (fleet_vehicles.department_id)
// ─────────────────────────────────────────────────────────────────────────────
function vehicleDepartmentResource(resource: Record<string, unknown>) {
  const vehicle = resource.vehicle as { department?: unknown } | null
  return { ...resource, department: vehicle?.department ?? null }
}

function buildFleetVehicleRepairMessage(vehicle: Record<string, unknown>) {
  const underRepair = vehicle.status === 'under_repair'
  const department = departmentName(vehicle)
  const updatedAt = formatThaiDateTime(vehicle.updated_at)
  return framedMessage(vehicle, underRepair ? '🔧' : '✅', underRepair ? 'รถงดใช้งาน เข้าซ่อม' : 'รถกลับมาใช้งานได้', [
    `ยานพาหนะ: ${vehicleLabel(vehicle as { name?: string; license_plate?: string })}`,
    underRepair ? 'สถานะ: <b>กำลังซ่อม</b>' : 'สถานะ: <b>ใช้งานได้</b>',
    // ตรงกับ vehicle_unavailable ใน fleet_trip_queue_reasons() — คำขอใหม่ของรถคันนี้ไม่ได้คิวอัตโนมัติ
    underRepair ? 'คำขอใช้รถคันนี้ช่วงซ่อมจะรอจัดสรรรถ ไม่ได้คิวอัตโนมัติ' : '',
    department ? `กองเจ้าของรถ: ${escapeHtml(department, 80)}` : '',
    updatedAt ? `อัปเดตเมื่อ: ${escapeHtml(updatedAt, 60)}` : '',
  ])
}

// ต้องตรงกับ TYPES ใน src/components/fleet/FleetMaintenance.jsx ทุกคำ (เทสต์ตรวจให้)
const MAINTENANCE_TYPE_LABEL: Record<string, string> = {
  routine: 'บำรุงรักษา',
  oil_change: 'เปลี่ยนถ่ายน้ำมัน',
  repair: 'ซ่อมแซม',
  inspection: 'ตรวจสภาพ',
  tire: 'ยาง',
  battery: 'แบตเตอรี่',
  other: 'อื่นๆ',
}

function buildFleetMaintenanceCreatedMessage(record: Record<string, unknown>) {
  const vehicle = record.vehicle as { name?: string; license_plate?: string; meter_unit?: string } | null
  const typeLabel = MAINTENANCE_TYPE_LABEL[String(record.maintenance_type ?? '')] ?? 'อื่นๆ'
  const cost = formatAmount(record.cost, 2)
  const meter = formatAmount(record.odometer, 0)
  const nextMeter = formatAmount(record.next_service_meter, 0)
  const serviceDate = formatThaiDate(record.service_date)
  const nextDate = formatThaiDate(record.next_service_date)
  const resource = vehicleDepartmentResource(record)
  const department = departmentName(resource)
  return framedMessage(resource, '🛠️', 'บันทึกซ่อมบำรุงใหม่', [
    `ยานพาหนะ: ${vehicleLabel(vehicle)}`,
    `ประเภท: ${escapeHtml(typeLabel, 60)}`,
    record.description ? `รายละเอียด: ${escapeHtml(record.description, 200)}` : '',
    serviceDate ? `วันที่ซ่อม: ${escapeHtml(serviceDate, 60)}` : '',
    cost && Number(record.cost) > 0 ? `ค่าใช้จ่าย: <b>${escapeHtml(cost, 20)} บาท</b>` : '',
    record.vendor ? `อู่/ร้าน: ${escapeHtml(record.vendor, 100)}` : '',
    meter ? `เลขไมล์: ${escapeHtml(meter, 20)} ${meterUnitLabel(vehicle)}` : '',
    nextDate || nextMeter
      ? `นัดครั้งถัดไป: ${[nextDate, nextMeter ? `${nextMeter} ${meterUnitLabel(vehicle)}` : ''].filter(Boolean).map((v) => escapeHtml(v, 60)).join(' หรือ ')}`
      : '',
    department ? `กองเจ้าของรถ: ${escapeHtml(department, 80)}` : '',
  ])
}

// คำขอใช้รถที่รถคันนั้นมีคิวอยู่แล้ว — ระบบอนุมัติอัตโนมัติไม่ได้ ต้องให้ผู้ดูแลจัดสรรรถ
// (เปลี่ยนรถ/เลื่อนเวลาแล้วอนุมัติ หรือปฏิเสธ) ถ้าไม่แจ้ง คำขอจะค้างเงียบจนถึงวันเดินทาง
// ชื่อผู้ขอเป็นเจ้าหน้าที่ของ อปท. ไม่ใช่ประชาชน ใส่ได้ตามแนวเดียวกับ fleet_trip_bumped
// ต้องตรงกับ QUEUE_REASON_LABEL ใน src/components/fleet/FleetTrips.jsx และรหัสจาก
// fleet_trip_queue_reasons() ใน DB ทุกคำ (edge function ไม่ได้ import โมดูลฝั่ง client)
// {buffer} {max_duration} {past_grace} เติมตัวเลขจาก fleet_trip_rule_settings() — ห้ามพิมพ์ตัวเลขลงข้อความ
const QUEUE_REASON_LABEL: Record<string, string> = {
  vehicle_busy: 'รถคันนี้มีคิวทับช่วงเวลา',
  driver_busy: 'ผู้ขับรถติดภารกิจอื่นช่วงเวลาเดียวกัน',
  vehicle_unavailable: 'รถไม่อยู่ในสถานะใช้งานได้ (กำลังซ่อม/ปลดประจำการ)',
  vehicle_tight: 'คิวรถติดกับคิวอื่นเกินไป (ห่างไม่ถึง {buffer})',
  driver_tight: 'คิวผู้ขับรถติดกันเกินไป (ห่างไม่ถึง {buffer})',
  vehicle_not_returned: 'รถยังไม่คืนจากทริปก่อนหน้าที่เลยเวลากลับแล้ว',
  past_departure: 'เวลาออกย้อนหลังเกิน {past_grace}',
  long_duration: 'ขอใช้รถนานเกิน {max_duration}',
  vehicle_documents_expired: 'พ.ร.บ./ประกัน/ภาษี/ตรวจสภาพ หมดอายุก่อนวันกลับ',
}

type TripRuleMinutes = { buffer?: unknown; max_duration?: unknown; past_grace?: unknown } | null

// ต้องให้ผลเหมือน formatRuleMinutes ใน FleetTrips.jsx · อ่านกติกาไม่ได้ = ไม่เดาตัวเลข
const RULE_UNKNOWN_TEXT = 'เวลาที่กำหนด'
function formatRuleMinutes(minutes: unknown) {
  const n = Number(minutes)
  if (minutes == null || !Number.isInteger(n) || n < 0) return null
  if (n > 0 && n % 1440 === 0) return `${n / 1440} วัน`
  if (n > 0 && n % 60 === 0) return `${n / 60} ชั่วโมง`
  return `${n} นาที`
}

function queueReasonText(code: string, rules: TripRuleMinutes) {
  const label = QUEUE_REASON_LABEL[code]
  if (!label) return 'เหตุผลอื่น'
  return label.replace(/\{(buffer|max_duration|past_grace)\}/g,
    (_, key: 'buffer' | 'max_duration' | 'past_grace') => formatRuleMinutes(rules?.[key]) ?? RULE_UNKNOWN_TEXT)
}

async function loadTripRuleMinutes(admin: ReturnType<typeof createClient>): Promise<TripRuleMinutes> {
  try {
    const { data, error } = await admin.rpc('fleet_trip_rule_settings').maybeSingle()
    if (error || !data) return null
    const row = data as Record<string, unknown>
    return { buffer: row.queue_buffer_minutes, max_duration: row.max_auto_duration_minutes, past_grace: row.past_grace_minutes }
  } catch {
    // อ่านกติกาไม่ได้ต้องไม่ทำให้แจ้งเตือนหลุด — ข้อความขึ้น "เวลาที่กำหนด" แทนตัวเลข
    return null
  }
}

function buildFleetTripWaitlistedMessage(trip: Record<string, unknown>, rules: TripRuleMinutes = null) {
  const vehicle = trip.vehicle as { name?: string; license_plate?: string } | null
  const requester = trip.requester as { full_name?: string } | null
  const vehicleName = cleanText(vehicle?.name, 100) || 'ไม่ทราบคัน'
  const plate = cleanText(vehicle?.license_plate, 40)
  const departure = formatThaiDateTime(trip.planned_departure)
  const returned = formatThaiDateTime(trip.planned_return)
  const department = departmentName(trip)
  // รหัสที่ไม่รู้จักตกเป็นข้อความกลาง ห้ามต่อค่าจาก DB เข้าข้อความตรงๆ
  const reasons = Array.isArray(trip.waitlist_reasons)
    ? [...new Set(trip.waitlist_reasons.map((code) => queueReasonText(String(code), rules)))]
    : []
  return framedMessage(trip, '🚗', 'คำขอใช้รถรอจัดสรรรถ', [
    `รถ: ${escapeHtml(vehicleName, 100)}${plate ? ` (${escapeHtml(plate, 40)})` : ''}`,
    departure ? `ออก: ${escapeHtml(departure, 60)}` : '',
    returned ? `กลับ: ${escapeHtml(returned, 60)}` : '',
    trip.destination ? `ปลายทาง: ${escapeHtml(trip.destination, 200)}` : '',
    requester?.full_name ? `ผู้ขอ: ${escapeHtml(requester.full_name, 100)}` : '',
    department ? `กอง: ${escapeHtml(department, 80)}` : '',
    reasons.length
      ? `เหตุผล: ${escapeHtml(reasons.join(' · '), 400)}`
      : 'ระบบให้คิวอัตโนมัติไม่ได้ ผู้ดูแลต้องจัดสรรรถก่อนอนุมัติ',
    `อ้างอิง: #${escapeHtml(shortRef(trip.id), 8)}`,
  ])
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
  // Number(null) = 0 — เลขไมล์/ค่าใช้จ่ายที่ไม่ได้กรอกต้องไม่ขึ้นเป็น "0 กม." ในกลุ่ม
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num.toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function buildFleetFuelCreatedMessage(record: Record<string, unknown>) {
  const vehicle = record.vehicle as { name?: string; license_plate?: string; meter_unit?: string } | null
  const driver = record.driver as { full_name?: string } | null
  const meterUnit = meterUnitLabel(vehicle)
  const fuelKey = String(record.fuel_type ?? '')
  const fuelLabel = fuelKey === 'other'
    ? cleanText(record.fuel_other_name, 60) || 'อื่น ๆ'
    : FUEL_TYPE_LABEL[fuelKey] ?? null
  const liters = formatAmount(record.liters, 2)
  const pricePerLiter = formatAmount(record.price_per_liter, 2)
  const totalCost = formatAmount(record.total_cost, 2)
  const odometer = formatAmount(record.odometer, 0)
  // สีกองใช้กองเจ้าของรถ — fleet_fuel_records ไม่มี department_id ของตัวเอง
  return framedMessage(vehicleDepartmentResource(record), '⛽', 'บันทึกการเติมเชื้อเพลิงใหม่', [
    `ยานพาหนะ: ${vehicleLabel(vehicle)}`,
    record.filled_at ? `วันที่เติม: ${escapeHtml(formatThaiDate(record.filled_at), 60)}` : '',
    fuelLabel ? `ชนิด: ${escapeHtml(fuelLabel, 60)}${record.full_tank ? ' (เต็มถัง)' : ''}` : '',
    liters ? `ปริมาณ: ${escapeHtml(liters, 20)} ลิตร${pricePerLiter ? ` × ${escapeHtml(pricePerLiter, 20)} บาท` : ''}` : '',
    totalCost ? `เป็นเงิน: <b>${escapeHtml(totalCost, 20)} บาท</b>` : '',
    odometer ? `เลขไมล์: ${escapeHtml(odometer, 20)} ${escapeHtml(meterUnit, 20)}` : '',
    driver?.full_name ? `ผู้ใช้รถ: ${escapeHtml(driver.full_name, 100)}` : '',
    record.fuel_station ? `สถานีบริการ: ${escapeHtml(record.fuel_station, 100)}` : '',
    record.receipt_no ? `เลขที่ใบเสร็จ: ${escapeHtml(record.receipt_no, 60)}` : '',
  ])
}

// ชนิดที่สร้างข้อความจากแถวเดียวโดยไม่ต้องอ่านข้อมูลอื่นเพิ่ม
const FLEET_MESSAGE_BUILDERS: Partial<Record<NotificationType, (resource: Record<string, unknown>) => string>> = {
  fleet_trip_created: buildFleetTripCreatedMessage,
  fleet_trip_approved: buildFleetTripApprovedMessage,
  fleet_trip_rejected: buildFleetTripRejectedMessage,
  fleet_trip_cancelled: buildFleetTripCancelledMessage,
  fleet_trip_departed: buildFleetTripDepartedMessage,
  fleet_trip_returned: buildFleetTripReturnedMessage,
  fleet_vehicle_repair_started: buildFleetVehicleRepairMessage,
  fleet_vehicle_repair_finished: buildFleetVehicleRepairMessage,
  fleet_maintenance_created: buildFleetMaintenanceCreatedMessage,
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

  // เจ้าของเรื่องเท่านั้น — ไม่มีทางเข้าของผู้ไม่ล็อกอิน (isRecent) เพราะเปิดเรื่องกลับต้องล็อกอิน
  if (spec.access === 'owner') {
    return !!userId && resource.user_id === userId
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
  // รถคันเดียวเข้าซ่อมได้หลายรอบ — ผูกกับ updated_at (trigger ตั้งทุกครั้งที่แก้) ไม่งั้นรอบที่ 2 ถูกกันเป็นซ้ำ
  // ส่วนขั้นของคำขอใช้รถเกิดได้ครั้งเดียวต่อใบ (DB guard ไม่ให้ย้อนสถานะ) ใช้ ชนิด:id พอ
  if (type === 'fleet_vehicle_repair_started' || type === 'fleet_vehicle_repair_finished') {
    return `${base}:${cleanText(resource.updated_at, 40)}`
  }
  return base
}

function notificationMatchesResource(type: NotificationType, resource: Record<string, unknown>) {
  if (type === 'building_permit_created') return resource.document_type === 'building_permit'
  if (type === 'fee_verified') return Number(resource.fee_amount ?? 0) > 0
  if (type === 'technician_received') return resource.status === 'received'
  if (type === 'technician_in_progress') return resource.status === 'in_progress'
  if (type === 'technician_closed') return resource.status === 'closed' || resource.status === 'done' || resource.status === 'completed'
  if (type === 'complaint_reopened') return resource.status === 'received' || resource.status === 'pending'
  if (type === 'fleet_trip_bumped') return resource.status === 'cancelled'
  // สถานะนี้ตั้งโดย DB (fleet_trips_guard_overlap) เท่านั้น ห้ามส่งแจ้งเตือนตามคำบอกของ client
  if (type === 'fleet_trip_waitlisted') return resource.status === 'waitlisted'
  // ทุกขั้นของคำขอใช้รถตรวจสถานะจริงใน DB — client บอกว่า "อนุมัติแล้ว" แต่แถวยังไม่ใช่ approved ต้องไม่ส่ง
  if (type === 'fleet_trip_created') {
    return resource.status === 'pending' || (resource.status === 'approved' && resource.approval_method === 'auto')
  }
  // อนุมัติอัตโนมัติแจ้งไปแล้วใน fleet_trip_created ห้ามส่งซ้ำอีกใบ
  if (type === 'fleet_trip_approved') return resource.status === 'approved' && resource.approval_method !== 'auto'
  if (type === 'fleet_trip_rejected') return resource.status === 'rejected'
  if (type === 'fleet_trip_cancelled') return resource.status === 'cancelled'
  if (type === 'fleet_trip_departed') return resource.status === 'in_progress'
  if (type === 'fleet_trip_returned') return resource.status === 'completed'
  // ตรวจได้แค่สถานะปัจจุบัน ไม่รู้สถานะก่อนแก้ — "ซ่อมเสร็จ" บนรถที่ไม่เคยเข้าซ่อมจึงกันที่ฝั่ง DB ไม่ได้
  // ความเสียหายจำกัด: ต้องเป็นเจ้าหน้าที่ อปท. เดียวกัน และได้ครั้งเดียวต่อการแก้ข้อมูลรถ 1 ครั้ง (updated_at)
  if (type === 'fleet_vehicle_repair_started') return resource.status === 'under_repair'
  if (type === 'fleet_vehicle_repair_finished') return resource.status === 'active'
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
          // fleet_trips มี FK ไป departments 2 เส้น (department_id กับ dept_head_department_id)
          // embed ต้องระบุชื่อ FK ไม่งั้น PostgREST ตอบ 300 ambiguous แล้วแจ้งเตือนทุกชนิดของทริปพัง
          // ⚠️ waitlist_reasons มาจาก migration 20260913150000 — ห้าม deploy ไฟล์นี้ก่อน apply
          // ไม่งั้น select คอลัมน์ที่ยังไม่มี ทำให้แจ้งเตือนทุกชนิดของทริป (รวมจองแทนที่) พังทั้งหมด
          // profiles ก็มีหลาย FK (driver/requested_by/approved_by/created_by) ต้องระบุชื่อ FK ทุกเส้น
          ? 'id,municipality_id,status,approval_method,destination,reject_reason,planned_departure,planned_return,started_at,returned_at,odometer_start,odometer_end,distance_km,waitlist_reasons,vehicle:fleet_vehicles(name,license_plate,meter_unit),driver:profiles!fleet_trips_driver_id_fkey(full_name),requester:profiles!fleet_trips_requested_by_fkey(full_name),approver:profiles!fleet_trips_approved_by_fkey(full_name),department:departments!fleet_trips_department_id_fkey(name,color)'
          : spec.table === 'fleet_fuel_records'
            ? 'id,municipality_id,created_at,filled_at,liters,price_per_liter,total_cost,odometer,full_tank,fuel_type,fuel_other_name,fuel_station,receipt_no,vehicle:fleet_vehicles(name,license_plate,meter_unit,department:departments(name,color)),driver:profiles!fleet_fuel_records_driver_id_fkey(full_name)'
            : spec.table === 'fleet_vehicles'
              ? 'id,municipality_id,status,updated_at,name,license_plate,department:departments(name,color)'
              : spec.table === 'fleet_maintenance'
                ? 'id,municipality_id,created_at,service_date,maintenance_type,description,cost,vendor,odometer,next_service_meter,next_service_date,vehicle:fleet_vehicles(name,license_plate,meter_unit,department:departments(name,color))'
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
    // เรื่องลับ: แจ้งแค่ตอนมีใบใหม่ (ข้อความกลางๆ ใน buildComplaintCreatedMessage) การเปลี่ยนสถานะ
    // ไม่ส่งเข้ากลุ่มเลย — ความเคลื่อนไหวของเรื่องก็บอกคนในกลุ่มได้ว่ามีการสอบสวนอยู่
    if (spec.table === 'complaints' && notificationType !== 'complaint_created' && isConfidentialComplaint(resource)) {
      await finish('skipped', { last_error: 'confidential complaint category: status updates are not posted' })
      return json({ ok: true, skipped: true, reason: 'confidential' })
    }

    if (!municipality.telegram_group_id) {
      await finish('skipped', { last_error: 'telegram group is not configured for this municipality' })
      return json({ ok: true, skipped: true, reason: 'not_configured' })
    }
    if (!BOT_TOKEN) {
      await finish('failed', { last_error: 'TELEGRAM_BOT_TOKEN is not configured' })
      return json({ ok: false, error: 'Telegram bot is not configured' }, 500)
    }

    const feeSchedule = municipality.fee_schedule
    const fleetBuilder = FLEET_MESSAGE_BUILDERS[notificationType]
    const message = fleetBuilder
      ? fleetBuilder(resource)
      : notificationType === 'event_created'
      ? buildEventMessage(resource, municipality.org_type)
      : notificationType === 'complaint_created'
        ? buildComplaintCreatedMessage(resource)
        : notificationType === 'complaint_reopened'
          ? buildComplaintReopenedMessage(resource)
        : notificationType === 'complaint_status_updated' || notificationType.startsWith('technician_')
          ? buildComplaintStatusMessage(resource)
          : notificationType === 'fleet_trip_bumped'
            ? buildFleetTripBumpedMessage(resource)
            : notificationType === 'fleet_trip_waitlisted'
            ? buildFleetTripWaitlistedMessage(resource, await loadTripRuleMinutes(admin))
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
