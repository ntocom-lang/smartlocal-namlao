// หมวดคำร้อง "สอบถาม/ติดต่อเจ้าหน้าที่" (inquiry) — ข้อ 1.3 แผนเทียบคู่แข่ง
//
// ทำไมมี: /contact เป็นหน้าข้อมูลล้วน ประชาชนอยากถามเจ้าหน้าที่เป็นลายลักษณ์อักษรแล้วรอคำตอบ
// จึงใช้ระบบคำร้องเดิมทั้งชุด (รับเรื่องเอง → ส่งกอง → ตอบ → ลิงก์ติดตาม /t/) แค่เพิ่มหมวดหนึ่งหมวด
// กติกาฝั่งฐานข้อมูล (กองที่รับ / เปิดให้ใคร / ไม่ต้องปักหมุดตอนตอบ) อยู่ที่
// supabase/migrations/20261205100000_inquiry_standard_category.sql
//
// ⚠️ รหัส 'inquiry' ต้องตรงกับไฟล์ SQL ข้างบนและ DEFAULT_SEED ใน src/pages/AdminDashboard.jsx
//    (tests/inquiry-category.test.mjs เทียบให้ทุกครั้ง)
// ⚠️ ไฟล์นี้ต้องไม่ import supabase — เทสต์รันด้วย node ตรงๆ
//
// ข้อความทุกบรรทัดในไฟล์นี้เป็นถ้อยคำ "สอบถาม" ที่ไม่ใช่เรื่องร้องเรียน — ไม่อ้างมาตราหรือชื่อระเบียบใดๆ

export const INQUIRY_CATEGORY = 'inquiry'
// ?form=inquiry บนหน้า /request (CitizenForm) — คุมหน้าตาฟอร์มฝั่งเว็บเท่านั้น
// ⚠️ ห้ามส่งค่านี้เข้า p_form_type ของ submit_citizen_complaint_v4: complaints.form_type มี CHECK ไม่รวม 'inquiry' (ส่ง 'legacy')
export const INQUIRY_FORM_TYPE = 'inquiry'
export const INQUIRY_LABEL = 'สอบถาม/ติดต่อเจ้าหน้าที่'

/** รหัสหมวดนี้คือ "สอบถาม/ติดต่อเจ้าหน้าที่" ไหม — ค่าอื่น/ว่าง = false (หมวดอื่นต้องไม่ถูกเปลี่ยนถ้อยคำ) */
export function isInquiryCategory(value) {
  return value === INQUIRY_CATEGORY
}

/** เลือกข้อความตามหมวด: inquiry ใช้ข้อความสอบถาม หมวดอื่นคืนข้อความเดิมของมันเสมอ */
export function inquiryOr(category, normalText, inquiryText) {
  return isInquiryCategory(category) ? inquiryText : normalText
}

// ฟอร์มประชาชน (CitizenForm)
// หน้าที่ขึ้นแทนฟอร์มเมื่อยังไม่ได้เข้าสู่ระบบ
export const INQUIRY_LOGIN_GATE = {
  title: 'เข้าสู่ระบบก่อนส่งคำถาม',
  body: 'เพื่อให้ท่านอ่านคำตอบของเจ้าหน้าที่ในระบบได้ และไม่ต้องรอโทรกลับ กรุณาเข้าสู่ระบบก่อนส่งคำถาม (เข้าด้วย LINE หรือ Google ได้)',
  button: 'เข้าสู่ระบบเพื่อส่งคำถาม',
  back: 'ย้อนกลับ',
}

export const INQUIRY_FORM = {
  title: 'สอบถาม/ติดต่อเจ้าหน้าที่',
  submit: 'ส่งคำถาม',
  placeholder: 'พิมพ์คำถามหรือเรื่องที่ต้องการติดต่อ...',
  // เจ้าของระบบเลือก 2569-11-17: ต้องเข้าสู่ระบบก่อนส่งคำถาม — ฐานข้อมูลออกลิงก์ติดตามเฉพาะผู้ล็อกอิน
  // (get_complaint_track_token เฉพาะ authenticated) ผู้ไม่ล็อกอินจึงอ่านคำตอบในระบบไม่ได้และเจ้าหน้าที่ต้องโทรกลับ
  // ด่านนี้อยู่ที่หน้าเว็บ (ฟอร์ม) ไม่ใช่ฐานข้อมูล — ผู้เรียก rpc ตรงๆ ยังส่งได้แต่ไม่มีช่องทางอ่านคำตอบ
  summaryHeading: 'ข้อความคำถามที่จะส่ง',
  emptyDetail: 'ข้อความคำถามต้องไม่ว่าง',
  // ต่อท้าย "...เก็บข้อมูลส่วนบุคคลเพื่อ" ในกล่องทวนก่อนส่ง (ComplaintReviewSheet)
  consent: 'รับคำถามและติดต่อกลับ',
  successTitle: 'ส่งคำถามสำเร็จ!',
  successBody: 'เจ้าหน้าที่จะตอบคำถามของท่านโดยเร็วที่สุด',
  trackButton: 'ดูคำตอบ / ติดตามคำถาม',
}

