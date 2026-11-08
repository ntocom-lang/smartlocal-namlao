import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarRange, ClipboardList, Info, ListChecks, Loader2, Pencil, Plus } from 'lucide-react'
import { bangkokIsoDate, thaiShortDate } from '../../../lib/complaintReportPeriods'
import { fetchDepartments, fetchDevPlans, fetchIsManager, fetchPlanData, friendlyError } from '../../../lib/localPlanApi'
import { buildAttention, menuLabel } from '../../../lib/localPlanView'
import { useTenant } from '../../../contexts/TenantContext'
import { TabBar } from '../../patientTransport/StaffShell'
import { btnGhost, btnPrimary } from '../construction/uiStyles'
import DevPlanSheet from './DevPlanSheet'
import DevProjectSheet from './DevProjectSheet'
import OpPlanTab from './OpPlanTab'
import ProgressTab from './ProgressTab'
import ProjectRegistryTab from './ProjectRegistryTab'

const TABS = [
  { id: 'registry', label: 'ทะเบียนโครงการ', Icon: ClipboardList },
  { id: 'op', label: 'แผนดำเนินงาน', Icon: CalendarRange },
  { id: 'progress', label: 'ติดตามผล', Icon: ListChecks },
]

const TONES = {
  danger: { box: 'bg-red-50 text-red-800', Icon: AlertTriangle },
  warn: { box: 'bg-amber-50 text-amber-900', Icon: AlertTriangle },
  info: { box: 'bg-gray-50 text-gray-700', Icon: Info },
}

/** แผนที่เมนูแสดง: is_current → ไม่มีก็ฉบับล่าสุด (ปีเริ่มมากสุด) — plans เรียงปีเริ่มมาก→น้อยจาก fetchDevPlans แล้ว */
const defaultPlanOf = plans => plans.find(p => p.is_current) ?? plans[0] ?? null

/**
 * เมนู "แผนพัฒนาท้องถิ่น" (ฝั่งเจ้าหน้าที่): ทะเบียนโครงการ + แผนการดำเนินงานรายปี + ติดตามผล
 * อ่านได้ตามบทบาท (officer/staff/technician/viewer ของ อปท.) · แก้ได้เฉพาะผู้จัดการแผน (admin/superadmin/plan_admin) และกองผู้รับผิดชอบ (เดือน+หมายเหตุ)
 * ตัวบังคับสิทธิ์จริงคือ RLS + trigger — ปุ่มที่ซ่อนเป็นแค่ความสะดวก
 */
