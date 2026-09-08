// คำเรียกที่เปลี่ยนไปตามประเภทหน่วยงาน (municipalities.org_type) — แหล่งความจริงเดียวของทั้งระบบ
//
// เดิมมีแค่ TERMINOLOGY ใน TenantContext.jsx ซึ่งเก็บคำเรียก "คน" (นายกฯ, ปลัด, สมาชิกสภา) แต่ไม่มี
// คำเรียก "องค์กร" ทำให้ 12 จุดในโค้ดไป hardcode คำว่า 'สภาเทศบาล' เอาเอง ผลคือ อปท. ที่เป็น อบต.
// (tamnaktham, thungkaew) เห็นป้ายกำกับกลุ่มผู้รับข้อมูลในปฏิทินกิจกรรม/หน้าจัดการผู้ใช้ เป็น
// "สภาเทศบาล" ทั้งที่ต้องเป็น "สภา อบต." — ย้ายมารวมที่นี่ที่เดียว ใครต้องใช้ import แทนการนิยามเอง

function termSet({ mayor, deputyMayor, council, councilPresident, clerk, councilOrg, office, abbr, strip }) {
  return { mayor, deputyMayor, council, councilPresident, clerk, councilOrg, office, abbr, strip }
}

// office = ชื่อสถานที่ราชการของ อปท. ใช้ในประโยคแบบ "ชำระเงิน ณ ..." / "ติดต่อรับเอกสาร ณ ..."
// เขียนให้ต่อท้ายคำว่า "ณ" ได้พอดี ห้ามขึ้นต้นด้วยคำว่า "ที่" ในประโยคที่มี "ที่" นำอยู่แล้ว
// (เทศบาลใช้ "สำนักงานเทศบาล" ส่วน อบต. ตามระเบียบเรียก "ที่ทำการ")
const MUNICIPAL_TERMS = {
  mayor: 'นายกเทศมนตรี',
  deputyMayor: 'รองนายกเทศมนตรี',
  council: 'สมาชิกสภาเทศบาล',
  councilPresident: 'ประธานสภาเทศบาล',
  clerk: 'ปลัดเทศบาล',
  councilOrg: 'สภาเทศบาล',
  office: 'สำนักงานเทศบาล',
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
    office: 'ที่ทำการ อบต.',
    abbr: 'อบต.', strip: 'องค์การบริหารส่วนตำบล',
  }),
  'อบจ.': termSet({
    mayor: 'นายก อบจ.', deputyMayor: 'รองนายก อบจ.', council: 'สมาชิกสภา อบจ.',
    councilPresident: 'ประธานสภา อบจ.', clerk: 'ปลัด อบจ.', councilOrg: 'สภา อบจ.',
    office: 'สำนักงาน อบจ.',
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

// --- คำขึ้นต้น "เรียน" ในหนังสือราชการ ------------------------------------------------------------
//
// ต่างจาก terms.mayor ตรงที่ต้องมี "ชื่อหน่วยงาน" ต่อท้ายด้วย — ในหนังสือที่ประชาชนยื่นถึง อปท.
// จ่าหน้าว่า "เรียน นายกองค์การบริหารส่วนตำบลทุ่งแค้ว" ไม่ใช่ "เรียน นายก อบต." ซึ่งเป็นคำเรียก
// ตำแหน่งแบบย่อที่ใช้ในหน้าจอระบบ
//
// เทศบาลตัดคำว่า "เทศบาล" ออกก่อนต่อท้าย เพราะตำแหน่งคือ "นายกเทศมนตรี" อยู่แล้ว
// (เทศบาลตำบลน้ำเลา → นายกเทศมนตรีตำบลน้ำเลา) ส่วน อบต./อบจ. ต่อชื่อเต็มได้เลย
// (องค์การบริหารส่วนตำบลทุ่งแค้ว → นายกองค์การบริหารส่วนตำบลทุ่งแค้ว)
//
// ตัดสินจาก "ชื่อหน่วยงาน" เป็นหลักไม่ใช่ org_type เพราะ org_type ของข้อมูลเก่าบางแถวว่าง
// หรือกรอกไว้แค่ "เทศบาล" โดยไม่ระบุระดับ
export function orgHeadTitle(tenant) {
  const name = (typeof tenant === 'string' ? tenant : tenant?.name)?.trim() || 'หน่วยงาน'
  const orgType = typeof tenant === 'string' ? '' : (tenant?.org_type ?? '')
  if (name.startsWith('เทศบาล') || String(orgType).startsWith('เทศบาล')) {
    const locality = name.replace(/^เทศบาล\s*/, '').trim()
    return locality ? `นายกเทศมนตรี${locality}` : 'นายกเทศมนตรี'
  }
  return `นายก${name}`
}

// --- ชื่อเต็มของสถานที่ราชการ ---------------------------------------------------------------------
//
// ต่างจาก terms.office ตรงที่ต้องมี "ชื่อหน่วยงาน" ต่อท้ายด้วย — ใช้กับบรรทัด "เขียนที่" ในแบบคำขอ
// ที่ประชาชนยื่น ซึ่งต้องระบุสถานที่เต็ม ("ที่ทำการองค์การบริหารส่วนตำบลทุ่งแค้ว") ไม่ใช่คำเรียก
// แบบย่อที่ใช้ในหน้าจอระบบ ("ที่ทำการ อบต.")
//
// เทศบาลใช้ "สำนักงาน" + ชื่อเต็ม (สำนักงานเทศบาลตำบลน้ำเลา) ส่วน อบต./อบจ. ตามระเบียบเรียก
// "ที่ทำการ" + ชื่อเต็ม (ที่ทำการองค์การบริหารส่วนตำบลทุ่งแค้ว)
//
// ตัดสินจาก "ชื่อหน่วยงาน" เป็นหลักไม่ใช่ org_type ด้วยเหตุผลเดียวกับ orgHeadTitle — org_type
// ของข้อมูลเก่าบางแถวว่างหรือกรอกไว้แค่ "เทศบาล" โดยไม่ระบุระดับ
// คำนำหน้าชื่อหน่วยงานทั้งหมดที่ระบบรู้จัก เรียงยาวไปสั้นเพื่อให้ "เทศบาลตำบล" ชนะ "เทศบาล"
// (ถ้าเรียงสลับกัน ชื่อ "เทศบาลตำบลน้ำเลา" จะถูกตัดเหลือ locality = "ตำบลน้ำเลา" ซึ่งผิด)
const ORG_NAME_PREFIXES = [...new Set(Object.values(ORG_TERMS).map(t => t.strip).filter(Boolean))]
  .sort((a, b) => b.length - a.length)

/**
 * แยกชื่อหน่วยงานเป็น "คำนำหน้า + ชื่อท้องถิ่น" — เช่น
 * "องค์การบริหารส่วนตำบลทุ่งแค้ว" → { prefix: 'องค์การบริหารส่วนตำบล', locality: 'ทุ่งแค้ว' }
 *
 * ใช้กับเอกสารที่พิมพ์ออกกระดาษ: ชื่อหน่วยงานกลางประโยคไม่มีช่องว่างคั่น เบราว์เซอร์จึงตัด
 * บรรทัดตามพจนานุกรมแล้วได้ "…ตำบลทุ่งแค้" ค้างท้ายบรรทัด ส่วน "ว" ไปขึ้นบรรทัดใหม่
 * การครอบ nowrap ทั้งก้อนแก้อาการนั้นได้ แต่ทำให้เกิดช่องว่างค้างท้ายบรรทัดก่อนหน้ายาวมาก
 * (ชื่อ อบต. ยาวถึง ~68 มม.) พอจัดชิดขอบแล้วกลายเป็นรูโหว่กลางย่อหน้า
 *
 * แยกสองส่วนแล้วอนุญาตให้ขึ้นบรรทัดใหม่ได้เฉพาะรอยต่อนี้จุดเดียว — เป็นรอยตัดที่อ่านออก
 * ตามความหมายจริง ไม่ใช่ตัดกลางคำ
 *
 * ชื่อที่ไม่ขึ้นต้นด้วยคำนำหน้าที่รู้จัก คืน locality เป็นค่าว่าง ผู้เรียกต้องพิมพ์ prefix อย่างเดียว
 * @param {{ name?: string } | string | null | undefined} tenantOrName
 */
export function orgNameParts(tenantOrName) {
  const name = (typeof tenantOrName === 'string' ? tenantOrName : tenantOrName?.name)?.trim() || 'หน่วยงาน'
  const prefix = ORG_NAME_PREFIXES.find(part => name.startsWith(part) && name.length > part.length)
  return prefix
    ? { prefix, locality: name.slice(prefix.length).trim() }
    : { prefix: name, locality: '' }
}

export function orgOfficeName(tenant) {
  const name = (typeof tenant === 'string' ? tenant : tenant?.name)?.trim() || 'หน่วยงาน'
  const orgType = typeof tenant === 'string' ? '' : (tenant?.org_type ?? '')
  if (name.startsWith('เทศบาล') || String(orgType).startsWith('เทศบาล')) {
    return `สำนักงาน${name}`
  }
  return `ที่ทำการ${name}`
}
