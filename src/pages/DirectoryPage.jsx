import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, BookUser, Phone, Search, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { EMERGENCY_CATEGORIES, emergencyCategoryOf } from '../lib/emergencyCategories'
import { CONTACT_BOOK_MAP } from '../lib/contactBooks'
// ไอคอนเป็นได้ทั้งอิโมจิและรูปที่แอดมินแนบ (data URL) — ถ้า render ตรงๆ จะโชว์สตริงยาวเหยียด
import CategoryIcon from '../components/datacenter/CategoryIcon'

// สมุดนี้มีเบอร์เยอะกว่าหน้าสายด่วนโดยธรรมชาติ (ผู้ใหญ่บ้านทุกหมู่ + ส่วนราชการ)
// จึงเปิดช่องค้นหาที่จำนวนน้อยกว่าหน้าสายด่วน
const SEARCH_THRESHOLD = 6

const BOOK = CONTACT_BOOK_MAP.directory

// เทียบเบอร์แบบไม่สนขีด/วงเล็บ/ช่องว่าง: พิมพ์ 0811801863 ต้องเจอ 081-180-1863
const digitsOf = (s) => String(s || '').replace(/\D/g, '')

function ContactRow({ contact, cat }) {
  return (
    <a href={`tel:${contact.number}`}
       aria-label={`โทร ${contact.label} ${contact.number}`}
       className="flex items-center gap-3 px-3 py-2.5 active:bg-gray-50 hover:bg-gray-50/70 transition-colors">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
           style={{ backgroundColor: cat.bg }}>
        <CategoryIcon value={contact.emoji} alt="" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-semibold text-gray-800 leading-snug">{contact.label}</p>
        {/* note = ตำแหน่ง/หมู่/เวลาทำการ ที่แอดมินกรอกไว้ ไม่มีก็ไม่ต้องเว้นที่ */}
        {contact.note && (
          <p className="text-[13px] text-gray-500 leading-snug mt-0.5">{contact.note}</p>
        )}
        <p className="text-sm text-gray-500 mt-0.5 tracking-wide">{contact.number}</p>
      </div>
      <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: cat.bg, color: cat.color }}>
        <Phone size={16} />
      </span>
    </a>
  )
}

