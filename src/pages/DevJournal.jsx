import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, X, Loader2, Search, Pencil, Trash2, Bug, Wrench, BookOpen, Map, LayoutGrid, LogOut, Folder,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { thaiDate } from '../lib/thaiDate'

// ต้องตรงกับ uuid ใน supabase/migrations/147_dev_journal.sql (ntocom@gmail.com) —
// เช็คฝั่ง client แค่เพื่อ UX (กันไม่ให้เห็นหน้าเปล่า/redirect เร็ว) ความปลอดภัยจริงอยู่ที่ RLS
const DEV_USER_ID = 'b3e7c083-05ee-4664-ba42-e866729923ef'

// สีธีมของหน้านี้ตั้งใจใช้ slate เข้ม (ไม่ใช่ var(--color-primary) ของ tenant) เพราะ
// dev_journal เป็นข้อมูลข้ามทุกเทศบาล ไม่ผูกกับธีมของเทศบาลใดเทศบาลหนึ่ง
const CATEGORIES = [
  { value: 'bug',   label: 'ปัญหา',     Icon: Bug,      color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { value: 'fix',   label: 'แก้ไข',     Icon: Wrench,   color: '#059669', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'story', label: 'เรื่องราว', Icon: BookOpen, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'plan',  label: 'แผนงาน',   Icon: Map,      color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
]
const catMeta = v => CATEGORIES.find(c => c.value === v) ?? CATEGORIES[0]

const STATUS_LABEL = { open: 'ยังไม่จบ', done: 'เสร็จแล้ว', wontfix: 'ไม่ทำ' }

// ส่วนของระบบที่ตั้งไว้ล่วงหน้า — โผล่เป็นเมนูหลักเสมอแม้ยังไม่มีบันทึกในหมวดนั้น
// (ต่างจากโหมดปกติที่เมนูจะงอกเองจากข้อมูลที่กรอกจริงเท่านั้น) เรียงตามลำดับในอาเรย์นี้เป๊ะ
// (ไม่ sort ตามตัวอักษร) เพิ่ม/ลบ/สลับลำดับชื่อในนี้ได้ตามต้องการ
const SEED_MODULES = ['โครงสร้าง', 'ข้อมูลระบบ']

const EMPTY_FORM = { module: '', topic: '', category: 'bug', title: '', body: '', status: 'open', municipality_id: '' }
const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

export default function DevJournal() {
  const navigate = useNavigate()
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)

  const [entries, setEntries] = useState([])
  const [municipalities, setMunicipalities] = useState([])
  const [loading, setLoading] = useState(true)
  // เมนูหลัก = ส่วนของระบบ (module) — งอกจากข้อมูลจริงที่กรอก ไม่ fix รายการล่วงหน้า
  const [activeModule, setActiveModule] = useState('all')
  // เมนูรอง = หัวข้อ (topic) — งอกจากข้อมูลภายในส่วนของระบบที่เลือกอยู่ เช่น
  // module "ข้อมูลระบบ" -> topic "แผนที่ Leaflet + Longdo Map (ไทย)"
  const [activeTopic, setActiveTopic] = useState('all')
  const [search, setSearch] = useState('')

  const [editing, setEditing] = useState(null) // null=ปิด, {}=สร้างใหม่, {...entry}=แก้ไข
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id
      if (uid !== DEV_USER_ID) {
        navigate('/admin/login', { replace: true })
        return
      }
      setAuthorized(true)
      setAuthChecked(true)
    })
  }, [navigate])

  useEffect(() => {
    if (!authorized) return
    reload()
    supabase.from('municipalities').select('id, name').order('name')
      .then(({ data }) => setMunicipalities(data ?? []))
  }, [authorized])

  function reload() {
    setLoading(true)
    supabase.from('dev_journal').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setEntries(data ?? []); setLoading(false) })
  }

  function openCreate() {
    setForm({
      ...EMPTY_FORM,
      module: activeModule !== 'all' ? activeModule : '',
      topic:  activeTopic !== 'all' ? activeTopic : '',
    })
    setEditing({})
  }
  function openEdit(entry) {
    setForm({
      module: entry.module ?? '', topic: entry.topic ?? '', category: entry.category, title: entry.title, body: entry.body,
      status: entry.status, municipality_id: entry.municipality_id ?? '',
    })
    setEditing(entry)
  }

  async function handleSave() {
    if (!form.title.trim() || !form.body.trim()) return
    setSaving(true)
    const payload = {
      module:           form.module.trim() || null,
      topic:            form.topic.trim() || null,
      category:        form.category,
      title:            form.title.trim(),
      body:             form.body.trim(),
      status:           form.status,
      municipality_id:  form.municipality_id || null,
      updated_at:       new Date().toISOString(),
    }
    const { error } = editing?.id
      ? await supabase.from('dev_journal').update(payload).eq('id', editing.id)
      : await supabase.from('dev_journal').insert(payload)
    setSaving(false)
    if (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); return }
    setEditing(null)
    reload()
  }

  async function handleDelete(id) {
    if (!window.confirm('ลบบันทึกนี้ออกจากระบบ?\n\nการลบไม่สามารถย้อนกลับได้')) return
    const { error } = await supabase.from('dev_journal').delete().eq('id', id)
    if (error) { alert('ลบไม่สำเร็จ: ' + error.message); return }
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  if (!authChecked) return null
  if (!authorized) return null

  // SEED_MODULES เรียงตามลำดับที่กำหนดไว้ตายตัว (ไม่ sort) ส่วน module ที่งอกเองจาก
  // ข้อมูลจริงจะถูก sort ตามตัวอักษรแล้วต่อท้ายมาอีกที
  const dynamicModules = Array.from(new Set(entries.map(e => e.module).filter(Boolean).filter(m => !SEED_MODULES.includes(m))))
    .sort((a, b) => a.localeCompare(b, 'th'))
  const modules = [...SEED_MODULES, ...dynamicModules]

  // หัวข้อ (เมนูรอง) คำนวณจากรายการที่กรองด้วยเมนูหลัก (ส่วนของระบบ) แล้วเท่านั้น —
  // เลือก module อื่น หัวข้อที่โชว์จะเปลี่ยนตามไปด้วยเสมอ
  const entriesInModule = entries.filter(e => activeModule === 'all' || e.module === activeModule)
  const topics = Array.from(new Set(entriesInModule.map(e => e.topic).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'th'))

  const filtered = entriesInModule
    .filter(e => activeTopic === 'all' || e.topic === activeTopic)
    .filter(e => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return e.title.toLowerCase().includes(q) || e.body.toLowerCase().includes(q)
    })

  function selectModule(m) {
    setActiveModule(m)
    setActiveTopic('all') // เปลี่ยนเมนูหลักแล้วต้องล้างหัวข้อเดิม กันหัวข้อของ module อื่นค้าง
  }
  function selectTopic(m, t) {
    setActiveModule(m)
    setActiveTopic(t)
  }
  // เข้าเมนูหลักแล้วยังไม่ได้เลือกหัวข้อ -> โชว์แค่รายการหัวข้อ (สารบัญ) ไม่โชว์เนื้อหาเต็ม
  // พิมพ์ค้นหาจะข้ามหน้าสารบัญไปโชว์ผลลัพธ์ที่ตรงเลย
  const showTopicIndex = activeTopic === 'all' && topics.length > 0 && !search.trim()
  // หัวข้อของแต่ละส่วนของระบบ — ใช้ทำสารบัญในไซด์บาร์ (แสดงทุกหัวข้อของทุก module พร้อมกัน)
  function topicsByModule(m) {
    return Array.from(new Set(entries.filter(e => e.module === m).map(e => e.topic).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'th'))
  }

  // เมนูหลัก (ส่วนของระบบ) — ใช้ร่วมกันทั้ง sidebar (PC) และ bottom tab bar (มือถือ)
  const MODULE_ITEMS = [
    { key: 'all', label: 'ทั้งหมด', Icon: LayoutGrid, count: entries.length },
    ...modules.map(m => ({ key: m, label: m, Icon: Folder, count: entries.filter(e => e.module === m).length })),
  ]
  // เมนูรอง (หัวข้อ) — แสดงเป็นแท็บบนสุดของเนื้อหา เฉพาะหัวข้อที่มีอยู่ในเมนูหลักที่เลือกอยู่
  const TOPIC_ITEMS = [
    { key: 'all', label: activeModule === 'all' ? 'ทั้งหมด' : activeModule, count: entriesInModule.length },
    ...topics.map(t => ({ key: t, label: t, count: entriesInModule.filter(e => e.topic === t).length })),
  ]

  return (
    <div className="min-h-screen bg-gray-50 md:flex">
      {/* ─── Sidebar เมนูหลัก: ส่วนของระบบ (PC) ─── */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:shrink-0"
        style={{ background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)' }}>
        <div className="px-4 py-4 flex items-center gap-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <button onClick={() => navigate('/admin')} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 transition-colors shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-tight">ผู้พัฒนาระบบ</p>
            <p className="text-[10px] text-white/40 leading-tight mt-0.5">ทั้งระบบทุกเทศบาล</p>
          </div>
        </div>
        <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>ส่วนของระบบ</p>
        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
          {MODULE_ITEMS.map(({ key, label, Icon, count }) => {
            const isActive = activeModule === key
            const subTopics = key === 'all' ? [] : topicsByModule(key)
            return (
              <div key={key}>
                <button onClick={() => selectModule(key)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
                  style={isActive && activeTopic === 'all' ? { backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff' } : { color: 'rgba(255,255,255,0.55)' }}>
                  <Icon size={16} />
                  <span className="flex-1 text-left truncate">{label}</span>
                  {count > 0 && (
                    <span className="text-[10px] font-bold px-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>{count}</span>
                  )}
                </button>
                {/* สารบัญ — หัวข้อ (เมนูรอง) ของส่วนนี้ แสดงซ้อนไว้เสมอ ไม่ต้องคลิกเปิดก่อน */}
                {subTopics.length > 0 && (
                  <div className="ml-4 pl-2 border-l space-y-0.5 my-0.5" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                    {subTopics.map(t => {
                      const topicActive = activeModule === key && activeTopic === t
                      const topicCount = entries.filter(e => e.module === key && e.topic === t).length
                      return (
                        <button key={t} onClick={() => selectTopic(key, t)}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors truncate"
                          style={topicActive ? { backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff' } : { color: 'rgba(255,255,255,0.4)' }}>
                          <span className="flex-1 text-left truncate">{t}</span>
                          {topicCount > 0 && <span className="text-[9px] opacity-70">{topicCount}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        <div className="px-2 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <button onClick={() => navigate('/admin')}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/10"
            style={{ color: 'rgba(255,255,255,0.55)' }}>
            <LogOut size={16} />
            กลับหน้าแอดมิน
          </button>
        </div>
      </aside>

      {/* ─── Mobile header ─── */}
      <div className="md:hidden sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate('/admin')} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800">ผู้พัฒนาระบบ</p>
          <p className="text-xs text-gray-400">ทั้งระบบทุกเทศบาล</p>
        </div>
      </div>

      {/* ─── Main content ─── */}
      <div className="flex-1 min-w-0 pb-24 md:pb-0">
        <div className="hidden md:flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100">
          <p className="text-sm font-bold text-gray-700">
            {activeModule === 'all' ? 'ทุกส่วนของระบบ' : activeModule}
          </p>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
            style={{ backgroundColor: '#1e293b' }}>
            <Plus size={14} /> บันทึกใหม่
          </button>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
          {/* ช่องค้นหาอยู่บนสุดเสมอ ต่อจากหัวข้อ module ด้านบน — หาเรื่องที่ต้องการได้ทันที
              ไม่ต้องไล่ผ่านแถบหัวข้อก่อน */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหาหัวข้อ หรือเนื้อหา..."
                className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 rounded-xl bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <button onClick={openCreate}
              className="md:hidden shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm active:scale-95 transition-all"
              style={{ backgroundColor: '#1e293b' }}>
              <Plus size={14} /> ใหม่
            </button>
          </div>

          {/* เมนูรอง: หัวข้อ — โชว์แค่ตอนอยู่หน้าสารบัญ (ยังไม่เลือกหัวข้อ) เพื่อไม่ให้หัวข้ออื่น
              ของ module เดียวกันมาปนกับหน้าที่กำลังดูอยู่ (เช่น ดูหัวข้อ A ไม่ควรเห็นแท็บหัวข้อ B) */}
          {activeTopic === 'all' && TOPIC_ITEMS.length > 1 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 px-0.5">หัวข้อ</p>
              <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {TOPIC_ITEMS.map(({ key, label, count }) => (
                  <button key={key} onClick={() => setActiveTopic(key)}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                    style={activeTopic === key
                      ? { backgroundColor: '#4f46e5', color: '#fff' }
                      : { backgroundColor: '#eef2ff', color: '#4f46e5' }}>
                    {label} {count > 0 && <span className="opacity-70">{count}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-gray-200" /></div>
          ) : showTopicIndex ? (
            /* สารบัญหัวข้อ — โชว์แค่ชื่อหัวข้อ+จำนวน ไม่โชว์เนื้อหาเต็ม จนกว่าจะคลิกเข้าไป */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {topics.map(t => {
                const topicEntries = entriesInModule.filter(e => e.topic === t)
                const cats = Array.from(new Set(topicEntries.map(e => e.category)))
                const latest = topicEntries.reduce((a, b) => (a.created_at > b.created_at ? a : b))
                return (
                  <button key={t} onClick={() => setActiveTopic(t)}
                    className="group relative text-left bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all p-4 pl-5 overflow-hidden">
                    <span className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-indigo-400 to-purple-500" />
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                        <BookOpen size={16} className="text-indigo-500" />
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">{topicEntries.length} บันทึก</span>
                    </div>
                    <p className="text-sm font-bold text-gray-800 mt-3 group-hover:text-indigo-600 transition-colors leading-snug">{t}</p>
                    <div className="flex items-center justify-between mt-2.5">
                      <div className="flex items-center gap-1">
                        {cats.map(cat => {
                          const c = catMeta(cat)
                          return <span key={cat} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} title={c.label} />
                        })}
                      </div>
                      <span className="text-[10px] text-gray-300">{thaiDate(latest.created_at)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <BookOpen size={44} className="mb-3 opacity-20" />
              <p className="text-sm font-semibold text-gray-400">{search ? 'ไม่พบที่ค้นหา' : 'ยังไม่มีบันทึก'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeTopic !== 'all' && (
                <button onClick={() => setActiveTopic('all')}
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors">
                  <ArrowLeft size={12} /> กลับไปสารบัญหัวข้อ
                </button>
              )}
              {filtered.map(entry => {
                const c = catMeta(entry.category)
                const muni = municipalities.find(m => m.id === entry.municipality_id)
                return (
                  <div key={entry.id} className="bg-white rounded-2xl shadow-sm border p-4" style={{ borderColor: c.border }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {entry.module && (
                          <button onClick={() => selectModule(entry.module)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                            <Folder size={10} /> {entry.module}
                          </button>
                        )}
                        {entry.topic && (
                          <button onClick={() => setActiveTopic(entry.topic)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors">
                            {entry.topic}
                          </button>
                        )}
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: c.bg, color: c.color }}>
                          <c.Icon size={11} /> {c.label}
                        </span>
                        {(entry.category === 'bug' || entry.category === 'plan') && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            {STATUS_LABEL[entry.status]}
                          </span>
                        )}
                        {muni && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            {muni.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openEdit(entry)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(entry.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-gray-800 mt-2">{entry.title}</p>
                    <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap leading-relaxed">{entry.body}</p>
                    <p className="text-[11px] text-gray-300 mt-2">{thaiDate(entry.created_at)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Bottom tab bar เมนูหลัก: ส่วนของระบบ (มือถือ) ─── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch overflow-x-auto"
        style={{
          background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
          borderTop: '2px solid rgba(255,255,255,0.1)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
          scrollbarWidth: 'none',
        }}>
        {MODULE_ITEMS.map(({ key, label, Icon }) => {
          const isActive = activeModule === key
          return (
            <button key={key} onClick={() => selectModule(key)}
              className="flex-1 min-w-[76px] flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-all active:scale-90">
              <div className="relative w-10 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
                style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.15)' : 'transparent' }}>
                {isActive && (
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-white" />
                )}
                <Icon size={19} strokeWidth={isActive ? 2.2 : 1.6}
                  style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.4)' }} />
              </div>
              <span className="text-[10px] font-bold leading-tight truncate max-w-[70px]"
                style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.4)' }}>
                {label}
              </span>
            </button>
          )
        })}
      </div>

      {editing !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
          <div className="bg-white w-full md:max-w-lg md:rounded-3xl rounded-t-3xl max-h-[93vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 shrink-0">
              <button onClick={() => setEditing(null)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500">
                <X size={18} />
              </button>
              <p className="font-bold text-gray-800">{editing?.id ? 'แก้ไขบันทึก' : 'บันทึกใหม่'}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">ส่วนของระบบ</label>
                <input type="text" list="module-suggestions" value={form.module}
                  onChange={e => setForm(f => ({ ...f, module: e.target.value }))}
                  className={inputCls} placeholder="เช่น งานบริการประชาชน, แอดมิน, ฐานข้อมูล/RLS" />
                <datalist id="module-suggestions">
                  {modules.map(m => <option key={m} value={m} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">หัวข้อย่อย (เมนูรอง)</label>
                <input type="text" list="topic-suggestions" value={form.topic}
                  onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                  className={inputCls} placeholder="เช่น แผนที่ Leaflet + Longdo Map (ไทย)" />
                <datalist id="topic-suggestions">
                  {topics.map(t => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-2 block">ประเภท</label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORIES.map(c => (
                    <button key={c.value} type="button" onClick={() => setForm(f => ({ ...f, category: c.value }))}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-xs font-semibold transition-all active:scale-95"
                      style={form.category === c.value ? { borderColor: c.color, backgroundColor: c.bg, color: c.color } : { borderColor: '#e5e7eb', color: '#6b7280' }}>
                      <c.Icon size={14} /> {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">หัวข้อ *</label>
                <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className={inputCls} placeholder="สรุปสั้นๆ" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">เนื้อหา *</label>
                <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={6}
                  className={inputCls + ' resize-none'} placeholder="รายละเอียด..." />
              </div>
              {(form.category === 'bug' || form.category === 'plan') && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">สถานะ</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inputCls}>
                    {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">เกี่ยวข้องกับเทศบาล</label>
                <select value={form.municipality_id} onChange={e => setForm(f => ({ ...f, municipality_id: e.target.value }))} className={inputCls}>
                  <option value="">ทั้งระบบ / ไม่ระบุ</option>
                  {municipalities.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
            <div className="px-4 pb-6 pt-3 border-t border-gray-100 shrink-0">
              <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.body.trim()}
                className="w-full py-3.5 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50 text-sm active:scale-[0.98] transition-all"
                style={{ backgroundColor: '#1e293b' }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {editing?.id ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
