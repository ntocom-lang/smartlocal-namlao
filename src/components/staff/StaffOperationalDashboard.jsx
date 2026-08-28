import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronRight, Clock3, FileText,
  Inbox, Loader2, Plus, RefreshCw, TrendingUp,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { addWorkingDays, workingDaysSince } from '../../lib/workingDays'

const ROLE_LABELS = {
  superadmin: 'Super Admin', admin: 'แอดมินระบบ', officer: 'หัวหน้ากอง',
  technician: 'ผู้ปฏิบัติงาน', staff: 'เจ้าหน้าที่', viewer: 'ผู้บริหาร', council: 'สภาเทศบาล',
}

const EMPTY_DATA = {
  pendingDocs: [], pendingComplaints: [],
  pendingDocCount: 0, pendingComplaintCount: 0, inProgressCount: 0, overdueCount: 0,
}

const skippedQuery = () => Promise.resolve({ data: [], count: 0, error: null })

function formatThaiDate(value, options = {}) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('th-TH', options)
}

// อายุงานนับเป็นวันทำการ (ตัดเสาร์-อาทิตย์และวันหยุดนักขัตฤกษ์) — ดู src/lib/workingDays.js
function ageInDays(value) {
  if (!value) return 0
  return workingDaysSince(value)
}

