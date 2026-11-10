// ทะเบียนกลางของ "ห้องผู้บริหาร" (หน้าแรกนายก/รองนายก/ปลัด) — แหล่งความจริงจุดเดียวว่า
// โมดูล/ประเภทคำขอ/แหล่งข้อมูลไหนขึ้นการ์ดโซนไหน ด้วยตัวเลขอะไร และกดแล้วไปไหน
//
// ⚠️ กติกาถาวร (docs/ai/DOMAIN.md): โมดูล/เมนู/ประเภทคำขอใหม่ต้องลงทะเบียนที่นี่ใน PR เดียวกัน
// ไม่งั้น `npm run test:exec-coverage` ล้ม (รันเป็น prebuild ด้วย ⇒ CI build ล้มตาม)
// เหตุผล: ผู้บริหารต้องไม่ถามว่า "ทำไมเรื่องนี้ไม่มี" — ของที่ไม่อยู่ในทะเบียนคือของที่หายเงียบ
//
// ไฟล์นี้ต้องเป็น JS ล้วน ห้าม import React/lucide/supabase — เทสต์ coverage รันด้วย node ตรงๆ
// ไอคอนจึงเก็บเป็นชื่อ lucide (string) แล้วหน้าจอแปลงเอง
//
// หลักที่ทุกรายการต้องตาม
// - ตัวเลขเท่านั้น: การ์ดหน้ารวมห้ามแสดงชื่อ/ที่อยู่/เบอร์ของผู้ร้อง ผู้ป่วย ผู้ประเมิน (PDPA)
//   ดูรายเรื่องต้องกดเข้าหน้าเดิมของโมดูลนั้นตามสิทธิ์ RLS ของมัน
// - ทุก kpi/alert ต้องมี formula/rule เป็นภาษาคน แสดงเป็น ⓘ ใต้การ์ด ให้ สตง./ป.ป.ช. คำนวณซ้ำได้
// - หน้านี้ไม่มีปุ่มอนุมัติ/เปลี่ยนสถานะ ทุกการตัดสินผ่านขั้นตอนเดิมของเรื่องนั้น (มีบันทึกย้อนตรวจ)

/** โซนบนหน้า เรียงตามลำดับที่วาด */
export const EXEC_ZONES = Object.freeze({
  decision: '① รอท่านตัดสินใจ/ลงนาม',
  service: '② งานบริการประชาชน',
  alert: '③ สัญญาณเตือน',
  schedule: '④ กำหนดการ',
  plan: '⑤ โครงการและแผนพัฒนา',
  dept: '⑥ ภาพรวมรายกอง',
  area: '⑦ สถานการณ์พื้นที่',
  report: '⑧ รายงานพร้อมใช้',
  context: 'ข้อมูลประกอบ',
})

/**
 * เฟสที่ต่อข้อมูลแล้ว — หน้าจอวาดเฉพาะรายการ/kpi ที่ phase <= EXEC_CURRENT_PHASE
 * รายการเฟสหลังยังต้องลงทะเบียนตั้งแต่วันนี้ (กันตกหล่น) แต่ยังไม่ขึ้นจอ
 * E1 = RPC เดิมที่ viewer/ปลัดเรียกได้แล้ว (ไม่มี SQL)
 * E2 = executive_overview() + exec_summary_<summaryKey>() (SECURITY DEFINER ตรวจ role ข้างใน)
 * E3 = ติดตาม/เร่งรัด + ใบ A4 + สรุปเช้า Telegram
 */
export const EXEC_PHASES = Object.freeze(['E1', 'E2', 'E3'])
export const EXEC_CURRENT_PHASE = 'E1'

export function isPhaseLive(phase, current = EXEC_CURRENT_PHASE) {
  const i = EXEC_PHASES.indexOf(phase)
  return i >= 0 && i <= EXEC_PHASES.indexOf(current)
}

