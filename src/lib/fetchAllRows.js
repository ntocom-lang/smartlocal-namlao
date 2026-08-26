// ดึงผลลัพธ์ให้ครบทุกแถวโดยไม่พึ่งค่า db-max-rows ของ PostgREST
//
// ทำไมต้องมี: PostgREST จำกัดจำนวนแถวต่อ response ด้วยค่า db-max-rows ระดับโปรเจกต์
// ซึ่งฝั่ง client มองไม่เห็นและตรวจสอบไม่ได้ query ที่ไม่ระบุ .range() จึงถูก "ตัดแถวเงียบๆ"
// เมื่อข้อมูลโตเกินเพดาน — ไม่มี error ไม่มีสัญญาณเตือน ได้ข้อมูลไม่ครบมาเฉยๆ
//
// จุดที่อันตรายคือรายงานที่รวมยอดเงินฝั่ง client (ค่าน้ำมัน/ค่าซ่อม) เพราะยอดจะ "ต่ำกว่าจริง"
// แบบดูไม่ออก แล้วตัวเลขนั้นถูกเอาไปเสนอผู้บริหารและใช้ตรวจสอบ
//
// วิธีแก้: ไล่ดึงเป็นก้อนด้วย .range() จนกว่าจะได้ 0 แถว แล้วเลื่อน offset ตามจำนวนที่ได้จริง
// (ไม่ใช่ตามขนาดก้อนที่ขอ) เพราะถ้า db-max-rows ต่ำกว่าขนาดก้อน server จะคืนน้อยกว่าที่ขอ
// การเลื่อนตามขนาดก้อนจะข้ามแถวหายไป

const CHUNK = 1000
const MAX_PAGES = 200 // เพดานกันลูปไม่รู้จบ (~200k แถว) เผื่อ server ตอบผิดปกติ

/**
 * ⚠️ query ที่ส่งเข้ามา "ต้องมี ORDER BY ที่ชี้ขาดได้" เสมอ (ปิดท้ายด้วย .order('id'))
 * PostgreSQL ไม่รับประกันลำดับแถวถ้าไม่ระบุ ORDER BY และการเรียงด้วยคอลัมน์ที่ค่าซ้ำกันได้
 * (เช่น filled_at, service_date) ก็ยังไม่ชี้ขาดเมื่อมีแถวที่ค่าเท่ากันคาบเกี่ยวรอยต่อหน้า
 * ผลคือดึงซ้ำบางแถวและตกหล่นบางแถวโดยไม่มีสัญญาณ — ซึ่งร้ายกว่าการถูกตัดแถวที่ตั้งใจแก้
 * เพราะยอดรวมจะ "เพี้ยน" แทนที่จะ "ขาด"
 *
 * @param {() => object} buildQuery ฟังก์ชันที่ "สร้าง query builder ใหม่ทุกครั้งที่เรียก"
 *   ต้องสร้างใหม่เสมอ — Supabase query builder ใช้ซ้ำหลัง await ไม่ได้
 * @returns {Promise<{data: any[]|null, error: any, truncated: boolean}>}
 *   truncated = true เมื่อชนเพดาน MAX_PAGES (ข้อมูลที่ได้ไม่ครบ ต้องแจ้งผู้ใช้)
 */
export async function fetchAllRows(buildQuery) {
  const rows = []
  let from = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await buildQuery().range(from, from + CHUNK - 1)
    if (error) return { data: null, error, truncated: false }
    const batch = data ?? []
    if (batch.length === 0) return { data: rows, error: null, truncated: false }
    rows.push(...batch)
    from += batch.length
  }
  return { data: rows, error: null, truncated: true }
}
