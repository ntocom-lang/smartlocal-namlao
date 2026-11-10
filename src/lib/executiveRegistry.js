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
export const EXEC_CURRENT_PHASE = 'E2'

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
 * แหล่งข้อมูลของ E2 — RPC เดียว executive_overview(_municipality_id, _from, _to, _keys)
 * (supabase/migrations/20261115100000 · 100100 · 100200) SECURITY DEFINER ตรวจสิทธิ์ข้างใน (exec_assert_viewer):
 * viewer / ตำแหน่ง top_admin ทุก role เจ้าหน้าที่ / admin / superadmin ของ อปท. เดียวกัน — อื่นๆ ได้ 42501 ทั้งก้อน
 * คืน { today, from, to, summaries: { <summaryKey>: { ok: true, data } | { ok: false, error } } }
 * - _keys = summaryKey ของรายการที่ขึ้นจอ (โมดูลเปิดอยู่) · ช่วงก่อนหน้า (ลูกศรเทียบ) ส่งเฉพาะ EXEC_PERIOD_KEYS
 * - คีย์ไหน ok:false = การ์ดนั้นขึ้น "โหลดไม่ได้" การ์ดอื่นแสดงตามปกติ
 * - วันทำการไม่คิดใน SQL: backlog คืนยอดจัดกลุ่มตาม due/วันที่แจ้ง ให้หน้าเว็บคิดด้วย workingDays.js สูตรเดียว
 * - ตัวเลขรวมเท่านั้น ไม่มีชื่อคน ข้อความอิสระ หรือ id รายเรื่อง (เทสต์ tests/executive-summary-db.test.mjs ตรวจ)
 */
export const EXEC_E2_RPC = 'executive_overview'

/**
 * summaryKey ที่เรียกซ้ำกับช่วงก่อนหน้าเพื่อทำลูกศรเทียบ — เฉพาะคีย์ที่หน้าจอมีลูกศรใช้จริง
 * departments/fleet ก็ขึ้นกับช่วงเหมือนกัน แต่ยังไม่มีลูกศร จึงไม่ขอ (ลดงานฐานข้อมูลครึ่งหนึ่งของรอบช่วงก่อนหน้า)
 * เพิ่มลูกศรให้คีย์ไหนเมื่อไร ค่อยเติมคีย์นั้นที่นี่
 */
