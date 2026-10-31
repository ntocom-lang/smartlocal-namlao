// ลงนามออนไลน์รายเรื่อง — ตัวช่วยฝั่งหน้าจอ
// ฐานข้อมูล: supabase/migrations/20261022100000_esign_columns.sql, ..100100_esign_tables.sql, ..100200_esign_functions.sql
//   + ชุด B1.5 (ประกาศไม่เป็นเงื่อนไขเปิดใช้): ..110000_esign_policy_optional.sql, ..110100_esign_gate_relax_functions.sql
//   + เฟส 2 (ถอดด่านทดลอง + ช่องที่ผู้ลงนามไม่พร้อมตกเป็นเซ็นสด): 20261031100000_esign_fallback_column.sql, ..100100_esign_fallback_functions.sql
// ออกแบบ: หน้า "ลงนามออนไลน์รายเรื่อง" (ตัวบทที่ตรวจแล้วอยู่ในหัวข้อ 2 ของหน้านั้น) · ความจำ project_esign_per_doctype_design

export const ESIGN_DOC_FLEET = 'fleet_trip_request'

// ช่องลงนามของใบขออนุญาตใช้ยานพาหนะ (แบบ ๓ + บันทึกรับรอง สก.๑) — ลำดับตรงกับ esign_trip_status ฝั่ง DB
// ช่อง "ผู้ขับรถ" ไม่อยู่ในระบบ เพราะกำหนดคนขับทีหลังการขอ จึงเซ็นสดต่อไป
export const ESIGN_FLEET_SLOTS = [
  { key: 'requester', label: 'ผู้ขออนุญาต', hint: 'ผู้ที่กรอกคำขอใช้รถ ลงนามได้เฉพาะตัวผู้ขอเอง' },
  { key: 'dept_head', label: 'ผู้อำนวยการสำนัก/กอง หรือผู้แทน', hint: 'ตามผู้ลงนามของกองที่เลือกไว้ในคำขอ (แท็บผู้ลงนามแต่ละช่อง)' },
  { key: 'authority', label: 'ผู้มีอำนาจสั่งใช้ยานพาหนะ', hint: 'นายก/ปลัด/ผู้ที่ตั้งไว้ในแท็บผู้ลงนามแต่ละช่อง' },
  { key: 'sk1', label: 'ผู้บริหารท้องถิ่น (บันทึกรับรอง สก.๑)', hint: 'ใช้เฉพาะคำขอที่นายกเป็นผู้ขอ' },
]

export const ESIGN_DRIVER_NOTE = 'ช่อง "ผู้ขับรถ" ยังเซ็นสดต่อไป (กำหนดคนขับทีหลังการขอ)'

export const ESIGN_MODE_LABEL = { online: 'ลงนามออนไลน์', wet: 'เซ็นสด (เหมือนเดิม)' }

// ความพร้อมรายคน (esign_signer_readiness) — "พร้อม" = ตั้งรหัสลงนาม + รับทราบหน้าที่ + ไม่ถูกระงับ
// ล็อกเพราะใส่รหัสผิดนับว่าพร้อม (หายเองใน 15 นาที) · ผู้ลงนามตั้งรหัสเองที่เมนู "ลายเซ็นของฉัน"
export const ESIGN_READINESS = {
  ready: { label: 'ลงนามออนไลน์ได้', tone: 'ok' },
  pin_not_set: { label: 'ยังไม่ได้ตั้งรหัสลงนาม', tone: 'warn', todo: 'ให้เจ้าตัวตั้งรหัสที่เมนู “ลายเซ็นของฉัน”' },
  suspended: { label: 'ระงับการลงนามอยู่', tone: 'warn', todo: 'เจ้าตัวกดระงับไว้เอง ตรวจแล้วกด “เปิดคืน”' },
}

// ผล getSignerReadiness → Map profile_id → state
// ดึงไม่ได้ (ฐานยังไม่ apply/ไม่มีสิทธิ์/เน็ต) = null แปลว่า "ยังไม่รู้" ห้ามตีเป็น "ไม่พร้อม" (จะบอกแอดมินผิดว่าทุกคนยังไม่ตั้งรหัส)
export const esignReadinessMap = result => (result?.ok === true && Array.isArray(result.people)
  ? new Map(result.people.filter(person => ESIGN_READINESS[person?.state]).map(person => [person.profile_id, person.state]))
  : null)

