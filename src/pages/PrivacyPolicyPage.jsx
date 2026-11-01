import { useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Mail, MapPin, Phone } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { PRIVACY_POLICY_EFFECTIVE, PRIVACY_POLICY_VERSION, buildPrivacyPolicy } from '../lib/privacyPolicy'

// นโยบายความเป็นส่วนตัวของ อปท. ที่เปิดอยู่ — เปิดได้โดยไม่ต้องล็อกอิน เพราะเป็นลิงก์ที่ต้องกรอกในหน้าข้อมูลแอป
// บนสโตร์ด้วย เนื้อหาทั้งหมดอยู่ที่ src/lib/privacyPolicy.js หน้านี้แค่วาด (แก้ข้อความที่นั่นที่เดียว)
const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4'
const CONTACT_ICON = { address: MapPin, phone: Phone, email: Mail }

// เบอร์ของหน่วยงานบางแห่งกรอกไว้หลายเบอร์ในช่องเดียว ("053-xxx, 053-yyy") ลิงก์โทรใช้เบอร์แรก ข้อความแสดงครบ
function telHref(value) {
  const first = String(value).split(/,|\/| หรือ /)[0]
  const digits = first.replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : null
}

function ContactList({ contacts }) {
  if (!contacts?.length) return null
  return (
    <ul className="space-y-2">
      {contacts.map(contact => {
        const Icon = CONTACT_ICON[contact.kind]
        const href = contact.kind === 'phone' ? telHref(contact.value) : contact.kind === 'email' ? `mailto:${contact.value}` : null
        return (
          <li key={contact.kind} className="flex items-start gap-2 text-sm leading-6 text-gray-700">
            <Icon size={16} className="mt-1 shrink-0 text-gray-400" aria-hidden="true" />
            <span className="min-w-0">
              <span className="font-semibold">{contact.label}</span>{' '}
              {href ? <a href={href} className="break-all underline">{contact.value}</a> : <span className="break-words">{contact.value}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export default function PrivacyPolicyPage() {
  const { hash } = useLocation()
  const { tenant } = useTenant()
  const policy = useMemo(() => buildPrivacyPolicy(tenant), [tenant])

  // ลิงก์จากหน้าอื่นชี้หัวข้อตรงๆ (เช่น /privacy#retention จากหน้าลบบัญชี) — หน้าโหลดแบบ lazy เบราว์เซอร์จึง
  // เลื่อนเองไม่ทัน ต้องเลื่อนหลังวาดเสร็จ (เนื้อหาอยู่ในกล่อง main ที่เลื่อนได้ของแอป scrollIntoView จัดการให้)
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [hash, tenant])

  function jumpTo(event, id) {
    event.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen pb-12" style={{ backgroundColor: '#eef2f7' }}>
      <header style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="mx-auto max-w-lg px-4 py-5 text-white">
          <p className="text-xs text-white/75">{tenant?.name || 'หน่วยงาน'}</p>
          <h1 className="text-lg font-bold leading-tight">{policy.title}</h1>
        </div>
      </header>

      <article data-privacy-page className="mx-auto max-w-lg space-y-3 px-4 py-4">
        <section className={`${card} space-y-2`}>
          <p className="text-sm leading-6 text-gray-700">{policy.intro}</p>
          <p data-privacy-version className="text-xs text-gray-500">รุ่น {PRIVACY_POLICY_VERSION} · มีผลตั้งแต่วันที่ {PRIVACY_POLICY_EFFECTIVE}</p>
        </section>

        <nav aria-label="หัวข้อในนโยบาย" className={card}>
          <ol className="space-y-1">
            {policy.sections.map(section => (
              <li key={section.id}>
                <a href={`#${section.id}`} onClick={(e) => jumpTo(e, section.id)}
                  className="flex min-h-10 items-center text-sm font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {policy.sections.map(section => (
          <section key={section.id} id={section.id} data-privacy-section={section.id}
            className={`${card} scroll-mt-4 space-y-3`} aria-labelledby={`privacy-${section.id}`}>
            <h2 id={`privacy-${section.id}`} className="text-sm font-bold text-gray-800">{section.title}</h2>
            {section.paragraphs?.map(text => <p key={text} className="text-sm leading-6 text-gray-700">{text}</p>)}
            {section.items?.length > 0 && (
              <ul className="space-y-2">
                {section.items.map(text => (
                  <li key={text} className="flex items-start gap-2 text-sm leading-6 text-gray-700">
                    <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            )}
            <ContactList contacts={section.contacts} />
            {section.note && <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-gray-600">{section.note}</p>}
            {section.links?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {section.links.map(link => (
                  <Link key={link.to} to={link.to}
                    className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-3 text-sm font-semibold hover:bg-gray-50"
                    style={{ color: 'var(--color-primary)' }}>
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))}
      </article>
    </div>
  )
}
