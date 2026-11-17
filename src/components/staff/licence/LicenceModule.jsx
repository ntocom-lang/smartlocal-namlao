import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileCheck2, Layers, Loader2, Settings, TriangleAlert } from 'lucide-react'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { fetchDepartments } from '../../../lib/localPlanApi'
import { fetchIsAdmin, fetchIsManager, fetchLicences, fetchSettings, fetchTypes, friendlyError } from '../../../lib/licenceRegistryApi'
import { actionKind, daysRemaining, effectiveRemindDays } from '../../../lib/licenceRegistry'
import { TabBar } from '../../patientTransport/StaffShell'
import LicenceActionTab from './LicenceActionTab'
import LicenceFeeSheet from './LicenceFeeSheet'
import LicenceFormSheet from './LicenceFormSheet'
import LicenceHistorySheet from './LicenceHistorySheet'
import LicenceImportSheet from './LicenceImportSheet'
import LicenceRegisterTab from './LicenceRegisterTab'
import LicenceSettingsTab from './LicenceSettingsTab'
import LicenceStatusSheet from './LicenceStatusSheet'
import LicenceTypeSheet from './LicenceTypeSheet'
import LicenceTypesTab from './LicenceTypesTab'

/**
 * เมนู "ทะเบียนใบอนุญาต" (ฝั่งเจ้าหน้าที่) — ทะเบียน | ต้องดำเนินการ | ประเภทใบอนุญาต | ตั้งค่า (แอดมิน)
 * เห็นเมนู = admin/officer/staff/superadmin (staffMenuAccess) แต่สิทธิ์ใช้จริงตัดสินที่ licence_is_manager() ฝั่งฐาน — ไม่ใช่ผู้จัดการจะเห็นข้อความอธิบาย
 * ข้อมูลมีชื่อผู้ประกอบการ (PDPA): แสดงเฉพาะหน้านี้หลังตรวจสิทธิ์แล้ว · ระบบคัดและเตือนตามกฎ เจ้าหน้าที่เป็นผู้ยืนยันทุกการรับเงินและคำสั่ง
 */