// เหตุผลที่ช่องเปิดออนไลน์ไว้ แต่ใบนี้เซ็นสดแทน (fleet_trips.esign_fallback ตรึงไว้ตอนสร้างคำขอ)
// รหัสมาจาก esign_expected_signer (ไม่มี/ไม่ผูกบัญชี) และ esign_signer_unready_reason (รหัส/ระงับ)
// tests/esign-lib.test.mjs อ่านรหัสจาก migration แล้วเทียบกับตารางนี้
export const ESIGN_FALLBACK_REASON = {
  pin_not_set: 'ผู้ลงนามยังไม่ได้ตั้งรหัสลงนามตอนสร้างคำขอ',
  suspended: 'ผู้ลงนามระงับการลงนามอยู่ตอนสร้างคำขอ',
  signatory_missing: 'ยังไม่ได้ตั้งผู้ลงนามช่องนี้',
  signatory_not_linked: 'ผู้ลงนามช่องนี้เป็นชื่อที่พิมพ์เอง ไม่มีบัญชีในระบบ',
  dept_head_missing: 'คำขอนี้ไม่ได้ระบุกอง',
  requester_missing: 'คำขอนี้ไม่มีผู้ขอ',
}

export const esignFallbackText = reason => ESIGN_FALLBACK_REASON[reason] ?? 'ผู้ลงนามยังไม่พร้อมตอนสร้างคำขอ'

