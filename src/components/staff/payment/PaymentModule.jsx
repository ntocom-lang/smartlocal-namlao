import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Archive, CircleCheck, Clock, Info, Landmark, Loader2, RefreshCw, Settings } from 'lucide-react'
import { bangkokIsoDate } from '../../../lib/complaintReportPeriods'
import { fetchDepartments } from '../../../lib/localPlanApi'
import { fetchTypes } from '../../../lib/licenceRegistryApi'
import {
  fetchCanHandle, fetchIsPaymentAdmin, fetchIsRegistryManager, fetchLatestAccountAlert, fetchPaymentSettings, friendlyError, listBankTxns, listDues, syncLicenceDues,
} from '../../../lib/paymentDuesApi'
import { accountChangeBanner, describeSkipped, describeSync, filterByTab, matchedTxnByDue, needsSettingsNotice, receiptPrefillOf } from '../../../lib/paymentDues'
import { buildPaymentNoticeHtml } from '../../../lib/paymentNoticePrint'
import { addMobileCloseButton } from '../../../lib/printWindowClose'
import { thaiDateFromDateInput } from '../../../lib/thaiDate'
import { TabBar } from '../../patientTransport/StaffShell'
import { btnGhost } from '../construction/uiStyles'
import PaymentBankTab from './PaymentBankTab'
import PaymentCancelSheet from './PaymentCancelSheet'
import PaymentDuesTab from './PaymentDuesTab'
import PaymentReceiptSheet from './PaymentReceiptSheet'
import PaymentSettingsTab from './PaymentSettingsTab'

// เปิดหน้าต่างก่อนทำอะไร (กัน pop-up ถูกบล็อกบนมือถือ) แล้วรอฟอนต์ราชการก่อนสั่งพิมพ์ — แบบเดียวกับใบพิมพ์อื่น (WaterEventsPanel / FleetTrips)
// ปุ่ม "ปิดหน้าต่าง" เฉพาะอุปกรณ์สัมผัส (มือถือกดพิมพ์แล้วปิดไม่ได้) ไม่ติดไปกับกระดาษ
function openPrintWindow(html) {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) {
    alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    return
  }
  win.document.open()
  win.document.write(addMobileCloseButton(html))
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) {
        await Promise.race([win.document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))])
      }
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    if (win.closed) return
    win.focus()
    win.print()
  }, 200)
}

/**
 * เมนู "รับชำระเงิน" (ฝั่งเจ้าหน้าที่) — รอชำระ | ชำระแล้ว | ปิดแล้ว | เงินเข้าจากธนาคาร | ตั้งค่า (แอดมิน)
 * แท็บ "เงินเข้าจากธนาคาร" เห็นทุกคนที่เป็นผู้ดูแลยอด (สิทธิ์จริงตัดสินที่ payment_can_handle ฝั่งฐาน) · ข้อมูลเงินเข้ามาจาก migration PR2
 *   ที่ อปท. ยังไม่รัน = โหลดไม่ได้ ต้องไม่ลากแท็บเดิมพังตาม (โหลดเงินเข้า/สถานะแจ้งผู้บริหารแยก ไม่นับเป็นข้อผิดพลาดของเมนู)
 * ระบบสร้างยอดค้างเองตามกฎและปรับให้ทุกครั้งที่เปิดเมนู (ไม่มีปุ่มที่ต้องกดเป็นประจำ) เจ้าหน้าที่แค่บันทึกเลขใบเสร็จเมื่อรับเงินแล้ว
 * เห็นเมนู = admin/officer/staff/superadmin (staffMenuAccess) แต่สิทธิ์ใช้จริงตัดสินที่ payment_can_handle() ฝั่งฐาน — ไม่ใช่ผู้ดูแลจะเห็นข้อความอธิบาย
 * ข้อมูลมีชื่อผู้ประกอบการ (PDPA): แสดงเฉพาะหน้านี้หลังตรวจสิทธิ์แล้ว · ใบเสร็จรับเงินออกโดย อปท. ระบบนี้เก็บแค่เลขที่ใบเสร็จ
 */
