// ค่ากลางของคำขอ "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย" — ใช้ร่วมกันระหว่างวิซาร์ด หน้า "เอกสารของฉัน"
// แผงเจ้าหน้าที่ และใบพิมพ์ ค่า value ทุกตัวต้องตรงกับ CHECK/whitelist ใน
// supabase/migrations/20260910100000_patient_transport_tables.sql และ 20260910100200_patient_transport_rpc.sql

export const PATIENT_TRANSPORT_TYPE = 'patient_transport_request'

// เปลี่ยนข้อความยินยอมเมื่อไหร่ต้องเปลี่ยนรุ่นด้วยเสมอ — consent_version ในแต่ละคำขอคือหลักฐานว่า
// ประชาชนติ๊กยินยอมกับข้อความรุ่นไหน ถ้าแก้ข้อความแต่ไม่แก้รุ่น จะพิสูจน์ย้อนหลังไม่ได้
export const PATIENT_TRANSPORT_CONSENT_VERSION = 'ptr-consent-v1'

export const APPOINTMENT_KINDS = [
  { value: 'dialysis',   label: 'ฟอกไต' },
  { value: 'follow_up',  label: 'ตรวจตามนัดแพทย์' },
  { value: 'rehab',      label: 'กายภาพบำบัด' },
  { value: 'medication', label: 'รับยา' },
  { value: 'other',      label: 'อื่นๆ' },
]

export const MOBILITY_LEVELS = [
  { value: 'walk',       label: 'เดินได้เอง' },
  { value: 'wheelchair', label: 'ใช้รถเข็น (วีลแชร์)' },
  { value: 'stretcher',  label: 'ต้องนอนเปล' },
]

export const REQUESTER_RELATIONS = [
  { value: 'self',      label: 'ผู้ป่วยยื่นเอง' },
  { value: 'relative',  label: 'ญาติ' },
  { value: 'caregiver', label: 'ผู้ดูแล' },
  { value: 'other',     label: 'อื่นๆ' },
]

export const TRIP_TYPES = [
  { value: 'round_trip', label: 'ไป-กลับ' },
  { value: 'one_way',    label: 'ขาไปอย่างเดียว' },
]

// ข้อความที่ประชาชนเห็นในหน้า "เอกสารของฉัน" — แยกจาก STATUS ของ document_requests เพราะ
// document_requests.status มีแค่ 4 ค่า บอกไม่ได้ว่าเรื่องไปค้างอยู่ที่ อปท. หรือที่กองทุน
export const WORKFLOW_STATUS = {
  submitted:     { label: 'รอเจ้าหน้าที่ตรวจสอบ',            tone: 'amber' },
  forwarded:     { label: 'ส่งต่อหน่วยงานผู้จัดรถแล้ว',      tone: 'blue' },
  fund_accepted: { label: 'หน่วยงานผู้จัดรถรับเรื่องแล้ว',     tone: 'emerald' },
  fund_declined: { label: 'หน่วยงานผู้จัดรถไม่รับเรื่อง',      tone: 'red' },
  completed:     { label: 'เดินทางเรียบร้อย ปิดเรื่องแล้ว',  tone: 'emerald' },
  rejected:      { label: 'อปท. ไม่ส่งต่อคำขอ',              tone: 'red' },
  cancelled:     { label: 'ยกเลิกคำขอแล้ว',                 tone: 'gray' },
}

export function optionLabel(options, value) {
  return options.find(option => option.value === value)?.label ?? ''
}

/**
 * ข้อความขอความยินยอม — ต้องระบุชื่อผู้รับข้อมูล รายการข้อมูลที่ส่ง วัตถุประสงค์ และวิธีถอน
 * (ข้อมูลสุขภาพเป็นข้อมูลอ่อนไหวตาม PDPA ต้องยืนยันเลขมาตรากับตัวบทฉบับปัจจุบันก่อนอ้างอิง)
 * ข้อความนี้ถูกเก็บลง permit_form_data.consent_text ทั้งก้อน เป็นหลักฐานว่าติ๊กยินยอมกับอะไร
 * @param {{ tenantName: string, partnerName: string, onBehalf: boolean }} args
 */
export function buildPatientTransportConsentText({ tenantName, partnerName, onBehalf }) {
  const office = tenantName || 'องค์กรปกครองส่วนท้องถิ่น'
  const lines = [
    `ข้าพเจ้ายินยอมให้${office}ส่งข้อมูลในคำขอนี้ ได้แก่ ชื่อผู้ยื่นและผู้ป่วย อายุ เบอร์โทรติดต่อ `
      + 'ที่อยู่จุดรับ สถานพยาบาลและวันเวลานัด ประเภทนัด และลักษณะการเคลื่อนไหวของผู้ป่วย '
      + `ให้แก่${partnerName} เพื่อใช้พิจารณาและจัดรถรับ-ส่งตามคำขอนี้เท่านั้น`,
    'ข้าพเจ้าทราบว่าถอนความยินยอมได้ โดยกดยกเลิกคำขอในหน้า "เอกสารของฉัน" ก่อนเจ้าหน้าที่ส่งต่อ '
      + `หรือแจ้งเจ้าหน้าที่${office}หากส่งต่อไปแล้ว`,
  ]
  // ยื่นแทนผู้อื่น = กำลังส่งข้อมูลสุขภาพของคนที่ไม่ได้กดยินยอมเอง ผู้ยื่นต้องรับรองว่าได้รับอนุญาตแล้ว
  if (onBehalf) {
    lines.push('ข้าพเจ้าได้รับความยินยอมจากผู้ป่วย หรือเป็นผู้มีอำนาจกระทำการแทนผู้ป่วยแล้ว')
  }
  return lines.join(' ')
}