// รหัสผลลัพธ์จากฟังก์ชันฝั่ง DB (คอลัมน์ code/reason) → ข้อความภาษาคน
// tests/esign-lib.test.mjs อ่านรหัสทุกตัวจาก migration แล้วเทียบกับตารางนี้ — เพิ่มรหัสใหม่ใน DB แล้วลืมตรงนี้เทสต์แดง
export const ESIGN_MESSAGES = {
  forbidden: 'ไม่มีสิทธิ์ทำรายการนี้ (ต้องเป็นผู้ดูแลระบบของหน่วยงานนี้)',
  not_authenticated: 'กรุณาเข้าสู่ระบบก่อน',
  not_found: 'ไม่พบคำขอนี้',
  rate_limited: 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
  error: 'ทำรายการไม่สำเร็จ กรุณาลองใหม่',
  // ประกาศ (ไม่บังคับกรอก — ข้อความเหล่านี้ขึ้นเมื่อกรอกแล้วผิดรูปแบบเท่านั้น)
  invalid_announcement_no: 'เลขที่ประกาศต้องไม่เกิน 200 ตัวอักษร',
  invalid_announcement_date: 'วันที่ประกาศต้องไม่เกินวันนี้',
  invalid_approval_ref: 'หนังสือให้ความเห็นชอบหรือคำชี้แจงต้องยาว 3–500 ตัวอักษร (หรือเว้นว่างไว้ก็ได้)',
  invalid_announcement_url: 'ลิงก์ไฟล์ประกาศต้องขึ้นต้นด้วย http:// หรือ https://',
  // ประตูก่อนเปิดสวิตช์ (ประกาศไม่เป็นประตูแล้ว 2026-10-22 · ยืนยันทดลองไม่เป็นประตูแล้ว 2026-10-31)
  gate_authority_unlinked: 'ผู้มีอำนาจสั่งใช้ยังไม่ผูกกับบัญชีในแท็บ “ผู้ลงนามแต่ละช่อง” (แถวที่กรอกชื่อพิมพ์เองลงนามออนไลน์ไม่ได้ — เลือกจากบัญชีบุคลากรแทน)',
  gate_dept_head_unlinked: 'หัวหน้ากองยังไม่ผูกกับบัญชีในแท็บ “ผู้ลงนามแต่ละช่อง” (แถวที่กรอกชื่อพิมพ์เองลงนามออนไลน์ไม่ได้ — เลือกจากบัญชีบุคลากรแทน)',
  invalid_slot_modes: 'ค่าที่เลือกไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่',
  unknown_doc_type: 'ไม่รู้จักประเภทเอกสารนี้',
  too_many: 'ขอดูความพร้อมพร้อมกันมากเกินไป กรุณาลองใหม่',
  // รหัสลงนาม
  invalid_pin: 'รหัสลงนามต้องเป็นตัวเลข 6 หลัก',
  weak_pin: 'รหัสเดาง่ายเกินไป (เลขซ้ำทั้งชุด หรือเรียงติดกัน) กรุณาตั้งรหัสอื่น',
  duty_ack_required: 'ต้องกดรับทราบหน้าที่ของเจ้าของลายมือชื่อก่อนตั้งรหัส',
  bad_pin: 'รหัสลงนามไม่ถูกต้อง',
  pin_locked: 'ใส่รหัสผิดหลายครั้ง ระบบล็อกชั่วคราว 15 นาที',
  pin_not_set: 'ยังไม่ได้ตั้งรหัสลงนาม',
  suspended: 'การลงนามของคุณถูกระงับ ให้ผู้ดูแลระบบเปิดคืนก่อน',
  // ลงนาม/ถอน
  not_online: 'คำขอนี้ไม่ได้ใช้การลงนามออนไลน์',
  bad_slot: 'ช่องลงนามไม่ถูกต้อง',
  slot_not_online: 'ช่องนี้ตั้งไว้เป็นเซ็นสด',
  not_applicable: 'ช่องนี้ใช้ไม่ได้กับคำขอนี้',
  trip_closed: 'คำขอนี้ถูกปฏิเสธหรือยกเลิกแล้ว ลงนามไม่ได้',
  not_your_slot: 'ช่องนี้ไม่ใช่ของคุณ ลงนามแทนผู้อื่นไม่ได้',
  already_signed: 'ช่องนี้มีผู้ลงนามแล้ว',
  wait_previous: 'ต้องให้ผู้ลงนามก่อนหน้าลงนามก่อน',
  bad_decision: 'ค่าการตัดสินใจไม่ถูกต้อง',
  profile_name_missing: 'บัญชีของคุณยังไม่มีชื่อ-นามสกุล กรุณาแก้ที่หน้าโปรไฟล์ก่อนลงนาม',
  invalid_reason: 'กรุณาระบุเหตุผล (3–500 ตัวอักษร)',
  requester_missing: 'คำขอนี้ไม่มีผู้ขอ',
  dept_head_missing: 'คำขอนี้ยังไม่ได้เลือกกองของหัวหน้ากอง',
  signatory_missing: 'ยังไม่ได้ตั้งผู้ลงนามช่องนี้ (แอดมิน: เมนูการลงนามเอกสาร → แท็บผู้ลงนามแต่ละช่อง)',
  signatory_not_linked: 'ผู้ลงนามช่องนี้ในทะเบียนเป็นชื่อพิมพ์เอง ยังไม่ผูกกับบัญชี จึงลงนามออนไลน์ไม่ได้',
  // ภาพลายเซ็น (ฐานข้อมูลชุด S1)
  invalid_image: 'ไฟล์ภาพไม่ถูกต้อง ต้องเป็นภาพ PNG ที่สร้างจากหน้านี้',
  image_too_large: 'ภาพใหญ่เกินกำหนด (ไม่เกิน 50 KB) ลองเซ็นให้เล็กลงหรือใช้ภาพที่เรียบกว่านี้',
  invalid_image_size: 'ขนาดภาพเกินกำหนด (ไม่เกิน 640×320 พิกเซล)',
  too_many_images: 'มีลายเซ็นครบ 5 แบบแล้ว ลบแบบเก่าก่อนจึงเพิ่มใหม่ได้',
  image_not_found: 'ไม่พบลายเซ็นนี้ (อาจถูกลบไปแล้ว)',
}

