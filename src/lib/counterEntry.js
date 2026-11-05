// คำขอที่เจ้าหน้าที่กรอกแทนประชาชนที่เคาน์เตอร์ — ใครเป็นคนกรอก
//
// ทำไมต้องมี: วิซาร์ดคำขอ (น้ำประปา/ขยะ/ช่วยเหลือประชาชน/ยืมพัสดุ/รถรับ-ส่ง) เก็บรหัสเจ้าหน้าที่ผู้กรอกไว้ที่
// permit_form_data.signed_by.entered_by_staff_id ตั้งแต่แรก แต่ไม่มีหน้าจอไหนอ่านไปแสดง — ที่เห็นได้มีแค่
// "ผู้รับผิดชอบ" (assigned_to) ซึ่งแอดมิน/หัวหน้ากองมอบหมายใหม่ได้ เมื่อเปลี่ยนตัวแล้วจะดูไม่ออกว่าใครกรอกตั้งแต่แรก
// (เจ้าของระบบถาม 2569-11-05 "ถ้ามาทำที่เคาน์เตอร์ จะดูตรงไหนว่าเจ้าหน้าที่คนไหนเขียนให้")
//
// แหล่งข้อมูล 2 ชั้น (เจ้าของระบบสั่งเพิ่มชั้นที่ 1 2569-11-05):
//   1) document_requests.created_by_uid — ฐานข้อมูลประทับ auth.uid() จริงตอน INSERT (migration 20261105110000/20261105110100)
//      ไม่เชื่อค่าจากเบราว์เซอร์ แก้ภายหลังไม่ได้ → ใช้เป็นหลักฐานได้ (ยืนยันแล้ว: verified)
//   2) permit_form_data.signed_by.entered_by_staff_id — เบราว์เซอร์ของเจ้าหน้าที่เขียนมาเอง ใครแก้ฟอร์มก่อนส่งก็ใส่ชื่อคนอื่นได้
//      ใช้เฉพาะแถวเก่าก่อนมี created_by_uid เท่านั้น และต้องบอกบนหน้าจอว่ายังไม่ได้ยืนยัน (verified: false)
// ถ้าสองชั้นขัดกัน เชื่อชั้นที่ 1 และเตือน (mismatch) — ฟอร์มอ้างชื่อหนึ่งแต่บัญชีที่กดบันทึกจริงเป็นอีกคน
//
// ⚠️ รอยนี้บอกว่า "บัญชีไหนกดบันทึก" เท่านั้น ถ้าเจ้าหน้าที่ยืมบัญชีกันกรอก รอยจะชี้เจ้าของบัญชี
//
// ไฟล์นี้ไม่ import supabase เพื่อให้เทสต์ด้วย node ได้ — ตัวดึงชื่อรับ client เข้ามา

const asId = value => (typeof value === 'string' && value.trim() ? value.trim() : null)

/**
 * ข้อมูลผู้กรอกแทนที่เคาน์เตอร์ของคำขอ หรือ null ถ้าไม่ใช่คำขอที่กรอกแทน (ยื่นออนไลน์เอง/คำขอเก่าที่ไม่มีบันทึก)
 * @returns {{staffId: string, verified: boolean, mismatch: boolean}|null}
 */
export function counterEntryOf(req) {
  const stamped = asId(req?.created_by_uid)
  const claimed = asId(req?.permit_form_data?.signed_by?.entered_by_staff_id)
  if (stamped) {
    // บัญชีที่กดบันทึกคือเจ้าของคำขอเอง = ผู้ขอยื่นเอง (ล็อกอินยื่นออนไลน์) ไม่ใช่กรอกแทน
    if (asId(req?.user_id) === stamped) return null
    return { staffId: stamped, verified: true, mismatch: Boolean(claimed && claimed !== stamped) }
  }
  // แถวเก่าก่อนมีการประทับ (หรือฐานยังไม่ได้ apply migration) — ใช้ค่าที่ฟอร์มอ้าง พร้อมบอกว่ายังไม่ยืนยัน
  if (claimed) return { staffId: claimed, verified: false, mismatch: false }
  return null
}

/** บรรทัดเล็กใต้ชื่อผู้กรอก — บอกระดับความเชื่อถือของชื่อ ไม่ให้แถวเก่าดูเหมือนฐานข้อมูลยืนยันแล้ว */
export function counterEntryNote(entry) {
  if (!entry) return ''
  if (!entry.verified) return 'ที่เคาน์เตอร์ · ⚠️ บันทึกก่อนระบบประทับรหัส ชื่อนี้ยังไม่ได้ยืนยันโดยระบบ'
  if (entry.mismatch) return 'ที่เคาน์เตอร์ · ⚠️ ฟอร์มอ้างชื่ออีกคน แต่ระบบประทับจากบัญชีที่กดบันทึกจริง (แสดงตามบัญชีจริง)'
  return 'ที่เคาน์เตอร์ · ระบบประทับจากบัญชีที่กดบันทึกจริง'
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
