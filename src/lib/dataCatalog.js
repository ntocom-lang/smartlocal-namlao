// ทะเบียนชุดข้อมูลของระบบ SmartLocal (หน้า "คุณภาพข้อมูล" > "ทะเบียนชุดข้อมูล" ในศูนย์รวมข้อมูลดิจิทัล)
//
// แบ่งหน้าที่ชัดเจน: ฐานข้อมูล (RPC data_center_catalog) ให้ "ตัวเลข" — จำนวนแถว/ใหม่ 30 วัน/อัปเดตล่าสุด
// ส่วนไฟล์นี้เก็บ "ข้อมูลกำกับ" (ชื่อไทย แหล่งที่มา ระดับความอ่อนไหว การเผยแพร่) ซึ่งเป็นเรื่องที่ต้องมีคนรับรอง
// ไม่ใช่สิ่งที่ฐานข้อมูลเดาเองได้ ⇒ ค่าที่ระบุที่นี่เป็น "ร่างโดยระบบจากโครงสร้างตาราง" รอผู้ควบคุมข้อมูลของ อปท.
// ยืนยันตาม PDPA ฉบับปัจจุบัน (ไม่อ้างเลขมาตราในโค้ด — ต้องเปิดตัวบทจริงตอนยืนยัน)
//
// เพิ่มชุดข้อมูลใหม่ต้องเพิ่ม 2 ที่: DATASETS ในไฟล์นี้ + บล็อก UNION ใน SQL ของ data_center_catalog
// (tests/data-center-hub.test.mjs เทียบรายการ key ของ 2 ฝั่งให้ ถ้าไม่ตรงเทสต์ล้ม)

// ระดับความอ่อนไหว (ยิ่งลงล่างยิ่งอ่อนไหว)
export const SENSITIVITY = {
  public:    { label: 'สาธารณะ',            tone: 'good', hint: 'เนื้อหาเปิดเผยได้โดยธรรมชาติของข้อมูล' },
  internal:  { label: 'ใช้ภายใน',           tone: 'warn', hint: 'ใช้ในการปฏิบัติงาน อาจมีชื่อเจ้าหน้าที่/ผู้ใช้บริการปนอยู่' },
  personal:  { label: 'ข้อมูลส่วนบุคคล',     tone: 'bad',  hint: 'มีชื่อ ที่อยู่ เบอร์โทร หรือข้อมูลที่ระบุตัวบุคคลได้' },
  sensitive: { label: 'ข้อมูลอ่อนไหว',       tone: 'bad',  hint: 'ข้อมูลสุขภาพของบุคคล' },
}

// การเผยแพร่
//   file         เผยแพร่เป็นไฟล์ข้อมูลเปิดให้ดาวน์โหลดได้ (ทำแล้วเฉพาะ data_center_entries)
//   web          แสดงบนหน้าเว็บสาธารณะของระบบ
//   web_partial  แสดงบนหน้าเว็บเฉพาะรายการที่กำหนดให้ประชาชนเห็น
//   none         ไม่เผยแพร่
export const RELEASE = {
  file:        { label: 'ไฟล์ข้อมูลเปิด',     tone: 'good' },
  web:         { label: 'แสดงบนเว็บสาธารณะ',  tone: 'good' },
  web_partial: { label: 'แสดงบางส่วน',        tone: 'warn' },
  none:        { label: 'ไม่เผยแพร่',         tone: 'none' },
}

export const SOURCES = {
  staff:  'เจ้าหน้าที่บันทึก',
  citizen: 'ประชาชนยื่นเอง',
  mixed:  'ประชาชนและเจ้าหน้าที่',
  system: 'ระบบสร้างอัตโนมัติ',
}