// ข้อความรับทราบหน้าที่ของเจ้าของลายมือชื่อ — แสดงข้างช่องติ๊กตอนตั้งรหัสครั้งแรก (ฐานข้อมูลบันทึกว่ากดรับทราบแล้ว)
// ไม่อ้างเลขมาตราในหน้าจอ: เลขมาตราที่อ้างต้องตรวจกับตัวบทก่อนทุกครั้ง (เคยเขียน "ข้อ ๗" ผิดมาแล้ว — ดู project_esign_per_doctype_design)
export const ESIGN_DUTY_TEXT = 'ฉันรับทราบว่ารหัสลงนามเป็นของฉันคนเดียว ต้องระวังไม่ให้ผู้อื่นนำไปใช้ และเมื่อสงสัยว่ารหัสรั่ว '
  + 'จะกด “ระงับการลงนามของฉัน” ทันทีและแจ้งผู้ดูแลระบบ การลงนามด้วยรหัสของฉันถือเป็นการลงลายมือชื่ออิเล็กทรอนิกส์ของฉันเอง'

export const ESIGN_DECISION_LABEL = { sign: 'ลงนาม', approve: 'อนุมัติ' }

export function esignMessage(result) {
  if (!result) return ESIGN_MESSAGES.error
  const code = typeof result === 'string' ? result : result.code
  return ESIGN_MESSAGES[code] ?? result.message ?? ESIGN_MESSAGES.error
}

// ข้อความเมื่อทำรายการไม่สำเร็จ — รหัสผ่านผิดต้องเตือนเรื่องล็อกเสมอ
// ฟังก์ชันลงนามบอก remaining แต่ set_esign_pin (เปลี่ยนรหัส) ไม่บอก ทั้งที่นับเข้าตัวล็อกชุดเดียวกัน (ผิดสะสมครบ 5 ครั้ง ล็อก 15 นาที)
// จึงต้องเตือนเองเมื่อไม่มีตัวเลข ไม่งั้นผู้ใช้โดนล็อกโดยไม่รู้ตัว (เจอตอนทดสอบกับฐานข้อมูลจริง ไม่ใช่ฐานข้อมูลจำลอง)
export function esignFailureText(result) {
  const base = esignMessage(result)
  if (result?.code !== 'bad_pin') return base
  return base + (Number.isInteger(result.remaining)
    ? ` (เหลืออีก ${result.remaining} ครั้งก่อนระบบล็อก 15 นาที)`
    : ' (ใส่รหัสผิดสะสมครบ 5 ครั้ง ระบบจะล็อกการลงนาม 15 นาที)')
}

// error ที่ trigger บน fleet_trips โยนตอนแก้/ลบทริปที่มีลายเซ็น (RAISE EXCEPTION 'ESIGN_…: …') — หน้ายานพาหนะแปลก่อนแสดง
// ข้อความ DB เป็นภาษาไทยอยู่แล้ว แต่ไม่บอกว่าต้อง "ไปกดอะไรต่อ" และ FleetTrips เดิมโชว์ error ดิบของ DB บางจุด
export const ESIGN_TRIP_EXCEPTIONS = {
  ESIGN_TRIP_LOCKED: 'คำขอนี้มีลายเซ็นออนไลน์แล้ว จึงแก้ปลายทาง วัตถุประสงค์ วันเวลา จำนวนผู้ร่วมเดินทาง ตำแหน่งผู้ขอ หรือผู้ลงนามบนแบบไม่ได้'
    + ' — ปิดหน้านี้แล้วกด "ถอนลายเซ็น" ในหน้ารายละเอียดคำขอก่อน แก้เสร็จแล้วให้ผู้ลงนามลงนามใหม่ (เปลี่ยนรถหรือผู้ขับรถทำได้ตามปกติ)',
  // 2569-10-25: แอดมิน อปท. ลบได้ (migration 20261025120000) ข้อความนี้เหลือไว้ให้คนอื่นที่ไม่ใช่แอดมินเท่านั้น
  ESIGN_TRIP_HAS_SIGNATURES: 'ทริปที่เคยมีลายเซ็นออนไลน์ ลบได้เฉพาะผู้ดูแลระบบของ อปท. (ลายเซ็นเก็บไว้เป็นหลักฐาน) — ถ้าไม่ใช้แล้วให้ใช้ "ยกเลิกคำขอ" แทน',
}

