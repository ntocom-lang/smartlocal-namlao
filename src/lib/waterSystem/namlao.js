// ระบบน้ำของตำบลน้ำเลา อ.ร้องกวาง — ข้อมูลล้วน (ตรรกะอยู่ model.js) · ถอดเมื่อ 2569-10-18
// ที่มา (ศูนย์บริหารจัดการน้ำจังหวัดแพร่ · phraepao.go.th/officechief/water):
//   · ผังน้ำตำบลน้ำเลา (30 เม.ย. 2567) — แกนของระบบนี้ · รายละเอียดในตำบลอยู่ที่ผังเคลื่อนไหว src/lib/waterDiagram/namlao.js (ไม่ซ้ำที่นี่)
//   · ผังน้ำตำบลบ้านเวียง (30 เม.ย. 2567) · ผังน้ำตำบลแม่หล่าย (9 พ.ค. 2567) — ตำบลปลายน้ำ
//   · ผังน้ำจังหวัดแพร่ — ไฟล์บนเซิร์ฟเวอร์ลงวันที่ 8 ส.ค. 2568 (ภาพไม่ระบุวันที่ในตัว) · ETag 546a22c6408dc1:0
//
// กติกา (ดีไซน์ฉบับปิด D1–D22): ไม่เขียนความจุอ่างจากผัง (ผังขัดกับรายงานจริง) · ความสัมพันธ์ที่ผังไม่ยืนยัน = status 'unconfirmed'
// · ไม่เดาทิศน้ำ/จุดต่อ · แหล่งที่ผังไม่เขียนความสัมพันธ์ไว้ ไม่อยู่ในรายการ "ต้นน้ำ"
//
// node = { id, name, kind, role, status, source, bind, note }
//   kind: stream|reservoir|weir|canal|pond|pump|supply|gauge|rain · role: upstream|inside|downstream|side
//   status: existing|planned|repair|unconfirmed · source = id ของผังใน sources · bind = { type, code } ของสถานีในระบบ (ค่าสด) หรือ null
export const NAMLAO_SYSTEM = {
  id: 'namlao',
  tambon: 'น้ำเลา',
  amphoe: 'ร้องกวาง',
  summary: 'สายหลักคือ "ลำน้ำแม่คำปอง" ไหลเหนือ → ใต้ รับห้วยสาขาทั้งสองฝั่ง มีอ่างแม่คำปองอยู่ต้นสาย แล้วไหลต่อไปทางลำน้ำแม่ถาง',
  originalUrl: 'https://www.phraepao.go.th/officechief/water/map_water_r.php',
  sources: [
    { id: 'namlao', name: 'ผังน้ำตำบลน้ำเลา อ.ร้องกวาง', date: '2024-04-30' },
    { id: 'banwiang', name: 'ผังน้ำตำบลบ้านเวียง อ.ร้องกวาง', date: '2024-04-30' },
    { id: 'maelai', name: 'ผังน้ำตำบลแม่หล่าย อ.เมืองแพร่', date: '2024-05-09' },
    { id: 'province', name: 'ผังน้ำจังหวัดแพร่', date: '2025-08-08', fileDateOnly: true },
  ],

  // นับของที่ผังตำบลวาดไว้ (ใช้ในสรุปบรรทัดเดียวของขั้น "ในตำบล") — ตรวจกับผังเคลื่อนไหวแล้ว (PR #482)
  counts: { reservoirs: 4, weirs: 40, ponds: 4, tributaries: 25, planned: 4 },

  upstream: [
    { id: 'up-mkp-head', name: 'ต้นน้ำแม่คำปอง', kind: 'stream', role: 'upstream', status: 'existing', source: 'namlao', bind: null,
      note: 'ผังเขียนชื่อไว้ที่ขอบบนของผัง ติดเขตตำบลไผ่โทน' },
    { id: 'up-saikhao', name: 'ลำห้วยทรายขาว', kind: 'stream', role: 'upstream', status: 'existing', source: 'namlao', bind: null,
      note: 'ผังวาดไหลจากเขตตำบลบ้านเวียง (ม.5 / ม.14) ไปทางตะวันตก' },
    { id: 'up-hin-khuem', name: 'ลำห้วยหิน · ห้วยขึม (+ห้วยน้ำชำ)', kind: 'stream', role: 'upstream', status: 'existing', source: 'namlao', bind: null,
      note: 'เส้นเริ่มจากขอบตะวันออกของผัง' },
    { id: 'up-unknown', name: 'ห้วยเหล็ก · ห้วยวัว (มุมขวาบน)', kind: 'stream', role: 'upstream', status: 'unconfirmed', source: 'namlao', bind: null,
      note: 'ผังเขียนชื่อไว้แต่ไม่วาดเส้น ไม่ระบุว่าไหลไปไหน' },
  ],

  inside: [
    { id: 'in-dam-305', name: 'อ่างเก็บน้ำแม่คำปอง', kind: 'reservoir', role: 'upstream', status: 'existing', source: 'namlao',
      bind: { type: 'dam', code: '305' }, note: 'ต้นสายลำน้ำแม่คำปองตามผัง · ThaiWater/กรมชลประทาน ข้อมูลรายวัน' },
    { id: 'in-dam-mkp2', name: 'อ่างแม่คำปอง ตอน 2', kind: 'reservoir', role: 'inside', status: 'planned', source: 'namlao', bind: null,
      note: 'ผังเขียนสีแดง = โครงสร้างที่จะก่อสร้างใหม่' },
    { id: 'in-res-others', name: 'อ่างห้วยทรายขาว · อ่างเด่นควาย · อ่างห้วยขึมโยธินฯ', kind: 'reservoir', role: 'inside', status: 'existing', source: 'namlao', bind: null,
      note: 'ไม่อยู่ในรายงาน ThaiWater และไม่มีหน้ารายงานของศูนย์ฯ' },
    { id: 'in-weirs', name: 'ฝายประมาณ 40 แห่ง', kind: 'weir', role: 'inside', status: 'existing', source: 'namlao', bind: null,
      note: 'ลุ่มบุญแจ่ม · ผากอ · ห้วยทรายขาว · ทุ่งเก่า · หนองเฮีย · ท่าเรือ 1–7 · ฝาย อบจ. 6 แห่ง ฯลฯ (รายชื่อเต็มอยู่ในผังด้านล่าง)' },
    { id: 'in-weirs-planned', name: 'ฝายตามแผน 3 แห่ง', kind: 'weir', role: 'inside', status: 'planned', source: 'namlao', bind: null,
      note: 'บนลำน้ำ 2 แห่ง + บนห้วยหล่าย 1 แห่ง (ผังเขียนสีแดง)' },
    { id: 'in-streams', name: 'ห้วยสาขาประมาณ 25 สาย', kind: 'stream', role: 'inside', status: 'existing', source: 'namlao', bind: null,
      note: 'ตะวันตก: ปู · หมื่นรอน · คำปอง · คำม่วง · ดงแก้ว · หล่าย · คอกผา→เตาปูน · ตะวันออก: วิว · เหล็ก · ต้นยาง · ใคร้ · โป่ง' },
    { id: 'in-ponds', name: 'สระหนองสะเลียม 1–3 · สระ 50 ไร่', kind: 'pond', role: 'inside', status: 'existing', source: 'namlao', bind: null, note: '' },
    { id: 'in-rain-stn0911', name: 'สถานีฝนบ้านบุญแจ่ม', kind: 'rain', role: 'inside', status: 'existing', source: 'namlao',
      bind: { type: 'rain', code: 'STN0911' }, note: 'ต.น้ำเลา ห่างสำนักงาน 2.6 กม. ตรงกับ "ม.1 บุญแจ่ม" บนผัง' },
    { id: 'in-rain-res040', name: 'สถานีฝนอ่างห้วยขึมโยธินฯ', kind: 'rain', role: 'inside', status: 'existing', source: 'namlao',
      bind: { type: 'rain', code: 'RES040' }, note: 'ห่างสำนักงาน 2.9 กม. ตรงกับป้าย "อ่างห้วยขึมโยธินฯ" บนผัง' },
  ],

  downstream: [
    { id: 'down-mthang', name: 'ลำน้ำแม่ถาง (ต.บ้านเวียง)', kind: 'stream', role: 'downstream', status: 'existing', source: 'namlao', bind: null,
      note: 'ผังน้ำเลาวาดลูกศรไปทางตะวันตก อยู่ติด ม.2 / ม.12 ต.บ้านเวียง' },
    { id: 'down-maelai', name: '"น้ำแม่หล่าย" → แม่น้ำยม', kind: 'stream', role: 'downstream', status: 'existing', source: 'banwiang', bind: null,
      note: 'ผังบ้านเวียงเขียนชื่อนี้ที่ปลายสายหลัก · ผังจังหวัดวาดสายนี้ลงแม่น้ำยม · ผังแม่หล่าย: ลำห้วยแม่หล่ายไหลลงแม่น้ำยม' },
    { id: 'down-link', name: 'จุดต่อสายแม่ถาง', kind: 'stream', role: 'downstream', status: 'unconfirmed', source: 'banwiang', bind: null,
      note: 'ผังไม่เขียนจุดที่ลำน้ำแม่ถางของผังน้ำเลาไปต่อกับสายหลักของผังบ้านเวียง' },
  ],

  // ความสัมพันธ์ของสถานีที่ขึ้นการ์ดบนหน้า (ชนิด:รหัส → ป้าย D4) — ต้องครบทุกอ่าง/สถานีระดับน้ำที่ อปท. นี้เห็น
  relations: {
    'dam:305': { relation: 'upstream', note: 'อยู่ ต.น้ำเลา ต้นสายลำน้ำแม่คำปองตามผังน้ำเลา' },
    'dam:304': {
      relation: 'side',
      note: 'อ่างเก็บน้ำแม่ถางอยู่ ต.บ้านเวียง บนสายที่รับห้วยหลายสายจากทางเหนือของ ต.บ้านเวียง (ติดจังหวัดน่าน) แล้วไหลลงใต้ไป "น้ำแม่หล่าย" ไปรวมกับสายน้ำเลาที่ปลายน้ำ — ผังไม่ได้วาดให้ไหลผ่านตำบลน้ำเลา',
    },
    'waterlevel:YOM003': {
      relation: 'unspecified',
      note: 'ผังตำบลน้ำเลาไม่ได้วาดสถานีนี้ (อยู่ ต.น้ำรัด อ.หนองม่วงไข่ บนแม่น้ำยม) ค่านี้ไม่ได้บอกสถานการณ์ในตำบล',
    },
  },

  // "ผังต้นฉบับมี แต่เราไม่ได้ใส่" — บอกเหตุผลทุกข้อ (กันคำถาม "ทำไมไม่เหมือนต้นฉบับ")
  omitted: [
    { name: 'พื้นที่ลายขีดแดง (ซ้ายล่างของผังน้ำเลา)', reason: 'ผังไม่ระบุความหมาย จึงไม่ตีความ' },
    { name: 'ห้วยเหล็ก · ห้วยวัว (มุมขวาบน)', reason: 'ผังเขียนชื่อไว้แต่ไม่ระบุปลายทาง' },
    { name: 'ห้วยไม่ระบุชื่อ 3 สาย', reason: 'ผังวาดเส้นแต่ไม่เขียนชื่อ' },
    { name: 'ความจุของอ่างในผัง', reason: 'ไม่ตรงกับรายงานจริงของศูนย์ฯ จึงใช้เฉพาะตัวเลขจากแหล่งค่าสด' },
    { name: 'เส้นจากสายหลักตอนล่างของผังบ้านเวียงขึ้นไปยังอ่างแม่คำปอง', reason: 'ผังไม่อธิบายว่าคืออะไร จึงไม่ตีความ' },
  ],
}
