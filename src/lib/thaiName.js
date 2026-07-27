export const NAME_TITLES = ['นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.']

// ข้อมูลเก่าเก็บชื่อเต็มเป็นสตริงเดียว (เช่น "นาย สมชาย ใจดี") ไม่ได้แยกคำนำหน้า/ชื่อ/
// นามสกุลไว้ล่วงหน้า — ใช้แกะตอนเติมฟอร์ม 3 ช่องอัตโนมัติ (เดาผิดได้ถ้าไม่มีคำนำหน้าหรือ
// นามสกุลมีช่องว่าง แต่ผู้ใช้แก้เองในฟอร์มได้อยู่แล้ว ไม่ใช่จุดที่ critical)
export function splitThaiFullName(fullName) {
  const trimmed = (fullName ?? '').trim()
  if (!trimmed) return { title: '', first: '', last: '' }
  const title = NAME_TITLES.find(t => trimmed.startsWith(t)) ?? ''
  const rest = trimmed.slice(title.length).trim()
  const [first = '', ...restParts] = rest.split(/\s+/)
  return { title, first, last: restParts.join(' ') }
}

export function joinThaiFullName(title, first, last) {
  return [title, (first ?? '').trim(), (last ?? '').trim()].filter(Boolean).join(' ')
}