// ถอนลายเซ็นช่องนี้แล้วช่องไหนถูกถอนตามไปด้วย — ต้องตรงกับ v_chain ใน esign_revoke_fleet_trip (tests/esign-lib.test.mjs เทียบกับ SQL)
// ถอนช่องต้นสาย = ถอนช่องหลังๆ ในสายด้วย เพราะผู้ลงนามช่องหลังเห็นเนื้อหาชุดเก่า · ไม่ระบุช่อง = ถอนทุกช่อง
const ESIGN_REVOKE_CHAIN = ['requester', 'dept_head', 'authority']
export function esignRevokeTargets(slot) {
  if (!slot) return ESIGN_FLEET_SLOTS.map(item => item.key)
  const index = ESIGN_REVOKE_CHAIN.indexOf(slot)
  return index < 0 ? [slot] : ESIGN_REVOKE_CHAIN.slice(index)
}

// โหมดรายช่องที่หน้าจอแสดง — ช่องที่ DB ไม่มีค่า = เซ็นสด
export function esignModesFromStatus(status) {
  const saved = status?.slot_modes ?? {}
  return Object.fromEntries(ESIGN_FLEET_SLOTS.map(slot => [slot.key, saved[slot.key] === 'online' ? 'online' : 'wet']))
}

export const esignAnyOnline = modes => Object.values(modes ?? {}).some(mode => mode === 'online')

// รายการ "ประตู" ที่ต้องผ่านก่อนเปิดสวิตช์ — เรียงตามที่แอดมินต้องทำ
// authority/dept_head ต้องผ่านเฉพาะเมื่อช่องนั้นเลือก "ออนไลน์" (DB ตรวจแบบเดียวกันใน set_esign_doc_type)
// ประกาศ/หนังสือให้ความเห็นชอบ (พ.ร.ฎ. ๒๕๔๙ มาตรา ๗) ไม่อยู่ในรายการนี้แล้ว: เป็นหน้าที่ของ อปท. ที่ระบบไม่บังคับแทน
// ห้ามเติม 'policy' กลับมาโดยไม่ได้รับคำสั่งจากเจ้าของระบบ — ฝั่ง DB ก็ถอดออกแล้ว (20261022110100) หน้าจอที่บังคับเองจะขัดกับ DB
// 'trial' (ยืนยันว่าทดลองแล้ว) ถอดแล้ว 2569-10-31 (เฟส 2): ระบบไม่เคยตรวจว่าทดลองจริง และช่องที่ผู้ลงนามไม่พร้อมตกเป็นเซ็นสดเองแล้ว
export function esignGateItems(status, modes) {
  const authorityNeeded = modes?.authority === 'online'
  const deptHeadNeeded = modes?.dept_head === 'online'
  const authorityLinked = status?.authority_linked ?? 0
  const deptHeadLinked = status?.dept_head_linked ?? 0
  return [
    { key: 'authority', required: authorityNeeded, ok: authorityLinked > 0, label: 'ผู้มีอำนาจสั่งใช้ผูกบัญชีแล้ว', detail: `${authorityLinked} ราย` },
    { key: 'dept_head', required: deptHeadNeeded, ok: deptHeadLinked > 0, label: 'หัวหน้ากองผูกบัญชีแล้ว', detail: `${deptHeadLinked} ราย` },
  ]
}

// ข้อที่ยังไม่ผ่านและขวางการเปิดสวิตช์ตามช่องที่เลือก (ว่าง = เปิดได้)
export function esignBlockers(status, modes) {
  if (!esignAnyOnline(modes)) return []
  return esignGateItems(status, modes).filter(item => item.required && !item.ok).map(item => item.key)
}

