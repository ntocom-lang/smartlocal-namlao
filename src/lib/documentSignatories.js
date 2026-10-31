// ทะเบียนผู้ลงนามกลางของ อปท. — ตาราง document_signatories เก็บได้ 1 แถวที่ active
// ต่อบทบาทต่อหน่วยงาน (บังคับด้วย document_signatories_one_active_scope_idx)
// ทุกเอกสารในระบบใช้ผู้ลงนามชุดเดียวกันนี้: แบบพิมพ์คำร้อง (prepare_complaint_print)
// และใบขออนุญาตใช้รถส่วนกลาง แบบ 3 (FleetTrips)
//
// ค่าคอลัมน์ document_type ยังเป็น 'complaint' ตามชื่อสมัยที่ผู้ลงนามใช้กับคำร้อง
// อย่างเดียว ไม่ใช่ตัวแยกประเภทเอกสารอีกต่อไป — ผูกไว้เป็นค่าคงที่ตัวเดียวตรงนี้
// เพื่อไม่ให้ magic string กระจายไปตามโมดูล ถ้าวันหนึ่งต้องแยกผู้ลงนามรายเอกสารจริง
// ต้องแก้ CHECK constraint + RPC set_document_signatory_v2 ที่ hardcode ค่านี้ไว้ด้วย
import { isDepartmentHeadPosition } from './personnelStructure.js'
import { splitThaiFullName } from './thaiName.js'

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

// วันที่มีผลย้อนหลังได้ไม่เกินกี่วัน — เจ้าของระบบเลือก 2569-10-07 (set_document_signatory_v4 บังคับซ้ำฝั่ง DB)
export const SIGNATORY_BACKDATE_LIMIT_DAYS = 30

// วันแรกที่เลือกเป็นวันมีผลได้ (YYYY-MM-DD) — นับจากวันนี้ตามเวลาไทยย้อนไป SIGNATORY_BACKDATE_LIMIT_DAYS วัน
export function earliestEffectiveFrom(today = todayBangkok()) {
  const midnight = Date.parse(`${today}T00:00:00+07:00`)
  return bangkokDate(midnight - SIGNATORY_BACKDATE_LIMIT_DAYS * 86_400_000)
}

// ช่อง "มีผลตั้งแต่" บนหน้าตั้งผู้ลงนาม (SignatorySettings)
//   savedFrom = effective_from ของแถวที่บันทึกไว้ (ยังไม่เคยตั้ง = null)
//   changed   = แก้ตัวคน/ตำแหน่ง/เครื่องหมายสั่งใช้รถไปจากที่บันทึกไว้ (ยังไม่เคยตั้ง = true)
//   picked    = วันที่แอดมินเลือกเองในช่อง ('' = ยังไม่ได้แตะ)
// value     = วันที่แสดงในช่อง — ยังไม่แก้อะไร = วันที่บันทึกไว้ (เจ้าของระบบแจ้ง 2569-10-07: บันทึกแล้วช่องเด้งกลับเป็น
//             วันนี้ ดูเหมือนบันทึกไม่ติด) · แก้ตัวคน/ตำแหน่งแล้ว = วันนี้ ไม่พาวันของคนเก่าติดไป (เช่น 30 ส.ค. เกินด่าน 30 วัน
//             หรือไปกลบช่วงของคนเก่าจนชื่อหายจากเอกสาร)
// dirty     = มีอะไรต่างจากที่บันทึกไว้ — บันทึกทุกครั้งคือปิดแถวเดิมสร้างแถวใหม่ ไม่ได้แก้อะไรจึงไม่ให้บันทึก
// backdated = กำลังบันทึกย้อนหลัง (ต้องเตือน/ยืนยัน/ส่งวันที่ให้ DB) — แถวที่ตั้งย้อนหลังไว้แล้วไม่นับ
export function effectiveDateForForm({ savedFrom = null, changed, picked = '', today = todayBangkok() }) {
  const saved = savedFrom ?? today
  const value = picked || (changed ? today : saved)
  const dirty = Boolean(changed) || value !== saved
  return { value, dirty, backdated: dirty && value < today }
}

