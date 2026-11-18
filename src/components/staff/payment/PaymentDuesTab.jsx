import { useMemo, useState } from 'react'
import { Ban, Clock, Landmark, Printer, Receipt } from 'lucide-react'
import { ListCard, Pager } from '../../patientTransport/StaffShell'
import { paginate } from '../../../lib/patientBooking'
import { CLOSED_LABEL, awaitingBankFile, channelLabel, dueState, filterByTab, formatRef1, kindLabel, searchDues } from '../../../lib/paymentDues'
import { btnGhost, btnPrimary } from '../construction/uiStyles'
import { fmtDate, fmtMoney } from '../licence/format'

const small = `${btnGhost} min-h-9 px-2.5 text-xs`

// สถานะ/ผลของแถวตามแท็บ — รอชำระ: นับถอยหลัง (เลยกำหนดเป็นสีแดง) · ชำระแล้ว: เลขใบเสร็จ+ช่องทาง · ปิดแล้ว: เหตุผลที่ระบบ/เจ้าหน้าที่บันทึก
// txn = เงินเข้าจากไฟล์ธนาคารที่จับคู่กับยอดนี้แล้ว (รอเลขใบเสร็จ) — ยอดยังรอชำระ จึงบอกให้เห็นว่าเงินเข้าแล้ว ไม่ต้องตามเก็บซ้ำ
function DueStatus({ row, today, tab, txn }) {
  if (tab === 'open') {
    const state = dueState(row, today)
    const waiting = !txn && awaitingBankFile(row, today)
    return (
      <>
        <span className="block text-gray-700">{fmtDate(row.due_on)}</span>
        <span className={`block text-xs ${state.overdue && !txn && !waiting ? 'font-bold text-red-700' : 'text-gray-500'}`}>{state.overdue ? `เลยกำหนด · ${state.text}` : state.text}</span>
        {waiting && (
          <span className="mt-1 inline-flex items-start gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
            <Clock size={13} className="mt-0.5 shrink-0" />
            <span>พ้นวันหมดอายุ — รอไฟล์ธนาคาร<span className="block font-normal">รับเงินที่เคาน์เตอร์ไม่ได้แล้ว · ระบบรอไฟล์ 7 วันหลังหมดอายุก่อนปิดยอด</span></span>
          </span>
        )}
        {txn && (
          <span className="mt-1 inline-flex items-start gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">
            <Landmark size={13} className="mt-0.5 shrink-0" />
            <span>เงินเข้าแล้ว รอเลขใบเสร็จ<span className="block font-normal text-emerald-800">{fmtDate(txn.txn_date)} · {fmtMoney(txn.amount)} บาท</span></span>
          </span>
        )}
      </>
    )
  }
  if (tab === 'paid') {
    return (
      <>
        <span className="block text-gray-700">ใบเสร็จ {row.receipt_no ?? '—'}</span>
        <span className="block text-xs text-gray-500">{fmtDate(row.paid_on)} · {channelLabel(row.paid_channel)}</span>
        <span className="block text-xs text-gray-500">รับ {fmtMoney(row.paid_amount)}{Number(row.paid_surcharge) > 0 ? ` + ค่าปรับ ${fmtMoney(row.paid_surcharge)}` : ''} บาท</span>
      </>
    )
  }
  return (
    <>
      <span className="block font-semibold text-gray-700">{CLOSED_LABEL[row.status] ?? '—'}</span>
      <span className="block break-words text-xs text-gray-500">{row.close_reason ?? ''}</span>
    </>
  )
}

function RowActions({ row, txn, waiting, isManager, onReceipt, onPrint, onCancel }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* มีเงินเข้าจับคู่แล้ว = เปิดแผ่นพร้อมวันที่รับ/ช่องทางจากไฟล์ธนาคาร เหลือกรอกเลขใบเสร็จ
          พ้นวันหมดอายุ (รอไฟล์ธนาคาร) = ไม่เน้นปุ่ม — บันทึกได้เฉพาะเงินที่รับทันวันหมดอายุ ส่วนใหญ่ให้ใช้แท็บเงินเข้าจากธนาคาร */}
      <button type="button" className={waiting ? small : `${small} !border-transparent !bg-emerald-600 !text-white hover:!bg-emerald-700`} onClick={() => onReceipt(row, txn ?? null)}>
        <Receipt size={14} />{waiting ? 'บันทึกเลขใบเสร็จ (เฉพาะเงินที่รับทันวันหมดอายุ)' : 'บันทึกเลขใบเสร็จ'}
      </button>
      {/* พ้นวันหมดอายุแล้ว = ห้ามพิมพ์ใบแจ้งชำระ (ประชาชนจ่ายตอนนี้ต่ออายุไม่ได้ ต้องคืนเงิน — ผลตรวจรอบ 2 M-3) */}
      {!waiting && <button type="button" className={small} onClick={() => onPrint([row])}><Printer size={14} />พิมพ์ใบแจ้งชำระ</button>}
      {isManager && <button type="button" className={small} onClick={() => onCancel(row)}><Ban size={14} />ยกเลิกยอด</button>}
    </div>
  )
}

/**
 * แท็บรายการยอด (รอชำระ / ชำระแล้ว / ปิดแล้ว) — ค้นหาชื่อร้าน เลขใบ Ref1 · เลือกหลายแถวแล้วพิมพ์ใบแจ้งชำระ (เฉพาะรอชำระ)
 * ปุ่มยกเลิกยอดเฉพาะผู้จัดการทะเบียน (กองคลังไม่มี) · คอลัมน์ดำเนินการปักขวา
 */