/**
 * แหล่งข้อมูลของ E1 — RPC เดิมทั้งหมด ตรวจสิทธิ์แล้ว 2026-11-10 (ไล่จาก migrations):
 * - complaint_stats_fy / doc_request_stats_fy / complaints_public_fy / doc_requests_public_fy /
 *   complaint_issue_breakdown_fy: GRANT anon+authenticated, SECURITY DEFINER, ไม่ตรวจ role
 *   (เป็นสถิติสาธารณะชุดเดียวกับหน้า ComplaintStats/LpaDocStats ⇒ ตัวเลขต้องตรงกันเสมอ)
 *   หน้านี้ "ห้ามใช้" คอลัมน์ purpose ของ doc_requests_public_fy (เป็นข้อความของผู้ยื่น)
 * - esign_my_pending: authenticated เท่านั้น · ⚠️ ปัจจุบันคืนเฉพาะใบขอใช้รถ (fleet_trips)
 *   ไม่ใช่ทุกประเภทเอกสาร — ประเภทอื่นที่จะเปิด e-sign ต้องต่อเข้าฟังก์ชันนี้เอง
 * - viewer อ่านตาราง complaints/document_requests ตรงๆ ไม่ได้ (RLS) และปลัด (officer) เห็นแค่กองตัวเอง
 *   ⇒ ตัวเลขที่ต้องใช้ due_date (เลยกำหนด, % ทันกำหนด) รอ E2 ห้ามประกอบจาก query ตรงในเฟสนี้
 */
export const EXEC_E1_RPCS = Object.freeze([
  'complaint_stats_fy',
  'doc_request_stats_fy',
  'complaints_public_fy',
  'doc_requests_public_fy',
  'complaint_issue_breakdown_fy',
  'esign_my_pending',
])

/**
 * @typedef {Object} ExecKpi
 * @property {string} id
 * @property {string} label
 * @property {string} unit           'เรื่อง' | 'วัน' | '%' | 'คะแนน' | ...
 * @property {string} formula        ภาษาคน แสดงเป็น ⓘ — ต้องคำนวณซ้ำจากข้อมูลดิบได้
 * @property {'E1'|'E2'|'E3'} phase
 * @property {string} [source]       ชื่อ RPC/ฟังก์ชันที่ให้ค่านี้
 *
 * @typedef {Object} ExecAlert
 * @property {string} id
 * @property {string} label
 * @property {'info'|'warn'|'critical'} severity
 * @property {string} rule           กฎตรงไปตรงมาที่ตรวจย้อนได้ (ไม่ใช้ AI)
 * @property {'E1'|'E2'|'E3'} phase
 *
 * @typedef {Object} ExecEntry
 * @property {string} key            โมดูล: ตรงกับคีย์ใน MODULE_GROUPS (staffModules.js) · แหล่งข้อมูล: 'src:<ชื่อ>'
 * @property {'module'|'source'} kind
 * @property {string} label
 * @property {string} icon           ชื่อไอคอน lucide-react เช่น 'MessageSquareWarning'
 * @property {string|null} dept      ชื่อกองที่ถือเรื่องโดยทั่วไป (แสดงผลเท่านั้น ไม่ใช้ตัดสิทธิ์)
 * @property {Array<keyof typeof EXEC_ZONES>} zones
 * @property {boolean} isCitizenService   true ⇒ ต้องมี 'service' ใน zones และขึ้นตาราง ②-2
 * @property {string[]} docTypes     document_type ที่รายการนี้เป็นเจ้าของ (ลิงก์ไปกล่องงานของรายการนี้)
 * @property {boolean} [acceptsCustomTypes]  true = ประเภทที่ อปท. เพิ่มเอง (_custom_types) ตกที่รายการนี้
 * @property {string|null} summaryKey  ชื่อท้าย exec_summary_<summaryKey>() ของ E2 (null = ไม่มีสรุปฝั่ง DB)
 * @property {'E1'|'E2'|'E3'} phase  เฟสที่รายการนี้เริ่มขึ้นจอ
 * @property {{ module?: string, path?: string }} link   module = activeModule ของ /staff · path = route
 * @property {ExecKpi[]} kpis
 * @property {ExecAlert[]} alerts
 * @property {Array<{ id: string, label: string, path: string, phase: 'E1'|'E2'|'E3' }>} reports
 */

const kpi = (id, label, unit, formula, phase, source) => ({ id, label, unit, formula, phase, ...(source ? { source } : {}) })
const alert = (id, label, severity, rule, phase) => ({ id, label, severity, rule, phase })

