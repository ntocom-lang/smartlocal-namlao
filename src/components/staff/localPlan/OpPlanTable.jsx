// ตารางแผนการดำเนินงานแบบฉบับกระดาษ: ที่ | โครงการ | งบประมาณ | ไตรมาส 1–4 แยก 12 เดือน (ต.ค.–ก.ย.) | ผู้รับผิดชอบ
// แก้เดือน = กดบนตาราง: กดช่องเดือนเริ่ม (ไฮไลต์รอ) แล้วกดช่องเดือนจบ → บันทึกทันที · Esc ยกเลิก · มีปุ่มล้างช่วง
// มือถือ (< md) เป็นการ์ดต่อรายการ ใช้ดรอปดาวน์เดือนเริ่ม/สิ้นสุดแทน (ช่องเดือน 12 ช่องกดไม่ได้บนจอ 360px)
// สิทธิ์แก้ตัดสินจาก canEditItem() ซึ่งตรงกับ trigger ในฐานข้อมูล — ปุ่มที่ซ่อนเป็นแค่ความสะดวก ตัวบังคับจริงคือฐานข้อมูล
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Eraser, Pencil, Plus } from 'lucide-react'
import { FISCAL_MONTHS_TH } from '../../../lib/fiscalYear'
import { fiscalMonthLabel, spanLabel } from '../../../lib/localPlanCalendar'
import { applyMonthClick, canEditItem, formatBaht, sumAmount } from '../../../lib/localPlanView'
import { btnGhost } from '../construction/uiStyles'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const QUARTERS = [
  { q: 1, label: 'ไตรมาส 1', tint: '#eff6ff' },
  { q: 2, label: 'ไตรมาส 2', tint: '#f0fdf4' },
  { q: 3, label: 'ไตรมาส 3', tint: '#fffbeb' },
  { q: 4, label: 'ไตรมาส 4', tint: '#faf5ff' },
]

function SpanBar({ item, month }) {
  const from = item.month_from
  const to = item.month_to
  if (!from || month < from || month > to) return null
  const first = month === from
  const last = month === to
  // แถบลูกศร ◀━━▶ คร่อมช่อง from..to (ช่องเดียว = ◀▶ ติดกัน)
  return (
    <span className="flex w-full items-center text-sky-700" aria-hidden="true">
      {first && <span className="text-[9px] leading-none">◀</span>}
      <span className="h-0.5 min-w-0 flex-1 bg-sky-700" />
      {last && <span className="text-[9px] leading-none">▶</span>}
    </span>
  )
}

