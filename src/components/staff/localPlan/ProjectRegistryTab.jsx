// แท็บ "ทะเบียนโครงการ" — รายการโครงการของแผนพัฒนาฉบับที่เลือก (ข้อมูลเล่มเดียวที่แผนดำเนินงานอ้างถึง)
// โครงเดียวกับหน้าคำร้อง/ยานพาหนะ: ListCard (ค้นหา + ป้ายกรอง) + แถวกดเปิดแผ่นรายละเอียด
import { useMemo, useState } from 'react'
import { Lock, Plus } from 'lucide-react'
import { paginate } from '../../../lib/patientBooking'
import { yearsSummary } from '../../../lib/localPlanView'
import { ListCard, Pager, Pills } from '../../patientTransport/StaffShell'
import { btnPrimary } from '../construction/uiStyles'

const UNASSIGNED = '__none__'
const PAGE_DEFAULT = 20

/**
 * projects/years: ของแผนที่เลือก · lockedIds: Set รหัสโครงการที่ถูกแผนดำเนินงานที่ประกาศแล้วอ้างอยู่
 * onOpen(project) · onAdd() (ผู้จัดการเท่านั้น — ส่ง null ถ้าไม่มีสิทธิ์)
 */
export default function ProjectRegistryTab({ projects, years, departments, lockedIds, onOpen, onAdd }) {
  const [search, setSearch] = useState('')
  const [dept, setDept] = useState('all')
  const [status, setStatus] = useState('active')
  const [perPage, setPerPage] = useState(PAGE_DEFAULT)
  const [page, setPage] = useState(1)

  const yearsByProject = useMemo(() => {
    const map = {}
    for (const y of years) (map[y.project_id] ??= []).push(y)
    return map
  }, [years])
  const deptName = useMemo(() => Object.fromEntries(departments.map(d => [d.id, d.name])), [departments])

  const q = search.trim().toLowerCase()
  // นับป้ายกรองกองจากชุดที่ผ่านสถานะ+คำค้นแล้ว — ตัวเลขบนป้ายจึงตรงกับรายการที่จะเห็นเมื่อกด
  const byStatusAndText = projects.filter(p => {
    if (status !== 'all' && p.status !== status) return false
    if (!q) return true
    return [p.official_name, p.project_code, p.strategy].some(v => String(v ?? '').toLowerCase().includes(q))
  })
  const deptCounts = {}
  for (const p of byStatusAndText) deptCounts[p.department_id ?? UNASSIGNED] = (deptCounts[p.department_id ?? UNASSIGNED] ?? 0) + 1
  const shown = byStatusAndText.filter(p => dept === 'all' || (p.department_id ?? UNASSIGNED) === dept)
  const statusCounts = {
    active: projects.filter(p => p.status === 'active').length,
    dropped: projects.filter(p => p.status === 'dropped').length,
    all: projects.length,
  }

  const deptPills = [
    { id: 'all', label: 'ทุกกอง', count: byStatusAndText.length },
    ...departments.filter(d => deptCounts[d.id] || dept === d.id).map(d => ({ id: d.id, label: d.short_name || d.name, count: deptCounts[d.id] ?? 0 })),
    ...(deptCounts[UNASSIGNED] || dept === UNASSIGNED ? [{ id: UNASSIGNED, label: 'ยังไม่ระบุกอง', count: deptCounts[UNASSIGNED] ?? 0, color: '#d97706' }] : []),
  ]

  const paged = paginate(shown.map(p => ({ size: 1, p })), perPage, page)
  const reset = fn => value => { fn(value); setPage(1) }

  return (
    <ListCard title="ทะเบียนโครงการ" count={shown.length} search={search} onSearch={reset(setSearch)} searchLabel="ค้นหาชื่อโครงการ รหัส ยุทธศาสตร์"
      action={onAdd && <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={onAdd}><Plus size={16} />เพิ่มโครงการ</button>}
      pills={(
        <div className="space-y-2.5">
          <Pills label="กรองสถานะโครงการ" value={status} onChange={reset(setStatus)} items={[
            { id: 'active', label: 'ใช้งาน', count: statusCounts.active, color: '#15803d' },
            { id: 'dropped', label: 'ตัดออก', count: statusCounts.dropped, color: '#6b7280' },
            { id: 'all', label: 'ทั้งหมด', count: statusCounts.all },
          ]} />
          <Pills label="กรองกองผู้รับผิดชอบ" value={dept} onChange={reset(setDept)} items={deptPills} />
        </div>
      )}>
      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">
          {projects.length ? 'ไม่พบโครงการตามเงื่อนไข' : onAdd ? 'ยังไม่มีโครงการในทะเบียน — กด "เพิ่มโครงการ" เพื่อเริ่ม' : 'ยังไม่มีโครงการในทะเบียน — นักวิเคราะห์นโยบายและแผนเป็นผู้ตั้ง'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {paged.units.map(({ p }) => {
            const summary = yearsSummary(yearsByProject[p.id])
            const meta = [p.project_code, p.department_id ? deptName[p.department_id] ?? 'กอง' : 'ยังไม่ระบุกอง', p.strategy].filter(Boolean)
            return (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p)} className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold text-gray-900">{p.official_name}</span>
                    <span className={`block break-words text-xs ${p.department_id ? 'text-gray-500' : 'text-amber-700'}`}>{meta.join(' · ')}</span>
                    {summary && <span className="mt-0.5 block break-words text-xs text-gray-700">วงเงิน {summary}</span>}
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {Number(p.added_in_revision) > 0 && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">เพิ่มเติมครั้งที่ {p.added_in_revision}</span>}
                      {p.status === 'dropped' && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">ตัดออก</span>}
                    </span>
                  </span>
                  {lockedIds.has(p.id) && (
                    <span className="mt-0.5 shrink-0 text-gray-500" title="ถูกอ้างในแผนการดำเนินงานที่ประกาศแล้ว — ชื่อ รหัส ยุทธศาสตร์ สถานะ และวงเงินแก้ไม่ได้" role="img" aria-label="ถูกอ้างในแผนการดำเนินงานที่ประกาศแล้ว (ล็อก)">
                      <Lock size={16} />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="px-4 pb-4 sm:px-5">
        <Pager total={paged.total} from={paged.from} to={paged.to} page={paged.page} pages={paged.pages} perPage={perPage}
          onPage={setPage} onPerPage={value => { setPerPage(value); setPage(1) }} />
      </div>
    </ListCard>
  )
}
