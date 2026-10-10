// ตัวช่วยล้วน (ไม่แตะ React/DB) สำหรับเลือกกลุ่มหลัก/ประเภทย่อยของศูนย์ข้อมูลดิจิทัล
// เมื่อตัวเลือกมีเป็นสิบเป็นร้อย — ใช้ร่วมกันระหว่างฟอร์มเพิ่มข้อมูล แผ่นเลือกหมวดบนมือถือ และการ์ดกลุ่มหน้าภาพรวม
//
// ทำไมต้องมี: เดิมโชว์ทุกตัวเลือกเป็นปุ่มเรียงกันหมด ที่ 50 กลุ่มจะยาวราว 17 แถว (~780px) ต่อช่อง
// แล้วดันช่องอื่นของฟอร์มลงไปสองหน้าจอ จึงโชว์แค่ตัวที่ใช้บ่อยสุดไม่กี่ตัว ที่เหลือค้นหาจากแผ่นแยก
//
// กฎทั้งหมดเป็นกฎตรงไปตรงมาที่อธิบายและตรวจย้อนได้ ไม่ใช้ AI/คะแนนเดา — เรียงตามจำนวนรายการจริงในระบบ

// จำนวนปุ่มด่วนสูงสุดต่อช่อง (ไม่นับปุ่มท้ายแถว) — ปรับเลขได้ที่นี่ที่เดียว
export const MAX_QUICK_CHIPS = 8

// เทียบชื่อแบบไม่สนช่องว่างซ้ำ/ช่องว่างหัวท้าย/ตัวพิมพ์ — กันสร้างหมวดซ้ำจากการพิมพ์เพี้ยนเล็กน้อย
// ("ร้านอาหาร " กับ "ร้านอาหาร" ต้องเป็นหมวดเดียวกัน) ไม่เดาความใกล้เคียงของคำสะกดผิดเอง
export function normalizeName(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

// ชื่อที่จะเขียนลงฐานข้อมูลตอนสร้างใหม่ — ตัดช่องว่างซ้ำ/หัวท้าย แต่คงตัวพิมพ์ตามที่ผู้ใช้พิมพ์
export function tidyName(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
}

// รวมรายการจากหลายแหล่ง (ข้อมูลจริงในระบบ + ตัวอย่างตั้งต้น) เป็นชุดเดียว เรียงที่ใช้บ่อยสุดก่อน
// แต่ละแหล่ง = [{ value, count }] ส่ง "ข้อมูลจริง" มาก่อนตัวอย่างตั้งต้นเสมอ
//
// ชื่อที่ตัดช่องว่าง/ตัวพิมพ์แล้วเท่ากันถือเป็นตัวเดียว: รวมจำนวน และเก็บ "ข้อความดิบ" ของตัวที่มีรายการเยอะกว่า
// ไว้เป็นค่าที่ส่งกลับ — ห้ามเอา tidyName มาทับค่าจากฐานข้อมูล เพราะ GROUP BY ฝั่ง RPC เทียบสตริงตรงตัว
// ถ้าเขียนชื่อที่ตัดช่องว่างแล้วกลับไป จะกลายเป็นหมวดใหม่อีกหมวดหนึ่งทั้งที่ผู้ใช้ตั้งใจเลือกหมวดเดิม
export function mergeOptions(...sources) {
  const byKey = new Map()
  for (const source of sources) {
    for (const { value, count = 0 } of source ?? []) {
      const key = normalizeName(value)
      if (!key) continue
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, { value, count, best: count })
      } else {
        prev.count += count
        if (count > prev.best) { prev.value = value; prev.best = count }
      }
    }
  }
  return Array.from(byKey.values())
    .map(({ value, count }) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'th'))
}

export function findOption(options, typed) {
  const key = normalizeName(typed)
  if (!key) return null
  return options.find(o => normalizeName(o.value) === key) ?? null
}

export function filterOptions(options, query) {
  const key = normalizeName(query)
  if (!key) return options
  return options.filter(o => normalizeName(o.value).includes(key))
}

// ปุ่มด่วนที่จะโชว์: ตัวที่ใช้บ่อยสุดไม่เกิน max ตัว และ "ตัวที่เลือกอยู่ต้องโชว์เสมอ"
// - ตัวเลือกไม่เกิน max → โชว์ครบ
// - ตัวที่เลือกอยู่หลุดไปอยู่ท้ายแถว → แทนที่ปุ่มสุดท้าย (ลำดับปุ่มที่เหลือไม่ขยับ ไม่เด้งสลับตอนเลือก)
// - ชื่อที่เลือกแต่ยังไม่มีในระบบ (สร้างใหม่) → โชว์เป็นปุ่มที่ติดป้าย isNew เพื่อให้ผู้ใช้เห็นว่าจะเกิดหมวดใหม่
export function pickVisible(options, selected, max = MAX_QUICK_CHIPS) {
  const chips = options.slice(0, max)
  const key = normalizeName(selected)
  if (!key || chips.some(o => normalizeName(o.value) === key)) return chips

  const inTail = options.find(o => normalizeName(o.value) === key)
  const entry = inTail ?? { value: selected, count: 0, isNew: true }
  if (options.length <= max) chips.push(entry)
  else chips[max - 1] = entry
  return chips
}
