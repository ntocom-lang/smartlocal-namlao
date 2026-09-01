// คำเรียกที่เปลี่ยนไปตามประเภทหน่วยงาน (municipalities.org_type) — แหล่งความจริงเดียวของทั้งระบบ
//
// เดิมมีแค่ TERMINOLOGY ใน TenantContext.jsx ซึ่งเก็บคำเรียก "คน" (นายกฯ, ปลัด, สมาชิกสภา) แต่ไม่มี
// คำเรียก "องค์กร" ทำให้ 12 จุดในโค้ดไป hardcode คำว่า 'สภาเทศบาล' เอาเอง ผลคือ อปท. ที่เป็น อบต.
// (tamnaktham, thungkaew) เห็นป้ายกำกับกลุ่มผู้รับข้อมูลในปฏิทินกิจกรรม/หน้าจัดการผู้ใช้ เป็น
// "สภาเทศบาล" ทั้งที่ต้องเป็น "สภา อบต." — ย้ายมารวมที่นี่ที่เดียว ใครต้องใช้ import แทนการนิยามเอง

function termSet({ mayor, deputyMayor, council, councilPresident, clerk, councilOrg, abbr, strip }) {
  return { mayor, deputyMayor, council, councilPresident, clerk, councilOrg, abbr, strip }
}

const MUNICIPAL_TERMS = {
  mayor: 'นายกเทศมนตรี',
  deputyMayor: 'รองนายกเทศมนตรี',
  council: 'สมาชิกสภาเทศบาล',
  councilPresident: 'ประธานสภาเทศบาล',
  clerk: 'ปลัดเทศบาล',
  councilOrg: 'สภาเทศบาล',
}

export const ORG_TERMS = {
  'เทศบาลนคร':  termSet({ ...MUNICIPAL_TERMS, abbr: 'ทน.', strip: 'เทศบาลนคร' }),
  'เทศบาลเมือง': termSet({ ...MUNICIPAL_TERMS, abbr: 'ทม.', strip: 'เทศบาลเมือง' }),
  'เทศบาลตำบล': termSet({ ...MUNICIPAL_TERMS, abbr: 'ทต.', strip: 'เทศบาลตำบล' }),
  // ไม่มี abbr/strip เพราะเป็นค่ากลางสำหรับข้อมูลเก่าที่กรอก org_type ไว้แค่ "เทศบาล" ไม่รู้ว่าระดับไหน
  // autoShortName() จะตกไปใช้ชื่อเต็มแทน ซึ่งถูกกว่าการเดาว่าเป็น ทต./ทม./ทน.
  'เทศบาล':     termSet({ ...MUNICIPAL_TERMS }),
  'อบต.': termSet({
    mayor: 'นายก อบต.', deputyMayor: 'รองนายก อบต.', council: 'สมาชิกสภา อบต.',
    councilPresident: 'ประธานสภา อบต.', clerk: 'ปลัด อบต.', councilOrg: 'สภา อบต.',
    abbr: 'อบต.', strip: 'องค์การบริหารส่วนตำบล',
  }),
  'อบจ.': termSet({
    mayor: 'นายก อบจ.', deputyMayor: 'รองนายก อบจ.', council: 'สมาชิกสภา อบจ.',
    councilPresident: 'ประธานสภา อบจ.', clerk: 'ปลัด อบจ.', councilOrg: 'สภา อบจ.',
    abbr: 'อบจ.', strip: 'องค์การบริหารส่วนจังหวัด',
  }),
}

// org_type ที่ไม่รู้จัก/ยังไม่ได้กรอก ตกมาที่ อบต. ตามพฤติกรรมเดิมของ TenantContext
export const DEFAULT_ORG_TYPE = 'อบต.'

export function getOrgTerms(orgType) {
  return ORG_TERMS[orgType] ?? ORG_TERMS[DEFAULT_ORG_TYPE]
}

// --- org_type ของ อปท. ที่กำลังเปิดอยู่ -----------------------------------------------------------
//
// หนึ่ง session = หนึ่ง อปท. เสมอ (detectTenantSlug() ตัดสินจาก hostname ตอนโหลดหน้า) จึงเก็บเป็น
// module state ได้ แบบเดียวกับ loadHolidays() ใน holidaysSource.js
//
// TenantProvider เรียก setActiveOrgType() ทันทีที่ fetch tenant เสร็จ และ App.jsx กั้นด้วย
// `if (loading) return <splash>` อยู่แล้ว จึงไม่มี component ไหนเรนเดอร์ก่อนค่านี้ถูกตั้ง
// ใช้เมื่ออยู่นอก React (หรือใน component ที่ไม่มี useTenant()) — ถ้ามี context อยู่แล้วให้ใช้
// `terminology` จาก useTenant() ตรงๆ จะได้ re-render ตามเมื่อค่าเปลี่ยน
let activeOrgType = null

export function setActiveOrgType(orgType) {
  activeOrgType = orgType ?? null
}

export function activeOrgTerms() {
  return getOrgTerms(activeOrgType)
}

// --- ป้ายกำกับกลุ่มผู้รับข้อมูล (events.audiences) -------------------------------------------------
//
// เดิมนิยามซ้ำกัน 8 ไฟล์ (EventsManager, EventDetailModal, MiniEventCalendar, EventsPage และ Home
// ของ 4 ธีม) และหลุดกันเองไปแล้วหนึ่งจุด — MiniEventCalendar เคยเขียน management: 'สภาเทศบาล'
export const AUDIENCE_COLOR = {
  public:     '#10b981',
  staff:      '#3b82f6',
  management: '#8b5cf6',
  council:    '#f59e0b',
}

// council เป็น getter ไม่ใช่ค่าคงที่ — โมดูลนี้ถูก import ตั้งแต่ตอนโหลดบันเดิล ซึ่งเป็นเวลาก่อนที่
// TenantProvider จะ fetch อปท. เสร็จ ถ้าคำนวณค่าไว้ตอน import จะได้ค่า fallback ค้างไปตลอด session
export const AUDIENCE_LABEL = {
  public:     'ประชาชน',
  staff:      'เจ้าหน้าที่',
  management: 'ผู้บริหาร',
  get council() { return activeOrgTerms().councilOrg },
}
