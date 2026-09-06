// รายการ "ประเภทคำขอบริการ/เอกสาร" ฉบับกลาง — ตรงกับค่าใน document_requests.document_type
//
// เดิมแต่ละหน้าจอนิยามลิสต์ของตัวเอง (StaffDashboard, CitizenDocRequest, MyDocRequests,
// LpaDocStats, DocumentTypeFeeSettings) เพิ่มประเภทใหม่ทีต้องไล่แก้ 5 จุด และหลุดจริงมาแล้ว —
// DocumentTypeFeeSettings (การ์ดตั้งค่าธรรมเนียม ที่ยุบรวมเข้า DocumentTypeAssignments แล้ว
// 2569-09-05) รู้จักแค่ 3 ประเภทที่เก็บค่าธรรมเนียม ทำให้หน้าตั้งค่าของแอดมินมองไม่เห็น
// building_permit / tax_notice / waste_collection_request เลย ทั้งที่ประชาชนยื่นได้
//
// ไฟล์นี้เก็บเฉพาะ value + label ที่ทุกหน้าจอใช้ตรงกัน ส่วนฟิลด์ตกแต่งเฉพาะหน้า (สี ไอคอน
// คำอธิบายฝั่งประชาชน) ยังอยู่ที่หน้านั้นตามเดิม ไม่ยกมารวมเพราะคนละบริบทการใช้งาน

export const BASE_DOCUMENT_TYPES = [
  { value: 'residence_cert',           label: '🏠 ใบรับรองการอยู่อาศัย' },
  { value: 'personal_cert',            label: '👤 หนังสือรับรองบุคคล' },
  { value: 'tax_notice',               label: '🏦 ค่าธรรมเนียม/ภาษี' },
  { value: 'waste_collection',         label: '🗑️ ค่าธรรมเนียมขยะ' },
  { value: 'waste_collection_request', label: '🚛 ขอรับบริการเก็บขนขยะมูลฝอย' },
  { value: 'building_permit',          label: '🏗️ ขออนุญาตก่อสร้างบ้าน' },
]

/**
 * ประเภทที่ อปท. เพิ่มเองผ่านแท็บ "ประเภทคำขอเอกสาร" (DocumentTypeAssignments) — เก็บใน
 * municipalities.fee_schedule._custom_types (jsonb ก้อนเดียวกับอัตราค่าธรรมเนียมเดิม
 * ที่เลิกตั้งผ่าน UI แล้ว แต่ค่าเก่ายังค้างอยู่และมีโค้ดอ่านอยู่)
 * @param {{ fee_schedule?: { _custom_types?: Array<{ value: string, label: string, emoji?: string }> } } | null} tenant
 */
export function customDocumentTypes(tenant) {
  return (tenant?.fee_schedule?._custom_types || []).map((t) => ({
    value: t.value,
    label: `${t.emoji || '📋'} ${t.label}`,
  }))
}

/**
 * ประเภทมาตรฐานที่ อปท. กดลบทิ้ง — เก็บ value ไว้ใน municipalities.fee_schedule._removed_types
 *
 * ทำไมต้องเก็บ "รายชื่อที่ลบ" แทนที่จะลบออกจากลิสต์จริงๆ: BASE_DOCUMENT_TYPES อยู่ในโค้ด
 * ไม่ได้อยู่ใน DB ลบให้หายจริงไม่ได้เพราะมันเป็นค่าร่วมของทุก อปท. — อปท. หนึ่งลบ
 * ใบรับรองการอยู่อาศัยทิ้ง อีกที่หนึ่งยังต้องใช้ ค่านี้จึงเป็นรายชื่อ "ไม่ใช้ที่นี่" รายหน่วยงาน
 *
 * ⚠️ ตัวลิสต์ label ยังต้องรู้จักประเภทที่ถูกลบต่อไป — คำขอเก่าใน document_requests ที่ยื่น
 * ด้วยประเภทนั้นยังอยู่ ถ้ากรองออกจากตัวแปลชื่อด้วย หน้าเจ้าหน้าที่/ประวัติของประชาชน
 * จะโชว์เป็น 'residence_cert' ดิบๆ และรายงาน LPA จะนับไม่ตรง กรองเฉพาะจุดที่เป็น
 * "ตัวเลือกยื่นคำขอใหม่" เท่านั้น
 * @param {{ fee_schedule?: { _removed_types?: string[] } } | null} tenant
 */
export function removedDocumentTypes(tenant) {
  const list = tenant?.fee_schedule?._removed_types
  return Array.isArray(list) ? list.filter((v) => typeof v === 'string') : []
}

/**
 * กรองประเภทที่ อปท. ลบทิ้งออกจากลิสต์ตัวเลือก รับได้ทั้ง array ของ object ที่มี .value
 * และ array ของ string ตรงๆ
 * @template T
 * @param {T[]} types
 * @param {{ fee_schedule?: { _removed_types?: string[] } } | null} tenant
 * @returns {T[]}
 */
export function withoutRemovedTypes(types, tenant) {
  const removed = removedDocumentTypes(tenant)
  if (removed.length === 0) return types
  return types.filter((t) => !removed.includes(typeof t === 'string' ? t : t?.value))
}

/** ประเภทมาตรฐาน + ประเภทเฉพาะของ อปท. นั้น (ตัดประเภทที่ลบทิ้งออกแล้ว) */
export function allDocumentTypes(tenant) {
  return [
    ...withoutRemovedTypes(BASE_DOCUMENT_TYPES, tenant),
    ...customDocumentTypes(tenant),
  ]
}

// SLA เริ่มต้นรายประเภท (วันทำการนับจากวันที่ยื่น) ใช้เป็นค่าตั้งต้นตอนแอดมินยังไม่เคยตั้งเอง
// เท่านั้น ค่าจริงอยู่ในตาราง document_type_assignments.sla_days ที่ อปท. แก้ได้
//
// ⚠️ ตัวเลขเหล่านี้เป็นค่าที่ระบบตั้งให้ใช้งานได้ทันที **ไม่ใช่ระยะเวลาตามคู่มือประชาชน
// ตาม พ.ร.บ.การอำนวยความสะดวกฯ** ซึ่งแต่ละ อปท. ประกาศเองและไม่เท่ากัน ถ้าจะอ้างอิงเป็น
// ทางการต้องเปิดคู่มือประชาชนที่ อปท. นั้นประกาศไว้แล้วตั้งค่าให้ตรง
export const DEFAULT_SLA_DAYS = {
  residence_cert: 3,
  personal_cert: 3,
  tax_notice: 3,
  waste_collection: 3,
  // ต้องจัดถัง วางแผนเส้นทางเก็บขน และแจ้งพนักงานประจำรถ ไม่ใช่งานออกเอกสารหน้าเคาน์เตอร์
  waste_collection_request: 7,
  // ตรวจแบบแปลน/ตรวจพื้นที่จริงก่อนออกใบอนุญาต
  building_permit: 15,
}
export const FALLBACK_SLA_DAYS = 3

export function defaultSlaDays(documentType) {
  return DEFAULT_SLA_DAYS[documentType] ?? FALLBACK_SLA_DAYS
}
