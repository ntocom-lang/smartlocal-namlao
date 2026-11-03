import { useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Download, Loader2, Mail, MapPin, Phone, RefreshCw } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { PRIVACY_POLICY_EFFECTIVE, PRIVACY_POLICY_VERSION, buildPrivacyPolicy } from '../lib/privacyPolicy'
import { QUIET_MODULES, qrLayout } from '../lib/qrSvg'

// นโยบายความเป็นส่วนตัวของ อปท. ที่เปิดอยู่ — เปิดได้โดยไม่ต้องล็อกอิน เพราะเป็นลิงก์ที่ต้องกรอกในหน้าข้อมูลแอป
// บนสโตร์ด้วย เนื้อหาทั้งหมดอยู่ที่ src/lib/privacyPolicy.js หน้านี้แค่วาด (แก้ข้อความที่นั่นที่เดียว)
// InfoArticle ใช้ร่วมกับหน้ากลางบนโดเมนของแอป (PlatformInfoPage.jsx) หน้าตาเอกสารทุกหน้าจึงเป็นชุดเดียวกัน
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

// รายชื่อ อปท. บนหน้ากลางของแอป — แต่ละแห่งมีช่องทางติดต่อและลิงก์ไปเว็บของหน่วยงานนั้น (คนละโดเมน จึงเป็น <a> ธรรมดา)
// orgsStatus: 'loading' | 'failed' | 'ready' (หน้าของ อปท. ไม่มีรายการนี้ ไม่ต้องส่ง)
function OrgList({ orgs, status, onRetry }) {
  if (status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> กำลังโหลดรายชื่อหน่วยงาน...
      </p>
    )
  }
  if (status === 'failed') {
    return (
      <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
        โหลดรายชื่อหน่วยงานไม่สำเร็จ อาจเกิดจากสัญญาณขาดช่วง
        <button type="button" onClick={onRetry}
          className="mt-2 flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 font-semibold text-red-600 border border-red-100">
          <RefreshCw size={16} aria-hidden="true" /> ลองใหม่
        </button>
      </div>
    )
  }
  if (!orgs?.length) return null
  return (
    <ul className="space-y-3">
      {orgs.map(org => (
        <li key={org.key} data-org={org.key} className="space-y-2 rounded-xl border border-gray-100 p-3">
          <div>
            <p className="text-sm font-bold text-gray-800">{org.name}</p>
            {org.area && <p className="text-xs text-gray-500">{org.area}</p>}
          </div>
          <ContactList contacts={org.contacts} />
          <a href={org.href} data-org-link
            className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-3 text-sm font-semibold hover:bg-gray-50"
            style={{ color: 'var(--color-primary)' }}>
            {org.hrefLabel}
          </a>
        </li>
      ))}
    </ul>
  )
}

// ปุ่มโหลดไฟล์ (หน้า /download) — ไฟล์อยู่โดเมนเดียวกัน จึงใช้ attribute download ได้ (ข้ามโดเมนเบราว์เซอร์จะเมิน)
function DownloadButton({ download }) {
  return (
    <div className="space-y-1.5">
      <a href={download.href} download data-download-link
        className="flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold text-white"
        style={{ backgroundColor: 'var(--color-primary)' }}>
        <Download size={18} aria-hidden="true" /> {download.label}
      </a>
      {download.meta && <p className="text-center text-xs text-gray-500">{download.meta}</p>}
    </div>
  )
}

// QR เวกเตอร์ (ตัวสร้างเดียวกับใบพิมพ์/แจ้งเตือน Telegram) — ข้อความที่เข้ารหัสเป็นลิงก์สาธารณะเท่านั้น
function QrBlock({ qr }) {
  const layout = useMemo(() => qrLayout(qr.text, 168), [qr.text])
  if (!layout) return null
  const box = layout.size + QUIET_MODULES * 2
  return (
    <figure className="flex flex-col items-center gap-1" data-download-qr>
      <svg viewBox={`0 0 ${box} ${box}`} width={layout.side} height={layout.side} role="img" aria-label={qr.label}
        className="rounded-lg border border-slate-200 bg-white">
        <rect width={box} height={box} fill="#fff" />
        <path transform={`translate(${QUIET_MODULES} ${QUIET_MODULES})`} d={layout.d} fill="#000" shapeRendering="crispEdges" />
      </svg>
      <figcaption className="text-xs text-gray-500">{qr.label}</figcaption>
    </figure>
  )
}

