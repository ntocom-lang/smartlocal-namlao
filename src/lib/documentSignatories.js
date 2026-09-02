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
export function isSignatoryActiveToday(row, today = todayBangkok()) {
  if (!row) return false
  return (!row.effective_from || row.effective_from <= today)
    && (!row.effective_to || row.effective_to >= today)
}

// select เต็มสำหรับ "ทั้งทะเบียน" — ต้องมี signatory_role กับ department_id ติดมาด้วย
// เพื่อจับคู่แถวกับช่องลงนามแต่ละช่องได้ฝั่ง client โดยไม่ต้องยิง query แยกรายช่อง
export const SIGNATORY_REGISTRY_SELECT =
  `signatory_role,department_id,custom_label,is_vehicle_order_default,${SIGNATORY_WITH_PROFILE_SELECT}`

// บทบาทของระบบ — ลบหรือเปลี่ยนชื่อไม่ได้เพราะ prepare_complaint_print resolve ผู้ลงนาม
// บนแบบพิมพ์คำร้องจากชื่อบทบาทเหล่านี้ตรงๆ ส่วนแถวที่แอดมินสร้างเองใช้ CUSTOM_ROLE
export const SYSTEM_SIGNATORY_ROLES = ['mayor', 'clerk', 'department_head']
export const CUSTOM_ROLE = 'custom'

// ชื่อแถวที่แสดงบนหน้าจอ — แถวที่แอดมินสร้างเองใช้ชื่อที่ตั้งไว้เอง
export function signatoryRowLabel(row, fallback = '') {
  return row?.signatory_role === CUSTOM_ROLE ? (row.custom_label?.trim() || fallback) : fallback
}

// เลือกแถวของบทบาท/กองที่ต้องการจากทะเบียนที่โหลดมาแล้ว และต้องมีผลวันนี้ด้วย
// departmentId = null คือผู้ลงนามระดับหน่วยงาน (นายก/ปลัด) ซึ่งเก็บ department_id เป็น NULL
//
// customLabel จำเป็นเฉพาะบทบาท custom ที่มีได้หลายแถวต่อ อปท. — เอกสารอ้างถึงแถวด้วยคู่
// (role, label) ไม่ใช่ id เพราะการเปลี่ยนตัวผู้ลงนามคือปิดแถวเก่าแล้วสร้างแถวใหม่ id จึงเปลี่ยน
export function pickSignatory(rows, { role, departmentId = null, customLabel = null } = {}) {
  const today = todayBangkok()
  return (rows ?? []).find(row =>
    row.signatory_role === role
    && (row.department_id ?? null) === (departmentId ?? null)
    && (row.custom_label ?? null) === (customLabel ?? null)
    && isSignatoryActiveToday(row, today)) ?? null
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
