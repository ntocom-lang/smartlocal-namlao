// ลบบัญชีด้วยตนเอง (ประชาชน) — App Store 5.1.1(v) และ Google Play บังคับให้ผู้ใช้เริ่มลบบัญชีเองได้
// ทั้งในแอปและผ่านหน้าเว็บ ใช้หน้าเดียวกันคือ /account/delete (src/pages/AccountDeletePage.jsx)
// ตัวลบจริงคือ delete_my_account() ในฐานข้อมูล (supabase/migrations/20261101100100)
//
// ⚠️ ข้อความ "อะไรถูกลบ/อะไรถูกเก็บ" ต้องตรงกับกติกา FK ใน 20261101100000 เสมอ — สโตร์บังคับให้บอก
// ผู้ใช้ตามจริงว่าเก็บอะไรไว้ (Play: answer/13327111, Apple: 5.1.1(v)) tests/account-deletion.test.mjs ตรวจคู่กัน

export const ACCOUNT_DELETE_CONFIRM_WORD = 'ลบบัญชี'

export const ACCOUNT_DELETION_REMOVED = [
  'บัญชีและช่องทางเข้าสู่ระบบทั้งหมด (เบอร์โทร/รหัสผ่าน, LINE, Google)',
  'ข้อมูลโปรไฟล์: ชื่อ เบอร์โทร เลขบัตรประชาชน ที่อยู่ และรูปโปรไฟล์',
  'รีวิวสถานที่ท่องเที่ยวที่คุณเขียนไว้',
  'การแจ้งเตือนบนเครื่อง และการเชื่อมต่อ Telegram',
]

export const ACCOUNT_DELETION_KEPT = [
  'คำร้อง คำขอบริการ และการจองรถรับ-ส่งผู้ป่วยที่ยื่นไปแล้ว เป็นเอกสารราชการที่หน่วยงานต้องเก็บรักษาตามระยะเวลาที่กำหนด จึงยังมีชื่อและเบอร์ติดต่อที่กรอกไว้ในเรื่องนั้น แต่จะไม่ผูกกับบัญชีใดอีก',
  'คะแนนความพึงพอใจที่เคยให้ ยังนับรวมในสถิติโดยไม่ผูกกับตัวคุณ',
  'บันทึกว่ามีการลบบัญชีเกิดขึ้นเมื่อใด โดยไม่มีชื่อ เบอร์ หรืออีเมล',
]

export const ACCOUNT_DELETION_STAFF_NOTE =
  'บัญชีเจ้าหน้าที่ลบเองไม่ได้ เพราะผูกกับงานที่ได้รับมอบหมายและลายเซ็นในเอกสาร กรุณาติดต่อผู้ดูแลระบบของหน่วยงาน'

// ไม่มี role = บัญชีที่ยังไม่มีแถว profiles (สมัคร LINE/Google แล้วสร้างโปรไฟล์ไม่ทัน) ถือเป็นประชาชน
// ฐานข้อมูลตัดสินซ้ำอีกชั้นเสมอ หน้าจอแค่ไม่โชว์ปุ่มให้เจ้าหน้าที่กดแล้วเจอ error
export function canSelfDeleteRole(role) {
  return !role || role === 'citizen'
}

// ไม่สนช่องว่าง — แป้นไทยบนมือถือชอบเว้นวรรคเกินมาเอง ผู้สูงอายุพิมพ์ถูกแล้วกดไม่ได้จะงง
export function isDeleteConfirmed(text) {
  return String(text ?? '').replace(/\s+/g, '') === ACCOUNT_DELETE_CONFIRM_WORD
}

export class AccountDeletionError extends Error {
  constructor(step, message) {
    super(message)
    this.name = 'AccountDeletionError'
    this.step = step
  }
}

/**
 * ลบรูปโปรไฟล์ แล้วลบบัญชี — โยน AccountDeletionError เมื่อขั้นไหนไม่สำเร็จ (บัญชียังอยู่ครบ)
 *
 * รูปต้องลบก่อนบัญชี: นโยบาย Storage ของ bucket avatars ผูกโฟลเดอร์กับ auth.uid() หลังลบบัญชีแล้ว
 * จะไม่มีใครลบภาพใบหน้านี้ผ่านแอปได้อีก ถ้าลบรูปไม่ได้จึงหยุดทั้งหมด ไม่ลบบัญชีทิ้งรูปค้าง
 *
 * @param {object} client supabase client
 * @param {string} userId session.user.id
 */
