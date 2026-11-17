import { useState } from 'react'
import { Ban, History, Pencil, Receipt } from 'lucide-react'
import { Pager } from '../../patientTransport/StaffShell'
import { paginate } from '../../../lib/patientBooking'
import { feeButtonState, remainingText } from '../../../lib/licenceRegistry'
import { btnGhost } from '../construction/uiStyles'
import LicenceBadge from './LicenceBadge'
import { fmtDate } from './format'

// ปุ่มดำเนินการต่อใบ — ใช้ทั้งตารางและการ์ดมือถือ · ปุ่มรับค่าธรรมเนียมปิดพร้อมบอกเหตุผลเมื่อทำไม่ได้ (ไม่ซ่อนเงียบๆ)
function RowActions({ row, today, onFee, onStatus, onHistory, onEdit }) {
  const fee = feeButtonState({ licence: row.licence, type: row.type, today })
  const small = `${btnGhost} min-h-9 px-2.5 text-xs`
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={`${small} !border-transparent !bg-emerald-600 !text-white hover:!bg-emerald-700`} disabled={!fee.enabled}
          title={fee.reason || undefined} onClick={() => onFee(row)}><Receipt size={14} />บันทึกรับค่าธรรมเนียม</button>
        <button type="button" className={small} onClick={() => onStatus(row)}><Ban size={14} />บันทึกคำสั่ง</button>
        <button type="button" className={small} onClick={() => onHistory(row)}><History size={14} />ประวัติ</button>
        <button type="button" className={small} onClick={() => onEdit(row)}><Pencil size={14} />แก้ไข</button>
      </div>
      {!fee.enabled && fee.reason && <p className="max-w-xs text-[11px] leading-snug text-amber-800">{fee.reason}</p>}
    </div>
  )
}

/**
 * ตารางทะเบียน (PC) / การ์ด (มือถือ) พร้อมแบ่งหน้า — คอลัมน์ดำเนินการปักขวา (ตารางกว้างกว่าจอไม่ทำให้ปุ่มหลุดขอบ)
 * rows: [{ licence, type, docKind, days }]
 */
export default function LicenceTable({ rows, today, soonDays, onFee, onStatus, onHistory, onEdit, emptyText }) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const paged = paginate(rows.map(r => ({ size: 1, r })), perPage, page)
  const act = { today, onFee, onStatus, onHistory, onEdit }
  const dateLabel = row => (row.docKind === 'notice_certificate' ? 'ครบกำหนดชำระ' : 'หมดอายุ')
  const dateOf = row => (row.docKind === 'notice_certificate' ? row.licence.next_fee_due_on : row.licence.expires_on)

  if (rows.length === 0) return <p className="px-5 py-10 text-center text-sm text-gray-500">{emptyText}</p>
  return (
    <div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-xs font-bold text-gray-600">
            <tr>
              <th className="px-4 py-2.5">สถานประกอบการ / ผู้ประกอบการ</th>
              <th className="px-3 py-2.5">ประเภท</th>
              <th className="px-3 py-2.5">เลขที่</th>
              <th className="px-3 py-2.5">วันครบกำหนด</th>
              <th className="px-3 py-2.5">สถานะ</th>
              <th className="sticky right-0 bg-gray-50 px-3 py-2.5 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]">ดำเนินการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paged.units.map(({ r }) => (
              <tr key={r.licence.id} className="align-top hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="break-words font-semibold text-gray-900">{r.licence.business_name}</p>
                  <p className="break-words text-xs text-gray-500">{r.licence.holder_name}{r.licence.village ? ` · ${r.licence.village}` : ''}</p>
                </td>
                <td className="px-3 py-3 text-gray-700">{r.type?.name ?? '—'}{r.licence.sub_type && <span className="block text-xs text-gray-500">{r.licence.sub_type}</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 text-gray-700">{r.licence.licence_no ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-3 text-gray-700">
                  <span className="block text-xs text-gray-500">{dateLabel(r)}</span>{fmtDate(dateOf(r))}
                  <span className="block text-xs text-gray-500">{remainingText(r.days)}</span>
                </td>
                <td className="px-3 py-3"><LicenceBadge licence={r.licence} docKind={r.docKind} today={today} soonDays={soonDays} /></td>
                <td className="sticky right-0 bg-white px-3 py-3 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]"><RowActions row={r} {...act} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-gray-100 md:hidden">
        {paged.units.map(({ r }) => (
          <li key={r.licence.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-semibold text-gray-900">{r.licence.business_name}</p>
                <p className="break-words text-xs text-gray-500">{r.licence.holder_name}{r.licence.village ? ` · ${r.licence.village}` : ''}</p>
              </div>
              <LicenceBadge licence={r.licence} docKind={r.docKind} today={today} soonDays={soonDays} />
            </div>
            <p className="break-words text-xs text-gray-600">{r.type?.name ?? '—'}{r.licence.licence_no ? ` · เลขที่ ${r.licence.licence_no}` : ''}</p>
            <p className="text-xs text-gray-700">{dateLabel(r)} {fmtDate(dateOf(r))} ({remainingText(r.days)})</p>
            <RowActions row={r} {...act} />
          </li>
        ))}
      </ul>
      <div className="px-4 pb-4 sm:px-5">
        <Pager total={paged.total} from={paged.from} to={paged.to} page={paged.page} pages={paged.pages} perPage={perPage}
          onPage={setPage} onPerPage={value => { setPerPage(value); setPage(1) }} />
      </div>
    </div>
  )
}