// เวลาที่แถวเริ่มมีผล — ปกติคือ created_at (เวลาที่แอดมินกดตั้ง ละเอียดถึงวินาที)
// ถ้าแอดมินระบุวันมีผลย้อนหลัง (effective_from ก่อนวันที่กดตั้ง) เริ่มที่ 00:00 น. ของวันนั้นตามเวลาไทย
// เจ้าของระบบสั่ง 2569-10-07: ปลัดน้ำเลาคนใหม่เริ่มลงนามตั้งแต่ 5 ต.ค. แต่ตั้งในระบบ 6 ต.ค. 08:54
// เอกสารที่เสร็จระหว่างนั้นจึงยังได้ชื่อคนเก่า — คนเก่าออกไปแล้ว คนที่ลงนามจริงคือคนใหม่
// แถวที่ไม่ได้ระบุวันย้อนหลัง effective_from = วันที่กดตั้งพอดี (ค่าเริ่มต้นของ RPC) จึงได้ created_at เหมือนเดิม
// ⚠️ กติกาเดียวกับ starts_at ใน prepare_complaint_print (migration 20261007120000) แก้ที่หนึ่งต้องแก้อีกที่
function startsAt(row) {
  const created = timeOf(row.created_at)
  if (created !== null && row.effective_from && row.effective_from < bangkokDate(created)) {
    return timeOf(`${row.effective_from}T00:00:00+07:00`) ?? created
  }
  return created
}

// เวลาที่แถวหมดผล — แถวที่ยังใช้อยู่ไม่มีเวลาหมด · แถวที่ปิดแล้วหมดเมื่อแถวที่ตั้งทีหลังในช่องเดียวกันเริ่มมีผล
// หรือเมื่อถูกปิด (updated_at) แล้วแต่อันไหนก่อน — set_document_signatory_v4 ปิดแถวเก่าในธุรกรรมเดียวกับ
// ที่สร้างแถวใหม่ สองค่านี้จึงเท่ากันพอดี ที่ต้องดูทั้งคู่เพราะ updated_at ของแถวที่ปิดแล้วอาจถูกแตะทีหลัง
// (เช่น migration) ส่วนแถวที่ถูกลบออกเฉยๆ (clear_document_signatory_v2) ไม่มีแถวใหม่มาแทน จึงหมดที่ updated_at
// แถวที่ตั้งทีหลังแต่มีผลย้อนหลัง ตัดช่วงของแถวเก่าให้จบที่วันมีผลนั้น ไม่ใช่เวลาที่กดตั้ง
function validUntil(row, slot) {
  if (row.is_active !== false) return Infinity
  const created = timeOf(row.created_at)
  let until = timeOf(row.updated_at) ?? Infinity
  for (const other of slot) {
    const next = startsAt(other)
    if (next !== null && timeOf(other.created_at) > created && next < until) until = next
  }
  return until
}

function signatoryAt(slot, at) {
  const moment = timeOf(at) ?? Date.now()
  const day = bangkokDate(moment)
  const byNewest = [...slot].sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at))
  const holder = byNewest.find(row =>
    startsAt(row) <= moment && moment < validUntil(row, slot)
    && (!row.effective_from || row.effective_from <= day)
    && (!row.effective_to || row.effective_to >= day))
  if (holder) return holder
  // เอกสารที่เกิดก่อนเริ่มตั้งทะเบียนช่องนี้ (ทะเบียนเริ่มใช้ 2569-08-30 แต่มีคำร้องก่อนหน้านั้น)
  // ใช้ผู้ลงนามคนแรกที่ตั้งไว้ — ใกล้ความจริงที่สุดที่ระบบรู้ และเป็นชื่อที่ใบเหล่านี้เคยพิมพ์ออกไป
  // ช่วงที่ลบผู้ลงนามออกแล้วยังไม่ได้ตั้งคนใหม่ = ไม่มีผู้ลงนาม (null) ใบจะเว้นเส้นประให้เขียนมือ
  // "คนแรก" = แถวที่เริ่มมีผลเร็วที่สุด (เริ่มพร้อมกัน = แถวที่ตั้งทีหลัง ตรงกับ ORDER BY ฝั่ง SQL)
  const first = [...slot].sort((a, b) => startsAt(a) - startsAt(b) || timeOf(b.created_at) - timeOf(a.created_at))[0]
  return first && moment < startsAt(first) ? first : null
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

