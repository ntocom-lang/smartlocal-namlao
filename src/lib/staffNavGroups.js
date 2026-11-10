// รายการเมนูของระบบเจ้าหน้าที่ (กลุ่มข้ามกอง + กลุ่มตามกอง) — แยกออกจาก StaffDashboard.jsx เพื่อให้
// "ห้องผู้บริหาร" (/executive) วาดเมนูซ้าย/แถบล่างชุดเดียวกันโดยไม่ต้องโหลดทั้งหน้าเจ้าหน้าที่
// ⚠️ เพิ่ม/ลบเมนูที่นี่ที่เดียว — tests/staff-menu-access.test.mjs ไล่เทียบกับ STAFF_MENU_MODULE_KEYS ให้
//    (ไฟล์นี้ต้องไม่ import supabase/คอมโพเนนต์ เพื่อให้เป็นข้อมูลล้วน)
import {
  FileText, MessageSquareWarning, CalendarDays, Images, Luggage, Star, Car, Trash2, Database, BookOpen,
  PackageOpen, Ambulance, ClipboardCheck, CloudRain, HardHat, ClipboardList, Hammer, TrendingUp, ChartColumn, LayoutDashboard,
} from 'lucide-react'
import { PATIENT_TRANSPORT_MODULE_KEY } from './patientTransport'

// ทางเข้า "ห้องผู้บริหาร" (/executive) บนเมนูซ้าย PC และลิ้นชักมือถือ — เจ้าของระบบสั่ง 2569-11-10
// ไม่ใช่คีย์โมดูล (ไม่อยู่ใน MODULES/enabled_modules) จึงวางเป็นทางลัดใต้ "แดชบอร์ด" และแสดงเฉพาะคนที่เปิดห้องได้
export const EXECUTIVE_MENU_ITEM = Object.freeze({ key: 'executive-room', label: 'ห้องผู้บริหาร', Icon: ChartColumn, externalUrl: '/executive' })

