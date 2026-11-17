import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronDown, ChevronRight, ClipboardList, ExternalLink, FileDown, FileText, HelpCircle, Search, SearchX, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { NAV_GROUPS } from '../components/layout/CitizenSidebar'
import {
  WATERWORKS_DOCUMENT_TYPES, WATERWORKS_MODULE_KEY, allDocumentTypes, customDocumentTypes, selectableDocumentTypes,
} from '../lib/documentTypes'
import { moduleHiddenCategoryValues, withoutModuleHiddenCategories } from '../lib/complaintCategoryModules'
import { DEFAULT_COMPLAINT_CATEGORIES } from '../lib/complaintCategoryDefaults'
import { withoutOfficialsOnlyCategories, isOfficialRole } from '../lib/serviceAudience'
import { PATIENT_TRANSPORT_TYPE, PATIENT_TRANSPORT_MODULE_KEY } from '../lib/patientTransport'
import { moduleForPath } from '../lib/staffModules'
import { buildServiceIndex, safeLink, searchServices } from '../lib/serviceSearch'

// หน้าค้นหาบริการของประชาชน (/search) — พิมพ์ปัญหาที่พบ (เช่น "ไฟดับ") ระบบพาไปบริการที่ถูกต้อง
// พร้อมคำถามที่พบบ่อยและแบบฟอร์มดาวน์โหลด · ตรรกะค้นหาอยู่ที่ src/lib/serviceSearch.js (กฎตรงไปตรงมา ไม่ใช้ AI)
// ⚠️ โหลด service_forms/service_faqs เฉพาะตอนเปิดหน้านี้เท่านั้น (โควตา egress ของแผนฟรี) — ห้ามย้ายไปโหลดในเมนู/ทุกหน้า
// ⚠️ ลิงก์จากข้อมูลที่เจ้าหน้าที่กรอก ต้องผ่าน safeLink ก่อนแสดงเสมอ (กัน javascript:/data:/ลิงก์ออกนอกเว็บแบบ //)

const EXAMPLE_QUERIES = ['ไฟดับ', 'ถังขยะ', 'ท่อตัน', 'ขออนุญาตสร้างบ้าน', 'ภาษีที่ดิน']
// เมนูที่ไม่ใช่ "บริการ" ให้ค้น: หน้าแรก/เมนูทั้งหมด/ตัวหน้านี้เอง
const MENU_SKIP_PATHS = ['/', '/more', '/search']
const FAQ_LINK_DEFAULT_LABEL = 'ไปยื่นเรื่อง'

// ตัดอีโมจิ/สัญลักษณ์นำหน้าป้ายประเภทคำขอ ("🏗️ ขออนุญาต…" → "ขออนุญาต…") เพื่อให้ค้น "ขอ…" แล้วขึ้นต้นด้วยชื่อจริง
const stripLeadingSymbols = (text) => String(text ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim()

function ResultLink({ href, external, className, style, children }) {
  if (external) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={className} style={style}>{children}</a>
  }
  return <Link to={href} className={className} style={style}>{children}</Link>
}

function SectionTitle({ icon: Icon, children, count }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <Icon size={16} className="text-gray-400" aria-hidden="true" />
      <h2 className="text-sm font-bold text-gray-700">{children}</h2>
      {typeof count === 'number' && <span className="text-xs font-semibold text-gray-400">{count}</span>}
    </div>
  )
}

function ServiceCard({ item }) {
  return (
    <ResultLink href={item.href} external={item.external}
      className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm transition-all hover:shadow-md active:scale-[0.99]">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-snug text-gray-800 [overflow-wrap:anywhere]">{item.title}</span>
        {item.subtitle && <span className="mt-0.5 block text-xs text-gray-500">{item.subtitle}</span>}
      </span>
      <span className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>ไปยื่นเรื่อง</span>
      <ChevronRight size={18} className="shrink-0 text-gray-300" aria-hidden="true" />
    </ResultLink>
  )
}

function FaqCard({ item, open, onToggle }) {
  const faq = item.source
  const link = safeLink(faq.link_url)
  const panelId = `faq-panel-${item.id}`
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left">
        <HelpCircle size={18} className="shrink-0 text-sky-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[15px] font-bold leading-snug text-gray-800 [overflow-wrap:anywhere]">{faq.question}</span>
        <ChevronDown size={18} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className="border-t border-gray-100 px-4 pb-4 pt-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700 [overflow-wrap:anywhere]">{faq.answer}</p>
          {link && (
            <ResultLink href={link.internal ? link.to : link.href} external={!link.internal}
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              {(faq.link_label || '').trim() || FAQ_LINK_DEFAULT_LABEL}
              {!link.internal && <ExternalLink size={14} aria-hidden="true" />}
            </ResultLink>
          )}
        </div>
      )}
    </div>
  )
}