// จัดบุคลากรเป็นกลุ่มตามกอง สำหรับ <optgroup> ของช่อง "เลือกจากบุคลากร" ในทะเบียนผู้ลงนาม
// (เดิมเทรวมเป็นรายการเดียวเรียงตามชื่อ — อปท. ที่มีบุคลากรหลายสิบคนหาไม่เจอว่าใครอยู่กองไหน)
// - กองเรียงตามลำดับที่ส่งมา (ทะเบียนกองเรียง sort_order อยู่แล้ว) ส่วนคนในกองคงลำดับเดิมของ people
// - firstDepartmentId ขึ้นก่อนสุด: แถวหัวหน้ากองเลือกจากกองของตัวเองบ่อยที่สุด
// - คนที่สังกัดกองที่ปิดใช้แล้ว (ไม่อยู่ใน departments) ได้กลุ่มชื่อกองเดิมต่อท้าย ไม่หายจากรายการ
// - คนที่ไม่มีกองอยู่กลุ่ม "ไม่ระบุกอง" ท้ายสุด · กลุ่มว่างไม่คืนมา
export const NO_DEPARTMENT_LABEL = 'ไม่ระบุกอง'

// กอง "ผู้บริหาร" (นายก/รองนายก/เลขานุการ)
// กติกาเดียวกับที่ trigger สีของกองใช้ (migration 20260913100100): รหัส exec หรือชื่อมีคำว่า "ผู้บริหาร"
// เพราะกองที่ผู้ดูแลสร้างเองมีรหัสสุ่ม (เช่น ทุ่งแค้ว "คณะผู้บริหารท้องถิ่น" = dept_mt5uixc4) ดูรหัสอย่างเดียวไม่พอ
export function isExecutiveDepartment(department) {
  return department?.code === 'exec' || /ผู้บริหาร/.test(department?.name ?? '')
}

// แถว "หัวหน้ากอง" ของกองผู้บริหารในทะเบียนผู้ลงนาม: แสดงทุก อปท. แบบ "ไม่บังคับ"
// - ไม่บังคับ = ไม่ถูกนับเป็น "ขาด n ตำแหน่ง" (ผู้มีอำนาจของใบคือแถว "นายก" ไม่ใช่แถวนี้)
// - แต่ต้องตั้งได้เสมอ: แถวนี้คือตัวเลือก "ผู้อำนวยการกอง" ของคนในกองผู้บริหารบนใบขอใช้รถ และเป็นผู้ลงนามช่อง
//   dept_head ของลงนามออนไลน์เมื่อทริปนั้นชี้มาที่กองนี้ (esign_expected_signer) ถ้าซ่อนไว้ ผู้ดูแลจะแก้เองไม่ได้
// - ไม่ใช่แถวเดียวกับ "นายก" แม้ตัวคนเป็นคนเดียวกัน — ข้อความคำอธิบายบอกให้ชัดเพื่อไม่ให้ต้องถามซ้ำ
export const EXECUTIVE_SLOT_EMPTY_LABEL = 'ไม่ได้ตั้ง (ไม่บังคับ)'
export const EXECUTIVE_SLOT_HINT =
  'กองผู้บริหาร — ไม่บังคับ ใช้เป็นตัวเลือก “ผู้อำนวยการกอง” ของคนในกองนี้บนใบขอใช้รถ (คนละช่องกับแถว “นายก”)'

