import { useState } from 'react'
import { PenLine } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import SignTripDialog from '../../esign/SignTripDialog'
import { ESIGN_DECISION_LABEL, esignMessage, esignPendingRow, esignReturnedRow, esignReturnedText } from '../../../lib/esign'
import { resubmitFleetTrip } from '../../../lib/esignApi'
import { thaiDateTimeText } from '../../../lib/thaiDate'
import { ActionBtn, Flag, Item } from './ExecSimpleParts'

// รายการ "เอกสารรอท่านลงนาม" ของห้องผู้บริหารแบบเรียบ — กางใต้ข้อ ① ในหน้าเดิม กด "ลงนามใบนี้" = หน้าต่างลงนามเดิม (SignTripDialog) เปิดซ้อนบนหน้านี้
// ทำไมไม่ใช้ MyPendingSignatures: คอมโพเนนต์นั้นเป็นของใช้ร่วม (หน้าแรกเจ้าหน้าที่/หน้าการใช้รถ) ตัวอักษร 11–14px และคุมการเปิดหน้าต่างเอง
// — ต้องควบคุม "เปิด/ปิดหน้าต่าง" จากที่นี่เพื่อให้ปุ่มย้อนกลับของมือถือ = ปิดหน้าต่าง (ไม่ออกจากห้อง) จึงเขียนรายการเอง
//   แต่ใช้ฟังก์ชันแปลงแถว (esignPendingRow/esignReturnedRow) + หน้าต่างลงนาม + ฟังก์ชันส่งต่อชุดเดียวกับของเดิมทุกตัว
// ไม่มีปุ่มอนุมัติของตัวเอง: การลงนามทำในหน้าต่างเดิม (ต้องใส่รหัสลงนามของท่านเอง) · ไม่แสดงชื่อผู้ขอ — หัวข้อใช้ชื่อรถ/ปลายทาง/วันเดินทาง
// ปุ่มย้อนกลับของมือถือ: เปิดหน้าต่าง = push สถานะลงประวัติของ router (state.execSimpleSign) · ย้อนกลับ = สถานะหาย = หน้าต่างปิด
//   ปิดด้วยปุ่มของหน้าต่างเอง/ลงนามเสร็จ = ย้อนประวัติ 1 ก้าวให้ตรงกัน

const rowSub = (row) => [
  row.vehicleName,
  row.destination ? `ไป ${row.destination}` : null,
  row.plannedDeparture ? `ออก ${thaiDateTimeText(row.plannedDeparture)}` : null,
].filter(Boolean).join(' · ') || 'ใบขออนุญาตใช้ยานพาหนะ (แบบ ๓)'

/**
 * @param {{ items: object[], returned: object[], onSigned: () => void, onNotice: (n: {ok: boolean, text: string}) => void }} props
 *   items/returned = esignPendingFromRpc() · onSigned = ผู้เรียกดึงรายการ/ตัวเลขใหม่ (ลงนามเสร็จตัวเลขลดเอง)
 */
export default function ExecSimpleSign({ items, returned, onSigned, onNotice }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [signing, setSigning] = useState(null)
  const [resubmitting, setResubmitting] = useState(null)
  const rows = items.map((it) => ({ ...esignPendingRow(it), destination: it.destination || null }))
  const returnedRows = returned.map(esignReturnedRow)
  const dialogOpen = Boolean(signing) && location.state?.execSimpleSign === true

  const openDialog = (row) => {
    setSigning(row)
    navigate(`${location.pathname}${location.search}`, { state: { ...(location.state ?? {}), execSimpleSign: true } })
  }
  // ปิดจากในหน้าต่าง (ปุ่มปิด/Esc/ลงนามเสร็จ) — ถ้าสถานะที่ push ไว้ยังอยู่บนสุด ย้อน 1 ก้าวให้ประวัติตรงกับที่เห็น
  const closeDialog = () => {
    setSigning(null)
    if (location.state?.execSimpleSign === true) navigate(-1)
  }

  async function handleResubmit(tripId) {
    setResubmitting(tripId)
    const result = await resubmitFleetTrip(tripId)
    setResubmitting(null)
    onNotice(result?.ok ? { ok: true, text: 'ส่งให้ลงนามต่อแล้ว' } : { ok: false, text: esignMessage(result) })
    if (result?.ok) onSigned()
  }

  return (
    <>
      {returnedRows.map((row) => (
        <Item key={row.key} data-pending-returned-row data-trip-id={row.tripId}>
          <div className="es-item-head"><span>ใบขอใช้รถ</span><span className="wait">ถูกส่งคืนมาหาท่าน</span></div>
          <div className="es-item-sub">{[row.title, row.vehicleName, row.plannedDeparture ? `ออก ${thaiDateTimeText(row.plannedDeparture)}` : null].filter(Boolean).join(' · ')}</div>
          <p className="es-note">{row.hint}</p>
          <ActionBtn disabled={resubmitting !== null} onClick={() => handleResubmit(row.tripId)}>
            ส่งให้ลงนามต่อ
          </ActionBtn>
        </Item>
      ))}
      {rows.map((row) => (
        <Item key={row.key} data-pending-sign-row data-trip-id={row.tripId} data-slot={row.slot}>
          <div className="es-item-head">
            <span>ใบขอใช้รถ</span>
            {row.lastReturn?.open && <span className="late">เคยถูกส่งคืน</span>}
          </div>
          <div className="es-item-sub">{rowSub(row)}</div>
          <div className="es-item-sub">ช่องที่รอท่าน: {row.slotLabel}{row.tripNote ? ` · ${row.tripNote}` : ''}</div>
          <ActionBtn Icon={PenLine} onClick={() => openDialog(row)} data-pending-sign-button>
            {row.actionLabel === 'ลงนาม' ? 'ลงนามใบนี้' : 'อนุมัติ (ลงนาม) ใบนี้'}
          </ActionBtn>
        </Item>
      ))}
      {signing && dialogOpen && (
        <SignTripDialog tripId={signing.tripId} slot={signing.slot} slotLabel={signing.slotLabel} summary={signing.summary}
          canReturn={signing.canReturn} lastReturn={signing.lastReturn}
          onClose={closeDialog}
          onSigned={(result) => {
            const decision = signing.slot === 'authority' ? 'approve' : 'sign'
            closeDialog()
            onNotice({ ok: true, text: `${ESIGN_DECISION_LABEL[decision]}แล้ว${result?.stamped ? ' พร้อมแนบภาพลายเซ็น' : ''}${result?.complete ? ' — ลงนามครบทุกช่องแล้ว' : ''}` })
            onSigned()
          }}
          onReturned={(result) => {
            closeDialog()
            onNotice({ ok: true, text: esignReturnedText(result) })
            onSigned()
          }} />
      )}
    </>
  )
}

/** กล่องแจ้งผลหลังลงนาม/ส่งต่อ (อยู่ใน ① จนกว่าจะออกจากหน้า — ให้ข้อความ "ลงนามแล้ว" ยังอยู่หลังรายการหมด) */
export function SignNotice({ notice }) {
  if (!notice) return null
  return <Flag tone={notice.ok ? 'green' : 'amber'} data-pending-sign-notice>{notice.text}</Flag>
}
