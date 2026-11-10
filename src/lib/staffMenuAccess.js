// "บัญชีนี้เห็นเมนูโมดูลไหนในระบบเจ้าหน้าที่" — ฟังก์ชันบริสุทธิ์ (JS ล้วน เทสต์ด้วย node ได้)
//
// แยกออกมาจาก StaffDashboard.jsx (ตรรกะเดิมย้ายมาทั้งก้อน ไม่แก้ความหมาย) เพื่อให้ "ห้องผู้บริหาร" (/executive)
// ใช้ตัวเดียวกันตัดสินว่าลิงก์ไปโมดูลไหนเปิดได้จริง ไม่ทำปุ่มหลอก — ถ้าสองหน้าถือกฎคนละชุดจะเห็นเมนูไม่ตรงกัน
// ⚠️ แก้กฎเมนูที่นี่ที่เดียว (tests/staff-menu-access.test.mjs ตรึงผลเทียบกับตรรกะเดิมของ StaffDashboard)

import { PATIENT_TRANSPORT_MODULE_KEY } from './patientTransport.js'
import { MANAGED_MODULE_KEYS } from './staffModules.js'

/**
 * บทบาทที่เปิดเมนู "ผลการปฏิบัติงาน" ได้ — ผู้บริหาร (viewer) อยู่ในสายการประเมิน (แบบประเมินส่วนที่ 6–8)
 * ส่วนสมาชิกสภา (council) ไม่อยู่ในสายบังคับบัญชาหรือแบบประเมิน จึงไม่เห็น
 * (ย้ายมาจาก staffPerformanceData.js — ไฟล์นั้นยังส่งออกซ้ำชื่อเดิม · ไฟล์นี้ห้าม import supabase เพื่อให้เทสต์ด้วย node ได้)
 */
export const PERFORMANCE_ROLES = ['technician', 'staff', 'officer', 'admin', 'superadmin', 'viewer']

/**
 * คีย์เมนูทั้งหมดของหน้าเจ้าหน้าที่ (STANDALONE_GROUPS + MODULE_GROUPS ใน StaffDashboard.jsx)
 * ⚠️ ต้องตรงกับ StaffDashboard.jsx — tests/staff-menu-access.test.mjs ไล่เทียบจากซอร์สให้ ล้มถ้าเพิ่ม/ลบเมนูแล้วลืมแก้ที่นี่
 */
export const STAFF_MENU_MODULE_KEYS = Object.freeze([
  'complaints', 'inbox', PATIENT_TRANSPORT_MODULE_KEY,
  'events', 'posts', 'tourism', 'tourism-reviews',
  'report', 'performance', 'data-center', 'fleet', 'borrowable-assets',
  'manual-staff',
  'waste', 'water-events', 'local-plan',
  'infra', 'projects',
])

// เมนูที่ช่างเห็นในหน้าเจ้าหน้าที่ (ช่างคือเจ้าหน้าที่กองช่าง เข้าหน้านี้ได้ ดู RequireAuth ใน App.jsx)
//
// จำเป็นต้องมีลิสต์นี้เพราะหน้านี้กรองเมนูด้วย tenant.enabled_modules อย่างเดียว ไม่ได้กรองตาม role
// เลย ถ้าเปิดประตูให้ technician โดยไม่มีตัวกรอง ช่างจะเห็นครบทุกโมดูลรวมถึงคำขอเอกสารของประชาชน
//
// เลือกจาก "สิ่งที่ RLS ฝั่ง DB เปิดให้ technician อ่านได้จริง" ไม่ใช่เดาจากชื่อเมนู:
//   - 'inbox' (คำขอเอกสาร) ไม่อยู่ในลิสต์โดยตั้งใจ — policy `read document_requests` มีเงื่อนไข
//     เฉพาะ superadmin/admin/officer/staff ไม่มี technician เลย โชว์เมนูไปก็กดเจอหน้าว่าง
//     ซึ่งแยกไม่ออกจาก "ไม่มีข้อมูล" = โกหกผู้ใช้
//   - 'fleet' ใช้คอลัมน์ profiles.fleet_role แยกต่างหาก ไม่ผูกกับ role หลัก ช่างที่ได้รับสิทธิ์
//     ยานพาหนะจึงใช้ได้ตามปกติ ส่วนคนที่ไม่ได้ตั้ง fleet_role จะเข้าไปแล้วไม่เห็นข้อมูลเอง
export const TECHNICIAN_MODULE_KEYS = [
  'complaints',    // คำร้อง — RLS: complaints select by role scope ครอบ technician อยู่แล้ว
  'infra',         // บันทึกงานซ่อม — งานหลักของกองช่าง
  'projects',      // โครงการก่อสร้าง/รายงานสัปดาห์ — ผู้ควบคุมงานมักเป็นช่าง · RLS civil_* ให้ช่างเห็นเฉพาะโครงการที่ตนสร้าง/ถูกระบุชื่อ/กองเดียวกัน
  'events',        // ปฏิทินกิจกรรม
  'data-center',   // ศูนย์ข้อมูลดิจิทัล
  'fleet',         // ยานพาหนะและเชื้อเพลิง
  'manual-staff',  // คู่มือ
  'performance',   // ผลการปฏิบัติงาน — RPC staff_performance_rows ให้ช่างดูของตัวเองได้
]

