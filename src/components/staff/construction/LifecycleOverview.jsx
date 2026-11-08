// แท็บ "ภาพรวม" ของโมดูลโครงการก่อสร้าง: การ์ดนับตามขั้น · แถบ "ต้องดูแล" เรียงตามวันครบกำหนดตามระเบียบ · รายการโครงการพร้อมจุด 9 จุด
// กฎ/คำเตือนมาจาก constructionLifecycle.js (projectAlerts / budgetAlerts) ทั้งหมด ที่นี่แค่จัดหน้า · คำนวณด้วย useMemo ครั้งเดียวต่อข้อมูลชุดหนึ่ง
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { ListCard, Pills } from '../../patientTransport/StaffShell'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { formatPct } from '../../../lib/constructionReport'
import { MAIN_STAGES, STAGES, budgetAlerts, projectAlerts } from '../../../lib/constructionLifecycle'
import { LevelIcon, StageBadge, StepDots } from './LifecycleBits'
import { btnPrimary } from './uiStyles'
import { FINISHED_STAGES, HALTED_STAGES, LEVEL_BG, STAGE_COLORS, STAGE_SHORT, VERIFY_TEXT, thaiDay, thaiText } from './lifecycleFormat'

const LEVEL_RANK = { error: 0, warn: 1, info: 2 }
const SHOWN_ALERTS = 8

/** ปีงบ พ.ศ. ของวันที่ ISO (ต.ค.–ก.ย.) */
const fiscalYearOfIso = iso => (Number(iso.slice(5, 7)) >= 10 ? Number(iso.slice(0, 4)) + 1 : Number(iso.slice(0, 4))) + 543

/** วันครบกำหนดเรียงก่อน ไม่มีวันครบกำหนดไว้ท้าย · วันเดียวกันเรียงตามระดับ */
const byDue = (a, b) => {
  const da = a.due ?? '9999-12-31'
  const db = b.due ?? '9999-12-31'
  return da < db ? -1 : da > db ? 1 : LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
}

/**
 * @param {{ rows: Array<{ project: object, bundle: object }>, latest: Record<string, object>, canCreate: boolean,
 *           onCreate: () => void, onOpen: (projectId: string) => void, today?: string, loadError?: string }} props
 */
