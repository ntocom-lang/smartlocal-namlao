// คำขอที่เจ้าหน้าที่กรอกแทนประชาชนที่เคาน์เตอร์ — ใครเป็นคนกรอก
//
// ทำไมต้องมี: วิซาร์ดคำขอ (น้ำประปา/ขยะ/ช่วยเหลือประชาชน/ยืมพัสดุ/รถรับ-ส่ง) เก็บรหัสเจ้าหน้าที่ผู้กรอกไว้ที่
// permit_form_data.signed_by.entered_by_staff_id ตั้งแต่แรก แต่ไม่มีหน้าจอไหนอ่านไปแสดง — ที่เห็นได้มีแค่
// "ผู้รับผิดชอบ" (assigned_to) ซึ่งแอดมิน/หัวหน้ากองมอบหมายใหม่ได้ เมื่อเปลี่ยนตัวแล้วจะดูไม่ออกว่าใครกรอกตั้งแต่แรก
// (เจ้าของระบบถาม 2569-11-05 "ถ้ามาทำที่เคาน์เตอร์ จะดูตรงไหนว่าเจ้าหน้าที่คนไหนเขียนให้")
//
// ⚠️ ค่านี้เบราว์เซอร์ของเจ้าหน้าที่เขียนมาเอง ฐานข้อมูลยังไม่ได้ประทับรหัสผู้ล็อกอินจริงทับ — ใช้แสดงให้เห็นว่าใครกรอก
// ไม่ใช่หลักฐานตรวจสอบเมื่อมีข้อพิพาท (ถ้าต้องใช้ทางนั้นต้องเพิ่มการประทับฝั่งฐานข้อมูลแยกต่างหาก)
//
// ไฟล์นี้ไม่ import supabase เพื่อให้เทสต์ด้วย node ได้ — ตัวดึงชื่อรับ client เข้ามา

/** รหัสเจ้าหน้าที่ผู้กรอกแทน หรือ null ถ้าไม่ใช่คำขอที่กรอกที่เคาน์เตอร์ (ยื่นออนไลน์เอง/คำขอเก่าที่ไม่มีบันทึก) */
export function counterEntryStaffId(req) {
  const id = req?.permit_form_data?.signed_by?.entered_by_staff_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

/** ข้อความแสดงผู้กรอก — staff = ผลของ fetchCounterEntryStaff (undefined = กำลังโหลด, null = หาไม่เจอ) */
export function counterEntryLabel(staff, staffId) {
  if (staff === undefined) return 'กำลังโหลดชื่อ…'
  const name = staff ? String(staff.name ?? '').trim() : ''
  if (!name) {
    // หาชื่อไม่เจอได้ทั้งกรณีคนนั้นย้าย/ปิดบัญชีแล้ว และกรณีสิทธิ์อ่านรายชื่อไม่ถึง — ไม่เดาสาเหตุ
    // ให้รหัสสั้นไว้ให้แอดมินค้นต่อ (ขึ้นต้นเหมือนเลขอ้างอิงคำขอ: 8 ตัวแรกพิมพ์ใหญ่)
    return `ไม่พบชื่อเจ้าหน้าที่ (รหัส ${String(staffId ?? '').slice(0, 8).toUpperCase()})`
  }
  return staff.department ? `${name} · ${staff.department}` : name
}

/**
 * ดึงชื่อ + กองของเจ้าหน้าที่ผู้กรอก — 2 query เล็กๆ เฉพาะตอนเปิดแผ่นรายละเอียดของคำขอที่กรอกที่เคาน์เตอร์
 * (ไม่ใช้ fetchAssignableStaff เพราะดึงทั้งทะเบียน และตัดคนที่ย้ายบทบาทไปแล้วออก — คนที่กรอกไว้เมื่อก่อนยังต้องเห็นชื่อ)
 * @returns {Promise<{name: string|null, department: string|null}|null>} null = ไม่พบ/อ่านไม่ได้
 */
export async function fetchCounterEntryStaff(client, staffId) {
  if (!staffId) return null
  try {
    const { data: person, error } = await client.from('profiles')
      .select('full_name, email, department_id')
      .eq('id', staffId)
      .maybeSingle()
    if (error || !person) return null
    let department = null
    if (person.department_id) {
      const { data: dept } = await client.from('departments')
        .select('name').eq('id', person.department_id).maybeSingle()
      department = dept?.name ?? null
    }
    return { name: person.full_name || person.email || null, department }
  } catch {
    return null
  }
}