export default function LicenceModule({ tenant, profile }) {
  const tenantId = tenant?.id
  const userId = profile?.id
  const [tab, setTab] = useState('registry')
  const [state, setState] = useState(null) // { tenantId, isManager, isAdmin, settings, types, licences, departments }
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [sheet, setSheet] = useState(null) // { kind: 'form'|'fee'|'status'|'history'|'type'|'import', row?, type? }
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    if (!tenantId || !userId) return undefined
    let alive = true
    ;(async () => {
      const [manager, admin] = await Promise.all([fetchIsManager(tenantId), fetchIsAdmin(tenantId)])
      if (!alive) return
      if (manager.error) { setError(friendlyError(manager.error)); setState({ tenantId, isManager: false, isAdmin: false }); return }
      if (!manager.value) { setError(''); setState({ tenantId, isManager: false, isAdmin: admin.value }); return }
      const [settings, types, licences, departments] = await Promise.all([fetchSettings(tenantId), fetchTypes(tenantId), fetchLicences(tenantId), fetchDepartments(tenantId)])
      if (!alive) return
      const failure = settings.error ?? types.error ?? licences.error ?? departments.error
      setError(failure ? friendlyError(failure) : '')
      setState({ tenantId, isManager: true, isAdmin: admin.value, settings: settings.settings, types: types.types, licences: licences.licences, departments: departments.departments })
    })()
    return () => { alive = false }
  }, [tenantId, userId, reloadKey])

  const ready = state?.tenantId === tenantId
  const today = bangkokIsoDate()
  const soonDays = useMemo(() => Math.max(...effectiveRemindDays(state?.settings?.remind_days)), [state])
  const rows = useMemo(() => {
    if (!ready || !state.isManager) return []
    const typeById = new Map(state.types.map(t => [t.id, t]))
    return state.licences.map(licence => {
      const type = typeById.get(licence.licence_type_id) ?? null
      const docKind = type?.doc_kind ?? 'licence'
      return { licence, type, docKind, days: daysRemaining(licence, docKind, today) }
    })
  }, [ready, state, today])
  const actionCount = useMemo(() => rows.filter(r => actionKind(r.licence, r.docKind, today, soonDays)).length, [rows, today, soonDays])
  const typeCounts = useMemo(() => {
    const c = {}
    for (const r of rows) c[r.licence.licence_type_id] = (c[r.licence.licence_type_id] ?? 0) + 1
    return c
  }, [rows])

  if (!ready) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />กำลังโหลดทะเบียนใบอนุญาต…</div>

  if (!state.isManager) {
    return (
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center text-gray-800">
          <p className="font-semibold">ทะเบียนใบอนุญาต</p>
          <p className="mt-1 text-sm text-gray-600">เมนูนี้สำหรับกองที่ถือเรื่องใบอนุญาต ผู้ดูแลระบบตั้งได้ที่แท็บตั้งค่า</p>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'registry', label: 'ทะเบียน', Icon: FileCheck2 },
    { id: 'action', label: `ต้องดำเนินการ${actionCount ? ` (${actionCount})` : ''}`, Icon: TriangleAlert },
    { id: 'types', label: 'ประเภทใบอนุญาต', Icon: Layers },
    ...(state.isAdmin ? [{ id: 'settings', label: 'ตั้งค่า', Icon: Settings }] : []),
  ]
  const activeTab = tabs.some(t => t.id === tab) ? tab : 'registry'
  const closeSheet = () => setSheet(null)
  const saved = () => { setSheet(null); reload() }
  const actions = {
    onFee: row => setSheet({ kind: 'fee', row }),
    onStatus: row => setSheet({ kind: 'status', row }),
    onHistory: row => setSheet({ kind: 'history', row }),
    onEdit: row => setSheet({ kind: 'form', row }),
  }
  // แผ่นเก็บ row เดิมตอนเปิด — หลังรับเงิน/ยกเลิกในประวัติ แผ่นประวัติอ่านซ้ำเองจากฐาน ส่วน row ในรายการรีโหลดผ่าน reload()
  const freshRow = row => rows.find(r => r.licence.id === row?.licence.id) ?? row

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</p>}
      <TabBar tab={activeTab} setTab={setTab} tabs={tabs} />

      {activeTab === 'registry' && (
        <LicenceRegisterTab rows={rows} types={state.types} today={today} soonDays={soonDays} noTypes={state.types.length === 0} {...actions}
          onAdd={() => setSheet({ kind: 'form', row: null })} onImport={() => setSheet({ kind: 'import' })} />
      )}
      {activeTab === 'action' && <LicenceActionTab rows={rows} today={today} soonDays={soonDays} {...actions} />}
      {activeTab === 'types' && (
        <LicenceTypesTab types={state.types} counts={typeCounts} onAdd={() => setSheet({ kind: 'type', type: null })} onEdit={type => setSheet({ kind: 'type', type })} />
      )}
      {activeTab === 'settings' && state.isAdmin && (
        <LicenceSettingsTab key={state.settings?.updated_at ?? 'new'} tenantId={tenantId} settings={state.settings} departments={state.departments} onSaved={reload} />
      )}

      {sheet?.kind === 'form' && <LicenceFormSheet tenantId={tenantId} licence={sheet.row?.licence ?? null} types={state.types} onClose={closeSheet} onSaved={saved} />}
      {sheet?.kind === 'fee' && <LicenceFeeSheet row={freshRow(sheet.row)} today={today} onClose={closeSheet} onSaved={saved} />}
      {sheet?.kind === 'status' && <LicenceStatusSheet row={freshRow(sheet.row)} today={today} onClose={closeSheet} onSaved={saved} />}
      {sheet?.kind === 'history' && <LicenceHistorySheet row={freshRow(sheet.row)} types={state.types} onClose={closeSheet} onChanged={reload} />}
      {sheet?.kind === 'type' && <LicenceTypeSheet tenantId={tenantId} type={sheet.type} onClose={closeSheet} onSaved={saved} />}
      {sheet?.kind === 'import' && <LicenceImportSheet tenantId={tenantId} types={state.types} licences={state.licences} onClose={closeSheet} onChanged={reload} />}
    </div>
  )
}
