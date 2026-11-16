import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChartColumn, ChevronsLeft, ChevronsRight, LayoutDashboard } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import CollapsibleNavGroup, { NavBadge, NavIconTile } from '../common/CollapsibleNavGroup'
import { NAV_ACTIVE_CAPSULE } from '../../lib/navTileColor'
import NavQuickFind from '../common/NavQuickFind'
import { NAV_RAIL_EVENT, groupNavText, navText, readNavRail, recordNavUse, setNavRail } from '../../lib/navUsage'
import { EXECUTIVE_MENU_ITEM } from '../../lib/staffNavGroups'
import StaffNavRail from './StaffNavRail'

// เมนูซ้าย PC ของระบบเจ้าหน้าที่ — ใช้ร่วม /staff กับห้องผู้บริหาร (/executive)
// ปักใต้หัวจอ: sticky + self-start (ไม่ยืดตามแถว) + ความสูง = ที่เหลือใต้หัวในตัวเลื่อน (style จาก useStickyChrome)
// nav ข้างในเลื่อนเองได้ — ความกว้างเมนูเต็ม w-60 คงเดิม (ตารางกล่องงานกว้าง 1106px พื้นที่ข้างเมนูเหลือ 1022px)
// ปุ่มท้ายเมนู "ย่อเมนู" = ย่อเหลือ w-16 (64px) แสดงแต่ไอคอน (StaffNavRail) ได้พื้นที่คืน ~176px · จำต่อเครื่อง (navUsage: readNavRail/setNavRail)
//   เจ้าของระบบอนุมัติ 2569-11-16 · เฉพาะเมนูซ้าย PC ไฟล์นี้ — ลิ้นชักมือถือ/แอดมิน/ประชาชน/ผู้พัฒนาไม่เกี่ยว
// onHome = กด "แดชบอร์ด" · onExecutive = กด "ห้องผู้บริหาร" (ไม่ส่ง = ไม่แสดงปุ่ม; คนที่เปิดห้องไม่ได้ไม่เห็น)
// executiveActive = อยู่ในห้องผู้บริหารเอง (ไฮไลต์ ไม่ใช่ปุ่มหลอกที่กดแล้วไม่ไปไหน)
// ลำดับ: ช่องค้นหา (กด "/" โฟกัส) → แดชบอร์ด/ห้องผู้บริหาร → "ใช้บ่อย" → กลุ่มเมนู (กางทั้งหมด พับได้) — เจ้าของระบบเลือก 2569-11-15
// เมนูย่อยสูงขั้นต่ำ 36px (min-h-9) ให้ราว 22 แถวพอดีจอโน้ตบุค (ยังเกินขั้นต่ำเป้าหมายแตะ 24px ของ WCAG 2.5.8) · ลิ้นชักมือถือคง ≥44px
export default function StaffSideNav({
  groups, activeKey, homeActive = false, executiveActive = false, badges, workErrors, style,
  onHome, onExecutive, onSelect,
}) {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  // ทุกทางที่กดเมนูโมดูล (กลุ่ม/ใช้บ่อย/ผลค้นหา) ผ่านตัวนี้ → นับการใช้ (แดชบอร์ด/ห้องผู้บริหารไม่ผ่านตัวนี้ ไม่ถูกนับ)
  const pick = useCallback((item) => { recordNavUse(userId, item.key); onSelect(item) }, [userId, onSelect])

  // โหมดย่อ: จำต่อเครื่อง · ฟังอีเวนต์ + storage (หลายแท็บ/หลายอินสแตนซ์ในหน้าเดียวกัน)
  const [rail, setRail] = useState(() => readNavRail())
  useEffect(() => {
    const sync = () => setRail(readNavRail())
    window.addEventListener(NAV_RAIL_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(NAV_RAIL_EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])
  const navId = useId()
  const asideRef = useRef(null)
  const focusSearchRef = useRef(false)
  // เขียน storage ก่อนแล้วตั้ง state ทีหลัง: ถ้า storage ใช้ไม่ได้ (private mode) อีเวนต์ในเครื่องจะอ่านค่าเก่ากลับมา
  // ให้ค่าที่ตั้งทีหลังชนะ ปุ่มจึงยังใช้ได้ในรอบนั้น (แค่ไม่จำข้ามการโหลดหน้า)
  const changeRail = useCallback((on) => { setNavRail(on); setRail(on) }, [])
  const expandAndFocusSearch = useCallback(() => { focusSearchRef.current = true; changeRail(false) }, [changeRail])
  // ขยายแล้วช่องค้นหาเพิ่งถูกวาด → โฟกัสหลัง commit (ไม่ต้องเดาจังหวะ requestAnimationFrame)
  useEffect(() => {
    if (rail || !focusSearchRef.current) return
    focusSearchRef.current = false
    const input = asideRef.current?.querySelector('[data-nav-search]')
    input?.focus()
    input?.select()
  }, [rail])
  // ทางลัด "/" ตอนโหมดย่อ: ขยายเมนู + โฟกัสช่องค้นหา (NavQuickFind ข้ามเองเพราะยังไม่ได้วาดช่อง)
  // กติกาเดียวกับ NavQuickFind: ไม่แย่งตอนพิมพ์ใน input/textarea/select/contentEditable · ไม่มี modifier · ไม่ defaultPrevented · เมนูซ่อน (มือถือ) = ไม่กลืนปุ่ม
  useEffect(() => {
    if (!rail) return undefined
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (!asideRef.current || asideRef.current.offsetParent === null) return
      e.preventDefault()
      expandAndFocusSearch()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rail, expandAndFocusSearch])

  // แบบพรีเมียม (2569-11-16): แถวที่เปิดอยู่ = แคปซูลไล่เฉด NAV_ACTIVE_CAPSULE · ไอคอนอยู่ในกระเบื้องสีของเมนู
  const rowCls = (active) => `flex min-h-9 w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${active ? 'text-white' : 'text-white/85 hover:bg-white/[0.06] hover:text-white'}`
  // เมนูย่อย: ตัวบาง/จางกว่าหัวกลุ่ม (white/75 บน #1a3a5c ผ่าน WCAG AA) · active = แคปซูล + ตัวหนา (แถบอำพันที่เส้นนำวาดโดย NavSubRow)
  const subCls = (active) => `flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[13px] transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${active ? 'font-semibold text-white' : 'font-normal text-white/75 hover:bg-white/[0.06] hover:text-white'}`
  const renderItem = (item) => {
    const { key, Icon, color } = item
    const isActive = activeKey === key
    return (
      <button type="button" aria-current={isActive ? 'page' : undefined} onClick={() => pick(item)} className={subCls(isActive)}
        style={isActive ? NAV_ACTIVE_CAPSULE : undefined}>
        <NavIconTile Icon={Icon} color={color} size={22} active={isActive} />
        {/* เจ้าของระบบสั่ง 2569-11-16: ชื่อเมนูบรรทัดเดียว — แสดงชื่อสั้น (navText) · ตัดด้วย … ถ้าฟอนต์เครื่องกว้างกว่า Sarabun · title = ชื่อเต็มเสมอ */}
        <span title={item.label} className="min-w-0 flex-1 truncate py-0.5 text-left leading-snug">{navText(item)}</span>
        <NavBadge count={badges?.[key]} />
      </button>
    )
  }

  // พื้นไล่เฉดบนลงล่าง (#1d4166 → #1a3a5c → #132c47) · backgroundColor = สีทึบสำรองถ้าเบราว์เซอร์วาดไล่เฉดไม่ได้
  return (
    <aside ref={asideRef} data-staff-aside data-nav-rail={rail ? '' : undefined}
      className={`hidden md:flex flex-col ${rail ? 'w-16' : 'w-60'} shrink-0 shadow-lg sticky self-start overflow-hidden transition-[width] duration-150 motion-reduce:transition-none`}
      style={{ backgroundColor: '#1a3a5c', backgroundImage: 'linear-gradient(180deg, #1d4166 0%, #1a3a5c 38%, #132c47 100%)', ...style }}>
      {rail ? (
        <StaffNavRail id={navId} groups={groups} activeKey={activeKey} homeActive={homeActive} executiveActive={executiveActive}
          badges={badges} workErrors={workErrors} onHome={onHome} onExecutive={onExecutive} onPick={pick} onSearch={expandAndFocusSearch} />
      ) : (
      <nav id={navId} className="flex-1 px-3 pb-4 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.3)_transparent] [scrollbar-width:thin]">
        {/* ช่องค้นหาปักบน: กระจกฝ้า — เมนูที่เลื่อนผ่านใต้ช่องจะเบลอ ไม่ซ้อนตัวหนังสือกันจนอ่านไม่ออก */}
        <NavQuickFind groups={groups} activeKey={activeKey} userId={userId} renderItem={renderItem} onSelect={pick}
          collapseLabels={groups.map(g => g.group)} variant="pc" shortcut wrapperClassName="sticky top-0 z-10 -mx-3 px-3 pb-2 pt-4 backdrop-blur-md"
          wrapperStyle={{ backgroundColor: 'rgba(28, 62, 97, 0.82)' }}
          pinned={(
            <div className="mt-1 space-y-1">
              <button type="button" onClick={onHome} aria-current={homeActive ? 'page' : undefined} className={rowCls(homeActive)}
                style={homeActive ? NAV_ACTIVE_CAPSULE : undefined}>
                <NavIconTile Icon={LayoutDashboard} color="#475569" size={26} active={homeActive} />
                <span className="flex-1 text-left text-sm">แดชบอร์ด</span>
              </button>
              {onExecutive && (
                <button type="button" data-staff-exec-link aria-current={executiveActive ? 'page' : undefined} onClick={onExecutive}
                  className={rowCls(executiveActive)} style={executiveActive ? NAV_ACTIVE_CAPSULE : undefined}>
                  {/* ห้องผู้บริหาร = กระเบื้องทอง แยกจากเมนูงานประจำวัน */}
                  <NavIconTile Icon={ChartColumn} color={EXECUTIVE_MENU_ITEM.color} size={26} active={executiveActive} />
                  <span className="flex-1 text-left text-sm">{EXECUTIVE_MENU_ITEM.label}</span>
                </button>
              )}
            </div>
          )}>
          {/* ศูนย์รวมข้อมูลดิจิทัลอยู่ในกลุ่ม "แผนงานและทรัพยากรกลาง" ของ STANDALONE_GROUPS (ไม่ hardcode ปุ่มซ้ำตรงนี้) */}
          {groups.map((g, index) => (
            <CollapsibleNavGroup key={g.group} label={g.group} displayLabel={groupNavText(g)} singleLine Icon={g.Icon} accent={g.accent} items={g.items} badges={badges}
              workErrors={workErrors} activeKey={activeKey} divider={index > 0} renderItem={renderItem} />
          ))}
        </NavQuickFind>
      </nav>
      )}
      {/* ปุ่มย่อ/ขยายเมนู ปักล่าง (ทั้งสองโหมด) — aria-expanded = เมนูเต็มอยู่ไหม · aria-controls ชี้ nav */}
      <div className="shrink-0 border-t border-white/10 p-1.5">
        <button type="button" data-nav-rail-toggle onClick={() => changeRail(!rail)} aria-expanded={!rail} aria-controls={navId}
          title={rail ? 'ขยายเมนู' : 'ย่อเมนูเหลือแต่ไอคอน (ตารางกว้างขึ้น)'} aria-label={rail ? 'ขยายเมนู' : undefined}
          className={`flex w-full items-center rounded-[10px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${rail ? 'h-10 justify-center' : 'min-h-9 gap-2 px-2.5'}`}>
          {rail ? <ChevronsRight size={16} aria-hidden="true" /> : (
            <>
              <ChevronsLeft size={16} aria-hidden="true" />
              <span className="text-xs">ย่อเมนู</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