export default function PaymentDuesTab({ tab, dues, today, isManager, matchedByDue, onReceipt, onPrint, onCancel, emptyText, title }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)

  const tabRows = useMemo(() => filterByTab(dues, tab), [dues, tab])
  const { rows: shown, ref1Typo } = useMemo(() => searchDues(tabRows, search), [tabRows, search])
  // รายการที่เลือกไว้นับเฉพาะแถวที่ยังอยู่ในแท็บ (หลังบันทึก/ปรับยอด แถวที่หายไปไม่ถูกนับและไม่ถูกพิมพ์)
  // ยอดที่พ้นวันหมดอายุ (รอไฟล์ธนาคาร) เลือกพิมพ์ใบแจ้งชำระไม่ได้ (ผลตรวจรอบ 2 M-3)
  const printable = r => !awaitingBankFile(r, today)
  const selectedRows = useMemo(() => tabRows.filter(r => selected.has(r.id) && !awaitingBankFile(r, today)), [tabRows, selected, today])

  const paged = paginate(shown.map(r => ({ size: 1, r })), perPage, page)
  const canSelect = tab === 'open'
  const shownIds = shown.filter(printable).map(r => r.id)
  const allShownSelected = shownIds.length > 0 && shownIds.every(id => selected.has(id))
  const toggle = id => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    if (allShownSelected) shownIds.forEach(id => next.delete(id)); else shownIds.forEach(id => next.add(id))
    return next
  })
  const printSelected = () => onPrint(selectedRows)
  const act = { isManager, onReceipt, onPrint, onCancel }
  const txnOf = row => matchedByDue?.get(row.id) ?? null

  return (
    <ListCard title={title} count={shown.length} search={search} onSearch={value => { setSearch(value); setPage(1) }} searchLabel="ค้นหาชื่อร้าน เลขใบ หรือ Ref1"
      action={canSelect && (
        <button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} disabled={selectedRows.length === 0} onClick={printSelected}>
          <Printer size={16} />พิมพ์ใบแจ้งชำระที่เลือก{selectedRows.length ? ` (${selectedRows.length})` : ''}
        </button>
      )}
      pills={ref1Typo ? <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">เลข Ref1 นี้หลักตรวจไม่ตรง — อาจพิมพ์ผิดหนึ่งหลัก ลองตรวจเลขอีกครั้ง</p> : null}>
      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">{tabRows.length ? 'ไม่พบรายการตามคำค้น' : emptyText}</p>
      ) : (
        <div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1040px] border-collapse text-sm">
              <thead className="bg-gray-50 text-left text-xs font-bold text-gray-600">
                <tr>
                  {canSelect && <th className="w-10 px-3 py-2.5"><input type="checkbox" className="size-4" aria-label="เลือกทุกรายการที่แสดง" checked={allShownSelected} onChange={toggleAll} /></th>}
                  <th className="px-3 py-2.5">สถานประกอบการ / ผู้ประกอบการ</th>
                  <th className="px-3 py-2.5">เลขใบ / ประเภท</th>
                  <th className="px-3 py-2.5">รอบ</th>
                  <th className="px-3 py-2.5">{tab === 'open' ? 'ครบกำหนด' : tab === 'paid' ? 'ใบเสร็จ' : 'สถานะ'}</th>
                  <th className="px-3 py-2.5 text-right">ยอด (บาท)</th>
                  <th className="px-3 py-2.5">Ref1</th>
                  {tab === 'open' && <th className="sticky right-0 bg-gray-50 px-3 py-2.5 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]">ดำเนินการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.units.map(({ r }) => (
                  <tr key={r.id} className="align-top hover:bg-gray-50">
                    {canSelect && <td className="px-3 py-3"><input type="checkbox" className="size-4" aria-label={`เลือก ${r.business_name}`} disabled={!printable(r)} checked={printable(r) && selected.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                    <td className="px-3 py-3">
                      <p className="break-words font-semibold text-gray-900">{r.business_name}</p>
                      <p className="break-words text-xs text-gray-500">{r.holder_name}</p>
                    </td>
                    <td className="px-3 py-3 text-gray-700">{r.licence_no ?? '—'}<span className="block text-xs text-gray-500">{r.type_name ?? '—'}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-700">{kindLabel(r.kind)}</td>
                    <td className="px-3 py-3"><DueStatus row={r} today={today} tab={tab} txn={txnOf(r)} /></td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">{fmtMoney(r.amount)}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-700">{formatRef1(r.ref1)}</td>
                    {tab === 'open' && <td className="sticky right-0 bg-white px-3 py-3 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]"><RowActions row={r} txn={txnOf(r)} waiting={!txnOf(r) && awaitingBankFile(r, today)} {...act} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-gray-100 md:hidden">
            {paged.units.map(({ r }) => (
              <li key={r.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start gap-2">
                  {canSelect && <input type="checkbox" className="mt-1 size-5 shrink-0" aria-label={`เลือก ${r.business_name}`} disabled={!printable(r)} checked={printable(r) && selected.has(r.id)} onChange={() => toggle(r.id)} />}
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-gray-900">{r.business_name}</p>
                    <p className="break-words text-xs text-gray-500">{r.holder_name}</p>
                  </div>
                </div>
                <p className="break-words text-xs text-gray-600">{r.type_name ?? '—'}{r.licence_no ? ` · เลขที่ ${r.licence_no}` : ''} · {kindLabel(r.kind)}</p>
                <div className="text-xs"><DueStatus row={r} today={today} tab={tab} txn={txnOf(r)} /></div>
                <p className="text-sm font-semibold text-gray-900">{fmtMoney(r.amount)} บาท <span className="ml-1 font-mono text-xs font-normal text-gray-600">Ref1 {formatRef1(r.ref1)}</span></p>
                {tab === 'open' && <RowActions row={r} txn={txnOf(r)} waiting={!txnOf(r) && awaitingBankFile(r, today)} {...act} />}
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
  )
}
