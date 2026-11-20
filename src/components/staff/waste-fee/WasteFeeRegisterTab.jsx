import { useMemo, useState } from 'react'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { ListCard, Pills } from '../../patientTransport/StaffShell'
import { PHASE_FILTERS, accountPhase, searchText } from '../../../lib/wasteFee'
import { btnGhost, btnPrimary } from '../construction/uiStyles'
import WasteFeeTable from './WasteFeeTable'

/**
 * แท็บ "ทะเบียนบัญชี": ค้นหา + กรองหมู่/สถานะ
 * ตัวเลขบนป้ายสถานะนับจากชุดที่ผ่านคำค้น+หมู่แล้ว (ตรงกับรายการที่จะเห็นเมื่อกด) · month = เดือนปัจจุบัน (วันที่ 1)
 */
export default function WasteFeeRegisterTab({ accounts, month, sortedIds, onAdd, onImport, ...actions }) {
  const [search, setSearch] = useState('')
  const [village, setVillage] = useState('all')
  const [status, setStatus] = useState('all')

  const villages = useMemo(() => [...new Set(accounts.map(a => a.village).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true })), [accounts])
  const q = search.trim().toLocaleLowerCase('th-TH')
  const base = useMemo(() => accounts.filter(a => {
    if (village !== 'all' && a.village !== village) return false
    return !q || searchText(a).includes(q)
  }), [accounts, village, q])
  const counts = useMemo(() => {
    const c = { all: base.length }
    for (const a of base) { const id = accountPhase(a, month); c[id] = (c[id] ?? 0) + 1 }
    return c
  }, [base, month])
  const shown = status === 'all' ? base : base.filter(a => accountPhase(a, month) === status)
  // ป้ายที่ไม่มีบัญชีเลยซ่อนไว้ (เว้นแต่กำลังเลือกอยู่) — เหลือแต่ตัวกรองที่กดแล้วเจออะไร
  const pills = PHASE_FILTERS.filter(f => f.id === 'all' || f.id === status || counts[f.id]).map(f => ({ ...f, count: counts[f.id] ?? 0 }))

  return (
    <ListCard title="ทะเบียนผู้ชำระค่าธรรมเนียมขยะ" count={shown.length} search={search} onSearch={setSearch} searchLabel="ค้นหาชื่อ เลขทะเบียน บ้านเลขที่ หมู่"
      action={(
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={onAdd}><Plus size={16} />เพิ่มบัญชี</button>
          <button type="button" className={btnGhost} onClick={onImport}><FileSpreadsheet size={16} />นำเข้า Excel</button>
        </div>
      )}
      pills={(
        <div className="space-y-2.5">
          {villages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <select aria-label="กรองหมู่" value={village} onChange={e => setVillage(e.target.value)}
                className="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-2 text-sm font-semibold text-gray-800 md:min-h-9">
                <option value="all">ทุกหมู่</option>
                {villages.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}
          <Pills label="กรองสถานะ" value={status} onChange={setStatus} items={pills} />
        </div>
      )}>
      <WasteFeeTable accounts={shown} month={month} sortedIds={sortedIds} {...actions}
        emptyText={accounts.length ? 'ไม่พบบัญชีตามเงื่อนไข' : 'ยังไม่มีบัญชีในทะเบียน — กด "เพิ่มบัญชี" หรือ "นำเข้า Excel" เพื่อเริ่ม'} />
    </ListCard>
  )
}