export default function StaffOperationalDashboard({
  visibleGroups, setActiveModule, tenant, profile, pendingCount,
  newComplaintCount, navigate, docTypes, complaintLabels, onCreateManagementEvent,
}) {
  const [data, setData] = useState(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const moduleKeySignature = visibleGroups.flatMap(group => group.items.map(item => item.key)).sort().join('|')
  const moduleKeys = useMemo(() => new Set(moduleKeySignature.split('|').filter(Boolean)), [moduleKeySignature])
  const showOverview = ['superadmin', 'admin', 'officer', 'viewer'].includes(profile?.role)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    const municipalityId = tenant.id
    const canDocs = showOverview && moduleKeys.has('inbox')
    const canComplaints = showOverview && moduleKeys.has('complaints')
    // เส้นแบ่ง "ค้างเกิน 7 วันทำการ" — ถอยหลัง 7 วันทำการแล้วยึดเที่ยงคืนตามเวลาเครื่อง
    // (ห้ามส่งเป็น 'YYYY-MM-DD' ดิบให้ PostgREST เพราะฝั่งเซิร์ฟเวอร์ตีความเป็น UTC จะเพี้ยน 7 ชม.)
    const [cy, cm, cd] = addWorkingDays(new Date(), -7).split('-').map(Number)
    const overdueBefore = new Date(cy, cm - 1, cd).toISOString()

    const queries = [
      canDocs
        ? supabase.from('document_requests')
          .select('id, document_type, status, created_at', { count: 'exact' })
          .eq('municipality_id', municipalityId).eq('status', 'pending')
          .order('created_at', { ascending: true }).limit(3)
        : skippedQuery(),
      canDocs
        ? supabase.from('document_requests').select('id', { count: 'exact', head: true })
          .eq('municipality_id', municipalityId).eq('status', 'processing')
        : skippedQuery(),
      canComplaints
        ? supabase.from('complaints')
          .select('id, category, status, created_at', { count: 'exact' })
          .eq('municipality_id', municipalityId).eq('status', 'pending')
          .order('created_at', { ascending: true }).limit(3)
        : skippedQuery(),
      canComplaints
        ? supabase.from('complaints').select('id', { count: 'exact', head: true })
          .eq('municipality_id', municipalityId).in('status', ['received', 'in_progress'])
        : skippedQuery(),
      canDocs
        ? supabase.from('document_requests').select('id', { count: 'exact', head: true })
          .eq('municipality_id', municipalityId).in('status', ['pending', 'processing'])
          .lt('created_at', overdueBefore)
        : skippedQuery(),
      canComplaints
        ? supabase.from('complaints').select('id', { count: 'exact', head: true })
          .eq('municipality_id', municipalityId).in('status', ['pending', 'received', 'in_progress'])
          .lt('created_at', overdueBefore)
        : skippedQuery(),
    ]

    Promise.all(queries).then(([docs, docProgress, complaints, complaintProgress, overdueDocs, overdueComplaints]) => {
      if (cancelled) return
      const errors = [docs, docProgress, complaints, complaintProgress, overdueDocs, overdueComplaints]
        .filter(result => result.error)
      setData({
        pendingDocs: docs.data ?? [],
        pendingComplaints: complaints.data ?? [],
        pendingDocCount: docs.count ?? 0,
        pendingComplaintCount: complaints.count ?? 0,
        inProgressCount: (docProgress.count ?? 0) + (complaintProgress.count ?? 0),
        overdueCount: (overdueDocs.count ?? 0) + (overdueComplaints.count ?? 0),
      })
      setLoadError(errors.length ? 'ข้อมูลบางส่วนโหลดไม่สำเร็จ กรุณาลองใหม่' : '')
      setLoading(false)
    }).catch((err) => {
      // Promise.all reject ได้เมื่อ query ตัวใดตัวหนึ่งชน timeout 25 วิ — ถ้าไม่ดัก
      // setLoading(false) ใน .then ไม่ได้รัน แล้วแดชบอร์ดค้างสปินเนอร์ไม่มีทางออก
      if (cancelled) return
      console.error('[staff-dashboard] โหลดสรุปงานไม่สำเร็จ:', err?.message ?? err)
      setLoadError('โหลดข้อมูลไม่สำเร็จ — เซิร์ฟเวอร์ตอบช้าหรือสัญญาณขาดช่วง กรุณาลองใหม่')
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [moduleKeys, refreshKey, tenant?.id, pendingCount, newComplaintCount, showOverview])

  const docLabelMap = useMemo(
    () => Object.fromEntries((docTypes ?? []).map(item => [item.value, item.label.replace(/^\S+\s/, '')])),
    [docTypes],
  )

  const workQueue = useMemo(() => [
    ...data.pendingDocs.map(item => ({
      ...item, kind: 'เอกสาร', module: 'inbox',
      title: docLabelMap[item.document_type] ?? item.document_type ?? 'คำขอเอกสาร',
      color: '#7c3aed', bg: '#f3e8ff',
    })),
    ...data.pendingComplaints.map(item => ({
      ...item, kind: 'คำร้อง', module: 'complaints',
      title: complaintLabels?.[item.category] ?? item.category ?? 'คำร้องประชาชน',
      color: '#dc2626', bg: '#fee2e2',
    })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 3), [complaintLabels, data.pendingComplaints, data.pendingDocs, docLabelMap])

  const kpis = [
    { label: 'คำขอเอกสารรอรับ', value: data.pendingDocCount, Icon: FileText, color: '#7c3aed', bg: '#f3e8ff', module: 'inbox' },
    { label: 'คำร้องใหม่', value: data.pendingComplaintCount, Icon: Inbox, color: '#dc2626', bg: '#fee2e2', module: 'complaints' },
    { label: 'กำลังดำเนินการ', value: data.inProgressCount, Icon: TrendingUp, color: '#0284c7', bg: '#e0f2fe' },
    { label: 'ค้างเกิน 7 วันทำการ', value: data.overdueCount, Icon: AlertTriangle, color: '#d97706', bg: '#fef3c7' },
  ]

  const todayTH = new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  function refreshDashboard() {
    setLoading(true)
    setRefreshKey(key => key + 1)
  }

  const taskCopy = {
    events: { label: 'เพิ่มกิจกรรมในปฏิทิน', description: 'ส่งกำหนดการให้ผู้บริหารทราบ' },
    report: { label: 'รายงานการทำงาน', description: 'ดูและจัดทำรายงานสรุป' },
    map: { label: 'แผนที่ระบบ GIS', description: 'ดูข้อมูลและตำแหน่งงานบนแผนที่' },
    'data-center': { label: 'ศูนย์รวมข้อมูลดิจิทัล', description: 'ดูภาพรวมและสถิติข้อมูลของหน่วยงาน' },
  }
  const visibleItems = visibleGroups.flatMap(group => group.items)
  const taskActions = ['events', 'report', 'data-center']
    .map(key => visibleItems.find(item => item.key === key))
    .filter(Boolean)

  function openTask(item) {
    if (item.key === 'events' && onCreateManagementEvent) onCreateManagementEvent()
    else if (item.navTo) navigate(item.navTo)
    else if (item.externalUrl) navigate(item.externalUrl)
    else setActiveModule(item.key)
  }

  return (
    <div className="space-y-2">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-black text-slate-900">แดชบอร์ดสำหรับเจ้าหน้าที่</h1>
            {profile?.role && <span className="hidden text-[10px] font-bold text-slate-400 sm:inline">{ROLE_LABELS[profile.role] ?? profile.role}</span>}
          </div>
          <p className="truncate text-[11px] text-slate-400">{todayTH}</p>
        </div>
        <button type="button" onClick={refreshDashboard} disabled={loading} aria-label="รีเฟรชข้อมูล"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      {loadError && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">{loadError}</div>}

      <section>
        <div className="mb-1.5 md:mb-2">
          <h2 className="text-sm font-bold text-slate-800">เมนูใช้งานด่วน</h2>
          <p className="text-[10px] text-slate-400">เข้าถึงปฏิทิน รายงาน และแผนที่ได้รวดเร็ว</p>
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          {taskActions.map(item => {
            const { key, Icon, color, bg } = item
            const copy = taskCopy[key]
            const isManagementEvent = key === 'events'
            const itemLabel = copy?.label || item?.label || 'เมนูใช้งาน'
            const itemDesc = copy?.description || item?.description || ''
            return (
              <button key={key} type="button"
                onClick={() => openTask(item)}
                className={`flex min-h-14 items-center gap-2 rounded-xl border bg-white px-2.5 py-2 text-left shadow-sm transition-colors active:scale-[0.99] ${isManagementEvent ? 'col-span-2 border-violet-200 hover:bg-violet-50/60 sm:col-span-1' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: bg ?? `${color}18` }}>
                  {isManagementEvent ? <Plus size={19} style={{ color }} /> : <Icon size={18} style={{ color }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-black text-slate-800">{itemLabel}</p>
                    {isManagementEvent && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">แจ้งกำหนดการต่างๆ</span>}
                  </div>
                  {itemDesc && <p className="mt-0.5 hidden truncate text-[10px] text-slate-400 sm:block">{itemDesc}</p>}
                </div>
                <ChevronRight size={15} className="shrink-0 text-slate-300" />
              </button>
            )
          })}
        </div>
      </section>

      {showOverview && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
            {kpis.map(({ label, value, Icon, color, bg, module }) => {
              const canOpen = module && moduleKeys.has(module)
              return (
                <button key={label} type="button" disabled={!canOpen} onClick={() => canOpen && setActiveModule(module)}
                  className="flex min-h-16 items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-default">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: bg }}>
                    <Icon size={15} style={{ color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-black leading-none text-slate-900">{loading ? '—' : value.toLocaleString('th-TH')}</p>
                    <p className="mt-1 truncate text-[9px] font-semibold text-slate-500">{label}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="grid gap-2">
        {showOverview && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-slate-800">งานรอรับเรื่อง</h2>
              <p className="text-[10px] text-slate-400">เรียงจากรายการที่รอนานที่สุด</p>
            </div>
            <Clock3 size={17} className="text-slate-400" />
          </div>
          {loading ? (
            <div className="flex min-h-24 items-center justify-center"><Loader2 size={22} className="animate-spin text-blue-500" /></div>
          ) : workQueue.length === 0 ? (
            <div className="flex min-h-24 items-center justify-center gap-3 px-4 py-4 text-left sm:justify-start">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50"><Inbox size={18} className="text-emerald-600" /></div>
              <div>
                <p className="text-sm font-bold text-slate-700">ไม่มีงานรอรับเรื่อง</p>
                <p className="mt-0.5 text-[11px] text-slate-400">เมื่อมีรายการใหม่ ระบบจะแสดงที่นี่โดยไม่เปิดเผยข้อมูลส่วนบุคคล</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 md:grid md:grid-cols-3 md:divide-x md:divide-y-0">
              {workQueue.map(item => {
                const waitingDays = ageInDays(item.created_at)
                const waitingClass = waitingDays >= 7
                  ? 'bg-red-100 text-red-700 ring-red-200'
                  : waitingDays >= 3
                    ? 'bg-amber-100 text-amber-800 ring-amber-200'
                    : 'bg-sky-50 text-sky-700 ring-sky-200'
                return (
                  <button key={`${item.kind}-${item.id}`} type="button" onClick={() => setActiveModule(item.module)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[10px] font-black" style={{ color: item.color, backgroundColor: item.bg }}>{item.kind}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">{item.title}</p>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ring-1 ${waitingClass}`}>รอ {waitingDays} วันทำการ</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-400">รับเรื่องเมื่อ {formatThaiDate(item.created_at, { day: 'numeric', month: 'short', year: '2-digit' })}</p>
                    </div>
                    <ChevronRight size={15} className="shrink-0 text-slate-300" />
                  </button>
                )
              })}
            </div>
          )}
        </section>
        )}

      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3">
          <h2 className="text-sm font-bold text-slate-800">เครื่องมือที่ใช้งานได้</h2>
          <p className="text-[10px] text-slate-400">แสดงตามโมดูลและสิทธิ์ของบัญชีนี้</p>
        </div>
        <div className="space-y-2.5">
          {visibleGroups.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                {items.map(({ key, label, Icon, color, bg, externalUrl, navTo }) => (
                  <button key={key} type="button"
                    onClick={() => navTo ? navigate(navTo) : externalUrl ? navigate(externalUrl) : setActiveModule(key)}
                    className="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 active:scale-[0.99]">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: bg ?? `${color}18` }}><Icon size={18} style={{ color }} /></div>
                    <p className="min-w-0 flex-1 text-xs font-bold leading-tight text-slate-700">{label}</p>
                    {key === 'inbox' && pendingCount > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{pendingCount > 99 ? '99+' : pendingCount}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {showOverview && <p className="text-center text-[10px] text-slate-400">“ค้างเกิน 7 วัน” เป็นตัวชี้วัดเฝ้าระวังภายใน ไม่ใช่กรอบระยะเวลาตามกฎหมายหรือ SLA ที่ประกาศใช้</p>}
    </div>
  )
}