// นโยบายความเป็นส่วนตัว (PDPA) เวอร์ชันสอบถาม — รายการข้อมูลที่เก็บ/วัตถุประสงค์ของคำถามจริง
// ไม่มีตำแหน่งที่ตั้งและไฟล์แนบ เพราะฟอร์มสอบถามไม่เก็บสองอย่างนี้
export const INQUIRY_PDPA = {
  intro: 'มีความจำเป็นต้องเก็บรวบรวมข้อมูลส่วนบุคคลของท่านเพื่อตอบคำถามที่ท่านส่งมา',
  collected: ['ชื่อ-นามสกุล และเบอร์โทรศัพท์ติดต่อ', 'ข้อความคำถามที่ท่านพิมพ์'],
  purposes: ['พิจารณาคำถามและส่งให้ผู้รับผิดชอบตอบ', 'ติดต่อกลับเพื่อสอบถามข้อมูลเพิ่มเติมและแจ้งคำตอบ'],
}

// ฝั่งเจ้าหน้าที่: ช่องบันทึกตอนปิดเรื่อง (FinishComplaintDialog) — ใช้ช่อง technician_note เดิม
export const INQUIRY_STAFF = {
  dialogTitle: 'บันทึกคำตอบและปิดเรื่อง',
  dialogHint: 'ผู้สอบถามเปิดอ่านคำตอบได้ที่หน้าติดตามเรื่อง',
  answerLabel: 'คำตอบถึงผู้สอบถาม',
  answerHint: 'ข้อความในช่องนี้ผู้สอบถามอ่านได้ที่หน้าติดตามเรื่อง ถ้าไม่พิมพ์ ผู้สอบถามจะไม่เห็นคำตอบ',
  answerPlaceholder: 'พิมพ์คำตอบถึงผู้สอบถาม',
  confirm: 'ยืนยันตอบแล้ว',
}

// ฝั่งผู้สอบถาม: หน้าติดตาม (/t/) และคำร้องของฉัน
export const INQUIRY_ANSWER_HEADING = 'คำตอบจากเจ้าหน้าที่'
// สถานะปิดเรื่องของหมวดนี้ ไม่ใช้ "ดำเนินการแล้ว/แก้ไขแล้ว" เพราะคำถามไม่ได้มีงานให้ลงมือแก้
export const INQUIRY_DONE_LABEL = 'ตอบแล้ว'
export const INQUIRY_DONE_DESC = 'เจ้าหน้าที่ตอบคำถามแล้ว อ่านคำตอบได้ด้านล่าง ถ้ายังไม่ได้คำตอบที่ต้องการแจ้งกลับได้ภายใน 7 วัน'

/**
 * เปลี่ยนป้ายขั้นสุดท้ายของไทม์ไลน์หน้าติดตาม (/t/) เป็น "ตอบแล้ว" เฉพาะหมวด inquiry — หมวดอื่นคืนอาร์เรย์เดิมตัวเดิม
 * ใช้กับผลของ buildTrackSteps() (ขั้น key 'done' เท่านั้น ขั้นไม่ดำเนินการ/ขึ้นทะเบียนรอดำเนินการไม่แตะ)
 */
export function relabelInquirySteps(steps, category) {
  if (!isInquiryCategory(category) || !Array.isArray(steps)) return steps
  return steps.map(step => (step?.key === 'done' ? { ...step, label: INQUIRY_DONE_LABEL } : step))
}

// หน้า /contact: การ์ดเชิญให้ส่งคำถาม
export const INQUIRY_CARD = {
  heading: 'ส่งคำถามถึงเจ้าหน้าที่',
  body: 'พิมพ์คำถามหรือเรื่องที่ต้องการติดต่อ เจ้าหน้าที่จะตอบกลับให้',
  button: 'ส่งคำถาม',
}

/** ลิงก์ไปฟอร์ม (route จริงคือ /request ใน App.jsx) */
export function inquiryFormPath() {
  return `/request?form=${INQUIRY_FORM_TYPE}`
}

/**
 * การ์ดบน /contact ขึ้นไหม — ขึ้นเมื่อ "มีแถวหมวด inquiry จริง + เปิดใช้ + ผู้ใช้คนนี้ยื่นได้"
 * ต่างจาก useComplaintCategoryOpen ที่คืน true เมื่อไม่มีแถว (ใช้กับปุ่มลัดของหมวดที่มีทุก อปท.)
 * หมวดนี้เป็นหมวดใหม่ ถ้าฐานยังไม่มีแถว/ปิดอยู่ ต้องไม่ขึ้นการ์ดที่กดแล้วส่งไม่ได้
 * @param {{ value?: string, is_active?: boolean, submit_audience?: string }|null} row แถวจาก complaint_categories
 * @param {(category: object, role: string) => boolean} canSubmit ฟังก์ชันตรวจสิทธิ์ (canSubmitCategory)
 * @param {string|null} role
 */
export function shouldShowInquiryCard(row, canSubmit, role) {
  if (!row || row.value !== INQUIRY_CATEGORY || row.is_active !== true) return false
  return canSubmit(row, role) === true
}