export default function LifecycleOverview({ rows, latest = {}, canCreate, onCreate, onOpen, today = bangkokIsoDate(), loadError = '', alertsReady = true }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('open')
  const [allAlerts, setAllAlerts] = useState(false)

  const { alerts, alertCount } = useMemo(() => {
    const list = []
    const counts = {}
    // ข้อมูลวงจรยังโหลดไม่เสร็จ/โหลดไม่สำเร็จ = ไม่เตือน (คำนวณจากข้อมูลว่างจะเตือนผิด เช่น "กรรมการราคากลาง 0 คน")
    if (!alertsReady) return { alerts: list, alertCount: counts }
    const live = rows.filter(r => !FINISHED_STAGES.includes(r.project.stage))
    const add = (alert, project) => {
      list.push({ ...alert, projectId: project.id, projectTitle: project.title })
      counts[project.id] = (counts[project.id] ?? 0) + 1
    }
    for (const r of live) for (const a of projectAlerts(r.bundle, today)) add(a, r.project)
    const byId = Object.fromEntries(live.map(r => [r.project.id, r.project]))
    for (const a of budgetAlerts(live.map(r => r.bundle), fiscalYearOfIso(today), today)) if (byId[a.projectId]) add(a, byId[a.projectId])
    return { alerts: list.sort(byDue), alertCount: counts }
  }, [rows, today, alertsReady])

  const stageCounts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map(s => [s, 0]))
    for (const r of rows) if (c[r.project.stage] !== undefined) c[r.project.stage]++
    return c
  }, [rows])

  const counts = {
    open: rows.filter(r => !FINISHED_STAGES.includes(r.project.stage) && r.project.stage !== 'terminated').length,
    attention: rows.filter(r => alertCount[r.project.id]).length,
    closed: stageCounts.closed,
    halted: rows.filter(r => HALTED_STAGES.includes(r.project.stage)).length,
  }
  const q = search.trim().toLowerCase()
  const shown = rows.filter(({ project: p }) => {
    if (filter === 'open' && (FINISHED_STAGES.includes(p.stage) || p.stage === 'terminated')) return false
    if (filter === 'attention' && !alertCount[p.id]) return false
    if (filter === 'closed' && p.stage !== 'closed') return false
    if (filter === 'halted' && !HALTED_STAGES.includes(p.stage)) return false
    if (!q) return true
    return [p.title, p.contractor_name, p.contract_no, p.project_no].some(v => String(v ?? '').toLowerCase().includes(q))
  })

  const worst = alerts.some(a => a.level === 'error') ? 'error' : 'warn'
  const visibleAlerts = allAlerts ? alerts : alerts.slice(0, SHOWN_ALERTS)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="จำนวนโครงการตามขั้น">
        {[...MAIN_STAGES, 'suspended', 'cancelled', 'terminated'].map(stage => (
          <div key={stage} className={`rounded-xl border border-gray-200 bg-white p-2.5 text-center ${stageCounts[stage] ? '' : 'opacity-60'}`} data-stage={stage}>
            <div className="text-2xl font-extrabold" style={{ color: STAGE_COLORS[stage] }}>{stageCounts[stage]}</div>
            <div className="text-[11px] font-semibold leading-tight text-gray-600">{STAGE_SHORT[stage]}</div>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <section className={`rounded-2xl border p-3 text-sm ${worst === 'error' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`} aria-label="ต้องดูแล">
          <b className={worst === 'error' ? 'text-red-700' : 'text-amber-800'}>ต้องดูแล {alerts.length} เรื่อง — เรียงตามวันครบกำหนดตามระเบียบ</b>
          <ul className="mt-1.5 space-y-1.5">
            {visibleAlerts.map((a, i) => (
              <li key={`${a.projectId}-${a.code}-${i}`} className="flex items-start gap-2">
                <LevelIcon level={a.level} />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpen(a.projectId)} className="min-h-9 text-left text-gray-900 hover:underline">
                    {a.due && <b>{a.level === 'error' && a.due < today ? 'เลยกำหนดแล้ว' : `ภายใน ${thaiDay(a.due)}`} · </b>}
                    <b>{a.projectTitle}</b> — {thaiText(a.message)}
                  </button>
                  {a.basis && <span className="block text-[11px] text-gray-500">ที่มา: {a.basis}</span>}
                  {a.verify && <span className="block text-[11px] font-semibold text-amber-700">{VERIFY_TEXT}</span>}
                </div>
              </li>
            ))}
          </ul>
          {alerts.length > SHOWN_ALERTS && (
            <button type="button" className="mt-2 min-h-9 text-xs font-bold text-gray-700 underline" onClick={() => setAllAlerts(!allAlerts)}>
              {allAlerts ? 'ย่อรายการ' : `ดูทั้งหมด ${alerts.length} เรื่อง`}
            </button>
          )}
        </section>
      )}

      <ListCard title="สถานะโครงการ" count={shown.length} search={search} onSearch={setSearch} searchLabel="ค้นหาชื่อโครงการ ผู้รับจ้าง เลขสัญญา"
        action={canCreate && <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={onCreate}><Plus size={16} />เพิ่มโครงการ</button>}
        pills={<Pills label="กรองโครงการ" value={filter} onChange={setFilter} items={[
          { id: 'open', label: 'ยังไม่ปิด', count: counts.open, color: '#0369a1' },
          { id: 'attention', label: 'ต้องดูแล', count: counts.attention, color: '#b91c1c' },
          { id: 'closed', label: 'ปิดแล้ว', count: counts.closed, color: '#15803d' },
          { id: 'halted', label: 'ระงับ/ยกเลิก/บอกเลิก', count: counts.halted, color: '#d97706' },
        ]} />}>
        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            {loadError ? 'ยังแสดงรายการโครงการไม่ได้ (ดูข้อความสีแดงด้านบน)' : rows.length ? 'ไม่พบโครงการตามเงื่อนไข' : 'ยังไม่มีโครงการ'}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {shown.map(({ project: p, bundle }) => {
              const final = latest[p.id]
              const overall = final?.overall
              const mine = alerts.filter(a => a.projectId === p.id)
              const top = [...mine].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])[0]
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="font-bold text-gray-900">{p.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <StepDots project={p} events={bundle.events} />
                      <StageBadge project={p} />
                      {p.contractor_name && <span>{p.contractor_name}</span>}
                      {overall && <span>ผลงาน/แผน {formatPct(overall.actual)} / {formatPct(overall.plan)}</span>}
                      {overall?.label?.key === 'behind' && <span className="font-bold text-red-600">{overall.label.text}</span>}
                    </div>
                    {top && (
                      <p className={`mt-1.5 inline-block rounded-lg px-2 py-0.5 text-xs font-semibold ${LEVEL_BG[top.level]}`}>
                        {thaiText(top.message)}{mine.length > 1 ? ` · และอีก ${mine.length - 1} เรื่อง` : ''}
                      </p>
                    )}
                  </div>
                  <button type="button" className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    aria-label={`เปิดโครงการ ${p.title}`} onClick={() => onOpen(p.id)}>เปิดโครงการ</button>
                </li>
              )
            })}
          </ul>
        )}
      </ListCard>
      <p className="text-xs text-gray-500">จุด 9 จุด = ตั้งงบ → ปิดโครงการ (เขียว = ผ่าน, วงเขียว = ขั้นปัจจุบัน, ส้ม = ระงับ) · วันครบกำหนดนับวันทำการตามตารางวันหยุดราชการในระบบ</p>
    </div>
  )
}
