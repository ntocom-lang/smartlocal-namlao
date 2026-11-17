import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { fetchHistory, friendlyError, voidFee } from '../../../lib/licenceRegistryApi'
import { EVENT_ACTION_LABEL, describeEventChanges } from '../../../lib/licenceRegistry'
import { btnGhost, inp } from '../construction/uiStyles'
import { fmtDate, fmtDateTime, fmtMoney } from './format'

const KIND_LABEL = { renewal: 'ต่ออายุ', annual: 'ค่าธรรมเนียมรายปี' }
const DATE_KEYS = new Set(['issued_on', 'expires_on', 'next_fee_due_on', 'status_from', 'status_until'])

/**
 * ประวัติต่อใบ: รายการรับค่าธรรมเนียม + ประวัติการเปลี่ยนแปลง (licence_events)
 * ยกเลิกรายการรับเงินได้เฉพาะ "รายการล่าสุดที่ยังไม่ถูกยกเลิก" ต้องมีเหตุผล — ระบบย้อนวันหมดอายุ/วันครบกำหนดกลับให้ (RPC ตรวจซ้ำ)
 */
export default function LicenceHistorySheet({ row, types, onClose, onChanged }) {
  const { licence } = row
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const [reloadKey, setReloadKey] = useState(0)
  const load = () => setReloadKey(k => k + 1)
  useEffect(() => {
    let alive = true
    fetchHistory(licence.id).then(r => {
      if (!alive) return
      if (r.error) setError(friendlyError(r.error))
      else { setError(''); setData(r) }
    })
    return () => { alive = false }
  }, [licence.id, reloadKey])

  const typeName = id => types.find(t => t.id === id)?.name ?? id
  const fmtValue = (key, value) => (DATE_KEYS.has(key) ? fmtDate(value) : key === 'licence_type_id' ? typeName(value) : value)
  const latest = data?.payments.find(p => !p.voided_at) ?? null

  async function doVoid() {
    if (reason.trim().length < 3) { setError('ต้องระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)'); return }
    setBusy(true); setError('')
    const { error: err } = await voidFee({ paymentId: latest.id, reason })
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    setVoiding(false); setReason('')
    load()
    onChanged()
  }

  return (
    <Sheet title="ประวัติ" subtitle={licence.business_name} onClose={onClose} onReload={load} busy={busy} wide>
      {!data && !error && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" />กำลังโหลด…</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data && (
        <>
          <section className="space-y-2">
            <h4 className="text-sm font-bold text-gray-800">การรับค่าธรรมเนียม ({data.payments.length})</h4>
            {data.payments.length === 0 && <p className="text-sm text-gray-500">ยังไม่มีรายการรับค่าธรรมเนียม</p>}
            <ul className="space-y-2">
              {data.payments.map(p => (
                <li key={p.id} className={`rounded-xl border px-3 py-2.5 text-sm ${p.voided_at ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-gray-200 bg-white text-gray-800'}`}>
                  <p className="font-semibold">
                    {KIND_LABEL[p.kind] ?? p.kind} · ใบเสร็จ {p.receipt_no}
                    {p.voided_at && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-bold text-gray-600">ยกเลิกแล้ว</span>}
                  </p>
                  <p className="text-xs">
                    ชำระ {fmtDate(p.paid_on)} · {fmtMoney(p.amount)} บาท{Number(p.surcharge) > 0 ? ` + ค่าปรับ ${fmtMoney(p.surcharge)} บาท` : ''} · รอบ {fmtDate(p.period_from)} – {fmtDate(p.period_to)}
                  </p>
                  {p.voided_at && <p className="text-xs">ยกเลิก {fmtDateTime(p.voided_at)} — {p.void_reason}</p>}
                  {latest?.id === p.id && !voiding && (
                    <button type="button" className={`${btnGhost} mt-2 min-h-9 px-2.5 text-xs`} onClick={() => setVoiding(true)}>ยกเลิกรายการนี้ (บันทึกผิด)</button>
                  )}
                  {latest?.id === p.id && voiding && (
                    <div className="mt-2 space-y-2">
                      <textarea className={inp} rows={2} maxLength={1000} placeholder="เหตุผลที่ยกเลิก (จำเป็น)" value={reason} onChange={e => setReason(e.target.value)} />
                      <p className="text-[11px] text-gray-600">ระบบจะย้อนวันหมดอายุ/วันครบกำหนดกลับเป็นค่าก่อนรับเงินรายการนี้</p>
                      <div className="flex gap-2">
                        <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs !border-red-300 text-red-700`} disabled={busy} onClick={doVoid}>ยืนยันยกเลิกรายการ</button>
                        <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} onClick={() => { setVoiding(false); setReason('') }}>ไม่ยกเลิก</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-bold text-gray-800">ประวัติการเปลี่ยนแปลง ({data.events.length})</h4>
            <ul className="space-y-2">
              {data.events.map(ev => (
                <li key={ev.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
                  <p className="font-semibold text-gray-900">{EVENT_ACTION_LABEL[ev.action] ?? ev.action} <span className="font-normal text-gray-500">· {fmtDateTime(ev.created_at)}</span></p>
                  {ev.reason && <p>เหตุผล: {ev.reason}</p>}
                  {describeEventChanges(ev.action, ev.changes, fmtValue).map((line, i) => <p key={i} className="break-words text-gray-600">{line}</p>)}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </Sheet>
  )
}