export default function DirectoryPage() {
  const navigate = useNavigate()
  const { tenant, loading: tenantLoading } = useTenant()
  const { role } = useAuth()
  const [contacts, setContacts] = useState(null)   // null = ยังไม่ได้โหลด, [] = โหลดแล้วแต่ไม่มีข้อมูล
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!tenant?.id) return
    let alive = true
    supabase
      .from('emergency_contacts')
      .select('*')
      .eq('municipality_id', tenant.id)
      // เบอร์เหตุด่วนอยู่หน้า /emergency — สองหน้านี้ใช้ตารางเดียวกันแต่คนละสมุด
      .eq('book', 'directory')
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => { if (alive) setContacts(data || []) })
    return () => { alive = false }
  }, [tenant?.id])

  // จัดกลุ่มตามหมวดชุดเดียวกับหน้าสายด่วน เรียงหมวดตาม EMERGENCY_CATEGORIES
  // ในหมวดเรียงตาม display_order ที่แอดมินจัดไว้
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qDigits = digitsOf(query)
    const matched = (contacts || []).filter((c) => {
      if (!q) return true
      // ค้นหาครอบ note ด้วย เพราะคนค้นด้วยคำว่า "หมู่ 3" บ่อยกว่าชื่อคน
      if (String(c.label || '').toLowerCase().includes(q)) return true
      if (String(c.note || '').toLowerCase().includes(q)) return true
      return qDigits.length > 0 && digitsOf(c.number).includes(qDigits)
    })
    return EMERGENCY_CATEGORIES
      .map((cat) => ({ cat, items: matched.filter((c) => emergencyCategoryOf(c) === cat.key) }))
      .filter((g) => g.items.length > 0)
  }, [contacts, query])

  // tenant ยังโหลดไม่เสร็จ หรือมี tenant แล้วแต่ query ยังไม่กลับ = ยังโหลดอยู่
  const loading = tenantLoading || Boolean(tenant?.id && contacts === null)
  const canManage = role === 'admin' || role === 'superadmin'
  const showSearch = !loading && (contacts?.length || 0) > SEARCH_THRESHOLD

  return (
    <div className="max-w-lg mx-auto pb-28 md:pb-8">

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">{BOOK.label}</h1>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center gap-3 px-4 pt-8 pb-5 border-b border-gray-100 mb-2">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0"
             style={{ background: BOOK.gradient }}>
          {BOOK.emoji}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{BOOK.label}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{BOOK.subtitle}</p>
        </div>
      </div>

      <div className="px-4 pt-1 md:pt-4 space-y-4">

        {/* Hero — ห้ามใช้คำว่า 24 ชั่วโมง เบอร์ในสมุดนี้ส่วนใหญ่รับสายเฉพาะเวลาราชการ */}
        <div className="rounded-xl px-4 py-3.5 flex items-center gap-3"
             style={{ background: BOOK.gradient }}>
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
            <BookUser size={20} className="text-white" />
          </div>
          <div className="text-white">
            <h2 className="font-bold text-[15px] leading-tight">{BOOK.subtitle}</h2>
            <p className="text-white/80 text-[11px] mt-0.5">
              แตะที่รายการเพื่อโทรออก — กรณีเหตุด่วนเหตุร้าย โทร{' '}
              <Link to="/emergency" className="underline font-semibold">สายด่วนฉุกเฉิน</Link>
            </p>
          </div>
        </div>

        {/* Search */}
        {showSearch && (
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อ หน่วยงาน หมู่ หรือเบอร์โทร"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'var(--color-primary)' }}
            />
          </div>
        )}

        {/* Groups */}
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-[58px] rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : !contacts || contacts.length === 0 ? (
          <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-5 py-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <BookUser size={26} className="text-gray-400" />
            </div>
            <p className="font-semibold text-gray-700">ยังไม่มีเบอร์โทรสำคัญ</p>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              {tenant?.name || 'หน่วยงาน'}ยังไม่ได้บันทึกเบอร์หน่วยงานราชการหรือผู้นำท้องถิ่น
            </p>
            {canManage && (
              <Link to="/admin" state={{ page: 'emergency', book: 'directory' }}
                    className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
                    style={{ backgroundColor: BOOK.color }}>
                <Settings size={14} />
                เพิ่มเบอร์โทรสำคัญ
              </Link>
            )}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl bg-white border border-gray-100 shadow-sm px-5 py-8 text-center">
            <p className="text-sm text-gray-500">ไม่พบชื่อหรือเบอร์ที่ตรงกับ “{query.trim()}”</p>
          </div>
        ) : (
          groups.map(({ cat, items }) => (
            <section key={cat.key}>
              <div className="flex items-center gap-2 px-1 mb-1.5">
                <span className="text-sm">{cat.emoji}</span>
                <h2 className="text-[13px] font-bold text-gray-500">{cat.label}</h2>
                <span className="text-[11px] text-gray-400">{items.length}</span>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
                {items.map((c) => <ContactRow key={c.id} contact={c} cat={cat} />)}
              </div>
            </section>
          ))
        )}

        {/* Tenant contact */}
        {tenant?.phone && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
              ติดต่อสำนักงาน
            </p>
            <a href={`tel:${tenant.phone}`}
               aria-label={`โทร ${tenant.name} ${tenant.phone}`}
               className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-gray-100 shadow-sm active:bg-gray-50 hover:bg-gray-50/70 transition-colors">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                   style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, white)' }}>
                <Phone size={18} style={{ color: 'var(--color-primary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-gray-800 leading-snug">{tenant.name}</p>
                <p className="text-sm text-gray-500 mt-0.5 tracking-wide">{tenant.phone}</p>
              </div>
              <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, white)',
                      color: 'var(--color-primary)',
                    }}>
                <Phone size={16} />
              </span>
            </a>
          </div>
        )}

      </div>
    </div>
  )
}