export async function deleteMyAccount(client, userId) {
  if (!userId) throw new AccountDeletionError('session', 'no user id')

  const bucket = client.storage.from('avatars')
  const { data: files, error: listError } = await bucket.list(userId)
  if (listError) throw new AccountDeletionError('avatar', listError.message)

  const paths = (files ?? []).map((file) => `${userId}/${file.name}`)
  if (paths.length > 0) {
    const { data: removed, error: removeError } = await bucket.remove(paths)
    // Storage ตอบ 200 พร้อมรายการว่างเมื่อนโยบายไม่ให้ลบ (ไม่ใช่ error) ต้องนับเองว่าลบครบไหม
    if (removeError || (removed?.length ?? 0) < paths.length) {
      throw new AccountDeletionError('avatar', removeError?.message ?? `removed ${removed?.length ?? 0}/${paths.length}`)
    }
  }

  const { error } = await client.rpc('delete_my_account')
  if (error) throw new AccountDeletionError('rpc', error.message)
}

/**
 * ส่วนของแอดมินลบบัญชีคนอื่น (AdminDashboard.deleteUser) — ไฟล์รูปอยู่ในโฟลเดอร์ของเจ้าของบัญชี
 * แอดมินลบไฟล์ของคนที่ยังมีบัญชีไม่ได้ (นโยบายอนุญาตเฉพาะโฟลเดอร์ที่เจ้าของไม่อยู่แล้ว:
 * 20261103100100) จึงต้องแยกเป็น 2 จังหวะ: จำชื่อไฟล์ก่อนลบบัญชี แล้วลบหลังบัญชีหายสำเร็จ
 * ลำดับนี้ยังกันกรณีลบบัญชีไม่ผ่านเพราะมีงานค้าง — รูปของคนที่ยังอยู่ต้องไม่หายตามไปด้วย
 */

/**
 * อ่านชื่อไฟล์รูปของผู้ใช้ก่อนลบบัญชี — ไม่โยน error เพราะต้องไม่ขวางการลบบัญชีที่แอดมินสั่ง
 * @returns {Promise<{ paths: string[], ok: boolean }>} ok=false = อ่านรายการไม่ได้ (ไม่รู้ว่ามีรูปค้างไหม)
 */
export async function listAvatarPaths(client, userId) {
  if (!userId) return { paths: [], ok: false }
  try {
    const { data, error } = await client.storage.from('avatars').list(userId)
    if (error) return { paths: [], ok: false }
    return { paths: (data ?? []).map((file) => `${userId}/${file.name}`), ok: true }
  } catch {
    return { paths: [], ok: false }
  }
}

/**
 * ลบรูปที่จำไว้หลังบัญชีหายแล้ว — Storage ตอบ 200 พร้อมรายการว่างเมื่อนโยบายไม่ให้ลบ จึงนับเองว่าครบไหม
 * @returns {Promise<number>} จำนวนไฟล์ที่ลบไม่สำเร็จ (0 = ไม่เหลือรูปค้าง)
 */
export async function removeOrphanAvatars(client, paths) {
  if (!paths?.length) return 0
  try {
    const { data, error } = await client.storage.from('avatars').remove(paths)
    if (error) return paths.length
    return Math.max(0, paths.length - (data?.length ?? 0))
  } catch {
    return paths.length
  }
}

export function accountDeletionErrorText(err) {
  if (err?.step === 'avatar') return 'ลบรูปโปรไฟล์ไม่สำเร็จ บัญชีของคุณยังไม่ถูกลบ กรุณาลองใหม่อีกครั้ง'
  if (err?.step === 'session') return 'ไม่พบการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง'
  // ข้อความภาษาไทยจาก delete_my_account() (เช่น บัญชีเจ้าหน้าที่) เขียนไว้ให้ผู้ใช้อ่านโดยตรง
  const message = String(err?.message ?? '')
  if (/[฀-๿]/.test(message)) return message
  return 'ลบบัญชีไม่สำเร็จ บัญชีของคุณยังไม่ถูกลบ กรุณาลองใหม่อีกครั้ง'
}
