// ทะเบียนผู้ลงนามกลางของ อปท. — ตาราง document_signatories เก็บได้ 1 แถวที่ active
// ต่อบทบาทต่อหน่วยงาน (บังคับด้วย document_signatories_one_active_scope_idx)
// ทุกเอกสารในระบบใช้ผู้ลงนามชุดเดียวกันนี้: แบบพิมพ์คำร้อง (prepare_complaint_print)
// และใบขออนุญาตใช้รถส่วนกลาง แบบ 3 (FleetTrips)
//
// ค่าคอลัมน์ document_type ยังเป็น 'complaint' ตามชื่อสมัยที่ผู้ลงนามใช้กับคำร้อง
// อย่างเดียว ไม่ใช่ตัวแยกประเภทเอกสารอีกต่อไป — ผูกไว้เป็นค่าคงที่ตัวเดียวตรงนี้
// เพื่อไม่ให้ magic string กระจายไปตามโมดูล ถ้าวันหนึ่งต้องแยกผู้ลงนามรายเอกสารจริง
// ต้องแก้ CHECK constraint + RPC set_document_signatory_v2 ที่ hardcode ค่านี้ไว้ด้วย
export const SIGNATORY_SCOPE = 'complaint'

// select ที่ join โปรไฟล์มาให้พร้อมพิมพ์ — ต้องระบุชื่อ FK ให้ชัดเพราะตารางนี้มี
// FK ไป profiles สองเส้น (profile_id กับ created_by) PostgREST จะเลือกไม่ถูกถ้าไม่ระบุ
export const SIGNATORY_WITH_PROFILE_SELECT =
  'manual_name,title_override,effective_from,effective_to,profile:profiles!document_signatories_profile_id_fkey(full_name,job_title,position:positions(name))'

// en-CA ให้รูปแบบ YYYY-MM-DD ตรงกับที่ Postgres รับพอดี และต้องอิงเวลาไทยเสมอ
// ไม่ใช่ timezone ของเครื่องผู้ใช้ เพราะฝั่ง DB เทียบกับ timezone('Asia/Bangkok', now())
export function todayBangkok() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}

// effective_from/effective_to เก็บเป็น date ไม่ใช่ timestamptz จึงเทียบเป็นสตริงได้ตรงๆ
// ⚠️ ต้องตัดแถวที่ปิดแล้ว (is_active = false) ด้วย — หน้าที่พิมพ์เอกสารเก่าโหลดแถวที่ปิดไปแล้วมาด้วย
// (ดู pickSignatory แบบมี at) และแถวที่ปิดแล้วไม่มีวันสิ้นสุดในคอลัมน์ effective_to ถ้าไม่ตัดตรงนี้
// คนเก่าจะโผล่ในตัวเลือกผู้ลงนามของเอกสารใหม่ · select ที่ไม่ได้ดึง is_active มา (undefined) ถือว่ายังใช้อยู่
export function isSignatoryActiveToday(row, today = todayBangkok()) {
  if (!row || row.is_active === false) return false
  return (!row.effective_from || row.effective_from <= today)
    && (!row.effective_to || row.effective_to >= today)
}

// select เต็มสำหรับ "ทั้งทะเบียน" — ต้องมี signatory_role กับ department_id ติดมาด้วย
// เพื่อจับคู่แถวกับช่องลงนามแต่ละช่องได้ฝั่ง client โดยไม่ต้องยิง query แยกรายช่อง
// is_active / created_at / updated_at ใช้หาผู้ลงนาม ณ เวลาของเอกสาร (pickSignatory แบบมี at)
export const SIGNATORY_REGISTRY_SELECT =
  `signatory_role,department_id,custom_label,is_vehicle_order_default,is_active,created_at,updated_at,${SIGNATORY_WITH_PROFILE_SELECT}`

// บทบาทของระบบ — ลบหรือเปลี่ยนชื่อไม่ได้เพราะ prepare_complaint_print resolve ผู้ลงนาม
// บนแบบพิมพ์คำร้องจากชื่อบทบาทเหล่านี้ตรงๆ ส่วนแถวที่แอดมินสร้างเองใช้ CUSTOM_ROLE
export const SYSTEM_SIGNATORY_ROLES = ['mayor', 'clerk', 'department_head']
export const CUSTOM_ROLE = 'custom'

// ชื่อแถวที่แสดงบนหน้าจอ — แถวที่แอดมินสร้างเองใช้ชื่อที่ตั้งไว้เอง
export function signatoryRowLabel(row, fallback = '') {
  return row?.signatory_role === CUSTOM_ROLE ? (row.custom_label?.trim() || fallback) : fallback
}

