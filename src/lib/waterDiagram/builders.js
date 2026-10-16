// ตัวสร้าง element ของผังน้ำ (ใช้ร่วมทุกตำบล) — ย้ายมาจาก thungkaew.js คัดลอกตรงตัว ไม่เปลี่ยนพฤติกรรม
// พิกัดอยู่ในระบบเดียวกับภาพต้นฉบับของศูนย์ฯ แพร่ (กว้าง 2000 × สูง 1125)

export const E = (cls, d, o = {}) => ({ kind: 'edge', cls, d, status: 'existing', arrow: true, ...o })
export const T = (x, y, t, o = {}) => ({ kind: 'text', x, y, t, ...o })
// ฝาย: o = h (แท่งนอน) | v (แท่งตั้ง) · w = ความยาว · extra = { t: ความหนา, status, id }
export const W = (x, y, o = 'h', w = 40, extra = {}) => ({ kind: 'weir', x, y, o, w, ...extra })
export const RESERVOIR = (id, x, y, s = 34) => ({ kind: 'reservoir', id, x, y, s })
export const POND = (id, x, y, r = 44) => ({ kind: 'pond', id, x, y, r })
// เส้นขอบเขต: cls = tambon (เขตตำบล จุดเขียว) | village (เขตหมู่บ้าน เส้นประเทา)
export const OUTLINE = (cls, d, o = {}) => ({ kind: 'outline', cls, d, ...o })
// สะพาน: o = h (ลำน้ำไหลแนวนอน) | v (ลำน้ำไหลแนวตั้ง)
export const BRIDGE = (x, y, o = 'h', extra = {}) => ({ kind: 'bridge', x, y, o, ...extra })

// ลำห้วยสาขาที่ไหลเข้าลำหลักจากข้าง: ลูกศรนิ่ง + ป้ายชื่อ
export const sideCreeks = (rows, labelY, labelDx = 0) => rows.flatMap(([x1, y1, x2, y2, name, lift]) => [
  E('minor', `M${x1} ${y1} L${x2} ${y2}`),
  T((x1 + x2) / 2 + labelDx, y1 - (lift ?? labelY), name, { s: 19 }),
])
