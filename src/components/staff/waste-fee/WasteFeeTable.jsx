import { useState } from 'react'
import { Pencil, Receipt } from 'lucide-react'
import { Pager } from '../../patientTransport/StaffShell'
import { paginate } from '../../../lib/patientBooking'
import { fmtUnits, placeTypeLabel } from '../../../lib/wasteFee'
import { btnGhost } from '../construction/uiStyles'
import WasteFeeBadge from './WasteFeeBadge'
import { fmtMonth } from './format'

// ปุ่มดำเนินการต่อบัญชี — ใช้ทั้งตารางและการ์ดมือถือ
function RowActions({ account, onDetail, onEdit }) {
  const small = `${btnGhost} min-h-9 px-2.5 text-xs`
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={`${small} !border-transparent !bg-emerald-600 !text-white hover:!bg-emerald-700`} onClick={() => onDetail(account)}><Receipt size={14} />ยอด/ประวัติ</button>
      <button type="button" className={small} onClick={() => onEdit(account)}><Pencil size={14} />แก้ไข</button>
    </div>
  )
}

const addressLine = a => [a.house_no ? `บ้านเลขที่ ${a.house_no}` : '', a.village, a.address].filter(Boolean).join(' · ')

/**
 * ตารางทะเบียนบัญชี (PC) / การ์ด (มือถือ) พร้อมแบ่งหน้า — คอลัมน์ดำเนินการปักขวา (ตารางกว้างกว่าจอไม่ทำให้ปุ่มหลุดขอบ)
 * accounts: แถวจาก waste_fee_accounts · month: เดือนปัจจุบัน (วันที่ 1) ใช้ตัดสินป้ายสถานะ · sortedIds: Set ของบัญชีที่ได้ลดค่ากำจัดในเดือนนี้
 */
export default function WasteFeeTable({ accounts, month, sortedIds, onDetail, onEdit, emptyText }) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const paged = paginate(accounts.map(a => ({ size: 1, a })), perPage, page)
  const act = { onDetail, onEdit }

  if (accounts.length === 0) return <p className="px-5 py-10 text-center text-sm text-gray-500">{emptyText}</p>
  return (
    <div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-xs font-bold text-gray-600">
            <tr>
              <th className="px-4 py-2.5">ผู้ชำระ / ที่อยู่</th>
              <th className="px-3 py-2.5">เลขทะเบียน</th>
              <th className="px-3 py-2.5">ประเภท / ปริมาณ</th>
              <th className="px-3 py-2.5">เริ่มเก็บ</th>
              <th className="px-3 py-2.5">สถานะ</th>
              <th className="sticky right-0 bg-gray-50 px-3 py-2.5 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]">ดำเนินการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paged.units.map(({ a }) => (
              <tr key={a.id} className="align-top hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="break-words font-semibold text-gray-900">{a.payer_name}</p>
                  <p className="break-words text-xs text-gray-500">{addressLine(a) || '—'}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-gray-700">{a.account_no ?? '—'}</td>
                <td className="px-3 py-3 text-gray-700">{placeTypeLabel(a.place_type)}<span className="block text-xs text-gray-500">{fmtUnits(a.monthly_units)} หน่วย</span></td>
                <td className="whitespace-nowrap px-3 py-3 text-gray-700">{fmtMonth(a.service_from)}{a.closed_from && <span className="block text-xs text-gray-500">เลิกเก็บ {fmtMonth(a.closed_from)}</span>}</td>
                <td className="px-3 py-3"><WasteFeeBadge account={a} month={month} sorted={sortedIds.has(a.id)} /></td>
                <td className="sticky right-0 bg-white px-3 py-3 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]"><RowActions account={a} {...act} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-gray-100 md:hidden">
        {paged.units.map(({ a }) => (
          <li key={a.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-semibold text-gray-900">{a.payer_name}</p>
                <p className="break-words text-xs text-gray-500">{addressLine(a) || '—'}</p>
              </div>
              <WasteFeeBadge account={a} month={month} sorted={sortedIds.has(a.id)} />
            </div>
            <p className="break-words text-xs text-gray-600">{placeTypeLabel(a.place_type)} · {fmtUnits(a.monthly_units)} หน่วย{a.account_no ? ` · เลขทะเบียน ${a.account_no}` : ''}</p>
            <p className="text-xs text-gray-700">เริ่มเก็บ {fmtMonth(a.service_from)}{a.closed_from ? ` · เลิกเก็บ ${fmtMonth(a.closed_from)}` : ''}</p>
            <RowActions account={a} {...act} />
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
