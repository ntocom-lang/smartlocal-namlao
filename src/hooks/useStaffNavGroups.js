import { useEffect, useMemo, useState } from 'react'
import { STANDALONE_GROUPS, MODULE_GROUPS } from '../lib/staffNavGroups'
import { fetchCurrentPlanYears } from '../lib/localPlanApi'
import { menuLabel } from '../lib/localPlanView'

// เมนูที่บัญชีนี้เห็นจริงในระบบเจ้าหน้าที่ — ใช้ร่วม StaffDashboard กับห้องผู้บริหาร (/executive)
// เพื่อเมนูซ้าย/แถบล่างสองหน้าตรงกันเสมอ · สิทธิ์ตัดสินที่ staffMenuAccess() (scopedKeys) ไม่ใช่ที่นี่
//
// ชื่อเมนู "แผนพัฒนาท้องถิ่น" อ่านช่วงปีจากแผนที่เมนูแสดง (query เบาๆ เฉพาะ year_from/year_to) — โหลดไม่ได้/ยังไม่มีแผน = ชื่อสำรอง
// เก็บ tenantId คู่กับชื่อ: สลับ อปท. (superadmin) แล้วชื่อของ อปท. เก่าต้องไม่ค้างโชว์
export default function useStaffNavGroups({ scopedKeys, hasLocalPlanAccess, tenantId }) {
  const [planLabel, setPlanLabel] = useState({ tenantId: null, label: null })
  const planLabelTenantId = hasLocalPlanAccess ? tenantId ?? null : null
  useEffect(() => {
    if (!planLabelTenantId) return undefined
    let alive = true
    fetchCurrentPlanYears(planLabelTenantId).then(({ plan }) => { if (alive) setPlanLabel({ tenantId: planLabelTenantId, label: menuLabel(plan) }) })
    return () => { alive = false }
  }, [planLabelTenantId])
  const localPlanLabel = planLabel.tenantId === planLabelTenantId && planLabel.label ? planLabel.label : menuLabel(null)
  const withPlanLabel = (m) => (m.key === 'local-plan' ? { ...m, label: localPlanLabel } : m)

  // กลุ่มข้ามกอง + กลุ่มตามกอง · กองที่ไม่มีเมนูให้ผู้ใช้คนนี้เห็นไม่ต้องขึ้นหัวข้อ
  const visibleGroups = useMemo(() => MODULE_GROUPS
    .map((g) => ({ ...g, collapsible: true, items: g.items.filter((m) => scopedKeys.includes(m.key)).map(withPlanLabel) }))
    .filter((g) => g.items.length > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- withPlanLabel ขึ้นกับ localPlanLabel อย่างเดียว
  [scopedKeys, localPlanLabel])
  const visibleStandaloneGroups = useMemo(() => STANDALONE_GROUPS
    .map((g) => ({ ...g, collapsible: true, items: g.items.filter((m) => scopedKeys.includes(m.key)) }))
    .filter((g) => g.items.length > 0), [scopedKeys])
  const visibleHomeGroups = useMemo(() => [...visibleStandaloneGroups, ...visibleGroups], [visibleStandaloneGroups, visibleGroups])
  const visibleModules = useMemo(() => visibleHomeGroups.flatMap((group) => group.items), [visibleHomeGroups])

  return { visibleGroups, visibleHomeGroups, visibleModules, withPlanLabel }
}