/**
 * เมนูที่ "ไม่ได้เปิดเป็น activeModule ของ /staff" — ลิงก์จากหน้าอื่น (ห้องผู้บริหาร) ต้องไปให้ถูกทาง
 *   externalUrl = หน้าแยกที่ route ของตัวเอง (navigate) · newTab = เอกสารคงที่เปิดแท็บใหม่
 * โมดูลที่ไม่อยู่ในนี้ = เปิดด้วย navigate('/staff', { state: { module: key } })
 * ⚠️ ต้องตรงกับ externalUrl/newTab ของรายการใน StaffDashboard.jsx — tests/staff-menu-access.test.mjs ไล่เทียบจากซอร์สให้
 */
export const STAFF_MENU_TARGETS = Object.freeze({
  'data-center': Object.freeze({ externalUrl: '/data-center/staff' }),
  'manual-staff': Object.freeze({ newTab: '/manual-staff.html' }),
})

/**
 * สิทธิ์เมนูของบัญชีหนึ่งใน อปท. หนึ่ง — ตรรกะเดิมของ StaffDashboard ทุกบรรทัด (ห้ามเปลี่ยนความหมาย)
 *
 * @param {{
 *   role?: string|null,
 *   profile?: { fleet_role?: string|null, asset_role?: string|null }|null,
 *   tenant?: { enabled_modules?: string[]|null }|null,
 *   allModuleKeys?: readonly string[],   // คีย์เมนูทั้งหมด (StaffDashboard ส่งของตัวเองมา ห้องผู้บริหารใช้ค่าเริ่มต้น)
 * }} input
 * @returns {{ enabledKeys: string[], scopedKeys: string[], hasLocalPlanAccess: boolean }}
 *   enabledKeys = ผ่านการตั้งค่า อปท. (+ สิทธิ์พิเศษสภา) · scopedKeys = ผ่านบทบาท/สิทธิ์รายบุคคลด้วย = เมนูที่เห็นจริง
 */