export default function LocalPlanModule({ tenant, profile }) {
  const { holidaysVersion } = useTenant()
  const tenantId = tenant?.id
  const userId = profile?.id
  const [tab, setTab] = useState('registry')
  const [base, setBase] = useState(null) // { tenantId, isManager, plans, departments } — โหลดครั้งเดียวต่อรอบ
  const [baseError, setBaseError] = useState('')
  const [planId, setPlanId] = useState(null)
  const [planData, setPlanData] = useState(null) // { planId, projects, years, opPlans, items }
  const [dataError, setDataError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [planSheet, setPlanSheet] = useState(null) // { focus } | { create: true }
  const [projectSheet, setProjectSheet] = useState(null) // { projectId | null }
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    if (!tenantId || !userId) return undefined
    let alive = true
    ;(async () => {
      const [manager, plans, departments] = await Promise.all([fetchIsManager(tenantId), fetchDevPlans(tenantId), fetchDepartments(tenantId)])
      if (!alive) return
      if (plans.error) { setBaseError(friendlyError(plans.error)); setBase({ tenantId, isManager: false, plans: [], departments: departments.departments }); return }
      setBaseError('')
      setBase({ tenantId, isManager: manager.isManager, plans: plans.plans, departments: departments.departments })
    })()
    return () => { alive = false }
  }, [tenantId, userId, reloadKey])

  const ready = base?.tenantId === tenantId
  const plans = useMemo(() => (ready ? base.plans : []), [ready, base])
  const departments = useMemo(() => (ready ? base.departments : []), [ready, base])
  const isManager = ready && base.isManager
  const plan = plans.find(p => p.id === planId) ?? defaultPlanOf(plans)
  const activePlanId = plan?.id ?? null

  useEffect(() => {
    if (!tenantId || !activePlanId) return undefined
    let alive = true
    ;(async () => {
      const result = await fetchPlanData(tenantId, activePlanId)
      if (!alive) return
      if (result.error) { setDataError(friendlyError(result.error)); return }
      setDataError('')
      setPlanData({ planId: activePlanId, ...result })
    })()
    return () => { alive = false }
  }, [tenantId, activePlanId, reloadKey])

  const data = planData?.planId === activePlanId ? planData : null
  const today = bangkokIsoDate()

  // คำเตือนไม่บล็อก — holidaysVersion เป็น dependency โดยตั้งใจ: วันหยุดโหลดจากฐานข้อมูลทีหลังหน้าจอ
  // ถ้าไม่คำนวณใหม่ แถบเตือนกำหนด 30 วันจะไม่รู้ว่าวันครบกำหนดตรงวันหยุด (แพตเทิร์นเดียวกับ WasteScheduleManager)
  const attention = useMemo(() => {
    void holidaysVersion
    if (!plan || !data) return []
    return buildAttention({ devPlan: plan, opPlans: data.opPlans, items: data.items, projects: data.projects, today })
  }, [plan, data, today, holidaysVersion])

  // โครงการที่ถูกรายการในแผนดำเนินงานที่ประกาศแล้วอ้างอยู่ (ล็อกชื่อ/รหัส/ยุทธศาสตร์/สถานะ/วงเงิน)
  const lockedIds = useMemo(() => {
    const published = new Set((data?.opPlans ?? []).filter(p => p.status === 'published').map(p => p.id))
    return new Set((data?.items ?? []).filter(i => i.dev_project_id && published.has(i.op_plan_id)).map(i => i.dev_project_id))
  }, [data])

  if (!ready && !baseError) {
    return <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />กำลังโหลดแผน…</div>
  }

  const planSheetNode = planSheet && (
    <DevPlanSheet
      key={planSheet.create ? 'new' : `${plan?.id}-${planSheet.focus}`}
      tenant={tenant} plan={planSheet.create ? null : plan} plans={plans} isManager={isManager} focus={planSheet.focus}
      onClose={() => setPlanSheet(null)}
      onSaved={(savedId, options) => {
        reload()
        setPlanId(savedId)
        if (!options?.keepOpen) setPlanSheet(null)
      }}
    />
  )

  if (!plan) {
    return (
      <div className="space-y-4">
        {baseError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{baseError}</p>}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center text-gray-800">
          <p className="font-semibold">{menuLabel(null)}</p>
          {isManager ? (
            <>
              <p className="mt-1 text-sm text-gray-600">ยังไม่มีแผน — ตั้งแผนฉบับแรกเพื่อเริ่มลงทะเบียนโครงการและทำแผนการดำเนินงาน</p>
              <button type="button" className={`${btnPrimary} mt-4`} style={{ backgroundColor: 'var(--color-primary)' }} onClick={() => setPlanSheet({ create: true })}><Plus size={16} />ตั้งแผนฉบับแรก</button>
            </>
          ) : <p className="mt-1 text-sm text-gray-600">ยังไม่มีแผน — นักวิเคราะห์นโยบายและแผนเป็นผู้ตั้ง</p>}
        </div>
        {planSheetNode}
      </div>
    )
  }

  const published = plan.status === 'published'
  const openProject = projectSheet && data ? (data.projects.find(p => p.id === projectSheet.projectId) ?? null) : null

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-base font-bold text-gray-900">{menuLabel(plan)}</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${published ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {published ? `ประกาศใช้แล้ว ${plan.published_on ? thaiShortDate(plan.published_on) : ''}${plan.announce_ref_no ? ` · เลขที่ ${plan.announce_ref_no}` : ''}` : 'ร่าง'}
          </span>
          {!plan.is_current && <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-gray-600">ไม่ใช่ฉบับที่เมนูแสดง</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plans.length > 1 && (
            <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-gray-500">แผนฉบับ
              <select className="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-2 text-sm font-semibold text-gray-800" value={plan.id} onChange={e => setPlanId(e.target.value)}>
                {plans.map(p => <option key={p.id} value={p.id}>{p.year_from}–{p.year_to}{p.is_current ? ' (เมนูแสดง)' : ''}{p.status === 'draft' ? ' · ร่าง' : ''}</option>)}
              </select>
            </label>
          )}
          {isManager && (
            <>
              <button type="button" className={btnGhost} onClick={() => setPlanSheet({ focus: 'edit' })}><Pencil size={15} />แก้ข้อมูลแผน</button>
              <button type="button" className={btnGhost} onClick={() => setPlanSheet({ focus: published ? 'unpublish' : 'publish' })}>{published ? 'ยกเลิกประกาศ' : 'ประกาศใช้'}</button>
              <button type="button" className={btnGhost} onClick={() => setPlanSheet({ create: true })}><Plus size={15} />ตั้งแผนฉบับใหม่</button>
            </>
          )}
        </div>
      </section>

      {baseError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{baseError}</p>}
      {dataError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">โหลดข้อมูลแผนไม่สำเร็จ — {dataError}</p>}

      {attention.length > 0 && (
        <section aria-label="ต้องดูแล" className="space-y-1.5 rounded-2xl border border-gray-200 bg-white p-3">
          <p className="px-1 text-xs font-bold text-gray-500">ต้องดูแล (เตือนเท่านั้น ไม่บล็อกการทำงาน)</p>
          <ul className="space-y-1.5">
            {attention.map((a, i) => {
              const tone = TONES[a.level]
              return (
                <li key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${tone.box}`}>
                  <tone.Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{a.text}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <TabBar tab={tab} setTab={setTab} tabs={TABS} />

      {!data && !dataError && <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />กำลังโหลดข้อมูลแผน…</div>}

      {data && tab === 'registry' && (
        <ProjectRegistryTab projects={data.projects} years={data.years} departments={departments} lockedIds={lockedIds}
          onOpen={project => setProjectSheet({ projectId: project.id })} onAdd={isManager ? () => setProjectSheet({ projectId: null }) : null} />
      )}

      {data && tab === 'op' && (
        <OpPlanTab key={plan.id} tenant={tenant} profile={profile} plan={plan} isManager={isManager} departments={departments}
          projects={data.projects} years={data.years} opPlans={data.opPlans} lightItems={data.items} holidaysVersion={holidaysVersion} onChanged={reload} />
      )}

      {data && tab === 'progress' && (
        <ProgressTab key={plan.id} tenant={tenant} profile={profile} isManager={isManager} departments={departments}
          projects={data.projects} opPlans={data.opPlans} />
      )}

      {planSheetNode}

      {data && projectSheet && (projectSheet.projectId === null || openProject) && (
        <DevProjectSheet
          key={projectSheet.projectId ?? 'new'}
          tenant={tenant} plan={plan} project={openProject} years={openProject ? data.years.filter(y => y.project_id === openProject.id) : []}
          departments={departments} isManager={isManager} locked={openProject ? lockedIds.has(openProject.id) : false}
          onClose={() => setProjectSheet(null)}
          onSaved={({ keepOpen, projectId }) => { reload(); setProjectSheet(keepOpen ? { projectId } : null) }}
          onDeleted={() => { reload(); setProjectSheet(null) }}
        />
      )}
    </div>
  )
}