// ร่างข้อความประกาศ — เป็นจุดตั้งต้นให้นิติกร/ผู้บริหารของ อปท. ตรวจและแก้ ไม่ใช่คำปรึกษากฎหมาย
// อ้างเฉพาะตัวบทที่ตรวจกับสำเนาทางการแล้ว: พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. ๒๕๔๔ มาตรา ๙ และ
// พ.ร.ฎ.กำหนดหลักเกณฑ์และวิธีการในการทำธุรกรรมทางอิเล็กทรอนิกส์ภาครัฐ พ.ศ. ๒๕๔๙ มาตรา ๓ ๕ ๖ ๗ — ห้ามเพิ่มเลขมาตราจากความจำ (พ.ร.ฎ. ฉบับนี้เรียกว่า "มาตรา" ไม่ใช่ "ข้อ")
// ส่วนในวงเล็บเหลี่ยม [...] คือสิ่งที่ อปท. ต้องตัดสินใจเอง (ระบบยังไม่ทำให้/ไม่รู้)
export function esignAnnouncementDraft(orgName) {
  const org = String(orgName ?? '').trim() || '[ชื่อหน่วยงาน]'
  return [
    `ประกาศ${org}`,
    'เรื่อง วิธีการลงลายมือชื่ออิเล็กทรอนิกส์ในใบขออนุญาตใช้ยานพาหนะส่วนกลาง และแนวนโยบายรักษาความมั่นคงปลอดภัยของระบบ',
    '',
    `ข้อ ๑ ขอบเขต ใช้กับใบขออนุญาตใช้ยานพาหนะส่วนกลาง/รถรับรอง (แบบ ๓) และบันทึกรับรอง (สก.๑) ที่จัดทำในระบบ SmartLocal ของ${org} เฉพาะช่องลงนามที่หน่วยงานเลือกให้ลงนามออนไลน์`,
    'ข้อ ๒ วิธีระบุตัวผู้ลงลายมือชื่อ ผู้ลงนามเข้าสู่ระบบด้วยบัญชีของตนเอง และยืนยันการลงนามทุกครั้งด้วยรหัสลงนาม ๖ หลักที่ตนตั้งเอง ระบบบันทึกชื่อ ตำแหน่ง ฐานะที่ลงนาม วันเวลาจากเซิร์ฟเวอร์ และค่าตรวจสอบการเปลี่ยนแปลงของเนื้อหาคำขอ ผู้ลงนามลงนามแทนกันไม่ได้',
    'ข้อ ๓ ประเภทลายมือชื่อ เป็นลายมือชื่ออิเล็กทรอนิกส์ตามมาตรา ๙ แห่งพระราชบัญญัติว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. ๒๕๔๔ ซึ่งไม่ใช้ใบรับรองอิเล็กทรอนิกส์',
    'ข้อ ๔ หน้าที่ของเจ้าของลายมือชื่อ ต้องรักษารหัสลงนามไม่ให้ผู้อื่นใช้ และเมื่อสงสัยว่ารหัสรั่วให้กด "ระงับการลงนามของฉัน" ในระบบทันทีและแจ้ง [ผู้ดูแลระบบ/ผู้บังคับบัญชา]',
    'ข้อ ๕ การแก้ไขหลังลงนาม เนื้อหาคำขอที่มีลายเซ็นแล้วแก้ไม่ได้ ต้องถอนลายเซ็นพร้อมระบุเหตุผลก่อนแล้วลงนามใหม่ ประวัติการลงนามและการถอนถูกเก็บไว้ ไม่ลบ ไม่แก้',
    'ข้อ ๖ แนวนโยบายและแนวปฏิบัติความมั่นคงปลอดภัยด้านสารสนเทศ (๑) ควบคุมการเข้าถึง: เฉพาะผู้ที่ได้รับสิทธิ์ยานพาหนะเห็นรายละเอียดคำขอ หน้าตรวจสอบสาธารณะไม่แสดงปลายทางและวัตถุประสงค์ (๒) ระบบสำรองและแผนรับมือเหตุฉุกเฉิน: [ระบุวิธีสำรองข้อมูลลายเซ็น ผู้รับผิดชอบ ความถี่ และสถานที่เก็บสำเนาอีกแห่งหนึ่ง] (๓) ตรวจสอบและประเมินความเสี่ยงสม่ำเสมอ: [ระบุผู้รับผิดชอบและรอบเวลา]',
    'ข้อ ๗ ข้อมูลส่วนบุคคล เก็บเฉพาะชื่อ ตำแหน่ง ฐานะที่ลงนาม และเวลาลงนาม ไม่เก็บภาพลายเซ็นหรือที่อยู่ไอพี [ระบุเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคลและระยะเวลาเก็บ]',
    'ข้อ ๘ ความเห็นชอบ ประกาศนี้ได้รับความเห็นชอบตามพระราชกฤษฎีกากำหนดหลักเกณฑ์และวิธีการในการทำธุรกรรมทางอิเล็กทรอนิกส์ภาครัฐ พ.ศ. ๒๕๔๙ มาตรา ๗ จาก [ระบุหน่วยงานที่ให้ความเห็นชอบและเลขที่หนังสือ] (หรือ [ระบุคำชี้แจงว่าไม่ต้องขอความเห็นชอบ พร้อมเลขที่หนังสือตอบ])',
    '',
    'ประกาศ ณ วันที่ [วัน เดือน พ.ศ.]',
    '[ชื่อผู้บริหารท้องถิ่น] [ตำแหน่ง]',
  ].join('\n')
}