export function staffMenuAccess({ role, profile, tenant, allModuleKeys = STAFF_MENU_MODULE_KEYS } = {}) {
  // คีย์ที่ตั้งเปิด-ปิดรายหน่วยงานได้ มาจากลิสต์กลางที่ ModuleManager (หน้า admin) ใช้ร่วมกัน
  // คีย์ที่ไม่อยู่ในลิสต์นั้นจะเปิดให้ทุก อปท. เสมอ เพราะไม่มี UI ให้ตั้งค่า
  const baseEnabledKeys = tenant?.enabled_modules
    ? [...tenant.enabled_modules, ...allModuleKeys.filter((k) => !MANAGED_MODULE_KEYS.includes(k))]
    : [...allModuleKeys]

  // สิทธิ์พิเศษของ council ต้องอยู่ "ใต้" การตั้งค่าระดับ อปท. เสมอ — หน่วยงานปิดศูนย์ข้อมูล/รายงานไว้ สมาชิกสภาก็ต้องไม่เห็น
  const councilExtraKeys = role === 'council'
    ? ['data-center', 'report'].filter((k) => baseEnabledKeys.includes(k))
    : []
  const enabledKeys = Array.from(new Set([...baseEnabledKeys, ...councilExtraKeys]))

  // 'fleet' ผูกกับ profiles.fleet_role (fleet_role ใดก็ได้ หรือเป็น admin/superadmin) ต้องตรงกับ hasAccess ใน FleetPage เป๊ะ
  const hasFleetAccess = Boolean(profile?.fleet_role) || role === 'admin' || role === 'superadmin'
  // พัสดุ/ครุภัณฑ์ใช้ profiles.asset_role — ต้องตรงกับ asset_is_manager()/asset_can_manage() ฝั่งฐานข้อมูล
  const hasAssetAccess = Boolean(profile?.asset_role) || role === 'admin' || role === 'superadmin'
  // ผลการปฏิบัติงาน: ต้องตรงกับสิทธิ์ใน RPC staff_performance_rows + อปท. ต้องเปิดโมดูลคำร้อง (ข้อมูลมาจากคำร้องล้วน)
  const hasPerformanceAccess = PERFORMANCE_ROLES.includes(role) && enabledKeys.includes('complaints')
  // เหตุการณ์น้ำ-ฝน: ต้องตรงกับ can_view_water_events() ฝั่งฐานข้อมูล + อปท. ต้องเปิดโมดูลสถานการณ์น้ำ-ฝน
  // กติกา enabled_modules เดียวกับ isModuleEnabled: แถวที่ไม่ใช่ array = ยังไม่เคยตั้งค่า ถือว่าเปิดทุกโมดูล
  const hasWaterEventsAccess = ['superadmin', 'admin', 'officer', 'staff'].includes(role)
    && (!Array.isArray(tenant?.enabled_modules) || tenant.enabled_modules.includes('water-situation'))
  // แผนพัฒนาท้องถิ่น: อ่านได้ตามบทบาทที่ local_plan_can_read() รับ (ช่างเข้าไม่ได้ผ่านเมนู)
  const hasLocalPlanAccess = ['superadmin', 'admin', 'officer', 'staff', 'viewer'].includes(role)

  const roleScopedKeys = role === 'technician'
    ? enabledKeys.filter((k) => TECHNICIAN_MODULE_KEYS.includes(k))
    : enabledKeys
  const scopedKeys = [
    ...(hasFleetAccess ? [] : ['fleet']),
    ...(hasAssetAccess ? [] : ['borrowable-assets']),
    ...(hasPerformanceAccess ? [] : ['performance']),
    ...(hasWaterEventsAccess ? [] : ['water-events']),
    ...(hasLocalPlanAccess ? [] : ['local-plan']),
  ].reduce((keys, hidden) => keys.filter((k) => k !== hidden), roleScopedKeys)

  return { enabledKeys, scopedKeys, hasLocalPlanAccess }
}

/** คีย์โมดูลที่บัญชีนี้เห็นในเมนูจริง (= scopedKeys ของ StaffDashboard) */
export function staffVisibleModuleKeys(input) {
  return staffMenuAccess(input).scopedKeys
}

/**
 * โมดูลนี้ "เปิดอยู่" สำหรับบัญชีนี้ไหม — โมดูลที่เป็นเมนูใช้ scopedKeys (รวมสิทธิ์รายบุคคลแล้ว)
 * ส่วนคีย์ตั้งค่าที่ไม่ใช่เมนู (งานประปา สถานการณ์น้ำ-ฝน) ใช้กติกา enabled_modules เดียวกับ isModuleEnabled ของ TenantContext
 * @param {string} key
 * @param {{ scopedKeys: string[], menuKeys?: readonly string[], tenantModuleEnabled: (key: string) => boolean }} ctx
 */
export function isStaffModuleEnabled(key, { scopedKeys, menuKeys = STAFF_MENU_MODULE_KEYS, tenantModuleEnabled }) {
  return menuKeys.includes(key) ? scopedKeys.includes(key) : tenantModuleEnabled(key)
}
