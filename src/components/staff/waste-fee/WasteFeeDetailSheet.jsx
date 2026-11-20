import { useEffect, useState } from 'react'
import { Leaf, Loader2 } from 'lucide-react'
import { Sheet } from '../../patientTransport/StaffShell'
import { closeAccount, fetchAccountMonth, fetchEvents, friendlyError, reopenAccount, setSorting } from '../../../lib/wasteFeeApi'
import {
  COMPUTE_ERROR_TEXT, CONFIRMER_ROLE_LABEL, EVENT_ACTION_LABEL, confirmerRolesOf, EVENT_DATE_FIELDS, NOT_BILLABLE_TEXT, SORTING_NO_DISCOUNT_TEXT, SORTING_OP_TEXT, UNIT_KG, accountPhase,
  accountStatusLabel, describeEventChanges, fmtUnits, livePeriod, monthStart, pickRateForMonth, placeTypeLabel, validateClose, validateSorting,
} from '../../../lib/wasteFee'
import { addMonths } from '../../../lib/licenceRegistry'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from '../licence/Field'
import { fmtDate, fmtDateTime, fmtMoney, fmtMonth, toMonthInput } from './format'

// ช่องของแถวสรุปยอดหนึ่งเดือน: ยอดที่ควรเก็บ (แยกค่าเก็บขน/ค่ากำจัด/ส่วนลดคัดแยก) + อ้างข้อบัญญัติของรุ่นอัตราที่ใช้
function MonthCard({ title, result }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800">
      <p className="text-xs font-bold text-gray-500">{title}</p>
      {!result && <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={13} className="animate-spin" />กำลังคำนวณ…</p>}
      {result && result.ok === false && <p className="mt-1 text-xs text-amber-800">{COMPUTE_ERROR_TEXT[result.error] ?? 'คำนวณยอดไม่ได้'}</p>}
      {result?.ok && result.billable === false && <p className="mt-1 text-xs text-gray-600">ไม่เก็บ — {NOT_BILLABLE_TEXT[result.reason] ?? result.reason}</p>}
      {result?.ok && result.billable !== false && (
        <div className="mt-1 space-y-0.5">
          <p className="text-lg font-extrabold text-gray-900">{fmtMoney(result.total)} <span className="text-xs font-semibold text-gray-500">บาท</span></p>
          <p className="text-xs text-gray-600">
            {result.basis === 'place_type'
              ? `เหมาตามประเภทสถานที่ (${placeTypeLabel(result.place_type)})`
              : `ค่าเก็บขน ${fmtMoney(result.collect)} + ค่ากำจัด ${fmtMoney(result.dispose)}${Number(result.discount) > 0 ? ` − ลดคัดแยก ${fmtMoney(result.discount)}` : ''}`}
          </p>
          <p className="break-words text-[11px] text-gray-500">อัตราตาม: {result.ordinance_ref} (มีผล {fmtDate(String(result.effective_from).slice(0, 10))})</p>
          {result.is_example && <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">เป็นอัตราตัวอย่าง — ต้องแก้ตามข้อบัญญัติของ อปท. ก่อนใช้จริง</p>}
        </div>
      )}
    </div>
  )
}

const fmtValue = (key, value) => (EVENT_DATE_FIELDS.has(key) ? fmtDate(String(value ?? '').slice(0, 10)) : value)

/**
 * แผ่น "ยอด/ประวัติ" ของบัญชี: ยอดที่ควรเก็บเดือนนี้/เดือนหน้า (จาก wfee_account_month — ดูอย่างเดียว PR1 ยังไม่สร้างยอดค้าง)
 * + ยืนยัน/เลิกการคัดแยกขยะ (ลดค่ากำจัดกึ่งหนึ่ง) + เลิกเก็บ/เปิดเก็บต่อ + ประวัติ (ช่วงที่ได้ลด + การเปลี่ยนแปลงข้อมูล)
 * การลดค่ากำจัดเป็นประโยชน์ของประชาชน: เจ้าหน้าที่เป็นผู้ยืนยันเอง ต้องมีเหตุผล/หลักฐาน
 *   เปิดลด = เริ่มตั้งแต่เดือนนี้เป็นต้นไป (ไม่ย้อนหลัง) · เลิกลด = เดือนแรกที่ไม่ลดต้องเป็นเดือนหน้าเป็นต้นไป (เดือนนี้ยังได้ลด ไม่ตัดย้อน) · ลงประวัติผู้ยืนยัน — ระบบไม่ตัดสินแทน
 * periods = ช่วงที่ได้ลดของบัญชีนี้จาก waste_fee_sorting_periods (อ่านอย่างเดียว)
 */