/**
 * เอกสารหน้าเดียวแบบการ์ดเรียงหัวข้อ (นโยบาย / ลบบัญชี / ช่วยเหลือ / ติดตั้งแอป)
 * @param {{ doc: object, eyebrow: string, attr?: 'privacy'|'platform', version?: boolean, toc?: boolean,
 *   orgsStatus?: string, onRetry?: () => void, footer?: import('react').ReactNode }} props
 *   attr = ชื่อ data attribute ของหน้าและหัวข้อ (data-privacy-page / data-platform-page) ที่เทสต์ใช้หา
 */
export function InfoArticle({ doc, eyebrow, attr = 'privacy', version = false, toc = false, orgsStatus, onRetry, footer }) {
  const { hash } = useLocation()

  // ลิงก์จากหน้าอื่นชี้หัวข้อตรงๆ (เช่น /privacy#retention จากหน้าลบบัญชี) — หน้าโหลดแบบ lazy เบราว์เซอร์จึง
  // เลื่อนเองไม่ทัน ต้องเลื่อนหลังวาดเสร็จ (เนื้อหาอยู่ในกล่อง main ที่เลื่อนได้ของแอป scrollIntoView จัดการให้)
  // doc อยู่ใน deps: ข้อมูลหน่วยงาน/รายชื่อหน่วยงานมาถึงทีหลังแล้วหน้ายืดออก ต้องเลื่อนให้ตรงหัวข้ออีกครั้ง
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [hash, doc])

  function jumpTo(event, id) {
    event.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen pb-12" style={{ backgroundColor: '#eef2f7' }}>
      <header style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="mx-auto max-w-lg px-4 py-5 text-white">
          <p className="text-xs text-white/75">{eyebrow}</p>
          <h1 className="text-lg font-bold leading-tight">{doc.title}</h1>
        </div>
      </header>

      <article {...{ [`data-${attr}-page`]: '' }} className="mx-auto max-w-lg space-y-3 px-4 py-4">
        <section className={`${card} space-y-2`}>
          <p className="text-sm leading-6 text-gray-700">{doc.intro}</p>
          {version && (
            <p data-privacy-version className="text-xs text-gray-500">รุ่น {PRIVACY_POLICY_VERSION} · มีผลตั้งแต่วันที่ {PRIVACY_POLICY_EFFECTIVE}</p>
          )}
        </section>

        {toc && (
          <nav aria-label="หัวข้อในนโยบาย" className={card}>
            <ol className="space-y-1">
              {doc.sections.map(section => (
                <li key={section.id}>
                  <a href={`#${section.id}`} onClick={(e) => jumpTo(e, section.id)}
                    className="flex min-h-10 items-center text-sm font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {doc.sections.map(section => (
          <section key={section.id} id={section.id} {...{ [`data-${attr}-section`]: section.id }}
            className={`${card} scroll-mt-4 space-y-3`} aria-labelledby={`${attr}-${section.id}`}>
            <h2 id={`${attr}-${section.id}`} className="text-sm font-bold text-gray-800">{section.title}</h2>
            {section.paragraphs?.map(text => <p key={text} className="text-sm leading-6 text-gray-700">{text}</p>)}
            {section.steps?.length > 0 && (
              <ol className="space-y-2">
                {section.steps.map((text, i) => (
                  <li key={text} className="flex items-start gap-3 text-sm leading-6 text-gray-700">
                    <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: 'var(--color-primary)' }}>{i + 1}</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            )}
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
            {section.orgs && <OrgList orgs={section.orgs} status={orgsStatus} onRetry={onRetry} />}
            {section.download && <DownloadButton download={section.download} />}
            {section.qr && <QrBlock qr={section.qr} />}
            {section.details && (
              <details className="rounded-xl border border-gray-100 p-3 text-xs text-gray-600" data-download-details>
                <summary className="min-h-8 cursor-pointer font-semibold">{section.details.summary}</summary>
                <p className="mt-2 break-all font-mono leading-5">{section.details.text}</p>
              </details>
            )}
            {section.note &&<p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-gray-600">{section.note}</p>}
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

        {footer}
      </article>
    </div>
  )
}

export default function PrivacyPolicyPage() {
  const { tenant } = useTenant()
  const policy = useMemo(() => buildPrivacyPolicy(tenant), [tenant])
  return <InfoArticle doc={policy} eyebrow={tenant?.name || 'หน่วยงาน'} version toc />
}
