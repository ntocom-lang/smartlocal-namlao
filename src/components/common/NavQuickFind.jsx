import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Star, X } from 'lucide-react'
import { searchNavItems, topNavKeys } from '../../lib/navUsage'
import { NavGroupIcon, NavSubList, NavSubRow } from './CollapsibleNavGroup'

// ค้นหาเมนู + หมวด "ใช้บ่อย" ของเมนูซ้ายเจ้าหน้าที่ — ใช้ร่วม StaffSideNav (PC) กับ PortalDrawer (มือถือ) ตรรกะอยู่ที่นี่ที่เดียว
// ลำดับที่วาด: ช่องค้นหา → pinned (แดชบอร์ด/ห้องผู้บริหาร) → [มีคำค้น: ผลลัพธ์รายการเดียว | ไม่มี: "ใช้บ่อย" + children (กลุ่มเมนู)]
// groups = รายการที่ผู้เรียกกรองสิทธิ์/โมดูลมาแล้ว — ที่นี่ไม่สร้างเมนูเอง (ไม่มีเมนูหลอก)
// renderItem(item) = ปุ่มเมนูหนึ่งแถว (หน้าตาแบบเมนูย่อยของผู้เรียก) · ผู้เรียกบันทึกการใช้ (recordNavUse) ใน handler กดเมนูเอง
//   ผลค้นหา/ใช้บ่อยเรียก renderItem ตัวเดียวกับกลุ่มเมนู จึงบันทึกครบทุกทางโดยไม่ต้องเขียนซ้ำ
// favorites คำนวณตอน mount (PC) / ตอน refreshKey เปลี่ยน เช่นเปิดลิ้นชัก (มือถือ) แล้วคงไว้ — กดเมนูแล้วลำดับไม่กระโดด
// refreshKey เปลี่ยน = ล้างคำค้นด้วย (เปิด/ปิดลิ้นชักใหม่ต้องเริ่มสะอาด)
export default function NavQuickFind({
  groups, activeKey, userId, renderItem, onSelect, pinned, children,
  variant = 'pc', shortcut = false, refreshKey, wrapperClassName = '', wrapperStyle,
}) {
  const inputRef = useRef(null)
  const resultsRef = useRef(null)
  const [query, setQuery] = useState('')
  const [prevRefreshKey, setPrevRefreshKey] = useState(refreshKey)
  if (prevRefreshKey !== refreshKey) { setPrevRefreshKey(refreshKey); setQuery('') }

  const isPc = variant === 'pc'
  const searching = query.trim().length > 0
  const allItems = useMemo(() => (groups ?? []).flatMap(g => g.items ?? []), [groups])
  const keysSig = allItems.map(i => i.key).join('|')
  // ⚠️ ตั้งใจไม่ผูกกับ allItems โดยตรง: ผูกกับ keysSig (รายการเมนูเปลี่ยนจริงเท่านั้น) + refreshKey (จังหวะที่ให้จัดอันดับใหม่)
  const favoriteItems = useMemo(() => {
    const byKey = new Map(allItems.map(i => [i.key, i]))
    return topNavKeys(userId, [...byKey.keys()]).map(k => byKey.get(k))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ดูหมายเหตุด้านบน
  }, [userId, keysSig, refreshKey])
  const results = useMemo(() => (searching ? searchNavItems(groups, query) : []), [groups, query, searching])

  // กด "/" ที่ไหนก็ได้บนหน้า = โฟกัสช่องค้นหา (เฉพาะ PC ที่ช่องมองเห็นอยู่ · ไม่แย่งตอนกำลังพิมพ์ในช่องอื่น/มี modifier)
  useEffect(() => {
    if (!shortcut) return undefined
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const input = inputRef.current
      if (!input || input.offsetParent === null) return // ซ่อนอยู่ (มือถือ) = ไม่กลืนปุ่ม
      e.preventDefault()
      input.focus()
      input.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shortcut])

  const pick = (item) => { setQuery(''); onSelect(item) }
  const resultButtons = () => [...(resultsRef.current?.querySelectorAll('[data-quickfind-result] button') ?? [])]

  const onInputKeyDown = (e) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault()
      e.stopPropagation() // ในลิ้นชัก Esc ตัวแรกล้างคำค้น ยังไม่ปิดลิ้นชัก
      setQuery('')
    } else if (e.key === 'Enter' && results[0]) {
      e.preventDefault()
      pick(results[0].item)
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault()
      resultButtons()[0]?.focus()
    }
  }
  const onResultsKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(''); inputRef.current?.focus(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const buttons = resultButtons()
    const i = buttons.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault()
    if (e.key === 'ArrowDown') buttons[Math.min(i + 1, buttons.length - 1)]?.focus()
    else if (i === 0) inputRef.current?.focus()
    else buttons[i - 1]?.focus()
  }

  return (
    <>
      <div data-nav-quickfind className={wrapperClassName} style={wrapperStyle}>
        <div className="relative">
          {/* z-10: ช่องค้นหามี backdrop-blur (สร้างชั้นซ้อนใหม่) จะทับไอคอนที่อยู่ก่อนใน DOM ถ้าไม่ยกขึ้น */}
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-white/75" />
          <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onInputKeyDown}
            data-nav-search aria-label="ค้นหาเมนู" placeholder="ค้นหาเมนู..." autoComplete="off" spellCheck={false}
            enterKeyHint="search"
            className={`w-full rounded-[10px] border border-white/20 bg-white/[0.09] pl-9 pr-9 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md placeholder:text-white/70 focus:border-white/45 focus:bg-white/[0.13] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${isPc ? 'h-9 text-xs' : 'h-11 text-base'}`} />
          {query ? (
            <button type="button" aria-label="ล้างคำค้น" onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className={`absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${isPc ? 'h-8 w-8' : 'h-10 w-10'}`}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : isPc && (
            <kbd aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 z-10 -translate-y-1/2 rounded border border-white/20 px-1.5 text-[10px] leading-4 text-white/60">/</kbd>
          )}
        </div>
      </div>

      {pinned}

      {searching ? (
        <div ref={resultsRef} data-nav-results onKeyDown={onResultsKeyDown} className="mt-2 space-y-0.5">
          <p role="status" className="sr-only">{results.length ? `พบ ${results.length} เมนู` : 'ไม่พบเมนู'}</p>
          {results.length === 0 && (
            <p aria-hidden="true" className="px-3 py-3 text-xs text-white/70">ไม่พบเมนู “{query.trim()}”</p>
          )}
          {results.map(({ item, group }) => (
            <div key={item.key} data-quickfind-result={item.key} onClick={() => setQuery('')}>
              <p className="px-3 pt-1.5 text-[10px] leading-tight text-white/60">{group}</p>
              {renderItem(item)}
            </div>
          ))}
        </div>
      ) : (
        <>
          {favoriteItems.length > 0 && (
            <div data-nav-favorites className="relative mt-3 pb-3">
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-amber-500/80 via-amber-500/30 to-transparent" />
              <div className="mb-1 flex min-h-11 items-center gap-2 px-3 py-1.5 text-[13px] font-bold leading-snug text-white md:min-h-9">
                <NavGroupIcon Icon={Star} accent="#d97706" />
                <span className="min-w-0 flex-1">ใช้บ่อย</span>
              </div>
              <NavSubList>
                {favoriteItems.map(item => (
                  <NavSubRow key={item.key} data-nav-fav={item.key} active={activeKey != null && activeKey === item.key}>
                    {renderItem(item)}
                  </NavSubRow>
                ))}
              </NavSubList>
            </div>
          )}
          {children}
        </>
      )}
    </>
  )
}
