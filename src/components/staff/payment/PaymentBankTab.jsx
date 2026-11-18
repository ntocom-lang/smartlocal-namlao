import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, Receipt, Undo2, Upload } from 'lucide-react'
import { ListCard, Pager, Pills, Sheet } from '../../patientTransport/StaffShell'
import { paginate } from '../../../lib/patientBooking'
import {
  BANK_FILTERS, BANK_METHOD_LABEL, MATCH_MODE_TEXT, channelLabel, dailyBankSummary, formatRef1, kindLabel, searchBankTxns, sumBankAmount,
} from '../../../lib/paymentDues'
import {
  friendlyError, listBankTxns, markBankTxnNotOurs, matchBankTxn, resetBankTxn,
} from '../../../lib/paymentDuesApi'
import { btnGhost, btnPrimary, inp } from '../construction/uiStyles'
import Field from '../licence/Field'
import { fmtDate, fmtMoney } from '../licence/format'
import PaymentBankImportSheet from './PaymentBankImportSheet'

const small = `${btnGhost} min-h-9 px-2.5 text-xs`
const PILL_COLOR = { unmatched: '#d97706', matched: '#2563eb', receipted: '#059669', not_ours: '#94a3b8' }

const bangkokTime = value => {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return t === '00:00' ? '' : t // ไฟล์ที่ไม่มีเวลา = เที่ยงคืนตามที่นำเข้า ไม่แสดงเวลาลวง
}

// แผ่นกรอกเหตุผล (3–1000 ตัวอักษร) ใช้ร่วมกัน: ไม่ใช่เงินของระบบนี้ / ยกเลิกคู่ / ถอนการระบุ
function ReasonSheet({ title, subtitle, note, label, confirmLabel, danger, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    const text = reason.trim()
    if (text.length < 3) { setError('ต้องระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)'); return }
    setBusy(true); setError('')
    const message = await onConfirm(text)
    setBusy(false)
    if (message) setError(message)
  }
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose} busy={busy}>
      <div className="space-y-3">
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">{note}</p>
        <Field label={label} required>
          <textarea className={`${inp} min-h-24`} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={btnPrimary} style={{ backgroundColor: danger ? '#b91c1c' : 'var(--color-primary)' }} disabled={busy} onClick={save}>
            {busy && <Loader2 size={15} className="animate-spin" />}{confirmLabel}
          </button>
          <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>ปิด</button>
        </div>
      </div>
    </Sheet>
  )
}

const money = n => `${fmtMoney(n)} บาท`
// ไม่มี Ref1 ในแถว: ธง ref1_foreign (ถ้าฐานส่งมา) = ไฟล์มี Ref1 แต่ไม่ใช่ของระบบนี้ (ฐานไม่เก็บค่าไว้ — อาจเป็นเลขของบริการอื่น)
const refMissingText = txn => (txn.ref1_foreign === true ? 'Ref1 ของบริการอื่น' : 'ไม่มี Ref1')