// restricted: true = role ผู้ใช้ทั่วไป (authenticated) ไม่มีสิทธิ์ SELECT ระดับตารางโดยตั้งใจ
// เข้าถึงผ่านฟังก์ชันเฉพาะเท่านั้น ⇒ ทะเบียนไม่แสดงจำนวนแถว (SQL คืน NULL) และโชว์ป้าย "จำกัดสิทธิ์ระดับตาราง"
// ตรวจแล้ว 2026-10-03: patient_bookings, water_station_config
export const DATASETS = [
  { key: 'data_center_entries', label: 'จุดพิกัดและสถานที่สำคัญ', module: 'ศูนย์รวมข้อมูลดิจิทัล', source: 'staff', sensitivity: 'public', release: 'file',
    note: 'เผยแพร่เฉพาะรายการที่เปิดใช้งาน — ดาวน์โหลด GeoJSON/CSV ได้ที่หน้าแผนที่สาธารณะ' },
  { key: 'tourism_places', label: 'แหล่งท่องเที่ยว ร้านอาหาร ที่พัก บริการ', module: 'เที่ยว กิน พัก ช้อป บริการ', source: 'staff', sensitivity: 'public', release: 'web' },
  { key: 'emergency_contacts', label: 'ทำเนียบเบอร์โทรสำคัญและสายด่วน', module: 'สายด่วนและทำเนียบ', source: 'staff', sensitivity: 'public', release: 'web',
    note: 'ประชาชนอ่านผ่านฟังก์ชันเฉพาะ ไม่เปิดตารางตรง' },
  { key: 'posts', label: 'ข่าวประชาสัมพันธ์', module: 'ข่าวสาร', source: 'staff', sensitivity: 'public', release: 'web' },
  { key: 'waste_villages', label: 'หมู่บ้านในตารางเก็บขยะ', module: 'ตารางวันเก็บขยะ', source: 'staff', sensitivity: 'public', release: 'web',
    note: 'ประชาชนอ่านผ่านฟังก์ชันเฉพาะ' },
  { key: 'events', label: 'ปฏิทินกิจกรรม', module: 'ปฏิทินกิจกรรม', source: 'staff', sensitivity: 'internal', release: 'web_partial',
    note: 'มีรายการสำหรับเจ้าหน้าที่และรายการส่วนตัว (เฉพาะเจ้าของ) ที่ไม่แสดงต่อสาธารณะ' },
  { key: 'public_holidays', label: 'วันหยุดราชการ', module: 'ตั้งค่าระบบ', source: 'staff', sensitivity: 'public', release: 'none',
    note: 'ใช้คำนวณวันทำการและกำหนดเสร็จของคำร้องภายในระบบ' },
  { key: 'departments', label: 'โครงสร้างกอง/สำนัก', module: 'ตั้งค่าระบบ', source: 'staff', sensitivity: 'internal', release: 'none' },
  { key: 'water_station_config', label: 'ตั้งค่าสถานีวัดน้ำ-ฝน', module: 'สถานการณ์น้ำ-ฝน', source: 'staff', sensitivity: 'internal', release: 'none', restricted: true },
  { key: 'fleet_vehicles', label: 'ทะเบียนยานพาหนะ', module: 'ยานพาหนะ', source: 'staff', sensitivity: 'internal', release: 'none' },
  { key: 'fleet_trips', label: 'บันทึกการใช้รถ', module: 'ยานพาหนะ', source: 'mixed', sensitivity: 'internal', release: 'none',
    note: 'มีชื่อผู้ขอใช้รถและพนักงานขับรถ' },
  { key: 'asset_borrow_requests', label: 'คำขอยืมพัสดุ', module: 'ยืมพัสดุ', source: 'mixed', sensitivity: 'internal', release: 'none' },
  { key: 'satisfaction_ratings', label: 'ผลประเมินความพึงพอใจ', module: 'ความพึงพอใจ', source: 'citizen', sensitivity: 'internal', release: 'none' },
  { key: 'complaints', label: 'คำร้องเรียน/แจ้งเหตุ', module: 'คำร้อง', source: 'mixed', sensitivity: 'personal', release: 'none',
    note: 'มีชื่อ เบอร์โทร ที่อยู่ และพิกัดบ้านผู้แจ้ง — เผยแพร่ได้เฉพาะสถิติรวมที่ไม่ระบุตัวบุคคล' },
  { key: 'document_requests', label: 'คำขอเอกสาร', module: 'คำขอเอกสาร', source: 'citizen', sensitivity: 'personal', release: 'none' },
  { key: 'business_registrations', label: 'คำขอลงทะเบียนธุรกิจ', module: 'ลงทะเบียนธุรกิจ', source: 'citizen', sensitivity: 'personal', release: 'none' },
  { key: 'drive_files', label: 'ไฟล์แนบ (ทะเบียนไฟล์บน Drive)', module: 'ทุกโมดูล', source: 'system', sensitivity: 'personal', release: 'none',
    note: 'ไฟล์แนบของคำร้องและเอกสารอาจมีบัตรประชาชน/รูปบุคคล' },
  { key: 'patient_bookings', label: 'คำขอรถรับ-ส่งผู้ป่วย', module: 'รถรับ-ส่งผู้ป่วย', source: 'mixed', sensitivity: 'sensitive', release: 'none', restricted: true,
    note: 'เกี่ยวกับข้อมูลสุขภาพ — ตารางถูกล็อกสิทธิ์ไว้ เข้าถึงผ่านฟังก์ชันเฉพาะที่ตรวจสิทธิ์รายกอง' },
]

const SENSITIVITY_ORDER = ['public', 'internal', 'personal', 'sensitive']

export const DATASET_KEYS = DATASETS.map((d) => d.key)

// รวมข้อมูลกำกับ (DATASETS) กับตัวเลขจาก RPC เป็นแถวที่หน้าจอวาดได้เลย
// ชุดข้อมูลที่ RPC ไม่ส่งมา (เช่น RPC เก่ากว่าหน้าเว็บ) จะได้ total = undefined ไม่ล้ม
export function buildCatalogRows(rpcRows) {
  const byKey = new Map((Array.isArray(rpcRows) ? rpcRows : []).map((r) => [r.key, r]))
  return DATASETS.map((meta) => {
    const r = byKey.get(meta.key)
    return {
      ...meta,
      total: r?.total ?? null,
      recent30d: r?.recent_30d ?? null,
      lastActivity: r?.last_activity ?? null,
      hasCount: typeof r?.total === 'number',
    }
  })
}

export function catalogSummary(rows) {
  let totalRows = 0
  let released = 0
  let protectedCount = 0
  for (const r of rows) {
    if (r.hasCount) totalRows += r.total
    if (r.release === 'file' || r.release === 'web') released += 1
    if (r.sensitivity === 'personal' || r.sensitivity === 'sensitive') protectedCount += 1
  }
  return { datasets: rows.length, totalRows, released, protectedCount }
}

// จัดกลุ่มตามระดับความอ่อนไหว เรียงจากสาธารณะ → อ่อนไหว
export function groupBySensitivity(rows) {
  return SENSITIVITY_ORDER
    .map((key) => ({ key, ...SENSITIVITY[key], rows: rows.filter((r) => r.sensitivity === key) }))
    .filter((g) => g.rows.length > 0)
}