// เมนูที่ข้ามกอง (ใช้ร่วมกันทุกกอง ไม่ผูกกับกองใดกองหนึ่ง) — จัดเป็นกลุ่มย่อยตามลักษณะงาน
// เพื่อให้หาเจอง่าย แทนที่จะเป็นลิสต์ยาวไม่มีหัวข้อ
export const STANDALONE_GROUPS = [
  {
    group: 'งานบริการประชาชน',
    items: [
      { key: 'complaints', label: 'คำร้อง',     Icon: MessageSquareWarning, color: '#ef4444', bg: '#fee2e2', desc: 'รับเรื่อง ตรวจสอบ มอบหมาย และติดตามผล' },
      { key: 'inbox',      label: 'คำขอบริการ/เอกสาร', Icon: FileText,       color: '#8b5cf6', bg: '#ede9fe', desc: 'รับคำขอเอกสารจากประชาชน ออกเลข และติดตามสถานะ' },
      // โมดูลในโครงหน้าเจ้าหน้าที่ (เมนูบน/ซ้ายครบเหมือนโมดูลอื่น) · route /staff/patient-transport
      // ยังใช้ได้ แต่เป็นทางลัดที่พามาเปิดโมดูลนี้ในโครงเดิม ไม่ใช่หน้าลอยแยก
      // คีย์อยู่ใน MANAGED_MODULE_KEYS จึงโผล่เฉพาะ อปท. ที่เปิดโมดูลนี้ — เดิมเป็นปุ่มฝังบนหัวหน้าจอ
      { key: PATIENT_TRANSPORT_MODULE_KEY, label: 'รถรับ-ส่งผู้ป่วย', Icon: Ambulance, color: '#0284c7', bg: '#e0f2fe', desc: 'รับเรื่อง จัดคิวรถ และออกหนังสือนำส่งกองทุน' },
    ],
  },
  {
    group: 'ประชาสัมพันธ์และท่องเที่ยว',
    items: [
      { key: 'events',          label: 'ปฏิทินกิจกรรม',       Icon: CalendarDays, color: '#10b981', bg: '#d1fae5', desc: 'กำหนดการและปฏิทินกิจกรรมของหน่วยงาน' },
      { key: 'posts',           label: 'ข่าวสาร/ภาพกิจกรรม',  Icon: Images,       color: '#059669', bg: '#d1fae5', desc: 'ประกาศ ข่าวประชาสัมพันธ์ และอัลบั้มภาพ' },
      { key: 'tourism',         label: 'เที่ยว กิน พัก ช้อป บริการ', Icon: Luggage,      color: '#d97706', bg: '#fef3c7', desc: 'ที่เที่ยว ร้านอาหาร ที่พัก OTOP และร้านบริการในพื้นที่' },
      { key: 'tourism-reviews', label: 'รีวิวสถานที่',        Icon: Star,         color: '#f59e0b', bg: '#fef3c7', desc: 'ตรวจสอบและลบรีวิวที่ไม่เหมาะสม' },
    ],
  },
  {
    group: 'แผนงานและทรัพยากรกลาง',
    items: [
      // 'civil-report' (รายงานโครงการ) ยังถอดอยู่ · 'projects' กลับมาแล้วในกลุ่มกองช่างเป็นโมดูลโครงการก่อสร้าง + รายงานสัปดาห์ (2569-11-06)
      // คอมโพเนนต์เดิม CivilProjectAdmin/CivilProjectReport ยังอยู่ในโฟลเดอร์ admin แต่ไม่มีเมนูหรือ branch เรียกแล้ว
      { key: 'report',        label: 'รายงานคำร้อง',     Icon: TrendingUp,    color: '#f59e0b', bg: '#fef3c7', desc: 'สรุปสถิติคำร้องตามขอบเขตสิทธิ์และพิมพ์รายงาน' },
      // อยู่ใน MANAGED_MODULE_KEYS ตั้งแต่ 2569-11-09 (ปิดรายหน่วยงานได้ที่หน้าจัดการโมดูล)
      // แล้วคุมด้วยบทบาทและโมดูลคำร้องอีกชั้น (hasPerformanceAccess ด้านล่าง)
      { key: 'performance',   label: 'ผลการปฏิบัติงาน',   Icon: ClipboardCheck, color: '#7c3aed', bg: '#ede9fe', desc: 'ผลงานรายคนจากคำร้อง รายเดือน ไตรมาส ปี และรอบการประเมิน' },
      // externalUrl (ไม่ใช่ activeModule) เพราะศูนย์ข้อมูลเป็นหน้าแยกที่ route /data-center/staff
      // เดิมคีย์นี้ไม่มีในลิสต์เลย ถูก hardcode เป็นปุ่มใน sidebar อย่างเดียว ผลคือหน้าแดชบอร์ด
      // (ที่ไล่เมนูจาก visibleGroups) หามันไม่เจอ — "เมนูใช้งานด่วน" เหลือ 2 ปุ่ม และบนมือถือที่ไม่มี
      // sidebar เหลือทางเข้าเดียวคือไอคอนเล็กๆ บน header ที่ไม่มีป้ายชื่อ
      { key: 'data-center', label: 'ศูนย์รวมข้อมูลดิจิทัล', Icon: Database, color: '#0284c7', bg: '#e0f2fe', externalUrl: '/data-center/staff' },
      { key: 'fleet',    label: 'ยานพาหนะและเชื้อเพลิง',  Icon: Car,           color: '#0369a1', bg: '#e0f2fe', desc: 'ทะเบียนรถและเครื่องยนต์ การใช้รถ การเบิกเชื้อเพลิง และซ่อมบำรุง' },
      // อยู่ใน MANAGED_MODULE_KEYS ตั้งแต่ 2569-11-09 (ปิดรายหน่วยงานได้) แล้วคุมด้วย profiles.asset_role
      // อีกชั้น (แบบเดียวกับ fleet) — คนที่ไม่ได้รับสิทธิ์จะไม่เห็นเมนูนี้เลย ไม่ใช่เห็นแล้วกดไม่ได้
      // ⚠️ คีย์ยังเป็น 'borrowable-assets' ตามเดิม เปลี่ยนแค่ป้ายชื่อที่เจ้าหน้าที่เห็น —
      // คีย์นี้ผูกกับ activeModule, TECHNICIAN_MODULE_KEYS และค่าใน enabled_modules ของทุก อปท.
      // เปลี่ยนคีย์เมื่อไหร่เมนูหายทั้งระบบ
      { key: 'borrowable-assets', label: 'พัสดุ/ครุภัณฑ์', Icon: PackageOpen, color: '#0d9488', bg: '#ccfbf1', desc: 'ทะเบียนพัสดุ ครุภัณฑ์ และการยืม-คืน' },
    ],
  },
  // กลุ่ม 'บุคลากร' (เมนู 'positions' ทำเนียบตำแหน่ง) ถอดออก 2026-08-31 — ซ้ำกับหน้า
  // "จัดการผู้ใช้และการแต่งตั้ง" ฝั่งแอดมิน ส่วนการแก้แบบตำแหน่งย้ายไป SuperAdminPanel → แบบตำแหน่ง
  {
    group: 'คู่มือ',
    items: [
      // newTab: เปิดเอกสารคงที่ (static HTML) แท็บใหม่ — ต่างจาก externalUrl ที่ navigate() ในแท็บเดิม
      // (ใช้กับ route ภายในแอปเท่านั้น เพราะไฟล์ static ไม่มี route จับใน App.jsx)
      { key: 'manual-staff', label: 'คู่มือเจ้าหน้าที่', Icon: BookOpen, color: '#0369a1', bg: '#e0f2fe', newTab: '/manual-staff.html' },
    ],
  },
]