export function departmentSlotMeta(department) {
  if (!isExecutiveDepartment(department)) return {}
  return { optional: true, emptyLabel: EXECUTIVE_SLOT_EMPTY_LABEL, hint: EXECUTIVE_SLOT_HINT }
}

export function groupPeopleByDepartment(people, departments, firstDepartmentId = null) {
  const groups = new Map((departments ?? []).map(department =>
    [department.id, { key: department.id, label: department.name, people: [] }]))
  const retired = new Map()
  const unassigned = { key: 'none', label: NO_DEPARTMENT_LABEL, people: [] }
  for (const person of people ?? []) {
    const id = person?.department_id
    if (!id) unassigned.people.push(person)
    else if (groups.has(id)) groups.get(id).people.push(person)
    else {
      if (!retired.has(id)) retired.set(id, { key: id, label: person.department?.name || NO_DEPARTMENT_LABEL, people: [] })
      retired.get(id).people.push(person)
    }
  }
  const ordered = [...groups.values(), ...retired.values(), unassigned].filter(group => group.people.length > 0)
  const first = firstDepartmentId ? ordered.findIndex(group => group.key === firstDepartmentId) : -1
  if (first > 0) ordered.unshift(...ordered.splice(first, 1))
  return ordered
}

// ── เสนอผู้ลงนามจากการแต่งตั้ง (เจ้าของระบบอนุมัติ 2569-10-30) ─────────────────────────────
// หน้าแต่งตั้งกับทะเบียนผู้ลงนามเก็บ "ใครเป็นนายก/ปลัด/หัวหน้ากอง" ซ้ำสองที่ เปลี่ยนตัวคนทีต้องแก้สองรอบ
// (น้ำเลา 2569-10-30: 7/9 ช่องเป็น "กรอกชื่อเอง" ทั้งที่ 3 ช่องมีบัญชีที่แต่งตั้งตรงตำแหน่งอยู่แล้ว)
// ระบบจึงเสนอชื่อจากการแต่งตั้งให้ แต่ไม่บันทึกเอง — เปลี่ยนผู้ลงนาม = ชื่อบนเรื่องค้างทุกเรื่องเปลี่ยนตาม
// และอำนาจลงนามต้องให้ผู้ดูแลยืนยัน (เส้นที่ห้ามทำอัตโนมัติใน docs/ai/DOMAIN.md)
// กฎตรงไปตรงมา ตรวจย้อนได้ ไม่ใช้ AI:
//   กอง      = คนในกองนั้นที่ถือตำแหน่งหัวหน้าหน่วยงาน (ไม่นับรอง/ผู้ช่วย)
//   นายก     = ตำแหน่ง (ทำเนียบ) ขึ้นต้นด้วย "นายก" ไม่รวมนายกรัฐมนตรี — รองนายกขึ้นต้นคำอื่นจึงไม่นับ
//   ปลัด      = ตำแหน่งขึ้นต้นด้วย "ปลัด" — รองปลัด/ผู้ช่วยปลัดขึ้นต้นคำอื่นจึงไม่นับ
//   เจอคนเดียว = เสนอ · ไม่เจอหรือเจอหลายคน = ไม่เดา
// "เป็นหัวหน้ากอง" กับ "เป็นผู้ลงนาม" คนละเรื่อง (เจ้าของระบบสั่ง 2569-10-31): ใบพิมพ์และลงนามออนไลน์อ่านทะเบียนนี้ ไม่เคยอ่าน is_dept_head
// ติ๊กหัวหน้าอย่างเดียวจึงไม่ทำให้ถูกเสนอเป็นผู้ลงนาม และเอาติ๊กออกก็ไม่ทำให้หลุดจากข้อเสนอ · ตำแหน่งอื่นเป็นผู้ลงนามได้โดยแอดมินเลือกเอง
export const APPOINTED_MAYOR_PATTERN = /^นายก(?!รัฐมนตรี)/
export const APPOINTED_CLERK_PATTERN = /^ปลัด/

