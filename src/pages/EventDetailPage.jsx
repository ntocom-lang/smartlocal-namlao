import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Clock, Copy, ExternalLink, Loader2, MapPin, Navigation, Paperclip, Share2, Star } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { anonColumns } from '../lib/anonColumns'
import { appUrl } from '../lib/basename'
import { copyText, shareTrackLink } from '../lib/complaintTrack'
import { countdownBadgeClass, eventCountdown } from '../lib/eventCountdown'
import {
  REVIEW_COMMENT_MAX, deleteMyEventReview, fetchCanModerateEvent, fetchEventReviewSummary, fetchEventReviews, fetchMyEventReview,
  submitEventReview,
} from '../lib/eventReviewsApi'

// หน้ารายละเอียดกิจกรรมสำหรับประชาชน (/events/:id) — ลิงก์แชร์เข้ามาที่นี่ ไม่ต้องล็อกอินก็เปิดดูได้
// แสดงเฉพาะกิจกรรมสาธารณะ (audiences มี 'public') ของ อปท. นี้ — กิจกรรมภายในต่อให้บุคลากรอ่านได้ผ่าน RLS
// หน้านี้ก็ต้องตอบ "ไม่พบกิจกรรม" ไม่งั้นลิงก์แชร์จะพากิจกรรมภายในหลุดออกไป

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CATEGORY_COLOR = {
  'ประชาสัมพันธ์': '#10b981', 'ประชุม': '#3b82f6', 'กำหนดการ': '#f97316',
  'อบรม': '#8b5cf6', 'อื่นๆ': '#6b7280',
}

function eventAttachments(ev) {
  if (ev.attachment_urls?.length > 0) return ev.attachment_urls
  return ev.attachment_url ? [ev.attachment_url] : []
}

const fmtDate = (dateStr) => (dateStr
  ? new Date(`${dateStr.slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  : 'ยังไม่ระบุวันที่')
const fmtReviewDate = (iso) => new Date(iso)
  .toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })

// ── ดาว ────────────────────────────────────────────────────────────────────────
function StarRow({ value, onChange, size = 28 }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="ให้ดาว">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} ดาว`}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(0)}
          onClick={() => onChange(i)}
          style={{ minWidth: 40, minHeight: 40 }}
          className="flex items-center justify-center transition-transform active:scale-90">
          <Star size={size} className="transition-colors"
            fill={(hover || value) >= i ? '#f59e0b' : 'none'}
            stroke={(hover || value) >= i ? '#f59e0b' : '#d1d5db'} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  )
}

function StarDisplay({ value, size = 14 }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`${value} ดาว`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size} fill={value >= i ? '#f59e0b' : 'none'}
          stroke={value >= i ? '#f59e0b' : '#d1d5db'} strokeWidth={1.5} />
      ))}
    </span>
  )
}