function FormCard({ item }) {
  const form = item.source
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
        <FileDown size={20} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold leading-snug text-gray-800 [overflow-wrap:anywhere]">{form.title}</span>
        {form.description && <span className="mt-0.5 block text-xs text-gray-500 [overflow-wrap:anywhere]">{form.description}</span>}
        {form.file_name && <span className="mt-0.5 block text-[11px] text-gray-400 [overflow-wrap:anywhere]">{form.file_name}</span>}
      </span>
      <a href={item.href} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        ดาวน์โหลด
      </a>
    </div>
  )
}

export default function ServiceSearchPage() {
  const navigate = useNavigate()
  const { tenant, isModuleEnabled } = useTenant()
  const { role } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [text, setText] = useState(() => searchParams.get('q') ?? '')

  const moduleOn = isModuleEnabled('service-help')
  const complaintsOn = isModuleEnabled('complaints')
  const inboxOn = isModuleEnabled('inbox')
  const waterworksOn = isModuleEnabled(WATERWORKS_MODULE_KEY)
  const transportOn = isModuleEnabled(PATIENT_TRANSPORT_MODULE_KEY)

  const [faqs, setFaqs] = useState([])
  const [forms, setForms] = useState([])
  const [categories, setCategories] = useState([])
  const [transportOpen, setTransportOpen] = useState(false)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [openFaqs, setOpenFaqs] = useState(() => new Set())

  // โหลดข้อมูลของหน้านี้ครั้งเดียวต่อการเปิด (คอลัมน์ระบุชื่อ + กรองเฉพาะที่เผยแพร่ ของ อปท. นี้)
  useEffect(() => {
    if (!tenant?.id || !moduleOn) return undefined
    let cancelled = false
    // loading เริ่มที่ true อยู่แล้ว — ไม่ตั้งซ้ำใน effect (หน้านี้ไม่เปลี่ยน อปท. ระหว่างเปิดอยู่)
    const settle = (promise) => Promise.resolve(promise).then((res) => res, () => ({ data: null, error: new Error('network') }))
    Promise.all([
      settle(supabase.from('service_faqs')
        .select('id, department_id, question, answer, keywords, link_url, link_label, sort_order')
        .eq('municipality_id', tenant.id).eq('is_published', true)
        .order('sort_order', { ascending: true }).order('question', { ascending: true })),
      settle(supabase.from('service_forms')
        .select('id, department_id, title, description, file_url, file_name, keywords, sort_order')
        .eq('municipality_id', tenant.id).eq('is_published', true)
        .order('sort_order', { ascending: true }).order('title', { ascending: true })),
      complaintsOn
        ? settle(supabase.from('complaint_categories')
          .select('value, label, submit_audience')
          .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order'))
        : Promise.resolve({ data: [], error: null }),
      inboxOn && transportOn
        ? settle(supabase.rpc('patient_booking_info', { p_muni: tenant.id }))
        : Promise.resolve({ data: null, error: null }),
    ]).then(([faqRes, formRes, catRes, transportRes]) => {
      if (cancelled) return
      setFaqs(faqRes.error ? [] : (faqRes.data ?? []))
      setForms(formRes.error ? [] : (formRes.data ?? []))
      // เหมือน ComplaintCategory.jsx: ไม่มีหมวดของ อปท. เลย/โหลดไม่ได้ → ใช้ชุดสำรอง
      if (complaintsOn) setCategories(!catRes.error && catRes.data?.length ? catRes.data : DEFAULT_COMPLAINT_CATEGORIES)
      setTransportOpen(!transportRes.error && transportRes.data?.enabled === true)
      setLoadError(Boolean(faqRes.error || formRes.error))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [tenant?.id, moduleOn, complaintsOn, inboxOn, transportOn])

  // ชื่อกองใช้จัดกลุ่มแบบฟอร์ม — ตาราง departments อ่านได้เฉพาะบัญชีภายใน (RLS) ประชาชนอ่านไม่ได้
  // จึงถามเฉพาะผู้มีตำแหน่ง ถ้าไม่ได้ชื่อกองก็แสดงแบบฟอร์มรวมเป็นกลุ่มเดียว ไม่ใช่หน้าว่าง
  useEffect(() => {
    if (!tenant?.id || !moduleOn || !isOfficialRole(role) || forms.every((f) => !f.department_id)) return undefined
    let cancelled = false
    Promise.resolve(supabase.from('departments').select('id, name').eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order'))
      .then(({ data, error }) => { if (!cancelled) setDepartments(error ? [] : (data ?? [])) }, () => {})
    return () => { cancelled = true }
  }, [tenant?.id, moduleOn, role, forms])

  // บริการ = ประเภทคำขอ + หมวดคำร้อง + เมนูประชาชน — ใช้แหล่งเดิมของระบบ ไม่เขียนรายการซ้ำ
  const services = useMemo(() => {
    const out = []
    if (inboxOn || (transportOn && transportOpen)) {
      const customValues = new Set(customDocumentTypes(tenant).map((t) => t.value))
      for (const type of selectableDocumentTypes(allDocumentTypes(tenant), tenant, role)) {
        if (type.value === PATIENT_TRANSPORT_TYPE) {
          if (transportOn && transportOpen) out.push({ id: `doc:${type.value}`, title: stripLeadingSymbols(type.label), subtitle: 'งานบริการประชาชน', href: '/patient-transport' })
          continue
        }
        if (!inboxOn) continue
        if (WATERWORKS_DOCUMENT_TYPES.includes(type.value) && !waterworksOn) continue
        out.push({
          id: `doc:${type.value}`,
          title: stripLeadingSymbols(type.label),
          subtitle: 'งานบริการประชาชน',
          // ประเภทที่ อปท. เพิ่มเองไม่มีฟอร์มเฉพาะให้ ?type= เลือก → พาไปหน้ารวมประเภทคำขอ
          href: customValues.has(type.value) ? '/doc-request' : `/doc-request?type=${encodeURIComponent(type.value)}`,
        })
      }
    }
    if (complaintsOn) {
      const visible = withoutOfficialsOnlyCategories(
        withoutModuleHiddenCategories(categories, moduleHiddenCategoryValues(isModuleEnabled)),
        role,
      )
      for (const cat of visible ?? []) {
        out.push({ id: `cat:${cat.value}`, title: cat.label, subtitle: 'ร้องเรียน/ร้องทุกข์', href: `/request?category=${encodeURIComponent(cat.value)}` })
      }
    }
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (MENU_SKIP_PATHS.includes(item.href)) continue
        const key = moduleForPath(item.href)
        if (key && !isModuleEnabled(key)) continue
        out.push({ id: `menu:${item.href}`, title: item.label, subtitle: `เมนู · ${group.label}`, href: item.href })
      }
    }
    return out
  }, [tenant, role, categories, inboxOn, complaintsOn, waterworksOn, transportOn, transportOpen, isModuleEnabled])

  const index = useMemo(() => buildServiceIndex({ services, faqs, forms }), [services, faqs, forms])

  const query = text.trim()
  const results = useMemo(() => searchServices(index, query), [index, query])
  const byKind = (kind) => results.filter((r) => r.kind === kind)

  function onChange(value) {
    setText(value)
    const next = new URLSearchParams(searchParams)
    if (value.trim()) next.set('q', value.trim()); else next.delete('q')
    setSearchParams(next, { replace: true })
  }

  function toggleFaq(id) {
    setOpenFaqs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // แบบฟอร์มทั้งหมด (ไม่มีคำค้น) จัดกลุ่มตามกอง — กลุ่มว่างไม่แสดง
  const formGroups = useMemo(() => {
    const names = new Map(departments.map((d) => [d.id, d.name]))
    const groups = new Map()
    const push = (label, item) => { if (!groups.has(label)) groups.set(label, []); groups.get(label).push(item) }
    for (const item of index.filter((i) => i.kind === 'form')) {
      const dept = item.source.department_id
      if (names.size === 0) push('แบบฟอร์มทั้งหมด', item)
      else push(names.get(dept) || 'ทั่วไป', item)
    }
    // ลำดับกลุ่มตามลำดับกองของ อปท. · "ทั่วไป" ไว้ท้ายสุด
    const ordered = [...names.values(), 'แบบฟอร์มทั้งหมด', 'ทั่วไป'].filter((label, i, arr) => arr.indexOf(label) === i)
    return ordered.filter((label) => groups.has(label)).map((label) => ({ label, items: groups.get(label) }))
  }, [index, departments])

  const faqItems = query ? byKind('faq') : index.filter((i) => i.kind === 'faq')
  const formItems = byKind('form')
  const serviceItems = byKind('service')
  const nothingFound = query && results.length === 0

  return (
    <div className="mx-auto max-w-2xl pb-28 md:pb-8">
      {/* Mobile header */}
      <div className="sticky top-0 z-30 bg-gray-50/95 px-4 pb-2 pt-3 backdrop-blur-md md:hidden">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} aria-label="ย้อนกลับ" className="-ml-1 rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-200/60">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">ค้นหาบริการ/แบบฟอร์ม</h1>
        </div>
      </div>

      {/* PC header */}
      <div className="mb-2 hidden items-center gap-3 border-b border-gray-100 px-4 pb-5 pt-8 md:flex">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700"><Search size={22} aria-hidden="true" /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">ค้นหาบริการ/แบบฟอร์ม</h1>
          <p className="mt-0.5 text-sm text-gray-500">พิมพ์ปัญหาที่พบ ระบบจะพาไปบริการที่ถูกต้อง</p>
        </div>
      </div>

      <div className="space-y-4 px-4 pt-1 md:pt-4">
        <label className="relative block">
          <span className="sr-only">ค้นหาบริการ คำถามที่พบบ่อย หรือแบบฟอร์ม</span>
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input type="search" value={text} maxLength={100} onChange={(e) => onChange(e.target.value)}
            placeholder="เช่น ไฟดับ ถังขยะ ท่อตัน ขออนุญาตสร้างบ้าน"
            enterKeyHint="search" autoComplete="off"
            className="min-h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-11 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-200" />
          {text && (
            <button type="button" onClick={() => onChange('')} aria-label="ล้างคำค้น"
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">
              <X size={18} />
            </button>
          )}
        </label>

        {!query && (
          <div className="flex flex-wrap gap-2" aria-label="ตัวอย่างคำค้น">
            {EXAMPLE_QUERIES.map((example) => (
              <button key={example} type="button" onClick={() => onChange(example)}
                className="min-h-[40px] rounded-full border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                {example}
              </button>
            ))}
          </div>
        )}

        {loadError && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            โหลดคำถามที่พบบ่อยหรือแบบฟอร์มไม่สำเร็จ แต่ยังค้นหาบริการได้ตามปกติ
          </div>
        )}

        {loading && !query && (
          <div className="space-y-3" aria-busy="true">
            {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-gray-100" />)}
          </div>
        )}

        {nothingFound ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
            <SearchX size={32} className="mx-auto text-gray-300" aria-hidden="true" />
            <p className="mt-2 text-base font-bold text-gray-700">ไม่พบบริการที่ค้นหา</p>
            <p className="mt-1 text-sm text-gray-500">ลองใช้คำอื่น หรือเลือกช่องทางด้านล่าง</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {complaintsOn && (
                <Link to="/complaint" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
                  <ClipboardList size={16} aria-hidden="true" /> ร้องเรียน/ร้องทุกข์
                </Link>
              )}
              {inboxOn && (
                <Link to="/doc-request" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700">
                  <FileText size={16} aria-hidden="true" /> งานบริการประชาชน
                </Link>
              )}
            </div>
          </div>
        ) : query ? (
          <div className="space-y-5">
            {serviceItems.length > 0 && (
              <section className="space-y-2">
                <SectionTitle icon={ClipboardList} count={serviceItems.length}>บริการ</SectionTitle>
                {serviceItems.map((item) => <ServiceCard key={`${item.kind}:${item.id}`} item={item} />)}
              </section>
            )}
            {faqItems.length > 0 && (
              <section className="space-y-2">
                <SectionTitle icon={HelpCircle} count={faqItems.length}>คำถามที่พบบ่อย</SectionTitle>
                {faqItems.map((item) => <FaqCard key={item.id} item={item} open={openFaqs.has(item.id)} onToggle={() => toggleFaq(item.id)} />)}
              </section>
            )}
            {formItems.length > 0 && (
              <section className="space-y-2">
                <SectionTitle icon={FileDown} count={formItems.length}>แบบฟอร์ม</SectionTitle>
                {formItems.map((item) => <FormCard key={item.id} item={item} />)}
              </section>
            )}
          </div>
        ) : !loading && (
          <div className="space-y-5">
            {faqItems.length > 0 && (
              <section className="space-y-2">
                <SectionTitle icon={HelpCircle} count={faqItems.length}>คำถามที่พบบ่อย</SectionTitle>
                {faqItems.map((item) => <FaqCard key={item.id} item={item} open={openFaqs.has(item.id)} onToggle={() => toggleFaq(item.id)} />)}
              </section>
            )}
            {formGroups.map((group) => (
              <section key={group.label} className="space-y-2">
                <SectionTitle icon={FileDown} count={group.items.length}>{group.label}</SectionTitle>
                {group.items.map((item) => <FormCard key={item.id} item={item} />)}
              </section>
            ))}
            {faqItems.length === 0 && formGroups.length === 0 && (
              <p className="rounded-2xl border border-gray-100 bg-white p-5 text-center text-sm text-gray-500">
                พิมพ์ปัญหาที่พบในช่องค้นหาด้านบน ระบบจะพาไปบริการที่ถูกต้อง
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