// people จากหน้าทะเบียนมี position.name ส่วนผู้ใช้จาก get_users_with_email มี position_name
function appointedPositionName(person) {
  return String(person?.position?.name ?? person?.position_name ?? '').trim()
}

// ช่องผู้ลงนามที่ตำแหน่งของคนนี้ชี้ไป — ใช้ทั้งหน้าทะเบียน (เสนอชื่อ) และหน้าแต่งตั้งรายคน (เตือนว่ายังไม่ได้ตั้ง)
// ตำแหน่งแบบมาตรฐานบางชื่อรู้ว่าเป็นหัวหน้าจากหมวดเท่านั้น ผู้เรียกจึงควรส่ง position ที่มี category ถ้ามี
export function appointedSignatorySlots(person) {
  const position = appointedPositionName(person)
  const slots = []
  if (APPOINTED_MAYOR_PATTERN.test(position)) slots.push({ role: 'mayor', departmentId: null })
  if (APPOINTED_CLERK_PATTERN.test(position)) slots.push({ role: 'clerk', departmentId: null })
  const headPosition = isDepartmentHeadPosition({ name: position, category: person?.position?.category })
  if (headPosition && person?.department_id) slots.push({ role: 'department_head', departmentId: person.department_id })
  return slots
}

// คนที่การแต่งตั้งระบุให้เป็นผู้ลงนามช่องนี้ · แถวที่แอดมินสร้างเอง (custom) ไม่มีในการแต่งตั้ง จึงไม่เสนอ
// มีผู้ถือตำแหน่งหลายคน (คนเก่ายังไม่ได้เปลี่ยนตำแหน่ง) ถ้าติ๊กหัวหน้าไว้คนเดียวใช้คนนั้น เพราะเป็นข้อมูลเดียวที่แอดมินบอกไว้ว่าใครคือตัวจริง
export function appointmentSuggestion(slot, people) {
  if (!slot || !SYSTEM_SIGNATORY_ROLES.includes(slot.role)) return { status: 'none' }
  const matches = (people ?? []).filter(person => appointedSignatorySlots(person).some(appointed =>
    appointed.role === slot.role && (appointed.departmentId ?? null) === (slot.departmentId ?? null)))
  const ticked = slot.role === 'department_head' ? matches.filter(person => person.is_dept_head) : []
  const pool = ticked.length > 0 ? ticked : matches
  if (pool.length === 1) return { status: 'one', person: pool[0] }
  return pool.length > 1 ? { status: 'many', count: pool.length, people: pool } : { status: 'none' }
}

// ── เปลี่ยนผู้ลงนามตามการแต่งตั้ง (กล่องยืนยัน + แท็บการแต่งตั้ง) ────────────────────────────────
// ตัวระบุช่อง — รูปแบบเดียวกับที่หน้าทะเบียนใช้จับคู่แถว ต้องรวม customLabel เพราะบทบาท custom มีได้หลายแถวต่อ อปท.
export function signatorySlotKey({ role, departmentId = null, customLabel = null }) {
  return `${role}:${departmentId ?? 'organization'}:${customLabel ?? ''}`
}

export function isSameSignatorySlot(row, slot) {
  return row?.signatory_role === slot.role
    && (row?.department_id ?? null) === (slot.departmentId ?? null)
    && (row?.custom_label ?? null) === (slot.customLabel ?? null)
}