export default function PaymentModule({ tenant, profile }) {
  const tenantId = tenant?.id
  const userId = profile?.id
  const [tab, setTab] = useState('open')
  const [state, setState] = useState(null) // { tenantId, canHandle, isAdmin, isManager, settings, types, departments, dues, today, sync }
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [sheet, setSheet] = useState(null) // { kind: 'receipt'|'cancel', due, txn? } · txn = เงินเข้าที่จับคู่แล้ว (เติมวันที่/ช่องทางให้แผ่นเลขใบเสร็จ)
  const [syncing, setSyncing] = useState(false)
  // เปิดเมนูครั้งแรก/กด "ปรับยอดค้างอีกครั้ง" = ให้ระบบปรับยอดก่อนอ่านรายการ · โหลดซ้ำหลังบันทึก/ยกเลิก ไม่ต้องปรับ (trigger ปิดยอดให้แล้ว)
  const syncNext = useRef(true)
  const syncedTenant = useRef(null)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  const resync = useCallback(() => { syncNext.current = true; setSyncing(true); setReloadKey(k => k + 1) }, [])

  useEffect(() => {
    if (!tenantId || !userId) return undefined
    let alive = true
    ;(async () => {
      const [handle, admin, manager] = await Promise.all([fetchCanHandle(tenantId), fetchIsPaymentAdmin(tenantId), fetchIsRegistryManager(tenantId)])
      if (!alive) return
      if (handle.error) { setError(friendlyError(handle.error)); setState({ tenantId, canHandle: false, isAdmin: false, isManager: false }); setSyncing(false); return }
      if (!handle.value) { setError(''); setState({ tenantId, canHandle: false, isAdmin: admin.value, isManager: false }); setSyncing(false); return }
      const doSync = syncNext.current || syncedTenant.current !== tenantId // เปลี่ยน อปท. (superadmin สลับ) ก็ปรับยอดของ อปท. ใหม่ด้วย
      syncNext.current = false
      syncedTenant.current = tenantId
      const sync = doSync ? await syncLicenceDues(tenantId) : { result: null, error: null }
      // ระบบปรับยอดไม่ได้ (เช่น เมนูยังไม่เปิดที่ อปท. นี้) ยังอ่านรายการเดิมให้เห็น พร้อมบอกเหตุผล
      const [settings, dues, departments, types, bankMatched, accountAlert] = await Promise.all([
        fetchPaymentSettings(tenantId), listDues(tenantId, 'all'), fetchDepartments(tenantId),
        manager.value ? fetchTypes(tenantId) : Promise.resolve({ types: [], error: null }), // กองคลังอ่านประเภทไม่ได้ (RLS) = ไม่มีผลล่วงหน้าของการต่ออายุ
        listBankTxns(tenantId, 'matched'), // ป้าย "เงินเข้าแล้ว รอเลขใบเสร็จ" ที่แท็บรอชำระ — ล้มไม่ลากเมนู (ไม่นับใน failure)
        fetchLatestAccountAlert(tenantId), // สถานะแจ้งผู้บริหารบนแบนเนอร์เปลี่ยนบัญชี — อ่านไม่ได้ = ไม่มีบรรทัดสถานะ (undefined) ไม่ใช่ "ไม่พบบันทึก"
      ])
      if (!alive) return
      const failure = sync.error ?? settings.error ?? dues.error
      setError(failure ? friendlyError(failure) : '')
      setState(prev => ({
        tenantId, canHandle: true, isAdmin: admin.value, isManager: manager.value,
        settings: settings.settings, dues: dues.dues, duesTotal: dues.total, duesTruncated: dues.truncated, departments: departments.departments ?? [], types: types.types ?? [],
        bankMatched: bankMatched.error ? [] : bankMatched.rows, accountAlert: accountAlert.error ? undefined : accountAlert.alert,
        today: sync.result?.today ?? bangkokIsoDate(),
        sync: doSync ? sync.result : (prev?.tenantId === tenantId ? prev.sync : null),
      }))
      setSyncing(false)
    })()
    return () => { alive = false }
  }, [tenantId, userId, reloadKey])

  const ready = state?.tenantId === tenantId
  if (!ready) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />กำลังโหลดรายการรับชำระเงิน…</div>

  if (!state.canHandle) {
    return (
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center text-gray-800">
          <p className="font-semibold">รับชำระเงิน</p>
          <p className="mt-1 text-sm text-gray-600">เมนูนี้สำหรับกองที่ถือเรื่องใบอนุญาต หรือกองคลังที่แอดมินเปิดสิทธิ์ให้บันทึกเลขใบเสร็จ — แอดมินตั้งได้ที่แท็บตั้งค่าของเมนูนี้</p>
        </div>
      </div>
    )
  }

  const { settings, dues, today } = state
  const openCount = filterByTab(dues, 'open').length
  const tabs = [
    { id: 'open', label: `รอชำระ${openCount ? ` (${openCount})` : ''}`, Icon: Clock },
    { id: 'paid', label: 'ชำระแล้ว', Icon: CircleCheck },
    { id: 'closed', label: 'ปิดแล้ว (หมดสิทธิ์/ยกเลิก)', Icon: Archive },
    { id: 'bank', label: 'เงินเข้าจากธนาคาร', Icon: Landmark },
    ...(state.isAdmin ? [{ id: 'settings', label: 'ตั้งค่า', Icon: Settings }] : []),
  ]
  const activeTab = tabs.some(t => t.id === tab) ? tab : 'open'
  const closeSheet = () => setSheet(null)
  const saved = () => { setSheet(null); reload() }
  const banner = accountChangeBanner(settings, today, state.accountAlert)
  const matchedByDue = matchedTxnByDue(state.bankMatched)
  const syncLines = describeSync(state.sync)
  const skipped = describeSkipped(state.sync)

  // พิมพ์ใบแจ้งชำระ: ค่าตั้ง/ยอด/วันนี้ ณ ตอนพิมพ์ (ใบที่พิมพ์ไปแล้วก่อนยอดถูกปรับอัตรา ต้องพิมพ์ใหม่)
  const printNotices = rows => {
    if (rows.length === 0) return
    openPrintWindow(buildPaymentNoticeHtml({ tenant, settings, dues: rows, today }))
  }
  const tabProps = { dues, today, isManager: state.isManager, matchedByDue, onReceipt: (due, txn) => setSheet({ kind: 'receipt', due, txn: txn ?? null }), onPrint: printNotices, onCancel: due => setSheet({ kind: 'cancel', due }) }
  const freshDue = due => dues.find(d => d.id === due?.id) ?? due
  // จากแท็บเงินเข้า: ใช้ยอดค้างเต็มรายการ (มีรอบ/ประเภทที่แผ่นเลขใบเสร็จต้องใช้) · ไม่อยู่ในรายการที่โหลด (เช่นเกินเพดาน 2,000) = ให้ปรับยอดแล้วลองใหม่ ไม่เปิดแผ่นที่ข้อมูลไม่ครบ
  const receiptFromBank = txn => {
    const due = dues.find(d => d.id === txn?.due?.id)
    if (!due) { setError('ไม่พบยอดค้างของรายการนี้ในรายการที่โหลดไว้ — กด "ปรับยอดค้างอีกครั้ง" แล้วลองใหม่'); return }
    setSheet({ kind: 'receipt', due, txn })
  }

  return (
    <div className="space-y-4">
      {banner && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            บัญชีรับเงินถูกเปลี่ยนเมื่อ {thaiDateFromDateInput(banner.date)} — ตรวจให้ตรงกับบัญชีของ อปท. ก่อนพิมพ์ใบแจ้งชำระ
            {banner.notice && (
              <span className={`mt-1 block text-xs font-semibold ${banner.notice.tone === 'ok' ? 'text-emerald-800' : 'text-amber-950'}`}>
                {banner.notice.tone === 'ok' ? '✓ ' : ''}{banner.notice.text}
              </span>
            )}
          </span>
        </p>
      )}
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</p>}
      {/* ฐานส่งมาไม่เกิน 2,000 แถว — เกินแล้วต้องบอก ห้ามตัดเงียบ (รอชำระมาก่อนเสมอ ส่วนที่หลุดคือยอดที่ปิดแล้วรุ่นเก่า) */}
      {state.duesTruncated && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          แสดง {dues.length.toLocaleString('th-TH')} จาก {Number(state.duesTotal).toLocaleString('th-TH')} รายการ — รายการที่ปิดแล้วรุ่นเก่าไม่ได้แสดง
        </p>
      )}
      {syncLines.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <Info size={16} className="mt-0.5 shrink-0" /><div>{syncLines.map(line => <p key={line}>{line}</p>)}</div>
        </div>
      )}
      {skipped && <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"><Info size={16} className="mt-0.5 shrink-0" />{skipped}</p>}
      {needsSettingsNotice(settings) && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Info size={16} className="mt-0.5 shrink-0" />
          ยังไม่ได้เปิดช่องทางรับชำระ — {state.isAdmin ? 'ตั้งที่แท็บตั้งค่า' : 'ให้แอดมินตั้งที่แท็บตั้งค่า'} (ใบแจ้งชำระจะยังไม่มี QR) · ยังบันทึกเลขใบเสร็จแบบเคาน์เตอร์ได้ตามปกติ
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1"><TabBar tab={activeTab} setTab={setTab} tabs={tabs} /></div>
        <button type="button" className={`${btnGhost} mb-4 min-h-9 px-3 text-xs`} onClick={resync} disabled={syncing}>
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />ปรับยอดค้างอีกครั้ง
        </button>
      </div>

      {activeTab === 'open' && <PaymentDuesTab tab="open" title="รอชำระ" {...tabProps} emptyText="ยังไม่มียอดรอชำระ — ระบบสร้างยอดเองเมื่อใบเข้าช่วงใกล้ครบกำหนด" />}
      {activeTab === 'paid' && <PaymentDuesTab tab="paid" title="ชำระแล้ว" {...tabProps} emptyText="ยังไม่มียอดที่บันทึกเลขใบเสร็จแล้ว" />}
      {activeTab === 'closed' && <PaymentDuesTab tab="closed" title="ปิดแล้ว (หมดสิทธิ์/ยกเลิก)" {...tabProps} emptyText="ไม่มียอดที่ปิดแล้ว" />}
      {activeTab === 'bank' && <PaymentBankTab tenantId={tenantId} refreshKey={reloadKey} onReceipt={receiptFromBank} onChanged={reload} />}
      {activeTab === 'settings' && state.isAdmin && (
        <PaymentSettingsTab key={settings?.updated_at ?? 'new'} tenantId={tenantId} settings={settings} departments={state.departments} onSaved={reload} />
      )}

      {sheet?.kind === 'receipt' && (() => {
        const due = freshDue(sheet.due)
        const type = state.types.find(t => t.name === due.type_name && t.category === due.category) ?? null
        return <PaymentReceiptSheet due={due} settings={settings} type={type} today={today} prefill={receiptPrefillOf(sheet.txn)} onClose={closeSheet} onSaved={saved} />
      })()}
      {sheet?.kind === 'cancel' && <PaymentCancelSheet due={freshDue(sheet.due)} onClose={closeSheet} onSaved={saved} />}
    </div>
  )
}
