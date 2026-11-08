import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, FileText, LayoutGrid, LineChart, ListChecks, Loader2, Pencil, Plus, Printer } from 'lucide-react'
import { ListCard, Pills, TabBar } from '../../patientTransport/StaffShell'
import { addDays, bangkokIsoDate, thaiDateRange, thaiShortDate } from '../../../lib/complaintReportPeriods'
import {
  buildReportSheet, draftFromPrevious, formatPct, groupSeries, nextReportDraft, progressSeries, projectAccess,
} from '../../../lib/constructionReport'
import {
  createReport, fetchBundle, fetchDepartments, fetchLatestFinals, fetchProjects, fetchStaffChoices, friendlyError,
  projectStatusLabel, projectTypeLabel,
} from '../../../lib/constructionReportApi'
import { STAGE_LABELS } from '../../../lib/constructionLifecycle'
import { fetchLifecycleData } from '../../../lib/constructionLifecycleApi'
import { printConstructionReport } from '../../../lib/constructionReportPrint'
import LifecycleOverview from './LifecycleOverview'
import ProgressChart from './ProgressChart'
import ProjectLifecycleSheet from './ProjectLifecycleSheet'
import ProjectSheet from './ProjectSheet'
import WeeklyReportSheet from './WeeklyReportSheet'
import { ScheduleBadge } from './ui'
import { btnGhost, btnPrimary } from './uiStyles'

const TABS = [
  { id: 'overview', label: 'ภาพรวม', Icon: LayoutGrid },
  { id: 'projects', label: 'โครงการ', Icon: ClipboardList },
  { id: 'reports', label: 'รายงานสัปดาห์', Icon: FileText },
  { id: 'summary', label: 'สรุป', Icon: LineChart },
]
const CAN_CREATE = ['superadmin', 'admin', 'officer', 'staff', 'technician']
const ACTIVE_STATUSES = ['planned', 'approved', 'in_progress']
const EMPTY_LIFE = { contract: null, people: [], milestones: [], installments: [], changes: [], defects: [], events: [] }

/**
 * โครงการก่อสร้าง + รายงานผลการก่อสร้างประจำสัปดาห์ (เมนูกองช่าง ฝั่งเจ้าหน้าที่)
 * ตั้งค่าโครงการครั้งเดียว → ทุกสัปดาห์กด "เริ่มรายงานสัปดาห์ที่ N" แล้วกรอกเฉพาะผลงานจริงในสัปดาห์ กำลังคน อากาศ ปัญหา
 * ที่เหลือระบบเติมและคำนวณเอง · พิมพ์ย้อนหลังสัปดาห์ไหนก็ได้ (ฉบับที่ล็อกพิมพ์ได้เลขเดิมเสมอ)
 */