// ชื่อช่องลงนามสำหรับแสดงผล — ห้ามเติม "หัวหน้า" หน้าชื่อกอง (บาง อปท. ไม่มีตำแหน่งหัวหน้าหน่วยตรวจสอบภายใน)
export function signatorySlotLabel(slot, departments) {
  if (slot.role === 'mayor') return 'นายก'
  if (slot.role === 'clerk') return 'ปลัด'
  if (slot.role === 'department_head') {
    return (departments ?? []).find(department => department.id === slot.departmentId)?.name ?? 'กองที่ปิดใช้แล้ว'
  }
  return slot.customLabel || 'ผู้ลงนามที่เพิ่มเอง'
}

// รายการช่องลงนามทั้งหมดของ อปท. — หน้าผู้ลงนาม แถบสถานะในหน้าจัดการผู้ใช้ และฟอร์มเจ้าหน้าที่ใช้ชุดเดียวกัน
// draftLabels = แถวที่แอดมินเพิ่งตั้งชื่อแต่ยังไม่ได้บันทึก
export function buildSignatorySlots(departments, rows, draftLabels = []) {
  return [
    { key: signatorySlotKey({ role: 'mayor' }), role: 'mayor', departmentId: null, label: 'นายก' },
    { key: signatorySlotKey({ role: 'clerk' }), role: 'clerk', departmentId: null, label: 'ปลัด' },
    // ทุกกองมีแถวหัวหน้ากอง · กองผู้บริหารเป็นแบบไม่บังคับ + มีคำอธิบาย (ดู departmentSlotMeta)
    ...(departments ?? []).map(department => ({
      key: signatorySlotKey({ role: 'department_head', departmentId: department.id }),
      role: 'department_head',
      departmentId: department.id,
      departmentName: department.name,
      ...departmentSlotMeta(department),
      // ใช้ชื่อกองตรงๆ ห้ามเติมคำว่า "หัวหน้า" นำหน้า — หน่วยงานอย่าง "ตรวจสอบภายใน"
      // ส่วนใหญ่ขึ้นตรงกับปลัดและไม่มีตำแหน่งหัวหน้า ป้ายที่เติมเองจึงผิดกับ อปท. จำนวนมาก
      // ผลพลอยได้: ข้อความนี้กลายเป็นข้อมูล ไม่ใช่โค้ด ผู้ดูแลแก้เองได้ที่หน้าจัดการกอง/ส่วนราชการ
      label: department.name,
    })),
    // แถวที่แอดมินสร้างเอง — มาจากข้อมูลในทะเบียน ไม่ใช่รายการตายตัวในโค้ด
    ...[...new Set([
      ...(rows ?? []).filter(row => row.signatory_role === CUSTOM_ROLE).map(row => row.custom_label),
      ...draftLabels,
    ])].filter(Boolean).map(customLabel => ({
      key: signatorySlotKey({ role: CUSTOM_ROLE, customLabel }),
      role: CUSTOM_ROLE,
      departmentId: null,
      customLabel,
      label: customLabel,
      optional: true,
      removable: true,
      hint: 'เพิ่มเอง · ใช้กับใบขออนุญาตใช้รถเท่านั้น',
    })),
  ]
}

// ผลของการเปลี่ยนผู้ลงนาม — กติกาเจ้าของระบบ 2569-10-06 ต้องเห็นก่อนกดยืนยันทุกจุด (signatoryMoment / pickSignatory)
export const SIGNING_EFFECT_TEXT = 'เรื่องที่ยังไม่เสร็จจะพิมพ์ชื่อใหม่ทันที · เรื่องที่เสร็จแล้วคงชื่อเดิม'

// เทียบชื่อคนโดยไม่นับคำนำหน้าและช่องว่าง — ชื่อที่พิมพ์เองมักมีหรือไม่มีคำนำหน้าต่างจากบัญชี ("นายสมชาย ใจดี" กับ "สมชาย ใจดี")
const compactName = (value) => {
  const { first, last } = splitThaiFullName(value)
  return `${first}${last}`.replace(/\s+/g, '')
}

