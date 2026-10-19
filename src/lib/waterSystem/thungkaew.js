// ระบบน้ำของตำบลทุ่งแค้ว อ.หนองม่วงไข่ — ข้อมูลล้วน (ตรรกะอยู่ model.js) · ถอดเมื่อ 2569-10-19
// ที่มา (ศูนย์บริหารจัดการน้ำจังหวัดแพร่ · phraepao.go.th/officechief/water):
//   · ผังน้ำตำบลทุ่งแค้ว (9 พ.ค. 2567) — แกนของระบบนี้ · รายละเอียดในตำบลอยู่ที่ผังเคลื่อนไหว src/lib/waterDiagram/thungkaew.js (ไม่ซ้ำที่นี่)
//   · ผังน้ำจังหวัดแพร่ — ไฟล์บนเซิร์ฟเวอร์ลงวันที่ 8 ส.ค. 2568 (ภาพไม่ระบุวันที่ในตัว) · ETag 546a22c6408dc1:0
//   · ตำบลเพื่อนบ้าน (เวียงต้า อ.ลอง · น้ำรัด · วังหลวง · หัวเมือง อ.สอง) ไม่ได้ถอด — ผังตำบลทุ่งแค้วเริ่มห้วยทั้ง 3 ลุ่มที่ขอบบนของตัวเอง
//
// กติกา (ดีไซน์ฉบับปิด D1–D22): ไม่เขียนความจุอ่างจากผัง (ผังขัดกับรายงานจริง) · ความสัมพันธ์ที่ผังไม่ยืนยัน = status 'unconfirmed'
// · ไม่เดาทิศน้ำ/จุดต่อ · ตำบลนี้ไม่มีอ่างขนาดกลางใน ThaiWater — อ่างที่มีค่าคืออ่างเล็กของศูนย์ฯ แพร่ 2 แห่ง (รายสัปดาห์ พิมพ์มือ ไม่ใช่ค่าสด)
// รูปแบบ node ดูที่ namlao.js
export const THUNGKAEW_SYSTEM = {
  id: 'thungkaew',
  tambon: 'ทุ่งแค้ว',
  amphoe: 'หนองม่วงไข่',
  summary: '3 ลุ่มห้วยของตำบลเอง (ห้วยเฮือ · ห้วยยอย · ห้วยปุ่ย) มีอ่างอยู่ต้นสายทุกลุ่ม ไหลลงแม่น้ำยมที่ขอบล่าง และมีคลองชลประทานฝั่งขวาตัดขวางกลางตำบล',
  originalUrl: 'https://www.phraepao.go.th/officechief/water/map_water_r.php',
  sources: [
    { id: 'thungkaew', name: 'ผังน้ำตำบลทุ่งแค้ว อ.หนองม่วงไข่', date: '2024-05-09' },
    { id: 'province', name: 'ผังน้ำจังหวัดแพร่', date: '2025-08-08', fileDateOnly: true },
  ],

  // นับของที่ผังตำบลวาดไว้ (ตรวจกับผังเคลื่อนไหวแล้ว: อ่าง/สระ/แผนก่อสร้างตรงกับข้อมูลผัง — เทสต์ตรวจให้)
  counts: { reservoirs: 3, weirs: 27, ponds: 3, pondLabel: 'หนอง', tributaries: 23, planned: 3 },

  upstream: [
    { id: 'up-weir-yom', name: 'ฝายแม่ยม (ฝายคอนกรีตขนาดใหญ่) อ.สอง', kind: 'weir', role: 'upstream', status: 'existing', source: 'province', bind: null,
      note: 'ผังจังหวัดวาดเป็นต้นทางของคลองส่งน้ำ · ผังตำบลตั้งชื่อคลองว่า "คลองชลประทานฝายแม่ยมฝั่งขวา" แต่ไม่วาดต้นคลอง' },
    { id: 'up-yom', name: 'แม่น้ำยม ตามขอบล่างของตำบล', kind: 'stream', role: 'upstream', status: 'existing', source: 'thungkaew', bind: null,
      note: 'ฝั่งตรงข้ามคือ ต.หัวเมือง อ.สอง · ผังจังหวัดวาดแม่น้ำยมไหลเหนือ → ใต้' },
    { id: 'up-outside-left', name: 'ห้วยโป่งนก · ห้วยม่วง (ซ้าย ติด ต.น้ำรัด)', kind: 'stream', role: 'upstream', status: 'unconfirmed', source: 'thungkaew', bind: null,
      note: 'ผังวาดเป็นรางหรือช่องเล็กลงคลอง ไม่บอกต้นทาง' },
    { id: 'up-outside-top', name: 'ต้นสายห้วยเฮือ · ห้วยยอย · ห้วยปุ่ย (ขอบบน ติด ต.เวียงต้า อ.ลอง)', kind: 'stream', role: 'upstream', status: 'unconfirmed', source: 'thungkaew', bind: null,
      note: 'ผังเริ่มเส้นที่ขอบบนของตำบล ไม่ระบุแหล่งต้นน้ำนอกตำบล — ไม่ได้เขียนว่า "ไม่มี"' },
  ],

  inside: [
    { id: 'in-res-hue', name: 'อ่างเก็บน้ำห้วยเฮือ (รับห้วยสาขา 7 สาย)', kind: 'reservoir', role: 'inside', status: 'existing', source: 'thungkaew', bind: null,
      note: 'ไม่มีหน้ารายงานของศูนย์ฯ และไม่อยู่ใน ThaiWater' },
    { id: 'in-res-yoi', name: 'อ่างเก็บน้ำห้วยยอย (รับห้วยสาขา 13 สาย + ฝาย 4 แห่ง)', kind: 'reservoir', role: 'inside', status: 'existing', source: 'thungkaew',
      bind: { type: 'small-reservoir', code: '50' },
      note: 'มีรายงานรายสัปดาห์ของศูนย์ฯ แพร่ (พิมพ์มือ ไม่ใช่ค่าสด) ที่การ์ดอ่างเก็บน้ำขนาดเล็กของหน้านี้' },
    { id: 'in-res-pui', name: 'อ่างห้วยปุ่ย (รับห้วยแกด · ห้วยปุ่ย · ห้วยปุ่ยน้อย)', kind: 'reservoir', role: 'inside', status: 'existing', source: 'thungkaew',
      bind: { type: 'small-reservoir', code: '30' },
      note: 'รายงานของศูนย์ฯ ใช้ชื่อ "อ่างเก็บน้ำห้วยปุย" · รายสัปดาห์ (พิมพ์มือ ไม่ใช่ค่าสด) ที่การ์ดอ่างเก็บน้ำขนาดเล็กของหน้านี้' },
    { id: 'in-rain-res038', name: 'สถานีฝนที่อ่างห้วยยอย', kind: 'rain', role: 'inside', status: 'existing', source: 'thungkaew',
      bind: { type: 'rain', code: 'RES038' }, note: 'ห่างสำนักงาน 1.8 กม.' },
    { id: 'in-weirs', name: 'ฝายตามห้วยและคลองประมาณ 27 แห่ง', kind: 'weir', role: 'inside', status: 'existing', source: 'thungkaew', bind: null,
      note: 'ฝายซอยซีเมนต์ · ฝายซีเมนต์ (อบต.) · ฝายกำนันอำพร · ฝาย ผข.เดช · ฝายยากี · ฝายปู่อ๋วน ฯลฯ (ฝายเรียงต่อกันตามห้วยยอย)' },
    { id: 'in-streams', name: 'ห้วยสาขาประมาณ 23 สาย', kind: 'stream', role: 'inside', status: 'existing', source: 'thungkaew', bind: null,
      note: 'ห้วยเฮือ 7 สาย · ห้วยยอย 13 สาย · ห้วยแกด ห้วยปุ่ย ห้วยปุ่ยน้อย · ยังมีห้วยกลางผังอีก 4 เส้นที่อ่านชื่อไม่ชัด (ไม่นับรวม)' },
    { id: 'in-canal', name: 'คลองชลประทานฝายแม่ยมฝั่งขวา', kind: 'canal', role: 'inside', status: 'existing', source: 'thungkaew', bind: null,
      note: 'ตัดขวางกลางตำบล ผังวาดลูกศรสองปลาย ไม่ระบุทิศน้ำ · ลำเหมืองแม่หม้ายแยกจากฝายปู่อ๋วนไปทางตะวันตก' },
    { id: 'in-ponds', name: 'หนองใหม่ก่อ → หนองหลวง → หนองน้อย', kind: 'pond', role: 'inside', status: 'existing', source: 'thungkaew', bind: null,
      note: 'น้ำไหลตามลูกศรในผังไปทางหนองน้อย' },
    { id: 'in-gate', name: 'ประตูน้ำ (ปลายหนองน้อย)', kind: 'gate', role: 'inside', status: 'existing', source: 'thungkaew', bind: null, note: 'ก่อนลงแม่น้ำยมตามผัง' },
    { id: 'in-supply', name: 'ระบบประปาหมู่ 1 · หมู่ 4', kind: 'supply', role: 'inside', status: 'existing', source: 'thungkaew', bind: null, note: '' },
    { id: 'in-repair', name: 'รางส่งน้ำชำรุด 2 จุด (ตัดคลอง · ผนัง สจ.)', kind: 'canal', role: 'inside', status: 'repair', source: 'thungkaew', bind: null,
      note: 'ผังเขียนว่าชำรุด ไม่เคลื่อนไหว' },
    { id: 'in-pumps-planned', name: 'สถานีสูบน้ำตามแผน 2 จุด', kind: 'pump', role: 'inside', status: 'planned', source: 'thungkaew', bind: null,
      note: 'พลังงานแสงอาทิตย์ 1 · ไฟฟ้า 1 (ผังเขียนสีแดง = โครงสร้างที่จะก่อสร้างใหม่ · สถานีไฟฟ้ามีเส้นแดงอีก 2 เส้น)' },
    { id: 'in-plan-box', name: 'โครงสร้างตามแผน 1 จุด (กรอบแดงประ ใกล้ฝาย ผข.เดช)', kind: 'other', role: 'inside', status: 'planned', source: 'thungkaew', bind: null,
      note: 'ผังเขียนเป็นกรอบสีแดงเส้นประ ไม่ระบุว่าเป็นอะไร' },
  ],

  downstream: [
    { id: 'down-yom', name: 'แม่น้ำยม (ขอบล่างของผัง)', kind: 'stream', role: 'downstream', status: 'existing', source: 'thungkaew', bind: null,
      note: 'ห้วยทั้ง 3 ลุ่มไหลลงที่นี่ตามผัง · ผังตำบลวาดหัวลูกศรแม่น้ำยมชี้ไปทางซ้าย (ติด ต.น้ำรัด) · ผังจังหวัดวาดแม่น้ำยมไหลเหนือ → ใต้' },
    { id: 'down-canal-end', name: 'ปลายทางของคลองชลประทานฝายแม่ยมฝั่งขวา', kind: 'canal', role: 'downstream', status: 'unconfirmed', source: 'thungkaew', bind: null,
      note: 'ผังวาดลูกศรสองปลาย ไม่ระบุทิศน้ำและปลายทาง' },
  ],

  // ความสัมพันธ์ของสถานีที่ขึ้นการ์ดบนหน้า (ชนิด:รหัส → ป้าย D4) — ต้องครบทุกอ่าง/สถานีระดับน้ำที่ อปท. นี้เห็น
  relations: {
    'waterlevel:YOM003': {
      relation: 'unspecified',
      note: 'ผังตำบลทุ่งแค้วไม่ได้วาดสถานีนี้ (อยู่ ต.น้ำรัด อ.หนองม่วงไข่ บนแม่น้ำยม ห่างสำนักงาน 4.8 กม.) ผังไม่ระบุว่าอยู่เหนือหรือใต้ตำบล ค่านี้จึงไม่ได้บอกสถานการณ์ในตำบลโดยตรง',
    },
  },

  // "ผังต้นฉบับมี แต่เราไม่ได้ใส่" — บอกเหตุผลทุกข้อ (กันคำถาม "ทำไมไม่เหมือนต้นฉบับ")
  omitted: [
    { name: 'ชื่อห้วยแนวตั้ง 4 เส้นกลางผัง', reason: 'ต้นฉบับเขียนตะแคงอ่านไม่ชัด ไม่ขอเดาชื่อ' },
    { name: 'ทิศน้ำของคลองชลประทานฝั่งขวาและลำเหมืองแม่หม้าย', reason: 'ผังวาดลูกศรสองปลาย ไม่ระบุทิศ จึงไม่ตีความ' },
    { name: 'อาคาร อบต.ทุ่งแค้ว · โรงเรียนพัฒนา (ไอคอนอาคารริมคลอง)', reason: 'ไม่ใช่โครงสร้างทางน้ำ' },
    { name: 'ความจุของอ่างในผัง', reason: 'ไม่ตรงกับรายงานจริงของศูนย์ฯ จึงใช้เฉพาะตัวเลขจากรายงานของศูนย์ฯ' },
  ],
}