// เลือกแถวของบทบาท/กองที่ต้องการจากทะเบียนที่โหลดมาแล้ว
// departmentId = null คือผู้ลงนามระดับหน่วยงาน (นายก/ปลัด) ซึ่งเก็บ department_id เป็น NULL
//
// customLabel จำเป็นเฉพาะบทบาท custom ที่มีได้หลายแถวต่อ อปท. — เอกสารอ้างถึงแถวด้วยคู่
// (role, label) ไม่ใช่ id เพราะการเปลี่ยนตัวผู้ลงนามคือปิดแถวเก่าแล้วสร้างแถวใหม่ id จึงเปลี่ยน
//
// at = เวลาที่ใช้เลือกผู้ลงนาม (ISO) ได้จาก signatoryMoment() — เจ้าของระบบสั่ง 2569-10-06:
//   "เปลี่ยนตอนไหนก็ใช้ตั้งแต่ตอนนั้น อย่ายุ่งของเก่า ชื่อใครชื่อมัน" + "เรื่องที่ยังไม่เสร็จใช้ชื่อคนใหม่
//   เพราะคนเก่าออกไปแล้ว กลับมาลงชื่อไม่ได้" ⇒ เรื่องที่เสร็จแล้วล็อกชื่อคนที่ดำรงตำแหน่งตอนเสร็จ
//   เรื่องที่ยังไม่เสร็จ = คนที่ดำรงตำแหน่งตอนนี้ (คนที่จะเป็นผู้ลงนามจริง)
//   ไม่ส่ง = ผู้ลงนามที่มีผลวันนี้ (ตัวเลือกบนฟอร์มสร้างเอกสารใหม่ / รายงานที่ออกตอนกดพิมพ์)
//   ส่งมา = คนที่ดำรงตำแหน่งอยู่ ณ เวลานั้น — ผู้เรียกต้องโหลดทะเบียนมาทั้งแถวที่ปิดแล้ว (ห้ามกรอง is_active)
//   ไม่งั้นหาคนเก่าไม่เจอ และจะได้ชื่อปัจจุบันเหมือนเดิม
// ⚠️ กติกาเดียวกับ prepare_complaint_print ฝั่งฐานข้อมูล (ใบคำร้อง) แก้ที่หนึ่งต้องแก้อีกที่ให้ตรงกัน
//   tests/signatory-as-of-document.test.mjs ล็อกพฤติกรรมไว้
export function pickSignatory(rows, { role, departmentId = null, customLabel = null, at = null } = {}) {
  const slot = (rows ?? []).filter(row =>
    row.signatory_role === role
    && (row.department_id ?? null) === (departmentId ?? null)
    && (row.custom_label ?? null) === (customLabel ?? null))
  // ทะเบียนที่ไม่ได้ดึงเวลาบันทึกมาหาย้อนหลังไม่ได้ — ใช้ผู้ลงนามวันนี้แบบเดิม ดีกว่าเดา
  if (at == null || slot.some(row => !row.created_at)) {
    const today = todayBangkok()
    return slot.find(row => isSignatoryActiveToday(row, today)) ?? null
  }
  return signatoryAt(slot, at)
}

const timeOf = value => {
  const time = Date.parse(value ?? '')
  return Number.isFinite(time) ? time : null
}

const bangkokDate = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(time))

// เวลาที่แถวหมดผล — แถวที่ยังใช้อยู่ไม่มีเวลาหมด · แถวที่ปิดแล้วหมดเมื่อมีแถวใหม่มาแทนในช่องเดียวกัน
// หรือเมื่อถูกปิด (updated_at) แล้วแต่อันไหนก่อน — set_document_signatory_v4 ปิดแถวเก่าในธุรกรรมเดียวกับ
// ที่สร้างแถวใหม่ สองค่านี้จึงเท่ากันพอดี ที่ต้องดูทั้งคู่เพราะ updated_at ของแถวที่ปิดแล้วอาจถูกแตะทีหลัง
// (เช่น migration) ส่วนแถวที่ถูกลบออกเฉยๆ (clear_document_signatory_v2) ไม่มีแถวใหม่มาแทน จึงหมดที่ updated_at
function validUntil(row, slot) {
  if (row.is_active !== false) return Infinity
  const created = timeOf(row.created_at)
  let until = timeOf(row.updated_at) ?? Infinity
  for (const other of slot) {
    const next = timeOf(other.created_at)
    if (next !== null && next > created && next < until) until = next
  }
  return until
}