// ── ส่วนความเห็น ─────────────────────────────────────────────────────────────────
// โหลดไม่สำเร็จ (เช่น ฐานข้อมูลยังไม่มี RPC/ตาราง) = ซ่อนทั้งส่วนเงียบๆ (ข้อความดิบลง console ใน eventReviewsApi) ไม่ทำให้หน้าพัง
function ReviewsSection({ event, countdown, session, onLogin }) {
  const eventId = event.id
  const userId = session?.user?.id ?? null
  const sessionReady = session !== undefined
  const [data, setData] = useState(null) // { reviews, summary, mine } | null = กำลังโหลด
  const [unavailable, setUnavailable] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!sessionReady) return undefined
    let alive = true
    Promise.all([
      fetchEventReviews(eventId, { authed: !!userId }),
      fetchEventReviewSummary([eventId]),
      userId ? fetchMyEventReview(eventId) : Promise.resolve({ data: null, error: null }),
      // ผู้ดูแลกิจกรรมให้ดาวงานตัวเองไม่ได้ — ตรวจไม่สำเร็จ = แสดงฟอร์มตามปกติ (ฐานข้อมูลปฏิเสธเองพร้อมข้อความไทย)
      userId ? fetchCanModerateEvent(eventId) : Promise.resolve({ data: false, error: null }),
    ]).then(([list, sum, mine, mod]) => {
      if (!alive) return
      if (list.error || sum.error || mine.error) { setUnavailable(true); return }
      setUnavailable(false)
      setData({
        reviews: list.data, summary: sum.data[eventId] ?? { count: 0, avg: null }, mine: mine.data,
        isModerator: !mod.error && mod.data === true,
      })
    })
    return () => { alive = false }
  }, [eventId, userId, sessionReady, reloadKey])

  if (unavailable) return null

  const mine = data?.mine ?? null
  const others = (data?.reviews ?? []).filter(r => !mine || r.id !== mine.id)
  const summary = data?.summary

  function startEdit() {
    setRating(mine?.rating ?? 0)
    setComment(mine?.comment ?? '')
    setFormError('')
    setEditing(true)
  }

  async function handleSubmit() {
    if (!rating || saving) return
    setSaving(true); setFormError('')
    const res = await submitEventReview(eventId, rating, comment)
    setSaving(false)
    if (res.error) { setFormError(res.error); return }
    setEditing(false)
    setReloadKey(k => k + 1)
  }

  async function handleDelete() {
    if (saving || !window.confirm('ลบความเห็นของคุณออกจากกิจกรรมนี้ใช่ไหม')) return
    setSaving(true); setFormError('')
    const res = await deleteMyEventReview(eventId)
    setSaving(false)
    if (res.error) { setFormError(res.error); return }
    setEditing(false); setRating(0); setComment('')
    setReloadKey(k => k + 1)
  }

  // สรุปดาว: ค่าเฉลี่ยขึ้นเมื่อมีผู้ให้ดาว ≥ 3 คน (ฐานข้อมูลส่ง avg = null ถ้าน้อยกว่านั้น)
  let summaryText = ''
  if (summary) {
    if (summary.count === 0) summaryText = 'ยังไม่มีผู้ให้ดาว'
    else if (summary.avg !== null) summaryText = `★ ${summary.avg.toFixed(1)} (${summary.count} คน)`
    else summaryText = `มีผู้ให้ดาว ${summary.count} คน — ครบ 3 คนจึงแสดงค่าเฉลี่ย`
  }

  const isModerator = !!data?.isModerator
  const showForm = !!userId && countdown.canReview && !isModerator && (!mine || editing)

  return (
    <section aria-labelledby="event-reviews-title" className="space-y-4" data-testid="event-reviews">
      <h2 id="event-reviews-title" className="text-sm font-semibold text-gray-500">ความเห็นและคะแนน</h2>

      {!data ? (
        <div className="h-16 bg-gray-100 dark:bg-white/5 rounded-2xl animate-pulse" />
      ) : (
        <>
          <p className="text-base font-bold text-gray-800 dark:text-slate-200">{summaryText}</p>

          {/* สถานะการให้ดาว: ยังไม่ถึงวัน / ยังไม่ล็อกอิน */}
          {!countdown.canReview && countdown.kind !== 'unknown' && (
            <p className="text-sm text-gray-500 bg-gray-50 dark:bg-white/5 rounded-2xl px-4 py-3">
              ให้ดาวได้ตั้งแต่วันที่ {fmtDate(event.event_date)}
            </p>
          )}
          {countdown.canReview && session === null && (
            <button type="button" onClick={onLogin}
              className="w-full min-h-[44px] rounded-2xl text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              เข้าสู่ระบบเพื่อให้ดาวและแสดงความเห็น
            </button>
          )}

          {countdown.canReview && isModerator && !mine && (
            <p className="text-sm text-gray-500 bg-gray-50 dark:bg-white/5 rounded-2xl px-4 py-3">
              คุณเป็นผู้ดูแลกิจกรรมนี้ จึงให้ดาวงานของตัวเองไม่ได้ — ซ่อนความเห็นที่ไม่เหมาะสมได้ที่หน้าจัดการกิจกรรม
            </p>
          )}

          {/* ความเห็นของฉัน */}
          {mine && !editing && (
            <div className={`rounded-2xl p-3.5 space-y-1.5 border ${mine.is_hidden ? 'bg-gray-50 border-gray-200' : 'bg-amber-50 border-amber-100'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StarDisplay value={mine.rating} size={14} />
                  <span className="text-xs font-semibold text-amber-700">ความเห็นของคุณ</span>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={startEdit} disabled={saving}
                    className="text-xs text-amber-700 underline min-h-[32px]">แก้ไข</button>
                  <button type="button" onClick={handleDelete} disabled={saving}
                    className="text-xs text-red-600 underline min-h-[32px]">ลบ</button>
                </div>
              </div>
              {mine.comment && <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">{mine.comment}</p>}
              {mine.is_hidden && (
                <p role="status" className="text-xs text-red-600 leading-relaxed">
                  เจ้าหน้าที่ซ่อนความเห็นนี้: {mine.hidden_reason || 'ไม่ระบุเหตุผล'} — คนอื่นจึงไม่เห็นความเห็นนี้ (แก้ไขแล้วยังคงถูกซ่อนจนกว่าเจ้าหน้าที่จะเลิกซ่อน)
                </p>
              )}
              {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}
            </div>
          )}

          {/* ฟอร์มให้ดาว/แก้ไข */}
          {showForm && (
            <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-4 space-y-3 border border-gray-100 dark:border-white/10">
              <p className="text-sm font-bold text-gray-700 dark:text-slate-200">{editing ? 'แก้ไขความเห็น' : 'ให้ดาวกิจกรรมนี้'}</p>
              <StarRow value={rating} onChange={setRating} />
              <div>
                <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={REVIEW_COMMENT_MAX}
                  aria-label="ความเห็น (ไม่บังคับ)" placeholder="บอกเล่าความรู้สึกต่อกิจกรรมนี้ (ไม่บังคับ)"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-amber-200" />
                <p className="text-right text-[11px] text-gray-400 mt-0.5">{comment.length}/{REVIEW_COMMENT_MAX}</p>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                ชื่อที่แสดงบนความเห็นคือชื่อของคุณ + อักษรแรกของนามสกุล · เจ้าหน้าที่อาจซ่อนความเห็นที่ไม่เหมาะสมพร้อมแจ้งเหตุผล
              </p>
              {formError && <p role="alert" className="text-xs text-red-600">{formError}</p>}
              <div className="flex gap-2">
                {editing && (
                  <button type="button" onClick={() => { setEditing(false); setFormError('') }} disabled={saving}
                    className="flex-1 min-h-[44px] rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors">
                    ยกเลิก
                  </button>
                )}
                <button type="button" onClick={handleSubmit} disabled={saving || !rating}
                  className="flex-1 min-h-[44px] rounded-xl font-bold text-sm text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: '#f59e0b' }}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} fill="white" strokeWidth={0} />}
                  {saving ? 'กำลังบันทึก...' : 'ส่งความเห็น'}
                </button>
              </div>
            </div>
          )}

          {/* ความเห็นล่าสุด */}
          {others.length > 0 && (
            <ul className="space-y-2.5">
              {others.map(r => (
                <li key={r.id} className="bg-white dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/10 px-3.5 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-white/10 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">
                      {(r.reviewer_name?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-700 dark:text-slate-200 leading-none break-words">{r.reviewer_name || 'ผู้ใช้งาน'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <StarDisplay value={r.rating} size={11} />
                        <span className="text-[11px] text-gray-400">{fmtReviewDate(r.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  {r.comment && <p className="text-sm text-gray-600 dark:text-slate-300 leading-relaxed pl-9 whitespace-pre-wrap break-words">{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

// ── ปุ่มแชร์ ───────────────────────────────────────────────────────────────────
function ShareButtons({ title, text, url }) {
  const [notice, setNotice] = useState('')
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function share() {
    const result = await shareTrackLink({ url, title, text })
    if (result === 'copied') setNotice('คัดลอกลิงก์แล้ว วางส่งต่อได้เลย')
    else if (result === 'failed') setNotice('ส่งต่ออัตโนมัติไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอก')
    else setNotice('')
  }
  async function copy() {
    setNotice((await copyText(url)) ? 'คัดลอกลิงก์แล้ว วางส่งต่อได้เลย' : 'คัดลอกไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอก')
  }
  // แชร์ด้วยลิงก์ของ LINE เอง ไม่ใช้ Messaging API — ไม่มีค่าใช้จ่ายและไม่นับโควตาข้อความ
  const lineHref = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`

  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${canShare ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {canShare && (
          <button type="button" onClick={share}
            className="min-h-[44px] rounded-xl text-sm font-bold text-white inline-flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Share2 size={16} aria-hidden="true" /> แชร์
          </button>
        )}
        <a href={lineHref} target="_blank" rel="noopener noreferrer"
          className="min-h-[44px] rounded-xl text-sm font-bold text-white inline-flex items-center justify-center gap-1.5 bg-[#06C755]">
          <Share2 size={16} aria-hidden="true" /> แชร์ LINE
        </a>
        <button type="button" onClick={copy}
          className="min-h-[44px] rounded-xl text-sm font-bold border-2 inline-flex items-center justify-center gap-1.5 bg-white"
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>
          <Copy size={16} aria-hidden="true" /> คัดลอกลิงก์
        </button>
      </div>
      {notice && <p role="status" className="text-xs font-semibold text-green-700">{notice}</p>}
    </div>
  )
}

// ── หน้า ───────────────────────────────────────────────────────────────────────
export default function EventDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { tenant, loading: tenantLoading } = useTenant()
  const { session } = useAuth()
  const tenantId = tenant?.id ?? null
  const idOk = UUID_RE.test(id ?? '')
  const [loaded, setLoaded] = useState({ id: null, row: null }) // ผูกกับ id กันกิจกรรมก่อนหน้าค้างตอนเปลี่ยนหน้า

  useEffect(() => { document.querySelector('main')?.scrollTo(0, 0) }, [id])

  useEffect(() => {
    if (!tenantId || !idOk) return undefined
    let alive = true
    // anonColumns ห้าม '*' — created_by ซ่อนจาก anon (src/lib/anonColumns.js) · หน้านี้ไม่ต้องใช้ผู้สร้าง
    supabase.from('events').select(anonColumns('events'))
      .eq('id', id).eq('municipality_id', tenantId).maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error('[event-detail] โหลดกิจกรรมไม่สำเร็จ:', error.message)
        if (alive) setLoaded({ id, row: data ?? null })
      })
      .catch(err => {
        console.error('[event-detail] โหลดกิจกรรมไม่สำเร็จ:', err?.message ?? err)
        if (alive) setLoaded({ id, row: null })
      })
    return () => { alive = false }
  }, [tenantId, id, idOk])

  const loading = tenantLoading || (idOk && !!tenantId && loaded.id !== id)
  const row = idOk && loaded.id === id ? loaded.row : null
  // RLS ให้บุคลากรภายในอ่านกิจกรรมภายในได้ — หน้านี้เป็นหน้าสาธารณะ ต้องกรองเองตรงนี้
  const event = row && (row.audiences ?? []).includes('public') && row.municipality_id === tenantId ? row : null
  const countdown = useMemo(() => (event ? eventCountdown(event) : null), [event])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-4 border-gray-200 rounded-full animate-spin"
             style={{ borderTopColor: 'var(--color-primary)' }} />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <CalendarDays size={40} strokeWidth={1.2} className="text-gray-300" />
        <p className="text-gray-500 text-sm">ไม่พบกิจกรรมนี้</p>
        <button type="button" onClick={() => navigate('/events')} className="text-sm text-blue-500 underline">ไปที่ปฏิทินกิจกรรม</button>
      </div>
    )
  }

  const color = CATEGORY_COLOR[event.category] ?? '#6b7280'
  const hasEnd = !!event.event_date && !!event.end_date && event.end_date.slice(0, 10) > event.event_date.slice(0, 10)
  const attachments = eventAttachments(event)
  const shareUrl = appUrl(`/events/${event.id}`)
  const shareText = `${event.title} · ${fmtDate(event.event_date)}${tenant?.name ? ` · ${tenant.name}` : ''}`
  const mapsUrl = event.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`
    : null

  return (
    <div className="max-w-2xl mx-auto px-4 pb-24 md:pb-8">
      <div className="flex items-center gap-2 pt-3 pb-2">
        <button type="button" onClick={() => navigate('/events')} aria-label="กลับไปปฏิทินกิจกรรม"
          className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors" style={{ minWidth: 44, minHeight: 44 }}>
          <ArrowLeft size={20} />
        </button>
        <p className="text-sm font-semibold text-gray-500">ปฏิทินกิจกรรม</p>
      </div>

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
        <div className="p-5 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {event.category && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: color }}>
                  {event.category}
                </span>
              )}
              {countdown.kind !== 'unknown' && (
                <span data-testid="event-countdown" className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${countdownBadgeClass(countdown)}`}>
                  {countdown.label}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 leading-snug break-words">{event.title}</h1>
          </div>

          <div className="space-y-2.5 text-sm text-gray-700 dark:text-slate-300">
            <div className="flex items-start gap-2.5">
              <CalendarDays size={17} className="shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
              <div>
                <p>{fmtDate(event.event_date)}</p>
                {hasEnd && <p className="text-xs text-gray-500 mt-0.5">ถึง {fmtDate(event.end_date)}</p>}
              </div>
            </div>
            {!event.is_all_day && event.event_time && (
              <div className="flex items-center gap-2.5">
                <Clock size={17} className="shrink-0 text-gray-400" aria-hidden="true" />
                <span>{event.event_time.slice(0, 5)}{event.end_time ? ` – ${event.end_time.slice(0, 5)}` : ''} น.</span>
              </div>
            )}
            {event.location && (
              <div className="flex items-start gap-2.5">
                <MapPin size={17} className="shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
                <span className="break-words min-w-0">{event.location}</span>
              </div>
            )}
            {event.description && (
              <p className="leading-relaxed whitespace-pre-wrap break-words pt-1">{event.description}</p>
            )}
            {attachments.length > 0 && (
              <div className="flex items-center gap-2.5 flex-wrap">
                <Paperclip size={17} className="shrink-0 text-gray-400" aria-hidden="true" />
                {attachments.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline font-medium">
                    ดูไฟล์แนบ{attachments.length > 1 ? ` ${i + 1}` : ''}
                  </a>
                ))}
              </div>
            )}
          </div>

          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full min-h-[48px] rounded-2xl font-semibold text-sm text-white active:scale-[0.98] transition-transform"
              style={{ backgroundColor: '#10b981' }}>
              <Navigation size={16} aria-hidden="true" /> นำทางไปที่นี่
              <ExternalLink size={14} className="opacity-70" aria-hidden="true" />
            </a>
          )}

          <ShareButtons title={event.title} text={shareText} url={shareUrl} />
        </div>
      </div>

      <div className="mt-6">
        <ReviewsSection event={event} countdown={countdown} session={session}
          onLogin={() => navigate('/auth', { state: { from: `/events/${event.id}` } })} />
      </div>
    </div>
  )
}
