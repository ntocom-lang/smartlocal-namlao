import { useState } from 'react'
import { ChevronRight, Plus, Search, X } from 'lucide-react'
import { normalizeName } from '../../lib/dataCenterPicker'

// แผ่นเลือกหมวดหมู่ข้อมูลบนมือถือ — เวอร์ชันมือถือของทรี "หมวดหมู่ข้อมูล" ในเมนูซ้ายของ PC (ซ่อนบนมือถือ)
//
// ออกแบบให้ความสูงไม่ระเบิดเมื่อมีกลุ่ม 50+ และประเภท 50+ ต่อกลุ่ม:
//  - แต่ละกลุ่ม "พับไว้" เป็นค่าเริ่มต้น กางเฉพาะกลุ่มที่กรองอยู่ (เดิมกางทุกประเภทของทุกกลุ่มพร้อมกัน
//    ที่ 50×50 จะเป็นหลักพันแถวในแผ่นเดียว)
//  - ช่องค้นหาด้านบนกรองทั้งชื่อกลุ่มและชื่อประเภท ผลค้นหากางให้เองและโชว์เฉพาะแถวที่ตรง
//
// state ค้นหา/พับกาง อยู่ในคอมโพเนนต์นี้ — Dashboard เรนเดอร์เมื่อเปิดเท่านั้น เปิดใหม่ทุกครั้งจึงเริ่มสะอาดเสมอ
// (ไม่ค้างคำค้นเก่ากับกลุ่มที่เคยกางไว้)
//
// onFilter(group, category) = กรองรายการแล้วปิดแผ่น · onAdd(group, category) = ไปฟอร์มเพิ่มข้อมูลพร้อมเติมกลุ่ม/ประเภท
export default function MobileCategorySheet({ tree, isLight, sidebarFilter, onFilter, onAdd, onClose }) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(() => new Set(sidebarFilter.group ? [sidebarFilter.group] : []))

  const nq = normalizeName(query)
  const rows = tree.map(g => {
    if (!nq) return { ...g, shown: g.categories, open: expanded.has(g.group) }
    const groupHit = normalizeName(g.group).includes(nq)
    const hits = g.categories.filter(c => normalizeName(c.category).includes(nq))
    if (!groupHit && hits.length === 0) return null
    // ชื่อกลุ่มตรงคำค้น → โชว์ประเภททั้งหมดของกลุ่มนั้น · ตรงแค่ชื่อประเภท → โชว์เฉพาะประเภทที่ตรง
    return { ...g, shown: groupHit ? g.categories : hits, open: true }
  }).filter(Boolean)

  function toggle(group) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group); else next.add(group)
      return next
    })
  }

  const grandTotal = tree.reduce((acc, g) => acc + g.total, 0)
  const activeCls = isLight ? 'bg-sky-100 text-sky-800 border border-sky-300' : 'bg-white/20 text-white border border-white/20'
  const idleGroupCls = isLight ? 'bg-slate-50 text-slate-700 border border-slate-200' : 'bg-slate-800/40 text-slate-200 border border-transparent'
  const plusCls = isLight ? 'bg-white border-sky-300 text-sky-700' : 'bg-slate-800 border-cyan-500/40 text-cyan-300'
  const chevronCls = isLight ? 'bg-white border-slate-200 text-slate-500' : 'bg-slate-800 border-slate-700 text-slate-300'

  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div onClick={e => e.stopPropagation()}
        className={`relative flex max-h-[80vh] flex-col rounded-t-3xl shadow-2xl ${
          isLight ? 'bg-white text-slate-800' : 'bg-slate-900 text-slate-100 border-t border-slate-700'
        }`}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
        <div className="shrink-0 px-4 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>เลือกหมวดหมู่ข้อมูล</p>
            <button onClick={onClose} aria-label="ปิด"
              className={`flex h-11 w-11 items-center justify-center rounded-lg ${isLight ? 'text-slate-500 bg-slate-100' : 'text-slate-400 bg-slate-800'}`}>
              <X size={16} />
            </button>
          </div>
          <div className="relative mb-3">
            <Search size={15} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isLight ? 'text-slate-400' : 'text-slate-500'}`} />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} inputMode="search" enterKeyHint="done"
              placeholder="ค้นหากลุ่มหรือประเภท" aria-label="ค้นหากลุ่มหรือประเภท"
              className={`w-full rounded-xl border py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 ${
                isLight ? 'border-slate-200 bg-white text-slate-900 focus:ring-sky-200' : 'border-slate-700 bg-slate-950 text-slate-100 focus:ring-cyan-500/30'
              }`} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {!nq && (
            <button onClick={() => onFilter(null, null)}
              className={`mb-2 flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-sm font-bold transition-colors ${
                !sidebarFilter.group ? activeCls : idleGroupCls
              }`}>
              <span>ภาพรวมทั้งหมด</span>
              <span className="font-mono text-xs">{grandTotal}</span>
            </button>
          )}

          {rows.length === 0 && (
            <p className={`px-1 py-8 text-center text-xs ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>ไม่พบกลุ่มหรือประเภทที่ตรงกับ “{query.trim()}”</p>
          )}

          {rows.map(({ group, total, categories, shown, open }) => (
            <div key={group} className="mb-2">
              {/* แถวกลุ่ม 3 ปุ่ม: ลูกศรพับ/กาง · ชื่อกลุ่ม (กรองรายการ) · + (เพิ่มข้อมูลในกลุ่มนี้) — แยกกันชัด ไม่ปนกัน
                  ทุกปุ่มสูง 44px ตามเกณฑ์ปุ่มสัมผัสของหน้านี้ */}
              <div className="flex items-stretch gap-1.5">
                {categories.length > 0 ? (
                  <button type="button" onClick={() => toggle(group)} aria-expanded={open}
                    aria-label={`${open ? 'พับ' : 'กาง'}ประเภทย่อยของ ${group}`}
                    className={`flex w-11 shrink-0 items-center justify-center rounded-xl border active:scale-95 ${chevronCls}`}>
                    <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                ) : (
                  <span className="w-11 shrink-0" aria-hidden="true" />
                )}
                <button onClick={() => onFilter(group, null)}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-sm font-bold transition-colors ${
                    sidebarFilter.group === group && !sidebarFilter.category ? activeCls : idleGroupCls
                  }`}>
                  <span className="text-left break-words">{group}</span>
                  <span className="shrink-0 font-mono text-xs opacity-80">{total}</span>
                </button>
                <button type="button" onClick={() => onAdd(group, null)} aria-label={`เพิ่มข้อมูลในกลุ่ม ${group}`}
                  className={`flex w-11 shrink-0 items-center justify-center rounded-xl border active:scale-95 ${plusCls}`}>
                  <Plus size={18} />
                </button>
              </div>

              {open && shown.length > 0 && (
                <div className="mt-1 space-y-1 pl-12">
                  {shown.map(({ category, count }) => (
                    <div key={category} className="flex items-stretch gap-1.5">
                      <button onClick={() => onFilter(group, category)}
                        className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                          sidebarFilter.group === group && sidebarFilter.category === category
                            ? (isLight ? 'bg-sky-50 text-sky-700 font-bold' : 'bg-white/10 text-white font-bold')
                            : (isLight ? 'text-slate-500' : 'text-slate-400')
                        }`}>
                        <span className="text-left break-words">{category}</span>
                        <span className="ml-2 shrink-0 font-mono">{count}</span>
                      </button>
                      <button type="button" onClick={() => onAdd(group, category)} aria-label={`เพิ่มข้อมูลในประเภท ${category}`}
                        className={`flex w-11 shrink-0 items-center justify-center rounded-lg border active:scale-95 ${
                          isLight ? 'bg-white border-slate-200 text-sky-700' : 'bg-slate-800 border-slate-700 text-cyan-300'
                        }`}>
                        <Plus size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