// สิ่งที่จะเกิดขึ้นถ้าตั้ง person เป็นผู้ลงนามช่องนี้ — แสดงในกล่องยืนยันให้แอดมินเห็นชื่อเดิม → ชื่อใหม่ก่อนกด
//   assignment ต้องมี profile ติดมาด้วย (fetchActiveSignatories) จึงจะรู้ชื่อเดิมของแถวที่ผูกบัญชี
//   sameName = คนเดิมที่เคยพิมพ์ชื่อเอง การเปลี่ยนครั้งนี้แค่ผูกบัญชี ชื่อบนเอกสารไม่เปลี่ยนคน
//   defaultChecked = ติ๊กให้เฉพาะช่องว่าง หรือคนเดียวกันที่แค่ผูกบัญชี · ชื่อคนละคน (แม้พิมพ์เอง) หรือตั้งผู้แทนไว้ แอดมินต้องตัดสินเอง
//     เพราะกดยืนยันครั้งเดียวจะเปลี่ยนชื่อคนบนเรื่องค้างทุกเรื่อง (ลองกับสนามซ้อม 2569-10-31: ชื่อที่พิมพ์ไว้ 3 ช่องเป็นคนละคนกับบัญชี)
//   vehicleDefault = ค่าเดิมของแถว ต้องส่งกลับตอนบันทึก ไม่งั้นเครื่องหมายผู้มีอำนาจสั่งใช้รถหายไปกับการเปลี่ยนคน
export function signatoryChangeFor(slot, assignment, person) {
  const currentName = signatoryName(assignment)
  const name = person?.full_name?.trim() ?? ''
  const manual = Boolean(assignment?.manual_name?.trim())
  const sameName = Boolean(assignment) && compactName(currentName) === compactName(name)
  return {
    key: signatorySlotKey(slot),
    slot: { role: slot.role, departmentId: slot.departmentId ?? null, customLabel: slot.customLabel ?? null },
    label: slot.label,
    person: {
      id: person?.id,
      name,
      // ลำดับเดียวกับ signatoryTitle ที่ใบพิมพ์ใช้ แถวใหม่ไม่มี title_override จึงเริ่มที่ job_title
      title: person?.job_title?.trim() || appointedPositionName(person),
    },
    appointedTitle: appointedPositionName(person),
    current: assignment ? { name: currentName, title: signatoryTitle(assignment), manual } : null,
    sameName,
    vehicleDefault: Boolean(assignment?.is_vehicle_order_default),
    defaultChecked: !assignment || (manual && sameName && !isActingSignatory(assignment)),
  }
}

// ช่องที่ต้องถามว่า "ตั้งเป็นผู้ลงนามด้วยไหม" ตอนบันทึกการแต่งตั้ง: เฉพาะช่องที่ตำแหน่งเพิ่งเปลี่ยนมาหาคนนี้ และยังไม่ใช่คนนี้
// แก้เบอร์โทรหรือข้อมูลอื่นจึงไม่ถาม — ไม่งั้นบันทึกครั้งเดียวอาจทับผู้รักษาราชการแทนโดยไม่ตั้งใจ
// before กับ after ต้องรู้หมวดตำแหน่งเท่ากัน ไม่งั้นตำแหน่งเดิมที่นับจากหมวดจะดูเหมือนเพิ่งเปลี่ยน แล้วถามทุกครั้งที่แก้อะไรก็ตาม
export function newlyAppointedSlots(before, after, rows, personId) {
  const had = new Set(appointedSignatorySlots(before).map(signatorySlotKey))
  return appointedSignatorySlots(after)
    .filter(slot => !had.has(signatorySlotKey(slot)))
    .filter(slot => !(rows ?? []).some(row => isSameSignatorySlot(row, slot) && row.profile_id === personId))
}

// ตำแหน่งที่พิมพ์มีคำว่า "แทน" (รักษาราชการแทน / ปฏิบัติราชการแทน) = ตั้งใจให้ต่างจากการแต่งตั้ง ไม่ต้องเสนอ
export function isActingSignatory(row) {
  return /แทน/.test(row?.title_override ?? '')
}

