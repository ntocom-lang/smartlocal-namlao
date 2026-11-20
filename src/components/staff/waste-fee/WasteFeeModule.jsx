import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Coins, Loader2, Users } from 'lucide-react'
import { fetchAccounts, fetchIsManager, fetchRates, fetchSortingPeriods, friendlyError } from '../../../lib/wasteFeeApi'
import { currentMonthStart, hasSortingIn } from '../../../lib/wasteFee'
import { TabBar } from '../../patientTransport/StaffShell'
import WasteFeeDetailSheet from './WasteFeeDetailSheet'
import WasteFeeFormSheet from './WasteFeeFormSheet'
import WasteFeeImportSheet from './WasteFeeImportSheet'
import WasteFeeRateSheet from './WasteFeeRateSheet'
import WasteFeeRatesTab from './WasteFeeRatesTab'
import WasteFeeRegisterTab from './WasteFeeRegisterTab'

/**
 * เมนู "ทะเบียนค่าธรรมเนียมขยะ" (ฝั่งเจ้าหน้าที่) — ทะเบียนบัญชี | อัตราค่าธรรมเนียม
 * เห็นเมนู = admin/officer/staff/superadmin (staffMenuAccess) แต่สิทธิ์ใช้จริงตัดสินที่ wfee_is_manager() ฝั่งฐาน (กองเจ้าของงานขยะ) — ไม่ใช่ผู้จัดการจะเห็นข้อความอธิบาย
 * ข้อมูลมีชื่อผู้ชำระ/เบอร์/บ้านเลขที่ (PDPA): แสดงเฉพาะหน้านี้หลังตรวจสิทธิ์แล้ว
 * ขั้นนี้ (PR1) ระบบคำนวณ "ยอดที่ควรเก็บ" ให้ดูเท่านั้น ยังไม่สร้างยอดค้าง/ใบแจ้งหนี้ · การลดค่ากำจัดเจ้าหน้าที่ยืนยันเองทุกราย
 */
export default function WasteFeeModule({ tenant, profile }) {
  const tenantId = tenant?.id
  const userId = profile?.id
  const [tab, setTab] = useState('registry')
  const [state, setState] = useState(null) // { tenantId, isManager, rates, accounts, periods }
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [sheet, setSheet] = useState(null) // { kind: 'form'|'detail'|'import'|'rate', account?, rate? }
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    if (!tenantId || !userId) return undefined
    let alive = true
    ;(async () => {
      const manager = await fetchIsManager(tenantId)
      if (!alive) return
      if (manager.error) { setError(friendlyError(manager.error)); setState({ tenantId, isManager: false }); return }
      if (!manager.value) { setError(''); setState({ tenantId, isManager: false }); return }
      const [rates, accounts, periods] = await Promise.all([fetchRates(tenantId), fetchAccounts(tenantId), fetchSortingPeriods(tenantId)])
      if (!alive) return
      const failure = rates.error ?? accounts.error ?? periods.error
      setError(failure ? friendlyError(failure) : '')
      setState({ tenantId, isManager: true, rates: rates.rates, accounts: accounts.accounts, periods: periods.periods })
    })()
    return () => { alive = false }
  }, [tenantId, userId, reloadKey])

  const ready = state?.tenantId === tenantId
  const month = currentMonthStart()
  const periodsByAccount = useMemo(() => {
    const map = new Map()
    for (const p of state?.periods ?? []) map.set(p.account_id, [...(map.get(p.account_id) ?? []), p])
    return map
  }, [state])
  // บัญชีที่ได้ลดค่ากำจัดในเดือนนี้ (ใช้ป้ายในทะเบียน)
  const sortedIds = useMemo(() => new Set([...periodsByAccount].filter(([, list]) => hasSortingIn(list, month)).map(([id]) => id)), [periodsByAccount, month])

  if (!ready) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />กำลังโหลดทะเบียนค่าธรรมเนียมขยะ…</div>

  if (!state.isManager) {
    return (
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center text-gray-800">
          <p className="font-semibold">ทะเบียนค่าธรรมเนียมขยะ</p>
          <p className="mt-1 text-sm text-gray-600">เมนูนี้สำหรับกองที่ถือเรื่องงานขยะของ อปท. (ผู้ดูแลระบบหรือเจ้าหน้าที่ของกองนั้น)</p>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'registry', label: 'ทะเบียนบัญชี', Icon: Users },
    { id: 'rates', label: 'อัตราค่าธรรมเนียม', Icon: Coins },
  ]
  const activeTab = tabs.some(t => t.id === tab) ? tab : 'registry'
  const closeSheet = () => setSheet(null)
  const saved = () => { setSheet(null); reload() }
  // แผ่นรายละเอียดเก็บ id ตอนเปิด แล้วอ่านแถวล่าสุดจากรายการ — หลังเลิกเก็บ/ยืนยันคัดแยก ข้อมูลในแผ่นตามรายการที่รีโหลด
  const freshAccount = a => state.accounts.find(x => x.id === a?.id) ?? a

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</p>}
      <TabBar tab={activeTab} setTab={setTab} tabs={tabs} />

      {activeTab === 'registry' && (
        <WasteFeeRegisterTab accounts={state.accounts} month={month} sortedIds={sortedIds}
          onAdd={() => setSheet({ kind: 'form', account: null })} onImport={() => setSheet({ kind: 'import' })}
          onDetail={account => setSheet({ kind: 'detail', account })} onEdit={account => setSheet({ kind: 'form', account })} />
      )}
      {activeTab === 'rates' && (
        <WasteFeeRatesTab rates={state.rates} onAdd={() => setSheet({ kind: 'rate', rate: null })} onEdit={rate => setSheet({ kind: 'rate', rate })} />
      )}

      {sheet?.kind === 'form' && <WasteFeeFormSheet tenantId={tenantId} account={sheet.account} onClose={closeSheet} onSaved={saved} />}
      {sheet?.kind === 'detail' && (
        <WasteFeeDetailSheet tenantId={tenantId} account={freshAccount(sheet.account)} periods={periodsByAccount.get(sheet.account.id) ?? []} rates={state.rates}
          month={month} onClose={closeSheet} onChanged={reload} />
      )}
      {sheet?.kind === 'rate' && <WasteFeeRateSheet tenantId={tenantId} rate={sheet.rate} onClose={closeSheet} onSaved={saved} />}
      {sheet?.kind === 'import' && <WasteFeeImportSheet tenantId={tenantId} accounts={state.accounts} onClose={closeSheet} onChanged={reload} />}
    </div>
  )
}
