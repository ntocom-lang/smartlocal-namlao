import { useMemo, useState } from 'react'
import { ListCard, Pills } from '../../patientTransport/StaffShell'
import { actionKind, sortByUrgency } from '../../../lib/licenceRegistry'
import LicenceTable from './LicenceTable'

const KINDS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'expired', label: 'หมดอายุแล้ว', color: '#dc2626' },
  { id: 'expiring', label: 'ใกล้หมดอายุ', color: '#d97706' },
  { id: 'overdue', label: 'ค้างชำระ', color: '#dc2626' },
  { id: 'due', label: 'ครบกำหนดชำระ', color: '#d97706' },
]

/** แท็บ "ต้องดำเนินการ": ใบที่หมดอายุ/ใกล้หมดอายุ/ค้างชำระ เรียงตามวัน (เลยมานานสุดก่อน) — ระบบคัดตามกฎ เจ้าหน้าที่เป็นผู้ดำเนินการ */
export default function LicenceActionTab({ rows, today, soonDays, ...actions }) {
  const [kind, setKind] = useState('all')
  const items = useMemo(() => sortByUrgency(rows
    .map(r => ({ ...r, kind: actionKind(r.licence, r.docKind, today, soonDays) }))
    .filter(r => r.kind)), [rows, today, soonDays])
  const counts = useMemo(() => {
    const c = { all: items.length }
    for (const r of items) c[r.kind] = (c[r.kind] ?? 0) + 1
    return c
  }, [items])
  const shown = kind === 'all' ? items : items.filter(r => r.kind === kind)
  const pills = KINDS.filter(k => k.id === 'all' || k.id === kind || counts[k.id]).map(k => ({ ...k, count: counts[k.id] ?? 0 }))

  return (
    <ListCard title="ต้องดำเนินการ" count={shown.length} pills={<Pills label="กรองประเภทงาน" value={kind} onChange={setKind} items={pills} />}>
      <p className="border-b border-gray-100 px-4 py-2.5 text-xs text-gray-600 sm:px-5">
        ใบที่ยังใช้งาน/พักใช้ และถึงกำหนดตามวันเตือนที่ตั้งไว้ (ใกล้หมดอายุภายใน {soonDays} วัน) — ใบอนุญาตที่สิ้นอายุแล้วต้องให้ผู้ประกอบการยื่นคำขอใหม่
      </p>
      <LicenceTable rows={shown} today={today} soonDays={soonDays} {...actions} emptyText="ไม่มีใบที่ต้องดำเนินการในขณะนี้" />
    </ListCard>
  )
}