// ── รายการ "ใบรอฉันลงนาม" (esign_my_pending → หน้าแรกเจ้าหน้าที่ + แถบในหน้าการใช้รถ) ───────────────────────────
// แปลงผลของ useHomeRpc เป็นรูปที่หน้าจอใช้ · ok:false หรือรูปผิดต้องเป็น error ไม่ใช่ "ไม่มีใบรอ"
// ถ้าเข้าใจว่าไม่มีใบรอทั้งที่ดึงไม่ได้ หน้าแรกจะขึ้นไฟเขียว "ไม่มีงานค้าง" และใบขอใช้รถค้างอยู่ที่ผู้มีอำนาจโดยไม่มีใครเห็น
export function esignPendingFromRpc(rpcState) {
  const status = rpcState?.status ?? 'idle'
  if (status !== 'ok') return { status, items: [] }
  const data = rpcState.data
  if (data?.ok !== true || !Array.isArray(data.items)) return { status: 'error', items: [] }
  return { status: 'ok', items: data.items.filter(item => item?.trip_id && item?.slot) }
}

// คนเดียวถือหลายช่องในทริปเดียวได้ (ได้หลายแถว) จึงใช้ทริป+ช่องเป็นคีย์
export const esignPendingKey = item => `${item.trip_id}:${item.slot}`

// ข้อมูลหนึ่งแถวของรายการใบรอลงนาม · ช่องผู้มีอำนาจเป็น "อนุมัติ" ส่วนช่องอื่นเป็น "ลงนาม" (ตามที่ DB บอกใน decision)
export function esignPendingRow(item) {
  const who = item.requester_name || 'ผู้ขอ'
  const fallbackLabel = ESIGN_FLEET_SLOTS.find(slot => slot.key === item.slot)?.label ?? item.slot
  return {
    key: esignPendingKey(item),
    tripId: item.trip_id,
    slot: item.slot,
    slotLabel: item.slot_label || fallbackLabel,
    title: item.destination ? `${who} ขอใช้รถไป ${item.destination}` : `${who} ขอใช้รถ`,
    vehicleName: item.vehicle_name || null,
    plannedDeparture: item.planned_departure || null,
    actionLabel: item.decision === 'approve' ? 'อนุมัติ (ลงนาม)' : 'ลงนาม',
    summary: {
      requesterName: item.requester_name,
      vehicleName: item.vehicle_name,
      destination: item.destination,
      purpose: item.purpose,
      plannedDeparture: item.planned_departure,
    },
  }
}

// เตือนแบบไม่บล็อกตอนบันทึกออกเดินทาง: ช่องผู้มีอำนาจเป็นออนไลน์แต่ยังไม่ลงนาม
// คืน null = ไม่ต้องเตือน · missing = ช่องออนไลน์ที่ยังไม่ลงนามทั้งหมด (ผู้ขอ/ผอ.กอง/ผู้มีอำนาจ ตามลำดับ) · blocked = เหตุที่ช่องผู้มีอำนาจลงนามออนไลน์ไม่ได้ (ถ้ามี)
export function esignDepartWarning(status) {
  if (!status?.found || ['rejected', 'cancelled'].includes(status.trip_status)) return null
  const pending = (status.slots ?? []).filter(slot => slot.mode === 'online' && slot.applicable && !slot.signed)
  const authority = pending.find(slot => slot.slot === 'authority')
  if (!authority) return null
  return {
    missing: pending.map(slot => slot.label),
    expectedName: authority.expected_name || null,
    blocked: authority.blocked || null,
  }
}