export const EXEC_PERIOD_KEYS = Object.freeze(['complaints', 'doc_requests', 'satisfaction', 'patient_transport'])

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
 * @property {ExecReport[]} reports
 *
 * @typedef {Object} ExecReport  ไทล์ในโซน ⑧ รายงานพร้อมใช้ — 2 แบบ
 * @property {string} id
 * @property {string} label
 * @property {string} [path]      แบบลิงก์: กดแล้วไปหน้าเดิม (route)
 * @property {boolean} [action]   แบบ action: ไม่มี path — หน้าจอวาดไทล์ที่ทำงานเองตาม id (ACTION_REPORTS ใน ExecutiveHome.jsx) เช่น ใบ A4 ที่สร้างตอนกด
 * @property {'E1'|'E2'|'E3'} phase
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
      // ── E2 (executive_overview → summaries.complaints / satisfaction) ──
      kpi('overdue', 'เลยกำหนด', 'เรื่อง', 'คำร้องที่ค้างอยู่ตอนนี้ (new/pending/received/in_progress) และ due_date ก่อนวันนี้ — นับทุกเรื่องที่ค้าง ไม่ขึ้นกับช่วงที่เลือก · ไม่รวมขึ้นทะเบียนรอดำเนินการ (parked) และหมวดเฉพาะกิจ', 'E2', 'executive_overview.complaints.backlog'),
      kpi('on_time_pct', '% เสร็จทันกำหนด', '%', 'ทันกำหนด ÷ (ทันกำหนด + เกินกำหนด + ค้างที่เลยกำหนด ณ สิ้นช่วง) — สูตรเดียวกับเมนูผลการปฏิบัติงาน · ทัน/เกิน = เรื่องที่เสร็จในช่วงนี้ เทียบวันเสร็จกับ due_date · ไม่รวมเรื่องที่ยังไม่รับ หมวดเฉพาะกิจ และหมวดอ่อนไหว (นับค้างที่เลยกำหนดในตัวหาร ไม่งั้นการปล่อยเรื่องยากค้างไว้ทำให้ร้อยละดูดีขึ้น) · ⚠️ นับทั้ง อปท. รวมเรื่องที่ยังไม่มอบหมายผู้รับผิดชอบ ผลรวมของรายงานรายคนจึงอาจน้อยกว่ายอดนี้', 'E2', 'executive_overview.complaints.on_time'),
      kpi('satisfaction', 'คะแนนพึงพอใจ', 'คะแนน', 'ค่าเฉลี่ยคะแนน 1–5 ของ "เสียงผู้รับบริการตัวจริง" (ผู้ถือลิงก์ติดตามเรื่อง หรือผู้ยื่นที่เป็นประชาชนประเมินเอง) ของคำร้องที่ปิดในช่วงนี้ แสดงคู่กับค่าเฉลี่ยทุกที่มา (รวม สท. บันทึกแทน) — สูตรเดียวกับรายงานอัตราตอบ #681', 'E2', 'executive_overview.satisfaction'),
      kpi('response_rate', 'อัตราตอบแบบประเมิน', '%', 'คำร้องที่ปิดในช่วงนี้ซึ่งมีคะแนนอย่างน้อย 1 รายการ ÷ คำร้องที่ปิดในช่วงนี้ (สถานะ closed/completed ไม่รวมหมวดเฉพาะกิจ) — สูตรเดียวกับรายงาน #681', 'E2', 'executive_overview.satisfaction'),
      kpi('not_received', 'ยังไม่รับเรื่อง', 'เรื่อง', 'คำร้องสถานะ new/pending ที่ค้างอยู่ตอนนี้ (ไม่รวมหมวดเฉพาะกิจซึ่งรอเจ้าหน้าที่รับเองตามออกแบบ)', 'E2', 'executive_overview.complaints.backlog'),
      kpi('unassigned', 'ยังไม่มีผู้รับผิดชอบ', 'เรื่อง', 'คำร้องที่ค้างอยู่ตอนนี้และยังไม่ได้มอบหมายผู้รับผิดชอบ (assigned_to ว่าง)', 'E2', 'executive_overview.complaints.backlog'),
      kpi('bottleneck', 'ค้างอยู่ขั้นไหน', 'เรื่อง', 'คำร้องที่ค้างอยู่ตอนนี้แยกขั้น ยังไม่รับ / รับแล้ว / กำลังดำเนินการ พร้อมอายุเฉลี่ยเป็นวันทำการนับจากวันที่แจ้ง และกลุ่มอายุ 0–3 / 4–7 / 8–15 / มากกว่า 15 วันทำการ', 'E2', 'executive_overview.complaints.backlog'),
      kpi('parked', 'ขึ้นทะเบียนรอดำเนินการ', 'เรื่อง', 'คำร้องสถานะ parked ตอนนี้ แยกเหตุผล (แผน/งบประมาณ/อำนาจ/ฤดูกาล/อื่นๆ) — ไม่นับเป็นเลยกำหนด', 'E2', 'executive_overview.complaints.parked'),
      kpi('by_village', 'แยกหมู่บ้าน', 'เรื่อง', 'นับคำร้องที่แจ้งในช่วงนี้ต่อหมู่บ้าน (ยอดรวมต่อหมู่ ไม่แตกหมวด ไม่มีรายเรื่อง) ไม่รวมหมวดเฉพาะกิจและหมวดอ่อนไหว · ข้อความที่เป็นเลขหมู่ล้วน (หมู่ 3 / หมู่ที่ ๓ / หมู่ ที่ 3 / ม.3 / ม 3) รวมเป็น "หมู่ N" ก่อน — ทะเบียนที่ตั้งชื่อ "หมู่ที่ 1" จึงแสดงเป็น "หมู่ 1" กลุ่มเดียวกับที่พิมพ์ "หมู่ 1" · ที่เหลือแสดงเฉพาะชื่อที่ตรงกับทะเบียนสถานที่ที่แอดมินตั้ง (ตัดอักขระล่องหนที่ติดมาจากการคัดลอกก่อนเทียบ) — สถานที่ที่ผู้แจ้งพิมพ์เองนับรวมเป็น "ไม่อยู่ในทะเบียน" เป็นตัวเลขอย่างเดียว (อาจมีชื่อคน/บ้านเลขที่)', 'E2', 'executive_overview.complaints.villages'),
      kpi('repeat', 'ปัญหาซ้ำซาก', 'กลุ่ม', 'หมวดเดียวกัน + หมู่เดียวกัน ตั้งแต่ 3 เรื่องใน 90 วันล่าสุด (ไม่รวมเรื่องที่ไม่รับ หมวดเฉพาะกิจ หมวดอ่อนไหว และสถานที่ที่ไม่อยู่ในทะเบียน/ไม่ใช่เลขหมู่) — ระบบแค่ชี้ ผู้บริหารตัดสินเอง ระบบไม่สร้างโครงการให้', 'E2', 'executive_overview.complaints.repeat'),
      kpi('channel', 'ช่องทางแจ้ง', '%', 'สัดส่วนคำร้องที่แจ้งในช่วงนี้ ออนไลน์ (citizen_online) เทียบรับที่เคาน์เตอร์ (oss_counter)', 'E2', 'executive_overview.complaints.period'),
      kpi('confidential', 'เรื่องอ่อนไหว', 'เรื่อง', 'จำนวนคำร้องหมวดที่ต้องให้เจ้าหน้าที่รับเรื่องเอง (requires_manual_intake เช่น ร้องเรียนเจ้าหน้าที่) ที่แจ้งในช่วงนี้ — แสดงจำนวนเท่านั้น ไม่แตกหมู่บ้าน/หมวด', 'E2', 'executive_overview.complaints.period'),
    ],
    alerts: [
      alert('overdue_5wd', 'เลยกำหนดเกิน 5 วันทำการ', 'critical', 'ค้างอยู่ตอนนี้ และวันนี้เลย due_date มากกว่า 5 วันทำการ (นับด้วยตารางวันหยุดชุดเดียวกับทุกหน้า workingDays.js)', 'E2'),
      alert('low_rating', 'คะแนนประเมิน ≤ 2', 'warn', 'มีคะแนน 1 หรือ 2 ที่ให้ในช่วงที่เลือก (นับทุกที่มา รวมแบบประเมินภาพรวม) — แสดงจำนวนแยกที่มา ไม่แสดงความเห็น', 'E2'),
    ],
    reports: [
      { id: 'monthly', label: 'สรุปเรื่องร้องเรียนรายเดือน', path: '/reports/complaints', phase: 'E1' },
      // รายการแบบ action (ไม่มี path): กดแล้วสร้างใบ A4 จาก executive_overview ตามช่วงที่เลือกในตัวไทล์เอง
      // ตัววาดอยู่ที่ ExecutiveHome.jsx (ACTION_REPORTS ผูกด้วย id) · ใบ: src/lib/executiveServiceReportPrint.js
      // ⚠️ phase 'E2' ทั้งที่เป็นงาน E3-1: ส่งมอบก่อนเปลี่ยน EXEC_CURRENT_PHASE รวม — เปลี่ยนเฟสแล้วจะเปิดการ์ด waiting_2wd ของ E3 ที่ยังไม่มีข้อมูล
      // ย้ายเป็น 'E3' ได้ตอนเปลี่ยนเฟสรวม (ไม่ต้องแก้อย่างอื่น)
      { id: 'service_summary', label: 'สรุปผลการให้บริการประชาชน (A4)', action: true, phase: 'E2' },
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
      // ── E2 (executive_overview → summaries.doc_requests) ──
      kpi('by_type_full', 'แยกประเภทคำขอ (นับในฐานข้อมูล)', 'เรื่อง', 'นับคำขอที่ยื่นในช่วงนี้แยก document_type ในฐานข้อมูลครบทุกแถว (ไม่ถูกตัดที่ 1,000 แถวเหมือนรายการรายเรื่อง) — ยื่น/รอ/กำลังทำ/เสร็จ/ปฏิเสธ + เวลาเฉลี่ย (issued_at − created_at วันปฏิทิน นิยามเดียวกับหน้าสถิติสาธารณะ)', 'E2', 'executive_overview.doc_requests.by_type'),
      kpi('overdue', 'เลยกำหนด', 'เรื่อง', 'คำขอที่ค้างอยู่ตอนนี้ (pending/processing) และ due_date ก่อนวันนี้ — ⚠️ due_date ของคำขอนับวันปฏิทิน (วันยื่น + จำนวนวันที่ตั้งต่อประเภท) ต่างจากคำร้องที่นับวันทำการ', 'E2', 'executive_overview.doc_requests.backlog'),
      kpi('on_time_pct', '% เสร็จทันกำหนด', '%', 'คำขอที่ออกผลในช่วงนี้ภายใน due_date ÷ (ทัน + เกิน + ค้างที่เลยกำหนด ณ สิ้นช่วง) แยกประเภท ไม่รวมคำขอที่ปฏิเสธ — ระยะเวลาต่อประเภทต้องตรงคู่มือสำหรับประชาชนที่ อปท. ประกาศ (ต้องยืนยันกับฉบับปัจจุบัน)', 'E2', 'executive_overview.doc_requests.on_time'),
      kpi('entered', 'ผู้กรอกคำขอ', 'เรื่อง', 'คำขอที่ยื่นในช่วงนี้แยกตาม role ปัจจุบันของบัญชีที่กดยื่น (ฐานข้อมูลประทับเอง แก้ไม่ได้): ประชาชนยื่นเอง / สท. / เจ้าหน้าที่กรอกแทนที่เคาน์เตอร์ / ไม่ทราบผู้กรอก (คำขอก่อน 5 พ.ย. 2569 ที่ยังไม่มีตราประทับ หรือบัญชีผู้กรอกถูกลบแล้ว)', 'E2', 'executive_overview.doc_requests.entered'),
    ],
    alerts: [
      alert('overdue_5wd', 'คำขอเลยกำหนดเกิน 5 วันทำการ', 'critical', 'ค้างอยู่ตอนนี้ และวันนี้เลย due_date มากกว่า 5 วันทำการ (นับด้วย workingDays.js)', 'E2'),
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
      kpi('trips', 'เที่ยวรับ-ส่งจริง', 'เที่ยว', 'จำนวนเที่ยวรถ (patient_booking_trips) ที่มีใบจองผู้ป่วยซึ่งวันนัดอยู่ในช่วง และออกรถแล้ว (outbound/hospital/returning/completed) — ยอดรวมเท่านั้น', 'E2', 'executive_overview.patient_transport.trips'),
      kpi('community_trips', 'เที่ยวรับ-ส่งชุมชน', 'เที่ยว', 'นับแบบเดียวกับเที่ยวผู้ป่วย แต่ใบจองประเภทรถรับ-ส่งชุมชน (service_type community)', 'E2', 'executive_overview.patient_transport.trips'),
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
    // ไม่มี "น้ำมันเกินงบ": แท็บงบยานพาหนะยังซ่อนอยู่ (#501) ข้อมูล fleet_budgets ใช้ตัดสินไม่ได้ — เพิ่มเมื่อเปิดแท็บงบ
    alerts: [
      alert('maintenance_due', 'เลยกำหนดซ่อมบำรุง', 'warn', 'จำนวนรถที่ใช้งานอยู่ (active) ซึ่งมีรอบซ่อมบำรุงเลยวันนี้แล้วอย่างน้อย 1 ประเภท — นับแยกตามประเภทงาน (บำรุงรักษา/เปลี่ยนถ่ายน้ำมัน/ตรวจสภาพ/ยาง ฯลฯ): ดูบันทึกล่าสุดของแต่ละประเภท ถ้าตั้ง "วันซ่อมถัดไป" (next_service_date) ไว้ก่อนวันนี้ = เลยกำหนด · ไม่ได้ตั้ง = ทำรอบแล้ว · บันทึกประเภทอื่น (เช่น ซ่อมแซม) ไม่ล้างรอบ · คันเดียวเลยหลายประเภทนับ 1 คัน — ใช้วันที่อย่างเดียว ไม่ใช้เลขไมล์ (เลขไมล์พิมพ์ผิดลามได้ #170)', 'E2'),
      alert('incidents', 'รถเสียหาย/สูญหาย', 'warn', 'มีบันทึกเหตุรถเสียหายหรือสูญหายที่เกิดในช่วงที่เลือก (incident_date หรือวันรับแจ้งถ้าไม่ระบุวันเกิด)', 'E2'),
    ],
    reports: [],
  },
  {
    key: 'borrowable-assets', kind: 'module', label: 'พัสดุ/ครุภัณฑ์ (ยืม-คืน)', icon: 'Package', dept: 'กองคลัง',
    zones: ['decision', 'alert'], isCitizenService: false, docTypes: [], summaryKey: 'borrowable_assets', phase: 'E2',
    link: { module: 'borrowable-assets' },
    kpis: [
      kpi('awaiting', 'ใบยืมรอพิจารณา', 'ใบ', 'ใบยืมสถานะ submitted ตอนนี้ + วันที่ยื่นของใบที่รอนานสุด (นับวันทำการฝั่งหน้าเว็บ)', 'E2', 'executive_overview.borrowable_assets'),
      kpi('settlement', 'คืนแล้วรอผลชดใช้', 'ใบ', 'ใบยืมสถานะ settlement (คืนของแล้ว รอสรุปการชดใช้ความเสียหาย)', 'E2', 'executive_overview.borrowable_assets'),
    ],
    alerts: [alert('overdue_return', 'ยืมเกินกำหนดคืน', 'warn', 'ใบยืมสถานะ issued (ยืมอยู่) และ return_due_date ก่อนวันนี้', 'E2')],
    reports: [],
  },
  {
    key: 'projects', kind: 'module', label: 'โครงการก่อสร้าง', icon: 'HardHat', dept: 'กองช่าง',
    zones: ['decision', 'alert', 'plan'], isCitizenService: false, docTypes: [], summaryKey: 'projects', phase: 'E2',
    link: { module: 'projects' },
    kpis: [
      kpi('by_stage', 'โครงการตามขั้น', 'โครงการ', 'โครงการที่ยังไม่จบ (ขั้นไม่ใช่ปิดโครงการ/ยกเลิก/บอกเลิกสัญญา) นับแยกขั้นของวงจรโครงการ', 'E2', 'executive_overview.projects.by_stage'),
      kpi('change_pending', 'ขอเปลี่ยนแปลงสัญญารอพิจารณา', 'เรื่อง', 'คำขอขยายเวลา / งด-ลดค่าปรับ / แก้ไขสัญญา ที่ยังไม่มีผลพิจารณา (decision ว่าง) + วันที่ยื่นของรายการเก่าสุด — ระบบไม่มีคำขอเลื่อนขั้นแยก (เลื่อนขั้นทำที่เมนูโครงการโดยตรง)', 'E2', 'executive_overview.projects.change_pending'),
      kpi('suspended', 'ระงับ', 'โครงการ', 'โครงการขั้น suspended ตอนนี้', 'E2', 'executive_overview.projects.suspended'),
    ],
    alerts: [
      alert('behind', 'ช้ากว่าแผน', 'warn', 'โครงการขั้นทำสัญญา/เริ่มงาน/ก่อสร้าง ที่รายงานรายสัปดาห์ฉบับล็อก (final) ล่าสุดติดป้าย "ช้า" (ผลงานจริงต่ำกว่าแผนตั้งแต่ 0.5%) — อ่านป้ายที่ล็อกไว้ ไม่คำนวณใหม่', 'E2'),
      alert('contract_ending', 'ใกล้หมดสัญญา', 'warn', 'วันสิ้นสุดสัญญาที่มีผล (รวมต่อสัญญา/ขยายเวลาที่อนุมัติ — สูตรเดียวกับ contractSchedule ในเมนูโครงการ) เหลือ 0–15 วัน และยังอยู่ขั้นทำสัญญา/เริ่มงาน/ก่อสร้าง', 'E2'),
      alert('contract_past', 'เลยวันสิ้นสุดสัญญา', 'critical', 'วันสิ้นสุดสัญญาที่มีผลผ่านไปแล้ว แต่ยังอยู่ขั้นทำสัญญา/เริ่มงาน/ก่อสร้าง (ยังไม่เข้าขั้นตรวจรับงานงวดสุดท้าย)', 'E2'),
      alert('report_missing', 'ไม่มีรายงานความก้าวหน้า', 'info', 'โครงการขั้นทำสัญญา/เริ่มงาน/ก่อสร้าง ที่ยังไม่มีรายงานรายสัปดาห์ฉบับล็อก หรือฉบับล่าสุดสิ้นช่วงก่อนวันนี้เกิน 14 วัน', 'E2'),
    ],
    reports: [],
  },
  {
    key: 'local-plan', kind: 'module', label: 'แผนพัฒนาท้องถิ่น', icon: 'ClipboardList', dept: 'สำนักปลัด',
    zones: ['decision', 'alert', 'plan'], isCitizenService: false, docTypes: [], summaryKey: 'local_plan', phase: 'E2',
    link: { module: 'local-plan' },
    kpis: [
      // % รายกองไม่คิดใน SQL: viewer/ปลัดอ่านตารางแผนได้ตาม RLS (local_plan_can_read) — ใช้ตัวคำนวณเดียวกับเมนูแผนพัฒนา
      kpi('progress_by_dept', '% ดำเนินการรายกอง', '%', 'รายการในแผนการดำเนินงานฉบับที่มีผลของปีงบนี้ที่ "แล้วเสร็จ" ÷ ทั้งหมดของกอง (นับรายการ ไม่ถ่วงเงิน) — ผลมาจากขั้นโครงการก่อสร้างที่ผูกไว้ก่อน แล้วจึงผลที่กองบันทึก · คำนวณด้วยตัวเดียวกับเมนูแผนพัฒนา', 'E2', 'localPlanProgress.summarize'),
      kpi('drafts', 'ร่างแผนรอประกาศ', 'ฉบับ', 'แผนการดำเนินงาน (ฉบับหลัก/เพิ่มเติม/แก้ไข) และแผนพัฒนาท้องถิ่นที่ยังเป็นฉบับร่าง', 'E2', 'executive_overview.local_plan'),
    ],
    alerts: [
      alert('result_missing', 'ถึงกำหนดแต่ยังไม่มีผล', 'warn', 'รายการในแผนการดำเนินงานฉบับที่มีผลของปีงบนี้ที่เดือนสิ้นสุด (month_to) ผ่านไปแล้ว แต่ยังไม่มีผล (กองยังไม่บันทึก และไม่ได้ผูกโครงการก่อสร้าง)', 'E2'),
      alert('no_published_plan', 'ปีงบนี้ยังไม่ประกาศแผนการดำเนินงาน', 'warn', 'ปีงบประมาณปัจจุบันยังไม่มีแผนการดำเนินงานฉบับหลัก/แก้ไขที่ประกาศแล้ว — ไม่ตัดสินว่าเลยกำหนดตามระเบียบ (วันกำหนดดูที่เมนูแผนพัฒนา)', 'E2'),
    ],
    reports: [],
  },
  {
    // ไม่มีเตือน "งานซ่อมค้าง": infrastructure_works เป็นบันทึกงานหน้างานของช่าง (สถานะเริ่มต้น completed ไม่มีวันปิด)
    // ไม่ใช่คิวงานซ่อม — ตัวเลขค้างจะไม่มีความหมาย (ตรวจ 2026-11-10) · งานซ่อมตามคำร้องนับที่คำร้องแล้ว
    key: 'infra', kind: 'module', label: 'บันทึกงานซ่อม', icon: 'Wrench', dept: 'กองช่าง',
    zones: ['context'], isCitizenService: false, docTypes: [], summaryKey: null, phase: 'E2',
    link: { module: 'infra' },
    kpis: [], alerts: [], reports: [],
  },
  {
    key: 'water-situation', kind: 'module', label: 'สถานการณ์น้ำ-ฝน', icon: 'CloudRain', dept: 'สำนักปลัด',
    zones: ['decision', 'alert', 'area'], isCitizenService: false, docTypes: [], summaryKey: 'water', phase: 'E1',
    link: { path: '/water-situation' },
    kpis: [kpi('announce_pending', 'ประกาศน้ำ-ฝนรอยืนยัน', 'ฉบับ', 'ประกาศที่ระบบร่างแล้ว (status draft) รอผู้มีอำนาจยืนยัน — มีได้ครั้งละ 1 ฉบับต่อ อปท.', 'E2', 'executive_overview.water.announce_pending')],
    // ใช้เกณฑ์เปิดเหตุการณ์ของระบบเอง (ล็อก rule_version ไว้ในเหตุการณ์) ไม่แปลค่าดิบ ThaiWater ซ้ำในหน้านี้
    alerts: [alert('event_open', 'มีเหตุการณ์น้ำ-ฝนเปิดอยู่', 'warn', 'ระบบเปิดเหตุการณ์น้ำ-ฝนตามเกณฑ์ที่ตั้งไว้และยังไม่ปิด (water_events ที่ closed_at ว่าง) + เวลาเปิดของเหตุการณ์เก่าสุด', 'E2')],
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
      kpi('upcoming', 'กำหนดการ 7 วัน', 'รายการ', 'กิจกรรมที่ท่านเห็นในปฏิทิน (list_events_for_staff_between: กติกาการมองเห็นชุดเดียวกับ list_events_for_staff ของหน้าปฏิทิน กรองช่วงวันที่ฐานข้อมูล) + รายการส่วนตัวของท่าน (personal_events) ที่คาบเกี่ยววันนี้ถึงอีก 7 วัน — ชุดเดียวกับปฏิทินกิจกรรม', 'E2', 'list_events_for_staff_between + personal_events'),
    ],
    alerts: [], reports: [],
  },
  {
    key: 'performance', kind: 'module', label: 'ผลการปฏิบัติงาน', icon: 'Award', dept: null,
    zones: ['dept'], isCitizenService: false, docTypes: [], summaryKey: 'departments', phase: 'E2',
    link: { module: 'performance' },
    // 1 แถวต่อกอง ไม่จัดอันดับรายคน (ดูรายคนที่เมนูผลการปฏิบัติงานตามสิทธิ์เดิม)
    kpis: [
      kpi('dept_open', 'งานบริการค้างรายกอง', 'เรื่อง', 'คำร้อง (ไม่รวมหมวดเฉพาะกิจ รวมเรื่องที่ยังไม่รับ) + คำขอ ที่ค้างอยู่ตอนนี้ แยกตามกองที่ถือเรื่อง (department_id หรือชื่อกองเดิมของคำร้อง — ชุดเดียวกับเมนูผลการปฏิบัติงาน) · เรื่องที่ไม่ระบุกองแสดงท้ายตาราง · ⚠️ ต่างจาก "กองของฉัน" ในหน้าแรกเจ้าหน้าที่ที่นับเฉพาะเรื่องที่รับแล้ว', 'E2', 'executive_overview.departments'),
      kpi('dept_overdue', 'เลยกำหนดรายกอง', 'เรื่อง', 'ส่วนของงานค้างที่ due_date ก่อนวันนี้ (คำร้องนับวันทำการตอนตั้งกำหนด คำขอนับวันปฏิทิน)', 'E2', 'executive_overview.departments'),
      kpi('dept_done', 'เสร็จในช่วงนี้รายกอง', 'เรื่อง', 'คำร้องที่วันเสร็จอยู่ในช่วง (นิยามวันเสร็จเดียวกับเมนูผลการปฏิบัติงาน) + คำขอที่ออกผล (issued_at) ในช่วง', 'E2', 'executive_overview.departments'),
      kpi('dept_rating', 'คะแนนเฉลี่ยรายกอง', 'คะแนน', 'ค่าเฉลี่ย "เสียงผู้รับบริการตัวจริง" ของคำร้องที่ปิดในช่วงนี้ แยกตามกองของคำร้อง พร้อมจำนวนคะแนน (ไม่มีคะแนน = ขีด ไม่ใช่ 0)', 'E2', 'executive_overview.satisfaction.by_dept'),
    ],
    alerts: [], reports: [],
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
    // รีวิวไม่มีสถานะ "รอตรวจ" — ขึ้นทันที เจ้าหน้าที่ลบรีวิวไม่เหมาะสมภายหลัง (TourismManager.jsx) จึงนับรีวิวใหม่แทน
    kpis: [kpi('new_reviews', 'รีวิวใหม่', 'รายการ', 'รีวิวสถานที่ที่เขียนในช่วงที่เลือก (tourism_reviews.created_at) — รีวิวขึ้นทันทีโดยไม่ผ่านการตรวจ เจ้าหน้าที่ลบรีวิวไม่เหมาะสมภายหลังได้', 'E2', 'tourism_reviews')],
    alerts: [], reports: [],
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
    // E3: esign_my_pending ยังไม่มีเวลาที่ "ถึงคิวท่าน" (มีแค่ planned_departure/last_return) — ต้องอนุมานจากเวลาลงนามช่องก่อนหน้าใน esign_slots
    alerts: [alert('waiting_2wd', 'รอลงนามเกิน 2 วันทำการ', 'warn', 'รายการที่ถึงคิวท่านมานานกว่า 2 วันทำการ (นับจากเวลาที่ช่องก่อนหน้าลงนาม)', 'E3')],
    reports: [],
  },
  {
    key: 'src:satisfaction', kind: 'source', label: 'ความพึงพอใจ', icon: 'Smile', dept: null,
    zones: ['service'], isCitizenService: false, docTypes: [], summaryKey: 'satisfaction', phase: 'E2',
    link: { path: '/satisfaction' },
    // ไม่แสดงความเห็น (ข้อความที่ผู้ประเมินพิมพ์เอง) บนหน้ารวม — RPC ไม่คืนอยู่แล้ว
    kpis: [
      kpi('by_source', 'คะแนนแยกที่มา', 'คะแนน', 'จำนวนเรื่องและค่าเฉลี่ยคะแนนของคำร้องที่ปิดในช่วงนี้ แยก: ผู้ยื่นที่ล็อกอินประเมินเอง / ผู้ถือลิงก์ติดตามเรื่อง / สท. บันทึกแทน / ผูกคำร้องแต่ไม่ล็อกอิน — สูตรเดียวกับรายงาน #681', 'E2', 'executive_overview.satisfaction.sources'),
      kpi('general', 'แบบประเมินภาพรวม', 'คะแนน', 'จำนวนและค่าเฉลี่ยแบบประเมินภาพรวมหน่วยงาน (หน้า /satisfaction ไม่ผูกคำร้อง) ที่ให้ในช่วงนี้', 'E2', 'executive_overview.satisfaction.general'),
    ],
    alerts: [], reports: [],
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