// จัดกลุ่มเมนูตามโครงสร้างส่วนราชการจริง (สำนักปลัด/กองคลัง/กองช่าง/กองการศึกษา/ตรวจสอบภายใน)
// กองที่ยังไม่มีเมนูงาน (items ว่าง) ไม่ขึ้นในเมนู — เดิมโชว์หัวกองพร้อมข้อความ "ยังไม่มีเมนูงานในกองนี้" ไว้ให้ครบทุกกอง
// แต่กลายเป็นบรรทัดว่างที่กดไม่ได้ 3 กอง (2569-10-14 เจ้าของให้ซ่อน) · คงนิยามกองไว้ เมนูใหม่ของกองนั้นจะโผล่เองเมื่อเพิ่มเข้า items
export const MODULE_GROUPS = [
  {
    group: 'สำนักปลัด',
    items: [
      // วางใต้สำนักปลัดเพราะยังไม่มี อปท. ไหนมีกองสาธารณสุขใน departments (ตรวจ 2569-09-07)
      // ถ้าวันหนึ่งเพิ่มกองสาธารณสุขแล้วมีกลุ่มเมนูของกองนั้น ให้ย้ายมาไว้ที่นั่น
      // เมนูนี้ทุกคนใน อปท. เห็นได้ (อ่านอย่างเดียว) — สิทธิ์แก้ตัดสินที่ can_manage_waste_schedule()
      { key: 'waste', label: 'ตารางเก็บขยะ', Icon: Trash2, color: '#15803d', bg: '#dcfce7', desc: 'ตั้งรอบเก็บขยะครั้งเดียว ระบบแจ้งวันเก็บให้ประชาชนเอง' },
      // อ่านอย่างเดียว ไม่มีช่องกรอก — ระบบจดค่าฝน/ระดับน้ำช่วงเกิดเหตุการณ์ให้เอง (water_event_tick) เปิดดูตอนมีคนถาม
      // มีคีย์ enabled_modules ของตัวเองตั้งแต่ 2569-11-09 · โผล่เมื่อ อปท. เปิดทั้ง 'water-events' และ 'water-situation' + บทบาทเห็นได้ (hasWaterEventsAccess)
      // วางใต้สำนักปลัดแบบเดียวกับตารางเก็บขยะ — ⚠️ ยังไม่มี อบต. ยืนยันว่ากองไหนดูแลงานป้องกันสาธารณภัย ย้ายได้ที่นี่จุดเดียว
      { key: 'water-events', label: 'เหตุการณ์น้ำ-ฝน', Icon: CloudRain, color: '#0369a1', bg: '#e0f2fe', desc: 'ระบบจดค่าฝนและระดับน้ำช่วงเกิดเหตุการณ์ให้เอง ดูย้อนหลังได้เกิน 7 วัน ไม่ต้องกรอกอะไร' },
      // แผนพัฒนาท้องถิ่น (ทะเบียนโครงการ + แผนการดำเนินงานรายปี) — อยู่ใน MANAGED_MODULE_KEYS ตั้งแต่ 2569-11-09 (เดิมเปิดทุก อปท. ไม่มีคีย์)
      // คุมการเห็นด้วยบทบาท (hasLocalPlanAccess) เหมือน water-events · ไม่อยู่ใน TECHNICIAN_MODULE_KEYS · label ในรายการนี้เป็นค่าสำรองตอนโหลดชื่อไม่ได้
      // ชื่อจริงที่เห็นอ่านช่วงปีจากแผนที่เมนูแสดง (localPlanLabel — ห้ามฝังปีในโค้ด) · ใครแก้ได้ตัดสินที่ RLS (plan_role / admin) ไม่ใช่ที่นี่
      { key: 'local-plan', label: 'แผนพัฒนาท้องถิ่น', Icon: ClipboardList, color: '#4f46e5', bg: '#e0e7ff', desc: 'ทะเบียนโครงการในแผนพัฒนา และแผนการดำเนินงานรายปี ระบบนับกำหนดตามระเบียบให้' },
    ],
  },
  { group: 'กองคลัง', items: [] },
  {
    group: 'กองช่าง',
    items: [
      { key: 'infra', label: 'บันทึกงานซ่อม', Icon: Hammer, color: '#0891b2', bg: '#e0f2fe', desc: 'ช่างปักหมุดหน้างาน · ธุรการบันทึกรายละเอียด' },
      // คีย์ 'projects' เดิม (เคยเป็น "แผนงาน/โครงการ" ที่ถอดออกรอออกแบบใหม่) — ออกแบบใหม่เป็นโครงการก่อสร้าง + รายงานผลประจำสัปดาห์
      // ต้องมีคีย์ 'projects' ใน municipalities.enabled_modules ของ อปท. นั้นถึงจะเห็นเมนู (ตรวจ 2569-11-06: demo/ตำหนักธรรมมี น้ำเลา/ทุ่งแก้วยังไม่มี)
      // สิทธิ์จริงตัดสินที่ RLS ของ civil_* (บทบาท+กอง+ผู้ถูกระบุเป็นผู้ควบคุมงาน) ไม่ใช่ที่นี่
      { key: 'projects', label: 'โครงการก่อสร้าง', Icon: HardHat, color: '#b45309', bg: '#fef3c7', desc: 'ตั้งโครงการครั้งเดียว รายงานผลรายสัปดาห์ ระบบคำนวณและพิมพ์ให้' },
    ],
  },
  { group: 'กองการศึกษา', items: [] },
  { group: 'ตรวจสอบภายใน', items: [] },
]
export const MODULES = [...STANDALONE_GROUPS.flatMap(g => g.items), ...MODULE_GROUPS.flatMap(g => g.items)]

