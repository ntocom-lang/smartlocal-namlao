import { useRef, useState } from 'react'
import { execNf } from '../../../lib/executiveData'
import './ExecSimpleHome.css'

// ชิ้นส่วนวาดของ "ห้องผู้บริหารแบบเรียบ" — ไม่มีข้อมูล/ฮุกดึงข้อมูลในไฟล์นี้ (แค่หน้าตาตามภาพจำลองที่เจ้าของระบบอนุมัติ)
// กติกาปุ่ม 3 แบบ ห้ามปน (ผู้สูงอายุไม่ต้องอ่านก็รู้ว่าปุ่มไหน "ส่งของออกไปจริง"):
//   ActionBtn = สีทึบน้ำเงิน + ไอคอน = ลงมือทำ (ลงนามใบนี้ / ส่งให้กองเร่ง)
//   OpenBtn   = ขาวขอบฟ้า + ลูกศร › = ดู / เปิด / ไปหน้าอื่น
//   HideBtn / ToggleBtn(เปิดอยู่) = เทา + ▲ = ซ่อน / ปิด · ปุ่มกางตอนปิดเป็นขาวขอบฟ้า + ▼
// สถานะใช้ สี + สัญลักษณ์ + คำ เสมอ (ไม่ใช้สีอย่างเดียว) · ตัวเลขอ่านไม่ได้ = "—" ห้ามเป็น 0

const FLAG_SYMBOL = { green: '✓', amber: '!', red: '!', gray: '!' }

/** การ์ดหัวข้อ: แถบสีบนการ์ด + ไอคอนหัวข้อ · calm = ไม่มีเรื่อง (แถบเป็นสีเขียว) */
export function SimpleCard({ area, id, Icon, title, small, calm = false, children }) {
  return (
    <section className={`es-card es-a-${area}`} data-calm={calm ? 'true' : 'false'} aria-labelledby={`es-${id}`} data-exec-simple-card={id}>
      <h2 id={`es-${id}`}>
        <span className="es-hicon" aria-hidden="true"><Icon className="es-icon" /></span>
        <span>{title}{small && <small>{small}</small>}</span>
      </h2>
      {children}
    </section>
  )
}

export function Row({ children, ...rest }) {
  return <div className="es-row" {...rest}>{children}</div>
}

/** ไอคอนสี่เหลี่ยมมนหน้าชื่อเรื่อง tone: blue | green | gold | sky */
export function Mini({ tone, Icon }) {
  return <span className={`es-mini ${tone}`} aria-hidden="true"><Icon className="es-icon" /></span>
}

/** ชื่อเรื่องซ้าย ตัวเลขใหญ่ขวา — value null/undefined = "—" (ไม่ใช่ 0) */
export function LabelNumber({ icon, label, value, unit, ...rest }) {
  const unknown = value == null
  return (
    <div className="es-line" {...rest}>
      <span className="es-label">{icon}{label}</span>
      <span className="es-big" data-null={unknown ? 'true' : 'false'}>
        {unknown ? '—' : (typeof value === 'number' ? execNf(value) : value)}
        {unit && !unknown && <span className="es-unit">{unit}</span>}
      </span>
    </div>
  )
}

/** แถบสถานะ tone: green ✓ · amber ! · red ! · gray ! (ตรวจไม่ได้) */
export function Flag({ tone = 'green', children, ...rest }) {
  return (
    <div className={`es-flag ${tone}`} role={tone === 'green' ? 'status' : undefined} {...rest}>
      <span className="es-ic" aria-hidden="true">{FLAG_SYMBOL[tone]}</span>
      <span>{children}</span>
    </div>
  )
}

/** ลงมือทำ: สีทึบน้ำเงิน + ไอคอน */
export function ActionBtn({ Icon, children, ...rest }) {
  return (
    <button type="button" className="es-btn" {...rest}>
      {Icon && <Icon className="es-icon" aria-hidden="true" />}{children}
    </button>
  )
}