export default function OpPlanTable({ opPlan, items, departments, isManager, role, myDepartmentId, busy, onSaveMonths, onEdit, onMove, onAdd, onError }) {
  const [pending, setPending] = useState(null) // { itemId, month }
  const [savingId, setSavingId] = useState(null)
  const deptName = id => departments.find(d => d.id === id)?.name ?? '—'
  const rights = item => canEditItem({ isManager, role, myDepartmentId, item, opPlan })
  const anyEditable = items.some(i => rights(i).months)
  const draft = opPlan.status === 'draft'

  // Esc ยกเลิกการเลือกเดือนที่ค้างรอ
  useEffect(() => {
    if (!pending) return undefined
    const onKey = e => { if (e.key === 'Escape') setPending(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending])

  const commit = async (item, from, to) => {
    setSavingId(item.id)
    const message = await onSaveMonths(item, from, to)
    setSavingId(null)
    if (message) onError(message)
  }

  const clickCell = (item, month) => {
    if (savingId) return
    const current = pending && pending.itemId === item.id ? pending.month : null
    const { pending: next, commit: range } = applyMonthClick(current, month)
    setPending(next === null ? null : { itemId: item.id, month: next })
    if (range) commit(item, range.from, range.to)
  }

  // มือถือ: เลือกเดือนจากดรอปดาวน์ (ค่าที่ไม่ครบคู่ไม่บันทึก — เดือนจบก่อนเริ่มแจ้งเตือน)
  const changeFrom = (item, value) => {
    if (value === '') return commit(item, null, null)
    const from = Number(value)
    return commit(item, from, item.month_to && item.month_to >= from ? item.month_to : from)
  }
  const changeTo = (item, value) => {
    if (value === '') return item.month_from ? commit(item, item.month_from, item.month_from) : undefined
    const to = Number(value)
    if (!item.month_from) return commit(item, to, to)
    if (to < item.month_from) return onError('เดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่ม')
    return commit(item, item.month_from, to)
  }

  const total = sumAmount(items)
  const monthOptions = FISCAL_MONTHS_TH.map((m, i) => <option key={m.label} value={i + 1}>{m.label}</option>)
  const manage = isManager && draft

  const nameCell = item => (
    <>
      <button type="button" onClick={() => onEdit(item)} className="block max-w-full break-words text-left font-semibold text-gray-900 underline-offset-2 hover:underline">{item.item_name}</button>
      {item.source === 'external' && <span className="block break-words text-xs text-gray-500">หน่วยงานอื่น: {item.external_agency}</span>}
      {item.source === 'local' && !item.dev_project_id && <span className="mt-0.5 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">ยังไม่ผูกทะเบียนโครงการ</span>}
    </>
  )

  if (items.length === 0) {
    return (
      <div className="px-5 py-10 text-center text-sm text-gray-500">
        <p>ยังไม่มีรายการในแผนการดำเนินงานฉบับนี้</p>
        {manage && onAdd && <button type="button" className={`${btnGhost} mt-3`} onClick={onAdd}><Plus size={15} />เพิ่มรายการ</button>}
      </div>
    )
  }

  return (
    <div className="text-gray-800">
      {anyEditable && <p className="px-4 pt-3 text-xs text-gray-500 max-md:hidden sm:px-5">แก้เดือน: กดช่องเดือนเริ่ม แล้วกดช่องเดือนจบ (Esc ยกเลิก) — บันทึกทันที{pending ? ' · กำลังรอเดือนจบ' : ''}</p>}

      {/* PC: ตารางแบบฉบับกระดาษ */}
      <div className="overflow-x-auto max-md:hidden">
        <table className="w-full min-w-[62rem] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-600">
              <th rowSpan={2} className="w-12 border-b border-gray-200 px-2 py-2 text-center font-semibold">ที่</th>
              <th rowSpan={2} className="min-w-[16rem] border-b border-gray-200 px-3 py-2 text-left font-semibold">โครงการ</th>
              <th rowSpan={2} className="w-32 border-b border-gray-200 px-3 py-2 text-right font-semibold">งบประมาณ (บาท)</th>
              {QUARTERS.map(({ q, label, tint }) => (
                <th key={q} colSpan={3} className="border-b border-l border-gray-200 px-1 py-1 text-center font-semibold" style={{ backgroundColor: tint }}>{label}</th>
              ))}
              <th rowSpan={2} className="w-32 border-b border-l border-gray-200 px-3 py-2 text-left font-semibold">ผู้รับผิดชอบ</th>
              {manage && <th rowSpan={2} className="w-16 border-b border-gray-200 px-1 py-2 text-center font-semibold"><span className="sr-only">จัดลำดับ</span></th>}
            </tr>
            <tr className="text-[11px] text-gray-600">
              {MONTHS.map(m => (
                <th key={m} className={`w-10 border-b border-gray-200 py-1 text-center font-semibold ${m % 3 === 1 ? 'border-l' : ''}`} style={{ backgroundColor: QUARTERS[Math.ceil(m / 3) - 1].tint }}>{fiscalMonthLabel(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const can = rights(item)
              const waiting = pending?.itemId === item.id ? pending.month : null
              return (
                <tr key={item.id} className="border-b border-gray-100 align-middle">
                  <td className="px-2 py-1.5 text-center text-gray-600">{item.seq_no ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    {nameCell(item)}
                    {can.months && item.month_from && (
                      <button type="button" disabled={Boolean(savingId) || busy} onClick={() => commit(item, null, null)}
                        className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-red-700 disabled:opacity-50"><Eraser size={12} aria-hidden="true" />ล้างช่วง</button>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatBaht(item.amount)}</td>
                  {MONTHS.map(m => {
                    const label = `${item.item_name} เดือน ${fiscalMonthLabel(m)}`
                    const isWaiting = waiting === m
                    return (
                      <td key={m} className={`p-0 ${m % 3 === 1 ? 'border-l border-gray-200' : ''}`}>
                        {can.months ? (
                          <button type="button" aria-label={label} aria-pressed={isWaiting} disabled={Boolean(savingId) || busy} onClick={() => clickCell(item, m)}
                            className={`flex h-10 w-10 items-center px-0.5 transition-colors disabled:opacity-50 ${isWaiting ? 'bg-amber-200 ring-2 ring-inset ring-amber-500' : 'hover:bg-sky-50'}`}>
                            {isWaiting ? <span className="mx-auto text-[10px] font-bold text-amber-800" aria-hidden="true">เริ่ม</span> : <SpanBar item={item} month={m} />}
                          </button>
                        ) : (
                          <div className="flex h-10 w-10 items-center px-0.5" role="img" aria-label={item.month_from && m >= item.month_from && m <= item.month_to ? `${label} มีงาน` : undefined}><SpanBar item={item} month={m} /></div>
                        )}
                      </td>
                    )
                  })}
                  <td className="border-l border-gray-200 px-3 py-1.5 text-xs text-gray-700">{item.department_id ? deptName(item.department_id) : '—'}</td>
                  {manage && (
                    <td className="px-1 py-1 text-center">
                      <button type="button" aria-label={`เลื่อนขึ้น ${item.item_name}`} disabled={index === 0 || busy || Boolean(savingId)} onClick={() => onMove(item, 'up')}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ChevronUp size={16} /></button>
                      <button type="button" aria-label={`เลื่อนลง ${item.item_name}`} disabled={index === items.length - 1 || busy || Boolean(savingId)} onClick={() => onMove(item, 'down')}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ChevronDown size={16} /></button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-bold">
              <td colSpan={2} className="px-3 py-2 text-right">รวม {items.length} รายการ</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatBaht(total)}</td>
              <td colSpan={manage ? 14 : 13} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* มือถือ: การ์ดต่อรายการ */}
      <ul className="divide-y divide-gray-100 md:hidden">
        {items.map((item, index) => {
          const can = rights(item)
          return (
            <li key={item.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-7 shrink-0 text-center text-xs font-bold text-gray-500">{item.seq_no ?? '—'}</span>
                <div className="min-w-0 flex-1">{nameCell(item)}</div>
                <button type="button" aria-label={`${can.months || can.all ? 'แก้' : 'ดู'} ${item.item_name}`} onClick={() => onEdit(item)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600"><Pencil size={15} /></button>
              </div>
              <p className="pl-9 text-xs text-gray-600">งบ <b className="tabular-nums text-gray-800">{formatBaht(item.amount)}</b> บาท · {item.department_id ? deptName(item.department_id) : 'ยังไม่ระบุกอง'}</p>
              {can.months ? (
                <div className="grid grid-cols-2 gap-2 pl-9">
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-500">เดือนเริ่ม</span>
                    <select className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-2 text-sm" value={item.month_from ?? ''} disabled={Boolean(savingId) || busy} onChange={e => changeFrom(item, e.target.value)}>
                      <option value="">—</option>{monthOptions}
                    </select></label>
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-500">เดือนสิ้นสุด</span>
                    <select className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-2 text-sm" value={item.month_to ?? ''} disabled={Boolean(savingId) || busy} onChange={e => changeTo(item, e.target.value)}>
                      <option value="">—</option>{monthOptions}
                    </select></label>
                </div>
              ) : (
                <p className="pl-9 text-xs text-gray-700">ช่วงเดือน: <b>{spanLabel(item.month_from, item.month_to) || 'ยังไม่ระบุ'}</b></p>
              )}
              {manage && (
                <div className="flex gap-2 pl-9">
                  <button type="button" className={btnGhost} aria-label={`เลื่อนขึ้น ${item.item_name}`} disabled={index === 0 || busy || Boolean(savingId)} onClick={() => onMove(item, 'up')}><ChevronUp size={15} />ขึ้น</button>
                  <button type="button" className={btnGhost} aria-label={`เลื่อนลง ${item.item_name}`} disabled={index === items.length - 1 || busy || Boolean(savingId)} onClick={() => onMove(item, 'down')}><ChevronDown size={15} />ลง</button>
                </div>
              )}
            </li>
          )
        })}
        <li className="flex justify-between bg-gray-50 px-4 py-3 text-sm font-bold">
          <span>รวม {items.length} รายการ</span><span className="tabular-nums">{formatBaht(total)} บาท</span>
        </li>
      </ul>
    </div>
  )
}