// ─── แถบล่างมือถือ ────────────────────────────────────────────────────────────
// ทางลัดที่ใช้บ่อยบนแถบล่าง (กรองด้วย visibleModules เหมือนเมนูซ้าย — ปิดโมดูลแล้วต้องหายทั้งระบบ ไม่งั้นเป็นปุ่มหลอก)
// ใช้ร่วม /staff กับห้องผู้บริหาร: ช่องแรกต่างกัน (แดชบอร์ด ↔ ห้องผู้บริหาร) ที่เหลือ + ปุ่ม "เมนู" เหมือนกัน
export const STAFF_HOME_TAB = Object.freeze({ key: 'home', label: 'แดชบอร์ด', Icon: LayoutDashboard })
export const EXECUTIVE_TAB = Object.freeze({ key: 'executive-room', label: 'ห้องผู้บริหาร', Icon: ChartColumn })
const SHORTCUT_TABS = [
  { key: 'inbox',      label: 'คำขอบริการ/เอกสาร', Icon: FileText },
  { key: 'complaints', label: 'คำร้อง',      Icon: MessageSquareWarning },
  { key: 'events',     label: 'ปฏิทินกิจกรรม', Icon: CalendarDays },
]
export function staffBottomTabs(visibleModules, firstTab = STAFF_HOME_TAB) {
  return [firstTab, ...SHORTCUT_TABS.filter(({ key }) => visibleModules.some((m) => m.key === key))]
}