function signatoryAt(slot, at) {
  const moment = timeOf(at) ?? Date.now()
  const day = bangkokDate(moment)
  const byNewest = [...slot].sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at))
  const holder = byNewest.find(row =>
    timeOf(row.created_at) <= moment && moment < validUntil(row, slot)
    && (!row.effective_from || row.effective_from <= day)
    && (!row.effective_to || row.effective_to >= day))
  if (holder) return holder
  // เอกสารที่เกิดก่อนเริ่มตั้งทะเบียนช่องนี้ (ทะเบียนเริ่มใช้ 2569-08-30 แต่มีคำร้องก่อนหน้านั้น)
  // ใช้ผู้ลงนามคนแรกที่ตั้งไว้ — ใกล้ความจริงที่สุดที่ระบบรู้ และเป็นชื่อที่ใบเหล่านี้เคยพิมพ์ออกไป
  // ช่วงที่ลบผู้ลงนามออกแล้วยังไม่ได้ตั้งคนใหม่ = ไม่มีผู้ลงนาม (null) ใบจะเว้นเส้นประให้เขียนมือ
  const first = byNewest.at(-1)
  return first && moment < timeOf(first.created_at) ? first : null
}

// เวลาที่ใช้หาผู้ลงนาม (ค่า at ของ pickSignatory)
//   finishedAt   = เวลาที่เรื่องเสร็จ/ลงนามแล้ว (ปิดคำร้อง / อนุมัติ / บันทึกเลขหนังสือ) — ไม่มี = เรื่องยังไม่เสร็จ
//                  ⇒ ใช้ตอนนี้ (คนที่ดำรงตำแหน่งตอนนี้คือคนที่จะลงนามจริง คนเก่าที่ออกไปแล้วกลับมาเซ็นไม่ได้)
//   documentDate = วันที่ที่พิมพ์ในเอกสาร (YYYY-MM-DD) — เรื่องที่เสร็จแล้วแต่ลงวันที่ก่อนวันที่บันทึก
//                  (บันทึกย้อนหลัง / หนังสือลงวันที่ก่อนบันทึกเลข) ใช้สิ้นวันนั้นแทน เพราะลงนามกันจริงตามวันที่ในเอกสาร
//                  ใช้เฉพาะเรื่องที่เสร็จแล้ว ร่างที่ยังไม่ลงนามไม่ย้อนตามวันที่ที่พิมพ์ไว้
export function signatoryMoment({ finishedAt = null, documentDate = null } = {}) {
  const finished = timeOf(finishedAt)
  if (finished === null) return new Date().toISOString()
  let moment = finished
  if (/^\d{4}-\d{2}-\d{2}$/.test(documentDate ?? '')) {
    const endOfDay = timeOf(`${documentDate}T23:59:59.999+07:00`)
    if (endOfDay !== null && endOfDay < moment) moment = endOfDay
  }
  return new Date(moment).toISOString()
}

// แถวที่เลือกเป็น "ผู้ลงนามระดับหน่วยงาน" ได้ (ไม่ผูกกับกอง) เรียงให้แถวที่แอดมิน
// สร้างเองมาก่อน เพราะการสร้างแถวเองคือการตั้งใจแต่งตั้งเฉพาะเรื่อง
// แถวที่แอดมินติ๊กไว้ว่าเป็นผู้มีอำนาจสั่งใช้รถโดยปริยาย — ติ๊กได้แถวเดียวต่อ อปท.
// (บังคับด้วย partial unique index ฝั่ง DB) ไม่ติ๊กเลย = ใบขออนุญาตใช้รถถอยไปใช้นายก
export function defaultVehicleAuthority(rows) {
  const today = todayBangkok()
  return (rows ?? []).find(row =>
    row.is_vehicle_order_default && isSignatoryActiveToday(row, today)) ?? null
}

export function organizationSignatories(rows) {
  const today = todayBangkok()
  return (rows ?? [])
    .filter(row => row.signatory_role !== 'department_head' && isSignatoryActiveToday(row, today))
}

// ชื่อที่จะพิมพ์ — ผู้ลงนามที่ไม่มีบัญชีในระบบเก็บชื่อไว้ที่ manual_name
export function signatoryName(row) {
  return row?.manual_name?.trim() || row?.profile?.full_name?.trim() || ''
}

// ตำแหน่งที่จะพิมพ์ — title_override ทับได้เสมอ (ใช้ระบุ "รักษาราชการแทน...")
// ถัดมาคือตำแหน่งในโปรไฟล์ แล้วจึงชื่อตำแหน่งตามผังตำแหน่ง
export function signatoryTitle(row) {
  return row?.title_override?.trim()
    || row?.profile?.job_title?.trim()
    || row?.profile?.position?.name?.trim()
    || ''
}