export default function ConstructionProjectsModule({ tenant, profile }) {
  const role = profile?.role
  const userId = profile?.id
  const [tab, setTab] = useState('overview')
  const [projects, setProjects] = useState([])
  const [listedBy, setListedBy] = useState({})
  const [latest, setLatest] = useState({})
  // ข้อมูลวงจรของทุกโครงการที่เห็น (จุดตรวจ งวด ประวัติ ฯลฯ) โหลดครั้งเดียวต่อรอบ — null = ยังไม่โหลด/โหลดไม่สำเร็จ (ห้ามคำนวณคำเตือนจากข้อมูลว่าง)
  const [lifecycle, setLifecycle] = useState(null)
  const [lifecycleError, setLifecycleError] = useState('')
  const [lifecycleId, setLifecycleId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [selectedId, setSelectedId] = useState(null)
  const [bundle, setBundle] = useState(null)
  const [bundleLoading, setBundleLoading] = useState(false)
  const [bundleError, setBundleError] = useState('')
  const [projectSheet, setProjectSheet] = useState(null)
  const [openReportId, setOpenReportId] = useState(null)
  const [aux, setAux] = useState({ departments: [], staff: [] })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [groupBy, setGroupBy] = useState('month')

  const departmentId = profile?.department_id ?? null
  const access = useCallback(project => projectAccess({
    role, userId, departmentId, project, listed: listedBy[project?.id] ?? {},
  }), [role, userId, departmentId, listedBy])

  // โหลดรายการใหม่ = เพิ่มตัวนับ (setState หลัง await ใน effect เท่านั้น ไม่เรียกตรงๆ ใน effect)
  const [reloadKey, setReloadKey] = useState(0)
  const loadList = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    if (!tenant?.id) return undefined
    let alive = true
    ;(async () => {
      const result = await fetchProjects(tenant.id, userId)
      if (!alive) return
      if (result.error) {
        setLoadError(friendlyError(result.error))
        setLoading(false)
        return
      }
      setLoadError('')
      setProjects(result.projects)
      setListedBy(result.listedBy)
      setLoading(false)
      const visible = result.projects.filter(p => projectAccess({
        role, userId, departmentId, project: p, listed: result.listedBy[p.id] ?? {},
      }).read)
      const ids = visible.map(p => p.id)
      const [finals, life] = await Promise.all([fetchLatestFinals(ids), fetchLifecycleData(ids)])
      if (!alive) return
      if (!finals.error) setLatest(finals.latest)
      if (life.error) {
        setLifecycle(null)
        setLifecycleError(life.message)
      } else {
        setLifecycleError('')
        setLifecycle(life.byProject)
      }
    })()
    return () => { alive = false }
  }, [tenant?.id, userId, role, departmentId, reloadKey])
  // รายชื่อกอง: ใช้แสดงหัวใบพิมพ์ + ให้แอดมินเลือกกองของโครงการ (โหลดครั้งเดียวตอนเปิดโมดูล)
  useEffect(() => {
    if (!tenant?.id) return
    fetchDepartments(tenant.id).then(({ departments }) => setAux(a => ({ ...a, departments })))
  }, [tenant?.id])

  const loadBundle = useCallback(async projectId => {
    if (!projectId) { setBundle(null); return }
    setBundleLoading(true)
    const result = await fetchBundle(projectId)
    setBundleLoading(false)
    if (result.error) { setBundleError(friendlyError(result.error)); return }
    setBundleError('')
    setBundle({ ...result, projectId })
  }, [])

  // เลือกโครงการ = โหลดข้อมูลของโครงการนั้นทันที (ไม่ใช้ effect เพื่อไม่ให้โหลดซ้ำตอนเปิดแผ่นตั้งค่า)
  const selectProject = useCallback(async projectId => {
    setSelectedId(projectId)
    setOpenReportId(null)
    setBundle(null)
    await loadBundle(projectId)
  }, [loadBundle])

  const visibleProjects = useMemo(() => projects.filter(p => access(p).read), [projects, access])
  // 1 โครงการ = 1 bundle ที่ตรรกะวงจร (constructionLifecycle.js) ใช้ทุกฟังก์ชัน · useMemo เพื่อไม่คำนวณคำเตือนซ้ำทุกครั้งที่พิมพ์ค้นหา
  const rows = useMemo(() => visibleProjects.map(p => ({ project: p, bundle: { project: p, ...EMPTY_LIFE, ...(lifecycle?.[p.id] ?? {}) } })), [visibleProjects, lifecycle])
  const lifeRow = lifecycleId ? rows.find(r => r.project.id === lifecycleId) ?? null : null
  const openLifecycle = async projectId => {
    setActionError('')
    if (!lifecycle) return setActionError(lifecycleError || 'ข้อมูลวงจรโครงการยังโหลดไม่เสร็จ — รอสักครู่แล้วลองใหม่')
    setLifecycleId(projectId)
    if (!aux.staff.length) {
      const staff = await fetchStaffChoices(tenant.id)
      setAux(a => ({ ...a, staff: staff.staff }))
    }
  }
  const selected = visibleProjects.find(p => p.id === selectedId) ?? null
  const selectedAccess = selected ? access(selected) : null
  const extendedUntil = bundle?.contract?.extended_until ?? null
  const contractForCalc = useMemo(() => (selected ? {
    start_date: selected.start_date, end_date: selected.end_date, extended_until: extendedUntil,
  } : {}), [selected, extendedUntil])

  const q = search.trim().toLowerCase()
  const shown = visibleProjects.filter(p => {
    if (filter === 'active' && !ACTIVE_STATUSES.includes(p.status)) return false
    if (filter === 'done' && p.status !== 'completed') return false
    if (!q) return true
    return [p.title, p.contractor_name, p.contract_no, p.project_no].some(v => String(v ?? '').toLowerCase().includes(q))
  })
  const counts = {
    active: visibleProjects.filter(p => ACTIVE_STATUSES.includes(p.status)).length,
    done: visibleProjects.filter(p => p.status === 'completed').length,
    all: visibleProjects.length,
  }

  const openProjectSheet = async (mode, project) => {
    setActionError('')
    // แก้โครงการต้องมีข้อมูลสัญญา/รายการงาน/บุคคลครบก่อนเปิดแผ่น ไม่งั้นฟอร์มขึ้นว่างแล้วบันทึกทับของจริง
    const [staff] = await Promise.all([fetchStaffChoices(tenant.id), mode === 'edit' ? selectProject(project.id) : Promise.resolve()])
    setAux(a => ({ ...a, staff: staff.staff }))
    setProjectSheet({ mode, projectId: project?.id ?? null })
  }

  const sheetFor = report => (report.status === 'final' && report.frozen?.version === 1
    ? report.frozen
    : buildReportSheet({ items: bundle.items, reports: bundle.reports, report, contract: contractForCalc }))

  const startNextWeek = async () => {
    setBusy(true); setActionError('')
    const next = nextReportDraft({ reports: bundle.reports, contract: contractForCalc })
    const previous = [...bundle.reports].sort((a, b) => a.week_no - b.week_no).pop()
    const start = next.period_start ?? bangkokIsoDate()
    const period = { period_start: start, period_end: next.period_end ?? addDays(start, 6) }
    const { report, error } = await createReport(selected.id, next.week_no, { ...period, ...draftFromPrevious(previous, period) })
    setBusy(false)
    if (error) return setActionError(friendlyError(error))
    setBundle(b => ({ ...b, reports: [...b.reports, report] }))
    setOpenReportId(report.id)
  }

  const print = report => printConstructionReport({
    tenant, project: selected, bundle, report, sheet: sheetFor(report),
    departmentName: aux.departments.find(d => d.id === selected.department_id)?.name ?? '',
  })

  const sortedReports = bundle ? [...bundle.reports].sort((a, b) => a.week_no - b.week_no) : []
  const lastReport = sortedReports[sortedReports.length - 1]
  const canStartNext = selectedAccess?.write && (!lastReport || lastReport.status === 'final')
  const openReport = bundle?.reports.find(r => r.id === openReportId) ?? null
  const series = bundle ? progressSeries({ items: bundle.items, reports: bundle.reports, contract: contractForCalc }) : []

  const picker = (
    <label className="block max-w-xl">
      <span className="mb-1 block text-xs font-semibold text-gray-500">โครงการ</span>
      <select className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm" value={selectedId ?? ''} onChange={e => selectProject(e.target.value || null)}>
        <option value="">— เลือกโครงการ —</option>
        {visibleProjects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
    </label>
  )

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />กำลังโหลดโครงการ…</div>

  return (
    <div className="space-y-4">
      <TabBar tab={tab} setTab={setTab} tabs={TABS} busy={busy} />
      {loadError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
      {actionError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
      {lifecycleError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">โหลดข้อมูลวงจรโครงการไม่สำเร็จ — {lifecycleError} (คำเตือนในแท็บภาพรวมจึงยังไม่แสดง)</p>}

      {tab === 'overview' && (
        <LifecycleOverview rows={rows} latest={latest} canCreate={CAN_CREATE.includes(role)} onCreate={() => openProjectSheet('create', null)}
          onOpen={openLifecycle} alertsReady={Boolean(lifecycle)} loadError={loadError} />
      )}

      {tab === 'projects' && (
        <ListCard title="โครงการก่อสร้าง" count={shown.length} search={search} onSearch={setSearch} searchLabel="ค้นหาชื่อโครงการ ผู้รับจ้าง เลขสัญญา"
          action={CAN_CREATE.includes(role) && <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={() => openProjectSheet('create', null)}><Plus size={16} />เพิ่มโครงการ</button>}
          pills={<Pills label="กรองสถานะโครงการ" value={filter} onChange={setFilter} items={[
            { id: 'active', label: 'กำลังดำเนินการ', count: counts.active, color: '#0369a1' },
            { id: 'done', label: 'แล้วเสร็จ', count: counts.done, color: '#15803d' },
            { id: 'all', label: 'ทั้งหมด', count: counts.all },
          ]} />}>
          {shown.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-gray-500">
              {loadError ? 'ยังแสดงรายการโครงการไม่ได้ (ดูข้อความสีแดงด้านบน)' : visibleProjects.length ? 'ไม่พบโครงการตามเงื่อนไข' : 'ยังไม่มีโครงการ — กด "เพิ่มโครงการ" เพื่อเริ่ม'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {shown.map(p => {
                const final = latest[p.id]
                const overall = final?.overall
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="font-semibold text-gray-900">{p.title}</p>
                      <p className="text-xs text-gray-500">
                        {projectTypeLabel(p.project_type)} · ปีงบ {p.fiscal_year} · {STAGE_LABELS[p.stage] ?? projectStatusLabel(p.status)}
                        {p.contractor_name ? ` · ${p.contractor_name}` : ''}
                      </p>
                      {overall
                        ? <p className="mt-1 text-xs text-gray-700">สัปดาห์ที่ {final.week_no} (ถึง {thaiShortDate(final.period_end)}): จริง <b>{formatPct(overall.actual)}</b> · แผน {formatPct(overall.plan)} <ScheduleBadge label={overall.label} /></p>
                        : <p className="mt-1 text-xs text-gray-400">ยังไม่มีรายงานที่ล็อก</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnGhost} onClick={() => openLifecycle(p.id)} aria-label={`วงจรโครงการ ${p.title}`}><ListChecks size={15} />วงจรโครงการ</button>
                      <button type="button" className={btnGhost} onClick={() => { selectProject(p.id); setTab('reports') }}><FileText size={15} />รายงานสัปดาห์</button>
                      {/* คนที่อ่านได้อย่างเดียว (เจ้าหน้าที่กองเดียวกันที่ไม่ใช่ผู้สร้าง/ผู้ควบคุมงาน) ไม่เห็นปุ่มนี้ — ฐานข้อมูลปฏิเสธการบันทึกอยู่แล้ว ปุ่มที่กดแล้วล้มคือภาระเปล่า (เจอกับ TEST-staff บนสนามซ้อม 2569-11-07) */}
                      {access(p).write && <button type="button" className={btnGhost} onClick={() => openProjectSheet('edit', p)} aria-label={`ตั้งค่า ${p.title}`}><Pencil size={15} />ตั้งค่า</button>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </ListCard>
      )}

      {tab !== 'projects' && tab !== 'overview' && (
        <div className="space-y-4">
          {picker}
          {!selected && <p className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">เลือกโครงการด้านบนเพื่อดู{tab === 'reports' ? 'รายงานรายสัปดาห์' : 'สรุปความก้าวหน้า'}</p>}
          {selected && bundleLoading && !bundle && <div className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="animate-spin" size={16} />กำลังโหลด…</div>}
          {selected && bundleError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{bundleError}</p>}
        </div>
      )}

      {tab === 'reports' && selected && bundle && (
        <ListCard title={`รายงานสัปดาห์ · ${selected.title}`} count={sortedReports.length}
          action={canStartNext && <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy}
            onClick={() => (bundle.items.length ? startNextWeek() : setActionError('ตั้งรายการงานและสัดส่วนของโครงการก่อน (ปุ่ม "ตั้งค่า" ในแท็บโครงการ)'))}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}เริ่มรายงานสัปดาห์ที่ {(lastReport?.week_no ?? 0) + 1}
          </button>}>
          {sortedReports.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-gray-500">{bundle.items.length ? 'ยังไม่มีรายงาน — กด "เริ่มรายงานสัปดาห์ที่ 1"' : 'ยังไม่ได้ตั้งรายการงานของโครงการ — ไปที่แท็บโครงการ กด "ตั้งค่า"'}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {[...sortedReports].reverse().map(r => {
                const sheet = sheetFor(r)
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="font-semibold text-gray-900">สัปดาห์ที่ {r.week_no} <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${r.status === 'final' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{r.status === 'final' ? 'ล็อกแล้ว' : 'ฉบับร่าง'}</span></p>
                      <p className="text-xs text-gray-500">{thaiDateRange(r.period_start, r.period_end)}</p>
                      <p className="mt-0.5 text-xs text-gray-700">จริง <b>{formatPct(sheet.overall.actual)}</b> · แผน {formatPct(sheet.overall.plan)} <ScheduleBadge label={sheet.overall.label} /></p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className={btnGhost} onClick={() => setOpenReportId(r.id)}>{r.status === 'final' || !selectedAccess.write ? 'เปิดดู' : 'แก้ไข'}</button>
                      <button type="button" className={btnGhost} onClick={() => print(r)}><Printer size={15} />พิมพ์</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {lastReport && lastReport.status !== 'final' && selectedAccess.write && (
            <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">ล็อกสัปดาห์ที่ {lastReport.week_no} ก่อน จึงเริ่มสัปดาห์ถัดไปได้ (ยอดสะสมต่อกันเป็นลูกโซ่)</p>
          )}
        </ListCard>
      )}

      {tab === 'summary' && selected && bundle && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4"><ProgressChart series={series} /></div>
          {series.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
                <p className="text-sm font-bold text-gray-800">สรุปรายสัปดาห์</p>
                <div className="flex gap-1.5" role="group" aria-label="จัดกลุ่ม">
                  {[['month', 'รายเดือน'], ['fiscal', 'ปีงบประมาณ'], ['week', 'รายสัปดาห์']].map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={groupBy === id} onClick={() => setGroupBy(id)}
                      className={`min-h-9 rounded-xl border px-3 text-xs font-semibold ${groupBy === id ? 'border-transparent text-white' : 'border-gray-200 text-gray-600'}`}
                      style={groupBy === id ? { backgroundColor: 'var(--color-primary)' } : {}}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-xs">
                  <thead><tr className="bg-gray-50 text-gray-500">
                    <th className="px-3 py-2 text-left font-semibold">{groupBy === 'week' ? 'สัปดาห์' : groupBy === 'month' ? 'เดือน' : 'ปีงบประมาณ'}</th>
                    <th className="px-3 py-2 font-semibold">ช่วงวันที่</th><th className="px-3 py-2 font-semibold">ทำได้ในช่วง</th>
                    <th className="px-3 py-2 font-semibold">จริงสะสม</th><th className="px-3 py-2 font-semibold">แผนสะสม</th>
                  </tr></thead>
                  <tbody>
                    {(groupBy === 'week'
                      ? series.map(p => ({ key: `สัปดาห์ที่ ${p.week_no}${p.status === 'final' ? '' : ' (ร่าง)'}`, from: p.period_start, to: p.period_end, gained: p.week, endActual: p.actual, endPlan: p.plan }))
                      : groupSeries(series, groupBy).map(g => ({ ...g, key: groupBy === 'fiscal' ? `ปีงบ ${g.key}` : g.key }))
                    ).map(row => (
                      <tr key={row.key} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 font-medium">{row.key}</td>
                        <td className="px-3 text-center">{thaiDateRange(row.from, row.to)}</td>
                        <td className="px-3 text-center">{formatPct(row.gained)}</td>
                        <td className="px-3 text-center font-bold">{formatPct(row.endActual)}</td>
                        <td className="px-3 text-center">{formatPct(row.endPlan)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">"ทำได้ในช่วง" = ผลงานถ่วงน้ำหนักที่เพิ่มขึ้นในช่วงนั้น · แผน = แผนที่ตั้งในระบบ (เชิงเส้น) ไม่ใช่แผนตามสัญญา · ฉบับร่างยังไม่นับเป็นตัวเลขทางการ</p>
            </div>
          )}
        </div>
      )}

      {lifeRow && lifecycle && (
        <ProjectLifecycleSheet
          key={lifeRow.project.id}
          bundle={lifeRow.bundle} access={access(lifeRow.project)} latest={latest[lifeRow.project.id] ?? null} staffChoices={aux.staff}
          onClose={() => setLifecycleId(null)} onChanged={loadList}
          onOpenSettings={() => { const project = lifeRow.project; setLifecycleId(null); openProjectSheet('edit', project) }}
        />
      )}

      {projectSheet && (
        <ProjectSheet
          key={projectSheet.projectId ?? 'new'}
          tenant={tenant} profile={profile} mode={projectSheet.mode}
          project={projectSheet.projectId ? projects.find(p => p.id === projectSheet.projectId) : null}
          bundle={projectSheet.projectId && bundle?.projectId === projectSheet.projectId ? bundle : null}
          access={projectSheet.projectId ? access(projects.find(p => p.id === projectSheet.projectId)) : { editBase: true, write: true, manage: true }}
          departments={aux.departments} staffChoices={aux.staff}
          onClose={() => setProjectSheet(null)}
          onSaved={async (projectId, options) => {
            loadList()
            await selectProject(projectId)
            if (options?.keepOpen) setProjectSheet({ mode: 'edit', projectId })
            else setProjectSheet(null)
          }}
        />
      )}

      {openReport && selected && bundle && (
        <WeeklyReportSheet
          key={openReport.id}
          tenant={tenant} project={selected} bundle={bundle} report={openReport} access={selectedAccess}
          isLatest={lastReport?.id === openReport.id}
          isAdmin={role === 'admin' || role === 'superadmin'}
          onClose={() => { setOpenReportId(null); loadList() }}
          onChanged={updated => setBundle(b => ({ ...b, reports: b.reports.map(r => (r.id === updated.id ? updated : r)) }))}
          onDeleted={deleted => { setBundle(b => ({ ...b, reports: b.reports.filter(r => r.id !== deleted.id) })); setOpenReportId(null); loadList() }}
        />
      )}
    </div>
  )
}