// canConfirm = ผู้ใช้นี้ยืนยัน/เลิกการคัดแยกได้ตามค่าตั้งของ อปท. (wfee_can_confirm_sorting) — ไม่ได้ = เห็นสถานะแต่ไม่มีปุ่ม
export default function WasteFeeDetailSheet({ tenantId, account, periods, rates, month, canConfirm, settings, onClose, onChanged }) {
  const nextMonth = addMonths(month, 1)
  const [data, setData] = useState(null) // { thisMonth, nextMonth, events }
  const [error, setError] = useState('')
  const [panel, setPanel] = useState(null) // 'sorting-on' | 'sorting-off' | 'close'
  const [sFrom, setSFrom] = useState(month)
  const [notice, setNotice] = useState('')
  const [note, setNote] = useState('')
  const [closeFrom, setCloseFrom] = useState(nextMonth)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const load = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let alive = true
    Promise.all([fetchAccountMonth(account.id, month), fetchAccountMonth(account.id, nextMonth), fetchEvents(account.id)]).then(([a, b, ev]) => {
      if (!alive) return
      const failure = a.error ?? b.error ?? ev.error
      if (failure) setError(friendlyError(failure))
      else setError('')
      setData({ thisMonth: a.result, nextMonth: b.result, events: ev.events })
    })
    return () => { alive = false }
  }, [account.id, account.updated_at, month, nextMonth, reloadKey])

  const phase = accountPhase(account, month)
  const isActive = account.status === 'active'
  const rateNow = pickRateForMonth(rates, month)
  const noDiscountRate = rateNow && !rateNow.sorting_discount
  const live = livePeriod(periods, month) // ช่วงที่ยังมีผลหรือรอเริ่ม
  const liveStarted = Boolean(live) && String(live.starts_on).slice(0, 10) <= month
  const ongoing = liveStarted && !live.ends_on // กำลังลดอยู่และไม่มีกำหนดเลิก — เปิดซ้ำไม่ได้
  const sortedPeriods = [...(periods ?? [])].sort((a, b) => String(b.starts_on).localeCompare(String(a.starts_on)))
  const closePanel = () => { setPanel(null); setNote(''); setError('') }

  async function submitSorting(on) {
    const problem = validateSorting({ on, from: sFrom, note })
    if (problem) { setError(problem); return }
    setBusy(true); setError(''); setNotice('')
    const { result, error: err } = await setSorting({ accountId: account.id, on, from: monthStart(sFrom), note })
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    closePanel(); load(); onChanged()
    const text = SORTING_OP_TEXT[result?.op] ?? 'บันทึกแล้ว'
    // รุ่นอัตราที่มีผลเดือนนั้นไม่มีหมวดลด = ส่วนลดยังไม่เกิดผล (ฐานคืนธงมาให้ ไม่ปล่อยให้เจ้าหน้าที่เข้าใจผิดว่ายอดลดแล้ว)
    setNotice(result?.rate_has_discount === false ? `${text} — ${SORTING_NO_DISCOUNT_TEXT}` : text)
  }

  async function submitClose() {
    const problem = validateClose({ closedFrom: closeFrom, reason: note, serviceFrom: account.service_from })
    if (problem) { setError(problem); return }
    setBusy(true); setError('')
    const { error: err } = await closeAccount(account.id, tenantId, { closedFrom: monthStart(closeFrom), reason: note })
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    closePanel(); load(); onChanged()
  }

  async function reopen() {
    if (!window.confirm('เปิดเก็บต่อ? ระบบล้างเดือนและเหตุผลที่เลิกเก็บ (ประวัติยังเก็บไว้)')) return
    setBusy(true); setError('')
    const { error: err } = await reopenAccount(account.id, tenantId)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    load(); onChanged()
  }

  const units = Number(account.monthly_units)
  return (
    <Sheet title="ยอด/ประวัติ" subtitle={account.payer_name} onClose={onClose} onReload={load} busy={busy} wide>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-700">
        <p><b>{account.payer_name}</b>{account.account_no ? ` · เลขทะเบียน ${account.account_no}` : ''} · {accountStatusLabel(account.status)}{phase === 'pending' ? ' (รอเริ่มเก็บ)' : ''}</p>
        <p>{[account.house_no ? `บ้านเลขที่ ${account.house_no}` : '', account.village, account.address].filter(Boolean).join(' · ') || 'ไม่ระบุที่อยู่'}</p>
        <p>
          {placeTypeLabel(account.place_type)} · ปริมาณ {fmtUnits(units)} หน่วย{units <= 1 ? ` (ไม่เกิน ${UNIT_KG} กก.)` : ` (หน่วยละ ${UNIT_KG} กก.)`}
          · เริ่มเก็บ {fmtMonth(account.service_from)}{account.closed_from ? ` · เลิกเก็บตั้งแต่ ${fmtMonth(account.closed_from)}` : ''}
        </p>
        {account.closed_reason && <p>เหตุผลที่เลิกเก็บ: {account.closed_reason}</p>}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-bold text-gray-800">ยอดที่ควรเก็บ</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <MonthCard title={`เดือนนี้ (${fmtMonth(month)})`} result={data?.thisMonth} />
          <MonthCard title={`เดือนหน้า (${fmtMonth(nextMonth)})`} result={data?.nextMonth} />
        </div>
        <p className="text-[11px] text-gray-500">ยอดที่ระบบคำนวณตามรุ่นอัตราที่มีผลกับเดือนนั้น เพื่อให้เจ้าหน้าที่ตรวจ — ขั้นนี้ยังไม่สร้างยอดค้างหรือใบแจ้งหนี้</p>
      </section>

      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-800"><Leaf size={15} className="text-emerald-600" />การคัดแยกขยะ (ลดค่ากำจัดกึ่งหนึ่ง)</h4>
        {notice && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{notice}</p>}
        {live ? (
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900">
            {liveStarted ? `ได้ลดค่ากำจัดตั้งแต่เดือน ${fmtMonth(live.starts_on)}` : `จะเริ่มลดค่ากำจัดตั้งแต่เดือน ${fmtMonth(live.starts_on)} (ยังไม่เริ่ม)`}
            {live.ends_on ? ` · กำหนดเลิกลดตั้งแต่เดือน ${fmtMonth(live.ends_on)}` : ''}
            {live.note ? ` · เหตุผล/หลักฐาน: ${live.note}` : ''}
          </p>
        ) : <p className="text-xs text-gray-600">บัญชีนี้ยังไม่ได้รับการลดค่ากำจัด</p>}
        {noDiscountRate && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">รุ่นอัตราที่ใช้อยู่ตอนนี้ไม่มีหมวดลดค่ากำจัดเมื่อคัดแยก — การยืนยันจะถูกบันทึกไว้ แต่ยังไม่ลดยอดจนกว่ารุ่นอัตราจะมีหมวดนี้</p>}
        {isActive && !canConfirm && (
          <p className="text-[11px] text-gray-500">
            ผู้ยืนยันการคัดแยกของ อปท. นี้: {confirmerRolesOf(settings).map(r => CONFIRMER_ROLE_LABEL[r] ?? r).join(' · ')} (ตั้งที่แท็บ "ตั้งค่า")
          </p>
        )}
        {isActive && canConfirm && panel === null && (
          <div className="flex flex-wrap gap-2">
            {!ongoing && (
              <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} disabled={busy} onClick={() => { setError(''); setNotice(''); setNote(''); setSFrom(month); setPanel('sorting-on') }}>
                {live?.ends_on ? 'ยกเลิกกำหนดเลิกลด (ให้ลดต่อ)' : live ? 'เปลี่ยนเดือนเริ่มลด' : 'ยืนยันการคัดแยกขยะ'}
              </button>
            )}
            {live && (
              <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} disabled={busy} onClick={() => { setError(''); setNotice(''); setNote(''); setSFrom(nextMonth); setPanel('sorting-off') }}>
                {liveStarted ? 'เลิกลดค่ากำจัด' : 'ยกเลิกการลดที่ยังไม่เริ่ม'}
              </button>
            )}
          </div>
        )}
        {!isActive && <p className="text-[11px] text-gray-500">บัญชีที่เลิกเก็บแล้ว เปิดการลดไม่ได้</p>}
        {panel === 'sorting-on' && (
          <div className="space-y-2 rounded-xl border border-gray-200 p-3">
            <Field label="ได้รับการลดตั้งแต่เดือน" required hint={`เลือกได้ตั้งแต่เดือนนี้ (${fmtMonth(month)}) เป็นต้นไป — ไม่ย้อนหลัง · ล่วงหน้าได้ไม่เกิน 12 เดือน`}>
              <input type="month" className={`${inp} sm:max-w-xs`} min={toMonthInput(month)} value={toMonthInput(sFrom)} onChange={e => setSFrom(monthStart(e.target.value) ?? '')} />
            </Field>
            {settings?.sorting_delegation_ref && <p className="text-[11px] text-gray-600">ยืนยันตามคำสั่งมอบหมาย: {settings.sorting_delegation_ref} (บันทึกคู่กับการยืนยันนี้)</p>}
            <Field label="เหตุผล/หลักฐานการคัดแยก" required hint="เช่น ตรวจหน้างานเมื่อไร โดยใคร พบว่าคัดแยกครบตามประเภทที่ อปท. กำหนด — บันทึกในประวัติถาวร ห้ามใส่เลขบัตรประชาชน">
              <textarea className={inp} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={() => submitSorting(true)}>{busy && <Loader2 size={15} className="animate-spin" />}ยืนยัน</button>
              <button type="button" className={btnGhost} disabled={busy} onClick={closePanel}>ไม่ยืนยัน</button>
            </div>
          </div>
        )}
        {panel === 'sorting-off' && (
          <div className="space-y-2 rounded-xl border border-gray-200 p-3">
            <Field label="เดือนแรกที่ไม่ลดแล้ว" required hint={`เลือกได้ตั้งแต่เดือนหน้า (${fmtMonth(nextMonth)}) เป็นต้นไป — เดือนนี้ยังได้ลด ไม่ตัดย้อนหลัง`}>
              <input type="month" className={`${inp} sm:max-w-xs`} min={toMonthInput(nextMonth)} value={toMonthInput(sFrom)} onChange={e => setSFrom(monthStart(e.target.value) ?? '')} />
            </Field>
            <Field label="เหตุผลที่เลิกลด" required><textarea className={inp} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></Field>
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={() => submitSorting(false)}>{busy && <Loader2 size={15} className="animate-spin" />}ยืนยันเลิกลด</button>
              <button type="button" className={btnGhost} disabled={busy} onClick={closePanel}>ไม่เลิก</button>
            </div>
          </div>
        )}
        {sortedPeriods.length > 0 && (
          <ul className="space-y-1.5">
            {sortedPeriods.map(p => (
              <li key={p.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
                <p className="font-semibold text-gray-900">ลดค่ากำจัด {fmtMonth(p.starts_on)} – {p.ends_on ? `ก่อนเดือน ${fmtMonth(p.ends_on)}` : 'ยังลดอยู่'}</p>
                <p className="break-words text-gray-600">ยืนยัน {fmtDateTime(p.confirmed_at)}{p.note ? ` · เหตุผล/หลักฐาน: ${p.note}` : ''}</p>
                {p.ended_at && <p className="break-words text-gray-600">กำหนดเลิก {fmtDateTime(p.ended_at)}{p.end_note ? ` · เหตุผล: ${p.end_note}` : ''}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-bold text-gray-800">เลิกเก็บค่าธรรมเนียม</h4>
        {isActive && panel === null && <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} disabled={busy} onClick={() => { setError(''); setNote(''); setCloseFrom(nextMonth); setPanel('close') }}>เลิกเก็บ</button>}
        {!isActive && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-gray-600">เลิกเก็บตั้งแต่เดือน {fmtMonth(account.closed_from)}</p>
            <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} disabled={busy} onClick={reopen}>เปิดเก็บต่อ (กดเลิกเก็บผิด)</button>
          </div>
        )}
        {panel === 'close' && (
          <div className="space-y-2 rounded-xl border border-gray-200 p-3">
            <Field label="เดือนแรกที่ไม่เก็บแล้ว" required hint={`ต้องหลังเดือนที่เริ่มเก็บ (${fmtMonth(account.service_from)}) · เดือนก่อนหน้านั้นยังเก็บตามปกติ`}>
              <input type="month" className={`${inp} sm:max-w-xs`} value={toMonthInput(closeFrom)} onChange={e => setCloseFrom(monthStart(e.target.value) ?? '')} />
            </Field>
            <Field label="เหตุผลที่เลิกเก็บ" required hint="เช่น ย้ายออก รื้อถอน เลิกกิจการ"><textarea className={inp} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></Field>
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={busy} onClick={submitClose}>{busy && <Loader2 size={15} className="animate-spin" />}ยืนยันเลิกเก็บ</button>
              <button type="button" className={btnGhost} disabled={busy} onClick={closePanel}>ไม่เลิก</button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-bold text-gray-800">ประวัติการเปลี่ยนแปลง{data ? ` (${data.events.length})` : ''}</h4>
        {!data && !error && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" />กำลังโหลด…</p>}
        <ul className="space-y-2">
          {(data?.events ?? []).map(ev => (
            <li key={ev.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
              <p className="font-semibold text-gray-900">{EVENT_ACTION_LABEL[ev.action] ?? ev.action} <span className="font-normal text-gray-500">· {fmtDateTime(ev.created_at)}</span></p>
              {ev.reason && <p>เหตุผล: {ev.reason}</p>}
              {describeEventChanges(ev.action, ev.changes, fmtValue).map((line, i) => <p key={i} className="break-words text-gray-600">{line}</p>)}
            </li>
          ))}
        </ul>
      </section>
    </Sheet>
  )
}