/** ดู / เปิด / ไปหน้าอื่น: ขาวขอบฟ้า + ลูกศร › */
export function OpenBtn({ children, ...rest }) {
  return (
    <button type="button" className="es-btn es-btn--open" {...rest}>
      {children}<span className="es-arr" aria-hidden="true">›</span>
    </button>
  )
}

/** ซ่อน / ปิด: เทา + ▲ */
export function HideBtn({ children = 'ซ่อนรายการ', ...rest }) {
  return (
    <button type="button" className="es-btn es-btn--hide" {...rest}>
      {children}<span className="es-chev" aria-hidden="true">▲</span>
    </button>
  )
}

/**
 * ส่วนนี้โหลดไม่ได้ — บอกตรงๆ ไม่ปล่อยให้เป็น 0 หรือ "ไม่มีเรื่อง" ลวงๆ + ปุ่มลองใหม่
 * (ลองใหม่ = ดึงข้อมูลซ้ำ ไม่ส่งอะไรออกไป จึงใช้ปุ่มแบบ "ดู/เปิด" ไม่ใช่แบบ "ลงมือทำ")
 */
export function LoadFail({ text, onRetry }) {
  return (
    <Flag tone="gray" role="alert" data-exec-simple-fail>
      <span>{text}</span>
      {onRetry && (
        <button type="button" className="es-btn es-btn--open es-retry" onClick={onRetry}>ลองใหม่</button>
      )}
    </Flag>
  )
}

/** กำลังโหลด (ครั้งแรกเท่านั้น — รอบอัปเดตเองเงียบ ไม่ขึ้นข้อความนี้) */
export function Loading({ text = 'กำลังโหลด…' }) {
  return <p className="es-note" role="status">{text}</p>
}

/**
 * ข้อเตือนในการ์ด ② — tone red | amber · count null = "—"
 * children = ปุ่ม/รายการที่กางใต้ข้อนั้น
 */
export function AlertBlock({ tone = 'amber', Icon, what, count, unit, showCount = true, newLabel, detail, children, ...rest }) {
  return (
    <div className={`es-alert ${tone}`} {...rest}>
      <div className="es-alert-top">
        <span className="es-ic" aria-hidden="true"><Icon className="es-icon" /></span>
        <div className="es-what">
          {what}
          {newLabel && <span className="es-new">ใหม่ {newLabel} น.</span>}
        </div>
        {showCount ? (
          <div className="es-num">
            {count == null ? '—' : execNf(count)}
            {unit && <small>{unit}</small>}
          </div>
        ) : <span />}
      </div>
      {detail && <p className="es-detail">{detail}</p>}
      {children}
    </div>
  )
}

/**
 * ปุ่มกาง + รายการที่กางใต้ข้อนั้น (อยู่หน้าเดิม) — ท้ายรายการมีปุ่มซ่อนอีกปุ่ม
 * ปิดจากปุ่มท้ายรายการ: เลื่อนจอกลับไปที่ปุ่มกาง (ไม่ทิ้งท่านไว้กลางที่ว่าง)
 * children เป็นฟังก์ชันเมื่อต้องการให้ "เริ่มดึงข้อมูลเมื่อกางเท่านั้น" (mount ตอนเปิด) — ไม่ยิง RPC เพิ่มตอนเปิดหน้า
 */
export function Expandable({ closedText, openText, hideText, children, id }) {
  const [open, setOpen] = useState(false)
  const mainRef = useRef(null)
  const listId = `es-list-${id}`
  const hide = () => {
    setOpen(false)
    mainRef.current?.scrollIntoView({ block: 'center' })
  }
  return (
    <>
      <button ref={mainRef} type="button" className="es-btn es-btn--toggle" aria-expanded={open} aria-controls={listId}
        onClick={() => setOpen((v) => !v)} data-exec-simple-toggle={id}>
        {open ? openText : closedText}<span className="es-chev" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="es-list" id={listId} data-exec-simple-list={id}>
          {typeof children === 'function' ? children() : children}
          <HideBtn onClick={hide}>{hideText ?? openText}</HideBtn>
        </div>
      )}
    </>
  )
}

export function Item({ children, ...rest }) {
  return <div className="es-item" {...rest}>{children}</div>
}
