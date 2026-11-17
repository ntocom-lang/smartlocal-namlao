import { ExternalLink, Plus } from 'lucide-react'
import { ListCard } from '../../patientTransport/StaffShell'
import { categoryLabel, docKindLabel, isSafeExternalUrl } from '../../../lib/licenceRegistry'
import { btnGhost, btnPrimary } from '../construction/uiStyles'

/** แท็บ "ประเภทใบอนุญาต": ตั้งเฉพาะประเภทที่ อปท. มีข้อกำหนดของท้องถิ่นรองรับ (ไม่มีข้อบัญญัติ = ไม่ต้องสร้างประเภท) */
export default function LicenceTypesTab({ types, counts, onAdd, onEdit }) {
  return (
    <ListCard title="ประเภทใบอนุญาต" count={types.length}
      action={<button type="button" className={btnPrimary} style={{ backgroundColor: 'var(--color-primary)' }} onClick={onAdd}><Plus size={16} />เพิ่มประเภท</button>}>
      <p className="border-b border-gray-100 px-4 py-2.5 text-xs text-gray-600 sm:px-5">
        แบบ อัตราค่าธรรมเนียม และช่วงต่ออายุเป็นข้อกำหนดของท้องถิ่นแต่ละแห่ง (พ.ร.บ.การสาธารณสุข ม.54 ม.63) — เพิ่มเฉพาะประเภทที่ อปท. ประกาศใช้แล้ว
        ส่วนฐานกฎหมายที่เติมให้เป็นค่าเริ่มต้นที่แก้ได้ ต้องยืนยันกับตัวบทฉบับปัจจุบัน
      </p>
      {types.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">ยังไม่มีประเภท — กด "เพิ่มประเภท" เพื่อเริ่ม</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {types.map(t => (
            <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="break-words font-semibold text-gray-900">
                  {t.name}
                  {!t.is_active && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">ปิดใช้งาน</span>}
                </p>
                <p className="break-words text-xs text-gray-500">
                  {categoryLabel(t.category)} · {docKindLabel(t.doc_kind)}
                  {t.doc_kind === 'licence' ? ` · อายุ ${t.validity_months} เดือน · ${t.renewal_by_fee ? 'ต่ออายุโดยชำระค่าธรรมเนียม' : 'ยื่นคำขอต่ออายุ'}` : ' · ชำระรายปี'}
                  · {counts[t.id] ?? 0} ใบ
                </p>
                {(t.legal_basis || t.ordinance_ref) && <p className="break-words text-xs text-gray-500">{[t.legal_basis, t.ordinance_ref].filter(Boolean).join(' · ')}</p>}
                {t.external_url && isSafeExternalUrl(t.external_url) && (
                  <a href={t.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 underline">
                    <ExternalLink size={12} />ยื่นผ่าน {t.external_label || 'ระบบอื่น'}
                  </a>
                )}
              </div>
              <button type="button" className={`${btnGhost} min-h-9 px-3 text-xs`} onClick={() => onEdit(t)}>แก้ไข</button>
            </li>
          ))}
        </ul>
      )}
    </ListCard>
  )
}