// แถวในส่วน "การลงนามเอกสาร" ของฟอร์มเจ้าหน้าที่ — ทุกตำแหน่งเลือกช่องลงนามได้ ไม่ขึ้นกับติ๊กหัวหน้ากอง (เจ้าของระบบสั่ง 2569-10-31)
//   held     = ช่องที่คนนี้ลงนามอยู่ · เอาติ๊กออก = เอาชื่อออกจากช่อง
//   proposed = ช่องที่ตำแหน่งชี้มา · newly = ตำแหน่งเพิ่งเปลี่ยนมา
//   picked   = แอดมินเลือกเอง (key จาก extraKeys)
//   matches  = ตำแหน่งตรงกับช่องนี้ · ไม่ตรงให้ฟอร์มเตือนตรวจคำสั่งมอบอำนาจ
// ติ๊กให้ก่อนเฉพาะช่องที่ถืออยู่และช่องที่ตำแหน่งเพิ่งเปลี่ยนมา (ยกเว้นตั้งผู้แทนไว้) แก้เบอร์โทรจึงไม่เขียนทับใคร
// ช่องที่ตำแหน่งชี้มาแต่ไม่ได้เพิ่งเปลี่ยน ขึ้นให้เห็นแบบยังไม่ติ๊ก · ช่องที่ตั้งผู้แทนไว้ถือว่าตั้งใจ จึงไม่ขึ้น
export function personSigningRows({ personId, before, after, rows, slots, extraKeys = [], choices = {} }) {
  const active = rows ?? []
  const rowFor = slot => active.find(row => isSameSignatorySlot(row, slot))
  const proposedKeys = new Set(appointedSignatorySlots(after).map(signatorySlotKey))
  const newlyKeys = new Set(newlyAppointedSlots(before, after, active, personId).map(signatorySlotKey))
  return (slots ?? []).flatMap(slot => {
    const key = signatorySlotKey(slot)
    const assignment = rowFor(slot)
    const held = Boolean(personId) && assignment?.profile_id === personId
    const proposed = proposedKeys.has(key)
    const newly = newlyKeys.has(key)
    const picked = extraKeys.includes(key)
    const hiddenActing = proposed && !newly && !held && !picked && isActingSignatory(assignment)
    if (hiddenActing || !(held || proposed || picked)) return []
    const defaultChecked = held || picked || (newly && !isActingSignatory(assignment))
    return [{
      key, slot, assignment, held, proposed, newly, picked,
      matches: proposed || slot.role === CUSTOM_ROLE,
      checked: choices[key] ?? defaultChecked,
    }]
  }).sort((a, b) => Number(b.held) - Number(a.held))
}

// เทียบทะเบียนกับการแต่งตั้งของช่องหนึ่ง
//   match    = ทะเบียนเลือกบัญชีเดียวกับการแต่งตั้งแล้ว
//   empty / manual / differs = ควรเสนอชื่อ (ยังไม่ตั้ง / กรอกชื่อเอง / เลือกคนอื่นไว้)
//   acting   = รักษาราชการแทนอยู่ ไม่เสนอ · ambiguous = การแต่งตั้งมีหลายคน · none = การแต่งตั้งไม่ระบุใคร
export const SUGGESTABLE_KINDS = ['empty', 'manual', 'differs']
export function signatorySuggestionState(assignment, suggestion) {
  if (suggestion?.status === 'many') return { kind: 'ambiguous', count: suggestion.count, people: suggestion.people ?? [] }
  if (suggestion?.status !== 'one') return { kind: 'none' }
  const person = suggestion.person
  if (assignment?.profile_id && assignment.profile_id === person.id) return { kind: 'match', person }
  if (!assignment) return { kind: 'empty', person }
  if (isActingSignatory(assignment)) return { kind: 'acting', person }
  return { kind: assignment.manual_name?.trim() ? 'manual' : 'differs', person }
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
