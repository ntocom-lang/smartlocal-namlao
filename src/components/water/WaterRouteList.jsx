import { routeItems } from '../../lib/waterDiagram/route'

// รายการจุดมีหมายเลข (เหมือนรายการข้างภาพ) — เนื้อหาเต็มของแผนภาพอยู่ที่นี่: ผู้ใช้โปรแกรมอ่านจอใช้รายการนี้แทนภาพ
// ค่าสดใช้ badge.detail จาก liveBadges (ชื่อสถานี ระยะ เวลาวัด ซ้ำเดิม/ค้าง ครบ) · แท็กแผนก่อสร้าง/ชำรุด/ไม่มีข้อมูลมาจากข้อมูลผัง
export default function WaterRouteList({ route, badges }) {
  return (
    <div data-route-list>
      <p className="mb-2 px-1.5 text-sm font-extrabold text-sky-950">{route.listTitle}</p>
      <ol className="wr-list m-0 grid list-none gap-1.5 p-0">
        {routeItems(route).map(item => {
          const live = (item.live ?? []).map(slot => ({ slot, badge: badges[slot] })).filter(entry => entry.badge)
          return (
            <li key={item.n} data-stop={item.n} data-status={item.status ?? 'existing'}
              className="flex items-start gap-2.5 rounded-2xl border border-sky-100 bg-white px-2.5 py-2">
              <span aria-hidden="true" className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-sm font-extrabold text-white">{item.n}</span>
              <div className="min-w-0">
                <b className="block text-[15px] leading-tight text-slate-900">{item.name}</b>
                {item.sub && <span className="wd-sub">{item.sub}</span>}
                {((item.tags ?? []).length > 0 || live.length > 0) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(item.tags ?? []).map(tag => <span key={tag.t} className={`wd-tag wd-t-${tag.k}`}>{tag.t}</span>)}
                    {live.map(({ slot, badge }) => <span key={slot} className={`wd-tag wd-t-${badge.tone}`}>{badge.detail}</span>)}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