// สรุปเงินเข้ารายวัน (แทนรายงานกระทบยอดประจำวัน — ใบพิมพ์ทำทีหลัง): ยอดจากไฟล์ แยกจับคู่แล้ว/ยังระบุไม่ได้
function DailySummary({ rows, truncated }) {
  const days = useMemo(() => dailyBankSummary(rows), [rows])
  const [open, setOpen] = useState(false)
  if (days.length === 0) return null
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-bold text-gray-800">
        <span>สรุปเงินเข้ารายวัน (จากไฟล์ธนาคาร)</span>
        <span className="text-xs font-semibold text-gray-500">{open ? 'ซ่อน ▴' : 'แสดง ▾'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-2">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="text-left text-xs font-bold text-gray-600">
                <tr><th className="py-2 pr-3">วันที่เงินเข้า</th><th className="px-3 py-2 text-right">เงินเข้าทั้งหมด</th><th className="px-3 py-2 text-right">จับคู่แล้ว</th><th className="px-3 py-2 text-right">ยังระบุไม่ได้</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {days.map(d => (
                  <tr key={d.date}>
                    <td className="py-2 pr-3 text-gray-800">{fmtDate(d.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.total.n} รายการ · {money(d.total.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-800">{d.matched.n} รายการ · {money(d.matched.amount)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${d.unmatched.n > 0 ? 'font-bold text-amber-700' : 'text-gray-400'}`}>{d.unmatched.n} รายการ · {money(d.unmatched.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-gray-100 md:hidden">
            {days.map(d => (
              <li key={d.date} className="space-y-0.5 py-2 text-xs">
                <p className="text-sm font-semibold text-gray-900">{fmtDate(d.date)} · {d.total.n} รายการ · {money(d.total.amount)}</p>
                <p className="text-blue-800">จับคู่แล้ว {d.matched.n} รายการ · {money(d.matched.amount)}</p>
                <p className={d.unmatched.n > 0 ? 'font-bold text-amber-700' : 'text-gray-400'}>ยังระบุไม่ได้ {d.unmatched.n} รายการ · {money(d.unmatched.amount)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            แสดง 14 วันล่าสุดที่มีเงินเข้า · ไม่รวมรายการที่ระบุว่าไม่ใช่เงินของระบบนี้ · ตัวเลขนี้คือเงินเข้าตามไฟล์ธนาคารที่นำเข้า ใช้เทียบกับรายงานประจำวันของ e-LAAS
            {truncated && ' · มีรายการมากกว่าที่โหลด สรุปนี้นับเฉพาะรายการล่าสุดที่โหลดมา'}
          </p>
        </div>
      )}
    </div>
  )
}

// ป้ายเตือนที่ใช้กับทุกสถานะ: ไฟล์บัญชีที่วัน+ยอดตรงกับรายการจากรายงาน Bill Payment อาจเป็นเงินก้อนเดียวกันที่นับสองครั้ง (ฐานติดธง maybe_duplicate)
function DuplicateFlag({ txn }) {
  if (txn.maybe_duplicate !== true) return null
  return <p className="flex items-start gap-1.5 rounded-lg bg-orange-50 px-2 py-1.5 text-xs font-semibold text-orange-900"><Info size={13} className="mt-0.5 shrink-0" />อาจซ้ำกับรายงาน Bill Payment — วันและยอดตรงกับรายการจากรายงานนั้น ตรวจก่อนยืนยันคู่ ไม่งั้นนับเงินก้อนเดียวสองครั้ง</p>
}

// การ์ดคู่ที่เสนอ: ต้องเห็นเลขใบอนุญาต ชื่อร้าน วันครบกำหนด ยอด ก่อนกดยืนยัน (พร้อมเพย์ไม่มี Ref1 ระบบเสนอจากยอดเท่ากัน — กันกดผิดคน)
// mode บอกว่ากดแล้วจะเกิดอะไร: open ผูกคู่รอเลขใบเสร็จ · reopen เปิดยอดที่ปิดไปแล้วกลับ · evidence ผูกเป็นหลักฐานของรายการที่บันทึกเลขใบเสร็จแล้ว
function Candidate({ txn, c, suggested, busyId, onConfirm }) {
  const mode = MATCH_MODE_TEXT[c.mode] ?? MATCH_MODE_TEXT.open
  return (
    <li className={`space-y-1 rounded-lg border px-2 py-1.5 ${suggested ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {suggested && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">ระบบเสนอ</span>}
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${c.mode === 'evidence' ? 'bg-emerald-100 text-emerald-900' : c.mode === 'reopen' || c.mode === 'evidence_unknown' ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'}`}>{mode.badge}</span>
      </div>
      <p className="break-words text-sm font-semibold text-gray-900">{c.business_name}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-gray-700">
        <dt className="text-gray-500">เลขใบอนุญาต</dt><dd className="break-words font-semibold">{c.licence_no ?? '—'}</dd>
        <dt className="text-gray-500">ประเภทยอด</dt><dd>{kindLabel(c.kind)}</dd>
        <dt className="text-gray-500">ครบกำหนด</dt><dd>{fmtDate(c.due_on)}</dd>
        <dt className="text-gray-500">ยอด</dt><dd>{fmtMoney(c.amount)} บาท</dd>
        <dt className="text-gray-500">Ref1</dt><dd className="font-mono">{formatRef1(c.ref1)}</dd>
        {Number(c.surcharge_in_txn) > 0 && <><dt className="text-gray-500">ค่าปรับในเงินเข้า</dt><dd>{fmtMoney(c.surcharge_in_txn)} บาท (ชำระรายปีช้า 20%)</dd></>}
        {(c.mode === 'evidence' || c.mode === 'evidence_unknown') && <>
          <dt className="text-gray-500">ใบเสร็จ</dt><dd>{c.receipt_no ?? '—'}</dd>
          <dt className="text-gray-500">บันทึกรับ</dt><dd>{fmtDate(c.paid_on)} · {c.paid_channel ? channelLabel(c.paid_channel) : 'ไม่ทราบช่องทาง'}</dd>
        </>}
      </dl>
      <p className="text-gray-600">{mode.detail}</p>
      <button type="button" className={`${small} ${suggested ? '!border-transparent !bg-blue-600 !text-white hover:!bg-blue-700' : ''}`} disabled={Boolean(busyId)} onClick={() => onConfirm(txn, c)}>
        {busyId === txn.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}ยืนยันคู่
      </button>
    </li>
  )
}

// ผลจับคู่/คู่ที่เสนอ ของแถว — ไม่มีชื่อผู้โอน (ระบบไม่เก็บ) มีแต่ชื่อร้าน/เลขใบของยอดค้างที่เสนอหรือผูกอยู่
function TxnMatch({ txn, busyId, onConfirm }) {
  if (txn.status === 'unmatched') {
    const candidates = txn.candidates ?? []
    return (
      <div className="space-y-1.5 text-xs">
        <DuplicateFlag txn={txn} />
        {txn.hint && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 font-semibold text-amber-900"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{txn.hint}</p>}
        {candidates.length === 0 ? (
          <p className="text-gray-600">ไม่พบยอดที่จำนวนเงินเท่ากัน — ยังระบุไม่ได้ว่าเป็นเงินของรายการใด (ตรวจกับผู้ชำระหรือธนาคารก่อน หรือระบุว่าไม่ใช่เงินของระบบนี้)</p>
        ) : (
          <>
            <p className="font-semibold text-gray-700">{candidates.length > 1 && !txn.suggested_due_id ? `มี ${candidates.length} ยอดที่จำนวนเงินเท่ากัน — เลือกยอดที่ถูกต้อง` : 'ยอดที่จำนวนเงินเท่ากัน — ตรวจชื่อร้านและเลขใบให้ตรงกับผู้ชำระก่อนกดยืนยัน'}</p>
            <ul className="space-y-1.5">
              {candidates.map(c => <Candidate key={c.id} txn={txn} c={c} suggested={txn.suggested_due_id === c.id} busyId={busyId} onConfirm={onConfirm} />)}
            </ul>
          </>
        )}
      </div>
    )
  }
  if (txn.status === 'not_ours') return <div className="space-y-1.5"><DuplicateFlag txn={txn} /><p className="break-words text-xs text-gray-700"><span className="font-semibold">เหตุผล:</span> {txn.note ?? '—'}</p></div>
  const due = txn.due
  return (
    <div className="space-y-1.5 text-xs">
      {txn.blocked_reason && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 font-bold text-red-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" />บันทึกเลขใบเสร็จไม่ได้แล้ว — {txn.blocked_reason}</p>
      )}
      <DuplicateFlag txn={txn} />
      <div>
        <p className="break-words font-semibold text-gray-900">{due?.business_name ?? '—'}</p>
        <p className="break-words text-gray-600">{due?.licence_no ?? '—'} · {kindLabel(due?.kind)} · Ref1 {formatRef1(due?.ref1)}</p>
        <p className="text-gray-500">{BANK_METHOD_LABEL[txn.match_method] ?? 'จับคู่แล้ว'}{txn.status === 'receipted' && due?.receipt_no ? ` · ใบเสร็จ ${due.receipt_no}` : ''}</p>
      </div>
    </div>
  )
}

function TxnActions({ txn, busyId, onReceipt, onReset, onNotOurs }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {txn.status === 'unmatched' && <button type="button" className={small} disabled={Boolean(busyId)} onClick={() => onNotOurs(txn)}>ไม่ใช่เงินของระบบนี้</button>}
      {txn.status === 'matched' && (
        <>
          {/* บันทึกเลขใบเสร็จไม่ได้แล้ว (blocked_reason) = ปิดปุ่ม เหลือทางเดียวคือยกเลิกคู่ */}
          <button type="button" className={`${small} !border-transparent !bg-emerald-600 !text-white hover:!bg-emerald-700`} disabled={Boolean(busyId) || Boolean(txn.blocked_reason)} onClick={() => onReceipt(txn)}><Receipt size={14} />กรอกเลขใบเสร็จ</button>
          <button type="button" className={txn.blocked_reason ? `${small} !border-red-300 !bg-red-50 !text-red-800` : small} disabled={Boolean(busyId)} onClick={() => onReset(txn)}><Undo2 size={14} />ยกเลิกคู่</button>
        </>
      )}
      {txn.status === 'not_ours' && <button type="button" className={small} disabled={Boolean(busyId)} onClick={() => onReset(txn)}><Undo2 size={14} />ถอนการระบุ</button>}
    </div>
  )
}

/**
 * แท็บ "เงินเข้าจากธนาคาร" — นำเข้าไฟล์ธนาคาร · ดูรายการเงินเข้าตามสถานะ · ยืนยันคู่ · ระบุว่าไม่ใช่เงินของระบบนี้ · ไปกรอกเลขใบเสร็จ
 * ระบบจับคู่เองเฉพาะ Bill Payment ที่ Ref1 และยอดตรง · พร้อมเพย์/โอน ระบบเสนอ คนกดยืนยัน · ยอดยังรอชำระจนกรอกเลขใบเสร็จ (ระบบไม่ออกใบเสร็จ)
 * ไม่มีชื่อ/เลขบัญชีผู้โอน (ระบบไม่เก็บ) · โหลดแยกต่อสถานะ เพราะฐานตัดที่ 2,000 แถวต่อครั้ง — รายการที่ยังระบุไม่ได้ต้องไม่หลุดเพราะรายการใหม่ของสถานะอื่น
 * onReceipt(txn) = เปิดแผ่นบันทึกเลขใบเสร็จ (เจ้าของแท็บเป็นผู้ถือรายการยอด) · onChanged = ให้เมนูโหลดยอด/ป้ายเงินเข้าใหม่ (แล้วเลื่อน refreshKey ให้แท็บนี้โหลดตาม)
 */
export default function PaymentBankTab({ tenantId, refreshKey = 0, onReceipt, onChanged }) {
  const [data, setData] = useState(null) // { byStatus: { [status]: { rows, total, truncated } } }
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('unmatched')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState('')
  const [info, setInfo] = useState('') // ผลสำเร็จที่ไม่ต้องทำต่อ (ผูกเป็นหลักฐาน)
  const [sheet, setSheet] = useState(null) // { kind: 'import'|'not_ours'|'reset'|'after_match', txn }
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const results = await Promise.all(BANK_FILTERS.map(f => listBankTxns(tenantId, f.id)))
      if (!alive) return
      const failure = results.find(r => r.error)?.error
      setError(failure ? friendlyError(failure) : '')
      setData({ byStatus: Object.fromEntries(BANK_FILTERS.map((f, i) => [f.id, { rows: results[i].rows, total: results[i].total, truncated: results[i].truncated }])) })
    })()
    return () => { alive = false }
  }, [tenantId, reloadKey, refreshKey])

  // เจ้าของแท็บ (เมนู) โหลดซ้ำแล้วเลื่อน refreshKey ให้แท็บนี้โหลดตาม · ไม่มีเจ้าของ = โหลดเอง
  const changed = useCallback(() => { if (onChanged) onChanged(); else reload() }, [reload, onChanged])

  const current = data?.byStatus?.[filter]
  const allRows = useMemo(() => (data ? BANK_FILTERS.flatMap(f => data.byStatus[f.id].rows) : []), [data])
  const anyTruncated = data ? BANK_FILTERS.some(f => data.byStatus[f.id].truncated) : false
  const shown = useMemo(() => searchBankTxns(current?.rows ?? [], search), [current, search])
  const paged = paginate(shown.map(r => ({ size: 1, r })), perPage, page)
  const unmatched = data?.byStatus.unmatched
  const oldestUnmatched = useMemo(() => (unmatched?.rows ?? []).reduce((min, r) => (!min || r.txn_date < min ? r.txn_date : min), null), [unmatched])

  async function confirmMatch(txn, candidate) {
    setBusyId(txn.id); setNotice(''); setInfo('')
    const { result, error: err } = await matchBankTxn(txn.id, candidate.id)
    setBusyId(null)
    if (err) { setNotice(friendlyError(err)); return }
    changed()
    // mode evidence → ฐานคืน status 'receipted' (ผูกเป็นหลักฐานของรายการที่บันทึกเลขใบเสร็จแล้ว) = ไม่ต้องถามกรอกเลขใบเสร็จต่อ
    if (result?.status === 'receipted') {
      setInfo(`ผูกเงินเข้าเป็นหลักฐานของรายการที่บันทึกเลขใบเสร็จแล้ว (${candidate.business_name}) — ไม่ใช่เงินซ้ำ ไม่ต้องกรอกเลขใบเสร็จอีก`)
      return
    }
    // ผูกคู่รอเลขใบเสร็จ (open / reopen) — ถามต่อทันทีว่าจะกรอกเลขใบเสร็จเลยไหม (ลดขั้นตอน) ยอดยังรอชำระจนกว่าจะกรอก
    setSheet({ kind: 'after_match', mode: result?.mode ?? candidate.mode, txn: { ...txn, status: 'matched', txn_date: result?.paid_on ?? txn.txn_date, amount: result?.amount ?? txn.amount, due: { id: candidate.id, ...candidate } }, candidate })
  }

  const header = (
    <>
      {data && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className={`rounded-xl border px-3 py-2.5 text-sm ${unmatched?.total ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-gray-200 bg-white text-gray-700'}`}>
            <p className="text-xs font-semibold">เงินเข้าที่ยังระบุไม่ได้</p>
            <p className="text-lg font-bold tabular-nums">{Number(unmatched?.total ?? 0).toLocaleString('th-TH')} รายการ{unmatched?.rows?.length ? ` · ${money(sumBankAmount(unmatched.rows))}` : ''}</p>
            {oldestUnmatched && <p className="text-xs">เก่าสุดเข้าเมื่อ {fmtDate(oldestUnmatched)}</p>}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700">
            <p className="text-xs font-semibold">จับคู่แล้ว รอเลขใบเสร็จ</p>
            <p className="text-lg font-bold tabular-nums">{Number(data.byStatus.matched.total).toLocaleString('th-TH')} รายการ{data.byStatus.matched.rows.length ? ` · ${money(sumBankAmount(data.byStatus.matched.rows))}` : ''}</p>
            <p className="text-xs text-gray-500">ยอดยังรอชำระจนกว่าจะกรอกเลขใบเสร็จ (e-LAAS)</p>
          </div>
        </div>
      )}
    </>
  )

  if (!data) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500"><Loader2 className="animate-spin" size={18} />กำลังโหลดรายการเงินเข้า…</div>

  const activeInfo = BANK_FILTERS.find(f => f.id === filter)

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</p>}
      {info && <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{info}</p>}
      {notice && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{notice}</p>}
      {anyTruncated && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Info size={16} className="mt-0.5 shrink-0" />
          มีรายการมากกว่าที่แสดง — แต่ละตัวกรองแสดงล่าสุดไม่เกิน 2,000 รายการ (รายการเก่าสุดของตัวกรองนั้นไม่ได้แสดง) ใช้ช่องค้นหาหรือนำเข้าไฟล์เป็นช่วงวันที่สั้นลง
        </p>
      )}
      {header}
      <DailySummary rows={allRows} truncated={anyTruncated} />

      <ListCard title="เงินเข้าจากธนาคาร" count={shown.length} search={search} onSearch={value => { setSearch(value); setPage(1) }} searchLabel="ค้นหายอด Ref1 เลขอ้างอิง หรือชื่อร้าน"
        action={(
          <>
            <button type="button" className={btnGhost} onClick={reload} aria-label="โหลดรายการใหม่"><RefreshCw size={15} /></button>
            <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={() => setSheet({ kind: 'import' })}><Upload size={16} />นำเข้าไฟล์ธนาคาร</button>
          </>
        )}
        pills={(
          <div className="space-y-1.5">
            <Pills value={filter} onChange={id => { setFilter(id); setPage(1) }} label="กรองสถานะเงินเข้า"
              items={BANK_FILTERS.map(f => ({ id: f.id, label: f.label, count: data.byStatus[f.id].total, color: PILL_COLOR[f.id] }))} />
            <p className="text-xs text-gray-500">{activeInfo?.hint}</p>
          </div>
        )}>
        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            {current?.rows?.length ? 'ไม่พบรายการตามคำค้น' : filter === 'unmatched' ? 'ไม่มีเงินเข้าที่ยังระบุไม่ได้ — นำเข้าไฟล์ธนาคารเมื่อมีรายการใหม่' : 'ไม่มีรายการในตัวกรองนี้'}
          </p>
        ) : (
          <div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[940px] border-collapse text-sm">
                <thead className="bg-gray-50 text-left text-xs font-bold text-gray-600">
                  <tr>
                    <th className="px-3 py-2.5">วันที่เงินเข้า</th>
                    <th className="px-3 py-2.5 text-right">ยอด (บาท)</th>
                    <th className="px-3 py-2.5">เลขอ้างอิง</th>
                    <th className="px-3 py-2.5">{filter === 'unmatched' ? 'คู่ที่เสนอ' : filter === 'not_ours' ? 'เหตุผล' : 'คู่ของยอดค้าง'}</th>
                    <th className="sticky right-0 bg-gray-50 px-3 py-2.5 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paged.units.map(({ r }) => (
                    <tr key={r.id} className="align-top hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-3 text-gray-800">{fmtDate(r.txn_date)}{bangkokTime(r.txn_at) && <span className="block text-xs text-gray-500">{bangkokTime(r.txn_at)} น.</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">{fmtMoney(r.amount)}</td>
                      <td className="px-3 py-3 font-mono text-xs text-gray-700">
                        {r.ref1 ? <span className="block">Ref1 {formatRef1(r.ref1)}</span> : <span className="block text-gray-400">{refMissingText(r)}</span>}
                        {r.ref2 && <span className="block">Ref2 {r.ref2}</span>}
                        {r.bank_ref && <span className="block break-all text-gray-500">{r.bank_ref}</span>}
                      </td>
                      <td className="px-3 py-3"><TxnMatch txn={r} busyId={busyId} onConfirm={confirmMatch} /></td>
                      <td className="sticky right-0 bg-white px-3 py-3 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]">
                        <TxnActions txn={r} busyId={busyId} onReceipt={onReceipt} onReset={txn => setSheet({ kind: 'reset', txn })} onNotOurs={txn => setSheet({ kind: 'not_ours', txn })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-gray-100 md:hidden">
              {paged.units.map(({ r }) => (
                <li key={r.id} className="space-y-2 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">{fmtDate(r.txn_date)}{bangkokTime(r.txn_at) ? ` ${bangkokTime(r.txn_at)} น.` : ''} · {money(r.amount)}</p>
                  <p className="break-all font-mono text-xs text-gray-600">{r.ref1 ? `Ref1 ${formatRef1(r.ref1)}` : refMissingText(r)}{r.ref2 ? ` · Ref2 ${r.ref2}` : ''}{r.bank_ref ? ` · ${r.bank_ref}` : ''}</p>
                  <TxnMatch txn={r} busyId={busyId} onConfirm={confirmMatch} />
                  <TxnActions txn={r} busyId={busyId} onReceipt={onReceipt} onReset={txn => setSheet({ kind: 'reset', txn })} onNotOurs={txn => setSheet({ kind: 'not_ours', txn })} />
                </li>
              ))}
            </ul>
            <div className="px-4 pb-4 sm:px-5">
              <Pager total={paged.total} from={paged.from} to={paged.to} page={paged.page} pages={paged.pages} perPage={perPage}
                onPage={setPage} onPerPage={value => { setPerPage(value); setPage(1) }} />
            </div>
          </div>
        )}
      </ListCard>

      {sheet?.kind === 'import' && <PaymentBankImportSheet tenantId={tenantId} onClose={() => setSheet(null)} onDone={changed} />}
      {sheet?.kind === 'not_ours' && (
        <ReasonSheet title="ไม่ใช่เงินของระบบนี้" subtitle={`${fmtDate(sheet.txn.txn_date)} · ${money(sheet.txn.amount)}`} label="เหตุผล"
          note="ใช้เมื่อเงินเข้านี้ไม่ใช่ค่าธรรมเนียมที่ติดตามในระบบนี้ (เช่น รายได้ค่าเช่าอาคาร) — เหตุผลลงประวัติ ไม่ใช่การยกหนี้ และถอนการระบุได้ภายหลัง"
          confirmLabel="ยืนยัน ไม่ใช่เงินของระบบนี้"
          onClose={() => setSheet(null)}
          onConfirm={async reason => {
            const { error: err } = await markBankTxnNotOurs(sheet.txn.id, reason)
            if (err) return friendlyError(err)
            setSheet(null); changed(); return ''
          }} />
      )}
      {sheet?.kind === 'reset' && (
        <ReasonSheet title={sheet.txn.status === 'matched' ? 'ยกเลิกคู่' : 'ถอนการระบุ'} subtitle={`${fmtDate(sheet.txn.txn_date)} · ${money(sheet.txn.amount)}`} label="เหตุผล" danger
          note={sheet.txn.status === 'matched'
            ? 'ใช้เมื่อจับคู่ผิดยอด — เงินเข้ากลับไปเป็น "ยังระบุไม่ได้" และยอดค้างกลับไปไม่มีคู่ เหตุผลลงประวัติ'
            : 'ใช้เมื่อระบุผิดว่าไม่ใช่เงินของระบบนี้ — เงินเข้ากลับไปเป็น "ยังระบุไม่ได้" เหตุผลลงประวัติ'}
          confirmLabel={sheet.txn.status === 'matched' ? 'ยืนยัน ยกเลิกคู่' : 'ยืนยัน ถอนการระบุ'}
          onClose={() => setSheet(null)}
          onConfirm={async reason => {
            const { error: err } = await resetBankTxn(sheet.txn.id, reason)
            if (err) return friendlyError(err)
            setSheet(null); changed(); return ''
          }} />
      )}
      {sheet?.kind === 'after_match' && (
        <Sheet title="จับคู่แล้ว" subtitle={`${sheet.candidate.business_name} · ${money(sheet.txn.amount)}`} onClose={() => setSheet(null)}>
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{sheet.mode === 'reopen' ? 'เปิดยอดที่ระบบปิดไปแล้วกลับ และผูกเงินเข้ากับยอดนี้แล้ว' : 'ผูกเงินเข้ากับยอดค้างแล้ว'} — ยอดยังรอชำระจนกว่าจะกรอกเลขใบเสร็จ (e-LAAS)</p>
            <p className="text-sm text-gray-700">กรอกเลขใบเสร็จตอนนี้เลยไหม? ระบบเติมวันที่รับ ยอด และช่องทางจากไฟล์ธนาคารให้แล้ว</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={() => { const txn = sheet.txn; setSheet(null); onReceipt(txn) }}><Receipt size={15} />กรอกเลขใบเสร็จเลย</button>
              <button type="button" className={btnGhost} onClick={() => setSheet(null)}>ไว้ทีหลัง</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}
