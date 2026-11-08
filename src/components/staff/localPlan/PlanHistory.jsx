// ประวัติของเมนูแผนพัฒนาท้องถิ่น (local_plan_events — trigger เขียนเอง ผู้ใช้อ่านได้อย่างเดียว) ใหม่ → เก่า
// แสดง: ใคร / เมื่อ / ทำอะไร / ช่องที่เปลี่ยน ค่าเดิม → ค่าใหม่ / เหตุผล
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { thaiShortDate } from '../../../lib/complaintReportPeriods'
import { fetchEvents, fetchProfileNames, friendlyError } from '../../../lib/localPlanApi'
import { fiscalMonthLabel } from '../../../lib/localPlanCalendar'
import { BASIS_LABELS } from '../../../lib/localPlanDeadlines'
import { formatBaht } from '../../../lib/localPlanView'
import { btnGhost } from '../construction/uiStyles'

const SHOWN = 6

const ENTITY_LABELS = {
  dev_plan: 'แผนพัฒนา', dev_project: 'โครงการ', dev_project_year: 'วงเงินรายปี', op_plan: 'แผนการดำเนินงาน', op_item: 'รายการ',
}
const ACTION_LABELS = { insert: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ', publish: 'ประกาศใช้', unpublish: 'ยกเลิกประกาศ' }
const FIELD_LABELS = {
  title: 'ชื่อแผน', year_from: 'ปีเริ่ม', year_to: 'ปีสิ้นสุด', is_current: 'ฉบับที่เมนูแสดง', status: 'สถานะ',
  published_on: 'วันที่ประกาศ', announce_ref_no: 'เลขที่ประกาศ', note: 'หมายเหตุ',
  official_name: 'ชื่อทางการ', project_code: 'รหัสโครงการ', strategy: 'ยุทธศาสตร์', department_id: 'กองผู้รับผิดชอบ',
  added_in_revision: 'เพิ่มเติม/เปลี่ยนแปลงครั้งที่', revision_ref_no: 'เลขที่ประกาศเพิ่มเติม',
  fiscal_year: 'ปีงบ', amount: 'งบประมาณ', kind: 'ชนิดฉบับ', revision_no: 'ครั้งที่', basis: 'ฐานนับ 30 วัน', basis_on: 'วันที่ตั้งต้น',
  basis_ref_no: 'เลขที่ตั้งต้น', extension_ref_no: 'เลขที่หนังสือขยายเวลา', extension_ref_date: 'วันที่หนังสือขยายเวลา',
  extended_due_on: 'กำหนดใหม่', dev_project_id: 'โครงการในทะเบียน', source: 'แหล่งโครงการ',
  external_agency: 'หน่วยงานเจ้าของโครงการ', seq_no: 'ที่', item_name: 'ชื่อรายการ', month_from: 'เดือนเริ่ม', month_to: 'เดือนสิ้นสุด',
}
// ช่องที่ไม่ต้องให้เจ้าหน้าที่เห็น (ไอดีล้วน / ผู้ประกาศ)
const HIDDEN = new Set(['published_by', 'dev_plan_id', 'op_plan_id', 'project_id'])
const KIND = { main: 'ฉบับหลัก', supplement: 'เพิ่มเติม', amendment: 'แก้ไข' }
const STATUS = { draft: 'ร่าง', published: 'ประกาศใช้แล้ว', active: 'ใช้งาน', dropped: 'ตัดออก' }
const SOURCE = { local: 'ของ อปท.', external: 'หน่วยงานอื่น' }

function formatValue(key, value, departments) {
  if (value === null || value === undefined || value === '') return 'ว่าง'
  if (key === 'department_id') return departments.find(d => d.id === value)?.name ?? 'กอง (ไม่พบชื่อ)'
  if (key === 'dev_project_id') return 'โครงการในทะเบียน'
  if (key === 'month_from' || key === 'month_to') return fiscalMonthLabel(value) || String(value)
  if (key === 'amount') return formatBaht(value)
  if (key === 'basis') return BASIS_LABELS[value] ?? String(value)
  if (key === 'status') return STATUS[value] ?? String(value)
  if (key === 'kind') return KIND[value] ?? String(value)
  if (key === 'source') return SOURCE[value] ?? String(value)
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return thaiShortDate(value)
  const s = String(value)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

// วัน+เวลาตามเวลาไทย (ไม่ใช้โซนเวลาเครื่องเจ้าหน้าที่)
const stamp = iso => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(d)
  return `${thaiShortDate(day)} ${time} น.`
}

function describe(event, departments) {
  const entity = ENTITY_LABELS[event.entity] ?? event.entity
  const changes = event.changes && typeof event.changes === 'object' ? event.changes : {}
  if (event.action === 'update' || event.action === 'publish' || event.action === 'unpublish') {
    // วงเงินรายปี: บอกว่าปีไหนเสมอในหัวข้อ แล้วไม่ต้องแสดงบรรทัดปีซ้ำ
    const yearOf = event.entity === 'dev_project_year' ? changes.fiscal_year?.[1] : null
    const rows = Object.entries(changes).filter(([key]) => !HIDDEN.has(key) && !(yearOf && key === 'fiscal_year'))
    return {
      head: `${ACTION_LABELS[event.action]}${event.action === 'update' ? entity : ''}${yearOf ? ` ปี ${yearOf}` : ''}`,
      lines: rows.map(([key, pair]) => {
        const [before, after] = Array.isArray(pair) ? pair : [null, pair]
        return `${FIELD_LABELS[key] ?? key}: ${formatValue(key, before, departments)} → ${formatValue(key, after, departments)}`
      }),
    }
  }
  // เพิ่ม/ลบ = ภาพทั้งแถว: โชว์ชื่อ + ปีงบ/จำนวนเงินถ้ามี พอให้รู้ว่าอะไร
  const name = changes.official_name ?? changes.item_name ?? changes.title ?? ''
  const extra = []
  if (changes.fiscal_year) extra.push(`ปี ${changes.fiscal_year}`)
  if (changes.amount !== undefined) extra.push(`งบ ${formatValue('amount', changes.amount, departments)}`)
  return { head: `${ACTION_LABELS[event.action] ?? event.action}${entity}`, lines: [[name, ...extra].filter(Boolean).join(' · ')].filter(Boolean) }
}

/**
 * entityId: แถวที่ดูประวัติ · includeChildren: รวมประวัติของลูก (รายการในฉบับ/โครงการในแผน)
 * tenantId ต้องส่งเสมอ (กรอง อปท. ก่อนอ่าน) · departments ไว้แปลงรหัสกองเป็นชื่อ · reloadKey เปลี่ยน = โหลดใหม่
 */
export default function PlanHistory({ tenantId, entityId, includeChildren = false, departments = [], reloadKey = 0, title = 'ประวัติ' }) {
  const [state, setState] = useState({ key: null, events: [], names: {}, error: '' })
  const [all, setAll] = useState(false)
  const key = `${tenantId}|${entityId}|${includeChildren}|${reloadKey}`

  useEffect(() => {
    if (!tenantId || !entityId) return undefined
    let alive = true
    ;(async () => {
      const { events, error } = await fetchEvents(tenantId, entityId, { includeChildren })
      const names = error ? {} : await fetchProfileNames(events.map(e => e.actor))
      if (alive) setState({ key, events, names, error: error ? friendlyError(error) : '' })
    })()
    return () => { alive = false }
  }, [tenantId, entityId, includeChildren, key])

  const ready = state.key === key
  const events = ready ? state.events : []
  const shown = all ? events : events.slice(0, SHOWN)
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 text-gray-800" aria-label={title}>
      <p className="text-sm font-bold text-gray-900">{title}</p>
      {!ready && <p className="mt-2 flex items-center gap-2 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" />กำลังโหลด…</p>}
      {ready && state.error && <p role="alert" className="mt-2 text-xs text-red-700">โหลดประวัติไม่สำเร็จ — {state.error}</p>}
      {ready && !state.error && events.length === 0 && <p className="mt-2 text-xs text-gray-500">ยังไม่มีประวัติ</p>}
      {shown.length > 0 && (
        <ol className="mt-2 space-y-2.5 border-l-2 border-gray-200 pl-4 text-sm">
          {shown.map(e => {
            const { head, lines } = describe(e, departments)
            return (
              <li key={e.id}>
                <span className="text-xs text-gray-500">{stamp(e.created_at)} · {e.actor ? (state.names[e.actor] ?? 'ผู้ใช้') : 'ระบบ'}</span>
                <br />
                <span className="font-semibold text-gray-800">{head}</span>
                {lines.map((line, i) => <span key={i} className="block break-words text-xs text-gray-700">{line}</span>)}
                {e.reason && <span className="block text-xs text-gray-600">เหตุผล: {e.reason}</span>}
              </li>
            )
          })}
        </ol>
      )}
      {events.length > SHOWN && (
        <button type="button" className={`${btnGhost} mt-2`} onClick={() => setAll(!all)}>{all ? 'ย่อ' : `ดูทั้งหมด (${events.length} รายการ)`}</button>
      )}
    </section>
  )
}
