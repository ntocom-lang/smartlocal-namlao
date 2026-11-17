import { useMemo, useState } from 'react'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { ListCard, Pills } from '../../patientTransport/StaffShell'
import { BADGE_FILTERS, licenceBadge, searchText } from '../../../lib/licenceRegistry'
import { btnGhost, btnPrimary } from '../construction/uiStyles'
import LicenceTable from './LicenceTable'

/**
 * แท็บ "ทะเบียน": ค้นหา + กรองประเภท/สถานะ/หมู่บ้าน
 * rows: [{ licence, type, docKind, days }] · ตัวเลขบนป้ายสถานะนับจากชุดที่ผ่านคำค้น+ประเภท+หมู่บ้านแล้ว (ตรงกับรายการที่จะเห็นเมื่อกด)
 */
export default function LicenceRegisterTab({ rows, types, today, soonDays, noTypes, onAdd, onImport, ...actions }) {
  const [search, setSearch] = useState('')
  const [typeId, setTypeId] = useState('all')
  const [village, setVillage] = useState('all')
  const [status, setStatus] = useState('all')

  const villages = useMemo(() => [...new Set(rows.map(r => r.licence.village).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')), [rows])
  const q = search.trim().toLocaleLowerCase('th-TH')
  const base = useMemo(() => rows.filter(r => {
    if (typeId !== 'all' && r.licence.licence_type_id !== typeId) return false
    if (village !== 'all' && r.licence.village !== village) return false
    return !q || searchText(r.licence, r.type).includes(q)
  }), [rows, typeId, village, q])
  const badgeOf = r => licenceBadge(r.licence, r.docKind, today, soonDays).id
  const counts = useMemo(() => {
    const c = { all: base.length }
    for (const r of base) { const id = badgeOf(r); c[id] = (c[id] ?? 0) + 1 }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, today, soonDays])
  const shown = status === 'all' ? base : base.filter(r => badgeOf(r) === status)
  // ป้ายที่ไม่มีใบเลยซ่อนไว้ (เว้นแต่กำลังเลือกอยู่) — เหลือแต่ตัวกรองที่กดแล้วเจออะไร
  const pills = BADGE_FILTERS.filter(f => f.id === 'all' || f.id === status || counts[f.id]).map(f => ({ ...f, count: counts[f.id] ?? 0 }))

  return (
    <ListCard title="ทะเบียนใบอนุญาต" count={shown.length} search={search} onSearch={setSearch} searchLabel="ค้นหาชื่อร้าน ผู้ประกอบการ เลขที่ หมู่บ้าน"
      action={(
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={onAdd} disabled={noTypes}><Plus size={16} />เพิ่มใบ</button>
          <button type="button" className={btnGhost} onClick={onImport} disabled={noTypes}><FileSpreadsheet size={16} />นำเข้า Excel</button>
        </div>
      )}
      pills={(
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <select aria-label="กรองประเภท" value={typeId} onChange={e => setTypeId(e.target.value)}
              className="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-2 text-sm font-semibold text-gray-800 md:min-h-9">
              <option value="all">ทุกประเภท</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {villages.length > 0 && (
              <select aria-label="กรองหมู่บ้าน" value={village} onChange={e => setVillage(e.target.value)}
                className="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-2 text-sm font-semibold text-gray-800 md:min-h-9">
                <option value="all">ทุกหมู่บ้าน</option>
                {villages.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
          </div>
          <Pills label="กรองสถานะ" value={status} onChange={setStatus} items={pills} />
        </div>
      )}>
      <LicenceTable rows={shown} today={today} soonDays={soonDays} {...actions}
        emptyText={noTypes ? 'ยังไม่มีประเภทใบอนุญาต — เพิ่มที่แท็บ "ประเภทใบอนุญาต" ก่อน (เฉพาะประเภทที่ อปท. มีข้อกำหนดของท้องถิ่นรองรับ)'
          : rows.length ? 'ไม่พบใบตามเงื่อนไข' : 'ยังไม่มีใบในทะเบียน — กด "เพิ่มใบ" หรือ "นำเข้า Excel" เพื่อเริ่ม'} />
    </ListCard>
  )
}
