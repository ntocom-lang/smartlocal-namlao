import { Fragment } from 'react'
import './WaterRouteListSheet.css'
import { listColumns } from '../../lib/waterDiagram/listSheet'
import { POSTER_DISCLAIMER, posterDateTime } from '../../lib/waterDiagram/poster'
import { GOV_FONT_SIZE_ADJUST, GOV_FONT_STACK } from '../../lib/govDocStyle'

// รายการจุดแบบแผ่น A4 แนวนอน — ใต้โปสเตอร์ในหน้าเว็บ (จอ ≥ 1024px) และเป็นแผ่นที่ 2 ของใบพิมพ์ภาพนำเสนอ
// เนื้อหาเดียวกับ WaterRouteList (ชื่อ · คำอธิบาย · แท็ก · ค่าสดจาก liveBadges ครบ ไม่ตัดทิ้ง) แต่จัดเป็น 3 คอลัมน์ตามสายน้ำ ไม่มีกรอบการ์ด
// ขนาดตัวอักษรเป็น cqw ของความกว้างแผ่น (ดู .css) จึงเห็นบนจอสัดส่วนเดียวกับที่พิมพ์ · แยกสีคำเตือนด้วยแท็กเดิม (wd-tag) ไม่ลงสีสถานการณ์
// ⚠️ ข้อยกเว้นขนาดตัวอักษร: ไม่ใช่ 14pt (ต้องการให้จบ 1 แผ่น เป็นเอกสารอินโฟกราฟิกเช่นเดียวกับโปสเตอร์) — เหตุผลอยู่ใน docs/water-diagram.md
// ท้ายแผ่นมีคำกำกับบังคับ + ที่มา + เวลาข้อมูลสด เพราะแผ่นนี้ถูกพิมพ์แยกออกจากโปสเตอร์ได้ และมีค่าวัดอยู่ในแผ่น

export default function WaterRouteListSheet({ route, diagram, badges, now }) {
  const columns = listColumns(route, badges)
  return (
    <div data-route-list data-list-sheet className="wl-sheet" style={{ fontFamily: GOV_FONT_STACK, fontSizeAdjust: String(GOV_FONT_SIZE_ADJUST) }}>
      <p className="wl-title">{route.listTitle}</p>
      <div className="wl-cols">
        {columns.filter(col => col.units.length > 0).map((col, c) => (
          <ol key={c} data-list-col className="wl-col">
            {col.units.map(unit => (
              <Fragment key={unit.items[0].n}>
                {unit.heading && <li data-group role="presentation" className="wl-group">{unit.heading}</li>}
                {unit.items.map(item => {
                  const live = (item.live ?? []).map(slot => ({ slot, badge: badges[slot] })).filter(entry => entry.badge)
                  const tags = item.tags ?? []
                  return (
                    <li key={item.n} data-stop={item.n} data-status={item.status ?? 'existing'} className="wl-item">
                      <span aria-hidden="true" className="wl-no">{item.n}</span>
                      <div className="wl-body">
                        <b className="wl-name">{item.name}</b>
                        {item.sub && <span className="wl-sub">{item.sub}</span>}
                        {tags.length > 0 && (
                          <span className="wl-tags">{tags.map(tag => <span key={tag.t} className={`wd-tag wd-t-${tag.k}`}>{tag.t}</span>)}</span>
                        )}
                        {live.map(({ slot, badge }) => <span key={slot} data-list-live={slot} className={`wl-live wd-tag wd-t-${badge.tone}`}>{badge.detail}</span>)}
                      </div>
                    </li>
                  )
                })}
              </Fragment>
            ))}
          </ol>
        ))}
      </div>
      <p data-list-footer className="wl-foot">
        <b>{POSTER_DISCLAIMER[0]}</b> · {POSTER_DISCLAIMER[2]} · ที่มา: ผังน้ำศูนย์บริหารจัดการทรัพยากรน้ำจังหวัดแพร่ ({diagram.drawnLabel}) วาดใหม่ ยังไม่ผ่านการยืนยันโดย อบต.
        · ค่าวัดเป็นค่าจากสถานี ไม่ใช่ประกาศเตือนภัย · ข้อมูลสด ณ {posterDateTime(now)}
      </p>
    </div>
  )
}
