export const NAME_TITLES = ['นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.']

// ข้อมูลเก่าเก็บชื่อเต็มเป็นสตริงเดียว (เช่น "นาย สมชาย ใจดี") ไม่ได้แยกคำนำหน้า/ชื่อ/
// นามสกุลไว้ล่วงหน้า — ใช้แกะตอนเติมฟอร์ม 3 ช่องอัตโนมัติ (เดาผิดได้ถ้าไม่มีคำนำหน้าหรือ
// นามสกุลมีช่องว่าง แต่ผู้ใช้แก้เองในฟอร์มได้อยู่แล้ว ไม่ใช่จุดที่ critical)
export function splitThaiFullName(fullName) {
  const trimmed = (fullName ?? '').trim()
  if (!trimmed) return { title: '', first: '', last: '' }
  // ต้องหาคำนำหน้าที่ "ยาวที่สุด" ที่ตรงกัน ไม่ใช่ตัวแรกที่เจอตามลำดับ array — "นางสาว" ขึ้นต้นด้วย
  // "นาง" เอง ถ้าใช้ .find() ธรรมดาจะแมตช์ "นาง" ก่อนเสมอ (เพราะอยู่ก่อนในลิสต์) ตัด "สาว" ไปติด
  // หน้าชื่อจริงแทน เช่น "นางสาวพรรณทิพา" จะแยกผิดเป็นคำนำหน้า "นาง" + ชื่อ "สาวพรรณทิพา"
  const title = NAME_TITLES
    .filter(t => trimmed.startsWith(t))
    .sort((a, b) => b.length - a.length)[0] ?? ''
  const rest = trimmed.slice(title.length).trim()
  const [first = '', ...restParts] = rest.split(/\s+/)
  return { title, first, last: restParts.join(' ') }
}

export function joinThaiFullName(title, first, last) {
  return [title, (first ?? '').trim(), (last ?? '').trim()].filter(Boolean).join(' ')
}