/** @type {ReadonlyArray<ExecEntry>} */
export const EXECUTIVE_REGISTRY = Object.freeze([
  // ───────────── ② งานบริการประชาชน (หัวใจของหน้า) ─────────────
  {
    key: 'complaints', kind: 'module', label: 'คำร้อง/ร้องทุกข์', icon: 'MessageSquareWarning', dept: null,
    zones: ['service', 'report'], isCitizenService: true, docTypes: [], summaryKey: 'complaints', phase: 'E1',
    link: { module: 'complaints' },
    kpis: [
      kpi('new', 'เรื่องใหม่', 'เรื่อง', 'จำนวนคำร้องที่สร้างในช่วงที่เลือก (ตามวันที่แจ้ง เวลาไทย)', 'E1', 'complaint_stats_fy.total'),
      kpi('open', 'ยังไม่เสร็จ', 'เรื่อง', 'สถานะ new/pending/received + in_progress (+ parked ถ้ามี) ของเรื่องที่แจ้งในช่วงนี้', 'E1', 'complaint_stats_fy'),
      kpi('done', 'เสร็จแล้ว', 'เรื่อง', 'สถานะ done/closed/completed ของเรื่องที่แจ้งในช่วงนี้', 'E1', 'complaint_stats_fy.resolved'),
      kpi('avg_days', 'เวลาเฉลี่ยจนเสร็จ', 'วัน', 'ค่าเฉลี่ยของ (closed_at − created_at) เป็นวันปฏิทิน เฉพาะเรื่องที่เสร็จแล้ว — ตัวเลขเดียวกับหน้าสถิติสาธารณะ', 'E1', 'complaint_stats_fy.avg_days'),
      kpi('by_category', 'หมวดปัญหา', 'เรื่อง', 'นับเรื่องที่แจ้งในช่วงนี้แยกตาม category (ไม่มีชื่อผู้แจ้ง)', 'E1', 'complaints_public_fy'),
      kpi('overdue', 'เลยกำหนด', 'เรื่อง', 'เรื่องที่ยังไม่เสร็จและเลยวันกำหนดเสร็จ (วันทำการ)', 'E2'),
      kpi('on_time_pct', '% เสร็จทันกำหนด', '%', 'เรื่องที่เสร็จภายในวันกำหนด ÷ เรื่องที่เสร็จทั้งหมดในช่วงนี้', 'E2'),
      kpi('satisfaction', 'คะแนนพึงพอใจ', 'คะแนน', 'ค่าเฉลี่ยคะแนน 1–5 แยกที่มา (ประชาชนประเมินเอง / สท. บันทึกแทน) ตามรายงาน #681', 'E2'),
    ],
    alerts: [
      alert('overdue_5wd', 'เลยกำหนดเกิน 5 วันทำการ', 'critical', 'ยังไม่เสร็จ และวันนี้เลยวันกำหนดมากกว่า 5 วันทำการ', 'E2'),
      alert('low_rating', 'คะแนนประเมิน ≤ 2', 'warn', 'มีการประเมินคะแนน 1 หรือ 2 ในช่วงที่เลือก', 'E2'),
    ],
    reports: [
      { id: 'monthly', label: 'สรุปเรื่องร้องเรียนรายเดือน', path: '/reports/complaints', phase: 'E1' },
    ],
  },
  {
    key: 'inbox', kind: 'module', label: 'คำขอบริการ (E-Service)', icon: 'Inbox', dept: null,
    zones: ['service', 'report'], isCitizenService: true, acceptsCustomTypes: true,
    docTypes: [
      'tax_notice', 'waste_collection', 'waste_collection_request', 'waste_collection_cancel',
      'public_assistance_request', 'asset_borrow_request', 'building_permit', 'cctv_footage_request',
    ],
    summaryKey: 'doc_requests', phase: 'E1',
    link: { module: 'inbox' },
    kpis: [
      kpi('new', 'คำขอใหม่', 'เรื่อง', 'จำนวนคำขอที่ยื่นในช่วงที่เลือก', 'E1', 'doc_request_stats_fy.total'),
      kpi('open', 'ยังไม่เสร็จ', 'เรื่อง', 'สถานะ pending + processing ของคำขอที่ยื่นในช่วงนี้', 'E1', 'doc_request_stats_fy'),
      kpi('done', 'เสร็จแล้ว', 'เรื่อง', 'สถานะ completed', 'E1', 'doc_request_stats_fy.completed'),
      kpi('avg_days', 'เวลาเฉลี่ยจนเสร็จ', 'วัน', 'ค่าเฉลี่ยของ (issued_at − created_at) เป็นวันปฏิทิน เฉพาะคำขอที่เสร็จแล้ว — ตัวเลขเดียวกับหน้าสถิติสาธารณะ', 'E1', 'doc_request_stats_fy.avg_days'),
      kpi('by_type', 'แยกประเภทคำขอ', 'เรื่อง', 'นับคำขอแยกตาม document_type ทุกประเภทที่เปิดอยู่ รวมประเภทที่ อปท. เพิ่มเอง (ไม่มีชื่อผู้ยื่น)', 'E1', 'doc_requests_public_fy'),
      kpi('overdue', 'เลยกำหนด', 'เรื่อง', 'คำขอที่ยังไม่เสร็จและเลย due_date ตามระยะเวลาของประเภทนั้น', 'E2'),
      kpi('on_time_pct', '% เสร็จทันกำหนด', '%', 'คำขอที่เสร็จภายใน due_date ÷ คำขอที่เสร็จทั้งหมด (ระยะเวลาต้องตรงคู่มือประชาชนที่ อปท. ประกาศ)', 'E2'),
    ],
    alerts: [
      alert('overdue_5wd', 'คำขอเลยกำหนดเกิน 5 วันทำการ', 'critical', 'ยังไม่เสร็จ และวันนี้เลย due_date มากกว่า 5 วันทำการ', 'E2'),
    ],
    reports: [
      { id: 'doc_stats', label: 'สถิติคำขอ (หน้าสาธารณะ)', path: '/doc-stats', phase: 'E1' },
    ],
  },
  {
    key: 'waterworks', kind: 'module', label: 'งานประปา', icon: 'Droplets', dept: 'กองช่าง/งานประปา',
    zones: ['service'], isCitizenService: true,
    docTypes: ['water_supply_request', 'water_meter_change', 'water_supply_cancel'],
    summaryKey: null, phase: 'E1',
    link: { module: 'waterworks' },
    kpis: [], alerts: [], reports: [],
  },
  {
    key: 'patient-transport', kind: 'module', label: 'รถรับ-ส่งผู้ป่วย', icon: 'Ambulance', dept: null,
    zones: ['service'], isCitizenService: true, docTypes: ['patient_transport_request'],
    summaryKey: 'patient_transport', phase: 'E1',
    link: { module: 'patient-transport' },
    kpis: [
      // ข้อมูลสุขภาพ (ข้อมูลอ่อนไหว) ⇒ ยอดรวมเท่านั้น ห้ามมีชื่อ/โรงพยาบาลปลายทางรายคน
      kpi('requests', 'คำขอ', 'เรื่อง', 'จำนวนคำขอ patient_transport_request ในช่วงที่เลือก (ยอดรวมเท่านั้น)', 'E1', 'doc_requests_public_fy'),
      kpi('trips', 'เที่ยวรับ-ส่งจริง', 'เที่ยว', 'จำนวนเที่ยวที่ออกรถจริงในช่วงที่เลือก', 'E2'),
    ],
    alerts: [], reports: [],
  },

  // ───────────── ① รอตัดสินใจ + ③ เตือน + ⑤ แผน ─────────────
  {
    key: 'fleet', kind: 'module', label: 'ยานพาหนะและเชื้อเพลิง', icon: 'Car', dept: 'สำนักปลัด',
    zones: ['decision', 'alert'], isCitizenService: false, docTypes: [], summaryKey: 'fleet', phase: 'E1',
    link: { module: 'fleet' },
    kpis: [
      kpi('esign_pending', 'ใบขอใช้รถรอท่านลงนาม', 'ใบ', 'จำนวนรายการที่ esign_my_pending() คืน — DB ตัดสินว่าถึงคิวท่านแล้ว', 'E1', 'esign_my_pending'),
    ],
    alerts: [
      alert('fuel_over_budget', 'น้ำมันเกินงบ', 'warn', 'ยอดน้ำมันสะสมปีงบเกินวงเงินที่ตั้งไว้', 'E2'),
      alert('maintenance_due', 'เลยกำหนดซ่อมบำรุง', 'warn', 'เลขไมล์หรือวันที่เลยรอบซ่อมบำรุงที่ตั้งไว้', 'E2'),
    ],
    reports: [],
  },
  {
    key: 'borrowable-assets', kind: 'module', label: 'พัสดุ/ครุภัณฑ์ (ยืม-คืน)', icon: 'Package', dept: 'กองคลัง',
    zones: ['decision', 'alert'], isCitizenService: false, docTypes: [], summaryKey: 'borrowable_assets', phase: 'E2',
    link: { module: 'borrowable-assets' },
    kpis: [kpi('awaiting', 'ใบยืมรอพิจารณา', 'ใบ', 'ใบยืมสถานะ submitted', 'E2')],
    alerts: [alert('overdue_return', 'ยืมเกินกำหนดคืน', 'warn', 'ยังไม่คืน และเลย return_due_date', 'E2')],
    reports: [],
  },
  {
    key: 'projects', kind: 'module', label: 'โครงการก่อสร้าง', icon: 'HardHat', dept: 'กองช่าง',
    zones: ['decision', 'alert', 'plan'], isCitizenService: false, docTypes: [], summaryKey: 'projects', phase: 'E2',
    link: { module: 'projects' },
    kpis: [
      kpi('by_stage', 'โครงการตามขั้น', 'โครงการ', 'นับโครงการแยก stage ของวงจรโครงการ', 'E2'),
      kpi('change_pending', 'ขอเปลี่ยนแปลง/เลื่อนขั้นรอพิจารณา', 'เรื่อง', 'คำขอเปลี่ยนแปลงที่ยังไม่มีผลพิจารณา', 'E2'),
    ],
    alerts: [
      alert('behind', 'ช้ากว่าแผน', 'warn', '% ผลงานจริงต่ำกว่า % ตามแผนของสัปดาห์ล่าสุด', 'E2'),
      alert('contract_ending', 'ใกล้หมดสัญญา', 'warn', 'เหลือไม่ถึง 15 วันถึงวันสิ้นสุดสัญญา และยังไม่ส่งมอบ', 'E2'),
    ],
    reports: [],
  },
  {
    key: 'local-plan', kind: 'module', label: 'แผนพัฒนาท้องถิ่น', icon: 'ClipboardList', dept: 'สำนักปลัด',
    zones: ['decision', 'alert', 'plan'], isCitizenService: false, docTypes: [], summaryKey: 'local_plan', phase: 'E2',
    link: { module: 'local-plan' },
    kpis: [kpi('progress_by_dept', '% ดำเนินการรายกอง', '%', 'รายการแผนการดำเนินงานที่บันทึกผลแล้ว ÷ ทั้งหมดของกอง', 'E2')],
    alerts: [alert('result_missing', 'ถึงกำหนดแต่ยังไม่บันทึกผล', 'warn', 'รายการที่เดือนดำเนินการผ่านไปแล้วแต่ยังไม่มีผล', 'E2')],
    reports: [],
  },
  {
    key: 'infra', kind: 'module', label: 'บันทึกงานซ่อม', icon: 'Wrench', dept: 'กองช่าง',
    zones: ['alert'], isCitizenService: false, docTypes: [], summaryKey: 'infra', phase: 'E2',
    link: { module: 'infra' },
    kpis: [], alerts: [alert('stale', 'งานซ่อมค้าง', 'warn', 'งานซ่อมที่ยังไม่ปิดเกิน 15 วันทำการ', 'E2')], reports: [],
  },
  {
    key: 'water-situation', kind: 'module', label: 'สถานการณ์น้ำ-ฝน', icon: 'CloudRain', dept: 'สำนักปลัด',
    zones: ['decision', 'alert', 'area'], isCitizenService: false, docTypes: [], summaryKey: 'water', phase: 'E1',
    link: { path: '/water-situation' },
    kpis: [kpi('announce_pending', 'ประกาศน้ำ-ฝนรอยืนยัน', 'ฉบับ', 'ประกาศที่ระบบร่างแล้วรอผู้มีอำนาจยืนยัน', 'E2')],
    alerts: [alert('critical_level', 'ระดับน้ำวิกฤต', 'critical', 'สถานีในพื้นที่รายงานระดับวิกฤตตามเกณฑ์ ThaiWater', 'E2')],
    reports: [{ id: 'infographic', label: 'อินโฟกราฟิกน้ำ-ฝน', path: '/water-situation', phase: 'E1' }],
  },
  {
    key: 'water-events', kind: 'module', label: 'เหตุการณ์น้ำ-ฝน', icon: 'Waves', dept: 'สำนักปลัด',
    zones: ['alert'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E2',
    link: { module: 'water-events' }, kpis: [], alerts: [], reports: [],
  },

  // ───────────── ④ ⑥ ⑦ ─────────────
  {
    key: 'events', kind: 'module', label: 'ปฏิทินกิจกรรม', icon: 'CalendarDays', dept: null,
    zones: ['schedule'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E1',
    link: { module: 'events' },
    kpis: [
      kpi('assigned', 'กิจกรรมที่มอบหมายให้ท่าน', 'รายการ', 'กิจกรรมในปฏิทินที่มอบหมายให้ท่าน (event_assignments) วันนี้และพรุ่งนี้ — ชุดเดียวกับหน้าแรกเจ้าหน้าที่', 'E1', 'staff_home_summary.my_events'),
      kpi('upcoming', 'กำหนดการ 7 วัน', 'รายการ', 'กิจกรรมกลุ่มผู้บริหาร + รายการส่วนตัวของท่าน วันนี้ถึงอีก 7 วัน', 'E2'),
    ],
    alerts: [], reports: [],
  },
  {
    key: 'performance', kind: 'module', label: 'ผลการปฏิบัติงาน', icon: 'Award', dept: null,
    zones: ['dept'], isCitizenService: false, docTypes: [], summaryKey: 'departments', phase: 'E2',
    link: { module: 'performance' }, kpis: [], alerts: [], reports: [],
  },
  {
    key: 'report', kind: 'module', label: 'รายงาน', icon: 'BarChart3', dept: null,
    zones: ['dept', 'report'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E1',
    link: { module: 'report' }, kpis: [], alerts: [], reports: [],
  },
  {
    key: 'data-center', kind: 'module', label: 'ศูนย์ข้อมูลดิจิทัล', icon: 'Database', dept: null,
    zones: ['area'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E1',
    link: { module: 'data-center' }, kpis: [], alerts: [], reports: [],
  },

  // ───────────── ข้อมูลประกอบ ─────────────
  {
    key: 'posts', kind: 'module', label: 'ข่าวสาร/ภาพกิจกรรม', icon: 'Newspaper', dept: null,
    zones: ['context'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E2',
    link: { module: 'posts' }, kpis: [], alerts: [], reports: [],
  },
  {
    key: 'tourism', kind: 'module', label: 'เที่ยว กิน พัก ช้อป', icon: 'MapPin', dept: null,
    zones: ['context'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E2',
    link: { module: 'tourism' }, kpis: [], alerts: [], reports: [],
  },
  {
    key: 'tourism-reviews', kind: 'module', label: 'รีวิวสถานที่', icon: 'Star', dept: null,
    zones: ['context'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E2',
    link: { module: 'tourism-reviews' },
    kpis: [kpi('awaiting_review', 'รีวิวรอตรวจ', 'รายการ', 'รีวิวที่ยังไม่ผ่านการตรวจ', 'E2')], alerts: [], reports: [],
  },
  {
    key: 'waste', kind: 'module', label: 'ตารางเก็บขยะ', icon: 'Trash2', dept: null,
    zones: ['context'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E2',
    link: { module: 'waste' }, kpis: [], alerts: [], reports: [],
  },

  // ───────────── แหล่งข้อมูลที่ไม่มีคีย์โมดูล (ต้องลงทะเบียนเหมือนกัน) ─────────────
  {
    key: 'src:esign', kind: 'source', label: 'ลงนามออนไลน์', icon: 'PenLine', dept: null,
    zones: ['decision'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E1',
    link: { module: 'fleet' },
    kpis: [kpi('my_pending', 'เอกสารรอท่านลงนาม', 'ใบ', 'esign_my_pending().count — ปัจจุบันครอบเฉพาะใบขอใช้รถ', 'E1', 'esign_my_pending')],
    alerts: [alert('waiting_2wd', 'รอลงนามเกิน 2 วันทำการ', 'warn', 'รายการที่ถึงคิวท่านมานานกว่า 2 วันทำการ', 'E2')],
    reports: [],
  },
  {
    key: 'src:satisfaction', kind: 'source', label: 'ความพึงพอใจ', icon: 'Smile', dept: null,
    zones: ['service'], isCitizenService: false, docTypes: [], summaryKey: 'satisfaction', phase: 'E2',
    link: { path: '/satisfaction' }, kpis: [], alerts: [], reports: [],
  },
  {
    key: 'src:site-visits', kind: 'source', label: 'สถิติการเข้าชมเว็บไซต์', icon: 'Eye', dept: null,
    zones: ['context'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E2',
    link: { module: 'report' }, kpis: [], alerts: [], reports: [],
  },
  {
    key: 'src:air', kind: 'source', label: 'PM2.5/อากาศ', icon: 'Wind', dept: null,
    zones: ['area', 'alert'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E2',
    link: { path: '/' }, kpis: [], alerts: [], reports: [],
  },
  {
    key: 'src:holidays', kind: 'source', label: 'วันหยุดราชการ', icon: 'CalendarOff', dept: null,
    zones: ['context'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E1',
    link: { module: 'events' }, kpis: [], alerts: [], reports: [],
  },
])

/** คีย์โมดูลที่จงใจไม่ขึ้นห้องผู้บริหาร — ต้องมีเหตุผลเสมอ */
export const EXEC_EXCLUDED = Object.freeze({
  'manual-staff': 'คู่มือการใช้งาน ไม่มีข้อมูลผลงานหรือเรื่องค้าง',
})

/** document_type ที่จงใจไม่ขึ้นตาราง ②-2 — ต้องมีเหตุผลเสมอ (ตอนนี้ไม่มี) */
export const EXEC_DOC_TYPE_EXCLUDED = Object.freeze({})

/** รายการที่ขึ้นจอได้ในเฟสปัจจุบัน และโมดูลเปิดอยู่ (แหล่งข้อมูล kind=source ไม่ผูกโมดูล) */
export function liveEntries(isModuleEnabled = () => true, current = EXEC_CURRENT_PHASE) {
  return EXECUTIVE_REGISTRY.filter((e) =>
    isPhaseLive(e.phase, current) && (e.kind === 'source' || isModuleEnabled(e.key)))
}

/** เจ้าของ document_type (สำหรับลิงก์ไปกล่องงาน) — ประเภทที่ อปท. เพิ่มเองตกที่รายการ acceptsCustomTypes */
export function ownerOfDocType(docType) {
  return EXECUTIVE_REGISTRY.find((e) => e.docTypes.includes(docType))
    ?? EXECUTIVE_REGISTRY.find((e) => e.acceptsCustomTypes)
}

/**
 * ตรวจว่าทะเบียนครบ — ใช้ในเทสต์ (ส่งของปลอมเข้ามาได้เพื่อพิสูจน์ว่าเทสต์ล้มจริง)
 * @returns {string[]} ข้อผิดพลาดเป็นภาษาไทย (ว่าง = ผ่าน)
 */
export function executiveCoverageErrors({
  moduleKeys,
  docTypes,
  registry = EXECUTIVE_REGISTRY,
  excluded = EXEC_EXCLUDED,
  docTypeExcluded = EXEC_DOC_TYPE_EXCLUDED,
  sqlFunctionExists = null, // (name) => boolean · null = ข้ามการตรวจฝั่ง SQL
  current = EXEC_CURRENT_PHASE,
}) {
  const errors = []
  const zoneKeys = Object.keys(EXEC_ZONES)
  const seen = new Set()
  const moduleSet = new Set(moduleKeys)

  for (const e of registry) {
    const where = `รายการ "${e.key}"`
    if (seen.has(e.key)) errors.push(`${where} ลงทะเบียนซ้ำ`)
    seen.add(e.key)
    if (e.kind === 'module' && !moduleSet.has(e.key)) errors.push(`${where} ไม่มีคีย์นี้ใน MODULE_GROUPS (คีย์ค้าง/สะกดผิด)`)
    if (e.kind === 'source' && !String(e.key).startsWith('src:')) errors.push(`${where} kind=source ต้องขึ้นต้นด้วย src:`)
    if (!['module', 'source'].includes(e.kind)) errors.push(`${where} kind ต้องเป็น module หรือ source`)
    if (!e.label || !e.icon) errors.push(`${where} ต้องมี label และ icon`)
    if (!Array.isArray(e.zones) || e.zones.length === 0) errors.push(`${where} ต้องมี zones อย่างน้อย 1`)
    for (const z of e.zones ?? []) if (!zoneKeys.includes(z)) errors.push(`${where} zone "${z}" ไม่มีใน EXEC_ZONES`)
    if (e.isCitizenService && !e.zones?.includes('service')) errors.push(`${where} isCitizenService แต่ไม่อยู่โซน service`)
    if (!EXEC_PHASES.includes(e.phase)) errors.push(`${where} phase "${e.phase}" ไม่ถูกต้อง`)
    if (!e.link || (!e.link.module && !e.link.path)) errors.push(`${where} ต้องมี link.module หรือ link.path`)
    if (e.link?.module && !moduleSet.has(e.link.module)) errors.push(`${where} link.module "${e.link.module}" ไม่มีใน MODULE_GROUPS`)
    if (!Array.isArray(e.docTypes)) errors.push(`${where} docTypes ต้องเป็น array`)
    for (const k of e.kpis ?? []) {
      if (!k.id || !k.label || !k.unit) errors.push(`${where} kpi ต้องมี id/label/unit`)
      if (!k.formula || String(k.formula).trim().length < 8) errors.push(`${where} kpi "${k.id}" ต้องมีสูตร (formula) ที่คำนวณซ้ำได้`)
      if (!EXEC_PHASES.includes(k.phase)) errors.push(`${where} kpi "${k.id}" phase ไม่ถูกต้อง`)
    }
    for (const a of e.alerts ?? []) {
      if (!['info', 'warn', 'critical'].includes(a.severity)) errors.push(`${where} alert "${a.id}" severity ไม่ถูกต้อง`)
      if (!a.rule || String(a.rule).trim().length < 8) errors.push(`${where} alert "${a.id}" ต้องมีกฎ (rule) ที่ตรวจย้อนได้`)
      if (!EXEC_PHASES.includes(a.phase)) errors.push(`${where} alert "${a.id}" phase ไม่ถูกต้อง`)
    }
    if (sqlFunctionExists && e.summaryKey && isPhaseLive('E2', current)) {
      const fn = `exec_summary_${e.summaryKey}`
      if (!sqlFunctionExists(fn)) errors.push(`${where} summaryKey "${e.summaryKey}" แต่ไม่พบฟังก์ชัน public.${fn}() ใน migrations`)
    }
  }

  for (const key of moduleKeys) {
    const inRegistry = registry.some((e) => e.kind === 'module' && e.key === key)
    const reason = excluded[key]
    if (!inRegistry && !(typeof reason === 'string' && reason.trim())) {
      errors.push(`โมดูล "${key}" ยังไม่ได้ลงทะเบียนห้องผู้บริหาร — เพิ่มใน EXECUTIVE_REGISTRY หรือใส่ EXEC_EXCLUDED พร้อมเหตุผล`)
    }
    if (inRegistry && reason) errors.push(`โมดูล "${key}" อยู่ทั้งในทะเบียนและ EXEC_EXCLUDED`)
  }

  for (const t of docTypes) {
    const owners = registry.filter((e) => e.docTypes?.includes(t))
    const reason = docTypeExcluded[t]
    if (owners.length === 0 && !(typeof reason === 'string' && reason.trim())) {
      errors.push(`ประเภทคำขอ "${t}" ไม่มีเจ้าของในทะเบียนห้องผู้บริหาร — ใส่ใน docTypes ของรายการที่ถือเรื่อง`)
    }
    if (owners.length > 1) errors.push(`ประเภทคำขอ "${t}" มีเจ้าของมากกว่า 1 รายการ: ${owners.map((o) => o.key).join(', ')}`)
  }
  if (registry.filter((e) => e.acceptsCustomTypes).length !== 1) {
    errors.push('ต้องมีรายการ acceptsCustomTypes: true เพียง 1 รายการ (รับประเภทคำขอที่ อปท. เพิ่มเอง)')
  }
  return errors
}
